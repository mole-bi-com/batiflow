import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IngestWorker } from '../worker/IngestWorker';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batiflow-registry-test-'));
const registryPath = path.join(tempDir, '.batiflow-registry.json');

try {
  const worker = new IngestWorker(registryPath);
  const emptyRegistry = worker.loadRegistry();
  assert.deepStrictEqual(emptyRegistry, {
    lastSyncTimestamp: '',
    processedUrls: {}
  });

  worker.saveRegistry({
    lastSyncTimestamp: '',
    processedUrls: {
      'https://example.com/post': '2026-06-05T00:00:00.000Z'
    }
  });

  const savedRegistry = worker.loadRegistry();
  assert.ok(savedRegistry.lastSyncTimestamp);
  assert.strictEqual(
    savedRegistry.processedUrls['https://example.com/post'],
    '2026-06-05T00:00:00.000Z'
  );

  fs.writeFileSync(registryPath, '{ malformed json', 'utf8');
  assert.throws(
    () => worker.loadRegistry(),
    SyntaxError,
    'An unreadable existing registry must not be treated as empty state.'
  );

  console.log('✅ IngestWorker registry safety tests passed.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
