import { CdpClient } from '../../cdp/CdpClient';

export class ThreadsListParser {
  private client: CdpClient;

  constructor(client: CdpClient) {
    this.client = client;
  }

  public async parseList(url: string = 'https://www.threads.com/liked'): Promise<string[]> {
    console.log(`[ThreadsListParser] Navigating directly to Threads Liked feed: ${url}...`);
    await this.client.navigate(url);
    
    // Wait for feed to load
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Scroll
    console.log('[ThreadsListParser] Scrolling list to load lazy entries...');
    for (let i = 0; i < 3; i++) {
      await this.client.evaluate('window.scrollBy(0, 1000)');
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    await this.client.evaluate('window.scrollTo({ top: 0 })');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Extract URLs containing /post/
    const urls = await this.client.evaluate<string[]>(`
      (() => {
        const links = Array.from(document.querySelectorAll('a'));
        const resolved = links
          .map(a => a.href)
          .filter(href => {
            return href.includes('/post/');
          })
          .map(href => {
            try {
              const match = href.match(/https?:\\/\\/(?:www\\.)?threads\\.(?:net|com)\\/@[^\\/]+\\/post\\/[a-zA-Z0-9_-]+/);
              const canonical = match ? match[0] : href;
              const urlObj = new URL(canonical);
              return urlObj.origin + urlObj.pathname;
            } catch (e) {
              return href;
            }
          });
        return Array.from(new Set(resolved));
      })()
    `);

    console.log(`[ThreadsListParser] Extracted ${urls.length} unique post URLs from Threads Likes.`);
    return urls;
  }
}
