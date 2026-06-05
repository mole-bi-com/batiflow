import { isOlderThan24Hours } from '../utils/date';

function runTests() {
  console.log('🧪 Running isOlderThan24Hours unit tests...\n');

  interface TestCase {
    input: string;
    expected: boolean;
    description: string;
  }

  // Create datetime strings relative to now
  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const twentyThreeHoursAgo = new Date(now - 23 * 60 * 60 * 1000).toISOString();
  const twentyFiveHoursAgo = new Date(now - 25 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

  const testCases: TestCase[] = [
    // 1. ISO/Date Strings
    { input: oneHourAgo, expected: false, description: 'ISO string: 1 hour ago' },
    { input: twentyThreeHoursAgo, expected: false, description: 'ISO string: 23 hours ago' },
    { input: twentyFiveHoursAgo, expected: true, description: 'ISO string: 25 hours ago' },
    { input: twoDaysAgo, expected: true, description: 'ISO string: 2 days ago' },

    // 2. Special keywords
    { input: 'Recent', expected: false, description: 'Keyword: Recent' },
    { input: 'now', expected: false, description: 'Keyword: now' },
    { input: '', expected: false, description: 'Keyword: Empty string' },

    // 3. Short LinkedIn/Instagram abbreviations
    { input: '3h', expected: false, description: 'Short relative: 3h' },
    { input: '1d', expected: false, description: 'Short relative: 1d (boundary)' },
    { input: '2d', expected: true, description: 'Short relative: 2d' },
    { input: '5d', expected: true, description: 'Short relative: 5d' },
    { input: '1w', expected: true, description: 'Short relative: 1w' },
    { input: '3w', expected: true, description: 'Short relative: 3w' },
    { input: '2mo', expected: true, description: 'Short relative: 2mo' },
    { input: '1yr', expected: true, description: 'Short relative: 1yr' },

    // 4. English relative formats (YouTube and others)
    { input: 'Added 2 hours ago', expected: false, description: 'English: Added 2 hours ago' },
    { input: 'Added 1 day ago', expected: false, description: 'English: Added 1 day ago' },
    { input: 'Added 3 days ago', expected: true, description: 'English: Added 3 days ago' },
    { input: 'Added 2 weeks ago', expected: true, description: 'English: Added 2 weeks ago' },
    { input: 'Added 1 month ago', expected: true, description: 'English: Added 1 month ago' },

    // 5. Korean relative formats
    { input: '추가한 날짜: 2시간 전', expected: false, description: 'Korean: 추가한 날짜: 2시간 전' },
    { input: '추가한 날짜: 1일 전', expected: false, description: 'Korean: 추가한 날짜: 1일 전' },
    { input: '추가한 날짜: 3일 전', expected: true, description: 'Korean: 추가한 날짜: 3일 전' },
    { input: '추가한 날짜: 1주 전', expected: true, description: 'Korean: 추가한 날짜: 1주 전' },
    { input: '추가한 날짜: 한달 전', expected: true, description: 'Korean: 추가한 날짜: 한달 전' },
  ];

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    const result = isOlderThan24Hours(tc.input);
    if (result === tc.expected) {
      console.log(`✅ [PASS] "${tc.input}" -> Expected: ${tc.expected}. Description: ${tc.description}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] "${tc.input}" -> Expected: ${tc.expected}, Got: ${result}. Description: ${tc.description}`);
      failed++;
    }
  }

  console.log(`\n📊 Test Summary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 All tests passed successfully!');
  }
}

runTests();
