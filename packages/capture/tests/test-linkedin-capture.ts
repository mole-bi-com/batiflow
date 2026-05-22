/// <reference path="../../../types.d.ts" />
import { runBatiFlowCapture } from '../index';

async function testCapture() {
  const url = process.argv[2] || 'https://www.linkedin.com/posts/activity-7195484803929481216-928e';
  console.log(`[TestCapture] Running full capture integration test for: ${url}`);

  try {
    const result = await runBatiFlowCapture({
      url,
      useFallback: true // Allow Playwright fallback if not logged in
    });

    console.log('\n======================================================');
    console.log('         BATIFLOW PIPELINE INTEGRATION RESULT          ');
    console.log('======================================================');
    console.log(`Success:      ${result.success}`);
    console.log(`Engine Used:  ${result.engine}`);
    if (result.scrapPath) {
      console.log(`Scrap Path:   ${result.scrapPath}`);
    }
    if (result.score !== undefined) {
      console.log(`Quality Score: ${result.score}`);
    }
    if (result.error) {
      console.log(`Error Msg:    ${result.error}`);
    }
    console.log('======================================================\n');
  } catch (err) {
    console.error('❌ Pipeline integration test crashed:', err);
  }
}

testCapture().catch(console.error);
