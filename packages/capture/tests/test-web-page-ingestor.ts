import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { LlmProcessor } from '../llm/LlmProcessor';
import { WebPageIngestor } from '../telegram/WebPageIngestor';

async function run(): Promise<void> {
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
    const result = await new WebPageIngestor(fakeLlm).ingest(url);
    const markdown = fs.readFileSync(result.markdownPath, 'utf8');

    assert.strictEqual(result.title, 'Test Article');
    assert.strictEqual(result.summary, '테스트 웹페이지 요약');
    assert.match(markdown, /This is a sufficiently long article body/);
    assert.doesNotMatch(markdown, /This navigation should be removed/);
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
