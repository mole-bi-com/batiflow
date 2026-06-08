import { ChromeLauncher } from '../cdp/ChromeLauncher';
import { CdpClient } from '../cdp/CdpClient';
import { YoutubePlaylistParser } from './YoutubePlaylistParser';

async function main() {
  const launcher = new ChromeLauncher();
  const wsUrl = await launcher.launch();
  
  // Get list of available tabs
  const http = require('http');
  const tabs: any[] = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
  
  // Create a new tab and navigate to YouTube
  const targetId = tabs[0]?.id;
  if (!targetId) {
    console.error('No tab available');
    await launcher.kill();
    process.exit(1);
  }

  const client = new CdpClient(targetId);
  await client.connect();
  
  try {
    const parser = new YoutubePlaylistParser(client);
    const videos = await parser.parseList();
    
    console.log('\n=== ALL VIDEOS ===');
    videos.forEach((v: any, i: number) => {
      console.log(`${i+1}. [${v.addedText}] ${v.title} - ${v.channel}`);
    });
    console.log(`\nTotal: ${videos.length} videos`);
    
    // Filter: recent additions (hours/minutes, or today)
    const recent = videos.filter((v: any) => {
      const t = (v.addedText || '').toLowerCase();
      return t.includes('hour') || t.includes('minute') || t.includes('시간') || t.includes('분');
    });
    
    console.log(`\n=== RECENT (<24h): ${recent.length} videos ===`);
    recent.forEach((v: any, i: number) => {
      console.log(`${i+1}. [${v.addedText}] ${v.title} - ${v.channel}`);
      console.log(`   URL: ${v.url}`);
    });
    
    // Output in machine-parseable format for next step
    if (recent.length > 0) {
      console.log('\n=== URLS_TO_INGEST ===');
      recent.forEach((v: any) => console.log(v.url));
      console.log('=== END_URLS ===');
    }
  } finally {
    await client.disconnect();
    await launcher.kill();
  }
}

main().catch(console.error);
