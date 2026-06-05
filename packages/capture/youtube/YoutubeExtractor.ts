import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface YoutubeVideoMetadata {
  videoId: string;
  title: string;
  channel: string;
  url: string;
}

export class YoutubeExtractor {
  /**
   * Helper to parse and extract the 11-character YouTube video ID from various URL formats.
   */
  public static extractVideoId(url: string): string | null {
    if (!url) return null;
    
    const patterns = [
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|e\/|user\/.+\/)?(?:watch\?v=|watch\?.+&v=))([^"&?\s]{11})/,
      /(?:youtu\.be\/)([^"&?\s]{11})/,
      /(?:youtube\.com\/shorts\/)([^"&?\s]{11})/,
      /(?:youtube\.com\/embed\/)([^"&?\s]{11})/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Fetches metadata (title, channel) directly from the YouTube watch page HTML using regex.
   */
  public async fetchMetadata(videoId: string): Promise<YoutubeVideoMetadata> {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`[YoutubeExtractor] Fetching metadata for video ID: ${videoId}...`);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to load YouTube watch page: ${response.statusText}`);
      }

      const html = await response.text();

      // Extract title: first check og:title, then meta name="title", then page <title>
      let title = '';
      const ogTitleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
      const metaTitleMatch = html.match(/<meta name="title" content="([^"]+)"/);
      const htmlTitleMatch = html.match(/<title>([^<]+)<\/title>/);

      if (ogTitleMatch && ogTitleMatch[1]) {
        title = ogTitleMatch[1];
      } else if (metaTitleMatch && metaTitleMatch[1]) {
        title = metaTitleMatch[1];
      } else if (htmlTitleMatch && htmlTitleMatch[1]) {
        title = htmlTitleMatch[1].replace(' - YouTube', '');
      } else {
        title = `YouTube Video (${videoId})`;
      }

      // Clean HTML entities
      title = this.decodeHtmlEntities(title);

      // Extract channel name
      let channel = '';
      const linkNameMatch = html.match(/<link itemprop="name" content="([^"]+)"/);
      const authorMatch = html.match(/"author":"([^"]+)"/);
      const ownerMatch = html.match(/"ownerChannelName":"([^"]+)"/);

      if (linkNameMatch && linkNameMatch[1]) {
        channel = linkNameMatch[1];
      } else if (ownerMatch && ownerMatch[1]) {
        channel = ownerMatch[1];
      } else if (authorMatch && authorMatch[1]) {
        channel = authorMatch[1];
      } else {
        channel = 'Unknown Channel';
      }

      channel = this.decodeHtmlEntities(channel);

      console.log(`[YoutubeExtractor] Metadata parsed: "${title}" by [${channel}]`);
      
      return {
        videoId,
        title,
        channel,
        url
      };
    } catch (error: any) {
      console.error(`⚠️ [YoutubeExtractor] Error fetching metadata via fetch: ${error.message}`);
      return {
        videoId,
        title: `YouTube Video (${videoId})`,
        channel: 'Unknown Channel',
        url
      };
    }
  }

  /**
   * Helper to decode basic HTML entities in strings (e.g. &amp;, &quot;, &#39;)
   */
  private decodeHtmlEntities(str: string): string {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
  }

  /**
   * Fetches transcript/subtitles for a YouTube video using a robust Python bridge 
   * to interface with the highly stable youtube-transcript-api. 
   * It prioritizes Korean captions, falling back to English or whatever default is active.
   */
  public async fetchTranscript(videoId: string): Promise<string> {
    console.log(`[YoutubeExtractor] Fetching transcript via bridge.py for: ${videoId}...`);
    
    try {
      const bridgePath = path.join(__dirname, 'bridge.py');
      if (!fs.existsSync(bridgePath)) {
        throw new Error(`bridge.py script not found at: ${bridgePath}`);
      }

      const projectRoot = path.resolve(__dirname, '../../..');
      const virtualEnvPython = path.join(projectRoot, '.venv/bin/python3');
      const python = fs.existsSync(virtualEnvPython) ? virtualEnvPython : 'python3';
      const output = execFileSync(python, [bridgePath, videoId], {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
      });
      
      const parsed = JSON.parse(output);

      if (parsed && parsed.error) {
        throw new Error(parsed.error);
      }

      if (Array.isArray(parsed)) {
        return parsed.join('\n');
      }

      throw new Error('Invalid output format from Python script.');
    } catch (err: any) {
      console.error(`❌ [YoutubeExtractor] Python Bridge failed: ${err.message}`);
      throw new Error(`Failed to extract subtitles for this video: ${err.message}`);
    }
  }
}

// Simple test runner for command-line verification
if (require.main === module) {
  const testUrl = process.argv[2] || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const videoId = YoutubeExtractor.extractVideoId(testUrl);
  if (!videoId) {
    console.error('Invalid URL passed to test.');
    process.exit(1);
  }

  const extractor = new YoutubeExtractor();
  (async () => {
    try {
      const meta = await extractor.fetchMetadata(videoId);
      console.log('Parsed Metadata:', JSON.stringify(meta, null, 2));
      const transcript = await extractor.fetchTranscript(videoId);
      console.log('\n--- Transcript Snippet ---');
      console.log(transcript.split('\n').slice(0, 15).join('\n'));
      console.log('...\n[Transcript length:', transcript.length, 'characters]');
    } catch (e: any) {
      console.error('Extraction Test Failed:', e.message);
    }
  })();
}
