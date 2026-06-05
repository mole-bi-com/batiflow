/// <reference path="../../../types.d.ts" />
import readline from 'readline';
import { ChromeLauncher } from './ChromeLauncher';
import { TabPool } from './TabPool';
import { ProfileManager } from './ProfileManager';

async function runAuthentication() {
  console.log('====================================================');
  console.log('           BatiFlow YouTube Authenticator           ');
  console.log('====================================================');
  console.log('This tool will open a headful Google Chrome instance.');
  console.log('Please log into YouTube/Google in the browser window.');
  console.log('Once you are fully logged in,');
  console.log('return to this terminal and press ENTER to save session.');
  console.log('====================================================\n');

  // 1. Launch headful Chrome
  const launcher = new ChromeLauncher({ headless: false });
  await launcher.launch();

  // 2. Open tab and load YouTube
  const tabPool = new TabPool();
  const client = await tabPool.acquireTab();
  
  console.log('[Auth] Loading YouTube...');
  await client.navigate('https://www.youtube.com');

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
        'https://www.youtube.com',
        'https://youtube.com',
        'https://accounts.google.com',
        'https://google.com'
      ]
    });

    console.log(`[Auth] Captured ${cookies.length} YouTube/Google session cookies.`);
    
    // 5. Encrypt and save cookies
    const profile = new ProfileManager();
    profile.encryptAndSaveSession(cookies, 'youtube');
    
    console.log('\n✅ Success! YouTube session cookies are encrypted and securely stored.');
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
