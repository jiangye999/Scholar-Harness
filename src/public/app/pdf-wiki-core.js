window.showPdfWikiViewer = async function(options) {
      options = options || {};
      if (options.returnTarget) {
        pdfWikiViewerReturnTarget = String(options.returnTarget);
        pdfWikiViewerReturnState = options.returnState || null;
      } else if (!options.preserveReturnTarget) {
        pdfWikiViewerReturnTarget = '';
        pdfWikiViewerReturnState = null;
      }
      if (typeof syncLeftSidebarLayoutState === 'function') syncLeftSidebarLayoutState();
      if (typeof resetMainWorkspaceHorizontalPosition === 'function') resetMainWorkspaceHorizontalPosition();
      prepareStandaloneWorkspaceSurface('pdfWikiViewerModal');
      setPdfWikiWorkspaceMode(options.workspaceMode || (options.skipInitialLoad ? pdfWikiWorkspaceMode : 'claims'));
      var existingModal = document.getElementById('pdfWikiViewerModal');
      if (existingModal) existingModal.remove();
      pdfWikiSelectedEntryIds = {};
      pdfWikiActiveEntryId = null;
      pdfWikiSelectedSentencePointIds = {};
      pdfWikiActiveSentencePointId = null;
      var initialTitle = options.initialTitle || 'Wiki论点库';
      var initialSubtitle = options.initialSubtitle || '正在加载...';
      var initialLoadingText = options.initialLoadingText || '正在读取 PDF Wiki...';

      var modal = document.createElement('div');
      modal.id = 'pdfWikiViewerModal';
      modal.className = 'app-secondary-overlay' + (pdfWikiWorkspaceMode === 'pdf-reader' ? ' pdf-wiki-reader-overlay' : '');
      modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.62);display:flex;align-items:center;justify-content:center;z-index:10020;padding:20px;';
      var defaultFullscreen = options.fullscreen !== false;
      if (defaultFullscreen) {
        modal.classList.add('custom-fullscreen-overlay');
      }
      modal.onclick = function(event) {
        if (event.target === modal) handlePdfWikiViewerClose();
      };
      modal.innerHTML =
        '<div id="pdfWikiViewerPanel" class="' + (defaultFullscreen ? 'custom-fullscreen-panel' : '') + '" style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:12px;width:min(1480px,calc(100% - 40px));height:min(900px,calc(100% - 40px));display:flex;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,0.35);overflow:hidden;" onclick="event.stopPropagation()">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid var(--border-color);">' +
            '<div style="display:flex;flex:1 1 auto;min-width:0;align-items:center;justify-content:flex-start;gap:14px;">' +
              '<div style="flex:0 0 auto;min-width:0;">' +
                '<div id="pdfWikiViewerTitle" style="font-size:18px;font-weight:700;color:var(--text-primary);">' + escapeHtml(initialTitle) + '</div>' +
                '<div id="pdfWikiViewerSubtitle" style="font-size:12px;color:var(--text-secondary);margin-top:4px;">' + escapeHtml(initialSubtitle) + '</div>' +
              '</div>' +
              '<div id="pdfWikiViewerContextActions" style="display:none;flex:1 1 auto;min-width:0;align-items:center;justify-content:flex-start;gap:6px;flex-wrap:wrap;"></div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;align-items:center;justify-content:flex-end;min-width:0;">' +
              '<button id="pdfWikiViewerFullscreenBtn" class="modal-icon-btn" type="button" onclick="toggleCustomModalFullscreen(\'pdfWikiViewerModal\',\'pdfWikiViewerPanel\',\'pdfWikiViewerFullscreenBtn\')" title="全屏" aria-label="全屏"><svg class="ui-icon sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5"></path><path d="M16 3h5v5"></path><path d="M21 16v5h-5"></path><path d="M3 16v5h5"></path></svg></button>' +
              '<button id="pdfWikiViewerRefreshBtn" class="lit-btn" style="width:auto;margin:0;padding:8px 12px;" onclick="refreshActivePdfWikiWorkspace()">刷新</button>' +
              '<button id="pdfWikiViewerCloseBtn" class="lit-btn" style="width:auto;margin:0;padding:8px 12px;" onclick="handlePdfWikiViewerClose()">关闭</button>' +
            '</div>' +
          '</div>' +
          '<div id="pdfWikiViewerContent" style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);">' + escapeHtml(initialLoadingText) + '</div>' +
        '</div>';
      document.body.appendChild(modal);
      syncPdfWikiReaderOverlayInset();
      observePdfWikiReaderSidebarClass();
      setFullscreenButtonState(document.getElementById('pdfWikiViewerFullscreenBtn'), defaultFullscreen);
      if (options.skipInitialLoad) return;

      try {
        var cacheScope = getPdfWikiMetaCacheScopeKey();
        if (pdfWikiViewerCacheScope && pdfWikiViewerCacheScope !== cacheScope) {
          pdfWikiViewerData = null;
          pdfWikiViewerCachedAt = 0;
          pdfWikiViewerFullRefreshPromise = null;
        }
        if (pdfWikiViewerData && pdfWikiViewerCacheScope === cacheScope) {
          renderPdfWikiViewer(pdfWikiViewerData, getPdfWikiViewerInitialSelection(pdfWikiViewerData));
          if (pdfWikiViewerData.partial || Date.now() - pdfWikiViewerCachedAt > 30000) {
            refreshPdfWikiViewerInBackground(pdfWikiActiveSentencePointId || pdfWikiActiveEntryId);
          }
          return;
        }
        var data = await fetchPdfWikiViewerEntries(true);
        rememberPdfWikiViewerData(data);
        renderPdfWikiViewer(data, getPdfWikiViewerInitialSelection(data));
        refreshPdfWikiViewerInBackground(pdfWikiActiveSentencePointId || pdfWikiActiveEntryId);
      } catch (e) {
        var content = document.getElementById('pdfWikiViewerContent');
        if (content) {
          content.innerHTML =
            '<div style="padding:24px;text-align:center;color:var(--danger-color);">' +
              '<div style="font-size:15px;font-weight:600;margin-bottom:8px;">读取失败</div>' +
              '<div style="font-size:13px;color:var(--text-secondary);">' + escapeHtml(e.message) + '</div>' +
            '</div>';
        }
      }
    };

    window.closePdfWikiViewer = function() {
      cleanupPdfWikiNetworkGraph();
      cleanupPdfWikiReaderRuntime();
      if (typeof clearRightSidebarPdfOverviewState === 'function') {
        clearRightSidebarPdfOverviewState(true);
      }
      var modal = document.getElementById('pdfWikiViewerModal');
      if (modal) modal.remove();
      pdfWikiViewerReturnTarget = '';
      pdfWikiViewerReturnState = null;
      document.body.classList.remove('pdf-wiki-overview-sidebar-open');
      if (typeof syncLeftSidebarLayoutState === 'function') syncLeftSidebarLayoutState();
      if (typeof resetMainWorkspaceHorizontalPosition === 'function') resetMainWorkspaceHorizontalPosition();
    };

    async function fetchPdfWikiViewerEntries(summaryOnly) {
      var url = '/api/pdf-wiki/entries?userId=' + encodeURIComponent(currentUserId);
      if (summaryOnly) url += '&summary=1&limit=240';
      var response = await fetch(url);
      var data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || '读取 Wiki论点库失败');
      }
      return data;
    }

    function rememberPdfWikiViewerData(data) {
      pdfWikiViewerData = data;
      pdfWikiViewerCacheScope = getPdfWikiMetaCacheScopeKey();
      pdfWikiViewerCachedAt = Date.now();
    }

    function getPdfWikiViewerInitialSelection(data) {
      var points = getPdfWikiPublishableSentencePoints(data && data.sentenceCloud ? data.sentenceCloud : {});
      if (points.length > 0) return points[0].id;
      return data && data.entries && data.entries[0] ? data.entries[0].id : null;
    }

    function refreshPdfWikiViewerInBackground(selectedEntryId) {
      if (pdfWikiViewerFullRefreshPromise) return pdfWikiViewerFullRefreshPromise;
      var requestScope = getPdfWikiMetaCacheScopeKey();
      var backgroundRequest = fetchPdfWikiViewerEntries(false)
        .then(function(data) {
          if (requestScope !== getPdfWikiMetaCacheScopeKey()) return data;
          rememberPdfWikiViewerData(data);
          if (pdfWikiWorkspaceMode === 'claims' && document.getElementById('pdfWikiViewerModal')) {
            applyPdfWikiViewerData(data, selectedEntryId, true);
          }
          return data;
        })
        .catch(function(error) {
          console.warn('[PdfWiki] Wiki论点库后台刷新失败:', error);
          return null;
        })
        .finally(function() {
          if (pdfWikiViewerFullRefreshPromise === backgroundRequest) {
            pdfWikiViewerFullRefreshPromise = null;
          }
        });
      pdfWikiViewerFullRefreshPromise = backgroundRequest;
      return backgroundRequest;
    }

    window.handlePdfWikiViewerClose = function() {
      if (typeof pdfWikiTopicDialogNavigation !== 'undefined' && pdfWikiTopicDialogNavigation && typeof window.finishPdfWikiTopicDialog === 'function') {
        window.finishPdfWikiTopicDialog();
        return;
      }
      if (
        (pdfWikiWorkspaceMode === 'pdf-reader' || pdfWikiViewerReturnTarget === 'pdf-manager')
        && typeof window.showPdfWikiPdfManager === 'function'
      ) {
        var returnState = pdfWikiViewerReturnState || {};
        pdfWikiViewerReturnTarget = '';
        pdfWikiViewerReturnState = null;
        window.showPdfWikiPdfManager({
          preserveOverviewReturn: true,
          scrollTop: Number.isFinite(Number(returnState.scrollTop)) ? Number(returnState.scrollTop) : 0,
          focusPdfId: returnState.focusPdfId || ''
        });
        return;
      }
      closePdfWikiViewer();
    };

    window.exportPdfWikiObsidian = async function() {
      var button = document.getElementById('pdfWikiObsidianExportBtn');
      var originalText = button ? button.textContent : '';
      if (button) {
        button.disabled = true;
        button.textContent = '导出中...';
      }
      try {
        var response = await fetch('/api/pdf-wiki/export-obsidian', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId })
        });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '导出 Obsidian Vault 失败');
        }
        var exportDir = result.exportDir || '';
        var html =
          '<div style="font-weight:700;color:var(--text-primary);margin-bottom:8px;">Obsidian 兼容 Vault 已导出</div>' +
          '<div style="font-size:13px;line-height:1.7;color:var(--text-secondary);">' +
            '可作论点句子 ' + escapeHtml(result.sentencePointCount || 0) +
            ' 条，主题 ' + escapeHtml(result.topicCount || 0) +
            ' 个，PDF ' + escapeHtml(result.pdfCount || 0) +
            ' 个，共 ' + escapeHtml(result.fileCount || 0) + ' 个 Markdown 文件。' +
          '</div>' +
          '<div style="margin-top:8px;font-size:12px;color:var(--text-secondary);word-break:break-all;">' + escapeHtml(exportDir) + '</div>' +
          '<div style="margin-top:10px;">' +
            '<button type="button" class="output-attachment-open" data-file-path="' + escapeHtml(exportDir) + '" onclick="openOutputAttachmentFolder(this)">打开文件夹</button>' +
          '</div>';
        appendMessage(html, 'bot', true, true);
      } catch (e) {
        alert('导出 Obsidian Vault 失败：' + (e.message || e));
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = originalText || '导出 Vault';
        }
      }
    };

    window.deployPdfWikiObsidian = async function() {
      var button = document.getElementById('pdfWikiObsidianDeployBtn');
      var originalText = button ? button.textContent : '';
      if (button) {
        button.disabled = true;
        button.textContent = '同步中...';
      }
      try {
        var response = await fetch('/api/pdf-wiki/obsidian/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId })
        });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '同步内置 Obsidian Vault 失败');
        }
        var vaultDir = result.vaultDir || result.exportDir || '';
        var html =
          '<div style="font-weight:700;color:var(--text-primary);margin-bottom:8px;">内置 Obsidian Vault 已同步</div>' +
          '<div style="font-size:13px;line-height:1.7;color:var(--text-secondary);">' +
            '软件现在可以直接检索这个 PDF Wiki vault。句子级论点 ' + escapeHtml(result.sentencePointCount || 0) +
            ' 条，主题 ' + escapeHtml(result.topicCount || 0) +
            ' 个，PDF ' + escapeHtml(result.pdfCount || 0) +
            ' 个，共 ' + escapeHtml(result.fileCount || 0) + ' 个 Markdown 文件。' +
          '</div>' +
          '<div style="margin-top:8px;font-size:12px;color:var(--text-secondary);word-break:break-all;">' + escapeHtml(vaultDir) + '</div>' +
          '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button type="button" class="output-attachment-open" data-file-path="' + escapeHtml(vaultDir) + '" onclick="openOutputAttachmentFolder(this)">打开知识库文件夹</button>' +
            '<button type="button" class="output-attachment-open" onclick="searchPdfWikiObsidianVault()">立即检索</button>' +
            '<button type="button" class="output-attachment-open" onclick="installAndOpenPdfWikiGalaxyView()">打开 3D 知识星系</button>' +
          '</div>';
        appendMessage(html, 'bot', true, true);
      } catch (e) {
        alert('同步内置 Obsidian Vault 失败：' + (e.message || e));
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = originalText || '同步 Vault';
        }
      }
    };

    window.installAndOpenPdfWikiGalaxyView = async function() {
      var button = document.getElementById('pdfWikiGalaxyViewBtn');
      var originalText = button ? button.textContent : '';
      if (button) {
        button.disabled = true;
        button.textContent = '安装中...';
      }
      try {
        var installResponse = await fetch('/api/pdf-wiki/obsidian/galaxy-view/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId })
        });
        var installResult = await installResponse.json();
        if (!installResponse.ok || !installResult.success) {
          throw new Error(installResult.error || '安装 Galaxy View 失败');
        }
        if (button) button.textContent = '正在打开...';
        var openResponse = await fetch('/api/pdf-wiki/obsidian/galaxy-view/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId })
        });
        var openResult = await openResponse.json();
        if (!openResponse.ok || !openResult.success) {
          throw new Error(openResult.error || '打开 Obsidian Vault 失败');
        }
        appendMessage(
          '<div style="font-weight:700;color:var(--text-primary);margin-bottom:7px;">3D 知识星系已就绪</div>' +
          '<div style="font-size:13px;line-height:1.7;color:var(--text-secondary);">Galaxy View ' + escapeHtml(installResult.version || '') +
          ' 已安装并启用。Obsidian 打开后，点击左侧轨道图标或运行“Open galaxy view”即可进入星系。</div>' +
          '<div style="margin-top:8px;font-size:12px;color:var(--text-secondary);word-break:break-all;">' + escapeHtml(installResult.vaultDir || '') + '</div>',
          'bot', true, true
        );
      } catch (e) {
        alert('3D 知识星系启动失败：' + (e.message || e));
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = originalText || '3D 知识星系';
        }
      }
    };

    window.searchPdfWikiObsidianVault = async function() {
      var keyword = prompt('输入要在内置 Obsidian 知识库中检索的关键词');
      keyword = (keyword || '').trim();
      if (!keyword) return;
      var button = document.getElementById('pdfWikiObsidianSearchBtn');
      var originalText = button ? button.textContent : '';
      if (button) {
        button.disabled = true;
        button.textContent = '检索中...';
      }
      try {
        var response = await fetch('/api/pdf-wiki/obsidian/search?userId=' + encodeURIComponent(currentUserId) + '&q=' + encodeURIComponent(keyword) + '&limit=30');
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '检索 Obsidian Vault 失败');
        }
        var rows = (result.results || []).map(function(item, index) {
          return '<div style="padding:9px 0;border-bottom:1px solid var(--border-color);">' +
            '<div style="display:flex;align-items:center;gap:8px;justify-content:space-between;">' +
              '<div style="font-weight:700;color:var(--text-primary);font-size:13px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (index + 1) + '. ' + escapeHtml(item.title || item.relativePath || '') + '</div>' +
              '<span style="font-size:11px;color:var(--text-secondary);white-space:nowrap;">' + escapeHtml(item.type || '') + '</span>' +
            '</div>' +
            '<div style="margin-top:4px;font-size:12px;color:var(--text-secondary);word-break:break-all;">' + escapeHtml(item.relativePath || '') + '</div>' +
            '<div style="margin-top:5px;font-size:12px;line-height:1.65;color:var(--text-secondary);">' + escapeHtml(item.snippet || '') + '</div>' +
          '</div>';
        }).join('');
        var html =
          '<div style="font-weight:700;color:var(--text-primary);margin-bottom:8px;">Obsidian Vault 检索：' + escapeHtml(keyword) + '</div>' +
          '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">' + escapeHtml((result.results || []).length) + ' 条结果 · ' + escapeHtml(result.vaultDir || '') + '</div>' +
          (rows || '<div style="font-size:13px;color:var(--text-secondary);line-height:1.7;">没有匹配结果。可以换一个关键词，或先点击“同步 Vault”同步最新 PDF Wiki。</div>');
        appendMessage(html, 'bot', true, true);
      } catch (e) {
        alert('检索 Obsidian Vault 失败：' + (e.message || e));
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = originalText || '检索 Vault';
        }
      }
    };

    function renderPdfWikiFavoriteButton(entryId, favorite, compact) {
      var title = favorite ? '取消收藏' : '收藏论点';
      return '<button type="button" title="' + title + '" aria-label="' + title + '" data-entry-id="' + escapeHtml(entryId || '') + '" onclick="togglePdfWikiEntryFavorite(this.dataset.entryId,event)" ' +
        'onkeydown="event.stopPropagation()" ' +
        'style="width:' + (compact ? '28px' : '34px') + ';height:' + (compact ? '28px' : '34px') + ';display:inline-flex;align-items:center;justify-content:center;border:1px solid ' + (favorite ? '#f59e0b' : 'var(--border-color)') + ';border-radius:6px;background:' + (favorite ? 'rgba(245,158,11,0.14)' : 'var(--bg-secondary)') + ';color:' + (favorite ? '#d97706' : 'var(--text-secondary)') + ';font-size:' + (compact ? '16px' : '18px') + ';line-height:1;cursor:pointer;">' + (favorite ? '★' : '☆') + '</button>';
    }

    function isPdfWikiPublishableSentencePoint(point) {
      if (!point || point.claimCandidate !== true) return false;
      var type = String(point.claimType || '').toLowerCase().replace(/[\s_-]+/g, '_');
      if (type === 'method' || type === 'non_claim') return false;
      return String(point.claimText || point.sentence || '').trim().length > 0;
    }

    function getPdfWikiPublishableSentencePoints(sentenceCloud) {
      return sentenceCloud && Array.isArray(sentenceCloud.points)
        ? sentenceCloud.points.filter(isPdfWikiPublishableSentencePoint)
        : [];
    }

    function renderPdfWikiViewer(data, selectedEntryId) {
      setPdfWikiWorkspaceMode('claims');
      var entries = Array.isArray(data.entries) ? data.entries : [];
      var sentenceCloud = data && data.sentenceCloud ? data.sentenceCloud : null;
      var sentencePoints = getPdfWikiPublishableSentencePoints(sentenceCloud);
      var title = document.getElementById('pdfWikiViewerTitle');
      if (title) title.textContent = 'Wiki论点库';
      var subtitle = document.getElementById('pdfWikiViewerSubtitle');
      if (subtitle) {
        var status = data.status || {};
        var totalSentencePointCount = Math.max(sentencePoints.length, Number(data.totalSentencePointCount || 0));
        subtitle.textContent = sentencePoints.length > 0
          ? (data.partial
            ? ('正在快速显示 ' + sentencePoints.length + '/' + totalSentencePointCount + ' 条可作论点句子；完整数据正在后台载入')
            : ('引言/讨论/结论 Wiki论点库：' + sentencePoints.length + ' 条可作论点句子，来自 ' + (data.pdfCount || 0) + ' 个 PDF'))
          : entries.length > 0
          ? ('共 ' + entries.length + ' 个论点组，来自 ' + (data.pdfCount || 0) + ' 个 PDF')
          : (status.message || '尚未生成 PDF Wiki');
      }

      var content = document.getElementById('pdfWikiViewerContent');
      if (!content) return;

      if (sentencePoints.length > 0) {
        if (pdfWikiSentenceViewMode === 'graph') {
          renderPdfWikiSentenceCloudViewer(data);
        } else {
          renderPdfWikiSentenceArgumentLibrary(data, selectedEntryId || pdfWikiActiveSentencePointId);
        }
        return;
      }
      pdfWikiActiveSentencePointId = null;

      var statusText = data.status && data.status.status === 'processing'
        ? 'PDF Wiki 正在生成中，请稍后刷新。'
        : (entries.length > 0
          ? '当前只展示 Wiki论点库；已检测到旧版兼容论点组，但这里不再展示。请重新上传或重建 PDF Wiki 生成句子级论点。'
          : '当前项目还没有可展示的 Wiki 论点。');
      content.innerHTML =
        '<div style="padding:30px;text-align:center;max-width:560px;">' +
          '<div style="font-size:16px;color:var(--text-primary);font-weight:600;margin-bottom:10px;">暂无句子级论点数据</div>' +
          '<div style="font-size:13px;color:var(--text-secondary);line-height:1.7;margin-bottom:18px;">' + escapeHtml(statusText) + '</div>' +
          '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">' +
            '<button class="lit-btn" style="width:auto;padding:8px 14px;margin:0;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-color);" onclick="showPdfWikiTopicCatalogDialog()">设置主题</button>' +
            '<button class="lit-btn" style="width:auto;padding:8px 14px;margin:0;" onclick="triggerPdfWikiUpload(true)">上传 PDF</button>' +
            '<button class="lit-btn" style="width:auto;padding:8px 14px;margin:0;" onclick="rebuildPdfWikiLibrary()">重建 PDF Wiki</button>' +
          '</div>' +
        '</div>';
      return;

      var selected = entries.find(function(entry) { return entry.id === selectedEntryId; }) || entries[0];
      pdfWikiActiveEntryId = selected ? selected.id : null;
      var selectedIds = getPdfWikiSelectedEntryIds();
      var selectedCount = selectedIds.length;
      var deleteDisabled = selectedCount > 0 ? '' : 'disabled';
      var mergeDisabled = selectedCount > 1 ? '' : 'disabled';
      var managementToolbar =
        '<div style="padding:10px 14px;border-bottom:1px solid var(--border-color);display:flex;flex-direction:column;gap:8px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--text-secondary);">' +
            '<span id="pdfWikiSelectedCount">已选择 ' + selectedCount + ' 个论点</span>' +
            '<button type="button" onclick="clearPdfWikiEntrySelection()" style="border:0;background:transparent;color:var(--accent-color);cursor:pointer;font-size:12px;padding:0;">清空</button>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">' +
            '<button type="button" onclick="selectAllVisiblePdfWikiEntries()" style="padding:7px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">全选当前</button>' +
            '<button id="pdfWikiMergeButton" type="button" ' + mergeDisabled + ' onclick="mergeSelectedPdfWikiEntries()" style="padding:7px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">合并</button>' +
            '<button id="pdfWikiDeleteButton" type="button" ' + deleteDisabled + ' onclick="deleteSelectedPdfWikiEntries()" style="padding:7px 8px;border:1px solid var(--danger-color);border-radius:6px;background:transparent;color:var(--danger-color);cursor:pointer;font-size:12px;">删除</button>' +
          '</div>' +
        '</div>';
      var listHtml = entries.map(function(entry, index) {
        var active = entry.id === selected.id;
        var claim = getPdfWikiDisplayClaim(entry);
        var supportDocCount = collectPdfWikiDocuments(getPdfWikiSupportViews(entry), entry).length;
        var opposeDocCount = collectPdfWikiDocuments(getPdfWikiOpposeViews(entry), entry).length;
        var sourceCount = Array.isArray(entry.sourcePdfNames) ? entry.sourcePdfNames.length : 0;
        var similarCount = Array.isArray(entry.similarClaims) ? entry.similarClaims.length : 0;
        var checked = pdfWikiSelectedEntryIds[entry.id] ? 'checked' : '';
        var favorite = Boolean(entry.favorite);
        return '<div style="display:grid;grid-template-columns:28px 30px 1fr;gap:8px;align-items:start;margin-bottom:8px;">' +
          '<label style="display:flex;align-items:center;justify-content:center;height:42px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);cursor:pointer;">' +
            '<input type="checkbox" data-entry-id="' + escapeHtml(entry.id) + '" ' + checked + ' onchange="togglePdfWikiEntrySelection(this.dataset.entryId,this.checked)" onclick="event.stopPropagation()" style="width:15px;height:15px;margin:0;cursor:pointer;">' +
          '</label>' +
          '<div style="padding-top:7px;">' + renderPdfWikiFavoriteButton(entry.id, favorite, true) + '</div>' +
          '<button type="button" data-entry-card="1" data-entry-id="' + escapeHtml(entry.id) + '" onclick="selectPdfWikiEntry(this.dataset.entryId)" ' +
            'style="width:100%;text-align:left;padding:12px;border:1px solid ' + (active ? 'var(--accent-color)' : 'var(--border-color)') + ';border-radius:8px;background:' + (active ? 'rgba(16,163,127,0.12)' : 'var(--bg-secondary)') + ';color:var(--text-primary);cursor:pointer;">' +
              '<div style="display:flex;gap:8px;align-items:flex-start;">' +
                '<span style="font-size:12px;color:var(--text-secondary);min-width:24px;">' + (index + 1) + '</span>' +
                '<div style="min-width:0;flex:1;">' +
                  '<div style="font-size:13px;font-weight:600;line-height:1.45;">' + escapeHtml(claim) + '</div>' +
                  '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;color:var(--text-secondary);font-size:11px;">' +
                    '<span>支持 ' + supportDocCount + '</span>' +
                    '<span>反对 ' + opposeDocCount + '</span>' +
                    '<span>PDF ' + sourceCount + '</span>' +
                    (similarCount > 0 ? '<span style="color:var(--accent-color);">相似 ' + similarCount + '</span>' : '') +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</button>' +
          '</div>';
      }).join('');

      content.innerHTML =
        '<div style="display:grid;grid-template-columns:360px 1fr;gap:0;width:100%;height:100%;min-height:0;">' +
          '<div style="border-right:1px solid var(--border-color);min-height:0;display:flex;flex-direction:column;">' +
            '<div style="padding:12px 14px;border-bottom:1px solid var(--border-color);">' +
              '<input id="pdfWikiSearchInput" type="text" placeholder="搜索论点、作者、DOI" oninput="filterPdfWikiEntries(this.value)" style="width:100%;margin:0;padding:9px 10px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);">' +
            '</div>' +
            managementToolbar +
            '<div id="pdfWikiEntryList" style="padding:12px;overflow:auto;min-height:0;flex:1;">' + listHtml + '</div>' +
          '</div>' +
          '<div id="pdfWikiEntryDetail" style="min-width:0;min-height:0;overflow:auto;">' + renderPdfWikiEntryDetail(selected) + '</div>' +
        '</div>';
    }

    function renderPdfWikiSentenceArgumentLibrary(data, selectedPointId) {
      pdfWikiSentenceViewMode = 'list';
      cleanupPdfWikiNetworkGraph();
      var content = document.getElementById('pdfWikiViewerContent');
      if (!content) return;
      var sentenceCloud = data && data.sentenceCloud ? data.sentenceCloud : {};
      var points = getPdfWikiPublishableSentencePoints(sentenceCloud);
      var sectionOrder = { Introduction: 1, Discussion: 2, Conclusion: 3 };
      points.sort(function(a, b) {
        return String(a.sourcePdfName || '').localeCompare(String(b.sourcePdfName || ''), 'zh-CN') ||
          (sectionOrder[a.section] || 9) - (sectionOrder[b.section] || 9) ||
          Number(a.sentenceIndex || 0) - Number(b.sentenceIndex || 0);
      });
      var selected = points.find(function(point) { return point.id === selectedPointId; }) ||
        points[0];
      pdfWikiActiveSentencePointId = selected ? selected.id : null;
      var pdfCount = Array.from(new Set(points.map(function(point) { return point.sourcePdfId || point.sourcePdfName || ''; }).filter(Boolean))).length;
      var citedCount = points.filter(function(point) { return Array.isArray(point.references) && point.references.length > 0; }).length;
      var topicCount = Array.from(new Set(points.map(function(point) { return point.topicKey || point.topicLabel || ''; }).filter(Boolean))).length;
      var selectedCount = getPdfWikiSelectedSentencePointIds().length;
      var deleteDisabled = selectedCount > 0 ? '' : ' disabled';
      var listHtml = points.map(function(point, index) {
        var active = selected && point.id === selected.id;
        var refs = Array.isArray(point.references) ? point.references : [];
        var claimLabel = getPdfWikiSentenceClaimLabel(point);
        var checked = pdfWikiSelectedSentencePointIds[point.id] ? ' checked' : '';
        var searchText = [
          point.sentence,
          point.claimText,
          point.topicLabel,
          point.aiTopicAnnotation && Array.isArray(point.aiTopicAnnotation.subjectTags) ? point.aiTopicAnnotation.subjectTags.join(' ') : '',
          point.aiTopicAnnotation ? point.aiTopicAnnotation.trendConclusionTopic : '',
          point.sourcePdfName,
          point.section,
          (point.citations || []).join(' '),
          refs.map(function(ref) { return [ref.title, ref.authors, ref.year, ref.doi, ref.raw].filter(Boolean).join(' '); }).join(' ')
        ].join(' ').toLowerCase();
        return '<div data-sentence-argument-row="1" data-point-id="' + escapeHtml(point.id || '') + '" data-search="' + escapeHtml(searchText) + '" style="display:grid;grid-template-columns:34px minmax(0,1fr);gap:8px;align-items:start;margin-bottom:8px;">' +
          '<label title="选择此句子级论点" style="height:42px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-secondary);cursor:pointer;">' +
            '<input type="checkbox" data-sentence-point-id="' + escapeHtml(point.id || '') + '"' + checked + ' onchange="togglePdfWikiSentencePointSelection(this.dataset.sentencePointId,this.checked)" style="width:16px;height:16px;margin:0;cursor:pointer;accent-color:var(--accent-color);">' +
          '</label>' +
          '<button type="button" data-sentence-argument-card="1" data-point-id="' + escapeHtml(point.id || '') + '" onclick="selectPdfWikiSentenceArgument(this.dataset.pointId)" ' +
            'style="width:100%;text-align:left;padding:11px 12px;border:1px solid ' + (active ? 'var(--accent-color)' : 'var(--border-color)') + ';border-radius:8px;background:' + (active ? 'rgba(16,163,127,0.12)' : 'var(--bg-secondary)') + ';color:var(--text-primary);cursor:pointer;">' +
              '<div style="display:flex;align-items:flex-start;gap:8px;">' +
                '<span style="font-size:11px;color:var(--text-secondary);min-width:28px;line-height:1.6;">' + (index + 1) + '</span>' +
                '<div style="min-width:0;flex:1;">' +
                  '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px;">' +
                    '<span style="font-size:11px;padding:2px 6px;border-radius:999px;background:rgba(16,163,127,0.14);color:var(--accent-color);">可作论点</span>' +
                    '<span style="font-size:11px;color:var(--text-secondary);">' + escapeHtml(point.section || '') + ' S' + escapeHtml(point.sentenceIndex || '') + '</span>' +
                    '<span style="font-size:11px;color:var(--text-secondary);">引用 ' + refs.length + '</span>' +
                  '</div>' +
                  '<div style="font-size:13px;font-weight:700;line-height:1.45;color:var(--text-primary);">' + escapeHtml(claimLabel) + '</div>' +
                  '<div style="margin-top:6px;font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(point.sourcePdfName || '') + '</div>' +
                '</div>' +
              '</div>' +
            '</button>' +
          '</div>';
      }).join('');
      content.innerHTML =
        '<div style="display:grid;grid-template-columns:420px 1fr;width:100%;height:100%;min-height:0;background:var(--bg-secondary);">' +
          '<div style="border-right:1px solid var(--border-color);min-height:0;display:flex;flex-direction:column;background:var(--bg-primary);">' +
            '<div style="padding:12px 14px;border-bottom:1px solid var(--border-color);">' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">' +
                renderPdfWikiSentenceArgumentStat('句子', points.length) +
                renderPdfWikiSentenceArgumentStat('有引用', citedCount) +
                renderPdfWikiSentenceArgumentStat('主题', topicCount) +
                renderPdfWikiSentenceArgumentStat('PDF', pdfCount) +
              '</div>' +
              '<input id="pdfWikiSentenceArgumentSearch" type="text" placeholder="搜索论点句、引用、PDF、主题" oninput="filterPdfWikiSentenceArguments(this.value)" style="width:100%;margin:0;padding:9px 10px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);">' +
              '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:9px;">' +
                '<label style="display:inline-flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:11px;cursor:pointer;">' +
                  '<input id="pdfWikiSentenceSelectAll" type="checkbox" onchange="toggleAllVisiblePdfWikiSentencePoints(this.checked)" style="width:14px;height:14px;margin:0;accent-color:var(--accent-color);">' +
                  '<span>全选当前</span>' +
                '</label>' +
                '<span id="pdfWikiSentenceSelectedCount" style="font-size:11px;color:var(--text-secondary);margin-right:auto;">已选择 ' + selectedCount + ' 条</span>' +
                '<button id="pdfWikiSentenceClearSelectionButton" type="button" onclick="clearPdfWikiSentencePointSelection()"' + deleteDisabled + ' style="padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:11px;cursor:pointer;">清空</button>' +
                '<button id="pdfWikiSentenceDeleteButton" type="button" onclick="deleteSelectedPdfWikiSentencePoints()"' + deleteDisabled + ' style="padding:6px 9px;border:1px solid var(--danger-color);border-radius:6px;background:transparent;color:var(--danger-color);font-size:11px;font-weight:700;cursor:pointer;">批量删除</button>' +
              '</div>' +
              '<div style="font-size:11px;color:var(--text-secondary);line-height:1.5;margin-top:8px;">来源章节：Introduction / Discussion / Conclusion；参考文献只来自句中或句末的显式引用匹配。</div>' +
            '</div>' +
            '<div id="pdfWikiSentenceArgumentList" style="padding:12px;overflow:auto;min-height:0;flex:1;">' + listHtml + '</div>' +
          '</div>' +
          '<div style="min-width:0;min-height:0;display:flex;flex-direction:column;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--border-color);background:var(--bg-primary);">' +
              '<div style="min-width:0;">' +
                '<div style="font-size:14px;font-weight:750;color:var(--text-primary);">句子级论点详情</div>' +
                '<div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">仅展示可直接作为论点的句子，以及句中或句末可以核验的参考文献。</div>' +
              '</div>' +
                '<div style="display:flex;gap:7px;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end;">' +
                  '<button id="pdfWikiNetworkGraphBtn" type="button" title="在软件内查看 PDF、主题、论点句与参考文献关系" onclick="showPdfWikiSentenceNetworkGraph()" style="padding:7px 10px;border:1px solid #0f766e;border-radius:6px;background:#0f766e;color:white;cursor:pointer;font-size:11px;font-weight:750;">网状图</button>' +
                '<button type="button" onclick="reloadPdfWikiViewer(pdfWikiActiveSentencePointId || pdfWikiActiveEntryId)" style="padding:7px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">刷新</button>' +
              '</div>' +
            '</div>' +
            '<div id="pdfWikiSentenceArgumentDetail" style="overflow:auto;min-height:0;flex:1;">' + renderPdfWikiSentenceArgumentDetail(selected) + '</div>' +
          '</div>' +
        '</div>';
      updatePdfWikiSentencePointSelectionControls();
    }

    function renderPdfWikiSentenceArgumentStat(label, value) {
      return '<div style="padding:8px 9px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);">' +
        '<div style="font-size:11px;color:var(--text-secondary);">' + escapeHtml(label) + '</div>' +
        '<div style="font-size:16px;font-weight:800;color:var(--text-primary);margin-top:2px;">' + escapeHtml(value) + '</div>' +
      '</div>';
    }

    function getPdfWikiSentenceClaimLabel(point) {
      return point && point.claimText ? point.claimText : (point && point.sentence ? point.sentence : '未命名句子');
    }

    function getPdfWikiSentenceClaimTypeLabel(type) {
      var labels = {
        argument: '论点',
        background: '背景/研究空白',
        mechanism: '机制解释',
        result: '结果/结论',
        limitation: '限制/反向条件',
        method: '方法描述',
        non_claim: '非论点'
      };
      return labels[type] || type || '未分类';
    }

    function renderPdfWikiSentenceAiTopicTags(point) {
      var annotation = point && point.aiTopicAnnotation;
      if (!annotation) return '';
      var subjectTags = Array.isArray(annotation.subjectTags) ? annotation.subjectTags.filter(Boolean).slice(0, 5) : [];
      var trendTopic = String(annotation.trendConclusionTopic || '').trim();
      if (!subjectTags.length && !trendTopic) return '';
      return '<div style="padding:11px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);margin-bottom:12px;">' +
        '<div style="font-size:11px;font-weight:800;color:var(--text-primary);margin-bottom:7px;">AI 主题标签</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
          subjectTags.map(function(tag) {
            return '<span style="padding:3px 7px;border-radius:999px;background:color-mix(in srgb,var(--accent-color) 12%,transparent);color:var(--accent-color);font-size:11px;">' + escapeHtml(tag) + '</span>';
          }).join('') +
          (trendTopic ? '<span title="趋势 / 结论型主题" style="padding:3px 7px;border-radius:999px;background:rgba(217,119,6,.13);color:#b45309;font-size:11px;">趋势/结论 · ' + escapeHtml(trendTopic) + '</span>' : '') +
        '</div>' +
      '</div>';
    }

    function renderPdfWikiSentenceArgumentDetail(point) {
      if (!point) {
        return '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);">暂无句子级论点。</div>';
      }
      var refs = Array.isArray(point.references) ? point.references : [];
      var citations = Array.isArray(point.citations) ? point.citations : [];
      var refHtml = refs.length
        ? '<ol style="margin:8px 0 0;padding-left:20px;line-height:1.65;color:var(--text-secondary);">' + refs.map(function(ref) {
            return '<li style="margin-bottom:10px;">' +
              '<div style="color:var(--text-primary);font-weight:700;">' + escapeHtml(ref.title || ref.raw || ref.id || '未解析参考文献') + '</div>' +
              '<div>' + escapeHtml([ref.authors, ref.year, ref.journal].filter(Boolean).join(' · ')) + '</div>' +
              (ref.doi ? '<div>DOI：' + escapeHtml(ref.doi) + '</div>' : '') +
              (ref.raw && ref.raw !== ref.title ? '<div style="margin-top:5px;padding:7px 8px;border-left:2px solid var(--border-color);background:var(--bg-secondary);color:var(--text-secondary);font-size:11px;line-height:1.55;">文末原始条目：' + escapeHtml(ref.raw) + '</div>' : '') +
              '<div>匹配方式：' + escapeHtml(ref.matchType || point.matchMethod || 'unknown') + (ref.matchScore ? ' · 分数 ' + escapeHtml(ref.matchScore) : '') + '</div>' +
            '</li>';
          }).join('') + '</ol>'
        : '<div style="padding:10px 12px;border:1px dashed var(--border-color);border-radius:8px;color:var(--text-secondary);background:var(--bg-secondary);">该句的句中或句末没有可匹配到 References 的显式引用。</div>';
      return '<div style="padding:18px 20px;max-width:980px;">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
          '<span style="font-size:12px;padding:3px 8px;border-radius:999px;background:rgba(16,163,127,0.14);color:var(--accent-color);">可作为论点</span>' +
          '<span style="font-size:12px;color:var(--text-secondary);">' + escapeHtml(getPdfWikiSentenceClaimTypeLabel(point.claimType)) + '</span>' +
          '<span style="font-size:12px;color:var(--text-secondary);">' + escapeHtml(point.section || '') + ' S' + escapeHtml(point.sentenceIndex || '') + '</span>' +
        '</div>' +
        '<div style="font-size:20px;font-weight:800;line-height:1.45;color:var(--text-primary);margin-bottom:10px;">' + escapeHtml(getPdfWikiSentenceClaimLabel(point)) + '</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:14px;">' + escapeHtml(point.sourcePdfName || '') + (point.topicLabel ? ' · ' + escapeHtml(point.topicLabel) : '') + '</div>' +
        renderPdfWikiSentenceAiTopicTags(point) +
        '<div style="display:grid;grid-template-columns:minmax(0,1fr);gap:12px;">' +
          '<div style="padding:13px 14px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);">' +
            '<div style="font-size:12px;font-weight:800;color:var(--text-primary);margin-bottom:7px;">原句</div>' +
            '<div style="font-size:14px;line-height:1.75;color:var(--text-primary);">' + escapeHtml(point.sentence || '') + '</div>' +
          '</div>' +
          '<div style="padding:13px 14px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);">' +
            '<div style="font-size:12px;font-weight:800;color:var(--text-primary);margin-bottom:7px;">论点判断</div>' +
            '<div style="font-size:13px;line-height:1.65;color:var(--text-secondary);">' + escapeHtml(point.claimReason || '系统根据句子表达、章节位置和引用关系判定为可作论点。') + '</div>' +
          '</div>' +
          '<div style="padding:13px 14px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;">' +
              '<div style="font-size:12px;font-weight:800;color:var(--text-primary);">句尾引用与参考文献</div>' +
              '<div style="font-size:12px;color:var(--text-secondary);">文中引用：' + escapeHtml(citations.join('; ') || '无') + '</div>' +
            '</div>' +
            refHtml +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:14px;">' +
          '<button type="button" data-point-id="' + escapeHtml(point.id || '') + '" onclick="openPdfWikiSentencePoint(this.dataset.pointId)" style="padding:8px 11px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">弹出详情</button>' +
        '</div>' +
      '</div>';
    }

    window.selectPdfWikiSentenceArgument = function(pointId) {
      var point = getPdfWikiSentencePoint(pointId);
      if (!point) return;
      pdfWikiActiveSentencePointId = pointId;
      var detail = document.getElementById('pdfWikiSentenceArgumentDetail');
      if (detail) detail.innerHTML = renderPdfWikiSentenceArgumentDetail(point);
      var cards = document.querySelectorAll('#pdfWikiSentenceArgumentList button[data-sentence-argument-card="1"]');
      cards.forEach(function(card) {
        var active = card.dataset.pointId === pointId;
        card.style.borderColor = active ? 'var(--accent-color)' : 'var(--border-color)';
        card.style.background = active ? 'rgba(16,163,127,0.12)' : 'var(--bg-secondary)';
      });
    };

    window.filterPdfWikiSentenceArguments = function(value) {
      var term = String(value || '').trim().toLowerCase();
      var rows = document.querySelectorAll('#pdfWikiSentenceArgumentList [data-sentence-argument-row="1"]');
      rows.forEach(function(row) {
        row.style.display = !term || String(row.dataset.search || '').indexOf(term) >= 0 ? 'grid' : 'none';
      });
      updatePdfWikiSentencePointSelectionControls();
    };

    function getPdfWikiSelectedSentencePointIds() {
      return Object.keys(pdfWikiSelectedSentencePointIds).filter(function(id) {
        return pdfWikiSelectedSentencePointIds[id];
      });
    }

    function updatePdfWikiSentencePointSelectionControls() {
      var selectedIds = getPdfWikiSelectedSentencePointIds();
      var selectedCount = selectedIds.length;
      var countEl = document.getElementById('pdfWikiSentenceSelectedCount');
      var deleteButton = document.getElementById('pdfWikiSentenceDeleteButton');
      var clearButton = document.getElementById('pdfWikiSentenceClearSelectionButton');
      var selectAll = document.getElementById('pdfWikiSentenceSelectAll');
      var rows = Array.prototype.slice.call(document.querySelectorAll('#pdfWikiSentenceArgumentList [data-sentence-argument-row="1"]'));
      var visibleRows = rows.filter(function(row) { return row.style.display !== 'none'; });
      var visibleSelectedCount = 0;

      rows.forEach(function(row) {
        var pointId = String(row.dataset.pointId || '');
        var checked = Boolean(pdfWikiSelectedSentencePointIds[pointId]);
        var checkbox = row.querySelector('input[type="checkbox"][data-sentence-point-id]');
        if (checkbox) checkbox.checked = checked;
        if (row.style.display !== 'none' && checked) visibleSelectedCount += 1;
      });

      if (countEl) countEl.textContent = '已选择 ' + selectedCount + ' 条';
      [deleteButton, clearButton].forEach(function(button) {
        if (!button) return;
        button.disabled = selectedCount === 0;
        button.style.opacity = selectedCount === 0 ? '0.48' : '1';
        button.style.cursor = selectedCount === 0 ? 'not-allowed' : 'pointer';
      });
      if (selectAll) {
        selectAll.disabled = visibleRows.length === 0;
        selectAll.checked = visibleRows.length > 0 && visibleSelectedCount === visibleRows.length;
        selectAll.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleRows.length;
      }
    }

    window.togglePdfWikiSentencePointSelection = function(pointId, selected) {
      if (!pointId) return;
      if (selected) {
        pdfWikiSelectedSentencePointIds[pointId] = true;
      } else {
        delete pdfWikiSelectedSentencePointIds[pointId];
      }
      updatePdfWikiSentencePointSelectionControls();
    };

    window.toggleAllVisiblePdfWikiSentencePoints = function(selected) {
      var rows = document.querySelectorAll('#pdfWikiSentenceArgumentList [data-sentence-argument-row="1"]');
      rows.forEach(function(row) {
        if (row.style.display === 'none') return;
        var pointId = String(row.dataset.pointId || '');
        if (!pointId) return;
        if (selected) {
          pdfWikiSelectedSentencePointIds[pointId] = true;
        } else {
          delete pdfWikiSelectedSentencePointIds[pointId];
        }
      });
      updatePdfWikiSentencePointSelectionControls();
    };

    window.clearPdfWikiSentencePointSelection = function() {
      pdfWikiSelectedSentencePointIds = {};
      updatePdfWikiSentencePointSelectionControls();
    };

    window.deleteSelectedPdfWikiSentencePoints = async function() {
      var pointIds = getPdfWikiSelectedSentencePointIds();
      if (pointIds.length === 0) return;
      if (!confirm(
        '确定永久删除选中的 ' + pointIds.length + ' 条句子级论点吗？\n\n' +
        '删除后会同步更新主题统计和检索索引，但不会删除原始 PDF。'
      )) return;

      var button = document.getElementById('pdfWikiSentenceDeleteButton');
      if (button) {
        button.disabled = true;
        button.textContent = '删除中...';
        button.style.opacity = '0.58';
        button.style.cursor = 'not-allowed';
      }

      try {
        var response = await fetch('/api/pdf-wiki/sentence-points/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, pointIds: pointIds })
        });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '删除句子级论点失败');
        }

        pdfWikiSelectedSentencePointIds = {};
        pdfWikiActiveSentencePointId = null;
        await reloadPdfWikiViewer(null);
        var subtitle = document.getElementById('pdfWikiViewerSubtitle');
        if (subtitle) {
          subtitle.textContent = '已删除 ' + (result.deletedCount || pointIds.length) + ' 条句子级论点；当前剩余 ' + (result.sentencePointCount || 0) + ' 条。';
        }
      } catch (e) {
        alert('删除句子级论点失败：' + e.message);
      } finally {
        var currentButton = document.getElementById('pdfWikiSentenceDeleteButton');
        if (currentButton) currentButton.textContent = '批量删除';
        updatePdfWikiSentencePointSelectionControls();
      }
    };

    function cleanupPdfWikiNetworkGraph() {
      var runtime = pdfWikiNetworkRuntime;
      if (runtime) {
        if (runtime.animationFrame) cancelAnimationFrame(runtime.animationFrame);
        if (runtime.visualAnimationFrame) cancelAnimationFrame(runtime.visualAnimationFrame);
        if (runtime.hoverHideTimer) clearTimeout(runtime.hoverHideTimer);
        if (runtime.resizeObserver) runtime.resizeObserver.disconnect();
        runtime.animationFrame = null;
        runtime.visualAnimationFrame = null;
      }
      pdfWikiNetworkRuntime = null;
    }

    window.showPdfWikiSentenceNetworkGraph = function() {
      if (!pdfWikiViewerData) return;
      pdfWikiSentenceViewMode = 'graph';
      renderPdfWikiSentenceCloudViewer(pdfWikiViewerData);
    };

    window.showPdfWikiSentenceList = function(pointId) {
      pdfWikiSentenceViewMode = 'list';
      if (pointId) pdfWikiActiveSentencePointId = pointId;
      renderPdfWikiViewer(pdfWikiViewerData || {}, pointId || pdfWikiActiveSentencePointId);
    };

    function renderPdfWikiSentenceCloudViewer(data) {
      var content = document.getElementById('pdfWikiViewerContent');
      if (!content) return;
      cleanupPdfWikiNetworkGraph();
      pdfWikiSentenceViewMode = 'graph';
      var graphData = buildPdfWikiNetworkGraphData(data || {});
      var counts = graphData.counts;
      var subtitle = document.getElementById('pdfWikiViewerSubtitle');
      if (subtitle) {
        subtitle.textContent = '内置网状图：PDF ' + counts.pdf + ' · 主题 ' + counts.topic + ' · 论点句 ' + counts.sentence + ' · 参考文献 ' + counts.reference;
      }
      var typeControl = function(type, label, checked, color) {
        return '<label style="display:inline-flex;align-items:center;gap:5px;padding:5px 7px;border:1px solid var(--border-color);border-radius:999px;background:var(--bg-secondary);font-size:11px;color:var(--text-primary);cursor:pointer;white-space:nowrap;">' +
          '<input type="checkbox" data-pdf-wiki-network-type="' + type + '"' + (checked ? ' checked' : '') + ' onchange="togglePdfWikiNetworkType(this.dataset.pdfWikiNetworkType,this.checked)" style="width:13px;height:13px;margin:0;accent-color:' + color + ';">' +
          '<span style="width:8px;height:8px;border-radius:999px;background:' + color + ';"></span>' + label +
          '</label>';
      };
      var topicFilterItems = graphData.nodes.filter(function(node) { return node.type === 'topic'; }).sort(function(a, b) {
        return String(a.label || '').localeCompare(String(b.label || ''), 'zh-CN');
      }).map(function(node) {
        return '<label style="display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border-radius:5px;cursor:pointer;font-size:11px;line-height:1.45;color:var(--text-primary);"><input type="checkbox" value="' + escapeHtml(node.id) + '" data-pdf-wiki-topic-choice onchange="togglePdfWikiNetworkTopic(this.value,this.checked)" style="width:14px;height:14px;margin:1px 0 0;accent-color:#d97706;flex:0 0 auto;"><span style="min-width:0;overflow-wrap:anywhere;">' + escapeHtml(truncatePdfWikiNetworkLabel(node.label, 42)) + ' <span style="color:var(--text-secondary);">（' + escapeHtml(node.sentenceIds && node.sentenceIds.length || 0) + '）</span></span></label>';
      }).join('');
      var omittedText = '完整展示 ' + counts.sentence + ' 条论点句及其主题、参考文献关系；兼容论点组不载入图谱。';
      content.innerHTML =
        '<style>' +
          '.pdf-wiki-network-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;min-height:0;flex:1;}' +
          '.pdf-wiki-network-detail{position:relative;border-left:1px solid var(--border-color);background:var(--bg-primary);overflow:auto;min-height:0;}' +
          '.pdf-wiki-network-settings{position:absolute;right:12px;top:12px;z-index:8;width:280px;max-height:calc(100% - 24px);overflow:auto;padding:14px;border:1px solid #3b3b3b;border-radius:8px;background:rgba(30,30,30,.96);box-shadow:0 16px 42px rgba(0,0,0,.45);backdrop-filter:blur(14px);color:#dcddde;}' +
          '.pdf-wiki-network-setting{display:grid;grid-template-columns:92px minmax(0,1fr) 34px;align-items:center;gap:8px;margin-top:11px;font:11px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
          '.pdf-wiki-network-setting input{width:100%;accent-color:#7f6df2;}' +
          '.pdf-wiki-network-detail[data-display-mode="hover"]{box-shadow:inset 3px 0 0 color-mix(in srgb,#0f766e 54%,transparent);}' +
          '.pdf-wiki-network-detail[data-display-mode="selected"]{box-shadow:inset 3px 0 0 #0f766e;}' +
          '.pdf-wiki-network-toolbar-button{padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:11px;transition:transform 160ms ease,border-color 160ms ease,background 160ms ease;}' +
          '.pdf-wiki-network-toolbar-button:hover{border-color:#0f766e;background:color-mix(in srgb,#0f766e 9%,var(--bg-secondary));}' +
          '.pdf-wiki-network-toolbar-button:active{transform:translateY(1px) scale(.98);}' +
          '.pdf-wiki-network-toolbar-button:focus-visible{outline:2px solid #0f766e;outline-offset:2px;}' +
          '.pdf-wiki-network-motion-dot{width:7px;height:7px;border-radius:999px;background:#0f766e;box-shadow:0 0 0 0 rgba(15,118,110,.36);}' +
          '.pdf-wiki-network-motion-dot[data-state="running"],.pdf-wiki-network-motion-dot[data-state="ambient"]{animation:pdfWikiNetworkPulse 1.45s ease-out infinite;}' +
          '@keyframes pdfWikiNetworkPulse{0%{box-shadow:0 0 0 0 rgba(15,118,110,.38)}70%{box-shadow:0 0 0 7px rgba(15,118,110,0)}100%{box-shadow:0 0 0 0 rgba(15,118,110,0)}}' +
          '@media(prefers-reduced-motion:reduce){.pdf-wiki-network-motion-dot[data-state="running"],.pdf-wiki-network-motion-dot[data-state="ambient"]{animation:none}.pdf-wiki-network-toolbar-button{transition:none}}' +
          '@media(max-width:980px){.pdf-wiki-network-layout{grid-template-columns:1fr;grid-template-rows:minmax(420px,1fr) minmax(180px,34%)}.pdf-wiki-network-detail{border-left:0;border-top:1px solid var(--border-color)}}' +
        '</style>' +
        '<div style="--bg-primary:#1e1e1e;--bg-secondary:#242424;--bg-input:#202020;--text-primary:#dcddde;--text-secondary:#9b9b9b;--border-color:#363636;--modal-bg:#202020;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--bg-secondary);font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:11px 14px;border-bottom:1px solid var(--border-color);background:var(--bg-primary);">' +
            '<div style="min-width:220px;flex:1;">' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px;font-weight:800;color:var(--text-primary);letter-spacing:-.01em;">PDF Wiki 灵动网状图<span id="pdfWikiNetworkRendererBadge" style="padding:2px 6px;border:1px solid rgba(15,118,110,.35);border-radius:4px;background:rgba(15,118,110,.08);color:#0f766e;font-size:9px;font-weight:750;letter-spacing:.02em;">Canvas 稳定动效</span></div>' +
              '<div style="font-size:11px;line-height:1.55;color:var(--text-secondary);margin-top:3px;">' + escapeHtml(omittedText) + '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end;">' +
              '<span id="pdfWikiNetworkMotionStatus" style="display:inline-flex;align-items:center;gap:6px;padding:5px 7px;font-size:10px;color:var(--text-secondary);font-variant-numeric:tabular-nums;"><span id="pdfWikiNetworkMotionDot" class="pdf-wiki-network-motion-dot" data-state="running"></span><span id="pdfWikiNetworkMotionText">布局中</span></span>' +
              '<span id="pdfWikiNetworkVisibleCount" style="font-size:11px;color:var(--text-secondary);">节点 ' + graphData.nodes.length + ' · 连线 ' + graphData.edges.length + '</span>' +
              '<button id="pdfWikiNetworkMotionButton" type="button" class="pdf-wiki-network-toolbar-button" onclick="togglePdfWikiNetworkMotion()">暂停布局</button>' +
              '<button type="button" class="pdf-wiki-network-toolbar-button" onclick="togglePdfWikiNetworkSettings()" aria-label="图谱设置">⚙ 图谱设置</button>' +
               '<button type="button" class="pdf-wiki-network-toolbar-button" onclick="restartPdfWikiNetworkLayout()">重新布局</button>' +
               '<button type="button" class="pdf-wiki-network-toolbar-button" onclick="fitPdfWikiNetworkGraph()">适应画布</button>' +
               '<button type="button" class="pdf-wiki-network-toolbar-button" onclick="reloadPdfWikiViewer(pdfWikiActiveSentencePointId || pdfWikiActiveEntryId)">刷新</button>' +
               '<button type="button" class="pdf-wiki-network-toolbar-button" onclick="showPdfWikiTopicCatalogDialog()">主题管理</button>' +
               '<button type="button" onclick="showPdfWikiSentenceList(pdfWikiActiveSentencePointId)" style="padding:6px 9px;border:1px solid #0f766e;border-radius:6px;background:#0f766e;color:white;cursor:pointer;font-size:11px;font-weight:750;">返回论点列表</button>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid var(--border-color);background:var(--bg-primary);">' +
            '<input id="pdfWikiNetworkSearch" type="search" placeholder="搜索 PDF、主题、论点句、作者、DOI" oninput="filterPdfWikiNetworkGraph(this.value)" style="min-width:210px;flex:1;padding:7px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:11px;">' +
            '<details id="pdfWikiNetworkTopicFilter" style="position:relative;min-width:190px;max-width:310px;z-index:12;"><summary id="pdfWikiNetworkTopicFilterSummary" style="list-style:none;padding:7px 28px 7px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:11px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">全部已分类主题</summary><div style="position:absolute;top:calc(100% + 5px);left:0;width:min(330px,80vw);max-height:320px;overflow:auto;padding:7px;border:1px solid var(--border-color);border-radius:7px;background:var(--modal-bg);box-shadow:0 14px 34px rgba(0,0,0,.38);"><button type="button" onclick="filterPdfWikiNetworkTopic(\'\')" style="width:100%;padding:7px 8px;margin-bottom:5px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;text-align:left;font-size:11px;font-weight:750;">显示全部已分类主题</button>' + topicFilterItems + '</div></details>' +
            typeControl('pdf', 'PDF', false, getPdfWikiNetworkTypeColor('pdf')) +
            typeControl('topic', '主题', true, getPdfWikiNetworkTypeColor('topic')) +
            typeControl('sentence', '论点句', true, getPdfWikiNetworkTypeColor('sentence')) +
            typeControl('reference', '参考文献', true, getPdfWikiNetworkTypeColor('reference')) +
          '</div>' +
          '<div class="pdf-wiki-network-layout">' +
            '<div id="pdfWikiNetworkStage" style="position:relative;min-width:0;min-height:520px;overflow:hidden;background:radial-gradient(circle at 50% 42%,rgba(127,109,242,.10),transparent 48%),#1e1e1e;">' +
              '<canvas id="pdfWikiNetworkCanvas" role="img" aria-label="PDF Wiki 关系网状图" tabindex="0" style="position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;cursor:grab;"></canvas>' +
              '<svg id="pdfWikiNetworkSvg" aria-hidden="true" tabindex="-1" style="position:absolute;inset:0;width:100%;height:100%;visibility:hidden;pointer-events:none;"></svg>' +
              '<section id="pdfWikiNetworkSettings" class="pdf-wiki-network-settings" hidden>' +
                '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;"><strong style="font-size:13px;">图谱设置</strong><button type="button" onclick="resetPdfWikiNetworkSettings()" style="border:0;background:transparent;color:#a89cf5;cursor:pointer;font-size:10px;">恢复默认</button></div>' +
                '<div style="margin-top:14px;color:#b8b8b8;font-size:10px;font-weight:700;">显示</div>' +
                '<label class="pdf-wiki-network-setting"><span>节点大小</span><input type="range" min="0.55" max="1.8" step="0.05" value="1" data-network-setting="nodeSize" oninput="updatePdfWikiNetworkSetting(this)"><output>1.00</output></label>' +
                '<label class="pdf-wiki-network-setting"><span>连线粗细</span><input type="range" min="0.45" max="2.2" step="0.05" value="1" data-network-setting="linkThickness" oninput="updatePdfWikiNetworkSetting(this)"><output>1.00</output></label>' +
                '<label class="pdf-wiki-network-setting"><span>文字淡出</span><input type="range" min="0" max="1" step="0.05" value="0.35" data-network-setting="textFade" oninput="updatePdfWikiNetworkSetting(this)"><output>0.35</output></label>' +
                '<div style="margin-top:16px;color:#b8b8b8;font-size:10px;font-weight:700;">作用力</div>' +
                '<label class="pdf-wiki-network-setting"><span>中心力</span><input type="range" min="0" max="1" step="0.05" value="0.45" data-network-setting="centerForce" oninput="updatePdfWikiNetworkSetting(this)"><output>0.45</output></label>' +
                '<label class="pdf-wiki-network-setting"><span>排斥力</span><input type="range" min="0" max="1" step="0.05" value="0.65" data-network-setting="repelForce" oninput="updatePdfWikiNetworkSetting(this)"><output>0.65</output></label>' +
                '<label class="pdf-wiki-network-setting"><span>连接力</span><input type="range" min="0" max="1" step="0.05" value="0.55" data-network-setting="linkForce" oninput="updatePdfWikiNetworkSetting(this)"><output>0.55</output></label>' +
                '<label class="pdf-wiki-network-setting"><span>连接距离</span><input type="range" min="45" max="180" step="5" value="90" data-network-setting="linkDistance" oninput="updatePdfWikiNetworkSetting(this)"><output>90</output></label>' +
              '</section>' +
              '<div style="position:absolute;left:12px;bottom:12px;z-index:4;display:flex;gap:5px;padding:5px;border:1px solid var(--border-color);border-radius:7px;background:var(--modal-bg);box-shadow:0 8px 24px rgba(0,0,0,0.16);">' +
                '<button type="button" aria-label="缩小" onclick="zoomPdfWikiNetworkGraph(-1)" style="width:28px;height:28px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:16px;">−</button>' +
                '<button type="button" aria-label="放大" onclick="zoomPdfWikiNetworkGraph(1)" style="width:28px;height:28px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:16px;">+</button>' +
              '</div>' +
              '<div style="position:absolute;right:12px;bottom:12px;z-index:4;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-bg);color:var(--text-secondary);font-size:10px;line-height:1.5;pointer-events:none;backdrop-filter:blur(10px);">悬停连接 · 单击查看 · 拖动节点 · 右键固定</div>' +
            '</div>' +
            '<aside id="pdfWikiNetworkDetail" class="pdf-wiki-network-detail" data-display-mode="empty" aria-live="polite" aria-label="网状图节点信息">' + renderPdfWikiNetworkEmptyDetail(graphData) + '</aside>' +
          '</div>' +
        '</div>';

      var runtime = {
        graphData: graphData,
        scale: 1,
        translateX: 0,
        translateY: 0,
        searchTerm: '',
        selectedNodeId: '',
        lockedNodeId: '',
        hoveredNodeId: '',
        pointer: null,
        animationFrame: null,
        visualAnimationFrame: null,
        hoverVisualNodeId: '',
        hoverVisualProgress: 0,
        hoverVisualTarget: 0,
        hoverVisualLastFrameAt: 0,
        alpha: 1,
        tickCount: 0,
        motionPaused: false,
        hideUnclassified: true,
        topicFilterIds: new Set(),
        reducedMotion: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
        typeVisibility: { pdf: false, topic: true, sentence: true, reference: true, entry: false },
        settings: {
          nodeSize: 1,
          linkThickness: 1,
          textFade: 0.35,
          centerForce: 0.45,
          repelForce: 0.65,
          linkForce: 0.55,
          linkDistance: 90,
        },
        nodeElements: {},
        edgeElements: [],
        neighborIds: {},
        canvasOnly: graphData.nodes.length > 360 || graphData.edges.length > 720,
        largeGraph: graphData.nodes.length > 520 || graphData.edges.length > 1100,
        ultraLargeGraph: graphData.nodes.length > 2400 || graphData.edges.length > 5200,
      };
      pdfWikiNetworkRuntime = runtime;
      setTimeout(function() {
        if (pdfWikiNetworkRuntime === runtime) initializePdfWikiNetworkGraph(runtime);
      }, 0);
    }

    function buildPdfWikiNetworkGraphData(data) {
      var allPoints = getPdfWikiPublishableSentencePoints(data.sentenceCloud || {});
      var allEntries = Array.isArray(data.entries) ? data.entries : [];
      // 论点句是 PDF Wiki 的核心数据，图谱必须完整载入，不能用节点上限截断。
      // 兼容论点组属于旧版聚合结果，不参与当前句子级图谱，以节省计算预算。
      var points = allPoints.slice();
      var entries = [];
      var clouds = data.sentenceCloud && Array.isArray(data.sentenceCloud.clouds) ? data.sentenceCloud.clouds : [];
      var cloudByKey = {};
      clouds.forEach(function(cloud) { cloudByKey[cloud.topicKey || cloud.id] = cloud; });
      var nodes = [];
      var edges = [];
      var nodeById = {};
      var edgeKeys = {};
      var counts = { pdf: 0, topic: 0, sentence: 0, reference: 0, entry: 0 };

      function addNode(node) {
        if (nodeById[node.id]) return nodeById[node.id];
        node.searchText = String([node.label, node.subtitle, node.meta].filter(Boolean).join(' ')).toLowerCase();
        node.degree = 0;
        nodeById[node.id] = node;
        nodes.push(node);
        counts[node.type] = (counts[node.type] || 0) + 1;
        return node;
      }

      function addEdge(source, target, type) {
        if (!source || !target || source === target || !nodeById[source] || !nodeById[target]) return;
        var key = source < target ? source + '::' + target + '::' + type : target + '::' + source + '::' + type;
        if (edgeKeys[key]) return;
        edgeKeys[key] = true;
        edges.push({ id: 'edge-' + pdfWikiNetworkHash(key), source: source, target: target, type: type });
        nodeById[source].degree += 1;
        nodeById[target].degree += 1;
      }

      points.forEach(function(point) {
        var sourceKey = point.sourcePdfId || point.sourcePdfName || 'unknown-pdf';
        var pdfNodeId = 'pdf:' + sourceKey;
        var pdfNode = addNode({
          id: pdfNodeId,
          type: 'pdf',
          label: point.sourcePdfTitle || point.sourcePdfName || '未命名 PDF',
          subtitle: point.sourcePdfName || '',
          sentenceIds: [],
          sourcePdfId: point.sourcePdfId || '',
        });
        appendPdfWikiNetworkUnique(pdfNode.sentenceIds, point.id);

        var topicKey = point.topicKey || 'background';
        var cloud = cloudByKey[topicKey] || {};
        var topicNodeId = 'topic:' + topicKey;
        var topicNode = addNode({
          id: topicNodeId,
          type: 'topic',
          label: point.topicLabel || cloud.label || topicKey,
          subtitle: Array.isArray(point.keywords) ? point.keywords.join(' · ') : '',
          sentenceIds: [],
          topicKey: topicKey,
          clusterTopicId: topicNodeId,
        });
        appendPdfWikiNetworkUnique(topicNode.sentenceIds, point.id);

        var sentenceNodeId = 'sentence:' + point.id;
        addNode({
          id: sentenceNodeId,
          type: 'sentence',
          label: point.claimText || point.sentence || '未命名论点句',
          subtitle: [point.section, point.sourcePdfName, point.topicLabel].filter(Boolean).join(' · '),
          meta: Array.isArray(point.citations) ? point.citations.join(' ') : '',
          point: point,
          topicNodeId: topicNodeId,
          clusterTopicId: topicNodeId,
          pdfNodeId: pdfNodeId,
        });
        addEdge(pdfNodeId, sentenceNodeId, 'pdf-sentence');
        addEdge(topicNodeId, sentenceNodeId, 'topic-sentence');

        (Array.isArray(point.references) ? point.references : []).forEach(function(ref, refIndex) {
          var refIdentity = String(ref.doi || ref.id || [ref.authors, ref.year, ref.title || ref.raw, ref.index || refIndex].filter(Boolean).join('|')).trim().toLowerCase();
          if (!refIdentity) return;
          // 同一篇参考文献在不同主题中使用独立的可视节点，避免跨主题连线
          // 把两个主题簇拉到一起；文献元数据本身仍保持相同。
          var referenceNodeId = 'reference:' + pdfWikiNetworkHash(topicKey + '|' + refIdentity);
          var referenceNode = addNode({
            id: referenceNodeId,
            type: 'reference',
            label: ref.title || ref.raw || ref.doi || '未解析参考文献',
            subtitle: [ref.authors, ref.year, ref.journal].filter(Boolean).join(' · '),
            meta: ref.doi || '',
            reference: ref,
            sentenceIds: [],
            topicNodeId: topicNodeId,
            clusterTopicId: topicNodeId,
          });
          appendPdfWikiNetworkUnique(referenceNode.sentenceIds, point.id);
          addEdge(sentenceNodeId, referenceNodeId, 'sentence-reference');
        });
      });

      entries.forEach(function(entry) {
        var entryNodeId = 'entry:' + entry.id;
        var entryNode = addNode({
          id: entryNodeId,
          type: 'entry',
          label: entry.displayClaimZh || entry.normalizedClaim || entry.claim || '兼容论点组',
          subtitle: '来源 PDF ' + (Array.isArray(entry.sourcePdfIds) ? entry.sourcePdfIds.length : 0) + ' 个',
          entry: entry,
        });
        var sourceIds = Array.isArray(entry.sourcePdfIds) ? entry.sourcePdfIds : [];
        var sourceNames = Array.isArray(entry.sourcePdfNames) ? entry.sourcePdfNames : [];
        sourceIds.forEach(function(sourcePdfId, index) {
          var pdfNodeId = 'pdf:' + (sourcePdfId || sourceNames[index] || ('entry-source-' + index));
          addNode({
            id: pdfNodeId,
            type: 'pdf',
            label: sourceNames[index] || sourcePdfId || '未命名 PDF',
            subtitle: sourceNames[index] || '',
            sentenceIds: [],
            sourcePdfId: sourcePdfId || '',
          });
          addEdge(entryNode.id, pdfNodeId, 'entry-pdf');
        });
      });

      return {
        nodes: nodes,
        edges: edges,
        nodeById: nodeById,
        counts: counts,
        omittedSentenceCount: 0,
        omittedReferenceCount: 0,
        excludedEntryCount: allEntries.length,
      };
    }

    function appendPdfWikiNetworkUnique(values, value) {
      if (value && values.indexOf(value) < 0) values.push(value);
    }

    function pdfWikiNetworkHash(value) {
      var text = String(value || '');
      var hash = 2166136261;
      for (var i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(36);
    }

    function getPdfWikiNetworkTypeLabel(type) {
      return { pdf: 'PDF 来源', topic: '主题', sentence: '句子级论点', reference: '参考文献', entry: '兼容论点组' }[type] || type;
    }

    function getPdfWikiNetworkTypeColor(type) {
      return {
        pdf: '#0f766e',
        topic: '#d97706',
        sentence: '#16a34a',
        reference: '#2563eb',
        entry: '#475569',
      }[type] || '#64748b';
    }

    function getPdfWikiNetworkNodeColor(node) {
      return getPdfWikiNetworkTypeColor(node && node.type);
    }

    function getPdfWikiNetworkNodeRadius(node) {
      var degreeBoost = Math.min(4.8, Math.sqrt(Math.max(0, Number(node.degree || 0))) * 0.62);
      var sizeScale = pdfWikiNetworkRuntime && pdfWikiNetworkRuntime.settings ? Number(pdfWikiNetworkRuntime.settings.nodeSize || 1) : 1;
      var baseRadius = node.type === 'pdf' ? 12.5 + degreeBoost
        : (node.type === 'topic' ? 12.5 + degreeBoost
          : (node.type === 'entry' ? 8.5 + degreeBoost
            : (node.type === 'reference' ? 5.8 + degreeBoost * 0.62
              : Math.max(4.2, Math.min(9.2, 4.2 + Number(node.point && node.point.referenceCount || 0) * 0.72 + degreeBoost * 0.42)))));
      return baseRadius * sizeScale;
    }

    function createPdfWikiNetworkVirtualElement() {
      return {
        style: { display: '', opacity: '1', cursor: '' },
        setAttribute: function() {},
      };
    }

    function initializePdfWikiNetworkGraph(runtime) {
      var svg = document.getElementById('pdfWikiNetworkSvg');
      var canvas = document.getElementById('pdfWikiNetworkCanvas');
      if (!svg || !canvas || pdfWikiNetworkRuntime !== runtime) return;
      var rect = canvas.getBoundingClientRect();
      var width = Math.max(760, Math.round(rect.width || 1000));
      var height = Math.max(520, Math.round(rect.height || 640));
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      runtime.svg = canvas;
      runtime.canvas = canvas;
      runtime.accessibilitySvg = svg;
      runtime.width = width;
      runtime.height = height;
      var topicCount = runtime.graphData.nodes.filter(function(node) { return node.type === 'topic'; }).length;
      runtime.clusterLayoutScale = topicCount > 1 ? Math.min(1.8, 1 + Math.sqrt(topicCount) * 0.16) : 1;
      runtime.simulationWidth = width * runtime.clusterLayoutScale;
      runtime.simulationHeight = height * runtime.clusterLayoutScale;
      layoutPdfWikiNetworkGraph(runtime.graphData, runtime.simulationWidth, runtime.simulationHeight);

      var ns = 'http://www.w3.org/2000/svg';
      var defs = document.createElementNS(ns, 'defs');
      var pattern = document.createElementNS(ns, 'pattern');
      pattern.setAttribute('id', 'pdfWikiNetworkGrid');
      pattern.setAttribute('width', '28');
      pattern.setAttribute('height', '28');
      pattern.setAttribute('patternUnits', 'userSpaceOnUse');
      var gridPath = document.createElementNS(ns, 'path');
      gridPath.setAttribute('d', 'M 28 0 L 0 0 0 28');
      gridPath.setAttribute('fill', 'none');
      gridPath.setAttribute('stroke', 'currentColor');
      gridPath.setAttribute('stroke-opacity', '0.055');
      gridPath.setAttribute('stroke-width', '1');
      pattern.appendChild(gridPath);
      defs.appendChild(pattern);
      svg.appendChild(defs);

      var background = document.createElementNS(ns, 'rect');
      background.setAttribute('width', String(width));
      background.setAttribute('height', String(height));
      background.setAttribute('fill', 'url(#pdfWikiNetworkGrid)');
      background.setAttribute('data-pdf-wiki-network-background', '1');
      svg.appendChild(background);
      runtime.background = background;

      var viewport = document.createElementNS(ns, 'g');
      viewport.setAttribute('id', 'pdfWikiNetworkViewport');
      svg.appendChild(viewport);
      runtime.viewport = viewport;

      var edgeLayer = document.createElementNS(ns, 'g');
      edgeLayer.setAttribute('aria-hidden', 'true');
      viewport.appendChild(edgeLayer);
      runtime.graphData.edges.forEach(function(edge) {
        if (!runtime.neighborIds[edge.source]) runtime.neighborIds[edge.source] = {};
        if (!runtime.neighborIds[edge.target]) runtime.neighborIds[edge.target] = {};
        runtime.neighborIds[edge.source][edge.target] = true;
        runtime.neighborIds[edge.target][edge.source] = true;
        var baseOpacity = edge.type === 'sentence-reference' ? 0.28 : 0.23;
        if (runtime.canvasOnly) {
          runtime.edgeElements.push({ edge: edge, element: createPdfWikiNetworkVirtualElement(), baseOpacity: baseOpacity });
          return;
        }
        var line = document.createElementNS(ns, 'line');
        line.setAttribute('stroke', edge.type === 'sentence-reference'
          ? getPdfWikiNetworkTypeColor('reference')
          : (edge.type === 'topic-sentence'
            ? getPdfWikiNetworkTypeColor('topic')
            : (edge.type === 'entry-pdf' ? getPdfWikiNetworkTypeColor('entry') : getPdfWikiNetworkTypeColor('pdf'))));
        line.setAttribute('stroke-width', edge.type === 'topic-sentence' ? '1.15' : '0.85');
        line.setAttribute('stroke-opacity', String(baseOpacity));
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        edgeLayer.appendChild(line);
        runtime.edgeElements.push({ edge: edge, element: line, baseOpacity: baseOpacity });
      });

      var nodeLayer = document.createElementNS(ns, 'g');
      viewport.appendChild(nodeLayer);
      var labeledNodeIds = {};
      runtime.graphData.nodes.filter(function(node) { return node.type === 'pdf'; }).forEach(function(node) { labeledNodeIds[node.id] = true; });
      runtime.graphData.nodes.filter(function(node) { return node.type === 'topic'; }).sort(function(a, b) { return b.degree - a.degree; }).slice(0, 24).forEach(function(node) { labeledNodeIds[node.id] = true; });
      runtime.graphData.nodes.filter(function(node) { return node.type === 'entry'; }).sort(function(a, b) { return b.degree - a.degree; }).slice(0, 16).forEach(function(node) { labeledNodeIds[node.id] = true; });
      runtime.graphData.nodes.slice().sort(function(a, b) {
        return getPdfWikiNetworkNodeRadius(a) - getPdfWikiNetworkNodeRadius(b);
      }).forEach(function(node) {
        var radius = getPdfWikiNetworkNodeRadius(node);
        if (runtime.canvasOnly) {
          runtime.nodeElements[node.id] = {
            node: node,
            element: createPdfWikiNetworkVirtualElement(),
            circle: null,
            halo: createPdfWikiNetworkVirtualElement(),
            label: labeledNodeIds[node.id] ? createPdfWikiNetworkVirtualElement() : null,
            radius: radius,
          };
          return;
        }
        var group = document.createElementNS(ns, 'g');
        group.setAttribute('data-pdf-wiki-network-node', node.id);
        group.setAttribute('data-pdf-wiki-network-type', node.type);
        group.setAttribute('role', 'button');
        group.setAttribute('tabindex', '0');
        group.setAttribute('aria-label', getPdfWikiNetworkTypeLabel(node.type) + '：' + truncatePdfWikiNetworkLabel(node.label, 80));
        group.style.cursor = 'grab';
        var hitArea = document.createElementNS(ns, 'circle');
        hitArea.setAttribute('r', String(radius + 8));
        hitArea.setAttribute('fill', 'transparent');
        hitArea.setAttribute('stroke', 'none');
        hitArea.setAttribute('pointer-events', 'all');
        group.appendChild(hitArea);
        var halo = document.createElementNS(ns, 'circle');
        halo.setAttribute('r', String(radius + 5));
        halo.setAttribute('fill', 'none');
        halo.setAttribute('stroke', getPdfWikiNetworkNodeColor(node));
        halo.setAttribute('stroke-opacity', '0.9');
        halo.setAttribute('stroke-width', '2.4');
        halo.setAttribute('vector-effect', 'non-scaling-stroke');
        halo.style.pointerEvents = 'none';
        halo.style.display = 'none';
        group.appendChild(halo);
        var circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('r', String(radius));
        circle.setAttribute('fill', getPdfWikiNetworkNodeColor(node));
        circle.setAttribute('stroke', 'rgba(255,255,255,0.92)');
        circle.setAttribute('stroke-width', node.type === 'sentence' ? '1.4' : '2');
        circle.setAttribute('vector-effect', 'non-scaling-stroke');
        circle.style.pointerEvents = 'none';
        group.appendChild(circle);
        var label = null;
        if (labeledNodeIds[node.id]) {
          label = document.createElementNS(ns, 'text');
          label.setAttribute('x', String(radius + 5));
          label.setAttribute('y', '4');
          label.setAttribute('fill', 'currentColor');
          label.setAttribute('font-size', node.type === 'entry' ? '10' : '11');
          label.setAttribute('font-weight', node.type === 'topic' ? '750' : '650');
          label.setAttribute('paint-order', 'stroke');
          label.setAttribute('stroke', 'var(--bg-secondary)');
          label.setAttribute('stroke-width', '3');
          label.style.pointerEvents = 'none';
          label.textContent = truncatePdfWikiNetworkLabel(node.label, node.type === 'entry' ? 20 : 24);
          group.appendChild(label);
        }
        group.addEventListener('pointerdown', function(event) {
          startPdfWikiNetworkPointer(event, 'node', node.id);
        });
        group.addEventListener('keydown', function(event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectPdfWikiNetworkNode(node.id);
          }
        });
        nodeLayer.appendChild(group);
        runtime.nodeElements[node.id] = { node: node, element: group, circle: circle, halo: halo, label: label, radius: radius };
      });

      canvas.addEventListener('pointerdown', function(event) {
        if (event.button !== 0) return;
        var nodeId = findPdfWikiNetworkNodeAtEvent(runtime, event);
        startPdfWikiNetworkPointer(event, nodeId ? 'node' : 'pan', nodeId || '');
      });
      canvas.addEventListener('pointermove', movePdfWikiNetworkPointer);
      canvas.addEventListener('pointerup', endPdfWikiNetworkPointer);
      canvas.addEventListener('pointercancel', endPdfWikiNetworkPointer);
      canvas.addEventListener('contextmenu', function(event) {
        event.preventDefault();
        var nodeId = findPdfWikiNetworkNodeAtEvent(runtime, event, runtime.hoveredNodeId || runtime.lockedNodeId);
        if (nodeId) selectPdfWikiNetworkNode(nodeId, true);
      });
      canvas.addEventListener('pointerleave', function() {
        if (pdfWikiNetworkRuntime === runtime && !runtime.pointer && runtime.hoveredNodeId) clearPdfWikiNetworkHover(runtime.hoveredNodeId);
      });
      canvas.addEventListener('wheel', wheelPdfWikiNetworkGraph, { passive: false });
      canvas.addEventListener('dblclick', function(event) {
        if (!findPdfWikiNetworkNodeAtEvent(runtime, event)) fitPdfWikiNetworkGraph();
      });
      canvas.addEventListener('keydown', function(event) {
        if ((event.key === 'Enter' || event.key === ' ') && runtime.hoveredNodeId) {
          event.preventDefault();
          selectPdfWikiNetworkNode(runtime.hoveredNodeId);
        }
      });
      if (window.ResizeObserver) {
        runtime.resizeObserver = new ResizeObserver(function() {
          if (pdfWikiNetworkRuntime !== runtime || !runtime.canvas) return;
          var nextRect = runtime.canvas.getBoundingClientRect();
          var nextWidth = Math.max(760, Math.round(nextRect.width || runtime.width));
          var nextHeight = Math.max(520, Math.round(nextRect.height || runtime.height));
          if (Math.abs(nextWidth - runtime.width) < 3 && Math.abs(nextHeight - runtime.height) < 3) return;
          runtime.width = nextWidth;
          runtime.height = nextHeight;
          runtime.simulationWidth = nextWidth * (runtime.clusterLayoutScale || 1);
          runtime.simulationHeight = nextHeight * (runtime.clusterLayoutScale || 1);
          runtime.accessibilitySvg.setAttribute('viewBox', '0 0 ' + nextWidth + ' ' + nextHeight);
          if (runtime.background) {
            runtime.background.setAttribute('width', String(nextWidth));
            runtime.background.setAttribute('height', String(nextHeight));
          }
          updatePdfWikiNetworkGeometry(runtime);
          reheatPdfWikiNetworkGraph(runtime, 0.26);
        });
        runtime.resizeObserver.observe(canvas);
      }
      preparePdfWikiNetworkSimulation(runtime);
      updatePdfWikiNetworkGeometry(runtime);
      applyPdfWikiNetworkVisibility({ reheat: true });
      requestAnimationFrame(function() {
        if (pdfWikiNetworkRuntime === runtime) window.fitPdfWikiNetworkGraph();
      });
    }

    function layoutPdfWikiNetworkGraph(graphData, width, height) {
      var centerX = width / 2;
      var centerY = height / 2;
      var minSize = Math.min(width, height);
      var topicNodes = graphData.nodes.filter(function(node) { return node.type === 'topic'; });
      var topicById = {};
      topicNodes.forEach(function(node, index) {
        var angle = topicNodes.length === 1 ? 0 : (-Math.PI / 2 + index * 2.399963229728653);
        var radius = topicNodes.length === 1 ? 0 : Math.min(minSize * 0.42, 54 + 54 * Math.sqrt(index + 1));
        node.x = centerX + Math.cos(angle) * radius;
        node.y = centerY + Math.sin(angle) * radius;
        topicById[node.id] = node;
      });

      var sentencesByTopic = {};
      graphData.nodes.filter(function(node) { return node.type === 'sentence'; }).forEach(function(node) {
        var key = node.topicNodeId || 'topic:background';
        if (!sentencesByTopic[key]) sentencesByTopic[key] = [];
        sentencesByTopic[key].push(node);
      });
      Object.keys(sentencesByTopic).forEach(function(topicId) {
        var anchor = topicById[topicId] || { x: centerX, y: centerY };
        sentencesByTopic[topicId].forEach(function(node, index) {
          var angle = index * 2.399963229728653 + (parseInt(pdfWikiNetworkHash(topicId), 36) % 100) / 100;
          var radius = 25 + Math.min(126, 10.5 * Math.sqrt(index + 1));
          node.x = anchor.x + Math.cos(angle) * radius;
          node.y = anchor.y + Math.sin(angle) * radius;
        });
      });

      var adjacency = {};
      graphData.edges.forEach(function(edge) {
        if (!adjacency[edge.source]) adjacency[edge.source] = [];
        if (!adjacency[edge.target]) adjacency[edge.target] = [];
        adjacency[edge.source].push(graphData.nodeById[edge.target]);
        adjacency[edge.target].push(graphData.nodeById[edge.source]);
      });

      function placeOuter(type, radiusFactor, angleOffset) {
        var list = graphData.nodes.filter(function(node) { return node.type === type; });
        list.forEach(function(node, index) {
          var linked = (adjacency[node.id] || []).filter(function(item) { return item && item.x !== undefined && item.y !== undefined; });
          var avgX = linked.length ? linked.reduce(function(sum, item) { return sum + item.x; }, 0) / linked.length : centerX;
          var avgY = linked.length ? linked.reduce(function(sum, item) { return sum + item.y; }, 0) / linked.length : centerY;
          var angle = linked.length
            ? Math.atan2(avgY - centerY, avgX - centerX) + angleOffset + (index % 5 - 2) * 0.035
            : (-Math.PI / 2 + Math.PI * 2 * index / Math.max(1, list.length) + angleOffset);
          var radius = minSize * radiusFactor;
          node.x = centerX + Math.cos(angle) * radius;
          node.y = centerY + Math.sin(angle) * radius;
        });
      }
      placeOuter('entry', 0.33, -0.12);
      placeOuter('pdf', 0.43, -0.07);
      placeOuter('reference', 0.49, 0.08);

      graphData.nodes.forEach(function(node) {
        if (node.x === undefined || node.y === undefined) {
          var seed = parseInt(pdfWikiNetworkHash(node.id), 36) || 1;
          var angle = (seed % 360) * Math.PI / 180;
          node.x = centerX + Math.cos(angle) * minSize * 0.36;
          node.y = centerY + Math.sin(angle) * minSize * 0.36;
        }
        node.x = Math.max(34, Math.min(width - 34, node.x));
        node.y = Math.max(34, Math.min(height - 34, node.y));
        node.vx = 0;
        node.vy = 0;
        node.fx = null;
        node.fy = null;
        node.mass = 1 + getPdfWikiNetworkNodeRadius(node) * 0.07 + Math.sqrt(Math.max(0, node.degree || 0)) * 0.12;
      });
    }

    function getPdfWikiNetworkLinkLength(edge) {
      var base = pdfWikiNetworkRuntime && pdfWikiNetworkRuntime.settings ? Number(pdfWikiNetworkRuntime.settings.linkDistance || 90) : 90;
      if (edge.type === 'topic-sentence') return base * 0.72;
      if (edge.type === 'sentence-reference') return base * 0.88;
      if (edge.type === 'entry-pdf') return base * 1.08;
      return base * 1.18;
    }

    function preparePdfWikiNetworkSimulation(runtime) {
      runtime.alpha = runtime.largeGraph ? 0.62 : 1;
      runtime.tickCount = 0;
      runtime.lastFrameAt = 0;
      runtime.lastRenderAt = 0;
      runtime.lastMotionStepAt = 0;
      runtime.graphData.nodes.forEach(function(node) {
        node.vx = Number.isFinite(node.vx) ? node.vx : 0;
        node.vy = Number.isFinite(node.vy) ? node.vy : 0;
        node.fx = null;
        node.fy = null;
        node.mass = node.mass || (1 + getPdfWikiNetworkNodeRadius(node) * 0.07);
      });
      // The knowledge graph is an explicitly animated workspace. Keep it moving
      // after opening; only the graph's own pause button may stop its motion.
      runtime.motionPaused = false;
      updatePdfWikiNetworkMotionStatus(runtime, 'running');
    }

    function reheatPdfWikiNetworkGraph(runtime, alpha) {
      if (!runtime || pdfWikiNetworkRuntime !== runtime) return;
      runtime.alpha = Math.max(Number(runtime.alpha || 0), Number(alpha || 0.36));
      runtime.lastMotionStepAt = 0;
      if (runtime.motionPaused) {
        updatePdfWikiNetworkMotionStatus(runtime, 'paused');
        return;
      }
      updatePdfWikiNetworkMotionStatus(runtime, 'running');
      if (!runtime.animationFrame) runtime.animationFrame = requestAnimationFrame(runPdfWikiNetworkSimulationFrame);
    }

    function runPdfWikiNetworkSimulationFrame(timestamp) {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime) return;
      runtime.animationFrame = null;
      if (runtime.motionPaused || !runtime.svg || !runtime.viewport) {
        updatePdfWikiNetworkMotionStatus(runtime, runtime.motionPaused ? 'paused' : 'settled');
        return;
      }
      var motionInterval = runtime.ultraLargeGraph ? 26 : 16;
      if (runtime.lastMotionStepAt && timestamp - runtime.lastMotionStepAt < motionInterval) {
        runtime.animationFrame = requestAnimationFrame(runPdfWikiNetworkSimulationFrame);
        return;
      }
      runtime.lastMotionStepAt = timestamp;
      var elapsed = runtime.lastFrameAt ? timestamp - runtime.lastFrameAt : 16.67;
      runtime.lastFrameAt = timestamp;
      var delta = Math.max(0.55, Math.min(1.65, elapsed / 16.67));
      stepPdfWikiNetworkSimulation(runtime, delta);
      var renderInterval = runtime.ultraLargeGraph ? 32 : (runtime.largeGraph ? 46 : ((runtime.visibleNodes || []).length > 520 ? 30 : 14));
      if (!runtime.lastRenderAt || timestamp - runtime.lastRenderAt >= renderInterval) {
        updatePdfWikiNetworkGeometry(runtime);
        runtime.lastRenderAt = timestamp;
      }
      runtime.alpha += (0.045 - runtime.alpha) * Math.min(0.08, 0.025 * delta);
      runtime.tickCount += 1;
      updatePdfWikiNetworkMotionStatus(runtime, 'running');
      runtime.animationFrame = requestAnimationFrame(runPdfWikiNetworkSimulationFrame);
    }

    function stepPdfWikiNetworkSimulation(runtime, delta) {
      var nodes = runtime.visibleNodes || [];
      var edges = runtime.visibleEdges || [];
      var nodeCount = nodes.length;
      if (!nodeCount) return;
      var alpha = Math.max(0.016, Number(runtime.alpha || 0));
      var forceSettings = runtime.settings || {};
      var linkForceScale = Math.max(0, Number(forceSettings.linkForce || 0.55)) / 0.55;
      var repelForceScale = Math.max(0, Number(forceSettings.repelForce || 0.65)) / 0.65;
      var centerForceScale = Math.max(0, Number(forceSettings.centerForce || 0.45)) / 0.45;
      var simulationWidth = runtime.simulationWidth || runtime.width;
      var simulationHeight = runtime.simulationHeight || runtime.height;
      var centerX = simulationWidth / 2;
      var centerY = simulationHeight / 2;

      edges.forEach(function(edge) {
        var source = runtime.graphData.nodeById[edge.source];
        var target = runtime.graphData.nodeById[edge.target];
        if (!source || !target) return;
        var dx = target.x - source.x;
        var dy = target.y - source.y;
        var distance = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
        var desired = getPdfWikiNetworkLinkLength(edge);
        var strength = (edge.type === 'topic-sentence' ? 0.014 : (edge.type === 'sentence-reference' ? 0.012 : 0.009)) * linkForceScale * alpha * delta;
        var impulse = (distance - desired) / distance * strength;
        if (source.fx === null || source.fx === undefined) {
          source.vx += dx * impulse / Math.max(1, source.mass || 1);
          source.vy += dy * impulse / Math.max(1, source.mass || 1);
        }
        if (target.fx === null || target.fx === undefined) {
          target.vx -= dx * impulse / Math.max(1, target.mass || 1);
          target.vy -= dy * impulse / Math.max(1, target.mass || 1);
        }
      });
      applyPdfWikiTopicClusterSpacing(runtime, nodes, alpha, delta);

      function repelPair(a, b, sampleBoost) {
        var dx = a.x - b.x;
        var dy = a.y - b.y;
        var distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < 0.01) {
          var seed = parseInt(pdfWikiNetworkHash(a.id + b.id), 36) || 1;
          dx = ((seed % 17) - 8) * 0.08 || 0.08;
          dy = (((seed >> 4) % 17) - 8) * 0.08 || -0.08;
          distanceSquared = dx * dx + dy * dy;
        }
        var distance = Math.sqrt(distanceSquared);
        var range = 190 + Math.min(85, (getPdfWikiNetworkNodeRadius(a) + getPdfWikiNetworkNodeRadius(b)) * 4);
        if (distance >= range) return;
        var falloff = 1 - distance / range;
        var charge = (68 + (getPdfWikiNetworkNodeRadius(a) + getPdfWikiNetworkNodeRadius(b)) * 3.2) * repelForceScale * alpha * sampleBoost * falloff / Math.max(90, distanceSquared);
        if (a.fx === null || a.fx === undefined) {
          a.vx += dx * charge / Math.max(1, a.mass || 1);
          a.vy += dy * charge / Math.max(1, a.mass || 1);
        }
        if (b.fx === null || b.fx === undefined) {
          b.vx -= dx * charge / Math.max(1, b.mass || 1);
          b.vy -= dy * charge / Math.max(1, b.mass || 1);
        }
      }

      if (nodeCount <= 170) {
        for (var i = 0; i < nodeCount; i++) {
          for (var j = i + 1; j < nodeCount; j++) repelPair(nodes[i], nodes[j], 1);
        }
      } else {
        var sampleCount = Math.min(runtime.largeGraph ? 12 : 30, nodeCount - 1);
        var sampleBoost = Math.min(3.2, nodeCount / Math.max(1, sampleCount));
        for (var nodeIndex = 0; nodeIndex < nodeCount; nodeIndex++) {
          for (var sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex++) {
            var otherIndex = (nodeIndex + sampleIndex * 37 + runtime.tickCount * 13) % nodeCount;
            if (otherIndex !== nodeIndex) repelPair(nodes[nodeIndex], nodes[otherIndex], sampleBoost * 0.5);
          }
        }
      }

      var collisionGrid = {};
      var cellSize = 42;
      nodes.forEach(function(node) {
        var cellX = Math.floor(node.x / cellSize);
        var cellY = Math.floor(node.y / cellSize);
        for (var offsetX = -1; offsetX <= 1; offsetX++) {
          for (var offsetY = -1; offsetY <= 1; offsetY++) {
            var bucket = collisionGrid[(cellX + offsetX) + ':' + (cellY + offsetY)] || [];
            bucket.forEach(function(other) {
              var dx = node.x - other.x;
              var dy = node.y - other.y;
              var distance = Math.sqrt(dx * dx + dy * dy);
              if (distance < 0.001) {
                var seed = parseInt(pdfWikiNetworkHash(node.id + other.id), 36) || 1;
                dx = ((seed % 11) - 5) * 0.09 || 0.09;
                dy = (((seed >> 3) % 11) - 5) * 0.09 || -0.09;
                distance = Math.sqrt(dx * dx + dy * dy);
              }
              var minimum = getPdfWikiNetworkNodeRadius(node) + getPdfWikiNetworkNodeRadius(other) + 5;
              if (distance >= minimum) return;
              var push = (minimum - distance) / distance * 0.085 * alpha * delta;
              if (node.fx === null || node.fx === undefined) {
                node.vx += dx * push;
                node.vy += dy * push;
              }
              if (other.fx === null || other.fx === undefined) {
                other.vx -= dx * push;
                other.vy -= dy * push;
              }
            });
          }
        }
        var ownKey = cellX + ':' + cellY;
        if (!collisionGrid[ownKey]) collisionGrid[ownKey] = [];
        collisionGrid[ownKey].push(node);
      });

      var damping = Math.pow(0.82, delta);
      var maxSpeed = 7 + alpha * 7;
      nodes.forEach(function(node) {
        if (node.fx !== null && node.fx !== undefined) {
          node.x = node.fx;
          node.y = node.fy;
          node.vx = 0;
          node.vy = 0;
          return;
        }
        node.vx += (centerX - node.x) * 0.00075 * centerForceScale * alpha * delta;
        node.vy += (centerY - node.y) * 0.00075 * centerForceScale * alpha * delta;
        var margin = 24;
        if (node.x < margin) node.vx += (margin - node.x) * 0.018 * alpha;
        if (node.x > simulationWidth - margin) node.vx -= (node.x - simulationWidth + margin) * 0.018 * alpha;
        if (node.y < margin) node.vy += (margin - node.y) * 0.018 * alpha;
        if (node.y > simulationHeight - margin) node.vy -= (node.y - simulationHeight + margin) * 0.018 * alpha;
        node.vx *= damping;
        node.vy *= damping;
        var speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
        if (speed > maxSpeed) {
          node.vx = node.vx / speed * maxSpeed;
          node.vy = node.vy / speed * maxSpeed;
        }
        node.x += node.vx * delta;
        node.y += node.vy * delta;
      });
      enforcePdfWikiTopicClearance(runtime, nodes);
    }

    function applyPdfWikiTopicClusterSpacing(runtime, nodes, alpha, delta) {
      if (runtime.topicFilterIds.size === 1) return;
      var topics = nodes.filter(function(node) { return node.type === 'topic'; });
      if (topics.length < 2) return;
      for (var firstIndex = 0; firstIndex < topics.length; firstIndex++) {
        for (var secondIndex = firstIndex + 1; secondIndex < topics.length; secondIndex++) {
          var first = topics[firstIndex];
          var second = topics[secondIndex];
          var dx = second.x - first.x;
          var dy = second.y - first.y;
          var distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < 0.001) {
            var seed = parseInt(pdfWikiNetworkHash(first.id + second.id), 36) || 1;
            dx = ((seed % 19) - 9) * 0.09 || 0.09;
            dy = (((seed >> 4) % 19) - 9) * 0.09 || -0.09;
            distance = Math.sqrt(dx * dx + dy * dy);
          }
          var degreeScale = Math.sqrt(Math.max(0, Number(first.degree || 0)) + Math.max(0, Number(second.degree || 0)));
          var minimum = 150 + Math.min(220, degreeScale * 3.2);
          if (distance >= minimum) continue;
          var push = (minimum - distance) / distance * 0.0018 * alpha * delta;
          if (first.fx === null || first.fx === undefined) {
            first.vx -= dx * push;
            first.vy -= dy * push;
          }
          if (second.fx === null || second.fx === undefined) {
            second.vx += dx * push;
            second.vy += dy * push;
          }
        }
      }
      nodes.forEach(function(node) {
        if (node.type === 'topic' || !node.clusterTopicId) return;
        var homeTopic = runtime.graphData.nodeById[node.clusterTopicId];
        if (!homeTopic || homeTopic.simulationVisible === false) return;
        var dx = node.x - homeTopic.x;
        var dy = node.y - homeTopic.y;
        var distance = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
        var topicExtent = 105 + Math.min(170, Math.sqrt(Math.max(1, Number(homeTopic.degree || 1))) * 2.4);
        var preferredExtent = node.type === 'reference' ? topicExtent * 1.18 : topicExtent;
        if (distance <= preferredExtent) return;
        var pull = (distance - preferredExtent) / distance * 0.00072 * alpha * delta;
        if (node.fx === null || node.fx === undefined) {
          node.vx -= dx * pull;
          node.vy -= dy * pull;
        }
      });
    }

    function enforcePdfWikiTopicClearance(runtime, nodes) {
      var topics = nodes.filter(function(node) { return node.type === 'topic'; });
      if (!topics.length) return;
      var clearance = 4 / Math.max(0.45, Number(runtime.scale || 1));
      topics.forEach(function(topic) {
        nodes.forEach(function(other) {
          if (other.id === topic.id) return;
          var dx = other.x - topic.x;
          var dy = other.y - topic.y;
          var distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < 0.001) {
            var seed = parseInt(pdfWikiNetworkHash(topic.id + other.id), 36) || 1;
            dx = ((seed % 17) - 8) * 0.08 || 0.08;
            dy = (((seed >> 4) % 17) - 8) * 0.08 || -0.08;
            distance = Math.sqrt(dx * dx + dy * dy);
          }
          var minimum = getPdfWikiNetworkNodeRadius(topic) + getPdfWikiNetworkNodeRadius(other) + clearance;
          if (distance >= minimum) return;
          var unitX = dx / distance;
          var unitY = dy / distance;
          var overlap = minimum - distance;
          var topicFixed = topic.fx !== null && topic.fx !== undefined;
          var otherFixed = other.fx !== null && other.fx !== undefined;
          if (!otherFixed && (topicFixed || other.type !== 'topic')) {
            other.x += unitX * overlap;
            other.y += unitY * overlap;
            other.vx += unitX * Math.min(1.2, overlap * 0.06);
            other.vy += unitY * Math.min(1.2, overlap * 0.06);
          } else if (!topicFixed && otherFixed) {
            topic.x -= unitX * overlap;
            topic.y -= unitY * overlap;
            topic.vx -= unitX * Math.min(1.2, overlap * 0.06);
            topic.vy -= unitY * Math.min(1.2, overlap * 0.06);
          } else if (!topicFixed && !otherFixed) {
            topic.x -= unitX * overlap * 0.5;
            topic.y -= unitY * overlap * 0.5;
            other.x += unitX * overlap * 0.5;
            other.y += unitY * overlap * 0.5;
          }
        });
      });
    }

    function updatePdfWikiNetworkMotionStatus(runtime, state) {
      if (!runtime || pdfWikiNetworkRuntime !== runtime) return;
      var dot = document.getElementById('pdfWikiNetworkMotionDot');
      var text = document.getElementById('pdfWikiNetworkMotionText');
      var button = document.getElementById('pdfWikiNetworkMotionButton');
      if (dot) {
        dot.dataset.state = state;
        dot.style.background = state === 'paused' ? '#94a3b8' : (state === 'settled' ? '#16a34a' : '#0f766e');
      }
      if (text) text.textContent = state === 'paused' ? '已暂停' : (state === 'ambient' ? '持续动态' : (state === 'settled' ? '已稳定' : '布局中'));
      if (button) {
        button.textContent = runtime.motionPaused ? '恢复布局' : '暂停布局';
        button.setAttribute('aria-pressed', runtime.motionPaused ? 'true' : 'false');
      }
    }

    window.togglePdfWikiNetworkMotion = function() {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime) return;
      runtime.motionPaused = !runtime.motionPaused;
      if (runtime.motionPaused) {
        if (runtime.animationFrame) cancelAnimationFrame(runtime.animationFrame);
        runtime.animationFrame = null;
        updatePdfWikiNetworkMotionStatus(runtime, 'paused');
      } else {
        runtime.lastFrameAt = 0;
        reheatPdfWikiNetworkGraph(runtime, 0.42);
      }
    };

    window.togglePdfWikiNetworkSettings = function() {
      var panel = document.getElementById('pdfWikiNetworkSettings');
      if (panel) panel.hidden = !panel.hidden;
    };

    window.updatePdfWikiNetworkSetting = function(input) {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime || !input) return;
      var key = String(input.dataset.networkSetting || '');
      if (!Object.prototype.hasOwnProperty.call(runtime.settings, key)) return;
      runtime.settings[key] = Number(input.value);
      var output = input.parentElement && input.parentElement.querySelector('output');
      if (output) output.textContent = key === 'linkDistance' ? String(Math.round(runtime.settings[key])) : runtime.settings[key].toFixed(2);
      updatePdfWikiNetworkGeometry(runtime);
      if (key === 'centerForce' || key === 'repelForce' || key === 'linkForce' || key === 'linkDistance') {
        reheatPdfWikiNetworkGraph(runtime, 0.72);
      }
    };

    window.resetPdfWikiNetworkSettings = function() {
      var panel = document.getElementById('pdfWikiNetworkSettings');
      if (!panel) return;
      var defaults = { nodeSize: 1, linkThickness: 1, textFade: 0.35, centerForce: 0.45, repelForce: 0.65, linkForce: 0.55, linkDistance: 90 };
      panel.querySelectorAll('[data-network-setting]').forEach(function(input) {
        var key = input.dataset.networkSetting;
        input.value = defaults[key];
        updatePdfWikiNetworkSetting(input);
      });
    };

    window.restartPdfWikiNetworkLayout = function() {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime) return;
      layoutPdfWikiNetworkGraph(runtime.graphData, runtime.simulationWidth || runtime.width, runtime.simulationHeight || runtime.height);
      runtime.hoveredNodeId = '';
      runtime.hoverVisualNodeId = '';
      runtime.hoverVisualProgress = 0;
      runtime.hoverVisualTarget = 0;
      runtime.lastFrameAt = 0;
      updatePdfWikiNetworkGeometry(runtime);
      applyPdfWikiNetworkVisibility({ reheat: true, alpha: 1 });
    };

    function truncatePdfWikiNetworkLabel(value, maxLength) {
      var text = String(value || '').replace(/\s+/g, ' ').trim();
      return text.length > maxLength ? text.slice(0, maxLength - 1) + '…' : text;
    }

    function updatePdfWikiNetworkGeometry(runtime) {
      if (!runtime) return;
      drawPdfWikiNetworkCanvas(runtime);
      if (!runtime.viewport) return;
      runtime.viewport.setAttribute('transform', 'translate(' + runtime.translateX + ' ' + runtime.translateY + ') scale(' + runtime.scale + ')');
      Object.keys(runtime.nodeElements).forEach(function(nodeId) {
        var item = runtime.nodeElements[nodeId];
        item.element.setAttribute('transform', 'translate(' + item.node.x + ' ' + item.node.y + ')');
      });
      runtime.edgeElements.forEach(function(item) {
        var source = runtime.graphData.nodeById[item.edge.source];
        var target = runtime.graphData.nodeById[item.edge.target];
        if (!source || !target) return;
        item.element.setAttribute('x1', String(source.x));
        item.element.setAttribute('y1', String(source.y));
        item.element.setAttribute('x2', String(target.x));
        item.element.setAttribute('y2', String(target.y));
      });
    }

    function setPdfWikiNetworkHoverAnimation(runtime, nodeId, visible) {
      if (!runtime || pdfWikiNetworkRuntime !== runtime) return;
      if (visible && nodeId) {
        if (runtime.hoverVisualNodeId !== nodeId) {
          runtime.hoverVisualNodeId = nodeId;
          runtime.hoverVisualProgress = Math.min(0.12, Number(runtime.hoverVisualProgress || 0));
        }
        runtime.hoverVisualTarget = 1;
      } else {
        runtime.hoverVisualTarget = 0;
      }
      if (runtime.reducedMotion) {
        runtime.hoverVisualProgress = runtime.hoverVisualTarget;
        if (!runtime.hoverVisualTarget) runtime.hoverVisualNodeId = '';
        drawPdfWikiNetworkCanvas(runtime);
        return;
      }
      runtime.hoverVisualLastFrameAt = 0;
      if (!runtime.visualAnimationFrame) {
        runtime.visualAnimationFrame = requestAnimationFrame(runPdfWikiNetworkHoverAnimationFrame);
      }
    }

    function runPdfWikiNetworkHoverAnimationFrame(timestamp) {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime) return;
      runtime.visualAnimationFrame = null;
      var elapsed = runtime.hoverVisualLastFrameAt ? timestamp - runtime.hoverVisualLastFrameAt : 16.67;
      runtime.hoverVisualLastFrameAt = timestamp;
      var response = 1 - Math.pow(0.001, Math.max(1, Math.min(40, elapsed)) / 220);
      runtime.hoverVisualProgress += (runtime.hoverVisualTarget - runtime.hoverVisualProgress) * response;
      var settled = Math.abs(runtime.hoverVisualTarget - runtime.hoverVisualProgress) < 0.004;
      if (settled) {
        runtime.hoverVisualProgress = runtime.hoverVisualTarget;
        if (!runtime.hoverVisualTarget) runtime.hoverVisualNodeId = '';
      }
      drawPdfWikiNetworkCanvas(runtime);
      if (!settled && pdfWikiNetworkRuntime === runtime) {
        runtime.visualAnimationFrame = requestAnimationFrame(runPdfWikiNetworkHoverAnimationFrame);
      }
    }

    function drawPdfWikiNetworkCanvas(runtime) {
      var canvas = runtime && runtime.canvas;
      if (!canvas) return;
      var pixelRatio = Math.max(1, Math.min(runtime.largeGraph ? 1.35 : 2, Number(window.devicePixelRatio || 1)));
      var pixelWidth = Math.max(1, Math.round(runtime.width * pixelRatio));
      var pixelHeight = Math.max(1, Math.round(runtime.height * pixelRatio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      var context = canvas.getContext('2d', { alpha: true, desynchronized: false });
      if (!context) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, runtime.width, runtime.height);
      context.save();
      context.translate(runtime.translateX, runtime.translateY);
      context.scale(runtime.scale, runtime.scale);

      var selectedId = runtime.selectedNodeId;
      var hoverId = runtime.hoverVisualNodeId;
      var visualFocusId = hoverId || selectedId;
      var focusNodeIds = {};
      if (visualFocusId) {
        focusNodeIds[visualFocusId] = true;
        var firstHopIds = Object.keys(runtime.neighborIds[visualFocusId] || {});
        firstHopIds.forEach(function(nodeId) { focusNodeIds[nodeId] = true; });
        var focusNode = runtime.graphData.nodeById[visualFocusId];
        if (focusNode && focusNode.type === 'topic') {
          firstHopIds.forEach(function(nodeId) {
            Object.keys(runtime.neighborIds[nodeId] || {}).forEach(function(secondHopId) {
              var secondHopNode = runtime.graphData.nodeById[secondHopId];
              if (secondHopNode && secondHopNode.type === 'reference') focusNodeIds[secondHopId] = true;
            });
          });
        }
      }
      var hoverProgress = Math.max(0, Math.min(1, Number(runtime.hoverVisualProgress || 0)));
      var hoverEase = 1 - Math.pow(1 - hoverProgress, 3);
      var rootStyle = getComputedStyle(document.documentElement);
      var canvasBackgroundColor = rootStyle.getPropertyValue('--bg-secondary').trim() || '#f8f9fa';
      var canvasTextColor = rootStyle.getPropertyValue('--text-primary').trim() || '#374151';
      var viewPadding = 90 / Math.max(0.45, runtime.scale);
      var viewMinX = -runtime.translateX / runtime.scale - viewPadding;
      var viewMinY = -runtime.translateY / runtime.scale - viewPadding;
      var viewMaxX = (runtime.width - runtime.translateX) / runtime.scale + viewPadding;
      var viewMaxY = (runtime.height - runtime.translateY) / runtime.scale + viewPadding;
      runtime.edgeElements.forEach(function(item) {
        if (item.element.style.display === 'none') return;
        var source = runtime.graphData.nodeById[item.edge.source];
        var target = runtime.graphData.nodeById[item.edge.target];
        if (!source || !target) return;
        if ((source.x < viewMinX && target.x < viewMinX) || (source.x > viewMaxX && target.x > viewMaxX) ||
            (source.y < viewMinY && target.y < viewMinY) || (source.y > viewMaxY && target.y > viewMaxY)) return;
        var active = !visualFocusId || (!!focusNodeIds[item.edge.source] && !!focusNodeIds[item.edge.target]);
        var baseAlpha = active ? (visualFocusId ? 0.86 : item.baseOpacity) : 0.025;
        var thicknessScale = runtime.settings ? Number(runtime.settings.linkThickness || 1) : 1;
        var baseWidth = (active && visualFocusId ? 1.65 : (item.edge.type === 'topic-sentence' ? 1.15 : 0.85)) * thicknessScale;
        context.beginPath();
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.strokeStyle = item.edge.type === 'sentence-reference'
          ? getPdfWikiNetworkTypeColor('reference')
          : (item.edge.type === 'topic-sentence'
            ? getPdfWikiNetworkTypeColor('topic')
            : (item.edge.type === 'entry-pdf' ? getPdfWikiNetworkTypeColor('entry') : getPdfWikiNetworkTypeColor('pdf')));
        context.globalAlpha = baseAlpha;
        context.lineWidth = baseWidth / Math.max(0.45, runtime.scale);
        context.stroke();
      });

      Object.keys(runtime.nodeElements).forEach(function(nodeId) {
        var item = runtime.nodeElements[nodeId];
        var node = item && item.node;
        if (!item || item.element.style.display === 'none') return;
        if (node.x < viewMinX || node.x > viewMaxX || node.y < viewMinY || node.y > viewMaxY) return;
        var isSelected = node.id === selectedId;
        var isVisualFocus = node.id === visualFocusId;
        var isRelated = !!focusNodeIds[node.id];
        var baseNodeAlpha = visualFocusId && !isRelated ? 0.11 : (isVisualFocus ? 1 : (isRelated ? 0.88 : 1));
        var isHovered = node.id === hoverId;
        var nodeAlpha = baseNodeAlpha;
        var currentRadius = getPdfWikiNetworkNodeRadius(node);
        var renderRadius = currentRadius * (1 + (isHovered ? 0.17 * hoverEase : 0));
        context.globalAlpha = nodeAlpha;
        if (isSelected) {
          context.beginPath();
          context.arc(node.x, node.y, currentRadius + 5, 0, Math.PI * 2);
          context.strokeStyle = getPdfWikiNetworkNodeColor(node);
          context.lineWidth = 2.4 / Math.max(0.45, runtime.scale);
          context.stroke();
        }
        if (isHovered && hoverEase > 0.001) {
          context.beginPath();
          context.arc(node.x, node.y, currentRadius + 3 + hoverEase * 7, 0, Math.PI * 2);
          context.strokeStyle = getPdfWikiNetworkNodeColor(node);
          context.globalAlpha = 0.68 * hoverEase;
          context.lineWidth = (1.2 + hoverEase * 1.2) / Math.max(0.45, runtime.scale);
          context.stroke();
          context.globalAlpha = nodeAlpha;
        }
        context.beginPath();
        context.arc(node.x, node.y, renderRadius, 0, Math.PI * 2);
        context.fillStyle = getPdfWikiNetworkNodeColor(node);
        context.fill();
        context.strokeStyle = 'rgba(255,255,255,0.92)';
        context.lineWidth = (node.type === 'sentence' ? 1.4 : 2) / Math.max(0.45, runtime.scale);
        context.stroke();
        if (item.label) {
          var labelText = truncatePdfWikiNetworkLabel(node.label, node.type === 'entry' ? 20 : 24);
          var fontSize = node.type === 'entry' ? 10 : 11;
          var textFade = runtime.settings ? Number(runtime.settings.textFade || 0) : 0;
          var labelAlpha = Math.max(0.06, Math.min(1, (runtime.scale - textFade * 0.72) / 0.45));
          context.globalAlpha = nodeAlpha * labelAlpha;
          context.font = (node.type === 'topic' ? '750 ' : '650 ') + fontSize + 'px sans-serif';
          context.textBaseline = 'middle';
          context.lineJoin = 'round';
          context.strokeStyle = canvasBackgroundColor;
          context.lineWidth = 3 / Math.max(0.45, runtime.scale);
          context.strokeText(labelText, node.x + renderRadius + 5, node.y);
          context.fillStyle = canvasTextColor;
          context.fillText(labelText, node.x + renderRadius + 5, node.y);
        }
      });
      context.restore();
      context.globalAlpha = 1;
    }

    function getPdfWikiNetworkEventPosition(runtime, event) {
      if (!runtime || !runtime.svg) return null;
      var rect = runtime.svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      var canvasX = (event.clientX - rect.left) * runtime.width / rect.width;
      var canvasY = (event.clientY - rect.top) * runtime.height / rect.height;
      return {
        x: (canvasX - runtime.translateX) / runtime.scale,
        y: (canvasY - runtime.translateY) / runtime.scale,
      };
    }

    function findPdfWikiNetworkNodeAtEvent(runtime, event, keepNodeId) {
      var position = getPdfWikiNetworkEventPosition(runtime, event);
      if (!position) return '';
      var keepNode = keepNodeId ? runtime.graphData.nodeById[keepNodeId] : null;
      if (keepNode && keepNode.simulationVisible !== false) {
        var keepDistance = Math.hypot(position.x - keepNode.x, position.y - keepNode.y);
        var keepRadius = getPdfWikiNetworkNodeRadius(keepNode) + (keepNode.type === 'topic' ? 20 : 14) + (keepNode.type === 'topic' ? 11 : 8) / runtime.scale;
        if (keepDistance <= keepRadius) return keepNode.id;
      }
      var nearestNodeId = '';
      var nearestDistance = Infinity;
      (runtime.visibleNodes || []).forEach(function(node) {
        var distance = Math.hypot(position.x - node.x, position.y - node.y);
        var hitRadius = getPdfWikiNetworkNodeRadius(node) + (node.type === 'topic' ? 16 : 9) + (node.type === 'topic' ? 10 : 6) / runtime.scale;
        if (distance <= hitRadius && distance < nearestDistance) {
          nearestNodeId = node.id;
          nearestDistance = distance;
        }
      });
      return nearestNodeId;
    }

    function trackPdfWikiNetworkHover(event) {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime || !runtime.svg || runtime.pointer) return;
      var now = performance.now();
      if (runtime.largeGraph && runtime.lastHoverHitTestAt && now - runtime.lastHoverHitTestAt < 48) return;
      runtime.lastHoverHitTestAt = now;
      var nearestNodeId = findPdfWikiNetworkNodeAtEvent(runtime, event, runtime.hoveredNodeId);
      if (nearestNodeId) {
        if (runtime.hoverHideTimer) {
          clearTimeout(runtime.hoverHideTimer);
          runtime.hoverHideTimer = null;
        }
        if (runtime.hoveredNodeId !== nearestNodeId) activatePdfWikiNetworkHover(event, nearestNodeId);
      } else if (runtime.hoveredNodeId && !runtime.hoverHideTimer) {
        clearPdfWikiNetworkHover(runtime.hoveredNodeId);
      }
    }

    function startPdfWikiNetworkPointer(event, mode, nodeId) {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime || !runtime.svg || event.button !== 0) return;
      event.preventDefault();
      if (mode === 'node') event.stopPropagation();
      runtime.pointer = {
        mode: mode,
        nodeId: nodeId,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        startNodeX: mode === 'node' && runtime.graphData.nodeById[nodeId] ? runtime.graphData.nodeById[nodeId].x : 0,
        startNodeY: mode === 'node' && runtime.graphData.nodeById[nodeId] ? runtime.graphData.nodeById[nodeId].y : 0,
        moved: false,
        dragActivated: mode === 'node',
      };
      runtime.svg.setPointerCapture(event.pointerId);
      runtime.svg.style.cursor = mode === 'node' ? 'grabbing' : 'grabbing';
      if (mode === 'node' && nodeId) {
        var draggedNode = runtime.graphData.nodeById[nodeId];
        if (draggedNode) {
          draggedNode.fx = draggedNode.x;
          draggedNode.fy = draggedNode.y;
          draggedNode.vx = 0;
          draggedNode.vy = 0;
          runtime.draggingNodeId = nodeId;
          reheatPdfWikiNetworkGraph(runtime, 0.34);
        }
      }
    }

    function movePdfWikiNetworkPointer(event) {
      var runtime = pdfWikiNetworkRuntime;
      var pointer = runtime && runtime.pointer;
      if (!runtime) return;
      if (!pointer) {
        trackPdfWikiNetworkHover(event);
        return;
      }
      if (pointer.pointerId !== event.pointerId) return;
      var rect = runtime.svg.getBoundingClientRect();
      var ratioX = runtime.width / Math.max(1, rect.width);
      var ratioY = runtime.height / Math.max(1, rect.height);
      var dx = (event.clientX - pointer.lastClientX) * ratioX;
      var dy = (event.clientY - pointer.lastClientY) * ratioY;
      var totalClientDx = event.clientX - pointer.startClientX;
      var totalClientDy = event.clientY - pointer.startClientY;
      if (Math.hypot(totalClientDx, totalClientDy) > 3) pointer.moved = true;
      if (pointer.mode === 'node') {
        var node = runtime.graphData.nodeById[pointer.nodeId];
        if (node) {
          node.fx = pointer.startNodeX + totalClientDx * ratioX / runtime.scale;
          node.fy = pointer.startNodeY + totalClientDy * ratioY / runtime.scale;
          node.x = node.fx;
          node.y = node.fy;
          node.vx = 0;
          node.vy = 0;
        }
      } else {
        runtime.translateX += dx;
        runtime.translateY += dy;
      }
      pointer.lastClientX = event.clientX;
      pointer.lastClientY = event.clientY;
    }

    function endPdfWikiNetworkPointer(event) {
      var runtime = pdfWikiNetworkRuntime;
      var pointer = runtime && runtime.pointer;
      if (!runtime || !pointer || pointer.pointerId !== event.pointerId) return;
      if (runtime.svg.hasPointerCapture(event.pointerId)) runtime.svg.releasePointerCapture(event.pointerId);
      runtime.pointer = null;
      runtime.draggingNodeId = '';
      runtime.svg.style.cursor = 'grab';
      if (pointer.mode === 'node' && pointer.dragActivated) {
        var node = runtime.graphData.nodeById[pointer.nodeId];
        if (runtime.nodeElements[pointer.nodeId]) runtime.nodeElements[pointer.nodeId].element.style.cursor = 'grab';
        if (node) {
          node.fx = null;
          node.fy = null;
        }
        updatePdfWikiNetworkGeometry(runtime);
        reheatPdfWikiNetworkGraph(runtime, 0.38);
      }
      // 左键仅负责拖动节点；持久固定详情统一由右键触发。
    }

    function wheelPdfWikiNetworkGraph(event) {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime || !runtime.svg) return;
      event.preventDefault();
      var rect = runtime.svg.getBoundingClientRect();
      var px = (event.clientX - rect.left) * runtime.width / Math.max(1, rect.width);
      var py = (event.clientY - rect.top) * runtime.height / Math.max(1, rect.height);
      var oldScale = runtime.scale;
      var factor = event.deltaY < 0 ? 1.12 : 0.89;
      var nextScale = Math.max(0.45, Math.min(3.2, oldScale * factor));
      runtime.translateX = px - (px - runtime.translateX) * nextScale / oldScale;
      runtime.translateY = py - (py - runtime.translateY) * nextScale / oldScale;
      runtime.scale = nextScale;
      updatePdfWikiNetworkGeometry(runtime);
    }

    window.zoomPdfWikiNetworkGraph = function(direction) {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime) return;
      var oldScale = runtime.scale;
      var nextScale = Math.max(0.45, Math.min(3.2, oldScale * (direction > 0 ? 1.2 : 0.82)));
      var centerX = runtime.width / 2;
      var centerY = runtime.height / 2;
      runtime.translateX = centerX - (centerX - runtime.translateX) * nextScale / oldScale;
      runtime.translateY = centerY - (centerY - runtime.translateY) * nextScale / oldScale;
      runtime.scale = nextScale;
      updatePdfWikiNetworkGeometry(runtime);
    };

    window.fitPdfWikiNetworkGraph = function() {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime) return;
      var nodes = (runtime.visibleNodes || runtime.graphData.nodes).filter(function(node) {
        return Number.isFinite(node.x) && Number.isFinite(node.y);
      });
      if (!nodes.length) return;
      var minX = Math.min.apply(null, nodes.map(function(node) { return node.x; }));
      var maxX = Math.max.apply(null, nodes.map(function(node) { return node.x; }));
      var minY = Math.min.apply(null, nodes.map(function(node) { return node.y; }));
      var maxY = Math.max.apply(null, nodes.map(function(node) { return node.y; }));
      var graphWidth = Math.max(80, maxX - minX + 110);
      var graphHeight = Math.max(80, maxY - minY + 110);
      runtime.scale = Math.max(0.45, Math.min(2.1, Math.min(runtime.width / graphWidth, runtime.height / graphHeight)));
      runtime.translateX = runtime.width / 2 - (minX + maxX) / 2 * runtime.scale;
      runtime.translateY = runtime.height / 2 - (minY + maxY) / 2 * runtime.scale;
      updatePdfWikiNetworkGeometry(runtime);
    };

    window.togglePdfWikiNetworkType = function(type, visible) {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime || runtime.typeVisibility[type] === undefined) return;
      runtime.typeVisibility[type] = !!visible;
      applyPdfWikiNetworkVisibility({ reheat: true, alpha: 0.48 });
    };

    window.filterPdfWikiNetworkGraph = function(value) {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime) return;
      runtime.searchTerm = String(value || '').trim().toLowerCase();
      applyPdfWikiNetworkVisibility({ reheat: true, alpha: 0.42 });
    };

    window.filterPdfWikiNetworkTopic = function(value) {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime) return;
      var topicId = String(value || '');
      var topicNode = topicId ? runtime.graphData.nodeById[topicId] : null;
      runtime.topicFilterIds.clear();
      if (topicNode && topicNode.type === 'topic') runtime.topicFilterIds.add(topicId);
      if (runtime.topicFilterIds.size === 1) {
        runtime.selectedNodeId = topicId;
        runtime.lockedNodeId = topicId;
        runtime.hoveredNodeId = '';
        setPdfWikiNetworkHoverAnimation(runtime, '', false);
        renderPdfWikiNetworkSidebar(runtime, topicId, 'selected');
      } else if (runtime.lockedNodeId && runtime.graphData.nodeById[runtime.lockedNodeId] && runtime.graphData.nodeById[runtime.lockedNodeId].type === 'topic') {
        runtime.selectedNodeId = '';
        runtime.lockedNodeId = '';
        renderPdfWikiNetworkSidebar(runtime, '', 'empty');
      }
      syncPdfWikiNetworkTopicFilterControls(runtime);
      applyPdfWikiNetworkVisibility({ reheat: true, alpha: 0.72 });
      requestAnimationFrame(function() {
        if (pdfWikiNetworkRuntime === runtime) window.fitPdfWikiNetworkGraph();
      });
    };

    window.togglePdfWikiNetworkTopic = function(value, checked) {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime) return;
      var topicId = String(value || '');
      var topicNode = runtime.graphData.nodeById[topicId];
      if (!topicNode || topicNode.type !== 'topic') return;
      if (checked) runtime.topicFilterIds.add(topicId);
      else runtime.topicFilterIds.delete(topicId);
      if (runtime.topicFilterIds.size === 1) {
        var onlyTopicId = Array.from(runtime.topicFilterIds)[0];
        runtime.selectedNodeId = onlyTopicId;
        runtime.lockedNodeId = onlyTopicId;
        renderPdfWikiNetworkSidebar(runtime, onlyTopicId, 'selected');
      } else if (runtime.lockedNodeId && runtime.graphData.nodeById[runtime.lockedNodeId] && runtime.graphData.nodeById[runtime.lockedNodeId].type === 'topic') {
        runtime.selectedNodeId = '';
        runtime.lockedNodeId = '';
        renderPdfWikiNetworkSidebar(runtime, '', 'empty');
      }
      syncPdfWikiNetworkTopicFilterControls(runtime);
      applyPdfWikiNetworkVisibility({ reheat: true, alpha: 0.64 });
      requestAnimationFrame(function() {
        if (pdfWikiNetworkRuntime === runtime) window.fitPdfWikiNetworkGraph();
      });
    };

    function syncPdfWikiNetworkTopicFilterControls(runtime) {
      if (!runtime) return;
      document.querySelectorAll('[data-pdf-wiki-topic-choice]').forEach(function(input) {
        input.checked = runtime.topicFilterIds.has(String(input.value || ''));
      });
      var summary = document.getElementById('pdfWikiNetworkTopicFilterSummary');
      if (!summary) return;
      if (runtime.topicFilterIds.size === 0) {
        summary.textContent = runtime.hideUnclassified ? '全部已分类主题' : '全部主题';
      } else if (runtime.topicFilterIds.size === 1) {
        var topicId = Array.from(runtime.topicFilterIds)[0];
        var node = runtime.graphData.nodeById[topicId];
        summary.textContent = node ? truncatePdfWikiNetworkLabel(node.label, 28) : '已选 1 个主题';
      } else {
        summary.textContent = '已选 ' + runtime.topicFilterIds.size + ' 个主题';
      }
    }

    function isPdfWikiNetworkUnclassifiedNode(node) {
      if (!node) return false;
      return node.id === 'topic:unclassified' ||
        node.topicKey === 'unclassified' ||
        node.topicNodeId === 'topic:unclassified' ||
        node.clusterTopicId === 'topic:unclassified';
    }

    function applyPdfWikiNetworkVisibility(options) {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime) return;
      options = options || {};
      var term = runtime.searchTerm;
      var matched = {};
      var includedBySearch = {};
      var includedByTopic = {};
      if (term) {
        runtime.graphData.nodes.forEach(function(node) {
          if (node.searchText.indexOf(term) >= 0) matched[node.id] = true;
        });
        Object.keys(matched).forEach(function(nodeId) {
          includedBySearch[nodeId] = true;
          Object.keys(runtime.neighborIds[nodeId] || {}).forEach(function(neighborId) { includedBySearch[neighborId] = true; });
        });
      }
      if (runtime.topicFilterIds.size > 0) {
        runtime.topicFilterIds.forEach(function(topicId) {
          includedByTopic[topicId] = true;
          Object.keys(runtime.neighborIds[topicId] || {}).forEach(function(sentenceNodeId) {
            var sentenceNode = runtime.graphData.nodeById[sentenceNodeId];
            if (!sentenceNode || sentenceNode.type !== 'sentence') return;
            includedByTopic[sentenceNodeId] = true;
            Object.keys(runtime.neighborIds[sentenceNodeId] || {}).forEach(function(relatedNodeId) {
              var relatedNode = runtime.graphData.nodeById[relatedNodeId];
              if (relatedNode && (relatedNode.type === 'reference' || relatedNode.type === 'pdf')) includedByTopic[relatedNodeId] = true;
            });
          });
        });
      }
      var visibleIds = {};
      var visibleNodeCount = 0;
      var showUnclassified = runtime.topicFilterIds.has('topic:unclassified');
      Object.keys(runtime.nodeElements).forEach(function(nodeId) {
        var item = runtime.nodeElements[nodeId];
        var hiddenUnclassified = runtime.hideUnclassified && !showUnclassified && isPdfWikiNetworkUnclassifiedNode(item.node);
        var visible = runtime.typeVisibility[item.node.type] !== false &&
          !hiddenUnclassified &&
          (runtime.topicFilterIds.size === 0 || includedByTopic[nodeId]) &&
          (!term || includedBySearch[nodeId]);
        item.element.style.display = visible ? '' : 'none';
        if (visible) {
          visibleIds[nodeId] = true;
          visibleNodeCount += 1;
        }
      });
      var visibleEdgeCount = 0;
      var visibleEdges = [];
      runtime.edgeElements.forEach(function(item) {
        var visible = !!visibleIds[item.edge.source] && !!visibleIds[item.edge.target];
        item.element.style.display = visible ? '' : 'none';
        item.edge.simulationVisible = visible;
        if (visible) {
          visibleEdgeCount += 1;
          visibleEdges.push(item.edge);
        }
      });
      if (runtime.hoveredNodeId && !visibleIds[runtime.hoveredNodeId]) {
        var hiddenHoveredNode = runtime.graphData.nodeById[runtime.hoveredNodeId];
        if (hiddenHoveredNode && runtime.draggingNodeId !== hiddenHoveredNode.id) {
          hiddenHoveredNode.fx = null;
          hiddenHoveredNode.fy = null;
        }
        runtime.hoveredNodeId = '';
        setPdfWikiNetworkHoverAnimation(runtime, '', false);
      }
      if (runtime.selectedNodeId && !visibleIds[runtime.selectedNodeId]) runtime.selectedNodeId = '';
      runtime.visibleNodes = runtime.graphData.nodes.filter(function(node) {
        node.simulationVisible = !!visibleIds[node.id];
        return node.simulationVisible;
      });
      runtime.visibleEdges = visibleEdges;
      updatePdfWikiNetworkFocus(runtime);
      var count = document.getElementById('pdfWikiNetworkVisibleCount');
      if (count) count.textContent = '可见节点 ' + visibleNodeCount + ' · 连线 ' + visibleEdgeCount;
      if (options.reheat) reheatPdfWikiNetworkGraph(runtime, options.alpha || 0.36);
    }

    function updatePdfWikiNetworkFocus(runtime) {
      if (!runtime) return;
      // Hover must never change SVG appearance. Only an explicit click selection
      // can dim unrelated nodes or show the relationship ring.
      var focusId = runtime.selectedNodeId;
      var focusNeighbors = focusId ? (runtime.neighborIds[focusId] || {}) : {};
      Object.keys(runtime.nodeElements).forEach(function(nodeId) {
        var item = runtime.nodeElements[nodeId];
        if (item.element.style.display === 'none') return;
        var isFocus = nodeId === focusId;
        var isNeighbor = !!focusNeighbors[nodeId];
        item.element.style.opacity = focusId && !isFocus && !isNeighbor ? '0.11' : (isNeighbor ? '0.88' : '1');
        item.halo.style.display = isFocus ? '' : 'none';
        if (item.label) item.label.setAttribute('opacity', focusId && !isFocus && !isNeighbor ? '0.16' : '1');
      });
      runtime.edgeElements.forEach(function(item) {
        if (item.element.style.display === 'none') return;
        var active = !focusId || item.edge.source === focusId || item.edge.target === focusId;
        item.element.setAttribute('stroke-opacity', String(active ? (focusId ? 0.86 : item.baseOpacity) : 0.025));
        item.element.setAttribute('stroke-width', String(active && focusId ? 1.65 : (item.edge.type === 'topic-sentence' ? 1.15 : 0.85)));
      });
      drawPdfWikiNetworkCanvas(runtime);
    }

    window.selectPdfWikiNetworkNode = function(nodeId) {
      selectPdfWikiNetworkNode(nodeId);
    };

    function selectPdfWikiNetworkNode(nodeId, replaceLockedNode) {
      var runtime = pdfWikiNetworkRuntime;
      var node = runtime && runtime.graphData.nodeById[nodeId];
      if (!runtime || !node) return;
      if (runtime.lockedNodeId && runtime.lockedNodeId !== nodeId && replaceLockedNode !== true) {
        renderPdfWikiNetworkSidebar(runtime, runtime.lockedNodeId, 'selected');
        return;
      }
      runtime.selectedNodeId = nodeId;
      runtime.lockedNodeId = nodeId;
      runtime.hoveredNodeId = '';
      setPdfWikiNetworkHoverAnimation(runtime, '', false);
      if (node.type === 'sentence' && node.point) pdfWikiActiveSentencePointId = node.point.id;
      renderPdfWikiNetworkSidebar(runtime, nodeId, 'selected');
      applyPdfWikiNetworkVisibility();
    }

    window.clearPdfWikiNetworkSelection = function() {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime) return;
      if (runtime.lockedNodeId) {
        renderPdfWikiNetworkSidebar(runtime, runtime.lockedNodeId, 'selected');
        return;
      }
      runtime.selectedNodeId = '';
      runtime.lockedNodeId = '';
      applyPdfWikiNetworkVisibility();
      if (runtime.hoveredNodeId) {
        renderPdfWikiNetworkSidebar(runtime, runtime.hoveredNodeId, 'hover');
      } else {
        renderPdfWikiNetworkSidebar(runtime, '', 'empty');
      }
    };

    function renderPdfWikiNetworkSidebar(runtime, nodeId, displayMode) {
      if (!runtime || pdfWikiNetworkRuntime !== runtime) return;
      var detail = document.getElementById('pdfWikiNetworkDetail');
      if (!detail) return;
      if (runtime.lockedNodeId && (displayMode !== 'selected' || nodeId !== runtime.lockedNodeId)) {
        nodeId = runtime.lockedNodeId;
        displayMode = 'selected';
      }
      var node = nodeId ? runtime.graphData.nodeById[nodeId] : null;
      if (!node) {
        detail.dataset.displayMode = 'empty';
        detail.dataset.nodeId = '';
        detail.innerHTML = renderPdfWikiNetworkEmptyDetail(runtime.graphData);
        return;
      }
      var normalizedMode = displayMode === 'selected' ? 'selected' : 'hover';
      detail.dataset.displayMode = normalizedMode;
      detail.dataset.nodeId = node.id;
      detail.innerHTML = renderPdfWikiNetworkNodeDetail(node, runtime, normalizedMode);
      detail.scrollTop = 0;
    }

    function renderPdfWikiNetworkEmptyDetail(graphData) {
      return '<div style="padding:18px;">' +
        '<div style="font-size:15px;font-weight:800;color:var(--text-primary);margin-bottom:8px;">悬停预览，右键固定</div>' +
        '<div style="font-size:12px;line-height:1.75;color:var(--text-secondary);">把鼠标放到节点上可临时预览；右键点击节点后详情会固定保留，并突出显示它的一跳关系。左键按住节点可直接拖动。</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px;">' +
          Object.keys(graphData.counts).map(function(type) {
            return '<div style="padding:9px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-secondary);"><div style="font-size:10px;color:var(--text-secondary);">' + escapeHtml(getPdfWikiNetworkTypeLabel(type)) + '</div><div style="font-size:18px;font-weight:800;color:var(--text-primary);margin-top:3px;">' + escapeHtml(graphData.counts[type] || 0) + '</div></div>';
          }).join('') +
        '</div>' +
      '</div>';
    }

    function renderPdfWikiNetworkRelatedSentences(sentenceIds, limit) {
      var runtime = pdfWikiNetworkRuntime;
      var points = (sentenceIds || []).map(function(pointId) {
        return runtime && runtime.graphData.nodeById['sentence:' + pointId];
      }).filter(Boolean).slice(0, limit || 8);
      if (!points.length) return '<div style="font-size:12px;color:var(--text-secondary);">暂无关联论点句。</div>';
      return points.map(function(node) {
        return '<button type="button" data-network-node-target="' + escapeHtml(node.id) + '" onclick="selectPdfWikiNetworkNode(this.dataset.networkNodeTarget)" style="width:100%;text-align:left;margin:0 0 7px;padding:8px 9px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:11px;line-height:1.45;">' + escapeHtml(truncatePdfWikiNetworkLabel(node.label, 90)) + '</button>';
      }).join('');
    }

    function renderPdfWikiNetworkNodeDetail(node, runtime, displayMode) {
      var isSelected = displayMode === 'selected';
      var stateBar = '<div style="display:flex;align-items:center;gap:7px;padding:9px 13px;border-bottom:1px solid var(--border-color);background:' + (isSelected ? 'color-mix(in srgb,#0f766e 9%,var(--bg-primary))' : 'var(--bg-secondary)') + ';">' +
        '<span style="width:7px;height:7px;border-radius:999px;background:' + (isSelected ? '#0f766e' : '#94a3b8') + ';"></span>' +
        '<span style="font-size:10px;font-weight:800;color:var(--text-secondary);">' + (isSelected ? '已固定' : '悬停预览') + '</span>' +
        (isSelected
          ? '<span style="margin-left:auto;font-size:10px;color:#0f766e;font-weight:750;">右键其他节点可切换</span>'
          : '<span style="margin-left:auto;font-size:10px;color:var(--text-secondary);">右键节点固定详情</span>') +
      '</div>';
      var common = stateBar + '<div style="padding:16px 17px;border-bottom:1px solid var(--border-color);">' +
        '<div style="display:flex;align-items:center;gap:7px;margin-bottom:9px;">' +
          '<span style="width:10px;height:10px;border-radius:999px;background:' + getPdfWikiNetworkNodeColor(node) + ';"></span>' +
          '<span style="font-size:11px;font-weight:750;color:var(--text-secondary);">' + escapeHtml(getPdfWikiNetworkTypeLabel(node.type)) + '</span>' +
          '<span style="margin-left:auto;font-size:10px;color:var(--text-secondary);">关系 ' + escapeHtml(node.degree || 0) + '</span>' +
        '</div>' +
        '<div style="font-size:16px;font-weight:850;line-height:1.5;color:var(--text-primary);word-break:break-word;">' + escapeHtml(node.label || '') + '</div>' +
        (node.subtitle ? '<div style="font-size:11px;line-height:1.6;color:var(--text-secondary);margin-top:7px;">' + escapeHtml(node.subtitle) + '</div>' : '') +
      '</div>';
      if (node.type === 'sentence' && node.point) {
        var point = node.point;
        var refs = Array.isArray(point.references) ? point.references : [];
        var sourceLabel = point.sourcePdfTitle || point.sourcePdfName || '未命名 PDF';
        var sourceLocation = [point.sourcePdfName, point.section, point.sentenceIndex ? ('S' + point.sentenceIndex) : ''].filter(Boolean).join(' · ');
        var referenceHtml = refs.length
          ? refs.slice(0, 8).map(function(ref, index) {
              var referenceTitle = ref.title || ref.raw || ref.doi || ('参考文献 ' + (index + 1));
              var referenceMeta = [ref.authors, ref.year, ref.journal, ref.doi].filter(Boolean).join(' · ');
              return '<div style="padding:8px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);margin-top:6px;">' +
                '<div style="font-size:11px;line-height:1.55;color:var(--text-primary);word-break:break-word;">' + escapeHtml(referenceTitle) + '</div>' +
                (referenceMeta ? '<div style="font-size:10px;line-height:1.5;color:var(--text-secondary);margin-top:3px;word-break:break-word;">' + escapeHtml(referenceMeta) + '</div>' : '') +
              '</div>';
            }).join('')
          : '<div style="font-size:11px;color:var(--text-secondary);margin-top:6px;">没有可展示的参考文献条目。</div>';
        return common + '<div style="padding:16px 17px;">' +
          '<div style="font-size:11px;font-weight:800;color:var(--text-primary);margin-bottom:6px;">来源论文</div>' +
          '<div style="padding:9px 10px;border-left:3px solid ' + getPdfWikiNetworkTypeColor('pdf') + ';background:var(--bg-secondary);font-size:11px;line-height:1.6;color:var(--text-primary);">' +
            '<div style="font-weight:750;word-break:break-word;">' + escapeHtml(sourceLabel) + '</div>' +
            (sourceLocation ? '<div style="font-size:10px;color:var(--text-secondary);margin-top:2px;">' + escapeHtml(sourceLocation) + '</div>' : '') +
          '</div>' +
          '<div style="font-size:11px;font-weight:800;color:var(--text-primary);margin:14px 0 6px;">原句</div>' +
          '<div style="padding:10px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-secondary);font-size:12px;line-height:1.7;color:var(--text-primary);">' + escapeHtml(point.sentence || '') + '</div>' +
          '<div style="margin-top:10px;">' + renderPdfWikiSentenceAiTopicTags(point) + '</div>' +
          '<div style="font-size:11px;color:var(--text-secondary);line-height:1.6;margin-top:10px;">' + escapeHtml(point.claimReason || '') + '</div>' +
          '<div style="font-size:11px;font-weight:800;color:var(--text-primary);margin-top:13px;">参考来源（' + refs.length + '）</div>' +
          referenceHtml +
          '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:13px;">' +
            '<button type="button" data-point-id="' + escapeHtml(point.id) + '" onclick="showPdfWikiSentenceList(this.dataset.pointId)" style="padding:7px 9px;border:1px solid #0f766e;border-radius:6px;background:#0f766e;color:white;cursor:pointer;font-size:11px;">在论点列表中查看</button>' +
            '<button type="button" data-point-id="' + escapeHtml(point.id) + '" onclick="openPdfWikiSentencePoint(this.dataset.pointId)" style="padding:7px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:11px;">展开完整详情</button>' +
          '</div>' +
        '</div>';
      }
      if (node.type === 'pdf' || node.type === 'topic' || node.type === 'reference') {
        var sentenceIds = node.sentenceIds || [];
        var extra = '';
         if (node.type === 'topic') {
           var isOnlyThisTopic = runtime.topicFilterIds.size === 1 && runtime.topicFilterIds.has(node.id);
           extra += '<button type="button" data-topic-id="' + (isOnlyThisTopic ? '' : escapeHtml(node.id)) + '" onclick="filterPdfWikiNetworkTopic(this.dataset.topicId)" style="width:100%;padding:9px 10px;border:1px solid #d97706;border-radius:7px;background:' + (isOnlyThisTopic ? 'transparent' : '#d97706') + ';color:' + (isOnlyThisTopic ? '#d97706' : '#fff') + ';cursor:pointer;font-size:11px;font-weight:800;margin-bottom:12px;">' + (isOnlyThisTopic ? '返回全部已分类主题' : '只看这个主题的网状图') + '</button>';
           if (node.topicKey && node.topicKey !== 'unclassified') {
             extra += '<button type="button" data-topic-key="' + escapeHtml(node.topicKey) + '" data-topic-label="' + escapeHtml(node.label || '') + '" onclick="showPdfWikiGraphTopicEditor(this.dataset.topicKey,this.dataset.topicLabel)" style="width:100%;padding:9px 10px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:11px;font-weight:800;margin-bottom:12px;">编辑这个主题</button>';
           }
         }
        if (node.type === 'reference' && node.reference) {
          extra = '<div style="padding:10px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-secondary);font-size:11px;line-height:1.65;color:var(--text-secondary);margin-bottom:12px;">' +
            escapeHtml([node.reference.authors, node.reference.year, node.reference.journal, node.reference.doi].filter(Boolean).join(' · ') || node.reference.raw || '') +
          '</div>';
        }
        return common + '<div style="padding:16px 17px;">' + extra +
          '<div style="font-size:11px;font-weight:800;color:var(--text-primary);margin-bottom:8px;">关联论点句（' + sentenceIds.length + '）</div>' +
          renderPdfWikiNetworkRelatedSentences(sentenceIds, 10) +
        '</div>';
      }
      if (node.type === 'entry' && node.entry) {
        var sourceNames = Array.isArray(node.entry.sourcePdfNames) ? node.entry.sourcePdfNames : [];
        return common + '<div style="padding:16px 17px;">' +
          '<div style="font-size:11px;font-weight:800;color:var(--text-primary);margin-bottom:7px;">来源 PDF</div>' +
          (sourceNames.length ? sourceNames.map(function(name) { return '<div style="font-size:11px;line-height:1.6;color:var(--text-secondary);margin-bottom:4px;">• ' + escapeHtml(name) + '</div>'; }).join('') : '<div style="font-size:11px;color:var(--text-secondary);">暂无来源信息。</div>') +
        '</div>';
      }
      return common;
    }

    function activatePdfWikiNetworkHover(event, nodeId) {
      var runtime = pdfWikiNetworkRuntime;
      var node = runtime && runtime.graphData.nodeById[nodeId];
      if (!node) return;
      if (runtime.hoverHideTimer) {
        clearTimeout(runtime.hoverHideTimer);
        runtime.hoverHideTimer = null;
      }
      runtime.hoveredNodeId = nodeId;
      setPdfWikiNetworkHoverAnimation(runtime, nodeId, true);
      if (runtime.lockedNodeId) {
        renderPdfWikiNetworkSidebar(runtime, runtime.lockedNodeId, 'selected');
      } else {
        renderPdfWikiNetworkSidebar(runtime, nodeId, 'hover');
      }
    }

    function clearPdfWikiNetworkHover(nodeId) {
      var runtime = pdfWikiNetworkRuntime;
      if (!runtime) return;
      if (runtime.hoverHideTimer) clearTimeout(runtime.hoverHideTimer);
      runtime.hoverHideTimer = setTimeout(function() {
        if (pdfWikiNetworkRuntime !== runtime || (nodeId && runtime.hoveredNodeId !== nodeId)) return;
        runtime.hoveredNodeId = '';
        setPdfWikiNetworkHoverAnimation(runtime, nodeId, false);
        if (runtime.lockedNodeId) {
          renderPdfWikiNetworkSidebar(runtime, runtime.lockedNodeId, 'selected');
        } else {
          renderPdfWikiNetworkSidebar(runtime, '', 'empty');
        }
      }, 150);
    }

    function renderPdfWikiSentenceCloudViewerLegacy(data) {
      var content = document.getElementById('pdfWikiViewerContent');
      if (!content) return;
      var sentenceCloud = data && data.sentenceCloud ? data.sentenceCloud : {};
      var points = getPdfWikiPublishableSentencePoints(sentenceCloud);
      var clouds = Array.isArray(sentenceCloud.clouds) ? sentenceCloud.clouds : [];
      var layout = buildPdfWikiSentenceCloudLayout(points, clouds);
      var legendHtml = layout.clouds.map(function(cloud) {
        return '<button type="button" onclick="highlightPdfWikiSentenceTopic(\'' + escapeHtml(cloud.topicKey || '') + '\')" ' +
          'style="display:flex;align-items:center;gap:7px;width:100%;border:0;background:transparent;color:var(--text-primary);cursor:pointer;padding:4px 2px;text-align:left;font-size:11px;line-height:1.25;">' +
            '<span style="width:9px;height:9px;border-radius:999px;background:' + escapeHtml(cloud.color || 'var(--accent-color)') + ';box-shadow:0 0 0 2px rgba(255,255,255,0.18);flex:0 0 auto;"></span>' +
            '<span style="min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(cloud.label || '主题') + '</span>' +
            '<span style="color:var(--text-secondary);flex:0 0 auto;">' + escapeHtml(cloud.sentenceCount || 0) + '</span>' +
          '</button>';
      }).join('');
      var lineHtml = renderPdfWikiSentencePointLines(points, layout.pointsById);
      var pointHtml = points.map(function(point) {
        var layoutPoint = layout.pointsById[point.id] || {};
        return renderPdfWikiSentencePoint(point, layoutPoint.color, layoutPoint);
      }).join('');
      var pdfCount = Array.from(new Set(points.map(function(point) { return point.sourcePdfId || point.sourcePdfName || ''; }).filter(Boolean))).length;
      content.innerHTML =
          '<div style="width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--bg-secondary);">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border-color);background:var(--bg-primary);">' +
            '<div style="min-width:0;">' +
              '<div style="font-size:14px;font-weight:750;color:var(--text-primary);">句子主题图（备用）</div>' +
              '<div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">所有 Introduction/Discussion/Conclusion 句子放在同一张图；颜色代表主题，同一 PDF 的句子用线连接。</div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;align-items:center;flex:0 0 auto;">' +
              '<span style="font-size:12px;color:var(--text-secondary);">句子 ' + escapeHtml(points.length) + ' · 主题 ' + escapeHtml(layout.clouds.length) + ' · PDF ' + escapeHtml(pdfCount) + '</span>' +
              '<button type="button" onclick="reloadPdfWikiViewer(pdfWikiActiveSentencePointId || pdfWikiActiveEntryId)" style="padding:7px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">刷新</button>' +
            '</div>' +
          '</div>' +
          '<div id="pdfWikiSentenceCloudCanvas" style="position:relative;flex:1;min-height:520px;margin:16px;border:1px solid var(--border-color);border-radius:8px;background:radial-gradient(circle at 22% 18%, rgba(16,163,127,0.13), transparent 32%), radial-gradient(circle at 72% 72%, rgba(13,148,136,0.11), transparent 34%), var(--bg-primary);overflow:hidden;">' +
            '<svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;">' + lineHtml + '</svg>' +
            pointHtml +
            '<div style="position:absolute;right:12px;top:12px;z-index:6;min-width:180px;max-width:260px;max-height:48%;overflow:auto;padding:10px 11px;border:1px solid var(--border-color);border-radius:8px;background:rgba(15,23,42,0.82);box-shadow:0 12px 28px rgba(0,0,0,0.28);backdrop-filter:blur(6px);">' +
              '<div style="font-size:11px;font-weight:750;color:white;margin-bottom:6px;">主题颜色</div>' +
              (legendHtml || '<div style="font-size:11px;color:var(--text-secondary);">暂无主题</div>') +
            '</div>' +
          '</div>' +
        '</div>';
    }

    function buildPdfWikiSentenceCloudLayout(points, clouds) {
      var palette = ['#0f766e', '#166534', '#15803d', '#047857', '#0d9488', '#14532d', '#065f46', '#4d7c0f', '#0e7490', '#3f6212'];
      var cloudMap = {};
      clouds.forEach(function(cloud, index) {
        var key = cloud.topicKey || ('topic-' + index);
        cloudMap[key] = Object.assign({}, cloud, {
          topicKey: key,
          color: cloud.color || palette[index % palette.length],
          sentenceCount: cloud.sentenceCount || 0
        });
      });
      points.forEach(function(point) {
        var key = point.topicKey || 'background';
        if (!cloudMap[key]) {
          cloudMap[key] = {
            id: 'cloud-' + key,
            topicKey: key,
            label: point.topicLabel || key,
            sentenceCount: 0,
            referenceCount: 0,
            color: palette[Object.keys(cloudMap).length % palette.length],
          };
        }
        cloudMap[key].sentenceCount += 1;
      });
      var normalizedClouds = Object.keys(cloudMap).map(function(key) { return cloudMap[key]; })
        .sort(function(a, b) { return (b.sentenceCount || 0) - (a.sentenceCount || 0) || String(a.label || '').localeCompare(String(b.label || ''), 'zh-CN'); });
      var cloudIndex = {};
      normalizedClouds.forEach(function(cloud, index) { cloudIndex[cloud.topicKey] = index; });
      var topicCount = Math.max(1, normalizedClouds.length);
      var cols = Math.ceil(Math.sqrt(topicCount));
      var rows = Math.ceil(topicCount / cols);
      var clusterWidth = Math.min(34, Math.max(18, 82 / cols));
      var clusterHeight = Math.min(30, Math.max(16, 72 / rows));
      var pointsById = {};

      points.forEach(function(point) {
        var key = point.topicKey || 'background';
        var index = cloudIndex[key] === undefined ? 0 : cloudIndex[key];
        var col = index % cols;
        var row = Math.floor(index / cols);
        var centerX = 9 + ((col + 0.5) * 82 / cols);
        var centerY = 12 + ((row + 0.5) * 76 / rows);
        var localX = (Number(point.x || 50) - 50) / 100;
        var localY = (Number(point.y || 50) - 50) / 100;
        var x = Math.max(4, Math.min(96, centerX + localX * clusterWidth));
        var y = Math.max(6, Math.min(94, centerY + localY * clusterHeight));
        var cloud = cloudMap[key] || normalizedClouds[0] || {};
        pointsById[point.id] = {
          x: Math.round(x * 10) / 10,
          y: Math.round(y * 10) / 10,
          color: cloud.color || 'var(--accent-color)',
          topicKey: key,
        };
      });

      return { clouds: normalizedClouds, pointsById: pointsById };
    }

    function renderPdfWikiSentencePointLines(points, pointsById) {
      var byPdf = {};
      points.forEach(function(point) {
        var key = point.sourcePdfId || point.sourcePdfName || 'unknown';
        if (!byPdf[key]) byPdf[key] = [];
        byPdf[key].push(point);
      });
      var lines = [];
      Object.keys(byPdf).forEach(function(key, pdfIndex) {
        var list = byPdf[key].slice().sort(function(a, b) {
          var sectionA = a.section === 'Discussion' ? 2 : 1;
          var sectionB = b.section === 'Discussion' ? 2 : 1;
          return sectionA - sectionB || Number(a.sentenceIndex || 0) - Number(b.sentenceIndex || 0);
        });
        for (var i = 1; i < list.length; i++) {
          var prev = pointsById[list[i - 1].id];
          var next = pointsById[list[i].id];
          if (!prev || !next) continue;
          var opacity = 0.16 + Math.min(0.12, (pdfIndex % 4) * 0.03);
          lines.push('<line x1="' + prev.x + '" y1="' + prev.y + '" x2="' + next.x + '" y2="' + next.y + '" stroke="#0f766e" stroke-width="0.32" stroke-opacity="' + opacity.toFixed(2) + '" vector-effect="non-scaling-stroke" />');
        }
      });
      return lines.join('');
    }

    function renderPdfWikiSentencePoint(point, color, layoutPoint) {
      var refs = Array.isArray(point.references) ? point.references : [];
      var radius = Math.max(9, Math.min(36, Number(point.radius || 10)));
      var left = Math.max(4, Math.min(96, Number(layoutPoint && layoutPoint.x !== undefined ? layoutPoint.x : point.x || 50)));
      var top = Math.max(5, Math.min(95, Number(layoutPoint && layoutPoint.y !== undefined ? layoutPoint.y : point.y || 50)));
      var title = (point.sentence || '') + '\n\n参考文献：' + refs.map(function(ref, index) {
        return (index + 1) + '. ' + (ref.title || ref.raw || ref.doi || ref.id || '未解析参考文献');
      }).join('\n');
      return '<button type="button" data-sentence-point-id="' + escapeHtml(point.id || '') + '" ' +
        'data-topic-key="' + escapeHtml((layoutPoint && layoutPoint.topicKey) || point.topicKey || '') + '" ' +
        'title="' + escapeHtml(title) + '" ' +
        'onmouseenter="showPdfWikiSentencePointTooltip(event,this.dataset.sentencePointId)" ' +
        'onmousemove="movePdfWikiSentencePointTooltip(event)" ' +
        'onmouseleave="hidePdfWikiSentencePointTooltip()" ' +
        'onclick="openPdfWikiSentencePoint(this.dataset.sentencePointId)" ' +
        'style="position:absolute;z-index:3;left:' + left + '%;top:' + top + '%;width:' + (radius * 2) + 'px;height:' + (radius * 2) + 'px;margin-left:-' + radius + 'px;margin-top:-' + radius + 'px;border-radius:999px;border:2px solid rgba(255,255,255,0.78);background:' + escapeHtml(color || 'var(--accent-color)') + ';box-shadow:0 8px 18px rgba(0,0,0,0.20);cursor:pointer;color:white;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;line-height:1;">' +
          escapeHtml(String(point.referenceCount || 0)) +
        '</button>';
    }

    window.scrollPdfWikiSentenceCloud = function(cloudId) {
      var el = document.getElementById('pdfWikiSentenceCloud-' + cloudId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    window.highlightPdfWikiSentenceTopic = function(topicKey) {
      var canvas = document.getElementById('pdfWikiSentenceCloudCanvas');
      if (!canvas) return;
      var buttons = canvas.querySelectorAll('button[data-sentence-point-id]');
      buttons.forEach(function(button) {
        var active = !topicKey || button.dataset.topicKey === topicKey;
        button.style.opacity = active ? '1' : '0.22';
        button.style.transform = active ? 'scale(1.08)' : 'scale(1)';
      });
      clearTimeout(window.pdfWikiSentenceTopicTimer);
      window.pdfWikiSentenceTopicTimer = setTimeout(function() {
        buttons.forEach(function(button) {
          button.style.opacity = '1';
          button.style.transform = 'scale(1)';
        });
      }, 1800);
    };

    function getPdfWikiSentencePoint(pointId) {
      var points = pdfWikiViewerData && pdfWikiViewerData.sentenceCloud && Array.isArray(pdfWikiViewerData.sentenceCloud.points)
        ? getPdfWikiPublishableSentencePoints(pdfWikiViewerData.sentenceCloud)
        : [];
      return points.find(function(point) { return point.id === pointId; }) || null;
    }

    window.showPdfWikiSentencePointTooltip = function(event, pointId) {
      var point = getPdfWikiSentencePoint(pointId);
      if (!point) return;
      var refs = Array.isArray(point.references) ? point.references : [];
      var tooltip = document.getElementById('pdfWikiSentencePointTooltip');
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'pdfWikiSentencePointTooltip';
        tooltip.style.cssText = 'position:fixed;z-index:20120;max-width:420px;padding:10px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--modal-bg);color:var(--text-primary);box-shadow:0 14px 35px rgba(0,0,0,0.28);font-size:12px;line-height:1.55;pointer-events:none;';
        document.body.appendChild(tooltip);
      }
      tooltip.innerHTML =
        '<div style="font-weight:700;margin-bottom:5px;color:var(--text-primary);">' + escapeHtml(point.topicLabel || '句子') + ' · ' + escapeHtml(point.section || '') + ' S' + escapeHtml(point.sentenceIndex || '') + '</div>' +
        '<div style="color:var(--text-primary);">' + escapeHtml(point.sentence || '') + '</div>' +
        (point.aiTopicAnnotation ? '<div style="margin-top:6px;color:var(--accent-color);">' + escapeHtml((point.aiTopicAnnotation.subjectTags || []).join(' · ')) + '</div>' : '') +
        '<div style="margin-top:7px;color:var(--text-secondary);">参考文献 ' + refs.length + ' 条 · 匹配：' + escapeHtml(point.matchMethod || 'none') + '</div>' +
        (refs.length ? '<ol style="margin:5px 0 0;padding-left:18px;color:var(--text-secondary);">' + refs.slice(0, 3).map(function(ref) {
          return '<li>' + escapeHtml([ref.authors, ref.year, ref.title || ref.raw, ref.doi].filter(Boolean).join(' · ')) + '</li>';
        }).join('') + '</ol>' : '');
      movePdfWikiSentencePointTooltip(event);
    };

    window.movePdfWikiSentencePointTooltip = function(event) {
      var tooltip = document.getElementById('pdfWikiSentencePointTooltip');
      if (!tooltip) return;
      var x = Math.min(window.innerWidth - 440, event.clientX + 16);
      var y = Math.min(window.innerHeight - 220, event.clientY + 16);
      tooltip.style.left = Math.max(12, x) + 'px';
      tooltip.style.top = Math.max(12, y) + 'px';
    };

    window.hidePdfWikiSentencePointTooltip = function() {
      var tooltip = document.getElementById('pdfWikiSentencePointTooltip');
      if (tooltip) tooltip.remove();
    };

    window.openPdfWikiSentencePoint = function(pointId) {
      var point = getPdfWikiSentencePoint(pointId);
      if (!point) return;
      hidePdfWikiSentencePointTooltip();
      var refs = Array.isArray(point.references) ? point.references : [];
      var refHtml = refs.length
        ? '<ol style="margin:8px 0 0;padding-left:20px;line-height:1.65;color:var(--text-secondary);">' + refs.map(function(ref) {
            return '<li>' +
              '<div style="color:var(--text-primary);font-weight:700;">' + escapeHtml(ref.title || ref.raw || ref.id || '未解析参考文献') + '</div>' +
              '<div>' + escapeHtml([ref.authors, ref.year, ref.journal].filter(Boolean).join(' · ')) + '</div>' +
              (ref.doi ? '<div>DOI：' + escapeHtml(ref.doi) + '</div>' : '') +
              (ref.raw && ref.raw !== ref.title ? '<div style="margin-top:5px;padding:7px 8px;border-left:2px solid var(--border-color);background:var(--bg-secondary);color:var(--text-secondary);font-size:11px;line-height:1.55;">文末原始条目：' + escapeHtml(ref.raw) + '</div>' : '') +
              '<div>匹配方式：' + escapeHtml(ref.matchType || point.matchMethod || 'unknown') + (ref.matchScore ? ' · 分数 ' + escapeHtml(ref.matchScore) : '') + '</div>' +
            '</li>';
          }).join('') + '</ol>'
        : '<div style="color:var(--text-secondary);">该句未匹配到参考文献。</div>';
      showModal('句子论点详情',
        '<div style="display:flex;flex-direction:column;gap:12px;">' +
          '<div style="font-size:12px;color:var(--accent-color);">' + escapeHtml(point.sourcePdfName || '') + ' · ' + escapeHtml(point.section || '') + ' S' + escapeHtml(point.sentenceIndex || '') + ' · ' + escapeHtml(point.topicLabel || '') + '</div>' +
          '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
            '<span style="font-size:12px;padding:3px 8px;border-radius:999px;background:rgba(16,163,127,0.14);color:var(--accent-color);">可作为论点</span>' +
            '<span style="font-size:12px;color:var(--text-secondary);">' + escapeHtml(getPdfWikiSentenceClaimTypeLabel(point.claimType)) + '</span>' +
          '</div>' +
          renderPdfWikiSentenceAiTopicTags(point) +
          (point.claimText ? '<div style="font-size:15px;font-weight:800;line-height:1.55;color:var(--text-primary);">' + escapeHtml(point.claimText) + '</div>' : '') +
          '<div style="padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);font-size:14px;line-height:1.7;color:var(--text-primary);">' + escapeHtml(point.sentence || '') + '</div>' +
          '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">' + escapeHtml(point.claimReason || '系统根据句子表达、章节位置和引用关系判定为可作论点。') + '</div>' +
          '<div style="font-size:13px;font-weight:700;color:var(--text-primary);">对应参考文献</div>' +
          refHtml +
          '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">参考文献只来自句中或句末显式引用与文末 References 的核验匹配；没有显式引用的句子不会按语义猜测参考文献。</div>' +
          '<div class="btns"><button class="ok" onclick="closeModal()">关闭</button></div>' +
        '</div>',
        true
      );
    };

    function getPdfWikiSelectedEntryIds() {
      return Object.keys(pdfWikiSelectedEntryIds).filter(function(id) { return pdfWikiSelectedEntryIds[id]; });
    }

    function getPdfWikiEntriesByIds(entryIds) {
      var entries = pdfWikiViewerData && Array.isArray(pdfWikiViewerData.entries) ? pdfWikiViewerData.entries : [];
      var entryMap = {};
      entries.forEach(function(entry) { entryMap[entry.id] = entry; });
      return entryIds.map(function(id) { return entryMap[id]; }).filter(Boolean);
    }

    function updatePdfWikiSelectionControls() {
      var count = getPdfWikiSelectedEntryIds().length;
      var countEl = document.getElementById('pdfWikiSelectedCount');
      var deleteButton = document.getElementById('pdfWikiDeleteButton');
      var mergeButton = document.getElementById('pdfWikiMergeButton');
      if (countEl) countEl.textContent = '已选择 ' + count + ' 个论点';
      if (deleteButton) deleteButton.disabled = count === 0;
      if (mergeButton) mergeButton.disabled = count < 2;
    }

    function updatePdfWikiEntryListActive(entryId) {
      var buttons = document.querySelectorAll('#pdfWikiEntryList button[data-entry-card="1"]');
      buttons.forEach(function(button) {
        var active = button.dataset.entryId === entryId;
        button.style.borderColor = active ? 'var(--accent-color)' : 'var(--border-color)';
        button.style.background = active ? 'rgba(16,163,127,0.12)' : 'var(--bg-secondary)';
      });
    }

    window.togglePdfWikiEntrySelection = function(entryId, selected) {
      if (!entryId) return;
      if (selected) {
        pdfWikiSelectedEntryIds[entryId] = true;
      } else {
        delete pdfWikiSelectedEntryIds[entryId];
      }
      updatePdfWikiSelectionControls();
    };

    window.selectAllVisiblePdfWikiEntries = function() {
      var checkboxes = document.querySelectorAll('#pdfWikiEntryList input[type="checkbox"][data-entry-id]');
      checkboxes.forEach(function(checkbox) {
        pdfWikiSelectedEntryIds[checkbox.dataset.entryId] = true;
        checkbox.checked = true;
      });
      updatePdfWikiSelectionControls();
    };

    window.clearPdfWikiEntrySelection = function() {
      pdfWikiSelectedEntryIds = {};
      var checkboxes = document.querySelectorAll('#pdfWikiEntryList input[type="checkbox"][data-entry-id]');
      checkboxes.forEach(function(checkbox) { checkbox.checked = false; });
      updatePdfWikiSelectionControls();
    };

    window.togglePdfWikiEntryFavorite = async function(entryId, event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (!entryId || !pdfWikiViewerData) return;
      var entries = Array.isArray(pdfWikiViewerData.entries) ? pdfWikiViewerData.entries : [];
      var entry = entries.find(function(item) { return item.id === entryId; });
      if (!entry) return;
      var nextFavorite = !Boolean(entry.favorite);

      try {
        var response = await fetch('/api/pdf-wiki/entries/favorite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, entryId: entryId, favorite: nextFavorite })
        });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '收藏失败');
        }
        entries.forEach(function(item) {
          if (item.id === entryId) item.favorite = result.favorite;
        });
        pdfWikiViewerData.favoriteEntryIds = result.favoriteIds || [];
        renderPdfWikiViewer(pdfWikiViewerData, pdfWikiActiveEntryId || entryId);
      } catch (e) {
        alert('收藏失败：' + e.message);
      }
    };

    function applyPdfWikiViewerData(data, selectedEntryId, shouldRender) {
      var availableIds = {};
      (data.entries || []).forEach(function(entry) { availableIds[entry.id] = true; });
      Object.keys(pdfWikiSelectedEntryIds).forEach(function(id) {
        if (!availableIds[id]) delete pdfWikiSelectedEntryIds[id];
      });
      var sentencePoints = getPdfWikiPublishableSentencePoints(data.sentenceCloud || {});
      var availablePointIds = {};
      sentencePoints.forEach(function(point) { availablePointIds[point.id] = true; });
      Object.keys(pdfWikiSelectedSentencePointIds).forEach(function(id) {
        if (!availablePointIds[id]) delete pdfWikiSelectedSentencePointIds[id];
      });
      if (pdfWikiActiveSentencePointId && !availablePointIds[pdfWikiActiveSentencePointId]) {
        pdfWikiActiveSentencePointId = null;
      }
      var nextSelectedId = sentencePoints.length > 0
        ? (availablePointIds[selectedEntryId] ? selectedEntryId : (pdfWikiActiveSentencePointId || sentencePoints[0].id))
        : (selectedEntryId || (data.entries && data.entries[0] ? data.entries[0].id : null));
      if (shouldRender !== false) renderPdfWikiViewer(data, nextSelectedId);
      return nextSelectedId;
    }

    async function reloadPdfWikiViewer(selectedEntryId) {
      var data = await fetchPdfWikiViewerEntries(false);
      rememberPdfWikiViewerData(data);
      return applyPdfWikiViewerData(data, selectedEntryId, true);
    }

    window.showPdfWikiPdfManager = async function(options) {
      updateAcademicWorkflowOverviewReturn(options);
      var managerRenderOptions = {
        scrollTop: options && Number.isFinite(Number(options.scrollTop))
          ? Math.max(0, Number(options.scrollTop))
          : getPdfWikiPdfManagerScrollTop(),
        focusPdfId: options && options.focusPdfId ? String(options.focusPdfId) : ''
      };
      setPdfWikiWorkspaceMode('pdf-manager');
      cleanupPdfWikiReaderRuntime();
      pdfWikiOriginalReaderPdfId = null;
      if (!document.getElementById('pdfWikiViewerModal')) {
        await window.showPdfWikiViewer({
          initialTitle: 'PDF管理',
          initialSubtitle: '正在读取 PDF 管理...',
          initialLoadingText: '正在读取 PDF 管理...',
          workflowActiveKey: 'pdf-manager',
          skipInitialLoad: true
        });
      }
      setPdfWikiViewerWorkflowActions('pdf-manager');
      var content = document.getElementById('pdfWikiViewerContent');
      var title = document.getElementById('pdfWikiViewerTitle');
      var subtitle = document.getElementById('pdfWikiViewerSubtitle');
      if (title) title.textContent = 'PDF管理';
      var cacheScope = getPdfWikiMetaCacheScopeKey();
      if (pdfWikiPdfManagerCacheScope && pdfWikiPdfManagerCacheScope !== cacheScope) {
        pdfWikiPdfManagerData = null;
        pdfWikiDeepAnalysisResults = {};
      }
      if (pdfWikiPdfManagerData && Array.isArray(pdfWikiPdfManagerData.pdfs)) {
        renderPdfWikiPdfManager(pdfWikiPdfManagerData, managerRenderOptions);
        refreshPdfWikiRecognitionQueueStatus().catch(function(error) {
          console.warn('[PdfWikiRecognitionQueue] 恢复队列进度失败:', error);
        });
        reloadPdfWikiPdfManager(managerRenderOptions).catch(function(error) {
          console.warn('[PdfWiki] PDF 管理后台刷新失败:', error);
        });
        return;
      }
      if (subtitle) subtitle.textContent = '正在读取 PDF 管理...';
      if (content) {
        content.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:13px;">正在读取 PDF 管理...</div>';
      }
      await reloadPdfWikiPdfManager(managerRenderOptions);
      refreshPdfWikiRecognitionQueueStatus().catch(function(error) {
        console.warn('[PdfWikiRecognitionQueue] 读取队列进度失败:', error);
      });
    };

    async function loadPdfWikiPdfManagerDataOnly() {
      var response = await fetch('/api/pdf-wiki/pdfs?userId=' + encodeURIComponent(currentUserId));
      var data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || '读取 PDF 管理失败');
      }
      pdfWikiPdfManagerData = data;
      pdfWikiPdfManagerCacheScope = getPdfWikiMetaCacheScopeKey();
      return data;
    }

    async function reloadPdfWikiPdfManager(options) {
      var data = await loadPdfWikiPdfManagerDataOnly();
      renderPdfWikiPdfManager(data, options || {});
    }

    function getPdfWikiMetaCacheScopeKey() {
      var projectId = projectManagerCurrentProject && projectManagerCurrentProject.id
        ? String(projectManagerCurrentProject.id)
        : 'default-project';
      return String(currentUserId || 'web-user') + '::' + projectId;
    }

    function getPdfWikiMetaDetailCache() {
      var scopeKey = getPdfWikiMetaCacheScopeKey();
      if (!pdfWikiMetaDetailCacheByScope[scopeKey]) pdfWikiMetaDetailCacheByScope[scopeKey] = {};
      return pdfWikiMetaDetailCacheByScope[scopeKey];
    }

    function rememberPdfWikiMetaDatabase(data) {
      if (!data || !Array.isArray(data.items)) return;
      pdfWikiMetaDatabaseCacheByScope[getPdfWikiMetaCacheScopeKey()] = data;
    }

    function mergePdfWikiMetaCachedDetails(data) {
      if (!data || !Array.isArray(data.items)) return data;
      var detailCache = getPdfWikiMetaDetailCache();
      var generatedAt = String(data.generatedAt || '');
      data.items = data.items.map(function(item) {
        var cached = detailCache[item.pdfId];
        if (!cached || cached.generatedAt !== generatedAt || !cached.detail) return item;
        return Object.assign({}, item, cached.detail, { detailLoaded: true, detailLoading: false });
      });
      return data;
    }

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('pdf-wiki-core', { source: '/app/pdf-wiki-core.js' });
}
