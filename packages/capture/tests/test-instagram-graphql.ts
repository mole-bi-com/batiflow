import { ChromeLauncher } from '../cdp/ChromeLauncher';
import { TabPool } from '../cdp/TabPool';
import { ProfileManager } from '../cdp/ProfileManager';

async function main() {
  const testUrl = process.argv[2] || 'https://www.instagram.com/p/ClhZzI0uH8W/';
  console.log(`🔍 Testing GraphQL capture: ${testUrl}`);

  const launcher = new ChromeLauncher({ headless: false });
  const pool = new TabPool();
  const profileManager = new ProfileManager();

  try {
    await launcher.launch();
    const client = await pool.acquireTab();
    const rawClient = client.getRawClient();

    // Inject cookies
    const savedCookies = profileManager.loadAndDecryptSession('instagram');
    if (savedCookies && savedCookies.length > 0) {
      console.log(`📦 Injecting ${savedCookies.length} session cookies`);
      const { Network } = rawClient;
      await Network.setCookies({ cookies: savedCookies });
    }

    // Set up GraphQL response capture
    let graphqlData: any = null;
    const { Network } = rawClient;

    Network.responseReceived(async (params: any) => {
      const response = params.response;
      const reqUrl = response.url || '';
      
      if (reqUrl.includes('graphql') || reqUrl.includes('/api/') || reqUrl.includes('__a=1')) {
        try {
          const body = await Network.getResponseBody({ requestId: params.requestId });
          if (body.body && body.body.length > 50 && !body.body.includes('for (;;)')) {
            const parsed = JSON.parse(body.body);
            graphqlData = parsed;
            console.log(`✅ Captured: ${reqUrl.substring(0, 100)}`);
          }
        } catch(e) {}
      }
    });

    // Navigate
    console.log('\n🌐 Navigating...');
    await client.navigate(testUrl);
    await new Promise(resolve => setTimeout(resolve, 12000));

    if (graphqlData) {
      console.log('\n✅ GraphQL data captured!');
      console.log(JSON.stringify(graphqlData).substring(0, 2000));
      
      // Extract username
      try {
        const data = graphqlData.data || graphqlData;
        const items = data.xdt_api__v1__media__shortcode__web_info?.items || 
                     data.xdt_shortcode_media ? [data.xdt_shortcode_media] :
                     data.shortcode_media ? [data.shortcode_media] : [];
        if (items.length > 0) {
          const m = items[0];
          console.log(`\n📋 Extracted:`);
          console.log(`   Author: ${m.owner?.username || m.user?.username || '?'}`);
          console.log(`   Caption: ${(m.caption?.text || m.caption || '').substring(0, 200)}`);
          console.log(`   Images: ${m.image_versions2?.candidates?.length || (m.display_url ? 1 : 0)}`);
          console.log(`   Comments: ${m.comment_count || m.comments?.count || 0}`);
        }
      } catch(e) {
        console.log(`Parse error: ${e}`);
      }
    } else {
      console.log('\n❌ No GraphQL data captured in 12s');
      
      // Try DOM fallback
      console.log('\n📋 Checking page state...');
      const pageInfo = await client.evaluate<any>(`
        (() => {
          return {
            url: window.location.href,
            hasArticle: !!document.querySelector('article'),
            bodyLen: (document.body.innerText || '').length,
            title: document.title
          };
        })()
      `);
      console.log(JSON.stringify(pageInfo, null, 2));
    }

    await pool.releaseTab(client);
  } finally {
    launcher.kill();
  }
}

main().catch(console.error);
