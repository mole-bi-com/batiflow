/// <reference path="../../../types.d.ts" />
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { runBatiFlowCapture } from '../index';
import { ProfileManager } from '../cdp/ProfileManager';
import { ChromeLauncher } from '../cdp/ChromeLauncher';
import { TabPool } from '../cdp/TabPool';
import { LlmProcessor } from '../llm/LlmProcessor';
import { ThreadsListParser } from '../sources/threads/ThreadsListParser';
import * as dotenv from 'dotenv';

// Load environment variables
const projectRoot = path.resolve(__dirname, '../../..');
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

interface RegistrySchema {
  lastSyncTimestamp: string;
  processedUrls: Record<string, string>;
}

const REGISTRY_IO_RETRY_DELAYS_MS = [100, 250, 500, 1000, 2000];
const registryRetryWaitBuffer = new Int32Array(new SharedArrayBuffer(4));

export class IngestWorker {
  private registryPath: string;
  private profileManager: ProfileManager;

  constructor(registryPath?: string) {
    if (registryPath) {
      this.registryPath = registryPath;
    } else {
      const vaultPath = process.env.OBSIDIAN_VAULT_PATH;
      if (vaultPath && fs.existsSync(vaultPath)) {
        this.registryPath = path.join(vaultPath, '.batiflow-registry.json');
        // Proactively migrate existing local registry if it exists and vault registry doesn't
        const localRegistryPath = path.join(__dirname, 'ingest-registry.json');
        if (fs.existsSync(localRegistryPath) && !fs.existsSync(this.registryPath)) {
          try {
            fs.copyFileSync(localRegistryPath, this.registryPath);
            console.log(`[IngestWorker] Migrated local registry to Obsidian Vault: ${this.registryPath}`);
          } catch (e: any) {
            console.warn(`[IngestWorker] Failed to migrate registry: ${e.message}`);
          }
        }
      } else {
        this.registryPath = path.join(__dirname, 'ingest-registry.json');
      }
    }
    this.profileManager = new ProfileManager();
  }

  private withRegistryRetry<T>(operation: 'read' | 'write', action: () => T): T {
    let lastError: unknown;

    for (let attempt = 0; attempt <= REGISTRY_IO_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return action();
      } catch (error) {
        lastError = error;
        if (
          (error as NodeJS.ErrnoException).code === 'ENOENT' ||
          attempt === REGISTRY_IO_RETRY_DELAYS_MS.length
        ) {
          break;
        }

        const delayMs = REGISTRY_IO_RETRY_DELAYS_MS[attempt];
        console.warn(
          `[IngestWorker] Registry ${operation} failed; retrying in ${delayMs}ms ` +
          `(attempt ${attempt + 1}/${REGISTRY_IO_RETRY_DELAYS_MS.length + 1}).`
        );
        Atomics.wait(registryRetryWaitBuffer, 0, 0, delayMs);
      }
    }

