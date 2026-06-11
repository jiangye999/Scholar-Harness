/**
 * 导入 Scholar Harness 满血版云端核心 Prompt 包：
 * - 章节写作 Skill
 * - Auto Research 总规划 Skill
 * - 一键写论文质量控制 Prompt
 * - PDF 阅读/分析 Soul
 */

try {
  require('dotenv/config');
} catch {
  // dotenv is optional on the server.
}

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { encryptPrompt, hashPrompt } from '../prompts/encryption';
import { DatabaseConnection } from '../database';

interface PromptSeed {
  id: string;
  name: string;
  category: string;
  content: string;
  language: 'zh' | 'en';
}

const WRITING_SKILL_FILES = [
  '01_title_skill.md',
  '02_abstract_skill.md',
  '03_introduction_skill.md',
  '04_methods_skill.md',
  '05_results_skill.md',
  '06_figures_tables_skill.md',
  '07_discussion_skill.md',
  '08_conclusion_skill.md',
  '09_additional_statements_skill.md',
];

const REVIEW_PROMPT_CONSTS: Array<{ constName: string; id: string; name: string }> = [
  { constName: 'REVIEW_WRITER_QUALITY_GATE_PROMPT', id: 'review_writer_quality_gate', name: 'Review Writer Quality Gate' },
  { constName: 'REVIEW_WRITER_SENTENCE_QUALITY_RULES', id: 'review_writer_sentence_quality_rules', name: 'Review Writer Sentence Quality Rules' },
  { constName: 'REVIEW_WRITER_SECTION_REVIEW_PROMPT', id: 'review_writer_section_review', name: 'Review Writer Section Review' },
  { constName: 'REVIEW_WRITER_FINAL_AUDIT_PROMPT', id: 'review_writer_final_audit', name: 'Review Writer Final Audit' },
  { constName: 'REVIEW_WRITER_FINAL_COMPACT_AUDIT_PROMPT', id: 'review_writer_final_compact_audit', name: 'Review Writer Compact Final Audit' },
  { constName: 'REVIEW_WRITER_FINAL_MANUSCRIPT_OPTIMIZATION_PROMPT', id: 'review_writer_final_manuscript_optimization', name: 'Review Writer Final Manuscript Optimization' },
];

async function main(): Promise<void> {
  const rootDir = resolveSourceRoot();
  const prompts = await collectPrompts(rootDir);
  const db = new DatabaseConnection();
  try {
    await db.connect();
    let imported = 0;
    for (const prompt of prompts) {
      if (await upsertPrompt(db, prompt)) imported++;
    }
    console.log(`[CorePrompts] Imported ${imported}/${prompts.length} prompts`);
  } finally {
    await db.disconnect();
  }
}

function resolveSourceRoot(): string {
  const cliArg = process.argv.find(arg => arg.startsWith('--source-root='));
  const requested = cliArg?.split('=').slice(1).join('=') || process.env.CORE_PROMPTS_SOURCE_ROOT;
  if (requested) return path.resolve(requested);

  const projectRoot = path.resolve(__dirname, '..', '..');
  const cloudRoot = path.resolve(__dirname, '..');
  if (fsSync.existsSync(path.join(projectRoot, 'sci_writing_skills'))) return projectRoot;
  return cloudRoot;
}

