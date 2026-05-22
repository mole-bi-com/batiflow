import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

export interface LlmAnalysisResult {
  summary: string;
  tags: string[];
  ner: {
    people: string[];
    organizations: string[];
    products_or_repos: string[];
    key_concepts: string[];
  };
  extraction_audit: {
    score: number; // 0.0 to 1.0 rating quality of clean markdown vs original context
    issues_found: string[];
    raw_cleanup_success: boolean;
  };
  skill_note: {
    has_candidate: boolean;
    candidate_explanation: string;
    suggested_selector_or_heuristic_change: string | null;
  };
}

export class LlmProcessor {
  private apiKey: string;
  private model: string;
  private apiBase: string;

  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY || '';
    this.model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro';
    // Remove trailing slash if present
    this.apiBase = (process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/$/, '');
  }

  /**
   * Check if DeepSeek API Key is configured in the environment
   */
  public isConfigured(): boolean {
    return this.apiKey.trim().length > 0;
  }

  /**
   * Executes deep analysis using DeepSeek v4 Pro with Thinking Mode
   */
  public async analyzePost(
    author: string,
    bodyContent: string,
    sourceUrl: string,
    comments: string[]
  ): Promise<{ analysis: LlmAnalysisResult; reasoning: string } | null> {
    if (!this.isConfigured()) {
      console.log('\n⚠️ [LlmProcessor] DEEPSEEK_API_KEY is missing or empty in .env.');
      console.log('👉 Please add your key to /Users/seungwoolee/Desktop/project/batiflow/.env to activate the DeepSeek Brain Engine.');
      return null;
    }

    console.log(`\n🧠 [LlmProcessor] Activating DeepSeek Brain Engine (${this.model})...`);
    console.log(`[LlmProcessor] Analyzing post by "${author}" (${bodyContent.length} characters, ${comments.length} comments)...`);

    const systemPrompt = `You are the DeepSeek-powered Brain Engine (v4-pro) of BatiFlow v1.0, an intelligent local second brain.
Your task is to analyze extracted social media posts (markdown format) and their comments.
You must execute:
1. Summary: A highly concentrated, premium 2-3 sentence summary of the core practical insights and actionable takeaways. This summary must be written in Korean (한국어로 격식 있고 자연스럽게 작성해야 합니다).
2. Tags: 5-10 high-quality, professional, semantic tags.
3. Named Entity Recognition (NER): Group key entities into:
   - People
   - Organizations / Companies
   - Products / Codebases / Repositories
   - Key Concepts / Methodology terms
4. Extraction Audit: Cross-examine if the text looks cleaned correctly, check if there are truncated text parts, leftover UI selectors, buttons (like Like/Comment/Share), or other scraper noise. Grade the quality from 0.0 (terrible) to 1.0 (perfectly clean).
5. Skill Note Candidate: If you find scraping bugs, missing comment fragments, or bad author tags in the raw data, propose a dynamic selector/regex update to append to the BatiFlow scraper skills.

You MUST format your final answer EXACTLY as a single JSON object. Output ONLY the JSON object. Do not include markdown code block syntax (like \`\`\`json) or any conversational text in your final response content.

JSON Schema structure:
{
  "summary": "...",
  "tags": ["...", "..."],
  "ner": {
    "people": ["..."],
    "organizations": ["..."],
    "products_or_repos": ["..."],
    "key_concepts": ["..."]
  },
  "extraction_audit": {
    "score": 0.95,
    "issues_found": ["..."],
    "raw_cleanup_success": true
  },
  "skill_note": {
    "has_candidate": false,
    "candidate_explanation": "...",
    "suggested_selector_or_heuristic_change": null
  }
}`;

    const userPrompt = `
### Target Post Information
- **Author**: ${author}
- **Source URL**: ${sourceUrl}

### Extracted Post Markdown
${bodyContent}

### Extracted Comments
${comments.length > 0 ? comments.map((c, i) => `Comment #${i+1}: ${c}`).join('\n') : '(No comments extracted)'}
`;

    try {
      const endpoint = `${this.apiBase}/chat/completions`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          // Enable thinking/reasoning mode
          thinking: {
            type: 'enabled'
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek API returned status ${response.status}: ${errorText}`);
      }

      const responseData: any = await response.json();
      
      const choice = responseData.choices?.[0];
      if (!choice || !choice.message) {
        throw new Error('Malformed response received from DeepSeek API.');
      }

      const content = choice.message.content || '';
      const reasoning = choice.message.reasoning_content || '';

      console.log(`[LlmProcessor] DeepSeek reasoning finished successfully. (Trace size: ${reasoning.length} chars)`);

      // Parse JSON safely, stripping code block wrappers if model included them
      let cleanedJsonString = content.trim();
      if (cleanedJsonString.startsWith('```')) {
        const match = cleanedJsonString.match(/```(?:json)?([\s\S]*?)```/);
        if (match && match[1]) {
          cleanedJsonString = match[1].trim();
        }
      }

      const analysis: LlmAnalysisResult = JSON.parse(cleanedJsonString);
      return { analysis, reasoning };

    } catch (error: any) {
      console.error(`❌ [LlmProcessor] DeepSeek API Error: ${error.message}`);
      return null;
    }
  }
}
