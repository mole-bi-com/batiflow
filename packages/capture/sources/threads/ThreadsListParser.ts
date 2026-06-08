/**
 * ThreadsListParser
 *
 * Collects posts from the Threads Following feed (chronological),
 * extracts each post's URL + visible text preview + <time> datetime,
 * and filters to only posts within the last 24 hours.
 *
 * Mirrors the X home‑timeline approach so both platforms use the same
 * AI‑driven relevance pipeline.
 */

export interface ThreadsTimelineEntry {
  url: string;
  textPreview: string;
  author: string;
  datetime: string;
}

import { CdpClient } from '../../cdp/CdpClient';

export class ThreadsListParser {
  private client: CdpClient;

  constructor(client: CdpClient) {
    this.client = client;
  }

  public async parseList(_url?: string): Promise<ThreadsTimelineEntry[]> {
    console.log('[ThreadsListParser] Navigating to Threads Following feed...');
    await this.client.navigate('https://www.threads.net/');
    await new Promise(resolve => setTimeout(resolve, 6000)); // Full page load incl. JS hydration

    // --- Try to activate "Following" tab ---
    try {
      const clicked = await this.client.evaluate<boolean>(`
        (() => {
          // Threads uses a role="tablist" with two tabs: "For you" / "Following"
          const tablist = document.querySelector('[role="tablist"]');
          if (!tablist) return false;
          const tabs = tablist.querySelectorAll('[role="tab"]');
          for (const tab of tabs) {
            const text = tab.textContent?.toLowerCase().trim() || '';
            if (text === 'following' || text.includes('following')) {
              tab.click();
              return true;
            }
          }
          // Fallback: look for any element containing "Following"
          const all = document.querySelectorAll('span, div, a');
          for (const el of all) {
            if (el.textContent?.trim() === 'Following' && el instanceof HTMLElement) {
              el.click();
              return true;
            }
          }
          return false;
        })()
      `);
      console.log(`[ThreadsListParser] Following tab click: ${clicked ? '✓' : '✗ (defaulting to For You)'}`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch {
      console.log('[ThreadsListParser] Could not click Following tab, using current feed.');
    }

    // --- Scroll to load more entries ---
    console.log('[ThreadsListParser] Scrolling feed to load posts...');
    for (let i = 0; i < 6; i++) {
      await this.client.evaluate('window.scrollBy(0, 1200)');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    await this.client.evaluate('window.scrollTo({ top: 0 })');
    await new Promise(resolve => setTimeout(resolve, 500));

    // --- Extract posts with URL + text preview + datetime ---
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    const rawEntries = await this.client.evaluate<string>(`
      (() => {
        const threshold = ${twentyFourHoursAgo};
        const results = [];

        // Threads articles usually have role="article" inside the main timeline
        const articles = document.querySelectorAll('[role="article"]');
        for (const art of articles) {
          // --- Extract post URL ---
          const link = art.querySelector('a[href*="/post/"]');
          if (!link) continue;
          let href = link.href || '';
          if (!href.includes('/post/')) continue;
          // Canonicalise: strip query params
          try {
            const u = new URL(href);
            href = u.origin + u.pathname;
          } catch {}

          // --- Extract timestamp from <time> element ---
          const timeEl = art.querySelector('time');
          if (!timeEl) continue;
          const datetime = timeEl.getAttribute('datetime');
          if (!datetime) continue;
          const ts = new Date(datetime).getTime();
          if (isNaN(ts) || ts < threshold) continue;

          // --- Extract author handle ---
          let author = 'Unknown';
          const authorLink = art.querySelector('a[href^="/"]');
          if (authorLink && authorLink.textContent) {
            author = authorLink.textContent.trim();
          }

          // --- Extract visible text preview (first ~200 chars of the post body) ---
          const textEls = art.querySelectorAll('span, div');
          let textPreview = '';
          for (const el of textEls) {
            const t = (el.textContent || '').trim();
            if (t.length > 20 && !t.startsWith('http') && el.closest('[role="article"]')) {
              textPreview = t.slice(0, 200);
              break;
            }
          }

          results.push(JSON.stringify({
            url: href,
            textPreview: textPreview || '(no text extracted)',
            author: author,
            datetime: datetime
          }));
        }
        return JSON.stringify(results);
      })()
    `);

    let entries: ThreadsTimelineEntry[] = [];
    try {
      const parsed = JSON.parse(rawEntries);
      entries = parsed.map((s: string) => JSON.parse(s));
    } catch {
      console.error('[ThreadsListParser] Failed to parse extracted entries.');
      entries = [];
    }

    console.log(`[ThreadsListParser] Extracted ${entries.length} posts from Following feed (24h window).`);
    return entries;
  }
}
