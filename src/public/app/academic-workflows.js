    var pdfWikiReaderSidebarClassObserver = null;

    function syncPdfWikiReaderOverlayInset(forcedCollapsed) {
      var viewer = document.getElementById('pdfWikiViewerModal');
      if (!viewer) return;
      var isReader = pdfWikiWorkspaceMode === 'pdf-reader';
      viewer.classList.toggle('pdf-wiki-reader-overlay', isReader);
      if (!isReader) {
        viewer.style.removeProperty('left');
        return;
      }
      var sidebar = document.querySelector('.sidebar');
      var sidebarPanels = sidebar ? sidebar.querySelector('.sidebar-panels') : null;
      var sidebarStyle = sidebar ? window.getComputedStyle(sidebar) : null;
      var sidebarPanelsStyle = sidebarPanels ? window.getComputedStyle(sidebarPanels) : null;
      var sidebarContentVisible = !!(
        sidebar
        && sidebarPanels
        && sidebarStyle
        && sidebarPanelsStyle
        && sidebar.getBoundingClientRect().width > 1
        && sidebarStyle.display !== 'none'
        && sidebarStyle.visibility !== 'hidden'
        && Number.parseFloat(sidebarStyle.opacity || '1') > 0.05
        && sidebarPanelsStyle.display !== 'none'
        && sidebarPanelsStyle.visibility !== 'hidden'
        && Number.parseFloat(sidebarPanelsStyle.opacity || '1') > 0.05
      );
      var sidebarCollapsed = typeof forcedCollapsed === 'boolean'
        ? forcedCollapsed
        : !!(
            !sidebar
            || sidebar.classList.contains('collapsed')
            || document.body.classList.contains('left-sidebar-collapsed')
            || !sidebarContentVisible
          );
      if (typeof syncGlobalLeftSidebarInset === 'function') {
        syncGlobalLeftSidebarInset(sidebarCollapsed);
      }
      viewer.style.setProperty(
        'left',
        'var(--active-left-sidebar-width)',
        'important'
      );
    }

    function observePdfWikiReaderSidebarClass() {
      var sidebar = document.querySelector('.sidebar');
      if (!sidebar || typeof MutationObserver !== 'function') return;
      if (pdfWikiReaderSidebarClassObserver) {
        pdfWikiReaderSidebarClassObserver.disconnect();
      }
      pdfWikiReaderSidebarClassObserver = new MutationObserver(function() {
        syncPdfWikiReaderOverlayInset();
      });
      pdfWikiReaderSidebarClassObserver.observe(sidebar, {
        attributes: true,
        attributeFilter: ['class']
      });
    }

    function setPdfWikiWorkspaceMode(mode) {
      pdfWikiWorkspaceMode = mode || 'claims';
      if (pdfWikiWorkspaceMode !== 'claims') cleanupPdfWikiNetworkGraph();
      syncPdfWikiReaderOverlayInset();
      var subtitle = document.getElementById('pdfWikiViewerSubtitle');
      if (subtitle) subtitle.style.display = pdfWikiWorkspaceMode === 'pdf-manager' ? 'none' : '';
      if (pdfWikiWorkspaceMode !== 'meta' && typeof setPdfWikiViewerContextActions === 'function') {
        setPdfWikiViewerContextActions('');
      }
    }

    function updateAcademicWorkflowOverviewReturn(options) {
      options = options || {};
      if (options.fromOverview) {
        academicWorkflowOpenedFromOverview = true;
      } else if (!options.preserveOverviewReturn) {
        academicWorkflowOpenedFromOverview = false;
      }
    }
    window.updateAcademicWorkflowOverviewReturn = updateAcademicWorkflowOverviewReturn;

    function renderOverviewReturnAction() {
      if (!academicWorkflowOpenedFromOverview) return '';
      return '<button type="button" onclick="returnToOverviewPage()" style="height:30px;padding:0 9px;border:1px solid var(--accent-color);border-radius:6px;background:transparent;color:var(--accent-color);cursor:pointer;font-size:12px;white-space:nowrap;">返回 Overview</button>';
    }

    function isThesisWritingProfile() {
      return getProjectWritingProfile().id === 'thesis-writing';
    }

    function getAcademicWorkflowTopItems() {
      if (isThesisWritingProfile()) {
        return [
          { key: 'thesis-dashboard', label: '大论文工作台' },
          { key: 'thesis-framework', label: '章节框架' },
          { key: 'thesis-literature', label: '综述资料' },
          { key: 'thesis-draft', label: '一键写大论文' },
          { key: 'thesis-data', label: '图表数据' },
          { key: 'research-enhancements', label: '科研增强' },
          { key: 'thesis-final', label: '定稿检查' }
        ];
      }
      return [
        { key: 'auto-research', label: 'Auto Research' },
        { key: 'paper-writing', label: '一键写论文' },
        { key: 'bibliometrics', label: '文献计量分析' },
        { key: 'pdf-manager', label: 'PDF管理' },
        { key: 'meta-analysis', label: 'Meta分析' },
        { key: 'research-enhancements', label: '科研增强' }
      ];
    }

    function normalizeAcademicWorkflowActiveKey(activeKey) {
      if (!isThesisWritingProfile()) return activeKey;
      var map = {
        'paper-writing': 'thesis-draft',
        'auto-research': 'thesis-literature',
        'bibliometrics': 'thesis-literature',
        'pdf-manager': 'thesis-literature',
        'meta-analysis': 'thesis-data'
      };
      return map[activeKey] || activeKey;
    }

    window.returnToOverviewPage = function() {
      academicWorkflowOpenedFromOverview = false;
      if (typeof window.closeBibliometricsDialog === 'function') window.closeBibliometricsDialog();
      if (typeof closeModal === 'function') closeModal();
      if (typeof window.showOverviewPage === 'function') window.showOverviewPage();
    };

    function renderAcademicWorkflowTopActions(activeKey) {
      var items = getAcademicWorkflowTopItems();
      var normalizedActiveKey = normalizeAcademicWorkflowActiveKey(activeKey);
      return '<div class="academic-workflow-actions" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;">' +
        renderOverviewReturnAction() +
        items.map(function(item) {
          var active = item.key === normalizedActiveKey;
          return '<button type="button" ' +
            (active ? 'disabled ' : '') +
            'onclick="openAcademicWorkflowPage(\'' + item.key + '\')" ' +
            'style="height:30px;padding:0 9px;border:1px solid ' + (active ? 'var(--accent-color)' : 'var(--border-color)') + ';border-radius:6px;background:' + (active ? 'var(--accent-color)' : 'var(--bg-secondary)') + ';color:' + (active ? 'white' : 'var(--text-primary)') + ';cursor:' + (active ? 'default' : 'pointer') + ';font-size:12px;white-space:nowrap;opacity:' + (active ? '0.95' : '1') + ';">' + escapeHtml(item.label) + '</button>';
        }).join('') +
      '</div>';
    }
    window.renderAcademicWorkflowTopActions = renderAcademicWorkflowTopActions;

    function setPdfWikiViewerWorkflowActions(activeKey) {
      var target = document.getElementById('pdfWikiViewerWorkflowActions');
      if (!target) return;
      target.innerHTML = renderAcademicWorkflowTopActions(activeKey || '');
    }
    window.setPdfWikiViewerWorkflowActions = setPdfWikiViewerWorkflowActions;

    function setPdfWikiViewerContextActions(html) {
      var target = document.getElementById('pdfWikiViewerContextActions');
      if (!target) return;
      target.innerHTML = html || '';
      target.classList.toggle('pdf-wiki-manager-context-actions', String(html || '').indexOf('pdf-wiki-manager-header-toolbar') !== -1);
      target.style.display = html ? 'flex' : 'none';
    }
    window.setPdfWikiViewerContextActions = setPdfWikiViewerContextActions;

    window.openAcademicWorkflowPage = function(key) {
      if (!key) return;
      try {
        if (key !== 'bibliometrics' && typeof window.closeBibliometricsDialog === 'function') window.closeBibliometricsDialog();
        if (key !== 'pdf-manager' && key !== 'meta-analysis' && key !== 'auto-research' && typeof window.closePdfWikiViewer === 'function') window.closePdfWikiViewer();
        if (key !== 'paper-writing' && typeof closeModal === 'function') closeModal();
      } catch (e) {
        // 页面切换前的清理失败不阻断跳转。
      }
      setTimeout(function() {
        var options = academicWorkflowOpenedFromOverview ? { preserveOverviewReturn: true } : {};
        if (key === 'auto-research' && typeof window.showAutoResearchMode === 'function') window.showAutoResearchMode(options);
        else if (key === 'paper-writing' && typeof window.showReviewWriterDialog === 'function') window.showReviewWriterDialog(options);
        else if (key === 'bibliometrics' && typeof window.showBibliometricsDialog === 'function') window.showBibliometricsDialog(options);
        else if (key === 'pdf-manager' && typeof window.showPdfWikiPdfManager === 'function') window.showPdfWikiPdfManager(options);
        else if (key === 'meta-analysis' && typeof window.showPdfWikiMetaDatabase === 'function') window.showPdfWikiMetaDatabase(options);
        else if (key === 'thesis-dashboard' && typeof window.showThesisWritingWorkspace === 'function') window.showThesisWritingWorkspace(options);
        else if (key === 'thesis-framework' && typeof window.openDiscussionFrameworkPanel === 'function') window.openDiscussionFrameworkPanel();
        else if (key === 'thesis-literature' && typeof window.showThesisLiteratureWorkspace === 'function') window.showThesisLiteratureWorkspace(options);
        else if (key === 'thesis-draft' && typeof window.showReviewWriterDialog === 'function') window.showReviewWriterDialog(options);
        else if (key === 'thesis-data' && typeof window.showThesisDataWorkspace === 'function') window.showThesisDataWorkspace(options);
        else if (key === 'research-enhancements' && typeof window.showResearchEnhancementWorkspace === 'function') window.showResearchEnhancementWorkspace(options);
        else if (key === 'thesis-final' && typeof window.showThesisFinalWorkspace === 'function') window.showThesisFinalWorkspace(options);
      }, 0);
    };

    function renderThesisWorkspaceShell(title, subtitle, activeKey, bodyHtml) {
      return '' +
        '<div style="height:100%;min-height:0;display:flex;flex-direction:column;gap:12px;color:var(--text-primary);">' +
          '<section class="academic-workflow-page-header" style="border:1px solid var(--border-color);border-radius:10px;background:linear-gradient(180deg,rgba(16,163,127,0.09),rgba(16,163,127,0.02));padding:13px 14px;">' +
            '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">' +
              '<div style="min-width:0;">' +
                '<div style="font-size:17px;font-weight:900;line-height:1.3;color:var(--text-primary);">' + escapeHtml(title) + '</div>' +
                '<div style="margin-top:4px;font-size:12px;line-height:1.6;color:var(--text-secondary);">' + escapeHtml(subtitle) + '</div>' +
              '</div>' +
              renderAcademicWorkflowTopActions(activeKey) +
            '</div>' +
          '</section>' +
          '<section style="min-height:0;flex:1;overflow:auto;">' + bodyHtml + '</section>' +
        '</div>';
    }

    function renderThesisActionButton(action, label, primary) {
      return '<button type="button" onclick="openThesisWorkspaceAction(\'' + action + '\')" style="height:30px;padding:0 10px;border:1px solid ' + (primary ? 'var(--accent-color)' : 'var(--border-color)') + ';border-radius:7px;background:' + (primary ? 'var(--accent-color)' : 'var(--bg-secondary)') + ';color:' + (primary ? 'white' : 'var(--text-primary)') + ';cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap;">' + escapeHtml(label) + '</button>';
    }

    function renderThesisStageCard(stage, index) {
      var actions = Array.isArray(stage.actions) ? stage.actions : [];
      var children = Array.isArray(stage.children) ? stage.children : [];
      return '<div style="border:1px solid var(--border-color);border-radius:10px;background:var(--bg-primary);padding:13px;display:flex;flex-direction:column;gap:10px;min-width:0;">' +
        '<div style="display:flex;align-items:flex-start;gap:10px;">' +
          '<div style="width:28px;height:28px;border-radius:8px;border:1px solid rgba(16,163,127,0.35);background:rgba(16,163,127,0.09);color:var(--accent-color);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;flex:0 0 auto;">' + (index + 1) + '</div>' +
          '<div style="min-width:0;">' +
            '<div style="font-size:14px;font-weight:850;color:var(--text-primary);line-height:1.35;">' + escapeHtml(stage.title || '') + '</div>' +
            '<div style="margin-top:4px;font-size:12px;line-height:1.65;color:var(--text-secondary);">' + escapeHtml(stage.desc || '') + '</div>' +
          '</div>' +
        '</div>' +
        (children.length ? '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;">' + children.map(function(item) {
          return '<div style="padding:8px 9px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);font-size:11px;line-height:1.55;color:var(--text-secondary);">' +
            '<strong style="display:block;color:var(--text-primary);font-size:12px;margin-bottom:2px;">' + escapeHtml(item.title || '') + '</strong>' +
            escapeHtml(item.desc || '') +
          '</div>';
        }).join('') + '</div>' : '') +
        '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">' +
          actions.map(function(item) { return renderThesisActionButton(item.action, item.label, item.primary); }).join('') +
        '</div>' +
      '</div>';
    }

    function getThesisMainStages() {
      return [
        {
          title: '确定大论文总主线',
          desc: '先把题目、科学问题、研究目标、技术路线和章节关系固定下来，避免后面变成多篇小论文拼接。',
          children: [
            { title: '总研究问题', desc: '明确整篇论文要回答什么问题，以及每章分别承担什么任务。' },
            { title: '章节链条', desc: '绪论提出问题，综述定位空白，方法支撑结果，讨论回扣机制。' }
          ],
          actions: [
            { action: 'framework', label: '打开章节框架', primary: true },
            { action: 'overview', label: '查看全局状态' }
          ]
        },
        {
          title: '文献综述与研究空白',
          desc: '把 Auto Research、Embedding 文献库和 Wiki论点库作为综述材料来源，形成研究进展、争议、不足和本研究切入点。',
          children: [
            { title: '综述证据', desc: '检索文献、句子级论点、证据关系和可引用来源。' },
            { title: '研究空白', desc: '从已有研究的不足和争议中反推本论文目标。' }
          ],
          actions: [
            { action: 'thesis-literature', label: '进入综述资料页', primary: true },
            { action: 'auto-research', label: 'Auto Research' },
            { action: 'pdf-wiki', label: 'PDF论点库' }
          ]
        },
        {
          title: '方法、结果与图表数据',
          desc: '把实验资料、图表、表格和统计结果写入长期记忆，并按章节归入框架，后续写结果和讨论时直接调用。',
          children: [
            { title: '方法对应结果', desc: '每个结果图表应能追溯到实验设计、指标测定和统计方法。' },
            { title: '图表对应章节', desc: 'Figure 1、Figure 2 等图件按章节管理，避免结果和讨论脱节。' }
          ],
          actions: [
            { action: 'thesis-data', label: '进入图表数据页', primary: true },
            { action: 'upload-experiment', label: '上传大论文资料' },
            { action: 'data-summary', label: '数据详细总结' }
          ]
        },
        {
          title: '分章写作与整稿生成',
          desc: '大论文建议先用章节框架和讨论式写作逐章推进，再用一键写大论文生成提纲、阶段性草稿或整合稿。',
          children: [
            { title: '逐章推进', desc: '绪论、综述、方法、结果、讨论和结论分别写作、检查和合并。' },
            { title: '整稿一致性', desc: '检查术语、假设、图表编号、引用格式和章节承接。' }
          ],
          actions: [
            { action: 'one-click', label: '一键写大论文', primary: true },
            { action: 'draft', label: '查看大论文草稿' },
            { action: 'thesis-final', label: '定稿检查' }
          ]
        }
      ];
    }

    function showThesisWritingWorkspace(options) {
      updateAcademicWorkflowOverviewReturn(options);
      var body = '' +
        '<div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(320px,0.9fr);gap:12px;align-items:start;">' +
          '<div style="display:flex;flex-direction:column;gap:10px;">' +
            getThesisMainStages().map(renderThesisStageCard).join('') +
          '</div>' +
          '<aside style="border:1px solid var(--border-color);border-radius:10px;background:var(--bg-primary);padding:13px;position:sticky;top:0;">' +
            '<div style="font-size:14px;font-weight:900;color:var(--text-primary);margin-bottom:8px;">大论文写作逻辑</div>' +
            '<div style="font-size:12px;line-height:1.8;color:var(--text-secondary);">' +
              '1. 绪论负责提出总问题和研究目标。<br>' +
              '2. 文献综述负责证明问题值得做，并定位空白。<br>' +
              '3. 材料与方法负责说明如何回答问题。<br>' +
              '4. 结果章节只陈述数据和统计发现。<br>' +
              '5. 讨论章节解释机制、比较文献和边界条件。<br>' +
              '6. 结论与展望回收目标，避免超出证据。' +
            '</div>' +
            '<div style="height:1px;background:var(--border-color);margin:12px 0;"></div>' +
            '<div style="font-size:12px;font-weight:800;color:var(--text-primary);margin-bottom:7px;">快速动作</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:7px;">' +
              renderThesisActionButton('framework', '章节框架', true) +
              renderThesisActionButton('experiment-summary', '资料总结') +
              renderThesisActionButton('data-summary', '数据总结') +
              renderThesisActionButton('memory', '长期记忆') +
            '</div>' +
          '</aside>' +
        '</div>';
      showModal('大论文工作台', renderThesisWorkspaceShell('大论文工作台', '按“总问题-综述空白-方法结果-讨论结论”的长链条组织材料、章节和工具。', 'thesis-dashboard', body), true, true);
    }
    window.showThesisWritingWorkspace = showThesisWritingWorkspace;

    function showThesisLiteratureWorkspace(options) {
      updateAcademicWorkflowOverviewReturn(options);
      var stages = [
        {
          title: '自动研究与综述框架',
          desc: '先用 Auto Research 建立研究地图、研究空白、证据对象和论文蓝图，再把可用内容放入文献综述章节。',
          actions: [
            { action: 'auto-research', label: 'Auto Research', primary: true },
            { action: 'framework', label: '放入章节框架' }
          ]
        },
        {
          title: '本地文献库与语义检索',
          desc: 'Embedding 文献库用于跨中英文文献做语义相似度检索，适合找研究进展、机制解释和同类实验。',
          actions: [
            { action: 'embedding', label: 'Embedding文献库', primary: true },
            { action: 'sentence-claim', label: '句子论点检索' }
          ]
        },
        {
          title: 'Wiki论点库',
          desc: 'PDF Wiki 用句子级证据支撑综述、讨论和引用核查；需要溯源时优先从这里找具体句子。',
          actions: [
            { action: 'pdf-wiki', label: '打开论点库', primary: true },
            { action: 'pdf-manager', label: 'PDF管理' }
          ]
        },
        {
          title: '文献计量与综述写作',
          desc: '文献计量适合用于研究领域演化、热点主题和知识结构，不替代句子级证据，但可以支撑综述的宏观背景。',
          actions: [
            { action: 'bibliometrics', label: '文献计量分析', primary: true },
            { action: 'one-click', label: '生成综述草稿' }
          ]
        }
      ];
      var body = '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">' + stages.map(renderThesisStageCard).join('') + '</div>';
      showModal('大论文综述资料', renderThesisWorkspaceShell('大论文综述资料', '把文献检索、语义匹配、PDF论点库和文献计量组织成“研究进展-争议-空白-切入点”。', 'thesis-literature', body), true, true);
    }
    window.showThesisLiteratureWorkspace = showThesisLiteratureWorkspace;

    function showThesisDataWorkspace(options) {
      updateAcademicWorkflowOverviewReturn(options);
      var stages = [
        {
          title: '实验资料和图件入库',
          desc: '上传实验设计、图片、表格、PDF或Word材料，分析结果会进入长期记忆和章节框架上下文。',
          actions: [
            { action: 'upload-experiment', label: '上传图表数据', primary: true },
            { action: 'experiment-summary', label: '大论文资料总结' }
          ]
        },
        {
          title: '结果数据整理',
          desc: '查看数据详细总结，确认 Figure 1、Figure 2、表格和关键数值是否按章节组织。',
          actions: [
            { action: 'data-summary', label: '数据详细总结', primary: true },
            { action: 'data-analysis', label: '数据分析' }
          ]
        },
        {
          title: '统计分析和 R 作图',
          desc: '把统计结果和 R 图件作为结果章节的主证据；Meta分析只在大论文包含 Meta 研究时使用。',
          actions: [
            { action: 'r-plot', label: 'R语言作图', primary: true },
            { action: 'meta-analysis', label: 'Meta分析' }
          ]
        },
        {
          title: '技术路线和图示',
          desc: '根据实验流程、分析流程或论文逻辑制作技术路线图，供绪论、方法或答辩使用。',
          actions: [
            { action: 'flowchart', label: '流程图制作', primary: true },
            { action: 'framework', label: '写回章节框架' }
          ]
        }
      ];
      var body = '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">' + stages.map(renderThesisStageCard).join('') + '</div>';
      showModal('大论文图表数据', renderThesisWorkspaceShell('大论文图表数据', '把实验资料、图表数据、统计分析和技术路线统一进入大论文结果与方法章节。', 'thesis-data', body), true, true);
    }
    window.showThesisDataWorkspace = showThesisDataWorkspace;

    function showThesisFinalWorkspace(options) {
      updateAcademicWorkflowOverviewReturn(options);
      var stages = [
        {
          title: '章节一致性检查',
          desc: '检查绪论提出的问题是否被方法、结果、讨论和结论逐级回应。',
          actions: [
            { action: 'framework', label: '检查章节框架', primary: true },
            { action: 'draft', label: '查看草稿' }
          ]
        },
        {
          title: '证据和引用检查',
          desc: '关键论断应能追溯到文献库、PDF论点库、Auto Research证据或用户数据。',
          actions: [
            { action: 'sentence-claim', label: '论点检索', primary: true },
            { action: 'pdf-wiki', label: 'PDF论点库' }
          ]
        },
        {
          title: '格式和参考文献',
          desc: '按学校或学院模板检查摘要、目录、章节层级、图表编号、引用格式和参考文献格式。',
          actions: [
            { action: 'one-click', label: '一键整合草稿', primary: true },
            { action: 'memory', label: '长期记忆' }
          ]
        },
        {
          title: '答辩材料',
          desc: '从论文框架、研究路线、图表结果和关键结论生成答辩 PPT 或流程图。',
          actions: [
            { action: 'ppt', label: 'PPT汇报生成', primary: true },
            { action: 'flowchart', label: '流程图制作' }
          ]
        }
      ];
      var body = '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">' + stages.map(renderThesisStageCard).join('') + '</div>';
      showModal('大论文定稿检查', renderThesisWorkspaceShell('大论文定稿检查', '从章节链条、证据引用、学校格式和答辩材料四个角度收口。', 'thesis-final', body), true, true);
    }
    window.showThesisFinalWorkspace = showThesisFinalWorkspace;

    function openThesisWorkspaceAction(action) {
      if (!action) return;
      if (typeof closeModal === 'function') closeModal();
      setTimeout(function() {
        if (action === 'thesis-literature') window.showThesisLiteratureWorkspace && window.showThesisLiteratureWorkspace({ preserveOverviewReturn: true });
        else if (action === 'thesis-data') window.showThesisDataWorkspace && window.showThesisDataWorkspace({ preserveOverviewReturn: true });
        else if (action === 'thesis-final') window.showThesisFinalWorkspace && window.showThesisFinalWorkspace({ preserveOverviewReturn: true });
        else if (action === 'framework') window.openDiscussionFrameworkPanel && window.openDiscussionFrameworkPanel();
        else if (action === 'overview') window.showOverviewPage && window.showOverviewPage();
        else if (action === 'auto-research') window.showAutoResearchMode && window.showAutoResearchMode({ preserveOverviewReturn: true });
        else if (action === 'one-click') window.showReviewWriterDialog && window.showReviewWriterDialog({ preserveOverviewReturn: true });
        else if (action === 'draft') window.showDraftDialog && window.showDraftDialog();
        else if (action === 'experiment-summary') window.showExperimentSummary && window.showExperimentSummary();
        else if (action === 'data-summary') window.showDataSummary && window.showDataSummary();
        else if (action === 'memory') window.showClearMemoryDialog && window.showClearMemoryDialog();
        else if (action === 'embedding') window.showEmbeddingLibrary && window.showEmbeddingLibrary();
        else if (action === 'pdf-wiki') window.showPdfWikiViewer && window.showPdfWikiViewer({ preserveOverviewReturn: true });
        else if (action === 'pdf-manager') window.showPdfWikiPdfManager && window.showPdfWikiPdfManager({ preserveOverviewReturn: true });
        else if (action === 'sentence-claim') window.showSentenceClaimSearchDialog && window.showSentenceClaimSearchDialog();
        else if (action === 'bibliometrics') window.showBibliometricsDialog && window.showBibliometricsDialog({ preserveOverviewReturn: true });
        else if (action === 'upload-experiment') window.triggerExperimentUpload && window.triggerExperimentUpload();
        else if (action === 'data-analysis') window.showDataAnalysisDialog && window.showDataAnalysisDialog();
        else if (action === 'r-plot') window.showRPlotDialog && window.showRPlotDialog();
        else if (action === 'meta-analysis') window.showPdfWikiMetaDatabase && window.showPdfWikiMetaDatabase({ preserveOverviewReturn: true });
        else if (action === 'flowchart') window.showFlowchartMakerDialog && window.showFlowchartMakerDialog();
        else if (action === 'ppt') window.showPptMasterDialog && window.showPptMasterDialog();
      }, 0);
    }
    window.openThesisWorkspaceAction = openThesisWorkspaceAction;

    var researchEnhancementActivePanel = 'ledger';

    function getResearchEnhancementItems() {
      return [
        {
          id: 'ledger',
          title: '科研证据账本',
          desc: '追踪正文论断、PDF Wiki 证据、引用、图表数据、R 代码和生成产物。',
          body: '' +
            '<div style="font-size:13px;line-height:1.7;color:var(--text-secondary);margin-bottom:12px;">AI 会在主要章节形成后提示是否生成证据账本；确认后通过 MCP 执行，结果自动显示在这里。</div>' +
            '<div id="researchEnhancementLedgerStatus" style="min-height:70px;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);font-size:12px;line-height:1.7;color:var(--text-secondary);">正在读取最新结果...</div>'
        },
        {
          id: 'reviewer',
          title: '审稿人 Agent',
          desc: '按证据、引用、数据、代码和写作风格检查当前科研 session。',
          body: '' +
            '<div style="font-size:13px;line-height:1.7;color:var(--text-secondary);margin-bottom:12px;">AI 会根据写作进度提示是否审查引用、图表、代码和来源记录；确认后通过 MCP 执行。</div>' +
            '<div id="researchEnhancementReviewerStatus" style="min-height:70px;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);font-size:12px;line-height:1.7;color:var(--text-secondary);">正在读取最新结果...</div>'
        },
        {
          id: 'bundle',
          title: '可复现实验包',
          desc: '导出当前科研 session 的产物、provenance、审稿报告和复现索引。',
          body: '' +
            '<div style="font-size:13px;line-height:1.7;color:var(--text-secondary);margin-bottom:12px;">数据分析、图表和代码产物基本完成后，AI 会提示是否通过 MCP 导出复现包。</div>' +
            '<div id="researchEnhancementBundleStatus" style="min-height:70px;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);font-size:12px;line-height:1.7;color:var(--text-secondary);">正在读取最新结果...</div>'
        },
        {
          id: 'obsidian',
          title: '内置 Obsidian 知识库',
          desc: '把 PDF Wiki 句子级论点整理成软件内置 vault，并支持后续检索。',
          body: '' +
            '<div style="font-size:13px;line-height:1.7;color:var(--text-secondary);margin-bottom:12px;">可直接同步或检索 PDF Wiki 的 Obsidian 兼容 Vault，也可由 AI 经用户确认调用同一工具。这里只生成 Markdown Vault，不会安装或启动 Obsidian 客户端。</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
              '<button id="researchEnhancementObsidianSyncBtn" class="ok" type="button" onclick="deployResearchObsidianVault()">同步内置 Vault</button>' +
              '<button id="researchEnhancementObsidianSearchBtn" class="cancel" type="button" onclick="searchResearchObsidianVault()">检索 Vault</button>' +
            '</div>' +
            '<div id="researchEnhancementObsidianStatus" style="min-height:70px;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);font-size:12px;line-height:1.7;color:var(--text-secondary);">正在读取最新结果...</div>'
        },
        {
          id: 'submission',
          title: '期刊投稿准备',
          desc: '生成 Cover Letter、Highlights、审稿人建议、投稿检查清单和期刊要求摘录。',
          body: '' +
            '<div style="font-size:13px;line-height:1.7;color:var(--text-secondary);margin-bottom:12px;">进入投稿阶段后，AI 会收集目标期刊、标题、摘要和期刊要求，并在用户确认后调用 MCP 生成投稿准备包。</div>' +
            '<div id="researchEnhancementSubmissionStatus" style="min-height:70px;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);font-size:12px;line-height:1.7;color:var(--text-secondary);">正在读取最新结果...</div>'
        }
      ];
    }

    function researchEnhancementBubbleHtml(item) {
      var active = item.id === researchEnhancementActivePanel;
      return '<button type="button" data-research-enhancement-bubble="' + escapeHtml(item.id) + '" ' +
        'onmouseenter="activateResearchEnhancementPanel(\'' + escapeHtml(item.id) + '\')" ' +
        'onfocus="activateResearchEnhancementPanel(\'' + escapeHtml(item.id) + '\')" ' +
        'onclick="activateResearchEnhancementPanel(\'' + escapeHtml(item.id) + '\')" ' +
        'style="text-align:left;padding:12px 13px;border:1px solid ' + (active ? 'var(--accent-color)' : 'var(--border-color)') + ';border-radius:999px;background:' + (active ? 'rgba(16,163,127,0.13)' : 'var(--bg-secondary)') + ';color:var(--text-primary);cursor:pointer;min-width:160px;max-width:230px;">' +
          '<div style="font-size:13px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(item.title) + '</div>' +
          '<div style="margin-top:3px;font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(item.desc) + '</div>' +
        '</button>';
    }

    function researchEnhancementPanelHtml(item) {
      var active = item.id === researchEnhancementActivePanel;
      return '<section data-research-enhancement-panel="' + escapeHtml(item.id) + '" style="display:' + (active ? 'block' : 'none') + ';border:1px solid var(--border-color);border-radius:10px;background:var(--bg-primary);padding:14px;">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px;">' +
          '<div>' +
            '<div style="font-size:16px;font-weight:900;color:var(--text-primary);">' + escapeHtml(item.title) + '</div>' +
            '<div style="margin-top:4px;font-size:12px;line-height:1.6;color:var(--text-secondary);">' + escapeHtml(item.desc) + '</div>' +
          '</div>' +
        '</div>' +
        item.body +
      '</section>';
    }

    function showResearchEnhancementWorkspace(options) {
      updateAcademicWorkflowOverviewReturn(options);
      var items = getResearchEnhancementItems();
      if (!items.some(function(item) { return item.id === researchEnhancementActivePanel; })) {
        researchEnhancementActivePanel = 'ledger';
      }
      var body = '' +
        '<div style="height:100%;min-height:0;display:flex;flex-direction:column;gap:12px;color:var(--text-primary);">' +
          '<section class="academic-workflow-page-header" style="border:1px solid var(--border-color);border-radius:10px;background:linear-gradient(180deg,rgba(16,163,127,0.09),rgba(16,163,127,0.02));padding:13px 14px;">' +
            '<div style="min-width:0;">' +
              '<div style="font-size:17px;font-weight:900;line-height:1.3;color:var(--text-primary);">科研增强工具</div>' +
              '<div style="margin-top:4px;font-size:12px;line-height:1.6;color:var(--text-secondary);">围绕“可追溯、可审稿、可复现、可投稿”补强当前项目，不替代已有 PDF Wiki、Meta、R 作图和自动写作功能。</div>' +
            '</div>' +
          '</section>' +
          '<section style="display:flex;gap:9px;flex-wrap:wrap;">' + items.map(researchEnhancementBubbleHtml).join('') + '</section>' +
          '<section style="min-height:0;flex:1;overflow:auto;">' + items.map(researchEnhancementPanelHtml).join('') + '</section>' +
        '</div>';
      showModal('科研增强工具', body, true, true);
      setTimeout(function() {
        activateResearchEnhancementPanel(researchEnhancementActivePanel);
        void loadResearchEnhancementResults();
      }, 0);
    }
    window.showResearchEnhancementWorkspace = showResearchEnhancementWorkspace;

    function activateResearchEnhancementPanel(panelId) {
      researchEnhancementActivePanel = panelId || 'ledger';
      document.querySelectorAll('[data-research-enhancement-bubble]').forEach(function(button) {
        var active = button.getAttribute('data-research-enhancement-bubble') === researchEnhancementActivePanel;
        button.style.borderColor = active ? 'var(--accent-color)' : 'var(--border-color)';
        button.style.background = active ? 'rgba(16,163,127,0.13)' : 'var(--bg-secondary)';
      });
      document.querySelectorAll('[data-research-enhancement-panel]').forEach(function(panel) {
        panel.style.display = panel.getAttribute('data-research-enhancement-panel') === researchEnhancementActivePanel ? 'block' : 'none';
      });
    }
    window.activateResearchEnhancementPanel = activateResearchEnhancementPanel;

    function setResearchEnhancementStatus(targetId, html, error) {
      var target = document.getElementById(targetId);
      if (!target) return;
      target.style.color = error ? 'var(--danger-color)' : 'var(--text-secondary)';
      target.innerHTML = html;
    }

    async function researchEnhancementJson(url, options) {
      var response = await fetch(url, options || {});
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok || data.success === false) {
        throw new Error(data.error || data.message || ('请求失败：' + response.status));
      }
      return data;
    }

    async function ensureResearchEnhancementSession() {
      var userId = currentUserId || 'web-user';
      var current = await researchEnhancementJson('/api/research-session/current?userId=' + encodeURIComponent(userId));
      if (current.session) return current.session;
      var created = await researchEnhancementJson('/api/research-session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          title: '科研增强工具会话',
          goal: '记录证据账本、审稿人 Agent、可复现实验包、内置 Obsidian 和投稿准备产物'
        })
      });
      return created.session;
    }

    function researchEnhancementFileActions(filePath) {
      if (!filePath) return '';
      return '<div style="margin-top:9px;display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button type="button" class="output-attachment-open" data-file-path="' + escapeHtml(filePath) + '" onclick="openOutputAttachmentFile(this)">打开文件</button>' +
        '<button type="button" class="output-attachment-open" data-file-path="' + escapeHtml(filePath) + '" onclick="openOutputAttachmentFolder(this)">打开所在文件夹</button>' +
      '</div>';
    }

    function renderResearchLedgerSummary(data) {
      var ledger = data.ledger || {};
      return '<div style="font-weight:800;color:var(--text-primary);margin-bottom:5px;">证据账本已生成</div>' +
        '<div>Session：' + escapeHtml(ledger.sessionCount || 0) +
        ' · Provenance：' + escapeHtml(ledger.recordCount || 0) +
        ' · Artifact：' + escapeHtml(ledger.artifactCount || 0) +
        ' · Reviewer 报告：' + escapeHtml(ledger.reviewerReportCount || 0) + '</div>' +
        '<div>正文/引用记录：' + escapeHtml((ledger.claims || []).length) +
        ' · 图表/数据记录：' + escapeHtml((ledger.figuresAndData || []).length) +
        ' · 审稿问题：' + escapeHtml((ledger.reviewerFindings || []).length) + '</div>' +
        (data.filePath ? '<div style="margin-top:6px;word-break:break-all;">' + escapeHtml(data.filePath) + '</div>' : '') +
        researchEnhancementFileActions(data.filePath);
    }

    window.generateResearchEvidenceLedger = async function() {
      setResearchEnhancementStatus('researchEnhancementLedgerStatus', '正在生成证据账本...', false);
      try {
        var userId = currentUserId || 'web-user';
        var data = await researchEnhancementJson('/api/research-session/evidence-ledger?userId=' + encodeURIComponent(userId) + '&write=1');
        var html = renderResearchLedgerSummary(data);
        setResearchEnhancementStatus('researchEnhancementLedgerStatus', html, false);
        appendMessage(html, 'bot', true, true);
      } catch (e) {
        setResearchEnhancementStatus('researchEnhancementLedgerStatus', escapeHtml(e.message || e), true);
      }
    };

    window.loadResearchEvidenceLedgerPreview = async function() {
      setResearchEnhancementStatus('researchEnhancementLedgerStatus', '正在读取账本统计...', false);
      try {
        var userId = currentUserId || 'web-user';
        var data = await researchEnhancementJson('/api/research-session/evidence-ledger?userId=' + encodeURIComponent(userId));
        setResearchEnhancementStatus('researchEnhancementLedgerStatus', renderResearchLedgerSummary(data), false);
      } catch (e) {
        setResearchEnhancementStatus('researchEnhancementLedgerStatus', escapeHtml(e.message || e), true);
      }
    };

    function renderResearchReviewerReport(report) {
      var findings = Array.isArray(report && report.findings) ? report.findings : [];
      var findingHtml = findings.slice(0, 10).map(function(item, index) {
        return '<div style="padding:8px 0;border-top:1px solid var(--border-color);">' +
          '<div style="font-weight:800;color:var(--text-primary);">' + (index + 1) + '. ' + escapeHtml(item.severity || '') + ' · ' + escapeHtml(item.targetType || '') + '</div>' +
          '<div style="margin-top:3px;">' + escapeHtml(item.message || '') + '</div>' +
          (item.recommendation ? '<div style="margin-top:3px;color:var(--text-primary);">建议：' + escapeHtml(item.recommendation) + '</div>' : '') +
        '</div>';
      }).join('');
      return '<div style="font-weight:800;color:var(--text-primary);margin-bottom:5px;">审稿人 Agent 结果：' + escapeHtml(report.status || '') + ' · ' + escapeHtml(report.score || 0) + '/100</div>' +
        '<div>' + escapeHtml(report.summary || '') + '</div>' +
        '<div style="margin-top:5px;">检查记录 ' + escapeHtml(report.checkedRecordCount || 0) + ' 条，产物 ' + escapeHtml(report.checkedArtifactCount || 0) + ' 个，发现问题 ' + escapeHtml(findings.length) + ' 条。</div>' +
        (findingHtml || '<div style="margin-top:8px;color:var(--text-secondary);">没有发现需要处理的问题。</div>');
    }

    function renderResearchAiReview(aiReview, aiWarning) {
      if (aiReview && aiReview.markdown) {
        return '<div style="margin-top:10px;padding:10px;border:1px solid rgba(16,163,127,0.28);border-radius:8px;background:rgba(16,163,127,0.07);">' +
          '<div style="font-weight:800;color:var(--text-primary);margin-bottom:5px;">小牛马增强审稿意见 · ' + escapeHtml(aiReview.model || aiReview.provider || '') + '</div>' +
          '<pre style="white-space:pre-wrap;max-height:360px;overflow:auto;margin:0;color:var(--text-primary);font-size:12px;line-height:1.65;font-family:inherit;">' + escapeHtml(aiReview.markdown || '') + '</pre>' +
        '</div>';
      }
      if (aiWarning) {
        return '<div style="margin-top:10px;padding:8px;border:1px solid rgba(245,158,11,0.35);border-radius:8px;background:rgba(245,158,11,0.10);color:#b45309;">小牛马增强未完成：' + escapeHtml(aiWarning) + '</div>';
      }
      return '';
    }

    function getLatestResearchEnhancementArtifact(session, predicate) {
      var artifacts = Array.isArray(session && session.artifacts) ? session.artifacts.slice() : [];
      return artifacts
        .filter(function(item) { return predicate(item || {}); })
        .sort(function(a, b) {
          return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
        })[0] || null;
    }

    function formatResearchEnhancementDateTime(value) {
      var date = new Date(value || 0);
      return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString('zh-CN');
    }

    function renderResearchEnhancementStoredArtifact(title, artifact, details) {
      if (!artifact) return '';
      var metadata = artifact.metadata || {};
      var time = metadata.generatedAt || metadata.syncedAt || artifact.updatedAt || artifact.createdAt || '';
      return '<div style="font-weight:800;color:var(--text-primary);margin-bottom:5px;">' + escapeHtml(title) + '</div>' +
        (details ? '<div>' + details + '</div>' : '') +
        (time ? '<div style="margin-top:4px;">更新时间：' + escapeHtml(formatResearchEnhancementDateTime(time)) + '</div>' : '') +
        (artifact.filePath ? '<div style="margin-top:6px;word-break:break-all;">' + escapeHtml(artifact.filePath) + '</div>' : '') +
        researchEnhancementFileActions(artifact.filePath);
    }

    async function loadResearchEnhancementResults() {
      var userId = currentUserId || 'web-user';
      var settled = await Promise.allSettled([
        researchEnhancementJson('/api/research-session/current?userId=' + encodeURIComponent(userId)),
        researchEnhancementJson('/api/research-session/evidence-ledger?userId=' + encodeURIComponent(userId)),
        researchEnhancementJson('/api/pdf-wiki/obsidian/status?userId=' + encodeURIComponent(userId))
      ]);
      var currentData = settled[0].status === 'fulfilled' ? settled[0].value : {};
      var ledgerData = settled[1].status === 'fulfilled' ? settled[1].value : {};
      var obsidianData = settled[2].status === 'fulfilled' ? settled[2].value : {};
      var session = currentData.session || null;

      var ledgerArtifact = getLatestResearchEnhancementArtifact(session, function(item) {
        return item.metadata && item.metadata.enhancementType === 'evidence-ledger';
      });
      if (ledgerArtifact) {
        setResearchEnhancementStatus('researchEnhancementLedgerStatus', renderResearchLedgerSummary({
          ledger: ledgerData.ledger || {},
          filePath: ledgerArtifact.filePath || ''
        }), false);
      } else {
        var ledger = ledgerData.ledger || {};
        setResearchEnhancementStatus('researchEnhancementLedgerStatus',
          '<div style="font-weight:800;color:var(--text-primary);margin-bottom:5px;">尚未由 AI 生成证据账本</div>' +
          '<div>当前可追踪：Provenance ' + escapeHtml(ledger.recordCount || 0) + ' 条，Artifact ' + escapeHtml(ledger.artifactCount || 0) + ' 个，Reviewer 报告 ' + escapeHtml(ledger.reviewerReportCount || 0) + ' 份。</div>', false);
      }

      var reports = Array.isArray(session && session.reviewerReports) ? session.reviewerReports.slice() : [];
      reports.sort(function(a, b) { return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(); });
      setResearchEnhancementStatus('researchEnhancementReviewerStatus', reports[0]
        ? renderResearchReviewerReport(reports[0])
        : '<div style="font-weight:800;color:var(--text-primary);">尚未由 AI 运行审稿检查</div>', false);

      var bundleArtifact = getLatestResearchEnhancementArtifact(session, function(item) {
        return item.kind === 'bundle' || (item.metadata && item.metadata.enhancementType === 'reproducibility-bundle');
      });
      setResearchEnhancementStatus('researchEnhancementBundleStatus', bundleArtifact
        ? renderResearchEnhancementStoredArtifact('最新可复现实验包', bundleArtifact,
            'Artifact ' + escapeHtml(bundleArtifact.metadata && bundleArtifact.metadata.artifactCount || 0) +
            ' · Provenance ' + escapeHtml(bundleArtifact.metadata && bundleArtifact.metadata.provenanceCount || 0) +
            ' · Reviewer 报告 ' + escapeHtml(bundleArtifact.metadata && bundleArtifact.metadata.reviewerReportCount || 0))
        : '<div style="font-weight:800;color:var(--text-primary);">尚未由 AI 导出复现包</div>', false);

      if (obsidianData.deployed) {
        var obsidianHtml = '<div style="font-weight:800;color:var(--text-primary);margin-bottom:5px;">内置 Obsidian 知识库已同步</div>' +
          '<div>句子级论点 ' + escapeHtml(obsidianData.sentencePointCount || 0) +
          ' 条，主题 ' + escapeHtml(obsidianData.topicCount || 0) +
          ' 个，PDF ' + escapeHtml(obsidianData.pdfCount || 0) +
          ' 个，Markdown 文件 ' + escapeHtml(obsidianData.fileCount || 0) + ' 个。</div>' +
          (obsidianData.deployedAt ? '<div style="margin-top:4px;">更新时间：' + escapeHtml(formatResearchEnhancementDateTime(obsidianData.deployedAt)) + '</div>' : '') +
          '<div style="margin-top:6px;word-break:break-all;">' + escapeHtml(obsidianData.vaultDir || '') + '</div>' +
          (obsidianData.vaultDir ? '<div style="margin-top:9px;"><button type="button" class="output-attachment-open" data-file-path="' + escapeHtml(obsidianData.vaultDir) + '" onclick="openOutputAttachmentFolder(this)">打开知识库文件夹</button></div>' : '');
        setResearchEnhancementStatus('researchEnhancementObsidianStatus', obsidianHtml, false);
      } else {
        setResearchEnhancementStatus('researchEnhancementObsidianStatus', '<div style="font-weight:800;color:var(--text-primary);">尚未同步内置 Obsidian Vault，可点击上方按钮同步。</div>', false);
      }

      var submissionArtifact = getLatestResearchEnhancementArtifact(session, function(item) {
        return item.metadata && item.metadata.enhancementType === 'submission-prep';
      });
      setResearchEnhancementStatus('researchEnhancementSubmissionStatus', submissionArtifact
        ? renderResearchEnhancementStoredArtifact('最新投稿准备包', submissionArtifact,
            '目标期刊：' + escapeHtml(submissionArtifact.metadata && submissionArtifact.metadata.targetJournal || '待定') +
            ' · 稿件类型：' + escapeHtml(submissionArtifact.metadata && submissionArtifact.metadata.manuscriptType || 'Research Article'))
        : '<div style="font-weight:800;color:var(--text-primary);">尚未由 AI 生成投稿准备包</div>', false);
    }
    window.loadResearchEnhancementResults = loadResearchEnhancementResults;

    window.runResearchReviewerAgent = async function() {
      setResearchEnhancementStatus('researchEnhancementReviewerStatus', '正在运行审稿人 Agent，并调用小牛马做增强审稿...', false);
      try {
        var session = await ensureResearchEnhancementSession();
        var data = await researchEnhancementJson('/api/research-session/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId || 'web-user', sessionId: session.id, useAi: true })
        });
        var html = renderResearchReviewerReport(data.report || {}) + renderResearchAiReview(data.aiReview, data.aiWarning);
        setResearchEnhancementStatus('researchEnhancementReviewerStatus', html, false);
        appendMessage(html, 'bot', true, true);
      } catch (e) {
        setResearchEnhancementStatus('researchEnhancementReviewerStatus', escapeHtml(e.message || e), true);
      }
    };

    window.exportResearchReproducibleBundle = async function() {
      setResearchEnhancementStatus('researchEnhancementBundleStatus', '正在导出可复现实验包...', false);
      try {
        var session = await ensureResearchEnhancementSession();
        var data = await researchEnhancementJson('/api/research-session/bundle/' + encodeURIComponent(session.id) + '?userId=' + encodeURIComponent(currentUserId || 'web-user') + '&write=1');
        var bundle = data.bundle || {};
        var index = Array.isArray(bundle.reproducibilityIndex) ? bundle.reproducibilityIndex : [];
        var html = '<div style="font-weight:800;color:var(--text-primary);margin-bottom:5px;">可复现实验包已导出</div>' +
          '<div>Session：' + escapeHtml(session.title || session.id) + '</div>' +
          '<div>Artifact：' + escapeHtml((bundle.session && bundle.session.artifacts || []).length) +
          ' · Provenance：' + escapeHtml((bundle.session && bundle.session.provenance || []).length) +
          ' · 复现索引：' + escapeHtml(index.length) +
          ' · Reviewer 报告：' + escapeHtml((bundle.reviewerReports || []).length) + '</div>' +
          (data.filePath ? '<div style="margin-top:6px;word-break:break-all;">' + escapeHtml(data.filePath) + '</div>' : '') +
          researchEnhancementFileActions(data.filePath);
        setResearchEnhancementStatus('researchEnhancementBundleStatus', html, false);
        appendMessage(html, 'bot', true, true);
      } catch (e) {
        setResearchEnhancementStatus('researchEnhancementBundleStatus', escapeHtml(e.message || e), true);
      }
    };

    window.deployResearchObsidianVault = async function() {
      var button = document.getElementById('researchEnhancementObsidianSyncBtn');
      var originalText = button ? button.textContent : '';
      if (button) {
        button.disabled = true;
        button.textContent = '同步中...';
      }
      setResearchEnhancementStatus('researchEnhancementObsidianStatus', '正在同步内置 Obsidian Vault...', false);
      try {
        var data = await researchEnhancementJson('/api/pdf-wiki/obsidian/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId || 'web-user' })
        });
        var vaultDir = data.vaultDir || data.exportDir || '';
        var html = '<div style="font-weight:800;color:var(--text-primary);margin-bottom:5px;">内置 Obsidian 知识库已同步</div>' +
          '<div>句子级论点 ' + escapeHtml(data.sentencePointCount || 0) +
          ' 条，主题 ' + escapeHtml(data.topicCount || 0) +
          ' 个，PDF ' + escapeHtml(data.pdfCount || 0) +
          ' 个，Markdown 文件 ' + escapeHtml(data.fileCount || 0) + ' 个。</div>' +
          '<div style="margin-top:6px;word-break:break-all;">' + escapeHtml(vaultDir) + '</div>' +
          researchEnhancementFileActions(vaultDir);
        setResearchEnhancementStatus('researchEnhancementObsidianStatus', html, false);
        appendMessage(html, 'bot', true, true);
      } catch (e) {
        setResearchEnhancementStatus('researchEnhancementObsidianStatus', escapeHtml(e.message || e), true);
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = originalText || '同步内置 Vault';
        }
      }
    };

    window.searchResearchObsidianVault = async function() {
      var keyword = prompt('输入要在内置 Obsidian 知识库中检索的关键词');
      keyword = (keyword || '').trim();
      if (!keyword) return;
      var button = document.getElementById('researchEnhancementObsidianSearchBtn');
      var originalText = button ? button.textContent : '';
      if (button) {
        button.disabled = true;
        button.textContent = '检索中...';
      }
      setResearchEnhancementStatus('researchEnhancementObsidianStatus', '正在检索：' + escapeHtml(keyword), false);
      try {
        var data = await researchEnhancementJson('/api/pdf-wiki/obsidian/search?userId=' + encodeURIComponent(currentUserId || 'web-user') + '&q=' + encodeURIComponent(keyword) + '&limit=30');
        var results = Array.isArray(data.results) ? data.results : [];
        var rows = results.slice(0, 10).map(function(item, index) {
          return '<div style="padding:8px 0;border-top:1px solid var(--border-color);">' +
            '<div style="font-weight:800;color:var(--text-primary);">' + (index + 1) + '. ' + escapeHtml(item.title || item.relativePath || '') + '</div>' +
            '<div style="font-size:11px;word-break:break-all;">' + escapeHtml(item.relativePath || '') + '</div>' +
            '<div style="margin-top:3px;">' + escapeHtml(item.snippet || '') + '</div>' +
          '</div>';
        }).join('');
        var html = '<div style="font-weight:800;color:var(--text-primary);margin-bottom:5px;">Obsidian Vault 检索：' + escapeHtml(keyword) + '</div>' +
          '<div>' + escapeHtml(results.length) + ' 条结果 · ' + escapeHtml(data.vaultDir || '') + '</div>' +
          (rows || '<div style="margin-top:8px;">没有匹配结果。可以先同步内置 Vault 或更换关键词。</div>');
        setResearchEnhancementStatus('researchEnhancementObsidianStatus', html, false);
        appendMessage(html, 'bot', true, true);
      } catch (e) {
        setResearchEnhancementStatus('researchEnhancementObsidianStatus', escapeHtml(e.message || e), true);
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = originalText || '检索 Vault';
        }
      }
    };

    window.generateSubmissionPrepPackage = async function() {
      setResearchEnhancementStatus('researchEnhancementSubmissionStatus', '正在生成投稿准备包...', false);
      try {
        var session = await ensureResearchEnhancementSession();
        var data = await researchEnhancementJson('/api/submission-prep/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId || 'web-user',
            sessionId: session.id,
            useAi: true,
            targetJournal: document.getElementById('submissionPrepJournal')?.value || '',
            manuscriptType: document.getElementById('submissionPrepType')?.value || '',
            manuscriptTitle: document.getElementById('submissionPrepTitle')?.value || '',
            abstractText: document.getElementById('submissionPrepAbstract')?.value || '',
            keywords: document.getElementById('submissionPrepKeywords')?.value || '',
            authorGuidelines: document.getElementById('submissionPrepGuidelines')?.value || '',
            coverLetterRequirements: document.getElementById('submissionPrepCoverReq')?.value || '',
            reviewerFocus: document.getElementById('submissionPrepReviewerFocus')?.value || ''
          })
        });
        var preview = String(data.markdown || '').slice(0, 1800);
        var html = '<div style="font-weight:800;color:var(--text-primary);margin-bottom:5px;">投稿准备包已生成</div>' +
          '<div>' + (data.aiUsed ? ('小牛马已参与生成：' + escapeHtml(data.aiProvider || '小牛马')) : ('本地规则模板生成' + (data.aiWarning ? '：' + escapeHtml(data.aiWarning) : ''))) + '</div>' +
          '<div style="word-break:break-all;">' + escapeHtml(data.filePath || '') + '</div>' +
          researchEnhancementFileActions(data.filePath) +
          '<pre style="white-space:pre-wrap;max-height:260px;overflow:auto;margin-top:10px;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);color:var(--text-primary);font-size:12px;line-height:1.6;">' + escapeHtml(preview) + (String(data.markdown || '').length > preview.length ? '\n...' : '') + '</pre>';
        setResearchEnhancementStatus('researchEnhancementSubmissionStatus', html, false);
        appendMessage(html, 'bot', true, true);
      } catch (e) {
        setResearchEnhancementStatus('researchEnhancementSubmissionStatus', escapeHtml(e.message || e), true);
      }
    };

    window.refreshActivePdfWikiWorkspace = async function() {
      var button = document.getElementById('pdfWikiViewerRefreshBtn');
      var originalText = button ? button.textContent : '';
      if (button) {
        button.disabled = true;
        button.textContent = '刷新中...';
      }
      try {
        if (pdfWikiWorkspaceMode === 'overview') {
          var overview = await loadOverviewStatus();
          renderOverviewPage(overview);
        } else if (pdfWikiWorkspaceMode === 'pdf-manager') {
          await reloadPdfWikiPdfManager({ scrollTop: getPdfWikiPdfManagerScrollTop() });
        } else if (pdfWikiWorkspaceMode === 'pdf-reader') {
          var readerPdfId = pdfWikiOriginalReaderPdfId;
          await loadPdfWikiPdfManagerDataOnly();
          renderPdfWikiOriginalPdfPage(readerPdfId);
        } else if (pdfWikiWorkspaceMode === 'meta') {
          await reloadPdfWikiMetaDatabase(pdfWikiMetaSelectedPdfId);
        } else if (pdfWikiWorkspaceMode === 'auto-research') {
          var state = await loadAutoResearchState();
          renderAutoResearchMode(state);
        } else {
          await reloadPdfWikiViewer(pdfWikiActiveSentencePointId || pdfWikiActiveEntryId);
        }
      } catch (e) {
        alert('刷新失败：' + (e.message || e));
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = originalText || '刷新';
        }
      }
    };

    // Embedding 文献库逻辑已拆分到 /embedding-library.js。

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('academic-workflows', { source: '/app/academic-workflows.js' });
}
