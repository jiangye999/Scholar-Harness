// 文献计量分析前端逻辑。依赖 index.html 中的 currentUserId、escapeHtml、uiIcon。
(function() {
  var bibliometricsState = {
    analysis: null,
    activeTab: 'overview',
    loading: false,
    networkLayouts: {},
    networkHover: {},
    networkDrag: null,
    paperDraft: null,
    paperDraftLoading: false,
    paperDraftProgressText: '',
    paperDraftProgressStep: 0,
    rPluginResult: null,
    rPluginLoading: false,
    dataset: null,
    artifacts: null,
    journalQualityTable: null,
    keywordMerges: { mergedTags: [], promotedTags: [] },
    keywordMergeCandidates: [],
    writingPrepActiveBubble: 'draft'
  };

  var PAPER_DRAFT_PROGRESS_STEPS = [
    '正在读取文献计量统计表、网络表和质量报告',
    '正在整理 Methods、Results、Discussion 的写作证据',
    '正在匹配 figure1 至 figure14 的正文引用位置',
    '正在生成论文标题、摘要、方法、结果和讨论',
    '正在检查图注、局限性和投稿前补充项',
    '正在合并最终 Markdown 草稿'
  ];
  var paperDraftProgressTimer = null;

  function closeBibliometricsDialog() {
    stopPaperDraftProgress();
    var modal = document.getElementById('bibliometricsModal');
    if (modal) modal.remove();
  }
  window.closeBibliometricsDialog = closeBibliometricsDialog;

  window.showBibliometricsDialog = async function(options) {
    if (typeof window.updateAcademicWorkflowOverviewReturn === 'function') {
      window.updateAcademicWorkflowOverviewReturn(options);
    }
    var existing = document.getElementById('bibliometricsModal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'bibliometricsModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.62);display:flex;align-items:center;justify-content:center;z-index:10030;padding:20px;';
    modal.classList.add('custom-fullscreen-overlay');
    modal.onclick = function(event) {
      if (event.target === modal) closeBibliometricsDialog();
    };
    modal.innerHTML =
      '<div id="bibliometricsPanel" class="custom-fullscreen-panel" style="width:min(1480px,98vw);height:min(900px,92vh);background:var(--bg-primary);border:1px solid var(--border-color);border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,0.35);" onclick="event.stopPropagation()">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 18px;border-bottom:1px solid var(--border-color);">' +
          '<div style="min-width:0;">' +
            '<div style="font-size:18px;font-weight:700;color:var(--text-primary);">文献计量分析</div>' +
            '<div id="bibliometricsSubtitle" style="font-size:12px;color:var(--text-secondary);margin-top:4px;">正在读取 WoS Plain Text 计量学数据库...</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;flex-shrink:1;flex-wrap:wrap;justify-content:flex-end;min-width:0;">' +
            (window.renderAcademicWorkflowTopActions ? window.renderAcademicWorkflowTopActions('bibliometrics') : '') +
            '<button id="bibliometricsFullscreenBtn" class="modal-icon-btn" type="button" onclick="toggleCustomModalFullscreen(\'bibliometricsModal\',\'bibliometricsPanel\',\'bibliometricsFullscreenBtn\')" title="全屏" aria-label="全屏"><svg class="ui-icon sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5"></path><path d="M16 3h5v5"></path><path d="M21 16v5h-5"></path><path d="M3 16v5h5"></path></svg></button>' +
            '<button type="button" onclick="refreshBibliometrics()" style="height:32px;padding:0 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">刷新</button>' +
            '<button type="button" onclick="closeBibliometricsDialog()" style="height:32px;padding:0 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">关闭</button>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 18px;border-bottom:1px solid var(--border-color);background:var(--bg-primary);overflow:hidden;">' +
          '<div style="display:flex;align-items:center;gap:8px;flex:0 0 auto;white-space:nowrap;">' +
            '<button type="button" onclick="uploadBibliometricsWosTxt()" title="批量上传/追加 Web of Science Plain Text" style="height:32px;padding:0 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">批量上传WoS TXT</button>' +
            '<button type="button" onclick="downloadBibliometricsExcel()" title="下载 Excel" style="height:32px;padding:0 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">Excel</button>' +
            '<button type="button" onclick="downloadBibliometricsDatabaseExcel()" title="下载解析后的计量学数据库" style="height:32px;padding:0 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">数据库</button>' +
            '<button type="button" onclick="uploadBibliometricsJournalQualityTable()" title="上传 JCR/中科院/影响因子/来源质量表" style="height:32px;padding:0 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">期刊质量表</button>' +
            '<button type="button" onclick="downloadBibliometricsFiguresZip()" title="下载自动生成的图表包" style="height:32px;padding:0 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">图表包</button>' +
            '<button type="button" onclick="downloadBibliometricsNetworkJson()" title="下载网络 JSON" style="height:32px;padding:0 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">JSON</button>' +
            '<button id="bibliometricsRChartBtn" type="button" onclick="runBibliometricsRCharts()" title="用 R 生成投稿图" style="height:32px;padding:0 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">R图表</button>' +
            '<button type="button" onclick="showBibliometricsJournalStyleDialog()" title="提取文献计量论文写作套路和目标期刊风格" style="height:32px;padding:0 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">期刊风格</button>' +
          '</div>' +
          '<div id="bibliometricsTabs" style="display:flex;align-items:center;justify-content:flex-end;gap:6px;min-width:0;flex:1;overflow-x:auto;padding-bottom:1px;"></div>' +
        '</div>' +
        '<div id="bibliometricsContent" style="min-height:0;flex:1;overflow:auto;padding:18px;color:var(--text-primary);">' +
          '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);">正在分析 WoS Plain Text 数据库...</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    if (typeof setFullscreenButtonState === 'function') {
      setFullscreenButtonState(document.getElementById('bibliometricsFullscreenBtn'), true);
    }
    bibliometricsState.activeTab = 'overview';
    await loadBibliometrics();
  };

  window.refreshBibliometrics = async function() {
    await loadBibliometrics();
  };

  function applyBibliometricsServerData(data) {
    bibliometricsState.analysis = data.analysis;
    bibliometricsState.dataset = data.dataset || null;
    bibliometricsState.artifacts = data.artifacts || null;
    bibliometricsState.journalQualityTable = data.journalQualityTable || null;
    bibliometricsState.keywordMerges = data.keywordMerges || { mergedTags: [], promotedTags: [] };
    bibliometricsState.keywordMergeCandidates = data.keywordMergeCandidates || [];
    bibliometricsState.networkLayouts = {};
    bibliometricsState.networkHover = {};
    bibliometricsState.networkDrag = null;
    bibliometricsState.paperDraft = null;
    bibliometricsState.rPluginResult = null;
  }

  async function loadBibliometrics() {
    bibliometricsState.loading = true;
    renderBibliometricsTabs();
    var content = document.getElementById('bibliometricsContent');
    if (content) {
      content.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);">正在分析 WoS Plain Text 数据库...</div>';
    }
    try {
      var response = await fetch('/api/bibliometrics?' + bibliometricsQuery());
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '文献计量分析失败');
      applyBibliometricsServerData(data);
      bibliometricsState.loading = false;
      renderBibliometrics();
    } catch (e) {
      bibliometricsState.loading = false;
      var subtitle = document.getElementById('bibliometricsSubtitle');
      if (subtitle) subtitle.textContent = '读取失败';
      if (content) {
        content.innerHTML = '<div style="padding:18px;color:var(--danger-color);">读取失败：' + escape(e.message) + '</div>';
      }
    }
  }

  function renderBibliometrics() {
    renderBibliometricsTabs();
    var rBtn = document.getElementById('bibliometricsRChartBtn');
    if (rBtn) {
      rBtn.textContent = bibliometricsState.rPluginLoading ? 'R运行中...' : 'R图表';
      rBtn.disabled = !!bibliometricsState.rPluginLoading;
      rBtn.style.opacity = bibliometricsState.rPluginLoading ? '0.65' : '1';
      rBtn.style.cursor = bibliometricsState.rPluginLoading ? 'wait' : 'pointer';
    }
    var analysis = bibliometricsState.analysis;
    var subtitle = document.getElementById('bibliometricsSubtitle');
    if (subtitle && analysis) {
      var s = analysis.summary || {};
      var dataset = bibliometricsState.dataset || {};
      subtitle.textContent = dataset.id
        ? 'WoS Plain Text：' + (dataset.sourceFileName || 'savedrecs.txt') + ' · 文献 ' + (s.total || 0) + ' 篇 · CR ' + (dataset.citedReferenceCount || 0) + ' 条 · 年份 ' + (s.yearMin && s.yearMax ? (s.yearMin + '-' + s.yearMax) : '未解析')
        : '未导入计量学数据库，请上传 Web of Science Plain Text 文件';
    }
    var content = document.getElementById('bibliometricsContent');
    if (!content || !analysis) return;
    if ((analysis.summary && analysis.summary.total || 0) === 0) {
      content.innerHTML =
        '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);">' +
          '<div style="max-width:520px;text-align:center;line-height:1.7;">' +
            '<div style="font-size:15px;font-weight:750;color:var(--text-primary);margin-bottom:8px;">暂无计量学数据库</div>' +
            '<div style="font-size:13px;margin-bottom:14px;">请从 Web of Science 导出 Plain Text，Record Content 选择 Full Record and Cited References，然后上传 savedrecs.txt。</div>' +
            '<button type="button" onclick="uploadBibliometricsWosTxt()" style="height:34px;padding:0 14px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">批量上传 WoS Plain Text</button>' +
          '</div>' +
        '</div>';
      return;
    }
    if (bibliometricsState.activeTab === 'keywords') content.innerHTML = renderNetworkTab('keyword');
    else if (bibliometricsState.activeTab === 'authors' || bibliometricsState.activeTab === 'collaboration') content.innerHTML = renderCollaboration();
    else if (bibliometricsState.activeTab === 'evolution') content.innerHTML = renderEvolution();
    else if (bibliometricsState.activeTab === 'structure') content.innerHTML = renderStructure();
    else if (bibliometricsState.activeTab === 'collaboration') content.innerHTML = renderCollaboration();
    else if (bibliometricsState.activeTab === 'topics') content.innerHTML = renderTopics();
    else if (bibliometricsState.activeTab === 'quality') content.innerHTML = renderQuality();
    else if (bibliometricsState.activeTab === 'writing') content.innerHTML = renderWritingPrep();
    else content.innerHTML = renderOverview();
    setTimeout(drawBibliometricCanvases, 0);
  }

  function renderBibliometricsTabs() {
    var tabs = document.getElementById('bibliometricsTabs');
    if (!tabs) return;
    var items = [
      ['overview', '概览'],
      ['keywords', '关键词网络'],
      ['topics', '主题簇'],
      ['evolution', '突现演化'],
      ['structure', '文献结构'],
      ['collaboration', '合作格局'],
      ['quality', '质量评估'],
      ['writing', '论文写作准备']
    ];
    tabs.innerHTML = items.map(function(item) {
      var active = bibliometricsState.activeTab === item[0];
      return '<button type="button" onclick="setBibliometricsTab(\'' + item[0] + '\')" style="height:30px;padding:0 11px;border:1px solid ' + (active ? 'var(--accent-color)' : 'var(--border-color)') + ';border-radius:6px;background:' + (active ? 'var(--accent-color)' : 'var(--bg-secondary)') + ';color:' + (active ? 'white' : 'var(--text-primary)') + ';cursor:pointer;font-size:12px;white-space:nowrap;">' + item[1] + '</button>';
    }).join('');
  }

  window.setBibliometricsTab = function(tab) {
    bibliometricsState.activeTab = tab === 'authors' ? 'collaboration' : (tab || 'overview');
    renderBibliometrics();
  };

  function renderOverview() {
    var analysis = bibliometricsState.analysis;
    var s = analysis.summary || {};
    var dataset = bibliometricsState.dataset || {};
    return '' +
      '<div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:14px;">' +
        metricCard('文献总数', s.total || 0, dataset.sourceFileName || 'WoS Plain Text') +
        metricCard('年份范围', s.yearMin && s.yearMax ? s.yearMin + '-' + s.yearMax : '未解析', '按发表年份') +
        metricCard('期刊数', s.journalCount || 0, '不同来源期刊') +
        metricCard('关键词数', s.keywordCount || 0, 'DE、ID、WC、SC') +
        metricCard('参考文献', dataset.citedReferenceCount || 0, 'CR 原始条目') +
      '</div>' +
      (dataset.id ? '<div style="margin-bottom:14px;">' + panel('当前计量学数据库', renderDatasetSummary(dataset)) + '</div>' : '') +
      (bibliometricsState.artifacts ? '<div style="margin-bottom:14px;">' + panel('自动图表产物', renderArtifactSummary(bibliometricsState.artifacts)) + '</div>' : '') +
      '<div style="display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:14px;margin-bottom:14px;">' +
        panel('年发文趋势', '<canvas id="bibliometricsYearChart" height="230" style="width:100%;height:230px;display:block;"></canvas>') +
        panel('数据覆盖', renderQualityBars(analysis.dataQuality || [])) +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;">' +
        panel('Top 期刊', rankList(analysis.topJournals || [])) +
        panel('Top 作者', rankList(analysis.topAuthors || [])) +
        panel('Top 关键词', rankList(analysis.topKeywords || [])) +
      '</div>';
  }

  function renderDatasetSummary(dataset) {
    return '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;font-size:12px;line-height:1.5;">' +
      '<div><div style="color:var(--text-secondary);">源文件</div><div style="font-weight:700;color:var(--text-primary);word-break:break-all;">' + escape(dataset.sourceFileName || '') + '</div></div>' +
      '<div><div style="color:var(--text-secondary);">去重参考文献</div><div style="font-weight:700;color:var(--text-primary);">' + escape(dataset.uniqueReferenceCount || 0) + '</div></div>' +
      '<div><div style="color:var(--text-secondary);">参考文献 DOI</div><div style="font-weight:700;color:var(--text-primary);">' + escape(dataset.referencesWithDoi || 0) + '</div></div>' +
      '<div><div style="color:var(--text-secondary);">导入时间</div><div style="font-weight:700;color:var(--text-primary);">' + escape(formatDateTime(dataset.importedAt)) + '</div></div>' +
      ((dataset.issues || []).length ? '<div style="grid-column:1/-1;color:var(--warning-color);">问题：' + escape((dataset.issues || []).join('；')) + '</div>' : '') +
      ((dataset.recommendations || []).length ? '<div style="grid-column:1/-1;color:var(--text-secondary);">建议：' + escape((dataset.recommendations || []).join('；')) + '</div>' : '') +
    '</div>';
  }

  function renderArtifactSummary(artifacts) {
    var figures = artifacts.figures || [];
    var ready = figures.filter(function(item) { return item.status === 'ready'; }).length;
    return '' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">' +
        '<div style="font-size:12px;color:var(--text-secondary);">已自动生成 ' + ready + '/' + figures.length + ' 张 SVG 预览图和 ' + ((artifacts.tables || []).length) + ' 个表格文件。论文草稿默认使用 R 图件 figure1 至 figure14。</div>' +
        '<button type="button" onclick="downloadBibliometricsFiguresZip()" style="height:28px;padding:0 10px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">下载图表包</button>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">' +
        figures.map(function(figure, index) {
          return '<div style="border:1px solid var(--border-color);border-radius:6px;padding:8px;background:var(--bg-secondary);min-width:0;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
              '<div style="font-size:12px;font-weight:750;color:var(--text-primary);min-width:0;">' + (index + 1) + '. ' + escape(figure.title || '') + '</div>' +
              '<span style="font-size:10px;color:' + (figure.status === 'ready' ? 'var(--accent-color)' : 'var(--text-secondary)') + ';">' + escape(figure.status || '') + '</span>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--text-secondary);margin-top:4px;word-break:break-all;">' + escape(figure.filename || '') + '</div>' +
          '</div>';
        }).join('') +
      '</div>';
  }

  function formatDateTime(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function renderNetworkTab(kind) {
    var cfg = getNetworkConfig(kind);
    return '' +
      '<div style="display:grid;grid-template-columns:minmax(0,1.55fr) minmax(320px,0.75fr);gap:14px;height:100%;">' +
        networkPanel(kind, cfg.title, cfg.emptyHint, 560) +
        panel(cfg.sideTitle, cfg.sideHtml()) +
      '</div>';
  }

  function getNetworkConfig(kind) {
    var analysis = bibliometricsState.analysis || {};
    var map = {
      keyword: {
        title: '关键词共现网络',
        sideTitle: '人工合并关键词',
        emptyHint: '网络数据不足，至少需要多篇文献存在共同关键词。',
        sideHtml: function() { return renderKeywordMergePanel(analysis.topKeywords || []); }
      },
      author: {
        title: '作者合作网络',
        sideTitle: '高产作者',
        emptyHint: '网络数据不足，至少需要多篇文献存在共同作者。',
        sideHtml: function() { return rankList(analysis.topAuthors || []); }
      },
      similarity: {
        title: '语义相似性网络（可选）',
        sideTitle: '高影响/完整文献',
        emptyHint: '独立 WoS 计量学分析不依赖 embedding；可优先查看共被引和文献耦合网络。',
        sideHtml: function() { return noteList(['WoS Plain Text 数据库默认使用关键词、作者、机构、CR 参考文献做计量分析。', '语义相似性网络只有在另行提供 embedding 时才启用。']); }
      },
      coCitation: {
        title: '共被引网络',
        sideTitle: '共被引说明',
        emptyHint: '共被引分析需要参考文献列表，并且多篇文献共同引用同一批参考文献。',
        sideHtml: function() { return noteList(['节点是被引用参考文献。', '边表示两条参考文献被同一篇文献共同引用。', '正式论文需说明 cited references 的来源。']); }
      },
      coupling: {
        title: '文献耦合网络',
        sideTitle: '耦合说明',
        emptyHint: '文献耦合需要文献库带参考文献列表，边权为两篇文献共享参考文献数。',
        sideHtml: function() { return noteList(['节点是当前文献库中的论文。', '边越粗表示共享参考文献越多。', '适合识别研究基础相近的论文群。']); }
      },
      institution: {
        title: '机构合作网络',
        sideTitle: '机构字段',
        emptyHint: '机构合作网络需要 affiliation、C1 或 AD 字段。',
        sideHtml: function() { return noteList(['建议导入 WoS Full Record 或 OpenAlex authorships。', '机构名会做基础清洗，但正式论文仍需人工合并同名机构。']); }
      },
      country: {
        title: '国家/地区合作网络',
        sideTitle: '国家字段',
        emptyHint: '国家合作网络需要机构地址或国家字段。',
        sideHtml: function() { return noteList(['国家从 country 字段或 affiliation 末尾尝试解析。', '正式投稿前建议人工核查国家/地区归并规则。']); }
      }
    };
    return map[kind] || map.keyword;
  }

  function getBibliometricNetwork(kind) {
    var analysis = bibliometricsState.analysis || {};
    if (kind === 'author') return analysis.authorNetwork;
    if (kind === 'similarity') return analysis.literatureSimilarityNetwork;
    if (kind === 'coCitation') return analysis.coCitationNetwork;
    if (kind === 'coupling') return analysis.bibliographicCouplingNetwork;
    if (kind === 'institution') return analysis.institutionNetwork;
    if (kind === 'country') return analysis.countryNetwork;
    return analysis.keywordNetwork;
  }

  function networkPanel(kind, title, emptyHint, height) {
    var network = getBibliometricNetwork(kind);
    var empty = !network || !Array.isArray(network.nodes) || network.nodes.length === 0;
    var chartHeight = height || 420;
    return panel(title, empty
      ? '<div style="height:' + Math.max(260, chartHeight - 120) + 'px;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--text-secondary);font-size:13px;line-height:1.6;padding:18px;">' + escape(emptyHint || '网络数据不足。') + '</div>'
      : '<div style="position:relative;border:1px solid var(--border-color);border-radius:8px;background:linear-gradient(180deg,rgba(0,136,110,0.06),rgba(127,127,127,0.04));overflow:hidden;">' +
          '<canvas class="bibliometricsNetworkCanvas" data-bibliometrics-network="1" data-kind="' + kind + '" height="' + chartHeight + '" style="width:100%;height:' + chartHeight + 'px;display:block;cursor:grab;"></canvas>' +
          '<div style="position:absolute;left:10px;bottom:9px;padding:5px 7px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-bg);color:var(--text-secondary);font-size:11px;line-height:1.35;pointer-events:none;">拖动节点调整布局 · 悬停查看连接</div>' +
        '</div>');
  }

  function renderTopics() {
    var clusters = bibliometricsState.analysis.topicClusters || [];
    if (!clusters.length) {
      return '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);">关键词共现不足，暂未形成主题簇。</div>';
    }
    return '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;">' + clusters.map(function(cluster, index) {
      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:14px;min-width:0;">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">' +
          '<div style="font-size:14px;font-weight:750;color:var(--text-primary);line-height:1.45;">' + (index + 1) + '. ' + escape(cluster.label || '主题簇') + '</div>' +
          '<div style="font-size:11px;color:var(--accent-color);white-space:nowrap;">文献 ' + escape(cluster.literatureCount || 0) + ' · 词 ' + escape(cluster.size || 0) + '</div>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">' + (cluster.keywords || []).slice(0, 12).map(function(keyword) {
          return '<span style="padding:4px 7px;border:1px solid var(--border-color);border-radius:999px;background:var(--modal-bg);font-size:11px;color:var(--text-secondary);">' + escape(keyword) + '</span>';
        }).join('') + '</div>' +
        '<div style="margin-top:10px;color:var(--text-secondary);font-size:12px;line-height:1.55;">' +
          (cluster.sampleTitles || []).slice(0, 4).map(function(title) { return '<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escape(title) + '</div>'; }).join('') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function renderEvolution() {
    var analysis = bibliometricsState.analysis || {};
    var bursts = analysis.keywordBursts || [];
    var periods = analysis.topicEvolution || [];
    var trends = analysis.keywordYearTrends || [];
    return '' +
      '<div style="display:grid;grid-template-columns:minmax(0,1.45fr) minmax(320px,0.65fr);gap:14px;margin-bottom:14px;">' +
        panel('主流关键词年际变化趋势', trends.length
          ? '<canvas id="bibliometricsKeywordTrendChart" height="300" style="width:100%;height:300px;display:block;"></canvas>'
          : '<div style="height:260px;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:13px;">需要年份和关键词字段才能绘制年际趋势。</div>') +
        panel('关键词标签来源', keywordTagSourceBlock(analysis.keywordTagSource || {})) +
      '</div>' +
      '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;margin-bottom:14px;">' +
        panel('突现关键词', simpleTable(
          ['关键词', '分数', '近期', '峰值年'],
          bursts.slice(0, 18).map(function(item) {
            return [item.keyword, item.score, item.recentCount, item.peakYear || ''];
          }),
          '需要至少 3 个年份切片和关键词字段。'
        )) +
        panel('趋势关键词', simpleTable(
          ['关键词', '总频次', '峰值年'],
          trends.map(function(series) {
            return [series.keyword, series.total, series.peakYear || ''];
          }),
          '暂无趋势关键词。'
        )) +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;">' +
        (periods.length ? periods.map(function(period) {
          return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:14px;min-width:0;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">' +
              '<div style="font-size:13px;font-weight:750;color:var(--text-primary);">' + escape(period.period) + '</div>' +
              '<div style="font-size:11px;color:var(--accent-color);">文献 ' + escape(period.literatureCount || 0) + '</div>' +
            '</div>' +
            '<div style="font-size:12px;color:var(--text-secondary);line-height:1.65;">' +
              '<div><b style="color:var(--text-primary);">关键词：</b>' + escape((period.topKeywords || []).map(function(item) { return item.label + '(' + item.count + ')'; }).join('；') || '暂无') + '</div>' +
              '<div><b style="color:var(--text-primary);">期刊：</b>' + escape((period.leadingJournals || []).map(function(item) { return item.label + '(' + item.count + ')'; }).join('；') || '暂无') + '</div>' +
              '<div style="margin-top:6px;">' + (period.representativeTitles || []).slice(0, 4).map(function(title) {
                return '<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escape(title) + '</div>';
              }).join('') + '</div>' +
            '</div>' +
          '</div>';
        }).join('') : '<div style="color:var(--text-secondary);font-size:12px;">暂无年份数据，无法做主题演化。</div>') +
      '</div>';
  }

  function renderStructure() {
    var analysis = bibliometricsState.analysis || {};
    return '' +
      '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;margin-bottom:14px;">' +
        panel('高影响文献', highImpactList(analysis.highImpactLiteratures || [])) +
        panel('结构分析说明', noteList([
          '语义相似性网络为可选项；当前独立 WoS 计量学分析优先解释共被引和文献耦合。',
          '共被引网络基于 cited references，用于识别知识基础。',
          '文献耦合网络基于共享参考文献，用于识别研究路径相近的文献。'
        ])) +
      '</div>' +
      '<div style="display:grid;grid-template-columns:minmax(0,1fr);gap:14px;margin-bottom:14px;">' +
        networkPanel('similarity', '语义相似性网络（可选）', '独立 WoS 计量学分析不依赖 embedding；可优先查看共被引和文献耦合网络。', 460) +
      '</div>' +
      '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;">' +
        networkPanel('coCitation', '共被引网络', '共被引分析需要参考文献列表，并且多篇文献共同引用同一批参考文献。', 380) +
        networkPanel('coupling', '文献耦合网络', '文献耦合需要文献库带参考文献列表，边权为两篇文献共享参考文献数。', 380) +
      '</div>';
  }

  function renderCollaboration() {
    return '' +
      '<div style="display:grid;grid-template-columns:minmax(0,1fr);gap:14px;margin-bottom:14px;">' +
        networkPanel('author', '作者合作网络', '网络数据不足，至少需要多篇文献存在共同作者。', 460) +
      '</div>' +
      '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;">' +
        networkPanel('institution', '机构合作网络', '机构合作网络需要 affiliation、C1 或 AD 字段。', 380) +
        networkPanel('country', '国家/地区合作网络', '国家合作网络需要机构地址或国家字段。', 380) +
      '</div>';
  }

  function renderQuality() {
    var analysis = bibliometricsState.analysis;
    return '' +
      '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;">' +
        panel('数据质量', renderQualityBars(analysis.dataQuality || [])) +
        panel('检索质量报告', retrievalQualityBlock(analysis.retrievalQuality || {})) +
        panel('期刊质量字段', journalQualityBlock(analysis.journalQuality || {})) +
        panel('来源与类型', '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' + rankList(analysis.sources || []) + rankList(analysis.documentTypes || []) + '</div>') +
      '</div>';
  }

  function writingPrepBubbleStyle(active) {
    return 'width:100%;min-height:58px;text-align:left;padding:9px 11px;border:1px solid ' +
      (active ? 'rgba(0,136,110,0.42)' : 'var(--border-color)') +
      ';border-radius:999px;background:' + (active ? 'rgba(0,136,110,0.12)' : 'var(--bg-secondary)') +
      ';color:' + (active ? 'var(--accent-color)' : 'var(--text-primary)') +
      ';cursor:pointer;display:flex;flex-direction:column;justify-content:center;gap:3px;min-width:0;box-shadow:' +
      (active ? '0 8px 22px rgba(0,136,110,0.10)' : 'none') + ';';
  }

  function renderWritingPrepBubble(key, label, hint) {
    var active = (bibliometricsState.writingPrepActiveBubble || 'draft') === key;
    return '<button type="button" data-bibliometrics-writing-bubble="' + attr(key) + '" onmouseenter="showBibliometricsWritingPrepBubble(\'' + attr(key) + '\')" onclick="showBibliometricsWritingPrepBubble(\'' + attr(key) + '\')" onfocus="showBibliometricsWritingPrepBubble(\'' + attr(key) + '\')" aria-selected="' + (active ? 'true' : 'false') + '" style="' + writingPrepBubbleStyle(active) + '">' +
      '<span style="display:block;font-size:12px;font-weight:820;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escape(label) + '</span>' +
      '<span style="display:block;font-size:10px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escape(hint || '') + '</span>' +
    '</button>';
  }

  function writingPrepPage(key, body) {
    var active = (bibliometricsState.writingPrepActiveBubble || 'draft') === key;
    return '<div data-bibliometrics-writing-page="' + attr(key) + '" style="display:' + (active ? 'block' : 'none') + ';min-width:0;">' + body + '</div>';
  }

  function writingPrepContentPage(title, body, rightHtml) {
    return '<section style="min-height:430px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:14px;min-width:0;">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;">' +
        '<div style="min-width:0;font-size:14px;font-weight:820;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escape(title) + '</div>' +
        (rightHtml || '') +
      '</div>' +
      body +
    '</section>';
  }

  function renderWritingPrepBubbleStage(prep, readiness, draft) {
    return '<div id="bibliometricsWritingPrepStage" style="min-height:470px;border:1px dashed rgba(127,127,127,0.28);border-radius:8px;background:var(--modal-bg);padding:12px;margin-top:12px;">' +
      writingPrepPage('draft',
        (bibliometricsState.paperDraftLoading ? '<div style="margin-bottom:12px;">' + renderPaperDraftProgress() + '</div>' : '') +
        renderPaperDraftWorkspace(draft)
      ) +
      writingPrepPage('readiness',
        '<div style="display:grid;grid-template-columns:minmax(0,1.15fr) minmax(300px,0.85fr);gap:14px;align-items:start;">' +
          writingPrepContentPage('10项分析就绪度', readinessList(readiness)) +
          '<div style="display:flex;flex-direction:column;gap:14px;min-width:0;">' +
            panel('还需要补齐的数据', sectionList(prep.requiredSupplementaryData || [])) +
            panel('R 图表插件', renderRPluginResult()) +
          '</div>' +
        '</div>'
      ) +
      writingPrepPage('methods',
        writingPrepContentPage('方法部分可写内容', sectionList(prep.methodsOutline || []))
      ) +
      writingPrepPage('results',
        writingPrepContentPage('结果部分可写内容', sectionList(prep.resultsOutline || []))
      ) +
      writingPrepPage('discussion',
        writingPrepContentPage('讨论角度', sectionList(prep.discussionAngles || []))
      ) +
      writingPrepPage('limitations',
        writingPrepContentPage('局限性', sectionList(prep.limitations || []))
      ) +
    '</div>';
  }

  window.showBibliometricsWritingPrepBubble = function(key) {
    var allowed = { draft: true, readiness: true, methods: true, results: true, discussion: true, limitations: true };
    if (!allowed[key]) key = 'draft';
    bibliometricsState.writingPrepActiveBubble = key;
    var bubbles = document.querySelectorAll('[data-bibliometrics-writing-bubble]');
    Array.prototype.forEach.call(bubbles, function(button) {
      var active = button.getAttribute('data-bibliometrics-writing-bubble') === key;
      button.style.cssText = writingPrepBubbleStyle(active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    var pages = document.querySelectorAll('[data-bibliometrics-writing-page]');
    Array.prototype.forEach.call(pages, function(page) {
      page.style.display = page.getAttribute('data-bibliometrics-writing-page') === key ? 'block' : 'none';
    });
  };

  function renderWritingPrep() {
    var analysis = bibliometricsState.analysis || {};
    var prep = analysis.writingPreparation || {};
    var draft = bibliometricsState.paperDraft;
    var readiness = analysis.readiness || [];
    var readyCount = readiness.filter(function(item) { return item.status === 'ready'; }).length;
    return '' +
      '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--modal-bg);padding:14px;margin-bottom:14px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:start;">' +
        '<div style="min-width:0;">' +
          '<div style="display:inline-flex;max-width:100%;align-items:center;padding:9px 13px;border:1px solid rgba(0,136,110,0.34);border-radius:999px;background:rgba(0,136,110,0.10);color:var(--accent-color);font-size:16px;font-weight:840;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escape(prep.suggestedTitle || '基于文献计量学的研究热点、主题演化与知识结构分析') + '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(6,minmax(118px,1fr));gap:9px;margin-top:12px;">' +
            renderWritingPrepBubble('draft', '计量学论文草稿', draft ? (draft.provider || '已生成') : (bibliometricsState.paperDraftLoading ? '生成中' : '未生成')) +
            renderWritingPrepBubble('readiness', '10项分析就绪度', readiness.length ? (readyCount + '/' + readiness.length + ' 项就绪') : '暂无就绪度') +
            renderWritingPrepBubble('methods', '方法部分可写内容', (prep.methodsOutline || []).length + ' 条') +
            renderWritingPrepBubble('results', '结果部分可写内容', (prep.resultsOutline || []).length + ' 条') +
            renderWritingPrepBubble('discussion', '讨论角度', (prep.discussionAngles || []).length + ' 条') +
            renderWritingPrepBubble('limitations', '局限性', (prep.limitations || []).length + ' 条') +
          '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;max-width:430px;">' +
          renderWritingPrepActions() +
        '</div>' +
      '</div>' +
      renderWritingPrepBubbleStage(prep, readiness, draft);
  }

  function renderWritingPrepActions() {
    var loading = !!bibliometricsState.paperDraftLoading;
    var disabledAttr = loading ? ' disabled' : '';
    var generateStyle = 'height:32px;padding:0 11px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:' + (loading ? 'wait' : 'pointer') + ';opacity:' + (loading ? '0.72' : '1') + ';';
    return '' +
      '<button type="button" onclick="copyBibliometricsWritingPrep()" style="height:32px;padding:0 11px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">复制框架</button>' +
      '<button type="button" onclick="showBibliometricsJournalStyleDialog()" style="height:32px;padding:0 11px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">提取期刊风格</button>' +
      '<button type="button" onclick="generateBibliometricsPaperDraft()" style="' + generateStyle + '"' + disabledAttr + '>' + (loading ? '生成中...' : '生成论文草稿') + '</button>' +
      '<button type="button" onclick="downloadBibliometricsPaperDraft()" style="height:32px;padding:0 11px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">下载 MD</button>';
  }

  function renderPaperDraftWorkspace(draft) {
    if (!draft) {
      return panel('计量学论文草稿',
        '<div style="min-height:360px;border:1px dashed var(--border-color);border-radius:8px;background:var(--modal-bg);display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;">' +
          '<div style="max-width:430px;">' +
            '<div style="font-size:15px;font-weight:800;color:var(--text-primary);margin-bottom:8px;">' + (bibliometricsState.paperDraftLoading ? '正在生成草稿' : '草稿尚未生成') + '</div>' +
            '<div style="font-size:12px;line-height:1.7;color:var(--text-secondary);">生成完成后会在这里打开可编辑的 Markdown 草稿，下载 MD 和复制全文仍使用同一份编辑内容。</div>' +
          '</div>' +
        '</div>'
      );
    }
    return panel('计量学论文草稿',
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">' +
        '<div style="font-size:12px;color:var(--text-secondary);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escape(draft.title || '文献计量论文草稿') + ' · ' + escape(draft.provider || '内置模板') + '</div>' +
        '<button type="button" onclick="copyBibliometricsPaperDraft()" style="height:28px;padding:0 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-bg);color:var(--text-primary);cursor:pointer;font-size:12px;flex-shrink:0;">复制全文</button>' +
      '</div>' +
      ((draft.fallbackAttempts || []).length ? '<div style="margin-bottom:8px;font-size:12px;line-height:1.6;color:var(--warning-color);">' + escape((draft.fallbackAttempts || []).join('；')) + '</div>' : '') +
      '<textarea id="bibliometricsPaperDraftEditor" style="width:100%;min-height:540px;resize:vertical;border:1px solid var(--border-color);border-radius:8px;background:var(--modal-bg);color:var(--text-primary);padding:12px;font-size:12px;line-height:1.65;font-family:Consolas,monospace;">' + escape(draft.markdown || '') + '</textarea>'
    );
  }

  function renderPaperDraftProgress() {
    var activeStep = bibliometricsState.paperDraftProgressStep || 0;
    var text = bibliometricsState.paperDraftProgressText || PAPER_DRAFT_PROGRESS_STEPS[0];
    return '<div style="border:1px solid #000000;border-radius:8px;background:var(--bg-secondary);padding:11px 12px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px;">' +
        '<div id="bibliometricsPaperDraftProgressText" style="min-height:20px;font-size:12px;font-weight:750;color:var(--text-primary);font-family:Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escape(text) + '</div>' +
        '<div id="bibliometricsPaperDraftProgressIndex" style="font-size:11px;color:var(--text-secondary);white-space:nowrap;">' + (Math.min(activeStep + 1, PAPER_DRAFT_PROGRESS_STEPS.length)) + '/' + PAPER_DRAFT_PROGRESS_STEPS.length + '</div>' +
      '</div>' +
      '<div id="bibliometricsPaperDraftProgressBars" style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px;">' +
        PAPER_DRAFT_PROGRESS_STEPS.map(function(step, index) {
          var active = index <= activeStep;
          return '<div title="' + attr(step) + '" style="height:4px;border-radius:99px;background:' + (active ? '#000000' : 'rgba(127,127,127,0.18)') + ';"></div>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  function metricCard(label, value, hint) {
    return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:13px;min-width:0;">' +
      '<div style="font-size:11px;color:var(--text-secondary);">' + escape(label) + '</div>' +
      '<div style="font-size:22px;font-weight:780;color:var(--text-primary);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escape(value) + '</div>' +
      '<div style="font-size:11px;color:var(--text-secondary);margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escape(hint || '') + '</div>' +
    '</div>';
  }

  function panel(title, body) {
    return '<section style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:14px;min-width:0;">' +
      '<div style="font-size:13px;font-weight:750;color:var(--text-primary);margin-bottom:10px;">' + escape(title) + '</div>' +
      body +
    '</section>';
  }

  function rankList(rows) {
    if (!rows || !rows.length) return '<div style="color:var(--text-secondary);font-size:12px;">暂无数据</div>';
    var max = Math.max.apply(null, rows.map(function(row) { return row.count || 0; })) || 1;
    return '<div style="display:flex;flex-direction:column;gap:8px;">' + rows.slice(0, 25).map(function(row, index) {
      var width = Math.max(3, Math.round((row.count || 0) / max * 100));
      return '<div style="display:grid;grid-template-columns:24px minmax(0,1fr) 54px;gap:8px;align-items:center;font-size:12px;">' +
        '<div style="color:var(--text-secondary);">' + (index + 1) + '</div>' +
        '<div style="min-width:0;">' +
          '<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-primary);">' + escape(row.label) + '</div>' +
          '<div style="height:5px;background:rgba(127,127,127,0.16);border-radius:99px;margin-top:4px;overflow:hidden;"><div style="height:100%;width:' + width + '%;background:#000000;border-radius:99px;"></div></div>' +
        '</div>' +
        '<div style="text-align:right;color:var(--text-secondary);">' + escape(row.count || 0) + '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function renderQualityBars(rows) {
    if (!rows || !rows.length) return '<div style="color:var(--text-secondary);font-size:12px;">暂无数据</div>';
    return '<div style="display:flex;flex-direction:column;gap:10px;">' + rows.map(function(row) {
      return '<div style="display:grid;grid-template-columns:92px minmax(0,1fr) 80px;gap:9px;align-items:center;font-size:12px;">' +
        '<div style="color:var(--text-primary);">' + escape(row.label) + '</div>' +
        '<div style="height:8px;background:rgba(127,127,127,0.16);border-radius:99px;overflow:hidden;"><div style="height:100%;width:' + Math.max(1, Math.min(100, row.percentage || 0)) + '%;background:#000000;"></div></div>' +
        '<div style="text-align:right;color:var(--text-secondary);">' + escape(row.count || 0) + ' · ' + escape(row.percentage || 0) + '%</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function simpleTable(headers, rows, emptyMessage) {
    if (!rows || !rows.length) {
      return '<div style="color:var(--text-secondary);font-size:12px;line-height:1.7;">' + escape(emptyMessage || '暂无数据') + '</div>';
    }
    return '<div style="overflow:auto;max-height:360px;">' +
      '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
        '<thead><tr>' + headers.map(function(header) {
          return '<th style="text-align:left;padding:7px 6px;border-bottom:1px solid var(--border-color);color:var(--text-secondary);font-weight:650;white-space:nowrap;">' + escape(header) + '</th>';
        }).join('') + '</tr></thead>' +
        '<tbody>' + rows.map(function(row) {
          return '<tr>' + row.map(function(cell) {
            return '<td style="padding:7px 6px;border-bottom:1px solid rgba(127,127,127,0.12);color:var(--text-primary);vertical-align:top;max-width:280px;overflow:hidden;text-overflow:ellipsis;">' + escape(cell) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody>' +
      '</table>' +
    '</div>';
  }

  function noteList(items) {
    if (!items || !items.length) return '<div style="color:var(--text-secondary);font-size:12px;">暂无说明</div>';
    return '<div style="display:flex;flex-direction:column;gap:8px;font-size:12px;line-height:1.65;color:var(--text-secondary);">' +
      items.map(function(item, index) {
        return '<div style="display:grid;grid-template-columns:20px minmax(0,1fr);gap:7px;"><span style="color:var(--accent-color);font-weight:750;">' + (index + 1) + '.</span><span>' + escape(item) + '</span></div>';
      }).join('') +
    '</div>';
  }

  function sectionList(items) {
    if (!items || !items.length) return '<div style="color:var(--text-secondary);font-size:12px;">暂无数据</div>';
    return '<div style="display:flex;flex-direction:column;gap:9px;">' + items.map(function(item, index) {
      return '<div style="display:grid;grid-template-columns:24px minmax(0,1fr);gap:8px;font-size:12px;line-height:1.65;color:var(--text-secondary);">' +
        '<div style="width:20px;height:20px;border-radius:6px;background:rgba(0,136,110,0.12);color:var(--accent-color);display:flex;align-items:center;justify-content:center;font-weight:750;font-size:11px;">' + (index + 1) + '</div>' +
        '<div>' + escape(item) + '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function renderRPluginResult() {
    if (bibliometricsState.rPluginLoading) {
      return '<div style="font-size:12px;color:var(--text-secondary);line-height:1.7;">正在运行 Rscript...</div>';
    }
    var result = bibliometricsState.rPluginResult;
    if (!result) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
        '<div style="font-size:12px;color:var(--text-secondary);line-height:1.7;">尚未生成 R 图表。若已安装 R 但仍无法出图，可先在 R 语言作图窗口点“重新检测”。</div>' +
        '<div style="display:flex;gap:7px;flex-shrink:0;">' +
          '<button type="button" onclick="runBibliometricsRCharts()" style="height:30px;padding:0 10px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">生成图表</button>' +
          '<button type="button" onclick="window.installRPlugin ? window.installRPlugin() : alert(\'请打开 R语言作图 窗口安装 R 插件\')" style="height:30px;padding:0 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-bg);color:var(--text-primary);cursor:pointer;font-size:12px;">一键安装R</button>' +
        '</div>' +
      '</div>';
    }
    if (result.error) {
      return '<div style="font-size:12px;line-height:1.7;">' +
        '<div style="color:var(--danger-color);white-space:pre-wrap;">' + escape(result.error) + '</div>' +
        '<div style="display:flex;gap:7px;margin-top:8px;">' +
          '<button type="button" onclick="runBibliometricsRCharts()" style="height:28px;padding:0 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-bg);color:var(--text-primary);cursor:pointer;font-size:12px;">重试</button>' +
          '<button type="button" onclick="window.installRPlugin ? window.installRPlugin() : alert(\'请打开 R语言作图 窗口安装 R 插件\')" style="height:28px;padding:0 9px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">一键安装R插件</button>' +
        '</div>' +
      '</div>';
    }
    var files = result.files || [];
    var imageFiles = (result.imageFiles && result.imageFiles.length ? result.imageFiles : files.filter(isRImageFile));
    var supportFiles = (result.supportFiles && result.supportFiles.length ? result.supportFiles : files.filter(function(file) { return !isRImageFile(file); }));
    var zipUrl = result.jobId ? rArtifactZipUrl(result.jobId, 'all') : '';
    return '<div style="font-size:12px;line-height:1.7;color:var(--text-secondary);">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;">' +
        '<div>任务 ' + escape(result.jobId || '') + ' · 图片 ' + imageFiles.length + ' 张' + (supportFiles.length ? ' · 支持文件 ' + supportFiles.length + ' 个' : '') + '</div>' +
        '<div style="display:flex;gap:7px;flex-shrink:0;">' +
          (zipUrl ? '<a href="' + escape(zipUrl) + '" download="r-figures-' + attr(result.jobId) + '.zip" style="height:28px;display:inline-flex;align-items:center;padding:0 9px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;text-decoration:none;font-size:12px;">打包下载</a>' : '') +
          '<button type="button" onclick="runBibliometricsRCharts()" style="height:28px;padding:0 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-bg);color:var(--text-primary);cursor:pointer;font-size:12px;">重新生成</button>' +
        '</div>' +
      '</div>' +
      (result.plotDir ? '<div style="font-size:11px;margin-bottom:8px;color:var(--text-secondary);word-break:break-all;">图片目录：' + escape(result.plotDir) + '</div>' : '') +
      (imageFiles.length ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;">' + imageFiles.map(renderRImageFileCard).join('') + '</div>' : '<div>没有检测到 PNG/PDF/SVG 等图片产物。</div>') +
      (supportFiles.length ? '<details style="margin-top:10px;"><summary style="cursor:pointer;color:var(--text-secondary);">查看 R 脚本、图注表等支持文件</summary><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">' + supportFiles.map(function(file) {
        return '<a href="' + escape(file.url || '#') + '" download="' + attr(file.name || 'artifact') + '" style="padding:5px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-bg);color:var(--accent-color);text-decoration:none;">' + escape(file.relativePath || file.name || 'artifact') + '</a>';
      }).join('') + '</div></details>' : '') +
      ((result.stderr || '').trim() ? '<pre style="margin-top:8px;max-height:120px;overflow:auto;background:var(--modal-bg);border:1px solid var(--border-color);border-radius:6px;padding:8px;white-space:pre-wrap;color:var(--text-secondary);">' + escape(result.stderr) + '</pre>' : '') +
    '</div>';
  }

  function isRImageFile(file) {
    var name = String((file && (file.relativePath || file.name)) || '').toLowerCase();
    return /\.(png|pdf|svg|jpe?g|tiff?)$/.test(name);
  }

  function rArtifactZipUrl(jobId, scope) {
    return '/api/r-code/artifact-zip/' + encodeURIComponent(window.currentUserId || 'web-user') + '/' + encodeURIComponent(jobId) + '?scope=' + encodeURIComponent(scope || 'all');
  }

  function renderRImageFileCard(file) {
    var name = file.relativePath || file.name || 'figure';
    var lower = String(name).toLowerCase();
    var isPreviewable = /\.(png|svg|jpe?g)$/.test(lower);
    return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--modal-bg);overflow:hidden;min-width:0;">' +
      (isPreviewable
        ? '<a href="' + escape(file.url || '#') + '" target="_blank" style="display:block;background:white;"><img src="' + escape(file.url || '#') + '" alt="' + attr(name) + '" style="width:100%;height:118px;object-fit:contain;display:block;"></a>'
        : '<div style="height:118px;display:flex;align-items:center;justify-content:center;background:white;color:var(--text-secondary);font-size:20px;font-weight:750;">PDF</div>') +
      '<div style="padding:8px;">' +
        '<div style="font-size:11px;color:var(--text-primary);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + attr(name) + '">' + escape(name) + '</div>' +
        '<div style="display:flex;gap:6px;margin-top:7px;">' +
          '<a href="' + escape(file.url || '#') + '" target="_blank" style="flex:1;text-align:center;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;color:var(--accent-color);text-decoration:none;">查看</a>' +
          '<a href="' + escape(file.url || '#') + '" download="' + attr(file.name || name) + '" style="flex:1;text-align:center;padding:4px 6px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;text-decoration:none;">下载</a>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function highImpactList(rows) {
    return simpleTable(
      ['标题', '年份', '被引', '分数'],
      (rows || []).slice(0, 12).map(function(item) {
        return [
          item.title || item.id || '未命名',
          item.year || '',
          item.citationCount === null || item.citationCount === undefined ? '缺字段' : item.citationCount,
          item.influenceScore || 0
        ];
      }),
      '暂无文献。若缺少被引次数字段，系统会用 DOI、摘要、关键词和新近程度给出临时影响分数。'
    );
  }

  function readinessList(rows) {
    if (!rows || !rows.length) return '<div style="color:var(--text-secondary);font-size:12px;">暂无就绪度信息</div>';
    return '<div style="display:flex;flex-direction:column;gap:9px;">' + rows.map(function(item) {
      var color = item.status === 'ready' ? '#00886e' : (item.status === 'partial' ? '#d97706' : '#be123c');
      var text = item.status === 'ready' ? '可用' : (item.status === 'partial' ? '部分' : '缺数据');
      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--modal-bg);padding:9px 10px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">' +
          '<div style="font-size:12px;font-weight:720;color:var(--text-primary);">' + escape(item.label) + '</div>' +
          '<div style="font-size:11px;color:' + color + ';font-weight:750;white-space:nowrap;">' + text + '</div>' +
        '</div>' +
        '<div style="font-size:11px;line-height:1.55;color:var(--text-secondary);margin-top:5px;">' + escape(item.message) + '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function retrievalQualityBlock(report) {
    var score = Math.max(0, Math.min(100, report.score || 0));
    return '' +
      '<div style="margin-bottom:12px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;margin-bottom:6px;"><span style="color:var(--text-primary);font-weight:720;">检索质量分</span><span style="color:var(--accent-color);font-weight:760;">' + score + '/100</span></div>' +
        '<div style="height:8px;background:rgba(127,127,127,0.16);border-radius:99px;overflow:hidden;"><div style="height:100%;width:' + score + '%;background:#000000;"></div></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
        '<div>' +
          '<div style="font-size:12px;font-weight:720;color:var(--text-primary);margin-bottom:6px;">问题</div>' +
          noteList(report.issues && report.issues.length ? report.issues : ['暂未发现硬性问题。']) +
        '</div>' +
        '<div>' +
          '<div style="font-size:12px;font-weight:720;color:var(--text-primary);margin-bottom:6px;">建议</div>' +
          noteList(report.recommendations || []) +
        '</div>' +
      '</div>';
  }

  function journalQualityBlock(journalQuality) {
    var table = bibliometricsState.journalQualityTable;
    return '' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">' +
        '<div style="font-size:12px;line-height:1.55;color:var(--text-secondary);min-width:0;">' +
          (table
            ? '已接入：' + escape(table.sourceFileName || '') + ' · ' + escape(table.rowCount || 0) + ' 行 · ISSN ' + escape(table.withIssn || 0) + ' · IF ' + escape(table.withImpactFactor || 0)
            : '尚未接入外部期刊质量表。建议上传含 journal/ISSN/JCR/CAS/IF/来源等级的 Excel 或 CSV。') +
        '</div>' +
        '<div style="display:flex;gap:7px;flex-shrink:0;">' +
          '<button type="button" onclick="downloadBuiltInBibliometricsJournalQuality()" style="height:28px;padding:0 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-bg);color:var(--text-primary);cursor:pointer;font-size:12px;">内置下载</button>' +
          '<button type="button" onclick="uploadBibliometricsJournalQualityTable()" style="height:28px;padding:0 9px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">上传</button>' +
          (table ? '<button type="button" onclick="clearBibliometricsJournalQualityTable()" style="height:28px;padding:0 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-bg);color:var(--text-primary);cursor:pointer;font-size:12px;">清除</button>' : '') +
        '</div>' +
      '</div>' +
      '<div style="margin-bottom:12px;">' + renderQualityBars(journalQuality.coverage || []) + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">' +
        '<div><div style="font-size:12px;font-weight:720;color:var(--text-primary);margin-bottom:6px;">JCR 分区</div>' + rankList(journalQuality.quartiles || []) + '</div>' +
        '<div><div style="font-size:12px;font-weight:720;color:var(--text-primary);margin-bottom:6px;">中科院分区</div>' + rankList(journalQuality.casZones || []) + '</div>' +
      '</div>' +
      '<div style="margin-bottom:12px;">' +
        '<div style="font-size:12px;font-weight:720;color:var(--text-primary);margin-bottom:6px;">来源质量</div>' +
        rankList(journalQuality.sourceLevels || []) +
      '</div>' +
      simpleTable(
        ['期刊', 'IF', '文献数'],
        (journalQuality.topImpactFactorJournals || []).slice(0, 8).map(function(item) { return [item.journal, item.impactFactor, item.count]; }),
        journalQuality.note || '当前缺少期刊质量字段。'
      );
  }

  function renderKeywordMergePanel(topKeywords) {
    var config = bibliometricsState.keywordMerges || { mergedTags: [], promotedTags: [] };
    var candidates = bibliometricsState.keywordMergeCandidates && bibliometricsState.keywordMergeCandidates.length
      ? bibliometricsState.keywordMergeCandidates
      : (topKeywords || []);
    var mergedTags = config.mergedTags || [];
    return '' +
      '<div style="margin-bottom:12px;">' + keywordTagSourceBlock((bibliometricsState.analysis || {}).keywordTagSource || {}) + '</div>' +
      '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--modal-bg);padding:10px;margin-bottom:12px;">' +
        '<div style="font-size:12px;color:var(--text-secondary);line-height:1.65;margin-bottom:8px;">勾选同义词或大小写变体，输入合并后的主关键词。保存后会重算共现网络、主题簇、年际趋势和图表包。</div>' +
        '<input id="bibliometricsKeywordMergeName" placeholder="合并后主关键词，如 nitrous oxide" style="width:100%;height:30px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);padding:0 9px;font-size:12px;margin-bottom:8px;">' +
        '<div style="max-height:230px;overflow:auto;border:1px solid rgba(127,127,127,0.16);border-radius:6px;padding:6px;margin-bottom:8px;">' +
          (candidates.length ? candidates.slice(0, 80).map(function(row) {
            var label = row.label || row.keyword || '';
            return '<label style="display:grid;grid-template-columns:18px minmax(0,1fr) 44px;gap:7px;align-items:center;padding:5px 3px;font-size:12px;color:var(--text-primary);cursor:pointer;">' +
              '<input class="bibliometricsKeywordMergeOption" type="checkbox" value="' + attr(label) + '">' +
              '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escape(label) + '</span>' +
              '<span style="text-align:right;color:var(--text-secondary);">' + escape(row.count || 0) + '</span>' +
            '</label>';
          }).join('') : '<div style="font-size:12px;color:var(--text-secondary);line-height:1.7;">暂无可合并关键词。</div>') +
        '</div>' +
        '<div style="display:flex;gap:7px;align-items:center;">' +
          '<button type="button" onclick="applyBibliometricKeywordMerge()" style="height:29px;padding:0 10px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">合并为主标签</button>' +
          '<button type="button" onclick="resetBibliometricKeywordMerges()" style="height:29px;padding:0 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">重置全部</button>' +
        '</div>' +
      '</div>' +
      '<div style="font-size:12px;font-weight:720;color:var(--text-primary);margin-bottom:7px;">已保存合并规则</div>' +
      (mergedTags.length ? '<div style="display:flex;flex-direction:column;gap:8px;">' + mergedTags.map(function(tag) {
        return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--modal-bg);padding:8px;min-width:0;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
            '<div style="font-size:12px;font-weight:750;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escape(tag.name) + '</div>' +
            '<button type="button" onclick="deleteBibliometricKeywordMerge(' + attr(JSON.stringify(tag.name || '')) + ')" style="height:24px;padding:0 7px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-secondary);cursor:pointer;font-size:11px;">删除</button>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--text-secondary);line-height:1.55;margin-top:5px;">' + escape((tag.originalKeywords || []).join('；')) + '</div>' +
          '<div style="font-size:11px;color:var(--accent-color);margin-top:5px;">命中文献 ' + escape(tag.count || 0) + ' 篇</div>' +
        '</div>';
      }).join('') + '</div>' : '<div style="font-size:12px;color:var(--text-secondary);line-height:1.7;">尚未保存人工合并规则。</div>') +
      '<div style="margin-top:12px;">' +
        '<div style="font-size:12px;font-weight:720;color:var(--text-primary);margin-bottom:7px;">当前 Top 关键词</div>' +
        rankList(topKeywords || []) +
      '</div>';
  }

  function keywordTagSourceBlock(source) {
    var mode = source.mode === 'merged-tags' ? '合并标签' : '原始关键词';
    return '' +
      '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px;">' +
        metricMini('模式', mode) +
        metricMini('合并标签', source.mergedTagCount || 0) +
        metricMini('命中文献', source.mergedTaggedLiteratureCount || 0) +
      '</div>' +
      '<div style="font-size:12px;line-height:1.75;color:var(--text-secondary);">' + escape(source.note || '当前使用文献原始关键词。') + '</div>';
  }

  function metricMini(label, value) {
    return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--modal-bg);padding:8px;min-width:0;">' +
      '<div style="font-size:10px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escape(label) + '</div>' +
      '<div style="font-size:15px;font-weight:760;color:var(--text-primary);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escape(value) + '</div>' +
    '</div>';
  }

  function drawBibliometricCanvases() {
    drawYearChart();
    drawKeywordTrendChart();
    drawNetworkCanvases();
  }

  function drawYearChart() {
    var canvas = document.getElementById('bibliometricsYearChart');
    var analysis = bibliometricsState.analysis;
    if (!canvas || !analysis) return;
    var rows = analysis.yearTrend || [];
    drawBars(canvas, rows.map(function(row) { return { label: String(row.year), value: row.count }; }));
  }

  function drawKeywordTrendChart() {
    var canvas = document.getElementById('bibliometricsKeywordTrendChart');
    var analysis = bibliometricsState.analysis;
    if (!canvas || !analysis) return;
    var series = analysis.keywordYearTrends || [];
    var ctx = prepareCanvas(canvas);
    if (!ctx) return;
    var rect = canvas.getBoundingClientRect();
    var width = rect.width;
    var height = rect.height;
    ctx.clearRect(0, 0, width, height);
    var text = cssVar('--text-secondary');
    ctx.fillStyle = text;
    ctx.font = '12px sans-serif';
    if (!series.length) {
      ctx.fillText('暂无关键词年际趋势', 18, 28);
      return;
    }

    var years = [];
    series.forEach(function(item) {
      (item.points || []).forEach(function(point) {
        if (years.indexOf(point.year) === -1) years.push(point.year);
      });
    });
    years.sort(function(a, b) { return a - b; });
    var max = Math.max.apply(null, series.flatMap(function(item) {
      return (item.points || []).map(function(point) { return point.count || 0; });
    })) || 1;
    var padding = { left: 46, right: 130, top: 20, bottom: 42 };
    var chartW = Math.max(10, width - padding.left - padding.right);
    var chartH = Math.max(10, height - padding.top - padding.bottom);

    ctx.strokeStyle = 'rgba(127,127,127,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartH);
    ctx.lineTo(padding.left + chartW, padding.top + chartH);
    ctx.stroke();

    [0.25, 0.5, 0.75, 1].forEach(function(rate) {
      var y = padding.top + chartH - chartH * rate;
      ctx.strokeStyle = 'rgba(127,127,127,0.10)';
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();
    });

    series.slice(0, 8).forEach(function(item, index) {
      var color = networkColor('keyword', index);
      var pointByYear = {};
      (item.points || []).forEach(function(point) { pointByYear[point.year] = point; });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      years.forEach(function(year, yearIndex) {
        var point = pointByYear[year] || { count: 0 };
        var x = padding.left + (years.length <= 1 ? chartW / 2 : chartW * yearIndex / (years.length - 1));
        var y = padding.top + chartH - chartH * ((point.count || 0) / max);
        if (yearIndex === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      years.forEach(function(year, yearIndex) {
        var point = pointByYear[year] || { count: 0 };
        var x = padding.left + (years.length <= 1 ? chartW / 2 : chartW * yearIndex / (years.length - 1));
        var y = padding.top + chartH - chartH * ((point.count || 0) / max);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
      var legendY = padding.top + index * 23;
      ctx.fillStyle = color;
      ctx.fillRect(padding.left + chartW + 20, legendY + 2, 10, 10);
      ctx.fillStyle = text;
      var label = item.keyword || '';
      if (label.length > 16) label = label.slice(0, 15) + '…';
      ctx.fillText(label, padding.left + chartW + 36, legendY + 12);
    });

    ctx.fillStyle = text;
    ctx.textAlign = 'right';
    ctx.fillText(String(max), padding.left - 8, padding.top + 4);
    ctx.fillText('0', padding.left - 8, padding.top + chartH + 4);
    ctx.textAlign = 'center';
    years.forEach(function(year, index) {
      if (years.length > 14 && index % Math.ceil(years.length / 10) !== 0) return;
      var x = padding.left + (years.length <= 1 ? chartW / 2 : chartW * index / (years.length - 1));
      ctx.save();
      ctx.translate(x, padding.top + chartH + 17);
      ctx.rotate(-Math.PI / 6);
      ctx.fillText(String(year), 0, 0);
      ctx.restore();
    });
    ctx.textAlign = 'left';
  }

  function drawBars(canvas, rows) {
    var ctx = prepareCanvas(canvas);
    if (!ctx) return;
    var rect = canvas.getBoundingClientRect();
    var width = rect.width;
    var height = rect.height;
    var text = cssVar('--text-secondary');
    var accent = cssVar('--accent-color');
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = text;
    ctx.font = '12px sans-serif';
    if (!rows.length) {
      ctx.fillText('暂无年份数据', 18, 28);
      return;
    }
    var padding = { left: 44, right: 18, top: 18, bottom: 42 };
    var max = Math.max.apply(null, rows.map(function(row) { return row.value || 0; })) || 1;
    var chartW = width - padding.left - padding.right;
    var chartH = height - padding.top - padding.bottom;
    var barGap = Math.max(2, Math.min(8, chartW / rows.length * 0.18));
    var barW = Math.max(3, (chartW - barGap * Math.max(0, rows.length - 1)) / rows.length);
    ctx.strokeStyle = 'rgba(127,127,127,0.22)';
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartH);
    ctx.lineTo(padding.left + chartW, padding.top + chartH);
    ctx.stroke();
    rows.forEach(function(row, index) {
      var h = Math.max(2, chartH * ((row.value || 0) / max));
      var x = padding.left + index * (barW + barGap);
      var y = padding.top + chartH - h;
      ctx.fillStyle = accent;
      ctx.fillRect(x, y, barW, h);
      if (rows.length <= 24 || index % Math.ceil(rows.length / 16) === 0) {
        ctx.save();
        ctx.translate(x + barW / 2, padding.top + chartH + 15);
        ctx.rotate(-Math.PI / 5);
        ctx.fillStyle = text;
        ctx.textAlign = 'right';
        ctx.fillText(row.label, 0, 0);
        ctx.restore();
      }
    });
    ctx.fillStyle = text;
    ctx.textAlign = 'right';
    ctx.fillText(String(max), padding.left - 8, padding.top + 4);
    ctx.fillText('0', padding.left - 8, padding.top + chartH + 4);
  }

  function drawNetworkCanvases() {
    var canvases = Array.prototype.slice.call(document.querySelectorAll('[data-bibliometrics-network="1"]'));
    var legacy = document.getElementById('bibliometricsNetworkCanvas');
    if (!canvases.length && legacy) canvases = [legacy];
    canvases.forEach(function(canvas) { drawNetworkCanvas(canvas); });
  }

  function drawNetworkCanvas(canvas) {
    var analysis = bibliometricsState.analysis;
    if (!canvas || !analysis) return;
    var kind = canvas.getAttribute('data-kind') || 'keyword';
    var network = getBibliometricNetwork(kind);
    if (!network) return;
    var ctx = prepareCanvas(canvas);
    if (!ctx) return;
    var rect = canvas.getBoundingClientRect();
    var width = rect.width;
    var height = rect.height;
    ctx.clearRect(0, 0, width, height);
    var nodes = (network.nodes || []).slice(0, 90);
    var edges = network.edges || [];
    if (!nodes.length) return;
    var layout = getNetworkLayout(kind, network, width, height);
    var byId = layout.points;
    attachNetworkDragHandlers(canvas, kind);
    drawNetworkBackground(ctx, width, height);
    var maxWeight = Math.max.apply(null, edges.map(function(edge) { return edge.weight || 1; })) || 1;
    var hoverId = bibliometricsState.networkHover[kind] || '';
    var connectedIds = getConnectedNodeIds(hoverId, edges);
    ctx.lineCap = 'round';
    edges.forEach(function(edge) {
      var a = byId[edge.source];
      var b = byId[edge.target];
      if (!a || !b) return;
      var related = !hoverId || edge.source === hoverId || edge.target === hoverId;
      var alpha = related ? 0.18 + 0.42 * ((edge.weight || 1) / maxWeight) : 0.045;
      ctx.strokeStyle = networkStrokeColor(kind, alpha);
      ctx.lineWidth = (related ? 0.9 : 0.45) + 3.2 * ((edge.weight || 1) / maxWeight);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      var mx = (a.x + b.x) / 2;
      var my = (a.y + b.y) / 2;
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var curve = Math.min(38, Math.sqrt(dx * dx + dy * dy) * 0.08);
      ctx.quadraticCurveTo(mx - dy * curve / 120, my + dx * curve / 120, b.x, b.y);
      ctx.stroke();
    });
    nodes.forEach(function(node) {
      var p = byId[node.id];
      if (!p) return;
      var related = !hoverId || node.id === hoverId || connectedIds[node.id];
      var fill = related ? p.color : 'rgba(148,163,184,0.46)';
      ctx.shadowColor = related ? 'rgba(0,0,0,0.22)' : 'transparent';
      ctx.shadowBlur = related ? 8 : 0;
      ctx.shadowOffsetY = related ? 2 : 0;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = node.id === hoverId ? '#ffffff' : 'rgba(255,255,255,0.72)';
      ctx.lineWidth = node.id === hoverId ? 2.4 : 1;
      ctx.stroke();
    });
    nodes
      .slice()
      .sort(function(a, b) { return (b.value || 0) - (a.value || 0); })
      .slice(0, hoverId ? 90 : 24)
      .forEach(function(node) {
        var p = byId[node.id];
        if (!p) return;
        if (hoverId && node.id !== hoverId && !connectedIds[node.id]) return;
        var label = node.label || node.id;
        if (label.length > 22) label = label.slice(0, 21) + '…';
        drawNetworkLabel(ctx, label, p.x, p.y - p.r - 7, node.id === hoverId);
      });
  }

  function getNetworkLayout(kind, network, width, height) {
    var nodes = (network.nodes || []).slice(0, 90);
    var edges = network.edges || [];
    var signature = kind + ':' + nodes.map(function(node) { return node.id + ':' + (node.value || 0); }).join('|') + ':' + edges.length;
    var existing = bibliometricsState.networkLayouts[kind];
    if (existing && existing.signature === signature) {
      scaleNetworkLayout(existing, width, height);
      updateNetworkPointStyles(existing, nodes, edges, kind);
      return existing;
    }

    var groups = assignNetworkGroups(nodes, edges);
    var maxValue = Math.max.apply(null, nodes.map(function(node) { return node.value || 1; })) || 1;
    var points = {};
    nodes
      .slice()
      .sort(function(a, b) { return (b.value || 0) - (a.value || 0); })
      .forEach(function(node, index) {
        var seed = seededUnit(node.id || String(index));
        var angle = Math.PI * 2 * index / Math.max(1, nodes.length) - Math.PI / 2 + seed * 0.42;
        var ring = 0.28 + 0.52 * ((index % 11) / 10);
        var radius = Math.min(width, height) * ring;
        points[node.id] = {
          node: node,
          x: width / 2 + Math.cos(angle) * radius * 0.72,
          y: height / 2 + Math.sin(angle) * radius * 0.62,
          vx: 0,
          vy: 0,
          r: 6 + Math.sqrt((node.value || 1) / maxValue) * 15,
          group: groups[node.id] || 0,
          color: networkColor(kind, groups[node.id] || 0)
        };
      });

    var layout = { signature: signature, width: width, height: height, points: points };
    runForceLayout(layout, edges, width, height);
    bibliometricsState.networkLayouts[kind] = layout;
    return layout;
  }

  function scaleNetworkLayout(layout, width, height) {
    if (!layout.width || !layout.height || (layout.width === width && layout.height === height)) return;
    var sx = width / layout.width;
    var sy = height / layout.height;
    Object.keys(layout.points).forEach(function(id) {
      layout.points[id].x *= sx;
      layout.points[id].y *= sy;
    });
    layout.width = width;
    layout.height = height;
  }

  function updateNetworkPointStyles(layout, nodes, edges, kind) {
    var groups = assignNetworkGroups(nodes, edges);
    var maxValue = Math.max.apply(null, nodes.map(function(node) { return node.value || 1; })) || 1;
    nodes.forEach(function(node) {
      var point = layout.points[node.id];
      if (!point) return;
      point.node = node;
      point.r = 6 + Math.sqrt((node.value || 1) / maxValue) * 15;
      point.group = groups[node.id] || 0;
      point.color = networkColor(kind, point.group);
    });
  }

  function runForceLayout(layout, edges, width, height) {
    var points = Object.keys(layout.points).map(function(id) { return layout.points[id]; });
    var edgeList = edges.filter(function(edge) { return layout.points[edge.source] && layout.points[edge.target]; });
    var centerX = width / 2;
    var centerY = height / 2;
    for (var iter = 0; iter < 120; iter += 1) {
      for (var i = 0; i < points.length; i += 1) {
        for (var j = i + 1; j < points.length; j += 1) {
          var a = points[i];
          var b = points[j];
          var dx = a.x - b.x;
          var dy = a.y - b.y;
          var d2 = Math.max(60, dx * dx + dy * dy);
          var d = Math.sqrt(d2);
          var repulse = 900 / d2;
          var fx = dx / d * repulse;
          var fy = dy / d * repulse;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }

      edgeList.forEach(function(edge) {
        var a = layout.points[edge.source];
        var b = layout.points[edge.target];
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        var desired = 82 + Math.max(0, 8 - (edge.weight || 1)) * 7;
        var pull = (d - desired) * 0.006 * Math.min(4, edge.weight || 1);
        var fx = dx / d * pull;
        var fy = dy / d * pull;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      });

      points.forEach(function(point) {
        point.vx += (centerX - point.x) * 0.002;
        point.vy += (centerY - point.y) * 0.002;
        point.vx *= 0.82;
        point.vy *= 0.82;
        point.x = clamp(point.x + point.vx, 26, width - 26);
        point.y = clamp(point.y + point.vy, 26, height - 26);
      });
    }
  }

  function assignNetworkGroups(nodes, edges) {
    var adjacency = {};
    nodes.forEach(function(node) { adjacency[node.id] = []; });
    edges.forEach(function(edge) {
      if (!adjacency[edge.source] || !adjacency[edge.target]) return;
      adjacency[edge.source].push(edge.target);
      adjacency[edge.target].push(edge.source);
    });

    var visited = {};
    var groups = {};
    var groupIndex = 0;
    nodes.forEach(function(node) {
      if (visited[node.id]) return;
      var stack = [node.id];
      visited[node.id] = true;
      while (stack.length) {
        var current = stack.pop();
        groups[current] = groupIndex;
        (adjacency[current] || []).forEach(function(next) {
          if (!visited[next]) {
            visited[next] = true;
            stack.push(next);
          }
        });
      }
      groupIndex += 1;
    });
    return groups;
  }

  function attachNetworkDragHandlers(canvas, kind) {
    if (canvas._bibliometricsDragAttached) return;
    canvas._bibliometricsDragAttached = true;

    canvas.addEventListener('mousedown', function(event) {
      var hit = findNetworkNodeAt(canvas, kind, event);
      if (!hit) return;
      event.preventDefault();
      bibliometricsState.networkDrag = {
        kind: kind,
        nodeId: hit.id,
        offsetX: hit.offsetX,
        offsetY: hit.offsetY
      };
      bibliometricsState.networkHover[kind] = hit.id;
      canvas.style.cursor = 'grabbing';
      drawNetworkCanvas(canvas);
    });

    canvas.addEventListener('mousemove', function(event) {
      var drag = bibliometricsState.networkDrag;
      var point = getCanvasPoint(event, canvas);
      if (drag && drag.kind === kind) {
        var layout = bibliometricsState.networkLayouts[kind];
        var draggingPoint = layout && layout.points[drag.nodeId];
        if (draggingPoint) {
          draggingPoint.x = clamp(point.x - drag.offsetX, 18, canvas.getBoundingClientRect().width - 18);
          draggingPoint.y = clamp(point.y - drag.offsetY, 18, canvas.getBoundingClientRect().height - 18);
          draggingPoint.vx = 0;
          draggingPoint.vy = 0;
          drawNetworkCanvas(canvas);
        }
        return;
      }

      var hit = findNetworkNodeAt(canvas, kind, event);
      var nextHover = hit ? hit.id : '';
      if ((bibliometricsState.networkHover[kind] || '') !== nextHover) {
        bibliometricsState.networkHover[kind] = nextHover;
        canvas.style.cursor = nextHover ? 'grab' : 'default';
        drawNetworkCanvas(canvas);
      }
    });

    canvas.addEventListener('mouseleave', function() {
      if (bibliometricsState.networkDrag) return;
      bibliometricsState.networkHover[kind] = '';
      canvas.style.cursor = 'grab';
      drawNetworkCanvas(canvas);
    });

    window.addEventListener('mouseup', function() {
      var drag = bibliometricsState.networkDrag;
      if (!drag || drag.kind !== kind) return;
      bibliometricsState.networkDrag = null;
      canvas.style.cursor = 'grab';
      drawNetworkCanvas(canvas);
    });
  }

  function findNetworkNodeAt(canvas, kind, event) {
    var layout = bibliometricsState.networkLayouts[kind];
    if (!layout) return null;
    var mouse = getCanvasPoint(event, canvas);
    var points = Object.keys(layout.points).map(function(id) { return layout.points[id]; })
      .sort(function(a, b) { return b.r - a.r; });
    for (var i = 0; i < points.length; i += 1) {
      var point = points[i];
      var dx = mouse.x - point.x;
      var dy = mouse.y - point.y;
      var radius = Math.max(point.r + 5, 13);
      if (dx * dx + dy * dy <= radius * radius) {
        return {
          id: point.node.id,
          offsetX: mouse.x - point.x,
          offsetY: mouse.y - point.y
        };
      }
    }
    return null;
  }

  function getCanvasPoint(event, canvas) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function getConnectedNodeIds(nodeId, edges) {
    var connected = {};
    if (!nodeId) return connected;
    edges.forEach(function(edge) {
      if (edge.source === nodeId) connected[edge.target] = true;
      if (edge.target === nodeId) connected[edge.source] = true;
    });
    connected[nodeId] = true;
    return connected;
  }

  function drawNetworkBackground(ctx, width, height) {
    var bg = ctx.createRadialGradient(width * 0.5, height * 0.42, 20, width * 0.5, height * 0.5, Math.max(width, height) * 0.68);
    bg.addColorStop(0, 'rgba(0,136,110,0.10)');
    bg.addColorStop(1, 'rgba(127,127,127,0.02)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(127,127,127,0.10)';
    ctx.lineWidth = 1;
    for (var x = 36; x < width; x += 72) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (var y = 36; y < height; y += 72) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  function drawNetworkLabel(ctx, text, x, y, active) {
    ctx.font = active ? '700 12px sans-serif' : '12px sans-serif';
    var paddingX = 5;
    var paddingY = 3;
    var width = ctx.measureText(text).width + paddingX * 2;
    var height = 18;
    var left = x - width / 2;
    var top = y - height;
    ctx.fillStyle = active ? 'rgba(0,136,110,0.92)' : 'rgba(32,33,35,0.78)';
    roundRect(ctx, left, top, width, height, 5);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, top + height / 2 + paddingY * 0.15);
    ctx.textBaseline = 'alphabetic';
  }

  function roundRect(ctx, x, y, width, height, radius) {
    var r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function networkColor(kind, group) {
    var keywordPalette = ['#00886e', '#0f766e', '#059669', '#2563eb', '#7c3aed', '#d97706', '#be123c', '#0891b2'];
    var authorPalette = ['#2563eb', '#4f46e5', '#0891b2', '#7c3aed', '#0f766e', '#b45309', '#be123c', '#475569'];
    var literaturePalette = ['#7c3aed', '#9333ea', '#2563eb', '#0891b2', '#00886e', '#d97706', '#be123c', '#475569'];
    var referencePalette = ['#be123c', '#e11d48', '#b45309', '#7c3aed', '#2563eb', '#0f766e', '#64748b', '#0891b2'];
    var collaborationPalette = ['#0f766e', '#00886e', '#059669', '#0891b2', '#2563eb', '#4f46e5', '#b45309', '#475569'];
    var palette = keywordPalette;
    if (kind === 'author') palette = authorPalette;
    else if (kind === 'similarity' || kind === 'coupling') palette = literaturePalette;
    else if (kind === 'coCitation') palette = referencePalette;
    else if (kind === 'institution' || kind === 'country') palette = collaborationPalette;
    return palette[group % palette.length];
  }

  function networkStrokeColor(kind, alpha) {
    if (kind === 'author') return 'rgba(37,99,235,' + alpha + ')';
    if (kind === 'similarity' || kind === 'coupling') return 'rgba(124,58,237,' + alpha + ')';
    if (kind === 'coCitation') return 'rgba(190,18,60,' + alpha + ')';
    if (kind === 'institution' || kind === 'country') return 'rgba(15,118,110,' + alpha + ')';
    return 'rgba(0,136,110,' + alpha + ')';
  }

  function seededUnit(value) {
    var hash = 0;
    var text = String(value || '');
    for (var i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return Math.abs(hash % 1000) / 1000;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function prepareCanvas(canvas) {
    var ratio = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return ctx;
  }

  function bibliometricsQuery(extra) {
    var query = 'userId=' + encodeURIComponent(window.currentUserId || 'web-user') +
      '&topN=25&keywordNodeLimit=90&authorNodeLimit=70&edgeLimit=220&similarityNodeLimit=80&similarityEdgeLimit=180&keywordTrendLimit=8';
    return extra ? query + '&' + extra : query;
  }

  window.downloadBibliometricsExcel = function() {
    var url = '/api/bibliometrics/export?userId=' + encodeURIComponent(window.currentUserId || 'web-user') + '&topN=100&keywordNodeLimit=120&authorNodeLimit=100&edgeLimit=400&similarityNodeLimit=120&similarityEdgeLimit=300&keywordTrendLimit=12';
    window.location.href = url;
  };

  window.downloadBibliometricsDatabaseExcel = function() {
    window.location.href = '/api/bibliometrics/dataset/export?userId=' + encodeURIComponent(window.currentUserId || 'web-user');
  };

  window.downloadBibliometricsFiguresZip = function() {
    window.location.href = '/api/bibliometrics/artifacts/download?userId=' + encodeURIComponent(window.currentUserId || 'web-user') + '&topN=100&keywordNodeLimit=120&authorNodeLimit=100&edgeLimit=400&similarityNodeLimit=120&similarityEdgeLimit=300&keywordTrendLimit=12';
  };

  window.uploadBibliometricsWosTxt = function() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,text/plain';
    input.multiple = true;
    input.onchange = async function() {
      var files = Array.prototype.slice.call(input.files || []);
      if (!files.length) return;
      await uploadBibliometricsFiles(files, 'append');
    };
    input.click();
  };

  async function uploadBibliometricsFiles(files, mode) {
    var content = document.getElementById('bibliometricsContent');
    var subtitle = document.getElementById('bibliometricsSubtitle');
    if (subtitle) subtitle.textContent = '正在导入 ' + files.length + ' 个 WoS TXT 文件...';
    if (content) {
      content.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);">正在解析 Full Record and Cited References...</div>';
    }
    var formData = new FormData();
    formData.append('userId', window.currentUserId || 'web-user');
    formData.append('mode', mode || 'append');
    files.forEach(function(file) {
      formData.append('files', file);
    });
    try {
      var response = await fetch('/api/bibliometrics/upload', {
        method: 'POST',
        body: formData
      });
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '导入失败');
      applyBibliometricsServerData(data);
      bibliometricsState.activeTab = 'overview';
      renderBibliometrics();
    } catch (e) {
      if (subtitle) subtitle.textContent = '导入失败';
      if (content) content.innerHTML = '<div style="padding:18px;color:var(--danger-color);">导入失败：' + escape(e.message) + '</div>';
    }
  }

  window.uploadBibliometricsJournalQualityTable = function() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    input.onchange = async function() {
      var file = input.files && input.files[0];
      if (!file) return;
      await uploadJournalQualityTableFile(file);
    };
    input.click();
  };

  async function uploadJournalQualityTableFile(file) {
    var content = document.getElementById('bibliometricsContent');
    var subtitle = document.getElementById('bibliometricsSubtitle');
    if (subtitle) subtitle.textContent = '正在导入期刊质量表...';
    if (content) {
      content.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);">正在匹配 ISSN 和期刊名称...</div>';
    }
    var formData = new FormData();
    formData.append('userId', window.currentUserId || 'web-user');
    formData.append('file', file);
    try {
      var response = await fetch('/api/bibliometrics/journal-quality/upload', {
        method: 'POST',
        body: formData
      });
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '期刊质量表导入失败');
      applyBibliometricsServerData(data);
      bibliometricsState.activeTab = 'quality';
      renderBibliometrics();
    } catch (e) {
      if (subtitle) subtitle.textContent = '期刊质量表导入失败';
      if (content) content.innerHTML = '<div style="padding:18px;color:var(--danger-color);">导入失败：' + escape(e.message || e) + '</div>';
    }
  }

  window.downloadBuiltInBibliometricsJournalQuality = async function() {
    var content = document.getElementById('bibliometricsContent');
    var subtitle = document.getElementById('bibliometricsSubtitle');
    if (subtitle) subtitle.textContent = '正在下载内置开放期刊质量来源...';
    if (content) {
      content.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);">正在下载 NLM/PubMed 期刊目录并匹配当前数据库...</div>';
    }
    try {
      var response = await fetch('/api/bibliometrics/journal-quality/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: window.currentUserId || 'web-user',
          sources: ['nlm-pubmed']
        })
      });
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '内置期刊质量来源下载失败');
      applyBibliometricsServerData(data);
      bibliometricsState.activeTab = 'quality';
      renderBibliometrics();
      var failed = data.failed || [];
      if (failed.length) {
        alert('部分来源下载失败：' + failed.map(function(item) { return item.source + ' ' + item.error; }).join('；'));
      }
    } catch (e) {
      if (subtitle) subtitle.textContent = '内置期刊质量来源下载失败';
      if (content) content.innerHTML = '<div style="padding:18px;color:var(--danger-color);">下载失败：' + escape(e.message || e) + '</div>';
    }
  };

  window.clearBibliometricsJournalQualityTable = async function() {
    if (!confirm('确定清除当前外部期刊质量表吗？')) return;
    try {
      var response = await fetch('/api/bibliometrics/journal-quality?userId=' + encodeURIComponent(window.currentUserId || 'web-user'), {
        method: 'DELETE'
      });
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '清除失败');
      applyBibliometricsServerData(data);
      bibliometricsState.activeTab = 'quality';
      renderBibliometrics();
    } catch (e) {
      alert('清除失败：' + (e.message || e));
    }
  };

  function getBibliometricsApiConfig() {
    try {
      if (window.loadApiConfig) window.loadApiConfig();
      var raw = localStorage.getItem('scholarclaw_api');
      var parsed = raw ? JSON.parse(raw) : {};
      return {
        url: parsed.url || parsed.apiUrl || '',
        key: parsed.key || parsed.apiKey || '',
        model: parsed.model || window.currentModel || 'qwen3.5-plus'
      };
    } catch (_e) {
      return { url: '', key: '', model: 'qwen3.5-plus' };
    }
  }

  function closeBibliometricsJournalStyleDialog() {
    var modal = document.getElementById('bibliometricsJournalStyleModal');
    if (modal) modal.remove();
  }
  window.closeBibliometricsJournalStyleDialog = closeBibliometricsJournalStyleDialog;

  window.showBibliometricsJournalStyleDialog = function() {
    var api = getBibliometricsApiConfig();
    var existing = document.getElementById('bibliometricsJournalStyleModal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'bibliometricsJournalStyleModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.66);display:flex;align-items:center;justify-content:center;z-index:10050;padding:20px;';
    modal.onclick = function(event) {
      if (event.target === modal) closeBibliometricsJournalStyleDialog();
    };
    modal.innerHTML =
      '<div id="bibliometricsJournalStylePanel" style="width:min(760px,96vw);max-height:92vh;overflow:auto;background:var(--modal-bg);border:1px solid var(--modal-border);border-radius:8px;box-shadow:0 18px 60px rgba(0,0,0,0.38);padding:18px;" onclick="event.stopPropagation()">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;">' +
          '<div style="min-width:0;">' +
            '<div style="font-size:16px;font-weight:760;color:var(--text-primary);">文献计量期刊写作风格提取</div>' +
            '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-top:4px;">上传目标期刊或同类文献计量文章，系统会提取可用于一键写作的结构套路、图表解释方式和常用表达。</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center;flex:0 0 auto;">' +
            '<button id="bibliometricsJournalStyleFullscreenBtn" class="modal-icon-btn" type="button" onclick="toggleCustomModalFullscreen(\'bibliometricsJournalStyleModal\',\'bibliometricsJournalStylePanel\',\'bibliometricsJournalStyleFullscreenBtn\')" title="全屏" aria-label="全屏"><svg class="ui-icon sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5"></path><path d="M16 3h5v5"></path><path d="M21 16v5h-5"></path><path d="M3 16v5h5"></path></svg></button>' +
            '<button type="button" onclick="closeBibliometricsJournalStyleDialog()" style="width:30px;height:30px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-secondary);cursor:pointer;">×</button>' +
          '</div>' +
        '</div>' +
        (!api.url || !api.key ? '<div style="border:1px solid var(--danger-color);border-radius:8px;background:rgba(239,68,68,0.08);color:var(--danger-color);font-size:12px;line-height:1.7;padding:10px;margin-bottom:12px;">未检测到 API 配置。请先在 API 设置中配置 API URL 和 Key，否则无法调用 AI 提取风格。</div>' : '') +
        '<div style="display:grid;grid-template-columns:minmax(0,1fr);gap:10px;margin-bottom:12px;">' +
          '<input id="bibliometricsStyleFiles" type="file" multiple accept=".txt,.ris,.bib,.json,.pdf,.doc,.docx" style="width:100%;height:38px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);padding:7px;font-size:12px;">' +
          '<input id="bibliometricsStyleJournalName" type="text" placeholder="目标期刊名称，如 Scientometrics、Agronomy、Science of the Total Environment" style="width:100%;height:34px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);padding:0 10px;font-size:12px;">' +
          '<input id="bibliometricsStyleGuidelinesUrl" type="url" placeholder="期刊官网 Author Guidelines URL（可选）" style="width:100%;height:34px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);padding:0 10px;font-size:12px;">' +
          '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary);line-height:1.5;">' +
            '<input id="bibliometricsStyleAutoCrawl" type="checkbox" checked style="width:14px;height:14px;">' +
            '<span>自动爬取 Author Guidelines、Instructions for Authors、Submission Guidelines 和 Cover Letter 要求</span>' +
          '</label>' +
          '<textarea id="bibliometricsStyleGuidelinesText" rows="4" placeholder="可粘贴 Author Guidelines / Instructions for Authors / Submission Guidelines 文本" style="width:100%;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);padding:9px 10px;font-size:12px;line-height:1.55;resize:vertical;"></textarea>' +
          '<textarea id="bibliometricsStyleCoverLetterText" rows="3" placeholder="可粘贴 Cover Letter 要求、模板或投稿信注意事项" style="width:100%;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);padding:9px 10px;font-size:12px;line-height:1.55;resize:vertical;"></textarea>' +
        '</div>' +
        '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:12px;margin-bottom:12px;">' +
          '<div style="font-size:12px;font-weight:740;color:var(--text-primary);margin-bottom:8px;">本次会提取的文献计量写作套路</div>' +
          noteList([
            '选题切口：为什么这个领域需要文献计量？',
            '引言套路：背景问题、文献增长、缺少系统知识图谱、本文贡献。',
            '数据与方法：数据库、检索式、时间范围、筛选规则、软件、指标。',
            '结果顺序：年度发文、国家/机构/作者/期刊、高被引文献、关键词共现、聚类、突现、演化。',
            '讨论套路：热点解释、阶段变化、研究缺口、未来方向。',
            '图表配置：每一部分放什么图，图后怎么解释。',
            '可复用句式：摘要、方法、结果、讨论里的常用表达。'
          ]) +
        '</div>' +
        '<div id="bibliometricsStyleProgress" style="display:none;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:12px;margin-bottom:12px;">' +
          '<div id="bibliometricsStyleProgressText" style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:8px;">正在准备...</div>' +
          '<div style="height:8px;background:rgba(127,127,127,0.18);border-radius:99px;overflow:hidden;margin-bottom:8px;"><div id="bibliometricsStyleProgressBar" style="height:100%;width:0%;background:#000000;transition:width 0.25s ease;"></div></div>' +
          '<div id="bibliometricsStyleProgressLog" style="max-height:150px;overflow:auto;font-size:11px;line-height:1.65;color:var(--text-secondary);"></div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;">' +
          '<button type="button" onclick="closeBibliometricsJournalStyleDialog()" style="height:32px;padding:0 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">取消</button>' +
          (!api.url || !api.key ? '<button type="button" onclick="window.showConnectDialog ? (closeBibliometricsJournalStyleDialog(), window.showConnectDialog()) : alert(\'请先打开 API 设置\')" style="height:32px;padding:0 12px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;">配置 API</button>' : '') +
          '<button type="button" onclick="runBibliometricsJournalStyleExtraction()" style="height:32px;padding:0 12px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;">开始提取</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
  };

  window.runBibliometricsJournalStyleExtraction = async function() {
    var api = getBibliometricsApiConfig();
    if (!api.url || !api.key) {
      alert('请先配置 API URL 和 Key。');
      return;
    }
    var fileInput = document.getElementById('bibliometricsStyleFiles');
    var files = fileInput && fileInput.files ? Array.prototype.slice.call(fileInput.files) : [];
    var journalName = (document.getElementById('bibliometricsStyleJournalName')?.value || '').trim();
    var guidelinesUrl = (document.getElementById('bibliometricsStyleGuidelinesUrl')?.value || '').trim();
    var autoCrawl = document.getElementById('bibliometricsStyleAutoCrawl')?.checked !== false;
    var guidelinesText = (document.getElementById('bibliometricsStyleGuidelinesText')?.value || '').trim();
    var coverLetterText = (document.getElementById('bibliometricsStyleCoverLetterText')?.value || '').trim();
    if (!files.length && !journalName && !guidelinesUrl && !guidelinesText && !coverLetterText) {
      alert('请至少上传一篇样例文章，或填写期刊名称/Author Guidelines/Cover Letter 要求。');
      return;
    }

    var progress = document.getElementById('bibliometricsStyleProgress');
    var progressText = document.getElementById('bibliometricsStyleProgressText');
    var progressBar = document.getElementById('bibliometricsStyleProgressBar');
    var progressLog = document.getElementById('bibliometricsStyleProgressLog');
    if (progress) progress.style.display = 'block';
    if (progressText) progressText.textContent = '正在上传材料并启动分析...';
    if (progressBar) progressBar.style.width = '2%';
    if (progressLog) progressLog.innerHTML = '';

    var extractionFocus = [
      '- 选题切口：为什么这个领域需要文献计量？',
      '- 引言套路：背景问题 -> 文献增长 -> 缺少系统知识图谱 -> 本文贡献。',
      '- 数据与方法：数据库、检索式、时间范围、筛选规则、软件、指标。',
      '- 结果顺序：年度发文 -> 国家/机构/作者/期刊 -> 高被引文献 -> 关键词共现 -> 聚类 -> 突现 -> 演化。',
      '- 讨论套路：热点解释 -> 阶段变化 -> 研究缺口 -> 未来方向。',
      '- 图表配置：每一部分放什么图，图后怎么解释。',
      '- 可复用句式：摘要、方法、结果、讨论里的常用表达。'
    ].join('\n');

    var formData = new FormData();
    files.slice(0, 10).forEach(function(file) {
      formData.append('files', file);
    });
    formData.append('userId', window.currentUserId || 'web-user');
    formData.append('apiUrl', api.url);
    formData.append('apiKey', api.key);
    formData.append('model', api.model || 'qwen3.5-plus');
    formData.append('styleExtractionMode', 'bibliometrics');
    formData.append('extractionFocus', extractionFocus);
    if (journalName) formData.append('journalName', journalName);
    if (guidelinesUrl) formData.append('authorGuidelinesUrl', guidelinesUrl);
    formData.append('autoCrawlGuidelines', autoCrawl ? 'true' : 'false');
    if (guidelinesText) formData.append('authorGuidelinesText', guidelinesText);
    if (coverLetterText) formData.append('coverLetterRequirements', coverLetterText);

    try {
      var response = await fetch('/api/analyze-journal-style', {
        method: 'POST',
        body: formData
      });
      if (!response.body) throw new Error('期刊风格接口没有返回进度流');
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      while (true) {
        var result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        var chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        chunks.forEach(function(chunk) {
          if (!chunk.startsWith('data: ')) return;
          var data;
          try {
            data = JSON.parse(chunk.slice(6));
          } catch (_e) {
            return;
          }
          if (data.type === 'start') {
            if (progressText) progressText.textContent = data.message || '开始分析...';
            if (progressBar) progressBar.style.width = '4%';
          } else if (data.type === 'progress') {
            if (progressText) progressText.textContent = data.message || '正在分析...';
            var percent = data.total ? Math.max(5, Math.min(92, Math.round((data.current || 0) / data.total * 86))) : 20;
            if (progressBar) progressBar.style.width = percent + '%';
          } else if (data.type === 'paper_complete') {
            if (progressText) progressText.textContent = data.message || '单篇分析完成';
            if (progressBar && data.total) progressBar.style.width = Math.max(10, Math.min(95, Math.round((data.current || 0) / data.total * 95))) + '%';
            if (progressLog) progressLog.innerHTML += '<div style="padding:4px 0;border-bottom:1px solid rgba(127,127,127,0.12);">' + escape(data.message || '') + '</div>';
          } else if (data.type === 'complete') {
            if (progressBar) progressBar.style.width = '100%';
            if (progressText) progressText.textContent = data.message || '期刊风格提取完成';
            if (progressLog) {
              progressLog.innerHTML += '<div style="padding:6px 0;color:var(--accent-color);">已保存：' + escape((data.result && data.result.folder) || 'journal-styles') + '</div>';
            }
          } else if (data.type === 'error') {
            throw new Error(data.error || '期刊风格提取失败');
          }
        });
      }
    } catch (e) {
      if (progressText) progressText.textContent = '提取失败：' + (e.message || e);
      if (progressText) progressText.style.color = 'var(--danger-color)';
      alert('提取失败：' + (e.message || e));
    }
  };

  window.applyBibliometricKeywordMerge = async function() {
    var checked = Array.prototype.slice.call(document.querySelectorAll('.bibliometricsKeywordMergeOption:checked'));
    var keywords = checked.map(function(input) { return String(input.value || '').trim(); }).filter(Boolean);
    var nameInput = document.getElementById('bibliometricsKeywordMergeName');
    var name = nameInput && nameInput.value ? String(nameInput.value).trim() : '';
    if (!name && keywords.length) name = keywords[0];
    if (!name || keywords.length === 0) {
      alert('请先勾选要合并的关键词，并填写合并后的主关键词。');
      return;
    }
    try {
      var response = await fetch('/api/bibliometrics/keyword-merges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: window.currentUserId || 'web-user',
          name: name,
          keywords: keywords
        })
      });
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '保存关键词合并失败');
      applyBibliometricsServerData(data);
      bibliometricsState.activeTab = 'keywords';
      renderBibliometrics();
    } catch (e) {
      alert('保存失败：' + (e.message || e));
    }
  };

  window.deleteBibliometricKeywordMerge = async function(name) {
    if (!name) return;
    try {
      var response = await fetch('/api/bibliometrics/keyword-merges/' + encodeURIComponent(name) + '?userId=' + encodeURIComponent(window.currentUserId || 'web-user'), {
        method: 'DELETE'
      });
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '删除关键词合并失败');
      applyBibliometricsServerData(data);
      bibliometricsState.activeTab = 'keywords';
      renderBibliometrics();
    } catch (e) {
      alert('删除失败：' + (e.message || e));
    }
  };

  window.resetBibliometricKeywordMerges = async function() {
    if (!confirm('确定清空全部关键词合并规则吗？')) return;
    try {
      var response = await fetch('/api/bibliometrics/keyword-merges?userId=' + encodeURIComponent(window.currentUserId || 'web-user'), {
        method: 'DELETE'
      });
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '重置关键词合并失败');
      applyBibliometricsServerData(data);
      bibliometricsState.activeTab = 'keywords';
      renderBibliometrics();
    } catch (e) {
      alert('重置失败：' + (e.message || e));
    }
  };

  window.downloadBibliometricsNetworkJson = function() {
    var analysis = bibliometricsState.analysis;
    if (!analysis) return;
    var payload = {
      generatedAt: analysis.generatedAt,
      summary: analysis.summary,
      keywordTagSource: analysis.keywordTagSource,
      readiness: analysis.readiness,
      keywordNetwork: analysis.keywordNetwork,
      authorNetwork: analysis.authorNetwork,
      literatureSimilarityNetwork: analysis.literatureSimilarityNetwork,
      coCitationNetwork: analysis.coCitationNetwork,
      bibliographicCouplingNetwork: analysis.bibliographicCouplingNetwork,
      institutionNetwork: analysis.institutionNetwork,
      countryNetwork: analysis.countryNetwork,
      topicClusters: analysis.topicClusters,
      keywordBursts: analysis.keywordBursts,
      keywordYearTrends: analysis.keywordYearTrends,
      topicEvolution: analysis.topicEvolution,
      highImpactLiteratures: analysis.highImpactLiteratures,
      journalQuality: analysis.journalQuality,
      retrievalQuality: analysis.retrievalQuality,
      writingPreparation: analysis.writingPreparation
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'bibliometrics-network-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  window.runBibliometricsRCharts = async function() {
    if (bibliometricsState.rPluginLoading) return;
    bibliometricsState.rPluginLoading = true;
    bibliometricsState.rPluginResult = null;
    renderBibliometrics();
    try {
      var scriptResponse = await fetch('/api/bibliometrics/r-script?' + bibliometricsQuery());
      var scriptData = await scriptResponse.json();
      if (!scriptResponse.ok || !scriptData.success) throw new Error(scriptData.error || 'R 图表脚本生成失败');
      var executeResponse = await fetch('/api/r-code/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: window.currentUserId || 'web-user',
          rCode: scriptData.data.rCode,
          filename: scriptData.data.filename,
          timeoutMs: 180000
        })
      });
      var executeData = await executeResponse.json();
      if (!executeResponse.ok || !executeData.success) {
        var detail = executeData && executeData.data
          ? ((executeData.data.stderr || executeData.data.stdout || '').trim())
          : '';
        var message = (executeData.error || 'R 图表生成失败') + (detail ? '：' + summarizeRExecutionLog(detail) : '');
        if (/Rscript|ENOENT|未找到 R/i.test(message)) {
          message += '\n\n未检测到 Rscript。如果你已经安装了 R，请打开“R语言作图”窗口点击“重新检测”；也可以点击“一键安装R插件”自动部署。';
        }
        throw new Error(message);
      }
      bibliometricsState.rPluginResult = executeData.data;
      bibliometricsState.activeTab = 'writing';
    } catch (e) {
      bibliometricsState.rPluginResult = { error: e.message || String(e) };
      alert('R 图表生成失败：' + (e.message || e));
    } finally {
      bibliometricsState.rPluginLoading = false;
      renderBibliometrics();
    }
  };

  window.copyBibliometricsWritingPrep = async function() {
    var analysis = bibliometricsState.analysis;
    if (!analysis || !analysis.writingPreparation) return;
    var prep = analysis.writingPreparation;
    var lines = [];
    lines.push('# ' + (prep.suggestedTitle || '计量学论文写作准备'));
    lines.push('');
    lines.push('## 方法部分');
    (prep.methodsOutline || []).forEach(function(item, index) { lines.push((index + 1) + '. ' + item); });
    lines.push('');
    lines.push('## 结果部分');
    (prep.resultsOutline || []).forEach(function(item, index) { lines.push((index + 1) + '. ' + item); });
    lines.push('');
    lines.push('## 讨论角度');
    (prep.discussionAngles || []).forEach(function(item, index) { lines.push((index + 1) + '. ' + item); });
    lines.push('');
    lines.push('## 需要补齐的数据');
    (prep.requiredSupplementaryData || []).forEach(function(item, index) { lines.push((index + 1) + '. ' + item); });
    lines.push('');
    lines.push('## 局限性');
    (prep.limitations || []).forEach(function(item, index) { lines.push((index + 1) + '. ' + item); });
    var text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    }
  };

  window.generateBibliometricsPaperDraft = async function() {
    if (bibliometricsState.paperDraftLoading) return;
    bibliometricsState.paperDraftLoading = true;
    bibliometricsState.activeTab = 'writing';
    renderBibliometrics();
    startPaperDraftProgress();
    try {
      var response = await fetch('/api/bibliometrics/paper-draft?' + bibliometricsQuery('engine=ai'));
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '计量学论文草稿生成失败');
      stopPaperDraftProgress('草稿生成完成，正在打开编辑器');
      bibliometricsState.paperDraft = data.draft;
    } catch (e) {
      stopPaperDraftProgress('生成失败：' + (e.message || e));
      alert('生成失败：' + (e.message || e));
    } finally {
      bibliometricsState.paperDraftLoading = false;
      bibliometricsState.activeTab = 'writing';
      renderBibliometrics();
    }
  };

  function startPaperDraftProgress() {
    stopPaperDraftProgress();
    var startedAt = Date.now();
    var stepDuration = 2600;
    bibliometricsState.paperDraftProgressStep = 0;
    bibliometricsState.paperDraftProgressText = '';
    function tick() {
      var elapsed = Date.now() - startedAt;
      var step = Math.min(PAPER_DRAFT_PROGRESS_STEPS.length - 1, Math.floor(elapsed / stepDuration));
      var message = PAPER_DRAFT_PROGRESS_STEPS[step] || PAPER_DRAFT_PROGRESS_STEPS[0];
      var charCount = Math.min(message.length, Math.max(1, Math.floor((elapsed % stepDuration) / 42)));
      var cursor = Math.floor(elapsed / 360) % 2 === 0 ? ' ▌' : '  ';
      bibliometricsState.paperDraftProgressStep = step;
      bibliometricsState.paperDraftProgressText = message.slice(0, charCount) + cursor;
      updatePaperDraftProgressDom();
    }
    tick();
    paperDraftProgressTimer = window.setInterval(tick, 70);
  }

  function stopPaperDraftProgress(finalText) {
    if (paperDraftProgressTimer) {
      window.clearInterval(paperDraftProgressTimer);
      paperDraftProgressTimer = null;
    }
    if (finalText) {
      bibliometricsState.paperDraftProgressStep = PAPER_DRAFT_PROGRESS_STEPS.length - 1;
      bibliometricsState.paperDraftProgressText = finalText;
      updatePaperDraftProgressDom();
    }
  }

  function updatePaperDraftProgressDom() {
    var textEl = document.getElementById('bibliometricsPaperDraftProgressText');
    if (textEl) textEl.textContent = bibliometricsState.paperDraftProgressText || PAPER_DRAFT_PROGRESS_STEPS[0];
    var indexEl = document.getElementById('bibliometricsPaperDraftProgressIndex');
    if (indexEl) {
      indexEl.textContent = (Math.min((bibliometricsState.paperDraftProgressStep || 0) + 1, PAPER_DRAFT_PROGRESS_STEPS.length)) + '/' + PAPER_DRAFT_PROGRESS_STEPS.length;
    }
    var bars = document.getElementById('bibliometricsPaperDraftProgressBars');
    if (bars) {
      Array.prototype.slice.call(bars.children || []).forEach(function(child, index) {
        child.style.background = index <= (bibliometricsState.paperDraftProgressStep || 0) ? '#000000' : 'rgba(127,127,127,0.18)';
      });
    }
  }

  window.downloadBibliometricsPaperDraft = function() {
    var editor = document.getElementById('bibliometricsPaperDraftEditor');
    if (editor && editor.value) {
      downloadTextFile(editor.value, 'bibliometric-paper-draft-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.md', 'text/markdown;charset=utf-8');
      return;
    }
    var url = '/api/bibliometrics/paper-draft/download?' + bibliometricsQuery('engine=template');
    window.location.href = url;
  };

  window.copyBibliometricsPaperDraft = async function() {
    var editor = document.getElementById('bibliometricsPaperDraftEditor');
    var text = editor && editor.value ? editor.value : (bibliometricsState.paperDraft && bibliometricsState.paperDraft.markdown) || '';
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    }
  };

  function downloadTextFile(text, filename, type) {
    var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function summarizeRExecutionLog(log) {
    var text = String(log || '').trim();
    if (!text) return '';
    var errorIndex = text.search(/\bError\b|Execution halted|invalid font|could not find|there is no package/i);
    if (errorIndex >= 0) {
      return text.slice(errorIndex).trim().slice(0, 1200);
    }
    return text.slice(Math.max(0, text.length - 1200));
  }

  function icon(name) {
    if (window.uiIcon) return window.uiIcon(name, 'sm');
    return '';
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#00886e';
  }

  function escape(value) {
    return window.escapeHtml ? window.escapeHtml(String(value ?? '')) : String(value ?? '');
  }

  function attr(value) {
    return escape(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
})();
