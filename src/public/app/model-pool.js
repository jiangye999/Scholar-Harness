/**
 * Model Pool UI (步骤 4) - 提供方列表 + 编辑面板
 *
 * 列表行: [健康点] [名称] [当前徽标] ... [设为当前] [编辑]
 * 底部: [+ 添加提供方] [+ 添加自定义提供方] (虚线按钮)
 * 编辑面板: 提供方下拉 / [自定义时]API URL / API 密钥 / 模型名称(自动拉取列表) / 删除+取消+保存
 *
 * 说明:
 * - 故障自动切换默认开启, 无勾选框
 * - 无"自定义设置"折叠区; 模型名称由所选厂商 URL 自动返回可用模型列表
 * - 用内存 state 驱动渲染, DOM 是纯视图
 */
(function () {
  if (window.ScholarHarnessModelPool) return;

  function escapeHtml(s) {
    if (s === undefined || s === null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function genEntryId(prefix) {
    return (prefix || 'm') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  var healthTimer = null;
  var state = {};

  var PROVIDER_PRESETS = [
    { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', modelHint: 'openrouter/free' },
    { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com', modelHint: 'deepseek-chat' },
    { id: 'dashscope', name: '阿里云百炼', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelHint: 'qwen-plus' },
    { id: 'tokenplan', name: '阿里云 Token Plan', url: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', modelHint: 'qwen3.5-plus' },
    { id: 'moonshotai', name: 'Moonshot (Kimi)', url: 'https://api.moonshot.cn/v1', modelHint: 'moonshot-v1-8k' },
    { id: 'zhipu', name: '智谱 GLM', url: 'https://open.bigmodel.cn/api/paas/v4/', modelHint: 'glm-4-plus' },
    { id: 'siliconflow', name: 'SiliconFlow', url: 'https://api.siliconflow.cn/v1', modelHint: 'deepseek/deepseek-chat' },
    { id: 'openai', name: 'OpenAI', url: 'https://api.openai.com/v1', modelHint: 'gpt-4o' },
    { id: 'groq', name: 'Groq', url: 'https://api.groq.com/openai/v1', modelHint: 'llama-3.3-70b-versatile' },
    { id: 'google', name: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/', modelHint: 'gemini-2.5-flash' },
    { id: 'mistral', name: 'Mistral', url: 'https://api.mistral.ai/v1', modelHint: 'mistral-large-latest' },
    { id: 'minimax', name: 'MiniMax', url: 'https://api.minimax.io/v1', modelHint: 'MiniMax-M2' },
  ];
  function presetById(id) {
    for (var i = 0; i < PROVIDER_PRESETS.length; i++) if (PROVIDER_PRESETS[i].id === id) return PROVIDER_PRESETS[i];
    return null;
  }
  function presetByUrl(url) {
    if (!url) return null;
    for (var i = 0; i < PROVIDER_PRESETS.length; i++) if (PROVIDER_PRESETS[i].url === url) return PROVIDER_PRESETS[i];
    return null;
  }

  var SECTION_META = {
    primary: { title: '🌾 Grass · OpenRouter 免费模型' },
    secondary: { title: '🐄 Little corse 文本' },
    secondary_vision: { title: '🐄 Little corse 视觉' },
  };

  function initState(provider, config) {
    var pool = (config && config.pool) || { models: [], active_model_id: '' };
    var models = (pool.models && pool.models.length > 0) ? pool.models : [];
    if (models.length === 0 && (config && (config.model || config.api_url))) {
      models = [{
        id: genEntryId(provider), label: '', model: config.model || '', api_url: config.api_url || '',
        has_api_key: !!config.has_api_key, enabled: true, priority: 0,
      }];
    }
    models = models.map(function (m) {
      var preset = presetByUrl(m.api_url);
      return {
        id: m.id, label: m.label || '', model: m.model || '', api_url: m.api_url || '',
        api_key: '', has_api_key: !!m.has_api_key || !!(m.api_key), vision_model: m.vision_model || '',
        enabled: m.enabled !== false, priority: m.priority || 0,
        provider: preset ? preset.id : 'custom',
      };
    });
    models.sort(function (a, b) { return a.priority - b.priority; });
    state[provider] = {
      models: models,
      activeId: pool.active_model_id || (models[0] && models[0].id) || '',
      autoFallback: true,
      editingId: null,
    };
  }

  function renderEntryRow(provider, entry) {
    var st = state[provider];
    var isActive = st.activeId === entry.id;
    var preset = presetById(entry.provider);
    var displayName = entry.label || ((preset ? preset.name : '自定义') + (entry.model ? ' · ' + entry.model : ''));

    var rowStyle = 'display:flex;align-items:center;gap:8px;padding:12px 16px;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-input);margin-bottom:10px;';
    var nameStyle = 'font-size:13px;font-weight:700;color:var(--text-primary);';
    var pillBtn = 'padding:5px 14px;border:1px solid var(--border-color);border-radius:999px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;';

    return ''
      + '<div class="mp-entry" data-provider="' + escapeAttr(provider) + '" data-entry-id="' + escapeAttr(entry.id) + '" style="' + rowStyle + '">'
      +   '<span class="mp-health-dot" data-entry-id="' + escapeAttr(entry.id) + '" title="健康状态未知" style="width:8px;height:8px;border-radius:50%;background:#9ca3af;display:inline-block;flex-shrink:0;"></span>'
      +   '<span style="' + nameStyle + '">' + escapeHtml(displayName) + '</span>'
      +   (isActive ? '<span style="font-size:10px;padding:2px 8px;background:var(--accent-color);color:#fff;border-radius:10px;">当前</span>' : '')
      +   '<span class="mp-health-text" data-entry-id="' + escapeAttr(entry.id) + '" style="font-size:11px;color:var(--text-secondary);"></span>'
      +   '<span style="flex:1;"></span>'
      +   (isActive ? '' : '<button type="button" class="mp-set-active" style="' + pillBtn + '">设为当前</button>')
      +   '<button type="button" class="mp-edit" style="' + pillBtn + '">编辑</button>'
      + '</div>';
  }

  function renderEditPanel(provider, entry) {
    var isCustom = entry.provider === 'custom';
    var selectedPreset = presetById(entry.provider);
    var isOpenRouter = !!selectedPreset && selectedPreset.id === 'openrouter';

    var panelStyle = 'margin-bottom:12px;padding:16px;border-radius:12px;background:rgba(148,163,184,0.08);border:1px solid var(--border-color);';
    var labelStyle = 'display:block;margin-bottom:6px;font-size:12px;color:var(--text-secondary);';
    var inputStyle = 'width:100%;padding:9px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input);color:var(--text-primary);font-size:13px;';

    var providerOptions = '';
    for (var i = 0; i < PROVIDER_PRESETS.length; i++) {
      var p = PROVIDER_PRESETS[i];
      providerOptions += '<option value="' + escapeAttr(p.id) + '"' + (entry.provider === p.id ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>';
    }
    providerOptions += '<option value="custom"' + (isCustom ? ' selected' : '') + '>自定义 (手动填 URL)</option>';

    var keyPlaceholder = entry.has_api_key ? '已保存；留空保持原 Key' : '输入 API 密钥，或留空使用环境认证';

    var html = ''
      + '<div class="mp-edit-panel" data-provider="' + escapeAttr(provider) + '" data-entry-id="' + escapeAttr(entry.id) + '" style="' + panelStyle + '">'
      +   '<div style="margin-bottom:12px;">'
      +     '<label style="' + labelStyle + '">提供方</label>'
      +     '<select class="mp-provider-select" style="' + inputStyle + '">' + providerOptions + '</select>'
      +   '</div>'
      // 自定义提供方: 显示 API URL
      +   (isCustom ? '<div style="margin-bottom:12px;">'
      +     '<label style="' + labelStyle + '">API URL</label>'
      +     '<input type="text" class="mp-api-url" value="' + escapeAttr(entry.api_url) + '" placeholder="https://.../compatible-mode/v1" style="' + inputStyle + '">'
      +   '</div>' : '')
      +   '<div style="margin-bottom:12px;">'
      +     '<label style="' + labelStyle + '">API 密钥</label>'
      +     '<input type="password" class="mp-api-key" placeholder="' + escapeAttr(keyPlaceholder) + '" style="' + inputStyle + '">'
      +     (isOpenRouter ? '<div style="margin-top:6px;font-size:11px;line-height:1.6;color:var(--text-secondary);">粘贴 OpenRouter API Key 后会自动加载并筛选支持 Agent 工具的免费模型。<button type="button" onclick="openOpenRouterApiKeyPage()" style="padding:0;border:0;background:transparent;color:var(--accent-color);cursor:pointer;font-size:11px;">获取 API Key ↗</button></div>' : '')
      +   '</div>'
      +   '<div style="margin-bottom:12px;">'
      +     '<label style="' + labelStyle + '">' + (isOpenRouter ? '免费模型' : '模型名称') + '</label>'
      +     '<div style="display:flex;gap:8px;align-items:center;">'
      +       '<input type="text" class="mp-model-input" value="' + escapeAttr(entry.model || '') + '" placeholder="例如：' + escapeAttr(selectedPreset ? selectedPreset.modelHint : 'model-name') + '" style="' + inputStyle + ';flex:1;">'
      +       '<button type="button" class="mp-fetch-models" style="padding:9px 13px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;white-space:nowrap;">' + (isOpenRouter ? '刷新免费模型' : '获取模型') + '</button>'
      +     '</div>'
      +     '<select class="mp-model-select" style="' + inputStyle + ';display:none;margin-top:8px;"></select>'
      +     '<div class="mp-fetch-result" style="min-height:18px;margin-top:6px;font-size:11px;color:var(--text-secondary);"></div>'
      +   '</div>'
      +   '<div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;">'
      +     '<button type="button" class="mp-delete" style="margin-right:auto;padding:7px 14px;border:1px solid var(--danger-color);border-radius:999px;background:transparent;color:var(--danger-color);cursor:pointer;font-size:12px;">删除</button>'
      +     '<button type="button" class="mp-edit-cancel" style="padding:7px 18px;border:1px solid var(--border-color);border-radius:999px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:13px;">取消</button>'
      +     '<button type="button" class="mp-edit-save" style="padding:7px 18px;border:none;border-radius:999px;background:var(--text-primary);color:var(--bg-input);cursor:pointer;font-size:13px;font-weight:600;">保存</button>'
      +   '</div>'
      + '</div>';
    return html;
  }

  function renderSectionHtml(provider) {
    var st = state[provider];
    var meta = SECTION_META[provider] || SECTION_META.secondary;

    var sectionStyle = 'margin-bottom:20px;';
    var titleStyle = 'font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:12px;';
    var dashedBtn = 'flex:1;padding:11px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:13px;';

    var rowsHtml = '';
    for (var i = 0; i < st.models.length; i++) {
      var entry = st.models[i];
      rowsHtml += (st.editingId === entry.id) ? renderEditPanel(provider, entry) : renderEntryRow(provider, entry);
    }
    if (st.models.length === 0) {
      rowsHtml = '<div style="padding:14px;border:1px dashed var(--border-color);border-radius:10px;color:var(--text-secondary);font-size:12px;text-align:center;margin-bottom:10px;">暂无模型，点击下方按钮添加</div>';
    }

    return ''
      + '<div class="mp-section" data-provider="' + escapeAttr(provider) + '" style="' + sectionStyle + '">'
      +   '<div style="' + titleStyle + '">' + escapeHtml(meta.title) + '</div>'
      +   '<div class="mp-entries">' + rowsHtml + '</div>'
      +   '<div style="display:flex;gap:10px;">'
      +     '<button type="button" class="mp-add-preset" data-provider="' + escapeAttr(provider) + '" style="' + dashedBtn + '">+ 添加提供方</button>'
      +     '<button type="button" class="mp-add-custom" data-provider="' + escapeAttr(provider) + '" style="' + dashedBtn + '">+ 添加自定义提供方</button>'
      +   '</div>'
      + '</div>';
  }

  function rerender(provider) {
    var old = document.querySelector('.mp-section[data-provider="' + provider + '"]');
    if (!old) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = renderSectionHtml(provider);
    old.parentNode.replaceChild(tmp.firstChild, old);
    pollPoolHealthOnce();
  }

  function renderProviderSection(provider, config) {
    initState(provider, config);
    return renderSectionHtml(provider);
  }

  // ========== 拉取可用模型 ==========
  function fetchModelsForPanel(panel, provider) {
    var sel = panel.querySelector('.mp-provider-select');
    var urlInput = panel.querySelector('.mp-api-url');
    var preset = presetById(sel ? sel.value : provider);
    var url = (urlInput && urlInput.value.trim()) || (preset ? preset.url : '');
    var keyInput = panel.querySelector('.mp-api-key');
    var entryId = panel.getAttribute('data-entry-id');
    var providerState = state[provider];
    var stateEntry = providerState && providerState.models.find(function(item) { return item.id === entryId; });
    var key = (keyInput && keyInput.value) || (stateEntry && stateEntry.api_key) || '';
    var resultSpan = panel.querySelector('.mp-fetch-result');
    if (!url) {
      if (resultSpan) { resultSpan.textContent = '请先选择提供方或填写 URL'; resultSpan.style.color = '#f59e0b'; }
      return;
    }
    if (resultSpan) { resultSpan.textContent = '获取中...'; resultSpan.style.color = 'var(--text-secondary)'; }
    fetch('/api/chat-bridge/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: provider, apiUrl: url, apiKey: key || undefined, modelId: entryId || undefined }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var models = data.models || [];
        var modelDetails = Array.isArray(data.modelDetails) ? data.modelDetails : [];
        var detailsById = {};
        modelDetails.forEach(function (detail) {
          if (detail && detail.id) detailsById[detail.id] = detail;
        });
        var select = panel.querySelector('.mp-model-select');
        var modelInput = panel.querySelector('.mp-model-input');
        if (models.length > 0 && select) {
          var cur = (modelInput && modelInput.value.trim()) || (stateEntry && stateEntry.model) || '';
          var html = '<option value="">-- ' + (data.freeOnly ? '选择 OpenRouter 免费模型' : '选择模型') + ' --</option>';
          for (var i = 0; i < models.length; i++) {
            var detail = detailsById[models[i]];
            var optionLabel = detail && detail.name && detail.name !== models[i]
              ? detail.name + ' · ' + models[i]
              : models[i];
            if (detail && detail.supportsTools) optionLabel += ' · 工具';
            html += '<option value="' + escapeAttr(models[i]) + '"' + (models[i] === cur ? ' selected' : '') + '>' + escapeHtml(optionLabel) + '</option>';
          }
          select.innerHTML = html;
          select.style.display = 'block';
          if (models.indexOf(cur) >= 0) {
            select.value = cur;
          } else if (data.freeOnly) {
            select.value = models[0];
            if (modelInput) modelInput.value = models[0];
          }
          if (data.freeOnly && modelInput) modelInput.readOnly = true;
          if (resultSpan) {
            resultSpan.textContent = data.freeOnly
              ? '已自动筛选 ' + models.length + ' 个支持 Agent 工具的免费模型'
              : '已获取 ' + models.length + ' 个模型';
            resultSpan.style.color = '#10a37f';
          }
        } else {
          if (resultSpan) { resultSpan.textContent = data.error || '未返回模型列表'; resultSpan.style.color = '#f59e0b'; }
        }
      })
      .catch(function (err) {
        if (resultSpan) { resultSpan.textContent = '获取失败: ' + err.message; resultSpan.style.color = '#f59e0b'; }
      });
  }

  function collectProviderSection(provider) {
    var st = state[provider];
    if (!st) return null;
    commitOpenEdit(provider);
    var models = st.models
      .filter(function (m) { return m.model || presetById(m.provider) || m.api_url; })
      .map(function (m, idx) {
        var preset = presetById(m.provider);
        return {
          id: m.id, label: m.label || (preset ? preset.name : ''), model: m.model || (preset ? preset.modelHint : ''),
          api_url: m.api_url || (preset ? preset.url : ''), api_key: m.api_key || '',
          vision_model: m.vision_model || undefined, enabled: true, priority: idx,
        };
      });
    return { models: models, active_model_id: st.activeId, auto_fallback: true };
  }

  function commitOpenEdit(provider) {
    var st = state[provider];
    if (!st || !st.editingId) return;
    var panel = document.querySelector('.mp-edit-panel[data-provider="' + provider + '"][data-entry-id="' + st.editingId + '"]');
    if (!panel) { st.editingId = null; return; }
    var entry = null;
    for (var i = 0; i < st.models.length; i++) if (st.models[i].id === st.editingId) { entry = st.models[i]; break; }
    if (!entry) { st.editingId = null; return; }
    readEditPanelInto(panel, entry);
    st.editingId = null;
  }

  function readEditPanelInto(panel, entry) {
    var providerSel = panel.querySelector('.mp-provider-select');
    var keyInput = panel.querySelector('.mp-api-key');
    var modelSelect = panel.querySelector('.mp-model-select');
    var modelInput = panel.querySelector('.mp-model-input');
    var urlInput = panel.querySelector('.mp-api-url');
    entry.provider = providerSel ? providerSel.value : entry.provider;
    if (keyInput && keyInput.value) entry.api_key = keyInput.value;
    if (modelInput && modelInput.value.trim()) entry.model = modelInput.value.trim();
    else if (modelSelect && modelSelect.value) entry.model = modelSelect.value;
    if (urlInput) entry.api_url = urlInput.value.trim();
    entry.enabled = true;
  }

  function switchActiveModel(provider, modelId) {
    return fetch('/api/chat-bridge/pool/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: provider, model_id: modelId }),
    }).then(function (r) { return r.json(); });
  }

  // 把当前 DOM 中所有档位的 pool 落盘 (设为当前前自动调用, 避免"未保存就切换"报错)
  function persistPools() {
    var sections = document.querySelectorAll('.mp-section');
    if (!sections.length) return Promise.resolve(null);
    var body = { mode: 'api' };
    sections.forEach(function (s) {
      var provider = s.getAttribute('data-provider');
      body[provider] = { pool: collectProviderSection(provider) };
    });
    return fetch('/api/chat-bridge/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }

  function refreshActiveSelect(provider) { rerender(provider); }

  function pollPoolHealthOnce() {
    fetch('/api/chat-bridge/pool/health')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success || !data.health) return;
        var dotColors = { healthy: '#10a37f', unknown: '#9ca3af', unhealthy: '#ef4444' };
        var labels = { healthy: '健康', unknown: '未知', unhealthy: '故障' };
        Object.keys(data.health).forEach(function (provider) {
          (data.health[provider] || []).forEach(function (h) {
            var dot = document.querySelector('.mp-health-dot[data-entry-id="' + h.id + '"]');
            var text = document.querySelector('.mp-health-text[data-entry-id="' + h.id + '"]');
            if (dot) {
              dot.style.background = dotColors[h.status] || '#9ca3af';
              dot.title = '状态: ' + (labels[h.status] || '未知') + (h.lastErrorMessage ? ' | ' + h.lastErrorMessage.slice(0, 60) : '');
            }
            if (text) {
              var pieces = [labels[h.status] || '未知'];
              if (h.consecutiveFailures > 0) pieces.push('失败 ' + h.consecutiveFailures + ' 次');
              if (h.unhealthyUntil && Date.now() < h.unhealthyUntil) pieces.push('冷却 ' + Math.ceil((h.unhealthyUntil - Date.now()) / 1000) + 's');
              text.textContent = pieces.join(' · ');
            }
          });
        });
      })
      .catch(function () {});
  }
  function startHealthPolling() { stopHealthPolling(); pollPoolHealthOnce(); healthTimer = setInterval(pollPoolHealthOnce, 5000); }
  function stopHealthPolling() { if (healthTimer) { clearInterval(healthTimer); healthTimer = null; } }

  function attachModelPoolHandlers() {
    var modalContent = document.getElementById('modalContent');
    if (!modalContent || modalContent.dataset.mpBound === '1') return;
    modalContent.dataset.mpBound = '1';

    modalContent.addEventListener('click', function (e) {
      var editBtn = e.target.closest('.mp-edit');
      if (editBtn) {
        var row = editBtn.closest('.mp-entry');
        var provider = row.getAttribute('data-provider');
        state[provider].editingId = row.getAttribute('data-entry-id');
        rerender(provider);
        return;
      }
      var cancelBtn = e.target.closest('.mp-edit-cancel');
      if (cancelBtn) {
        var p2 = cancelBtn.closest('.mp-edit-panel').getAttribute('data-provider');
        state[p2].editingId = null;
        rerender(p2);
        return;
      }
      var saveBtn = e.target.closest('.mp-edit-save');
      if (saveBtn) {
        var panel3 = saveBtn.closest('.mp-edit-panel');
        var p3 = panel3.getAttribute('data-provider');
        var id3 = panel3.getAttribute('data-entry-id');
        var st3 = state[p3];
        var entry3 = null;
        for (var i = 0; i < st3.models.length; i++) if (st3.models[i].id === id3) { entry3 = st3.models[i]; break; }
        if (entry3) readEditPanelInto(panel3, entry3);
        st3.editingId = null;
        rerender(p3);
        return;
      }
      var delBtn = e.target.closest('.mp-delete');
      if (delBtn) {
        var panel4 = delBtn.closest('.mp-edit-panel');
        var p4 = panel4.getAttribute('data-provider');
        var id4 = panel4.getAttribute('data-entry-id');
        var st4 = state[p4];
        st4.models = st4.models.filter(function (m) { return m.id !== id4; });
        if (st4.activeId === id4) st4.activeId = (st4.models[0] && st4.models[0].id) || '';
        st4.editingId = null;
        rerender(p4);
        return;
      }
      var setBtn = e.target.closest('.mp-set-active');
      if (setBtn) {
        var row6 = setBtn.closest('.mp-entry');
        var p6 = row6.getAttribute('data-provider');
        var id6 = row6.getAttribute('data-entry-id');
        state[p6].activeId = id6;
        rerender(p6);
        // 先落盘 pool 再切换, 避免"未保存就切换"报错
        persistPools()
          .then(function () { return switchActiveModel(p6, id6); })
          .then(function (r) {
            var tip = document.getElementById('mpSwitchTip');
            if (tip) {
              tip.textContent = r && r.success ? ('✓ ' + p6 + ' 已切换到 ' + (r.model || id6)) : ('⚠ ' + (r && r.error ? r.error : '切换失败, 请先保存配置'));
              tip.style.color = r && r.success ? '#10a37f' : '#f59e0b';
            }
          })
          .catch(function () {
            var tip = document.getElementById('mpSwitchTip');
            if (tip) { tip.textContent = '⚠ 切换失败, 请先点击"保存配置"'; tip.style.color = '#f59e0b'; }
          });
        return;
      }
      var fetchBtn = e.target.closest('.mp-fetch-models');
      if (fetchBtn) {
        var panel7 = fetchBtn.closest('.mp-edit-panel');
        fetchModelsForPanel(panel7, panel7.getAttribute('data-provider'));
        return;
      }
      var addPreset = e.target.closest('.mp-add-preset');
      if (addPreset) {
        var p8 = addPreset.getAttribute('data-provider');
        var newId = genEntryId(p8);
        state[p8].models.push({ id: newId, label: '', model: '', api_url: '', api_key: '', vision_model: '', enabled: true, priority: state[p8].models.length, provider: 'openrouter' });
        state[p8].editingId = newId;
        rerender(p8);
        return;
      }
      var addCustom = e.target.closest('.mp-add-custom');
      if (addCustom) {
        var p9 = addCustom.getAttribute('data-provider');
        var newId9 = genEntryId(p9);
        state[p9].models.push({ id: newId9, label: '', model: '', api_url: '', api_key: '', vision_model: '', enabled: true, priority: state[p9].models.length, provider: 'custom' });
        state[p9].editingId = newId9;
        rerender(p9);
        return;
      }
    });

    // 提供方变化 → 自动拉取模型列表
    modalContent.addEventListener('change', function (e) {
      if (e.target.classList && e.target.classList.contains('mp-model-select')) {
        var modelPanel = e.target.closest('.mp-edit-panel');
        var modelInput = modelPanel && modelPanel.querySelector('.mp-model-input');
        if (modelInput && e.target.value) modelInput.value = e.target.value;
        return;
      }
      if (e.target.classList && e.target.classList.contains('mp-provider-select')) {
        var panel = e.target.closest('.mp-edit-panel');
        var provider = panel.getAttribute('data-provider');
        var entryId = panel.getAttribute('data-entry-id');
        var st = state[provider];
        var entry = null;
        for (var i = 0; i < st.models.length; i++) if (st.models[i].id === entryId) { entry = st.models[i]; break; }
        if (entry) {
          var nextProvider = e.target.value;
          var previousProvider = entry.provider;
          readEditPanelInto(panel, entry);
          if (previousProvider !== nextProvider) {
            entry.provider = nextProvider;
            entry.model = '';
            entry.api_url = '';
            entry.api_key = '';
            entry.has_api_key = false;
          }
        }
        rerender(provider);
        return;
      }
    });

    var openRouterAutoFetchTimer = null;
    modalContent.addEventListener('input', function (e) {
      if (!e.target.classList || !e.target.classList.contains('mp-api-key')) return;
      var panel = e.target.closest('.mp-edit-panel');
      if (!panel || panel.getAttribute('data-provider') !== 'primary') return;
      var providerSelect = panel.querySelector('.mp-provider-select');
      if (!providerSelect || providerSelect.value !== 'openrouter') return;
      if (String(e.target.value || '').trim().length < 8) return;
      if (openRouterAutoFetchTimer) clearTimeout(openRouterAutoFetchTimer);
      openRouterAutoFetchTimer = setTimeout(function () {
        fetchModelsForPanel(panel, 'primary');
      }, 500);
    });
  }

  window.ScholarHarnessModelPool = {
    escapeHtml: escapeHtml,
    genEntryId: genEntryId,
    renderProviderSection: renderProviderSection,
    collectProviderSection: collectProviderSection,
    refreshActiveSelect: refreshActiveSelect,
    switchActiveModel: switchActiveModel,
    startHealthPolling: startHealthPolling,
    stopHealthPolling: stopHealthPolling,
    attachModelPoolHandlers: attachModelPoolHandlers,
    pollPoolHealthOnce: pollPoolHealthOnce,
  };

  if (window.ScholarHarnessModules) {
    window.ScholarHarnessModules.register('model-pool', { source: '/app/model-pool.js' });
  }
})();
