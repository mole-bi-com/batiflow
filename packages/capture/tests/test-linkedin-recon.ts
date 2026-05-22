/// <reference path="../../../types.d.ts" />
import { ChromeLauncher } from '../cdp/ChromeLauncher';
import { TabPool } from '../cdp/TabPool';
import { LinkedInRecon } from '../sources/linkedin/LinkedInRecon';

async function testRecon() {
  const url = process.argv[2] || 'https://www.linkedin.com/posts/activity-7195484803929481216-928e';
  console.log(`[TestRecon] Initiating LinkedIn Recon test for URL: ${url}`);

  const launcher = new ChromeLauncher({ headless: true });
  
  try {
    await launcher.launch();
    const pool = new TabPool();
    const client = await pool.acquireTab();

    const recon = new LinkedInRecon(client);
    const result = await recon.performRecon(url);

    console.log('\n======================================================');
    console.log('            LINKEDIN RECON TEST RESULT                ');
    console.log('======================================================');
    console.log(`Recon Status:  ${result.status}`);
    console.log(`Canonical URL: ${result.canonicalUrl}`);
    console.log(`Has See More:  ${result.hasSeeMore}`);
    console.log(`Has Comments:  ${result.hasComments}`);
    console.log(`Has Images:    ${result.hasImages}`);
    if (result.error) {
      console.log(`Error Msg:     ${result.error}`);
    }
    console.log('======================================================\n');

    await pool.releaseTab(client);
  } catch (err) {
    console.error('❌ Recon test failed with error:', err);
  } finally {
    launcher.kill();
    console.log('[TestRecon] Chrome process terminated.');
  }
}

testRecon().catch(console.error);
