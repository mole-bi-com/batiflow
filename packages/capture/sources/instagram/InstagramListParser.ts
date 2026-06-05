import { CdpClient } from '../../cdp/CdpClient';

export function normalizeInstagramPostUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const match = url.pathname.match(/^\/(?:saved\/)?(p|reel)\/([^/]+)/);
    if (!match) {
      return null;
    }
    return `${url.origin}/${match[1]}/${match[2]}/`;
  } catch (e) {
    return null;
  }
}

export class InstagramListParser {
  private client: CdpClient;

  constructor(client: CdpClient) {
    this.client = client;
  }

  /**
   * Navigates to saved page and scrapes post URLs.
   */
  public async parseList(url: string = 'https://www.instagram.com/saved/'): Promise<string[]> {
    console.log(`[InstagramListParser] Navigating to list page: ${url}...`);
    await this.client.navigate(url);
    
    // Wait for page load
    await new Promise(resolve => setTimeout(resolve, 4000));

    // Scroll grid to load more items
    console.log('[InstagramListParser] Scrolling saved grid to load lazy entries...');
    for (let i = 0; i < 3; i++) {
      await this.client.evaluate('window.scrollBy({ top: 1000, behavior: "smooth" })');
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    await this.client.evaluate('window.scrollTo({ top: 0 })');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Extract URLs matching /p/ or /reel/
    const urls = await this.client.evaluate<string[]>(`
      (() => {
        const links = Array.from(document.querySelectorAll('a'));
        const resolved = links
          .map(a => a.href)
          .filter(href => {
            return href.includes('/p/') || href.includes('/reel/');
          })
          .map(href => {
            try {
              const urlObj = new URL(href);
              return urlObj.origin + urlObj.pathname;
            } catch (e) {
              return href;
            }
          });
        return Array.from(new Set(resolved));
      })()
    `);

    const normalizedUrls = Array.from(
      new Set(urls.map(normalizeInstagramPostUrl).filter((url): url is string => Boolean(url)))
    );

    console.log(`[InstagramListParser] Extracted ${normalizedUrls.length} unique post URLs from Instagram Saved.`);
    return normalizedUrls;
  }
}
