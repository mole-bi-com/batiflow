import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import { LlmAnalysisResult, LlmProcessor } from '../llm/LlmProcessor';

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

  constructor(llmProcessor = new LlmProcessor()) {
    this.projectRoot = path.resolve(__dirname, '../../../');
    this.llmProcessor = llmProcessor;
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

    const markdown = this.formatMarkdown(pageContent, llmResult.analysis);
    const markdownPath = this.save(pageContent, markdown, llmResult.reasoning);

    return {
      title: pageContent.title,
      url: pageContent.url,
      summary: llmResult.analysis.summary,
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
    const temporaryPath = `${resolvedPath}.tmp`;
    fs.writeFileSync(temporaryPath, revisedMarkdown, 'utf8');
    fs.renameSync(temporaryPath, resolvedPath);
    return resolvedPath;
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

  private formatMarkdown(page: WebPageContent, analysis: LlmAnalysisResult): string {
    return `---
title: "${page.title.replace(/"/g, '\\"')}"
source: "${page.url}"
author: "${page.author.replace(/"/g, '\\"')}"
captured_at: "${new Date().toISOString()}"
tags: [${analysis.tags.map(tag => `"${tag.replace(/"/g, '\\"')}"`).join(', ')}]
---

# ${page.title}

> ${page.description || 'No description provided.'}
>
> [원문 보기](${page.url})

## 핵심 요약

${analysis.summary}

## 핵심 개념

${analysis.ner.key_concepts.map(concept => `- ${concept}`).join('\n') || '- 없음'}

## 원문

${page.body}
`;
  }

  private save(page: WebPageContent, markdown: string, reasoning: string): string {
    const date = new Date().toISOString().split('T')[0];
    const safeTitle = page.title.replace(/[/\\?%*:|"<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled';
    const id = crypto.createHash('sha256').update(page.url).digest('hex').slice(0, 12);
    const vaultBase = process.env.OBSIDIAN_VAULT_PATH || path.join(this.projectRoot, 'vault');
    const vaultDir = path.join(vaultBase, 'Web', date);
    const scrapDir = path.join(this.projectRoot, 'scrap', 'web', id);
    fs.mkdirSync(vaultDir, { recursive: true });
    fs.mkdirSync(scrapDir, { recursive: true });

    const markdownPath = path.join(vaultDir, `${safeTitle}.md`);
    fs.writeFileSync(markdownPath, markdown, 'utf8');
    fs.writeFileSync(path.join(scrapDir, 'page.md'), markdown, 'utf8');
    fs.writeFileSync(path.join(scrapDir, 'reasoning_trace.txt'), reasoning, 'utf8');
    return markdownPath;
  }
}
