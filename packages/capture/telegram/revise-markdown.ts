import { WebPageIngestor } from './WebPageIngestor';

function readArgument(name: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

async function main(): Promise<void> {
  const markdownPath = readArgument('--path');
  const instruction = readArgument('--instruction');
  if (!markdownPath || !instruction) {
    throw new Error('Usage: npm run revise:markdown -- --path "<PATH>" --instruction "<REQUEST>"');
  }

  const revisedPath = await new WebPageIngestor().revise(markdownPath, instruction);
  console.log(`BATIFLOW_RESULT_PATH=${revisedPath}`);
  console.log('BATIFLOW_RESULT_STATUS=overwritten');
}

main().catch(error => {
  console.error(`❌ Markdown revision failed: ${error.message}`);
  process.exitCode = 1;
});
