import { ChromeLauncher } from '../cdp/ChromeLauncher';
import { TabPool } from '../cdp/TabPool';
import { ProfileManager } from '../cdp/ProfileManager';

async function main() {
  const testUrl = 'https://www.instagram.com/p/ClhZzI0uH8W/';
  console.log(`Looking for embedded post data: ${testUrl}`);

  const launcher = new ChromeLauncher({ headless: false });
  const pool = new TabPool();
  const profileManager = new ProfileManager();

  try {
    await launcher.launch();
    const client = await pool.acquireTab();
    const rawClient = client.getRawClient();

    const savedCookies = profileManager.loadAndDecryptSession('instagram');
    if (savedCookies?.length) {
      const { Network } = rawClient;
      await Network.setCookies({ cookies: savedCookies });
    }

    // First, capture the main HTML response body
    let mainHtml = '';
    rawClient.Network.responseReceived(async (params: any) => {
      const reqUrl = params.response.url || '';
      if (reqUrl.includes('/p/ClhZzI0uH8W') && params.response.mimeType === 'text/html') {
        try {
          const body = await rawClient.Network.getResponseBody({ requestId: params.requestId });
          mainHtml = body.body || '';
          console.log(`Main HTML captured: ${mainHtml.length} chars`);
        } catch(e) {}
      }
    });

    await client.navigate(testUrl);
    await new Promise(resolve => setTimeout(resolve, 8000));

    if (mainHtml) {
      // Find any embedded JSON data that looks like Instagram post data
      const patterns = [
        'xdt_api__v1__media__shortcode__web_info',
        'shortcode_media',
        '"edge_media_to_caption"',
        'window.__INITIAL_STATE__',
        'window.__INIT'
      ];
      for (const p of patterns) {
        const idx = mainHtml.indexOf(p);
        if (idx >= 0) {
          console.log(`\n✅ Found: "${p}" at position ${idx}`);
          console.log(`Context: ${mainHtml.substring(Math.max(0, idx - 100), idx + 300)}`);
        }
      }
    }

    // Also use evaluate to find facebook/instagram global state
    const state = await client.evaluate<any>(`
      (() => {
        // Check various state globals
        const checks: any = {};
        const globals = ['__INITIAL_STATE__', '__INIT', '__NEXT_DATA__', '__APOLLO_STATE__', '__RELAY_STORE__', '__d'];
        for (const g of globals) {
          const val = (window as any)[g];
          if (val) {
            const str = JSON.stringify(val);
            checks[g] = { type: typeof val, length: str.length, hasPostData: str.includes('shortcode') || str.includes('caption') };
          }
        }
        return checks;
      })()
    `);
    console.log('\n📋 Global state variables:');
    console.log(JSON.stringify(state, null, 2));

    await pool.releaseTab(client);
  } finally {
    launcher.kill();
  }
}

main().catch(console.error);
