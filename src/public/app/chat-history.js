async function showProjectManagerDialog() {
      showModal('项目管理', '<div style="padding:20px;color:var(--text-secondary);">正在加载项目...</div>', true, false);

      try {
        var response = await fetch('/api/projects');
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '加载项目失败');
        }

        var projects = result.projects || [];
        projectManagerCurrentProject = result.currentProject || null;
        applyProjectWritingProfileUi(getCurrentProjectProfileId());
        var currentProjectId = projectManagerCurrentProject && projectManagerCurrentProject.isArchivedProject
          ? projectManagerCurrentProject.projectId
          : '';
        var html = '<div style="display:flex;flex-direction:column;gap:10px;max-height:520px;overflow:auto;">';
        if (projects.length === 0) {
          html += '<div style="padding:16px;color:var(--text-secondary);background:var(--bg-secondary);border-radius:8px;">暂无已归档项目。</div>';
        } else {
          projects.forEach(function(project) {
            var isCurrentProject = currentProjectId && project.projectId === currentProjectId;
            html += '<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);">' +
              '<div style="min-width:0;flex:1;">' +
                '<div style="display:flex;align-items:center;gap:8px;min-width:0;">' +
                  '<div style="font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(project.name || project.projectId) + '</div>' +
                  (isCurrentProject ? '<span style="flex:0 0 auto;font-size:11px;line-height:1;padding:4px 6px;border-radius:999px;background:var(--accent-color);color:#fff;">当前项目</span>' : '') +
                  '<span style="flex:0 0 auto;font-size:11px;line-height:1;padding:4px 6px;border-radius:999px;background:var(--bg-tertiary);color:var(--text-secondary);border:1px solid var(--border-color);">' + escapeHtml(project.writingProfileLabel || getProjectWritingProfile(project.writingProfileId).label) + '</span>' +
                '</div>' +
                '<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">' + escapeHtml(formatProjectDate(project.archivedAt)) + '</div>' +
                '<div style="font-size:11px;color:var(--text-secondary);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(project.projectId) + '</div>' +
              '</div>' +
              '<div style="display:flex;gap:6px;flex:0 0 auto;">' +
                '<button class="ok" style="padding:8px 12px;" data-project-id="' + escapeHtml(project.projectId) + '" data-project-name="' + escapeHtml(project.name || project.projectId) + '" onclick="showOpenProjectNameDialog(this.dataset.projectId, this.dataset.projectName)" ' + (isCurrentProject ? 'disabled title="当前已打开该项目"' : '') + '>' + (isCurrentProject ? '已打开' : '打开') + '</button>' +
                '<button class="cancel" style="padding:8px 12px;" data-project-id="' + escapeHtml(project.projectId) + '" data-project-name="' + escapeHtml(project.name || project.projectId) + '" onclick="showCloneProjectDialog(this.dataset.projectId, this.dataset.projectName)">复制</button>' +
                '<button class="cancel" style="padding:8px 12px;" data-project-id="' + escapeHtml(project.projectId) + '" data-project-name="' + escapeHtml(project.name || project.projectId) + '" onclick="showRenameProjectDialog(this.dataset.projectId, this.dataset.projectName)">重命名</button>' +
                '<button class="cancel" style="padding:8px 12px;color:var(--danger-color);border-color:var(--danger-color);" data-project-id="' + escapeHtml(project.projectId) + '" data-project-name="' + escapeHtml(project.name || project.projectId) + '" onclick="deleteArchivedProject(this.dataset.projectId, this.dataset.projectName)" ' + (isCurrentProject ? 'disabled title="当前项目不能删除"' : '') + '>' + (isCurrentProject ? '使用中' : '删除') + '</button>' +
              '</div>' +
            '</div>';
          });
        }
        html += '</div><div class="btns"><button class="cancel" onclick="closeModal()">关闭</button></div>';
        showModal('项目管理', html, true, false);
      } catch (e) {
        showModal('项目管理', '<div style="color:var(--danger-color);padding:12px;">加载失败：' + escapeHtml(e.message) + '</div><div class="btns"><button class="cancel" onclick="closeModal()">关闭</button></div>', true, false);
      }
    }

    async function showOpenProjectNameDialog(projectId, projectName) {
      if (!projectManagerCurrentProject) {
        showModal('项目管理', '<div style="padding:20px;color:var(--text-secondary);">正在识别当前项目...</div>', true, false);
        await fetchCurrentProjectInfo();
      }

      var currentProject = projectManagerCurrentProject;
      if (currentProject && currentProject.isArchivedProject && currentProject.projectId) {
        if (currentProject.projectId === projectId) {
          showModal(
            '当前项目',
            '<div style="line-height:1.7;color:var(--text-primary);">' +
              '<p>当前已经打开项目“' + escapeHtml(projectName || currentProject.name || projectId) + '”。</p>' +
            '</div>' +
            '<div class="btns"><button class="ok" onclick="showProjectManagerDialog()">返回项目管理</button></div>',
            true,
            false
          );
          return;
        }

        showModal(
          '打开项目',
          '<div style="line-height:1.7;color:var(--text-primary);">' +
            '<p>当前项目已识别为“' + escapeHtml(currentProject.name || currentProject.projectId) + '”。</p>' +
            '<p style="margin-top:8px;color:var(--text-secondary);">打开“' + escapeHtml(projectName) + '”前，会先把当前工作区保存回原项目，不需要重新命名。</p>' +
          '</div>' +
          '<div class="btns">' +
            '<button class="cancel" onclick="showProjectManagerDialog()">取消</button>' +
            '<button class="ok" id="openProjectConfirmBtn" data-project-id="' + escapeHtml(projectId) + '" onclick="confirmOpenArchivedProject(this.dataset.projectId)">保存当前项目并打开</button>' +
          '</div>',
          true,
          false
        );
        return;
      }

      var defaultName = '当前项目 ' + new Date().toLocaleString();
      showModal(
        '命名当前项目',
        '<div style="line-height:1.7;color:var(--text-primary);">' +
          '<p>打开“' + escapeHtml(projectName) + '”前，需要先把当前工作区归档保存。</p>' +
          '<p style="margin-top:8px;color:var(--text-secondary);">请给当前项目命名，便于之后在项目管理中找回。</p>' +
          '<input id="currentProjectBackupName" value="' + escapeHtml(defaultName) + '" style="width:100%;margin-top:14px;padding:10px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);border-radius:6px;color:var(--text-primary);">' +
        '</div>' +
        '<div class="btns">' +
          '<button class="cancel" onclick="showProjectManagerDialog()">取消</button>' +
          '<button class="cancel" style="color:var(--danger-color);border-color:var(--danger-color);" id="openProjectDiscardBtn" data-project-id="' + escapeHtml(projectId) + '" onclick="confirmOpenArchivedProject(this.dataset.projectId, true)">不保存当前项目，直接打开</button>' +
          '<button class="ok" id="openProjectConfirmBtn" data-project-id="' + escapeHtml(projectId) + '" onclick="confirmOpenArchivedProject(this.dataset.projectId)">保存当前项目并打开</button>' +
        '</div>'
      );
      setTimeout(function() {
        var input = document.getElementById('currentProjectBackupName');
        if (input) {
          input.focus();
          input.select();
        }
      }, 0);
    }

    async function confirmOpenArchivedProject(projectId, skipBackup) {
      var input = document.getElementById('currentProjectBackupName');
      var currentProjectName = input ? input.value.trim() : '';
      var hasKnownCurrentProject = projectManagerCurrentProject && projectManagerCurrentProject.isArchivedProject && projectManagerCurrentProject.projectId;
      if (!skipBackup && !currentProjectName && !hasKnownCurrentProject) {
        alert('请先填写当前项目名称');
        return;
      }

      if (skipBackup && !confirm('确定不保存当前项目，直接打开所选项目吗？\n\n当前工作区未归档的内容会被丢弃。')) {
        return;
      }

      var btn = document.getElementById(skipBackup ? 'openProjectDiscardBtn' : 'openProjectConfirmBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '打开中...';
      }

      try {
        var response = await fetch('/api/projects/' + encodeURIComponent(projectId) + '/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            name: currentProjectName,
            skipBackup: skipBackup === true,
            clientState: collectProjectClientState()
          })
        });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '打开项目失败');
        }

        projectManagerCurrentProject = result.currentProject || null;
        applyProjectWritingProfileUi(getCurrentProjectProfileId());
        renderMainContextSourceBar();
        applyProjectClientState(result.clientState);
        closeModal();
        appendMessage(
          result.savedCurrentProjectId
            ? '✅ 已打开项目：' + result.projectId + '\n当前项目已保存回：' + (result.savedCurrentProjectName || result.savedCurrentProjectId)
            : result.backupProjectId
            ? '✅ 已打开项目：' + result.projectId + '\n当前工作区已自动备份为：' + result.backupProjectId
            : '✅ 已打开项目：' + result.projectId + '\n当前工作区未保存，已直接切换。',
          'bot',
          false,
          true
        );
      } catch (e) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = skipBackup ? '不保存当前项目，直接打开' : '保存当前项目并打开';
        }
        appendMessage('❌ 打开项目失败：' + e.message, 'bot', false, true);
      }
    }

    function showCloneProjectDialog(projectId, projectName) {
      var defaultName = (projectName || projectId || '项目') + ' 副本';
      showModal(
        '复制项目',
        '<div style="line-height:1.7;color:var(--text-primary);">' +
          '<p>复制“' + escapeHtml(projectName || projectId) + '”为一个独立项目，适合同一主题拆成两篇文章分别推进。</p>' +
          '<p style="margin-top:8px;color:var(--text-secondary);">复制会保留该项目的上传文件、长期记忆、草稿、Auto Research、PDF Wiki、R 作图结果等项目资料；后续修改副本不会影响原项目。</p>' +
          '<input id="cloneProjectName" value="' + escapeHtml(defaultName) + '" style="width:100%;margin-top:14px;padding:10px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);border-radius:6px;color:var(--text-primary);">' +
        '</div>' +
        '<div class="btns">' +
          '<button class="cancel" onclick="showProjectManagerDialog()">取消</button>' +
          '<button class="ok" id="cloneProjectConfirmBtn" data-project-id="' + escapeHtml(projectId) + '" onclick="confirmCloneProject(this.dataset.projectId)">复制项目</button>' +
        '</div>',
        true,
        false
      );
      setTimeout(function() {
        var input = document.getElementById('cloneProjectName');
        if (input) {
          input.focus();
          input.select();
        }
      }, 0);
    }

    async function confirmCloneProject(projectId) {
      var input = document.getElementById('cloneProjectName');
      var newName = input ? input.value.trim() : '';
      if (!newName) {
        alert('请填写副本项目名称');
        return;
      }

      var btn = document.getElementById('cloneProjectConfirmBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '复制中...';
      }

      try {
        var response = await fetch('/api/projects/' + encodeURIComponent(projectId) + '/clone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            name: newName,
            clientState: collectProjectClientState()
          })
        });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '复制项目失败');
        }
        projectManagerCurrentProject = result.currentProject || projectManagerCurrentProject;
        var clonedProject = result.project || {};
        showModal(
          '复制完成',
          '<div style="line-height:1.7;color:var(--text-primary);">' +
            '<p>已创建项目副本：“' + escapeHtml(clonedProject.name || newName) + '”。</p>' +
            '<p style="margin-top:8px;color:var(--text-secondary);">原项目和副本现在是两个独立项目，可分别写不同文章。</p>' +
          '</div>' +
          '<div class="btns">' +
            '<button class="cancel" onclick="showProjectManagerDialog()">留在项目管理</button>' +
            '<button class="ok" data-project-id="' + escapeHtml(clonedProject.projectId || '') + '" data-project-name="' + escapeHtml(clonedProject.name || newName) + '" onclick="showOpenProjectNameDialog(this.dataset.projectId, this.dataset.projectName)">打开副本</button>' +
          '</div>',
          true,
          false
        );
      } catch (e) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '复制项目';
        }
        appendMessage('❌ 复制项目失败：' + e.message, 'bot', false, true);
      }
    }

    function showRenameProjectDialog(projectId, currentName) {
      showModal(
        '重命名项目',
        '<div style="line-height:1.7;color:var(--text-primary);">' +
          '<p>修改项目在项目管理列表中的显示名称。</p>' +
          '<input id="renameProjectName" value="' + escapeHtml(currentName || '') + '" style="width:100%;margin-top:14px;padding:10px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);border-radius:6px;color:var(--text-primary);">' +
        '</div>' +
        '<div class="btns">' +
          '<button class="cancel" onclick="showProjectManagerDialog()">取消</button>' +
          '<button class="ok" id="renameProjectConfirmBtn" data-project-id="' + escapeHtml(projectId) + '" onclick="confirmRenameProject(this.dataset.projectId)">保存</button>' +
        '</div>'
      );
      setTimeout(function() {
        var input = document.getElementById('renameProjectName');
        if (input) {
          input.focus();
          input.select();
        }
      }, 0);
    }

    async function confirmRenameProject(projectId) {
      var input = document.getElementById('renameProjectName');
      var newName = input ? input.value.trim() : '';
      if (!newName) {
        alert('项目名称不能为空');
        return;
      }

      var btn = document.getElementById('renameProjectConfirmBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '保存中...';
      }

      try {
        var response = await fetch('/api/projects/' + encodeURIComponent(projectId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName })
        });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '重命名失败');
        }
        await showProjectManagerDialog();
      } catch (e) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '保存';
        }
        appendMessage('❌ 重命名项目失败：' + e.message, 'bot', false, true);
      }
    }

    async function deleteArchivedProject(projectId, projectName) {
      if (!confirm('确定删除项目“' + projectName + '”？\n\n该操作会删除归档文件夹，不能撤销。')) {
        return;
      }

      try {
        var response = await fetch('/api/projects/' + encodeURIComponent(projectId), {
          method: 'DELETE'
        });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '删除失败');
        }
        await showProjectManagerDialog();
      } catch (e) {
        appendMessage('❌ 删除项目失败：' + e.message, 'bot', false, true);
      }
    }

    function addToHistory(userId, firstMessage) {
      console.log('[AddToHistory] 添加历史记录 - userId:', userId, 'message:', firstMessage);
      var history = getHistory();
      console.log('[AddToHistory] 当前历史记录数量:', history.length);
      var title = generateHistoryTitle(firstMessage);
      console.log('[AddToHistory] 标题:', title);
      history.unshift({ id: userId, title: title });
      saveHistory(history);
      console.log('[AddToHistory] 保存后的历史记录数量:', history.length);
      renderHistory();
      
      generateAITitle(userId, firstMessage);
    }
    
    function generateAITitle(convId, userMessage) {
      if (!apiConfig.url || !apiConfig.key) {
        console.log('[AITitle] API未配置，跳过AI标题生成');
        return;
      }
      
      var prompt = '请用5-10个字总结用户的诉求，只返回总结内容，不要加任何其他内容。用户消息：' + (userMessage || '新对话');
      
      fetch(apiConfig.url + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiConfig.key
        },
        body: JSON.stringify({
          model: currentModel,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 32000,
          temperature: 0.3
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.choices && data.choices[0] && data.choices[0].message) {
          var aiSummary = data.choices[0].message.content.trim().replace(/["'""''\n]/g, '').slice(0, 15);
          var now = new Date();
          var datePrefix = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0') + '/' + String(now.getDate()).padStart(2, '0');
          var newTitle = datePrefix + '-' + aiSummary;
          
          var history = getHistory();
          var idx = history.findIndex(function(h) { return h.id === convId; });
          if (idx >= 0) {
            history[idx].title = newTitle;
            saveHistory(history);
            renderHistory();
            console.log('[AITitle] 标题已更新:', newTitle);
          }
        }
      })
      .catch(function(e) {
        console.warn('[AITitle] 生成失败:', e);
      });
    }
    
    function deleteHistoryItem(convId) {
      fetch(getMainChatPiSessionUrl(convId) + '?userId=' + encodeURIComponent(currentUserId || 'web-user'), {
        method: 'DELETE'
      }).catch(function(error) {
        console.warn('[PiSession] Failed to delete queued session with conversation:', convId, error);
      });
      var history = getHistory();
      history = history.filter(function(h) { return h.id !== convId; });
      saveHistory(history);
      rememberDeletedConversationHistoryId(convId);
      localStorage.removeItem(MSG_KEY + currentUserId + '_' + convId);
      unregisterPdfPaperConversation(convId);
      if (convId === currentConversationId) {
        newChat();
      }
      deleteWorkspaceDirectorySetting(convId);
      renderHistory();
    }
    window.deleteHistoryItem = deleteHistoryItem;
    
    function renderHistory() {
      var history = getHistory().filter(function(item) {
        return item && !isBibliometricsConversationId(item.id);
      });

      console.log('[RenderHistory] History count:', history.length);
      console.log('[RenderHistory] History items:', history.map(function(h) { return { id: h.id, title: h.title }; }));
      historyList.innerHTML = '';
      for (var i = 0; i < history.length; i++) {
        var h = history[i];
        var pdfConversationContext = loadPdfPaperChatContextForConversation(h.id);
        var historyDisplayTitle = pdfConversationContext
          ? '论文 · ' + (pdfConversationContext.title || pdfConversationContext.originalName || h.title)
          : h.title;
        var div = document.createElement('div');
        div.className = 'history-item' + (h.id === currentConversationId ? ' active' : '');
        div.innerHTML = '<span class="history-item-title" title="' + escapeHtml(h.title || historyDisplayTitle) + '" onclick="loadConversation(\'' + h.id + '\')">' + escapeHtml(historyDisplayTitle) + '</span><span class="delete" onclick="event.stopPropagation(); deleteHistoryItem(\'' + h.id + '\')">' + uiIcon('x', 'sm') + '</span>';
        historyList.appendChild(div);
      }
    }

    function isLocalOutputAttachmentPathForAuthorization(filePath) {
      var value = String(filePath || '').trim();
      if (!value) return false;
      if (/^https?:\/\//i.test(value) || value.indexOf('/api/') === 0) return false;
      return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value) || /^\//.test(value);
    }

    function collectPreviewAuthorizationPathsFromMessages(messages) {
      var seen = new Set();
      var roots = [];
      function addPath(value) {
        var text = String(value || '').trim();
        if (!text || seen.has(text)) return;
        seen.add(text);
        roots.push(text);
      }
      var setting = loadWorkspaceDirectorySetting ? loadWorkspaceDirectorySetting() : null;
      if (setting && setting.enabled && setting.path) addPath(setting.path);
      if (setting && setting.enabled) {
        addPath(getConversationScopedAiWorkRoot(setting, currentConversationId));
      }
      if (setting && setting.enabled && setting.aiWorkRoot) addPath(setting.aiWorkRoot);
      (messages || []).forEach(function(message) {
        var content = String((message && message.content) || '');
        getWorkspaceRootsForOutputAttachments(content).forEach(addPath);
        collectOutputAttachmentPaths(content).forEach(function(filePath) {
          if (!isLocalOutputAttachmentPathForAuthorization(filePath)) return;
          addPath(filePath);
        });
      });
      return roots.slice(0, 40);
    }

    async function restorePreviewAuthorizationForMessages(messages) {
      var roots = collectPreviewAuthorizationPathsFromMessages(messages);
      if (!roots.length) return;
      await Promise.all(roots.map(function(root) {
        var controller = new AbortController();
        var timeoutId = setTimeout(function() {
          try { controller.abort(); } catch (e) {}
        }, 5000);
        return fetch('/api/chat-bridge/workspace/authorize-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true, path: root, permission: 'read-only' }),
          signal: controller.signal
        }).catch(function(error) {
          if (!error || error.name !== 'AbortError') {
            console.warn('[LocalPreview] Failed to restore preview authorization:', root, error);
          }
        }).finally(function() {
          clearTimeout(timeoutId);
        });
      }));
    }

    var conversationLoadSequence = 0;
    var conversationLoadController = null;

    function readConversationMessagesFromStorageKey(storageKey, conversationId) {
      try {
        var messages = JSON.parse(localStorage.getItem(storageKey) || '[]');
        return Array.isArray(messages) ? messages : [];
      } catch (error) {
        console.warn('[ConversationPersistence] 历史消息本地副本损坏，改从服务端恢复:', conversationId, error);
        return [];
      }
    }

    function getConversationRestoreUserIds() {
      var userIds = [String(currentUserId || 'web-user')];
      if (userIds[0] !== 'web-user') userIds.push('web-user');
      return userIds;
    }

    async function fetchPersistedConversationMessages(convId, signal) {
      var userIds = getConversationRestoreUserIds();
      for (var i = 0; i < userIds.length; i++) {
        var restoreUserId = userIds[i];
        var response = await fetch(
          '/api/memory/conversation/' + encodeURIComponent(restoreUserId) + '/' + encodeURIComponent(convId),
          { signal: signal }
        );
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok) {
          throw new Error(result.error || ('HTTP ' + response.status));
        }
        if (result.success && Array.isArray(result.messages) && result.messages.length > 0) {
          return {
            messages: result.messages,
            restoredFromUserId: restoreUserId
          };
        }
      }
      return { messages: [], restoredFromUserId: '' };
    }

    async function renderConversationMessagesAtomically(messages, requestId) {
      if (requestId !== conversationLoadSequence) return false;
      var fragment = document.createDocumentFragment();
      var renderedElements = [];
      for (var i = 0; i < messages.length; i++) {
        if (requestId !== conversationLoadSequence) return false;
        var message = messages[i] || {};
        if (!(message.piQueueId && (message.piStatus === 'queued' || message.piStatus === 'processing'))) {
          var normalizedRole = message.role === 'user' ? 'user' : 'bot';
          var element = createSharedChatMessageElement(
            message.content,
            normalizedRole,
            message.isHtml,
            message.isSystemMessage
          );
          if (normalizedRole === 'user') {
            element.setAttribute('data-query-nav-text', normalizeQueryNavText(message.content));
            queryNavPinnedMessageId = ensureQueryNavMessageId(element);
          }
          fragment.appendChild(element);
          renderedElements.push(element);
        }
      }
      if (requestId !== conversationLoadSequence) return false;
      messagesDiv.appendChild(fragment);
      emptyState.style.display = 'none';
      ensureChatMessageLayoutGuard();
      renderedElements.forEach(function(element) {
        scheduleChatMessageLayoutRepair(element);
        initWorkspaceImageStacks(element);
      });
      scheduleQueryNavRender();
      maybeScrollChatToBottom(true);
      return requestId === conversationLoadSequence;
    }

    async function loadConversation(convId) {
      var requestId = ++conversationLoadSequence;
      if (conversationLoadController) {
        try { conversationLoadController.abort(); } catch (e) {}
      }
      if (literatureLoadController) {
        try { literatureLoadController.abort(); } catch (e) {}
        literatureLoadController = null;
        literatureLoadSequence += 1;
      }
      var loadController = new AbortController();
      conversationLoadController = loadController;
      var loadTimeoutId = setTimeout(function() {
        try { loadController.abort(); } catch (e) {}
      }, 15000);

      clearChatTurnScrollLock();
      clearRightSidebarFilePreviewState();
      stopActiveMainChatForNavigation();
      currentConversationId = convId;
      setActivePdfPaperChatContext(loadPdfPaperChatContextForConversation(convId), { skipRender: true });
      setPdfPaperChatReturnContext(loadPdfPaperChatReturnContextForConversation(convId), { skipRender: true });
      mainMetaAnalysisReturnContext = loadMainMetaAnalysisReturnContext(convId);
      mainAnalysisWorkflowReturnContext = loadMainAnalysisWorkflowReturnContext(convId);
      activateWorkspaceDirectoryConversation(convId);
      mainChatQueryQueue = [];
      mainChatPiState = null;
      if (typeof resetMainChatAttachedRunState === 'function') {
        resetMainChatAttachedRunState();
      }
      resetMainChatPiQueueHost();
      messagesDiv.innerHTML = '';
      emptyState.innerHTML = '<h1>历史对话</h1><p>正在恢复消息...</p>';
      emptyState.style.display = 'flex';

      var messages = readConversationMessagesFromStorageKey(
        MSG_KEY + currentUserId + '_' + convId,
        convId
      );
      var restoredFromUserId = '';

      if (messages.length === 0 && String(currentUserId || 'web-user') !== 'web-user') {
        messages = readConversationMessagesFromStorageKey(MSG_KEY + 'web-user_' + convId, convId);
        if (messages.length > 0) restoredFromUserId = 'web-user';
      }

      if (messages.length === 0) {
        try {
          var restored = await fetchPersistedConversationMessages(convId, loadController.signal);
          messages = restored.messages;
          restoredFromUserId = restored.restoredFromUserId;
        } catch (error) {
          if (!error || error.name !== 'AbortError') {
            console.warn('[ConversationPersistence] 服务端会话内容恢复失败:', convId, error);
          }
        }
      }

      clearTimeout(loadTimeoutId);
      if (conversationLoadController === loadController) conversationLoadController = null;
      if (requestId !== conversationLoadSequence) return;

      if (messages.length > 0) {
        storeConversationMessagesLocally(convId, messages, {
          skipAiTitle: true,
          skipServerPersistence: restoredFromUserId !== 'web-user'
        });
        var rendered = await renderConversationMessagesAtomically(messages, requestId);
        if (!rendered) return;
        setTimeout(function() {
          if (requestId !== conversationLoadSequence) return;
          restorePreviewAuthorizationForMessages(messages).catch(function(error) {
            console.warn('[LocalPreview] Failed to restore historical preview authorization:', error);
          });
        }, 0);
      } else {
        emptyState.innerHTML = '<h1>历史对话</h1><p>暂无消息记录</p><p style="margin-top:12px;">请发送消息开始对话</p>';
        emptyState.style.display = 'flex';
      }
      
      // 文献库跨会话共享
      uploadedFiles = getLitStorage(currentUserId);
      renderFileList();
      loadLiteratureFromServer({ preserveChatState: true });
      renderHistory();
      renderMainContextSourceBar();
      renderPdfPaperChatReturnBar();
      mainMetaAnalysisReturnContext = loadMainMetaAnalysisReturnContext(currentConversationId);
      renderMainMetaAnalysisReturnBar();
      mainAnalysisWorkflowReturnContext = loadMainAnalysisWorkflowReturnContext(currentConversationId);
      renderMainAnalysisWorkflowReturnBar();
      await syncMainSelectedAnalysisInputPlaceholder(
        mainAnalysisWorkflowReturnContext
          ? mainAnalysisWorkflowReturnContext.sourceId
          : (mainMetaAnalysisReturnContext ? 'metaAnalysis' : '')
      );
      await syncMainChatPiQueueState({ claimWhenIdle: true });
    }
    window.loadConversation = loadConversation;
    
    var AI_WRITING_DISCLAIMER = 'AI 辅助写作内容仅供参考，请勿将 AI 输出未经核验和修改后直接用于发表。';

    function renderAiDisclaimer() {
      return '<div class="ai-disclaimer">' + escapeHtml(AI_WRITING_DISCLAIMER) + '</div>';
    }

    function renderMessageActionsHtml() {
      return `
        <div class="msg-actions">
          <button onclick="copyMessage(this)" title="复制" style="padding:0;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;color:var(--theme-ink);">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
          <button onclick="shareMessage(this)" title="分享" style="padding:0;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;color:var(--theme-ink);">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
          </button>
          <button onclick="generateKeywordsFromMessage(this)" title="生成检索词" style="padding:0;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;color:var(--theme-ink);">
            <svg class="gear-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>
          <button onclick="saveMessageToDraft(this)" title="保存到草稿" style="padding:0;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;color:var(--theme-ink);">
            <svg class="save-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
              <polyline points="17 21 17 13 7 13 7 21"></polyline>
              <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
          </button>
        </div>
      `;
    }

    function renderUserMessageFooter() {
      return '<div class="message-footer user-message-footer">' +
        '<button type="button" class="user-message-copy-btn" onclick="copyMessage(this)" title="复制消息" aria-label="复制消息">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<rect x="9" y="9" width="11" height="11" rx="2"></rect>' +
            '<path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"></path>' +
          '</svg>' +
        '</button>' +
      '</div>';
    }

    function renderMessageFooter(showActions) {
      return '<div class="message-footer">' +
        (showActions ? renderMessageActionsHtml() : '<div class="msg-actions msg-actions-empty" aria-hidden="true"></div>') +
        renderAiDisclaimer() +
      '</div>';
    }

    function removeMessageChrome(clone) {
      var footer = clone.querySelector('.message-footer');
      if (footer) {
        footer.remove();
        return;
      }
      var actions = clone.querySelector('.msg-actions');
      if (actions) actions.remove();
      var disclaimer = clone.querySelector('.ai-disclaimer');
      if (disclaimer) disclaimer.remove();
    }

    function getCleanMessageText(contentDiv) {
      var clone = contentDiv.cloneNode(true);
      removeMessageChrome(clone);
      return clone.textContent || clone.innerText || '';
    }

    function getRetrievalMessageText(contentDiv) {
      if (!contentDiv) return '';

      // Codex/OpenCode transcripts place the useful answer after a potentially
      // long tool log. Sending the whole DOM and then truncating it caused the
      // detector to see only shell events and reject otherwise useful content.
      var finalAnswer = contentDiv.querySelector('.agent-transcript-answer');
      if (finalAnswer) {
        var answerText = finalAnswer.textContent || finalAnswer.innerText || '';
        if (answerText.trim()) return answerText.trim();
      }

      return getCleanMessageText(contentDiv).trim();
    }

    var CHAT_AVATAR_BUILTIN_COUNT = 120;

    function normalizeChatAvatarRole(role) {
      return role === 'user' ? 'user' : 'bot';
    }

    function getChatAvatarUserId() {
      try {
        return localStorage.getItem(USER_ID_KEY) || 'web-user';
      } catch (e) {
        return 'web-user';
      }
    }

    function getChatAvatarStorageKey(role) {
      return 'scholarharness_chat_avatar_' + getChatAvatarUserId() + '_' + normalizeChatAvatarRole(role);
    }

    function getDefaultChatAvatarSource(role) {
      return normalizeChatAvatarRole(role) === 'bot' ? '/bot.jpg' : '/user.jpg';
    }

    function getSelectedChatAvatarSource(role) {
      var normalizedRole = normalizeChatAvatarRole(role);
      try {
        return localStorage.getItem(getChatAvatarStorageKey(normalizedRole)) || getDefaultChatAvatarSource(normalizedRole);
      } catch (e) {
        return getDefaultChatAvatarSource(normalizedRole);
      }
    }

    function clearSelectedChatAvatar(role) {
      var normalizedRole = normalizeChatAvatarRole(role);
      try {
        localStorage.removeItem(getChatAvatarStorageKey(normalizedRole));
      } catch (e) {}
      refreshChatAvatarImages(normalizedRole);
      if (rightSidebarAvatarPickerState) {
        rightSidebarAvatarPickerState.role = normalizedRole;
        rightSidebarAvatarPickerState.status = '已恢复默认头像。';
        rightSidebarAvatarPickerState.error = false;
      }
      syncChatAvatarPickerSelection(normalizedRole);
    }

    function setSelectedChatAvatarSource(role, source) {
      var normalizedRole = normalizeChatAvatarRole(role);
      var safeSource = String(source || '').trim();
      if (!safeSource || (!safeSource.startsWith('/') && !safeSource.startsWith('data:image/'))) return;
      try {
        localStorage.setItem(getChatAvatarStorageKey(normalizedRole), safeSource);
      } catch (e) {}
      refreshChatAvatarImages(normalizedRole);
      if (rightSidebarAvatarPickerState) {
        rightSidebarAvatarPickerState.role = normalizedRole;
        rightSidebarAvatarPickerState.status = '头像已更新，当前消息和历史对话已同步。';
        rightSidebarAvatarPickerState.error = false;
      }
      syncChatAvatarPickerSelection(normalizedRole);
    }
    window.setSelectedChatAvatarSource = setSelectedChatAvatarSource;

    function handleMessageAvatarError(img, role) {
      var normalizedRole = normalizeChatAvatarRole(role);
      var avatarEl = img && img.parentElement;
      if (!avatarEl) return;
      var fallbackSource = getDefaultChatAvatarSource(normalizedRole);
      var failedSource = String(img.getAttribute('src') || '');
      if (failedSource !== fallbackSource && img.dataset.avatarFallbackAttempted !== 'true') {
        img.dataset.avatarFallbackAttempted = 'true';
        try {
          if (getSelectedChatAvatarSource(normalizedRole) === failedSource) {
            localStorage.removeItem(getChatAvatarStorageKey(normalizedRole));
          }
        } catch (e) {}
        img.src = fallbackSource;
        return;
      }
      avatarEl.innerHTML = normalizedRole === 'bot' ? uiIcon('messageCircle') : uiIcon('user');
    }

    function getMessageAvatarHtml(role) {
      var normalizedRole = normalizeChatAvatarRole(role);
      var source = getSelectedChatAvatarSource(normalizedRole);
      var alt = normalizedRole === 'bot' ? 'Scholar Harness' : 'User';
      return '<img data-chat-avatar-role="' + normalizedRole + '" src="' + escapeHtml(source) + '" alt="' + alt + '" loading="eager" decoding="async" onerror="handleMessageAvatarError(this, &quot;' + normalizedRole + '&quot;)">';
    }

    function refreshChatAvatarImages(role) {
      var normalizedRole = normalizeChatAvatarRole(role);
      document.querySelectorAll('.message .avatar.' + normalizedRole).forEach(function(avatarEl) {
        avatarEl.innerHTML = getMessageAvatarHtml(normalizedRole);
      });
      if (normalizedRole === 'user') {
        var sidebarAvatar = document.getElementById('sidebarUserAvatar');
        if (sidebarAvatar) sidebarAvatar.innerHTML = getMessageAvatarHtml('user');
      }
    }

    function getBuiltInChatAvatarOptions(role) {
      var normalizedRole = normalizeChatAvatarRole(role);
      var options = [{
        id: 'default-' + normalizedRole,
        url: getDefaultChatAvatarSource(normalizedRole),
        label: '默认头像',
        builtIn: true
      }];
      for (var index = 1; index <= CHAT_AVATAR_BUILTIN_COUNT; index += 1) {
        var suffix = String(index).padStart(2, '0');
        options.push({
          id: 'builtin-' + suffix,
          url: '/avatars/avatar-' + suffix + '.png',
          label: '头像 ' + suffix,
          builtIn: true
        });
      }
      return options;
    }

    function renderChatAvatarOption(option, selectedSource, allowDelete) {
      var isSelected = String(option.url || '') === String(selectedSource || '');
      return '<div class="chat-avatar-option' + (isSelected ? ' selected' : '') + '"'
        + ' role="button" tabindex="0" data-avatar-action="select"'
        + ' data-avatar-source="' + escapeHtml(option.url || '') + '"'
        + ' aria-pressed="' + (isSelected ? 'true' : 'false') + '"'
        + ' aria-label="选择' + escapeHtml(option.label || '头像') + '">'
        + (allowDelete
          ? '<button type="button" class="chat-avatar-delete" data-avatar-action="delete" data-avatar-id="' + escapeHtml(option.id || '') + '" data-avatar-source="' + escapeHtml(option.url || '') + '" title="删除自定义头像" aria-label="删除自定义头像">×</button>'
          : '')
        + '<img src="' + escapeHtml(option.url || '') + '" alt="' + escapeHtml(option.label || '头像') + '" loading="lazy" decoding="async">'
        + '<span class="chat-avatar-option-label">' + escapeHtml(option.label || '头像') + '</span>'
        + (isSelected ? '<span class="chat-avatar-selected-mark" aria-hidden="true">✓</span>' : '')
        + '</div>';
    }

    function syncChatAvatarPickerSelection(role) {
      var panel = document.getElementById('chatAvatarPickerPanel');
      if (!panel || !rightSidebarAvatarPickerState) return;
      var normalizedRole = normalizeChatAvatarRole(role);
      if (normalizeChatAvatarRole(rightSidebarAvatarPickerState.role) !== normalizedRole) return;
      var selectedSource = getSelectedChatAvatarSource(normalizedRole);
      panel.querySelectorAll('.chat-avatar-option[data-avatar-action="select"]').forEach(function(option) {
        var selected = String(option.dataset.avatarSource || '') === String(selectedSource || '');
        option.classList.toggle('selected', selected);
        option.setAttribute('aria-pressed', selected ? 'true' : 'false');
        var mark = option.querySelector('.chat-avatar-selected-mark');
        if (selected && !mark) {
          mark = document.createElement('span');
          mark.className = 'chat-avatar-selected-mark';
          mark.setAttribute('aria-hidden', 'true');
          mark.textContent = '✓';
          option.appendChild(mark);
        } else if (!selected && mark) {
          mark.remove();
        }
      });
      var status = panel.querySelector('.chat-avatar-picker-status');
      if (status) {
        status.textContent = String(rightSidebarAvatarPickerState.status || '');
        status.classList.toggle('error', !!rightSidebarAvatarPickerState.error);
      }
    }

    function bindChatAvatarPickerPanel(panel) {
      if (!panel || panel.dataset.avatarPickerBound === 'true') return;
      panel.dataset.avatarPickerBound = 'true';
      panel.addEventListener('click', function(event) {
        var actionEl = event.target && event.target.closest ? event.target.closest('[data-avatar-action]') : null;
        if (!actionEl || !panel.contains(actionEl)) return;
        var action = String(actionEl.dataset.avatarAction || '');
        if (action === 'role') {
          switchChatAvatarPickerRole(actionEl.dataset.avatarRole);
          return;
        }
        if (action === 'upload') {
          var input = document.getElementById('customChatAvatarInput');
          if (input) input.click();
          return;
        }
        if (action === 'default') {
          clearSelectedChatAvatar(rightSidebarAvatarPickerState && rightSidebarAvatarPickerState.role);
          return;
        }
        if (action === 'close') {
          closeChatAvatarPicker();
          return;
        }
        if (action === 'delete') {
          event.stopPropagation();
          deleteCustomChatAvatar(actionEl.dataset.avatarId, actionEl.dataset.avatarSource);
          return;
        }
        if (action === 'select') {
          setSelectedChatAvatarSource(
            rightSidebarAvatarPickerState && rightSidebarAvatarPickerState.role,
            actionEl.dataset.avatarSource
          );
        }
      });
      panel.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        var option = event.target && event.target.closest ? event.target.closest('.chat-avatar-option[data-avatar-action="select"]') : null;
        if (!option || !panel.contains(option)) return;
        event.preventDefault();
        setSelectedChatAvatarSource(
          rightSidebarAvatarPickerState && rightSidebarAvatarPickerState.role,
          option.dataset.avatarSource
        );
      });
    }

    function renderChatAvatarPickerPanel() {
      var panel = document.getElementById('chatAvatarPickerPanel');
      if (!panel || !rightSidebarAvatarPickerState) return;
      var previousScrollContainer = panel.querySelector('.chat-avatar-picker-scroll');
      var previousScrollTop = previousScrollContainer ? previousScrollContainer.scrollTop : 0;
      var role = normalizeChatAvatarRole(rightSidebarAvatarPickerState.role);
      var selectedSource = getSelectedChatAvatarSource(role);
      var builtInOptions = getBuiltInChatAvatarOptions(role);
      var customOptions = customChatAvatarOptions.slice();
      var status = String(rightSidebarAvatarPickerState.status || '');
      panel.innerHTML = ''
        + '<div class="chat-avatar-picker-toolbar">'
        + '  <div class="chat-avatar-role-switch" aria-label="选择头像所属角色">'
        + '    <button type="button" class="chat-avatar-role-btn' + (role === 'bot' ? ' active' : '') + '" data-avatar-action="role" data-avatar-role="bot">AI 头像</button>'
        + '    <button type="button" class="chat-avatar-role-btn' + (role === 'user' ? ' active' : '') + '" data-avatar-action="role" data-avatar-role="user">我的头像</button>'
        + '  </div>'
        + '  <button type="button" class="chat-avatar-toolbar-btn" data-avatar-action="default">恢复默认</button>'
        + '  <button type="button" class="chat-avatar-toolbar-btn primary" data-avatar-action="upload">+ 上传自定义</button>'
        + '  <button type="button" class="chat-avatar-toolbar-btn" data-avatar-action="close">关闭</button>'
        + '  <div class="chat-avatar-picker-status' + (rightSidebarAvatarPickerState.error ? ' error' : '') + '">' + escapeHtml(status) + '</div>'
        + '</div>'
        + '<div class="chat-avatar-picker-scroll">'
        + '  <section class="chat-avatar-section">'
        + '    <h3 class="chat-avatar-section-title">内置头像 <span>' + builtInOptions.length + ' 个</span></h3>'
        + '    <div class="chat-avatar-grid">' + builtInOptions.map(function(option) {
          return renderChatAvatarOption(option, selectedSource, false);
        }).join('') + '</div>'
        + '  </section>'
        + '  <section class="chat-avatar-section">'
        + '    <h3 class="chat-avatar-section-title">用户自定义 <span>' + customOptions.length + ' 个 · 仅保存在本机</span></h3>'
        + (customOptions.length
          ? '<div class="chat-avatar-grid">' + customOptions.map(function(option, index) {
              return renderChatAvatarOption({
                id: option.id,
                url: option.url,
                label: '自定义 ' + String(index + 1)
              }, selectedSource, true);
            }).join('') + '</div>'
          : '<div class="chat-avatar-empty">还没有自定义头像。点击“上传自定义”，选择 PNG、JPG 或 WebP 图片即可。</div>')
        + '  </section>'
        + '</div>';
      bindChatAvatarPickerPanel(panel);
      var nextScrollContainer = panel.querySelector('.chat-avatar-picker-scroll');
      if (nextScrollContainer && previousScrollTop > 0) {
        nextScrollContainer.scrollTop = previousScrollTop;
      }
    }
    window.renderChatAvatarPickerPanel = renderChatAvatarPickerPanel;

    function switchChatAvatarPickerRole(role) {
      if (!rightSidebarAvatarPickerState) return;
      rightSidebarAvatarPickerState.role = normalizeChatAvatarRole(role);
      rightSidebarAvatarPickerState.status = '';
      rightSidebarAvatarPickerState.error = false;
      renderRightSidebarActivePanel();
    }
    window.switchChatAvatarPickerRole = switchChatAvatarPickerRole;

    async function loadCustomChatAvatars(force) {
      var requestedUserId = getChatAvatarUserId();
      if (customChatAvatarLoadedUserId !== requestedUserId) {
        customChatAvatarOptions = [];
        customChatAvatarLoadedUserId = requestedUserId;
        force = true;
      }
      if (customChatAvatarLoadPromise && !force) return customChatAvatarLoadPromise;
      customChatAvatarLoadPromise = (async function() {
        try {
          var response = await fetch('/api/chat-avatars?userId=' + encodeURIComponent(requestedUserId), {
            cache: 'no-store'
          });
          var payload = await response.json();
          if (!response.ok || !payload.success) {
            throw new Error(payload && payload.error && payload.error.message || '读取自定义头像失败');
          }
          customChatAvatarOptions = Array.isArray(payload.avatars) ? payload.avatars : [];
          if (rightSidebarAvatarPickerState) {
            rightSidebarAvatarPickerState.status = '';
            rightSidebarAvatarPickerState.error = false;
            renderRightSidebarChrome();
            renderChatAvatarPickerPanel();
          }
          return customChatAvatarOptions;
        } catch (error) {
          if (rightSidebarAvatarPickerState) {
            rightSidebarAvatarPickerState.status = error && error.message ? error.message : '读取自定义头像失败';
            rightSidebarAvatarPickerState.error = true;
            renderChatAvatarPickerPanel();
          }
          return customChatAvatarOptions;
        } finally {
          customChatAvatarLoadPromise = null;
        }
      })();
      return customChatAvatarLoadPromise;
    }

    function openChatAvatarPicker(role) {
      var activeTab = getRightSidebarActiveTab();
      if (activeTab !== 'avatar') rightSidebarAvatarReturnTab = activeTab;
      rightSidebarAvatarPickerState = {
        role: normalizeChatAvatarRole(role),
        status: '',
        error: false
      };
      rightSidebarTransientTab = 'avatar';
      setRightSidebarCollapsed(false, true);
      renderRightSidebarActivePanel();
      loadCustomChatAvatars(false);
    }
    window.openChatAvatarPicker = openChatAvatarPicker;

    function closeChatAvatarPicker() {
      var returnTab = rightSidebarAvatarReturnTab || 'article';
      rightSidebarAvatarPickerState = null;
      rightSidebarTransientTab = '';
      setRightSidebarTab(returnTab);
    }
    window.closeChatAvatarPicker = closeChatAvatarPicker;

    function decodeImageFile(file) {
      return new Promise(function(resolve, reject) {
        var image = new Image();
        var objectUrl = URL.createObjectURL(file);
        image.onload = function() {
          URL.revokeObjectURL(objectUrl);
          resolve(image);
        };
        image.onerror = function() {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('图片无法读取，请换一张 PNG、JPG 或 WebP 图片。'));
        };
        image.src = objectUrl;
      });
    }

    async function prepareCustomChatAvatarBlob(file) {
      if (!file) throw new Error('请选择头像图片。');
      if (!/^image\/(?:png|jpeg|webp)$/i.test(String(file.type || ''))) {
        throw new Error('仅支持 PNG、JPG 和 WebP 图片。');
      }
      if (file.size > 12 * 1024 * 1024) {
        throw new Error('原始图片不能超过 12 MB。');
      }
      var image = await decodeImageFile(file);
      var side = Math.min(image.naturalWidth || image.width, image.naturalHeight || image.height);
      if (!side) throw new Error('图片尺寸无效。');
      var sourceX = Math.max(0, ((image.naturalWidth || image.width) - side) / 2);
      var sourceY = Math.max(0, ((image.naturalHeight || image.height) - side) / 2);
      var canvas = document.createElement('canvas');
      canvas.width = 384;
      canvas.height = 384;
      var context = canvas.getContext('2d');
      if (!context) throw new Error('当前环境无法处理图片。');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, sourceX, sourceY, side, side, 0, 0, canvas.width, canvas.height);
      return new Promise(function(resolve, reject) {
        canvas.toBlob(function(blob) {
          if (blob) resolve(blob);
          else reject(new Error('头像压缩失败。'));
        }, 'image/webp', 0.9);
      });
    }

    async function uploadCustomChatAvatar(input) {
      var file = input && input.files && input.files[0];
      if (!file || !rightSidebarAvatarPickerState) return;
      var role = normalizeChatAvatarRole(rightSidebarAvatarPickerState.role);
      rightSidebarAvatarPickerState.status = '正在裁剪并保存自定义头像…';
      rightSidebarAvatarPickerState.error = false;
      renderChatAvatarPickerPanel();
      try {
        var avatarBlob = await prepareCustomChatAvatarBlob(file);
        var formData = new FormData();
        formData.append('userId', getChatAvatarUserId());
        formData.append('avatar', avatarBlob, 'custom-avatar.webp');
        var response = await fetch('/api/chat-avatars', {
          method: 'POST',
          body: formData
        });
        var payload = await response.json();
        if (!response.ok || !payload.success || !payload.avatar) {
          throw new Error(payload && payload.error && payload.error.message || '保存自定义头像失败');
        }
        customChatAvatarOptions.unshift(payload.avatar);
        rightSidebarAvatarPickerState.status = '自定义头像已保存到本机。';
        setSelectedChatAvatarSource(role, payload.avatar.url);
        renderChatAvatarPickerPanel();
      } catch (error) {
        rightSidebarAvatarPickerState.status = error && error.message ? error.message : '保存自定义头像失败';
        rightSidebarAvatarPickerState.error = true;
        renderChatAvatarPickerPanel();
      } finally {
        if (input) input.value = '';
      }
    }
    window.uploadCustomChatAvatar = uploadCustomChatAvatar;

    async function deleteCustomChatAvatar(avatarId, avatarSource) {
      if (!avatarId) return;
      if (!window.confirm('删除这个自定义头像？')) return;
      if (rightSidebarAvatarPickerState) {
        rightSidebarAvatarPickerState.status = '正在删除自定义头像…';
        rightSidebarAvatarPickerState.error = false;
        renderChatAvatarPickerPanel();
      }
      try {
        var response = await fetch(
          '/api/chat-avatars/file/' + encodeURIComponent(avatarId) + '?userId=' + encodeURIComponent(getChatAvatarUserId()),
          { method: 'DELETE' }
        );
        var payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload && payload.error && payload.error.message || '删除自定义头像失败');
        }
        customChatAvatarOptions = customChatAvatarOptions.filter(function(option) {
          return option.id !== avatarId;
        });
        ['bot', 'user'].forEach(function(role) {
          if (getSelectedChatAvatarSource(role) === avatarSource) clearSelectedChatAvatar(role);
        });
        if (rightSidebarAvatarPickerState) {
          rightSidebarAvatarPickerState.status = '自定义头像已删除。';
          rightSidebarAvatarPickerState.error = false;
          renderChatAvatarPickerPanel();
        }
      } catch (error) {
        if (rightSidebarAvatarPickerState) {
          rightSidebarAvatarPickerState.status = error && error.message ? error.message : '删除自定义头像失败';
          rightSidebarAvatarPickerState.error = true;
          renderChatAvatarPickerPanel();
        }
      }
    }
    window.deleteCustomChatAvatar = deleteCustomChatAvatar;

    function initChatAvatarPicker() {
      var root = document.documentElement;
      if (!root || root.dataset.chatAvatarPickerBound === 'true') return;
      root.dataset.chatAvatarPickerBound = 'true';
      document.addEventListener('click', function(event) {
        var avatarEl = event.target && event.target.closest
          ? event.target.closest('.message .avatar.bot, .message .avatar.user')
          : null;
        if (!avatarEl) return;
        openChatAvatarPicker(avatarEl.classList.contains('user') ? 'user' : 'bot');
      });
      refreshChatAvatarImages('bot');
      refreshChatAvatarImages('user');
    }

    initChatAvatarPicker();

    function stripDecorativeAiIcons(text) {
      return String(text || '')
        .replace(/([0-9#*])\uFE0F?\u20E3/g, '$1.')
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
        .replace(/[\u20E3\uFE0E\uFE0F\u200D]/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/^[ \t]+/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function renderPlainStatusText(text) {
      return escapeHtml(stripDecorativeAiIcons(text));
    }

    function setPlainStatusHtml(element, text, trailingHtml) {
      if (!element) return;
      element.innerHTML = renderPlainStatusText(text) + (trailingHtml || '');
    }

    function formatBotMessage(text) {
      return formatMessage(stripDecorativeAiIcons(text));
    }

    function isAgentTranscriptText(text) {
      var value = String(text || '');
      return /(?:^|\n)(?:Codex CLI 已启动|Codex 会话已启动|Codex 开始一轮推理|Codex 正在等待模型返回公开事件|Codex CLI 正在运行|Codex CLI 仍在执行|\*\*Workspace\*\*|Workspace\s*$|工作目录：|权限：|\[Codex stderr\]|\[Codex event:|思考：|↩\s*可回滚备份|```diff|已完成第\s*\d+\s*个工具循环|本轮没有新的工具调用|开始输出最终回答|[→✓!]\s*[A-Za-z_][A-Za-z0-9_.:-]*(?:\s|$))/m.test(value);
    }

    function splitAgentTranscript(text) {
      var value = String(text || '').trim();
      var codexFinalMatch = value.match(/\n{1,}##\s*Codex\s*最终回答\s*\n/i);
      if (codexFinalMatch && typeof codexFinalMatch.index === 'number') {
        return {
          progress: value.slice(0, codexFinalMatch.index).trim(),
          answer: value.slice(codexFinalMatch.index + codexFinalMatch[0].length).trim()
        };
      }

      var separator = '\n\n---\n\n';
      var separatorIndex = value.indexOf(separator);
      if (separatorIndex >= 0) {
        return {
          progress: value.slice(0, separatorIndex).trim(),
          answer: value.slice(separatorIndex + separator.length).trim()
        };
      }

      return { progress: value, answer: '' };
    }

    function extractVerifiedCodexArtifactText(text) {
      var value = String(text || '');
      var blocks = [];
      var pattern = /\[\[SH_VERIFIED_ARTIFACTS_BEGIN\]\]([\s\S]*?)\[\[SH_VERIFIED_ARTIFACTS_END\]\]/g;
      var match;
      while ((match = pattern.exec(value)) !== null) {
        if (String(match[1] || '').trim()) blocks.push(String(match[1]).trim());
      }
      return blocks.join('\n');
    }

    function stripVerifiedCodexArtifactMarkers(text) {
      return String(text || '')
        .replace(/\[\[SH_VERIFIED_ARTIFACTS_BEGIN\]\][\s\S]*?\[\[SH_VERIFIED_ARTIFACTS_END\]\]/g, '')
        .replace(/\[\[SH_VERIFIED_ARTIFACTS_BEGIN\]\]/g, '')
        .replace(/\[\[SH_VERIFIED_ARTIFACTS_END\]\]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function formatAgentElapsed(ms) {
      var totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
      var minutes = Math.floor(totalSeconds / 60);
      var seconds = totalSeconds % 60;
      if (minutes > 0) return minutes + 'm ' + seconds + 's';
      return seconds + 's';
    }

    async function restoreWorkspaceBackupFromTranscript(backupId, button) {
      var safeBackupId = String(backupId || '').trim();
      if (!safeBackupId) return;
      if (!confirm('确定回滚这次工作目录文件改动吗？\n\n备份 ID：' + safeBackupId)) return;
      if (button) {
        button.disabled = true;
        button.textContent = '回滚中';
      }
      try {
        var response = await fetch('/api/chat-bridge/workspace/restore-backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ backupId: safeBackupId })
        });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '回滚失败');
        }
        if (button) button.textContent = '已回滚';
        appendMessage('✅ 已回滚工作目录文件：' + (result.result && result.result.restoredPath ? result.result.restoredPath : safeBackupId), 'bot', false, true);
      } catch (error) {
        if (button) {
          button.disabled = false;
          button.textContent = '回滚';
        }
        appendMessage('❌ 工作目录回滚失败：' + (error.message || error), 'bot', false, true);
      }
    }
    window.restoreWorkspaceBackupFromTranscript = restoreWorkspaceBackupFromTranscript;

    function normalizeAgentTranscriptLine(line) {
      return String(line || '')
        .replace(/^\*\*Workspace\*\*$/, 'Workspace')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^\s*-\s+/, '')
        .trimEnd();
    }

    function shouldHideAgentTranscriptLine(rawLine) {
      var line = normalizeAgentTranscriptLine(rawLine).trim();
      if (!line) return false;
      return /^Codex CLI 正在运行[，,]\s*本轮已用时约\s*\d+\s*秒/.test(line)
        || /^Codex CLI 仍在执行[，,]\s*本轮已等待约\s*\d+\s*秒/.test(line);
    }

    function classifyAgentTranscriptLine(rawLine) {
      var line = normalizeAgentTranscriptLine(rawLine);
      if (!line.trim()) return { marker: '', className: 'is-blank', text: '' };
      if (/^→\s*/.test(line)) return { marker: '›', className: 'is-command', text: line.replace(/^→\s*/, '') };
      if (/^✓\s*/.test(line)) return { marker: '✓', className: 'is-success', text: line.replace(/^✓\s*/, '') };
      var backupMatch = line.match(/^↩\s*可回滚备份[:：]\s*([A-Za-z0-9_.:-]+)/);
      if (backupMatch) return { marker: '↩', className: 'is-success', text: line.replace(/^↩\s*/, ''), backupId: backupMatch[1] };
      if (/^!\s*/.test(line) || /^错误[:：]/.test(line) || /未执行成功|执行失败/.test(line) || /\[Codex stderr\]/.test(line)) {
        return { marker: '!', className: 'is-error', text: line.replace(/^!\s*/, '') };
      }
      if (/^(Codex CLI|Codex 会话|Codex 开始|Codex 正在等待|Workspace|根目录[:：]|工作目录[:：]|权限[:：]|已索引文件[:：]|Codex 最终回答|本轮完成|本轮没有新的工具调用|stdout:|stderr:)/.test(line)) {
        return { marker: '•', className: 'is-muted', text: line };
      }
      if (/^思考[:：]/.test(line)) return { marker: '·', className: 'is-running', text: line };
      return { marker: '•', className: '', text: line };
    }

    function getAgentEditDisplayPath(filePath) {
      var value = String(filePath || '').trim()
        .replace(/^["']|["']$/g, '')
        .replace(/^[ab]\//, '');
      var parts = value.split(/[\\/]+/);
      return parts[parts.length - 1] || value || 'untitled';
    }

    function collectAgentEditSummary(progress) {
      var raw = String(progress || '');
      var editsByPath = {};
      var diffPattern = /```diff\s*\n([\s\S]*?)```/g;
      var match;
      while ((match = diffPattern.exec(raw)) !== null) {
        var diff = String(match[1] || '');
        var lines = diff.split(/\r?\n/);
        var filePath = '';
        var fallbackPath = '';
        var added = 0;
        var removed = 0;
        lines.forEach(function(line) {
          if (/^---\s+/.test(line)) {
            fallbackPath = line.replace(/^---\s+/, '').trim();
            return;
          }
          if (/^\+\+\+\s+/.test(line)) {
            filePath = line.replace(/^\+\+\+\s+/, '').trim();
            return;
          }
          if (/^\+/.test(line) && !/^\+\+\+/.test(line)) {
            added += 1;
            return;
          }
          if (/^-/.test(line) && !/^---/.test(line)) {
            removed += 1;
          }
        });
        var key = filePath && filePath !== '/dev/null' ? filePath : fallbackPath;
        key = key && key !== '/dev/null' ? key : '';
        if (!key || (added === 0 && removed === 0)) return;
        if (!editsByPath[key]) {
          editsByPath[key] = { path: key, displayPath: getAgentEditDisplayPath(key), added: 0, removed: 0 };
        }
        editsByPath[key].added += added;
        editsByPath[key].removed += removed;
      }
      return Object.keys(editsByPath).map(function(key) { return editsByPath[key]; });
    }

    function renderAgentEditSummary(progress) {
      var edits = collectAgentEditSummary(progress);
      if (!edits.length) return '';
      var rows = edits.map(function(edit) {
        return '<div class="agent-edit-summary-row" title="' + escapeHtml(edit.path) + '">' +
          '<span>已编辑</span>' +
          '<span class="agent-edit-summary-path">' + escapeHtml(edit.displayPath) + '</span>' +
          '<span class="agent-edit-summary-added">+' + Number(edit.added || 0) + '</span>' +
          '<span class="agent-edit-summary-removed">-' + Number(edit.removed || 0) + '</span>' +
        '</div>';
      }).join('');
      return '<details class="agent-edit-summary" open>' +
        '<summary>' +
          uiIcon('edit') +
          '<span class="agent-edit-summary-title">已编辑 ' + edits.length + ' 个文件</span>' +
          '<span class="agent-edit-summary-chevron">⌄</span>' +
        '</summary>' +
        '<div class="agent-edit-summary-rows">' + rows + '</div>' +
      '</details>';
    }

    var activeAgentTranscriptScrollRoot = null;
    var activeAgentTranscriptWheelRoot = null;

    function setActiveAgentTranscriptWheelRoot(root) {
      if (activeAgentTranscriptWheelRoot && activeAgentTranscriptWheelRoot !== root) {
        activeAgentTranscriptWheelRoot.__agentTranscriptWheelEnabled = false;
      }
      activeAgentTranscriptWheelRoot = root || null;
      if (activeAgentTranscriptWheelRoot) {
        activeAgentTranscriptWheelRoot.__agentTranscriptWheelEnabled = true;
      }
    }

    function getAgentTranscriptPageScrollTarget(eventTarget) {
      var source = eventTarget && eventTarget.nodeType === 1
        ? eventTarget
        : (eventTarget && eventTarget.parentElement ? eventTarget.parentElement : null);
      var candidates = [];
      if (source && source.closest) {
        candidates.push(source.closest('#metaAnalysisAiOutput'));
        candidates.push(source.closest('.chat-container'));
        candidates.push(source.closest('.meta-analysis-wizard-body'));
      }
      candidates.push(chatContainer);
      for (var index = 0; index < candidates.length; index += 1) {
        var candidate = candidates[index];
        if (
          candidate
          && candidate.classList
          && !candidate.classList.contains('agent-transcript-body')
          && candidate.scrollHeight > candidate.clientHeight + 1
        ) {
          return candidate;
        }
      }
      return candidates.find(function(candidate) { return !!candidate; }) || document.scrollingElement || null;
    }

    function scrollMainChatFromAgentTranscriptWheel(event) {
      if (!event) return;
      var pageScrollTarget = getAgentTranscriptPageScrollTarget(event.target);
      if (!pageScrollTarget) return;
      var multiplier = event.deltaMode === 1
        ? 16
        : (event.deltaMode === 2 ? Math.max(pageScrollTarget.clientHeight, 1) : 1);
      pageScrollTarget.scrollTop += Number(event.deltaY || 0) * multiplier;
      pageScrollTarget.scrollLeft += Number(event.deltaX || 0) * multiplier;
    }

    function isAgentTranscriptBodyNearBottom(body, threshold) {
      if (!body) return true;
      return body.scrollHeight - body.scrollTop - body.clientHeight <= (threshold || 28);
    }

    function captureAgentTranscriptScrollState(root) {
      if (!root || !root.querySelector) return null;
      var body = root.querySelector('.agent-transcript.has-scroll-log .agent-transcript-body');
      if (!body) return null;
      var nearBottom = isAgentTranscriptBodyNearBottom(body, 28);
      if (typeof root.__agentTranscriptFollow !== 'boolean') {
        root.__agentTranscriptFollow = nearBottom;
      }
      return {
        scrollTop: body.scrollTop,
        follow: root.__agentTranscriptFollow !== false && nearBottom
      };
    }

    function restoreAgentTranscriptScrollState(root, state) {
      if (!root || !root.querySelector) return;
      var body = root.querySelector('.agent-transcript.has-scroll-log .agent-transcript-body');
      if (!body) return;
      var shouldFollow = !state || state.follow;
      root.__agentTranscriptApplyingScroll = true;
      if (shouldFollow) {
        root.__agentTranscriptFollow = true;
        body.scrollTop = body.scrollHeight;
      } else {
        root.__agentTranscriptFollow = false;
        var maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
        body.scrollTop = Math.min(Math.max(0, Number(state.scrollTop || 0)), maxScrollTop);
      }
      requestAnimationFrame(function() {
        root.__agentTranscriptApplyingScroll = false;
      });
    }

    function bindAgentTranscriptScrollTracking(root) {
      if (!root || root.__agentTranscriptScrollTrackingBound) return;
      root.__agentTranscriptScrollTrackingBound = true;

      root.addEventListener('scroll', function(event) {
        var body = event.target;
        if (!body || !body.classList || !body.classList.contains('agent-transcript-body')) return;
        if (root.__agentTranscriptApplyingScroll) return;
        root.__agentTranscriptFollow = isAgentTranscriptBodyNearBottom(body, 28);
      }, true);

      root.addEventListener('wheel', function(event) {
        var body = event.target && event.target.closest
          ? event.target.closest('.agent-transcript-body')
          : null;
        if (!body || !root.contains(body)) return;
        if (root.__agentTranscriptWheelEnabled !== true) {
          event.preventDefault();
          event.stopPropagation();
          scrollMainChatFromAgentTranscriptWheel(event);
          return;
        }
        root.__agentTranscriptFollow = false;
        root.__agentTranscriptManualScrollUntil = Date.now() + 220;
      }, { passive: false, capture: true });

      root.addEventListener('touchmove', function(event) {
        var body = event.target && event.target.closest
          ? event.target.closest('.agent-transcript-body')
          : null;
        if (!body || !root.contains(body)) return;
        root.__agentTranscriptFollow = false;
        root.__agentTranscriptManualScrollUntil = Date.now() + 260;
      }, { passive: true, capture: true });

      root.addEventListener('pointerdown', function(event) {
        var transcript = event.target && event.target.closest
          ? event.target.closest('.agent-transcript.has-scroll-log')
          : null;
        if (!transcript || !root.contains(transcript)) return;
        setActiveAgentTranscriptWheelRoot(root);
        var body = transcript.querySelector('.agent-transcript-body');
        if (!body) return;
        root.__agentTranscriptFollow = false;
        root.__agentTranscriptPointerActive = true;
        activeAgentTranscriptScrollRoot = root;
      }, true);
    }

    document.addEventListener('pointerdown', function(event) {
      var transcript = event.target && event.target.closest
        ? event.target.closest('.agent-transcript.has-scroll-log')
        : null;
      if (transcript) {
        setActiveAgentTranscriptWheelRoot(transcript.closest('.content') || transcript);
        return;
      }
      setActiveAgentTranscriptWheelRoot(null);
    });

    document.addEventListener('wheel', function(event) {
      var body = event.target && event.target.closest
        ? event.target.closest('.agent-transcript.has-scroll-log .agent-transcript-body')
        : null;
      if (!body) return;
      if (activeAgentTranscriptWheelRoot && activeAgentTranscriptWheelRoot.contains(body)) return;
      event.preventDefault();
      event.stopPropagation();
      scrollMainChatFromAgentTranscriptWheel(event);
    }, { passive: false, capture: true });

    document.addEventListener('pointerup', function() {
      if (!activeAgentTranscriptScrollRoot) return;
      activeAgentTranscriptScrollRoot.__agentTranscriptPointerActive = false;
      activeAgentTranscriptScrollRoot.__agentTranscriptManualScrollUntil = Date.now() + 100;
      activeAgentTranscriptScrollRoot = null;
    }, true);

    document.addEventListener('pointercancel', function() {
      if (!activeAgentTranscriptScrollRoot) return;
      activeAgentTranscriptScrollRoot.__agentTranscriptPointerActive = false;
      activeAgentTranscriptScrollRoot = null;
    }, true);

    function isAgentTranscriptScrollInteractionActive(root) {
      if (!root) return false;
      return !!root.__agentTranscriptPointerActive
        || Number(root.__agentTranscriptManualScrollUntil || 0) > Date.now();
    }

    function scrollAgentTranscriptLogsToBottom(root) {
      if (!root || !root.querySelectorAll || root.__agentTranscriptFollow === false) return;
      var bodies = root.querySelectorAll('.agent-transcript.has-scroll-log .agent-transcript-body');
      bodies.forEach(function(body) {
        body.scrollTop = body.scrollHeight;
      });
    }

    function renderAgentTranscript(text, options) {
      options = options || {};
      var parts = splitAgentTranscript(stripDecorativeAiIcons(text));
      var isCodexTranscript = /(?:^|\n)Codex CLI 已启动|##\s*Codex\s*最终回答/i.test(String(text || ''));
      var verifiedCodexArtifacts = isCodexTranscript
        ? extractVerifiedCodexArtifactText((parts.progress || '') + '\n' + (parts.answer || ''))
        : '';
      var progress = parts.progress || '';
      var lines = progress.split(/\r?\n/).filter(function(line) { return !shouldHideAgentTranscriptLine(line); });
      var maxLines = options.final ? 260 : 180;
      var truncated = lines.length > maxLines;
      if (truncated) {
        lines = lines.slice(Math.max(0, lines.length - maxLines));
      }
      var elapsed = options.elapsedMs != null ? formatAgentElapsed(options.elapsedMs) : '';
      var header = options.final
        ? 'Worked' + (elapsed ? ' for ' + elapsed : '')
        : '运行中 · 可继续输入' + (elapsed ? ' · ' + elapsed : '');
      var lineHtml = lines.map(function(rawLine) {
        var item = classifyAgentTranscriptLine(rawLine);
        if (item.className === 'is-blank') {
          return '<div class="agent-transcript-line is-blank" aria-hidden="true"></div>';
        }
        var actionHtml = item.backupId
          ? ' <button type="button" class="agent-transcript-restore-btn" data-backup-id="' + escapeHtml(item.backupId) + '" onclick="restoreWorkspaceBackupFromTranscript(this.dataset.backupId, this)">回滚</button>'
          : '';
        return '<div class="agent-transcript-line ' + item.className + '">' +
          '<span class="agent-transcript-marker">' + escapeHtml(item.marker) + '</span>' +
          '<span class="agent-transcript-text">' + escapeHtml(item.text) + actionHtml + '</span>' +
        '</div>';
      }).join('');

      if (truncated) {
        lineHtml = '<div class="agent-transcript-line is-muted">' +
          '<span class="agent-transcript-marker">…</span>' +
          '<span class="agent-transcript-text">已折叠较早的执行日志，只保留最近 ' + maxLines + ' 行。</span>' +
        '</div>' + lineHtml;
      }

      var answerText = isCodexTranscript
        ? stripVerifiedCodexArtifactMarkers(parts.answer)
        : parts.answer;
      var answerHtml = answerText
        ? '<div class="agent-transcript-answer">' + (isCodexTranscript
          ? formatMessage(answerText, { skipOutputAttachments: true })
          : formatBotMessage(answerText)) + '</div>'
        : '';
      var progressAttachmentsHtml = isCodexTranscript
        ? renderOutputAttachmentCards(verifiedCodexArtifacts, { workspaceContextText: parts.progress || '', verified: true })
        : renderOutputAttachmentCards(parts.progress || '', { latestGeneratedOnly: true });

      var editSummaryHtml = renderAgentEditSummary(parts.progress || '');
      var scrollClass = lines.length > 14 ? ' has-scroll-log' : '';

      return editSummaryHtml + '<div class="agent-transcript' + scrollClass + (options.final ? '' : ' is-running') + '" role="log" aria-live="' + (options.final ? 'polite' : 'off') + '">' +
        '<div class="agent-transcript-header"><span class="agent-transcript-live-dot" aria-hidden="true"></span><span class="agent-transcript-header-text">' + escapeHtml(header) + '</span></div>' +
        '<div class="agent-transcript-body">' + lineHtml + '</div>' +
      '</div>' + progressAttachmentsHtml + answerHtml;
    }

    function renderBotMessageContent(text, options) {
      options = options || {};
      var normalized = stripDecorativeAiIcons(text);
      if (options.allowAgentTranscript && isAgentTranscriptText(normalized)) {
        return renderAgentTranscript(normalized, options);
      }
      return formatBotMessage(normalized);
    }

    function createBotTextStreamer(messageDiv) {
      var contentDiv = messageDiv ? messageDiv.querySelector('.content') : null;
      var targetText = '';
      var renderedText = '';
      var timer = null;
      var finalizing = false;
      var renderRequested = false;
      var idleResolvers = [];
      var streamStartedAt = Date.now();
      var elapsedMsOverride = null;

      function resolveIdle() {
        var resolvers = idleResolvers.slice();
        idleResolvers = [];
        resolvers.forEach(function(resolve) { resolve(); });
      }

      function getStreamElapsedMs() {
        return elapsedMsOverride != null ? elapsedMsOverride : (Date.now() - streamStartedAt);
      }

      function renderCurrentText() {
        if (!contentDiv) return;
        var renderStartedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        var useAgentTranscript = isAgentTranscriptText(renderedText);
        var isFinalRender = finalizing && renderedText === targetText;
        if (isFinalRender) {
          var transcriptScrollState = captureAgentTranscriptScrollState(contentDiv);
          contentDiv.classList.toggle('agent-transcript-content', useAgentTranscript);
          contentDiv.innerHTML = renderBotMessageContent(renderedText, {
            allowAgentTranscript: true,
            final: true,
            elapsedMs: getStreamElapsedMs()
          });
          initWorkspaceImageStacks(contentDiv);
          syncMessageLocalFileVisibilityClass(contentDiv.closest('.message'));
          bindAgentTranscriptScrollTracking(contentDiv);
          restoreAgentTranscriptScrollState(contentDiv, transcriptScrollState);
        } else if (useAgentTranscript) {
          renderLightweightAgentTranscript();
        } else {
          renderLightweightPlainText();
        }
        scheduleStreamingScroll();
        var renderFinishedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        recordMainChatStreamRender(renderFinishedAt - renderStartedAt, renderedText.length);
      }

      var lightweightRenderMode = '';
      var lightweightPlainTextNode = null;
      var lightweightTranscriptHeader = null;
      var lightweightTranscriptHeaderText = null;
      var lightweightTranscriptBody = null;
      var lightweightTranscriptText = null;
      var lightweightTranscriptAnswer = null;
      var streamingScrollFrame = null;

      function resetLightweightRenderReferences(mode) {
        lightweightRenderMode = mode || '';
        lightweightPlainTextNode = null;
        lightweightTranscriptHeader = null;
        lightweightTranscriptHeaderText = null;
        lightweightTranscriptBody = null;
        lightweightTranscriptText = null;
        lightweightTranscriptAnswer = null;
      }

      function scheduleStreamingScroll() {
        if (streamingScrollFrame !== null) return;
        streamingScrollFrame = requestAnimationFrame(function() {
          streamingScrollFrame = null;
          maybeScrollChatToBottom(shouldAutoScrollChat());
        });
      }

      function ensureLightweightPlainText() {
        if (
          lightweightRenderMode === 'plain' &&
          lightweightPlainTextNode &&
          contentDiv.contains(lightweightPlainTextNode)
        ) {
          return lightweightPlainTextNode;
        }
        contentDiv.classList.remove('agent-transcript-content');
        contentDiv.replaceChildren();
        var plain = document.createElement('div');
        plain.className = 'streaming-message-text';
        plain.setAttribute('aria-live', 'off');
        contentDiv.appendChild(plain);
        resetLightweightRenderReferences('plain');
        lightweightPlainTextNode = plain;
        return plain;
      }

      function renderLightweightPlainText() {
        var plain = ensureLightweightPlainText();
        var nextText = stripDecorativeAiIcons(renderedText);
        if (plain.textContent !== nextText) plain.textContent = nextText;
      }

      function ensureLightweightAgentTranscript() {
        if (
          lightweightRenderMode === 'transcript' &&
          lightweightTranscriptText &&
          contentDiv.contains(lightweightTranscriptText)
        ) {
          return;
        }
        contentDiv.classList.add('agent-transcript-content');
        contentDiv.replaceChildren();

        var transcript = document.createElement('div');
        transcript.className = 'agent-transcript has-scroll-log is-running';
        transcript.setAttribute('role', 'log');
        transcript.setAttribute('aria-live', 'off');

        var header = document.createElement('div');
        header.className = 'agent-transcript-header';
        var liveDot = document.createElement('span');
        liveDot.className = 'agent-transcript-live-dot';
        liveDot.setAttribute('aria-hidden', 'true');
        var headerText = document.createElement('span');
        headerText.className = 'agent-transcript-header-text';
        header.appendChild(liveDot);
        header.appendChild(headerText);
        var body = document.createElement('div');
        body.className = 'agent-transcript-body';
        var logText = document.createElement('div');
        logText.className = 'agent-transcript-stream-text';
        body.appendChild(logText);
        transcript.appendChild(header);
        transcript.appendChild(body);

        var answer = document.createElement('div');
        answer.className = 'agent-transcript-answer agent-transcript-stream-answer';
        contentDiv.appendChild(transcript);
        contentDiv.appendChild(answer);

        resetLightweightRenderReferences('transcript');
        lightweightTranscriptHeader = header;
        lightweightTranscriptHeaderText = headerText;
        lightweightTranscriptBody = body;
        lightweightTranscriptText = logText;
        lightweightTranscriptAnswer = answer;
        bindAgentTranscriptScrollTracking(contentDiv);
        // The Pi running strip acts as the initial thinking indicator. Once
        // the real execution transcript exists, its dark header takes over.
        renderMainChatPiQueue(mainChatPiState);
        if (
          contentDiv.closest
          && contentDiv.closest('#modalOverlay.meta-analysis-shared-composer-overlay')
          && typeof renderPdfWikiMetaPiQueue === 'function'
        ) {
          renderPdfWikiMetaPiQueue(pdfWikiMetaPiState);
        }
      }

      function getLightweightTranscriptSnapshot(text) {
        var parts = splitAgentTranscript(stripDecorativeAiIcons(text));
        var lines = String(parts.progress || '')
          .split(/\r?\n/)
          .filter(function(line) { return !shouldHideAgentTranscriptLine(line); });
        var maxLines = 180;
        var truncated = lines.length > maxLines;
        if (truncated) lines = lines.slice(lines.length - maxLines);
        var logText = lines.map(function(rawLine) {
          var item = classifyAgentTranscriptLine(rawLine);
          if (item.className === 'is-blank') return '';
          return (item.marker ? item.marker + ' ' : '') + item.text;
        }).join('\n');
        if (truncated) {
          logText = '… 已折叠较早的执行日志，只保留最近 ' + maxLines + ' 行。\n' + logText;
        }
        var maxLogCharacters = 24000;
        if (logText.length > maxLogCharacters) {
          logText = '… 执行日志较长，只保留最近内容。\n' + logText.slice(-maxLogCharacters);
        }
        return {
          logText: logText,
          answerText: stripVerifiedCodexArtifactMarkers(parts.answer || '')
        };
      }

      function renderLightweightAgentTranscript() {
        var previousScrollState = captureAgentTranscriptScrollState(contentDiv);
        ensureLightweightAgentTranscript();
        var snapshot = getLightweightTranscriptSnapshot(renderedText);
        var elapsed = formatAgentElapsed(getStreamElapsedMs());
        var headerLabel = '运行中 · 可继续输入' + (elapsed ? ' · ' + elapsed : '');
        if (lightweightTranscriptHeaderText && lightweightTranscriptHeaderText.textContent !== headerLabel) {
          lightweightTranscriptHeaderText.textContent = headerLabel;
        }
        if (lightweightTranscriptText.textContent !== snapshot.logText) {
          lightweightTranscriptText.textContent = snapshot.logText;
        }
        if (lightweightTranscriptAnswer.textContent !== snapshot.answerText) {
          lightweightTranscriptAnswer.textContent = snapshot.answerText;
        }
        restoreAgentTranscriptScrollState(contentDiv, previousScrollState);
      }

      function getRenderDelay() {
        if (finalizing) return 0;
        if (mainChatInputComposing) return 180;
        if (userInput && document.activeElement === userInput) return 96;
        return 48;
      }

      function schedule(delayOverride) {
        if (!contentDiv || timer) return;
        var delay = delayOverride === undefined ? getRenderDelay() : Math.max(0, Number(delayOverride || 0));
        timer = setTimeout(tick, delay);
      }

      function setTarget(text) {
        var nextText = String(text || '');
        if (renderedText && nextText && !nextText.startsWith(renderedText)) {
          renderedText = '';
        }
        targetText = nextText;
        renderRequested = true;
        schedule();
      }

      function tick() {
        timer = null;
        if (!contentDiv) {
          resolveIdle();
          return;
        }
        // Input has a higher scheduling priority than transcript formatting.
        // Continuous typing keeps coalescing stream chunks; one latest snapshot is
        // committed after a short quiet window instead of competing with the caret.
        if (mainChatInputComposing) {
          schedule(80);
          return;
        }
        var inputPriorityWindow = Number(
          finalizing
            ? (MAIN_CHAT_FINAL_RENDER_QUIET_WINDOW_MS || 320)
            : (MAIN_CHAT_INPUT_PRIORITY_WINDOW_MS || 140)
        );
        var inputQuietFor = mainChatLastInputAt ? Date.now() - mainChatLastInputAt : inputPriorityWindow;
        if (
          userInput &&
          document.activeElement === userInput &&
          inputQuietFor < inputPriorityWindow
        ) {
          schedule(Math.max(24, inputPriorityWindow - inputQuietFor));
          return;
        }
        if (!finalizing && isAgentTranscriptScrollInteractionActive(contentDiv)) {
          schedule();
          return;
        }
        if (renderRequested || renderedText !== targetText) {
          // Render the newest accumulated snapshot once. The previous typewriter
          // loop rebuilt all Markdown for every 1-10 characters, up to ~70 times/s.
          renderedText = targetText;
          renderRequested = false;
          renderCurrentText();
          if (renderRequested || renderedText !== targetText) {
            schedule();
          } else {
            resolveIdle();
          }
        } else {
          resolveIdle();
        }
      }

      return {
        setText: function(text) {
          setTarget(text);
        },
        setElapsedMs: function(elapsedMs) {
          var nextElapsed = Number(elapsedMs || 0);
          if (!Number.isFinite(nextElapsed) || nextElapsed <= 0) return;
          elapsedMsOverride = nextElapsed;
          if ((renderedText || targetText) && isAgentTranscriptText(targetText || renderedText)) {
            renderRequested = true;
            schedule();
          }
        },
        finish: function(text, elapsedMs) {
          finalizing = true;
          var nextElapsed = Number(elapsedMs || 0);
          elapsedMsOverride = Number.isFinite(nextElapsed) && nextElapsed > 0 ? nextElapsed : null;
          targetText = String(text || targetText || '');
          renderRequested = true;
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          return new Promise(function(resolve) {
            idleResolvers.push(resolve);
            schedule(0);
          });
        }
      };
    }

    function syncMessageLocalFileVisibilityClass(messageElement) {
      if (!messageElement || !messageElement.classList) return;
      messageElement.classList.toggle(
        'message-has-local-file-link',
        !!messageElement.querySelector('.message-local-file-link')
      );
    }

    var chatMessageLayoutRepairFrame = null;
    var chatMessageLayoutObserver = null;
    var chatMessageLayoutResizeObserver = null;

    function repairCollapsedChatMessageLayout(messageElement) {
      if (!messageElement || !messageElement.classList || !messageElement.classList.contains('bot')) return;
      var content = messageElement.querySelector(':scope > .content');
      if (!content || !content.getBoundingClientRect) return;
      // Run this for every bot message, not only for visibly collapsed ones.
      // It also repairs persisted messages produced by older Markdown
      // renderers, where inline emphasis fragments could inherit grid/table
      // positioning and make a sentence look discontinuous.
      content.querySelectorAll('.message-list-body').forEach(function(body) {
        body.classList.add('message-inline-layout-normalized');
        body.removeAttribute('width');
        body.removeAttribute('align');
        body.removeAttribute('valign');
        body.style.removeProperty('grid-template-columns');
        body.style.removeProperty('grid-column');
        body.style.removeProperty('column-count');
        body.style.removeProperty('columns');
      });
      /*
       * Bot avatars are absolutely positioned outside the message bubble, so
       * they consume no horizontal layout space.  The old repair subtracted
       * 52px for an earlier inline-avatar layout and then persisted that
       * reduced width as an inline !important style.  If the repair ran while
       * a streaming message was still empty, that one reply stayed visibly
       * narrower than both the composer and the surrounding AI replies.
       */
      var messageRect = messageElement.getBoundingClientRect();
      if (messageElement.classList.contains('message-layout-repaired')) {
        content.style.setProperty('flex', '1 1 0', 'important');
        content.style.setProperty('width', '100%', 'important');
        content.style.setProperty('max-width', '100%', 'important');
        content.style.setProperty('min-width', '0', 'important');
      }
      var contentRect = content.getBoundingClientRect();
      var expectedWidth = Math.max(0, messageRect.width);

      if (expectedWidth >= 280 && contentRect.width < Math.min(240, expectedWidth * 0.6)) {
        messageElement.classList.add('message-layout-repaired');
        content.style.setProperty('flex', '1 1 0', 'important');
        content.style.setProperty('width', '100%', 'important');
        content.style.setProperty('max-width', '100%', 'important');
        content.style.setProperty('min-width', '0', 'important');
        content.style.setProperty('writing-mode', 'horizontal-tb', 'important');
      }

      var stableContentWidth = Math.max(content.getBoundingClientRect().width, expectedWidth);
      content.querySelectorAll('.message-list-body').forEach(function(body) {
        var textLength = String(body.textContent || '').replace(/\s+/g, '').length;
        if (textLength < 8 || !body.getBoundingClientRect) return;
        var bodyRect = body.getBoundingClientRect();
        if (stableContentWidth < 260 || bodyRect.width >= Math.min(120, stableContentWidth * 0.35)) return;
        messageElement.classList.add('message-layout-repaired');
        var item = body.closest('.message-list-item');
        if (item) {
          item.classList.add('message-layout-repaired');
          item.style.setProperty('display', 'flex', 'important');
          item.style.setProperty('width', '100%', 'important');
          item.style.setProperty('max-width', '100%', 'important');
          item.style.setProperty('min-width', '0', 'important');
        }
        body.classList.add('message-layout-repaired');
        body.style.setProperty('display', 'block', 'important');
        body.style.setProperty('flex', '1 1 0', 'important');
        body.style.setProperty('width', 'auto', 'important');
        body.style.setProperty('max-width', '100%', 'important');
        body.style.setProperty('min-width', '0', 'important');
        body.style.setProperty('float', 'none', 'important');
        body.style.setProperty('writing-mode', 'horizontal-tb', 'important');
        body.style.setProperty('word-break', 'normal', 'important');
        body.style.setProperty('overflow-wrap', 'break-word', 'important');
      });
    }

    function runChatMessageLayoutRepair(root) {
      if (!messagesDiv) return;
      var candidates = [];
      if (root && root.nodeType === 1) {
        if (root.matches && root.matches('.message.bot')) candidates.push(root);
        if (root.closest) {
          var closestMessage = root.closest('.message.bot');
          if (closestMessage) candidates.push(closestMessage);
        }
        if (root.querySelectorAll) {
          root.querySelectorAll('.message.bot').forEach(function(message) { candidates.push(message); });
        }
      }
      if (!candidates.length) {
        candidates = Array.prototype.slice.call(messagesDiv.querySelectorAll('.message.bot')).slice(-12);
      }
      var seen = new Set();
      candidates.forEach(function(message) {
        if (!message || seen.has(message)) return;
        seen.add(message);
        repairCollapsedChatMessageLayout(message);
      });
    }

    function scheduleChatMessageLayoutRepair(root) {
      if (!messagesDiv) return;
      if (chatMessageLayoutRepairFrame !== null) return;
      var schedule = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : function(callback) { return setTimeout(callback, 0); };
      chatMessageLayoutRepairFrame = schedule(function() {
        chatMessageLayoutRepairFrame = null;
        runChatMessageLayoutRepair(root || null);
      });
    }

    function ensureChatMessageLayoutGuard() {
      if (!messagesDiv) return;
      if (!chatMessageLayoutObserver && typeof MutationObserver === 'function') {
        chatMessageLayoutObserver = new MutationObserver(function(mutations) {
          var repairRoot = null;
          for (var i = mutations.length - 1; i >= 0; i--) {
            var target = mutations[i] && mutations[i].target;
            if (target && target.nodeType === 1) {
              repairRoot = target;
              break;
            }
          }
          scheduleChatMessageLayoutRepair(repairRoot);
        });
        chatMessageLayoutObserver.observe(messagesDiv, {
          childList: true,
          subtree: true,
          characterData: true
        });
      }
      if (!chatMessageLayoutResizeObserver && typeof ResizeObserver === 'function') {
        chatMessageLayoutResizeObserver = new ResizeObserver(function() {
          scheduleChatMessageLayoutRepair();
        });
        chatMessageLayoutResizeObserver.observe(messagesDiv);
      }
    }

    function createSharedChatMessageElement(text, role, isHtml, isSystemMessage) {
      var normalizedRole = role === 'user' ? 'user' : 'bot';
      var div = document.createElement('div');
      div.className = 'message ' + normalizedRole;
      var avatar = getMessageAvatarHtml(normalizedRole);
      var displayText = normalizedRole === 'bot' ? stripDecorativeAiIcons(text) : text;
      var useAgentTranscript = normalizedRole === 'bot' && !isHtml && isAgentTranscriptText(displayText);
      var content = isHtml ? displayText : (normalizedRole === 'bot'
        ? renderBotMessageContent(displayText, { allowAgentTranscript: true, final: true })
        : formatMessage(displayText));
      
      var footer = normalizedRole === 'bot'
        ? renderMessageFooter(!isSystemMessage)
        : renderUserMessageFooter();
      div.innerHTML = '<div class="avatar ' + normalizedRole + '">' + avatar + '</div><div class="content">' + content + footer + '</div>';
      syncMessageLocalFileVisibilityClass(div);
      if (useAgentTranscript) {
        var contentDiv = div.querySelector('.content');
        if (contentDiv) {
          contentDiv.classList.add('agent-transcript-content');
          scrollAgentTranscriptLogsToBottom(contentDiv);
        }
      }
      return div;
    }

    function appendMessage(text, role, isHtml, isSystemMessage) {
      var normalizedRole = role === 'user' ? 'user' : 'bot';
      var stickToBottom = normalizedRole === 'user' || shouldAutoScrollChat();
      var div = createSharedChatMessageElement(text, normalizedRole, isHtml, isSystemMessage);
      messagesDiv.appendChild(div);
      ensureChatMessageLayoutGuard();
      scheduleChatMessageLayoutRepair(div);
      initWorkspaceImageStacks(div);
      if (normalizedRole === 'bot' && !isSystemMessage && isGenerating) {
        attachMainChatPiQueuePanelToMessage(div);
      }
      if (normalizedRole === 'user') {
        div.setAttribute('data-query-nav-text', normalizeQueryNavText(text));
        queryNavPinnedMessageId = ensureQueryNavMessageId(div);
      }
      scheduleQueryNavRender();
      maybeScrollChatToBottom(stickToBottom);
      return div;
    }

    function parseFrontendUiActionAttributes(raw) {
      var attrs = {};
      String(raw || '').replace(/([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g, function(_match, key, doubleQuoted, singleQuoted, bare) {
        attrs[String(key || '').toLowerCase()] = String(doubleQuoted ?? singleQuoted ?? bare ?? '').trim();
        return '';
      });
      return attrs;
    }

    function openWorkspaceDirectoryPanelFromAiAction() {
      var panel = document.getElementById('workspaceDirectoryPanel');
      if (panel && !panel.classList.contains('open')) {
        toggleWorkspaceDirectoryPanel({ stopPropagation: function() {} });
      } else {
        renderWorkspaceDirectoryUi();
      }
    }

    async function setPersistentSkillsFromAiAction(rawSkillIds) {
      var requestedIds = String(rawSkillIds || '').split(',').map(function(id) {
        return String(id || '').trim();
      }).filter(Boolean);
      if (!requestedIds.length) throw new Error('没有提供要持续使用的 Skill id');
      await fetchAvailableAgentSkills();
      var tokens = [];
      var labels = [];
      requestedIds.forEach(function(requestedId) {
        var descriptor = availableAgentSkills.find(function(skill) {
          return skill && String(skill.id || '') === requestedId;
        });
        if (!descriptor) return;
        if (descriptor.source === 'user' && requestedId.indexOf('user:') === 0) {
          tokens.push('user:' + requestedId.slice(5));
        } else if (descriptor.source === 'bundled') {
          tokens.push('agent:' + requestedId);
        }
        labels.push(descriptor.name || requestedId);
      });
      if (!tokens.length) throw new Error('没有找到可持续使用的 Skill');
      saveMainContextSkillSelection(loadMainContextSkillSelection().concat(tokens));
      renderMainContextSourceBar();
      appendMessage('已加入持续使用 Skill：' + labels.join('、') + '。之后每轮主对话都会自动附加这些规则。', 'bot', false, true);
    }
    window.setPersistentSkillsFromAiAction = setPersistentSkillsFromAiAction;

    function executeFrontendUiAction(actionId, attrs) {
      var action = String(actionId || '').trim();
      if (!action) return false;
      attrs = attrs && typeof attrs === 'object' ? attrs : {};
      try {
        if (action === 'open_right_article') {
          setRightSidebarTab('article');
        } else if (action === 'open_right_discussion') {
          openArticleWritingProgressPanel();
        } else if (action === 'refresh_article_draft') {
          refreshArticleWritingProgress();
        } else if (action === 'open_draft' && typeof window.showDraftDialog === 'function') {
          window.showDraftDialog();
        } else if (action === 'open_memory' && typeof window.showClearMemoryDialog === 'function') {
          window.showClearMemoryDialog();
        } else if (action === 'open_config' && typeof window.showConfigCenterDialog === 'function') {
          window.showConfigCenterDialog();
        } else if (action === 'open_secondary_config' && typeof window.openAiGuidedConfig === 'function') {
          window.openAiGuidedConfig('secondary');
        } else if (action === 'open_primary_config' && typeof window.openAiGuidedConfig === 'function') {
          window.openAiGuidedConfig('primary');
        } else if (action === 'open_embedding_config' && typeof window.openAiGuidedConfig === 'function') {
          window.openAiGuidedConfig('embedding');
        } else if (action === 'open_vendor_config' && typeof window.openVendorConfigBrowser === 'function') {
          window.openVendorConfigBrowser(attrs.vendor_id || attrs.provider_id || attrs.provider || '');
        } else if (action === 'open_codex_config' && typeof window.openAiCodexConfiguration === 'function') {
          window.openAiCodexConfiguration();
        } else if (action === 'open_skill_config' && typeof window.openAiConfigurationSkillPage === 'function') {
          window.openAiConfigurationSkillPage();
        } else if (action === 'set_persistent_skills') {
          setPersistentSkillsFromAiAction(attrs.skill_ids || attrs.skills || '').catch(function(error) {
            appendMessage('持续使用 Skill 配置失败：' + (error.message || String(error)), 'bot', false, true);
          });
        } else if (action === 'open_runtime_plugins' && typeof window.showRuntimePluginConfigDialog === 'function') {
          window.showRuntimePluginConfigDialog();
        } else if (action === 'open_r_plot' && typeof window.showRPlotDialog === 'function') {
          window.showRPlotDialog();
        } else if (action === 'open_workspace_panel') {
          openWorkspaceDirectoryPanelFromAiAction();
        } else if (action === 'upload_literature' && typeof window.uploadLiteratureFromAiConfiguration === 'function') {
          window.uploadLiteratureFromAiConfiguration();
        } else if (action === 'upload_pdf_wiki' && typeof window.triggerPdfWikiUpload === 'function') {
          window.triggerPdfWikiUpload();
        } else {
          console.warn('[FrontendState] Unsupported UI action:', action);
          return false;
        }
        console.log('[FrontendState] Executed UI action:', action);
        return true;
      } catch (error) {
        console.warn('[FrontendState] UI action failed:', action, error);
        return false;
      }
    }

    function executeFrontendUiActionsFromAiResponse(text) {
      var response = String(text || '');
      var tagRegex = /<scholar-harness-ui-action\b([^>]*?)(?:>\s*<\/scholar-harness-ui-action\s*>|\/>)/gi;
      return response.replace(tagRegex, function(match, rawAttrs) {
        var attrs = parseFrontendUiActionAttributes(rawAttrs || '');
        var action = attrs.action || attrs.id || attrs.name || '';
        executeFrontendUiAction(action, attrs);
        return '';
      }).replace(/\n{3,}/g, '\n\n').trim();
    }
    window.executeFrontendUiActionsFromAiResponse = executeFrontendUiActionsFromAiResponse;
    
    function legacyWriteClipboardText(text) {
      var textarea = document.createElement('textarea');
      var activeElement = document.activeElement;
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.setAttribute('aria-hidden', 'true');
      textarea.style.position = 'fixed';
      textarea.style.left = '-10000px';
      textarea.style.top = '0';
      textarea.style.width = '1px';
      textarea.style.height = '1px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus({ preventScroll: true });
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      var copied = false;
      try {
        copied = document.execCommand('copy');
      } catch (error) {
        copied = false;
      }
      textarea.remove();
      if (activeElement && typeof activeElement.focus === 'function') {
        try {
          activeElement.focus({ preventScroll: true });
        } catch (error) {
          activeElement.focus();
        }
      }
      return copied;
    }

    async function writeTextToSystemClipboard(value) {
      var text = String(value || '');
      if (!text) return { success: false, error: '没有可复制的内容' };

      if (window.electronAPI && typeof window.electronAPI.writeClipboardText === 'function') {
        try {
          var electronResult = await window.electronAPI.writeClipboardText(text);
          if (electronResult && electronResult.success) return { success: true, method: 'electron' };
        } catch (error) {
          console.warn('[Clipboard] Electron clipboard bridge failed, using fallback:', error);
        }
      }

      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
          await navigator.clipboard.writeText(text);
          return { success: true, method: 'navigator' };
        } catch (error) {
          console.warn('[Clipboard] navigator.clipboard denied, using legacy fallback:', error);
        }
      }

      if (legacyWriteClipboardText(text)) {
        return { success: true, method: 'legacy' };
      }
      return { success: false, error: '系统拒绝写入剪贴板，请选中文字后按 Ctrl+C' };
    }
    window.writeTextToSystemClipboard = writeTextToSystemClipboard;

    // 复制消息
    window.copyMessage = async function(btn) {
      var contentDiv = btn.closest('.content');
      var textContent = getCleanMessageText(contentDiv);
      var originalHtml = btn.innerHTML;
      var result = await writeTextToSystemClipboard(textContent.trim());
      if (result.success) {
        btn.classList.add('is-copied');
        btn.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        btn.title = '已复制';
        setTimeout(function() {
          btn.classList.remove('is-copied');
          btn.innerHTML = originalHtml;
          btn.title = '复制消息';
        }, 2000);
        return;
      }
      btn.classList.remove('is-copied');
      btn.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#b42318" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
      btn.title = result.error || '复制失败';
      setTimeout(function() {
        btn.innerHTML = originalHtml;
        btn.title = '复制消息';
      }, 2400);
    };
    
    // 分享消息
    window.shareMessage = function(btn) {
      var contentDiv = btn.closest('.content');
      var textContent = getCleanMessageText(contentDiv);
      var shareText = textContent.trim();
      
      // 检测是否在微信中
      var isWechat = /MicroMessenger/i.test(navigator.userAgent);
      
      // 微信不支持标准 share API，直接复制
      if (isWechat || !navigator.share) {
        navigator.clipboard.writeText(shareText).then(function() {
          btn.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#10a37f" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
          setTimeout(function() {
            btn.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>';
          }, 2000);
          if (isWechat) {
            alert('已复制到剪贴板！\n请长按输入框粘贴分享给好友');
          } else {
            alert('已复制到剪贴板，可粘贴分享');
          }
        }).catch(function(e) {
          // 降级：使用旧式复制方法
          var textarea = document.createElement('textarea');
          textarea.value = shareText;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          try {
            document.execCommand('copy');
            alert(isWechat ? '已复制！请长按输入框粘贴分享' : '已复制到剪贴板');
          } catch (err) {
            alert('复制失败，请手动选择文本复制');
          }
          document.body.removeChild(textarea);
        });
      } else {
        // 非微信环境，使用系统分享
        navigator.share({
          title: 'Scholar Harness 对话',
          text: shareText.substring(0, 2000)
        }).catch(function(e) {
          // 分享取消或失败，降级为复制
          navigator.clipboard.writeText(shareText).then(function() {
            alert('已复制到剪贴板，可粘贴分享');
          });
        });
      }
    };
    
    // 从消息生成检索词
    window.generateKeywordsFromMessage = async function(btn) {
      var contentDiv = btn.closest('.content');
      var textContent = '';
      
      // 获取纯文本内容（排除按钮）
      textContent = getRetrievalMessageText(contentDiv);
      
      btn.innerHTML = '<svg class="gear-icon active" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform-origin:center;animation:gear-spin 1s linear infinite;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
      btn.disabled = true;
      
      try {
        console.log('[Keywords] Starting detection, text length:', textContent.length);
        
        var response = await fetch('/api/retrieval/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: textContent.substring(0, 12000),
            context: '',
            userId: currentUserId,
            forceGenerate: true
          })
        });
        
        var result = await response.json();
        console.log('[Keywords] Detection result:', result);
        
        if (!result.success) {
          // API 错误
          var errorMsg = result.error || '未知错误';
          console.error('[Keywords] API error:', errorMsg);
          
          if (errorMsg.includes('API未配置')) {
            appendMessage('⚠️ 请先配置 API 设置（左下角 ⚙️ API 设置）', 'bot', false, true);
          } else {
            appendMessage('❌ 检索词生成失败: ' + errorMsg, 'bot', false, true);
          }
          
          btn.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
          setTimeout(function() { 
            btn.innerHTML = '<svg class="gear-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
            btn.disabled = false;
          }, 2000);
          return;
        }
        
        if (result.success && result.need_retrieval && result.points && result.points.length > 0) {
          currentRetrievalData = {
            points: result.points,
            reason: result.reason,
            literatureCount: result.literatureCount || 0,
            pdfWikiCount: result.pdfWikiCount || 0,
            libraries: result.libraries || null,
            librarySource: null,
            librarySources: []
          };
          
          showRetrievalModal(result);
          btn.innerHTML = '<svg class="gear-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
          btn.disabled = false;
        } else {
          // AI 判断不需要检索
          var reason = result.reason || '该内容不需要文献检索支撑';
          console.log('[Keywords] No retrieval needed:', reason);
          
          appendMessage('💡 ' + reason + '\n\n如果确实需要检索，可以手动输入检索词后发送消息。', 'bot', false, true);
          
          btn.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
          setTimeout(function() { 
            btn.innerHTML = '<svg class="gear-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
            btn.disabled = false;
          }, 2000);
        }
      } catch (e) {
        console.error('[Keywords] Error:', e);
        appendMessage('❌ 检索词生成出错: ' + e.message, 'bot', false, true);
        btn.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        setTimeout(function() { 
          btn.innerHTML = '<svg class="gear-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
          btn.disabled = false;
        }, 2000);
      }
    };
    
    function findSourceUserQueryForDraftMessage(button) {
      var messageEl = button && button.closest ? button.closest('.message') : null;
      var cursor = messageEl ? messageEl.previousElementSibling : null;
      while (cursor) {
        if (cursor.classList && cursor.classList.contains('message') && cursor.classList.contains('user')) {
          return getMessageTextForQueryNav(cursor).slice(0, 4000);
        }
        cursor = cursor.previousElementSibling;
      }
      return '';
    }

    function buildSmartDraftSaveContext(button, preferredSection) {
      var selectedChapterKeys = getSelectedArticleQuestionChapterState();
      var availableChapters = [];
      try {
        availableChapters = getArticleDraftChapterTargets({ includeSelectedVisible: true }).slice(0, 20);
      } catch (e) {}
      var writingProgress = getArticleWritingProgressSnapshot();
      var writingTarget = writingProgress.activeTarget;
      var preferredChapterKey = writingTarget ? writingTarget.chapterKey : String(preferredSection || '').trim();
      return {
        preferredChapterKey: preferredChapterKey,
        preferredSection: preferredChapterKey,
        writingTarget: writingTarget,
        writingProgress: writingProgress,
        selectedChapterKeys: selectedChapterKeys,
        sourceUserQuery: findSourceUserQueryForDraftMessage(button),
        availableChapters: availableChapters,
        rightSidebarTab: getRightSidebarActiveTab()
      };
    }

    var pendingSmartDraftSectionSelection = null;

    function showSmartDraftSectionSelectionDialog(result, originalContent, smartContext) {
      pendingSmartDraftSectionSelection = {
        content: originalContent,
        context: smartContext || {}
      };
      var suggested = String(result.suggestedSection || '');
      var options = Array.isArray(result.options) ? result.options : [];
      var reason = result.classification && result.classification.reason
        ? result.classification.reason
        : (result.error || '当前内容同时具有多个章节特征');
      var html = '<div style="padding:4px 2px 2px;text-align:left;">' +
        '<div style="font-size:13px;line-height:1.65;color:var(--text-secondary);margin-bottom:12px;">系统没有强行保存，因为章节判断不够可靠。' + escapeHtml(reason) + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">' +
          options.map(function(option) {
            var section = String(option.key || option.section || '');
            var active = section === suggested;
            return '<button type="button" onclick="confirmSmartDraftSectionSelection(decodeURIComponent(\'' + encodeURIComponent(section) + '\'))" ' +
              'style="min-height:42px;padding:8px 10px;border:1px solid ' + (active ? 'var(--text-primary)' : 'var(--border-color)') + ';border-radius:7px;background:transparent;color:var(--text-primary);cursor:pointer;text-align:left;font-size:12px;font-weight:700;">' +
              escapeHtml(option.label || section) + (active ? '<span style="display:block;margin-top:2px;color:var(--text-secondary);font-size:10px;font-weight:500;">系统建议</span>' : '') +
              '</button>';
          }).join('') +
        '</div>' +
        '<div class="btns" style="margin-top:12px;"><button class="cancel" onclick="closeModal()">取消，不保存</button></div>' +
      '</div>';
      showModal('请选择草稿章节', html, false, false);
    }
    window.showSmartDraftSectionSelectionDialog = showSmartDraftSectionSelectionDialog;

    window.confirmSmartDraftSectionSelection = async function(section) {
      var pending = pendingSmartDraftSectionSelection;
      if (!pending || !pending.content) return;
      closeModal();
      try {
        var response = await fetch('/api/draft/' + encodeURIComponent(currentUserId || 'web-user') + '/smart-save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: pending.content,
            context: Object.assign({}, pending.context || {}, {
              preferredChapterKey: section,
              preferredSection: section
            }),
            apiUrl: apiConfig.url,
            apiKey: apiConfig.key,
            model: currentModel
          })
        });
        var saveResult = await response.json();
        if (saveResult.success) {
          invalidateArticleDraftProgressCache();
          appendMessage('✅ 已按你的选择保存到「' + (saveResult.sectionName || section) + '」章节。', 'bot', false, true);
        } else if (saveResult.needsConfirmation) {
          showDraftConfirmDialog(saveResult, pending.content, Object.assign({}, pending.context || {}, {
            preferredChapterKey: section,
            preferredSection: section
          }));
        } else {
          throw new Error(saveResult.error || '保存失败');
        }
      } catch (error) {
        appendMessage('❌ 草稿保存失败：' + (error.message || error), 'bot', false, true);
      } finally {
        pendingSmartDraftSectionSelection = null;
      }
    };

    // 从消息保存到草稿（AI 智能处理）
    window.saveMessageToDraft = async function(btn) {
      var contentDiv = btn.closest('.content');
      var textContent = '';
      
      // 获取纯文本内容（排除按钮）
      textContent = getCleanMessageText(contentDiv);
      
      if (!textContent.trim()) {
        alert('消息内容为空，无法保存');
        return;
      }

      // 检查API配置
      if (!apiConfig.url || !apiConfig.key) {
        alert('请先配置 API 设置\n\n请点击左下角 API 设置，配置您的 API 地址和密钥。');
        return;
      }
      
      // 显示图标变化（AI 处理中）
      btn.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#10a37f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite;"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
      btn.disabled = true;
      var smartDraftContext = buildSmartDraftSaveContext(btn, '');
      
      try {
        // 调用 AI 智能处理 API，传递用户配置的API信息
        var response = await fetch('/api/draft/' + currentUserId + '/smart-save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: textContent.trim(),
            context: smartDraftContext,
            apiUrl: apiConfig.url,
            apiKey: apiConfig.key,
            model: currentModel
          })
        });
        
        var result = await response.json();
        
        if (result.success) {
          invalidateArticleDraftProgressCache();
          // 显示成功状态
          btn.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#10a37f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
          
          // 2秒后恢复图标
          setTimeout(function() {
            btn.innerHTML = '<svg class="save-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>';
            btn.disabled = false;
          }, 2000);
          
          // 显示提示消息（包含使用的API信息）
          var targetSource = result.classification && result.classification.source ? result.classification.source : '';
          var successMsg = '✅ ' + (result.createdChapter ? '已创建章节并保存到「' : '已保存到「') + result.sectionName + '」' + (result.subsectionTitle ? ' / 「' + result.subsectionTitle + '」' : '');
          successMsg += targetSource === 'manual-lock' ? '\n\n保存目标：右侧手动锁定' : '\n\n保存目标：AI 自动识别';
          if (result.apiUsed) {
            successMsg += '\n\n💡 使用 API: ' + result.apiUsed.url + '\n🤖 模型: ' + result.apiUsed.model;
          }
          appendMessage(successMsg, 'bot', false, true);
        } else if (result.needsSectionSelection) {
          btn.innerHTML = '<svg class="save-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>';
          btn.disabled = false;
          showSmartDraftSectionSelectionDialog(result, textContent.trim(), smartDraftContext);
        } else if (result.needsConfirmation) {
          // ====== 检测到重复，需要用户确认 ======
          btn.innerHTML = '<svg class="save-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>';
          btn.disabled = false;
          
          // 显示确认弹窗
          showDraftConfirmDialog(result, textContent.trim(), smartDraftContext);
        } else {
          throw new Error(result.error || '保存失败');
        }
      } catch (e) {
        btn.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>';
        setTimeout(function() {
          btn.innerHTML = '<svg class="save-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>';
          btn.disabled = false;
        }, 2000);
        alert('保存失败: ' + e.message);
      }
    };
    
    // 自动识别章节
    function detectSection(text) {
      var lowerText = text.toLowerCase();
      
      // 章节关键词匹配
      var sectionPatterns = [
        { section: 'abstract', keywords: ['abstract', '摘要', 'summary'] },
        { section: 'introduction', keywords: ['introduction', '引言', 'background', '背景', '研究背景'] },
        { section: 'methods', keywords: ['methods', 'methodology', '材料与方法', '方法', 'experimental', '实验方法', 'materials and methods'] },
        { section: 'results', keywords: ['results', '结果', 'findings', '研究发现', '实验结果'] },
        { section: 'discussion', keywords: ['discussion', '讨论', 'implications', '意义'] },
        { section: 'conclusion', keywords: ['conclusion', 'conclusions', '结论', '总结'] },
        { section: 'acknowledgments', keywords: ['acknowledgment', 'acknowledgments', '致谢', '感谢'] },
        { section: 'references', keywords: ['references', '参考文献', 'bibliography', 'literature cited'] }
      ];
      
      // 检查文本开头部分（前500字符）
      var headerText = lowerText.substring(0, 500);
      
      for (var pattern of sectionPatterns) {
        for (var keyword of pattern.keywords) {
          // 检查是否以该关键词开头或包含 "## 关键词" 格式
          if (headerText.startsWith(keyword) || 
              headerText.includes('## ' + keyword) ||
              headerText.includes('##' + keyword) ||
              headerText.includes('**' + keyword + '**')) {
            return pattern.section;
          }
        }
      }
      
      // 检查整个文本中的关键词密度
      var maxMatches = 0;
      var bestSection = 'results'; // 默认为结果部分
      
      for (var pattern of sectionPatterns) {
        var matches = 0;
        for (var keyword of pattern.keywords) {
          var regex = new RegExp(keyword, 'gi');
          var found = lowerText.match(regex);
          if (found) matches += found.length;
        }
        if (matches > maxMatches) {
          maxMatches = matches;
          bestSection = pattern.section;
        }
      }
      
      return bestSection;
    }
    
    // 获取章节显示名称
    function getSectionDisplayName(section) {
      var names = {
        'abstract': '摘要',
        'introduction': '引言',
        'methods': '材料与方法',
        'results': '结果',
        'discussion': '讨论',
        'conclusion': '结论',
        'acknowledgments': '致谢',
        'references': '参考文献'
      };
      return names[section] || section;
    }
    
    // 显示检索模态框
    function showRetrievalModal(detectionResult) {
      prepareStandaloneWorkspaceSurface('retrievalModal');
      var existingModal = document.getElementById('retrievalModal');
      if (existingModal) existingModal.remove();
      
      var modal = document.createElement('div');
      modal.id = 'retrievalModal';
      modal.className = 'app-secondary-overlay';
      modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';
      
      var keywords = detectionResult.points.flatMap(p => p.keywords_en || []);
      var labels = getProjectUiLabels();
      var evidenceName = getProjectEvidenceItemName();
      var libraries = detectionResult.libraries || {
        abstract: { available: (detectionResult.literatureCount || 0) > 0, count: detectionResult.literatureCount || 0, label: labels.embeddingLibrary },
        pdfWiki: { available: false, count: detectionResult.pdfWikiCount || 0, status: 'idle', message: '未生成 PDF Wiki', label: 'PDF 论点库' }
      };
      var abstractLibrary = libraries.abstract || { available: false, count: 0, label: labels.embeddingLibrary };
      var pdfWikiLibrary = libraries.pdfWiki || { available: false, count: 0, status: 'idle', message: '未生成 PDF Wiki', label: 'PDF 论点库' };
      var abstractDisabled = abstractLibrary.available ? '' : 'disabled';
      var pdfWikiDisabled = pdfWikiLibrary.available ? '' : 'disabled';
      var abstractClick = abstractLibrary.available ? "toggleRetrievalLibrary('abstract')" : 'return false';
      var pdfWikiClick = pdfWikiLibrary.available ? "toggleRetrievalLibrary('pdfWiki')" : 'return false';
      var pdfWikiStatusText = pdfWikiLibrary.available
        ? ('可检索 ' + (pdfWikiLibrary.sentencePointCount || pdfWikiLibrary.count || 0) + ' 个可作论点句子')
        : (pdfWikiLibrary.status === 'processing' ? ('正在生成：' + (pdfWikiLibrary.message || '请稍后')) : (pdfWikiLibrary.message || '未生成 PDF Wiki'));
      var rebuildPdfWikiHtml = (!pdfWikiLibrary.available && pdfWikiLibrary.status !== 'processing')
        ? '<button type="button" onclick="rebuildPdfWikiLibrary()" style="margin-top:8px;padding:7px 12px;border:1px solid var(--border-color);background:transparent;color:var(--text-primary);border-radius:6px;cursor:pointer;font-size:12px;">重建 PDF Wiki</button>'
        : '';
      
      modal.innerHTML = `
        <div id="retrievalModalPanel" style="background:var(--bg-primary);border-radius:12px;max-width:700px;width:90%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
          <div style="padding:20px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <h3 style="margin:0;color:var(--text-primary);display:flex;align-items:center;gap:10px;">
              <span style="font-size:24px;">🐄</span>
              小牛马检测到需要${evidenceName}支撑的内容
            </h3>
            <button id="retrievalModalFullscreenBtn" class="modal-icon-btn" type="button" onclick="toggleCustomModalFullscreen('retrievalModal','retrievalModalPanel','retrievalModalFullscreenBtn')" title="全屏" aria-label="全屏">
              <svg class="ui-icon sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5"></path><path d="M16 3h5v5"></path><path d="M21 16v5h-5"></path><path d="M3 16v5h5"></path></svg>
            </button>
          </div>
          
          <div style="padding:20px;">
            <div style="margin-bottom:16px;">
              <h4 style="margin:0 0 8px 0;color:var(--text-secondary);font-size:14px;">📋 提取的论点：</h4>
              ${detectionResult.points.map((p, i) => `
                <div style="padding:10px;background:var(--bg-secondary);border-radius:6px;margin-bottom:8px;">
                  <span style="color:var(--text-primary);">${i+1}. ${p.sentence}</span>
                </div>
              `).join('')}
            </div>
            
            <div style="margin-bottom:16px;">
              <h4 style="margin:0 0 8px 0;color:var(--text-secondary);font-size:14px;">🔍 检索词：</h4>
              <div style="display:flex;flex-wrap:wrap;gap:8px;">
                ${keywords.map(k => `<span style="background:var(--bg-secondary);color:var(--text-secondary);padding:4px 12px;border-radius:16px;font-size:13px;border:1px solid var(--border-color);">${k}</span>`).join('')}
              </div>
            </div>

            <div style="margin-bottom:16px;">
              <h4 style="margin:0 0 8px 0;color:var(--text-secondary);font-size:14px;">选择检索库：</h4>
              <div id="retrievalLibraryOptions" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <button type="button" data-library-source="abstract" ${abstractDisabled} onclick="${abstractClick}" style="text-align:left;padding:12px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);border-radius:8px;cursor:${abstractLibrary.available ? 'pointer' : 'not-allowed'};opacity:${abstractLibrary.available ? '1' : '0.55'};">
                  <div style="font-weight:600;margin-bottom:4px;">${labels.embeddingLibrary}</div>
                  <div style="font-size:12px;color:var(--text-secondary);">基于标题、摘要、关键词和 embedding，${abstractLibrary.count || 0} 条</div>
                </button>
                <button type="button" data-library-source="pdfWiki" ${pdfWikiDisabled} onclick="${pdfWikiClick}" style="text-align:left;padding:12px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);border-radius:8px;cursor:${pdfWikiLibrary.available ? 'pointer' : 'not-allowed'};opacity:${pdfWikiLibrary.available ? '1' : '0.55'};">
                  <div style="font-weight:600;margin-bottom:4px;">PDF 论点库</div>
                  <div style="font-size:12px;color:var(--text-secondary);">基于引言/讨论的显式引用句、结论原句、来源论文信息和文末参考文献，${pdfWikiStatusText}</div>
                </button>
              </div>
              ${rebuildPdfWikiHtml}
              <div id="retrievalLibraryHint" style="margin-top:8px;color:var(--text-secondary);font-size:12px;">可以选择一个或同时选择两个检索库。</div>
            </div>
            
            <div style="padding:12px;background:var(--bg-secondary);border-radius:6px;margin-bottom:16px;">
              <span style="color:var(--text-secondary);font-size:13px;">💡 ${detectionResult.reason}</span>
            </div>
          </div>
          
          <div style="padding:20px;border-top:1px solid var(--border-color);display:flex;gap:12px;justify-content:center;">
            <button onclick="cancelRetrieval()" style="padding:10px 20px;border:none;background:#E6F4F8;color:#333;border-radius:6px;cursor:pointer;">取消</button>
            <button onclick="editRetrievalKeywords()" style="padding:10px 20px;border:none;background:#E6F4F8;color:#333;border-radius:6px;cursor:pointer;">编辑检索词</button>
            <button id="confirmRetrievalBtn" onclick="executeRetrievalAndSend()" disabled style="padding:10px 20px;border:none;background:#B8DDE8;color:#333;border-radius:6px;cursor:not-allowed;font-weight:600;opacity:0.55;">确认检索词</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
    }

    function getSelectedRetrievalLibrarySources() {
      if (!currentRetrievalData) return [];
      if (Array.isArray(currentRetrievalData.librarySources)) {
        return currentRetrievalData.librarySources;
      }
      return currentRetrievalData.librarySource ? [currentRetrievalData.librarySource] : [];
    }

    window.toggleRetrievalLibrary = function(source) {
      if (!currentRetrievalData) return;
      var selected = getSelectedRetrievalLibrarySources().slice();
      var index = selected.indexOf(source);
      if (index >= 0) selected.splice(index, 1);
      else selected.push(source);
      currentRetrievalData.librarySources = selected;
      currentRetrievalData.librarySource = selected[0] || null;

      var modal = document.getElementById('retrievalModal');
      if (!modal) return;

      var buttons = modal.querySelectorAll('[data-library-source]');
      buttons.forEach(function(button) {
        var isSelected = selected.indexOf(button.getAttribute('data-library-source')) !== -1;
        button.style.borderColor = isSelected ? 'var(--accent-color)' : 'var(--border-color)';
        button.style.background = isSelected ? 'rgba(16, 163, 127, 0.12)' : 'var(--bg-secondary)';
      });

      var hint = document.getElementById('retrievalLibraryHint');
      if (hint) {
        if (selected.length === 0) {
          hint.textContent = '可以选择一个或同时选择两个检索库。';
          hint.style.color = 'var(--text-secondary)';
        } else {
          var labels = selected.map(function(item) {
            return item === 'pdfWiki' ? 'PDF 论点库' : getProjectUiLabels().embeddingLibrary;
          });
          hint.textContent = '将使用：' + labels.join(' + ') + '。';
          hint.style.color = 'var(--accent-color)';
        }
      }

      var confirmBtn = document.getElementById('confirmRetrievalBtn');
      if (confirmBtn) {
        confirmBtn.disabled = selected.length === 0;
        confirmBtn.style.cursor = selected.length === 0 ? 'not-allowed' : 'pointer';
        confirmBtn.style.opacity = selected.length === 0 ? '0.55' : '1';
      }
    };

    window.selectRetrievalLibrary = window.toggleRetrievalLibrary;

    window.rebuildPdfWikiLibrary = async function() {
      try {
        var taskOptions = getDefaultPdfWikiUploadOptions();
        var response = await fetch('/api/pdf-wiki/rebuild', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            pdfWikiTextExtractionEngine: taskOptions.textExtractionEngine || 'auto',
            pdfWikiMetadataEngine: taskOptions.metadataEngine || 'auto',
            pdfWikiClaimExtractionEngine: taskOptions.claimExtractionEngine || 'auto',
            pdfWikiSentenceReferenceMatchingEngine: taskOptions.sentenceReferenceMatchingEngine || 'auto',
            pdfWikiGroupingEngine: taskOptions.groupingEngine || 'auto',
            pdfWikiMetaAnalysisEnabled: taskOptions.metaAnalysisEnabled === false ? 'false' : 'true',
            pdfWikiMetaAnalysisEngine: taskOptions.metaAnalysisEnabled === false ? 'off' : (taskOptions.metaAnalysisEngine || 'auto'),
            pdfWikiMetaAnalysisUserRequirements: getPdfWikiMetaUserRequirementsForRequest()
          })
        });
        var result = await response.json();
        if (result.success) {
          appendMessage('PDF Wiki 已开始后台重建，完成后再次点击齿轮即可选择 PDF 论点库。\n\n⏳ 深入分析耗时较长，请耐心等待；如果 PDF 较多，可以在配置页面增加 Codex CLI 的并发数量。', 'bot', false, true);
          cancelRetrieval();
        } else {
          alert('重建 PDF Wiki 失败: ' + (result.error || '未知错误'));
        }
      } catch (e) {
        alert('重建 PDF Wiki 出错: ' + e.message);
      }
    };
    
    function saveMessages(userId, messages) {
      localStorage.setItem(MSG_KEY + userId, JSON.stringify(messages));
    }
    
    fetch('/api/model').then(function(r){return r.json()}).then(function(d){
      currentModel = d.model || currentModel;
      updateModelBadge();
    });
    
    var literatureLoadController = null;
    var literatureLoadSequence = 0;
    var literatureLoadRetryTimer = null;

    function loadLiteratureFromServer(options) {
      var settings = options || {};
      var retryAttempt = Math.max(0, Number(settings.retryAttempt || 0));
      var preserveChatState = settings.preserveChatState === true;
      var emptyState = document.getElementById('emptyState');
      var labels = getProjectUiLabels();
      var evidenceName = getProjectEvidenceItemName();
      if (!emptyState) return;
      if (literatureLoadRetryTimer) {
        clearTimeout(literatureLoadRetryTimer);
        literatureLoadRetryTimer = null;
      }
      if (literatureLoadController) {
        try { literatureLoadController.abort(); } catch (e) {}
      }
      var requestId = ++literatureLoadSequence;
      var requestedUserId = String(currentUserId || 'web-user');
      var requestedConversationId = String(currentConversationId || '');
      if (retryAttempt === 0 && !preserveChatState) {
        emptyState.innerHTML = BRAND_TITLE_HTML + GREETING_HTML;
      }

      var controller = new AbortController();
      literatureLoadController = controller;
      var timedOut = false;
      var timeoutId = setTimeout(function() {
        timedOut = true;
        try { controller.abort(); } catch (e) {}
      }, 15000);

      function isLatestLiteratureRequest() {
        return requestId === literatureLoadSequence
          && requestedUserId === String(currentUserId || 'web-user')
          && requestedConversationId === String(currentConversationId || '');
      }

      fetch('/api/literature/' + encodeURIComponent(requestedUserId) + '?summaryOnly=1', { signal: controller.signal }).then(function(r){
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function(d){
        if (!isLatestLiteratureRequest()) return;
        if (d.exists) {
          uploadedFiles = [{
            name: labels.embeddingLibrary,
            content: '',
            serverBacked: true,
            summary: d.summary || null
          }];
          renderFileList();
          if (!preserveChatState) {
            var chatAlreadyStarted = !!(
              messagesDiv
              && messagesDiv.querySelector('.message.user')
            );
            var existingLiteratureSummary = !!(
              messagesDiv
              && messagesDiv.querySelector('.literature-summary-message')
            );
            if (!existingLiteratureSummary) {
              emptyState.innerHTML = BRAND_TITLE_HTML + GREETING_HTML;
              showLitSummary(d.summary, d.journalStyles, {
                prependToConversation: chatAlreadyStarted
              });
            }
          }
        } else if (d.journalStyles && d.journalStyles.length > 0) {
          if (!preserveChatState) {
            emptyState.innerHTML = BRAND_TITLE_HTML + GREETING_HTML + '<p style="margin-top:12px;color:#8e8ea0;">暂无' + labels.embeddingLibrary + '，请上传' + evidenceName + '开始写作</p>';
            var msg = '📚 已分析' + labels.styleGroup + '：\n\n';
            msg += '📰 ' + d.journalStyles.join('\n📰 ') + '\n\n';
            msg += '💡 上传' + evidenceName + '后即可开始写作';
            appendMessage(msg, 'bot', false, true);
          }
        } else {
          if (!preserveChatState) {
            emptyState.innerHTML = BRAND_TITLE_HTML + GREETING_HTML + '<p style="margin-top:12px;color:#8e8ea0;">暂无' + labels.embeddingLibrary + '，请上传' + evidenceName + '开始写作</p>';
          }
        }
      }).catch(function(e){
        if (!isLatestLiteratureRequest()) return;
        console.log('[Literature] 加载失败:', e.message);
        if (preserveChatState) return;
        if (retryAttempt < 2) {
          literatureLoadRetryTimer = setTimeout(function() {
            if (!isLatestLiteratureRequest()) return;
            loadLiteratureFromServer({ retryAttempt: retryAttempt + 1 });
          }, 500 * (retryAttempt + 1));
          return;
        }
        console.warn('[Literature] 摘要后台加载未完成，不阻塞聊天界面。');
      }).finally(function() {
        clearTimeout(timeoutId);
        if (literatureLoadController === controller) literatureLoadController = null;
      });
    }
    window.loadLiteratureFromServer = loadLiteratureFromServer;

    window.showLoadedEmbeddingSources = function() {
      var labels = getProjectUiLabels();
      var evidenceName = getProjectEvidenceItemName();
      var localFiles = Array.isArray(uploadedFiles) && uploadedFiles.length
        ? uploadedFiles
        : getLitStorage(currentUserId || 'web-user');
      var rows = (localFiles || []).map(function(file, index) {
        var name = file && file.name ? file.name : (labels.embeddingLibrary + ' ' + (index + 1));
        var size = file && file.content ? String(file.content).length : 0;
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-color);">' +
          '<div style="min-width:0;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(name) + '</div>' +
          '<div style="flex:0 0 auto;color:var(--text-secondary);font-size:12px;">' + (size ? (size + ' 字符') : '已登记') + '</div>' +
        '</div>';
      }).join('');
      if (!rows) {
        rows = '<div style="padding:18px 0;color:var(--text-secondary);font-size:13px;">暂无本地已加载的' + escapeHtml(labels.embeddingLibrary) + '。请先上传' + escapeHtml(evidenceName) + '，或点击下方重新加载。</div>';
      }
      showModal(labels.embeddingLibrary, '' +
        '<div style="display:flex;flex-direction:column;gap:12px;">' +
          '<div style="padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);color:var(--text-secondary);font-size:13px;line-height:1.6;">' +
            '<div style="font-weight:700;color:var(--text-primary);margin-bottom:4px;">当前' + escapeHtml(labels.embeddingLibrary) + '</div>' +
            '<div>本窗口显示当前对话可用的' + escapeHtml(evidenceName) + '材料入口；如果一直显示加载中，可点击重新加载。</div>' +
          '</div>' +
          '<div style="border:1px solid var(--border-color);border-radius:8px;padding:4px 12px;background:var(--modal-bg);max-height:360px;overflow:auto;">' + rows + '</div>' +
          '<div class="btns">' +
            '<button class="cancel" onclick="closeModal()">关闭</button>' +
            '<button class="ok" onclick="closeModal(); loadLiteratureFromServer();">重新加载' + escapeHtml(labels.embeddingLibrary) + '</button>' +
          '</div>' +
        '</div>', true, false);
    };

    if (!window.showEmbeddingLibrary) {
      window.showEmbeddingLibrary = window.showLoadedEmbeddingSources;
    }

    function keepLiteratureSummaryAboveComposer(summaryMessage, attempt) {
      if (!summaryMessage || !summaryMessage.isConnected) return;
      var chatContainer = document.getElementById('chatContainer');
      if (!chatContainer) return;
      var inputContainer = document.getElementById('mainInputContainer');
      var chatRect = chatContainer.getBoundingClientRect();
      var inputRect = inputContainer ? inputContainer.getBoundingClientRect() : null;
      var composerHeight = inputRect ? Math.ceil(inputRect.height) : 0;
      var visibleBottom = inputRect && inputRect.height > 0
        ? inputRect.top - 12
        : chatRect.bottom - composerHeight - 12;
      var messageRect = summaryMessage.getBoundingClientRect();
      var coveredHeight = messageRect.bottom - visibleBottom;
      if (coveredHeight > 0) {
        chatContainer.scrollTop += coveredHeight;
      }
      var currentAttempt = Math.max(0, Number(attempt) || 0);
      if (currentAttempt < 3) {
        setTimeout(function() {
          requestAnimationFrame(function() {
            keepLiteratureSummaryAboveComposer(summaryMessage, currentAttempt + 1);
          });
        }, currentAttempt === 0 ? 60 : 120);
      }
    }
    
    function showLitSummary(summary, journalStyles, options) {
      var settings = options || {};
      emptyState.style.padding = '8px 40px 4px 40px';
      var labels = getProjectUiLabels();
      var evidenceName = getProjectEvidenceItemName();
      var msg = '📚 已加载' + labels.embeddingLibrary + '：\n';
      msg += '• ' + evidenceName + '数量: ' + summary.count + ' 条\n';
      if (summary.years.length > 0) {
        msg += '• 年份范围: ' + summary.years[0] + ' - ' + summary.years[summary.years.length - 1] + '\n';
      }
      if (summary.journals.length > 0) {
        msg += '• 涉及来源: ' + summary.journals.slice(0, 3).join(', ') + '\n';
      }
      if (summary.keywords.length > 0) {
        msg += '• 关键词: ' + summary.keywords.slice(0, 10).join(', ') + '\n';
      }
      if (journalStyles && journalStyles.length > 0) {
        msg += '\n📰 已分析' + labels.styleGroup + ': ' + journalStyles.join(', ');
      }
      var summaryMessage = appendMessage(msg, 'bot', false, true);
      if (summaryMessage) {
        summaryMessage.classList.add('literature-summary-message');
        if (settings.prependToConversation && messagesDiv.firstElementChild !== summaryMessage) {
          messagesDiv.insertBefore(summaryMessage, messagesDiv.firstElementChild);
          scheduleChatMessageLayoutRepair(summaryMessage);
        }
        requestAnimationFrame(function() {
          keepLiteratureSummaryAboveComposer(summaryMessage, 0);
        });
      }
    }

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('chat-history', { source: '/app/chat-history.js' });
}
