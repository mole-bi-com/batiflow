import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CaptureResult, CaptureData } from '../sources/linkedin/LinkedInCapture';

export class PlaywrightCapture {
  private scrapBaseDir: string;

  constructor(scrapBaseDir?: string) {
    this.scrapBaseDir = scrapBaseDir || path.join(__dirname, '../../../../scrap');
  }

  /**
   * Executes a headless Playwright scraper run.
   */
  public async capture(url: string): Promise<CaptureResult> {
    console.log(`[PlaywrightCapture] Initiating Playwright headless fallback for ${url}...`);
    const startTime = Date.now();
    const steps: string[] = ['Playwright Fallback initiated'];

    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      steps.push('Playwright headless Chromium launched');
      
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });
      const page = await context.newPage();
      
      steps.push(`Navigating to ${url}`);
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      
      // Wait for essential DOM structures
      await page.waitForTimeout(3000);
      steps.push('Page loaded, resolving elements');

      // Click "See more" if visible
      const showMoreButton = page.locator('button.feed-shared-inline-show-more-text__button, button.feed-shared-text-view-more-button').first();
      if (await showMoreButton.isVisible()) {
        await showMoreButton.click();
        steps.push('Clicked Show More button');
        await page.waitForTimeout(1500);
      }

      // Extract basic elements based on active platform
      const data: CaptureData = await page.evaluate((currentUrl) => {
        let author = 'Unknown Author';
        let headline = '';
        let dateText = 'Recent';
        let body = 'No content extracted';
        const images: string[] = [];

        if (currentUrl.includes('x.com') || currentUrl.includes('twitter.com')) {
          // X / Twitter selectors
          const userNameEl = document.querySelector('[data-testid="User-Name"]');
          if (userNameEl) {
            const spans = Array.from(userNameEl.querySelectorAll('span'));
            if (spans.length > 0) {
              author = spans[0].textContent.trim();
            }
            const handleSpan = spans.find(s => s.textContent && s.textContent.startsWith('@'));
            if (handleSpan) {
              headline = handleSpan.textContent.trim();
            }
          }
          const textEl = document.querySelector('[data-testid="tweetText"]');
          if (textEl) {
            body = (textEl as any).innerText.trim();
          }
          const imgElements = document.querySelectorAll('[data-testid="tweetPhoto"] img, img');
          imgElements.forEach((img) => {
            const src = img.getAttribute('src');
            if (src && src.includes('/media/') && !src.includes('profile_images') && !images.includes(src)) {
              images.push(src);
            }
          });
        } else if (currentUrl.includes('threads.net') || currentUrl.includes('threads.com')) {
          // Threads selectors
          const urlMatch = currentUrl.match(/\/@([a-zA-Z0-9_.-]+)/);
          if (urlMatch && urlMatch[1]) {
            author = urlMatch[1];
          } else {
            const authorEl = document.querySelector('a[href*="/@"] span, span[class*="author"]');
            if (authorEl) {
              author = authorEl.textContent.trim();
            }
          }
          headline = '@' + author.toLowerCase().replace(/\s+/g, '');
          const timeEl = document.querySelector('time');
          if (timeEl) {
            dateText = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
          }

          // Use reaction row leaf-node layout parser
          const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
          let firstReactionRow = null;
          for (const btn of buttons) {
            const text = btn.textContent ? btn.textContent.trim().toLowerCase() : '';
            if (text.startsWith('like') || text.startsWith('unlike') || text.startsWith('reply') || text.startsWith('repost')) {
              firstReactionRow = btn;
              break;
            }
          }
          
          const allElements = Array.from(document.querySelectorAll('span, div, p'));
          const candidates = [];
          for (const el of allElements) {
            if (firstReactionRow && (firstReactionRow === el || firstReactionRow.contains(el) || (el.compareDocumentPosition(firstReactionRow) & Node.DOCUMENT_POSITION_FOLLOWING) === 0)) {
              break;
            }
            if (el.children.length > 1) continue;
            const text = el.textContent ? el.textContent.trim() : '';
            if (text && text.length > 0 && text.length < 1500) {
              const lower = text.toLowerCase();
              if (lower === author.toLowerCase() || lower === 'more' || lower === 'follow' || lower.includes('for you') || lower.includes('search') || lower.includes('profile')) {
                continue;
              }
              candidates.push(text);
            }
          }
          let bestText = '';
          for (const cand of candidates) {
            if (cand.length > bestText.length) {
              bestText = cand;
            }
          }
          body = bestText || 'No content';

          const imgElements = document.querySelectorAll('img');
          imgElements.forEach((img) => {
            const src = img.getAttribute('src');
            if (src && !src.includes('profile') && !images.includes(src)) {
              images.push(src);
            }
          });
        } else {
          // LinkedIn selectors
          const authorEl = document.querySelector('.update-components-actor__name, .update-components-actor__title span[aria-hidden="true"]');
          author = authorEl ? authorEl.textContent.trim() : 'Unknown Author';

          const headlineEl = document.querySelector('.update-components-actor__description');
          headline = headlineEl ? headlineEl.textContent.trim() : '';

          const dateEl = document.querySelector('.update-components-actor__sub-text span[aria-hidden="true"]');
          dateText = dateEl ? dateEl.textContent.trim() : 'Recent';

          const bodyEl = document.querySelector('.feed-shared-update-v2__description-wrapper, .feed-shared-inline-show-more-text');
          body = bodyEl ? (bodyEl as any).innerText.trim() : 'No content extracted';

          const imgElements = document.querySelectorAll('.update-components-image__image, .update-components-article__image img');
          imgElements.forEach((img) => {
            const src = img.getAttribute('src');
            if (src) images.push(src);
          });
        }

        return {
          url: window.location.href,
          author,
          headline,
          dateText,
          body,
          images,
          comments: []
        };
      }, url);

      steps.push('Basic content extracted');

      // Write markdown
      const markdown = `
# LinkedIn Post by ${data.author} (Playwright Fallback)

> **Author Headline**: ${data.headline || 'N/A'}
> **Posted**: ${data.dateText}
> **Source URL**: [View original post](${data.url})

## Post Content

${data.body}

${data.images.length > 0 ? `## Captured Media\n\n` + data.images.map((img, idx) => `![Captured Image ${idx + 1}](${img})`).join('\n\n') : ''}

---
*Generated by BatiFlow v1.0 Playwright Fallback Scraper on ${new Date().toLocaleDateString()}*
`;

      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const uuid = crypto.randomUUID().slice(0, 8);
      const folderName = `${dateStr}-fallback-${uuid}`;
      const scrapPath = path.join(this.scrapBaseDir, folderName);

      if (!fs.existsSync(scrapPath)) {
        fs.mkdirSync(scrapPath, { recursive: true });
      }

      fs.writeFileSync(path.join(scrapPath, 'post.md'), markdown, 'utf8');
      fs.writeFileSync(path.join(scrapPath, 'extraction.json'), JSON.stringify(data, null, 2), 'utf8');
      steps.push(`Saved fallback scrap to: ${folderName}`);

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
      console.error('[PlaywrightCapture] Fallback scraper crashed:', err);
      const durationMs = Date.now() - startTime;
      steps.push(`Fallback scraper crashed: ${err.message}`);
      
      return {
        success: false,
        trace: {
          steps,
          timestamp: new Date().toISOString(),
          durationMs
        }
      };
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}
