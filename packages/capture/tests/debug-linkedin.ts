/// <reference path="../../../types.d.ts" />
import { ChromeLauncher } from '../cdp/ChromeLauncher';
import { TabPool } from '../cdp/TabPool';
import { ProfileManager } from '../cdp/ProfileManager';
import fs from 'fs';
import path from 'path';

async function debugLinkedin() {
  const url = process.argv[2] || 'https://www.linkedin.com/posts/activity-7195484803929481216-928e';
  console.log(`[Debug] Initializing LinkedIn debugger for URL: ${url}`);

  const profileManager = new ProfileManager();
  const launcher = new ChromeLauncher({ headless: true });
  
  try {
    await launcher.launch();
    const pool = new TabPool();
    const client = await pool.acquireTab();
    const rawClient = client.getRawClient();

    // 1. Inject Cookies
    const savedCookies = profileManager.loadAndDecryptSession();
    if (savedCookies && savedCookies.length > 0) {
      console.log(`[Debug] Decrypted and injecting ${savedCookies.length} session cookies...`);
      const { Network } = rawClient;
      await Network.setCookies({ cookies: savedCookies });
    } else {
      console.log('[Debug] No cookies found!');
    }

    // 2. Navigate
    console.log(`[Debug] Navigating to ${url}...`);
    await client.navigate(url);
    
    console.log('[Debug] Waiting 5 seconds for page load...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 3. Evaluate Page State
    const info = await client.evaluate<{
      title: string;
      href: string;
      bodyLength: number;
      bodyTextSnippet: string;
      htmlSnippet: string;
      globalNavExists: boolean;
      loginFormExists: boolean;
      postBodyExists: boolean;
    }>(`
      (() => {
        return {
          title: document.title,
          href: document.location.href,
          bodyLength: document.body ? document.body.innerText.length : 0,
          bodyTextSnippet: document.body ? document.body.innerText.substring(0, 1000) : '',
          htmlSnippet: document.body ? document.body.innerHTML.substring(0, 1000) : '',
          globalNavExists: !!document.querySelector('.global-nav') || !!document.querySelector('#global-nav'),
          loginFormExists: !!document.querySelector('form.login__form') || !!document.querySelector('#username'),
          postBodyExists: !!document.querySelector('.feed-shared-update-v2') || 
                          !!document.querySelector('.feed-shared-inline-show-more-text') ||
                          document.body.innerText.includes("linkedin.com/posts/")
        };
      })()
    `);

    console.log('\n================ PAGE STATE INFO ================');
    console.log(`Title:             "${info.title}"`);
    console.log(`Current URL:       "${info.href}"`);
    console.log(`Body Text Length:  ${info.bodyLength}`);
    console.log(`Global Nav Exists: ${info.globalNavExists}`);
    console.log(`Login Form Exists: ${info.loginFormExists}`);
    console.log(`Post Body Exists:  ${info.postBodyExists}`);
    console.log('-------------------------------------------------');
    console.log('HTML Snippet:');
    console.log(info.htmlSnippet);
    console.log('-------------------------------------------------');
    console.log('Body Text Snippet:');
    console.log(info.bodyTextSnippet);
    console.log('=================================================\n');

    // 4. Capture Screenshot
    console.log('[Debug] Capturing page screenshot...');
    const { Page } = rawClient;
    const { data } = await Page.captureScreenshot({ format: 'png' });
    
    const screenshotDir = path.join(__dirname, '../../../../scrap');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const screenshotPath = path.join(screenshotDir, 'debug-linkedin.png');
    fs.writeFileSync(screenshotPath, Buffer.from(data, 'base64'));
    console.log(`[Debug] Screenshot saved to: ${screenshotPath}`);

    await pool.releaseTab(client);
  } catch (err) {
    console.error('❌ Debugging run crashed:', err);
  } finally {
    launcher.kill();
    console.log('[Debug] Chrome terminated.');
  }
}

debugLinkedin().catch(console.error);
