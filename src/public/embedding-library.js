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
      selectedPaperIds: {},
      selectAllFiltered: false
    };

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
      if (embeddingLibraryState.filterAbort) {
        embeddingLibraryState.filterAbort.abort();
      }
      if (embeddingLibraryState.tagSearchTimer) {
        clearTimeout(embeddingLibraryState.tagSearchTimer);
      }
      var modal = document.getElementById('embeddingLibraryModal');
      if (modal) modal.remove();
    }
    window.closeEmbeddingLibrary = closeEmbeddingLibrary;

    window.showEmbeddingLibrary = async function() {
      var existing = document.getElementById('embeddingLibraryModal');
      if (existing) existing.remove();

      var modal = document.createElement('div');
      modal.id = 'embeddingLibraryModal';
      modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.62);display:flex;align-items:center;justify-content:center;z-index:10020;padding:20px;';
      modal.classList.add('custom-fullscreen-overlay');
      modal.onclick = function(event) {
        if (event.target === modal) closeEmbeddingLibrary();
      };
      modal.innerHTML =
        '<div id="embeddingLibraryPanel" class="custom-fullscreen-panel" style="width:min(1180px,96vw);height:min(900px,96vh);background:var(--modal-bg);border:1px solid var(--modal-border);border-radius:8px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,0.35);" onclick="event.stopPropagation()">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border-color);">' +
            '<div style="font-size:16px;font-weight:700;color:var(--text-primary);">' + escapeHtml(getEmbeddingProjectLabels().embeddingLibrary) + '</div>' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
              '<button id="embeddingLibraryFullscreenBtn" class="modal-icon-btn" type="button" onclick="toggleCustomModalFullscreen(\'embeddingLibraryModal\',\'embeddingLibraryPanel\',\'embeddingLibraryFullscreenBtn\')" title="全屏" aria-label="全屏"><svg class="ui-icon sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5"></path><path d="M16 3h5v5"></path><path d="M21 16v5h-5"></path><path d="M3 16v5h5"></path></svg></button>' +
              '<button type="button" onclick="closeEmbeddingLibrary()" style="width:32px;height:32px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-secondary);cursor:pointer;">×</button>' +
            '</div>' +
          '</div>' +
          '<div id="embeddingLibraryContent" style="min-height:0;flex:1;overflow:auto;padding:18px;color:var(--text-primary);">' +
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
        embeddingLibraryState.selectedPaperIds = {};
        embeddingLibraryState.selectAllFiltered = false;
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
        content.innerHTML = renderEmbeddingLiteratureDetail();
        return;
      }

      var data = embeddingLibraryState.data;
      var summary = data.summary || {};
      var mode = embeddingLibraryState.mode;
      var tabs =
        '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
          renderEmbeddingLibraryTab('quick', '快速筛选') +
          renderEmbeddingLibraryTab('advanced', '高级筛选') +
          renderEmbeddingLibraryTab('merge', '合并标签') +
        '</div>';
      var stats =
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px;">' +
          renderEmbeddingStat(getEmbeddingEvidenceName(), summary.count || 0) +
          renderEmbeddingStat('有摘要', summary.abstractCount || 0) +
          renderEmbeddingStat('有 embedding', summary.embeddingCount || 0) +
          renderEmbeddingStat('关键词', data.totalKeywords || 0) +
        '</div>';
      var body = mode === 'advanced'
        ? renderEmbeddingAdvancedPanel()
        : (mode === 'merge' ? renderEmbeddingMergePanel() : renderEmbeddingQuickPanel());

      content.innerHTML = stats + tabs + body + renderEmbeddingResults();
    }

    function renderEmbeddingLibraryTab(id, label) {
      var active = embeddingLibraryState.mode === id;
      return '<button type="button" onclick="switchEmbeddingLibraryMode(\'' + id + '\')" style="padding:8px 12px;border:1px solid ' + (active ? 'var(--accent-color)' : 'var(--border-color)') + ';border-radius:6px;background:' + (active ? 'rgba(16,163,127,0.12)' : 'var(--bg-secondary)') + ';color:var(--text-primary);cursor:pointer;">' + label + '</button>';
    }

    function renderEmbeddingStat(label, value) {
      return '<div style="padding:10px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);">' +
        '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">' + label + '</div>' +
        '<div style="font-size:20px;font-weight:700;color:var(--text-primary);">' + value + '</div>' +
      '</div>';
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
      embeddingLibraryState.mode = mode;
      renderEmbeddingLibrary();
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
      dialog.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.48);z-index:10060;display:flex;align-items:center;justify-content:center;padding:20px;';
      dialog.onclick = function(event) {
        if (event.target === dialog) closeEmbeddingDownloadDialog();
      };
      dialog.innerHTML =
        '<div id="embeddingDownloadPanel" style="width:min(620px,94vw);background:var(--modal-bg);border:1px solid var(--modal-border);border-radius:10px;box-shadow:0 20px 70px rgba(0,0,0,0.38);overflow:hidden;" onclick="event.stopPropagation()">' +
          '<div style="padding:14px 16px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;gap:12px;align-items:center;">' +
            '<div style="font-size:16px;font-weight:700;color:var(--text-primary);">批量下载选中' + escapeHtml(getEmbeddingEvidenceName()) + ' PDF</div>' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
              '<button id="embeddingDownloadFullscreenBtn" class="modal-icon-btn" type="button" onclick="toggleCustomModalFullscreen(\'embeddingDownloadDialog\',\'embeddingDownloadPanel\',\'embeddingDownloadFullscreenBtn\')" title="全屏" aria-label="全屏"><svg class="ui-icon sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5"></path><path d="M16 3h5v5"></path><path d="M21 16v5h-5"></path><path d="M3 16v5h5"></path></svg></button>' +
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

    window.openEmbeddingLiteratureDetail = async function(encodedId) {
      var id = decodeURIComponent(encodedId);
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
      embeddingLibraryState.detail = null;
      embeddingLibraryState.detailLoading = false;
      renderEmbeddingLibrary();
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

