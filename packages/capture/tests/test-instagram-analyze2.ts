import { ChromeLauncher } from '../cdp/ChromeLauncher';
import { TabPool } from '../cdp/TabPool';
import { ProfileManager } from '../cdp/ProfileManager';

async function main() {
  const testUrl = process.argv[2] || 'https://www.instagram.com/p/ClhZzI0uH8W/';
  console.log(`Test: ${testUrl}`);

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

    await client.navigate(testUrl);
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Extract page structure info
    const result = await client.evaluate<any>(`(() => {
      const r: any = {};
      
      // Current URL
      r.currentUrl = window.location.href;
      r.pathParts = new URL(window.location.href).pathname.split('/').filter(Boolean);
      
      // Check for script data
      r.hasNextData = !!document.getElementById('__NEXT_DATA__');
      r.hasInitialState = !!(window as any).__INITIAL_STATE__;
      
      // Try to find __INITIAL_STATE__ or similar
      const scripts = Array.from(document.querySelectorAll('script:not([src])'));
      for (const s of scripts) {
        const text = s.textContent || '';
        if (text.includes('window.__INITIAL_STATE__') || text.includes('window.__INIT')) {
          r.initialStateFound = true;
          r.initialStatePreview = text.substring(0, 500);
          break;
        }
      }
      
      // Find ALL text from the page body that looks like real content (not JSON/JS)
      const textWalker = document.createTreeWalker(
        document.body, 4, null, false
      );
      const realTexts = [];
      let n;
      while (n = textWalker.nextNode()) {
        const t = n.textContent.trim();
        // Skip: JSON-looking text, <script> contents, very short text
        if (t.length > 15 && t.length < 5000 && 
            !t.startsWith('{') && !t.startsWith('[') && !t.startsWith('for (;;)') &&
            !t.startsWith('window.') && !t.startsWith('function') &&
            !t.includes('Log in') && !t.includes('Sign up') &&
            !t.includes('View all') && !t.includes('comments')) {
          
          // Check if parent is a visible element (not script/style)
          let parent = n.parentElement;
          let isVisible = true;
          while (parent) {
            if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'NOSCRIPT') {
              isVisible = false;
              break;
            }
            parent = parent.parentElement;
          }
          
          if (isVisible) {
            realTexts.push({ text: t.substring(0, 300), tag: n.parentElement?.tagName || '', parentClasses: (n.parentElement?.className || '').substring(0, 60) });
          }
        }
      }
      r.realTexts = realTexts.slice(0, 20);
      
      // Look for share link / author link structure  
      r.links = Array.from(document.querySelectorAll('a[href*="/"]'))
        .slice(0, 20)
        .map(a => ({
          href: a.getAttribute('href'),
          text: (a.textContent || '').trim().substring(0, 50),
          classes: (a.className || '').substring(0, 40)
        }))
        .filter(l => l.href && l.text);
      
      // Look for time elements
      r.timeEls = Array.from(document.querySelectorAll('time'))
        .map(t => ({ datetime: t.getAttribute('datetime'), text: t.textContent }));
      
      // JsonLD
      const jld = document.querySelector('script[type="application/ld+json"]');
      r.jsonLd = jld ? jld.textContent?.substring(0, 1000) : null;
      
      return r;
    })()`);
    
    console.log('\n📋 Analysis:');
    console.log(JSON.stringify(result, null, 2).substring(0, 5000));

    await pool.releaseTab(client);
  } finally {
    launcher.kill();
  }
}

main().catch(console.error);
