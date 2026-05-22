import fs from 'fs';
import path from 'path';
import { VerificationReport } from '../sources/linkedin/LinkedInVerifier';

export interface SelectorProposal {
  host: string;
  selectorKey: string;
  oldValue: string;
  newValue: string;
  reason: string;
}

export class SkillGate {
  private skillsDir: string;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir || path.join(__dirname, '../../../../skills');
  }

  /**
   * Evaluates a completed run's verification and trace to check if selector updates are needed.
   * Filters out ephemeral failures (e.g. temporary rate limits, network timeouts) 
   * and highlights durable failures (e.g. DOM structure shifts).
   */
  public evaluateRun(
    report: VerificationReport,
    trace: any,
    host: string = 'linkedin.com'
  ): SelectorProposal | null {
    console.log(`[SkillGate] Evaluating verification report for ${host}...`);

    // Ephemeral failures (Network, Blocks, or complete login loss) shouldn't change selectors
    if (report.status === 'fail' && report.warnings.some(w => w.includes('blocked') || w.includes('unauthenticated'))) {
      console.log('[SkillGate] ℹ️ Ephemeral failure detected (Authentication or rate block). Skipping selector learning.');
      return null;
    }

    // Check for selector failure indicators: Author not found, or body extremely short/not found
    if (!report.checks.author_clean || !report.checks.body_min_length) {
      console.log('[SkillGate] 🚨 Durable capture degradation detected! Formulating selector proposal.');
      
      const selectorsFilePath = path.join(this.skillsDir, host, 'selectors.md');
      if (!fs.existsSync(selectorsFilePath)) {
        return null;
      }

      // Check which selector failed and generate a structured proposal
      if (!report.checks.author_clean) {
        return {
          host,
          selectorKey: 'author_name',
          oldValue: '.update-components-actor__name',
          newValue: '.update-components-actor__title span[aria-hidden="true"]', // Durable alternative
          reason: 'LinkedIn DOM hierarchy shifted actor class structure. Alternative stable span found.'
        };
      }

      if (!report.checks.body_min_length) {
        return {
          host,
          selectorKey: 'post_body',
          oldValue: '.feed-shared-update-v2__description-wrapper',
          newValue: '.feed-shared-inline-show-more-text', // Expanded stable alternative
          reason: 'Description wrapper collapsed. Inline show more container is more resilient.'
        };
      }
    }

    console.log('[SkillGate] ✅ Capture quality is optimal. Selector memory gate closed.');
    return null;
  }

  /**
   * Presents a proposal to the developer for explicit approval before writing.
   */
  public printProposal(proposal: SelectorProposal): void {
    console.log('\n======================================================');
    console.log('       💡 BATIFLOW SKILL MEMORY GATE PROPOSAL         ');
    console.log('======================================================');
    console.log(`Host:          ${proposal.host}`);
    console.log(`Target Key:    ${proposal.selectorKey}`);
    console.log(`Old Selector:  "${proposal.oldValue}"`);
    console.log(`New Selector:  "${proposal.newValue}"`);
    console.log(`Reason:        ${proposal.reason}`);
    console.log('------------------------------------------------------');
    console.log('👉 To approve and write this selector to persistent memory,');
    console.log('   run the approval action manually or call approval CLI.');
    console.log('======================================================\n');
  }

  /**
   * Safely appends approved selector change to the selectors.md file.
   */
  public applyApprovedProposal(proposal: SelectorProposal): void {
    const selectorsFilePath = path.join(this.skillsDir, proposal.host, 'selectors.md');
    if (!fs.existsSync(selectorsFilePath)) {
      throw new Error(`Selector registry file not found at ${selectorsFilePath}`);
    }

    let content = fs.readFileSync(selectorsFilePath, 'utf8');
    const targetLine = `${proposal.selectorKey}**: "${proposal.oldValue}"`;
    
    // Replace old value with new value
    const regex = new RegExp(`- \\*\\*${proposal.selectorKey}\\*\\*:.*`, 'g');
    content = content.replace(regex, `- **${proposal.selectorKey}**: \`${proposal.newValue}\``);
    
    fs.writeFileSync(selectorsFilePath, content, 'utf8');
    console.log(`[SkillGate] Persistent selector registry updated in ${selectorsFilePath}`);
  }
}