async function collectPrompts(rootDir: string): Promise<PromptSeed[]> {
  const prompts: PromptSeed[] = [];
  const skillsDir = path.join(rootDir, 'sci_writing_skills');
  for (const file of WRITING_SKILL_FILES) {
    const filePath = path.join(skillsDir, file);
    if (!fsSync.existsSync(filePath)) continue;
    const content = await fs.readFile(filePath, 'utf-8');
    prompts.push({
      id: file.replace(/\.md$/i, ''),
      name: parseMarkdownTitle(content) || file.replace(/\.md$/i, ''),
      category: 'writing',
      content,
      language: detectLanguage(content),
    });
  }

  const autoResearchSource = await fs.readFile(path.join(rootDir, 'src', 'config', 'auto-research-paper-topic-skill.ts'), 'utf-8');
  prompts.push({
    id: 'auto_research_topic_content_skill',
    name: 'Auto Research Paper Topic Content Skill',
    category: 'autoresearch',
    content: extractTemplateConst(autoResearchSource, 'AUTO_RESEARCH_PAPER_TOPIC_CONTENT_SKILL'),
    language: 'zh',
  });
  prompts.push({
    id: 'auto_research_topic_content_skill_for_writing',
    name: 'Auto Research Paper Topic Content Skill For Writing',
    category: 'autoresearch',
    content: extractTemplateConst(autoResearchSource, 'AUTO_RESEARCH_PAPER_TOPIC_CONTENT_SKILL_FOR_WRITING'),
    language: 'zh',
  });

  const localServerSource = await fs.readFile(path.join(rootDir, 'src', 'server', 'local-server.ts'), 'utf-8');
  const reviewValues = new Map<string, string>();
  for (const item of REVIEW_PROMPT_CONSTS) {
    reviewValues.set(item.constName, extractTemplateConst(localServerSource, item.constName));
  }
  for (const item of REVIEW_PROMPT_CONSTS) {
    const rawContent = reviewValues.get(item.constName) || '';
    prompts.push({
      id: item.id,
      name: item.name,
      category: 'quality',
      content: expandTemplateReferences(rawContent, reviewValues),
      language: detectLanguage(rawContent),
    });
  }

  const soulSeeds = [
    { file: 'pdf-reader-assistant.soul.md', id: 'pdf_reader_assistant_soul', name: 'PDF Reader Assistant Soul' },
    { file: 'pdf-paper-analysis-expert.soul.md', id: 'pdf_paper_analysis_expert_soul', name: 'PDF Paper Analysis Expert Soul' },
  ];
  for (const soul of soulSeeds) {
    const filePath = path.join(rootDir, 'configs', 'souls', soul.file);
    if (!fsSync.existsSync(filePath)) continue;
    const content = await fs.readFile(filePath, 'utf-8');
    prompts.push({
      id: soul.id,
      name: soul.name,
      category: 'soul',
      content,
      language: detectLanguage(content),
    });
  }

  return prompts.filter(prompt => prompt.content.trim().length > 0);
}

async function upsertPrompt(db: DatabaseConnection, prompt: PromptSeed): Promise<boolean> {
  try {
    const encrypted = encryptPrompt(prompt.content);
    const contentHash = hashPrompt(prompt.content);
    const existing = await db.queryOne<{ version: number }>(
      `SELECT version FROM prompts WHERE id = $1`,
      [prompt.id]
    );

    if (existing) {
      const nextVersion = existing.version + 1;
      await db.query(
        `UPDATE prompts
         SET name = $2, category = $3, content_encrypted = $4, content_hash = $5, version = $6, language = $7, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [prompt.id, prompt.name, prompt.category, encrypted, contentHash, nextVersion, prompt.language]
      );
      await db.query(
        `INSERT INTO prompt_versions (prompt_id, version, changelog)
         VALUES ($1, $2, 'Core prompt content updated')`,
        [prompt.id, nextVersion]
      );
      console.log(`[CorePrompts] Updated ${prompt.id} -> v${nextVersion}`);
    } else {
      await db.query(
        `INSERT INTO prompts (id, name, category, content_encrypted, content_hash, version, language)
         VALUES ($1, $2, $3, $4, $5, 1, $6)`,
        [prompt.id, prompt.name, prompt.category, encrypted, contentHash, prompt.language]
      );
      console.log(`[CorePrompts] Inserted ${prompt.id} -> v1`);
    }
    return true;
  } catch (error) {
    console.error(`[CorePrompts] Failed to import ${prompt.id}:`, error);
    return false;
  }
}

function extractTemplateConst(source: string, constName: string): string {
  const pattern = new RegExp(`const\\s+${escapeRegExp(constName)}\\s*=\\s*\`([\\s\\S]*?)\`;|export\\s+const\\s+${escapeRegExp(constName)}\\s*=\\s*\`([\\s\\S]*?)\`;`);
  const match = source.match(pattern);
  return (match?.[1] || match?.[2] || '').trim();
}

function expandTemplateReferences(content: string, values: Map<string, string>): string {
  return content.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => values.get(name) || '');
}

function parseMarkdownTitle(content: string): string {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
}

function detectLanguage(content: string): 'zh' | 'en' {
  return /[\u4e00-\u9fff]/.test(content) ? 'zh' : 'en';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch(error => {
  console.error('[CorePrompts] Import failed:', error);
  process.exit(1);
});
