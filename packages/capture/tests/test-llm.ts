import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

const projectRoot = path.resolve(__dirname, '../../../');
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

async function testDeepSeek() {
  const apiKey = process.env.DEEPSEEK_API_KEY || '';
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro';
  const apiBase = (process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/$/, '');

  console.log(`Connecting to ${apiBase}/chat/completions using model ${model}...`);
  console.log(`API Key configured: ${apiKey.length > 0 ? 'yes' : 'no'}`);

  try {
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'user', content: 'Say hello in 5 words.' }
        ]
      })
    });

    console.log(`Status code: ${response.status}`);
    const data: any = await response.json();
    console.log('Response data:', JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error('Error occurred:', err.message);
  }
}

testDeepSeek();
