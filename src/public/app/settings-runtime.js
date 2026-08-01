    // 智能保存草稿到服务器：统一走分章节草稿，不再直接追加旧版整篇草稿文件
    async function saveDraftToServer(latexContent, section) {
      try {
        var response = await fetch('/api/draft/' + currentUserId + '/smart-save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: latexContent,
            context: buildSmartDraftSaveContext(null, section || ''),
            apiUrl: apiConfig.url,
            apiKey: apiConfig.key,
            model: currentModel
          })
        });
        
        var result = await response.json();
        if (result.success) {
          invalidateArticleDraftProgressCache();
          var labels = getProjectUiLabels();
          appendMessage('✅ 已智能保存到' + labels.draft + '（' + (result.sectionName || result.section || section || '章节') + '），并已同步整篇导出文件。点击左下角"' + labels.draft + '"查看。', 'bot', false, true);
        } else if (result.needsSectionSelection) {
          showSmartDraftSectionSelectionDialog(result, latexContent, buildSmartDraftSaveContext(null, section || ''));
        } else if (result.needsConfirmation) {
          showDraftConfirmDialog(result, latexContent, buildSmartDraftSaveContext(null, section || ''));
        } else {
          appendMessage('❌ 保存失败：' + (result.error || '未知错误'), 'bot', false, true);
        }
      } catch (e) {
        appendMessage('❌ 保存失败：' + e.message, 'bot', false, true);
      }
    }
    
    function loadApiConfig() {
      var data = localStorage.getItem(API_KEY);
      if (data) {
        apiConfig = JSON.parse(data);
      } else {
        apiConfig = { url: '', key: '', model: 'qwen3.5-plus' };
      }
      if (apiConfig.url) {
        apiConfig.url = normalizeApiBaseUrl(apiConfig.url);
      }
      currentModel = apiConfig.model || 'qwen3.5-plus';
    }

    function getDefaultSecondaryVisionApiConfig() {
      return {
        url: '',
        key: '',
        model: 'gpt-4o'
      };
    }

    function normalizeSecondaryVisionApiConfig(config) {
      var normalized = Object.assign({}, getDefaultSecondaryVisionApiConfig(), config || {});
      normalized.url = normalizeApiBaseUrl(normalized.url || '');
      normalized.key = String(normalized.key || '');
      normalized.model = String(normalized.model || 'gpt-4o').trim() || 'gpt-4o';
      return normalized;
    }

    function loadSecondaryVisionApiConfig() {
      try {
        secondaryVisionApiConfig = normalizeSecondaryVisionApiConfig(JSON.parse(localStorage.getItem(SECONDARY_VISION_API_KEY) || '{}'));
      } catch (e) {
        secondaryVisionApiConfig = getDefaultSecondaryVisionApiConfig();
      }
      return secondaryVisionApiConfig;
    }

    async function saveSecondaryVisionApiConfig() {
      secondaryVisionApiConfig = normalizeSecondaryVisionApiConfig(secondaryVisionApiConfig);
      localStorage.setItem(SECONDARY_VISION_API_KEY, JSON.stringify(secondaryVisionApiConfig));
      var response = await fetch('/api/chat-bridge/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'api',
          secondary_vision: {
            api_url: secondaryVisionApiConfig.url,
            api_key: secondaryVisionApiConfig.key || undefined,
            model: secondaryVisionApiConfig.model,
            description: '小牛马视觉 - 图片、图表截图、多模态输入'
          }
        })
      });
      var result = await response.json().catch(function() { return null; });
      if (!response.ok || !result || !result.success) {
        throw new Error((result && result.error) || '小牛马视觉配置保存失败');
      }
      if (result.config && result.config.secondary_vision) {
        secondaryVisionApiConfig.url = result.config.secondary_vision.api_url || secondaryVisionApiConfig.url || '';
        secondaryVisionApiConfig.model = result.config.secondary_vision.model || secondaryVisionApiConfig.model || 'gpt-4o';
        chatBridgeConfig.secondaryVision = {
          apiUrl: result.config.secondary_vision.api_url || '',
          hasApiKey: !!result.config.secondary_vision.has_api_key,
          model: result.config.secondary_vision.model || secondaryVisionApiConfig.model || 'gpt-4o',
          description: result.config.secondary_vision.description || '小牛马视觉 - 图片、图表截图、多模态输入'
        };
        localStorage.setItem(CHAT_BRIDGE_KEY, JSON.stringify(chatBridgeConfig));
        localStorage.setItem(SECONDARY_VISION_API_KEY, JSON.stringify(secondaryVisionApiConfig));
      }
      return result;
    }

    function hasSecondaryVisionApiConfig() {
      loadSecondaryVisionApiConfig();
      return !!(secondaryVisionApiConfig.url && secondaryVisionApiConfig.key);
    }

    window.loadSecondaryVisionApiConfig = loadSecondaryVisionApiConfig;
    window.saveSecondaryVisionApiConfig = saveSecondaryVisionApiConfig;

    function normalizeApiBaseUrl(url) {
      return String(url || '')
        .trim()
        .replace(/\/+$/, '');
    }
    window.normalizeApiBaseUrl = normalizeApiBaseUrl;

    function isScholarHarnessAccountApiUrl(url) {
      try {
        var parsed = new URL(normalizeApiBaseUrl(url));
        var host = parsed.hostname.toLowerCase();
        var path = parsed.pathname.replace(/\/+$/, '');
        return (host === 'scholarharness.com' || host === 'api.scholarharness.com') && path === '/api/v1';
      } catch (e) {
        return false;
      }
    }
    window.isScholarHarnessAccountApiUrl = isScholarHarnessAccountApiUrl;
    
    function saveApiConfig() {
      localStorage.setItem(API_KEY, JSON.stringify(apiConfig));
      currentModel = apiConfig.model || 'qwen3.5-plus';
      updateModelBadge();
      
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          apiUrl: normalizeApiBaseUrl(apiConfig.url), 
          apiKey: apiConfig.key, 
          model: currentModel 
        })
      }).catch(e => console.warn('Failed to sync settings:', e));

      fetch('/api/chat-bridge/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'api',
          secondary: {
            api_url: normalizeApiBaseUrl(apiConfig.url),
            api_key: apiConfig.key || undefined,
            model: currentModel,
            description: '小牛马文本 - 日常聊天、写作执行、引用验证'
          }
        })
      }).catch(function(e) {
        console.warn('Failed to sync secondary text config:', e);
      });
    }
    
    window.loadApiConfig = loadApiConfig;
    window.saveApiConfig = saveApiConfig;
    
    // 页面加载时初始化 API 配置
    // 🔧 关键：先从后端加载配置，再同步到 localStorage 和 apiConfig
    async function initApiConfig() {
      try {
        // 1. 先从后端加载配置（优先级最高）
        var serverResponse = await fetch('/api/settings');
        if (serverResponse.ok) {
          var serverData = await serverResponse.json();
          console.log('[Init] 后端配置:', serverData);
          
          // 如果后端有配置，使用后端配置
          if (serverData.apiUrl && serverData.hasApiKey) {
            apiConfig.url = normalizeApiBaseUrl(serverData.apiUrl);
            apiConfig.key = serverData.apiKey || ''; // Key 不会返回，需要用户重新输入或从 localStorage 获取
            apiConfig.model = serverData.model || serverData.secondaryModel || 'qwen3.5-plus';
            currentModel = apiConfig.model;
            
            // 保存到 localStorage（这样下次发送消息时可以使用）
            if (serverData.apiKey) {
              localStorage.setItem(API_KEY, JSON.stringify(apiConfig));
              console.log('[Init] 后端配置已同步到 localStorage:', apiConfig.url);
            }
          } else {
            // 后端没有配置，从 localStorage 加载
            loadApiConfig();
          }
        } else {
          // 请求失败，从 localStorage 加载
          loadApiConfig();
        }
      } catch (e) {
        console.warn('[Init] 从后端加载配置失败:', e);
        loadApiConfig();
      }
      
      loadSecondaryVisionApiConfig();
      updateModelBadge();
      console.log('[Init] API 配置最终状态:', {
        url: apiConfig.url || '(空)',
        hasKey: !!apiConfig.key,
        model: currentModel,
        visionUrl: secondaryVisionApiConfig.url || '(空)',
        visionHasKey: !!secondaryVisionApiConfig.key,
        visionModel: secondaryVisionApiConfig.model || '(默认)'
      });
      
      // 同步配置到后端（确保后端也有）
      if (apiConfig.url && apiConfig.key) {
        fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            apiUrl: apiConfig.url, 
            apiKey: apiConfig.key, 
            model: currentModel,
            secondaryModel: currentModel
          })
        }).then(() => {
          console.log('[Init] API 配置已同步到后端');
        }).catch(e => {
          console.warn('[Init] 同步 API 配置到后端失败:', e);
        });
      }
    }
    
    // 执行初始化
    initApiConfig();
    
    // 从服务器加载 Embedding 配置（如果 localStorage 中没有）
    (function initEmbeddingConfig() {
      var saved = localStorage.getItem(EMBEDDING_KEY);
      if (!saved || saved === '{}') {
        // localStorage 中没有配置，从服务器获取
        fetch('/api/embedding/config')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.url || data.key) {
              var config = normalizeEmbeddingConfig({
                url: data.url || '',
                key: data.key || '',
                model: data.model || DEFAULT_EMBEDDING_MODEL,
                dimensions: data.dimensions || DEFAULT_EMBEDDING_DIMENSIONS,
                enabled: data.enabled !== false
              });
              localStorage.setItem(EMBEDDING_KEY, JSON.stringify(config));
              console.log('[Init] Embedding 配置已从服务器同步到 localStorage');
            }
          })
          .catch(function(e) {
            console.warn('[Init] 获取服务器 Embedding 配置失败:', e);
          });
      }
    })();
    
    var clearMemoryRefreshTimer = null;
    var clearMemoryRefreshInFlight = false;
    var clearMemoryLastSignature = '';
    var clearMemoryLastUserScrollAt = 0;

    function isClearMemoryModalOpen() {
      var overlay = document.getElementById('modalOverlay');
      var title = document.getElementById('modalTitle')?.textContent || '';
      return !!overlay && overlay.classList.contains('show') && title.includes('管理长期记忆');
    }

    function stopClearMemoryAutoRefresh() {
      if (clearMemoryRefreshTimer) {
        clearInterval(clearMemoryRefreshTimer);
        clearMemoryRefreshTimer = null;
      }
      clearMemoryRefreshInFlight = false;
      clearMemoryLastSignature = '';
      clearMemoryLastUserScrollAt = 0;
    }

    function buildClearMemorySignature(data) {
      try {
        return JSON.stringify({
          memoryUpdatedAt: data.memoryUpdatedAt || '',
          deletedKeys: data.deletedKeys || [],
          entries: (data.memoryEntries || []).map(function(entry) {
            return [entry.key, entry.timestamp, entry.wordCount, entry.category];
          }),
          dimensions: (data.memoryDimensions || []).map(function(dim) {
            return [dim.key, dim.exists, dim.timestamp || '', dim.wordCount || 0, dim.category];
          }),
          storage: (data.storageDimensions || []).map(function(dim) {
            return [dim.id, dim.exists, dim.size || 0, dim.itemCount || 0];
          })
        });
      } catch (e) {
        return String(Date.now());
      }
    }

    function markClearMemoryUserScroll() {
      clearMemoryLastUserScrollAt = Date.now();
    }

    function attachClearMemoryScrollTracking() {
      var scrollEl = document.getElementById('clearMemoryDialogScroll');
      if (!scrollEl) return;
      scrollEl.addEventListener('scroll', markClearMemoryUserScroll, { passive: true });
      scrollEl.addEventListener('wheel', markClearMemoryUserScroll, { passive: true });
      scrollEl.addEventListener('touchmove', markClearMemoryUserScroll, { passive: true });
      scrollEl.addEventListener('pointerdown', markClearMemoryUserScroll, { passive: true });
    }

    function setFullscreenButtonState(button, fullscreen) {
      if (!button) return;
      button.title = fullscreen ? '退出全屏' : '全屏';
      button.setAttribute('aria-label', fullscreen ? '退出全屏' : '全屏');
      button.innerHTML = fullscreen
        ? '<svg class="ui-icon sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v5H3"></path><path d="M16 3v5h5"></path><path d="M21 16h-5v5"></path><path d="M3 16h5v5"></path></svg>'
        : '<svg class="ui-icon sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5"></path><path d="M16 3h5v5"></path><path d="M21 16v5h-5"></path><path d="M3 16v5h5"></path></svg>';
    }

    function scheduleInternalDigitizerRedraw() {
      if (typeof drawInternalPdfWikiDigitizer !== 'function') return;
      [0, 80, 180].forEach(function(delay) {
        setTimeout(function() {
          if (typeof drawInternalPdfWikiDigitizer === 'function') {
            drawInternalPdfWikiDigitizer();
          }
        }, delay);
      });
    }

    function toggleModalFullscreen(event) {
      if (event) event.stopPropagation();
      var overlay = document.getElementById('modalOverlay');
      var modalEl = overlay ? overlay.querySelector('.modal') : null;
      if (!modalEl) return;
      var fullscreen = !modalEl.classList.contains('modal-fullscreen');
      modalEl.classList.toggle('modal-fullscreen', fullscreen);
      setFullscreenButtonState(document.getElementById('modalFullscreenBtn'), fullscreen);
      scheduleInternalDigitizerRedraw();
    }
    window.toggleModalFullscreen = toggleModalFullscreen;

    function toggleCustomModalFullscreen(overlayId, panelId, buttonId) {
      var overlay = document.getElementById(overlayId);
      var panel = document.getElementById(panelId);
      if (!overlay || !panel) return;
      var fullscreen = !overlay.classList.contains('custom-fullscreen-overlay');
      overlay.classList.toggle('custom-fullscreen-overlay', fullscreen);
      panel.classList.toggle('custom-fullscreen-panel', fullscreen);
      setFullscreenButtonState(document.getElementById(buttonId), fullscreen);
      scheduleInternalDigitizerRedraw();
    }
    window.toggleCustomModalFullscreen = toggleCustomModalFullscreen;

    function shouldOpenSidebarPageFullscreen(title, wide) {
      if (wide) return true;
      var normalizedTitle = String(title || '')
        .replace(/[🐄🐂🌐📖🔤🗑️]/g, '')
        .replace(/[「」]/g, '')
        .replace(/\s+/g, '')
        .trim();
      if (!normalizedTitle) return false;
      return [
        'Embedding文献库',
        'Wiki论点库',
        '论文草稿',
        '实验资料总结',
        '数据详细总结',
        '管理长期记忆',
        '一键写论文',
        '文献计量分析',
        'PDF管理',
        'Meta分析',
        'AI Meta 分析工作区',
        '图像数字化复核',
        'AutoResearch报告',
        'AutoResearch论文草稿',
        '数据分析',
        'R语言作图',
        'R语言作图',
        'PPT汇报生成',
        '配置',
      ].some(function(keyword) {
        return normalizedTitle.indexOf(keyword.replace(/\s+/g, '')) >= 0;
      });
    }

    function restoreModalHeaderActions() {
      var header = document.querySelector('#modalOverlay .modal-header');
      var actions = document.getElementById('modalHeaderActions');
      if (!header || !actions) return;
      if (actions.parentElement !== header) {
        header.appendChild(actions);
      }
      header.style.display = '';
    }

    function placeModalHeaderActions(targetId) {
      restoreModalHeaderActions();
      if (!targetId) return;
      var target = document.getElementById(targetId);
      var header = document.querySelector('#modalOverlay .modal-header');
      var actions = document.getElementById('modalHeaderActions');
      if (!target || !header || !actions) return;
      target.appendChild(actions);
      header.style.display = 'none';
    }

    function clearModalTransientHeaderActions() {
      document.querySelectorAll('.modal-transient-action').forEach(function(element) {
        element.remove();
      });
    }

    function clearModalRuntimeClasses() {
      var overlay = document.getElementById('modalOverlay');
      if (!overlay) return;
      var modalEl = overlay.querySelector('.modal');
      if (modalEl && modalEl.dataset.modalClass) {
        modalEl.dataset.modalClass.split(/\s+/).filter(Boolean).forEach(function(className) {
          modalEl.classList.remove(className);
        });
        delete modalEl.dataset.modalClass;
      }
      if (overlay.dataset.modalOverlayClass) {
        overlay.dataset.modalOverlayClass.split(/\s+/).filter(Boolean).forEach(function(className) {
          overlay.classList.remove(className);
        });
        delete overlay.dataset.modalOverlayClass;
      }
    }

    var workspacePageRequestSequence = 0;
    var workspaceActivePageRequest = null;

    function beginWorkspacePageRequest(pageKey) {
      workspacePageRequestSequence += 1;
      workspaceActivePageRequest = {
        id: workspacePageRequestSequence,
        key: String(pageKey || 'workspace-page')
      };
      return workspacePageRequestSequence;
    }

    function isWorkspacePageRequestCurrent(requestId) {
      return !!workspaceActivePageRequest && workspaceActivePageRequest.id === requestId;
    }

    function invalidateWorkspacePageRequests() {
      workspacePageRequestSequence += 1;
      workspaceActivePageRequest = null;
    }

    function showWorkspaceRequestModal(requestId, title, content, wide, fullscreen, options) {
      var requestOptions = Object.assign({}, options || {}, { pageRequestId: requestId });
      return showModal(title, content, wide, fullscreen, requestOptions);
    }

    function closeStandaloneWorkspaceSurfaces(exceptId) {
      var surfaceIds = [
        'embeddingDownloadDialog',
        'bibliometricsJournalStyleModal',
        'embeddingLibraryModal',
        'bibliometricsModal',
        'pdfWikiViewerModal',
        'retrievalModal',
        'editKeywordsModal',
        'pdfWikiReaderChatExpandedPanel',
        'pdfWikiReaderExternalChatPanel'
      ];
      surfaceIds.forEach(function(surfaceId) {
        if (surfaceId === exceptId) return;
        var surface = document.getElementById(surfaceId);
        if (!surface) return;
        if (surfaceId === 'embeddingLibraryModal' && typeof closeEmbeddingLibrary === 'function') {
          closeEmbeddingLibrary();
          return;
        }
        if (surfaceId === 'bibliometricsModal' && typeof closeBibliometricsDialog === 'function') {
          closeBibliometricsDialog();
          return;
        }
        if (surfaceId === 'pdfWikiViewerModal' && typeof closePdfWikiViewer === 'function') {
          closePdfWikiViewer();
          return;
        }
        surface.remove();
      });
      var discussionOverlay = document.getElementById('discussionFrameworkOverlay');
      if (discussionOverlay) discussionOverlay.classList.remove('open');
    }

    function prepareStandaloneWorkspaceSurface(surfaceId) {
      invalidateWorkspacePageRequests();
      if (activeHomeUtilityPage && typeof closeHomeUtilityPage === 'function') {
        closeHomeUtilityPage({ skipReturn: true });
      }
      var overlay = document.getElementById('modalOverlay');
      if (overlay && overlay.classList.contains('show')) closeModal();
      closeStandaloneWorkspaceSurfaces(surfaceId || '');
    }

    window.beginWorkspacePageRequest = beginWorkspacePageRequest;
    window.isWorkspacePageRequestCurrent = isWorkspacePageRequestCurrent;
    window.closeStandaloneWorkspaceSurfaces = closeStandaloneWorkspaceSurfaces;

    function showModal(title, content, wide, fullscreen, options) {
      var modalOptions = options && typeof options === 'object' ? options : {};
      var pageRequestId = Number(modalOptions.pageRequestId || 0);
      if (pageRequestId) {
        if (!isWorkspacePageRequestCurrent(pageRequestId)) return false;
      } else {
        invalidateWorkspacePageRequests();
      }
      if (typeof restorePdfWikiMetaSharedComposer === 'function') {
        restorePdfWikiMetaSharedComposer();
      }
      closeStandaloneWorkspaceSurfaces(modalOptions.preserveStandaloneSurfaceId || 'modalOverlay');
      restoreModalHeaderActions();
      clearModalTransientHeaderActions();
      clearModalRuntimeClasses();
      var modalTitleEl = document.getElementById('modalTitle');
      modalTitleEl.textContent = stripDecorativeAiIcons(title);
      modalTitleEl.style.display = modalOptions.hideTitle ? 'none' : '';
      document.getElementById('modalContent').innerHTML = stripDecorativeAiIcons(content);
      var overlay = document.getElementById('modalOverlay');
      overlay.classList.add('show');
      var shouldFullscreen = arguments.length >= 4 && fullscreen !== undefined
        ? !!fullscreen
        : shouldOpenSidebarPageFullscreen(title, wide);
      
      // 如果是宽对话框，添加 modal-wide 类
      var modalEl = overlay.querySelector('.modal');
      if (modalEl) {
        modalEl.classList.remove('modal-reading');
        modalEl.classList.toggle('modal-settings-page', /(?:配置|设置|首次使用向导|用户 Skill|Skill 优化实验室)/i.test(String(title || '')));
        modalEl.classList.toggle('modal-fullscreen', shouldFullscreen);
        if (wide) {
          modalEl.classList.add('modal-wide');
        } else {
          modalEl.classList.remove('modal-wide');
        }
        if (modalOptions.modalClass) {
          var modalClassNames = String(modalOptions.modalClass).split(/\s+/).filter(Boolean);
          modalClassNames.forEach(function(className) {
            modalEl.classList.add(className);
          });
          modalEl.dataset.modalClass = modalClassNames.join(' ');
        }
      }
      if (modalOptions.overlayClass) {
        var overlayClassNames = String(modalOptions.overlayClass).split(/\s+/).filter(Boolean);
        overlayClassNames.forEach(function(className) {
          overlay.classList.add(className);
        });
        overlay.dataset.modalOverlayClass = overlayClassNames.join(' ');
      }
      setFullscreenButtonState(document.getElementById('modalFullscreenBtn'), shouldFullscreen);
      placeModalHeaderActions(modalOptions.inlineHeaderActionsTargetId || '');
      if (shouldFullscreen) scheduleInternalDigitizerRedraw();
      return true;
    }
    
    window.showModal = showModal;
    
    function closeModal() {
      invalidateWorkspacePageRequests();
      stopClearMemoryAutoRefresh();
      var title = document.getElementById('modalTitle') ? document.getElementById('modalTitle').textContent : '';
      var closingPdfWikiDigitizationReview = title === '图像数字化复核';
      var returnToPdfWikiMeta = closingPdfWikiDigitizationReview || title === 'AI Meta 分析工作区';
      if (typeof restorePdfWikiMetaSharedComposer === 'function') {
        restorePdfWikiMetaSharedComposer();
      }
      if (closingPdfWikiDigitizationReview) {
        pendingPdfWikiDigitizationFile = null;
        pendingPdfWikiDigitizationImport = null;
        if (pdfWikiInternalDigitizerState && pdfWikiInternalDigitizerState.resizeObserver) {
          pdfWikiInternalDigitizerState.resizeObserver.disconnect();
        }
        pdfWikiInternalDigitizerState = null;
      }
      var overlay = document.getElementById('modalOverlay');
      overlay.classList.remove('show');
      var metaQueryNavRail = document.getElementById('metaAnalysisQueryNavRail');
      if (metaQueryNavRail && metaQueryNavRail.parentNode) metaQueryNavRail.parentNode.removeChild(metaQueryNavRail);
      queryNavPinnedMessageId = '';
      restoreModalHeaderActions();
      clearModalTransientHeaderActions();
      clearModalRuntimeClasses();
      // 关闭时移除 modal-wide 类
      var modalEl = overlay.querySelector('.modal');
      if (modalEl) {
        modalEl.classList.remove('modal-wide');
        modalEl.classList.remove('modal-fullscreen');
        modalEl.classList.remove('modal-reading');
        modalEl.classList.remove('modal-settings-page');
      }
      setFullscreenButtonState(document.getElementById('modalFullscreenBtn'), false);
      if (returnToPdfWikiMeta) {
        setPdfWikiWorkspaceMode('meta');
        setPdfWikiViewerWorkflowActions('meta-analysis');
        var pdfWikiViewer = document.getElementById('pdfWikiViewerModal');
        if (pdfWikiViewer && pdfWikiMetaDatabaseData) {
          renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
        } else if (!pdfWikiViewer && typeof window.showPdfWikiMetaDatabase === 'function') {
          setTimeout(function() {
            window.showPdfWikiMetaDatabase().catch(function(error) {
              console.warn('[PdfWikiMeta] Failed to restore Meta view after digitization review:', error);
            });
          }, 0);
        }
      }
      if (!returnToPdfWikiMeta) {
        setTimeout(function() {
          if (typeof focusMainChatInput === 'function') focusMainChatInput();
        }, 0);
      }
      if (typeof scheduleQueryNavRender === 'function') setTimeout(scheduleQueryNavRender, 0);
    }
    
    window.closeModal = closeModal;

    function showFeedbackDialog() {
      var html = '' +
        '<div style="display:flex;flex-direction:column;gap:12px;color:var(--text-primary);">' +
          '<div style="padding:11px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);color:var(--text-secondary);font-size:12px;line-height:1.6;">反馈会提交到 Scholar Harness 云端后台，便于开发者统一查看和处理。请不要粘贴 API Key、密码或未脱敏的敏感数据。</div>' +
          '<label style="font-size:12px;font-weight:700;color:var(--text-secondary);">反馈类型</label>' +
          '<select id="feedbackCategory" style="margin-bottom:0;">' +
            '<option value="bug">Bug 反馈</option>' +
            '<option value="suggestion" selected>功能建议</option>' +
            '<option value="experience">使用体验</option>' +
            '<option value="billing">账号/权益</option>' +
            '<option value="other">其他</option>' +
          '</select>' +
          '<label style="font-size:12px;font-weight:700;color:var(--text-secondary);">标题</label>' +
          '<input id="feedbackTitle" maxlength="200" placeholder="一句话概括问题或建议" style="margin-bottom:0;">' +
          '<label style="font-size:12px;font-weight:700;color:var(--text-secondary);">反馈内容</label>' +
          '<textarea id="feedbackContent" rows="7" maxlength="10000" placeholder="请描述遇到的问题、期望的改进，最好包含复现步骤或具体页面" style="margin-bottom:0;resize:vertical;"></textarea>' +
          '<label style="font-size:12px;font-weight:700;color:var(--text-secondary);">联系方式（可选）</label>' +
          '<input id="feedbackContact" maxlength="255" placeholder="邮箱、微信或手机号，方便需要时联系" style="margin-bottom:0;">' +
          '<div id="feedbackSubmitStatus" style="min-height:18px;font-size:12px;color:var(--text-secondary);"></div>' +
          '<div class="btns" style="margin-top:2px;">' +
            '<button class="cancel" onclick="closeHomeUtilityPage()">返回聊天</button>' +
            '<button class="ok" id="feedbackSubmitBtn" onclick="submitFeedback()">提交反馈</button>' +
          '</div>' +
        '</div>';
      showHomeUtilityPage('feedback', '意见反馈', '提交问题、建议和使用体验', '<div class="home-page-card">' + html + '</div>');
      setTimeout(function() {
        var input = document.getElementById('feedbackTitle');
        if (input) input.focus();
      }, 30);
    }

    window.showFeedbackDialog = showFeedbackDialog;

    async function submitFeedback() {
      var btn = document.getElementById('feedbackSubmitBtn');
      var status = document.getElementById('feedbackSubmitStatus');
      var categoryEl = document.getElementById('feedbackCategory');
      var titleEl = document.getElementById('feedbackTitle');
      var contentEl = document.getElementById('feedbackContent');
      var contactEl = document.getElementById('feedbackContact');
      var content = (contentEl && contentEl.value ? contentEl.value : '').trim();
      if (!content) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">请填写反馈内容</span>';
        if (contentEl) contentEl.focus();
        return;
      }
      if (btn) {
        btn.disabled = true;
        btn.textContent = '提交中...';
      }
      if (status) status.textContent = '正在提交到云端反馈系统...';
      try {
        var response = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: categoryEl ? categoryEl.value : 'suggestion',
            title: titleEl ? titleEl.value : '',
            content: content,
            contact: contactEl ? contactEl.value : ''
          })
        });
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok || !data.success) {
          throw new Error(data.error || data.message || '反馈提交失败');
        }
        if (status) status.innerHTML = '<span style="color:var(--accent-color);">已提交，感谢反馈。</span>';
        if (titleEl) titleEl.value = '';
        if (contentEl) contentEl.value = '';
        if (btn) {
          btn.disabled = false;
          btn.textContent = '提交反馈';
        }
      } catch (e) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">提交失败：' + escapeHtml(e.message || String(e)) + '</span>';
        if (btn) {
          btn.disabled = false;
          btn.textContent = '提交反馈';
        }
      }
    }

    window.submitFeedback = submitFeedback;

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('settings-runtime', { source: '/app/settings-runtime.js' });
}
