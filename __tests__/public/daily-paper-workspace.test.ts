import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const publicSource = readPublicAppSource();
const indexSource = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf8');
const styleSource = readFileSync(
  path.resolve(__dirname, '../../src/public/styles/daily-paper-workspace.css'),
  'utf8',
);
const serverSource = readFileSync(path.resolve(__dirname, '../../src/server/local-server.ts'), 'utf8');
const literatureCollectionRouteSource = readFileSync(
  path.resolve(__dirname, '../../src/server/routes/literature-collection.ts'),
  'utf8',
);
const dailyPaperRouteSource = readFileSync(
  path.resolve(__dirname, '../../src/server/routes/daily-papers.ts'),
  'utf8',
);
const serviceSource = readFileSync(
  path.resolve(__dirname, '../../src/server/services/daily-paper-manager.ts'),
  'utf8',
);

describe('daily paper workspace', () => {
  it('places the provided diversity icon immediately after the top email entry', () => {
    const emailIndex = indexSource.indexOf('id="appEmailButton"');
    const dailyPaperIndex = indexSource.indexOf('id="appDailyPaperButton"');
    const navigationEnd = indexSource.indexOf('</nav>', emailIndex);
    expect(emailIndex).toBeGreaterThan(0);
    expect(dailyPaperIndex).toBeGreaterThan(emailIndex);
    expect(dailyPaperIndex).toBeLessThan(navigationEnd);
    expect(indexSource).toContain('viewBox="0 -960 960 960"');
    expect(indexSource).toContain('M350-63q-46 0-82.5-24T211-153');
  });

  it('keeps the status badge anchored to the daily paper menu button', () => {
    expect(styleSource).toMatch(/\.daily-paper-menu-button\s*\{[^}]*position:\s*relative\s*!important/s);
    expect(styleSource).toMatch(/\.daily-paper-menu-badge\s*\{[^}]*position:\s*absolute/s);
  });

  it('removes the tinted page backing and expands the main result bubble to the content boundary', () => {
    expect(styleSource).toMatch(/#homeUtilityPage\[data-page-id="daily-papers"\] \.home-utility-body\s*\{[^}]*background:\s*transparent/s);
    expect(styleSource).toMatch(/#homeUtilityPage\[data-page-id="daily-papers"\] \.home-utility-content\s*\{[^}]*width:\s*100%[^}]*padding:\s*0/s);
    expect(styleSource).toMatch(/\.daily-paper-workspace\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
    expect(styleSource).toMatch(/\.daily-paper-results-shell\s*\{[^}]*flex:\s*1 1 auto/s);
    expect(styleSource).not.toContain('radial-gradient(circle at 5% 2%');
  });

  it('supports configuration, automatic enablement, manual runs and one recommendation list', () => {
    expect(publicSource).toContain('function showDailyPaperWorkspace()');
    expect(publicSource).toContain('id="dailyPaperEnabled"');
    expect(publicSource).toContain('function toggleDailyPaperAutomation(enabled)');
    expect(publicSource).toContain("jsonFetch('/api/daily-papers/config'");
    expect(publicSource).toContain("jsonFetch('/api/daily-papers/run'");
    expect(publicSource).not.toContain('function tierMeta(tier)');
    expect(publicSource).toContain("filter(function(item) { return item.tier !== 'skip'; })");
    expect(publicSource).toContain('中文摘要');
    expect(publicSource).toContain('item.abstractZh');
    expect(publicSource).toContain('<div class="daily-paper-card-footer">');
    expect(publicSource).toContain('<div class="daily-paper-card-scroll">');
    expect(styleSource).toMatch(/\.daily-paper-card-footer\s*\{[^}]*justify-content:\s*space-between/s);
    expect(styleSource).toMatch(/\.daily-paper-card\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
    expect(styleSource).toMatch(/\.daily-paper-card\s*\{[^}]*height:\s*clamp\([^}]*overflow:\s*hidden/s);
    expect(styleSource).toMatch(/\.daily-paper-card-scroll\s*\{[^}]*overflow-y:\s*auto/s);
    expect(styleSource).toMatch(/\.daily-paper-card-footer\s*\{[^}]*margin-top:\s*0/s);
    expect(styleSource).toMatch(/\.daily-paper-feedback\s*\{[^}]*flex-wrap:\s*nowrap/s);
    expect(styleSource).toMatch(/\.daily-paper-card-links button\s*\{[^}]*font-size:\s*11px/s);
    expect(styleSource).toMatch(/\.daily-paper-feedback button\s*\{[^}]*font-size:\s*10\.5px/s);
    expect(styleSource).toMatch(/\.daily-paper-feedback \.daily-paper-library-button\s*\{[^}]*font-size:\s*10\.5px/s);
    expect(styleSource).toMatch(/\.daily-paper-results\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
    expect(publicSource).toContain('id="dailyPaperOverview"');
    expect(publicSource).toContain("esc(run.date) + ' · 推荐 ' + count + ' 篇</option>'");
    expect(publicSource).not.toContain("esc(run.summary || '论文推荐') + '</option>'");
    expect(publicSource).not.toContain('dailyPaperMarkdownDownload');
    expect(serviceSource).not.toContain('getRunMarkdown');
    expect(serviceSource).not.toContain('toMarkdown(run');
    expect(publicSource).toContain('术语解释');
    expect(publicSource).toContain('工作流参考');
    expect(publicSource).toContain('id="dailyPaperSourceOpenAlex"');
    expect(publicSource).toContain('id="dailyPaperSourceWos"');
    expect(publicSource).toContain('id="dailyPaperSourceEuropePmc"');
    expect(publicSource).toContain('id="dailyPaperSourceSemanticScholar"');
    expect(publicSource).not.toContain('<summary>高级筛选</summary>');
    expect(publicSource).not.toContain('id="dailyPaperExpandQueries"');
    expect(publicSource).not.toContain('id="dailyPaperMinScore"');
    expect(publicSource).not.toContain('id="dailyPaperArxivCategories"');
    expect(publicSource).toContain('申请 Clarivate API Key');
    expect(publicSource).toContain('https://developer.clarivate.com/apis/wos');
    expect(publicSource).not.toContain('Expanded 用于完整摘要与正式入库；Starter 只发现候选');
    expect(publicSource).not.toContain('<span class="daily-paper-step">01</span>');
    expect(publicSource).toContain('<div class="daily-paper-topic-grid">');
    expect(styleSource).toMatch(/\.daily-paper-topic-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
    expect(publicSource).toContain('<div class="daily-paper-wos-config-bubble">');
    expect(publicSource).not.toContain('daily-paper-wos-label-bubble');
    expect(publicSource).not.toContain('<details class="daily-paper-wos-config">');
    expect(publicSource).not.toContain('<summary>配置 Clarivate API</summary>');
    expect(styleSource).toMatch(/\.daily-paper-wos-row\s*\{[^}]*width:\s*100%/s);
    expect(styleSource).not.toContain('.daily-paper-wos-popover');
    const wosKeyIndex = publicSource.indexOf('id="dailyPaperWosApiKey"');
    const wosStatusIndex = publicSource.indexOf('id="dailyPaperWosStatus"');
    const wosActionsIndex = publicSource.indexOf('class="daily-paper-wos-actions"');
    expect(wosKeyIndex).toBeGreaterThan(0);
    expect(wosStatusIndex).toBeGreaterThan(wosKeyIndex);
    expect(wosStatusIndex).toBeLessThan(wosActionsIndex);
    expect(publicSource).toContain('<div class="daily-paper-wos-key-column"><label class="daily-paper-field">');
    expect(publicSource).toContain('</label><small class="daily-paper-wos-status" id="dailyPaperWosStatus">');
    expect(styleSource).toMatch(/\.daily-paper-wos-grid\s*\{[^}]*align-items:\s*start/s);
    expect(publicSource).not.toContain('id="dailyPaperTopN"');
    expect(publicSource).not.toContain('id="dailyPaperMustReadLimit"');
    expect(publicSource).not.toContain('<span>候选数量</span>');
    expect(publicSource).not.toContain('<span>必读上限</span>');
    expect(dailyPaperRouteSource).not.toContain('input.topN');
    expect(dailyPaperRouteSource).not.toContain('input.mustReadLimit');
    expect(publicSource).toContain("jsonFetch('/api/daily-papers/feedback'");
    expect(publicSource).toContain('function submitDailyPaperFeedback(paperId, decision)');
    expect(publicSource).toContain("var libraryActions = dailyPaperLibraryButton(item);");
    expect(publicSource).toContain("partial ? '继续入库' : '入库'");
    expect(publicSource).toContain('function addDailyPaperToLibraries(paperId)');
    expect(publicSource).toContain("jsonFetch('/api/projects')");
    expect(publicSource).toContain("showModal('选择入库项目'");
    expect(publicSource).toContain('id="dailyPaperLibraryProject"');
    expect(publicSource).toContain('function confirmDailyPaperLibraryProject(paperId)');
    expect(publicSource).toContain('function importDailyPaperLibraries(paperId, projectId, projectName)');
    expect(publicSource).toContain("var targets = ['pdf', 'embedding'].filter");
    expect(publicSource).toContain('target: target, projectId: projectId');
    expect(dailyPaperRouteSource).toContain("'DAILY_PAPER_PROJECT_REQUIRED'");
    expect(dailyPaperRouteSource).toContain('options.runInProject(projectId');
    expect(serviceSource).toContain('projectName: string;');
    expect(publicSource).not.toContain("dailyPaperLibraryButton(item, 'pdf'");
    expect(publicSource).not.toContain("dailyPaperLibraryButton(item, 'embedding'");
    expect(publicSource).toContain("jsonFetch('/api/daily-papers/library'");
    const feedbackStart = publicSource.indexOf('var feedback = \'<div class="daily-paper-feedback"');
    const libraryButtons = publicSource.indexOf('libraryActions +', feedbackStart);
    const interestedButton = publicSource.indexOf('data-decision="interested"', feedbackStart);
    expect(feedbackStart).toBeGreaterThan(0);
    expect(libraryButtons).toBeGreaterThan(feedbackStart);
    expect(libraryButtons).toBeLessThan(interestedButton);
    expect(publicSource).not.toContain('data-decision="later"');
    expect(publicSource).toContain('推荐论文 · 相关性第 ');
    expect(publicSource).toContain('.slice(0, 4);');
    expect(serverSource).toContain('addToPdfLibrary: addDailyPaperToPdfLibrary');
    expect(serverSource).toContain('addToEmbeddingLibrary: addDailyPaperToEmbeddingLibrary');
    expect(serverSource).toContain('downloadPaperPdfForLibrary');
    expect(serviceSource).toContain('async saveLibraryState(');
    expect(serviceSource).toContain('.sort((left, right) => right.score - left.score');
    expect(serviceSource).toContain('.slice(0, 4)');
    expect(serviceSource).toContain('正在精读高相关论文');
    expect(publicSource).toContain('function saveDailyPaperWosConfig()');
    expect(publicSource).toContain("jsonFetch('/api/literature-collection/config/test'");
    expect(publicSource).not.toContain('function importDailyPaperWosFiles()');
    expect(publicSource).not.toContain("jsonFetch('/api/literature-collection/import-wos'");
    expect(publicSource).not.toContain('导入 Full Record TXT');
    expect(literatureCollectionRouteSource).not.toContain("router.post('/import-wos'");
  });

  it('places research radar immediately before the daily automation controls', () => {
    expect(publicSource).not.toContain('DAILY RESEARCH RADAR');
    expect(publicSource).not.toContain('把最新论文变成今天能读完的清单');
    expect(publicSource).not.toContain('最新研究筛选、分档与精读');
    expect(publicSource).toContain("wrapper.className = 'daily-paper-header-automation'");
    expect(publicSource).toContain('class="daily-paper-header-time" type="time" id="dailyPaperRunTime"');
    expect(publicSource).toContain('onchange="saveDailyPaperRunTime(this.value)"');
    expect(publicSource).toContain('function saveDailyPaperRunTime(value)');
    expect(publicSource).toContain("status.className = 'daily-paper-header-status'");
    expect(publicSource).toContain("radarButton.textContent = '研究雷达'");
    expect(publicSource).toContain("radarButton.className = 'daily-paper-header-radar'");
    expect(publicSource).not.toContain("radarButton.className = 'lit-btn daily-paper-header-radar'");
    expect(publicSource).toContain('header.insertBefore(status, closeButton)');
    expect(publicSource).toContain('header.insertBefore(radarButton, closeButton)');
    expect(publicSource).toContain('header.insertBefore(history, closeButton)');
    expect(publicSource).toContain('header.insertBefore(wrapper, closeButton)');
    expect(publicSource.indexOf('header.insertBefore(radarButton, closeButton)'))
      .toBeLessThan(publicSource.indexOf('header.insertBefore(wrapper, closeButton)'));
    expect(publicSource.indexOf('header.insertBefore(wrapper, closeButton)'))
      .toBeLessThan(publicSource.indexOf('header.insertBefore(status, closeButton)'));
    expect(publicSource.indexOf('header.insertBefore(status, closeButton)'))
      .toBeLessThan(publicSource.indexOf('header.insertBefore(history, closeButton)'));
    expect(publicSource).not.toContain('daily-paper-panel daily-paper-status-panel');
    expect(publicSource).toContain('id="dailyPaperEnabled"');
    expect(publicSource).toContain('function toggleDailyPaperResearchRadar()');
    expect(styleSource).toMatch(/#homeUtilityPage\[data-page-id="daily-papers"\] \.home-utility-heading\s*\{[^}]*flex:\s*0 0 220px/s);
    expect(styleSource).toMatch(/\.daily-paper-header-status\s*\{[^}]*flex:\s*0 0 290px/s);
    expect(styleSource).toMatch(/\.daily-paper-header-radar\s*\{[^}]*width:\s*auto\s*!important[^}]*margin-left:\s*auto/s);
    expect(styleSource).toMatch(/\.daily-paper-header-automation\s*\{[^}]*margin-left:\s*0/s);
    expect(styleSource).toMatch(/\.daily-paper-header-time\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
    expect(styleSource).not.toMatch(/\.daily-paper-header-automation\s*\{[^}]*margin-left:\s*auto/s);
    expect(styleSource).toMatch(/\.daily-paper-header-history select\s*\{[^}]*width:\s*190px/s);
    expect(styleSource).toMatch(/#homeUtilityPage\[data-page-id="daily-papers"\] \.home-utility-back\s*\{[^}]*border:\s*1px[^}]*!important/s);
    expect(publicSource).not.toContain('<span class="daily-paper-step">02</span><h2>推荐论文</h2>');
  });

  it('persists per-user read state and only shows completed or failed notifications while unread', () => {
    expect(publicSource).toContain("var DAILY_PAPER_READ_STATE_KEY = 'scholarharness_daily_paper_read_state:'");
    expect(publicSource).toContain('function notificationIdFor(status, latest)');
    expect(publicSource).toContain("'completed:' + String(latest.id || latest.completedAt || latest.date || 'unknown')");
    expect(publicSource).toContain('if (workspaceOpen && notificationId) setReadNotificationId(notificationId)');
    expect(publicSource).toContain('var unread = !!notificationId && notificationId !== getReadNotificationId()');
    expect(publicSource).toContain('var visible = !!(status && (status.running || unread))');
    expect(publicSource).toContain('updateMenuBadge(state.status);');
  });

  it('registers a persistent server scheduler and the official source pipeline', () => {
    expect(serverSource).toContain('createDailyPapersRouter(dailyPaperManager, {');
    expect(serverSource).toContain('dailyPaperManager.startScheduler()');
    expect(serverSource).toContain('dailyPaperManager.stopScheduler()');
    expect(serviceSource).toContain('https://huggingface.co/api/daily_papers');
    expect(serviceSource).toContain('https://export.arxiv.org/api/query');
    expect(serviceSource).toContain('https://api.openalex.org/works');
    expect(serviceSource).toContain('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
    expect(serviceSource).toContain('https://api.semanticscholar.org/recommendations/v1/papers/');
    expect(serviceSource).toContain('loadUserLiterature');
    expect(serviceSource).toContain('https://arxiv.org/html/');
    expect(serviceSource).toContain('huangkiki/dailypaper-skills');
    expect(serviceSource).toContain("license: 'Apache-2.0'");
    expect(serviceSource).toContain("if (!settings.enabled || !settings.researchFields.length) return null");
    expect(serviceSource).toContain("if ((await this.getRun(userId, today))?.status === 'completed') return null");
    expect(serviceSource).toContain('this.attemptPath(userId, today)');
  });
});
