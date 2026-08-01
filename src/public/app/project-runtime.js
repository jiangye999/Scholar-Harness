    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      var k = 1024;
      var sizes = ['B', 'KB', 'MB', 'GB'];
      var i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    function getHistory() {
      var data = localStorage.getItem(STORAGE_KEY);
      if (!data) return [];
      try {
        var history = JSON.parse(data);
        return Array.isArray(history) ? history : [];
      } catch (e) {
        console.warn('[ConversationPersistence] 历史记录解析失败，已忽略损坏数据:', e);
        return [];
      }
    }
    
    function saveHistory(history) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    }

    function getDeletedConversationHistoryIds() {
      try {
        var ids = JSON.parse(localStorage.getItem(STORAGE_KEY + '_deleted') || '[]');
        return Array.isArray(ids) ? ids : [];
      } catch (e) {
        return [];
      }
    }

    function rememberDeletedConversationHistoryId(conversationId) {
      if (!conversationId) return;
      var ids = getDeletedConversationHistoryIds();
      if (ids.indexOf(conversationId) === -1) {
        ids.push(conversationId);
        localStorage.setItem(STORAGE_KEY + '_deleted', JSON.stringify(ids.slice(-500)));
      }
    }

    function createConversationId() {
      return 'conv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    }

    var BIBLIOMETRICS_CONVERSATION_PREFIX = 'bibliometrics-chat-';

    function createBibliometricsConversationId() {
      return BIBLIOMETRICS_CONVERSATION_PREFIX + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    }

    function isBibliometricsConversationId(conversationId) {
      return String(conversationId || '').indexOf(BIBLIOMETRICS_CONVERSATION_PREFIX) === 0;
    }

    function getBibliometricsConversationHistory() {
      return getHistory().filter(function(item) {
        return item && isBibliometricsConversationId(item.id);
      });
    }
    window.getBibliometricsConversationHistory = getBibliometricsConversationHistory;

    function ensureCurrentConversationId() {
      if (!currentConversationId) {
        currentConversationId = createConversationId();
        initializeWorkspaceDirectoryForConversation(currentConversationId, '');
      }
      return currentConversationId;
    }

    var conversationPersistTimers = Object.create(null);
    var conversationPersistChains = Object.create(null);
    var conversationLifecyclePersistenceBound = false;

    function getConversationStorageKey(conversationId) {
      return MSG_KEY + currentUserId + '_' + conversationId;
    }

    function readConversationMessagesLocal(conversationId) {
      if (!conversationId) return [];
      try {
        var messages = JSON.parse(localStorage.getItem(getConversationStorageKey(conversationId)) || '[]');
        return Array.isArray(messages) ? messages : [];
      } catch (e) {
        console.warn('[ConversationPersistence] 会话消息解析失败:', conversationId, e);
        return [];
      }
    }

    function getFirstConversationUserMessage(messages) {
      return (messages || []).find(function(message) {
        return message && message.role === 'user' && String(message.content || '').trim();
      }) || null;
    }

    function ensureConversationHistoryEntry(conversationId, messages, options) {
      if (!conversationId || !Array.isArray(messages) || messages.length === 0) return false;
      var firstUserMessage = getFirstConversationUserMessage(messages);
      if (!firstUserMessage) return false;

      var history = getHistory();
      if (history.some(function(item) { return item && item.id === conversationId; })) return false;

      history.unshift({
        id: conversationId,
        title: generateHistoryTitle(String(firstUserMessage.content || ''))
      });
      saveHistory(history);
      if (historyList && typeof renderHistory === 'function') renderHistory();

      if (!(options && options.skipAiTitle) && typeof generateAITitle === 'function') {
        generateAITitle(conversationId, String(firstUserMessage.content || ''));
      }
      return true;
    }

    function sendConversationPersistenceRequest(payload, options) {
      var requestOptions = options || {};
      var body = JSON.stringify(payload);

      if (requestOptions.preferBeacon && navigator && typeof navigator.sendBeacon === 'function' && typeof Blob !== 'undefined') {
        try {
          var accepted = navigator.sendBeacon(
            '/api/memory/save-conversation',
            new Blob([body], { type: 'application/json' })
          );
          if (accepted) {
            console.log('[ConversationPersistence] 已提交关闭前保存:', payload.conversationId);
            return Promise.resolve(true);
          }
        } catch (beaconError) {
          console.warn('[ConversationPersistence] sendBeacon 保存失败，尝试 keepalive:', beaconError);
        }
      }

      var fetchOptions = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body
      };
      if (requestOptions.keepalive) fetchOptions.keepalive = true;

      return fetch('/api/memory/save-conversation', fetchOptions)
        .then(function(response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          console.log('[ConversationPersistence] 会话已保存:', payload.conversationId, payload.messages.length);
          return true;
        })
        .catch(function(error) {
          console.warn('[ConversationPersistence] 服务端保存失败，本地副本仍保留:', payload.conversationId, error);
          return false;
        });
    }

    function persistConversationNow(conversationId, options) {
      var targetConversationId = conversationId || currentConversationId;
      var messages = readConversationMessagesLocal(targetConversationId);
      if (!targetConversationId || messages.length === 0) return Promise.resolve(false);

      if (conversationPersistTimers[targetConversationId]) {
        clearTimeout(conversationPersistTimers[targetConversationId]);
        delete conversationPersistTimers[targetConversationId];
      }
      ensureConversationHistoryEntry(targetConversationId, messages);

      var payload = {
        userId: currentUserId,
        conversationId: targetConversationId,
        messages: messages
      };
      if (options && options.preferBeacon) {
        return sendConversationPersistenceRequest(payload, options);
      }

      var previous = conversationPersistChains[targetConversationId] || Promise.resolve();
      var next = previous
        .catch(function() { return false; })
        .then(function() { return sendConversationPersistenceRequest(payload, options); });
      conversationPersistChains[targetConversationId] = next;
      return next;
    }

    function scheduleConversationPersistence(conversationId) {
      if (!conversationId) return;
      if (conversationPersistTimers[conversationId]) {
        clearTimeout(conversationPersistTimers[conversationId]);
      }
      conversationPersistTimers[conversationId] = setTimeout(function() {
        delete conversationPersistTimers[conversationId];
        persistConversationNow(conversationId);
      }, 350);
    }

    function storeConversationMessagesLocally(conversationId, messages, options) {
      if (!conversationId || !Array.isArray(messages)) return;
      var storedLocally = false;
      try {
        localStorage.setItem(getConversationStorageKey(conversationId), JSON.stringify(messages));
        storedLocally = true;
      } catch (error) {
        console.warn(
          '[ConversationPersistence] 会话体积超出本地缓存容量，继续使用服务端持久化:',
          conversationId,
          error
        );
      }
      ensureConversationHistoryEntry(conversationId, messages, options);
      if (!(options && options.skipServerPersistence)) {
        if (storedLocally) {
          scheduleConversationPersistence(conversationId);
        } else {
          sendConversationPersistenceRequest({
            userId: currentUserId,
            conversationId: conversationId,
            messages: messages
          });
        }
      }
    }

    function persistCurrentConversationForLifecycle() {
      var conversationId = currentConversationId;
      var messages = readConversationMessagesLocal(conversationId);
      if (!conversationId || messages.length === 0) return;
      ensureConversationHistoryEntry(conversationId, messages, { skipAiTitle: true });
      if (conversationPersistTimers[conversationId]) {
        clearTimeout(conversationPersistTimers[conversationId]);
        delete conversationPersistTimers[conversationId];
      }
      sendConversationPersistenceRequest({
        userId: currentUserId,
        conversationId: conversationId,
        messages: messages
      }, { preferBeacon: true, keepalive: true });
    }

    function bindConversationLifecyclePersistence() {
      if (conversationLifecyclePersistenceBound) return;
      conversationLifecyclePersistenceBound = true;
      window.addEventListener('pagehide', persistCurrentConversationForLifecycle);
      window.addEventListener('beforeunload', persistCurrentConversationForLifecycle);
      document.addEventListener('visibilitychange', function() {
        if (document.hidden) persistCurrentConversationForLifecycle();
      });
    }

    function recoverLocalConversationsIntoHistory() {
      var history = getHistory();
      var knownIds = Object.create(null);
      history.forEach(function(item) {
        if (item && item.id) knownIds[item.id] = true;
      });

      var prefix = MSG_KEY + currentUserId + '_';
      var recovered = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key.indexOf(prefix) !== 0) continue;
        var conversationId = key.substring(prefix.length);
        if (!conversationId || knownIds[conversationId]) continue;

        var messages = readConversationMessagesLocal(conversationId);
        var firstUserMessage = getFirstConversationUserMessage(messages);
        if (!firstUserMessage) continue;
        var lastMessage = messages[messages.length - 1] || {};
        recovered.push({
          id: conversationId,
          title: generateHistoryTitle(String(firstUserMessage.content || '')),
          updatedAt: Number(lastMessage.timestamp) || 0
        });
        knownIds[conversationId] = true;
      }

      if (recovered.length > 0) {
        recovered.sort(function(a, b) { return b.updatedAt - a.updatedAt; });
        history = recovered.map(function(item) {
          return { id: item.id, title: item.title };
        }).concat(history);
        saveHistory(history);
        console.log('[ConversationPersistence] 已恢复未归档会话:', recovered.length);
      }
      return recovered.map(function(item) { return item.id; });
    }

    async function hydrateConversationHistoryFromServer() {
      try {
        var response = await fetch('/api/memory/conversations/' + encodeURIComponent(currentUserId) + '?limit=300');
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success) {
          throw new Error(result.error || ('HTTP ' + response.status));
        }

        var serverHistory = Array.isArray(result.conversations) && result.conversations.length
          ? result.conversations
          : (Array.isArray(result.recentConversations) ? result.recentConversations : []);
        var deletedIds = new Set(getDeletedConversationHistoryIds());
        var localHistory = getHistory();
        var localById = Object.create(null);
        localHistory.forEach(function(item) {
          if (item && item.id && !deletedIds.has(item.id)) localById[item.id] = item;
        });

        var merged = [];
        serverHistory.forEach(function(item) {
          var conversationId = String(item && (item.id || item.conversationId) || '').trim();
          if (!conversationId || deletedIds.has(conversationId)) return;
          var localItem = localById[conversationId];
          merged.push({
            id: conversationId,
            title: String((localItem && localItem.title) || item.title || item.summary || '历史对话'),
            updatedAt: String(item.updatedAt || item.createdAt || '')
          });
          delete localById[conversationId];
        });
        Object.keys(localById).forEach(function(conversationId) {
          merged.push(localById[conversationId]);
        });
        merged.sort(function(a, b) {
          var aTime = Date.parse(a.updatedAt || '') || 0;
          var bTime = Date.parse(b.updatedAt || '') || 0;
          return bTime - aTime;
        });
        saveHistory(merged.map(function(item) {
          return { id: item.id, title: item.title, updatedAt: item.updatedAt || '' };
        }));
        renderHistory();
        console.log('[ConversationPersistence] 已从服务端恢复历史会话:', serverHistory.length);
        return merged;
      } catch (error) {
        console.warn('[ConversationPersistence] 服务端历史恢复失败，继续使用本地记录:', error);
        return getHistory();
      }
    }

    function saveConversationMessageLocal(role, content, isHtml) {
      var text = String(content || '').trim();
      if (!text) return;
      ensureCurrentConversationId();
      var messages = readConversationMessagesLocal(currentConversationId);
      var last = messages[messages.length - 1];
      if (last && last.role === role && String(last.content || '') === text) {
        ensureConversationHistoryEntry(currentConversationId, messages);
        scheduleConversationPersistence(currentConversationId);
        return;
      }
      messages.push({ role: role, content: text, isHtml: !!isHtml, timestamp: Date.now() });
      storeConversationMessagesLocally(currentConversationId, messages);
    }

    function startToolWorkflowConversation(userMessage) {
      ensureCurrentConversationId();
      if (userMessage && String(userMessage).trim()) {
        emptyState.style.display = 'none';
        appendMessage(userMessage, 'user', false);
        saveConversationMessageLocal('user', userMessage, false);
      }
    }
    
    function generateHistoryTitle(userMessage) {
      var now = new Date();
      var year = now.getFullYear();
      var month = String(now.getMonth() + 1).padStart(2, '0');
      var day = String(now.getDate()).padStart(2, '0');
      var datePrefix = year + '/' + month + '/' + day;
      var summary = (userMessage || '新对话').slice(0, 20);
      if ((userMessage || '').length > 20) summary += '...';
      return datePrefix + '-' + summary;
    }
    
    function getLitStorage(userId) {
      var data = localStorage.getItem(LIT_KEY + userId);
      return data ? JSON.parse(data) : [];
    }
    
    function saveLitStorage(userId, files) {
      localStorage.setItem(LIT_KEY + userId, JSON.stringify(files));
    }

    var projectManagerCurrentProject = null;
    var DEFAULT_PROJECT_WRITING_PROFILE_ID = 'paper-writing';
    var PROJECT_WRITING_PROFILES = [
      { id: 'paper-writing', label: '论文辅助写作', shortLabel: '论文写作', topicLabel: '论文主题', requirementLabel: '用户要求', oneClickTitle: '一键写论文', oneClickAction: '开始写论文' },
      { id: 'thesis-writing', label: '大论文辅助写作', shortLabel: '大论文写作', topicLabel: '大论文题目或研究方向', requirementLabel: '大论文写作要求', oneClickTitle: '一键写大论文', oneClickAction: '开始写大论文' },
      { id: 'paper-review', label: '论文辅助审阅', shortLabel: '论文审阅', topicLabel: '待审论文主题或标题', requirementLabel: '审阅要求', oneClickTitle: '一键审论文', oneClickAction: '开始审阅' },
      { id: 'grant-writing', label: '基金辅助写作', shortLabel: '基金写作', topicLabel: '基金项目主题', requirementLabel: '申报要求', oneClickTitle: '一键写基金', oneClickAction: '开始写基金' },
      { id: 'patent-writing', label: '专利辅助写作', shortLabel: '专利写作', topicLabel: '发明/实用新型主题', requirementLabel: '技术交底与保护要求', oneClickTitle: '一键写专利', oneClickAction: '开始写专利' },
      { id: 'software-copyright', label: '软著辅助写作', shortLabel: '软著写作', topicLabel: '软件名称或系统主题', requirementLabel: '软著材料要求', oneClickTitle: '一键写软著', oneClickAction: '开始写软著' },
      { id: 'business-plan', label: '商业计划书辅助写作', shortLabel: '商业计划书', topicLabel: '项目/产品主题', requirementLabel: '计划书要求', oneClickTitle: '一键写商业计划书', oneClickAction: '开始写计划书' },
      { id: 'general-writing', label: '其他文稿辅助写作', shortLabel: '通用文稿', topicLabel: '文稿主题', requirementLabel: '写作要求', oneClickTitle: '一键写文稿', oneClickAction: '开始写文稿' }
    ];
    var PROJECT_UI_LABELS = {
      'paper-writing': {
        assistantName: '学术论文写作助手',
        uploadEvidence: '上传文献摘要',
        uploadMaterial: '上传实验资料',
        uploadStyle: '上传目标期刊样例',
        embeddingLibrary: 'Embedding文献库',
        draft: '论文草稿',
        materialSummary: '实验资料总结',
        resultSummary: '数据详细总结',
        materialPlaceholder: '暂无实验资料记录<br><br>请与 AI 讨论您的研究，系统会自动提取并保存实验信息',
        resultPlaceholder: '暂无数据记录<br><br>请与 AI 讨论您的实验数据，系统会自动提取并保存',
        materialEnabledLabel: '试验资料',
        materialEnabledDesc: '完整试验资料保存在本地；每次 AI 调用按当前章节/句子选取相关片段，用于贴合研究背景、设计和方法。',
        styleGroup: '目标期刊章节写作风格',
        styleEmpty: '还没有目标期刊风格。先在文献库里分析目标期刊论文后，这里会出现可勾选项。',
        styleAuto: '未选择，自动使用最新分析结果',
        referenceFormat: '目标期刊参考文献格式',
        projectWork: '论文工作'
      },
      'thesis-writing': {
        assistantName: '大论文写作助手',
        uploadEvidence: '上传文献摘要',
        uploadMaterial: '上传大论文资料',
        uploadStyle: '上传学校/学院格式样例',
        embeddingLibrary: 'Embedding文献库',
        draft: '大论文草稿',
        materialSummary: '大论文资料总结',
        resultSummary: '数据详细总结',
        materialPlaceholder: '暂无大论文资料记录<br><br>请上传开题报告、实验资料、章节草稿或与 AI 讨论研究主线，系统会自动提取并保存',
        resultPlaceholder: '暂无数据记录<br><br>请上传实验数据、图片或结果表格，系统会自动提取并保存',
        materialEnabledLabel: '大论文资料',
        materialEnabledDesc: '完整大论文资料保存在本地；每次 AI 调用按当前章节/研究问题选取相关片段，用于保持绪论、综述、方法、结果和讨论的主线一致。',
        styleGroup: '学校/学院大论文格式与章节风格',
        styleEmpty: '还没有大论文格式样例。先上传学校模板、学院要求或优秀大论文样例后，这里会出现可勾选项。',
        styleAuto: '未选择，自动使用最新格式/样例分析结果',
        referenceFormat: '学校/学院参考文献格式',
        projectWork: '大论文写作工作'
      },
      'paper-review': {
        assistantName: '论文审阅助手',
        uploadEvidence: '上传论文与参考文献',
        uploadMaterial: '上传审阅材料',
        uploadStyle: '上传期刊/审稿要求',
        embeddingLibrary: '审阅文献库',
        draft: '审阅草稿',
        materialSummary: '稿件资料总结',
        resultSummary: '审阅问题总结',
        materialPlaceholder: '暂无稿件资料记录<br><br>请上传待审论文或与 AI 讨论审阅重点，系统会自动提取并保存关键信息',
        resultPlaceholder: '暂无审阅问题记录<br><br>请与 AI 讨论稿件问题、数据或方法，系统会自动提取并保存',
        materialEnabledLabel: '稿件资料',
        materialEnabledDesc: '完整稿件资料保存在本地；每次 AI 调用按当前审阅维度选取相关片段，用于定位问题和生成修改建议。',
        styleGroup: '目标期刊/审稿风格',
        styleEmpty: '还没有期刊或审稿风格。先上传期刊样例或审稿要求后，这里会出现可勾选项。',
        styleAuto: '未选择，自动使用最新审稿风格',
        referenceFormat: '审稿引用/参考文献格式',
        projectWork: '论文审阅工作'
      },
      'grant-writing': {
        assistantName: '基金写作助手',
        uploadEvidence: '上传指南/文献依据',
        uploadMaterial: '上传申报资料',
        uploadStyle: '上传基金模板样例',
        embeddingLibrary: '申报依据库',
        draft: '基金草稿',
        materialSummary: '申报资料总结',
        resultSummary: '评审要点总结',
        materialPlaceholder: '暂无申报资料记录<br><br>请上传指南、前期基础或研究设想，系统会自动提取并保存申报信息',
        resultPlaceholder: '暂无评审要点记录<br><br>请与 AI 讨论科学问题、创新点或可行性，系统会自动提取并保存',
        materialEnabledLabel: '申报资料',
        materialEnabledDesc: '完整申报资料保存在本地；每次 AI 调用按当前章节选取相关片段，用于贴合指南、前期基础和研究设计。',
        styleGroup: '基金模板/指南风格',
        styleEmpty: '还没有基金模板或指南风格。先上传模板样例后，这里会出现可勾选项。',
        styleAuto: '未选择，自动使用最新模板分析结果',
        referenceFormat: '申报书参考文献格式',
        projectWork: '基金写作工作'
      },
      'patent-writing': {
        assistantName: '专利写作助手',
        uploadEvidence: '上传现有技术资料',
        uploadMaterial: '上传技术交底书',
        uploadStyle: '上传专利模板样例',
        embeddingLibrary: '现有技术库',
        draft: '专利草稿',
        materialSummary: '技术资料总结',
        resultSummary: '技术要点总结',
        materialPlaceholder: '暂无技术资料记录<br><br>请上传技术交底、附图或现有技术材料，系统会自动提取并保存',
        resultPlaceholder: '暂无技术要点记录<br><br>请与 AI 讨论技术问题、方案和效果，系统会自动提取并保存',
        materialEnabledLabel: '技术交底资料',
        materialEnabledDesc: '完整技术资料保存在本地；每次 AI 调用按当前专利章节选取相关片段，用于支撑技术方案和权利要求。',
        styleGroup: '专利模板风格',
        styleEmpty: '还没有专利模板风格。先上传专利样例后，这里会出现可勾选项。',
        styleAuto: '未选择，自动使用最新模板分析结果',
        referenceFormat: '现有技术/参考文献格式',
        projectWork: '专利写作工作'
      },
      'software-copyright': {
        assistantName: '软著写作助手',
        uploadEvidence: '上传软件资料',
        uploadMaterial: '上传功能/界面材料',
        uploadStyle: '上传软著模板样例',
        embeddingLibrary: '软件资料库',
        draft: '软著草稿',
        materialSummary: '软著资料总结',
        resultSummary: '功能要点总结',
        materialPlaceholder: '暂无软著资料记录<br><br>请上传软件说明、功能截图或源代码片段，系统会自动提取并保存',
        resultPlaceholder: '暂无功能要点记录<br><br>请与 AI 讨论模块、流程或运行环境，系统会自动提取并保存',
        materialEnabledLabel: '软著资料',
        materialEnabledDesc: '完整软著资料保存在本地；每次 AI 调用按当前材料章节选取相关片段，用于保持模块、流程和界面一致。',
        styleGroup: '软著模板风格',
        styleEmpty: '还没有软著模板风格。先上传模板样例后，这里会出现可勾选项。',
        styleAuto: '未选择，自动使用最新模板分析结果',
        referenceFormat: '软著材料格式要求',
        projectWork: '软著写作工作'
      },
      'business-plan': {
        assistantName: '商业计划书写作助手',
        uploadEvidence: '上传市场/竞品资料',
        uploadMaterial: '上传项目资料',
        uploadStyle: '上传计划书模板样例',
        embeddingLibrary: '商业资料库',
        draft: '计划书草稿',
        materialSummary: '商业资料总结',
        resultSummary: '市场数据总结',
        materialPlaceholder: '暂无商业资料记录<br><br>请上传项目介绍、市场资料或竞品材料，系统会自动提取并保存',
        resultPlaceholder: '暂无市场数据记录<br><br>请与 AI 讨论市场、客户、财务或竞品信息，系统会自动提取并保存',
        materialEnabledLabel: '项目资料',
        materialEnabledDesc: '完整项目资料保存在本地；每次 AI 调用按当前计划书章节选取相关片段，用于保持市场、产品和财务假设一致。',
        styleGroup: '计划书模板风格',
        styleEmpty: '还没有计划书模板风格。先上传模板样例后，这里会出现可勾选项。',
        styleAuto: '未选择，自动使用最新模板分析结果',
        referenceFormat: '计划书引用/数据来源格式',
        projectWork: '商业计划书写作工作'
      },
      'general-writing': {
        assistantName: '文稿写作助手',
        uploadEvidence: '上传参考资料',
        uploadMaterial: '上传文稿材料',
        uploadStyle: '上传格式/样例',
        embeddingLibrary: '参考资料库',
        draft: '文稿草稿',
        materialSummary: '参考资料总结',
        resultSummary: '关键信息总结',
        materialPlaceholder: '暂无参考资料记录<br><br>请上传相关材料或与 AI 讨论写作目标，系统会自动提取并保存',
        resultPlaceholder: '暂无关键信息记录<br><br>请与 AI 讨论事实、数据或要求，系统会自动提取并保存',
        materialEnabledLabel: '文稿材料',
        materialEnabledDesc: '完整文稿材料保存在本地；每次 AI 调用按当前结构选取相关片段，用于贴合受众、用途和格式要求。',
        styleGroup: '格式/样例风格',
        styleEmpty: '还没有格式样例。先上传样例后，这里会出现可勾选项。',
        styleAuto: '未选择，自动使用最新样例分析结果',
        referenceFormat: '引用/来源格式要求',
        projectWork: '文稿写作工作'
      }
    };

    function getProjectWritingProfile(profileId) {
      var id = profileId || (projectManagerCurrentProject && projectManagerCurrentProject.writingProfileId) || DEFAULT_PROJECT_WRITING_PROFILE_ID;
      return PROJECT_WRITING_PROFILES.find(function(profile) { return profile.id === id; }) || PROJECT_WRITING_PROFILES[0];
    }
    window.getProjectWritingProfile = getProjectWritingProfile;

    function getCurrentProjectProfileId() {
      return getProjectWritingProfile().id;
    }

    function isAcademicPaperWritingProfile(profileId) {
      var id = getProjectWritingProfile(profileId).id;
      return id === 'paper-writing' || id === 'thesis-writing';
    }

    function getProjectUiLabels(profileId) {
      var profile = getProjectWritingProfile(profileId);
      return PROJECT_UI_LABELS[profile.id] || PROJECT_UI_LABELS[DEFAULT_PROJECT_WRITING_PROFILE_ID];
    }
    window.getProjectUiLabels = getProjectUiLabels;

    function setProjectText(elementId, text) {
      var element = document.getElementById(elementId);
      if (element) element.textContent = text;
    }

    function applyProjectScopedVisibility(profileId) {
      var activeId = getProjectWritingProfile(profileId).id;
      document.querySelectorAll('[data-profile-visible]').forEach(function(element) {
        var allowed = String(element.getAttribute('data-profile-visible') || '')
          .split(',')
          .map(function(item) { return item.trim(); })
          .filter(Boolean);
        element.style.display = allowed.indexOf(activeId) !== -1 ? '' : 'none';
      });
    }

    function buildProjectGreetingHtml(profileId) {
      var labels = getProjectUiLabels(profileId);
      return '<p class="typing-greeting"><span>你好！我是' + labels.assistantName + '！</span></p>';
    }

    function applyProjectWritingProfileUi(profileId) {
      var profile = getProjectWritingProfile(profileId);
      var labels = getProjectUiLabels(profile.id);
      GREETING_HTML = buildProjectGreetingHtml(profile.id);
      setProjectText('sidebarOneClickWriterLabel', profile.oneClickTitle);
      setProjectText('sidebarUploadEvidenceLabel', labels.uploadEvidence);
      setProjectText('sidebarUploadMaterialLabel', labels.uploadMaterial);
      setProjectText('sidebarUploadStyleLabel', labels.uploadStyle);
      setProjectText('sidebarEmbeddingLibraryLabel', labels.embeddingLibrary);
      setProjectText('sidebarDraftLabel', labels.draft);
      setProjectText('sidebarMaterialSummaryLabel', labels.materialSummary);
      setProjectText('sidebarResultSummaryLabel', labels.resultSummary);
      setProjectText('slashStyleGroupLabel', labels.styleGroup);
      applyProjectScopedVisibility(profile.id);
      var experimentUploadBtn = document.getElementById('uploadExperimentBtn');
      if (experimentUploadBtn) {
        experimentUploadBtn.title = labels.uploadMaterial + '（图片/表格/PDF/Word）';
      }
      if (typeof renderRightSidebarActivePanel === 'function') {
        renderRightSidebarActivePanel();
      }
      if (emptyState && emptyState.style.display !== 'none' && (!messagesDiv || messagesDiv.children.length === 0)) {
        emptyState.innerHTML = BRAND_TITLE_HTML + GREETING_HTML;
      }
    }

    initDiscussionFrameworkFloating();
    renderRightSidebarActivePanel();

    function buildProjectWritingProfileOptions(selectedId) {
      var selected = getProjectWritingProfile(selectedId).id;
      return PROJECT_WRITING_PROFILES.map(function(profile) {
        return '<option value="' + escapeHtml(profile.id) + '"' + (profile.id === selected ? ' selected' : '') + '>' + escapeHtml(profile.label) + '</option>';
      }).join('');
    }

    function getProjectEvidenceItemName(profileId) {
      var profile = getProjectWritingProfile(profileId);
      if (profile.id === 'paper-writing' || profile.id === 'thesis-writing' || profile.id === 'paper-review') return '文献';
      if (profile.id === 'grant-writing') return '依据材料';
      if (profile.id === 'patent-writing') return '现有技术资料';
      if (profile.id === 'software-copyright') return '软件资料';
      if (profile.id === 'business-plan') return '商业资料';
      return '参考资料';
    }

    function getProjectStyleAnalysisTitle(profileId) {
      return getProjectUiLabels(profileId).styleGroup + '分析';
    }

    function getProjectStyleSourceName(profileId) {
      var profile = getProjectWritingProfile(profileId);
      if (profile.id === 'paper-writing') return '目标期刊论文';
      if (profile.id === 'thesis-writing') return '学校格式要求、学院模板或优秀大论文样例';
      if (profile.id === 'paper-review') return '期刊要求、审稿规范或审稿样例';
      if (profile.id === 'grant-writing') return '基金指南、申报模板或优秀样例';
      if (profile.id === 'patent-writing') return '专利模板、交底书样例或同类专利';
      if (profile.id === 'software-copyright') return '软著模板、说明书样例或软件材料';
      if (profile.id === 'business-plan') return '商业计划书模板、路演稿或竞品材料';
      return '格式要求、样例文稿或参考材料';
    }

    function getProjectMemoryCategoryOverrides(profileId) {
      var profile = getProjectWritingProfile(profileId);
      var labels = getProjectUiLabels(profile.id);
      return {
        experiment: {
          label: labels.materialSummary + '记忆',
          description: labels.materialEnabledLabel + '、背景、要求、方法/方案、来源和约束信息'
        },
        data: {
          label: labels.resultSummary + '记忆',
          description: '数值结果、关键发现、数据状态、核心判断和待确认信息'
        },
        paper: {
          label: profile.shortLabel + '设定记忆',
          description: profile.topicLabel + '、格式要求、目标样例、关键词和交付设定'
        },
        writing: {
          label: profile.shortLabel + '进度记忆',
          description: '当前写作阶段、草稿进度、已完成和待完成部分'
        }
      };
    }

    function applyProjectScopedMemoryLabels(data) {
      if (!data || typeof data !== 'object') return data;
      var profile = getProjectWritingProfile();
      var labels = getProjectUiLabels(profile.id);
      var categoryOverrides = getProjectMemoryCategoryOverrides(profile.id);
      var dimensionOverrides = {
        experiment_summary_structured: {
          label: labels.materialSummary + '（结构化）',
          description: 'AI 整理后的结构化' + labels.materialSummary,
          categoryLabel: categoryOverrides.experiment.label
        },
        research_method: {
          label: isAcademicPaperWritingProfile(profile.id) ? '研究方法' : '方法/方案',
          description: '当前项目的方法、技术路线、实施方案或材料处理方式',
          categoryLabel: categoryOverrides.experiment.label
        },
        experimental_design: {
          label: isAcademicPaperWritingProfile(profile.id) ? '实验设计' : '方案设计',
          description: '设计思路、处理设置、采样/数据来源、实施步骤或交付约束',
          categoryLabel: categoryOverrides.experiment.label
        },
        data_summary_structured: {
          label: labels.resultSummary + '（结构化）',
          description: 'AI 整理后的结构化' + labels.resultSummary,
          categoryLabel: categoryOverrides.data.label
        },
        key_findings: {
          label: isAcademicPaperWritingProfile(profile.id) ? '关键发现' : '关键要点',
          description: '当前项目的关键发现、卖点、审查问题、技术效果或结论',
          categoryLabel: categoryOverrides.data.label
        },
        important_findings: {
          label: isAcademicPaperWritingProfile(profile.id) ? '重要发现' : '重要要点',
          description: '历史版本写入的重要发现/要点字段',
          categoryLabel: categoryOverrides.data.label
        },
        data_status: {
          label: isAcademicPaperWritingProfile(profile.id) ? '数据状态' : '资料状态',
          description: '数据/资料是否齐全、待补充内容和当前处理状态',
          categoryLabel: categoryOverrides.data.label
        },
        paper_topic: {
          label: profile.topicLabel,
          description: '用户明确设定的' + profile.topicLabel,
          categoryLabel: categoryOverrides.paper.label
        },
        research_topic: {
          label: profile.topicLabel,
          description: '历史版本写入的主题字段',
          categoryLabel: categoryOverrides.paper.label
        },
        target_journal: {
          label: labels.styleGroup,
          description: '用户明确设定的目标格式、样例、模板或风格要求',
          categoryLabel: categoryOverrides.paper.label
        },
        key_concepts: {
          label: '关键概念/关键词',
          description: '当前项目相关的核心概念、关键词、变量、模块或业务要素',
          categoryLabel: categoryOverrides.paper.label
        },
        journals_mentioned: {
          label: '提到的样例/来源',
          description: '对话中提到但未必设为目标的期刊、模板、来源或样例',
          categoryLabel: categoryOverrides.paper.label
        },
        draft_progress: {
          label: labels.draft + '进度',
          description: labels.draft + '生成、保存和修改进度',
          categoryLabel: categoryOverrides.writing.label
        }
      };

      if (Array.isArray(data.memoryCategories)) {
        data.memoryCategories = data.memoryCategories.map(function(category) {
          var override = categoryOverrides[category.id];
          return override ? Object.assign({}, category, override) : category;
        });
      }
      if (Array.isArray(data.memoryDimensions)) {
        data.memoryDimensions = data.memoryDimensions.map(function(entry) {
          var override = dimensionOverrides[entry.key] || {};
          var next = Object.assign({}, entry, override);
          if (next.category && categoryOverrides[next.category]) {
            next.categoryLabel = categoryOverrides[next.category].label;
          }
          return next;
        });
      }
      if (Array.isArray(data.memoryEntries)) {
        data.memoryEntries = data.memoryEntries.map(function(entry) {
          return Object.assign({}, entry, dimensionOverrides[entry.key] || {});
        });
      }
      if (Array.isArray(data.storageDimensions)) {
        data.storageDimensions = data.storageDimensions.map(function(dim) {
          if (dim.id === 'drafts') {
            return Object.assign({}, dim, {
              label: labels.draft,
              description: dim.exists ? (dim.description || '').replace(/论文草稿/g, labels.draft).replace(/章节草稿/g, '部分草稿') : '暂无' + labels.draft
            });
          }
          if (dim.id === 'literature') {
            return Object.assign({}, dim, {
              label: labels.embeddingLibrary,
              description: (dim.description || '').replace(/文献/g, getProjectEvidenceItemName(profile.id))
            });
          }
          if (dim.id === 'indexCache') {
            return Object.assign({}, dim, {
              description: (dim.description || '').replace(/文献/g, getProjectEvidenceItemName(profile.id))
            });
          }
          if (dim.id === 'journalStyles') {
            return Object.assign({}, dim, {
              label: labels.styleGroup + '文件',
              description: dim.exists ? ('共 ' + (dim.itemCount || 0) + ' 个' + labels.styleGroup) : labels.styleGroup + '模板'
            });
          }
          return dim;
        });
      }
      return data;
    }

    async function persistCurrentProjectWritingProfile(profileId) {
      var profile = getProjectWritingProfile(profileId);
      try {
        var response = await fetch('/api/projects/current/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ writingProfileId: profile.id })
        });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '项目主题保存失败');
        }
        projectManagerCurrentProject = result.currentProject || Object.assign({}, projectManagerCurrentProject || {}, {
          writingProfileId: profile.id,
          writingProfileLabel: profile.label
        });
      } catch (e) {
        console.warn('[Project] Failed to persist current writing profile:', e);
        projectManagerCurrentProject = Object.assign({}, projectManagerCurrentProject || {}, {
          writingProfileId: profile.id,
          writingProfileLabel: profile.label
        });
      }
      applyProjectWritingProfileUi(profile.id);
      return projectManagerCurrentProject;
    }

    async function fetchCurrentProjectInfo() {
      try {
        var response = await fetch('/api/projects/current');
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '识别当前项目失败');
        }
        projectManagerCurrentProject = result.currentProject || null;
        applyProjectWritingProfileUi(getCurrentProjectProfileId());
        renderMainContextSourceBar();
        return projectManagerCurrentProject;
      } catch (e) {
        console.warn('[Project] Failed to resolve current project:', e);
        projectManagerCurrentProject = null;
        applyProjectWritingProfileUi(DEFAULT_PROJECT_WRITING_PROFILE_ID);
        renderMainContextSourceBar();
        return null;
      }
    }

    function collectProjectClientState() {
      var messageKeys = [];
      var messages = {};
      var messagePrefix = MSG_KEY + currentUserId + '_';
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key) continue;
        if (key.indexOf(messagePrefix) === 0 || key === MSG_KEY + currentUserId) {
          messageKeys.push(key);
          try {
            messages[key] = JSON.parse(localStorage.getItem(key) || '[]');
          } catch (e) {
            messages[key] = localStorage.getItem(key);
          }
        }
      }

      return {
        archivedAt: new Date().toISOString(),
        currentUserId: currentUserId,
        currentConversationId: currentConversationId,
        history: getHistory(),
        uploadedFiles: uploadedFiles,
        messages: messages,
        workspaceDirectoryStore: loadWorkspaceDirectoryStore(currentConversationId),
        workspaceConversationRoots: loadWorkspaceConversationRoots()
      };
    }

    function clearProjectLocalState() {
      stopActiveMainChatForNavigation();
      var keysToRemove = [
        STORAGE_KEY,
        LIT_KEY + currentUserId,
        'scholarclaw_journal_' + currentUserId,
        getWorkspaceDirectoryStoreKey(),
        getWorkspaceConversationRootsStoreKey()
      ];
      var messagePrefix = MSG_KEY + currentUserId + '_';
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var key = localStorage.key(i);
        if (key && (key.indexOf(messagePrefix) === 0 || key === MSG_KEY + currentUserId)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(function(key) {
        localStorage.removeItem(key);
      });

      uploadedFiles = [];
      pendingExperimentFiles = [];
      mainChatQueryQueue = [];
      mainChatPiState = null;
      workspaceDirectoryPreviewsByConversation.clear();
      workspaceDirectoryLastPreview = null;
      clearWorkspacePreviewSelections(false);
      currentConversationId = createConversationId();
      activePdfPaperChatContext = null;
      pdfPaperChatReturnContext = null;
      mainMetaAnalysisReturnContext = null;
      mainAnalysisWorkflowReturnContext = null;
      if (userInput) userInput.placeholder = ' ';
      initializeWorkspaceDirectoryForConversation(currentConversationId, '');
      needsFullPrompt = true;
      window.chatBridgeNeedsNewPage = true;
      clearChatTurnScrollLock();
      resetMainChatPiQueueHost();
      messagesDiv.innerHTML = '';
      renderPdfPaperChatReturnBar();
      renderMainMetaAnalysisReturnBar();
      renderMainAnalysisWorkflowReturnBar();
      var labels = getProjectUiLabels();
      emptyState.innerHTML = BRAND_TITLE_HTML + '<p>已创建新项目。</p><p style="margin-top:12px;">上传资料或发送消息开始新的' + labels.projectWork + '。</p>';
      emptyState.style.display = 'flex';
      renderFileList();
      renderHistory();
      renderMainChatPiQueue(null);
      activateWorkspaceDirectoryConversation(currentConversationId);
    }

    function applyProjectClientState(clientState) {
      clearProjectLocalState();
      if (!clientState || typeof clientState !== 'object') {
        loadLiteratureFromServer();
        return;
      }

      if (Array.isArray(clientState.history)) {
        saveHistory(clientState.history);
      }

      if (clientState.messages && typeof clientState.messages === 'object') {
        Object.keys(clientState.messages).forEach(function(key) {
          localStorage.setItem(key, JSON.stringify(clientState.messages[key]));
        });
      }

      if (Array.isArray(clientState.uploadedFiles)) {
        uploadedFiles = clientState.uploadedFiles;
        saveLitStorage(currentUserId, uploadedFiles);
      }

      if (clientState.workspaceDirectoryStore && typeof clientState.workspaceDirectoryStore === 'object') {
        persistWorkspaceDirectoryStore(clientState.workspaceDirectoryStore);
      }
      if (clientState.workspaceConversationRoots && typeof clientState.workspaceConversationRoots === 'object') {
        saveWorkspaceConversationRoots(clientState.workspaceConversationRoots);
      }

      currentConversationId = clientState.currentConversationId || createConversationId();
      initializeWorkspaceDirectoryForConversation(currentConversationId, '');
      activateWorkspaceDirectoryConversation(currentConversationId);
      needsFullPrompt = true;
      renderFileList();
      renderHistory();
      hydrateConversationHistoryFromServer();

      var restoredMessages = localStorage.getItem(MSG_KEY + currentUserId + '_' + currentConversationId);
      if (restoredMessages) {
        try {
          var messages = JSON.parse(restoredMessages);
          resetMainChatPiQueueHost();
          messagesDiv.innerHTML = '';
          emptyState.style.display = 'none';
          messages.forEach(function(message) {
            if (message.piQueueId && (message.piStatus === 'queued' || message.piStatus === 'processing')) {
              return;
            } else {
              appendMessage(message.content, message.role === 'user' ? 'user' : 'bot', false, true);
            }
          });
        } catch (e) {
          console.warn('[Project] Failed to restore visible messages:', e);
        }
      } else {
        resetMainChatPiQueueHost();
        messagesDiv.innerHTML = '';
        var labels = getProjectUiLabels();
        emptyState.innerHTML = BRAND_TITLE_HTML + '<p>项目已恢复。</p><p style="margin-top:12px;">继续发送消息或查看' + labels.draft + '。</p>';
        emptyState.style.display = 'flex';
      }

      loadLiteratureFromServer();
      syncMainChatPiQueueState({ claimWhenIdle: true });
    }

    async function showNewProjectDialog() {
      showModal('新项目', '<div style="padding:20px;color:var(--text-secondary);">正在识别当前项目...</div>', true, false);
      var currentProject = await fetchCurrentProjectInfo();
      var isSavedProject = currentProject && currentProject.isArchivedProject && currentProject.projectId;
      var currentProjectName = isSavedProject ? (currentProject.name || currentProject.projectId) : '';
      var currentProfile = getProjectWritingProfile(currentProject && currentProject.writingProfileId);

      showModal(
        '新项目',
        '<div style="line-height:1.7;color:var(--text-primary);">' +
          '<p>当前项目的聊天记录、长期记忆、草稿、上传资料和检索索引会保存到独立项目目录。</p>' +
          '<p style="margin-top:8px;color:var(--text-secondary);">API 配置、模型配置、登录状态和软件设置会继续保留。</p>' +
          '<label style="display:block;margin-top:14px;font-size:13px;color:var(--text-secondary);">项目主题</label>' +
          '<select id="newProjectWritingProfile" onchange="previewNewProjectWritingProfile(this.value)" style="width:100%;margin-top:6px;padding:10px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);border-radius:6px;color:var(--text-primary);">' +
            buildProjectWritingProfileOptions(currentProfile.id) +
          '</select>' +
          '<div id="newProjectProfilePreview" style="margin-top:8px;font-size:12px;color:var(--text-secondary);">将创建：' + escapeHtml(currentProfile.label) + '</div>' +
          (isSavedProject
            ? '<div style="margin-top:12px;padding:10px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);font-size:13px;color:var(--text-secondary);">当前项目已识别为：<strong style="color:var(--text-primary);">' + escapeHtml(currentProjectName) + '</strong><br>创建新项目时会先保存回该项目，不需要重新命名。</div>'
            : '<input id="newProjectName" placeholder="项目名称（可选）" style="width:100%;margin-top:14px;padding:10px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);border-radius:6px;color:var(--text-primary);">') +
        '</div>' +
        '<div class="btns">' +
          '<button class="cancel" onclick="closeModal()">取消</button>' +
          '<button class="ok" id="newProjectConfirmBtn" onclick="createNewProject()">创建新项目</button>' +
        '</div>',
        false,
        false
      );
    }

    function previewNewProjectWritingProfile(profileId) {
      var profile = getProjectWritingProfile(profileId);
      var preview = document.getElementById('newProjectProfilePreview');
      if (preview) {
        preview.textContent = '将创建：' + profile.label;
      }
    }
    window.previewNewProjectWritingProfile = previewNewProjectWritingProfile;

    async function createNewProject() {
      var btn = document.getElementById('newProjectConfirmBtn');
      var nameInput = document.getElementById('newProjectName');
      var profileSelect = document.getElementById('newProjectWritingProfile');
      var selectedProfileId = profileSelect ? profileSelect.value : getCurrentProjectProfileId();
      var selectedProfile = getProjectWritingProfile(selectedProfileId);
      if (btn) {
        btn.disabled = true;
        btn.textContent = '创建中...';
      }

      try {
        var response = await fetch('/api/projects/new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            name: nameInput ? nameInput.value : '',
            writingProfileId: selectedProfile.id,
            clientState: collectProjectClientState()
          })
        });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '创建新项目失败');
        }

        projectManagerCurrentProject = Object.assign({}, result.currentProject || {}, {
          writingProfileId: selectedProfile.id,
          writingProfileLabel: selectedProfile.label
        });
        applyProjectWritingProfileUi(selectedProfile.id);
        await persistCurrentProjectWritingProfile(selectedProfile.id);
        clearProjectLocalState();
        closeModal();
        appendMessage(
          result.savedExistingProjectId
            ? '✅ 当前项目已保存，并已创建新项目。\n项目主题：' + selectedProfile.label + '\n已保存项目：' + (result.savedExistingProjectName || result.savedExistingProjectId)
            : '✅ 新项目已创建。\n项目主题：' + selectedProfile.label + '\n旧项目已归档到：' + result.projectDir,
          'bot',
          false,
          true
        );
      } catch (e) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '创建新项目';
        }
        appendMessage('❌ 新项目创建失败：' + e.message, 'bot', false, true);
      }
    }

    setTimeout(fetchCurrentProjectInfo, 0);

    function formatProjectDate(value) {
      if (!value) return '未知时间';
      var date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString();
    }

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('project-runtime', { source: '/app/project-runtime.js' });
}
