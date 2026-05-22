/// <reference path="../../../types.d.ts" />
import { ChromeLauncher } from '../cdp/ChromeLauncher';
import { TabPool } from '../cdp/TabPool';
import { ProfileManager } from '../cdp/ProfileManager';

async function findSelectors() {
  const url = 'https://www.linkedin.com/feed/update/urn:li:activity:7462330837108293632/?utm_source=share&utm_medium=member_desktop&rcm=ACoAABAJjeIB-3dzBD1PTuRsppr125q6x30IEF8';
  console.log(`[FindSelectors] Loading: ${url}`);

  const profileManager = new ProfileManager();
  const launcher = new ChromeLauncher({ headless: true });
  
  try {
    await launcher.launch();
    const pool = new TabPool();
    const client = await pool.acquireTab();
    const rawClient = client.getRawClient();

    // Inject Cookies
    const savedCookies = profileManager.loadAndDecryptSession();
    if (savedCookies && savedCookies.length > 0) {
      const { Network } = rawClient;
      await Network.setCookies({ cookies: savedCookies });
    }

    await client.navigate(url);
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Evaluate DOM elements
    const elementsInfo = await client.evaluate<any>(`
      (() => {
        const results = [];
        
        // Find elements containing "SungJae Shim"
        const findElementsWithText = (text) => {
          const els = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
          let node;
          while (node = walker.nextNode()) {
            if (node.textContent.includes(text) && node.children.length <= 3 && node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
              els.push({
                tag: node.tagName,
                id: node.id,
                className: node.className,
                text: node.textContent.substring(0, 100).trim()
              });
            }
          }
          return els.slice(0, 10);
        };

        // Find potential post containers
        const postContainers = [];
        const selectors = ['.feed-shared-update-v2', 'article', '[data-urn]', '.feed-shared-update', '.main-feed-card', 'div[class*="update"]', 'div[class*="feed-shared"]'];
        selectors.forEach(sel => {
          const count = document.querySelectorAll(sel).length;
          postContainers.push({ selector: sel, count });
        });

        // Let's dump the HTML structure of the area around "SungJae Shim"
        let contextHtml = '';
        const authorEl = Array.from(document.querySelectorAll('*')).find(el => el.textContent.trim() === 'SungJae Shim');
        if (authorEl) {
          let parent = authorEl;
          for (let i = 0; i < 5; i++) {
            if (parent.parentElement) parent = parent.parentElement;
          }
          contextHtml = parent.outerHTML.substring(0, 2000);
        }

        return {
          sungjaeElements: findElementsWithText('SungJae Shim'),
          postContainers,
          contextHtmlSnippet: contextHtml
        };
      })()
    `);

    console.log('\n================ ELEMENTS INFO ================');
    console.log('Elements containing "SungJae Shim":');
    console.log(JSON.stringify(elementsInfo.sungjaeElements, null, 2));
    console.log('\nPost Container Selectors count:');
    console.log(JSON.stringify(elementsInfo.postContainers, null, 2));
    console.log('\nContext HTML Snippet around Author:');
    console.log(elementsInfo.contextHtmlSnippet);
    console.log('=================================================\n');

    await pool.releaseTab(client);
  } catch (err) {
    console.error('❌ Sel discovery crashed:', err);
  } finally {
    launcher.kill();
  }
}

findSelectors().catch(console.error);
