import { CdpClient } from '../../cdp/CdpClient';

export interface XReconResult {
  status: 'READY_TO_CAPTURE' | 'UNAUTHENTICATED' | 'BLOCKED' | 'PAGE_NOT_FOUND';
  canonicalUrl: string;
  hasComments: boolean;
  hasImages: boolean;
  hasSeeMore: boolean;
  error?: string;
}

export class XRecon {
  private client: CdpClient;

  constructor(client: CdpClient) {
    this.client = client;
  }

  /**
   * Performs quick reconnaissance on the loaded X (Twitter) tab.
   */
  public async performRecon(url: string): Promise<XReconResult> {
    console.log(`[XRecon] Starting reconnaissance for ${url}...`);

    // 1. URL Canonicalization
    const canonicalUrl = this.canonicalizeUrl(url);
    console.log(`[XRecon] Canonicalized URL: ${canonicalUrl}`);

    // Navigate to target URL
    try {
      await this.client.navigate(canonicalUrl);
    } catch (err: any) {
      return {
        status: 'BLOCKED',
        canonicalUrl,
        hasComments: false,
        hasImages: false,
        hasSeeMore: false,
        error: `Navigation failure: ${err.message}`
      };
    }

    // Give page 4 seconds to settle (X/Twitter is heavy and client-side rendered)
    await new Promise(resolve => setTimeout(resolve, 4000));

    // 2. Perform page state audits via DOM checks
    try {
      const pageInfo = await this.client.evaluate<{
        isLoggedIn: boolean;
        isLoginForm: boolean;
        isBlocked: boolean;
        hasTweetBody: boolean;
        hasSeeMore: boolean;
        hasComments: boolean;
        hasImages: boolean;
      }>(`
        (() => {
          const pageText = document.body ? document.body.innerText : "";

          // 1. Check Login State
          const isLoggedIn = !!document.querySelector('[data-testid="SideNav_AccountSidebar_ProfileLink"]') || 
                             !!document.querySelector('[data-testid="AppTabBar_Home_Link"]') ||
                             (!!document.querySelector('nav[role="navigation"]') && !pageText.includes("Log in to X") && !pageText.includes("Sign in"));

          const isLoginForm = pageText.includes("Sign in to X") || 
                              !!document.querySelector('input[name="text"]') || 
                              !!document.querySelector('[data-testid="loginButton"]');
          
          // 2. Check for blocking elements / rate limit / CAPTCHA
          const isBlocked = pageText.includes("Access Denied") || 
                            pageText.includes("Verify you are human") || 
                            pageText.includes("Rate limit exceeded") ||
                            !!document.querySelector('iframe[src*="challenge"]');
          
          // 3. Check for main Tweet content
          const mainArticle = document.querySelector('article');
          const hasTweetBody = !!mainArticle || !!document.querySelector('[data-testid="tweet"]');
          
          // 4. Check for long-text "Show more" button inside the main tweet
          let hasSeeMore = false;
          if (mainArticle) {
            hasSeeMore = Array.from(mainArticle.querySelectorAll('span, div')).some(el => {
              const txt = el.textContent || '';
              return txt === 'Show more' || txt === '더 보기';
            });
          } else {
            hasSeeMore = Array.from(document.querySelectorAll('span')).some(el => {
              const txt = el.textContent || '';
              return txt === 'Show more' || txt === '더 보기';
            });
          }
          
          // 5. Check if replies exist (excluding the main article tweet)
          const tweets = document.querySelectorAll('[data-testid="tweet"]');
          const hasComments = tweets.length > 1;
          
          // 6. Check for media attachments (photos, videos, gifs)
          const hasImages = !!document.querySelector('[data-testid="tweetPhoto"]') || 
                            !!document.querySelector('[data-testid="videoPlayer"]') ||
                            !!document.querySelector('[data-testid="card.wrapper"]') ||
                            Array.from(document.querySelectorAll('img')).some(img => {
                              const src = img.src || '';
                              return src.includes('/media/') && !src.includes('profile_images');
                            });

          return {
            isLoggedIn,
            isLoginForm,
            isBlocked,
            hasTweetBody,
            hasSeeMore,
            hasComments,
            hasImages
          };
        })()
      `);

      console.log('[XRecon] Reconnaissance Page Info:', pageInfo);

      if (pageInfo.isBlocked) {
        return {
          status: 'BLOCKED',
          canonicalUrl,
          hasComments: pageInfo.hasComments,
          hasImages: pageInfo.hasImages,
          hasSeeMore: pageInfo.hasSeeMore,
          error: 'X (Twitter) blocked the session or returned a rate limit / CAPTCHA screen.'
        };
      }

      if (!pageInfo.isLoggedIn && pageInfo.isLoginForm) {
        return {
          status: 'UNAUTHENTICATED',
          canonicalUrl,
          hasComments: pageInfo.hasComments,
          hasImages: pageInfo.hasImages,
          hasSeeMore: pageInfo.hasSeeMore,
          error: 'Agent Chrome profile is not logged in to X. Session authentication required.'
        };
      }

      if (!pageInfo.hasTweetBody) {
        return {
          status: 'PAGE_NOT_FOUND',
          canonicalUrl,
          hasComments: false,
          hasImages: false,
          hasSeeMore: false,
          error: 'Tweet body or article element not found. The tweet may be private, deleted, or the URL is invalid.'
        };
      }

      return {
        status: 'READY_TO_CAPTURE',
        canonicalUrl,
        hasComments: pageInfo.hasComments,
        hasImages: pageInfo.hasImages,
        hasSeeMore: pageInfo.hasSeeMore
      };

    } catch (err: any) {
      return {
        status: 'BLOCKED',
        canonicalUrl,
        hasComments: false,
        hasImages: false,
        hasSeeMore: false,
        error: `DOM evaluation failed during recon: ${err.message}`
      };
    }
  }

  /**
   * Cleans X tracker variables and normalizes to x.com.
   */
  private canonicalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Normalize twitter.com to x.com
      if (parsed.hostname.includes('twitter.com')) {
        parsed.hostname = 'x.com';
      }
      const trackers = ['s', 't', 'ref_src', 'ref_url'];
      trackers.forEach(t => parsed.searchParams.delete(t));
      return parsed.toString();
    } catch (e) {
      return url;
    }
  }
}
