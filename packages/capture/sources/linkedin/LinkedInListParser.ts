import { CdpClient } from '../../cdp/CdpClient';

export class LinkedInListParser {
  private client: CdpClient;

  constructor(client: CdpClient) {
    this.client = client;
  }

  /**
   * Navigates to saved items page and scrapes post URLs.
   */
  public async parseList(url: string = 'https://www.linkedin.com/my-items/saved-posts/'): Promise<string[]> {
    console.log(`[LinkedInListParser] Navigating to list page: ${url}...`);
    await this.client.navigate(url);
    
    // Wait for saved items list to load
    await new Promise(resolve => setTimeout(resolve, 4000));

    // Scroll list to load more entries
    console.log('[LinkedInListParser] Scrolling list to load lazy entries...');
    for (let i = 0; i < 3; i++) {
      await this.client.evaluate('window.scrollBy({ top: 1000, behavior: "smooth" })');
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    await this.client.evaluate('window.scrollTo({ top: 0 })');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Extract post URLs
    const urls = await this.client.evaluate<string[]>(`
      (() => {
        const links = Array.from(document.querySelectorAll('a'));
        const resolved = links
          .map(a => a.href)
          .filter(href => {
            return href.includes('/feed/update/urn:li:activity:') || href.includes('/posts/');
          })
          .map(href => {
            try {
              const urlObj = new URL(href);
              // Clean trackers
              const trackers = ['ref', 'trackingId', 'mini', 'lipi', 'licu', 'trk'];
              trackers.forEach(t => urlObj.searchParams.delete(t));
              return urlObj.origin + urlObj.pathname;
            } catch (e) {
              return href;
            }
          });
        return Array.from(new Set(resolved));
      })()
    `);

    console.log(`[LinkedInListParser] Extracted ${urls.length} unique post URLs from LinkedIn Saved Items.`);
    return urls;
  }
}
