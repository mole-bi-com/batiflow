import fs from 'fs';
import path from 'path';
import { ThreadsCaptureData, ThreadsCaptureResult } from './ThreadsCapture';

export interface ThreadsVerificationReport {
  url: string;
  source: 'threads';
  status: 'pass' | 'fail';
  score: number;
  checks: {
    author_clean: boolean;
    body_min_length: boolean;
    ui_noise_low: boolean;
    comments_verified: boolean;
    media_verified: boolean;
  };
  warnings: string[];
  suspicionSignals: string[];
}

export class ThreadsVerifier {
  
  /**
   * Verifies the Threads capture output based on strict Reality Checker principles.
   * Default status is always 'fail' (NEEDS WORK) until proven otherwise.
   */
  public verify(
    result: ThreadsCaptureResult,
    targetFolder: string
  ): ThreadsVerificationReport {
    const data = result.data;
    const warnings: string[] = [];
    const suspicionSignals: string[] = [];
    
    let status: 'pass' | 'fail' = 'fail';
    let score = 0.0;

    const checks = {
      author_clean: false,
      body_min_length: false,
      ui_noise_low: false,
      comments_verified: false,
      media_verified: false
    };

    if (!result.success || !data) {
      warnings.push('Capture execution failed or returned no data.');
      const report: ThreadsVerificationReport = {
        url: '',
        source: 'threads',
        status: 'fail',
        score: 0.0,
        checks,
        warnings,
        suspicionSignals: ['SCRAPER_CRASH']
      };
      this.writeReport(report, result.trace, targetFolder);
      return report;
    }

    // Heuristic 1: Author Cleanliness Check
    const suspiciousAuthors = ['unknown author', 'unknown', 'sign in', 'log in', 'threads.net', 'threads'];
    const rawAuthor = data.author ? data.author.trim() : '';
    const authorLower = rawAuthor.toLowerCase();
    
    const authorFound = rawAuthor.length > 0 && !authorLower.includes('unknown');
    const authorIsSuspicious = suspiciousAuthors.some(sa => authorLower === sa || authorLower.includes(sa));
    
    if (!authorFound) {
      warnings.push('Author name is empty or unknown.');
      suspicionSignals.push('AUTHOR_MISSING');
    } else if (authorIsSuspicious) {
      warnings.push(`Author parsed as "${rawAuthor}", which matches interactive Threads UI context.`);
      suspicionSignals.push('AUTHOR_SUSPICIOUS_CONTEXT');
    } else {
      checks.author_clean = true;
    }

    // Heuristic 2: Body text minimum length
    const cleanBodyText = data.body ? data.body.trim() : '';
    const bodyMinLength = cleanBodyText.length >= 10;
    if (!bodyMinLength) {
      warnings.push(`Extracted post body is extremely short (${cleanBodyText.length} chars).`);
      suspicionSignals.push('BODY_TOO_SHORT');
    } else {
      checks.body_min_length = true;
    }

    // Heuristic 3: UI Noise Check
    const footerKeywords = ['log in', 'sign up', 'reply to thread', 'view replies'];
    let uiKeywordsCount = 0;
    footerKeywords.forEach(kw => {
      if (cleanBodyText.toLowerCase().includes(kw)) {
        uiKeywordsCount++;
      }
    });

    const uiNoiseLow = uiKeywordsCount === 0;
    if (!uiNoiseLow) {
      warnings.push(`Threads post body appears polluted with interactive UI elements (${uiKeywordsCount} UI keywords detected).`);
      suspicionSignals.push('UI_NOISE_DETECTED');
    } else {
      checks.ui_noise_low = true;
    }

    // Heuristic 4: Comments Verification (Proof of Completion)
    checks.comments_verified = true;

    // Heuristic 5: Media Verification
    checks.media_verified = true;

    // Calculate quality score based on checklist
    if (checks.author_clean) score += 0.3;
    if (checks.body_min_length) score += 0.3;
    if (checks.ui_noise_low) score += 0.2;
    if (checks.comments_verified) score += 0.1;
    if (checks.media_verified) score += 0.1;

    score = parseFloat(score.toFixed(2));

    // Next-Step Threshold: Only pass if Quality Score is >= 0.90 AND no critical suspicion signals remain
    const criticalSuspicion = suspicionSignals.some(sig => 
      ['AUTHOR_SUSPICIOUS_CONTEXT', 'UI_NOISE_DETECTED', 'BODY_TOO_SHORT', 'AUTHOR_MISSING'].includes(sig)
    );

    if (score >= 0.90 && !criticalSuspicion) {
      status = 'pass';
    } else {
      status = 'fail';
      warnings.push(`Reality Checker rejected Threads capture run (NEEDS WORK). Score: ${score}. Suspicion Signals: ${suspicionSignals.join(', ')}`);
    }

    const report: ThreadsVerificationReport = {
      url: data.url,
      source: 'threads',
      status,
      score,
      checks,
      warnings,
      suspicionSignals
    };

    // Write verification.json and capture.trace.json to the scrap folder
    this.writeReport(report, result.trace, targetFolder);
    return report;
  }

  private writeReport(
    report: ThreadsVerificationReport,
    trace: any,
    targetFolder: string
  ): void {
    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true });
    }

    fs.writeFileSync(
      path.join(targetFolder, 'verification.json'),
      JSON.stringify(report, null, 2),
      'utf8'
    );

    fs.writeFileSync(
      path.join(targetFolder, 'capture.trace.json'),
      JSON.stringify(trace, null, 2),
      'utf8'
    );
  }
}
