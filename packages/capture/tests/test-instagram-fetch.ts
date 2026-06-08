import { ChromeLauncher } from '../cdp/ChromeLauncher';
import { TabPool } from '../cdp/TabPool';
import { ProfileManager } from '../cdp/ProfileManager';

async function main() {
  const testUrl = process.argv[2] || 'https://www.instagram.com/p/ClhZzI0uH8W/';
  const shortcode = testUrl.split('/').filter(Boolean).pop()?.split('?')[0] || '';
  console.log(`Test: ${testUrl} (shortcode: ${shortcode})`);

  const launcher = new ChromeLauncher({ headless: false });
  const pool = new TabPool();
  const profileManager = new ProfileManager();

  try {
    await launcher.launch();
    const client = await pool.acquireTab();
    const rawClient = client.getRawClient();

    const savedCookies = profileManager.loadAndDecryptSession('instagram');
    if (savedCookies?.length) {
      const { Network } = rawClient;
      await Network.setCookies({ cookies: savedCookies });
    }

    await client.navigate(testUrl);
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Try direct fetch from within the browser context with credentials
    const result = await client.evaluate<any>(`
      (async () => {
        try {
          const resp = await fetch('https://www.instagram.com/api/graphql', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'variables={"shortcode":"${shortcode}"}&doc_id=10015901848480474&fb_api_caller_class=Relay'
          });
          const text = await resp.text();
          if (text.length > 100 && !text.includes('for (;;)')) {
            try { return { success: true, data: JSON.parse(text).data, textLen: text.length }; }
            catch(e) { return { success: false, error: 'Parse error', text: text.substring(0, 500) }; }
          }
          return { success: false, error: 'Empty response', text: text.substring(0, 200) };
        } catch(e) {
          return { success: false, error: e.message };
        }
      })()
    `);
    
    console.log('\n📋 Direct GraphQL result:');
    console.log(JSON.stringify(result, null, 2).substring(0, 3000));

    // Also try to find any embedded data in the DOM
    const embedded = await client.evaluate<any>(`
      (() => {
        // Look for JSON-LD
        const jld = document.querySelector('script[type="application/ld+json"]');
        const ldData = jld ? jld.textContent?.substring(0, 3000) : null;
        
        // Look for any script with post data
        const scripts = Array.from(document.querySelectorAll('script'));
        let foundPost = null;
        for (const s of scripts) {
          const t = s.textContent || '';
          if (t.includes('shortcode') || t.includes('"caption"') || t.includes('xdt_shortcode')) {
            foundPost = t.substring(0, 3000);
            break;
          }
        }
        
        // Check time elements
        const times = Array.from(document.querySelectorAll('time')).map(t => ({
          datetime: t.getAttribute('datetime'),
          text: t.textContent
        }));
        
        // Check the HTML for any embedded data
        const html = document.documentElement.outerHTML;
        
        return { ldData, foundPost, times, htmlLen: html.length };
      })()
    `);
    
    console.log('\n📋 Embedded data:');
    console.log(JSON.stringify(embedded, null, 2).substring(0, 5000));

    await pool.releaseTab(client);
  } finally {
    launcher.kill();
  }
}

main().catch(console.error);
