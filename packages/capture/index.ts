/// <reference path="../../types.d.ts" />
import * as fs from 'fs';
import * as path from 'path';
import { ChromeLauncher } from './cdp/ChromeLauncher';
import { TabPool } from './cdp/TabPool';
import { ProfileManager } from './cdp/ProfileManager';
import { LinkedInRecon } from './sources/linkedin/LinkedInRecon';
import { LinkedInCapture } from './sources/linkedin/LinkedInCapture';
import { LinkedInVerifier, VerificationReport } from './sources/linkedin/LinkedInVerifier';
import { XRecon } from './sources/x/XRecon';
import { XCapture } from './sources/x/XCapture';
import { XVerifier, XVerificationReport } from './sources/x/XVerifier';
import { PlaywrightCapture } from './fallback/PlaywrightCapture';
import { SkillGate } from './skills/SkillGate';
import { LlmProcessor } from './llm/LlmProcessor';
import { ThreadsCapture } from './sources/threads/ThreadsCapture';
import { ThreadsVerifier } from './sources/threads/ThreadsVerifier';
import { InstagramCapture } from './sources/instagram/InstagramCapture';
import { InstagramVerifier } from './sources/instagram/InstagramVerifier';
import { isOlderThan24Hours } from './utils/date';
import { saveToVault, saveTrace, generateCrossReferences, UnifiedNoteData } from './utils/vaultWriter';


export interface BatiFlowOptions {
  url: string;
  useFallback?: boolean;
  filter24Hours?: boolean;
}

