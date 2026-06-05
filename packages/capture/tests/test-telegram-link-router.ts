import * as assert from 'assert';
import { classifyTelegramLink } from '../telegram/TelegramLinkRouter';

function run(): void {
  assert.deepStrictEqual(
    classifyTelegramLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    { kind: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ' }
  );

  assert.deepStrictEqual(
    classifyTelegramLink('https://www.anthropic.com/institute/recursive-self-improvement'),
    { kind: 'web', url: 'https://www.anthropic.com/institute/recursive-self-improvement' }
  );

  assert.deepStrictEqual(classifyTelegramLink('내용정리'), { kind: 'unsupported' });

  console.log('Telegram link router tests passed.');
}

run();
