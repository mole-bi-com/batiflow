import { YoutubeExtractor } from '../youtube/YoutubeExtractor';

export type TelegramLink =
  | { kind: 'youtube'; url: string; videoId: string }
  | { kind: 'web'; url: string }
  | { kind: 'unsupported' };

export function classifyTelegramLink(text: string): TelegramLink {
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (!urlMatch) {
    return { kind: 'unsupported' };
  }

  const url = urlMatch[0].replace(/[),.!?]+$/, '');
  const videoId = YoutubeExtractor.extractVideoId(url);
  if (videoId) {
    return { kind: 'youtube', url: `https://www.youtube.com/watch?v=${videoId}`, videoId };
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
      return { kind: 'web', url: parsedUrl.toString() };
    }
  } catch {
    return { kind: 'unsupported' };
  }

  return { kind: 'unsupported' };
}
