import { CdpClient } from '../cdp/CdpClient';

export interface YoutubePlaylistItem {
  url: string;
  title: string;
  channel: string;
  addedText: string;
}

export class YoutubePlaylistParser {
  private client: CdpClient;

  constructor(client: CdpClient) {
    this.client = client;
  }

  /**
   * Navigates to a YouTube playlist (Watch Later or a specific one) and extracts video details.
   */
  public async parseList(url: string = 'https://www.youtube.com/playlist?list=WL'): Promise<YoutubePlaylistItem[]> {
    console.log(`[YoutubePlaylistParser] Navigating to playlist: ${url}...`);
    await this.client.navigate(url);
    
    // Wait for list container to load (give Polymer some time)
    console.log('[YoutubePlaylistParser] Waiting for playlist container to render...');
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Scroll to lazy load more items
    console.log('[YoutubePlaylistParser] Scrolling list to load entries...');
    for (let i = 0; i < 2; i++) {
      await this.client.evaluate('window.scrollBy(0, 1500)');
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    await this.client.evaluate('window.scrollTo({ top: 0 })');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Extract video data
    const videos = await this.client.evaluate<YoutubePlaylistItem[]>(`
      (() => {
        const renderers = Array.from(document.querySelectorAll('ytd-playlist-video-renderer'));
        console.log('Found ' + renderers.length + ' video renderers.');
        return renderers.map(el => {
          const titleEl = el.querySelector('#video-title');
          const title = titleEl ? (titleEl.textContent || titleEl.innerText || '').trim() : '';
          const href = titleEl ? titleEl.getAttribute('href') : null;
          
          const channelEl = el.querySelector('ytd-channel-name') || el.querySelector('#channel-name') || el.querySelector('a[href*="/@"]');
          const channel = channelEl ? (channelEl.textContent || channelEl.innerText || '').trim() : 'Unknown Channel';
          
          let videoUrl = '';
          if (href) {
            try {
              const urlObj = new URL(href, window.location.origin);
              // Extract the base watch URL without playlist query params
              const videoId = urlObj.searchParams.get('v');
              if (videoId) {
                videoUrl = 'https://www.youtube.com/watch?v=' + videoId;
              }
            } catch (e) {}
          }
          
          // Try to find added time text
          let addedText = '';
          const allElements = Array.from(el.querySelectorAll('*'));
          for (const subEl of allElements) {
            const txt = (subEl.textContent || '').trim();
            // We search for "Added" (English) or "추가한" (Korean)
            if (txt.includes('Added') || txt.includes('추가한')) {
              // Usually the specific added time text is short, like "Added 2 hours ago" or "추가한 날짜: 2시간 전"
              if (txt.length > 5 && txt.length < 50) {
                addedText = txt;
                break;
              }
            }
          }
          
          return { url: videoUrl, title, channel, addedText };
        }).filter(item => item.url && item.title);
      })()
    `);

    console.log(`[YoutubePlaylistParser] Extracted ${videos.length} videos from playlist.`);
    return videos;
  }
}
