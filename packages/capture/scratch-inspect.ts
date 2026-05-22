import { ProfileManager } from './cdp/ProfileManager';
import { ChromeLauncher } from './cdp/ChromeLauncher';
import { TabPool } from './cdp/TabPool';

async function main() {
  console.log('Starting Threads inspection...');
  const profileManager = new ProfileManager();
  const launcher = new ChromeLauncher({ headless: true });
  const pool = new TabPool();

  try {
    const wsUrl = await launcher.launch();
    const client = await pool.acquireTab();
    const rawClient = client.getRawClient();
    const { Network } = rawClient;

    const threadsSession = profileManager.loadAndDecryptSession('threads');
    if (!threadsSession) {
      console.error('No threads session found!');
      return;
    }

    await Network.setCookies({ cookies: threadsSession });
    console.log('Session injected. Navigating to Threads...');
    
    await client.navigate('https://www.threads.net');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('Current URL after load:', await client.evaluate('window.location.href'));

    // Check DOM for profile links or menu buttons
    const linksAndButtons = await client.evaluate<any>(`
      (() => {
        const anchors = Array.from(document.querySelectorAll('a')).map(a => ({
          text: a.innerText.trim(),
          href: a.href,
          testid: a.getAttribute('data-testid')
        }));
        
        return { anchors };
      })()
    `);

    console.log('Found Anchors:', JSON.stringify(linksAndButtons.anchors, null, 2));
    
    // Now let's try to navigate directly to profile or settings
    console.log('Navigating to profile settings menu if possible...');
    await client.navigate('https://www.threads.net/settings');
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('Settings URL:', await client.evaluate('window.location.href'));
    
    const settingsDOM = await client.evaluate(`
      (() => {
        return Array.from(document.querySelectorAll('a, button, div[role="button"]')).map(el => ({
          tag: el.tagName,
          text: el.innerText.trim(),
          href: (el as any).href || '',
          role: el.getAttribute('role')
        }));
      })()
    `);
    console.log('Settings Elements:', JSON.stringify(settingsDOM, null, 2));

    await pool.releaseTab(client);
    launcher.kill();
  } catch (e: any) {
    console.error('Error during inspection:', e.message);
    launcher.kill();
  }
}

main().catch(console.error);
