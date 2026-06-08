import { ChromeLauncher } from '../cdp/ChromeLauncher';
import { TabPool } from '../cdp/TabPool';
import { ProfileManager } from '../cdp/ProfileManager';

async function main() {
  const testUrl = process.argv[2] || 'https://www.instagram.com/p/ClhZzI0uH8W/';
  console.log(`🔍 Inspecting Instagram page: ${testUrl}\n`);

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

    // Navigate
    await client.navigate(testUrl);
    await new Promise(resolve => setTimeout(resolve, 8000));

    // After loading, check current URL
    const currentUrl = await client.evaluate<string>('window.location.href');
    console.log(`📍 Current URL: ${currentUrl}`);

    // Extract ALL text from the page to understand structure
    const pageAnalysis = await client.evaluate<any>(`(() => {
      const result: any = {};
      
      // 1. Current URL path
      const url = new URL(window.location.href);
      result.urlPath = url.pathname;
      result.urlPathParts = url.pathname.split('/').filter(Boolean);
      
      // 2. Check if we're on a login page
      result.isLoginPage = document.body.innerText.includes('Log in') && document.body.innerText.includes('Sign up');
      result.pageTitle = document.title;
      
      // 3. Check for key Instagram selectors
      result.articleCount = document.querySelectorAll('article').length;
      result.h1Count = document.querySelectorAll('article h1').length;
      result.h1Texts = Array.from(document.querySelectorAll('article h1')).map(h => h.innerText.substring(0, 100));
      
      // 4. All link texts
      result.allLinks = Array.from(document.querySelectorAll('a[href*="/"]')).slice(0, 30).map(a => ({
        text: (a.textContent || '').trim().substring(0, 50),
        href: a.getAttribute('href'),
        class: (a.className || '').substring(0, 80)
      })).filter(l => l.text || l.href);
      
      // 5. Time elements
      result.timeElements = Array.from(document.querySelectorAll('time')).map(t => ({
        datetime: t.getAttribute('datetime'),
        text: t.textContent
      }));
      
      // 6. Span with substantial text
      const spans = Array.from(document.querySelectorAll('span'));
      result.substantialSpans = spans
        .map(s => ({ text: (s.textContent || '').trim().substring(0, 150), class: (s.className || '').substring(0, 60) }))
        .filter(s => s.text.length > 20 && !s.text.includes('Log in') && !s.text.includes('Sign up'))
        .slice(0, 10);
      
      // 7. Check for structured data
      result.jsonLd = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        try { result.jsonLd.push(JSON.parse(s.textContent || '{}')); } catch(e) {}
      });
      
      // 8. First few div class names for structure understanding
      result.firstDivClasses = Array.from(document.querySelectorAll('article > div'))
        .slice(0, 5)
        .map(d => (d.className || '').substring(0, 80));
      
      return result;
    })()`);
    
    console.log(`\n📋 Page Analysis:`);
    console.log(JSON.stringify(pageAnalysis, null, 2).substring(0, 4000));

    await pool.releaseTab(client);
  } finally {
    launcher.kill();
  }
}

main().catch(console.error);
