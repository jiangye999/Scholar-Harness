(function() {
  'use strict';

  var DAILY_PAPER_READ_STATE_KEY = 'scholarharness_daily_paper_read_state:';

  var state = {
    config: null,
    latest: null,
    status: null,
    wosConfig: null,
    runs: [],
    selectedDate: '',
    polling: false,
    pollTimer: null,
    libraryActions: {},
    projects: [],
    currentProjectId: ''
  };

  function userId() {
    return typeof currentUserId !== 'undefined' && currentUserId ? currentUserId : 'web-user';
  }

  function readStateStorageKey() {
    return DAILY_PAPER_READ_STATE_KEY + encodeURIComponent(userId());
  }

  function getReadNotificationId() {
    try {
      return String(window.localStorage.getItem(readStateStorageKey()) || '');
    } catch (_) {
      return '';
    }
  }

  function setReadNotificationId(notificationId) {
    if (!notificationId) return;
    try {
      window.localStorage.setItem(readStateStorageKey(), notificationId);
    } catch (_) {}
  }

  function notificationIdFor(status, latest) {
    if (!status || status.running) return '';
    if (status.stage === 'failed') {
      return 'failed:' + String(status.startedAt || status.error || status.message || 'unknown');
    }
    if (status.stage !== 'completed' || !latest) return '';
    return 'completed:' + String(latest.id || latest.completedAt || latest.date || 'unknown');
  }

  function isDailyPaperWorkspaceOpen() {
    return !!document.querySelector('#homeUtilityPage[data-page-id="daily-papers"]:not([hidden])');
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function listText(value) {
    return Array.isArray(value) ? value.join('\n') : '';
  }

  function splitList(value) {
    return Array.from(new Set(String(value || '').split(/[\n,，;；]+/)
      .map(function(item) { return item.trim(); }).filter(Boolean)));
  }

  async function jsonFetch(url, options) {
    var response = await fetch(url, options || {});
    var data = await response.json().catch(function() { return {}; });
    if (!response.ok || data.success === false) {
      var error = data && data.error;
      throw new Error(error && error.message
        ? error.message
        : (typeof error === 'string' && error ? error : (data.message || ('请求失败（HTTP ' + response.status + '）'))));
    }
    return data;
  }

  function workspaceMarkup() {
    return '<div class="daily-paper-workspace" id="dailyPaperWorkspace">' +
      '<section class="daily-paper-control-grid">' +
        '<div class="daily-paper-panel daily-paper-settings-panel" id="dailyPaperResearchRadar" hidden>' +
          '<div class="daily-paper-panel-heading"><div><h2>研究雷达</h2></div><div class="daily-paper-panel-actions"><button type="button" class="daily-paper-run-button compact" id="dailyPaperRunButton" onclick="runDailyPaperNow()"><span class="daily-paper-run-icon">↗</span><span>今日论文推荐</span></button><button type="button" class="daily-paper-save-button" onclick="saveDailyPaperSettings(false)">保存设置</button></div></div>' +
          '<div class="daily-paper-topic-grid">' +
            '<label class="daily-paper-field"><span>研究领域与关键词</span><small>每行一个，中英文均可；英文关键词能提高本地预筛准确率</small><textarea id="dailyPaperResearchFields" rows="4" placeholder="例如：&#10;soil carbon sequestration&#10;microbial necromass&#10;土壤有机碳"></textarea></label>' +
            '<label class="daily-paper-field"><span>排除方向</span><small>明确不希望出现的主题</small><textarea id="dailyPaperNegativeKeywords" rows="4" placeholder="例如：medical imaging, speech synthesis"></textarea></label>' +
          '</div>' +
          '<div class="daily-paper-wos-row">' +
            '<div class="daily-paper-wos-config-bubble">' +
              '<div class="daily-paper-wos-grid">' +
                '<label class="daily-paper-field"><span>API 类型</span><select id="dailyPaperWosMode"><option value="expanded">Expanded（推荐，完整摘要）</option><option value="starter">Starter（仅候选发现）</option></select></label>' +
                '<div class="daily-paper-wos-key-column"><label class="daily-paper-field"><span>Clarivate API Key</span><input id="dailyPaperWosApiKey" type="password" autocomplete="off" placeholder="已保存时可留空"></label><small class="daily-paper-wos-status" id="dailyPaperWosStatus">正在读取 WoS 配置…</small></div>' +
              '</div>' +
              '<div class="daily-paper-wos-actions"><button type="button" class="daily-paper-save-button" onclick="saveDailyPaperWosConfig()">保存 WoS 配置</button><button type="button" class="daily-paper-save-button" onclick="testDailyPaperWosConnection()">检测连接</button><button type="button" class="daily-paper-save-button" onclick="openExternalUrl(\'https://developer.clarivate.com/apis/wos\')">申请 Clarivate API Key</button></div>' +
            '</div>' +
          '</div>' +
          '<div class="daily-paper-source-row"><span>论文来源</span>' +
            '<label><input id="dailyPaperSourceWos" type="checkbox"> Web of Science</label>' +
            '<label><input id="dailyPaperSourceHfDaily" type="checkbox" checked> HF Daily</label>' +
            '<label><input id="dailyPaperSourceHfTrending" type="checkbox" checked> HF Trending</label>' +
            '<label><input id="dailyPaperSourceArxiv" type="checkbox" checked> arXiv</label>' +
            '<label><input id="dailyPaperSourceOpenAlex" type="checkbox" checked> OpenAlex</label>' +
            '<label><input id="dailyPaperSourceEuropePmc" type="checkbox" checked> Europe PMC</label>' +
            '<label><input id="dailyPaperSourceSemanticScholar" type="checkbox" checked> Semantic Scholar</label>' +
          '</div>' +
          '<div class="daily-paper-inline-status" id="dailyPaperSettingsStatus" aria-live="polite"></div>' +
          '<p class="daily-paper-attribution">工作流参考 <button type="button" onclick="openExternalUrl(\'https://github.com/huangkiki/dailypaper-skills\')">huangkiki/dailypaper-skills</button>（Apache-2.0）。AI 推荐需回到原文核验。</p>' +
        '</div>' +
      '</section>' +
      '<section class="daily-paper-results-shell">' +
        '<div id="dailyPaperOverview" class="daily-paper-overview" hidden><p id="dailyPaperResultSummary"></p><div id="dailyPaperTrend" class="daily-paper-trend" hidden></div></div>' +
        '<div id="dailyPaperResults" class="daily-paper-results"><div class="daily-paper-empty">今日推荐生成后，会在这里显示推荐论文和精读笔记。</div></div>' +
      '</section>' +
    '</div>';
  }

  function readFormConfig() {
    return {
      enabled: !!document.getElementById('dailyPaperEnabled')?.checked,
      researchFields: splitList(document.getElementById('dailyPaperResearchFields')?.value),
      negativeKeywords: splitList(document.getElementById('dailyPaperNegativeKeywords')?.value),
      runTime: String(document.getElementById('dailyPaperRunTime')?.value || '08:00'),
      sources: {
        wos: !!document.getElementById('dailyPaperSourceWos')?.checked,
        hfDaily: !!document.getElementById('dailyPaperSourceHfDaily')?.checked,
        hfTrending: !!document.getElementById('dailyPaperSourceHfTrending')?.checked,
        arxiv: !!document.getElementById('dailyPaperSourceArxiv')?.checked,
        openAlex: !!document.getElementById('dailyPaperSourceOpenAlex')?.checked,
        europePmc: !!document.getElementById('dailyPaperSourceEuropePmc')?.checked,
        semanticScholar: !!document.getElementById('dailyPaperSourceSemanticScholar')?.checked
      }
    };
  }

  function populateConfig(config) {
    state.config = config || {};
    var setValue = function(id, value) {
      var element = document.getElementById(id);
      if (element) element.value = value;
    };
    var enabled = document.getElementById('dailyPaperEnabled');
    if (enabled) enabled.checked = config.enabled === true;
    setValue('dailyPaperResearchFields', listText(config.researchFields));
    setValue('dailyPaperNegativeKeywords', listText(config.negativeKeywords));
    setValue('dailyPaperRunTime', config.runTime || '08:00');
    var sources = config.sources || {};
    var sourceMap = {
      dailyPaperSourceWos: sources.wos === true,
      dailyPaperSourceHfDaily: sources.hfDaily !== false,
      dailyPaperSourceHfTrending: sources.hfTrending !== false,
      dailyPaperSourceArxiv: sources.arxiv !== false,
      dailyPaperSourceOpenAlex: sources.openAlex !== false,
      dailyPaperSourceEuropePmc: sources.europePmc !== false,
      dailyPaperSourceSemanticScholar: sources.semanticScholar !== false
    };
    Object.keys(sourceMap).forEach(function(id) {
      var input = document.getElementById(id);
      if (input) input.checked = sourceMap[id];
    });
    updateAutomationHint();
  }

  function updateAutomationHint() {
    var hint = document.getElementById('dailyPaperAutomationHint');
    var enabled = document.getElementById('dailyPaperEnabled');
    if (!hint) return;
    hint.textContent = enabled && enabled.checked
      ? '已开启 · 启动时会补跑'
      : '软件运行时每天自动执行一次';
  }

  async function saveDailyPaperRunTime(value) {
    var input = document.getElementById('dailyPaperRunTime');
    var previous = state.config && /^\d{2}:\d{2}$/.test(String(state.config.runTime || ''))
      ? state.config.runTime
      : '08:00';
    var runTime = /^\d{2}:\d{2}$/.test(String(value || '')) ? String(value) : previous;
    if (input) input.value = runTime;
    try {
      var data = await jsonFetch('/api/daily-papers/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId(), config: { runTime: runTime } })
      });
      populateConfig(data.config || {});
    } catch (error) {
      if (input) input.value = previous;
      var hint = document.getElementById('dailyPaperAutomationHint');
      if (hint) hint.textContent = '时间保存失败：' + error.message;
    }
  }

  function setSettingsStatus(message, error) {
    var host = document.getElementById('dailyPaperSettingsStatus');
    if (!host) return;
    host.textContent = String(message || '');
    host.classList.toggle('error', error === true);
  }

  function setWosStatus(message, error) {
    var host = document.getElementById('dailyPaperWosStatus');
    if (!host) return;
    host.textContent = String(message || '');
    host.classList.toggle('error', error === true);
  }

  function renderWosConfig(config) {
    state.wosConfig = config || {};
    var mode = document.getElementById('dailyPaperWosMode');
    if (mode) mode.value = config && config.wosMode === 'starter' ? 'starter' : 'expanded';
    setWosStatus(config && config.hasWosApiKey
      ? 'API Key 已在本地加密保存 · 当前模式：' + (config.wosMode === 'starter' ? 'Starter 候选发现' : 'Expanded 完整摘要')
      : '尚未配置 WoS API Key。', false);
  }

  async function refreshDailyPaperWosConfig() {
    try {
      var data = await jsonFetch('/api/literature-collection/config?userId=' + encodeURIComponent(userId()));
      renderWosConfig(data.config || {});
    } catch (error) {
      setWosStatus('读取 WoS 配置失败：' + error.message, true);
    }
  }

  async function saveDailyPaperWosConfig() {
    var key = document.getElementById('dailyPaperWosApiKey');
    var mode = document.getElementById('dailyPaperWosMode');
    setWosStatus('正在保存 WoS 配置…', false);
    try {
      var data = await jsonFetch('/api/literature-collection/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId(),
          wosApiKey: key ? key.value : '',
          keepWosApiKey: true,
          wosMode: mode && mode.value === 'starter' ? 'starter' : 'expanded'
        })
      });
      if (key) key.value = '';
      renderWosConfig(data.config || {});
      var source = document.getElementById('dailyPaperSourceWos');
      if (source && data.config && data.config.hasWosApiKey) source.checked = true;
    } catch (error) {
      setWosStatus('保存失败：' + error.message, true);
    }
  }

  async function testDailyPaperWosConnection() {
    setWosStatus('正在连接 Clarivate 官方 API…', false);
    try {
      var data = await jsonFetch('/api/literature-collection/config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId() })
      });
      var result = data.result || {};
      setWosStatus((result.message || '连接正常') + (result.sampleTitle ? ' 示例：' + result.sampleTitle : ''), false);
    } catch (error) {
      setWosStatus('检测失败：' + error.message, true);
    }
  }

  async function saveDailyPaperSettings(silent) {
    var config = readFormConfig();
    if (config.enabled && !config.researchFields.length) {
      setDailyPaperResearchRadarOpen(true);
      var enabled = document.getElementById('dailyPaperEnabled');
      if (enabled) enabled.checked = false;
      setSettingsStatus('开启自动总结前，请先填写至少一个研究领域。', true);
      return null;
    }
    if (!Object.keys(config.sources).some(function(key) { return config.sources[key]; })) {
      setSettingsStatus('请至少选择一个论文来源。', true);
      return null;
    }
    if (config.sources.wos && !(state.wosConfig && state.wosConfig.hasWosApiKey)) {
      var hasAlternativeSource = Object.keys(config.sources).some(function(key) {
        return key !== 'wos' && config.sources[key];
      });
      setWosStatus('Web of Science 已勾选，但尚未保存 API Key。' + (hasAlternativeSource ? '本次会继续使用其他来源。' : '请先保存 API Key 或选择其他来源。'), true);
      if (!hasAlternativeSource) return null;
    }
    if (!silent) setSettingsStatus('正在保存…', false);
    try {
      var data = await jsonFetch('/api/daily-papers/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId(), config: config })
      });
      populateConfig(data.config);
      setSettingsStatus(data.config.enabled ? '已保存并开启每日自动总结。' : '设置已保存；自动总结当前关闭。', false);
      refreshDailyPaperStatus(true);
      return data.config;
    } catch (error) {
      setSettingsStatus('保存失败：' + error.message, true);
      return null;
    }
  }

  async function toggleDailyPaperAutomation(enabled) {
    updateAutomationHint();
    var saved = await saveDailyPaperSettings(true);
    if (!saved) return;
    setSettingsStatus(enabled ? '自动总结已开启；若今天尚未生成，后台会立即补跑。' : '自动总结已关闭。', false);
    if (enabled) startPolling();
  }

  async function runDailyPaperNow() {
    var config = readFormConfig();
    if (!config.researchFields.length) {
      setSettingsStatus('请先填写研究领域，再运行今日论文推荐。', true);
      document.getElementById('dailyPaperResearchFields')?.focus();
      return;
    }
    var saved = await saveDailyPaperSettings(true);
    if (!saved) return;
    var button = document.getElementById('dailyPaperRunButton');
    if (button) button.disabled = true;
    try {
      await jsonFetch('/api/daily-papers/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId(), days: 1, force: true })
      });
      setSettingsStatus('任务已进入后台。可以返回聊天，软件保持运行即可。', false);
      startPolling();
      setTimeout(function() { refreshDailyPaperStatus(true); }, 400);
    } catch (error) {
      if (button) button.disabled = false;
      setSettingsStatus('启动失败：' + error.message, true);
    }
  }

  function renderStatus(status) {
    status = status || {};
    state.status = status;
    var pill = document.getElementById('dailyPaperStatePill');
    var title = document.getElementById('dailyPaperStageTitle');
    var message = document.getElementById('dailyPaperStageMessage');
    var glyph = document.getElementById('dailyPaperStageGlyph');
    var button = document.getElementById('dailyPaperRunButton');
    if (pill) {
      pill.textContent = status.running ? '运行中' : status.stage === 'failed' ? '需要处理' : status.stage === 'completed' ? '今日已完成' : '等待运行';
      pill.dataset.state = status.running ? 'running' : status.stage || 'idle';
    }
    if (title) title.textContent = status.running ? '每日论文流水线正在后台运行' : status.stage === 'failed' ? '本次运行失败' : status.stage === 'completed' ? '今日推荐已经准备好' : '尚未生成今日推荐';
    if (message) message.textContent = status.message || '设置研究领域后，可以手动运行或开启每日自动总结。';
    if (glyph) glyph.textContent = status.running ? '…' : status.stage === 'failed' ? '!' : '✓';
    if (button) button.disabled = status.running === true;
    updateMenuBadge(status);
  }

  function paperCard(item, index) {
    var sources = (item.sources || []).map(function(source) {
      return '<span class="daily-paper-source-tag">' + esc(source) + '</span>';
    }).join('');
    var note = item.note ? '<details class="daily-paper-note" open>' +
      '<summary><span>精读笔记</span><small>' + (item.note.evidenceLevel === 'full-text' ? '基于可用全文' : '摘要级回退') + '</small></summary>' +
      '<div class="daily-paper-note-body">' +
        '<p class="daily-paper-note-overview">' + esc(item.note.overview || '') + '</p>' +
        noteSection('研究问题', item.note.problem) +
        noteSection('方法路线', item.note.method) +
        noteSection('实验与证据', item.note.experiments) +
        noteSection('局限与核验点', item.note.limitations) +
        ((item.note.takeaways || []).length ? '<div class="daily-paper-note-section"><h4>带走的结论</h4><ul>' + item.note.takeaways.map(function(value) { return '<li>' + esc(value) + '</li>'; }).join('') + '</ul></div>' : '') +
        ((item.note.terms || []).length ? '<div class="daily-paper-terms"><h4>术语解释</h4>' + item.note.terms.map(function(term) { return '<div><strong>' + esc(term.name) + '</strong><p>' + esc(term.explanation) + '</p></div>'; }).join('') + '</div>' : '') +
      '</div></details>' : '';
    var paperId = esc(item.id || '');
    var libraryActions = dailyPaperLibraryButton(item);
    var feedback = '<div class="daily-paper-feedback" aria-label="论文反馈">' +
      libraryActions +
      '<button type="button" data-paper-id="' + paperId + '" data-decision="interested" class="' + (item.feedback === 'interested' ? 'active' : '') + '" onclick="submitDailyPaperFeedback(this.dataset.paperId, this.dataset.decision)">感兴趣</button>' +
      '<button type="button" data-paper-id="' + paperId + '" data-decision="not_relevant" class="' + (item.feedback === 'not_relevant' ? 'active negative' : '') + '" onclick="submitDailyPaperFeedback(this.dataset.paperId, this.dataset.decision)">不相关</button>' +
    '</div>';
    var relevanceRank = Number(item.relevanceRank || index + 1);
    var links = '<div class="daily-paper-card-links">' +
      (item.url ? '<button type="button" onclick="openExternalUrl(\'' + esc(item.url) + '\')">论文页面</button>' : '') +
      (item.pdfUrl ? '<button type="button" onclick="openExternalUrl(\'' + esc(item.pdfUrl) + '\')">PDF</button>' : '') +
    '</div>';
    return '<article class="daily-paper-card recommended">' +
      '<div class="daily-paper-card-scroll">' +
      '<div class="daily-paper-card-kicker"><span>推荐论文 · 相关性第 ' + relevanceRank + '</span><span>' + esc(item.publishedAt || '') + '</span></div>' +
      '<h3>' + esc(item.title) + '</h3>' +
      '<p class="daily-paper-authors">' + esc((item.authors || []).join(', ') || '作者信息未提供') + '</p>' +
      '<div class="daily-paper-source-tags">' + sources + (item.hfUpvotes ? '<span class="daily-paper-source-tag">↑ ' + Number(item.hfUpvotes) + '</span>' : '') + '</div>' +
      '<div class="daily-paper-abstract"><strong>中文摘要</strong><p>' + esc(item.abstractZh || '中文摘要暂未生成，请通过论文页面核验原文摘要。') + '</p></div>' +
      '<div class="daily-paper-judgement"><strong>推荐理由</strong><p>' + esc(item.reason || '') + '</p></div>' +
      (item.relevance ? '<p class="daily-paper-relevance"><strong>与你的方向：</strong>' + esc(item.relevance) + '</p>' : '') +
      (item.caution ? '<p class="daily-paper-caution"><strong>核验提醒：</strong>' + esc(item.caution) + '</p>' : '') +
      note +
      '</div>' +
      '<div class="daily-paper-card-footer">' + links + feedback + '</div>' +
    '</article>';
  }

  function dailyPaperLibraryButton(item) {
    var paperId = String(item.id || '');
    var loading = state.libraryActions[paperId] === true;
    var pdfState = item.library && item.library.pdf;
    var embeddingState = item.library && item.library.embedding;
    var complete = !!pdfState && !!embeddingState;
    var partial = !complete && (!!pdfState || !!embeddingState);
    var label = loading ? '正在入库…' : complete ? '已入库' : partial ? '继续入库' : '入库';
    var messages = [pdfState && pdfState.message, embeddingState && embeddingState.message].filter(Boolean);
    var projectNames = [pdfState && pdfState.projectName, embeddingState && embeddingState.projectName].filter(Boolean);
    var title = messages.join('；') || '选择现有项目，同时纳入 PDF 文献库和 Embedding 文献库';
    if (projectNames.length) title += '（项目：' + Array.from(new Set(projectNames)).join('、') + '）';
    return '<button type="button" class="daily-paper-library-button ' + (complete ? 'included' : partial ? 'partial' : '') + '" ' +
      'data-paper-id="' + esc(paperId) + '" onclick="addDailyPaperToLibraries(this.dataset.paperId)" ' +
      ((loading || complete) ? 'disabled ' : '') +
      'title="' + esc(title) + '">' +
      '<span aria-hidden="true">' + (complete ? '✓' : '+') + '</span>' + label + '</button>';
  }

  async function addDailyPaperToLibraries(paperId) {
    if (!paperId || !state.latest || state.libraryActions[paperId]) return;
    var paper = (state.latest.recommendations || []).find(function(item) { return item.id === paperId; });
    if (!paper) return;
    try {
      var data = await jsonFetch('/api/projects');
      state.projects = Array.isArray(data.projects) ? data.projects : [];
      state.currentProjectId = String(data.currentProject && data.currentProject.projectId || '');
      if (!state.projects.length) {
        setSettingsStatus('当前没有可选项目，请先在项目管理中创建项目。', true);
        return;
      }
      var library = paper.library || {};
      var existingProjectId = String(
        (library.pdf && library.pdf.projectId) || (library.embedding && library.embedding.projectId) || ''
      );
      var preferredProjectId = existingProjectId || state.currentProjectId || String(state.projects[0].projectId || '');
      var options = state.projects.map(function(project) {
        var projectId = String(project.projectId || '');
        var disabled = existingProjectId && projectId !== existingProjectId;
        var suffix = projectId === state.currentProjectId ? '（当前项目）' : '';
        return '<option value="' + esc(projectId) + '" ' +
          (projectId === preferredProjectId ? 'selected ' : '') + (disabled ? 'disabled ' : '') + '>' +
          esc(String(project.name || projectId) + suffix) + '</option>';
      }).join('');
      var continuation = existingProjectId
        ? '<p class="daily-paper-project-picker-note">该论文已部分进入一个项目，本次将继续写入同一项目，避免两个文献库分散到不同项目。</p>'
        : '<p class="daily-paper-project-picker-note">PDF 原文与 Embedding 索引会同时写入所选项目；当前打开的项目不会被切换。</p>';
      showModal('选择入库项目',
        '<div class="daily-paper-project-picker">' + continuation +
          '<label for="dailyPaperLibraryProject">现有项目</label>' +
          '<select id="dailyPaperLibraryProject">' + options + '</select>' +
        '</div>' +
        '<div class="btns daily-paper-project-picker-actions">' +
          '<button type="button" class="cancel" onclick="closeModal()">取消</button>' +
          '<button type="button" class="ok" data-paper-id="' + esc(paperId) + '" onclick="confirmDailyPaperLibraryProject(this.dataset.paperId)">确认入库</button>' +
        '</div>', false, false);
    } catch (error) {
      setSettingsStatus('读取项目列表失败：' + error.message, true);
    }
  }

  async function confirmDailyPaperLibraryProject(paperId) {
    var select = document.getElementById('dailyPaperLibraryProject');
    var projectId = String(select && select.value || '').trim();
    if (!projectId) {
      setSettingsStatus('请先选择要入库的项目。', true);
      return;
    }
    var selectedOption = select && select.options ? select.options[select.selectedIndex] : null;
    var projectName = selectedOption ? String(selectedOption.textContent || '').replace(/（当前项目）$/, '') : '';
    closeModal();
    await importDailyPaperLibraries(paperId, projectId, projectName);
  }

  async function importDailyPaperLibraries(paperId, projectId, projectName) {
    if (!paperId || !projectId || !state.latest || state.libraryActions[paperId]) return;
    var paper = (state.latest.recommendations || []).find(function(item) { return item.id === paperId; });
    if (!paper) return;
    paper.library = paper.library || {};
    var targets = ['pdf', 'embedding'].filter(function(target) { return !paper.library[target]; });
    if (!targets.length) return;
    state.libraryActions[paperId] = true;
    renderRun(state.latest);
    var succeeded = [];
    var failed = [];
    try {
      for (var index = 0; index < targets.length; index += 1) {
        var target = targets[index];
        try {
          var data = await jsonFetch('/api/daily-papers/library', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId(), paperId: paperId, target: target, projectId: projectId })
          });
          if (data.project && data.project.name) projectName = String(data.project.name);
          var updateRun = function(run) {
            (run && run.recommendations || []).forEach(function(item) {
              if (item.id !== paperId) return;
              item.library = item.library || {};
              item.library[target] = data.libraryState;
            });
          };
          updateRun(state.latest);
          (state.runs || []).forEach(updateRun);
          succeeded.push(target === 'pdf' ? 'PDF 文献库' : 'Embedding 文献库');
        } catch (error) {
          failed.push((target === 'pdf' ? 'PDF 文献库：' : 'Embedding 文献库：') + error.message);
        }
      }
      if (failed.length) {
        setSettingsStatus((succeeded.length ? succeeded.join('、') + '已成功；' : '') + failed.join('；'), true);
      } else {
        setSettingsStatus('论文已提交至“' + (projectName || projectId) + '”的 PDF 文献库和 Embedding 文献库。', false);
      }
    } finally {
      delete state.libraryActions[paperId];
      renderRun(state.latest);
    }
  }

  async function submitDailyPaperFeedback(paperId, decision) {
    if (!paperId || !state.latest) return;
    try {
      var data = await jsonFetch('/api/daily-papers/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId(), paperId: paperId, decision: decision })
      });
      (state.latest.recommendations || []).forEach(function(item) {
        if (item.id === paperId) item.feedback = data.feedback.decision;
      });
      renderRun(state.latest);
      setSettingsStatus('反馈已保存，后续推荐会据此调整研究画像。', false);
    } catch (error) {
      setSettingsStatus('反馈保存失败：' + error.message, true);
    }
  }

  function noteSection(title, value) {
    return value ? '<div class="daily-paper-note-section"><h4>' + esc(title) + '</h4><p>' + esc(value) + '</p></div>' : '';
  }

  function renderRun(run) {
    state.latest = run || null;
    var results = document.getElementById('dailyPaperResults');
    var overview = document.getElementById('dailyPaperOverview');
    var summary = document.getElementById('dailyPaperResultSummary');
    var trend = document.getElementById('dailyPaperTrend');
    if (!results) return;
    if (!run) {
      results.innerHTML = '<div class="daily-paper-empty">今日推荐生成后，会在这里显示推荐论文和精读笔记。</div>';
      if (overview) overview.hidden = true;
      if (trend) trend.hidden = true;
      return;
    }
    var items = (run.recommendations || [])
      .filter(function(item) { return item.tier !== 'skip'; })
      .slice()
      .sort(function(left, right) {
        return Number(left.relevanceRank || 999) - Number(right.relevanceRank || 999)
          || Number(right.score || 0) - Number(left.score || 0);
      })
      .slice(0, 4);
    if (overview) overview.hidden = false;
    if (summary) summary.textContent = run.summary + ' · 推荐 ' + items.length + ' 篇';
    if (trend) {
      trend.hidden = !run.trend;
      trend.innerHTML = '<span>趋势</span><p>' + esc(run.trend || '') + '</p>';
    }
    results.innerHTML = items.length
      ? items.map(paperCard).join('')
      : '<div class="daily-paper-empty compact">今天没有达到推荐标准的论文</div>';
  }

  function renderHistory(runs, selectedDate) {
    state.runs = Array.isArray(runs) ? runs : [];
    var select = document.getElementById('dailyPaperRunHistory');
    if (!select) return;
    select.innerHTML = state.runs.length
      ? state.runs.map(function(run) {
          var count = (run.recommendations || []).filter(function(item) { return item.tier !== 'skip'; }).slice(0, 4).length;
          return '<option value="' + esc(run.date) + '"' + (run.date === selectedDate ? ' selected' : '') + '>' + esc(run.date) + ' · 推荐 ' + count + ' 篇</option>';
        }).join('')
      : '<option value="">暂无历史</option>';
  }

  async function selectDailyPaperRun(date) {
    if (!date) return;
    try {
      var data = await jsonFetch('/api/daily-papers/runs/' + encodeURIComponent(date) + '?userId=' + encodeURIComponent(userId()));
      state.selectedDate = date;
      renderRun(data.run);
      renderHistory(state.runs, date);
    } catch (error) {
      setSettingsStatus('读取历史推荐失败：' + error.message, true);
    }
  }

  async function refreshDailyPaperStatus(loadRuns) {
    if (state.polling) return;
    state.polling = true;
    try {
      var data = await jsonFetch('/api/daily-papers/status?userId=' + encodeURIComponent(userId()));
      state.config = data.config;
      state.latest = data.latest;
      renderStatus(data.status);
      if (document.getElementById('dailyPaperWorkspace')) {
        populateConfig(data.config || {});
        if (!state.selectedDate || state.selectedDate === (data.latest && data.latest.date)) renderRun(data.latest);
        if (loadRuns) {
          var history = await jsonFetch('/api/daily-papers/runs?limit=30&userId=' + encodeURIComponent(userId()));
          renderHistory(history.runs, state.selectedDate || (data.latest && data.latest.date) || '');
        }
      }
      if (data.status && data.status.running) startPolling();
      else stopPolling();
    } catch (error) {
      if (document.getElementById('dailyPaperWorkspace')) setSettingsStatus('状态读取失败：' + error.message, true);
    } finally {
      state.polling = false;
    }
  }

  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = window.setInterval(function() { refreshDailyPaperStatus(true); }, 4000);
  }

  function stopPolling() {
    if (!state.pollTimer) return;
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function updateMenuBadge(status) {
    var badge = document.getElementById('dailyPaperMenuBadge');
    var button = document.getElementById('appDailyPaperButton');
    if (!badge || !button) return;
    var workspaceOpen = isDailyPaperWorkspaceOpen();
    var notificationId = notificationIdFor(status, state.latest);
    if (workspaceOpen && notificationId) setReadNotificationId(notificationId);
    var unread = !!notificationId && notificationId !== getReadNotificationId();
    var visible = !!(status && (status.running || unread));
    badge.hidden = !visible;
    badge.dataset.state = status && status.running ? 'running' : status && status.stage || 'idle';
    badge.textContent = status && status.running ? '…' : status && status.stage === 'failed' ? '!' : '•';
    button.classList.toggle('active', workspaceOpen);
  }

  function setDailyPaperResearchRadarOpen(open) {
    var panel = document.getElementById('dailyPaperResearchRadar');
    var button = document.getElementById('dailyPaperResearchRadarButton');
    if (!panel) return;
    panel.hidden = !open;
    if (button) {
      button.classList.toggle('active', open);
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  }

  function toggleDailyPaperResearchRadar() {
    var panel = document.getElementById('dailyPaperResearchRadar');
    if (!panel) return;
    setDailyPaperResearchRadarOpen(panel.hidden);
  }

  function mountDailyPaperHeaderControls() {
    var page = document.querySelector('#homeUtilityPage[data-page-id="daily-papers"]');
    var header = page && page.querySelector('.home-utility-header');
    var heading = header && header.querySelector('.home-utility-heading');
    var closeButton = header && header.querySelector('#homeUtilityCloseBtn');
    if (!header || !heading || !closeButton || header.querySelector('.daily-paper-header-automation')) return;
    var status = document.createElement('div');
    status.className = 'daily-paper-header-status';
    status.innerHTML = '<span class="daily-paper-header-status-glyph" id="dailyPaperStageGlyph">✓</span>' +
      '<span class="daily-paper-header-status-copy"><small>今日状态</small><strong id="dailyPaperStageTitle">尚未生成今日推荐</strong><span id="dailyPaperStageMessage">等待设置研究领域</span></span>' +
      '<span class="daily-paper-state-pill" id="dailyPaperStatePill">等待运行</span>';
    var radarButton = document.createElement('button');
    radarButton.id = 'dailyPaperResearchRadarButton';
    radarButton.type = 'button';
    radarButton.className = 'daily-paper-header-radar';
    radarButton.textContent = '研究雷达';
    radarButton.setAttribute('aria-controls', 'dailyPaperResearchRadar');
    radarButton.setAttribute('aria-expanded', 'false');
    radarButton.onclick = toggleDailyPaperResearchRadar;
    var history = document.createElement('div');
    history.className = 'daily-paper-header-history';
    history.innerHTML = '<select id="dailyPaperRunHistory" onchange="selectDailyPaperRun(this.value)" aria-label="选择历史推荐"><option value="">暂无历史</option></select>';
    var wrapper = document.createElement('div');
    wrapper.className = 'daily-paper-header-automation';
    wrapper.innerHTML = '<span class="daily-paper-header-automation-copy"><strong>每日自动总结</strong><small id="dailyPaperAutomationHint">软件运行时每天自动执行一次</small></span>' +
      '<input class="daily-paper-header-time" type="time" id="dailyPaperRunTime" value="08:00" aria-label="每日自动总结时间" onchange="saveDailyPaperRunTime(this.value)">' +
      '<label class="daily-paper-header-switch" aria-label="开启或关闭每日自动总结"><input type="checkbox" id="dailyPaperEnabled" onchange="toggleDailyPaperAutomation(this.checked)"><i aria-hidden="true"></i></label>';
    header.insertBefore(radarButton, closeButton);
    header.insertBefore(wrapper, closeButton);
    header.insertBefore(status, closeButton);
    header.insertBefore(history, closeButton);
  }

  async function showDailyPaperWorkspace() {
    window.showHomeUtilityPage('daily-papers', '每日论文', '', workspaceMarkup());
    mountDailyPaperHeaderControls();
    var button = document.getElementById('appDailyPaperButton');
    if (button) button.classList.add('active');
    updateMenuBadge(state.status);
    try {
      await Promise.all([refreshDailyPaperStatus(true), refreshDailyPaperWosConfig()]);
    } catch (_) {}
  }

  window.showDailyPaperWorkspace = showDailyPaperWorkspace;
  window.saveDailyPaperSettings = saveDailyPaperSettings;
  window.toggleDailyPaperAutomation = toggleDailyPaperAutomation;
  window.runDailyPaperNow = runDailyPaperNow;
  window.toggleDailyPaperResearchRadar = toggleDailyPaperResearchRadar;
  window.selectDailyPaperRun = selectDailyPaperRun;
  window.submitDailyPaperFeedback = submitDailyPaperFeedback;
  window.addDailyPaperToLibraries = addDailyPaperToLibraries;
  window.confirmDailyPaperLibraryProject = confirmDailyPaperLibraryProject;
  window.refreshDailyPaperStatus = refreshDailyPaperStatus;
  window.saveDailyPaperRunTime = saveDailyPaperRunTime;
  window.saveDailyPaperWosConfig = saveDailyPaperWosConfig;
  window.testDailyPaperWosConnection = testDailyPaperWosConnection;

  window.setTimeout(function() { refreshDailyPaperStatus(false); }, 1800);
  window.setInterval(function() { refreshDailyPaperStatus(false); }, 60_000);
})();
