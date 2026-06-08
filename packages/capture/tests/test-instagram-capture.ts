import { ChromeLauncher } from '../cdp/ChromeLauncher';
import { TabPool } from '../cdp/TabPool';
import { ProfileManager } from '../cdp/ProfileManager';
import { InstagramCapture } from '../sources/instagram/InstagramCapture';
import { InstagramVerifier } from '../sources/instagram/InstagramVerifier';

async function main() {
  const testUrl = process.argv[2] || 'https://www.instagram.com/p/ClhZzI0uH8W/';
  console.log(`🔍 Testing Instagram capture for: ${testUrl}\n`);

  const launcher = new ChromeLauncher({ headless: false });
  const pool = new TabPool();
  const profileManager = new ProfileManager();

  try {
    await launcher.launch();
    const client = await pool.acquireTab();
    const rawClient = client.getRawClient();

    // Inject session cookies
    const savedCookies = profileManager.loadAndDecryptSession('instagram');
    if (savedCookies && savedCookies.length > 0) {
      console.log(`📦 Injecting ${savedCookies.length} Instagram session cookies...`);
      const { Network } = rawClient;
      await Network.setCookies({ cookies: savedCookies });
    }

    // Navigate to post
    console.log(`\n🌐 Navigating to: ${testUrl}`);
    await client.navigate(testUrl);
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Capture
    const capture = new InstagramCapture(client);
    const result = await capture.capture(testUrl);
    
    console.log(`\n✅ Capture success: ${result.success}`);
    
    if (result.data) {
      console.log(`\n📄 Extracted Data:`);
      console.log(`   Author: ${result.data.author}`);
      console.log(`   Headline: ${result.data.headline}`);
      console.log(`   Date: ${result.data.dateText}`);
      console.log(`   Body length: ${result.data.body.length} chars`);
      console.log(`   Body preview: ${result.data.body.substring(0, 200)}`);
      console.log(`   Images: ${result.data.images.length}`);
      console.log(`   Comments: ${result.data.comments.length}`);
      if (result.data.comments.length > 0) {
        result.data.comments.slice(0, 3).forEach((c: any, i: number) => {
          console.log(`   Comment ${i+1}: ${c.author} - ${c.text.substring(0, 100)}`);
        });
      }
    }

    // Also run the verifier
    const verifier = new InstagramVerifier();
    const report = verifier.verify(result, result.scrapPath || '/tmp');
    console.log(`\n🔍 Verification Score: ${report.score} / 1.0`);
    console.log(`   Status: ${report.status}`);
    console.log(`   Checks: ${JSON.stringify(report.checks)}`);
    if (report.warnings.length > 0) {
      console.log(`   Warnings:`);
      report.warnings.forEach((w: string) => console.log(`     - ${w}`));
    }

    await pool.releaseTab(client);
  } finally {
    launcher.kill();
  }
}

main().catch(console.error);
