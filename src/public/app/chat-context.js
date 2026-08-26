    var currentUserId = getUserId();
    var currentConversationId = null;  // 将在页面加载后恢复
    var needsFullPrompt = true; // 首次加载需要发送完整提示词
    var uploadedFiles = [];
    var apiConfig = { url: '', key: '', model: '' };
    var secondaryVisionApiConfig = { url: '', key: '', model: 'gpt-4o' };
    var currentModel = 'qwen3.5-plus';
    // 主聊天 reasoning_effort（low/medium/high）。从 /api/settings 同步，随聊天请求透传。
    var currentReasoningEffort = 'low';
    try {
      var savedMainChatReasoningEffort = localStorage.getItem('scholarharness_main_chat_reasoning_effort');
      if (savedMainChatReasoningEffort && ['low', 'medium', 'high'].indexOf(savedMainChatReasoningEffort) >= 0) {
        currentReasoningEffort = savedMainChatReasoningEffort;
      }
    } catch (e) {}
    var chatContainer = document.getElementById('chatContainer');
    var messagesDiv = document.getElementById('messages');
    var userInput = document.getElementById('userInput');
    var sendBtn = document.getElementById('sendBtn');
    var emptyState = document.getElementById('emptyState');
    var modelBadge = document.getElementById('modelBadge');
    var fileList = document.getElementById('fileList');
    var historyList = document.getElementById('historyList');
    var litInfo = document.getElementById('litInfo');
    var isGenerating = false;
    var mainChatExperimentUploadBusyOwner = false;
    var currentAbortController = null;
    var activeMainChatConversationId = null;
    var activeMainChatProjectId = null;
    var activeMainChatProvider = null;
    var activeMainChatWorkspaceSnapshot = null;
    var mainChatQueryQueue = [];
    var mainChatQueueDrainTimer = null;
    var mainChatPiQueueBehavior = localStorage.getItem('scholarharness_pi_queue_behavior') === 'steer' ? 'steer' : 'follow_up';
    var mainChatPiState = null;
    var mainChatPiPollTimer = null;
    var mainChatPiSyncInFlight = false;
    var mainChatPiClaimInFlight = false;
    var mainChatPiContinuationStarting = false;
    var mainChatPiQueueHostMessage = null;
    var mainChatAttachedRunId = '';
    var mainChatAttachedRunEventSequence = 0;
    var mainChatAttachedRunMessage = null;
    var mainChatAttachedRunText = '';
    var mainChatAttachedRunRenderer = null;
    // 多会话并行：登记所有正在运行的对话（conversationId -> abortController），
    // 让“这个对话在跑，我切去新对话做别的”成为可能。isGenerating 仍表示
    // “当前可视会话在跑”，用于按钮/输入框 UI；真正的运行登记在这里。
    var mainChatActiveRuns = new Map();
    var mainChatRunConversationByController = new Map();
    function getMainChatRunKey(conversationId, projectId) {
      var id = String(conversationId || currentConversationId || '');
      var resolvedProjectId = projectId !== undefined
        ? String(projectId || '')
        : (typeof getConversationHistoryProjectId === 'function' ? String(getConversationHistoryProjectId() || '') : '');
      return id ? (resolvedProjectId || 'current-workspace') + '\u0001' + id : '';
    }
    function isMainChatConversationRunning(conversationId, projectId) {
      var key = getMainChatRunKey(conversationId, projectId);
      return !!key && mainChatActiveRuns.has(key);
    }
    function registerMainChatActiveRun(conversationId, abortController, projectId) {
      var key = getMainChatRunKey(conversationId, projectId);
      if (!key || !abortController) return;
      mainChatActiveRuns.set(key, { abortController: abortController, projectId: projectId || '' });
      mainChatRunConversationByController.set(abortController, key);
    }
    function unregisterMainChatActiveRun(conversationId, abortController, projectId) {
      var key = getMainChatRunKey(conversationId, projectId);
      if (key) mainChatActiveRuns.delete(key);
      if (abortController) mainChatRunConversationByController.delete(abortController);
    }
    function releaseMainChatActiveRunByController(abortController) {
      var key = abortController ? mainChatRunConversationByController.get(abortController) : '';
      if (key) mainChatActiveRuns.delete(key);
      if (abortController) mainChatRunConversationByController.delete(abortController);
    }
    var mainContextSourceBarExpanded = false;
    var mainContextSourceBarHoverTimer = null;
    var chatTurnAnchorEl = null;
    var chatTurnScrollLocked = false;
    var chatAutoScrollEnabled = true;
    var chatStreamTailActive = false;
    var chatStreamTailPaused = false;
    var mainMetaAnalysisReturnContext = null;
    var mainAnalysisWorkflowReturnContext = null;
    var mainContextPlaceholderRequestId = 0;
    var MAIN_CONTEXT_SOURCE_DEFAULTS = {
      bibliometrics: false,
      metaAnalysis: false,
      autoResearch: false
    };
    var MAIN_CONTEXT_SOURCE_DEFS = [
      { id: 'bibliometrics', label: '文献计量结果', title: '持续使用当前项目的文献计量分析结果、图片和表格索引' },
      { id: 'metaAnalysis', label: 'Meta 分析结果', title: '持续使用 Meta 页面已提取的全部表格数据；从 Meta 页面进入时使用当时勾选的文献数据' },
      { id: 'autoResearch', label: 'Auto Research 结果', title: '持续使用当前项目最新 Auto Research 报告、证据、Wiki 和草稿框架' }
    ];
    var MAIN_CONTEXT_WORKSPACE_FOLDERS = {
      bibliometrics: '文献计量分析',
      metaAnalysis: 'Meta分析',
      autoResearch: 'Auto Research'
    };
    var queryNavRenderScheduled = false;
    var queryNavActiveUpdateScheduled = false;
    var queryNavObserver = null;
    var queryNavIdCounter = 0;
    var queryNavPinnedMessageId = '';

    function getQueryNavContext() {
      var metaRail = document.getElementById('metaAnalysisQueryNavRail');
      var metaOutput = document.getElementById('metaAnalysisAiOutput');
      var modalOverlay = document.getElementById('modalOverlay');
      var metaActive = !!(
        metaRail
        && metaOutput
        && modalOverlay
        && modalOverlay.classList.contains('show')
        && modalOverlay.classList.contains('meta-analysis-shared-composer-overlay')
      );
      if (metaActive) {
        return {
          rail: metaRail,
          messageRoot: metaOutput,
          scrollContainer: metaOutput,
          scope: 'meta-analysis'
        };
      }
      return {
        rail: document.getElementById('queryNavRail'),
        messageRoot: messagesDiv,
        scrollContainer: chatContainer,
        scope: 'main-chat'
      };
    }

    function getQueryNavRail() {
      return getQueryNavContext().rail;
    }

    function normalizeQueryNavText(value) {
      return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function getMessageTextForQueryNav(messageEl) {
      if (!messageEl) return '';
      var storedText = normalizeQueryNavText(messageEl.getAttribute('data-query-nav-text') || '');
      if (storedText) return storedText;
      var content = messageEl.querySelector('.content');
      if (content) {
        var contentClone = content.cloneNode(true);
        contentClone.querySelectorAll('.queued-query-meta, .message-footer, .msg-actions, .ai-disclaimer').forEach(function(node) {
          node.remove();
        });
        var fallbackText = normalizeQueryNavText(contentClone.textContent || '');
        if (fallbackText) {
          messageEl.setAttribute('data-query-nav-text', fallbackText);
          return fallbackText;
        }
      }
      return normalizeQueryNavText(messageEl.textContent || '');
    }

    function ensureQueryNavMessageId(messageEl) {
      if (!messageEl) return '';
      var existing = messageEl.getAttribute('data-query-nav-id');
      if (existing) return existing;
      queryNavIdCounter += 1;
      var id = 'query-nav-message-' + queryNavIdCounter;
      messageEl.setAttribute('data-query-nav-id', id);
      messageEl.id = id;
      return id;
    }

    function getQueryNavViewportLine(scrollContainer) {
      var containerRect = scrollContainer.getBoundingClientRect();
      var composer = scrollContainer === chatContainer
        ? document.getElementById('mainInputContainer')
        : document.querySelector('#modalOverlay.meta-analysis-shared-composer-overlay .meta-analysis-ai-composer');
      var visibleBottom = containerRect.bottom;
      if (composer && composer.getBoundingClientRect) {
        var composerRect = composer.getBoundingClientRect();
        if (composerRect.height > 0 && composerRect.top > containerRect.top) {
          visibleBottom = Math.min(visibleBottom, composerRect.top);
        }
      }
      return Math.max(containerRect.top + 32, visibleBottom - 16);
    }

    function getActiveQueryNavMessageId(userMessages, scrollContainer) {
      if (!scrollContainer || !userMessages.length) return '';
      if (queryNavPinnedMessageId && document.getElementById(queryNavPinnedMessageId)) {
        return queryNavPinnedMessageId;
      }
      var viewportLine = getQueryNavViewportLine(scrollContainer);
      var activeIndex = 0;
      var low = 0;
      var high = userMessages.length - 1;
      // Message positions are monotonic. Binary search avoids reading the layout
      // box of every historic query on each scroll event in long conversations.
      while (low <= high) {
        var middle = Math.floor((low + high) / 2);
        var messageRect = userMessages[middle].getBoundingClientRect();
        if (messageRect.top <= viewportLine) {
          activeIndex = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      var active = userMessages[activeIndex] || userMessages[0];
      return active ? ensureQueryNavMessageId(active) : '';
    }

    function updateQueryNavRailActiveState() {
      queryNavActiveUpdateScheduled = false;
      var context = getQueryNavContext();
      var rail = context.rail;
      if (!rail || !context.messageRoot || !context.scrollContainer) return;
      var userMessages = Array.prototype.slice.call(context.messageRoot.querySelectorAll('.message.user'));
      var activeId = getActiveQueryNavMessageId(userMessages, context.scrollContainer);
      var dotButtons = Array.prototype.slice.call(rail.querySelectorAll('.query-nav-dot'));
      var activeDotIndex = -1;
      dotButtons.forEach(function(button, index) {
        var isActive = button.getAttribute('data-query-target') === activeId;
        button.classList.toggle('active', isActive);
        button.classList.remove('active-neighbor', 'active-second-neighbor', 'active-third-neighbor');
        if (isActive) activeDotIndex = index;
      });
      if (activeDotIndex > 0) dotButtons[activeDotIndex - 1].classList.add('active-neighbor');
      if (activeDotIndex >= 0 && activeDotIndex < dotButtons.length - 1) {
        dotButtons[activeDotIndex + 1].classList.add('active-neighbor');
      }
      if (activeDotIndex > 1) dotButtons[activeDotIndex - 2].classList.add('active-second-neighbor');
      if (activeDotIndex >= 0 && activeDotIndex < dotButtons.length - 2) {
        dotButtons[activeDotIndex + 2].classList.add('active-second-neighbor');
      }
      if (activeDotIndex > 2) dotButtons[activeDotIndex - 3].classList.add('active-third-neighbor');
      if (activeDotIndex >= 0 && activeDotIndex < dotButtons.length - 3) {
        dotButtons[activeDotIndex + 3].classList.add('active-third-neighbor');
      }
    }

    function scheduleQueryNavActiveUpdate() {
      if (queryNavActiveUpdateScheduled) return;
      queryNavActiveUpdateScheduled = true;
      requestAnimationFrame(updateQueryNavRailActiveState);
    }

    function releaseQueryNavPinnedSelection() {
      if (!queryNavPinnedMessageId) return;
      queryNavPinnedMessageId = '';
      scheduleQueryNavActiveUpdate();
    }

    function setQueryNavHoverState(button) {
      if (!button) return;
      var track = button.closest ? button.closest('.query-nav-track') : null;
      if (!track) return;
      var dotButtons = Array.prototype.slice.call(track.querySelectorAll('.query-nav-dot'));
      dotButtons.forEach(function(dot) {
        dot.classList.remove('hover-focus', 'hover-neighbor', 'hover-second-neighbor', 'hover-third-neighbor');
      });
      var hoveredIndex = dotButtons.indexOf(button);
      if (hoveredIndex < 0) return;
      button.classList.add('hover-focus');
      if (hoveredIndex > 0) dotButtons[hoveredIndex - 1].classList.add('hover-neighbor');
      if (hoveredIndex < dotButtons.length - 1) dotButtons[hoveredIndex + 1].classList.add('hover-neighbor');
      if (hoveredIndex > 1) dotButtons[hoveredIndex - 2].classList.add('hover-second-neighbor');
      if (hoveredIndex < dotButtons.length - 2) dotButtons[hoveredIndex + 2].classList.add('hover-second-neighbor');
      if (hoveredIndex > 2) dotButtons[hoveredIndex - 3].classList.add('hover-third-neighbor');
      if (hoveredIndex < dotButtons.length - 3) dotButtons[hoveredIndex + 3].classList.add('hover-third-neighbor');
    }

    function clearQueryNavHoverState() {
      document.querySelectorAll('.query-nav-dot.hover-focus, .query-nav-dot.hover-neighbor, .query-nav-dot.hover-second-neighbor, .query-nav-dot.hover-third-neighbor').forEach(function(dot) {
        dot.classList.remove('hover-focus', 'hover-neighbor', 'hover-second-neighbor', 'hover-third-neighbor');
      });
    }

    function showQueryNavPreview(button, index) {
      setQueryNavHoverState(button);
      var rail = button && button.closest ? button.closest('.query-nav-rail') : null;
      var preview = rail ? rail.querySelector('.query-nav-preview') : null;
      if (!preview || !button) return;
      var targetId = button.getAttribute('data-query-target') || '';
      var messageEl = targetId ? document.getElementById(targetId) : null;
      var text = getMessageTextForQueryNav(messageEl) || '用户问题';
      preview.innerHTML = '' +
        '<span class="query-nav-preview-title">用户问题 ' + (Number(index || 0) + 1) + '</span>' +
        '<span class="query-nav-preview-text">' + escapeHtml(text) + '</span>';
      var rect = button.getBoundingClientRect();
      preview.style.right = Math.max(8, window.innerWidth - rect.left + 10) + 'px';
      preview.style.top = (rect.top + rect.height / 2) + 'px';
      preview.classList.add('visible');
      var halfHeight = Math.max(0, preview.offsetHeight / 2);
      var clampedTop = Math.max(12 + halfHeight, Math.min(window.innerHeight - 12 - halfHeight, rect.top + rect.height / 2));
      preview.style.top = clampedTop + 'px';
    }
    window.showQueryNavPreview = showQueryNavPreview;

    function hideQueryNavPreview() {
      clearQueryNavHoverState();
      document.querySelectorAll('.query-nav-preview.visible').forEach(function(preview) {
        preview.classList.remove('visible');
      });
    }
    window.hideQueryNavPreview = hideQueryNavPreview;

    function renderQueryNavRail() {
      queryNavRenderScheduled = false;
      var context = getQueryNavContext();
      var rail = context.rail;
      if (!rail || !context.messageRoot || !context.scrollContainer) return;
      var userMessages = Array.prototype.slice.call(context.messageRoot.querySelectorAll('.message.user'));
      if (!userMessages.length) {
        rail.classList.add('empty');
        rail.innerHTML = '';
        return;
      }

      var signature = userMessages.map(ensureQueryNavMessageId).join('|');
      var existingTrack = rail.querySelector('.query-nav-track');
      if (existingTrack && existingTrack.getAttribute('data-query-signature') === signature) {
        rail.classList.remove('empty');
        scheduleQueryNavActiveUpdate();
        return;
      }

      var activeId = getActiveQueryNavMessageId(userMessages, context.scrollContainer);
      var activeDotIndex = userMessages.findIndex(function(messageEl) {
        return ensureQueryNavMessageId(messageEl) === activeId;
      });
      var dots = userMessages.map(function(messageEl, index) {
        var id = ensureQueryNavMessageId(messageEl);
        var activeClass = id === activeId ? ' active' : '';
        var neighborClass = activeDotIndex >= 0 && Math.abs(index - activeDotIndex) === 1 ? ' active-neighbor' : '';
        var secondNeighborClass = activeDotIndex >= 0 && Math.abs(index - activeDotIndex) === 2 ? ' active-second-neighbor' : '';
        var thirdNeighborClass = activeDotIndex >= 0 && Math.abs(index - activeDotIndex) === 3 ? ' active-third-neighbor' : '';
        return '' +
          '<button type="button" class="query-nav-dot' + activeClass + neighborClass + secondNeighborClass + thirdNeighborClass + '" data-query-target="' + id + '" ' +
            'onmouseenter="showQueryNavPreview(this,' + index + ')" onmouseleave="hideQueryNavPreview()" ' +
            'onfocus="showQueryNavPreview(this,' + index + ')" onblur="hideQueryNavPreview()" ' +
            'onclick="scrollToQueryNavMessage(\'' + id + '\')" aria-label="跳转到用户问题 ' + (index + 1) + '"></button>';
      }).join('');
      var previewId = context.scope === 'meta-analysis' ? 'metaAnalysisQueryNavPreview' : 'queryNavPreview';
      rail.innerHTML = '<div class="query-nav-track" data-query-signature="' + escapeHtml(signature) + '">' + dots + '</div>' +
        '<div class="query-nav-preview" id="' + previewId + '" role="tooltip"></div>';
      rail.classList.remove('empty');
    }

    function scheduleQueryNavRender() {
      if (queryNavRenderScheduled) return;
      queryNavRenderScheduled = true;
      requestAnimationFrame(renderQueryNavRail);
    }
    window.scheduleQueryNavRender = scheduleQueryNavRender;

    function scrollToQueryNavMessage(id) {
      var messageEl = document.getElementById(id);
      if (!messageEl) return;
      var context = getQueryNavContext();
      var scrollContainer = context.scrollContainer;
      if (!scrollContainer) return;
      if (context.scope === 'main-chat') clearChatTurnScrollLock();
      queryNavPinnedMessageId = id;
      updateQueryNavRailActiveState();
      try {
        var containerRect = scrollContainer.getBoundingClientRect();
        var messageRect = messageEl.getBoundingClientRect();
        var messageTopInContainer = scrollContainer.scrollTop + (messageRect.top - containerRect.top);
        var targetScrollTop = Math.max(0, messageTopInContainer - scrollContainer.clientHeight * 0.22);
        scrollContainer.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
      } catch (e) {
        messageEl.scrollIntoView({ block: 'start' });
      }
    }
    window.scrollToQueryNavMessage = scrollToQueryNavMessage;

    function bindMetaAnalysisQueryNavRail() {
      var metaOutput = document.getElementById('metaAnalysisAiOutput');
      var overlay = document.getElementById('modalOverlay');
      if (!metaOutput || !overlay) return;
      var rail = document.getElementById('metaAnalysisQueryNavRail');
      if (!rail) {
        rail = document.createElement('div');
        rail.className = 'query-nav-rail empty';
        rail.id = 'metaAnalysisQueryNavRail';
        rail.setAttribute('aria-label', 'Meta 分析用户 query 导航');
        overlay.appendChild(rail);
      }
      if (metaOutput.dataset.queryNavBound === '1') {
        scheduleQueryNavRender();
        return;
      }
      metaOutput.dataset.queryNavBound = '1';
      var observer = new MutationObserver(scheduleQueryNavRender);
      observer.observe(metaOutput, { childList: true, subtree: false });
      metaOutput._queryNavObserver = observer;
      metaOutput.addEventListener('scroll', function() {
        hideQueryNavPreview();
        scheduleQueryNavActiveUpdate();
      }, { passive: true });
      metaOutput.addEventListener('wheel', releaseQueryNavPinnedSelection, { passive: true });
      metaOutput.addEventListener('touchstart', releaseQueryNavPinnedSelection, { passive: true });
      metaOutput.addEventListener('pointerdown', releaseQueryNavPinnedSelection, { passive: true });
      scheduleQueryNavRender();
    }
    window.bindMetaAnalysisQueryNavRail = bindMetaAnalysisQueryNavRail;

    function initQueryNavRail() {
      if (!messagesDiv || queryNavObserver) return;
      queryNavObserver = new MutationObserver(scheduleQueryNavRender);
      queryNavObserver.observe(messagesDiv, { childList: true, subtree: false });
      if (chatContainer) {
        chatContainer.addEventListener('scroll', function() {
          hideQueryNavPreview();
          // Streaming auto-scroll can fire dozens of scroll events per second.
          // Defer historic-message geometry reads until the user scrolls away.
          if (chatStreamTailActive && !chatStreamTailPaused) return;
          scheduleQueryNavActiveUpdate();
        }, { passive: true });
        chatContainer.addEventListener('wheel', releaseQueryNavPinnedSelection, { passive: true });
        chatContainer.addEventListener('touchstart', releaseQueryNavPinnedSelection, { passive: true });
        chatContainer.addEventListener('pointerdown', releaseQueryNavPinnedSelection, { passive: true });
      }
      document.addEventListener('keydown', function(event) {
        var target = event.target;
        if (
          target &&
          target.closest &&
          target.closest('textarea, input, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')
        ) {
          return;
        }
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
          releaseQueryNavPinnedSelection();
        }
      });
      window.addEventListener('resize', scheduleQueryNavRender);
      scheduleQueryNavRender();
    }

    function getMainContextProjectKeyPart() {
      var project = (typeof projectManagerCurrentProject !== 'undefined' && projectManagerCurrentProject) ? projectManagerCurrentProject : null;
      if (project && project.isArchivedProject && project.projectId) return String(project.projectId);
      return 'current-workspace';
    }

    function getMainContextSourceStorageKey() {
      return 'scholarharness_main_context_sources_' + (currentUserId || 'web-user') + '_' + getMainContextProjectKeyPart();
    }

    function getMainMetaAnalysisDataScopeStorageKey() {
      return 'scholarharness_main_meta_data_scope_' + (currentUserId || 'web-user') + '_' + getMainContextProjectKeyPart();
    }

    function normalizeMainMetaAnalysisDataScope(value) {
      var source = value && typeof value === 'object' ? value : {};
      var mode = source.mode === 'selected' ? 'selected' : 'all';
      var seen = {};
      var pdfIds = (Array.isArray(source.pdfIds) ? source.pdfIds : [])
        .map(function(value) { return String(value || '').trim(); })
        .filter(function(value) {
          if (!value || seen[value]) return false;
          seen[value] = true;
          return true;
        });
      if (mode === 'selected' && pdfIds.length === 0) mode = 'all';
      return {
        mode: mode,
        pdfIds: mode === 'selected' ? pdfIds : [],
        source: mode === 'selected' ? 'meta-page-selection' : 'homepage-all-meta-data',
        updatedAt: String(source.updatedAt || '')
      };
    }

    function loadMainMetaAnalysisDataScope() {
      try {
        return normalizeMainMetaAnalysisDataScope(
          JSON.parse(localStorage.getItem(getMainMetaAnalysisDataScopeStorageKey()) || '{}')
        );
      } catch (error) {
        return normalizeMainMetaAnalysisDataScope(null);
      }
    }

    function saveMainMetaAnalysisDataScope(value) {
      var normalized = normalizeMainMetaAnalysisDataScope(value);
      normalized.updatedAt = new Date().toISOString();
      try {
        localStorage.setItem(getMainMetaAnalysisDataScopeStorageKey(), JSON.stringify(normalized));
      } catch (error) {}
      return normalized;
    }

    function selectAllMainMetaAnalysisData() {
      return saveMainMetaAnalysisDataScope({
        mode: 'all',
        pdfIds: [],
        source: 'homepage-all-meta-data'
      });
    }

    function selectMainMetaAnalysisPdfData(pdfIds) {
      return saveMainMetaAnalysisDataScope({
        mode: 'selected',
        pdfIds: pdfIds,
        source: 'meta-page-selection'
      });
    }

    function clearMainMetaAnalysisDataScope() {
      try {
        localStorage.removeItem(getMainMetaAnalysisDataScopeStorageKey());
      } catch (error) {}
    }

    function getDefaultMainChatInputPlaceholder() {
      return activePdfPaperChatContext
        ? '询问当前论文，或继续使用主页完整聊天能力'
        : ' ';
    }

    function restoreDefaultMainChatInputPlaceholder() {
      mainContextPlaceholderRequestId += 1;
      if (userInput) userInput.placeholder = getDefaultMainChatInputPlaceholder();
    }

    async function syncMainMetaAnalysisInputPlaceholder() {
      var requestId = ++mainContextPlaceholderRequestId;
      var selection = loadMainContextSourceSelection();
      if (!selection.metaAnalysis) {
        if (userInput) userInput.placeholder = getDefaultMainChatInputPlaceholder();
        return null;
      }

      var scope = loadMainMetaAnalysisDataScope();
      if (scope.mode === 'selected') {
        if (userInput) {
          userInput.placeholder = '请描述要对已选 ' + scope.pdfIds.length + ' 篇文献的提取数据执行的 Meta 分析';
        }
        return {
          selectionMode: 'selected',
          pdfCount: scope.pdfIds.length,
          rowCount: null
        };
      }

      if (userInput) {
        userInput.placeholder = '默认使用 Meta 分析数据库中的全部数据，请描述要对已选数据执行的 Meta 分析';
      }
      try {
        var datasetContext = await loadMainMetaAnalysisDatasetContext(
          getWorkspaceDirectoryPayload(currentConversationId)
        );
        if (requestId !== mainContextPlaceholderRequestId) return null;
        var latestSelection = loadMainContextSourceSelection();
        var latestScope = loadMainMetaAnalysisDataScope();
        if (!latestSelection.metaAnalysis || latestScope.mode !== 'all') return null;
        var rowCount = datasetContext && datasetContext.dataset
          ? Number(datasetContext.dataset.rowCount || 0)
          : 0;
        if (userInput) {
          userInput.placeholder =
            '默认使用 Meta 分析数据库中 ' + rowCount +
            ' 条数据（所有数据），请描述要对已选数据执行的 Meta 分析';
        }
        return {
          selectionMode: 'all',
          pdfCount: datasetContext && datasetContext.dataset
            ? Number(datasetContext.dataset.pdfCount || 0)
            : 0,
          rowCount: rowCount
        };
      } catch (error) {
        if (requestId === mainContextPlaceholderRequestId && userInput) {
          userInput.placeholder =
            '默认使用 Meta 分析数据库中的全部数据，请描述要对已选数据执行的 Meta 分析';
        }
        console.warn('[MetaAnalysis] Failed to update homepage Meta placeholder:', error);
        return null;
      }
    }

    function getBibliometricsRecordCount(context) {
      var dataset = context && context.dataset && typeof context.dataset === 'object'
        ? context.dataset
        : {};
      if (Array.isArray(dataset.records)) return dataset.records.length;
      var summary = dataset.summary && typeof dataset.summary === 'object' ? dataset.summary : {};
      return Number(summary.total || dataset.recordCount || dataset.totalRecords || 0);
    }

    async function syncMainBibliometricsInputPlaceholder() {
      var requestId = ++mainContextPlaceholderRequestId;
      var selection = loadMainContextSourceSelection();
      if (!selection.bibliometrics) {
        if (userInput) userInput.placeholder = getDefaultMainChatInputPlaceholder();
        return null;
      }
      var fromWorkflowPage = mainAnalysisWorkflowReturnContext
        && mainAnalysisWorkflowReturnContext.sourceId === 'bibliometrics';
      if (userInput) {
        userInput.placeholder = fromWorkflowPage
          ? '请描述要基于当前文献计量分析结果执行的任务'
          : '默认使用文献计量数据库中的所有数据，请描述要对已选文献计量结果执行的任务';
      }
      try {
        var context = await loadBibliometricsWritingContext();
        if (requestId !== mainContextPlaceholderRequestId) return null;
        if (!loadMainContextSourceSelection().bibliometrics) return null;
        var recordCount = getBibliometricsRecordCount(context);
        if (userInput) {
          userInput.placeholder = fromWorkflowPage
            ? '请描述要基于当前文献计量分析结果执行的任务（' + recordCount + ' 条文献）'
            : '默认使用文献计量数据库中 ' + recordCount +
              ' 条文献（所有数据），请描述要对已选文献计量结果执行的任务';
        }
        return {
          recordCount: recordCount,
          figureCount: context && Array.isArray(context.figures) ? context.figures.length : 0,
          tableCount: context && Array.isArray(context.tables) ? context.tables.length : 0
        };
      } catch (error) {
        if (requestId === mainContextPlaceholderRequestId && userInput) {
          userInput.placeholder = fromWorkflowPage
            ? '请描述要基于当前文献计量分析结果执行的任务'
            : '默认使用文献计量数据库中的所有数据，请描述要对已选文献计量结果执行的任务';
        }
        console.warn('[Bibliometrics] Failed to update homepage placeholder:', error);
        return null;
      }
    }

    async function syncMainAutoResearchInputPlaceholder() {
      var requestId = ++mainContextPlaceholderRequestId;
      var selection = loadMainContextSourceSelection();
      if (!selection.autoResearch) {
        if (userInput) userInput.placeholder = getDefaultMainChatInputPlaceholder();
        return null;
      }
      var fromWorkflowPage = mainAnalysisWorkflowReturnContext
        && mainAnalysisWorkflowReturnContext.sourceId === 'autoResearch';
      if (userInput) {
        userInput.placeholder = fromWorkflowPage
          ? '请描述要基于当前 Auto Research 结果执行的任务'
          : '默认使用 Auto Research 的全部结果，请描述要对已选结果执行的任务';
      }
      try {
        var context = await loadAutoResearchWritingContext();
        if (requestId !== mainContextPlaceholderRequestId) return null;
        if (!loadMainContextSourceSelection().autoResearch) return null;
        var dataset = context && context.dataset && typeof context.dataset === 'object'
          ? context.dataset
          : {};
        var literatureCount = Number(dataset.literatureNodeCount || 0);
        var evidenceCount = Number(dataset.evidenceObjectCount || 0);
        if (userInput) {
          userInput.placeholder = fromWorkflowPage
            ? '请描述要基于当前 Auto Research 结果执行的任务（文献 ' +
              literatureCount + '，证据 ' + evidenceCount + '）'
            : '默认使用 Auto Research 中 ' + literatureCount + ' 个文献节点、' +
              evidenceCount + ' 个证据对象（所有结果），请描述要对已选结果执行的任务';
        }
        return {
          literatureCount: literatureCount,
          evidenceCount: evidenceCount,
          finalReportCount: Number(dataset.finalReportCount || 0)
        };
      } catch (error) {
        if (requestId === mainContextPlaceholderRequestId && userInput) {
          userInput.placeholder = fromWorkflowPage
            ? '请描述要基于当前 Auto Research 结果执行的任务'
            : '默认使用 Auto Research 的全部结果，请描述要对已选结果执行的任务';
        }
        console.warn('[AutoResearch] Failed to update homepage placeholder:', error);
        return null;
      }
    }

    async function syncMainSelectedAnalysisInputPlaceholder(preferredSourceId) {
      var selection = loadMainContextSourceSelection();
      var selectedSourceIds = MAIN_CONTEXT_SOURCE_DEFS
        .map(function(item) { return item.id; })
        .filter(function(sourceId) { return selection[sourceId] === true; });
      if (selectedSourceIds.length > 1) {
        mainContextPlaceholderRequestId += 1;
        var selectedLabels = selectedSourceIds.map(function(sourceId) {
          return getMainContextSourceLabel(sourceId);
        });
        if (userInput) {
          userInput.placeholder =
            '本轮将同时调用 ' + selectedLabels.join('、') +
            ' 的相应数据，请描述要执行的联合分析或写作任务';
        }
        return {
          mode: 'combined',
          sourceIds: selectedSourceIds,
          labels: selectedLabels
        };
      }
      var sourceId = preferredSourceId && selection[preferredSourceId]
        ? preferredSourceId
        : (selection.metaAnalysis
          ? 'metaAnalysis'
          : (selection.bibliometrics ? 'bibliometrics' : (selection.autoResearch ? 'autoResearch' : '')));
      if (sourceId === 'metaAnalysis') return syncMainMetaAnalysisInputPlaceholder();
      if (sourceId === 'bibliometrics') return syncMainBibliometricsInputPlaceholder();
      if (sourceId === 'autoResearch') return syncMainAutoResearchInputPlaceholder();
      restoreDefaultMainChatInputPlaceholder();
      return null;
    }

    function getMainMetaAnalysisReturnStorageKey(conversationId) {
      return 'scholarharness_main_meta_return_' + (currentUserId || 'web-user') + '_' + String(conversationId || 'current');
    }

    function normalizeMainMetaAnalysisReturnContext(value) {
      if (!value || typeof value !== 'object') return null;
      var pdfIds = normalizeMainMetaAnalysisDataScope({
        mode: 'selected',
        pdfIds: value.pdfIds
      }).pdfIds;
      if (pdfIds.length === 0) return null;
      return {
        conversationId: String(value.conversationId || ''),
        pdfIds: pdfIds,
        selectedPdfId: String(value.selectedPdfId || pdfIds[0] || ''),
        searchTerm: String(value.searchTerm || ''),
        createdAt: String(value.createdAt || new Date().toISOString())
      };
    }

    function loadMainMetaAnalysisReturnContext(conversationId) {
      try {
        return normalizeMainMetaAnalysisReturnContext(
          JSON.parse(localStorage.getItem(getMainMetaAnalysisReturnStorageKey(conversationId)) || 'null')
        );
      } catch (error) {
        return null;
      }
    }

    function setMainMetaAnalysisReturnContext(value) {
      mainMetaAnalysisReturnContext = normalizeMainMetaAnalysisReturnContext(value);
      var key = getMainMetaAnalysisReturnStorageKey(currentConversationId);
      try {
        if (mainMetaAnalysisReturnContext) {
          localStorage.setItem(key, JSON.stringify(mainMetaAnalysisReturnContext));
        } else {
          localStorage.removeItem(key);
        }
      } catch (error) {}
      renderMainMetaAnalysisReturnBar();
      return mainMetaAnalysisReturnContext;
    }

    function renderMainMetaAnalysisReturnBar() {
      var bar = document.getElementById('metaAnalysisChatReturnBar');
      if (!bar) return;
      var context = normalizeMainMetaAnalysisReturnContext(mainMetaAnalysisReturnContext);
      var belongsToCurrentConversation = context && (
        !context.conversationId
        || !currentConversationId
        || context.conversationId === currentConversationId
      );
      if (!belongsToCurrentConversation) {
        bar.hidden = true;
        bar.innerHTML = '';
        return;
      }
      bar.hidden = false;
      bar.innerHTML =
        '<button type="button" class="pdf-paper-chat-return-btn" onclick="returnToMainMetaAnalysisSource()" title="返回 Meta 分析">' +
          '<span>返回 Meta 分析</span>' +
        '</button>';
    }

    window.returnToMainMetaAnalysisSource = async function() {
      var context = normalizeMainMetaAnalysisReturnContext(mainMetaAnalysisReturnContext);
      if (!context) return;
      pdfWikiMetaSelectedDataPdfIds = {};
      context.pdfIds.forEach(function(pdfId) {
        pdfWikiMetaSelectedDataPdfIds[pdfId] = true;
      });
      pdfWikiMetaSearchTerm = context.searchTerm || '';
      pdfWikiMetaSelectedPdfId = context.selectedPdfId || context.pdfIds[0] || null;
      setMainMetaAnalysisReturnContext(null);
      await window.showPdfWikiMetaDatabase({
        preserveOverviewReturn: true
      });
      if (pdfWikiMetaDatabaseData) renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
    };

    function getMainAnalysisWorkflowReturnStorageKey(conversationId) {
      return 'scholarharness_main_analysis_return_' +
        (currentUserId || 'web-user') + '_' + String(conversationId || 'current');
    }

    function normalizeMainAnalysisWorkflowReturnContext(value) {
      if (!value || typeof value !== 'object') return null;
      var sourceId = value.sourceId === 'bibliometrics'
        ? 'bibliometrics'
        : (value.sourceId === 'autoResearch' ? 'autoResearch' : '');
      if (!sourceId) return null;
      return {
        sourceId: sourceId,
        conversationId: String(value.conversationId || ''),
        createdAt: String(value.createdAt || new Date().toISOString())
      };
    }

    function loadMainAnalysisWorkflowReturnContext(conversationId) {
      try {
        return normalizeMainAnalysisWorkflowReturnContext(
          JSON.parse(localStorage.getItem(getMainAnalysisWorkflowReturnStorageKey(conversationId)) || 'null')
        );
      } catch (error) {
        return null;
      }
    }

    function setMainAnalysisWorkflowReturnContext(value) {
      mainAnalysisWorkflowReturnContext = normalizeMainAnalysisWorkflowReturnContext(value);
      var key = getMainAnalysisWorkflowReturnStorageKey(currentConversationId);
      try {
        if (mainAnalysisWorkflowReturnContext) {
          localStorage.setItem(key, JSON.stringify(mainAnalysisWorkflowReturnContext));
        } else {
          localStorage.removeItem(key);
        }
      } catch (error) {}
      renderMainAnalysisWorkflowReturnBar();
      return mainAnalysisWorkflowReturnContext;
    }

    function renderMainAnalysisWorkflowReturnBar() {
      var bar = document.getElementById('analysisWorkflowChatReturnBar');
      if (!bar) return;
      var context = normalizeMainAnalysisWorkflowReturnContext(mainAnalysisWorkflowReturnContext);
      var belongsToCurrentConversation = context && (
        !context.conversationId
        || !currentConversationId
        || context.conversationId === currentConversationId
      );
      if (!belongsToCurrentConversation) {
        bar.hidden = true;
        bar.innerHTML = '';
        return;
      }
      var label = context.sourceId === 'bibliometrics'
        ? '返回文献计量分析'
        : '返回 Auto Research';
      bar.hidden = false;
      bar.innerHTML =
        '<button type="button" class="pdf-paper-chat-return-btn" ' +
          'onclick="returnToMainAnalysisWorkflowSource()" title="' + escapeHtml(label) + '">' +
          '<span>' + escapeHtml(label) + '</span>' +
        '</button>';
    }

    window.returnToMainAnalysisWorkflowSource = async function() {
      var context = normalizeMainAnalysisWorkflowReturnContext(mainAnalysisWorkflowReturnContext);
      if (!context) return;
      setMainAnalysisWorkflowReturnContext(null);
      if (context.sourceId === 'bibliometrics') {
        if (typeof window.showBibliometricsDialog === 'function') {
          await window.showBibliometricsDialog({});
        }
        return;
      }
      if (context.sourceId === 'autoResearch' && typeof window.showAutoResearchMode === 'function') {
        await window.showAutoResearchMode({});
      }
    };

    window.activateMainAnalysisWorkflowHandoff = async function(sourceId) {
      if (sourceId !== 'bibliometrics' && sourceId !== 'autoResearch') return false;
      setMainContextSourceSelected(sourceId, true);
      setMainMetaAnalysisReturnContext(null);
      setMainAnalysisWorkflowReturnContext({
        sourceId: sourceId,
        conversationId: currentConversationId || ''
      });
      collapseMainContextSourceBar();
      renderMainContextSourceBar();
      await syncMainSelectedAnalysisInputPlaceholder(sourceId);
      await prepareSelectedAnalysisWorkspaceFolders(
        getWorkspaceDirectoryPayload(currentConversationId),
        null,
        null,
        sourceId
      );
      return true;
    };

    function getMainContextSkillStorageKey() {
      return 'scholarharness_main_context_skills_' + (currentUserId || 'web-user') + '_' + getMainContextProjectKeyPart();
    }

    function normalizeMainContextSourceSelection(value) {
      var selection = Object.assign({}, MAIN_CONTEXT_SOURCE_DEFAULTS);
      if (value && typeof value === 'object') {
        Object.keys(MAIN_CONTEXT_SOURCE_DEFAULTS).forEach(function(key) {
          selection[key] = value[key] === true;
        });
      }
      return selection;
    }

    function loadMainContextSourceSelection() {
      try {
        return normalizeMainContextSourceSelection(JSON.parse(localStorage.getItem(getMainContextSourceStorageKey()) || '{}'));
      } catch (e) {
        return normalizeMainContextSourceSelection(null);
      }
    }

    function saveMainContextSourceSelection(selection) {
      try {
        localStorage.setItem(getMainContextSourceStorageKey(), JSON.stringify(normalizeMainContextSourceSelection(selection)));
      } catch (e) {}
    }

    function setMainContextSourceSelected(sourceId, selected) {
      if (!Object.prototype.hasOwnProperty.call(MAIN_CONTEXT_SOURCE_DEFAULTS, sourceId)) return false;
      var selection = loadMainContextSourceSelection();
      selection[sourceId] = selected === true;
      saveMainContextSourceSelection(selection);
      renderMainContextSourceBar();
      return selection[sourceId];
    }
    window.setMainContextSourceSelected = setMainContextSourceSelected;

    function getMainContextSourceLabel(sourceId) {
      var def = MAIN_CONTEXT_SOURCE_DEFS.find(function(item) { return item.id === sourceId; });
      return def ? def.label : String(sourceId || '');
    }

    function createMainContextSourceStatus(selectedContextSources) {
      return {
        selectedSources: normalizeMainContextSourceSelection(selectedContextSources),
        attached: [],
        missing: []
      };
    }

    function pushMainContextStatusEntry(context, listName, entry) {
      if (!context.contextSourceStatus) {
        context.contextSourceStatus = createMainContextSourceStatus(context.selectedContextSources || {});
      }
      if (!Array.isArray(context.contextSourceStatus[listName])) {
        context.contextSourceStatus[listName] = [];
      }
      context.contextSourceStatus[listName].push({
        id: entry.id || '',
        label: entry.label || entry.id || '',
        detail: entry.detail || '',
        reason: entry.reason || ''
      });
    }

    function markMainContextAttached(context, id, label, detail) {
      pushMainContextStatusEntry(context, 'attached', { id: id, label: label, detail: detail || '' });
    }

    function markMainContextMissing(context, id, label, reason) {
      pushMainContextStatusEntry(context, 'missing', { id: id, label: label, reason: reason || '未找到可用内容' });
    }

    var MAIN_CONTEXT_WRITING_SKILL_DEFS = [
      { token: 'skill:title', type: 'title', label: '标题' },
      { token: 'skill:abstract', type: 'abstract', label: '摘要' },
      { token: 'skill:introduction', type: 'introduction', label: '引言' },
      { token: 'skill:methods', type: 'methods', label: '方法' },
      { token: 'skill:results', type: 'results', label: '结果' },
      { token: 'skill:discussion', type: 'discussion', label: '讨论' },
      { token: 'skill:conclusion', type: 'conclusion', label: '结论' },
      { token: 'skill:reference-relevance', type: 'reference-relevance', label: '引用相关性' }
    ];
    var MAIN_CONTEXT_STYLE_SECTIONS = ['abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusion'];
    var MAIN_CONTEXT_STYLE_SECTION_LABELS = {
      abstract: '摘要',
      introduction: '引言',
      methods: '方法',
      results: '结果',
      discussion: '讨论',
      conclusion: '结论'
    };
    var mainContextJournalStylesCache = [];
    var mainContextJournalStylesLoaded = false;

    function normalizeMainContextSkillSelectionItem(item) {
      if (!item) return '';
      if (typeof item === 'object') {
        if (item.token) return normalizeMainContextSkillSelectionItem(item.token);
        if (item.kind === 'skill' && item.id) return 'skill:' + normalizeSkillChapterType(item.id);
        if (item.kind === 'style' && item.journalId && item.section) {
          return 'style:' + String(item.journalId).trim() + ':' + String(item.section).trim().toLowerCase();
        }
        if (item.kind === 'user' && item.id) return 'user:' + String(item.id).trim();
        if (item.kind === 'agent' && item.id) return 'agent:' + String(item.id).trim();
        return '';
      }
      var raw = String(item || '').trim();
      if (!raw) return '';
      raw = raw.replace(/^\/\+?/, '');
      if (raw.indexOf('skill:') === 0) {
        return 'skill:' + normalizeSkillChapterType(raw.slice(6));
      }
      if (raw.indexOf('style:') === 0) {
        var styleRaw = raw.slice(6);
        var sep = styleRaw.lastIndexOf(':');
        if (sep > 0 && sep < styleRaw.length - 1) {
          return 'style:' + styleRaw.slice(0, sep).trim() + ':' + styleRaw.slice(sep + 1).trim().toLowerCase();
        }
        return '';
      }
      if (raw.indexOf('user:') === 0) {
        return raw.slice(5).trim() ? ('user:' + raw.slice(5).trim()) : '';
      }
      if (raw.indexOf('agent:') === 0) {
        return raw.slice(6).trim() ? ('agent:' + raw.slice(6).trim()) : '';
      }
      // Backward compatibility: older versions stored bare user Skill ids.
      return 'user:' + raw;
    }

    function parseMainContextSkillToken(token) {
      var normalized = normalizeMainContextSkillSelectionItem(token);
      if (!normalized) return null;
      if (normalized.indexOf('skill:') === 0) {
        var skillType = normalizeSkillChapterType(normalized.slice(6));
        return { kind: 'skill', id: skillType, token: 'skill:' + skillType };
      }
      if (normalized.indexOf('style:') === 0) {
        var styleRaw = normalized.slice(6);
        var sep = styleRaw.lastIndexOf(':');
        if (sep <= 0 || sep >= styleRaw.length - 1) return null;
        return {
          kind: 'style',
          journalId: styleRaw.slice(0, sep),
          section: styleRaw.slice(sep + 1),
          token: normalized
        };
      }
      if (normalized.indexOf('user:') === 0) {
        var userSkillId = normalized.slice(5);
        return userSkillId ? { kind: 'user', id: userSkillId, token: normalized } : null;
      }
      if (normalized.indexOf('agent:') === 0) {
        var agentSkillId = normalized.slice(6);
        return agentSkillId ? { kind: 'agent', id: agentSkillId, token: normalized } : null;
      }
      return null;
    }

    function normalizeMainContextSkillSelection(value) {
      var items = Array.isArray(value) ? value : [];
      var unique = [];
      var seen = new Set();
      items.forEach(function(item) {
        var parsed = parseMainContextSkillToken(item);
        if (!parsed || seen.has(parsed.token)) return;
        seen.add(parsed.token);
        unique.push(parsed.token);
      });
      return unique;
    }

    function loadMainContextSkillSelection() {
      try {
        return normalizeMainContextSkillSelection(JSON.parse(localStorage.getItem(getMainContextSkillStorageKey()) || '[]'));
      } catch (e) {
        return [];
      }
    }

    function saveMainContextSkillSelection(skillTokens) {
      var uniqueTokens = normalizeMainContextSkillSelection(skillTokens);
      try {
        localStorage.setItem(getMainContextSkillStorageKey(), JSON.stringify(uniqueTokens));
      } catch (e) {}
      return uniqueTokens;
    }

    function getMainContextWritingSkillDef(type) {
      var normalized = normalizeSkillChapterType(type);
      return MAIN_CONTEXT_WRITING_SKILL_DEFS.find(function(item) { return item.type === normalized; }) || null;
    }

    function getMainContextStyleSectionLabel(section) {
      return MAIN_CONTEXT_STYLE_SECTION_LABELS[String(section || '').toLowerCase()] || String(section || '');
    }

    function findMainContextJournalStyle(journalId) {
      return (Array.isArray(mainContextJournalStylesCache) ? mainContextJournalStylesCache : []).find(function(journal) {
        return journal && String(journal.id || '') === String(journalId || '');
      }) || null;
    }

    function findMainContextUserSkill(skillId) {
      return (Array.isArray(userSkillManagerSkills) ? userSkillManagerSkills : []).find(function(skill) {
        return skill && String(skill.id || '') === String(skillId || '');
      }) || null;
    }

    function getMainContextSkillLabel(token) {
      var parsed = parseMainContextSkillToken(token);
      if (!parsed) return '';
      if (parsed.kind === 'skill') {
        var def = getMainContextWritingSkillDef(parsed.id);
        return (def ? def.label : parsed.id) + ' Skill';
      }
      if (parsed.kind === 'style') {
        var journal = findMainContextJournalStyle(parsed.journalId);
        var journalName = journal ? (journal.name || journal.id) : '写作风格';
        return journalName + '-' + getMainContextStyleSectionLabel(parsed.section);
      }
      if (parsed.kind === 'user') {
        var userSkill = findMainContextUserSkill(parsed.id);
        return userSkill && userSkill.trigger ? ('/' + userSkill.trigger) : '用户 Skill';
      }
      if (parsed.kind === 'agent') {
        var agentSkill = (Array.isArray(availableAgentSkills) ? availableAgentSkills : []).find(function(skill) {
          return skill && String(skill.id || '') === String(parsed.id || '');
        });
        return agentSkill ? (agentSkill.name || agentSkill.id) : '系统自带 Skill';
      }
      return '';
    }

    function getMainContextSkillDescription(token) {
      var parsed = parseMainContextSkillToken(token);
      if (!parsed) return '';
      if (parsed.kind === 'skill') return '内置章节写作 Skill';
      if (parsed.kind === 'style') return '期刊章节写作风格';
      if (parsed.kind === 'agent') return '系统自带 Skill';
      var userSkill = parsed.kind === 'user' ? findMainContextUserSkill(parsed.id) : null;
      return userSkill ? (userSkill.description || userSkill.name || '用户自定义 Skill') : '用户自定义 Skill';
    }

    function getMainContextSelectedSkillLabel(selectedTokens) {
      var tokens = Array.isArray(selectedTokens) ? selectedTokens : [];
      if (tokens.length === 0) return 'Skill';
      return 'Skill +' + tokens.length;
    }

    function getConfiguredSecondaryModelLabel() {
      var textConfig = chatBridgeConfig && chatBridgeConfig.secondary ? chatBridgeConfig.secondary : {};
      var visionConfig = chatBridgeConfig && chatBridgeConfig.secondaryVision ? chatBridgeConfig.secondaryVision : {};
      var textActive = getComposerPoolActive(textConfig.pool);
      var visionActive = getComposerPoolActive(visionConfig.pool);
      var legacyModel = apiConfig && apiConfig.url && apiConfig.key ? apiConfig.model : '';
      var textPoolConfigured = isComposerApiEntryConfigured(textActive, textConfig);
      var visionPoolConfigured = isComposerApiEntryConfigured(visionActive, visionConfig);
      var textModel = String(
        (textPoolConfigured && textActive.model)
        || (textConfig.apiUrl && textConfig.hasApiKey && textConfig.model ? textConfig.model : '')
        || legacyModel
        || ''
      ).trim();
      var visionModel = String(
        (visionPoolConfigured && visionActive.model)
        || (visionConfig.apiUrl && visionConfig.hasApiKey && visionConfig.model ? visionConfig.model : '')
        || ''
      ).trim();
      if (!textModel && !visionModel) return '未配置';
      if (textModel && visionModel && visionModel !== textModel) {
        return '文本 ' + textModel + ' · 视觉 ' + visionModel;
      }
      return textModel || visionModel || '未配置';
    }

    function getConfiguredPrimaryModelLabel() {
      var primary = chatBridgeConfig && chatBridgeConfig.primary ? chatBridgeConfig.primary : {};
      var active = getComposerPoolActive(primary.pool);
      var model = isComposerApiEntryConfigured(active, primary)
        ? active.model
        : (primary.apiUrl && primary.hasApiKey ? primary.model : '');
      return String(model || '').trim() || '未配置';
    }

    function getConfiguredCodexModelLabel() {
      var codex = chatBridgeConfig && chatBridgeConfig.codex ? chatBridgeConfig.codex : {};
      if (codex.enabled !== true) return '未配置';
      var model = String(codex.model || '').trim();
      if (!model) return '未配置';
      var effort = String(codex.reasoning_effort || '').trim();
      return effort ? (model + ' ' + effort) : model;
    }

    var COMPOSER_PROVIDER_KEY = 'scholarharness_composer_chat_provider';
    var COMPOSER_PROVIDER_LABELS = {
      secondary: 'Little corse',
      primary: 'Free corse',
      codex: 'Codex',
      pi: 'Pi',
      opencode: 'OpenCode'
    };
    var COMPOSER_CODEX_EFFORTS_KEY = 'scholarharness_codex_effort_by_model';
    var COMPOSER_CODEX_ALLOWED_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
    var COMPOSER_CODEX_FALLBACK_MODELS = [
      {
        slug: 'gpt-5.5',
        displayName: 'GPT-5.5',
        defaultReasoningLevel: 'xhigh',
        supportedReasoningLevels: [
          { effort: 'low' },
          { effort: 'medium' },
          { effort: 'high' },
          { effort: 'xhigh' }
        ]
      },
      {
        slug: 'gpt-5.4',
        displayName: 'GPT-5.4',
        defaultReasoningLevel: 'high',
        supportedReasoningLevels: [
          { effort: 'low' },
          { effort: 'medium' },
          { effort: 'high' },
          { effort: 'xhigh' }
        ]
      },
      {
        slug: 'gpt-5.4-mini',
        displayName: 'GPT-5.4 Mini',
        defaultReasoningLevel: 'medium',
        supportedReasoningLevels: [
          { effort: 'low' },
          { effort: 'medium' },
          { effort: 'high' }
        ]
      }
    ];
    var composerCodexModels = [];
    var composerCodexModelsLoaded = false;
    var composerCodexModelsPromise = null;
    var composerCodexPendingSelection = null;
    var composerCodexSaveTimer = null;
    var composerCodexSaveChain = Promise.resolve();
    var composerCodexFlyoutOpen = false;
    var COMPOSER_PORTABLE_RUNTIME_IDS = ['pi', 'opencode'];
    var composerPortableRuntimeModels = { pi: [], opencode: [] };
    var composerPortableRuntimeModelsLoaded = { pi: false, opencode: false };
    var composerPortableRuntimeModelsPromise = { pi: null, opencode: null };
    var composerPortableRuntimePendingSelection = { pi: null, opencode: null };
    var composerPortableRuntimeSaveTimer = { pi: null, opencode: null };
    var composerPortableRuntimeSaveChain = { pi: Promise.resolve(), opencode: Promise.resolve() };
    var composerPortableRuntimeStatus = {
      pi: { message: '', isError: false },
      opencode: { message: '', isError: false }
    };
    var composerMainChatFlyoutOpen = false;
    var composerMainChatFlyoutProvider = 'secondary';
    var composerMainChatPoolProvider = 'secondary';
    var composerMainChatSelectedEntryId = '';
    var composerMainChatSelectionSavePromise = Promise.resolve();
    var composerMainChatSelectionRevision = 0;
    var COMPOSER_MAIN_CHAT_EFFORTS = ['low', 'medium', 'high'];
    // WORKSPACE_DIRECTORY_KEY is kept only for one-time migration from versions
    // where a single directory was shared by every conversation.
    var WORKSPACE_DIRECTORY_KEY = 'scholarharness_workspace_directory';
    var WORKSPACE_DIRECTORIES_BY_CONVERSATION_KEY = 'scholarharness_workspace_directories_by_conversation';
    var WORKSPACE_CONVERSATION_ROOTS_KEY = 'scholarharness_workspace_conversation_roots';
    var workspaceDirectoryLastPreview = null;
    var workspaceDirectoryPreviewsByConversation = new Map();
    var workspacePreviewSelectedFiles = new Map();
    var workspaceUserViewReconcileInFlight = new Map();
    var workspaceDirectoryMemorySettings = new Map();
    var workspaceDirectoryRemoteSyncInFlight = new Map();

    function getMainChatProviderLabel(provider) {
      var key = String(provider || '').trim();
      return COMPOSER_PROVIDER_LABELS[key] || 'AI';
    }

    function getMainChatStopMessage(provider, pauseSynced) {
      var key = String(provider || '').trim();
      var label = getMainChatProviderLabel(key);
      if (key === 'primary' && pauseSynced) {
        return '已停止生成，并已同步暂停' + label;
      }
      return '已停止' + label + '生成';
    }

    function normalizeComposerChatProvider(provider) {
      provider = String(provider || '').trim();
      return Object.prototype.hasOwnProperty.call(COMPOSER_PROVIDER_LABELS, provider) ? provider : 'secondary';
    }

    function getEmptyWorkspaceDirectorySetting() {
      return { enabled: false, path: '', permission: 'read-only', aiWorkRoot: '' };
    }

    function normalizeWorkspaceDirectorySetting(setting) {
      var value = setting && typeof setting === 'object' ? setting : {};
      return {
        enabled: value.enabled === true,
        path: String(value.path || '').trim(),
        permission: ['read-only', 'workspace-write', 'danger-full-access'].includes(value.permission) ? value.permission : 'read-only',
        aiWorkRoot: String(value.aiWorkRoot || value.safeWorkRoot || '').trim()
      };
    }

    function getWorkspaceDirectoryProjectId() {
      return typeof getConversationHistoryProjectId === 'function'
        ? String(getConversationHistoryProjectId() || '').trim()
        : '';
    }

    function getWorkspaceDirectoryRuntimeKey(conversationId, projectId) {
      var id = String(conversationId || currentConversationId || '').trim();
      var scopeId = projectId !== undefined
        ? String(projectId || '').trim()
        : getWorkspaceDirectoryProjectId();
      return (scopeId || 'current-workspace') + '\u0001' + id;
    }

    function getWorkspaceDirectoryStoreKey() {
      return WORKSPACE_DIRECTORIES_BY_CONVERSATION_KEY + '_' + String(currentUserId || 'web-user');
    }

    function getWorkspaceConversationRootsStoreKey() {
      return WORKSPACE_CONVERSATION_ROOTS_KEY + '_' + String(currentUserId || 'web-user');
    }

    function normalizeWorkspaceDirectoryStore(value) {
      var parsed = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      var rawDirectories = parsed.directories && typeof parsed.directories === 'object' && !Array.isArray(parsed.directories)
        ? parsed.directories
        : {};
      var directories = {};
      Object.keys(rawDirectories).forEach(function(conversationId) {
        var id = String(conversationId || '').trim();
        if (!id) return;
        var setting = normalizeWorkspaceDirectorySetting(rawDirectories[conversationId]);
        setting.updatedAt = Number(rawDirectories[conversationId] && rawDirectories[conversationId].updatedAt) || 0;
        directories[id] = setting;
      });
      return {
        version: 2,
        legacyMigrated: parsed.legacyMigrated === true,
        lastConversationId: String(parsed.lastConversationId || '').trim(),
        directories: directories
      };
    }

    function persistWorkspaceDirectoryStore(store) {
      try {
        var storageKey = getWorkspaceDirectoryStoreKey();
        var serialized = JSON.stringify(normalizeWorkspaceDirectoryStore(store));
        localStorage.setItem(storageKey, serialized);
        if (localStorage.getItem(storageKey) !== serialized) {
          throw new Error('工作目录本地存储写后校验失败');
        }
        return true;
      } catch (e) {
        console.warn('[WorkspaceDirectory] 本地持久化失败，将使用内存与后端备份:', e);
        return false;
      }
    }

    function migrateLegacyWorkspaceDirectoryStore(store, conversationHint) {
      if (store.legacyMigrated) return store;
      var legacyRaw = null;
      try {
        var legacyText = localStorage.getItem(WORKSPACE_DIRECTORY_KEY);
        legacyRaw = legacyText ? JSON.parse(legacyText) : null;
      } catch (e) {}

      var legacySetting = legacyRaw && typeof legacyRaw === 'object'
        ? normalizeWorkspaceDirectorySetting(legacyRaw)
        : null;
      var knownConversationIds = [];
      try {
        (getHistory() || []).forEach(function(item) {
          var id = String(item && item.id || '').trim();
          if (id && !knownConversationIds.includes(id)) knownConversationIds.push(id);
        });
      } catch (e) {}
      try {
        var messagePrefix = MSG_KEY + String(currentUserId || 'web-user') + '_';
        for (var storageIndex = 0; storageIndex < localStorage.length; storageIndex += 1) {
          var storageKey = String(localStorage.key(storageIndex) || '');
          if (storageKey.indexOf(messagePrefix) !== 0) continue;
          var storedConversationId = storageKey.slice(messagePrefix.length).trim();
          if (storedConversationId && !knownConversationIds.includes(storedConversationId)) {
            knownConversationIds.push(storedConversationId);
          }
        }
      } catch (e) {}
      [conversationHint, currentConversationId].forEach(function(value) {
        var id = String(value || '').trim();
        if (id && !knownConversationIds.includes(id)) knownConversationIds.push(id);
      });

      if (legacySetting) {
        knownConversationIds.forEach(function(conversationId) {
          if (store.directories[conversationId]) return;
          store.directories[conversationId] = Object.assign({}, legacySetting, { updatedAt: Date.now() });
        });
      }
      store.legacyMigrated = true;
      if (!store.lastConversationId) {
        store.lastConversationId = String(conversationHint || currentConversationId || knownConversationIds[0] || '').trim();
      }
      persistWorkspaceDirectoryStore(store);
      try {
        localStorage.removeItem(WORKSPACE_DIRECTORY_KEY);
      } catch (e) {}
      return store;
    }

    function loadWorkspaceDirectoryStore(conversationHint) {
      var parsed = {};
      try {
        parsed = JSON.parse(localStorage.getItem(getWorkspaceDirectoryStoreKey()) || '{}');
      } catch (e) {}
      return migrateLegacyWorkspaceDirectoryStore(normalizeWorkspaceDirectoryStore(parsed), conversationHint);
    }

    function loadWorkspaceDirectorySetting(conversationId) {
      var id = String(conversationId || currentConversationId || '').trim();
      if (!id) return getEmptyWorkspaceDirectorySetting();
      var memorySetting = workspaceDirectoryMemorySettings.get(getWorkspaceDirectoryRuntimeKey(id));
      if (memorySetting) return normalizeWorkspaceDirectorySetting(memorySetting);
      var store = loadWorkspaceDirectoryStore(id);
      return store.directories[id]
        ? normalizeWorkspaceDirectorySetting(store.directories[id])
        : getEmptyWorkspaceDirectorySetting();
    }

    function markWorkspaceDirectoryConversationActive(conversationId) {
      var id = String(conversationId || '').trim();
      if (!id) return;
      var store = loadWorkspaceDirectoryStore(id);
      store.lastConversationId = id;
      persistWorkspaceDirectoryStore(store);
    }

    function saveWorkspaceDirectorySetting(setting, conversationId) {
      var id = String(conversationId || currentConversationId || '').trim();
      if (!id) return false;
      var store = loadWorkspaceDirectoryStore(id);
      var normalizedSetting = Object.assign({}, normalizeWorkspaceDirectorySetting(setting), {
        updatedAt: Date.now()
      });
      workspaceDirectoryMemorySettings.set(getWorkspaceDirectoryRuntimeKey(id), normalizedSetting);
      store.directories[id] = normalizedSetting;
      if (!currentConversationId || id === currentConversationId) {
        store.lastConversationId = id;
      }
      return persistWorkspaceDirectoryStore(store);
    }

    async function persistWorkspaceDirectorySettingRemote(setting, conversationId) {
      var id = String(conversationId || currentConversationId || '').trim();
      if (!id) throw new Error('当前会话尚未初始化');
      var projectId = getWorkspaceDirectoryProjectId();
      var response = await fetch('/api/chat-bridge/workspace/preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId || 'web-user',
          projectId: projectId,
          conversationId: id,
          setting: normalizeWorkspaceDirectorySetting(setting)
        })
      });
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok || !data.success || !data.setting) {
        throw new Error(data.error || '工作目录后端持久化失败');
      }
      var savedSetting = Object.assign({}, normalizeWorkspaceDirectorySetting(data.setting), {
        updatedAt: Number(data.setting.updatedAt) || Date.now()
      });
      workspaceDirectoryMemorySettings.set(getWorkspaceDirectoryRuntimeKey(id, projectId), savedSetting);
      var store = loadWorkspaceDirectoryStore(id);
      store.directories[id] = savedSetting;
      store.lastConversationId = id;
      persistWorkspaceDirectoryStore(store);
      return savedSetting;
    }

    function syncWorkspaceDirectorySettingFromServer(conversationId) {
      var id = String(conversationId || currentConversationId || '').trim();
      if (!id || typeof fetch !== 'function') return Promise.resolve(null);
      var projectId = getWorkspaceDirectoryProjectId();
      var runtimeKey = getWorkspaceDirectoryRuntimeKey(id, projectId);
      if (workspaceDirectoryRemoteSyncInFlight.has(runtimeKey)) {
        return workspaceDirectoryRemoteSyncInFlight.get(runtimeKey);
      }
      var query = '?userId=' + encodeURIComponent(currentUserId || 'web-user')
        + '&conversationId=' + encodeURIComponent(id)
        + '&projectId=' + encodeURIComponent(projectId);
      var request = fetch('/api/chat-bridge/workspace/preference' + query)
        .then(function(response) {
          return response.json().catch(function() { return {}; }).then(function(data) {
            if (!response.ok || !data.success) throw new Error(data.error || '工作目录配置恢复失败');
            return data;
          });
        })
        .then(function(data) {
          if (!data.setting) return null;
          var remoteSetting = Object.assign({}, normalizeWorkspaceDirectorySetting(data.setting), {
            updatedAt: Number(data.setting.updatedAt) || 0
          });
          var localStore = loadWorkspaceDirectoryStore(id);
          var localRaw = localStore.directories[id] || null;
          var localSetting = loadWorkspaceDirectorySetting(id);
          var shouldRestore = !localRaw
            || remoteSetting.updatedAt > Number(localRaw.updatedAt || 0)
            || ((!localSetting.enabled || !localSetting.path) && remoteSetting.enabled && remoteSetting.path);
          if (!shouldRestore) return localSetting;
          workspaceDirectoryMemorySettings.set(runtimeKey, remoteSetting);
          localStore.directories[id] = remoteSetting;
          localStore.lastConversationId = id;
          persistWorkspaceDirectoryStore(localStore);
          if (id === currentConversationId && projectId === getWorkspaceDirectoryProjectId()) {
            renderWorkspaceDirectoryUi('已恢复当前会话保存的工作目录。');
          }
          return normalizeWorkspaceDirectorySetting(remoteSetting);
        })
        .catch(function(error) {
          console.warn('[WorkspaceDirectory] 后端配置恢复失败，继续使用本地设置:', error);
          return null;
        })
        .finally(function() {
          workspaceDirectoryRemoteSyncInFlight.delete(runtimeKey);
        });
      workspaceDirectoryRemoteSyncInFlight.set(runtimeKey, request);
      return request;
    }
    window.syncWorkspaceDirectorySettingFromServer = syncWorkspaceDirectorySettingFromServer;

    function initializeWorkspaceDirectoryForConversation(conversationId, previousConversationId) {
      var targetId = String(conversationId || '').trim();
      if (!targetId) return getEmptyWorkspaceDirectorySetting();
      var store = loadWorkspaceDirectoryStore(targetId);
      var previousId = String(previousConversationId || '').trim();
      var sourceId = previousId && store.directories[previousId]
        ? previousId
        : (store.lastConversationId && store.lastConversationId !== targetId && store.directories[store.lastConversationId]
            ? store.lastConversationId
            : '');

      if (!store.directories[targetId]) {
        var inherited = sourceId
          ? normalizeWorkspaceDirectorySetting(store.directories[sourceId])
          : getEmptyWorkspaceDirectorySetting();
        store.directories[targetId] = Object.assign({}, inherited, { updatedAt: Date.now() });
      }
      store.lastConversationId = targetId;
      persistWorkspaceDirectoryStore(store);

      if (sourceId && workspaceDirectoryPreviewsByConversation.has(sourceId)) {
        workspaceDirectoryPreviewsByConversation.set(targetId, workspaceDirectoryPreviewsByConversation.get(sourceId));
      } else if (!workspaceDirectoryPreviewsByConversation.has(targetId)) {
        workspaceDirectoryPreviewsByConversation.delete(targetId);
      }
      return normalizeWorkspaceDirectorySetting(store.directories[targetId]);
    }

    function deleteWorkspaceDirectorySetting(conversationId) {
      var id = String(conversationId || '').trim();
      if (!id) return;
      var store = loadWorkspaceDirectoryStore();
      delete store.directories[id];
      if (store.lastConversationId === id) {
        var remaining = Object.keys(store.directories).sort(function(left, right) {
          return Number(store.directories[right].updatedAt || 0) - Number(store.directories[left].updatedAt || 0);
        });
        store.lastConversationId = remaining[0] || '';
      }
      persistWorkspaceDirectoryStore(store);
      workspaceDirectoryMemorySettings.delete(getWorkspaceDirectoryRuntimeKey(id));
      workspaceDirectoryPreviewsByConversation.delete(id);
      deleteWorkspaceConversationRoot(id);
    }

    function setWorkspaceDirectoryPreview(preview, conversationId) {
      var id = String(conversationId || currentConversationId || '').trim();
      if (!id) return;
      if (preview) {
        workspaceDirectoryPreviewsByConversation.set(id, preview);
      } else {
        workspaceDirectoryPreviewsByConversation.delete(id);
      }
      if (id === currentConversationId) workspaceDirectoryLastPreview = preview || null;
    }

    function activateWorkspaceDirectoryConversation(conversationId, message) {
      var id = String(conversationId || currentConversationId || '').trim();
      if (!id) return;
      /*
       * Conversations created before per-conversation workspace settings were
       * introduced may not have their own entry. Treat those exactly like a
       * newly created conversation and inherit the most recently configured
       * workspace before marking this conversation active.
       */
      var workspaceStore = loadWorkspaceDirectoryStore(id);
      if (!Object.prototype.hasOwnProperty.call(workspaceStore.directories, id)) {
        initializeWorkspaceDirectoryForConversation(id);
      }
      markWorkspaceDirectoryConversationActive(id);
      clearWorkspacePreviewSelections(false);
      workspaceDirectoryLastPreview = workspaceDirectoryPreviewsByConversation.get(id) || null;
      renderWorkspaceDirectoryPreview(workspaceDirectoryLastPreview);
      renderWorkspaceDirectoryUi(message);
      syncWorkspaceDirectorySettingFromServer(id);
    }

    function loadWorkspaceConversationRoots() {
      var storeKey = getWorkspaceConversationRootsStoreKey();
      try {
        var storedText = localStorage.getItem(storeKey);
        if (!storedText) {
          var legacyText = localStorage.getItem(WORKSPACE_CONVERSATION_ROOTS_KEY);
          if (legacyText) {
            localStorage.setItem(storeKey, legacyText);
            localStorage.removeItem(WORKSPACE_CONVERSATION_ROOTS_KEY);
            storedText = legacyText;
          }
        }
        var parsed = JSON.parse(storedText || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch (e) {
        return {};
      }
    }

    function saveWorkspaceConversationRoots(roots) {
      try {
        localStorage.setItem(getWorkspaceConversationRootsStoreKey(), JSON.stringify(roots || {}));
      } catch (e) {}
    }

    function getWorkspaceConversationRootKey(conversationId, projectId) {
      var id = String(conversationId || '').trim();
      var resolvedProjectId = projectId !== undefined
        ? String(projectId || '')
        : (typeof getConversationHistoryProjectId === 'function' ? String(getConversationHistoryProjectId() || '') : '');
      return (resolvedProjectId || 'current-workspace') + '\u0001' + id;
    }

    function deleteWorkspaceConversationRoot(conversationId) {
      var id = String(conversationId || '').trim();
      if (!id) return;
      var roots = loadWorkspaceConversationRoots();
      var rootKey = getWorkspaceConversationRootKey(id);
      if (!Object.prototype.hasOwnProperty.call(roots, rootKey) && !Object.prototype.hasOwnProperty.call(roots, id)) return;
      delete roots[rootKey];
      delete roots[id];
      saveWorkspaceConversationRoots(roots);
    }

    function buildConversationScopedAiWorkRoot(workspacePath, conversationId, projectId) {
      var safeConversationId = String(conversationId || '')
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .slice(0, 120);
      var safeProjectId = String(projectId || '')
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .slice(0, 120);
      if (!workspacePath || !safeConversationId) return '';
      var workspaceContainer = joinLocalRPath(workspacePath, 'ScholarHarness_AI_Workspaces');
      var projectContainer = safeProjectId
        ? joinLocalRPath(workspaceContainer, 'Project-' + safeProjectId)
        : workspaceContainer;
      return joinLocalRPath(projectContainer, 'Conversation-' + safeConversationId);
    }

    function getConversationScopedAiWorkRoot(setting, conversationId) {
      if (!setting || !setting.enabled || !setting.path) return '';
      var scopedConversationId = String(conversationId || currentConversationId || '').trim();
      if (!scopedConversationId) return setting.aiWorkRoot || '';
      var roots = loadWorkspaceConversationRoots();
      var projectId = typeof getConversationHistoryProjectId === 'function'
        ? String(getConversationHistoryProjectId() || '')
        : '';
      var rootKey = getWorkspaceConversationRootKey(scopedConversationId, projectId);
      var existing = roots[rootKey];
      if (existing && existing.workspacePath === setting.path && existing.root) {
        return String(existing.root);
      }
      if (setting.permission === 'read-only') return setting.aiWorkRoot || '';
      var scopedRoot = buildConversationScopedAiWorkRoot(setting.path, scopedConversationId, projectId);
      if (!scopedRoot) return setting.aiWorkRoot || '';
      roots[rootKey] = {
        workspacePath: setting.path,
        root: scopedRoot,
        projectId: projectId,
        conversationId: scopedConversationId,
        updatedAt: Date.now()
      };
      var entries = Object.keys(roots).map(function(key) {
        return { key: key, value: roots[key] || {} };
      }).sort(function(left, right) {
        return Number(right.value.updatedAt || 0) - Number(left.value.updatedAt || 0);
      });
      var compact = {};
      entries.slice(0, 100).forEach(function(entry) { compact[entry.key] = entry.value; });
      saveWorkspaceConversationRoots(compact);
      return scopedRoot;
    }

    function getWorkspaceDirectoryPayload(conversationId) {
      var setting = loadWorkspaceDirectorySetting(conversationId);
      if (!setting.enabled || !setting.path) return null;
      var conversationAiWorkRoot = getConversationScopedAiWorkRoot(setting, conversationId);
      return {
        enabled: true,
        path: setting.path,
        permission: setting.permission,
        aiWorkRoot: conversationAiWorkRoot,
        safeWorkRoot: conversationAiWorkRoot,
        conversationId: String(conversationId || currentConversationId || '').trim(),
        projectId: typeof getConversationHistoryProjectId === 'function'
          ? String(getConversationHistoryProjectId() || '')
          : ''
      };
    }

    function extractWorkspacePathFromMessage(message) {
      // A URL such as "https://doi.org/..." contains the substring "s:/".
      // Without removing web URLs first, the Windows drive-path matcher below
      // can mistake that substring for an S: drive and override the workspace
      // directory that the user has already validated in the composer.
      var text = String(message || '').replace(/\bhttps?:\/\/[^\s"'<>]+/gi, ' ');
      var matches = text.match(/[A-Za-z]:[\\/][^\r\n"'<>|]+/g) || [];
      for (var i = 0; i < matches.length; i += 1) {
        var candidate = String(matches[i] || '')
          .replace(/^["'“”‘’]+|["'“”‘’，。；;、\s]+$/g, '')
          .trim();
        if (candidate) return candidate;
      }
      return '';
    }

    function isLocalPathWithinWorkspace(workspacePath, candidatePath) {
      var root = String(workspacePath || '').trim().replace(/[\\/]+/g, '/').replace(/\/+$/g, '');
      var candidate = String(candidatePath || '').trim().replace(/[\\/]+/g, '/').replace(/\/+$/g, '');
      if (!root || !candidate) return false;
      if (/^[a-zA-Z]:\//.test(root)) {
        root = root.toLowerCase();
        candidate = candidate.toLowerCase();
      }
      return candidate === root || candidate.indexOf(root + '/') === 0;
    }

    function getWorkspaceDirectoryPayloadForMessage(message, conversationId) {
      var pastedPath = extractWorkspacePathFromMessage(message);
      var configured = getWorkspaceDirectoryPayload(conversationId);
      if (pastedPath) {
        if (configured && isLocalPathWithinWorkspace(configured.path, pastedPath)) {
          return configured;
        }
        return {
          enabled: true,
          path: pastedPath,
          permission: configured && configured.permission ? configured.permission : 'read-only',
          aiWorkRoot: '',
          safeWorkRoot: '',
          conversationId: String(conversationId || currentConversationId || '').trim(),
          source: 'message'
        };
      }
      return configured;
    }

    function getSelectedAnalysisWorkspaceSourceIds(
      explicitBibliometricsContext,
      explicitMetaAnalysisContext,
      preferredSourceId
    ) {
      var selectedSources = loadMainContextSourceSelection();
      var selectedKinds = [];
      function addSelectedKind(sourceId) {
        if (
          Object.prototype.hasOwnProperty.call(MAIN_CONTEXT_WORKSPACE_FOLDERS, sourceId)
          && selectedKinds.indexOf(sourceId) < 0
        ) {
          selectedKinds.push(sourceId);
        }
      }
      if (Object.prototype.hasOwnProperty.call(MAIN_CONTEXT_WORKSPACE_FOLDERS, preferredSourceId)) {
        addSelectedKind(preferredSourceId);
      }
      if (explicitBibliometricsContext) addSelectedKind('bibliometrics');
      if (explicitMetaAnalysisContext) addSelectedKind('metaAnalysis');
      Object.keys(MAIN_CONTEXT_WORKSPACE_FOLDERS).forEach(function(sourceId) {
        if (selectedSources[sourceId] === true) addSelectedKind(sourceId);
      });
      return selectedKinds;
    }

    async function prepareSelectedAnalysisWorkspaceFolders(
      workspaceDirectory,
      explicitBibliometricsContext,
      explicitMetaAnalysisContext,
      preferredSourceId
    ) {
      if (
        !workspaceDirectory
        || workspaceDirectory.permission === 'read-only'
        || !workspaceDirectory.aiWorkRoot
      ) {
        return {};
      }
      var selectedKinds = getSelectedAnalysisWorkspaceSourceIds(
        explicitBibliometricsContext,
        explicitMetaAnalysisContext,
        preferredSourceId
      );
      if (selectedKinds.length === 0) return {};
      try {
        var response = await fetch('/api/chat-bridge/workspace/prepare-analysis-folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceDirectory: workspaceDirectory,
            sourceIds: selectedKinds
          })
        });
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok || data.success === false) {
          throw new Error(data.error || '分析工作目录创建失败');
        }
        return data.directories || {};
      } catch (error) {
        console.warn('[Workspace] Failed to prepare selected analysis folders:', error);
        return {};
      }
    }

    function scopeWorkspaceDirectoryForSelectedAnalysis(
      workspaceDirectory,
      explicitBibliometricsContext,
      explicitMetaAnalysisContext
    ) {
      if (
        !workspaceDirectory
        || workspaceDirectory.permission === 'read-only'
        || !workspaceDirectory.aiWorkRoot
      ) {
        return workspaceDirectory;
      }
      var selectedKinds = getSelectedAnalysisWorkspaceSourceIds(
        explicitBibliometricsContext,
        explicitMetaAnalysisContext
      );
      if (selectedKinds.length !== 1) return workspaceDirectory;
      var sourceId = selectedKinds[0];
      var folderName = MAIN_CONTEXT_WORKSPACE_FOLDERS[sourceId];
      if (!folderName) return workspaceDirectory;
      var scopedRoot = joinLocalRPath(workspaceDirectory.aiWorkRoot, folderName);
      return Object.assign({}, workspaceDirectory, {
        aiWorkRoot: scopedRoot,
        safeWorkRoot: scopedRoot,
        workflowOutputType: sourceId,
        workflowOutputFolder: folderName
      });
    }

    function getStoredReferenceFormatForQueryEnvelope() {
      try {
        return String(localStorage.getItem('sentenceClaimReferenceFormat') || '').trim();
      } catch (e) {
        return '';
      }
    }

    function getElementPageStateSummary(element) {
      if (!element) return null;
      var text = '';
      var isComposerInput = element === userInput || element.id === 'userInput' || element.classList?.contains('chat-input');
      try {
        text = isComposerInput
          ? ''
          : normalizeQueryNavText(element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('title') || '');
      } catch (e) {}
      return {
        tag: String(element.tagName || '').toLowerCase(),
        id: element.id || '',
        className: String(element.className || '').slice(0, 240),
        role: element.getAttribute ? (element.getAttribute('role') || '') : '',
        label: element.getAttribute ? (element.getAttribute('aria-label') || element.getAttribute('title') || '') : '',
        placeholder: element.getAttribute ? (element.getAttribute('placeholder') || '') : '',
        composerInput: !!isComposerInput,
        text: text.slice(0, 500)
      };
    }

    function getVisibleMessageSummariesForPageState(limit, currentQuery) {
      var messages = Array.prototype.slice.call(messagesDiv ? messagesDiv.querySelectorAll('.message') : []);
      var rows = [];
      var maxItems = Number(limit || 6);
      var normalizedCurrentQuery = normalizeQueryNavText(currentQuery || '');
      messages.slice(-maxItems).forEach(function(messageEl, index) {
        var role = messageEl.classList.contains('user') ? 'user' : 'assistant';
        var messageText = getMessageTextForQueryNav(messageEl);
        var isCurrentQuery = role === 'user' && normalizedCurrentQuery && normalizeQueryNavText(messageText) === normalizedCurrentQuery;
        rows.push({
          role: role,
          navId: messageEl.getAttribute('data-query-nav-id') || '',
          indexFromEnd: messages.length - maxItems + index,
          isCurrentQuery: !!isCurrentQuery,
          text: isCurrentQuery ? '' : messageText.slice(0, 180)
        });
      });
      return rows;
    }

    function getSelectedArticleQuestionChapterState() {
      return Object.keys(selectedArticleQuestionChapters || {})
        .filter(function(key) { return !!selectedArticleQuestionChapters[key]; })
        .slice(0, 20);
    }

    function getFrontendPageAvailableActions() {
      return [
        { id: 'open_right_article', label: '打开右侧文章写作进度' },
        { id: 'refresh_article_draft', label: '刷新右侧文章草稿进度' },
        { id: 'open_draft', label: '打开论文草稿弹窗' },
        { id: 'open_memory', label: '打开长期记忆管理' },
        { id: 'open_config', label: '打开配置中心' },
        { id: 'open_secondary_config', label: '打开 Little corse 安全配置' },
        { id: 'open_primary_config', label: '打开 Grass OpenRouter 配置' },
        { id: 'open_embedding_config', label: '打开 Embedding 安全配置' },
        { id: 'open_vendor_config', label: '在右侧打开模型厂商官网；vendor_id 仅允许 openrouter、dashscope、qwen、deepseek、zhipu、moonshot、volcengine、baidu、tencent' },
        { id: 'open_codex_config', label: '打开 Codex 配置并展开' },
        { id: 'open_skill_config', label: '打开 Skill 清单和持续使用选择' },
        { id: 'set_persistent_skills', label: '用户确认后把 skill_ids 中的 Skill 加入持续使用' },
        { id: 'open_runtime_plugins', label: '打开本地插件配置' },
        { id: 'open_r_plot', label: '打开 R 语言作图配置' },
        { id: 'open_workspace_panel', label: '打开工作目录配置面板' },
        { id: 'upload_literature', label: '打开 RIS、TXT、BibTeX 文献题录上传' },
        { id: 'upload_pdf_wiki', label: '打开 PDF Wiki 上传' }
      ];
    }

    function buildFrontendPageStateSnapshot(actualMessage, provider, delivery) {
      var modalOverlay = document.getElementById('modalOverlay');
      var modalOpen = !!(modalOverlay && modalOverlay.classList.contains('show'));
      var modalEl = modalOverlay ? modalOverlay.querySelector('.modal') : null;
      var modalTitle = document.getElementById('modalTitle');
      var activeElement = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      var workspacePanel = document.getElementById('workspaceDirectoryPanel');
      var workspacePath = document.getElementById('workspaceDirectoryPath');
      var workspacePermission = document.getElementById('workspaceDirectoryPermission');
      var rightSidebar = document.querySelector('.right-sidebar');
      var leftSidebar = document.querySelector('.sidebar');
      var userInputText = userInput ? String(userInput.value || '') : '';
      var pendingFiles = [];
      try {
        pendingFiles = (pendingExperimentFiles || []).slice(0, 12).map(function(file) {
          return { name: file.name || '', type: file.type || '', size: file.size || 0 };
        });
      } catch (e) {}
      return {
        capturedAt: new Date().toISOString(),
        route: {
          title: document.title || '',
          url: String(location.href || '').replace(/[?#].*$/, '')
        },
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollY: window.scrollY || 0
        },
        currentQuery: {
          provider: provider || getComposerChatProvider(),
          delivery: delivery === 'queue' ? 'queue' : 'steer'
        },
        composer: {
          provider: getComposerChatProvider(),
          inputHasText: !!userInputText.trim(),
          pendingAttachmentCount: pendingFiles.length,
          pendingAttachments: pendingFiles,
          workspaceButtonVisible: !!document.getElementById('workspaceDirectoryBtn')
        },
        sidebars: {
          leftCollapsed: !!(leftSidebar && leftSidebar.classList.contains('collapsed')),
          rightCollapsed: !!(rightSidebar && rightSidebar.classList.contains('collapsed')),
          rightActiveTab: getRightSidebarActiveTab(),
          rightTitle: document.getElementById('rightSidebarTitle')?.textContent || '',
          rightMeta: document.getElementById('articleWritingProgressMeta')?.textContent || ''
        },
        modal: {
          open: modalOpen,
          title: modalTitle ? modalTitle.textContent || '' : '',
          fullscreen: !!(modalEl && modalEl.classList.contains('modal-fullscreen')),
          readingMode: !!(modalEl && modalEl.classList.contains('modal-reading')),
          contentPreview: modalOpen ? normalizeQueryNavText(document.getElementById('modalContent')?.innerText || '').slice(0, 900) : ''
        },
        workspacePanel: {
          open: !!(workspacePanel && workspacePanel.classList.contains('open')),
          path: workspacePath ? workspacePath.value || '' : '',
          permission: workspacePermission ? workspacePermission.value || '' : '',
          status: document.getElementById('workspaceDirectoryStatus')?.textContent || ''
        },
        articleWritingProgress: {
          selectedForQuestion: getSelectedArticleQuestionChapterState(),
          cacheLoaded: !!(articleDraftProgressCache && articleDraftProgressCache.loaded),
          cachedDraftCount: articleDraftProgressCache && Array.isArray(articleDraftProgressCache.drafts) ? articleDraftProgressCache.drafts.length : 0
        },
        piSession: {
          enabled: true,
          running: !!isGenerating,
          submissionBehavior: mainChatPiQueueBehavior,
          pendingMessageCount: mainChatPiState ? Number(mainChatPiState.pendingMessageCount || 0) : mainChatQueryQueue.length,
          steeringMode: 'one-at-a-time',
          followUpMode: 'one-at-a-time'
        },
        activeElement: getElementPageStateSummary(activeElement),
        lastInteraction: getElementPageStateSummary(window.__lastFrontendInteractionElement || null),
        visibleMessages: getVisibleMessageSummariesForPageState(8, actualMessage),
        availableActions: getFrontendPageAvailableActions()
      };
    }
    window.buildFrontendPageStateSnapshot = buildFrontendPageStateSnapshot;

    document.addEventListener('pointerdown', function(event) {
      window.__lastFrontendInteractionElement = event.target && event.target.nodeType === 1
        ? event.target
        : null;
    }, { capture: true, passive: true });
    document.addEventListener('focusin', function(event) {
      window.__lastFrontendInteractionElement = event.target && event.target.nodeType === 1
        ? event.target
        : null;
    }, { capture: true });

    function buildChatQueryEnvelope(rawMessage, actualMessage, provider, workspaceFileMentions, slashNames, context, workspaceDirectory, delivery) {
      var parts = [];
      var originalText = String(rawMessage || '').trim();
      var taskText = String(actualMessage || '').trim();
      // 当前请求正文由 Envelope 顶层 text/originalText 传输，parts 只保存结构化元数据。
      if (provider) {
        parts.push({
          type: 'provider',
          name: provider,
          provider: provider,
          source: 'composer-default'
        });
      }
      (workspaceFileMentions || []).forEach(function(file) {
        if (!file || !file.path) return;
        parts.push({
          type: 'workspace_file',
          name: file.name || String(file.path).split(/[\\/]/).pop() || file.path,
          path: file.path,
          label: file.name || file.path,
          source: file.source || 'composer-workspace-mention',
          active: true
        });
      });
      (slashNames || []).forEach(function(name) {
        if (!name) return;
        parts.push({
          type: 'slash',
          name: String(name),
          command: String(name),
          source: 'composer'
        });
      });
      if (context && Array.isArray(context.invokedUserSkills)) {
        context.invokedUserSkills.forEach(function(skill) {
          if (!skill) return;
          var label = skill.name || skill.trigger || skill.token || skill.id || 'Skill';
          parts.push({
            type: 'slash',
            name: String(label),
            command: String(skill.trigger || skill.token || skill.id || label),
            label: String(label),
            key: String(skill.id || skill.token || skill.trigger || label),
            source: skill.persistent ? 'persistent-skill' : 'user-skill',
            active: true
          });
        });
      }
      if (workspaceDirectory && workspaceDirectory.path) {
        parts.push({
          type: 'workspace',
          path: workspaceDirectory.path,
          permission: workspaceDirectory.permission || 'read-only',
          aiWorkRoot: workspaceDirectory.aiWorkRoot || workspaceDirectory.safeWorkRoot || '',
          safeWorkRoot: workspaceDirectory.safeWorkRoot || workspaceDirectory.aiWorkRoot || '',
          source: workspaceDirectory.source === 'message' ? 'message-path' : 'composer',
          active: true
        });
      }
      var contextMap = {
        bibliometrics: context && context.bibliometrics,
        metaAnalysis: context && context.metaAnalysis,
        autoResearch: context && context.autoResearch,
        articleChapterQuestionContext: context && context.articleChapterQuestionContext,
        rPlot: context && context.rPlot,
        journalStyle: context && context.journalStyle,
        targetVenuePeerReview: context && context.targetVenuePeerReview,
        userSkillPrompt: context && context.userSkillPrompt,
        queryIntent: context && context.queryIntent,
        piSession: context && context.piSession
      };
      Object.keys(contextMap).forEach(function(key) {
        if (!contextMap[key]) return;
        parts.push({
          type: 'context',
          key: key,
          label: key,
          source: 'composer',
          active: true
        });
      });
      var targetReferenceFormat = getStoredReferenceFormatForQueryEnvelope();
      if (targetReferenceFormat) {
        parts.push({
          type: 'reference_format',
          label: '目标期刊参考文献尾注格式',
          content: targetReferenceFormat,
          source: 'localStorage'
        });
      }
      return {
        id: 'query_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
        sessionId: currentConversationId || '',
        text: taskText,
        originalText: originalText || taskText,
        delivery: delivery === 'queue' ? 'queue' : 'steer',
        provider: provider || 'auto',
        parts: parts,
        workspace: workspaceDirectory ? {
          path: workspaceDirectory.path,
          permission: workspaceDirectory.permission || 'read-only',
          aiWorkRoot: workspaceDirectory.aiWorkRoot || workspaceDirectory.safeWorkRoot || '',
          safeWorkRoot: workspaceDirectory.safeWorkRoot || workspaceDirectory.aiWorkRoot || ''
        } : undefined,
        contextFlags: Object.keys(contextMap).reduce(function(acc, key) {
          acc[key] = !!contextMap[key];
          return acc;
        }, {}),
        routing: {
          mode: 'formal-agent',
          decisionOwner: 'agent',
          preclassified: false
        },
        createdAt: new Date().toISOString()
      };
    }

    function getWorkspacePreviewKindLabel(kind, ext) {
      var labels = {
        image: '图片',
        pdf: 'PDF',
        word: 'Word',
        spreadsheet: '表格',
        presentation: 'PPT',
        code: '代码',
        data: '数据',
        text: '文本',
        file: '文件'
      };
      return labels[kind] || (ext ? String(ext).toUpperCase() : '文件');
    }

    function getWorkspacePreviewIcon(kind, ext) {
      if (kind === 'pdf') return 'PDF';
      if (kind === 'word') return 'W';
      if (kind === 'spreadsheet') return 'XLS';
      if (kind === 'presentation') return 'PPT';
      if (kind === 'code') return ext ? String(ext).slice(0, 3).toUpperCase() : '{}';
      if (kind === 'data') return 'DB';
      if (kind === 'text') return 'TXT';
      return ext ? String(ext).slice(0, 3).toUpperCase() : 'FILE';
    }

    function formatWorkspacePreviewSize(size) {
      var value = Number(size || 0);
      if (!Number.isFinite(value) || value <= 0) return '';
      return formatBytes(value);
    }

    function clampWorkspaceImageFocus(value, count) {
      var max = Math.max(0, Number(count || 0) - 1);
      var next = Math.round(Number(value || 0));
      if (next < 0) return 0;
      if (next > max) return max;
      return next;
    }

    function setWorkspaceImageStackFocus(stack, focusIndex) {
      if (!stack || !stack.querySelectorAll) return;
      var thumbs = Array.from(stack.querySelectorAll('.workspace-image-thumb'));
      if (!thumbs.length) return;
      var focus = clampWorkspaceImageFocus(focusIndex, thumbs.length);
      var flatLayout = stack.dataset.layout === 'flat';
      var compactFlatLayout = window.innerWidth <= 720;
      var flatMaxOverlapRatio = 0.2;
      var flatThumbWidth = thumbs.reduce(function(maxWidth, thumb) {
        return Math.max(maxWidth, Number(thumb.offsetWidth || 0));
      }, compactFlatLayout ? 150 : 190);
      var flatSpacing = flatThumbWidth * (1 - flatMaxOverlapRatio);
      stack.dataset.focus = String(focus);
      thumbs.forEach(function(thumb, index) {
        var rel = index - focus;
        var abs = Math.abs(rel);
        var visibleRel = flatLayout ? rel : Math.max(-4, Math.min(4, rel));
        var hiddenSide = rel < 0 ? -1 : 1;
        if (!flatLayout && abs > 4) visibleRel = hiddenSide * (4 + Math.min(2, abs - 4) * 0.42);
        var x = visibleRel * (flatLayout ? flatSpacing : 35);
        var y = flatLayout ? 0 : Math.abs(visibleRel) * 8 + (abs > 4 ? 16 : 0);
        var r = flatLayout ? 0 : visibleRel * 7;
        var scale = flatLayout ? 1 : (index === focus ? 1.18 : Math.max(0.66, 1 - abs * 0.065));
        var opacity = flatLayout ? (abs > 2 ? 0 : 1) : (abs > 7 ? 0.08 : (abs > 4 ? 0.32 : 1));
        var z = 180 - abs;
        thumb.style.setProperty('--arc-x', x.toFixed(1) + 'px');
        thumb.style.setProperty('--arc-y', y.toFixed(1) + 'px');
        thumb.style.setProperty('--arc-r', r.toFixed(1) + 'deg');
        thumb.style.setProperty('--arc-scale', scale.toFixed(3));
        thumb.style.setProperty('--arc-opacity', opacity.toFixed(2));
        thumb.style.setProperty('--z', String(z));
        thumb.style.pointerEvents = flatLayout && abs > 2 ? 'none' : '';
        thumb.classList.toggle('is-focus', index === focus);
      });
    }

    function handleWorkspaceImageStackPointerMove(event) {
      var stack = event.currentTarget;
      if (!stack) return;
      var count = Number(stack.dataset.count || 0);
      if (count <= 1 || !stack.getBoundingClientRect) return;
      var rect = stack.getBoundingClientRect();
      var ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
      var focus = clampWorkspaceImageFocus(ratio * count, count);
      stack.dataset.pendingFocus = String(focus);
      if (stack._workspaceImageStackRaf) return;
      stack._workspaceImageStackRaf = requestAnimationFrame(function() {
        stack._workspaceImageStackRaf = 0;
        setWorkspaceImageStackFocus(stack, Number(stack.dataset.pendingFocus || stack.dataset.focus || 0));
      });
    }
    window.handleWorkspaceImageStackPointerMove = handleWorkspaceImageStackPointerMove;

    function handleWorkspaceImageStackWheel(event) {
      var stack = event.currentTarget;
      if (!stack) return;
      var count = Number(stack.dataset.count || 0);
      if (count <= 1) return;
      event.preventDefault();
      var current = clampWorkspaceImageFocus(stack.dataset.focus || 0, count);
      var direction = event.deltaY > 0 || event.deltaX > 0 ? 1 : -1;
      setWorkspaceImageStackFocus(stack, current + direction);
    }
    window.handleWorkspaceImageStackWheel = handleWorkspaceImageStackWheel;

    function handleOutputImageCollectionThumbnailLoad(img) {
      scheduleOutputAttachmentThumbnail(img);
    }
    window.handleOutputImageCollectionThumbnailLoad = handleOutputImageCollectionThumbnailLoad;

    function initWorkspaceImageStacks(root) {
      var scope = root && root.querySelectorAll ? root : document;
      scope.querySelectorAll('.workspace-image-stack').forEach(function(stack) {
        setWorkspaceImageStackFocus(stack, Number(stack.dataset.focus || 0));
      });
      if (typeof window.validateOutputAttachmentCards === 'function') {
        setTimeout(function() {
          window.validateOutputAttachmentCards(scope).catch(function(error) {
            console.warn('[OutputAttachment] Validation failed:', error);
          });
        }, 0);
      }
    }

    function getWorkspaceImagePreviewPath(image) {
      var previewUrl = String(image && image.previewUrl || '');
      if (!previewUrl) return String(image && image.path || '');
      try {
        var parsed = new URL(previewUrl, window.location.origin);
        return parsed.searchParams.get('path') || String(image && image.path || '');
      } catch (error) {
        var match = previewUrl.match(/[?&]path=([^&]+)/);
        return match ? decodeURIComponent(match[1]) : String(image && image.path || '');
      }
    }

    function getWorkspacePreviewSelectionKey(filePath) {
      return String(filePath || '').trim().replace(/\\/g, '/').toLowerCase();
    }

    function getSelectedWorkspacePreviewFiles() {
      return Array.from(workspacePreviewSelectedFiles.values()).map(function(file) {
        return {
          path: file.path,
          name: file.name,
          kind: file.kind || 'file',
          source: 'workspace-preview-selection'
        };
      });
    }

    function updateWorkspacePreviewSelectionUi() {
      var container = document.getElementById('workspaceDirectoryPreview');
      if (!container) return;
      container.querySelectorAll('.workspace-preview-select-toggle').forEach(function(toggle) {
        var key = getWorkspacePreviewSelectionKey(toggle.dataset.filePath || '');
        var selected = !!key && workspacePreviewSelectedFiles.has(key);
        toggle.setAttribute('aria-checked', selected ? 'true' : 'false');
        toggle.textContent = selected ? '✓' : '';
        var card = toggle.closest('.workspace-image-card, .workspace-image-thumb, .workspace-preview-file');
        if (card) card.classList.toggle('is-selected', selected);
      });
      var summary = document.getElementById('workspacePreviewSelectionSummary');
      var countNode = document.getElementById('workspacePreviewSelectionCount');
      var count = workspacePreviewSelectedFiles.size;
      if (summary) summary.classList.toggle('visible', count > 0);
      if (countNode) countNode.textContent = '已选 ' + count + ' 项，将随下一条 query 交给 AI 读取';
    }

    function toggleWorkspacePreviewSelection(event, toggle) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (!toggle) return false;
      var filePath = String(toggle.dataset.filePath || '').trim();
      var key = getWorkspacePreviewSelectionKey(filePath);
      if (!key) return false;
      if (workspacePreviewSelectedFiles.has(key)) {
        workspacePreviewSelectedFiles.delete(key);
      } else {
        if (workspacePreviewSelectedFiles.size >= 20) {
          alert('一次最多选择 20 个工作目录文件，请先发送当前选择。');
          return false;
        }
        workspacePreviewSelectedFiles.set(key, {
          path: filePath,
          name: String(toggle.dataset.fileName || filePath.split(/[\\/]/).pop() || filePath),
          kind: String(toggle.dataset.fileKind || 'file')
        });
      }
      updateWorkspacePreviewSelectionUi();
      return false;
    }
    window.toggleWorkspacePreviewSelection = toggleWorkspacePreviewSelection;

    function handleWorkspacePreviewSelectionKeydown(event, toggle) {
      if (!event || (event.key !== 'Enter' && event.key !== ' ')) return;
      toggleWorkspacePreviewSelection(event, toggle);
    }
    window.handleWorkspacePreviewSelectionKeydown = handleWorkspacePreviewSelectionKeydown;

    function clearWorkspacePreviewSelections(refreshUi) {
      workspacePreviewSelectedFiles.clear();
      if (refreshUi !== false) updateWorkspacePreviewSelectionUi();
    }
    window.clearWorkspacePreviewSelections = clearWorkspacePreviewSelections;

    function renderWorkspacePreviewSelectionToggle(filePath, fileName, kind) {
      var selected = workspacePreviewSelectedFiles.has(getWorkspacePreviewSelectionKey(filePath));
      return '<span class="workspace-preview-select-toggle" role="checkbox" tabindex="0"' +
        ' aria-label="选择 ' + escapeHtml(fileName || filePath) + ' 交给 AI 读取"' +
        ' aria-checked="' + (selected ? 'true' : 'false') + '"' +
        ' data-file-path="' + escapeHtml(filePath) + '"' +
        ' data-file-name="' + escapeHtml(fileName || filePath) + '"' +
        ' data-file-kind="' + escapeHtml(kind || 'file') + '"' +
        ' onclick="return toggleWorkspacePreviewSelection(event,this)"' +
        ' onkeydown="handleWorkspacePreviewSelectionKeydown(event,this)">' + (selected ? '✓' : '') + '</span>';
    }

    function mergeWorkspaceFileMentions(mentionedFiles, selectedFiles) {
      var merged = [];
      var seen = new Set();
      [].concat(mentionedFiles || [], selectedFiles || []).forEach(function(file) {
        if (!file || !file.path) return;
        var key = getWorkspacePreviewSelectionKey(file.path);
        if (!key || seen.has(key) || merged.length >= 20) return;
        seen.add(key);
        merged.push({
          path: String(file.path),
          name: String(file.name || String(file.path).split(/[\\/]/).pop() || file.path),
          kind: String(file.kind || 'file'),
          source: String(file.source || 'workspace-preview-selection')
        });
      });
      return merged;
    }

    function mergeWorkspaceSelectedImageAttachments(attachments, selectedFiles) {
      var merged = Array.isArray(attachments) ? attachments.slice() : [];
      var seen = new Set(merged.map(function(file) {
        return getWorkspacePreviewSelectionKey(file && file.path || '');
      }).filter(Boolean));
      (selectedFiles || []).forEach(function(file) {
        if (!file || file.kind !== 'image' || !file.path) return;
        var key = getWorkspacePreviewSelectionKey(file.path);
        if (!key || seen.has(key)) return;
        seen.add(key);
        merged.push({
          name: file.name || String(file.path).split(/[\\/]/).pop() || 'image',
          path: file.path,
          type: 'image',
          source: 'workspace-preview-selection'
        });
      });
      return merged;
    }

    function renderWorkspaceImageButton(image, className, extraAttrs) {
      var filePath = getWorkspaceImagePreviewPath(image);
      var previewUrl = String(image && image.previewUrl || '');
      var thumbnailUrl = String(image && (image.thumbnailUrl || image.thumbUrl) || previewUrl);
      var fileName = String(image && (image.name || image.path) || 'image');
      return '<button type="button" class="' + className + '" ' + (extraAttrs || '') +
        ' data-file-path="' + escapeHtml(filePath) + '"' +
        ' data-preview-url="' + escapeHtml(previewUrl) + '"' +
        ' data-thumbnail-url="' + escapeHtml(thumbnailUrl) + '"' +
        ' data-file-name="' + escapeHtml(fileName) + '"' +
        ' data-file-kind="image"' +
        ' onclick="previewOutputAttachment(this)"' +
        ' title="' + escapeHtml(filePath || fileName) + '"' +
        ' aria-label="在软件内查看图片：' + escapeHtml(fileName) + '">' +
        renderWorkspacePreviewSelectionToggle(filePath, fileName, 'image') +
        '<img src="' + escapeHtml(thumbnailUrl) + '" alt="' + escapeHtml(fileName) + '" loading="lazy" decoding="async" fetchpriority="low" onerror="handleOutputAttachmentPreviewError(this)">' +
      '</button>';
    }

    function renderWorkspaceImagePreview(images, totalCount) {
      if (!images || !images.length) return '';
      var countText = totalCount > images.length ? images.length + '/' + totalCount : String(totalCount || images.length);
      if ((totalCount || images.length) <= 3) {
        return [
          '<div class="workspace-preview-section-title"><span>图片</span><span>' + escapeHtml(countText) + '</span></div>',
          '<div class="workspace-image-grid">',
          images.slice(0, 3).map(function(image) {
            return renderWorkspaceImageButton(image, 'workspace-image-card');
          }).join(''),
          '</div>'
        ].join('');
      }

      var visibleImages = images.slice(0, Math.min(images.length, 9));
      var initialFocus = Math.min(visibleImages.length - 1, Math.floor(visibleImages.length / 2));
      return [
        '<div class="workspace-preview-section-title"><span>图片集</span><span>' + escapeHtml(String(totalCount || images.length)) + ' · 移动/滚轮切换</span></div>',
        '<div class="workspace-image-stage">',
        '<div class="workspace-image-stack" data-count="' + visibleImages.length + '" data-focus="' + initialFocus + '" onmousemove="handleWorkspaceImageStackPointerMove(event)" onwheel="handleWorkspaceImageStackWheel(event)">',
        visibleImages.map(function(image, index) {
          return renderWorkspaceImageButton(image, 'workspace-image-thumb', 'data-index="' + index + '"');
        }).join(''),
        (totalCount || images.length) > visibleImages.length ? '<div class="workspace-image-count-badge">+' + escapeHtml(String((totalCount || images.length) - visibleImages.length)) + '</div>' : '',
        '</div>',
        '</div>'
      ].join('');
    }

    function renderWorkspaceFilePreview(files, totalCount) {
      if (!files || !files.length) return '';
      var visibleFiles = files.slice(0, 24);
      return [
        '<div class="workspace-preview-section-title"><span>文件</span><span>' + escapeHtml(String(totalCount || files.length)) + '</span></div>',
        '<div class="workspace-preview-files">',
        visibleFiles.map(function(file) {
          var kind = file.kind || 'file';
          var filePath = String(file.path || '');
          var fileName = String(file.name || file.path || 'untitled');
          var metaParts = [getWorkspacePreviewKindLabel(kind, file.ext)];
          var size = formatWorkspacePreviewSize(file.size);
          if (size) metaParts.push(size);
          return [
            '<div class="workspace-preview-file" title="' + escapeHtml(filePath || fileName) + '">',
            '<span class="workspace-preview-file-icon">' + escapeHtml(getWorkspacePreviewIcon(kind, file.ext)) + '</span>',
            '<div class="workspace-preview-file-main">',
            '<div class="workspace-preview-file-name">' + escapeHtml(fileName) + '</div>',
            '<div class="workspace-preview-file-meta">' + escapeHtml(metaParts.join(' · ')) + '</div>',
            '</div>',
            renderWorkspacePreviewSelectionToggle(filePath, fileName, kind),
            '</div>'
          ].join('');
        }).join(''),
        '</div>'
      ].join('');
    }

    function renderWorkspaceDirectoryPreview(preview) {
      var container = document.getElementById('workspaceDirectoryPreview');
      if (!container) return;
      if (!preview) {
        container.classList.remove('has-content');
        container.innerHTML = '';
        return;
      }
      var images = Array.isArray(preview.images) ? preview.images.filter(function(item) { return item && item.previewUrl; }) : [];
      var files = Array.isArray(preview.files) ? preview.files : [];
      if (!images.length && !files.length) {
        container.classList.add('has-content');
        container.innerHTML = '<div class="workspace-directory-status">目录中暂未发现可展示的图片或文件。</div>';
        return;
      }
      var imageHtml = renderWorkspaceImagePreview(images, Number(preview.imageCount || images.length));
      var fileHtml = renderWorkspaceFilePreview(files, Number(preview.fileCount || files.length));
      var html = imageHtml && fileHtml
        ? '<div class="workspace-preview-layout"><div>' + imageHtml + '</div><div>' + fileHtml + '</div></div>'
        : imageHtml + fileHtml;
      container.classList.add('has-content');
      container.innerHTML = '<div class="workspace-preview-selection-summary" id="workspacePreviewSelectionSummary">' +
        '<span id="workspacePreviewSelectionCount"></span>' +
        '<button type="button" onclick="clearWorkspacePreviewSelections()">清除选择</button>' +
        '</div>' + html;
      initWorkspaceImageStacks(container);
      updateWorkspacePreviewSelectionUi();
    }

    function renderWorkspaceDirectoryUi(message) {
      var setting = loadWorkspaceDirectorySetting(currentConversationId);
      var panel = document.getElementById('workspaceDirectoryPanel');
      var btn = document.getElementById('workspaceDirectoryBtn');
      var pathInput = document.getElementById('workspaceDirectoryPath');
      var permissionSelect = document.getElementById('workspaceDirectoryPermission');
      var status = document.getElementById('workspaceDirectoryStatus');
      if (pathInput) pathInput.value = setting.path || '';
      if (permissionSelect) permissionSelect.value = setting.permission || 'read-only';
      if (btn) {
        btn.classList.toggle('active', !!(setting.enabled && setting.path));
        btn.setAttribute('aria-expanded', panel && panel.classList.contains('open') ? 'true' : 'false');
        btn.title = setting.enabled && setting.path
          ? '当前会话工作目录：' + setting.path + '；权限：' + setting.permission
          : '设置当前会话的工作目录';
      }
      if (status) {
        var scopedAiWorkRoot = setting.enabled
          ? getConversationScopedAiWorkRoot(setting, currentConversationId)
          : '';
        var aiWorkRootText = scopedAiWorkRoot ? '\n当前会话 AI 工作文件夹：' + scopedAiWorkRoot : '';
        var readOnlyText = setting.enabled && setting.permission === 'read-only'
          ? '\n只读模式会递归检索当前目录及已有 ScholarHarness_AI_Workspaces，不会创建新的会话工作文件夹。'
          : '';
        status.textContent = message || (setting.enabled && setting.path
          ? '当前会话已启用工作目录：' + setting.path + '；权限：' + setting.permission + aiWorkRootText + readOnlyText
          : '当前会话未设置工作目录。新建会话会继承上一会话的目录；在这里切换只影响当前会话。');
      }
      if (setting.enabled && workspaceDirectoryLastPreview) {
        renderWorkspaceDirectoryPreview(workspaceDirectoryLastPreview);
      }
    }

    function setWorkspaceDirectoryPanelOpen(open, options) {
      var panel = document.getElementById('workspaceDirectoryPanel');
      if (!panel) return;
      var shouldOpen = open === true;
      var button = document.getElementById('workspaceDirectoryBtn');
      panel.classList.toggle('open', shouldOpen);
      if (button) button.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      if (!shouldOpen) return;
      renderWorkspaceDirectoryUi();
      if (!(options && options.skipFocus)) {
        var input = document.getElementById('workspaceDirectoryPath');
        if (input) input.focus();
      }
    }

    function closeWorkspaceDirectoryPanel() {
      setWorkspaceDirectoryPanelOpen(false);
    }
    window.closeWorkspaceDirectoryPanel = closeWorkspaceDirectoryPanel;

    function toggleWorkspaceDirectoryPanel(event) {
      if (event) event.stopPropagation();
      var panel = document.getElementById('workspaceDirectoryPanel');
      if (!panel) return;
      setWorkspaceDirectoryPanelOpen(!panel.classList.contains('open'));
    }
    window.toggleWorkspaceDirectoryPanel = toggleWorkspaceDirectoryPanel;

    function handleWorkspaceDirectoryOutsideClick(event) {
      var panel = document.getElementById('workspaceDirectoryPanel');
      if (!panel || !panel.classList.contains('open')) return;
      var button = document.getElementById('workspaceDirectoryBtn');
      var target = event && event.target;
      if (target && (panel.contains(target) || (button && button.contains(target)))) return;
      closeWorkspaceDirectoryPanel();
    }
    document.addEventListener('click', handleWorkspaceDirectoryOutsideClick);

    function getWorkspacePermissionDisplayName(permission) {
      if (permission === 'workspace-write') return '可写';
      if (permission === 'danger-full-access') return '完全访问';
      return '只读';
    }

    function handleWorkspaceDirectoryPermissionChange() {
      var permissionSelect = document.getElementById('workspaceDirectoryPermission');
      var status = document.getElementById('workspaceDirectoryStatus');
      if (!permissionSelect || !status) return;
      var selectedPermission = permissionSelect.value || 'read-only';
      var savedSetting = loadWorkspaceDirectorySetting(currentConversationId);
      if (selectedPermission === savedSetting.permission) {
        renderWorkspaceDirectoryUi();
        return;
      }
      var activePermission = activeMainChatWorkspaceSnapshot
        ? activeMainChatWorkspaceSnapshot.permission || 'read-only'
        : savedSetting.permission || 'read-only';
      status.textContent = isGenerating
        ? '已选择“' + getWorkspacePermissionDisplayName(selectedPermission) + '”，点击“检查目录”后保存。当前运行任务仍使用“' + getWorkspacePermissionDisplayName(activePermission) + '”；新权限从下一轮任务生效。'
        : '已选择“' + getWorkspacePermissionDisplayName(selectedPermission) + '”，尚未应用。请点击“检查目录”完成校验并保存。';
    }
    window.handleWorkspaceDirectoryPermissionChange = handleWorkspaceDirectoryPermissionChange;

    async function inspectWorkspaceDirectory() {
      var inspectionConversationId = ensureCurrentConversationId();
      var pathInput = document.getElementById('workspaceDirectoryPath');
      var permissionSelect = document.getElementById('workspaceDirectoryPermission');
      var dirPath = pathInput ? pathInput.value.trim() : '';
      var permission = permissionSelect ? permissionSelect.value : 'read-only';
      var runningWorkspaceSnapshot = isGenerating && activeMainChatWorkspaceSnapshot
        ? Object.assign({}, activeMainChatWorkspaceSnapshot)
        : null;
      var persistenceWarning = '';
      if (!dirPath) {
        renderWorkspaceDirectoryUi('请先粘贴工作目录路径。');
        return false;
      }
      renderWorkspaceDirectoryUi('正在检查工作目录...');
      try {
        var response = await fetch('/api/chat-bridge/workspace/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: dirPath, permission: permission, enabled: true })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '目录检查失败');
        var aiWorkRoot = data.workspace.aiWorkRoot || data.workspace.safeWorkRoot || '';
        var inspectedSetting = {
          enabled: true,
          path: data.workspace.root || dirPath,
          permission: permission,
          aiWorkRoot: aiWorkRoot,
          safeWorkRoot: aiWorkRoot
        };
        var localSaved = saveWorkspaceDirectorySetting(inspectedSetting, inspectionConversationId);
        var remoteSaved = false;
        try {
          await persistWorkspaceDirectorySettingRemote(inspectedSetting, inspectionConversationId);
          remoteSaved = true;
        } catch (persistenceError) {
          console.warn('[WorkspaceDirectory] 后端持久化失败:', persistenceError);
          persistenceWarning = '\n注意：后端备份暂时失败；当前页面已保存，建议稍后再次确认。';
        }
        if (!localSaved && !remoteSaved) {
          throw new Error('目录检查成功，但配置未能写入本地或后端存储，请检查磁盘空间后重试');
        }
        deleteWorkspaceConversationRoot(inspectionConversationId);
        setWorkspaceDirectoryPreview(data.workspace.preview || null, inspectionConversationId);
        if (inspectionConversationId !== currentConversationId) return;
        clearWorkspacePreviewSelections(false);
        var savedSetting = loadWorkspaceDirectorySetting(inspectionConversationId);
        var scopedAiWorkRoot = getConversationScopedAiWorkRoot(savedSetting, inspectionConversationId);
        var permissionMessage = scopedAiWorkRoot
          ? '\n当前会话 AI 工作文件夹：' + scopedAiWorkRoot + '。后续 AI 工作内容会放在该文件夹内。'
          : (permission === 'read-only'
              ? '\n只读模式会递归检索当前目录及已有 ScholarHarness_AI_Workspaces，不会创建新的会话工作文件夹。'
              : '');
        var activeRoot = runningWorkspaceSnapshot
          ? String(runningWorkspaceSnapshot.root || runningWorkspaceSnapshot.path || '').trim()
          : '';
        var savedRoot = String(data.workspace.root || dirPath).trim();
        var changedDuringRun = isGenerating && (
          !runningWorkspaceSnapshot
          || activeRoot !== savedRoot
          || String(runningWorkspaceSnapshot.permission || 'read-only') !== permission
        );
        if (changedDuringRun) {
          var previousPermission = runningWorkspaceSnapshot
            ? getWorkspacePermissionDisplayName(runningWorkspaceSnapshot.permission || 'read-only')
            : '未配置工作目录';
          permissionMessage += '\n当前运行任务仍使用“' + previousPermission + '”快照；新设置从下一轮任务生效。下一轮 Codex 会自动按新权限重启运行环境，同时保留当前对话上下文。';
        }
        renderWorkspaceDirectoryUi('当前会话已启用工作目录：' + (data.workspace.root || dirPath) + '；已索引文件 ' + data.workspace.fileCount + ' 个；权限：' + permission + permissionMessage + persistenceWarning);
        renderWorkspaceDirectoryPreview(workspaceDirectoryLastPreview);
        return true;
      } catch (e) {
        var failedSetting = { enabled: false, path: dirPath, permission: permission, aiWorkRoot: '' };
        saveWorkspaceDirectorySetting(failedSetting, inspectionConversationId);
        persistWorkspaceDirectorySettingRemote(failedSetting, inspectionConversationId).catch(function(persistenceError) {
          console.warn('[WorkspaceDirectory] 失败状态后端持久化失败:', persistenceError);
        });
        deleteWorkspaceConversationRoot(inspectionConversationId);
        setWorkspaceDirectoryPreview(null, inspectionConversationId);
        if (inspectionConversationId !== currentConversationId) return;
        renderWorkspaceDirectoryPreview(null);
        renderWorkspaceDirectoryUi('当前会话的工作目录不可用：' + (e.message || String(e)));
        return false;
      }
    }
    window.inspectWorkspaceDirectory = inspectWorkspaceDirectory;

    async function confirmWorkspaceDirectory() {
      var confirmed = await inspectWorkspaceDirectory();
      if (confirmed) closeWorkspaceDirectoryPanel();
    }
    window.confirmWorkspaceDirectory = confirmWorkspaceDirectory;

    function clearWorkspaceDirectory() {
      var clearedSetting = { enabled: false, path: '', permission: 'read-only', aiWorkRoot: '' };
      saveWorkspaceDirectorySetting(clearedSetting, currentConversationId);
      persistWorkspaceDirectorySettingRemote(clearedSetting, currentConversationId).catch(function(error) {
        console.warn('[WorkspaceDirectory] 清除状态后端持久化失败:', error);
      });
      deleteWorkspaceConversationRoot(currentConversationId);
      clearWorkspacePreviewSelections(false);
      setWorkspaceDirectoryPreview(null, currentConversationId);
      renderWorkspaceDirectoryPreview(null);
      renderWorkspaceDirectoryUi('已清除当前会话的工作目录。');
    }
    window.clearWorkspaceDirectory = clearWorkspaceDirectory;

    function getComposerChatProvider() {
      try {
        return normalizeComposerChatProvider(localStorage.getItem(COMPOSER_PROVIDER_KEY));
      } catch (e) {
        return 'secondary';
      }
    }

    function getComposerProviderModelHint(provider) {
      provider = normalizeComposerChatProvider(provider);
      if (provider === 'primary') return getConfiguredPrimaryModelLabel();
      if (provider === 'codex') return getConfiguredCodexModelLabel();
      if (provider === 'pi' || provider === 'opencode') {
        var runtime = chatBridgeConfig && chatBridgeConfig.agentRuntimes
          ? chatBridgeConfig.agentRuntimes[provider]
          : null;
        return runtime && String(runtime.model || '').trim()
          ? String(runtime.model).trim()
          : '未配置';
      }
      return getConfiguredSecondaryModelLabel();
    }

    function getComposerCodingRuntimeSelection(provider) {
      provider = normalizeComposerChatProvider(provider);
      if (provider === 'codex') {
        var codexSelection = getComposerCodexSelection();
        return { runtime: 'codex', model: codexSelection.model, reasoningEffort: codexSelection.reasoningEffort };
      }
      if (provider !== 'pi' && provider !== 'opencode') return null;
      var portableSelection = getComposerPortableRuntimeSelection(provider);
      var runtime = getComposerPortableRuntimeConfig(provider);
      return {
        runtime: provider,
        model: portableSelection.model,
        reasoningEffort: portableSelection.reasoningEffort,
        timeoutMs: Number(runtime.timeout_ms || 1800000)
      };
    }

    function reconcileWorkspaceUserViewForConversation(conversationId) {
      var id = String(conversationId || currentConversationId || '').trim();
      if (!id) return Promise.resolve(null);
      var payload = getWorkspaceDirectoryPayload(id);
      if (!payload || !payload.path || !payload.aiWorkRoot) return Promise.resolve(null);
      var requestKey = [payload.path, payload.aiWorkRoot].join('\u0001').toLowerCase();
      if (workspaceUserViewReconcileInFlight.has(requestKey)) {
        return workspaceUserViewReconcileInFlight.get(requestKey);
      }
      var request = fetch('/api/chat-bridge/workspace/reconcile-user-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(async function(response) {
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok || !data.success) {
          throw new Error(data.error || '用户查看同步失败');
        }
        window.dispatchEvent(new CustomEvent('scholarharness:workspace-user-view-reconciled', {
          detail: {
            conversationId: id,
            userViewRoot: data.userViewRoot || '',
            artifactCount: Number(data.artifactCount || 0),
            shortcutCount: Number(data.shortcutCount || 0),
            workbenchCount: Number(data.workbenchCount || 0)
          }
        }));
        return data;
      }).catch(function(error) {
        console.warn('[WorkspaceDirectory] User-view reconciliation failed:', error);
        return null;
      }).finally(function() {
        workspaceUserViewReconcileInFlight.delete(requestKey);
      });
      workspaceUserViewReconcileInFlight.set(requestKey, request);
      return request;
    }
    window.getComposerCodingRuntimeSelection = getComposerCodingRuntimeSelection;

    function getComposerProviderTroubleshooting(provider) {
      provider = normalizeComposerChatProvider(provider);
      if (provider === 'primary') {
        return '\n\n建议：请在输入框右侧切换到 Little corse，或检查 Grass 的 OpenRouter API Key。';
      }
      if (provider === 'codex') {
        return '\n\n建议：请在输入框右侧切换到 Little corse，或检查 Codex CLI、模型和推理强度配置。';
      }
      if (provider === 'pi' || provider === 'opencode') {
        return '\n\n建议：请在配置中心检查 ' + COMPOSER_PROVIDER_LABELS[provider] + ' CLI 路径、登录状态和模型配置，或切换到其他运行时。';
      }
      return '\n\n建议：请检查 Little corse API URL、API Key 和模型名；也可以通过输入框右侧的模型选择器切换服务。';
    }

    function getComposerFailureDisplay(provider, errorText, requestLabel) {
      var detail = String(errorText || '未知错误').trim();
      var wordFileBusy = /\.docx(?:['"\s]|$)/i.test(detail)
        && (/\bEBUSY\b/i.test(detail)
          || /resource busy or locked|being used by another process|另一个进程.*(?:使用|占用)|文件.*(?:被占用|正在使用)/i.test(detail));
      if (wordFileBusy) {
        return {
          message: 'Word 文件被占用',
          hint: '\n\n请关闭正在打开该文件的 Word/WPS 窗口及资源管理器预览窗格，等待几秒后重试。无需检查 Pi CLI、登录状态或模型配置。',
        };
      }
      if (/CODEX_MODEL_CAPACITY|selected model is at capacity|model[^\n]{0,80}\bat capacity\b|temporarily unavailable due to (?:high )?(?:load|demand)/i.test(detail)) {
        var capacityMessage = detail.indexOf('CODEX_MODEL_CAPACITY:') >= 0
          ? detail.slice(detail.indexOf('CODEX_MODEL_CAPACITY:') + 'CODEX_MODEL_CAPACITY:'.length).trim()
          : 'Codex 所选模型当前没有可用容量。';
        return {
          message: capacityMessage,
          hint: '\n\n这不是上下文过长，也不是 Codex CLI 或 App Server 连接故障。系统只会在没有正文输出和工具副作用时自动重试、切换本机 Codex 可用模型；仍失败时请稍后重试或在输入框右侧选择其他 Codex 模型。',
        };
      }
      if (/AGENT_CONTEXT_RECOVERY_FAILED/i.test(detail)) {
        return {
          message: detail.replace(/^.*AGENT_CONTEXT_RECOVERY_FAILED:\s*/i, ''),
          hint: '\n\n系统已经自动清理原生 Agent 会话，并用 Scholar Harness 的 compact 摘要安全重试了一次。当前仍超限通常表示本轮附件、Skill 内容或单次请求本身过大；请减少一次性材料，或选择上下文窗口更大的模型。',
        };
      }
      if (/PI_RPC_HANDSHAKE_/i.test(detail)) {
        return {
          message: 'Pi CLI 启动握手失败。',
          hint: '\n\n系统已在旧会话加载失败时自动保留原 JSONL，并尝试从 Scholar Harness 压缩历史新建会话。若新会话仍失败，请升级或重新部署 Pi CLI，并检查安全软件是否阻止 Node/Pi 子进程读写用户目录。',
        };
      }
      if (/context[_\s-]?length[_\s-]?exceeded|input exceeds (?:the )?context|maximum context (?:length|window)|context window[^\n]{0,100}(?:exceed|overflow)|prompt (?:is )?too (?:large|long)|too many (?:input )?tokens|ran out of room in [^\n]{0,80}context/i.test(detail)) {
        return {
          message: 'Agent 原生会话超过所选模型的上下文窗口。',
          hint: '\n\n系统仅在本轮尚未产生正文或工具副作用时自动 compact 并重试；如果已经发生工具活动，为避免重复修改文件会安全停止。请直接重试，系统将从压缩后的 Scholar Harness 历史继续。',
        };
      }
      if (/单条历史消息过长|历史消息过多|history message.*too long|history.*too many/i.test(detail)) {
        return {
          message: '对话历史上下文过长，本次请求未发送。',
          hint: '\n\n系统不会删除本地完整记录。请直接重试；如果仍然出现此提示，可新建对话后继续。切换模型或检查 Codex CLI 无法解决历史长度问题。',
        };
      }
      if (/failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(detail)) {
        return {
          message: '本地服务连接中断，当前请求没有收到完整响应。',
          hint: '\n\n系统已保留本轮指令。请确认 Scholar Harness 本地服务仍在运行后重试；这不是文献库内容损坏，也不代表已完成的检索结果丢失。',
        };
      }
      if (/(?:^|[^a-z])MCP(?:[^a-z]|$)|user_mcp__/i.test(detail)) {
        return {
          message: 'MCP 插件调用失败: ' + detail,
          hint: '\n\n系统会自动重建一次 MCP 会话；若仍失败，请在“插件”页面重新检测对应插件。',
        };
      }
      // 请求被中断（用户点停止、页面刷新、或连接断开）不是 API 配置错误：
      // 不能套用“检查 URL/Key/模型”的建议，否则会误导用户。
      if (/aborted|abort|interrupt|cancel|取消|中断|ChatRequestCancelled/i.test(detail)) {
        return {
          message: '已停止生成（请求被中断）。',
          hint: '\n\n这是主动停止或连接断开，不是 API 配置问题。请重新发送即可；若每次都在同一位置中断，再检查网络或本地服务。',
        };
      }
      provider = normalizeComposerChatProvider(provider);
      return {
        message: (COMPOSER_PROVIDER_LABELS[provider] || 'Little corse') + (requestLabel || '连接失败: ') + detail,
        hint: getComposerProviderTroubleshooting(provider),
      };
    }

    function getComposerCodexRememberedEffort(model) {
      var normalizedModel = String(model || '').trim();
      if (!normalizedModel) return '';
      try {
        var parsed = JSON.parse(localStorage.getItem(COMPOSER_CODEX_EFFORTS_KEY) || '{}');
        return String(parsed && parsed[normalizedModel] || '').trim();
      } catch (e) {
        return '';
      }
    }

    function rememberComposerCodexEffort(model, effort) {
      var normalizedModel = String(model || '').trim();
      var normalizedEffort = String(effort || '').trim();
      if (!normalizedModel || COMPOSER_CODEX_ALLOWED_EFFORTS.indexOf(normalizedEffort) === -1) return;
      try {
        var parsed = JSON.parse(localStorage.getItem(COMPOSER_CODEX_EFFORTS_KEY) || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
        parsed[normalizedModel] = normalizedEffort;
        localStorage.setItem(COMPOSER_CODEX_EFFORTS_KEY, JSON.stringify(parsed));
      } catch (e) {}
    }

    function getComposerCodexModels() {
      return composerCodexModels.length ? composerCodexModels : COMPOSER_CODEX_FALLBACK_MODELS;
    }

    function normalizeComposerCodexModelIdentity(value) {
      return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    }

    function getComposerCodexModelCanonicalScore(model) {
      var slug = normalizeComposerCodexModelIdentity(model && (model.slug || model.id));
      var displayName = normalizeComposerCodexModelIdentity(model && (model.displayName || model.display_name) || slug);
      var score = 0;
      if (slug && slug === displayName) score += 100;
      if (/^gpt-\d/.test(slug)) score += 50;
      if (!/(?:^|-)auto(?:-|$)/.test(slug)) score += 10;
      return score;
    }

    function dedupeComposerCodexModels(models) {
      var byDisplayName = new Map();
      (Array.isArray(models) ? models : []).forEach(function(model) {
        var slug = String(model && (model.slug || model.id) || '').trim();
        if (!slug) return;
        var key = normalizeComposerCodexModelIdentity(model.displayName || model.display_name || slug);
        var existing = byDisplayName.get(key);
        if (!existing) {
          byDisplayName.set(key, Object.assign({}, model, {
            aliases: Array.isArray(model.aliases) ? model.aliases.slice() : []
          }));
          return;
        }
        var preferred = getComposerCodexModelCanonicalScore(model) > getComposerCodexModelCanonicalScore(existing)
          ? model
          : existing;
        var discarded = preferred === model ? existing : model;
        var preferredSlug = String(preferred.slug || preferred.id || '').trim();
        var aliases = []
          .concat(Array.isArray(preferred.aliases) ? preferred.aliases : [])
          .concat(Array.isArray(discarded.aliases) ? discarded.aliases : [])
          .concat(String(discarded.slug || discarded.id || '').trim())
          .filter(function(alias, index, values) {
            return !!alias && alias !== preferredSlug && values.indexOf(alias) === index;
          });
        byDisplayName.set(key, Object.assign({}, preferred, { aliases: aliases }));
      });
      return Array.from(byDisplayName.values());
    }

    function getComposerCodexModelMeta(model) {
      var normalizedModel = String(model || '').trim();
      return getComposerCodexModels().find(function(item) {
        var slug = String(item && (item.slug || item.id) || '').trim();
        var aliases = Array.isArray(item && item.aliases) ? item.aliases : [];
        return slug === normalizedModel || aliases.indexOf(normalizedModel) !== -1;
      }) || null;
    }

    function getComposerCodexEffortLevels(model) {
      var meta = getComposerCodexModelMeta(model) || {};
      var levels = Array.isArray(meta.supportedReasoningLevels)
        ? meta.supportedReasoningLevels.map(function(level) {
            return {
              effort: String(level && level.effort || '').trim(),
              description: String(level && level.description || '').trim()
            };
          }).filter(function(level) {
            return COMPOSER_CODEX_ALLOWED_EFFORTS.indexOf(level.effort) !== -1;
          })
        : [];
      if (!levels.length) {
        levels = ['low', 'medium', 'high', 'xhigh'].map(function(effort) {
          return { effort: effort, description: '' };
        });
      }
      return levels;
    }

    function getComposerCodexSelection() {
      var codex = chatBridgeConfig && chatBridgeConfig.codex ? chatBridgeConfig.codex : {};
      var model = String(codex.model || 'gpt-5.5').trim() || 'gpt-5.5';
      var meta = getComposerCodexModelMeta(model) || {};
      var canonicalModel = String(meta.slug || meta.id || '').trim();
      if (canonicalModel) model = canonicalModel;
      var levels = getComposerCodexEffortLevels(model);
      var supported = levels.map(function(level) { return level.effort; });
      var effort = String(codex.reasoning_effort || '').trim();
      if (supported.indexOf(effort) === -1) {
        var remembered = getComposerCodexRememberedEffort(model);
        var recommended = String(meta.defaultReasoningLevel || '').trim();
        effort = supported.indexOf(remembered) !== -1
          ? remembered
          : (supported.indexOf(recommended) !== -1 ? recommended : (supported[0] || 'medium'));
      }
      return { model: model, reasoningEffort: effort };
    }
    window.getComposerCodexSelection = getComposerCodexSelection;

    function setComposerCodexStatus(message, isError) {
      var status = document.getElementById('composerCodexStatus');
      if (!status) return;
      status.textContent = String(message || '');
      status.classList.toggle('error', isError === true);
    }

    function updateComposerCodexLocalSelection(model, effort) {
      var normalizedModel = String(model || '').trim() || 'gpt-5.5';
      var levels = getComposerCodexEffortLevels(normalizedModel);
      var supported = levels.map(function(level) { return level.effort; });
      var meta = getComposerCodexModelMeta(normalizedModel) || {};
      var normalizedEffort = String(effort || '').trim();
      if (supported.indexOf(normalizedEffort) === -1) {
        var remembered = getComposerCodexRememberedEffort(normalizedModel);
        var recommended = String(meta.defaultReasoningLevel || '').trim();
        normalizedEffort = supported.indexOf(remembered) !== -1
          ? remembered
          : (supported.indexOf(recommended) !== -1 ? recommended : (supported[0] || 'medium'));
      }
      chatBridgeConfig.codex = Object.assign({}, chatBridgeConfig.codex || {}, {
        model: normalizedModel,
        reasoning_effort: normalizedEffort
      });
      rememberComposerCodexEffort(normalizedModel, normalizedEffort);
      try {
        localStorage.setItem(CHAT_BRIDGE_KEY, JSON.stringify(chatBridgeConfig));
      } catch (e) {}
      return { model: normalizedModel, reasoningEffort: normalizedEffort };
    }

    function renderComposerCodexSelectors() {
      var panel = document.getElementById('composerCodexOptions');
      var settings = document.getElementById('composerCodexRuntimeSettings');
      var portableSettings = document.getElementById('composerPortableRuntimeSettings');
      var modelSelect = document.getElementById('composerCodexModelSelect');
      var effortSelect = document.getElementById('composerCodexEffortSelect');
      var codexOption = document.querySelector('#composerProviderSelector .composer-provider-option[data-provider="codex"]');
      var containerOption = document.querySelector('#composerProviderSelector .composer-provider-main-page .composer-provider-option[data-provider="coding-agent"]');
      var menu = document.getElementById('composerProviderMenu');
      if (!panel || !modelSelect || !effortSelect) return;
      var selectedProvider = getComposerChatProvider();
      var selector = document.getElementById('composerProviderSelector');
      var expanded = composerCodexFlyoutOpen
        && !!(selector && selector.classList.contains('open'));
      panel.hidden = !expanded;
      if (settings) settings.hidden = selectedProvider !== 'codex';
      if (portableSettings) portableSettings.hidden = COMPOSER_PORTABLE_RUNTIME_IDS.indexOf(selectedProvider) === -1;
      if (selector) {
        selector.classList.toggle('codex-flyout-open', expanded);
      }
      if (menu) menu.classList.toggle('codex-page-open', expanded);
      if (codexOption) codexOption.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      if (containerOption) containerOption.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      if (!expanded) return;
      if (selectedProvider !== 'codex') {
        if (COMPOSER_PORTABLE_RUNTIME_IDS.indexOf(selectedProvider) !== -1) {
          renderComposerPortableRuntimeSelectors(selectedProvider);
        }
        return;
      }

      var selection = getComposerCodexSelection();
      var models = dedupeComposerCodexModels(getComposerCodexModels());
      if (!models.some(function(item) { return String(item.slug || item.id || '') === selection.model; })) {
        models.unshift({
          slug: selection.model,
          displayName: selection.model,
          defaultReasoningLevel: selection.reasoningEffort,
          supportedReasoningLevels: getComposerCodexEffortLevels(selection.model),
          unlisted: true
        });
      }
      modelSelect.innerHTML = '';
      models.forEach(function(model) {
        var slug = String(model.slug || model.id || '').trim();
        if (!slug) return;
        var option = document.createElement('option');
        option.value = slug;
        option.textContent = String(model.displayName || slug) + (model.unlisted ? '（当前配置）' : '');
        option.selected = slug === selection.model;
        modelSelect.appendChild(option);
      });
      modelSelect.disabled = !!composerCodexModelsPromise && !composerCodexModelsLoaded;

      var levels = getComposerCodexEffortLevels(selection.model);
      effortSelect.innerHTML = '';
      levels.forEach(function(level) {
        var option = document.createElement('option');
        option.value = level.effort;
        option.textContent = level.effort;
        option.title = level.description || level.effort;
        option.selected = level.effort === selection.reasoningEffort;
        effortSelect.appendChild(option);
      });
    }

    var composerMainChatView = 'menu';

    function getComposerProviderConfig(provider) {
      if (provider === 'primary') return chatBridgeConfig.primary;
      if (provider === 'secondary_vision') return chatBridgeConfig.secondaryVision;
      return chatBridgeConfig.secondary;
    }
    function getComposerProviderPool(provider) {
      var cfg = getComposerProviderConfig(provider);
      return (cfg && cfg.pool) ? cfg.pool : null;
    }
    function getComposerPoolModels(pool) {
      if (!pool || !pool.models) return [];
      return pool.models.filter(function (m) { return m.enabled !== false && m.model; });
    }
    function getComposerPoolActive(pool) {
      if (!pool) return null;
      var models = getComposerPoolModels(pool);
      for (var i = 0; i < models.length; i++) if (models[i].id === pool.active_model_id) return models[i];
      return models.length ? models[0] : null;
    }
    function isComposerApiEntryConfigured(entry, config) {
      if (!entry || !String(entry.model || '').trim()) return false;
      var apiUrl = String(entry.api_url || config && config.apiUrl || '').trim();
      var hasApiKey = !!(entry.api_key || entry.has_api_key || config && config.hasApiKey);
      return !!apiUrl && hasApiKey;
    }
    function composerModelDisplayName(m) { return m.model || m.label || '选择模型'; }
    function composerProviderEntryDisplayName(m) {
      var label = String(m && m.label || '').trim();
      var model = String(m && m.model || '').trim();
      return label && model && label !== model ? (label + ' · ' + model) : (label || model || '未命名厂商');
    }

    function getComposerActivePoolSelection(provider, requiresVision) {
      var poolProvider = provider === 'primary'
        ? 'primary'
        : (provider === 'secondary' && requiresVision ? 'secondary_vision' : 'secondary');
      var pool = getComposerProviderPool(poolProvider);
      var active = getComposerPoolActive(pool);
      if (!active) return null;
      return {
        provider: poolProvider,
        id: active.id,
        model: active.model || '',
        apiUrl: active.api_url || '',
        label: active.label || ''
      };
    }
    window.getComposerActivePoolSelection = getComposerActivePoolSelection;

    function renderComposerMainChatSelectors() {
      var panel = document.getElementById('composerMainChatOptions');
      var body = document.getElementById('composerMainChatBody');
      var title = document.getElementById('composerMainChatOptionsTitle');
      var selector = document.getElementById('composerProviderSelector');
      var menu = document.getElementById('composerProviderMenu');
      if (!panel || !body) return;
      var selectedProvider = getComposerChatProvider();
      var expanded = (selectedProvider === 'secondary' || selectedProvider === 'primary')
        && composerMainChatFlyoutOpen
        && !!(selector && selector.classList.contains('open'));
      panel.hidden = !expanded;
      if (selector) selector.classList.toggle('main-chat-flyout-open', expanded);
      if (menu) menu.classList.toggle('codex-page-open', expanded);
      if (!expanded) return;
      var provider = composerMainChatFlyoutProvider;
      var label = COMPOSER_PROVIDER_LABELS[provider] || 'Little corse';
      if (title) title.textContent = label;

      if (composerMainChatView === 'providers') {
        var pool = getComposerProviderPool(composerMainChatPoolProvider);
        var entries = getComposerPoolModels(pool);
        if (!entries.length) {
          body.innerHTML = '<div class="composer-codex-status">未配置提供方，请先到 设置 → ' + escapeHtml(label) + ' 添加厂家和 API</div>';
        } else {
          var providerHtml = '';
          entries.forEach(function(entry) {
            var selected = pool && entry.id === pool.active_model_id;
            var encodedId = encodeURIComponent(String(entry.id || ''));
            providerHtml += mmItem(
              composerProviderEntryDisplayName(entry),
              selected,
              "openComposerMainChatVendorModels(decodeURIComponent('" + encodedId + "'), event)"
            );
          });
          body.innerHTML = providerHtml;
        }
      } else if (composerMainChatView === 'models') {
        var modelPool = getComposerProviderPool(composerMainChatPoolProvider);
        var modelEntries = getComposerPoolModels(modelPool);
        var selectedEntry = modelEntries.find(function(entry) { return entry.id === composerMainChatSelectedEntryId; })
          || getComposerPoolActive(modelPool)
          || modelEntries[0];
        if (!selectedEntry) {
          body.innerHTML = '<div class="composer-codex-status">未配置可用厂商</div>';
        } else {
          body.innerHTML = '<div class="composer-codex-status">正在读取 ' + escapeHtml(selectedEntry.label || '当前厂商') + ' 的模型…</div>';
          loadComposerModelList(composerMainChatPoolProvider, selectedEntry, body);
        }
      } else if (composerMainChatView === 'effort') {
        var ehtml = '';
        COMPOSER_MAIN_CHAT_EFFORTS.forEach(function (eff) {
          var sel = eff === currentReasoningEffort;
          ehtml += '<button type="button" class="composer-mm-item' + (sel ? ' selected' : '') + '" onclick="handleComposerMainChatEffortChange(\'' + eff + '\', event)">'
            + '<span>' + eff + '</span>'
            + (sel ? '<span class="composer-mm-check" aria-hidden="true"></span>' : '')
            + '</button>';
        });
        body.innerHTML = ehtml;
      } else {
        var textPoolProvider = provider === 'primary' ? 'primary' : 'secondary';
        var pool2 = getComposerProviderPool(textPoolProvider);
        var active = getComposerPoolActive(pool2);
        var menuHtml =
            '<button type="button" class="composer-mm-row" onclick="openComposerMainChatModels(event, \'' + textPoolProvider + '\')">'
          +   '<span class="composer-mm-label">' + (provider === 'secondary' ? '文本厂商 / 模型' : '厂商 / 模型') + '</span>'
          +   '<span class="composer-mm-value">' + escapeHtml(active ? composerProviderEntryDisplayName(active) : '未配置') + '</span>'
          +   '<span class="composer-mm-chev">›</span>'
          + '</button>';
        if (provider === 'secondary') {
          var visionPool = getComposerProviderPool('secondary_vision');
          var visionActive = getComposerPoolActive(visionPool);
          menuHtml += '<button type="button" class="composer-mm-row" onclick="openComposerMainChatModels(event, \'secondary_vision\')">'
            + '<span class="composer-mm-label">视觉厂商 / 模型</span>'
            + '<span class="composer-mm-value">' + escapeHtml(visionActive ? composerProviderEntryDisplayName(visionActive) : '未配置') + '</span>'
            + '<span class="composer-mm-chev">›</span>'
            + '</button>';
        }
        body.innerHTML = menuHtml
          + '<button type="button" class="composer-mm-row" onclick="openComposerMainChatEfforts(event)">'
          +   '<span class="composer-mm-label">推理等级</span>'
          +   '<span class="composer-mm-value">' + escapeHtml(String(currentReasoningEffort || 'low')) + '</span>'
          +   '<span class="composer-mm-chev">›</span>'
          + '</button>';
      }
    }

    function mmItem(text, sel, onclick) {
      return '<button type="button" class="composer-mm-item' + (sel ? ' selected' : '') + '" onclick="' + onclick + '">'
        + '<span>' + escapeHtml(text) + '</span>' + (sel ? '<span class="composer-mm-check" aria-hidden="true"></span>' : '') + '</button>';
    }

    function loadComposerModelList(provider, entry, body) {
      function fallbackList() {
        if (!entry) {
          body.innerHTML = '<div class="composer-codex-status">无可用模型</div>';
          return;
        }
        var encodedId = encodeURIComponent(String(entry.id || ''));
        var encodedModel = encodeURIComponent(String(entry.model || ''));
        body.innerHTML = mmItem(
          (entry.model || '使用当前配置模型') + '（当前配置）',
          true,
          "selectComposerMainChatModel(decodeURIComponent('" + encodedId + "'), event, decodeURIComponent('" + encodedModel + "'))"
        ) + '<div class="composer-codex-status">厂商未返回模型列表；可在配置中心手动填写模型名称。</div>';
      }
      if (!entry || !entry.api_url) { fallbackList(); return; }
      fetch('/api/chat-bridge/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: provider, apiUrl: entry.api_url, modelId: entry.id })
      }).then(function (r) { return r.json(); }).then(function (data) {
        var models = data.models || [];
        if (!models.length) { fallbackList(); return; }
        var html = '';
        models.forEach(function (mo) {
          var sel = entry.model === mo;
          var encodedId = encodeURIComponent(String(entry.id || ''));
          var encodedModel = encodeURIComponent(String(mo || ''));
          html += mmItem(mo, sel, "selectComposerMainChatModel(decodeURIComponent('" + encodedId + "'), event, decodeURIComponent('" + encodedModel + "'))");
        });
        body.innerHTML = html;
      }).catch(fallbackList);
    }

    function openComposerMainChatModels(e, poolProvider) {
      if (e) e.stopPropagation();
      composerMainChatPoolProvider = poolProvider || composerMainChatFlyoutProvider;
      composerMainChatSelectedEntryId = '';
      composerMainChatView = 'providers';
      renderComposerMainChatSelectors();
    }
    function openComposerMainChatVendorModels(entryId, e) {
      if (e) e.stopPropagation();
      composerMainChatSelectedEntryId = String(entryId || '');
      composerMainChatView = 'models';
      renderComposerMainChatSelectors();
    }
    function openComposerMainChatEfforts(e) { if (e) e.stopPropagation(); composerMainChatView = 'effort'; renderComposerMainChatSelectors(); }
    function composerMainChatBack(e) {
      if (e) e.stopPropagation();
      if (composerMainChatView === 'models') { composerMainChatView = 'providers'; renderComposerMainChatSelectors(); return; }
      if (composerMainChatView !== 'menu') { composerMainChatView = 'menu'; renderComposerMainChatSelectors(); return; }
      backToComposerProviderMenu(e);
    }
    function selectComposerMainChatModel(id, e, model) {
      if (e) e.stopPropagation();
      var provider = composerMainChatPoolProvider;
      var cfg = getComposerProviderConfig(provider);
      if (!cfg || !cfg.pool) return;
      var previousPool = JSON.parse(JSON.stringify(cfg.pool));
      var previousModel = cfg.model;
      if (cfg && cfg.pool) {
        cfg.pool.active_model_id = id;
        cfg.pool.models.forEach(function (m) { if (m.id === id && model) m.model = model; });
        var act = null;
        cfg.pool.models.forEach(function (m) { if (m.id === id) act = m; });
        if (act) cfg.model = act.model;
      }
      composerMainChatView = 'menu';
      renderComposerProviderSelector();
      var bodySave = { mode: 'api' };
      bodySave[provider] = { pool: JSON.parse(JSON.stringify(cfg.pool)) };
      var revision = ++composerMainChatSelectionRevision;
      var status = document.getElementById('composerMainChatStatus');
      if (status) {
        status.textContent = '正在保存模型选择…';
        status.classList.remove('error');
      }
      var saveOperation = composerMainChatSelectionSavePromise.catch(function() {}).then(function() {
        return fetch('/api/chat-bridge/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodySave)
        });
      }).then(function(response) {
        return response.json().then(function(data) {
          if (!response.ok || !data.success) throw new Error(data.error || '模型配置保存失败');
          return window.ScholarHarnessModelPool.switchActiveModel(provider, id);
        });
      }).then(function (r) {
        if (!r || !r.success) throw new Error(r && r.error ? r.error : '激活模型失败');
        var status = document.getElementById('composerMainChatStatus');
        if (status && revision === composerMainChatSelectionRevision) {
          status.textContent = '已切换到 ' + (r.model || model || '');
          status.classList.remove('error');
        }
        return r;
      }).catch(function(error) {
        if (revision === composerMainChatSelectionRevision) {
          cfg.pool = previousPool;
          cfg.model = previousModel;
          renderComposerProviderSelector();
          var errorStatus = document.getElementById('composerMainChatStatus');
          if (errorStatus) {
            errorStatus.textContent = '切换失败：' + (error && error.message ? error.message : String(error));
            errorStatus.classList.add('error');
          }
        }
        throw error;
      });
      composerMainChatSelectionSavePromise = saveOperation;
      saveOperation.catch(function() {});
    }
    window.openComposerMainChatModels = openComposerMainChatModels;
    window.openComposerMainChatVendorModels = openComposerMainChatVendorModels;
    window.openComposerMainChatEfforts = openComposerMainChatEfforts;
    window.composerMainChatBack = composerMainChatBack;
    window.selectComposerMainChatModel = selectComposerMainChatModel;
    window.flushComposerMainChatSelectionSave = function() {
      return composerMainChatSelectionSavePromise;
    };

    function selectComposerMainChatProvider(provider, event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      var normalized = normalizeComposerChatProvider(provider);
      if (normalized === 'codex') {
        selectComposerCodexProvider(event);
        return;
      }
      if (normalized === 'pi' || normalized === 'opencode') {
        setComposerChatProvider(normalized);
        return;
      }
      try {
        localStorage.setItem(COMPOSER_PROVIDER_KEY, normalized);
      } catch (e) {}
      composerMainChatFlyoutProvider = normalized;
      composerMainChatPoolProvider = normalized === 'primary' ? 'primary' : 'secondary';
      composerMainChatSelectedEntryId = '';
      composerMainChatFlyoutOpen = true;
      composerMainChatView = 'menu';
      var selector = document.getElementById('composerProviderSelector');
      if (selector) selector.classList.add('open');
      renderComposerProviderSelector();
    }
    window.selectComposerMainChatProvider = selectComposerMainChatProvider;

    function handleComposerMainChatEffortChange(effort, event) {
      if (event) event.stopPropagation();
      if (COMPOSER_MAIN_CHAT_EFFORTS.indexOf(effort) === -1) return;
      currentReasoningEffort = effort;
      try {
        localStorage.setItem('scholarharness_main_chat_reasoning_effort', effort);
      } catch (e) {}
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reasoningEffort: effort })
      }).catch(function(error) {
        console.warn('[Composer] reasoning_effort sync failed:', error);
      });
      var status = document.getElementById('composerMainChatStatus');
      if (status) {
        status.textContent = '已保存：' + effort + '，从下一轮请求生效';
        status.classList.remove('error');
      }
      renderComposerProviderSelector();
    }
    window.handleComposerMainChatEffortChange = handleComposerMainChatEffortChange;

    function getComposerPortableRuntimeConfig(runtimeId) {
      if (COMPOSER_PORTABLE_RUNTIME_IDS.indexOf(runtimeId) === -1) return {};
      return chatBridgeConfig && chatBridgeConfig.agentRuntimes
        ? chatBridgeConfig.agentRuntimes[runtimeId] || {}
        : {};
    }

    function getComposerPortableRuntimeModelMeta(runtimeId, model) {
      var normalizedModel = String(model || '').trim();
      return (composerPortableRuntimeModels[runtimeId] || []).find(function(item) {
        return String(item && (item.slug || item.id) || '').trim() === normalizedModel;
      }) || null;
    }

    function getComposerPortableRuntimeEffortLevels(runtimeId, model) {
      var meta = getComposerPortableRuntimeModelMeta(runtimeId, model) || {};
      var levels = Array.isArray(meta.supportedReasoningLevels)
        ? meta.supportedReasoningLevels.map(function(level) {
            return {
              effort: String(level && typeof level === 'object' ? level.effort : level || '').trim(),
              description: String(level && typeof level === 'object' ? level.description || '' : '').trim()
            };
          }).filter(function(level) { return !!level.effort; })
        : [];
      if (!levels.length) {
        levels = ['low', 'medium', 'high', 'xhigh'].map(function(effort) {
          return { effort: effort, description: '' };
        });
      }
      return levels;
    }

    function getComposerPortableRuntimeSelection(runtimeId) {
      var runtime = getComposerPortableRuntimeConfig(runtimeId);
      var availableModels = composerPortableRuntimeModels[runtimeId] || [];
      var model = String(runtime.model || '').trim();
      if (!model && availableModels.length) {
        model = String(availableModels[0].slug || availableModels[0].id || '').trim();
      }
      var meta = getComposerPortableRuntimeModelMeta(runtimeId, model) || {};
      var levels = getComposerPortableRuntimeEffortLevels(runtimeId, model);
      var supported = levels.map(function(level) { return level.effort; });
      var effort = String(runtime.reasoning_effort || '').trim();
      if (supported.indexOf(effort) === -1) {
        var recommended = String(meta.defaultReasoningLevel || '').trim();
        effort = supported.indexOf(recommended) !== -1 ? recommended : (supported[0] || 'medium');
      }
      return { model: model, reasoningEffort: effort };
    }
    window.getComposerPortableRuntimeSelection = getComposerPortableRuntimeSelection;

    function setComposerPortableRuntimeStatus(message, isError, runtimeId) {
      if (COMPOSER_PORTABLE_RUNTIME_IDS.indexOf(runtimeId) !== -1) {
        composerPortableRuntimeStatus[runtimeId] = {
          message: String(message || ''),
          isError: isError === true
        };
        if (getComposerChatProvider() !== runtimeId) return;
      }
      var status = document.getElementById('composerPortableRuntimeStatus');
      if (!status) return;
      status.textContent = String(message || '');
      status.classList.toggle('error', isError === true);
    }

    function updateComposerPortableRuntimeLocalSelection(runtimeId, model, effort) {
      if (COMPOSER_PORTABLE_RUNTIME_IDS.indexOf(runtimeId) === -1) return null;
      var normalizedModel = String(model || '').trim();
      var levels = getComposerPortableRuntimeEffortLevels(runtimeId, normalizedModel);
      var supported = levels.map(function(level) { return level.effort; });
      var meta = getComposerPortableRuntimeModelMeta(runtimeId, normalizedModel) || {};
      var normalizedEffort = String(effort || '').trim();
      if (supported.indexOf(normalizedEffort) === -1) {
        var recommended = String(meta.defaultReasoningLevel || '').trim();
        normalizedEffort = supported.indexOf(recommended) !== -1 ? recommended : (supported[0] || 'medium');
      }
      if (!chatBridgeConfig || typeof chatBridgeConfig !== 'object') chatBridgeConfig = {};
      chatBridgeConfig.agentRuntimes = Object.assign({}, chatBridgeConfig.agentRuntimes || {});
      chatBridgeConfig.agentRuntimes[runtimeId] = Object.assign({}, chatBridgeConfig.agentRuntimes[runtimeId] || {}, {
        model: normalizedModel,
        reasoning_effort: normalizedEffort
      });
      try {
        localStorage.setItem(CHAT_BRIDGE_KEY, JSON.stringify(chatBridgeConfig));
      } catch (e) {}
      return { runtimeId: runtimeId, model: normalizedModel, reasoningEffort: normalizedEffort };
    }

    function renderComposerPortableRuntimeSelectors(runtimeId) {
      if (COMPOSER_PORTABLE_RUNTIME_IDS.indexOf(runtimeId) === -1) return;
      var modelLabel = document.getElementById('composerPortableRuntimeModelLabel');
      var modelSelect = document.getElementById('composerPortableRuntimeModelSelect');
      var effortSelect = document.getElementById('composerPortableRuntimeEffortSelect');
      if (!modelSelect || !effortSelect) return;
      var runtimeLabel = COMPOSER_PROVIDER_LABELS[runtimeId] || runtimeId;
      if (modelLabel) modelLabel.textContent = runtimeLabel + ' 模型';
      var savedStatus = composerPortableRuntimeStatus[runtimeId];
      if (savedStatus && savedStatus.message) {
        setComposerPortableRuntimeStatus(savedStatus.message, savedStatus.isError, runtimeId);
      }
      var selection = getComposerPortableRuntimeSelection(runtimeId);
      var models = (composerPortableRuntimeModels[runtimeId] || []).slice();
      if (selection.model && !models.some(function(item) {
        return String(item && (item.slug || item.id) || '').trim() === selection.model;
      })) {
        models.unshift({
          slug: selection.model,
          displayName: selection.model,
          defaultReasoningLevel: selection.reasoningEffort,
          supportedReasoningLevels: getComposerPortableRuntimeEffortLevels(runtimeId, selection.model),
          unlisted: true
        });
      }
      modelSelect.innerHTML = '';
      if (!models.length) {
        var emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = '请先在配置中心配置模型厂商';
        emptyOption.selected = true;
        modelSelect.appendChild(emptyOption);
      } else {
        models.forEach(function(model) {
          var slug = String(model && (model.slug || model.id) || '').trim();
          if (!slug) return;
          var option = document.createElement('option');
          option.value = slug;
          var displayName = String(model.displayName || model.display_name || slug);
          var provider = String(model.provider || '').trim();
          option.textContent = (provider ? provider + ' · ' : '') + displayName + (model.unlisted ? '（当前配置）' : '');
          option.selected = slug === selection.model;
          modelSelect.appendChild(option);
        });
      }
      modelSelect.disabled = !models.length || (!!composerPortableRuntimeModelsPromise[runtimeId] && !composerPortableRuntimeModelsLoaded[runtimeId]);

      effortSelect.innerHTML = '';
      getComposerPortableRuntimeEffortLevels(runtimeId, selection.model).forEach(function(level) {
        var option = document.createElement('option');
        option.value = level.effort;
        option.textContent = level.effort;
        option.title = level.description || level.effort;
        option.selected = level.effort === selection.reasoningEffort;
        effortSelect.appendChild(option);
      });
      effortSelect.disabled = !selection.model;
    }

    async function loadComposerPortableRuntimeModels(runtimeId, forceRefresh) {
      if (COMPOSER_PORTABLE_RUNTIME_IDS.indexOf(runtimeId) === -1) return [];
      if (composerPortableRuntimeModelsPromise[runtimeId] && !forceRefresh) {
        return composerPortableRuntimeModelsPromise[runtimeId];
      }
      composerPortableRuntimeModelsLoaded[runtimeId] = false;
      setComposerPortableRuntimeStatus('正在读取 ' + (COMPOSER_PROVIDER_LABELS[runtimeId] || runtimeId) + ' 可用模型…', false, runtimeId);
      renderComposerPortableRuntimeSelectors(runtimeId);
      composerPortableRuntimeModelsPromise[runtimeId] = (async function() {
        try {
          var response = await fetch('/api/chat-bridge/agent-runtimes/' + runtimeId + '/models?_=' + Date.now(), { cache: 'no-store' });
          var data = await response.json();
          if (!response.ok || !data.success) throw new Error(data.error || '模型列表读取失败');
          composerPortableRuntimeModels[runtimeId] = Array.isArray(data.models) ? data.models : [];
          if (!composerPortableRuntimeModels[runtimeId].length) throw new Error('没有读取到可用模型');
          setComposerPortableRuntimeStatus('已读取 ' + composerPortableRuntimeModels[runtimeId].length + ' 个模型；选择会自动保存并用于下一次请求。', false, runtimeId);
        } catch (error) {
          composerPortableRuntimeModels[runtimeId] = [];
          setComposerPortableRuntimeStatus('模型读取失败：' + (error && error.message ? error.message : String(error)) + '。请先在配置中心完成厂商 API 或登录配置。', true, runtimeId);
        } finally {
          composerPortableRuntimeModelsLoaded[runtimeId] = true;
          composerPortableRuntimeModelsPromise[runtimeId] = null;
          var current = getComposerPortableRuntimeSelection(runtimeId);
          updateComposerPortableRuntimeLocalSelection(runtimeId, current.model, current.reasoningEffort);
          renderComposerProviderSelector();
        }
        return composerPortableRuntimeModels[runtimeId];
      })();
      return composerPortableRuntimeModelsPromise[runtimeId];
    }
    window.loadComposerPortableRuntimeModels = loadComposerPortableRuntimeModels;

    function flushComposerPortableRuntimeSelectionSave(runtimeId) {
      if (COMPOSER_PORTABLE_RUNTIME_IDS.indexOf(runtimeId) === -1) return Promise.resolve();
      if (composerPortableRuntimeSaveTimer[runtimeId]) {
        clearTimeout(composerPortableRuntimeSaveTimer[runtimeId]);
        composerPortableRuntimeSaveTimer[runtimeId] = null;
      }
      var selection = composerPortableRuntimePendingSelection[runtimeId];
      if (!selection) return composerPortableRuntimeSaveChain[runtimeId];
      composerPortableRuntimePendingSelection[runtimeId] = null;
      composerPortableRuntimeSaveChain[runtimeId] = composerPortableRuntimeSaveChain[runtimeId].catch(function() {}).then(async function() {
        var runtimePayload = {};
        runtimePayload[runtimeId] = {
          model: selection.model,
          reasoning_effort: selection.reasoningEffort
        };
        var response = await fetch('/api/chat-bridge/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_runtimes: runtimePayload })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Agent 模型设置保存失败');
        var current = getComposerPortableRuntimeSelection(runtimeId);
        if (current.model === selection.model && current.reasoningEffort === selection.reasoningEffort) {
          setComposerPortableRuntimeStatus('已保存：' + selection.model + ' / ' + selection.reasoningEffort, false, runtimeId);
        }
        return selection;
      }).catch(function(error) {
        setComposerPortableRuntimeStatus('保存失败：' + (error && error.message ? error.message : String(error)), true, runtimeId);
        throw error;
      });
      return composerPortableRuntimeSaveChain[runtimeId];
    }
    window.flushComposerPortableRuntimeSelectionSave = flushComposerPortableRuntimeSelectionSave;

    function scheduleComposerPortableRuntimeSelectionSave(selection) {
      if (!selection || COMPOSER_PORTABLE_RUNTIME_IDS.indexOf(selection.runtimeId) === -1) return;
      var runtimeId = selection.runtimeId;
      composerPortableRuntimePendingSelection[runtimeId] = selection;
      if (composerPortableRuntimeSaveTimer[runtimeId]) clearTimeout(composerPortableRuntimeSaveTimer[runtimeId]);
      setComposerPortableRuntimeStatus('正在保存 ' + selection.model + ' / ' + selection.reasoningEffort + '…', false, runtimeId);
      composerPortableRuntimeSaveTimer[runtimeId] = setTimeout(function() {
        flushComposerPortableRuntimeSelectionSave(runtimeId).catch(function() {});
      }, 180);
    }

    function handleComposerPortableRuntimeModelChange(model, event) {
      if (event) event.stopPropagation();
      var runtimeId = getComposerChatProvider();
      if (COMPOSER_PORTABLE_RUNTIME_IDS.indexOf(runtimeId) === -1) return;
      var meta = getComposerPortableRuntimeModelMeta(runtimeId, model) || {};
      var levels = getComposerPortableRuntimeEffortLevels(runtimeId, model).map(function(level) { return level.effort; });
      var recommended = String(meta.defaultReasoningLevel || '').trim();
      var effort = levels.indexOf(recommended) !== -1 ? recommended : (levels[0] || 'medium');
      var selection = updateComposerPortableRuntimeLocalSelection(runtimeId, model, effort);
      renderComposerProviderSelector();
      scheduleComposerPortableRuntimeSelectionSave(selection);
    }
    window.handleComposerPortableRuntimeModelChange = handleComposerPortableRuntimeModelChange;

    function handleComposerPortableRuntimeEffortChange(effort, event) {
      if (event) event.stopPropagation();
      var runtimeId = getComposerChatProvider();
      if (COMPOSER_PORTABLE_RUNTIME_IDS.indexOf(runtimeId) === -1) return;
      var current = getComposerPortableRuntimeSelection(runtimeId);
      var selection = updateComposerPortableRuntimeLocalSelection(runtimeId, current.model, effort);
      renderComposerProviderSelector();
      scheduleComposerPortableRuntimeSelectionSave(selection);
    }
    window.handleComposerPortableRuntimeEffortChange = handleComposerPortableRuntimeEffortChange;

    async function loadComposerCodexModels(forceRefresh) {
      if (composerCodexModelsPromise && !forceRefresh) return composerCodexModelsPromise;
      composerCodexModelsLoaded = false;
      setComposerCodexStatus('正在读取本机 Codex 可用模型…', false);
      renderComposerCodexSelectors();
      composerCodexModelsPromise = (async function() {
        try {
          var response = await fetch('/api/chat-bridge/codex/models?_=' + Date.now(), { cache: 'no-store' });
          var data = await response.json();
          if (!response.ok || !data.success) throw new Error(data.error || '模型列表读取失败');
          composerCodexModels = dedupeComposerCodexModels(data.models);
          if (!composerCodexModels.length) composerCodexModels = COMPOSER_CODEX_FALLBACK_MODELS.slice();
          setComposerCodexStatus('模型与推理强度会自动保存，并用于下一次 Codex 请求。', false);
        } catch (e) {
          composerCodexModels = COMPOSER_CODEX_FALLBACK_MODELS.slice();
          setComposerCodexStatus('未读取到本机模型缓存，暂时显示回退列表。', true);
        } finally {
          composerCodexModelsLoaded = true;
          composerCodexModelsPromise = null;
          var current = getComposerCodexSelection();
          updateComposerCodexLocalSelection(current.model, current.reasoningEffort);
          renderComposerProviderSelector();
        }
        return composerCodexModels;
      })();
      return composerCodexModelsPromise;
    }
    window.loadComposerCodexModels = loadComposerCodexModels;

    function flushComposerCodexSelectionSave() {
      if (composerCodexSaveTimer) {
        clearTimeout(composerCodexSaveTimer);
        composerCodexSaveTimer = null;
      }
      if (!composerCodexPendingSelection) return composerCodexSaveChain;
      var selection = composerCodexPendingSelection;
      composerCodexPendingSelection = null;
      composerCodexSaveChain = composerCodexSaveChain.catch(function() {}).then(async function() {
        var response = await fetch('/api/chat-bridge/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            codex: {
              model: selection.model,
              reasoning_effort: selection.reasoningEffort
            }
          })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Codex 设置保存失败');
        var current = getComposerCodexSelection();
        if (current.model === selection.model && current.reasoningEffort === selection.reasoningEffort) {
          setComposerCodexStatus('已保存：' + selection.model + ' / ' + selection.reasoningEffort, false);
        }
        return selection;
      }).catch(function(error) {
        setComposerCodexStatus('保存失败：' + (error && error.message ? error.message : String(error)), true);
        throw error;
      });
      return composerCodexSaveChain;
    }
    window.flushComposerCodexSelectionSave = flushComposerCodexSelectionSave;

    function scheduleComposerCodexSelectionSave(selection) {
      composerCodexPendingSelection = selection;
      if (composerCodexSaveTimer) clearTimeout(composerCodexSaveTimer);
      setComposerCodexStatus('正在保存 ' + selection.model + ' / ' + selection.reasoningEffort + '…', false);
      composerCodexSaveTimer = setTimeout(function() {
        flushComposerCodexSelectionSave().catch(function() {});
      }, 180);
    }

    function handleComposerCodexModelChange(model, event) {
      if (event) event.stopPropagation();
      var meta = getComposerCodexModelMeta(model) || {};
      var remembered = getComposerCodexRememberedEffort(model);
      var levels = getComposerCodexEffortLevels(model).map(function(level) { return level.effort; });
      var recommended = String(meta.defaultReasoningLevel || '').trim();
      var effort = levels.indexOf(remembered) !== -1
        ? remembered
        : (levels.indexOf(recommended) !== -1 ? recommended : (levels[0] || 'medium'));
      var selection = updateComposerCodexLocalSelection(model, effort);
      renderComposerProviderSelector();
      scheduleComposerCodexSelectionSave(selection);
    }
    window.handleComposerCodexModelChange = handleComposerCodexModelChange;

    function handleComposerCodexEffortChange(effort, event) {
      if (event) event.stopPropagation();
      var current = getComposerCodexSelection();
      var selection = updateComposerCodexLocalSelection(current.model, effort);
      renderComposerProviderSelector();
      scheduleComposerCodexSelectionSave(selection);
    }
    window.handleComposerCodexEffortChange = handleComposerCodexEffortChange;

    function closeComposerProviderMenu() {
      var selector = document.getElementById('composerProviderSelector');
      if (selector) {
        selector.classList.remove('open');
      }
      composerCodexFlyoutOpen = false;
      composerMainChatFlyoutOpen = false;
      renderComposerCodexSelectors();
      renderComposerMainChatSelectors();
    }

    function openComposerConfigCenter(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      closeComposerProviderMenu();
      if (typeof window.showConfigCenterDialog === 'function') {
        window.showConfigCenterDialog();
      }
    }
    window.openComposerConfigCenter = openComposerConfigCenter;

    function renderComposerProviderSelector() {
      var provider = getComposerChatProvider();
      var label = COMPOSER_PROVIDER_LABELS[provider] || COMPOSER_PROVIDER_LABELS.secondary;
      var modelHint = getComposerProviderModelHint(provider);
      var labelEl = document.getElementById('composerProviderLabel');
      var modelEl = document.getElementById('composerProviderModel');
      var btn = document.getElementById('composerProviderBtn');
      var selector = document.getElementById('composerProviderSelector');
      if (labelEl) labelEl.textContent = label;
      if (modelEl) modelEl.textContent = modelHint;
      if (btn) btn.title = label + '：' + modelHint;
      if (!selector) return;
      selector.querySelectorAll('.composer-provider-option').forEach(function(option) {
        var optionProvider = option.getAttribute('data-provider');
        var isCodingRuntime = provider === 'codex' || provider === 'pi' || provider === 'opencode';
        var active = optionProvider === provider || (optionProvider === 'coding-agent' && isCodingRuntime);
        var optionModel = option.querySelector('.composer-provider-option-model');
        if (optionModel) {
          var configuredModel = optionProvider === 'coding-agent'
            ? (isCodingRuntime ? ((COMPOSER_PROVIDER_LABELS[provider] || provider) + ' · ' + getComposerProviderModelHint(provider)) : 'Codex · Pi · OpenCode')
            : getComposerProviderModelHint(optionProvider);
          optionModel.textContent = configuredModel;
          option.title = (optionProvider === 'coding-agent' ? 'Agent corse' : (COMPOSER_PROVIDER_LABELS[optionProvider] || optionProvider)) + '：' + configuredModel;
        }
        option.classList.toggle('active', active);
        option.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      renderComposerCodexSelectors();
      renderComposerMainChatSelectors();
    }

    function toggleComposerProviderMenu(event) {
      if (event) event.stopPropagation();
      var selector = document.getElementById('composerProviderSelector');
      if (!selector) return;
      var shouldOpen = !selector.classList.contains('open');
      composerCodexFlyoutOpen = false;
      composerMainChatFlyoutOpen = false;
      selector.classList.toggle('open', shouldOpen);
      renderComposerProviderSelector();
    }
    window.toggleComposerProviderMenu = toggleComposerProviderMenu;

    function openComposerCodingAgentContainer(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      composerMainChatFlyoutOpen = false;
      composerCodexFlyoutOpen = true;
      var selector = document.getElementById('composerProviderSelector');
      if (selector) selector.classList.add('open');
      renderComposerProviderSelector();
      var selectedProvider = getComposerChatProvider();
      if (selectedProvider === 'codex') loadComposerCodexModels(false);
      else if (COMPOSER_PORTABLE_RUNTIME_IDS.indexOf(selectedProvider) !== -1) loadComposerPortableRuntimeModels(selectedProvider, false);
    }
    window.openComposerCodingAgentContainer = openComposerCodingAgentContainer;

    function setComposerChatProvider(provider) {
      var normalized = normalizeComposerChatProvider(provider);
      try {
        localStorage.setItem(COMPOSER_PROVIDER_KEY, normalized);
      } catch (e) {}
      renderComposerProviderSelector();
      if (normalized === 'codex') {
        loadComposerCodexModels(false);
      } else if (COMPOSER_PORTABLE_RUNTIME_IDS.indexOf(normalized) !== -1) {
        loadComposerPortableRuntimeModels(normalized, false);
      } else {
        closeComposerProviderMenu();
      }
    }
    window.setComposerChatProvider = setComposerChatProvider;

    function selectComposerCodexProvider(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      composerCodexFlyoutOpen = true;
      try {
        localStorage.setItem(COMPOSER_PROVIDER_KEY, 'codex');
      } catch (e) {}
      var selector = document.getElementById('composerProviderSelector');
      if (selector) selector.classList.add('open');
      renderComposerProviderSelector();
      loadComposerCodexModels(false);
    }
    window.selectComposerCodexProvider = selectComposerCodexProvider;

    function selectComposerPortableRuntimeProvider(runtimeId, event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (COMPOSER_PORTABLE_RUNTIME_IDS.indexOf(runtimeId) === -1) return;
      composerCodexFlyoutOpen = true;
      try {
        localStorage.setItem(COMPOSER_PROVIDER_KEY, runtimeId);
      } catch (e) {}
      var selector = document.getElementById('composerProviderSelector');
      if (selector) selector.classList.add('open');
      renderComposerProviderSelector();
      loadComposerPortableRuntimeModels(runtimeId, false);
    }
    window.selectComposerPortableRuntimeProvider = selectComposerPortableRuntimeProvider;

    function backToComposerProviderMenu(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      composerCodexFlyoutOpen = false;
      composerMainChatFlyoutOpen = false;
      renderComposerProviderSelector();
    }
    window.backToComposerProviderMenu = backToComposerProviderMenu;

    document.addEventListener('click', function(event) {
      var target = event.target;
      if (target && target.closest && target.closest('#composerProviderSelector')) return;
      closeComposerProviderMenu();
    });

    function renderMainContextModelStatus() {
      var status = document.getElementById('mainContextModelStatus');
      if (status) status.innerHTML = '';
      renderComposerProviderSelector();
      renderWorkspaceDirectoryUi();
    }

    function renderMainContextSourceBar() {
      var bar = document.getElementById('mainContextSourceBar');
      if (!bar) {
        renderMainContextModelStatus();
        return;
      }
      var selection = loadMainContextSourceSelection();
      var selectedSkillTokens = loadMainContextSkillSelection();
      var skillActive = selectedSkillTokens.length > 0;
      var selectedCount = MAIN_CONTEXT_SOURCE_DEFS.reduce(function(count, item) {
        return count + (selection[item.id] === true ? 1 : 0);
      }, selectedSkillTokens.length + (activePdfPaperChatContext ? 1 : 0));
      bar.classList.toggle('expanded', mainContextSourceBarExpanded);
      var html = '<button type="button" class="main-context-source-trigger composer-context-btn" aria-label="持续使用的上下文" aria-expanded="' + (mainContextSourceBarExpanded ? 'true' : 'false') + '" onmouseenter="expandMainContextSourceBar()" onfocus="expandMainContextSourceBar()" title="持续使用的上下文">' +
        '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h8"></path><path d="M9 3v4"></path><path d="M15 3v4"></path><path d="M7 8h10l-1 5H8z"></path><path d="M12 13v8"></path></svg>' +
        (selectedCount > 0 ? '<span class="main-context-source-count" title="已选择 ' + selectedCount + ' 项">' + selectedCount + '</span>' : '') +
      '</button>' +
      '<div class="main-context-source-options" role="group" aria-label="持续使用的上下文">';
      MAIN_CONTEXT_SOURCE_DEFS.forEach(function(item) {
        var active = selection[item.id] === true;
        html += '<button type="button" class="main-context-source-btn' + (active ? ' active' : '') + '" title="' + escapeHtml(item.title) + '" aria-pressed="' + (active ? 'true' : 'false') + '" data-main-context-source="' + escapeHtml(item.id) + '" onclick="toggleMainContextSource(this.dataset.mainContextSource)">' +
          '<span>' + (active ? '✓ ' : '') + escapeHtml(item.label) + '</span>' +
        '</button>';
      });
      if (activePdfPaperChatContext) {
        var activePaperTitle = activePdfPaperChatContext.title || activePdfPaperChatContext.originalName || '当前论文';
        html += '<button type="button" class="main-context-source-btn active" title="' + escapeHtml(activePaperTitle) + '；点击取消当前论文上下文" aria-pressed="true" onclick="clearActivePdfPaperChatContext()">' +
          '<span>✓ 当前论文：' + escapeHtml(activePaperTitle) + ' ×</span>' +
        '</button>';
      }
      html += '<button type="button" class="main-context-source-btn' + (skillActive ? ' active' : '') + '" title="持续使用章节写作 Skill、期刊章节风格或用户 Skill；启用后每次发送都会自动附加这些规则" aria-pressed="' + (skillActive ? 'true' : 'false') + '" onclick="showMainContextSkillDialog()">' +
        '<span>' + (skillActive ? '✓ ' : '') + escapeHtml(getMainContextSelectedSkillLabel(selectedSkillTokens)) + '</span>' +
      '</button></div>';
      bar.innerHTML = html;
      renderMainContextModelStatus();
    }

    function setMainContextSourceBarExpanded(expanded) {
      mainContextSourceBarExpanded = expanded === true;
      var bar = document.getElementById('mainContextSourceBar');
      if (!bar) return;
      bar.classList.toggle('expanded', mainContextSourceBarExpanded);
      var trigger = bar.querySelector('.main-context-source-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', mainContextSourceBarExpanded ? 'true' : 'false');
    }

    function expandMainContextSourceBar() {
      if (mainContextSourceBarHoverTimer) {
        clearTimeout(mainContextSourceBarHoverTimer);
        mainContextSourceBarHoverTimer = null;
      }
      if (mainContextSourceBarExpanded) return;
      setMainContextSourceBarExpanded(true);
    }
    window.expandMainContextSourceBar = expandMainContextSourceBar;

    function handleMainContextSourceBarPointerLeave() {
      if (mainContextSourceBarHoverTimer) clearTimeout(mainContextSourceBarHoverTimer);
      mainContextSourceBarHoverTimer = setTimeout(function() {
        mainContextSourceBarHoverTimer = null;
        var bar = document.getElementById('mainContextSourceBar');
        if (bar && bar.matches(':hover')) return;
        collapseMainContextSourceBar();
      }, 120);
    }
    window.handleMainContextSourceBarPointerLeave = handleMainContextSourceBarPointerLeave;

    function toggleMainContextSourceBar(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      setMainContextSourceBarExpanded(!mainContextSourceBarExpanded);
    }
    window.toggleMainContextSourceBar = toggleMainContextSourceBar;

    function collapseMainContextSourceBar() {
      if (mainContextSourceBarHoverTimer) {
        clearTimeout(mainContextSourceBarHoverTimer);
        mainContextSourceBarHoverTimer = null;
      }
      if (!mainContextSourceBarExpanded) return;
      setMainContextSourceBarExpanded(false);
    }
    window.collapseMainContextSourceBar = collapseMainContextSourceBar;

    document.addEventListener('pointerdown', function(event) {
      if (!mainContextSourceBarExpanded) return;
      var bar = document.getElementById('mainContextSourceBar');
      if (bar && event.target && bar.contains(event.target)) return;
      collapseMainContextSourceBar();
    });
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') collapseMainContextSourceBar();
    });

    window.toggleMainContextSource = async function(sourceId) {
      if (!Object.prototype.hasOwnProperty.call(MAIN_CONTEXT_SOURCE_DEFAULTS, sourceId)) return;
      var selection = loadMainContextSourceSelection();
      var nextSelected = !selection[sourceId];
      if (sourceId === 'metaAnalysis') {
        if (nextSelected) {
          // A direct click from the homepage always means "all currently extracted
          // Meta tables". A scoped selection is only installed by the Meta page
          // handoff action below.
          selectAllMainMetaAnalysisData();
          setMainMetaAnalysisReturnContext(null);
        } else {
          // Cancelling the persistent Meta source must also cancel its data scope,
          // return affordance and composer guidance. Future turns then have no
          // Meta dataset/tool context unless the user explicitly enables it again.
          clearMainMetaAnalysisDataScope();
          setMainMetaAnalysisReturnContext(null);
        }
      } else if (sourceId === 'bibliometrics' || sourceId === 'autoResearch') {
        var workflowReturn = normalizeMainAnalysisWorkflowReturnContext(mainAnalysisWorkflowReturnContext);
        if (workflowReturn && workflowReturn.sourceId === sourceId) {
          setMainAnalysisWorkflowReturnContext(null);
        }
      }
      setMainContextSourceSelected(sourceId, nextSelected);
      if (sourceId === 'metaAnalysis' || sourceId === 'bibliometrics' || sourceId === 'autoResearch') {
        await syncMainSelectedAnalysisInputPlaceholder(nextSelected ? sourceId : '');
      }
      if (nextSelected && Object.prototype.hasOwnProperty.call(MAIN_CONTEXT_WORKSPACE_FOLDERS, sourceId)) {
        var workspaceDirectory = getWorkspaceDirectoryPayload(currentConversationId);
        await prepareSelectedAnalysisWorkspaceFolders(
          workspaceDirectory,
          null,
          null,
          sourceId
        );
      }
    };

    async function fetchMainContextJournalStyles(force) {
      if (mainContextJournalStylesLoaded && !force) return mainContextJournalStylesCache;
      var response = await fetch('/api/journal-styles/list?userId=' + encodeURIComponent(currentUserId || 'web-user'));
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '读取章节写作风格失败');
      mainContextJournalStylesCache = Array.isArray(data.journals) ? data.journals : [];
      mainContextJournalStylesLoaded = true;
      return mainContextJournalStylesCache;
    }

    async function fetchMainContextWritingSkillContent(chapterType) {
      var normalized = normalizeSkillChapterType(chapterType);
      var response = await fetch('/api/skill/' + encodeURIComponent(normalized));
      if (!response.ok) throw new Error('读取章节 Skill 失败：' + normalized);
      var content = await response.text();
      return content || '';
    }

    async function fetchMainContextJournalStyleContent(journalId, section) {
      var response = await fetch('/api/journal-styles/' + encodeURIComponent(journalId) + '/' + encodeURIComponent(section) + '?userId=' + encodeURIComponent(currentUserId || 'web-user'));
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '读取章节写作风格失败');
      return data;
    }

    async function fetchPersistentBundledAgentSkillContent(skillId) {
      var response = await fetch(
        getUserSkillApiBase() + '/bundled/' + encodeURIComponent(skillId) + '/content'
      );
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok || !data.success || !data.content) {
        throw new Error(data.error || '读取系统自带 Skill 失败');
      }
      return String(data.content || '');
    }

    async function buildPersistentMainContextSkillContext() {
      var selectedTokens = loadMainContextSkillSelection();
      if (selectedTokens.length === 0) return { prompt: '', entries: [], activeTokens: [] };
      var userSkills = [];
      var journalStyles = [];
      try {
        var loaded = await Promise.all([
          fetchUserSkills().catch(function(e) {
            console.warn('[UserSkills] Failed to load user skills for persistent context:', e);
            return [];
          }),
          fetchMainContextJournalStyles(false).catch(function(e) {
            console.warn('[UserSkills] Failed to load journal styles for persistent context:', e);
            return [];
          }),
          fetchAvailableAgentSkills().catch(function(e) {
            console.warn('[AgentSkills] Failed to load bundled skills for persistent context:', e);
            return [];
          })
        ]);
        userSkills = Array.isArray(loaded[0]) ? loaded[0] : [];
        journalStyles = Array.isArray(loaded[1]) ? loaded[1] : [];
      } catch (e) {
        console.warn('[UserSkills] Failed to prepare persistent skill sources:', e);
      }

      var activeTokens = [];
      var entries = [];
      var blocks = [];

      for (var i = 0; i < selectedTokens.length; i++) {
        var parsed = parseMainContextSkillToken(selectedTokens[i]);
        if (!parsed) continue;
        try {
          if (parsed.kind === 'skill') {
            var def = getMainContextWritingSkillDef(parsed.id);
            var skillContent = await fetchMainContextWritingSkillContent(parsed.id);
            if (!skillContent.trim()) continue;
            activeTokens.push(parsed.token);
            entries.push({
              id: parsed.id,
              token: parsed.token,
              kind: 'writing-skill',
              name: (def ? def.label : parsed.id) + ' Skill',
              trigger: parsed.token,
              description: '内置章节写作 Skill',
              persistent: true
            });
            blocks.push([
              '### ' + activeTokens.length + '. 写作 Skill：' + (def ? def.label : parsed.id),
              skillContent
            ].join('\n'));
          } else if (parsed.kind === 'style') {
            var journal = journalStyles.find(function(item) { return item && String(item.id || '') === String(parsed.journalId || ''); });
            if (!journal) continue;
            var styleData = await fetchMainContextJournalStyleContent(parsed.journalId, parsed.section);
            var styleGuide = styleData.styleGuide || '';
            if (!styleGuide.trim()) continue;
            activeTokens.push(parsed.token);
            entries.push({
              id: parsed.token,
              token: parsed.token,
              kind: 'journal-style',
              name: (styleData.journal || journal.name || parsed.journalId) + ' - ' + getMainContextStyleSectionLabel(parsed.section),
              trigger: parsed.token,
              description: '期刊章节写作风格',
              persistent: true
            });
            blocks.push([
              '### ' + activeTokens.length + '. 章节写作风格：' + (styleData.journal || journal.name || parsed.journalId) + ' - ' + getMainContextStyleSectionLabel(parsed.section),
              styleGuide
            ].join('\n'));
          } else if (parsed.kind === 'user') {
            var userSkill = userSkills.find(function(skill) {
              return skill && skill.enabled !== false && String(skill.id || '') === String(parsed.id || '');
            });
            if (!userSkill || !String(userSkill.prompt || '').trim()) continue;
            activeTokens.push(parsed.token);
            entries.push({
              id: userSkill.id,
              token: parsed.token,
              kind: 'user-skill',
              name: userSkill.name,
              trigger: userSkill.trigger,
              description: userSkill.description,
              persistent: true
            });
            blocks.push([
              '### ' + activeTokens.length + '. 用户 Skill：/' + (userSkill.trigger || '') + ' - ' + (userSkill.name || '用户 Skill'),
              userSkill.description ? ('说明：' + userSkill.description) : '',
              'Skill 指令：',
              userSkill.prompt || ''
            ].filter(Boolean).join('\n'));
          } else if (parsed.kind === 'agent') {
            var agentSkill = availableAgentSkills.find(function(skill) {
              return skill && skill.source === 'bundled' && String(skill.id || '') === String(parsed.id || '');
            });
            if (!agentSkill) continue;
            var agentSkillContent = await fetchPersistentBundledAgentSkillContent(parsed.id);
            if (!agentSkillContent.trim()) continue;
            activeTokens.push(parsed.token);
            entries.push({
              id: agentSkill.id,
              token: parsed.token,
              kind: 'agent-skill',
              name: agentSkill.name,
              trigger: parsed.token,
              description: agentSkill.description,
              persistent: true
            });
            blocks.push([
              '### ' + activeTokens.length + '. 系统自带 Skill：' + (agentSkill.name || agentSkill.id),
              agentSkillContent
            ].join('\n'));
          }
        } catch (e) {
          console.warn('[UserSkills] Failed to load persistent skill token ' + parsed.token + ':', e);
        }
      }

      if (activeTokens.length !== selectedTokens.length) {
        saveMainContextSkillSelection(activeTokens);
        renderMainContextSourceBar();
      }
      if (!blocks.length) return { prompt: '', entries: [], activeTokens: activeTokens };
      return {
        prompt: [
          '## 持续使用的 Skill / 写作风格',
          '用户在输入框上方“持续使用”区域固定启用了以下写作 Skill 或章节风格。请在本轮和后续每次对话中默认遵守这些规则，把它们作为高优先级写作/分析约束；如果用户本轮明确提出冲突要求，以用户本轮明确要求为准。',
          '',
          blocks.join('\n\n')
        ].join('\n'),
        entries: entries,
        activeTokens: activeTokens
      };
    }

    async function showMainContextSkillDialog() {
      showHomeUtilityPage(
        'persistent-skill',
        'Skill',
        '选择持续使用规则，并添加、导入和维护 Skill；可同时选择章节写作 Skill、期刊章节写作风格和用户自定义 Skill，保存后自动加入每次主对话请求。',
        '<div class="home-page-card" style="color:var(--text-secondary);font-size:13px;">正在读取 Skill 和章节风格...</div>'
      );
      try {
        await Promise.all([
          fetchUserSkills(),
          fetchAvailableAgentSkills(),
          fetchMainContextJournalStyles(false).catch(function(e) {
            console.warn('[UserSkills] Failed to load journal styles for dialog:', e);
            return [];
          })
        ]);
        renderMainContextSkillDialog();
      } catch (e) {
        showHomeUtilityPage(
          'persistent-skill',
          'Skill',
          '选择持续使用规则，并添加、导入和维护 Skill；可同时选择章节写作 Skill、期刊章节写作风格和用户自定义 Skill，保存后自动加入每次主对话请求。',
          '<div class="home-page-card" style="color:var(--danger-color);line-height:1.6;">读取 Skill 失败：' + escapeHtml(e.message || String(e)) + '</div>'
        );
      }
    }
    window.showMainContextSkillDialog = showMainContextSkillDialog;

    function renderMainContextSkillSelectionSummary(tokens) {
      var selectedTokens = Array.isArray(tokens) ? tokens : [];
      if (!selectedTokens.length) {
        return '<div style="padding:10px 11px;border:1px dashed var(--border-color);border-radius:9px;color:var(--text-secondary);font-size:12px;line-height:1.6;background:var(--bg-input);margin-bottom:12px;">当前没有固定使用的 Skill。</div>';
      }
      return '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px;">' + selectedTokens.map(function(token) {
        var label = getMainContextSkillLabel(token) || token;
        return '<button type="button" data-token="' + escapeHtml(token) + '" onclick="removeMainContextSkillSelectionFromDialog(this.dataset.token)" title="取消选择" style="display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid var(--border-color);border-radius:999px;background:transparent;color:var(--text-primary);font-size:12px;cursor:pointer;max-width:100%;">' +
          '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(label) + '</span><span aria-hidden="true" style="color:var(--text-secondary);">×</span>' +
        '</button>';
      }).join('') + '</div>';
    }

    function renderMainContextSkillDialog() {
      var selectedTokens = loadMainContextSkillSelection();
      var selectedSet = new Set(selectedTokens.map(String));
      var selectedChipsHtml = '<div id="mainContextSkillSelectionSummary">' + renderMainContextSkillSelectionSummary(selectedTokens) + '</div>';

      var writingSkillHtml = MAIN_CONTEXT_WRITING_SKILL_DEFS.map(function(def) {
        var checked = selectedSet.has(def.token);
        return '<label class="skill-catalog-item" title="持续使用' + escapeHtml(def.label) + '章节的写作结构、论证节奏和质量规则" style="display:flex;align-items:center;gap:10px;cursor:pointer;min-width:0;">' +
            '<span class="skill-catalog-icon category-chapter" aria-hidden="true"></span>' +
            '<input type="checkbox" data-main-context-skill-token="' + escapeHtml(def.token) + '" ' + (checked ? 'checked ' : '') + 'style="width:14px;height:14px;margin:0;accent-color:var(--accent-color);">' +
            '<span style="font-size:12px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(def.label) + '</span>' +
          '</label>';
      }).join('');
      writingSkillHtml = '<div class="persistent-skill-scroll-panel">' +
        '<div style="font-size:13px;font-weight:800;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:8px;">内置章节写作 Skill</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:7px;">' + writingSkillHtml + '</div>' +
      '</div>';

      var styleJournals = Array.isArray(mainContextJournalStylesCache) ? mainContextJournalStylesCache : [];
      var styleHtml = styleJournals.length
        ? styleJournals.map(function(journal) {
          var journalId = String(journal.id || '');
          var sectionHtml = MAIN_CONTEXT_STYLE_SECTIONS.map(function(section) {
            var token = 'style:' + journalId + ':' + section;
            var checked = selectedSet.has(token);
            return '<label class="skill-catalog-item" style="display:flex;align-items:center;gap:10px;cursor:pointer;min-width:0;">' +
              '<span class="skill-catalog-icon category-style" aria-hidden="true"></span>' +
              '<input type="checkbox" data-main-context-skill-token="' + escapeHtml(token) + '" ' + (checked ? 'checked ' : '') + 'style="width:14px;height:14px;margin:0;accent-color:var(--accent-color);">' +
              '<span style="font-size:12px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(getMainContextStyleSectionLabel(section)) + '</span>' +
            '</label>';
          }).join('');
          return '<div style="border:1px solid var(--border-color);border-radius:9px;background:var(--bg-input);padding:10px 11px;margin-bottom:8px;">' +
            '<div style="font-size:13px;font-weight:800;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:8px;">' + escapeHtml(journal.name || journal.id || '期刊风格') + '</div>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:7px;">' + sectionHtml + '</div>' +
          '</div>';
        }).join('')
        : '<div style="padding:14px;border:1px dashed var(--border-color);border-radius:9px;color:var(--text-secondary);font-size:12px;line-height:1.7;background:var(--bg-input);">还没有已分析的章节写作风格。完成期刊风格分析后，这里会自动显示可选章节。</div>';
      styleHtml = '<div class="persistent-skill-scroll-panel">' + styleHtml + '</div>';

      var customSkills = (Array.isArray(userSkillManagerSkills) ? userSkillManagerSkills : []).filter(function(skill) {
        return !!skill;
      });
      var bundledSkills = (Array.isArray(availableAgentSkills) ? availableAgentSkills : []).filter(function(skill) {
        return skill && skill.source === 'bundled';
      });
      var bundledSkillHtml = bundledSkills.length
        ? bundledSkills.map(function(skill) {
          var token = 'agent:' + String(skill.id || '');
          var checked = selectedSet.has(token);
          return '<div class="skill-catalog-item" style="display:flex;align-items:center;gap:10px;margin-bottom:0;">' +
            '<span class="skill-catalog-icon category-system" aria-hidden="true"></span>' +
            '<div style="display:flex;align-items:flex-start;gap:8px;min-width:0;flex:1;">' +
              '<span style="min-width:0;flex:1;">' +
                '<span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;font-weight:800;color:var(--text-primary);">' +
                  '<span>' + escapeHtml(skill.name || skill.id || '系统 Skill') + '</span>' +
                  '<span style="padding:1px 5px;border-radius:999px;background:var(--modal-tip-bg);color:var(--accent-color);font-size:9px;">系统自带</span>' +
                '</span>' +
                '<span style="display:block;margin-top:3px;font-size:11px;color:var(--text-secondary);line-height:1.45;">' + escapeHtml(skill.description || '无说明') + '</span>' +
              '</span>' +
            '</div>' +
            '<div style="align-self:stretch;display:flex;flex-direction:column;align-items:center;justify-content:space-between;flex:0 0 auto;">' +
              '<input type="checkbox" data-main-context-skill-token="' + escapeHtml(token) + '" ' + (checked ? 'checked ' : '') + 'title="持续使用此 Skill" aria-label="持续使用 ' + escapeHtml(skill.name || skill.id || '系统 Skill') + '" style="width:15px;height:15px;margin:1px 0 0;accent-color:var(--accent-color);cursor:pointer;">' +
              '<button type="button" data-skill-id="' + escapeHtml(skill.id || '') + '" data-skill-name="' + escapeHtml(skill.name || '') + '" onclick="deleteBundledAgentSkillFromMainContext(this.dataset.skillId, this.dataset.skillName)" title="删除系统自带 Skill" style="width:25px;height:25px;border:0;border-radius:6px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:15px;">×</button>' +
            '</div>' +
          '</div>';
        }).join('')
        : '<div style="padding:14px;border:1px dashed var(--border-color);border-radius:9px;color:var(--text-secondary);font-size:12px;line-height:1.7;background:var(--bg-input);">当前没有可用的系统自带 Skill。</div>';
      var userSkillHtml = customSkills.length
        ? customSkills.map(function(skill) {
          var token = 'user:' + String(skill.id || '');
          var checked = selectedSet.has(token);
          var disabled = skill.enabled === false;
          return '' +
            '<div class="skill-catalog-item" style="display:flex;align-items:center;gap:10px;margin-bottom:0;">' +
              '<span class="skill-catalog-icon category-user" aria-hidden="true"></span>' +
              '<span style="min-width:0;flex:1;">' +
                '<span style="display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;font-weight:800;color:var(--text-primary);">' +
                  '<span style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">/' + escapeHtml(skill.trigger || '') + ' · ' + escapeHtml(skill.name || '用户 Skill') + '</span>' +
                  (disabled ? '<span style="flex:0 0 auto;padding:1px 5px;border-radius:999px;background:var(--modal-tip-bg);color:var(--text-secondary);font-size:9px;">已停用</span>' : '') +
                '</span>' +
                '<span style="display:block;margin-top:3px;font-size:12px;color:var(--text-secondary);line-height:1.45;">' + escapeHtml(skill.description || '无说明') + '</span>' +
              '</span>' +
              '<div style="align-self:stretch;display:flex;flex-direction:column;align-items:center;justify-content:space-between;flex:0 0 auto;">' +
                '<input type="checkbox" data-main-context-skill-token="' + escapeHtml(token) + '" ' + (checked ? 'checked ' : '') + (disabled ? 'disabled ' : '') + 'title="' + (disabled ? '该 Skill 已停用' : '持续使用此 Skill') + '" aria-label="持续使用 ' + escapeHtml(skill.name || skill.id || '用户 Skill') + '" style="width:15px;height:15px;margin:1px 0 0;accent-color:var(--accent-color);cursor:' + (disabled ? 'not-allowed' : 'pointer') + ';">' +
                '<button type="button" data-skill-id="' + escapeHtml(skill.id || '') + '" data-skill-name="' + escapeHtml(skill.name || '') + '" onclick="deleteUserSkillFromMainContext(this.dataset.skillId, this.dataset.skillName)" title="删除用户自定义 Skill" aria-label="删除 ' + escapeHtml(skill.name || skill.id || '用户 Skill') + '" class="skill-catalog-delete-button">×</button>' +
              '</div>' +
            '</div>';
        }).join('')
        : '<div style="padding:14px;border:1px dashed var(--border-color);border-radius:9px;color:var(--text-secondary);font-size:12px;line-height:1.7;background:var(--bg-input);">还没有用户 Skill。通过下方“Skill 配置”添加或导入后即可在这里持续使用。</div>';
      var html = '' +
        selectedChipsHtml +
        '<div class="persistent-skill-four-grid" style="padding-right:2px;">' +
          '<div class="persistent-skill-primary-grid">' +
            '<section>' +
              '<div style="font-size:13px;font-weight:850;color:var(--text-primary);margin-bottom:8px;">章节写作 Skill</div>' +
              writingSkillHtml +
            '</section>' +
            '<section>' +
              '<div style="font-size:13px;font-weight:850;color:var(--text-primary);margin-bottom:8px;">章节写作风格</div>' +
              styleHtml +
            '</section>' +
          '</div>' +
          '<section class="persistent-skill-secondary-grid">' +
            '<div style="min-width:0;">' +
              '<div style="font-size:13px;font-weight:850;color:var(--text-primary);margin-bottom:8px;">系统自带 Skill</div>' +
              '<div class="persistent-skill-scroll-panel">' + bundledSkillHtml + '</div>' +
            '</div>' +
            '<div style="min-width:0;">' +
              '<div style="font-size:13px;font-weight:850;color:var(--text-primary);margin-bottom:8px;">用户自定义 Skill</div>' +
              '<div class="persistent-skill-scroll-panel">' + userSkillHtml + '</div>' +
            '</div>' +
          '</section>' +
        '</div>' +
        '<section id="unifiedSkillConfiguration" style="margin-top:34px;padding-top:24px;border-top:1px solid var(--border-color);scroll-margin-top:18px;">' +
          '<div style="font-size:18px;font-weight:650;color:var(--text-primary);margin-bottom:5px;">Skill 配置</div>' +
          '<div style="font-size:12px;line-height:1.6;color:var(--text-secondary);margin-bottom:16px;">添加、导入、编辑、启用或删除用户 Skill。</div>' +
          renderUserSkillManager('', true) +
        '</section>';
      showHomeUtilityPage(
        'persistent-skill',
        'Skill',
        '选择持续使用规则，并添加、导入和维护 Skill；可同时选择章节写作 Skill、期刊章节写作风格和用户自定义 Skill，保存后自动加入每次主对话请求。',
        html
      );
    }

    window.clearMainContextSkillSelectionFromDialog = function() {
      saveMainContextSkillSelection([]);
      renderMainContextSourceBar();
      renderMainContextSkillDialog();
    };

    window.removeMainContextSkillSelectionFromDialog = function(token) {
      var normalized = normalizeMainContextSkillSelectionItem(token);
      if (!normalized) return;
      saveMainContextSkillSelection(loadMainContextSkillSelection().filter(function(item) {
        return item !== normalized;
      }));
      renderMainContextSourceBar();
      renderMainContextSkillDialog();
    };

    window.saveMainContextSkillSelectionFromDialog = function() {
      persistMainContextSkillChecks();
      closeHomeUtilityPage();
    };

    function persistMainContextSkillChecks() {
      var tokens = Array.prototype.slice.call(document.querySelectorAll('[data-main-context-skill-token]:checked'))
        .map(function(input) { return input.getAttribute('data-main-context-skill-token') || ''; })
        .filter(Boolean);
      saveMainContextSkillSelection(tokens);
      renderMainContextSourceBar();
      var summary = document.getElementById('mainContextSkillSelectionSummary');
      if (summary) {
        summary.innerHTML = renderMainContextSkillSelectionSummary(tokens);
      }
    }
    window.persistMainContextSkillChecks = persistMainContextSkillChecks;

    document.addEventListener('change', function(event) {
      var target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.matches('[data-main-context-skill-token]')) return;
      persistMainContextSkillChecks();
    });

    window.deleteBundledAgentSkillFromMainContext = async function(skillId, skillName) {
      if (!skillId) return;
      var label = skillName || skillId;
      if (!confirm('确定删除系统自带 Skill“' + label + '”吗？\n\n删除后，该 Skill 将不再出现在持续使用列表和 AI 自动调用目录中。')) return;
      try {
        var response = await fetch(getUserSkillApiBase() + '/bundled/' + encodeURIComponent(skillId), { method: 'DELETE' });
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok || !data.success) throw new Error(data.error || '删除系统自带 Skill 失败');
        availableAgentSkills = Array.isArray(data.skills) ? data.skills : [];
        saveMainContextSkillSelection(loadMainContextSkillSelection().filter(function(token) {
          var parsed = parseMainContextSkillToken(token);
          return !parsed || parsed.kind !== 'agent' || String(parsed.id || '') !== String(skillId);
        }));
        renderMainContextSourceBar();
        renderMainContextSkillDialog();
      } catch (e) {
        alert('删除失败：' + (e.message || String(e)));
      }
    };

    window.deleteUserSkillFromMainContext = async function(skillId, skillName) {
      if (!skillId) return;
      var label = skillName || skillId;
      if (!confirm('确定删除用户自定义 Skill“' + label + '”吗？\n\n删除后，该 Skill 将从持续使用列表和 AI 自动调用目录中移除。')) return;
      try {
        var response = await fetch(getUserSkillApiBase() + '/' + encodeURIComponent(skillId), { method: 'DELETE' });
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok || !data.success || data.deleted === false) {
          throw new Error(data.error || '删除用户自定义 Skill 失败');
        }
        userSkillManagerSkills = Array.isArray(data.skills) ? data.skills : [];
        userSkillDropdownLoaded = false;
        saveMainContextSkillSelection(loadMainContextSkillSelection().filter(function(token) {
          var parsed = parseMainContextSkillToken(token);
          return !parsed || parsed.kind !== 'user' || String(parsed.id || '') !== String(skillId);
        }));
        renderMainContextSourceBar();
        renderMainContextSkillDialog();
      } catch (e) {
        alert('删除失败：' + (e.message || String(e)));
      }
    };

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('chat-context', { source: '/app/chat-context.js' });
}
