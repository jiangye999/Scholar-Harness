import { logger } from '../../utils/logger';
import { chatBridge } from '../../bridge/chat-bridge/chat-bridge';
import { AUTO_RESEARCH_PAPER_TOPIC_CONTENT_SKILL } from '../../config/auto-research-paper-topic-skill';
import {
  REFERENCE_RELEVANCE_AUDIT_RULES,
  REFERENCE_RELEVANCE_RESEARCH_ARTIFACTS,
} from '../../config/reference-relevance-constraint-skill';
import type { ChatOptions } from '../../types';

export type AcademicResearchMode =
  | 'socratic-plan'
  | 'research-plan'
  | 'citation-integrity'
  | 'multi-review'
  | 'pipeline-gate'
  | 'material-passport';

export interface AcademicResearchRunInput {
  mode: AcademicResearchMode;
  userId?: string;
  chapterName?: string;
  topic?: string;
  targetJournal?: string;
  paperType?: string;
  currentPhase?: string;
  researchContext?: string;
  chapterPlan?: unknown;
  content?: string;
  references?: unknown[];
  experimentResults?: unknown[];
  userInstruction?: string;
  topicSkillContent?: string;
  maxTokens?: number;
}

export interface AcademicResearchRunResult {
  mode: AcademicResearchMode;
  provider: 'codex-cli' | 'secondary-api' | 'primary-api';
  content: string;
  fallbackAttempts: string[];
}

const MODE_TITLES: Record<AcademicResearchMode, string> = {
  'socratic-plan': 'ARS Socratic Planning',
  'research-plan': 'ARS Deep Research Planning',
  'citation-integrity': 'ARS Citation Integrity Gate',
  'multi-review': 'ARS Multi-Reviewer Quality Check',
  'pipeline-gate': 'ARS Pipeline Stage Gate',
  'material-passport': 'ARS Material Passport',
};

export async function runAcademicResearchSkill(input: AcademicResearchRunInput): Promise<AcademicResearchRunResult> {
  const prompt = buildAcademicResearchPrompt(input);
  const maxTokens = input.maxTokens || defaultMaxTokens(input.mode);
  const attempts: string[] = [];

  const baseOptions: Omit<ChatOptions, 'forceProvider'> = {
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    maxTokens,
    codexTimeoutMs: 300000,
  };

  try {
    const content = await chatBridge.chat({
      ...baseOptions,
      forceProvider: 'codex',
      disableFallback: true,
    });
    return { mode: input.mode, provider: 'codex-cli', content, fallbackAttempts: attempts };
  } catch (error) {
    const message = (error as Error).message;
    attempts.push(`Codex CLI: ${message}`);
    logger.warn(`[AcademicResearchSkills] Codex failed for ${input.mode}: ${message}`);
  }

  try {
    const content = await chatBridge.chat({
      ...baseOptions,
      forceProvider: 'secondary',
    });
    return { mode: input.mode, provider: 'secondary-api', content, fallbackAttempts: attempts };
  } catch (error) {
    const message = (error as Error).message;
    attempts.push(`小牛马 API: ${message}`);
    logger.warn(`[AcademicResearchSkills] Secondary fallback failed for ${input.mode}: ${message}`);
  }

  try {
    const content = await chatBridge.chat({
      ...baseOptions,
      forceProvider: 'primary',
    });
    return { mode: input.mode, provider: 'primary-api', content, fallbackAttempts: attempts };
  } catch (error) {
    const message = (error as Error).message;
    attempts.push(`大牛马 API: ${message}`);
    logger.warn(`[AcademicResearchSkills] Primary fallback failed for ${input.mode}: ${message}`);
    throw new Error(attempts.join('；'));
  }
}

