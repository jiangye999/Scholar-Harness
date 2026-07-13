import { Router, type Request, type Response } from 'express';
import * as path from 'path';
import { promises as fs } from 'fs';
import { z, ZodError } from 'zod';
import { logger } from '../../utils/logger';
import { getUserUploadDir, sanitizeUserId } from '../../utils/paths';
import { researchSessionManager } from '../../research/research-session-manager';
import { callChatCompletion } from '../../utils/llm-client';

const submissionPrepSchema = z.object({
  userId: z.string().optional(),
  projectId: z.string().max(160).optional(),
  sessionId: z.string().max(160).optional(),
  manuscriptTitle: z.string().max(500).optional(),
  manuscriptType: z.string().max(160).optional(),
  targetJournal: z.string().max(240).optional(),
  abstractText: z.string().max(12000).optional(),
  keywords: z.string().max(1000).optional(),
  authorGuidelines: z.string().max(30000).optional(),
  coverLetterRequirements: z.string().max(12000).optional(),
  reviewerFocus: z.string().max(12000).optional(),
  useAi: z.boolean().optional(),
});

interface SubmissionPrepRuntimeConfig {
  configured: boolean;
  apiUrl: string;
  apiKey: string;
  model: string;
  label: string;
}

interface SubmissionPrepRouterDeps {
  getSecondaryRuntime?: () => SubmissionPrepRuntimeConfig;
}

export default function createSubmissionPrepRouter(deps: SubmissionPrepRouterDeps = {}): Router {
  const router = Router();

  router.post('/generate', async (req: Request, res: Response) => {
    try {
      const body = submissionPrepSchema.parse(req.body || {});
      const userId = sanitizeUserId(body.userId || 'web-user');
      const generatedAt = new Date().toISOString();
      const manuscriptTitle = cleanText(body.manuscriptTitle) || '未命名稿件';
      const targetJournal = cleanText(body.targetJournal) || '目标期刊待定';
      const manuscriptType = cleanText(body.manuscriptType) || 'Research Article';
      const prepInput = {
        generatedAt,
        manuscriptTitle,
        targetJournal,
        manuscriptType,
        abstractText: cleanText(body.abstractText),
        keywords: cleanText(body.keywords),
        authorGuidelines: cleanText(body.authorGuidelines),
        coverLetterRequirements: cleanText(body.coverLetterRequirements),
        reviewerFocus: cleanText(body.reviewerFocus),
      };
      let markdown = buildSubmissionPrepMarkdown(prepInput);
      let aiUsed = false;
      let aiProvider = '';
      let aiWarning = '';

      if (body.useAi !== false && deps.getSecondaryRuntime) {
        const runtime = deps.getSecondaryRuntime();
        if (runtime.configured) {
          try {
            markdown = await generateSubmissionPrepWithSecondary(runtime, prepInput, markdown);
            aiUsed = true;
            aiProvider = runtime.label || runtime.model;
          } catch (error) {
            aiWarning = error instanceof Error ? error.message : String(error);
            logger.warn('[SubmissionPrep] Secondary AI generation failed, using rule-based fallback:', error);
          }
        } else {
          aiWarning = '小牛马未配置，已使用本地规则模板生成。';
        }
      }

      const outputDir = path.join(getUserUploadDir(userId), 'submission-prep', timestampForPath(generatedAt));
      await fs.mkdir(outputDir, { recursive: true });
      const filePath = path.join(outputDir, 'submission-prep.md');
      await fs.writeFile(filePath, markdown, 'utf-8');

      const provenance = await researchSessionManager.appendProvenance({
        userId,
        projectId: body.projectId,
        sessionId: body.sessionId,
        sessionTitle: '投稿准备',
        sessionTopic: manuscriptTitle,
        targetType: 'writing',
        targetId: `submission-prep-${timestampForPath(generatedAt)}`,
        operation: 'submission-prep.generate',
        sourceModule: 'submission-prep',
        input: {
          manuscriptTitle,
          manuscriptType,
          targetJournal,
          hasAbstract: Boolean(cleanText(body.abstractText)),
          hasGuidelines: Boolean(cleanText(body.authorGuidelines)),
          hasCoverLetterRequirements: Boolean(cleanText(body.coverLetterRequirements)),
          hasReviewerFocus: Boolean(cleanText(body.reviewerFocus)),
        },
        output: {
          filePath,
          markdownPreview: markdown.slice(0, 2000),
        },
      });

      const artifact = await researchSessionManager.appendArtifact({
        userId,
        projectId: body.projectId,
        sessionId: provenance.session.id,
        sessionTitle: '投稿准备',
        sessionTopic: manuscriptTitle,
        kind: 'writing',
        name: `投稿准备 - ${targetJournal}`,
        filePath,
        content: markdown,
        contentType: 'text/markdown; charset=utf-8',
        provenanceRecordIds: [provenance.record.id],
        metadata: {
          targetJournal,
          manuscriptType,
          generatedAt,
          aiUsed,
          aiProvider,
          aiWarning,
        },
      });

      res.json({
        success: true,
        generatedAt,
        filePath,
        outputDir,
        markdown,
        session: provenance.session,
        artifact: artifact.artifact,
        provenanceRecord: provenance.record,
        aiUsed,
        aiProvider,
        aiWarning,
      });
    } catch (error) {
      sendSubmissionPrepError(res, error);
    }
  });

  return router;
}

