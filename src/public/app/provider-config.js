    var pendingDraftConfirmPayload = null;

    window.showDraftConfirmDialog = function(result, originalContent, smartContext) {
      pendingDraftConfirmPayload = {
        section: result.section || '',
        content: typeof result.pendingContent === 'string' ? result.pendingContent : String(originalContent || ''),
        references: typeof result.pendingReferences === 'string' ? result.pendingReferences : '',
        expectedSavedAt: result.existingSavedAt || '',
        subsectionId: result.subsectionId || '',
        subsectionTitle: result.subsectionTitle || '',
        subsectionIndex: result.subsectionIndex || 0
      };
      var existingTime = result.existingSavedAt ? new Date(result.existingSavedAt).toLocaleString('zh-CN') : '未知';
      
      var html = '<div style="padding:20px;text-align:left;">' +
        '<div style="color:#fbbf24;font-size:16px;font-weight:600;margin-bottom:16px;">⚠️ 检测到重复内容</div>' +
        '<div style="color:#8e8ea0;font-size:13px;margin-bottom:16px;">' + result.reason + '</div>' +
        
        // 已有内容预览
        '<div style="background:#2d2d2d;padding:12px;border-radius:6px;margin-bottom:12px;border-left:3px solid #6366f1;">' +
        '<div style="color:#818cf8;font-size:12px;margin-bottom:8px;">📂 已有内容（保存时间：' + existingTime + '）</div>' +
        '<div style="color:#d4d4d4;font-size:12px;white-space:pre-wrap;max-height:100px;overflow-y:auto;">' + escapeHtml(result.existingContentPreview || '') + '</div>' +
        '<div style="color:#8e8ea0;font-size:11px;margin-top:6px;">字数：' + result.existingContentLength + ' 字</div>' +
        '</div>' +
        
        // 新内容预览
        '<div style="background:#2d2d2d;padding:12px;border-radius:6px;margin-bottom:16px;border-left:3px solid #10a37f;">' +
        '<div style="color:#10a37f;font-size:12px;margin-bottom:8px;">📝 新内容</div>' +
        '<div style="color:#d4d4d4;font-size:12px;white-space:pre-wrap;max-height:100px;overflow-y:auto;">' + escapeHtml(result.newContentPreview || '') + '</div>' +
        '<div style="color:#8e8ea0;font-size:11px;margin-top:6px;">字数：' + result.newContentLength + ' 字 | 相似度：' + Math.round(result.similarity * 100) + '%</div>' +
        '</div>' +
        
        // 操作按钮
        '<div style="display:flex;flex-direction:column;gap:12px;">' +
        '<button onclick="confirmDraftAction(\'overwrite\')" ' +
        'style="padding:12px 20px;background:linear-gradient(135deg,#ef4444,#f87171);color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;">' +
        '🔄 覆盖原有内容</button>' +
        '<div style="color:#8e8ea0;font-size:12px;text-align:center;">删除旧版本，保存新版本</div>' +
        
        '<button onclick="confirmDraftAction(\'append\')" ' +
        'style="padding:12px 20px;background:linear-gradient(135deg,#10a37f,#34d399);color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;">' +
        '➕ 增量追加</button>' +
        '<div style="color:#8e8ea0;font-size:12px;text-align:center;">保留旧内容，追加新内容</div>' +
        
        '<button onclick="closeModal()" style="padding:10px 20px;background:#4b5563;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;margin-top:8px;">' +
        '取消操作</button>' +
        '</div>' +
        '</div>';
      
      showModal('草稿确认 - 「' + result.sectionName + '」章节', html);
    };
    
    /**
     * 执行确认后的草稿操作
     * @param action - 用户选择的操作：'overwrite' 或 'append'
     * @param section - 章节名称
     * @param encodedContent - 编码后的原始内容
     */
    window.confirmDraftAction = async function(action) {
      closeModal();
      var pending = pendingDraftConfirmPayload;
      if (!pending || !pending.section || !pending.content) {
        appendMessage('❌ 操作失败：待确认的草稿内容已经失效，请重新保存。', 'bot', false, true);
        return;
      }
      pendingDraftConfirmPayload = null;
      
      // 显示处理提示
      appendMessage('🔄 正在执行「' + (action === 'overwrite' ? '覆盖' : '追加') + '」操作...', 'bot', false, true);
      
      try {
        var parseResponse = await fetch('/api/draft/' + encodeURIComponent(currentUserId || 'web-user') + '/confirm-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            section: pending.section,
            action: action,
            content: pending.content,
            references: pending.references || '',
            expectedSavedAt: pending.expectedSavedAt || '',
            subsectionId: pending.subsectionId || '',
            subsectionTitle: pending.subsectionTitle || '',
            subsectionIndex: pending.subsectionIndex || 0
          })
        });
        
        var parseResult = await parseResponse.json();
        
        if (parseResponse.status === 409 || parseResult.conflict) {
          invalidateArticleDraftProgressCache();
          await loadArticleDraftProgress(true);
          appendMessage('⚠️ 章节在确认期间已被其他操作更新，系统没有覆盖新版本。请查看最新草稿后重新保存。', 'bot', false, true);
        } else if (parseResult.success) {
          invalidateArticleDraftProgressCache();
          appendMessage('✅ 操作完成！' + parseResult.message, 'bot', false, true);
        } else {
          throw new Error(parseResult.error || '操作失败');
        }
      } catch (e) {
        appendMessage('❌ 操作失败：' + e.message, 'bot', false, true);
      }
    };

    function openExternalUrl(url) {
      if (window.electronAPI && window.electronAPI.openExternal) {
        window.electronAPI.openExternal(url);
      } else {
        window.open(url, '_blank');
      }
    }
    window.openExternalUrl = openExternalUrl;

    var appUpdateLatestInfo = null;
    var APP_UPDATE_DISMISS_PREFIX = 'scholarharness_update_dismissed_';

    function getAppUpdatePromptEl() {
      return document.getElementById('appUpdatePrompt');
    }

    function getAppUpdateDismissKey(info) {
      return APP_UPDATE_DISMISS_PREFIX + String(info && info.latestVersion ? info.latestVersion : 'unknown');
    }

    function isAppUpdateDismissed(info) {
      try {
        return localStorage.getItem(getAppUpdateDismissKey(info)) === '1';
      } catch (e) {
        return false;
      }
    }

    function hideAppUpdatePrompt(dismissCurrentVersion) {
      var prompt = getAppUpdatePromptEl();
      if (dismissCurrentVersion && appUpdateLatestInfo) {
        try {
          localStorage.setItem(getAppUpdateDismissKey(appUpdateLatestInfo), '1');
        } catch (e) {}
      }
      if (prompt) {
        prompt.hidden = true;
        prompt.innerHTML = '';
      }
    }
    window.hideAppUpdatePrompt = hideAppUpdatePrompt;

    async function openAppUpdateDownload() {
      if (!appUpdateLatestInfo || !appUpdateLatestInfo.downloadUrl) return;
      var result = null;
      if (window.electronAPI && window.electronAPI.openAppUpdateDownload) {
        result = await window.electronAPI.openAppUpdateDownload(appUpdateLatestInfo.downloadUrl);
      } else {
        openExternalUrl(appUpdateLatestInfo.downloadUrl);
        result = { success: true };
      }
      if (!result || result.success !== false) {
        hideAppUpdatePrompt(false);
      } else if (typeof showModal === 'function') {
        showModal('更新下载', '<div style="padding:12px;color:var(--danger-color);line-height:1.6;">打开下载链接失败：' + escapeHtml(result.error || '未知错误') + '</div><div class="btns"><button class="cancel" onclick="closeModal()">关闭</button></div>');
      }
    }
    window.openAppUpdateDownload = openAppUpdateDownload;

    function renderAppUpdatePrompt(info, options) {
      var prompt = getAppUpdatePromptEl();
      if (!prompt || !info || !info.updateAvailable || !info.downloadUrl) return;
      if (!(options && options.manual) && isAppUpdateDismissed(info)) return;
      appUpdateLatestInfo = info;
      var published = info.publishedAt ? ' · ' + escapeHtml(info.publishedAt) : '';
      var notes = info.releaseNotes
        ? '<div class="app-update-notes">' + escapeHtml(info.releaseNotes) + '</div>'
        : '';
      prompt.innerHTML =
        '<div class="app-update-card" role="status" aria-live="polite">' +
          '<div class="app-update-card-head">' +
            '<div class="app-update-title">' +
              '发现新版本 ' + escapeHtml(info.latestVersion || '') +
              '<div class="app-update-meta">当前版本 ' + escapeHtml(info.currentVersion || '') + published + '</div>' +
            '</div>' +
            '<button type="button" class="app-update-close" onclick="hideAppUpdatePrompt(true)" title="本版本稍后提醒" aria-label="关闭更新提示">×</button>' +
          '</div>' +
          notes +
          '<div class="app-update-actions">' +
            '<button type="button" class="app-update-primary" onclick="openAppUpdateDownload()">更新至最新版本</button>' +
            '<button type="button" class="app-update-secondary" onclick="hideAppUpdatePrompt(true)">稍后</button>' +
          '</div>' +
        '</div>';
      prompt.hidden = false;
    }

    async function checkAppUpdateAndRender(options) {
      if (!window.electronAPI || !window.electronAPI.checkAppUpdate) {
        if (options && options.manual && typeof showModal === 'function') {
          showModal('检查更新', '<div style="padding:12px;color:var(--text-secondary);line-height:1.6;">更新检查仅在桌面版软件中可用。</div><div class="btns"><button class="cancel" onclick="closeModal()">关闭</button></div>');
        }
        return;
      }
      try {
        var info = await window.electronAPI.checkAppUpdate();
        if (info && info.updateAvailable) {
          renderAppUpdatePrompt(info, options || {});
        } else if (options && options.manual && typeof showModal === 'function') {
          var current = info && info.currentVersion ? info.currentVersion : '';
          showModal('检查更新', '<div style="padding:12px;color:var(--text-secondary);line-height:1.6;">当前已是最新版本' + (current ? '：' + escapeHtml(current) : '') + '。</div><div class="btns"><button class="cancel" onclick="closeModal()">关闭</button></div>');
        }
      } catch (e) {
        if (options && options.manual && typeof showModal === 'function') {
          showModal('检查更新', '<div style="padding:12px;color:var(--danger-color);line-height:1.6;">检查更新失败：' + escapeHtml(e.message || String(e)) + '</div><div class="btns"><button class="cancel" onclick="closeModal()">关闭</button></div>');
        }
      }
    }
    window.checkAppUpdateAndRender = checkAppUpdateAndRender;

    setTimeout(function() {
      checkAppUpdateAndRender({ manual: false });
    }, 8000);

    function getChinaAiProviderById(providerId) {
      return SECONDARY_AI_API_PROVIDERS.find(function(provider) {
        return provider.id === providerId;
      });
    }

    function applyChinaAiProviderPreset(providerId) {
      var provider = getChinaAiProviderById(providerId);
      if (!provider) return;

      var urlInput = document.getElementById('apiUrl');
      if (urlInput) {
        urlInput.value = provider.apiUrl;
        urlInput.focus();
      }

      var modelInput = document.getElementById('modelInput');
      if (modelInput) {
        modelInput.style.display = 'block';
        if (!modelInput.value) {
          modelInput.placeholder = '例如：' + provider.modelHint;
        }
      }

      var loadingDiv = document.getElementById('modelLoading');
      if (loadingDiv) {
        loadingDiv.style.display = 'block';
        loadingDiv.style.color = 'var(--text-secondary)';
        loadingDiv.style.lineHeight = '1.6';
        loadingDiv.innerHTML = '已填入 ' + provider.name + ' 的 API 地址。请粘贴 API Key，再点击“保存”；模型可手动填写：' + provider.modelHint;
      }
    }
    window.applyChinaAiProviderPreset = applyChinaAiProviderPreset;

    function openChinaAiProviderApply(providerId) {
      var provider = getChinaAiProviderById(providerId);
      if (!provider) return;
      openExternalUrl(provider.applyUrl);
    }
    window.openChinaAiProviderApply = openChinaAiProviderApply;

    function buildChinaAiProviderGuideHtml() {
      var rows = CHINA_AI_API_PROVIDERS.map(function(provider) {
        return '' +
          '<div style="display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1.35fr) auto auto;gap:8px;align-items:center;padding:8px;border:1px solid var(--border-color);border-radius:8px;background:rgba(148,163,184,0.08);">' +
            '<div style="min-width:0;">' +
              '<div style="font-size:12px;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(provider.name) + '</div>' +
              '<div style="font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">模型示例：' + escapeHtml(provider.modelHint) + '</div>' +
            '</div>' +
            '<code style="font-size:11px;color:var(--text-secondary);background:var(--modal-code-bg);border-radius:5px;padding:5px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(provider.apiUrl) + '</code>' +
            '<button type="button" onclick="applyChinaAiProviderPreset(\'' + provider.id + '\')" style="padding:7px 10px;background:#e5e7eb;border:1px solid #cbd5e1;border-radius:6px;color:#374151;cursor:pointer;font-size:12px;font-weight:600;box-shadow:inset 0 1px 0 rgba(255,255,255,0.65);">填入URL</button>' +
            '<button type="button" onclick="openChinaAiProviderApply(\'' + provider.id + '\')" style="padding:7px 10px;background:#d1d5db;border:1px solid #9ca3af;border-radius:6px;color:#374151;cursor:pointer;font-size:12px;font-weight:600;box-shadow:inset 0 1px 0 rgba(255,255,255,0.62);">申请API</button>' +
          '</div>';
      }).join('');

      return '' +
        '<div style="margin:10px 0 12px;padding:12px;border:1px solid var(--border-color);border-radius:10px;background:rgba(148,163,184,0.08);">' +
          '<div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:8px;">中国主流 AI 平台 API 申请与 URL 预设</div>' +
          '<div style="font-size:12px;line-height:1.7;color:var(--text-secondary);margin-bottom:10px;">' +
            '先点“申请API”去官网创建 API Key；回来粘贴密钥。点“填入URL”会自动写入 OpenAI 兼容地址。若“获取模型列表”失败，直接手动填写平台文档里的模型名称即可。' +
          '</div>' +
          '<div style="display:grid;gap:8px;">' + rows + '</div>' +
        '</div>';
    }

    function applySecondaryProviderPreset(providerId, target) {
      var provider = getChinaAiProviderById(providerId);
      if (!provider) return;
      var prefix = target === 'vision' ? 'vision' : '';
      var urlInput = document.getElementById(prefix ? 'visionApiUrl' : 'apiUrl');
      var modelInput = document.getElementById(prefix ? 'visionModelInput' : 'modelInput');
      var loadingDiv = document.getElementById(prefix ? 'visionModelLoading' : 'modelLoading');
      if (urlInput) {
        urlInput.value = provider.apiUrl;
        urlInput.focus();
      }
      if (modelInput) {
        modelInput.style.display = 'block';
        if (!modelInput.value) {
          modelInput.placeholder = '例如：' + provider.modelHint;
        }
      }
      if (loadingDiv) {
        loadingDiv.style.display = 'block';
        loadingDiv.style.color = 'var(--text-secondary)';
        loadingDiv.style.lineHeight = '1.6';
        loadingDiv.innerHTML = '已填入 ' + provider.name + ' 的 API 地址。请粘贴 API Key，再点击“获取可用模型列表”或手动填写模型名称。';
      }
    }
    window.applySecondaryProviderPreset = applySecondaryProviderPreset;

    function buildSecondaryProviderGuideHtml(target) {
      var rows = SECONDARY_AI_API_PROVIDERS.map(function(provider) {
        var providerDetail = provider.note
          ? provider.note + ' 模型示例：' + provider.modelHint
          : '模型示例：' + provider.modelHint;
        return '' +
          '<div style="display:grid;grid-template-columns:minmax(0,1.2fr) auto auto;gap:8px;align-items:center;padding:8px;border:1px solid var(--border-color);border-radius:8px;background:rgba(148,163,184,0.08);">' +
            '<div style="min-width:0;">' +
              '<div style="font-size:12px;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(provider.name) + '</div>' +
              '<div style="font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + escapeHtml(providerDetail) + '">' + escapeHtml(providerDetail) + '</div>' +
            '</div>' +
            '<button type="button" onclick="applySecondaryProviderPreset(\'' + provider.id + '\', \'' + target + '\')" style="padding:7px 10px;background:#e5e7eb;border:1px solid #cbd5e1;border-radius:6px;color:#374151;cursor:pointer;font-size:12px;font-weight:600;box-shadow:inset 0 1px 0 rgba(255,255,255,0.65);">填入URL</button>' +
            '<button type="button" onclick="openChinaAiProviderApply(\'' + provider.id + '\')" style="padding:7px 10px;background:#d1d5db;border:1px solid #9ca3af;border-radius:6px;color:#374151;cursor:pointer;font-size:12px;font-weight:600;box-shadow:inset 0 1px 0 rgba(255,255,255,0.62);">申请API</button>' +
          '</div>';
      }).join('');
      return '' +
        '<details style="margin:10px 0 12px;padding:10px;border:1px solid var(--border-color);border-radius:10px;background:rgba(148,163,184,0.08);">' +
          '<summary style="cursor:pointer;font-size:12px;font-weight:750;color:var(--text-primary);">选择常用平台并自动填入 URL（含阿里云百炼 Token Plan）</summary>' +
          '<div style="margin-top:8px;display:grid;gap:8px;">' + rows + '</div>' +
        '</details>';
    }

    async function loadSecondaryModels(target) {
      var isVision = target === 'vision';
      var urlEl = document.getElementById(isVision ? 'visionApiUrl' : 'apiUrl');
      var keyEl = document.getElementById(isVision ? 'visionApiKey' : 'apiKey');
      var selectEl = document.getElementById(isVision ? 'visionModelSelect' : 'modelSelect');
      var inputEl = document.getElementById(isVision ? 'visionModelInput' : 'modelInput');
      var loadingEl = document.getElementById(isVision ? 'visionModelLoading' : 'modelLoading');
      if (!urlEl || !keyEl || !selectEl || !inputEl || !loadingEl) return;
      var url = normalizeApiBaseUrl(urlEl.value);
      var key = keyEl.value.trim();
      var savedHasKey = isVision ? !!chatBridgeConfig.secondaryVision?.hasApiKey : !!chatBridgeConfig.secondary?.hasApiKey;
      var current = isVision ? (secondaryVisionApiConfig.model || chatBridgeConfig.secondaryVision?.model || 'gpt-4o') : (apiConfig.model || currentModel || 'qwen3.5-plus');
      if (!url) {
        loadingEl.style.display = 'block';
        loadingEl.style.color = '#f59e0b';
        loadingEl.innerHTML = '请先填写 API 地址。';
        return;
      }
      if (url.indexOf('/chat/completions') >= 0 || url.indexOf('/models') >= 0) {
        loadingEl.style.display = 'block';
        loadingEl.style.color = '#f59e0b';
        loadingEl.innerHTML = 'URL 只填写服务商基础地址，不要包含 /chat/completions 或 /models。';
        return;
      }
      if (!key && !savedHasKey) {
        loadingEl.style.display = 'block';
        loadingEl.style.color = '#f59e0b';
        loadingEl.innerHTML = '请先填写 API Key。';
        return;
      }
      loadingEl.style.display = 'block';
      loadingEl.style.color = 'var(--text-secondary)';
      loadingEl.innerHTML = '正在获取模型列表...';
      try {
        var response = await fetch('/api/chat-bridge/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent: isVision ? 'secondary_vision' : 'secondary',
            apiUrl: url,
            apiKey: key || undefined
          })
        });
        var data = await response.json();
        var models = data.models || [];
        inputEl.style.display = 'block';
        if (models.length > 0) {
          var options = '<option value="">-- 选择模型 --</option>';
          models.forEach(function(modelId) {
            var selected = modelId === current ? ' selected' : '';
            options += '<option value="' + escapeHtml(modelId) + '"' + selected + '>' + escapeHtml(modelId) + '</option>';
          });
          selectEl.innerHTML = options;
          selectEl.style.display = 'block';
          selectEl.onchange = function() {
            if (selectEl.value) {
              inputEl.value = selectEl.value;
            }
          };
          loadingEl.style.color = '#10a37f';
          loadingEl.innerHTML = '已获取 ' + models.length + ' 个模型。';
        } else {
          selectEl.style.display = 'none';
          loadingEl.style.color = '#f59e0b';
          loadingEl.innerHTML = (data.error || 'API 未返回模型列表') + '；请手动填写模型名称。';
        }
      } catch (error) {
        selectEl.style.display = 'none';
        inputEl.style.display = 'block';
        loadingEl.style.color = '#f59e0b';
        loadingEl.innerHTML = '获取模型失败：' + escapeHtml(error.message || String(error)) + '；请手动填写模型名称。';
      }
    }
    window.loadSecondaryModels = loadSecondaryModels;
    
    window.showConnectDialog = async function() {
      loadApiConfig();
      loadSecondaryVisionApiConfig();
      try {
        await loadChatBridgeConfig();
      } catch (e) {
        console.warn('[SecondaryConfig] Failed to refresh server config:', e);
      }
      if (chatBridgeConfig.secondary?.apiUrl && !apiConfig.url) {
        apiConfig.url = normalizeApiBaseUrl(chatBridgeConfig.secondary.apiUrl);
      }
      if (chatBridgeConfig.secondary?.model && (!apiConfig.model || apiConfig.model === 'qwen3.5-plus')) {
        apiConfig.model = chatBridgeConfig.secondary.model;
        currentModel = apiConfig.model;
      }
      
      showModal('🐄 小牛马配置',
        '<div class="current-api">文本模型: ' + escapeHtml(currentModel) + '；视觉模型: ' + escapeHtml(secondaryVisionApiConfig.model || chatBridgeConfig.secondaryVision?.model || '未配置') + '</div>' +
        // ========== 数据跨境传输合规告知 ========== 
        '<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:12px;margin-bottom:15px;font-size:13px;">' +
        '<div style="color:#856404;font-weight:bold;margin-bottom:8px;">⚠️ 数据跨境传输告知（合规要求）</div>' +
        '<div style="color:#856404;line-height:1.8;font-size:12px;">' +
        '根据《个人信息保护法》，使用境外AI服务时需告知您：<br>' +
        '• <b>OpenAI GPT</b> → 美国（境外）<br>' +
        '• <b>Anthropic Claude</b> → 美国（境外）<br>' +
        '• <b>阿里云通义千问</b> → 中国境内<br>' +
        '• <b>百度文心</b> → 中国境内<br>' +
        '使用境外API时，您的输入内容将传输至境外服务器。<br>' +
        '<b style="color:#dc3545;">建议优先使用境内服务商以保护数据安全。</b>' +
        '</div>' +
        '</div>' +
        '<div style="margin-bottom:15px;padding:14px;border:1px solid var(--border-color);border-radius:10px;background:rgba(148,163,184,0.08);">' +
        '<div style="font-size:14px;font-weight:800;color:var(--text-primary);margin-bottom:5px;">1. 小牛马文本 API</div>' +
        '<div style="font-size:12px;line-height:1.7;color:var(--text-secondary);margin-bottom:10px;">用于纯文本聊天、写作执行、引用验证、长期记忆总结。建议配置便宜稳定的文本模型。</div>' +
        '<div style="margin-bottom:10px;">' +
        '<label style="display:block;margin-bottom:5px;font-size:12px;color:var(--text-secondary);">文本 API 地址</label>' +
        '<input type="text" id="apiUrl" placeholder="普通百炼或 Token Plan 的 OpenAI 兼容 URL" value="' + escapeHtml(apiConfig.url) + '" style="width:100%;padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);">' +
        '</div>' +
        buildSecondaryProviderGuideHtml('text') +
        '<div style="margin-bottom:10px;">' +
        '<label style="display:block;margin-bottom:5px;font-size:12px;color:var(--text-secondary);">API 密钥</label>' +
        '<input type="password" id="apiKey" placeholder="' + (chatBridgeConfig.secondary?.hasApiKey && !apiConfig.key ? '已保存；留空保持原 Key' : '输入 API Key') + '" value="' + escapeHtml(apiConfig.key) + '" style="width:100%;padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);">' +
        '</div>' +
        '<div style="margin-bottom:10px;">' +
        '<label style="display:block;margin-bottom:5px;font-size:12px;color:var(--text-secondary);">文本模型</label>' +
        '<div id="modelLoading" style="text-align:center;padding:8px;color:#8e8ea0;font-size:12px;">点击按钮获取可用模型列表，或直接手动填写模型名称。</div>' +
        '<select id="modelSelect" style="display:none;width:100%;padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);"></select>' +
        '<input type="text" id="modelInput" placeholder="例如：qwen-plus / deepseek-chat" value="' + escapeHtml(apiConfig.model || currentModel || '') + '" style="display:block;width:100%;padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);">' +
        '<button type="button" onclick="loadSecondaryModels(\'text\')" style="margin-top:8px;padding:8px 12px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);cursor:pointer;font-size:12px;">获取可用模型列表</button>' +
        '</div>' +
        '</div>' +
        '<div style="margin-bottom:15px;padding:14px;border:1px solid var(--border-color);border-radius:10px;background:rgba(148,163,184,0.08);">' +
        '<div style="font-size:14px;font-weight:800;color:var(--text-primary);margin-bottom:5px;">2. 小牛马视觉多模态 API</div>' +
        '<div style="font-size:12px;line-height:1.7;color:var(--text-secondary);margin-bottom:10px;">用于图片、图表截图、实验结果图片等视觉输入。纯文本不会调用这里；未配置时会回退到旧的小牛马文本配置。</div>' +
        '<div style="margin-bottom:10px;">' +
        '<label style="display:block;margin-bottom:5px;font-size:12px;color:var(--text-secondary);">视觉 API 地址</label>' +
        '<input type="text" id="visionApiUrl" placeholder="普通百炼或 Token Plan 的 OpenAI 兼容 URL" value="' + escapeHtml(secondaryVisionApiConfig.url || chatBridgeConfig.secondaryVision?.apiUrl || '') + '" style="width:100%;padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);">' +
        '</div>' +
        buildSecondaryProviderGuideHtml('vision') +
        '<div style="margin-bottom:10px;">' +
        '<label style="display:block;margin-bottom:5px;font-size:12px;color:var(--text-secondary);">视觉 API 密钥</label>' +
        '<input type="password" id="visionApiKey" placeholder="' + (chatBridgeConfig.secondaryVision?.hasApiKey && !secondaryVisionApiConfig.key ? '已保存；留空保持原 Key' : '输入视觉 API Key') + '" value="' + escapeHtml(secondaryVisionApiConfig.key || '') + '" style="width:100%;padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);">' +
        '</div>' +
        '<div style="margin-bottom:0;">' +
        '<label style="display:block;margin-bottom:5px;font-size:12px;color:var(--text-secondary);">视觉模型</label>' +
        '<div id="visionModelLoading" style="text-align:center;padding:8px;color:#8e8ea0;font-size:12px;">点击按钮获取可用模型列表，或直接填写支持图片输入的模型名称。</div>' +
        '<select id="visionModelSelect" style="display:none;width:100%;padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);"></select>' +
        '<input type="text" id="visionModelInput" placeholder="例如：qwen3.5-ocr / qwen-vl-max / gpt-4o" value="' + escapeHtml(secondaryVisionApiConfig.model || chatBridgeConfig.secondaryVision?.model || 'gpt-4o') + '" style="display:block;width:100%;padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);">' +
        '<button type="button" onclick="loadSecondaryModels(\'vision\')" style="margin-top:8px;padding:8px 12px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);cursor:pointer;font-size:12px;">获取视觉模型列表</button>' +
        '</div>' +
        '</div>' +
        '<div style="background:var(--modal-tip-bg);padding:10px;border-radius:6px;margin-bottom:10px;font-size:12px;color:var(--text-secondary);">' +
        '<strong>调用规则：</strong>纯文本走“小牛马文本 API”；图片/图表截图等视觉输入优先走“小牛马视觉多模态 API”。' +
        '</div>' +
        '<div class="btns secondary-config-actions"><button class="cancel" onclick="closeModal()">取消</button><button class="ok" onclick="saveApiConnect()">保存</button></div>'
        , true
      );
      
      // 获取模型列表
      if (apiConfig.url && apiConfig.key) {
        try {
          var response = await fetch('/api/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiUrl: apiConfig.url, apiKey: apiConfig.key })
          });
          
          var data = await response.json();
          var models = data.models || [];
          
          document.getElementById('modelLoading').style.display = 'none';
          document.getElementById('modelInput').style.display = 'block';
          
          if (models.length > 0) {
            var select = document.getElementById('modelSelect');
            var options = '<option value="">-- 选择模型 --</option>';
            for (var i = 0; i < models.length; i++) {
              var selected = models[i] === currentModel ? ' selected' : '';
              options += '<option value="' + models[i] + '"' + selected + '>' + models[i] + '</option>';
            }
            select.innerHTML = options;
            select.style.display = 'block';
          } else {
            document.getElementById('modelLoading').style.display = 'block';
            document.getElementById('modelLoading').innerHTML = '请输入模型名称（API 未返回模型列表）';
            document.getElementById('modelLoading').style.color = '#8e8ea0';
          }
        } catch (error) {
          document.getElementById('modelLoading').textContent = '请手动输入模型名称';
          document.getElementById('modelLoading').style.color = '#f59e0b';
          document.getElementById('modelSelect').style.display = 'none';
          document.getElementById('modelInput').style.display = 'block';
        }
      } else {
        document.getElementById('modelLoading').textContent = '请先配置 API 地址和密钥';
        document.getElementById('modelLoading').style.color = '#f59e0b';
        document.getElementById('modelSelect').style.display = 'none';
        document.getElementById('modelInput').style.display = 'block';
      }
    }
    
    window.saveApiConnect = async function() {
      var url = normalizeApiBaseUrl(document.getElementById('apiUrl').value);
      var key = document.getElementById('apiKey').value.trim();
      var selectVal = document.getElementById('modelSelect')?.value || '';
      var inputVal = document.getElementById('modelInput')?.value.trim() || '';
      var model = selectVal || inputVal || apiConfig.model || 'qwen3.5-plus';
      var visionUrl = normalizeApiBaseUrl(document.getElementById('visionApiUrl')?.value || '');
      var visionKeyInput = document.getElementById('visionApiKey')?.value.trim() || '';
      var visionSelectVal = document.getElementById('visionModelSelect')?.value || '';
      var visionInputVal = document.getElementById('visionModelInput')?.value.trim() || '';
      var previousVision = loadSecondaryVisionApiConfig();
      var previousTextKey = apiConfig.key || '';
      var visionModel = visionSelectVal || visionInputVal || previousVision.model || chatBridgeConfig.secondaryVision?.model || 'gpt-4o';
      
      console.log('[API] Saving config:', {
        url: url ? '已填写' : '空',
        key: key ? '已填写' : '空',
        model: model,
        visionUrl: visionUrl ? '已填写' : '空',
        visionKey: visionKeyInput ? '已填写' : '空',
        visionModel: visionModel
      });
      
      if (!url) {
        alert('请填写 API 地址\n\n普通百炼：https://dashscope.aliyuncs.com/compatible-mode/v1\nToken Plan：https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1');
        return;
      }
      if (isScholarHarnessAccountApiUrl(url)) {
        alert('这个地址是 Scholar Harness 官网账号接口，不是模型 API 地址。\n\n请填写模型服务商提供的 OpenAI 兼容地址，例如：\nhttps://dashscope.aliyuncs.com/compatible-mode/v1\nhttps://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1\nhttps://openrouter.ai/api/v1');
        return;
      }
      if (!key && !previousTextKey && !chatBridgeConfig.secondary?.hasApiKey) {
        alert('请填写 API 密钥');
        return;
      }
      if (visionUrl && isScholarHarnessAccountApiUrl(visionUrl)) {
        alert('视觉 API 地址不能填写 Scholar Harness 官网账号接口。\n\n请填写支持图片输入的模型服务商 API 地址。');
        return;
      }
      if (visionUrl && !visionKeyInput && !previousVision.key && !chatBridgeConfig.secondaryVision?.hasApiKey) {
        alert('已填写视觉 API 地址，请同时填写视觉 API Key。');
        return;
      }
      
      apiConfig.url = url;
      apiConfig.key = key || previousTextKey || '';
      apiConfig.model = model;
      saveApiConfig();
      chatBridgeConfig.secondary = {
        apiUrl: url,
        hasApiKey: !!apiConfig.key || !!chatBridgeConfig.secondary?.hasApiKey,
        model: model,
        description: '小牛马文本 - 日常聊天、写作执行、引用验证'
      };

      secondaryVisionApiConfig.url = visionUrl;
      secondaryVisionApiConfig.key = visionKeyInput || previousVision.key || '';
      secondaryVisionApiConfig.model = visionModel;
      if (visionUrl || secondaryVisionApiConfig.key || visionModel) {
        try {
          await saveSecondaryVisionApiConfig();
        } catch (error) {
          alert('小牛马视觉配置保存失败：' + (error.message || String(error)));
          return;
        }
      }
      chatBridgeConfig.secondaryVision = {
        apiUrl: visionUrl,
        hasApiKey: !!secondaryVisionApiConfig.key || !!chatBridgeConfig.secondaryVision?.hasApiKey,
        model: visionModel,
        description: '小牛马视觉 - 图片、图表截图、多模态输入'
      };
      localStorage.setItem(CHAT_BRIDGE_KEY, JSON.stringify(chatBridgeConfig));

      showConfigCenterDialog();
      appendMessage(
        '✅ 小牛马配置已更新\n\n' +
        '文本模型：' + currentModel + '\n' +
        '视觉模型：' + (secondaryVisionApiConfig.url ? secondaryVisionApiConfig.model : '未配置'),
        'bot',
        false,
        true
      );
    }
    
    window.showModelDialog = async function() {
      loadApiConfig();
      
      showModal('切换模型',
        '<div class="current-api">当前: ' + currentModel + '</div>' +
        '<div id="modelLoading" style="text-align:center;padding:10px;color:#8e8ea0;">正在获取模型列表...</div>' +
        '<select id="modelSelect" style="display:none;"></select>' +
        '<input type="text" id="modelInput" placeholder="或手动输入模型名称" style="display:none;">' +
        '<div class="btns"><button class="cancel" onclick="closeModal()">取消</button><button class="ok" id="modelSaveBtn" style="display:none;" onclick="saveModelSelect()">保存</button></div>'
      );
      
      try {
        var response = await fetch('/api/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiUrl: apiConfig.url, apiKey: apiConfig.key })
        });
        
        var data = await response.json();
        var models = data.models || [];
        
        document.getElementById('modelLoading').style.display = 'none';
        document.getElementById('modelSaveBtn').style.display = 'block';
        document.getElementById('modelInput').style.display = 'block';
        
        if (models.length > 0) {
          var select = document.getElementById('modelSelect');
          var options = '<option value="">-- 选择模型 --</option>';
          for (var i = 0; i < models.length; i++) {
            var selected = models[i] === currentModel ? ' selected' : '';
            options += '<option value="' + models[i] + '"' + selected + '>' + models[i] + '</option>';
          }
          select.innerHTML = options;
          select.style.display = 'block';
        }
        
        if (!data.success || models.length === 0) {
          var loadingDiv = document.getElementById('modelLoading');
          loadingDiv.style.display = 'block';
          loadingDiv.innerHTML = '请输入模型名称（API 未返回模型列表）';
          loadingDiv.style.color = '#8e8ea0';
        }
      } catch (error) {
        document.getElementById('modelLoading').textContent = '请手动输入模型名称';
        document.getElementById('modelLoading').style.color = '#f59e0b';
        document.getElementById('modelSelect').style.display = 'none';
        document.getElementById('modelInput').style.display = 'block';
        document.getElementById('modelSaveBtn').style.display = 'block';
      }
    }
    
    window.saveModelSelect = function() {
      var selectVal = document.getElementById('modelSelect').value;
      var inputVal = document.getElementById('modelInput').value.trim();
      var model = inputVal || selectVal;
      
      if (!model) {
        alert('请选择或输入模型名称');
        return;
      }
      
      apiConfig.model = model;
      saveApiConfig();
      closeModal();
      appendMessage(' 已切换到模型：' + currentModel, 'bot', false, true);
    }
    
    window.showWebSearchDialog = function() {
      var saved = localStorage.getItem(WEB_SEARCH_KEY);
      var webConfig = saved ? JSON.parse(saved) : { 
        url: 'https://api.tavily.com/search', 
        key: '',
        verifySources: true,
        academicOnly: true,
        includeCitations: false
      };
      
      showModal('🌐 联网搜索配置',
        '<div style="color:var(--text-secondary);font-size:13px;margin-bottom:15px;">' +
        '用于搜索网上最新文献和研究进展。<br>' +
        '<b style="color:var(--danger-color);">⚠️ 注意：</b>联网搜索结果<strong>未经验证</strong>，仅供参考，不建议直接作为正式引用。' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
        '<label style="display:block;margin-bottom:5px;color:var(--text-primary);">API Key <a href="https://tavily.com/" target="_blank" style="color:var(--accent-color);">(获取密钥)</a></label>' +
        '<input type="password" id="webSearchKey" value="' + (webConfig.key || '') + '" ' +
        'style="width:100%;padding:10px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);color:var(--text-primary);border-radius:4px;" ' +
        'placeholder="Tavily API Key">' +
        '</div>' +
        '<div style="background:var(--modal-tip-bg);border:1px solid var(--accent-color);border-radius:8px;padding:12px;margin-bottom:15px;">' +
        '<div style="color:var(--accent-color);font-weight:bold;margin-bottom:8px;">✓ 真实性验证设置</div>' +
        '<div style="color:var(--text-primary);font-size:12px;line-height:1.8;">' +
        '<label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;">' +
        '<input type="checkbox" id="verifySources" ' + (webConfig.verifySources !== false ? 'checked' : '') + ' style="width:auto;"> 验证来源（检查是否为学术网站）' +
        '</label>' +
        '<label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;">' +
        '<input type="checkbox" id="academicOnly" ' + (webConfig.academicOnly !== false ? 'checked' : '') + ' style="width:auto;"> 仅学术来源（优先期刊、预印本、学术数据库）' +
        '</label>' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">' +
        '<input type="checkbox" id="includeCitations" ' + (webConfig.includeCitations ? 'checked' : '') + ' style="width:auto;"> 允许引用（<b style="color:var(--danger-color);">不推荐</b>，联网结果未经验证）' +
        '</label>' +
        '</div>' +
        '</div>' +
        '<div style="color:var(--text-secondary);font-size:11px;margin-bottom:15px;">' +
        '💡 <b>使用建议：</b><br>' +
        '• 联网搜索仅用于获取研究背景和最新进展<br>' +
        '• 正式引用请使用您上传的本地文献库<br>' +
        '• 如需引用联网结果，请手动核实 DOI 和期刊信息' +
        '</div>' +
        '<div class="btns">' +
        '<button class="cancel" onclick="closeModal()">取消</button>' +
        '<button class="ok" onclick="saveWebSearchConfig()">保存</button>' +
        '</div>'
      );
    }
    
    window.saveWebSearchConfig = function() {
      var key = document.getElementById('webSearchKey').value.trim();
      var verifySources = document.getElementById('verifySources').checked;
      var academicOnly = document.getElementById('academicOnly').checked;
      var includeCitations = document.getElementById('includeCitations').checked;
      
      var config = { 
        url: 'https://api.tavily.com/search', 
        key: key,
        verifySources: verifySources,
        academicOnly: academicOnly,
        includeCitations: includeCitations
      };
      
      localStorage.setItem(WEB_SEARCH_KEY, JSON.stringify(config));
      
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          webSearchKey: key,
          webSearchConfig: {
            verifySources: verifySources,
            academicOnly: academicOnly,
            includeCitations: includeCitations
          }
        })
      }).catch(function(e) {
        console.error('Failed to sync web search config:', e);
      });
      
      showConfigCenterDialog();
      
      var msg = ' 联网搜索配置已保存。';
      if (key) {
        msg += '可以搜索网上最新文献。';
        if (!includeCitations) {
          msg += '<br><b>注意：</b>系统已禁止直接引用联网结果（请在本地文献库中核实后再引用）。';
        }
      } else {
        msg += '未配置 API Key，联网搜索功能未启用。';
      }
      appendMessage(msg, 'bot', false, true);
    }
    
    function getWebSearchConfig() {
      var data = localStorage.getItem(WEB_SEARCH_KEY);
      if (data) {
        return JSON.parse(data);
      }
      return { url: '', key: '', verifySources: true, academicOnly: true, includeCitations: false };
    }

    function getPdfWikiLlmConfig() {
      var data = localStorage.getItem(PDF_WIKI_LLM_KEY);
      if (data) {
        try {
          var parsed = JSON.parse(data);
          return {
            apiUrl: parsed.apiUrl || parsed.url || '',
            apiKey: parsed.apiKey || parsed.key || '',
            model: DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL,
            jsonModel: DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL,
            ocrModel: DEFAULT_PDF_WIKI_QWEN_OCR_MODEL,
            visionModel: DEFAULT_PDF_WIKI_QWEN_VISION_MODEL,
            textInApiUrl: parsed.textInApiUrl || 'https://api.textin.com/ai/service/v1/pdf_to_markdown',
            textInAppId: parsed.textInAppId || '',
            textInSecretCode: parsed.textInSecretCode || '',
            textInParseMode: parsed.textInParseMode || 'auto',
            hasApiKey: !!(parsed.hasApiKey || parsed.apiKey || parsed.key),
            hasTextInSecretCode: !!(parsed.hasTextInSecretCode || parsed.textInSecretCode)
          };
        } catch (e) {
          console.warn('[PdfWikiConfig] 读取本地配置失败:', e);
        }
      }
      return {
        apiUrl: '',
        apiKey: '',
        model: DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL,
        jsonModel: DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL,
        ocrModel: DEFAULT_PDF_WIKI_QWEN_OCR_MODEL,
        visionModel: DEFAULT_PDF_WIKI_QWEN_VISION_MODEL,
        textInApiUrl: 'https://api.textin.com/ai/service/v1/pdf_to_markdown',
        textInAppId: '',
        textInSecretCode: '',
        textInParseMode: 'auto',
        hasApiKey: false,
        hasTextInSecretCode: false
      };
    }
    window.getPdfWikiLlmConfig = getPdfWikiLlmConfig;

    function normalizePdfWikiQwenModel(model) {
      return DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL;
    }

    async function syncPdfWikiLlmConfigFromServer() {
      try {
        var response = await fetch('/api/pdf-wiki/config');
        if (!response.ok) return getPdfWikiLlmConfig();
        var data = await response.json();
        if (data.success) {
          var localConfig = getPdfWikiLlmConfig();
          var config = {
            apiUrl: data.apiUrl || '',
            apiKey: localConfig.apiKey || '',
            model: DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL,
            jsonModel: DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL,
            ocrModel: DEFAULT_PDF_WIKI_QWEN_OCR_MODEL,
            visionModel: DEFAULT_PDF_WIKI_QWEN_VISION_MODEL,
            textInApiUrl: data.textInApiUrl || 'https://api.textin.com/ai/service/v1/pdf_to_markdown',
            textInAppId: data.textInAppId || '',
            textInSecretCode: localConfig.textInSecretCode || '',
            textInParseMode: data.textInParseMode || 'auto',
            hasApiKey: !!data.hasApiKey || !!localConfig.apiKey,
            hasTextInSecretCode: !!data.hasTextInSecretCode || !!localConfig.textInSecretCode,
            liteParseAvailable: !!data.liteParseAvailable,
            markerAvailable: !!data.markerAvailable,
            fastTextAvailable: !!data.fastTextAvailable,
            liteParseStatus: data.liteParseStatus || null,
            fastTextStatus: data.fastTextStatus || null
          };
          localStorage.setItem(PDF_WIKI_LLM_KEY, JSON.stringify(config));
          return config;
        }
      } catch (e) {
        console.warn('[PdfWikiConfig] 从服务器同步配置失败:', e);
      }
      return getPdfWikiLlmConfig();
    }

    window.showPdfWikiLlmDialog = async function() {
      var config = await syncPdfWikiLlmConfigFromServer();

      showModal('📖 PDF Wiki 自动解析配置',
        '<div style="color:var(--text-secondary);font-size:13px;line-height:1.7;margin-bottom:15px;">' +
        '用于处理 PDF 全文、Meta 分析编码表和 PDF Wiki。用户只需要配置千问/百炼 API，具体模型由系统内置预设：文本结构化 qwen-long/qwen-max，图片表格 OCR qwen-vl-ocr，复杂视觉兜底 qwen-vl-max。' +
        '</div>' +
        '<div style="background:var(--modal-tip-bg);border:1px solid var(--accent-color);border-radius:8px;padding:12px;margin-bottom:15px;color:var(--text-primary);font-size:12px;line-height:1.8;">' +
        '<b>自动模式（推荐）：</b><br>' +
        '1. 如果启用了 Codex CLI 优先，则先用 Codex 直读 PDF。<br>' +
        '2. 没有 Codex 或关闭 Codex 时，默认使用 LiteParse 读取文本，再用千问预设模型做结构化抽取。<br>' +
        '3. 遇到表格图片、扫描页或不确定图件时，按 qwen-vl-ocr → qwen-vl-max 的视觉链路做 OCR/兜底，并把不确定结果送到图像数字化复核。' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start;">' +
          '<section style="border:1px solid var(--border-color);border-radius:8px;padding:12px;background:var(--bg-secondary);">' +
            '<div style="font-weight:700;color:var(--text-primary);margin-bottom:8px;">LiteParse / Marker / pdf-marker-md 本地文本</div>' +
            '<div style="font-size:12px;color:var(--text-secondary);line-height:1.7;margin-bottom:10px;">用于 PDF 预处理。LiteParse 是随安装包提供的内置 npm 解析器；Marker 和 pdf-marker-md 快速文本是用户本机可选外部工具，不默认打包进 Electron 安装包，可在下方一键安装到本机数据目录。</div>' +
            '<div style="background:var(--modal-tip-bg);border:1px solid var(--border-color);border-radius:8px;padding:10px;color:var(--text-primary);font-size:12px;line-height:1.8;">' +
              '<b>当前 PDF 文本提取顺序：</b><br>' +
              'Codex CLI（启用时）→ LiteParse 本地解析 → Marker 外部工具（已安装时）→ pdf-marker-md 快速文本 → 本机 pdf-parse。<br>' +
              'LiteParse 已随 exe 的 node_modules 提供；Marker 和 pdf-marker-md 快速文本按需一键安装。' +
            '</div>' +
            '<div id="pdfLiteParseStatusBox" style="margin-top:10px;background:var(--modal-bg);border:1px solid var(--border-color);border-radius:8px;padding:10px;color:var(--text-secondary);font-size:12px;line-height:1.7;">正在检测 LiteParse...</div>' +
            '<div id="pdfMarkerStatusBox" style="margin-top:8px;background:var(--modal-bg);border:1px solid var(--border-color);border-radius:8px;padding:10px;color:var(--text-secondary);font-size:12px;line-height:1.7;">正在检测 Marker...</div>' +
            '<div id="pdfFastTextStatusBox" style="margin-top:8px;background:var(--modal-bg);border:1px solid var(--border-color);border-radius:8px;padding:10px;color:var(--text-secondary);font-size:12px;line-height:1.7;">正在检测 pdf-marker-md 快速文本...</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">' +
              '<button type="button" onclick="refreshPdfLocalParserStatus()" style="padding:5px 8px;border:1px solid var(--border-color);border-radius:5px;background:var(--modal-bg);color:var(--text-primary);cursor:pointer;font-size:12px;">重新检测</button>' +
              '<button type="button" onclick="installPdfMarker()" style="padding:5px 8px;border:1px solid var(--accent-color);border-radius:5px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">一键安装 Marker</button>' +
              '<button type="button" onclick="installPdfFastText()" style="padding:5px 8px;border:1px solid var(--accent-color);border-radius:5px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">一键安装快速文本</button>' +
            '</div>' +
            '<input type="hidden" id="pdfWikiTextInApiUrl" value="' + escapeHtml(config.textInApiUrl || '') + '">' +
            '<input type="hidden" id="pdfWikiTextInAppId" value="' + escapeHtml(config.textInAppId || '') + '">' +
            '<input type="hidden" id="pdfWikiTextInSecretCode" value="' + escapeHtml(config.textInSecretCode || '') + '">' +
            '<input type="hidden" id="pdfWikiTextInParseMode" value="' + escapeHtml(config.textInParseMode || 'auto') + '">' +
          '</section>' +
          '<section style="border:1px solid var(--border-color);border-radius:8px;padding:12px;background:var(--bg-secondary);">' +
            '<div style="font-weight:700;color:var(--text-primary);margin-bottom:8px;">千问 API（模型已内置）</div>' +
            '<div style="font-size:12px;color:var(--text-secondary);line-height:1.7;margin-bottom:10px;">只需要填写百炼兼容模式 API 地址和 API Key。模型由系统自动使用：文本结构化 qwen-long/qwen-max，图片/表格 OCR qwen-vl-ocr，复杂视觉兜底 qwen-vl-max。</div>' +
            '<div style="font-size:12px;line-height:1.8;margin-bottom:10px;">' +
              '<a href="https://www.qianwen.com/" target="_blank" rel="noopener noreferrer" style="color:var(--accent-color);text-decoration:underline;">千问官网</a>' +
              '<span style="margin:0 8px;color:var(--text-secondary);">|</span>' +
              '<a href="https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key" target="_blank" rel="noopener noreferrer" style="color:var(--accent-color);text-decoration:underline;">百炼 API Key 页面</a>' +
              '<span style="margin:0 8px;color:var(--text-secondary);">|</span>' +
              '<a href="https://help.aliyun.com/zh/model-studio/get-api-key" target="_blank" rel="noopener noreferrer" style="color:var(--accent-color);text-decoration:underline;">获取 API Key 文档</a>' +
            '</div>' +
            '<div style="background:var(--modal-tip-bg);border:1px solid var(--border-color);border-radius:8px;padding:10px;margin-bottom:10px;color:var(--text-primary);font-size:12px;line-height:1.8;">' +
              'API 地址通常填写：<br><code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;word-break:break-all;">https://dashscope.aliyuncs.com/compatible-mode/v1</code>' +
            '</div>' +
            '<div style="margin-bottom:10px;">' +
              '<label style="display:block;margin-bottom:5px;color:var(--text-primary);font-size:12px;">API 地址</label>' +
              '<input type="text" id="pdfWikiApiUrl" value="' + escapeHtml(config.apiUrl || DEFAULT_EMBEDDING_API_URL) + '" ' +
              'style="width:100%;padding:9px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);color:var(--text-primary);border-radius:4px;font-size:12px;" ' +
              'placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1">' +
            '</div>' +
            '<div style="margin-bottom:10px;">' +
              '<label style="display:block;margin-bottom:5px;color:var(--text-primary);font-size:12px;">API 密钥</label>' +
              '<input type="password" id="pdfWikiApiKey" value="' + escapeHtml(config.apiKey || '') + '" ' +
              'style="width:100%;padding:9px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);color:var(--text-primary);border-radius:4px;font-size:12px;" ' +
              'placeholder="' + (config.hasApiKey && !config.apiKey ? '已保存；留空保持不变' : '输入阿里云百炼 API Key') + '">' +
            '</div>' +
            '<div style="background:var(--modal-tip-bg);border:1px solid var(--border-color);border-radius:8px;padding:10px;color:var(--text-primary);font-size:12px;line-height:1.8;">' +
              '<b>内置模型预设</b><br>' +
              '文本结构化：<code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;">' + DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL + '</code> / <code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;">' + DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL + '</code><br>' +
              '图片/表格 OCR：<code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;">' + DEFAULT_PDF_WIKI_QWEN_OCR_MODEL + '</code><br>' +
              '复杂视觉兜底：<code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;">' + DEFAULT_PDF_WIKI_QWEN_VISION_MODEL + '</code>' +
            '</div>' +
          '</section>' +
        '</div>' +
        '<div class="btns" style="margin-top:15px;">' +
        '<button class="cancel" onclick="closeModal()">取消</button>' +
        '<button class="ok" onclick="savePdfWikiLlmConfig()">保存</button>' +
        '</div>',
        true
      );
      renderPdfLiteParseStatus(config.liteParseStatus || { available: !!config.liteParseAvailable, bundled: true });
      if (config.fastTextStatus) renderPdfFastTextStatus(config.fastTextStatus);
      refreshPdfLocalParserStatus();
      pollPdfMarkerInstallStatus(false);
      pollPdfFastTextInstallStatus(false);
    };

    window.refreshPdfLocalParserStatus = async function() {
      var liteBox = document.getElementById('pdfLiteParseStatusBox');
      var fastBox = document.getElementById('pdfFastTextStatusBox');
      if (liteBox) liteBox.innerHTML = '正在检测 LiteParse...';
      if (fastBox) fastBox.innerHTML = '正在检测 pdf-marker-md 快速文本...';
      try {
        var response = await fetch('/api/pdf-wiki/config');
        var data = await response.json();
        if (!data.success) throw new Error(data.error || '检测失败');
        renderPdfLiteParseStatus(data.liteParseStatus || { available: !!data.liteParseAvailable, bundled: true });
        if (data.fastTextStatus) renderPdfFastTextStatus(data.fastTextStatus);
      } catch (e) {
        if (liteBox) liteBox.innerHTML = '<span style="color:var(--danger-color);">LiteParse 检测失败：' + escapeHtml(e.message) + '</span>';
        if (fastBox) fastBox.innerHTML = '<span style="color:var(--danger-color);">快速文本检测失败：' + escapeHtml(e.message) + '</span>';
      }
      refreshPdfMarkerStatus();
      refreshPdfFastTextStatus();
    };

    function renderPdfLiteParseStatus(status) {
      var box = document.getElementById('pdfLiteParseStatusBox');
      if (!box) return;
      if (status && status.available) {
        box.innerHTML =
          '<div style="font-weight:700;color:var(--accent-color);margin-bottom:4px;">LiteParse：已内置，可用</div>' +
          '<div>来源：<code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;">' + escapeHtml(status.packageName || '@llamaindex/liteparse') + '</code>，随 Electron 安装包的 node_modules 提供，不需要用户额外安装。</div>';
      } else {
        box.innerHTML =
          '<div style="font-weight:700;color:var(--danger-color);margin-bottom:4px;">LiteParse：未检测到</div>' +
          '<div>LiteParse 应随 exe 内置；如果这里不可用，请重新安装应用或检查安装包是否包含 node_modules。</div>' +
          (status && status.note ? '<div style="margin-top:4px;">提示：' + escapeHtml(status.note) + '</div>' : '');
      }
    }

    window.refreshPdfMarkerStatus = async function() {
      var box = document.getElementById('pdfMarkerStatusBox');
      if (box) box.innerHTML = '正在检测 Marker...';
      try {
        var response = await fetch('/api/pdf-wiki/marker/status');
        var data = await response.json();
        if (!data.success) throw new Error(data.error || '检测失败');
        renderPdfMarkerStatus(data.data || {});
      } catch (e) {
        if (box) box.innerHTML = '<span style="color:var(--danger-color);">Marker 检测失败：' + escapeHtml(e.message) + '</span>';
      }
    };

    function renderPdfMarkerStatus(status) {
      var box = document.getElementById('pdfMarkerStatusBox');
      if (!box) return;
      if (status.available) {
        box.innerHTML =
          '<div style="font-weight:700;color:var(--accent-color);margin-bottom:4px;">Marker：可用</div>' +
          '<div>命令：<code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;word-break:break-all;">' + escapeHtml(status.executable || '') + '</code></div>' +
          (status.version ? '<div>信息：' + escapeHtml(status.version) + '</div>' : '');
      } else {
        box.innerHTML =
          '<div style="font-weight:700;color:var(--danger-color);margin-bottom:4px;">Marker：未检测到</div>' +
          '<div>可点击“一键安装 Marker”。系统会在本机数据目录创建独立 Python 虚拟环境并安装 <code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;">marker-pdf</code>，不会打包进 Electron 安装包。</div>' +
          '<div style="margin-top:4px;">目录：<code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;word-break:break-all;">' + escapeHtml(status.venvDir || '') + '</code></div>' +
          (status.error ? '<div style="margin-top:4px;">提示：' + escapeHtml(status.error) + '</div>' : '');
      }
    }

    window.installPdfMarker = async function() {
      var box = document.getElementById('pdfMarkerStatusBox');
      if (box) box.innerHTML = '正在启动 Marker 一键安装任务...';
      try {
        var response = await fetch('/api/pdf-wiki/marker/install', { method: 'POST' });
        var data = await response.json();
        if (!data.success) throw new Error(data.error || '安装启动失败');
        renderPdfMarkerInstallStatus(data.data || {});
        pollPdfMarkerInstallStatus(true);
      } catch (e) {
        if (box) box.innerHTML = '<span style="color:var(--danger-color);">Marker 安装启动失败：' + escapeHtml(e.message) + '</span>';
      }
    };

    async function pollPdfMarkerInstallStatus(startTimer) {
      try {
        var response = await fetch('/api/pdf-wiki/marker/install/status');
        var data = await response.json();
        if (!data.success) return;
        var job = data.data || {};
        if (job.status && job.status !== 'idle') renderPdfMarkerInstallStatus(job);
        if (job.status === 'running') {
          setTimeout(function() { pollPdfMarkerInstallStatus(false); }, startTimer ? 1200 : 2500);
        } else if (job.status === 'complete') {
          setTimeout(refreshPdfMarkerStatus, 800);
        }
      } catch (e) {
        console.warn('[PdfMarker] 查询安装状态失败:', e);
      }
    }

    function renderPdfMarkerInstallStatus(job) {
      var box = document.getElementById('pdfMarkerStatusBox');
      if (!box) return;
      var color = job.status === 'failed' ? 'var(--danger-color)' : (job.status === 'complete' ? 'var(--accent-color)' : 'var(--text-primary)');
      box.innerHTML =
        '<div style="font-weight:700;color:' + color + ';margin-bottom:5px;">Marker 安装：' + escapeHtml(job.message || job.status || '') + '</div>' +
        '<div style="height:6px;background:var(--border-color);border-radius:999px;overflow:hidden;margin-bottom:7px;">' +
          '<div style="height:100%;width:' + Math.max(0, Math.min(100, Number(job.progress || 0))) + '%;background:var(--accent-color);"></div>' +
        '</div>' +
        '<div>阶段：' + escapeHtml(job.stage || '') + ' · 进度：' + escapeHtml(String(job.progress || 0)) + '%</div>' +
        (job.venvDir ? '<div>目录：<code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;word-break:break-all;">' + escapeHtml(job.venvDir) + '</code></div>' : '') +
        (job.executable ? '<div>命令：<code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;word-break:break-all;">' + escapeHtml(job.executable) + '</code></div>' : '') +
        (job.error ? '<div style="color:var(--danger-color);margin-top:4px;">' + escapeHtml(job.error) + '</div>' : '');
    }

    window.refreshPdfFastTextStatus = async function() {
      var box = document.getElementById('pdfFastTextStatusBox');
      if (box) box.innerHTML = '正在检测 pdf-marker-md 快速文本...';
      try {
        var response = await fetch('/api/pdf-wiki/fast-text/status');
        var data = await response.json();
        if (!data.success) throw new Error(data.error || '检测失败');
        renderPdfFastTextStatus(data.data || {});
      } catch (e) {
        if (box) box.innerHTML = '<span style="color:var(--danger-color);">pdf-marker-md 快速文本检测失败：' + escapeHtml(e.message) + '</span>';
      }
    };

    function renderPdfFastTextStatus(status) {
      var box = document.getElementById('pdfFastTextStatusBox');
      if (!box) return;
      if (status.available) {
        var sourceLabel = status.bundled
          ? '随安装包内置'
          : (status.source === 'user-data' ? '用户本机一键安装' : (status.source === 'env' ? '环境变量指定' : (status.source === 'dev' ? '开发机外部目录' : 'PATH')));
        box.innerHTML =
          '<div style="font-weight:700;color:var(--accent-color);margin-bottom:4px;">pdf-marker-md 快速文本：可用</div>' +
          '<div>来源：' + escapeHtml(sourceLabel) + '</div>' +
          '<div>命令：<code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;word-break:break-all;">' + escapeHtml(status.executable || '') + '</code></div>';
      } else {
        box.innerHTML =
          '<div style="font-weight:700;color:var(--danger-color);margin-bottom:4px;">pdf-marker-md 快速文本：未检测到</div>' +
          '<div>可点击“一键安装快速文本”。系统会在本机数据目录创建独立 Python 虚拟环境并安装 <code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;">pdftext</code>，用于提供 <code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;">pdftext.exe</code>。</div>' +
          '<div style="margin-top:4px;">目录：<code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;word-break:break-all;">' + escapeHtml(status.venvDir || '') + '</code></div>' +
          (status.error ? '<div style="margin-top:4px;">提示：' + escapeHtml(status.error) + '</div>' : '');
      }
    }

    window.installPdfFastText = async function() {
      var box = document.getElementById('pdfFastTextStatusBox');
      if (box) box.innerHTML = '正在启动 pdf-marker-md 快速文本一键安装任务...';
      try {
        var response = await fetch('/api/pdf-wiki/fast-text/install', { method: 'POST' });
        var data = await response.json();
        if (!data.success) throw new Error(data.error || '安装启动失败');
        renderPdfFastTextInstallStatus(data.data || {});
        pollPdfFastTextInstallStatus(true);
      } catch (e) {
        if (box) box.innerHTML = '<span style="color:var(--danger-color);">pdf-marker-md 快速文本安装启动失败：' + escapeHtml(e.message) + '</span>';
      }
    };

    async function pollPdfFastTextInstallStatus(startTimer) {
      try {
        var response = await fetch('/api/pdf-wiki/fast-text/install/status');
        var data = await response.json();
        if (!data.success) return;
        var job = data.data || {};
        if (job.status && job.status !== 'idle') renderPdfFastTextInstallStatus(job);
        if (job.status === 'running') {
          setTimeout(function() { pollPdfFastTextInstallStatus(false); }, startTimer ? 1200 : 2500);
        } else if (job.status === 'complete') {
          setTimeout(refreshPdfFastTextStatus, 800);
        }
      } catch (e) {
        console.warn('[PdfFastText] 查询安装状态失败:', e);
      }
    }

    function renderPdfFastTextInstallStatus(job) {
      var box = document.getElementById('pdfFastTextStatusBox');
      if (!box) return;
      var color = job.status === 'failed' ? 'var(--danger-color)' : (job.status === 'complete' ? 'var(--accent-color)' : 'var(--text-primary)');
      box.innerHTML =
        '<div style="font-weight:700;color:' + color + ';margin-bottom:5px;">快速文本安装：' + escapeHtml(job.message || job.status || '') + '</div>' +
        '<div style="height:6px;background:var(--border-color);border-radius:999px;overflow:hidden;margin-bottom:7px;">' +
          '<div style="height:100%;width:' + Math.max(0, Math.min(100, Number(job.progress || 0))) + '%;background:var(--accent-color);"></div>' +
        '</div>' +
        '<div>阶段：' + escapeHtml(job.stage || '') + ' · 进度：' + escapeHtml(String(job.progress || 0)) + '%</div>' +
        (job.venvDir ? '<div>目录：<code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;word-break:break-all;">' + escapeHtml(job.venvDir) + '</code></div>' : '') +
        (job.executable ? '<div>命令：<code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;word-break:break-all;">' + escapeHtml(job.executable) + '</code></div>' : '') +
        (job.error ? '<div style="color:var(--danger-color);margin-top:4px;">' + escapeHtml(job.error) + '</div>' : '');
    }

    window.savePdfWikiLlmConfig = function() {
      var existingConfig = getPdfWikiLlmConfig();
      var apiUrlInputValue = document.getElementById('pdfWikiApiUrl').value.trim();
      var apiKeyValue = document.getElementById('pdfWikiApiKey').value.trim();
      var apiUrlValue = (apiKeyValue || (existingConfig.hasApiKey && !apiKeyValue))
        ? (apiUrlInputValue || DEFAULT_EMBEDDING_API_URL)
        : '';
      var modelValue = DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL;
      var textInApiUrlValue = document.getElementById('pdfWikiTextInApiUrl').value.trim() || 'https://api.textin.com/ai/service/v1/pdf_to_markdown';
      var textInAppIdValue = document.getElementById('pdfWikiTextInAppId').value.trim();
      var textInSecretCodeValue = document.getElementById('pdfWikiTextInSecretCode').value.trim();
      var textInParseModeValue = document.getElementById('pdfWikiTextInParseMode').value || 'auto';
      var keepApiKey = !!(apiUrlValue && existingConfig.hasApiKey && !apiKeyValue);
      var keepTextInSecretCode = !!(textInAppIdValue && existingConfig.hasTextInSecretCode && !textInSecretCodeValue);

      if ((apiUrlValue && !apiKeyValue && !keepApiKey) || (!apiUrlValue && apiKeyValue)) {
        alert('千问 API 地址和 API 密钥需要同时填写；如果只填 API Key，系统会自动使用百炼默认 API 地址。');
        return;
      }
      var config = {
        apiUrl: apiUrlValue,
        apiKey: apiKeyValue,
        model: modelValue,
        jsonModel: DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL,
        ocrModel: DEFAULT_PDF_WIKI_QWEN_OCR_MODEL,
        visionModel: DEFAULT_PDF_WIKI_QWEN_VISION_MODEL,
        textInApiUrl: textInApiUrlValue,
        textInAppId: textInAppIdValue,
        textInSecretCode: textInSecretCodeValue,
        textInParseMode: textInParseModeValue,
        hasApiKey: !!(apiKeyValue || keepApiKey),
        hasTextInSecretCode: !!(textInSecretCodeValue || keepTextInSecretCode)
      };
      localStorage.setItem(PDF_WIKI_LLM_KEY, JSON.stringify(config));

      fetch('/api/pdf-wiki/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, config, {
          keepApiKey: keepApiKey,
          keepTextInSecretCode: keepTextInSecretCode
        }))
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.success) throw new Error(data.error || '保存失败');
        showConfigCenterDialog();
        var qwenStatus = apiUrlValue && (apiKeyValue || keepApiKey) ? '已配置，模型由系统预设' : '未配置，必要时使用小牛马 API';
        appendMessage('✅ PDF Wiki 自动解析配置已保存\n\n无 Codex 默认链路：LiteParse → qwen-long/qwen-max → qwen-vl-ocr → qwen-vl-max\n千问 API：' + qwenStatus, 'bot', false, true);
      })
      .catch(function(e) {
        showConfigCenterDialog();
        appendMessage('⚠️ PDF Wiki 自动解析配置已保存到本地，但同步服务器失败：' + e.message, 'bot', false, true);
      });
    };
    
    // ========== Embedding API 配置 ==========
    window.showEmbeddingDialog = function() {
      var saved = localStorage.getItem(EMBEDDING_KEY);
      var embeddingConfig = saved ? normalizeEmbeddingConfig(JSON.parse(saved)) : getDefaultEmbeddingConfig();
      
      console.log('[Embedding] 打开配置对话框，当前配置:', { 
        url: embeddingConfig.url ? '已填写' : '空', 
        key: embeddingConfig.key ? '已填写' : '空', 
        model: embeddingConfig.model,
        enabled: embeddingConfig.enabled 
      });
      
      showModal('🔤 Embedding API 配置',
        '<div style="color:var(--text-secondary);font-size:13px;margin-bottom:15px;">' +
        '用于文献语义搜索，将您的查询与文献库进行语义匹配。<br>' +
        '<b>提示：</b>如果不配置，系统将使用关键词匹配（词汇搜索）。' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
        '<label style="display:block;margin-bottom:5px;color:var(--text-primary);">API URL</label>' +
        '<input type="text" id="embeddingUrl" value="' + escapeHtml(embeddingConfig.url || DEFAULT_EMBEDDING_API_URL) + '" ' +
        'style="width:100%;padding:10px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);color:var(--text-primary);border-radius:4px;" ' +
        'placeholder="' + DEFAULT_EMBEDDING_API_URL + '">' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
        '<label style="display:block;margin-bottom:5px;color:var(--text-primary);">模型名称</label>' +
        '<input type="text" id="embeddingModel" value="' + escapeHtml(embeddingConfig.model || DEFAULT_EMBEDDING_MODEL) + '" ' +
        'style="width:100%;padding:10px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);color:var(--text-primary);border-radius:4px;" ' +
        'placeholder="' + DEFAULT_EMBEDDING_MODEL + '">' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
        '<label style="display:block;margin-bottom:5px;color:var(--text-primary);">API Key <a href="' + QWEN_API_KEY_URL + '" target="_blank" rel="noopener noreferrer" style="color:var(--accent-color);">(点击获取)</a></label>' +
        '<input type="password" id="embeddingKey" value="' + (embeddingConfig.key || '') + '" ' +
        'style="width:100%;padding:10px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);color:var(--text-primary);border-radius:4px;" ' +
        'placeholder="sk-xxxxxxxxxxxxxxxx">' +
        '</div>' +
        '<div style="margin-bottom:15px;">' +
        '<label style="display:flex;align-items:center;gap:8px;color:var(--text-primary);cursor:pointer;">' +
        '<input type="checkbox" id="embeddingEnabled" ' + (embeddingConfig.enabled !== false ? 'checked' : '') + ' ' +
        'style="width:auto;position:relative;top:6px;"> 启用 Embedding 搜索' +
        '</label>' +
        '</div>' +
        '<div class="btns">' +
        '<button class="cancel" onclick="closeModal()">取消</button>' +
        '<button class="ok" onclick="saveEmbeddingConfig()">保存</button>' +
        '</div>'
      );
    }
    
    window.saveEmbeddingConfig = function(options) {
      options = options || {};
      var url = (document.getElementById('embeddingUrl')?.value.trim() || DEFAULT_EMBEDDING_API_URL);
      var key = document.getElementById('embeddingKey').value.trim();
      var model = (document.getElementById('embeddingModel')?.value.trim() || DEFAULT_EMBEDDING_MODEL);
      var dimensions = DEFAULT_EMBEDDING_DIMENSIONS;
      var enabled = document.getElementById('embeddingEnabled').checked;
      
      console.log('[Embedding] Saving config:', { url: url ? '已填写' : '空', key: key ? '已填写' : '空', model: model, dimensions: dimensions, enabled: enabled });
      
      if (enabled) {
        if (!key) {
          alert('请填写 API Key\n\n请点击上方"点击获取"获取密钥');
          return Promise.resolve(false);
        }
      }
      
      var config = { url: url, key: key, model: model, dimensions: dimensions, enabled: enabled };
      localStorage.setItem(EMBEDDING_KEY, JSON.stringify(config));
      console.log('[Embedding] Config saved to localStorage:', EMBEDDING_KEY);
      
      // 发送到服务器
      return fetch('/api/embedding/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        console.log('[Embedding] Server response:', data);
        if (data.success) {
          appendMessage(' Embedding 配置已保存。' + (enabled ? '系统将使用语义搜索。' : '已禁用语义搜索，使用词汇匹配。'), 'bot', false, true);
        } else {
          appendMessage(' 配置保存失败：' + (data.error || '未知错误'), 'bot', false, true);
        }
        if (data.success && options.returnAction === 'literature' && enabled) {
          firstRunOnboardingReadiness = Object.assign({}, firstRunOnboardingReadiness || {}, { embeddingReady: true });
          completeFirstRunOnboarding('literature');
        } else if (data.success && options.returnAction === 'ai-configuration') {
          guidedConfigState = null;
          firstRunOnboardingReadiness = null;
          closeModal();
          setTimeout(function() { startAiConfigurationAssistant('all'); }, 120);
        } else if (!options.returnAction) {
          showConfigCenterDialog();
        }
        return !!data.success;
      })
      .catch(function(e) {
        console.error('[Embedding] Save error:', e);
        // 即使服务器请求失败，本地配置也已保存
        appendMessage(' Embedding 配置已保存到本地。' + (enabled ? '语义搜索已启用。' : '语义搜索已禁用。'), 'bot', false, true);
        if (options.returnAction === 'literature' && enabled) {
          firstRunOnboardingReadiness = Object.assign({}, firstRunOnboardingReadiness || {}, { embeddingReady: true });
          completeFirstRunOnboarding('literature');
        } else if (options.returnAction === 'ai-configuration') {
          guidedConfigState = null;
          firstRunOnboardingReadiness = null;
          closeModal();
          setTimeout(function() { startAiConfigurationAssistant('all'); }, 120);
        } else {
          showConfigCenterDialog();
        }
        return true;
      });
    }
    
    function getEmbeddingConfig() {
      var data = localStorage.getItem(EMBEDDING_KEY);
      if (data) {
        return normalizeEmbeddingConfig(JSON.parse(data));
      }
      return getDefaultEmbeddingConfig();
    }
    window.getEmbeddingConfig = getEmbeddingConfig;

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('provider-config', { source: '/app/provider-config.js' });
}
