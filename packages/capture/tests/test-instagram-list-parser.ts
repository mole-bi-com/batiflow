import * as assert from 'assert';
import { normalizeInstagramPostUrl } from '../sources/instagram/InstagramListParser';

assert.strictEqual(
  normalizeInstagramPostUrl('https://www.instagram.com/saved/p/ClhZzI0uH8W/'),
  'https://www.instagram.com/p/ClhZzI0uH8W/'
);
assert.strictEqual(
  normalizeInstagramPostUrl('https://www.instagram.com/saved/reel/ABC123/?utm_source=test'),
  'https://www.instagram.com/reel/ABC123/'
);
assert.strictEqual(
  normalizeInstagramPostUrl('https://www.instagram.com/p/ClhZzI0uH8W/?img_index=1'),
  'https://www.instagram.com/p/ClhZzI0uH8W/'
);
assert.strictEqual(normalizeInstagramPostUrl('https://www.instagram.com/saved/'), null);

console.log('✅ Instagram saved URL normalization tests passed.');
