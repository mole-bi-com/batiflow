import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import { LlmAnalysisResult, LlmProcessor, mergeFollowupAnalysis } from '../llm/LlmProcessor';
import { saveToVault, saveTrace, generateCrossReferences, UnifiedNoteData } from '../utils/vaultWriter';

export interface WebPageIngestResult {
  title: string;
  url: string;
  summary: string;
  markdownPath: string;
}

interface WebPageContent {
  title: string;
  description: string;
  author: string;
  body: string;
  url: string;
}

export class WebPageIngestor {
  private projectRoot: string;
  private llmProcessor: LlmProcessor;
  private revisionVerificationDelayMs: number;

  constructor(llmProcessor = new LlmProcessor(), revisionVerificationDelayMs = 15000) {
    this.projectRoot = path.resolve(__dirname, '../../../');
    this.llmProcessor = llmProcessor;
    this.revisionVerificationDelayMs = revisionVerificationDelayMs;
  }

  public async ingest(url: string): Promise<WebPageIngestResult> {
    const pageContent = await this.capture(url);
    const llmResult = await this.llmProcessor.analyzePost(
      pageContent.author,
      pageContent.body,
      pageContent.url,
      []
    );

    if (!llmResult) {
      throw new Error('웹페이지 분석 결과를 생성하지 못했습니다. DeepSeek API 설정을 확인해 주세요.');
    }

    const { analysis, reasoning } = llmResult;
    const markdownPath = this.save(pageContent, analysis, reasoning);

    return {
      title: pageContent.title,
      url: pageContent.url,
      summary: analysis.summary,
      markdownPath
    };
  }

  public async revise(markdownPath: string, instruction: string): Promise<string> {
    const resolvedPath = path.resolve(markdownPath);
    if (!fs.existsSync(resolvedPath) || path.extname(resolvedPath).toLowerCase() !== '.md') {
      throw new Error(`수정할 Markdown 파일을 찾을 수 없습니다: ${resolvedPath}`);
    }
    if (!instruction.trim()) {
      throw new Error('추가 분석 요구사항이 비어 있습니다.');
    }

    const existingMarkdown = fs.readFileSync(resolvedPath, 'utf8');
    const revisedMarkdown = await this.llmProcessor.reviseMarkdown(existingMarkdown, instruction.trim());
    return this.persistRevision(resolvedPath, revisedMarkdown);
  }

  public async applyFollowup(markdownPath: string, followupAnalysis: string): Promise<string> {
    const resolvedPath = path.resolve(markdownPath);
    if (!fs.existsSync(resolvedPath) || path.extname(resolvedPath).toLowerCase() !== '.md') {
      throw new Error(`수정할 Markdown 파일을 찾을 수 없습니다: ${resolvedPath}`);
    }
    if (!followupAnalysis.trim()) {
      throw new Error('적용할 추가 분석이 비어 있습니다.');
    }

    const existingMarkdown = fs.readFileSync(resolvedPath, 'utf8');
    const revisedMarkdown = mergeFollowupAnalysis(existingMarkdown, followupAnalysis);
    return this.persistRevision(resolvedPath, revisedMarkdown);
  }