export function buildAcademicResearchPrompt(input: AcademicResearchRunInput): string {
  const contextBlock = buildContextBlock(input);
  const shouldApplyTopicSkill = input.mode === 'socratic-plan' || input.mode === 'research-plan' || input.mode === 'pipeline-gate';
  const topicSkillContent = input.topicSkillContent || AUTO_RESEARCH_PAPER_TOPIC_CONTENT_SKILL;
  const topicSkillBlock = shouldApplyTopicSkill
    ? `\n\n## Paper Topic & Content Research Skill\n${topicSkillContent}`
    : '';
  const commonRules = `你正在为 Scholar Harness 执行 ${MODE_TITLES[input.mode]}。

执行原则：
1. 这是 Academic Research Skills 思路的项目内接入版，只抽取流程设计，不依赖或复刻第三方插件运行时。
2. 默认以 Codex CLI 作为第一执行引擎；如果你看到这条提示，说明后端已经处理了降级策略。
3. 不编造来源、数据、DOI、审稿意见或用户没有提供的实验结果。
4. 明确区分：已验证证据、可疑证据、缺失证据、需要用户确认的信息。
5. 输出要能直接进入 Scholar Harness 后续流程。
6. 参考文献相关性是硬约束：不能把相邻证据、机制证据、背景证据写成直接证据。${topicSkillBlock}`;

  switch (input.mode) {
    case 'socratic-plan':
      return `${commonRules}

任务：把 ARS 的 Socratic planning 变成“大牛马规划增强模式”。

请基于用户当前信息生成：
1. 仍需向用户追问的 3-7 个关键问题，按优先级排序。
2. 一个可直接映射到 ChapterPlan 的 JSON 草案。
3. 每个章节的写作重点、关键要点、特殊要求、建议字数。
4. 需要先确认的风险或模糊点。

JSON 字段建议：
{
  "paperType": "",
  "targetJournal": "",
  "researchQuestion": "",
  "chapterPlans": [
    {
      "chapterName": "Introduction",
      "enabled": true,
      "writingFocus": "",
      "keyPoints": [],
      "specialRequirements": "",
      "wordCountTarget": 0
    }
  ],
  "socraticQuestions": [],
  "risksToConfirm": []
}

${contextBlock}`;

    case 'research-plan':
      return `${commonRules}

任务：作为 deep-research 前置规划层，为现有 hybrid retrieval 生成检索策略。

请输出：
1. 按 Paper Topic & Content Research Skill 完成论文类型判断、选题大小诊断、研究边界锁定和科学问题优化。
2. 研究问题重述和边界。
3. 检索策略：核心概念、同义词、布尔检索式、中文/英文关键词。
4. 纳入标准和排除标准。
5. 文献矩阵字段设计。
6. Reference Relevance Matrix 和 Excluded References 字段设计：每条文献必须标注 Direct / System-specific / Adjacent / Mechanistic / Background / Excluded、证据强度、使用边界和排除原因。
7. 进入本项目 HybridRetrievalEngine 的 query 列表，每条包含 topic、keywords、argumentContext、filters。
8. 对 Introduction / Discussion / Literature Review 三类章节的不同检索重点。
9. 生成 Paper Writing Blueprint，明确可写结论、不能写的结论、证据分级策略、必须增加的图表和是否建议进入写作阶段。

参考文献相关性矩阵要求：
${REFERENCE_RELEVANCE_RESEARCH_ARTIFACTS}

请优先输出结构化 Markdown，最后附 JSON：
{
  "searchQueries": [
    {
      "topic": "",
      "keywords": [],
      "argumentContext": "",
      "targetCount": 4,
      "filters": {}
    }
  ],
  "inclusionCriteria": [],
  "exclusionCriteria": [],
  "literatureMatrixFields": [],
  "paperWritingBlueprint": {
    "paper_type": "",
    "recommended_title": "",
    "core_scientific_questions": [],
    "supported_claims": [],
    "claims_to_avoid": [],
    "writing_warnings": [],
    "go_to_writing_stage": ""
  }
}

${contextBlock}`;

    case 'citation-integrity':
      return `${commonRules}

任务：执行 citation-check + integrity gate，重点做 claim-reference alignment。

请检查：
1. 文内引用是否存在于参考文献表。
2. 参考文献是否真实可信，DOI/年份/作者是否匹配。
3. 每个重要 claim 是否真的被对应引用支持。
4. 未引用强断言、因果断言、最佳/首次/显著提升等高风险表述。
5. 引用使用是否存在“真实文献支撑错误主张”的问题。
6. 按 Reference Relevance & Evidence Constraint 区分直接证据、系统特异性证据、相邻证据、机制证据、背景证据和排除文献。

输出结构：
- Verdict: PASS / WARN / BLOCK
- Blocking Issues
- Citation Mismatches
- Unsupported Claims
- Uncited Strong Assertions
- Reference Metadata Risks
- Reference Relevance Matrix
- Excluded References
- Recommended Fixes
- Machine JSON

参考文献相关性审计要求：
${REFERENCE_RELEVANCE_AUDIT_RULES}

JSON 字段建议：
{
  "verdict": "PASS|WARN|BLOCK",
  "citationMismatches": [],
  "unsupportedClaims": [],
  "uncitedStrongAssertions": [],
  "referenceMetadataRisks": [],
  "recommendedFixes": []
}

${contextBlock}`;

    case 'multi-review':
      return `${commonRules}

任务：把 academic-paper-reviewer 接入大牛马质量检查，生成多视角审稿报告。

请模拟 5 个互相独立的评审视角：
1. 方法学审稿人：研究设计、统计、可复现性、数据透明度。
2. 领域审稿人：文献覆盖、理论框架、贡献定位。
3. 跨学科审稿人：外部有效性、实践意义、跨领域连接。
4. 逻辑挑战者：最强反驳、逻辑漏洞、过度外推、确认偏误。
5. 主编：期刊契合度、创新性、总体决定。

输出：
- Editorial Decision: Accept / Minor Revision / Major Revision / Reject
- 5 份简洁独立评审
- 共识问题
- 分歧问题
- Revision Roadmap，按 Critical/Major/Minor 排序
- 可直接给 academic-paper revision mode 使用的修订任务列表

${contextBlock}`;

    case 'pipeline-gate':
      return `${commonRules}

任务：把 academic-pipeline 拆成 Scholar Harness 的阶段闸门，而不是全量替换现有流程。

当前建议状态机：
topic -> research -> planning -> writing -> integrity -> review -> revision -> final

请基于当前材料判断：
1. 按 Paper Topic & Content Research Skill 判断选题、边界和证据链是否已足以进入写作。
2. 当前应处于哪个阶段。
3. 是否应该进入 integrity gate。
4. 是否应该进入 multi-review。
5. 是否需要回到 research/planning/writing/revision。
6. 下一步最小可执行动作。

输出 JSON：
{
  "currentStage": "",
  "recommendedNextStage": "",
  "gateVerdict": "proceed|pause|revise|needs-user-confirmation",
  "topicRiskLevel": "low|medium|high|not-recommended",
  "paperTypeRecommendation": "",
  "missingInputs": [],
  "nextActions": [],
  "risks": [],
  "claimsToAvoid": []
}

${contextBlock}`;

    case 'material-passport':
      return `${commonRules}

任务：为上传实验结果生成 Material Passport，服务 Results / Discussion 写作。

请输出每份材料的：
- 文件来源
- 提取模型 / 视觉模型 / 解析工具
- 提取时间
- 置信度
- 未确认项
- 是否建议进入论文写作
- 建议关联章节
- 可复核证据片段

输出 JSON：
{
  "materials": [
    {
      "fileName": "",
      "source": "",
      "analysisProvider": "",
      "visionModel": "",
      "confidence": "high|medium|low",
      "uncertainItems": [],
      "includeInWriting": true,
      "linkedChapters": [],
      "evidencePointers": []
    }
  ]
}

${contextBlock}`;
  }
}

function buildContextBlock(input: AcademicResearchRunInput): string {
  return `## 当前上下文
- 用户 ID: ${input.userId || 'web-user'}
- 论文主题: ${input.topic || '未提供'}
- 论文类型: ${input.paperType || '未提供'}
- 目标期刊: ${input.targetJournal || '未提供'}
- 当前阶段: ${input.currentPhase || '未提供'}
- 当前章节: ${input.chapterName || '未提供'}
- 用户额外要求: ${input.userInstruction || '无'}

## 研究上下文
${input.researchContext || '未提供'}

## 章节规划
${safeJson(input.chapterPlan)}

## 待检查/待处理正文
${truncate(input.content || '未提供', 50000)}

## 参考文献
${safeJson(input.references)}

## 实验结果材料
${safeJson(input.experimentResults)}
`;
}

function safeJson(value: unknown): string {
  if (value === undefined || value === null) return '未提供';
  try {
    return truncate(JSON.stringify(value, null, 2), 50000);
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value;
}

function defaultMaxTokens(mode: AcademicResearchMode): number {
  if (mode === 'citation-integrity' || mode === 'multi-review') return 16000;
  if (mode === 'research-plan' || mode === 'socratic-plan') return 12000;
  return 8000;
}
