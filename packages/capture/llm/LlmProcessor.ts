import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from absolute project root path
const projectRoot = path.resolve(__dirname, '../../../');
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

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

const FOLLOWUP_START = '<!-- BATIFLOW_FOLLOWUP_START -->';
const FOLLOWUP_END = '<!-- BATIFLOW_FOLLOWUP_END -->';

export function stripFollowupAnalysis(markdown: string): string {
  const startIndex = markdown.indexOf(FOLLOWUP_START);
  const endIndex = markdown.lastIndexOf(FOLLOWUP_END);
  if (startIndex >= 0 && endIndex > startIndex) {
    return `${markdown.slice(0, startIndex).trimEnd()}

${markdown.slice(endIndex + FOLLOWUP_END.length).trimStart()}`.trimEnd();
  }

  return markdown.replaceAll(FOLLOWUP_START, '').replaceAll(FOLLOWUP_END, '').trimEnd();
}

export function mergeFollowupAnalysis(markdown: string, analysis: string): string {
  const withoutPreviousFollowup = stripFollowupAnalysis(markdown);
  const sanitizedAnalysis = analysis
    .replaceAll(FOLLOWUP_START, '')
    .replaceAll(FOLLOWUP_END, '')
    .replace(/^## 추가 분석\s*/i, '')
    .trim();
  const followupSection = `${FOLLOWUP_START}
## 추가 분석

${sanitizedAnalysis}
${FOLLOWUP_END}`;
  const originalSectionIndex = withoutPreviousFollowup.indexOf('\n## 원문\n');

  if (originalSectionIndex >= 0) {
    return `${withoutPreviousFollowup.slice(0, originalSectionIndex).trimEnd()}

${followupSection}

${withoutPreviousFollowup.slice(originalSectionIndex).trimStart()}
`;
  }

  return `${withoutPreviousFollowup}

${followupSection}
`;
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
      console.log(`👉 Please add your key to ${envPath} to activate the DeepSeek Brain Engine.`);
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
          thinking: {
            type: 'enabled'
          },
          reasoning_effort: 'high'
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

  public async reviseMarkdown(markdown: string, instruction: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('DEEPSEEK_API_KEY is missing or empty in .env.');
    }

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
          {
            role: 'system',
            content: `You create a focused follow-up analysis for an existing BatiFlow Markdown note.
Return only the new or updated analytical content requested by the user.
Do not return YAML frontmatter, the original article text, a document title, or conversational commentary.
Cover every item explicitly requested by the user; do not stop after completing only some requested sections.
Use clear Markdown headings below level 2. Write Korean analysis unless the user requests another language.`
          },
          {
            role: 'user',
            content: `## Follow-up request
${instruction}

## Existing Markdown
${stripFollowupAnalysis(markdown)}`
          }
        ],
        thinking: {
          type: 'enabled'
        },
        reasoning_effort: 'low',
        max_tokens: 3500
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek API returned status ${response.status}: ${errorText}`);
    }

    const responseData: any = await response.json();
    const content = responseData.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('DeepSeek did not return revised Markdown.');
    }

    const followupAnalysis = content.replace(/^```(?:markdown)?\s*/i, '').replace(/\s*```$/, '');
    return mergeFollowupAnalysis(markdown, followupAnalysis);
  }

  /**
   * Executes deep analysis of YouTube transcripts using DeepSeek v4 Pro with Thinking Mode
   * based on the custom "YouTube 스크립트 정리 프롬프트"
   */
  public async analyzeYoutubeTranscript(
    title: string,
    channel: string,
    url: string,
    transcript: string
  ): Promise<{ analysis: string; reasoning: string } | null> {
    if (!this.isConfigured()) {
      console.log('\n⚠️ [LlmProcessor] DEEPSEEK_API_KEY is missing or empty in .env.');
      console.log(`👉 Please add your key to ${envPath} to activate the DeepSeek Brain Engine.`);
      return null;
    }

    console.log(`\n🧠 [LlmProcessor] Activating DeepSeek Brain Engine for YouTube (${this.model})...`);
    console.log(`[LlmProcessor] Analyzing YouTube video: "${title}" by [${channel}] (${transcript.length} characters of script)...`);

    const systemPrompt = `당신은 지식 합성(knowledge synthesis) 전문가다. 유튜브 영상의 전체 자막을 받아 아래 독자 프로필에 맞게 재구성한다. 시간순 요약이 아니라 **구조적 재정렬**이 목적이다.

### 독자 프로필

- AI/딥테크 창업자, 하드SF·과학 애독자, 물리·생물·신경과학에 깊은 관심
- "AI 시대에는 만들기가 가장 쉬워졌고, **판별(judgment) → 유통(distribution) → 신뢰(trust)** 순으로 가치가 이동한다"는 가치사슬 역전 관점을 가짐
- 원하는 것: 설명이 아니라 **인과 모델(causal mechanism)**, 일화가 아니라 명제, 결과가 아니라 구조
- 즐기는 것: 분야 간 연결 (생물학 ↔ 물리학 ↔ AI ↔ 전략 ↔ 역사)
- 회의적인 것: 과장(hype), 권위에의 호소, 검증 불가능한 주장

### 출력 규격 (반드시 이 순서로)

#### 1. 핵심 명제 (Core Thesis)

영상 전체를 **3줄 이하**로 압축. 화자가 무엇을 주장하는지, 어떤 세계관 전환을 요구하는지. "흥미로운 점은…" 같은 채움말 없이 바로 명제로.

#### 2. 구조 지도 (Structural Map)

- **전제 (Premises)**: 화자가 당연시하는 가정들
- **논증 흐름 (Argument Flow)**: A → B → C → 결론 형식으로 단계적으로
- **근거 종류 (Evidence Type)**: 실증 데이터인가 / 권위 인용인가 / 일화인가 / 수학적 유도(derivation)인가 / 사고실험인가

#### 3. 메커니즘 (Mechanism)

"어떻게(how)"의 층위. **결과만 나열하지 말고 인과 모델을 역설계(reverse-engineer)할 것.** 가능하면 텍스트 다이어그램 사용:

\`\`\`
원인 A → 매개 B → 결과 C
       ↑
   조절자 D
\`\`\`

수식이 본질이면 LaTeX 그대로 옮기고, 각 항이 무엇인지 1줄 주석.

#### 4. 핵심 용어 사전 (Key Term Glossary)

한글 + 영어 원문 + 1-2줄 정의. **물리·생물·화학 용어는 반드시 영어 병기**. 특별히 중요한 용어는 ★ 표시.

예시:
- 엔트로피(entropy) ★ — 거시상태(macrostate)에 대응하는 미시상태(microstate) 수의 로그. $S = k_B \\ln \\Omega$
- 컨버전스-다이버전스 존(convergence-divergence zone, CDZ) — Damasio가 제안한 피질 통합 구조

#### 5. 교차 도메인 연결 (Cross-Domain Bridges)

이 내용이 다른 영역에서 어떻게 메아리치는가. **최소 2개**, 자연스러우면 더:
- 생물학 / 신경과학 / 의학
- 물리학 / 정보이론 / 화학
- 경제 / 전략 / 비즈니스
- AI / 시스템 설계 / 분산 시스템
- 역사 / 철학 / 문학

연결은 "비슷하다"가 아니라 "왜 같은 구조가 나타나는가"를 설명할 것.

#### 6. 반직관 포인트 (Counterintuitive Insights)

상식과 충돌하는 지점. 똑똑한 비전문가(smart non-specialist)가 들었을 때 "어?" 할 부분. 통념이 왜 틀렸고 이게 왜 맞는지 함께.

#### 7. 가치사슬 관점 (Value Chain Lens)

**만들기(building) / 판별(judgment) / 유통(distribution) / 신뢰(trust)** 중 어느 단계에 대한 이야기인가? 해자(moat)는 어디에 형성되는가? 화자가 명시하지 않았어도 추론해서 적용.

#### 8. 검증 레이어 (Verification Layer)

- **의심스러운 주장**: 출처가 약하거나 fact-check가 필요한 것
- **빠진 반론**: 화자가 회피하거나 의도적으로 누락한 지점
- **과장·단순화**: hype, 일반화의 오류, cherry-picking 징후
- **분야 외 발언**: 화자의 전문성 범위 밖으로 나간 주장

영상이 광고성이거나 얕으면 여기서 명시하고 나머지 섹션은 짧게 처리.

#### 9. 적용 후크 (Application Hooks)

지금 활용 가능한 것을 구체적으로:
- 제품/사업 전략 (특히 AI/EdTech/임상 도메인)
- 연구 질문 / 가설
- 글쓰기 소재 (특히 하드SF, 기술 스릴러)
- 개인 실천 / 학습

"~할 수 있을 것이다"가 아니라 "X를 Y하라"의 형태로.

#### 10. 인용할 만한 문장 (Quotable Lines)

원문 그대로 3-5개 이내. 타임스탬프 있으면 병기. 압축하지 말고 화자가 말한 그대로.

#### 11. 다음 탐구 (Further Inquiry)

- 열린 질문 (영상이 답하지 못한 것)
- 읽어볼 책 / 논문 / 원전
- 해볼 만한 실험 / 검증 방법
- 영상에서 언급된 인물·기관·도구 중 추가 조사 가치가 있는 것

### 형식 규칙

- **출력 형식: 마크다운(.md)**
- 한국어가 1순위. 기술용어는 한+영 병기 (물리/생물/화학은 필수)
- 수식이 등장하면 LaTeX 표기 그대로
- 군더더기 금지: "흥미롭게도", "결론적으로", "~라고 말했습니다" 같은 전언체 제거
- 영상이 얕거나 광고성이면 8번에서 명시하고 나머지를 압축 처리
- **길이는 스크립트 분량이 아니라 알맹이 밀도에 비례**. 2시간짜리라도 알맹이가 적으면 짧게, 20분이라도 빽빽하면 길게.

### 하지 말 것 (Anti-patterns)

- ❌ 시간순 줄거리 요약 ("먼저 화자는…, 그 다음에는…")
- ❌ 모든 발언을 동등 가중치로 나열 (중요도 차등 없이)
- ❌ "~라고 말했습니다" 식의 전언체 (직접 명제로 옮길 것)
- ❌ 출처 모호한 비유로 본질 흐리기
- ❌ 결론을 인용으로 대체 (LLM이 직접 압축할 것)
- ❌ "이 영상은 매우 유익합니다" 같은 메타 평가 (8번 외에서는 금지)

---

## 옵션: 짧은 영상용 경량 버전

10분 미만이거나 단일 주제 영상이면 위 11개 섹션 대신 다음 5개로 축약해서 작성해도 괜찮다:
1. **핵심 명제** (3줄)
2. **메커니즘** (인과 다이어그램)
3. **용어 사전** (한+영)
4. **교차 연결 + 적용** (통합)
5. **검증 레이어** (의심 + 누락 + 과장)

---

## 옵션: 도메인 특화 부가 지시

주제에 따라 알맞은 가이드를 자동으로 융합하여 작성하라.
- 물리/수학: "수식 유도(derivation)는 절대 생략 말고 단계별로 풀어라. 각 변수의 의미와 단위(unit)를 명시하라."
- 생물/의학: "메커니즘은 분자 수준 → 세포 수준 → 조직 수준 → 임상 표현형 순으로 층을 나눠라."
- 비즈니스/전략: "수치(matrix, TAM/SAM/SOM, 단가, 마진)는 별도 표로 빼라."
- 철학/사상: "주장의 전제와 함의(implication)를 분리하라. 같은 결론으로 가는 대안 논증도 1개 제시하라."
- SF/창작: "세계관 설정(world-building)과 플롯 장치(plot device)를 구분해 추출하라."`;

    const userPrompt = `
### Target YouTube Video Information
- **Title**: ${title}
- **Channel**: ${channel}
- **URL**: ${url}

### Extracted Captions / Transcript
${transcript}
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
          thinking: {
            type: 'enabled'
          },
          reasoning_effort: 'high'
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

      console.log(`[LlmProcessor] YouTube analysis finished successfully. (Reasoning trace size: ${reasoning.length} chars, Markdown size: ${content.length} chars)`);

      return { analysis: content, reasoning };

    } catch (error: any) {
      console.error(`❌ [LlmProcessor] DeepSeek API Error during YouTube processing: ${error.message}`);
      return null;
    }
  }

  // ──────────────────────────────────────────────────
  //  User Interest Profile (AI Relevance Filtering)
  // ──────────────────────────────────────────────────

  public static readonly USER_INTEREST_PROFILE = `사용자의 미션: 6개월 내 양자 바이오 기업 이직 → 1조 부자

이 사용자는 아래 정보를 찾고 있다 (관련도 높을수록 높은 점수):

【1순위: 핵심 타겟 — 1.0점 만점 기준 0.8~1.0】
- 양자생명공학(quantum biology) 스타트업/기업: 펀딩, 제품 출시, 임상, IPO, 채용
- 라디컬 쌍(radical pair) 기술 기반 센서/진단/이미징 회사
- 양자센싱(quantum sensing) 바이오 기업 (NV diamond, OPM 등)
- 양자 AI 신약개발(quantum AI drug discovery) 스타트업
- 계산 양자생물학(computational quantum biology) 플랫폼 회사
- 위 기업들의 창업자, CTO, CSO, 리드 사이언티스트 인터뷰/발언

【2순위: 생태계 인텔리전스 — 0.5~0.7】
- 양자 바이오 분야 VC 투자 동향, 펀딩 뉴스
- Big Pharma의 양자 기술 도입/파트너십
- 양자 하드웨어 발전이 바이오 응용에 미치는 영향
- 주요 연구소/대학의 양자생물학 기술이전 소식
- 양자생명공학 컨퍼런스, 밋업, 채용 이벤트

【3순위: 주변 정보 — 0.3~0.5】
- AI 에이전트/자동화 도구 (생산성 향상)
- 창업/스타트업 일반 뉴스 (양자 아닌 일반 바이오텍 포함)
- 건강 최적화, 수명 연장, 바이오해킹
- 계산생물학/생물정보학 일반

【무시: 0.0~0.2】
- 연예인, 스포츠, 정치 일반
- 밈, 개인적 일상
- 양자와 무관한 일반 AI 뉴스
- 암호화폐/블록체인 (관련 없음)
- 부동산/주식 일반`;

  /**
   * batchJudgeRelevance
   *
   * Given a list of candidate posts (each with url, textPreview, author),
   * asks DeepSeek to score each one against the USER_INTEREST_PROFILE.
   *
   * Returns only the entries whose relevance_score >= threshold (default 0.4).
   * Threshold controls how strictly we filter — 0.4 = moderate relevance.
   */
  public async batchJudgeRelevance(
    entries: Array<{ url: string; textPreview: string; author: string }>,
    threshold: number = 0.4
  ): Promise<Array<{ url: string; textPreview: string; author: string; relevanceScore: number; relevanceReason: string }>> {
    if (entries.length === 0) return [];
    if (!this.isConfigured()) {
      console.log('⚠️ [LlmProcessor] DeepSeek not configured — bypassing AI relevance filter.');
      return entries.map(e => ({ ...e, relevanceScore: 0.5, relevanceReason: 'LLM unavailable; passed by default' }));
    }

    // Build a compact batch — each entry gets a short ID
    const items = entries.map((e, i) => ({ id: i + 1, ...e }));
    const list = items.map(i => `[${i.id}] Author: ${i.author}\n    Preview: ${i.textPreview.slice(0, 300)}\n    URL: ${i.url}`).join('\n\n');

    const systemPrompt = `You are a research relevance filter. Your job is to score social media posts against a researcher's interest profile.

## Researcher Interest Profile
${LlmProcessor.USER_INTEREST_PROFILE}

## Scoring Rules
- Score each post from 0.0 (completely irrelevant) to 1.0 (highly relevant).
- 0.0–0.2: unrelated (celebrity gossip, sports, casual life posts, memes)
- 0.3–0.5: vaguely related (tech-adjacent, general science, AI hype without substance)
- 0.6–0.7: clearly relevant (touches one of the research domains above, substantial content)
- 0.8–1.0: highly relevant (directly discusses quantum biology, radical pair, quantum precision medicine, quantum sensing, or computational quantum biology with new insights)
- Consider the author's expertise and the post's substance.
- Consider the presence of technical depth, research citations, mechanistic explanations.

## Output Format
Return ONLY a JSON array. No markdown, no explanation.

[
  {"id": 1, "relevanceScore": 0.85, "relevanceReason": "Discusses radical pair mechanism and avian magnetoreception — directly in core research domain"},
  {"id": 2, "relevanceScore": 0.0, "relevanceReason": "Personal post about weekend plans; completely irrelevant"}
]`;

    const userPrompt = `Batch of ${items.length} social media posts to score:\n\n${list}`;

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
          max_tokens: 2048,
          temperature: 0.1  // Low temperature for consistent scoring
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek API returned status ${response.status}: ${errorText}`);
      }

      const responseData: any = await response.json();
      const content = responseData.choices?.[0]?.message?.content || '';

      // Parse JSON safely
      let cleaned = content.trim();
      if (cleaned.startsWith('```')) {
        const match = cleaned.match(/```(?:json)?([\s\S]*?)```/);
        if (match && match[1]) cleaned = match[1].trim();
      }

      const scores: Array<{ id: number; relevanceScore: number; relevanceReason: string }> = JSON.parse(cleaned);

      // Merge scores back with original entries
      const result = items.map(item => {
        const scored = scores.find(s => s.id === item.id);
        return {
          url: item.url,
          textPreview: item.textPreview,
          author: item.author,
          relevanceScore: scored?.relevanceScore ?? 0.3,
          relevanceReason: scored?.relevanceReason ?? 'No LLM judgement; conservative default'
        };
      });

      // Filter by threshold
      const passed = result.filter(r => r.relevanceScore >= threshold);
      const total = result.length;
      const passedCount = passed.length;
      console.log(`[LlmProcessor] AI Relevance Filter: ${passedCount}/${total} posts passed (threshold=${threshold}).`);
      if (total > passedCount) {
        const skipped = result.filter(r => r.relevanceScore < threshold);
        skipped.forEach(s => console.log(`  ✗ SKIP [${s.relevanceScore.toFixed(2)}] ${s.author}: ${s.relevanceReason}`));
      }
      passed.forEach(p => console.log(`  ✓ PASS [${p.relevanceScore.toFixed(2)}] ${p.author}: ${p.relevanceReason}`));

      return passed;

    } catch (error: any) {
      console.error(`❌ [LlmProcessor] Batch relevance judgment failed: ${error.message}`);
      // Fallback: return all entries at moderate score
      return items.map(item => ({
        url: item.url,
        textPreview: item.textPreview,
        author: item.author,
        relevanceScore: 0.5,
        relevanceReason: 'Batch judgement failed; passed by default'
      }));
    }
  }
}
