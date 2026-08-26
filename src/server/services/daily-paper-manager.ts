import * as fs from 'fs/promises';
import * as path from 'path';

import { logger } from '../../utils/logger';
import { sanitizeUserId } from '../../utils/paths';

export type DailyPaperTier = 'must_read' | 'worth_reading' | 'skip';
export type DailyPaperTrigger = 'manual' | 'scheduled' | 'startup' | 'enabled';

export interface DailyPaperSettings {
  enabled: boolean;
  researchFields: string[];
  negativeKeywords: string[];
  arxivCategories: string[];
  sources: {
    wos: boolean;
    hfDaily: boolean;
    hfTrending: boolean;
    arxiv: boolean;
    openAlex: boolean;
    europePmc: boolean;
    semanticScholar: boolean;
  };
  expandQueries: boolean;
  minScore: number;
  runTime: string;
  updatedAt: string;
}

export type DailyPaperSettingsInput = Partial<Omit<DailyPaperSettings, 'sources'>> & {
  sources?: Partial<DailyPaperSettings['sources']>;
};

export interface DailyPaperCandidate {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  publishedAt: string;
  url: string;
  pdfUrl: string;
  category: string;
  sources: string[];
  hfUpvotes: number;
  score: number;
  doi?: string;
  arxivId?: string;
  pmid?: string;
  semanticScholarId?: string;
}

export type DailyPaperFeedbackDecision = 'interested' | 'not_relevant';
export type DailyPaperLibraryTarget = 'pdf' | 'embedding';

export interface DailyPaperLibraryState {
  status: 'queued' | 'included';
  message: string;
  duplicate?: boolean;
  projectId: string;
  projectName: string;
  updatedAt: string;
}

export interface DailyPaperFeedback {
  paperId: string;
  decision: DailyPaperFeedbackDecision;
  title: string;
  doi?: string;
  arxivId?: string;
  pmid?: string;
  semanticScholarId?: string;
  updatedAt: string;
}

export interface DailyPaperReadingNote {
  overview: string;
  problem: string;
  method: string;
  experiments: string;
  limitations: string;
  takeaways: string[];
  terms: Array<{ name: string; explanation: string }>;
  evidenceLevel: 'full-text' | 'abstract';
}

export interface DailyPaperRecommendation extends DailyPaperCandidate {
  tier: DailyPaperTier;
  relevanceRank?: number;
  abstractZh: string;
  reason: string;
  relevance: string;
  caution: string;
  note?: DailyPaperReadingNote;
  feedback?: DailyPaperFeedbackDecision;
  library?: Partial<Record<DailyPaperLibraryTarget, DailyPaperLibraryState>>;
}

export interface DailyPaperRun {
  id: string;
  date: string;
  userId: string;
  trigger: DailyPaperTrigger;
  status: 'completed';
  startedAt: string;
  completedAt: string;
  summary: string;
  trend: string;
  candidateCount: number;
  recommendations: DailyPaperRecommendation[];
  errors: string[];
  sourceAttribution: { project: string; repository: string; license: string };
}

export interface DailyPaperRuntimeStatus {
  running: boolean;
  stage: string;
  message: string;
  startedAt: string;
  trigger?: DailyPaperTrigger;
  error?: string;
}

interface DailyPaperManagerOptions {
  dataDir: string;
  generateText: (input: { prompt: string; maxTokens: number }) => Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  schedulerIntervalMs?: number;
  fetchWosCandidates?: (input: {
    userId: string;
    terms: string[];
    days: number;
    limit: number;
  }) => Promise<DailyPaperCandidate[]>;
  loadUserLiterature?: (userId: string) => Array<{
    id?: string;
    title?: string;
    abstract?: string;
    doi?: string;
    keywords?: string[] | string;
    aiKeywords?: string[] | string;
    [key: string]: unknown;
  }> | Promise<Array<{
    id?: string;
    title?: string;
    abstract?: string;
    doi?: string;
    keywords?: string[] | string;
    aiKeywords?: string[] | string;
    [key: string]: unknown;
  }>>;
}

interface DailyPaperResearchProfile {
  terms: string[];
  arxivCategories: string[];
  positivePaperIds: string[];
  negativePaperIds: string[];
  feedback: Map<string, DailyPaperFeedback>;
  libraryPaperCount: number;
}

interface ReviewDecision {
  id: string;
  tier: DailyPaperTier;
  abstractZh: string;
  reason: string;
  relevance: string;
  caution: string;
}

const DAILY_PAPER_CANDIDATE_LIMIT = 20;
const DAILY_PAPER_MUST_READ_LIMIT = 3;

const DEFAULT_SETTINGS: DailyPaperSettings = {
  enabled: false,
  researchFields: [],
  negativeKeywords: [],
  arxivCategories: [],
  sources: {
    wos: false,
    hfDaily: true,
    hfTrending: true,
    arxiv: true,
    openAlex: true,
    europePmc: true,
    semanticScholar: true,
  },
  expandQueries: true,
  minScore: 2,
  runTime: '08:00',
  updatedAt: '',
};

export class DailyPaperManager {
  private readonly rootDir: string;
  private readonly generateText: DailyPaperManagerOptions['generateText'];
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly schedulerIntervalMs: number;
  private readonly loadUserLiterature?: DailyPaperManagerOptions['loadUserLiterature'];
  private readonly fetchWosCandidates?: DailyPaperManagerOptions['fetchWosCandidates'];
  private readonly statuses = new Map<string, DailyPaperRuntimeStatus>();
  private readonly activeRuns = new Map<string, Promise<DailyPaperRun>>();
  private scheduler: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;

  constructor(options: DailyPaperManagerOptions) {
    this.rootDir = path.join(options.dataDir, 'daily-papers');
    this.generateText = options.generateText;
    this.fetchImpl = options.fetchImpl || fetch;
    this.now = options.now || (() => new Date());
    this.schedulerIntervalMs = Math.max(60_000, options.schedulerIntervalMs || 5 * 60_000);
    this.loadUserLiterature = options.loadUserLiterature;
    this.fetchWosCandidates = options.fetchWosCandidates;
  }

  async getSettings(userIdInput: string): Promise<DailyPaperSettings> {
    const stored = await this.readJson<Partial<DailyPaperSettings>>(this.settingsPath(sanitizeUserId(userIdInput)));
    return this.normalizeSettings(stored || {});
  }

  async saveSettings(userIdInput: string, input: DailyPaperSettingsInput): Promise<DailyPaperSettings> {
    const userId = sanitizeUserId(userIdInput);
    const current = await this.getSettings(userId);
    const settings = this.normalizeSettings({
      ...current,
      ...input,
      sources: { ...current.sources, ...(input.sources || {}) },
      updatedAt: this.now().toISOString(),
    });
    await this.writeJson(this.settingsPath(userId), settings);
    return settings;
  }

  getStatus(userIdInput: string): DailyPaperRuntimeStatus {
    return this.statuses.get(sanitizeUserId(userIdInput))
      || { running: false, stage: 'idle', message: '等待运行', startedAt: '' };
  }

  async getStatusSnapshot(userIdInput: string): Promise<DailyPaperRuntimeStatus> {
    const userId = sanitizeUserId(userIdInput);
    const current = this.getStatus(userId);
    if (current.stage !== 'idle') return current;
    const today = this.localDate(this.now());
    const latest = await this.getLatestRun(userId);
    if (latest?.date === today) {
      return {
        running: false,
        stage: 'completed',
        message: `今日推荐已完成：已按相关性精读 ${latest.recommendations.filter(item => item.tier !== 'skip').slice(0, 4).length} 篇`,
        startedAt: latest.startedAt,
        trigger: latest.trigger,
      };
    }
    const attempt = await this.readJson<Record<string, unknown>>(this.attemptPath(userId, today));
    if (attempt) {
      const failed = String(attempt.status || '') === 'failed';
      return {
        running: false,
        stage: 'failed',
        message: failed
          ? String(attempt.error || '今天的自动推荐未完成，请手动重试。')
          : '今天的自动任务曾被中断，请点击“今日论文推荐”手动重试。',
        startedAt: String(attempt.startedAt || ''),
        trigger: String(attempt.trigger || '') as DailyPaperTrigger,
        error: failed ? String(attempt.error || '') : 'AUTOMATIC_RUN_INTERRUPTED',
      };
    }
    return current;
  }

