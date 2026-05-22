import { ChromeLauncher } from '../cdp/ChromeLauncher';
import { TabPool } from '../cdp/TabPool';

async function testCdpConnection() {
  console.log('[TestCDP] Starting Chrome CDP test...');
  
  // Launch in headless mode for speed
  const launcher = new ChromeLauncher({ headless: true });
  
  try {
    const wsUrl = await launcher.launch();
    console.log(`[TestCDP] Chrome launched. Debug URL: ${wsUrl}`);

    const pool = new TabPool();
    const client = await pool.acquireTab();

    console.log('[TestCDP] Navigating to https://example.com...');
    await client.navigate('https://example.com');

    console.log('[TestCDP] Evaluating page title...');
    const title = await client.evaluate<string>('document.title');
    console.log(`[TestCDP] Extracted Page Title: "${title}"`);

    if (title === 'Example Domain') {
      console.log('✅ CDP Connection Test Passed successfully!');
    } else {
      console.error(`❌ Unexpected title: "${title}" (Expected: "Example Domain")`);
    }

    await pool.releaseTab(client);
  } catch (err) {
    console.error('❌ Test failed with error:', err);
  } finally {
    launcher.kill();
    console.log('[TestCDP] Chrome process killed.');
  }
}

testCdpConnection().catch(console.error);
