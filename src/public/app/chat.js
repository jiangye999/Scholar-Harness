function renderFileList() {
      fileList.innerHTML = '';
      for (var i = 0; i < uploadedFiles.length; i++) {
        var file = uploadedFiles[i];
        if (file.name === '文献库' || file.name === getProjectUiLabels().embeddingLibrary) continue;
        var div = document.createElement('div');
        div.className = 'file-item';
        div.innerHTML = '<span class="name">' + file.name + '</span><span class="remove" onclick="removeFile(' + i + ')">' + uiIcon('x', 'sm') + '</span>';
        fileList.appendChild(div);
      }
    }
    
    window.removeFile = function(index) {
      uploadedFiles.splice(index, 1);
      saveLitStorage(currentUserId, uploadedFiles);
      renderFileList();
    };
    
    window.clearAllFiles = function() {
      uploadedFiles = [];
      saveLitStorage(currentUserId, uploadedFiles);
      renderFileList();
    };
    
    var mainChatAutoResizeTimer = null;
    var mainChatInputComposing = false;
    var mainChatLastInputAt = 0;
    var MAIN_CHAT_INPUT_RESIZE_DELAY_MS = 48;
    var MAIN_CHAT_INPUT_PRIORITY_WINDOW_MS = 140;
    var MAIN_CHAT_FINAL_RENDER_QUIET_WINDOW_MS = 320;
    var MAIN_CHAT_MESSAGE_CLIP_CLEARANCE_PX = 15;
    var MAIN_CHAT_HISTORY_MAX_ITEMS = 20;
    var MAIN_CHAT_HISTORY_MESSAGE_MAX_CHARS = 20000;
    var MAIN_CHAT_HISTORY_TOTAL_MAX_CHARS = 100000;
    var MAIN_CHAT_HISTORY_TRUNCATION_MARKER = '\n\n[历史消息过长，本次请求仅保留首尾；完整内容仍保存在本地会话中]\n\n';
    var mainChatLastMeasuredInputLength = userInput && userInput.value ? userInput.value.length : 0;
    var mainChatInputNeedsShrinkMeasurement = true;
    var mainChatComposerResizeObserver = null;
    var mainChatComposerOverlayHeight = 0;
    var mainChatPreflightFollowFrame = null;
    var mainChatPerformanceState = {
      inputEvents: [],
      longTasks: [],
      streamRenders: [],
      observers: []
    };

    function truncateMainChatHistoryContent(value, maxChars) {
      var text = String(value || '');
      var limit = Math.max(0, Math.floor(Number(maxChars) || 0));
      if (text.length <= limit) return text;
      if (limit <= MAIN_CHAT_HISTORY_TRUNCATION_MARKER.length + 2) return text.slice(0, limit);
      var available = limit - MAIN_CHAT_HISTORY_TRUNCATION_MARKER.length;
      var headLength = Math.floor(available * 0.7);
      var tailLength = available - headLength;
      return text.slice(0, headLength) + MAIN_CHAT_HISTORY_TRUNCATION_MARKER + text.slice(-tailLength);
    }

    function buildMainChatHistoryRequestPayload(messages) {
      var source = Array.isArray(messages) ? messages : [];
      var bounded = source.slice(-MAIN_CHAT_HISTORY_MAX_ITEMS).map(function(item) {
        var role = item && (item.role === 'assistant' || item.role === 'system') ? item.role : 'user';
        return {
          role: role,
          content: truncateMainChatHistoryContent(
            item && typeof item.content === 'string' ? item.content : '',
            MAIN_CHAT_HISTORY_MESSAGE_MAX_CHARS
          )
        };
      });
      var retained = [];
      var remainingChars = MAIN_CHAT_HISTORY_TOTAL_MAX_CHARS;
      var truncatedMessages = 0;
      var droppedMessages = Math.max(0, source.length - bounded.length);
      for (var index = bounded.length - 1; index >= 0; index -= 1) {
        var message = bounded[index];
        if (remainingChars <= 0) {
          droppedMessages += 1;
          continue;
        }
        var content = message.content;
        if (content.length > remainingChars) {
          content = truncateMainChatHistoryContent(content, remainingChars);
          truncatedMessages += 1;
        }
        if (!content && message.content) {
          droppedMessages += 1;
          continue;
        }
        retained.unshift({ role: message.role, content: content });
        remainingChars -= content.length;
      }
      bounded.forEach(function(message, index) {
        var sourceItem = source[source.length - bounded.length + index];
        if (sourceItem && typeof sourceItem.content === 'string' && message.content.length < sourceItem.content.length) {
          truncatedMessages += 1;
        }
      });
      if (truncatedMessages > 0 || droppedMessages > 0) {
        console.warn('[ChatHistory] 请求副本已压缩，完整本地会话未修改:', {
          inputMessages: source.length,
          outputMessages: retained.length,
          truncatedMessages: truncatedMessages,
          droppedMessages: droppedMessages,
          outputChars: MAIN_CHAT_HISTORY_TOTAL_MAX_CHARS - remainingChars
        });
      }
      return retained;
    }
    window.buildMainChatHistoryRequestPayload = buildMainChatHistoryRequestPayload;

    function pushBoundedPerformanceSample(list, sample) {
      if (!Array.isArray(list)) return;
      list.push(sample);
      if (list.length > 120) list.splice(0, list.length - 120);
    }

    function summarizePerformanceDurations(samples) {
      var values = (Array.isArray(samples) ? samples : [])
        .map(function(sample) { return Number(sample && sample.duration); })
        .filter(function(value) { return Number.isFinite(value) && value >= 0; })
        .sort(function(a, b) { return a - b; });
      if (!values.length) return { count: 0, p50: 0, p95: 0, max: 0 };
      return {
        count: values.length,
        p50: Number(values[Math.floor((values.length - 1) * 0.5)].toFixed(1)),
        p95: Number(values[Math.floor((values.length - 1) * 0.95)].toFixed(1)),
        max: Number(values[values.length - 1].toFixed(1))
      };
    }

    function recordMainChatStreamRender(duration, characterCount) {
      pushBoundedPerformanceSample(mainChatPerformanceState.streamRenders, {
        duration: Number(duration || 0),
        characterCount: Number(characterCount || 0),
        timestamp: Date.now()
      });
    }

    function getMainChatPerformanceSnapshot() {
      return {
        inputLatency: summarizePerformanceDurations(mainChatPerformanceState.inputEvents),
        focusedLongTasks: summarizePerformanceDurations(mainChatPerformanceState.longTasks),
        streamRenderCost: summarizePerformanceDurations(mainChatPerformanceState.streamRenders),
        recentInputEvents: mainChatPerformanceState.inputEvents.slice(-12),
        recentLongTasks: mainChatPerformanceState.longTasks.slice(-12),
        recentStreamRenders: mainChatPerformanceState.streamRenders.slice(-12)
      };
    }
    window.getMainChatPerformanceSnapshot = getMainChatPerformanceSnapshot;
    window.resetMainChatPerformanceSnapshot = function() {
      mainChatPerformanceState.inputEvents.length = 0;
      mainChatPerformanceState.longTasks.length = 0;
      mainChatPerformanceState.streamRenders.length = 0;
      return getMainChatPerformanceSnapshot();
    };

    function initMainChatPerformanceMonitor() {
      if (!window.PerformanceObserver || mainChatPerformanceState.observers.length) return;
      try {
        var eventObserver = new PerformanceObserver(function(list) {
          list.getEntries().forEach(function(entry) {
            if (!entry || !['beforeinput', 'input', 'keydown'].includes(entry.name)) return;
            if (entry.target && entry.target !== userInput) return;
            pushBoundedPerformanceSample(mainChatPerformanceState.inputEvents, {
              name: entry.name,
              duration: Number(entry.duration || 0),
              interactionId: Number(entry.interactionId || 0),
              timestamp: Date.now()
            });
          });
        });
        eventObserver.observe({ type: 'event', buffered: true, durationThreshold: 16 });
        mainChatPerformanceState.observers.push(eventObserver);
      } catch (eventTimingError) {
        // Event Timing is not available in every Electron/Chromium version.
      }
      try {
        var longTaskObserver = new PerformanceObserver(function(list) {
          if (document.activeElement !== userInput && !mainChatInputComposing) return;
          list.getEntries().forEach(function(entry) {
            pushBoundedPerformanceSample(mainChatPerformanceState.longTasks, {
              duration: Number(entry.duration || 0),
              timestamp: Date.now()
            });
          });
        });
        longTaskObserver.observe({ type: 'longtask', buffered: false });
        mainChatPerformanceState.observers.push(longTaskObserver);
      } catch (longTaskError) {
        // Long Tasks is optional; input remains fully functional without it.
      }
    }

    function updateMainChatComposerOverlayHeight(entry) {
      var inputContainer = userInput && userInput.closest ? userInput.closest('.input-container') : null;
      var main = inputContainer && inputContainer.closest ? inputContainer.closest('.main') : null;
      if (!inputContainer || !main) return;
      var inputSurface = inputContainer.querySelector('.input-area-container');
      if (inputSurface && inputSurface.getBoundingClientRect && main.getBoundingClientRect) {
        var mainRect = main.getBoundingClientRect();
        var inputSurfaceRect = inputSurface.getBoundingClientRect();
        var clipHeight = Math.max(
          0,
          Math.ceil(mainRect.bottom - inputSurfaceRect.top) + MAIN_CHAT_MESSAGE_CLIP_CLEARANCE_PX
        );
        main.style.setProperty('--main-composer-clip-height', clipHeight + 'px');
      }
      var blockSize = 0;
      var borderBoxSize = entry && entry.borderBoxSize;
      if (borderBoxSize) {
        var box = Array.isArray(borderBoxSize) ? borderBoxSize[0] : borderBoxSize;
        blockSize = Number(box && box.blockSize) || 0;
      }
      var nextHeight = Math.max(72, Math.ceil(blockSize || inputContainer.offsetHeight || 0));
      if (nextHeight === mainChatComposerOverlayHeight) return;
      var keepBottomVisible = !!(chatContainer && isChatNearBottom(140));
      mainChatComposerOverlayHeight = nextHeight;
      main.style.setProperty('--main-composer-overlay-height', nextHeight + 'px');
      if (keepBottomVisible) {
        requestAnimationFrame(function() {
          if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
        });
      }
    }

    function initMainChatComposerRenderIsland() {
      var inputContainer = userInput && userInput.closest ? userInput.closest('.input-container') : null;
      if (!inputContainer || inputContainer.dataset.renderIslandReady === '1') return;
      inputContainer.dataset.renderIslandReady = '1';
      requestAnimationFrame(function() {
        updateMainChatComposerOverlayHeight(null);
      });
      if (typeof ResizeObserver === 'function') {
        mainChatComposerResizeObserver = new ResizeObserver(function(entries) {
          updateMainChatComposerOverlayHeight(entries && entries[0]);
        });
        mainChatComposerResizeObserver.observe(inputContainer);
      } else {
        window.addEventListener('resize', function() {
          updateMainChatComposerOverlayHeight(null);
        }, { passive: true });
      }
    }

    function applyMainChatInputHeight() {
      if (!userInput) return;
      if (mainChatAutoResizeTimer) {
        clearTimeout(mainChatAutoResizeTimer);
        mainChatAutoResizeTimer = null;
      }
      // Growing text can be measured at the current height. Reset to one line only
      // for deletion/programmatic replacement, avoiding a forced shrink+grow layout
      // cycle after every committed IME candidate.
      if (mainChatInputNeedsShrinkMeasurement) {
        userInput.style.height = '46px';
      }
      var contentHeight = Math.ceil(userInput.scrollHeight || 46);
      var nextHeight = Math.max(46, Math.min(contentHeight, 128));
      if (userInput.style.height !== nextHeight + 'px') {
        userInput.style.height = nextHeight + 'px';
      }
      userInput.style.overflowY = contentHeight > 128 ? 'auto' : 'hidden';
      mainChatLastMeasuredInputLength = userInput.value.length;
      mainChatInputNeedsShrinkMeasurement = false;
    }

    function scheduleMainChatInputHeight(delay) {
      if (mainChatAutoResizeTimer) clearTimeout(mainChatAutoResizeTimer);
      mainChatAutoResizeTimer = setTimeout(function() {
        mainChatAutoResizeTimer = null;
        applyMainChatInputHeight();
      }, Math.max(0, Number(delay || 0)));
    }

    function autoResize(event) {
      var isUserInputEvent = !!(event && event.type === 'input');
      if (isUserInputEvent) {
        mainChatLastInputAt = Date.now();
        var nextInputLength = userInput.value.length;
        if (
          nextInputLength < mainChatLastMeasuredInputLength ||
          /^delete/i.test(String(event.inputType || ''))
        ) {
          mainChatInputNeedsShrinkMeasurement = true;
        }
        // IME composition must stay on the browser's shortest path. Height
        // measurement is deferred until the candidate has been committed.
        if (!mainChatInputComposing && !event.isComposing) {
          scheduleMainChatInputHeight(MAIN_CHAT_INPUT_RESIZE_DELAY_MS);
        }
        if (isGenerating) {
          updateMainChatQueueButtonState({ renderQueue: false });
        }
        return;
      }
      mainChatInputNeedsShrinkMeasurement = true;
      applyMainChatInputHeight();
      syncChatPlaceholder();
      updateMainChatQueueButtonState();
    }

    function syncChatPlaceholder() {
      var placeholder = document.getElementById('chatPlaceholder');
      if (placeholder && placeholder.style.display !== 'none') {
        placeholder.style.display = 'none';
      }
    }

    function restoreMainChatInputInteractivity() {
      if (!userInput) return false;
      userInput.disabled = false;
      userInput.readOnly = false;
      userInput.tabIndex = 0;
      userInput.removeAttribute('aria-disabled');
      userInput.removeAttribute('inert');
      return true;
    }

    function focusMainChatInput() {
      if (typeof ensureMainComposerIntegrity === 'function') {
        ensureMainComposerIntegrity();
      }
      if (!restoreMainChatInputInteractivity()) return;
      var modalOverlay = document.getElementById('modalOverlay');
      if (modalOverlay && modalOverlay.classList.contains('show')) return;
      try {
        userInput.focus({ preventScroll: true });
      } catch (e) {
        userInput.focus();
      }
      syncChatPlaceholder();
    }

    function setMainChatInputBusy(isBusy) {
      if (!restoreMainChatInputInteractivity()) return;
      userInput.setAttribute('aria-busy', isBusy ? 'true' : 'false');
      if (isBusy) {
        hideMentionDropdown();
        hideSlashDropdown();
      } else {
        syncChatPlaceholder();
        setTimeout(focusMainChatInput, 0);
      }
      updateMainChatQueueButtonState();
    }

    function initMainChatInputInteractivity() {
      if (!userInput) return;
      var composer = userInput.closest ? userInput.closest('.input-area-container') : null;
      restoreMainChatInputInteractivity();
      initMainChatComposerRenderIsland();
      initMainChatPerformanceMonitor();
      if (composer) {
        composer.addEventListener('pointerdown', function(event) {
          if (event.button !== undefined && event.button !== 0) return;
          var target = event.target && event.target.nodeType === 1 ? event.target : null;
          var control = target && target.closest
            ? target.closest('button, input:not(#userInput), select, a, [role="menuitem"], .mention-dropdown')
            : null;
          if (control) return;
          restoreMainChatInputInteractivity();
          if (target !== userInput) {
            event.preventDefault();
            focusMainChatInput();
          }
        }, true);
      }
      window.addEventListener('focus', restoreMainChatInputInteractivity);
      document.addEventListener('visibilitychange', function() {
        if (!document.hidden) restoreMainChatInputInteractivity();
      });
    }

    function beginMainChatExperimentBusy(providerLabel) {
      if (isMainChatConversationRunning()) return false;
      mainChatExperimentUploadBusyOwner = true;
      emptyState.style.display = 'none';
      setMainChatInputBusy(true);
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.classList.add('sending');
        sendBtn.classList.remove('can-stop');
      }
      isGenerating = true;
      activeMainChatProvider = providerLabel || getComposerChatProvider();
      currentAbortController = new AbortController();
      registerMainChatActiveRun(currentConversationId, currentAbortController);
      updateMainChatQueueButtonState();
      return true;
    }

    function endMainChatExperimentBusy() {
      if (!mainChatExperimentUploadBusyOwner) return;
      mainChatExperimentUploadBusyOwner = false;
      setMainChatInputBusy(false);
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.classList.remove('sending', 'can-stop');
      }
      isGenerating = false;
      unregisterMainChatActiveRun(currentConversationId, currentAbortController);
      currentAbortController = null;
      activeMainChatProvider = null;
      clearChatTurnScrollLock();
      updateMainChatQueueButtonState();
      scheduleMainChatQueueDrain();
    }

    function getMainChatAbortSignal() {
      return currentAbortController && currentAbortController.signal ? currentAbortController.signal : undefined;
    }

    function finishMainChatRequest(requestController) {
      // 后台运行（切走会话后仍在跑的流）完成时，也要释放运行登记。
      releaseMainChatActiveRunByController(requestController);
      if (!requestController || currentAbortController !== requestController) return false;
      setMainChatInputBusy(false);
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.classList.remove('sending', 'can-stop');
      }
      isGenerating = false;
      currentAbortController = null;
      activeMainChatConversationId = null;
      activeMainChatProjectId = null;
      activeMainChatProvider = null;
      mainChatPiState = Object.assign({}, mainChatPiState || {}, { running: false });
      if (mainChatPiQueueHostMessage) {
        stopMainChatPreflightHeader(mainChatPiQueueHostMessage);
        renderMainChatPiQueue(mainChatPiState);
        scheduleChatMessageLayoutRepair(mainChatPiQueueHostMessage);
      }
      stopChatStreamTail();
      clearChatTurnScrollLock();
      updateMainChatQueueButtonState();
      maybeScrollChatToBottom(true);
      scheduleMainChatQueueDrain();
      return true;
    }

    function updateMainChatQueueButtonState(options) {
      if (!sendBtn) return;
      options = options || {};
      var hasDraft = !!(userInput && userInput.value && userInput.value.trim());
      var queueReady = !!(isGenerating && hasDraft);
      if (sendBtn.classList.contains('queue-ready') !== queueReady) {
        sendBtn.classList.toggle('queue-ready', queueReady);
      }
      var nextTitle = '发送';
      var nextAriaLabel = '发送';
      if (isGenerating && hasDraft) {
        var queueAction = mainChatPiQueueBehavior === 'steer' ? '转向当前任务' : '加入后续队列';
        nextTitle = queueAction + '（Ctrl+Enter 始终转向）';
        nextAriaLabel = queueAction;
      } else if (isGenerating) {
        nextTitle = '停止生成';
        nextAriaLabel = '停止生成';
      }
      if (sendBtn.title !== nextTitle) sendBtn.title = nextTitle;
      if (sendBtn.getAttribute('aria-label') !== nextAriaLabel) {
        sendBtn.setAttribute('aria-label', nextAriaLabel);
      }
      if (options.renderQueue !== false) {
        renderMainChatPiQueue(mainChatPiState);
      }
    }

    function makeMainChatQueueId() {
      return 'pi_msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    }

    function setMainChatPiQueueBehavior(behavior) {
      mainChatPiQueueBehavior = behavior === 'steer' ? 'steer' : 'follow_up';
      localStorage.setItem('scholarharness_pi_queue_behavior', mainChatPiQueueBehavior);
      renderMainChatPiQueue(mainChatPiState);
      updateMainChatQueueButtonState();
      focusMainChatInput();
    }
    window.setMainChatPiQueueBehavior = setMainChatPiQueueBehavior;

    function getMainChatPiSessionUrl(conversationId) {
      return '/api/chat-bridge/pi/sessions/' + encodeURIComponent(conversationId || ensureCurrentConversationId());
    }

    function getMainChatProjectId() {
      return typeof getConversationHistoryProjectId === 'function'
        ? String(getConversationHistoryProjectId() || '')
        : '';
    }

    async function interruptMainChatAgent(conversationId) {
      var response = await fetch(getMainChatPiSessionUrl(conversationId) + '/interrupt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId || 'web-user',
          projectId: getMainChatProjectId() || undefined
        })
      });
      var result = await response.json().catch(function() { return {}; });
      if (!response.ok || !result.success) {
        throw new Error(result.error || ('HTTP ' + response.status));
      }
      if (result.state) {
        mainChatPiState = result.state;
        renderMainChatPiQueue(result.state);
      }
      return result;
    }

    function hasActiveMainChatRunVisual() {
      var thinkingMessage = messagesDiv && messagesDiv.querySelector
        ? messagesDiv.querySelector('.thinking-message')
        : null;
      var attachedQueueHost = !!(
        mainChatPiQueueHostMessage
        && document.documentElement.contains(mainChatPiQueueHostMessage)
      );
      return !!(thinkingMessage || attachedQueueHost);
    }

    function recoverStaleMainChatFrontendRun(reason) {
      if (!isGenerating && !currentAbortController) return false;
      var conversationMismatch = !!(
        activeMainChatConversationId
        && currentConversationId
        && activeMainChatConversationId !== currentConversationId
      );
      if (!conversationMismatch && hasActiveMainChatRunVisual()) return false;
      // Only release the registry entry after the run is proven stale. Doing
      // this before the visual check made the stop button forget the active
      // run and fall through into a new (sometimes empty) send request.
      releaseMainChatActiveRunByController(currentAbortController);
      console.warn('[PiSession] Recovering stale main-chat frontend run:', reason || 'missing active response');
      if (currentAbortController) {
        try {
          currentAbortController.abort();
        } catch (error) {}
      }
      isGenerating = false;
      currentAbortController = null;
      activeMainChatConversationId = null;
      activeMainChatProjectId = null;
      activeMainChatProvider = null;
      mainChatExperimentUploadBusyOwner = false;
      setMainChatInputBusy(false);
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.classList.remove('sending', 'can-stop', 'queue-ready');
      }
      stopChatStreamTail();
      clearChatTurnScrollLock();
      updateMainChatQueueButtonState();
      return true;
    }
    window.recoverStaleMainChatFrontendRun = recoverStaleMainChatFrontendRun;

    function stopActiveMainChatForNavigation() {
      // 切换/新建对话不再中断后端运行：任务在后台继续执行，返回时由
      // pi 会话轮询（reconcileMainChatPersistedRun）恢复渲染与结果。
      // 只有用户显式点“停止”才 abort 前端流并 interrupt 后端。
      // 运行仍登记在 mainChatActiveRuns，直到后台流完成并释放。
      isGenerating = false;
      if (mainChatPiQueueHostMessage) {
        stopMainChatPreflightHeader(mainChatPiQueueHostMessage);
        renderMainChatPiQueue(mainChatPiState);
      }
      currentAbortController = null;
      activeMainChatConversationId = null;
      activeMainChatProjectId = null;
      activeMainChatProvider = null;
      mainChatExperimentUploadBusyOwner = false;
      setMainChatInputBusy(false);
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.classList.remove('sending', 'can-stop', 'queue-ready');
      }
      stopChatStreamTail();
      clearChatTurnScrollLock();
      updateMainChatQueueButtonState();
    }

    function getMainChatPiQueueLabel(behavior) {
      return behavior === 'steer' ? '转向' : '后续';
    }

    function updatePiQueuedMessageLocalRecord(queueItem, status) {
      if (!queueItem || !queueItem.id) return;
      var conversationId = queueItem.conversationId || currentConversationId || ensureCurrentConversationId();
      var messages = readConversationMessagesLocal(conversationId);
      var index = messages.findIndex(function(message) { return message && message.piQueueId === queueItem.id; });
      var record = {
        role: 'user',
        content: String(queueItem.message || ''),
        isHtml: false,
        timestamp: Number(queueItem.createdAt ? Date.parse(queueItem.createdAt) : queueItem.createdAtMs) || Date.now(),
        piQueueId: queueItem.id,
        piBehavior: queueItem.behavior || 'follow_up',
        piStatus: status || queueItem.status || 'queued'
      };
      if (index >= 0) {
        var existing = messages[index] || {};
        var merged = Object.assign({}, existing, record);
        var unchanged = String(existing.role || '') === String(merged.role || '')
          && String(existing.content || '') === String(merged.content || '')
          && !!existing.isHtml === !!merged.isHtml
          && Number(existing.timestamp || 0) === Number(merged.timestamp || 0)
          && String(existing.piQueueId || '') === String(merged.piQueueId || '')
          && String(existing.piBehavior || '') === String(merged.piBehavior || '')
          && String(existing.piStatus || '') === String(merged.piStatus || '');
        if (unchanged) return;
        messages[index] = merged;
      } else {
        messages.push(record);
      }
      storeConversationMessagesLocally(conversationId, messages);
    }

    function removePiQueuedMessageLocalRecord(queueItem) {
      if (!queueItem || !queueItem.id) return;
      var conversationId = queueItem.conversationId || currentConversationId;
      if (!conversationId) return;
      var messages = readConversationMessagesLocal(conversationId).filter(function(message) {
        return !message || message.piQueueId !== queueItem.id;
      });
      storeConversationMessagesLocally(conversationId, messages);
    }

    function mergeConcurrentPiQueueRecords(conversationId, targetMessages) {
      var target = Array.isArray(targetMessages) ? targetMessages : [];
      var concurrent = readConversationMessagesLocal(conversationId).filter(function(message) {
        return message && message.piQueueId;
      });
      concurrent.forEach(function(message) {
        var index = target.findIndex(function(candidate) {
          return candidate && candidate.piQueueId === message.piQueueId;
        });
        if (index >= 0) target[index] = Object.assign({}, target[index], message);
        else target.push(message);
      });
      target.sort(function(a, b) {
        return Number(a && a.timestamp || 0) - Number(b && b.timestamp || 0);
      });
      return target;
    }

    function findPiQueuedMessageElement(queueId) {
      if (!queueId || !messagesDiv) return null;
      return messagesDiv.querySelector('.message[data-queue-id="' + String(queueId).replace(/["\\]/g, '') + '"]');
    }

    function renderQueuedQueryMeta(queueItem, statusText) {
      var editable = !queueItem || queueItem.status === 'queued';
      var queueId = String(queueItem && queueItem.id || '');
      return '<div class="queued-query-meta">' +
        '<span class="queued-query-status">' + escapeHtml(statusText || '排队中') + '</span>' +
        '<span class="queued-query-actions"' + (editable ? '' : ' hidden') + '>' +
          '<button type="button" onclick="event.stopPropagation();editMainChatPiQueuedMessage(\'' + escapeHtml(queueId) + '\')">编辑</button>' +
          '<button type="button" onclick="event.stopPropagation();cancelMainChatPiQueuedMessage(\'' + escapeHtml(queueId) + '\')">撤回</button>' +
        '</span>' +
      '</div>';
    }

    function appendQueuedUserMessage(queueItem) {
      var existing = findPiQueuedMessageElement(queueItem && queueItem.id);
      if (existing) return existing;
      emptyState.style.display = 'none';
      var div = document.createElement('div');
      div.className = 'message user queued-query-message';
      div.dataset.queueId = queueItem.id;
      div.setAttribute('data-query-nav-text', normalizeQueryNavText(queueItem.message));
      queryNavPinnedMessageId = ensureQueryNavMessageId(div);
      div.innerHTML = '<div class="avatar user">' + getMessageAvatarHtml('user') + '</div>' +
        '<div class="content">' +
          formatMessage(queueItem.message) +
          renderUserMessageFooter() +
          renderQueuedQueryMeta(queueItem, getMainChatPiQueueLabel(queueItem.behavior) + '消息排队中') +
        '</div>';
      syncMessageLocalFileVisibilityClass(div);
      messagesDiv.appendChild(div);
      maybeScrollChatToBottom(true);
      return div;
    }

    function updateQueuedUserMessageContent(queueItem) {
      var element = (queueItem && queueItem.userMessageEl) || findPiQueuedMessageElement(queueItem && queueItem.id);
      if (!element) return;
      queueItem.userMessageEl = element;
      element.setAttribute('data-query-nav-text', normalizeQueryNavText(queueItem.message));
      var content = element.querySelector('.content');
      if (!content) return;
      var status = content.querySelector('.queued-query-status');
      var statusText = status ? status.textContent : '';
      content.innerHTML = formatMessage(queueItem.message) +
        renderUserMessageFooter() +
        renderQueuedQueryMeta(queueItem, statusText || '排队中');
      syncMessageLocalFileVisibilityClass(element);
    }

    function setQueuedQueryStatus(queueItem, text) {
      if (!queueItem) return;
      queueItem.userMessageEl = queueItem.userMessageEl || findPiQueuedMessageElement(queueItem.id);
      if (!queueItem.userMessageEl) return;
      var status = queueItem.userMessageEl.querySelector('.queued-query-status');
      if (status) status.textContent = text || '';
      var actions = queueItem.userMessageEl.querySelector('.queued-query-actions');
      if (actions) actions.hidden = queueItem.status !== 'queued';
    }

    function clearQueuedQueryStatus(queueItem) {
      if (!queueItem || !queueItem.userMessageEl) return;
      queueItem.userMessageEl.classList.remove('queued-query-message');
      var meta = queueItem.userMessageEl.querySelector('.queued-query-meta');
      if (meta && meta.parentNode) meta.parentNode.removeChild(meta);
    }

    function refreshMainChatQueueStatuses() {
      var steerPosition = 0;
      var followUpPosition = 0;
      mainChatQueryQueue.forEach(function(item) {
        item.userMessageEl = item.userMessageEl || findPiQueuedMessageElement(item.id);
        if (item.status === 'processing') {
          setQueuedQueryStatus(item, item.behavior === 'steer' ? '正在注入当前 Agent' : '正在启动后续任务');
          return;
        }
        if (item.behavior === 'steer') {
          steerPosition += 1;
          setQueuedQueryStatus(item, '转向消息 · 第 ' + steerPosition + ' 个等待注入');
        } else {
          followUpPosition += 1;
          setQueuedQueryStatus(item, '后续消息 · 当前任务结束后第 ' + followUpPosition + ' 个执行');
        }
      });
      updateMainChatQueueButtonState();
    }

    function createMainChatPiQueuePanel() {
      var existing = document.getElementById('mainChatPiQueuePanel');
      if (existing) return existing;
      var panel = document.createElement('section');
      panel.className = 'pi-queue-panel';
      panel.id = 'mainChatPiQueuePanel';
      panel.hidden = true;
      panel.setAttribute('aria-live', 'polite');
      panel.innerHTML = '<div class="pi-queue-head">' +
        '<div class="pi-queue-title">' +
          '<span class="pi-queue-live-dot" aria-hidden="true"></span>' +
          '<span id="mainChatPiQueueTitle">运行中 · 可继续输入</span>' +
        '</div>' +
      '</div>' +
      '<div class="pi-preflight-current" id="mainChatPreflightCurrent" hidden></div>' +
      '<div class="pi-queue-items" id="mainChatPiQueueItems"></div>' +
      '<div class="pi-preflight-log" id="mainChatPreflightLog" hidden></div>';
      return panel;
    }

    function getMainChatPiQueueItemPrefix(behavior) {
      return behavior === 'steer' ? '转向当前任务：' : '后续执行：';
    }

    function getVisibleMainChatPiQueueItems(pending) {
      var seenIds = {};
      return (Array.isArray(pending) ? pending : []).filter(function(item) {
        if (!item || item.status === 'processing' || item.status === 'applied' || item.status === 'cancelled') {
          return false;
        }
        var itemId = String(item.id || '');
        if (!itemId) return true;
        if (seenIds[itemId]) return false;
        seenIds[itemId] = true;
        return true;
      });
    }

    function renderMainChatPiQueueItems(pending) {
      var container = document.getElementById('mainChatPiQueueItems');
      if (!container) return;
      container.innerHTML = '';
      getVisibleMainChatPiQueueItems(pending).forEach(function(item) {
        var row = document.createElement('div');
        row.className = 'pi-queue-item';
        row.dataset.queueId = String(item.id || '');

        var text = document.createElement('div');
        text.className = 'pi-queue-item-text';
        var prefix = document.createElement('span');
        prefix.className = 'pi-queue-item-prefix';
        prefix.textContent = getMainChatPiQueueItemPrefix(item.behavior);
        var message = document.createElement('span');
        message.className = 'pi-queue-item-message';
        message.textContent = String(item.message || '');
        text.appendChild(prefix);
        text.appendChild(message);
        row.appendChild(text);

        if (item.status === 'queued') {
          var actions = document.createElement('span');
          actions.className = 'pi-queue-item-actions';
          var editButton = document.createElement('button');
          editButton.type = 'button';
          editButton.textContent = '编辑';
          editButton.addEventListener('click', function(event) {
            event.stopPropagation();
            editMainChatPiQueuedMessage(String(item.id || ''));
          });
          var cancelButton = document.createElement('button');
          cancelButton.type = 'button';
          cancelButton.textContent = '撤回';
          cancelButton.addEventListener('click', function(event) {
            event.stopPropagation();
            cancelMainChatPiQueuedMessage(String(item.id || ''));
          });
          actions.appendChild(editButton);
          actions.appendChild(cancelButton);
          row.appendChild(actions);
        }
        container.appendChild(row);
      });
    }

    function attachMainChatPiQueuePanelToMessage(messageDiv) {
      if (!messageDiv || !messageDiv.classList || !messageDiv.classList.contains('bot')) return null;
      if (mainChatPiQueueHostMessage && mainChatPiQueueHostMessage !== messageDiv) {
        mainChatPiQueueHostMessage.classList.remove('pi-agent-message');
      }
      var content = messageDiv.querySelector('.content');
      if (!content) return null;
      var panel = createMainChatPiQueuePanel();
      messageDiv.insertBefore(panel, content);
      mainChatPiQueueHostMessage = messageDiv;
      renderMainChatPiQueue(mainChatPiState);
      return panel;
    }
    window.attachMainChatPiQueuePanelToMessage = attachMainChatPiQueuePanelToMessage;

    function startMainChatPreflightHeader(messageDiv) {
      if (!messageDiv) return;
      messageDiv.classList.add('pi-preflight-message');
      // Mark the preceding user instruction so CSS can tighten the gap below
      // it without a relational sibling selector.
      if (messageDiv.previousElementSibling) {
        var preceding = messageDiv.previousElementSibling;
        if (
          preceding.classList
          && preceding.classList.contains('message')
          && preceding.classList.contains('user')
        ) {
          preceding.classList.add('has-preflight-follow');
        }
      }
      messageDiv.dataset.piStartedAt = String(Date.now());
      messageDiv.__piPreflightLog = [];
      var current = document.getElementById('mainChatPreflightCurrent');
      if (current) {
        current.innerHTML = '';
        current.hidden = true;
      }
      var log = document.getElementById('mainChatPreflightLog');
      if (log) {
        log.innerHTML = '';
        log.hidden = true;
      }
      if (messageDiv.__piPreflightTimer) clearInterval(messageDiv.__piPreflightTimer);
      messageDiv.__piPreflightTimer = setInterval(function() {
        if (
          !document.documentElement.contains(messageDiv)
          || !messageDiv.classList.contains('pi-preflight-message')
        ) {
          clearInterval(messageDiv.__piPreflightTimer);
          messageDiv.__piPreflightTimer = null;
          return;
        }
        renderMainChatPiQueue(mainChatPiState);
      }, 1000);
    }

    function stopMainChatPreflightHeader(messageDiv) {
      if (!messageDiv) return;
      if (messageDiv.__piPreflightTimer) {
        clearInterval(messageDiv.__piPreflightTimer);
        messageDiv.__piPreflightTimer = null;
      }
      messageDiv.classList.remove('pi-preflight-message');
      if (messageDiv.previousElementSibling) {
        var preceding = messageDiv.previousElementSibling;
        if (preceding.classList && preceding.classList.contains('has-preflight-follow')) {
          preceding.classList.remove('has-preflight-follow');
        }
      }
      delete messageDiv.dataset.piStartedAt;
      delete messageDiv.dataset.piStatus;
      delete messageDiv.__piPreflightLog;
    }

    function setMainChatPreflightStatus(messageDiv, status) {
      if (!messageDiv || !messageDiv.dataset) return;
      var fullStatus = String(status || '')
        .replace(/^AI\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();
      var normalizedStatus = fullStatus;
      if (normalizedStatus.length > 56) {
        normalizedStatus = normalizedStatus.slice(0, 55).trimEnd() + '…';
      }
      if (normalizedStatus) {
        messageDiv.dataset.piStatus = normalizedStatus;
        var progressLog = Array.isArray(messageDiv.__piPreflightLog)
          ? messageDiv.__piPreflightLog
          : [];
        var previous = progressLog.length ? progressLog[progressLog.length - 1] : null;
        if (!previous || previous.message !== fullStatus) {
          var statusStartedAt = Date.now();
          if (previous && !Number.isFinite(Number(previous.durationSeconds))) {
            previous.durationSeconds = Math.max(
              0,
              Math.floor((statusStartedAt - Number(previous.startedAtMs || statusStartedAt)) / 1000)
            );
          }
          progressLog.push({
            message: fullStatus,
            startedAtMs: statusStartedAt
          });
          messageDiv.__piPreflightLog = progressLog.slice(-24);
        }
      }
      else delete messageDiv.dataset.piStatus;
      renderMainChatPreflightLog(messageDiv);
      renderMainChatPiQueue(mainChatPiState);
      scheduleMainChatPreflightViewportFollow(messageDiv);
    }

    function scheduleMainChatPreflightViewportFollow(messageDiv) {
      if (!messageDiv || !chatContainer || mainChatPreflightFollowFrame !== null) return;
      if (typeof shouldAutoScrollChat === 'function' && !shouldAutoScrollChat()) return;
      mainChatPreflightFollowFrame = requestAnimationFrame(function() {
        mainChatPreflightFollowFrame = null;
        if (!messageDiv || !document.documentElement.contains(messageDiv)) return;
        // The user may scroll upward between the status update and this frame.
        // Recheck the follow state so progress updates never steal their viewport.
        if (typeof shouldAutoScrollChat === 'function' && !shouldAutoScrollChat()) return;
        maybeScrollChatToBottom(false);
      });
    }

    function formatMainChatRuntimeStatus(status) {
      var normalized = String(status || '').trim().toLowerCase();
      if (!normalized) return '';
      if (/-running$/.test(normalized) || normalized === 'running') return '运行中';
      return String(status || '').trim();
    }

    function createMainChatPreflightLogRow(entry) {
      var row = document.createElement('div');
      row.className = 'pi-preflight-log-row';
      var time = document.createElement('span');
      time.className = 'pi-preflight-log-time';
      var startedAtMs = Number(entry && entry.startedAtMs || Date.now());
      var durationSeconds = Number.isFinite(Number(entry && entry.durationSeconds))
        ? Number(entry.durationSeconds)
        : Math.floor((Date.now() - startedAtMs) / 1000);
      time.textContent = String(Math.max(0, durationSeconds)) + 's';
      var text = document.createElement('span');
      text.className = 'pi-preflight-log-text';
      text.textContent = String(entry && entry.message || '');
      row.appendChild(time);
      row.appendChild(text);
      return row;
    }

    function renderMainChatPreflightLog(messageDiv) {
      if (!messageDiv || messageDiv !== mainChatPiQueueHostMessage) return;
      var current = document.getElementById('mainChatPreflightCurrent');
      var log = document.getElementById('mainChatPreflightLog');
      if (!current || !log) return;
      var entries = Array.isArray(messageDiv.__piPreflightLog)
        ? messageDiv.__piPreflightLog
        : [];
      var currentEntry = entries.length ? entries[entries.length - 1] : null;
      var historyEntries = entries.length > 1 ? entries.slice(0, -1) : [];
      current.innerHTML = '';
      if (currentEntry) current.appendChild(createMainChatPreflightLogRow(currentEntry));
      current.hidden = !currentEntry;
      log.innerHTML = '';
      historyEntries.forEach(function(entry) {
        log.appendChild(createMainChatPreflightLogRow(entry));
      });
      log.hidden = historyEntries.length === 0;
      if (!log.hidden) log.scrollTop = log.scrollHeight;
    }

    function removeMainChatThinkingMessages() {
      if (!messagesDiv || !messagesDiv.querySelectorAll) return;
      messagesDiv.querySelectorAll('.thinking-message').forEach(function(messageDiv) {
        stopMainChatPreflightHeader(messageDiv);
        if (messageDiv && messageDiv.parentNode) {
          messageDiv.parentNode.removeChild(messageDiv);
        }
      });
      resetMainChatPiQueueHost();
    }

    function resetMainChatPiQueueHost() {
      if (mainChatPiQueueHostMessage) {
        stopMainChatPreflightHeader(mainChatPiQueueHostMessage);
        mainChatPiQueueHostMessage.classList.remove('pi-agent-message');
      }
      mainChatPiQueueHostMessage = null;
      var panel = document.getElementById('mainChatPiQueuePanel');
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    }

    function renderMainChatPiQueue(state) {
      if (mainChatPiQueueHostMessage && !document.documentElement.contains(mainChatPiQueueHostMessage)) {
        mainChatPiQueueHostMessage = null;
      }
      if (!mainChatPiQueueHostMessage) return;
      var panel = document.getElementById('mainChatPiQueuePanel') || createMainChatPiQueuePanel();
      var title = document.getElementById('mainChatPiQueueTitle');
      var followUpBtn = document.getElementById('piFollowUpModeBtn');
      var steerBtn = document.getElementById('piSteerModeBtn');
      if (!panel) return;
      var pending = state && Array.isArray(state.pending) ? state.pending : mainChatQueryQueue;
      var displayedPending = getVisibleMainChatPiQueueItems(pending);
      // The strip follows this renderer's active response. A stale server-side
      // running flag must not leave it visible after the response has finished.
      var running = isGenerating;
      var responseStarted = !!(
        mainChatPiQueueHostMessage
        && mainChatPiQueueHostMessage.dataset
        && mainChatPiQueueHostMessage.dataset.piResponseStarted === 'true'
      );
      // Any real assistant output replaces the preflight strip. Queued
      // instructions can still reopen the panel when they need user control.
      var visible = !!mainChatPiQueueHostMessage && (
        displayedPending.length > 0
        || (running && !responseStarted)
      );
      panel.hidden = !visible;
      if (mainChatPiQueueHostMessage) mainChatPiQueueHostMessage.classList.toggle('pi-agent-message', visible);
      panel.classList.toggle('running', running);
      if (followUpBtn) followUpBtn.classList.toggle('active', mainChatPiQueueBehavior === 'follow_up');
      if (steerBtn) steerBtn.classList.toggle('active', mainChatPiQueueBehavior === 'steer');
      renderMainChatPiQueueItems(displayedPending);
      if (title) {
        var steerCount = displayedPending.filter(function(item) { return item.behavior === 'steer'; }).length;
        var followUpCount = displayedPending.filter(function(item) { return item.behavior !== 'steer'; }).length;
        var startedAt = Number(
          mainChatPiQueueHostMessage
          && mainChatPiQueueHostMessage.dataset
          && mainChatPiQueueHostMessage.dataset.piStartedAt
          || 0
        );
        var elapsedLabel = running && startedAt
          ? ' · ' + Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) + 's'
          : '';
        var preflightStatus = String(
          mainChatPiQueueHostMessage
          && mainChatPiQueueHostMessage.dataset
          && mainChatPiQueueHostMessage.dataset.piStatus
          || ''
        ).trim();
        title.textContent = (running && preflightStatus ? preflightStatus : (running ? '运行中' : '会话待继续')) +
          (displayedPending.length ? ' · 转向 ' + steerCount + ' / 后续 ' + followUpCount : ' · 可继续输入') +
          elapsedLabel;
      }
    }

    function resetMainChatAttachedRunState() {
      mainChatAttachedRunId = '';
      mainChatAttachedRunEventSequence = 0;
      mainChatAttachedRunMessage = null;
      mainChatAttachedRunText = '';
      mainChatAttachedRunRenderer = null;
    }

    function ensureMainChatAttachedRunMessage(state) {
      var runId = String(state && state.runId || '');
      if (!runId) return null;
      if (
        mainChatAttachedRunId === runId
        && mainChatAttachedRunMessage
        && document.documentElement.contains(mainChatAttachedRunMessage)
      ) {
        return mainChatAttachedRunMessage;
      }
      resetMainChatAttachedRunState();
      mainChatAttachedRunId = runId;
      var messageDiv = document.createElement('div');
      messageDiv.className = 'message bot thinking-message pi-reattached-run';
      messageDiv.dataset.piRunId = runId;
      messageDiv.innerHTML = '<div class="avatar bot">' + getMessageAvatarHtml('bot') + '</div><div class="content" aria-hidden="true"></div>';
      messagesDiv.appendChild(messageDiv);
      startMainChatPreflightHeader(messageDiv);
      var startedAt = Date.parse(String(state.startedAt || ''));
      if (Number.isFinite(startedAt) && startedAt > 0) {
        messageDiv.dataset.piStartedAt = String(startedAt);
      }
      setMainChatPreflightStatus(messageDiv, '正在重新连接原 Agent 任务…');
      mainChatAttachedRunMessage = messageDiv;
      attachMainChatPiQueuePanelToMessage(messageDiv);
      startChatStreamTail();
      maybeScrollChatToBottom(true);
      return messageDiv;
    }

    function renderMainChatAttachedRunText(state) {
      var messageDiv = ensureMainChatAttachedRunMessage(state);
      if (!messageDiv) return;
      if (messageDiv.classList.contains('thinking-message')) {
        stopMainChatPreflightHeader(messageDiv);
        messageDiv.classList.remove('thinking-message');
        var initialContent = messageDiv.querySelector('.content');
        if (initialContent) {
          initialContent.removeAttribute('aria-hidden');
          initialContent.innerHTML = '';
        }
      }
      messageDiv.dataset.piResponseStarted = 'true';
      renderMainChatPiQueue(mainChatPiState);
      if (!mainChatAttachedRunRenderer) {
        mainChatAttachedRunRenderer = createBotTextStreamer(messageDiv);
      }
      mainChatAttachedRunRenderer.setText(mainChatAttachedRunText);
    }

    function completeMainChatAttachedRun(state, failed) {
      var messageDiv = mainChatAttachedRunMessage;
      if (messageDiv && messageDiv.dataset && messageDiv.dataset.piRunFinalizing === 'true') {
        return;
      }
      if (messageDiv && messageDiv.dataset) {
        messageDiv.dataset.piRunFinalizing = 'true';
      }
      var finalRenderPromise = Promise.resolve();
      if (messageDiv && mainChatAttachedRunText) {
        renderMainChatAttachedRunText(state);
        var attachedRenderer = mainChatAttachedRunRenderer;
        var startedAt = Date.parse(String(state && state.startedAt || ''));
        var completedAt = Date.parse(String(state && state.completedAt || ''));
        var elapsedMs = Number.isFinite(startedAt) && startedAt > 0
          ? Math.max(0, (Number.isFinite(completedAt) && completedAt > 0 ? completedAt : Date.now()) - startedAt)
          : 0;
        if (attachedRenderer && typeof attachedRenderer.finish === 'function') {
          finalRenderPromise = Promise.resolve(attachedRenderer.finish(mainChatAttachedRunText, elapsedMs, state && state.usage));
        }
        var conversationId = currentConversationId || state.conversationId;
        var saved = readConversationMessagesLocal(conversationId);
        if (!saved.find(function(item) {
          return item && item.role === 'assistant' && item.content === mainChatAttachedRunText;
        })) {
          saved.push({
            role: 'assistant',
            content: mainChatAttachedRunText,
            isHtml: false,
            timestamp: Date.now(),
            usage: state && state.usage,
            elapsedMs: elapsedMs
          });
          storeConversationMessagesLocally(conversationId, saved);
          Promise.resolve(persistConversationNow(conversationId)).catch(function(error) {
            console.warn('[PiSession] Failed to persist reattached Agent result:', error);
          });
        }
      } else if (messageDiv && failed && messageDiv.parentNode) {
        stopMainChatPreflightHeader(messageDiv);
        messageDiv.parentNode.removeChild(messageDiv);
      }
      finalRenderPromise.catch(function(error) {
        console.warn('[PiSession] Failed to finalize reattached Agent transcript:', error);
      }).then(function() {
        if (messageDiv && messageDiv.parentNode && mainChatAttachedRunText) {
          var contentDiv = messageDiv.querySelector('.content');
          if (contentDiv) {
            contentDiv.classList.toggle('agent-transcript-content', isAgentTranscriptText(mainChatAttachedRunText));
            if (!contentDiv.querySelector('.message-actions')) {
              contentDiv.insertAdjacentHTML('beforeend', renderMessageFooter(true));
            }
            initWorkspaceImageStacks(contentDiv);
            syncMessageLocalFileVisibilityClass(messageDiv);
          }
        }
        var controller = currentAbortController;
        if (controller) finishMainChatRequest(controller);
        else {
          isGenerating = false;
          activeMainChatConversationId = null;
          activeMainChatProjectId = null;
          activeMainChatProvider = null;
          setMainChatInputBusy(false);
          updateMainChatQueueButtonState();
          scheduleMainChatQueueDrain();
        }
      });
    }

    function rebuildMainChatPersistedRunText(events) {
      var replayText = '';
      (Array.isArray(events) ? events.slice() : [])
        .sort(function(left, right) {
          return Number(left && left.sequence || 0) - Number(right && right.sequence || 0);
        })
        .forEach(function(event) {
          var payload = event && event.payload || {};
          if (event && event.type === 'chunk') {
            replayText += String(payload.content || '');
          } else if (
            event
            && event.type === 'complete'
            && typeof payload.content === 'string'
            && payload.content.length > 0
          ) {
            replayText = payload.content;
          }
        });
      return replayText;
    }

    function normalizeMainChatPersistedRunText(text) {
      return String(text || '')
        .replace(/<scholar-harness-ui-action\b([^>]*?)(?:>\s*<\/scholar-harness-ui-action\s*>|\/>)/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function hasSavedMainChatAssistantReplay(savedMessages, replayText) {
      var normalizedReplay = normalizeMainChatPersistedRunText(replayText);
      if (!normalizedReplay) return false;
      return (Array.isArray(savedMessages) ? savedMessages : []).some(function(item) {
        return item
          && item.role === 'assistant'
          && normalizeMainChatPersistedRunText(item.content) === normalizedReplay;
      });
    }

    function acknowledgeMainChatPersistedRunWithoutRendering(state, events) {
      mainChatAttachedRunId = String(state && state.runId || '');
      mainChatAttachedRunEventSequence = Math.max(
        Number(state && state.lastEventSequence || 0),
        (Array.isArray(events) ? events : []).reduce(function(highest, event) {
          return Math.max(highest, Number(event && event.sequence || 0));
        }, 0)
      );
      mainChatAttachedRunMessage = null;
      mainChatAttachedRunText = '';
      mainChatAttachedRunRenderer = null;
    }

    function reconcileMainChatPersistedRun(state) {
      if (!state || !state.runId) return false;
      // The normal live fetch already owns the visible stream. Persisted-event
      // replay is only for a renderer that returned without that transport.
      var currentRunUsesReattachedRenderer = !!(
        mainChatAttachedRunId === state.runId
        && mainChatAttachedRunMessage
        && document.documentElement.contains(mainChatAttachedRunMessage)
        && mainChatPiQueueHostMessage === mainChatAttachedRunMessage
      );
      if (
        state.running
        && isGenerating
        && currentAbortController
        && activeMainChatConversationId === (state.conversationId || currentConversationId)
        && hasActiveMainChatRunVisual()
        && !currentRunUsesReattachedRenderer
      ) {
        return false;
      }
      var events = Array.isArray(state.runEvents) ? state.runEvents : [];
      var hasUnseenEvents = events.some(function(event) {
        return Number(event && event.sequence || 0) > mainChatAttachedRunEventSequence;
      });
      var savedMessages = readConversationMessagesLocal(state.conversationId || currentConversationId);
      var terminalRun = !state.running && ['completed', 'cancelled', 'error', 'interrupted'].includes(state.runStatus);
      var persistedReplayText = terminalRun ? rebuildMainChatPersistedRunText(events) : '';
      var hasAttachedRunMessage = !!(
        mainChatAttachedRunId === state.runId
        && mainChatAttachedRunMessage
        && document.documentElement.contains(mainChatAttachedRunMessage)
      );
      // The normal conversation history is rendered before the persisted Pi
      // journal is reconciled. A desktop restart can leave a terminal run with
      // chunk events but no complete event even though its final assistant text
      // was already saved. Consume that journal without creating a second DOM
      // bubble. UI-action tags are stripped without executing them again.
      if (
        terminalRun
        && !hasAttachedRunMessage
        && hasSavedMainChatAssistantReplay(savedMessages, persistedReplayText)
      ) {
        acknowledgeMainChatPersistedRunWithoutRendering(state, events);
        return false;
      }
      if (!state.running && !hasUnseenEvents && !hasAttachedRunMessage) return false;

      ensureMainChatAttachedRunMessage(state);
      if (state.running) {
        if (!isGenerating) {
          isGenerating = true;
          currentAbortController = new AbortController();
          activeMainChatConversationId = state.conversationId || currentConversationId;
          activeMainChatProjectId = state.projectId || getMainChatProjectId();
          activeMainChatProvider = state.provider || null;
          registerMainChatActiveRun(activeMainChatConversationId, currentAbortController, activeMainChatProjectId);
          setMainChatInputBusy(true);
          if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.classList.add('sending', 'can-stop');
          }
        }
      }

      events.forEach(function(event) {
        var sequence = Number(event && event.sequence || 0);
        if (!sequence || sequence <= mainChatAttachedRunEventSequence) return;
        var payload = event.payload || {};
        if (event.type === 'status') {
          setMainChatPreflightStatus(
            mainChatAttachedRunMessage,
            payload.message || payload.status || payload.stage || 'Agent 正在继续执行…'
          );
        } else if (event.type === 'chunk') {
          mainChatAttachedRunText += String(payload.content || '');
          if (mainChatAttachedRunText) renderMainChatAttachedRunText(state);
        } else if (event.type === 'complete') {
          if (payload.usage) state.usage = payload.usage;
          if (typeof payload.content === 'string' && payload.content.length > 0) {
            mainChatAttachedRunText = payload.content;
          }
          mainChatAttachedRunText = executeFrontendUiActionsFromAiResponse(mainChatAttachedRunText);
          if (mainChatAttachedRunText) renderMainChatAttachedRunText(state);
        } else if (event.type === 'error') {
          var errorText = String(payload.error || state.runError || 'Agent 任务执行失败');
          mainChatAttachedRunText = mainChatAttachedRunText || ('连接恢复后读取到任务错误：' + errorText);
          renderMainChatAttachedRunText(state);
        }
        mainChatAttachedRunEventSequence = Math.max(mainChatAttachedRunEventSequence, sequence);
      });

      if (terminalRun) {
        completeMainChatAttachedRun(state, state.runStatus !== 'completed');
      } else {
        renderMainChatPiQueue(state);
        updateMainChatQueueButtonState();
      }
      return true;
    }

    function scheduleMainChatPiQueuePoll(delay) {
      if (mainChatPiPollTimer) clearTimeout(mainChatPiPollTimer);
      var hasPending = !!(mainChatPiState && mainChatPiState.pendingMessageCount > 0);
      if (!isGenerating && !hasPending) {
        mainChatPiPollTimer = null;
        return;
      }
      mainChatPiPollTimer = setTimeout(function() {
        mainChatPiPollTimer = null;
        syncMainChatPiQueueState({ claimWhenIdle: true });
      }, Math.max(300, Number(delay || 800)));
    }

    async function syncMainChatPiQueueState(options) {
      options = options || {};
      if (!currentConversationId || mainChatPiSyncInFlight) return false;
      mainChatPiSyncInFlight = true;
      try {
        var afterSequence = mainChatAttachedRunEventSequence;
        if (!afterSequence && mainChatPiState && mainChatPiState.runId) {
          afterSequence = Number(mainChatPiState.lastEventSequence || 0);
        }
        var response = await fetch(
          getMainChatPiSessionUrl(currentConversationId)
          + '?userId=' + encodeURIComponent(currentUserId || 'web-user')
          + '&projectId=' + encodeURIComponent(getMainChatProjectId())
          + '&afterSequence=' + encodeURIComponent(String(Math.max(0, afterSequence || 0)))
        );
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success || !result.state) throw new Error(result.error || ('HTTP ' + response.status));
        mainChatPiState = result.state;
        reconcileMainChatPersistedRun(result.state);
        var pendingById = {};
        (result.state.pending || []).forEach(function(item) {
          pendingById[item.id] = item;
          var old = mainChatQueryQueue.find(function(candidate) { return candidate.id === item.id; });
          var legacyQueuedElement = (old && old.userMessageEl) || findPiQueuedMessageElement(item.id);
          if (legacyQueuedElement && legacyQueuedElement.classList.contains('queued-query-message') && legacyQueuedElement.parentNode) {
            legacyQueuedElement.parentNode.removeChild(legacyQueuedElement);
          }
          item.userMessageEl = null;
          updatePiQueuedMessageLocalRecord(item, item.status);
        });
        (result.state.recent || []).forEach(function(item) {
          if (item.status === 'applied') {
            var element = findPiQueuedMessageElement(item.id);
            if (element) clearQueuedQueryStatus({ id: item.id, userMessageEl: element });
            updatePiQueuedMessageLocalRecord(item, 'applied');
          } else if (item.status === 'cancelled') {
            var cancelledElement = findPiQueuedMessageElement(item.id);
            if (cancelledElement && cancelledElement.parentNode) cancelledElement.parentNode.removeChild(cancelledElement);
            removePiQueuedMessageLocalRecord(item);
          }
        });
        mainChatQueryQueue = (result.state.pending || []).map(function(item) {
          item.userMessageEl = null;
          item.serverManaged = true;
          return item;
        });
        if (!result.state.running && mainChatAttachedRunId !== result.state.runId) {
          recoverStaleMainChatFrontendRun('server reports no active Pi run');
        }
        refreshMainChatQueueStatuses();
        renderMainChatPiQueue(result.state);
        if (options.claimWhenIdle !== false && !isMainChatConversationRunning() && !result.state.running && result.state.pendingMessageCount > 0) {
          await claimNextMainChatPiMessage();
        }
        return true;
      } catch (error) {
        console.warn('[PiSession] Queue state sync failed; local compatibility queue remains active:', error);
        renderMainChatPiQueue(mainChatPiState);
        return false;
      } finally {
        mainChatPiSyncInFlight = false;
        scheduleMainChatPiQueuePoll(800);
      }
    }
    window.syncMainChatPiQueueState = syncMainChatPiQueueState;

    async function claimNextMainChatPiMessage() {
      if (isMainChatConversationRunning() || mainChatPiContinuationStarting || mainChatPiClaimInFlight || !currentConversationId) return null;
      mainChatPiClaimInFlight = true;
      try {
        var response = await fetch(getMainChatPiSessionUrl(currentConversationId) + '/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId || 'web-user', projectId: getMainChatProjectId() || undefined })
        });
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success) throw new Error(result.error || ('HTTP ' + response.status));
        mainChatPiState = result.state || mainChatPiState;
        if (!result.item) {
          renderMainChatPiQueue(mainChatPiState);
          return null;
        }
        var item = result.item;
        item.piQueueMessageId = item.id;
        item.persistedAtEnqueue = true;
        item.serverManaged = true;
        var legacyQueuedElement = findPiQueuedMessageElement(item.id);
        if (legacyQueuedElement && legacyQueuedElement.parentNode) {
          legacyQueuedElement.parentNode.removeChild(legacyQueuedElement);
        }
        item.userMessageEl = null;
        updatePiQueuedMessageLocalRecord(item, 'processing');
        userInput.value = item.message;
        autoResize();
        mainChatPiContinuationStarting = true;
        Promise.resolve(sendMessage(item)).catch(function(error) {
          console.warn('[PiSession] Queued continuation failed:', error);
          return requeueMainChatPiMessage(item);
        }).finally(function() {
          mainChatPiContinuationStarting = false;
          scheduleMainChatQueueDrain();
        });
        return item;
      } catch (error) {
        console.warn('[PiSession] Failed to claim next queued message:', error);
        return null;
      } finally {
        mainChatPiClaimInFlight = false;
      }
    }

    async function requeueMainChatPiMessage(queueItem) {
      if (!queueItem || !queueItem.serverManaged || !queueItem.id || !(queueItem.conversationId || currentConversationId)) return;
      try {
        await fetch(getMainChatPiSessionUrl(queueItem.conversationId || currentConversationId) + '/messages/' + encodeURIComponent(queueItem.id) + '/requeue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId || 'web-user',
            projectId: String(queueItem.projectId || getMainChatProjectId() || '') || undefined
          })
        });
      } catch (error) {
        console.warn('[PiSession] Failed to requeue message after request error:', error);
      }
    }

    async function enqueueMainChatQuery(message, attachments, selectedWorkspaceFiles, behavior) {
      var text = String(message || '').trim();
      var queuedWorkspaceFiles = mergeWorkspaceFileMentions([], Array.isArray(selectedWorkspaceFiles)
        ? selectedWorkspaceFiles
        : getSelectedWorkspacePreviewFiles());
      var queuedAttachments = mergeWorkspaceSelectedImageAttachments(
        Array.isArray(attachments) ? attachments : [],
        queuedWorkspaceFiles
      );
      if (!text && queuedAttachments.length === 0 && queuedWorkspaceFiles.length === 0) return null;
      ensureCurrentConversationId();
      var queueItem = {
        id: makeMainChatQueueId(),
        conversationId: currentConversationId,
        projectId: getMainChatProjectId() || undefined,
        message: text || (queuedAttachments.length > 0
          ? getDefaultChatAttachmentMessage(queuedAttachments)
          : '请读取我选择的工作目录文件，并根据文件内容回答。'),
        behavior: behavior === 'steer' ? 'steer' : (behavior === 'follow_up' ? 'follow_up' : mainChatPiQueueBehavior),
        status: 'queued',
        chatAttachments: queuedAttachments,
        workspaceFileMentions: queuedWorkspaceFiles,
        createdAt: new Date().toISOString(),
        createdAtMs: Date.now(),
        userMessageEl: null,
        serverManaged: false,
        persistedAtEnqueue: true
      };
      mainChatQueryQueue.push(queueItem);
      updatePiQueuedMessageLocalRecord(queueItem, 'queued');
      userInput.value = '';
      autoResize();
      clearWorkspacePreviewSelections();
      refreshMainChatQueueStatuses();
      renderMainChatPiQueue({
        running: true,
        pending: mainChatQueryQueue,
        pendingMessageCount: mainChatQueryQueue.length
      });
      try {
        var response = await fetch(getMainChatPiSessionUrl(currentConversationId) + '/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId || 'web-user',
            projectId: getMainChatProjectId() || undefined,
            message: queueItem.message,
            behavior: queueItem.behavior,
            clientMessageId: queueItem.id,
            chatAttachments: queueItem.chatAttachments,
            workspaceFileMentions: queueItem.workspaceFileMentions
          })
        });
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success || !result.item) throw new Error(result.error || ('HTTP ' + response.status));
        queueItem.serverManaged = true;
        queueItem.status = result.item.status || 'queued';
        mainChatPiState = result.state || mainChatPiState;
        renderMainChatPiQueue(mainChatPiState);
        scheduleMainChatPiQueuePoll(250);
      } catch (error) {
        console.warn('[PiSession] Server queue unavailable; retaining local follow-up compatibility:', error);
        setQueuedQueryStatus(queueItem, getMainChatPiQueueLabel(queueItem.behavior) + '消息已保存在本地队列');
      }
      return queueItem;
    }

    async function editMainChatPiQueuedMessage(messageId) {
      var item = mainChatQueryQueue.find(function(candidate) { return candidate.id === messageId; });
      if (!item || item.status !== 'queued') return;
      var nextText = window.prompt('编辑排队消息', item.message || '');
      if (nextText === null) return;
      nextText = String(nextText || '').trim();
      if (!nextText) return;
      try {
        if (item.serverManaged) {
          var response = await fetch(getMainChatPiSessionUrl(item.conversationId || currentConversationId) + '/messages/' + encodeURIComponent(item.id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUserId || 'web-user', projectId: getMainChatProjectId() || undefined, message: nextText })
          });
          var result = await response.json().catch(function() { return {}; });
          if (!response.ok || !result.success) throw new Error(result.error || ('HTTP ' + response.status));
          mainChatPiState = result.state || mainChatPiState;
        }
        item.message = nextText;
        item.updatedAt = new Date().toISOString();
        updatePiQueuedMessageLocalRecord(item, 'queued');
        renderMainChatPiQueue(mainChatPiState || { running: isGenerating, pending: mainChatQueryQueue });
      } catch (error) {
        alert('编辑排队消息失败：' + (error.message || error));
      }
    }
    window.editMainChatPiQueuedMessage = editMainChatPiQueuedMessage;

    async function cancelMainChatPiQueuedMessage(messageId) {
      var item = mainChatQueryQueue.find(function(candidate) { return candidate.id === messageId; });
      if (!item || item.status !== 'queued') return;
      try {
        if (item.serverManaged) {
          var response = await fetch(getMainChatPiSessionUrl(item.conversationId || currentConversationId) + '/messages/' + encodeURIComponent(item.id) + '?userId=' + encodeURIComponent(currentUserId || 'web-user') + '&projectId=' + encodeURIComponent(getMainChatProjectId()), {
            method: 'DELETE'
          });
          var result = await response.json().catch(function() { return {}; });
          if (!response.ok || !result.success) throw new Error(result.error || ('HTTP ' + response.status));
          mainChatPiState = result.state || mainChatPiState;
        }
        mainChatQueryQueue = mainChatQueryQueue.filter(function(candidate) { return candidate.id !== messageId; });
        var element = item.userMessageEl || findPiQueuedMessageElement(item.id);
        if (element && element.parentNode) element.parentNode.removeChild(element);
        removePiQueuedMessageLocalRecord(item);
        refreshMainChatQueueStatuses();
        renderMainChatPiQueue(mainChatPiState || { running: isGenerating, pending: mainChatQueryQueue });
      } catch (error) {
        alert('撤回排队消息失败：' + (error.message || error));
      }
    }
    window.cancelMainChatPiQueuedMessage = cancelMainChatPiQueuedMessage;

    function drainLocalMainChatCompatibilityQueue() {
      if (isGenerating) return;
      var nextIndex = mainChatQueryQueue.findIndex(function(item) {
        return item && item.status === 'queued' && item.serverManaged !== true;
      });
      if (nextIndex < 0) return;
      var nextItem = mainChatQueryQueue.splice(nextIndex, 1)[0];
      refreshMainChatQueueStatuses();
      var legacyQueuedElement = nextItem.userMessageEl || findPiQueuedMessageElement(nextItem.id);
      if (legacyQueuedElement && legacyQueuedElement.parentNode) {
        legacyQueuedElement.parentNode.removeChild(legacyQueuedElement);
      }
      nextItem.userMessageEl = null;
      userInput.value = nextItem.message;
      autoResize();
      sendMessage(nextItem);
    }

    function scheduleMainChatQueueDrain() {
      if (mainChatQueueDrainTimer) {
        clearTimeout(mainChatQueueDrainTimer);
        mainChatQueueDrainTimer = null;
      }
      if (isGenerating || mainChatQueryQueue.length === 0) {
        refreshMainChatQueueStatuses();
        scheduleMainChatPiQueuePoll(400);
        return;
      }
      mainChatQueueDrainTimer = setTimeout(function() {
        mainChatQueueDrainTimer = null;
        if (isGenerating || mainChatQueryQueue.length === 0) return;
        syncMainChatPiQueueState({ claimWhenIdle: true }).then(function(synced) {
          if (!synced) drainLocalMainChatCompatibilityQueue();
        });
      }, 120);
    }
    
    function markMainChatInputPriority() {
      mainChatLastInputAt = Date.now();
    }

    // Mark priority before Chromium commits an IME candidate. Waiting until the
    // final input event leaves a small race where a stream render can start after
    // Space is pressed but before compositionend/input is dispatched.
    userInput.addEventListener('keydown', markMainChatInputPriority, true);
    userInput.addEventListener('beforeinput', markMainChatInputPriority, true);
    userInput.addEventListener('compositionstart', function() {
      mainChatInputComposing = true;
      markMainChatInputPriority();
    });
    userInput.addEventListener('compositionend', function() {
      mainChatInputComposing = false;
      markMainChatInputPriority();
      scheduleMainChatInputHeight(MAIN_CHAT_INPUT_RESIZE_DELAY_MS);
      if (isGenerating) {
        updateMainChatQueueButtonState({ renderQueue: false });
      }
    });
    userInput.addEventListener('input', autoResize);
    userInput.addEventListener('focus', syncChatPlaceholder);
    userInput.addEventListener('blur', syncChatPlaceholder);
    initMainChatInputInteractivity();
    
    // @ 工作目录文件自动完成
    var mentionDropdown = document.getElementById('mentionDropdown');
    var mentionStartPos = -1;
    var workspaceMentionSearchTimer = null;
    var workspaceMentionSearchSequence = 0;

    function getLeadingInvocationMarkerIndex(value, marker) {
      var text = String(value || '');
      var firstContentIndex = text.search(/\S/);
      if (firstContentIndex < 0 || text.charAt(firstContentIndex) !== marker) return -1;
      return firstContentIndex;
    }

    function findActiveWorkspaceMention(value, cursor) {
      var text = String(value || '');
      var pos = Number(cursor || 0);
      var leadingAtIndex = getLeadingInvocationMarkerIndex(text, '@');
      if (leadingAtIndex < 0 || pos <= leadingAtIndex) return null;
      var typed = text.substring(leadingAtIndex + 1, pos);
      if (/\r|\n|@/.test(typed) || typed.length > 180) return null;
      if (typed.charAt(0) === '"') {
        var quoted = typed.substring(1);
        if (quoted.indexOf('"') >= 0) return null;
        typed = quoted;
      }
      return { start: leadingAtIndex, query: typed.trim() };
    }

    function getWorkspaceMentionIconName(kind) {
      if (kind === 'image') return 'image';
      if (kind === 'spreadsheet' || kind === 'data') return 'table';
      if (kind === 'code') return 'code';
      return 'fileText';
    }

    function renderWorkspaceMentionStatus(message) {
      mentionDropdown.innerHTML = '<div class="workspace-mention-status">' + escapeHtml(message) + '</div>';
    }

    function renderWorkspaceMentionFiles(files, truncated) {
      var rows = Array.isArray(files) ? files : [];
      if (!rows.length) {
        renderWorkspaceMentionStatus('没有找到匹配的工作目录文件。');
        return;
      }
      mentionDropdown.innerHTML = rows.map(function(file) {
        var filePath = String(file.path || '');
        var fileName = String(file.name || filePath.split(/[\\/]/).pop() || filePath);
        var meta = [String(file.kind || 'file'), formatWorkspacePreviewSize(file.size || 0)].filter(Boolean).join(' · ');
        return '<div class="mention-item" role="option" data-workspace-file-path="' + escapeHtml(filePath) + '" title="' + escapeHtml(filePath) + '">' +
          '<span class="mention-icon">' + uiIcon(getWorkspaceMentionIconName(file.kind), 'md') + '</span>' +
          '<span class="workspace-mention-file-main">' +
            '<span class="workspace-mention-file-name">' + escapeHtml(fileName) + '</span>' +
            '<span class="workspace-mention-file-path">' + escapeHtml(filePath) + (meta ? ' · ' + escapeHtml(meta) : '') + '</span>' +
          '</span>' +
        '</div>';
      }).join('') + (truncated ? '<div class="workspace-mention-status">结果较多，请继续输入文件名缩小范围。</div>' : '');
    }

    async function loadWorkspaceMentionFiles(query, sequence) {
      var workspace = getWorkspaceDirectoryPayload();
      if (!workspace) {
        renderWorkspaceMentionStatus('尚未配置工作目录，请先点击输入框左侧的文件夹按钮。');
        return;
      }
      try {
        var response = await fetch('/api/chat-bridge/workspace/mentions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace: workspace, query: query || '', maxResults: 120 })
        });
        var data = await response.json();
        if (sequence !== workspaceMentionSearchSequence || mentionDropdown.style.display !== 'block') return;
        if (!response.ok || !data.success) throw new Error(data.error || '工作目录文件检索失败');
        renderWorkspaceMentionFiles(data.result && data.result.files, !!(data.result && data.result.truncated));
        currentDropdownItems = getDropdownItems(mentionDropdown);
        currentDropdownIndex = currentDropdownItems.length ? 0 : -1;
        updateDropdownHighlight();
      } catch (error) {
        if (sequence !== workspaceMentionSearchSequence) return;
        renderWorkspaceMentionStatus('工作目录文件检索失败：' + (error.message || String(error)));
      }
    }

    function scheduleWorkspaceMentionSearch(query) {
      if (workspaceMentionSearchTimer) clearTimeout(workspaceMentionSearchTimer);
      workspaceMentionSearchSequence += 1;
      var sequence = workspaceMentionSearchSequence;
      renderWorkspaceMentionStatus(query ? '正在检索工作目录文件...' : '正在读取工作目录文件...');
      workspaceMentionSearchTimer = setTimeout(function() {
        workspaceMentionSearchTimer = null;
        loadWorkspaceMentionFiles(query, sequence);
      }, query ? 160 : 40);
    }

    function insertWorkspaceFileMention(filePath) {
      var cleanPath = String(filePath || '').replace(/"/g, '').trim();
      if (!cleanPath || mentionStartPos < 0) return;
      var value = userInput.value;
      var cursor = userInput.selectionStart;
      var before = value.substring(0, mentionStartPos);
      var after = value.substring(cursor);
      var insert = '@"' + cleanPath + '" ';
      userInput.value = before + insert + after;
      var nextPos = before.length + insert.length;
      userInput.setSelectionRange(nextPos, nextPos);
      hideMentionDropdown();
      autoResize();
      userInput.focus();
    }

    function extractWorkspaceFileMentions(message) {
      var matches = [];
      var match = /^\s*@"([^"\r\n]+)"/.exec(String(message || ''));
      if (!match) return matches;
      var filePath = String(match[1] || '').trim();
      if (!filePath) return matches;
      matches.push({
        path: filePath,
        name: filePath.split(/[\\/]/).pop() || filePath,
        source: 'composer-workspace-mention'
      });
      return matches;
    }
    
    function handleWorkspaceMentionComposerInput(event) {
      if (mainChatInputComposing || (event && event.isComposing)) return;
      var value = userInput.value;
      var pos = userInput.selectionStart;
      
      var activeMention = findActiveWorkspaceMention(value, pos);
      if (!activeMention) {
        hideMentionDropdown();
        return;
      }
      mentionStartPos = activeMention.start;
      showMentionDropdown(activeMention.query);
    }

    userInput.addEventListener('input', handleWorkspaceMentionComposerInput);
    
    function showMentionDropdown(query) {
      if (mentionDropdown.style.display !== 'block') {
        mentionDropdown.style.display = 'block';
      }
      currentDropdownIndex = -1;
      scheduleWorkspaceMentionSearch(query || '');
    }
    
    function hideMentionDropdown() {
      if (
        mentionDropdown.style.display !== 'block' &&
        mentionStartPos === -1 &&
        !workspaceMentionSearchTimer
      ) {
        return;
      }
      mentionDropdown.style.display = 'none';
      mentionStartPos = -1;
      currentDropdownIndex = -1;
      workspaceMentionSearchSequence += 1;
      if (workspaceMentionSearchTimer) {
        clearTimeout(workspaceMentionSearchTimer);
        workspaceMentionSearchTimer = null;
      }
    }
    
    mentionDropdown.addEventListener('mousedown', function(event) {
      event.preventDefault();
    });
    mentionDropdown.addEventListener('click', function(event) {
      var item = event.target && event.target.closest ? event.target.closest('[data-workspace-file-path]') : null;
      if (!item) return;
      insertWorkspaceFileMention(item.getAttribute('data-workspace-file-path'));
    });
    
    var slashDropdown = document.getElementById('slashDropdown');
    var slashStartPos = -1;
    var loadedJournalStyles = false;

    function renderUserSkillsForSlashDropdown(skills) {
      var section = document.getElementById('userSkillsSection');
      if (!section) return;
      Array.prototype.slice.call(section.querySelectorAll('[data-user-skill-item="1"]')).forEach(function(node) {
        node.remove();
      });
      var enabledSkills = (Array.isArray(skills) ? skills : []).filter(function(skill) {
        return skill && skill.enabled !== false && skill.trigger;
      });
      section.style.display = enabledSkills.length ? 'block' : 'none';
      enabledSkills.forEach(function(skill) {
        var item = document.createElement('div');
        item.className = 'slash-item';
        item.setAttribute('data-user-skill-item', '1');
        item.setAttribute('data-slash', skill.trigger);
        item.setAttribute('data-slash-insert', skill.trigger);
        item.innerHTML =
          '<span class="mention-icon">' + uiIcon('edit') + '</span>' +
          '<span class="mention-name">/' + escapeHtml(skill.trigger) + '</span>' +
          '<span class="mention-desc">' + escapeHtml(skill.name || skill.description || '用户 Skill') + '</span>';
        section.appendChild(item);
      });
      bindSlashItemClicks();
    }

    function loadUserSkillsForDropdown(force) {
      if (userSkillDropdownLoading) return;
      if (userSkillDropdownLoaded && !force) return;
      userSkillDropdownLoading = true;
      fetchUserSkills()
        .then(function(skills) {
          renderUserSkillsForSlashDropdown(skills);
          userSkillDropdownLoaded = true;
          updateSlashDropdownFilter();
        })
        .catch(function(e) {
          console.warn('Failed to load user skills:', e);
        })
        .finally(function() {
          userSkillDropdownLoading = false;
        });
    }

    function normalizeSkillChapterType(value) {
      var raw = String(value || '').trim().toLowerCase();
      raw = raw.replace(/^\/\+?/, '').replace(/^skill:/, '').trim();
      var aliasMap = {
        'title': 'title',
        '题目': 'title',
        '标题': 'title',
        'abstract': 'abstract',
        '摘要': 'abstract',
        'summary': 'abstract',
        'introduction': 'introduction',
        'intro': 'introduction',
        '引言': 'introduction',
        '绪论': 'introduction',
        'methods': 'methods',
        'method': 'methods',
        'methodology': 'methods',
        'materials': 'methods',
        '材料与方法': 'methods',
        '方法': 'methods',
        'results': 'results',
        'result': 'results',
        '结果': 'results',
        'discussion': 'discussion',
        '讨论': 'discussion',
        'conclusion': 'conclusion',
        'conclusions': 'conclusion',
        '结论': 'conclusion',
        'reference': 'reference-relevance',
        'references': 'reference-relevance',
        'citation': 'reference-relevance',
        'citation-integrity': 'reference-relevance',
        'reference-relevance': 'reference-relevance',
        '引用相关性': 'reference-relevance',
        '参考文献相关性': 'reference-relevance'
      };
      return aliasMap[raw] || raw;
    }

    function normalizeSlashSearchText(value) {
      return String(value || '').toLowerCase().replace(/^\/\+?/, '').replace(/^skill:/, '').trim();
    }

    function getSkillAliasesForSlash(slash) {
      var type = normalizeSkillChapterType(String(slash || '').replace(/^skill:/, ''));
      var aliases = {
        title: 'title 标题 题目',
        abstract: 'abstract 摘要 summary',
        introduction: 'introduction intro 引言 绪论',
        methods: 'methods method methodology 材料与方法 方法',
        results: 'results result 结果',
        discussion: 'discussion 讨论',
        conclusion: 'conclusion conclusions 结论',
        'reference-relevance': 'reference references citation citation-integrity 引用相关性 参考文献相关性'
      };
      return aliases[type] || '';
    }

    function getSlashQuery() {
      if (slashStartPos === -1) return '';
      var value = userInput.value;
      var pos = userInput.selectionStart;
      var raw = value.substring(slashStartPos + 1, pos);
      return normalizeSlashSearchText(raw);
    }

    function updateSlashDropdownFilter() {
      var query = getSlashQuery();
      var items = Array.prototype.slice.call(slashDropdown.querySelectorAll('.slash-item'));
      var visibleItems = [];
      var exactIndex = -1;

      items.forEach(function(item) {
        var slash = item.getAttribute('data-slash') || '';
        var name = item.querySelector('.mention-name')?.textContent || '';
        var desc = item.querySelector('.mention-desc')?.textContent || '';
        var normalizedSlash = normalizeSlashSearchText(slash);
        var normalizedName = normalizeSlashSearchText(name);
        var haystack = normalizeSlashSearchText([slash, name, desc, getSkillAliasesForSlash(slash)].join(' '));

        var matches = !query ||
          haystack.includes(query) ||
          normalizedSlash.includes(query) ||
          normalizedName.includes(query);

        item.style.display = matches ? '' : 'none';
        item.classList.remove('active');

        if (matches) {
          if (exactIndex === -1 && (
            normalizedSlash === query ||
            normalizedName === query ||
            getSkillAliasesForSlash(slash).toLowerCase().split(/\s+/).includes(query)
          )) {
            exactIndex = visibleItems.length;
          }
          visibleItems.push(item);
        }
      });

      currentDropdownItems = visibleItems;
      currentDropdownIndex = exactIndex >= 0 ? exactIndex : (visibleItems.length > 0 ? 0 : -1);
      updateDropdownHighlight();
    }
    
    function handleSlashComposerInput(event) {
      if (mainChatInputComposing || (event && event.isComposing)) return;
      var value = userInput.value;
      var pos = userInput.selectionStart;

      var leadingSlashIndex = getLeadingInvocationMarkerIndex(value, '/');

      if (leadingSlashIndex !== -1 && pos > leadingSlashIndex) {
        var textAfterSlash = value.substring(leadingSlashIndex, pos);
        if (!/\s/.test(textAfterSlash)) {
          slashStartPos = leadingSlashIndex;
          showSlashDropdown();
          updateSlashDropdownFilter();
          return;
        }
      }
      
      hideSlashDropdown();
    }

    userInput.addEventListener('input', handleSlashComposerInput);
    
    function showSlashDropdown() {
      if (slashDropdown.style.display !== 'block') {
        slashDropdown.style.display = 'block';
      }
      currentDropdownIndex = -1;
      loadUserSkillsForDropdown(false);
      if (!loadedJournalStyles) {
        loadJournalStylesForDropdown();
      }
      updateSlashDropdownFilter();
    }
    
    function hideSlashDropdown() {
      if (slashDropdown.style.display !== 'block' && slashStartPos === -1) return;
      slashDropdown.style.display = 'none';
      slashStartPos = -1;
      currentDropdownIndex = -1;
    }
    
    function loadJournalStylesForDropdown() {
      fetch('/api/journal-styles/list?userId=' + encodeURIComponent(currentUserId || 'web-user'))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.success && data.journals && data.journals.length > 0) {
            mainContextJournalStylesCache = Array.isArray(data.journals) ? data.journals : [];
            mainContextJournalStylesLoaded = true;
            var section = document.getElementById('journalStylesSection');
            section.style.display = 'block';
            
            data.journals.forEach(function(journal) {
              var sections = ['abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusion'];
              sections.forEach(function(sec) {
                var item = document.createElement('div');
                item.className = 'slash-item';
                item.setAttribute('data-slash', 'style:' + journal.id + ':' + sec);
                item.innerHTML = '<span class="mention-icon">' + uiIcon('newspaper') + '</span><span class="mention-name">/' + journal.name + '-' + sec + '</span><span class="mention-desc">' + sec + ' 风格</span>';
                section.appendChild(item);
              });
            });
            
            bindSlashItemClicks();
            loadedJournalStyles = true;
          }
        })
        .catch(function(e) {
          console.warn('Failed to load journal styles:', e);
        });
    }
    
    function bindSlashItemClicks() {
      document.querySelectorAll('.slash-item').forEach(function(item) {
        if (item.getAttribute('data-slash-bound') === '1') return;
        item.setAttribute('data-slash-bound', '1');
        item.addEventListener('click', function() {
          var slash = this.getAttribute('data-slash-insert') || this.getAttribute('data-slash');
          var value = userInput.value;
          
          if (slashStartPos !== -1) {
            var before = value.substring(0, slashStartPos);
            var after = value.substring(userInput.selectionStart);
            userInput.value = before + '/' + slash + ' ' + after;
            
            var newPos = slashStartPos + slash.length + 2;
            userInput.setSelectionRange(newPos, newPos);
          }
          
          hideSlashDropdown();
          userInput.focus();
        });
      });
    }
    
    bindSlashItemClicks();
    
    document.addEventListener('click', function(e) {
      if (!slashDropdown.contains(e.target) && e.target !== userInput) {
        hideSlashDropdown();
      }
      if (!mentionDropdown.contains(e.target) && e.target !== userInput) {
        hideMentionDropdown();
      }
    });
    
    var currentDropdownItems = [];
    var currentDropdownIndex = -1;
    
    function getActiveDropdown() {
      if (slashDropdown.style.display === 'block') return slashDropdown;
      if (mentionDropdown.style.display === 'block') return mentionDropdown;
      return null;
    }

    function getDropdownItems(activeDropdown) {
      var items = Array.prototype.slice.call(activeDropdown.querySelectorAll('.mention-item, .slash-item'));
      if (activeDropdown === slashDropdown) {
        return items.filter(function(item) {
          return item.style.display !== 'none';
        });
      }
      return items;
    }
    
    function updateDropdownHighlight() {
      var items = currentDropdownItems;
      items.forEach(function(item, i) {
        if (i === currentDropdownIndex) {
          item.classList.add('active');
          item.scrollIntoView({ block: 'nearest' });
        } else {
          item.classList.remove('active');
        }
      });
    }
    
    userInput.addEventListener('keydown', function(e) {
      // Enter is commonly used to confirm a Chinese IME candidate. It must not
      // trigger queue navigation or send until composition has fully ended.
      if (mainChatInputComposing || e.isComposing || e.keyCode === 229) return;
      var activeDropdown = getActiveDropdown();
      
      if (e.key === 'Escape') {
        hideMentionDropdown();
        hideSlashDropdown();
        return;
      }
      
      if (activeDropdown) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          currentDropdownItems = getDropdownItems(activeDropdown);
          if (currentDropdownItems.length === 0) return;
          if (currentDropdownIndex < currentDropdownItems.length - 1) {
            currentDropdownIndex++;
          } else {
            currentDropdownIndex = 0;
          }
          updateDropdownHighlight();
          return;
        }
        
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          currentDropdownItems = getDropdownItems(activeDropdown);
          if (currentDropdownItems.length === 0) return;
          if (currentDropdownIndex > 0) {
            currentDropdownIndex--;
          } else {
            currentDropdownIndex = currentDropdownItems.length - 1;
          }
          updateDropdownHighlight();
          return;
        }
        
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          currentDropdownItems = getDropdownItems(activeDropdown);
          if (currentDropdownItems.length > 0 && currentDropdownIndex >= 0) {
            currentDropdownItems[currentDropdownIndex].click();
          } else if (currentDropdownItems.length > 0) {
            currentDropdownItems[0].click();
          }
          return;
        }
      }
      
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(null, {
          piBehavior: isMainChatConversationRunning() && (e.ctrlKey || e.metaKey) ? 'steer' : undefined
        });
      }
    });
    
    function newChat(options) {
      var chatOptions = options && typeof options === 'object' ? options : {};
      if (typeof closeHomeUtilityPage === 'function') closeHomeUtilityPage({ skipReturn: true });
      clearRightSidebarFilePreviewState();
      // A new conversation always returns to the main chat surface. Child pages
      // must not remain above the newly created conversation.
      if (typeof prepareStandaloneWorkspaceSurface === 'function') {
        prepareStandaloneWorkspaceSurface('');
      }
      var oldConvId = currentConversationId;
      stopActiveMainChatForNavigation();
      if (oldConvId) persistConversationNow(oldConvId);
      mainChatQueryQueue = [];
      mainChatPiState = null;
      if (mainChatPiPollTimer) {
        clearTimeout(mainChatPiPollTimer);
        mainChatPiPollTimer = null;
      }
      if (mainChatQueueDrainTimer) {
        clearTimeout(mainChatQueueDrainTimer);
        mainChatQueueDrainTimer = null;
      }
      updateMainChatQueueButtonState();
      renderMainChatPiQueue(null);
      
      // 保存当前对话到历史记录
      if (oldConvId) {
        // 检查旧会话是否有消息
        var currentMsgs = localStorage.getItem(MSG_KEY + currentUserId + '_' + oldConvId);
        
        if (currentMsgs) {
          var messages = JSON.parse(currentMsgs);
          if (messages.length > 0) {
            var firstUserMsg = messages.find(function(m) { return m.role === 'user'; });
            var title = generateHistoryTitle(firstUserMsg ? firstUserMsg.content : '');
            
            var history = getHistory();
            var existingIndex = history.findIndex(function(h) { return h.id === oldConvId; });
            
            if (existingIndex >= 0) {
              history[existingIndex].title = title;
            } else {
              history.unshift({ id: oldConvId, title: title });
              if (firstUserMsg) {
                generateAITitle(oldConvId, firstUserMsg.content);
              }
            }
            saveHistory(history);
          }
        }
      }
      
      // 创建新的会话 ID
      currentConversationId = chatOptions.scope === 'bibliometrics'
        ? createBibliometricsConversationId()
        : createConversationId();
      activePdfPaperChatContext = null;
      pdfPaperChatReturnContext = null;
      mainMetaAnalysisReturnContext = loadMainMetaAnalysisReturnContext(currentConversationId);
      mainAnalysisWorkflowReturnContext = loadMainAnalysisWorkflowReturnContext(currentConversationId);
      if (userInput) userInput.placeholder = ' ';
      initializeWorkspaceDirectoryForConversation(currentConversationId, oldConvId);
      activateWorkspaceDirectoryConversation(currentConversationId);
      
      // 标记下一次发送需要完整提示词
      needsFullPrompt = true;
      
// 标记 ChatBridge 需要新建页面
window.chatBridgeNeedsNewPage = true;

// 同时通知 ChatBridge 在 NiceAIGC 页面创建新聊天
      syncNewChatToBridge();
      
      // 清空界面，但不清空 uploadedFiles（保持文献库）
      clearChatTurnScrollLock();
      resetMainChatPiQueueHost();
      messagesDiv.innerHTML = '';
      // 文献库摘要在后台加载，首页立即可用。
      emptyState.innerHTML = BRAND_TITLE_HTML + GREETING_HTML + HOME_WORKFLOW_SHORTCUTS_HTML;
      emptyState.style.display = 'flex';
      // 不清空 uploadedFiles，保持文献库跨会话共享
      renderFileList();
      // 加载文献库（会更新 emptyState 内容）
      loadLiteratureFromServer();
      renderMainContextSourceBar();
      renderPdfPaperChatReturnBar();
      renderMainMetaAnalysisReturnBar();
      renderMainAnalysisWorkflowReturnBar();
      syncMainSelectedAnalysisInputPlaceholder();
      renderHistory();
    }
    
    window.newChat = newChat;

    function cleanProjectImportAddress(value) {
      return String(value || '')
        .trim()
        .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
        .trim();
    }

    function isLikelySlashCommandNotProjectPath(value) {
      var cleaned = cleanProjectImportAddress(value);
      if (!cleaned.startsWith('/')) return false;
      if (/^\/(?:Users|home|mnt|Volumes|tmp|var|opt|workspace|media)\//i.test(cleaned)) {
        return false;
      }
      return true;
    }

    function extractProjectImportAddress(message) {
      var value = String(message || '').trim();
      if (!value) return '';
      var markerMatch = value.match(/(?:导入|读取|学习|记住|分析).{0,12}(?:项目|代码库|文件夹|目录).{0,12}(?:地址|路径)?\s*[:：]\s*([^\n]+)/i);
      if (markerMatch) {
        var explicitAddress = cleanProjectImportAddress(markerMatch[1]);
        return isLikelySlashCommandNotProjectPath(explicitAddress) ? '' : explicitAddress;
      }
      if (value.indexOf('\n') !== -1) return '';
      var cleaned = cleanProjectImportAddress(value);
      if (isLikelySlashCommandNotProjectPath(cleaned)) return '';
      if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/|file:\/\/)/.test(cleaned)) return cleaned;
      if (/^https?:\/\/(?:www\.)?github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?\/?$/i.test(cleaned)) return cleaned;
      if (/^https?:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\.git$/i.test(cleaned)) return cleaned;
      return '';
    }

    async function runProjectMemoryImport(address, originalMessage) {
      emptyState.style.display = 'none';
      setMainChatInputBusy(true);
      sendBtn.disabled = false;
      sendBtn.classList.add('sending');
      isGenerating = true;
      currentAbortController = new AbortController();
      activeMainChatProvider = null;
      updateMainChatQueueButtonState();

      if (!currentConversationId) ensureCurrentConversationId();
      var projectImportConversationId = currentConversationId;
      registerMainChatActiveRun(projectImportConversationId, currentAbortController);
      var savedMsgs = readConversationMessagesLocal(projectImportConversationId);

      var projectImportUserMessageEl = appendMessage(originalMessage || address, 'user', false);
      focusChatTurnOnUserMessage(projectImportUserMessageEl);
      savedMsgs.push({ role: 'user', content: originalMessage || address, isHtml: false, timestamp: Date.now() });
      storeConversationMessagesLocally(projectImportConversationId, savedMsgs);
      userInput.value = '';
      autoResize();

      var thinkingDiv = document.createElement('div');
      thinkingDiv.className = 'message bot thinking-message';
      thinkingDiv.innerHTML = '<div class="avatar bot">' + getMessageAvatarHtml('bot') + '</div><div class="content">正在读取项目文件并写入长期记忆...</div>';
      messagesDiv.appendChild(thinkingDiv);
      maybeScrollChatToBottom(true);

      try {
        var response = await fetch('/api/project-memory/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            address: address,
            apiUrl: apiConfig.url || '',
            apiKey: apiConfig.key || '',
            model: apiConfig.model || currentModel || ''
          }),
          signal: currentAbortController.signal
        });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '项目导入失败');
        }

        var providerLabel = result.provider === 'codex-cli' ? 'Codex CLI'
          : result.provider === 'secondary-api' ? 'Little corse API'
          : result.provider === 'primary-api' ? 'Grass OpenRouter API'
          : '本地降级索引';
        var markdown = '## 项目已导入长期记忆\n\n' +
          '- 项目：' + (result.projectName || '未命名项目') + '\n' +
          '- 地址：' + (result.address || address) + '\n' +
          '- 读取文件：' + (result.fileCount || 0) + ' / 支持文件 ' + (result.supportedFileCount || 0) + '\n' +
          '- 跳过项：' + (result.skippedCount || 0) + (result.truncatedCount ? '；截断文件：' + result.truncatedCount : '') + '\n' +
          '- 分析引擎：' + providerLabel + '\n' +
          '- 长期记忆键：' + (Array.isArray(result.memoryKeys) ? result.memoryKeys.join('、') : '') + '\n' +
          '- 完整记忆文件夹：`' + (result.artifactDir || '') + '`\n\n' +
          (result.summaryMarkdown || '');

        var thinkingMsgs = document.querySelectorAll('.thinking-message');
        thinkingMsgs.forEach(function(el) {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        });
        appendMessage(markdown, 'bot', false, true);
        savedMsgs.push({ role: 'assistant', content: markdown, isHtml: true, timestamp: Date.now() });
        storeConversationMessagesLocally(projectImportConversationId, savedMsgs);
        await persistConversationNow(projectImportConversationId);
      } catch (error) {
        var thinkingMsgsError = document.querySelectorAll('.thinking-message');
        thinkingMsgsError.forEach(function(el) {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        });
        if (error.name !== 'AbortError') {
          var projectImportErrorMessage = '项目导入失败：' + error.message;
          appendMessage(projectImportErrorMessage, 'bot', false, true);
          savedMsgs.push({ role: 'assistant', content: projectImportErrorMessage, isHtml: false, timestamp: Date.now() });
          storeConversationMessagesLocally(projectImportConversationId, savedMsgs);
        }
      }

      setMainChatInputBusy(false);
      sendBtn.disabled = false;
      sendBtn.classList.remove('sending', 'can-stop');
      isGenerating = false;
      currentAbortController = null;
      activeMainChatProvider = null;
      clearChatTurnScrollLock();
      renderHistory();
      scheduleMainChatQueueDrain();
    }
    
    async function sendMessage(queuedItem, sendOptions) {
      sendOptions = sendOptions || {};
      if (typeof ensureMainComposerIntegrity === 'function') {
        ensureMainComposerIntegrity();
      }
      recoverStaleMainChatFrontendRun('new homepage instruction');
      console.log('[SendMessage] ==== 开始 ====');
      console.log('[SendMessage] userInput.value:', userInput.value);
      console.log('[SendMessage] isGenerating:', isGenerating);
      console.log('[SendMessage] pendingExperimentFiles.length:', pendingExperimentFiles.length);
      
      // 🔧 关键：每次发送前重新加载配置，确保使用最新设置
      loadApiConfig();
      console.log('[SendMessage] 配置已加载:', {
        url: apiConfig.url || '(空)',
        hasKey: !!apiConfig.key,
        model: apiConfig.model || '(默认)'
      });

      var selectedWorkspaceFiles = queuedItem && Array.isArray(queuedItem.workspaceFileMentions)
        ? mergeWorkspaceFileMentions([], queuedItem.workspaceFileMentions)
        : getSelectedWorkspacePreviewFiles();
      var pendingChatAttachments = queuedItem && Array.isArray(queuedItem.chatAttachments) ? queuedItem.chatAttachments : [];
      pendingChatAttachments = mergeWorkspaceSelectedImageAttachments(pendingChatAttachments, selectedWorkspaceFiles);
      var message = queuedItem && queuedItem.message ? String(queuedItem.message).trim() : userInput.value.trim();
      if (!message && selectedWorkspaceFiles.length > 0) {
        message = '请读取我选择的工作目录文件，并根据文件内容回答。';
      }
      var rawUserInput = message;

      // Pi 扩展/控制命令不进入等待队列，运行中也立即打开本地界面。
      if (!queuedItem && message === '/connect') {
        userInput.value = '';
        showConnectDialog();
        return;
      }
      if (!queuedItem && message === '/model') {
        userInput.value = '';
        showModelDialog();
        return;
      }

      if (isGenerating && currentAbortController && mainChatExperimentUploadBusyOwner) {
        var uploadDraftWhileGenerating = userInput.value.trim();
        if (uploadDraftWhileGenerating) {
          await enqueueMainChatQuery(uploadDraftWhileGenerating, [], [], sendOptions.piBehavior);
          return;
        }
        currentAbortController.abort();
        appendMessage('已停止当前文件上传/分析任务。', 'bot', false, true);
        endMainChatExperimentBusy();
        return;
      }
      
      // 如果输入框上方只有截图/图片，且用户是在让 AI 看图做事，则走普通对话附件；
      // 明确的数据分析、R 作图、Figure 分组等需求仍走实验资料工作流。
      if (!queuedItem && pendingExperimentFiles.length > 0) {
        if (shouldRoutePendingFilesToChatAttachments(message)) {
          try {
            pendingChatAttachments = await uploadPendingFilesAsChatAttachments();
            if (!message) {
              message = getDefaultChatAttachmentMessage(pendingChatAttachments);
              rawUserInput = message;
            }
          } catch (error) {
            appendMessage('截图附件保存失败：' + (error.message || error), 'bot', false, true);
            return;
          }
        } else {
          await uploadAndAnalyzeExperimentResults();
          return;
        }
      }

      // 如果正在生成，有新输入则加入同一会话队列；空输入点击才停止当前生成。
      if (isMainChatConversationRunning() && currentAbortController) {
        var draftWhileGenerating = userInput.value.trim();
        if (message || pendingChatAttachments.length > 0 || selectedWorkspaceFiles.length > 0) {
          await enqueueMainChatQuery(
            draftWhileGenerating || message,
            pendingChatAttachments,
            selectedWorkspaceFiles,
            sendOptions.piBehavior
          );
          return;
        }
        var stoppedProvider = activeMainChatProvider || getComposerChatProvider();
        var pauseSynced = false;
        var backendStopSynced = false;
        var activeStopConversationId = activeMainChatConversationId || currentConversationId || ensureCurrentConversationId();
        var backendStopPromise = interruptMainChatAgent(activeStopConversationId);
        var controllerToStop = currentAbortController;
        controllerToStop.abort();
        try {
          var backendStopResult = await backendStopPromise;
          backendStopSynced = !!(
            backendStopResult
            && (backendStopResult.interrupted || (backendStopResult.state && !backendStopResult.state.running))
          );
          if (chatBridgeConfig.enabled && stoppedProvider === 'primary') {
            await pauseChatBridge();
            pauseSynced = true;
          }
        } catch (e) {
          console.warn('[ChatBridge] Backend stop sync failed:', e);
        }
        isGenerating = false;
        unregisterMainChatActiveRun(activeStopConversationId, controllerToStop);
        if (currentAbortController === controllerToStop) {
          currentAbortController = null;
        }
        activeMainChatConversationId = null;
        activeMainChatProjectId = null;
        activeMainChatProvider = null;
        mainChatPiState = Object.assign({}, mainChatPiState || {}, { running: false });
        sendBtn.classList.remove('sending', 'can-stop');
        setMainChatInputBusy(false);
        removeMainChatThinkingMessages();
        appendMessage(
          getMainChatStopMessage(stoppedProvider, pauseSynced)
            + (backendStopSynced ? '，后端任务已中断' : '，后端停止状态未确认'),
          'bot',
          false,
          true
        );
        stopChatStreamTail();
        clearChatTurnScrollLock();
        updateMainChatQueueButtonState();
        return;
      }

      // uploadedFiles is the conversation-independent literature library, not
      // a payload attached to this composer turn. Counting it here allowed an
      // empty click to create a fake "[已上传文献]" user bubble and send an
      // empty message to Pi. Only the current turn's text/attachments/files
      // are valid sendable input.
      if (!message && pendingChatAttachments.length === 0 && selectedWorkspaceFiles.length === 0) {
        return;
      }
      
      if (message === '/connect') {
        userInput.value = '';
        showConnectDialog();
        return;
      }
      
      if (message === '/model') {
        userInput.value = '';
        showModelDialog();
        return;
      }
      
      var skipFullPrompt = false;
      var slashContents = [];
      var slashLoadedNames = [];
      var explicitBibliometricsContext = null;
      var explicitMetaAnalysisContext = null;
      
      message = message.replace(/^\/\+?(标题|题目|摘要|summary|引言|绪论|introduction|intro|材料与方法|方法|methods|method|methodology|结果|results|result|讨论|discussion|结论|conclusions|conclusion)(?=\s|$)/i, function(match, chapter) {
        return '/skill:' + normalizeSkillChapterType(chapter);
      });
      
      var slashPattern = /^\/\+?(skill|style|context):([^\s，。,.!?！？;；:：]+)/gi;
      var slashMatch;
      while ((slashMatch = slashPattern.exec(message)) !== null) {
        var slashType = slashMatch[1];
        var slashData = slashMatch[2];
        skipFullPrompt = true;
        
        try {
          if (slashType === 'skill') {
            var normalizedSkill = normalizeSkillChapterType(slashData);
            var skillRes = await fetch('/api/skill/' + encodeURIComponent(normalizedSkill));
            var skillData = await skillRes.json();
            if (skillData.success) {
              slashContents.push({type: 'skill', name: normalizedSkill, content: skillData.content});
              slashLoadedNames.push(normalizedSkill);
            } else {
              appendMessage(' 未找到技能: ' + slashData, 'bot', false, true);
              userInput.value = '';
              await requeueMainChatPiMessage(queuedItem);
              return;
            }
          } else if (slashType === 'style') {
            var separatorIndex = slashData.lastIndexOf(':');
            if (separatorIndex > 0) {
              var journalId = slashData.substring(0, separatorIndex);
              var section = slashData.substring(separatorIndex + 1);
              var styleRes = await fetch('/api/journal-styles/' + encodeURIComponent(journalId) + '/' + encodeURIComponent(section) + '?userId=' + encodeURIComponent(currentUserId || 'web-user'));
              var styleData = await styleRes.json();
              if (styleData.success) {
                slashContents.push({type: 'style', name: styleData.journal + ' - ' + section, content: styleData.styleGuide});
                slashLoadedNames.push(styleData.journal + ' - ' + section);
              } else {
                appendMessage(' 未找到风格: ' + slashData, 'bot', false, true);
                userInput.value = '';
                await requeueMainChatPiMessage(queuedItem);
                return;
              }
            }
          } else if (slashType === 'context' && slashData.toLowerCase() === 'bibliometrics') {
            explicitBibliometricsContext = { deferredResource: true, source: 'slash-command' };
            slashLoadedNames.push('文献计量分析结果（Agent 按需读取）');
          } else if (slashType === 'context' && slashData.toLowerCase() === 'meta-analysis') {
            explicitMetaAnalysisContext = { deferredResource: true, source: 'slash-command' };
            slashLoadedNames.push('Meta 分析结果（Agent 按需读取）');
          }
        } catch (e) {
          appendMessage(' 加载失败: ' + e.message, 'bot', false, true);
          userInput.value = '';
          await requeueMainChatPiMessage(queuedItem);
          return;
        }
      }
      
      if (slashLoadedNames.length > 0) {
        var loadedNames = slashLoadedNames.join(', ');
        appendMessage(' 已加载: ' + loadedNames, 'bot', false, true);
        
        slashPattern.lastIndex = 0;
        message = message.replace(slashPattern, '').replace(/^[\s，。,.!?！？;；:：]+/, '').trim();
        
        if (slashContents.length > 0) {
          var fullContent = '';
          var labels = getProjectUiLabels();
          slashContents.forEach(s => {
            fullContent += `## ${s.type === 'skill' ? '写作技能' : labels.styleGroup}: ${s.name}\n\n${s.content}\n\n`;
          });
          
          message = fullContent + message;
        }

        if (explicitBibliometricsContext && !message) {
          message = '请基于当前文献计量分析结果，继续协助我进行文献计量学文章写作。';
        }
        if (explicitMetaAnalysisContext && !message) {
          message = '请基于当前 Meta 分析结果，继续协助我进行 Meta 分析论文结果、讨论或图表说明写作。';
        }
      }

      var projectImportAddress = extractProjectImportAddress(message);
      if (projectImportAddress && !queuedItem) {
        await runProjectMemoryImport(projectImportAddress, message);
        return;
      }

      // 普通聊天的工具意图统一交给正式 Agent。旧的 R 作图预路由会把
      // “从现有脚本抽取 Figure 代码并整理数据文件”误判成“重新生成 R 图”，
      // 并在 Agent 读取上下文前直接调用 /api/r-code/generate。专用页面按钮仍可
      // 显式调用对应 R 工作流，但输入框消息不得再被本地正则或二级分类器截走。

      emptyState.style.display = 'none';
      // A click on the send button can clear the textarea before Chromium
      // dispatches compositionend. Do not let that stale IME flag suspend the
      // response renderer for the whole turn.
      mainChatInputComposing = false;
      mainChatLastInputAt = 0;
      setMainChatInputBusy(true);
      sendBtn.disabled = false;
      sendBtn.classList.add('sending');
      isGenerating = true;
      currentAbortController = new AbortController();
      var requestAbortController = currentAbortController;
      mainChatPiState = Object.assign({}, mainChatPiState || {}, {
        running: true,
        pending: mainChatQueryQueue.slice(),
        pendingMessageCount: mainChatQueryQueue.length
      });
      updateMainChatQueueButtonState();

      var userMessageEl = queuedItem && queuedItem.userMessageEl
        ? queuedItem.userMessageEl
        : appendMessage(message || '[已上传' + getProjectEvidenceItemName() + ']', 'user', false);
      if (queuedItem && queuedItem.userMessageEl) {
        clearQueuedQueryStatus(queuedItem);
      }
      focusChatTurnOnUserMessage(userMessageEl);
      userInput.value = '';
      autoResize();

      // 不再调用 addTyping()，改为在下面添加流式思考占位。

      // 确保有 conversationId
      if (!currentConversationId) {
        ensureCurrentConversationId();
      }
      var activeConversationId = currentConversationId;
      var activeProjectId = getMainChatProjectId();
      activeMainChatConversationId = activeConversationId;
      activeMainChatProjectId = activeProjectId;
      registerMainChatActiveRun(activeConversationId, currentAbortController, activeProjectId);

      // 使用复合 key 读取消息
      var savedMsgs = readConversationMessagesLocal(activeConversationId);
      var historyMsgs = buildMainChatHistoryRequestPayload(savedMsgs);
      
      // 判断是否需要发送完整提示词
      // 使用 needsFullPrompt 标志（点击新建对话时设置为 true）
      var isFirstMessage = needsFullPrompt;
      console.log('[Debug] isFirstMessage calculation:', { needsFullPrompt: needsFullPrompt, savedMsgsLength: savedMsgs.length, isFirstMessage: isFirstMessage });
      
      // 发送后重置标志
      needsFullPrompt = false;
      
      // @ 仅用于选择工作目录文件；模型由输入框右侧的模型选择器决定。
      var workspaceFileMentions = mergeWorkspaceFileMentions(extractWorkspaceFileMentions(message), selectedWorkspaceFiles);
      var explicitProvider = getComposerChatProvider();
      var actualMessage = message;
      if (typeof window.flushComposerMainChatSelectionSave === 'function') {
        try {
          await window.flushComposerMainChatSelectionSave();
        } catch (modelSelectionError) {
          appendMessage(
            '❌ 模型选择尚未保存成功，本次消息未发送：' + (modelSelectionError && modelSelectionError.message ? modelSelectionError.message : String(modelSelectionError)),
            'bot', false, true
          );
          await requeueMainChatPiMessage(queuedItem);
          return;
        }
      }
      if (queuedItem && queuedItem.piQueueMessageId) {
        var queuedMessageIndex = savedMsgs.findIndex(function(savedMessage) {
          return savedMessage && savedMessage.piQueueId === queuedItem.piQueueMessageId;
        });
        var queuedMessageRecord = {
          role: 'user',
          content: actualMessage,
          isHtml: false,
          timestamp: queuedMessageIndex >= 0 ? savedMsgs[queuedMessageIndex].timestamp : Date.now(),
          piQueueId: queuedItem.piQueueMessageId,
          piBehavior: queuedItem.behavior || 'follow_up',
          piStatus: 'processing'
        };
        if (queuedMessageIndex >= 0) savedMsgs[queuedMessageIndex] = Object.assign({}, savedMsgs[queuedMessageIndex], queuedMessageRecord);
        else savedMsgs.push(queuedMessageRecord);
      }
      if (!(queuedItem && queuedItem.piQueueMessageId)) savedMsgs.push({ role: 'user', content: actualMessage, isHtml: false, timestamp: Date.now() });
      storeConversationMessagesLocally(activeConversationId, savedMsgs, { projectId: activeProjectId });
      console.log('[ComposerProvider] Selected provider:', explicitProvider, 'workspace files:', workspaceFileMentions.map(function(file) { return file.path; }));
      activeMainChatProvider = explicitProvider;
      
// 检查草原配置是否可用（内部仍为 primary）
      var isPrimaryAvailable = chatBridgeConfig.primary &&
                               chatBridgeConfig.primary.apiUrl &&
                               chatBridgeConfig.primary.apiUrl.trim() !== '' &&
                               chatBridgeConfig.primary.hasApiKey;
      
      // 检查小牛马配置是否可用（AI 桥接设置）
      var isSecondaryPoolAvailable = !!(chatBridgeConfig.secondary
        && chatBridgeConfig.secondary.pool
        && Array.isArray(chatBridgeConfig.secondary.pool.models)
        && chatBridgeConfig.secondary.pool.models.some(function(entry) {
          return entry && entry.enabled !== false && entry.api_url && entry.has_api_key;
        }));
      var isSecondaryAvailable = isSecondaryPoolAvailable || !!(chatBridgeConfig.secondary &&
                                 chatBridgeConfig.secondary.apiUrl &&
                                 chatBridgeConfig.secondary.apiUrl.trim() !== '' &&
                                 chatBridgeConfig.secondary.hasApiKey);
      
      // 检查前端 ⚙️ API 设置 是否可用（优先级最高）
      var isLegacyApiAvailable = !!(apiConfig.url && apiConfig.key);
      var isCodexCliPreferred = !!(chatBridgeConfig.codex && chatBridgeConfig.codex.enabled !== false && chatBridgeConfig.codex.prefer);
      
      // 综合判断：只要有任一配置可用，就允许发送
      // 优先级：前端 ⚙️ API 设置 > AI 桥接设置
      var isApiAvailable = isLegacyApiAvailable || isSecondaryAvailable || isPrimaryAvailable || isCodexCliPreferred;
      
      // 检查 ChatBridge 浏览器模式是否可用（已弃用，但保留向后兼容）
      var isChatBridgeAvailable = chatBridgeConfig.enabled && 
                                  chatBridgeConfig.chatUrl && 
                                  chatBridgeConfig.chatUrl.trim() !== '';
      
      console.log('[Provider] 配置检查:', {
        legacyApi: isLegacyApiAvailable ? '✅ 前端API设置可用' : '❌ 前端API设置未配置',
        secondary: isSecondaryAvailable ? '✅ Little corse 桥接可用' : '❌ Little corse 桥接未配置',
        primary: isPrimaryAvailable ? '✅ Grass OpenRouter 可用' : '❌ Grass OpenRouter 未配置',
        codex: isCodexCliPreferred ? '✅ Codex CLI 优先' : '未启用 Codex CLI 优先',
        apiConfigUrl: apiConfig.url || '(空)',
        chatBridgeEnabled: chatBridgeConfig.enabled
      });
      
      console.log('[Debug] Provider availability:', {
        primary: isPrimaryAvailable,
        secondary: isSecondaryAvailable,
        legacyApi: isLegacyApiAvailable,
        api: isApiAvailable,
        explicitProvider: explicitProvider,
        chatBridgeConfig: {
          enabled: chatBridgeConfig.enabled,
          primaryUrl: chatBridgeConfig.primary?.apiUrl || '',
          primaryModel: chatBridgeConfig.primary?.model || '',
          secondaryUrl: chatBridgeConfig.secondary?.apiUrl || '',
          secondaryModel: chatBridgeConfig.secondary?.model || ''
        }
      });
      
      // 决定使用哪个路由
      // 统一走 /api/chat-bridge/chat，通过 forceProvider 控制 Agent
      // Provider 只由输入框右侧选择器控制。
      
      // 判断是否应该使用 ChatBridge 路由
      // 现在统一走 ChatBridge 路由，只有在没有任何配置时才走旧的 /api/chat
      var useChatBridgeRoute = explicitProvider !== null ||  // 用户明确指定
                                isChatBridgeAvailable ||      // 有浏览器配置
                                isApiAvailable ||             // 有 API 配置
                                isCodexCliPreferred;          // 默认优先 Codex CLI
      
      console.log('[Provider] useChatBridgeRoute:', useChatBridgeRoute, {
        explicitProvider: explicitProvider,
        isChatBridgeAvailable: isChatBridgeAvailable,
        isApiAvailable: isApiAvailable
      });

      var flushedArticleDraftEdits = await flushPendingArticleChapterDraftEditsBeforeSend();
      if (flushedArticleDraftEdits.failed > 0) {
        alert('右侧文章草稿有未能保存的编辑内容。为避免 AI 读取旧草稿，本次发送已停止，请先保存成功后再发送。');
        await requeueMainChatPiMessage(queuedItem);
        return;
      }
      
      try {
        if (chatBridgeState.paused) {
          await resumeChatBridge();
        }
        
          // 根据输入框右侧模型选择器决定 provider
        if (useChatBridgeRoute) {
          // 启动阶段只展示统一的黑色运行头；首条真实输出到达后再展开正文。
          var thinkingDiv = document.createElement('div');
          thinkingDiv.className = 'message bot thinking-message';
          thinkingDiv.innerHTML = '<div class="avatar bot">' + getMessageAvatarHtml('bot') + '</div><div class="content" aria-hidden="true"></div>';
          messagesDiv.appendChild(thinkingDiv);
          startMainChatPreflightHeader(thinkingDiv);
          attachMainChatPiQueuePanelToMessage(thinkingDiv);
          startChatStreamTail();
          maybeScrollChatToBottom(true);

          setMainChatPreflightStatus(thinkingDiv, '正在准备分析工作目录…');
          var baseWorkspaceDirectory = getWorkspaceDirectoryPayloadForMessage(
            rawUserInput || actualMessage,
            activeConversationId
          );
          var preparedAnalysisWorkspaceDirectories = await prepareSelectedAnalysisWorkspaceFolders(
            baseWorkspaceDirectory,
            explicitBibliometricsContext,
            explicitMetaAnalysisContext
          );
          var activeWorkspaceDirectory = scopeWorkspaceDirectoryForSelectedAnalysis(
            baseWorkspaceDirectory,
            explicitBibliometricsContext,
            explicitMetaAnalysisContext
          );
          activeMainChatWorkspaceSnapshot = activeWorkspaceDirectory
            ? Object.assign({}, activeWorkspaceDirectory)
            : null;
          var chatDelivery = queuedItem && queuedItem.behavior !== 'steer' ? 'queue' : 'steer';
          
          // 准备 ChatBridge 所需的完整上下文（和 API Flow 一样的内容）
          setMainChatPreflightStatus(thinkingDiv, '正在整理 Skill、记忆与文献上下文…');
          var chatBridgeContext = await prepareChatBridgeContext(
            actualMessage,
            isFirstMessage && !skipFullPrompt,
            explicitBibliometricsContext,
            explicitMetaAnalysisContext,
            function(progressMessage) {
              setMainChatPreflightStatus(thinkingDiv, progressMessage);
            },
            {
              rawMessage: rawUserInput || actualMessage,
              history: historyMsgs,
              workspaceDirectory: activeWorkspaceDirectory,
              workspaceFileMentions: workspaceFileMentions,
              chatAttachments: pendingChatAttachments,
              slashNames: slashLoadedNames,
              contextItems: [
                {
                  type: 'selected_context_sources',
                  selections: loadMainContextSourceSelection()
                },
                {
                  type: 'selected_skills',
                  tokens: loadMainContextSkillSelection()
                }
              ].concat((function() {
                var latestAssistant = historyMsgs.slice().reverse().find(function(item) {
                  return item && item.role === 'assistant' && String(item.content || '').trim();
                });
                return latestAssistant ? [{
                  type: 'latest_assistant_result',
                  content: String(latestAssistant.content || '').slice(0, 8000)
                }] : [];
              })()).concat(activePdfPaperChatContext ? [{
                type: 'active_pdf',
                pdfId: activePdfPaperChatContext.pdfId || activePdfPaperChatContext.id || '',
                title: activePdfPaperChatContext.title || activePdfPaperChatContext.originalName || ''
              }] : []),
              provider: explicitProvider || undefined,
              abortSignal: requestAbortController.signal
            }
          );
          if (requestAbortController.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          chatBridgeContext.workspaceFileMentions = workspaceFileMentions;
          chatBridgeContext.analysisWorkspaceDirectories = preparedAnalysisWorkspaceDirectories;
          chatBridgeContext.analysisWorkspaceRule = Object.keys(preparedAnalysisWorkspaceDirectories).length > 0
            ? '分析结果、脚本、图片和中间数据必须写入对应的分析工作目录，不得散落到会话根目录。'
            : '';
          if (pendingChatAttachments.length > 0) {
            chatBridgeContext.chatAttachments = pendingChatAttachments;
          }
          setMainChatPreflightStatus(thinkingDiv, '正在附加论文框架与章节上下文…');
          await attachSelectedArticleChaptersToChatContext(chatBridgeContext);
          
          console.log('[Debug] Context to send:', {
            isFirstMessage: isFirstMessage,
            skipFullPrompt: skipFullPrompt,
            finalIsFirstMessage: isFirstMessage && !skipFullPrompt,
            contextIsFirstMessage: chatBridgeContext.isFirstMessage
          });
          
          // 判断是否需要新建页面（只有浏览器模式需要）
          var wasNewChat = window.chatBridgeNeedsNewPage === true;
          var needsNewPage = (explicitProvider === 'browser' || (explicitProvider === null && isChatBridgeAvailable)) && wasNewChat;
          window.chatBridgeNeedsNewPage = false;
          console.log('[ChatBridge] needsNewPage:', needsNewPage, '{ savedMsgsLength:', savedMsgs.length, ', wasNewChat:', wasNewChat, '}');
          
          // 调试：打印上下文内容
          console.log('[Debug] Context prepared:', {
            hasMemory: !!chatBridgeContext.memory,
            memoryKeys: chatBridgeContext.memory ? Object.keys(chatBridgeContext.memory) : [],
            writingProgress: chatBridgeContext.memory?.writingProgress,
            completedChapters: chatBridgeContext.memory?.completedChapters,
            hasLiterature: !!chatBridgeContext.literature,
            literatureCount: chatBridgeContext.literature?.count,
            hasJournalStyle: !!chatBridgeContext.journalStyle,
            hasWritingSkill: !!chatBridgeContext.writingSkill,
            hasBibliometrics: !!chatBridgeContext.bibliometrics,
            bibliometricsExplicit: !!chatBridgeContext.bibliometricsExplicit,
            bibliometricsPinned: !!chatBridgeContext.bibliometricsPinned,
            hasMetaAnalysis: !!chatBridgeContext.metaAnalysis,
            metaAnalysisExplicit: !!chatBridgeContext.metaAnalysisExplicit,
            metaAnalysisPinned: !!chatBridgeContext.metaAnalysisPinned,
            hasAutoResearch: !!chatBridgeContext.autoResearch,
            autoResearchPinned: !!chatBridgeContext.autoResearchPinned,
            hasUserSkillPrompt: !!chatBridgeContext.userSkillPrompt,
            invokedUserSkills: chatBridgeContext.invokedUserSkills?.map(function(skill) { return skill.trigger || skill.name || skill.token; }),
            queryPrimaryIntent: chatBridgeContext.queryIntent?.primaryIntent,
            queryNeedsWorkspaceSearch: !!chatBridgeContext.queryIntent?.needsWorkspaceSearch,
            queryNeedsLiteratureRetrieval: !!chatBridgeContext.queryIntent?.needsLiteratureRetrieval,
            contextSourceStatus: chatBridgeContext.contextSourceStatus,
            articleChapterQuestionCount: chatBridgeContext.articleChapterQuestionContext?.count || 0,
            hasRPlot: !!chatBridgeContext.rPlot
          });
          
          console.log('[ChatBridge] Sending request:', { messageLength: actualMessage.length, messagePreview: actualMessage.substring(0, 100), forceProvider: explicitProvider });
          
          // 构建请求体
          chatBridgeContext.piSession = {
            enabled: true,
            architecture: 'pi',
            sessionId: activeConversationId,
            delivery: chatDelivery === 'queue' ? 'follow_up' : 'steer',
            steeringMode: 'one-at-a-time',
            followUpMode: 'one-at-a-time',
            refreshDiscussionWritingStateEachTurn: true
          };
          var chatBridgeRequestBody = {
            message: actualMessage,
            userId: currentUserId,
            projectId: activeProjectId || undefined,
            conversationId: activeConversationId,
            context: chatBridgeContext,
            history: historyMsgs,  // 切换 Codex / 小牛马 / 草原时传递最近 20 条上下文
            stream: true,
            newPage: needsNewPage,
            frontendState: buildFrontendPageStateSnapshot(actualMessage, explicitProvider || 'auto', chatDelivery),
            queryEnvelope: buildChatQueryEnvelope(
              rawUserInput,
              actualMessage,
              explicitProvider || 'auto',
              workspaceFileMentions,
              slashLoadedNames,
              chatBridgeContext,
              activeWorkspaceDirectory,
              chatDelivery
            )
          };
          if (activeWorkspaceDirectory) {
            chatBridgeRequestBody.workspaceDirectory = activeWorkspaceDirectory;
          }
          if (queuedItem && queuedItem.piQueueMessageId) {
            chatBridgeRequestBody.piQueueMessageId = queuedItem.piQueueMessageId;
            chatBridgeRequestBody.piQueueOriginalMessage = queuedItem.message;
          }
          var chatAttachmentImagePaths = pendingChatAttachments
            .filter(function(file) {
              return file && (file.type === 'image' || isVisionFileName(file.name || file.path || ''));
            })
            .map(function(file) { return file.path || ''; })
            .filter(Boolean);
          if (pendingChatAttachments.length > 0) {
            chatBridgeRequestBody.chatAttachments = pendingChatAttachments;
            if (chatAttachmentImagePaths.length > 0) {
              chatBridgeRequestBody.codexImages = chatAttachmentImagePaths;
              chatBridgeRequestBody.visionImages = chatAttachmentImagePaths;
            }
          }
          var requiresVisionForChat = hasVisionInputForMainChat() || hasChatAttachmentVision(pendingChatAttachments);
          var composerPoolSelection = typeof window.getComposerActivePoolSelection === 'function'
            ? window.getComposerActivePoolSelection(explicitProvider, requiresVisionForChat)
            : null;
          if (requiresVisionForChat) {
            loadSecondaryVisionApiConfig();
            chatBridgeRequestBody.requiresVision = true;
            var hasBridgeVisionPool = !!(chatBridgeConfig.secondaryVision
              && chatBridgeConfig.secondaryVision.pool
              && Array.isArray(chatBridgeConfig.secondaryVision.pool.models)
              && chatBridgeConfig.secondaryVision.pool.models.some(function(entry) {
                return entry && entry.enabled !== false && entry.api_url && entry.has_api_key;
              }));
            var hasBridgeVisionConfig = hasBridgeVisionPool || !!(chatBridgeConfig.secondaryVision
              && chatBridgeConfig.secondaryVision.apiUrl
              && chatBridgeConfig.secondaryVision.hasApiKey);
            if (!hasBridgeVisionConfig && secondaryVisionApiConfig.url && secondaryVisionApiConfig.key) {
              chatBridgeRequestBody.visionApiUrl = secondaryVisionApiConfig.url;
              chatBridgeRequestBody.visionApiKey = secondaryVisionApiConfig.key;
              chatBridgeRequestBody.visionModel = secondaryVisionApiConfig.model || 'gpt-4o';
            }
          }
          
          // 传递 forceProvider 参数
          // - 'primary': 使用草原配置
          // - 'codex': 使用本机 Codex CLI
          // - 'secondary': 使用小牛马配置
          // - 'api': 使用前端 ⚙️ API 设置（向后兼容）
          // - undefined: 自动选择（优先 secondary）
          if (explicitProvider) {
            chatBridgeRequestBody.forceProvider = explicitProvider;
            console.log('[ChatBridge] forceProvider:', explicitProvider);

            if (explicitProvider === 'codex' || explicitProvider === 'pi' || explicitProvider === 'opencode') {
              var runtimeSelection = typeof window.getComposerCodingRuntimeSelection === 'function'
                ? window.getComposerCodingRuntimeSelection(explicitProvider)
                : null;
              chatBridgeRequestBody.agentRuntime = explicitProvider;
              if (runtimeSelection && runtimeSelection.model) chatBridgeRequestBody.agentRuntimeModel = runtimeSelection.model;
              if (runtimeSelection && runtimeSelection.reasoningEffort) chatBridgeRequestBody.agentRuntimeReasoningEffort = runtimeSelection.reasoningEffort;
              if (runtimeSelection && runtimeSelection.timeoutMs) chatBridgeRequestBody.agentRuntimeTimeoutMs = runtimeSelection.timeoutMs;
              if (explicitProvider === 'codex') {
                var composerCodexSelection = getComposerCodexSelection();
                chatBridgeRequestBody.codexModel = composerCodexSelection.model;
                chatBridgeRequestBody.codexReasoningEffort = composerCodexSelection.reasoningEffort;
                flushComposerCodexSelectionSave().catch(function(error) {
                  console.warn('[ComposerProvider] Codex selection persistence failed:', error);
                });
              }
              console.log('[ChatBridge] Coding Agent runtime selection:', runtimeSelection);
            }
            
            if (composerPoolSelection && composerPoolSelection.id) {
              chatBridgeRequestBody.modelId = composerPoolSelection.id;
            }

            // 小牛马模式：模型池/桥接配置是权威来源；仅在没有桥接配置时
            // 才透传旧版前端 API 设置，避免旧 URL/模型覆盖输入框当前选择。
            if (explicitProvider === 'secondary' || explicitProvider === 'api' || explicitProvider === 'codex') {
              var activeSecondaryTextSelection = typeof window.getComposerActivePoolSelection === 'function'
                ? window.getComposerActivePoolSelection('secondary', false)
                : null;
              var hasBridgeSecondaryConfig = !!(activeSecondaryTextSelection
                || (chatBridgeConfig.secondary?.apiUrl && chatBridgeConfig.secondary.hasApiKey));
              if (activeSecondaryTextSelection && activeSecondaryTextSelection.model) {
                chatBridgeRequestBody.secondaryModel = activeSecondaryTextSelection.model;
              } else if (chatBridgeConfig.secondary?.model) {
                chatBridgeRequestBody.secondaryModel = chatBridgeConfig.secondary.model;
              }
              if (!hasBridgeSecondaryConfig && apiConfig.url && apiConfig.key) {
                chatBridgeRequestBody.apiUrl = apiConfig.url;
                chatBridgeRequestBody.apiKey = apiConfig.key;
                chatBridgeRequestBody.model = apiConfig.model || 'qwen3.5-plus';
                chatBridgeRequestBody.secondaryModel = apiConfig.model || 'qwen3.5-plus';
                console.log('[ChatBridge] 小牛马使用旧版前端 API 兜底:', apiConfig.url, 'model:', apiConfig.model);
              } else {
                console.log('[ChatBridge] 小牛马使用模型池/AI 桥接配置:', composerPoolSelection || activeSecondaryTextSelection || chatBridgeConfig.secondary?.model);
              }
            }
            
            // 草原模式
            if (explicitProvider === 'primary') {
              console.log('[ChatBridge] 草原使用 OpenRouter 模型池配置:', composerPoolSelection || chatBridgeConfig.primary?.model);
            }
          } else {
            // 无明确指定时，传递前端 API 配置作为默认
            if (apiConfig.url && apiConfig.key) {
              chatBridgeRequestBody.apiUrl = apiConfig.url;
              chatBridgeRequestBody.apiKey = apiConfig.key;
              chatBridgeRequestBody.model = apiConfig.model || 'qwen3.5-plus';
              chatBridgeRequestBody.secondaryModel = apiConfig.model || 'qwen3.5-plus';
              console.log('[ChatBridge] 默认使用前端 API 配置:', apiConfig.url);
            }
          }

          // 透传设置页的 reasoning_effort（low/medium/high），后端用它控制模型推理强度。
          if (currentReasoningEffort) {
            chatBridgeRequestBody.reasoningEffort = currentReasoningEffort;
          }

          // 两阶段多模态编排：视觉 AI 先输出结构化意图，主聊天再结合
          // 原始 query、视觉发现和工作目录执行后续动作。分类失败时保留
          // 原来的直接多模态路线，不阻断用户请求。
          if (pendingChatAttachments.length > 0) {
            setMainChatPreflightStatus(thinkingDiv, '正在分析附件并确定执行方式…');
          }
          var multimodalIntent = await classifyMultimodalAttachmentIntent(chatBridgeRequestBody);
          if (multimodalIntent) {
            chatBridgeContext.multimodalIntent = multimodalIntent;
            chatBridgeRequestBody.context = chatBridgeContext;
          }
          
          setMainChatPreflightStatus(thinkingDiv, explicitProvider === 'pi' ? '正在连接 Pi Agent…' : '正在连接 Agent…');
          var chatBridgeResponse = await fetch('/api/chat-bridge/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chatBridgeRequestBody),
            signal: requestAbortController.signal
          });
          if (chatBridgeResponse.ok && !queuedItem && selectedWorkspaceFiles.length > 0) {
            clearWorkspacePreviewSelections();
          }
          
          // 检查响应状态
          if (!chatBridgeResponse.ok) {
            await requeueMainChatPiMessage(queuedItem);
            // 移除"正在思考"消息
            var thinkingMsgsError = document.querySelectorAll('.thinking-message');
            thinkingMsgsError.forEach(function(el) {
              if (el && el.parentNode) {
                el.parentNode.removeChild(el);
              }
            });
            
            // 尝试解析错误信息
            var errorText = '';
            try {
              var errorData = await chatBridgeResponse.json();
              errorText = errorData.error || errorData.message || '请求失败';
            } catch (e) {
              errorText = 'HTTP ' + chatBridgeResponse.status + ': ' + chatBridgeResponse.statusText;
            }
            
            var httpErrorProvider = normalizeComposerChatProvider(explicitProvider || 'secondary');
            var httpFailure = getComposerFailureDisplay(httpErrorProvider, errorText, '请求失败: ');
            appendMessage('❌ ' + httpFailure.message + '\n\n状态码: ' + chatBridgeResponse.status + httpFailure.hint, 'bot', false, true);
            console.error('[ChatBridge] Request failed:', chatBridgeResponse.status, errorText);
            
            finishMainChatRequest(requestAbortController);
            return;
          }
          
          if (!chatBridgeResponse.body || !chatBridgeResponse.body.getReader) {
            throw new Error('当前环境不支持流式读取响应');
          }

          var reader = chatBridgeResponse.body.getReader();
          var decoder = new TextDecoder();
          var fullResponse = '';
          var thinkingText = '';
          var messageDiv = thinkingDiv || null;
          var streamRenderer = null;
          var sseBuffer = '';
          var lastChunkTime = Date.now();
          var streamStartedAt = Date.now();
          var timeoutWarningShown = false;
          var streamUsage = null;
          var streamElapsedMs = null;

          function ensureStreamingBotMessage() {
            if (!messageDiv) {
              messageDiv = document.createElement('div');
              messageDiv.className = 'message bot';
              messageDiv.innerHTML = '<div class="avatar bot">' + getMessageAvatarHtml('bot') + '</div><div class="content"></div>';
              messagesDiv.appendChild(messageDiv);
              attachMainChatPiQueuePanelToMessage(messageDiv);
            } else if (messageDiv.classList.contains('thinking-message')) {
              stopMainChatPreflightHeader(messageDiv);
              messageDiv.classList.remove('thinking-message');
              var initialContent = messageDiv.querySelector('.content');
              if (initialContent) {
                initialContent.removeAttribute('aria-hidden');
                initialContent.innerHTML = '';
              }
            }
            if (messageDiv && mainChatPiQueueHostMessage !== messageDiv) {
              attachMainChatPiQueuePanelToMessage(messageDiv);
            }
            if (messageDiv && messageDiv.dataset) {
              messageDiv.dataset.piResponseStarted = 'true';
              renderMainChatPiQueue(mainChatPiState);
            }
            if (!streamRenderer) {
              streamRenderer = createBotTextStreamer(messageDiv);
            }
            return streamRenderer;
          }

          function handleChatBridgeEvent(data) {
            if (!data || !data.type) return;
            if (data.type === 'chunk') {
              lastChunkTime = Date.now();
              fullResponse += data.content || '';
              ensureStreamingBotMessage().setText(fullResponse);
            } else if (data.type === 'thinking') {
              lastChunkTime = Date.now();
              thinkingText += data.content || '';
              if (!fullResponse) {
                // 流式展示推理内容（只保留尾部，避免超长思考刷屏）；正文开始后会被答案替换。
                ensureStreamingBotMessage().setText('💭 思考中…\n\n' + thinkingText.slice(-3000));
              }
            } else if (data.type === 'status') {
              lastChunkTime = Date.now();
              var runtimeStatus = formatMainChatRuntimeStatus(data.message || data.status || data.stage);
              if (runtimeStatus && messageDiv) {
                setMainChatPreflightStatus(messageDiv, runtimeStatus);
              }
              if (streamRenderer && typeof streamRenderer.setElapsedMs === 'function' && data.elapsedMs) {
                streamRenderer.setElapsedMs(data.elapsedMs);
              }
            } else if (data.type === 'complete' || data.type === 'done' || data.type === 'end') {
              var reportedElapsedMs = Number(data.elapsedMs || 0);
              streamElapsedMs = Number.isFinite(reportedElapsedMs) && reportedElapsedMs > 0
                ? reportedElapsedMs
                : Date.now() - streamStartedAt;
              if (data.usage) {
                streamUsage = data.usage;
                var activeRenderer = ensureStreamingBotMessage();
                if (activeRenderer && typeof activeRenderer.setUsage === 'function') {
                  activeRenderer.setUsage(streamUsage);
                }
              }
              if (typeof data.content === 'string' && data.content.length > 0) {
                fullResponse = data.content;
              }
              fullResponse = executeFrontendUiActionsFromAiResponse(fullResponse);
              if (fullResponse) {
                ensureStreamingBotMessage().setText(fullResponse);
              }
              if (fullResponse && !savedMsgs.find(function(m) { return m.content === fullResponse; })) {
                savedMsgs.push({
                  role: 'assistant',
                  content: fullResponse,
                  isHtml: false,
                  timestamp: Date.now(),
                  usage: streamUsage,
                  elapsedMs: streamElapsedMs
                });
                mergeConcurrentPiQueueRecords(activeConversationId, savedMsgs);
                storeConversationMessagesLocally(activeConversationId, savedMsgs, { projectId: activeProjectId });
              }
            } else if (data.type === 'error') {
              ensureStreamingBotMessage();
              // 移除其他残留的"正在思考"消息
              var thinkingMsgsError = document.querySelectorAll('.thinking-message');
              thinkingMsgsError.forEach(function(el) {
                if (el && el !== messageDiv && el.parentNode) {
                  el.parentNode.removeChild(el);
                }
              });

              var streamErrorProvider = normalizeComposerChatProvider(explicitProvider || 'secondary');
              var streamFailure = getComposerFailureDisplay(streamErrorProvider, data.error || '未知错误', '连接失败: ');
              fullResponse = streamFailure.message + streamFailure.hint;
              ensureStreamingBotMessage().setText(fullResponse);
              console.error('[ChatBridge] Error:', data.error);
            }
          }

          function processSseBuffer(flush) {
            var events = sseBuffer.split(/\r?\n\r?\n/);
            sseBuffer = flush ? '' : (events.pop() || '');
            events.forEach(function(eventText) {
              var payload = eventText
                .split(/\r?\n/)
                .filter(function(line) { return line.indexOf('data:') === 0; })
                .map(function(line) { return line.replace(/^data:\s?/, ''); })
                .join('\n')
                .trim();
              if (!payload || payload === '[DONE]') return;
              try {
                handleChatBridgeEvent(JSON.parse(payload));
              } catch (e) {
                console.warn('[ChatBridge] Failed to parse stream event:', e);
              }
            });
            if (flush && sseBuffer.trim()) {
              try {
                handleChatBridgeEvent(JSON.parse(sseBuffer.replace(/^data:\s?/, '').trim()));
              } catch (e) {}
            }
          }
          
          while (true) {
            var result = await reader.read();
            if (result.done) break;

            sseBuffer += decoder.decode(result.value, { stream: true });
            processSseBuffer(false);
            
            // 检测是否卡住（30秒没有新内容）
            if (Date.now() - lastChunkTime > 30000 && !timeoutWarningShown && fullResponse.length > 0) {
              timeoutWarningShown = true;
              console.warn('[ChatBridge] No response for 30s, but have partial content:', fullResponse.length, 'chars');
            }
          }
          sseBuffer += decoder.decode();
          processSseBuffer(true);
          fullResponse = executeFrontendUiActionsFromAiResponse(fullResponse);
          
          // 如果卡住了但有部分内容，保存它
          if (fullResponse && fullResponse.length > 0 && !fullResponse.startsWith('❌')) {
            if (!savedMsgs.find(function(m) { return m.content === fullResponse; })) {
              savedMsgs.push({
                role: 'assistant',
                content: fullResponse,
                isHtml: false,
                timestamp: Date.now(),
                usage: streamUsage,
                elapsedMs: streamElapsedMs || (Date.now() - streamStartedAt)
              });
              mergeConcurrentPiQueueRecords(activeConversationId, savedMsgs);
              storeConversationMessagesLocally(activeConversationId, savedMsgs, { projectId: activeProjectId });
            }
          }
          
          if (messageDiv) {
            if (streamRenderer && fullResponse) {
              await streamRenderer.finish(fullResponse, streamElapsedMs || (Date.now() - streamStartedAt), streamUsage);
            }
            var contentDiv = messageDiv.querySelector('.content');
            var useAgentTranscript = isAgentTranscriptText(fullResponse);
            contentDiv.classList.toggle('agent-transcript-content', useAgentTranscript);
            if (!streamRenderer) {
              contentDiv.innerHTML = renderBotMessageContent(fullResponse, {
                allowAgentTranscript: true,
                final: true,
                elapsedMs: streamElapsedMs || (Date.now() - streamStartedAt),
                usage: streamUsage
              });
            }
            initWorkspaceImageStacks(contentDiv);
            syncMessageLocalFileVisibilityClass(messageDiv);
            // 添加功能按钮
            contentDiv.insertAdjacentHTML('beforeend', renderMessageFooter(true));
          } else if (fullResponse) {
            // 移除"正在思考"消息
            var thinkingMsgsFallback = document.querySelectorAll('.thinking-message');
            thinkingMsgsFallback.forEach(function(el) {
              if (el && el.parentNode) {
                el.parentNode.removeChild(el);
              }
            });
            appendMessage(fullResponse, 'bot', false, false, {
              usage: streamUsage,
              elapsedMs: streamElapsedMs || (Date.now() - streamStartedAt)
            });
          }
          
          // 确保"正在思考"消息被移除
          var thinkingMsgs = document.querySelectorAll('.thinking-message');
          thinkingMsgs.forEach(function(el) {
            if (el && el.parentNode) {
              el.parentNode.removeChild(el);
            }
          });
          
          // ChatBridge 后端会在 postProcessResponse 中更新长期记忆。
          // 这里不再二次调用 /api/memory/update，避免同一轮对话重复提取和并发写入。
          
          // 持久化对话消息到服务端（确保跨会话可恢复）
          await persistConversationNow(activeConversationId, {
            projectId: activeProjectId,
            messages: savedMsgs
          });

          refreshArticleDraftProgressAfterAiResponse(fullResponse);

          // Do not scan a completed assistant response and turn it into a new R task.
          // The formal Agent/tool loop already decides and executes R tools during the
          // current turn. Re-processing its final answer here caused completed plots
          // (and tool transcripts containing R code) to be executed a second time.
          // Explicit legacy R workflows still enter through runRecentRPlotFollowup()
          // and the analysis workspace actions.
          
          // 文献检索已在本轮正式请求前自主完成并作为证据上下文发送，
          // 这里不再对 AI 输出做二次检测，避免回答后重复弹窗或重复检索。
          
          if (finishMainChatRequest(requestAbortController)) {
            renderHistory();
          }
          return;
        }
        
        // 没有任何配置，显示错误提示
        var thinkingMsgs = document.querySelectorAll('.thinking-message');
        thinkingMsgs.forEach(function(el) {
          if (el && el.parentNode) {
            el.parentNode.removeChild(el);
          }
        });
        
        appendMessage('❌ 未配置 AI 服务\n\n请先在配置界面设置 Little corse、Grass OpenRouter 或 Codex CLI，再通过输入框右侧的模型选择器选择服务。', 'bot', false, true);
        await requeueMainChatPiMessage(queuedItem);
        
        finishMainChatRequest(requestAbortController);
        
        uploadedFiles = [];
        renderFileList();
      } catch (error) {
        if (!error || error.name !== 'AbortError') {
          await requeueMainChatPiMessage(queuedItem);
        }
        // 处理用户主动中断
        if (error && error.name === 'AbortError') {
          console.log('[Chat] User aborted');
          if (typeof thinkingDiv !== 'undefined' && thinkingDiv) {
            stopMainChatPreflightHeader(thinkingDiv);
            if (thinkingDiv.parentNode) thinkingDiv.parentNode.removeChild(thinkingDiv);
          }
          return;
        } else {
          // 移除"正在思考"消息
          var failedPreflightStatus = typeof thinkingDiv !== 'undefined' && thinkingDiv && thinkingDiv.dataset
            ? String(thinkingDiv.dataset.piStatus || '')
            : '';
          var thinkingMsgsCatch = document.querySelectorAll('.thinking-message');
          thinkingMsgsCatch.forEach(function(el) {
            if (el && el.parentNode) {
              el.parentNode.removeChild(el);
            }
          });
          var unexpectedFailure = getComposerFailureDisplay(
            normalizeComposerChatProvider(explicitProvider || 'secondary'),
            error && error.message || String(error || '未知错误'),
            '连接失败: '
          );
          var failureStage = failedPreflightStatus
            ? '\n\n中断阶段：' + failedPreflightStatus
            : '';
          appendMessage('❌ ' + unexpectedFailure.message + failureStage + unexpectedFailure.hint, 'bot', false, true);
        }
      }

      if (finishMainChatRequest(requestAbortController)) {
        renderHistory();
      }
    }
    window.sendMessage = sendMessage;

    // ============ 自动检索功能 ============

    var currentRetrievalData = null;

    function isRetrievalEvidenceMessage(message) {
      var value = String(message || '');
      return value.includes('🔍 文献检索结果')
        || value.includes('检索论点')
        || value.includes('文献检索结果（自动检索）')
        || value.includes('AI 自主检索结果');
    }

    function getAutonomousRetrievalLibrarySources(detection) {
      var sources = [];
      var libraries = detection && detection.libraries ? detection.libraries : {};
      if ((libraries.abstract && libraries.abstract.available) || Number(detection && detection.literatureCount || 0) > 0) {
        sources.push('abstract');
      }
      if ((libraries.pdfWiki && libraries.pdfWiki.available) || Number(detection && detection.pdfWikiCount || 0) > 0) {
        sources.push('pdfWiki');
      }
      return sources;
    }

    function isCitationRequiredWritingTurn(message, recentHistory, queryIntent) {
      return !!(queryIntent
        && queryIntent.primaryIntent === 'academic_writing'
        && queryIntent.needsLiteratureRetrieval === true
        && (!queryIntent.literatureEvidenceMode || queryIntent.literatureEvidenceMode === 'search_new'));
    }

    async function classifyMainChatQueryIntent(message, routingInput, onProgress) {
      routingInput = routingInput || {};
      var normalizedMessage = String(message || '').trim();
      if (!normalizedMessage) return null;
      var parentAbortSignal = routingInput.abortSignal
        || (currentAbortController ? currentAbortController.signal : null);
      var intentAbortController = new AbortController();
      var intentTimedOut = false;
      // The backend falls back after 20 seconds. Keep the browser deadline a
      // little longer so it can receive that fallback response normally.
      var intentTimeoutMs = 23000;
      var forwardParentAbort = function() {
        intentAbortController.abort();
      };
      if (parentAbortSignal) {
        if (parentAbortSignal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        parentAbortSignal.addEventListener('abort', forwardParentAbort, { once: true });
      }
      var intentTimeout = setTimeout(function() {
        intentTimedOut = true;
        intentAbortController.abort();
      }, intentTimeoutMs);
      var workspaceFileMentions = Array.isArray(routingInput.workspaceFileMentions)
        ? routingInput.workspaceFileMentions
        : [];
      var slashNames = Array.isArray(routingInput.slashNames) ? routingInput.slashNames : [];
      var explicitParts = workspaceFileMentions.map(function(file) {
        return {
          type: 'workspace_file',
          name: file && file.name || '',
          path: file && file.path || ''
        };
      }).concat(slashNames.map(function(name) {
        return { type: 'slash', name: String(name || ''), command: String(name || '') };
      }));
      var contextItems = Array.isArray(routingInput.contextItems)
        ? routingInput.contextItems.slice(0, 50)
        : [];
      var recentIntentHistorySource = (Array.isArray(routingInput.history) ? routingInput.history : []).slice(-8);
      var latestAssistantIntentIndex = -1;
      for (var historyIndex = recentIntentHistorySource.length - 1; historyIndex >= 0; historyIndex -= 1) {
        if (recentIntentHistorySource[historyIndex] && recentIntentHistorySource[historyIndex].role === 'assistant') {
          latestAssistantIntentIndex = historyIndex;
          break;
        }
      }
      var recentIntentHistory = recentIntentHistorySource
        .map(function(item, historyIndex) {
          var content = String(item && item.content || '');
          var contentLimit = historyIndex === latestAssistantIntentIndex ? 7000 : 2000;
          if (content.length > contentLimit) {
            var headLength = Math.floor(contentLimit * 0.55);
            content = content.slice(0, headLength) +
              '\n...[意图识别上下文中段已压缩]...\n' +
              content.slice(-(contentLimit - headLength));
          }
          return {
            role: item && (item.role === 'assistant' || item.role === 'system') ? item.role : 'user',
            content: content
          };
        });
      try {
        if (typeof onProgress === 'function') {
          onProgress('AI 正在结合最近对话识别任务意图...');
        }
        var response = await fetch('/api/chat-bridge/query-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: normalizedMessage.substring(0, 12000),
            userId: currentUserId || 'web-user',
            conversationId: routingInput.conversationId || currentConversationId || null,
            forceProvider: routingInput.provider || undefined,
            history: recentIntentHistory,
            workspaceDirectory: routingInput.workspaceDirectory || undefined,
            workspaceFileMentions: workspaceFileMentions,
            chatAttachments: Array.isArray(routingInput.chatAttachments)
              ? routingInput.chatAttachments.slice(0, 12)
              : [],
            explicitParts: explicitParts,
            contextItems: contextItems,
            apiUrl: apiConfig.url || undefined,
            apiKey: apiConfig.key || undefined,
            model: apiConfig.model || undefined
          }),
          signal: intentAbortController.signal
        });
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success || !result.intent) {
          console.warn('[QueryIntent] Unified classifier unavailable:', result.error || response.status);
          return null;
        }
        console.log('[QueryIntent] Unified routing decision:', {
          primaryIntent: result.intent.primaryIntent,
          action: result.intent.action,
          contextualFollowUp: result.intent.isContextualFollowUp,
          needsWorkspaceSearch: result.intent.needsWorkspaceSearch,
          needsWebSearch: result.intent.needsWebSearch,
          needsLiteratureRetrieval: result.intent.needsLiteratureRetrieval,
          literatureEvidenceMode: result.intent.literatureEvidenceMode,
          provider: result.provider,
          fallbackUsed: result.fallbackUsed
        });
        return result.intent;
      } catch (error) {
        if (error && error.name === 'AbortError' && !intentTimedOut) throw error;
        if (intentTimedOut) {
          console.warn('[QueryIntent] Unified classifier exceeded ' + intentTimeoutMs + 'ms; continuing with backend deterministic routing');
          if (typeof onProgress === 'function') {
            onProgress('任务意图识别超时，已切换本地安全路由并继续执行...');
          }
          return null;
        }
        console.warn('[QueryIntent] Unified classifier failed; main Agent will use backend fallback:', error);
        return null;
      } finally {
        clearTimeout(intentTimeout);
        if (parentAbortSignal) {
          parentAbortSignal.removeEventListener('abort', forwardParentAbort);
        }
      }
    }

    async function readRetrievalExecutionResponse(response, onProgress) {
      var contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('text/event-stream') || !response.body) {
        return response.json().catch(function() { return {}; });
      }

      var reader = response.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buffer = '';
      var resultPayload = null;
      var streamFailure = null;

      function consumeEventBlock(block) {
        var dataText = block
          .split(/\r?\n/)
          .filter(function(line) { return line.startsWith('data:'); })
          .map(function(line) { return line.slice(5).trimStart(); })
          .join('\n')
          .trim();
        if (!dataText) return;
        var event;
        try {
          event = JSON.parse(dataText);
        } catch (error) {
          console.warn('[Retrieval] Ignored malformed progress event:', dataText);
          return;
        }
        if (event.type === 'progress') {
          if (typeof onProgress === 'function' && event.message) {
            onProgress(String(event.message));
          }
          return;
        }
        if (event.type === 'result') {
          resultPayload = event.payload || {};
          return;
        }
        if (event.type === 'error') {
          streamFailure = event;
        }
      }

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var boundaryIndex = buffer.search(/\r?\n\r?\n/);
        while (boundaryIndex >= 0) {
          var separatorLength = buffer.slice(boundaryIndex).startsWith('\r\n\r\n') ? 4 : 2;
          consumeEventBlock(buffer.slice(0, boundaryIndex));
          buffer = buffer.slice(boundaryIndex + separatorLength);
          boundaryIndex = buffer.search(/\r?\n\r?\n/);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) consumeEventBlock(buffer);

      if (streamFailure) {
        var streamError = new Error(streamFailure.error || streamFailure.message || '文献检索失败');
        streamError.code = streamFailure.code || 'RETRIEVAL_EXECUTION_FAILED';
        throw streamError;
      }
      if (!resultPayload) {
        throw new Error('文献检索连接提前结束，未收到最终结果');
      }
      return resultPayload;
    }

    async function runAutonomousRetrievalForMessage(message, onProgress, queryIntent, recentHistory, abortSignal) {
      if (!AUTO_LITERATURE_CONTEXT_ENABLED || !AUTO_RETRIEVAL_DETECTION_ENABLED) return null;
      var normalizedMessage = String(message || '').trim();
      if (!normalizedMessage || isRetrievalEvidenceMessage(normalizedMessage)) return null;
      if (queryIntent && queryIntent.primaryIntent === 'literature_collection') {
        console.log('[Retrieval] Skipped local evidence search because query is an external literature collection task');
        if (typeof onProgress === 'function') {
          onProgress('AI 已识别为外部文献采集，正在交给 WoS/CNKI 后台采集工具...');
        }
        return null;
      }
      var citationRequiredWriting = isCitationRequiredWritingTurn(normalizedMessage, recentHistory, queryIntent);
      if ((!queryIntent
          || queryIntent.needsLiteratureRetrieval !== true
          || (queryIntent.literatureEvidenceMode && queryIntent.literatureEvidenceMode !== 'search_new'))
          && !citationRequiredWriting) {
        console.log('[Retrieval] Skipped by unified Query intent router:', queryIntent && queryIntent.primaryIntent || 'unavailable');
        return null;
      }

      try {
        if (typeof onProgress === 'function') {
          onProgress('AI 已确认需要文献证据，正在生成检索词...');
        }
        var detectionResponse = await fetch('/api/retrieval/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: normalizedMessage.substring(0, 12000),
            context: {
              mode: 'autonomous-main-chat',
              instruction: citationRequiredWriting
                ? '当前是引言、讨论或其他引用密集章节写作。必须按待写论点生成中英文检索词，并在写作前完成 Embedding 文献库与 PDF Wiki 双库检索。'
                : '统一 Query 意图已确认需要文献证据；直接生成检索词，不要求用户点击齿轮。',
              queryIntent: queryIntent,
              recentHistory: Array.isArray(recentHistory) ? recentHistory.slice(-10) : []
            },
            userId: currentUserId,
            forceGenerate: citationRequiredWriting
          }),
          signal: abortSignal
        });
        var detection = await detectionResponse.json().catch(function() { return {}; });
        if (!detectionResponse.ok || !detection.success) {
          console.warn('[Retrieval] Autonomous detection unavailable:', detection.error || detectionResponse.status);
          return null;
        }
        if (!detection.need_retrieval || !Array.isArray(detection.points) || detection.points.length === 0) {
          console.log('[Retrieval] AI decided retrieval is unnecessary:', detection.reason || '');
          return null;
        }

        var librarySources = citationRequiredWriting
          ? ['abstract', 'pdfWiki']
          : getAutonomousRetrievalLibrarySources(detection);
        if (librarySources.length === 0) {
          console.log('[Retrieval] AI generated keywords, but no local evidence library is available');
          return {
            available: false,
            status: 'no-library',
            reason: detection.reason || '',
            points: detection.points.slice(0, 6),
            librarySources: []
          };
        }

        var points = detection.points.slice(0, 6);
        if (typeof onProgress === 'function') {
          var sourceLabel = librarySources.map(function(source) {
            return source === 'pdfWiki' ? 'PDF Wiki' : getProjectUiLabels().embeddingLibrary;
          }).join(' + ');
          onProgress('AI 已生成 ' + points.length + ' 组检索词，正在检索 ' + sourceLabel + '...');
        }
        var executionResponse = await fetch('/api/retrieval/execute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
          },
          body: JSON.stringify({
            points: points,
            userId: currentUserId,
            librarySource: librarySources[0],
            librarySources: librarySources
          }),
          signal: abortSignal
        });
        var execution = await readRetrievalExecutionResponse(executionResponse, onProgress);
        if (!executionResponse.ok || !execution.success) {
          console.warn('[Retrieval] Autonomous execution failed:', execution.error || executionResponse.status);
          return {
            available: false,
            status: 'execution-failed',
            reason: execution.error || detection.reason || '',
            points: points,
            librarySources: librarySources
          };
        }

        var contextMarkdown = formatRetrievalResultForMessage(execution);
        if (contextMarkdown.length > 80000) {
          contextMarkdown = contextMarkdown.slice(0, 80000) + '\n\n[自动检索上下文已按长度上限截断]';
        }
        return {
          available: true,
          status: 'completed',
          generatedAt: new Date().toISOString(),
          reason: detection.reason || '',
          points: points,
          librarySources: librarySources,
          sourceLabel: execution.sourceLabel || '',
          uniqueCount: Number(execution.uniqueCount || 0),
          totalFound: Number(execution.totalFound || 0),
          searchStats: Array.isArray(execution.searchStats) ? execution.searchStats : [],
          filePath: execution.filePath || '',
          fileName: execution.fileName || '',
          contextMarkdown: contextMarkdown
          ,
          citationRequiredWriting: citationRequiredWriting,
          sourceErrors: Array.isArray(execution.sourceErrors) ? execution.sourceErrors : []
        };
      } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        console.warn('[Retrieval] Autonomous retrieval failed without blocking chat:', error);
        return null;
      }
    }
    
    window.cancelRetrieval = function() {
      var modal = document.getElementById('retrievalModal');
      if (modal) modal.remove();
      currentRetrievalData = null;
    };
    
window.editRetrievalKeywords = function() {
      if (!currentRetrievalData) return;
      
      var keywords = currentRetrievalData.points.flatMap(p => p.keywords_en || []).join(', ');
      
      // 创建自定义编辑模态框
      var editModal = document.getElementById('editKeywordsModal');
      if (editModal) editModal.remove();
      
      editModal = document.createElement('div');
      editModal.id = 'editKeywordsModal';
      editModal.className = 'app-secondary-overlay app-tertiary-overlay';
      editModal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10001;';
      
      editModal.innerHTML = `
        <div style="background:var(--bg-primary);border-radius:12px;width:90%;max-width:700px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
          <div style="padding:20px;border-bottom:1px solid var(--border-color);">
            <h3 style="margin:0;color:var(--text-primary);">✏️ 编辑检索词</h3>
          </div>
          <div style="padding:20px;">
            <p style="margin:0 0 12px 0;color:var(--text-secondary);font-size:14px;">每个论点的检索词用换行分隔，多个关键词用 AND 连接</p>
            <textarea id="editKeywordsTextarea" style="width:100%;height:300px;padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input);color:var(--text-primary);font-size:14px;line-height:1.6;resize:vertical;font-family:inherit;">${keywords}</textarea>
          </div>
          <div style="padding:20px;border-top:1px solid var(--border-color);display:flex;gap:12px;justify-content:flex-end;">
            <button onclick="document.getElementById('editKeywordsModal').remove()" style="padding:10px 20px;border:1px solid var(--border-color);background:transparent;color:var(--text-primary);border-radius:6px;cursor:pointer;">取消</button>
            <button onclick="saveEditedKeywords()" style="padding:10px 20px;border:none;background:var(--accent-color);color:#fff;border-radius:6px;cursor:pointer;font-weight:600;">保存</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(editModal);
    };
    
    window.saveEditedKeywords = function() {
      var textarea = document.getElementById('editKeywordsTextarea');
      if (!textarea) return;
      
      var newKeywords = textarea.value;
      var keywordLines = newKeywords.split('\n').map(k => k.trim()).filter(k => k);
      
      if (keywordLines.length > 0) {
        currentRetrievalData.points = keywordLines.map((keyword, index) => ({
          sentence: `论点 ${index + 1}`,
          keywords_en: [keyword],
          keywords_cn: []
        }));
        
        // 更新显示
        var retrievalModal = document.getElementById('retrievalModal');
        if (retrievalModal) {
          var keywordsContainer = retrievalModal.querySelector('div[style*="flex-wrap"]');
          if (keywordsContainer) {
            keywordsContainer.innerHTML = keywordLines.map(k => 
              `<span style="background:var(--bg-secondary);color:var(--text-secondary);padding:4px 12px;border-radius:16px;font-size:13px;border:1px solid var(--border-color);">${k}</span>`
            ).join('');
          }
        }
      }
      
      document.getElementById('editKeywordsModal').remove();
    };
    
    window.executeRetrievalAndSend = async function() {
      if (!currentRetrievalData) return;

      var selectedSources = getSelectedRetrievalLibrarySources();
      if (selectedSources.length === 0) {
        alert('请先选择检索库');
        return;
      }
      
      var modal = document.getElementById('retrievalModal');
      if (modal) {
        var selectedLibraryLabel = selectedSources.map(function(source) {
          return source === 'pdfWiki' ? 'PDF 论点库' : getProjectUiLabels().embeddingLibrary;
        }).join(' + ');
        var literatureCount = selectedSources.reduce(function(sum, source) {
          return sum + (source === 'pdfWiki'
            ? (currentRetrievalData.pdfWikiCount || currentRetrievalData.libraries?.pdfWiki?.count || 0)
            : (currentRetrievalData.literatureCount || 0));
        }, 0);
        var estimatedMinutes = Math.max(1, Math.ceil(literatureCount / 1000));
      
      modal.innerHTML = `
          <div style="background:var(--bg-primary);border-radius:12px;max-width:450px;padding:40px;text-align:center;">
            <div style="font-size:40px;margin-bottom:16px;">🔍</div>
            <div style="color:var(--text-primary);font-size:16px;margin-bottom:12px;">正在检索${selectedLibraryLabel}...</div>
            <div style="color:var(--text-secondary);font-size:13px;line-height:1.6;">首次检索需加载约${literatureCount}条数据并构建向量索引<br>预计耗时${estimatedMinutes}分钟左右，后续检索将秒级响应</div>
          </div>
        `;
      }
      
      try {
        var response = await fetch('/api/retrieval/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            points: currentRetrievalData.points,
            userId: currentUserId,
            librarySource: selectedSources[0],
            librarySources: selectedSources
          })
        });
        
        var result = await response.json();
        
        if (result.success) {
          var retrievalMessage = formatRetrievalResultForMessage(result);
          
          if (modal) modal.remove();
          
          document.getElementById('userInput').value = retrievalMessage;
          
          // 更新 placeholder 显示状态
          autoResize();
          
          appendMessage(' 🐄 Little corse 已完成' + getProjectEvidenceItemName() + '检索，已自动填入输入框，点击发送即可传给 Grass', 'bot', false, true);
          
        } else {
          if (modal) {
            modal.innerHTML = `
              <div style="background:var(--bg-primary);border-radius:12px;max-width:400px;padding:40px;text-align:center;">
                <div style="font-size:40px;margin-bottom:16px;">❌</div>
                <div style="color:var(--text-primary);font-size:16px;margin-bottom:16px;">检索失败: ${result.error}</div>
                <button onclick="cancelRetrieval()" style="padding:10px 20px;border:1px solid var(--border-color);background:transparent;color:var(--text-primary);border-radius:6px;cursor:pointer;">关闭</button>
              </div>
            `;
          }
        }
      } catch (e) {
        console.error('[Retrieval] Execute error:', e);
        if (modal) modal.remove();
        appendMessage(' 检索出错: ' + e.message, 'bot', false, true);
      }
      
      currentRetrievalData = null;
    };
    
    function formatRetrievalResultForMessage(result) {
      var sourceLabel = result.sourceLabel || (result.librarySource === 'pdfWiki' ? 'PDF 论点库' : getProjectUiLabels().embeddingLibrary);
      var evidenceName = getProjectEvidenceItemName();
      var message = `🔍 ${evidenceName}检索结果（${sourceLabel}）\n\n`;
      if (Array.isArray(result.requestedLibrarySources) && result.requestedLibrarySources.length > 1) {
        message += '双库检索：Embedding 文献库 + PDF Wiki\n';
      }
      if (Array.isArray(result.sourceErrors) && result.sourceErrors.length > 0) {
        message += '未完成的检索库：' + result.sourceErrors.map(function(item) {
          return (item.source === 'pdfWiki' ? 'PDF Wiki' : 'Embedding 文献库') + '（' + item.error + '）';
        }).join('；') + '\n';
      }
      message += '引用规则：正文只能引用下列检索结果中与具体论断匹配的文献；不得补造作者、年份、题名、DOI 或参考文献。\n\n';
      message += `检索论点：\n`;
      for (var i = 0; i < (result.searchStats?.length || 0); i++) {
        var stat = result.searchStats[i];
        message += `${i + 1}. ${stat.sentence || stat.keyword}\n`;
        message += `   检索词: ${stat.keyword}, 检索${stat.found}篇, 筛选${stat.selected}篇\n`;
      }
      var resultUnit = result.librarySource === 'pdfWiki'
        ? '个最相关论点组'
        : (result.librarySource === 'combined' ? '条最相关结果' : '条最相关' + evidenceName);
      message += `\n共筛选出 ${result.uniqueCount} ${resultUnit}\n\n`;
      message += `---\n\n`;
      
      var fullContent = result.fullContent || result.preview || '';
      message += fullContent;
      
      return message;
    }

    function addTyping() {
      var div = document.createElement('div');
      div.className = 'message bot';
      div.innerHTML = '<div class="avatar bot">' + getMessageAvatarHtml('bot') + '</div><div class="typing"><span></span><span></span><span></span></div>';
      messagesDiv.appendChild(div);
      maybeScrollChatToBottom();
    }

    var OUTPUT_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'svg'];
    var OUTPUT_ATTACHMENT_EXTENSIONS = OUTPUT_IMAGE_EXTENSIONS.concat([
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'tsv', 'txt', 'md', 'markdown',
      'r', 'rmd', 'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css',
      'json', 'yaml', 'yml', 'xml', 'tex', 'latex', 'html', 'htm', 'ppt', 'pptx', 'zip'
    ]);

    function getOutputAttachmentExtension(filePath) {
      var match = String(filePath || '').match(/\.([a-zA-Z0-9]+)(?:[?#].*)?$/);
      return match ? match[1].toLowerCase() : '';
    }

    function getOutputAttachmentFileName(filePath) {
      var clean = String(filePath || '').split(/[?#]/)[0];
      var parts = clean.split(/[\\/]/);
      return parts[parts.length - 1] || clean || 'image';
    }

    function isOutputImagePath(filePath) {
      var ext = getOutputAttachmentExtension(filePath);
      return OUTPUT_IMAGE_EXTENSIONS.indexOf(ext) !== -1;
    }

    function isOutputAttachmentPath(filePath) {
      var ext = getOutputAttachmentExtension(filePath);
      return OUTPUT_ATTACHMENT_EXTENSIONS.indexOf(ext) !== -1;
    }

    function isProbablyLocalOrDownloadableOutputPath(filePath) {
      var value = String(filePath || '').trim();
      if (!value) return false;
      if (/^https?:\/\//i.test(value)) return true;
      if (value.indexOf('/api/') === 0) return true;
      if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
      if (/^\\\\[^\\]+\\[^\\]+/.test(value)) return true;
      if (/^\/(?:Users|home|tmp|var\/folders|private\/tmp|Volumes|mnt|workspace|data)\//.test(value)) return true;
      return false;
    }

    function trimOutputAttachmentCandidate(value) {
      return String(value || '')
        .replace(/^["'“”‘’`]+|["'“”‘’`，。；;、\s]+$/g, '')
        .replace(/[)）\]}】]+$/g, '')
        .trim();
    }

    function extractOutputAttachmentRootAfterLabel(rawText, labelPattern) {
      var text = String(rawText || '');
      var pattern = new RegExp('(?:' + labelPattern + ')[^\\r\\n:：]*[:：]\\s*`?([A-Za-z]:[\\\\/][^\\r\\n`]+)', 'i');
      var match = text.match(pattern);
      if (!match) return '';
      return trimOutputAttachmentCandidate(match[1])
        .replace(/[；;，,]\s*(?:权限|已索引文件|原始目录|AI|Safe|Workspace).*$/i, '')
        .trim();
    }

    function getAiWorkRootForOutputAttachments(rawText) {
      return extractOutputAttachmentRootAfterLabel(rawText, 'AI\\s*工作文件夹|安全工作副本|Safe copy workspace|AI work folder');
    }

    function getOriginalWorkspaceRootForOutputAttachments(rawText) {
      return extractOutputAttachmentRootAfterLabel(rawText, '根目录|工作目录|Workspace root');
    }

    function uniqueOutputAttachmentRoots(roots) {
      var seen = new Set();
      var list = [];
      (roots || []).forEach(function(root) {
        var value = trimOutputAttachmentCandidate(root);
        if (!value || seen.has(value)) return;
        seen.add(value);
        list.push(value);
      });
      return list;
    }

    function getWorkspaceRootsForOutputAttachments(rawText) {
      var setting = loadWorkspaceDirectorySetting ? loadWorkspaceDirectorySetting() : null;
      var conversationAiWorkRoot = setting && setting.enabled
        ? getConversationScopedAiWorkRoot(setting)
        : '';
      return uniqueOutputAttachmentRoots([
        getAiWorkRootForOutputAttachments(rawText),
        conversationAiWorkRoot,
        setting && setting.enabled ? setting.aiWorkRoot : '',
        getOriginalWorkspaceRootForOutputAttachments(rawText),
        setting && setting.enabled ? setting.path : ''
      ]);
    }

    function getWorkspaceRootForOutputAttachments(rawText) {
      var roots = getWorkspaceRootsForOutputAttachments(rawText);
      return roots.length ? roots[0] : '';
    }

    function isWorkspaceRelativeOutputPath(value) {
      var text = trimOutputAttachmentCandidate(value);
      if (!text || !isOutputAttachmentPath(text)) return false;
      if (/^https?:\/\//i.test(text) || text.indexOf('/api/') === 0) return false;
      if (/^[a-zA-Z]:[\\/]/.test(text) || /^\\\\[^\\]+\\[^\\]+/.test(text) || /^\//.test(text)) return false;
      if (text.indexOf(':') >= 0 || /[<>|]/.test(text)) return false;
      return true;
    }

    function isAgentDraftSaveReceiptLine(line) {
      var text = String(line || '').replace(/\s+/g, ' ').trim();
      if (!text) return false;
      return /(?:已保存到|已创建并保存到).{0,160}(?:章节|小节|分章节)?草稿\s+[^\s，。；;]+\.txt(?:\s|，|。|；|;|$)/i.test(text)
        || /(?:draft saved|saved to).{0,160}\bdraft\b.{0,80}\.txt(?:\s|[.,;]|$)/i.test(text);
    }

    function stripOutputAttachmentListPrefix(value) {
      return String(value || '')
        .trim()
        .replace(/^(?:[-*+•]\s+|\d{1,3}[.)、]\s*)/, '')
        .replace(/^\*\*|\*\*$/g, '')
        .trim();
    }

    function getWorkspaceRelativeOutputDeclarationPayload(line) {
      var text = String(line || '');
      var labelPattern = /(?:生成\/更新文件(?:（已验证）)?|图片文件|PDF\s*文件|附带文件|输出文件|导出文件|保存(?:到|为)|已保存|已生成|已写入|created|saved|wrote|written|generated|updated)\s*[:：]\s*/ig;
      var match;
      var lastPayload = '';
      while ((match = labelPattern.exec(text)) !== null) {
        lastPayload = text.slice(labelPattern.lastIndex).trim();
      }
      return lastPayload;
    }

    function collectDeclaredWorkspaceRelativeCandidates(line, extPattern) {
      var candidates = [];
      var seen = new Set();
      function add(value) {
        var candidate = trimOutputAttachmentCandidate(value)
          .replace(/^\[|\]$/g, '')
          .trim();
        if (!isWorkspaceRelativeOutputPath(candidate) || seen.has(candidate)) return;
        seen.add(candidate);
        candidates.push(candidate);
      }

      var text = String(line || '');
      var quotedPattern = new RegExp('[`"\'“”‘’]([^`"\'“”‘’\\r\\n]+\\.(?:' + extPattern + '))[`"\'“”‘’]', 'gi');
      var quotedMatch;
      while ((quotedMatch = quotedPattern.exec(text)) !== null) add(quotedMatch[1]);

      var tokenPatternSource = '(?:^|[\\s、，,；;])((?:\\.{1,2}[\\\\/])?(?:[A-Za-z0-9_@()\\-\\u4e00-\\u9fff]+[\\\\/])*[A-Za-z0-9_@()\\-\\u4e00-\\u9fff]+\\.(?:' + extPattern + '))(?=[\\s、，,；;。.!?！？)）\\]}】]|$)';
      var payload = getWorkspaceRelativeOutputDeclarationPayload(text);
      if (payload) {
        var exactPayload = trimOutputAttachmentCandidate(payload);
        if (isWorkspaceRelativeOutputPath(exactPayload)) add(exactPayload);
        var tokenPattern = new RegExp(tokenPatternSource, 'gi');
        var tokenMatch;
        while ((tokenMatch = tokenPattern.exec(payload)) !== null) add(tokenMatch[1]);
      }

      // For ordinary prose, retain only an individual path token and never the
      // surrounding sentence. The async existence check below decides whether
      // that token becomes a visible card.
      if (/(?:生成|写入|新建|创建|保存|输出|导出|附件|artifact|figure|plot|export|saved|created|wrote|written|generated|updated)/i.test(text)) {
        var proseTokenPattern = new RegExp(tokenPatternSource, 'gi');
        var proseTokenMatch;
        while ((proseTokenMatch = proseTokenPattern.exec(text)) !== null) add(proseTokenMatch[1]);
      }

      // A bare path on its own line (optionally preceded by a Markdown list
      // marker) is an explicit attachment declaration. For a prose sentence
      // such as "5. I created citation-evidence.json", only the filename token
      // above is retained; the sentence itself can never become the filename.
      var standalone = stripOutputAttachmentListPrefix(text);
      if (isWorkspaceRelativeOutputPath(standalone)) add(standalone);
      return candidates;
    }

    function collectWorkspaceRelativeOutputAttachmentPaths(rawText, workspaceRoot) {
      var root = trimOutputAttachmentCandidate(workspaceRoot);
      if (!root) return [];
      var raw = String(rawText || '');
      var seen = new Set();
      var paths = [];
      var extPattern = OUTPUT_ATTACHMENT_EXTENSIONS.map(function(ext) {
        return ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('|');
      raw.split(/\r?\n/).forEach(function(line) {
        // save_draft persists an application chapter draft and returns a semantic
        // receipt such as "已保存到 Introduction 草稿 introduction.txt". It is
        // not a verified file inside the current workspace and must not become a
        // local attachment card.
        if (isAgentDraftSaveReceiptLine(line)) return;
        collectDeclaredWorkspaceRelativeCandidates(line, extPattern).forEach(function(relativePath) {
          var absolutePath = joinLocalRPath(root, relativePath);
          if (!absolutePath || seen.has(absolutePath)) return;
          seen.add(absolutePath);
          paths.push(absolutePath);
        });
      });
      return paths.slice(0, 12);
    }

    function getOutputAttachmentKind(filePath) {
      var ext = getOutputAttachmentExtension(filePath);
      if (OUTPUT_IMAGE_EXTENSIONS.indexOf(ext) !== -1) return 'image';
      if (ext === 'pdf') return 'pdf';
      if (ext === 'xls' || ext === 'xlsx' || ext === 'csv' || ext === 'tsv') return 'data';
      if (ext === 'doc' || ext === 'docx') return 'word';
      if (ext === 'ppt' || ext === 'pptx') return 'presentation';
      if (/^(?:r|rmd|py|js|mjs|cjs|ts|tsx|jsx|css|json|yaml|yml|xml|tex|latex)$/.test(ext)) return 'code';
      if (ext === 'txt' || ext === 'md' || ext === 'markdown' || ext === 'html' || ext === 'htm') return 'text';
      if (ext === 'zip') return 'archive';
      return 'file';
    }

    function getOutputAttachmentIconName(kind) {
      if (kind === 'image') return 'image';
      if (kind === 'data') return 'table';
      return 'fileText';
    }

    function outputAttachmentIcon(kind, fileName) {
      var ext = getOutputAttachmentExtension(fileName);
      var label = '';
      var color = '#77746c';
      var light = '#f4f3ef';
      if (kind === 'pdf' || ext === 'pdf') {
        label = 'PDF';
        color = '#d93025';
        light = '#fff1f0';
      } else if (kind === 'data' || /^(xls|xlsx|csv|tsv)$/i.test(ext)) {
        label = ext === 'csv' || ext === 'tsv' ? 'CSV' : 'XLS';
        color = '#188038';
        light = '#edf7ed';
      } else if (kind === 'code' || /^(r|rmd|py|js|mjs|cjs|ts|tsx|jsx|css|json|yaml|yml|xml|tex|latex)$/i.test(ext)) {
        label = ext === 'rmd' ? 'RMD' : (ext ? ext.toUpperCase().slice(0, 3) : 'R');
        color = '#2b6cb0';
        light = '#edf4ff';
      } else if (kind === 'word') {
        label = 'DOC';
        color = '#2563eb';
        light = '#eef4ff';
      } else if (kind === 'presentation') {
        label = 'PPT';
        color = '#c2410c';
        light = '#fff3ed';
      } else if (kind === 'archive') {
        label = 'ZIP';
        color = '#8a5a00';
        light = '#fff7dc';
      } else if (kind === 'text') {
        label = 'TXT';
        color = '#5f6368';
        light = '#f4f4f4';
      } else if (kind === 'image') {
        return uiIcon('image', 'md');
      } else {
        return uiIcon(getOutputAttachmentIconName(kind), 'md');
      }
      return '' +
        '<svg class="output-filetype-icon" viewBox="0 0 24 24" aria-hidden="true">' +
          '<path d="M6 2.8h8.4L19 7.4v13.1c0 .9-.7 1.7-1.7 1.7H6.7c-.9 0-1.7-.7-1.7-1.7v-16c0-.9.7-1.7 1.7-1.7z" fill="' + light + '" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round"></path>' +
          '<path d="M14.2 2.9v4.7H19" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round"></path>' +
          '<rect x="4.2" y="11" width="15.6" height="7.2" rx="1.5" fill="' + color + '"></rect>' +
          '<text x="12" y="14.85" font-size="' + (label.length > 3 ? '4.2' : '4.8') + '" fill="#fff">' + escapeHtml(label) + '</text>' +
        '</svg>';
    }

    function getOutputAttachmentKindLabel(kind) {
      if (kind === 'image') return '图像';
      if (kind === 'pdf') return 'PDF';
      if (kind === 'data') return '表格/数据';
      if (kind === 'word') return 'Word 文档';
      if (kind === 'presentation') return '演示文稿';
      if (kind === 'code') return '代码文件';
      if (kind === 'text') return '文本文件';
      if (kind === 'archive') return '压缩包';
      return '文件';
    }

    var OUTPUT_ATTACHMENT_THUMBNAIL_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    var OUTPUT_ATTACHMENT_THUMBNAIL_CACHE_LIMIT = 24;
    var outputAttachmentThumbnailCache = new Map();
    var outputAttachmentThumbnailObserver = null;

    function detectOutputAttachmentImageMime(arrayBuffer, declaredMime) {
      var bytes = new Uint8Array(arrayBuffer || new ArrayBuffer(0));
      var mime = String(declaredMime || '').split(';')[0].trim().toLowerCase();
      if (bytes.length >= 8
          && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
          && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
        return 'image/png';
      }
      if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg';
      }
      if (bytes.length >= 6) {
        var six = String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, 0, 6));
        if (six === 'GIF87a' || six === 'GIF89a') return 'image/gif';
      }
      if (bytes.length >= 12) {
        var riff = String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, 0, 4));
        var webp = String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, 8, 12));
        if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
      }
      if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
      if (bytes.length >= 4
          && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
            || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))) {
        return 'image/tiff';
      }
      if (bytes.length) {
        var prefixLength = Math.min(bytes.length, 2048);
        var prefix = '';
        try {
          prefix = new TextDecoder('utf-8').decode(bytes.slice(0, prefixLength))
            .replace(/^\uFEFF/, '')
            .trim()
            .toLowerCase();
        } catch (e) {}
        if (/^(?:<\?xml[\s\S]*?\?>\s*)?<svg(?:\s|>)/i.test(prefix)
            || (prefix.indexOf('<svg') >= 0 && prefix.indexOf('<html') < 0)) {
          return 'image/svg+xml';
        }
      }
      return mime.indexOf('image/') === 0 ? mime : '';
    }

    function shouldKeepOriginalOutputImage(mimeType) {
      return mimeType === 'image/svg+xml' || mimeType === 'image/gif';
    }

    function getOutputAttachmentThumbnailCacheKey(img, sourceUrl) {
      // sourceUrl contains the output version token. A file path alone is not
      // a safe cache key because AI/R jobs commonly overwrite the same name.
      return String(sourceUrl || '').trim();
    }

    function trimOutputAttachmentThumbnailCache() {
      while (outputAttachmentThumbnailCache.size > OUTPUT_ATTACHMENT_THUMBNAIL_CACHE_LIMIT) {
        var oldest = outputAttachmentThumbnailCache.keys().next().value;
        if (!oldest) break;
        outputAttachmentThumbnailCache.delete(oldest);
      }
    }

    function getOutputAttachmentThumbnailBlob(img, sourceUrl) {
      var cacheKey = getOutputAttachmentThumbnailCacheKey(img, sourceUrl);
      if (cacheKey && outputAttachmentThumbnailCache.has(cacheKey)) {
        var cached = outputAttachmentThumbnailCache.get(cacheKey);
        outputAttachmentThumbnailCache.delete(cacheKey);
        outputAttachmentThumbnailCache.set(cacheKey, cached);
        return cached;
      }
      var request = fetch(sourceUrl, { method: 'GET', cache: 'no-store' })
        .then(function(response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.blob();
        })
        .then(function(sourceBlob) {
          return sourceBlob.arrayBuffer().then(function(sourceBuffer) {
            var detectedMime = detectOutputAttachmentImageMime(sourceBuffer, sourceBlob.type);
            if (!detectedMime) {
              throw new Error('服务端返回的内容不是图片');
            }
            var normalizedSource = sourceBlob.type === detectedMime
              ? sourceBlob
              : new Blob([sourceBlob], { type: detectedMime });
            if (shouldKeepOriginalOutputImage(detectedMime)) return normalizedSource;
            return optimizeOutputAttachmentThumbnailInWorker(sourceBuffer, detectedMime)
              .then(function(optimized) {
                return new Blob([optimized.buffer], { type: optimized.mime || 'image/webp' });
              })
              .catch(function(error) {
                console.warn('[LocalPreview] Thumbnail optimization failed; using original image:', error);
                return normalizedSource;
              });
          });
        });
      if (cacheKey) {
        outputAttachmentThumbnailCache.set(cacheKey, request);
        trimOutputAttachmentThumbnailCache();
        request.catch(function() {
          if (outputAttachmentThumbnailCache.get(cacheKey) === request) {
            outputAttachmentThumbnailCache.delete(cacheKey);
          }
        });
      }
      return request;
    }

    function finishOutputAttachmentThumbnailLoad(img) {
      var button = img && img.closest ? img.closest('.output-attachment-preview') : null;
      img.setAttribute('data-thumbnail-status', 'ready');
      if (button) {
        button.classList.remove('is-thumbnail-loading');
        button.classList.add('is-thumbnail-ready');
      }
      var objectUrl = img.__outputAttachmentThumbnailObjectUrl;
      if (objectUrl) {
        img.__outputAttachmentThumbnailObjectUrl = '';
        setTimeout(function() {
          try { URL.revokeObjectURL(objectUrl); } catch (e) {}
        }, 0);
      }
    }

    async function loadOutputAttachmentThumbnail(img) {
      if (!img || !img.isConnected) return;
      var status = img.getAttribute('data-thumbnail-status') || '';
      if (status === 'loading' || status === 'applying' || status === 'ready') return;
      var sourceUrl = img.getAttribute('data-thumbnail-source-url') || '';
      if (!sourceUrl) return;
      var button = img.closest ? img.closest('.output-attachment-preview') : null;
      img.setAttribute('data-thumbnail-status', 'loading');
      if (button) button.classList.add('is-thumbnail-loading');
      try {
        var thumbnailBlob = await getOutputAttachmentThumbnailBlob(img, sourceUrl);
        if (!img.isConnected || img.getAttribute('data-thumbnail-source-url') !== sourceUrl) return;
        var objectUrl = URL.createObjectURL(thumbnailBlob);
        img.__outputAttachmentThumbnailObjectUrl = objectUrl;
        img.setAttribute('data-thumbnail-status', 'applying');
        img.src = objectUrl;
      } catch (error) {
        if (!img.isConnected) return;
        img.setAttribute('data-thumbnail-status', 'error');
        if (button) button.classList.remove('is-thumbnail-loading');
        handleOutputAttachmentPreviewError(img);
      }
    }

    function getOutputAttachmentThumbnailObserver() {
      if (outputAttachmentThumbnailObserver || typeof IntersectionObserver !== 'function') {
        return outputAttachmentThumbnailObserver;
      }
      outputAttachmentThumbnailObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (!entry.isIntersecting) return;
          outputAttachmentThumbnailObserver.unobserve(entry.target);
          entry.target.setAttribute('data-thumbnail-status', '');
          loadOutputAttachmentThumbnail(entry.target);
        });
      }, { rootMargin: '320px 0px' });
      return outputAttachmentThumbnailObserver;
    }

    function scheduleOutputAttachmentThumbnail(img, force) {
      if (!img || !img.isConnected) return;
      var status = img.getAttribute('data-thumbnail-status') || '';
      if (status === 'applying') {
        finishOutputAttachmentThumbnailLoad(img);
        return;
      }
      if (!force && (status === 'queued' || status === 'loading' || status === 'ready')) return;
      var observer = getOutputAttachmentThumbnailObserver();
      if (!force && observer) {
        img.setAttribute('data-thumbnail-status', 'queued');
        observer.observe(img);
        return;
      }
      img.setAttribute('data-thumbnail-status', '');
      setTimeout(function() { loadOutputAttachmentThumbnail(img); }, 0);
    }
    window.scheduleOutputAttachmentThumbnail = scheduleOutputAttachmentThumbnail;

    async function handleOutputAttachmentPreviewError(img) {
      if (!img || !img.parentElement) return;
      var button = img.parentElement;
      var filePath = button.getAttribute('data-file-path') || '';
      var previewUrl = button.getAttribute('data-preview-url') || img.getAttribute('src') || '';
      if (!img.getAttribute('data-preview-retried') && isLocalOutputAttachmentPathForAuthorization(filePath)) {
        img.setAttribute('data-preview-retried', '1');
        try {
          // Reuse the same multi-root authorization and resolution path as a
          // deliberate sidebar click. The path embedded in an AI response can
          // point at the conversation workspace while the real image lives in
          // the original project root.
          await authorizeOutputAttachmentPreviewTargets(button);
          var resolvedPath = await resolveOutputAttachmentLocalPath(button);
          var resolvedPreviewUrl = getOutputAttachmentPreviewUrl(
            resolvedPath || filePath || previewUrl,
            getOutputAttachmentWorkspaceRoot(button)
          );
          button.setAttribute('data-preview-url', resolvedPreviewUrl);
          if (img.hasAttribute('data-thumbnail-source-url')) {
            img.setAttribute('data-thumbnail-source-url', resolvedPreviewUrl);
            img.setAttribute('data-thumbnail-status', '');
            scheduleOutputAttachmentThumbnail(img, true);
          } else {
            img.src = resolvedPreviewUrl;
          }
          return;
        } catch (error) {
          console.warn('[LocalPreview] Retry authorization failed:', filePath, error);
        }
      }
      var fileName = button.getAttribute('data-file-name') || img.alt || '图片';
      button.innerHTML = '<span class="output-attachment-preview-placeholder">' +
        uiIcon('image', 'lg') +
        '<span>' + escapeHtml(fileName) + '</span>' +
      '</span>';
    }
    window.handleOutputAttachmentPreviewError = handleOutputAttachmentPreviewError;

    function isLikelyOutputAttachmentLine(line) {
      return /(生成\/更新文件|图片文件|PDF 文件|附带文件|输出文件|导出文件|保存(?:到|为)|已保存|已生成|已写入|created|saved|wrote|written|generated|updated)/i.test(String(line || ''));
    }

    function getSequentialPageScreenshotInfo(filePath) {
      var value = String(filePath || '').trim().split(/[?#]/)[0].replace(/\\/g, '/');
      var name = value.split('/').pop() || '';
      var match = /^(page|sheet|slide)[\s_-]*0*(\d+)\.(png|jpe?g|webp|bmp|tiff?)$/i.exec(name);
      if (!match) return null;
      return {
        directory: value.slice(0, Math.max(0, value.length - name.length)).toLowerCase(),
        series: match[1].toLowerCase(),
        extension: match[3].toLowerCase(),
        normalizedPath: value.toLowerCase()
      };
    }

    function isTransientPageQaOutputPath(filePath) {
      var info = getSequentialPageScreenshotInfo(filePath);
      if (!info) return false;
      return /(?:^|\/)(?:\.?scholar[-_]?harness[-_]?(?:qa|temp)|qa(?:[-_][^\/]*)?|review(?:[-_][^\/]*)?|render(?:ed)?(?:[-_][^\/]*)?|preview(?:[-_][^\/]*)?|docx[-_]?(?:pages?|render|preview|qa)|pdf[-_]?(?:pages?|render|preview|qa)|pages?|temp|tmp)(?:\/|$)/i.test(info.normalizedPath);
    }

    function normalizeOutputAttachmentPathForVariantDedupe(filePath) {
      var value = String(filePath || '').trim();
      if (!value) return '';
      if (value.indexOf('/api/local-file/preview') === 0) {
        try {
          value = new URL(value, window.location.origin).searchParams.get('path') || value;
        } catch (e) {}
      }
      try { value = decodeURIComponent(value); } catch (e) {}
      return value
        .split(/[?#]/)[0]
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/\/+$/g, '')
        .toLowerCase();
    }

    function getOutputImageVariantDedupeKey(filePath) {
      if (!isOutputImagePath(filePath)) return '';
      var normalized = normalizeOutputAttachmentPathForVariantDedupe(filePath);
      if (!normalized) return '';
      var parts = normalized.split('/').filter(Boolean);
      var fileName = parts.pop() || '';
      var stem = fileName.replace(/\.[^.]+$/, '');
      var parent = parts.pop() || '';
      return parent + '/' + stem;
    }

    function getOutputImageVariantDisplayPriority(filePath) {
      var normalized = normalizeOutputAttachmentPathForVariantDedupe(filePath);
      var extension = getOutputAttachmentExtension(normalized);
      var formatPriority = {
        svg: 60,
        png: 50,
        webp: 40,
        jpg: 30,
        jpeg: 30,
        gif: 20,
        bmp: 10,
        tif: 5,
        tiff: 5
      };
      var workspacePriority = normalized.indexOf('/scholarharness_ai_workspaces/') >= 0 ? 0 : 1000;
      return workspacePriority + (formatPriority[extension] || 0);
    }

    function dedupeOutputImageVariants(filePaths) {
      var result = [];
      var imageIndexes = {};
      (Array.isArray(filePaths) ? filePaths : []).forEach(function(filePath) {
        var key = getOutputImageVariantDedupeKey(filePath);
        if (!key) {
          result.push(filePath);
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(imageIndexes, key)) {
          imageIndexes[key] = result.length;
          result.push(filePath);
          return;
        }
        var existingIndex = imageIndexes[key];
        var existingPath = result[existingIndex];
        if (getOutputImageVariantDisplayPriority(filePath) > getOutputImageVariantDisplayPriority(existingPath)) {
          result[existingIndex] = filePath;
        }
      });
      return result;
    }

    function dedupeMirroredOutputAttachmentPaths(filePaths) {
      var result = [];
      var normalizedIndexes = {};
      var basenameIndexes = {};
      (Array.isArray(filePaths) ? filePaths : []).forEach(function(filePath) {
        var normalized = normalizeOutputAttachmentPathForVariantDedupe(filePath);
        if (!normalized || Object.prototype.hasOwnProperty.call(normalizedIndexes, normalized)) return;
        var fileName = normalized.split('/').filter(Boolean).pop() || normalized;
        var isAiWorkspaceCopy = normalized.indexOf('/scholarharness_ai_workspaces/') >= 0;
        if (Object.prototype.hasOwnProperty.call(basenameIndexes, fileName)) {
          var existingIndex = basenameIndexes[fileName];
          var existingPath = result[existingIndex];
          var existingNormalized = normalizeOutputAttachmentPathForVariantDedupe(existingPath);
          var existingIsAiWorkspaceCopy = existingNormalized.indexOf('/scholarharness_ai_workspaces/') >= 0;
          // The verified artifact block can contain both the protected AI copy
          // and the synchronized user-workspace copy. They are one logical
          // output, so show the user-workspace card only. Keep genuinely
          // different same-name files when neither path is a mirrored copy.
          if (existingIsAiWorkspaceCopy !== isAiWorkspaceCopy) {
            if (existingIsAiWorkspaceCopy && !isAiWorkspaceCopy) {
              delete normalizedIndexes[existingNormalized];
              result[existingIndex] = filePath;
              normalizedIndexes[normalized] = existingIndex;
            }
            return;
          }
        }
        basenameIndexes[fileName] = result.length;
        normalizedIndexes[normalized] = result.length;
        result.push(filePath);
      });
      return result;
    }

    function filterUserFacingOutputAttachmentPaths(filePaths) {
      var values = Array.isArray(filePaths) ? filePaths.filter(Boolean) : [];
      var groupCounts = {};
      values.forEach(function(filePath) {
        var info = getSequentialPageScreenshotInfo(filePath);
        if (!info) return;
        var groupKey = info.directory + '|' + info.series + '|' + info.extension;
        groupCounts[groupKey] = (groupCounts[groupKey] || 0) + 1;
      });
      var filtered = values.filter(function(filePath) {
        if (isTransientPageQaOutputPath(filePath)) return false;
        var info = getSequentialPageScreenshotInfo(filePath);
        if (!info) return true;
        var groupKey = info.directory + '|' + info.series + '|' + info.extension;
        return (groupCounts[groupKey] || 0) < 2;
      });
      return dedupeMirroredOutputAttachmentPaths(dedupeOutputImageVariants(filtered));
    }

    function collectOutputAttachmentPaths(text, options) {
      options = options || {};
      var originalRaw = String(text || '');
      var raw = originalRaw;
      if (options.latestGeneratedOnly) {
        // Agent logs are chronological. Parse newest output declarations first
        // so an older same-name path cannot occupy the first attachment slot.
        raw = raw.split(/\r?\n/).filter(isLikelyOutputAttachmentLine).reverse().join('\n');
      }
      var seen = new Set();
      var paths = [];
      var patterns = [
        /[a-zA-Z]:[\\/][^\n\r`"'<>|]+?\.(?:png|jpe?g|gif|bmp|webp|tiff?|svg|pdf|docx?|xlsx?|csv|tsv|txt|md|markdown|r|rmd|json|tex|latex|html?|pptx?|zip)(?=[\s`"'，。；,.;)）\]}>]|$)/gi,
        /\\\\[^\n\r`"'<>|]+?\.(?:png|jpe?g|gif|bmp|webp|tiff?|svg|pdf|docx?|xlsx?|csv|tsv|txt|md|markdown|r|rmd|json|tex|latex|html?|pptx?|zip)(?=[\s`"'，。；,.;)）\]}>]|$)/gi,
        /https?:\/\/[^\s`"'<>]+?\.(?:png|jpe?g|gif|bmp|webp|tiff?|svg|pdf|docx?|xlsx?|csv|tsv|txt|md|markdown|r|rmd|json|tex|latex|html?|pptx?|zip)(?:\?[^\s`"'<>]*)?/gi,
        /\/[^\n\r`"'<>|]+?\.(?:png|jpe?g|gif|bmp|webp|tiff?|svg|pdf|docx?|xlsx?|csv|tsv|txt|md|markdown|r|rmd|json|tex|latex|html?|pptx?|zip)(?=[\s`"'，。；,.;)）\]}>]|$)/gi
      ];
      patterns.forEach(function(pattern) {
        var match;
        while ((match = pattern.exec(raw)) !== null) {
          var value = String(match[0] || '').trim();
          value = value.replace(/[，。；,.;)]+$/g, '');
          if (!value || !isOutputAttachmentPath(value) || !isProbablyLocalOrDownloadableOutputPath(value) || seen.has(value)) continue;
          seen.add(value);
          paths.push(value);
        }
      });
      var workspaceRoot = getWorkspaceRootForOutputAttachments(originalRaw);
      collectWorkspaceRelativeOutputAttachmentPaths(raw, workspaceRoot).forEach(function(filePath) {
        if (!filePath || seen.has(filePath)) return;
        seen.add(filePath);
        paths.push(filePath);
      });
      return filterUserFacingOutputAttachmentPaths(paths).slice(0, 12);
    }

    var outputAttachmentPreviewVersionCounter = 0;

    function addOutputPreviewVersion(url) {
      var value = String(url || '');
      if (!value) return value;
      var separator = value.indexOf('?') >= 0 ? '&' : '?';
      outputAttachmentPreviewVersionCounter += 1;
      return value + separator + 'v=' + Date.now().toString(36) + '_' + outputAttachmentPreviewVersionCounter.toString(36);
    }

    function appendOutputPreviewWorkspaceRoot(url, workspaceRoot) {
      var value = String(url || '');
      var root = String(workspaceRoot || '').trim();
      if (!value || !root || /[?&]workspaceRoot=/.test(value)) return value;
      return value + (value.indexOf('?') >= 0 ? '&' : '?') + 'workspaceRoot=' + encodeURIComponent(root);
    }

    function getOutputAttachmentPreviewUrl(filePath, workspaceRoot) {
      var value = String(filePath || '');
      if (value.indexOf('/api/local-file/preview') === 0) {
        if (!/[?&]latest=/.test(value)) {
          value += (value.indexOf('?') >= 0 ? '&' : '?') + 'latest=1';
        }
        return addOutputPreviewVersion(appendOutputPreviewWorkspaceRoot(value, workspaceRoot));
      }
      if (value.indexOf('/api/r-code/artifact/') === 0) return addOutputPreviewVersion(value);
      if (/^https?:\/\//i.test(value) || value.indexOf('/api/') === 0) return value;
      if (!isProbablyLocalOrDownloadableOutputPath(value)) return value;
      return addOutputPreviewVersion(appendOutputPreviewWorkspaceRoot(
        '/api/local-file/preview?path=' + encodeURIComponent(value) + '&latest=1',
        workspaceRoot
      ));
    }

    var OUTPUT_ATTACHMENT_VISIBLE_LIMIT = 3;
    var OUTPUT_IMAGE_COLLECTION_THRESHOLD = 3;
    var OUTPUT_IMAGE_COLLECTION_LIMIT = 12;

    function renderOutputAttachmentCard(filePath, workspaceRoot) {
      var name = getOutputAttachmentFileName(filePath);
      var kind = getOutputAttachmentKind(filePath);
      var isImage = kind === 'image';
      var ext = getOutputAttachmentExtension(filePath).toUpperCase() || 'FILE';
      var previewUrl = getOutputAttachmentPreviewUrl(filePath, workspaceRoot);
      var iconButtonHtml = '<button type="button" class="output-attachment-icon output-attachment-icon-button" data-file-path="' + escapeHtml(filePath) + '" data-preview-url="' + escapeHtml(previewUrl) + '" data-file-name="' + escapeHtml(name) + '" data-file-kind="' + escapeHtml(kind) + '" onclick="openOutputAttachmentFile(this)" title="打开文件" aria-label="打开文件">' + outputAttachmentIcon(kind, name) + '</button>';
      var infoHtml = isImage
        ? '<span class="output-attachment-info">' +
            '<span class="output-attachment-title-row">' +
              iconButtonHtml +
              '<span class="output-attachment-text-stack">' +
                '<span class="output-attachment-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span>' +
                '<span class="output-attachment-meta">' + escapeHtml(getOutputAttachmentKindLabel(kind)) + ' · ' + escapeHtml(ext) + '</span>' +
              '</span>' +
            '</span>' +
          '</span>'
        : iconButtonHtml +
          '<span class="output-attachment-info">' +
            '<span class="output-attachment-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span>' +
            '<span class="output-attachment-meta">' + escapeHtml(getOutputAttachmentKindLabel(kind)) + ' · ' + escapeHtml(ext) + '</span>' +
          '</span>';
      return '' +
        '<div class="output-attachment-card output-attachment-card-clickable' + (isImage ? ' output-attachment-card-combined' : '') + '" data-file-path="' + escapeHtml(filePath) + '" data-preview-url="' + escapeHtml(previewUrl) + '" data-file-name="' + escapeHtml(name) + '" data-file-kind="' + escapeHtml(kind) + '" data-workspace-root="' + escapeHtml(workspaceRoot) + '" onclick="openOutputAttachmentCardInSidebar(this,event)">' +
          (isImage ? '<button type="button" class="output-attachment-preview is-thumbnail-loading" data-file-path="' + escapeHtml(filePath) + '" data-preview-url="' + escapeHtml(previewUrl) + '" data-file-name="' + escapeHtml(name) + '" data-file-kind="image" data-workspace-root="' + escapeHtml(workspaceRoot) + '" onclick="previewOutputAttachment(this)" title="在软件内查看图片" aria-label="在软件内查看图片">' +
            '<img class="output-attachment-thumbnail" src="' + OUTPUT_ATTACHMENT_THUMBNAIL_PLACEHOLDER + '" data-thumbnail-source-url="' + escapeHtml(previewUrl) + '" alt="' + escapeHtml(name) + '" loading="eager" decoding="async" onload="scheduleOutputAttachmentThumbnail(this)" onerror="handleOutputAttachmentPreviewError(this)">' +
          '</button>' : '') +
          infoHtml +
          '<button type="button" class="output-attachment-open" data-file-path="' + escapeHtml(filePath) + '" data-preview-url="' + escapeHtml(previewUrl) + '" onclick="openOutputAttachmentFile(this)">打开文件</button>' +
          (!/^https?:\/\//i.test(filePath) && filePath.indexOf('/api/') !== 0 ? '<button type="button" class="output-attachment-open" data-file-path="' + escapeHtml(filePath) + '" data-preview-url="' + escapeHtml(previewUrl) + '" onclick="openOutputAttachmentFolder(this)">打开所在文件夹</button>' : '') +
        '</div>';
    }

    function renderOutputImageCollectionThumb(filePath, workspaceRoot, index) {
      var name = getOutputAttachmentFileName(filePath);
      var previewUrl = getOutputAttachmentPreviewUrl(filePath, workspaceRoot);
      return '<button type="button" class="workspace-image-thumb output-image-collection-thumb output-attachment-preview is-thumbnail-loading"' +
        ' data-index="' + index + '"' +
        ' data-file-path="' + escapeHtml(filePath) + '"' +
        ' data-preview-url="' + escapeHtml(previewUrl) + '"' +
        ' data-file-name="' + escapeHtml(name) + '"' +
        ' data-file-kind="image"' +
        ' data-workspace-root="' + escapeHtml(workspaceRoot) + '"' +
        ' onclick="previewOutputAttachment(this)"' +
        ' title="' + escapeHtml(name) + '"' +
        ' aria-label="在软件内查看图片：' + escapeHtml(name) + '">' +
          '<img class="output-attachment-thumbnail" src="' + OUTPUT_ATTACHMENT_THUMBNAIL_PLACEHOLDER + '" data-thumbnail-source-url="' + escapeHtml(previewUrl) + '" alt="' + escapeHtml(name) + '" loading="eager" decoding="async" onload="handleOutputImageCollectionThumbnailLoad(this)" onerror="handleOutputAttachmentPreviewError(this)">' +
      '</button>';
    }

    function renderOutputImageCollection(imagePaths, workspaceRoot) {
      if (!imagePaths || imagePaths.length <= OUTPUT_IMAGE_COLLECTION_THRESHOLD) return '';
      var visibleImages = imagePaths.slice(0, OUTPUT_IMAGE_COLLECTION_LIMIT);
      return '<div class="output-image-collection">' +
        '<div class="output-image-collection-header"><strong>图片集</strong><span>' + imagePaths.length + ' 张 · 并排展示</span></div>' +
        '<div class="workspace-image-stage output-image-collection-stage">' +
          '<div class="output-image-collection-grid">' +
            visibleImages.map(function(filePath, index) {
              return renderOutputImageCollectionThumb(filePath, workspaceRoot, index);
            }).join('') +
            (imagePaths.length > visibleImages.length ? '<div class="output-image-collection-more">还有 ' + (imagePaths.length - visibleImages.length) + ' 张</div>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }

    function renderOutputAttachmentOverflow(filePaths, workspaceRoot) {
      if (!filePaths || !filePaths.length) return '';
      return '<details class="output-attachment-overflow">' +
        '<summary><span>其余 ' + filePaths.length + ' 个文件</span><span class="output-attachment-overflow-state" aria-hidden="true"></span></summary>' +
        '<div class="output-attachment-overflow-list">' +
          filePaths.map(function(filePath) {
            return renderOutputAttachmentCard(filePath, workspaceRoot);
          }).join('') +
        '</div>' +
      '</details>';
    }

    function renderOutputAttachmentCards(rawText, options) {
      options = options || {};
      var paths = collectOutputAttachmentPaths(rawText, options);
      if (!paths.length) return '';
      var workspaceContextText = String(options.workspaceContextText || rawText || '');
      var workspaceRoot = getWorkspaceRootForOutputAttachments(workspaceContextText);
      var imagePaths = paths.filter(isOutputImagePath);
      var renderImagesAsCollection = imagePaths.length > OUTPUT_IMAGE_COLLECTION_THRESHOLD;
      var cardPaths = renderImagesAsCollection
        ? paths.filter(function(filePath) { return !isOutputImagePath(filePath); })
        : paths;
      var visiblePaths = cardPaths.slice(0, OUTPUT_ATTACHMENT_VISIBLE_LIMIT);
      var hiddenPaths = cardPaths.slice(OUTPUT_ATTACHMENT_VISIBLE_LIMIT);
      var headingHtml = options.verified
        ? '<div class="output-attachments-heading"><span>生成/更新文件（已验证）</span><span>' + paths.length + ' 个</span></div>'
        : '';
      return '<div class="output-attachments" data-output-verified="' + (options.verified ? '1' : '0') + '">' +
        headingHtml +
        (renderImagesAsCollection ? renderOutputImageCollection(imagePaths, workspaceRoot) : '') +
        visiblePaths.map(function(filePath) {
          return renderOutputAttachmentCard(filePath, workspaceRoot);
        }).join('') +
        renderOutputAttachmentOverflow(hiddenPaths, workspaceRoot) +
      '</div>';
    }

    function refreshValidatedOutputAttachmentContainer(container) {
      if (!container || !container.querySelectorAll) return;
      container.querySelectorAll('.output-attachment-overflow').forEach(function(details) {
        if (!details.querySelector('.output-attachment-card')) details.remove();
      });
      var cards = container.querySelectorAll('.output-attachment-card').length;
      var imageThumbs = container.querySelectorAll('.output-image-collection-thumb').length;
      var total = cards + imageThumbs;
      var headingCount = container.querySelector('.output-attachments-heading span:last-child');
      if (headingCount) headingCount.textContent = total + ' 个';
      var imageHeader = container.querySelector('.output-image-collection-header span');
      if (imageHeader) imageHeader.textContent = imageThumbs + ' 张 · 并排展示';
      var imageCollection = container.querySelector('.output-image-collection');
      if (imageCollection && imageThumbs === 0) imageCollection.remove();
      if (total === 0) container.remove();
    }

    async function validateOutputAttachmentCards(root) {
      var scope = root && root.querySelectorAll ? root : document;
      var containers = Array.prototype.slice.call(
        scope.querySelectorAll('.output-attachments[data-output-verified="0"]')
      );
      await Promise.all(containers.map(async function(container) {
        if (!container.isConnected || container.getAttribute('data-output-validation-state')) return;
        container.setAttribute('data-output-validation-state', 'pending');
        var nodes = Array.prototype.slice.call(
          container.querySelectorAll('.output-attachment-card, .output-image-collection-thumb')
        );
        await Promise.all(nodes.map(async function(node) {
          var filePath = node.getAttribute('data-file-path') || '';
          if (!filePath || /^https?:\/\//i.test(filePath) || filePath.indexOf('/api/') === 0) return;
          var resolvedPath = await resolveOutputAttachmentLocalPath(node, { requireExisting: true });
          if (!resolvedPath && node.isConnected) node.remove();
        }));
        if (!container.isConnected) return;
        container.setAttribute('data-output-validation-state', 'complete');
        refreshValidatedOutputAttachmentContainer(container);
      }));
    }
    window.validateOutputAttachmentCards = validateOutputAttachmentCards;

    function isRightSidebarTextPreviewKind(kind, extension) {
      if (kind === 'text' || kind === 'code') return true;
      return kind === 'data' && (extension === 'csv' || extension === 'tsv');
    }

    function supportsRightSidebarTextEditing(extension) {
      return [
        'txt', 'md', 'markdown', 'csv', 'tsv', 'json',
        'r', 'rmd', 'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
        'css', 'html', 'htm', 'tex', 'latex', 'yaml', 'yml', 'xml'
      ].indexOf(String(extension || '').toLowerCase()) !== -1;
    }

    function supportsRightSidebarFormattedPreview(extension) {
      return ['xlsx', 'xls', 'csv', 'tsv', 'doc', 'docx', 'r', 'rmd', 'json', 'tex', 'latex', 'txt', 'md', 'markdown', 'html', 'htm'].indexOf(String(extension || '').toLowerCase()) !== -1;
    }

    function getRightSidebarFormattedPreviewUrl(target, extension, workspaceRoot) {
      var value = String(target || '').trim();
      if (!value || !supportsRightSidebarFormattedPreview(extension)) return '';
      if (/^https?:\/\//i.test(value)) return '';
      if (value.indexOf('/api/local-file/preview') === 0) {
        try {
          value = new URL(value, window.location.origin).searchParams.get('path') || '';
        } catch (e) {
          return '';
        }
      }
      if (!value || value.indexOf('/api/') === 0) return '';
      return addOutputPreviewVersion(appendOutputPreviewWorkspaceRoot(
        '/api/local-file/formatted-preview?path=' + encodeURIComponent(value) + '&latest=1',
        workspaceRoot
      ));
    }

    function teardownRightSidebarImageZoom() {
      if (rightSidebarImagePanCleanup) {
        rightSidebarImagePanCleanup();
        rightSidebarImagePanCleanup = null;
      }
      if (rightSidebarImageResizeObserver) {
        rightSidebarImageResizeObserver.disconnect();
        rightSidebarImageResizeObserver = null;
      }
      if (rightSidebarImageResizeFrame) {
        cancelAnimationFrame(rightSidebarImageResizeFrame);
        rightSidebarImageResizeFrame = 0;
      }
    }

    function releaseRightSidebarImagePreview(state) {
      teardownRightSidebarImageZoom();
      var targetState = state || rightSidebarFilePreviewState;
      if (!targetState || !targetState.imageObjectUrl) return;
      try { URL.revokeObjectURL(targetState.imageObjectUrl); } catch (e) {}
      targetState.imageObjectUrl = '';
      targetState.imageDisplayUrl = '';
    }

    function optimizeImageInWorker(arrayBuffer, mimeType, options) {
      if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') {
        return Promise.reject(new Error('当前环境不支持后台图像缩放'));
      }
      options = options || {};
      var maxEdge = Math.max(320, Number(options.maxEdge || 1400));
      var maxPixels = Math.max(240000, Number(options.maxPixels || 1800000));
      var quality = Math.max(0.6, Math.min(0.95, Number(options.quality || 0.88)));
      return new Promise(function(resolve, reject) {
        var workerSource = [
          'self.onmessage=async function(event){',
          'try{',
          'var input=event.data||{};',
          'var blob=new Blob([input.buffer],{type:input.mime||"image/png"});',
          'var bitmap=await createImageBitmap(blob);',
          'var width=bitmap.width||1;var height=bitmap.height||1;',
          'var edgeScale=Math.min(1,input.maxEdge/Math.max(width,height));',
          'var pixelScale=Math.min(1,Math.sqrt(input.maxPixels/Math.max(1,width*height)));',
          'var scale=Math.min(edgeScale,pixelScale);',
          'var outputWidth=Math.max(1,Math.round(width*scale));',
          'var outputHeight=Math.max(1,Math.round(height*scale));',
          'var canvas=new OffscreenCanvas(outputWidth,outputHeight);',
          'var context=canvas.getContext("2d",{alpha:true});',
          'context.drawImage(bitmap,0,0,outputWidth,outputHeight);bitmap.close();',
          'var output=await canvas.convertToBlob({type:"image/webp",quality:input.quality});',
          'var outputBuffer=await output.arrayBuffer();',
          'self.postMessage({ok:true,buffer:outputBuffer,mime:output.type,width:outputWidth,height:outputHeight},[outputBuffer]);',
          '}catch(error){self.postMessage({ok:false,error:String(error&&error.message||error)});}',
          '};'
        ].join('');
        var workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
        var worker;
        try {
          worker = new Worker(workerUrl);
        } catch (error) {
          URL.revokeObjectURL(workerUrl);
          reject(error);
          return;
        }
        URL.revokeObjectURL(workerUrl);
        worker.onmessage = function(event) {
          worker.terminate();
          var payload = event.data || {};
          if (!payload.ok || !payload.buffer) {
            reject(new Error(payload.error || '后台图像缩放失败'));
            return;
          }
          resolve(payload);
        };
        worker.onerror = function(event) {
          worker.terminate();
          reject(new Error(event.message || '后台图像缩放失败'));
        };
        worker.postMessage({
          buffer: arrayBuffer,
          mime: mimeType || 'image/png',
          maxEdge: maxEdge,
          maxPixels: maxPixels,
          quality: quality
        }, [arrayBuffer]);
      });
    }

    function optimizeRightSidebarImageInWorker(arrayBuffer, mimeType) {
      return optimizeImageInWorker(arrayBuffer, mimeType, {
        maxEdge: 1400,
        maxPixels: 1800000,
        quality: 0.88
      });
    }

    function optimizeOutputAttachmentThumbnailInWorker(arrayBuffer, mimeType) {
      return optimizeImageInWorker(arrayBuffer, mimeType, {
        maxEdge: 640,
        maxPixels: 400000,
        quality: 0.82
      });
    }

    async function loadRightSidebarOptimizedImage(stateId) {
      var state = rightSidebarFilePreviewState;
      if (!state || state.id !== stateId || !state.previewUrl) return;
      var requestId = ++rightSidebarFilePreviewRequestId;
      try {
        var response = await fetch(state.previewUrl, { method: 'GET', cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var sourceBlob = await response.blob();
        var sourceBuffer = await sourceBlob.arrayBuffer();
        var detectedMime = detectOutputAttachmentImageMime(sourceBuffer, sourceBlob.type);
        if (!detectedMime) throw new Error('服务端返回的内容不是图片');
        var normalizedSource = sourceBlob.type === detectedMime
          ? sourceBlob
          : new Blob([sourceBlob], { type: detectedMime });
        var displayBlob = normalizedSource;
        if (!shouldKeepOriginalOutputImage(detectedMime)) {
          try {
            var optimized = await optimizeRightSidebarImageInWorker(sourceBuffer, detectedMime);
            displayBlob = new Blob([optimized.buffer], { type: optimized.mime || detectedMime });
          } catch (optimizationError) {
            console.warn('[RightSidebarPreview] Image optimization failed; using original image:', optimizationError);
          }
        }
        if (!rightSidebarFilePreviewState || rightSidebarFilePreviewState.id !== stateId || requestId !== rightSidebarFilePreviewRequestId) return;
        releaseRightSidebarImagePreview(rightSidebarFilePreviewState);
        rightSidebarFilePreviewState.imageObjectUrl = URL.createObjectURL(displayBlob);
        rightSidebarFilePreviewState.imageDisplayUrl = rightSidebarFilePreviewState.imageObjectUrl;
        rightSidebarFilePreviewState.imageLoading = false;
      } catch (error) {
        if (!rightSidebarFilePreviewState || rightSidebarFilePreviewState.id !== stateId || requestId !== rightSidebarFilePreviewRequestId) return;
        rightSidebarFilePreviewState.imageLoading = false;
        rightSidebarFilePreviewState.error = '图片预览失败：' + (error.message || error);
      }
      renderRightSidebarFilePreviewPanel();
    }

    function getRightSidebarOutputPreviewUrl(target, fallbackUrl, workspaceRoot) {
      var value = String(target || '').trim();
      if (value && !/^https?:\/\//i.test(value) && value.indexOf('/api/') !== 0) {
        return addOutputPreviewVersion(appendOutputPreviewWorkspaceRoot(
          '/api/local-file/preview?path=' + encodeURIComponent(value) + '&latest=1',
          workspaceRoot
        ));
      }
      return value ? getOutputAttachmentPreviewUrl(value, workspaceRoot) : String(fallbackUrl || '');
    }

    function normalizeRightSidebarPreviewText(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function restoreRightSidebarFormattedPreviewPosition(frame, state) {
      var locator = state && state.returnPreviewLocator;
      if (!locator || locator.type !== 'word-text' || !frame) return;
      try {
        var doc = frame.contentDocument;
        if (!doc) return;
        var blocks = Array.from(doc.querySelectorAll('.word-page p, .word-page h1, .word-page h2, .word-page h3, .word-page li, .word-page td, .word-page th'));
        var matchingBlocks = blocks.filter(function(element) {
          return normalizeRightSidebarPreviewText(element.textContent) === locator.text;
        });
        var target = matchingBlocks[Math.max(0, Number(locator.occurrence || 1) - 1)]
          || matchingBlocks[0]
          || blocks[Math.max(0, Number(locator.paragraphIndex || 0))]
          || null;
        if (!target) return;
        requestAnimationFrame(function() {
          requestAnimationFrame(function() {
            target.scrollIntoView({ block: 'center', inline: 'nearest' });
          });
        });
        state.returnPreviewLocator = null;
      } catch (error) {
        console.warn('[RightSidebarPreview] Failed to restore preview position:', error);
      }
    }

    var rightSidebarPreviewSelectionAskState = null;

    function hideRightSidebarPreviewSelectionAsk() {
      rightSidebarPreviewSelectionAskState = null;
      var bubble = document.getElementById('rightSidebarPreviewSelectionAsk');
      if (bubble && bubble.parentNode) bubble.parentNode.removeChild(bubble);
    }
    window.hideRightSidebarPreviewSelectionAsk = hideRightSidebarPreviewSelectionAsk;

    function placeRightSidebarPreviewSelectionInChat() {
      var selected = rightSidebarPreviewSelectionAskState;
      if (!selected || !selected.text || !userInput) return;
      var prompt = [
        '【文件预览选段】',
        '文件路径：' + (selected.path || selected.name || '当前预览文件'),
        '选中文本：',
        selected.text,
        '',
        '我的问题：'
      ].join('\n');
      var existing = String(userInput.value || '').trim();
      userInput.value = existing ? existing + '\n\n' + prompt : prompt;
      userInput.dispatchEvent(new Event('input', { bubbles: true }));
      hideRightSidebarPreviewSelectionAsk();
      userInput.focus({ preventScroll: true });
      try {
        userInput.setSelectionRange(userInput.value.length, userInput.value.length);
      } catch (error) {}
      userInput.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    window.placeRightSidebarPreviewSelectionInChat = placeRightSidebarPreviewSelectionInChat;

    function showRightSidebarPreviewSelectionAsk(selection, frame) {
      var state = rightSidebarFilePreviewState;
      if (!state || state.editing || state.officeEditing || !selection || selection.rangeCount < 1) {
        hideRightSidebarPreviewSelectionAsk();
        return;
      }
      var text = String(selection.toString() || '').replace(/\s+/g, ' ').trim();
      if (!text) {
        hideRightSidebarPreviewSelectionAsk();
        return;
      }
      if (text.length > 8000) text = text.slice(0, 8000) + '…';
      var rangeRect = selection.getRangeAt(0).getBoundingClientRect();
      if (!rangeRect || (!rangeRect.width && !rangeRect.height)) return;
      var offsetLeft = 0;
      var offsetTop = 0;
      if (frame) {
        var frameRect = frame.getBoundingClientRect();
        offsetLeft = frameRect.left;
        offsetTop = frameRect.top;
      }
      hideRightSidebarPreviewSelectionAsk();
      rightSidebarPreviewSelectionAskState = {
        text: text,
        path: String(state.path || ''),
        name: String(state.name || '')
      };
      var bubble = document.createElement('button');
      bubble.type = 'button';
      bubble.id = 'rightSidebarPreviewSelectionAsk';
      bubble.className = 'right-sidebar-preview-selection-ask';
      bubble.textContent = '询问 AI';
      bubble.setAttribute('aria-label', '将选中文本发送到主页输入框询问 AI');
      bubble.addEventListener('click', placeRightSidebarPreviewSelectionInChat);
      document.body.appendChild(bubble);
      var bubbleWidth = Math.max(76, bubble.offsetWidth || 76);
      var bubbleHeight = Math.max(34, bubble.offsetHeight || 34);
      var left = offsetLeft + rangeRect.left + rangeRect.width / 2 - bubbleWidth / 2;
      var top = offsetTop + rangeRect.bottom + 8;
      left = Math.max(8, Math.min(window.innerWidth - bubbleWidth - 8, left));
      if (top + bubbleHeight > window.innerHeight - 8) {
        top = offsetTop + rangeRect.top - bubbleHeight - 8;
      }
      bubble.style.left = Math.max(8, left) + 'px';
      bubble.style.top = Math.max(8, top) + 'px';
    }

    function bindRightSidebarPreviewSelectionDocument(doc, frame) {
      if (!doc || doc.__scholarHarnessSelectionAskBound) return;
      doc.__scholarHarnessSelectionAskBound = true;
      var revealSelectionAction = function() {
        setTimeout(function() {
          try {
            showRightSidebarPreviewSelectionAsk(doc.getSelection && doc.getSelection(), frame || null);
          } catch (error) {
            hideRightSidebarPreviewSelectionAsk();
          }
        }, 0);
      };
      doc.addEventListener('mouseup', revealSelectionAction);
      doc.addEventListener('keyup', revealSelectionAction);
      doc.addEventListener('scroll', hideRightSidebarPreviewSelectionAsk, true);
    }

    function setupRightSidebarPreviewSelection() {
      var panel = document.getElementById('rightSidebarFilePreviewPanel');
      if (!panel || panel.__scholarHarnessSelectionAskBound) return;
      panel.__scholarHarnessSelectionAskBound = true;
      panel.addEventListener('mouseup', function(event) {
        var previewText = event.target && event.target.closest
          ? event.target.closest('.right-sidebar-file-preview-text')
          : null;
        if (!previewText) return;
        showRightSidebarPreviewSelectionAsk(window.getSelection && window.getSelection(), null);
      });
      panel.addEventListener('scroll', hideRightSidebarPreviewSelectionAsk, true);
    }

    function setupRightSidebarFormattedPreviewInteraction(frame) {
      var state = rightSidebarFilePreviewState;
      if (!state || !frame) return;
      try {
        var doc = frame.contentDocument;
        if (!doc) return;
        bindRightSidebarPreviewSelectionDocument(doc, frame);
        if (!supportsRightSidebarTextEditing(state.extension)
            && ['docx', 'xls', 'xlsx'].indexOf(state.extension) === -1) return;
        if (doc.__scholarHarnessDoubleClickBound) return;
        restoreRightSidebarFormattedPreviewPosition(frame, state);
        doc.__scholarHarnessDoubleClickBound = true;
        doc.documentElement.style.cursor = 'default';
        doc.addEventListener('dblclick', function(event) {
          var currentState = rightSidebarFilePreviewState;
          if (!currentState || currentState.editing || currentState.officeEditing) return;
          var target = event.target && event.target.closest ? event.target : null;
          if (currentState.extension === 'docx') {
            var block = target && target.closest('.word-page p, .word-page h1, .word-page h2, .word-page h3, .word-page li, .word-page td, .word-page th');
            var text = normalizeRightSidebarPreviewText(block && block.textContent);
            var occurrence = 0;
            if (block && text) {
              var blocks = Array.from(doc.querySelectorAll('.word-page p, .word-page h1, .word-page h2, .word-page h3, .word-page li, .word-page td, .word-page th'));
              for (var i = 0; i < blocks.length; i++) {
                if (normalizeRightSidebarPreviewText(blocks[i].textContent) === text) occurrence += 1;
                if (blocks[i] === block) break;
              }
            }
            currentState.pendingEditLocator = { type: 'word-text', text: text, occurrence: Math.max(1, occurrence) };
            beginRightSidebarOfficeEdit(true);
          } else if (currentState.extension === 'xls' || currentState.extension === 'xlsx') {
            var cell = target && target.closest('.sheet-grid td');
            var row = cell && cell.parentElement;
            if (!cell || !row) return;
            var rowNumber = Number(row.querySelector('.row-number') && row.querySelector('.row-number').textContent || 0);
            var cellIndex = Array.from(row.querySelectorAll('td')).indexOf(cell);
            var activeTab = doc.querySelector('.sheet-tab.active');
            currentState.pendingEditLocator = {
              type: 'excel-cell',
              sheet: normalizeRightSidebarPreviewText(activeTab && activeTab.textContent),
              address: excelColumnName(Math.max(0, cellIndex)) + Math.max(1, rowNumber)
            };
            beginRightSidebarOfficeEdit(true);
          } else {
            var line = target && target.closest('.code-lines li');
            var lineIndex = line && line.parentElement ? Array.from(line.parentElement.children).indexOf(line) : 0;
            currentState.pendingEditLocator = { type: 'text-line', line: Math.max(0, lineIndex) };
            beginRightSidebarFileEdit(true);
          }
          event.preventDefault();
        });
      } catch (error) {
        console.warn('[RightSidebarPreview] Failed to attach double-click editor interaction:', error);
      }
    }
    window.setupRightSidebarFormattedPreviewInteraction = setupRightSidebarFormattedPreviewInteraction;

    function beginRightSidebarTextEditAtPointer(event) {
      var state = rightSidebarFilePreviewState;
      if (!state || !supportsRightSidebarTextEditing(state.extension)) return;
      var pre = event && event.currentTarget;
      var offset = 0;
      try {
        var doc = pre && pre.ownerDocument;
        var caret = doc && doc.caretRangeFromPoint
          ? doc.caretRangeFromPoint(event.clientX, event.clientY)
          : null;
        if (caret && pre.contains(caret.startContainer)) {
          var range = doc.createRange();
          range.selectNodeContents(pre);
          range.setEnd(caret.startContainer, caret.startOffset);
          offset = range.toString().length;
        }
      } catch (e) {}
      state.pendingEditLocator = { type: 'text-offset', offset: Math.max(0, offset) };
      beginRightSidebarFileEdit(true);
    }
    window.beginRightSidebarTextEditAtPointer = beginRightSidebarTextEditAtPointer;

    function clampRightSidebarImageZoom(zoom) {
      return Math.max(RIGHT_SIDEBAR_IMAGE_MIN_ZOOM, Math.min(RIGHT_SIDEBAR_IMAGE_MAX_ZOOM, Number(zoom) || 1));
    }

    function getRightSidebarImageZoomElements() {
      var panel = document.getElementById('rightSidebarFilePreviewPanel');
      if (!panel) return null;
      var viewport = panel.querySelector('.right-sidebar-file-preview-image-viewport');
      var stage = panel.querySelector('.right-sidebar-file-preview-image-stage');
      var image = panel.querySelector('.right-sidebar-file-preview-image');
      return viewport && stage && image ? { viewport: viewport, stage: stage, image: image } : null;
    }

    function getRightSidebarImageZoomAnchor(image, clientX, clientY) {
      var elements = getRightSidebarImageZoomElements();
      if (!elements || elements.image !== image) return null;
      var imageRect = image.getBoundingClientRect();
      var viewportRect = elements.viewport.getBoundingClientRect();
      if (!imageRect.width || !imageRect.height) return null;
      return {
        imageX: Math.max(0, Math.min(1, (clientX - imageRect.left) / imageRect.width)),
        imageY: Math.max(0, Math.min(1, (clientY - imageRect.top) / imageRect.height)),
        viewportX: Math.max(0, Math.min(viewportRect.width, clientX - viewportRect.left)),
        viewportY: Math.max(0, Math.min(viewportRect.height, clientY - viewportRect.top))
      };
    }

    function updateRightSidebarImageZoomLabel(zoom) {
      var resetButton = document.getElementById('rightSidebarImageZoomReset');
      if (!resetButton) return;
      resetButton.textContent = Math.round(clampRightSidebarImageZoom(zoom) * 100) + '%';
    }

    function applyRightSidebarImageZoomLayout(image, anchor) {
      var state = rightSidebarFilePreviewState;
      var elements = getRightSidebarImageZoomElements();
      if (!state || state.kind !== 'image' || !elements || elements.image !== image || !image.naturalWidth || !image.naturalHeight) return;
      var viewport = elements.viewport;
      var stage = elements.stage;
      var viewportWidth = Math.max(1, viewport.clientWidth);
      var viewportHeight = Math.max(1, viewport.clientHeight);
      var availableWidth = Math.max(1, viewportWidth - 24);
      var availableHeight = Math.max(1, viewportHeight - 24);
      var fitScale = Math.min(availableWidth / image.naturalWidth, availableHeight / image.naturalHeight);
      if (!Number.isFinite(fitScale) || fitScale <= 0) fitScale = 1;
      var fitWidth = Math.max(1, image.naturalWidth * fitScale);
      var fitHeight = Math.max(1, image.naturalHeight * fitScale);
      var zoom = clampRightSidebarImageZoom(state.imageZoom);
      var imageWidth = Math.max(1, fitWidth * zoom);
      var imageHeight = Math.max(1, fitHeight * zoom);
      var stageWidth = Math.max(viewportWidth, Math.ceil(imageWidth + 24));
      var stageHeight = Math.max(viewportHeight, Math.ceil(imageHeight + 24));
      var imageLeft = Math.max(12, (stageWidth - imageWidth) / 2);
      var imageTop = Math.max(12, (stageHeight - imageHeight) / 2);

      stage.style.width = stageWidth + 'px';
      stage.style.height = stageHeight + 'px';
      image.style.left = imageLeft + 'px';
      image.style.top = imageTop + 'px';
      image.style.width = imageWidth + 'px';
      image.style.height = imageHeight + 'px';
      viewport.classList.toggle(
        'is-right-pannable',
        stageWidth > viewportWidth + 1 || stageHeight > viewportHeight + 1
      );

      state.imageZoom = zoom;
      state.imagePreviewViewportWidth = viewport.clientWidth;
      state.imagePreviewViewportHeight = viewport.clientHeight;
      updateRightSidebarImageZoomLabel(zoom);

      if (anchor) {
        viewport.scrollLeft = imageLeft + anchor.imageX * imageWidth - anchor.viewportX;
        viewport.scrollTop = imageTop + anchor.imageY * imageHeight - anchor.viewportY;
      }
    }

    function handleRightSidebarImageZoomWheel(event) {
      var state = rightSidebarFilePreviewState;
      var elements = getRightSidebarImageZoomElements();
      if (!state || state.kind !== 'image' || !elements || !event.deltaY) return;
      event.preventDefault();
      var anchor = getRightSidebarImageZoomAnchor(elements.image, event.clientX, event.clientY);
      var currentZoom = clampRightSidebarImageZoom(state.imageZoom);
      var zoomFactor = event.deltaY < 0 ? RIGHT_SIDEBAR_IMAGE_ZOOM_STEP : 1 / RIGHT_SIDEBAR_IMAGE_ZOOM_STEP;
      var nextZoom = clampRightSidebarImageZoom(currentZoom * zoomFactor);
      if (Math.abs(nextZoom - currentZoom) < 0.0001) return;
      state.imageZoom = nextZoom;
      applyRightSidebarImageZoomLayout(elements.image, anchor);
    }

    function resetRightSidebarImageZoom() {
      var state = rightSidebarFilePreviewState;
      var elements = getRightSidebarImageZoomElements();
      if (!state || state.kind !== 'image' || !elements) return;
      var viewportRect = elements.viewport.getBoundingClientRect();
      var anchor = getRightSidebarImageZoomAnchor(
        elements.image,
        viewportRect.left + viewportRect.width / 2,
        viewportRect.top + viewportRect.height / 2
      );
      state.imageZoom = 1;
      applyRightSidebarImageZoomLayout(elements.image, anchor);
    }
    window.resetRightSidebarImageZoom = resetRightSidebarImageZoom;

    function setupRightSidebarImageButtonPan(elements) {
      var viewport = elements && elements.viewport;
      var image = elements && elements.image;
      if (!viewport || !image) return function() {};
      var activePointerId = null;
      var activeButtonMask = 0;
      var lastClientX = 0;
      var lastClientY = 0;

      var finishPan = function(event) {
        if (activePointerId === null) return;
        if (event && event.pointerId !== undefined && event.pointerId !== activePointerId) return;
        try {
          if (viewport.hasPointerCapture && viewport.hasPointerCapture(activePointerId)) {
            viewport.releasePointerCapture(activePointerId);
          }
        } catch (e) {}
        activePointerId = null;
        activeButtonMask = 0;
        viewport.classList.remove('is-right-panning');
      };
      var handlePointerDown = function(event) {
        if (event.button !== 0 && event.button !== 2) return;
        var canPan = viewport.scrollWidth > viewport.clientWidth + 1
          || viewport.scrollHeight > viewport.clientHeight + 1;
        if (!canPan) return;
        event.preventDefault();
        event.stopPropagation();
        activePointerId = event.pointerId;
        activeButtonMask = event.button === 2 ? 2 : 1;
        lastClientX = event.clientX;
        lastClientY = event.clientY;
        viewport.classList.add('is-right-panning');
        try { viewport.setPointerCapture(event.pointerId); } catch (e) {}
      };
      var handlePointerMove = function(event) {
        if (activePointerId === null || event.pointerId !== activePointerId) return;
        if ((event.buttons & activeButtonMask) !== activeButtonMask) {
          finishPan(event);
          return;
        }
        var deltaX = event.clientX - lastClientX;
        var deltaY = event.clientY - lastClientY;
        lastClientX = event.clientX;
        lastClientY = event.clientY;
        viewport.scrollLeft -= deltaX;
        viewport.scrollTop -= deltaY;
        event.preventDefault();
      };
      var suppressContextMenu = function(event) {
        if (event.target === image || image.contains(event.target) || viewport.contains(event.target)) {
          event.preventDefault();
        }
      };

      viewport.addEventListener('pointerdown', handlePointerDown);
      viewport.addEventListener('pointermove', handlePointerMove);
      viewport.addEventListener('pointerup', finishPan);
      viewport.addEventListener('pointercancel', finishPan);
      viewport.addEventListener('lostpointercapture', finishPan);
      viewport.addEventListener('contextmenu', suppressContextMenu);
      return function() {
        finishPan();
        viewport.removeEventListener('pointerdown', handlePointerDown);
        viewport.removeEventListener('pointermove', handlePointerMove);
        viewport.removeEventListener('pointerup', finishPan);
        viewport.removeEventListener('pointercancel', finishPan);
        viewport.removeEventListener('lostpointercapture', finishPan);
        viewport.removeEventListener('contextmenu', suppressContextMenu);
        viewport.classList.remove('is-right-pannable', 'is-right-panning');
      };
    }

    function setupRightSidebarImageZoom() {
      teardownRightSidebarImageZoom();
      var state = rightSidebarFilePreviewState;
      var elements = getRightSidebarImageZoomElements();
      if (!state || state.kind !== 'image' || !elements) return;
      if (!Number.isFinite(Number(state.imageZoom))) state.imageZoom = 1;
      elements.viewport.addEventListener('wheel', handleRightSidebarImageZoomWheel, { passive: false });
      rightSidebarImagePanCleanup = setupRightSidebarImageButtonPan(elements);
      var initialize = function() {
        if (!elements.image.isConnected) return;
        applyRightSidebarImageZoomLayout(elements.image, null);
      };
      if (elements.image.complete && elements.image.naturalWidth) {
        initialize();
      } else {
        elements.image.addEventListener('load', initialize, { once: true });
      }
      if (typeof ResizeObserver === 'function') {
        rightSidebarImageResizeObserver = new ResizeObserver(function() {
          if (rightSidebarImageResizeFrame) cancelAnimationFrame(rightSidebarImageResizeFrame);
          rightSidebarImageResizeFrame = requestAnimationFrame(function() {
            rightSidebarImageResizeFrame = 0;
            if (!elements.image.isConnected || !rightSidebarFilePreviewState) return;
            var width = elements.viewport.clientWidth;
            var height = elements.viewport.clientHeight;
            if (width === rightSidebarFilePreviewState.imagePreviewViewportWidth && height === rightSidebarFilePreviewState.imagePreviewViewportHeight) return;
            var viewportRect = elements.viewport.getBoundingClientRect();
            var anchor = getRightSidebarImageZoomAnchor(
              elements.image,
              viewportRect.left + viewportRect.width / 2,
              viewportRect.top + viewportRect.height / 2
            );
            applyRightSidebarImageZoomLayout(elements.image, anchor);
          });
        });
        rightSidebarImageResizeObserver.observe(elements.viewport);
      }
    }

    function renderRightSidebarFilePreviewPanel() {
      var panel = document.getElementById('rightSidebarFilePreviewPanel');
      if (!panel) return;
      hideRightSidebarPreviewSelectionAsk();
      teardownRightSidebarImageZoom();
      var state = rightSidebarFilePreviewState;
      if (!state) {
        panel.innerHTML = '<div class="right-sidebar-file-preview-empty">请选择 AI 输出的图片或文件进行预览。</div>';
        return;
      }
      var localTarget = state.path && !/^https?:\/\//i.test(state.path) && state.path.indexOf('/api/') !== 0;
      var editableText = localTarget && supportsRightSidebarTextEditing(state.extension);
      var editableOffice = localTarget && ['docx', 'xls', 'xlsx'].indexOf(state.extension) !== -1;
      var imagePreviewReady = state.kind === 'image' && !!state.previewUrl && !!state.imageDisplayUrl && !state.error;
      var imageNavigationItems = Array.isArray(state.imageNavigationItems) ? state.imageNavigationItems : [];
      var imageNavigationIndex = Math.max(0, Math.min(
        Math.max(0, imageNavigationItems.length - 1),
        Number(state.imageNavigationIndex || 0)
      ));
      var imageNavigationHtml = imagePreviewReady && imageNavigationItems.length > 1
        ? '<button type="button" class="right-sidebar-file-preview-image-nav previous" onclick="navigateRightSidebarImage(-1)" ' +
            (imageNavigationIndex <= 0 ? 'disabled ' : '') +
            'title="上一张图片" aria-label="上一张图片">‹</button>' +
          '<button type="button" class="right-sidebar-file-preview-image-nav next" onclick="navigateRightSidebarImage(1)" ' +
            (imageNavigationIndex >= imageNavigationItems.length - 1 ? 'disabled ' : '') +
            'title="下一张图片" aria-label="下一张图片">›</button>'
        : '';
      var toolbar = '<div class="right-sidebar-file-preview-toolbar">' +
        '<span class="right-sidebar-file-preview-path" title="' + escapeHtml(state.path || state.name || '') + '">' + escapeHtml(state.path || state.name || '') + '</span>' +
        (state.editing || state.officeEditing
          ? '<span class="right-sidebar-file-preview-save-state' + (state.saveError ? ' error' : (state.dirty ? ' dirty' : '')) + '" id="rightSidebarFileSaveState">' +
              escapeHtml(state.saveError || (state.saving ? '保存中…' : (state.dirty ? '未保存' : '已保存'))) +
            '</span>' +
            '<button type="button" class="right-sidebar-file-preview-action primary" id="rightSidebarFileSaveButton" onclick="saveRightSidebarActiveEdit()" ' + (!state.dirty || state.saving ? 'disabled' : '') + '>保存</button>' +
            '<button type="button" class="right-sidebar-file-preview-action" onclick="cancelRightSidebarActiveEdit()">取消</button>'
          : (editableText
            ? '<button type="button" class="right-sidebar-file-preview-action primary" onclick="beginRightSidebarFileEdit()">编辑</button>'
            : (editableOffice
              ? '<button type="button" class="right-sidebar-file-preview-action primary" onclick="beginRightSidebarOfficeEdit()">编辑</button>' +
                '<button type="button" class="right-sidebar-file-preview-action" onclick="askAiToModifyRightSidebarFile()">交给 AI 修改</button>'
              : (localTarget && ['doc', 'ppt', 'pptx'].indexOf(state.extension) !== -1
                ? '<button type="button" class="right-sidebar-file-preview-action primary" onclick="askAiToModifyRightSidebarFile()">交给 AI 修改</button>'
                : '')))) +
        (imagePreviewReady
          ? '<button type="button" class="right-sidebar-file-preview-action" id="rightSidebarImageZoomReset" onclick="resetRightSidebarImageZoom()" title="鼠标滚轮缩放；放大后按住左键或右键拖动；点击恢复适应窗口">' + Math.round(clampRightSidebarImageZoom(state.imageZoom) * 100) + '%</button>'
          : '') +
        (localTarget
          ? '<button type="button" class="right-sidebar-file-preview-action" data-file-path="' + escapeHtml(state.path) + '" onclick="openOutputAttachmentFolder(this)">所在文件夹</button>'
          : '') +
        '<button type="button" class="right-sidebar-file-preview-action" onclick="closeRightSidebarFilePreview()">关闭</button>' +
      '</div>';
      var body = '';
      if (state.error) {
        body = '<div class="right-sidebar-file-preview-empty">' +
          outputAttachmentIcon(state.kind, state.name) +
          '<strong>' + escapeHtml(state.name || '文件') + '</strong>' +
          '<span>' + escapeHtml(state.error) + '</span>' +
        '</div>';
      } else if (state.officeEditing) {
        if (state.officeEditorData) {
          body = state.extension === 'docx'
            ? renderRightSidebarWordEditor(state)
            : renderRightSidebarExcelEditor(state);
        } else {
          body = '<div class="right-sidebar-file-preview-empty">正在加载可编辑内容…</div>';
          if (!state.loading) {
            state.loading = true;
            setTimeout(function() { loadRightSidebarOfficeEditor(state.id); }, 0);
          }
        }
      } else if (state.editing) {
        if (typeof state.textContent === 'string') {
          body = '<textarea class="right-sidebar-file-preview-editor" id="rightSidebarFileEditor" spellcheck="false" aria-label="编辑 ' + escapeHtml(state.name || '文件') + '" oninput="handleRightSidebarFileEditInput(this)">' + escapeHtml(state.textContent) + '</textarea>';
        } else {
          body = '<div class="right-sidebar-file-preview-empty">正在加载完整文本…</div>';
          if (!state.loading) {
            state.loading = true;
            setTimeout(function() { loadRightSidebarFilePreviewText(state.id); }, 0);
          }
        }
      } else if (state.kind === 'image' && state.previewUrl) {
        if (state.imageDisplayUrl) {
          body = '<div class="right-sidebar-file-preview-image-stage"><img class="right-sidebar-file-preview-image" src="' + escapeHtml(state.imageDisplayUrl) + '" alt="' + escapeHtml(state.name || '图片预览') + '" decoding="async" draggable="false" onerror="handleRightSidebarFilePreviewMediaError(this)"></div>';
        } else {
          body = '<div class="right-sidebar-file-preview-empty">正在后台生成流畅预览...</div>';
          if (!state.imageLoading) {
            state.imageLoading = true;
            setTimeout(function() { loadRightSidebarOptimizedImage(state.id); }, 0);
          }
        }
      } else if (state.kind === 'pdf' && state.previewUrl) {
        body = '<iframe class="right-sidebar-file-preview-frame" src="' + escapeHtml(state.previewUrl) + '" title="' + escapeHtml(state.name || 'PDF 预览') + '" loading="lazy"></iframe>';
      } else if (state.formattedPreviewUrl) {
        body = '<iframe class="right-sidebar-file-preview-frame" src="' + escapeHtml(state.formattedPreviewUrl) + '" title="' + escapeHtml(state.name || '格式化文件预览') + '" sandbox="allow-same-origin" loading="eager" onload="setupRightSidebarFormattedPreviewInteraction(this)"></iframe>';
      } else if (isRightSidebarTextPreviewKind(state.kind, state.extension)) {
        if (typeof state.textContent === 'string') {
          body = '<pre class="right-sidebar-file-preview-text" ondblclick="beginRightSidebarTextEditAtPointer(event)">' + escapeHtml(state.textContent) + '</pre>';
        } else if (state.loading) {
          body = '<div class="right-sidebar-file-preview-empty">正在读取 ' + escapeHtml(state.name || '文件') + '...</div>';
        } else {
          state.loading = true;
          body = '<div class="right-sidebar-file-preview-empty">正在读取 ' + escapeHtml(state.name || '文件') + '...</div>';
          setTimeout(function() { loadRightSidebarFilePreviewText(state.id); }, 0);
        }
      } else {
        body = '<div class="right-sidebar-file-preview-empty">' +
          outputAttachmentIcon(state.kind, state.name) +
          '<strong>' + escapeHtml(state.name || '文件') + '</strong>' +
          '<span>该格式暂不能直接渲染，但文件已在右侧栏中定位，不会自动打开新窗口。</span>' +
        '</div>';
      }
      panel.innerHTML = toolbar +
        '<div class="right-sidebar-file-preview-viewport' + (imagePreviewReady ? ' right-sidebar-file-preview-image-viewport' : '') + '">' + body + '</div>' +
        imageNavigationHtml;
      setupRightSidebarPreviewSelection();
      if (imagePreviewReady) setupRightSidebarImageZoom();
      if (state.editing && typeof state.textContent === 'string') {
        var editor = document.getElementById('rightSidebarFileEditor');
        if (editor && state.focusEditor) {
          state.focusEditor = false;
          editor.focus();
          var textLocator = state.pendingEditLocator;
          if (textLocator && (textLocator.type === 'text-line' || textLocator.type === 'text-offset')) {
            var offset = Number(textLocator.offset || 0);
            if (textLocator.type === 'text-line') {
              var lines = String(state.textContent || '').split('\n');
              offset = 0;
              for (var lineIndex = 0; lineIndex < Math.min(Number(textLocator.line || 0), lines.length); lineIndex += 1) {
                offset += lines[lineIndex].length + 1;
              }
            }
            offset = Math.max(0, Math.min(editor.value.length, offset));
            editor.setSelectionRange(offset, offset);
            var targetLine = editor.value.slice(0, offset).split('\n').length - 1;
            editor.scrollTop = Math.max(0, targetLine * 19.5 - editor.clientHeight * 0.42);
            state.pendingEditLocator = null;
          }
        }
      }
      if (state.officeEditing && state.officeEditorData && state.focusOfficeEditor) {
        state.focusOfficeEditor = false;
        var officeLocator = state.pendingEditLocator;
        var officeEditor = null;
        if (officeLocator && officeLocator.type === 'excel-cell') {
          if (officeLocator.sheet) state.activeOfficeSheet = officeLocator.sheet;
          officeEditor = panel.querySelector(
            '.right-sidebar-excel-cell[data-sheet="' + CSS.escape(String(officeLocator.sheet || state.activeOfficeSheet || '')) +
            '"][data-address="' + CSS.escape(String(officeLocator.address || 'A1')) + '"]'
          );
        } else if (officeLocator && officeLocator.type === 'word-text') {
          var matchingParagraphs = Array.from(panel.querySelectorAll('.right-sidebar-word-paragraph')).filter(function(element) {
            return normalizeRightSidebarPreviewText(element.textContent) === officeLocator.text;
          });
          officeEditor = matchingParagraphs[Math.max(0, Number(officeLocator.occurrence || 1) - 1)] || matchingParagraphs[0] || null;
        }
        if (!officeEditor) officeEditor = panel.querySelector('.right-sidebar-word-paragraph, .right-sidebar-excel-cell');
        if (officeEditor) {
          officeEditor.focus();
          officeEditor.scrollIntoView({ block: 'center', inline: 'center' });
          if (state.extension === 'docx') {
            state.lastOfficeEditParagraphIndex = Number(officeEditor.getAttribute('data-paragraph-index'));
          }
        }
        state.pendingEditLocator = null;
      }
    }
    window.renderRightSidebarFilePreviewPanel = renderRightSidebarFilePreviewPanel;

    async function loadRightSidebarFilePreviewText(stateId) {
      var state = rightSidebarFilePreviewState;
      if (!state || state.id !== stateId || !state.previewUrl) return;
      var requestId = ++rightSidebarFilePreviewRequestId;
      try {
        var response = await fetch(state.previewUrl, {
          method: 'GET',
          headers: { Range: 'bytes=0-2097151' }
        });
        if (!response.ok && response.status !== 206) throw new Error('HTTP ' + response.status);
        var contentRange = String(response.headers.get('Content-Range') || '');
        var totalMatch = contentRange.match(/\/(\d+)$/);
        var totalBytes = totalMatch ? Number(totalMatch[1]) : Number(response.headers.get('Content-Length') || 0);
        if (Number.isFinite(totalBytes) && totalBytes > 2097152) {
          throw new Error('文件超过 2 MB，为避免截断原文件，侧栏不允许直接编辑');
        }
        var content = await response.text();
        if (!rightSidebarFilePreviewState || rightSidebarFilePreviewState.id !== stateId || requestId !== rightSidebarFilePreviewRequestId) return;
        rightSidebarFilePreviewState.loading = false;
        rightSidebarFilePreviewState.textContent = content;
        rightSidebarFilePreviewState.originalText = content;
        rightSidebarFilePreviewState.mtimeMs = Number(response.headers.get('X-File-Mtime-Ms') || 0) || undefined;
        if (rightSidebarFilePreviewState.editing) rightSidebarFilePreviewState.focusEditor = true;
      } catch (error) {
        if (!rightSidebarFilePreviewState || rightSidebarFilePreviewState.id !== stateId || requestId !== rightSidebarFilePreviewRequestId) return;
        rightSidebarFilePreviewState.loading = false;
        rightSidebarFilePreviewState.error = '读取预览失败：' + (error.message || error);
      }
      renderRightSidebarChrome();
      renderRightSidebarFilePreviewPanel();
    }

    function beginRightSidebarFileEdit(preserveLocator) {
      var state = rightSidebarFilePreviewState;
      if (!state || !supportsRightSidebarTextEditing(state.extension)) return;
      if (preserveLocator !== true) state.pendingEditLocator = null;
      state.editing = true;
      state.dirty = false;
      state.saveError = '';
      state.focusEditor = typeof state.textContent === 'string';
      renderRightSidebarFilePreviewPanel();
    }
    window.beginRightSidebarFileEdit = beginRightSidebarFileEdit;

    function handleRightSidebarFileEditInput(editor) {
      var state = rightSidebarFilePreviewState;
      if (!state || !state.editing || !editor) return;
      state.textContent = editor.value;
      state.dirty = state.textContent !== String(state.originalText == null ? '' : state.originalText);
      state.saveError = '';
      var status = document.getElementById('rightSidebarFileSaveState');
      var saveButton = document.getElementById('rightSidebarFileSaveButton');
      if (status) {
        status.textContent = state.dirty ? '未保存' : '已保存';
        status.className = 'right-sidebar-file-preview-save-state' + (state.dirty ? ' dirty' : '');
      }
      if (saveButton) saveButton.disabled = !state.dirty || !!state.saving;
    }
    window.handleRightSidebarFileEditInput = handleRightSidebarFileEditInput;

    async function saveRightSidebarFileEdit() {
      var state = rightSidebarFilePreviewState;
      if (!state || !state.editing || !state.dirty || state.saving) return;
      state.saving = true;
      state.saveError = '';
      renderRightSidebarFilePreviewPanel();
      try {
        var response = await fetch('/api/local-file/text', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: state.path,
            workspaceRoot: state.workspaceRoot || '',
            content: state.textContent,
            expectedMtimeMs: state.mtimeMs
          })
        });
        var payload = await response.json().catch(function() { return {}; });
        if (!response.ok || payload.success === false) {
          throw new Error(payload.message || payload.error || ('HTTP ' + response.status));
        }
        if (!rightSidebarFilePreviewState || rightSidebarFilePreviewState.id !== state.id) return;
        state.originalText = state.textContent;
        state.mtimeMs = Number(payload.mtimeMs || 0) || undefined;
        state.dirty = false;
        state.saving = false;
        state.saveError = '';
        state.formattedPreviewUrl = getRightSidebarFormattedPreviewUrl(state.path, state.extension, state.workspaceRoot);
      } catch (error) {
        if (!rightSidebarFilePreviewState || rightSidebarFilePreviewState.id !== state.id) return;
        state.saving = false;
        state.saveError = '保存失败：' + (error.message || error);
      }
      renderRightSidebarFilePreviewPanel();
    }
    window.saveRightSidebarFileEdit = saveRightSidebarFileEdit;

    function cancelRightSidebarFileEdit() {
      var state = rightSidebarFilePreviewState;
      if (!state || !state.editing || state.saving) return;
      if (state.dirty && !window.confirm('放弃尚未保存的修改吗？')) return;
      state.textContent = String(state.originalText == null ? '' : state.originalText);
      state.dirty = false;
      state.editing = false;
      state.saveError = '';
      renderRightSidebarFilePreviewPanel();
    }
    window.cancelRightSidebarFileEdit = cancelRightSidebarFileEdit;

    function excelColumnName(index) {
      var name = '';
      var value = Number(index) + 1;
      while (value > 0) {
        var remainder = (value - 1) % 26;
        name = String.fromCharCode(65 + remainder) + name;
        value = Math.floor((value - 1) / 26);
      }
      return name;
    }

    function renderRightSidebarWordEditor(state) {
      var data = state.officeEditorData || {};
      var paragraphs = Array.isArray(data.paragraphs) ? data.paragraphs : [];
      return '<div class="right-sidebar-office-editor">' +
        '<article class="right-sidebar-word-editor" aria-label="Word 文字编辑器">' +
          paragraphs.map(function(paragraph) {
            return '<div class="right-sidebar-word-paragraph" contenteditable="true" spellcheck="true" data-paragraph-index="' +
              Number(paragraph.index) + '" onfocus="rememberRightSidebarWordEditPosition(this)" oninput="handleRightSidebarWordInput(this)">' +
              escapeHtml(paragraph.text || '') +
            '</div>';
          }).join('') +
        '</article>' +
      '</div>';
    }

    function renderRightSidebarExcelEditor(state) {
      var data = state.officeEditorData || {};
      var sheets = Array.isArray(data.sheets) ? data.sheets : [];
      var activeSheetName = state.pendingEditLocator && state.pendingEditLocator.type === 'excel-cell' && state.pendingEditLocator.sheet
        ? state.pendingEditLocator.sheet
        : (state.activeOfficeSheet || (sheets[0] && sheets[0].name) || '');
      var sheet = sheets.find(function(item) { return item.name === activeSheetName; }) || sheets[0];
      if (!sheet) return '<div class="right-sidebar-file-preview-empty">工作簿中没有工作表。</div>';
      state.activeOfficeSheet = sheet.name;
      var visibleRows = Math.min(Number(sheet.rowCount || 20), Number(state.excelVisibleRows || 200));
      var visibleColumns = Math.min(Number(sheet.columnCount || 10), Number(state.excelVisibleColumns || 50));
      var head = '<thead><tr><th class="row-number"></th>';
      for (var column = 0; column < visibleColumns; column += 1) {
        head += '<th>' + excelColumnName(column) + '</th>';
      }
      head += '</tr></thead>';
      var rows = '<tbody>';
      for (var row = 0; row < visibleRows; row += 1) {
        rows += '<tr><th class="row-number">' + (row + 1) + '</th>';
        for (var cellColumn = 0; cellColumn < visibleColumns; cellColumn += 1) {
          var address = excelColumnName(cellColumn) + (row + 1);
          var key = sheet.name + '!' + address;
          var value = state.excelCellValues && Object.prototype.hasOwnProperty.call(state.excelCellValues, key)
            ? state.excelCellValues[key]
            : '';
          rows += '<td class="right-sidebar-excel-cell" contenteditable="true" spellcheck="false" data-sheet="' +
            escapeHtml(sheet.name) + '" data-address="' + address +
            '" oninput="handleRightSidebarExcelInput(this)" onpaste="handleRightSidebarExcelPaste(event,this)">' +
            escapeHtml(value) + '</td>';
        }
        rows += '</tr>';
      }
      rows += '</tbody>';
      var tabs = sheets.map(function(item) {
        return '<button type="button" class="right-sidebar-excel-tab' + (item.name === sheet.name ? ' active' : '') +
          '" onclick="setRightSidebarExcelSheet(this)" data-sheet="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</button>';
      }).join('');
      var canShowRows = visibleRows < Number(sheet.rowCount || 0);
      var canShowColumns = visibleColumns < Number(sheet.columnCount || 0);
      return '<div class="right-sidebar-office-editor right-sidebar-excel-shell">' +
        '<div class="right-sidebar-excel-tabs">' + tabs + '</div>' +
        '<div class="right-sidebar-excel-grid-wrap"><table class="right-sidebar-excel-grid">' + head + rows + '</table></div>' +
        '<div class="right-sidebar-excel-more">' +
          (canShowRows ? '<button type="button" class="right-sidebar-file-preview-action" onclick="showMoreRightSidebarExcelRows()">显示更多行</button>' : '') +
          (canShowColumns ? '<button type="button" class="right-sidebar-file-preview-action" onclick="showMoreRightSidebarExcelColumns()">显示更多列</button>' : '') +
          '<button type="button" class="right-sidebar-file-preview-action" onclick="addRightSidebarExcelRows()">新增 20 行</button>' +
          '<button type="button" class="right-sidebar-file-preview-action" onclick="addRightSidebarExcelColumns()">新增 5 列</button>' +
        '</div>' +
      '</div>';
    }

    async function loadRightSidebarOfficeEditor(stateId) {
      var state = rightSidebarFilePreviewState;
      if (!state || state.id !== stateId) return;
      var endpoint = state.extension === 'docx' ? 'word-editor' : 'excel-editor';
      try {
        var params = new URLSearchParams({ path: state.path || '' });
        if (state.workspaceRoot) params.set('workspaceRoot', state.workspaceRoot);
        var response = await fetch('/api/local-file/' + endpoint + '?' + params.toString(), { cache: 'no-store' });
        var payload = await response.json().catch(function() { return {}; });
        if (!response.ok || payload.success === false) throw new Error(payload.message || payload.error || ('HTTP ' + response.status));
        if (!rightSidebarFilePreviewState || rightSidebarFilePreviewState.id !== stateId) return;
        state.loading = false;
        state.officeEditorData = payload;
        state.focusOfficeEditor = true;
        state.mtimeMs = Number(payload.mtimeMs || 0) || undefined;
        state.dirty = false;
        state.saveError = '';
        if (state.extension === 'docx') {
          state.wordOriginalTexts = {};
          (payload.paragraphs || []).forEach(function(item) {
            state.wordOriginalTexts[item.index] = String(item.text || '');
          });
        } else {
          state.excelCellValues = {};
          state.excelOriginalValues = {};
          state.excelChanges = {};
          (payload.sheets || []).forEach(function(sheet) {
            (sheet.cells || []).forEach(function(cell) {
              var key = sheet.name + '!' + cell.address;
              var value = cell.formula ? '=' + cell.formula : String(cell.value == null ? '' : cell.value);
              state.excelCellValues[key] = value;
              state.excelOriginalValues[key] = value;
            });
          });
          state.activeOfficeSheet = payload.sheets && payload.sheets[0] ? payload.sheets[0].name : '';
          state.excelVisibleRows = 200;
          state.excelVisibleColumns = 50;
          if (state.pendingEditLocator && state.pendingEditLocator.type === 'excel-cell') {
            var locatorMatch = String(state.pendingEditLocator.address || '').match(/^([A-Z]+)(\d+)$/);
            if (locatorMatch) {
              var locatorColumn = 0;
              for (var locatorIndex = 0; locatorIndex < locatorMatch[1].length; locatorIndex += 1) {
                locatorColumn = locatorColumn * 26 + locatorMatch[1].charCodeAt(locatorIndex) - 64;
              }
              state.excelVisibleRows = Math.max(state.excelVisibleRows, Number(locatorMatch[2]));
              state.excelVisibleColumns = Math.max(state.excelVisibleColumns, locatorColumn);
            }
            state.activeOfficeSheet = state.pendingEditLocator.sheet || state.activeOfficeSheet;
          }
        }
      } catch (error) {
        if (!rightSidebarFilePreviewState || rightSidebarFilePreviewState.id !== stateId) return;
        state.loading = false;
        state.officeEditing = false;
        state.error = '编辑器加载失败：' + (error.message || error);
      }
      renderRightSidebarFilePreviewPanel();
    }

    function beginRightSidebarOfficeEdit(preserveLocator) {
      var state = rightSidebarFilePreviewState;
      if (!state || ['docx', 'xls', 'xlsx'].indexOf(state.extension) === -1) return;
      if (preserveLocator !== true) state.pendingEditLocator = null;
      state.officeEditing = true;
      state.dirty = false;
      state.saveError = '';
      renderRightSidebarFilePreviewPanel();
    }
    window.beginRightSidebarOfficeEdit = beginRightSidebarOfficeEdit;

    function updateRightSidebarOfficeSaveState() {
      var state = rightSidebarFilePreviewState;
      var status = document.getElementById('rightSidebarFileSaveState');
      var saveButton = document.getElementById('rightSidebarFileSaveButton');
      if (!state) return;
      if (status) {
        status.textContent = state.saveError || (state.dirty ? '未保存' : '已保存');
        status.className = 'right-sidebar-file-preview-save-state' +
          (state.saveError ? ' error' : (state.dirty ? ' dirty' : ''));
      }
      if (saveButton) saveButton.disabled = !state.dirty || !!state.saving;
    }

    function rememberRightSidebarWordEditPosition(element) {
      var state = rightSidebarFilePreviewState;
      if (!state || !state.officeEditing || !element) return;
      state.lastOfficeEditParagraphIndex = Number(element.getAttribute('data-paragraph-index'));
    }
    window.rememberRightSidebarWordEditPosition = rememberRightSidebarWordEditPosition;

    function rememberRightSidebarWordPreviewReturnPosition(state, useOriginalText) {
      if (!state || state.extension !== 'docx' || !state.officeEditorData) return;
      var paragraphs = Array.isArray(state.officeEditorData.paragraphs) ? state.officeEditorData.paragraphs : [];
      var paragraphIndex = Number(state.lastOfficeEditParagraphIndex);
      var paragraph = paragraphs.find(function(item) {
        return Number(item.index) === paragraphIndex;
      });
      if (!paragraph && state.pendingEditLocator && state.pendingEditLocator.type === 'word-text') {
        state.returnPreviewLocator = {
          type: 'word-text',
          text: state.pendingEditLocator.text,
          occurrence: state.pendingEditLocator.occurrence,
          paragraphIndex: paragraphIndex
        };
        return;
      }
      if (!paragraph) return;
      var paragraphText = useOriginalText
        ? state.wordOriginalTexts && state.wordOriginalTexts[paragraph.index]
        : paragraph.text;
      var text = normalizeRightSidebarPreviewText(paragraphText);
      var occurrence = 0;
      for (var index = 0; index < paragraphs.length; index += 1) {
        var comparisonText = useOriginalText
          ? state.wordOriginalTexts && state.wordOriginalTexts[paragraphs[index].index]
          : paragraphs[index].text;
        if (normalizeRightSidebarPreviewText(comparisonText) === text) occurrence += 1;
        if (Number(paragraphs[index].index) === paragraphIndex) break;
      }
      state.returnPreviewLocator = {
        type: 'word-text',
        text: text,
        occurrence: Math.max(1, occurrence),
        paragraphIndex: paragraphIndex
      };
    }

    function handleRightSidebarWordInput(element) {
      var state = rightSidebarFilePreviewState;
      if (!state || !state.officeEditing || !element) return;
      rememberRightSidebarWordEditPosition(element);
      var index = Number(element.getAttribute('data-paragraph-index'));
      var paragraph = (state.officeEditorData.paragraphs || []).find(function(item) { return Number(item.index) === index; });
      if (!paragraph) return;
      paragraph.text = element.innerText.replace(/\r\n?/g, '\n');
      state.dirty = (state.officeEditorData.paragraphs || []).some(function(item) {
        return String(item.text || '') !== String(state.wordOriginalTexts[item.index] || '');
      });
      state.saveError = '';
      updateRightSidebarOfficeSaveState();
    }
    window.handleRightSidebarWordInput = handleRightSidebarWordInput;

    function setRightSidebarExcelCellValue(sheetName, address, value) {
      var state = rightSidebarFilePreviewState;
      if (!state || !state.officeEditing) return;
      var key = sheetName + '!' + address;
      var addressMatch = address.match(/^([A-Z]+)(\d+)$/);
      var sheet = (state.officeEditorData.sheets || []).find(function(item) { return item.name === sheetName; });
      if (sheet && addressMatch) {
        var columnIndex = 0;
        for (var i = 0; i < addressMatch[1].length; i += 1) columnIndex = columnIndex * 26 + addressMatch[1].charCodeAt(i) - 64;
        sheet.rowCount = Math.max(Number(sheet.rowCount || 0), Number(addressMatch[2]));
        sheet.columnCount = Math.max(Number(sheet.columnCount || 0), columnIndex);
      }
      state.excelCellValues[key] = value;
      var original = Object.prototype.hasOwnProperty.call(state.excelOriginalValues, key) ? state.excelOriginalValues[key] : '';
      if (value === original) delete state.excelChanges[key];
      else state.excelChanges[key] = { sheet: sheetName, address: address, value: value };
      state.dirty = Object.keys(state.excelChanges).length > 0;
      state.saveError = '';
    }

    function handleRightSidebarExcelInput(element) {
      if (!element) return;
      setRightSidebarExcelCellValue(
        element.getAttribute('data-sheet') || '',
        element.getAttribute('data-address') || '',
        element.innerText.replace(/\r?\n/g, '')
      );
      updateRightSidebarOfficeSaveState();
    }
    window.handleRightSidebarExcelInput = handleRightSidebarExcelInput;

    function handleRightSidebarExcelPaste(event, element) {
      var text = event.clipboardData && event.clipboardData.getData('text/plain');
      if (!text || (text.indexOf('\t') === -1 && text.indexOf('\n') === -1)) return;
      event.preventDefault();
      var sheetName = element.getAttribute('data-sheet') || '';
      var address = element.getAttribute('data-address') || '';
      var match = address.match(/^([A-Z]+)(\d+)$/);
      if (!match) return;
      var startColumn = 0;
      for (var i = 0; i < match[1].length; i += 1) startColumn = startColumn * 26 + match[1].charCodeAt(i) - 64;
      startColumn -= 1;
      var startRow = Number(match[2]) - 1;
      var pastedRows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n');
      pastedRows.forEach(function(rowText, rowOffset) {
        rowText.split('\t').forEach(function(value, columnOffset) {
          setRightSidebarExcelCellValue(sheetName, excelColumnName(startColumn + columnOffset) + (startRow + rowOffset + 1), value);
        });
      });
      renderRightSidebarFilePreviewPanel();
    }
    window.handleRightSidebarExcelPaste = handleRightSidebarExcelPaste;

    function setRightSidebarExcelSheet(button) {
      if (!rightSidebarFilePreviewState || !button) return;
      rightSidebarFilePreviewState.activeOfficeSheet = button.getAttribute('data-sheet') || '';
      renderRightSidebarFilePreviewPanel();
    }
    window.setRightSidebarExcelSheet = setRightSidebarExcelSheet;

    function showMoreRightSidebarExcelRows() {
      if (!rightSidebarFilePreviewState) return;
      rightSidebarFilePreviewState.excelVisibleRows = Number(rightSidebarFilePreviewState.excelVisibleRows || 200) + 200;
      renderRightSidebarFilePreviewPanel();
    }
    window.showMoreRightSidebarExcelRows = showMoreRightSidebarExcelRows;

    function showMoreRightSidebarExcelColumns() {
      if (!rightSidebarFilePreviewState) return;
      rightSidebarFilePreviewState.excelVisibleColumns = Number(rightSidebarFilePreviewState.excelVisibleColumns || 50) + 25;
      renderRightSidebarFilePreviewPanel();
    }
    window.showMoreRightSidebarExcelColumns = showMoreRightSidebarExcelColumns;

    function addRightSidebarExcelRows() {
      var state = rightSidebarFilePreviewState;
      if (!state || !state.officeEditorData) return;
      var sheet = (state.officeEditorData.sheets || []).find(function(item) { return item.name === state.activeOfficeSheet; });
      if (!sheet) return;
      var maxRows = Number(state.officeEditorData.limits && state.officeEditorData.limits.rows || 2000);
      sheet.rowCount = Math.min(maxRows, Number(sheet.rowCount || 20) + 20);
      state.excelVisibleRows = Math.max(Number(state.excelVisibleRows || 200), sheet.rowCount);
      renderRightSidebarFilePreviewPanel();
    }
    window.addRightSidebarExcelRows = addRightSidebarExcelRows;

    function addRightSidebarExcelColumns() {
      var state = rightSidebarFilePreviewState;
      if (!state || !state.officeEditorData) return;
      var sheet = (state.officeEditorData.sheets || []).find(function(item) { return item.name === state.activeOfficeSheet; });
      if (!sheet) return;
      var maxColumns = Number(state.officeEditorData.limits && state.officeEditorData.limits.columns || 200);
      sheet.columnCount = Math.min(maxColumns, Number(sheet.columnCount || 10) + 5);
      state.excelVisibleColumns = Math.max(Number(state.excelVisibleColumns || 50), sheet.columnCount);
      renderRightSidebarFilePreviewPanel();
    }
    window.addRightSidebarExcelColumns = addRightSidebarExcelColumns;

    async function saveRightSidebarOfficeEdit() {
      var state = rightSidebarFilePreviewState;
      if (!state || !state.officeEditing || !state.dirty || state.saving) return;
      state.saving = true;
      state.saveError = '';
      renderRightSidebarFilePreviewPanel();
      var isWord = state.extension === 'docx';
      var payload = {
        path: state.path,
        workspaceRoot: state.workspaceRoot || '',
        expectedMtimeMs: state.mtimeMs
      };
      if (isWord) {
        payload.paragraphs = (state.officeEditorData.paragraphs || []).filter(function(item) {
          return String(item.text || '') !== String(state.wordOriginalTexts[item.index] || '');
        });
      } else {
        payload.changes = Object.keys(state.excelChanges || {}).map(function(key) { return state.excelChanges[key]; });
      }
      try {
        var endpoint = isWord ? 'word-editor' : 'excel-editor';
        var response = await fetch('/api/local-file/' + endpoint, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || result.success === false) throw new Error(result.message || result.error || ('HTTP ' + response.status));
        if (!rightSidebarFilePreviewState || rightSidebarFilePreviewState.id !== state.id) return;
        state.mtimeMs = Number(result.mtimeMs || 0) || undefined;
        state.dirty = false;
        state.saving = false;
        state.saveError = '';
        if (isWord) {
          (state.officeEditorData.paragraphs || []).forEach(function(item) {
            state.wordOriginalTexts[item.index] = String(item.text || '');
          });
          rememberRightSidebarWordPreviewReturnPosition(state);
          state.officeEditing = false;
          state.officeEditorData = null;
        } else {
          Object.keys(state.excelChanges || {}).forEach(function(key) {
            state.excelOriginalValues[key] = state.excelCellValues[key];
          });
          state.excelChanges = {};
        }
        state.formattedPreviewUrl = getRightSidebarFormattedPreviewUrl(state.path, state.extension, state.workspaceRoot);
      } catch (error) {
        if (!rightSidebarFilePreviewState || rightSidebarFilePreviewState.id !== state.id) return;
        state.saving = false;
        state.saveError = '保存失败：' + (error.message || error);
      }
      renderRightSidebarFilePreviewPanel();
    }

    function saveRightSidebarActiveEdit() {
      var state = rightSidebarFilePreviewState;
      if (state && state.officeEditing) return saveRightSidebarOfficeEdit();
      return saveRightSidebarFileEdit();
    }
    window.saveRightSidebarActiveEdit = saveRightSidebarActiveEdit;

    function cancelRightSidebarOfficeEdit() {
      var state = rightSidebarFilePreviewState;
      if (!state || !state.officeEditing || state.saving) return;
      if (state.dirty && !window.confirm('放弃尚未保存的修改吗？')) return;
      rememberRightSidebarWordPreviewReturnPosition(state, true);
      state.officeEditing = false;
      state.officeEditorData = null;
      state.dirty = false;
      state.saveError = '';
      renderRightSidebarFilePreviewPanel();
    }

    function cancelRightSidebarActiveEdit() {
      var state = rightSidebarFilePreviewState;
      if (state && state.officeEditing) return cancelRightSidebarOfficeEdit();
      return cancelRightSidebarFileEdit();
    }
    window.cancelRightSidebarActiveEdit = cancelRightSidebarActiveEdit;

    function askAiToModifyRightSidebarFile() {
      var state = rightSidebarFilePreviewState;
      var input = document.getElementById('userInput');
      if (!state || !input) return;
      var prompt = '请修改工作目录文件“' + String(state.path || state.name || '') + '”。具体要求：';
      input.value = input.value.trim() ? input.value + '\n' + prompt : prompt;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
      var end = input.value.length;
      if (typeof input.setSelectionRange === 'function') input.setSelectionRange(end, end);
    }
    window.askAiToModifyRightSidebarFile = askAiToModifyRightSidebarFile;

    function handleRightSidebarFilePreviewMediaError() {
      if (!rightSidebarFilePreviewState) return;
      rightSidebarFilePreviewState.error = '预览加载失败，请确认文件仍然存在。';
      renderRightSidebarFilePreviewPanel();
    }
    window.handleRightSidebarFilePreviewMediaError = handleRightSidebarFilePreviewMediaError;

    function readOutputImageNavigationItem(node) {
      if (!node || !node.getAttribute) return null;
      var pathValue = node.getAttribute('data-file-path') || '';
      var previewValue = node.getAttribute('data-preview-url') || '';
      var nameValue = node.getAttribute('data-file-name') || getOutputAttachmentFileName(pathValue || previewValue);
      var kindValue = node.getAttribute('data-file-kind') || getOutputAttachmentKind(nameValue || pathValue || previewValue);
      if (kindValue !== 'image' && !isOutputImagePath(pathValue || previewValue)) return null;
      return {
        path: pathValue || previewValue,
        previewUrl: previewValue || pathValue,
        name: nameValue || '图片预览',
        kind: 'image',
        workspaceRoot: getOutputAttachmentWorkspaceRoot(node)
      };
    }

    function collectOutputImageNavigationContext(button) {
      if (!button || !button.closest) return null;
      var root = button.closest('.output-image-collection');
      var carrier = button;
      var candidates = [];
      if (root) {
        candidates = Array.prototype.slice.call(root.querySelectorAll('.output-image-collection-thumb'));
        carrier = button.closest('.output-image-collection-thumb') || button;
      } else {
        var messageContent = button.closest('.message .content');
        if (messageContent && button.classList && button.classList.contains('message-image-preview-link')) {
          candidates = Array.prototype.slice.call(messageContent.querySelectorAll('.message-image-preview-link'));
        } else {
          root = button.closest('.output-attachments');
          if (root) {
            candidates = Array.prototype.slice.call(root.querySelectorAll('.output-attachment-card[data-file-kind="image"]'));
            carrier = button.closest('.output-attachment-card[data-file-kind="image"]') || button;
          }
        }
      }
      if (!candidates.length) return null;
      var items = [];
      var currentIndex = -1;
      var seen = {};
      candidates.forEach(function(candidate) {
        var item = readOutputImageNavigationItem(candidate);
        if (!item) return;
        var key = normalizeOutputAttachmentPathForVariantDedupe(item.path || item.previewUrl) || String(item.path || item.previewUrl);
        var index;
        if (Object.prototype.hasOwnProperty.call(seen, key)) {
          index = seen[key];
        } else {
          index = items.length;
          seen[key] = index;
          items.push(item);
        }
        if (candidate === carrier || candidate.contains(carrier) || carrier.contains(candidate)) {
          currentIndex = index;
        }
      });
      if (items.length < 2) return null;
      if (currentIndex < 0) {
        var currentPath = String(button.getAttribute('data-file-path') || button.getAttribute('data-preview-url') || '');
        currentIndex = items.findIndex(function(item) {
          return item.path === currentPath || item.previewUrl === currentPath;
        });
      }
      return {
        items: items,
        index: Math.max(0, currentIndex)
      };
    }

    function createOutputImageNavigationButton(item) {
      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-file-path', item.path || item.previewUrl || '');
      button.setAttribute('data-preview-url', item.previewUrl || item.path || '');
      button.setAttribute('data-file-name', item.name || '图片预览');
      button.setAttribute('data-file-kind', 'image');
      button.setAttribute('data-workspace-root', item.workspaceRoot || '');
      return button;
    }

    async function navigateRightSidebarImage(direction) {
      var state = rightSidebarFilePreviewState;
      if (!state || state.kind !== 'image' || state.imageNavigationBusy) return false;
      var items = Array.isArray(state.imageNavigationItems) ? state.imageNavigationItems : [];
      var currentIndex = Number(state.imageNavigationIndex || 0);
      var nextIndex = currentIndex + Number(direction || 0);
      if (!items[nextIndex]) return false;
      state.imageNavigationBusy = true;
      var navigationContext = {
        items: items.map(function(item) { return Object.assign({}, item); }),
        index: nextIndex
      };
      var navigationButton = createOutputImageNavigationButton(navigationContext.items[nextIndex]);
      var opened = await openOutputAttachmentInRightSidebar(navigationButton, navigationContext);
      if (!opened && rightSidebarFilePreviewState) {
        rightSidebarFilePreviewState.imageNavigationBusy = false;
        renderRightSidebarFilePreviewPanel();
      }
      return opened;
    }
    window.navigateRightSidebarImage = navigateRightSidebarImage;

    async function openOutputAttachmentInRightSidebar(button, suppliedNavigationContext) {
      var filePath = button ? button.getAttribute('data-file-path') || '' : '';
      var previewUrl = button ? button.getAttribute('data-preview-url') || '' : '';
      var declaredName = button ? button.getAttribute('data-file-name') || '' : '';
      var declaredKind = button ? button.getAttribute('data-file-kind') || '' : '';
      var workspaceRoot = getOutputAttachmentWorkspaceRoot(button);
      var imageNavigationContext = suppliedNavigationContext || collectOutputImageNavigationContext(button);
      try {
        var target = await resolveOutputAttachmentLocalPath(button) || filePath || previewUrl;
        var fileName = declaredName || getOutputAttachmentFileName(target || previewUrl);
        var inferredKind = getOutputAttachmentKind(fileName || target || previewUrl);
        var fileKind = declaredKind && declaredKind !== 'file' ? declaredKind : inferredKind;
        var extension = getOutputAttachmentExtension(fileName || target || previewUrl);
        var resolvedPreviewUrl = getRightSidebarOutputPreviewUrl(target, previewUrl, workspaceRoot);
        var formattedPreviewUrl = getRightSidebarFormattedPreviewUrl(target, extension, workspaceRoot);
        var activeTab = getRightSidebarActiveTab();
        if (activeTab !== 'preview') rightSidebarPreviousTab = activeTab;
        if (imageNavigationContext && Array.isArray(imageNavigationContext.items)) {
          var imageNavigationIndex = Math.max(0, Math.min(
            imageNavigationContext.items.length - 1,
            Number(imageNavigationContext.index || 0)
          ));
          imageNavigationContext.items[imageNavigationIndex] = Object.assign(
            {},
            imageNavigationContext.items[imageNavigationIndex],
            {
              path: target || filePath || previewUrl,
              previewUrl: resolvedPreviewUrl || previewUrl,
              name: fileName || '图片预览',
              kind: 'image',
              workspaceRoot: workspaceRoot || ''
            }
          );
        }
        releaseRightSidebarImagePreview(rightSidebarFilePreviewState);
        rightSidebarFilePreviewRequestId += 1;
        rightSidebarFilePreviewState = {
          id: 'file_preview_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
          path: target || filePath || previewUrl,
          previewUrl: resolvedPreviewUrl || previewUrl,
          name: fileName || '文件预览',
          kind: fileKind || 'file',
          extension: extension || '',
          formattedPreviewUrl: formattedPreviewUrl,
          workspaceRoot: workspaceRoot || '',
          imageNavigationItems: imageNavigationContext ? imageNavigationContext.items : [],
          imageNavigationIndex: imageNavigationContext ? Number(imageNavigationContext.index || 0) : 0,
          imageNavigationBusy: false
        };
        rightSidebarTransientTab = 'preview';
        setRightSidebarTab('preview');
        requestAnimationFrame(function() {
          if (rightSidebarFilePreviewState && typeof ensureRightSidebarExpandedWidth === 'function') {
            ensureRightSidebarExpandedWidth();
          }
        });
        return true;
      } catch (error) {
        alert('文件预览失败：' + (error.message || error));
        return false;
      }
    }
    window.openOutputAttachmentInRightSidebar = openOutputAttachmentInRightSidebar;

    function openOutputAttachmentCardInSidebar(card, event) {
      var target = event && event.target && event.target.closest ? event.target.closest('button,a,input,select,textarea') : null;
      if (target) return;
      openOutputAttachmentInRightSidebar(card);
    }
    window.openOutputAttachmentCardInSidebar = openOutputAttachmentCardInSidebar;

    function clearRightSidebarFilePreviewState() {
      rightSidebarFilePreviewRequestId += 1;
      hideRightSidebarPreviewSelectionAsk();
      releaseRightSidebarImagePreview(rightSidebarFilePreviewState);
      rightSidebarFilePreviewState = null;
      rightSidebarTransientTab = '';
      if (document.getElementById('rightSidebarFilePreviewPage')) renderRightSidebarChrome();
    }
    window.clearRightSidebarFilePreviewState = clearRightSidebarFilePreviewState;

    function closeRightSidebarFilePreview() {
      if (rightSidebarFilePreviewState && rightSidebarFilePreviewState.dirty
        && !window.confirm('当前文件还有未保存的修改，仍要关闭吗？')) return;
      clearRightSidebarFilePreviewState();
      setRightSidebarTab(rightSidebarPreviousTab === 'figures' ? 'figures' : 'article');
    }
    window.closeRightSidebarFilePreview = closeRightSidebarFilePreview;

    async function previewOutputAttachment(button) {
      return openOutputAttachmentInRightSidebar(button);
    }
    window.previewOutputAttachment = previewOutputAttachment;

    function getOutputAttachmentWorkspaceRoot(button) {
      if (!button) return '';
      var direct = button.getAttribute ? button.getAttribute('data-workspace-root') || '' : '';
      if (direct) return direct;
      var card = button.closest ? button.closest('.output-attachment-card') : null;
      return card ? card.getAttribute('data-workspace-root') || '' : '';
    }

    function getWorkspaceRootsForLocalFileResolve(preferredRoot) {
      try {
        var setting = loadWorkspaceDirectorySetting ? loadWorkspaceDirectorySetting() : null;
        var conversationAiWorkRoot = setting && setting.enabled
          ? getConversationScopedAiWorkRoot(setting)
          : '';
        return uniqueOutputAttachmentRoots([
          preferredRoot,
          conversationAiWorkRoot,
          setting && setting.enabled ? setting.aiWorkRoot : '',
          setting && setting.enabled ? setting.path : ''
        ]);
      } catch (e) {
        return uniqueOutputAttachmentRoots([preferredRoot]);
      }
    }

    function getWorkspaceRootForLocalFileResolve() {
      var roots = getWorkspaceRootsForLocalFileResolve();
      return roots.length ? roots[0] : '';
    }

    function shouldResolveOutputAttachmentTarget(value) {
      var target = String(value || '').trim();
      if (!target || /^https?:\/\//i.test(target)) return false;
      if (target.indexOf('/api/r-code/artifact/') === 0) return false;
      return true;
    }

    async function authorizeOutputAttachmentPreviewTargets(button) {
      if (!button) return false;
      var filePath = button.getAttribute('data-file-path') || '';
      var preferredRoot = getOutputAttachmentWorkspaceRoot(button);
      var candidates = getWorkspaceRootsForLocalFileResolve(preferredRoot);
      if (isLocalOutputAttachmentPathForAuthorization(filePath)) {
        candidates.unshift(filePath);
      }
      candidates = uniqueOutputAttachmentRoots(candidates).slice(0, 8);
      if (!candidates.length) return false;

      var results = await Promise.all(candidates.map(function(candidate) {
        var controller = new AbortController();
        var timeoutId = setTimeout(function() {
          try { controller.abort(); } catch (e) {}
        }, 5000);
        return fetch('/api/chat-bridge/workspace/authorize-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: true,
            path: candidate,
            permission: 'read-only'
          }),
          signal: controller.signal
        }).then(function(response) {
          return response.ok;
        }).catch(function(error) {
          if (!error || error.name !== 'AbortError') {
            console.warn('[OutputAttachment] Preview authorization failed:', candidate, error);
          }
          return false;
        }).finally(function() {
          clearTimeout(timeoutId);
        });
      }));
      return results.some(Boolean);
    }
    window.authorizeOutputAttachmentPreviewTargets = authorizeOutputAttachmentPreviewTargets;

    function updateOutputAttachmentCardPath(button, resolvedPath) {
      if (!button || !resolvedPath) return;
      var card = button.closest ? button.closest('.output-attachment-card') : null;
      var workspaceRoot = getOutputAttachmentWorkspaceRoot(button);
      var nodes = card
        ? Array.prototype.slice.call(card.querySelectorAll('[data-file-path]'))
        : [button];
      nodes.forEach(function(node) {
        node.setAttribute('data-file-path', resolvedPath);
        if (node.hasAttribute('data-preview-url') && getOutputAttachmentKind(resolvedPath) === 'image') {
          node.setAttribute('data-preview-url', getOutputAttachmentPreviewUrl(resolvedPath, workspaceRoot));
        }
      });
      if (card) {
        var previewImg = card.querySelector('.output-attachment-preview img');
        if (previewImg && getOutputAttachmentKind(resolvedPath) === 'image') {
          var resolvedPreviewUrl = getOutputAttachmentPreviewUrl(resolvedPath, workspaceRoot);
          var previewButton = previewImg.closest('.output-attachment-preview');
          if (previewButton) {
            previewButton.classList.remove('is-thumbnail-ready');
            previewButton.classList.add('is-thumbnail-loading');
          }
          previewImg.setAttribute('data-thumbnail-source-url', resolvedPreviewUrl);
          previewImg.setAttribute('data-thumbnail-status', '');
          previewImg.removeAttribute('data-preview-retried');
          previewImg.src = OUTPUT_ATTACHMENT_THUMBNAIL_PLACEHOLDER;
          scheduleOutputAttachmentThumbnail(previewImg, true);
        }
      }
    }

    async function resolveOutputAttachmentLocalPath(button, options) {
      options = options || {};
      var filePath = button ? button.getAttribute('data-file-path') || '' : '';
      var previewUrl = button ? button.getAttribute('data-preview-url') || '' : '';
      var fileName = button ? button.getAttribute('data-file-name') || getOutputAttachmentFileName(filePath || previewUrl) : '';
      var target = filePath || previewUrl;
      if (!shouldResolveOutputAttachmentTarget(target)) return target;
      try {
        // Historical messages outlive the in-memory preview allow-list. Always
        // restore the clicked file/workspace authorization before resolving it,
        // otherwise a valid old attachment intermittently falls through to a
        // broken iframe that reports "不存在或未授权".
        await authorizeOutputAttachmentPreviewTargets(button);
        var params = new URLSearchParams();
        params.set('path', target);
        if (fileName) params.set('name', fileName);
        params.set('preferLatest', '1');
        var preferredRoot = getOutputAttachmentWorkspaceRoot(button);
        var workspaceRoots = getWorkspaceRootsForLocalFileResolve(preferredRoot);
        if (workspaceRoots.length) {
          params.set('workspaceRoot', workspaceRoots[0]);
          params.set('workspaceRoots', JSON.stringify(workspaceRoots));
        }
        var response = await fetch('/api/local-file/resolve?' + params.toString(), { method: 'GET' });
        var data = await response.json().catch(function() { return {}; });
        if (response.ok && data && data.success && data.path) {
          updateOutputAttachmentCardPath(button, data.path);
          return data.path;
        }
      } catch (error) {
        console.warn('[OutputAttachment] Resolve local path failed:', error);
      }
      return options.requireExisting ? '' : target;
    }

    async function openOutputAttachmentFile(button) {
      return openOutputAttachmentInRightSidebar(button);
    }
    window.openOutputAttachmentFile = openOutputAttachmentFile;

    async function openOutputAttachmentFolder(button) {
      var filePath = button ? button.getAttribute('data-file-path') || '' : '';
      filePath = await resolveOutputAttachmentLocalPath(button) || filePath;
      try {
        if (window.electronAPI && window.electronAPI.openContainingFolder && filePath && !/^https?:\/\//i.test(filePath) && filePath.indexOf('/api/') !== 0) {
          var result = await window.electronAPI.openContainingFolder(filePath);
          if (!result || result.success !== false) return;
          throw new Error(result.error || '无法打开文件夹');
        }
        if (/^https?:\/\//i.test(filePath)) {
          openExternalUrl(filePath);
          return;
        }
        alert('当前运行环境无法打开本地文件夹，请在桌面版中使用。');
      } catch (e) {
        alert('打开文件夹失败：' + (e.message || e));
      }
    }
    window.openOutputAttachmentFolder = openOutputAttachmentFolder;

    function decodeMessageLinkTarget(value) {
      var target = String(value || '').trim()
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&amp;/gi, '&');
      if (/%[0-9a-f]{2}/i.test(target)) {
        try {
          target = decodeURIComponent(target);
        } catch (e) {
          // Keep the original target when it is not valid percent encoding.
        }
      }
      target = target.trim().replace(/^<([\s\S]*)>$/, '$1').trim();
      if (/^file:\/\/\/[a-zA-Z]:[\\/]/i.test(target)) {
        target = target.replace(/^file:\/\/\//i, '');
      } else if (/^file:\/\/[^/]/i.test(target)) {
        target = '\\\\' + target.replace(/^file:\/\//i, '').replace(/\//g, '\\');
      } else if (/^file:\/\//i.test(target)) {
        target = target.replace(/^file:\/\//i, '');
      }
      return target;
    }

    function isMessageLocalFileLinkTarget(value) {
      var target = decodeMessageLinkTarget(value);
      if (!target || /^https?:\/\//i.test(target) || target.indexOf('/api/') === 0) return false;
      if (/^[a-zA-Z]:[\\/]/.test(target) || /^\\\\[^\\]+\\[^\\]+/.test(target)) return true;
      return /^\/(?!api\/|downloads\/)/.test(target) && isOutputAttachmentPath(target);
    }

    function getMessageImageLinkFileName(value) {
      var target = decodeMessageLinkTarget(value);
      try {
        var parsed = new URL(target, window.location.origin);
        var namedTarget = parsed.searchParams.get('file')
          || parsed.searchParams.get('path')
          || parsed.searchParams.get('name')
          || '';
        if (namedTarget) return getOutputAttachmentFileName(namedTarget);
        return getOutputAttachmentFileName(parsed.pathname);
      } catch (e) {
        return getOutputAttachmentFileName(target);
      }
    }

    function isMessageImagePreviewTarget(value) {
      var target = decodeMessageLinkTarget(value);
      if (!target) return false;
      var fileName = getMessageImageLinkFileName(target);
      return isOutputImagePath(fileName || target);
    }

    function renderMessageMarkdownLink(label, rawTarget) {
      var target = decodeMessageLinkTarget(rawTarget);
      var linkStyle = 'color:var(--link-color);text-decoration:none;border-bottom:1px solid var(--link-color);';
      if (isMessageImagePreviewTarget(target)) {
        var imageName = getMessageImageLinkFileName(target) || '图片预览';
        return '<span class="message-local-file-link message-image-preview-link" role="button" tabindex="0" ' +
          'data-file-path="' + escapeHtml(target) + '" ' +
          'data-preview-url="' + escapeHtml(target) + '" ' +
          'data-file-name="' + escapeHtml(imageName) + '" ' +
          'data-file-kind="image" ' +
          'onclick="return openMessageLocalFileLink(this,event)" ' +
          'onkeydown="return handleMessageLocalFileLinkKeydown(this,event)" ' +
          'title="在右侧栏查看 ' + escapeHtml(imageName) + '">在右侧查看图片</span>';
      }
      if (isMessageLocalFileLinkTarget(target)) {
        return '<span class="message-local-file-link" role="button" tabindex="0" data-file-path="' + escapeHtml(target) + '" onclick="return openMessageLocalFileLink(this,event)" onkeydown="return handleMessageLocalFileLinkKeydown(this,event)" title="使用 Scholar Harness 打开本地文件">' + label + '</span>';
      }
      return '<a href="' + escapeHtml(target || '#') + '" target="_blank" rel="noopener noreferrer" style="' + linkStyle + '">' + label + '</a>';
    }

    function protectInlineLocalFileMarkdownLinks(text) {
      var replacements = [];
      var protectedText = String(text || '').replace(/`\[([^\]\n]+)\]\((?:&lt;([^\n]*?)&gt;|([^)\n]+))\)`/g, function(match, label, angleTarget, plainTarget) {
        var target = angleTarget !== undefined ? angleTarget : plainTarget;
        if (!isMessageLocalFileLinkTarget(target)) return match;
        var token = '§§SCHOLAR_HARNESS_LOCAL_FILE_LINK_' + replacements.length + '§§';
        replacements.push(renderMessageMarkdownLink(label, target));
        return token;
      });
      return { text: protectedText, replacements: replacements };
    }

    async function openMessageLocalFileLink(link, event) {
      if (event && event.preventDefault) event.preventDefault();
      if (event && event.stopPropagation) event.stopPropagation();
      await openOutputAttachmentFile(link);
      return false;
    }

    function handleMessageLocalFileLinkKeydown(link, event) {
      var key = event ? String(event.key || '') : '';
      if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return true;
      void openMessageLocalFileLink(link, event);
      return false;
    }

    window.openMessageLocalFileLink = openMessageLocalFileLink;
    window.handleMessageLocalFileLinkKeydown = handleMessageLocalFileLinkKeydown;

    function isCollapsibleRCodeBlock(language, code) {
      var lang = String(language || '').trim().toLowerCase();
      if (/^(r|rscript|r-lang|rlang)$/.test(lang)) return true;
      if (lang && lang !== 'text' && lang !== 'txt') return false;
      return /\b(?:library\s*\(|ggplot\s*\(|geom_[A-Za-z0-9_]+\s*\(|safe_ggsave\s*\(|ggsave\s*\(|read_excel\s*\(|read\.csv\s*\(|read_csv\s*\()/i.test(String(code || ''))
        || /(?:^|\n)\s*[A-Za-z.][A-Za-z0-9._]*\s*<-/m.test(String(code || ''));
    }

    function renderMessageCodeBlock(language, escapedCode) {
      var lang = String(language || '').trim();
      var code = String(escapedCode || '').replace(/\s+$/g, '');
      var lineCount = code ? code.split(/\r?\n/).length : 0;
      var isPlainTextBlock = /^(text|txt|plain|plaintext)$/i.test(lang);
      if (isCollapsibleRCodeBlock(lang, code)) {
        return '<details class="message-code-collapsible" style="margin:6px 0;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);overflow:hidden;">' +
          '<summary style="display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;padding:7px 10px;color:var(--text-primary);font-size:13px;font-weight:700;line-height:1.35;list-style-position:inside;">' +
            '<span>R 代码</span>' +
            '<span style="font-size:12px;font-weight:500;color:var(--text-secondary);">' + lineCount + ' 行，点击展开/收起</span>' +
          '</summary>' +
          '<pre style="background:var(--code-bg);border-top:1px solid var(--border-color);border-radius:0;margin:0;padding:10px 12px;overflow:auto;max-height:520px;font-family:Consolas, Monaco, monospace;font-size:13px;line-height:1.45;color:var(--text-primary);"><code style="background:none;padding:0;border-radius:0;">' + code + '</code></pre>' +
        '</details>';
      }
      var label = lang ? '<div style="padding:7px 10px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-secondary);background:var(--bg-secondary);">' + lang + '</div>' : '';
      if (isPlainTextBlock) {
        return '<div class="message-code-block message-text-block" style="margin:6px 0;border:1px solid var(--border-color);border-radius:8px;background:var(--code-bg);overflow:hidden;">' +
          label +
          '<pre><code>' + code + '</code></pre>' +
        '</div>';
      }
      return '<div class="message-code-block" style="margin:6px 0;border:1px solid var(--border-color);border-radius:8px;background:var(--code-bg);overflow:hidden;">' +
        label +
        '<pre style="margin:0;padding:10px 12px;overflow:auto;font-family:Consolas, Monaco, monospace;font-size:13px;line-height:1.45;color:var(--text-primary);"><code style="background:none;padding:0;border-radius:0;">' + code + '</code></pre>' +
      '</div>';
    }

    function buildRCodeChatMarkdown(title, intro, rCode) {
      var code = String(rCode || '').trim().replace(/```/g, '` ` `');
      return String(title || '## R 代码') +
        (intro ? '\n\n' + String(intro) : '') +
        '\n\n```r\n' + code + '\n```';
    }

    function splitMessageMarkdownTableRow(line) {
      var value = String(line || '').trim();
      var hasLeadingPipe = value.startsWith('|');
      var hasTrailingPipe = value.endsWith('|') && !value.endsWith('\\|');
      if (hasLeadingPipe) value = value.slice(1);
      if (hasTrailingPipe) value = value.slice(0, -1);
      var escapedPipes = [];
      value = value.replace(/\\\|/g, function() {
        var token = '§§MESSAGE_TABLE_PIPE_' + escapedPipes.length + '§§';
        escapedPipes.push('|');
        return token;
      });
      return value.split('|').map(function(cell) {
        var restored = String(cell || '').trim();
        escapedPipes.forEach(function(pipe, index) {
          restored = restored.replace(new RegExp('§§MESSAGE_TABLE_PIPE_' + index + '§§', 'g'), pipe);
        });
        return restored;
      });
    }

    function isMessageMarkdownTableSeparatorCell(cell) {
      return /^:?-{3,}:?$/.test(String(cell || '').replace(/\s+/g, ''));
    }

    function isMessageMarkdownTableRow(line) {
      var value = String(line || '').trim();
      if (!value || value.indexOf('|') < 0 || /^<[^>]+>/.test(value)) return false;
      return splitMessageMarkdownTableRow(value).length >= 2;
    }

    function renderMessageMarkdownTableBlock(lines) {
      var rows = lines.map(splitMessageMarkdownTableRow);
      var separatorIndex = rows.findIndex(function(cells) {
        return cells.length > 0 && cells.every(isMessageMarkdownTableSeparatorCell);
      });
      var headerIndex = separatorIndex === 1 ? 0 : -1;
      var alignmentCells = separatorIndex >= 0 ? rows[separatorIndex] : [];
      var bodyRows = rows.filter(function(_row, index) {
        return index !== separatorIndex && index !== headerIndex;
      });
      var maxColumns = Math.min(16, Math.max.apply(null, rows.map(function(row) { return row.length; })));

      function getAlignmentStyle(columnIndex) {
        var marker = String(alignmentCells[columnIndex] || '').replace(/\s+/g, '');
        if (/^:-+:$/.test(marker)) return 'text-align:center;';
        if (/^-+:$/.test(marker)) return 'text-align:right;';
        return 'text-align:left;';
      }

      function renderRow(cells, tagName) {
        var renderedCells = [];
        for (var columnIndex = 0; columnIndex < maxColumns; columnIndex++) {
          renderedCells.push(
            '<' + tagName + ' style="' + getAlignmentStyle(columnIndex) + '">' +
              String(cells[columnIndex] || '') +
            '</' + tagName + '>'
          );
        }
        return '<tr>' + renderedCells.join('') + '</tr>';
      }

      var headerHtml = headerIndex >= 0
        ? '<thead>' + renderRow(rows[headerIndex], 'th') + '</thead>'
        : '';
      var bodyHtml = '<tbody>' + bodyRows.map(function(row) {
        return renderRow(row, 'td');
      }).join('') + '</tbody>';
      return '<div class="message-markdown-table-scroll"><table class="message-markdown-table">' +
        headerHtml + bodyHtml +
      '</table></div>';
    }

    function renderMessageMarkdownTables(text) {
      var lines = String(text || '').split('\n');
      var output = [];
      var index = 0;
      while (index < lines.length) {
        if (!isMessageMarkdownTableRow(lines[index])) {
          output.push(lines[index]);
          index += 1;
          continue;
        }
        var block = [];
        var cursor = index;
        while (cursor < lines.length && isMessageMarkdownTableRow(lines[cursor])) {
          block.push(lines[cursor]);
          cursor += 1;
        }
        var hasSeparator = block.some(function(line) {
          return splitMessageMarkdownTableRow(line).every(isMessageMarkdownTableSeparatorCell);
        });
        var hasOuterPipes = block.every(function(line) {
          var value = String(line || '').trim();
          return value.startsWith('|') && value.endsWith('|');
        });
        if (block.length >= 2 && (hasSeparator || hasOuterPipes)) {
          output.push(renderMessageMarkdownTableBlock(block));
        } else {
          Array.prototype.push.apply(output, block);
        }
        index = cursor;
      }
      return output.join('\n');
    }
    
    function formatMessage(text, options) {
      options = options || {};
      var originalText = String(text || '');
      text = originalText;
      // 转义HTML特殊字符
      text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      
      // 处理代码块（必须在其他处理之前）
      var messageCodeBlocks = [];
      text = text.replace(/```(\w*)\n([\s\S]*?)```/g, function(match, language, code) {
        var token = '§§SCHOLAR_HARNESS_CODE_BLOCK_' + messageCodeBlocks.length + '§§';
        messageCodeBlocks.push(renderMessageCodeBlock(language, code));
        return token;
      });

      // Codex often wraps local Markdown file links in backticks. Protect those links
      // before generic inline-code formatting so Chromium never receives a focusable
      // anchor nested inside a fragmented <code> box.
      var protectedLocalFileLinks = protectInlineLocalFileMarkdownLinks(text);
      text = protectedLocalFileLinks.text;

      // Outside fenced code, model-generated alignment whitespace has no semantic
      // value. Keeping it with `pre-wrap` can leave only a few pixels for a
      // continuation line and render words one or two letters per row.
      text = text
        .replace(/^[ \t]+(?=\S)/gm, function(indent) {
          return indent.length <= 3 ? indent : '';
        })
        .replace(/^([•‣◦])\s*\n[ \t]*(?=\S)/gm, '$1 ')
        // Normalize literal or code-wrapped bullets before inline-code rendering.
        // This prevents a list marker from becoming its own rounded code chip.
        .replace(/^(\s*)(?:`([•‣◦])`|([•‣◦]))\s+(?=\S)/gm, '$1- ');
      
      // 处理行内代码
      text = text.replace(/`([^`]+)`/g, function(match, inlineCode) {
        var compactText = String(inlineCode || '')
          .replace(/&(?:amp|lt|gt|quot|#39);/g, 'x')
          .trim();
        var layoutClass = compactText.length <= 48 && compactText.indexOf('\n') === -1
          ? 'is-atomic'
          : 'is-wrap';
        var semanticClass = /\.(?:png|jpe?g|gif|bmp|webp|tiff?|svg|pdf|docx?|xlsx?|csv|tsv|txt|md|markdown|r|rmd|json|tex|latex|html?|pptx?|zip)$/i.test(compactText)
          ? ' is-file-reference'
          : '';
        return '<code class="message-inline-code ' + layoutClass + semanticClass + '">' + inlineCode + '</code>';
      });
      
      // 处理标题（h1-h6）
      text = text.replace(/^###### (.+)$/gm, '<h6 style="font-size:14px;color:#666;margin:8px 0 4px 0;font-weight:600;line-height:1.3;">$1</h6>');
      text = text.replace(/^##### (.+)$/gm, '<h5 style="font-size:15px;color:#555;margin:8px 0 4px 0;font-weight:600;line-height:1.3;">$1</h5>');
      text = text.replace(/^#### (.+)$/gm, '<h4 style="font-size:16px;color:#444;margin:9px 0 4px 0;font-weight:600;line-height:1.3;">$1</h4>');
      text = text.replace(/^### (.+)$/gm, '<h3 style="font-size:18px;color:#333;margin:10px 0 5px 0;font-weight:650;line-height:1.3;">$1</h3>');
      text = text.replace(/^## (.+)$/gm, '<h2 style="font-size:20px;color:#222;margin:10px 0 6px 0;font-weight:700;line-height:1.28;">$1</h2>');
      text = text.replace(/^# (.+)$/gm, '<h1 style="font-size:24px;color:#111;margin:0 0 8px 0;font-weight:750;line-height:1.25;">$1</h1>');
      
      // 处理引用块
      text = text.replace(/^&gt; (.+)$/gm, '<blockquote style="border-left:4px solid #10a37f;margin:12px 0;padding:12px 16px;background:#f8f9fa;color:#555;font-style:italic;border-radius:0 6px 6px 0;">$1</blockquote>');
      
      // 处理列表：按行扫描，避免一两个前导空格让有序列表重新从 1 开始。
      function getMarkdownListLevel(indent) {
        var width = String(indent || '').replace(/\t/g, '    ').length;
        // Model output can occasionally contain copied alignment whitespace.
        // Treat it as Markdown nesting, but never allow it to consume the bubble width.
        return width <= 3 ? 0 : Math.min(3, Math.max(1, Math.floor((width - 2) / 2)));
      }

      function renderMessageListItem(marker, content, level) {
        var safeLevel = Math.min(3, Math.max(0, Number(level) || 0));
        var offset = safeLevel * 20;
        return '<div class="message-list-item" style="margin-left:' + offset + 'px;">' +
          '<span class="message-list-marker">' + marker + '</span>' +
          '<span class="message-list-body">' + content + '</span>' +
        '</div>';
      }

      var orderedCounters = {};
      var orderedListActive = false;
      text = text.split('\n').map(function(line) {
        var orderedMatch = line.match(/^(\s*)(\d+)\. (.+)$/);
        if (orderedMatch) {
          var orderedLevel = getMarkdownListLevel(orderedMatch[1]);
          var declaredNumber = Math.max(1, Number(orderedMatch[2]) || 1);
          Object.keys(orderedCounters).forEach(function(key) {
            if (Number(key) > orderedLevel) delete orderedCounters[key];
          });
          var currentNumber = orderedCounters[orderedLevel] || 0;
          orderedCounters[orderedLevel] = declaredNumber > currentNumber
            ? declaredNumber
            : currentNumber + 1;
          orderedListActive = true;
          return renderMessageListItem(orderedCounters[orderedLevel] + '.', orderedMatch[3], orderedLevel);
        }

        var unorderedMatch = line.match(/^(\s*)[-\*] (.+)$/);
        if (unorderedMatch) {
          orderedCounters = {};
          orderedListActive = false;
          return renderMessageListItem('•', unorderedMatch[2], getMarkdownListLevel(unorderedMatch[1]));
        }

        // Markdown 列表项常用缩进续行展示文件大小、修改时间等元数据。
        // 续行仍属于上一项，不能把下一条有序列表重新从 1 开始。
        var isOrderedContinuation = orderedListActive && /^\s+\S/.test(line);
        if (line.trim() && !isOrderedContinuation) {
          orderedCounters = {};
          orderedListActive = false;
        }
        return line;
      }).join('\n');
      
      // 处理分隔线
      text = text.replace(/^---+$/gm, '<div class="message-section-gap"></div>');
      text = text.replace(/^\*\*\*+$/gm, '<div class="message-section-gap"></div>');
      
      // 处理完整 Markdown 表格。必须生成 table/thead/tbody 容器，不能把裸 tr
      // 交给浏览器修复，否则 Chromium 会把正文拆散到页面的多个列位置。
      text = renderMessageMarkdownTables(text);
      
      // 处理带引用标记的句子（绿色背景）
      text = text.replace(/(\[S\d+\][^\n]*?)✓/g, '<div style="background:rgba(16,163,127,0.15);border-left:3px solid #10a37f;padding:8px 12px;margin:4px 0;border-radius:4px;">$1<span style="color:#10a37f;font-weight:bold;"> ✓</span></div>');
      
      // 处理带检索标记的句子（黄色背景）
      text = text.replace(/(\[S\d+\][^\n]*?)(⚠️|\[需检索:[^\]]+\])/g, '<div style="background:rgba(255,193,7,0.15);border-left:3px solid #ffc107;padding:8px 12px;margin:4px 0;border-radius:4px;">$1<span style="color:#ffc107;font-weight:bold;"> ⚠️</span></div>');
      
      // 处理粗体
      text = text.replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight:600;color:#111;">$1</strong>');
      
      // 处理斜体
      text = text.replace(/\*([^*]+)\*/g, '<em style="font-style:italic;color:#555;">$1</em>');
      
      // 处理删除线
      text = text.replace(/~~(.+?)~~/g, '<del style="text-decoration:line-through;color:#999;">$1</del>');
      
      // 处理链接。Codex 常用 [名称](<D:/path/file.docx>) 输出本地文件，
      // 尖括号经过 HTML 转义后必须恢复为真实路径并交给 Electron 打开。
      text = text.replace(/\[([^\]\n]+)\]\((?:&lt;([^\n]*?)&gt;|([^)\n]+))\)/g, function(match, label, angleTarget, plainTarget) {
        return renderMessageMarkdownLink(label, angleTarget !== undefined ? angleTarget : plainTarget);
      });
      
      // 列表项之间的空行不要扩展成大段落间距
      text = text.replace(/(<\/div>)\n{2,}(?=<div class="message-list-item")/g, '$1\n');
      
      // 处理换行（保留段落间的空行）
      text = text.replace(/\n\n+/g, '</p><p style="margin:4px 0 2px;line-height:26px;">');
      text = text.replace(/\n/g, '<br>');
      text = text.replace(/(<\/h[1-6]>)(?:<br>)+/g, '$1');
      text = text.replace(/(<\/details>)(?:<br>)+/g, '$1');
      text = text.replace(/(<\/div>)(?:<br>)+(?=<(?:h[1-6]|details|div|p)\b)/g, '$1');
      text = text.replace(/<\/div><br>(?=<div class="message-list-item")/g, '</div>');
      messageCodeBlocks.forEach(function(blockHtml, index) {
        text = text.replace(new RegExp('§§SCHOLAR_HARNESS_CODE_BLOCK_' + index + '§§', 'g'), blockHtml);
      });
      protectedLocalFileLinks.replacements.forEach(function(linkHtml, index) {
        text = text.replace(
          new RegExp('§§SCHOLAR_HARNESS_LOCAL_FILE_LINK_' + index + '§§', 'g'),
          function() { return linkHtml; }
        );
      });
      
      // 包装在段落中
      if (
        !text.startsWith('<h')
        && !text.startsWith('<pre')
        && !text.startsWith('<blockquote')
        && !text.startsWith('<div')
        && !text.startsWith('<details')
        && text.indexOf('<div class="message-markdown-table-scroll">') === -1
      ) {
        text = '<p style="margin:4px 0 2px;line-height:26px;">' + text + '</p>';
      }
      
      return text + (options.skipOutputAttachments ? '' : renderOutputAttachmentCards(originalText));
    }
    
    function initApp() {
      // 强制设置spinner颜色
      var spinner = document.getElementById('loadingSpinner');
      if (spinner) {
        var circles = spinner.querySelectorAll('circle');
        if (circles.length >= 2) {
          circles[0].setAttribute('stroke', '#FFFFFF');
          circles[0].setAttribute('opacity', '0.72');
          circles[1].setAttribute('stroke', 'url(#spinnerGradient)');
        }
      }

      if (!currentUserId || currentUserId.indexOf('chat-') === 0) {
        currentUserId = 'web-user';
      }

      // Model configuration is independent from conversation/workspace
      // recovery. Start it first so a later initialization error cannot leave
      // the composer permanently stuck on compatibility defaults.
      var composerConfigBootstrap = Promise.resolve(loadChatBridgeConfig())
        .catch(function(error) {
          console.warn('[Init] Composer model configuration bootstrap failed:', error);
        })
        .finally(function() {
          renderMainContextSourceBar();
          scheduleFirstRunOnboarding(0);
        });
      window.composerConfigBootstrap = composerConfigBootstrap;

      // 兼容旧版本：把已经写入本地、但尚未加入历史列表的会话重新归档。
      recoverLocalConversationsIntoHistory();

      // 软件每次启动都进入新的空对话；历史记录仍保留在右侧列表中，用户可手动打开。
      currentConversationId = createConversationId();
      initializeWorkspaceDirectoryForConversation(currentConversationId, '');
      needsFullPrompt = true;
      window.chatBridgeNeedsNewPage = true;
      bindConversationLifecyclePersistence();
      
      renderHistory();
      refreshConversationHistory();
      activateWorkspaceDirectoryConversation(currentConversationId);
      
      renderMainContextSourceBar();
      mainMetaAnalysisReturnContext = loadMainMetaAnalysisReturnContext(currentConversationId);
      mainAnalysisWorkflowReturnContext = loadMainAnalysisWorkflowReturnContext(currentConversationId);
      renderMainMetaAnalysisReturnBar();
      renderMainAnalysisWorkflowReturnBar();
      syncMainSelectedAnalysisInputPlaceholder();
      
      // 定时刷新桥接状态灯（每5秒）
      setInterval(function() {
        if (chatBridgeConfig.enabled) {
          loadChatBridgeState().catch(function(e) {
            console.warn('Periodic bridge state refresh failed:', e);
          });
        }
      }, 5000);
      
      // 加载当前会话的消息 (复合key)
      var storageKey = MSG_KEY + currentUserId + '_' + currentConversationId;
      var msgs = localStorage.getItem(storageKey);
      
      if (msgs) {
        var messages = JSON.parse(msgs);
        for (var i = 0; i < messages.length; i++) {
          if (messages[i].piQueueId && (messages[i].piStatus === 'queued' || messages[i].piStatus === 'processing')) {
            continue;
          } else {
            appendMessage(
              messages[i].content,
              messages[i].role,
              messages[i].isHtml,
              messages[i].isSystemMessage,
              { usage: messages[i].usage, elapsedMs: messages[i].elapsedMs }
            );
          }
        }
        emptyState.style.display = messages.length > 0 ? 'none' : 'flex';
      } else {
        // 文献库摘要在后台加载，不能阻塞历史记录和输入框。
        emptyState.innerHTML = BRAND_TITLE_HTML + GREETING_HTML + HOME_WORKFLOW_SHORTCUTS_HTML;
        emptyState.style.display = 'flex';
      }
      
      // 加载跨会话共享的文献库（会更新 emptyState 内容）
      loadLiteratureFromServer();
      renderMainChatPiQueue(null);
      syncMainChatPiQueueState({ claimWhenIdle: true });
    }
    
    initApp();
    
    /**
     * 准备 ChatBridge 上下文（和 API Flow 完全一致）
     */
    function registerMainChatAgentResource(context, id, label, metadata) {
      if (!context || !id) return;
      if (!Array.isArray(context.agentResources)) context.agentResources = [];
      var resource = Object.assign({ id: id, label: label || id, access: 'on-demand' }, metadata || {});
      var existingIndex = context.agentResources.findIndex(function(item) { return item && item.id === id; });
      if (existingIndex >= 0) context.agentResources[existingIndex] = Object.assign({}, context.agentResources[existingIndex], resource);
      else context.agentResources.push(resource);
    }

    async function prepareChatBridgeContext(message, isFirstMessage, explicitBibliometricsContext, explicitMetaAnalysisContext, onProgress, routingInput) {
      // 稳定系统规则由后端以真正的 system role 统一注入，前端只发送动态上下文。
      routingInput = routingInput || {};
      var reportPreparationProgress = function(status) {
        if (typeof onProgress === 'function') onProgress(status);
      };
      var intentMessage = String(routingInput.rawMessage || message || '').trim();
      var selectedContextSources = loadMainContextSourceSelection();
      var context = {
        isFirstMessage: isFirstMessage,
        soulContent: null,
        // 普通聊天不再先等待一个独立 AI 意图分类请求。正式 Agent 直接读取
        // CURRENT_USER_REQUEST + QueryEnvelope，并在同一工具循环内决定要使用
        // Skill、MCP、文件、文献库或页面上下文。旧 query-intent 接口仅供
        // 兼容入口、诊断和特殊多模态流程使用。
        taskType: '正式 Agent 负责理解当前请求并按需调用已授权资源；不得把本地规则当作工具调用或禁止调用的语义判决。',
        queryIntent: null,
        agentToolRouting: 'formal-agent',
        queryIntentAuthority: 'formal-agent',
        memory: {},
        writingSkill: null,
        literature: null,
        autonomousRetrieval: null,
        journalStyle: null,
        bibliometrics: null,
        bibliometricsExplicit: false,
        bibliometricsPinned: false,
        metaAnalysis: null,
        metaAnalysisExplicit: false,
        metaAnalysisPinned: false,
        metaAnalysisAgent: null,
        autoResearch: null,
        autoResearchExplicit: false,
        autoResearchPinned: false,
        agentResources: [],
        userSkillPrompt: '',
        invokedUserSkills: [],
        selectedContextSources: selectedContextSources,
        contextSourceStatus: createMainContextSourceStatus(selectedContextSources),
        webSearchContext: null,
        targetVenuePeerReview: null,
        uploadFiles: []
      };

      if (activePdfPaperChatContext) {
        var activePaperResource = Object.assign({}, activePdfPaperChatContext);
        var activePaperLabel = activePaperResource.title || activePaperResource.originalName || '当前论文';
        registerMainChatAgentResource(context, 'current-pdf', '当前论文', {
          selected: true,
          pdfId: activePaperResource.pdfId || activePaperResource.id || '',
          title: activePaperLabel,
          originalName: activePaperResource.originalName || '',
          selectedText: activePaperResource.selectedText || ''
        });
        context.taskType = '用户正在围绕当前打开的单篇 PDF 进行对话。正式 Agent 可在需要核对论文事实时按需读取正文，同时保留主页完整的 Skill、MCP、工作目录、附件和 Pi Agent 调用能力。';
        markMainContextAttached(context, 'pdf-paper-chat', '当前论文', activePaperLabel + '；正文由 Agent 按需读取');
      }
      
      console.log('[Debug] prepareChatBridgeContext: isFirstMessage=' + isFirstMessage + ', message="' + message.substring(0, 50) + '..."');

      var selectedPersistentSkillTokens = loadMainContextSkillSelection();
      try {
        reportPreparationProgress('正在读取已选 Skill 与写作风格…');
        var persistentSkillContext = await buildPersistentMainContextSkillContext();
        if (persistentSkillContext.prompt) {
          context.userSkillPrompt = persistentSkillContext.prompt;
          context.invokedUserSkills = persistentSkillContext.entries || [];
          var attachedSkillLabels = context.invokedUserSkills.map(function(skill) {
            return skill.name || skill.trigger || skill.token || 'Skill';
          }).filter(Boolean);
          markMainContextAttached(
            context,
            'skills',
            'Skill / 写作风格',
            attachedSkillLabels.length ? attachedSkillLabels.join('；') : '已附加固定 Skill'
          );
          console.log('[UserSkills] Persistent context skills attached:', context.invokedUserSkills.map(function(skill) { return skill.name || skill.trigger || skill.token; }).join(', '));
        } else if (selectedPersistentSkillTokens.length > 0) {
          markMainContextMissing(context, 'skills', 'Skill / 写作风格', '已选择的 Skill/章节风格没有可用内容或已被禁用');
        }
      } catch (e) {
        console.warn('[UserSkills] Failed to attach persistent context skills:', e);
        if (selectedPersistentSkillTokens.length > 0) {
          markMainContextMissing(context, 'skills', 'Skill / 写作风格', e.message || '读取固定 Skill 失败');
        }
      }
      
      if (isFirstMessage && chatBridgeConfig.enabled) {
        reportPreparationProgress('正在加载首轮上下文文件…');
        context.uploadFiles = await uploadContextFiles(message);
      }
      
      reportPreparationProgress('正在匹配论文写作 Skill…');
      context.writingSkill = await loadWritingSkillAsync(intentMessage);
      
      var soulData = localStorage.getItem('scholarclaw_soul');
      if (soulData) {
        try {
          context.soulContent = JSON.parse(soulData).content;
        } catch (e) {}
      }
      
      // 长期记忆由 /api/chat-bridge/chat 在服务端统一加载、筛选和写回。
      // 前端不再预取同一份记忆及历史会话，避免重复 I/O、重复 Prompt 和并发写入。

      try {
        if (typeof buildRecentRPlotContextForChat === 'function') {
          context.rPlot = buildRecentRPlotContextForChat();
        }
      } catch (e) {
        console.warn('Failed to attach recent R plot context:', e);
      }
      
      // 从 localStorage 读取期刊风格
      var journalData = localStorage.getItem('scholarclaw_journal_' + currentUserId);
      if (journalData) {
        try {
          context.journalStyle = JSON.parse(journalData);
        } catch (e) {
          console.warn('Failed to load journal style:', e);
        }
      }
      
      // 只读取文献库轻量概况。正式 Agent 决定何时检索，不预取论文或摘要。
      try {
        reportPreparationProgress('正在读取文献库概况…');
        var litResponse = await fetch('/api/literature/' + encodeURIComponent(currentUserId || 'web-user') + '?summaryOnly=1');
        if (litResponse.ok) {
          var litData = await litResponse.json();
          if (litData.exists || litData.summary) {
            context.literature = {
              count: litData.summary?.count || 0,
              summary: litData.summary,
              recent: [],
              access: 'formal-agent-tool'
            };
          }
        }
      } catch (e) {
        console.warn('Failed to load literature:', e);
      }

      if (explicitBibliometricsContext) {
        registerMainChatAgentResource(context, 'bibliometrics', getMainContextSourceLabel('bibliometrics'), {
          selected: true,
          source: 'slash-command'
        });
        markMainContextAttached(context, 'bibliometrics', getMainContextSourceLabel('bibliometrics'), '已授权，由正式 Agent 按需读取');
      } else if (selectedContextSources.bibliometrics) {
        registerMainChatAgentResource(context, 'bibliometrics', getMainContextSourceLabel('bibliometrics'), {
          selected: true,
          source: 'persistent-selection'
        });
        markMainContextAttached(context, 'bibliometrics', getMainContextSourceLabel('bibliometrics'), '已选择，由正式 Agent 按需读取');
      }

      if (explicitMetaAnalysisContext) {
        registerMainChatAgentResource(context, 'meta-analysis', getMainContextSourceLabel('metaAnalysis'), {
          selected: true,
          source: 'slash-command'
        });
        markMainContextAttached(context, 'metaAnalysis', getMainContextSourceLabel('metaAnalysis'), '已授权，由正式 Agent 按需读取');
      } else if (selectedContextSources.metaAnalysis) {
        var pinnedMetaAnalysisMissingMarked = false;
        var metaAnalysisDatasetAttached = false;
        try {
          reportPreparationProgress('正在整理已选 Meta 分析数据…');
          var metaAnalysisDatasetContext = await loadMainMetaAnalysisDatasetContext(routingInput.workspaceDirectory || null);
          if (metaAnalysisDatasetContext) {
            context.metaAnalysisAgent = metaAnalysisDatasetContext;
            metaAnalysisDatasetAttached = true;
            registerMainChatAgentResource(context, 'meta-analysis', getMainContextSourceLabel('metaAnalysis'), {
              selected: true,
              source: 'persistent-selection',
              scope: {
                selectionMode: metaAnalysisDatasetContext.selectionMode,
                selectedPdfIds: metaAnalysisDatasetContext.selectedPdfIds || [],
                pdfCount: metaAnalysisDatasetContext.dataset ? metaAnalysisDatasetContext.dataset.pdfCount : 0,
                rowCount: metaAnalysisDatasetContext.dataset ? metaAnalysisDatasetContext.dataset.rowCount : 0
              }
            });
            markMainContextAttached(
              context,
              'metaAnalysis',
              getMainContextSourceLabel('metaAnalysis'),
              (metaAnalysisDatasetContext.selectionMode === 'selected' ? 'Meta 页面已选 ' : 'Meta 页面全部 ') +
                metaAnalysisDatasetContext.dataset.pdfCount + ' 篇 PDF；' +
                metaAnalysisDatasetContext.dataset.rowCount + ' 行提取数据'
            );
          }
        } catch (error) {
          console.warn('Failed to load selected Meta dataset scope:', error);
          markMainContextMissing(
            context,
            'metaAnalysis',
            getMainContextSourceLabel('metaAnalysis'),
            error.message || '读取 Meta 页面提取数据失败'
          );
          pinnedMetaAnalysisMissingMarked = true;
        }
        if (!metaAnalysisDatasetAttached && !pinnedMetaAnalysisMissingMarked) {
          markMainContextMissing(context, 'metaAnalysis', getMainContextSourceLabel('metaAnalysis'), 'Meta 页面没有可用的已提取表格数据');
        }
      }

      if (selectedContextSources.autoResearch) {
        registerMainChatAgentResource(context, 'auto-research', getMainContextSourceLabel('autoResearch'), {
          selected: true,
          source: 'persistent-selection'
        });
        markMainContextAttached(context, 'autoResearch', getMainContextSourceLabel('autoResearch'), '已选择，由正式 Agent 按需读取');
      }

      try {
        reportPreparationProgress('正在核对目标期刊与审稿上下文…');
        context.targetVenuePeerReview = await ensureTargetVenuePeerReviewContext(message);
        if (context.targetVenuePeerReview) {
          console.log('[TargetVenueReview] Context attached:', {
            venue: context.targetVenuePeerReview.venue || '',
            sources: Array.isArray(context.targetVenuePeerReview.sources) ? context.targetVenuePeerReview.sources.length : 0,
            explicitVenue: context.targetVenuePeerReview.explicitVenue || ''
          });
        }
      } catch (e) {
        console.warn('[TargetVenueReview] Failed to attach target venue context:', e);
      }
      
      // 文献检索由正式 Agent 在工具循环中按需调用。前端不再根据路由建议预检索或注入证据正文。
      
      return context;
    }

    async function loadBibliometricsWritingContext() {
      var params = new URLSearchParams({
        userId: currentUserId || 'web-user',
        topN: '100',
        keywordNodeLimit: '120',
        authorNodeLimit: '100',
        edgeLimit: '400',
        similarityNodeLimit: '120',
        similarityEdgeLimit: '300',
        keywordTrendLimit: '12'
      });
      var response = await fetch('/api/bibliometrics/writing-context?' + params.toString());
      var data = await response.json();
      if (!response.ok || !data.success || !data.available || !data.context) {
        console.warn('[Bibliometrics] Writing context unavailable:', data && (data.error || data.message));
        return null;
      }
      return {
        generatedAt: data.context.generatedAt,
        source: data.context.source,
        available: data.context.available,
        dataset: data.context.dataset,
        figures: data.context.figures,
        tables: data.context.tables,
        exports: data.context.exports,
        contextMarkdown: data.context.contextMarkdown
      };
    }

    async function loadMainMetaAnalysisDatasetContext(workspaceDirectory) {
      var scope = loadMainMetaAnalysisDataScope();
      var response = await fetch('/api/pdf-wiki/meta?userId=' + encodeURIComponent(currentUserId || 'web-user') + '&summary=1');
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok || data.success === false) {
        throw new Error(data.error || '读取 Meta 页面提取数据失败');
      }
      var items = (Array.isArray(data.items) ? data.items : []).filter(function(item) {
        return item && item.pdfId && Number(item.dataTable && item.dataTable.rowCount || 0) > 0;
      });
      if (scope.mode === 'selected') {
        var selectedIdSet = {};
        scope.pdfIds.forEach(function(pdfId) { selectedIdSet[pdfId] = true; });
        items = items.filter(function(item) { return !!selectedIdSet[item.pdfId]; });
      }
      var pdfIds = items.map(function(item) { return String(item.pdfId); });
      if (pdfIds.length === 0) return null;
      var rowCount = items.reduce(function(total, item) {
        return total + Number(item.dataTable && item.dataTable.rowCount || 0);
      }, 0);
      var tableCount = items.reduce(function(total, item) {
        var count = Number(item.dataTable && item.dataTable.tableCount || item.tableCount || 0);
        return total + (count > 0 ? count : 1);
      }, 0);
      return {
        enabled: true,
        page: 'homepage-meta-context',
        selectionMode: scope.mode,
        selectionSource: scope.source,
        conversationId: currentConversationId || '',
        writingConversationId: currentConversationId || '',
        selectedPdfIds: pdfIds,
        dataset: {
          pdfCount: pdfIds.length,
          tableCount: tableCount,
          rowCount: rowCount
        },
        selectedPapers: items.slice(0, 24).map(function(item) {
          return {
            pdfId: item.pdfId,
            title: item.title || item.originalName || item.pdfId,
            rowCount: Number(item.dataTable && item.dataTable.rowCount || 0)
          };
        }),
        workspaceDirectory: workspaceDirectory || null,
        selectedContextSources: loadMainContextSourceSelection(),
        selectedSkills: loadMainContextSkillSelection(),
        capabilityNote: scope.mode === 'selected'
          ? '使用用户在 Meta 页面明确勾选的文献提取表格。先理解 query，再决定检查字段、调用 Skill/MCP 或运行 Meta 分析。'
          : '使用 Meta 页面当前所有文献的已提取表格数据。先理解 query，再决定检查字段、调用 Skill/MCP 或运行 Meta 分析。'
      };
    }

    function metaAnalysisContextMatchesDatasetScope(metaAnalysisContext, datasetContext) {
      if (!metaAnalysisContext || !datasetContext) return false;
      var resultIds = Array.isArray(metaAnalysisContext.sourcePdfIds)
        ? metaAnalysisContext.sourcePdfIds.map(function(value) { return String(value || '').trim(); }).filter(Boolean)
        : [];
      var selectedIds = Array.isArray(datasetContext.selectedPdfIds)
        ? datasetContext.selectedPdfIds.map(function(value) { return String(value || '').trim(); }).filter(Boolean)
        : [];
      if (resultIds.length === 0 || resultIds.length !== selectedIds.length) return false;
      var selectedSet = {};
      selectedIds.forEach(function(pdfId) { selectedSet[pdfId] = true; });
      return resultIds.every(function(pdfId) { return !!selectedSet[pdfId]; });
    }

    async function loadMetaAnalysisWritingContext() {
      var params = new URLSearchParams({ userId: currentUserId || 'web-user' });
      if (currentConversationId) params.set('conversationId', currentConversationId);
      var response = await fetch('/api/meta-analysis/writing-context?' + params.toString());
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok || !data.success || !data.data || !data.data.available) {
        console.warn('[MetaAnalysis] Writing context unavailable:', data && (data.error || data.message));
        return null;
      }
      return {
        analysisId: data.data.analysisId,
        conversationId: data.data.conversationId,
        workspaceId: data.data.workspaceId,
        sourcePdfIds: data.data.sourcePdfIds,
        generatedAt: data.data.generatedAt,
        source: data.data.source,
        available: data.data.available,
        dataset: data.data.dataset,
        config: data.data.config,
        summaries: data.data.summaries,
        quality: data.data.quality,
        effectRows: data.data.effectRows,
        skippedRows: data.data.skippedRows,
        skippedCount: data.data.skippedCount,
        markdown: data.data.markdown,
        rArtifacts: data.data.rArtifacts,
        exports: data.data.exports,
        contextMarkdown: data.data.contextMarkdown
      };
    }

    async function loadAutoResearchWritingContext() {
      var params = new URLSearchParams({ userId: currentUserId || 'web-user' });
      var response = await fetch('/api/autoresearch/writing-context?' + params.toString());
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok || !data.success || !data.context || !data.context.available) {
        console.warn('[AutoResearch] Writing context unavailable:', data && (data.error || data.message));
        return null;
      }
      return {
        generatedAt: data.context.generatedAt,
        source: data.context.source,
        available: data.context.available,
        dataset: data.context.dataset,
        latestFinalReport: data.context.latestFinalReport,
        latestPaperDraft: data.context.latestPaperDraft,
        latestAudit: data.context.latestAudit,
        contextMarkdown: data.context.contextMarkdown
      };
    }
    
    /**
     * 检测任务类型（和 API Flow 一致）
     */
    function detectTaskType(message, queryIntent) {
      var lowerMsg = String(message || '').toLowerCase();
      if (isTargetVenuePeerReviewIntent(message)) {
        return '用户正在进行目标期刊/会议导向的论文审稿或投稿前评估。必须以用户上传论文为证据，并先加载目标期刊严格审稿 Skill。';
      }
      if (queryIntent && queryIntent.primaryIntent === 'workspace_file') {
        return '用户正在查找、读取或处理工作目录文件。必须结合最近对话解析“这个/除了这个/还有呢”等指代，同时检索用户配置目录和当前会话 AI 工作目录；如用户要求最新或下一个文件，按实际 mtime 排序，并遵守 excludedFiles。不得把文件名当作学术主题擅自触发文献检索。';
      }
      if (queryIntent && queryIntent.primaryIntent === 'literature_collection') {
        return '用户请求采集外部新文献，但主页聊天输入框暂不开放 WoS/CNKI 外部采集。不要调用 collect_literature_by_topic，也不要改走 Embedding 文献库或 PDF Wiki；简洁说明该入口暂未开放。';
      }
      if (queryIntent && queryIntent.primaryIntent === 'literature_retrieval') {
        return '用户明确需要学术文献、引用或证据检索。优先使用本轮已经自动附加的本地证据，再完成回答或写作。';
      }
      if (queryIntent && queryIntent.primaryIntent === 'meta_analysis') {
        return '用户正在进行 Meta 分析、效应量计算或 Meta 结果解释；使用对应数据与分析工具完成实际任务。';
      }
      if (queryIntent && queryIntent.primaryIntent === 'bibliometrics') {
        return '用户正在进行文献计量或知识结构分析；使用文献计量上下文和对应工具完成实际任务。';
      }
      if (queryIntent && queryIntent.primaryIntent === 'pdf_wiki') {
        return '用户正在操作 PDF 句子级 Wiki 证据库；必须依据证据句、文中引用与参考文献映射回答，不能猜测引用编号。';
      }
      if (queryIntent && queryIntent.primaryIntent === 'r_plot') {
        return '用户正在进行 R 作图、图形复现或图形修改；读取实际数据/脚本并调用对应工具，保持用户确认的分组配色。';
      }
      if (queryIntent && queryIntent.primaryIntent === 'data_analysis') {
        return '用户正在进行数据或统计分析；读取实际附件/工作目录数据并执行对应分析，不能只描述计划。';
      }
      if (queryIntent && queryIntent.primaryIntent === 'multimodal_task') {
        return '用户提供了图片等多模态材料；先理解材料在 query 中的作用，再结合原始 query 执行后续分析、文件或作图动作，不能看完图片就停止。';
      }
      if (queryIntent && queryIntent.primaryIntent === 'project_management') {
        return '用户正在创建、导入、切换或维护项目状态；使用项目和工作目录能力完成操作。';
      }
      if (queryIntent && queryIntent.primaryIntent === 'academic_writing') {
        if (/(?:引言|绪论)|\b(?:introduction|intro)\b/i.test(lowerMsg)) {
          return '用户想要写 Introduction（引言）部分。必须先生成检索词并检索 Embedding 文献库和 PDF Wiki，再把背景、研究现状与知识缺口论断逐项匹配到合适文献；如果还需读取工作目录文件，直接调用文件检索工具，不要要求用户点击齿轮或再次确认只读检索。';
        }
        if (/(?:讨论)|\bdiscussion\b/i.test(lowerMsg)) {
          return '用户想要写 Discussion（讨论）部分。必须先使用本轮生成的检索词检索 Embedding 文献库和 PDF Wiki，再将每个解释、比较和机制论断与合适文献逐项匹配后写作。';
        }
        if (/(?:方法|材料与方法)|\b(?:method|methods|methodology)\b/i.test(lowerMsg)) {
          return '用户想要写 Methods（方法）部分。';
        }
        if (/(?:结果)|\b(?:result|results)\b/i.test(lowerMsg)) {
          return '用户想要写 Results（结果）部分。';
        }
        return '用户正在进行学术写作、修改或润色；遵守引用校验和当前文章结构，只有统一意图明确要求时才补充检索文献。';
      }
      if (queryIntent && queryIntent.primaryIntent === 'skill_or_tool') {
        return '用户正在调用或配置 Skill/工具；只有消息开头被解析出的 / 或 @ 才算显式调用，并执行对应能力。';
      }
      return '用户提出了一般问题或后续指令。直接围绕当前 query 和最近对话回答；除非统一 Query 意图明确要求，不要额外触发文献检索。';
    }
    
    /**
     * 加载写作技能（异步版本，从服务器读取实际文件）
     */
    function detectSkillChapterFromMessage(message) {
      var lowerMsg = String(message || '').toLowerCase();
      var explicitSkill = lowerMsg.match(/(?:\/\+?skill:|写作技能:\s*)([^\s\n]+)/i);
      if (explicitSkill) {
        return normalizeSkillChapterType(explicitSkill[1]);
      }

      var patterns = [
        { chapter: 'introduction', regex: /(^|[\s，。,.!?！？;；:：])(?:introduction|intro|引言|绪论)(?=$|[\s，。,.!?！？;；:：])/i },
        { chapter: 'abstract', regex: /(^|[\s，。,.!?！？;；:：])(?:abstract|summary|摘要)(?=$|[\s，。,.!?！？;；:：])/i },
        { chapter: 'methods', regex: /(^|[\s，。,.!?！？;；:：])(?:methods|method|methodology|materials|材料与方法|方法)(?=$|[\s，。,.!?！？;；:：])/i },
        { chapter: 'results', regex: /(^|[\s，。,.!?！？;；:：])(?:results|result|结果)(?=$|[\s，。,.!?！？;；:：])/i },
        { chapter: 'discussion', regex: /(^|[\s，。,.!?！？;；:：])(?:discussion|讨论)(?=$|[\s，。,.!?！？;；:：])/i },
        { chapter: 'conclusion', regex: /(^|[\s，。,.!?！？;；:：])(?:conclusions|conclusion|结论)(?=$|[\s，。,.!?！？;；:：])/i },
        { chapter: 'title', regex: /(^|[\s，。,.!?！？;；:：])(?:title|标题|题目)(?=$|[\s，。,.!?！？;；:：])/i }
      ];

      for (var i = 0; i < patterns.length; i++) {
        if (patterns[i].regex.test(lowerMsg)) {
          return patterns[i].chapter;
        }
      }

      return null;
    }

    async function loadWritingSkillAsync(message) {
      var chapterType = detectSkillChapterFromMessage(message);
      
      if (!chapterType) {
        return null;
      }
      
      try {
        var response = await fetch('/api/skill/' + encodeURIComponent(chapterType));
        if (response.ok) {
          var data = await response.json();
          if (data.success && data.content) {
            console.log('[Skill] Loaded skill for', chapterType, ':', data.content.length, 'chars');
            return {
              chapter: chapterType,
              content: data.content
            };
          }
        }
      } catch (e) {
        console.warn('[Skill] Failed to load skill:', e.message);
      }
      
      return null;
    }
    
    /**
     * 加载写作技能（简化版，与 API Flow 一致）
     */
    function loadWritingSkill(message) {
      var chapterType = detectSkillChapterFromMessage(message);
      var skillMap = {
        'introduction': { chapter: 'Introduction', file: '03_introduction_skill.md' },
        'intro': { chapter: 'Introduction', file: '03_introduction_skill.md' },
        'methods': { chapter: 'Methods', file: '04_methods_skill.md' },
        'method': { chapter: 'Methods', file: '04_methods_skill.md' },
        'results': { chapter: 'Results', file: '05_results_skill.md' },
        'result': { chapter: 'Results', file: '05_results_skill.md' },
        'discussion': { chapter: 'Discussion', file: '07_discussion_skill.md' },
        'conclusion': { chapter: 'Conclusion', file: '08_conclusion_skill.md' },
        'abstract': { chapter: 'Abstract', file: '02_abstract_skill.md' },
        'title': { chapter: 'Title', file: '01_title_skill.md' }
      };
      
      if (chapterType && skillMap[chapterType]) {
        return {
          chapter: skillMap[chapterType].chapter,
          file: skillMap[chapterType].file
        };
      }
      return null;
    }
    
    /**
     * 上传上下文文件到 OpenClaw
     * 返回需要上传的文件列表
     */
    async function uploadContextFiles(message) {
      var filesToUpload = [];
      
      // 1. 上传写作技能文件
      var skillFiles = {
        'title': '01_title_skill.md',
        'introduction': '03_introduction_skill.md',
        'intro': '03_introduction_skill.md',
        'methods': '04_methods_skill.md',
        'method': '04_methods_skill.md',
        'results': '05_results_skill.md',
        'result': '05_results_skill.md',
        'discussion': '07_discussion_skill.md',
        'reference-relevance': '10_reference_relevance_constraint_skill.md',
        'conclusion': '08_conclusion_skill.md',
        'abstract': '02_abstract_skill.md'
      };
      
      var detectedChapter = detectSkillChapterFromMessage(message);
      for (var key in skillFiles) {
        if (detectedChapter === normalizeSkillChapterType(key)) {
          filesToUpload.push({
            type: 'skill',
            chapter: detectedChapter,
            filePath: 'sci_writing_skills/' + skillFiles[key]
          });
          break;
        }
      }
      
      // 2. 上传记忆文件
      filesToUpload.push({
        type: 'memory',
        filePath: 'data/memory/web-user/memory.json'
      });
      
      // 3. 上传最近对话
      filesToUpload.push({
        type: 'conversation',
        filePath: 'data/memory/web-user/conversations'
      });
      
      // 4. 上传期刊风格
      filesToUpload.push({
        type: 'journal',
        filePath: 'data/uploads/web-user/journal-styles'
      });
      
      console.log('[Upload] Files to upload:', filesToUpload);
      return filesToUpload;
    }
    
    async function loadChatBridgeState() {
      try {
        var response = await fetch('/api/chat-bridge/state');
        var data = await response.json();
        if (data.success && data.state) {
          chatBridgeState = {
            paused: !!data.state.paused,
            currentUrl: data.state.currentUrl || null,
            hasActivePage: !!data.state.hasActivePage,
            serviceRunning: !!data.state.serviceRunning
          };
        }
      } catch (e) {
        console.warn('Failed to load chat bridge state:', e);
      }
      updateChatBridgeButton();
      return chatBridgeState;
    }

    async function controlChatBridge(action) {
      var response = await fetch('/api/chat-bridge/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action })
      });
      var data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || '桥接控制失败');
      }
      if (data.state) {
        chatBridgeState = {
          paused: !!data.state.paused,
          currentUrl: data.state.currentUrl || null,
          hasActivePage: !!data.state.hasActivePage,
          serviceRunning: !!data.state.serviceRunning
        };
      }
      updateChatBridgeButton();
      return data;
    }

    async function syncNewChatToBridge() {
      if (!chatBridgeConfig.enabled) return;
      try {
        await controlChatBridge('newchat');
        console.log('[NewChat] ChatBridge newchat synced');
      } catch (e) {
        console.warn('[NewChat] ChatBridge newchat sync failed:', e.message);
      }
    }

    async function pauseChatBridge() {
      return controlChatBridge('pause');
    }

    async function resumeChatBridge() {
      return controlChatBridge('resume');
    }

    async function refreshChatBridgeViaApi() {
      return controlChatBridge('refresh');
    }

    function mergeCachedChatBridgeConfig(localConfig) {
      if (!localConfig || typeof localConfig !== 'object' || Array.isArray(localConfig)) return false;
      ['primary', 'secondary', 'secondaryVision', 'codex'].forEach(function(key) {
        if (localConfig[key] && typeof localConfig[key] === 'object' && !Array.isArray(localConfig[key])) {
          chatBridgeConfig[key] = Object.assign({}, chatBridgeConfig[key] || {}, localConfig[key]);
        }
      });
      var cachedRuntimes = localConfig.agentRuntimes || localConfig.agent_runtimes;
      if (cachedRuntimes && typeof cachedRuntimes === 'object' && !Array.isArray(cachedRuntimes)) {
        chatBridgeConfig.agentRuntimes = Object.assign({}, chatBridgeConfig.agentRuntimes || {}, cachedRuntimes);
        ['codex', 'pi', 'opencode'].forEach(function(runtimeId) {
          if (cachedRuntimes[runtimeId] && typeof cachedRuntimes[runtimeId] === 'object') {
            chatBridgeConfig.agentRuntimes[runtimeId] = Object.assign(
              {},
              chatBridgeConfig.agentRuntimes[runtimeId] || {},
              cachedRuntimes[runtimeId]
            );
          }
        });
      }
      ['chatUrl', 'mode', 'credentials', 'apiUrl', 'hasApiKey'].forEach(function(key) {
        if (localConfig[key] !== undefined) chatBridgeConfig[key] = localConfig[key];
      });
      if (typeof localConfig.enabled === 'boolean') chatBridgeConfig.enabled = localConfig.enabled;
      if (typeof localConfig.useForChat === 'boolean') chatBridgeConfig.useForChat = localConfig.useForChat;
      return true;
    }

    function hydrateChatBridgeConfigFromStorage() {
      try {
        var raw = localStorage.getItem(CHAT_BRIDGE_KEY);
        return raw ? mergeCachedChatBridgeConfig(JSON.parse(raw)) : false;
      } catch (error) {
        console.warn('[ChatBridge] Ignoring invalid cached model configuration:', error);
        return false;
      }
    }

    function persistChatBridgeConfigSnapshot() {
      try {
        localStorage.setItem(CHAT_BRIDGE_KEY, JSON.stringify(chatBridgeConfig));
      } catch (error) {
        console.warn('[ChatBridge] Failed to cache model configuration:', error);
      }
    }

    async function loadChatBridgeConfig() {
      // Cold start must render the last known model pool synchronously. The
      // server response remains authoritative and overwrites this snapshot.
      hydrateChatBridgeConfigFromStorage();
      var loadedServerConfig = false;
      try {
        var response = await fetch('/api/chat-bridge/config', { cache: 'no-store' });
        var data = await response.json();
        if (!response.ok || !data.success || !data.config) {
          throw new Error(data.error || ('HTTP ' + response.status));
        }
        if (data.success && data.config) {
          loadedServerConfig = true;
          // 旧的浏览器模式字段（向后兼容）
          chatBridgeConfig.chatUrl = data.config.chat_url || '';
          chatBridgeConfig.mode = data.config.mode || 'api';
          chatBridgeConfig.credentials = data.config.credentials || { email: '', has_password: false };
          chatBridgeConfig.apiUrl = data.config.api_url || '';
          chatBridgeConfig.hasApiKey = data.config.has_api_key || false;
          
          // ========== 加载草原/小牛马配置 ==========
          // 草原配置
          if (data.config.primary) {
            chatBridgeConfig.primary = {
              apiUrl: data.config.primary.api_url || '',
              hasApiKey: data.config.primary.has_api_key || false,
              model: data.config.primary.model || 'openrouter/free',
              description: data.config.primary.description || 'Grass - OpenRouter 免费模型',
              pool: data.config.primary.pool || undefined
            };
          }
          // 小牛马配置
          if (data.config.secondary) {
            chatBridgeConfig.secondary = {
              apiUrl: data.config.secondary.api_url || '',
              hasApiKey: data.config.secondary.has_api_key || false,
              model: data.config.secondary.model || 'gpt-4o',
              description: data.config.secondary.description || 'Little corse - 引用验证、更新记忆',
              pool: data.config.secondary.pool || undefined
            };
          }
          if (data.config.secondary_vision) {
            chatBridgeConfig.secondaryVision = {
              apiUrl: data.config.secondary_vision.api_url || '',
              hasApiKey: data.config.secondary_vision.has_api_key || false,
              model: data.config.secondary_vision.model || 'gpt-4o',
              description: data.config.secondary_vision.description || 'Little corse 视觉 - 图片、图表截图、多模态输入',
              pool: data.config.secondary_vision.pool || undefined
            };
            var localVisionConfig = loadSecondaryVisionApiConfig();
            if (data.config.secondary_vision.api_url || data.config.secondary_vision.model) {
              secondaryVisionApiConfig.url = data.config.secondary_vision.api_url || localVisionConfig.url || '';
              secondaryVisionApiConfig.key = localVisionConfig.key || '';
              secondaryVisionApiConfig.model = data.config.secondary_vision.model || localVisionConfig.model || 'gpt-4o';
              localStorage.setItem(SECONDARY_VISION_API_KEY, JSON.stringify(secondaryVisionApiConfig));
            }
          }
          if (data.config.codex) {
            chatBridgeConfig.codex = {
              enabled: !!data.config.codex.enabled,
              prefer: !!data.config.codex.prefer,
              command: data.config.codex.command || '',
              model: data.config.codex.model || 'gpt-5.5',
              reasoning_effort: data.config.codex.reasoning_effort || 'xhigh',
              sandbox: data.config.codex.sandbox || 'workspace-write',
              pdf_wiki_sandbox: data.config.codex.pdf_wiki_sandbox || 'danger-full-access',
              timeout_ms: Number(data.config.codex.timeout_ms || 300000),
              pdf_wiki_concurrency: Math.max(1, Math.min(6, parseInt(data.config.codex.pdf_wiki_concurrency || data.config.codex.concurrency || 1, 10) || 1))
            };
          }
          if (data.config.agent_runtimes) {
            chatBridgeConfig.agentRuntimes = {
              default: data.config.agent_runtimes.default || '',
              codex: Object.assign({}, chatBridgeConfig.agentRuntimes?.codex || {}, chatBridgeConfig.codex || {}, data.config.agent_runtimes.codex || {}),
              pi: Object.assign({}, chatBridgeConfig.agentRuntimes?.pi || {}, data.config.agent_runtimes.pi || {}),
              opencode: Object.assign({}, chatBridgeConfig.agentRuntimes?.opencode || {}, data.config.agent_runtimes.opencode || {})
            };
          }
          
          console.log('[ChatBridge] Loaded config from server:', {
            chatUrl: chatBridgeConfig.chatUrl ? '已配置' : '空',
            apiUrl: chatBridgeConfig.apiUrl ? '已配置' : '空',
            hasApiKey: chatBridgeConfig.hasApiKey,
            mode: chatBridgeConfig.mode,
            primary: chatBridgeConfig.primary ? {
              url: chatBridgeConfig.primary.apiUrl ? '已配置' : '空',
              hasKey: chatBridgeConfig.primary.hasApiKey,
              model: chatBridgeConfig.primary.model
            } : '未配置',
            secondary: chatBridgeConfig.secondary ? {
              url: chatBridgeConfig.secondary.apiUrl ? '已配置' : '空',
              hasKey: chatBridgeConfig.secondary.hasApiKey,
              model: chatBridgeConfig.secondary.model
            } : '未配置',
            secondaryVision: chatBridgeConfig.secondaryVision ? {
              url: chatBridgeConfig.secondaryVision.apiUrl ? '已配置' : '空',
              hasKey: chatBridgeConfig.secondaryVision.hasApiKey,
              model: chatBridgeConfig.secondaryVision.model
            } : '未配置',
            codex: chatBridgeConfig.codex ? {
              enabled: chatBridgeConfig.codex.enabled,
              prefer: chatBridgeConfig.codex.prefer,
              command: chatBridgeConfig.codex.command || '(默认 codex)',
              pdfWikiConcurrency: chatBridgeConfig.codex.pdf_wiki_concurrency || 1
            } : '未配置'
          });
        }
      } catch (e) {
        console.warn('Failed to load chat bridge config from server:', e);
      }

      // A successful server read becomes the complete cold-start fallback for
      // the next launch. Never replace it with defaults after a transient error.
      if (loadedServerConfig) persistChatBridgeConfigSnapshot();
      
      // 自动启用：如果服务器配置完整且本地未显式禁用，则自动启用
      var hasServerConfig = chatBridgeConfig.chatUrl && 
                            chatBridgeConfig.chatUrl.trim() !== '' &&
                            chatBridgeConfig.credentials && 
                            chatBridgeConfig.credentials.email &&
                            chatBridgeConfig.credentials.has_password;
      
      // 如果服务器配置完整，且用户没有在本地显式禁用（enabled === false），则自动启用
      if (hasServerConfig && chatBridgeConfig.enabled !== false) {
        chatBridgeConfig.enabled = true;
        console.log('[ChatBridge] Auto-enabled: server config is complete');
      }
      
      // 验证 ChatBridge 是否真正可用
      // 只有当同时满足以下条件时，ChatBridge 才被视为可用：
      // 1. 用户启用了 ChatBridge
      // 2. 配置了有效的 chatUrl
      // 3. 配置了凭据（email 和 password）
      var isReallyAvailable = chatBridgeConfig.enabled &&
                               chatBridgeConfig.chatUrl &&
                               chatBridgeConfig.chatUrl.trim() !== '' &&
                               chatBridgeConfig.credentials &&
                               chatBridgeConfig.credentials.email &&
                               chatBridgeConfig.credentials.has_password;
      
      console.log('[ChatBridge] Config loaded:', {
        enabled: chatBridgeConfig.enabled,
        hasUrl: !!chatBridgeConfig.chatUrl,
        hasCredentials: !!(chatBridgeConfig.credentials && chatBridgeConfig.credentials.email && chatBridgeConfig.credentials.has_password),
        isAvailable: isReallyAvailable
      });
      
      // 如果配置不完整，显示警告
      if (chatBridgeConfig.enabled && !isReallyAvailable) {
        console.warn('[ChatBridge] ChatBridge is enabled but not properly configured. Missing:', {
          url: !chatBridgeConfig.chatUrl || chatBridgeConfig.chatUrl.trim() === '',
          email: !(chatBridgeConfig.credentials && chatBridgeConfig.credentials.email),
          password: !(chatBridgeConfig.credentials && chatBridgeConfig.credentials.has_password)
        });
      }
      
      updateModelBadge();
      updateChatBridgeButton();
      await loadChatBridgeState();
    }
    
    function updateChatBridgeButton() {
      var btn = document.querySelector('.chat-bridge-btn');
      if (btn) {
        btn.style.background = '';
        btn.style.borderColor = '';
        btn.style.color = '';
        btn.textContent = '🌾 Grass';
      }
    }
    
function showChatBridgeDialog() {
      // 先从服务器加载配置
      fetch('/api/chat-bridge/config')
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            // 加载新的双 Agent 配置（注意字段名转换：snake_case → camelCase）
            if (data.config.primary) {
              chatBridgeConfig.primary = {
                apiUrl: data.config.primary.api_url || '',
                hasApiKey: data.config.primary.has_api_key || false,
                model: data.config.primary.model || 'openrouter/free',
                description: data.config.primary.description || 'Grass - OpenRouter 免费模型',
                pool: data.config.primary.pool || undefined,
              };
            } else {
              chatBridgeConfig.primary = {
                apiUrl: OPENROUTER_API_URL,
                hasApiKey: false,
                model: 'openrouter/free',
                description: 'Grass - OpenRouter 免费模型'
              };
            }
            if (data.config.secondary) {
              chatBridgeConfig.secondary = {
                apiUrl: data.config.secondary.api_url || '',
                hasApiKey: data.config.secondary.has_api_key || false,
                model: data.config.secondary.model || 'gpt-4o',
                vision_model: data.config.secondary.vision_model || undefined,
                description: data.config.secondary.description || 'Little corse - 引用验证、更新记忆',
                pool: data.config.secondary.pool || undefined,
              };
            } else {
              chatBridgeConfig.secondary = {
                apiUrl: '',
                hasApiKey: false,
                model: 'gpt-4o',
                description: 'Little corse - 引用验证、更新记忆'
              };
            }
            if (data.config.secondary_vision) {
              chatBridgeConfig.secondaryVision = {
                apiUrl: data.config.secondary_vision.api_url || '',
                hasApiKey: data.config.secondary_vision.has_api_key || false,
                model: data.config.secondary_vision.model || 'gpt-4o',
                description: data.config.secondary_vision.description || 'Little corse 视觉 - 图片、图表截图、多模态输入',
                pool: data.config.secondary_vision.pool || undefined,
              };
            } else {
              chatBridgeConfig.secondaryVision = {
                apiUrl: '',
                hasApiKey: false,
                model: 'gpt-4o',
                description: 'Little corse 视觉 - 图片、图表截图、多模态输入'
              };
            }
            chatBridgeConfig.codex = data.config.codex ? {
              enabled: !!data.config.codex.enabled,
              prefer: !!data.config.codex.prefer,
              command: data.config.codex.command || '',
              model: data.config.codex.model || 'gpt-5.5',
              reasoning_effort: data.config.codex.reasoning_effort || 'xhigh',
              sandbox: data.config.codex.sandbox || 'workspace-write',
              pdf_wiki_sandbox: data.config.codex.pdf_wiki_sandbox || 'danger-full-access',
              timeout_ms: Number(data.config.codex.timeout_ms || 300000),
              pdf_wiki_concurrency: Math.max(1, Math.min(6, parseInt(data.config.codex.pdf_wiki_concurrency || data.config.codex.concurrency || 1, 10) || 1))
            } : {
              enabled: false,
              prefer: false,
              command: '',
              model: 'gpt-5.5',
              reasoning_effort: 'xhigh',
              sandbox: 'workspace-write',
              pdf_wiki_sandbox: 'danger-full-access',
              timeout_ms: 300000,
              pdf_wiki_concurrency: 1
            };
            chatBridgeConfig.mode = data.config.mode || 'api';
            chatBridgeConfig.enabled = data.config.service?.enabled ?? true;
            updateModelBadge();
            // 旧字段（向后兼容）
            chatBridgeConfig.chatUrl = data.config.chat_url || '';
            chatBridgeConfig.credentials = data.config.credentials || { email: '', has_password: false };
            console.log('[ChatBridge] Loaded config:', chatBridgeConfig);

            // ========== 渲染草原 OpenRouter 模型池面板 ==========
            var mp = window.ScholarHarnessModelPool;
            var sectionHtml = '';
            if (mp) {
              sectionHtml += mp.renderProviderSection('primary', chatBridgeConfig.primary);
            } else {
              sectionHtml = '<div style="color:var(--danger-color);margin-bottom:15px;">模型池面板未加载, 请刷新页面</div>';
            }

            var tipStyle = 'margin-bottom:12px;padding:10px;border-radius:6px;background:var(--modal-tip-bg,rgba(99,102,241,0.06));font-size:12px;line-height:1.7;color:var(--text-secondary);';
            var tipHtml = '<div style="' + tipStyle + '">'
              + '<strong style="color:var(--text-primary);">Grass · OpenRouter 免费模型</strong><br>'
              + '• 添加提供方时默认使用 OpenRouter；粘贴 API Key 后自动筛选当前免费文本模型<br>'
              + '• 可添加多个免费模型形成<strong>故障切换池</strong>，OpenRouter 免费路由也会随可用性自动选择<br>'
              + '• 当前模型 5xx/超时/限流时自动切到下一个; 401/403/余额不足不会切换<br>'
              + '• <strong>"设为当前"</strong>按钮即时切换激活模型, 不需要保存<br>'
              + '• 顺序通过 ↑ / ↓ 调整 (上 = 高优先级); 留空 API Key 表示保留原值'
              + '</div>';

            var switchTipStyle = 'margin-bottom:12px;font-size:12px;color:var(--text-secondary);min-height:18px;';
            var switchTipHtml = '<div id="mpSwitchTip" style="' + switchTipStyle + '"></div>';

            showModal('🌾 Grass 配置',
              tipHtml +
              switchTipHtml +
              sectionHtml +
              '<div id="chatBridgeTestResult" style="margin-bottom:15px;padding:10px;border-radius:6px;display:none;"></div>' +
              '<div class="btns">' +
                '<button class="cancel" onclick="closeModal()">取消</button>' +
                '<button class="ok" onclick="saveChatBridgeConfig()">保存配置</button>' +
              '</div>',
              true
            );

            if (mp) {
              mp.attachModelPoolHandlers();
              mp.refreshActiveSelect('primary');
              mp.startHealthPolling();
              var overlay = document.getElementById('modalOverlay');
              if (overlay && !overlay.dataset.mpHealthStopBound) {
                overlay.dataset.mpHealthStopBound = '1';
                var observer = new MutationObserver(function () {
                  if (!overlay.classList.contains('show')) {
                    mp.stopHealthPolling();
                  }
                });
                observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
              }
            }
          }
        })
        .catch(e => {
          console.error('Failed to load chat bridge config:', e);
          showModal('🌾 Grass 配置',
            '<div style="color:var(--danger-color);margin-bottom:15px;">加载配置失败，请刷新页面重试</div>' +
            '<div class="btns"><button class="cancel" onclick="closeModal()">关闭</button></div>'
          );
        });
    }
    window.showChatBridgeDialog = showChatBridgeDialog;
    
    function openOpenRouterApiKeyPage() {
      if (window.electronAPI && window.electronAPI.openExternal) {
        window.electronAPI.openExternal(OPENROUTER_KEYS_URL);
      } else {
        window.open(OPENROUTER_KEYS_URL, '_blank');
      }
    }
    window.openOpenRouterApiKeyPage = openOpenRouterApiKeyPage;

    function applyOpenRouterPrimaryPreset(openKeysPage) {
      var urlInput = document.getElementById('primaryApiUrl');
      if (urlInput) {
        urlInput.value = OPENROUTER_API_URL;
        urlInput.focus();
      }

      var loadingDiv = document.getElementById('primaryModelLoading');
      if (loadingDiv) {
        loadingDiv.style.display = 'block';
        loadingDiv.style.color = 'var(--text-secondary)';
        loadingDiv.style.lineHeight = '1.6';
        loadingDiv.innerHTML = '已填入 OpenRouter URL。请粘贴 API Key，然后点击“获取可用模型列表”或手动填写 OpenRouter Model ID。';
      }

      if (openKeysPage) {
        openOpenRouterApiKeyPage();
      }
    }
    window.applyOpenRouterPrimaryPreset = applyOpenRouterPrimaryPreset;

    async function refreshCodexCliStatus() {
      var statusDiv = document.getElementById('codexCliStatus');
      if (!statusDiv) return;
      statusDiv.style.color = 'var(--text-secondary)';
      statusDiv.textContent = '正在自动检测 Codex CLI...';
      try {
        var response = await fetch('/api/chat-bridge/codex/status');
        var data = await response.json();
        if (data.success && data.available) {
          statusDiv.style.borderColor = 'var(--accent-color)';
          statusDiv.style.color = 'var(--text-primary)';
          statusDiv.innerHTML = '已检测到 Codex CLI：<strong>' + escapeHtml(data.version || 'codex') + '</strong><br><span style="color:var(--text-secondary);word-break:break-all;">' + escapeHtml(data.path || 'PATH') + '</span>';
        } else {
          statusDiv.style.borderColor = 'var(--danger-color)';
          statusDiv.innerHTML = '未检测到 Codex CLI。勾选后仍会自动降级 Little corse。<br><span style="color:var(--text-secondary);">' + escapeHtml(data.error || '请确认已安装 Codex CLI') + '</span>';
        }
      } catch (e) {
        statusDiv.style.borderColor = 'var(--danger-color)';
        statusDiv.innerHTML = 'Codex CLI 检测失败，勾选后仍会自动降级 Little corse。<br><span style="color:var(--text-secondary);">' + escapeHtml(e.message) + '</span>';
      }
    }
    window.refreshCodexCliStatus = refreshCodexCliStatus;
    
    async function testChatBridgeConnection() {
      var resultDiv = document.getElementById('chatBridgeTestResult');
      resultDiv.style.display = 'block';
      resultDiv.style.background = 'rgba(255,193,7,0.15)';
      resultDiv.innerHTML = '正在保存配置并测试连接...';
      
      try {
        // 先保存 URL 和凭据到后端配置
        var chatUrl = document.getElementById('chatBridgeUrl').value.trim();
        var email = document.getElementById('chatBridgeEmail')?.value.trim() || '';
        var password = document.getElementById('chatBridgePassword')?.value || '';
        
        if (!chatUrl) {
          resultDiv.style.background = 'rgba(220,38,38,0.15)';
          resultDiv.textContent = '请先输入 AI 聊天页面的 URL';
          return;
        }
        
        if (!email) {
          resultDiv.style.background = 'rgba(220,38,38,0.15)';
          resultDiv.textContent = '请先输入登录邮箱';
          return;
        }
        
        if (!password && !chatBridgeConfig.credentials?.has_password) {
          resultDiv.style.background = 'rgba(220,38,38,0.15)';
          resultDiv.textContent = '请先输入登录密码';
          return;
        }
        
        var credentials = { email: email };
        if (password) {
          credentials.password = password;
        }
        
        // 测试连接时自动启用
        chatBridgeConfig.enabled = true;
        
        var saveResponse = await fetch('/api/chat-bridge/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            chatUrl: chatUrl,
            credentials: credentials,
            enabled: true  // 测试连接时自动启用
          })
        });
        
        if (!saveResponse.ok) {
          resultDiv.style.background = 'rgba(220,38,38,0.15)';
          resultDiv.textContent = '保存配置失败';
          return;
        }
        
        // 立即更新前端 chatBridgeConfig 变量
        var hasPassword = !!(password) || !!(chatBridgeConfig.credentials?.has_password);
        
        chatBridgeConfig.enabled = true;
        chatBridgeConfig.chatUrl = chatUrl;
        chatBridgeConfig.credentials = {
          email: email,
          has_password: hasPassword
        };
        localStorage.setItem(CHAT_BRIDGE_KEY, JSON.stringify(chatBridgeConfig));
        updateModelBadge();
        updateChatBridgeButton();
        
        console.log('[ChatBridge] Config updated after test:', chatBridgeConfig);
        
        resultDiv.innerHTML = '配置已保存，正在测试连接（将自动打开浏览器并登录）...';
        
        // 然后测试连接
        var response = await fetch('/api/chat-bridge/test');
        var data = await response.json();
        
        if (data.success) {
          resultDiv.style.background = 'rgba(16,163,127,0.15)';
          resultDiv.textContent = data.message || '测试连接成功';
          document.getElementById('chatBridgeUseBtn').style.display = 'block';
        } else {
          resultDiv.style.background = 'rgba(220,38,38,0.15)';
          resultDiv.textContent = data.message || data.error || '连接失败';
        }
      } catch (error) {
        resultDiv.style.background = 'rgba(220,38,38,0.15)';
        resultDiv.textContent = '测试失败: ' + error.message;
      }
    }
    window.testChatBridgeConnection = testChatBridgeConnection;
    
    // 加载草原 OpenRouter 免费模型列表（旧面板兼容函数）
    async function loadPrimaryModels() {
      var url = document.getElementById('primaryApiUrl')?.value.trim() || '';
      var key = document.getElementById('primaryApiKey')?.value || '';
      var currentModel = chatBridgeConfig.primary?.model || 'openrouter/free';
      
      var loadingDiv = document.getElementById('primaryModelLoading');
      var selectDiv = document.getElementById('primaryModelSelect');
      var inputDiv = document.getElementById('primaryModelInput');
      
      if (!url) {
        loadingDiv.style.display = 'block';
        loadingDiv.textContent = '请先填写 API URL';
        loadingDiv.style.color = '#f59e0b';
        return;
      }
      
      // URL 格式验证：检查是否包含端点路径（如 /chat/completions）
      if (url.includes('/chat/completions') || url.includes('/models')) {
        loadingDiv.style.display = 'block';
        loadingDiv.innerHTML = 'URL 格式错误：请不要包含端点路径（如 /chat/completions）<br>正确格式：https://scholarharness.com/api/v1';
        loadingDiv.style.color = '#f59e0b';
        loadingDiv.style.lineHeight = '1.6';
        return;
      }
      
      if (!key && !chatBridgeConfig.primary?.hasApiKey) {
        loadingDiv.style.display = 'block';
        loadingDiv.textContent = '请先填写 API Key';
        loadingDiv.style.color = '#f59e0b';
        return;
      }
      
      loadingDiv.style.display = 'block';
      loadingDiv.innerHTML = '正在获取模型列表...';
      loadingDiv.style.color = 'var(--text-secondary)';
      
      try {
        // 优先使用当前输入框的值，如果没有则使用已保存的配置
        // 这样用户不需要先保存就能获取模型
        var response = await fetch('/api/chat-bridge/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            agent: 'primary',
            // 如果用户输入了新配置，传递给后端使用
            apiUrl: url || undefined,
            apiKey: key || undefined
          })
        });
        
        var data = await response.json();
        var models = data.models || [];
        
        loadingDiv.style.display = 'none';
        inputDiv.style.display = 'block';
        
        if (models.length > 0) {
          var options = '<option value="">-- 从 API 获取的模型 --</option>';
          for (var i = 0; i < models.length; i++) {
            var selected = models[i] === currentModel ? ' selected' : '';
            options += '<option value="' + models[i] + '"' + selected + '>' + models[i] + '</option>';
          }
          selectDiv.innerHTML = options;
          selectDiv.style.display = 'block';
          loadingDiv.textContent = '已获取 ' + models.length + ' 个可用模型';
          loadingDiv.style.color = '#10a37f';
          loadingDiv.style.display = 'block';
        } else {
          // 显示服务端返回的错误信息
          var errorMsg = data.error || 'API 未返回模型列表';
          loadingDiv.innerHTML = escapeHtml(errorMsg) + '<br><small style="color:var(--text-secondary);">请先保存配置后重试，或手动输入模型名称</small>';
          loadingDiv.style.color = '#f59e0b';
          loadingDiv.style.display = 'block';
        }
      } catch (error) {
        loadingDiv.textContent = '获取模型失败: ' + error.message + '，请手动输入';
        loadingDiv.style.color = '#f59e0b';
        loadingDiv.style.display = 'block';
        selectDiv.style.display = 'none';
        inputDiv.style.display = 'block';
      }
    }
    window.loadPrimaryModels = loadPrimaryModels;
    
    async function saveChatBridgeConfig() {
      // 步骤4: 只收集草原 primary pool, 保存
      var mp = window.ScholarHarnessModelPool;
      if (!mp) {
        appendMessage('❌ 模型池面板未加载, 无法保存', 'bot', false, true);
        return;
      }

      var primaryPool = mp.collectProviderSection('primary');

      // 校验: 至少一个 enabled entry 的 model 字段非空
      var hasValid = primaryPool && primaryPool.models && primaryPool.models.some(function (m) { return m.enabled && (m.model || m.api_url); });
      if (!hasValid) {
        appendMessage('⚠️ Grass 至少需要配置一个启用的 OpenRouter 免费模型', 'bot', false, true);
        return;
      }

      var configToSave = {
        enabled: chatBridgeConfig.enabled,
        mode: 'api',
        primary: {
          pool: primaryPool,
        },
      };

      try {
        var response = await fetch('/api/chat-bridge/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(configToSave)
        });

        var result = await response.json();
        if (response.ok && result.success) {
          if (result.config && result.config.primary) {
            chatBridgeConfig.primary = {
              apiUrl: result.config.primary.api_url || '',
              hasApiKey: result.config.primary.has_api_key || false,
              model: result.config.primary.model || 'openrouter/free',
              description: result.config.primary.description || '',
              pool: result.config.primary.pool || undefined,
            };
          }
          localStorage.setItem(CHAT_BRIDGE_KEY, JSON.stringify(chatBridgeConfig));
          updateModelBadge();
          updateChatBridgeButton();

          mp.refreshActiveSelect('primary');

          console.log('[ChatBridge] Config saved successfully:', chatBridgeConfig);

          var returnToAiConfiguration = guidedConfigState && guidedConfigState.returnTarget === 'ai-configuration';
          if (returnToAiConfiguration) {
            guidedConfigState = null;
            firstRunOnboardingReadiness = null;
            closeModal();
          } else {
            showConfigCenterDialog();
          }
          appendMessage('✅ Grass 配置已保存！\n\n' +
            '🌾 **当前免费模型**: ' + (chatBridgeConfig.primary?.model || '(未配置)') + '\n' +
            '📍 **API URL**: ' + (chatBridgeConfig.primary?.apiUrl || '(未配置)') + '\n\n' +
            '在输入框右侧选择器切换 Grass；在本面板内“设为当前”可立即切换激活模型。', 'bot', false, true);
          if (returnToAiConfiguration) {
            setTimeout(function() { startAiConfigurationAssistant('all'); }, 120);
          }
        } else {
          console.error('Failed to save config to server:', result);
          appendMessage('❌ 保存配置失败：' + (result.error || '未知错误'), 'bot', false, true);
        }
      } catch (e) {
        console.error('Failed to save config to server:', e);
        appendMessage('❌ 保存配置失败：' + e.message, 'bot', false, true);
      }
    }
    window.saveChatBridgeConfig = saveChatBridgeConfig;
    
    function useChatBridgeForChat() {
      chatBridgeConfig.useForChat = true;
      localStorage.setItem(CHAT_BRIDGE_KEY, JSON.stringify(chatBridgeConfig));
      closeModal();
      appendMessage('✅ 已切换到 Grass OpenRouter 模式', 'bot', false, true);
      
      var btn = document.querySelector('.chat-bridge-btn');
      if (btn) {
        btn.style.background = '';
        btn.style.borderColor = '';
        btn.style.color = '';
        btn.textContent = '🌾 Grass';
      }
    }
    window.useChatBridgeForChat = useChatBridgeForChat;
    
    async function openBridgePage() {
      var resultDiv = document.getElementById('chatBridgeTestResult');
      var chatUrl = document.getElementById('chatBridgeUrl')?.value.trim() || '';
      var email = document.getElementById('chatBridgeEmail')?.value.trim() || '';
      var password = document.getElementById('chatBridgePassword')?.value || '';
      
      if (!resultDiv) {
        return;
      }
      
      resultDiv.style.display = 'block';
      resultDiv.style.background = 'rgba(255,193,7,0.15)';
      resultDiv.innerHTML = '正在保存配置并打开桥接页面...';
      
      if (!chatUrl) {
        resultDiv.style.background = 'rgba(220,38,38,0.15)';
        resultDiv.textContent = '请先输入 AI 聊天页面的 URL';
        return;
      }
      
      try {
        var credentials = null;
        if (email) {
          credentials = { email: email };
          if (password) {
            credentials.password = password;
          }
        }
        
        var saveResponse = await fetch('/api/chat-bridge/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatUrl: chatUrl,
            enabled: true,
            credentials: credentials
          })
        });
        
        var saveData = await saveResponse.json();
        if (!saveResponse.ok || !saveData.success) {
          throw new Error(saveData.error || '保存桥接配置失败');
        }
        
        // 正确处理 has_password：如果输入了新密码，或之前已保存密码
        var hasPassword = !!(password) || !!(chatBridgeConfig.credentials?.has_password);
        
        chatBridgeConfig.enabled = true;
        chatBridgeConfig.chatUrl = chatUrl;
        chatBridgeConfig.credentials = {
          email: email,
          has_password: hasPassword
        };
        localStorage.setItem(CHAT_BRIDGE_KEY, JSON.stringify(chatBridgeConfig));
        updateModelBadge();
        
        console.log('[ChatBridge] Config updated after openBridgePage:', chatBridgeConfig);
        
        var openResponse = await fetch('/api/chat-bridge/open-page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: chatUrl })
        });
        
        var openData = await openResponse.json();
        if (!openResponse.ok || !openData.success) {
          throw new Error(openData.error || '打开桥接页面失败');
        }
        
        resultDiv.style.background = 'rgba(16,163,127,0.15)';
        resultDiv.textContent = '已打开桥接页面，请在打开的页面完成登录。后续 OpenClaw + NiceAIGC 将在该页面继续工作。';
        updateChatBridgeButton();
        await loadChatBridgeState();
      } catch (e) {
        resultDiv.style.background = 'rgba(220,38,38,0.15)';
        resultDiv.textContent = '打开失败：' + e.message;
      }
    }
    window.openBridgePage = openBridgePage;
    
    async function refreshChatBridgePage() {
      var resultDiv = document.getElementById('chatBridgeTestResult');
      resultDiv.style.display = 'block';
      resultDiv.style.background = 'rgba(255,193,7,0.15)';
      resultDiv.innerHTML = '正在刷新 Grass 页面...';
      
      try {
        await refreshChatBridgeViaApi();
        resultDiv.style.background = 'rgba(16,163,127,0.15)';
        resultDiv.textContent = 'Grass 页面已刷新';
      } catch (e) {
        resultDiv.style.background = 'rgba(220,38,38,0.15)';
        resultDiv.textContent = '刷新失败：' + e.message;
      }
    }
    window.refreshChatBridgePage = refreshChatBridgePage;

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('chat', { source: '/app/chat.js' });
}
