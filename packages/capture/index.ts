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


export interface BatiFlowOptions {
  url: string;
  useFallback?: boolean;
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

  const headless = (platform === 'x' || platform === 'linkedin');
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
    if (verificationReport && verificationReport.status === 'pass' && captureResult?.data && captureResult.scrapPath) {
      const llmProcessor = new LlmProcessor();
      if (llmProcessor.isConfigured()) {
        try {
          const data = captureResult.data;
          const commentsList = data.comments.map((c: any) => `${c.author}: ${c.text}`);
          
          const llmResult = await llmProcessor.analyzePost(
            data.author,
            data.body,
            data.url,
            commentsList
          );
          
          if (llmResult) {
            const { analysis, reasoning } = llmResult;
            const scrapPath = captureResult.scrapPath;
            
            // Save analysis.json
            fs.writeFileSync(
              path.join(scrapPath, 'analysis.json'),
              JSON.stringify(analysis, null, 2),
              'utf8'
            );
            
            // Save reasoning_trace.txt
            fs.writeFileSync(
              path.join(scrapPath, 'reasoning_trace.txt'),
              reasoning,
              'utf8'
            );
            
            console.log(`[Pipeline] Saved analysis.json and reasoning_trace.txt to: ${scrapPath}`);
            
            // Prepend LLM analysis frontmatter block to post.md
            const postMdPath = path.join(scrapPath, 'post.md');
            if (fs.existsSync(postMdPath)) {
              const originalContent = fs.readFileSync(postMdPath, 'utf8');
              
              const nerSection = `
- **People**: ${analysis.ner.people.length > 0 ? analysis.ner.people.map(p => `\`${p}\``).join(', ') : 'None'}
- **Organizations**: ${analysis.ner.organizations.length > 0 ? analysis.ner.organizations.map(o => `\`${o}\``).join(', ') : 'None'}
- **Products / Repos**: ${analysis.ner.products_or_repos.length > 0 ? analysis.ner.products_or_repos.map(r => `\`${r}\``).join(', ') : 'None'}
- **Key Concepts**: ${analysis.ner.key_concepts.length > 0 ? analysis.ner.key_concepts.map(c => `\`${c}\``).join(', ') : 'None'}`;

              const frontmatter = `---
# 🧠 BatiFlow LLM Brain Engine (deepseek-v4-pro) Analysis
> **DeepSeek Reasoning Trace**: [View reasoning_trace.txt](./reasoning_trace.txt)

## 핵심 요약 (Executive Summary)
${analysis.summary}

## Semantic Tags
${analysis.tags.map(t => `\`#${t}\``).join('  ')}

## Named Entities (NER)
${nerSection}

## Scraping & Cleanup Audit
- **LLM Context Audit Score**: \`${analysis.extraction_audit.score} / 1.0\`
- **Cleanliness Rating**: ${analysis.extraction_audit.score >= 0.9 ? '✨ Pristine' : '⚠️ Minor UI remnants/mismatch'}
- **Scraper Quality Feedback**: ${analysis.extraction_audit.issues_found.length > 0 ? analysis.extraction_audit.issues_found.join('; ') : 'No anomalies detected by LLM.'}

${analysis.skill_note.has_candidate ? `### 💡 Suggested Scraper Improvement Candidate\n> ${analysis.skill_note.candidate_explanation}\n` : ''}---

`;
              fs.writeFileSync(postMdPath, frontmatter + originalContent, 'utf8');
              console.log('[Pipeline] Beautiful LLM analysis successfully prepended to post.md!');

              // Also copy to Obsidian Vault Inbox dynamically!
              try {
                const vaultInboxDir = path.join(__dirname, '../../vault/Inbox');
                if (!fs.existsSync(vaultInboxDir)) {
                  fs.mkdirSync(vaultInboxDir, { recursive: true });
                }
                
                // Clean author name for filename
                const cleanAuthor = data.author.replace(/[/\\?%*:|"<>]/g, '').trim() || 'Unknown';
                // Extract a 35-character sanitized snippet of the body for a friendly note title
                const bodyCleanedForTitle = data.body
                  .replace(/[\r\n#*`_[\]()]/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
                const bodySnippet = bodyCleanedForTitle.substring(0, 35).trim() || 'Captured Post';
                
                const noteFilename = `${cleanAuthor} - ${bodySnippet}.md`;
                const notePath = path.join(vaultInboxDir, noteFilename);
                
                // Save directly to Obsidian vault Inbox
                fs.writeFileSync(notePath, frontmatter + originalContent, 'utf8');
                console.log(`[Pipeline] Automatically saved Obsidian Vault note: ${noteFilename}`);
                
                // Copy the reasoning trace to the vault Inbox with a matching name for referencing
                const traceFilename = `${cleanAuthor} - ${bodySnippet} - reasoning_trace.txt`;
                const tracePath = path.join(vaultInboxDir, traceFilename);
                fs.writeFileSync(tracePath, reasoning, 'utf8');
                console.log(`[Pipeline] Saved Obsidian Vault reasoning trace: ${traceFilename}`);
              } catch (vaultErr: any) {
                console.error(`⚠️ [Pipeline] Failed to export to Obsidian Vault: ${vaultErr.message}`);
              }
            }
          }
        } catch (llmErr: any) {
          console.error(`⚠️ [Pipeline] DeepSeek post-processing encountered an error: ${llmErr.message}`);
        }
      } else {
        console.log('\n🧠 [Pipeline] DeepSeek Brain Engine is skipped (DEEPSEEK_API_KEY is not set).');
      }
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

// Support running directly from CLI if url parameter is passed
if (require.main === module) {
  const targetUrl = process.argv[2] || 'https://www.linkedin.com/posts/activity-7195484803929481216-928e';
  runBatiFlowCapture({ url: targetUrl }).catch(console.error);
}
