/// <reference path="../../../types.d.ts" />
import { ChromeLauncher } from '../cdp/ChromeLauncher';
import { TabPool } from '../cdp/TabPool';
import { ProfileManager } from '../cdp/ProfileManager';

async function findBodySelector() {
  const url = 'https://www.linkedin.com/feed/update/urn:li:activity:7462330837108293632/?utm_source=share&utm_medium=member_desktop&rcm=ACoAABAJjeIB-3dzBD1PTuRsppr125q6x30IEF8';
  console.log(`[FindBodySelector] Loading: ${url}`);

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
    const elementDetails = await client.evaluate<any>(`
      (() => {
        // Find elements containing "별 9만 5천 개"
        const findNode = (text) => {
          const els = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
          let node;
          while (node = walker.nextNode()) {
            if (node.textContent.includes(text) && node.children.length === 0 && node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
              // Found leaf node, now let's traverse up
              let current = node;
              const path = [];
              for (let i = 0; i < 6; i++) {
                if (current) {
                  path.push({
                    tag: current.tagName,
                    id: current.id,
                    className: current.className,
                    text: current.textContent.substring(0, 100).trim()
                  });
                  current = current.parentElement;
                }
              }
              els.push(path);
            }
          }
          return els;
        };

        return {
          bodyTextPaths: findNode('별 9만 5천 개')
        };
      })()
    `);

    console.log('\n================ BODY TEXT PATH ================');
    console.log(JSON.stringify(elementDetails.bodyTextPaths, null, 2));
    console.log('=================================================\n');

    await pool.releaseTab(client);
  } catch (err) {
    console.error('❌ Body discovery crashed:', err);
  } finally {
    launcher.kill();
  }
}

findBodySelector().catch(console.error);
