import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CdpClient } from '../../cdp/CdpClient';

export interface CaptureData {
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

export interface CaptureResult {
  success: boolean;
  scrapPath?: string;
  data?: CaptureData;
  trace: {
    steps: string[];
    timestamp: string;
    durationMs: number;
  };
}

export class LinkedInCapture {
  private client: CdpClient;
  private scrapBaseDir: string;

  constructor(client: CdpClient, scrapBaseDir?: string) {
    this.client = client;
    this.scrapBaseDir = scrapBaseDir || path.join(__dirname, '../../../../scrap');
  }

  /**
   * Performs the high-fidelity capture workflow.
   */
  public async capture(url: string, hasSeeMore: boolean): Promise<CaptureResult> {
    const startTime = Date.now();
    const steps: string[] = [];
    steps.push('Capture initialized');

    try {
      // 1. Click "See More" if recon found it
      if (hasSeeMore) {
        console.log('[LinkedInCapture] Found "See more" button. Attempting click...');
        steps.push('Attempting click on See More button');
        
        const selectors = [
          'button.feed-shared-inline-show-more-text__button',
          'button.feed-shared-text-view-more-button',
          '.feed-shared-inline-show-more-text__button'
        ];

        let clicked = false;
        for (const selector of selectors) {
          clicked = await this.client.click(selector);
          if (clicked) {
            steps.push(`Clicked See More button using: ${selector}`);
            console.log(`[LinkedInCapture] Clicked show-more button using: ${selector}`);
            break;
          }
        }
        // Wait 1.5s for DOM expansion
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      // 2. Perform smooth scroll to trigger lazy loading of images
      console.log('[LinkedInCapture] Scrolling to load lazy assets...');
      steps.push('Triggering smooth scrolls for lazy assets');
      await this.client.evaluate(`
        window.scrollBy({ top: 500, behavior: 'smooth' });
      `);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await this.client.evaluate(`
        window.scrollBy({ top: -500, behavior: 'smooth' });
      `);
      await new Promise(resolve => setTimeout(resolve, 500));

      // 3. Extract high-fidelity structured data
      console.log('[LinkedInCapture] Running extraction script...');
      steps.push('Executing JSON metadata extraction');
      const rawData = await this.client.evaluate<CaptureData>(`
        (() => {
          const workspace = document.querySelector('#workspace, main, .main, [role="main"]') || document;
          const pageText = document.body ? document.body.innerText : "";

          // 1. Resolve Author Name
          let author = 'Unknown Author';
          const authorElements = Array.from(workspace.querySelectorAll('.update-components-actor__name, .update-components-actor__title span[aria-hidden="true"], span.hoverable-link-text, .update-components-actor__title'));
          
          const suspiciousNames = ['seungwoo lee', '이성원', 'visualcamp'];
          let foundName = '';
          
          for (const el of authorElements) {
            const nameText = el.textContent.trim().replace(/\\n/g, '').split('•')[0].trim();
            if (nameText && nameText.length < 100 && !suspiciousNames.some(sn => nameText.toLowerCase().includes(sn))) {
              foundName = nameText;
              break;
            }
          }
          
          if (foundName) {
            author = foundName;
          } else {
            // Try standard profile link fallback in workspace
            const links = Array.from(workspace.querySelectorAll('a[href*="/in/"]'));
            for (const link of links) {
              const text = link.textContent.trim().replace(/\\n/g, '').split('•')[0].trim();
              if (text && text.length < 100 && !suspiciousNames.some(sn => text.toLowerCase().includes(sn))) {
                author = text;
                break;
              }
            }
            // Last resort: first actor name
            if (author === 'Unknown Author' && authorElements.length > 0) {
              author = authorElements[0].textContent.trim().replace(/\\n/g, '').split('•')[0].trim();
            }
          }

          // 2. Resolve Actor Headline
          let headline = '';
          const headlineEl = workspace.querySelector('.update-components-actor__description');
          if (headlineEl) {
            headline = headlineEl.textContent.trim();
          } else {
            // Find around author link in single post page
            const authorLink = Array.from(workspace.querySelectorAll('a[href*="/in/"]')).find(el => el.textContent.includes(author));
            if (authorLink) {
              let sibling = authorLink.nextElementSibling || authorLink.parentElement?.nextElementSibling;
              if (sibling) {
                headline = sibling.textContent.trim();
              }
            }
          }

          // 3. Resolve Post Time
          const dateEl = workspace.querySelector('.update-components-actor__sub-text span[aria-hidden="true"], span[class*="sub-text"], span[class*="date"]');
          const dateText = dateEl ? dateEl.textContent.trim() : 'Recent';

          // 4. Resolve Body text
          let body = 'No content';
          const bodyEl = workspace.querySelector('.feed-shared-update-v2__description-wrapper, .feed-shared-inline-show-more-text, .cdb30203, p._9de931a4');
          if (bodyEl) {
            body = bodyEl.innerText.trim();
          } else {
            // Fallback for single post page: find the longest block of text inside paragraphs, spans, description containers
            const textContainers = Array.from(workspace.querySelectorAll('p, span[class*="text"], div[class*="description"]'));
            let maxLen = 0;
            let bestText = '';
            textContainers.forEach(el => {
              if (el.children.length > 3 && el.tagName === 'DIV') return; // Skip giant div containers
              const text = el.innerText ? el.innerText.trim() : '';
              if (text.length > maxLen && 
                  text.length < 5000 && 
                  !text.includes('Home') && 
                  !text.includes('Messaging') && 
                  !text.includes('Notifications') &&
                  !text.includes('SeungWoo Lee') &&
                  !text.includes('Visualcamp') &&
                  !text.includes('Skip to main')) {
                maxLen = text.length;
                bestText = text;
              }
            });
            if (bestText) body = bestText;
          }

          // 5. Resolve Images (highest resolution srcset) - filter out small icons and display photos
          const imgElements = workspace.querySelectorAll('.update-components-image__image, .update-components-article__image img, img');
          const images = [];
          imgElements.forEach((img) => {
            const w = img.clientWidth || parseInt(img.getAttribute('width') || '0');
            if (w > 0 && w < 100) return; // Skip icons
            
            const srcset = img.getAttribute('srcset');
            if (srcset) {
              const srcList = srcset.split(',').map(s => s.trim().split(' ')[0]);
              if (srcList.length > 0) {
                const largestSrc = srcList[srcList.length - 1];
                if (!largestSrc.includes('profile-displayphoto') && !images.includes(largestSrc)) {
                  images.push(largestSrc);
                  return;
                }
              }
            }
            const src = img.getAttribute('src');
            if (src && !src.includes('profile-displayphoto') && !images.includes(src)) {
              images.push(src);
            }
          });

          // 6. Resolve Comments
          const commentElements = workspace.querySelectorAll('.comments-comment-item, div[class*="comment-item"]');
          const comments = [];
          commentElements.forEach((item) => {
            const cAuthorEl = item.querySelector('.comments-post-meta__name-text, span[class*="name-text"]');
            const cTextEl = item.querySelector('.comments-comment-item-content-body, div[class*="comment-body"], div[class*="comment-content"]');
            if (cAuthorEl && cTextEl) {
              comments.push({
                author: cAuthorEl.textContent.trim(),
                text: cTextEl.innerText.trim()
              });
            }
          });

          return {
            url: window.location.href,
            author,
            headline,
            dateText,
            body,
            images,
            comments
          };
        })()
      `);

      steps.push('Metadata successfully extracted from DOM');

      // 3.5 Robust Post-Processing Cleanup Heuristics (Reality-Checker principles)
      let cleanedBody = rawData.body ? rawData.body.trim() : 'No content';
      
      // Automatic UI Footer Noise Truncation
      const footerPattern = /(?:Show translation|\d+\s+reactions|\d+\s+comments|\d+\s+reposts|Like\s+Comment\s+Repost\s+Send)/i;
      const footerMatch = cleanedBody.match(footerPattern);
      if (footerMatch && footerMatch.index !== undefined) {
        console.log(`[LinkedInCapture] Reality Checker trimmed UI footer noise starting at index ${footerMatch.index}`);
        steps.push(`Reality Checker trimmed UI footer noise from body`);
        cleanedBody = cleanedBody.substring(0, footerMatch.index).trim();
      }

      // Check if original author is embedded in body (e.g. reposter banner) and clean the body
      const repostBannerPattern = /^(?:Feed post|.*?reposted this|.*?공유했습니다)\s*/i;
      if (repostBannerPattern.test(cleanedBody)) {
        console.log(`[LinkedInCapture] Cleaning repost headers from body...`);
        cleanedBody = cleanedBody.replace(repostBannerPattern, '').trim();
      }

      const data: CaptureData = {
        ...rawData,
        body: cleanedBody
      };

      // 4. Generate beautiful, semantic Markdown file
      const markdown = this.generateMarkdown(data);
      steps.push('Formatted extraction to GFM Markdown');

      // 5. Save assets to scrap directory YYYYMMDD-linkedin-uuid
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const uuid = crypto.randomUUID().slice(0, 8);
      const folderName = `${dateStr}-linkedin-${uuid}`;
      const scrapPath = path.join(this.scrapBaseDir, folderName);

      if (!fs.existsSync(scrapPath)) {
        fs.mkdirSync(scrapPath, { recursive: true });
      }

      fs.writeFileSync(path.join(scrapPath, 'post.md'), markdown, 'utf8');
      fs.writeFileSync(path.join(scrapPath, 'extraction.json'), JSON.stringify(data, null, 2), 'utf8');

      steps.push(`Saved artifacts to directory: ${folderName}`);
      console.log(`[LinkedInCapture] Saved raw scrap to ${scrapPath}`);

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
      console.error('[LinkedInCapture] Scraper capture crashed:', err);
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
   * Helper to format parsed LinkedIn post structure to beautiful markdown.
   */
  private generateMarkdown(data: CaptureData): string {
    let md = `# LinkedIn Post by ${data.author}\n\n`;
    
    md += `> **Author Headline**: ${data.headline || 'N/A'}\n`;
    md += `> **Posted**: ${data.dateText}\n`;
    md += `> **Source URL**: [View original post](${data.url})\n\n`;
    
    md += `## Post Content\n\n`;
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