    throw lastError;
  }

  /**
   * Loads the duplication registry JSON.
   */
  public loadRegistry(): RegistrySchema {
    try {
      const registryJson = this.withRegistryRetry('read', () =>
        fs.readFileSync(this.registryPath, 'utf8')
      );
      return JSON.parse(registryJson);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
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
  public saveRegistry(registry: RegistrySchema): void {
    registry.lastSyncTimestamp = new Date().toISOString();
    this.withRegistryRetry('write', () =>
      fs.writeFileSync(this.registryPath, JSON.stringify(registry, null, 2), 'utf8')
    );
    console.log(`[IngestWorker] Saved state registry to ${this.registryPath}`);
  }

  /**
   * Triggers a native macOS desktop notification.
   */
  private notifyMacUser(message: string): void {
    try {
      const appleScript = `display notification "${message}" with title "BatiFlow Brain Engine" sound name "Glass"`;
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

    let nodePath = execSync('which node', { encoding: 'utf8' }).trim() || '/usr/local/bin/node';
    try {
      const node24Prefix = execSync('brew --prefix node@24', { encoding: 'utf8' }).trim();
      const node24Path = path.join(node24Prefix, 'bin/node');
      if (fs.existsSync(node24Path)) {
        nodePath = node24Path;
      }
    } catch (e) {
      console.warn('[IngestWorker] Homebrew Node 24 not found; using the active Node executable.');
    }
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
      throw err;
    }
  }

  /**
   * Orchestrates the multi-platform synchronization loop.
   */
  public async syncAll(): Promise<{
    successCount: number;
    totalCount: number;
    capturedItems: Array<{
      url: string;
      platform: string;
      author: string;
      summary: string;
      tags: string[];
      scrapPath: string;
      score: number;
    }>;
    reportPath?: string;
  }> {
    console.log('🔄 [IngestWorker] Initializing Automated Multi-Platform Sync...');
    const registry = this.loadRegistry();
    const llmProcessor = new LlmProcessor();

    // Stage 1: Collect candidate entries from all platforms
    // Each entry: { url, textPreview, author, datetime }
    const candidateEntries: Array<{ url: string; textPreview: string; author: string; datetime: string }> = [];

    // 1. Process X/Twitter — Home Timeline (팔로우 계정 24h 내 새 글)
    const xSession = this.profileManager.loadAndDecryptSession('x');
    if (xSession && xSession.length > 0) {
      console.log('\n[IngestWorker] Scanning X Home Timeline for new posts (24h)...');
      const xLauncher = new ChromeLauncher({ headless: false });
      const xPool = new TabPool();
      try {
        await xLauncher.launch();
        const client = await xPool.acquireTab();
        const rawClient = client.getRawClient();
        const { Network } = rawClient;
        await Network.setCookies({ cookies: xSession });

        console.log('[IngestWorker] Navigating to X home timeline...');
        await client.navigate('https://x.com/home');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Try clicking "Following" tab for chronological order
        try {
          await client.evaluate(`
            (() => {
              const tabs = document.querySelectorAll('a[role="tab"]');
              for (const tab of tabs) {
                if (tab.textContent?.toLowerCase().includes('following')) {
                  tab.click();
                  return true;
                }
              }
              // Alternative: div[role="tablist"] > div[role="presentation"]
              return false;
            })()
          `);
          console.log('[IngestWorker] Clicked "Following" tab for chronological feed.');
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch {
          console.log('[IngestWorker] Could not click Following tab, using default feed.');
        }

        // Scroll aggressively to load more tweets
        console.log('[IngestWorker] Scrolling timeline to load posts...');
        for (let i = 0; i < 8; i++) {
          await client.evaluate('window.scrollBy(0, 1500)');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        await client.evaluate('window.scrollTo({ top: 0 })');
        await new Promise(resolve => setTimeout(resolve, 500));

        // Extract tweet entries (URL + textPreview + author + datetime), filter by 24h
        const xRawJson = await client.evaluate<string>(`
          (() => {
            const now = Date.now();
            const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
            const results = [];

            const articles = document.querySelectorAll('article[data-testid="tweet"]');
            for (const article of articles) {
              // Extract tweet URL
              const link = article.querySelector('a[href*="/status/"]');
              if (!link) continue;
              const href = (link as HTMLAnchorElement).href;
              try {
                const urlObj = new URL(href);
                const pathParts = urlObj.pathname.split('/').filter(Boolean);
                const statusIdx = pathParts.indexOf('status');
                if (statusIdx === -1 || !pathParts[statusIdx + 1]) continue;
                const id = pathParts[statusIdx + 1];
                const afterId = pathParts[statusIdx + 2];
                if (!/^[0-9]+$/.test(id) || afterId) continue;
              } catch { continue; }

              // Extract timestamp
              const timeEl = article.querySelector('time');
              if (!timeEl) continue;
              const datetime = timeEl.getAttribute('datetime');
              if (!datetime) continue;
              const tweetTime = new Date(datetime).getTime();
              if (isNaN(tweetTime)) continue;
              if (tweetTime < twentyFourHoursAgo) continue;

              // Canonical URL
              const urlObj = new URL(href);
              const url = urlObj.origin + urlObj.pathname;

              // Extract author handle
              let author = 'Unknown';
              const authorLink = article.querySelector('a[role="link"]');
              if (authorLink && authorLink.textContent) {
                const parts = authorLink.textContent.trim().split(/\\s+/);
                author = parts.find(p => p.startsWith('@')) || parts[0] || 'Unknown';
              }

              // Extract text preview (~250 chars)
              let textPreview = '';
              const textDiv = article.querySelector('[data-testid="tweetText"]');
              if (textDiv && textDiv.textContent) {
                textPreview = textDiv.textContent.slice(0, 250);
              }

              results.push(JSON.stringify({ url, textPreview: textPreview || '(no text)', author, datetime }));
            }
            return JSON.stringify(results);
          })()
        `);

        let xEntries: Array<{ url: string; textPreview: string; author: string; datetime: string }> = [];
        try {
          xEntries = JSON.parse(xRawJson);
        } catch {
          console.error('[IngestWorker] Failed to parse X entries JSON.');
          xEntries = [];
        }

        console.log(`[IngestWorker] Found ${xEntries.length} tweets from followed accounts within 24h.`);
        xEntries.forEach(entry => {
          if (!registry.processedUrls[entry.url]) {
            candidateEntries.push(entry);
          } else {
            console.log(`  (skipped, already processed: ${entry.url})`);
          }
        });

        await xPool.releaseTab(client);
        xLauncher.kill();
      } catch (e: any) {
        console.error(`⚠️ [IngestWorker] X timeline scanning failed: ${e.message}`);
        xLauncher.kill();
      }
    }

    // 2. Process Threads — Following Timeline (팔로우 계정 24h 내 새 글)
    const threadsSession = this.profileManager.loadAndDecryptSession('threads');
    if (threadsSession && threadsSession.length > 0) {
      console.log('\\n[IngestWorker] Scanning Threads Following feed (24h)...');
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
        const threadsEntries = await threadsParser.parseList();
        console.log(`[IngestWorker] Found ${threadsEntries.length} Threads posts from Following feed within 24h.`);
        threadsEntries.forEach(entry => {
          if (!registry.processedUrls[entry.url]) {
            candidateEntries.push({
              url: entry.url,
              textPreview: entry.textPreview,
              author: entry.author,
              datetime: entry.datetime
            });
          } else {
            console.log(`  (skipped, already processed: ${entry.url})`);
          }
        });

        await threadsPool.releaseTab(client);
        threadsLauncher.kill();
      } catch (e: any) {
        console.error(`⚠️ [IngestWorker] Threads scanning failed: ${e.message}`);
        threadsLauncher.kill();
      }
    }
    // (Instagram/YouTube 자동수집 제거됨 — 링크/이미지 공유 시에만 분석)

    // ──────────────────────────────────────────────────────────────
    // Stage 2: AI Relevance Filtering
    // ──────────────────────────────────────────────────────────────
    console.log(`\n🧠 [IngestWorker] Collected ${candidateEntries.length} total candidate posts from all platforms.`);
    console.log('[IngestWorker] Running AI relevance filter against research profile...');

    const relevantEntries = await llmProcessor.batchJudgeRelevance(
      candidateEntries.map(e => ({ url: e.url, textPreview: e.textPreview, author: e.author })),
      0.4  // threshold: 0.4 이상만 통과
    );

    console.log(`\n📬 [IngestWorker] AI filter passed: ${relevantEntries.length}/${candidateEntries.length} posts deemed relevant.`);

    // Build a set of relevant URLs for quick lookup
    const relevanceMap = new Map<string, { score: number; reason: string }>();
    relevantEntries.forEach(r => relevanceMap.set(r.url, { score: r.relevanceScore, reason: r.relevanceReason }));

    const newUrls = relevantEntries.map(r => r.url);

    // 3. Cooldown and begin capture
    if (newUrls.length === 0) {
      this.saveRegistry(registry);
      console.log('✅ [IngestWorker] AI filter passed no relevant posts. Sync complete.');
      this.notifyMacUser('BatiFlow 동기화 완료: 관련성 높은 새 포스트가 없습니다 🧠');
      return {
        successCount: 0,
        totalCount: 0,
        capturedItems: []
      };
    }

    console.log('⏳ Cooldown delay (3.5s) to allow previous Chrome sessions to fully terminate...');
    await new Promise(resolve => setTimeout(resolve, 3500));
    console.log(`\n📬 [IngestWorker] Capturing ${newUrls.length} AI‑filtered relevant posts...`);
    
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
        let result: any;
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
          console.log(`[IngestWorker] YouTube URL detected. Invoking YouTube Ingest Engine...`);
          const projectDir = path.resolve(__dirname, '../../..');
          const scriptPath = path.join(projectDir, 'packages/capture/youtube/ingest-single-youtube.ts');
          const command = `npx ts-node "${scriptPath}" --url "${url}"`;
          
          try {
            console.log(`[IngestWorker] Running command: ${command}`);
            const stdout = execSync(command, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
            
            const urlObj = new URL(url);
            const videoId = urlObj.searchParams.get('v') || url.split('/').pop()?.split('?')[0];
            const scrapPath = path.join(projectDir, 'scrap/youtube', videoId || '');
            
            let summary = '';
            const summaryMatch = stdout.match(/---SUMMARY_START---([\s\S]*?)---SUMMARY_END---/);
            if (summaryMatch && summaryMatch[1]) {
              summary = summaryMatch[1].trim();
            } else {
              summary = 'YouTube video successfully analyzed. See Obsidian note for details.';
            }

            result = {
              success: true,
              scrapPath,
              score: 1.0,
              summary
            };
          } catch (err: any) {
            console.error(`[IngestWorker] YouTube ingest process failed: ${err.message}`);
            result = { success: false };
          }
        } else {
          result = await runBatiFlowCapture({ url, useFallback: true, filter24Hours: true });
        }

        if (result && result.success && result.scrapPath) {
          if (result.skippedAge) {
            console.log(`[IngestWorker] Skipping post registration/processing because it is older than 24 hours.`);
            registry.processedUrls[url] = new Date().toISOString();
            try {
              fs.rmSync(result.scrapPath, { recursive: true, force: true });
            } catch (rmErr) {
              console.warn(`[IngestWorker] Failed to delete skipped scrap directory: ${result.scrapPath}`);
            }
            continue;
          }
          registry.processedUrls[url] = new Date().toISOString();
          successCount++;

          // Extract analysis info
          let summary = result.summary || '';
          let tags: string[] = [];
          let author = 'Unknown';
          try {
            const analysisPath = path.join(result.scrapPath, 'analysis.json');
            const extractionPath = path.join(result.scrapPath, 'extraction.json');
            if (fs.existsSync(analysisPath)) {
              const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
              if (!summary) summary = analysis.summary || '';
              tags = analysis.tags || [];
            }
            if (fs.existsSync(extractionPath)) {
              const extraction = JSON.parse(fs.readFileSync(extractionPath, 'utf8'));
              author = extraction.author || 'Unknown';
            }
          } catch (err) {
            console.warn('[IngestWorker] Failed to parse analysis details:', err);
          }

          if (url.includes('youtube.com') || url.includes('youtu.be')) {
            author = 'YouTube';
            if (!summary) summary = 'YouTube video successfully analyzed.';
            tags = ['youtube', 'video'];
          }

          capturedItems.push({
            url,
            platform: url.includes('youtube.com') || url.includes('youtu.be') ? 'YouTube' :
                      url.includes('x.com') || url.includes('twitter.com') ? 'X (Twitter)' :
                      url.includes('threads.net') || url.includes('threads.com') ? 'Threads' :
                      url.includes('instagram.com') ? 'Instagram' : 'Unknown',
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

    // 5.5. Generate Obsidian Intelligence Summary Report
    const timestampStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const dateFileStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timeFileStr = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const reportFilename = `Intelligence Sync Report - ${dateFileStr}_${timeFileStr}.md`;
    
    const projectDir = path.resolve(__dirname, '../../..');
    const vaultBaseDir = process.env.OBSIDIAN_VAULT_PATH || path.join(projectDir, 'vault');
    const vaultReportsDir = path.join(vaultBaseDir, 'Reports');
    if (!fs.existsSync(vaultReportsDir)) {
      fs.mkdirSync(vaultReportsDir, { recursive: true });
    }
    const reportPath = path.join(vaultReportsDir, reportFilename);

    let reportMarkdown = `---
# 🧠 BatiFlow Brain Engine Sync Report
> **Sync Timestamp**: \`${timestampStr}\`
> **Sync Result**: Successfully imported \`${successCount} / ${newUrls.length}\` new insights
> **AI Relevance Filter**: \`${relevantEntries.length}/${candidateEntries.length}\` posts passed (threshold 0.4)

---

`;

    if (capturedItems.length === 0) {
      reportMarkdown += `## 📊 Platform Sync Overview
- X (Twitter): \`0 new items\`
- Threads: \`0 new items\`

> [!TIP]
> **AI Relevance filter found no relevant posts in this cycle.** ✨ Try adjusting the threshold or check back later.
`;
    } else {
      const counts = { 'X (Twitter)': 0, 'Threads': 0 };
      capturedItems.forEach(item => {
        const plat = item.platform as keyof typeof counts;
        if (counts[plat] !== undefined) counts[plat]++;
      });

      reportMarkdown += `## 📊 Platform Sync Overview
- **X (Twitter)**: \`${counts['X (Twitter)']} new items\`
- **Threads**: \`${counts['Threads']} new items\`

---

## 📥 AI‑Filtered Insights (by Relevance)

`;

      // Sort by score descending (relevance first)
      const sorted = [...capturedItems].sort((a, b) => {
        const aRel = relevanceMap.get(a.url)?.score || 0;
        const bRel = relevanceMap.get(b.url)?.score || 0;
        return bRel - aRel;
      });

      sorted.forEach(item => {
        const relInfo = relevanceMap.get(item.url);
        const relScore = relInfo?.score ?? 0.5;
        const relReason = relInfo?.reason ?? '';
        const stars = relScore >= 0.8 ? '⭐⭐' : relScore >= 0.6 ? '⭐' : '';

        reportMarkdown += `### ${stars} ${item.author} (${item.platform})
- **Relevance**: \`${(relScore * 100).toFixed(0)}%\` — ${relReason}
- **Original Link**: [View Post](${item.url})
- **Tags**: ${item.tags.map(t => '\`#' + t + '\`').join(' ')}

> [!NOTE] 핵심 요약 (Executive Summary)
> ${item.summary || 'DeepSeek analysis was not performed or failed for this item.'}

---
`;
      });
    }

    reportMarkdown += `\n\n*Generated by BatiFlow Brain Engine v1.0 Background Sync*\n`;

    fs.writeFileSync(reportPath, reportMarkdown, 'utf8');
    console.log(`[IngestWorker] Daily Intelligence Summary report successfully generated at: ${reportPath}`);

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

    return {
      successCount,
      totalCount: newUrls.length,
      capturedItems,
      reportPath
    };
  }
}

// Support running from CLI
if (require.main === module) {
  const worker = new IngestWorker();
  const args = process.argv.slice(2);
  
  if (args.includes('--register-plist')) {
    worker.registerLaunchAgent();
  } else if (args.includes('--sync')) {
    worker.syncAll().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  } else if (args.includes('--url')) {
    const urlIndex = args.indexOf('--url');
    const url = args[urlIndex + 1];
    if (!url) {
      console.error('❌ Missing URL parameter after --url');
      process.exit(1);
    }
    
    console.log(`[IngestWorker] Triggering single URL capture for: ${url}`);
    
    (async () => {
      try {
        const result = await runBatiFlowCapture({ url, useFallback: true });
        if (result && result.success && result.scrapPath) {
          const registry = worker.loadRegistry();
          registry.processedUrls[url] = new Date().toISOString();
          worker.saveRegistry(registry);
          console.log(`🎉 Success: Ingested single URL and registered to database.`);
          console.log(`BATIFLOW_RESULT_PATH=${path.join(result.scrapPath, 'post.md')}`);
        } else {
          console.error(`❌ Capture failed for: ${url}`);
          process.exit(1);
        }
      } catch (err: any) {
        console.error(`❌ Error capturing single URL: ${err.message}`);
        process.exit(1);
      }
    })();
  } else {
    console.log('BatiFlow Ingest Worker CLI options:');
    console.log('  --sync            Triggers immediate list synchronization');
    console.log('  --register-plist  Generates and registers com.batiflow.ingest.plist LaunchAgent');
    console.log('  --url <URL>       Ingests a single specific social post URL and saves it to the registry');
  }
}
