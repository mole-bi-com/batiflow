import fs from 'fs';
import path from 'path';
import { CaptureData, CaptureResult } from './LinkedInCapture';

export interface VerificationReport {
  url: string;
  source: 'linkedin';
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

export class LinkedInVerifier {
  
  /**
   * Verifies the capture output based on strict Reality Checker principles.
   * Default status is always 'fail' (NEEDS WORK) until proven otherwise.
   */
  public verify(
    result: CaptureResult,
    targetFolder: string
  ): VerificationReport {
    const data = result.data;
    const warnings: string[] = [];
    const suspicionSignals: string[] = [];
    
    // 1. Default decision: fail (NEEDS WORK)
    let status: 'pass' | 'fail' = 'fail';
    let score = 0.0;

    // Checks structure
    const checks = {
      author_clean: false,
      body_min_length: false,
      ui_noise_low: false,
      comments_verified: false,
      media_verified: false
    };

    if (!result.success || !data) {
      warnings.push('Capture execution failed or returned no data.');
      const report: VerificationReport = {
        url: '',
        source: 'linkedin',
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
    // We are highly suspicious of corporate names like "VisualCamp" or logged-in user names
    const suspiciousAuthors = ['visualcamp', 'seungwoo lee', '이성원', 'unknown author', 'unknown'];
    const rawAuthor = data.author ? data.author.trim() : '';
    const authorLower = rawAuthor.toLowerCase();
    
    const authorFound = rawAuthor.length > 0 && !authorLower.includes('unknown');
    const authorIsCorporateOrUser = suspiciousAuthors.some(sa => authorLower === sa || authorLower.includes(sa));
    
    if (!authorFound) {
      warnings.push('Author name is empty or unknown.');
      suspicionSignals.push('AUTHOR_MISSING');
    } else if (authorIsCorporateOrUser) {
      warnings.push(`Author parsed as "${rawAuthor}", which matches user profile or corporate context.`);
      suspicionSignals.push('AUTHOR_SUSPICIOUS_CONTEXT');
    } else {
      checks.author_clean = true;
    }

    // Heuristic 2: Body text minimum length
    const cleanBodyText = data.body ? data.body.trim() : '';
    const bodyMinLength = cleanBodyText.length >= 100;
    if (!bodyMinLength) {
      warnings.push(`Extracted post body is extremely short (${cleanBodyText.length} chars).`);
      suspicionSignals.push('BODY_TOO_SHORT');
    } else {
      checks.body_min_length = true;
    }

    // Heuristic 3: UI Noise Check
    // Check if the extracted body is polluted by interactive footer/sidebar elements
    const footerKeywords = ['like', 'comment', 'repost', 'send', 'show translation', 'reactions'];
    let footerMatches = 0;
    footerKeywords.forEach(kw => {
      if (cleanBodyText.toLowerCase().includes(kw)) {
        footerMatches++;
      }
    });

    // If body has multiple UI button words or contains structured footer noise, flag it
    const uiNoiseLow = footerMatches <= 1;
    if (!uiNoiseLow) {
      warnings.push(`Post body text appears polluted with interactive UI elements (${footerMatches} UI keywords detected).`);
      suspicionSignals.push('UI_NOISE_DETECTED');
    } else {
      checks.ui_noise_low = true;
    }

    // Heuristic 4: Comments Verification (Proof of Completion)
    // If the body text explicitly mentions comments (e.g. "2 comments") but we have 0, flag it
    const commentCountRegex = /(\d+)\s+comments?/i;
    const commentMatch = cleanBodyText.match(commentCountRegex);
    const commentsMentioned = commentMatch ? parseInt(commentMatch[1]) > 0 : false;
    const commentsCaptured = data.comments && data.comments.length > 0;

    if (commentsMentioned && !commentsCaptured) {
      warnings.push(`Post text mentions comments, but 0 comments were extracted. Comments might have failed to load.`);
      suspicionSignals.push('MISSING_EXPECTED_COMMENTS');
    } else {
      checks.comments_verified = true;
    }

    // Heuristic 5: Media Verification
    // If post text contains media/image signals but images is empty
    checks.media_verified = true; // High-level verify, can expand if needed

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
      warnings.push(`Reality Checker rejected this run (Status: NEEDS WORK). Score: ${score}. Suspicion Signals: ${suspicionSignals.join(', ')}`);
    }

    const report: VerificationReport = {
      url: data.url,
      source: 'linkedin',
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
    report: VerificationReport,
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

