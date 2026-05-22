import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CdpClient } from '../../cdp/CdpClient';

export interface XCaptureData {
  url: string;
  author: string;
  headline: string; // Will store the user's @handle
  dateText: string;
  body: string;
  images: string[];
  comments: Array<{
    author: string;
    text: string;
  }>;
}

export interface XCaptureResult {
  success: boolean;
  scrapPath?: string;
  data?: XCaptureData;
  trace: {
    steps: string[];
    timestamp: string;
    durationMs: number;
  };
}

export class XCapture {
  private client: CdpClient;
  private scrapBaseDir: string;

  constructor(client: CdpClient, scrapBaseDir?: string) {
    this.client = client;
    this.scrapBaseDir = scrapBaseDir || path.join(__dirname, '../../../../scrap');
  }

  /**
   * Performs high-fidelity tweet capture.
   */
  public async capture(url: string, hasSeeMore: boolean): Promise<XCaptureResult> {
    const startTime = Date.now();
    const steps: string[] = [];
    steps.push('X capture initialized');

    try {
      // 1. Click "Show more" if long tweet is detected
      if (hasSeeMore) {
        console.log('[XCapture] Long tweet "Show more" button detected. Expanding...');
        steps.push('Attempting to expand long tweet text');
        
        const clicked = await this.client.evaluate<boolean>(`
          (() => {
            const buttons = Array.from(document.querySelectorAll('span, div, [role="button"]'));
            const seeMore = buttons.find(el => el.textContent === 'Show more' || el.textContent === '더 보기');
            if (seeMore) {
              seeMore.click();
              return true;
            }
            return false;
          })()
        `);
        
        if (clicked) {
          steps.push('Successfully expanded long tweet text');
          console.log('[XCapture] Expanded "Show more" successfully.');
        } else {
          steps.push('Failed to click Show more button or button not found');
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      // 2. Perform gentle scrolls to load lazy media and comments/replies
      console.log('[XCapture] Scrolling to load comments and media...');
      steps.push('Triggering lazy-load scrolls');
      await this.client.evaluate(`
        window.scrollBy({ top: 600, behavior: 'smooth' });
      `);
      await new Promise(resolve => setTimeout(resolve, 1500));
      await this.client.evaluate(`
        window.scrollBy({ top: -600, behavior: 'smooth' });
      `);
      await new Promise(resolve => setTimeout(resolve, 500));

      // 3. Extract high-fidelity structured data
      console.log('[XCapture] Extracting Tweet DOM metadata...');
      steps.push('Running DOM extraction script');
      const rawData = await this.client.evaluate<XCaptureData>(`
        (() => {
          const articles = Array.from(document.querySelectorAll('article'));
          const mainArticle = articles[0] || document.querySelector('[data-testid="tweet"]') || document;
          
          // 1. Resolve Author & Handle
          let author = 'Unknown Author';
          let handle = '';
          const userNameEl = mainArticle.querySelector('[data-testid="User-Name"]');
          if (userNameEl) {
            const spans = Array.from(userNameEl.querySelectorAll('span'));
            if (spans.length > 0) {
              author = spans[0].textContent.trim();
            }
            const handleSpan = spans.find(s => s.textContent && s.textContent.startsWith('@'));
            if (handleSpan) {
              handle = handleSpan.textContent.trim();
            }
          }
          
          if (author === 'Unknown Author') {
            // Fallback: check other User-Name on page
            const fallbackUserName = document.querySelector('[data-testid="User-Name"]');
            if (fallbackUserName) {
              const spans = Array.from(fallbackUserName.querySelectorAll('span'));
              if (spans.length > 0) author = spans[0].textContent.trim();
              const handleSpan = spans.find(s => s.textContent && s.textContent.startsWith('@'));
              if (handleSpan) handle = handleSpan.textContent.trim();
            }
          }

          // 2. Resolve Timestamp
          const timeEl = mainArticle.querySelector('time');
          const dateText = timeEl ? (timeEl.getAttribute('datetime') || timeEl.textContent.trim()) : 'Recent';

          // 3. Resolve Tweet Body
          const textEl = mainArticle.querySelector('[data-testid="tweetText"]');
          let body = textEl ? textEl.innerText.trim() : 'No content';

          // 4. Resolve Images
          const imgElements = mainArticle.querySelectorAll('[data-testid="tweetPhoto"] img, img');
          const images = [];
          imgElements.forEach((img) => {
            const src = img.getAttribute('src') || '';
            if (src && src.includes('/media/') && !src.includes('profile_images') && !images.includes(src)) {
              // Normalize image size parameter to high quality
              try {
                const urlObj = new URL(src);
                urlObj.searchParams.set('name', 'large');
                images.push(urlObj.toString());
              } catch (e) {
                images.push(src);
              }
            }
          });

          // 5. Resolve Threaded Replies (excluding main article)
          const comments = [];
          articles.slice(1).forEach((art) => {
            const cUserEl = art.querySelector('[data-testid="User-Name"]');
            const cTextEl = art.querySelector('[data-testid="tweetText"]');
            if (cUserEl && cTextEl) {
              const cSpans = Array.from(cUserEl.querySelectorAll('span'));
              const cAuthor = cSpans.length > 0 ? cSpans[0].textContent.trim() : 'Anonymous';
              comments.push({
                author: cAuthor,
                text: cTextEl.innerText.trim()
              });
            }
          });

          return {
            url: window.location.href,
            author,
            headline: handle || author,
            dateText,
            body,
            images,
            comments
          };
        })()
      `);

      steps.push('DOM metadata successfully extracted');

      // 4. Clean Tweet Body (Reality-Checker principles)
      let cleanedBody = rawData.body ? rawData.body.trim() : 'No content';

      // 4.1 Remove trailing photo/video media shortlinks (e.g. t.co / pic.twitter.com)
      const picTwitterRegex = /pic\.twitter\.com\/[a-zA-Z0-9]+/g;
      if (picTwitterRegex.test(cleanedBody)) {
        console.log('[XCapture] Reality Checker trimmed media shortlinks from tweet body');
        cleanedBody = cleanedBody.replace(picTwitterRegex, '').trim();
      }

      const tCoRegex = /https:\/\/t\.co\/[a-zA-Z0-9]+/g;
      if (tCoRegex.test(cleanedBody)) {
        console.log('[XCapture] Reality Checker trimmed t.co shortlinks from tweet body');
        cleanedBody = cleanedBody.replace(tCoRegex, '').trim();
      }

      // 4.2 Clean "Translate post" interactive noise
      const translateNoise = /Translate post/i;
      cleanedBody = cleanedBody.replace(translateNoise, '').trim();

      const data: XCaptureData = {
        ...rawData,
        body: cleanedBody
      };

      // 5. Generate beautiful Markdown
      const markdown = this.generateMarkdown(data);
      steps.push('Formatted extraction to GFM Markdown');

      // 6. Save artifacts to scrap directory YYYYMMDD-x-uuid
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const uuid = crypto.randomUUID().slice(0, 8);
      const folderName = `${dateStr}-x-${uuid}`;
      const scrapPath = path.join(this.scrapBaseDir, folderName);

      if (!fs.existsSync(scrapPath)) {
        fs.mkdirSync(scrapPath, { recursive: true });
      }

      fs.writeFileSync(path.join(scrapPath, 'post.md'), markdown, 'utf8');
      fs.writeFileSync(path.join(scrapPath, 'extraction.json'), JSON.stringify(data, null, 2), 'utf8');

      steps.push(`Saved artifacts to directory: ${folderName}`);
      console.log(`[XCapture] Saved raw scrap to ${scrapPath}`);

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
      console.error('[XCapture] Scraper capture crashed:', err);
      const durationMs = Date.now() - startTime;
      steps.push(`Scraper crashed: ${err.message}`);
      
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

  /**
   * Helper to format parsed X tweet structure to beautiful markdown.
   */
  private generateMarkdown(data: XCaptureData): string {
    let md = `# Tweet by ${data.author}\n\n`;
    
    md += `> **Handle**: ${data.headline || 'N/A'}\n`;
    md += `> **Posted**: ${data.dateText}\n`;
    md += `> **Source URL**: [View original post](${data.url})\n\n`;
    
    md += `## Tweet Content\n\n`;
    md += `${data.body}\n\n`;

    if (data.images.length > 0) {
      md += `## Captured Media\n\n`;
      data.images.forEach((img, idx) => {
        md += `![Captured Image ${idx + 1}](${img})\n\n`;
      });
    }

    if (data.comments.length > 0) {
      md += `## Thread Replies\n\n`;
      data.comments.forEach((c) => {
        md += `### ${c.author}\n`;
        md += `> ${c.text.replace(/\n/g, '\n> ')}\n\n`;
      });
    }

    md += `---\n*Generated by BatiFlow v1.0 CDP Agent on ${new Date().toLocaleDateString()}*`;
    return md;
  }
}
