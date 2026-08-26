// Embedding 文献库前端逻辑。依赖 index.html 中先定义的 currentUserId、escapeHtml、normalizeDoi、toDoiUrl。
(function() {
    var EMBEDDING_LIBRARY_PAGE_SIZE = 100;
    var EMBEDDING_TAG_SEARCH_DEBOUNCE_MS = 1000;
    var embeddingLibraryState = {
      data: null,
      mode: 'quick',
      selectedKeywords: [],
      keywordMode: 'AND',
      keywordSearch: '',
      advancedText: '',
      advancedGroupOperator: 'OR',
      mergeSelected: [],
      mergeName: '',
      result: null,
      activeOptions: null,
      filterAbort: null,
      filterLoading: false,
      loadingMore: false,
      tagLoading: false,
      tagRequestId: 0,
      tagSearchTimer: null,
      tagSearchPending: false,
      keywordSearchSelectionStart: 0,
      keywordSearchSelectionEnd: 0,
      detail: null,
      detailLoading: false,
      detailReturnState: null,
      selectedPaperIds: {},
      selectAllFiltered: false,
      graph: null,
      graphLoading: false,
      graphError: '',
      graphRequestId: 0,
      graphFilterSignature: ''
    };
    var embeddingGraphRuntime = null;

    function getEmbeddingProjectProfile() {
      return window.getProjectWritingProfile ? window.getProjectWritingProfile() : { id: 'paper-writing', shortLabel: '论文写作' };
    }

    function getEmbeddingProjectLabels() {
      return window.getProjectUiLabels ? window.getProjectUiLabels() : {
        embeddingLibrary: 'Embedding 文献库',
        styleGroup: '期刊风格'
      };
    }

    function getEmbeddingEvidenceName() {
      var profile = getEmbeddingProjectProfile();
      if (profile.id === 'paper-writing' || profile.id === 'paper-review') return '文献';
      if (profile.id === 'grant-writing') return '依据材料';
      if (profile.id === 'patent-writing') return '现有技术资料';
      if (profile.id === 'software-copyright') return '软件资料';
      if (profile.id === 'business-plan') return '商业资料';
      return '参考资料';
    }

    function renderEmbeddingFavoriteButton(id, favorite, compact) {
      var encodedId = encodeURIComponent(id || '');
      var title = favorite ? '取消收藏' : '收藏' + getEmbeddingEvidenceName();
      return '<button type="button" title="' + title + '" aria-label="' + title + '" onclick="toggleEmbeddingFavorite(event,\'' + encodedId + '\')" ' +
        'onkeydown="event.stopPropagation()" ' +
        'style="flex:0 0 auto;width:' + (compact ? '28px' : '34px') + ';height:' + (compact ? '28px' : '34px') + ';display:inline-flex;align-items:center;justify-content:center;border:1px solid ' + (favorite ? '#f59e0b' : 'var(--border-color)') + ';border-radius:6px;background:' + (favorite ? 'rgba(245,158,11,0.14)' : 'var(--bg-secondary)') + ';color:' + (favorite ? '#d97706' : 'var(--text-secondary)') + ';font-size:' + (compact ? '16px' : '18px') + ';line-height:1;cursor:pointer;">' + (favorite ? '★' : '☆') + '</button>';
    }

    function getEmbeddingFavoriteIds() {
      var ids = embeddingLibraryState.data && Array.isArray(embeddingLibraryState.data.favoriteIds)
        ? embeddingLibraryState.data.favoriteIds
        : [];
      var map = {};
      ids.forEach(function(id) { map[String(id)] = true; });
      return map;
    }

    function isEmbeddingFavorite(id) {
      var detail = embeddingLibraryState.detail || {};
      if (String(detail.id || '') === String(id || '') && typeof detail.favorite === 'boolean') {
        return detail.favorite;
      }
      return Boolean(getEmbeddingFavoriteIds()[String(id || '')]);
    }

    function setEmbeddingFavoriteValue(id, favorite, favoriteIds) {
      var key = String(id || '');
      if (!embeddingLibraryState.data) embeddingLibraryState.data = {};
      if (Array.isArray(favoriteIds)) {
        embeddingLibraryState.data.favoriteIds = favoriteIds;
      } else {
        var ids = getEmbeddingFavoriteIds();
        if (favorite) ids[key] = true;
        else delete ids[key];
        embeddingLibraryState.data.favoriteIds = Object.keys(ids);
      }

      function updatePaperList(list) {
        if (!Array.isArray(list)) return;
        list.forEach(function(paper) {
          if (String(paper.id || paper.doi || paper.title || '') === key) {
            paper.favorite = favorite;
          }
        });
      }

      updatePaperList(embeddingLibraryState.result && embeddingLibraryState.result.papers);
      updatePaperList(embeddingLibraryState.data && embeddingLibraryState.data.papers);
      updatePaperList(embeddingLibraryState.data && embeddingLibraryState.data.paperPage && embeddingLibraryState.data.paperPage.papers);
      if (embeddingLibraryState.graph && Array.isArray(embeddingLibraryState.graph.nodes)) {
        embeddingLibraryState.graph.nodes.forEach(function(node) {
          if (node.type === 'paper' && String(node.paperId || '') === key) {
            node.favorite = favorite;
            node.color = favorite ? '#f6c453' : '#7c6cff';
          }
        });
      }
      if (embeddingLibraryState.detail && String(embeddingLibraryState.detail.id || '') === key) {
        embeddingLibraryState.detail.favorite = favorite;
      }
    }

    window.toggleEmbeddingFavorite = async function(event, encodedId) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      var id = decodeURIComponent(encodedId || '');
      if (!id) return;
      var nextFavorite = !isEmbeddingFavorite(id);
      try {
        var response = await fetch('/api/embedding-library/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, paperId: id, favorite: nextFavorite })
        });
        var result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '收藏失败');
        setEmbeddingFavoriteValue(id, result.favorite, result.favoriteIds || []);
        renderEmbeddingLibrary();
      } catch (e) {
        alert('收藏失败：' + e.message);
      }
    };

    function closeEmbeddingLibrary() {
      destroyEmbeddingObsidianGraph();
      if (embeddingLibraryState.filterAbort) {
        embeddingLibraryState.filterAbort.abort();
      }
      if (embeddingLibraryState.tagSearchTimer) {
        clearTimeout(embeddingLibraryState.tagSearchTimer);
      }
      var downloadDialog = document.getElementById('embeddingDownloadDialog');
      if (downloadDialog) downloadDialog.remove();
      var modal = document.getElementById('embeddingLibraryModal');
      if (modal) modal.remove();
    }
    window.closeEmbeddingLibrary = closeEmbeddingLibrary;

    window.showEmbeddingLibrary = async function() {
      var existing = document.getElementById('embeddingLibraryModal');
      if (existing) closeEmbeddingLibrary();
      if (typeof prepareStandaloneWorkspaceSurface === 'function') {
        prepareStandaloneWorkspaceSurface('embeddingLibraryModal');
      }

      var modal = document.createElement('div');
      modal.id = 'embeddingLibraryModal';
      modal.className = 'app-secondary-overlay custom-fullscreen-overlay';
      modal.style.cssText = 'position:fixed;top:var(--app-chrome-height);left:var(--left-sidebar-width);right:0;bottom:0;background:var(--bg-primary);display:flex;align-items:stretch;justify-content:stretch;z-index:20000;padding:0;';
      modal.innerHTML =
        '<div id="embeddingLibraryPanel" class="custom-fullscreen-panel" style="width:100%;height:100%;background:var(--modal-bg);border:0;border-radius:0;display:flex;flex-direction:column;overflow:hidden;box-shadow:none;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border-color);">' +
            '<div class="embedding-library-header-main">' +
              '<div class="embedding-library-header-title">' + escapeHtml(getEmbeddingProjectLabels().embeddingLibrary) + '</div>' +
              '<div id="embeddingLibraryHeaderTools" class="embedding-library-header-tools"></div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
              '<button type="button" onclick="closeEmbeddingLibrary()" style="width:32px;height:32px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-secondary);cursor:pointer;">×</button>' +
            '</div>' +
          '</div>' +
          '<div id="embeddingLibraryContent" style="position:relative;min-height:0;flex:1;overflow:auto;padding:18px;color:var(--text-primary);">' +
            '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);">正在加载' + escapeHtml(getEmbeddingProjectLabels().embeddingLibrary) + '...</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);
      if (typeof setFullscreenButtonState === 'function') {
        setFullscreenButtonState(document.getElementById('embeddingLibraryFullscreenBtn'), true);
      }

      try {
        var response = await fetch('/api/embedding-library?userId=' + encodeURIComponent(currentUserId) + '&paperLimit=' + EMBEDDING_LIBRARY_PAGE_SIZE + '&paperOffset=0&tagLimit=' + EMBEDDING_LIBRARY_PAGE_SIZE + '&tagOffset=0');
        var data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || '读取' + getEmbeddingProjectLabels().embeddingLibrary + '失败');
        }
        embeddingLibraryState.selectedKeywords = [];
        embeddingLibraryState.activeOptions = null;
        embeddingLibraryState.detail = null;
        embeddingLibraryState.detailLoading = false;
        embeddingLibraryState.detailReturnState = null;
        embeddingLibraryState.selectedPaperIds = {};
        embeddingLibraryState.selectAllFiltered = false;
        embeddingLibraryState.graph = null;
        embeddingLibraryState.graphLoading = false;
        embeddingLibraryState.graphError = '';
        embeddingLibraryState.graphFilterSignature = '';
        embeddingLibraryState.data = data;
        embeddingLibraryState.result = data.paperPage || { total: data.summary.count, offset: 0, limit: EMBEDDING_LIBRARY_PAGE_SIZE, hasMore: false, papers: data.papers || [] };
        renderEmbeddingLibrary();
      } catch (e) {
        document.getElementById('embeddingLibraryContent').innerHTML =
          '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--danger-color);font-size:13px;">读取失败：' + escapeHtml(e.message) + '</div>';
      }
    };

    function getEmbeddingLibraryTags() {
      var data = embeddingLibraryState.data || {};
      var rawTags = Array.isArray(data.tags) ? data.tags : [];
      var merged = data.outerTags && Array.isArray(data.outerTags.mergedTags) ? data.outerTags.mergedTags : [];
      var search = String(embeddingLibraryState.keywordSearch || '').toLowerCase();
      var mergedOriginals = {};
      merged.forEach(function(tag) {
        (tag.originalKeywords || []).forEach(function(keyword) {
          mergedOriginals[String(keyword).toLowerCase()] = true;
        });
      });
      var tags = merged.filter(function(tag) {
        if (!search) return true;
        return String(tag.name || '').toLowerCase().indexOf(search) !== -1 ||
          (tag.originalKeywords || []).some(function(keyword) {
            return String(keyword || '').toLowerCase().indexOf(search) !== -1;
          });
      }).map(function(tag) {
        return { keyword: tag.name, count: tag.count || 0, merged: true, originalKeywords: tag.originalKeywords || [] };
      });
      rawTags.forEach(function(tag) {
        var keywordLower = String(tag.keyword || '').toLowerCase();
        if ((!search || keywordLower.indexOf(search) !== -1) && !mergedOriginals[keywordLower]) {
          tags.push({ keyword: tag.keyword, count: tag.count || 0, merged: false });
        }
      });
      return tags;
    }

    function renderEmbeddingLibrary() {
      var content = document.getElementById('embeddingLibraryContent');
      if (!content || !embeddingLibraryState.data) return;
      if (embeddingLibraryState.detail || embeddingLibraryState.detailLoading) {
        renderEmbeddingLiteratureDetailLayer();
        return;
      }

      var data = embeddingLibraryState.data;
      var summary = data.summary || {};
      var mode = embeddingLibraryState.mode;
      var tabs =
        '<div class="embedding-library-header-tabs">' +
          renderEmbeddingLibraryTab('quick', '快速筛选') +
          renderEmbeddingLibraryTab('advanced', '高级筛选') +
          renderEmbeddingLibraryTab('merge', '合并标签') +
          renderEmbeddingLibraryTab('graph', '网状图') +
        '</div>';
      var stats =
        '<div class="embedding-library-header-stats">' +
          renderEmbeddingStat(getEmbeddingEvidenceName(), summary.count || 0) +
          renderEmbeddingStat('有摘要', summary.abstractCount || 0) +
          renderEmbeddingStat('有 embedding', summary.embeddingCount || 0) +
          renderEmbeddingStat('关键词', data.totalKeywords || 0) +
        '</div>';
      var headerTools = document.getElementById('embeddingLibraryHeaderTools');
      if (headerTools) headerTools.innerHTML = stats + tabs;
      var body = mode === 'advanced'
        ? renderEmbeddingAdvancedPanel()
        : (mode === 'merge'
          ? renderEmbeddingMergePanel()
          : (mode === 'graph' ? renderEmbeddingObsidianGraphPanel() : renderEmbeddingQuickPanel()));

      if (mode === 'graph') {
        content.style.overflow = 'hidden';
        content.innerHTML = '<div class="embedding-graph-page">' + body + '</div>';
        requestAnimationFrame(initializeEmbeddingObsidianGraph);
      } else {
        destroyEmbeddingObsidianGraph();
        content.style.overflow = 'auto';
        content.innerHTML = body + renderEmbeddingResults();
      }
    }

    function renderEmbeddingLibraryTab(id, label) {
      var active = embeddingLibraryState.mode === id;
      return '<button type="button" class="' + (active ? 'active' : '') + '" onclick="switchEmbeddingLibraryMode(\'' + id + '\')">' + label + '</button>';
    }

    function renderEmbeddingStat(label, value) {
      return '<div class="embedding-library-header-stat">' +
        '<span>' + label + '</span>' +
        '<strong>' + value + '</strong>' +
      '</div>';
    }

    function getEmbeddingGraphFilterOptions() {
      var options = Object.assign({}, embeddingLibraryState.activeOptions || {});
      delete options.offset;
      delete options.limit;
      return options;
    }

    function getEmbeddingGraphFilterSignature() {
      return JSON.stringify(getEmbeddingGraphFilterOptions());
    }

    function isEmbeddingUntaggedKeywordNode(node) {
      var id = String(node && node.id || '').toLowerCase();
      var label = String(node && node.label || '').trim();
      return id === 'keyword:__embedding_library_untagged__' || label === '未标注关键词';
    }

    function invalidateEmbeddingLibraryGraph() {
      embeddingLibraryState.graphRequestId += 1;
      embeddingLibraryState.graph = null;
      embeddingLibraryState.graphLoading = false;
      embeddingLibraryState.graphError = '';
      embeddingLibraryState.graphFilterSignature = '';
      destroyEmbeddingObsidianGraph();
    }

    async function loadEmbeddingLibraryGraph(force) {
      var signature = getEmbeddingGraphFilterSignature();
      if (!force && embeddingLibraryState.graph && embeddingLibraryState.graphFilterSignature === signature) {
        if (embeddingLibraryState.mode === 'graph') renderEmbeddingLibrary();
        return;
      }
      var requestId = ++embeddingLibraryState.graphRequestId;
      embeddingLibraryState.graphLoading = true;
      embeddingLibraryState.graphError = '';
      if (embeddingLibraryState.mode === 'graph') renderEmbeddingLibrary();
      try {
        var response = await fetch('/api/embedding-library/graph', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            options: getEmbeddingGraphFilterOptions(),
            includeAll: true
          })
        });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '读取图谱失败');
        }
        if (requestId !== embeddingLibraryState.graphRequestId) return;
        var rawGraphNodes = result.graph && Array.isArray(result.graph.nodes) ? result.graph.nodes : [];
        var hiddenGraphNodeIds = {};
        rawGraphNodes.forEach(function(node) {
          if (isEmbeddingUntaggedKeywordNode(node)) hiddenGraphNodeIds[String(node.id || '')] = true;
        });
        var visibleGraphNodes = rawGraphNodes
          .filter(function(node) { return !hiddenGraphNodeIds[String(node.id || '')]; })
          .map(function(node) {
            if (node.type !== 'paper' || !Array.isArray(node.keywords)) return node;
            return Object.assign({}, node, {
              keywords: node.keywords.filter(function(keyword) {
                return String(keyword || '').trim() !== '未标注关键词';
              })
            });
          });
        var visibleGraphEdges = result.graph && Array.isArray(result.graph.edges)
          ? result.graph.edges.filter(function(edge) {
              return !hiddenGraphNodeIds[String(edge.source || '')] &&
                !hiddenGraphNodeIds[String(edge.target || '')];
            })
          : [];
        var connectedGraphNodeIds = {};
        visibleGraphEdges.forEach(function(edge) {
          connectedGraphNodeIds[String(edge.source || '')] = true;
          connectedGraphNodeIds[String(edge.target || '')] = true;
        });
        visibleGraphNodes = visibleGraphNodes.filter(function(node) {
          return node.type !== 'paper' || connectedGraphNodeIds[String(node.id || '')];
        });
        var visiblePaperCount = visibleGraphNodes.filter(function(node) { return node.type === 'paper'; }).length;
        embeddingLibraryState.graph = {
          nodes: visibleGraphNodes,
          edges: visibleGraphEdges,
          keywordCount: visibleGraphNodes.filter(function(node) { return node.type === 'keyword'; }).length,
          paperCount: visiblePaperCount,
          omittedPaperCount: Math.max(0, Number(result.total || 0) - visiblePaperCount),
          total: Number(result.total || 0),
          sampled: Number(result.sampled || 0),
          truncated: Boolean(result.truncated)
        };
        embeddingLibraryState.graphFilterSignature = signature;
      } catch (e) {
        if (requestId !== embeddingLibraryState.graphRequestId) return;
        embeddingLibraryState.graph = null;
        embeddingLibraryState.graphError = e.message || String(e);
      } finally {
        if (requestId === embeddingLibraryState.graphRequestId) {
          embeddingLibraryState.graphLoading = false;
          if (embeddingLibraryState.mode === 'graph') renderEmbeddingLibrary();
        }
      }
    }

    window.refreshEmbeddingObsidianGraph = function() {
      invalidateEmbeddingLibraryGraph();
      loadEmbeddingLibraryGraph(true);
    };

    function renderEmbeddingObsidianGraphPanel() {
      var graph = embeddingLibraryState.graph;
      if (!graph && embeddingLibraryState.graphLoading) {
        return '<section class="embedding-obsidian-shell embedding-obsidian-loading">' +
          '<span class="embedding-obsidian-motion-dot"></span>' +
          '<span>正在聚合当前筛选结果并构建网状图...</span>' +
        '</section>';
      }
      if (!graph && embeddingLibraryState.graphError) {
        return '<section class="embedding-obsidian-shell embedding-obsidian-empty">' +
          '<strong>图谱读取失败</strong>' +
          '<span>' + escapeHtml(embeddingLibraryState.graphError) + '</span>' +
          '<button type="button" onclick="refreshEmbeddingObsidianGraph()">重新读取</button>' +
        '</section>';
      }
      if (!graph || !graph.nodes.length) {
        return '<section class="embedding-obsidian-shell embedding-obsidian-empty">' +
          '<strong>当前筛选结果没有可连接的关键词与文献</strong>' +
          '<span>请切换筛选条件，或先为文献补充关键词。</span>' +
          '<button type="button" onclick="refreshEmbeddingObsidianGraph()">重新读取</button>' +
        '</section>';
      }
      var sourceDescription = '符合条件 ' + graph.total + ' 篇 · 全部参与聚合';
      return '<section class="embedding-obsidian-shell">' +
        '<div class="embedding-obsidian-toolbar">' +
          '<div class="embedding-obsidian-title">' +
            '<strong>Embedding 文献网状图</strong>' +
            '<span class="embedding-obsidian-badge">网状图</span>' +
            '<span class="embedding-obsidian-live"><span class="embedding-obsidian-motion-dot"></span>持续动态</span>' +
          '</div>' +
          '<div class="embedding-obsidian-actions">' +
            '<span>' + escapeHtml(sourceDescription) + '</span>' +
            '<details class="embedding-obsidian-control" data-control-group="motion" ontoggle="handleEmbeddingObsidianControlToggle(this)">' +
              '<summary class="embedding-obsidian-control-summary" aria-label="选择网状图动效">' +
                '<span class="embedding-obsidian-control-marker motion"></span>' +
                '<span id="embeddingObsidianMotionSummaryText">动效</span>' +
                '<span class="embedding-obsidian-control-chevron" aria-hidden="true"></span>' +
              '</summary>' +
              '<div class="embedding-obsidian-control-menu" role="group" aria-label="动效">' +
                '<button type="button" class="embedding-obsidian-motion-action" data-motion-effect="wave" aria-pressed="false" title="持续传播波浪，再次点击停止" onclick="triggerEmbeddingObsidianMotionEffect(\'wave\')">波浪</button>' +
                '<button type="button" class="embedding-obsidian-motion-action" data-motion-effect="vortex" aria-pressed="false" title="持续旋转图谱，再次点击停止" onclick="triggerEmbeddingObsidianMotionEffect(\'vortex\')">旋涡</button>' +
                '<button type="button" class="embedding-obsidian-motion-action" data-motion-effect="breathe" aria-pressed="false" title="持续缓慢呼吸，再次点击停止" onclick="triggerEmbeddingObsidianMotionEffect(\'breathe\')">呼吸</button>' +
                '<button type="button" class="embedding-obsidian-motion-action" data-motion-effect="voice" aria-pressed="false" title="使用本地麦克风驱动声浪，再次点击停止" onclick="triggerEmbeddingObsidianMotionEffect(\'voice\')">声浪</button>' +
              '</div>' +
            '</details>' +
            '<details class="embedding-obsidian-control" data-control-group="shape" ontoggle="handleEmbeddingObsidianControlToggle(this)">' +
              '<summary class="embedding-obsidian-control-summary" aria-label="选择网状图形状">' +
                '<span class="embedding-obsidian-control-marker shape"></span>' +
                '<span id="embeddingObsidianShapeSummaryText">形状 · 圆形</span>' +
                '<span class="embedding-obsidian-control-chevron" aria-hidden="true"></span>' +
              '</summary>' +
              '<div class="embedding-obsidian-control-menu" role="group" aria-label="形状">' +
                '<button type="button" class="embedding-obsidian-shape-action" data-shape-effect="circle" aria-pressed="true" title="切换为圆形布局" onclick="selectEmbeddingObsidianShape(\'circle\')">圆形</button>' +
                '<button type="button" class="embedding-obsidian-shape-action" data-shape-effect="blackhole" aria-pressed="false" title="切换为黑洞吸积盘形状" onclick="selectEmbeddingObsidianShape(\'blackhole\')">黑洞</button>' +
                '<button type="button" class="embedding-obsidian-shape-action" data-shape-effect="saturn" aria-pressed="false" title="切换为土星与土星环形状" onclick="selectEmbeddingObsidianShape(\'saturn\')">土星</button>' +
                '<button type="button" class="embedding-obsidian-shape-action" data-shape-effect="galaxy" aria-pressed="false" title="切换为银河星云带形状" onclick="selectEmbeddingObsidianShape(\'galaxy\')">银河系</button>' +
                '<button type="button" class="embedding-obsidian-shape-action" data-shape-effect="starfield" aria-pressed="false" title="切换为满天繁星形状" onclick="selectEmbeddingObsidianShape(\'starfield\')">星空</button>' +
                '<button type="button" class="embedding-obsidian-shape-action" data-shape-effect="starrynight" aria-pressed="false" title="让节点组成星月夜的旋涡天空、月亮与柏树" onclick="selectEmbeddingObsidianShape(\'starrynight\')">星月夜</button>' +
                '<button type="button" class="embedding-obsidian-shape-action" data-shape-effect="painted-eye" aria-pressed="false" title="让节点组成彩色油画眼睛" onclick="selectEmbeddingObsidianShape(\'painted-eye\')">油画之眼</button>' +
                '<button type="button" class="embedding-obsidian-shape-action" data-shape-effect="cubist-face" aria-pressed="false" title="让节点组成立体主义抽象人像" onclick="selectEmbeddingObsidianShape(\'cubist-face\')">抽象人像</button>' +
              '</div>' +
            '</details>' +
            '<details class="embedding-obsidian-control" data-control-group="color" ontoggle="handleEmbeddingObsidianControlToggle(this)">' +
              '<summary class="embedding-obsidian-control-summary" aria-label="选择节点配色">' +
                '<span class="embedding-obsidian-control-marker color"></span>' +
                '<span id="embeddingObsidianColorSummaryText">配色 · 原始</span>' +
                '<span class="embedding-obsidian-control-chevron" aria-hidden="true"></span>' +
              '</summary>' +
              '<div class="embedding-obsidian-control-menu" role="group" aria-label="节点配色">' +
                '<button type="button" class="embedding-obsidian-color-action active" data-color-palette="original" aria-pressed="true" onclick="selectEmbeddingObsidianColorPalette(\'original\')">原始配色</button>' +
                '<button type="button" class="embedding-obsidian-color-action" data-color-palette="ice" aria-pressed="false" onclick="selectEmbeddingObsidianColorPalette(\'ice\')">冰蓝</button>' +
                '<button type="button" class="embedding-obsidian-color-action" data-color-palette="nebula" aria-pressed="false" onclick="selectEmbeddingObsidianColorPalette(\'nebula\')">星云紫</button>' +
                '<button type="button" class="embedding-obsidian-color-action" data-color-palette="gold" aria-pressed="false" onclick="selectEmbeddingObsidianColorPalette(\'gold\')">暖金</button>' +
                '<button type="button" class="embedding-obsidian-color-action" data-color-palette="emerald" aria-pressed="false" onclick="selectEmbeddingObsidianColorPalette(\'emerald\')">翡翠</button>' +
              '</div>' +
            '</details>' +
            '<button type="button" onclick="restartEmbeddingObsidianGraph()">重新布局</button>' +
            '<button type="button" onclick="fitEmbeddingObsidianGraph()">适应画布</button>' +
            '<button type="button" onclick="refreshEmbeddingObsidianGraph()">刷新数据</button>' +
          '</div>' +
        '</div>' +
        '<div class="embedding-obsidian-filterbar">' +
          '<input id="embeddingObsidianSearch" type="search" placeholder="搜索关键词、题名、作者或期刊" oninput="filterEmbeddingObsidianGraph(this.value)">' +
          '<div><span class="embedding-obsidian-legend keyword"></span>关键词 ' + graph.keywordCount + '</div>' +
          '<div><span class="embedding-obsidian-legend paper"></span>文献 ' + graph.paperCount + '</div>' +
          '<div><span class="embedding-obsidian-legend favorite"></span>收藏文献</div>' +
        '</div>' +
        '<div class="embedding-obsidian-layout">' +
          '<div class="embedding-obsidian-canvas-wrap">' +
            '<canvas id="embeddingObsidianCanvas" tabindex="0" aria-label="Embedding 文献网状图"></canvas>' +
            '<div class="embedding-obsidian-zoom">' +
              '<button type="button" aria-label="缩小" onclick="zoomEmbeddingObsidianGraph(-1)">−</button>' +
              '<button type="button" aria-label="放大" onclick="zoomEmbeddingObsidianGraph(1)">+</button>' +
            '</div>' +
            '<div class="embedding-obsidian-help">悬停一跳关系 · 左键拖动/平移 · 滚轮缩放 · 右键固定 · 双击文献查看详情</div>' +
          '</div>' +
          '<aside id="embeddingObsidianDetail" class="embedding-obsidian-detail">' + renderEmbeddingObsidianEmptyDetail() + '</aside>' +
        '</div>' +
      '</section>';
    }

    function renderEmbeddingObsidianEmptyDetail() {
      return '<div class="embedding-obsidian-detail-empty">' +
        '<strong>悬停预览，右键固定</strong>' +
        '<span>关键词节点连接相关文献；文献节点连接其高频主题。右键选中后，详情不会随鼠标移动消失。</span>' +
      '</div>';
    }

    function initializeEmbeddingObsidianGraph() {
      if (embeddingLibraryState.mode !== 'graph' || !embeddingLibraryState.graph) return;
      var canvas = document.getElementById('embeddingObsidianCanvas');
      if (!canvas || !canvas.isConnected) return;
      destroyEmbeddingObsidianGraph();
      var graph = embeddingLibraryState.graph;
      var runtime = {
        canvas: canvas,
        graph: graph,
        nodes: graph.nodes.map(function(node) { return Object.assign({}, node); }),
        edges: graph.edges.map(function(edge) { return Object.assign({}, edge); }),
        points: {},
        neighbors: {},
        degrees: {},
        maxKeywordDegree: 1,
        width: 0,
        height: 0,
        scale: 1,
        translateX: 0,
        translateY: 0,
        hoveredId: '',
        lockedId: '',
        searchTerm: '',
        searchMatches: {},
        searchRelated: {},
        pointer: null,
        alpha: 0.78,
        edgeCursor: 0,
        largeGraph: graph.nodes.length > 900,
        worldWidth: 0,
        worldHeight: 0,
        defaultLabelIds: {},
        frame: null,
        lastFrameAt: 0,
        motionEffect: '',
        motionEffectStartedAt: 0,
        shapeMode: 'circle',
        colorPalette: 'original',
        shapeTransitionStartedAt: 0,
        audioRequestId: 0,
        audioStream: null,
        audioContext: null,
        audioSource: null,
        audioAnalyser: null,
        audioTimeData: null,
        audioFrequencyData: null,
        audioLevel: 0,
        audioLow: 0,
        audioMid: 0,
        audioHigh: 0,
        audioWaveHistory: [],
        resizeObserver: null,
        destroyed: false
      };
      runtime.nodes.forEach(function(node) {
        runtime.neighbors[node.id] = {};
      });
      runtime.edges.forEach(function(edge) {
        if (!runtime.neighbors[edge.source]) runtime.neighbors[edge.source] = {};
        if (!runtime.neighbors[edge.target]) runtime.neighbors[edge.target] = {};
        runtime.neighbors[edge.source][edge.target] = true;
        runtime.neighbors[edge.target][edge.source] = true;
      });
      Object.keys(runtime.neighbors).forEach(function(id) {
        runtime.degrees[id] = Object.keys(runtime.neighbors[id] || {}).length;
      });
      runtime.maxKeywordDegree = runtime.nodes.reduce(function(maxDegree, node) {
        if (node.type !== 'keyword') return maxDegree;
        return Math.max(maxDegree, Number(runtime.degrees[node.id] || node.value || 0));
      }, 1);
      runtime.nodes
        .filter(function(node) { return node.type === 'keyword'; })
        .sort(function(a, b) { return Number(b.value || 0) - Number(a.value || 0); })
        .slice(0, 14)
        .forEach(function(node) { runtime.defaultLabelIds[node.id] = true; });
      embeddingGraphRuntime = runtime;
      resizeEmbeddingObsidianGraph(runtime, true);
      attachEmbeddingObsidianGraphHandlers(runtime);
      if (typeof ResizeObserver !== 'undefined') {
        runtime.resizeObserver = new ResizeObserver(function() {
          resizeEmbeddingObsidianGraph(runtime, false);
        });
        runtime.resizeObserver.observe(canvas.parentElement);
      }
      runtime.frame = requestAnimationFrame(function(time) {
        animateEmbeddingObsidianGraph(runtime, time);
      });
      requestAnimationFrame(function() {
        if (embeddingGraphRuntime === runtime) fitEmbeddingObsidianGraph();
      });
    }

    function destroyEmbeddingObsidianGraph() {
      var runtime = embeddingGraphRuntime;
      if (!runtime) return;
      stopEmbeddingObsidianAudio(runtime, true);
      runtime.destroyed = true;
      if (runtime.frame) cancelAnimationFrame(runtime.frame);
      if (runtime.resizeObserver) runtime.resizeObserver.disconnect();
      embeddingGraphRuntime = null;
    }

    function resizeEmbeddingObsidianGraph(runtime, resetPoints) {
      if (!runtime || runtime.destroyed || !runtime.canvas) return;
      var rect = runtime.canvas.getBoundingClientRect();
      var width = Math.max(480, Math.round(rect.width || 900));
      var height = Math.max(460, Math.round(rect.height || 620));
      var sizeChanged = width !== runtime.width || height !== runtime.height;
      runtime.width = width;
      runtime.height = height;
      var worldMultiplier = runtime.largeGraph
        ? Math.max(2.4, Math.min(7, Math.sqrt(runtime.nodes.length / 420)))
        : 1;
      runtime.worldWidth = width * worldMultiplier;
      runtime.worldHeight = height * worldMultiplier;
      if (resetPoints || !Object.keys(runtime.points).length) {
        seedEmbeddingObsidianGraphPoints(runtime);
      } else if (sizeChanged) {
        Object.keys(runtime.points).forEach(function(id) {
          var point = runtime.points[id];
          point.x = Math.max(24, Math.min(runtime.worldWidth - 24, point.x));
          point.y = Math.max(24, Math.min(runtime.worldHeight - 24, point.y));
        });
        if (runtime.shapeMode !== 'circle') {
          assignEmbeddingObsidianShapeTargets(runtime);
        }
      }
      drawEmbeddingObsidianGraph(runtime);
    }

    function seedEmbeddingObsidianGraphPoints(runtime) {
      var keywordIndex = 0;
      var paperIndex = 0;
      var anchorUseCounts = {};
      runtime.points = {};
      runtime.nodes.forEach(function(node) {
        var seed = embeddingGraphSeed(node.id);
        var secondarySeed = embeddingGraphSeed(node.id + ':secondary');
        var isKeyword = node.type === 'keyword';
        var index = isKeyword ? keywordIndex++ : paperIndex++;
        var angle = seed * Math.PI * 2;
        var minimumWorldSize = Math.min(runtime.worldWidth, runtime.worldHeight);
        var radius = minimumWorldSize *
          (isKeyword ? (0.08 + Math.sqrt(secondarySeed) * 0.34) : (0.28 + Math.sqrt(secondarySeed) * 0.16));
        var anchor = null;
        var keywordNeighborId = '';
        if (!isKeyword && !runtime.largeGraph) {
          keywordNeighborId = Object.keys(runtime.neighbors[node.id] || {}).find(function(id) {
            return runtime.points[id] && runtime.points[id].node.type === 'keyword';
          }) || '';
          anchor = keywordNeighborId ? runtime.points[keywordNeighborId] : null;
          if (keywordNeighborId) {
            anchorUseCounts[keywordNeighborId] = (anchorUseCounts[keywordNeighborId] || 0) + 1;
          }
        }
        var anchorIndex = anchor
          ? Math.max(0, (anchorUseCounts[keywordNeighborId] || 1) - 1)
          : index;
        var anchorAngle = embeddingGraphSeed(node.id + ':anchor-angle') * Math.PI * 2;
        var spreadJitter = 0.72 + embeddingGraphSeed(node.id + ':anchor-radius') * 0.56;
        var spread = (22 + Math.sqrt(anchorIndex + 1) * 10) * spreadJitter;
        var paperOrbitAngle = embeddingGraphSeed(node.id + ':paper-orbit') * Math.PI * 2;
        var paperRingRadius = minimumWorldSize * (0.37 + embeddingGraphSeed(node.id + ':paper-ring') * 0.075);
        var keywordCloudRadius = minimumWorldSize * (0.035 + Math.sqrt(secondarySeed) * 0.27);
        var initialX = runtime.largeGraph
          ? runtime.worldWidth / 2 + Math.cos(isKeyword ? angle : paperOrbitAngle) *
            (isKeyword ? keywordCloudRadius : paperRingRadius)
          : (anchor
            ? anchor.x + Math.cos(anchorAngle) * spread
            : runtime.worldWidth / 2 + Math.cos(angle) * radius);
        var initialY = runtime.largeGraph
          ? runtime.worldHeight / 2 + Math.sin(isKeyword ? angle : paperOrbitAngle) *
            (isKeyword ? keywordCloudRadius : paperRingRadius)
          : (anchor
            ? anchor.y + Math.sin(anchorAngle) * spread
            : runtime.worldHeight / 2 + Math.sin(angle) * radius);
        initialX = Math.max(30, Math.min(runtime.worldWidth - 30, initialX));
        initialY = Math.max(30, Math.min(runtime.worldHeight - 30, initialY));
        runtime.points[node.id] = {
          node: node,
          x: initialX,
          y: initialY,
          vx: 0,
          vy: 0,
          fx: null,
          fy: null,
          r: getEmbeddingObsidianNodeRadius(node),
          seed: seed * Math.PI * 2,
          ringRadius: !isKeyword && runtime.largeGraph ? paperRingRadius : 0
        };
        runtime.points[node.id].homeX = runtime.points[node.id].x;
        runtime.points[node.id].homeY = runtime.points[node.id].y;
      });
      if (runtime.shapeMode !== 'circle') {
        assignEmbeddingObsidianShapeTargets(runtime);
      }
      runtime.alpha = 0.78;
      runtime.scale = 1;
      runtime.translateX = 0;
      runtime.translateY = 0;
    }

    function getEmbeddingObsidianNodeRadius(node) {
      if (node.type === 'keyword') {
        return Math.max(7, Math.min(17, 7 + Math.sqrt(Math.max(1, Number(node.value || 1))) * 1.35));
      }
      return node.favorite
        ? 6.7
        : Math.max(4.2, Math.min(7, 4.2 + Number(node.value || 1) * 0.42));
    }

    function getEmbeddingObsidianKeywordSizeRatio(runtime, point) {
      if (!runtime || !point || point.node.type !== 'keyword') return 0;
      var keywordConnectionCount = Math.max(
        1,
        Number(runtime.degrees[point.node.id] || point.node.value || 1)
      );
      var keywordSizeRatio = Math.sqrt(
        keywordConnectionCount / Math.max(1, Number(runtime.maxKeywordDegree || 1))
      );
      return keywordSizeRatio;
    }

    function getEmbeddingObsidianScreenRadius(runtime, point, includeHover) {
      if (!runtime || !point) return 0;
      var screenScale = Math.max(runtime.largeGraph ? 0.045 : 0.42, runtime.scale);
      var minimumScreenRadius = runtime.largeGraph
        ? (point.node.type === 'keyword'
          ? 2 + getEmbeddingObsidianKeywordSizeRatio(runtime, point) * 7
          : 1.15)
        : 0;
      var radius = Math.max(point.r * screenScale, minimumScreenRadius);
      return radius * (includeHover && point.node.id === runtime.hoveredId ? 1.22 : 1);
    }

    function getEmbeddingObsidianCollisionRadius(runtime, point) {
      if (!runtime || !point) return 0;
      if (runtime.shapeMode !== 'circle' && Number.isFinite(point.cosmicShapePointSize)) {
        return Math.max(0.7, point.cosmicShapePointSize * 0.72) /
          Math.max(runtime.largeGraph ? 0.045 : 0.42, runtime.scale);
      }
      if (!runtime.largeGraph) return point.r;
      return getEmbeddingObsidianScreenRadius(runtime, point, false) /
        Math.max(0.045, runtime.scale);
    }

    function embeddingGraphSeed(value) {
      var text = String(value || '');
      var hash = 2166136261;
      for (var i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return ((hash >>> 0) % 100000) / 100000;
    }

    function embeddingGraphScatterSeed(value) {
      var text = String(value || '');
      var hash = 2166136261;
      for (var index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      hash ^= hash >>> 16;
      hash = Math.imul(hash, 2146121005);
      hash ^= hash >>> 15;
      hash = Math.imul(hash, -2073254261);
      hash ^= hash >>> 16;
      return (hash >>> 0) / 4294967296;
    }

    function animateEmbeddingObsidianGraph(runtime, time) {
      if (!runtime || runtime.destroyed || embeddingGraphRuntime !== runtime) return;
      if (runtime.largeGraph && runtime.lastFrameAt && time - runtime.lastFrameAt < 30) {
        runtime.frame = requestAnimationFrame(function(nextTime) {
          animateEmbeddingObsidianGraph(runtime, nextTime);
        });
        return;
      }
      var delta = runtime.lastFrameAt ? Math.min(2, Math.max(0.45, (time - runtime.lastFrameAt) / 16.67)) : 1;
      runtime.lastFrameAt = time;
      simulateEmbeddingObsidianGraph(runtime, delta, time);
      drawEmbeddingObsidianGraph(runtime);
      runtime.frame = requestAnimationFrame(function(nextTime) {
        animateEmbeddingObsidianGraph(runtime, nextTime);
      });
    }

    function closeEmbeddingObsidianControlMenus(except) {
      document.querySelectorAll(
        '#embeddingLibraryModal .embedding-obsidian-control[open]'
      ).forEach(function(details) {
        if (!except || details !== except) details.removeAttribute('open');
      });
    }

    window.handleEmbeddingObsidianControlToggle = function(details) {
      if (!details || !details.open) return;
      closeEmbeddingObsidianControlMenus(details);
    };

    function updateEmbeddingObsidianMotionButtons(runtime) {
      var activeEffect = runtime ? String(runtime.motionEffect || '') : '';
      var motionLabels = {
        wave: '波浪',
        vortex: '旋涡',
        breathe: '呼吸',
        voice: '声浪'
      };
      document.querySelectorAll(
        '#embeddingLibraryModal .embedding-obsidian-motion-action'
      ).forEach(function(button) {
        var active = button.getAttribute('data-motion-effect') === activeEffect;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        if (!active || button.getAttribute('data-motion-effect') !== 'voice') {
          button.style.removeProperty('--voice-scale');
          button.style.removeProperty('--voice-glow');
        }
      });
      var summary = document.getElementById('embeddingObsidianMotionSummaryText');
      if (summary) {
        summary.textContent = activeEffect && motionLabels[activeEffect]
          ? '动效 · ' + motionLabels[activeEffect]
          : '动效';
      }
      var control = document.querySelector(
        '#embeddingLibraryModal .embedding-obsidian-control[data-control-group="motion"]'
      );
      if (control) control.classList.toggle('has-active', Boolean(activeEffect));
    }

    function updateEmbeddingObsidianShapeButton(runtime) {
      var activeShape = runtime ? String(runtime.shapeMode || 'circle') : 'circle';
      var shapeLabels = {
        circle: '圆形',
        blackhole: '黑洞',
        saturn: '土星',
        galaxy: '银河系',
        starfield: '星空',
        starrynight: '星月夜',
        'painted-eye': '油画之眼',
        'cubist-face': '抽象人像'
      };
      document.querySelectorAll(
        '#embeddingLibraryModal .embedding-obsidian-shape-action'
      ).forEach(function(button) {
        var active = button.getAttribute('data-shape-effect') === activeShape;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      var summary = document.getElementById('embeddingObsidianShapeSummaryText');
      if (summary) summary.textContent = '形状 · ' + (shapeLabels[activeShape] || '圆形');
    }

    function updateEmbeddingObsidianColorButtons(runtime) {
      var activePalette = runtime ? String(runtime.colorPalette || 'original') : 'original';
      var paletteLabels = {
        original: '原始',
        ice: '冰蓝',
        nebula: '星云紫',
        gold: '暖金',
        emerald: '翡翠'
      };
      var paletteAccents = {
        original: '#d5e8ff',
        ice: '#67e8f9',
        nebula: '#c4b5fd',
        gold: '#f6c453',
        emerald: '#6ee7b7'
      };
      document.querySelectorAll(
        '#embeddingLibraryModal .embedding-obsidian-color-action'
      ).forEach(function(button) {
        var active = button.getAttribute('data-color-palette') === activePalette;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      var summary = document.getElementById('embeddingObsidianColorSummaryText');
      if (summary) summary.textContent = '配色 · ' + (paletteLabels[activePalette] || '原始');
      var marker = document.querySelector(
        '#embeddingLibraryModal .embedding-obsidian-control-marker.color'
      );
      if (marker) {
        var accent = paletteAccents[activePalette] || paletteAccents.original;
        marker.style.background = accent;
        marker.style.boxShadow = '0 0 7px ' + accent;
      }
    }

    window.selectEmbeddingObsidianColorPalette = function(palette) {
      closeEmbeddingObsidianControlMenus();
      var runtime = embeddingGraphRuntime;
      if (!runtime) return;
      var supportedPalettes = {
        original: true,
        ice: true,
        nebula: true,
        gold: true,
        emerald: true
      };
      if (!supportedPalettes[palette]) return;
      runtime.colorPalette = palette;
      updateEmbeddingObsidianColorButtons(runtime);
      drawEmbeddingObsidianGraph(runtime);
    };

    function assignEmbeddingObsidianBlackHoleTargets(runtime) {
      if (!runtime) return;
      var centerX = runtime.worldWidth / 2;
      var centerY = runtime.worldHeight / 2;
      var minimumWorldSize = Math.min(runtime.worldWidth, runtime.worldHeight);
      var rotation = -0.34;
      var cosine = Math.cos(rotation);
      var sine = Math.sin(rotation);
      var horizonRadius = minimumWorldSize * 0.16;
      var diskOuterRadius = minimumWorldSize * 2.2;
      var sceneHalfWidth = Math.max(runtime.worldWidth * 0.47, diskOuterRadius * 1.03);
      var sceneHalfHeight = Math.max(
        runtime.worldHeight * 0.45,
        sceneHalfWidth * runtime.height / Math.max(1, runtime.width) * 0.94
      );
      Object.keys(runtime.points).forEach(function(id) {
        var point = runtime.points[id];
        var node = point.node;
        var zoneSeed = embeddingGraphScatterSeed(node.id + ':black-hole-zone');
        var radialSeed = embeddingGraphScatterSeed(node.id + ':black-hole-radius');
        var angleSeed = embeddingGraphScatterSeed(node.id + ':black-hole-angle');
        var depthSeed = embeddingGraphScatterSeed(node.id + ':black-hole-depth');
        var localX = 0;
        var localY = 0;
        var heat = 0;
        var zone = 'disk';
        if (zoneSeed < 0.20) {
          var diskAngle = angleSeed * Math.PI * 2;
          var diskBaseRadius = minimumWorldSize * (
            0.03 +
            Math.pow(radialSeed, 0.68) * 0.52
          );
          var diskRadius = diskBaseRadius * 4;
          localX = Math.cos(diskAngle) * diskRadius;
          localY = Math.sin(diskAngle) * diskRadius * (0.016 + depthSeed * 0.032);
          localY += (depthSeed - 0.5) * minimumWorldSize * 0.006;
          var diskDistance = Math.sqrt(localX * localX + localY * localY);
          if (diskDistance < horizonRadius * 1.08) {
            var diskPush = horizonRadius * 1.08 / Math.max(1, diskDistance);
            localX *= diskPush;
            localY *= diskPush;
          }
          heat = Math.max(
            0,
            Math.min(
              1,
              1 - (diskBaseRadius - minimumWorldSize * 0.03) / (minimumWorldSize * 0.52)
            )
          );
          zone = 'disk';
        } else if (zoneSeed < 0.27) {
          var photonAngle = angleSeed * Math.PI * 2;
          var photonRadius = minimumWorldSize * (0.168 + radialSeed * 0.033);
          localX = Math.cos(photonAngle) * photonRadius;
          localY = Math.sin(photonAngle) * photonRadius * (0.98 + depthSeed * 0.045);
          heat = 0.92 + radialSeed * 0.08;
          zone = 'photon';
        } else if (zoneSeed < 0.33) {
          var lensAngle = angleSeed * Math.PI * 2;
          var lensBand = Math.floor(depthSeed * 5);
          var lensRadius = minimumWorldSize * (
            0.22 +
            lensBand * 0.078 +
            radialSeed * 0.03
          );
          localX = Math.cos(lensAngle) * lensRadius;
          localY = Math.sin(lensAngle) * lensRadius * (0.92 + radialSeed * 0.06);
          heat = Math.max(0.12, 0.64 - lensRadius / (minimumWorldSize * 0.72));
          zone = 'lens';
        } else {
          var starXSeed = embeddingGraphScatterSeed(node.id + ':black-hole-star-x');
          var starYSeed = embeddingGraphScatterSeed(node.id + ':black-hole-star-y');
          localX = (starXSeed - 0.5) * sceneHalfWidth * 2;
          localY = (starYSeed - 0.5) * sceneHalfHeight * 2;
          var starDistance = Math.sqrt(localX * localX + localY * localY);
          if (starDistance < minimumWorldSize * 0.30) {
            var starPush = minimumWorldSize * (0.31 + depthSeed * 0.18) /
              Math.max(1, starDistance);
            localX *= starPush;
            localY *= starPush;
          }
          heat = 0.08 + radialSeed * 0.18;
          zone = 'star';
        }
        if (zone === 'star') {
          point.shapeTargetX = centerX + localX;
          point.shapeTargetY = centerY + localY;
        } else {
          point.shapeTargetX = centerX + localX * cosine - localY * sine;
          point.shapeTargetY = centerY + localX * sine + localY * cosine;
        }
        point.blackHoleZone = zone;
        point.blackHoleHeat = heat;
        point.blackHolePointSize = zone === 'photon'
          ? 0.82 + depthSeed * 0.48
          : (zone === 'star'
            ? 0.34 + depthSeed * 0.86
            : (zone === 'lens'
              ? 0.36 + depthSeed * 0.4
              : 0.56 + heat * 0.72 + (node.type === 'keyword' ? 0.2 : 0)));
        point.blackHoleColor = zone === 'star'
          ? (depthSeed > 0.86
            ? '#fff2e5'
            : (depthSeed > 0.58 ? '#dff5ff' : '#78b9de'))
          : (zone === 'photon'
            ? (depthSeed > 0.46 ? '#fffdf4' : '#ffe4c4')
            : (zone === 'lens'
              ? (depthSeed > 0.68 ? '#d9e9f2' : '#779ebc')
            : (heat > 0.68
              ? '#fff6e7'
              : (heat > 0.42 ? '#ffd0b8' : (heat > 0.2 ? '#d99392' : '#627f9d')))));
        point.cosmicShapeZone = zone;
        point.cosmicShapeHeat = heat;
        point.cosmicShapePointSize = point.blackHolePointSize;
        point.cosmicShapeColor = point.blackHoleColor;
      });
    }

    function assignEmbeddingObsidianGalaxyTargets(runtime) {
      if (!runtime) return;
      var centerX = runtime.worldWidth / 2;
      var centerY = runtime.worldHeight / 2;
      var minimumWorldSize = Math.min(runtime.worldWidth, runtime.worldHeight);
      var rotation = -0.56;
      var cosine = Math.cos(rotation);
      var sine = Math.sin(rotation);
      var sceneHalfWidth = Math.max(runtime.worldWidth * 0.47, minimumWorldSize * 0.72);
      var sceneHalfHeight = Math.max(
        runtime.worldHeight * 0.45,
        sceneHalfWidth * runtime.height / Math.max(1, runtime.width) * 0.9
      );
      Object.keys(runtime.points).forEach(function(id) {
        var point = runtime.points[id];
        var node = point.node;
        var zoneSeed = embeddingGraphScatterSeed(node.id + ':galaxy-zone');
        var xSeed = embeddingGraphScatterSeed(node.id + ':galaxy-x');
        var ySeed = embeddingGraphScatterSeed(node.id + ':galaxy-y');
        var depthSeed = embeddingGraphScatterSeed(node.id + ':galaxy-depth');
        var starXSeed = embeddingGraphScatterSeed(node.id + ':galaxy-star-x');
        var starYSeed = embeddingGraphScatterSeed(node.id + ':galaxy-star-y');
        var localX = 0;
        var localY = 0;
        var zone = 'nebula-cloud';
        var heat = 0;
        var pathProgress = xSeed * 2 - 1;
        var cloudLeft = Math.exp(-Math.pow((pathProgress + 0.64) / 0.25, 2));
        var cloudMiddle = Math.exp(-Math.pow((pathProgress + 0.04) / 0.31, 2));
        var cloudRight = Math.exp(-Math.pow((pathProgress - 0.58) / 0.24, 2));
        var cloudEnvelope = Math.min(
          1,
          cloudLeft * 0.9 + cloudMiddle * 0.78 + cloudRight
        );
        var cloudProbability = 0.18 + cloudEnvelope * 0.46;
        if (zoneSeed < cloudProbability) {
          localX = pathProgress * sceneHalfWidth * 0.96;
          var cloudCurve = (
            Math.sin(pathProgress * 3.2 + depthSeed * Math.PI * 2) * 0.032 +
            Math.sin(pathProgress * 8.6 - depthSeed * Math.PI * 1.4) * 0.012
          ) * minimumWorldSize;
          var cloudThickness = minimumWorldSize * (
            0.095 +
            cloudEnvelope * 0.19 +
            (0.5 + Math.sin(pathProgress * 11 + depthSeed * 7)) * 0.026
          );
          var cloudOffset = (ySeed + depthSeed - 1) * cloudThickness;
          localY = cloudCurve + cloudOffset;
          var cloudCenterAmount = Math.max(
            0,
            1 - Math.abs(cloudOffset) / Math.max(1, cloudThickness)
          );
          heat = 0.24 + cloudEnvelope * 0.5 + cloudCenterAmount * 0.22;
          zone = zoneSeed < cloudProbability * 0.18 ? 'dust' : 'nebula-cloud';
        } else {
          localX = (starXSeed - 0.5) * sceneHalfWidth * 2;
          localY = (starYSeed - 0.5) * sceneHalfHeight * 2;
          heat = 0.08 + depthSeed * 0.18;
          zone = 'star';
        }
        if (zone === 'star') {
          point.shapeTargetX = centerX + localX;
          point.shapeTargetY = centerY + localY;
        } else {
          point.shapeTargetX = centerX + localX * cosine - localY * sine;
          point.shapeTargetY = centerY + localX * sine + localY * cosine;
        }
        point.cosmicShapeZone = zone;
        point.cosmicShapeHeat = heat;
        point.cosmicShapePointSize = zone === 'star'
          ? 0.34 + depthSeed * 0.86
          : (zone === 'dust'
            ? 0.3 + depthSeed * 0.46
            : 0.52 + heat * 0.88 + (node.type === 'keyword' ? 0.2 : 0));
        point.cosmicShapeColor = zone === 'star'
          ? (depthSeed > 0.82 ? '#f7fbff' : '#8099bd')
          : (zone === 'dust'
            ? (depthSeed > 0.55 ? '#44516f' : '#28344e')
            : (heat > 0.76
              ? '#f2efff'
              : (heat > 0.52 ? '#c5c3eb' : '#7783b2')));
      });
    }

    function assignEmbeddingObsidianSaturnTargets(runtime) {
      if (!runtime) return;
      var centerX = runtime.worldWidth / 2;
      var centerY = runtime.worldHeight * 0.49;
      var minimumWorldSize = Math.min(runtime.worldWidth, runtime.worldHeight);
      var planetRadius = minimumWorldSize * 0.23;
      var ringTilt = -0.16;
      var ringCosine = Math.cos(ringTilt);
      var ringSine = Math.sin(ringTilt);
      var sceneHalfWidth = Math.max(runtime.worldWidth * 0.47, planetRadius * 2.9);
      var sceneHalfHeight = Math.max(
        runtime.worldHeight * 0.45,
        sceneHalfWidth * runtime.height / Math.max(1, runtime.width) * 0.92
      );
      Object.keys(runtime.points).forEach(function(id) {
        var point = runtime.points[id];
        var node = point.node;
        var zoneSeed = embeddingGraphScatterSeed(node.id + ':saturn-zone');
        var radialSeed = embeddingGraphScatterSeed(node.id + ':saturn-radius');
        var angleSeed = embeddingGraphScatterSeed(node.id + ':saturn-angle');
        var depthSeed = embeddingGraphScatterSeed(node.id + ':saturn-depth');
        var detailSeed = embeddingGraphScatterSeed(node.id + ':saturn-detail');
        var localX = 0;
        var localY = 0;
        var heat = 0;
        var zone = 'planet';
        var color = '#c89555';
        if (zoneSeed < 0.45) {
          var planetAngle = angleSeed * Math.PI * 2;
          var planetDistance = planetRadius * Math.sqrt(radialSeed);
          localX = Math.cos(planetAngle) * planetDistance;
          localY = Math.sin(planetAngle) * planetDistance * 0.94;
          var normalizedLatitude = localY / Math.max(1, planetRadius * 0.94);
          var latitudeBand = Math.sin(normalizedLatitude * Math.PI * 12 + detailSeed * 0.7);
          var surfaceLight = Math.max(
            0,
            Math.min(
              1,
              0.56 -
                localX / Math.max(1, planetRadius) * 0.22 -
                localY / Math.max(1, planetRadius) * 0.08 +
                latitudeBand * 0.11
            )
          );
          heat = surfaceLight;
          zone = 'planet';
          color = surfaceLight > 0.72
            ? '#f4d39a'
            : (surfaceLight > 0.54
              ? '#d7aa6b'
              : (surfaceLight > 0.36 ? '#a8733f' : '#684126'));
        } else if (zoneSeed < 0.82) {
          var ringAngle = angleSeed * Math.PI * 2;
          var ringBand = Math.min(5, Math.floor(radialSeed * 6));
          var ringBandJitter = embeddingGraphScatterSeed(node.id + ':saturn-ring-band');
          var ringRadius = planetRadius * (
            1.34 +
            ringBand * 0.235 +
            ringBandJitter * 0.095
          );
          var ringX = Math.cos(ringAngle) * ringRadius;
          var ringY = Math.sin(ringAngle) * ringRadius * (0.16 + depthSeed * 0.035);
          localX = ringX * ringCosine - ringY * ringSine;
          localY = ringX * ringSine + ringY * ringCosine;
          var isFrontRing = Math.sin(ringAngle) >= 0;
          heat = 0.48 + (5 - ringBand) * 0.065 + (isFrontRing ? 0.12 : 0);
          zone = isFrontRing ? 'ring-front' : 'ring-back';
          color = isFrontRing
            ? (ringBand % 2 === 0 ? '#f1c477' : '#c99550')
            : (ringBand % 2 === 0 ? '#9b7343' : '#6f5034');
        } else {
          var starXSeed = embeddingGraphScatterSeed(node.id + ':saturn-star-x');
          var starYSeed = embeddingGraphScatterSeed(node.id + ':saturn-star-y');
          localX = (starXSeed - 0.5) * sceneHalfWidth * 2;
          localY = (starYSeed - 0.5) * sceneHalfHeight * 2;
          heat = 0.08 + depthSeed * 0.2;
          zone = 'star';
          color = depthSeed > 0.84
            ? '#fff4d8'
            : (detailSeed > 0.62 ? '#d9e9f7' : '#849ab2');
        }
        point.shapeTargetX = centerX + localX;
        point.shapeTargetY = centerY + localY;
        point.cosmicShapeZone = zone;
        point.cosmicShapeHeat = heat;
        point.cosmicShapePointSize = zone === 'star'
          ? 0.34 + depthSeed * 0.86
          : (zone === 'planet'
            ? 0.52 + heat * 0.66 + (node.type === 'keyword' ? 0.18 : 0)
            : 0.42 + heat * 0.52 + (node.type === 'keyword' ? 0.14 : 0));
        point.cosmicShapeColor = color;
      });
    }

    function assignEmbeddingObsidianStarfieldTargets(runtime) {
      if (!runtime) return;
      var horizontalPadding = runtime.worldWidth * 0.035;
      var verticalPadding = runtime.worldHeight * 0.045;
      var usableWidth = Math.max(1, runtime.worldWidth - horizontalPadding * 2);
      var usableHeight = Math.max(1, runtime.worldHeight - verticalPadding * 2);
      var maximumConnectionCount = Object.keys(runtime.points).reduce(function(maximum, id) {
        var point = runtime.points[id];
        var connectionCount = Math.max(
          1,
          Number(runtime.degrees[id] || point.node.value || 1)
        );
        return Math.max(maximum, connectionCount);
      }, 1);
      var maximumConnectionLog = Math.max(1, Math.log1p(maximumConnectionCount));
      Object.keys(runtime.points).forEach(function(id) {
        var point = runtime.points[id];
        var node = point.node;
        var xSeed = embeddingGraphScatterSeed(node.id + ':starfield-x');
        var ySeed = embeddingGraphScatterSeed(node.id + ':starfield-y');
        var depthSeed = embeddingGraphScatterSeed(node.id + ':starfield-depth');
        var warmthSeed = embeddingGraphScatterSeed(node.id + ':starfield-warmth');
        var brightnessSeed = embeddingGraphScatterSeed(node.id + ':starfield-brightness');
        var connectionCount = Math.max(
          1,
          Number(runtime.degrees[id] || node.value || 1)
        );
        var connectionSizeRatio = Math.log1p(connectionCount) / maximumConnectionLog;
        point.shapeTargetX = horizontalPadding + xSeed * usableWidth;
        point.shapeTargetY = verticalPadding + ySeed * usableHeight;
        var isBrightStar = connectionSizeRatio > 0.48 || brightnessSeed > 0.97;
        point.cosmicShapeZone = isBrightStar ? 'star-bright' : 'star';
        point.cosmicShapeHeat = isBrightStar
          ? 0.68 + Math.max(brightnessSeed, connectionSizeRatio) * 0.32
          : 0.08 + brightnessSeed * 0.34;
        point.cosmicShapePointSize = Math.min(
          3.6,
          0.3 + depthSeed * 0.34 + connectionSizeRatio * 2.86
        );
        point.starfieldConnectionCount = connectionCount;
        point.starfieldSizeRatio = connectionSizeRatio;
        point.cosmicShapeColor = isBrightStar
          ? (warmthSeed > 0.72
            ? '#ffe4ad'
            : (warmthSeed < 0.22 ? '#c9e7ff' : '#fffdf3'))
          : (depthSeed > 0.78
            ? '#e9f4ff'
            : (warmthSeed > 0.8 ? '#d8c9a6' : '#728eae'));
      });
    }

    function setEmbeddingObsidianArtworkPoint(
      runtime,
      point,
      x,
      y,
      zone,
      color,
      size,
      heat
    ) {
      var padding = Math.max(12, Math.min(runtime.worldWidth, runtime.worldHeight) * 0.012);
      point.shapeTargetX = Math.max(padding, Math.min(runtime.worldWidth - padding, x));
      point.shapeTargetY = Math.max(padding, Math.min(runtime.worldHeight - padding, y));
      point.cosmicShapeZone = zone;
      point.cosmicShapeColor = color;
      point.cosmicShapePointSize = size;
      point.cosmicShapeHeat = heat;
    }

    function assignEmbeddingObsidianStarryNightTargets(runtime) {
      if (!runtime) return;
      var width = runtime.worldWidth;
      var height = runtime.worldHeight;
      var minimumWorldSize = Math.min(width, height);
      var vortexes = [
        { x: 0.34, y: 0.31, radius: 0.25, stretch: 1.48 },
        { x: 0.60, y: 0.25, radius: 0.19, stretch: 1.34 },
        { x: 0.72, y: 0.42, radius: 0.16, stretch: 1.28 }
      ];
      var stars = [
        { x: 0.17, y: 0.18, radius: 0.024 },
        { x: 0.29, y: 0.13, radius: 0.019 },
        { x: 0.47, y: 0.17, radius: 0.021 },
        { x: 0.65, y: 0.12, radius: 0.018 },
        { x: 0.75, y: 0.26, radius: 0.023 },
        { x: 0.89, y: 0.31, radius: 0.018 }
      ];
      Object.keys(runtime.points).forEach(function(id) {
        var point = runtime.points[id];
        var node = point.node;
        var zoneSeed = embeddingGraphScatterSeed(node.id + ':starry-night-zone');
        var pathSeed = embeddingGraphScatterSeed(node.id + ':starry-night-path');
        var radialSeed = embeddingGraphScatterSeed(node.id + ':starry-night-radius');
        var angleSeed = embeddingGraphScatterSeed(node.id + ':starry-night-angle');
        var detailSeed = embeddingGraphScatterSeed(node.id + ':starry-night-detail');
        var targetX = width / 2;
        var targetY = height / 2;
        var zone = 'sky-swirl';
        var color = '#438acb';
        var size = 0.58 + detailSeed * 0.66;
        var heat = 0.2 + detailSeed * 0.34;
        if (zoneSeed < 0.55) {
          var vortexIndex = Math.min(
            vortexes.length - 1,
            Math.floor(pathSeed * vortexes.length)
          );
          var vortex = vortexes[vortexIndex];
          var swirlAngle = angleSeed * Math.PI * 2 + radialSeed * Math.PI * 5.2;
          var swirlRadius = minimumWorldSize * (
            0.018 + Math.pow(radialSeed, 0.72) * vortex.radius
          );
          var strokeWave = Math.sin(
            swirlAngle * 2.4 + detailSeed * Math.PI * 2
          ) * minimumWorldSize * 0.009;
          targetX = width * vortex.x +
            Math.cos(swirlAngle) * swirlRadius * vortex.stretch;
          targetY = height * vortex.y +
            Math.sin(swirlAngle) * swirlRadius * 0.58 +
            strokeWave;
          heat = 0.28 + (1 - radialSeed) * 0.38 + detailSeed * 0.16;
          zone = detailSeed > 0.86 ? 'sky-highlight' : 'sky-swirl';
          color = zone === 'sky-highlight'
            ? (detailSeed > 0.95 ? '#fff1a8' : '#8fd6e8')
            : (radialSeed > 0.66
              ? '#174a91'
              : (detailSeed > 0.52 ? '#3f93ca' : '#225fa7'));
          size = 0.52 + heat * 0.82 + (node.type === 'keyword' ? 0.16 : 0);
        } else if (zoneSeed < 0.69) {
          if (pathSeed < 0.35) {
            var moonAngle = angleSeed * Math.PI * 2;
            var moonRadius = minimumWorldSize * 0.078 * Math.sqrt(radialSeed);
            targetX = width * 0.86 + Math.cos(moonAngle) * moonRadius;
            targetY = height * 0.17 + Math.sin(moonAngle) * moonRadius;
            zone = radialSeed > 0.76 ? 'moon-halo' : 'moon';
            color = radialSeed > 0.76
              ? '#f3c85c'
              : (detailSeed > 0.48 ? '#fff4b0' : '#ffd964');
            heat = 0.84 + detailSeed * 0.16;
            size = 0.72 + detailSeed * 0.78;
          } else {
            var starIndex = Math.min(
              stars.length - 1,
              Math.floor((pathSeed - 0.35) / 0.65 * stars.length)
            );
            var star = stars[starIndex];
            var starAngle = angleSeed * Math.PI * 2;
            var starRadius = minimumWorldSize * star.radius *
              (0.18 + Math.sqrt(radialSeed));
            targetX = width * star.x + Math.cos(starAngle) * starRadius;
            targetY = height * star.y + Math.sin(starAngle) * starRadius;
            zone = 'painted-star';
            color = detailSeed > 0.48 ? '#fff4b8' : '#f0c94f';
            heat = 0.72 + detailSeed * 0.28;
            size = 0.64 + detailSeed * 0.96;
          }
        } else if (zoneSeed < 0.85) {
          var cypressProgress = radialSeed;
          var cypressHalfWidth = minimumWorldSize * (
            0.018 + (1 - cypressProgress) * 0.073
          );
          var cypressFlame = Math.sin(
            cypressProgress * Math.PI * 9.5 + angleSeed * 2.2
          ) * minimumWorldSize * 0.012;
          targetX = width * 0.18 +
            (detailSeed * 2 - 1) * cypressHalfWidth +
            cypressFlame;
          targetY = height * (0.94 - cypressProgress * 0.56);
          zone = 'cypress';
          color = detailSeed > 0.72
            ? '#173b45'
            : (detailSeed > 0.34 ? '#102e39' : '#091d2d');
          heat = 0.12 + detailSeed * 0.16;
          size = 0.62 + detailSeed * 0.56;
        } else {
          var horizonX = 0.04 + pathSeed * 0.92;
          var hillWave = Math.sin(horizonX * Math.PI * 3.2) * 0.035 +
            Math.sin(horizonX * Math.PI * 8.1 + detailSeed) * 0.014;
          targetX = width * horizonX;
          targetY = height * (
            0.78 + hillWave + (radialSeed - 0.5) * 0.12
          );
          var isVillageLight = detailSeed > 0.91 && radialSeed < 0.62;
          zone = isVillageLight ? 'village-light' : 'village-hill';
          color = isVillageLight
            ? '#f6d76b'
            : (detailSeed > 0.58 ? '#315b65' : '#183849');
          heat = isVillageLight ? 0.76 : 0.18 + detailSeed * 0.15;
          size = isVillageLight
            ? 0.74 + detailSeed * 0.62
            : 0.48 + detailSeed * 0.54;
        }
        setEmbeddingObsidianArtworkPoint(
          runtime,
          point,
          targetX,
          targetY,
          zone,
          color,
          size,
          heat
        );
      });
    }

    function assignEmbeddingObsidianPaintedEyeTargets(runtime) {
      if (!runtime) return;
      var width = runtime.worldWidth;
      var height = runtime.worldHeight;
      var minimumWorldSize = Math.min(width, height);
      var centerX = width * 0.51;
      var centerY = height * 0.49;
      var eyeHalfWidth = Math.min(width * 0.37, minimumWorldSize * 0.63);
      var eyeHalfHeight = Math.min(height * 0.30, minimumWorldSize * 0.28);
      var irisRadius = minimumWorldSize * 0.205;
      var pupilRadius = irisRadius * 0.34;
      var paintStrokes = [
        { x1: 0.12, y1: 0.22, x2: 0.42, y2: 0.07, color: '#f15a37' },
        { x1: 0.62, y1: 0.10, x2: 0.91, y2: 0.28, color: '#ef476f' },
        { x1: 0.11, y1: 0.77, x2: 0.39, y2: 0.92, color: '#e5a62b' },
        { x1: 0.63, y1: 0.88, x2: 0.92, y2: 0.69, color: '#29b7a7' },
        { x1: 0.19, y1: 0.48, x2: 0.83, y2: 0.52, color: '#5f4dc4' }
      ];
      Object.keys(runtime.points).forEach(function(id) {
        var point = runtime.points[id];
        var node = point.node;
        var zoneSeed = embeddingGraphScatterSeed(node.id + ':painted-eye-zone');
        var xSeed = embeddingGraphScatterSeed(node.id + ':painted-eye-x');
        var ySeed = embeddingGraphScatterSeed(node.id + ':painted-eye-y');
        var angleSeed = embeddingGraphScatterSeed(node.id + ':painted-eye-angle');
        var detailSeed = embeddingGraphScatterSeed(node.id + ':painted-eye-detail');
        var targetX = centerX;
        var targetY = centerY;
        var zone = 'iris';
        var color = '#25b9c4';
        var size = 0.72;
        var heat = 0.5;
        if (zoneSeed < 0.40) {
          var irisAngle = angleSeed * Math.PI * 2;
          var irisDistance = irisRadius * Math.sqrt(xSeed);
          var irisGrain = Math.sin(irisAngle * 17 + ySeed * 7) *
            minimumWorldSize * 0.006;
          targetX = centerX + Math.cos(irisAngle) * (irisDistance + irisGrain);
          targetY = centerY + Math.sin(irisAngle) * (irisDistance + irisGrain);
          zone = 'iris';
          heat = 0.42 + (1 - xSeed) * 0.38 + detailSeed * 0.15;
          color = detailSeed > 0.78
            ? '#f6c453'
            : (xSeed < 0.32
              ? '#33d7d0'
              : (detailSeed > 0.42 ? '#1aa6c7' : '#2965a8'));
          size = 0.56 + heat * 0.82 + (node.type === 'keyword' ? 0.16 : 0);
        } else if (zoneSeed < 0.51) {
          var pupilAngle = angleSeed * Math.PI * 2;
          var pupilDistance = pupilRadius * Math.sqrt(xSeed);
          targetX = centerX + Math.cos(pupilAngle) * pupilDistance;
          targetY = centerY + Math.sin(pupilAngle) * pupilDistance;
          zone = detailSeed > 0.88 ? 'eye-glint' : 'pupil';
          color = zone === 'eye-glint' ? '#fffdf5' : '#07121c';
          heat = zone === 'eye-glint' ? 1 : 0.06;
          size = zone === 'eye-glint'
            ? 0.82 + detailSeed * 0.78
            : 0.58 + detailSeed * 0.56;
        } else if (zoneSeed < 0.74) {
          var lidProgress = xSeed * 2 - 1;
          var lidEnvelope = Math.sqrt(Math.max(0, 1 - lidProgress * lidProgress));
          var isUpperLid = detailSeed > 0.5;
          targetX = centerX + lidProgress * eyeHalfWidth;
          targetY = centerY +
            (isUpperLid ? -1 : 1) * eyeHalfHeight * lidEnvelope +
            (ySeed - 0.5) * minimumWorldSize * 0.022;
          zone = isUpperLid ? 'upper-lid' : 'lower-lid';
          color = isUpperLid
            ? (angleSeed > 0.52 ? '#5a2b8a' : '#db3d76')
            : (angleSeed > 0.48 ? '#ef7b35' : '#7546a8');
          heat = 0.48 + angleSeed * 0.3;
          size = 0.62 + detailSeed * 0.72;
        } else if (zoneSeed < 0.88) {
          var scleraProgress = xSeed * 2 - 1;
          var scleraEnvelope = Math.sqrt(
            Math.max(0, 1 - scleraProgress * scleraProgress)
          );
          var scleraY = (ySeed * 2 - 1) * eyeHalfHeight * scleraEnvelope * 0.82;
          var scleraDistance = Math.sqrt(
            Math.pow(scleraProgress * eyeHalfWidth, 2) +
            Math.pow(scleraY, 2)
          );
          if (scleraDistance < irisRadius * 1.08) {
            scleraY += (scleraY >= 0 ? 1 : -1) *
              (irisRadius * 1.08 - scleraDistance);
          }
          targetX = centerX + scleraProgress * eyeHalfWidth;
          targetY = centerY + scleraY;
          zone = 'sclera';
          color = detailSeed > 0.72 ? '#fff4db' : '#dfe9e3';
          heat = 0.55 + detailSeed * 0.18;
          size = 0.44 + detailSeed * 0.5;
        } else {
          var strokeIndex = Math.min(
            paintStrokes.length - 1,
            Math.floor(xSeed * paintStrokes.length)
          );
          var stroke = paintStrokes[strokeIndex];
          var strokeProgress = ySeed;
          targetX = width * (
            stroke.x1 + (stroke.x2 - stroke.x1) * strokeProgress
          ) + (detailSeed - 0.5) * minimumWorldSize * 0.055;
          targetY = height * (
            stroke.y1 + (stroke.y2 - stroke.y1) * strokeProgress
          ) + (angleSeed - 0.5) * minimumWorldSize * 0.04;
          zone = 'paint-stroke';
          color = stroke.color;
          heat = 0.36 + detailSeed * 0.38;
          size = 0.48 + detailSeed * 0.68;
        }
        setEmbeddingObsidianArtworkPoint(
          runtime,
          point,
          targetX,
          targetY,
          zone,
          color,
          size,
          heat
        );
      });
    }

    function assignEmbeddingObsidianCubistFaceTargets(runtime) {
      if (!runtime) return;
      var width = runtime.worldWidth;
      var height = runtime.worldHeight;
      var minimumWorldSize = Math.min(width, height);
      var centerX = width * 0.51;
      var centerY = height * 0.50;
      var faceRadiusX = Math.min(width * 0.26, minimumWorldSize * 0.34);
      var faceRadiusY = Math.min(height * 0.39, minimumWorldSize * 0.43);
      var panelColors = [
        '#f2c84b',
        '#e45536',
        '#47a7c2',
        '#244b82',
        '#f4eee0',
        '#17191d'
      ];
      var frameSegments = [
        { x1: 0.18, y1: 0.17, x2: 0.38, y2: 0.08 },
        { x1: 0.63, y1: 0.10, x2: 0.86, y2: 0.27 },
        { x1: 0.13, y1: 0.70, x2: 0.36, y2: 0.92 },
        { x1: 0.66, y1: 0.91, x2: 0.90, y2: 0.67 }
      ];
      Object.keys(runtime.points).forEach(function(id) {
        var point = runtime.points[id];
        var node = point.node;
        var zoneSeed = embeddingGraphScatterSeed(node.id + ':cubist-face-zone');
        var radialSeed = embeddingGraphScatterSeed(node.id + ':cubist-face-radius');
        var angleSeed = embeddingGraphScatterSeed(node.id + ':cubist-face-angle');
        var detailSeed = embeddingGraphScatterSeed(node.id + ':cubist-face-detail');
        var panelSeed = embeddingGraphScatterSeed(node.id + ':cubist-face-panel');
        var targetX = centerX;
        var targetY = centerY;
        var zone = 'face-panel';
        var color = '#f2c84b';
        var size = 0.68;
        var heat = 0.46;
        if (zoneSeed < 0.47) {
          var faceAngle = angleSeed * Math.PI * 2;
          var faceDistance = Math.sqrt(radialSeed);
          var angularFacet = 1 + (
            Math.floor((faceAngle + Math.PI) / (Math.PI / 6)) % 2 === 0
              ? 0.08
              : -0.04
          );
          var asymmetry = Math.sin(faceAngle * 3 + panelSeed * 5) * 0.07;
          targetX = centerX +
            Math.cos(faceAngle) * faceRadiusX * faceDistance *
            (angularFacet + asymmetry);
          targetY = centerY +
            Math.sin(faceAngle) * faceRadiusY * faceDistance *
            (1 - asymmetry * 0.5);
          var panelIndex = Math.min(
            panelColors.length - 1,
            Math.floor(panelSeed * panelColors.length)
          );
          zone = 'face-panel-' + panelIndex;
          color = panelColors[panelIndex];
          heat = 0.38 + detailSeed * 0.42;
          size = 0.5 + detailSeed * 0.78 + (node.type === 'keyword' ? 0.14 : 0);
        } else if (zoneSeed < 0.61) {
          var isRightEye = detailSeed > 0.5;
          var eyeCenterX = centerX + (isRightEye ? 1 : -1) * faceRadiusX * 0.38;
          var eyeCenterY = centerY - faceRadiusY * (isRightEye ? 0.20 : 0.15);
          var eyeAngle = angleSeed * Math.PI * 2;
          var eyeRadiusX = faceRadiusX * (isRightEye ? 0.22 : 0.18);
          var eyeRadiusY = faceRadiusY * 0.075;
          targetX = eyeCenterX + Math.cos(eyeAngle) * eyeRadiusX *
            (0.35 + radialSeed * 0.65);
          targetY = eyeCenterY + Math.sin(eyeAngle) * eyeRadiusY *
            (0.45 + radialSeed * 0.55);
          zone = isRightEye ? 'right-eye' : 'left-eye';
          color = angleSeed > 0.82
            ? '#f7f1dc'
            : (isRightEye ? '#153b69' : '#111318');
          heat = 0.34 + detailSeed * 0.4;
          size = 0.58 + detailSeed * 0.72;
        } else if (zoneSeed < 0.72) {
          var noseProgress = radialSeed;
          var noseSide = detailSeed > 0.52 ? 1 : -1;
          targetX = centerX +
            faceRadiusX * (
              -0.04 +
              noseSide * 0.12 * Math.sin(noseProgress * Math.PI)
            );
          targetY = centerY -
            faceRadiusY * 0.12 +
            noseProgress * faceRadiusY * 0.46;
          zone = 'nose';
          color = noseSide > 0 ? '#e45536' : '#245c92';
          heat = 0.48 + angleSeed * 0.28;
          size = 0.56 + detailSeed * 0.66;
        } else if (zoneSeed < 0.82) {
          var mouthAngle = angleSeed * Math.PI * 2;
          var mouthRadius = Math.sqrt(radialSeed);
          targetX = centerX +
            Math.cos(mouthAngle) * faceRadiusX * 0.29 * mouthRadius;
          targetY = centerY +
            faceRadiusY * 0.34 +
            Math.sin(mouthAngle) * faceRadiusY * 0.075 * mouthRadius;
          zone = 'mouth';
          color = detailSeed > 0.43 ? '#d7383e' : '#7b1e35';
          heat = 0.58 + detailSeed * 0.32;
          size = 0.62 + detailSeed * 0.72;
        } else if (zoneSeed < 0.90) {
          var isRightEar = detailSeed > 0.5;
          var earAngle = angleSeed * Math.PI * 2;
          targetX = centerX +
            (isRightEar ? 1 : -1) * faceRadiusX * 1.03 +
            Math.cos(earAngle) * faceRadiusX * 0.11;
          targetY = centerY +
            Math.sin(earAngle) * faceRadiusY * 0.22;
          zone = 'ear';
          color = isRightEar ? '#f2c84b' : '#47a7c2';
          heat = 0.4 + detailSeed * 0.24;
          size = 0.48 + detailSeed * 0.6;
        } else {
          var frameIndex = Math.min(
            frameSegments.length - 1,
            Math.floor(radialSeed * frameSegments.length)
          );
          var segment = frameSegments[frameIndex];
          var frameProgress = angleSeed;
          targetX = width * (
            segment.x1 + (segment.x2 - segment.x1) * frameProgress
          ) + (detailSeed - 0.5) * minimumWorldSize * 0.035;
          targetY = height * (
            segment.y1 + (segment.y2 - segment.y1) * frameProgress
          ) + (panelSeed - 0.5) * minimumWorldSize * 0.035;
          zone = 'geometric-frame';
          color = panelColors[
            Math.min(
              panelColors.length - 1,
              Math.floor(detailSeed * panelColors.length)
            )
          ];
          heat = 0.3 + detailSeed * 0.36;
          size = 0.44 + panelSeed * 0.62;
        }
        setEmbeddingObsidianArtworkPoint(
          runtime,
          point,
          targetX,
          targetY,
          zone,
          color,
          size,
          heat
        );
      });
    }

    function assignEmbeddingObsidianShapeTargets(runtime) {
      if (!runtime) return;
      if (runtime.shapeMode === 'blackhole') {
        assignEmbeddingObsidianBlackHoleTargets(runtime);
      } else if (runtime.shapeMode === 'saturn') {
        assignEmbeddingObsidianSaturnTargets(runtime);
      } else if (runtime.shapeMode === 'galaxy') {
        assignEmbeddingObsidianGalaxyTargets(runtime);
      } else if (runtime.shapeMode === 'starfield') {
        assignEmbeddingObsidianStarfieldTargets(runtime);
      } else if (runtime.shapeMode === 'starrynight') {
        assignEmbeddingObsidianStarryNightTargets(runtime);
      } else if (runtime.shapeMode === 'painted-eye') {
        assignEmbeddingObsidianPaintedEyeTargets(runtime);
      } else if (runtime.shapeMode === 'cubist-face') {
        assignEmbeddingObsidianCubistFaceTargets(runtime);
      }
    }

    window.selectEmbeddingObsidianShape = function(shape) {
      closeEmbeddingObsidianControlMenus();
      var runtime = embeddingGraphRuntime;
      if (!runtime) return;
      var supportedShapes = {
        circle: true,
        blackhole: true,
        saturn: true,
        galaxy: true,
        starfield: true,
        starrynight: true,
        'painted-eye': true,
        'cubist-face': true
      };
      if (!supportedShapes[shape]) return;
      if (runtime.shapeMode === shape) {
        updateEmbeddingObsidianShapeButton(runtime);
        return;
      }
      runtime.shapeMode = shape;
      if (runtime.shapeMode !== 'circle') {
        runtime.shapeTransitionStartedAt = typeof performance !== 'undefined'
          ? performance.now()
          : Date.now();
        assignEmbeddingObsidianShapeTargets(runtime);
        if (runtime.shapeMode === 'starfield') {
          Object.keys(runtime.points).forEach(function(id) {
            var point = runtime.points[id];
            if (!Number.isFinite(point.shapeTargetX) || !Number.isFinite(point.shapeTargetY)) return;
            point.x = point.shapeTargetX;
            point.y = point.shapeTargetY;
            point.vx = 0;
            point.vy = 0;
          });
          runtime.shapeTransitionStartedAt = 0;
        } else if (runtime.shapeMode === 'blackhole') {
          Object.keys(runtime.points).forEach(function(id) {
            var point = runtime.points[id];
            if (
              point.blackHoleZone !== 'star' ||
              !Number.isFinite(point.shapeTargetX) ||
              !Number.isFinite(point.shapeTargetY)
            ) return;
            point.x = point.shapeTargetX;
            point.y = point.shapeTargetY;
            point.vx = 0;
            point.vy = 0;
          });
        } else if (runtime.shapeMode === 'galaxy' || runtime.shapeMode === 'saturn') {
          Object.keys(runtime.points).forEach(function(id) {
            var point = runtime.points[id];
            if (
              point.cosmicShapeZone !== 'star' ||
              !Number.isFinite(point.shapeTargetX) ||
              !Number.isFinite(point.shapeTargetY)
            ) return;
            point.x = point.shapeTargetX;
            point.y = point.shapeTargetY;
            point.vx = 0;
            point.vy = 0;
          });
        }
      } else {
        runtime.shapeTransitionStartedAt = 0;
        Object.keys(runtime.points).forEach(function(id) {
          runtime.points[id].shapeTargetX = null;
          runtime.points[id].shapeTargetY = null;
          runtime.points[id].blackHoleZone = '';
          runtime.points[id].blackHoleColor = '';
          runtime.points[id].cosmicShapeZone = '';
          runtime.points[id].cosmicShapeColor = '';
        });
      }
      runtime.alpha = Math.max(runtime.alpha, 0.95);
      updateEmbeddingObsidianShapeButton(runtime);
      if (runtime.shapeMode !== 'circle') {
        var selectedShape = runtime.shapeMode;
        var fitSelectedShape = function() {
          if (
            embeddingGraphRuntime === runtime &&
            runtime.shapeMode === selectedShape
          ) {
            fitEmbeddingObsidianGraph();
          }
        };
        if (selectedShape === 'starfield') {
          requestAnimationFrame(fitSelectedShape);
        } else {
          setTimeout(fitSelectedShape, 5200);
        }
      }
    };

    window.toggleEmbeddingObsidianShape = function(shape) {
      window.selectEmbeddingObsidianShape(shape);
    };

    window.toggleEmbeddingObsidianBlackHoleShape = function() {
      window.selectEmbeddingObsidianShape('blackhole');
    };

    function stopEmbeddingObsidianAudio(runtime, clearEffect) {
      if (!runtime) return;
      runtime.audioRequestId = Number(runtime.audioRequestId || 0) + 1;
      if (runtime.audioSource && typeof runtime.audioSource.disconnect === 'function') {
        try {
          runtime.audioSource.disconnect();
        } catch (_error) {}
      }
      if (runtime.audioStream && typeof runtime.audioStream.getTracks === 'function') {
        runtime.audioStream.getTracks().forEach(function(track) {
          try {
            track.stop();
          } catch (_error) {}
        });
      }
      if (runtime.audioContext && typeof runtime.audioContext.close === 'function') {
        try {
          var closeResult = runtime.audioContext.close();
          if (closeResult && typeof closeResult.catch === 'function') {
            closeResult.catch(function() {});
          }
        } catch (_error) {}
      }
      runtime.audioStream = null;
      runtime.audioContext = null;
      runtime.audioSource = null;
      runtime.audioAnalyser = null;
      runtime.audioTimeData = null;
      runtime.audioFrequencyData = null;
      runtime.audioLevel = 0;
      runtime.audioLow = 0;
      runtime.audioMid = 0;
      runtime.audioHigh = 0;
      runtime.audioWaveHistory = [];
      if (clearEffect && runtime.motionEffect === 'voice') {
        runtime.motionEffect = '';
        runtime.motionEffectStartedAt = 0;
      }
    }

    async function startEmbeddingObsidianAudio(runtime) {
      if (
        !runtime ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        throw new Error('当前环境不支持麦克风访问');
      }
      var AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) {
        throw new Error('当前环境不支持实时音频分析');
      }
      stopEmbeddingObsidianAudio(runtime, true);
      var requestId = Number(runtime.audioRequestId || 0) + 1;
      runtime.audioRequestId = requestId;
      var stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        video: false
      });
      if (
        runtime.destroyed ||
        embeddingGraphRuntime !== runtime ||
        runtime.audioRequestId !== requestId
      ) {
        stream.getTracks().forEach(function(track) { track.stop(); });
        return false;
      }
      var audioContext = new AudioContextConstructor();
      if (audioContext.state === 'suspended' && typeof audioContext.resume === 'function') {
        await audioContext.resume();
      }
      var source = audioContext.createMediaStreamSource(stream);
      var analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.82;
      source.connect(analyser);
      runtime.audioStream = stream;
      runtime.audioContext = audioContext;
      runtime.audioSource = source;
      runtime.audioAnalyser = analyser;
      runtime.audioTimeData = new Uint8Array(analyser.fftSize);
      runtime.audioFrequencyData = new Uint8Array(analyser.frequencyBinCount);
      runtime.audioLevel = 0;
      runtime.audioLow = 0;
      runtime.audioMid = 0;
      runtime.audioHigh = 0;
      runtime.audioWaveHistory = [];
      runtime.motionEffect = 'voice';
      runtime.motionEffectStartedAt = typeof performance !== 'undefined'
        ? performance.now()
        : Date.now();
      runtime.alpha = Math.max(runtime.alpha, 0.9);
      updateEmbeddingObsidianMotionButtons(runtime);
      return true;
    }

    function sampleEmbeddingObsidianAudio(runtime) {
      var analyser = runtime && runtime.audioAnalyser;
      var timeData = runtime && runtime.audioTimeData;
      var frequencyData = runtime && runtime.audioFrequencyData;
      var audioContext = runtime && runtime.audioContext;
      if (!analyser || !timeData || !frequencyData || !audioContext) return;
      analyser.getByteTimeDomainData(timeData);
      analyser.getByteFrequencyData(frequencyData);
      var sumSquares = 0;
      for (var index = 0; index < timeData.length; index += 1) {
        var centered = (timeData[index] - 128) / 128;
        sumSquares += centered * centered;
      }
      var rms = Math.sqrt(sumSquares / Math.max(1, timeData.length));
      var rawLevel = Math.max(0, Math.min(1, (rms - 0.018) / 0.15));
      var binWidth = audioContext.sampleRate / analyser.fftSize;
      function averageBand(minHz, maxHz) {
        var start = Math.max(0, Math.floor(minHz / binWidth));
        var end = Math.min(frequencyData.length - 1, Math.ceil(maxHz / binWidth));
        if (end < start) return 0;
        var total = 0;
        for (var bandIndex = start; bandIndex <= end; bandIndex += 1) {
          total += frequencyData[bandIndex];
        }
        return total / Math.max(1, end - start + 1) / 255;
      }
      runtime.audioLevel += (rawLevel - runtime.audioLevel) * 0.2;
      runtime.audioLow += (averageBand(40, 260) - runtime.audioLow) * 0.16;
      runtime.audioMid += (averageBand(260, 2200) - runtime.audioMid) * 0.16;
      runtime.audioHigh += (averageBand(2200, 8000) - runtime.audioHigh) * 0.16;
      if (!Array.isArray(runtime.audioWaveHistory)) runtime.audioWaveHistory = [];
      runtime.audioWaveHistory.unshift({
        level: runtime.audioLevel,
        low: runtime.audioLow,
        mid: runtime.audioMid,
        high: runtime.audioHigh
      });
      if (runtime.audioWaveHistory.length > 180) {
        runtime.audioWaveHistory.length = 180;
      }
      var voiceButton = document.querySelector(
        '#embeddingLibraryModal .embedding-obsidian-motion-action[data-motion-effect="voice"]'
      );
      if (voiceButton) {
        voiceButton.style.setProperty('--voice-scale', String(0.82 + runtime.audioLevel * 1.7));
        voiceButton.style.setProperty('--voice-glow', String(runtime.audioLevel * 8) + 'px');
      }
    }

    window.triggerEmbeddingObsidianMotionEffect = async function(effect) {
      closeEmbeddingObsidianControlMenus();
      var runtime = embeddingGraphRuntime;
      if (!runtime) return;
      var supportedEffects = {
        wave: true,
        vortex: true,
        breathe: true,
        voice: true
      };
      if (!supportedEffects[effect]) return;
      if (runtime.motionEffect === effect) {
        if (effect === 'voice') stopEmbeddingObsidianAudio(runtime, true);
        runtime.motionEffect = '';
        runtime.motionEffectStartedAt = 0;
        Object.keys(runtime.points || {}).forEach(function(id) {
          var point = runtime.points[id];
          point.vx *= 0.35;
          point.vy *= 0.35;
        });
        updateEmbeddingObsidianMotionButtons(runtime);
        return;
      }
      if (runtime.motionEffect === 'voice' || runtime.audioStream) {
        stopEmbeddingObsidianAudio(runtime, true);
      }
      if (effect === 'voice') {
        try {
          await startEmbeddingObsidianAudio(runtime);
        } catch (error) {
          stopEmbeddingObsidianAudio(runtime, true);
          updateEmbeddingObsidianMotionButtons(runtime);
          alert('无法启用声浪：' + (error && error.message ? error.message : String(error)));
        }
        return;
      }
      var now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      runtime.motionEffect = effect;
      runtime.motionEffectStartedAt = now;
      runtime.alpha = Math.max(runtime.alpha, 0.9);
      updateEmbeddingObsidianMotionButtons(runtime);
    };

    function getEmbeddingObsidianMotionFrame(runtime, time) {
      if (!runtime || !runtime.motionEffect) return null;
      var cycleDurations = {
        wave: 30000,
        vortex: 12000,
        breathe: 30000,
        voice: 1000
      };
      var cycleDuration = cycleDurations[runtime.motionEffect] || 8000;
      var elapsed = Math.max(0, time - runtime.motionEffectStartedAt);
      return {
        effect: runtime.motionEffect,
        elapsed: elapsed,
        progress: (elapsed % cycleDuration) / cycleDuration
      };
    }

    function simulateEmbeddingObsidianGraph(runtime, delta, time) {
      var points = Object.keys(runtime.points).map(function(id) { return runtime.points[id]; });
      var alpha = runtime.alpha;
      var centerX = runtime.worldWidth / 2;
      var centerY = runtime.worldHeight / 2;
      if (runtime.motionEffect === 'voice') sampleEmbeddingObsidianAudio(runtime);
      var motionFrame = getEmbeddingObsidianMotionFrame(runtime, time);
      var motionScreenScale = Math.max(runtime.largeGraph ? 0.045 : 0.42, runtime.scale);
      var collisionScale = runtime.largeGraph ? Math.max(0.045, runtime.scale) : 1;
      var maximumCollisionRadius = 0;
      points.forEach(function(point) {
        point._collisionRadius = getEmbeddingObsidianCollisionRadius(runtime, point);
        maximumCollisionRadius = Math.max(maximumCollisionRadius, point._collisionRadius);
      });
      var edgeTotal = runtime.edges.length;
      var edgeCount = runtime.largeGraph ? Math.min(6000, edgeTotal) : edgeTotal;
      for (var edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
        var edge = runtime.edges[(runtime.edgeCursor + edgeIndex) % Math.max(1, edgeTotal)];
        if (!edge) continue;
        var source = runtime.points[edge.source];
        var target = runtime.points[edge.target];
        if (!source || !target) continue;
        var dx = target.x - source.x;
        var dy = target.y - source.y;
        var distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        var desired = 68 + Math.min(44, (source.r + target.r) * 1.8);
        var linkStrength = runtime.largeGraph ? 0.00072 : 0.0019;
        if (runtime.shapeMode !== 'circle') linkStrength *= 0.08;
        var force = (distance - desired) * linkStrength * alpha;
        var fx = dx / distance * force;
        var fy = dy / distance * force;
        var sourceDegreeScale = 1 / Math.max(1, Number(runtime.degrees[edge.source] || 1));
        var targetDegreeScale = 1 / Math.max(1, Number(runtime.degrees[edge.target] || 1));
        if (source.fx === null) {
          source.vx += fx * delta * sourceDegreeScale;
          source.vy += fy * delta * sourceDegreeScale;
        }
        if (target.fx === null) {
          target.vx -= fx * delta * targetDegreeScale;
          target.vy -= fy * delta * targetDegreeScale;
        }
      }
      if (edgeTotal > 0) runtime.edgeCursor = (runtime.edgeCursor + edgeCount) % edgeTotal;

      function repelPair(a, b) {
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
          var separationAngle = (a.seed + b.seed * 0.73) % (Math.PI * 2);
          dx = Math.cos(separationAngle) * 0.1;
          dy = Math.sin(separationAngle) * 0.1;
        }
        var distanceSq = Math.max(36, dx * dx + dy * dy);
        var distance = Math.sqrt(distanceSq);
        var minimum = Number(a._collisionRadius || a.r) + Number(b._collisionRadius || b.r) +
          (a.node.type === 'keyword' || b.node.type === 'keyword'
            ? (runtime.largeGraph ? 3.5 / collisionScale : 9)
            : (runtime.largeGraph ? 1.5 / collisionScale : 4));
        var repel = Math.min(0.11, (58 + (a.r + b.r) * 8) * alpha / distanceSq);
        if (distance < minimum) repel += (minimum - distance) * 0.012;
        var fx = dx / distance * repel;
        var fy = dy / distance * repel;
        if (a.fx === null) {
          a.vx -= fx * delta;
          a.vy -= fy * delta;
        }
        if (b.fx === null) {
          b.vx += fx * delta;
          b.vy += fy * delta;
        }
      }
      if (runtime.largeGraph) {
        var cellSize = 58;
        var buckets = {};
        points.forEach(function(point, index) {
          point._simulationIndex = index;
          var cellX = Math.floor(point.x / cellSize);
          var cellY = Math.floor(point.y / cellSize);
          var key = cellX + ':' + cellY;
          if (!buckets[key]) buckets[key] = [];
          buckets[key].push(point);
        });
        points.forEach(function(point) {
          var cellX = Math.floor(point.x / cellSize);
          var cellY = Math.floor(point.y / cellSize);
          for (var offsetX = -1; offsetX <= 1; offsetX += 1) {
            for (var offsetY = -1; offsetY <= 1; offsetY += 1) {
              var nearby = buckets[(cellX + offsetX) + ':' + (cellY + offsetY)] || [];
              nearby.forEach(function(other) {
                if (other._simulationIndex <= point._simulationIndex) return;
                repelPair(point, other);
              });
            }
          }
        });
        var exclusionKeywords = points.filter(function(point) {
          return point.node.type === 'keyword' &&
            getEmbeddingObsidianScreenRadius(runtime, point, false) >= 4.5;
        });
        exclusionKeywords.forEach(function(keywordPoint) {
          var keywordCellX = Math.floor(keywordPoint.x / cellSize);
          var keywordCellY = Math.floor(keywordPoint.y / cellSize);
          var searchDistance = keywordPoint._collisionRadius + maximumCollisionRadius +
            4 / collisionScale;
          var cellRange = Math.max(1, Math.ceil(searchDistance / cellSize));
          for (var offsetX = -cellRange; offsetX <= cellRange; offsetX += 1) {
            for (var offsetY = -cellRange; offsetY <= cellRange; offsetY += 1) {
              var nearbyPoints = buckets[(keywordCellX + offsetX) + ':' + (keywordCellY + offsetY)] || [];
              nearbyPoints.forEach(function(otherPoint) {
                if (otherPoint === keywordPoint) return;
                if (
                  otherPoint.node.type === 'keyword' &&
                  getEmbeddingObsidianScreenRadius(runtime, otherPoint, false) >= 4.5 &&
                  otherPoint._simulationIndex < keywordPoint._simulationIndex
                ) return;
                var dx = otherPoint.x - keywordPoint.x;
                var dy = otherPoint.y - keywordPoint.y;
                if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
                  var angle = (keywordPoint.seed + otherPoint.seed * 0.73) % (Math.PI * 2);
                  dx = Math.cos(angle) * 0.1;
                  dy = Math.sin(angle) * 0.1;
                }
                var distance = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));
                var minimumDistance = keywordPoint._collisionRadius + otherPoint._collisionRadius +
                  4 / collisionScale;
                if (distance >= minimumDistance) return;
                var overlap = minimumDistance - distance;
                var correction = Math.min(overlap * 0.38, 8 / collisionScale);
                var directionX = dx / distance;
                var directionY = dy / distance;
                var keywordShare = otherPoint.fx === null ? 0.5 : 1;
                var otherShare = keywordPoint.fx === null ? 0.5 : 1;
                if (keywordPoint.fx === null) {
                  keywordPoint.x -= directionX * correction * keywordShare;
                  keywordPoint.y -= directionY * correction * keywordShare;
                  keywordPoint.vx -= directionX * Math.min(0.18, overlap * 0.003);
                  keywordPoint.vy -= directionY * Math.min(0.18, overlap * 0.003);
                }
                if (otherPoint.fx === null) {
                  otherPoint.x += directionX * correction * otherShare;
                  otherPoint.y += directionY * correction * otherShare;
                  otherPoint.vx += directionX * Math.min(0.18, overlap * 0.003);
                  otherPoint.vy += directionY * Math.min(0.18, overlap * 0.003);
                }
              });
            }
          }
        });
      } else {
        for (var i = 0; i < points.length; i += 1) {
          for (var j = i + 1; j < points.length; j += 1) {
            repelPair(points[i], points[j]);
          }
        }
      }
      points.forEach(function(point) {
        if (point.fx !== null) {
          point.x = point.fx;
          point.y = point.fy;
          point.vx = 0;
          point.vy = 0;
          return;
        }
        if (
          runtime.shapeMode !== 'circle' &&
          Number.isFinite(point.shapeTargetX) &&
          Number.isFinite(point.shapeTargetY)
        ) {
          var shapeElapsed = Math.max(
            0,
            time - Number(runtime.shapeTransitionStartedAt || time)
          );
          var shapeDelay = embeddingGraphSeed(
            point.node.id + ':' + runtime.shapeMode + '-shape-delay'
          ) * 1100;
          var shapeProgress = Math.max(
            0.08,
            Math.min(1, (shapeElapsed - shapeDelay) / 4200)
          );
          var shapeEase = 1 - Math.pow(1 - shapeProgress, 3);
          var shapeStrength = runtime.largeGraph
            ? (point.node.type === 'keyword' ? 0.0048 : 0.0037)
            : (point.node.type === 'keyword' ? 0.0062 : 0.0052);
          shapeStrength *= 0.28 + shapeEase * 0.72;
          point.vx += (point.shapeTargetX - point.x) * shapeStrength * delta;
          point.vy += (point.shapeTargetY - point.y) * shapeStrength * delta;
        } else {
          var centerStrength = runtime.largeGraph
            ? (point.node.type === 'keyword' ? 0.00022 : 0.00016)
            : (point.node.type === 'keyword' ? 0.0017 : 0.00115);
          point.vx += (centerX - point.x) * centerStrength * alpha * delta;
          point.vy += (centerY - point.y) * centerStrength * alpha * delta;
          if (runtime.largeGraph && point.node.type === 'keyword') {
            point.vx += (point.homeX - point.x) * 0.0014 * delta;
            point.vy += (point.homeY - point.y) * 0.0014 * delta;
          }
          if (runtime.largeGraph && point.node.type === 'paper' && point.ringRadius) {
            var radialX = point.x - centerX;
            var radialY = point.y - centerY;
            var radialDistance = Math.max(1, Math.sqrt(radialX * radialX + radialY * radialY));
            var ringForce = (point.ringRadius - radialDistance) * 0.00105 * delta;
            point.vx += radialX / radialDistance * ringForce;
            point.vy += radialY / radialDistance * ringForce;
          }
        }
        if (motionFrame) {
          var effectX = point.x - centerX;
          var effectY = point.y - centerY;
          var effectDistance = Math.max(1, Math.sqrt(effectX * effectX + effectY * effectY));
          var effectDirectionX = effectX / effectDistance;
          var effectDirectionY = effectY / effectDistance;
          var distanceScale = 0.55 + Math.min(
            1.25,
            effectDistance / Math.max(1, Math.min(runtime.worldWidth, runtime.worldHeight) * 0.38)
          );
          if (motionFrame.effect === 'wave') {
            var normalizedWaveDistance = effectDistance /
              Math.max(1, Math.min(runtime.worldWidth, runtime.worldHeight) * 0.46);
            var wavePhase = motionFrame.progress * Math.PI * 4 -
              normalizedWaveDistance * Math.PI * 5;
            var waveStrength = (runtime.largeGraph ? 0.11 : 0.135) /
              motionScreenScale *
              Math.sin(wavePhase);
            point.vx += effectDirectionX * waveStrength * delta;
            point.vy += effectDirectionY * waveStrength * delta;
          } else if (motionFrame.effect === 'vortex') {
            var vortexEnvelope = 0.82 + Math.sin(motionFrame.progress * Math.PI * 2) * 0.18;
            var vortexStrength = (runtime.largeGraph ? 0.095 : 0.12) /
              motionScreenScale *
              vortexEnvelope * distanceScale;
            point.vx += -effectDirectionY * vortexStrength * delta;
            point.vy += effectDirectionX * vortexStrength * delta;
          } else if (motionFrame.effect === 'breathe') {
            var breathWave = Math.sin(motionFrame.progress * Math.PI * 2);
            var breathStrength = (runtime.largeGraph ? 0.07 : 0.09) /
              motionScreenScale *
              breathWave;
            point.vx += effectDirectionX * breathStrength * delta;
            point.vy += effectDirectionY * breathStrength * delta;
          } else if (motionFrame.effect === 'voice') {
            var normalizedWaveX = Math.max(
              0,
              Math.min(1, point.x / Math.max(1, runtime.worldWidth))
            );
            var voiceHistory = Array.isArray(runtime.audioWaveHistory)
              ? runtime.audioWaveHistory
              : [];
            var maximumVoiceDelay = Math.min(120, Math.max(0, voiceHistory.length - 1));
            var delayedVoiceIndex = Math.min(
              Math.max(0, voiceHistory.length - 1),
              Math.round(normalizedWaveX * maximumVoiceDelay)
            );
            var delayedVoice = voiceHistory[delayedVoiceIndex] || {
              level: runtime.audioLevel,
              low: runtime.audioLow,
              mid: runtime.audioMid,
              high: runtime.audioHigh
            };
            var voiceLevel = Math.max(0, Number(delayedVoice.level || 0));
            var voiceLow = Math.max(0, Number(delayedVoice.low || 0));
            var voiceMid = Math.max(0, Number(delayedVoice.mid || 0));
            var voiceHigh = Math.max(0, Number(delayedVoice.high || 0));
            var voiceWavePhase = time * 0.0052 -
              normalizedWaveX * Math.PI * 7 +
              point.seed * 0.08;
            var voiceFineWavePhase = time * 0.009 -
              normalizedWaveX * Math.PI * 15 +
              point.seed * 0.32;
            var voiceVerticalStrength = (
              0.012 +
              voiceLevel * 0.19 +
              voiceLow * 0.13 +
              voiceMid * 0.055
            ) / motionScreenScale;
            var voiceHorizontalStrength = (
              0.003 +
              voiceLevel * 0.022
            ) / motionScreenScale;
            var voiceDetailStrength = voiceHigh * 0.052 / motionScreenScale;
            point.vy += Math.sin(voiceWavePhase) * voiceVerticalStrength * delta;
            point.vx += Math.cos(voiceWavePhase) * voiceHorizontalStrength * delta;
            point.vy += Math.sin(voiceFineWavePhase) * voiceDetailStrength * delta;
          }
        }
        var ambient = time * 0.00032 + point.seed;
        var ambientStrength = runtime.largeGraph ? 0.00075 : 0.0028;
        point.vx += Math.cos(ambient) * ambientStrength * delta;
        point.vy += Math.sin(ambient * 1.13) * ambientStrength * delta;
        point.vx *= Math.pow(0.88, delta);
        point.vy *= Math.pow(0.88, delta);
        if (runtime.largeGraph) {
          var speed = Math.sqrt(point.vx * point.vx + point.vy * point.vy);
          var motionSpeedLimit = 0.72;
          if (motionFrame) {
            var motionScreenSpeedLimit = motionFrame.effect === 'wave'
              ? 1.2
              : (motionFrame.effect === 'vortex'
                ? 1.08
                : (motionFrame.effect === 'voice'
                  ? 0.5 + Math.max(0, Number(runtime.audioLevel || 0)) * 1.2
                  : 0.82));
            motionSpeedLimit = Math.max(
              motionSpeedLimit,
              motionScreenSpeedLimit / motionScreenScale
            );
          }
          if (speed > motionSpeedLimit) {
            point.vx = point.vx / speed * motionSpeedLimit;
            point.vy = point.vy / speed * motionSpeedLimit;
          }
        }
        var nextX = point.x + point.vx * delta;
        var nextY = point.y + point.vy * delta;
        var minimumX = runtime.shapeMode !== 'circle' && Number.isFinite(point.shapeTargetX)
          ? Math.min(24, point.shapeTargetX - 36)
          : 24;
        var maximumX = runtime.shapeMode !== 'circle' && Number.isFinite(point.shapeTargetX)
          ? Math.max(runtime.worldWidth - 24, point.shapeTargetX + 36)
          : runtime.worldWidth - 24;
        var minimumY = runtime.shapeMode !== 'circle' && Number.isFinite(point.shapeTargetY)
          ? Math.min(24, point.shapeTargetY - 36)
          : 24;
        var maximumY = runtime.shapeMode !== 'circle' && Number.isFinite(point.shapeTargetY)
          ? Math.max(runtime.worldHeight - 24, point.shapeTargetY + 36)
          : runtime.worldHeight - 24;
        if (nextX <= minimumX || nextX >= maximumX) point.vx = 0;
        if (nextY <= minimumY || nextY >= maximumY) point.vy = 0;
        point.x = Math.max(minimumX, Math.min(maximumX, nextX));
        point.y = Math.max(minimumY, Math.min(maximumY, nextY));
      });
      var targetAlpha = runtime.largeGraph ? 0.018 : 0.055;
      runtime.alpha += (targetAlpha - runtime.alpha) * Math.min(0.07, 0.021 * delta);
    }

    function prepareEmbeddingObsidianCanvas(runtime) {
      var canvas = runtime.canvas;
      var ratio = Math.max(1, Math.min(2, Number(window.devicePixelRatio || 1)));
      var pixelWidth = Math.max(1, Math.round(runtime.width * ratio));
      var pixelHeight = Math.max(1, Math.round(runtime.height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      var context = canvas.getContext('2d', { alpha: false });
      if (!context) return null;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      return context;
    }

    function getEmbeddingObsidianPointColor(runtime, point, isCosmicPoint) {
      var originalColor = isCosmicPoint
        ? String(point.cosmicShapeColor || '#dff5ff')
        : String(point.node.color || '#7c6cff');
      var activePalette = String(runtime && runtime.colorPalette || 'original');
      if (activePalette === 'original') return originalColor;
      var palettes = {
        ice: ['#38bdf8', '#67e8f9', '#93c5fd', '#dbeafe'],
        nebula: ['#7c6cff', '#a78bfa', '#c4b5fd', '#ede9fe'],
        gold: ['#d97706', '#f59e0b', '#f6c453', '#fef3c7'],
        emerald: ['#059669', '#34d399', '#6ee7b7', '#d1fae5']
      };
      var colors = palettes[activePalette] || palettes.ice;
      var colorSeed = embeddingGraphScatterSeed(
        point.node.id + ':point-palette:' + activePalette
      );
      var colorIndex = Math.min(colors.length - 1, Math.floor(colorSeed * colors.length));
      if (point.node.type === 'keyword') colorIndex = Math.max(colorIndex, colors.length - 2);
      return colors[colorIndex];
    }

    function drawEmbeddingObsidianSaturnMeteors(context, runtime, width, height) {
      var time = Number(runtime.lastFrameAt || 0);
      var cycleDuration = 12000;
      var travelDuration = 3200;
      for (var meteorIndex = 0; meteorIndex < 4; meteorIndex += 1) {
        var meteorTime = (time + meteorIndex * 3000) % cycleDuration;
        if (meteorTime > travelDuration) continue;
        var progress = meteorTime / travelDuration;
        var easing = progress * progress * (3 - 2 * progress);
        var laneSeed = embeddingGraphScatterSeed('saturn-meteor-lane:' + meteorIndex);
        var speedSeed = embeddingGraphScatterSeed('saturn-meteor-speed:' + meteorIndex);
        var startX = -width * (0.16 + speedSeed * 0.08);
        var startY = height * (0.06 + laneSeed * 0.46);
        var endX = width * (0.72 + speedSeed * 0.24);
        var endY = startY + height * (0.22 + speedSeed * 0.12);
        var meteorX = startX + (endX - startX) * easing;
        var meteorY = startY + (endY - startY) * easing;
        var directionX = endX - startX;
        var directionY = endY - startY;
        var directionLength = Math.max(1, Math.sqrt(directionX * directionX + directionY * directionY));
        var tailLength = width * (0.055 + speedSeed * 0.035);
        var tailX = meteorX - directionX / directionLength * tailLength;
        var tailY = meteorY - directionY / directionLength * tailLength;
        var fadeIn = Math.min(1, progress * 7);
        var fadeOut = Math.min(1, (1 - progress) * 5);
        var meteorAlpha = Math.max(0, Math.min(fadeIn, fadeOut));
        var meteorGradient = context.createLinearGradient(tailX, tailY, meteorX, meteorY);
        meteorGradient.addColorStop(0, 'rgba(255,219,164,0)');
        meteorGradient.addColorStop(0.7, 'rgba(255,224,178,' + (meteorAlpha * 0.45).toFixed(3) + ')');
        meteorGradient.addColorStop(1, 'rgba(255,248,229,' + (meteorAlpha * 0.96).toFixed(3) + ')');
        context.save();
        context.beginPath();
        context.moveTo(tailX, tailY);
        context.lineTo(meteorX, meteorY);
        context.strokeStyle = meteorGradient;
        context.lineWidth = 1.15 + speedSeed * 0.9;
        context.lineCap = 'round';
        context.shadowColor = 'rgba(255,196,112,' + (meteorAlpha * 0.72).toFixed(3) + ')';
        context.shadowBlur = 8 + speedSeed * 6;
        context.stroke();
        context.beginPath();
        context.arc(meteorX, meteorY, 1.15 + speedSeed * 0.8, 0, Math.PI * 2);
        context.fillStyle = 'rgba(255,251,239,' + meteorAlpha.toFixed(3) + ')';
        context.fill();
        context.restore();
      }
    }

    function drawEmbeddingObsidianGraph(runtime) {
      if (!runtime || runtime.destroyed) return;
      var context = prepareEmbeddingObsidianCanvas(runtime);
      if (!context) return;
      var width = runtime.width;
      var height = runtime.height;
      context.clearRect(0, 0, width, height);
      var cosmicBackgrounds = {
        blackhole: '#000000',
        saturn: '#05070c',
        galaxy: '#040918',
        starfield: '#020611',
        starrynight: '#071632',
        'painted-eye': '#101820',
        'cubist-face': '#171310'
      };
      context.fillStyle = cosmicBackgrounds[runtime.shapeMode] || '#17191d';
      context.fillRect(0, 0, width, height);
      var voiceLevel = runtime.motionEffect === 'voice'
        ? Math.max(0, Number(runtime.audioLevel || 0))
        : 0;
      var voiceHigh = runtime.motionEffect === 'voice'
        ? Math.max(0, Number(runtime.audioHigh || 0))
        : 0;
      if (runtime.shapeMode === 'circle') {
        var glow = context.createRadialGradient(width * 0.5, height * 0.46, 20, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
        glow.addColorStop(0, 'rgba(45,226,230,' + (0.13 + voiceLevel * 0.2).toFixed(3) + ')');
        glow.addColorStop(0.48, 'rgba(124,108,255,0.055)');
        glow.addColorStop(1, 'rgba(23,25,29,0)');
        context.fillStyle = glow;
        context.fillRect(0, 0, width, height);
      } else if (runtime.shapeMode === 'saturn') {
        var saturnGlow = context.createRadialGradient(
          width * 0.47,
          height * 0.42,
          8,
          width * 0.5,
          height * 0.5,
          Math.max(width, height) * 0.66
        );
        saturnGlow.addColorStop(0, 'rgba(213,147,73,0.22)');
        saturnGlow.addColorStop(0.36, 'rgba(92,59,35,0.13)');
        saturnGlow.addColorStop(1, 'rgba(5,7,12,0)');
        context.fillStyle = saturnGlow;
        context.fillRect(0, 0, width, height);
        drawEmbeddingObsidianSaturnMeteors(context, runtime, width, height);
      } else if (runtime.shapeMode === 'galaxy') {
        var galaxyGlow = context.createRadialGradient(
          width * 0.54,
          height * 0.48,
          8,
          width * 0.52,
          height * 0.5,
          Math.max(width, height) * 0.68
        );
        galaxyGlow.addColorStop(0, 'rgba(139,125,211,0.2)');
        galaxyGlow.addColorStop(0.44, 'rgba(43,67,124,0.16)');
        galaxyGlow.addColorStop(1, 'rgba(4,9,24,0)');
        context.fillStyle = galaxyGlow;
        context.fillRect(0, 0, width, height);
      } else if (runtime.shapeMode === 'starfield') {
        var starfieldGlow = context.createRadialGradient(
          width * 0.42,
          height * 0.38,
          10,
          width * 0.48,
          height * 0.48,
          Math.max(width, height) * 0.82
        );
        starfieldGlow.addColorStop(0, 'rgba(33,67,112,0.18)');
        starfieldGlow.addColorStop(0.46, 'rgba(16,35,70,0.1)');
        starfieldGlow.addColorStop(1, 'rgba(2,6,17,0)');
        context.fillStyle = starfieldGlow;
        context.fillRect(0, 0, width, height);
      } else if (runtime.shapeMode === 'starrynight') {
        var starryNightGlow = context.createRadialGradient(
          width * 0.84,
          height * 0.17,
          6,
          width * 0.72,
          height * 0.3,
          Math.max(width, height) * 0.72
        );
        starryNightGlow.addColorStop(0, 'rgba(255,220,94,0.22)');
        starryNightGlow.addColorStop(0.18, 'rgba(53,116,190,0.17)');
        starryNightGlow.addColorStop(0.58, 'rgba(22,66,137,0.12)');
        starryNightGlow.addColorStop(1, 'rgba(7,22,50,0)');
        context.fillStyle = starryNightGlow;
        context.fillRect(0, 0, width, height);
      } else if (runtime.shapeMode === 'painted-eye') {
        var paintedEyeGlow = context.createRadialGradient(
          width * 0.51,
          height * 0.49,
          5,
          width * 0.51,
          height * 0.49,
          Math.max(width, height) * 0.56
        );
        paintedEyeGlow.addColorStop(0, 'rgba(31,205,210,0.23)');
        paintedEyeGlow.addColorStop(0.28, 'rgba(49,95,173,0.15)');
        paintedEyeGlow.addColorStop(0.62, 'rgba(192,52,111,0.1)');
        paintedEyeGlow.addColorStop(1, 'rgba(16,24,32,0)');
        context.fillStyle = paintedEyeGlow;
        context.fillRect(0, 0, width, height);
      } else if (runtime.shapeMode === 'cubist-face') {
        var cubistFaceGlow = context.createRadialGradient(
          width * 0.5,
          height * 0.48,
          10,
          width * 0.5,
          height * 0.5,
          Math.max(width, height) * 0.62
        );
        cubistFaceGlow.addColorStop(0, 'rgba(242,200,75,0.15)');
        cubistFaceGlow.addColorStop(0.42, 'rgba(228,85,54,0.08)');
        cubistFaceGlow.addColorStop(1, 'rgba(23,19,16,0)');
        context.fillStyle = cubistFaceGlow;
        context.fillRect(0, 0, width, height);
      }
      context.save();
      context.translate(runtime.translateX, runtime.translateY);
      context.scale(runtime.scale, runtime.scale);
      var focusId = runtime.lockedId || runtime.hoveredId;
      var related = focusId ? Object.assign({}, runtime.neighbors[focusId] || {}) : {};
      if (focusId) related[focusId] = true;
      var searchMatches = runtime.searchMatches || {};
      var searchRelated = runtime.searchRelated || {};
      var search = runtime.searchTerm;
      var screenScale = Math.max(0.045, Number(runtime.scale || 1));
      var edgeStride = runtime.largeGraph && !focusId && !search
        ? Math.max(1, Math.ceil(runtime.edges.length / 12000))
        : 1;
      var focusEdgeStride = runtime.largeGraph && focusId
        ? Math.max(1, Math.ceil(Number(runtime.degrees[focusId] || 0) / 800))
        : 1;
      var focusEdgeIndex = 0;
      runtime.edges.forEach(function(edge, edgeIndex) {
        if (runtime.shapeMode !== 'circle' && !focusId && !search) return;
        if (edgeStride > 1 && edgeIndex % edgeStride !== 0) return;
        var source = runtime.points[edge.source];
        var target = runtime.points[edge.target];
        if (!source || !target) return;
        var active = (!focusId || (related[edge.source] && related[edge.target])) &&
          (!search || (searchRelated[edge.source] && searchRelated[edge.target]));
        if (runtime.largeGraph && (focusId || search) && !active) return;
        if (focusId && active) {
          focusEdgeIndex += 1;
          if (focusEdgeStride > 1 && focusEdgeIndex % focusEdgeStride !== 0) return;
        }
        context.beginPath();
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        var ambientEdgeAlpha = runtime.largeGraph ? 0.055 : 0.20;
        if (runtime.shapeMode !== 'circle') ambientEdgeAlpha *= 0.42;
        ambientEdgeAlpha += voiceHigh * (runtime.largeGraph ? 0.16 : 0.26);
        var cosmicFocusEdgeColors = {
          blackhole: 'rgba(255,214,164,0.78)',
          saturn: 'rgba(246,196,83,0.8)',
          galaxy: 'rgba(201,195,246,0.78)',
          starfield: 'rgba(219,235,255,0.82)',
          starrynight: 'rgba(255,221,102,0.82)',
          'painted-eye': 'rgba(70,220,217,0.82)',
          'cubist-face': 'rgba(242,200,75,0.82)'
        };
        context.strokeStyle = active
          ? (focusId
            ? (cosmicFocusEdgeColors[runtime.shapeMode] || 'rgba(45,226,230,0.72)')
            : 'rgba(88,196,206,' + ambientEdgeAlpha.toFixed(3) + ')')
          : 'rgba(100,116,139,0.035)';
        context.lineWidth = (active ? (runtime.largeGraph && !focusId ? 0.35 : 0.9) : 0.4) /
          (runtime.largeGraph ? screenScale : Math.max(0.45, runtime.scale));
        context.stroke();
      });
      var keywordRanks = runtime.defaultLabelIds || {};
      var pointIds = Object.keys(runtime.points);
      if (runtime.shapeMode === 'saturn') {
        var saturnLayerOrder = {
          star: 0,
          'ring-back': 1,
          planet: 2,
          'ring-front': 3
        };
        pointIds.sort(function(leftId, rightId) {
          var leftZone = runtime.points[leftId].cosmicShapeZone;
          var rightZone = runtime.points[rightId].cosmicShapeZone;
          return Number(saturnLayerOrder[leftZone] || 0) -
            Number(saturnLayerOrder[rightZone] || 0);
        });
      }
      pointIds.forEach(function(id) {
        var point = runtime.points[id];
        var isFocus = id === focusId;
        var isRelated = !focusId || related[id];
        var isSearchRelated = !search || searchRelated[id];
        var alpha = isRelated && isSearchRelated ? (isFocus ? 1 : 0.9) : 0.09;
        var isCosmicPoint = runtime.shapeMode !== 'circle' && Boolean(point.cosmicShapeZone);
        var saturnTwinkle = 1;
        if (isCosmicPoint && !focusId && !search) {
          if (runtime.shapeMode === 'saturn' && point.cosmicShapeZone === 'star') {
            var twinklePhase = Number(runtime.lastFrameAt || 0) *
              (0.00072 + (point.seed % 1) * 0.00058) +
              point.seed * 4.7;
            saturnTwinkle = 0.5 + 0.5 * Math.sin(twinklePhase);
            saturnTwinkle = Math.pow(saturnTwinkle, 2.4);
            alpha = 0.18 + saturnTwinkle * 0.82;
          } else {
            alpha = point.cosmicShapeZone === 'star'
              ? 0.5 + Number(point.cosmicShapeHeat || 0) * 1.5
              : 0.94;
          }
        }
        var radius = runtime.largeGraph
          ? getEmbeddingObsidianScreenRadius(runtime, point, true) / screenScale
          : point.r * (id === runtime.hoveredId ? 1.22 : 1);
        if (isCosmicPoint && !isFocus) {
          var cosmicScreenRadius = Number(point.cosmicShapePointSize || 1);
          if (point.node.type === 'keyword') {
            cosmicScreenRadius += getEmbeddingObsidianKeywordSizeRatio(runtime, point) * 0.46;
          }
          radius = cosmicScreenRadius / screenScale;
          if (runtime.shapeMode === 'saturn' && point.cosmicShapeZone === 'star') {
            radius *= 0.72 + saturnTwinkle * 0.78;
          }
        }
        if (runtime.motionEffect === 'voice') {
          radius *= 1 + voiceLevel * (point.node.type === 'keyword' ? 0.48 : 0.26);
        }
        context.globalAlpha = alpha;
        var pointColor = getEmbeddingObsidianPointColor(runtime, point, isCosmicPoint);
        if (id === runtime.lockedId || id === runtime.hoveredId) {
          context.beginPath();
          context.arc(
            point.x,
            point.y,
            radius + (id === runtime.lockedId ? 7 : 5) / (runtime.largeGraph ? screenScale : 1),
            0,
            Math.PI * 2
          );
          context.strokeStyle = pointColor;
          context.lineWidth = 2 / (runtime.largeGraph ? screenScale : Math.max(0.45, runtime.scale));
          context.stroke();
        }
        context.fillStyle = pointColor;
        if (
          !isCosmicPoint &&
          runtime.largeGraph &&
          point.node.type === 'paper' &&
          !isFocus &&
          !searchMatches[id] &&
          runtime.scale < 0.46
        ) {
          var dotSize = Math.max(radius * 1.35, 1.5 / screenScale);
          context.fillRect(point.x - dotSize / 2, point.y - dotSize / 2, dotSize, dotSize);
        } else {
          context.beginPath();
          context.arc(point.x, point.y, radius, 0, Math.PI * 2);
          context.fill();
        }
        if (
          (!isCosmicPoint && keywordRanks[id]) ||
          isFocus ||
          searchMatches[id]
        ) {
          var label = String(point.node.label || id);
          var limit = isFocus ? 44 : 26;
          if (label.length > limit) label = label.slice(0, limit - 1) + '…';
          context.globalAlpha = alpha;
          var labelFontSize = runtime.largeGraph ? 11 / screenScale : 11;
          var labelOffset = radius + (runtime.largeGraph ? 5 / screenScale : 5);
          context.font = (isFocus ? '700 ' : '600 ') + labelFontSize + 'px "Times New Roman", Times, serif';
          context.textBaseline = 'middle';
          context.lineJoin = 'round';
          context.strokeStyle = '#17191d';
          context.lineWidth = 3.4 / (runtime.largeGraph ? screenScale : Math.max(0.45, runtime.scale));
          context.strokeText(label, point.x + labelOffset, point.y);
          context.fillStyle = '#edf0f4';
          context.fillText(label, point.x + labelOffset, point.y);
        }
      });
      context.restore();
      context.globalAlpha = 1;
    }

    function attachEmbeddingObsidianGraphHandlers(runtime) {
      var canvas = runtime.canvas;
      canvas.addEventListener('pointerdown', function(event) {
        if (event.button !== 0) return;
        event.preventDefault();
        var nodeId = findEmbeddingObsidianNode(runtime, event);
        var point = nodeId ? runtime.points[nodeId] : null;
        runtime.pointer = {
          pointerId: event.pointerId,
          mode: point ? 'node' : 'pan',
          nodeId: nodeId || '',
          startClientX: event.clientX,
          startClientY: event.clientY,
          lastClientX: event.clientX,
          lastClientY: event.clientY,
          startNodeX: point ? point.x : 0,
          startNodeY: point ? point.y : 0
        };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = 'grabbing';
        if (point) {
          point.fx = point.x;
          point.fy = point.y;
          runtime.alpha = Math.max(runtime.alpha, 0.34);
        }
      });
      canvas.addEventListener('pointermove', function(event) {
        if (!runtime.pointer) {
          var hoverId = findEmbeddingObsidianNode(runtime, event);
          if (runtime.hoveredId !== hoverId) {
            runtime.hoveredId = hoverId;
            canvas.style.cursor = hoverId ? 'grab' : 'grab';
            if (!runtime.lockedId) renderEmbeddingObsidianGraphDetail(runtime, hoverId, hoverId ? 'hover' : 'empty');
          }
          return;
        }
        var pointer = runtime.pointer;
        if (pointer.pointerId !== event.pointerId) return;
        var rect = canvas.getBoundingClientRect();
        var ratioX = runtime.width / Math.max(1, rect.width);
        var ratioY = runtime.height / Math.max(1, rect.height);
        if (pointer.mode === 'node') {
          var point = runtime.points[pointer.nodeId];
          if (point) {
            point.fx = pointer.startNodeX + (event.clientX - pointer.startClientX) * ratioX / runtime.scale;
            point.fy = pointer.startNodeY + (event.clientY - pointer.startClientY) * ratioY / runtime.scale;
            point.x = point.fx;
            point.y = point.fy;
            point.vx = 0;
            point.vy = 0;
          }
        } else {
          runtime.translateX += (event.clientX - pointer.lastClientX) * ratioX;
          runtime.translateY += (event.clientY - pointer.lastClientY) * ratioY;
        }
        pointer.lastClientX = event.clientX;
        pointer.lastClientY = event.clientY;
      });
      function endPointer(event) {
        var pointer = runtime.pointer;
        if (!pointer || pointer.pointerId !== event.pointerId) return;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        if (pointer.mode === 'node' && runtime.points[pointer.nodeId]) {
          runtime.points[pointer.nodeId].fx = null;
          runtime.points[pointer.nodeId].fy = null;
          runtime.alpha = Math.max(runtime.alpha, 0.38);
        }
        runtime.pointer = null;
        canvas.style.cursor = 'grab';
      }
      canvas.addEventListener('pointerup', endPointer);
      canvas.addEventListener('pointercancel', endPointer);
      canvas.addEventListener('pointerleave', function() {
        if (runtime.pointer) return;
        runtime.hoveredId = '';
        if (!runtime.lockedId) renderEmbeddingObsidianGraphDetail(runtime, '', 'empty');
      });
      canvas.addEventListener('contextmenu', function(event) {
        event.preventDefault();
        var nodeId = findEmbeddingObsidianNode(runtime, event);
        if (!nodeId) return;
        runtime.lockedId = nodeId;
        runtime.hoveredId = '';
        renderEmbeddingObsidianGraphDetail(runtime, nodeId, 'selected');
      });
      canvas.addEventListener('wheel', function(event) {
        event.preventDefault();
        zoomEmbeddingObsidianGraphAt(runtime, event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 0.89);
      }, { passive: false });
      canvas.addEventListener('dblclick', function(event) {
        var nodeId = findEmbeddingObsidianNode(runtime, event);
        var point = nodeId ? runtime.points[nodeId] : null;
        if (point && point.node.type === 'paper' && point.node.paperId) {
          window.openEmbeddingLiteratureDetail(encodeURIComponent(point.node.paperId));
        } else if (!nodeId) {
          fitEmbeddingObsidianGraph();
        }
      });
    }

    function findEmbeddingObsidianNode(runtime, event) {
      var rect = runtime.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return '';
      var canvasX = (event.clientX - rect.left) * runtime.width / rect.width;
      var canvasY = (event.clientY - rect.top) * runtime.height / rect.height;
      var bestId = '';
      var bestDistance = Infinity;
      Object.keys(runtime.points).forEach(function(id) {
        var point = runtime.points[id];
        var screenX = point.x * runtime.scale + runtime.translateX;
        var screenY = point.y * runtime.scale + runtime.translateY;
        var dx = screenX - canvasX;
        var dy = screenY - canvasY;
        var distance = Math.sqrt(dx * dx + dy * dy);
        var hitRadius = Math.max(
          5,
          getEmbeddingObsidianScreenRadius(runtime, point, false) + 4
        );
        if (distance <= hitRadius && distance < bestDistance) {
          bestId = id;
          bestDistance = distance;
        }
      });
      return bestId;
    }

    function renderEmbeddingObsidianGraphDetail(runtime, nodeId, mode) {
      var detail = document.getElementById('embeddingObsidianDetail');
      if (!detail || !runtime) return;
      var point = nodeId ? runtime.points[nodeId] : null;
      if (!point) {
        detail.innerHTML = renderEmbeddingObsidianEmptyDetail();
        return;
      }
      var node = point.node;
      var relations = Object.keys(runtime.neighbors[nodeId] || {}).map(function(id) {
        var relatedPoint = runtime.points[id];
        return relatedPoint ? relatedPoint.node : null;
      }).filter(Boolean);
      if (node.type === 'paper') {
        detail.innerHTML =
          '<div class="embedding-obsidian-detail-card">' +
            '<div class="embedding-obsidian-detail-heading">' +
              '<span style="background:' + escapeHtml(node.color) + '"></span>' +
              '<div><strong>' + escapeHtml(node.title || node.label) + '</strong><small>' + (mode === 'selected' ? '已右键固定，右键其他节点可切换' : '悬停预览') + '</small></div>' +
              (mode === 'selected' ? '<button type="button" onclick="clearEmbeddingObsidianGraphSelection()">取消固定</button>' : '') +
            '</div>' +
            '<div class="embedding-obsidian-paper-meta">' + escapeHtml([node.author, node.year, node.journal].filter(Boolean).join(' · ')) + '</div>' +
            (node.doi ? '<div class="embedding-obsidian-paper-doi">DOI: ' + escapeHtml(node.doi) + '</div>' : '') +
            '<div class="embedding-obsidian-metrics">' +
              embeddingObsidianMetric('连接主题', relations.length) +
              embeddingObsidianMetric('收藏', node.favorite ? '是' : '否') +
            '</div>' +
            (node.abstract ? '<p class="embedding-obsidian-abstract">' + escapeHtml(String(node.abstract).slice(0, 520)) + (String(node.abstract).length > 520 ? '…' : '') + '</p>' : '') +
            '<div class="embedding-obsidian-relations"><strong>相关关键词</strong>' +
              (relations.length ? relations.slice(0, 20).map(function(item) { return '<span>' + escapeHtml(item.label) + '</span>'; }).join('') : '<small>暂无连接</small>') +
            '</div>' +
            '<button class="embedding-obsidian-open-paper" type="button" onclick="openEmbeddingLiteratureDetail(\'' + encodeURIComponent(node.paperId || '') + '\')">查看文献详情</button>' +
          '</div>';
        return;
      }
      relations.sort(function(a, b) {
        return String(a.title || a.label).localeCompare(String(b.title || b.label));
      });
      detail.innerHTML =
        '<div class="embedding-obsidian-detail-card">' +
          '<div class="embedding-obsidian-detail-heading">' +
            '<span style="background:' + escapeHtml(node.color) + '"></span>' +
            '<div><strong>' + escapeHtml(node.label) + '</strong><small>' + (mode === 'selected' ? '已右键固定，右键其他节点可切换' : '悬停预览') + '</small></div>' +
            (mode === 'selected' ? '<button type="button" onclick="clearEmbeddingObsidianGraphSelection()">取消固定</button>' : '') +
          '</div>' +
          '<div class="embedding-obsidian-metrics">' +
            embeddingObsidianMetric('图中连接', relations.length) +
            embeddingObsidianMetric('样本文频', node.documentFrequency || node.value || 0) +
          '</div>' +
          '<div class="embedding-obsidian-paper-list"><strong>连接文献</strong>' +
            (relations.length ? relations.slice(0, 24).map(function(item) {
              return '<button type="button" onclick="openEmbeddingLiteratureDetail(\'' + encodeURIComponent(item.paperId || '') + '\')"><span>' + escapeHtml(item.title || item.label) + '</span><small>' + escapeHtml([item.year, item.journal].filter(Boolean).join(' · ')) + '</small></button>';
            }).join('') : '<small>暂无连接</small>') +
          '</div>' +
        '</div>';
    }

    function embeddingObsidianMetric(label, value) {
      return '<div><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(value)) + '</strong></div>';
    }

    window.clearEmbeddingObsidianGraphSelection = function() {
      var runtime = embeddingGraphRuntime;
      if (!runtime) return;
      runtime.lockedId = '';
      runtime.hoveredId = '';
      renderEmbeddingObsidianGraphDetail(runtime, '', 'empty');
    };

    window.filterEmbeddingObsidianGraph = function(value) {
      var runtime = embeddingGraphRuntime;
      if (!runtime) return;
      runtime.searchTerm = String(value || '').trim().toLowerCase();
      runtime.searchMatches = {};
      runtime.searchRelated = {};
      if (runtime.searchTerm) {
        runtime.nodes.forEach(function(node) {
          var haystack = [node.label, node.author, node.journal, node.year, node.doi].filter(Boolean).join(' ').toLowerCase();
          if (haystack.indexOf(runtime.searchTerm) === -1) return;
          runtime.searchMatches[node.id] = true;
          runtime.searchRelated[node.id] = true;
          Object.keys(runtime.neighbors[node.id] || {}).forEach(function(id) {
            runtime.searchRelated[id] = true;
          });
        });
      }
    };

    window.restartEmbeddingObsidianGraph = function() {
      var runtime = embeddingGraphRuntime;
      if (!runtime) return;
      stopEmbeddingObsidianAudio(runtime, true);
      seedEmbeddingObsidianGraphPoints(runtime);
      runtime.motionEffect = '';
      runtime.motionEffectStartedAt = 0;
      updateEmbeddingObsidianMotionButtons(runtime);
      updateEmbeddingObsidianShapeButton(runtime);
      updateEmbeddingObsidianColorButtons(runtime);
      runtime.lockedId = '';
      runtime.hoveredId = '';
      renderEmbeddingObsidianGraphDetail(runtime, '', 'empty');
      requestAnimationFrame(fitEmbeddingObsidianGraph);
    };

    window.fitEmbeddingObsidianGraph = function() {
      var runtime = embeddingGraphRuntime;
      if (!runtime) return;
      var points = Object.keys(runtime.points).map(function(id) { return runtime.points[id]; });
      if (!points.length) return;
      var minX = Math.min.apply(null, points.map(function(point) { return point.x - point.r; }));
      var maxX = Math.max.apply(null, points.map(function(point) { return point.x + point.r; }));
      var minY = Math.min.apply(null, points.map(function(point) { return point.y - point.r; }));
      var maxY = Math.max.apply(null, points.map(function(point) { return point.y + point.r; }));
      var graphWidth = Math.max(100, maxX - minX + 140);
      var graphHeight = Math.max(100, maxY - minY + 140);
      var minimumScale = runtime.largeGraph ? 0.045 : 0.42;
      runtime.scale = Math.max(minimumScale, Math.min(2.2, Math.min(runtime.width / graphWidth, runtime.height / graphHeight)));
      runtime.translateX = runtime.width / 2 - (minX + maxX) / 2 * runtime.scale;
      runtime.translateY = runtime.height / 2 - (minY + maxY) / 2 * runtime.scale;
    };

    window.zoomEmbeddingObsidianGraph = function(direction) {
      var runtime = embeddingGraphRuntime;
      if (!runtime) return;
      var rect = runtime.canvas.getBoundingClientRect();
      zoomEmbeddingObsidianGraphAt(
        runtime,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        direction > 0 ? 1.2 : 0.82
      );
    };

    function zoomEmbeddingObsidianGraphAt(runtime, clientX, clientY, factor) {
      var rect = runtime.canvas.getBoundingClientRect();
      var canvasX = (clientX - rect.left) * runtime.width / Math.max(1, rect.width);
      var canvasY = (clientY - rect.top) * runtime.height / Math.max(1, rect.height);
      var oldScale = runtime.scale;
      var minimumScale = runtime.largeGraph ? 0.045 : 0.42;
      var nextScale = Math.max(minimumScale, Math.min(3.4, oldScale * factor));
      runtime.translateX = canvasX - (canvasX - runtime.translateX) * nextScale / oldScale;
      runtime.translateY = canvasY - (canvasY - runtime.translateY) * nextScale / oldScale;
      runtime.scale = nextScale;
    }

    function getEmbeddingKeywordButtonStyle(active, merged, readOnly) {
      if (merged) {
        return 'padding:5px 9px;border:1px solid ' + (active ? 'var(--accent-color)' : 'rgba(209,213,219,0.88)') + ';border-top-color:rgba(255,255,255,0.98);border-bottom-color:rgba(107,114,128,0.42);border-radius:8px;background:linear-gradient(180deg,rgba(255,255,255,0.78) 0%,rgba(243,244,246,0.9) 42%,rgba(209,213,219,0.94) 100%);color:#374151;cursor:' + (readOnly ? 'default' : 'pointer') + ';font-size:12px;font-weight:600;box-shadow:inset 0 1px 0 rgba(255,255,255,0.85),inset 0 -1px 0 rgba(55,65,81,0.12),0 5px 12px rgba(107,114,128,0.16),0 1px 3px rgba(55,65,81,0.12);text-shadow:0 1px 0 rgba(255,255,255,0.55);';
      }
      return 'padding:5px 8px;border:1px solid ' + (active ? 'var(--accent-color)' : 'var(--border-color)') + ';border-radius:6px;background:' + (active ? 'rgba(16,163,127,0.12)' : 'var(--modal-bg)') + ';color:var(--text-primary);cursor:' + (readOnly ? 'default' : 'pointer') + ';font-size:12px;';
    }

    function renderEmbeddingKeywordButton(tag, active, handlerName, title) {
      var keyword = String(tag.keyword || '');
      var readOnly = !handlerName;
      var click = handlerName
        ? " onclick=\"" + handlerName + "('" + encodeURIComponent(keyword) + "')\""
        : ' onclick="return false;"';
      return '<button type="button"' + click + ' title="' + escapeHtml(title || (tag.merged ? '合并标签' : '关键词')) + '" style="' + getEmbeddingKeywordButtonStyle(active, Boolean(tag.merged), readOnly) + '">' +
        escapeHtml(keyword) + ' (' + (tag.count || 0) + ')' + (tag.merged ? ' · 合并' : '') +
      '</button>';
    }

    window.switchEmbeddingLibraryMode = function(mode) {
      if (embeddingLibraryState.mode === 'graph' && mode !== 'graph') {
        destroyEmbeddingObsidianGraph();
      }
      embeddingLibraryState.mode = mode;
      renderEmbeddingLibrary();
      if (mode === 'graph') {
        loadEmbeddingLibraryGraph(false);
      }
    };

    function renderEmbeddingQuickPanel() {
      var selected = embeddingLibraryState.selectedKeywords;
      var tags = getEmbeddingLibraryTags();
      var tagPage = embeddingLibraryState.data.tagPage || {};
      var tagFooter = '';
      if (embeddingLibraryState.tagSearchPending) {
        tagFooter = '<div style="width:100%;padding:8px 0;color:var(--text-secondary);font-size:12px;">停止输入 1 秒后检索...</div>';
      } else if (embeddingLibraryState.tagLoading) {
        tagFooter = '<div style="width:100%;padding:8px 0;color:var(--text-secondary);font-size:12px;">正在加载...</div>';
      } else if (tagPage.hasMore) {
        tagFooter = '<button type="button" onclick="loadMoreEmbeddingTags()" style="padding:6px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-bg);color:var(--text-primary);cursor:pointer;font-size:12px;">加载更多关键词</button>';
      }

      var chips = selected.length
        ? selected.map(function(keyword) {
            return '<button type="button" onclick="toggleEmbeddingKeyword(\'' + encodeURIComponent(keyword) + '\')" style="padding:5px 8px;border:1px solid var(--accent-color);border-radius:6px;background:rgba(16,163,127,0.12);color:var(--text-primary);cursor:pointer;">' + escapeHtml(keyword) + ' ×</button>';
          }).join('')
        : '<span style="color:var(--text-secondary);font-size:12px;">未选择关键词</span>';

      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:12px;margin-bottom:12px;">' +
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">' +
          '<input value="' + escapeHtml(embeddingLibraryState.keywordSearch) + '" oninput="setEmbeddingKeywordSearch(this.value,this.selectionStart,this.selectionEnd)" onkeydown="handleEmbeddingKeywordSearchKey(event,this)" placeholder="搜索关键词" style="flex:1;padding:9px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);">' +
          '<button type="button" onclick="toggleEmbeddingKeywordMode()" style="padding:9px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-bg);color:var(--text-primary);cursor:pointer;">' + embeddingLibraryState.keywordMode + '</button>' +
          '<button type="button" onclick="clearEmbeddingQuickFilter()" style="padding:9px 12px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-primary);cursor:pointer;">清空</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">' + chips + '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;max-height:150px;overflow:auto;">' +
          tags.map(function(tag) {
            var keyword = String(tag.keyword || '');
            var active = selected.indexOf(keyword.toLowerCase()) !== -1;
            return renderEmbeddingKeywordButton(tag, active, 'toggleEmbeddingKeyword', tag.merged ? '合并标签' : '关键词');
          }).join('') + tagFooter +
        '</div>' +
      '</div>';
    }

    window.setEmbeddingKeywordSearch = function(value, selectionStart, selectionEnd) {
      embeddingLibraryState.keywordSearch = value || '';
      embeddingLibraryState.keywordSearchSelectionStart = Number.isFinite(Number(selectionStart)) ? Number(selectionStart) : embeddingLibraryState.keywordSearch.length;
      embeddingLibraryState.keywordSearchSelectionEnd = Number.isFinite(Number(selectionEnd)) ? Number(selectionEnd) : embeddingLibraryState.keywordSearchSelectionStart;
      embeddingLibraryState.tagSearchPending = true;
      if (embeddingLibraryState.tagSearchTimer) {
        clearTimeout(embeddingLibraryState.tagSearchTimer);
      }
      embeddingLibraryState.tagSearchTimer = setTimeout(function() {
        flushEmbeddingKeywordSearch().catch(function(e) {
          embeddingLibraryState.tagLoading = false;
          embeddingLibraryState.tagSearchPending = false;
          renderEmbeddingLibrary();
          alert('关键词加载失败：' + e.message);
        });
      }, EMBEDDING_TAG_SEARCH_DEBOUNCE_MS);
    };

    window.handleEmbeddingKeywordSearchKey = function(event, input) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      embeddingLibraryState.keywordSearch = input.value || '';
      embeddingLibraryState.keywordSearchSelectionStart = Number.isFinite(Number(input.selectionStart)) ? Number(input.selectionStart) : embeddingLibraryState.keywordSearch.length;
      embeddingLibraryState.keywordSearchSelectionEnd = Number.isFinite(Number(input.selectionEnd)) ? Number(input.selectionEnd) : embeddingLibraryState.keywordSearchSelectionStart;
      flushEmbeddingKeywordSearch().catch(function(e) {
        embeddingLibraryState.tagLoading = false;
        embeddingLibraryState.tagSearchPending = false;
        renderEmbeddingLibrary();
        alert('关键词加载失败：' + e.message);
      });
    };

    async function flushEmbeddingKeywordSearch() {
      if (embeddingLibraryState.tagSearchTimer) {
        clearTimeout(embeddingLibraryState.tagSearchTimer);
        embeddingLibraryState.tagSearchTimer = null;
      }
      if (embeddingLibraryState.data) {
        embeddingLibraryState.data.tags = [];
        embeddingLibraryState.data.tagPage = {
          totalKeywords: 0,
          offset: 0,
          limit: EMBEDDING_LIBRARY_PAGE_SIZE,
          hasMore: false,
          tags: []
        };
      }
      embeddingLibraryState.tagSearchPending = false;
      embeddingLibraryState.tagLoading = true;
      renderEmbeddingLibrary();
      focusEmbeddingKeywordSearchInput();
      await loadEmbeddingTags(true);
    }

    function focusEmbeddingKeywordSearchInput() {
      var activeInput = document.querySelector('#embeddingLibraryContent input[placeholder="搜索关键词"]');
      if (!activeInput) return;
      activeInput.focus();
      if (typeof activeInput.setSelectionRange === 'function') {
        var start = Math.min(embeddingLibraryState.keywordSearchSelectionStart || 0, activeInput.value.length);
        var end = Math.min(embeddingLibraryState.keywordSearchSelectionEnd || start, activeInput.value.length);
        activeInput.setSelectionRange(start, end);
      }
    }

    window.toggleEmbeddingKeywordMode = function() {
      embeddingLibraryState.keywordMode = embeddingLibraryState.keywordMode === 'AND' ? 'OR' : 'AND';
      renderEmbeddingLibrary();
      if (embeddingLibraryState.selectedKeywords.length > 0) {
        applyEmbeddingQuickFilter();
      }
    };

    window.toggleEmbeddingKeyword = function(encodedKeyword) {
      var keyword = decodeURIComponent(encodedKeyword).toLowerCase();
      var selected = embeddingLibraryState.selectedKeywords;
      var idx = selected.indexOf(keyword);
      if (idx >= 0) selected.splice(idx, 1);
      else selected.push(keyword);
      renderEmbeddingLibrary();
      applyEmbeddingQuickFilter();
    };

    window.clearEmbeddingQuickFilter = function() {
      if (embeddingLibraryState.filterAbort) {
        embeddingLibraryState.filterAbort.abort();
        embeddingLibraryState.filterAbort = null;
      }
      embeddingLibraryState.selectedKeywords = [];
      embeddingLibraryState.activeOptions = null;
      embeddingLibraryState.filterLoading = false;
      embeddingLibraryState.loadingMore = false;
      embeddingLibraryState.selectedPaperIds = {};
      embeddingLibraryState.selectAllFiltered = false;
      invalidateEmbeddingLibraryGraph();
      embeddingLibraryState.result = embeddingLibraryState.data.paperPage || { total: embeddingLibraryState.data.summary.count, offset: 0, limit: EMBEDDING_LIBRARY_PAGE_SIZE, hasMore: false, papers: embeddingLibraryState.data.papers || [] };
      renderEmbeddingLibrary();
    };

    window.applyEmbeddingQuickFilter = async function() {
      if (embeddingLibraryState.selectedKeywords.length === 0) {
        clearEmbeddingQuickFilter();
        return;
      }
      await runEmbeddingFilter({
        keywords: embeddingLibraryState.selectedKeywords,
        mode: embeddingLibraryState.keywordMode,
        offset: 0,
        limit: EMBEDDING_LIBRARY_PAGE_SIZE
      });
    };

    function renderEmbeddingAdvancedPanel() {
      var value = embeddingLibraryState.advancedText || '';
      var tags = getEmbeddingLibraryTags();
      var tagPage = embeddingLibraryState.data.tagPage || {};
      var tagFooter = '';
      if (embeddingLibraryState.tagSearchPending) {
        tagFooter = '<div style="width:100%;padding:8px 0;color:var(--text-secondary);font-size:12px;">停止输入 1 秒后检索...</div>';
      } else if (embeddingLibraryState.tagLoading) {
        tagFooter = '<div style="width:100%;padding:8px 0;color:var(--text-secondary);font-size:12px;">正在加载...</div>';
      } else if (tagPage.hasMore) {
        tagFooter = '<button type="button" onclick="loadMoreEmbeddingTags()" style="padding:6px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-bg);color:var(--text-primary);cursor:pointer;font-size:12px;">加载更多关键词</button>';
      }
      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:12px;margin-bottom:12px;">' +
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">' +
          '<input value="' + escapeHtml(embeddingLibraryState.keywordSearch) + '" oninput="setEmbeddingKeywordSearch(this.value,this.selectionStart,this.selectionEnd)" onkeydown="handleEmbeddingKeywordSearchKey(event,this)" placeholder="搜索关键词" style="flex:1;padding:9px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);">' +
          '<button type="button" onclick="clearEmbeddingKeywordSearch()" style="padding:9px 12px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-primary);cursor:pointer;">清空搜索</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;max-height:120px;overflow:auto;margin-bottom:10px;">' +
          tags.map(function(tag) {
            var keyword = String(tag.keyword || '');
            return renderEmbeddingKeywordButton(tag, false, 'addEmbeddingAdvancedKeyword', '添加到高级筛选条件');
          }).join('') + tagFooter +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 180px 120px;gap:8px;align-items:start;">' +
          '<textarea oninput="embeddingLibraryState.advancedText=this.value" placeholder="每行一个关键词组；同一行用逗号分隔。示例：N2O, soil\\nmaize, yield" style="height:110px;padding:9px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);resize:vertical;">' + escapeHtml(value) + '</textarea>' +
          '<select onchange="embeddingLibraryState.advancedGroupOperator=this.value" style="padding:9px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);">' +
            '<option value="OR" ' + (embeddingLibraryState.advancedGroupOperator === 'OR' ? 'selected' : '') + '>组间 OR</option>' +
            '<option value="AND" ' + (embeddingLibraryState.advancedGroupOperator === 'AND' ? 'selected' : '') + '>组间 AND</option>' +
          '</select>' +
          '<button type="button" onclick="applyEmbeddingAdvancedFilter()" style="padding:9px 12px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;">应用</button>' +
        '</div>' +
      '</div>';
    }

    window.addEmbeddingAdvancedKeyword = function(encodedKeyword) {
      var keyword = decodeURIComponent(encodedKeyword).trim();
      if (!keyword) return;
      var current = String(embeddingLibraryState.advancedText || '').trimEnd();
      var existing = current.toLowerCase().split(/[;；,，、\n]+/).map(function(item) { return item.trim(); });
      if (existing.indexOf(keyword.toLowerCase()) !== -1) return;
      embeddingLibraryState.advancedText = current
        ? current + (current.endsWith('\n') ? '' : ', ') + keyword
        : keyword;
      renderEmbeddingLibrary();
    };

    window.clearEmbeddingKeywordSearch = function() {
      embeddingLibraryState.keywordSearch = '';
      embeddingLibraryState.keywordSearchSelectionStart = 0;
      embeddingLibraryState.keywordSearchSelectionEnd = 0;
      flushEmbeddingKeywordSearch().catch(function(e) {
        embeddingLibraryState.tagLoading = false;
        embeddingLibraryState.tagSearchPending = false;
        renderEmbeddingLibrary();
        alert('关键词加载失败：' + e.message);
      });
    };

    window.applyEmbeddingAdvancedFilter = async function() {
      var groups = String(embeddingLibraryState.advancedText || '').split(/\n+/).map(function(line) {
        var keywords = line.split(/[;；,，、]/).map(function(item) { return item.trim(); }).filter(Boolean);
        return { keywords: keywords, operator: 'AND' };
      }).filter(function(group) { return group.keywords.length > 0; });
      await runEmbeddingFilter({ groups: groups, groupOperator: embeddingLibraryState.advancedGroupOperator, offset: 0, limit: EMBEDDING_LIBRARY_PAGE_SIZE });
    };

    function renderEmbeddingMergePanel() {
      var tags = getEmbeddingLibraryTags().filter(function(tag) { return !tag.merged; });
      var mergedTags = getEmbeddingLibraryTags().filter(function(tag) { return tag.merged; });
      var tagPage = embeddingLibraryState.data.tagPage || {};
      var tagFooter = '';
      if (embeddingLibraryState.tagSearchPending) {
        tagFooter = '<div style="width:100%;padding:8px 0;color:var(--text-secondary);font-size:12px;">停止输入 1 秒后检索...</div>';
      } else if (embeddingLibraryState.tagLoading) {
        tagFooter = '<div style="width:100%;padding:8px 0;color:var(--text-secondary);font-size:12px;">正在加载...</div>';
      } else if (tagPage.hasMore) {
        tagFooter = '<button type="button" onclick="loadMoreEmbeddingTags()" style="padding:6px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-bg);color:var(--text-primary);cursor:pointer;font-size:12px;">加载更多关键词</button>';
      }
      var selected = embeddingLibraryState.mergeSelected;
      var selectedHtml = selected.length
        ? selected.map(function(keyword) {
            return '<button type="button" onclick="toggleEmbeddingMergeKeyword(\'' + encodeURIComponent(keyword) + '\')" style="padding:5px 8px;border:1px solid var(--accent-color);border-radius:6px;background:rgba(16,163,127,0.12);color:var(--text-primary);cursor:pointer;">' + escapeHtml(keyword) + ' ×</button>';
          }).join('')
        : '<span style="color:var(--text-secondary);font-size:12px;">至少选择两个关键词</span>';
      var mergedTagsHtml = mergedTags.length
        ? '<div style="margin-bottom:10px;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--modal-bg);">' +
            '<div style="font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:8px;">已合并标签</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;max-height:92px;overflow:auto;">' +
              mergedTags.map(function(tag) {
                return renderEmbeddingKeywordButton(tag, false, '', '已合并标签');
              }).join('') +
            '</div>' +
          '</div>'
        : '';
      var searchableKeywords = tags.map(function(tag) { return String(tag.keyword || '').toLowerCase(); }).filter(Boolean);
      var selectedMap = {};
      selected.forEach(function(keyword) { selectedMap[String(keyword).toLowerCase()] = true; });
      var allSearchResultsSelected = searchableKeywords.length > 0 && searchableKeywords.every(function(keyword) { return selectedMap[keyword]; });
      var searchText = String(embeddingLibraryState.keywordSearch || '').trim();
      var bulkSearchHtml = searchText
        ? '<button type="button" onclick="toggleEmbeddingMergeSearchSelection()" ' + (searchableKeywords.length === 0 ? 'disabled' : '') + ' style="padding:9px 12px;border:1px solid var(--border-color);border-radius:6px;background:' + (allSearchResultsSelected ? 'transparent' : 'var(--modal-bg)') + ';color:var(--text-primary);cursor:' + (searchableKeywords.length === 0 ? 'not-allowed' : 'pointer') + ';white-space:nowrap;">' + (allSearchResultsSelected ? '取消全选' : '全选检索结果') + '</button>'
        : '';

      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:12px;margin-bottom:12px;">' +
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">' +
          '<input value="' + escapeHtml(embeddingLibraryState.mergeName) + '" oninput="embeddingLibraryState.mergeName=this.value" placeholder="新标签名称" style="flex:1;padding:9px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);">' +
          '<button type="button" onclick="confirmEmbeddingMergeKeywords()" style="padding:9px 12px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;">确认合并</button>' +
          '<button type="button" onclick="refreshEmbeddingMergedTags()" style="padding:9px 12px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-primary);cursor:pointer;">刷新数量</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">' +
          '<input value="' + escapeHtml(embeddingLibraryState.keywordSearch) + '" oninput="setEmbeddingKeywordSearch(this.value,this.selectionStart,this.selectionEnd)" onkeydown="handleEmbeddingKeywordSearchKey(event,this)" placeholder="搜索关键词" style="flex:1;padding:9px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);">' +
          '<button type="button" onclick="clearEmbeddingKeywordSearch()" style="padding:9px 12px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-primary);cursor:pointer;">清空搜索</button>' +
          bulkSearchHtml +
        '</div>' +
        (searchText ? '<div style="margin:-4px 0 10px;color:var(--text-secondary);font-size:12px;">当前检索结果显示 ' + searchableKeywords.length + ' 个可合并标签' + (tagPage.hasMore ? '，可继续加载更多' : '') + '</div>' : '') +
        mergedTagsHtml +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">' + selectedHtml + '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;max-height:150px;overflow:auto;">' +
          tags.map(function(tag) {
            var keyword = String(tag.keyword || '').toLowerCase();
            var active = selected.indexOf(keyword) !== -1;
            return renderEmbeddingKeywordButton(tag, active, 'toggleEmbeddingMergeKeyword', '选择原始关键词');
          }).join('') + tagFooter +
        '</div>' +
      '</div>';
    }

    window.toggleEmbeddingMergeKeyword = function(encodedKeyword) {
      var keyword = decodeURIComponent(encodedKeyword).toLowerCase();
      var selected = embeddingLibraryState.mergeSelected;
      var idx = selected.indexOf(keyword);
      if (idx >= 0) selected.splice(idx, 1);
      else selected.push(keyword);
      if (!embeddingLibraryState.mergeName && selected.length > 0) {
        embeddingLibraryState.mergeName = selected.reduce(function(a, b) { return a.length >= b.length ? a : b; });
      }
      renderEmbeddingLibrary();
    };

    window.toggleEmbeddingMergeSearchSelection = function() {
      var visibleKeywords = getEmbeddingLibraryTags()
        .filter(function(tag) { return !tag.merged; })
        .map(function(tag) { return String(tag.keyword || '').toLowerCase(); })
        .filter(Boolean);
      if (visibleKeywords.length === 0) return;

      var selected = embeddingLibraryState.mergeSelected;
      var visibleMap = {};
      visibleKeywords.forEach(function(keyword) { visibleMap[keyword] = true; });
      var selectedMap = {};
      selected.forEach(function(keyword) { selectedMap[String(keyword).toLowerCase()] = true; });
      var allVisibleSelected = visibleKeywords.every(function(keyword) { return selectedMap[keyword]; });

      if (allVisibleSelected) {
        embeddingLibraryState.mergeSelected = selected.filter(function(keyword) {
          return !visibleMap[String(keyword).toLowerCase()];
        });
      } else {
        visibleKeywords.forEach(function(keyword) {
          if (selected.indexOf(keyword) === -1) selected.push(keyword);
        });
      }

      if (!embeddingLibraryState.mergeName && embeddingLibraryState.mergeSelected.length > 0) {
        embeddingLibraryState.mergeName = embeddingLibraryState.mergeSelected.reduce(function(a, b) { return a.length >= b.length ? a : b; });
      }
      renderEmbeddingLibrary();
    };

    window.confirmEmbeddingMergeKeywords = async function() {
      var selected = embeddingLibraryState.mergeSelected;
      var newName = String(embeddingLibraryState.mergeName || '').trim();
      if (selected.length < 2 || newName.length < 2) {
        alert('请至少选择两个关键词，并输入新标签名称');
        return;
      }
      try {
        var response = await fetch('/api/embedding-library/manual-merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, keywords: selected, newName: newName })
        });
        var result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '合并失败');
        var outerTags = embeddingLibraryState.data.outerTags || { mergedTags: [], promotedTags: [] };
        outerTags.mergedTags = (outerTags.mergedTags || []).filter(function(tag) { return String(tag.name).toLowerCase() !== result.newName; });
        outerTags.mergedTags.push({
          name: result.newName,
          originalKeywords: result.originalKeywords,
          count: result.count,
          literatureIds: result.literatureIds
        });
        await fetch('/api/embedding-library/outer-tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, config: outerTags })
        });
        embeddingLibraryState.mergeSelected = [];
        embeddingLibraryState.mergeName = '';
        await reloadEmbeddingLibraryData();
      } catch (e) {
        alert('合并失败：' + e.message);
      }
    };

    window.refreshEmbeddingMergedTags = async function() {
      try {
        await fetch('/api/embedding-library/refresh-merged-tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId })
        });
        await reloadEmbeddingLibraryData();
      } catch (e) {
        alert('刷新失败：' + e.message);
      }
    };

    async function reloadEmbeddingLibraryData() {
      var response = await fetch('/api/embedding-library?userId=' + encodeURIComponent(currentUserId) + '&paperLimit=' + EMBEDDING_LIBRARY_PAGE_SIZE + '&paperOffset=0&tagLimit=' + EMBEDDING_LIBRARY_PAGE_SIZE + '&tagOffset=0');
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '读取' + getEmbeddingProjectLabels().embeddingLibrary + '失败');
      embeddingLibraryState.data = data;
      embeddingLibraryState.activeOptions = null;
      invalidateEmbeddingLibraryGraph();
      embeddingLibraryState.result = data.paperPage || { total: data.summary.count, offset: 0, limit: EMBEDDING_LIBRARY_PAGE_SIZE, hasMore: false, papers: data.papers || [] };
      renderEmbeddingLibrary();
    }

    function hasEmbeddingFilterCriteria(options) {
      return Boolean(
        (options.keywords && options.keywords.length) ||
        (options.groups && options.groups.length) ||
        options.query ||
        options.yearFrom ||
        options.yearTo ||
        (options.journals && options.journals.length) ||
        (options.documentTypes && options.documentTypes.length)
      );
    }

    async function runEmbeddingFilter(options, append) {
      var requestOptions = Object.assign({ offset: 0, limit: EMBEDDING_LIBRARY_PAGE_SIZE }, options || {});
      if (embeddingLibraryState.filterAbort) {
        embeddingLibraryState.filterAbort.abort();
      }
      var controller = new AbortController();
      embeddingLibraryState.filterAbort = controller;
      embeddingLibraryState.filterLoading = !append;
      embeddingLibraryState.loadingMore = Boolean(append);
      if (!append) {
        embeddingLibraryState.activeOptions = hasEmbeddingFilterCriteria(requestOptions)
          ? Object.assign({}, requestOptions, { offset: 0, limit: EMBEDDING_LIBRARY_PAGE_SIZE })
          : null;
        embeddingLibraryState.selectedPaperIds = {};
        embeddingLibraryState.selectAllFiltered = false;
      }
      renderEmbeddingLibrary();

      try {
        var response = await fetch('/api/embedding-library/filter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, options: requestOptions }),
          signal: controller.signal
        });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '未知错误');
        }
        if (embeddingLibraryState.data && Array.isArray(result.favoriteIds)) {
          embeddingLibraryState.data.favoriteIds = result.favoriteIds;
        }
        if (append && embeddingLibraryState.result && Array.isArray(embeddingLibraryState.result.papers)) {
          embeddingLibraryState.result = Object.assign({}, result, {
            offset: embeddingLibraryState.result.offset || 0,
            papers: embeddingLibraryState.result.papers.concat(result.papers || [])
          });
        } else {
          embeddingLibraryState.result = result;
        }
        invalidateEmbeddingLibraryGraph();
      } catch (e) {
        if (e.name !== 'AbortError') {
          alert('筛选失败：' + e.message);
        } else {
          return;
        }
      } finally {
        if (embeddingLibraryState.filterAbort === controller) {
          embeddingLibraryState.filterAbort = null;
        }
        embeddingLibraryState.filterLoading = false;
        embeddingLibraryState.loadingMore = false;
      }
      renderEmbeddingLibrary();
    }

    window.loadMoreEmbeddingResults = async function() {
      var result = embeddingLibraryState.result || {};
      var papers = Array.isArray(result.papers) ? result.papers : [];
      if (!result.hasMore || embeddingLibraryState.loadingMore) return;
      var options = embeddingLibraryState.activeOptions
        ? Object.assign({}, embeddingLibraryState.activeOptions)
        : {};
      options.offset = papers.length;
      options.limit = EMBEDDING_LIBRARY_PAGE_SIZE;
      try {
        await runEmbeddingFilter(options, true);
      } catch (e) {
        if (e.name !== 'AbortError') {
          alert('加载失败：' + e.message);
          embeddingLibraryState.loadingMore = false;
          renderEmbeddingLibrary();
        }
      }
    };

    async function loadEmbeddingTags(reset) {
      var data = embeddingLibraryState.data;
      if (!data) return;
      var requestId = ++embeddingLibraryState.tagRequestId;
      var offset = reset ? 0 : (Array.isArray(data.tags) ? data.tags.length : 0);
      embeddingLibraryState.tagSearchPending = false;
      embeddingLibraryState.tagLoading = true;
      renderEmbeddingLibrary();
      var response = await fetch('/api/embedding-library/tags?userId=' + encodeURIComponent(currentUserId) + '&limit=' + EMBEDDING_LIBRARY_PAGE_SIZE + '&offset=' + offset + '&query=' + encodeURIComponent(embeddingLibraryState.keywordSearch || ''));
      var result = await response.json();
      if (requestId !== embeddingLibraryState.tagRequestId) return;
      if (!response.ok || !result.success) {
        throw new Error(result.error || '关键词加载失败');
      }
      if (reset) {
        data.tags = result.tags || [];
      } else {
        var seen = {};
        (data.tags || []).forEach(function(tag) {
          seen[String(tag.keyword || '').toLowerCase()] = true;
        });
        (result.tags || []).forEach(function(tag) {
          var key = String(tag.keyword || '').toLowerCase();
          if (!seen[key]) {
            seen[key] = true;
            data.tags.push(tag);
          }
        });
      }
      data.tagPage = {
        totalKeywords: result.totalKeywords || 0,
        offset: result.offset || 0,
        limit: result.limit || EMBEDDING_LIBRARY_PAGE_SIZE,
        hasMore: Boolean(result.hasMore),
        tags: result.tags || []
      };
      embeddingLibraryState.tagLoading = false;
      renderEmbeddingLibrary();
      focusEmbeddingKeywordSearchInput();
    }

    window.loadMoreEmbeddingTags = function() {
      if (embeddingLibraryState.tagLoading) return;
      loadEmbeddingTags(false).catch(function(e) {
        embeddingLibraryState.tagLoading = false;
        renderEmbeddingLibrary();
        alert('关键词加载失败：' + e.message);
      });
    };

    function renderEmbeddingResults() {
      var result = embeddingLibraryState.result || { total: 0, papers: [] };
      var papers = Array.isArray(result.papers) ? result.papers : [];
      var startIndex = Number(result.offset || 0);
      var selectedCount = getEmbeddingSelectedPaperCount();
      var visibleIds = getEmbeddingVisiblePaperIds();
      var visibleSelectableIds = visibleIds.filter(Boolean);
      var allVisibleSelected = visibleSelectableIds.length > 0 && visibleSelectableIds.every(function(id) {
        return embeddingLibraryState.selectAllFiltered || !!embeddingLibraryState.selectedPaperIds[id];
      });
      var selectionLabel = embeddingLibraryState.selectAllFiltered
        ? ('已选择当前筛选结果全部 ' + (result.total || 0) + ' 篇')
        : ('已选择 ' + selectedCount + ' 篇');
      var rows = papers.length
        ? papers.map(function(paper, index) {
            var keywords = (paper.keywords || []).concat(paper.aiKeywords || []).slice(0, 8);
            var id = String(paper.id || paper.doi || paper.title || '');
            var favorite = typeof paper.favorite === 'boolean' ? paper.favorite : isEmbeddingFavorite(id);
            var selected = embeddingLibraryState.selectAllFiltered || !!embeddingLibraryState.selectedPaperIds[id];
            return '<div role="button" tabindex="0" onclick="openEmbeddingLiteratureDetail(\'' + encodeURIComponent(id) + '\')" onkeydown="if(event.key===\'Enter\'){openEmbeddingLiteratureDetail(\'' + encodeURIComponent(id) + '\')}" style="display:block;width:100%;text-align:left;padding:12px;border:0;border-bottom:1px solid var(--border-color);background:transparent;color:inherit;cursor:pointer;">' +
              '<div style="display:flex;gap:10px;align-items:flex-start;">' +
                '<label title="选择该' + escapeHtml(getEmbeddingEvidenceName()) + '" onclick="event.stopPropagation()" onkeydown="event.stopPropagation()" style="padding-top:2px;cursor:pointer;">' +
                  '<input type="checkbox" value="' + escapeHtml(id) + '"' + (selected ? ' checked' : '') + ' onchange="toggleEmbeddingPaperSelection(this.value,this.checked)" style="width:15px;height:15px;accent-color:var(--accent-color);cursor:pointer;">' +
                '</label>' +
                '<div style="min-width:0;flex:1;">' +
                  '<div style="font-size:13px;font-weight:700;line-height:1.45;color:var(--text-primary);">' + (startIndex + index + 1) + '. ' + escapeHtml(paper.title || ('未命名' + getEmbeddingEvidenceName())) + '</div>' +
                  '<div style="margin-top:5px;color:var(--text-secondary);font-size:12px;">' + escapeHtml([paper.author, paper.year, paper.journal].filter(Boolean).join(' · ')) + (paper.hasEmbedding ? ' · embedding' : '') + '</div>' +
                  (paper.doi ? '<div style="margin-top:4px;color:var(--text-secondary);font-size:11px;">DOI: ' + escapeHtml(paper.doi) + '</div>' : '') +
                  (keywords.length ? '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px;">' + keywords.map(function(keyword) { return '<span style="font-size:11px;color:var(--text-secondary);border:1px solid var(--border-color);border-radius:5px;padding:2px 5px;">' + escapeHtml(keyword) + '</span>'; }).join('') + '</div>' : '') +
                  (paper.abstract ? '<div style="margin-top:8px;color:var(--text-secondary);font-size:12px;line-height:1.55;">' + escapeHtml(String(paper.abstract).slice(0, 420)) + (String(paper.abstract).length > 420 ? '...' : '') + '</div>' : '') +
                '</div>' +
                renderEmbeddingFavoriteButton(id, favorite, true) +
              '</div>' +
            '</div>';
          }).join('')
        : '<div style="padding:30px;text-align:center;color:var(--text-secondary);font-size:13px;">没有匹配的' + escapeHtml(getEmbeddingEvidenceName()) + '</div>';
      var footer = '';
      if (embeddingLibraryState.filterLoading) {
        footer = '<div style="padding:10px 12px;border-top:1px solid var(--border-color);color:var(--text-secondary);font-size:12px;">正在筛选...</div>';
      } else if (result.hasMore) {
        footer = '<div style="padding:10px 12px;border-top:1px solid var(--border-color);text-align:center;background:var(--bg-secondary);">' +
          '<button type="button" onclick="loadMoreEmbeddingResults()" ' + (embeddingLibraryState.loadingMore ? 'disabled' : '') + ' style="padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-bg);color:var(--text-primary);cursor:pointer;">' + (embeddingLibraryState.loadingMore ? '正在加载...' : '加载更多 100 篇') + '</button>' +
        '</div>';
      }
      return '<div style="border:1px solid var(--border-color);border-radius:8px;overflow:hidden;background:var(--modal-bg);">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border-color);background:var(--bg-secondary);">' +
          '<div style="font-weight:700;font-size:13px;">筛选结果</div>' +
          '<div style="font-size:12px;color:var(--text-secondary);">共 ' + (result.total || 0) + ' 篇，显示 ' + papers.length + ' 篇</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border-color);background:var(--bg-primary);">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
            '<label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);cursor:pointer;">' +
              '<input type="checkbox"' + (allVisibleSelected ? ' checked' : '') + ' onchange="toggleEmbeddingVisiblePaperSelection(this.checked)" style="width:14px;height:14px;accent-color:var(--accent-color);">全选当前页' +
            '</label>' +
            '<button type="button" onclick="selectAllEmbeddingFilteredPapers()" style="padding:6px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">全选当前筛选结果</button>' +
            '<button type="button" onclick="clearEmbeddingPaperSelection()" style="padding:6px 9px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-primary);cursor:pointer;font-size:12px;">清空选择</button>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;white-space:nowrap;">' +
            '<span style="font-size:12px;color:var(--text-secondary);">' + selectionLabel + '</span>' +
            '<button type="button" onclick="showEmbeddingDownloadDialog()" ' + (selectedCount === 0 && !embeddingLibraryState.selectAllFiltered ? 'disabled' : '') + ' style="padding:7px 10px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:' + (selectedCount === 0 && !embeddingLibraryState.selectAllFiltered ? 'not-allowed' : 'pointer') + ';opacity:' + (selectedCount === 0 && !embeddingLibraryState.selectAllFiltered ? '0.55' : '1') + ';font-size:12px;">批量下载PDF</button>' +
          '</div>' +
        '</div>' +
        '<div style="max-height:470px;overflow:auto;">' + rows + '</div>' +
        footer +
      '</div>';
    }

    function getEmbeddingVisiblePaperIds() {
      var result = embeddingLibraryState.result || {};
      return (Array.isArray(result.papers) ? result.papers : []).map(function(paper) {
        return String(paper.id || paper.doi || paper.title || '');
      }).filter(Boolean);
    }

    function getEmbeddingSelectedPaperCount() {
      if (embeddingLibraryState.selectAllFiltered) {
        return Number((embeddingLibraryState.result && embeddingLibraryState.result.total) || 0);
      }
      return Object.keys(embeddingLibraryState.selectedPaperIds || {}).filter(function(id) {
        return !!embeddingLibraryState.selectedPaperIds[id];
      }).length;
    }

    window.toggleEmbeddingPaperSelection = function(id, checked) {
      if (!id) return;
      if (embeddingLibraryState.selectAllFiltered) {
        embeddingLibraryState.selectAllFiltered = false;
        getEmbeddingVisiblePaperIds().forEach(function(visibleId) {
          if (visibleId !== id) embeddingLibraryState.selectedPaperIds[visibleId] = true;
        });
      }
      if (checked) embeddingLibraryState.selectedPaperIds[id] = true;
      else delete embeddingLibraryState.selectedPaperIds[id];
      renderEmbeddingLibrary();
    };

    window.toggleEmbeddingVisiblePaperSelection = function(checked) {
      embeddingLibraryState.selectAllFiltered = false;
      getEmbeddingVisiblePaperIds().forEach(function(id) {
        if (checked) embeddingLibraryState.selectedPaperIds[id] = true;
        else delete embeddingLibraryState.selectedPaperIds[id];
      });
      renderEmbeddingLibrary();
    };

    window.selectAllEmbeddingFilteredPapers = function() {
      if (!embeddingLibraryState.result || Number(embeddingLibraryState.result.total || 0) === 0) return;
      embeddingLibraryState.selectedPaperIds = {};
      embeddingLibraryState.selectAllFiltered = true;
      renderEmbeddingLibrary();
    };

    window.clearEmbeddingPaperSelection = function() {
      embeddingLibraryState.selectedPaperIds = {};
      embeddingLibraryState.selectAllFiltered = false;
      renderEmbeddingLibrary();
    };

    window.showEmbeddingDownloadDialog = function() {
      var existing = document.getElementById('embeddingDownloadDialog');
      if (existing) existing.remove();
      var count = getEmbeddingSelectedPaperCount();
      if (count === 0) {
        alert('请先选择需要下载的' + getEmbeddingEvidenceName());
        return;
      }
      var dialog = document.createElement('div');
      dialog.id = 'embeddingDownloadDialog';
      dialog.className = 'app-secondary-overlay app-tertiary-overlay';
      dialog.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.48);z-index:10060;display:flex;align-items:center;justify-content:center;padding:20px;';
      dialog.onclick = function(event) {
        if (event.target === dialog) closeEmbeddingDownloadDialog();
      };
      dialog.innerHTML =
        '<div id="embeddingDownloadPanel" style="width:min(620px,94vw);background:var(--modal-bg);border:1px solid var(--modal-border);border-radius:10px;box-shadow:0 20px 70px rgba(0,0,0,0.38);overflow:hidden;" onclick="event.stopPropagation()">' +
          '<div style="padding:14px 16px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;gap:12px;align-items:center;">' +
            '<div style="font-size:16px;font-weight:700;color:var(--text-primary);">批量下载选中' + escapeHtml(getEmbeddingEvidenceName()) + ' PDF</div>' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
              '<button type="button" onclick="closeEmbeddingDownloadDialog()" style="width:30px;height:30px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-secondary);cursor:pointer;">×</button>' +
            '</div>' +
          '</div>' +
          '<div style="padding:16px;display:flex;flex-direction:column;gap:12px;color:var(--text-primary);">' +
            '<div style="padding:10px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);font-size:12px;line-height:1.6;color:var(--text-secondary);">' +
              '将从选中' + escapeHtml(getEmbeddingEvidenceName()) + '中提取 DOI，去重后自动调用内置开放获取下载器：Semantic Scholar → CORE API → OpenAlex → PubMed/NCBI E-utilities → Crossref → Unpaywall → Europe PMC/PMC。只会下载可公开访问的 OA PDF；找不到的条目会写入报告。' +
            '</div>' +
            '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">已选择：' + count + ' 篇；' + (embeddingLibraryState.selectAllFiltered ? '模式：当前筛选结果全部' : '模式：手动勾选') + '</div>' +
            '<label style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);font-size:12px;color:var(--text-primary);">' +
              '<span>并行下载数 <span style="color:var(--text-secondary);">建议 3-4</span></span>' +
              '<input id="embeddingDownloadConcurrency" type="number" min="1" max="8" value="4" style="width:72px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-size:12px;">' +
            '</label>' +
            '<label style="display:flex;align-items:flex-start;gap:8px;padding:9px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);font-size:12px;color:var(--text-primary);line-height:1.5;">' +
              '<input id="embeddingInstitutionalDownload" type="checkbox" checked style="margin-top:2px;">' +
              '<span>OA 找不到时尝试机构网络下载 <span style="color:var(--text-secondary);">请先连接学校 VPN、校园网或图书馆代理；软件会打开 DOI 出版社页识别 PDF。</span></span>' +
            '</label>' +
            '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px;">' +
              '<button type="button" onclick="closeEmbeddingDownloadDialog()" style="padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">取消</button>' +
              '<button type="button" id="embeddingDownloadConfirmBtn" onclick="downloadSelectedEmbeddingPapers()" style="padding:8px 12px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">提取 DOI 并下载</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(dialog);
    };

    window.closeEmbeddingDownloadDialog = function() {
      var dialog = document.getElementById('embeddingDownloadDialog');
      if (dialog) dialog.remove();
    };

    function scrollEmbeddingDownloadProgress() {
      if (typeof maybeScrollChatToBottom === 'function') {
        maybeScrollChatToBottom(true);
        return;
      }
      var messages = document.getElementById('messages');
      if (messages) messages.scrollTop = messages.scrollHeight;
    }

    function createEmbeddingDownloadProgressLogger(count, allFiltered) {
      var messages = document.getElementById('messages');
      var pageEmptyState = document.getElementById('emptyState');
      if (!messages) {
        return {
          log: function() { return Promise.resolve(); },
          showDownloadLink: function() {}
        };
      }
      if (pageEmptyState) pageEmptyState.style.display = 'none';
      var id = 'embeddingDownloadProgress_' + Date.now();
      var div = document.createElement('div');
      div.className = 'message bot';
      div.innerHTML =
        '<div class="avatar bot"><img src="/bot.jpg" alt="Scholar Harness"></div>' +
        '<div class="content">' +
          '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);overflow:hidden;">' +
            '<div style="padding:10px 12px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;gap:12px;align-items:center;">' +
              '<div style="font-size:13px;font-weight:700;color:var(--text-primary);">' + escapeHtml(getEmbeddingProjectLabels().embeddingLibrary) + ' OA PDF 查找</div>' +
              '<div style="font-size:12px;color:var(--text-secondary);white-space:nowrap;">' + (allFiltered ? '当前筛选结果' : '手动勾选') + ' · ' + count + ' 篇</div>' +
            '</div>' +
            '<pre id="' + id + '" style="margin:0;padding:12px;min-height:118px;max-height:260px;overflow:auto;background:transparent;color:var(--text-primary);font:12px/1.65 Consolas, Monaco, monospace;white-space:pre-wrap;"></pre>' +
            '<div id="' + id + '_actions" style="display:none;padding:0 12px 12px;"></div>' +
          '</div>' +
        '</div>';
      messages.appendChild(div);
      scrollEmbeddingDownloadProgress();

      var logEl = document.getElementById(id);
      var queue = Promise.resolve();
      var typeText = function(text) {
        return new Promise(function(resolve) {
          if (!logEl) {
            resolve();
            return;
          }
          var i = 0;
          var step = function() {
            logEl.textContent += text.slice(i, i + 2);
            i += 2;
            if (logEl.scrollHeight > logEl.clientHeight) logEl.scrollTop = logEl.scrollHeight;
            scrollEmbeddingDownloadProgress();
            if (i < text.length) {
              setTimeout(step, 12);
            } else {
              resolve();
            }
          };
          step();
        });
      };
      return {
        log: function(message) {
          var time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          queue = queue.then(function() {
            return typeText('[' + time + '] ' + message + '\n');
          });
          return queue;
        },
        showDownloadLink: function(url, filename) {
          var actionsEl = document.getElementById(id + '_actions');
          if (!actionsEl) return;
          actionsEl.innerHTML = '';
          var link = document.createElement('a');
          link.href = url;
          link.download = filename;
          link.textContent = '如果没有自动下载，请点击这里保存 ZIP';
          link.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:#fff;text-decoration:none;font-size:12px;font-weight:600;';
          actionsEl.appendChild(link);
          actionsEl.style.display = 'block';
          scrollEmbeddingDownloadProgress();
        }
      };
    }

    window.downloadSelectedEmbeddingPapers = async function() {
      var btn = document.getElementById('embeddingDownloadConfirmBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '正在查找 OA PDF...';
      }
      try {
        var body = {
          userId: currentUserId,
          selectionMode: embeddingLibraryState.selectAllFiltered ? 'filtered' : 'ids',
          paperIds: Object.keys(embeddingLibraryState.selectedPaperIds || {}).filter(function(id) { return !!embeddingLibraryState.selectedPaperIds[id]; }),
          options: embeddingLibraryState.activeOptions || {},
          downloadConcurrency: Math.max(1, Math.min(8, parseInt(document.getElementById('embeddingDownloadConcurrency')?.value || '4', 10) || 4)),
          useInstitutionalDownload: !!document.getElementById('embeddingInstitutionalDownload')?.checked
        };
        var selectedCount = getEmbeddingSelectedPaperCount();
        var logger = createEmbeddingDownloadProgressLogger(selectedCount, !!embeddingLibraryState.selectAllFiltered);
        closeEmbeddingDownloadDialog();
        closeEmbeddingLibrary();
        logger.log('已接收批量查找任务，正在从选中' + getEmbeddingEvidenceName() + '中提取 DOI。');
        logger.log('页面已切回主页，查找和下载会在后台继续执行。');
        logger.log('服务端将以最多 ' + body.downloadConcurrency + ' 个并行任务查找和下载 OA PDF。');
        if (body.useInstitutionalDownload) {
          logger.log('OA 找不到的条目会继续尝试机构网络下载；请确认已连接学校 VPN、校园网或图书馆代理。');
        }
        var progressMessages = [
          '正在对 DOI 去重，并准备调用内置开放获取下载器。',
          '正在查询 Semantic Scholar、CORE API 和 OpenAlex 的开放 PDF 线索。',
          '正在查询 PubMed / NCBI E-utilities 与 Crossref 的全文入口。',
          '正在查询 Unpaywall 的 OA 位置。',
          '正在查询 Europe PMC / PMC 的全文和 PDF 入口。',
          '对 OA 未命中的条目，正在尝试通过机构网络访问 DOI 出版社页识别 PDF。',
          '正在下载可公开访问的 PDF，并整理失败原因。'
        ];
        var progressIndex = 0;
        var waitingTicks = 0;
        var progressTimer = setInterval(function() {
          if (progressIndex < progressMessages.length) {
            logger.log(progressMessages[progressIndex]);
            progressIndex += 1;
          } else {
            waitingTicks += 1;
            if (waitingTicks === 1 || waitingTicks % 6 === 0) {
              logger.log('服务端仍在处理批量查找任务；条目较多或开放源响应慢时可能需要几分钟。');
            }
          }
        }, 2400);
        var response = await fetch('/api/embedding-library/download-by-doi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        clearInterval(progressTimer);
        if (!response.ok) {
          var errorText = await response.text();
          try {
            var errorJson = JSON.parse(errorText);
            throw new Error(errorJson.error || '下载失败');
          } catch (parseError) {
            throw new Error(errorText || '下载失败');
          }
        }
        logger.log('服务端已完成查找，正在生成 ZIP 压缩包和 download-report 报告。');
        var blob = await response.blob();
        if (!blob || blob.size === 0) {
          throw new Error('服务端返回了空文件，未能生成 ZIP 压缩包');
        }
        var url = URL.createObjectURL(blob);
        var filename = 'embedding-library-doi-download.zip';
        logger.showDownloadLink(url, filename);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(url); }, 10 * 60 * 1000);
        logger.log('查找完成，ZIP 文件已开始下载；download-report.json/csv 已包含在压缩包内。');
      } catch (e) {
        if (typeof progressTimer !== 'undefined') clearInterval(progressTimer);
        var fallbackLogger = logger || createEmbeddingDownloadProgressLogger(getEmbeddingSelectedPaperCount(), !!embeddingLibraryState.selectAllFiltered);
        fallbackLogger.log('批量查找失败：' + e.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '提取 DOI 并下载';
        }
      }
    };

    function captureEmbeddingLiteratureDetailReturnState() {
      var content = document.getElementById('embeddingLibraryContent');
      if (!content || embeddingLibraryState.detailReturnState) return;
      var activeElement = document.activeElement;
      embeddingLibraryState.detailReturnState = {
        scrollTop: content.scrollTop,
        scrollLeft: content.scrollLeft,
        overflow: content.style.overflow,
        activeElement: activeElement && content.contains(activeElement) ? activeElement : null
      };
    }

    function renderEmbeddingLiteratureDetailLayer() {
      var content = document.getElementById('embeddingLibraryContent');
      if (!content) return;
      var layer = document.getElementById('embeddingLibraryDetailLayer');
      if (!layer) {
        layer = document.createElement('section');
        layer.id = 'embeddingLibraryDetailLayer';
        layer.className = 'embedding-library-detail-layer';
        layer.setAttribute('aria-label', getEmbeddingEvidenceName() + '详情');
        content.appendChild(layer);
        content.scrollTop = 0;
        content.scrollLeft = 0;
      }
      content.style.overflow = 'hidden';
      layer.setAttribute('aria-busy', embeddingLibraryState.detailLoading ? 'true' : 'false');
      layer.innerHTML = renderEmbeddingLiteratureDetail();
      layer.scrollTop = 0;
    }

    window.openEmbeddingLiteratureDetail = async function(encodedId) {
      var id = decodeURIComponent(encodedId);
      captureEmbeddingLiteratureDetailReturnState();
      embeddingLibraryState.detail = null;
      embeddingLibraryState.detailLoading = true;
      renderEmbeddingLibrary();
      try {
        var response = await fetch('/api/embedding-library/literature/' + encodeURIComponent(id) + '?userId=' + encodeURIComponent(currentUserId));
        var result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '读取' + getEmbeddingEvidenceName() + '详情失败');
        embeddingLibraryState.detail = result.literature;
      } catch (e) {
        embeddingLibraryState.detail = { error: e.message };
      } finally {
        embeddingLibraryState.detailLoading = false;
        renderEmbeddingLibrary();
      }
    };

    window.backToEmbeddingLibrary = function() {
      var content = document.getElementById('embeddingLibraryContent');
      var returnState = embeddingLibraryState.detailReturnState;
      var layer = document.getElementById('embeddingLibraryDetailLayer');
      if (layer) layer.remove();
      embeddingLibraryState.detail = null;
      embeddingLibraryState.detailLoading = false;
      embeddingLibraryState.detailReturnState = null;
      if (!content) return;
      content.style.overflow = returnState
        ? returnState.overflow
        : (embeddingLibraryState.mode === 'graph' ? 'hidden' : 'auto');
      requestAnimationFrame(function() {
        content.scrollTop = returnState ? returnState.scrollTop : 0;
        content.scrollLeft = returnState ? returnState.scrollLeft : 0;
        if (
          returnState &&
          returnState.activeElement &&
          returnState.activeElement.isConnected &&
          typeof returnState.activeElement.focus === 'function'
        ) {
          returnState.activeElement.focus({ preventScroll: true });
        }
        if (embeddingGraphRuntime) {
          drawEmbeddingObsidianGraph(embeddingGraphRuntime);
        }
      });
    };

    function renderEmbeddingLiteratureDetail() {
      if (embeddingLibraryState.detailLoading) {
        return '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:13px;">正在加载' + escapeHtml(getEmbeddingEvidenceName()) + '详情...</div>';
      }
      var lit = embeddingLibraryState.detail || {};
      if (lit.error) {
        return '<div style="display:flex;flex-direction:column;height:100%;">' +
          '<div style="margin-bottom:12px;"><button type="button" onclick="backToEmbeddingLibrary()" style="padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">返回</button></div>' +
          '<div style="padding:30px;text-align:center;color:var(--danger-color);font-size:13px;">' + escapeHtml(lit.error) + '</div>' +
        '</div>';
      }
      var authors = formatEmbeddingAuthors(lit);
      var litId = String(lit.id || lit.doi || lit.title || '');
      var favorite = typeof lit.favorite === 'boolean' ? lit.favorite : isEmbeddingFavorite(litId);
      var doi = normalizeDoi(lit.doi || '');
      var doiHtml = doi
        ? '<a href="' + escapeHtml(toDoiUrl(doi)) + '" target="_blank" rel="noopener noreferrer" style="color:var(--accent-color);text-decoration:underline;word-break:break-all;">' + escapeHtml(doi) + '</a>'
        : '<span style="color:var(--text-secondary);">未提供</span>';
      var keywords = Array.isArray(lit.allKeywords) ? lit.allKeywords : (lit.preview ? (lit.preview.keywords || []).concat(lit.preview.aiKeywords || []) : []);
      var keywordHtml = keywords.length
        ? keywords.map(function(keyword) { return '<span style="font-size:12px;color:var(--text-secondary);border:1px solid var(--border-color);border-radius:5px;padding:3px 6px;">' + escapeHtml(keyword) + '</span>'; }).join('')
        : '<span style="color:var(--text-secondary);font-size:12px;">未提供</span>';
      var hidden = {
        preview: true,
        allKeywords: true,
        id: true,
        title: true,
        author: true,
        authors: true,
        year: true,
        journal: true,
        doi: true,
        abstract: true,
        keywords: true,
        aiKeywords: true
      };
      var rows = Object.keys(lit).filter(function(key) {
        return !hidden[key] && lit[key] !== undefined && lit[key] !== null && lit[key] !== '';
      }).map(function(key) {
        return '<tr>' +
          '<td style="width:180px;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--border-color);color:var(--text-secondary);font-size:12px;">' + escapeHtml(key) + '</td>' +
          '<td style="vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--border-color);color:var(--text-primary);font-size:12px;line-height:1.55;word-break:break-word;">' + renderEmbeddingDetailValue(lit[key]) + '</td>' +
        '</tr>';
      }).join('');

      return '<div style="display:flex;flex-direction:column;gap:12px;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">' +
          '<button type="button" onclick="backToEmbeddingLibrary()" style="padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;">返回</button>' +
          renderEmbeddingFavoriteButton(litId, favorite, false) +
        '</div>' +
        '<section style="border:1px solid var(--border-color);border-radius:8px;background:var(--modal-bg);overflow:hidden;">' +
          '<div style="padding:14px 16px;border-bottom:1px solid var(--border-color);background:var(--bg-secondary);">' +
            '<div style="font-size:18px;font-weight:700;line-height:1.45;color:var(--text-primary);">' + escapeHtml(lit.title || ('未命名' + getEmbeddingEvidenceName())) + '</div>' +
            '<div style="margin-top:8px;color:var(--text-secondary);font-size:12px;line-height:1.6;">' + escapeHtml([authors, lit.year, lit.journal].filter(Boolean).join(' · ')) + '</div>' +
          '</div>' +
          '<div style="padding:14px 16px;display:grid;grid-template-columns:120px 1fr;gap:10px 14px;font-size:13px;line-height:1.65;">' +
            '<div style="color:var(--text-secondary);">DOI</div><div>' + doiHtml + '</div>' +
            '<div style="color:var(--text-secondary);">关键词</div><div style="display:flex;gap:6px;flex-wrap:wrap;">' + keywordHtml + '</div>' +
            '<div style="color:var(--text-secondary);">摘要</div><div style="white-space:pre-wrap;color:var(--text-primary);">' + escapeHtml(lit.abstract || '未提供') + '</div>' +
          '</div>' +
        '</section>' +
        (rows ? '<section style="border:1px solid var(--border-color);border-radius:8px;background:var(--modal-bg);overflow:hidden;"><table style="width:100%;border-collapse:collapse;">' + rows + '</table></section>' : '') +
      '</div>';
    }

    function formatEmbeddingAuthors(lit) {
      if (lit.author) return String(lit.author);
      if (!Array.isArray(lit.authors)) return '';
      return lit.authors.map(function(author) {
        return typeof author === 'string' ? author : (author && author.name ? author.name : '');
      }).filter(Boolean).join(', ');
    }

    function renderEmbeddingDetailValue(value) {
      if (Array.isArray(value)) {
        if (value.length > 40 && typeof value[0] === 'number') {
          return escapeHtml('数组长度 ' + value.length + '，前 12 项：' + value.slice(0, 12).join(', '));
        }
        return escapeHtml(value.map(function(item) {
          return typeof item === 'object' ? JSON.stringify(item) : String(item);
        }).join('; '));
      }
      if (typeof value === 'object') {
        return '<pre style="margin:0;white-space:pre-wrap;font-family:inherit;">' + escapeHtml(JSON.stringify(value, null, 2)) + '</pre>';
      }
      return escapeHtml(String(value));
    }


})();

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('embedding-library', { source: '/embedding-library.js' });
}