  async listRuns(userIdInput: string, limit = 30): Promise<DailyPaperRun[]> {
    const userId = sanitizeUserId(userIdInput);
    const dir = this.runsDir(userId);
    try {
      const names = (await fs.readdir(dir))
        .filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
        .sort().reverse().slice(0, Math.max(1, Math.min(90, limit)));
      const runs = await Promise.all(names.map(name => this.readJson<DailyPaperRun>(path.join(dir, name))));
      const feedback = await this.readFeedback(userId);
      return runs.filter((run): run is DailyPaperRun => !!run)
        .map(run => this.attachFeedback(run, feedback));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async getRun(userIdInput: string, date: string): Promise<DailyPaperRun | null> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const userId = sanitizeUserId(userIdInput);
    const run = await this.readJson<DailyPaperRun>(path.join(this.runsDir(userId), `${date}.json`));
    if (!run) return null;
    const translatedRun = await this.backfillRunAbstractTranslations(userId, date, run);
    return this.attachFeedback(translatedRun, await this.readFeedback(userId));
  }

  async saveFeedback(
    userIdInput: string,
    paperIdInput: string,
    decision: DailyPaperFeedbackDecision,
  ): Promise<DailyPaperFeedback> {
    const userId = sanitizeUserId(userIdInput);
    const paperId = this.normalizeCandidateId(paperIdInput);
    if (!paperId) throw new Error('缺少论文标识。');
    if (!['interested', 'not_relevant'].includes(decision)) throw new Error('不支持的反馈类型。');
    const runs = await this.listRuns(userId, 90);
    const paper = runs.flatMap(run => run.recommendations).find(item => item.id === paperId);
    if (!paper) throw new Error('没有在每日论文历史中找到该论文。');
    const feedback = await this.readFeedback(userId);
    const item: DailyPaperFeedback = {
      paperId,
      decision,
      title: paper.title,
      ...(paper.doi ? { doi: paper.doi } : {}),
      ...(paper.arxivId ? { arxivId: paper.arxivId } : {}),
      ...(paper.pmid ? { pmid: paper.pmid } : {}),
      ...(paper.semanticScholarId ? { semanticScholarId: paper.semanticScholarId } : {}),
      updatedAt: this.now().toISOString(),
    };
    feedback.set(paperId, item);
    await this.writeJson(this.feedbackPath(userId), Array.from(feedback.values()));
    return item;
  }

  async getRecommendation(
    userIdInput: string,
    paperIdInput: string,
  ): Promise<DailyPaperRecommendation | null> {
    const userId = sanitizeUserId(userIdInput);
    const paperId = this.normalizeCandidateId(paperIdInput);
    if (!paperId) return null;
    const runs = await this.listRuns(userId, 90);
    return runs.flatMap(run => run.recommendations).find(item => item.id === paperId) || null;
  }

  async saveLibraryState(
    userIdInput: string,
    paperIdInput: string,
    target: DailyPaperLibraryTarget,
    state: Omit<DailyPaperLibraryState, 'updatedAt'>,
  ): Promise<DailyPaperLibraryState> {
    const userId = sanitizeUserId(userIdInput);
    const paperId = this.normalizeCandidateId(paperIdInput);
    if (!paperId) throw new Error('缺少论文标识。');
    const runs = await this.listRuns(userId, 90);
    if (!runs.some(run => run.recommendations.some(item => item.id === paperId))) {
      throw new Error('没有在每日论文历史中找到该论文。');
    }
    const saved: DailyPaperLibraryState = {
      ...state,
      updatedAt: this.now().toISOString(),
    };
    await Promise.all(runs.map(async run => {
      if (!run.recommendations.some(item => item.id === paperId)) return;
      const updated: DailyPaperRun = {
        ...run,
        recommendations: run.recommendations.map(item => item.id === paperId
          ? {
              ...item,
              library: {
                ...(item.library || {}),
                [target]: saved,
              },
            }
          : item),
      };
      await this.writeJson(path.join(this.runsDir(userId), `${run.date}.json`), updated);
    }));
    return saved;
  }

  async getLatestRun(userIdInput: string): Promise<DailyPaperRun | null> {
    const latest = (await this.listRuns(userIdInput, 1))[0];
    return latest ? this.getRun(userIdInput, latest.date) : null;
  }

  async run(
    userIdInput: string,
    options: { trigger?: DailyPaperTrigger; days?: number; force?: boolean } = {},
  ): Promise<DailyPaperRun> {
    const userId = sanitizeUserId(userIdInput);
    const existing = this.activeRuns.get(userId);
    if (existing) return existing;
    const operation = this.executeRun(
      userId,
      options.trigger || 'manual',
      Math.max(1, Math.min(7, Math.floor(options.days || 1))),
      options.force === true,
    ).finally(() => this.activeRuns.delete(userId));
    this.activeRuns.set(userId, operation);
    return operation;
  }

  async runIfDue(
    userIdInput: string,
    options: { trigger: DailyPaperTrigger; ignoreTime?: boolean },
  ): Promise<DailyPaperRun | null> {
    const userId = sanitizeUserId(userIdInput);
    const settings = await this.getSettings(userId);
    if (!settings.enabled || !settings.researchFields.length) return null;
    const today = this.localDate(this.now());
    if ((await this.getRun(userId, today))?.status === 'completed') return null;
    if (await this.readJson<Record<string, unknown>>(this.attemptPath(userId, today))) return null;
    if (!options.ignoreTime && !this.hasReachedRunTime(settings.runTime, this.now())) return null;
    return this.run(userId, { trigger: options.trigger });
  }

  startScheduler(): void {
    if (this.scheduler) return;
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.runDueUsers(true, 'startup');
    }, 4_000);
    this.startupTimer.unref?.();
    this.scheduler = setInterval(() => void this.runDueUsers(false, 'scheduled'), this.schedulerIntervalMs);
    this.scheduler.unref?.();
  }

  stopScheduler(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = null;
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = null;
  }

  private async runDueUsers(ignoreTime: boolean, trigger: DailyPaperTrigger): Promise<void> {
    let userIds: string[] = [];
    try {
      userIds = await fs.readdir(this.rootDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn('[DailyPapers] Config scan failed:', error);
    }
    await Promise.all(userIds.map(async userId => {
      try {
        await this.runIfDue(userId, { trigger, ignoreTime });
      } catch (error) {
        logger.warn(`[DailyPapers] Automatic run failed for ${userId}:`, (error as Error).message);
      }
    }));
  }

  private async executeRun(
    userId: string,
    trigger: DailyPaperTrigger,
    days: number,
    force: boolean,
  ): Promise<DailyPaperRun> {
    const settings = await this.getSettings(userId);
    if (!settings.researchFields.length) throw new Error('请先设置至少一个研究领域或关键词。');
    if (!Object.values(settings.sources).some(Boolean)) throw new Error('请至少启用一个论文来源。');
    const startedAt = this.now().toISOString();
    const date = this.localDate(this.now());
    const errors: string[] = [];
    if (trigger !== 'manual') {
      await this.writeJson(this.attemptPath(userId, date), { date, trigger, startedAt });
    }
    this.setStatus(userId, 'profiling', '正在结合研究方向、文献库和历史反馈建立研究画像…', startedAt, trigger);
    try {
      const profile = await this.buildResearchProfile(userId, settings, errors);
      this.setStatus(userId, 'fetching', '正在从多学科论文源抓取并筛选最新文献…', startedAt, trigger);
      const candidates = await this.fetchCandidates(userId, settings, profile, days, errors);
      const fresh = await this.removeRecent(userId, candidates, force ? date : undefined);
      const shortlist = fresh.slice(0, DAILY_PAPER_CANDIDATE_LIMIT);
      if (shortlist.length) {
        this.setStatus(userId, 'reviewing', `正在筛选 ${shortlist.length} 篇高相关候选并翻译摘要…`, startedAt, trigger);
      }
      const review = shortlist.length
        ? await this.reviewCandidates(settings, profile, shortlist)
        : {
            summary: '今天没有发现达到当前相关性门槛的论文。',
            trend: '已避免为了凑数而推荐低相关论文；可以调整研究画像、来源或最低相关性。',
            decisions: [] as ReviewDecision[],
          };
      const reviewedRecommendations: DailyPaperRecommendation[] = shortlist.map(candidate => ({
        ...candidate,
        ...(review.decisions.find(item => item.id === candidate.id) || this.fallbackDecision(candidate)),
        ...(profile.feedback.get(candidate.id)?.decision ? { feedback: profile.feedback.get(candidate.id)?.decision } : {}),
      }));
      this.enforceMustReadLimit(reviewedRecommendations, DAILY_PAPER_MUST_READ_LIMIT);
      const recommendations = reviewedRecommendations
        .filter(item => item.tier !== 'skip')
        .sort((left, right) => right.score - left.score || right.publishedAt.localeCompare(left.publishedAt))
        .slice(0, 4)
        .map((item, index) => ({ ...item, relevanceRank: index + 1 }));
      for (let index = 0; index < recommendations.length; index += 1) {
        const paper = recommendations[index];
        this.setStatus(userId, 'deep-reading', `正在精读高相关论文 ${index + 1}/${recommendations.length}：${paper.title}`, startedAt, trigger);
        try {
          paper.note = await this.createReadingNote(settings, paper);
        } catch (error) {
          errors.push(`${paper.title} 精读失败：${(error as Error).message}`);
        }
      }
      const run: DailyPaperRun = {
        id: `${date}-${Date.now()}`,
        date,
        userId,
        trigger,
        status: 'completed',
        startedAt,
        completedAt: this.now().toISOString(),
        summary: review.summary,
        trend: review.trend,
        candidateCount: candidates.length,
        recommendations,
        errors,
        sourceAttribution: {
          project: 'Dailypaper-Skills workflow adaptation',
          repository: 'https://github.com/huangkiki/dailypaper-skills',
          license: 'Apache-2.0',
        },
      };
      await this.writeJson(path.join(this.runsDir(userId), `${date}.json`), run);
      if (trigger !== 'manual') {
        await this.writeJson(this.attemptPath(userId, date), {
          date,
          trigger,
          startedAt,
          completedAt: run.completedAt,
          status: 'completed',
        });
      }
      this.statuses.set(userId, {
        running: false,
        stage: 'completed',
        message: `今日推荐已完成：已按相关性精读 ${recommendations.length} 篇`,
        startedAt,
        trigger,
      });
      return run;
    } catch (error) {
      const message = (error as Error).message || '每日论文任务失败';
      if (trigger !== 'manual') {
        await this.writeJson(this.attemptPath(userId, date), {
          date,
          trigger,
          startedAt,
          failedAt: this.now().toISOString(),
          status: 'failed',
          error: message,
        });
      }
      this.statuses.set(userId, { running: false, stage: 'failed', message, startedAt, trigger, error: message });
      throw error;
    }
  }

  private async fetchCandidates(
    userId: string,
    settings: DailyPaperSettings,
    profile: DailyPaperResearchProfile,
    days: number,
    errors: string[],
  ): Promise<DailyPaperCandidate[]> {
    const jobs: Array<Promise<DailyPaperCandidate[]>> = [];
    let successfulSources = 0;
    const safe = (label: string, job: Promise<DailyPaperCandidate[]>): Promise<DailyPaperCandidate[]> =>
      job.then(result => {
        successfulSources += 1;
        return result;
      }).catch(error => {
          errors.push(`${label}：${(error as Error).message}`);
          return [];
        });
    if (settings.sources.wos) {
      if (this.fetchWosCandidates) {
        jobs.push(safe('Web of Science', this.fetchWosCandidates({
          userId,
          terms: this.searchTerms(profile).slice(0, 12),
          days,
          limit: Math.min(120, Math.max(DAILY_PAPER_CANDIDATE_LIMIT * 4, 40)),
        }).then(records => records.map(candidate => ({
          ...candidate,
          score: this.score(candidate, settings, profile, false),
        })))));
      } else {
        errors.push('Web of Science：当前运行环境未初始化 WoS 连接器');
      }
    }
    if (settings.sources.hfDaily) jobs.push(safe('Hugging Face Daily', this.fetchHuggingFace(settings, profile, days, false)));
    if (settings.sources.hfTrending) jobs.push(safe('Hugging Face Trending', this.fetchHuggingFace(settings, profile, days, true)));
    if (settings.sources.arxiv) jobs.push(safe('arXiv', this.fetchArxiv(settings, profile, days)));
    if (settings.sources.openAlex) jobs.push(safe('OpenAlex', this.fetchOpenAlex(settings, profile, days)));
    if (settings.sources.europePmc) jobs.push(safe('Europe PMC', this.fetchEuropePmc(settings, profile, days)));
    if (settings.sources.semanticScholar && profile.positivePaperIds.length) {
      jobs.push(safe('Semantic Scholar Recommendations', this.fetchSemanticScholar(settings, profile, days)));
    }
    if (!jobs.length) {
      throw new Error('当前启用的个性化推荐源需要至少一篇带 DOI、arXiv ID 或 PMID 的种子论文。');
    }
    const batches = await Promise.all(jobs);
    if (!successfulSources) throw new Error('所有已启用论文来源暂时都不可用，请稍后重试或调整来源。');
    const merged: DailyPaperCandidate[] = [];
    const candidateIndexesByKey = new Map<string, number>();
    batches.flat().forEach(candidate => {
      candidate.id = this.normalizeCandidateId(candidate.id);
      if (!candidate.id) return;
      const keys = this.candidateDedupeKeys(candidate);
      const currentIndex = keys.map(key => candidateIndexesByKey.get(key))
        .find((index): index is number => index !== undefined);
      if (currentIndex === undefined) {
        const nextIndex = merged.length;
        merged.push(candidate);
        keys.forEach(key => candidateIndexesByKey.set(key, nextIndex));
      } else {
        merged[currentIndex] = this.mergeDuplicateCandidates(merged[currentIndex], candidate);
        this.candidateDedupeKeys(merged[currentIndex]).forEach(key => candidateIndexesByKey.set(key, currentIndex));
      }
    });
    return merged
      .filter(candidate => candidate.abstract.trim().length > 0)
      .filter(candidate => candidate.score >= settings.minScore && profile.feedback.get(candidate.id)?.decision !== 'not_relevant')
      .sort((a, b) => b.score - a.score || b.publishedAt.localeCompare(a.publishedAt));
  }

  private async buildResearchProfile(
    userId: string,
    settings: DailyPaperSettings,
    errors: string[],
  ): Promise<DailyPaperResearchProfile> {
    const feedback = await this.readFeedback(userId);
    let papers: Awaited<ReturnType<NonNullable<DailyPaperManagerOptions['loadUserLiterature']>>> = [];
    if (this.loadUserLiterature) {
      try {
        papers = await this.loadUserLiterature(userId);
      } catch (error) {
        errors.push(`本地文献画像：${(error as Error).message}`);
      }
    }
    const keywordCounts = new Map<string, number>();
    const remember = (value: unknown, weight = 1): void => {
      const values = Array.isArray(value) ? value : String(value || '').split(/[\n,，;；|]+/);
      values.map(item => String(item || '').trim()).filter(item => item.length >= 2 && item.length <= 100)
        .forEach(item => keywordCounts.set(item, (keywordCounts.get(item) || 0) + weight));
    };
    papers.slice(-300).forEach(paper => {
      remember(paper.keywords, 3);
      remember(paper.aiKeywords, 2);
    });
    Array.from(feedback.values()).forEach(item => {
      if (item.decision === 'interested') remember(item.title, 2);
    });
    const libraryTerms = Array.from(keywordCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 24).map(([value]) => value);
    let expandedTerms: string[] = [];
    let inferredCategories: string[] = [];
    if (settings.expandQueries) {
      try {
        const prompt = [
          '你是每日论文检索画像扩展器。把用户方向转换成适合学术数据库检索的中英文短语。',
          '只保留语义明确的专业术语，不要加入宽泛词（如 research、study、analysis）。',
          'arxivCategories 只返回确信相关的正式 arXiv 分类；非 arXiv 领域可以返回空数组。',
          '只输出严格 JSON：{"englishTerms":[],"chineseTerms":[],"arxivCategories":[]}',
          `用户方向：${settings.researchFields.join('；')}`,
          libraryTerms.length ? `文献库高频术语：${libraryTerms.join('；')}` : '',
        ].filter(Boolean).join('\n');
        const parsed = this.parseJson(await this.generateText({ prompt, maxTokens: 1800 }));
        expandedTerms = this.stringList([
          ...(Array.isArray(parsed?.englishTerms) ? parsed.englishTerms : []),
          ...(Array.isArray(parsed?.chineseTerms) ? parsed.chineseTerms : []),
        ], 40);
        inferredCategories = this.stringList(parsed?.arxivCategories, 12)
          .filter(value => /^[a-z-]+(?:\.[A-Za-z-]+)+$/.test(value));
      } catch (error) {
        errors.push(`查询扩展：${(error as Error).message}`);
      }
    }
    const positivePaperIds = this.uniqueStrings([
      ...papers.flatMap(paper => this.paperSeedIds(paper)),
      ...Array.from(feedback.values()).filter(item => item.decision === 'interested')
        .flatMap(item => this.paperSeedIds(item)),
    ]).slice(0, 100);
    const negativePaperIds = this.uniqueStrings(
      Array.from(feedback.values()).filter(item => item.decision === 'not_relevant')
        .flatMap(item => this.paperSeedIds(item)),
    ).slice(0, 100);
    return {
      terms: this.uniqueStrings([...settings.researchFields, ...expandedTerms, ...libraryTerms]).slice(0, 64),
      arxivCategories: this.uniqueStrings([
        ...settings.arxivCategories,
        ...(settings.arxivCategories.length ? [] : inferredCategories),
      ]).slice(0, 20),
      positivePaperIds,
      negativePaperIds,
      feedback,
      libraryPaperCount: papers.length,
    };
  }

  private async fetchHuggingFace(
    settings: DailyPaperSettings,
    profile: DailyPaperResearchProfile,
    days: number,
    trending: boolean,
  ): Promise<DailyPaperCandidate[]> {
    const urls: string[] = [];
    if (trending) {
      urls.push('https://huggingface.co/api/daily_papers?sort=trending&limit=80');
    } else {
      for (let offset = 0; offset < days; offset += 1) {
        const date = new Date(this.now());
        date.setDate(date.getDate() - offset);
        urls.push(`https://huggingface.co/api/daily_papers?date=${this.localDate(date)}&limit=100`);
      }
    }
    const payloads = await Promise.all(urls.map(url => this.fetchJson(url)));
    return payloads.flatMap(payload => Array.isArray(payload)
      ? payload.map(item => this.hfCandidate(item, settings, profile, trending)).filter((item): item is DailyPaperCandidate => !!item)
      : []);
  }

  private hfCandidate(
    value: unknown,
    settings: DailyPaperSettings,
    profile: DailyPaperResearchProfile,
    trending: boolean,
  ): DailyPaperCandidate | null {
    const item = this.record(value);
    const paper = this.record(item?.paper);
    const id = this.arxivId(String(paper?.id || ''));
    const title = String(paper?.title || '').trim();
    if (!id || !title) return null;
    const authors = Array.isArray(paper?.authors)
      ? paper.authors.map(author => String(this.record(author)?.name || author || '').trim()).filter(Boolean)
      : [];
    const candidate: DailyPaperCandidate = {
      id,
      title,
      authors,
      abstract: String(paper?.summary || '').trim(),
      publishedAt: String(paper?.publishedAt || '').slice(0, 10),
      url: `https://arxiv.org/abs/${id}`,
      pdfUrl: `https://arxiv.org/pdf/${id}`,
      category: '',
      sources: [trending ? 'hf-trending' : 'hf-daily'],
      hfUpvotes: Number(paper?.upvotes || 0),
      score: 0,
      arxivId: id,
    };
    candidate.score = this.score(candidate, settings, profile, trending);
    return candidate.score <= -900 ? null : candidate;
  }

  private async fetchArxiv(
    settings: DailyPaperSettings,
    profile: DailyPaperResearchProfile,
    days: number,
  ): Promise<DailyPaperCandidate[]> {
    const categories = profile.arxivCategories.map(value => `cat:${value}`);
    const terms = this.searchTerms(profile).slice(0, 8).map(value => `all:"${value.replace(/"/g, '')}"`);
    const categoryQuery = categories.length ? `(${categories.join(' OR ')})` : '';
    const termQuery = terms.length ? `(${terms.join(' OR ')})` : '';
    const query = categoryQuery && termQuery ? `${categoryQuery} AND ${termQuery}` : categoryQuery || termQuery || 'all:research';
    const params = new URLSearchParams({
      search_query: query,
      sortBy: 'submittedDate',
      sortOrder: 'descending',
      max_results: String(Math.min(400, Math.max(100, days * 140))),
    });
    const url = `https://export.arxiv.org/api/query?${params.toString()}`;
    const response = await this.fetchWithTimeout(url, 60_000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const entries = (await response.text()).match(/<entry>[\s\S]*?<\/entry>/gi) || [];
    const earliest = new Date(this.now());
    earliest.setDate(earliest.getDate() - Math.max(0, days - 1));
    return entries.map(entry => {
      const id = this.arxivId(this.xmlText(entry, 'id').split('/abs/').pop() || '');
      const publishedAt = this.xmlText(entry, 'published').slice(0, 10);
      if (days > 1 && publishedAt && publishedAt < this.localDate(earliest)) return null;
      const title = this.xmlText(entry, 'title').replace(/\s+/g, ' ').trim();
      const abstract = this.xmlText(entry, 'summary').replace(/\s+/g, ' ').trim();
      if (!id || !title || !abstract) return null;
      const authors = Array.from(entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi))
        .map(match => this.decodeXml(match[1]).trim()).filter(Boolean);
      const candidate: DailyPaperCandidate = {
        id,
        title,
        authors,
        abstract,
        publishedAt,
        url: `https://arxiv.org/abs/${id}`,
        pdfUrl: `https://arxiv.org/pdf/${id}`,
        category: (entry.match(/<arxiv:primary_category[^>]*term=["']([^"']+)["']/i) || [])[1] || '',
        sources: ['arxiv'],
        hfUpvotes: 0,
        score: 0,
        arxivId: id,
      };
      candidate.score = this.score(candidate, settings, profile, false);
      return candidate.score <= -900 ? null : candidate;
    }).filter((item): item is DailyPaperCandidate => !!item);
  }

  private async fetchOpenAlex(
    settings: DailyPaperSettings,
    profile: DailyPaperResearchProfile,
    days: number,
  ): Promise<DailyPaperCandidate[]> {
    const earliest = this.daysAgoDate(days);
    const terms = this.searchTerms(profile).slice(0, 4);
    if (!terms.length) return [];
    const payloads = await Promise.all(terms.map(async term => {
      const params = new URLSearchParams({
        search: term,
        filter: `from_publication_date:${earliest}`,
        sort: 'relevance_score:desc',
        per_page: '30',
      });
      const apiKey = String(process.env.OPENALEX_API_KEY || '').trim();
      const mailto = String(process.env.OPENALEX_MAILTO || '').trim();
      if (apiKey) params.set('api_key', apiKey);
      if (mailto) params.set('mailto', mailto);
      return this.fetchJson(`https://api.openalex.org/works?${params.toString()}`);
    }));
    return payloads.flatMap(payload => {
      const results = this.record(payload)?.results;
      return Array.isArray(results) ? results.map(value => {
        const item = this.record(value);
        if (!item) return null;
        const title = String(item.display_name || item.title || '').trim();
        const doi = this.normalizeDoi(item.doi);
        const openAlexId = String(item.id || '').split('/').pop() || '';
        if (!title || (!doi && !openAlexId)) return null;
        const authorships = Array.isArray(item.authorships) ? item.authorships : [];
        const authors = authorships.map(value => String(this.record(this.record(value)?.author)?.display_name || '').trim()).filter(Boolean);
        const primaryLocation = this.record(item.primary_location);
        const bestLocation = this.record(item.best_oa_location);
        const pdfUrl = String(bestLocation?.pdf_url || primaryLocation?.pdf_url || '').trim();
        const url = String(primaryLocation?.landing_page_url || item.doi || item.id || '').trim();
        const candidate: DailyPaperCandidate = {
          id: doi ? `doi:${doi}` : `openalex:${openAlexId}`,
          title,
          authors,
          abstract: this.openAlexAbstract(item.abstract_inverted_index),
          publishedAt: String(item.publication_date || '').slice(0, 10),
          url,
          pdfUrl,
          category: String(this.record(item.primary_topic)?.display_name || '').trim(),
          sources: ['openalex'],
          hfUpvotes: 0,
          score: 0,
          ...(doi ? { doi } : {}),
        };
        candidate.score = Math.max(this.score(candidate, settings, profile, false), settings.minScore);
        return candidate;
      }).filter((item): item is DailyPaperCandidate => !!item) : [];
    });
  }

  private async fetchEuropePmc(
    settings: DailyPaperSettings,
    profile: DailyPaperResearchProfile,
    days: number,
  ): Promise<DailyPaperCandidate[]> {
    const terms = this.searchTerms(profile).slice(0, 8);
    if (!terms.length) return [];
    const query = `(${terms.map(term => `"${term.replace(/"/g, '')}"`).join(' OR ')}) AND FIRST_PDATE:[${this.daysAgoDate(days)} TO ${this.localDate(this.now())}] sort_date:y`;
    const params = new URLSearchParams({ query, format: 'json', resultType: 'core', pageSize: '80' });
    const payload = this.record(await this.fetchJson(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params.toString()}`));
    const resultList = this.record(payload?.resultList);
    const results = Array.isArray(resultList?.result) ? resultList.result : [];
    return results.map(value => {
      const item = this.record(value);
      if (!item) return null;
      const title = String(item.title || '').replace(/<[^>]+>/g, '').trim();
      const doi = this.normalizeDoi(item.doi);
      const pmid = String(item.pmid || (String(item.source || '').toUpperCase() === 'MED' ? item.id : '') || '').trim();
      const pmcid = String(item.pmcid || '').trim();
      const fallbackId = String(item.id || '').trim();
      if (!title || (!doi && !pmid && !fallbackId)) return null;
      const fullTextUrls = this.record(item.fullTextUrlList)?.fullTextUrl;
      const locations = Array.isArray(fullTextUrls) ? fullTextUrls : [];
      const pdfUrl = locations.map(value => this.record(value))
        .find(value => String(value?.documentStyle || '').toLowerCase() === 'pdf')?.url;
      const url = pmcid
        ? `https://europepmc.org/article/PMC/${encodeURIComponent(pmcid.replace(/^PMC/i, ''))}`
        : pmid ? `https://europepmc.org/article/MED/${encodeURIComponent(pmid)}` : `https://europepmc.org/article/${encodeURIComponent(String(item.source || 'MED'))}/${encodeURIComponent(fallbackId)}`;
      const candidate: DailyPaperCandidate = {
        id: doi ? `doi:${doi}` : pmid ? `pmid:${pmid}` : `europepmc:${String(item.source || '')}:${fallbackId}`,
        title,
        authors: String(item.authorString || '').split(/,|;/).map(name => name.trim()).filter(Boolean),
        abstract: String(item.abstractText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        publishedAt: String(item.firstPublicationDate || item.electronicPublicationDate || item.firstIndexDate || '').slice(0, 10),
        url,
        pdfUrl: String(pdfUrl || '').trim(),
        category: String(item.journalTitle || item.pubType || 'Life sciences').trim(),
        sources: ['europe-pmc'],
        hfUpvotes: 0,
        score: 0,
        ...(doi ? { doi } : {}),
        ...(pmid ? { pmid } : {}),
      };
      candidate.score = Math.max(this.score(candidate, settings, profile, false), settings.minScore);
      return candidate;
    }).filter((item): item is DailyPaperCandidate => !!item);
  }

  private async fetchSemanticScholar(
    settings: DailyPaperSettings,
    profile: DailyPaperResearchProfile,
    days: number,
  ): Promise<DailyPaperCandidate[]> {
    if (!profile.positivePaperIds.length) return [];
    const fields = 'title,abstract,authors,url,externalIds,publicationDate,year,fieldsOfStudy,openAccessPdf';
    const apiKey = String(process.env.SEMANTIC_SCHOLAR_API_KEY || '').trim();
    const payload = this.record(await this.fetchJson(
      `https://api.semanticscholar.org/recommendations/v1/papers/?limit=100&fields=${encodeURIComponent(fields)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
        body: JSON.stringify({
          positivePaperIds: profile.positivePaperIds,
          negativePaperIds: profile.negativePaperIds,
        }),
      },
    ));
    const results = Array.isArray(payload?.recommendedPapers) ? payload.recommendedPapers : [];
    return results.map(value => {
      const item = this.record(value);
      if (!item) return null;
      const title = String(item.title || '').trim();
      const external = this.record(item.externalIds);
      const arxivId = this.arxivId(String(external?.ArXiv || ''));
      const doi = this.normalizeDoi(external?.DOI);
      const pmid = String(external?.PubMed || '').trim();
      const semanticScholarId = String(item.paperId || '').trim();
      if (!title || !semanticScholarId) return null;
      const publishedAt = String(item.publicationDate || (item.year ? `${item.year}-01-01` : '')).slice(0, 10);
      if (publishedAt && publishedAt < this.daysAgoDate(Math.max(days, 30))) return null;
      const authors = Array.isArray(item.authors)
        ? item.authors.map(value => String(this.record(value)?.name || '').trim()).filter(Boolean)
        : [];
      const openAccessPdf = this.record(item.openAccessPdf);
      const id = arxivId ? arxivId : doi ? `doi:${doi}` : pmid ? `pmid:${pmid}` : `s2:${semanticScholarId}`;
      const candidate: DailyPaperCandidate = {
        id,
        title,
        authors,
        abstract: String(item.abstract || '').trim(),
        publishedAt,
        url: String(item.url || `https://www.semanticscholar.org/paper/${semanticScholarId}`).trim(),
        pdfUrl: String(openAccessPdf?.url || (arxivId ? `https://arxiv.org/pdf/${arxivId}` : '')).trim(),
        category: Array.isArray(item.fieldsOfStudy) ? item.fieldsOfStudy.map(String).join(', ') : '',
        sources: ['semantic-scholar-recommendations'],
        hfUpvotes: 0,
        score: 0,
        ...(doi ? { doi } : {}),
        ...(arxivId ? { arxivId } : {}),
        ...(pmid ? { pmid } : {}),
        semanticScholarId,
      };
      candidate.score = Math.max(this.score(candidate, settings, profile, false), settings.minScore + 2);
      return candidate;
    }).filter((item): item is DailyPaperCandidate => !!item);
  }

  private score(
    candidate: DailyPaperCandidate,
    settings: DailyPaperSettings,
    profile: DailyPaperResearchProfile,
    trending: boolean,
  ): number {
    const title = candidate.title.toLowerCase();
    const text = `${candidate.title} ${candidate.abstract}`.toLowerCase();
    if (settings.negativeKeywords.some(keyword => text.includes(keyword.toLowerCase()))) return -999;
    let score = 0;
    profile.terms.forEach(keyword => {
      const normalized = keyword.toLowerCase();
      if (normalized && title.includes(normalized)) score += 4;
      else if (normalized && text.includes(normalized)) score += 2;
      else {
        const tokens = this.termTokens(normalized);
        const hits = tokens.filter(token => text.includes(token)).length;
        if (tokens.length >= 2 && hits === tokens.length) score += 2;
      }
    });
    if (trending && score > 0) score += candidate.hfUpvotes >= 10 ? 3 : candidate.hfUpvotes >= 5 ? 2 : candidate.hfUpvotes >= 2 ? 1 : 0;
    return score;
  }

  private async reviewCandidates(
    settings: DailyPaperSettings,
    profile: DailyPaperResearchProfile,
    candidates: DailyPaperCandidate[],
  ): Promise<{ summary: string; trend: string; decisions: ReviewDecision[] }> {
    const compact = candidates.map(item => ({
      id: item.id,
      title: item.title,
      authors: item.authors,
      abstract: item.abstract.slice(0, 1800),
      date: item.publishedAt,
      category: item.category,
      sources: item.sources,
      hfUpvotes: item.hfUpvotes,
      localKeywordScore: item.score,
    }));
    const prompt = [
      '你是 Scholar Harness 的每日论文筛选器。候选来自多个学术数据源，并已通过本地相关性门槛。',
      `用户研究领域：${settings.researchFields.join('；')}`,
      `扩展检索画像：${profile.terms.join('；')}`,
      `本地文献库证据：${profile.libraryPaperCount} 篇；正向种子 ${profile.positivePaperIds.length} 篇；负向种子 ${profile.negativePaperIds.length} 篇。`,
      settings.negativeKeywords.length ? `明确排除：${settings.negativeKeywords.join('；')}` : '',
      `逐篇分为 must_read、worth_reading、skip。must_read 最多 ${DAILY_PAPER_MUST_READ_LIMIT} 篇。分档只供内部筛选，用户界面统一显示为推荐论文。`,
      '只根据标题和摘要判断，不得编造全文实验或数字；不确定时写“需要全文核验”。每篇都必须返回，并把 abstract 忠实翻译成简体中文 abstractZh，不得扩写。',
      'summary 和 trend 面向用户，只描述推荐论文整体情况，不得出现 must_read、worth_reading、skip、必读、值得看或可跳过等分档词。',
      '只输出严格 JSON：',
      '{"summary":"","trend":"","recommendations":[{"id":"","tier":"must_read|worth_reading|skip","abstractZh":"","reason":"","relevance":"","caution":""}]}',
      JSON.stringify(compact),
    ].filter(Boolean).join('\n');
    const parsed = this.parseJson(await this.generateText({ prompt, maxTokens: 9000 }));
    const rawItems = Array.isArray(parsed?.recommendations) ? parsed.recommendations : [];
    const decisions = rawItems.map(value => {
      const item = this.record(value);
      const tier = this.tier(item?.tier);
      const id = this.normalizeCandidateId(item?.id);
      return tier && id ? {
        id,
        tier,
        abstractZh: String(item?.abstractZh || '').trim(),
        reason: String(item?.reason || '').trim(),
        relevance: String(item?.relevance || '').trim(),
        caution: String(item?.caution || '').trim(),
      } : null;
    }).filter((item): item is ReviewDecision => !!item);
    const decisionsById = new Map(decisions.map(item => [item.id, item]));
    const missingTranslations = candidates.filter(candidate => !decisionsById.get(candidate.id)?.abstractZh && candidate.abstract);
    if (missingTranslations.length) {
      try {
        const translationPrompt = [
          '把下列论文摘要忠实翻译成简体中文。不要总结、扩写或补充事实。',
          '只输出严格 JSON：{"translations":[{"id":"","abstractZh":""}]}',
          JSON.stringify(missingTranslations.map(item => ({ id: item.id, abstract: item.abstract.slice(0, 2400) }))),
        ].join('\n');
        const translated = this.parseJson(await this.generateText({ prompt: translationPrompt, maxTokens: 7000 }));
        const translations = Array.isArray(translated?.translations) ? translated.translations : [];
        translations.forEach(value => {
          const item = this.record(value);
          const id = this.normalizeCandidateId(item?.id);
          const abstractZh = String(item?.abstractZh || '').trim();
          const candidate = candidates.find(entry => entry.id === id);
          if (!candidate || !abstractZh) return;
          const decision = decisionsById.get(id) || this.fallbackDecision(candidate);
          decisionsById.set(id, { ...decision, abstractZh });
        });
      } catch (error) {
        logger.warn('[DailyPapers] Abstract translation fallback failed:', (error as Error).message);
      }
    }
    const completedDecisions = candidates.map(candidate => {
      const decision = decisionsById.get(candidate.id) || this.fallbackDecision(candidate);
      return {
        ...decision,
        abstractZh: decision.abstractZh || (/\p{Script=Han}/u.test(candidate.abstract)
          ? candidate.abstract
          : '中文摘要暂未生成，请通过论文页面核验原文摘要。'),
      };
    });
    return {
      summary: String(parsed?.summary || '已完成今日论文推荐。').trim(),
      trend: String(parsed?.trend || '请回到原文核验重要结论。').trim(),
      decisions: completedDecisions,
    };
  }

  private async createReadingNote(
    settings: DailyPaperSettings,
    paper: DailyPaperRecommendation,
  ): Promise<DailyPaperReadingNote> {
    const source = await this.fetchPaperText(paper);
    const evidenceLevel: DailyPaperReadingNote['evidenceLevel'] = source.fullText ? 'full-text' : 'abstract';
    const prompt = [
      '只依据下方材料生成中文论文精读笔记，不得编造实验数字、公式、数据集或结论。',
      `用户研究领域：${settings.researchFields.join('；')}`,
      `论文：${paper.title}`,
      `材料级别：${source.fullText ? 'arXiv HTML 正文' : '摘要回退'}`,
      'terms 要解释术语及其在本文中的作用。摘要回退必须在 limitations 中说明尚未核验全文。',
      '只输出严格 JSON：',
      '{"overview":"","problem":"","method":"","experiments":"","limitations":"","takeaways":[""],"terms":[{"name":"","explanation":""}]}',
      source.text.slice(0, 45_000),
    ].join('\n');
    const parsed = this.parseJson(await this.generateText({ prompt, maxTokens: 6500 }));
    if (!parsed) throw new Error('模型未返回可解析的精读笔记');
    const terms = Array.isArray(parsed.terms)
      ? parsed.terms.map(value => {
          const item = this.record(value);
          return { name: String(item?.name || '').trim(), explanation: String(item?.explanation || '').trim() };
        }).filter(item => item.name && item.explanation)
      : [];
    return {
      overview: String(parsed.overview || '').trim(),
      problem: String(parsed.problem || '').trim(),
      method: String(parsed.method || '').trim(),
      experiments: String(parsed.experiments || '').trim(),
      limitations: String(parsed.limitations || '').trim(),
      takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways.map(value => String(value || '').trim()).filter(Boolean) : [],
      terms,
      evidenceLevel,
    };
  }

  private async fetchPaperText(paper: DailyPaperCandidate): Promise<{ text: string; fullText: boolean }> {
    const arxivId = this.arxivId(String(paper.arxivId || (/^\d{4}\.\d{4,5}(?:v\d+)?$/i.test(paper.id) ? paper.id : '')));
    if (arxivId) {
      try {
        const response = await this.fetchWithTimeout(`https://arxiv.org/html/${arxivId}`, 30_000);
        if (response.ok) {
          const text = this.htmlText(await response.text());
          if (text.length >= 4_000) return { text, fullText: true };
        }
      } catch {
        // arXiv HTML is not available for every paper; abstract fallback is explicit.
      }
    }
    return {
      text: `标题：${paper.title}\n作者：${paper.authors.join(', ')}\n摘要：${paper.abstract}`,
      fullText: false,
    };
  }

  private async backfillRunAbstractTranslations(
    userId: string,
    date: string,
    run: DailyPaperRun,
  ): Promise<DailyPaperRun> {
    const targets = run.recommendations.filter(item => item.tier !== 'skip'
      && item.abstract
      && (!String(item.abstractZh || '').trim() || String(item.abstractZh).startsWith('中文摘要暂未生成')));
    if (!targets.length) return run;
    try {
      const prompt = [
        '把下列论文摘要忠实翻译成简体中文。不要总结、扩写或补充事实。',
        '只输出严格 JSON：{"translations":[{"id":"","abstractZh":""}]}',
        JSON.stringify(targets.map(item => ({ id: item.id, abstract: item.abstract.slice(0, 2400) }))),
      ].join('\n');
      const parsed = this.parseJson(await this.generateText({ prompt, maxTokens: 9000 }));
      const translations = Array.isArray(parsed?.translations) ? parsed.translations : [];
      const translatedById = new Map<string, string>();
      translations.forEach(value => {
        const item = this.record(value);
        const id = this.normalizeCandidateId(item?.id);
        const abstractZh = String(item?.abstractZh || '').trim();
        if (id && abstractZh) translatedById.set(id, abstractZh);
      });
      if (!translatedById.size) return run;
      const updated: DailyPaperRun = {
        ...run,
        recommendations: run.recommendations.map(item => ({
          ...item,
          ...(translatedById.get(item.id) ? { abstractZh: translatedById.get(item.id)! } : {}),
        })),
      };
      await this.writeJson(path.join(this.runsDir(userId), `${date}.json`), updated);
      return updated;
    } catch (error) {
      logger.warn(`[DailyPapers] Historical abstract translation failed for ${date}:`, (error as Error).message);
      return run;
    }
  }

  private async removeRecent(
    userId: string,
    candidates: DailyPaperCandidate[],
    excludedDate?: string,
  ): Promise<DailyPaperCandidate[]> {
    const seen = new Set(
      (await this.listRuns(userId, 90))
        .filter(run => run.date !== excludedDate)
        .flatMap(run => run.recommendations)
        .flatMap(item => this.candidateDedupeKeys(item)),
    );
    return candidates.filter(item => !this.candidateDedupeKeys(item).some(key => seen.has(key)));
  }

  private mergeDuplicateCandidates(
    current: DailyPaperCandidate,
    candidate: DailyPaperCandidate,
  ): DailyPaperCandidate {
    const doi = this.normalizeDoi(current.doi || candidate.doi);
    const arxivId = this.arxivId(String(current.arxivId || candidate.arxivId || ''));
    const pmid = String(current.pmid || candidate.pmid || '').trim();
    const semanticScholarId = String(current.semanticScholarId || candidate.semanticScholarId || '').trim();
    const id = doi
      ? `doi:${doi}`
      : arxivId || (pmid ? `pmid:${pmid.toLowerCase()}` : current.id || candidate.id);
    return {
      ...current,
      id,
      title: candidate.title.length > current.title.length ? candidate.title : current.title,
      authors: candidate.authors.length > current.authors.length ? candidate.authors : current.authors,
      abstract: candidate.abstract.length > current.abstract.length ? candidate.abstract : current.abstract,
      publishedAt: current.publishedAt || candidate.publishedAt,
      url: current.url || candidate.url,
      pdfUrl: current.pdfUrl || candidate.pdfUrl,
      ...(doi ? { doi } : {}),
      ...(arxivId ? { arxivId } : {}),
      ...(pmid ? { pmid } : {}),
      ...(semanticScholarId ? { semanticScholarId } : {}),
      sources: Array.from(new Set([...current.sources, ...candidate.sources])),
      hfUpvotes: Math.max(current.hfUpvotes, candidate.hfUpvotes),
      score: Math.max(current.score, candidate.score),
    };
  }

  private candidateDedupeKeys(candidate: DailyPaperCandidate): string[] {
    const keys: string[] = [];
    const doi = this.normalizeDoi(candidate.doi || (/^doi:/i.test(candidate.id) ? candidate.id : ''));
    const arxivId = this.arxivId(String(
      candidate.arxivId
      || (/^(?:arxiv:)?\d{4}\.\d{4,5}(?:v\d+)?$/i.test(candidate.id) ? candidate.id : ''),
    ));
    const pmid = String(candidate.pmid || (/^pmid:/i.test(candidate.id) ? candidate.id.slice(5) : '')).trim().toLowerCase();
    const semanticScholarId = String(
      candidate.semanticScholarId || (/^s2:/i.test(candidate.id) ? candidate.id.slice(3) : ''),
    ).trim().toLowerCase();
    if (doi) keys.push(`doi:${doi}`);
    if (arxivId) keys.push(`arxiv:${arxivId.toLowerCase()}`);
    if (pmid) keys.push(`pmid:${pmid}`);
    if (semanticScholarId) keys.push(`s2:${semanticScholarId}`);
    const title = this.normalizePaperTitle(candidate.title);
    if (title.length >= 12) keys.push(`title:${title}`);
    if (!keys.length && candidate.id) keys.push(`id:${this.normalizeCandidateId(candidate.id).toLowerCase()}`);
    return Array.from(new Set(keys));
  }

  private normalizePaperTitle(value: unknown): string {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\bpreprint\b/gi, ' ')
      .replace(/\b(?:version|ver\.?|v)\s*\d+\b/gi, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .trim();
  }

  private fallbackDecision(candidate: DailyPaperCandidate): ReviewDecision {
    return {
      id: candidate.id,
      tier: candidate.score >= 4 ? 'worth_reading' : 'skip',
      abstractZh: /\p{Script=Han}/u.test(candidate.abstract) ? candidate.abstract : '',
      reason: candidate.score >= 4 ? '本地关键词评分显示具有一定相关性。' : '与当前研究领域的直接关联有限。',
      relevance: 'AI 分档缺失，使用本地评分回退。',
      caution: '需要人工核验。',
    };
  }

  private enforceMustReadLimit(items: DailyPaperRecommendation[], limit: number): void {
    let count = 0;
    items.forEach(item => {
      if (item.tier !== 'must_read') return;
      count += 1;
      if (count > limit) item.tier = 'worth_reading';
    });
  }

  private normalizeSettings(input: DailyPaperSettingsInput): DailyPaperSettings {
    const list = (value: unknown, max: number): string[] => {
      const values = Array.isArray(value) ? value : String(value || '').split(/[\n,，;；]+/);
      return Array.from(new Set(values.map(item => String(item || '').trim()).filter(Boolean))).slice(0, max);
    };
    return {
      enabled: input.enabled === true,
      researchFields: list(input.researchFields, 20),
      negativeKeywords: list(input.negativeKeywords, 40),
      arxivCategories: list(input.arxivCategories, 20).filter(value => /^[a-z-]+(?:\.[A-Za-z-]+)+$/.test(value)),
      sources: {
        wos: input.sources?.wos === true,
        hfDaily: input.sources?.hfDaily !== false,
        hfTrending: input.sources?.hfTrending !== false,
        arxiv: input.sources?.arxiv !== false,
        openAlex: input.sources?.openAlex !== false,
        europePmc: input.sources?.europePmc !== false,
        semanticScholar: input.sources?.semanticScholar !== false,
      },
      expandQueries: input.expandQueries !== false,
      minScore: Math.max(1, Math.min(12, Math.floor(Number(input.minScore || DEFAULT_SETTINGS.minScore)))),
      runTime: /^\d{2}:\d{2}$/.test(String(input.runTime || '')) ? String(input.runTime) : DEFAULT_SETTINGS.runTime,
      updatedAt: String(input.updatedAt || ''),
    };
  }

  private setStatus(userId: string, stage: string, message: string, startedAt: string, trigger: DailyPaperTrigger): void {
    this.statuses.set(userId, { running: true, stage, message, startedAt, trigger });
  }

  private hasReachedRunTime(runTime: string, now: Date): boolean {
    const [hours, minutes] = runTime.split(':').map(Number);
    return now.getHours() * 60 + now.getMinutes() >= hours * 60 + minutes;
  }

  private localDate(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private settingsPath(userId: string): string {
    return path.join(this.rootDir, sanitizeUserId(userId), 'config.json');
  }

  private runsDir(userId: string): string {
    return path.join(this.rootDir, sanitizeUserId(userId), 'runs');
  }

  private attemptPath(userId: string, date: string): string {
    return path.join(this.rootDir, sanitizeUserId(userId), 'attempts', `${date}.json`);
  }

  private feedbackPath(userId: string): string {
    return path.join(this.rootDir, sanitizeUserId(userId), 'feedback.json');
  }

  private async readFeedback(userId: string): Promise<Map<string, DailyPaperFeedback>> {
    const stored = await this.readJson<unknown>(this.feedbackPath(userId));
    const values = Array.isArray(stored) ? stored : [];
    const feedback = new Map<string, DailyPaperFeedback>();
    values.forEach(value => {
      const item = this.record(value);
      const paperId = this.normalizeCandidateId(item?.paperId);
      const decision = String(item?.decision || '') as DailyPaperFeedbackDecision;
      if (!paperId || !['interested', 'not_relevant'].includes(decision)) return;
      feedback.set(paperId, {
        paperId,
        decision,
        title: String(item?.title || '').trim(),
        ...(item?.doi ? { doi: this.normalizeDoi(item.doi) } : {}),
        ...(item?.arxivId ? { arxivId: this.arxivId(String(item.arxivId)) } : {}),
        ...(item?.pmid ? { pmid: String(item.pmid).trim() } : {}),
        ...(item?.semanticScholarId ? { semanticScholarId: String(item.semanticScholarId).trim() } : {}),
        updatedAt: String(item?.updatedAt || ''),
      });
    });
    return feedback;
  }

  private attachFeedback(run: DailyPaperRun, feedback: Map<string, DailyPaperFeedback>): DailyPaperRun {
    return {
      ...run,
      recommendations: run.recommendations.map(item => ({
        ...item,
        ...(feedback.get(item.id)?.decision ? { feedback: feedback.get(item.id)?.decision } : {}),
      })),
    };
  }

  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      logger.warn(`[DailyPapers] Failed to read ${filePath}:`, (error as Error).message);
      return null;
    }
  }

  private async writeJson(filePath: string, value: unknown): Promise<void> {
    await this.writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  private async writeText(filePath: string, value: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, value, 'utf8');
    await fs.rename(temporary, filePath);
  }

  private async fetchJson(url: string, init?: RequestInit): Promise<unknown> {
    const response = await this.fetchWithTimeout(url, 30_000, init);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  private async fetchWithTimeout(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers(init.headers);
      if (!headers.has('User-Agent')) headers.set('User-Agent', 'Scholar-Harness-DailyPapers/1.0');
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private xmlText(entry: string, tag: string): string {
    const match = entry.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match ? this.decodeXml(match[1]) : '';
  }

  private decodeXml(value: string): string {
    return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  }

  private htmlText(html: string): string {
    return this.decodeXml(html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(?:p|div|section|article|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '))
      .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  private arxivId(value: string): string {
    return String(value || '').trim().replace(/^arXiv:/i, '').replace(/v\d+$/i, '');
  }

  private normalizeCandidateId(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(?:arxiv:)?\d{4}\.\d{4,5}(?:v\d+)?$/i.test(raw)) return this.arxivId(raw);
    if (/^doi:/i.test(raw)) return `doi:${this.normalizeDoi(raw.slice(4))}`;
    if (/^(?:pmid|s2|openalex|europepmc):/i.test(raw)) return raw.toLowerCase();
    return raw;
  }

  private normalizeDoi(value: unknown): string {
    return String(value || '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:/i, '').toLowerCase();
  }

  private termTokens(value: string): string[] {
    return Array.from(new Set(value.toLowerCase().split(/[^\p{L}\p{N}]+/u)
      .map(token => token.trim()).filter(token => token.length >= 3 && !['the', 'and', 'for', 'with', 'from'].includes(token))));
  }

  private searchTerms(profile: DailyPaperResearchProfile): string[] {
    return profile.terms.filter(term => term.length >= 2 && term.length <= 80 && !/^(research|study|analysis|paper)$/i.test(term));
  }

  private stringList(value: unknown, max: number): string[] {
    const values = Array.isArray(value) ? value : String(value || '').split(/[\n,，;；|]+/);
    return this.uniqueStrings(values.map(item => String(item || '').trim()).filter(Boolean)).slice(0, max);
  }

  private uniqueStrings(values: unknown[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    values.forEach(value => {
      const text = String(value || '').trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) return;
      seen.add(key);
      result.push(text);
    });
    return result;
  }

  private paperSeedIds(value: unknown): string[] {
    const item = this.record(value);
    if (!item) return [];
    const result: string[] = [];
    const doi = this.normalizeDoi(item.doi);
    const arxivId = this.arxivId(String(item.arxivId || ''));
    const pmid = String(item.pmid || '').trim();
    const semanticScholarId = String(item.semanticScholarId || '').trim();
    const rawId = String(item.id || '').trim();
    if (doi) result.push(`DOI:${doi}`);
    if (arxivId) result.push(`ARXIV:${arxivId}`);
    if (pmid) result.push(`PMID:${pmid}`);
    if (semanticScholarId) result.push(semanticScholarId);
    if (!result.length && /^(?:arxiv:)?\d{4}\.\d{4,5}(?:v\d+)?$/i.test(rawId)) result.push(`ARXIV:${this.arxivId(rawId)}`);
    return result;
  }

  private daysAgoDate(days: number): string {
    const date = new Date(this.now());
    date.setDate(date.getDate() - Math.max(0, days - 1));
    return this.localDate(date);
  }

  private openAlexAbstract(value: unknown): string {
    const inverted = this.record(value);
    if (!inverted) return '';
    const words: Array<{ word: string; position: number }> = [];
    Object.entries(inverted).forEach(([word, positions]) => {
      if (!Array.isArray(positions)) return;
      positions.forEach(position => {
        const numeric = Number(position);
        if (Number.isFinite(numeric)) words.push({ word, position: numeric });
      });
    });
    return words.sort((a, b) => a.position - b.position).map(item => item.word).join(' ');
  }

  private tier(value: unknown): DailyPaperTier | null {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'must_read' || normalized === 'worth_reading' || normalized === 'skip'
      ? normalized
      : null;
  }

  private parseJson(value: string): Record<string, unknown> | null {
    const text = String(value || '').trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : text;
    const bounded = candidate.slice(candidate.indexOf('{'), candidate.lastIndexOf('}') + 1);
    for (const source of [candidate, bounded]) {
      try {
        const parsed = JSON.parse(source) as unknown;
        const record = this.record(parsed);
        if (record) return record;
      } catch {
        // Try the bounded JSON body.
      }
    }
    return null;
  }

  private record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

}
