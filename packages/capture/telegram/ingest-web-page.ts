import { WebPageIngestor } from './WebPageIngestor';

function readArgument(name: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

async function main(): Promise<void> {
  const url = readArgument('--url');
  if (!url) {
    throw new Error('Usage: npm run ingest:web -- --url "<URL>"');
  }

  const result = await new WebPageIngestor().ingest(url);
  console.log(`BATIFLOW_RESULT_PATH=${result.markdownPath}`);
  console.log(`BATIFLOW_RESULT_TITLE=${result.title}`);
  console.log(`BATIFLOW_RESULT_SUMMARY=${result.summary}`);
}

main().catch(error => {
  console.error(`❌ Web ingestion failed: ${error.message}`);
  process.exitCode = 1;
});