async function generateSubmissionPrepWithSecondary(
  runtime: SubmissionPrepRuntimeConfig,
  input: {
    generatedAt: string;
    manuscriptTitle: string;
    targetJournal: string;
    manuscriptType: string;
    abstractText?: string;
    keywords?: string;
    authorGuidelines?: string;
    coverLetterRequirements?: string;
    reviewerFocus?: string;
  },
  fallbackMarkdown: string
): Promise<string> {
  const prompt = [
    '你是 Scholar Harness 的期刊投稿准备助手。请基于用户提供的信息生成一个可直接保存为 Markdown 的投稿准备包。',
    '必须使用中文说明为主；Cover Letter 草稿可以使用英文。',
    '不要编造期刊规则、审稿人姓名、邮箱、影响因子、投稿系统网址或作者信息。',
    '如果用户没有提供 Author Guidelines，只能给检查清单和待补充项。',
    '输出必须包含这些一级或二级部分：投稿前检查清单、Cover Letter 草稿、Highlights、推荐/回避审稿人准备、可能审稿问题、期刊要求核查、证据账本联动核查。',
    'Cover Letter 要根据摘要提炼 novelty、fit 和 central message；不要写空泛套话。',
    'Highlights 要给出可编辑的具体句子草稿，而不是只写“Highlight 1”。',
    '审稿问题要按 Major / Minor 分组。',
    '',
    '## 用户输入',
    JSON.stringify(input, null, 2),
    '',
    '## 本地规则模板',
    fallbackMarkdown,
  ].join('\n');

  const result = await callChatCompletion(
    {
      apiUrl: runtime.apiUrl,
      apiKey: runtime.apiKey,
      defaultModel: runtime.model,
      defaultTemperature: 0.35,
      label: runtime.label || '小牛马',
    },
    {
      model: runtime.model,
      messages: [
        { role: 'system', content: '你是严谨的学术投稿准备助手，只输出 Markdown，不输出过程说明。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.35,
      maxTokens: 5000,
    }
  );
  return normalizeMarkdownTitle(result, `# 投稿准备包：${input.manuscriptTitle}`);
}

function buildSubmissionPrepMarkdown(input: {
  generatedAt: string;
  manuscriptTitle: string;
  targetJournal: string;
  manuscriptType: string;
  abstractText?: string;
  keywords?: string;
  authorGuidelines?: string;
  coverLetterRequirements?: string;
  reviewerFocus?: string;
}): string {
  const normalizedKeywords = splitKeywords(input.keywords);
  const checklist = buildChecklist(input);
  return [
    `# 投稿准备包：${input.manuscriptTitle}`,
    '',
    `- 目标期刊：${input.targetJournal}`,
    `- 稿件类型：${input.manuscriptType}`,
    `- 生成时间：${input.generatedAt}`,
    normalizedKeywords.length ? `- 关键词：${normalizedKeywords.join('; ')}` : '- 关键词：待补充',
    '',
    '## 1. 投稿前检查清单',
    '',
    checklist.map(item => `- [ ] ${item}`).join('\n'),
    '',
    '## 2. Cover Letter 草稿',
    '',
    'Dear Editor,',
    '',
    `We are pleased to submit our manuscript entitled "${input.manuscriptTitle}" for consideration as a ${input.manuscriptType} in ${input.targetJournal}.`,
    '',
    'This manuscript addresses an important research question and provides evidence that may be relevant to the journal readership. The study is original, has not been published elsewhere, and is not under consideration by another journal.',
    '',
    input.abstractText ? `The central message of the manuscript is summarized as follows: ${trimForParagraph(input.abstractText, 900)}` : 'The central message, novelty, and fit to the target journal should be added here after the abstract is finalized.',
    '',
    input.coverLetterRequirements ? `Specific journal requirements considered: ${trimForParagraph(input.coverLetterRequirements, 900)}` : 'Any journal-specific cover letter requirements should be checked against the Instructions for Authors before submission.',
    '',
    'Thank you for considering our manuscript. We look forward to your response.',
    '',
    'Sincerely,',
    '',
    '[Corresponding author]',
    '',
    '## 3. Highlights / 贡献点',
    '',
    '- Highlight 1: 明确本文解决的核心科学问题。',
    '- Highlight 2: 明确最重要的方法或数据优势。',
    '- Highlight 3: 明确最关键的发现或理论贡献。',
    '- Highlight 4: 明确对目标领域或实际应用的意义。',
    '',
    '## 4. 推荐审稿人准备',
    '',
    '- 推荐审稿人 1：姓名、单位、邮箱、推荐理由。',
    '- 推荐审稿人 2：姓名、单位、邮箱、推荐理由。',
    '- 推荐审稿人 3：姓名、单位、邮箱、推荐理由。',
    '- 回避审稿人：姓名、单位、原因。',
    '',
    input.reviewerFocus
      ? `审稿关注点：${trimForParagraph(input.reviewerFocus, 1200)}`
      : '建议优先选择熟悉本文方法、研究对象或目标区域的审稿人，避免近期合作者和明显利益冲突对象。',
    '',
    '## 5. 可能被审稿人追问的问题',
    '',
    '- 研究问题是否足够新颖，是否只是已有研究的重复。',
    '- 数据来源、样本量、排除标准和统计方法是否充分透明。',
    '- 图表是否能直接支持正文中的关键结论。',
    '- 讨论是否区分了证据支持、推测和局限性。',
    '- 引用是否准确覆盖了相反证据和最新研究。',
    '',
    '## 6. 期刊要求摘录',
    '',
    input.authorGuidelines ? input.authorGuidelines : '尚未提供 Author Guidelines。提交前请补充摘要字数、图表格式、参考文献格式、数据可用性声明、伦理声明、利益冲突声明和投稿系统文件要求。',
    '',
    '## 7. 需要与证据账本联动核查',
    '',
    '- 每个关键论断应能追踪到 PDF Wiki 句子级证据、文献库记录、Auto Research 证据对象或用户数据。',
    '- 每张图应能追踪到原始数据、清洗数据、R/Python 代码、处理组颜色和输出文件。',
    '- 投稿前运行“审稿人 Agent”，优先处理 critical 和 major 问题。',
    '- 导出“可复现实验包”，保留原始数据、脚本、图件、报告和会话记录。',
    '',
  ].join('\n');
}

function buildChecklist(input: {
  targetJournal: string;
  manuscriptType: string;
  abstractText?: string;
  authorGuidelines?: string;
  coverLetterRequirements?: string;
}): string[] {
  const items = [
    `确认 ${input.targetJournal} 接收 ${input.manuscriptType} 类型稿件。`,
    '确认标题、摘要、关键词、图表、参考文献和补充材料齐全。',
    '确认伦理声明、数据可用性声明、利益冲突声明、基金信息和作者贡献声明齐全。',
    '确认正文引用与参考文献一一对应，PDF Wiki 尾注编号没有断裂。',
    '确认所有图表都能追溯到原始数据、处理代码和输出文件。',
  ];
  if (!input.abstractText) items.push('补充最终摘要后重新生成投稿准备包。');
  if (!input.authorGuidelines) items.push('补充 Author Guidelines 后检查字数、图表格式和参考文献格式。');
  if (!input.coverLetterRequirements) items.push('检查目标期刊是否要求单独声明 novelty、fit、conflict of interest 或 suggested reviewers。');
  return items;
}

function splitKeywords(value?: string): string[] {
  return String(value || '')
    .split(/[;,，；\n]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function cleanText(value?: string): string {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function trimForParagraph(value: string, maxLength: number): string {
  const compact = cleanText(value).replace(/\s+/g, ' ');
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function timestampForPath(value: string): string {
  return value.replace(/[:.]/g, '-').slice(0, 19);
}

function normalizeMarkdownTitle(value: string, fallbackTitle: string): string {
  const trimmed = cleanText(value);
  if (!trimmed) return fallbackTitle;
  if (/^#\s+/m.test(trimmed)) return trimmed;
  return `${fallbackTitle}\n\n${trimmed}`;
}

function sendSubmissionPrepError(res: Response, error: unknown): void {
  if (error instanceof ZodError) {
    res.status(400).json({ success: false, error: '投稿准备参数无效', details: error.issues });
    return;
  }
  logger.error('[SubmissionPrep] Generate error:', error);
  res.status(500).json({ success: false, error: error instanceof Error ? error.message : '投稿准备生成失败' });
}
