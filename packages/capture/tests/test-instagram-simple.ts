import { ChromeLauncher } from '../cdp/ChromeLauncher';
import { TabPool } from '../cdp/TabPool';
import { ProfileManager } from '../cdp/ProfileManager';

async function main() {
  const testUrl = process.argv[2] || 'https://www.instagram.com/p/ClhZzI0uH8W/';
  console.log(`🔍 Test: ${testUrl}`);

  const launcher = new ChromeLauncher({ headless: false });
  const pool = new TabPool();
  const profileManager = new ProfileManager();

  try {
    await launcher.launch();
    const client = await pool.acquireTab();
    const rawClient = (client as any).client;

    // Inject cookies
    const savedCookies = profileManager.loadAndDecryptSession('instagram');
    if (savedCookies && savedCookies.length > 0) {
      console.log(`Cookies: ${savedCookies.length}`);
      const { Network } = rawClient;
      await Network.setCookies({ cookies: savedCookies });
    }

    // Navigate
    await client.navigate(testUrl + '?__a=1');
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Check final URL
    const finalUrl = await client.evaluate<string>('window.location.href');
    console.log(`\nFinal URL: ${finalUrl}`);

    // Check if logged in
    const bodyText = await client.evaluate<string>('document.body.innerText.substring(0, 2000)');
    console.log(`\nBody text (first 2000 chars):\n${bodyText}`);
    
    // Check page source once more
    const html = await client.evaluate<string>('document.documentElement.outerHTML.substring(0, 5000)');
    console.log(`\nHTML (first 5000):\n${html}`);

    await pool.releaseTab(client);
  } finally {
    launcher.kill();
  }
}

main().catch(console.error);
