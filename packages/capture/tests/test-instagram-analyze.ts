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

    const savedCookies = profileManager.loadAndDecryptSession('instagram');
    if (savedCookies && savedCookies.length > 0) {
      console.log(`Cookies: ${savedCookies.length}`);
      const { Network } = rawClient;
      await Network.setCookies({ cookies: savedCookies });
    }

    // Navigate WITHOUT __a=1
    await client.navigate(testUrl);
    await new Promise(resolve => setTimeout(resolve, 8000));

    const finalUrl = await client.evaluate<string>('window.location.href');
    console.log(`\nFinal URL: ${finalUrl}`);

    // Check if it's an error page
    const pageText = await client.evaluate<string>('document.body.innerText');
    const isError = pageText.includes('문제가 발생') || pageText.includes('Sorry') || pageText.includes('for (;;)');
    console.log(`\nIs error page: ${isError}`);
    
    // If NOT error, analyze structure
    if (!isError) {
      // Check if we're logged in
      const isLoginPage = pageText.toLowerCase().includes('log in') && pageText.toLowerCase().includes('sign up');
      console.log(`Is login page: ${isLoginPage}`);
      
      // Look for the actual Instagram caption
      const analysis = await client.evaluate<any>(`(() => {
        const r: any = {};
        r.currentUrl = window.location.href;
        r.pathParts = new URL(window.location.href).pathname.split('/').filter(Boolean);
        
        // Try to find author - look for the username in the page URL after redirect
        const urlPart = new URL(window.location.href).pathname.split('/').filter(Boolean);
        r.urlUsername = urlPart[0];
        r.isValidUsername = /^[a-zA-Z0-9._]{1,30}$/.test(urlPart[0]) && !['p','reel','stories','explore','accounts','saved'].includes(urlPart[0]);
        
        // Check all article elements
        r.articleCount = document.querySelectorAll('article').length;
        
        // Key selector exploration - find ANY text in the article  
        const allElements = [];
        const walker = document.createTreeWalker(
          document.querySelector('article') || document.body,
          4, // Text nodes only
          null,
          false
        );
        let node;
        while (node = walker.nextNode()) {
          const text = node.textContent.trim();
          if (text.length > 15 && !text.includes('Log in') && !text.includes('Sign up')) {
            allElements.push(text.substring(0, 300));
            if (allElements.length >= 20) break;
          }
        }
        r.textNodes = allElements;
        
        // Check for specific Instagram caption containers  
        r.articleH1 = Array.from(document.querySelectorAll('article h1')).map(h => h.innerText.substring(0, 200));
        r.articleH2 = Array.from(document.querySelectorAll('article h2')).map(h => h.innerText.substring(0, 200));
        
        // All spans in article with non-trivial text
        r.articleSpans = Array.from(document.querySelectorAll('article span'))
          .map(s => ({ text: (s.textContent || '').trim().substring(0, 200), cls: (s.className || '').substring(0, 40) }))
          .filter(s => s.text.length > 10 && !s.text.includes('Log in'))
          .slice(0, 10);
        
        // DIV structure inside article (first few levels)
        r.articleDivs = Array.from(document.querySelectorAll('article div'))
          .slice(0, 5)
          .map(d => {
            const children = d.children;
            const texts = Array.from(children).slice(0, 3).map(c => (c.textContent || '').trim().substring(0, 100));
            return { tag: d.tagName, cls: (d.className || '').substring(0, 60), texts: texts.filter(Boolean) };
          });
        
        return r;
      })()`);
      
      console.log(`\n📋 Analysis:`);
      console.log(JSON.stringify(analysis, null, 2).substring(0, 5000));
    } else {
      console.log(`Page text (first 1000): ${pageText.substring(0, 1000)}`);
    }

    await pool.releaseTab(client);
  } finally {
    launcher.kill();
  }
}

main().catch(console.error);