  private async persistRevision(resolvedPath: string, revisedMarkdown: string): Promise<string> {
    this.writeRevision(resolvedPath, revisedMarkdown);
    this.saveRevisionBackup(revisedMarkdown);

    if (this.revisionVerificationDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.revisionVerificationDelayMs));
      if (fs.readFileSync(resolvedPath, 'utf8') !== revisedMarkdown) {
        this.writeRevision(resolvedPath, revisedMarkdown);
        this.saveRevisionBackup(revisedMarkdown);
      }
    }
    return resolvedPath;
  }

  private writeRevision(markdownPath: string, markdown: string): void {
    const temporaryPath = `${markdownPath}.tmp`;
    fs.writeFileSync(temporaryPath, markdown, 'utf8');
    fs.renameSync(temporaryPath, markdownPath);
  }

  private saveRevisionBackup(markdown: string): void {
    const sourceUrl = markdown.match(/^source:\s*"([^"]+)"/m)?.[1];
    if (!sourceUrl) return;

    const id = crypto.createHash('sha256').update(sourceUrl).digest('hex').slice(0, 12);
    const scrapDir = path.join(this.projectRoot, 'scrap', 'web', id);
    fs.mkdirSync(scrapDir, { recursive: true });
    fs.writeFileSync(path.join(scrapDir, 'page.md'), markdown, 'utf8');
  }

  private async capture(url: string): Promise<WebPageContent> {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122 Safari/537.36'
      });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);

      const content = await page.evaluate(() => {
        document.querySelectorAll('script, style, noscript, nav, footer, header, aside').forEach(element => element.remove());

        const title =
          document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
          document.title ||
          'Untitled Web Page';
        const description =
          document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
          document.querySelector('meta[name="description"]')?.getAttribute('content') ||
          '';
        const author =
          document.querySelector('meta[name="author"]')?.getAttribute('content') ||
          new URL(window.location.href).hostname;
        const main =
          document.querySelector('article') ||
          document.querySelector('main') ||
          document.querySelector('[role="main"]') ||
          document.body;
        const body = (main as HTMLElement)?.innerText?.replace(/\n{3,}/g, '\n\n').trim() || '';

        return { title: title.trim(), description: description.trim(), author: author.trim(), body };
      });

      if (content.body.length < 40) {
        throw new Error('웹페이지에서 분석할 본문을 충분히 추출하지 못했습니다.');
      }

      return {
        ...content,
        body: content.body.slice(0, 60000),
        url: page.url()
      };
    } finally {
      await browser.close();
    }
  }

  /**
   * Save using unified format: no raw scrap in vault, only frontmatter + analysis body.
   */
  private save(page: WebPageContent, analysis: LlmAnalysisResult, reasoning: string): string {
    const todayStr = new Date().toISOString().split('T')[0];
    const nowISO = new Date().toISOString();
    const vaultBase = process.env.OBSIDIAN_VAULT_PATH || path.join(this.projectRoot, 'vault');

    // Build clean body (no raw scrap text)
    const cleanBody = [
      `## 핵심 요약\n\n${analysis.summary}\n`,
      `## 핵심 개념\n\n${analysis.ner.key_concepts.map((c: string) => `- ${c}`).join('\n') || '- 없음'}\n`,
    ].join('\n');

    const noteData: UnifiedNoteData = {
      title: page.title,
      source: page.url,
      source_type: 'web',
      captured_at: nowISO,
      date: todayStr,
      author: page.author,
      author_url: page.url,
      tags: analysis.tags || [],
      domains: [],
      people: analysis.ner.people || [],
      organizations: analysis.ner.organizations || [],
      products: analysis.ner.products_or_repos || [],
      concepts: analysis.ner.key_concepts || [],
      summary: analysis.summary || '',
      body: cleanBody,
      verification_score: analysis.extraction_audit.score,
    };

    const notePath = saveToVault(vaultBase, noteData);
    saveTrace(vaultBase, noteData, reasoning);
    generateCrossReferences(vaultBase, noteData, notePath);

    // Also save raw scrap to scrap/ for debugging
    const id = crypto.createHash('sha256').update(page.url).digest('hex').slice(0, 12);
    const scrapDir = path.join(this.projectRoot, 'scrap', 'web', id);
    if (!fs.existsSync(scrapDir)) {
      fs.mkdirSync(scrapDir, { recursive: true });
    }
    fs.writeFileSync(path.join(scrapDir, 'page.md'), page.body, 'utf8');
    fs.writeFileSync(path.join(scrapDir, 'reasoning_trace.txt'), reasoning, 'utf8');

    return notePath;
  }
}
