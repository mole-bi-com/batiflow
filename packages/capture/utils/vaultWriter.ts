import * as fs from 'fs';
import * as path from 'path';

/**
 * Unified note data format shared across YouTube, Social, and Web ingestion.
 */
export interface UnifiedNoteData {
  title: string;
  source: string;
  source_type: 'youtube' | 'instagram' | 'x' | 'linkedin' | 'threads' | 'web';
  captured_at: string;
  date: string;
  author: string;
  author_url?: string;
  tags: string[];
  domains: string[];
  people: string[];
  organizations: string[];
  products: string[];
  concepts: string[];
  summary: string;
  /**
   * The clean analysis body (e.g. YouTube 11-section analysis, or Web/Social summary).
   * NOT the raw scrap — raw body goes to scrap/ only.
   */
  body: string;
  verification_score?: number;
}

/**
 * Health-related keywords used to auto-classify tags into the Health/ category.
 */
const HEALTH_KEYWORDS = [
  'health', 'medical', 'drug', 'disease', 'clinical', 'therapeutic',
  'antiviral', 'vaccine', 'diagnosis', 'biomarker', 'genetic',
  'neurology', 'cardio', 'cancer', ' aging', 'longevity',
  'nutrition', 'diet', 'exercise', 'sleep', 'mental',
  'gut', ' microbiome', 'immunity', 'inflammation',
  'pain', 'surgery', 'pharma', 'eye', 'vision', 'oral',
  'skin', 'hormone', 'stem cell', 'gene therapy',
  // Korean
  '건강', '의학', '치료', '질병', '약물', '백신',
  '항바이러스', '면역', '영양', '운동', '수면',
  '항노화', '장수', '노화', '안구', '눈', '시력',
];

/**
 * Generate unified YAML frontmatter string.
 */
export function generateFrontmatter(d: UnifiedNoteData): string {
  const yamlKey = (key: string, val: string | undefined | null): string =>
    val ? `${key}: "${val.replace(/"/g, '\\"')}"` : '';

  const yamlList = (key: string, arr: string[]): string => {
    if (arr.length === 0) return `${key}: []`;
    return `${key}:\n${arr.map(item => `  - "${item.replace(/"/g, '\\"')}"`).join('\n')}`;
  };

  const crossRefCompanies = d.organizations.filter(o => o && o.length > 0);
  const crossRefPeople = d.people.filter(p => p && p.length > 0);
  const crossRefHealth = d.tags.filter(t =>
    HEALTH_KEYWORDS.some(kw => t.toLowerCase().includes(kw.toLowerCase()))
  );

  return `---
title: "${d.title.replace(/"/g, '\\"')}"
source: "${d.source.replace(/"/g, '\\"')}"
source_type: "${d.source_type}"
captured_at: "${d.captured_at}"
date: "${d.date}"
author: "${d.author.replace(/"/g, '\\"')}"
${yamlKey('author_url', d.author_url)}

tags:
${d.tags.map(t => `  - "${t.replace(/"/g, '\\"')}"`).join('\n')}

domains:
${d.domains.map(t => `  - "${t}"`).join('\n')}

people:
${d.people.map(p => `  - "${p.replace(/"/g, '\\"')}"`).join('\n')}

organizations:
${d.organizations.map(o => `  - "${o.replace(/"/g, '\\"')}"`).join('\n')}

products:
${d.products.map(p => `  - "${p.replace(/"/g, '\\"')}"`).join('\n')}

concepts:
${d.concepts.map(c => `  - "${c.replace(/"/g, '\\"')}"`).join('\n')}

cross_refs:
  companies:
${crossRefCompanies.map(c => `    - "${c.replace(/"/g, '\\"')}"`).join('\n') || '    []'}
  health:
${crossRefHealth.map(h => `    - "${h.replace(/"/g, '\\"')}"`).join('\n') || '    []'}
  people:
${crossRefPeople.map(p => `    - "${p.replace(/"/g, '\\"')}"`).join('\n') || '    []'}

