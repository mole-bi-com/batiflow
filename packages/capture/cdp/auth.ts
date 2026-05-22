/// <reference path="../../../types.d.ts" />
import readline from 'readline';
import { ChromeLauncher } from './ChromeLauncher';
import { TabPool } from './TabPool';
import { ProfileManager } from './ProfileManager';

async function runAuthentication() {
  console.log('====================================================');
  console.log('          BatiFlow LinkedIn Authenticator            ');
  console.log('====================================================');
  console.log('This tool will open a headful Google Chrome instance.');
  console.log('Please log into LinkedIn in the browser window.');
  console.log('Once you are fully logged in and see your feed,');
  console.log('return to this terminal and press ENTER to save session.');
  console.log('====================================================\n');

  // 1. Launch headful Chrome
  const launcher = new ChromeLauncher({ headless: false });
  const wsUrl = await launcher.launch();

  // 2. Open tab and load LinkedIn login page
  const tabPool = new TabPool();
  const client = await tabPool.acquireTab();
  
  console.log('[Auth] Loading LinkedIn...');
  await client.navigate('https://www.linkedin.com/login');

  // 3. Wait for user input in terminal
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise<void>((resolve) => {
    rl.question('\n👉 Press [ENTER] once you have successfully logged in: ', () => {
      rl.close();
      resolve();
    });
  });

  // 4. Retrieve session cookies using raw CDP
  console.log('[Auth] Retrieving secure session cookies from Chrome...');
  const rawClient = client.getRawClient();
  const { Network } = rawClient;
  
  try {
    const { cookies } = await Network.getCookies({
      urls: ['https://www.linkedin.com', 'https://linkedin.com']
    });

    console.log(`[Auth] Captured ${cookies.length} LinkedIn session cookies.`);
    
    // 5. Encrypt and save cookies
    const profile = new ProfileManager();
    profile.encryptAndSaveSession(cookies);
    
    console.log('\n✅ Success! LinkedIn session cookies are encrypted and securely stored.');
  } catch (err) {
    console.error('\n❌ Failed to retrieve cookies via CDP:', err);
  } finally {
    // 6. Release tab and terminate Chrome
    await tabPool.releaseTab(client);
    launcher.kill();
    console.log('[Auth] Chrome closed. Authentication workflow finished.');
  }
}

runAuthentication().catch(console.error);
