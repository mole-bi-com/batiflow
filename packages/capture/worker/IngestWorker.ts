/// <reference path="../../../types.d.ts" />
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { runBatiFlowCapture } from '../index';
import { ProfileManager } from '../cdp/ProfileManager';
import { ChromeLauncher } from '../cdp/ChromeLauncher';
import { TabPool } from '../cdp/TabPool';
import { XListParser } from '../sources/x/XListParser';
import { LinkedInListParser } from '../sources/linkedin/LinkedInListParser';
import { ThreadsListParser } from '../sources/threads/ThreadsListParser';
import { InstagramListParser } from '../sources/instagram/InstagramListParser';

interface RegistrySchema {
  lastSyncTimestamp: string;
  processedUrls: Record<string, string>;
}

export class IngestWorker {
  private registryPath: string;
  private profileManager: ProfileManager;

  constructor() {
    this.registryPath = path.join(__dirname, 'ingest-registry.json');
    this.profileManager = new ProfileManager();
  }

  /**
   * Loads the duplication registry JSON.
   */
  private loadRegistry(): RegistrySchema {
    if (fs.existsSync(this.registryPath)) {
      try {
        return JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
      } catch (e) {
        console.error('[IngestWorker] Failed to parse registry, returning empty state.');
      }
    }
    return {
      lastSyncTimestamp: '',
      processedUrls: {}
    };
  }

  /**
   * Saves the duplication registry JSON.
   */
  private saveRegistry(registry: RegistrySchema): void {
    registry.lastSyncTimestamp = new Date().toISOString();
    fs.writeFileSync(this.registryPath, JSON.stringify(registry, null, 2), 'utf8');
    console.log(`[IngestWorker] Saved state registry to ${this.registryPath}`);
  }

  /**
   * Triggers a native macOS desktop notification.
   */
  private notifyMacUser(message: string): void {
    try {
      const appleScript = `display notification "${message}" with title "BatiFlow Intel Engine" sound name "Glass"`;
      execSync(`osascript -e '${appleScript}'`);
    } catch (e) {
      console.warn('[IngestWorker] Native macOS notification failed to trigger.');
    }
  }

