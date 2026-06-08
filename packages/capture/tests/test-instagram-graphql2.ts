import { ChromeLauncher } from '../cdp/ChromeLauncher';
import { TabPool } from '../cdp/TabPool';
import { ProfileManager } from '../cdp/ProfileManager';

async function main() {
  const testUrl = process.argv[2] || 'https://www.instagram.com/p/ClhZzI0uH8W/';
  console.log(`GraphQL inspect: ${testUrl}`);

  const launcher = new ChromeLauncher({ headless: false });
  const pool = new TabPool();
  const profileManager = new ProfileManager();

  try {
    await launcher.launch();
    const client = await pool.acquireTab();
    const rawClient = client.getRawClient();

    const savedCookies = profileManager.loadAndDecryptSession('instagram');
    if (savedCookies && savedCookies.length > 0) {
      console.log(`Cookies: ${savedCookies.length}`);
      const { Network } = rawClient;
      await Network.setCookies({ cookies: savedCookies });
    }

    const { Network } = rawClient;
    let captured = 0;

    Network.responseReceived(async (params: any) => {
      const response = params.response;
      const reqUrl = response.url || '';

      // Only capture graphql endpoints
      if (!reqUrl.includes('graphql') && !reqUrl.includes('/api/')) return;
      
      try {
        const body = await Network.getResponseBody({ requestId: params.requestId });
        if (body.body && body.body.length > 50) {
          captured++;
          const preview = body.body.substring(0, 300);
          console.log(`\n[${captured}] ${reqUrl.substring(0, 120)}`);
          console.log(`   Type: ${response.type}, Status: ${response.status}`);
          console.log(`   Size: ${body.body.length} chars`);
          console.log(`   Preview: ${preview}`);
          
          // Check if it has post/media data
          if (body.body.includes('shortcode_media') || body.body.includes('items') || body.body.includes('caption')) {
            console.log('   🔴 CONTAINS POST DATA!');
          }
        }
      } catch(e) {
        // Can't get body
      }
    });

    await client.navigate(testUrl);
    await new Promise(resolve => setTimeout(resolve, 15000));

    console.log(`\n\nTotal captured: ${captured}`);

    await pool.releaseTab(client);
  } finally {
    launcher.kill();
  }
}

main().catch(console.error);
