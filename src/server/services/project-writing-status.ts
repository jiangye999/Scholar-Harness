export type ProjectWritingStage =
  | 'planning'
  | 'ready_to_write'
  | 'research_analysis'
  | 'drafting'
  | 'revising';

export interface DerivedProjectWritingStatus {
  stage: ProjectWritingStage;
  stageLabel: string;
  frameworkExplicitlyConfirmed: boolean;
  canContinueWriting: boolean;
  totalChapterCount: number;
  draftedChapterCount: number;
  completedChapterCount: number;
  activeChapterCount: number;
  evidence: string[];
}

export interface ProjectUserRequirement {
  source: 'memory' | 'recent-user-message';
  label: string;
  text: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function cleanText(value: unknown, maxChars = 600): string {
  return String(value || '')
    .replace(/<[^>]{1,120}>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

function memoryIndicatesWritingStarted(value: unknown): boolean {
  const text = cleanText(value, 2_000);
  if (!text || /^(?:尚未|还没|未)(?:开始|进入|撰写|写作)/.test(text)) return false;
  return /(?:已(?:完成|写|生成|保存|形成)|正在(?:写|修改|润色|整合)|已有草稿|初稿|草稿|撰写中|修改中|润色中|续写)/.test(text);
}

/**
 * Derive the effective project stage from concrete writing artifacts. The
 * framework confirmation flag is retained as an explicit UI decision, but it
 * must not erase evidence that chapter writing has already started.
 */
export function deriveProjectWritingStatus(contextValue: unknown): DerivedProjectWritingStatus {
  const context = asRecord(contextValue);
  const framework = asRecord(context.discussionFramework);
  const writingProgress = asRecord(context.articleWritingProgress);
  const registry = asRecord(context.articleDraftChapterRegistry);
  const memory = asRecord(context.memory);
  const progressChapters = asRecords(writingProgress.chapters);
  const registryChapters = asRecords(registry.chapters);
  const draftedKeys = new Set<string>();

  progressChapters.forEach((chapter, index) => {
    const key = cleanText(chapter.key || chapter.title || `chapter-${index}`, 180).toLowerCase();
    if (chapter.drafted === true || Number(chapter.draftChars || 0) > 0) draftedKeys.add(key);
  });
  registryChapters.forEach((chapter, index) => {
    if (chapter.exists !== true) return;
    draftedKeys.add(cleanText(chapter.key || chapter.title || `registry-${index}`, 180).toLowerCase());
  });

  const completedChapterCount = progressChapters.filter(chapter => (
    chapter.completed === true || cleanText(chapter.status, 40) === 'completed'
  )).length;
  const activeChapterCount = progressChapters.filter(chapter => (
    chapter.current === true || cleanText(chapter.status, 40) === 'in_progress'
  )).length;
  const totalChapterCount = Math.max(
    Number(writingProgress.totalChapterCount || 0),
    progressChapters.length,
    registryChapters.length,
  );
  const draftedChapterCount = draftedKeys.size;
  const frameworkExplicitlyConfirmed = cleanText(framework.planningStatus, 40) === 'confirmed';
  const memoryWritingStarted = memoryIndicatesWritingStarted(memory.writingProgress);
  const frameworkProgress = asRecord(framework.progressSummary);
  const analyzedChapterCount = Math.max(0, Number(frameworkProgress.analyzedChapters || 0));
  const hasConcreteWritingEvidence = draftedChapterCount > 0
    || completedChapterCount > 0
    || activeChapterCount > 0
    || memoryWritingStarted;

  let stage: ProjectWritingStage;
  let stageLabel: string;
  if (
    totalChapterCount > 0
    && completedChapterCount >= totalChapterCount
    && (draftedChapterCount > 0 || memoryWritingStarted)
  ) {
    stage = 'revising';
    stageLabel = '全文整合、修改与核验阶段';
  } else if (hasConcreteWritingEvidence) {
    stage = 'drafting';
    stageLabel = '章节写作与修改阶段';
  } else if (analyzedChapterCount > 0) {
    stage = 'research_analysis';
    stageLabel = '研究分析与框架细化阶段';
  } else if (frameworkExplicitlyConfirmed) {
    stage = 'ready_to_write';
    stageLabel = '框架已确认，待开始章节写作';
  } else {
    stage = 'planning';
    stageLabel = '论文框架规划阶段';
  }

  const evidence: string[] = [];
  if (draftedChapterCount > 0) evidence.push(`检测到 ${draftedChapterCount} 个真实章节草稿`);
  if (completedChapterCount > 0) evidence.push(`页面标记 ${completedChapterCount} 个章节已完成`);
  if (activeChapterCount > 0) evidence.push(`页面标记 ${activeChapterCount} 个章节正在写`);
  if (memoryWritingStarted) evidence.push(`长期记忆记录：${cleanText(memory.writingProgress, 260)}`);
  if (analyzedChapterCount > 0) evidence.push(`已有 ${analyzedChapterCount} 个章节的图表或数据分析`);
  if (frameworkExplicitlyConfirmed) evidence.push('右侧论文框架已由用户明确确认');
  if (evidence.length === 0) evidence.push('尚未检测到章节草稿、正在写标记或已完成章节');

  return {
    stage,
    stageLabel,
    frameworkExplicitlyConfirmed,
    canContinueWriting: frameworkExplicitlyConfirmed || hasConcreteWritingEvidence,
    totalChapterCount,
    draftedChapterCount,
    completedChapterCount,
    activeChapterCount,
    evidence,
  };
}

const REQUIREMENT_MEMORY_LABELS: Record<string, string> = {
  paper_topic: '论文主题',
  research_topic: '研究主题',
  target_journal: '目标期刊',
  user_preferences: '用户长期偏好',
  writing_style: '写作风格',
  citation_preferences: '引用要求',
  pending_chapters: '待完成内容',
};

function isLikelyUserRequirement(value: string): boolean {
  const text = cleanText(value, 1_000);
  if (text.length < 4) return false;
  if (/^(?:你好|您好|嗨|hello|hi|谢谢|好的|收到|在吗)[!！,.，。\s]*$/i.test(text)) return false;
  return /(?:请|需要|要求|希望|帮我|给我|不要|不能|必须|务必|保留|删除|去掉|添加|改成|修改|调整|按照|基于|写成|撰写|生成|分析|引用|格式|目标期刊|中文|英文)/i.test(text);
}

/** Collect a compact, auditable list of requirements instead of hiding all
 * prior user intent behind an on-demand memory manifest. */
export function collectProjectUserRequirements(
  contextValue: unknown,
  history: Array<{ role?: string; content?: string }> = [],
  maxItems = 10,
): ProjectUserRequirement[] {
  const context = asRecord(contextValue);
  const memory = asRecord(context.memory);
  const collected: ProjectUserRequirement[] = [];
  const seen = new Set<string>();
  const add = (requirement: ProjectUserRequirement): void => {
    const text = cleanText(requirement.text, 600);
    const identity = text.toLowerCase().replace(/\s+/g, '');
    if (!text || !identity || seen.has(identity)) return;
    seen.add(identity);
    collected.push({ ...requirement, text });
  };

  Object.entries(REQUIREMENT_MEMORY_LABELS).forEach(([key, label]) => {
    if (memory[key]) add({ source: 'memory', label, text: cleanText(memory[key], 600) });
  });
  const directMemoryAliases: Array<[string, string]> = [
    ['paperTopic', '论文主题'],
    ['targetJournal', '目标期刊'],
    ['userPreferences', '用户长期偏好'],
    ['writingStyle', '写作风格'],
    ['citationPreferences', '引用要求'],
    ['pendingChapters', '待完成内容'],
  ];
  directMemoryAliases.forEach(([key, label]) => {
    if (memory[key]) add({ source: 'memory', label, text: cleanText(memory[key], 600) });
  });
  asRecords(memory.other).forEach(entry => {
    const key = cleanText(entry.key, 120);
    const label = REQUIREMENT_MEMORY_LABELS[key];
    if (label && entry.value) add({ source: 'memory', label, text: cleanText(entry.value, 600) });
  });
  asRecords(memory.globalWritingRequirements).forEach(entry => {
    if (entry.active === false || !entry.text) return;
    const sourceLabels = Array.isArray(entry.sourceLabels)
      ? entry.sourceLabels.map(label => cleanText(label, 120)).filter(Boolean).join('、')
      : '';
    add({
      source: 'memory',
      label: sourceLabels || '全局写作要求',
      text: cleanText(entry.text, 600),
    });
  });

  history
    .filter(item => String(item?.role || '').toLowerCase() === 'user')
    .slice(-12)
    .reverse()
    .forEach(item => {
      const text = cleanText(item.content, 480);
      if (isLikelyUserRequirement(text)) {
        add({ source: 'recent-user-message', label: '近期用户原话', text });
      }
    });
  (Array.isArray(memory.recentUserQueries) ? memory.recentUserQueries : [])
    .slice(-8)
    .reverse()
    .forEach(value => {
      const text = cleanText(value, 480);
      if (isLikelyUserRequirement(text)) {
        add({ source: 'recent-user-message', label: '近期用户原话', text });
      }
    });

  const memoryItems = collected.filter(item => item.source === 'memory');
  const recentItems = collected.filter(item => item.source === 'recent-user-message').slice(0, 6);
  return [...memoryItems, ...recentItems].slice(0, Math.max(1, Math.min(20, maxItems)));
}

export function buildProjectContinuityPromptBlock(
  context: unknown,
  history: Array<{ role?: string; content?: string }> = [],
): string {
  const status = deriveProjectWritingStatus(context);
  const requirements = collectProjectUserRequirements(context, history);
  const contextRecord = asRecord(context);
  const stateFiles = asRecord(contextRecord.writingStateFiles);
  const lines = [
    '## 当前项目写作连续性（自动核对）',
    `- 实际项目阶段：${status.stageLabel}`,
    `- 章节事实：真实草稿 ${status.draftedChapterCount} 个；页面已完成 ${status.completedChapterCount} 个；正在写 ${status.activeChapterCount} 个；规划章节 ${status.totalChapterCount} 个。`,
    `- 判断证据：${status.evidence.join('；')}`,
    `- 框架显式确认：${status.frameworkExplicitlyConfirmed ? '是' : '否'}`,
  ];
  if (stateFiles.progressPath) lines.push(`- 项目进度文件：${cleanText(stateFiles.progressPath, 800)}`);
  if (stateFiles.workspaceRequirementsPath) lines.push(`- 全局写作要求镜像：${cleanText(stateFiles.workspaceRequirementsPath, 800)}`);
  if (status.canContinueWriting && !status.frameworkExplicitlyConfirmed) {
    lines.push('- 连续性规则：虽然右侧框架尚未显式确认，但项目已经存在真实写作进展。不得把整个项目说成“仍处于规划阶段”，不得要求用户从头开始；应继续已有章节的写作、修改和核验，同时把框架确认作为可补充事项。');
  } else if (!status.canContinueWriting) {
    lines.push('- 连续性规则：当前尚无正文写作证据，可以继续讨论并确认框架。');
  } else {
    lines.push('- 连续性规则：按已确认框架和真实草稿继续写作，不得退回初始规划状态。');
  }
  if (requirements.length > 0) {
    lines.push('', '### 用户已经提出的要求（按来源保留）');
    requirements.forEach(item => lines.push(`- [${item.label}] ${item.text}`));
    lines.push('回答和执行时必须延续这些要求；若新要求与旧要求冲突，以最新用户原话为准。用户可直接编辑工作目录中的“用户写作要求.json”，下一次同步会读取并全局生效。');
  }
  return `${lines.join('\n')}\n\n`;
}
