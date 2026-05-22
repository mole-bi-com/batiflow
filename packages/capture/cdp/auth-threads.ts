/// <reference path="../../../types.d.ts" />
import readline from 'readline';
import { ChromeLauncher } from './ChromeLauncher';
import { TabPool } from './TabPool';
import { ProfileManager } from './ProfileManager';

async function runAuthentication() {
  console.log('====================================================');
  console.log('           BatiFlow Threads Authenticator           ');
  console.log('====================================================');
  console.log('This tool will open a headful Google Chrome instance.');
  console.log('Please log into Threads (threads.net) in the browser window.');
  console.log('Once you are fully logged in and see your feed,');
  console.log('return to this terminal and press ENTER to save session.');
  console.log('====================================================\n');

  // 1. Launch headful Chrome
  const launcher = new ChromeLauncher({ headless: false });
  await launcher.launch();

  // 2. Open tab and load Threads login page
  const tabPool = new TabPool();
  const client = await tabPool.acquireTab();
  
  console.log('[Auth] Loading Threads...');
  await client.navigate('https://www.threads.net/login');

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
      urls: [
        'https://www.threads.net',
        'https://threads.net',
        'https://www.threads.com',
        'https://threads.com'
      ]
    });

    console.log(`[Auth] Captured ${cookies.length} Threads session cookies.`);
    
    // 5. Encrypt and save cookies
    const profile = new ProfileManager();
    profile.encryptAndSaveSession(cookies, 'threads');
    
    console.log('\n✅ Success! Threads session cookies are encrypted and securely stored.');
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