analysis: "DeepSeek v4 Brain Engine"
summary: "${d.summary.replace(/"/g, '\\"').replace(/\n/g, ' ')}"
${d.verification_score !== undefined ? `verification_score: ${d.verification_score}` : ''}
---
`;
}

/**
 * Build the full note markdown (frontmatter + clean body, no raw scrap).
 */
export function buildNote(d: UnifiedNoteData): string {
  const fm = generateFrontmatter(d);
  return `${fm}\n${d.body}\n`;
}

/**
 * Determine which subfolder the date-based note goes into.
 */
function getVaultCategoryDir(vaultBase: string, d: UnifiedNoteData): string {
  // YouTube stays in YouTube/
  if (d.source_type === 'youtube') {
    return path.join(vaultBase, 'YouTube', d.date);
  }
  // Everything else → Web/
  return path.join(vaultBase, 'Web', d.date);
}

/**
 * Save the unified note to the vault. Returns the saved file path.
 */
export function saveToVault(vaultBase: string, d: UnifiedNoteData): string {
  const noteContent = buildNote(d);
  const vaultDir = getVaultCategoryDir(vaultBase, d);
  if (!fs.existsSync(vaultDir)) {
    fs.mkdirSync(vaultDir, { recursive: true });
  }

  // Sanitize filename
  const safeTitle = d.title
    .replace(/[/\\?%*:|"<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'Untitled';

  // Source type prefix
  const prefix = d.source_type === 'youtube' ? '[YouTube]' :
    d.source_type === 'instagram' ? '[Instagram]' :
    d.source_type === 'x' ? '[X]' :
    d.source_type === 'linkedin' ? '[LinkedIn]' :
    d.source_type === 'threads' ? '[Threads]' : '[Web]';

  const filename = `${prefix} ${safeTitle}.md`;
  const notePath = path.join(vaultDir, filename);
  fs.writeFileSync(notePath, noteContent, 'utf8');
  console.log(`[VaultWriter] Saved note → ${notePath}`);
  return notePath;
}

/**
 * Save reasoning trace alongside the note.
 */
export function saveTrace(vaultBase: string, d: UnifiedNoteData, traceContent: string): string {
  const vaultDir = getVaultCategoryDir(vaultBase, d);
  if (!fs.existsSync(vaultDir)) {
    fs.mkdirSync(vaultDir, { recursive: true });
  }
  const safeTitle = d.title
    .replace(/[/\\?%*:|"<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'Untitled';
  const prefix = d.source_type === 'youtube' ? '[YouTube]' : '[Social]';
  const tracePath = path.join(vaultDir, `${prefix} ${safeTitle} - reasoning_trace.txt`);
  fs.writeFileSync(tracePath, traceContent, 'utf8');
  return tracePath;
}

// ──────────────────────────────────────────────
// Cross-reference (Companies / People / Health)
// ──────────────────────────────────────────────

/**
 * Write or append a cross-reference note.
 * Each cross-ref note is a single markdown file that accumulates backlinks.
 */
function writeCrossRefNote(
  crossRefDir: string,
  entityName: string,
  sourceNotePath: string,
  summary: string,
): void {
  const safeName = entityName.replace(/[/\\?%*:|"<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!safeName) return;

  if (!fs.existsSync(crossRefDir)) {
    fs.mkdirSync(crossRefDir, { recursive: true });
  }

  const refPath = path.join(crossRefDir, `${safeName}.md`);
  const dateStr = new Date().toISOString().split('T')[0];
  const relativeLink = path.relative(path.dirname(refPath), sourceNotePath);

  const entry = `- ${dateStr} → [${path.basename(sourceNotePath, '.md')}](${relativeLink}) — ${summary.slice(0, 120)}\n`;

  if (!fs.existsSync(refPath)) {
    // Create new cross-ref note
    const content = `# ${safeName}

## 관련 자료

${entry}
`;
    fs.writeFileSync(refPath, content, 'utf8');
    console.log(`[VaultWriter] Created cross-ref → ${refPath}`);
  } else {
    // Append to existing cross-ref note
    const existing = fs.readFileSync(refPath, 'utf8');
    // Dedup: skip if this source note already referenced
    const linkMarker = `](${relativeLink})`;
    if (existing.includes(linkMarker)) {
      console.log(`[VaultWriter] Cross-ref already exists, skipping → ${refPath}`);
      return;
    }
    // Insert after the "## 관련 자료" heading
    const insertionPoint = existing.indexOf('## 관련 자료');
    if (insertionPoint >= 0) {
      const before = existing.slice(0, insertionPoint + '## 관련 자료'.length);
      const after = existing.slice(insertionPoint + '## 관련 자료'.length);
      const updated = `${before}\n\n${entry}${after}`;
      fs.writeFileSync(refPath, updated, 'utf8');
    } else {
      fs.appendFileSync(refPath, `\n${entry}`, 'utf8');
    }
    console.log(`[VaultWriter] Appended cross-ref → ${refPath}`);
  }
}

/**
 * Generate all cross-references for a given note.
 */
export function generateCrossReferences(
  vaultBase: string,
  d: UnifiedNoteData,
  sourceNotePath: string,
): void {
  const crossRefBase = vaultBase; // Companies/, People/, Health/ are at vault root

  // Organizations → Companies/
  const companiesDir = path.join(crossRefBase, 'Companies');
  for (const org of d.organizations) {
    if (org && org.trim()) {
      writeCrossRefNote(companiesDir, org, sourceNotePath, d.summary);
    }
  }

  // People → People/
  const peopleDir = path.join(crossRefBase, 'People');
  for (const person of d.people) {
    if (person && person.trim()) {
      writeCrossRefNote(peopleDir, person, sourceNotePath, d.summary);
    }
  }

  // Health-tagged → Health/
  const healthTags = d.tags.filter(t =>
    HEALTH_KEYWORDS.some(kw => t.toLowerCase().includes(kw.toLowerCase()))
  );
  if (healthTags.length > 0) {
    const healthDir = path.join(crossRefBase, 'Health');
    for (const tag of healthTags) {
      writeCrossRefNote(healthDir, tag, sourceNotePath, d.summary);
    }
  }
}
