var pendingPdfWikiUploadFiles = null;
    var pendingPdfWikiUploadInput = null;
    var confirmedPdfWikiUploadOptions = null;
    var pdfWikiTopicCatalog = { topics: [] };
    var pdfWikiTopicCatalogLoaded = false;
    var pdfWikiTopicExpansionBusy = false;
    var pdfWikiTopicDialogNavigation = null;
    var pdfWikiSentenceTopicAnnotationPollTimer = null;

    window.triggerPdfWikiUpload = function(closeViewerAfterClick, uploadMode) {
      var input = document.getElementById('pdfFileInput');
      if (!input) {
        alert('PDF 上传控件未加载，请刷新页面后重试。');
        return;
      }
      var mode = 'full';
      var shouldCloseViewer = !!closeViewerAfterClick;
      if (typeof closeViewerAfterClick === 'string') {
        mode = closeViewerAfterClick;
        shouldCloseViewer = false;
      } else if (typeof uploadMode === 'string') {
        mode = uploadMode;
      }
      input.dataset.pdfUploadMode = mode === 'manager-lite' ? 'manager-lite' : 'full';
      input.value = '';
      input.click();
      if (shouldCloseViewer && typeof closePdfWikiViewer === 'function') {
        closePdfWikiViewer();
      }
    };

    function getDefaultPdfWikiUploadOptions() {
      var defaults = {
        version: PDF_WIKI_TASK_OPTIONS_VERSION,
        processingProfile: 'fast',
        textExtractionEngine: 'liteparse',
        metadataEngine: 'local',
        claimExtractionEngine: 'off',
        sentenceReferenceMatchingEngine: 'local',
        groupingEngine: 'local',
        metaAnalysisEnabled: false,
        metaAnalysisEngine: 'off'
      };
      try {
        var saved = JSON.parse(localStorage.getItem(PDF_WIKI_TASK_OPTIONS_KEY) || 'null');
        if (saved && typeof saved === 'object' && Number(saved.version || 0) === PDF_WIKI_TASK_OPTIONS_VERSION) {
          return Object.assign(defaults, {
            processingProfile: saved.processingProfile || defaults.processingProfile,
            textExtractionEngine: saved.textExtractionEngine || defaults.textExtractionEngine,
            metadataEngine: saved.metadataEngine || defaults.metadataEngine,
            claimExtractionEngine: saved.claimExtractionEngine || defaults.claimExtractionEngine,
            sentenceReferenceMatchingEngine: saved.sentenceReferenceMatchingEngine || defaults.sentenceReferenceMatchingEngine,
            groupingEngine: saved.groupingEngine || defaults.groupingEngine,
            metaAnalysisEnabled: saved.metaAnalysisEnabled !== false,
            metaAnalysisEngine: saved.metaAnalysisEngine || defaults.metaAnalysisEngine
          });
        }
      } catch (e) {
        console.warn('[PDF Wiki Upload] 读取上次任务配置失败:', e);
      }
      return defaults;
    }

    function getSelectValue(id, fallback) {
      var el = document.getElementById(id);
      return el && el.value ? el.value : fallback;
    }

    function collectPdfWikiUploadOptions() {
      var metaCheckbox = document.getElementById('pdfWikiMetaAnalysisEnabled');
      return {
        version: PDF_WIKI_TASK_OPTIONS_VERSION,
        processingProfile: getSelectValue('pdfWikiProcessingProfile', 'fast'),
        textExtractionEngine: getSelectValue('pdfWikiTaskTextExtractionEngine', 'auto'),
        metadataEngine: getSelectValue('pdfWikiTaskMetadataEngine', 'auto'),
        claimExtractionEngine: getSelectValue('pdfWikiTaskClaimExtractionEngine', 'auto'),
        sentenceReferenceMatchingEngine: getSelectValue('pdfWikiTaskSentenceReferenceMatchingEngine', 'auto'),
        groupingEngine: getSelectValue('pdfWikiTaskGroupingEngine', 'auto'),
        metaAnalysisEnabled: !metaCheckbox || !!metaCheckbox.checked,
        metaAnalysisEngine: getSelectValue('pdfWikiTaskMetaAnalysisEngine', 'auto')
      };
    }

    function setPdfWikiTaskSelectValue(id, value) {
      var el = document.getElementById(id);
      if (el) el.value = value;
    }

    function syncPdfWikiMetaAnalysisControl() {
      var checkbox = document.getElementById('pdfWikiMetaAnalysisEnabled');
      var engine = document.getElementById('pdfWikiTaskMetaAnalysisEngine');
      if (engine) engine.disabled = !checkbox || !checkbox.checked;
    }

    function updatePdfWikiProcessingProfileHint(profile) {
      var hint = document.getElementById('pdfWikiProcessingProfileHint');
      if (!hint) return;
      hint.textContent = profile === 'fast'
        ? '推荐。LiteParse 只提取引言、讨论、结论和 References；Codex 整理句中/句末引用与本文主要结论。无可核验参考文献的引言/讨论句不会进入论点库。跳过全文重型产物、旧兼容论点、Meta、全表格和全图片。'
        : (profile === 'deep'
          ? '完整深度处理。使用 Codex/API 生成全文结构、旧兼容论点、表格、图片及可选 Meta 数据，耗时和磁盘占用较高。'
          : '自定义模式。当前各阶段设置将按下方选项执行。');
    }

    window.applyPdfWikiProcessingProfile = function(profile) {
      var normalized = profile === 'deep' ? 'deep' : (profile === 'custom' ? 'custom' : 'fast');
      var profileSelect = document.getElementById('pdfWikiProcessingProfile');
      if (profileSelect) profileSelect.value = normalized;
      if (normalized === 'fast') {
        setPdfWikiTaskSelectValue('pdfWikiTaskTextExtractionEngine', 'liteparse');
        setPdfWikiTaskSelectValue('pdfWikiTaskMetadataEngine', 'local');
        setPdfWikiTaskSelectValue('pdfWikiTaskClaimExtractionEngine', 'off');
        setPdfWikiTaskSelectValue('pdfWikiTaskSentenceReferenceMatchingEngine', 'codex');
        setPdfWikiTaskSelectValue('pdfWikiTaskGroupingEngine', 'local');
        setPdfWikiTaskSelectValue('pdfWikiTaskMetaAnalysisEngine', 'off');
        var fastMeta = document.getElementById('pdfWikiMetaAnalysisEnabled');
        if (fastMeta) fastMeta.checked = false;
      } else if (normalized === 'deep') {
        setPdfWikiTaskSelectValue('pdfWikiTaskTextExtractionEngine', 'auto');
        setPdfWikiTaskSelectValue('pdfWikiTaskMetadataEngine', 'auto');
        setPdfWikiTaskSelectValue('pdfWikiTaskClaimExtractionEngine', 'auto');
        setPdfWikiTaskSelectValue('pdfWikiTaskSentenceReferenceMatchingEngine', 'auto');
        setPdfWikiTaskSelectValue('pdfWikiTaskGroupingEngine', 'auto');
        setPdfWikiTaskSelectValue('pdfWikiTaskMetaAnalysisEngine', 'auto');
        var deepMeta = document.getElementById('pdfWikiMetaAnalysisEnabled');
        if (deepMeta) deepMeta.checked = true;
      }
      syncPdfWikiMetaAnalysisControl();
      updatePdfWikiProcessingProfileHint(normalized);
    };

    window.markPdfWikiProcessingProfileCustom = function() {
      var profile = document.getElementById('pdfWikiProcessingProfile');
      if (profile && profile.value !== 'custom') profile.value = 'custom';
      syncPdfWikiMetaAnalysisControl();
      updatePdfWikiProcessingProfileHint('custom');
    };

    function pdfWikiTaskSelect(id, value, options) {
      return '<select id="' + id + '" onchange="markPdfWikiProcessingProfileCustom()" style="width:100%;padding:8px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' +
        options.map(function(option) {
          return '<option value="' + option.value + '"' + (option.value === value ? ' selected' : '') + '>' + option.label + '</option>';
        }).join('') +
      '</select>';
    }

    function pdfWikiTaskRow(title, desc, selectHtml) {
      return '<div style="display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-color);">' +
        '<div style="min-width:0;">' +
          '<div style="font-size:13px;font-weight:700;color:var(--text-primary);">' + title + '</div>' +
          '<div style="margin-top:3px;font-size:12px;line-height:1.45;color:var(--text-secondary);">' + desc + '</div>' +
        '</div>' +
        '<div style="min-width:0;">' + selectHtml + '</div>' +
      '</div>';
    }

    function setPdfWikiTopicCatalogStatus(message, isError) {
      var status = document.getElementById('pdfWikiTopicCatalogStatus');
      if (!status) return;
      status.textContent = message || '';
      status.style.color = isError ? 'var(--danger-color)' : 'var(--text-secondary)';
    }

    function renderPdfWikiTopicCatalog(catalog) {
      pdfWikiTopicCatalog = catalog && typeof catalog === 'object' ? catalog : { topics: [] };
      var topics = Array.isArray(pdfWikiTopicCatalog.topics) ? pdfWikiTopicCatalog.topics : [];
      var list = document.getElementById('pdfWikiTopicCatalogList');
      if (!list) return;
      if (!topics.length) {
        list.innerHTML = '<div style="padding:12px;border:1px dashed var(--border-color);border-radius:7px;color:var(--text-secondary);font-size:12px;line-height:1.5;">还没有主题。导入 PDF 前先添加主题，AI 会扩写中英文别名和匹配词。未匹配的句子将进入“未分类”。</div>';
        return;
      }
      list.innerHTML = topics.map(function(topic) {
        var aliases = Array.isArray(topic.aliases) ? topic.aliases.slice(0, 5) : [];
        var keywords = Array.isArray(topic.keywords) ? topic.keywords.slice(0, 8) : [];
        var details = aliases.concat(keywords).filter(Boolean);
        return '<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:10px 0;border-bottom:1px solid var(--border-color);">' +
          '<div style="min-width:0;">' +
            '<div style="font-size:13px;font-weight:700;color:var(--text-primary);">' + escapeHtml(topic.label || '未命名主题') + '</div>' +
            '<div style="margin-top:3px;font-size:12px;line-height:1.45;color:var(--text-secondary);">' + escapeHtml(topic.description || 'AI 已建立该主题的句子匹配词。') + '</div>' +
            (details.length ? '<div style="margin-top:5px;font-size:11px;line-height:1.45;color:var(--text-tertiary);overflow-wrap:anywhere;">匹配词：' + escapeHtml(details.join('、')) + '</div>' : '') +
          '</div>' +
          '<div style="display:flex;gap:6px;align-items:flex-start;">' +
            '<button type="button" data-topic-id="' + escapeHtml(topic.id || '') + '" onclick="showPdfWikiManualTopicEditor(this.dataset.topicId)" style="padding:5px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:11px;white-space:nowrap;">编辑</button>' +
            '<button type="button" data-topic-id="' + escapeHtml(topic.id || '') + '" onclick="deletePdfWikiTopicDefinition(this.dataset.topicId)" style="padding:5px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:11px;white-space:nowrap;">删除</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    async function loadPdfWikiTopicCatalog() {
      pdfWikiTopicCatalogLoaded = false;
      setPdfWikiTopicCatalogStatus('正在读取用户主题库...', false);
      try {
        var response = await fetch('/api/pdf-wiki/topics?userId=' + encodeURIComponent(currentUserId || 'web-user'));
        var data = await response.json();
        if (!response.ok || data.success === false) throw new Error(data.message || data.error || '主题库读取失败');
        pdfWikiTopicCatalogLoaded = true;
        renderPdfWikiTopicCatalog(data);
        setPdfWikiTopicCatalogStatus((data.topics || []).length + ' 个用户主题。导入时只匹配这些主题，未命中项归入“未分类”。', false);
      } catch (error) {
        pdfWikiTopicCatalogLoaded = true;
        renderPdfWikiTopicCatalog({ topics: [] });
        setPdfWikiTopicCatalogStatus(error.message || String(error), true);
      }
    }

    function stopPdfWikiSentenceTopicAnnotationPolling() {
      if (pdfWikiSentenceTopicAnnotationPollTimer) {
        clearTimeout(pdfWikiSentenceTopicAnnotationPollTimer);
        pdfWikiSentenceTopicAnnotationPollTimer = null;
      }
    }

    function renderPdfWikiSentenceTopicAnnotationStatus(data) {
      var message = document.getElementById('pdfWikiSentenceTopicAnnotationMessage');
      var progress = document.getElementById('pdfWikiSentenceTopicAnnotationProgressValue');
      var primaryButton = document.getElementById('pdfWikiSentenceTopicAnnotationButton');
      var forceButton = document.getElementById('pdfWikiSentenceTopicAnnotationForceButton');
      if (!message || !progress || !primaryButton || !forceButton) {
        stopPdfWikiSentenceTopicAnnotationPolling();
        return;
      }
      var total = Math.max(0, Number(data.totalSentences || 0));
      var annotated = Math.max(0, Number(data.annotatedSentences || 0));
      var pending = Math.max(0, Number(data.pendingSentences || 0));
      var percent = Math.max(0, Math.min(100, Number(data.progress || 0)));
      var processing = data.status === 'processing';
      var failed = Math.max(0, Number(data.failedSentences || 0));
      var summary = '已记录 ' + annotated + '/' + total + ' 个句子';
      if (pending > 0) summary += ' · 待处理 ' + pending;
      if (failed > 0) summary += ' · 本次返回未通过校验 ' + failed;
      message.textContent = summary + (data.message ? ' · ' + data.message : '');
      message.style.color = data.status === 'error' ? 'var(--danger-color)' : 'var(--text-secondary)';
      progress.style.width = percent + '%';
      primaryButton.disabled = processing || total === 0 || pending === 0;
      forceButton.disabled = processing || total === 0;
      primaryButton.innerHTML = processing
        ? '<span class="pdf-wiki-topic-action-spinner" aria-hidden="true"></span><span>后台标注中 ' + percent + '%</span>'
        : '<span class="pdf-wiki-topic-action-icon" aria-hidden="true">✦</span><span>' + (pending > 0 ? 'AI 标注新增句子' : '已全部标注') + '</span>';
      if (processing) {
        stopPdfWikiSentenceTopicAnnotationPolling();
        pdfWikiSentenceTopicAnnotationPollTimer = setTimeout(loadPdfWikiSentenceTopicAnnotationStatus, 1500);
      } else {
        stopPdfWikiSentenceTopicAnnotationPolling();
        if (data.status === 'completed' && pdfWikiTopicDialogNavigation) {
          pdfWikiTopicDialogNavigation.needsGraphRefresh = true;
        }
      }
    }

    async function loadPdfWikiSentenceTopicAnnotationStatus() {
      try {
        var response = await fetch('/api/pdf-wiki/topics/annotation-status?userId=' + encodeURIComponent(currentUserId || 'web-user'));
        var data = await response.json();
        if (!response.ok || data.success === false) throw new Error(data.message || data.error || '读取 AI 标注状态失败');
        renderPdfWikiSentenceTopicAnnotationStatus(data);
      } catch (error) {
        renderPdfWikiSentenceTopicAnnotationStatus({
          status: 'error',
          totalSentences: 1,
          annotatedSentences: 0,
          pendingSentences: 1,
          progress: 0,
          message: error.message || String(error)
        });
      }
    }
    window.loadPdfWikiSentenceTopicAnnotationStatus = loadPdfWikiSentenceTopicAnnotationStatus;

    window.startPdfWikiSentenceTopicAnnotation = async function(force) {
      if (force && !confirm('将使用当前主题库重新标注全部句子。已有记录会在新结果成功后更新，确定继续吗？')) return;
      var primaryButton = document.getElementById('pdfWikiSentenceTopicAnnotationButton');
      var forceButton = document.getElementById('pdfWikiSentenceTopicAnnotationForceButton');
      if (primaryButton) primaryButton.disabled = true;
      if (forceButton) forceButton.disabled = true;
      try {
        var response = await fetch('/api/pdf-wiki/topics/annotate-sentences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId || 'web-user', force: force === true })
        });
        var data = await response.json();
        if (!response.ok || data.success === false) throw new Error(data.message || data.error || '启动 AI 句子主题标注失败');
        renderPdfWikiSentenceTopicAnnotationStatus(data);
      } catch (error) {
        renderPdfWikiSentenceTopicAnnotationStatus({
          status: 'error',
          totalSentences: 1,
          annotatedSentences: 0,
          pendingSentences: 1,
          progress: 0,
          message: error.message || String(error)
        });
      }
    };

    function parsePdfWikiTopicInputs(value) {
      return String(value || '')
        .split(/[\n,，;；]+/)
        .map(function(label) { return label.trim(); })
        .filter(Boolean)
        .slice(0, 20)
        .map(function(label) { return { label: label }; });
    }

    function parsePdfWikiTopicTerms(value) {
      return String(value || '')
        .split(/[\n,，;；]+/)
        .map(function(term) { return term.trim(); })
        .filter(Boolean);
    }

    function pausePdfWikiNetworkForTopicDialog() {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime || runtime.motionPaused) return false;
      runtime.motionPaused = true;
      if (runtime.animationFrame) cancelAnimationFrame(runtime.animationFrame);
      runtime.animationFrame = null;
      updatePdfWikiNetworkMotionStatus(runtime, 'paused');
      return true;
    }

    function beginPdfWikiTopicDialogNavigation(level, editorReturnTarget) {
      if (!pdfWikiTopicDialogNavigation) {
        var preserveViewer = !!document.getElementById('pdfWikiViewerModal');
        var hasNetworkGraph = preserveViewer && !!pdfWikiNetworkRuntime;
        if (hasNetworkGraph) pausePdfWikiNetworkForTopicDialog();
        pdfWikiTopicDialogNavigation = {
          preserveViewer: preserveViewer,
          originWorkspaceMode: pdfWikiWorkspaceMode || 'claims',
          originSentenceViewMode: pdfWikiSentenceViewMode || 'list',
          originPdfManagerScrollTop: typeof getPdfWikiPdfManagerScrollTop === 'function' ? getPdfWikiPdfManagerScrollTop() : 0,
          needsGraphRefresh: false,
          level: level || 'catalog',
          editorReturnTarget: editorReturnTarget || 'catalog'
        };
      } else {
        pdfWikiTopicDialogNavigation.level = level || pdfWikiTopicDialogNavigation.level;
        if (editorReturnTarget) pdfWikiTopicDialogNavigation.editorReturnTarget = editorReturnTarget;
      }
      return pdfWikiTopicDialogNavigation;
    }

    function renderPdfWikiTopicWorkspace(title, subtitle, html) {
      var titleElement = document.getElementById('pdfWikiViewerTitle');
      var subtitleElement = document.getElementById('pdfWikiViewerSubtitle');
      var content = document.getElementById('pdfWikiViewerContent');
      if (titleElement) titleElement.textContent = title;
      if (subtitleElement) subtitleElement.textContent = subtitle;
      if (!content) return false;
      content.style.display = 'flex';
      content.style.alignItems = 'stretch';
      content.style.justifyContent = 'stretch';
      content.style.overflow = 'hidden';
      content.innerHTML = html;
      return true;
    }

    function resetPdfWikiViewerContentLayout() {
      var content = document.getElementById('pdfWikiViewerContent');
      if (!content) return;
      content.style.display = 'flex';
      content.style.alignItems = 'center';
      content.style.justifyContent = 'center';
      content.style.overflow = '';
    }

    window.finishPdfWikiTopicDialog = async function() {
      stopPdfWikiSentenceTopicAnnotationPolling();
      var navigation = pdfWikiTopicDialogNavigation;
      pdfWikiTopicDialogNavigation = null;
      if (!navigation || !document.getElementById('pdfWikiViewerModal')) return;
      resetPdfWikiViewerContentLayout();
      if (navigation.originWorkspaceMode === 'pdf-manager') {
        await reloadPdfWikiPdfManager({ scrollTop: navigation.originPdfManagerScrollTop || 0 });
        return;
      }
      pdfWikiSentenceViewMode = navigation.originSentenceViewMode || pdfWikiSentenceViewMode;
      await reloadPdfWikiViewer(pdfWikiActiveSentencePointId || pdfWikiActiveEntryId);
    };

    async function refreshPdfWikiViewerAfterTopicChange() {
      if (!document.getElementById('pdfWikiViewerModal')) return;
      if (pdfWikiTopicDialogNavigation && pdfWikiTopicDialogNavigation.preserveViewer) {
        pdfWikiTopicDialogNavigation.needsGraphRefresh = true;
        return;
      }
      await reloadPdfWikiViewer(pdfWikiActiveSentencePointId || pdfWikiActiveEntryId);
    }

    window.showPdfWikiManualTopicEditor = async function(topicId, initialLabel, returnTarget) {
      if (!document.getElementById('pdfWikiViewerModal')) {
        await window.showPdfWikiViewer({
          skipInitialLoad: true,
          workspaceMode: 'claims',
          initialTitle: 'PDF Wiki 主题',
          initialSubtitle: '正在打开主题编辑...'
        });
      }
      beginPdfWikiTopicDialogNavigation('editor', returnTarget || 'catalog');
      if (!pdfWikiTopicCatalogLoaded) await loadPdfWikiTopicCatalog();
      var topics = Array.isArray(pdfWikiTopicCatalog.topics) ? pdfWikiTopicCatalog.topics : [];
      var topic = topics.find(function(item) { return item.id === topicId; }) || null;
      var title = topic ? '修改 PDF Wiki 主题' : '手动添加 PDF Wiki 主题';
      var html = '<div style="width:100%;height:100%;overflow:auto;padding:22px 26px;background:var(--bg-secondary);">' +
        '<div style="max-width:1060px;margin:0 auto;display:flex;flex-direction:column;gap:11px;color:var(--text-primary);">' +
        '<div style="display:flex;justify-content:flex-start;">' +
          '<button type="button" data-return-target="' + (returnTarget === 'graph' ? 'graph' : 'catalog') + '" onclick="returnFromPdfWikiManualTopicEditor(this.dataset.returnTarget)" style="display:inline-flex;align-items:center;padding:7px 11px;border:1px solid var(--border-color);border-radius:999px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;font-weight:700;">返回上一层级</button>' +
        '</div>' +
        '<input id="pdfWikiManualTopicId" type="hidden" value="' + escapeHtml(topic ? topic.id : '') + '">' +
        '<label style="display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:700;">主题名称<span style="font-weight:400;color:var(--text-secondary);">修改名称后，现有论点句也会重新匹配。</span>' +
          '<input id="pdfWikiManualTopicLabel" value="' + escapeHtml(topic ? topic.label : (initialLabel || '')) + '" maxlength="80" placeholder="例如：极端降雨对农田 N2O 排放的影响" style="padding:9px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' +
        '</label>' +
        '<label style="display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:700;">用途说明' +
          '<textarea id="pdfWikiManualTopicDescription" rows="2" maxlength="500" placeholder="说明该主题覆盖的研究问题" style="padding:9px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;line-height:1.5;resize:vertical;">' + escapeHtml(topic ? topic.description : '') + '</textarea>' +
        '</label>' +
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">' +
          '<label style="display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:700;">别名 / 英文名' +
            '<textarea id="pdfWikiManualTopicAliases" rows="4" placeholder="每行一个别名" style="padding:9px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;line-height:1.5;resize:vertical;">' + escapeHtml(topic && Array.isArray(topic.aliases) ? topic.aliases.join('\n') : '') + '</textarea>' +
          '</label>' +
          '<label style="display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:700;">匹配关键词' +
            '<textarea id="pdfWikiManualTopicKeywords" rows="4" placeholder="每行一个中英文关键词或短语" style="padding:9px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;line-height:1.5;resize:vertical;">' + escapeHtml(topic && Array.isArray(topic.keywords) ? topic.keywords.join('\n') : '') + '</textarea>' +
          '</label>' +
        '</div>' +
        '<label style="display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:700;">排除关键词<span style="font-weight:400;color:var(--text-secondary);">句子命中这些词时不归入该主题。</span>' +
          '<textarea id="pdfWikiManualTopicExcludeKeywords" rows="2" placeholder="每行一个容易造成误匹配的词" style="padding:9px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;line-height:1.5;resize:vertical;">' + escapeHtml(topic && Array.isArray(topic.excludeKeywords) ? topic.excludeKeywords.join('\n') : '') + '</textarea>' +
        '</label>' +
        '<div id="pdfWikiManualTopicStatus" role="status" style="min-height:17px;font-size:11px;color:var(--text-secondary);"></div>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;">' +
          '<button type="button" data-return-target="' + (returnTarget === 'graph' ? 'graph' : 'catalog') + '" onclick="returnFromPdfWikiManualTopicEditor(this.dataset.returnTarget)" style="padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">取消</button>' +
          '<button id="pdfWikiManualTopicSaveButton" type="button" onclick="savePdfWikiManualTopicDefinition()" style="padding:8px 12px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;font-weight:700;">保存并刷新图谱</button>' +
        '</div>' +
        '</div>' +
      '</div>';
      renderPdfWikiTopicWorkspace(title, '编辑主题定义和本地匹配规则，保存后重新分类已有论点句。', html);
      setTimeout(function() {
        var labelInput = document.getElementById('pdfWikiManualTopicLabel');
        if (labelInput) labelInput.focus();
      }, 0);
    };

    window.returnFromPdfWikiManualTopicEditor = function(returnTarget) {
      if (returnTarget === 'graph') {
        finishPdfWikiTopicDialog();
        return;
      }
      showPdfWikiTopicCatalogDialog();
    };

    window.showPdfWikiGraphTopicEditor = async function(topicKey, topicLabel) {
      if (!pdfWikiTopicCatalogLoaded) await loadPdfWikiTopicCatalog();
      var normalizedKey = String(topicKey || '').toLowerCase();
      var topics = Array.isArray(pdfWikiTopicCatalog.topics) ? pdfWikiTopicCatalog.topics : [];
      var topic = topics.find(function(item) {
        return String(item.id || '').toLowerCase().replace(/_/g, '-') === normalizedKey || item.label === topicLabel;
      });
      return showPdfWikiManualTopicEditor(topic ? topic.id : '', topicLabel || '', 'graph');
    };

    window.savePdfWikiManualTopicDefinition = async function() {
      if (pdfWikiTopicExpansionBusy) return;
      var labelInput = document.getElementById('pdfWikiManualTopicLabel');
      var status = document.getElementById('pdfWikiManualTopicStatus');
      var button = document.getElementById('pdfWikiManualTopicSaveButton');
      var topic = {
        id: (document.getElementById('pdfWikiManualTopicId') || {}).value || undefined,
        label: labelInput ? labelInput.value.trim() : '',
        description: (document.getElementById('pdfWikiManualTopicDescription') || {}).value || '',
        aliases: parsePdfWikiTopicTerms((document.getElementById('pdfWikiManualTopicAliases') || {}).value),
        keywords: parsePdfWikiTopicTerms((document.getElementById('pdfWikiManualTopicKeywords') || {}).value),
        excludeKeywords: parsePdfWikiTopicTerms((document.getElementById('pdfWikiManualTopicExcludeKeywords') || {}).value)
      };
      if (!topic.label) {
        if (status) { status.textContent = '请输入主题名称。'; status.style.color = 'var(--danger-color)'; }
        if (labelInput) labelInput.focus();
        return;
      }
      pdfWikiTopicExpansionBusy = true;
      if (button) { button.disabled = true; button.textContent = '正在保存并重新匹配...'; }
      if (status) { status.textContent = '正在保存主题并重新匹配已有论点句...'; status.style.color = 'var(--text-secondary)'; }
      try {
        var response = await fetch('/api/pdf-wiki/topics', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId || 'web-user', topic: topic })
        });
        var data = await response.json();
        if (!response.ok || data.success === false) throw new Error(data.message || data.error || '主题保存失败');
        pdfWikiTopicCatalogLoaded = true;
        renderPdfWikiTopicCatalog(data);
        await refreshPdfWikiViewerAfterTopicChange();
        returnFromPdfWikiManualTopicEditor(pdfWikiTopicDialogNavigation ? pdfWikiTopicDialogNavigation.editorReturnTarget : 'graph');
      } catch (error) {
        if (status) { status.textContent = error.message || String(error); status.style.color = 'var(--danger-color)'; }
      } finally {
        pdfWikiTopicExpansionBusy = false;
        if (button) { button.disabled = false; button.textContent = '保存并刷新图谱'; }
      }
    };

    window.expandAndAddPdfWikiTopics = async function() {
      if (pdfWikiTopicExpansionBusy) return;
      var input = document.getElementById('pdfWikiTopicInput');
      var topics = parsePdfWikiTopicInputs(input ? input.value : '');
      if (!topics.length) {
        setPdfWikiTopicCatalogStatus('请输入至少一个主题名称。', true);
        if (input) input.focus();
        return;
      }
      var button = document.getElementById('pdfWikiTopicExpandButton');
      pdfWikiTopicExpansionBusy = true;
      if (button) {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.innerHTML = '<span class="pdf-wiki-topic-action-spinner" aria-hidden="true"></span><span>正在扩写主题</span>';
      }
      setPdfWikiTopicCatalogStatus('AI 正在扩写主题的别名、关键词和排除词...', false);
      try {
        var response = await fetch('/api/pdf-wiki/topics/expand', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId || 'web-user', topics: topics })
        });
        var data = await response.json();
        if (!response.ok || data.success === false) throw new Error(data.message || data.error || '主题扩写失败');
        pdfWikiTopicCatalogLoaded = true;
        renderPdfWikiTopicCatalog(data);
        if (input) input.value = '';
        setPdfWikiTopicCatalogStatus('主题已保存。已同步重新匹配 ' + Number(data.reclassifiedPointCount || 0) + ' 个已有论点句。', false);
        await refreshPdfWikiViewerAfterTopicChange();
      } catch (error) {
        setPdfWikiTopicCatalogStatus(error.message || String(error), true);
      } finally {
        pdfWikiTopicExpansionBusy = false;
        if (button) {
          button.disabled = false;
          button.removeAttribute('aria-busy');
          button.innerHTML = '<span class="pdf-wiki-topic-action-icon" aria-hidden="true">✦</span><span>AI 扩写并添加</span>';
        }
      }
    };

    window.deletePdfWikiTopicDefinition = async function(topicId) {
      if (!topicId || pdfWikiTopicExpansionBusy) return;
      if (!confirm('删除后，属于该主题的已有论点句会立即重新匹配。确定删除吗？')) return;
      pdfWikiTopicExpansionBusy = true;
      setPdfWikiTopicCatalogStatus('正在删除主题并重新匹配已有论点句...', false);
      try {
        var response = await fetch('/api/pdf-wiki/topics/' + encodeURIComponent(topicId) + '?userId=' + encodeURIComponent(currentUserId || 'web-user'), { method: 'DELETE' });
        var data = await response.json();
        if (!response.ok || data.success === false) throw new Error(data.message || data.error || '主题删除失败');
        renderPdfWikiTopicCatalog(data);
        setPdfWikiTopicCatalogStatus('主题已删除。已同步重新匹配 ' + Number(data.reclassifiedPointCount || 0) + ' 个已有论点句。', false);
        await refreshPdfWikiViewerAfterTopicChange();
      } catch (error) {
        setPdfWikiTopicCatalogStatus(error.message || String(error), true);
      } finally {
        pdfWikiTopicExpansionBusy = false;
      }
    };

    function pdfWikiTopicCatalogPanelHtml(showManualButton, expandedHeight) {
      return '<section class="pdf-wiki-topic-panel"' + (expandedHeight ? ' style="flex:1;"' : '') + '>' +
        '<div class="pdf-wiki-topic-panel-heading">' +
          '<div>' +
            '<div class="pdf-wiki-topic-panel-title">用户主题库</div>' +
            '<div class="pdf-wiki-topic-panel-description">每行输入一个主题。AI 只在添加时扩写主题；PDF 入库和已有论点重分类均由本地代码完成，不使用系统内置主题。</div>' +
          '</div>' +
        '</div>' +
        '<div class="pdf-wiki-topic-composer">' +
          '<textarea id="pdfWikiTopicInput" rows="2" aria-label="PDF Wiki 用户主题" placeholder="例如：极端降雨对农田 N2O 排放的影响&#10;长期施氮的遗留效应"></textarea>' +
          '<div class="pdf-wiki-topic-composer-actions">' +
            (showManualButton ? '<button type="button" class="pdf-wiki-topic-action" onclick="showPdfWikiManualTopicEditor()"><span class="pdf-wiki-topic-action-icon" aria-hidden="true">＋</span><span>手动添加</span></button>' : '') +
            '<button id="pdfWikiTopicExpandButton" type="button" class="pdf-wiki-topic-action pdf-wiki-topic-action-primary" onclick="expandAndAddPdfWikiTopics()"><span class="pdf-wiki-topic-action-icon" aria-hidden="true">✦</span><span>AI 扩写并添加</span></button>' +
          '</div>' +
        '</div>' +
        '<div class="pdf-wiki-topic-annotation-card">' +
          '<div style="min-width:0;">' +
            '<div class="pdf-wiki-topic-annotation-title">AI 逐句主题标注 · 1–5 个学术主题 + 1 个趋势/结论主题</div>' +
            '<div id="pdfWikiSentenceTopicAnnotationMessage" class="pdf-wiki-topic-annotation-message">正在读取句子标注记录…</div>' +
            '<div class="pdf-wiki-topic-annotation-progress" aria-hidden="true"><span id="pdfWikiSentenceTopicAnnotationProgressValue"></span></div>' +
          '</div>' +
          '<div class="pdf-wiki-topic-annotation-actions">' +
            '<button id="pdfWikiSentenceTopicAnnotationForceButton" type="button" class="pdf-wiki-topic-action" onclick="startPdfWikiSentenceTopicAnnotation(true)"><span>重标全部</span></button>' +
            '<button id="pdfWikiSentenceTopicAnnotationButton" type="button" class="pdf-wiki-topic-action pdf-wiki-topic-action-primary" onclick="startPdfWikiSentenceTopicAnnotation(false)"><span class="pdf-wiki-topic-action-icon" aria-hidden="true">✦</span><span>AI 标注新增句子</span></button>' +
          '</div>' +
        '</div>' +
        '<div id="pdfWikiTopicCatalogStatus" class="pdf-wiki-topic-status" role="status">正在读取用户主题库...</div>' +
        '<div id="pdfWikiTopicCatalogList" style="margin-top:5px;' + (expandedHeight ? 'flex:1;min-height:280px;' : 'max-height:250px;') + 'overflow:auto;scrollbar-gutter:stable;"></div>' +
        '</section>';
    }

    window.showPdfWikiTopicCatalogDialog = async function() {
      if (!document.getElementById('pdfWikiViewerModal')) {
        await window.showPdfWikiViewer({
          skipInitialLoad: true,
          workspaceMode: 'claims',
          initialTitle: 'PDF Wiki 用户主题库',
          initialSubtitle: '正在读取用户主题库...'
        });
      }
      beginPdfWikiTopicDialogNavigation('catalog', 'catalog');
      renderPdfWikiTopicWorkspace('PDF Wiki 用户主题库', '在 PDF Wiki 内管理主题、匹配词和排除词。',
        '<div style="width:100%;height:100%;display:flex;flex-direction:column;gap:12px;padding:20px 24px 40px;background:var(--bg-secondary);color:var(--text-primary);">' +
          pdfWikiTopicCatalogPanelHtml(true, true) +
          '<div style="display:flex;justify-content:flex-end;gap:8px;">' +
            '<button type="button" onclick="finishPdfWikiTopicDialog()" style="padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">取消</button>' +
            '<button type="button" onclick="finishPdfWikiTopicDialog()" style="padding:8px 12px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;font-weight:700;">完成</button>' +
          '</div>' +
        '</div>');
      setTimeout(function() {
        loadPdfWikiTopicCatalog();
        loadPdfWikiSentenceTopicAnnotationStatus();
      }, 0);
    };

    function showPdfWikiUploadOptionsDialog(files) {
      pendingPdfWikiUploadFiles = Array.prototype.slice.call(files || []);
      var defaultOptions = getDefaultPdfWikiUploadOptions();
      var fileNames = pendingPdfWikiUploadFiles.map(function(file) { return escapeHtml(file.name || 'PDF'); }).slice(0, 6).join('、');
      if (pendingPdfWikiUploadFiles.length > 6) fileNames += ' 等 ' + pendingPdfWikiUploadFiles.length + ' 个文件';
      var codexLabel = (chatBridgeConfig && chatBridgeConfig.codex && chatBridgeConfig.codex.model)
        ? ('Codex CLI (' + chatBridgeConfig.codex.model + ')')
        : 'Codex CLI';
      var html = '' +
        '<div style="display:flex;flex-direction:column;gap:12px;color:var(--text-primary);">' +
          '<div style="padding:11px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);font-size:12px;line-height:1.6;color:var(--text-secondary);">' +
            '<div style="font-weight:700;color:var(--text-primary);margin-bottom:4px;">本次将上传并分析：' + fileNames + '</div>' +
            '默认使用快速句子库；只有选择完整深度时才会生成全文结构、表格和图片等重型产物。这里的选择只对本次上传生效。' +
          '</div>' +
          pdfWikiTopicCatalogPanelHtml(false, false) +
          '<div style="border:1px solid var(--border-color);border-radius:8px;padding:0 12px;background:var(--bg-primary);">' +
            '<div style="padding:10px 0;border-bottom:1px solid var(--border-color);">' +
              '<div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">处理方案</div>' +
              '<select id="pdfWikiProcessingProfile" onchange="applyPdfWikiProcessingProfile(this.value)" style="width:100%;padding:8px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' +
                '<option value="fast"' + (defaultOptions.processingProfile === 'fast' ? ' selected' : '') + '>快速：只生成句子级 Wiki（推荐）</option>' +
                '<option value="deep"' + (defaultOptions.processingProfile === 'deep' ? ' selected' : '') + '>深度：全文、兼容论点、表格/图片和可选 Meta</option>' +
                '<option value="custom"' + (defaultOptions.processingProfile === 'custom' ? ' selected' : '') + '>自定义各阶段</option>' +
              '</select>' +
              '<div id="pdfWikiProcessingProfileHint" style="margin-top:6px;font-size:12px;line-height:1.45;color:var(--text-secondary);"></div>' +
            '</div>' +
            pdfWikiTaskRow('1. PDF 文本提取', '决定先用什么方式读 PDF 全文。自动模式会优先 Codex CLI；没有 Codex 时默认 LiteParse，再按千问国内预设做结构化和图表 OCR。',
              pdfWikiTaskSelect('pdfWikiTaskTextExtractionEngine', defaultOptions.textExtractionEngine, [
                { value: 'auto', label: '自动：' + codexLabel + ' → LiteParse → qwen-long/qwen-max → qwen-vl-ocr/qwen-vl-max' },
                { value: 'codex', label: '优先 Codex CLI' },
                { value: 'liteparse', label: 'LiteParse 本地解析' },
                { value: 'marker', label: 'Marker 高精度外部工具' },
                { value: 'fast-text', label: 'pdf-marker-md 快速文本' },
                { value: 'qwen-long', label: '千问 API 直读/长文本兜底' },
                { value: 'pdf-parse', label: '本地 pdf-parse' }
              ])
            ) +
            pdfWikiTaskRow('2. 文件元信息/参考来源', '抽取标题、作者/来源、年份、出版物/机构、DOI，并整理 References。选本地时不调用 LLM，只做规则解析。',
              pdfWikiTaskSelect('pdfWikiTaskMetadataEngine', defaultOptions.metadataEngine, [
                { value: 'auto', label: '自动：LLM/API + 本地回退' },
                { value: 'api', label: 'PDF Wiki API/小牛马' },
                { value: 'local', label: '仅本地规则' }
              ])
            ) +
            pdfWikiTaskRow('3. 句子-参考文献匹配', '逐句检查引言和讨论中的句中/句末引用，与文末 References 对齐；无可核验引用的句子不进入论点库。结论由 Codex 归纳后绑定来源论文自身的引用信息。',
              pdfWikiTaskSelect('pdfWikiTaskSentenceReferenceMatchingEngine', defaultOptions.sentenceReferenceMatchingEngine, [
                { value: 'auto', label: '自动：AI 校准 + 本地兜底' },
                { value: 'codex', label: 'Codex：严格引用句 + 本文结论（快速模式）' },
                { value: 'api', label: '强制 API/小牛马校准' },
                { value: 'local', label: '仅本地显式引用匹配' }
              ])
            ) +
            pdfWikiTaskRow('4. 兼容论点/正反论据抽取', '保留旧 AutoResearch/检索兼容数据；新 Wiki 展示优先使用 Wiki论点库。',
              pdfWikiTaskSelect('pdfWikiTaskClaimExtractionEngine', defaultOptions.claimExtractionEngine, [
                { value: 'off', label: '关闭：跳过旧兼容论点（推荐用于句子级 Wiki）' },
                { value: 'auto', label: '自动：Codex CLI → 千问国内预设 → 小牛马' },
                { value: 'codex', label: '优先 Codex CLI' },
                { value: 'qwen-long', label: '千问国内预设 API' },
                { value: 'api', label: 'PDF Wiki API/小牛马' }
              ])
            ) +
            pdfWikiTaskRow('5. 跨 PDF 兼容论点合并', '把不同 PDF 中语义相同或相近的兼容论点整合成论点组，并生成中文展示名。',
              pdfWikiTaskSelect('pdfWikiTaskGroupingEngine', defaultOptions.groupingEngine, [
                { value: 'auto', label: '自动：Codex CLI → API → 本地' },
                { value: 'codex', label: '优先 Codex CLI' },
                { value: 'api', label: 'PDF Wiki API/小牛马' },
                { value: 'local', label: '仅本地规则' }
              ])
            ) +
            '<div style="padding:10px 0;border-bottom:1px solid var(--border-color);">' +
              '<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--text-primary);cursor:pointer;">' +
                '<input id="pdfWikiMetaAnalysisEnabled" type="checkbox"' + (defaultOptions.metaAnalysisEnabled ? ' checked' : '') + ' onchange="markPdfWikiProcessingProfileCustom()" style="width:14px;height:14px;">生成 Meta 分析数据表' +
              '</label>' +
              '<div style="margin:4px 0 9px 22px;font-size:12px;line-height:1.45;color:var(--text-secondary);">按用户上传的 Excel/CSV 模板，把材料与方法、结果、表格、图和补充材料中的指标拆成逐列数据。关闭后不生成 meta_analysis_rows；兼容论点是否生成取决于上方选项。</div>' +
              pdfWikiTaskSelect('pdfWikiTaskMetaAnalysisEngine', defaultOptions.metaAnalysisEngine, [
                { value: 'auto', label: '自动：优先 Codex CLI' },
                { value: 'codex', label: 'Codex CLI 提取 Meta 表' },
                { value: 'api', label: 'PDF Wiki API/小牛马提取 Meta 表' },
                { value: 'off', label: '不生成 Meta 数据表' }
              ]) +
            '</div>' +
          '</div>' +
          '<div style="display:flex;justify-content:flex-end;gap:8px;">' +
            '<button type="button" onclick="cancelPdfWikiUploadOptions()" style="padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">取消</button>' +
            '<button type="button" onclick="confirmPdfWikiUploadOptions()" style="padding:8px 12px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">上传并分析</button>' +
          '</div>' +
        '</div>';
      showModal('上传 PDF 生成 Wiki论点库', html, true);
      setTimeout(function() {
        syncPdfWikiMetaAnalysisControl();
        updatePdfWikiProcessingProfileHint(defaultOptions.processingProfile || 'fast');
        loadPdfWikiTopicCatalog();
      }, 0);
    }

    window.cancelPdfWikiUploadOptions = function() {
      pendingPdfWikiUploadFiles = null;
      confirmedPdfWikiUploadOptions = null;
      if (pendingPdfWikiUploadInput) pendingPdfWikiUploadInput.value = '';
      pendingPdfWikiUploadInput = null;
      closeModal();
    };

    window.confirmPdfWikiUploadOptions = function() {
      if (!pendingPdfWikiUploadFiles || pendingPdfWikiUploadFiles.length === 0) {
        closeModal();
        return;
      }
      if (pdfWikiTopicExpansionBusy) {
        alert('AI 正在扩写或更新主题，请完成后再上传 PDF。');
        return;
      }
      if (!pdfWikiTopicCatalogLoaded) {
        alert('主题库仍在读取，请稍后再试。');
        return;
      }
      if (!(pdfWikiTopicCatalog.topics || []).length && !confirm('当前没有用户主题。上传后所有论点句都会进入“未分类”，是否继续？')) {
        return;
      }
      confirmedPdfWikiUploadOptions = collectPdfWikiUploadOptions();
      if (!confirmedPdfWikiUploadOptions.metaAnalysisEnabled) {
        confirmedPdfWikiUploadOptions.metaAnalysisEngine = 'off';
      }
      localStorage.setItem(PDF_WIKI_TASK_OPTIONS_KEY, JSON.stringify(confirmedPdfWikiUploadOptions));
      var files = pendingPdfWikiUploadFiles;
      var input = pendingPdfWikiUploadInput;
      pendingPdfWikiUploadFiles = null;
      pendingPdfWikiUploadInput = null;
      closeModal();
      handleLiteratureFileInputChange({ target: { files: files, value: '' } }).finally(function() {
        if (input) input.value = '';
      });
    };
    
    function getPdfWikiProgressMetrics(progress) {
      progress = progress && typeof progress === 'object' ? progress : {};
      var workProgress = progress.workProgress && typeof progress.workProgress === 'object' ? progress.workProgress : null;
      var completedUnits = workProgress ? Number(workProgress.completedUnits || 0) : 0;
      var totalUnits = workProgress ? Number(workProgress.totalUnits || 0) : 0;
      var hasStableUnits = Number.isFinite(completedUnits) && Number.isFinite(totalUnits) && totalUnits > 0;
      var percent = 0;
      if (progress.status === 'completed') percent = 100;
      else if (hasStableUnits) percent = Math.round(Math.max(0, Math.min(1, completedUnits / totalUnits)) * 100);
      var totalPdfs = Math.max(0, Number(progress.totalPdfs || 0));
      var processedPdfs = Math.max(0, Number(progress.processedPdfs || 0));
      var failedPdfs = Math.max(0, Number(progress.failedPdfs || 0));
      return {
        workProgress: workProgress,
        completedUnits: completedUnits,
        totalUnits: totalUnits,
        hasStableUnits: hasStableUnits,
        percent: Math.max(0, Math.min(100, percent)),
        totalPdfs: totalPdfs,
        processedPdfs: processedPdfs,
        failedPdfs: failedPdfs,
        handledPdfs: Math.min(totalPdfs, processedPdfs + failedPdfs),
      };
    }

    async function calculateBrowserFileSha256(file) {
      if (!window.crypto || !window.crypto.subtle || !file || typeof file.arrayBuffer !== 'function') return '';
      var digest = await window.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      return Array.prototype.map.call(new Uint8Array(digest), function(value) {
        return value.toString(16).padStart(2, '0');
      }).join('');
    }

    async function filterPreviouslyUploadedPdfFiles(files) {
      var result = { files: files.slice(), duplicates: [], checked: false };
      var pdfItems = [];
      var seenInSelection = new Set();
      var localDuplicates = [];
      for (var index = 0; index < files.length; index++) {
        var file = files[index];
        if (!/\.pdf$/i.test(file.name || '') && String(file.type || '').toLowerCase() !== 'application/pdf') continue;
        var sha256 = await calculateBrowserFileSha256(file);
        if (!sha256) return result;
        if (seenInSelection.has(sha256)) {
          localDuplicates.push({ file: file, sha256: sha256 });
          continue;
        }
        seenInSelection.add(sha256);
        pdfItems.push({ file: file, sha256: sha256 });
      }
      if (!pdfItems.length) return result;

      try {
        var response = await fetch('/api/pdf-wiki/upload/check-duplicates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            files: pdfItems.map(function(item) {
              return { name: item.file.name, size: item.file.size, sha256: item.sha256 };
            })
          })
        });
        var data = await response.json();
        if (!response.ok || !data.success) return result;
        var existingHashes = new Set((data.duplicates || []).map(function(item) { return String(item.sha256 || '').toLowerCase(); }));
        var excludedFiles = new Set(localDuplicates.map(function(item) { return item.file; }));
        pdfItems.forEach(function(item) {
          if (existingHashes.has(item.sha256)) excludedFiles.add(item.file);
        });
        result.files = files.filter(function(file) { return !excludedFiles.has(file); });
        result.duplicates = files.filter(function(file) { return excludedFiles.has(file); });
        result.checked = true;
        return result;
      } catch (error) {
        console.warn('[PdfWiki] 上传前重复检查失败，将由后端继续去重:', error);
        return result;
      }
    }

    async function handleLiteratureFileInputChange(e) {
      var labels = getProjectUiLabels();
      var evidenceName = getProjectEvidenceItemName();
      var selectedFiles = Array.prototype.slice.call((e && e.target && e.target.files) || []);
      if (selectedFiles.length === 0) return;
      var isDedicatedPdfInput = e && e.target && e.target.id === 'pdfFileInput';
      var uploadMode = (e && e.target && e.target.dataset && e.target.dataset.pdfUploadMode) || 'full';
      var isPdfManagerLiteUpload = uploadMode === 'manager-lite';
      var containsPdfUpload = isDedicatedPdfInput || selectedFiles.some(function(fileForPdfCheck) {
        return (fileForPdfCheck.type || '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(fileForPdfCheck.name || '');
      });
      console.log('[PDF Wiki Upload] selectedFiles=', selectedFiles.map(function(file) {
        return { name: file.name, type: file.type, size: file.size };
      }), 'containsPdfUpload=', containsPdfUpload, 'mode=', uploadMode, 'hasOptions=', !!confirmedPdfWikiUploadOptions);
      if (containsPdfUpload && !isPdfManagerLiteUpload && !confirmedPdfWikiUploadOptions) {
        pendingPdfWikiUploadFiles = selectedFiles;
        pendingPdfWikiUploadInput = e.target || null;
        showPdfWikiUploadOptionsDialog(selectedFiles);
        return;
      }
      var pdfWikiTaskOptions = isPdfManagerLiteUpload
        ? {
          version: PDF_WIKI_TASK_OPTIONS_VERSION,
          processingProfile: 'fast',
          textExtractionEngine: 'liteparse',
          metadataEngine: 'local',
          claimExtractionEngine: 'off',
          sentenceReferenceMatchingEngine: 'local',
          groupingEngine: 'local',
          metaAnalysisEnabled: false,
          metaAnalysisEngine: 'off'
        }
        : (confirmedPdfWikiUploadOptions || getDefaultPdfWikiUploadOptions());
      confirmedPdfWikiUploadOptions = null;

      if (containsPdfUpload && !isPdfManagerLiteUpload) {
        var duplicatePreflight = await filterPreviouslyUploadedPdfFiles(selectedFiles);
        selectedFiles = duplicatePreflight.files;
        if (duplicatePreflight.duplicates.length > 0) {
          appendMessage('已在上传前排除 ' + duplicatePreflight.duplicates.length + ' 篇重复 PDF：\n' + duplicatePreflight.duplicates.map(function(file) {
            return '• ' + file.name;
          }).join('\n'), 'bot', false, true);
        }
        if (selectedFiles.length === 0) {
          appendMessage('所选 PDF 均已处理或已在队列中，无需重复上传。', 'bot', false, true);
          if (e && e.target) e.target.value = '';
          return;
        }
      }
      
      var formData = new FormData();
      for (var i = 0; i < selectedFiles.length; i++) {
        formData.append('files', selectedFiles[i]);
      }
      formData.append('userId', currentUserId);
      
      // 添加 API 配置用于生成 embedding
      var embeddingConfig = getEmbeddingConfig();
      console.log('[Upload] Embedding config from localStorage:', {
        url: embeddingConfig.url ? '已配置' : '空',
        key: embeddingConfig.key ? '已配置' : '空',
        model: embeddingConfig.model,
        enabled: embeddingConfig.enabled
      });
      
      // 判断是否配置了可用的 embedding（需要 URL 和 key 都有值）
      var hasEmbeddingConfig = embeddingConfig.enabled !== false && !!embeddingConfig.url && !!embeddingConfig.key;
      console.log('[Upload] hasEmbeddingConfig:', hasEmbeddingConfig);
      var pdfWikiLlmConfig = getPdfWikiLlmConfig();
      var hasPdfWikiLlmConfig = !!pdfWikiLlmConfig.apiUrl && !!pdfWikiLlmConfig.apiKey;
      
      // 发送配置到后端（如果有）
      if (embeddingConfig.url) formData.append('embeddingUrl', embeddingConfig.url);
      if (embeddingConfig.key) formData.append('embeddingKey', embeddingConfig.key);
      if (embeddingConfig.model) formData.append('embeddingModel', embeddingConfig.model);
      if (embeddingConfig.dimensions) formData.append('embeddingDimensions', embeddingConfig.dimensions.toString());
      // 如果 localStorage 有配置，使用它的 enabled；否则让后端决定
      if (embeddingConfig.url) {
        formData.append('embeddingEnabled', embeddingConfig.enabled !== false ? 'true' : 'false');
      }
      if (pdfWikiLlmConfig.apiUrl) formData.append('pdfWikiApiUrl', pdfWikiLlmConfig.apiUrl);
      if (pdfWikiLlmConfig.apiKey) formData.append('pdfWikiApiKey', pdfWikiLlmConfig.apiKey);
      if (pdfWikiLlmConfig.textInApiUrl) formData.append('pdfWikiTextInApiUrl', pdfWikiLlmConfig.textInApiUrl);
      if (pdfWikiLlmConfig.textInAppId) formData.append('pdfWikiTextInAppId', pdfWikiLlmConfig.textInAppId);
      if (pdfWikiLlmConfig.textInSecretCode) formData.append('pdfWikiTextInSecretCode', pdfWikiLlmConfig.textInSecretCode);
      if (pdfWikiLlmConfig.textInParseMode) formData.append('pdfWikiTextInParseMode', pdfWikiLlmConfig.textInParseMode);
      if (containsPdfUpload) {
        formData.append('pdfUploadMode', isPdfManagerLiteUpload ? 'manager-lite' : 'full');
        formData.append('pdfWikiProcessingProfile', pdfWikiTaskOptions.processingProfile || 'custom');
        formData.append('pdfWikiTextExtractionEngine', pdfWikiTaskOptions.textExtractionEngine || 'auto');
        formData.append('pdfWikiMetadataEngine', pdfWikiTaskOptions.metadataEngine || 'auto');
        formData.append('pdfWikiClaimExtractionEngine', pdfWikiTaskOptions.claimExtractionEngine || 'auto');
        formData.append('pdfWikiSentenceReferenceMatchingEngine', pdfWikiTaskOptions.sentenceReferenceMatchingEngine || 'auto');
        formData.append('pdfWikiGroupingEngine', pdfWikiTaskOptions.groupingEngine || 'auto');
        formData.append('pdfWikiMetaAnalysisEnabled', pdfWikiTaskOptions.metaAnalysisEnabled === false ? 'false' : 'true');
        formData.append('pdfWikiMetaAnalysisEngine', pdfWikiTaskOptions.metaAnalysisEnabled === false ? 'off' : (pdfWikiTaskOptions.metaAnalysisEngine || 'auto'));
        formData.append('pdfWikiMetaAnalysisUserRequirements', getPdfWikiMetaUserRequirementsForRequest());
      }
      // 如果 localStorage 没有配置，不发送 embeddingEnabled，让后端使用服务器配置
      console.log('[Upload] Sending embeddingEnabled:', embeddingConfig.url ? (embeddingConfig.enabled !== false ? 'true' : 'false') : '(use server config)');
      
      // 创建进度显示元素
      var progressInterval = null;
      var uploadStartTime = Date.now();
      var progressDiv = null;
      var uploadProgressElement = null;
      var pdfWikiBatchProgressTracker = containsPdfUpload && !isPdfManagerLiteUpload && selectedFiles.length > 1 && selectedFiles.every(function(file) {
        return /\.pdf$/i.test(file.name || '') || String(file.type || '').toLowerCase() === 'application/pdf';
      }) ? {
        totalPdfs: selectedFiles.length,
        uploadedPdfs: 0,
        processedPdfs: 0,
        failedPdfs: 0,
        jobIds: new Set(),
        completedJobIds: new Set(),
        failedJobIds: new Set(),
        startedAt: uploadStartTime,
        fileNames: new Set(selectedFiles.map(function(file) { return String(file.name || ''); }))
      } : null;
      var statusMsg = hasEmbeddingConfig 
        ? '正在上传并解析' + evidenceName + '...\n\n解析完成后将自动生成向量嵌入'
        : '正在上传并解析' + evidenceName + '...';
      if (containsPdfUpload) {
        if (isPdfManagerLiteUpload) {
          statusMsg = '正在上传 PDF，并按“重新识别PDF”流程提取标题、作者、正文缓存、参考文献和图片。';
        } else {
          var codexModelLabel = (chatBridgeConfig && chatBridgeConfig.codex && chatBridgeConfig.codex.model) ? chatBridgeConfig.codex.model : 'Codex CLI';
          statusMsg += '\n\nPDF Wiki 本次任务配置：' +
            '\n• 处理方案：' + (pdfWikiTaskOptions.processingProfile === 'fast' ? '快速句子库' : (pdfWikiTaskOptions.processingProfile === 'deep' ? '完整深度' : '自定义')) +
            '\n• 文本提取：' + (pdfWikiTaskOptions.textExtractionEngine || 'auto') +
            '\n• 句子引用匹配：' + (pdfWikiTaskOptions.sentenceReferenceMatchingEngine || 'auto') +
            '\n• 兼容论点抽取：' + (pdfWikiTaskOptions.claimExtractionEngine || 'auto') +
            '\n• 兼容论点合并：' + (pdfWikiTaskOptions.groupingEngine || 'auto') +
            '\n• Meta 数据表：' + (pdfWikiTaskOptions.metaAnalysisEnabled === false ? '不生成' : (pdfWikiTaskOptions.metaAnalysisEngine || 'auto')) +
            '\n• Codex：' + (pdfWikiTaskOptions.processingProfile === 'fast' ? '不调用（纯代码提取）' : codexModelLabel);
          if (pdfWikiTaskOptions.processingProfile === 'fast') {
            statusMsg += '\n快速模式使用本地代码提取引言、讨论、结论和 References，并按句中/句末显式引用确定性匹配尾注；歧义引用不会猜测，也不会生成全表格、全图片、旧兼容论点或 Meta 数据。';
          } else {
            statusMsg += '\n深度分析耗时较长，请耐心等待；如果 PDF 较多，可以在配置页面增加 Codex CLI 的并发数量。';
          }
          if (pdfWikiTaskOptions.processingProfile !== 'fast' && !hasPdfWikiLlmConfig) {
            statusMsg += '\nPDF 文本会使用 LiteParse / Marker / 本机快速文本工具；结构化抽取默认使用千问预设模型，或降级小牛马 API。';
          } else if (pdfWikiTaskOptions.processingProfile !== 'fast') {
            statusMsg += '\n现有 API 会作为 Codex 不可用时的降级通道。';
          }
        }
      }
      if (isPdfManagerLiteUpload) {
        clearPdfWikiManagerUploadAutoHideTimer();
        pdfWikiManagerUploadRunning = true;
        pdfWikiManagerUploadProgress = {
          status: 'processing',
          totalPdfs: selectedFiles.length,
          processedPdfs: 0,
          failedPdfs: 0,
          figureCount: 0,
          message: statusMsg,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        if (!updatePdfWikiManagerUploadStatusBarOnly() && pdfWikiPdfManagerData && document.getElementById('pdfWikiPdfManagerScroll')) {
          renderPdfWikiPdfManagerPreservingScroll();
        }
        progressInterval = setInterval(async function() {
          try {
            var statusResponse = await fetch('/api/pdf-wiki/status?userId=' + encodeURIComponent(currentUserId));
            var statusData = await statusResponse.json();
            if (statusData && !statusData.error) {
              pdfWikiManagerUploadProgress = Object.assign({}, pdfWikiManagerUploadProgress || {}, statusData);
              if (!updatePdfWikiManagerUploadStatusBarOnly() && pdfWikiPdfManagerData && document.getElementById('pdfWikiPdfManagerScroll')) {
                renderPdfWikiPdfManagerPreservingScroll();
              }
            }
          } catch (pollError) {
            console.warn('[PdfWiki] PDF 管理上传进度读取失败:', pollError);
          }
        }, 1000);
      } else {
        progressDiv = document.createElement('div');
        progressDiv.className = 'message bot';
        progressDiv.innerHTML = '<div class="avatar bot">' + getMessageAvatarHtml('bot') + '</div><div class="content"><div data-upload-progress="true">' + renderPlainStatusText(statusMsg) + '</div></div>';
        uploadProgressElement = progressDiv.querySelector('[data-upload-progress="true"]');
        messagesDiv.appendChild(progressDiv);
        if (containsPdfUpload) {
          updatePdfWikiProgressUI({
            status: 'processing',
            totalPdfs: selectedFiles.length,
            processedPdfs: 0,
            failedPdfs: 0,
            uploadingPdfs: selectedFiles.length,
            message: '正在上传 ' + selectedFiles.length + ' 篇 PDF；文件接收完成后会立即写入持久化队列',
          }, 0);
        }
        maybeScrollChatToBottom(true);
      }
      
      // 通用进度更新函数
      function updateProgressUI(progress, elapsed) {
        var progressEl = uploadProgressElement;
        if (!progressEl) return;
        
        if (progress.status === 'processing') {
          var percent = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
          setPlainStatusHtml(progressEl, '正在生成向量嵌入...\n\n' +
            '进度: ' + progress.processed + '/' + progress.total + ' (' + percent + '%)\n' +
            '批次: ' + progress.currentBatch + '/' + progress.totalBatches + '\n' +
            '用时: ' + elapsed + ' 秒\n\n',
            '<div style="background:var(--bg-secondary);border-radius:4px;height:8px;overflow:hidden;margin-top:8px;">' +
            '<div style="background:var(--accent-color);height:100%;width:' + percent + '%;transition:width 0.3s;"></div>' +
            '</div>');
          maybeScrollChatToBottom();
        } else if (progress.status === 'error') {
          setPlainStatusHtml(progressEl, '向量嵌入生成失败\n\n' +
            (progress.message || '未知错误') + '\n\n' +
            '请检查 Embedding API 配置是否正确');
          maybeScrollChatToBottom();
        } else if (progress.status === 'idle') {
          setPlainStatusHtml(progressEl, '正在解析' + evidenceName + '... (已用时 ' + elapsed + ' 秒)\n\n' +
            '解析完成后将自动生成向量嵌入\n\n',
            '<div style="background:var(--bg-secondary);border-radius:4px;height:4px;overflow:hidden;margin-top:8px;">' +
            '<div style="background:var(--text-secondary);height:100%;width:50%;animation:pulse 1.5s infinite;"></div>' +
            '</div>' +
            '<style>@keyframes pulse{0%,100%{opacity:0.3}50%{opacity:1}}</style>');
        }
      }

      function updatePdfWikiProgressUI(progress, elapsed) {
        var progressEl = uploadProgressElement;
        if (!progressEl) return;

        var metrics = getPdfWikiProgressMetrics(progress);
        var totalPdfs = metrics.totalPdfs;
        var processedPdfs = metrics.processedPdfs;
        var totalChunks = Number(progress.totalChunks || 0);
        var processedChunks = Number(progress.processedChunks || 0);
        var entryCount = Number(progress.entryCount || 0);
        var sentencePointCount = Number(progress.sentencePointCount || 0);
        var message = String(progress.message || '');
        var queue = progress.queue && typeof progress.queue === 'object' ? progress.queue : {};
        var queuedPdfs = Number(queue.queuedPdfs || 0);
        var runningPdfs = Number(queue.runningPdfs || 0);
        var uploadingPdfs = Number(progress.uploadingPdfs || 0);
        var failedPdfs = metrics.failedPdfs;
        var workProgress = metrics.workProgress;
        var completedUnits = metrics.completedUnits;
        var totalUnits = metrics.totalUnits;
        var hasStableUnits = metrics.hasStableUnits;
        var percent = metrics.percent;
        if (pdfWikiBatchProgressTracker) {
          var batchJobs = Array.isArray(queue.jobs) ? queue.jobs.filter(function(job) {
            var createdAt = Date.parse(job.createdAt || '') || 0;
            var belongsToTrackedJob = pdfWikiBatchProgressTracker.jobIds.has(String(job.id || ''));
            var belongsToNamedBatch = Array.isArray(job.files) && job.files.some(function(file) {
              return pdfWikiBatchProgressTracker.fileNames.has(String(file.originalname || ''));
            });
            return belongsToTrackedJob || (belongsToNamedBatch && createdAt >= pdfWikiBatchProgressTracker.startedAt - 5000);
          }) : [];
          batchJobs.forEach(function(job) {
            var jobId = String(job.id || '');
            if (!jobId || !pdfWikiBatchProgressTracker.jobIds.has(jobId)) return;
            if (job.status === 'completed') pdfWikiBatchProgressTracker.completedJobIds.add(jobId);
            if (job.status === 'error') pdfWikiBatchProgressTracker.failedJobIds.add(jobId);
          });
          var observedProcessedPdfs = batchJobs.filter(function(job) { return job.status === 'completed'; }).reduce(function(sum, job) {
            return sum + Math.max(1, Array.isArray(job.files) ? job.files.length : 1);
          }, 0);
          var observedFailedPdfs = batchJobs.filter(function(job) { return job.status === 'error'; }).reduce(function(sum, job) {
            return sum + Math.max(1, Array.isArray(job.files) ? job.files.length : 1);
          }, 0);
          // 单篇内部状态会先于队列任务状态写入。轮询恰好落在两次写入之间时，
          // queue.jobs 可能暂时仍显示 running；批次累计值必须只增不减，不能回退到 0。
          pdfWikiBatchProgressTracker.processedPdfs = Math.max(pdfWikiBatchProgressTracker.processedPdfs, observedProcessedPdfs);
          pdfWikiBatchProgressTracker.failedPdfs = Math.max(pdfWikiBatchProgressTracker.failedPdfs, observedFailedPdfs);
          processedPdfs = pdfWikiBatchProgressTracker.processedPdfs;
          failedPdfs = pdfWikiBatchProgressTracker.failedPdfs;
          totalPdfs = pdfWikiBatchProgressTracker.totalPdfs;
          uploadingPdfs = Math.max(0, totalPdfs - pdfWikiBatchProgressTracker.uploadedPdfs);
          completedUnits = Math.min(totalPdfs, processedPdfs + failedPdfs);
          totalUnits = totalPdfs;
          hasStableUnits = totalUnits > 0;
          percent = totalUnits > 0 ? Math.round(completedUnits / totalUnits * 100) : 0;
        }
        var progressBarHtml = '';
        if (progress.status === 'processing' && !hasStableUnits) {
          progressBarHtml = '<div role="progressbar" aria-label="当前阶段无法精确量化" style="background:var(--bg-secondary);border-radius:4px;height:8px;overflow:hidden;margin-top:8px;">' +
            '<div style="background:#000000;height:100%;width:32%;animation:pdfWikiIndeterminateProgress 1.35s ease-in-out infinite;"></div>' +
          '</div><style>@keyframes pdfWikiIndeterminateProgress{0%{transform:translateX(-120%)}100%{transform:translateX(330%)}}</style>';
        } else {
          progressBarHtml = '<div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '" style="background:var(--bg-secondary);border-radius:4px;height:8px;overflow:hidden;margin-top:8px;">' +
            '<div style="background:#000000;height:100%;width:' + percent + '%;transition:width 0.3s;"></div>' +
          '</div>';
        }
        var currentPdfIndex = workProgress ? Number(workProgress.currentPdfIndex || 0) : 0;
        var currentPdfName = workProgress ? String(workProgress.currentPdfName || '') : '';
        var phaseLabel = workProgress ? String(workProgress.phaseLabel || '') : '';
        var attempt = workProgress ? Number(workProgress.attempt || 0) : 0;
        var maxAttempts = workProgress ? Number(workProgress.maxAttempts || 0) : 0;
        var attemptElapsedSeconds = workProgress ? Math.round(Number(workProgress.attemptElapsedMs || 0) / 1000) : 0;
        var handledPdfs = pdfWikiBatchProgressTracker ? completedUnits : metrics.handledPdfs;
        var progressLines = hasStableUnits
          ? (pdfWikiBatchProgressTracker ? '文件处理进度: ' : '真实步骤: ') + completedUnits + '/' + totalUnits + ' (' + percent + '%)\n'
          : '真实步骤: 当前阶段无法精确量化\n';
        if (pdfWikiBatchProgressTracker && currentPdfName) {
          progressLines += '当前正在处理: ' + currentPdfName + '\n';
        } else if (currentPdfIndex > 0) {
          progressLines += '当前 PDF: ' + currentPdfIndex + '/' + totalPdfs + (currentPdfName ? ' · ' + currentPdfName : '') + '\n';
        }
        progressLines += '已处理 PDF: ' + handledPdfs + '/' + totalPdfs + '（成功 ' + processedPdfs + '，失败 ' + failedPdfs + '）\n';
        if (phaseLabel) progressLines += '当前步骤: ' + phaseLabel + '\n';
        if (attempt > 0 && maxAttempts > 0) {
          progressLines += 'Codex 尝试: ' + attempt + '/' + maxAttempts + (attemptElapsedSeconds > 0 ? ' · 本次已等待 ' + attemptElapsedSeconds + ' 秒' : '') + '\n';
        }
        if (queuedPdfs > 0 || runningPdfs > 0) {
          progressLines += '持久化队列: 处理中 ' + runningPdfs + ' 篇，等待 ' + queuedPdfs + ' 篇\n';
        } else if (uploadingPdfs > 0) {
          progressLines += '上传阶段: ' + uploadingPdfs + ' 篇正在传输，完成后自动进入持久化队列\n';
        }

        if (progress.status === 'processing') {
          setPlainStatusHtml(progressEl, (progress.stalled ? 'PDF Wiki 后台状态暂时未更新，仍在等待...\n\n' : '正在生成 Wiki论点库...\n\n') +
            progressLines +
            '可作论点句子: ' + sentencePointCount + '\n' +
            '兼容论点组: ' + entryCount + '\n' +
            '用时: ' + elapsed + ' 秒\n' +
            '状态: ' + (message || '正在处理 PDF') + '\n\n' +
            (pdfWikiTaskOptions.processingProfile === 'fast'
              ? '快速模式正在使用本地代码提取章节、显式引用并确定性匹配尾注；不会生成全表格或全图片。\n\n'
              : '深入分析耗时较长，请耐心等待；PDF 较多时可在配置页面增加 Codex CLI 并发数量。\n\n'),
            progressBarHtml);
          maybeScrollChatToBottom();
        } else if (progress.status === 'completed') {
          var completedTitle = sentencePointCount > 0
            ? 'Wiki论点库生成完成'
            : (entryCount > 0 ? 'PDF LLM Wiki 生成完成' : 'PDF LLM Wiki 处理完成，但未生成句子级论点');
          var completedHint = sentencePointCount > 0 || entryCount > 0
            ? ''
            : '\n如果你刚清空过 Wiki，请重新上传 PDF 或点击“重建 PDF Wiki”；若仍为 0，请检查 PDF 引言/讨论/结论是否可读取。\n';
          setPlainStatusHtml(progressEl, completedTitle + '\n\n' +
            progressLines +
            '可作论点句子: ' + sentencePointCount + '\n' +
            '兼容论点组: ' + entryCount + '\n' +
            '用时: ' + elapsed + ' 秒\n' +
            completedHint + '\n',
            progressBarHtml);
          maybeScrollChatToBottom();
        } else if (progress.status === 'error') {
          setPlainStatusHtml(progressEl, 'PDF LLM Wiki 生成失败\n\n' +
            (progress.message || progress.error || '未知错误') + '\n\n' +
            progressLines + '\n' +
            (pdfWikiTaskOptions.processingProfile === 'fast'
              ? '请检查 PDF 是否可复制文本；扫描件可改选深度模式或先做 OCR。'
              : '请检查 PDF 是否可复制文本，并在侧边栏配置 PDF Wiki 千问 API'),
            progressBarHtml);
          maybeScrollChatToBottom();
        } else {
          setPlainStatusHtml(progressEl, '正在等待 PDF LLM Wiki 任务启动... (已用时 ' + elapsed + ' 秒)\n\n' +
            (pdfWikiTaskOptions.processingProfile === 'fast'
              ? '快速模式正在准备本地章节提取与显式引用匹配。\n\n'
              : '深入分析耗时较长，请耐心等待；PDF 较多时可在配置页面增加 Codex CLI 并发数量。\n\n'),
            '<div style="background:var(--bg-secondary);border-radius:4px;height:4px;overflow:hidden;margin-top:8px;">' +
            '<div style="background:var(--text-secondary);height:100%;width:50%;animation:pulse 1.5s infinite;"></div>' +
            '</div>' +
            '<style>@keyframes pulse{0%,100%{opacity:0.3}50%{opacity:1}}</style>');
        }
      }
      
      try {
        console.log('[Upload] Starting upload request...');

        async function sendLiteratureUploadRequest(requestFormData, fileLabel) {
          var uploadController = new AbortController();
          var uploadTimeout = setTimeout(function() {
            uploadController.abort();
            console.error('[Upload] Upload timed out after 5 minutes:', fileLabel || 'batch');
          }, 5 * 60 * 1000);
          try {
            var response = await fetch('/api/upload', {
              method: 'POST',
              body: requestFormData,
              signal: uploadController.signal
            });
            if (!response.ok) throw new Error('Upload failed: ' + response.status);
            var responseData = await response.json();
            if (!responseData || responseData.success === false) {
              throw new Error(responseData && responseData.error ? responseData.error : '上传失败');
            }
            return responseData;
          } finally {
            clearTimeout(uploadTimeout);
          }
        }

        function createSinglePdfUploadFormData(file) {
          var singleFormData = new FormData();
          formData.forEach(function(value, key) {
            if (key !== 'files') singleFormData.append(key, value);
          });
          singleFormData.append('files', file);
          return singleFormData;
        }

        var data = null;
        var usePdfUploadPipeline = containsPdfUpload && !isPdfManagerLiteUpload && selectedFiles.length > 1 && selectedFiles.every(function(file) {
          return /\.pdf$/i.test(file.name || '') || String(file.type || '').toLowerCase() === 'application/pdf';
        });
        if (usePdfUploadPipeline) {
          var pipelineResults = [];
          var uploadedPipelinePdfs = 0;
          var pipelineStatusPoll = setInterval(async function() {
            try {
              var statusResponse = await fetch('/api/pdf-wiki/status?userId=' + encodeURIComponent(currentUserId));
              var statusData = await statusResponse.json();
              if (statusData && !statusData.error) {
                statusData.totalPdfs = selectedFiles.length;
                statusData.uploadingPdfs = Math.max(0, selectedFiles.length - uploadedPipelinePdfs);
                updatePdfWikiProgressUI(statusData, Math.round((Date.now() - uploadStartTime) / 1000));
              }
            } catch (pollError) {
              console.warn('[PdfWiki] 流水线上传状态读取失败:', pollError);
            }
          }, 1000);
          try {
            for (var pipelineIndex = 0; pipelineIndex < selectedFiles.length; pipelineIndex++) {
              var pipelineFile = selectedFiles[pipelineIndex];
              updatePdfWikiProgressUI({
                status: 'processing',
                totalPdfs: selectedFiles.length,
                processedPdfs: 0,
                failedPdfs: 0,
                uploadingPdfs: selectedFiles.length - uploadedPipelinePdfs,
                message: '流水线上传 ' + (pipelineIndex + 1) + '/' + selectedFiles.length + '：' + pipelineFile.name + '；已上传文件正在后台处理',
              }, Math.round((Date.now() - uploadStartTime) / 1000));
              var pipelineResult = await sendLiteratureUploadRequest(createSinglePdfUploadFormData(pipelineFile), pipelineFile.name);
              pipelineResults.push(pipelineResult);
              uploadedPipelinePdfs += 1;
              if (pdfWikiBatchProgressTracker) {
                pdfWikiBatchProgressTracker.uploadedPdfs = uploadedPipelinePdfs;
                var addedJobIds = pipelineResult.pdfWikiQueue && Array.isArray(pipelineResult.pdfWikiQueue.addedJobIds)
                  ? pipelineResult.pdfWikiQueue.addedJobIds
                  : [];
                addedJobIds.forEach(function(jobId) {
                  if (jobId) pdfWikiBatchProgressTracker.jobIds.add(String(jobId));
                });
              }
              updatePdfWikiProgressUI({
                status: 'processing',
                totalPdfs: selectedFiles.length,
                processedPdfs: 0,
                failedPdfs: 0,
                uploadingPdfs: selectedFiles.length - uploadedPipelinePdfs,
                queue: pipelineResult.pdfWikiQueue || {},
                message: pipelineFile.name + ' 已进入持久化队列；继续上传下一篇',
              }, Math.round((Date.now() - uploadStartTime) / 1000));
            }
          } finally {
            clearInterval(pipelineStatusPoll);
          }
          var lastPipelineResult = pipelineResults[pipelineResults.length - 1] || {};
          data = Object.assign({}, lastPipelineResult);
          data.files = pipelineResults.reduce(function(all, item) { return all.concat(item.files || []); }, []);
          data.pdfWikiQueued = pipelineResults.some(function(item) { return item.pdfWikiQueued === true; });
          data.pdfWikiStarted = pipelineResults.some(function(item) { return item.pdfWikiStarted === true; });
          data.embeddingStarted = pipelineResults.some(function(item) { return item.embeddingStarted === true; });
          data.summary = Object.assign({}, lastPipelineResult.summary || {}, {
            uploadedCount: pipelineResults.reduce(function(sum, item) { return sum + Number(item.summary && item.summary.uploadedCount || 0); }, 0),
            newCount: pipelineResults.reduce(function(sum, item) { return sum + Number(item.summary && item.summary.newCount || 0); }, 0),
            duplicateCount: pipelineResults.reduce(function(sum, item) { return sum + Number(item.summary && item.summary.duplicateCount || 0); }, 0),
            pdfCount: pipelineResults.reduce(function(sum, item) { return sum + Number(item.summary && item.summary.pdfCount || 0); }, 0),
            pdfQueuedCount: pipelineResults.reduce(function(sum, item) { return sum + Number(item.summary && item.summary.pdfQueuedCount || 0); }, 0),
            pdfDuplicateCount: pipelineResults.reduce(function(sum, item) { return sum + Number(item.summary && item.summary.pdfDuplicateCount || 0); }, 0),
          });
          console.log('[Upload] PDF pipeline completed:', uploadedPipelinePdfs, '/', selectedFiles.length);
        } else {
          data = await sendLiteratureUploadRequest(formData, selectedFiles.length + ' files');
        }

        console.log('[Upload] Response received in', Math.round((Date.now() - uploadStartTime) / 1000), 'seconds');
        if (isPdfManagerLiteUpload && progressInterval) {
          clearInterval(progressInterval);
          progressInterval = null;
        }
        console.log('[Upload] Upload result:', data.success, 'files:', data.files?.length, 'papers:', data.summary?.count, 'embeddingStarted:', data.embeddingStarted);
        var isPdfManagerLiteResult = data.pdfUploadMode === 'manager-lite' || data.pdfManagerLiteProcessed === true;
        
        // 根据后端返回的 embeddingStarted 标志决定是否等待 embedding
        var shouldWaitForEmbedding = data.embeddingStarted === true;
        var shouldWaitForPdfWiki = data.pdfWikiQueued === true || !!(pdfWikiBatchProgressTracker && pdfWikiBatchProgressTracker.jobIds.size > 0);
        var finalPdfWikiStatus = null;

        function isCurrentPdfWikiBatchTerminal() {
          if (!pdfWikiBatchProgressTracker) return false;
          if (pdfWikiBatchProgressTracker.uploadedPdfs < pdfWikiBatchProgressTracker.totalPdfs) return false;
          if (pdfWikiBatchProgressTracker.jobIds.size === 0) return false;
          return pdfWikiBatchProgressTracker.completedJobIds.size + pdfWikiBatchProgressTracker.failedJobIds.size >= pdfWikiBatchProgressTracker.jobIds.size;
        }

        if (shouldWaitForPdfWiki) {
          var initialQueue = data.pdfWikiQueue && typeof data.pdfWikiQueue === 'object' ? data.pdfWikiQueue : {};
          updatePdfWikiProgressUI({
            status: 'processing',
            totalPdfs: selectedFiles.length,
            processedPdfs: 0,
            failedPdfs: 0,
            queue: initialQueue,
            message: 'PDF 已写入持久化队列，后台将按顺序处理',
          }, Math.round((Date.now() - uploadStartTime) / 1000));
        }
        
        if (shouldWaitForEmbedding) {
          console.log('[Upload] Backend started embedding, waiting for completion...');
          
          // 等待 embedding 完成（最多等 10 分钟）
          var embeddingWaitTimeout = 10 * 60 * 1000;
          var embeddingStartWait = Date.now();
          
          await new Promise(function(resolve) {
            var pollEmbedding = setInterval(async function() {
              try {
                var elapsed = Math.round((Date.now() - uploadStartTime) / 1000);
                var progressResp = await fetch('/api/embedding/progress');
                var progress = await progressResp.json();
                
                // 更新进度 UI
                updateProgressUI(progress, elapsed);
                
                // 检查终态
                if (progress.status === 'completed') {
                  console.log('[Upload] Embedding completed:', progress.processed, '/', progress.total);
                  clearInterval(pollEmbedding);
                  resolve(undefined);
                } else if (progress.status === 'error') {
                  console.error('[Upload] Embedding failed:', progress.message);
                  clearInterval(pollEmbedding);
                  resolve(undefined);
                } else if (Date.now() - embeddingStartWait > embeddingWaitTimeout) {
                  console.warn('[Upload] Embedding wait timed out after 10 minutes');
                  clearInterval(pollEmbedding);
                  resolve(undefined);
                }
                // 'idle' 或 'processing' 状态继续轮询
              } catch (err) {
                console.warn('[Progress] Poll error:', err);
              }
            }, 1000);
          });
        }

        if (shouldWaitForPdfWiki) {
          console.log('[Upload] Backend queued PDF Wiki, waiting for status updates...');

          await new Promise(function(resolve) {
            var pollPdfWiki = setInterval(async function() {
              try {
                var elapsed = Math.round((Date.now() - uploadStartTime) / 1000);
                var wikiResp = await fetch('/api/pdf-wiki/status?userId=' + encodeURIComponent(currentUserId));
                var wikiProgress = await wikiResp.json();
                finalPdfWikiStatus = wikiProgress;

                updatePdfWikiProgressUI(wikiProgress, elapsed);

                var batchTerminal = isCurrentPdfWikiBatchTerminal();
                if (batchTerminal || (!pdfWikiBatchProgressTracker && wikiProgress.status === 'completed')) {
                  console.log('[Upload] PDF Wiki completed:', wikiProgress.entryCount, 'entries');
                  clearInterval(pollPdfWiki);
                  resolve(undefined);
                } else if (!pdfWikiBatchProgressTracker && wikiProgress.status === 'error') {
                  console.error('[Upload] PDF Wiki failed:', wikiProgress.message || wikiProgress.error);
                  clearInterval(pollPdfWiki);
                  resolve(undefined);
                }
              } catch (err) {
                console.warn('[PDF Wiki Progress] Poll error:', err);
              }
            }, 1000);
          });
        }
        
        // 仅在没有后台长任务时移除临时进度卡；PDF Wiki/Embedding 的终态进度保留给用户复核。
        if (progressDiv && !shouldWaitForPdfWiki && !shouldWaitForEmbedding) progressDiv.remove();
        
        if (data.success) {
          uploadedFiles = [{ name: labels.embeddingLibrary, content: data.summary.count + '个文件' }];
          renderFileList();
          
          // 检查最终的 embedding 状态
          var finalProgressCheck = await fetch('/api/embedding/progress');
          var finalProgress = await finalProgressCheck.json();
          var embeddingSuccess = finalProgress.status === 'completed' && finalProgress.processed > 0;
          var embeddingFailed = finalProgress.status === 'error';
          var noNewPapers = data.summary.newCount === 0 && data.summary.duplicateCount > 0;
          var pdfOnlyUpload = (data.summary.pdfCount || 0) > 0 && (data.summary.newEmbeddableCount || 0) === 0;
          
          var batchFailedPdfs = pdfWikiBatchProgressTracker ? pdfWikiBatchProgressTracker.failedPdfs : 0;
          var msg = shouldWaitForPdfWiki
            ? (batchFailedPdfs > 0
              ? '⚠️ ' + evidenceName + '上传完成，PDF Wiki 处理结束（失败 ' + batchFailedPdfs + ' 篇）\n\n'
              : '✅ ' + evidenceName + '上传及 PDF Wiki 处理完成！\n\n')
            : '✅ ' + evidenceName + '上传成功！\n\n';
          msg += '📊 ' + evidenceName + '统计：\n';
          msg += '• 文件数量: ' + data.files.length + '\n';
          msg += '• ' + evidenceName + '总数: ' + data.summary.count + ' 条\n';
          
          // 显示新增和重复文献信息
          if (data.summary.newCount > 0) {
            msg += '• 新增' + evidenceName + ': ' + data.summary.newCount + ' 条\n';
          }
          if (data.summary.duplicateCount > 0) {
            msg += '• 已存在' + evidenceName + '（跳过）: ' + data.summary.duplicateCount + ' 条\n';
          }
          
          if (data.summary.years.length > 0) {
            msg += '• 年份范围: ' + data.summary.years[0] + ' - ' + data.summary.years[data.summary.years.length - 1] + '\n';
          }
          if (data.summary.journals.length > 0) {
            msg += '• 涉及来源: ' + data.summary.journals.slice(0, 5).join(', ') + '\n';
          }
          if (data.summary.keywords.length > 0) {
            msg += '• 关键词: ' + data.summary.keywords.slice(0, 15).join(', ') + '\n';
          }
          if (data.summary.pdfCount > 0) {
            msg += '• PDF 文件: ' + data.summary.pdfCount + ' 个\n';
          }
          if (Number(data.summary.pdfDuplicateCount || 0) > 0) {
            msg += '• 后端指纹复核排除重复 PDF: ' + Number(data.summary.pdfDuplicateCount || 0) + ' 个\n';
          }
          if (data.bibliometricsImported && data.bibliometrics && data.bibliometrics.dataset) {
            var biblioDataset = data.bibliometrics.dataset;
            msg += '• 已识别 WoS 文献计量 Plain Text: ' + (biblioDataset.recordCount || 0) + ' 条记录';
            if (biblioDataset.citedReferenceCount) {
              msg += '，参考文献 ' + biblioDataset.citedReferenceCount + ' 条';
            }
            msg += '\n';
          } else if (data.bibliometricsImportError) {
            msg += '• 文献计量 Plain Text 识别失败: ' + data.bibliometricsImportError + '\n';
          }
          
          // 特殊处理：没有新文献的情况
          if (noNewPapers) {
            msg += '\n📝 所有上传的' + evidenceName + '均已存在于库中，无需重复处理';
            msg += '\n💡 您可以继续使用已有的' + evidenceName + '进行检索';
          } else if (embeddingSuccess) {
            msg += '\n✅ 已生成语义向量（' + finalProgress.processed + ' 篇），支持智能检索';
          } else if (embeddingFailed) {
            msg += '\n⚠️ 向量嵌入生成失败：' + (finalProgress.message || '请检查 Embedding API 配置');
            msg += '\n💡 ' + evidenceName + '已保存，可在配置正确后重新上传';
          } else if (pdfOnlyUpload && isPdfManagerLiteResult) {
            var liteParsedCount = data.pdfManagerLite && Number(data.pdfManagerLite.parsedCount || 0);
            var liteUploadedCount = data.pdfManagerLite && Number(data.pdfManagerLite.uploadedCount || data.summary.pdfCount || 0);
            var liteFigureCount = data.pdfManagerLite && Number(data.pdfManagerLite.figureCount || 0);
            msg += '\n✅ PDF 管理识别完成：已按重新识别流程处理 ' + (liteParsedCount || 0) + '/' + (liteUploadedCount || data.summary.pdfCount || 0) + ' 个 PDF，图片 ' + (liteFigureCount || 0) + ' 张';
            if (data.pdfManagerLite && Number(data.pdfManagerLite.failedCount || 0) > 0) {
              msg += '\n⚠️ ' + Number(data.pdfManagerLite.failedCount || 0) + ' 个 PDF 未提取到可用文本，可在 PDF 管理中单篇重新识别或检查 PDF 是否可复制';
            }
          } else if (pdfOnlyUpload) {
            msg += '\n💡 PDF 不进入摘要 embedding，将使用 Wiki论点库进行逐句证据检索';
          } else if (!shouldWaitForEmbedding) {
            msg += '\n💡 配置 Embedding API 后可启用语义检索';
          }
          if (data.summary.pdfCount > 0) {
            if (isPdfManagerLiteResult) {
              msg += '\n📄 本次来自 PDF 管理页，只更新文献信息、正文缓存和图片信息；如需生成 Wiki论点库，请从主页左侧“上传PDF生成论点库”入口上传。';
            } else if (data.pdfWikiLlm && data.pdfWikiLlm.label) {
              msg += '\n📖 PDF Wiki 使用模型：' + data.pdfWikiLlm.label;
              if (!data.pdfWikiLlm.dedicated) {
                msg += '\n💡 建议在侧边栏配置 PDF Wiki 千问 API，提升长 PDF 分析稳定性';
              }
            }
            if (finalPdfWikiStatus && finalPdfWikiStatus.status === 'completed') {
              var wikiEntryCount = Number(finalPdfWikiStatus.entryCount || 0);
              var wikiSentencePointCount = Number(finalPdfWikiStatus.sentencePointCount || 0);
              if (wikiSentencePointCount > 0) {
                msg += '\n✅ Wiki论点库已生成（' + wikiSentencePointCount + ' 个可作论点句子，兼容论点组 ' + wikiEntryCount + ' 个），可在齿轮检索中选择 PDF 论点库';
              } else if (wikiEntryCount > 0) {
                msg += '\n✅ PDF Wiki 已生成（兼容论点组 ' + wikiEntryCount + ' 个），可在齿轮检索中选择 PDF Wiki';
              } else {
                msg += '\n⚠️ PDF Wiki 处理完成，但未生成句子级论点。请点击“Wiki论点库”中的“重建 PDF Wiki”，或重新上传 PDF 后再试';
              }
            } else if (finalPdfWikiStatus && finalPdfWikiStatus.status === 'error') {
              msg += '\n⚠️ PDF Wiki 生成失败：' + (finalPdfWikiStatus.message || finalPdfWikiStatus.error || '未知错误');
            } else if (data.pdfWikiStarted) {
              msg += '\n📖 PDF Wiki 正在后台生成，完成后可在齿轮检索中选择 PDF 论点库';
              msg += '\n⏳ 深入分析耗时较长，请耐心等待；PDF 较多时可在配置页面增加 Codex CLI 并发数量';
            } else {
              msg += '\n⚠️ PDF 已保存，但未开始生成 PDF Wiki；请先在侧边栏配置 PDF Wiki 千问 API 后重建 PDF Wiki';
            }
          }
          msg += '\n\n💡 您可以开始提问关于这些' + evidenceName + '的问题了！';
          
          if (isPdfManagerLiteResult) {
            var liteResult = data.pdfManagerLite || {};
            pdfWikiManagerUploadRunning = false;
            pdfWikiManagerUploadProgress = {
              status: Number(liteResult.failedCount || 0) >= Number(liteResult.uploadedCount || data.summary.pdfCount || 0) ? 'error' : 'completed',
              totalPdfs: Number(liteResult.uploadedCount || data.summary.pdfCount || 0),
              processedPdfs: Number(liteResult.parsedCount || 0),
              failedPdfs: Number(liteResult.failedCount || 0),
              figureCount: Number(liteResult.figureCount || 0),
              message: liteResult.message || 'PDF 管理批量识别完成',
              updatedAt: new Date().toISOString()
            };
            if (!updatePdfWikiManagerUploadStatusBarOnly() && pdfWikiPdfManagerData && document.getElementById('pdfWikiPdfManagerScroll')) {
              renderPdfWikiPdfManagerPreservingScroll();
            }
            if (pdfWikiManagerUploadProgress.status !== 'error') {
              schedulePdfWikiManagerUploadStatusAutoHide(4000);
            }
          } else {
            appendMessage(msg, 'bot', false, true);
          }
          if ((data.summary.pdfCount || 0) > 0 && document.getElementById('pdfWikiViewerModal')) {
            if (document.getElementById('pdfWikiPdfManagerScroll')) {
              reloadPdfWikiPdfManager().catch(function(error) {
                console.warn('[PdfWiki] 上传后刷新 PDF 管理失败:', error);
              });
            } else if (pdfWikiMetaDatabaseData) {
              reloadPdfWikiMetaDatabase(pdfWikiMetaSelectedPdfId).catch(function(error) {
                console.warn('[PdfWiki] 上传后刷新 Meta分析失败:', error);
              });
            }
          }
        } else {
          // 上传请求成功但后端返回失败
          var errorMsg = data.error || '未知错误';
          appendMessage('❌ ' + evidenceName + '上传失败：' + errorMsg, 'bot', false, true);
        }
      } catch (error) {
        if (progressInterval) {
          clearInterval(progressInterval);
        }
        if (progressDiv) progressDiv.remove();
        if (isPdfManagerLiteUpload) {
          clearPdfWikiManagerUploadAutoHideTimer();
          pdfWikiManagerUploadRunning = false;
          pdfWikiManagerUploadProgress = Object.assign({}, pdfWikiManagerUploadProgress || {}, {
            status: 'error',
            message: 'PDF 管理批量识别失败：' + error.message,
            updatedAt: new Date().toISOString()
          });
          if (!updatePdfWikiManagerUploadStatusBarOnly() && pdfWikiPdfManagerData && document.getElementById('pdfWikiPdfManagerScroll')) {
            renderPdfWikiPdfManagerPreservingScroll();
          }
        } else {
          appendMessage(evidenceName + '上传失败: ' + error.message, 'bot', false, true);
        }
      }
      
      if (e && e.target) {
        e.target.value = '';
        if (e.target.dataset) e.target.dataset.pdfUploadMode = 'full';
      }
    }

    document.getElementById('fileInput').addEventListener('change', handleLiteratureFileInputChange);
    document.getElementById('pdfFileInput').addEventListener('change', handleLiteratureFileInputChange);
    document.getElementById('metaPdfFileInput').addEventListener('change', handleMetaPdfFileInputChange);
    document.getElementById('metaDigitizationFileInput').addEventListener('change', handlePdfWikiDigitizationFileInputChange);
    document.getElementById('getDataExeInput').addEventListener('change', handleGetDataExeFileInputChange);

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('pdf-wiki-upload', { source: '/app/pdf-wiki-upload.js' });
}
