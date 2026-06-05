import * as fs from 'fs';
import { WebPageIngestor } from './WebPageIngestor';

function readArgument(name: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

async function main(): Promise<void> {
  const markdownPath = readArgument('--path');
  const analysisFile = readArgument('--analysis-file');
  if (!markdownPath || !analysisFile) {
    throw new Error('Usage: npm run apply:markdown -- --path "<PATH>" --analysis-file "<PATH>"');
  }

  const analysis = fs.readFileSync(analysisFile, 'utf8');
  const revisedPath = await new WebPageIngestor().applyFollowup(markdownPath, analysis);
  console.log(`BATIFLOW_RESULT_PATH=${revisedPath}`);
  console.log('BATIFLOW_RESULT_STATUS=overwritten');
}

main().catch(error => {
  console.error(`❌ Markdown follow-up application failed: ${error.message}`);
  process.exitCode = 1;
});
