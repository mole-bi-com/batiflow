import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CdpClient } from '../../cdp/CdpClient';

export interface ThreadsCaptureData {
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

export interface ThreadsCaptureResult {
  success: boolean;
  scrapPath?: string;
  data?: ThreadsCaptureData;
  trace: {
    steps: string[];
    timestamp: string;
    durationMs: number;
  };
}

export class ThreadsCapture {
  private client: CdpClient;
  private scrapBaseDir: string;

  constructor(client: CdpClient, scrapBaseDir?: string) {
    this.client = client;
    this.scrapBaseDir = scrapBaseDir || path.join(__dirname, '../../../../scrap');
  }

  /**
   * Performs high-fidelity Threads capture.
   */
  public async capture(url: string, hasSeeMore: boolean = false): Promise<ThreadsCaptureResult> {
    const startTime = Date.now();
    const steps: string[] = [];
    steps.push('Threads capture initialized');

    try {
      console.log('[ThreadsCapture] Scrolling page to load lazy media and replies...');
      steps.push('Scrolling page to load lazy content');
      await this.client.evaluate('window.scrollBy({ top: 500, behavior: "smooth" })');
      await new Promise(resolve => setTimeout(resolve, 1500));
      await this.client.evaluate('window.scrollBy({ top: -500, behavior: "smooth" })');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Extract details
      console.log('[ThreadsCapture] Extracting Threads post DOM metadata...');
      steps.push('Running Threads DOM extraction');
      const data = await this.client.evaluate<ThreadsCaptureData>(`
        (() => {
          const links = Array.from(document.querySelectorAll('a'));
          const pageText = document.body ? document.body.innerText : "";

          // Resolve main post card elements (usually the first text card / main article)
          let author = 'Unknown Author';
          const authorEl = document.querySelector('h2, span[class*="author"], a[href*="/@"] span');
          if (authorEl) {
            author = authorEl.textContent.trim();
          }

          // Resolve timestamp
          let dateText = 'Recent';
          const timeEl = document.querySelector('time');
          if (timeEl) {
            dateText = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
          }

          // Resolve body
          let body = 'No content';
          const bodyEl = document.querySelector('div[class*="body"], span[class*="text"], p');
          if (bodyEl) {
            body = bodyEl.innerText.trim();
          }

          // Resolve images
          const images = [];
          const imgElements = document.querySelectorAll('img');
          imgElements.forEach(img => {
            const src = img.getAttribute('src');
            const w = img.clientWidth || parseInt(img.getAttribute('width') || '0');
            if (src && !src.includes('profile') && w > 150 && !images.includes(src)) {
              images.push(src);
            }
          });

          // Resolve replies/comments
          const comments = [];
          const cards = Array.from(document.querySelectorAll('div[role="article"], div[class*="card"]')).slice(1);
          cards.forEach(card => {
            const cAuthorEl = card.querySelector('a[href*="/@"], span[class*="author"]');
            const cTextEl = card.querySelector('span[class*="text"], p');
            if (cAuthorEl && cTextEl && cAuthorEl.textContent !== author) {
              comments.push({
                author: cAuthorEl.textContent.trim(),
                text: cTextEl.innerText.trim()
              });
            }
          });

          return {
            url: window.location.href,
            author,
            headline: '@' + author.toLowerCase().replace(/\\s+/g, ''),
            dateText,
            body,
            images,
            comments
          };
        })()
      `);

      steps.push('Threads DOM metadata successfully extracted');

      // Generate markdown
      const markdown = this.generateMarkdown(data);
      steps.push('Formatted extraction to GFM Markdown');

      // Save artifacts to scrap
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const uuid = crypto.randomUUID().slice(0, 8);
      const folderName = `${dateStr}-threads-${uuid}`;
      const scrapPath = path.join(this.scrapBaseDir, folderName);

      if (!fs.existsSync(scrapPath)) {
        fs.mkdirSync(scrapPath, { recursive: true });
      }

      fs.writeFileSync(path.join(scrapPath, 'post.md'), markdown, 'utf8');
      fs.writeFileSync(path.join(scrapPath, 'extraction.json'), JSON.stringify(data, null, 2), 'utf8');

      steps.push(`Saved artifacts to directory: ${folderName}`);
      console.log(`[ThreadsCapture] Saved raw scrap to ${scrapPath}`);

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
      console.error('[ThreadsCapture] Capture crashed:', err);
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

  private generateMarkdown(data: ThreadsCaptureData): string {
    let md = `# Threads Post by ${data.author}\n\n`;
    md += `> **Handle**: ${data.headline || 'N/A'}\n`;
    md += `> **Posted**: ${data.dateText}\n`;
    md += `> **Source URL**: [View original post](${data.url})\n\n`;
    
    md += `## Content\n\n`;
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