  /**
   * Automatically executes LaunchAgent registration for macOS.
   */
  public registerLaunchAgent(): void {
    console.log('[IngestWorker] Registering com.batiflow.ingest macOS LaunchAgent...');
    
    const projectDir = path.resolve(__dirname, '../../..');
    const plistName = 'com.batiflow.ingest.plist';
    const userLaunchAgentsDir = path.join(os.homedir(), 'Library/LaunchAgents');
    const targetPlistPath = path.join(userLaunchAgentsDir, plistName);

    if (!fs.existsSync(userLaunchAgentsDir)) {
      fs.mkdirSync(userLaunchAgentsDir, { recursive: true });
    }

    const nodePath = execSync('which node', { encoding: 'utf8' }).trim() || '/usr/local/bin/node';
    const tsNodePath = execSync('which ts-node', { encoding: 'utf8' }).trim() || path.join(projectDir, 'node_modules/.bin/ts-node');

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.batiflow.ingest</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${projectDir}/node_modules/.bin/ts-node</string>
        <string>${projectDir}/packages/capture/worker/IngestWorker.ts</string>
        <string>--sync</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>22</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>${projectDir}/scrap/worker.log</string>
    <key>StandardErrorPath</key>
    <string>${projectDir}/scrap/worker.err</string>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>`;

    fs.writeFileSync(targetPlistPath, plistContent, 'utf8');
    fs.writeFileSync(path.join(projectDir, plistName), plistContent, 'utf8'); // Also keep locally
    console.log(`[IngestWorker] Plist successfully written to: ${targetPlistPath}`);

    try {
      // Unload if already loaded
      try {
        execSync(`launchctl unload "${targetPlistPath}" 2>/dev/null`);
      } catch (e) {}
      
      // Load agent
      execSync(`launchctl load "${targetPlistPath}"`);
      console.log('✅ IngestWorker LaunchAgent successfully registered and activated under macOS launchd!');
      this.notifyMacUser('BatiFlow Daily Sync Daemon registered successfully!');
    } catch (err: any) {
      console.error(`❌ Failed to load LaunchAgent via launchctl: ${err.message}`);
    }
  }

  /**
   * Orchestrates the multi-platform synchronization loop.
   */
  public async syncAll(): Promise<void> {
    console.log('\n🔄 [IngestWorker] Initializing Automated Multi-Platform Sync...');
    const registry = this.loadRegistry();
    const newUrls: string[] = [];

    // 1. Process X/Twitter
    const xSession = this.profileManager.loadAndDecryptSession('x');
    if (xSession && xSession.length > 0) {
      console.log('\n[IngestWorker] Scanning X (Twitter) Likes...');
      const xLauncher = new ChromeLauncher({ headless: true });
      const xPool = new TabPool();
      try {
        await xLauncher.launch();
        const client = await xPool.acquireTab();
        const rawClient = client.getRawClient();
        const { Network } = rawClient;
        await Network.setCookies({ cookies: xSession });

        const xParser = new XListParser(client);
        console.log('[IngestWorker] Navigating to x.com to resolve username dynamically...');
        await client.navigate('https://x.com');
        await new Promise(resolve => setTimeout(resolve, 4000));
        
        const username = await client.evaluate<string>(`
          (() => {
            const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]') || 
                                document.querySelector('[data-testid="SideNav_AccountSidebar_ProfileLink"]');
            if (profileLink) {
              const href = profileLink.getAttribute('href') || '';
              return href.replace('/', '').trim();
            }
            return '';
          })()
        `);
        
        if (!username) {
          throw new Error('Failed to resolve logged-in X username. Please check your credentials/cookies.');
        }
        
        console.log(`[IngestWorker] Resolved username: @${username}`);
        const likesUrl = `https://x.com/${username}/likes`;
        const xUrls = await xParser.parseList(likesUrl);
        xUrls.forEach(url => {
          if (!registry.processedUrls[url] && !newUrls.includes(url)) {
            newUrls.push(url);
          }
        });

