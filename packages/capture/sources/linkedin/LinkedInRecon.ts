import { CdpClient } from '../../cdp/CdpClient';

export interface ReconResult {
  status: 'READY_TO_CAPTURE' | 'UNAUTHENTICATED' | 'BLOCKED' | 'PAGE_NOT_FOUND';
  canonicalUrl: string;
  hasComments: boolean;
  hasImages: boolean;
  hasSeeMore: boolean;
  error?: string;
}

export class LinkedInRecon {
  private client: CdpClient;

  constructor(client: CdpClient) {
    this.client = client;
  }

  /**
   * Performs quick reconnaissance on the loaded LinkedIn tab.
   */
  public async performRecon(url: string): Promise<ReconResult> {
    console.log(`[LinkedInRecon] Starting reconnaissance for ${url}...`);

    // 1. URL Canonicalization
    const canonicalUrl = this.canonicalizeUrl(url);
    console.log(`[LinkedInRecon] Canonicalized URL: ${canonicalUrl}`);

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

    // Give page 3 seconds to complete essential lazy scripts
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 2. Perform page state audits via DOM checks
    try {
      const pageInfo = await this.client.evaluate<{
        isLoggedIn: boolean;
        isLoginForm: boolean;
        isBlocked: boolean;
        hasPostBody: boolean;
        hasSeeMore: boolean;
        hasComments: boolean;
        hasImages: boolean;
      }>(`
        (() => {
          const pageText = document.body ? document.body.innerText : "";

          // Check for login state - look for nav containers or specific navigation markers
          const isLoggedIn = !!document.querySelector('.global-nav') || 
                             !!document.querySelector('#global-nav') ||
                             !!document.querySelector('main#workspace') ||
                             (pageText.includes("Home") && pageText.includes("Messaging") && pageText.includes("Notifications")) ||
                             pageText.includes("SeungWoo Lee");

          const isLoginForm = !!document.querySelector('form.login__form') || !!document.querySelector('#username');
          
          // Check for blocking elements
          const isBlocked = pageText.includes("Access Denied") || 
                            pageText.includes("verify your identity") || 
                            !!document.querySelector('iframe[src*="challenge"]');
          
          // Check post components (feed updates OR single-post section updates)
          const hasPostBody = !!document.querySelector('.feed-shared-update-v2') || 
                              !!document.querySelector('.feed-shared-inline-show-more-text') ||
                              !!document.querySelector('.cdb30203') ||
                              !!document.querySelector('section[class*="c4eb0912"]') ||
                              pageText.includes("reposted this") ||
                              pageText.includes("Following") ||
                              pageText.includes("linkedin.com/posts/");
          
          const hasSeeMore = !!document.querySelector('button.feed-shared-inline-show-more-text__button') ||
                             !!document.querySelector('button.feed-shared-text-view-more-button') ||
                             !!document.querySelector('button[class*="see-more"]') ||
                             !!document.querySelector('button[class*="show-more"]');
          
          const hasComments = !!document.querySelector('.comments-comment-item') || 
                              !!document.querySelector('.comments-comment-list') ||
                              !!document.querySelector('div[class*="comment"]');
          
          const hasImages = !!document.querySelector('.update-components-image__image') || 
                            !!document.querySelector('.update-components-article__image img') ||
                            !!document.querySelector('div[class*="update"] img') ||
                            Array.from(document.querySelectorAll('img')).some(img => {
                              const w = img.clientWidth || parseInt(img.getAttribute('width') || '0');
                              return w > 200 && !img.src.includes('profile-displayphoto');
                            });

          return {
            isLoggedIn,
            isLoginForm,
            isBlocked,
            hasPostBody,
            hasSeeMore,
            hasComments,
            hasImages
          };
        })()
      `);

      console.log('[LinkedInRecon] Reconnaissance Page Info:', pageInfo);

      if (pageInfo.isBlocked) {
        return {
          status: 'BLOCKED',
          canonicalUrl,
          hasComments: pageInfo.hasComments,
          hasImages: pageInfo.hasImages,
          hasSeeMore: pageInfo.hasSeeMore,
          error: 'LinkedIn blocked the session or prompted for a verification challenge (CAPTCHA).'
        };
      }

      if (!pageInfo.isLoggedIn && pageInfo.isLoginForm) {
        return {
          status: 'UNAUTHENTICATED',
          canonicalUrl,
          hasComments: pageInfo.hasComments,
          hasImages: pageInfo.hasImages,
          hasSeeMore: pageInfo.hasSeeMore,
          error: 'Agent Chrome profile is not logged in. Session authentication required.'
        };
      }

      if (!pageInfo.hasPostBody) {
        return {
          status: 'PAGE_NOT_FOUND',
          canonicalUrl,
          hasComments: false,
          hasImages: false,
          hasSeeMore: false,
          error: 'Post body containers not found. URL might be invalid or deleted.'
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
   * Helper to strip unnecessary trackers from LinkedIn URLs.
   */
  private canonicalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const trackers = ['ref', 'trackingId', 'mini', 'lipi', 'licu', 'trk'];
      trackers.forEach(t => parsed.searchParams.delete(t));
      return parsed.toString();
    } catch (e) {
      return url;
    }
  }
}
