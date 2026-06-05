import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { LlmProcessor } from '../llm/LlmProcessor';
import { mergeFollowupAnalysis, stripFollowupAnalysis } from '../llm/LlmProcessor';
import { WebPageIngestor } from '../telegram/WebPageIngestor';

async function run(): Promise<void> {
  const merged = mergeFollowupAnalysis(
    '# Note\n\n## Summary\n\nOriginal summary\n\n## 원문\n\nOriginal body',
    '### 구조 분석\n\nNew analysis'
  );
  assert.match(merged, /Original summary/);
  assert.match(merged, /<!-- BATIFLOW_FOLLOWUP_START -->/);
  assert.match(merged, /### 구조 분석/);
  assert.ok(merged.indexOf('### 구조 분석') < merged.indexOf('## 원문'));
  assert.strictEqual((merged.match(/Original body/g) || []).length, 1);

  const remerged = mergeFollowupAnalysis(merged, '### 반론\n\nReplacement analysis');
  assert.doesNotMatch(remerged, /New analysis/);
  assert.match(remerged, /Replacement analysis/);
  assert.strictEqual((remerged.match(/BATIFLOW_FOLLOWUP_START/g) || []).length, 1);

  const nested = mergeFollowupAnalysis(
    `${merged}\n<!-- BATIFLOW_FOLLOWUP_START -->\nNested\n<!-- BATIFLOW_FOLLOWUP_END -->`,
    '<!-- BATIFLOW_FOLLOWUP_START -->\n## 추가 분석\nClean replacement\n<!-- BATIFLOW_FOLLOWUP_END -->'
  );
  assert.strictEqual((nested.match(/BATIFLOW_FOLLOWUP_START/g) || []).length, 1);
  assert.strictEqual((nested.match(/BATIFLOW_FOLLOWUP_END/g) || []).length, 1);
  assert.match(nested, /Clean replacement/);
  assert.doesNotMatch(stripFollowupAnalysis(nested), /Clean replacement/);

  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'batiflow-web-test-'));
  process.env.OBSIDIAN_VAULT_PATH = vaultPath;

  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
      <html>
        <head>
          <title>Test Article</title>
          <meta name="author" content="Test Author">
          <meta name="description" content="Test description">
        </head>
        <body>
          <nav>This navigation should be removed.</nav>
          <article>This is a sufficiently long article body for the BatiFlow web ingestion integration test.</article>
        </body>
      </html>`);
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start.');
  const url = `http://127.0.0.1:${address.port}/article`;
  const scrapId = crypto.createHash('sha256').update(url).digest('hex').slice(0, 12);
  const scrapPath = path.resolve(__dirname, '../../../scrap/web', scrapId);

  const fakeLlm = {
    analyzePost: async () => ({
      analysis: {
        summary: '테스트 웹페이지 요약',
        tags: ['test'],
        ner: {
          people: [],
          organizations: [],
          products_or_repos: [],
          key_concepts: ['web ingestion']
        },
        extraction_audit: {
          score: 1,
          issues_found: [],
          raw_cleanup_success: true
        },
        skill_note: {
          has_candidate: false,
          candidate_explanation: '',
          suggested_selector_or_heuristic_change: null
        }
      },
      reasoning: 'test reasoning'
    })
  } as unknown as LlmProcessor;

  try {
    const ingestor = new WebPageIngestor(fakeLlm);
    const result = await ingestor.ingest(url);
    const markdown = fs.readFileSync(result.markdownPath, 'utf8');

    assert.strictEqual(result.title, 'Test Article');
    assert.strictEqual(result.summary, '테스트 웹페이지 요약');
    assert.match(markdown, /This is a sufficiently long article body/);
    assert.doesNotMatch(markdown, /This navigation should be removed/);

    const revisionLlm = {
      reviseMarkdown: async () => '# 구조적 재분석\n\n인과 구조를 중심으로 다시 분석했습니다.'
    } as unknown as LlmProcessor;
    const revisedPath = await new WebPageIngestor(revisionLlm, 0).revise(
      result.markdownPath,
      '좀 더 구조적이고 분석적으로 이해하고 싶어'
    );

    assert.strictEqual(revisedPath, result.markdownPath);
    assert.strictEqual(
      fs.readFileSync(revisedPath, 'utf8'),
      '# 구조적 재분석\n\n인과 구조를 중심으로 다시 분석했습니다.'
    );

    fs.writeFileSync(result.markdownPath, markdown, 'utf8');
    const appliedPath = await new WebPageIngestor(fakeLlm, 0).applyFollowup(
      result.markdownPath,
      '### 반론과 검증\n\n결정론적 병합 테스트'
    );
    const appliedMarkdown = fs.readFileSync(appliedPath, 'utf8');
    assert.match(appliedMarkdown, /결정론적 병합 테스트/);
    assert.match(appliedMarkdown, /This is a sufficiently long article body/);
    assert.strictEqual((appliedMarkdown.match(/BATIFLOW_FOLLOWUP_START/g) || []).length, 1);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(vaultPath, { recursive: true, force: true });
    fs.rmSync(scrapPath, { recursive: true, force: true });
  }

  console.log('Web page ingestor tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
