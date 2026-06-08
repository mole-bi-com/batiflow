import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { YoutubeExtractor } from './YoutubeExtractor';
import { LlmProcessor } from '../llm/LlmProcessor';
import { saveToVault, saveTrace, generateCrossReferences, UnifiedNoteData } from '../utils/vaultWriter';

// Load environment variables
const projectRoot = path.resolve(__dirname, '../../../');
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

/**
 * Sanitizes strings so they can be safely used as macOS/Windows filenames.
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function main() {
  const args = process.argv.slice(2);
  const urlArgIndex = args.indexOf('--url');
  if (urlArgIndex === -1 || !args[urlArgIndex + 1]) {
    console.error('❌ Usage: npx ts-node ingest-single-youtube.ts --url "<YouTube-URL>"');
    process.exit(1);
  }

  const videoUrl = args[urlArgIndex + 1];
  const videoId = YoutubeExtractor.extractVideoId(videoUrl);
  if (!videoId) {
    console.error('❌ Invalid YouTube URL provided.');
    process.exit(1);
  }

  console.log(`⏳ [BatiFlow YouTube Ingest] Fetching metadata & transcript for video ID: ${videoId}...`);
  
  const extractor = new YoutubeExtractor();
  const llmProcessor = new LlmProcessor();

  try {
    const metadata = await extractor.fetchMetadata(videoId);
    console.log(`✅ Title: "${metadata.title}"`);
    console.log(`✅ Channel: "${metadata.channel}"`);

    const transcript = await extractor.fetchTranscript(videoId);
    console.log('🧠 Processing transcript with DeepSeek Brain Engine...');

    const llmResult = await llmProcessor.analyzeYoutubeTranscript(
      metadata.title,
      metadata.channel,
      `https://www.youtube.com/watch?v=${videoId}`,
      transcript
    );

    if (!llmResult) {
      throw new Error('DeepSeek Brain Engine returned no result.');
    }

    const { analysis, reasoning } = llmResult;

    const vaultBaseDir = process.env.OBSIDIAN_VAULT_PATH || path.join(projectRoot, 'vault');
    const todayStr = new Date().toISOString().split('T')[0];
    const nowISO = new Date().toISOString();

    // Build unified note data — YouTube keeps its rich 11-section analysis as the body
    // NER entities are parsed from the analysis text (the LLM doesn't return structured JSON for YouTube)
    const noteData: UnifiedNoteData = {
      title: metadata.title,
      source: `https://www.youtube.com/watch?v=${videoId}`,
      source_type: 'youtube',
      captured_at: nowISO,
      date: todayStr,
      author: metadata.channel,
      author_url: `https://www.youtube.com/@${metadata.channel.replace(/\s+/g, '')}`,
      tags: ['youtube', metadata.channel.toLowerCase().replace(/\s+/g, '-')],
      domains: [],
      people: [],
      organizations: [],
      products: [],
      concepts: [],
      summary: extractFirstParagraph(analysis) || metadata.title,
      body: analysis,
    };

    // Save to vault (YouTube/)
    const notePath = saveToVault(vaultBaseDir, noteData);
    const tracePath = saveTrace(vaultBaseDir, noteData, reasoning);

    // Generate cross-references
    generateCrossReferences(vaultBaseDir, noteData, notePath);

    // Backup copy
    const scrapYoutubeDir = path.join(projectRoot, `scrap/youtube/${videoId}`);
    if (!fs.existsSync(scrapYoutubeDir)) {
      fs.mkdirSync(scrapYoutubeDir, { recursive: true });
    }
    fs.writeFileSync(path.join(scrapYoutubeDir, 'analysis.md'), noteData.body, 'utf8');
    fs.writeFileSync(path.join(scrapYoutubeDir, 'reasoning_trace.txt'), reasoning, 'utf8');
    fs.writeFileSync(path.join(scrapYoutubeDir, 'transcript.txt'), transcript, 'utf8');

    console.log(`\n🎉 SUCCESS: Saved to Obsidian Vault -> ${notePath}`);
    console.log(`BATIFLOW_RESULT_PATH=${notePath}`);
    
    // Save to registry
    try {
      const vaultPath = process.env.OBSIDIAN_VAULT_PATH;
      const registryPath = vaultPath && fs.existsSync(vaultPath)
        ? path.join(vaultPath, '.batiflow-registry.json')
        : path.join(projectRoot, 'packages/capture/worker/ingest-registry.json');
      
      let registry = { lastSyncTimestamp: '', processedUrls: {} as Record<string, string> };
      if (fs.existsSync(registryPath)) {
        registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      }
      registry.processedUrls[videoUrl] = new Date().toISOString();
      fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');
      console.log(`[BatiFlow YouTube Ingest] Added URL to sync registry: ${videoUrl}`);
    } catch (err: any) {
      console.warn(`[BatiFlow YouTube Ingest] Failed to update sync registry: ${err.message}`);
    }
    
    // Print summary so calling agent can capture it
    console.log('\n---SUMMARY_START---');
    console.log(analysis.substring(0, 1500) + '\n... (Check Obsidian note for complete report)');
    console.log('---SUMMARY_END---');

  } catch (error: any) {
    console.error(`❌ Ingestion failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Extract first meaningful paragraph from markdown analysis as a summary.
 */
function extractFirstParagraph(markdown: string): string {
  const lines = markdown.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines, headings, and list markers
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-') && !trimmed.startsWith('>')) {
      return trimmed.slice(0, 200);
    }
  }
  return '';
}

main();
