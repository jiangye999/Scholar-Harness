function formatPdfWikiFileSize(size) {
      var value = Number(size || 0);
      if (!Number.isFinite(value) || value <= 0) return '未知大小';
      if (value >= 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + ' MB';
      if (value >= 1024) return Math.round(value / 1024) + ' KB';
      return value + ' B';
    }

    function getPdfWikiGroupName(groupId) {
      var groups = pdfWikiPdfManagerData && Array.isArray(pdfWikiPdfManagerData.groups) ? pdfWikiPdfManagerData.groups : [];
      var group = groups.find(function(item) { return item.id === groupId; });
      return group ? group.name : '未分组';
    }

    function getPdfWikiPdfFavoriteIds() {
      return pdfWikiPdfManagerData && Array.isArray(pdfWikiPdfManagerData.favoritePdfIds)
        ? pdfWikiPdfManagerData.favoritePdfIds.map(String)
        : [];
    }

    function isPdfWikiManagedPdfFavorite(pdf) {
      if (!pdf) return false;
      if (typeof pdf.favorite === 'boolean') return pdf.favorite;
      return getPdfWikiPdfFavoriteIds().indexOf(String(pdf.id || '')) !== -1;
    }

    function setPdfWikiManagedPdfFavoriteValue(pdfId, favorite, favoriteIds) {
      if (!pdfWikiPdfManagerData) return;
      var key = String(pdfId || '');
      if (Array.isArray(favoriteIds)) {
        pdfWikiPdfManagerData.favoritePdfIds = favoriteIds.map(String);
      } else {
        var ids = {};
        getPdfWikiPdfFavoriteIds().forEach(function(id) { ids[id] = true; });
        if (favorite) ids[key] = true;
        else delete ids[key];
        pdfWikiPdfManagerData.favoritePdfIds = Object.keys(ids);
      }
      if (Array.isArray(pdfWikiPdfManagerData.pdfs)) {
        pdfWikiPdfManagerData.pdfs.forEach(function(pdf) {
          if (String(pdf.id || '') === key) pdf.favorite = !!favorite;
        });
      }
    }

    function renderPdfWikiPdfFavoriteButton(pdfId, favorite) {
      var title = favorite ? '取消收藏 PDF' : '收藏 PDF';
      return '<button id="pdfWikiPdfFavoriteBtn-' + getPdfWikiDomIdPart(pdfId) + '" type="button" title="' + title + '" aria-label="' + title + '" data-pdf-id="' + escapeHtml(pdfId || '') + '" onclick="togglePdfWikiPdfFavorite(this.dataset.pdfId,event)" ' +
        'style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:1px solid ' + (favorite ? '#f59e0b' : 'var(--border-color)') + ';border-radius:6px;background:' + (favorite ? 'rgba(245,158,11,0.14)' : 'var(--bg-secondary)') + ';color:' + (favorite ? '#d97706' : 'var(--text-secondary)') + ';font-size:18px;line-height:1;cursor:pointer;">' + (favorite ? '★' : '☆') + '</button>';
    }

    function refreshPdfWikiPdfFavoriteStatsInline() {
      if (!pdfWikiPdfManagerData || !Array.isArray(pdfWikiPdfManagerData.pdfs)) return;
      var pdfs = pdfWikiPdfManagerData.pdfs;
      var groups = Array.isArray(pdfWikiPdfManagerData.groups) ? pdfWikiPdfManagerData.groups : [];
      var favoritePdfCount = pdfs.filter(function(pdf) { return isPdfWikiManagedPdfFavorite(pdf); }).length;
      var subtitle = document.getElementById('pdfWikiViewerSubtitle');
      if (subtitle && pdfWikiWorkspaceMode === 'pdf-manager') {
        subtitle.textContent = 'PDF 管理：' + pdfs.length + ' 个 PDF，收藏 ' + favoritePdfCount + ' 个，' + groups.length + ' 个分组';
      }
      var favoriteCount = document.getElementById('pdfWikiPdfGroupCount-' + getPdfWikiDomIdPart(PDF_WIKI_PDF_FAVORITES_GROUP_ID));
      if (favoriteCount) favoriteCount.textContent = String(favoritePdfCount);
    }

    function refreshPdfWikiPdfManagerStatsInline() {
      if (!pdfWikiPdfManagerData || !Array.isArray(pdfWikiPdfManagerData.pdfs)) return;
      var pdfs = pdfWikiPdfManagerData.pdfs;
      var groups = Array.isArray(pdfWikiPdfManagerData.groups) ? pdfWikiPdfManagerData.groups : [];
      var favoritePdfCount = pdfs.filter(function(pdf) { return isPdfWikiManagedPdfFavorite(pdf); }).length;
      var subtitle = document.getElementById('pdfWikiViewerSubtitle');
      if (subtitle && pdfWikiWorkspaceMode === 'pdf-manager') {
        subtitle.textContent = 'PDF 管理：' + pdfs.length + ' 个 PDF，收藏 ' + favoritePdfCount + ' 个，' + groups.length + ' 个分组';
      }
      var counts = {};
      counts[PDF_WIKI_PDF_FAVORITES_GROUP_ID] = favoritePdfCount;
      counts.all = pdfs.length;
      counts.ungrouped = pdfs.filter(function(pdf) { return getPdfWikiPdfGroupIds(pdf).length === 0; }).length;
      groups.forEach(function(group) {
        counts[group.id] = pdfs.filter(function(pdf) { return getPdfWikiPdfGroupIds(pdf).indexOf(group.id) !== -1; }).length;
      });
      Object.keys(counts).forEach(function(groupId) {
        var countEl = document.getElementById('pdfWikiPdfGroupCount-' + getPdfWikiDomIdPart(groupId));
        if (countEl) countEl.textContent = String(counts[groupId]);
      });
    }

    function getPdfWikiPdfGroupIds(pdf) {
      if (Array.isArray(pdf && pdf.groupIds)) return pdf.groupIds.filter(Boolean);
      return pdf && pdf.groupId ? [pdf.groupId] : [];
    }

    function setPdfWikiPdfGroupIds(pdfId, groupIds) {
      var pdf = getPdfWikiPdfById(pdfId);
      if (!pdf) return;
      var normalized = Array.from(new Set((Array.isArray(groupIds) ? groupIds : []).map(String).filter(Boolean)));
      pdf.groupIds = normalized;
      pdf.groupId = normalized[0] || '';
    }

    function getPdfWikiPdfGroupNames(pdf) {
      var groupIds = getPdfWikiPdfGroupIds(pdf);
      if (groupIds.length === 0) return '未分组';
      return groupIds.map(getPdfWikiGroupName).filter(Boolean).join('、') || '未分组';
    }

    function getPdfWikiSelectedPdfIds() {
      return Object.keys(pdfWikiSelectedPdfIds).filter(function(id) { return !!pdfWikiSelectedPdfIds[id]; });
    }

    function getPdfWikiPdfById(pdfId) {
      var pdfs = pdfWikiPdfManagerData && Array.isArray(pdfWikiPdfManagerData.pdfs) ? pdfWikiPdfManagerData.pdfs : [];
      return pdfs.find(function(pdf) { return pdf.id === pdfId; }) || null;
    }

    function getPdfWikiDomIdPart(value) {
      return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'pdf';
    }

    function getPdfWikiPdfManagerScrollTop() {
      var scroller = document.getElementById('pdfWikiPdfManagerScroll');
      return scroller ? scroller.scrollTop : 0;
    }

    function rememberPdfWikiMetaListScroll(scroller) {
      if (!scroller) return;
      var top = Number(scroller.scrollTop || 0);
      if (Number.isFinite(top)) pdfWikiMetaListScrollTop = top;
    }
    window.rememberPdfWikiMetaListScroll = rememberPdfWikiMetaListScroll;

    function getPdfWikiMetaListScrollTop() {
      return Number.isFinite(Number(pdfWikiMetaListScrollTop)) ? Number(pdfWikiMetaListScrollTop) : 0;
    }

    function restorePdfWikiMetaListScroll(scrollTop) {
      if (!Number.isFinite(Number(scrollTop))) return;
      var top = Math.max(0, Number(scrollTop));
      pdfWikiMetaListScrollTop = top;
      setTimeout(function() {
        var scroller = document.getElementById('pdfWikiMetaListScroll');
        if (!scroller) return;
        var maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.scrollTop = Math.min(top, maxScrollTop);
      }, 0);
    }

    function getPdfWikiMetaDetailScrollTop() {
      var scroller = document.getElementById('pdfWikiMetaDetailScroll');
      return scroller ? scroller.scrollTop : 0;
    }

    function getPdfWikiMetaCodingTableScrollState() {
      var scroller = document.getElementById('pdfWikiMetaCodingTableScroll');
      return scroller ? { top: scroller.scrollTop, left: scroller.scrollLeft } : { top: 0, left: 0 };
    }

    function restorePdfWikiMetaDetailScroll(scrollTop) {
      if (!Number.isFinite(Number(scrollTop))) return;
      setTimeout(function() {
        var scroller = document.getElementById('pdfWikiMetaDetailScroll');
        if (!scroller) return;
        var maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.scrollTop = Math.min(Number(scrollTop), maxScrollTop);
      }, 0);
    }

    function restorePdfWikiMetaCodingTableScroll(state) {
      state = state || {};
      var top = Number(state.top || 0);
      var left = Number(state.left || 0);
      if (!Number.isFinite(top) && !Number.isFinite(left)) return;
      setTimeout(function() {
        var scroller = document.getElementById('pdfWikiMetaCodingTableScroll');
        if (!scroller) return;
        if (Number.isFinite(top)) {
          var maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          scroller.scrollTop = Math.min(top, maxTop);
        }
        if (Number.isFinite(left)) {
          var maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
          scroller.scrollLeft = Math.min(left, maxLeft);
        }
      }, 0);
    }

    function restorePdfWikiPdfManagerScroll(scrollTop) {
      if (!Number.isFinite(Number(scrollTop))) return;
      setTimeout(function() {
        var scroller = document.getElementById('pdfWikiPdfManagerScroll');
        if (scroller) scroller.scrollTop = Number(scrollTop);
      }, 0);
    }

    function restorePdfWikiPdfManagerReturnTarget(scrollTop, pdfId) {
      restorePdfWikiPdfManagerScroll(scrollTop);
      var targetId = String(pdfId || '').trim();
      if (!targetId) return;
      setTimeout(function() {
        var target = document.getElementById('pdfWikiPdfCard-' + getPdfWikiDomIdPart(targetId));
        if (!target) return;
        if (!Number.isFinite(Number(scrollTop))) {
          target.scrollIntoView({ block: 'center', behavior: 'auto' });
        }
        target.classList.remove('pdf-wiki-manager-return-target');
        void target.offsetWidth;
        target.classList.add('pdf-wiki-manager-return-target');
        setTimeout(function() {
          if (target && target.classList) target.classList.remove('pdf-wiki-manager-return-target');
        }, 1800);
      }, 0);
    }

    function renderPdfWikiPdfManagerPreservingScroll() {
      if (!pdfWikiPdfManagerData) return;
      renderPdfWikiPdfManager(pdfWikiPdfManagerData, { scrollTop: getPdfWikiPdfManagerScrollTop() });
    }

    function encodePdfWikiSvgDataUri(svg) {
      var value = String(svg || '');
      if (!value) return '';
      try {
        var bytes = new TextEncoder().encode(value);
        var binary = '';
        for (var i = 0; i < bytes.length; i += 0x8000) {
          var chunk = bytes.subarray(i, i + 0x8000);
          binary += String.fromCharCode.apply(null, Array.from(chunk));
        }
        return 'data:image/svg+xml;base64,' + btoa(binary);
      } catch (e) {
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(value);
      }
    }

    function sanitizePdfWikiInlineSvg(svg) {
      var match = String(svg || '').match(/<svg\b[\s\S]*<\/svg>/i);
      if (!match) return '';
      var cleaned = match[0]
        .replace(/<\?xml[\s\S]*?\?>/gi, '')
        .replace(/<!doctype[\s\S]*?>/gi, '')
        .replace(/<script\b[\s\S]*?<\/script>/gi, '')
        .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '')
        .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/\s+(?:href|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '')
        .replace(/\s+(?:href|xlink:href)\s*=\s*(?:"\s*https?:\/\/[^"]*"|'\s*https?:\/\/[^']*')/gi, '');
      if (!/\sxmlns=/.test(cleaned.slice(0, 300))) {
        cleaned = cleaned.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      return cleaned;
    }

    function scopePdfWikiInlineSvgIds(svg, scopeHint) {
      var cleaned = String(svg || '');
      var suffix = String(scopeHint || ('svg' + (++pdfWikiInlineSvgRenderSeq)))
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 90) || ('svg' + (++pdfWikiInlineSvgRenderSeq));
      var idMap = {};
      cleaned = cleaned.replace(/\sid=(["'])([^"']+)\1/g, function(match, quote, id) {
        if (!idMap[id]) idMap[id] = id + '__' + suffix;
        return ' id=' + quote + idMap[id] + quote;
      });
      Object.keys(idMap).forEach(function(id) {
        var escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        cleaned = cleaned.replace(new RegExp('url\\(\\s*#' + escaped + '\\s*\\)', 'g'), 'url(#' + idMap[id] + ')');
        cleaned = cleaned.replace(new RegExp('((?:href|xlink:href)\\s*=\\s*["\\\'])#' + escaped + '(["\\\'])', 'g'), '$1#' + idMap[id] + '$2');
      });
      return cleaned;
    }

    function renderPdfWikiInlineSvg(svg, maxWidth, scopeHint) {
      var cleaned = sanitizePdfWikiInlineSvg(svg);
      if (!cleaned) return '';
      cleaned = scopePdfWikiInlineSvgIds(cleaned, scopeHint);
      var frameStyle = 'display:block;width:100%;max-width:' + (maxWidth || 1180) + 'px;height:auto;margin:0 auto;border:1px solid rgba(15,23,42,0.08);border-radius:8px;background:white;';
      if (/<svg\b[^>]*\sstyle\s*=/i.test(cleaned.slice(0, 1200))) {
        cleaned = cleaned.replace(/(<svg\b[^>]*\sstyle\s*=\s*)(["'])([^"']*)\2/i, function(_match, prefix, quote, style) {
          return prefix + quote + style + ';' + frameStyle + quote;
        });
      } else {
        cleaned = cleaned.replace(/<svg\b/i, '<svg style="' + frameStyle + '"');
      }
      return cleaned;
    }

    function renderPdfWikiOverviewDiagram(diagram, pdfId) {
      if (!diagram || !diagram.svg) return '';
      var inlineSvg = renderPdfWikiInlineSvg(diagram.svg, 1180, 'inline-' + (pdfId || '') + '-' + (++pdfWikiInlineSvgRenderSeq));
      if (!inlineSvg) return '';
      var engineLabel = diagram.engine === 'codex' ? 'Codex 生成' : (diagram.engine === 'secondary-api' ? '小牛马生成' : '代码绘制');
      if (diagram.layoutVersion && Number(diagram.layoutVersion) >= 3) engineLabel += ' · 流程图优化';
      return '<div style="margin-bottom:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);overflow:hidden;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border-color);">' +
          '<div style="font-size:13px;font-weight:700;color:var(--text-primary);">论文一览图</div>' +
          '<div style="font-size:11px;color:var(--text-secondary);">' + escapeHtml(engineLabel) + '</div>' +
        '</div>' +
        '<div style="padding:12px;overflow:auto;background:#f8fafc;">' +
          inlineSvg +
        '</div>' +
      '</div>';
    }

    function renderRightSidebarPdfOverviewPanel() {
      var panel = document.getElementById('rightSidebarPdfOverviewPanel');
      if (!panel) return;
      var state = rightSidebarPdfOverviewState;
      var isImage = !!(state && state.kind === 'image');
      if (!state || (isImage ? !state.src : !state.svg)) {
        panel.innerHTML = '<div style="padding:18px;color:var(--text-secondary);font-size:12px;">当前没有打开的 PDF 图片或论文一览图。</div>';
        return;
      }
      var zoom = clampRightSidebarPdfPreviewZoom(Number(state.zoom || 1), state);
      state.zoom = zoom;
      var previewContent = isImage
        ? '<img class="right-sidebar-pdf-figure-image" alt="' + escapeHtml(state.description || state.title || 'PDF 图片') + '" src="' + escapeHtml(state.src) + '" draggable="false" onload="syncRightSidebarPdfOverviewPanAffordance()">'
        : renderPdfWikiInlineSvg(
            state.svg,
            1180,
            'right-sidebar-overview-' + String(state.pdfId || '') + '-' + (++pdfWikiInlineSvgRenderSeq)
          );
      var infoHtml = isImage
        ? '<div class="right-sidebar-pdf-preview-info">' +
            '<strong>' + escapeHtml(state.description || state.title || 'PDF 图片') + '</strong>' +
            (state.meta ? '<div>' + escapeHtml(state.meta) + '</div>' : '') +
            (state.caption && state.caption !== state.description ? '<div style="margin-top:4px;white-space:pre-wrap;">' + escapeHtml(state.caption) + '</div>' : '') +
          '</div>'
        : '';
      panel.innerHTML =
        '<div class="right-sidebar-pdf-overview-toolbar">' +
          '<div class="right-sidebar-pdf-overview-zoom-tools">' +
            '<span>滚轮缩放 · 左/右键拖动</span>' +
            '<span id="rightSidebarPdfOverviewZoomStatus">' + Math.round(zoom * 100) + '%</span>' +
            '<button type="button" class="right-sidebar-pdf-overview-reset" onclick="resetRightSidebarPdfOverviewZoom()">复位</button>' +
          '</div>' +
          '<button type="button" class="right-sidebar-pdf-overview-close" onclick="closeRightSidebarPdfOverview()">关闭</button>' +
        '</div>' +
        infoHtml +
        '<div id="rightSidebarPdfOverviewViewport" class="right-sidebar-pdf-overview-viewport" onwheel="handleRightSidebarPdfOverviewWheel(event)" title="滚轮向上放大，向下缩小">' +
          '<div id="rightSidebarPdfOverviewStage" class="right-sidebar-pdf-overview-stage" style="width:' + (zoom * 100) + '%;margin:' + (zoom <= 1 ? '0 auto' : '0') + ';">' +
            (previewContent || '<div style="padding:18px;color:var(--danger-color);">PDF 图片无法显示，请重新提取后再试。</div>') +
          '</div>' +
        '</div>';
      setupRightSidebarPdfOverviewPan();
    }
    window.renderRightSidebarPdfOverviewPanel = renderRightSidebarPdfOverviewPanel;

    function clampRightSidebarPdfPreviewZoom(value, state) {
      var zoom = Number(value);
      if (!Number.isFinite(zoom)) zoom = 1;
      var minZoom = state && state.kind === 'image' ? 0.25 : 0.4;
      var maxZoom = state && state.kind === 'image' ? 8 : 5;
      return Math.max(minZoom, Math.min(maxZoom, zoom));
    }

    function applyRightSidebarPdfOverviewZoom(zoom) {
      if (!rightSidebarPdfOverviewState) return;
      var nextZoom = clampRightSidebarPdfPreviewZoom(zoom, rightSidebarPdfOverviewState);
      rightSidebarPdfOverviewState.zoom = nextZoom;
      var stage = document.getElementById('rightSidebarPdfOverviewStage');
      var status = document.getElementById('rightSidebarPdfOverviewZoomStatus');
      if (stage) {
        stage.style.width = (nextZoom * 100) + '%';
        stage.style.margin = nextZoom <= 1 ? '0 auto' : '0';
      }
      if (status) status.textContent = Math.round(nextZoom * 100) + '%';
      requestAnimationFrame(syncRightSidebarPdfOverviewPanAffordance);
    }

    function syncRightSidebarPdfOverviewPanAffordance() {
      var viewport = document.getElementById('rightSidebarPdfOverviewViewport');
      if (!viewport) return false;
      var canPan = viewport.scrollWidth > viewport.clientWidth + 1
        || viewport.scrollHeight > viewport.clientHeight + 1;
      viewport.classList.toggle('is-pannable', canPan);
      if (!canPan) viewport.classList.remove('is-panning');
      return canPan;
    }
    window.syncRightSidebarPdfOverviewPanAffordance = syncRightSidebarPdfOverviewPanAffordance;

    function setupRightSidebarPdfOverviewPan() {
      var viewport = document.getElementById('rightSidebarPdfOverviewViewport');
      if (!viewport || viewport.dataset.buttonPanBound === '1') return;
      viewport.dataset.buttonPanBound = '1';
      var activePointerId = null;
      var activeButtonMask = 0;
      var lastClientX = 0;
      var lastClientY = 0;

      function finishPan(event) {
        if (activePointerId === null) return;
        if (event && event.pointerId !== undefined && event.pointerId !== activePointerId) return;
        try {
          if (viewport.hasPointerCapture && viewport.hasPointerCapture(activePointerId)) {
            viewport.releasePointerCapture(activePointerId);
          }
        } catch (error) {}
        activePointerId = null;
        activeButtonMask = 0;
        viewport.classList.remove('is-panning');
        syncRightSidebarPdfOverviewPanAffordance();
      }

      viewport.addEventListener('pointerdown', function(event) {
        if (event.button !== 0 && event.button !== 2) return;
        if (!syncRightSidebarPdfOverviewPanAffordance()) return;
        event.preventDefault();
        event.stopPropagation();
        activePointerId = event.pointerId;
        activeButtonMask = event.button === 2 ? 2 : 1;
        lastClientX = event.clientX;
        lastClientY = event.clientY;
        viewport.classList.add('is-panning');
        try { viewport.setPointerCapture(event.pointerId); } catch (error) {}
      });

      viewport.addEventListener('pointermove', function(event) {
        if (activePointerId === null || event.pointerId !== activePointerId) return;
        if ((event.buttons & activeButtonMask) !== activeButtonMask) {
          finishPan(event);
          return;
        }
        var deltaX = event.clientX - lastClientX;
        var deltaY = event.clientY - lastClientY;
        lastClientX = event.clientX;
        lastClientY = event.clientY;
        viewport.scrollLeft -= deltaX;
        viewport.scrollTop -= deltaY;
        event.preventDefault();
      });
      viewport.addEventListener('pointerup', finishPan);
      viewport.addEventListener('pointercancel', finishPan);
      viewport.addEventListener('lostpointercapture', finishPan);
      viewport.addEventListener('contextmenu', function(event) {
        event.preventDefault();
      });
      requestAnimationFrame(syncRightSidebarPdfOverviewPanAffordance);
    }
    window.setupRightSidebarPdfOverviewPan = setupRightSidebarPdfOverviewPan;

    function handleRightSidebarPdfOverviewWheel(event) {
      if (!rightSidebarPdfOverviewState || !event) return;
      event.preventDefault();
      event.stopPropagation();
      var viewport = document.getElementById('rightSidebarPdfOverviewViewport');
      if (!viewport) return;
      var oldZoom = clampRightSidebarPdfPreviewZoom(rightSidebarPdfOverviewState.zoom || 1, rightSidebarPdfOverviewState);
      var zoomFactor = event.deltaY < 0 ? 1.12 : (1 / 1.12);
      var nextZoom = clampRightSidebarPdfPreviewZoom(oldZoom * zoomFactor, rightSidebarPdfOverviewState);
      if (Math.abs(nextZoom - oldZoom) < 0.001) return;
      var rect = viewport.getBoundingClientRect();
      var pointerX = Math.max(0, event.clientX - rect.left);
      var pointerY = Math.max(0, event.clientY - rect.top);
      var contentX = viewport.scrollLeft + pointerX;
      var contentY = viewport.scrollTop + pointerY;
      var scaleRatio = nextZoom / oldZoom;
      applyRightSidebarPdfOverviewZoom(nextZoom);
      requestAnimationFrame(function() {
        viewport.scrollLeft = Math.max(0, contentX * scaleRatio - pointerX);
        viewport.scrollTop = Math.max(0, contentY * scaleRatio - pointerY);
      });
    }
    window.handleRightSidebarPdfOverviewWheel = handleRightSidebarPdfOverviewWheel;

    function resetRightSidebarPdfOverviewZoom() {
      applyRightSidebarPdfOverviewZoom(1);
      var viewport = document.getElementById('rightSidebarPdfOverviewViewport');
      if (viewport) {
        viewport.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
        requestAnimationFrame(syncRightSidebarPdfOverviewPanAffordance);
      }
    }
    window.resetRightSidebarPdfOverviewZoom = resetRightSidebarPdfOverviewZoom;

    function clearRightSidebarPdfOverviewState(restorePreviousTab) {
      if (!rightSidebarPdfOverviewState) {
        document.body.classList.remove('pdf-wiki-overview-sidebar-open');
        return;
      }
      rightSidebarPdfOverviewState = null;
      if (rightSidebarTransientTab === 'pdf-overview') rightSidebarTransientTab = '';
      document.body.classList.remove('pdf-wiki-overview-sidebar-open');
      if (restorePreviousTab === true && document.getElementById('rightSidebarPdfOverviewPage')) {
        setRightSidebarTab(rightSidebarPreviousTab === 'figures' ? 'figures' : 'article');
      } else if (document.getElementById('rightSidebarPdfOverviewPage')) {
        renderRightSidebarChrome();
      }
    }
    window.clearRightSidebarPdfOverviewState = clearRightSidebarPdfOverviewState;

    function closeRightSidebarPdfOverview() {
      clearRightSidebarPdfOverviewState(true);
    }
    window.closeRightSidebarPdfOverview = closeRightSidebarPdfOverview;

    window.openPdfWikiOverviewDiagramFromButton = function(button) {
      var pdfId = button && button.dataset ? button.dataset.pdfId : '';
      if (!pdfId || !pdfWikiPdfManagerData || !Array.isArray(pdfWikiPdfManagerData.pdfs)) {
        alert('未找到对应的一览图数据，请刷新 PDF 管理页面后重试');
        return;
      }
      var pdf = pdfWikiPdfManagerData.pdfs.find(function(item) { return item.id === pdfId; });
      var analysis = (pdfWikiDeepAnalysisResults && pdfWikiDeepAnalysisResults[pdfId]) || (pdf && pdf.deepAnalysis);
      var diagram = analysis && analysis.overviewDiagram;
      var inlineSvg = diagram && diagram.svg ? renderPdfWikiInlineSvg(diagram.svg, 1280, 'modal-' + pdfId + '-' + (++pdfWikiInlineSvgRenderSeq)) : '';
      if (!inlineSvg) {
        alert('当前 PDF 暂无可打开的一览图，请先运行深入分析');
        return;
      }
      var engineLabel = diagram.engine === 'codex' ? 'Codex 生成' : (diagram.engine === 'secondary-api' ? '小牛马生成' : '代码绘制');
      if (diagram.layoutVersion && Number(diagram.layoutVersion) >= 3) engineLabel += ' · 流程图优化';
      var title = diagram.title || (pdf && (pdf.title || pdf.originalName)) || 'PDF 论文一览图';
      var activeTab = getRightSidebarActiveTab();
      if (activeTab !== 'pdf-overview') {
        rightSidebarPreviousTab = activeTab === 'figures' ? 'figures' : 'article';
      }
      rightSidebarPdfOverviewState = {
        kind: 'overview',
        pdfId: pdfId,
        title: title,
        engineLabel: engineLabel,
        svg: diagram.svg,
        zoom: 1
      };
      rightSidebarTransientTab = 'pdf-overview';
      setRightSidebarTab('pdf-overview');
    };

    window.openPdfWikiFigurePreviewFromButton = function(button) {
      var pdfId = button && button.dataset ? button.dataset.pdfId : '';
      var figureIndex = button && button.dataset ? Number(button.dataset.figureIndex || 0) : 0;
      if (!pdfId || !pdfWikiPdfManagerData || !Array.isArray(pdfWikiPdfManagerData.pdfs)) {
        alert('未找到对应的 PDF 图片数据，请刷新 PDF 管理页面后重试');
        return;
      }
      var pdf = pdfWikiPdfManagerData.pdfs.find(function(item) { return item.id === pdfId; });
      var figures = Array.isArray(pdf && pdf.figurePreviews) ? pdf.figurePreviews : [];
      var figure = figures[figureIndex];
      var src = figure && figure.url ? figure.url : '';
      if (!src) {
        alert('当前图片文件不可用，请重新提取该 PDF 后再试');
        return;
      }
      var label = figure.number || ('图片 ' + (figureIndex + 1));
      var title = figure.title || figure.caption || label;
      var meta = [
        pdf && (pdf.title || pdf.originalName) ? (pdf.title || pdf.originalName) : '',
        figure.page ? ('第 ' + figure.page + ' 页') : '',
        figure.name || ''
      ].filter(Boolean).join(' · ');
      var activeTab = getRightSidebarActiveTab();
      if (activeTab !== 'pdf-overview') {
        rightSidebarPreviousTab = activeTab === 'figures' ? 'figures' : 'article';
      }
      rightSidebarPdfOverviewState = {
        kind: 'image',
        pdfId: pdfId,
        figureIndex: figureIndex,
        title: label,
        description: title,
        meta: meta,
        caption: figure.caption || '',
        engineLabel: figure.page ? ('第 ' + figure.page + ' 页') : 'PDF 图片',
        src: src,
        zoom: 1
      };
      rightSidebarTransientTab = 'pdf-overview';
      setRightSidebarTab('pdf-overview');
    };

    window.openPdfWikiOriginalPdfReaderFromButton = function(button) {
      var pdfId = button && button.dataset ? button.dataset.pdfId : '';
      window.openPdfWikiOriginalPdfReader(pdfId);
    };

    function getPdfWikiReaderStorageKey() {
      return 'scholar_pdf_wiki_reader_items_v1';
    }

    function getPdfWikiReaderPdfKey(pdfId) {
      return (currentUserId || 'web-user') + '::' + (pdfId || '');
    }

    function cleanPdfWikiReaderText(value, maxLength) {
      var text = String(value || '')
        .replace(/\u0000/g, '')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{4,}/g, '\n\n\n')
        .trim();
      return maxLength ? text.slice(0, maxLength) : text;
    }

    function loadPdfWikiReaderStore() {
      try {
        var raw = localStorage.getItem(getPdfWikiReaderStorageKey());
        var parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (e) {
        return {};
      }
    }

    function savePdfWikiReaderStore(store) {
      localStorage.setItem(getPdfWikiReaderStorageKey(), JSON.stringify(store || {}));
    }

    function loadPdfWikiReaderItems(pdfId) {
      var store = loadPdfWikiReaderStore();
      var items = store[getPdfWikiReaderPdfKey(pdfId)];
      return Array.isArray(items) ? items : [];
    }

    function savePdfWikiReaderItems(pdfId, items) {
      var store = loadPdfWikiReaderStore();
      store[getPdfWikiReaderPdfKey(pdfId)] = Array.isArray(items) ? items : [];
      savePdfWikiReaderStore(store);
    }

    function setPdfWikiReaderStatus(message, tone) {
      var palette = {
        ok: ['rgba(16,185,129,0.12)', '#047857', 'rgba(16,185,129,0.28)'],
        warn: ['rgba(245,158,11,0.14)', '#92400e', 'rgba(245,158,11,0.30)'],
        error: ['rgba(239,68,68,0.12)', '#b91c1c', 'rgba(239,68,68,0.26)'],
        info: ['rgba(59,130,246,0.12)', '#1d4ed8', 'rgba(59,130,246,0.24)']
      };
      var colors = palette[tone || 'info'] || palette.info;
      ['pdfWikiReaderStatus', 'pdfWikiReaderExternalChatStatus'].forEach(function(id) {
        var status = document.getElementById(id);
        if (!status) return;
        status.textContent = message || '';
        status.style.background = colors[0];
        status.style.color = colors[1];
        status.style.borderColor = colors[2];
      });
    }

    function setPdfWikiReaderSelectionText(text, source) {
      var cleaned = cleanPdfWikiReaderText(text, 12000);
      if (!cleaned) return '';
      var input = document.getElementById('pdfWikiReaderSelectionText');
      if (input) input.value = cleaned;
      setPdfWikiReaderStatus((source || '已捕获选中文本') + '：' + cleaned.length + ' 字符', 'ok');
      return cleaned;
    }

    function getPdfWikiReaderTextareaText() {
      var input = document.getElementById('pdfWikiReaderSelectionText');
      return cleanPdfWikiReaderText(input ? input.value : '', 12000);
    }

    function isPdfWikiReaderNodeInsidePdf(node) {
      var container = document.getElementById('pdfWikiPdfJsContainer');
      if (!container || !node) return false;
      var element = node.nodeType === 1 ? node : node.parentElement;
      return !!(element && container.contains(element));
    }

    function getPdfWikiReaderSelectedTextFromPdf() {
      var selection = window.getSelection ? window.getSelection() : null;
      if (!selection || selection.rangeCount < 1) return '';
      var text = cleanPdfWikiReaderText(selection.toString(), 12000);
      if (!text) return '';
      var range = selection.getRangeAt(0);
      if (
        isPdfWikiReaderNodeInsidePdf(selection.anchorNode) ||
        isPdfWikiReaderNodeInsidePdf(selection.focusNode) ||
        isPdfWikiReaderNodeInsidePdf(range.commonAncestorContainer)
      ) {
        return text;
      }
      return '';
    }

    function appendPdfWikiReaderSentenceText(base, next) {
      var value = cleanPdfWikiReaderText(next, 0);
      if (!value) return base || '';
      if (!base) return value;
      var compactNext = value.replace(/\s+/g, ' ');
      var last = base.slice(-1);
      var first = compactNext.charAt(0);
      if (/^[,.;:!?，。；：！？)\]\}%]/.test(first)) return base + compactNext;
      if (/[(\[{（《“‘]$/.test(last)) return base + compactNext;
      if (/[\u4e00-\u9fa5]$/.test(last) && /^[\u4e00-\u9fa5]/.test(first)) return base + compactNext;
      return base + ' ' + compactNext;
    }

    function isPdfWikiReaderSentenceEnd(text) {
      var value = String(text || '').trim();
      if (!value) return false;
      if (/[。！？!?]$/.test(value)) return true;
      if (!/\.$/.test(value)) return false;
      if (/\b(?:et al|e\.g|i\.e|Fig|Eq|Dr|Mr|Ms|Prof|vs|cf)\.$/i.test(value)) return false;
      if (/\b[A-Z]\.$/.test(value)) return false;
      return true;
    }

    function buildPdfWikiReaderLineGroups(tokens) {
      var lines = [];
      tokens.forEach(function(token) {
        var rect = token.rect || {};
        var line = lines.find(function(item) {
          return Math.abs(item.top - rect.top) < Math.max(4, rect.height * 0.45);
        });
        if (!line) {
          line = {
            top: rect.top,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
            height: rect.height,
            fontSize: token.fontSize || rect.height,
            tokens: []
          };
          lines.push(line);
        }
        line.tokens.push(token);
        line.top = Math.min(line.top, rect.top);
        line.left = Math.min(line.left, rect.left);
        line.right = Math.max(line.right, rect.right);
        line.bottom = Math.max(line.bottom, rect.bottom);
        line.height = Math.max(line.height, rect.height);
        line.fontSize = Math.max(line.fontSize || 0, token.fontSize || rect.height || 0);
      });
      lines.sort(function(a, b) { return a.top - b.top; });
      lines.forEach(function(line) {
        line.tokens.sort(function(a, b) { return (a.rect.left || 0) - (b.rect.left || 0); });
        line.text = line.tokens.reduce(function(text, token) {
          return appendPdfWikiReaderSentenceText(text, token.raw || '');
        }, '');
      });
      return lines;
    }

    function detectPdfWikiReaderSectionHeading(text, line, pageWidth) {
      var value = cleanPdfWikiReaderText(text || '', 160).replace(/\s+/g, ' ').trim();
      if (!value || value.length > 140) return '';
      if (/[。！？!?]$/.test(value) && value.length > 28) return '';
      var common = value.match(/^(?:\d+(?:\.\d+)*[\s.)、-]*)?(abstract|introduction|background|literature review|materials?\s+and\s+methods|methods?|methodology|experimental procedures|results(?:\s+and\s+discussion)?|discussion|conclusions?|references|acknowledg(?:e)?ments?|supplementary(?:\s+materials?)?|appendix)\b/i);
      if (common) {
        var commonAfter = value.slice(common[0].length).trim();
        if (commonAfter && !/^[:：.)、-]/.test(commonAfter) && /^[a-z]/.test(commonAfter) && commonAfter.length > 6) return '';
        return value;
      }
      var zh = value.match(/^(?:第?[一二三四五六七八九十百\d]+[章节、.\s]*)?(摘要|引言|绪论|前言|背景|文献综述|材料与方法|研究方法|方法|实验方法|结果与讨论|结果|讨论|结论|参考文献|致谢|附录|补充材料)\b/);
      if (zh) {
        var zhAfter = value.slice(zh[0].length).trim();
        if (zhAfter && !/^[:：.)、-]/.test(zhAfter) && zhAfter.length > 8) return '';
        return value;
      }
      var numbered = value.match(/^(?:\d+(?:\.\d+)*|[IVX]+)[\s.)、-]+[A-Z][A-Za-z0-9 ,&/()：:;-]{2,90}$/);
      if (numbered && (!pageWidth || (line.right - line.left) < pageWidth * 0.86)) return value;
      return '';
    }

    function buildPdfWikiReaderPageSentences(pageDiv, pageNumber, textDivs) {
      if (!pageDiv) return [];
      var spans = Array.prototype.slice.call(textDivs && textDivs.length ? textDivs : pageDiv.querySelectorAll('.textLayer span'));
      var pageRect = pageDiv.getBoundingClientRect();
      var tokens = [];
      spans.forEach(function(span) {
        var raw = cleanPdfWikiReaderText(span.textContent || '', 0);
        if (!raw) return;
        var rect = span.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        var localRect = {
          left: Math.max(0, rect.left - pageRect.left),
          top: Math.max(0, rect.top - pageRect.top),
          right: Math.max(0, rect.right - pageRect.left),
          bottom: Math.max(0, rect.bottom - pageRect.top),
          width: rect.width,
          height: rect.height
        };
        tokens.push({
          raw: raw,
          rect: localRect,
          fontSize: parseFloat(span.style && span.style.fontSize ? span.style.fontSize : '') || rect.height || 0
        });
      });
      var sectionMarkers = buildPdfWikiReaderLineGroups(tokens).map(function(line) {
        var title = detectPdfWikiReaderSectionHeading(line.text, line, pageRect.width || 0);
        return title ? { title: title, top: line.top } : null;
      }).filter(Boolean);
      var previousSection = pdfWikiReaderLastKnownSection || pdfWikiReaderSectionByPage[Math.max(1, pageNumber - 1)] || '';
      var getSectionForTop = function(top) {
        var active = previousSection;
        var known = !!active;
        sectionMarkers.forEach(function(marker) {
          if (marker.top <= top + 3) {
            active = marker.title;
            known = true;
          }
        });
        return { title: active, known: known };
      };
      var sentences = [];
      var current = null;
      var flush = function() {
        if (!current) return;
        var text = cleanPdfWikiReaderText(current.text, 2000);
        if (text.length >= 8 && current.rects.length > 0) {
          var firstTop = current.rects.reduce(function(min, rect) { return Math.min(min, rect.top || 0); }, Number.POSITIVE_INFINITY);
          var section = getSectionForTop(Number.isFinite(firstTop) ? firstTop : 0);
          current.text = text;
          current.id = 'reader_sentence_' + pageNumber + '_' + sentences.length;
          current.sectionTitle = section.title;
          current.sectionKnown = section.known;
          sentences.push(current);
        }
        current = null;
      };
      tokens.forEach(function(token) {
        var raw = token.raw || '';
        var localRect = token.rect;
        if (!current) {
          current = {
            id: '',
            pageNumber: pageNumber,
            text: '',
            rects: [],
            lineTops: []
          };
        }
        current.text = appendPdfWikiReaderSentenceText(current.text, raw);
        current.rects.push(localRect);
        current.lineTops.push(localRect.top);
        if (isPdfWikiReaderSentenceEnd(current.text) || current.text.length > 520) {
          flush();
        }
      });
      flush();
      var lastKnown = sectionMarkers.length ? sectionMarkers[sectionMarkers.length - 1].title : previousSection;
      if (lastKnown) {
        pdfWikiReaderLastKnownSection = lastKnown;
        pdfWikiReaderSectionByPage[pageNumber] = lastKnown;
      }
      pageDiv.__pdfWikiReaderSectionMarkers = sectionMarkers;
      pageDiv.__pdfWikiReaderSentences = sentences;
      return sentences;
    }

    function clearPdfWikiReaderSentenceHighlights() {
      var container = document.getElementById('pdfWikiPdfJsContainer');
      if (!container) return;
      Array.prototype.slice.call(container.querySelectorAll('.pdfWikiReaderSentenceHighlight')).forEach(function(node) {
        node.remove();
      });
    }

    function getPdfWikiReaderPageElement(pageNumber) {
      return document.querySelector('.pdfWikiReaderPage[data-page-number="' + Number(pageNumber || 1) + '"]');
    }

    function getPdfWikiReaderPageSentences(pageNumber) {
      var pageDiv = getPdfWikiReaderPageElement(pageNumber);
      return pageDiv && Array.isArray(pageDiv.__pdfWikiReaderSentences) ? pageDiv.__pdfWikiReaderSentences : [];
    }

    function getPdfWikiReaderSelectionPageNumber() {
      var selection = window.getSelection ? window.getSelection() : null;
      if (!selection || selection.rangeCount < 1) return pdfWikiOriginalReaderCurrentPage || 1;
      var range = selection.getRangeAt(0);
      var nodes = [selection.anchorNode, selection.focusNode, range.commonAncestorContainer];
      for (var i = 0; i < nodes.length; i += 1) {
        var element = nodes[i] && nodes[i].nodeType === 1 ? nodes[i] : (nodes[i] ? nodes[i].parentElement : null);
        var page = element && element.closest ? element.closest('.pdfWikiReaderPage') : null;
        if (page && page.dataset && page.dataset.pageNumber) {
          return Number(page.dataset.pageNumber || 1);
        }
      }
      return pdfWikiOriginalReaderCurrentPage || 1;
    }

    function normalizePdfWikiReaderMatchText(text) {
      return cleanPdfWikiReaderText(text || '', 0)
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^\w\u4e00-\u9fa5]/g, '');
    }

    function findPdfWikiReaderSentenceByText(pageNumber, text) {
      var needle = normalizePdfWikiReaderMatchText(text);
      if (!needle || needle.length < 6) return null;
      var sentences = getPdfWikiReaderPageSentences(pageNumber);
      var best = null;
      var bestScore = 0;
      sentences.forEach(function(sentence) {
        var haystack = normalizePdfWikiReaderMatchText(sentence.text || '');
        if (!haystack) return;
        var score = 0;
        if (haystack.indexOf(needle) >= 0) {
          score = Math.min(1000, needle.length);
        } else if (needle.indexOf(haystack) >= 0) {
          score = Math.min(900, haystack.length);
        } else {
          var probeLength = Math.min(80, needle.length);
          var probe = needle.slice(0, probeLength);
          if (probe.length >= 12 && haystack.indexOf(probe) >= 0) {
            score = probe.length;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          best = sentence;
        }
      });
      return bestScore >= 12 ? best : null;
    }

    function getPdfWikiReaderSavedHighlightColors(item) {
      var colors = getPdfWikiReaderItemColor(item || {});
      return {
        text: colors[0],
        background: colors[1],
        border: colors[2]
      };
    }

    function getPdfWikiReaderSavedItemsForPage(pageNumber) {
      var pdf = getPdfWikiPdfById(pdfWikiOriginalReaderPdfId);
      if (!pdf) return [];
      var page = Number(pageNumber || 1);
      return loadPdfWikiReaderItems(pdf.id).filter(function(item) {
        return Number(item.pageNumber || 0) === page && cleanPdfWikiReaderText(item.text || '', 0);
      });
    }

    function resolvePdfWikiReaderSavedItemSentence(item, pageNumber) {
      if (!item) return null;
      var sentences = getPdfWikiReaderPageSentences(pageNumber);
      if (item.sentenceId) {
        var byId = sentences.find(function(sentence) {
          return sentence.id === item.sentenceId;
        });
        if (byId) return byId;
      }
      return findPdfWikiReaderSentenceByText(pageNumber, item.text || '');
    }

    function getPdfWikiReaderSavedItemMapForPage(pageNumber) {
      var map = {};
      getPdfWikiReaderSavedItemsForPage(pageNumber).forEach(function(item) {
        var sentence = resolvePdfWikiReaderSavedItemSentence(item, pageNumber);
        if (sentence && sentence.id && !map[sentence.id]) {
          map[sentence.id] = item;
        }
      });
      return map;
    }

    function resetPdfWikiReaderTextPanelSentenceNodeStyle(node) {
      if (!node || !node.dataset) return;
      var pageNumber = Number(node.dataset.pageNumber || pdfWikiOriginalReaderCurrentPage || 1);
      var item = getPdfWikiReaderSavedItemMapForPage(pageNumber)[node.dataset.sentenceId || ''];
      if (item) {
        var colors = getPdfWikiReaderSavedHighlightColors(item);
        node.style.background = colors.background;
        node.style.color = colors.text;
        node.style.boxShadow = '0 0 0 1px ' + colors.border;
      } else {
        node.style.background = 'transparent';
        node.style.color = 'var(--text-primary)';
        node.style.boxShadow = 'none';
      }
    }

    function scrollPdfWikiReaderTextPanelToSentence(sentenceId) {
      if (!sentenceId) return false;
      var panel = document.getElementById('pdfWikiReaderPageSentences');
      if (!panel) return false;
      var target = null;
      Array.prototype.slice.call(panel.querySelectorAll('[data-sentence-id]')).some(function(node) {
        if (node.dataset && node.dataset.sentenceId === sentenceId) {
          target = node;
          return true;
        }
        return false;
      });
      if (!target) return false;
      var panelRect = panel.getBoundingClientRect();
      var targetRect = target.getBoundingClientRect();
      var currentTop = panel.scrollTop || 0;
      var targetTopInPanel = currentTop + targetRect.top - panelRect.top;
      var safeOffset = Math.max(28, Math.min(84, panel.clientHeight * 0.22));
      var top = Math.max(0, targetTopInPanel - safeOffset);
      try {
        panel.scrollTo({ top: top, behavior: 'smooth' });
      } catch (e) {
        panel.scrollTop = top;
      }
      target.style.boxShadow = '0 0 0 2px rgba(217,119,6,0.35)';
      setTimeout(function() {
        if (target) target.style.boxShadow = 'none';
      }, 900);
      return true;
    }

    function syncPdfWikiReaderTextPanelToPdfSelection(text) {
      var pageNumber = getPdfWikiReaderSelectionPageNumber();
      var sentence = findPdfWikiReaderSentenceByText(pageNumber, text);
      if (!sentence) {
        renderPdfWikiReaderPageSentenceList(pageNumber);
        return false;
      }
      var pageDiv = getPdfWikiReaderPageElement(pageNumber);
      pdfWikiOriginalReaderCurrentPage = pageNumber;
      pdfWikiReaderSelectedSentenceId = sentence.id || '';
      if (pageDiv) highlightPdfWikiReaderSentence(pageDiv, sentence);
      renderPdfWikiReaderPageSentenceList(pageNumber);
      requestAnimationFrame(function() {
        scrollPdfWikiReaderTextPanelToSentence(sentence.id);
      });
      updatePdfWikiReaderPageControls();
      return true;
    }

    function getPdfWikiReaderSavedSidebarWidth() {
      var stored = 0;
      try {
        stored = Number(localStorage.getItem('pdfWikiReaderSidebarWidth') || 0);
      } catch (e) {
        stored = 0;
      }
      return Number.isFinite(stored) && stored > 0 ? stored : pdfWikiReaderSidebarWidth;
    }

    function applyPdfWikiReaderSidebarWidth(width) {
      var layout = document.getElementById('pdfWikiReaderLayout');
      if (!layout) return pdfWikiReaderSidebarWidth;
      var totalWidth = layout.clientWidth || 0;
      var minSidebar = 300;
      var maxSidebar = totalWidth ? Math.max(minSidebar, Math.min(760, totalWidth - 420)) : 760;
      var nextWidth = Math.max(minSidebar, Math.min(maxSidebar, Number(width) || pdfWikiReaderSidebarWidth || 360));
      pdfWikiReaderSidebarWidth = nextWidth;
      layout.style.gridTemplateColumns = 'minmax(320px,1fr) 6px ' + Math.round(nextWidth) + 'px';
      return nextWidth;
    }

    function schedulePdfWikiReaderFitWidth(delay) {
      if (!pdfWikiOriginalReaderPdfDoc || !document.getElementById('pdfWikiPdfJsContainer')) return;
      if (pdfWikiReaderFitWidthTimer) return;
      pdfWikiReaderFitWidthTimer = setTimeout(function() {
        pdfWikiReaderFitWidthTimer = null;
        fitPdfWikiReaderWidth();
      }, typeof delay === 'number' ? delay : 220);
    }

    function runPdfWikiReaderFitWidthNow() {
      if (pdfWikiReaderFitWidthTimer) {
        clearTimeout(pdfWikiReaderFitWidthTimer);
        pdfWikiReaderFitWidthTimer = null;
      }
      if (!pdfWikiOriginalReaderPdfDoc || !document.getElementById('pdfWikiPdfJsContainer')) return;
      fitPdfWikiReaderWidth();
    }

    function initPdfWikiReaderResizableLayout() {
      var layout = document.getElementById('pdfWikiReaderLayout');
      var handle = document.getElementById('pdfWikiReaderResizeHandle');
      if (!layout || !handle) return;
      applyPdfWikiReaderSidebarWidth(getPdfWikiReaderSavedSidebarWidth());
      handle.onpointerdown = function(event) {
        if (event.button !== 0) return;
        event.preventDefault();
        var startX = event.clientX;
        var startWidth = pdfWikiReaderSidebarWidth || getPdfWikiReaderSavedSidebarWidth();
        if (handle.setPointerCapture && event.pointerId !== undefined) {
          try { handle.setPointerCapture(event.pointerId); } catch (e) {}
        }
        handle.style.background = 'rgba(37,99,235,0.14)';
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        var onMove = function(moveEvent) {
          var delta = startX - moveEvent.clientX;
          applyPdfWikiReaderSidebarWidth(startWidth + delta);
          schedulePdfWikiReaderFitWidth(220);
        };
        var onUp = function() {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onUp);
          handle.style.background = 'rgba(148,163,184,0.10)';
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          try {
            localStorage.setItem('pdfWikiReaderSidebarWidth', String(Math.round(pdfWikiReaderSidebarWidth || 360)));
          } catch (e) {}
          runPdfWikiReaderFitWidthNow();
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
      };
      if (pdfWikiReaderLayoutResizeHandler) {
        window.removeEventListener('resize', pdfWikiReaderLayoutResizeHandler);
      }
      pdfWikiReaderLayoutResizeHandler = function() {
        if (document.getElementById('pdfWikiReaderLayout')) {
          applyPdfWikiReaderSidebarWidth(pdfWikiReaderSidebarWidth || getPdfWikiReaderSavedSidebarWidth());
          schedulePdfWikiReaderFitWidth(220);
        }
      };
      window.addEventListener('resize', pdfWikiReaderLayoutResizeHandler);
    }

    function isPdfWikiReaderNodeInside(parent, node) {
      if (!parent || !node) return false;
      var current = node.nodeType === 1 ? node : node.parentNode;
      return !!(current && (current === parent || parent.contains(current)));
    }

    function getPdfWikiReaderTextPanelSelection() {
      var panel = document.getElementById('pdfWikiReaderPageSentences');
      var selection = window.getSelection ? window.getSelection() : null;
      if (!panel || !selection || selection.rangeCount === 0) return '';
      if (!isPdfWikiReaderNodeInside(panel, selection.anchorNode) || !isPdfWikiReaderNodeInside(panel, selection.focusNode)) return '';
      return cleanPdfWikiReaderText(selection.toString(), 12000);
    }

    function capturePdfWikiReaderTextPanelSelection(source) {
      var text = getPdfWikiReaderTextPanelSelection();
      if (!text) return '';
      var panel = document.getElementById('pdfWikiReaderPageSentences');
      var page = Number(panel && panel.dataset.pageNumber ? panel.dataset.pageNumber : pdfWikiOriginalReaderCurrentPage || 1);
      pdfWikiOriginalReaderCurrentPage = page;
      if (pdfWikiReaderSelectedSentenceId && panel) {
        Array.prototype.slice.call(panel.querySelectorAll('[data-sentence-id]')).forEach(function(node) {
          resetPdfWikiReaderTextPanelSentenceNodeStyle(node);
        });
      }
      pdfWikiReaderSelectedSentenceId = '';
      clearPdfWikiReaderSentenceHighlights();
      setPdfWikiReaderSelectionText(text, source || '已从右侧原文层捕获选区');
      schedulePdfWikiReaderAiRead();
      updatePdfWikiReaderPageControls();
      return text;
    }

    function renderPdfWikiReaderPageSentenceList(pageNumber) {
      var listEl = document.getElementById('pdfWikiReaderPageSentences');
      var metaEl = document.getElementById('pdfWikiReaderPageSentencesMeta');
      if (!listEl) return;
      var page = Number(pageNumber || pdfWikiOriginalReaderCurrentPage || 1);
      pdfWikiReaderSentenceListRenderedPage = page;
      listEl.dataset.pageNumber = String(page);
      var sentences = getPdfWikiReaderPageSentences(page);
      if (metaEl) {
        var sectionCount = sentences.reduce(function(count, sentence, index, arr) {
          var section = sentence.sectionKnown ? (sentence.sectionTitle || '') : '';
          if (!section) return count;
          var previous = index > 0 && arr[index - 1].sectionKnown ? (arr[index - 1].sectionTitle || '') : '';
          return section !== previous ? count + 1 : count;
        }, 0);
        metaEl.textContent = '第 ' + page + ' 页' + (sentences.length ? ' · ' + sentences.length + ' 句' + (sectionCount ? ' · ' + sectionCount + ' 个章节' : '') + ' · 可拖选' : '');
      }
      if (!getPdfWikiReaderPageElement(page)) {
        listEl.innerHTML = '<div style="padding:10px;color:var(--text-secondary);font-size:12px;line-height:1.5;">正在渲染当前页原文...</div>';
        return;
      }
      if (!sentences.length) {
        listEl.innerHTML = '<div style="padding:10px;color:var(--text-secondary);font-size:12px;line-height:1.5;">当前页还没有可读取原文。可在左侧 PDF 拖选，或等待页面文本层渲染完成。</div>';
        return;
      }
      var savedItemMap = getPdfWikiReaderSavedItemMapForPage(page);
      var lastRenderedSection = '';
      listEl.innerHTML = '<div tabindex="0" onmouseup="capturePdfWikiReaderTextPanelSelection()" onkeyup="capturePdfWikiReaderTextPanelSelection()" style="user-select:text;-webkit-user-select:text;padding:10px 11px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input);color:var(--text-primary);font-size:12px;line-height:1.72;white-space:normal;cursor:text;">' +
        sentences.map(function(sentence) {
        var selected = sentence.id && sentence.id === pdfWikiReaderSelectedSentenceId;
        var savedItem = savedItemMap[sentence.id || ''];
        var savedColors = savedItem ? getPdfWikiReaderSavedHighlightColors(savedItem) : null;
        var text = cleanPdfWikiReaderText(sentence.text || '', 0);
        var background = selected ? 'rgba(250,204,21,0.25)' : (savedColors ? savedColors.background : 'transparent');
        var color = selected ? '#92400e' : (savedColors ? savedColors.text : 'var(--text-primary)');
        var boxShadow = selected ? '0 0 0 1px rgba(217,119,6,0.40)' : (savedColors ? '0 0 0 1px ' + savedColors.border : 'none');
        var title = savedItem ? '已保存' + getPdfWikiReaderItemLabel(savedItem.type) + '；单击选中整句' : '单击选中整句';
        var sectionTitle = sentence.sectionKnown ? cleanPdfWikiReaderText(sentence.sectionTitle || '', 120) : '';
        var sectionHeader = '';
        if (sectionTitle && sectionTitle !== lastRenderedSection) {
          lastRenderedSection = sectionTitle;
          sectionHeader =
            '<div contenteditable="false" style="user-select:none;-webkit-user-select:none;margin:9px 0 6px;display:flex;align-items:center;gap:7px;color:var(--text-secondary);font-size:10.5px;line-height:1.2;">' +
              '<span style="height:1px;flex:1;background:var(--border-color);"></span>' +
              '<span style="max-width:82%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:3px 7px;border:1px solid rgba(15,118,110,0.24);border-radius:999px;background:rgba(15,118,110,0.08);color:#0f766e;font-weight:800;">' + escapeHtml(sectionTitle) + '</span>' +
              '<span style="height:1px;flex:1;background:var(--border-color);"></span>' +
            '</div>';
        }
        return sectionHeader +
          '<span data-page-number="' + page + '" data-sentence-id="' + escapeHtml(sentence.id || '') + '" onclick="selectPdfWikiReaderSentenceFromList(this)" title="' + escapeHtml(title) + '" style="border-radius:4px;background:' + background + ';color:' + color + ';box-shadow:' + boxShadow + ';padding:1px 2px;cursor:text;">' +
            escapeHtml(text) +
          '</span> ';
      }).join('') +
      '</div>';
    }

    function getPdfWikiReaderMergedHighlightRects(rects) {
      var lines = [];
      (rects || []).forEach(function(rect) {
        var line = lines.find(function(item) {
          return Math.abs(item.top - rect.top) < Math.max(5, rect.height * 0.45);
        });
        if (!line) {
          lines.push({
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            height: rect.height
          });
        } else {
          line.left = Math.min(line.left, rect.left);
          line.top = Math.min(line.top, rect.top);
          line.right = Math.max(line.right, rect.right);
          line.bottom = Math.max(line.bottom, rect.bottom);
          line.height = Math.max(line.height, rect.height);
        }
      });
      return lines;
    }

    function highlightPdfWikiReaderSentence(pageDiv, sentence) {
      clearPdfWikiReaderSentenceHighlights();
      if (!pageDiv || !sentence) return;
      getPdfWikiReaderMergedHighlightRects(sentence.rects).forEach(function(rect) {
        var highlight = document.createElement('div');
        highlight.className = 'pdfWikiReaderSentenceHighlight';
        var padX = 2;
        var padY = 1;
        highlight.style.cssText =
          'position:absolute;z-index:2;pointer-events:none;border-radius:3px;background:rgba(250,204,21,0.26);box-shadow:0 0 0 1px rgba(217,119,6,0.22) inset;' +
          'left:' + Math.max(0, rect.left - padX) + 'px;' +
          'top:' + Math.max(0, rect.top - padY) + 'px;' +
          'width:' + Math.max(2, rect.right - rect.left + padX * 2) + 'px;' +
          'height:' + Math.max(2, rect.bottom - rect.top + padY * 2) + 'px;';
        pageDiv.appendChild(highlight);
      });
    }

    function clearPdfWikiReaderSavedHighlights(pageDiv) {
      var root = pageDiv || document.getElementById('pdfWikiPdfJsContainer');
      if (!root) return;
      Array.prototype.slice.call(root.querySelectorAll('.pdfWikiReaderSavedHighlight')).forEach(function(node) {
        node.remove();
      });
    }

    function renderPdfWikiReaderSavedHighlightsForPage(pageDiv, pageNumber) {
      if (!pageDiv) return;
      clearPdfWikiReaderSavedHighlights(pageDiv);
      var items = getPdfWikiReaderSavedItemsForPage(pageNumber);
      if (!items.length) return;
      items.forEach(function(item) {
        var sentence = resolvePdfWikiReaderSavedItemSentence(item, pageNumber);
        if (!sentence || !sentence.rects || !sentence.rects.length) return;
        var colors = getPdfWikiReaderSavedHighlightColors(item);
        getPdfWikiReaderMergedHighlightRects(sentence.rects).forEach(function(rect) {
          var highlight = document.createElement('div');
          highlight.className = 'pdfWikiReaderSavedHighlight';
          highlight.dataset.itemId = item.id || '';
          var padX = 2;
          var padY = 1;
          highlight.style.cssText =
            'position:absolute;z-index:1;pointer-events:none;border-radius:3px;background:' + colors.background + ';box-shadow:0 0 0 1px ' + colors.border + ' inset;' +
            'left:' + Math.max(0, rect.left - padX) + 'px;' +
            'top:' + Math.max(0, rect.top - padY) + 'px;' +
            'width:' + Math.max(2, rect.right - rect.left + padX * 2) + 'px;' +
            'height:' + Math.max(2, rect.bottom - rect.top + padY * 2) + 'px;';
          pageDiv.appendChild(highlight);
        });
      });
    }

    function renderPdfWikiReaderSavedHighlightsForAllPages() {
      var container = document.getElementById('pdfWikiPdfJsContainer');
      if (!container) return;
      Array.prototype.slice.call(container.querySelectorAll('.pdfWikiReaderPage')).forEach(function(pageDiv) {
        renderPdfWikiReaderSavedHighlightsForPage(pageDiv, Number(pageDiv.dataset.pageNumber || 1));
      });
    }

    function applyPdfWikiReaderSentenceSelection(pageDiv, sentence, source) {
      if (!pageDiv || !sentence) return false;
      pdfWikiOriginalReaderCurrentPage = sentence.pageNumber || pdfWikiOriginalReaderCurrentPage;
      pdfWikiReaderSelectedSentenceId = sentence.id || '';
      setPdfWikiReaderSelectionText(sentence.text, source || '已按句子选择');
      highlightPdfWikiReaderSentence(pageDiv, sentence);
      renderPdfWikiReaderPageSentenceList(pdfWikiOriginalReaderCurrentPage);
      requestAnimationFrame(function() {
        scrollPdfWikiReaderTextPanelToSentence(sentence.id);
      });
      schedulePdfWikiReaderAiRead();
      updatePdfWikiReaderPageControls();
      return true;
    }

    function distanceToPdfWikiReaderRect(x, y, rect) {
      var dx = x < rect.left ? rect.left - x : (x > rect.right ? x - rect.right : 0);
      var dy = y < rect.top ? rect.top - y : (y > rect.bottom ? y - rect.bottom : 0);
      return Math.sqrt(dx * dx + dy * dy);
    }

    function findPdfWikiReaderSentenceAtPoint(pageDiv, x, y) {
      var sentences = pageDiv && Array.isArray(pageDiv.__pdfWikiReaderSentences) ? pageDiv.__pdfWikiReaderSentences : [];
      var best = null;
      var bestDistance = Infinity;
      sentences.forEach(function(sentence) {
        getPdfWikiReaderMergedHighlightRects(sentence.rects).forEach(function(rect) {
          var expanded = {
            left: rect.left - 10,
            top: rect.top - 8,
            right: rect.right + 10,
            bottom: rect.bottom + 8
          };
          var distance = distanceToPdfWikiReaderRect(x, y, expanded);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = sentence;
          }
        });
      });
      return best && bestDistance <= 32 ? best : null;
    }

    function selectPdfWikiReaderSentenceAtEvent(event) {
      if (!pdfWikiReaderSentenceSelectEnabled || !event) return false;
      var pageDiv = event.target && event.target.closest ? event.target.closest('.pdfWikiReaderPage') : null;
      if (!pageDiv) return false;
      var pageRect = pageDiv.getBoundingClientRect();
      var x = event.clientX - pageRect.left;
      var y = event.clientY - pageRect.top;
      var sentence = findPdfWikiReaderSentenceAtPoint(pageDiv, x, y);
      if (!sentence) {
        setPdfWikiReaderStatus('未识别到附近完整句子，可拖选或复制后粘贴。', 'warn');
        return false;
      }
      return applyPdfWikiReaderSentenceSelection(pageDiv, sentence, '已按句子选择');
    }

    function selectPdfWikiReaderSentenceFromList(button) {
      if (!button) return false;
      if (getPdfWikiReaderTextPanelSelection()) return false;
      var pageNumber = Number(button.dataset.pageNumber || pdfWikiOriginalReaderCurrentPage || 1);
      var sentenceId = button.dataset.sentenceId || '';
      var pageDiv = getPdfWikiReaderPageElement(pageNumber);
      var sentences = getPdfWikiReaderPageSentences(pageNumber);
      var sentence = sentences.find(function(item) {
        return item.id === sentenceId;
      });
      if (!pageDiv || !sentence) {
        setPdfWikiReaderStatus('当前页原文还没有准备好，请稍后再点。', 'warn');
        return false;
      }
      pageDiv.scrollIntoView({ block: 'center' });
      return applyPdfWikiReaderSentenceSelection(pageDiv, sentence, '已从右侧原文层选择整句');
    }

    function togglePdfWikiReaderSentenceSelect(checked) {
      pdfWikiReaderSentenceSelectEnabled = checked !== false;
      if (!pdfWikiReaderSentenceSelectEnabled) {
        pdfWikiReaderSelectedSentenceId = '';
        clearPdfWikiReaderSentenceHighlights();
        renderPdfWikiReaderPageSentenceList(pdfWikiOriginalReaderCurrentPage);
      }
      setPdfWikiReaderStatus(pdfWikiReaderSentenceSelectEnabled ? 'PDF 点句已开启：左侧正文可点选整句；右侧原文层可直接拖选。' : 'PDF 点句已关闭：请使用右侧原文层或鼠标拖选文本。', 'info');
      refreshPdfWikiReaderToolBubbleState();
    }

    async function readPdfWikiReaderClipboardText() {
      try {
        if (!navigator.clipboard || !navigator.clipboard.readText) return '';
        return cleanPdfWikiReaderText(await navigator.clipboard.readText(), 12000);
      } catch (e) {
        return '';
      }
    }

    async function getPdfWikiReaderTextForAction() {
      var selected = getPdfWikiReaderSelectedTextFromPdf();
      if (selected) return setPdfWikiReaderSelectionText(selected, '已捕获 PDF 选区');
      var panelSelected = getPdfWikiReaderTextPanelSelection();
      if (panelSelected) return setPdfWikiReaderSelectionText(panelSelected, '已捕获右侧原文选区');
      var manual = getPdfWikiReaderTextareaText();
      if (manual) return manual;
      return '';
    }

    function getPdfWikiReaderFieldValue(id) {
      var input = document.getElementById(id);
      return cleanPdfWikiReaderText(input ? input.value : '', 2000);
    }

    function setPdfWikiReaderFieldValue(id, value) {
      var input = document.getElementById(id);
      if (input) input.value = value || '';
    }

    function getPdfWikiReaderItemLabel(type) {
      return type === 'annotation' ? '批注' : '摘录';
    }

    function getPdfWikiReaderItemColor(item) {
      var color = item && item.color ? item.color : '';
      if (color === 'yellow') return ['#a16207', 'rgba(250,204,21,0.16)', 'rgba(250,204,21,0.38)'];
      if (color === 'green') return ['#0f766e', 'rgba(15,118,110,0.12)', 'rgba(15,118,110,0.32)'];
      if (color === 'blue') return ['#1d4ed8', 'rgba(37,99,235,0.12)', 'rgba(37,99,235,0.30)'];
      if (color === 'red') return ['#b91c1c', 'rgba(239,68,68,0.11)', 'rgba(239,68,68,0.28)'];
      return item && item.type === 'annotation'
        ? ['#7c3aed', 'rgba(124,58,237,0.11)', 'rgba(124,58,237,0.28)']
        : ['#0f766e', 'rgba(15,118,110,0.10)', 'rgba(15,118,110,0.26)'];
    }

    function getPdfWikiReaderPurposeLabel(value) {
      var map = {
        evidence: '核心证据',
        method: '方法/参数',
        result: '结果数据',
        limitation: '局限/不足',
        quote: '可引用原句',
        todo: '待复核'
      };
      return map[value || ''] || value || '';
    }

    function parsePdfWikiReaderTags(value) {
      return cleanPdfWikiReaderText(value || '', 500)
        .split(/[，,;\s]+/)
        .map(function(tag) { return tag.trim(); })
        .filter(Boolean)
        .slice(0, 8);
    }

    function getPdfWikiReaderItemDraft() {
      return {
        note: getPdfWikiReaderFieldValue('pdfWikiReaderNoteInput'),
        tags: parsePdfWikiReaderTags(getPdfWikiReaderFieldValue('pdfWikiReaderTagInput')),
        purpose: getPdfWikiReaderFieldValue('pdfWikiReaderPurposeSelect') || 'evidence',
        color: getPdfWikiReaderFieldValue('pdfWikiReaderColorSelect') || ''
      };
    }

    function findPdfWikiReaderItemById(pdfId, itemId) {
      var items = loadPdfWikiReaderItems(pdfId);
      return items.find(function(item) {
        return item.id === itemId;
      }) || null;
    }

    async function writePdfWikiReaderClipboard(text, label) {
      var value = cleanPdfWikiReaderText(text || '', 50000);
      if (!value) {
        setPdfWikiReaderStatus('没有可复制的内容', 'warn');
        return false;
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(value);
        } else {
          var textarea = document.createElement('textarea');
          textarea.value = value;
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          document.execCommand('copy');
          textarea.remove();
        }
        setPdfWikiReaderStatus(label || '已复制到剪贴板', 'ok');
        return true;
      } catch (e) {
        setPdfWikiReaderStatus('复制失败：' + (e.message || e), 'error');
        return false;
      }
    }

    function formatPdfWikiReaderItemMarkdown(item, index) {
      var label = getPdfWikiReaderItemLabel(item.type);
      var page = item.pageNumber ? 'p.' + item.pageNumber : '未知页';
      var tags = item.tags && item.tags.length ? ' #' + item.tags.join(' #') : '';
      var purpose = item.purpose ? '用途：' + getPdfWikiReaderPurposeLabel(item.purpose) : '';
      var note = item.note ? '\n备注：' + item.note : '';
      return [
        '### ' + (index + 1) + '. ' + label + ' · ' + page + tags,
        purpose,
        note,
        '> ' + cleanPdfWikiReaderText(item.text || '', 12000)
      ].filter(Boolean).join('\n');
    }

    function setPdfWikiReaderItemFilter(value) {
      pdfWikiReaderItemFilter = value || 'all';
      var pdf = getPdfWikiPdfById(pdfWikiOriginalReaderPdfId);
      if (pdf) renderPdfWikiReaderItems(pdf.id);
    }

    function setPdfWikiReaderItemSearch(value) {
      pdfWikiReaderItemSearchTerm = cleanPdfWikiReaderText(value || '', 500).toLowerCase();
      var pdf = getPdfWikiPdfById(pdfWikiOriginalReaderPdfId);
      if (pdf) renderPdfWikiReaderItems(pdf.id);
    }

    function renderPdfWikiReaderItems(pdfId) {
      var list = document.getElementById('pdfWikiReaderItems');
      var countEl = document.getElementById('pdfWikiReaderItemsCount');
      if (!list) return;
      var items = loadPdfWikiReaderItems(pdfId);
      var visibleItems = items.filter(function(item) {
        if (pdfWikiReaderItemFilter !== 'all' && item.type !== pdfWikiReaderItemFilter) return false;
        if (!pdfWikiReaderItemSearchTerm) return true;
        var haystack = [
          item.text || '',
          item.note || '',
          item.purpose || '',
          (item.tags || []).join(' ')
        ].join(' ').toLowerCase();
        return haystack.indexOf(pdfWikiReaderItemSearchTerm) >= 0;
      });
      if (countEl) {
        countEl.textContent = visibleItems.length + '/' + items.length;
      }
      if (!items.length) {
        list.innerHTML = '<div style="padding:10px;border:1px dashed var(--border-color);border-radius:7px;color:var(--text-secondary);font-size:12px;line-height:1.5;">还没有批注或摘录。选中 PDF 原文后，可保存为带备注的批注，或保存为后续写作可引用的摘录。</div>';
        return;
      }
      if (!visibleItems.length) {
        list.innerHTML = '<div style="padding:10px;border:1px dashed var(--border-color);border-radius:7px;color:var(--text-secondary);font-size:12px;line-height:1.5;">没有匹配当前筛选条件的记录。</div>';
        return;
      }
      list.innerHTML = visibleItems.map(function(item) {
        var label = getPdfWikiReaderItemLabel(item.type);
        var colors = getPdfWikiReaderItemColor(item);
        var time = item.createdAt ? new Date(item.createdAt).toLocaleString() : '';
        var tags = Array.isArray(item.tags) ? item.tags : [];
        var purpose = getPdfWikiReaderPurposeLabel(item.purpose || '');
        var pageLabel = item.pageNumber ? 'p.' + item.pageNumber : '未知页';
        return '<div style="padding:10px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-secondary);">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">' +
            '<div style="display:flex;align-items:center;gap:6px;min-width:0;">' +
              '<span style="display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:999px;background:' + colors[1] + ';color:' + colors[0] + ';border:1px solid ' + colors[2] + ';font-size:11px;font-weight:700;">' + label + '</span>' +
              '<span style="font-size:10px;color:var(--text-secondary);white-space:nowrap;">' + escapeHtml(pageLabel) + '</span>' +
              '<span style="font-size:10px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(time) + '</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">' +
              '<button type="button" onclick="jumpPdfWikiReaderToItem(\'' + escapeHtml(item.id) + '\')" style="padding:3px 7px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-primary);color:var(--text-secondary);cursor:pointer;font-size:11px;">跳转</button>' +
              '<button type="button" onclick="copyPdfWikiReaderItem(\'' + escapeHtml(item.id) + '\')" style="padding:3px 7px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-primary);color:var(--text-secondary);cursor:pointer;font-size:11px;">复制</button>' +
              '<button type="button" onclick="deletePdfWikiReaderItem(\'' + escapeHtml(item.id) + '\')" style="padding:3px 7px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-primary);color:var(--text-secondary);cursor:pointer;font-size:11px;">删除</button>' +
            '</div>' +
          '</div>' +
          (purpose ? '<div style="margin-bottom:5px;font-size:11px;color:var(--text-secondary);">用途：' + escapeHtml(purpose) + '</div>' : '') +
          (tags.length ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">' + tags.map(function(tag) {
            return '<span style="display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:999px;background:rgba(148,163,184,0.15);color:var(--text-secondary);font-size:10px;">#' + escapeHtml(tag) + '</span>';
          }).join('') + '</div>' : '') +
          (item.note ? '<div style="margin-bottom:7px;font-size:12px;line-height:1.45;color:var(--text-primary);font-weight:600;">' + escapeHtml(item.note) + '</div>' : '') +
          '<div style="font-size:12px;line-height:1.55;color:var(--text-secondary);white-space:pre-wrap;max-height:120px;overflow:auto;">' + escapeHtml(item.text || '') + '</div>' +
          '<button type="button" onclick="loadPdfWikiReaderItemToSelection(\'' + escapeHtml(item.id) + '\')" style="margin-top:7px;width:100%;height:28px;border:1px dashed var(--border-color);border-radius:6px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:11px;">载入到当前选中文本</button>' +
        '</div>';
      }).join('');
    }

    async function savePdfWikiReaderItem(type) {
      var pdf = getPdfWikiPdfById(pdfWikiOriginalReaderPdfId);
      if (!pdf) return;
      var text = await getPdfWikiReaderTextForAction();
      if (!text) {
        alert('请先在 PDF 中选中原文；如果没有自动捕获，请复制后粘贴到“当前选中文本”。');
        return;
      }
      var draft = getPdfWikiReaderItemDraft();
      var pageNumber = pdfWikiOriginalReaderCurrentPage || undefined;
      var sentenceId = pdfWikiReaderSelectedSentenceId || '';
      if (!sentenceId && pageNumber) {
        var sentence = findPdfWikiReaderSentenceByText(pageNumber, text);
        if (sentence) sentenceId = sentence.id || '';
      }
      var items = loadPdfWikiReaderItems(pdf.id);
      items.unshift({
        id: Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
        type: type === 'annotation' ? 'annotation' : 'excerpt',
        text: text,
        note: draft.note,
        tags: draft.tags,
        purpose: draft.purpose,
        color: draft.color,
        pageNumber: pageNumber,
        sentenceId: sentenceId,
        pdfTitle: pdf.title || pdf.originalName || '',
        createdAt: new Date().toISOString()
      });
      savePdfWikiReaderItems(pdf.id, items);
      setPdfWikiReaderFieldValue('pdfWikiReaderNoteInput', '');
      renderPdfWikiReaderItems(pdf.id);
      if (pageNumber) {
        renderPdfWikiReaderPageSentenceList(pageNumber);
        renderPdfWikiReaderSavedHighlightsForPage(getPdfWikiReaderPageElement(pageNumber), pageNumber);
      }
      setPdfWikiReaderStatus(type === 'annotation' ? '批注已保存' : '摘录已保存', 'ok');
    }

    async function savePdfWikiReaderSelectionToClaimLibrary() {
      var pdf = getPdfWikiPdfById(pdfWikiOriginalReaderPdfId);
      if (!pdf) return;
      var text = await getPdfWikiReaderTextForAction();
      if (!text) {
        alert('请先用左键选中一句需要保存到论点库的原文。');
        return;
      }
      var button = document.getElementById('pdfWikiReaderSaveClaimBtn');
      if (button) {
        button.disabled = true;
        button.textContent = '保存中...';
      }
      try {
        var response = await fetch('/api/pdf-wiki/reader/save-sentence-claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId || 'web-user',
            pdfId: pdf.id,
            sentence: text,
            pageNumber: pdfWikiOriginalReaderCurrentPage || undefined
          })
        });
        var data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || '保存到论点库失败');
        }
        try {
          var refreshResponse = await fetch('/api/pdf-wiki/entries?userId=' + encodeURIComponent(currentUserId || 'web-user'));
          var refreshData = await refreshResponse.json();
          if (refreshResponse.ok && refreshData.success) {
            pdfWikiViewerData = refreshData;
          }
        } catch (refreshError) {}
        var sourceTitle = data.sourcePdf && (data.sourcePdf.title || data.sourcePdf.originalName) ? (data.sourcePdf.title || data.sourcePdf.originalName) : '当前 PDF';
        setPdfWikiReaderStatus(
          '已保存到句子论点库：' + (data.referenceCount || 0) + ' 条参考文献匹配；来源：' + sourceTitle,
          'ok'
        );
      } catch (e) {
        setPdfWikiReaderStatus(e.message || '保存到论点库失败', 'error');
        alert('保存到论点库失败：' + (e.message || e));
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = '保存到论点库';
        }
      }
    }

    function deletePdfWikiReaderItem(itemId) {
      var pdf = getPdfWikiPdfById(pdfWikiOriginalReaderPdfId);
      if (!pdf) return;
      var items = loadPdfWikiReaderItems(pdf.id).filter(function(item) {
        return item.id !== itemId;
      });
      savePdfWikiReaderItems(pdf.id, items);
      renderPdfWikiReaderItems(pdf.id);
      renderPdfWikiReaderPageSentenceList(pdfWikiOriginalReaderCurrentPage || 1);
      renderPdfWikiReaderSavedHighlightsForAllPages();
      setPdfWikiReaderStatus('已删除该条记录', 'info');
    }

    function focusPdfWikiReaderItemSource(item) {
      if (!item) return false;
      var pageNumber = Number(item.pageNumber || pdfWikiOriginalReaderCurrentPage || 1);
      pdfWikiOriginalReaderCurrentPage = pageNumber;
      scrollPdfWikiReaderToPage(pageNumber);
      setTimeout(function() {
        var pageDiv = getPdfWikiReaderPageElement(pageNumber);
        var sentences = getPdfWikiReaderPageSentences(pageNumber);
        var sentence = null;
        if (item.sentenceId) {
          sentence = sentences.find(function(candidate) {
            return candidate.id === item.sentenceId;
          }) || null;
        }
        if (!sentence) sentence = findPdfWikiReaderSentenceByText(pageNumber, item.text || '');
        if (sentence) {
          pdfWikiReaderSelectedSentenceId = sentence.id || '';
          if (pageDiv) highlightPdfWikiReaderSentence(pageDiv, sentence);
          renderPdfWikiReaderPageSentenceList(pageNumber);
          requestAnimationFrame(function() {
            scrollPdfWikiReaderTextPanelToSentence(sentence.id);
          });
        } else {
          renderPdfWikiReaderPageSentenceList(pageNumber);
        }
      }, 120);
      return true;
    }

    function jumpPdfWikiReaderToItem(itemId) {
      var pdf = getPdfWikiPdfById(pdfWikiOriginalReaderPdfId);
      if (!pdf) return;
      var item = findPdfWikiReaderItemById(pdf.id, itemId);
      if (!item) return;
      setPdfWikiReaderSelectionText(item.text || '', '已载入记录原文');
      focusPdfWikiReaderItemSource(item);
      setPdfWikiReaderStatus('已跳转到记录来源：' + (item.pageNumber ? '第 ' + item.pageNumber + ' 页' : '当前页'), 'ok');
    }

    function loadPdfWikiReaderItemToSelection(itemId) {
      var pdf = getPdfWikiPdfById(pdfWikiOriginalReaderPdfId);
      if (!pdf) return;
      var item = findPdfWikiReaderItemById(pdf.id, itemId);
      if (!item) return;
      setPdfWikiReaderSelectionText(item.text || '', '已载入记录原文');
      setPdfWikiReaderFieldValue('pdfWikiReaderNoteInput', item.note || '');
      setPdfWikiReaderFieldValue('pdfWikiReaderTagInput', (item.tags || []).join(', '));
      setPdfWikiReaderFieldValue('pdfWikiReaderPurposeSelect', item.purpose || 'evidence');
      setPdfWikiReaderFieldValue('pdfWikiReaderColorSelect', item.color || '');
      focusPdfWikiReaderItemSource(item);
    }

    async function copyPdfWikiReaderItem(itemId) {
      var pdf = getPdfWikiPdfById(pdfWikiOriginalReaderPdfId);
      if (!pdf) return;
      var item = findPdfWikiReaderItemById(pdf.id, itemId);
      if (!item) return;
      var text = formatPdfWikiReaderItemMarkdown(item, 0);
      await writePdfWikiReaderClipboard(text, '已复制该条记录');
    }

    async function copyPdfWikiReaderCurrentSelection() {
      var text = await getPdfWikiReaderTextForAction();
      await writePdfWikiReaderClipboard(text, '已复制当前选中文本');
    }

    async function copyPdfWikiReaderAllItems() {
      var pdf = getPdfWikiPdfById(pdfWikiOriginalReaderPdfId);
      if (!pdf) return;
      var items = loadPdfWikiReaderItems(pdf.id);
      if (!items.length) {
        setPdfWikiReaderStatus('还没有可复制的批注或摘录', 'warn');
        return;
      }
      var title = pdf.title || pdf.originalName || 'PDF';
      var markdown = '# ' + title + '｜批注与摘录\n\n' + items.map(formatPdfWikiReaderItemMarkdown).join('\n\n');
      await writePdfWikiReaderClipboard(markdown, '已复制全部批注与摘录');
    }

    function exportPdfWikiReaderItemsMarkdown() {
      var pdf = getPdfWikiPdfById(pdfWikiOriginalReaderPdfId);
      if (!pdf) return;
      var items = loadPdfWikiReaderItems(pdf.id);
      if (!items.length) {
        setPdfWikiReaderStatus('还没有可导出的批注或摘录', 'warn');
        return;
      }
      var title = pdf.title || pdf.originalName || 'PDF';
      var markdown = '# ' + title + '｜批注与摘录\n\n' +
        '来源：' + title + '\n\n' +
        items.map(formatPdfWikiReaderItemMarkdown).join('\n\n');
      var blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = (title || 'pdf-reader-notes').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) + '_notes.md';
      document.body.appendChild(link);
      link.click();
      setTimeout(function() {
        URL.revokeObjectURL(link.href);
        link.remove();
      }, 500);
      setPdfWikiReaderStatus('已导出 Markdown 文件', 'ok');
    }

    async function pastePdfWikiReaderClipboardText() {
      var text = await readPdfWikiReaderClipboardText();
      if (!text) {
        setPdfWikiReaderStatus('剪贴板没有可用文本，或浏览器未授权读取。', 'warn');
        return;
      }
      setPdfWikiReaderSelectionText(text, '已读取剪贴板');
      if (pdfWikiReaderAiEnabled) schedulePdfWikiReaderAiRead();
    }

    function formatPdfWikiReaderAiResult(text) {
      return escapeHtml(text || '')
        .replace(/^##\s*(.+)$/gm, '<div style="margin:10px 0 5px;font-size:12px;font-weight:800;color:var(--text-primary);">$1</div>')
        .replace(/\n/g, '<br>');
    }

    function normalizePdfWikiReaderChatMessages(messages) {
      if (!Array.isArray(messages)) return [];
      return messages.map(function(message) {
        if (!message || (message.role !== 'user' && message.role !== 'assistant')) return null;
        var content = cleanPdfWikiReaderText(message.content || '', 12000);
        if (!content) return null;
        return {
          role: message.role,
          content: content,
          createdAt: message.createdAt || new Date().toISOString()
        };
      }).filter(Boolean).slice(-200);
    }

    async function loadPdfWikiReaderChatSession(pdfId) {
      var targetPdfId = String(pdfId || '').trim();
      if (!targetPdfId) return;
      var token = ++pdfWikiReaderChatLoadToken;
      try {
        var response = await fetch('/api/pdf-wiki/reader/chat-session?userId=' + encodeURIComponent(currentUserId || 'web-user') + '&pdfId=' + encodeURIComponent(targetPdfId));
        var data = await response.json();
        if (token !== pdfWikiReaderChatLoadToken || pdfWikiOriginalReaderPdfId !== targetPdfId) return;
        if (!response.ok || !data.success) {
          throw new Error(data.error || '读取 AI 会话历史失败');
        }
        pdfWikiReaderChatHistory = normalizePdfWikiReaderChatMessages(data.session && data.session.messages);
        renderPdfWikiReaderChatMessages();
        if (pdfWikiReaderChatHistory.length) {
          setPdfWikiReaderStatus('已恢复该 PDF 的 AI 交流历史：' + pdfWikiReaderChatHistory.length + ' 条', 'ok');
        }
      } catch (e) {
        if (token !== pdfWikiReaderChatLoadToken || pdfWikiOriginalReaderPdfId !== targetPdfId) return;
        renderPdfWikiReaderChatMessages();
        setPdfWikiReaderStatus('AI 会话历史读取失败：' + (e.message || e), 'warn');
      }
    }

    function pushPdfWikiReaderChatMessage(role, content) {
      var cleaned = cleanPdfWikiReaderText(content || '', 12000);
      if (!cleaned || (role !== 'user' && role !== 'assistant')) return;
      pdfWikiReaderChatHistory.push({
        role: role,
        content: cleaned,
        createdAt: new Date().toISOString()
      });
      if (pdfWikiReaderChatHistory.length > 200) {
        pdfWikiReaderChatHistory = pdfWikiReaderChatHistory.slice(-200);
      }
      if (role === 'user') {
        pdfWikiReaderChatScrollAnchor = {
          role: 'user',
          content: cleaned,
          createdAt: pdfWikiReaderChatHistory[pdfWikiReaderChatHistory.length - 1].createdAt
        };
      }
      renderPdfWikiReaderChatMessages();
    }

    function resolvePdfWikiReaderChatScrollAnchorIndex() {
      if (!pdfWikiReaderChatScrollAnchor || !pdfWikiReaderChatHistory.length) return -1;
      var anchorContent = cleanPdfWikiReaderText(pdfWikiReaderChatScrollAnchor.content || '', 12000);
      for (var i = pdfWikiReaderChatHistory.length - 1; i >= 0; i--) {
        var message = pdfWikiReaderChatHistory[i];
        if (!message || message.role !== 'user') continue;
        if (!anchorContent || message.content === anchorContent) return i;
      }
      for (var j = pdfWikiReaderChatHistory.length - 1; j >= 0; j--) {
        if (pdfWikiReaderChatHistory[j] && pdfWikiReaderChatHistory[j].role === 'user') return j;
      }
      return -1;
    }

    function scrollPdfWikiReaderChatContainer(container, anchorIndex) {
      if (!container) return;
      if (anchorIndex >= 0) {
        var target = container.querySelector('[data-pdf-reader-chat-index="' + anchorIndex + '"]');
        if (target) {
          var containerRect = container.getBoundingClientRect();
          var targetRect = target.getBoundingClientRect();
          container.scrollTop += targetRect.top - containerRect.top;
          return;
        }
      }
      container.scrollTop = container.scrollHeight;
    }

    function renderPdfWikiReaderChatMessages() {
      var containers = [
        document.getElementById('pdfWikiReaderChatMessages'),
        document.getElementById('pdfWikiReaderChatMessagesExpanded'),
        document.getElementById('pdfWikiReaderChatMessagesExternal')
      ].filter(Boolean);
      if (!containers.length) return;
      var html = '';
      if (!pdfWikiReaderChatHistory.length && !pdfWikiReaderChatPendingLog) {
        html = '<div style="padding:9px;border:1px dashed var(--border-color);border-radius:7px;color:var(--text-secondary);font-size:12px;line-height:1.5;">AI 读完当前内容后，可以在这里继续追问论文中的概念、方法、结果、局限和可引用表达。</div>';
      } else {
        html = pdfWikiReaderChatHistory.map(function(message, index) {
          var isUser = message.role === 'user';
          return '<div data-pdf-reader-chat-index="' + index + '" style="align-self:' + (isUser ? 'flex-end' : 'stretch') + ';max-width:' + (isUser ? '92%' : '100%') + ';padding:8px 9px;border:1px solid ' + (isUser ? 'rgba(37,99,235,0.24)' : 'var(--border-color)') + ';border-radius:8px;background:' + (isUser ? 'rgba(37,99,235,0.10)' : 'var(--bg-secondary)') + ';color:' + (isUser ? '#1d4ed8' : 'var(--text-primary)') + ';font-size:12px;line-height:1.58;white-space:pre-wrap;">' +
            '<div style="margin-bottom:4px;font-size:10px;font-weight:800;color:' + (isUser ? '#1d4ed8' : 'var(--text-secondary)') + ';">' + (isUser ? '你' : '小牛马阅读助手') + '</div>' +
            formatPdfWikiReaderAiResult(message.content) +
          '</div>';
        }).join('');
        if (pdfWikiReaderChatPendingLog) {
          html += '<div style="align-self:stretch;max-width:100%;padding:9px 10px;border:1px solid rgba(37,99,235,0.22);border-radius:8px;background:rgba(37,99,235,0.06);color:var(--text-primary);font-size:12px;line-height:1.58;white-space:pre-wrap;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px;">' +
              '<span style="font-size:10px;font-weight:850;color:#1d4ed8;">' + escapeHtml(pdfWikiReaderChatPendingLog.providerLabel || 'AI') + ' 工作日志</span>' +
              '<span style="font-size:10px;color:var(--text-secondary);">正在生成</span>' +
            '</div>' +
            '<div style="font-family:Consolas,Menlo,Monaco,monospace;font-size:11.5px;line-height:1.58;color:var(--text-secondary);">' + escapeHtml(pdfWikiReaderChatPendingLog.rendered || '') + '<span style="color:#1d4ed8;">|</span></div>' +
          '</div>';
        }
      }
      var anchorIndex = resolvePdfWikiReaderChatScrollAnchorIndex();
      containers.forEach(function(container) {
        container.innerHTML = html;
        scrollPdfWikiReaderChatContainer(container, anchorIndex);
      });
    }

    function formatPdfWikiReaderElapsed(ms) {
      var total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
      var minutes = Math.floor(total / 60);
      var seconds = total % 60;
      return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    }

    function resolvePdfWikiReaderChatProviderFromQuery(query) {
      return normalizePdfWikiReaderChatProvider(pdfWikiReaderChatProvider);
    }

    function appendPdfWikiReaderPendingLogLine(line) {
      if (!pdfWikiReaderChatPendingLog) return;
      var elapsed = formatPdfWikiReaderElapsed(Date.now() - pdfWikiReaderChatPendingLog.startedAt);
      var prefix = '[' + elapsed + '] ';
      pdfWikiReaderChatPendingLog.target += (pdfWikiReaderChatPendingLog.target ? '\n' : '') + prefix + line;
    }

    function stopPdfWikiReaderChatPendingLog() {
      if (pdfWikiReaderChatPendingTimer) {
        clearInterval(pdfWikiReaderChatPendingTimer);
        pdfWikiReaderChatPendingTimer = null;
      }
      pdfWikiReaderChatPendingLog = null;
      renderPdfWikiReaderChatMessages();
    }

    function startPdfWikiReaderChatPendingLog(pdf, provider, query, selectedText, historyCount) {
      stopPdfWikiReaderChatPendingLog();
      var providerLabel = getPdfWikiReaderChatProviderLabel(provider);
      var title = (pdf && (pdf.title || pdf.originalName)) || '当前论文';
      var stages = [
        '收到问题，准备进入论文分析专家模式。',
        '目标模型：' + providerLabel + '；问题长度 ' + cleanPdfWikiReaderText(query || '', 4000).length + ' 字。',
        '读取当前 PDF：' + cleanPdfWikiReaderText(title, 80) + '。',
        selectedText ? ('合并当前选中文本：' + cleanPdfWikiReaderText(selectedText, 12000).length + ' 字。') : '当前没有选中文本，将基于整篇论文上下文回答。',
        '装配近 10 轮阅读对话：' + Math.min(Number(historyCount || 0), 20) + ' 条消息。',
        '读取跨会话长期记忆：优先试验资料总结和试验数据总结，其它长期记忆按需补充。',
        '截取当前论文全文/正文摘录，避免上下文超限。',
        '发送请求，等待 ' + providerLabel + ' 返回正式回复。'
      ];
      pdfWikiReaderChatPendingLog = {
        provider: provider,
        providerLabel: providerLabel,
        startedAt: Date.now(),
        stages: stages,
        stageIndex: 0,
        target: '',
        rendered: '',
        lastAppendAt: 0,
        waitCount: 0
      };
      appendPdfWikiReaderPendingLogLine(stages[0]);
      pdfWikiReaderChatPendingLog.stageIndex = 1;
      pdfWikiReaderChatPendingTimer = setInterval(function() {
        if (!pdfWikiReaderChatPendingLog) return;
        if (pdfWikiReaderChatPendingLog.rendered.length < pdfWikiReaderChatPendingLog.target.length) {
          var nextSize = Math.min(pdfWikiReaderChatPendingLog.target.length, pdfWikiReaderChatPendingLog.rendered.length + 2);
          pdfWikiReaderChatPendingLog.rendered = pdfWikiReaderChatPendingLog.target.slice(0, nextSize);
          renderPdfWikiReaderChatMessages();
          return;
        }
        var now = Date.now();
        if (pdfWikiReaderChatPendingLog.stageIndex < pdfWikiReaderChatPendingLog.stages.length && now - pdfWikiReaderChatPendingLog.lastAppendAt > 420) {
          appendPdfWikiReaderPendingLogLine(pdfWikiReaderChatPendingLog.stages[pdfWikiReaderChatPendingLog.stageIndex]);
          pdfWikiReaderChatPendingLog.stageIndex += 1;
          pdfWikiReaderChatPendingLog.lastAppendAt = now;
          return;
        }
        if (pdfWikiReaderChatPendingLog.stageIndex >= pdfWikiReaderChatPendingLog.stages.length && now - pdfWikiReaderChatPendingLog.lastAppendAt > 2600) {
          pdfWikiReaderChatPendingLog.waitCount += 1;
          var waitLine = pdfWikiReaderChatPendingLog.waitCount % 3 === 1
            ? '模型仍在思考，继续等待回复。'
            : (pdfWikiReaderChatPendingLog.waitCount % 3 === 2
              ? '保持会话连接，等待完整答案返回。'
              : '上下文较长时耗时会增加，请勿关闭当前窗口。');
          appendPdfWikiReaderPendingLogLine(waitLine);
          pdfWikiReaderChatPendingLog.lastAppendAt = now;
        }
      }, 28);
      renderPdfWikiReaderChatMessages();
    }

    function normalizePdfWikiReaderChatProvider(value) {
      var provider = String(value || '').trim().toLowerCase();
      if (provider === 'primary' || provider === 'codex') return provider;
      return 'secondary';
    }

    function getPdfWikiReaderChatProviderLabel(provider) {
      provider = normalizePdfWikiReaderChatProvider(provider);
      if (provider === 'primary') return '草原';
      if (provider === 'codex') return 'Codex CLI';
      return '小牛马';
    }

    function renderPdfWikiReaderProviderSelect(id) {
      var current = normalizePdfWikiReaderChatProvider(pdfWikiReaderChatProvider);
      return '<select id="' + escapeHtml(id) + '" onchange="setPdfWikiReaderChatProvider(this.value)" title="选择阅读原文问答使用的模型" style="height:24px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);padding:0 6px;font-size:11px;">' +
        '<option value="secondary"' + (current === 'secondary' ? ' selected' : '') + '>小牛马</option>' +
        '<option value="primary"' + (current === 'primary' ? ' selected' : '') + '>草原</option>' +
        '<option value="codex"' + (current === 'codex' ? ' selected' : '') + '>Codex CLI</option>' +
      '</select>';
    }

    function syncPdfWikiReaderChatProviderSelects() {
      ['pdfWikiReaderChatProviderSelect', 'pdfWikiReaderChatProviderSelectExpanded', 'pdfWikiReaderChatProviderSelectExternal'].forEach(function(id) {
        var select = document.getElementById(id);
        if (select) select.value = normalizePdfWikiReaderChatProvider(pdfWikiReaderChatProvider);
      });
    }

    window.setPdfWikiReaderChatProvider = function(provider) {
      pdfWikiReaderChatProvider = normalizePdfWikiReaderChatProvider(provider);
      syncPdfWikiReaderChatProviderSelects();
      setPdfWikiReaderStatus('AI 交流模型已切换为：' + getPdfWikiReaderChatProviderLabel(pdfWikiReaderChatProvider) + '。', 'info');
    };

    function getPdfWikiReaderMentionOptions(query) {
      return [];
    }

    function ensurePdfWikiReaderMentionDropdown() {
      var dropdown = document.getElementById('pdfWikiReaderMentionDropdown');
      if (dropdown) return dropdown;
      dropdown = document.createElement('div');
      dropdown.id = 'pdfWikiReaderMentionDropdown';
      dropdown.className = 'mention-dropdown';
      dropdown.style.cssText = 'display:none;position:fixed;left:0;top:0;right:auto;bottom:auto;width:300px;margin:0;z-index:20110;max-height:176px;overflow:auto;';
      dropdown.addEventListener('mousedown', function(event) {
        event.preventDefault();
      });
      document.body.appendChild(dropdown);
      return dropdown;
    }

    function hidePdfWikiReaderMentionDropdown() {
      var dropdown = document.getElementById('pdfWikiReaderMentionDropdown');
      if (dropdown) dropdown.style.display = 'none';
      pdfWikiReaderMentionState.inputId = '';
      pdfWikiReaderMentionState.source = '';
      pdfWikiReaderMentionState.startPos = -1;
      pdfWikiReaderMentionState.activeIndex = 0;
      pdfWikiReaderMentionState.items = [];
    }

    function updatePdfWikiReaderMentionHighlight() {
      var dropdown = document.getElementById('pdfWikiReaderMentionDropdown');
      if (!dropdown) return;
      var nodes = Array.prototype.slice.call(dropdown.querySelectorAll('[data-pdf-reader-mention-index]'));
      nodes.forEach(function(node, index) {
        if (index === pdfWikiReaderMentionState.activeIndex) {
          node.classList.add('active');
          node.scrollIntoView({ block: 'nearest' });
        } else {
          node.classList.remove('active');
        }
      });
    }

    function positionPdfWikiReaderMentionDropdown(input, dropdown) {
      var rect = input.getBoundingClientRect();
      var width = Math.max(260, Math.min(360, rect.width || 300));
      dropdown.style.width = width + 'px';
      dropdown.style.display = 'block';
      var dropdownHeight = dropdown.offsetHeight || 132;
      var top = rect.top - dropdownHeight - 7;
      if (top < 8) top = rect.bottom + 7;
      var left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      dropdown.style.left = left + 'px';
      dropdown.style.top = top + 'px';
    }

    function showPdfWikiReaderMentionDropdown(input, source, startPos, query) {
      var dropdown = ensurePdfWikiReaderMentionDropdown();
      var items = getPdfWikiReaderMentionOptions(query);
      if (!items.length) {
        hidePdfWikiReaderMentionDropdown();
        return;
      }
      pdfWikiReaderMentionState.inputId = input.id;
      pdfWikiReaderMentionState.source = source || 'inline';
      pdfWikiReaderMentionState.startPos = startPos;
      pdfWikiReaderMentionState.activeIndex = 0;
      pdfWikiReaderMentionState.items = items;
      dropdown.innerHTML = items.map(function(item, index) {
        return '<div class="mention-item' + (index === 0 ? ' active' : '') + '" data-pdf-reader-mention-index="' + index + '" onclick="selectPdfWikiReaderMentionOption(' + index + ')">' +
          '<span class="mention-icon">' + escapeHtml(item.icon) + '</span>' +
          '<span class="mention-name">' + escapeHtml(item.label) + '</span>' +
          '<span class="mention-desc">' + escapeHtml(item.desc) + '</span>' +
        '</div>';
      }).join('');
      positionPdfWikiReaderMentionDropdown(input, dropdown);
    }

    function maybeShowPdfWikiReaderMentionDropdown(input, source) {
      if (!input) return;
      var value = input.value || '';
      var pos = input.selectionStart || 0;
      var leadingAtIndex = getLeadingInvocationMarkerIndex(value, '@');
      if (leadingAtIndex < 0 || pos <= leadingAtIndex) {
        hidePdfWikiReaderMentionDropdown();
        return;
      }
      var typed = value.substring(leadingAtIndex + 1, pos);
      if (/\s/.test(typed)) {
        hidePdfWikiReaderMentionDropdown();
        return;
      }
      showPdfWikiReaderMentionDropdown(input, source, leadingAtIndex, typed);
    }

    window.handlePdfWikiReaderChatMentionInput = function(event) {
      hidePdfWikiReaderMentionDropdown();
    };

    window.selectPdfWikiReaderMentionOption = function(index) {
      var item = pdfWikiReaderMentionState.items[index];
      var input = document.getElementById(pdfWikiReaderMentionState.inputId);
      if (!item || !input || pdfWikiReaderMentionState.startPos < 0) return;
      var value = input.value || '';
      var cursor = input.selectionStart || value.length;
      var before = value.substring(0, pdfWikiReaderMentionState.startPos);
      var after = value.substring(cursor);
      var insert = '@' + item.mention + ' ';
      input.value = before + insert + after;
      var nextPos = before.length + insert.length;
      input.setSelectionRange(nextPos, nextPos);
      pdfWikiReaderChatProvider = normalizePdfWikiReaderChatProvider(item.provider);
      syncPdfWikiReaderChatProviderSelects();
      hidePdfWikiReaderMentionDropdown();
      input.focus();
    };

    document.addEventListener('click', function(event) {
      var dropdown = document.getElementById('pdfWikiReaderMentionDropdown');
      if (!dropdown || dropdown.style.display !== 'block') return;
      var target = event.target;
      var input = document.getElementById(pdfWikiReaderMentionState.inputId);
      if ((input && input === target) || dropdown.contains(target)) return;
      hidePdfWikiReaderMentionDropdown();
    });

    function handlePdfWikiReaderMentionKeydown(event) {
      var dropdown = document.getElementById('pdfWikiReaderMentionDropdown');
      if (!dropdown || dropdown.style.display !== 'block') return false;
      if (!event || event.target.id !== pdfWikiReaderMentionState.inputId) return false;
      var items = pdfWikiReaderMentionState.items || [];
      if (event.key === 'Escape') {
        event.preventDefault();
        hidePdfWikiReaderMentionDropdown();
        return true;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        pdfWikiReaderMentionState.activeIndex = items.length
          ? (pdfWikiReaderMentionState.activeIndex + 1) % items.length
          : 0;
        updatePdfWikiReaderMentionHighlight();
        return true;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        pdfWikiReaderMentionState.activeIndex = items.length
          ? (pdfWikiReaderMentionState.activeIndex - 1 + items.length) % items.length
          : 0;
        updatePdfWikiReaderMentionHighlight();
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        if (items.length) {
          window.selectPdfWikiReaderMentionOption(pdfWikiReaderMentionState.activeIndex || 0);
        }
        return true;
      }
      return false;
    }

    function getPdfPaperChatContextStorageKey(conversationId) {
      return 'scholarharness_pdf_paper_chat_' + (currentUserId || 'web-user') + '_' + String(conversationId || '');
    }

    function getPdfPaperChatReturnStorageKey(conversationId) {
      return 'scholarharness_pdf_paper_chat_return_' + (currentUserId || 'web-user') + '_' + String(conversationId || '');
    }

    function getPdfPaperChatIndexStorageKey() {
      return 'scholarharness_pdf_paper_chat_index_' + getPdfWikiMetaCacheScopeKey();
    }

    function normalizePdfPaperChatReturnContext(value) {
      if (!value || typeof value !== 'object') return null;
      var pdfId = String(value.pdfId || '').trim();
      if (!pdfId) return null;
      return {
        source: value.source === 'pdf-reader' ? 'pdf-reader' : 'pdf-manager',
        pdfId: pdfId,
        title: cleanPdfWikiReaderText(value.title || '', 500),
        groupId: String(value.groupId || 'all'),
        searchTerm: String(value.searchTerm || ''),
        searchInputValue: String(value.searchInputValue || ''),
        scrollTop: Number.isFinite(Number(value.scrollTop)) ? Math.max(0, Number(value.scrollTop)) : 0
      };
    }

    function loadPdfPaperChatReturnContextForConversation(conversationId) {
      if (!conversationId) return null;
      try {
        return normalizePdfPaperChatReturnContext(
          JSON.parse(localStorage.getItem(getPdfPaperChatReturnStorageKey(conversationId)) || 'null')
        );
      } catch (error) {
        console.warn('[PdfPaperChat] Failed to restore return context:', error);
        return null;
      }
    }

    function loadPdfPaperChatIndex() {
      try {
        var value = JSON.parse(localStorage.getItem(getPdfPaperChatIndexStorageKey()) || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      } catch (error) {
        console.warn('[PdfPaperChat] Failed to read PDF conversation index:', error);
        return {};
      }
    }

    function savePdfPaperChatIndex(index) {
      localStorage.setItem(getPdfPaperChatIndexStorageKey(), JSON.stringify(index || {}));
    }

    function registerPdfPaperConversation(pdfId, conversationId) {
      var normalizedPdfId = String(pdfId || '').trim();
      var normalizedConversationId = String(conversationId || '').trim();
      if (!normalizedPdfId || !normalizedConversationId) return;
      var index = loadPdfPaperChatIndex();
      var ids = Array.isArray(index[normalizedPdfId]) ? index[normalizedPdfId].map(String) : [];
      ids = ids.filter(function(id) { return id && id !== normalizedConversationId; });
      ids.unshift(normalizedConversationId);
      index[normalizedPdfId] = ids.slice(0, 20);
      savePdfPaperChatIndex(index);
    }

    function unregisterPdfPaperConversation(conversationId) {
      var normalizedConversationId = String(conversationId || '').trim();
      if (!normalizedConversationId) return;
      var index = loadPdfPaperChatIndex();
      var changed = false;
      Object.keys(index).forEach(function(pdfId) {
        var ids = Array.isArray(index[pdfId]) ? index[pdfId].map(String) : [];
        var nextIds = ids.filter(function(id) { return id !== normalizedConversationId; });
        if (nextIds.length !== ids.length) changed = true;
        if (nextIds.length) index[pdfId] = nextIds;
        else delete index[pdfId];
      });
      if (changed) savePdfPaperChatIndex(index);
      localStorage.removeItem(getPdfPaperChatContextStorageKey(normalizedConversationId));
      localStorage.removeItem(getPdfPaperChatReturnStorageKey(normalizedConversationId));
    }

    function findLatestPdfPaperConversationId(pdfId) {
      var normalizedPdfId = String(pdfId || '').trim();
      if (!normalizedPdfId) return '';
      var index = loadPdfPaperChatIndex();
      var indexedIds = Array.isArray(index[normalizedPdfId]) ? index[normalizedPdfId].map(String) : [];
      var historyIds = typeof getHistory === 'function'
        ? getHistory().map(function(item) { return item && item.id ? String(item.id) : ''; }).filter(Boolean)
        : [];
      var candidates = [currentConversationId].concat(indexedIds, historyIds).filter(Boolean);
      var seen = {};
      for (var i = 0; i < candidates.length; i++) {
        var conversationId = String(candidates[i]);
        if (seen[conversationId]) continue;
        seen[conversationId] = true;
        var context = loadPdfPaperChatContextForConversation(conversationId);
        if (context && context.pdfId === normalizedPdfId) {
          registerPdfPaperConversation(normalizedPdfId, conversationId);
          return conversationId;
        }
      }
      return '';
    }

    function capturePdfPaperChatReturnContext(pdfId, title) {
      var viewer = document.getElementById('pdfWikiViewerModal');
      if (!viewer) return null;
      return normalizePdfPaperChatReturnContext({
        source: pdfWikiWorkspaceMode === 'pdf-reader' ? 'pdf-reader' : 'pdf-manager',
        pdfId: pdfId,
        title: title || '',
        groupId: pdfWikiPdfManagerSelectedGroupId,
        searchTerm: pdfWikiPdfManagerSearchTerm,
        searchInputValue: pdfWikiPdfManagerSearchInputValue,
        scrollTop: getPdfWikiPdfManagerScrollTop()
      });
    }

    function renderPdfPaperChatReturnBar() {
      var bar = document.getElementById('pdfPaperChatReturnBar');
      if (!bar) return;
      var context = normalizePdfPaperChatReturnContext(pdfPaperChatReturnContext);
      if (!context && activePdfPaperChatContext) {
        context = normalizePdfPaperChatReturnContext({
          source: 'pdf-manager',
          pdfId: activePdfPaperChatContext.pdfId,
          title: activePdfPaperChatContext.title || activePdfPaperChatContext.originalName || ''
        });
      }
      if (!context) {
        bar.hidden = true;
        bar.innerHTML = '';
        return;
      }
      var destinationLabel = context.source === 'pdf-reader' ? '返回当前 PDF 原文' : '返回 PDF 管理';
      bar.hidden = false;
      bar.innerHTML =
        '<button type="button" class="pdf-paper-chat-return-btn" onclick="returnToPdfPaperSource()" title="' + escapeHtml(destinationLabel) + '">' +
          '<span>' + escapeHtml(destinationLabel) + '</span>' +
        '</button>';
    }

    function setPdfPaperChatReturnContext(value, options) {
      pdfPaperChatReturnContext = normalizePdfPaperChatReturnContext(value);
      if (currentConversationId) {
        var storageKey = getPdfPaperChatReturnStorageKey(currentConversationId);
        if (pdfPaperChatReturnContext) {
          localStorage.setItem(storageKey, JSON.stringify(pdfPaperChatReturnContext));
        } else {
          localStorage.removeItem(storageKey);
        }
      }
      if (!(options && options.skipRender)) renderPdfPaperChatReturnBar();
      return pdfPaperChatReturnContext;
    }

    window.returnToPdfPaperSource = async function() {
      var context = normalizePdfPaperChatReturnContext(pdfPaperChatReturnContext)
        || normalizePdfPaperChatReturnContext({
          source: 'pdf-manager',
          pdfId: activePdfPaperChatContext && activePdfPaperChatContext.pdfId,
          title: activePdfPaperChatContext && (activePdfPaperChatContext.title || activePdfPaperChatContext.originalName)
        });
      if (!context) return;
      if (context.source === 'pdf-reader') {
        await window.openPdfWikiOriginalPdfReader(context.pdfId);
        return;
      }
      pdfWikiPdfManagerSelectedGroupId = context.groupId || 'all';
      pdfWikiPdfManagerSearchTerm = context.searchTerm || '';
      pdfWikiPdfManagerSearchInputValue = context.searchInputValue || '';
      await window.showPdfWikiPdfManager({
        scrollTop: context.scrollTop,
        focusPdfId: context.pdfId
      });
    };

    function normalizePdfPaperChatContext(value) {
      if (!value || typeof value !== 'object') return null;
      var pdfId = String(value.pdfId || '').trim();
      if (!pdfId) return null;
      return {
        pdfId: pdfId,
        title: cleanPdfWikiReaderText(value.title || value.originalName || 'PDF', 500),
        originalName: cleanPdfWikiReaderText(value.originalName || '', 500),
        authors: cleanPdfWikiReaderText(value.authors || '', 1200),
        year: cleanPdfWikiReaderText(value.year || '', 40),
        journal: cleanPdfWikiReaderText(value.journal || '', 500),
        doi: cleanPdfWikiReaderText(value.doi || '', 300),
        selectedText: cleanPdfWikiReaderText(value.selectedText || '', 12000)
      };
    }

    function loadPdfPaperChatContextForConversation(conversationId) {
      if (!conversationId) return null;
      try {
        return normalizePdfPaperChatContext(JSON.parse(localStorage.getItem(getPdfPaperChatContextStorageKey(conversationId)) || 'null'));
      } catch (error) {
        console.warn('[PdfPaperChat] Failed to restore conversation context:', error);
        return null;
      }
    }

    function setActivePdfPaperChatContext(value, options) {
      activePdfPaperChatContext = normalizePdfPaperChatContext(value);
      if (currentConversationId) {
        var storageKey = getPdfPaperChatContextStorageKey(currentConversationId);
        if (activePdfPaperChatContext) {
          localStorage.setItem(storageKey, JSON.stringify(activePdfPaperChatContext));
          registerPdfPaperConversation(activePdfPaperChatContext.pdfId, currentConversationId);
        } else {
          localStorage.removeItem(storageKey);
        }
      }
      if (!(options && options.skipRender) && typeof renderMainContextSourceBar === 'function') {
        renderMainContextSourceBar();
      }
      if (userInput) {
        userInput.placeholder = activePdfPaperChatContext
          ? '询问当前论文，或继续使用主页完整聊天能力'
          : ' ';
      }
      if (!(options && options.skipRender)) renderPdfPaperChatReturnBar();
      return activePdfPaperChatContext;
    }

    function clearActivePdfPaperChatContext() {
      setActivePdfPaperChatContext(null);
    }
    window.clearActivePdfPaperChatContext = clearActivePdfPaperChatContext;

    async function loadActivePdfPaperChatContextForTurn() {
      var descriptor = normalizePdfPaperChatContext(activePdfPaperChatContext);
      if (!descriptor) return null;
      var cached = pdfPaperChatContextCache[descriptor.pdfId];
      if (cached && cached.loadedAt && (Date.now() - cached.loadedAt) < 10 * 60 * 1000) {
        return Object.assign({}, cached.context, {
          selectedText: descriptor.selectedText || cached.context.selectedText || ''
        });
      }
      var params = new URLSearchParams({
        userId: currentUserId || 'web-user',
        pdfId: descriptor.pdfId
      });
      var response = await fetch('/api/pdf-wiki/reader/context?' + params.toString());
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok || !data.success || !data.context) {
        throw new Error(data.error || '读取当前论文上下文失败');
      }
      var hydrated = Object.assign({}, data.context, descriptor, {
        selectedText: descriptor.selectedText || ''
      });
      pdfPaperChatContextCache[descriptor.pdfId] = {
        loadedAt: Date.now(),
        context: hydrated
      };
      return hydrated;
    }

    function getPdfWikiReaderChatInput(source) {
      if (source === 'expanded') return document.getElementById('pdfWikiReaderChatInputExpanded');
      if (source === 'external') return document.getElementById('pdfWikiReaderChatInputExternal');
      return document.getElementById('pdfWikiReaderChatInput');
    }

    function setPdfWikiReaderChatSendingState(sending) {
      ['pdfWikiReaderChatSendBtn', 'pdfWikiReaderChatSendBtnExpanded', 'pdfWikiReaderChatSendBtnExternal'].forEach(function(id) {
        var button = document.getElementById(id);
        if (!button) return;
        button.disabled = !!sending;
        button.textContent = sending ? '发送中' : '发送';
      });
    }

    async function sendPdfWikiReaderChatQuestion(source) {
      if (pdfWikiReaderChatSending) return;
      var pdf = getPdfWikiPdfById(pdfWikiOriginalReaderPdfId);
      if (!pdf) return;
      var input = getPdfWikiReaderChatInput(source === 'expanded' ? 'expanded' : (source === 'external' ? 'external' : 'inline'));
      var query = cleanPdfWikiReaderText(input ? input.value : '', 4000);
      if (!query) {
        setPdfWikiReaderStatus('请输入要追问的问题', 'warn');
        return;
      }
      if (input) input.value = '';
      pdfWikiReaderChatSending = true;
      setPdfWikiReaderChatSendingState(true);
      try {
        pdfWikiReaderChatProvider = resolvePdfWikiReaderChatProviderFromQuery(query);
        await window.openPdfWikiPaperAiChat(pdf.id);
        if (userInput) {
          userInput.value = query;
          if (typeof autoResize === 'function') autoResize();
        }
        if (typeof sendMessage === 'function') {
          await sendMessage();
        }
      } catch (e) {
        console.error('[PdfPaperChat] Failed to continue in homepage chat:', e);
        if (userInput && !userInput.value) userInput.value = query;
        alert('进入主页论文对话失败：' + (e.message || e));
      } finally {
        pdfWikiReaderChatSending = false;
        setPdfWikiReaderChatSendingState(false);
      }
    }

    function handlePdfWikiReaderChatInputKeydown(event) {
      if (!event) return;
      if (handlePdfWikiReaderMentionKeydown(event)) return;
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        var target = event.target && event.target.id === 'pdfWikiReaderChatInputExpanded'
          ? 'expanded'
          : (event.target && event.target.id === 'pdfWikiReaderChatInputExternal' ? 'external' : 'inline');
        sendPdfWikiReaderChatQuestion(target);
      }
    }

    function togglePdfWikiReaderChatExpanded(open) {
      var existing = document.getElementById('pdfWikiReaderChatExpandedPanel');
      if (existing) existing.remove();
      pdfWikiReaderChatExpanded = false;
      if (open === false) return;
      if (pdfWikiOriginalReaderPdfId) {
        window.openPdfWikiPaperAiChat(pdfWikiOriginalReaderPdfId);
      }
    }

    function closePdfWikiPaperAiChat() {
      var panel = document.getElementById('pdfWikiReaderExternalChatPanel');
      if (panel) panel.remove();
      stopPdfWikiReaderChatPendingLog();
      pdfWikiReaderExternalChatPdfId = null;
      clearActivePdfPaperChatContext();
    }

    window.closePdfWikiPaperAiChat = closePdfWikiPaperAiChat;

    window.openPdfWikiPaperAiChatFromButton = function(button) {
      var pdfId = button && button.getAttribute ? button.getAttribute('data-pdf-id') : '';
      window.openPdfWikiPaperAiChat(pdfId);
    };

    window.openPdfWikiPaperAiChat = async function(pdfId) {
      var targetPdfId = String(pdfId || '').trim();
      if (!targetPdfId) return;
      if (!getPdfWikiPdfById(targetPdfId)) {
        await loadPdfWikiPdfManagerDataOnly();
      }
      var pdf = getPdfWikiPdfById(targetPdfId);
      if (!pdf) {
        alert('未找到该 PDF，请先刷新 PDF 管理页面。');
        return;
      }

      var displayTitle = pdf.title || pdf.originalName || 'PDF';
      var returnContext = capturePdfPaperChatReturnContext(targetPdfId, displayTitle);
      var existingConversationId = findLatestPdfPaperConversationId(targetPdfId);
      if (existingConversationId) {
        if (typeof prepareStandaloneWorkspaceSurface === 'function') {
          prepareStandaloneWorkspaceSurface('');
        }
        await loadConversation(existingConversationId);
        if (!activePdfPaperChatContext || activePdfPaperChatContext.pdfId !== targetPdfId) {
          setActivePdfPaperChatContext({
            pdfId: targetPdfId,
            title: displayTitle,
            originalName: pdf.originalName || '',
            authors: pdf.authors || '',
            year: pdf.year || '',
            journal: pdf.journal || '',
            doi: pdf.doi || '',
            selectedText: getPdfWikiReaderTextareaText()
          });
        }
        setPdfPaperChatReturnContext(returnContext || {
          source: 'pdf-manager',
          pdfId: targetPdfId,
          title: displayTitle
        });
        if (typeof resetMainWorkspaceHorizontalPosition === 'function') resetMainWorkspaceHorizontalPosition();
        setTimeout(function() {
          if (userInput) userInput.focus();
        }, 0);
        return;
      }

      var selectedText = getPdfWikiReaderTextareaText();
      var legacySession = null;
      try {
        var sessionParams = new URLSearchParams({
          userId: currentUserId || 'web-user',
          pdfId: targetPdfId
        });
        var sessionResponse = await fetch('/api/pdf-wiki/reader/chat-session?' + sessionParams.toString());
        var sessionData = await sessionResponse.json().catch(function() { return {}; });
        if (sessionResponse.ok && sessionData.success && sessionData.session) {
          legacySession = sessionData.session;
        }
      } catch (error) {
        console.warn('[PdfPaperChat] Failed to import legacy reader chat:', error);
      }

      pdfWikiOriginalReaderPdfId = targetPdfId;
      pdfWikiReaderExternalChatPdfId = targetPdfId;
      pdfWikiReaderChatSending = false;
      pdfWikiReaderChatExpanded = false;
      pdfWikiReaderChatLoadToken += 1;
      stopPdfWikiReaderChatPendingLog();

      if (typeof newChat === 'function') newChat();
      setActivePdfPaperChatContext({
        pdfId: targetPdfId,
        title: displayTitle,
        originalName: pdf.originalName || '',
        authors: pdf.authors || '',
        year: pdf.year || '',
        journal: pdf.journal || '',
        doi: pdf.doi || '',
        selectedText: selectedText
      });
      setPdfPaperChatReturnContext(returnContext || {
        source: 'pdf-manager',
        pdfId: targetPdfId,
        title: displayTitle
      });
      if (typeof setComposerChatProvider === 'function') {
        setComposerChatProvider(pdfWikiReaderChatProvider || 'secondary');
      }

      var importedMessages = legacySession && Array.isArray(legacySession.messages)
        ? legacySession.messages.slice(-20).map(function(message) {
            return {
              role: message && message.role === 'user' ? 'user' : 'assistant',
              content: cleanPdfWikiReaderText(message && message.content || '', 16000),
              isHtml: false,
              timestamp: message && message.createdAt ? new Date(message.createdAt).getTime() : Date.now()
            };
          }).filter(function(message) { return !!message.content; })
        : [];
      var contextMessage = {
        role: 'assistant',
        content: '已将当前论文加入本次主页对话：' + displayTitle + '。之后每次提问都会自动携带论文正文与元数据，并继续使用主页的模型、Reasoning Effort、Skill、MCP、工作目录、附件、Pi Agent 和历史会话能力。',
        isHtml: false,
        timestamp: Date.now()
      };
      var homeMessages = importedMessages.concat([contextMessage]);
      clearChatTurnScrollLock();
      resetMainChatPiQueueHost();
      messagesDiv.innerHTML = '';
      emptyState.style.display = 'none';
      homeMessages.forEach(function(message) {
        appendMessage(message.content, message.role, false, true);
      });
      storeConversationMessagesLocally(currentConversationId, homeMessages, { skipAiTitle: true });
      renderHistory();
      if (typeof resetMainWorkspaceHorizontalPosition === 'function') resetMainWorkspaceHorizontalPosition();
      setTimeout(function() {
        if (userInput) {
          userInput.placeholder = '询问当前论文，或继续使用主页完整聊天能力';
          userInput.focus();
        }
      }, 0);
    };

    async function runPdfWikiReaderAiRead(manual) {
      var pdf = getPdfWikiPdfById(pdfWikiOriginalReaderPdfId);
      if (!pdf) return;
      var text = await getPdfWikiReaderTextForAction();
      if (!text) {
        if (manual) alert('请先选中或粘贴需要 AI 阅读的原文。');
        return;
      }
      if (!manual && text.length < 12) return;
      if (!manual && text === pdfWikiReaderLastAiText) return;
      pdfWikiReaderLastAiText = text;
      var result = document.getElementById('pdfWikiReaderAiResult');
      var button = document.getElementById('pdfWikiReaderAiRunBtn');
      if (button) button.disabled = true;
      if (result) {
        result.innerHTML = '<div style="color:var(--text-secondary);font-size:12px;line-height:1.5;">小牛马正在翻译和总结当前选区...</div>';
      }
      try {
        var response = await fetch('/api/pdf-wiki/reader/ai-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId || 'web-user',
            pdfId: pdf.id,
            pdfTitle: pdf.title || pdf.originalName || '',
            selectedText: text
          })
        });
        var data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'AI 阅读失败');
        }
        if (result) {
          result.innerHTML =
            '<div style="margin-bottom:8px;font-size:11px;color:var(--text-secondary);">模型：' + escapeHtml(data.model || data.label || '小牛马') + '</div>' +
            '<div style="font-size:12px;line-height:1.65;color:var(--text-secondary);">' + formatPdfWikiReaderAiResult(data.result || '') + '</div>';
        }
        if (manual) {
          pushPdfWikiReaderChatMessage('user', '请阅读当前选中文本，并翻译、总结、提取关键点。');
          pushPdfWikiReaderChatMessage('assistant', data.result || '');
        }
        setPdfWikiReaderStatus('AI 阅读已完成', 'ok');
      } catch (e) {
        pdfWikiReaderLastAiText = '';
        if (result) {
          result.innerHTML = '<div style="color:#b91c1c;font-size:12px;line-height:1.5;">' + escapeHtml(e.message || e) + '</div>';
        }
        setPdfWikiReaderStatus(e.message || 'AI 阅读失败', 'error');
      } finally {
        if (button) button.disabled = false;
      }
    }

    function schedulePdfWikiReaderAiRead() {
      if (!pdfWikiReaderAiEnabled) return;
      clearTimeout(pdfWikiReaderAiTimer);
      pdfWikiReaderAiTimer = setTimeout(function() {
        runPdfWikiReaderAiRead(false);
      }, 850);
    }

    function togglePdfWikiReaderAiReading(checked) {
      pdfWikiReaderAiEnabled = !!checked;
      pdfWikiReaderLastAiText = '';
      setPdfWikiReaderStatus(pdfWikiReaderAiEnabled ? 'AI 阅读已开启：选中 PDF 文本后自动翻译+总结。' : 'AI 阅读已关闭。', pdfWikiReaderAiEnabled ? 'ok' : 'info');
      if (pdfWikiReaderAiEnabled) schedulePdfWikiReaderAiRead();
      refreshPdfWikiReaderToolBubbleState();
    }

    function detachPdfWikiReaderSelectionListeners() {
      if (pdfWikiReaderSelectionHandler) {
        document.removeEventListener('selectionchange', pdfWikiReaderSelectionHandler);
        pdfWikiReaderSelectionHandler = null;
      }
      clearTimeout(pdfWikiReaderAiTimer);
      clearTimeout(pdfWikiReaderPendingSelectionTimer);
      pdfWikiReaderPendingSelectionTimers.forEach(function(timer) {
        clearTimeout(timer);
      });
      pdfWikiReaderPendingSelectionTimers = [];
    }

    function cleanupPdfWikiReaderRuntime() {
      detachPdfWikiReaderSelectionListeners();
      if (pdfWikiReaderSidebarClassObserver) {
        pdfWikiReaderSidebarClassObserver.disconnect();
        pdfWikiReaderSidebarClassObserver = null;
      }
      if (pdfWikiReaderFitWidthTimer) {
        clearTimeout(pdfWikiReaderFitWidthTimer);
        pdfWikiReaderFitWidthTimer = null;
      }
      pdfWikiReaderFitWidthPending = false;
      pdfWikiReaderFitWidthInFlight = false;
      pdfWikiReaderChatExpanded = false;
      var expandedChatPanel = document.getElementById('pdfWikiReaderChatExpandedPanel');
      if (expandedChatPanel) expandedChatPanel.remove();
      var externalChatPanel = document.getElementById('pdfWikiReaderExternalChatPanel');
      if (externalChatPanel) externalChatPanel.remove();
      stopPdfWikiReaderChatPendingLog();
      pdfWikiReaderExternalChatPdfId = null;
      if (pdfWikiReaderLayoutResizeHandler) {
        window.removeEventListener('resize', pdfWikiReaderLayoutResizeHandler);
        pdfWikiReaderLayoutResizeHandler = null;
      }
      pdfWikiOriginalReaderRenderToken += 1;
      pdfWikiReaderAiEnabled = false;
      pdfWikiReaderLastAiText = '';
      pdfWikiOriginalReaderPdfViewer = null;
      pdfWikiOriginalReaderEventBus = null;
      if (pdfWikiOriginalReaderPdfDoc && pdfWikiOriginalReaderPdfDoc.destroy) {
        try { pdfWikiOriginalReaderPdfDoc.destroy(); } catch (e) {}
      }
      pdfWikiOriginalReaderPdfDoc = null;
    }

    function attachPdfWikiReaderSelectionListeners() {
      detachPdfWikiReaderSelectionListeners();
      var captureCurrentPdfSelection = function(source) {
        var text = getPdfWikiReaderSelectedTextFromPdf();
        if (!text) return '';
        setPdfWikiReaderSelectionText(text, source || '已捕获 PDF 选区');
        syncPdfWikiReaderTextPanelToPdfSelection(text);
        schedulePdfWikiReaderAiRead();
        return text;
      };
      var scheduleSelectionCapture = function(source, delay) {
        clearTimeout(pdfWikiReaderPendingSelectionTimer);
        pdfWikiReaderPendingSelectionTimer = setTimeout(function() {
          captureCurrentPdfSelection(source);
        }, typeof delay === 'number' ? delay : 80);
      };
      var scheduleSelectionCaptureBurst = function(source) {
        pdfWikiReaderPendingSelectionTimers.forEach(function(timer) {
          clearTimeout(timer);
        });
        pdfWikiReaderPendingSelectionTimers = [];
        [60, 160, 320, 620, 950].forEach(function(delay) {
          var timer = setTimeout(function() {
            captureCurrentPdfSelection(source || '已捕获 PDF 选区');
          }, delay);
          pdfWikiReaderPendingSelectionTimers.push(timer);
        });
      };
      pdfWikiReaderSelectionHandler = function() {
        scheduleSelectionCapture('已捕获 PDF 选区', 120);
      };
      document.addEventListener('selectionchange', pdfWikiReaderSelectionHandler);
      var pdfContainer = document.getElementById('pdfWikiPdfJsContainer');
      if (pdfContainer) {
        pdfContainer.onmousedown = function(event) {
          if (event.button !== 0) return;
          var input = document.getElementById('pdfWikiReaderSelectionText');
          if (input) input.value = '';
          pdfWikiReaderSelectedSentenceId = '';
          clearPdfWikiReaderSentenceHighlights();
          renderPdfWikiReaderPageSentenceList(pdfWikiOriginalReaderCurrentPage);
          pdfWikiReaderLastAiText = '';
          setPdfWikiReaderStatus('正在选择 PDF 文本...', 'info');
        };
        pdfContainer.onmouseup = function() {
          scheduleSelectionCaptureBurst('已捕获 PDF 选区');
        };
        pdfContainer.onpointerup = function(event) {
          if (event.button !== 0) return;
          scheduleSelectionCaptureBurst('已捕获 PDF 选区');
        };
        pdfContainer.onclick = function(event) {
          if (getPdfWikiReaderSelectedTextFromPdf()) {
            scheduleSelectionCaptureBurst('已捕获 PDF 选区');
            return;
          }
          if (selectPdfWikiReaderSentenceAtEvent(event)) return;
          scheduleSelectionCaptureBurst('已捕获 PDF 选区');
        };
        pdfContainer.ondblclick = function(event) {
          if (selectPdfWikiReaderSentenceAtEvent(event)) return;
          scheduleSelectionCaptureBurst('已捕获 PDF 选区');
        };
        pdfContainer.onkeyup = function() {
          scheduleSelectionCaptureBurst('已捕获 PDF 选区');
        };
      }
      var manualInput = document.getElementById('pdfWikiReaderSelectionText');
      if (manualInput) {
        manualInput.oninput = function() {
          pdfWikiReaderSelectedSentenceId = '';
          clearPdfWikiReaderSentenceHighlights();
          renderPdfWikiReaderPageSentenceList(pdfWikiOriginalReaderCurrentPage);
          setPdfWikiReaderStatus('当前文本已更新：' + cleanPdfWikiReaderText(manualInput.value).length + ' 字符', 'info');
          schedulePdfWikiReaderAiRead();
        };
      }
    }

    async function ensurePdfWikiPdfJsAssets() {
      if (!Promise.withResolvers) {
        Promise.withResolvers = function() {
          var resolve;
          var reject;
          var promise = new Promise(function(res, rej) {
            resolve = res;
            reject = rej;
          });
          return { promise: promise, resolve: resolve, reject: reject };
        };
      }
      if (!document.getElementById('pdfWikiPdfViewerCss')) {
        var link = document.createElement('link');
        link.id = 'pdfWikiPdfViewerCss';
        link.rel = 'stylesheet';
        link.href = '/vendor/pdfjs/legacy/web/pdf_viewer.css';
        document.head.appendChild(link);
      }
      if (window.pdfjsLib) {
        return { pdfjsLib: window.pdfjsLib };
      }
      window.pdfjsLib = await import('/vendor/pdfjs/legacy/build/pdf.mjs');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/legacy/build/pdf.worker.mjs';
      return { pdfjsLib: window.pdfjsLib };
    }

    function updatePdfWikiReaderPageControls() {
      var pageInput = document.getElementById('pdfWikiReaderPageNumber');
      var pageTotal = document.getElementById('pdfWikiReaderPageTotal');
      var zoomStatus = document.getElementById('pdfWikiReaderZoomStatus');
      var pagesCount = pdfWikiOriginalReaderPdfDoc ? (pdfWikiOriginalReaderPdfDoc.numPages || 0) : 0;
      if (pageInput) pageInput.value = String(pdfWikiOriginalReaderCurrentPage || 1);
      if (pageTotal) pageTotal.textContent = String(pagesCount);
      if (zoomStatus) {
        zoomStatus.textContent = Math.round((pdfWikiOriginalReaderScale || 1) * 100) + '%';
      }
    }

    function changePdfWikiReaderPage(delta) {
      var pdfDoc = pdfWikiOriginalReaderPdfDoc;
      if (!pdfDoc) return;
      var next = Math.max(1, Math.min(pdfDoc.numPages || 1, (pdfWikiOriginalReaderCurrentPage || 1) + delta));
      scrollPdfWikiReaderToPage(next);
      updatePdfWikiReaderPageControls();
    }

    function setPdfWikiReaderPageFromInput(input) {
      var pdfDoc = pdfWikiOriginalReaderPdfDoc;
      if (!pdfDoc || !input) return;
      var next = Number(input.value || 1);
      if (!Number.isFinite(next)) next = 1;
      scrollPdfWikiReaderToPage(Math.max(1, Math.min(pdfDoc.numPages || 1, Math.round(next))));
      updatePdfWikiReaderPageControls();
    }

    function zoomPdfWikiReader(delta) {
      if (!pdfWikiOriginalReaderPdfDoc) return;
      pdfWikiOriginalReaderScale = Math.max(0.35, Math.min(4, (pdfWikiOriginalReaderScale || 1) + delta));
      renderPdfWikiOriginalPdfJsPages(pdfWikiOriginalReaderPdfDoc, pdfWikiOriginalReaderScale, pdfWikiOriginalReaderCurrentPage);
    }

    async function fitPdfWikiReaderWidth() {
      var pdfDoc = pdfWikiOriginalReaderPdfDoc;
      var container = document.getElementById('pdfWikiPdfJsContainer');
      if (!pdfDoc || !container) return;
      if (pdfWikiReaderFitWidthInFlight) {
        pdfWikiReaderFitWidthPending = true;
        return;
      }
      pdfWikiReaderFitWidthInFlight = true;
      try {
        var firstPage = await pdfDoc.getPage(1);
        if (pdfDoc !== pdfWikiOriginalReaderPdfDoc) return;
        var baseViewport = firstPage.getViewport({ scale: 1 });
        var availableWidth = Math.max(360, container.clientWidth - 46);
        pdfWikiOriginalReaderScale = Math.max(0.35, Math.min(3, availableWidth / baseViewport.width));
        await renderPdfWikiOriginalPdfJsPages(pdfDoc, pdfWikiOriginalReaderScale, pdfWikiOriginalReaderCurrentPage);
      } catch (e) {
        updatePdfWikiReaderPageControls();
      } finally {
        pdfWikiReaderFitWidthInFlight = false;
        if (pdfWikiReaderFitWidthPending && pdfWikiOriginalReaderPdfDoc === pdfDoc) {
          pdfWikiReaderFitWidthPending = false;
          schedulePdfWikiReaderFitWidth(80);
        } else {
          pdfWikiReaderFitWidthPending = false;
        }
      }
    }

    function renderPdfWikiOriginalPdfPluginFallback(sourceUrl) {
      var container = document.getElementById('pdfWikiPdfJsContainer');
      if (!container) return;
      container.innerHTML = '<embed title="PDF 原文" type="application/pdf" src="' + escapeHtml(sourceUrl) + '#toolbar=1&navpanes=1&view=FitH" style="display:block;width:100%;height:100%;border:0;background:white;">';
    }

    function isPdfWikiReaderToolExpanded(key) {
      return pdfWikiReaderToolPanels[key] !== false;
    }

    function getPdfWikiReaderToolBubbleStyle(active) {
      return 'height:30px;display:inline-flex;align-items:center;justify-content:center;padding:0 10px;border:1px solid ' +
        (active ? 'rgba(37,99,235,0.34)' : 'var(--border-color)') +
        ';border-radius:999px;background:' + (active ? 'rgba(37,99,235,0.12)' : 'var(--bg-secondary)') +
        ';color:' + (active ? '#1d4ed8' : 'var(--text-primary)') +
        ';cursor:pointer;font-size:12px;font-weight:800;white-space:nowrap;';
    }

    function renderPdfWikiReaderToolBubble(key, label, title) {
      var active = isPdfWikiReaderToolExpanded(key);
      return '<button id="pdfWikiReaderToolBubble_' + escapeHtml(key) + '" data-pdf-wiki-reader-tool="' + escapeHtml(key) + '" type="button" ' +
        'onclick="togglePdfWikiReaderToolBubble(\'' + escapeHtml(key) + '\')" aria-expanded="' + (active ? 'true' : 'false') + '" title="' + escapeHtml(title || label) + '" ' +
        'style="' + getPdfWikiReaderToolBubbleStyle(active) + '">' + escapeHtml(label) + '</button>';
    }

    function renderPdfWikiReaderToolSection(key, bodyHtml) {
      return '<section id="pdfWikiReaderToolPanel_' + escapeHtml(key) + '" data-pdf-wiki-reader-panel="' + escapeHtml(key) + '" style="display:' +
        (isPdfWikiReaderToolExpanded(key) ? 'block' : 'none') +
        ';padding:9px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);">' + bodyHtml + '</section>';
    }

    function renderPdfWikiReaderToolActionButton(label, onclick, options) {
      options = options || {};
      var active = !!options.active;
      var accent = !!options.accent;
      var border = accent ? 'rgba(37,99,235,0.32)' : 'var(--border-color)';
      var bg = accent ? (active ? 'rgba(37,99,235,0.18)' : 'rgba(37,99,235,0.08)') : (active ? 'rgba(15,118,110,0.14)' : 'var(--bg-primary)');
      var color = accent ? '#1d4ed8' : (active ? '#0f766e' : 'var(--text-primary)');
      return '<button ' + (options.id ? 'id="' + escapeHtml(options.id) + '" ' : '') +
        'type="button" onclick="' + escapeHtml(onclick || '') + '" title="' + escapeHtml(options.title || label) + '" ' +
        'style="min-height:30px;padding:0 9px;border:1px solid ' + border + ';border-radius:7px;background:' + bg + ';color:' + color + ';cursor:pointer;font-size:12px;font-weight:800;line-height:1.25;">' +
        escapeHtml(label) +
      '</button>';
    }

    function applyPdfWikiReaderModeButtonState(button, active, activeText, inactiveText, accent) {
      if (!button) return;
      button.textContent = active ? activeText : inactiveText;
      button.style.background = accent
        ? (active ? 'rgba(37,99,235,0.18)' : 'rgba(37,99,235,0.08)')
        : (active ? 'rgba(15,118,110,0.14)' : 'var(--bg-primary)');
      button.style.color = accent ? '#1d4ed8' : (active ? '#0f766e' : 'var(--text-primary)');
      button.style.borderColor = accent ? 'rgba(37,99,235,0.32)' : 'var(--border-color)';
    }

    function refreshPdfWikiReaderToolBubbleState() {
      Object.keys(pdfWikiReaderToolPanels).forEach(function(key) {
        var active = isPdfWikiReaderToolExpanded(key);
        var bubble = document.querySelector('[data-pdf-wiki-reader-tool="' + key + '"]');
        if (bubble) {
          bubble.style.cssText = getPdfWikiReaderToolBubbleStyle(active);
          bubble.setAttribute('aria-expanded', active ? 'true' : 'false');
        }
        var panel = document.querySelector('[data-pdf-wiki-reader-panel="' + key + '"]');
        if (panel) panel.style.display = active ? 'block' : 'none';
      });
      applyPdfWikiReaderModeButtonState(
        document.getElementById('pdfWikiReaderSentenceModeBtn'),
        pdfWikiReaderSentenceSelectEnabled,
        'PDF点句：开',
        'PDF点句：关',
        false
      );
      applyPdfWikiReaderModeButtonState(
        document.getElementById('pdfWikiReaderAiModeBtn'),
        pdfWikiReaderAiEnabled,
        'AI阅读：开',
        'AI阅读：关',
        true
      );
    }

    function togglePdfWikiReaderToolBubble(key) {
      if (!Object.prototype.hasOwnProperty.call(pdfWikiReaderToolPanels, key)) return;
      pdfWikiReaderToolPanels[key] = !isPdfWikiReaderToolExpanded(key);
      refreshPdfWikiReaderToolBubbleState();
    }

    function togglePdfWikiReaderSentenceSelectFromTool() {
      var next = !pdfWikiReaderSentenceSelectEnabled;
      var checkbox = document.getElementById('pdfWikiReaderSentenceToggle');
      if (checkbox) checkbox.checked = next;
      togglePdfWikiReaderSentenceSelect(next);
    }

    function togglePdfWikiReaderAiReadingFromTool() {
      var next = !pdfWikiReaderAiEnabled;
      var checkbox = document.getElementById('pdfWikiReaderAiToggle');
      if (checkbox) checkbox.checked = next;
      togglePdfWikiReaderAiReading(next);
    }

    function scrollPdfWikiReaderToPage(pageNumber) {
      var pageEl = document.querySelector('.pdfWikiReaderPage[data-page-number="' + pageNumber + '"]');
      if (!pageEl) return;
      pdfWikiOriginalReaderCurrentPage = pageNumber;
      pageEl.scrollIntoView({ block: 'start' });
      updatePdfWikiReaderPageControls();
      renderPdfWikiReaderPageSentenceList(pageNumber);
    }

    function updatePdfWikiReaderCurrentPageFromScroll() {
      var container = document.getElementById('pdfWikiPdfJsContainer');
      if (!container) return;
      var pages = Array.prototype.slice.call(container.querySelectorAll('.pdfWikiReaderPage'));
      if (!pages.length) return;
      var containerRect = container.getBoundingClientRect();
      var bestPage = pdfWikiOriginalReaderCurrentPage || 1;
      var bestDistance = Infinity;
      pages.forEach(function(pageEl) {
        var rect = pageEl.getBoundingClientRect();
        var distance = Math.abs(rect.top - containerRect.top - 12);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestPage = Number(pageEl.dataset.pageNumber || 1);
        }
      });
      if (bestPage !== pdfWikiOriginalReaderCurrentPage) {
        pdfWikiOriginalReaderCurrentPage = bestPage;
        updatePdfWikiReaderPageControls();
        renderPdfWikiReaderPageSentenceList(bestPage);
      }
    }

    async function renderPdfWikiOriginalPdfJsPages(pdfDoc, scale, keepPage) {
      var container = document.getElementById('pdfWikiPdfJsContainer');
      var viewerEl = document.getElementById('pdfWikiPdfJsViewer');
      var status = document.getElementById('pdfWikiOriginalPdfPageStatus');
      if (!container || !viewerEl || !pdfDoc) return;
      var renderToken = ++pdfWikiOriginalReaderRenderToken;
      var targetPage = Math.max(1, Math.min(pdfDoc.numPages || 1, keepPage || pdfWikiOriginalReaderCurrentPage || 1));
      viewerEl.innerHTML = '';
      pdfWikiReaderSelectedSentenceId = '';
      pdfWikiReaderSectionByPage = {};
      pdfWikiReaderLastKnownSection = '';
      renderPdfWikiReaderPageSentenceList(targetPage);
      viewerEl.style.cssText = 'padding:18px 18px 36px;display:flex;flex-direction:column;align-items:center;gap:18px;';
      if (status) {
        status.style.display = 'block';
        status.textContent = '正在渲染 PDF 页面...';
      }
      container.onscroll = updatePdfWikiReaderCurrentPageFromScroll;

      for (var pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
        if (renderToken !== pdfWikiOriginalReaderRenderToken) return;
        var page = await pdfDoc.getPage(pageNumber);
        if (renderToken !== pdfWikiOriginalReaderRenderToken) return;
        var viewport = page.getViewport({ scale: scale });
        var pageDiv = document.createElement('div');
        pageDiv.className = 'pdfWikiReaderPage';
        pageDiv.dataset.pageNumber = String(pageNumber);
        pageDiv.style.cssText = 'position:relative;background:white;box-shadow:0 10px 28px rgba(15,23,42,0.18);overflow:hidden;width:' + viewport.width + 'px;height:' + viewport.height + 'px;';

        var canvas = document.createElement('canvas');
        var outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.cssText = 'position:absolute;left:0;top:0;width:' + viewport.width + 'px;height:' + viewport.height + 'px;display:block;';
        pageDiv.appendChild(canvas);

        var textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';
        textLayerDiv.style.cssText = 'position:absolute;left:0;top:0;width:' + viewport.width + 'px;height:' + viewport.height + 'px;';
        pageDiv.appendChild(textLayerDiv);
        viewerEl.appendChild(pageDiv);

        var context = canvas.getContext('2d');
        await page.render({
          canvasContext: context,
          viewport: viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null
        }).promise;
        if (renderToken !== pdfWikiOriginalReaderRenderToken) return;

        var textContent = await page.getTextContent();
        if (renderToken !== pdfWikiOriginalReaderRenderToken) return;
        var textLayer = new window.pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport: viewport
        });
        await textLayer.render();
        await new Promise(function(resolve) {
          requestAnimationFrame(resolve);
        });
        buildPdfWikiReaderPageSentences(pageDiv, pageNumber, textLayer.textDivs || textLayerDiv.querySelectorAll('span'));
        renderPdfWikiReaderSavedHighlightsForPage(pageDiv, pageNumber);
        if (pageNumber === targetPage || pageNumber === pdfWikiOriginalReaderCurrentPage || pageNumber === pdfWikiReaderSentenceListRenderedPage) {
          renderPdfWikiReaderPageSentenceList(pageNumber);
        }
        if (status) status.textContent = '正在渲染 PDF 页面... ' + pageNumber + '/' + pdfDoc.numPages;
      }

      if (renderToken !== pdfWikiOriginalReaderRenderToken) return;
      if (status) status.style.display = 'none';
      pdfWikiOriginalReaderCurrentPage = targetPage;
      updatePdfWikiReaderPageControls();
      requestAnimationFrame(function() {
        scrollPdfWikiReaderToPage(targetPage);
      });
    }

    async function initPdfWikiOriginalPdfJsReader(pdfId, sourceUrl) {
      var status = document.getElementById('pdfWikiOriginalPdfPageStatus');
      var container = document.getElementById('pdfWikiPdfJsContainer');
      if (!container) return;
      try {
        if (status) status.textContent = '正在加载 PDF.js 阅读器...';
        var assets = await ensurePdfWikiPdfJsAssets();
        if (pdfWikiOriginalReaderPdfDoc && pdfWikiOriginalReaderPdfDoc.destroy) {
          try { await pdfWikiOriginalReaderPdfDoc.destroy(); } catch (e) {}
        }
        if (status) status.textContent = '正在读取 PDF 原文...';
        var loadingTask = assets.pdfjsLib.getDocument({ url: sourceUrl });
        var pdfDoc = await loadingTask.promise;
        if (pdfWikiOriginalReaderPdfId !== pdfId) {
          if (pdfDoc && pdfDoc.destroy) pdfDoc.destroy();
          return;
        }
        pdfWikiOriginalReaderPdfDoc = pdfDoc;
        pdfWikiOriginalReaderPdfViewer = null;
        pdfWikiOriginalReaderEventBus = null;
        pdfWikiOriginalReaderCurrentPage = 1;
        var firstPage = await pdfDoc.getPage(1);
        var firstViewport = firstPage.getViewport({ scale: 1 });
        var availableWidth = Math.max(360, container.clientWidth - 46);
        pdfWikiOriginalReaderScale = Math.max(0.35, Math.min(3, availableWidth / firstViewport.width));
        await renderPdfWikiOriginalPdfJsPages(pdfDoc, pdfWikiOriginalReaderScale, 1);
        setPdfWikiReaderStatus('PDF 已载入。优先在右侧当前页原文中拖选；左侧 PDF 可点选整句或拖选。', 'ok');
      } catch (e) {
        console.error('[PdfWikiReader] PDF.js load failed:', e);
        if (status) {
          status.textContent = 'PDF.js 载入失败：' + (e && e.message ? e.message : e);
          setTimeout(function() { status.style.display = 'none'; }, 1800);
        }
        setPdfWikiReaderStatus('PDF.js 载入失败，已切换到内置 PDF 插件。原因：' + (e && e.message ? e.message : e), 'warn');
        renderPdfWikiOriginalPdfPluginFallback(sourceUrl);
      }
    }

    function renderPdfWikiOriginalPdfPage(pdfId) {
      setPdfWikiWorkspaceMode('pdf-reader');
      pdfWikiOriginalReaderPdfId = pdfId || pdfWikiOriginalReaderPdfId;
      pdfWikiReaderSentenceSelectEnabled = true;
      pdfWikiReaderSelectedSentenceId = '';
      pdfWikiReaderSentenceListRenderedPage = 0;
      pdfWikiReaderChatHistory = [];
      pdfWikiReaderChatSending = false;
      pdfWikiReaderChatExpanded = false;
      pdfWikiReaderChatLoadToken += 1;
      stopPdfWikiReaderChatPendingLog();
      var existingChatPanel = document.getElementById('pdfWikiReaderChatExpandedPanel');
      if (existingChatPanel) existingChatPanel.remove();
      var pdf = getPdfWikiPdfById(pdfWikiOriginalReaderPdfId);
      var content = document.getElementById('pdfWikiViewerContent');
      var title = document.getElementById('pdfWikiViewerTitle');
      var subtitle = document.getElementById('pdfWikiViewerSubtitle');
      if (!content) return;
      if (!pdf) {
        if (title) title.textContent = '阅读全文';
        if (subtitle) subtitle.textContent = '未找到对应 PDF';
        content.innerHTML =
          '<div style="padding:28px;text-align:center;color:var(--text-secondary);">' +
            '<div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:8px;">未找到对应 PDF</div>' +
            '<button type="button" onclick="showPdfWikiPdfManager()" style="padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">返回 PDF 管理</button>' +
          '</div>';
        return;
      }
      var sourceUrl = pdf.sourceUrl || ('/api/pdf-wiki/pdfs/' + encodeURIComponent(pdf.id) + '/source?userId=' + encodeURIComponent(currentUserId));
      var displayTitle = pdf.title || pdf.originalName || 'PDF';
      if (title) title.textContent = '阅读全文';
      if (subtitle) subtitle.textContent = displayTitle;
      content.innerHTML =
        '<div style="width:100%;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--bg-secondary);">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border-color);background:var(--bg-primary);">' +
            '<div style="min-width:0;display:flex;align-items:center;gap:9px;">' +
              '<button type="button" onclick="showPdfWikiPdfManager()" style="padding:7px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;white-space:nowrap;">返回 PDF 管理</button>' +
              '<div style="min-width:0;">' +
                '<div style="font-size:13px;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(displayTitle) + '</div>' +
                '<div style="margin-top:2px;font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml([pdf.authors, pdf.year, pdf.journal].filter(Boolean).join(' · ') || pdf.originalName || '') + '</div>' +
              '</div>' +
            '</div>' +
            '<div style="flex-shrink:0;"></div>' +
          '</div>' +
          '<div id="pdfWikiReaderLayout" style="flex:1;min-height:0;display:grid;grid-template-columns:minmax(320px,1fr) 6px 360px;gap:0;">' +
            '<section id="pdfWikiOriginalPdfPageSection" style="min-width:0;min-height:0;background:#e5e7eb;position:relative;">' +
              '<div id="pdfWikiOriginalPdfPageStatus" style="position:absolute;top:62px;left:50%;z-index:5;transform:translateX(-50%);padding:7px 11px;border:1px solid rgba(15,23,42,0.12);border-radius:999px;background:rgba(255,255,255,0.94);box-shadow:0 8px 28px rgba(15,23,42,0.12);font-size:12px;color:#334155;">正在加载 PDF...</div>' +
              '<div style="position:absolute;top:0;left:0;right:0;height:52px;z-index:3;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border-bottom:1px solid rgba(15,23,42,0.12);background:rgba(255,255,255,0.96);box-shadow:0 6px 18px rgba(15,23,42,0.08);">' +
                '<div style="display:flex;align-items:center;gap:6px;min-width:0;">' +
                  '<button type="button" onclick="changePdfWikiReaderPage(-1)" style="width:30px;height:30px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:14px;">&lt;</button>' +
                  '<input id="pdfWikiReaderPageNumber" type="number" min="1" value="1" onchange="setPdfWikiReaderPageFromInput(this)" style="width:58px;height:30px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);padding:0 6px;font-size:12px;text-align:center;">' +
                  '<span style="font-size:12px;color:var(--text-secondary);">/ <span id="pdfWikiReaderPageTotal">0</span></span>' +
                  '<button type="button" onclick="changePdfWikiReaderPage(1)" style="width:30px;height:30px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:14px;">&gt;</button>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">' +
                  '<button type="button" onclick="zoomPdfWikiReader(-0.15)" style="width:30px;height:30px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:15px;">-</button>' +
                  '<span id="pdfWikiReaderZoomStatus" style="min-width:46px;text-align:center;font-size:12px;color:var(--text-secondary);">100%</span>' +
                  '<button type="button" onclick="zoomPdfWikiReader(0.15)" style="width:30px;height:30px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:15px;">+</button>' +
                  '<button type="button" onclick="fitPdfWikiReaderWidth()" style="height:30px;padding:0 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">适合宽度</button>' +
                '</div>' +
              '</div>' +
              '<div id="pdfWikiPdfJsContainer" style="position:absolute;left:0;right:0;top:52px;bottom:0;overflow:auto;background:#e5e7eb;">' +
                '<div id="pdfWikiPdfJsViewer" class="pdfViewer"></div>' +
              '</div>' +
            '</section>' +
            '<div id="pdfWikiReaderResizeHandle" title="拖动调节阅读工具宽度" style="min-width:6px;width:6px;cursor:col-resize;background:rgba(148,163,184,0.10);border-left:1px solid rgba(148,163,184,0.24);border-right:1px solid rgba(148,163,184,0.24);position:relative;">' +
              '<div style="position:absolute;top:50%;left:50%;width:2px;height:42px;transform:translate(-50%,-50%);border-radius:999px;background:rgba(100,116,139,0.45);"></div>' +
            '</div>' +
            '<aside style="min-width:0;min-height:0;overflow:hidden;border-left:1px solid var(--border-color);background:var(--bg-primary);display:flex;flex-direction:column;">' +
              '<div style="padding:12px;border-bottom:1px solid var(--border-color);">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
                  '<div style="font-size:13px;font-weight:800;color:var(--text-primary);">阅读工具</div>' +
                  '<div style="display:none;">' +
                    '<input id="pdfWikiReaderSentenceToggle" type="checkbox" ' + (pdfWikiReaderSentenceSelectEnabled ? 'checked ' : '') + 'onchange="togglePdfWikiReaderSentenceSelect(this.checked)">' +
                    '<input id="pdfWikiReaderAiToggle" type="checkbox" ' + (pdfWikiReaderAiEnabled ? 'checked ' : '') + 'onchange="togglePdfWikiReaderAiReading(this.checked)">' +
                  '</div>' +
                '</div>' +
                '<div id="pdfWikiReaderStatus" style="margin-top:8px;padding:7px 8px;border:1px solid rgba(59,130,246,0.24);border-radius:7px;background:rgba(59,130,246,0.12);color:#1d4ed8;font-size:11px;line-height:1.45;">优先在右侧当前页原文中拖选；左侧 PDF 可点选整句或拖选。</div>' +
                '<div id="pdfWikiReaderToolBubbles" style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:9px;">' +
                  renderPdfWikiReaderToolBubble('settings', '阅读设置', '展开阅读设置') +
                  renderPdfWikiReaderToolBubble('source', '原文', '展开当前页原文') +
                  renderPdfWikiReaderToolBubble('selection', '选中文本', '展开当前选中文本') +
                  renderPdfWikiReaderToolBubble('save', '保存', '展开保存批注、摘录和论点库') +
                  renderPdfWikiReaderToolBubble('ai', 'AI阅读', '展开 AI 阅读') +
                  renderPdfWikiReaderToolBubble('notes', '批注摘录', '展开批注与摘录列表') +
                '</div>' +
              '</div>' +
              '<div style="min-width:0;padding:12px;display:flex;flex-direction:column;gap:10px;overflow-x:hidden;overflow-y:auto;">' +
                renderPdfWikiReaderToolSection('settings',
                  '<div style="margin-bottom:7px;font-size:12px;font-weight:700;color:var(--text-primary);">阅读设置</div>' +
                  '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;">' +
                    '<button type="button" data-pdf-id="' + escapeHtml(pdf.id || '') + '" onclick="renderPdfWikiOriginalPdfPage(this.dataset.pdfId)" style="min-height:30px;padding:0 9px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-primary);color:var(--text-primary);cursor:pointer;font-size:12px;font-weight:800;line-height:1.25;">重新加载</button>' +
                    renderPdfWikiReaderToolActionButton(pdfWikiReaderSentenceSelectEnabled ? 'PDF点句：开' : 'PDF点句：关', 'togglePdfWikiReaderSentenceSelectFromTool()', { id: 'pdfWikiReaderSentenceModeBtn', active: pdfWikiReaderSentenceSelectEnabled }) +
                    renderPdfWikiReaderToolActionButton('适合宽度', 'fitPdfWikiReaderWidth()') +
                  '</div>'
                ) +
                renderPdfWikiReaderToolSection('source',
                  '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">' +
                    '<div style="font-size:12px;font-weight:700;color:var(--text-primary);">当前页原文</div>' +
                    '<div id="pdfWikiReaderPageSentencesMeta" style="font-size:11px;color:var(--text-secondary);white-space:nowrap;">第 1 页</div>' +
                  '</div>' +
                  '<div id="pdfWikiReaderPageSentences" style="max-height:238px;overflow:auto;display:block;padding:1px 2px 2px 1px;">' +
                    '<div style="padding:10px;color:var(--text-secondary);font-size:12px;line-height:1.5;">正在整理当前页原文...</div>' +
                  '</div>'
                ) +
                renderPdfWikiReaderToolSection('selection',
                  '<div style="margin-bottom:5px;font-size:12px;font-weight:700;color:var(--text-primary);">当前选中文本</div>' +
                  '<textarea id="pdfWikiReaderSelectionText" placeholder="在上方当前页原文中拖选，或单击一句自动填入整句。" style="width:100%;height:112px;resize:vertical;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);padding:8px;font-size:12px;line-height:1.5;"></textarea>' +
                  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px;">' +
                    renderPdfWikiReaderToolActionButton('复制当前文本', 'copyPdfWikiReaderCurrentSelection()') +
                    renderPdfWikiReaderToolActionButton('读取剪贴板', 'pastePdfWikiReaderClipboardText()') +
                  '</div>'
                ) +
                renderPdfWikiReaderToolSection('save',
                  '<div style="margin-bottom:6px;font-size:12px;font-weight:700;color:var(--text-primary);">保存设置</div>' +
                  '<textarea id="pdfWikiReaderNoteInput" placeholder="批注备注、处理意见、为什么重要..." style="width:100%;height:58px;resize:vertical;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);padding:7px;font-size:12px;line-height:1.45;"></textarea>' +
                  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px;">' +
                    '<input id="pdfWikiReaderTagInput" placeholder="标签，如 方法, 结果" style="height:30px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);padding:0 8px;font-size:12px;">' +
                    '<select id="pdfWikiReaderPurposeSelect" style="height:30px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);padding:0 8px;font-size:12px;">' +
                      '<option value="evidence">核心证据</option>' +
                      '<option value="method">方法/参数</option>' +
                      '<option value="result">结果数据</option>' +
                      '<option value="limitation">局限/不足</option>' +
                      '<option value="quote">可引用原句</option>' +
                      '<option value="todo">待复核</option>' +
                    '</select>' +
                    '<select id="pdfWikiReaderColorSelect" style="height:30px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);padding:0 8px;font-size:12px;">' +
                      '<option value="">默认颜色</option>' +
                      '<option value="yellow">黄色重点</option>' +
                      '<option value="green">绿色证据</option>' +
                      '<option value="blue">蓝色方法</option>' +
                      '<option value="red">红色问题</option>' +
                    '</select>' +
                  '</div>' +
                  '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:8px;">' +
                    renderPdfWikiReaderToolActionButton('保存批注', "savePdfWikiReaderItem('annotation')") +
                    renderPdfWikiReaderToolActionButton('保存摘录', "savePdfWikiReaderItem('excerpt')") +
                    renderPdfWikiReaderToolActionButton('保存到论点库', 'savePdfWikiReaderSelectionToClaimLibrary()', { id: 'pdfWikiReaderSaveClaimBtn', accent: true }) +
                  '</div>'
                ) +
                renderPdfWikiReaderToolSection('ai',
                  '<div style="margin-bottom:5px;font-size:12px;font-weight:700;color:var(--text-primary);">AI 阅读结果</div>' +
                  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:7px;">' +
                    renderPdfWikiReaderToolActionButton(pdfWikiReaderAiEnabled ? 'AI阅读：开' : 'AI阅读：关', 'togglePdfWikiReaderAiReadingFromTool()', { id: 'pdfWikiReaderAiModeBtn', accent: true, active: pdfWikiReaderAiEnabled }) +
                    renderPdfWikiReaderToolActionButton('AI读当前', 'runPdfWikiReaderAiRead(true)', { id: 'pdfWikiReaderAiRunBtn', accent: true }) +
                  '</div>' +
                  '<div id="pdfWikiReaderAiResult" style="min-height:92px;max-height:260px;overflow:auto;padding:9px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-secondary);font-size:12px;line-height:1.6;color:var(--text-secondary);">开启 AI 阅读后，选中 PDF 正文会自动调用小牛马翻译并总结。</div>'
                ) +
                renderPdfWikiReaderToolSection('notes',
                  '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">' +
                    '<div style="display:flex;align-items:center;gap:6px;min-width:0;">' +
                      '<div style="font-size:12px;font-weight:700;color:var(--text-primary);">批注与摘录</div>' +
                      '<span id="pdfWikiReaderItemsCount" style="font-size:10px;color:var(--text-secondary);"></span>' +
                    '</div>' +
                  '</div>' +
                  '<div style="display:grid;grid-template-columns:104px 1fr;gap:6px;margin-bottom:7px;">' +
                    '<select onchange="setPdfWikiReaderItemFilter(this.value)" style="height:28px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);padding:0 6px;font-size:11px;">' +
                      '<option value="all">全部</option>' +
                      '<option value="annotation">只看批注</option>' +
                      '<option value="excerpt">只看摘录</option>' +
                    '</select>' +
                    '<input oninput="setPdfWikiReaderItemSearch(this.value)" placeholder="搜索文本/备注/标签" style="height:28px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);padding:0 8px;font-size:11px;">' +
                  '</div>' +
                  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:8px;">' +
                    renderPdfWikiReaderToolActionButton('复制全部', 'copyPdfWikiReaderAllItems()') +
                    renderPdfWikiReaderToolActionButton('导出MD', 'exportPdfWikiReaderItemsMarkdown()') +
                  '</div>' +
                  '<div id="pdfWikiReaderItems" style="display:flex;flex-direction:column;gap:8px;"></div>'
                ) +
              '</div>' +
              '<div class="pdf-wiki-reader-home-chat-footer">' +
                '<button id="pdfWikiReaderHomeChatBtn" class="pdf-wiki-reader-home-chat-btn" type="button" onclick="openPdfWikiReaderHomeChat()">AI 交流</button>' +
              '</div>' +
            '</aside>' +
          '</div>' +
        '</div>';
      refreshPdfWikiReaderToolBubbleState();
      initPdfWikiReaderResizableLayout();
      attachPdfWikiReaderSelectionListeners();
      renderPdfWikiReaderItems(pdf.id);
      initPdfWikiOriginalPdfJsReader(pdf.id, sourceUrl);
    }

    window.renderPdfWikiOriginalPdfPage = renderPdfWikiOriginalPdfPage;

    window.openPdfWikiReaderHomeChat = function() {
      var targetPdfId = String(pdfWikiOriginalReaderPdfId || '').trim();
      if (!targetPdfId) return;
      return window.openPdfWikiPaperAiChat(targetPdfId);
    };

    window.openPdfWikiOriginalPdfReader = async function(pdfId) {
      var targetPdfId = String(pdfId || '').trim();
      if (!targetPdfId) return;
      var returnScrollTop = pdfWikiWorkspaceMode === 'pdf-manager'
        ? getPdfWikiPdfManagerScrollTop()
        : 0;
      pdfWikiViewerReturnTarget = 'pdf-manager';
      pdfWikiViewerReturnState = {
        scrollTop: returnScrollTop,
        focusPdfId: targetPdfId
      };
      pdfWikiOriginalReaderPdfId = targetPdfId;
      setPdfWikiWorkspaceMode('pdf-reader');
      if (!document.getElementById('pdfWikiViewerModal')) {
        await window.showPdfWikiViewer({
          initialTitle: '阅读全文',
          initialSubtitle: '正在读取 PDF...',
          initialLoadingText: '正在读取 PDF...',
          preserveReturnTarget: true,
          skipInitialLoad: true
        });
      }
      var pdf = getPdfWikiPdfById(targetPdfId);
      if (!pdf) {
        await loadPdfWikiPdfManagerDataOnly();
      }
      renderPdfWikiOriginalPdfPage(targetPdfId);
    };

    function renderPdfWikiPdfTitleImages(pdf, analysis) {
      var figures = (Array.isArray(pdf && pdf.figurePreviews) ? pdf.figurePreviews : []).filter(function(figure) {
        var name = String((figure && (figure.name || figure.file || figure.url)) || '');
        var id = String((figure && figure.id) || '');
        return id !== 'overview_diagram' && !/000_overview_diagram\.svg/i.test(name);
      });
      var items = figures.map(function(figure, index) {
        var label = figure.number || ('图片 ' + (index + 1));
        var title = figure.title || figure.caption || label;
        var meta = [figure.page ? ('p.' + figure.page) : '', figure.name || ''].filter(Boolean).join(' · ');
        return '<button type="button" data-pdf-id="' + escapeHtml(pdf.id || '') + '" data-figure-index="' + index + '" onclick="openPdfWikiFigurePreviewFromButton(this)" title="' + escapeHtml(figure.caption || title) + '" style="flex:0 0 220px;display:block;text-align:left;text-decoration:none;border:1px solid var(--border-color);border-radius:8px;overflow:hidden;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;padding:0;font:inherit;">' +
          '<div style="height:138px;display:flex;align-items:center;justify-content:center;background:#f8fafc;border-bottom:1px solid var(--border-color);">' +
            '<img src="' + escapeHtml(figure.url || '') + '" alt="' + escapeHtml(title) + '" loading="lazy" decoding="async" style="max-width:100%;max-height:138px;width:100%;height:138px;object-fit:contain;display:block;">' +
          '</div>' +
          '<div style="padding:6px 7px;">' +
            '<div style="font-size:11px;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(label) + '</div>' +
            '<div style="margin-top:2px;font-size:10px;line-height:1.25;color:var(--text-secondary);height:25px;overflow:hidden;">' + escapeHtml(title) + '</div>' +
            (meta ? '<div style="margin-top:4px;font-size:9.5px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(meta) + '</div>' : '') +
          '</div>' +
        '</button>';
      }).join('');

      if (!items) return '';
      var count = figures.length;
      return '<div style="margin-top:9px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);overflow:hidden;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;border-bottom:1px solid var(--border-color);">' +
          '<div style="font-size:11px;font-weight:700;color:var(--text-primary);">PDF 图片</div>' +
          '<div style="font-size:10px;color:var(--text-secondary);">' + count + ' 张 · 点击查看原图</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;overflow-x:auto;padding:8px;scrollbar-width:thin;">' + items + '</div>' +
      '</div>';
    }

    function extractPdfWikiDeepAnalysisSection(markdown, labels) {
      var text = String(markdown || '').replace(/\r/g, '\n');
      for (var i = 0; i < labels.length; i++) {
        var label = labels[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var pattern = new RegExp('(^|\\n)\\s{0,3}#{1,4}\\s*' + label + '\\s*[:：]?\\s*\\n', 'i');
        var match = pattern.exec(text);
        if (!match) continue;
        var start = match.index + match[0].length;
        var rest = text.slice(start);
        var next = /\n\s{0,3}#{1,4}\s+\S/.exec(rest);
        return (next ? rest.slice(0, next.index) : rest).trim();
      }
      return '';
    }

    function stripPdfWikiDeepAnalysisSections(markdown, labels) {
      var text = String(markdown || '').replace(/\r/g, '\n');
      labels.forEach(function(rawLabel) {
        var label = String(rawLabel || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!label) return;
        var pattern = new RegExp('(^|\\n)\\s{0,3}#{1,4}\\s*' + label + '\\s*[:：]?\\s*\\n[\\s\\S]*?(?=\\n\\s{0,3}#{1,4}\\s+\\S|$)', 'ig');
        text = text.replace(pattern, function(match, prefix) {
          return prefix || '';
        });
      });
      return text.replace(/\n{3,}/g, '\n\n').trim();
    }

    function getPdfWikiDeepAnalysisDisplayMarkdown(analysis) {
      return stripPdfWikiDeepAnalysisSections(analysis && analysis.summaryMarkdown, [
        '与用户现有研究的关系',
        '与我的研究的关系',
        '与用户研究的关系',
        '用户研究相关性'
      ]) || String((analysis && analysis.summaryMarkdown) || '').trim();
    }

    function getPdfWikiResearchRelevanceMarkdown(analysis) {
      if (!analysis) return '';
      var direct = String(analysis.researchRelevanceMarkdown || '').trim();
      if (direct) return direct;
      return extractPdfWikiDeepAnalysisSection(analysis.summaryMarkdown || '', [
        '与用户现有研究的关系',
        '与我的研究的关系',
        '与用户研究的关系',
        '用户研究相关性'
      ]);
    }

    function renderPdfWikiResearchRelevanceBlock(pdf, analysis) {
      var text = getPdfWikiResearchRelevanceMarkdown(analysis);
      if (!text) return '';
      var context = analysis && analysis.userResearchContext ? analysis.userResearchContext : {};
      var contextLine = context.hasContext
        ? '已结合你的研究背景和实验数据进行匹配分析'
        : '未检测到试验资料总结/试验数据总结，当前仅展示保守匹配建议';
      return '<div style="margin-top:10px;border:1px solid rgba(16,163,127,0.28);border-radius:8px;background:linear-gradient(180deg,rgba(16,163,127,0.08),rgba(16,163,127,0.03));overflow:hidden;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-bottom:1px solid rgba(16,163,127,0.18);">' +
          '<div style="min-width:0;">' +
            '<div style="font-size:12px;font-weight:800;color:var(--text-primary);">与我的研究关系</div>' +
            '<div style="margin-top:2px;font-size:10.5px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(contextLine) + '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:7px;flex:0 0 auto;">' +
            '<span style="padding:3px 7px;border:1px solid rgba(16,163,127,0.28);border-radius:999px;color:var(--accent-color);font-size:10px;background:var(--bg-primary);">支撑分类</span>' +
          '</div>' +
        '</div>' +
        '<div style="padding:10px 11px;font-size:12px;line-height:1.68;color:var(--text-primary);white-space:pre-wrap;word-break:break-word;">' + escapeHtml(text) + '</div>' +
      '</div>';
    }

    function isPdfWikiDeepAnalysisCollapsed(pdfId) {
      return pdfWikiDeepAnalysisCollapsed[pdfId] !== false;
    }

    function renderPdfWikiDeepAnalysisUsableItems(analysis) {
      var items = Array.isArray(analysis && analysis.usableItems) ? analysis.usableItems : [];
      if (!items.length) return '';
      var categoryLabels = {
        background: '研究背景',
        method: '方法借鉴',
        indicator: '指标依据',
        'result-comparison': '结果对照',
        mechanism: '机制解释',
        'meta-analysis': 'Meta 数据',
        limitation: '局限与边界'
      };
      return '<div style="margin-top:10px;border:1px solid var(--border-color);border-radius:8px;overflow:hidden;background:var(--bg-secondary);">' +
        '<div style="padding:9px 11px;border-bottom:1px solid var(--border-color);font-size:12px;font-weight:800;color:var(--text-primary);">可用于当前研究的 Wiki 条目（' + items.length + '）</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;padding:9px;">' +
          items.map(function(item) {
            var source = item && item.sourcePdfMetadata ? item.sourcePdfMetadata : {};
            var category = categoryLabels[String(item && item.category || '')] || '研究证据';
            var scope = String(item && item.supportScope || '').trim();
            var limitations = String(item && item.limitations || '').trim();
            var evidence = String(item && item.evidenceSentence || '').trim();
            var sourceLine = [source.authors, source.year, source.journal, source.doi].filter(Boolean).join(' · ');
            return '<article style="min-width:0;padding:10px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-primary);">' +
              '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;">' +
                '<span style="padding:2px 7px;border-radius:999px;background:rgba(16,163,127,0.09);color:var(--accent-color);font-size:10.5px;font-weight:800;">' + escapeHtml(category) + '</span>' +
                '<span style="color:var(--text-secondary);font-size:10px;">置信度 ' + Math.round(Number(item && item.confidence || 0) * 100) + '%</span>' +
              '</div>' +
              '<div style="font-size:12px;font-weight:800;line-height:1.55;color:var(--text-primary);">' + escapeHtml(String(item && item.claim || '')) + '</div>' +
              (item && item.researchUse ? '<div style="margin-top:6px;font-size:11.5px;line-height:1.55;color:var(--text-secondary);"><strong>可用于：</strong>' + escapeHtml(String(item.researchUse)) + '</div>' : '') +
              (evidence ? '<div style="margin-top:6px;font-size:11px;line-height:1.55;color:var(--text-secondary);"><strong>原文证据：</strong>' + escapeHtml(evidence) + '</div>' : '') +
              (scope ? '<div style="margin-top:5px;font-size:11px;line-height:1.5;color:var(--text-secondary);"><strong>支撑范围：</strong>' + escapeHtml(scope) + '</div>' : '') +
              (limitations ? '<div style="margin-top:5px;font-size:11px;line-height:1.5;color:var(--text-secondary);"><strong>使用边界：</strong>' + escapeHtml(limitations) + '</div>' : '') +
              (sourceLine ? '<div style="margin-top:7px;padding-top:6px;border-top:1px solid var(--border-color);font-size:10px;line-height:1.45;color:var(--text-secondary);">' + escapeHtml(sourceLine) + '</div>' : '') +
            '</article>';
          }).join('') +
        '</div>' +
      '</div>';
    }

    function renderPdfWikiDeepAnalysisBlock(pdf, analysis) {
      if (!analysis) return '';
      var safePdfId = getPdfWikiDomIdPart(pdf.id);
      var collapsed = isPdfWikiDeepAnalysisCollapsed(pdf.id);
      var hasDiagram = !!(analysis.overviewDiagram && analysis.overviewDiagram.svg);
      var displayMarkdown = getPdfWikiDeepAnalysisDisplayMarkdown(analysis);
      var wikiSync = analysis.wikiSync || {};
      var wikiItemCount = Number(wikiSync.itemCount || (Array.isArray(analysis.usableItems) ? analysis.usableItems.length : 0));
      var embeddedCount = Number(wikiSync.embeddedCount || 0);
      var syncStatusText = wikiItemCount > 0
        ? ('已写入 Wiki 可用条目 ' + wikiItemCount + ' 条 · Embedding ' + embeddedCount + '/' + wikiItemCount)
        : '尚未生成可核验的 Wiki 条目';
      var syncWarning = String(wikiSync.warning || '').trim();
      return '<div style="margin-top:12px;border-top:1px solid var(--border-color);padding-top:12px;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:8px;color:var(--text-secondary);font-size:12px;align-items:center;">' +
          '<span>深入分析结果' + (analysis.analysisEngine ? ' · ' + escapeHtml(analysis.analysisEngine === 'codex' ? 'Codex' : (analysis.analysisEngine === 'secondary-api' ? '小牛马 API' : (analysis.analysisEngine === 'local' ? '本地降级' : 'API'))) : '') + (analysis.analyzedAt ? ' · ' + escapeHtml(new Date(analysis.analyzedAt).toLocaleString()) : '') + '</span>' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
            (hasDiagram ? '<button type="button" data-pdf-id="' + escapeHtml(pdf.id || '') + '" onclick="openPdfWikiOverviewDiagramFromButton(this)" style="padding:4px 8px;border:1px solid rgba(16,163,127,0.35);border-radius:6px;background:rgba(16,163,127,0.08);color:var(--accent-color);cursor:pointer;font-size:12px;">打开论文一览图</button>' : '') +
            '<span>文字 ' + (analysis.textLength || 0) + ' 字</span>' +
            '<button id="pdfDeepAnalysisToggle-' + safePdfId + '" type="button" onclick="togglePdfWikiDeepAnalysisCollapse(\'' + escapeHtml(pdf.id) + '\')" style="padding:4px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">' + (collapsed ? '展开' : '折叠') + '</button>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin:0 0 9px;padding:7px 9px;border:1px solid rgba(16,163,127,0.25);border-radius:7px;background:rgba(16,163,127,0.055);font-size:11.5px;line-height:1.5;">' +
          '<span style="color:var(--text-primary);font-weight:700;">' + escapeHtml(syncStatusText) + '</span>' +
          (syncWarning ? '<span title="' + escapeHtml(syncWarning) + '" style="max-width:52%;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(syncWarning) + '</span>' : '') +
        '</div>' +
        '<div id="pdfDeepAnalysisDetails-' + safePdfId + '" style="' + (collapsed ? 'display:none;' : '') + '">' +
          renderPdfWikiOverviewDiagram(analysis.overviewDiagram, pdf.id) +
          '<div style="white-space:pre-wrap;font-size:13px;line-height:1.75;color:var(--text-primary);background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:12px;">' + escapeHtml(displayMarkdown || '') + '</div>' +
          renderPdfWikiDeepAnalysisUsableItems(analysis) +
        '</div>' +
      '</div>';
    }

    function normalizePdfWikiPdfManagerSearchText(value) {
      return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    function tokenizePdfWikiPdfManagerSearchQuery(value) {
      var text = String(value || '')
        .replace(/\band\s*\/\s*or\b/ig, ' or ')
        .replace(/&&/g, ' and ')
        .replace(/\|\|/g, ' or ')
        .replace(/[＋+]/g, ' and ')
        .replace(/[（）()]/g, ' ')
        .replace(/[，,；;]/g, ' and ');
      var tokens = [];
      text.replace(/"([^"]+)"|'([^']+)'|(\S+)/g, function(_match, doubleQuoted, singleQuoted, rawToken) {
        var token = normalizePdfWikiPdfManagerSearchText(doubleQuoted || singleQuoted || rawToken || '');
        if (!token) return '';
        if (/^(and|&|与|且|并且|和)$/.test(token)) {
          tokens.push({ type: 'and' });
        } else if (/^(or|或|或者)$/.test(token)) {
          tokens.push({ type: 'or' });
        } else {
          tokens.push({ type: 'term', value: token });
        }
        return '';
      });
      return tokens;
    }

    function getPdfWikiPdfManagerSearchGroups() {
      var tokens = tokenizePdfWikiPdfManagerSearchQuery(pdfWikiPdfManagerSearchTerm);
      var groups = [];
      var current = [];
      tokens.forEach(function(token) {
        if (token.type === 'term') {
          current.push(token.value);
          return;
        }
        if (token.type === 'or') {
          if (current.length) groups.push(current);
          current = [];
        }
      });
      if (current.length) groups.push(current);
      return groups;
    }

    function getPdfWikiPdfManagerAbstractPreview(pdf) {
      if (!pdf) return '';
      var direct = String(pdf.abstractPreview || '').trim();
      if (direct) return direct;
      var analysis = pdfWikiDeepAnalysisResults[pdf.id] || pdf.deepAnalysis || {};
      return String(analysis.textPreview || '').replace(/\s+/g, ' ').trim();
    }

    function formatPdfWikiPdfManagerAbstractPreview(value, maxChars) {
      var text = String(value || '').replace(/\s+/g, ' ').trim();
      var limit = maxChars || 260;
      if (!text || text.length <= limit) return text;
      return text.slice(0, limit).trim() + '...';
    }

    function getPdfWikiPdfManagerSearchText(pdf) {
      if (!pdf) return '';
      return [
        pdf.title || pdf.originalName || '',
        getPdfWikiPdfManagerAbstractPreview(pdf),
        pdf.searchText || ''
      ].join('\n');
    }

    function isPdfWikiPdfVisibleInManager(pdf) {
      var groupIds = getPdfWikiPdfGroupIds(pdf);
      var groupVisible = pdfWikiPdfManagerSelectedGroupId === 'all'
        || (pdfWikiPdfManagerSelectedGroupId === PDF_WIKI_PDF_FAVORITES_GROUP_ID && isPdfWikiManagedPdfFavorite(pdf))
        || (pdfWikiPdfManagerSelectedGroupId === 'ungrouped' && groupIds.length === 0)
        || groupIds.indexOf(pdfWikiPdfManagerSelectedGroupId) !== -1;
      if (!groupVisible) return false;
      var groups = getPdfWikiPdfManagerSearchGroups();
      if (!groups.length) return true;
      var haystack = normalizePdfWikiPdfManagerSearchText(getPdfWikiPdfManagerSearchText(pdf));
      return groups.some(function(group) {
        return group.every(function(term) {
          return haystack.indexOf(term) !== -1;
        });
      });
    }

    function getPdfWikiPdfManagerVisiblePdfs(pdfs) {
      return (Array.isArray(pdfs) ? pdfs : []).filter(function(pdf) {
        return isPdfWikiPdfVisibleInManager(pdf);
      });
    }

    function isPdfWikiPdfDeepAnalyzed(pdf) {
      if (!pdf || !pdf.id) return false;
      return !!(
        pdf.deepAnalysisAvailable
        || pdf.deepAnalysis
        || pdfWikiDeepAnalysisResults[pdf.id]
      );
    }

    function isPdfWikiPdfRecognized(pdf) {
      if (!pdf || !pdf.id) return false;
      if (pdf.recognitionComplete === true) return true;
      return !!(
        pdf.parsedTextCachedAt
        || (pdf.processedAt && (pdf.extractionParser || Number(pdf.textLength || 0) > 0))
      );
    }

    function getUnrecognizedPdfWikiPdfIds() {
      var pdfs = pdfWikiPdfManagerData && Array.isArray(pdfWikiPdfManagerData.pdfs)
        ? pdfWikiPdfManagerData.pdfs
        : [];
      return pdfs.filter(function(pdf) {
        return !isPdfWikiPdfRecognized(pdf);
      }).map(function(pdf) {
        return pdf.id;
      });
    }

    function isPdfWikiPdfMissingImages(pdf) {
      if (!pdf || !pdf.id) return false;
      return Number(pdf.figureCount || 0) <= 0
        && (!Array.isArray(pdf.figurePreviews) || pdf.figurePreviews.length === 0);
    }

    function needsPdfWikiLocalRecognition(pdf) {
      return !isPdfWikiPdfRecognized(pdf) || isPdfWikiPdfMissingImages(pdf);
    }

    function getPdfWikiPdfsNeedingLocalRecognitionIds() {
      var pdfs = pdfWikiPdfManagerData && Array.isArray(pdfWikiPdfManagerData.pdfs)
        ? pdfWikiPdfManagerData.pdfs
        : [];
      return pdfs.filter(needsPdfWikiLocalRecognition).map(function(pdf) {
        return pdf.id;
      });
    }

    function renderPdfWikiPdfManagerHeaderToolbar(searchTerm, selectedPdfCount, recognitionQueueCount, allVisibleSelected, visiblePdfCount) {
      var activeRecognitionJobs = getPdfWikiRecognitionQueueTrackedJobs(pdfWikiRecognitionQueueSnapshot);
      var activeRecognitionItems = [];
      activeRecognitionJobs.forEach(function(job) {
        if (Array.isArray(job.items)) activeRecognitionItems = activeRecognitionItems.concat(job.items);
      });
      var finishedRecognitionItems = activeRecognitionItems.filter(function(item) {
        return item.status === 'completed' || item.status === 'error';
      }).length;
      var recognitionButtonLabel = pdfWikiBatchReidentifyRunning && activeRecognitionItems.length > 0
        ? ('识别 ' + finishedRecognitionItems + '/' + activeRecognitionItems.length)
        : (pdfWikiBatchReidentifyRunning ? '识别队列运行中' : ('识别未识别/无图片 PDF（' + recognitionQueueCount + '）'));
      return '<div class="pdf-wiki-manager-header-toolbar">' +
        '<div class="pdf-wiki-manager-filter-row" style="display:flex;gap:6px;align-items:center;">' +
          '<input id="pdfWikiPdfManagerSearchInput" value="' + escapeHtml(searchTerm) + '" oncompositionstart="pdfWikiPdfManagerSearchComposing=true;cancelPdfWikiPdfManagerSearchTimer()" oncompositionend="pdfWikiPdfManagerSearchComposing=false;setPdfWikiPdfManagerSearchTerm(this.value)" oninput="setPdfWikiPdfManagerSearchTerm(this.value)" placeholder="按标题/摘要关键词筛选，支持 AND/OR" style="min-width:0;flex:1;padding:8px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' +
        '</div>' +
        '<div class="pdf-wiki-manager-action-row" style="display:flex;gap:8px;align-items:center;flex-wrap:nowrap;">' +
          '<button type="button" class="pdf-wiki-theme-action-btn" onclick="openPdfWikiViewerFromPdfManager()" style="padding:7px 10px;border:1px solid;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;">Wiki论点库</button>' +
          '<button type="button" onclick="triggerPdfWikiUpload(\'manager-lite\')" style="padding:7px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">批量上传PDF</button>' +
          '<button id="pdfWikiRecognizePendingPdfBtn" class="pdf-wiki-theme-action-btn" type="button" onclick="recognizeUnrecognizedPdfWikiPdfs()" ' + (recognitionQueueCount === 0 || pdfWikiBatchReidentifyRunning ? 'disabled' : '') + ' title="将整批任务提交到后端持久化队列。未解析 PDF 执行完整本地识别；已识别但没有图片的 PDF 仅重新提取图片。离开页面或重启软件后会继续处理。" style="padding:7px 10px;border:1px solid;border-radius:6px;cursor:' + (recognitionQueueCount === 0 || pdfWikiBatchReidentifyRunning ? 'not-allowed' : 'pointer') + ';opacity:' + (recognitionQueueCount === 0 || pdfWikiBatchReidentifyRunning ? '0.58' : '1') + ';font-size:12px;font-weight:700;">' + escapeHtml(recognitionButtonLabel) + '</button>' +
          '<button id="pdfWikiToggleSelectVisibleBtn" type="button" onclick="toggleSelectVisiblePdfWikiPdfs()" ' + (visiblePdfCount === 0 ? 'disabled' : '') + ' style="padding:7px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:' + (visiblePdfCount === 0 ? 'not-allowed' : 'pointer') + ';opacity:' + (visiblePdfCount === 0 ? '0.58' : '1') + ';font-size:12px;">' + (allVisibleSelected ? '取消全选' : '全选') + '</button>' +
          '<button type="button" onclick="clearPdfWikiPdfSelection()" style="padding:7px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">清空</button>' +
          '<button id="pdfWikiDeleteSelectedPdfBtn" type="button" onclick="deleteSelectedPdfWikiPdfs()" ' + (selectedPdfCount === 0 ? 'disabled' : '') + ' style="padding:7px 10px;border:1px solid var(--danger-color);border-radius:6px;background:transparent;color:var(--danger-color);cursor:' + (selectedPdfCount === 0 ? 'not-allowed' : 'pointer') + ';opacity:' + (selectedPdfCount === 0 ? '0.58' : '1') + ';font-size:12px;">删除</button>' +
        '</div>' +
      '</div>';
    }

    window.openPdfWikiViewerFromPdfManager = function() {
      return window.showPdfWikiViewer({
        returnTarget: 'pdf-manager',
        returnState: {
          scrollTop: getPdfWikiPdfManagerScrollTop(),
          focusPdfId: ''
        }
      });
    };

    function renderPdfWikiPdfManager(data, options) {
      setPdfWikiWorkspaceMode('pdf-manager');
      var restoreScrollTop = options && Number.isFinite(Number(options.scrollTop))
        ? Number(options.scrollTop)
        : getPdfWikiPdfManagerScrollTop();
      var focusPdfId = options && options.focusPdfId ? String(options.focusPdfId) : '';
      var pdfs = Array.isArray(data.pdfs) ? data.pdfs : [];
      var groups = Array.isArray(data.groups) ? data.groups : [];
      var title = document.getElementById('pdfWikiViewerTitle');
      if (title) title.textContent = 'PDF管理';
      var validGroupIds = {};
      groups.forEach(function(group) { validGroupIds[group.id] = true; });
      if (
        pdfWikiPdfManagerSelectedGroupId !== 'all'
        && pdfWikiPdfManagerSelectedGroupId !== PDF_WIKI_PDF_FAVORITES_GROUP_ID
        && pdfWikiPdfManagerSelectedGroupId !== 'ungrouped'
        && !validGroupIds[pdfWikiPdfManagerSelectedGroupId]
      ) {
        pdfWikiPdfManagerSelectedGroupId = 'all';
      }
      var subtitle = document.getElementById('pdfWikiViewerSubtitle');
      var favoritePdfCount = pdfs.filter(function(pdf) { return isPdfWikiManagedPdfFavorite(pdf); }).length;
      var recognizedPdfCount = pdfs.filter(isPdfWikiPdfRecognized).length;
      var unrecognizedPdfCount = Math.max(0, pdfs.length - recognizedPdfCount);
      var noImagePdfCount = pdfs.filter(isPdfWikiPdfMissingImages).length;
      var recognitionQueueCount = pdfs.filter(needsPdfWikiLocalRecognition).length;
      var deepAnalyzedPdfCount = pdfs.filter(isPdfWikiPdfDeepAnalyzed).length;
      if (subtitle) {
        subtitle.textContent = 'PDF 管理：' + pdfs.length + ' 个 PDF，已识别 ' + recognizedPdfCount + ' 个，待识别 ' + unrecognizedPdfCount + ' 个，无图片 ' + noImagePdfCount + ' 个，深入分析 ' + deepAnalyzedPdfCount + ' 个，收藏 ' + favoritePdfCount + ' 个，' + groups.length + ' 个分组';
      }

      var content = document.getElementById('pdfWikiViewerContent');
      if (!content) return;

      var defaultGroupButtons = [
        { id: PDF_WIKI_PDF_FAVORITES_GROUP_ID, name: '★ 收藏', count: favoritePdfCount },
        { id: 'all', name: '全部 PDF', count: pdfs.length },
        { id: 'ungrouped', name: '未分组', count: pdfs.filter(function(pdf) { return getPdfWikiPdfGroupIds(pdf).length === 0; }).length }
      ];
      var customGroupButtons = groups.map(function(group) {
        return {
          id: group.id,
          name: group.name,
          count: pdfs.filter(function(pdf) { return getPdfWikiPdfGroupIds(pdf).indexOf(group.id) !== -1; }).length,
          custom: true
        };
      });

      var visiblePdfs = getPdfWikiPdfManagerVisiblePdfs(pdfs);
      var searchTerm = String(pdfWikiPdfManagerSearchInputValue || '');
      var hasSearchTerm = String(pdfWikiPdfManagerSearchTerm || '').trim().length > 0;
      Object.keys(pdfWikiSelectedPdfIds).forEach(function(id) {
        if (!pdfs.some(function(pdf) { return pdf.id === id; })) delete pdfWikiSelectedPdfIds[id];
      });
      var selectedPdfCount = getPdfWikiSelectedPdfIds().length;
      var allVisibleSelected = visiblePdfs.length > 0 && visiblePdfs.every(function(pdf) {
        return !!pdfWikiSelectedPdfIds[pdf.id];
      });
      setPdfWikiViewerContextActions(
        renderPdfWikiPdfManagerHeaderToolbar(searchTerm, selectedPdfCount, recognitionQueueCount, allVisibleSelected, visiblePdfs.length)
      );
      var managerStatusHtml = renderPdfWikiRecognitionQueueStatusBar() + renderPdfWikiManagerUploadStatusBar() + renderPdfWikiMetaExtractionStatusBar();

      var defaultGroupHtml = defaultGroupButtons.map(function(group) {
        var active = group.id === pdfWikiPdfManagerSelectedGroupId;
        return '<button class="pdf-wiki-default-group-button" type="button" title="' + escapeHtml(group.name) + '" onclick="selectPdfWikiPdfGroup(\'' + escapeHtml(group.id) + '\')" style="border-color:' + (active ? 'var(--accent-color)' : 'var(--border-color)') + ';background:' + (active ? 'rgba(16,163,127,0.12)' : 'var(--bg-secondary)') + ';">' +
          '<span>' + escapeHtml(group.name) + '</span>' +
          '<span id="pdfWikiPdfGroupCount-' + getPdfWikiDomIdPart(group.id) + '" class="pdf-wiki-default-group-count">' + group.count + '</span>' +
        '</button>';
      }).join('');
      var customGroupHtml = customGroupButtons.map(function(group) {
        var active = group.id === pdfWikiPdfManagerSelectedGroupId;
        return '<div style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;margin-bottom:7px;">' +
          '<button type="button" onclick="selectPdfWikiPdfGroup(\'' + escapeHtml(group.id) + '\')" style="width:100%;text-align:left;padding:9px 10px;border:1px solid ' + (active ? 'var(--accent-color)' : 'var(--border-color)') + ';border-radius:7px;background:' + (active ? 'rgba(16,163,127,0.12)' : 'var(--bg-secondary)') + ';color:var(--text-primary);cursor:pointer;">' +
            '<span style="font-size:13px;font-weight:600;">' + escapeHtml(group.name) + '</span>' +
            '<span id="pdfWikiPdfGroupCount-' + getPdfWikiDomIdPart(group.id) + '" style="float:right;color:var(--text-secondary);font-size:12px;">' + group.count + '</span>' +
          '</button>' +
          '<div style="display:flex;gap:4px;">' +
            '<button type="button" title="重命名" onclick="renamePdfWikiPdfGroup(\'' + escapeHtml(group.id) + '\')" style="width:28px;height:28px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-secondary);cursor:pointer;">✎</button>' +
            '<button type="button" title="删除分组" onclick="deletePdfWikiPdfGroupClient(\'' + escapeHtml(group.id) + '\')" style="width:28px;height:28px;border:1px solid var(--danger-color);border-radius:6px;background:transparent;color:var(--danger-color);cursor:pointer;">×</button>' +
          '</div>' +
        '</div>';
      }).join('');
      var groupHtml = '<div class="pdf-wiki-default-group-row">' + defaultGroupHtml + '</div>' + customGroupHtml;

      var pdfHtml = visiblePdfs.length
        ? visiblePdfs.map(function(pdf) {
            var groupIds = getPdfWikiPdfGroupIds(pdf);
            var analysis = pdfWikiDeepAnalysisResults[pdf.id] || pdf.deepAnalysis;
            var analysisAvailable = isPdfWikiPdfDeepAnalyzed(pdf);
            var analysisExpanded = !!analysis && !isPdfWikiDeepAnalysisCollapsed(pdf.id);
            var recognitionComplete = isPdfWikiPdfRecognized(pdf);
            if (analysis) pdfWikiDeepAnalysisResults[pdf.id] = analysis;
            var selected = !!pdfWikiSelectedPdfIds[pdf.id];
            var favorite = isPdfWikiManagedPdfFavorite(pdf);
            var abstractPreview = formatPdfWikiPdfManagerAbstractPreview(getPdfWikiPdfManagerAbstractPreview(pdf), 280);
            var groupTags = groups
              .filter(function(group) {
                return groupIds.indexOf(group.id) !== -1;
              })
              .map(function(group) {
                  var groupTagId = 'pdfWikiPdfGroupTag-' + getPdfWikiDomIdPart(pdf.id) + '-' + getPdfWikiDomIdPart(group.id);
                  return '<button id="' + groupTagId + '" class="pdf-wiki-existing-group-tag" type="button" data-pdf-id="' + escapeHtml(pdf.id) + '" data-group-id="' + escapeHtml(group.id) + '" title="点击移除该分组标签" aria-label="移除分组标签 ' + escapeHtml(group.name) + '" onclick="setPdfWikiPdfGroupChecked(this.dataset.pdfId,this.dataset.groupId,false,this)">' +
                    escapeHtml(group.name) +
                  '</button>';
                }).join('');
            return '<article id="pdfWikiPdfCard-' + getPdfWikiDomIdPart(pdf.id) + '" data-pdf-id="' + escapeHtml(pdf.id) + '" style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:14px;margin-bottom:12px;">' +
              '<div class="pdf-wiki-manager-card-main">' +
                '<div class="pdf-wiki-manager-card-copy">' +
                  '<label style="display:flex;align-items:flex-start;gap:8px;font-size:14px;font-weight:700;line-height:1.45;color:var(--text-primary);word-break:break-word;">' +
                    '<input id="pdfWikiPdfSelect-' + getPdfWikiDomIdPart(pdf.id) + '" class="pdf-wiki-pdf-select-checkbox" type="checkbox" onchange="togglePdfWikiPdfSelection(\'' + escapeHtml(pdf.id) + '\',this.checked)"' + (selected ? ' checked' : '') + ' style="margin-top:3px;">' +
                    '<span class="pdf-wiki-manager-card-title">' + escapeHtml(pdf.title || pdf.originalName || '未命名 PDF') + '</span>' +
                  '</label>' +
                  '<div style="margin-top:5px;color:var(--text-secondary);font-size:12px;line-height:1.6;">' +
                    escapeHtml([pdf.authors, pdf.year, pdf.journal].filter(Boolean).join(' · ') || pdf.originalName || '') +
                  '</div>' +
                  (abstractPreview ? '<div style="margin-top:7px;color:var(--text-secondary);font-size:12px;line-height:1.55;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;"><span style="font-weight:700;color:var(--text-primary);">摘要：</span>' + escapeHtml(abstractPreview) + '</div>' : '') +
                  '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;color:var(--text-secondary);font-size:11px;">' +
                    '<span style="padding:3px 6px;border:1px solid var(--border-color);border-radius:12px;">' + escapeHtml(formatPdfWikiFileSize(pdf.size)) + '</span>' +
                    '<span id="pdfWikiPdfGroupBadge-' + getPdfWikiDomIdPart(pdf.id) + '" style="padding:3px 6px;border:1px solid var(--border-color);border-radius:12px;">' + escapeHtml(getPdfWikiPdfGroupNames(pdf)) + '</span>' +
                    (Number(pdf.figureCount || 0) > 0 ? '<span style="padding:3px 6px;border:1px solid var(--border-color);border-radius:12px;">图片 ' + Number(pdf.figureCount || 0) + '</span>' : '') +
                    (pdf.textLength ? '<span style="padding:3px 6px;border:1px solid var(--border-color);border-radius:12px;">文字 ' + pdf.textLength + '</span>' : '') +
                    '<span style="padding:3px 6px;border:1px solid ' + (recognitionComplete ? '#111827' : 'var(--danger-color)') + ';border-radius:12px;background:' + (recognitionComplete ? '#111827' : 'transparent') + ';color:' + (recognitionComplete ? '#d4a017' : 'var(--danger-color)') + ';font-weight:700;">' + (recognitionComplete ? '已识别' : '待识别') + '</span>' +
                    (analysisAvailable ? '<span style="padding:3px 6px;border:1px solid #111827 !important;border-radius:12px;background:#111827 !important;color:#d4a017 !important;font-weight:700;">已深入分析</span>' : '') +
                  '</div>' +
                '</div>' +
                '<div class="pdf-wiki-manager-card-actions">' +
                  renderPdfWikiPdfFavoriteButton(pdf.id, favorite) +
                  '<button type="button" data-pdf-id="' + escapeHtml(pdf.id) + '" onclick="openPdfWikiPaperAiChatFromButton(this)" title="在 PDF 管理页直接和小牛马讨论这篇文章；使用论文分析专家 soul、论文全文、长期记忆和近 10 轮上下文。" style="padding:8px 11px;border:1px solid rgba(37,99,235,0.32);border-radius:6px;background:rgba(37,99,235,0.10);color:#1d4ed8;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap;">跟AI聊</button>' +
                  '<button type="button" data-pdf-id="' + escapeHtml(pdf.id) + '" onclick="openPdfWikiOriginalPdfReaderFromButton(this)" title="在软件内打开该 PDF 原文。" style="padding:8px 11px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;white-space:nowrap;">阅读原文</button>' +
                  (analysisAvailable
                    ? '<button id="pdfDeepAnalysisViewBtn-' + getPdfWikiDomIdPart(pdf.id) + '" class="pdf-wiki-theme-action-btn" type="button" onclick="openPdfWikiDeepAnalysisDetails(\'' + escapeHtml(pdf.id) + '\')" title="读取已经保存的深入分析结果，不会重新运行分析。" style="padding:8px 11px;border:1px solid;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap;">' + (analysis ? (analysisExpanded ? '折叠分析' : '展开分析') : '查看分析') + '</button>'
                    : '') +
                  '<button id="pdfReidentifyBtn-' + getPdfWikiDomIdPart(pdf.id) + '" type="button" onclick="reidentifyPdfWikiPdf(\'' + escapeHtml(pdf.id) + '\')" title="' + (recognitionComplete ? '重新使用本地工具识别标题、作者、正文、参考文献和 PDF 内部图片，不重置已有论点库。' : '使用本地工具识别标题、作者、正文、参考文献和 PDF 内部图片。') + '" style="padding:8px 11px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;white-space:nowrap;">' + (recognitionComplete ? '重新识别PDF' : '识别PDF') + '</button>' +
                  '<button id="pdfDeepAnalysisBtn-' + getPdfWikiDomIdPart(pdf.id) + '" type="button" onclick="runPdfWikiDeepAnalysis(\'' + escapeHtml(pdf.id) + '\',true)" style="padding:8px 11px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;white-space:nowrap;">' + (analysisAvailable ? '重新分析' : '深入分析') + '</button>' +
                '</div>' +
              '</div>' +
              renderPdfWikiResearchRelevanceBlock(pdf, analysis) +
              renderPdfWikiPdfTitleImages(pdf, analysis) +
              (groupTags
                ? '<div class="pdf-wiki-existing-group-tags" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;">' + groupTags + '</div>'
                : '') +
              renderPdfWikiDeepAnalysisBlock(pdf, analysis) +
            '</article>';
          }).join('')
        : '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:13px;">' + (hasSearchTerm ? '没有匹配标题或摘要关键词的 PDF' : '当前分组没有 PDF') + '</div>';

      content.innerHTML =
        '<div style="display:grid;grid-template-columns:300px 1fr;gap:0;width:100%;height:100%;min-height:0;">' +
          '<aside style="border-right:1px solid var(--border-color);display:flex;flex-direction:column;min-height:0;">' +
            '<div style="padding:14px;border-bottom:1px solid var(--border-color);">' +
              '<div style="display:flex;gap:6px;align-items:center;">' +
                '<input id="pdfWikiNewGroupInput" placeholder="新建分组" style="min-width:0;flex:1;padding:8px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' +
                '<button type="button" onclick="createPdfWikiPdfGroupFromInput()" style="padding:8px 10px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">添加</button>' +
              '</div>' +
              (pdfWikiPdfManagerAutoGroupNotice
                ? '<div id="pdfWikiPdfManagerAutoGroupNotice" style="margin-top:9px;padding:7px 9px;border:1px solid #111827;border-radius:7px;background:#111827;color:#d4a017;font-size:11px;font-weight:700;line-height:1.5;">' + escapeHtml(pdfWikiPdfManagerAutoGroupNotice) + '</div>'
                : '') +
            '</div>' +
            '<div style="padding:12px;overflow:auto;min-height:0;flex:1;">' + groupHtml + '</div>' +
          '</aside>' +
          '<section id="pdfWikiPdfManagerScroll" style="min-width:0;min-height:0;overflow:auto;padding:0 16px 16px 16px;background:var(--bg-secondary);">' +
            (managerStatusHtml
              ? '<div style="position:sticky;top:0;z-index:30;margin:0 -16px 12px -16px;padding:0 16px;background:var(--bg-secondary);box-shadow:0 8px 18px rgba(15,23,42,0.08);">' + managerStatusHtml + '</div>'
              : '') +
            (pdfs.length === 0
              ? '<div style="height:100%;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;color:var(--text-secondary);font-size:13px;">' +
                  '<div>还没有 PDF。上传 PDF 后会自动出现在这里。</div>' +
                  '<button class="lit-btn" style="width:auto;padding:8px 14px;margin:0;" onclick="triggerPdfWikiUpload(\'manager-lite\')">批量上传 PDF</button>' +
                '</div>'
              : pdfHtml) +
          '</section>' +
        '</div>';
      restorePdfWikiPdfManagerReturnTarget(restoreScrollTop, focusPdfId);
    }

    window.selectPdfWikiPdfGroup = function(groupId) {
      pdfWikiPdfManagerSelectedGroupId = groupId || 'all';
      if (pdfWikiPdfManagerData) renderPdfWikiPdfManager(pdfWikiPdfManagerData);
    };

    window.cancelPdfWikiPdfManagerSearchTimer = function() {
      if (pdfWikiPdfManagerSearchTimer) {
        clearTimeout(pdfWikiPdfManagerSearchTimer);
        pdfWikiPdfManagerSearchTimer = null;
      }
    };

    window.setPdfWikiPdfManagerSearchTerm = function(value) {
      pdfWikiPdfManagerSearchInputValue = String(value || '');
      if (pdfWikiPdfManagerSearchComposing) return;
      cancelPdfWikiPdfManagerSearchTimer();
      var activeInput = document.getElementById('pdfWikiPdfManagerSearchInput');
      var cursor = activeInput && typeof activeInput.selectionStart === 'number'
        ? activeInput.selectionStart
        : String(value || '').length;
      pdfWikiPdfManagerSearchTimer = setTimeout(function() {
        pdfWikiPdfManagerSearchTimer = null;
        pdfWikiPdfManagerSearchTerm = pdfWikiPdfManagerSearchInputValue;
        if (!pdfWikiPdfManagerData || !document.getElementById('pdfWikiPdfManagerSearchInput')) return;
        renderPdfWikiPdfManagerPreservingScroll();
        setTimeout(function() {
          var input = document.getElementById('pdfWikiPdfManagerSearchInput');
          if (!input) return;
          input.focus();
          if (typeof input.setSelectionRange === 'function') {
            var safeCursor = Math.min(cursor, String(input.value || '').length);
            input.setSelectionRange(safeCursor, safeCursor);
          }
        }, 0);
      }, PDF_WIKI_PDF_MANAGER_SEARCH_DELAY_MS);
    };

    window.clearPdfWikiPdfManagerSearch = function() {
      cancelPdfWikiPdfManagerSearchTimer();
      pdfWikiPdfManagerSearchInputValue = '';
      pdfWikiPdfManagerSearchTerm = '';
      renderPdfWikiPdfManagerPreservingScroll();
      setTimeout(function() {
        var input = document.getElementById('pdfWikiPdfManagerSearchInput');
        if (input) input.focus();
      }, 0);
    };

    function setPdfWikiSelectionButtonState(button, enabled) {
      if (!button) return;
      button.disabled = !enabled;
      button.style.cursor = enabled ? 'pointer' : 'not-allowed';
      button.style.opacity = enabled ? '1' : '0.58';
    }

    function refreshPdfWikiPdfSelectionUi() {
      var selectedCount = getPdfWikiSelectedPdfIds().length;
      var countEl = document.getElementById('pdfWikiSelectedPdfCountText');
      if (countEl) countEl.textContent = String(selectedCount);
      setPdfWikiSelectionButtonState(document.getElementById('pdfWikiDeleteSelectedPdfBtn'), selectedCount > 0);
      setPdfWikiSelectionButtonState(document.getElementById('pdfWikiBatchReidentifyBtn'), selectedCount > 0 && !pdfWikiBatchReidentifyRunning);
      setPdfWikiSelectionButtonState(document.getElementById('pdfWikiMetaExtractSelectedBtn'), selectedCount > 0 && !pdfWikiMetaExtractionRunning);
      setPdfWikiSelectionButtonState(document.getElementById('pdfWikiBatchDeepAnalysisBtn'), selectedCount > 0 && !pdfWikiBatchDeepAnalysisRunning);
      var managerPdfs = pdfWikiPdfManagerData && Array.isArray(pdfWikiPdfManagerData.pdfs)
        ? pdfWikiPdfManagerData.pdfs
        : [];
      var visiblePdfs = getPdfWikiPdfManagerVisiblePdfs(managerPdfs);
      var allVisibleSelected = visiblePdfs.length > 0 && visiblePdfs.every(function(pdf) {
        return !!pdfWikiSelectedPdfIds[pdf.id];
      });
      var toggleVisibleButton = document.getElementById('pdfWikiToggleSelectVisibleBtn');
      setPdfWikiSelectionButtonState(toggleVisibleButton, visiblePdfs.length > 0);
      if (toggleVisibleButton) toggleVisibleButton.textContent = allVisibleSelected ? '取消全选' : '全选';
      var pendingRecognitionIds = getPdfWikiPdfsNeedingLocalRecognitionIds();
      var pendingRecognitionButton = document.getElementById('pdfWikiRecognizePendingPdfBtn');
      setPdfWikiSelectionButtonState(pendingRecognitionButton, pendingRecognitionIds.length > 0 && !pdfWikiBatchReidentifyRunning);
      if (pendingRecognitionButton) {
        if (pdfWikiBatchReidentifyRunning) {
          var jobs = getPdfWikiRecognitionQueueTrackedJobs(pdfWikiRecognitionQueueSnapshot);
          var items = [];
          jobs.forEach(function(job) {
            if (Array.isArray(job.items)) items = items.concat(job.items);
          });
          var finished = items.filter(function(item) {
            return item.status === 'completed' || item.status === 'error';
          }).length;
          pendingRecognitionButton.textContent = items.length > 0
            ? ('识别 ' + finished + '/' + items.length)
            : '识别队列运行中';
        } else {
          pendingRecognitionButton.textContent = '识别未识别/无图片 PDF（' + pendingRecognitionIds.length + '）';
        }
      }
      Array.prototype.slice.call(document.querySelectorAll('.pdf-wiki-pdf-select-checkbox')).forEach(function(input) {
        var match = String(input.id || '').match(/^pdfWikiPdfSelect-(.+)$/);
        if (!match) return;
        var pdfs = pdfWikiPdfManagerData && Array.isArray(pdfWikiPdfManagerData.pdfs) ? pdfWikiPdfManagerData.pdfs : [];
        var pdf = pdfs.find(function(item) { return getPdfWikiDomIdPart(item.id) === match[1]; });
        if (pdf) input.checked = !!pdfWikiSelectedPdfIds[pdf.id];
      });
    }

    window.togglePdfWikiPdfSelection = function(pdfId, selected) {
      if (selected) pdfWikiSelectedPdfIds[pdfId] = true;
      else delete pdfWikiSelectedPdfIds[pdfId];
      refreshPdfWikiPdfSelectionUi();
    };

    window.toggleSelectVisiblePdfWikiPdfs = function() {
      if (!pdfWikiPdfManagerData) return;
      var pdfs = Array.isArray(pdfWikiPdfManagerData.pdfs) ? pdfWikiPdfManagerData.pdfs : [];
      var visiblePdfs = getPdfWikiPdfManagerVisiblePdfs(pdfs);
      var allVisibleSelected = visiblePdfs.length > 0 && visiblePdfs.every(function(pdf) {
        return !!pdfWikiSelectedPdfIds[pdf.id];
      });
      visiblePdfs.forEach(function(pdf) {
        if (allVisibleSelected) delete pdfWikiSelectedPdfIds[pdf.id];
        else pdfWikiSelectedPdfIds[pdf.id] = true;
      });
      refreshPdfWikiPdfSelectionUi();
    };

    window.selectVisiblePdfWikiPdfs = function() {
      if (!pdfWikiPdfManagerData) return;
      var pdfs = Array.isArray(pdfWikiPdfManagerData.pdfs) ? pdfWikiPdfManagerData.pdfs : [];
      getPdfWikiPdfManagerVisiblePdfs(pdfs).forEach(function(pdf) {
        pdfWikiSelectedPdfIds[pdf.id] = true;
      });
      refreshPdfWikiPdfSelectionUi();
    };

    window.clearPdfWikiPdfSelection = function() {
      pdfWikiSelectedPdfIds = {};
      refreshPdfWikiPdfSelectionUi();
    };

    window.deleteSelectedPdfWikiPdfs = async function() {
      var ids = getPdfWikiSelectedPdfIds();
      if (ids.length === 0) return;
      if (!confirm('确定删除选中的 ' + ids.length + ' 个 PDF 吗？\n\n会从 PDF 管理、PDF Wiki 论点库、句子云、Meta 数据、分组和收藏中移除，并尽量删除本地 PDF 源文件与解析缓存。该操作不可恢复。')) {
        return;
      }
      try {
        var response = await fetch('/api/pdf-wiki/pdfs/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, pdfIds: ids })
        });
        var result = await readPdfWikiMetaJsonResponse(response, '删除PDF');
        pdfWikiSelectedPdfIds = {};
        pdfWikiDeepAnalysisResults = {};
        if (result && result.favoritePdfIds) {
          pdfWikiFavoritePdfIds = Array.isArray(result.favoritePdfIds) ? result.favoritePdfIds : [];
        }
        await reloadPdfWikiPdfManager();
        appendMessage('已删除 ' + Number(result.deletedCount || 0) + ' 个 PDF；当前剩余 ' + Number(result.pdfCount || 0) + ' 个 PDF。', 'bot', false, true);
      } catch (e) {
        alert('删除PDF失败：' + e.message);
      }
    };

    window.togglePdfWikiPdfFavorite = async function(pdfId, event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (!pdfId || !pdfWikiPdfManagerData || !Array.isArray(pdfWikiPdfManagerData.pdfs)) return;
      var pdf = pdfWikiPdfManagerData.pdfs.find(function(item) { return item.id === pdfId; });
      if (!pdf) return;
      var scrollTop = getPdfWikiPdfManagerScrollTop();
      var nextFavorite = !isPdfWikiManagedPdfFavorite(pdf);

      try {
        var response = await fetch('/api/pdf-wiki/pdfs/' + encodeURIComponent(pdfId) + '/favorite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, favorite: nextFavorite })
        });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '收藏失败');
        }
        setPdfWikiManagedPdfFavoriteValue(pdfId, result.favorite, result.favoriteIds || []);
        if (pdfWikiPdfManagerSelectedGroupId === PDF_WIKI_PDF_FAVORITES_GROUP_ID && result.favorite === false) {
          renderPdfWikiPdfManager(pdfWikiPdfManagerData, { scrollTop: scrollTop });
          return;
        }
        var button = document.getElementById('pdfWikiPdfFavoriteBtn-' + getPdfWikiDomIdPart(pdfId));
        if (button) button.outerHTML = renderPdfWikiPdfFavoriteButton(pdfId, result.favorite);
        refreshPdfWikiPdfFavoriteStatsInline();
      } catch (e) {
        alert('收藏 PDF 失败：' + e.message);
      }
    };

    window.togglePdfWikiDeepAnalysisCollapse = function(pdfId) {
      pdfWikiDeepAnalysisCollapsed[pdfId] = !isPdfWikiDeepAnalysisCollapsed(pdfId);
      var safePdfId = getPdfWikiDomIdPart(pdfId);
      var details = document.getElementById('pdfDeepAnalysisDetails-' + safePdfId);
      var toggle = document.getElementById('pdfDeepAnalysisToggle-' + safePdfId);
      var viewButton = document.getElementById('pdfDeepAnalysisViewBtn-' + safePdfId);
      var collapsed = isPdfWikiDeepAnalysisCollapsed(pdfId);
      if (viewButton) viewButton.textContent = collapsed ? '展开分析' : '折叠分析';
      if (details && toggle) {
        details.style.display = collapsed ? 'none' : '';
        toggle.textContent = collapsed ? '展开' : '折叠';
        return;
      }
      renderPdfWikiPdfManagerPreservingScroll();
    };

    async function loadPdfWikiDeepAnalysisDetails(pdfId) {
      var response = await fetch('/api/pdf-wiki/pdfs/' + encodeURIComponent(pdfId) + '/deep-analysis?userId=' + encodeURIComponent(currentUserId));
      var result = await readPdfWikiMetaJsonResponse(response, '读取深入分析结果');
      pdfWikiDeepAnalysisResults[pdfId] = result;
      var pdf = getPdfWikiPdfById(pdfId);
      if (pdf) {
        pdf.deepAnalysisAvailable = true;
        pdf.detailsLoaded = true;
        pdf.deepAnalysis = result;
      }
      return result;
    }

    window.openPdfWikiDeepAnalysisDetails = async function(pdfId) {
      var pdf = getPdfWikiPdfById(pdfId);
      if (!pdf) return;
      var analysis = pdfWikiDeepAnalysisResults[pdfId] || pdf.deepAnalysis;
      if (analysis) {
        window.togglePdfWikiDeepAnalysisCollapse(pdfId);
        return;
      }

      var button = document.getElementById('pdfDeepAnalysisViewBtn-' + getPdfWikiDomIdPart(pdfId));
      var scrollTop = getPdfWikiPdfManagerScrollTop();
      if (button) {
        button.disabled = true;
        button.textContent = '读取中...';
        button.style.opacity = '0.68';
      }
      try {
        await loadPdfWikiDeepAnalysisDetails(pdfId);
        pdfWikiDeepAnalysisCollapsed[pdfId] = false;
        renderPdfWikiPdfManager(pdfWikiPdfManagerData, { scrollTop: scrollTop });
      } catch (error) {
        alert('读取深入分析结果失败：' + error.message);
        if (button) {
          button.disabled = false;
          button.textContent = '查看分析';
          button.style.opacity = '1';
        }
      }
    };

    function setPdfWikiPdfManagerAutoGroupNotice(groupName, autoMatch) {
      var match = autoMatch && typeof autoMatch === 'object' ? autoMatch : {};
      var matchedCount = Math.max(0, Number(match.matchedCount || 0));
      pdfWikiPdfManagerAutoGroupNotice = match.error
        ? ('分组“' + groupName + '”已保存；自动匹配暂未完成：' + match.error)
        : ('分组“' + groupName + '”已按标题和摘要自动匹配 ' + matchedCount + ' 篇 PDF');
      if (pdfWikiPdfManagerAutoGroupNoticeTimer) {
        clearTimeout(pdfWikiPdfManagerAutoGroupNoticeTimer);
      }
      pdfWikiPdfManagerAutoGroupNoticeTimer = setTimeout(function() {
        pdfWikiPdfManagerAutoGroupNotice = '';
        pdfWikiPdfManagerAutoGroupNoticeTimer = null;
        var notice = document.getElementById('pdfWikiPdfManagerAutoGroupNotice');
        if (notice) notice.remove();
      }, 7000);
    }

    window.createPdfWikiPdfGroupFromInput = async function() {
      var input = document.getElementById('pdfWikiNewGroupInput');
      var name = input ? String(input.value || '').trim() : '';
      if (!name) return;
      try {
        var response = await fetch('/api/pdf-wiki/pdf-groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, name: name })
        });
        var result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '创建分组失败');
        setPdfWikiPdfManagerAutoGroupNotice(name, result.autoMatch);
        if (input) input.value = '';
        await reloadPdfWikiPdfManager();
      } catch (e) {
        alert('创建分组失败：' + e.message);
      }
    };

    window.renamePdfWikiPdfGroup = function(groupId) {
      var currentName = getPdfWikiGroupName(groupId);
      pdfWikiPendingRenameGroupId = String(groupId || '');
      showModal('重命名 PDF 分组',
        '<div style="display:flex;flex-direction:column;gap:12px;color:var(--text-primary);">' +
          '<div style="font-size:12px;line-height:1.6;color:var(--text-secondary);padding:10px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);">保存后会按新名称重新检索标题和摘要，并把命中的 PDF 添加到该分组；已有标签不会被移除或覆盖。</div>' +
          '<label style="font-size:12px;font-weight:700;color:var(--text-secondary);">新的组别名称</label>' +
          '<input id="pdfWikiRenameGroupInput" maxlength="80" value="' + escapeHtml(currentName) + '" placeholder="请输入新的组别名称" style="margin-bottom:0;">' +
          '<div class="btns" style="margin-top:4px;">' +
            '<button class="cancel" type="button" onclick="closeModal()">取消</button>' +
            '<button id="pdfWikiRenameGroupSaveBtn" class="ok" type="button" onclick="submitRenamePdfWikiPdfGroup()">保存</button>' +
          '</div>' +
        '</div>',
        false,
        false,
        {
          preserveStandaloneSurfaceId: 'pdfWikiViewerModal',
          overlayClass: 'app-secondary-overlay app-tertiary-overlay pdf-wiki-group-rename-overlay'
        }
      );
      setTimeout(function() {
        var input = document.getElementById('pdfWikiRenameGroupInput');
        if (!input) return;
        input.focus();
        input.select();
        input.addEventListener('keydown', function(event) {
          if (event.key === 'Enter') {
            event.preventDefault();
            submitRenamePdfWikiPdfGroup();
          }
        });
      }, 0);
    };

    window.submitRenamePdfWikiPdfGroup = async function() {
      var groupId = String(pdfWikiPendingRenameGroupId || '');
      if (!groupId) return;
      var input = document.getElementById('pdfWikiRenameGroupInput');
      var saveBtn = document.getElementById('pdfWikiRenameGroupSaveBtn');
      var name = input ? String(input.value || '').trim() : '';
      if (!name) {
        alert('分组名称不能为空');
        if (input) input.focus();
        return;
      }
      try {
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.textContent = '保存中...';
        }
        var response = await fetch('/api/pdf-wiki/pdf-groups/' + encodeURIComponent(groupId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, name: name })
        });
        var result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '重命名失败');
        setPdfWikiPdfManagerAutoGroupNotice(name, result.autoMatch);
        closeModal();
        pdfWikiPendingRenameGroupId = '';
        if (document.getElementById('pdfWikiViewerModal')) {
          await reloadPdfWikiPdfManager();
        } else {
          await window.showPdfWikiPdfManager({ preserveOverviewReturn: true });
        }
      } catch (e) {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = '保存';
        }
        alert('重命名失败：' + e.message);
      }
    };

    window.deletePdfWikiPdfGroupClient = async function(groupId) {
      if (!confirm('确定删除分组“' + getPdfWikiGroupName(groupId) + '”吗？\n\n只会移除 PDF 与该分组的关系；PDF 文件不会删除，PDF 在其他分组里的关系会保留。')) return;
      try {
        var response = await fetch('/api/pdf-wiki/pdf-groups/' + encodeURIComponent(groupId) + '?userId=' + encodeURIComponent(currentUserId), { method: 'DELETE' });
        var result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '删除分组失败');
        pdfWikiPdfManagerSelectedGroupId = 'all';
        await reloadPdfWikiPdfManager();
      } catch (e) {
        alert('删除分组失败：' + e.message);
      }
    };

    window.movePdfWikiPdfToGroup = async function(pdfId, groupId) {
      try {
        var response = await fetch('/api/pdf-wiki/pdfs/' + encodeURIComponent(pdfId) + '/group', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, groupId: groupId || '' })
        });
        var result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '移动分组失败');
        await reloadPdfWikiPdfManager();
      } catch (e) {
        alert('移动分组失败：' + e.message);
      }
    };

    window.setPdfWikiPdfGroupChecked = async function(pdfId, groupId, checked, inputEl) {
      var pdf = getPdfWikiPdfById(pdfId);
      if (!pdf) return;
      var previousGroupIds = getPdfWikiPdfGroupIds(pdf).slice();
      var wasVisible = isPdfWikiPdfVisibleInManager(pdf);
      var groupIds = previousGroupIds.slice();
      var index = groupIds.indexOf(groupId);
      if (checked && index === -1) groupIds.push(groupId);
      if (!checked && index !== -1) groupIds.splice(index, 1);
      if (inputEl) inputEl.disabled = true;
      try {
        var response = await fetch('/api/pdf-wiki/pdfs/' + encodeURIComponent(pdfId) + '/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, groupIds: groupIds })
        });
        var result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '更新分组失败');
        var savedGroupIds = result.assignments && result.assignments[pdfId]
          ? result.assignments[pdfId]
          : groupIds;
        setPdfWikiPdfGroupIds(pdfId, savedGroupIds);
        var badge = document.getElementById('pdfWikiPdfGroupBadge-' + getPdfWikiDomIdPart(pdfId));
        if (badge) badge.textContent = getPdfWikiPdfGroupNames(pdf);
        refreshPdfWikiPdfManagerStatsInline();
        var nowVisible = isPdfWikiPdfVisibleInManager(pdf);
        if (!checked || wasVisible !== nowVisible) {
          renderPdfWikiPdfManagerPreservingScroll();
          return;
        }
        if (inputEl) inputEl.disabled = false;
      } catch (e) {
        setPdfWikiPdfGroupIds(pdfId, previousGroupIds);
        if (inputEl) {
          inputEl.checked = previousGroupIds.indexOf(groupId) !== -1;
          inputEl.disabled = false;
        }
        var rollbackBadge = document.getElementById('pdfWikiPdfGroupBadge-' + getPdfWikiDomIdPart(pdfId));
        if (rollbackBadge) rollbackBadge.textContent = getPdfWikiPdfGroupNames(pdf);
        refreshPdfWikiPdfManagerStatsInline();
        alert('更新分组失败：' + e.message);
      }
    };

    function stopPdfWikiRecognitionQueuePolling() {
      if (pdfWikiRecognitionQueuePollTimer) {
        clearTimeout(pdfWikiRecognitionQueuePollTimer);
        pdfWikiRecognitionQueuePollTimer = null;
      }
    }

    function schedulePdfWikiRecognitionQueuePolling() {
      stopPdfWikiRecognitionQueuePolling();
      if (!isPdfWikiRecognitionQueueActive(pdfWikiRecognitionQueueSnapshot)) return;
      pdfWikiRecognitionQueuePollTimer = setTimeout(function() {
        pdfWikiRecognitionQueuePollTimer = null;
        refreshPdfWikiRecognitionQueueStatus().catch(function(error) {
          console.warn('[PdfWikiRecognitionQueue] 读取进度失败:', error);
          schedulePdfWikiRecognitionQueuePolling();
        });
      }, 1200);
    }

    async function applyPdfWikiRecognitionQueueSnapshot(snapshot) {
      var wasActive = pdfWikiBatchReidentifyRunning;
      pdfWikiRecognitionQueueSnapshot = snapshot || null;
      pdfWikiBatchReidentifyRunning = isPdfWikiRecognitionQueueActive(snapshot);
      var trackedJobs = getPdfWikiRecognitionQueueTrackedJobs(snapshot);
      var completionKey = trackedJobs.length > 0 && trackedJobs.every(function(job) {
        return job.status === 'completed' || job.status === 'error';
      })
        ? trackedJobs.map(function(job) { return job.id + ':' + job.updatedAt; }).sort().join('|')
        : '';

      if (!updatePdfWikiRecognitionQueueStatusBarOnly() && pdfWikiPdfManagerData && document.getElementById('pdfWikiPdfManagerScroll')) {
        renderPdfWikiPdfManagerPreservingScroll();
      } else {
        refreshPdfWikiPdfSelectionUi();
      }

      if (pdfWikiBatchReidentifyRunning) {
        schedulePdfWikiRecognitionQueuePolling();
        return;
      }
      stopPdfWikiRecognitionQueuePolling();

      if (completionKey && completionKey !== pdfWikiRecognitionQueueLastCompletionKey) {
        pdfWikiRecognitionQueueLastCompletionKey = completionKey;
        if (document.getElementById('pdfWikiPdfManagerScroll')) {
          var scrollTop = getPdfWikiPdfManagerScrollTop();
          await reloadPdfWikiPdfManager({ scrollTop: scrollTop });
        }
        var completedItems = [];
        trackedJobs.forEach(function(job) {
          if (Array.isArray(job.items)) completedItems = completedItems.concat(job.items);
        });
        var successCount = completedItems.filter(function(item) { return item.status === 'completed'; }).length;
        var failedItems = completedItems.filter(function(item) { return item.status === 'error'; });
        var label = pdfWikiRecognitionQueueCompletionLabel || 'PDF 持久化识别';
        appendMessage(
          label + '完成：成功 ' + successCount + '/' + completedItems.length + ' 个 PDF'
            + (failedItems.length > 0
              ? '\n失败 ' + failedItems.length + ' 个：' + failedItems.slice(0, 8).map(function(item) {
                  return item.pdfName || item.pdfId;
                }).join('、')
              : ''),
          'bot',
          false,
          true
        );
        setTimeout(function() {
          if (isPdfWikiRecognitionQueueActive(pdfWikiRecognitionQueueSnapshot)) return;
          pdfWikiRecognitionQueueTrackedJobIds = [];
          pdfWikiRecognitionQueueCompletionLabel = '';
          pdfWikiRecognitionQueueSnapshot = null;
          if (!updatePdfWikiRecognitionQueueStatusBarOnly() && pdfWikiPdfManagerData && document.getElementById('pdfWikiPdfManagerScroll')) {
            renderPdfWikiPdfManagerPreservingScroll();
          }
        }, 5000);
      } else if (wasActive) {
        refreshPdfWikiPdfSelectionUi();
      }
    }

    async function refreshPdfWikiRecognitionQueueStatus() {
      var response = await fetch('/api/pdf-wiki/recognition-queue?userId=' + encodeURIComponent(currentUserId));
      var result = await readPdfWikiMetaJsonResponse(response, '读取 PDF 识别队列');
      await applyPdfWikiRecognitionQueueSnapshot(result.queue || null);
      return result.queue || null;
    }

    async function submitPdfWikiRecognitionBatch(ids, options) {
      options = options || {};
      ids = Array.from(new Set((Array.isArray(ids) ? ids : []).filter(Boolean)));
      if (ids.length === 0 || pdfWikiBatchReidentifyRunning) return;
      if (options.confirmMessage && !confirm(options.confirmMessage)) return;
      pdfWikiBatchReidentifyRunning = true;
      pdfWikiRecognitionQueueCompletionLabel = options.completionLabel || 'PDF 持久化识别';
      refreshPdfWikiPdfSelectionUi();
      try {
        var items = ids.map(function(pdfId) {
          var pdf = getPdfWikiPdfById(pdfId);
          var imagesOnly = options.imagesOnlyWhenRecognizedMissingImages === true
            && isPdfWikiPdfRecognized(pdf)
            && isPdfWikiPdfMissingImages(pdf);
          return { pdfId: pdfId, mode: imagesOnly ? 'images-only' : 'full' };
        });
        var response = await fetch('/api/pdf-wiki/recognition-queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, items: items })
        });
        var result = await readPdfWikiMetaJsonResponse(response, '提交 PDF 识别队列');
        var addedJobIds = result.queue && Array.isArray(result.queue.addedJobIds)
          ? result.queue.addedJobIds
          : [];
        pdfWikiRecognitionQueueTrackedJobIds = addedJobIds.length > 0
          ? addedJobIds
          : (result.queue && result.queue.activeJobId ? [result.queue.activeJobId] : []);
        if (options.clearSelection === true) pdfWikiSelectedPdfIds = {};
        await applyPdfWikiRecognitionQueueSnapshot(result.queue || null);
      } catch (error) {
        pdfWikiBatchReidentifyRunning = false;
        refreshPdfWikiPdfSelectionUi();
        throw error;
      }
    }

    async function requestPdfWikiReidentify(pdfId, options) {
      options = options || {};
      var response = await fetch('/api/pdf-wiki/pdfs/' + encodeURIComponent(pdfId) + '/reidentify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          imagesOnly: options.imagesOnly === true
        })
      });
      return readPdfWikiMetaJsonResponse(response, '重新识别PDF');
    }

    function applyPdfWikiReidentifyResult(pdfId, result) {
      if (!pdfWikiPdfManagerData || !Array.isArray(pdfWikiPdfManagerData.pdfs) || !result || !result.pdf) return;
      var pdf = pdfWikiPdfManagerData.pdfs.find(function(item) { return item.id === pdfId; });
      if (!pdf) return;
      Object.assign(pdf, result.pdf);
    }

    function formatPdfWikiReidentifyMessage(result, fallback) {
      var message = (result && result.message) || fallback || 'PDF 重新识别完成';
      if (result && result.figureError) {
        message += '\n\n图片提取提示：' + result.figureError;
      }
      return message;
    }

    window.reidentifyPdfWikiPdf = async function(pdfId) {
      var button = document.getElementById('pdfReidentifyBtn-' + getPdfWikiDomIdPart(pdfId));
      var scrollTop = getPdfWikiPdfManagerScrollTop();
      if (button) {
        button.disabled = true;
        button.textContent = '识别中...';
        button.style.cursor = 'not-allowed';
        button.style.opacity = '0.65';
      }
      try {
        var result = await requestPdfWikiReidentify(pdfId);
        applyPdfWikiReidentifyResult(pdfId, result);
        await reloadPdfWikiPdfManager({ scrollTop: scrollTop });
        appendMessage(formatPdfWikiReidentifyMessage(result, 'PDF 重新识别完成'), 'bot', false, true);
      } catch (e) {
        alert('重新识别PDF失败：' + e.message);
      } finally {
        if (button && button.isConnected) {
          var currentPdf = getPdfWikiPdfById(pdfId);
          button.disabled = false;
          button.textContent = isPdfWikiPdfRecognized(currentPdf) ? '重新识别PDF' : '识别PDF';
          button.style.cursor = 'pointer';
          button.style.opacity = '1';
        }
      }
    };

    async function runPdfWikiReidentifyBatch(ids, options) {
      try {
        await submitPdfWikiRecognitionBatch(ids, options);
      } catch (error) {
        alert('提交 PDF 识别队列失败：' + error.message);
      }
    }

    window.reidentifySelectedPdfWikiPdfs = function() {
      var ids = getPdfWikiSelectedPdfIds();
      return runPdfWikiReidentifyBatch(ids, {
        buttonId: 'pdfWikiBatchReidentifyBtn',
        clearSelection: true,
        completionLabel: '批量重新识别',
        confirmMessage: '将使用 LiteParse 逐个重新识别选中的 ' + ids.length + ' 个 PDF。\n\n会更新标题、作者、年份、期刊、DOI、正文缓存和图片信息，不会删除已有论点库。确定继续吗？'
      });
    };

    window.recognizeUnrecognizedPdfWikiPdfs = function() {
      var pdfs = pdfWikiPdfManagerData && Array.isArray(pdfWikiPdfManagerData.pdfs)
        ? pdfWikiPdfManagerData.pdfs
        : [];
      var ids = getPdfWikiPdfsNeedingLocalRecognitionIds();
      if (ids.length === 0) {
        alert(pdfs.length > 0 ? '当前 PDF 均已完成本地识别并提取到图片，无需重复处理。' : '当前没有可识别的 PDF。');
        return;
      }
      return runPdfWikiReidentifyBatch(ids, {
        buttonId: 'pdfWikiRecognizePendingPdfBtn',
        clearSelection: false,
        completionLabel: '未识别/无图片 PDF 本地识别',
        imagesOnlyWhenRecognizedMissingImages: true
      });
    };

    async function requestPdfWikiDeepAnalysis(pdfId, force, skipIfAnalyzed) {
      var response = await fetch('/api/pdf-wiki/pdfs/' + encodeURIComponent(pdfId) + '/deep-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          force: !!force,
          skipIfAnalyzed: !!skipIfAnalyzed
        })
      });
      var result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '深入分析失败');
      pdfWikiDeepAnalysisResults[pdfId] = result;
      return result;
    }

    function applyPdfWikiDeepAnalysisResult(pdfId, result) {
      pdfWikiDeepAnalysisResults[pdfId] = result;
      if (!pdfWikiPdfManagerData || !Array.isArray(pdfWikiPdfManagerData.pdfs)) return;
      var pdf = pdfWikiPdfManagerData.pdfs.find(function(item) { return item.id === pdfId; });
      if (!pdf) return;
      var resultPdf = result && result.pdf ? result.pdf : {};
      ['title', 'authors', 'year', 'journal', 'doi', 'textLength', 'parsedTextCachedAt', 'processedAt'].forEach(function(key) {
        if (resultPdf[key] !== undefined && resultPdf[key] !== null && resultPdf[key] !== '') {
          pdf[key] = resultPdf[key];
        }
      });
      if (Array.isArray(resultPdf.figurePreviews)) {
        pdf.figurePreviews = resultPdf.figurePreviews;
      }
      pdf.figureCount = Number(resultPdf.figureCount || (pdf.figurePreviews && pdf.figurePreviews.length) || 0);
      pdf.figuresAvailable = resultPdf.figuresAvailable === true || pdf.figureCount > 0;
      pdf.deepAnalysisAvailable = true;
      pdf.detailsLoaded = true;
      pdf.deepAnalysis = result;
    }

    window.runPdfWikiDeepAnalysis = async function(pdfId, force) {
      var button = document.getElementById('pdfDeepAnalysisBtn-' + getPdfWikiDomIdPart(pdfId));
      var scrollTop = getPdfWikiPdfManagerScrollTop();
      if (button) {
        button.disabled = true;
        button.textContent = '分析中...';
      }
      try {
        var result = await requestPdfWikiDeepAnalysis(pdfId, !!force);
        pdfWikiDeepAnalysisCollapsed[pdfId] = false;
        applyPdfWikiDeepAnalysisResult(pdfId, result);
        if (pdfWikiPdfManagerData) {
          renderPdfWikiPdfManager(pdfWikiPdfManagerData, { scrollTop: scrollTop });
        } else {
          await reloadPdfWikiPdfManager({ scrollTop: scrollTop });
        }
      } catch (e) {
        alert('深入分析失败：' + e.message);
      } finally {
        if (button && button.isConnected) {
          var currentPdf = getPdfWikiPdfById(pdfId);
          button.disabled = false;
          button.textContent = isPdfWikiPdfDeepAnalyzed(currentPdf) ? '重新分析' : '深入分析';
          button.style.cursor = 'pointer';
          button.style.opacity = '1';
        }
      }
    };

    async function runPdfWikiDeepAnalysisBatch(ids, options) {
      options = options || {};
      ids = Array.from(new Set((Array.isArray(ids) ? ids : []).filter(Boolean)));
      if (ids.length === 0 || pdfWikiBatchDeepAnalysisRunning) return;
      pdfWikiBatchDeepAnalysisRunning = true;
      var scrollTop = getPdfWikiPdfManagerScrollTop();
      var batchButton = document.getElementById(options.buttonId || 'pdfWikiBatchDeepAnalysisBtn');
      var successCount = 0;
      var skippedCount = Math.max(0, Number(options.preSkippedCount || 0));
      var failedItems = [];
      refreshPdfWikiPdfSelectionUi();
      if (batchButton) {
        batchButton.disabled = true;
        batchButton.textContent = '分析 0/' + ids.length;
        batchButton.style.cursor = 'not-allowed';
        batchButton.style.opacity = '0.58';
      }
      try {
        for (var i = 0; i < ids.length; i++) {
          var pdfId = ids[i];
          var button = document.getElementById('pdfDeepAnalysisBtn-' + getPdfWikiDomIdPart(pdfId));
          if (button) {
            button.disabled = true;
            button.textContent = '队列 ' + (i + 1) + '/' + ids.length;
            button.style.cursor = 'not-allowed';
            button.style.opacity = '0.65';
          }
          if (batchButton) batchButton.textContent = '分析 ' + (i + 1) + '/' + ids.length;
          try {
            var result = await requestPdfWikiDeepAnalysis(pdfId, false, options.skipIfAnalyzed === true);
            if (result && result.skipped) {
              var skippedPdf = getPdfWikiPdfById(pdfId);
              if (skippedPdf) {
                skippedPdf.deepAnalysisAvailable = true;
              }
              skippedCount += 1;
              if (button) button.textContent = '已跳过';
              continue;
            }
            pdfWikiDeepAnalysisCollapsed[pdfId] = true;
            applyPdfWikiDeepAnalysisResult(pdfId, result);
            successCount += 1;
            if (button) button.textContent = '已分析';
          } catch (itemError) {
            var pdf = getPdfWikiPdfById(pdfId);
            failedItems.push((pdf && (pdf.title || pdf.originalName)) || pdfId);
            if (button) button.textContent = '失败';
            console.warn('[PdfWiki] 批量深入分析失败:', pdfId, itemError);
          }
        }
        if (options.clearSelection === true) pdfWikiSelectedPdfIds = {};
        var msg = (options.completionLabel || '批量深入分析') + '完成：新增分析 ' + successCount + '/' + ids.length + ' 个 PDF';
        if (skippedCount > 0) {
          msg += '\n已跳过已有分析结果 ' + skippedCount + ' 个 PDF';
        }
        if (failedItems.length > 0) {
          msg += '\n失败 ' + failedItems.length + ' 个：' + failedItems.slice(0, 8).join('、') + (failedItems.length > 8 ? ' 等' : '');
        }
        appendMessage(msg, 'bot', false, true);
      } finally {
        pdfWikiBatchDeepAnalysisRunning = false;
        if (pdfWikiPdfManagerData) {
          renderPdfWikiPdfManager(pdfWikiPdfManagerData, { scrollTop: scrollTop });
        } else {
          refreshPdfWikiPdfSelectionUi();
        }
      }
    }

    window.runSelectedPdfWikiDeepAnalysis = function() {
      return runPdfWikiDeepAnalysisBatch(getPdfWikiSelectedPdfIds(), {
        buttonId: 'pdfWikiBatchDeepAnalysisBtn',
        skipIfAnalyzed: true,
        clearSelection: true,
        completionLabel: '批量深入分析'
      });
    };

    window.deleteSelectedPdfWikiEntries = async function() {
      var entryIds = getPdfWikiSelectedEntryIds();
      if (entryIds.length === 0) return;
      if (!confirm('确定删除选中的 ' + entryIds.length + ' 个论点吗？\n\n删除后会从 PDF Wiki 论点库和检索索引中移除。')) {
        return;
      }

      try {
        var response = await fetch('/api/pdf-wiki/entries/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, entryIds: entryIds })
        });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '删除论点失败');
        }
        pdfWikiSelectedEntryIds = {};
        await reloadPdfWikiViewer(null);
      } catch (e) {
        alert('删除论点失败：' + e.message);
      }
    };

    window.mergeSelectedPdfWikiEntries = async function() {
      var entryIds = getPdfWikiSelectedEntryIds();
      if (entryIds.length < 2) return;
      var selectedEntries = getPdfWikiEntriesByIds(entryIds);
      var defaultClaim = selectedEntries[0] ? (selectedEntries[0].normalizedClaim || selectedEntries[0].claim || '合并论点') : '合并论点';
      var normalizedClaim = prompt('请输入合并后的论点名称：', defaultClaim);
      if (normalizedClaim === null) return;

      try {
        var response = await fetch('/api/pdf-wiki/entries/merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            entryIds: entryIds,
            normalizedClaim: normalizedClaim
          })
        });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '合并论点失败');
        }
        pdfWikiSelectedEntryIds = {};
        await reloadPdfWikiViewer(result.mergedEntry && result.mergedEntry.id);
      } catch (e) {
        alert('合并论点失败：' + e.message);
      }
    };

    window.selectPdfWikiEntry = function(entryId) {
      if (!pdfWikiViewerData) return;
      var entries = Array.isArray(pdfWikiViewerData.entries) ? pdfWikiViewerData.entries : [];
      var entry = entries.find(function(item) { return item.id === entryId; });
      if (!entry) return;
      pdfWikiActiveEntryId = entryId;

      var detail = document.getElementById('pdfWikiEntryDetail');
      if (detail) {
        detail.innerHTML = renderPdfWikiEntryDetail(entry);
        detail.scrollTop = 0;
      }
      updatePdfWikiEntryListActive(entryId);
    };

    window.filterPdfWikiEntries = function(query) {
      if (!pdfWikiViewerData) return;
      var entries = Array.isArray(pdfWikiViewerData.entries) ? pdfWikiViewerData.entries : [];
      var text = String(query || '').trim().toLowerCase();
      if (!text) {
        renderPdfWikiViewer(pdfWikiViewerData, entries[0] ? entries[0].id : null);
        return;
      }

      var filtered = entries.filter(function(entry) {
        var haystack = [
          entry.claim,
          entry.normalizedClaim,
          entry.displayClaimZh,
          (entry.similarClaims || []).map(function(item) { return [item.claim, item.displayClaimZh, item.reason].join(' '); }).join(' '),
          (entry.sourcePdfNames || []).join(' '),
          (entry.inTextCitations || []).join(' '),
          (entry.references || []).map(function(ref) {
            return [ref.title, ref.authors, ref.year, ref.journal, ref.doi, ref.raw].join(' ');
          }).join(' ')
        ].join(' ').toLowerCase();
        return haystack.indexOf(text) !== -1;
      });

      if (filtered.length === 0) {
        var list = document.getElementById('pdfWikiEntryList');
        var detail = document.getElementById('pdfWikiEntryDetail');
        if (list) {
          list.innerHTML = '<div style="padding:14px;color:var(--text-secondary);font-size:13px;text-align:center;">没有匹配的论点</div>';
        }
        if (detail) {
          detail.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:13px;">没有匹配的论点</div>';
        }
        return;
      }

      var scopedData = Object.assign({}, pdfWikiViewerData, { entries: filtered });
      renderPdfWikiViewer(scopedData, filtered[0] ? filtered[0].id : null);
      var input = document.getElementById('pdfWikiSearchInput');
      if (input) {
        input.value = query;
        input.focus();
      }
    };

    function getPdfWikiSupportViews(entry) {
      return Array.isArray(entry.pro) ? entry.pro : [];
    }

    function getPdfWikiOpposeViews(entry) {
      return Array.isArray(entry.con) ? entry.con : [];
    }

    function getPdfWikiNeutralViews(entry) {
      return Array.isArray(entry.neutral) ? entry.neutral : [];
    }

    function getPdfWikiDisplayClaim(entry) {
      return entry.displayClaimZh || entry.normalizedClaim || entry.claim || '未命名论点';
    }

    function getPdfWikiOriginalClaim(entry) {
      return entry.normalizedClaim || entry.claim || '';
    }

    function renderPdfWikiEntryDetail(entry) {
      var claim = getPdfWikiDisplayClaim(entry);
      var originalClaim = getPdfWikiOriginalClaim(entry);
      var supportViews = getPdfWikiSupportViews(entry);
      var opposeViews = getPdfWikiOpposeViews(entry);
      var neutral = getPdfWikiNeutralViews(entry);
      var sourceNames = Array.isArray(entry.sourcePdfNames) ? entry.sourcePdfNames : [];
      var sections = Array.isArray(entry.sections) ? entry.sections.filter(Boolean) : [];
      var supportDocs = collectPdfWikiDocuments(supportViews, entry);
      var opposeDocs = collectPdfWikiDocuments(opposeViews, entry);
      var neutralDocs = collectPdfWikiDocuments(neutral, entry);

      return '<div style="padding:20px 22px 28px;">' +
        '<div style="margin-bottom:18px;">' +
          '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:6px;">' +
            '<div style="font-size:12px;color:var(--text-secondary);padding-top:6px;">论点</div>' +
            renderPdfWikiFavoriteButton(entry.id, Boolean(entry.favorite), false) +
          '</div>' +
          '<div style="font-size:20px;font-weight:700;line-height:1.45;color:var(--text-primary);">' + escapeHtml(claim) + '</div>' +
          (originalClaim && originalClaim !== claim ? '<div style="margin-top:8px;font-size:12px;line-height:1.6;color:var(--text-secondary);"><strong style="color:var(--text-primary);">原始论点：</strong>' + escapeHtml(originalClaim) + '</div>' : '') +
          '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;color:var(--text-secondary);font-size:12px;">' +
            '<span style="padding:4px 8px;border:1px solid var(--border-color);border-radius:12px;">支持观点 ' + supportViews.length + '</span>' +
            '<span style="padding:4px 8px;border:1px solid var(--border-color);border-radius:12px;">中性观点 ' + neutral.length + '</span>' +
            '<span style="padding:4px 8px;border:1px solid var(--border-color);border-radius:12px;">反对观点 ' + opposeViews.length + '</span>' +
            '<span style="padding:4px 8px;border:1px solid var(--border-color);border-radius:12px;">支持来源 ' + supportDocs.length + '</span>' +
            '<span style="padding:4px 8px;border:1px solid var(--border-color);border-radius:12px;">中性来源 ' + neutralDocs.length + '</span>' +
            '<span style="padding:4px 8px;border:1px solid var(--border-color);border-radius:12px;">反对来源 ' + opposeDocs.length + '</span>' +
            (entry.similarClaims && entry.similarClaims.length > 0 ? '<span style="padding:4px 8px;border:1px solid var(--accent-color);border-radius:12px;color:var(--accent-color);">相似论点 ' + entry.similarClaims.length + '</span>' : '') +
          '</div>' +
        '</div>' +
        renderPdfWikiSimilarClaims(entry) +
        '<div style="overflow-x:auto;padding-bottom:2px;">' +
          '<div style="display:grid;grid-template-columns:repeat(3,minmax(230px,1fr));gap:14px;align-items:start;min-width:740px;">' +
            renderPdfWikiSide('支持观点/来源', supportDocs, supportViews, '未解析到明确支持该论点的来源') +
            renderPdfWikiSide('中性观点/来源', neutralDocs, neutral, '未解析到中性背景或机制来源') +
            renderPdfWikiSide('反对观点/来源', opposeDocs, opposeViews, '未解析到明确反对该论点的来源') +
          '</div>' +
        '</div>' +
        '<div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--border-color);color:var(--text-secondary);font-size:12px;line-height:1.7;">' +
          '<div><strong style="color:var(--text-primary);">来源 PDF：</strong>' + escapeHtml(sourceNames.join('; ') || '未解析') + '</div>' +
          '<div><strong style="color:var(--text-primary);">章节：</strong>' + escapeHtml(sections.join('; ') || '未解析') + '</div>' +
          '<div><strong style="color:var(--text-primary);">文中引用：</strong>' + escapeHtml((entry.inTextCitations || []).join('; ') || '未解析') + '</div>' +
        '</div>' +
      '</div>';
    }

    function renderPdfWikiSimilarClaims(entry) {
      var similar = Array.isArray(entry.similarClaims) ? entry.similarClaims : [];
      if (similar.length === 0) return '';

      return '<div style="margin-bottom:16px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:14px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">' +
          '<div style="font-size:14px;font-weight:650;color:var(--text-primary);">相似论点</div>' +
          '<span style="font-size:11px;color:var(--text-secondary);">' + similar.length + ' 个</span>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;">' +
          similar.map(function(item) {
            var score = Number(item.similarity || 0);
            var scoreText = score > 0 ? Math.round(score * 100) + '%' : '相似';
            var title = item.displayClaimZh || item.claim || '未命名论点';
            return '<button type="button" data-entry-id="' + escapeHtml(item.entryId || '') + '" onclick="selectPdfWikiEntry(this.dataset.entryId)" ' +
              'style="width:100%;text-align:left;padding:10px 11px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-primary);color:var(--text-primary);cursor:pointer;">' +
                '<div style="display:flex;gap:8px;justify-content:space-between;align-items:flex-start;">' +
                  '<div style="min-width:0;flex:1;font-size:13px;font-weight:600;line-height:1.45;">' + escapeHtml(title) + '</div>' +
                  '<span style="flex-shrink:0;font-size:11px;color:var(--accent-color);">' + escapeHtml(scoreText) + '</span>' +
                '</div>' +
                (item.reason ? '<div style="margin-top:6px;font-size:12px;color:var(--text-secondary);line-height:1.55;">' + escapeHtml(item.reason) + '</div>' : '') +
              '</button>';
          }).join('') +
        '</div>' +
      '</div>';
    }

    function renderPdfWikiSide(title, refs, viewpoints, emptyText) {
      var refHtml = refs.length > 0
        ? refs.map(renderPdfWikiReferenceCard).join('')
        : '<div style="padding:12px;color:var(--text-secondary);font-size:12px;border:1px dashed var(--border-color);border-radius:8px;">' + escapeHtml(emptyText) + '</div>';
      var viewpointHtml = viewpoints.length > 0
        ? '<div style="margin-top:12px;">' + viewpoints.map(renderPdfWikiViewpoint).join('') + '</div>'
        : '';

      return '<section style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:14px;min-width:0;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:12px;">' +
          '<h4 style="margin:0;font-size:14px;color:var(--text-primary);">' + escapeHtml(title) + '</h4>' +
          '<span style="font-size:11px;color:var(--text-secondary);">' + refs.length + ' 条</span>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:10px;">' + refHtml + '</div>' +
        viewpointHtml +
      '</section>';
    }

    function renderPdfWikiReferenceCard(ref) {
      var title = ref.title || ref.raw || '未解析标题';
      var authors = ref.authors || '作者未解析';
      var year = ref.year || '年份未解析';
      var journal = ref.journal || '来源未解析';
      var doi = normalizeDoi(ref.doi || '');
      var supportReasons = Array.isArray(ref.supportReasons) ? ref.supportReasons.filter(Boolean) : [];
      var evidenceSnippets = Array.isArray(ref.supportEvidence) ? ref.supportEvidence.filter(Boolean) : [];
      var evidenceSentences = Array.isArray(ref.supportEvidenceSentences) ? ref.supportEvidenceSentences.filter(Boolean) : [];
      var supportCitations = Array.isArray(ref.supportCitations) ? ref.supportCitations.filter(Boolean) : [];
      var supportSections = Array.isArray(ref.supportSections) ? ref.supportSections.filter(Boolean) : [];
      var evidenceHtml = '';
      if (supportReasons.length > 0 || evidenceSnippets.length > 0 || evidenceSentences.length > 0) {
        evidenceHtml =
          '<div style="margin-top:10px;padding-top:9px;border-top:1px solid var(--border-color);font-size:12px;line-height:1.65;color:var(--text-secondary);">' +
            (supportReasons.length > 0
              ? '<div><strong style="color:var(--text-primary);">支持原因：</strong>' + escapeHtml(supportReasons.slice(0, 3).join('；')) + '</div>'
              : '') +
            (evidenceSnippets.length > 0
              ? '<div style="margin-top:6px;"><strong style="color:var(--text-primary);">原文相关内容：</strong>' + escapeHtml(evidenceSnippets.slice(0, 3).join('；')) + '</div>'
              : '') +
            (evidenceSentences.length > 0
              ? '<div style="margin-top:6px;"><strong style="color:var(--text-primary);">证据句：</strong>' + escapeHtml(evidenceSentences.slice(0, 3).join('；')) + '</div>'
              : '') +
            (supportCitations.length > 0
              ? '<div style="margin-top:6px;"><strong style="color:var(--text-primary);">文中引用：</strong>' + escapeHtml(supportCitations.slice(0, 8).join('；')) + '</div>'
              : '') +
            (supportSections.length > 0
              ? '<div style="margin-top:6px;"><strong style="color:var(--text-primary);">来源位置：</strong>' + escapeHtml(supportSections.slice(0, 4).join('；')) + '</div>'
              : '') +
          '</div>';
      }
      var doiHtml = doi
        ? '<a href="' + escapeHtml(toDoiUrl(doi)) + '" target="_blank" rel="noopener noreferrer" style="color:var(--accent-color);text-decoration:underline;word-break:break-all;">' + escapeHtml(doi) + '</a>'
        : '<span style="color:var(--text-secondary);">DOI 未解析</span>';

      return '<article style="padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);">' +
        (ref.fallbackSourcePdf ? '<div style="font-size:11px;color:#f59e0b;margin-bottom:6px;">未匹配到文末参考来源，显示来源 PDF 兜底</div>' : '') +
        '<div style="font-size:13px;font-weight:650;color:var(--text-primary);line-height:1.45;margin-bottom:8px;">' + escapeHtml(title) + '</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);line-height:1.65;">' +
          '<div><strong style="color:var(--text-primary);">作者：</strong>' + escapeHtml(authors) + '</div>' +
          '<div><strong style="color:var(--text-primary);">年份：</strong>' + escapeHtml(year) + '</div>' +
          '<div><strong style="color:var(--text-primary);">来源/期刊：</strong>' + escapeHtml(journal) + '</div>' +
          '<div><strong style="color:var(--text-primary);">DOI：</strong>' + doiHtml + '</div>' +
        '</div>' +
        evidenceHtml +
      '</article>';
    }

    function renderPdfWikiViewpoint(viewpoint, index) {
      return '<div style="padding:10px 0;border-top:1px solid var(--border-color);font-size:12px;line-height:1.65;color:var(--text-secondary);">' +
        '<div style="color:var(--text-primary);font-weight:600;margin-bottom:4px;">观点 ' + (index + 1) + '</div>' +
        '<div>' + escapeHtml(viewpoint.summary || '未解析观点') + '</div>' +
        (viewpoint.evidence ? '<div style="margin-top:6px;"><strong style="color:var(--text-primary);">证据：</strong>' + escapeHtml(viewpoint.evidence) + '</div>' : '') +
        '<div style="margin-top:6px;">' +
          '<span>来源 PDF：' + escapeHtml(viewpoint.sourcePdfName || '未解析') + '</span>' +
          (viewpoint.section ? '<span> · 章节：' + escapeHtml(viewpoint.section) + '</span>' : '') +
          (viewpoint.location ? '<span> · 位置：' + escapeHtml(viewpoint.location) + '</span>' : '') +
        '</div>' +
      '</div>';
    }

    function collectPdfWikiDocuments(viewpoints, entry) {
      var docs = [];
      var seen = {};
      var docMap = {};
      var sourceDocuments = Array.isArray(entry.sourceDocuments) ? entry.sourceDocuments : [];
      var docsById = {};
      var docsByName = {};

      function uniquePush(list, value) {
        value = String(value || '').trim();
        if (!value) return;
        if (list.indexOf(value) === -1) list.push(value);
      }

      function getDocumentKey(doc) {
        return String(doc.doi || doc.title || doc.raw || doc.id || doc.sourcePdfId || doc.sourcePdfName || '').trim().toLowerCase();
      }

      function enrichDocument(doc, viewpoint) {
        if (!doc || !viewpoint) return doc;
        doc.supportReasons = Array.isArray(doc.supportReasons) ? doc.supportReasons : [];
        doc.supportEvidence = Array.isArray(doc.supportEvidence) ? doc.supportEvidence : [];
        doc.supportEvidenceSentences = Array.isArray(doc.supportEvidenceSentences) ? doc.supportEvidenceSentences : [];
        doc.supportCitations = Array.isArray(doc.supportCitations) ? doc.supportCitations : [];
        doc.supportSections = Array.isArray(doc.supportSections) ? doc.supportSections : [];
        uniquePush(doc.supportReasons, viewpoint.summary);
        uniquePush(doc.supportEvidence, viewpoint.evidence);
        (Array.isArray(viewpoint.evidenceSentences) ? viewpoint.evidenceSentences : []).forEach(function(sentence) {
          uniquePush(doc.supportEvidenceSentences, sentence);
        });
        (Array.isArray(viewpoint.inTextCitations) ? viewpoint.inTextCitations : []).forEach(function(citation) {
          uniquePush(doc.supportCitations, citation);
        });
        uniquePush(doc.supportSections, [viewpoint.section, viewpoint.location].filter(Boolean).join(' · '));
        return doc;
      }

      function addDocument(doc, viewpoint, fallback) {
        if (!doc) return;
        var enriched = enrichDocument(Object.assign({}, doc, fallback ? { fallbackSourcePdf: true } : {}), viewpoint);
        var key = getDocumentKey(enriched);
        if (!key) return;
        if (!docMap[key]) {
          seen[key] = true;
          docMap[key] = enriched;
          docs.push(enriched);
          return;
        }
        enrichDocument(docMap[key], viewpoint);
      }

      sourceDocuments.forEach(function(doc) {
        if (doc.sourcePdfId) docsById[doc.sourcePdfId] = doc;
        if (doc.sourcePdfName) docsByName[doc.sourcePdfName] = doc;
      });

      viewpoints.forEach(function(viewpoint) {
        (viewpoint.references || []).forEach(function(ref) {
          addDocument(ref, viewpoint, false);
        });
      });

      if (docs.length === 0 && viewpoints.length > 0 && sourceDocuments.length > 0) {
        sourceDocuments.forEach(function(doc) {
          viewpoints.forEach(function(viewpoint) {
            addDocument(doc, viewpoint, true);
          });
        });
      }

      if (docs.length === 0 && viewpoints.length > 0) {
        viewpoints.forEach(function(viewpoint) {
          var doc = docsById[viewpoint.sourcePdfId] || docsByName[viewpoint.sourcePdfName] || inferPdfWikiDocumentFromName(viewpoint.sourcePdfId || viewpoint.sourcePdfName, viewpoint.sourcePdfName);
          addDocument(doc, viewpoint, true);
        });
      }

      return docs;
    }

    function inferPdfWikiDocumentFromName(sourcePdfId, sourcePdfName) {
      var name = String(sourcePdfName || sourcePdfId || '未知 PDF');
      var base = name.replace(/\.pdf$/i, '').replace(/^[a-f0-9]{16}-/, '');
      var parts = base.split(/\s+-\s+/).map(function(part) { return part.trim(); }).filter(Boolean);
      var yearMatch = base.match(/\b(19|20)\d{2}\b/);
      var year = yearMatch ? yearMatch[0] : '未解析';
      var title = base;
      var authors = '未解析';

      var yearIndex = -1;
      for (var i = 0; i < parts.length; i++) {
        if (/\b(19|20)\d{2}\b/.test(parts[i])) {
          yearIndex = i;
          break;
        }
      }
      if (yearIndex >= 0 && yearIndex < parts.length - 1) {
        title = parts.slice(yearIndex + 1).join(' - ');
        if (yearIndex > 0) authors = parts.slice(0, yearIndex).join(' - ');
      }

      return {
        id: String(sourcePdfId || name),
        sourcePdfId: String(sourcePdfId || name),
        sourcePdfName: name,
        title: title || name,
        authors: authors,
        year: year,
        journal: '未解析',
        doi: ''
      };
    }

    function normalizeDoi(doi) {
      return String(doi || '')
        .trim()
        .replace(/^doi:\s*/i, '')
        .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
        .trim();
    }

    function toDoiUrl(doi) {
      var normalized = normalizeDoi(doi);
      if (!normalized) return '';
      if (/^https?:\/\//i.test(doi)) return doi;
      return 'https://doi.org/' + encodeURIComponent(normalized).replace(/%2F/g, '/');
    }

    window.showOverviewPage = async function() {
      academicWorkflowOpenedFromOverview = false;
      setPdfWikiWorkspaceMode('overview');
      if (!document.getElementById('pdfWikiViewerModal')) {
        await window.showPdfWikiViewer({
          initialTitle: 'Overview',
          initialSubtitle: '正在读取全局状态...',
          initialLoadingText: '正在读取 Scholar Harness 全局状态...',
          workflowActiveKey: '',
          skipInitialLoad: true
        });
      }
      setPdfWikiViewerWorkflowActions('');
      var content = document.getElementById('pdfWikiViewerContent');
      var title = document.getElementById('pdfWikiViewerTitle');
      var subtitle = document.getElementById('pdfWikiViewerSubtitle');
      if (title) title.textContent = 'Overview';
      if (subtitle) subtitle.textContent = '正在读取全局状态...';
      if (content) {
        content.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:13px;">正在读取 Overview...</div>';
      }
      try {
        var overview = await loadOverviewStatus();
        renderOverviewPage(overview);
      } catch (e) {
        if (content) {
          content.innerHTML = '<div style="padding:24px;text-align:center;color:var(--danger-color);">读取 Overview 失败：' + escapeHtml(e.message || String(e)) + '</div>';
        }
      }
    };

    async function loadOverviewStatus() {
      var response = await fetch('/api/overview/status?userId=' + encodeURIComponent(currentUserId));
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '读取 Overview 失败');
      overviewData = data.overview || null;
      return overviewData;
    }

    function getOverviewStatusStyle(status) {
      if (status === 'ready') return { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.32)', color: '#047857', label: '就绪' };
      if (status === 'running') return { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.34)', color: '#b45309', label: '运行中' };
      if (status === 'warning') return { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.34)', color: '#b45309', label: '需处理' };
      if (status === 'error') return { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.34)', color: 'var(--danger-color)', label: '异常' };
      return { bg: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.30)', color: '#4f46e5', label: '空' };
    }

    function getOverviewModuleChartStyle(module, index) {
      var palette = {
        literature: ['#2563eb', '#93c5fd'],
        pdfManager: ['#0891b2', '#67e8f9'],
        pdfWiki: ['#7c3aed', '#c4b5fd'],
        meta: ['#db2777', '#f9a8d4'],
        bibliometrics: ['#d97706', '#fbbf24'],
        dataAnalysis: ['#059669', '#6ee7b7'],
        autoResearch: ['#ea580c', '#fdba74'],
        paperWriting: ['#be123c', '#fda4af'],
        memory: ['#4f46e5', '#a5b4fc']
      };
      var fallback = [
        ['#2563eb', '#93c5fd'],
        ['#7c3aed', '#c4b5fd'],
        ['#0891b2', '#67e8f9'],
        ['#db2777', '#f9a8d4']
      ][index % 4];
      var colors = palette[module && module.id] || fallback;
      var empty = module && module.status === 'empty';
      return {
        color: empty ? colors[0] : colors[0],
        top: empty ? colors[1] : colors[0],
        bottom: empty ? 'rgba(255,255,255,0.45)' : colors[1],
        border: empty ? 'rgba(79,70,229,0.26)' : colors[0],
        shadow: empty ? '0 5px 12px rgba(79,70,229,0.12)' : '0 7px 16px rgba(15,23,42,0.16)'
      };
    }

    function renderOverviewStatusBadge(status, text) {
      var style = getOverviewStatusStyle(status);
      return '<span style="display:inline-flex;align-items:center;height:22px;padding:0 8px;border:1px solid ' + style.border + ';border-radius:999px;background:' + style.bg + ';color:' + style.color + ';font-size:11px;font-weight:700;white-space:nowrap;">' + escapeHtml(text || style.label) + '</span>';
    }

    function renderOverviewMetric(label, value) {
      return '<div style="min-width:0;padding:7px 8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-primary);">' +
        '<div style="font-size:10px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(label) + '</div>' +
        '<div style="margin-top:3px;font-size:14px;font-weight:800;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(value == null || value === '' ? '-' : String(value)) + '</div>' +
      '</div>';
    }

    function renderOverviewModuleCard(module) {
      module = module || {};
      var metrics = Array.isArray(module.metrics) ? module.metrics : [];
      return '<div style="min-width:0;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:12px;display:flex;flex-direction:column;gap:10px;">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">' +
          '<div style="min-width:0;">' +
            '<div style="font-size:14px;font-weight:800;color:var(--text-primary);line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(module.name || '-') + '</div>' +
            '<div style="margin-top:3px;font-size:11px;color:var(--text-secondary);">数量：' + escapeHtml(module.count || 0) + '</div>' +
          '</div>' +
          renderOverviewStatusBadge(module.status, module.statusText) +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;">' +
          (metrics.length ? metrics.slice(0, 4).map(function(metric) { return renderOverviewMetric(metric.label, metric.value); }).join('') : renderOverviewMetric('状态', module.statusText || '-')) +
        '</div>' +
        '<div style="font-size:11px;line-height:1.55;color:var(--text-secondary);min-height:34px;">' + escapeHtml(module.note || '') + '</div>' +
        '<button type="button" data-overview-action="' + escapeHtml(module.action || '') + '" style="height:29px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">打开</button>' +
      '</div>';
    }

    function renderOverviewFlowMap(modules) {
      modules = Array.isArray(modules) ? modules : [];
      var ordered = ['literature', 'pdfManager', 'pdfWiki', 'meta', 'bibliometrics', 'dataAnalysis', 'autoResearch', 'paperWriting', 'memory'];
      var byId = {};
      modules.forEach(function(module) { byId[module.id] = module; });
      var chartModules = ordered.map(function(id) { return byId[id]; }).filter(Boolean);
      var values = chartModules.map(function(module) {
        var value = Number(module.count || 0);
        return Number.isFinite(value) && value > 0 ? value : 0;
      });
      var maxLog = Math.max.apply(null, values.map(function(value) { return Math.log10(value + 1); }).concat([1]));
      var statusLegend = [
        { status: 'ready', label: '就绪' },
        { status: 'running', label: '运行中' },
        { status: 'warning', label: '需处理' },
        { status: 'empty', label: '空' }
      ].map(function(item) {
        var style = getOverviewStatusStyle(item.status);
        return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-secondary);white-space:nowrap;">' +
          '<span style="width:9px;height:9px;border-radius:2px;background:' + style.color + ';border:1px solid ' + style.border + ';"></span>' +
          escapeHtml(item.label) +
        '</span>';
      }).join('');
      return '<div style="border:1px solid rgba(37,99,235,0.18);border-radius:8px;background:linear-gradient(180deg,#eff6ff 0%,#eef2ff 100%);padding:13px;margin-bottom:14px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">' +
          '<div style="font-size:14px;font-weight:800;color:var(--text-primary);">全局工具概览柱状图</div>' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' + statusLegend + '</div>' +
        '</div>' +
        '<div style="height:230px;display:grid;grid-template-columns:repeat(' + Math.max(1, chartModules.length) + ',minmax(74px,1fr));gap:10px;align-items:end;padding:8px 6px 0;border:1px solid rgba(37,99,235,0.16);border-radius:8px;background:linear-gradient(180deg,#dbeafe 0%,#f0fdfa 100%);overflow-x:auto;">' +
          chartModules.map(function(module, index) {
            var style = getOverviewStatusStyle(module.status);
            var chartStyle = getOverviewModuleChartStyle(module, index);
            var count = Number(module.count || 0);
            var safeCount = Number.isFinite(count) && count > 0 ? count : 0;
            var normalized = maxLog > 0 ? Math.log10(safeCount + 1) / maxLog : 0;
            var minHeight = module.status === 'empty' ? 10 : 24;
            var barHeight = Math.round(minHeight + normalized * 138);
            if (module.status === 'running') barHeight = Math.max(barHeight, 54);
            var metricSummary = Array.isArray(module.metrics) && module.metrics.length
              ? module.metrics.slice(0, 2).map(function(metric) { return metric.label + ' ' + metric.value; }).join(' / ')
              : (module.statusText || style.label);
            return '<button type="button" data-overview-action="' + escapeHtml(module.action || '') + '" title="' + escapeHtml(module.note || '') + '" style="height:100%;min-width:74px;border:0;background:transparent;color:var(--text-primary);cursor:pointer;padding:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:7px;">' +
                '<div style="font-size:12px;font-weight:850;color:' + chartStyle.color + ';line-height:1;">' + escapeHtml(safeCount) + '</div>' +
                '<div style="width:100%;height:' + barHeight + 'px;border:1px solid ' + chartStyle.border + ';border-radius:7px 7px 4px 4px;background:linear-gradient(180deg,' + chartStyle.top + ' 0%, ' + chartStyle.bottom + ' 100%);box-shadow:' + chartStyle.shadow + ';"></div>' +
                '<div style="width:100%;min-height:44px;display:flex;flex-direction:column;align-items:center;gap:2px;">' +
                  '<div style="width:100%;font-size:11.5px;font-weight:800;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;">' + escapeHtml(module.name || '') + '</div>' +
                  '<div style="width:100%;font-size:10.5px;color:var(--text-secondary);line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;">' + escapeHtml(module.statusText || style.label) + ' · ' + escapeHtml(metricSummary) + '</div>' +
                '</div>' +
              '</button>';
          }).join('') +
        '</div>' +
        '<div style="margin-top:8px;font-size:11px;color:var(--text-secondary);line-height:1.55;">柱高按数量对数归一化显示，数字为真实数量；点击柱子进入对应工具。</div>' +
      '</div>';
    }

    function renderOverviewSummaryPanel(overview) {
      var model = overview.model || {};
      var project = overview.project || {};
      var autoResearch = overview.autoResearch || {};
      var memory = overview.memory || {};
      return '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px;">' +
        renderOverviewMetric('当前项目', project.name || '当前工作区') +
        renderOverviewMetric('写作类型', project.writingProfileLabel || '-') +
        renderOverviewMetric('草原', model.primaryConfigured ? (model.primaryModel || '已配置') : '未配置') +
        renderOverviewMetric('小牛马', model.secondaryConfigured ? (model.secondaryModel || '已配置') : '未配置') +
        renderOverviewMetric('Auto Research', autoResearch.latestReportTitle || autoResearch.status || '-') +
        renderOverviewMetric('Embedding', model.embeddingConfigured ? (model.embeddingModel || '已配置') : '未配置') +
        renderOverviewMetric('Codex CLI', model.codexAvailable ? (model.codexPreferred ? '可用/优先' : '可用') : '未检测到') +
        renderOverviewMetric('PDF解析', 'LiteParse ' + (model.liteParseAvailable ? '可用' : '不可用') + ' / Marker ' + (model.markerAvailable ? '可用' : '不可用')) +
        renderOverviewMetric('长期记忆', (memory.entryCount || 0) + ' 条 / 会话 ' + (memory.conversationCount || 0)) +
      '</div>';
    }

    function renderOverviewResearchEnhancementLauncher() {
      return '<div style="border:1px solid rgba(16,163,127,0.24);border-radius:8px;background:linear-gradient(180deg,rgba(16,163,127,0.11),rgba(16,163,127,0.03));padding:12px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
        '<div style="min-width:0;">' +
          '<div style="font-size:14px;font-weight:900;color:var(--text-primary);">科研增强工具</div>' +
          '<div style="margin-top:4px;font-size:12px;line-height:1.6;color:var(--text-secondary);">证据账本、审稿人 Agent、可复现实验包、内置 Obsidian 知识库和期刊投稿准备。</div>' +
        '</div>' +
        '<button type="button" onclick="showResearchEnhancementWorkspace({ preserveOverviewReturn: true })" style="height:32px;padding:0 12px;border:1px solid var(--accent-color);border-radius:7px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;font-weight:800;white-space:nowrap;">打开科研增强</button>' +
      '</div>';
    }

    function renderOverviewDetailPanel(overview) {
      var literature = overview.literature || {};
      var pdfWiki = overview.pdfWiki || {};
      var meta = overview.meta || {};
      var bibliometrics = overview.bibliometrics || {};
      var dataAnalysis = overview.dataAnalysis || {};
      var drafts = overview.drafts || {};
      var autoResearch = overview.autoResearch || {};
      var recentLiterature = Array.isArray(literature.recent) ? literature.recent : [];
      var dataAnalysisMethods = Array.isArray(dataAnalysis.methodLabels) && dataAnalysis.methodLabels.length
        ? dataAnalysis.methodLabels
        : (Array.isArray(dataAnalysis.methods) ? dataAnalysis.methods : []);
      return '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;margin-top:14px;">' +
        '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:13px;">' +
          '<div style="font-size:13px;font-weight:800;color:var(--text-primary);margin-bottom:8px;">已有内容</div>' +
          '<div style="font-size:12px;line-height:1.8;color:var(--text-secondary);">' +
            '文献库：' + escapeHtml(literature.total || 0) + ' 篇，带 embedding ' + escapeHtml(literature.embedded || 0) + ' 篇。<br>' +
            'PDF Wiki：PDF ' + escapeHtml(pdfWiki.pdfCount || 0) + ' 个，句子论点 ' + escapeHtml(pdfWiki.sentencePointCount || 0) + ' 条，兼容论点组 ' + escapeHtml(pdfWiki.entryCount || 0) + ' 个。<br>' +
            'Meta：PDF ' + escapeHtml(meta.pdfCount || 0) + ' 个，编码行 ' + escapeHtml(meta.rowCount || 0) + ' 行，列 ' + escapeHtml(meta.columnCount || 0) + ' 个。<br>' +
            '文献计量：' + escapeHtml(bibliometrics.recordCount || 0) + ' 条记录，输出文件 ' + escapeHtml(bibliometrics.outputCount || 0) + ' 个。<br>' +
            '数据统计：' + escapeHtml(dataAnalysis.available ? (dataAnalysis.datasetFileName || '已分析数据集') : '未分析') + '，样本行 ' + escapeHtml(dataAnalysis.rowCount || 0) + '，变量 ' + escapeHtml(dataAnalysis.variableCount || 0) + '，方法 ' + escapeHtml(dataAnalysisMethods.slice(0, 2).join(' + ') || '-') + '。<br>' +
            '草稿：' + escapeHtml(drafts.count || 0) + ' 份；Auto Research 报告 ' + escapeHtml(autoResearch.finalReportCount || 0) + ' 份。' +
          '</div>' +
        '</div>' +
        '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:13px;">' +
          '<div style="font-size:13px;font-weight:800;color:var(--text-primary);margin-bottom:8px;">最近文献</div>' +
          (recentLiterature.length ? recentLiterature.slice(0, 5).map(function(item) {
            return '<div style="padding:7px 0;border-bottom:1px solid var(--border-color);">' +
              '<div style="font-size:12px;font-weight:700;color:var(--text-primary);line-height:1.45;">' + escapeHtml(item.title || 'Untitled') + '</div>' +
              '<div style="margin-top:2px;font-size:11px;color:var(--text-secondary);">' + escapeHtml([item.author, item.year, item.journal].filter(Boolean).join(' · ')) + '</div>' +
            '</div>';
          }).join('') : '<div style="font-size:12px;color:var(--text-secondary);">还没有导入文献摘要。</div>') +
        '</div>' +
      '</div>';
    }

    function resolveOverviewChatScrollAnchorIndex() {
      if (!overviewChatScrollAnchor || !overviewChatHistory.length) return -1;
      var anchorContent = String(overviewChatScrollAnchor.content || '');
      for (var i = overviewChatHistory.length - 1; i >= 0; i--) {
        var message = overviewChatHistory[i];
        if (!message || message.role !== 'user') continue;
        if (overviewChatScrollAnchor.createdAt && message.createdAt === overviewChatScrollAnchor.createdAt) return i;
        if (!overviewChatScrollAnchor.createdAt && message.content === anchorContent) return i;
      }
      for (var j = overviewChatHistory.length - 1; j >= 0; j--) {
        if (overviewChatHistory[j] && overviewChatHistory[j].role === 'user') return j;
      }
      return -1;
    }

    function scrollOverviewChatToAnchor(container, anchorIndex) {
      if (!container) return;
      if (anchorIndex >= 0) {
        var target = container.querySelector('[data-overview-chat-index="' + anchorIndex + '"]');
        if (target) {
          var containerRect = container.getBoundingClientRect();
          var targetRect = target.getBoundingClientRect();
          container.scrollTop += targetRect.top - containerRect.top;
          return;
        }
      }
      container.scrollTop = container.scrollHeight;
    }

    function renderOverviewChatMessages(pending) {
      var target = document.getElementById('overviewChatMessages');
      if (!target) return;
      var messages = overviewChatHistory.slice(-30);
      var offset = Math.max(0, overviewChatHistory.length - messages.length);
      target.innerHTML = messages.map(function(message, index) {
        var isUser = message.role === 'user';
        return '<div data-overview-chat-index="' + (offset + index) + '" style="display:flex;justify-content:' + (isUser ? 'flex-end' : 'flex-start') + ';margin-bottom:8px;">' +
          '<div style="max-width:86%;padding:8px 10px;border:1px solid ' + (isUser ? 'rgba(15,118,110,0.35)' : 'var(--border-color)') + ';border-radius:8px;background:' + (isUser ? 'rgba(15,118,110,0.10)' : 'var(--bg-primary)') + ';color:var(--text-primary);font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;">' + escapeHtml(message.content || '') + '</div>' +
        '</div>';
      }).join('') + (pending ? '<div style="font-size:12px;color:var(--text-secondary);padding:8px 10px;">Overview AI 正在读取全局信息并思考...</div>' : '');
      scrollOverviewChatToAnchor(target, resolveOverviewChatScrollAnchorIndex());
    }

    function renderOverviewChatPanel() {
      return '<aside style="border-left:1px solid var(--border-color);background:var(--bg-primary);display:flex;flex-direction:column;min-height:0;">' +
        '<div style="padding:13px;border-bottom:1px solid var(--border-color);">' +
          '<div style="font-size:14px;font-weight:800;color:var(--text-primary);">全局 AI 交流</div>' +
          '<div style="margin-top:4px;font-size:11px;line-height:1.55;color:var(--text-secondary);">发送时会接入长期记忆、文献库、PDF Wiki、Meta、文献计量、数据统计、Auto Research 和草稿摘要。</div>' +
        '</div>' +
        '<div id="overviewChatMessages" style="flex:1;min-height:0;overflow:auto;padding:12px;background:var(--bg-secondary);"></div>' +
        '<div style="padding:10px;border-top:1px solid var(--border-color);display:flex;gap:8px;align-items:flex-end;">' +
          '<textarea id="overviewChatInput" rows="2" placeholder="问 Overview AI：现在项目缺什么？下一步怎么做？哪些结果能用于写论文？" style="flex:1;min-width:0;resize:none;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);padding:8px;font-size:12px;line-height:1.45;"></textarea>' +
          '<button id="overviewChatSendBtn" type="button" onclick="sendOverviewChat()" style="height:34px;padding:0 12px;border:1px solid var(--accent-color);border-radius:7px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">发送</button>' +
        '</div>' +
      '</aside>';
    }

    function renderOverviewPage(overview) {
      setPdfWikiWorkspaceMode('overview');
      overviewData = overview || {};
      var content = document.getElementById('pdfWikiViewerContent');
      var title = document.getElementById('pdfWikiViewerTitle');
      var subtitle = document.getElementById('pdfWikiViewerSubtitle');
      if (title) title.textContent = 'Overview';
      if (subtitle) {
        var moduleCount = Array.isArray(overviewData.modules) ? overviewData.modules.length : 0;
        subtitle.textContent = '全局视角：' + moduleCount + ' 个模块 · 更新时间 ' + (overviewData.generatedAt ? new Date(overviewData.generatedAt).toLocaleString('zh-CN') : '-');
      }
      if (!content) return;
      var modules = Array.isArray(overviewData.modules) ? overviewData.modules : [];
      content.innerHTML =
        '<div style="display:grid;grid-template-columns:minmax(0,1fr) 390px;width:100%;height:100%;min-height:0;background:var(--bg-secondary);">' +
          '<section style="min-width:0;min-height:0;overflow:auto;padding:16px;">' +
            renderOverviewSummaryPanel(overviewData) +
            renderOverviewResearchEnhancementLauncher() +
            renderOverviewFlowMap(modules) +
            '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;">' +
              modules.map(renderOverviewModuleCard).join('') +
            '</div>' +
            renderOverviewDetailPanel(overviewData) +
          '</section>' +
          renderOverviewChatPanel() +
        '</div>';
      attachOverviewEventHandlers(content);
      renderOverviewChatMessages(false);
    }

    function attachOverviewEventHandlers(root) {
      root.querySelectorAll('[data-overview-action]').forEach(function(button) {
        button.addEventListener('click', function() {
          var action = button.getAttribute('data-overview-action') || '';
          openOverviewModuleAction(action);
        });
      });
      var input = document.getElementById('overviewChatInput');
      if (input) {
        input.addEventListener('keydown', function(event) {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendOverviewChat();
          }
        });
      }
    }

    function openOverviewModuleAction(action) {
      if (!action) return;
      var fn = window[action];
      if (typeof fn === 'function') {
        fn({ fromOverview: true });
      }
    }

    window.sendOverviewChat = async function() {
      if (overviewChatBusy) return;
      var input = document.getElementById('overviewChatInput');
      var button = document.getElementById('overviewChatSendBtn');
      var query = input ? input.value.trim() : '';
      if (!query) return;
      overviewChatBusy = true;
      if (button) {
        button.disabled = true;
        button.textContent = '发送中';
      }
      if (input) input.value = '';
      var userMessage = { role: 'user', content: query, createdAt: new Date().toISOString() };
      overviewChatHistory.push(userMessage);
      overviewChatScrollAnchor = {
        content: userMessage.content,
        createdAt: userMessage.createdAt
      };
      renderOverviewChatMessages(true);
      try {
        var response = await fetch('/api/overview/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            query: query,
            history: overviewChatHistory.slice(-10)
          })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Overview AI 交流失败');
        overviewChatHistory.push({ role: 'assistant', content: data.result || '', createdAt: new Date().toISOString() });
      } catch (e) {
        overviewChatHistory.push({ role: 'assistant', content: 'Overview AI 交流失败：' + (e.message || String(e)), createdAt: new Date().toISOString() });
      } finally {
        overviewChatBusy = false;
        if (button) {
          button.disabled = false;
          button.textContent = '发送';
        }
        renderOverviewChatMessages(false);
      }
    };

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('pdf-wiki-workspace', { source: '/app/pdf-wiki-workspace.js' });
}
