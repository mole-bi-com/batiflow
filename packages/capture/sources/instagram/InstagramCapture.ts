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
  comments: Array<{
    author: string;
    text: string;
  }>;
}

export interface InstagramCaptureResult {
  success: boolean;
  scrapPath?: string;
  data?: InstagramCaptureData;
  trace: {
    steps: string[];
    timestamp: string;
    durationMs: number;
  };
}

export class InstagramCapture {
  private client: CdpClient;
  private scrapBaseDir: string;

  constructor(client: CdpClient, scrapBaseDir?: string) {
    this.client = client;
    this.scrapBaseDir = scrapBaseDir || path.join(__dirname, '../../../../scrap');
  }

  /**
   * Performs high-fidelity Instagram capture.
   */
  public async capture(url: string, hasSeeMore: boolean = false): Promise<InstagramCaptureResult> {
    const startTime = Date.now();
    const steps: string[] = [];
    steps.push('Instagram capture initialized');

    try {
      console.log('[InstagramCapture] Scrolling page to trigger image assets and comments...');
      steps.push('Executing scroll actions');
      await this.client.evaluate('window.scrollBy({ top: 500, behavior: "smooth" })');
      await new Promise(resolve => setTimeout(resolve, 1500));
      await this.client.evaluate('window.scrollBy({ top: -500, behavior: "smooth" })');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Extract details
      console.log('[InstagramCapture] Extracting Instagram post DOM metadata...');
      steps.push('Executing Instagram DOM extraction');
      const data = await this.client.evaluate<InstagramCaptureData>(`
        (() => {
          // Instagram DOM structures vary, but the main post elements are inside article or main containers
          let author = 'Unknown Instagrammer';
          const authorEl = document.querySelector('h1 a, header a, span[class*="author"] a, a[href*="/"] font, a[href*="/"] b');
          if (authorEl) {
            author = authorEl.textContent.trim();
          } else {
            const possibleAuthors = Array.from(document.querySelectorAll('a[href*="/"]')).filter(a => {
              const text = a.textContent.trim();
              return text && text.length > 2 && text.length < 30 && !text.includes(' ') && !text.includes('/');
            });
            if (possibleAuthors.length > 0) author = possibleAuthors[0].textContent.trim();
          }

          // Resolve caption
          let body = 'No content';
          const captionEl = document.querySelector('h1, h2, span[class*="caption"], div[class*="caption"]');
          if (captionEl) {
            body = captionEl.innerText.trim();
          } else {
            // Find first comment container text (Instagram lists caption as the first comment block)
            const possibleCaptions = Array.from(document.querySelectorAll('ul li div div span')).map(s => s.innerText);
            if (possibleCaptions.length > 0) body = possibleCaptions[0].trim();
          }

          // Resolve images/videos
          const images = [];
          const imgElements = document.querySelectorAll('article img, img');
          imgElements.forEach(img => {
            const src = img.getAttribute('src');
            const w = img.clientWidth || parseInt(img.getAttribute('width') || '0');
            if (src && !src.includes('profile') && w > 200 && !images.includes(src)) {
              images.push(src);
            }
          });

          // Resolve comments
          const comments = [];
          const commentElements = Array.from(document.querySelectorAll('ul li')).slice(1);
          commentElements.forEach(item => {
            const cAuthorEl = item.querySelector('a, h2, h3');
            const cTextEl = item.querySelector('span');
            if (cAuthorEl && cTextEl && cAuthorEl.textContent.trim() !== author) {
              comments.push({
                author: cAuthorEl.textContent.trim(),
                text: cTextEl.innerText.trim()
              });
            }
          });

          return {
            url: window.location.href,
            author,
            headline: '@' + author.toLowerCase(),
            dateText: 'Recent',
            body,
            images,
            comments
          };
        })()
      `);

      steps.push('Instagram DOM metadata successfully extracted');

      // Generate markdown
      const markdown = this.generateMarkdown(data);
      steps.push('Formatted extraction to GFM Markdown');

      // Save artifacts to scrap
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const uuid = crypto.randomUUID().slice(0, 8);
      const folderName = `${dateStr}-instagram-${uuid}`;
      const scrapPath = path.join(this.scrapBaseDir, folderName);

      if (!fs.existsSync(scrapPath)) {
        fs.mkdirSync(scrapPath, { recursive: true });
      }

      fs.writeFileSync(path.join(scrapPath, 'post.md'), markdown, 'utf8');
      fs.writeFileSync(path.join(scrapPath, 'extraction.json'), JSON.stringify(data, null, 2), 'utf8');

      steps.push(`Saved artifacts to directory: ${folderName}`);
      console.log(`[InstagramCapture] Saved raw scrap to ${scrapPath}`);

      const durationMs = Date.now() - startTime;
      return {
        success: true,
        scrapPath,
        data,
        trace: {
          steps,
          timestamp: new Date().toISOString(),
          durationMs
        }
      };

    } catch (err: any) {
      console.error('[InstagramCapture] Capture crashed:', err);
      const durationMs = Date.now() - startTime;
      steps.push(`Capture crashed: ${err.message}`);
      
      return {
        success: false,
        trace: {
          steps,
          timestamp: new Date().toISOString(),
          durationMs
        }
      };
    }
  }

  private generateMarkdown(data: InstagramCaptureData): string {
    let md = `# Instagram Post by ${data.author}\n\n`;
    md += `> **Username**: ${data.headline || 'N/A'}\n`;
    md += `> **Posted**: ${data.dateText}\n`;
    md += `> **Source URL**: [View original post](${data.url})\n\n`;
    
    md += `## Caption Content\n\n`;
    md += `${data.body}\n\n`;

    if (data.images.length > 0) {
      md += `## Captured Media\n\n`;
      data.images.forEach((img, idx) => {
        md += `![Captured Image ${idx + 1}](${img})\n\n`;
      });
    }

    if (data.comments.length > 0) {
      md += `## Top Comments\n\n`;
      data.comments.forEach((c) => {
        md += `### ${c.author}\n`;
        md += `> ${c.text.replace(/\n/g, '\n> ')}\n\n`;
      });
    }

    md += `---\n*Generated by BatiFlow v1.0 CDP Agent on ${new Date().toLocaleDateString()}*`;
    return md;
  }
}
