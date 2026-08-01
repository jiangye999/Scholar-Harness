window.showAutoResearchMode = async function(options) {
      updateAcademicWorkflowOverviewReturn(options);
      setPdfWikiWorkspaceMode('auto-research');
      if (!document.getElementById('pdfWikiViewerModal')) {
        await window.showPdfWikiViewer({
          initialTitle: 'Auto Research',
          initialSubtitle: '正在读取 Auto Research...',
          initialLoadingText: '正在读取 Auto Research...',
          workflowActiveKey: 'auto-research',
          skipInitialLoad: true
        });
      }
      setPdfWikiViewerWorkflowActions('auto-research');
      setPdfWikiViewerContextActions(renderAutoResearchHeaderActions());
      var content = document.getElementById('pdfWikiViewerContent');
      var title = document.getElementById('pdfWikiViewerTitle');
      var subtitle = document.getElementById('pdfWikiViewerSubtitle');
      if (title) title.textContent = 'Auto Research';
      if (subtitle) subtitle.textContent = '正在读取 Auto Research...';
      if (content) {
        content.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:13px;">正在读取 Auto Research...</div>';
      }
      try {
        var state = await loadAutoResearchState();
        renderAutoResearchMode(state);
      } catch (e) {
        if (content) {
          content.innerHTML = '<div style="padding:24px;text-align:center;color:var(--danger-color);">读取失败：' + escapeHtml(e.message) + '</div>';
        }
      }
    };

    async function loadAutoResearchState() {
      var response = await fetch('/api/autoresearch/state?userId=' + encodeURIComponent(currentUserId));
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '读取 Auto Research 失败');
      autoResearchData = data.state;
      return autoResearchData;
    }

    function renderAutoResearchHeaderActions() {
      var actions = [
        ['claims', '论点库', ''],
        ['run-full', '开始自动研究', 'autoResearchStartBtn'],
        ['sync-evidence', '同步证据', 'autoResearchSyncEvidenceBtn'],
        ['sync-library', '同步文献库', 'autoResearchSyncLibraryBtn'],
        ['research-wiki', '重建Wiki', 'autoResearchWikiBtn'],
        ['evaluate', '审稿式自检', 'autoResearchEvaluateBtn'],
        ['audit', '引用审计', 'autoResearchAuditBtn']
      ];
      return '<div style="display:flex;align-items:center;justify-content:flex-start;gap:6px;flex-wrap:wrap;min-width:0;">' +
        actions.map(function(action) {
          return '<button' + (action[2] ? ' id="' + action[2] + '"' : '') + ' type="button" data-autoresearch-action="' + action[0] + '" style="height:30px;padding:0 10px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;white-space:nowrap;">' + action[1] + '</button>';
        }).join('') +
      '</div>';
    }

    function renderAutoResearchMode(state) {
      setPdfWikiWorkspaceMode('auto-research');
      autoResearchData = state;
      var content = document.getElementById('pdfWikiViewerContent');
      var title = document.getElementById('pdfWikiViewerTitle');
      var subtitle = document.getElementById('pdfWikiViewerSubtitle');
      if (title) title.textContent = 'Auto Research';
      if (!content) return;
      var task = state.task || {};
      var stages = Array.isArray(task.stages) ? task.stages : [];
      var evidenceObjects = state.evidenceLibrary && Array.isArray(state.evidenceLibrary.objects) ? state.evidenceLibrary.objects : [];
      var snapshots = state.evidenceLibrary && Array.isArray(state.evidenceLibrary.snapshots) ? state.evidenceLibrary.snapshots : [];
      var literatureMap = state.literatureMap || {};
      var literatureNodes = Array.isArray(literatureMap.nodes) ? literatureMap.nodes : [];
      var literatureNodeCount = Number.isFinite(Number(literatureMap.totalNodeCount)) ? Number(literatureMap.totalNodeCount) : literatureNodes.length;
      var literatureEmbeddingCount = Number.isFinite(Number(literatureMap.totalEmbeddingCount)) ? Number(literatureMap.totalEmbeddingCount) : literatureNodes.filter(function(node) { return !!node.hasEmbedding; }).length;
      var literatureTags = Array.isArray(literatureMap.tags) ? literatureMap.tags : [];
      var literatureSnapshots = Array.isArray(literatureMap.snapshots) ? literatureMap.snapshots : [];
      var operations = Array.isArray(state.operations) ? state.operations : [];
      var memories = Array.isArray(state.projectMemory) ? state.projectMemory : [];
      var evaluations = Array.isArray(state.evaluations) ? state.evaluations : [];
      var auditReports = Array.isArray(state.auditReports) ? state.auditReports : [];
      var researchWiki = state.researchWiki || {};
      var finalReports = Array.isArray(state.finalReports) ? state.finalReports : [];
      var paperDrafts = Array.isArray(state.paperDrafts) ? state.paperDrafts : [];
      var hasCompletedTaskRecords = Array.isArray(state.completedTaskRecords);
      var completedTaskRecords = hasCompletedTaskRecords ? state.completedTaskRecords : [];
      var latestEvaluation = evaluations[0] || null;
      var latestAuditReport = auditReports[0] || null;
      var latestFinalReport = finalReports[0] || null;
      var latestPaperDraft = paperDrafts[0] || null;
      var relevantLiteratureIds = latestFinalReport && latestFinalReport.trace && Array.isArray(latestFinalReport.trace.relevantLiteratureNodeIds)
        ? latestFinalReport.trace.relevantLiteratureNodeIds
        : [];
      var relevantLiteratureIdMap = {};
      relevantLiteratureIds.forEach(function(id) { relevantLiteratureIdMap[id] = true; });
      var displayLiteratureNodes = relevantLiteratureIds.length
        ? literatureNodes.filter(function(node) { return relevantLiteratureIdMap[node.id]; })
        : literatureNodes;
      var displayLiteratureTags = relevantLiteratureIds.length
        ? buildAutoResearchLiteratureTagsForDisplay(displayLiteratureNodes)
        : literatureTags;
      if (subtitle) {
        subtitle.textContent = 'Auto Research：' + (task.title || '长期任务') + ' · 文献 ' + literatureNodeCount + ' · 证据 ' + evidenceObjects.length + ' · Wiki ' + (Array.isArray(researchWiki.nodes) ? researchWiki.nodes.length : 0) + ' · 操作 ' + operations.length;
      }
      setPdfWikiViewerContextActions(renderAutoResearchHeaderActions());

      content.innerHTML =
        '<div style="display:grid;grid-template-columns:310px 1fr;gap:0;width:100%;height:100%;min-height:0;">' +
          '<aside style="border-right:1px solid var(--border-color);display:flex;flex-direction:column;min-height:0;background:var(--bg-primary);">' +
            '<div style="padding:14px;border-bottom:1px solid var(--border-color);">' +
              '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">项目</div>' +
              '<div style="font-size:15px;font-weight:700;color:var(--text-primary);line-height:1.45;">' + escapeHtml(state.projectName || '当前工作区') + '</div>' +
              '<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">' +
                '<input id="autoResearchTaskTitleInput" value="' + escapeHtml(task.title || 'AutoResearch 长期任务') + '" placeholder="任务名称" style="width:100%;min-width:0;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);padding:8px;font-size:12px;">' +
                '<textarea id="autoResearchTopicInput" rows="3" placeholder="研究主题/目标" style="width:100%;min-width:0;resize:vertical;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);padding:8px;font-size:12px;line-height:1.5;">' + escapeHtml(task.topic || '') + '</textarea>' +
                '<div id="autoResearchActionStatus" style="min-height:16px;font-size:11px;color:var(--text-secondary);line-height:1.4;">' + escapeHtml(task.topic ? '已填写主题，点击“开始自动研究”即可自动运行完整流程。' : '填写主题后点击“开始自动研究”。') + '</div>' +
                renderAutoResearchRunPanel() +
              '</div>' +
            '</div>' +
            '<div style="padding:12px;overflow:auto;min-height:0;flex:1;">' + stages.map(renderAutoResearchStage).join('') + '</div>' +
          '</aside>' +
          '<section style="min-width:0;min-height:0;overflow:auto;background:var(--bg-secondary);padding:16px;">' +
            renderAutoResearchStats(state, latestEvaluation, latestFinalReport) +
            renderAutoResearchEvidencePrereqNotice(state) +
            renderAutoResearchCompletedTasks(completedTaskRecords, hasCompletedTaskRecords ? [] : finalReports, paperDrafts) +
            renderAutoResearchFinalReport(latestFinalReport) +
            renderAutoResearchPaperDraft(latestPaperDraft) +
            renderAutoResearchEvaluation(latestEvaluation) +
            renderAutoResearchAuditReport(latestAuditReport) +
            renderAutoResearchResearchWikiPanel(researchWiki) +
            '<div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(320px,0.9fr);gap:14px;align-items:start;">' +
              '<div style="min-width:0;">' +
                renderAutoResearchLiteraturePanel(displayLiteratureNodes, displayLiteratureTags, literatureSnapshots, relevantLiteratureIds.length ? literatureNodeCount : 0, literatureNodeCount, literatureEmbeddingCount) +
                renderAutoResearchEvidencePanel(evidenceObjects, snapshots) +
                renderAutoResearchMemoryPanel(memories) +
              '</div>' +
              '<div style="min-width:0;">' +
                renderAutoResearchOperationPanel(operations) +
              '</div>' +
            '</div>' +
          '</section>' +
        '</div>';
      attachAutoResearchEventHandlers(content);
      attachAutoResearchEventHandlers(document.getElementById('pdfWikiViewerContextActions'));
      updateAutoResearchCompletedTaskSelectionUi();
    }

    function renderAutoResearchStage(stage) {
      var status = stage.status || 'pending';
      var statusText = { pending: '待处理', active: '进行中', done: '完成', blocked: '阻塞' }[status] || status;
      var color = status === 'done' ? 'var(--accent-color)' : (status === 'blocked' ? 'var(--danger-color)' : (status === 'active' ? '#f59e0b' : 'var(--text-secondary)'));
      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:11px;margin-bottom:9px;">' +
        '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">' +
          '<div style="min-width:0;">' +
            '<div style="font-size:13px;font-weight:700;color:var(--text-primary);">' + escapeHtml(stage.title || stage.id) + '</div>' +
            '<div style="font-size:11px;color:' + color + ';margin-top:4px;">' + escapeHtml(statusText) + '</div>' +
          '</div>' +
          '<select onchange="updateAutoResearchStageStatus(\'' + escapeHtml(stage.id) + '\',this.value)" style="font-size:12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);padding:5px;">' +
            '<option value="pending"' + (status === 'pending' ? ' selected' : '') + '>待处理</option>' +
            '<option value="active"' + (status === 'active' ? ' selected' : '') + '>进行中</option>' +
            '<option value="done"' + (status === 'done' ? ' selected' : '') + '>完成</option>' +
            '<option value="blocked"' + (status === 'blocked' ? ' selected' : '') + '>阻塞</option>' +
          '</select>' +
        '</div>' +
        (stage.notes && stage.notes.length ? '<div style="margin-top:8px;font-size:12px;color:var(--text-secondary);line-height:1.55;">' + escapeHtml(stage.notes[0]) + '</div>' : '') +
      '</div>';
    }

    function renderAutoResearchStats(state, latestEvaluation, latestFinalReport) {
      var evidenceObjects = state.evidenceLibrary && Array.isArray(state.evidenceLibrary.objects) ? state.evidenceLibrary.objects : [];
      var snapshots = state.evidenceLibrary && Array.isArray(state.evidenceLibrary.snapshots) ? state.evidenceLibrary.snapshots : [];
      var literatureMap = state.literatureMap || {};
      var literatureNodes = Array.isArray(literatureMap.nodes) ? literatureMap.nodes : [];
      var literatureNodeCount = Number.isFinite(Number(literatureMap.totalNodeCount)) ? Number(literatureMap.totalNodeCount) : literatureNodes.length;
      var literatureSnapshots = Array.isArray(literatureMap.snapshots) ? literatureMap.snapshots : [];
      var operations = Array.isArray(state.operations) ? state.operations : [];
      var memories = Array.isArray(state.projectMemory) ? state.projectMemory : [];
      var researchWiki = state.researchWiki || {};
      var wikiNodes = Array.isArray(researchWiki.nodes) ? researchWiki.nodes : [];
      var wikiEdges = Array.isArray(researchWiki.edges) ? researchWiki.edges : [];
      var auditReports = Array.isArray(state.auditReports) ? state.auditReports : [];
      var latestAuditReport = auditReports[0] || null;
      var score = latestEvaluation ? Math.round(Number(latestEvaluation.overallScore || 0) * 100) : null;
      var auditScore = latestAuditReport ? Math.round(Number(latestAuditReport.overallScore || 0) * 100) : null;
      var embeddingEvidenceCount = latestFinalReport && latestFinalReport.trace ? Number(latestFinalReport.trace.embeddingEvidenceObjectCount || 0) : 0;
      var items = [
        ['文献节点', literatureNodeCount],
        ['文献快照', literatureSnapshots.length],
        ['PDF证据', evidenceObjects.length],
        ['摘要证据', embeddingEvidenceCount],
        ['Wiki节点', wikiNodes.length],
        ['Wiki关系', wikiEdges.length],
        ['证据快照', snapshots.length],
        ['项目记忆', memories.length],
        ['操作记录', operations.length],
        ['自评分', score === null ? '未运行' : score + ''],
        ['审计', auditScore === null ? '未运行' : (latestAuditReport.verdict || '') + ' ' + auditScore]
      ];
      return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:10px;margin-bottom:14px;">' +
        items.map(function(item) {
          return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:12px;">' +
            '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;">' + escapeHtml(item[0]) + '</div>' +
            '<div style="font-size:20px;font-weight:750;color:var(--text-primary);">' + escapeHtml(item[1]) + '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    }

    function getAutoResearchSelectedCompletedTaskIds(records) {
      var allowed = null;
      if (Array.isArray(records)) {
        allowed = {};
        records.forEach(function(record) {
          if (record && record.id) allowed[record.id] = true;
        });
      }
      return Object.keys(autoResearchCompletedTaskSelection || {}).filter(function(id) {
        return !!autoResearchCompletedTaskSelection[id] && (!allowed || !!allowed[id]);
      });
    }

    function pruneAutoResearchCompletedTaskSelection(records) {
      var allowed = {};
      (Array.isArray(records) ? records : []).forEach(function(record) {
        if (record && record.id) allowed[record.id] = true;
      });
      Object.keys(autoResearchCompletedTaskSelection || {}).forEach(function(id) {
        if (!allowed[id]) delete autoResearchCompletedTaskSelection[id];
      });
    }

    function updateAutoResearchCompletedTaskSelectionUi() {
      var selectedIds = getAutoResearchSelectedCompletedTaskIds();
      var countTarget = document.getElementById('autoResearchCompletedTaskSelectedCount');
      var deleteButton = document.getElementById('autoResearchCompletedTaskDeleteBtn');
      var selectAll = document.getElementById('autoResearchCompletedTaskSelectAll');
      var checkboxes = Array.prototype.slice.call(document.querySelectorAll('[data-autoresearch-completed-task-checkbox]'));
      var checkedCount = checkboxes.filter(function(input) { return input.checked; }).length;
      if (countTarget) countTarget.textContent = selectedIds.length ? ('已选 ' + selectedIds.length + ' 条') : '未选择';
      if (deleteButton) {
        deleteButton.disabled = !selectedIds.length || autoResearchCompletedTaskDeleting;
        deleteButton.style.opacity = deleteButton.disabled ? '0.55' : '';
        deleteButton.style.cursor = deleteButton.disabled ? 'not-allowed' : 'pointer';
        deleteButton.textContent = autoResearchCompletedTaskDeleting ? '删除中' : '删除选中';
      }
      if (selectAll) {
        selectAll.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
        selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
      }
    }

    function renderAutoResearchCompletedTasks(records, finalReports, paperDrafts) {
      records = Array.isArray(records) ? records : [];
      finalReports = Array.isArray(finalReports) ? finalReports : [];
      paperDrafts = Array.isArray(paperDrafts) ? paperDrafts : [];
      if (!records.length && finalReports.length) {
        records = finalReports.map(function(report) {
          var draft = paperDrafts.find(function(item) { return item.reportId === report.id; });
          var trace = report.trace || {};
          return {
            id: 'derived-' + (report.id || ''),
            title: report.title || 'AutoResearch 任务',
            topic: report.topic || '',
            completedAt: report.generatedAt || '',
            finalReportId: report.id || '',
            finalReportTitle: report.title || '',
            paperDraftId: draft ? draft.id : '',
            paperDraftTitle: draft ? draft.title : '',
            literatureNodeCount: trace.literatureNodeCount || 0,
            evidenceObjectCount: trace.evidenceObjectCount || 0,
            pdfWikiEvidenceObjectCount: trace.pdfWikiEvidenceObjectCount || 0,
            embeddingEvidenceObjectCount: trace.embeddingEvidenceObjectCount || 0,
            auditVerdict: '',
            auditScore: null
          };
        });
      }
      pruneAutoResearchCompletedTaskSelection(records);
      var selectedIds = getAutoResearchSelectedCompletedTaskIds(records);
      var selectedMap = {};
      selectedIds.forEach(function(id) { selectedMap[id] = true; });
      var allSelected = records.length > 0 && records.every(function(record) { return !!selectedMap[record.id]; });
      var collapsed = !!autoResearchCompletedTasksCollapsed;
      var deleteDisabled = !selectedIds.length || autoResearchCompletedTaskDeleting;
      var body = records.length
        ? (collapsed
          ? '<div style="padding:12px;border:1px dashed var(--border-color);border-radius:8px;background:var(--bg-secondary);color:var(--text-secondary);font-size:13px;line-height:1.6;">已折叠：' + records.length + ' 条记录。</div>'
          : '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;">' +
              records.slice(0, 50).map(function(record) {
                var recordId = String(record.id || '');
                var checked = selectedMap[recordId] ? ' checked' : '';
                var auditText = record.auditScore == null
                  ? (record.auditVerdict || '未审计')
                  : ((record.auditVerdict || '审计') + ' ' + Math.round(Number(record.auditScore || 0) * 100));
                return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:11px;min-width:0;">' +
                  '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:6px;">' +
                    '<div style="display:flex;gap:9px;min-width:0;align-items:flex-start;">' +
                      '<input type="checkbox" data-autoresearch-completed-task-checkbox data-record-id="' + escapeHtml(recordId) + '" onchange="toggleAutoResearchCompletedTaskSelection(this.dataset.recordId,this.checked)"' + checked + (recordId ? '' : ' disabled') + ' style="width:16px;height:16px;margin-top:2px;cursor:pointer;flex:0 0 auto;">' +
                      '<div style="min-width:0;">' +
                        '<div style="font-size:13px;font-weight:800;color:var(--text-primary);line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + escapeHtml(record.title || '') + '">' + escapeHtml(record.title || 'AutoResearch 已完成任务') + '</div>' +
                        '<div style="margin-top:3px;font-size:11px;color:var(--text-secondary);">' + escapeHtml(formatAutoResearchDate(record.completedAt)) + '</div>' +
                      '</div>' +
                    '</div>' +
                    '<span style="display:inline-flex;align-items:center;height:22px;padding:0 7px;border:1px solid rgba(16,163,127,0.32);border-radius:999px;background:rgba(16,163,127,0.10);color:var(--accent-color);font-size:11px;font-weight:750;white-space:nowrap;">已完成</span>' +
                  '</div>' +
                  '<div style="font-size:12px;line-height:1.55;color:var(--text-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:37px;">' + escapeHtml(record.topic || record.goal || '') + '</div>' +
                  '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:9px;">' +
                    renderAutoResearchMiniMetric('文献', record.literatureNodeCount || 0) +
                    renderAutoResearchMiniMetric('证据', record.evidenceObjectCount || 0) +
                    renderAutoResearchMiniMetric('PDF', record.pdfWikiEvidenceObjectCount || 0) +
                    renderAutoResearchMiniMetric('审计', auditText) +
                  '</div>' +
                  '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px;">' +
                    (record.finalReportId ? '<button type="button" data-autoresearch-action="edit-report" data-report-id="' + escapeHtml(record.finalReportId) + '" style="height:28px;padding:0 9px;border:1px solid var(--accent-color);border-radius:6px;background:transparent;color:var(--accent-color);cursor:pointer;font-size:12px;">打开报告</button>' : '') +
                    (record.finalReportId ? '<button type="button" data-autoresearch-action="download-report" data-report-id="' + escapeHtml(record.finalReportId) + '" style="height:28px;padding:0 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);cursor:pointer;font-size:12px;">下载</button>' : '') +
                    (record.paperDraftId ? '<button type="button" data-autoresearch-action="edit-paper-draft" data-draft-id="' + escapeHtml(record.paperDraftId) + '" style="height:28px;padding:0 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);cursor:pointer;font-size:12px;">打开草稿</button>' : '') +
                  '</div>' +
                '</div>';
              }).join('') +
            '</div>')
        : '<div style="padding:12px;border:1px dashed var(--border-color);border-radius:8px;background:var(--bg-secondary);color:var(--text-secondary);font-size:13px;line-height:1.6;">暂无已完成任务。运行“开始自动研究”并生成最终报告后，会在这里保存任务记录。</div>';
      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:14px;margin-bottom:14px;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:11px;flex-wrap:wrap;">' +
          '<div style="display:flex;align-items:center;gap:9px;min-width:0;">' +
            '<div style="font-size:14px;font-weight:800;color:var(--text-primary);">已完成任务记录</div>' +
            '<div style="font-size:12px;color:var(--text-secondary);">' + records.length + ' 条</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">' +
            (records.length && !collapsed ? '<label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--text-secondary);white-space:nowrap;cursor:pointer;"><input id="autoResearchCompletedTaskSelectAll" type="checkbox" onchange="toggleAllAutoResearchCompletedTasks(this.checked)"' + (allSelected ? ' checked' : '') + ' style="width:15px;height:15px;">全选</label>' : '') +
            '<span id="autoResearchCompletedTaskSelectedCount" style="font-size:12px;color:var(--text-secondary);white-space:nowrap;">' + (selectedIds.length ? ('已选 ' + selectedIds.length + ' 条') : '未选择') + '</span>' +
            '<button id="autoResearchCompletedTaskDeleteBtn" type="button" onclick="deleteSelectedAutoResearchCompletedTasks()" ' + (deleteDisabled ? 'disabled ' : '') + 'style="height:28px;padding:0 9px;border:1px solid var(--danger-color);border-radius:6px;background:transparent;color:var(--danger-color);cursor:' + (deleteDisabled ? 'not-allowed' : 'pointer') + ';font-size:12px;opacity:' + (deleteDisabled ? '0.55' : '1') + ';">' + (autoResearchCompletedTaskDeleting ? '删除中' : '删除选中') + '</button>' +
            '<button type="button" onclick="toggleAutoResearchCompletedTasksCollapsed()" style="height:28px;padding:0 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">' + (collapsed ? '展开' : '折叠') + '</button>' +
          '</div>' +
        '</div>' +
        body +
      '</div>';
    }

    function renderAutoResearchMiniMetric(label, value) {
      return '<div style="min-width:0;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-primary);padding:6px;">' +
        '<div style="font-size:10px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(label) + '</div>' +
        '<div style="margin-top:3px;font-size:12px;font-weight:800;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(value == null || value === '' ? '-' : String(value)) + '</div>' +
      '</div>';
    }

    function renderAutoResearchEvidencePrereqNotice(state) {
      var evidenceLibrary = state.evidenceLibrary || {};
      var evidenceObjects = Array.isArray(evidenceLibrary.objects) ? evidenceLibrary.objects : [];
      if (evidenceObjects.length > 0) return '';
      var literatureMap = state.literatureMap || {};
      var literatureNodes = Array.isArray(literatureMap.nodes) ? literatureMap.nodes : [];
      var snapshots = Array.isArray(evidenceLibrary.snapshots) ? evidenceLibrary.snapshots : [];
      var latestSnapshot = snapshots[0] || null;
      var entryCount = latestSnapshot ? Number(latestSnapshot.entryCount || 0) : 0;
      var referenceCount = latestSnapshot ? Number(latestSnapshot.referenceCount || 0) : 0;
      var message = literatureNodes.length > 0
        ? 'PDF Wiki 句级证据为空，但 AutoResearch 会使用 embedding 文献库的标题、摘要、作者年份、期刊和 DOI 构建论文级证据。若需要页码和原文句级定位，再运行 PDF 深入分析。'
        : entryCount > 0
        ? 'PDF Wiki 中已有论点组，但没有生成可追溯 evidence object。通常是论点缺少支持/中性/反对观点或证据句绑定。'
        : 'AutoResearch 还没有可追溯 evidence object，因此无法做引用对齐和证据充分性检查。需要先在 PDF 管理上传 PDF，并完成深入分析或重建 PDF Wiki。';
      var snapshotText = latestSnapshot
        ? '最近同步：论点组 ' + entryCount + ' · 参考文献 ' + referenceCount + ' · ' + formatAutoResearchDate(latestSnapshot.importedAt)
        : (literatureNodes.length > 0 ? 'Embedding 文献库：' + literatureNodes.length + ' 篇，可作为摘要级证据源。' : '尚未同步 PDF Wiki。');
      return '<div style="border:1px solid rgba(245,158,11,0.45);border-radius:8px;background:rgba(245,158,11,0.08);padding:13px 14px;margin-bottom:14px;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">' +
          '<div style="min-width:0;">' +
            '<div style="font-size:13px;font-weight:750;color:var(--text-primary);margin-bottom:5px;">' + (literatureNodes.length > 0 ? 'PDF Wiki 证据为空，已启用摘要证据' : '证据库为空') + '</div>' +
            '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">' + escapeHtml(message) + '</div>' +
            '<div style="font-size:11px;color:var(--text-secondary);margin-top:6px;">' + escapeHtml(snapshotText) + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end;">' +
            '<button type="button" data-autoresearch-action="sync-evidence" style="padding:7px 9px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">重新同步</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    function renderAutoResearchEvaluation(report) {
      if (!report) {
        return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:14px;margin-bottom:14px;">' +
          '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">' +
            '<div style="font-size:14px;font-weight:700;color:var(--text-primary);">审稿式自检</div>' +
            '<button type="button" data-autoresearch-action="evaluate" style="padding:7px 10px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">运行</button>' +
          '</div>' +
        '</div>';
      }
      var metrics = Array.isArray(report.metrics) ? report.metrics : [];
      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:14px;margin-bottom:14px;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:12px;">' +
          '<div style="font-size:14px;font-weight:700;color:var(--text-primary);">审稿式自检</div>' +
          '<div style="font-size:12px;color:var(--text-secondary);">总分 ' + Math.round(Number(report.overallScore || 0) * 100) + ' · ' + escapeHtml(formatAutoResearchDate(report.generatedAt)) + '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:10px;">' +
          metrics.map(function(metric) {
            var score = Math.round(Number(metric.score || 0) * 100);
            var color = metric.level === 'pass' ? 'var(--accent-color)' : (metric.level === 'fail' ? 'var(--danger-color)' : '#f59e0b');
            var metricSummary = formatAutoResearchMetricSummary(metric);
            return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:11px;min-width:0;">' +
              '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:7px;">' +
                '<div style="font-size:13px;font-weight:700;color:var(--text-primary);">' + escapeHtml(metric.label || metric.id) + '</div>' +
                '<div style="font-size:12px;font-weight:750;color:' + color + ';white-space:nowrap;">得分 ' + score + '</div>' +
              '</div>' +
              '<div style="font-size:12px;line-height:1.55;color:var(--text-secondary);">' + escapeHtml(metricSummary) + '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
        (report.issues && report.issues.length ? '<div style="margin-top:12px;font-size:12px;color:var(--text-secondary);line-height:1.65;"><strong style="color:var(--text-primary);">问题：</strong>' + escapeHtml(report.issues.slice(0, 4).join('；')) + '</div>' : '') +
        (report.recommendations && report.recommendations.length ? '<div style="margin-top:8px;font-size:12px;color:var(--text-secondary);line-height:1.65;"><strong style="color:var(--text-primary);">建议：</strong>' + escapeHtml(report.recommendations.slice(0, 4).join('；')) + '</div>' : '') +
      '</div>';
    }

    function renderAutoResearchAuditReport(report) {
      if (!report) {
        return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:14px;margin-bottom:14px;">' +
          '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">' +
            '<div style="min-width:0;">' +
              '<div style="font-size:14px;font-weight:700;color:var(--text-primary);">引用与论据审计</div>' +
              '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-top:4px;">检查引用覆盖、证据来源、弱证据、反证材料和可回放操作。</div>' +
            '</div>' +
            '<button type="button" data-autoresearch-action="audit" style="padding:7px 10px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">运行审计</button>' +
          '</div>' +
        '</div>';
      }
      var findings = Array.isArray(report.findings) ? report.findings : [];
      var color = report.verdict === 'pass' ? 'var(--accent-color)' : (report.verdict === 'fail' ? 'var(--danger-color)' : '#f59e0b');
      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:14px;margin-bottom:14px;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:12px;">' +
          '<div style="min-width:0;">' +
            '<div style="font-size:14px;font-weight:700;color:var(--text-primary);">引用与论据审计</div>' +
            '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-top:5px;">' + escapeHtml(report.summary || '') + '</div>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:7px;">' +
            '<div style="font-size:12px;font-weight:750;color:' + color + ';white-space:nowrap;">' + escapeHtml(String(report.verdict || '')) + ' · ' + Math.round(Number(report.overallScore || 0) * 100) + '</div>' +
            '<button type="button" data-autoresearch-action="audit" style="padding:6px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">重新审计</button>' +
          '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:9px;">' +
          findings.slice(0, 8).map(function(finding) {
            var findingColor = finding.level === 'pass' ? 'var(--accent-color)' : (finding.level === 'fail' ? 'var(--danger-color)' : '#f59e0b');
            return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:10px;min-width:0;">' +
              '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:6px;">' +
                '<div style="font-size:12px;font-weight:700;color:var(--text-primary);">' + escapeHtml(finding.message || '') + '</div>' +
                '<div style="font-size:11px;color:' + findingColor + ';white-space:nowrap;">' + escapeHtml(finding.level || '') + '</div>' +
              '</div>' +
              '<div style="font-size:11.5px;color:var(--text-secondary);line-height:1.55;">' + escapeHtml(finding.detail || '') + '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
    }

    function renderAutoResearchResearchWikiPanel(wiki) {
      wiki = wiki || {};
      var nodes = Array.isArray(wiki.nodes) ? wiki.nodes : [];
      var edges = Array.isArray(wiki.edges) ? wiki.edges : [];
      var claims = nodes.filter(function(node) { return node.type === 'claim'; }).slice(0, 8);
      var gaps = nodes.filter(function(node) { return node.type === 'gap'; }).slice(0, 6);
      var papers = nodes.filter(function(node) { return node.type === 'paper'; }).slice(0, 6);
      var preview = String(wiki.queryPack || '').slice(0, 900);
      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:14px;margin-bottom:14px;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:12px;">' +
          '<div style="min-width:0;">' +
            '<div style="font-size:14px;font-weight:700;color:var(--text-primary);">研究 Wiki / 证据图谱</div>' +
            '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-top:5px;">文献、论点、知识缺口和证据关系的本地上下文包，可被一键写论文继续调用。</div>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:7px;">' +
            '<div style="font-size:12px;color:var(--text-secondary);white-space:nowrap;">节点 ' + nodes.length + ' · 关系 ' + edges.length + '</div>' +
            '<button type="button" data-autoresearch-action="research-wiki" style="padding:6px 9px;border:1px solid var(--accent-color);border-radius:6px;background:transparent;color:var(--accent-color);cursor:pointer;font-size:12px;">重建Wiki</button>' +
          '</div>' +
        '</div>' +
        (nodes.length
          ? '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px;">' +
              renderAutoResearchWikiNodeGroup('核心论点', claims) +
              renderAutoResearchWikiNodeGroup('知识缺口', gaps) +
              renderAutoResearchWikiNodeGroup('代表文献', papers) +
            '</div>' +
            '<details style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:10px;">' +
              '<summary style="cursor:pointer;font-size:12px;font-weight:700;color:var(--text-primary);">查看 Query Pack</summary>' +
              '<pre style="margin:10px 0 0;white-space:pre-wrap;font-size:11.5px;line-height:1.55;color:var(--text-secondary);font-family:inherit;max-height:260px;overflow:auto;">' + escapeHtml(preview || '暂无 Query Pack') + '</pre>' +
            '</details>'
          : '<div style="padding:14px;border:1px dashed var(--border-color);border-radius:8px;color:var(--text-secondary);font-size:13px;line-height:1.6;">暂无研究 Wiki。同步文献库和证据后点击“重建Wiki”，或直接运行完整 Auto Research。</div>') +
      '</div>';
    }

    function renderAutoResearchWikiNodeGroup(title, nodes) {
      var list = Array.isArray(nodes) ? nodes : [];
      return '<section style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:10px;min-width:0;">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:8px;">' + escapeHtml(title) + '</div>' +
        (list.length
          ? '<div style="display:flex;flex-direction:column;gap:7px;">' + list.map(function(node) {
              var evidenceCount = Array.isArray(node.evidenceObjectIds) ? node.evidenceObjectIds.length : 0;
              return '<div style="min-width:0;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-primary);padding:8px;">' +
                '<div style="font-size:12px;font-weight:650;color:var(--text-primary);line-height:1.45;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">' + escapeHtml(node.title || '未命名节点') + '</div>' +
                '<div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">证据 ' + evidenceCount + '</div>' +
              '</div>';
            }).join('') + '</div>'
          : '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">暂无节点</div>') +
      '</section>';
    }

    function formatAutoResearchMetricSummary(metric) {
      var summary = String(metric && metric.summary || '');
      if (metric && metric.id === 'evidence_sufficiency' && /^0\s*个论点组/.test(summary)) {
        return '暂无论点组，无法检查证据充分性。';
      }
      if (metric && metric.id === 'citation_alignment' && /^0\/0\s*个证据对象/.test(summary)) {
        return '暂无证据对象，无法检查引用对齐。';
      }
      return summary;
    }

    function renderAutoResearchFinalReport(report) {
      if (!report) {
        return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:14px;margin-bottom:14px;">' +
          '<div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">最终结果</div>' +
          '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">填写研究主题后点击“开始自动研究”，系统会自动同步文献库、同步 PDF Wiki 证据、运行审稿式自检，并在这里生成完整结果。</div>' +
        '</div>';
      }
      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:14px;margin-bottom:14px;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:12px;">' +
          '<div style="min-width:0;">' +
            '<div style="font-size:15px;font-weight:750;color:var(--text-primary);line-height:1.45;">' + escapeHtml(report.title || 'AutoResearch 结果') + '</div>' +
            '<div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">' + escapeHtml(formatAutoResearchDate(report.generatedAt)) + (report.editedAt ? ' · 已编辑 ' + escapeHtml(formatAutoResearchDate(report.editedAt)) : '') + '</div>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:7px;">' +
            '<div style="font-size:11px;color:var(--accent-color);white-space:nowrap;">主题文献 ' + escapeHtml(report.trace && report.trace.literatureNodeCount || 0) + ' / 全库 ' + escapeHtml(report.trace && report.trace.totalLiteratureNodeCount || 0) + ' · 等权证据 ' + escapeHtml(report.trace && report.trace.evidenceObjectCount || 0) + '（PDF原始 ' + escapeHtml(report.trace && report.trace.pdfWikiEvidenceObjectCount || 0) + ' / 摘要原始 ' + escapeHtml(report.trace && report.trace.embeddingEvidenceObjectCount || 0) + '）</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">' +
              '<button type="button" data-autoresearch-action="continue-home" data-report-id="' + escapeHtml(report.id || '') + '" style="padding:6px 9px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">在主页写作</button>' +
              '<button type="button" data-autoresearch-action="edit-report" data-report-id="' + escapeHtml(report.id || '') + '" style="padding:6px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">查看/编辑</button>' +
              '<button type="button" data-autoresearch-action="download-report" data-report-id="' + escapeHtml(report.id || '') + '" style="padding:6px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">下载 Markdown</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:12px;line-height:1.7;color:var(--text-primary);padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);margin-bottom:12px;">' + escapeHtml(report.executiveSummary || '') + '</div>' +
        renderAutoResearchPaperTopicReview(report.paperTopicReview) +
        renderAutoResearchPaperBlueprint(report.paperWritingBlueprint) +
        renderAutoResearchContentEnhancement(report.contentEnhancementReport) +
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">' +
          renderAutoResearchReportList('文献图谱', report.literatureOverview) +
          renderAutoResearchReportList('研究假设', report.hypotheses) +
          renderAutoResearchReportList('知识缺口', report.knowledgeGaps) +
          renderAutoResearchReportList('实验/数据计划', report.experimentPlan) +
          renderAutoResearchReportList('草稿框架', report.draftOutline) +
          renderAutoResearchReportList('下一步', report.nextSteps) +
        '</div>' +
        renderAutoResearchEvidenceSynthesis(report.evidenceSynthesis) +
        '<div style="margin-top:12px;font-size:12px;color:var(--text-secondary);line-height:1.65;"><strong style="color:var(--text-primary);">自检摘要：</strong>' + escapeHtml(report.reviewSummary || '') + '</div>' +
        (report.limitations && report.limitations.length ? '<div style="margin-top:8px;font-size:12px;color:var(--text-secondary);line-height:1.65;"><strong style="color:var(--text-primary);">限制：</strong>' + escapeHtml(report.limitations.join('；')) + '</div>' : '') +
      '</div>';
    }

    function renderAutoResearchPaperTopicReview(review) {
      if (!review) return '';
      var boundary = review.recommendedBoundary || {};
      var mismatch = Array.isArray(review.mismatchPoints) ? review.mismatchPoints.slice(0, 4) : [];
      var risks = Array.isArray(review.highRiskIssues) ? review.highRiskIssues.slice(0, 5) : [];
      return '<section style="border:1px solid rgba(15,118,110,0.28);border-radius:8px;background:rgba(240,253,250,0.55);padding:11px;margin-bottom:12px;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:8px;">' +
          '<div style="font-size:13px;font-weight:750;color:var(--text-primary);">论文选题与内容前置审查</div>' +
          '<div style="font-size:11px;color:var(--accent-color);white-space:nowrap;">' + escapeHtml(review.goToWritingStage || '未判断') + '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:9px;">' +
          '<div style="font-size:11px;color:var(--text-secondary);">推荐类型<br><strong style="color:var(--text-primary);">' + escapeHtml(review.paperType || '未判断') + '</strong></div>' +
          '<div style="font-size:11px;color:var(--text-secondary);">选题风险<br><strong style="color:var(--text-primary);">' + escapeHtml(review.topicRiskLevel || '未判断') + '</strong></div>' +
          '<div style="font-size:11px;color:var(--text-secondary);">证据准备度<br><strong style="color:var(--text-primary);">' + escapeHtml(review.evidenceReadiness || '未判断') + '</strong></div>' +
          '<div style="font-size:11px;color:var(--text-secondary);">研究对象<br><strong style="color:var(--text-primary);">' + escapeHtml(boundary.object || '未锁定') + '</strong></div>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);line-height:1.65;margin-bottom:8px;">' + escapeHtml(review.topicScopeDiagnosis || '') + '</div>' +
        (mismatch.length ? '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;"><strong style="color:var(--text-primary);">主要不匹配：</strong>' + escapeHtml(mismatch.join('；')) + '</div>' : '') +
        (risks.length ? '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-top:5px;"><strong style="color:var(--text-primary);">高风险：</strong>' + escapeHtml(risks.join('；')) + '</div>' : '') +
      '</section>';
    }

    function renderAutoResearchPaperBlueprint(blueprint) {
      if (!blueprint) return '';
      return '<section style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:11px;margin-bottom:12px;">' +
        '<div style="font-size:13px;font-weight:750;color:var(--text-primary);margin-bottom:8px;">推荐论文写作蓝图</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);line-height:1.65;margin-bottom:8px;"><strong style="color:var(--text-primary);">推荐题目：</strong>' + escapeHtml(blueprint.recommendedTitle || '') + '</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);line-height:1.65;margin-bottom:8px;"><strong style="color:var(--text-primary);">中心论点：</strong>' + escapeHtml(blueprint.centralArgument || '') + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">' +
          renderAutoResearchReportList('核心科学问题', blueprint.coreScientificQuestions) +
          renderAutoResearchReportList('可支持的结论', blueprint.supportedClaims) +
          renderAutoResearchReportList('不能写的结论', blueprint.claimsToAvoid) +
          renderAutoResearchReportList('必须增加的图表', blueprint.requiredFiguresTables) +
        '</div>' +
      '</section>';
    }

    function renderAutoResearchContentEnhancement(enhancement) {
      if (!enhancement) return '';
      var decision = enhancement.goNoGoDecision || {};
      var diagnosis = enhancement.paperPositionDiagnosis || {};
      var blueprint = enhancement.finalWritingBlueprint || {};
      var matrixRows = Array.isArray(enhancement.evidenceMatrix) ? enhancement.evidenceMatrix.slice(0, 4) : [];
      return '<section style="border:1px solid rgba(20,83,45,0.28);border-radius:8px;background:rgba(240,253,244,0.58);padding:11px;margin-bottom:12px;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:8px;">' +
          '<div style="font-size:13px;font-weight:750;color:var(--text-primary);">内容厚度与论证结构增强</div>' +
          '<div style="font-size:11px;color:var(--accent-color);white-space:nowrap;">' + escapeHtml(decision.decision || '未判断') + '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:9px;">' +
          '<div style="font-size:11px;color:var(--text-secondary);">当前类型<br><strong style="color:var(--text-primary);">' + escapeHtml(diagnosis.currentManuscriptType || '未判断') + '</strong></div>' +
          '<div style="font-size:11px;color:var(--text-secondary);">目标类型<br><strong style="color:var(--text-primary);">' + escapeHtml(diagnosis.targetPaperType || '未判断') + '</strong></div>' +
          '<div style="font-size:11px;color:var(--text-secondary);">证据矩阵<br><strong style="color:var(--text-primary);">' + escapeHtml(String((enhancement.evidenceMatrix || []).length || 0)) + ' 行</strong></div>' +
          '<div style="font-size:11px;color:var(--text-secondary);">正向发现<br><strong style="color:var(--text-primary);">' + escapeHtml(String((enhancement.positiveFindings || []).length || 0)) + ' 条</strong></div>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);line-height:1.65;margin-bottom:8px;"><strong style="color:var(--text-primary);">判定理由：</strong>' + escapeHtml(decision.reason || '') + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:10px;">' +
          renderAutoResearchReportList('正向发现', enhancement.positiveFindings) +
          renderAutoResearchReportList('主要内容问题', enhancement.mainContentProblems) +
          renderAutoResearchReportList('必须生成的表格', blueprint.requiredTables) +
          renderAutoResearchReportList('必须生成的图示', blueprint.requiredFigures) +
        '</div>' +
        (enhancement.innovationFramework ? '<div style="font-size:12px;color:var(--text-secondary);line-height:1.65;margin-bottom:8px;"><strong style="color:var(--text-primary);">创新框架：</strong>' + escapeHtml((enhancement.innovationFramework.frameworkName || '') + ' - ' + (enhancement.innovationFramework.coreLogic || '')) + '</div>' : '') +
        (matrixRows.length ? '<div style="overflow:auto;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);">' +
          '<table style="width:100%;border-collapse:collapse;font-size:11px;color:var(--text-secondary);min-width:760px;">' +
            '<thead><tr>' +
              '<th style="text-align:left;padding:7px;border-bottom:1px solid var(--border-color);color:var(--text-primary);">来源</th>' +
              '<th style="text-align:left;padding:7px;border-bottom:1px solid var(--border-color);color:var(--text-primary);">证据等级</th>' +
              '<th style="text-align:left;padding:7px;border-bottom:1px solid var(--border-color);color:var(--text-primary);">强度</th>' +
              '<th style="text-align:left;padding:7px;border-bottom:1px solid var(--border-color);color:var(--text-primary);">可支持结论</th>' +
              '<th style="text-align:left;padding:7px;border-bottom:1px solid var(--border-color);color:var(--text-primary);">不能写</th>' +
            '</tr></thead>' +
            '<tbody>' + matrixRows.map(function(row) {
              return '<tr>' +
                '<td style="vertical-align:top;padding:7px;border-bottom:1px solid var(--border-color);">' + escapeHtml(row.studyOrDataSource || '') + '</td>' +
                '<td style="vertical-align:top;padding:7px;border-bottom:1px solid var(--border-color);">' + escapeHtml(row.evidenceClass || '') + '</td>' +
                '<td style="vertical-align:top;padding:7px;border-bottom:1px solid var(--border-color);">' + escapeHtml(row.evidenceStrength || '') + '</td>' +
                '<td style="vertical-align:top;padding:7px;border-bottom:1px solid var(--border-color);">' + escapeHtml(row.supportedClaim || '') + '</td>' +
                '<td style="vertical-align:top;padding:7px;border-bottom:1px solid var(--border-color);">' + escapeHtml(row.claimToAvoid || '') + '</td>' +
              '</tr>';
            }).join('') + '</tbody>' +
          '</table>' +
        '</div>' : '') +
      '</section>';
    }

    function renderAutoResearchPaperDraft(draft) {
      if (!draft) return '';
      var markdown = String(draft.editedMarkdown || draft.markdown || '');
      var preview = markdown
        .replace(/^# .*\n+/, '')
        .replace(/[#*_>`\-[\]()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 360);
      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:14px;margin-bottom:14px;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px;">' +
          '<div style="min-width:0;">' +
            '<div style="font-size:15px;font-weight:750;color:var(--text-primary);line-height:1.45;">' + escapeHtml(draft.title || 'AutoResearch 论文草稿') + '</div>' +
            '<div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">' + escapeHtml(formatAutoResearchDate(draft.generatedAt)) + (draft.editedAt ? ' · 已编辑 ' + escapeHtml(formatAutoResearchDate(draft.editedAt)) : '') + '</div>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:7px;">' +
            '<div style="font-size:11px;color:var(--accent-color);white-space:nowrap;">约 ' + escapeHtml(draft.wordCountEstimate || 0) + ' 字 · 参考文献 ' + escapeHtml(draft.referenceCount || 0) + ' 条</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">' +
              '<button type="button" data-autoresearch-action="edit-paper-draft" data-draft-id="' + escapeHtml(draft.id || '') + '" style="padding:6px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">查看/编辑论文</button>' +
              '<button type="button" data-autoresearch-action="download-paper-draft" data-draft-id="' + escapeHtml(draft.id || '') + '" style="padding:6px 9px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">下载论文</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:12px;line-height:1.7;color:var(--text-secondary);padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);">' + escapeHtml(preview || '论文草稿已生成。') + '</div>' +
      '</div>';
    }

    function renderAutoResearchReportList(title, items) {
      var list = Array.isArray(items) ? items.filter(Boolean).slice(0, 8) : [];
      return '<section style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:11px;min-width:0;">' +
        '<div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:8px;">' + escapeHtml(title) + '</div>' +
        (list.length
          ? '<ol style="margin:0;padding-left:18px;color:var(--text-secondary);font-size:12px;line-height:1.65;">' + list.map(function(item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') + '</ol>'
          : '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">暂无内容</div>') +
      '</section>';
    }

    function renderAutoResearchEvidenceSynthesis(items) {
      var list = Array.isArray(items) ? items.slice(0, 6) : [];
      if (!list.length) return '';
      return '<section style="margin-top:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:11px;">' +
        '<div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:8px;">证据综合</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;">' + list.map(function(item) {
          return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:9px;">' +
            '<div style="font-size:12px;font-weight:700;color:var(--text-primary);line-height:1.5;">' + escapeHtml(item.claim || '未命名论点') + '</div>' +
            '<div style="font-size:11px;color:var(--accent-color);margin-top:4px;">支持 ' + escapeHtml(item.supportCount || 0) + ' · 中性 ' + escapeHtml(item.neutralCount || 0) + ' · 反对 ' + escapeHtml(item.opposeCount || 0) + '</div>' +
            '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-top:5px;">' + escapeHtml(item.summary || '') + '</div>' +
          '</div>';
        }).join('') + '</div>' +
      '</section>';
    }

    function renderAutoResearchLiteraturePanel(nodes, tags, snapshots, filteredTotalNodeCount, totalNodeCount, totalEmbeddingCount) {
      var latestSnapshot = snapshots && snapshots.length ? snapshots[0] : null;
      var topTags = (Array.isArray(tags) ? tags : [])
        .filter(function(tag) { return tag.kind === 'mergedTag' || tag.kind === 'keyword' || tag.kind === 'aiKeyword'; })
        .slice(0, 10);
      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:14px;margin-bottom:14px;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:12px;">' +
          '<div style="font-size:14px;font-weight:700;color:var(--text-primary);">' + (filteredTotalNodeCount ? 'Embedding 主题文献图谱' : 'Embedding 文献图谱') + '</div>' +
          '<div style="font-size:12px;color:var(--text-secondary);">' + (latestSnapshot ? escapeHtml((filteredTotalNodeCount ? ('主题 ' + nodes.length + ' / 全库 ' + filteredTotalNodeCount) : ('全库 ' + totalNodeCount)) + ' · 向量 ' + totalEmbeddingCount + ' · ' + formatAutoResearchDate(latestSnapshot.importedAt)) : '未同步') + '</div>' +
        '</div>' +
        (topTags.length
          ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">' + topTags.map(function(tag) {
              return '<span style="max-width:100%;padding:4px 7px;border:1px solid var(--border-color);border-radius:999px;background:var(--bg-secondary);font-size:11px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(tag.name || '') + ' · ' + escapeHtml(String(tag.count || 0)) + '</span>';
            }).join('') + '</div>'
          : '') +
        (nodes.length
          ? '<div style="display:flex;flex-direction:column;gap:9px;">' + nodes.slice(0, 8).map(renderAutoResearchLiteratureNode).join('') + '</div>'
          : '<div style="padding:14px;border:1px dashed var(--border-color);border-radius:8px;color:var(--text-secondary);font-size:13px;">暂无 embedding 文献节点</div>') +
      '</div>';
    }

    function renderAutoResearchLiteratureNode(item) {
      var keywords = []
        .concat(Array.isArray(item.keywords) ? item.keywords : [])
        .concat(Array.isArray(item.aiKeywords) ? item.aiKeywords : [])
        .filter(Boolean)
        .slice(0, 5)
        .join('；');
      return '<article style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:11px;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:6px;">' +
          '<div style="font-size:13px;font-weight:700;color:var(--text-primary);line-height:1.45;">' + escapeHtml(item.title || 'Untitled literature') + '</div>' +
          '<span style="font-size:11px;color:' + (item.hasEmbedding ? 'var(--accent-color)' : 'var(--text-secondary)') + ';white-space:nowrap;">' + (item.hasEmbedding ? '向量' : '未向量') + '</span>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--text-secondary);line-height:1.55;">' +
          escapeHtml([item.authors || '', item.year || '', item.journal || ''].filter(Boolean).join(' · ')) +
          (item.doi ? '<div style="margin-top:3px;">DOI：' + escapeHtml(item.doi) + '</div>' : '') +
          (keywords ? '<div style="margin-top:3px;">关键词：' + escapeHtml(keywords) + '</div>' : '') +
        '</div>' +
      '</article>';
    }

    function buildAutoResearchLiteratureTagsForDisplay(nodes) {
      var tagMap = {};
      (Array.isArray(nodes) ? nodes : []).forEach(function(node) {
        []
          .concat(Array.isArray(node.keywords) ? node.keywords : [])
          .concat(Array.isArray(node.aiKeywords) ? node.aiKeywords : [])
          .forEach(function(keyword) {
            var name = String(keyword || '').trim();
            var key = name.toLowerCase();
            if (!key) return;
            if (!tagMap[key]) tagMap[key] = { name: name, kind: 'keyword', count: 0, ids: {} };
            if (!tagMap[key].ids[node.id]) {
              tagMap[key].ids[node.id] = true;
              tagMap[key].count += 1;
            }
          });
      });
      return Object.keys(tagMap)
        .map(function(key) {
          return { id: key, name: tagMap[key].name, kind: 'keyword', count: tagMap[key].count, literatureIds: Object.keys(tagMap[key].ids) };
        })
        .sort(function(a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
    }

    function renderAutoResearchEvidencePanel(evidenceObjects, snapshots) {
      var latestSnapshot = snapshots && snapshots.length ? snapshots[0] : null;
      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:14px;margin-bottom:14px;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:12px;">' +
          '<div style="font-size:14px;font-weight:700;color:var(--text-primary);">可追溯证据库</div>' +
          '<div style="font-size:12px;color:var(--text-secondary);">' + (latestSnapshot ? escapeHtml('快照 ' + latestSnapshot.evidenceObjectCount + ' · ' + formatAutoResearchDate(latestSnapshot.importedAt)) : '未同步') + '</div>' +
        '</div>' +
        (evidenceObjects.length
          ? '<div style="display:flex;flex-direction:column;gap:9px;">' + evidenceObjects.slice(0, 10).map(renderAutoResearchEvidenceObject).join('') + '</div>'
          : '<div style="padding:14px;border:1px dashed var(--border-color);border-radius:8px;color:var(--text-secondary);font-size:13px;line-height:1.6;">暂无 PDF Wiki 句级 evidence object。AutoResearch 自检和最终报告会在可用时使用 embedding 文献摘要作为论文级证据。</div>') +
      '</div>';
    }

    function renderAutoResearchEvidenceObject(item) {
      var stanceText = item.stance === 'support' ? '支持' : (item.stance === 'oppose' ? '反对' : '中性');
      var refs = Array.isArray(item.references) ? item.references : [];
      var refText = refs.map(function(ref) { return ref.doi || ref.title || ref.raw || ref.id; }).filter(Boolean).slice(0, 3).join('；');
      return '<article style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:11px;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:6px;">' +
          '<div style="font-size:13px;font-weight:700;color:var(--text-primary);line-height:1.45;">' + escapeHtml(item.claim || '未命名论点') + '</div>' +
          '<span style="font-size:11px;color:var(--accent-color);white-space:nowrap;">' + escapeHtml(stanceText) + '</span>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);line-height:1.65;">' + escapeHtml(item.evidenceText || item.viewpointSummary || '') + '</div>' +
        '<div style="margin-top:7px;font-size:11px;color:var(--text-secondary);line-height:1.55;">' +
          '<span>PDF：' + escapeHtml(item.sourcePdfName || item.sourcePdfTitle || '未解析') + '</span>' +
          (item.section ? '<span> · ' + escapeHtml(item.section) + '</span>' : '') +
          (refText ? '<div style="margin-top:4px;">引用：' + escapeHtml(refText) + '</div>' : '') +
        '</div>' +
      '</article>';
    }

    function renderAutoResearchMemoryPanel(memories) {
      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:14px;">' +
        '<div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:10px;">项目级研究记忆</div>' +
        '<div style="display:grid;grid-template-columns:140px 1fr auto;gap:8px;margin-bottom:12px;">' +
          '<select id="autoResearchMemoryKind" style="border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);padding:8px;font-size:12px;">' +
            '<option value="finding">发现</option><option value="hypothesis">假设</option><option value="failure">失败经验</option><option value="method">方法</option><option value="constraint">限制</option><option value="todo">待办</option>' +
          '</select>' +
          '<input id="autoResearchMemoryInput" placeholder="记录项目记忆" style="min-width:0;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);padding:8px;font-size:12px;">' +
          '<button type="button" onclick="addAutoResearchMemory()" style="padding:8px 10px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">添加</button>' +
        '</div>' +
        (memories.length
          ? '<div style="display:flex;flex-direction:column;gap:8px;">' + memories.slice(0, 8).map(function(item) {
              return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:10px;">' +
                '<div style="font-size:11px;color:var(--accent-color);margin-bottom:5px;">' + escapeHtml(item.kind || 'memory') + ' · ' + escapeHtml(item.source || '') + '</div>' +
                '<div style="font-size:12px;line-height:1.6;color:var(--text-primary);">' + escapeHtml(item.content || '') + '</div>' +
              '</div>';
            }).join('') + '</div>'
          : '<div style="padding:12px;border:1px dashed var(--border-color);border-radius:8px;color:var(--text-secondary);font-size:13px;">暂无项目记忆</div>') +
      '</div>';
    }

    function renderAutoResearchOperationPanel(operations) {
      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:14px;">' +
        '<div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:12px;">可回放操作记录</div>' +
        (operations.length
          ? '<div style="display:flex;flex-direction:column;gap:9px;">' + operations.slice(0, 12).map(function(operation) {
              return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:10px;">' +
                '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">' +
                  '<div style="font-size:12px;font-weight:700;color:var(--text-primary);line-height:1.4;">' + escapeHtml(operation.kind || 'operation') + '</div>' +
                  '<div style="font-size:11px;color:var(--text-secondary);white-space:nowrap;">' + escapeHtml(operation.status || '') + '</div>' +
                '</div>' +
                '<div style="margin-top:6px;font-size:11px;color:var(--text-secondary);line-height:1.55;">' +
                  '<div>' + escapeHtml(formatAutoResearchDate(operation.completedAt || operation.startedAt)) + ' · ' + escapeHtml(operation.actor || 'system') + '</div>' +
                  '<div>input ' + escapeHtml(String(operation.inputHash || '').slice(0, 10)) + (operation.outputHash ? ' · output ' + escapeHtml(String(operation.outputHash).slice(0, 10)) : '') + '</div>' +
                  (operation.replayFile ? '<div>回放：' + escapeHtml(operation.replayFile) + '</div>' : '') +
                '</div>' +
              '</div>';
            }).join('') + '</div>'
          : '<div style="padding:12px;border:1px dashed var(--border-color);border-radius:8px;color:var(--text-secondary);font-size:13px;">暂无操作记录</div>') +
      '</div>';
    }

    function renderAutoResearchRunPanel() {
      var run = autoResearchRunState || {};
      var active = !!run.title;
      var progress = Math.max(0, Math.min(100, Math.round(Number(run.progress || 0))));
      var title = active ? run.title : '后台状态';
      var message = active ? (run.message || '准备中...') : '空闲';
      var logText = active && Array.isArray(run.lines) ? run.lines.slice(-4).join('\n') : '';
      return '<div id="autoResearchRunPanel" style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:10px;display:flex;flex-direction:column;gap:7px;">' +
        '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">' +
          '<div id="autoResearchRunTitle" style="font-size:12px;font-weight:700;color:var(--text-primary);">' + escapeHtml(title) + '</div>' +
          '<div id="autoResearchRunPercent" style="font-size:11px;color:var(--text-secondary);">' + progress + '%</div>' +
        '</div>' +
        '<div style="height:6px;border-radius:999px;background:var(--bg-primary);overflow:hidden;border:1px solid var(--border-color);">' +
          '<div id="autoResearchRunBar" style="height:100%;width:' + progress + '%;background:var(--accent-color);transition:width 0.25s ease;"></div>' +
        '</div>' +
        '<div id="autoResearchRunText" style="font-size:11px;color:var(--text-secondary);line-height:1.45;min-height:16px;">' + escapeHtml(message) + '</div>' +
        '<pre id="autoResearchRunLog" style="margin:0;white-space:pre-wrap;font-size:11px;line-height:1.45;color:var(--text-secondary);max-height:76px;overflow:auto;font-family:inherit;">' + escapeHtml(logText) + '</pre>' +
      '</div>';
    }

    function attachAutoResearchEventHandlers(root) {
      if (!root) return;
      var buttons = root.querySelectorAll('[data-autoresearch-action]');
      buttons.forEach(function(button) {
        if (button.dataset.bound === '1') return;
        button.dataset.bound = '1';
        button.addEventListener('click', function(event) {
          event.preventDefault();
          var action = button.getAttribute('data-autoresearch-action');
          if (action === 'claims') {
            reloadPdfWikiViewer(pdfWikiActiveSentencePointId || pdfWikiActiveEntryId);
          } else if (action === 'pdf-manager') {
            showPdfWikiPdfManager();
          } else if (action === 'run-full') {
            window.runFullAutoResearch();
          } else if (action === 'start') {
            window.startAutoResearchTask();
          } else if (action === 'sync-evidence') {
            window.syncAutoResearchPdfWiki();
          } else if (action === 'sync-library') {
            window.syncAutoResearchEmbeddingLibrary();
          } else if (action === 'evaluate') {
            window.evaluateAutoResearch();
          } else if (action === 'research-wiki') {
            window.rebuildAutoResearchWiki();
          } else if (action === 'audit') {
            window.auditAutoResearch();
          } else if (action === 'continue-home') {
            window.startAutoResearchAssistedWriting(button.getAttribute('data-report-id'));
          } else if (action === 'edit-report') {
            window.openAutoResearchFinalReportEditor(button.getAttribute('data-report-id'));
          } else if (action === 'download-report') {
            window.downloadAutoResearchFinalReport(button.getAttribute('data-report-id'));
          } else if (action === 'edit-paper-draft') {
            window.openAutoResearchPaperDraftEditor(button.getAttribute('data-draft-id'));
          } else if (action === 'download-paper-draft') {
            window.downloadAutoResearchPaperDraft(button.getAttribute('data-draft-id'));
          }
        });
      });
    }

    function setAutoResearchActionStatus(message, isError) {
      var status = document.getElementById('autoResearchActionStatus');
      if (status) {
        status.textContent = message || '';
        status.style.color = isError ? 'var(--danger-color)' : 'var(--text-secondary)';
      }
    }

    function createAutoResearchClientRunId(action) {
      return 'ar_' + action + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    function beginAutoResearchProgress(title, message) {
      autoResearchRunState = {
        title: title,
        message: message || '准备中...',
        progress: 3,
        status: 'running',
        lines: [],
        seenEventIds: {}
      };
      updateAutoResearchProgressUi();
      queueAutoResearchTypewriter(message || title);
    }

    function setAutoResearchProgress(progress, message, status) {
      if (!autoResearchRunState) {
        beginAutoResearchProgress('后台运行', message || '处理中...');
      }
      autoResearchRunState.progress = Math.max(0, Math.min(100, Math.round(Number(progress || 0))));
      autoResearchRunState.message = message || autoResearchRunState.message || '';
      autoResearchRunState.status = status || autoResearchRunState.status || 'running';
      updateAutoResearchProgressUi();
    }

    function updateAutoResearchProgressUi() {
      var run = autoResearchRunState || {};
      var progress = Math.max(0, Math.min(100, Math.round(Number(run.progress || 0))));
      var panel = document.getElementById('autoResearchRunPanel');
      var title = document.getElementById('autoResearchRunTitle');
      var percent = document.getElementById('autoResearchRunPercent');
      var bar = document.getElementById('autoResearchRunBar');
      var text = document.getElementById('autoResearchRunText');
      var log = document.getElementById('autoResearchRunLog');
      if (panel) panel.style.display = 'flex';
      if (title) title.textContent = run.title || '后台状态';
      if (percent) percent.textContent = progress + '%';
      if (bar) {
        bar.style.width = progress + '%';
        bar.style.background = run.status === 'failed' ? 'var(--danger-color)' : 'var(--accent-color)';
      }
      if (text) text.textContent = run.message || '空闲';
      if (log) {
        log.textContent = Array.isArray(run.lines) ? run.lines.slice(-6).join('\n') : '';
        log.scrollTop = log.scrollHeight;
      }
    }

    function queueAutoResearchTypewriter(message) {
      if (!message) return;
      autoResearchTypewriterQueue.push(String(message));
      if (!autoResearchTypewriterTimer) {
        pumpAutoResearchTypewriter();
      }
    }

    function pumpAutoResearchTypewriter() {
      if (!autoResearchRunState || autoResearchTypewriterQueue.length === 0) {
        autoResearchTypewriterTimer = null;
        return;
      }
      var source = autoResearchTypewriterQueue.shift();
      var prefix = '[' + new Date().toLocaleTimeString() + '] ';
      var target = prefix + source;
      var index = 0;
      autoResearchRunState.lines = Array.isArray(autoResearchRunState.lines) ? autoResearchRunState.lines : [];
      autoResearchRunState.lines.push('');
      var lineIndex = autoResearchRunState.lines.length - 1;
      autoResearchTypewriterTimer = setInterval(function() {
        if (!autoResearchRunState) {
          clearInterval(autoResearchTypewriterTimer);
          autoResearchTypewriterTimer = null;
          return;
        }
        index += 1;
        autoResearchRunState.lines[lineIndex] = target.slice(0, index);
        updateAutoResearchProgressUi();
        if (index >= target.length) {
          clearInterval(autoResearchTypewriterTimer);
          autoResearchTypewriterTimer = null;
          setTimeout(pumpAutoResearchTypewriter, 35);
        }
      }, 14);
    }

    function startAutoResearchProgressPolling(runId) {
      stopAutoResearchProgressPolling();
      autoResearchProgressPoller = setInterval(async function() {
        try {
          var response = await fetch('/api/autoresearch/progress?userId=' + encodeURIComponent(currentUserId) + '&runId=' + encodeURIComponent(runId));
          var data = await response.json();
          if (!response.ok || !data.success || !data.progress) return;
          var progress = data.progress;
          setAutoResearchProgress(progress.progress, progress.message, progress.status);
          var events = Array.isArray(progress.events) ? progress.events : [];
          if (autoResearchRunState) {
            autoResearchRunState.seenEventIds = autoResearchRunState.seenEventIds || {};
            events.forEach(function(event) {
              if (!event.id || autoResearchRunState.seenEventIds[event.id]) return;
              autoResearchRunState.seenEventIds[event.id] = true;
              queueAutoResearchTypewriter(event.message || progress.message || '');
            });
          }
          if (progress.status === 'completed' || progress.status === 'failed') {
            stopAutoResearchProgressPolling();
          }
        } catch (e) {
          // 进度轮询失败不影响主请求。
        }
      }, 500);
    }

    function stopAutoResearchProgressPolling() {
      if (autoResearchProgressPoller) {
        clearInterval(autoResearchProgressPoller);
        autoResearchProgressPoller = null;
      }
    }

    async function runAutoResearchRequest(options) {
      var runId = createAutoResearchClientRunId(options.action || 'run');
      beginAutoResearchProgress(options.title || '后台运行', options.startMessage || '请求已发送到后端');
      setAutoResearchActionStatus(options.startMessage || '后台处理中...', false);
      startAutoResearchProgressPolling(runId);
      setAutoResearchButtonsDisabled(true);
      try {
        var body = Object.assign({}, options.body || {}, {
          userId: currentUserId,
          clientRunId: runId,
          workspaceDirectory: getWorkspaceDirectoryPayload(currentConversationId)
        });
        setAutoResearchProgress(12, '请求已发送，等待后端处理...', 'running');
        var response = await fetch(options.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || options.errorMessage || '请求失败');
        setAutoResearchProgress(96, '后端已返回，正在刷新界面...', 'running');
        renderAutoResearchMode(data.state);
        setAutoResearchProgress(100, options.doneMessage || '完成', 'completed');
        setAutoResearchActionStatus(options.doneMessage || '完成', false);
        return data;
      } catch (e) {
        setAutoResearchProgress(100, (options.failPrefix || '操作失败：') + e.message, 'failed');
        setAutoResearchActionStatus((options.failPrefix || '操作失败：') + e.message, true);
        return null;
      } finally {
        setAutoResearchButtonsDisabled(false);
        setTimeout(stopAutoResearchProgressPolling, 900);
      }
    }

    window.toggleAutoResearchCompletedTasksCollapsed = function() {
      autoResearchCompletedTasksCollapsed = !autoResearchCompletedTasksCollapsed;
      if (autoResearchData) renderAutoResearchMode(autoResearchData);
    };

    window.toggleAutoResearchCompletedTaskSelection = function(recordId, checked) {
      recordId = String(recordId || '');
      if (!recordId) return;
      if (checked) autoResearchCompletedTaskSelection[recordId] = true;
      else delete autoResearchCompletedTaskSelection[recordId];
      updateAutoResearchCompletedTaskSelectionUi();
    };

    window.toggleAllAutoResearchCompletedTasks = function(checked) {
      var checkboxes = Array.prototype.slice.call(document.querySelectorAll('[data-autoresearch-completed-task-checkbox]'));
      checkboxes.forEach(function(input) {
        var recordId = input.getAttribute('data-record-id') || '';
        if (!recordId || input.disabled) return;
        input.checked = !!checked;
        if (checked) autoResearchCompletedTaskSelection[recordId] = true;
        else delete autoResearchCompletedTaskSelection[recordId];
      });
      updateAutoResearchCompletedTaskSelectionUi();
    };

    window.deleteSelectedAutoResearchCompletedTasks = async function() {
      if (autoResearchCompletedTaskDeleting) return;
      var selectedIds = getAutoResearchSelectedCompletedTaskIds();
      if (!selectedIds.length) {
        setAutoResearchActionStatus('请先勾选要删除的已完成任务记录。', true);
        return;
      }
      if (!confirm('删除选中的 ' + selectedIds.length + ' 条已完成任务记录？最终报告和论文草稿会保留。')) {
        return;
      }
      autoResearchCompletedTaskDeleting = true;
      updateAutoResearchCompletedTaskSelectionUi();
      setAutoResearchActionStatus('正在删除已完成任务记录...', false);
      try {
        var response = await fetch('/api/autoresearch/completed-task-records/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            recordIds: selectedIds,
            workspaceDirectory: getWorkspaceDirectoryPayload(currentConversationId)
          })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '删除失败');
        selectedIds.forEach(function(id) { delete autoResearchCompletedTaskSelection[id]; });
        autoResearchData = data.state;
        renderAutoResearchMode(data.state);
        setAutoResearchActionStatus('已删除 ' + (data.deletedCount || 0) + ' 条已完成任务记录。', false);
      } catch (e) {
        setAutoResearchActionStatus('删除已完成任务记录失败：' + e.message, true);
        alert('删除已完成任务记录失败：' + e.message);
      } finally {
        autoResearchCompletedTaskDeleting = false;
        updateAutoResearchCompletedTaskSelectionUi();
      }
    };

    function setAutoResearchButtonsDisabled(disabled) {
      var buttons = document.querySelectorAll('[data-autoresearch-action]');
      buttons.forEach(function(button) {
        var action = button.getAttribute('data-autoresearch-action');
        if (action === 'claims' || action === 'pdf-manager') return;
        button.disabled = !!disabled;
        button.style.opacity = disabled ? '0.65' : '';
        button.style.cursor = disabled ? 'wait' : 'pointer';
      });
    }

    window.runFullAutoResearch = async function() {
      var current = autoResearchData && autoResearchData.task ? autoResearchData.task : {};
      var titleInput = document.getElementById('autoResearchTaskTitleInput');
      var topicInput = document.getElementById('autoResearchTopicInput');
      var title = String(titleInput ? titleInput.value : (current.title || 'AutoResearch 自动研究')).trim() || 'AutoResearch 自动研究';
      var topic = String(topicInput ? topicInput.value : (current.topic || '')).trim();
      if (!topic) {
        setAutoResearchActionStatus('请先填写研究主题/目标。', true);
        if (topicInput) topicInput.focus();
        return;
      }
      await runAutoResearchRequest({
        action: 'run_full',
        title: 'AutoResearch 自动运行',
        startMessage: '正在自动运行完整 AutoResearch 流程...',
        doneMessage: 'AutoResearch 完成，最终结果已生成',
        failPrefix: 'AutoResearch 自动运行失败：',
        url: '/api/autoresearch/run',
        body: {
          title: title,
          topic: topic,
          goal: current.goal || '自动完成文献图谱、证据库、假设、实验计划、草稿框架和审稿式自检'
        }
      });
    };

    window.startAutoResearchTask = async function() {
      var current = autoResearchData && autoResearchData.task ? autoResearchData.task : {};
      var titleInput = document.getElementById('autoResearchTaskTitleInput');
      var topicInput = document.getElementById('autoResearchTopicInput');
      var title = String(titleInput ? titleInput.value : (current.title || 'AutoResearch 长期任务')).trim() || 'AutoResearch 长期任务';
      var topic = String(topicInput ? topicInput.value : (current.topic || '')).trim();
      if (!topic) {
        setAutoResearchActionStatus('请先填写研究主题/目标。', true);
        if (topicInput) topicInput.focus();
        return;
      }
      await runAutoResearchRequest({
        action: 'start',
        title: '启动 AutoResearch',
        startMessage: '正在启动 AutoResearch 任务...',
        doneMessage: 'AutoResearch 任务已启动',
        failPrefix: '启动失败：',
        url: '/api/autoresearch/start',
        body: { title: title, topic: topic, goal: current.goal || undefined }
      });
    };

    window.syncAutoResearchPdfWiki = async function() {
      await runAutoResearchRequest({
        action: 'sync_pdf_wiki',
        title: '同步 PDF Wiki 证据',
        startMessage: '正在同步 PDF Wiki 证据库...',
        doneMessage: 'PDF Wiki 证据同步完成',
        failPrefix: '同步 PDF Wiki 证据失败：',
        url: '/api/autoresearch/sync-pdf-wiki'
      });
    };

    window.syncAutoResearchEmbeddingLibrary = async function() {
      await runAutoResearchRequest({
        action: 'sync_embedding_library',
        title: '同步 Embedding 文献库',
        startMessage: '正在同步 embedding 文献库...',
        doneMessage: 'Embedding 文献图谱同步完成',
        failPrefix: '同步 embedding 文献库失败：',
        url: '/api/autoresearch/sync-embedding-library'
      });
    };

    window.evaluateAutoResearch = async function() {
      await runAutoResearchRequest({
        action: 'evaluate',
        title: '审稿式自检',
        startMessage: '正在运行审稿式自检...',
        doneMessage: '审稿式自检完成',
        failPrefix: 'AutoResearch 自检失败：',
        url: '/api/autoresearch/evaluate'
      });
    };

    window.rebuildAutoResearchWiki = async function() {
      await runAutoResearchRequest({
        action: 'research_wiki',
        title: '重建研究 Wiki',
        startMessage: '正在重建研究 Wiki 和证据关系图谱...',
        doneMessage: '研究 Wiki 已重建',
        failPrefix: '研究 Wiki 重建失败：',
        url: '/api/autoresearch/research-wiki/rebuild'
      });
    };

    window.auditAutoResearch = async function() {
      await runAutoResearchRequest({
        action: 'audit',
        title: '引用与论据审计',
        startMessage: '正在运行引用与论据审计...',
        doneMessage: '引用与论据审计完成',
        failPrefix: '引用与论据审计失败：',
        url: '/api/autoresearch/audit'
      });
    };

    window.startAutoResearchAssistedWriting = async function() {
      if (typeof window.closePdfWikiViewer === 'function') {
        window.closePdfWikiViewer();
      }
      if (typeof window.newChat === 'function') {
        window.newChat({ scope: 'auto-research' });
      }
      if (typeof window.activateMainAnalysisWorkflowHandoff === 'function') {
        await window.activateMainAnalysisWorkflowHandoff('autoResearch');
      } else if (typeof window.setMainContextSourceSelected === 'function') {
        window.setMainContextSourceSelected('autoResearch', true);
      }
      window.setTimeout(function() {
        if (typeof restoreMainChatInputInteractivity === 'function') {
          restoreMainChatInputInteractivity();
        }
        if (!userInput) return;
        try {
          userInput.focus({ preventScroll: true });
        } catch (error) {
          userInput.focus();
        }
        if (typeof maybeScrollChatToBottom === 'function') maybeScrollChatToBottom(true);
      }, 0);
    };

    window.writeAutoResearchPaper = async function(reportId) {
      if (!reportId) return;
      var data = await runAutoResearchRequest({
        action: 'write_paper',
        title: '一键写论文',
        startMessage: '正在根据 AutoResearch 结果生成论文草稿...',
        doneMessage: '论文草稿已生成',
        failPrefix: '一键写论文失败：',
        url: '/api/autoresearch/final-reports/' + encodeURIComponent(reportId) + '/write-paper'
      });
      if (data && data.draft && data.draft.id) {
        window.openAutoResearchPaperDraftEditor(data.draft.id);
      }
    };

    window.openAutoResearchFinalReportEditor = async function(reportId) {
      if (!reportId) return;
      try {
        showModal('AutoResearch 报告', '<div style="padding:18px;color:var(--text-secondary);">正在读取报告...</div>', true);
        var response = await fetch('/api/autoresearch/final-reports/' + encodeURIComponent(reportId) + '/markdown?userId=' + encodeURIComponent(currentUserId));
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '读取报告失败');
        var html = '<div style="display:flex;flex-direction:column;gap:10px;">' +
          '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">可直接编辑 Markdown。保存后，下载按钮会优先下载编辑后的版本。</div>' +
          '<textarea id="autoResearchFinalReportMarkdownEditor" style="width:100%;min-height:520px;resize:vertical;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input);color:var(--text-primary);padding:12px;font-size:13px;line-height:1.6;font-family:Consolas, monospace;">' + escapeHtml(data.markdown || '') + '</textarea>' +
          '<div id="autoResearchFinalReportEditStatus" style="min-height:18px;font-size:12px;color:var(--text-secondary);"></div>' +
          '<div class="btns">' +
            '<button class="cancel" onclick="closeModal()">关闭</button>' +
            '<button class="cancel" onclick="downloadAutoResearchFinalReport(\'' + escapeHtml(reportId) + '\')">下载 Markdown</button>' +
            '<button class="ok" onclick="saveAutoResearchFinalReportMarkdown(\'' + escapeHtml(reportId) + '\')">保存编辑</button>' +
          '</div>' +
        '</div>';
        showModal('AutoResearch 报告', html, true);
      } catch (e) {
        showModal('AutoResearch 报告', '<div style="padding:18px;color:var(--danger-color);">读取失败：' + escapeHtml(e.message) + '</div>', true);
      }
    };

    window.saveAutoResearchFinalReportMarkdown = async function(reportId) {
      var editor = document.getElementById('autoResearchFinalReportMarkdownEditor');
      var status = document.getElementById('autoResearchFinalReportEditStatus');
      var markdown = editor ? String(editor.value || '') : '';
      if (!markdown.trim()) {
        if (status) {
          status.textContent = '报告内容不能为空。';
          status.style.color = 'var(--danger-color)';
        }
        return;
      }
      if (status) {
        status.textContent = '正在保存...';
        status.style.color = 'var(--text-secondary)';
      }
      try {
        var response = await fetch('/api/autoresearch/final-reports/' + encodeURIComponent(reportId) + '/markdown', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            markdown: markdown,
            workspaceDirectory: getWorkspaceDirectoryPayload(currentConversationId)
          })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '保存失败');
        autoResearchData = data.state;
        if (status) {
          status.textContent = '已保存。';
          status.style.color = 'var(--accent-color)';
        }
        renderAutoResearchMode(data.state);
      } catch (e) {
        if (status) {
          status.textContent = '保存失败：' + e.message;
          status.style.color = 'var(--danger-color)';
        }
      }
    };

    window.downloadAutoResearchFinalReport = async function(reportId) {
      if (!reportId) return;
      try {
        var response = await fetch('/api/autoresearch/final-reports/' + encodeURIComponent(reportId) + '/download?userId=' + encodeURIComponent(currentUserId));
        if (!response.ok) {
          var errorData = await response.json().catch(function() { return {}; });
          throw new Error(errorData.error || '下载失败');
        }
        var blob = await response.blob();
        var disposition = response.headers.get('content-disposition') || '';
        var filename = 'AutoResearch-report.md';
        var match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (match && match[1]) {
          filename = decodeURIComponent(match[1]);
        }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        alert('下载 AutoResearch 报告失败：' + e.message);
      }
    };

    window.openAutoResearchPaperDraftEditor = async function(draftId) {
      if (!draftId) return;
      try {
        showModal('AutoResearch 论文草稿', '<div style="padding:18px;color:var(--text-secondary);">正在读取论文草稿...</div>', true);
        var response = await fetch('/api/autoresearch/paper-drafts/' + encodeURIComponent(draftId) + '/markdown?userId=' + encodeURIComponent(currentUserId));
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '读取论文草稿失败');
        var html = '<div style="display:flex;flex-direction:column;gap:10px;">' +
          '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">这是 AutoResearch 生成的论文 Markdown 草稿。可以直接编辑，保存后下载会优先使用编辑版本。</div>' +
          '<textarea id="autoResearchPaperDraftMarkdownEditor" style="width:100%;min-height:580px;resize:vertical;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input);color:var(--text-primary);padding:12px;font-size:13px;line-height:1.6;font-family:Consolas, monospace;">' + escapeHtml(data.markdown || '') + '</textarea>' +
          '<div id="autoResearchPaperDraftEditStatus" style="min-height:18px;font-size:12px;color:var(--text-secondary);"></div>' +
          '<div class="btns">' +
            '<button class="cancel" onclick="closeModal()">关闭</button>' +
            '<button class="cancel" onclick="downloadAutoResearchPaperDraft(\'' + escapeHtml(draftId) + '\')">下载论文</button>' +
            '<button class="ok" onclick="saveAutoResearchPaperDraftMarkdown(\'' + escapeHtml(draftId) + '\')">保存编辑</button>' +
          '</div>' +
        '</div>';
        showModal('AutoResearch 论文草稿', html, true);
      } catch (e) {
        showModal('AutoResearch 论文草稿', '<div style="padding:18px;color:var(--danger-color);">读取失败：' + escapeHtml(e.message) + '</div>', true);
      }
    };

    window.saveAutoResearchPaperDraftMarkdown = async function(draftId) {
      var editor = document.getElementById('autoResearchPaperDraftMarkdownEditor');
      var status = document.getElementById('autoResearchPaperDraftEditStatus');
      var markdown = editor ? String(editor.value || '') : '';
      if (!markdown.trim()) {
        if (status) {
          status.textContent = '论文草稿内容不能为空。';
          status.style.color = 'var(--danger-color)';
        }
        return;
      }
      if (status) {
        status.textContent = '正在保存...';
        status.style.color = 'var(--text-secondary)';
      }
      try {
        var response = await fetch('/api/autoresearch/paper-drafts/' + encodeURIComponent(draftId) + '/markdown', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            markdown: markdown,
            workspaceDirectory: getWorkspaceDirectoryPayload(currentConversationId)
          })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '保存失败');
        autoResearchData = data.state;
        if (status) {
          status.textContent = '已保存。';
          status.style.color = 'var(--accent-color)';
        }
        renderAutoResearchMode(data.state);
      } catch (e) {
        if (status) {
          status.textContent = '保存失败：' + e.message;
          status.style.color = 'var(--danger-color)';
        }
      }
    };

    window.downloadAutoResearchPaperDraft = async function(draftId) {
      if (!draftId) return;
      try {
        var response = await fetch('/api/autoresearch/paper-drafts/' + encodeURIComponent(draftId) + '/download?userId=' + encodeURIComponent(currentUserId));
        if (!response.ok) {
          var errorData = await response.json().catch(function() { return {}; });
          throw new Error(errorData.error || '下载失败');
        }
        var blob = await response.blob();
        var disposition = response.headers.get('content-disposition') || '';
        var filename = 'AutoResearch-paper-draft.md';
        var match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (match && match[1]) {
          filename = decodeURIComponent(match[1]);
        }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        alert('下载 AutoResearch 论文草稿失败：' + e.message);
      }
    };

    window.updateAutoResearchStageStatus = async function(stageId, status) {
      try {
        var response = await fetch('/api/autoresearch/stages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            stageId: stageId,
            status: status,
            workspaceDirectory: getWorkspaceDirectoryPayload(currentConversationId)
          })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '更新失败');
        renderAutoResearchMode(data.state);
      } catch (e) {
        alert('阶段更新失败：' + e.message);
      }
    };

    window.addAutoResearchMemory = async function() {
      var input = document.getElementById('autoResearchMemoryInput');
      var kind = document.getElementById('autoResearchMemoryKind');
      var content = input ? String(input.value || '').trim() : '';
      if (!content) return;
      try {
        var response = await fetch('/api/autoresearch/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            kind: kind ? kind.value : 'finding',
            content: content,
            source: 'manual',
            workspaceDirectory: getWorkspaceDirectoryPayload(currentConversationId)
          })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '添加失败');
        renderAutoResearchMode(data.state);
      } catch (e) {
        alert('添加项目记忆失败：' + e.message);
      }
    };

    function formatAutoResearchDate(value) {
      if (!value) return '未知时间';
      var date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString();
    }

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('auto-research', { source: '/app/auto-research.js' });
}
