import { ProfileManager } from '../cdp/ProfileManager';
import { ChromeLauncher } from '../cdp/ChromeLauncher';
import { TabPool } from '../cdp/TabPool';

async function main() {
  console.log('Starting Threads Settings inspection...');
  const profileManager = new ProfileManager();
  const launcher = new ChromeLauncher({ headless: true });
  const pool = new TabPool();

  try {
    const wsUrl = await launcher.launch();
    const client = await pool.acquireTab();
    const rawClient = client.getRawClient();
    const { Network } = rawClient;

    const threadsSession = profileManager.loadAndDecryptSession('threads');
    if (!threadsSession) {
      console.error('No threads session found!');
      return;
    }

    await Network.setCookies({ cookies: threadsSession });
    console.log('Session injected. Navigating to Threads Settings...');
    
    await client.navigate('https://www.threads.net/settings');
    await new Promise(resolve => setTimeout(resolve, 5000));

    const currentUrl = await client.evaluate<string>('window.location.href');
    console.log('Current URL after load:', currentUrl);

    // Find and click the "More" button to open the popup menu
    console.log('Finding and clicking "More" button...');
    const clickedMore = await client.evaluate<boolean>(`
      (() => {
        const elements = Array.from(document.querySelectorAll('div[role="button"], span, button'));
        const moreBtn = elements.find(el => el.textContent && el.textContent.trim().toLowerCase() === 'more');
        if (moreBtn) {
          moreBtn.click();
          return true;
        }
        return false;
      })()
    `);

    if (clickedMore) {
      console.log('Clicked "More" button! Waiting for menu to render...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      console.log('Warning: "More" button not found.');
    }

    // Get elements after clicking More
    const elements = await client.evaluate<{ tag: string; text: string; role: string | null }[]>(`
      (() => {
        return Array.from(document.querySelectorAll('a, button, div[role="button"], span'))
          .map(el => ({
            tag: el.tagName,
            text: el.textContent ? el.textContent.trim() : '',
            role: el.getAttribute('role')
          }))
          .filter(item => item.text.length > 0);
      })()
    `);

    // Find and click the "Liked" option in the dropdown
    console.log('Finding and clicking "Liked" menu item...');
    const clickedLiked = await client.evaluate<boolean>(`
      (() => {
        const elements = Array.from(document.querySelectorAll('a[role="menuitem"], span, button'));
        const likedEl = elements.find(el => {
          const text = el.textContent || '';
          return text.toLowerCase() === 'liked' || text.includes('내가 누른 좋아요') || text === '좋아요';
        });
        if (likedEl) {
          likedEl.click();
          return true;
        }
        return false;
      })()
    `);

    if (clickedLiked) {
      console.log('Clicked "Liked" successfully! Waiting for navigation...');
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      const newUrl = await client.evaluate<string>('window.location.href');
      console.log('Final URL after clicking Liked:', newUrl);

      // Scroll slightly to trigger load
      console.log('Scrolling to trigger feed loading...');
      await client.evaluate('window.scrollBy({ top: 1000, behavior: "smooth" })');
      await new Promise(resolve => setTimeout(resolve, 2000));

      const postUrls = await client.evaluate<string[]>(`
        (() => {
          const links = Array.from(document.querySelectorAll('a'));
          return Array.from(new Set(
            links.map(a => a.href).filter(href => href.includes('/post/'))
          ));
        })()
      `);
      console.log('\n--- Found Post URLs ---');
      console.log(postUrls);
      console.log('-----------------------\n');
    } else {
      console.log('Warning: "Liked" menu item not found.');
    }

    await pool.releaseTab(client);
    launcher.kill();
  } catch (e: any) {
    console.error('Error during Threads inspection:', e.message);
    launcher.kill();
  }
}

main().catch(console.error);
