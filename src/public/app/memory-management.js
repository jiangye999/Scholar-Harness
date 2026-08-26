    // ========== 清空长期记忆功能 ==========

    function startClearMemoryAutoRefresh() {
      // 管理长期记忆弹窗打开后固定为打开时快照，避免轮询重绘导致滚动位置和勾选状态被打断。
      stopClearMemoryAutoRefresh();
    }

    function showMemoryManagerPanel(panelId) {
      var root = document.getElementById('memoryManagerTabs');
      if (!root || !panelId) return;
      root.querySelectorAll('[data-memory-panel-trigger]').forEach(function(trigger) {
        var active = trigger.getAttribute('data-memory-panel-trigger') === panelId;
        trigger.classList.toggle('active', active);
        trigger.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('[data-memory-panel]').forEach(function(panel) {
        var active = panel.getAttribute('data-memory-panel') === panelId;
        panel.classList.toggle('active', active);
      });
    }
    window.showMemoryManagerPanel = showMemoryManagerPanel;
    
    /**
     * 显示清空长期记忆的选择界面
     * 用户可以勾选要清空的记忆维度
     */
    window.showClearMemoryDialog = async function(silentRefresh) {
      silentRefresh = silentRefresh === true;
      var pageRequestId = 0;
      if (silentRefresh) {
        if (!isClearMemoryModalOpen() || clearMemoryRefreshInFlight) return;
        if (!workspaceActivePageRequest || workspaceActivePageRequest.key !== 'memory') return;
        pageRequestId = workspaceActivePageRequest.id;
        clearMemoryRefreshInFlight = true;
      } else {
        pageRequestId = beginWorkspacePageRequest('memory');
      }

      var selectedMemoryKeys = [];
      var selectedDimensions = [];
      var previousScrollTop = 0;
      if (silentRefresh) {
        document.querySelectorAll('input[data-memory-key]:checked').forEach(function(cb) {
          selectedMemoryKeys.push(cb.getAttribute('data-memory-key'));
        });
        document.querySelectorAll('input[data-dimension]:checked').forEach(function(cb) {
          selectedDimensions.push(cb.getAttribute('data-dimension'));
        });
        var oldScrollable = document.getElementById('clearMemoryDialogScroll');
        previousScrollTop = oldScrollable ? oldScrollable.scrollTop : 0;
      }

      try {
        // 显示加载中
        if (!silentRefresh) {
          showWorkspaceRequestModal(pageRequestId, '🗑️ 管理长期记忆',
            '<div style="text-align:center;padding:30px;color:var(--text-secondary);">' +
            '<div style="margin-bottom:15px;">正在加载记忆数据...</div>' +
            '</div>'
          , true);
        }
        
        // 获取详细记忆信息
        var response = await fetch('/api/memory/detail/' + currentUserId);
        var data = await response.json();
        if (!isWorkspacePageRequestCurrent(pageRequestId)) return;
        applyProjectScopedMemoryLabels(data);
        
        if (!data.success) {
          closeModal();
          appendMessage('❌ 获取记忆数据失败：' + (data.error || '未知错误'), 'bot', false, true);
          return;
        }

        var memorySignature = buildClearMemorySignature(data);
        if (silentRefresh && memorySignature === clearMemoryLastSignature) {
          return;
        }
        
        var html = '<div class="memory-manager-dialog"><div id="clearMemoryDialogScroll" class="memory-manager-scroll">';
        var memoryPanels = [];

        function makeMemoryPanelId(raw, index) {
          return 'memory_panel_' + String(raw || 'panel').replace(/[^a-zA-Z0-9_-]/g, '_') + '_' + index;
        }

        function addMemoryPanel(rawId, label, countLabel, description, bodyHtml) {
          var panelId = makeMemoryPanelId(rawId, memoryPanels.length);
          memoryPanels.push({
            id: panelId,
            label: label || rawId || '记忆板块',
            countLabel: countLabel || '',
            description: description || '',
            bodyHtml: bodyHtml || ''
          });
          return panelId;
        }

        function renderMemoryTabsAndPanels() {
          if (!memoryPanels.length) return '';
          var activeId = memoryPanels[0].id;
          var tabs = '<div id="memoryManagerTabs" class="memory-manager-tabs" role="tablist" aria-label="长期记忆板块">';
          memoryPanels.forEach(function(panel, index) {
            var active = panel.id === activeId;
            tabs += '<button type="button" class="memory-manager-bubble' + (active ? ' active' : '') + '" ' +
              'data-memory-panel-trigger="' + escapeHtml(panel.id) + '" ' +
              'onmouseenter="showMemoryManagerPanel(\'' + escapeHtml(panel.id) + '\')" ' +
              'onfocus="showMemoryManagerPanel(\'' + escapeHtml(panel.id) + '\')" ' +
              'onclick="showMemoryManagerPanel(\'' + escapeHtml(panel.id) + '\')" ' +
              'role="tab" aria-selected="' + (active ? 'true' : 'false') + '" title="' + escapeHtml(panel.description || panel.label) + '">' +
              '<span style="overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(panel.label) + '</span>' +
              (panel.countLabel ? '<span class="memory-manager-bubble-count">' + escapeHtml(panel.countLabel) + '</span>' : '') +
              '</button>';
          });
          tabs += '</div>';

          var panels = '<div class="memory-manager-panel-area">';
          memoryPanels.forEach(function(panel) {
            var active = panel.id === activeId;
            panels += '<section class="memory-manager-panel' + (active ? ' active' : '') + '" data-memory-panel="' + escapeHtml(panel.id) + '" role="tabpanel">' +
              panel.bodyHtml +
              '</section>';
          });
          panels += '</div>';
          return tabs + panels;
        }

        // ========== 直接展示 memory.json 中的完整长期记忆 ==========
        var meta = data._meta || {};
        var hasMemory = meta.hasMemoryContent || (data.memoryEntries && data.memoryEntries.length > 0);
        var memorySourceFile = data.memorySourceFile || ('data/memory/' + currentUserId + '/memory.json');

        var overviewHtml = '<div style="background:rgba(16,163,127,0.1);border:1px solid rgba(16,163,127,0.3);border-radius:8px;padding:12px;margin-bottom:14px;">' +
          '<div style="color:var(--accent-color);font-weight:600;margin-bottom:8px;font-size:13px;">📌 长期记忆文件</div>' +
          '<div style="color:var(--text-secondary);font-size:12px;line-height:1.6;">' +
          '来源：<code style="background:var(--modal-code-bg);padding:2px 5px;border-radius:4px;word-break:break-all;">' + escapeHtml(memorySourceFile) + '</code><br>' +
          (hasMemory ? '<span style="color:var(--success-bg);">✓ 当前有 ' + (meta.totalMemoryEntries || data.memoryEntries.length) + ' 条长期记忆</span>' : '<span style="color:#f59e0b;">○ 暂无长期记忆，请先与 AI 讨论</span>') +
          '<br><span style="color:var(--text-secondary);">已暂停自动刷新，当前为打开时快照 · 加载于 ' + new Date().toLocaleTimeString('zh-CN') + '</span>' +
          '</div>' +
          '</div>';
        addMemoryPanel('overview', '长期记忆文件', String(meta.totalMemoryEntries || (data.memoryEntries || []).length || 0), '长期记忆文件来源、总数和当前快照状态', overviewHtml);

        var memoryDimensions = (data.memoryDimensions && data.memoryDimensions.length)
          ? data.memoryDimensions
          : (data.memoryEntries || []).map(function(entry) {
              entry.exists = true;
              return entry;
            });
        var memoryLabelByKey = {};
        memoryDimensions.forEach(function(dim) {
          memoryLabelByKey[dim.key] = dim.label || dim.key;
        });

        // 旧版本的 deletedKeys 不再作为保护状态展示；AI 始终可以重新提取和更新长期记忆。
        var deletedKeys = [];
        
        // 按长期记忆类型生成顶部气泡对应的内容面板。
        if (memoryDimensions.length > 0) {
          var labels = getProjectUiLabels();
          var fallbackCategories = [
            { id: 'experiment', label: labels.materialSummary + '记忆', description: labels.materialEnabledLabel + '、背景、要求、设计和方法信息' },
            { id: 'data', label: labels.resultSummary + '记忆', description: '数值结果、关键发现、数据状态和核心信息' },
            { id: 'paper', label: getProjectWritingProfile().shortLabel + '设定记忆', description: '项目主题、格式要求、关键词和交付设定' },
            { id: 'writing', label: '写作进度记忆', description: '当前写作阶段、草稿进度、已完成和待完成章节' },
            { id: 'preference', label: '用户偏好记忆', description: '写作偏好、格式偏好和用户长期要求' },
            { id: 'other', label: '其他长期记忆', description: '历史版本或扩展模块写入的其他记忆字段' }
          ];
          var categoryDefinitions = (data.memoryCategories && data.memoryCategories.length) ? data.memoryCategories : fallbackCategories;
          var groupedEntries = {};
          categoryDefinitions.forEach(function(categoryDef) {
            groupedEntries[categoryDef.id] = {
              id: categoryDef.id,
              label: categoryDef.label,
              description: categoryDef.description || '',
              entries: []
            };
          });

          memoryDimensions.forEach(function(entry) {
            var category = entry.category || 'other';
            if (!groupedEntries[category]) {
              groupedEntries[category] = {
                id: category,
                label: entry.categoryLabel || '其他长期记忆',
                description: '',
                entries: []
              };
            }
            groupedEntries[category].entries.push(entry);
          });

          function buildMemoryCategoryHtml(group) {
            if (!group || group.entries.length === 0) return '';
            var existingCount = group.entries.filter(function(entry) { return entry.exists !== false && entry.value; }).length;
            var categoryHtml = '<div class="memory-manager-panel-card">' +
              '<div class="memory-manager-panel-head">' +
              escapeHtml(group.label) + ' <span style="color:var(--text-secondary);font-weight:400;">(' + existingCount + '/' + group.entries.length + ')</span>' +
              '</div>' +
              (group.description ? '<div class="memory-manager-panel-desc">' + escapeHtml(group.description) + '</div>' : '') +
              '<div class="memory-manager-panel-desc">已有内容直接来自长期记忆文件，不做摘要截断；尚未记录的维度会显示为空。</div>' +
              '<div class="memory-manager-panel-body">';

            group.entries.forEach(function(entry) {
              var safeKey = String(entry.key || '');
              var checkboxId = 'mem_' + safeKey.replace(/[^a-zA-Z0-9]/g, '_');
              var isProtected = false;
              var hasEntry = entry.exists !== false && !!(entry.value && String(entry.value).trim());
              var disabled = isProtected || !hasEntry;
              categoryHtml += '<div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:12px;margin-bottom:10px;' + (hasEntry ? (isProtected ? 'opacity:0.6;' : '') : 'opacity:0.72;') + '">' +
                '<label style="display:flex;align-items:flex-start;gap:10px;cursor:' + (disabled ? 'default' : 'pointer') + ';">' +
                '<input type="checkbox" id="' + checkboxId + '" data-memory-key="' + escapeHtml(safeKey) + '" style="margin-top:3px;width:16px;height:16px;cursor:' + (disabled ? 'default' : 'pointer') + ';" ' + (disabled ? 'disabled' : '') + '>' +
                '<div style="flex:1;min-width:0;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:4px;">' +
                '<span style="color:var(--text-primary);font-weight:500;">' + escapeHtml(entry.label || safeKey) + '</span>' +
                (!hasEntry ? '<span style="background:var(--bg-secondary);color:var(--text-secondary);font-size:11px;padding:2px 8px;border-radius:4px;white-space:nowrap;">未记录</span>' : '') +
                '</div>' +
                '<div style="color:var(--text-secondary);font-size:12px;margin-bottom:6px;">key: <code style="background:var(--modal-code-bg);padding:1px 4px;border-radius:3px;">' + escapeHtml(safeKey) + '</code> · ' + escapeHtml(entry.description || '') + '</div>' +
                '<div style="background:var(--bg-input);border-radius:6px;padding:10px;font-size:12px;color:var(--text-primary);line-height:1.6;white-space:pre-wrap;word-break:break-word;">' + 
                  (hasEntry ? escapeHtml(String(entry.value)) : '<span style="color:var(--text-secondary);">尚未记录</span>') + '</div>' +
                '<div style="color:var(--text-secondary);font-size:11px;margin-top:6px;">' +
                  '📄 ' + (entry.wordCount || 0) + ' 字' +
                  (entry.source ? ' · 来源 ' + escapeHtml(entry.source) : '') +
                  (entry.timestamp ? ' · 更新于 ' + new Date(entry.timestamp).toLocaleString('zh-CN') : '') +
                '</div>' +
                '</div>' +
                '</label>' +
                '</div>';
            });

            categoryHtml += '</div></div>';
            return categoryHtml;
          }

          categoryDefinitions.forEach(function(categoryDef) {
            var group = groupedEntries[categoryDef.id];
            if (!group || !group.entries.length) return;
            var existingCount = group.entries.filter(function(entry) { return entry.exists !== false && entry.value; }).length;
            addMemoryPanel(
              categoryDef.id,
              group.label,
              existingCount + '/' + group.entries.length,
              group.description || '长期记忆板块',
              buildMemoryCategoryHtml(group)
            );
          });
        } else {
          addMemoryPanel('empty-memory', '长期记忆维度', '0', '当前暂无长期记忆内容', '<div style="background:var(--bg-secondary);border-radius:8px;padding:20px;text-align:center;color:var(--text-secondary);">' +
            '暂无长期记忆<br><span style="font-size:12px;">与 AI 讨论当前项目内容后，系统会自动提取并写入长期记忆文件</span>' +
            '</div>');
        }

        // 存储维度（草稿、文献、索引等）
        var storageDimensions = Array.isArray(data.storageDimensions) ? data.storageDimensions : [];
        var storageExistingCount = storageDimensions.filter(function(dim) { return !!dim.exists; }).length;
        var storageHtml = '<div class="memory-manager-panel-card">' +
          '<div class="memory-manager-panel-head">💾 存储数据（辅助） <span style="color:var(--text-secondary);font-weight:400;">(' + storageExistingCount + '/' + storageDimensions.length + ')</span></div>' +
          '<div class="memory-manager-panel-desc">这些是物理文件/目录，显示"空"表示尚未创建，不代表记忆丢失。</div>' +
          '<div class="memory-manager-panel-body">';
        if (storageDimensions.length) {
          storageDimensions.forEach(function(dim) {
            var dimCheckboxId = 'dim_' + dim.id;
            var statusBadge = dim.exists
              ? '<span style="color:var(--success-bg);">✓ 存在</span>'
              : '<span style="color:var(--text-secondary);">○ 未创建</span>';
            var sizeInfo = dim.size ? formatBytes(dim.size) : '';
            var countInfo = dim.itemCount ? ' · ' + dim.itemCount + ' 项' : '';

            storageHtml += '<div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:12px;margin-bottom:10px;' + (dim.exists ? '' : 'opacity:0.6;') + '">' +
              '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;' + (dim.exists ? '' : 'pointer-events:none;') + '">' +
              '<input type="checkbox" id="' + escapeHtml(dimCheckboxId) + '" data-dimension="' + escapeHtml(dim.id) + '" style="width:16px;height:16px;cursor:pointer;" ' + (dim.exists ? '' : 'disabled') + '>' +
              '<div style="flex:1;">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
              '<span style="color:var(--text-primary);font-weight:500;">' + escapeHtml(dim.label || dim.id) + '</span>' +
              '<span style="font-size:12px;white-space:nowrap;">' + statusBadge + '</span>' +
              '</div>' +
              '<div style="color:var(--text-secondary);font-size:12px;">' + escapeHtml(dim.description || '') +
              (dim.exists && sizeInfo ? ' · ' + escapeHtml(sizeInfo + countInfo) : '') + '</div>' +
              '</div>' +
              '</label>' +
              '</div>';
          });
        } else {
          storageHtml += '<div style="background:var(--bg-secondary);border-radius:8px;padding:20px;text-align:center;color:var(--text-secondary);">暂无辅助存储数据</div>';
        }
        storageHtml += '</div></div>';
        addMemoryPanel('storage', '存储数据', storageExistingCount + '/' + storageDimensions.length, '草稿、文献、索引等物理文件或目录状态', storageHtml);

        html += renderMemoryTabsAndPanels();
        
        // 删除提示和按钮
        html += '<div style="margin-top:14px;margin-bottom:15px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:12px;">' +
          '<div style="color:var(--danger-color);font-size:13px;">' +
          '⚠️ 删除操作不可恢复，请谨慎选择。建议先导出重要资料。' +
          '</div>' +
          '</div>';
        
        html += '</div><div class="memory-manager-actions">' +
          '<button class="cancel" onclick="closeModal()">取消</button>' +
          '<button class="cancel" onclick="showClearMemoryDialog(false)">刷新快照</button>' +
          '<button id="clearSelectedBtn" class="ok" onclick="clearSelectedMemory()">删除选中项</button>' +
          '</div></div>';
        
        showWorkspaceRequestModal(pageRequestId, '🗑️ 管理长期记忆', html, true);
        clearMemoryLastSignature = memorySignature;
        attachClearMemoryScrollTracking();

        if (silentRefresh) {
          selectedMemoryKeys.forEach(function(key) {
            var cb = document.querySelector('input[data-memory-key="' + key + '"]');
            if (cb && !cb.disabled) cb.checked = true;
          });
          selectedDimensions.forEach(function(dim) {
            var cb = document.querySelector('input[data-dimension="' + dim + '"]');
            if (cb && !cb.disabled) cb.checked = true;
          });
          var newScrollable = document.getElementById('clearMemoryDialogScroll');
          if (newScrollable) newScrollable.scrollTop = previousScrollTop;
        } else {
          startClearMemoryAutoRefresh();
        }
        
      } catch (e) {
        if (!isWorkspacePageRequestCurrent(pageRequestId)) return;
        if (silentRefresh) {
          console.warn('[Memory] Auto refresh failed:', e);
        } else {
          closeModal();
          appendMessage('❌ 加载记忆数据失败：' + e.message, 'bot', false, true);
        }
      } finally {
        if (silentRefresh) {
          clearMemoryRefreshInFlight = false;
        }
      }
    };
    
    /**
     * 执行选择性清空记忆
     */
    window.clearSelectedMemory = async function() {
      // 收集选中的记忆键
      var memoryKeys = [];
      var memoryCheckboxes = document.querySelectorAll('input[data-memory-key]:checked');
      memoryCheckboxes.forEach(function(cb) {
        memoryKeys.push(cb.getAttribute('data-memory-key'));
      });
      
      // 收集选中的存储维度
      var storageDimensions = [];
      var dimCheckboxes = document.querySelectorAll('input[data-dimension]:checked');
      dimCheckboxes.forEach(function(cb) {
        storageDimensions.push(cb.getAttribute('data-dimension'));
      });
      
      if (memoryKeys.length === 0 && storageDimensions.length === 0) {
        alert('请至少选择一项要删除的内容');
        return;
      }
      
      // 确认提示
      var totalSelected = memoryKeys.length + storageDimensions.length;
      var confirmMsg = '确定要删除选中的 ' + totalSelected + ' 项内容吗？\n\n此操作不可恢复。';
      if (!confirm(confirmMsg)) {
        return;
      }
      
      // 显示处理中状态
      var btn = document.getElementById('clearSelectedBtn');
      if (btn) {
        btn.textContent = '删除中...';
        btn.disabled = true;
      }
      
      try {
        var response = await fetch('/api/memory/clear-selected/' + currentUserId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            memoryKeys: memoryKeys,
            storageDimensions: storageDimensions
          })
        });
        
        var result = await response.json();
        
        closeModal();
        
        if (result.success) {
          // 如果删除了文献，清空本地存储
          if (storageDimensions.includes('literature')) {
            localStorage.removeItem(LIT_KEY + currentUserId);
            uploadedFiles = [];
            renderFileList();
          }
          
          // 显示成功消息
          var successMsg = '✅ 已成功清空 ' + result.summary.memoryKeysDeleted + ' 条记忆，' + result.summary.storageCleared + ' 个存储位置。';
          appendMessage(successMsg, 'bot', false, true);
          
        } else {
          appendMessage('❌ 清空失败：' + (result.error || '未知错误'), 'bot', false, true);
        }
      } catch (e) {
        closeModal();
        appendMessage('❌ 清空失败：' + e.message, 'bot', false, true);
      }
    };
    
    /**
     * 清理旧版本 deletedKeys 标记。当前 AI 默认允许自动提取和更新长期记忆。
     */
    window.restoreDeletedKeys = async function() {
      if (!confirm('确定要清理旧版本记忆锁定标记吗？\n\n清理后，AI 会继续自动提取和更新长期记忆。')) {
        return;
      }
      
      try {
        var response = await fetch('/api/memory/restore-keys/' + currentUserId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keys: [
              'experiment_summary_structured',
              'research_method',
              'experimental_design',
              'data_summary_structured',
              'key_findings',
              'important_findings',
              'data_status',
              'writing_progress',
              'draft_progress',
              'paper_topic',
              'research_topic',
              'target_journal',
              'key_concepts',
              'years_mentioned',
              'journals_mentioned',
              'completed_chapters',
              'pending_chapters',
              'user_preferences',
              'writing_style',
              'citation_preferences'
            ]
          })
        });
        
        var result = await response.json();
        
        if (result.success) {
          var labels = getProjectUiLabels();
          var profile = getProjectWritingProfile();
          var restoredLabels = {
            'experiment_summary_structured': labels.materialSummary + '（结构化）',
            'research_method': isAcademicPaperWritingProfile(profile.id) ? '研究方法' : '方法/方案',
            'experimental_design': isAcademicPaperWritingProfile(profile.id) ? '实验设计' : '方案设计',
            'data_summary_structured': labels.resultSummary + '（结构化）',
            'key_findings': isAcademicPaperWritingProfile(profile.id) ? '关键发现' : '关键要点',
            'important_findings': isAcademicPaperWritingProfile(profile.id) ? '重要发现' : '重要要点',
            'data_status': isAcademicPaperWritingProfile(profile.id) ? '数据状态' : '资料状态',
            'writing_progress': '写作进度',
            'draft_progress': labels.draft + '进度',
            'paper_topic': profile.topicLabel,
            'research_topic': profile.topicLabel,
            'target_journal': labels.styleGroup,
            'key_concepts': '关键概念',
            'years_mentioned': '涉及年份',
            'journals_mentioned': '提到的样例/来源',
            'completed_chapters': '已完成章节',
            'pending_chapters': '待完成章节',
            'user_preferences': '用户偏好',
            'writing_style': '写作风格偏好',
            'citation_preferences': '引用偏好'
          };
          var restoredNames = result.restoredKeys.map(function(k) { return restoredLabels[k] || k; }).join('、');
          
          closeModal();
          appendMessage('✅ 已清理 ' + result.restoredKeys.length + ' 个旧版本记忆锁定标记：' + restoredNames + '\n\nAI 会继续自动提取并更新长期记忆。', 'bot', false, true);
        } else {
          appendMessage('❌ 清理标记失败：' + (result.error || '未知错误'), 'bot', false, true);
        }
      } catch (e) {
        appendMessage('❌ 清理标记失败：' + e.message, 'bot', false, true);
      }
    };
    
    /**
     * 执行清空长期记忆操作（保留用于全量清空）
     */
    window.confirmClearMemory = async function() {
      var input = document.getElementById('confirmClearInput');
      if (!input || input.value !== '清空记忆') {
        alert('请输入正确的确认文字');
        return;
      }
      
      // 显示处理中状态
      var btn = document.getElementById('confirmClearBtn');
      if (btn) {
        btn.textContent = '清空中...';
        btn.disabled = true;
      }
      
      try {
        var response = await fetch('/api/memory/clear/' + currentUserId, {
          method: 'DELETE'
        });
        
        var result = await response.json();
        
        closeModal();
        
        if (result.success) {
          var labels = getProjectUiLabels();
          // 清空本地存储的历史记录
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(LIT_KEY + currentUserId);
          
          // 重新渲染历史列表
          renderHistory();
          
          // 显示成功消息
          appendMessage('✅ 长期记忆已清空！\n\n' +
            '已清空 ' + (result.summary?.deleted || 0) + ' 个存储位置。\n\n' +
            '系统已重置，您可以开始新的' + labels.projectWork + '。', 'bot', false, true);
            
          // 清空消息区域
          resetMainChatPiQueueHost();
          messagesDiv.innerHTML = '';
          emptyState.style.display = 'flex';
          emptyState.innerHTML = BRAND_TITLE_HTML + '<p>记忆已清空，准备开始新的' + labels.projectWork + '。</p><p style="margin-top:12px;">发送消息开始对话</p>' + HOME_WORKFLOW_SHORTCUTS_HTML;
          
          // 重置上传文件列表
          uploadedFiles = [];
          renderFileList();
          
        } else {
          appendMessage('❌ 清空失败：' + (result.error || '未知错误'), 'bot', false, true);
        }
      } catch (e) {
        closeModal();
        appendMessage('❌ 清空失败：' + e.message, 'bot', false, true);
      }
    };
    
    /**
     * 格式化字节数
     */

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('memory-management', { source: '/app/memory-management.js' });
}
