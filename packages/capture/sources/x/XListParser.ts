import { CdpClient } from '../../cdp/CdpClient';

export class XListParser {
  private client: CdpClient;

  constructor(client: CdpClient) {
    this.client = client;
  }

  /**
   * Navigates to bookmarks or likes and scrapes list of tweet URLs.
   */
  public async parseList(url: string): Promise<string[]> {
    console.log(`[XListParser] Navigating to list page: ${url}...`);
    await this.client.navigate(url);
    
    // Wait for list container to load
    await new Promise(resolve => setTimeout(resolve, 4000));

    // Scroll to lazy load more items
    console.log('[XListParser] Scrolling list to load entries...');
    for (let i = 0; i < 3; i++) {
      await this.client.evaluate('window.scrollBy(0, 1200)');
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    await this.client.evaluate('window.scrollTo({ top: 0 })');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Extract status URLs
    const urls = await this.client.evaluate<string[]>(`
      (() => {
        const links = Array.from(document.querySelectorAll('a[href*="/status/"]'));
        const resolved = links
          .map(a => a.href)
          .filter(href => {
            try {
              const urlObj = new URL(href);
              const pathParts = urlObj.pathname.split('/').filter(Boolean);
              // Expecting format: /<username>/status/<numeric_id> — nothing after
              const statusIdx = pathParts.indexOf('status');
              if (statusIdx !== -1 && pathParts[statusIdx + 1]) {
                const id = pathParts[statusIdx + 1];
                const afterId = pathParts[statusIdx + 2];
                // Must be purely numeric ID, and nothing after (no analytics/photo/video)
                return /^[0-9]+$/.test(id) && !afterId;
              }
            } catch (e) {}
            return false;
          })
          .map(href => {
            // Strip query params and canonicalize
            const urlObj = new URL(href);
            return urlObj.origin + urlObj.pathname;
          });
        return Array.from(new Set(resolved));
      })()
    `);

    console.log(`[XListParser] Extracted ${urls.length} unique tweet URLs from page.`);
    return urls;
  }
}
