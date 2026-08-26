(function() {
  'use strict';

  var constructorState = {
    status: null,
    stagingDir: '',
    featureId: '',
    changeId: '',
    draft: null,
    output: null,
    outputError: false,
    activeJobId: '',
    jobLog: '',
    jobLogError: '',
    logExpanded: true,
    runLogScrollJobId: '',
    runLogScrollTop: 0,
    pollTimer: null
  };

  function constructorUserId() {
    return typeof currentUserId !== 'undefined' && currentUserId ? currentUserId : 'web-user';
  }

  async function constructorJson(url, options) {
    var response = await fetch(url, options || {});
    var data = await response.json().catch(function() { return {}; });
    if (!response.ok || data.success === false) {
      throw new Error(data.message || data.error || ('请求失败（HTTP ' + response.status + '）'));
    }
    return data;
  }

  function constructorIcon() {
    return '<svg class="ui-icon sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4"></path><path d="M12 17v4"></path><path d="M3 12h4"></path><path d="M17 12h4"></path><circle cx="12" cy="12" r="5"></circle><path d="m8.5 8.5-2.8-2.8"></path><path d="m18.3 18.3-2.8-2.8"></path></svg>';
  }

  function ensureConstructorNavigationButton() {
    var legacy = document.getElementById('constructorAgentSidebarButton');
    if (legacy) legacy.remove();
  }

  function constructorFeatureButton(feature, item) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'lit-btn constructor-feature-nav';
    button.dataset.constructorFeatureId = feature.id;
    button.innerHTML = constructorIcon() + '<span></span>';
    button.querySelector('span').textContent = item.label;
    button.addEventListener('click', function() {
      window.showConstructorFeaturePage(feature.id, item.pageId);
    });
    return button;
  }

  async function loadConstructorFeatureRuntime() {
    ensureConstructorNavigationButton();
    document.querySelectorAll('.constructor-feature-nav').forEach(function(node) { node.remove(); });
    try {
      var url = '/api/constructor-agent/features?enabledOnly=true&userId=' + encodeURIComponent(constructorUserId());
      var data = await constructorJson(url);
      (data.features || []).forEach(function(feature) {
        var manifest = feature.manifest || {};
        var contributions = manifest.contributions || {};
        (contributions.navigation || []).forEach(function(item) {
          var section = item.section === 'view' ? 'view' : 'tools';
          var body = document.querySelector('.sidebar-panel[data-sidebar-collapse-key="' + section + '"] .sidebar-panel-body');
          if (body) body.appendChild(constructorFeatureButton(feature, item));
        });
        (contributions.commands || []).forEach(function(command) {
          ensureConstructorCommand(feature, command);
        });
      });
    } catch (error) {
      console.warn('[ConstructorAgent] Runtime features unavailable:', error);
    }
  }
  window.loadConstructorFeatureRuntime = loadConstructorFeatureRuntime;

  function ensureConstructorCommand(feature, command) {
    var dropdown = document.getElementById('slashDropdown');
    if (!dropdown || dropdown.querySelector('[data-constructor-command="' + feature.id + ':' + command.id + '"]')) return;
    var item = document.createElement('div');
    item.className = 'slash-item constructor-command-item';
    item.dataset.constructorCommand = feature.id + ':' + command.id;
    item.innerHTML = '<span class="mention-icon">' + constructorIcon() + '</span><span class="mention-name"></span><span class="mention-desc">构造功能包命令</span>';
    item.querySelector('.mention-name').textContent = '/' + command.label;
    item.addEventListener('click', function() {
      var input = document.getElementById('userInput');
      if (input) {
        input.value = String(command.promptTemplate || '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }
      dropdown.style.display = 'none';
    });
    dropdown.appendChild(item);
  }

  async function showConstructorFeaturePage(featureId, pageId) {
    try {
      var data = await constructorJson('/api/constructor-agent/features?enabledOnly=true&userId=' + encodeURIComponent(constructorUserId()));
      var feature = (data.features || []).find(function(item) { return item.id === featureId; });
      if (!feature) throw new Error('功能包未启用或不存在');
      var pages = (((feature || {}).manifest || {}).contributions || {}).pages || [];
      var page = pages.find(function(item) { return item.id === pageId; });
      if (!page) throw new Error('功能包页面不存在');
      var src = feature.assetBaseUrl + '/' + page.entry.split('/').map(encodeURIComponent).join('/') + '?userId=' + encodeURIComponent(constructorUserId());
      var html = '<div class="constructor-feature-host">' +
        '<iframe class="constructor-feature-frame" data-constructor-feature-id="' + escapeHtml(feature.id) + '" data-constructor-permissions="' + escapeHtml(JSON.stringify(feature.manifest.permissions || [])) + '" sandbox="allow-scripts" referrerpolicy="no-referrer" src="' + src + '" title="' + escapeHtml(page.title) + '"></iframe>' +
      '</div>';
      showHomeUtilityPage('constructor-feature-' + featureId, page.title, page.subtitle || feature.manifest.description || '', html);
    } catch (error) {
      alert(error.message || String(error));
    }
  }
  window.showConstructorFeaturePage = showConstructorFeaturePage;

  function constructorThemeValue(styles, name, fallback) {
    var value = String(styles.getPropertyValue(name) || '').trim();
    return value || fallback;
  }

  function buildConstructorFeatureThemePayload() {
    var styles = getComputedStyle(document.documentElement);
    var primary = constructorThemeValue(styles, '--theme-primary', '#111827');
    var primaryHover = constructorThemeValue(styles, '--theme-primary-hover', primary);
    var ink = constructorThemeValue(styles, '--theme-ink', '#111827');
    var muted = constructorThemeValue(styles, '--theme-mid', '#4b5563');
    var border = constructorThemeValue(styles, '--theme-border', '#d1d5db');
    var soft = constructorThemeValue(styles, '--theme-soft', '#e5e7eb');
    var softer = constructorThemeValue(styles, '--theme-softer', '#f3f4f6');
    var onPrimary = constructorThemeValue(styles, '--theme-on-primary', '#ffffff');

    return {
      '--feature-bg': '#ffffff',
      '--feature-fg': ink,
      '--feature-muted': muted,
      '--feature-border': border,
      '--feature-soft': soft,
      '--feature-softer': softer,
      '--feature-primary': primary,
      '--feature-primary-hover': primaryHover,
      '--feature-on-primary': onPrimary,
      // Compatibility aliases for the first generated text-to-speech package.
      '--tts-bg': '#ffffff',
      '--tts-fg': ink,
      '--tts-muted': muted,
      '--tts-border': border,
      '--tts-input-bg': '#ffffff',
      '--tts-input-fg': ink,
      '--tts-placeholder': muted,
      '--tts-btn-bg': softer,
      '--tts-btn-fg': ink,
      '--tts-btn-hover': soft,
      '--tts-primary': primary,
      '--tts-primary-hover': primaryHover,
      '--tts-status': muted,
      '--tts-error': '#dc2626'
    };
  }

  function postConstructorFeatureMessage(frame, payload) {
    if (!frame || !frame.contentWindow) return;
    // `scholar-harness-host` is the canonical response source. The second
    // message keeps already-installed v1 feature packages working; listeners
    // remove pending requests after the first accepted response, so this is
    // safe for both old and new packages.
    frame.contentWindow.postMessage(Object.assign({}, payload, { source: 'scholar-harness-host' }), '*');
    frame.contentWindow.postMessage(Object.assign({}, payload, { source: 'scholar-harness-feature' }), '*');
  }

  function sendConstructorFeatureTheme(frame) {
    postConstructorFeatureMessage(frame, {
      type: 'theme',
      theme: buildConstructorFeatureThemePayload()
    });
  }

  function broadcastConstructorFeatureTheme() {
    Array.prototype.slice.call(document.querySelectorAll('iframe.constructor-feature-frame'))
      .forEach(sendConstructorFeatureTheme);
  }
  window.broadcastConstructorFeatureTheme = broadcastConstructorFeatureTheme;

  async function handleConstructorFeatureMessage(event) {
    var frames = Array.prototype.slice.call(document.querySelectorAll('iframe.constructor-feature-frame'));
    var frame = frames.find(function(item) { return item.contentWindow === event.source; });
    var message = event.data || {};
    if (!frame || message.source !== 'scholar-harness-feature') return;
    var permissions = [];
    try { permissions = JSON.parse(frame.dataset.constructorPermissions || '[]'); } catch (_) { permissions = []; }
    if (message.type === 'theme.request') {
      sendConstructorFeatureTheme(frame);
      return;
    }
    if (!message.requestId) return;
    var featureId = frame.dataset.constructorFeatureId || '';
    var response = { source: 'scholar-harness-host', requestId: String(message.requestId), success: false };
    try {
      if (permissions.indexOf('feature:storage') < 0 || !/^storage\.(get|set|delete)$/.test(String(message.type || ''))) {
        throw new Error('该功能包没有请求此宿主能力的权限');
      }
      var key = String(message.key || '');
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(key)) throw new Error('存储键不合法');
      var base = '/api/constructor-agent/features/' + encodeURIComponent(featureId) + '/storage/' + encodeURIComponent(key);
      var options = {};
      if (message.type === 'storage.set') {
        options = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: constructorUserId(), value: message.value }) };
      } else if (message.type === 'storage.delete') {
        base += '?userId=' + encodeURIComponent(constructorUserId());
        options = { method: 'DELETE' };
      } else {
        base += '?userId=' + encodeURIComponent(constructorUserId());
      }
      var data = await constructorJson(base, options);
      response.success = true;
      response.ok = true;
      response.value = data.value;
    } catch (error) {
      response.ok = false;
      response.error = error.message || String(error);
    }
    postConstructorFeatureMessage(frame, response);
  }

  window.addEventListener('message', handleConstructorFeatureMessage);
  window.addEventListener('scholarharness:color-theme-change', broadcastConstructorFeatureTheme);

  function renderConstructorFeatureList(features) {
    if (!features || !features.length) {
      return '<div class="constructor-empty">尚未安装功能包。先描述需求并生成一个预览版本。</div>';
    }
    return features.map(function(feature) {
      var manifest = feature.manifest || {};
      return '<article class="constructor-feature-card">' +
        '<div class="constructor-feature-copy"><strong>' + escapeHtml(manifest.name || feature.id) + '</strong>' +
          '<span>' + escapeHtml(feature.id + ' · v' + feature.activeVersion) + '</span>' +
          '<p>' + escapeHtml(manifest.description || '') + '</p></div>' +
        '<div class="constructor-feature-actions">' +
          '<button type="button" onclick="toggleConstructorFeature(\'' + feature.id + '\',' + (!feature.enabled) + ')">' + (feature.enabled ? '停用' : '启用') + '</button>' +
          '<button type="button" onclick="rollbackConstructorFeature(\'' + feature.id + '\')">回滚</button>' +
          '<button type="button" class="danger" onclick="removeConstructorFeature(\'' + feature.id + '\')">卸载</button>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function renderConstructorJobs(jobs) {
    if (!jobs || !jobs.length) return '<div class="constructor-empty compact">暂无后台任务。</div>';
    return jobs.slice(0, 8).map(function(job) {
      var running = job.status === 'queued' || job.status === 'running';
      return '<button type="button" class="constructor-job ' + escapeHtml(job.status) + '" onclick="showConstructorJobLog(\'' + job.id + '\')">' +
        '<span class="constructor-job-dot"></span><span><strong>' + escapeHtml(job.kind === 'reasonix-build' ? '运行时功能构建' : job.kind === 'reasonix-core-proposal' ? '核心改造候选' : job.kind === 'core-apply' ? '核心变更应用与验证' : 'Reasonix 安装') + '</strong>' +
        '<small>' + escapeHtml(job.message || job.status) + '</small></span>' +
        (running ? '<em>运行中</em>' : '<em>' + escapeHtml(job.status) + '</em>') +
      '</button>';
    }).join('');
  }

  function constructorJobTitle(job) {
    if (!job) return '构造任务';
    return job.kind === 'reasonix-build' ? '运行时功能构建'
      : job.kind === 'reasonix-core-proposal' ? '核心改造候选'
      : job.kind === 'core-apply' ? '核心变更应用与验证'
      : 'Reasonix 安装';
  }

  function constructorJobStatusLabel(status) {
    return {
      queued: '等待执行',
      running: '运行中',
      success: '已完成',
      error: '执行失败',
      cancelled: '已取消'
    }[status] || String(status || '未知状态');
  }

  function constructorJobElapsed(job) {
    if (!job || !job.createdAt) return '';
    var started = new Date(job.createdAt).getTime();
    var finished = job.status === 'queued' || job.status === 'running'
      ? Date.now()
      : new Date(job.updatedAt || job.createdAt).getTime();
    if (!Number.isFinite(started) || !Number.isFinite(finished)) return '';
    var seconds = Math.max(0, Math.floor((finished - started) / 1000));
    if (seconds < 60) return seconds + ' 秒';
    var minutes = Math.floor(seconds / 60);
    var remaining = seconds % 60;
    return minutes + ' 分 ' + remaining + ' 秒';
  }

  function constructorSelectedJob(status) {
    var jobs = status && Array.isArray(status.jobs) ? status.jobs : [];
    var selected = jobs.find(function(job) { return job.id === constructorState.activeJobId; });
    if (selected) return selected;
    selected = jobs.find(function(job) { return job.status === 'queued' || job.status === 'running'; }) || jobs[0] || null;
    if (selected) constructorState.activeJobId = selected.id;
    return selected;
  }

  function renderConstructorRunPanel(status) {
    var outputHtml = '<div class="constructor-output' + (constructorState.outputError ? ' error' : '') + (constructorState.output === null ? ' empty' : '') + '" id="constructorOutput">' + escapeHtml(constructorState.output || '') + '</div>';
    var job = constructorSelectedJob(status);
    if (!job) return outputHtml;
    var isActive = job.status === 'queued' || job.status === 'running';
    var logText = constructorState.jobLogError || constructorState.jobLog || (isActive ? '任务已启动，正在等待第一条运行日志…' : '该任务没有产生运行日志。');
    return outputHtml +
      '<section class="constructor-run-status state-' + escapeHtml(job.status) + '" data-constructor-job-id="' + escapeHtml(job.id) + '">' +
        '<div class="constructor-run-summary">' +
          '<div class="constructor-run-identity"><span class="constructor-run-dot" aria-hidden="true"></span><div><strong>' + escapeHtml(constructorJobTitle(job)) + '</strong><small>' + escapeHtml(job.message || constructorJobStatusLabel(job.status)) + '</small></div></div>' +
          '<div class="constructor-run-meta"><span class="constructor-status-badge">' + escapeHtml(constructorJobStatusLabel(job.status)) + '</span><time>' + escapeHtml(constructorJobElapsed(job)) + '</time></div>' +
        '</div>' +
        '<div class="constructor-run-progress" aria-hidden="true"><span></span></div>' +
        '<div class="constructor-log-heading"><strong>运行日志</strong><button type="button" onclick="toggleConstructorRunLog()">' + (constructorState.logExpanded ? '收起' : '展开') + '</button></div>' +
        '<div class="constructor-run-log' + (constructorState.logExpanded ? '' : ' collapsed') + '"><pre>' + escapeHtml(logText) + '</pre></div>' +
      '</section>';
  }

  function renderConstructorRequestSurface(status) {
    var job = constructorSelectedJob(status);
    var isActive = job && (job.status === 'queued' || job.status === 'running');
    if (isActive) {
      return '<div class="constructor-request-editor constructor-request-editor-running">' +
        renderConstructorRunPanel(status) +
      '</div>';
    }
    return '<div class="constructor-request-editor">' +
        '<textarea id="constructorRequest" placeholder="例如：在实用工具中增加一个实验设计检查页面，保存每个项目的检查记录，并能把摘要发送到主页聊天。"></textarea>' +
        '<div class="constructor-primary-actions constructor-one-click-actions">' +
          '<button type="button" class="primary constructor-run-button" onclick="runConstructorPipeline()">一键构造并后台执行</button>' +
        '</div>' +
      '</div>' +
      '<div class="constructor-output' + (constructorState.outputError ? ' error' : '') + (constructorState.output === null ? ' empty' : '') + '" id="constructorOutput">' + escapeHtml(constructorState.output || '') + '</div>';
  }

  function constructorRiskLabel(risk) {
    return { low: '低风险', medium: '中风险', high: '高风险', critical: '关键风险' }[risk] || risk || '未知风险';
  }

  function constructorStatusLabel(status) {
    return {
      planned: '方案已生成',
      'awaiting-plan-approval': '等待批准方案',
      'approved-for-generation': '已批准生成候选',
      generating: '正在隔离区生成',
      'awaiting-apply-approval': '候选已完成，等待批准应用',
      'approved-for-apply': '已批准应用', applying: '正在应用并验证', applied: '已应用',
      'rolled-back': '已回滚', failed: '失败'
    }[status] || status;
  }

  function renderConstructorChanges(changes) {
    if (!changes || !changes.length) return '<div class="constructor-empty compact">暂无改造方案。</div>';
    return changes.slice(0, 10).map(function(change) {
      var domains = (change.affectedDomains || []).map(function(item) { return item.name; }).join('、');
      var actions = '';
      if (change.status === 'awaiting-plan-approval') actions += '<button type="button" class="primary" onclick="approveConstructorChange(\'' + change.id + '\',\'plan\')">批准方案并继续</button>';
      if (change.status === 'approved-for-generation') actions += '<button type="button" class="primary" onclick="resumeConstructorPipeline(\'' + change.id + '\')">继续自动构造</button>';
      if (change.status === 'failed' && change.mode === 'runtime-feature' && !change.requiresApproval) actions += '<button type="button" class="primary" onclick="resumeConstructorPipeline(\'' + change.id + '\')">重新执行</button>';
      if (change.status === 'awaiting-apply-approval') actions += '<button type="button" onclick="reviewConstructorCoreDiff(\'' + change.id + '\')">查看文件差异</button><button type="button" class="primary" onclick="approveConstructorChange(\'' + change.id + '\',\'apply\')">批准应用</button>';
      if (change.status === 'approved-for-apply') actions += '<button type="button" class="primary" onclick="applyConstructorCoreChange(\'' + change.id + '\')">应用并自动验证</button>';
      if (change.backupDir && (change.status === 'applied' || change.status === 'failed')) actions += '<button type="button" class="danger" onclick="rollbackConstructorCoreChange(\'' + change.id + '\')">恢复应用前版本</button>';
      return '<article class="constructor-change-card risk-' + escapeHtml(change.risk) + '" data-constructor-change-id="' + escapeHtml(change.id) + '">' +
        '<div class="constructor-change-copy"><div><strong>' + escapeHtml(change.objective) + '</strong><span>' + escapeHtml(constructorRiskLabel(change.risk)) + '</span></div>' +
        '<p>' + escapeHtml((change.mode === 'core-change' ? '核心源码改造' : '运行时功能包') + ' · ' + constructorStatusLabel(change.status)) + '</p>' +
        '<small>影响：' + escapeHtml(domains || '待进一步分析') + '</small></div>' +
        '<div class="constructor-feature-actions">' + actions + '</div></article>';
    }).join('');
  }

  function renderConstructorPageHeader(status) {
    var page = document.getElementById('homeUtilityPage');
    var header = page && page.querySelector('.home-utility-header');
    var title = header && header.querySelector('.home-utility-title');
    var titleCopy = title && title.parentElement;
    if (!header || !title || !titleCopy) return;

    var capabilities = status.capabilities || {};
    var executor = status.executor || {};
    var source = status.source || {};
    header.classList.add('constructor-page-header');
    titleCopy.classList.add('constructor-page-header-copy');

    var titleRow = titleCopy.querySelector('.constructor-page-title-row');
    if (!titleRow) {
      titleRow = document.createElement('div');
      titleRow.className = 'constructor-page-title-row';
      titleCopy.insertBefore(titleRow, title);
      titleRow.appendChild(title);
    }
    var oldStats = titleRow.querySelector('.constructor-header-stats');
    if (oldStats) oldStats.remove();
    var stats = document.createElement('div');
    stats.className = 'constructor-header-stats';
    stats.setAttribute('aria-label', '软件全局认知');
    stats.innerHTML = '<span><b>' + escapeHtml(String(capabilities.domainCount || 0)) + '</b><small>产品域</small></span>' +
      '<span><b>' + escapeHtml(String(capabilities.frontendModuleCount || 0)) + '</b><small>前端模块</small></span>' +
      '<span><b>' + escapeHtml(String(capabilities.endpointCount || 0)) + '</b><small>接口</small></span>' +
      '<span><b>' + escapeHtml(String(capabilities.serviceCount || 0)) + '</b><small>服务</small></span>';
    titleRow.appendChild(stats);

    var executorPanel = header.querySelector('.constructor-header-executor');
    if (!executorPanel) {
      executorPanel = document.createElement('aside');
      executorPanel.className = 'constructor-header-executor';
      header.appendChild(executorPanel);
    }
    executorPanel.innerHTML = '<div class="constructor-header-executor-copy"><strong>DeepSeek 氛围编程执行器</strong><span>Reasonix · MIT · Skill/MCP/权限/检查点</span></div>' +
      '<div class="constructor-header-executor-controls"><div class="constructor-executor-status ' + (executor.installed ? 'ready' : '') + '"><span></span>' +
        (executor.installed ? '已检测到 ' + escapeHtml(executor.version || 'Reasonix') : '尚未安装 Reasonix') + '</div>' +
        '<div class="constructor-header-executor-actions">' +
          (executor.installed ? '<button type="button" data-constructor-executor-action="refresh">重新检测</button>' : '<button type="button" class="primary" data-constructor-executor-action="install">一键安装 Reasonix</button>') +
          '<a href="https://github.com/esengine/DeepSeek-Reasonix" target="_blank" rel="noreferrer">MIT License</a></div>' +
        (!source.available ? '<small class="constructor-header-source-note">无源码安装版仅支持运行时功能包；核心改造需连接源码工作区。</small>' : '') +
      '</div>';
    var action = executorPanel.querySelector('[data-constructor-executor-action]');
    if (action) action.addEventListener('click', function() {
      if (action.dataset.constructorExecutorAction === 'install') installReasonixExecutor();
      else refreshConstructorWorkspace();
    });
  }

  function constructorWorkspaceHtml(status) {
    return '<div class="constructor-agent-grid">' +
      '<section class="constructor-card constructor-request-card constructor-request-card-wide">' +
        '<div class="constructor-card-heading"><div><strong>描述你想改造的软件功能</strong><span>构造 Agent 先读取全局能力地图，再按风险选择热插拔扩展或隔离核心改造。</span></div>' +
          '<span class="constructor-safety-badge">全局感知 · 双重批准 · 自动回滚</span></div>' +
        renderConstructorRequestSurface(status) +
      '</section>' +
      '<div class="constructor-management-grid">' +
        '<section class="constructor-card constructor-jobs-card"><div class="constructor-card-heading"><div><strong>后台任务</strong><span>关闭页面后任务仍可继续，重新打开可查看状态和日志</span></div></div><div id="constructorJobList">' + renderConstructorJobs(status.jobs || []) + '</div></section>' +
        '<section class="constructor-card constructor-changes-card"><div class="constructor-card-heading"><div><strong>改造方案与审批</strong><span>高风险和关键风险改造必须先批准方案，再批准应用</span></div></div><div id="constructorChangeList">' + renderConstructorChanges(status.changes || []) + '</div></section>' +
        '<section class="constructor-card constructor-installed-card"><div class="constructor-card-heading"><div><strong>已安装功能包</strong><span>启用状态会在软件重启后恢复</span></div></div><div id="constructorFeatureList">' + renderConstructorFeatureList(status.features || []) + '</div></section>' +
      '</div>' +
    '</div>';
  }

  async function showConstructorAgentWorkspace() {
    showHomeUtilityPage('constructor-agent', '构造 Agent', '理解 Scholar Harness 全部前后端能力；按需新增、修改或删除功能，重大改造必须获得批准并保留回滚点。', '<div class="constructor-loading">正在读取软件全局能力地图…</div>');
    await refreshConstructorWorkspace();
  }
  window.showConstructorAgentWorkspace = showConstructorAgentWorkspace;

  async function refreshConstructorWorkspace() {
    try {
      captureConstructorDraft();
      captureConstructorRunLogPosition();
      var status = await constructorJson('/api/constructor-agent/status?userId=' + encodeURIComponent(constructorUserId()));
      constructorState.status = status;
      var selectedJob = constructorSelectedJob(status);
      if (selectedJob) {
        try {
          var logData = await constructorJson('/api/constructor-agent/jobs/' + encodeURIComponent(selectedJob.id) + '/log?userId=' + encodeURIComponent(constructorUserId()));
          constructorState.jobLog = String(logData.log || '');
          constructorState.jobLogError = '';
        } catch (logError) {
          constructorState.jobLogError = '日志读取失败：' + (logError.message || String(logError));
        }
      } else {
        constructorState.jobLog = '';
        constructorState.jobLogError = '';
      }
      var page = document.getElementById('homeUtilityPage');
      if (!page || page.dataset.pageId !== 'constructor-agent') return;
      var content = page.querySelector('.home-utility-content');
      if (content) content.innerHTML = constructorWorkspaceHtml(status);
      renderConstructorPageHeader(status);
      restoreConstructorDraft();
      restoreConstructorRunLogPosition();
      scheduleConstructorPolling(status.jobs || []);
    } catch (error) {
      var loading = document.querySelector('#homeUtilityPage .constructor-loading');
      if (loading) loading.textContent = '读取构造环境失败：' + (error.message || error);
    }
  }
  window.refreshConstructorWorkspace = refreshConstructorWorkspace;

  function captureConstructorDraft() {
    var request = document.getElementById('constructorRequest');
    if (!request) return;
    constructorState.draft = {
      request: request.value || ''
    };
  }

  function restoreConstructorDraft() {
    var draft = constructorState.draft;
    if (!draft) return;
    var request = document.getElementById('constructorRequest');
    if (request) request.value = draft.request;
  }

  function captureConstructorRunLogPosition() {
    var panel = document.querySelector('.constructor-run-status[data-constructor-job-id]');
    var log = panel && panel.querySelector('.constructor-run-log');
    if (!panel || !log) return;
    constructorState.runLogScrollJobId = String(panel.getAttribute('data-constructor-job-id') || '');
    constructorState.runLogScrollTop = Math.max(0, Number(log.scrollTop) || 0);
  }

  function restoreConstructorRunLogPosition() {
    var panel = document.querySelector('.constructor-run-status[data-constructor-job-id]');
    var log = panel && panel.querySelector('.constructor-run-log');
    if (!panel || !log) return;
    var jobId = String(panel.getAttribute('data-constructor-job-id') || '');
    if (!jobId || jobId !== constructorState.runLogScrollJobId) return;
    log.scrollTop = Math.min(constructorState.runLogScrollTop, Math.max(0, log.scrollHeight - log.clientHeight));
  }

  function constructorForm() {
    var basic = constructorRequestInput();
    var name = String((document.getElementById('constructorFeatureName') || {}).value || '').trim();
    var featureId = String((document.getElementById('constructorFeatureId') || {}).value || '').trim().toLowerCase();
    if (!name) throw new Error('请填写功能名称');
    if (!/^[a-z][a-z0-9-]{2,63}$/.test(featureId)) throw new Error('英文 id 需使用小写字母、数字和短横线，并以字母开头');
    return { request: basic.request, name: name, featureId: featureId, mode: basic.mode };
  }

  function constructorRequestInput() {
    var request = String((document.getElementById('constructorRequest') || {}).value || '').trim();
    if (!request || request.length < 5) throw new Error('请先描述要实现的功能');
    return { request: request };
  }

  function setConstructorOutput(value, isError) {
    var output = document.getElementById('constructorOutput');
    if (!output) return;
    output.classList.toggle('error', !!isError);
    output.classList.remove('empty');
    constructorState.outputError = !!isError;
    constructorState.output = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    output.textContent = constructorState.output;
  }

  async function runConstructorPipeline() {
    try {
      var input = constructorRequestInput();
      setConstructorOutput('正在分析影响并启动自动构造流水线…');
      var data = await constructorJson('/api/constructor-agent/pipeline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: constructorUserId(), request: input.request })
      });
      constructorState.changeId = data.plan && data.plan.id || '';
      constructorState.featureId = data.featureId || '';
      constructorState.stagingDir = data.stagingDir || '';
      if (data.state === 'approval-required') {
        constructorState.activeJobId = '';
        setConstructorOutput('已完成全局影响分析。该需求属于' + constructorRiskLabel(data.plan.risk) + '的核心改造，等待你在下方批准方案后自动继续。');
      } else {
        constructorState.activeJobId = data.job.id;
        constructorState.jobLog = '';
        constructorState.jobLogError = '';
        constructorState.runLogScrollJobId = data.job.id;
        constructorState.runLogScrollTop = 0;
        constructorState.output = null;
        constructorState.outputError = false;
      }
      await refreshConstructorWorkspace();
    } catch (error) { setConstructorOutput(error.message || String(error), true); }
  }
  window.runConstructorPipeline = runConstructorPipeline;

  async function resumeConstructorPipeline(changeId) {
    try {
      setConstructorOutput('批准已确认，正在继续自动构造流水线…');
      var data = await constructorJson('/api/constructor-agent/changes/' + encodeURIComponent(changeId) + '/pipeline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: constructorUserId() })
      });
      constructorState.changeId = changeId;
      constructorState.featureId = data.featureId || '';
      constructorState.stagingDir = data.stagingDir || '';
      constructorState.activeJobId = data.job.id;
      constructorState.jobLog = '';
      constructorState.jobLogError = '';
      constructorState.runLogScrollJobId = data.job.id;
      constructorState.runLogScrollTop = 0;
      constructorState.output = null;
      constructorState.outputError = false;
      await refreshConstructorWorkspace();
    } catch (error) { setConstructorOutput(error.message || String(error), true); }
  }
  window.resumeConstructorPipeline = resumeConstructorPipeline;

  async function planConstructorFeature() {
    try {
      var input = constructorRequestInput();
      var data = await constructorJson('/api/constructor-agent/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: constructorUserId(), request: input.request, mode: input.mode }) });
      constructorState.changeId = data.plan.id;
      setConstructorOutput({ id: data.plan.id, mode: data.plan.mode, risk: data.plan.risk, status: data.plan.status, impact: data.plan.impactSummary, affectedFiles: data.plan.affectedFiles, validation: data.plan.validationCommands, rollback: data.plan.rollbackStrategy });
      await refreshConstructorWorkspace();
    } catch (error) { setConstructorOutput(error.message || String(error), true); }
  }
  window.planConstructorFeature = planConstructorFeature;

  function closeConstructorApproval() {
    var panel = document.querySelector('.constructor-inline-approval');
    if (panel) panel.remove();
  }
  window.closeConstructorApproval = closeConstructorApproval;

  function syncConstructorApprovalButton(input) {
    var panel = input && input.closest('.constructor-inline-approval');
    if (!panel) return;
    var button = panel.querySelector('[data-constructor-approval-submit]');
    if (button) button.disabled = input.value !== panel.dataset.confirmation;
  }
  window.syncConstructorApprovalButton = syncConstructorApprovalButton;

  function handleConstructorApprovalKeydown(event, changeId, stage) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeConstructorApproval();
      return;
    }
    if (event.key === 'Enter' && event.currentTarget.value === event.currentTarget.closest('.constructor-inline-approval').dataset.confirmation) {
      event.preventDefault();
      submitConstructorApproval(changeId, stage);
    }
  }
  window.handleConstructorApprovalKeydown = handleConstructorApprovalKeydown;

  function approveConstructorChange(changeId, stage) {
    closeConstructorApproval();
    var phrase = stage === 'plan' ? '批准重大修改' : '应用并保留回滚点';
    var card = document.querySelector('.constructor-change-card[data-constructor-change-id="' + CSS.escape(String(changeId)) + '"]');
    if (!card) {
      setConstructorOutput('未找到待审批的改造方案，请刷新后重试。', true);
      return;
    }
    var panel = document.createElement('div');
    panel.className = 'constructor-inline-approval';
    panel.dataset.confirmation = phrase;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '确认构造 Agent 重大修改');
    panel.innerHTML = '<div class="constructor-inline-approval-copy"><strong>' + (stage === 'plan' ? '确认继续生成核心改造候选' : '确认应用核心改造') + '</strong>' +
      '<span>这是不可由构造 Agent 代替你的明确决定。请输入 <b>' + phrase + '</b> 后继续。</span></div>' +
      '<div class="constructor-inline-approval-controls"><input type="text" autocomplete="off" spellcheck="false" aria-label="输入确认文字" placeholder="请输入：' + phrase + '">' +
      '<button type="button" onclick="closeConstructorApproval()">取消</button>' +
      '<button type="button" class="primary" data-constructor-approval-submit disabled>确认并继续</button></div>';
    var input = panel.querySelector('input');
    var submit = panel.querySelector('[data-constructor-approval-submit]');
    input.addEventListener('input', function() { syncConstructorApprovalButton(input); });
    input.addEventListener('keydown', function(event) { handleConstructorApprovalKeydown(event, changeId, stage); });
    submit.addEventListener('click', function() { submitConstructorApproval(changeId, stage); });
    card.insertAdjacentElement('afterend', panel);
    input.focus();
  }
  window.approveConstructorChange = approveConstructorChange;

  async function submitConstructorApproval(changeId, stage) {
    var panel = document.querySelector('.constructor-inline-approval');
    var input = panel && panel.querySelector('input');
    var submit = panel && panel.querySelector('[data-constructor-approval-submit]');
    try {
      var phrase = stage === 'plan' ? '批准重大修改' : '应用并保留回滚点';
      var entered = input ? input.value : '';
      if (entered !== phrase) throw new Error('确认文字不匹配，未执行任何修改');
      if (submit) {
        submit.disabled = true;
        submit.textContent = '正在确认…';
      }
      await constructorJson('/api/constructor-agent/changes/' + encodeURIComponent(changeId) + '/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: constructorUserId(), stage: stage, confirmation: phrase })
      });
      closeConstructorApproval();
      constructorState.changeId = changeId;
      if (stage === 'plan') {
        await resumeConstructorPipeline(changeId);
        return;
      }
      await applyConstructorCoreChange(changeId);
    } catch (error) {
      if (submit) {
        submit.disabled = false;
        submit.textContent = '确认并继续';
      }
      setConstructorOutput(error.message || String(error), true);
    }
  }
  window.submitConstructorApproval = submitConstructorApproval;

  async function generateConstructorCoreProposal(changeId) {
    try {
      var data = await constructorJson('/api/constructor-agent/changes/' + encodeURIComponent(changeId) + '/core-proposal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: constructorUserId() })
      });
      constructorState.changeId = changeId;
      setConstructorOutput('核心改造隔离任务已启动：' + data.job.id + '\n它只会修改源码副本，完成后还需查看差异并第二次批准。');
      await refreshConstructorWorkspace();
    } catch (error) { setConstructorOutput(error.message || String(error), true); }
  }
  window.generateConstructorCoreProposal = generateConstructorCoreProposal;

  async function reviewConstructorCoreDiff(changeId) {
    try {
      var data = await constructorJson('/api/constructor-agent/changes/' + encodeURIComponent(changeId) + '/diff?userId=' + encodeURIComponent(constructorUserId()));
      setConstructorOutput({ changeId: changeId, total: data.diff.total, added: data.diff.added, modified: data.diff.modified, deleted: data.diff.deleted });
    } catch (error) { setConstructorOutput(error.message || String(error), true); }
  }
  window.reviewConstructorCoreDiff = reviewConstructorCoreDiff;

  async function applyConstructorCoreChange(changeId) {
    try {
      var data = await constructorJson('/api/constructor-agent/changes/' + encodeURIComponent(changeId) + '/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: constructorUserId() })
      });
      setConstructorOutput('核心修改正在应用并执行完整构建：' + data.job.id + '\n失败时会自动恢复刚才创建的回滚点。');
      await refreshConstructorWorkspace();
    } catch (error) { setConstructorOutput(error.message || String(error), true); }
  }
  window.applyConstructorCoreChange = applyConstructorCoreChange;

  async function rollbackConstructorCoreChange(changeId) {
    try {
      if (!window.confirm('确定恢复该变更应用前的版本吗？当前变更涉及的文件会被回滚点覆盖。')) return;
      await constructorJson('/api/constructor-agent/changes/' + encodeURIComponent(changeId) + '/rollback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: constructorUserId() })
      });
      setConstructorOutput('已恢复应用前的逐文件备份。请重启软件使后端代码完全重新加载。');
      await refreshConstructorWorkspace();
    } catch (error) { setConstructorOutput(error.message || String(error), true); }
  }
  window.rollbackConstructorCoreChange = rollbackConstructorCoreChange;

  async function scaffoldConstructorFeature() {
    try {
      var input = constructorForm();
      setConstructorOutput('正在生成安全骨架…');
      var data = await constructorJson('/api/constructor-agent/scaffold', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: constructorUserId(), request: input.request, featureId: input.featureId, name: input.name, version: '0.1.0' }) });
      constructorState.stagingDir = data.stagingDir;
      constructorState.featureId = input.featureId;
      setConstructorOutput('骨架已生成：' + data.stagingDir + '\n下一步可交给 Reasonix 完善，或直接校验安装预览版。');
    } catch (error) { setConstructorOutput(error.message || String(error), true); }
  }
  window.scaffoldConstructorFeature = scaffoldConstructorFeature;

  async function buildConstructorFeatureWithReasonix() {
    try {
      var input = constructorForm();
      if (!constructorState.stagingDir || constructorState.featureId !== input.featureId) await scaffoldConstructorFeature();
      if (!constructorState.stagingDir) return;
      var data = await constructorJson('/api/constructor-agent/executors/reasonix/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: constructorUserId(), featureId: input.featureId, request: input.request, stagingDir: constructorState.stagingDir, changeId: constructorState.changeId || undefined }) });
      setConstructorOutput('Reasonix 后台任务已启动：' + data.job.id + '\n可以离开本页面，任务状态会持久化。');
      await refreshConstructorWorkspace();
    } catch (error) { setConstructorOutput(error.message || String(error), true); }
  }
  window.buildConstructorFeatureWithReasonix = buildConstructorFeatureWithReasonix;

  async function installCurrentConstructorFeature() {
    try {
      if (!constructorState.stagingDir) throw new Error('请先生成安全骨架');
      await constructorJson('/api/constructor-agent/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: constructorUserId(), stagingDir: constructorState.stagingDir, enable: false }) });
      await refreshConstructorWorkspace();
      await loadConstructorFeatureRuntime();
    } catch (error) { setConstructorOutput(error.message || String(error), true); }
  }
  window.installCurrentConstructorFeature = installCurrentConstructorFeature;

  async function installReasonixExecutor() {
    try {
      await constructorJson('/api/constructor-agent/executors/reasonix/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: constructorUserId() }) });
      await refreshConstructorWorkspace();
    } catch (error) { alert(error.message || String(error)); }
  }
  window.installReasonixExecutor = installReasonixExecutor;

  async function toggleConstructorFeature(featureId, enabled) {
    try {
      await constructorJson('/api/constructor-agent/features/' + encodeURIComponent(featureId) + '/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: constructorUserId(), enabled: !!enabled }) });
      await refreshConstructorWorkspace();
      await loadConstructorFeatureRuntime();
    } catch (error) { alert(error.message || String(error)); }
  }
  window.toggleConstructorFeature = toggleConstructorFeature;

  async function rollbackConstructorFeature(featureId) {
    try {
      await constructorJson('/api/constructor-agent/features/' + encodeURIComponent(featureId) + '/rollback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: constructorUserId() }) });
      await refreshConstructorWorkspace();
      await loadConstructorFeatureRuntime();
    } catch (error) { alert(error.message || String(error)); }
  }
  window.rollbackConstructorFeature = rollbackConstructorFeature;

  async function removeConstructorFeature(featureId) {
    if (!confirm('卸载功能包“' + featureId + '”？功能会立即从界面消失。')) return;
    try {
      await constructorJson('/api/constructor-agent/features/' + encodeURIComponent(featureId) + '?userId=' + encodeURIComponent(constructorUserId()), { method: 'DELETE' });
      await refreshConstructorWorkspace();
      await loadConstructorFeatureRuntime();
    } catch (error) { alert(error.message || String(error)); }
  }
  window.removeConstructorFeature = removeConstructorFeature;

  async function showConstructorJobLog(jobId) {
    if (constructorState.activeJobId !== jobId) {
      constructorState.runLogScrollJobId = jobId;
      constructorState.runLogScrollTop = 0;
    }
    constructorState.activeJobId = jobId;
    constructorState.logExpanded = true;
    await refreshConstructorWorkspace();
  }
  window.showConstructorJobLog = showConstructorJobLog;

  function toggleConstructorRunLog() {
    constructorState.logExpanded = !constructorState.logExpanded;
    var log = document.querySelector('.constructor-run-log');
    var button = document.querySelector('.constructor-log-heading button');
    if (log) log.classList.toggle('collapsed', !constructorState.logExpanded);
    if (button) button.textContent = constructorState.logExpanded ? '收起' : '展开';
  }
  window.toggleConstructorRunLog = toggleConstructorRunLog;

  function scheduleConstructorPolling(jobs) {
    if (constructorState.pollTimer) clearTimeout(constructorState.pollTimer);
    var running = (jobs || []).some(function(job) { return job.status === 'queued' || job.status === 'running'; });
    if (!running) return;
    constructorState.pollTimer = setTimeout(function() {
      var page = document.getElementById('homeUtilityPage');
      if (page && page.dataset.pageId === 'constructor-agent') refreshConstructorWorkspace();
    }, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadConstructorFeatureRuntime, { once: true });
  } else {
    loadConstructorFeatureRuntime();
  }

  if (window.ScholarHarnessModules) {
    window.ScholarHarnessModules.register('constructor-agent', { source: '/app/constructor-agent.js' });
  }
})();