export async function runBatiFlowCapture(options: BatiFlowOptions) {
  const { url, useFallback = true } = options;
  console.log('\n🚀 Starting BatiFlow Capture Pipeline...');
  console.log(`Target URL: ${url}`);

  const profileManager = new ProfileManager();
  const skillGate = new SkillGate();

  // Determine Platform
  let platform: 'linkedin' | 'x' | 'threads' | 'instagram' = 'linkedin';
  if (url.includes('x.com') || url.includes('twitter.com')) {
    platform = 'x';
  } else if (url.includes('threads.net') || url.includes('threads.com')) {
    platform = 'threads';
  } else if (url.includes('instagram.com')) {
    platform = 'instagram';
  }
  console.log(`[Pipeline] Detected platform: ${platform.toUpperCase()}`);

  const headless = (platform === 'linkedin');
  const launcher = new ChromeLauncher({ headless });
  const pool = new TabPool();

  let chromeDebuggerUrl = '';
  try {
    // 1. Launch local managed Chrome
    chromeDebuggerUrl = await launcher.launch();
    
    // 2. Allocate an isolated tab
    const client = await pool.acquireTab();
    const rawClient = client.getRawClient();

    // 3. Check for stored session cookies and inject them to context via CDP Network domain
    const savedCookies = profileManager.loadAndDecryptSession(platform);
    if (savedCookies && savedCookies.length > 0) {
      console.log(`[Pipeline] Decrypted and injecting ${savedCookies.length} ${platform} session cookies via CDP Network.setCookies...`);
      const { Network } = rawClient;
      await Network.setCookies({ cookies: savedCookies });
    } else {
      console.log(`[Pipeline] No decrypted ${platform} session cookies found on disk. Proceeding with clean session.`);
    }

    // 4. Recon-First Step
    let reconResult: any = { status: 'SUCCESS', canonicalUrl: url, hasSeeMore: false };
    if (platform === 'linkedin') {
      const recon = new LinkedInRecon(client);
      reconResult = await recon.performRecon(url);
    } else if (platform === 'x') {
      const recon = new XRecon(client);
      reconResult = await recon.performRecon(url);
    } else {
      console.log(`[Pipeline] Direct navigation for platform ${platform.toUpperCase()} to: ${url}`);
      await client.navigate(url);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    console.log(`[Pipeline] Recon Status: ${reconResult.status}`);

    if (reconResult.status === 'UNAUTHENTICATED') {
      throw new Error(`UNAUTHENTICATED: Agent Chrome profile is not logged in to ${platform.toUpperCase()}. Run "npm run auth:${platform}" first.`);
    }
    if (reconResult.status === 'BLOCKED') {
      throw new Error(`BLOCKED: ${platform.toUpperCase()} blocked access or prompted verification: ${reconResult.error}`);
    }
    if (reconResult.status === 'PAGE_NOT_FOUND') {
      throw new Error(`PAGE_NOT_FOUND: ${platform.toUpperCase()} post not found at URL: ${reconResult.error}`);
    }

    // 5. High-fidelity Capture & Revision Loop (Reality-Checker Principles)
    let capture: any;
    let verifier: any;
    if (platform === 'linkedin') {
      capture = new LinkedInCapture(client);
      verifier = new LinkedInVerifier();
    } else if (platform === 'x') {
      capture = new XCapture(client);
      verifier = new XVerifier();
    } else if (platform === 'threads') {
      capture = new ThreadsCapture(client);
      verifier = new ThreadsVerifier();
    } else if (platform === 'instagram') {
      capture = new InstagramCapture(client);
      verifier = new InstagramVerifier();
    }

    let currentUrl = reconResult.canonicalUrl;
    let hasSeeMore = reconResult.hasSeeMore;
    
    let captureResult: any;
    let verificationReport: any = null;
    const maxCycles = 3;

    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      console.log(`[Pipeline] Running Capture Cycle ${cycle} / ${maxCycles}...`);
      captureResult = await capture.capture(currentUrl, hasSeeMore);

      if (!captureResult.success || !captureResult.scrapPath) {
        throw new Error(`CAPTURE_FAILED: Scraper extraction failed to complete in Cycle ${cycle}.`);
      }

      // 6. Verification-First Step
      verificationReport = verifier.verify(captureResult, captureResult.scrapPath);
      console.log(`[Pipeline] Quality Audit (Cycle ${cycle}): Score: ${verificationReport.score}, Status: ${verificationReport.status.toUpperCase()}`);

      if (verificationReport.status === 'pass') {
        console.log(`[Pipeline] Reality Checker passed on Cycle ${cycle}! Graduation approved.`);
        break;
      }

      if (cycle < maxCycles) {
        console.log(`[Pipeline] ⚠️ Reality Checker rejected this run (NEEDS WORK). Initializing Self-Correction for Cycle ${cycle + 1}...`);
        
        const triggers = verificationReport.suspicionSignals;
        
        if (triggers.includes('AUTHOR_SUSPICIOUS_CONTEXT') || triggers.includes('AUTHOR_MISSING')) {
          console.log('[Pipeline] [Self-Correction] Author is suspected. Attempting extra scroll & re-evaluation...');
        }

        if (triggers.includes('MISSING_EXPECTED_COMMENTS')) {
          console.log('[Pipeline] [Self-Correction] Expected comments missing. Scrolling to comments section and expanding...');
          if (platform === 'linkedin') {
            await client.evaluate(`
              const commentList = document.querySelector('.comments-comment-list, .comments-comment-item, button[class*="comment"]');
              if (commentList) {
                commentList.scrollIntoView({ behavior: 'smooth' });
                const expandCommentsBtn = document.querySelector('button[class*="comments-social-counts"], button[class*="show-comments"]');
                if (expandCommentsBtn) expandCommentsBtn.click();
              }
            `);
          } else {
            await client.evaluate(`
              window.scrollBy({ top: 400, behavior: 'smooth' });
            `);
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Delay before re-running capture to let DOM load/settle
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (verificationReport && verificationReport.warnings.length > 0) {
      console.log('[Pipeline] Warnings detected:');
      verificationReport.warnings.forEach((w: string) => console.log(`  - ${w}`));
    }

    // 6.5. DeepSeek Brain Engine Processing (Summary, Tagging, NER, Audit, Skill note candidate)
    if (captureResult?.data && captureResult.scrapPath) {
      if (options.filter24Hours && isOlderThan24Hours(captureResult.data.dateText)) {
        console.log(`[Pipeline] Post is older than 24 hours (${captureResult.data.dateText}). Skipping LLM processing.`);
        await pool.releaseTab(client);
        launcher.kill();
        return {
          engine: 'CDP_Chrome',
          success: true,
          scrapPath: captureResult.scrapPath,
          score: verificationReport!.score,
          skippedAge: true
        };
      }
      await executeLlmProcessing(captureResult.data, captureResult.scrapPath);
    }

    // 7. Skill Memory Gate Step (Durable Learning)
    if (platform === 'linkedin') {
      const proposal = verificationReport ? skillGate.evaluateRun(verificationReport, captureResult.trace) : null;
      if (proposal) {
        skillGate.printProposal(proposal);
        // For demonstration of the approval hook, we log that it's queued.
        console.log('[Pipeline] Durable change proposal generated and queued for human approval.');
      }
    }

    // 8. Clean up and close browser
    await pool.releaseTab(client);
    launcher.kill();

    console.log('🎉 Pipeline execution completed successfully!');
    return {
      engine: 'CDP_Chrome',
      success: true,
      scrapPath: captureResult.scrapPath,
      score: verificationReport!.score
    };

  } catch (err: any) {
    console.error(`\n❌ CDP Pipeline encountered an issue: ${err.message}`);
    launcher.kill();

    if (useFallback) {
      console.log('\n🔄 Initiating Playwright Headless Fallback Engine...');
      const fallback = new PlaywrightCapture();
      const fallbackResult = await fallback.capture(url);

      if (fallbackResult.success && fallbackResult.scrapPath) {
        console.log('🎉 Fallback capture completed successfully!');
        
        if (fallbackResult.data && options.filter24Hours && isOlderThan24Hours(fallbackResult.data.dateText)) {
          console.log(`[Pipeline] Fallback post is older than 24 hours (${fallbackResult.data.dateText}). Skipping LLM processing.`);
          return {
            engine: 'Playwright_Fallback',
            success: true,
            scrapPath: fallbackResult.scrapPath,
            score: 0.7,
            skippedAge: true
          };
        }

        if (fallbackResult.data) {
          console.log('[Pipeline] Running DeepSeek Brain Engine processing for Fallback capture...');
          await executeLlmProcessing(fallbackResult.data, fallbackResult.scrapPath);
        }

        return {
          engine: 'Playwright_Fallback',
          success: true,
          scrapPath: fallbackResult.scrapPath,
          score: 0.7 // Default score for fallback capture without deep verification
        };
      }
    }

    console.error('❌ Capture Pipeline failed completely.');
    return {
      engine: 'None',
      success: false,
      error: err.message
    };
  }
}

/**
 * Reusable helper to execute DeepSeek Brain Engine analysis and export to Obsidian vault
 * using unified format (frontmatter only, no raw scrap). Auto-generates cross-references.
 */
async function executeLlmProcessing(data: any, scrapPath: string) {
  const llmProcessor = new LlmProcessor();
  if (!llmProcessor.isConfigured()) {
    console.log('\n🧠 [Pipeline] DeepSeek Brain Engine is skipped (DEEPSEEK_API_KEY is not set).');
    return;
  }

  try {
    const commentsList = data.comments ? data.comments.map((c: any) => `${c.author}: ${c.text}`) : [];
    const llmResult = await llmProcessor.analyzePost(
      data.author,
      data.body,
      data.url,
      commentsList
    );

    if (llmResult) {
      const { analysis, reasoning } = llmResult;
      
      // Save analysis.json and reasoning_trace.txt to scrap/ only (not in vault)
      fs.writeFileSync(
        path.join(scrapPath, 'analysis.json'),
        JSON.stringify(analysis, null, 2),
        'utf8'
      );
      fs.writeFileSync(
        path.join(scrapPath, 'reasoning_trace.txt'),
        reasoning,
        'utf8'
      );
      console.log(`[Pipeline] Saved analysis artifacts to: ${scrapPath}`);

      // Detect source type from URL
      const url = data.url || '';
      let sourceType: UnifiedNoteData['source_type'] = 'web';
      if (url.includes('instagram.com')) sourceType = 'instagram';
      else if (url.includes('x.com') || url.includes('twitter.com')) sourceType = 'x';
      else if (url.includes('linkedin.com')) sourceType = 'linkedin';
      else if (url.includes('threads.net')) sourceType = 'threads';

      const todayStr = new Date().toISOString().split('T')[0];
      const nowISO = new Date().toISOString();
      const vaultBaseDir = process.env.OBSIDIAN_VAULT_PATH || path.join(__dirname, '../../vault');

      // Build clean body: summary + key concepts only (no raw scrap)
      const cleanBody = [
        `## 핵심 요약\n\n${analysis.summary}\n`,
        `## 핵심 개념\n\n${analysis.ner.key_concepts.map((c: string) => `- ${c}`).join('\n') || '- 없음'}\n`,
        `## 감사 (Scraping Audit)\n- **점수**: \`${analysis.extraction_audit.score} / 1.0\``,
        analysis.extraction_audit.issues_found.length > 0
          ? `- **이슈**: ${analysis.extraction_audit.issues_found.join('; ')}`
          : '- **이슈**: 없음',
        '',
      ].join('\n');

      const noteData: UnifiedNoteData = {
        title: data.headline || data.author || 'Social Post',
        source: url,
        source_type: sourceType,
        captured_at: nowISO,
        date: todayStr,
        author: data.author || 'Unknown',
        author_url: url,
        tags: analysis.tags || [],
        domains: [],  // auto-classified later by NER
        people: analysis.ner.people || [],
        organizations: analysis.ner.organizations || [],
        products: analysis.ner.products_or_repos || [],
        concepts: analysis.ner.key_concepts || [],
        summary: analysis.summary || '',
        body: cleanBody,
        verification_score: analysis.extraction_audit.score,
      };

      // Save to vault (Web/ or YouTube/)
      const notePath = saveToVault(vaultBaseDir, noteData);
      saveTrace(vaultBaseDir, noteData, reasoning);

      // Generate cross-references to Companies/, People/, Health/
      generateCrossReferences(vaultBaseDir, noteData, notePath);

      console.log(`\n🎉 [Pipeline] Saved unified note + cross-refs → ${notePath}`);
      console.log(`BATIFLOW_RESULT_PATH=${notePath}`);
    }
  } catch (llmErr: any) {
    console.error(`⚠️ [Pipeline] DeepSeek post-processing encountered an error: ${llmErr.message}`);
  }
}

// Support running directly from CLI if url parameter is passed
if (require.main === module) {
  const targetUrl = process.argv[2] || 'https://www.linkedin.com/posts/activity-7195484803929481216-928e';
  runBatiFlowCapture({ url: targetUrl }).catch(console.error);
}