        await xPool.releaseTab(client);
        xLauncher.kill();
      } catch (e: any) {
        console.error(`⚠️ [IngestWorker] X scanning failed: ${e.message}`);
        xLauncher.kill();
      }
    }

    // 2. Process LinkedIn
    const liSession = this.profileManager.loadAndDecryptSession('linkedin');
    if (liSession && liSession.length > 0) {
      console.log('\n[IngestWorker] Scanning LinkedIn Saved Posts...');
      const liLauncher = new ChromeLauncher({ headless: true });
      const liPool = new TabPool();
      try {
        await liLauncher.launch();
        const client = await liPool.acquireTab();
        const rawClient = client.getRawClient();
        const { Network } = rawClient;
        await Network.clearBrowserCookies();
        await Network.setCookies({ cookies: liSession });

        const liParser = new LinkedInListParser(client);
        const liUrls = await liParser.parseList();
        liUrls.forEach(url => {
          if (!registry.processedUrls[url] && !newUrls.includes(url)) {
            newUrls.push(url);
          }
        });

        await liPool.releaseTab(client);
        liLauncher.kill();
      } catch (e: any) {
        console.error(`⚠️ [IngestWorker] LinkedIn scanning failed: ${e.message}`);
        liLauncher.kill();
      }
    }

    // 3. Process Threads
    const threadsSession = this.profileManager.loadAndDecryptSession('threads');
    if (threadsSession && threadsSession.length > 0) {
      console.log('\n[IngestWorker] Scanning Threads Likes...');
      const threadsLauncher = new ChromeLauncher({ headless: false });
      const threadsPool = new TabPool();
      try {
        await threadsLauncher.launch();
        const client = await threadsPool.acquireTab();
        const rawClient = client.getRawClient();
        const { Network } = rawClient;
        await Network.clearBrowserCookies();
        await Network.setCookies({ cookies: threadsSession });

        const threadsParser = new ThreadsListParser(client);
        const threadsUrls = await threadsParser.parseList();
        threadsUrls.forEach(url => {
          if (!registry.processedUrls[url] && !newUrls.includes(url)) {
            newUrls.push(url);
          }
        });

        await threadsPool.releaseTab(client);
        threadsLauncher.kill();
      } catch (e: any) {
        console.error(`⚠️ [IngestWorker] Threads scanning failed: ${e.message}`);
        threadsLauncher.kill();
      }
    }

    // 4. Process Instagram
    const igSession = this.profileManager.loadAndDecryptSession('instagram');
    if (igSession && igSession.length > 0) {
      console.log('\n[IngestWorker] Scanning Instagram Saved Posts...');
      const igLauncher = new ChromeLauncher({ headless: false });
      const igPool = new TabPool();
      try {
        await igLauncher.launch();
        const client = await igPool.acquireTab();
        const rawClient = client.getRawClient();
        const { Network } = rawClient;
        await Network.clearBrowserCookies();
        await Network.setCookies({ cookies: igSession });

        const igParser = new InstagramListParser(client);
        const igUrls = await igParser.parseList();
        igUrls.forEach(url => {
          if (!registry.processedUrls[url] && !newUrls.includes(url)) {
            newUrls.push(url);
          }
        });

        await igPool.releaseTab(client);
        igLauncher.kill();
      } catch (e: any) {
        console.error(`⚠️ [IngestWorker] Instagram scanning failed: ${e.message}`);
        igLauncher.kill();
      }
    }

    // 5. Ingest and Capture New Posts sequentially
    console.log(`\n📬 [IngestWorker] Found ${newUrls.length} new bookmark URLs to ingest.`);

    // ✅ 신규 항목이 없으면 리포트 생성 없이 바로 종료
    if (newUrls.length === 0) {
      this.saveRegistry(registry);
      console.log('✅ [IngestWorker] 모든 플랫폼이 최신 상태입니다. 새 인사이트가 없습니다.');
      this.notifyMacUser('BatiFlow 동기화 완료: 새로운 인사이트가 없습니다 ✨');
      return;
    }
    
    const capturedItems: Array<{
      url: string;
      platform: string;
      author: string;
      summary: string;
      tags: string[];
      scrapPath: string;
      score: number;
    }> = [];

    let successCount = 0;
    for (let i = 0; i < newUrls.length; i++) {
      const url = newUrls[i];
      console.log(`\n📥 [IngestWorker] Ingesting (${i + 1}/${newUrls.length}): ${url}`);
      
      try {
        const result = await runBatiFlowCapture({ url, useFallback: true });
        if (result && result.success && result.scrapPath) {
          registry.processedUrls[url] = new Date().toISOString();
          successCount++;

          // Extract analysis info
          let summary = '';
          let tags: string[] = [];
          let author = 'Unknown';
          try {
            const analysisPath = path.join(result.scrapPath, 'analysis.json');
            const extractionPath = path.join(result.scrapPath, 'extraction.json');
            if (fs.existsSync(analysisPath)) {
              const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
              summary = analysis.summary || '';
              tags = analysis.tags || [];
            }
            if (fs.existsSync(extractionPath)) {
              const extraction = JSON.parse(fs.readFileSync(extractionPath, 'utf8'));
              author = extraction.author || 'Unknown';
            }
          } catch (err) {
            console.warn('[IngestWorker] Failed to parse analysis details:', err);
          }

          capturedItems.push({
            url,
            platform: url.includes('x.com') || url.includes('twitter.com') ? 'X (Twitter)' :
                      url.includes('threads.net') || url.includes('threads.com') ? 'Threads' :
                      url.includes('instagram.com') ? 'Instagram' : 'LinkedIn',
            author,
            summary,
            tags,
            scrapPath: result.scrapPath,
            score: result.score || 0
          });
        }
      } catch (err: any) {
        console.error(`⚠️ [IngestWorker] Failed to capture URL ${url}: ${err.message}`);
      }

      // Give 2s delay between sequential captures to prevent rate-limiting triggers
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // 5.5. Generate Obsidian Intel Summary Report
    const timestampStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const dateFileStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timeFileStr = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const reportFilename = `Intel Sync Report - ${dateFileStr}_${timeFileStr}.md`;
    
    const projectDir = path.resolve(__dirname, '../../..');
    const vaultInboxDir = path.join(projectDir, 'vault/Inbox');
    if (!fs.existsSync(vaultInboxDir)) {
      fs.mkdirSync(vaultInboxDir, { recursive: true });
    }
    const reportPath = path.join(vaultInboxDir, reportFilename);

    let reportMarkdown = `---
# 🧠 BatiFlow Intel Engine Sync Report
> **Sync Timestamp**: \`${timestampStr}\`
> **Sync Result**: Successfully imported \`${successCount} / ${newUrls.length}\` new insights

---

`;

    if (capturedItems.length === 0) {
      reportMarkdown += `## 📊 Platform Sync Overview
- X (Twitter): \`0 new items\`
- Threads: \`0 new items\`
- LinkedIn: \`0 new items\`
- Instagram: \`0 new items\`

> [!TIP]
> **All platform feeds are completely up to date!** ✨ No new bookmarks or liked posts were found.
`;
    } else {
      const counts = { 'X (Twitter)': 0, 'Threads': 0, 'LinkedIn': 0, 'Instagram': 0 };
      capturedItems.forEach(item => {
        const plat = item.platform as keyof typeof counts;
        if (counts[plat] !== undefined) counts[plat]++;
      });

      reportMarkdown += `## 📊 Platform Sync Overview
- **X (Twitter)**: \`${counts['X (Twitter)']} new items\`
- **Threads**: \`${counts['Threads']} new items\`
- **LinkedIn**: \`${counts['LinkedIn']} new items\`
- **Instagram**: \`${counts['Instagram']} new items\`

---

## 📥 Newly Captured Insights

`;

      capturedItems.forEach(item => {
        reportMarkdown += `### 👤 ${item.author} (${item.platform})
- **Original Link**: [View Post](${item.url})
- **Reality Checker Score**: \`${item.score} / 1.0\`
- **Tags**: ${item.tags.map(t => `\`#${t}\``).join(' ')}

> [!NOTE] 핵심 요약 (Executive Summary)
> ${item.summary || 'DeepSeek analysis was not performed or failed for this item.'}

---

`;
      });
    }

    reportMarkdown += `\n\n*Generated by BatiFlow Intel Engine v1.0 Background Sync*\n`;

    fs.writeFileSync(reportPath, reportMarkdown, 'utf8');
    console.log(`[IngestWorker] Daily Intel Summary report successfully generated at: ${reportPath}`);

    // 6. Finalize state
    this.saveRegistry(registry);
    const syncSummary = `BatiFlow Auto-Sync: Successfully imported ${successCount} / ${newUrls.length} new posts to Obsidian! 🧠`;
    console.log(`\n🎉 [IngestWorker] Sync batch completed! ${syncSummary}`);
    this.notifyMacUser(syncSummary);

    // Open the report file directly in Obsidian!
    try {
      execSync(`open -a Obsidian "${reportPath}"`);
      console.log(`[IngestWorker] Obsidian opened with report: ${reportFilename}`);
    } catch (obsErr: any) {
      console.warn('[IngestWorker] Failed to open report in Obsidian automatically:', obsErr.message);
    }
  }
}

// Support running from CLI
if (require.main === module) {
  const worker = new IngestWorker();
  const args = process.argv.slice(2);
  
  if (args.includes('--register-plist')) {
    worker.registerLaunchAgent();
  } else if (args.includes('--sync')) {
    worker.syncAll().catch(console.error);
  } else {
    console.log('BatiFlow Ingest Worker CLI options:');
    console.log('  --sync            Triggers immediate list synchronization');
    console.log('  --register-plist  Generates and registers com.batiflow.ingest.plist LaunchAgent');
  }
}
