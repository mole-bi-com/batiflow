import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CdpClient } from '../../cdp/CdpClient';

export interface InstagramCaptureData {
  url: string;
  author: string;
  headline: string;
  dateText: string;
  body: string;
  images: string[];
  comments: Array<{ author: string; text: string }>;
}

export interface InstagramCaptureResult {
  success: boolean;
  scrapPath?: string;
  data?: InstagramCaptureData;
  trace: { steps: string[]; timestamp: string; durationMs: number };
}

export class InstagramCapture {
  private client: CdpClient;
  private scrapBaseDir: string;

  constructor(client: CdpClient, scrapBaseDir?: string) {
    this.client = client;
    this.scrapBaseDir = scrapBaseDir || path.join(__dirname, '../../../../scrap');
  }

  public async capture(url: string, hasSeeMore?: boolean): Promise<InstagramCaptureResult> {
    const startTime = Date.now();
    const steps: string[] = ['Instagram capture initialized (hybrid: DOM + GraphQL)'];

    try {
      const rawClient = this.client.getRawClient();
      if (!rawClient) throw new Error('CDP client not connected');

      const { Network } = rawClient;
      await Network.enable();

      // Capture GraphQL responses in parallel
      let graphqlData: any = null;
      const unlisten = Network.responseReceived(async (params: any) => {
        if (graphqlData) return;
        const reqUrl = params.response.url || '';
        if (!reqUrl.includes('/api/graphql') && !reqUrl.includes('/graphql/query')) return;
        
        try {
          const body = await Network.getResponseBody({ requestId: params.requestId });
          if (body.body && body.body.length > 100 && 
              !body.body.includes('for (;;)') &&
              (body.body.includes('shortcode_media') || body.body.includes('xdt_shortcode') || body.body.includes('"caption"'))) {
            graphqlData = JSON.parse(body.body);
            steps.push('GraphQL post data captured');
          }
        } catch(e) { /* body not available */ }
      });

      console.log('[InstagramCapture] Navigating to post...');
      await this.client.navigate(url);
      // Wait for page + async API calls
      await new Promise(resolve => setTimeout(resolve, 8000));

      if (typeof unlisten === 'function') unlisten();

      let data: InstagramCaptureData | null = null;

      // Strategy A: Parse from GraphQL if captured
      if (graphqlData) {
        data = this.parseGraphQLResponse(graphqlData, url);
        if (data) steps.push('Data from GraphQL API');
      }

      // Strategy B: DOM extraction (external script, no syntax issues)
      if (!data) {
        console.log('[InstagramCapture] GraphQL not available, using DOM fallback...');
        steps.push('Using DOM extraction');
        const extractScript = fs.readFileSync(
          path.join(__dirname, 'instagram-extract.js'), 'utf8'
        );
        data = await this.client.evaluate<InstagramCaptureData>(extractScript);
      }

      if (!data) {
        throw new Error('Both extraction strategies failed');
      }

      const markdown = this.generateMarkdown(data);
      const scrapPath = this.saveArtifacts(data, markdown);
      steps.push(`Saved to ${scrapPath}`);

      return {
        success: true,
        scrapPath, data,
        trace: { steps, timestamp: new Date().toISOString(), durationMs: Date.now() - startTime }
      };

    } catch (err: any) {
      console.error('[InstagramCapture] Error:', err);
      return {
        success: false,
        trace: { steps: [...steps, `Error: ${err.message}`], timestamp: new Date().toISOString(), durationMs: Date.now() - startTime }
      };
    }
  }

  private parseGraphQLResponse(json: any, originalUrl: string): InstagramCaptureData | null {
    try {
      // Try all known GraphQL response structures
      const extracts: Array<() => any> = [
        () => json.data?.xdt_api__v1__media__shortcode__web_info?.items?.[0],
        () => json.data?.xdt_shortcode_media,
        () => json.graphql?.shortcode_media,
        () => json.items?.[0],
        () => json.media,
        () => json.data?.media,
      ];

      let media: any = null;
      for (const fn of extracts) {
        media = fn();
        if (media) break;
      }
      if (!media) return null;

      const owner = media.owner || media.user || {};
      const username = owner.username || 'Unknown';
      const caption = (media.caption?.text || media.caption || '').trim();
      const dateTs = media.taken_at || media.timestamp || media.date || 0;
      const dateText = dateTs ? new Date(dateTs * 1000).toISOString() : 'Recent';

      const images: string[] = [];
      if (media.image_versions2?.candidates) {
        media.image_versions2.candidates.forEach((c: any) => {
          if (c.url && !images.includes(c.url)) images.push(c.url);
        });
      } else if (media.display_url) {
        images.push(media.display_url);
      }
      if (media.carousel_media) {
        media.carousel_media.forEach((item: any) => {
          const srcs = item.image_versions2?.candidates?.map((c: any) => c.url) || [item.display_url].filter(Boolean);
          srcs.forEach((src: string) => { if (src && !images.includes(src)) images.push(src); });
        });
      }

      const comments: Array<{author: string; text: string}> = [];
      const commentList = media.comments?.nodes || media.comments?.data || media.preview_comments || [];
      commentList.forEach((c: any) => {
        const cUser = c.user || c.owner || {};
        comments.push({ author: cUser.username || 'User', text: (c.text || '').substring(0, 500) });
      });

      return { url: originalUrl, author: username, headline: '@' + username.toLowerCase(), dateText, body: caption || 'No content', images: images.slice(0, 20), comments };
    } catch (e) {
      return null;
    }
  }

  private saveArtifacts(data: InstagramCaptureData, markdown: string): string {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const uuidBegin = crypto.randomUUID().slice(0, 8);
    const dirName = dateStr + '-instagram-' + uuidBegin;
    const scrapPath = path.join(this.scrapBaseDir, dirName);
    if (!fs.existsSync(scrapPath)) fs.mkdirSync(scrapPath, { recursive: true });
    fs.writeFileSync(path.join(scrapPath, 'post.md'), markdown, 'utf8');
    fs.writeFileSync(path.join(scrapPath, 'extraction.json'), JSON.stringify(data, null, 2), 'utf8');
    console.log('[InstagramCapture] Saved to ' + scrapPath);
    return scrapPath;
  }

  private generateMarkdown(data: InstagramCaptureData): string {
    let md = '# Instagram Post by ' + data.author + '\n\n';
    md += '> **Username**: ' + (data.headline || 'N/A') + '\n';
    md += '> **Posted**: ' + data.dateText + '\n';
    md += '> **Source URL**: [View original post](' + data.url + ')\n\n';
    md += '## Caption Content\n\n' + data.body + '\n\n';
    if (data.images.length) {
      md += '## Captured Media\n\n';
      data.images.forEach((img, i) => { md += '![Image ' + (i+1) + '](' + img + ')\n\n'; });
    }
    if (data.comments.length) {
      md += '## Top Comments\n\n';
      data.comments.forEach(c => { md += '### ' + c.author + '\n> ' + c.text.replace(/\n/g, '\n> ') + '\n\n'; });
    }
    md += '---\n*Generated by BatiFlow v1.0 CDP Agent on ' + new Date().toLocaleDateString() + '*';
    return md;
  }
}
