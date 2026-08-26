window.showPdfWikiMetaDatabase = async function(options) {
      updateAcademicWorkflowOverviewReturn(options);
      setPdfWikiWorkspaceMode('meta');
      if (!document.getElementById('pdfWikiViewerModal')) {
        await window.showPdfWikiViewer({
          initialTitle: 'Meta分析',
          initialSubtitle: '正在读取 Meta 分析...',
          initialLoadingText: '正在读取 Meta 分析...',
          workflowActiveKey: 'meta-analysis',
          skipInitialLoad: true
        });
      }
      setPdfWikiViewerWorkflowActions('meta-analysis');
      var content = document.getElementById('pdfWikiViewerContent');
      var title = document.getElementById('pdfWikiViewerTitle');
      var subtitle = document.getElementById('pdfWikiViewerSubtitle');
      if (title) title.textContent = 'Meta分析';
      if (subtitle) subtitle.textContent = '正在读取 Meta 分析...';
      if (content) {
        content.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:13px;">正在读取 Meta 分析...</div>';
      }
      var cached = pdfWikiMetaDatabaseCacheByScope[getPdfWikiMetaCacheScopeKey()];
      if (cached && Array.isArray(cached.items)) {
        pdfWikiMetaDatabaseData = mergePdfWikiMetaCachedDetails(cached);
        renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
        reloadPdfWikiMetaDatabase(pdfWikiMetaSelectedPdfId).catch(function(error) {
          console.warn('[PdfWikiMeta] Background refresh failed:', error);
        });
        return;
      }
      await reloadPdfWikiMetaDatabase();
    };

    async function reloadPdfWikiMetaDatabase(selectedPdfId, forceRefresh) {
      var url = '/api/pdf-wiki/meta?userId=' + encodeURIComponent(currentUserId) + '&summary=1';
      if (forceRefresh) url += '&refresh=1';
      var response = await fetch(url);
      var data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || '读取 Meta分析失败');
      }
      pdfWikiMetaDatabaseData = mergePdfWikiMetaCachedDetails(data);
      rememberPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
      var items = Array.isArray(data.items) ? data.items : [];
      var validPdfIds = {};
      items.forEach(function(item) {
        validPdfIds[item.pdfId] = true;
      });
      Object.keys(pdfWikiMetaSelectedDataPdfIds).forEach(function(pdfId) {
        if (!validPdfIds[pdfId]) delete pdfWikiMetaSelectedDataPdfIds[pdfId];
      });
      pdfWikiMetaSelectedPdfId = selectedPdfId || pdfWikiMetaSelectedPdfId || (items[0] ? items[0].pdfId : null);
      if (pdfWikiMetaSelectedPdfId && !items.some(function(item) { return item.pdfId === pdfWikiMetaSelectedPdfId; })) {
        pdfWikiMetaSelectedPdfId = items[0] ? items[0].pdfId : null;
      }
      renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
      if (pdfWikiMetaSelectedPdfId) {
        loadPdfWikiMetaDetail(pdfWikiMetaSelectedPdfId).catch(function(error) {
          console.warn('[PdfWikiMeta] Failed to load selected detail:', error);
        });
      }
    }

    function formatPdfWikiMetaDate(value) {
      if (!value) return '未知';
      var date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    }

    function formatPdfWikiMetaValue(value) {
      if (value === null || value === undefined || value === '') return '未解析';
      if (Array.isArray(value)) {
        if (value.length === 0) return '无';
        return value.map(formatPdfWikiMetaValue).join('；');
      }
      if (typeof value === 'object') return JSON.stringify(value, null, 2);
      if (typeof value === 'boolean') return value ? '是' : '否';
      return String(value);
    }

    function renderPdfWikiMetaTags(values) {
      values = Array.isArray(values) ? values.filter(Boolean) : [];
      if (values.length === 0) return '<span style="color:var(--text-secondary);font-size:12px;">无</span>';
      return values.map(function(value) {
        return '<span style="display:inline-flex;padding:4px 7px;border:1px solid var(--border-color);border-radius:999px;background:var(--bg-secondary);font-size:12px;color:var(--text-primary);">' + escapeHtml(value) + '</span>';
      }).join('');
    }

    function renderPdfWikiMetaField(label, value, preWrap) {
      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:10px;min-width:0;">' +
        '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:5px;">' + escapeHtml(label) + '</div>' +
        '<div style="font-size:13px;color:var(--text-primary);line-height:1.55;word-break:break-word;white-space:' + (preWrap ? 'pre-wrap' : 'normal') + ';">' + escapeHtml(formatPdfWikiMetaValue(value)) + '</div>' +
      '</div>';
    }

    function renderPdfWikiMetaDetailSummaryText(selected) {
      if (!selected) return '';
      var items = [
        ['作者', selected.authors],
        ['年份', selected.year],
        ['来源/期刊', selected.journal],
        ['DOI', selected.doi],
        ['解析器', selected.parser || 'unknown'],
        ['全文字数', selected.textLength || 0],
        ['参考来源数', selected.referenceCount || 0],
        ['处理时间', formatPdfWikiMetaDate(selected.processedAt || selected.metaDataCachedAt)]
      ].filter(function(item) {
        return formatPdfWikiMetaValue(item[1]);
      });
      if (!items.length) return '';
      return '<div style="margin-top:8px;font-size:12px;line-height:1.7;color:var(--text-secondary);word-break:break-word;">' +
        items.map(function(item) {
          return '<span style="display:inline;margin-right:14px;"><span style="color:var(--text-secondary);">' + escapeHtml(item[0]) + '：</span><span style="color:var(--text-primary);">' + escapeHtml(formatPdfWikiMetaValue(item[1])) + '</span></span>';
        }).join('') +
      '</div>';
    }

    async function readPdfWikiMetaJsonResponse(response, actionLabel) {
      var text = await response.text();
      var data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (error) {
          var preview = text.replace(/\s+/g, ' ').trim().slice(0, 180);
          var pathText = '';
          try {
            pathText = new URL(response.url, window.location.href).pathname;
          } catch (e) {
            pathText = response.url || '';
          }
          if (/^\s*</.test(text)) {
            throw new Error(actionLabel + '接口没有返回 JSON，而是返回了 HTML（HTTP ' + response.status + '，' + pathText + '）。通常是当前后端进程没有加载最新代码，或请求打到了前端页面。请停止后重新运行 npm run electron:dev。返回片段：' + preview);
          }
          throw new Error(actionLabel + '返回内容不是合法 JSON（HTTP ' + response.status + '）：' + preview);
        }
      }
      if (!response.ok || !data || data.success === false) {
        var err = new Error((data && (data.error || data.message)) || (actionLabel + '失败：HTTP ' + response.status));
        if (data && data.data) err.metaData = data.data;
        throw err;
      }
      return data;
    }

    function isPdfWikiCodexPreferredForWorkflow() {
      var codex = chatBridgeConfig && chatBridgeConfig.codex ? chatBridgeConfig.codex : {};
      return !!codex.prefer && codex.enabled !== false;
    }

    function getPdfWikiMetaConfiguredCodexConcurrency(totalPdfs) {
      if (!isPdfWikiCodexPreferredForWorkflow()) return 1;
      var codex = chatBridgeConfig && chatBridgeConfig.codex ? chatBridgeConfig.codex : {};
      var value = Math.max(1, Math.min(6, parseInt(codex.pdf_wiki_concurrency || codex.concurrency || 1, 10) || 1));
      if (Number(totalPdfs) > 0) value = Math.min(value, Number(totalPdfs));
      return value;
    }

    function createPdfWikiMetaInitialCodexWorkers(totalPdfs, message) {
      if (!isPdfWikiCodexPreferredForWorkflow()) return [];
      var count = getPdfWikiMetaConfiguredCodexConcurrency(totalPdfs);
      return Array.from({ length: count }, function(_, index) {
        return {
          slot: index + 1,
          status: 'idle',
          message: index === 0 ? message : '等待分配 PDF',
          updatedAt: new Date().toISOString()
        };
      });
    }

    function schedulePdfWikiMetaWorkerTypewriterRender() {
      if (pdfWikiMetaWorkerTypewriterTimer || !pdfWikiMetaExtractionRunning) return;
      pdfWikiMetaWorkerTypewriterTimer = setTimeout(function() {
        pdfWikiMetaWorkerTypewriterTimer = null;
        if (pdfWikiMetaExtractionRunning && pdfWikiMetaExtractionProgress && pdfWikiMetaExtractionProgress.status === 'processing') {
          updatePdfWikiMetaExtractionStatusBarOnly();
        }
      }, 90);
    }

    function getPdfWikiMetaWorkerTypedMessage(worker, index) {
      var key = String(worker.slot || index + 1) + '|' + String(worker.pdfId || '') + '|' + String(worker.status || '');
      var full = String(worker.message || '等待日志输出');
      var now = Date.now();
      var state = pdfWikiMetaWorkerTypewriterState[key];
      if (!state || state.full !== full) {
        state = { full: full, visible: 0, lastTick: now };
      }
      var elapsed = Math.max(0, now - state.lastTick);
      var step = Math.max(1, Math.floor(elapsed / 14));
      if (state.visible < full.length) {
        state.visible = Math.min(full.length, state.visible + step);
        state.lastTick = now;
        schedulePdfWikiMetaWorkerTypewriterRender();
      }
      pdfWikiMetaWorkerTypewriterState[key] = state;
      return full.slice(0, Math.max(1, state.visible));
    }

    function parsePdfWikiMetaTime(value) {
      if (!value) return NaN;
      var time = Date.parse(String(value));
      return Number.isFinite(time) ? time : NaN;
    }

    function formatPdfWikiMetaDuration(ms) {
      ms = Math.max(0, Number(ms || 0));
      var totalSeconds = Math.floor(ms / 1000);
      var hours = Math.floor(totalSeconds / 3600);
      var minutes = Math.floor((totalSeconds % 3600) / 60);
      var seconds = totalSeconds % 60;
      var pad = function(value) { return String(value).padStart(2, '0'); };
      return hours > 0
        ? (hours + ':' + pad(minutes) + ':' + pad(seconds))
        : (pad(minutes) + ':' + pad(seconds));
    }

    function getPdfWikiMetaDurationText(startedAt, endedAt) {
      var start = parsePdfWikiMetaTime(startedAt);
      if (!Number.isFinite(start)) return '';
      var end = endedAt ? parsePdfWikiMetaTime(endedAt) : NaN;
      if (!Number.isFinite(end)) end = Date.now();
      return formatPdfWikiMetaDuration(end - start);
    }

    function startPdfWikiMetaElapsedTimer() {
      if (pdfWikiMetaElapsedTimer) return;
      pdfWikiMetaElapsedTimer = setInterval(function() {
        var shouldTick = !!pdfWikiMetaExtractionRunning || hasActivePdfWikiMetaWorkers(pdfWikiMetaExtractionProgress || {});
        if (!shouldTick) {
          stopPdfWikiMetaElapsedTimer();
          return;
        }
        updatePdfWikiMetaExtractionStatusBarOnly();
      }, 1000);
    }

    function stopPdfWikiMetaElapsedTimer() {
      if (!pdfWikiMetaElapsedTimer) return;
      clearInterval(pdfWikiMetaElapsedTimer);
      pdfWikiMetaElapsedTimer = null;
    }

    function renderPdfWikiMetaCodexWorkerLanes(progress) {
      var workers = Array.isArray(progress.codexWorkers) ? progress.codexWorkers : [];
      if (workers.length === 0) return '';
      return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:9px;">' +
        workers.map(function(worker, index) {
          var status = String(worker.status || 'idle');
          var color = status === 'completed' ? 'var(--accent-color)' : (status === 'error' ? '#dc2626' : (status === 'running' ? '#2563eb' : 'var(--text-secondary)'));
          var title = 'Codex #' + escapeHtml(worker.slot || (index + 1));
          var pdfName = worker.pdfName ? escapeHtml(worker.pdfName) : (status === 'idle' ? '等待分配 PDF' : '未记录 PDF');
          var typedMessage = getPdfWikiMetaWorkerTypedMessage(worker, index);
          var workerDuration = getPdfWikiMetaDurationText(worker.startedAt, status === 'running' ? '' : worker.updatedAt);
          var statusText = status === 'running' ? '运行中' : (status === 'completed' ? '完成' : (status === 'error' ? '异常' : '等待'));
          if (workerDuration) statusText += ' · ' + workerDuration;
          return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:8px 9px;min-width:0;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px;">' +
              '<div style="font-size:11px;font-weight:700;color:var(--text-primary);">' + title + '</div>' +
              '<div style="font-size:10px;font-weight:700;color:' + color + ';">' + escapeHtml(statusText) + '</div>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px;" title="' + pdfName + '">' + pdfName + '</div>' +
            '<div style="font-size:11px;line-height:1.55;color:var(--text-primary);min-height:34px;white-space:pre-wrap;word-break:break-word;">' + escapeHtml(typedMessage) + (status === 'running' ? '<span style="opacity:.75;">|</span>' : '') + '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    }

    function getPdfWikiMetaProgressNumbers(progress) {
      progress = progress || {};
      var totalPdfs = Number(progress.totalPdfs || progress.queuedCount || 0);
      var processedPdfs = Number(progress.processedPdfs || 0);
      var failedPdfs = Number(progress.failedPdfs || 0);
      var processedChunks = Number(progress.processedChunks || 0);
      var attemptedPdfs = Math.max(processedChunks, processedPdfs + failedPdfs, processedPdfs);
      return {
        totalPdfs: totalPdfs,
        processedPdfs: processedPdfs,
        failedPdfs: failedPdfs,
        attemptedPdfs: attemptedPdfs
      };
    }

    function hasActivePdfWikiMetaWorkers(progress) {
      return Array.isArray(progress && progress.codexWorkers)
        && progress.codexWorkers.some(function(worker) { return worker && worker.status === 'running'; });
    }

    function isPdfWikiMetaExtractionComplete(progress) {
      var numbers = getPdfWikiMetaProgressNumbers(progress);
      return progress && progress.status === 'completed'
        && (!numbers.totalPdfs || numbers.attemptedPdfs >= numbers.totalPdfs)
        && !hasActivePdfWikiMetaWorkers(progress);
    }

    function normalizePdfWikiMetaExtractionProgress(progress) {
      if (!progress || typeof progress !== 'object') return progress;
      if (progress.status !== 'completed' || isPdfWikiMetaExtractionComplete(progress)) return progress;
      var numbers = getPdfWikiMetaProgressNumbers(progress);
      return Object.assign({}, progress, {
        status: 'processing',
        message: '后端状态正在同步：已完成/失败 ' + numbers.attemptedPdfs + '/' + numbers.totalPdfs + ' 个 PDF，仍检测到未完成 worker；继续轮询。' + (progress.message ? ' ' + progress.message : '')
      });
    }

    function renderPdfWikiMetaExtractionStatusBar() {
      if (!pdfWikiMetaExtractionRunning && !pdfWikiMetaExtractionProgress) return '';
      var progress = normalizePdfWikiMetaExtractionProgress(pdfWikiMetaExtractionProgress || {}) || {};
      var numbers = getPdfWikiMetaProgressNumbers(progress);
      var totalPdfs = numbers.totalPdfs;
      var processedPdfs = numbers.processedPdfs;
      var failedPdfs = numbers.failedPdfs;
      var attemptedPdfs = numbers.attemptedPdfs;
      var metaRows = Number(progress.metaRowCount || 0);
      var tables = Number(progress.tableCount || 0);
      var figures = Number(progress.figureCount || 0);
      var isComplete = isPdfWikiMetaExtractionComplete(progress);
      var percent = isComplete
        ? 100
        : (totalPdfs > 0 ? Math.max(5, Math.min(99, Math.round((attemptedPdfs / totalPdfs) * 100))) : (pdfWikiMetaExtractionRunning ? 12 : 0));
      var label = isComplete
        ? (failedPdfs > 0 ? 'Meta 数据提取部分完成' : 'Meta 数据提取完成')
        : (progress.status === 'error' ? 'Meta 数据提取失败' : '正在批量提取 Meta 数据');
      var workerCount = Number(progress.workerConcurrency || (Array.isArray(progress.codexWorkers) ? progress.codexWorkers.length : 0) || 1);
      var runningDuration = getPdfWikiMetaDurationText(progress.startedAt, isComplete || progress.status === 'error' ? progress.updatedAt : '');
      var pdfProgressText = failedPdfs > 0
        ? ('PDF 完成/失败 ' + attemptedPdfs + '/' + totalPdfs + '；成功 ' + processedPdfs + '；失败 ' + failedPdfs)
        : ('PDF ' + processedPdfs + '/' + totalPdfs);
      return '<div id="pdfWikiMetaExtractionStatusBar" class="pdf-wiki-meta-extraction-status-bar" style="margin-bottom:12px;padding:10px 12px;border:1px solid var(--accent-color);border-radius:8px;background:rgba(16,163,127,0.08);">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:7px;">' +
          '<div style="font-size:12px;font-weight:700;color:var(--text-primary);">' + escapeHtml(label) + '</div>' +
          '<div style="font-size:11px;color:var(--text-secondary);white-space:nowrap;">' + (runningDuration ? ('运行 ' + escapeHtml(runningDuration) + ' · ') : '') + percent + '%</div>' +
        '</div>' +
        '<div style="height:7px;background:var(--bg-secondary);border-radius:999px;overflow:hidden;margin-bottom:7px;">' +
          '<div style="height:100%;width:' + percent + '%;background:var(--accent-color);transition:width .25s;"></div>' +
        '</div>' +
        '<div style="font-size:11px;line-height:1.5;color:var(--text-secondary);">' + pdfProgressText + '；并行 ' + workerCount + '；编码行 ' + metaRows + '；表格 ' + tables + '；图件 ' + figures + '。' + escapeHtml(progress.message || '') + '</div>' +
        renderPdfWikiMetaCodexWorkerLanes(progress) +
      '</div>';
    }

    function renderPdfWikiManagerUploadStatusBar() {
      if (!pdfWikiManagerUploadRunning && !pdfWikiManagerUploadProgress) return '';
      var progress = pdfWikiManagerUploadProgress || {};
      var totalPdfs = Number(progress.totalPdfs || progress.total || 0);
      var processedPdfs = Number(progress.processedPdfs || progress.processed || 0);
      var failedPdfs = Number(progress.failedPdfs || 0);
      var figureCount = Number(progress.figureCount || 0);
      var status = String(progress.status || (pdfWikiManagerUploadRunning ? 'processing' : 'completed'));
      var isComplete = !pdfWikiManagerUploadRunning && (status === 'completed' || status === 'error');
      var attempted = Math.min(totalPdfs, processedPdfs + failedPdfs);
      var percent = isComplete
        ? 100
        : (totalPdfs > 0 ? Math.max(5, Math.min(99, Math.round((attempted / totalPdfs) * 100))) : (pdfWikiManagerUploadRunning ? 8 : 0));
      var label = status === 'error'
        ? 'PDF 批量识别失败'
        : (isComplete ? (failedPdfs > 0 ? 'PDF 批量识别部分完成' : 'PDF 批量识别完成') : '正在批量识别 PDF');
      var progressText = failedPdfs > 0
        ? ('PDF 完成/失败 ' + attempted + '/' + totalPdfs + '；成功 ' + processedPdfs + '；失败 ' + failedPdfs)
        : ('PDF ' + processedPdfs + '/' + totalPdfs);
      return '<div id="pdfWikiManagerUploadStatusBar" class="pdf-wiki-manager-upload-status-bar" style="margin-bottom:12px;padding:10px 12px;border:1px solid var(--accent-color);border-radius:8px;background:rgba(16,163,127,0.08);">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:7px;">' +
          '<div style="font-size:12px;font-weight:700;color:var(--text-primary);">' + escapeHtml(label) + '</div>' +
          '<div style="font-size:11px;color:var(--text-secondary);white-space:nowrap;">' + percent + '%</div>' +
        '</div>' +
        '<div style="height:7px;background:var(--bg-secondary);border-radius:999px;overflow:hidden;margin-bottom:7px;">' +
          '<div style="height:100%;width:' + percent + '%;background:var(--accent-color);transition:width .25s;"></div>' +
        '</div>' +
        '<div style="font-size:11px;line-height:1.5;color:var(--text-secondary);">' + progressText + '；图片 ' + figureCount + '。' + escapeHtml(progress.message || '') + '</div>' +
      '</div>';
    }

    function getPdfWikiRecognitionQueueTrackedJobs(snapshot) {
      var jobs = snapshot && Array.isArray(snapshot.jobs) ? snapshot.jobs : [];
      if (pdfWikiRecognitionQueueTrackedJobIds.length > 0) {
        var tracked = jobs.filter(function(job) {
          return pdfWikiRecognitionQueueTrackedJobIds.indexOf(job.id) !== -1;
        });
        if (tracked.length > 0) return tracked;
      }
      var active = jobs.filter(function(job) {
        return job.status === 'queued' || job.status === 'running';
      });
      return active.length > 0 ? active : [];
    }

    function isPdfWikiRecognitionQueueActive(snapshot) {
      return !!(snapshot && (
        Number(snapshot.queuedItems || 0) > 0
        || Number(snapshot.runningItems || 0) > 0
      ));
    }

    function renderPdfWikiRecognitionQueueStatusBar() {
      var jobs = getPdfWikiRecognitionQueueTrackedJobs(pdfWikiRecognitionQueueSnapshot);
      if (jobs.length === 0) return '';
      var items = [];
      jobs.forEach(function(job) {
        if (Array.isArray(job.items)) items = items.concat(job.items);
      });
      if (items.length === 0) return '';
      var completed = items.filter(function(item) { return item.status === 'completed'; }).length;
      var failed = items.filter(function(item) { return item.status === 'error'; }).length;
      var running = items.filter(function(item) { return item.status === 'running'; }).length;
      var queued = items.filter(function(item) { return item.status === 'queued'; }).length;
      var finished = completed + failed;
      var percent = Math.max(0, Math.min(100, Math.round((finished / items.length) * 100)));
      var activeItem = items.find(function(item) { return item.status === 'running'; });
      var isActive = running > 0 || queued > 0;
      var label = isActive
        ? '后端正在识别 PDF'
        : (failed > 0 ? 'PDF 持久化识别队列部分完成' : 'PDF 持久化识别队列完成');
      var detail = '已处理 ' + finished + '/' + items.length + '；成功 ' + completed + '；失败 ' + failed;
      if (queued > 0) detail += '；等待 ' + queued;
      if (activeItem) detail += '；当前：' + (activeItem.pdfName || activeItem.pdfId || 'PDF');
      return '<div class="pdf-wiki-recognition-queue-status-bar" style="margin-bottom:12px;padding:10px 12px;border:1px solid #111827;border-radius:8px;background:rgba(17,24,39,0.06);">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:7px;">' +
          '<div style="font-size:12px;font-weight:700;color:var(--text-primary);">' + escapeHtml(label) + '</div>' +
          '<div style="font-size:11px;color:var(--text-secondary);white-space:nowrap;">' + percent + '%</div>' +
        '</div>' +
        '<div style="height:7px;background:var(--bg-secondary);border-radius:999px;overflow:hidden;margin-bottom:7px;">' +
          '<div style="height:100%;width:' + percent + '%;background:#111827;transition:width .25s;"></div>' +
        '</div>' +
        '<div style="font-size:11px;line-height:1.5;color:var(--text-secondary);">' + escapeHtml(detail) + '。任务已保存在后端，离开本页不会中断。</div>' +
      '</div>';
    }

    function updatePdfWikiRecognitionQueueStatusBarOnly() {
      var bars = Array.prototype.slice.call(document.querySelectorAll('.pdf-wiki-recognition-queue-status-bar'));
      if (!bars.length) return false;
      var html = renderPdfWikiRecognitionQueueStatusBar();
      bars.forEach(function(bar) {
        if (html) {
          bar.outerHTML = html;
        } else if (bar && bar.parentNode) {
          bar.parentNode.removeChild(bar);
        }
      });
      return true;
    }

    function updatePdfWikiManagerUploadStatusBarOnly() {
      var bars = Array.prototype.slice.call(document.querySelectorAll('.pdf-wiki-manager-upload-status-bar'));
      if (!bars.length) return false;
      var html = renderPdfWikiManagerUploadStatusBar();
      bars.forEach(function(bar) {
        if (html) {
          bar.outerHTML = html;
        } else if (bar && bar.parentNode) {
          bar.parentNode.removeChild(bar);
        }
      });
      return true;
    }

    function clearPdfWikiManagerUploadAutoHideTimer() {
      if (pdfWikiManagerUploadClearTimer) {
        clearTimeout(pdfWikiManagerUploadClearTimer);
        pdfWikiManagerUploadClearTimer = null;
      }
    }

    function schedulePdfWikiManagerUploadStatusAutoHide(delayMs) {
      clearPdfWikiManagerUploadAutoHideTimer();
      pdfWikiManagerUploadClearTimer = setTimeout(function() {
        var status = pdfWikiManagerUploadProgress ? String(pdfWikiManagerUploadProgress.status || '') : '';
        if (pdfWikiManagerUploadRunning || status === 'error') return;
        pdfWikiManagerUploadProgress = null;
        pdfWikiManagerUploadClearTimer = null;
        if (!updatePdfWikiManagerUploadStatusBarOnly() && pdfWikiPdfManagerData && document.getElementById('pdfWikiPdfManagerScroll')) {
          renderPdfWikiPdfManagerPreservingScroll();
        }
      }, delayMs || 4000);
    }

    function updatePdfWikiMetaExtractionStatusBarOnly() {
      var bars = Array.prototype.slice.call(document.querySelectorAll('.pdf-wiki-meta-extraction-status-bar'));
      if (!bars.length) return false;
      var html = renderPdfWikiMetaExtractionStatusBar();
      bars.forEach(function(bar) {
        if (html) {
          bar.outerHTML = html;
        } else if (bar && bar.parentNode) {
          bar.parentNode.removeChild(bar);
        }
      });
      return true;
    }

    function getPdfWikiMetaSelectedDataPdfIds() {
      return Object.keys(pdfWikiMetaSelectedDataPdfIds).filter(function(id) { return !!pdfWikiMetaSelectedDataPdfIds[id]; });
    }

    function getPdfWikiMetaSelectedDataPdfCount() {
      return getPdfWikiMetaSelectedDataPdfIds().length;
    }

    function getPdfWikiMetaItemById(pdfId) {
      var items = pdfWikiMetaDatabaseData && Array.isArray(pdfWikiMetaDatabaseData.items) ? pdfWikiMetaDatabaseData.items : [];
      return items.find(function(item) { return item.pdfId === pdfId; }) || null;
    }

    function getPdfWikiMetaItemSearchText(item) {
      if (!item) return '';
      return String(item.searchText || [
        item.title,
        item.authors,
        item.year,
        item.journal,
        item.doi,
        item.originalName,
        item.parser,
        item.extractionNotes,
        (item.studyLocations || []).join(' '),
        (item.cropTypes || []).join(' '),
        (item.treatmentCategories || []).join(' ')
      ].join(' ')).toLowerCase();
    }

    function getPdfWikiMetaCodingRowSelection(pdfId) {
      if (!pdfId) return {};
      if (!pdfWikiMetaSelectedCodingRows[pdfId]) pdfWikiMetaSelectedCodingRows[pdfId] = {};
      return pdfWikiMetaSelectedCodingRows[pdfId];
    }

    function getPdfWikiMetaSelectedCodingRowIndexes(pdfId) {
      var selection = getPdfWikiMetaCodingRowSelection(pdfId);
      return Object.keys(selection)
        .filter(function(index) { return selection[index]; })
        .map(function(index) { return Number(index); })
        .filter(function(index) { return Number.isInteger(index) && index >= 0; })
        .sort(function(a, b) { return a - b; });
    }

    function getPdfWikiMetaSelectedCodingColumns() {
      return Object.keys(pdfWikiMetaSelectedCodingColumns || {})
        .filter(function(column) { return pdfWikiMetaSelectedCodingColumns[column]; });
    }

    function refreshPdfWikiMetaCodingSelectionUi(pdfId) {
      pdfId = pdfId || pdfWikiMetaSelectedPdfId;
      var selectedRows = getPdfWikiMetaSelectedCodingRowIndexes(pdfId);
      var selectedColumns = getPdfWikiMetaSelectedCodingColumns();
      var rowCountEl = document.getElementById('pdfWikiMetaCodingSelectedRowCount');
      if (rowCountEl) rowCountEl.textContent = String(selectedRows.length);
      var columnCountEl = document.getElementById('pdfWikiMetaCodingSelectedColumnCount');
      if (columnCountEl) columnCountEl.textContent = String(selectedColumns.length);

      var selectionMap = getPdfWikiMetaCodingRowSelection(pdfId);
      document.querySelectorAll('[data-meta-coding-row-checkbox="1"]').forEach(function(input) {
        var rowIndex = input.getAttribute('data-row-index');
        input.checked = !!selectionMap[String(rowIndex)];
      });
      document.querySelectorAll('[data-meta-coding-column-checkbox="1"]').forEach(function(input) {
        input.checked = !!pdfWikiMetaSelectedCodingColumns[input.value];
      });

      var allRows = document.getElementById('pdfWikiMetaCodingRowsSelectAll');
      if (allRows) {
        var item = getPdfWikiMetaItemById(pdfId);
        var rows = item && item.dataTable && Array.isArray(item.dataTable.rows) ? item.dataTable.rows : [];
        var selectedAllRows = rows.length > 0 && rows.every(function(_, index) { return !!selectionMap[String(index)]; });
        var selectedAnyRow = rows.some(function(_, index) { return !!selectionMap[String(index)]; });
        allRows.checked = selectedAllRows;
        allRows.indeterminate = selectedAnyRow && !selectedAllRows;
      }
    }

    function isPdfWikiMetaProtectedCodingColumn(column) {
      var normalized = String(column || '').toLowerCase().replace(/[（）]/g, function(match) { return match === '（' ? '(' : ')'; }).replace(/[_\s#:/\\()]+/g, '').trim();
      return ['obs', 'study', 'pdf标题', 'pdf文件名', '数据来源', '来源名称', '页码位置', '证据原文'].some(function(item) {
        return normalized === item;
      });
    }

    function isPdfWikiMetaStudyCodingColumn(column) {
      return /^study#?$/i.test(String(column || '').replace(/\s+/g, '').trim());
    }

    function syncPdfWikiMetaCodingTableDraftFromInputs() {
      var pdfId = pdfWikiMetaSelectedPdfId;
      if (!pdfId || !pdfWikiMetaCodingTableEditMode[pdfId]) return;
      var item = getPdfWikiMetaItemById(pdfId);
      if (!item || !item.dataTable) return;
      var table = item.dataTable;
      if (!Array.isArray(table.rows)) table.rows = [];
      var cells = document.querySelectorAll('[data-meta-coding-cell="1"]');
      Array.prototype.forEach.call(cells, function(cell) {
        var rowIndex = Number(cell.getAttribute('data-row-index'));
        var encodedColumn = cell.getAttribute('data-column') || '';
        var column = '';
        try {
          column = decodeURIComponent(encodedColumn);
        } catch (_error) {
          column = encodedColumn;
        }
        if (!Number.isInteger(rowIndex) || rowIndex < 0 || !column) return;
        while (table.rows.length <= rowIndex) table.rows.push({});
        table.rows[rowIndex][column] = cell.value;
      });
      table.rowCount = table.rows.length;
    }

    window.setPdfWikiMetaCodingRowSelection = function(rowIndex, checked) {
      var pdfId = pdfWikiMetaSelectedPdfId;
      if (!pdfId) return;
      syncPdfWikiMetaCodingTableDraftFromInputs();
      var selection = getPdfWikiMetaCodingRowSelection(pdfId);
      if (checked) selection[String(rowIndex)] = true;
      else delete selection[String(rowIndex)];
      refreshPdfWikiMetaCodingSelectionUi(pdfId);
    };

    window.togglePdfWikiMetaAllCodingRows = function(checked) {
      var pdfId = pdfWikiMetaSelectedPdfId;
      if (!pdfId) return;
      syncPdfWikiMetaCodingTableDraftFromInputs();
      var item = getPdfWikiMetaItemById(pdfId);
      var rows = item && item.dataTable && Array.isArray(item.dataTable.rows) ? item.dataTable.rows : [];
      var selection = getPdfWikiMetaCodingRowSelection(pdfId);
      rows.forEach(function(_, index) {
        if (checked) selection[String(index)] = true;
        else delete selection[String(index)];
      });
      document.querySelectorAll('[data-meta-coding-row-checkbox="1"]').forEach(function(input) {
        input.checked = !!checked;
      });
      refreshPdfWikiMetaCodingSelectionUi(pdfId);
    };

    window.setPdfWikiMetaCodingColumnSelection = function(column, checked) {
      column = String(column || '').trim();
      if (!column || isPdfWikiMetaProtectedCodingColumn(column)) return;
      syncPdfWikiMetaCodingTableDraftFromInputs();
      if (checked) pdfWikiMetaSelectedCodingColumns[column] = true;
      else delete pdfWikiMetaSelectedCodingColumns[column];
      refreshPdfWikiMetaCodingSelectionUi(pdfWikiMetaSelectedPdfId);
    };

    window.clearPdfWikiMetaCodingTableSelection = function() {
      syncPdfWikiMetaCodingTableDraftFromInputs();
      if (pdfWikiMetaSelectedPdfId) delete pdfWikiMetaSelectedCodingRows[pdfWikiMetaSelectedPdfId];
      pdfWikiMetaSelectedCodingColumns = {};
      document.querySelectorAll('[data-meta-coding-row-checkbox="1"],[data-meta-coding-column-checkbox="1"]').forEach(function(input) {
        input.checked = false;
      });
      var allRows = document.getElementById('pdfWikiMetaCodingRowsSelectAll');
      if (allRows) allRows.checked = false;
      refreshPdfWikiMetaCodingSelectionUi(pdfWikiMetaSelectedPdfId);
    };

    window.startPdfWikiMetaCodingTableEdit = async function() {
      var pdfId = pdfWikiMetaSelectedPdfId;
      if (!pdfId) {
        alert('请先选择一个 PDF');
        return;
      }
      try {
        await loadPdfWikiMetaDetail(pdfId);
      } catch (error) {
        alert('加载 Meta 编码表失败：' + error.message);
        return;
      }
      var item = getPdfWikiMetaItemById(pdfId);
      var table = item && item.dataTable ? item.dataTable : null;
      if (!table || !Array.isArray(table.columns) || table.columns.length === 0) {
        alert('当前 PDF 暂无可编辑的 Meta 编码表表头。请先重新提取 Meta 数据。');
        return;
      }
      if (!Array.isArray(table.rows)) table.rows = [];
      if (table.rows.length === 0) {
        table.rows.push({});
        table.rowCount = 1;
      }
      pdfWikiMetaCodingTableEditMode[pdfId] = true;
      if (pdfWikiMetaDatabaseData) renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
    };

    window.addPdfWikiMetaCodingTableRow = function() {
      var pdfId = pdfWikiMetaSelectedPdfId;
      var item = getPdfWikiMetaItemById(pdfId);
      var table = item && item.dataTable ? item.dataTable : null;
      if (!pdfId || !table || !Array.isArray(table.columns)) return;
      syncPdfWikiMetaCodingTableDraftFromInputs();
      if (!Array.isArray(table.rows)) table.rows = [];
      table.rows.push({});
      table.rowCount = table.rows.length;
      pdfWikiMetaCodingTableEditMode[pdfId] = true;
      if (pdfWikiMetaDatabaseData) renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
      setTimeout(function() {
        var nodes = document.querySelectorAll('[data-meta-coding-cell="1"][data-row-index="' + (table.rows.length - 1) + '"]');
        if (nodes && nodes[0]) nodes[0].focus();
      }, 0);
    };

    window.undoPdfWikiMetaCodingTableEdits = async function() {
      var pdfId = pdfWikiMetaSelectedPdfId;
      if (!pdfId) {
        alert('请先选择一个 PDF');
        return;
      }
      var editing = !!pdfWikiMetaCodingTableEditMode[pdfId];
      if (editing && !confirm('确认撤销当前 PDF 编码表中尚未保存的修改？')) return;
      try {
        await loadPdfWikiMetaDetail(pdfId, true);
        if (editing) pdfWikiMetaCodingTableEditMode[pdfId] = true;
        if (pdfWikiMetaDatabaseData) renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
      } catch (error) {
        alert('撤销修改失败：' + error.message);
      }
    };

    function collectPdfWikiMetaCodingTableEdits(item) {
      var table = item && item.dataTable ? item.dataTable : { columns: [], rows: [] };
      var columns = Array.isArray(table.columns) ? table.columns.slice() : [];
      var rows = (Array.isArray(table.rows) ? table.rows : []).map(function(row) {
        return Object.assign({}, row || {});
      });
      var cells = document.querySelectorAll('[data-meta-coding-cell="1"]');
      Array.prototype.forEach.call(cells, function(cell) {
        var rowIndex = Number(cell.getAttribute('data-row-index'));
        var encodedColumn = cell.getAttribute('data-column') || '';
        var column = '';
        try {
          column = decodeURIComponent(encodedColumn);
        } catch (_error) {
          column = encodedColumn;
        }
        if (!Number.isInteger(rowIndex) || rowIndex < 0 || !column) return;
        while (rows.length <= rowIndex) rows.push({});
        rows[rowIndex][column] = cell.value;
      });
      return { columns: columns, rows: rows };
    }

    window.savePdfWikiMetaCodingTableEdits = async function() {
      var pdfId = pdfWikiMetaSelectedPdfId;
      var item = getPdfWikiMetaItemById(pdfId);
      if (!pdfId || !item) {
        alert('请先选择一个 PDF');
        return;
      }
      var payload = collectPdfWikiMetaCodingTableEdits(item);
      try {
        pdfWikiMetaCodingTableSaving = true;
        if (pdfWikiMetaDatabaseData) renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
        var response = await fetch('/api/pdf-wiki/meta/coding-table/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            pdfId: pdfId,
            columns: payload.columns,
            rows: payload.rows
          })
        });
        var data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || '保存失败');
        }
        delete pdfWikiMetaCodingTableEditMode[pdfId];
        delete pdfWikiMetaSelectedCodingRows[pdfId];
        pdfWikiMetaSelectedCodingColumns = {};
        pdfWikiMetaCodingTableSaving = false;
        await reloadPdfWikiMetaDatabase(data.pdfId || pdfId);
      } catch (error) {
        pdfWikiMetaCodingTableSaving = false;
        if (pdfWikiMetaDatabaseData) renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
        alert('保存 Meta 编码表失败：' + error.message);
      }
    };

    window.cancelPdfWikiMetaCodingTableEdit = async function() {
      var pdfId = pdfWikiMetaSelectedPdfId;
      if (!pdfId) return;
      delete pdfWikiMetaCodingTableEditMode[pdfId];
      await reloadPdfWikiMetaDatabase(pdfId);
    };

    function showPdfWikiMetaDetailLoading(pdfId) {
      document.querySelectorAll('#pdfWikiMetaListScroll tr[data-pdf-id]').forEach(function(row) {
        row.style.background = row.getAttribute('data-pdf-id') === pdfId ? 'rgba(16,163,127,0.12)' : 'transparent';
      });
      var detail = document.getElementById('pdfWikiMetaDetailScroll');
      var item = getPdfWikiMetaItemById(pdfId);
      if (!detail || !item) return;
      detail.innerHTML = '<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px;color:var(--text-secondary);">' +
        '<div style="font-size:15px;font-weight:700;color:var(--text-primary);max-width:760px;text-align:center;">' + escapeHtml(item.title || item.originalName || '未命名 PDF') + '</div>' +
        '<div style="font-size:12px;">正在读取本地 Meta 编码表和图表信息...</div>' +
      '</div>';
    }

    async function loadPdfWikiMetaDetail(pdfId, force) {
      if (!pdfId || !pdfWikiMetaDatabaseData) return;
      var item = getPdfWikiMetaItemById(pdfId);
      if (!item) return;
      var generatedAt = String(pdfWikiMetaDatabaseData.generatedAt || '');
      var detailCache = getPdfWikiMetaDetailCache();
      var cached = detailCache[pdfId];
      if (!force && cached && cached.generatedAt === generatedAt && cached.detail) {
        Object.assign(item, cached.detail, { detailLoaded: true, detailLoading: false });
        rememberPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
        if (pdfWikiMetaSelectedPdfId === pdfId) renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
        return;
      }
      if (!force && item.detailLoaded) return;

      var requestKey = getPdfWikiMetaCacheScopeKey() + '::' + pdfId;
      if (pdfWikiMetaDetailRequests[requestKey]) return pdfWikiMetaDetailRequests[requestKey];
      item.detailLoading = true;
      delete item.detailError;
      if (pdfWikiMetaSelectedPdfId === pdfId) showPdfWikiMetaDetailLoading(pdfId);

      var request = (async function() {
        try {
          var response = await fetch('/api/pdf-wiki/meta?userId=' + encodeURIComponent(currentUserId) + '&pdfId=' + encodeURIComponent(pdfId));
          var data = await response.json();
          if (!response.ok || !data.success) throw new Error(data.error || '读取 Meta 详情失败');
          var detail = data.items && data.items[0];
          if (!detail) throw new Error('未找到该 PDF 的 Meta 详情');
          var items = Array.isArray(pdfWikiMetaDatabaseData.items) ? pdfWikiMetaDatabaseData.items : [];
          var index = items.findIndex(function(candidate) { return candidate.pdfId === pdfId; });
          if (index >= 0) {
            items[index] = Object.assign({}, items[index], detail, { detailLoaded: true, detailLoading: false });
          }
          detailCache[pdfId] = { generatedAt: generatedAt, detail: detail };
          rememberPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
          if (pdfWikiMetaSelectedPdfId === pdfId) renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
        } catch (error) {
          var current = getPdfWikiMetaItemById(pdfId) || item;
          current.detailLoading = false;
          current.detailError = error.message;
          if (pdfWikiMetaSelectedPdfId === pdfId) renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
          throw error;
        } finally {
          delete pdfWikiMetaDetailRequests[requestKey];
        }
      })();
      pdfWikiMetaDetailRequests[requestKey] = request;
      return request;
    }

    function renderPdfWikiIntegratedDataTable(selected) {
      var dataTable = selected && selected.dataTable ? selected.dataTable : { columns: [], rows: [], rowCount: 0 };
      var columns = Array.isArray(dataTable.columns) ? dataTable.columns : [];
      var rows = Array.isArray(dataTable.rows) ? dataTable.rows : [];
      var dataTableRowCountText = dataTable.isPlaceholder ? '0 行真实数据（当前显示 1 行待填写占位表）' : ((dataTable.rowCount || rows.length || 0) + ' 行数据');
      var renderRowLimit = 250;
      var rowsForRender = rows.slice(0, renderRowLimit);
      var hiddenRowCount = Math.max(0, rows.length - rowsForRender.length);
      var detailLoaded = selected ? selected.detailLoaded !== false : true;
      var detailLoading = selected && selected.detailLoading;
      var detailError = selected && selected.detailError;
      var selectedCount = getPdfWikiMetaSelectedDataPdfCount();
      var selectedPdfId = selected && selected.pdfId ? selected.pdfId : '';
      var selectedRows = getPdfWikiMetaSelectedCodingRowIndexes(selectedPdfId);
      var selectedColumns = getPdfWikiMetaSelectedCodingColumns();
      var selectedRowMap = getPdfWikiMetaCodingRowSelection(selectedPdfId);
      var allRowsChecked = rows.length > 0 && rows.every(function(_, index) { return !!selectedRowMap[String(index)]; });
      var editing = !!(selectedPdfId && pdfWikiMetaCodingTableEditMode[selectedPdfId]);
      var headerHtml = columns.map(function(column) {
        var protectedColumn = isPdfWikiMetaProtectedCodingColumn(column);
        var compactStudyColumn = isPdfWikiMetaStudyCodingColumn(column);
        var columnChecked = !!pdfWikiMetaSelectedCodingColumns[column];
        return '<th style="' + (compactStudyColumn ? 'width:15ch;min-width:15ch;max-width:15ch;overflow:hidden;' : '') + 'padding:7px 8px;border-bottom:1px solid var(--border-color);border-right:1px solid var(--border-color);background:var(--bg-primary);color:var(--text-secondary);font-size:11px;text-align:left;white-space:nowrap;">' +
          '<label style="display:inline-flex;align-items:center;gap:6px;cursor:' + (protectedColumn ? 'not-allowed' : 'pointer') + ';">' +
            '<input type="checkbox" data-meta-coding-column-checkbox="1" value="' + escapeHtml(column) + '"' + (columnChecked ? ' checked' : '') + (protectedColumn ? ' disabled' : '') + ' onchange="setPdfWikiMetaCodingColumnSelection(this.value,this.checked)" title="' + (protectedColumn ? '系统追踪字段不能删除' : '选择该列，可批量删除') + '" style="width:13px;height:13px;accent-color:var(--accent-color);">' +
            '<span>' + escapeHtml(column) + '</span>' +
          '</label>' +
        '</th>';
      }).join('');
      var bodyHtml = rowsForRender.map(function(row, rowIndex) {
        var rowChecked = !!selectedRowMap[String(rowIndex)];
        return '<tr>' +
          '<td style="position:sticky;left:0;z-index:0;padding:7px 8px;border-bottom:1px solid var(--border-color);border-right:1px solid var(--border-color);background:var(--bg-secondary);text-align:center;vertical-align:top;">' +
            '<input type="checkbox" data-meta-coding-row-checkbox="1" data-row-index="' + rowIndex + '" value="' + rowIndex + '"' + (rowChecked ? ' checked' : '') + ' onchange="setPdfWikiMetaCodingRowSelection(Number(this.value),this.checked)" title="选择该行，可批量删除" style="width:14px;height:14px;accent-color:var(--accent-color);cursor:pointer;">' +
          '</td>' +
          columns.map(function(column) {
          var protectedColumn = isPdfWikiMetaProtectedCodingColumn(column);
          var compactStudyColumn = isPdfWikiMetaStudyCodingColumn(column);
          var value = formatPdfWikiMetaValue(row && row[column]);
          if (editing && !protectedColumn) {
            return '<td style="padding:5px;border-bottom:1px solid var(--border-color);border-right:1px solid var(--border-color);vertical-align:top;background:var(--bg-primary);">' +
              '<textarea data-meta-coding-cell="1" data-row-index="' + rowIndex + '" data-column="' + escapeHtml(encodeURIComponent(column)) + '" style="width:100%;min-width:150px;height:56px;resize:vertical;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);padding:6px 7px;font-size:12px;line-height:1.45;">' + escapeHtml(value) + '</textarea>' +
            '</td>';
          }
          return '<td style="' + (compactStudyColumn ? 'width:15ch;min-width:15ch;max-width:15ch;overflow:hidden;' : '') + 'padding:7px 8px;border-bottom:1px solid var(--border-color);border-right:1px solid var(--border-color);color:var(--text-primary);font-size:12px;line-height:1.45;vertical-align:top;white-space:' + (compactStudyColumn ? 'nowrap' : 'pre-wrap') + ';word-break:break-word;' + (editing && protectedColumn ? 'background:var(--bg-secondary);opacity:0.78;' : '') + '">' +
            (compactStudyColumn ? '<div title="' + escapeHtml(value) + '" style="width:15ch;max-width:15ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(value) + '</div>' : escapeHtml(value)) +
          '</td>';
        }).join('') + '</tr>';
      }).join('');

      var editButtonsHtml = editing
        ? '<button type="button" onclick="addPdfWikiMetaCodingTableRow()" style="padding:7px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">新增行</button>' +
          '<button type="button" onclick="savePdfWikiMetaCodingTableEdits()" ' + (pdfWikiMetaCodingTableSaving ? 'disabled' : '') + ' style="padding:7px 10px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:' + (pdfWikiMetaCodingTableSaving ? 'not-allowed' : 'pointer') + ';opacity:' + (pdfWikiMetaCodingTableSaving ? '0.58' : '1') + ';font-size:12px;">' + (pdfWikiMetaCodingTableSaving ? '保存中' : '保存修改') + '</button>' +
          '<button type="button" onclick="cancelPdfWikiMetaCodingTableEdit()" style="padding:7px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">取消编辑</button>'
        : '<button type="button" onclick="startPdfWikiMetaCodingTableEdit()" style="padding:7px 10px;border:1px solid var(--accent-color);border-radius:6px;background:transparent;color:var(--accent-color);cursor:pointer;font-size:12px;">编辑编码表</button>';
      var rowActionsHtml = rows.length && columns.length
        ? '<button type="button" onclick="deleteSelectedPdfWikiMetaCodingSelection()" title="删除当前选中的行和列" style="padding:6px 10px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-primary);cursor:pointer;font-size:12px;">删除</button>'
        : '';

      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);margin-bottom:14px;overflow:hidden;">' +
        '<div style="padding:10px 12px;border-bottom:1px solid var(--border-color);">' +
          '<div style="display:flex;align-items:center;justify-content:flex-start;gap:10px;overflow-x:auto;">' +
            '<div style="flex:0 0 auto;font-size:13px;font-weight:700;color:var(--text-primary);">Meta 分析编码表</div>' +
            '<div id="pdfWikiMetaCodingToolbar" style="display:flex;flex:0 0 auto;gap:7px;align-items:center;white-space:nowrap;justify-content:flex-start;">' +
              editButtonsHtml +
              rowActionsHtml +
            '</div>' +
          '</div>' +
          '<div id="pdfWikiMetaCodingTableSummary" style="margin-top:6px;font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow-x:auto;">当前 PDF 共 ' + dataTableRowCountText + (hiddenRowCount > 0 ? '，页面仅预览前 ' + renderRowLimit + ' 行' : '') + '；已选中 <span id="pdfWikiMetaCodingSelectedRowCount">' + selectedRows.length + '</span> 行、<span id="pdfWikiMetaCodingSelectedColumnCount">' + selectedColumns.length + '</span> 列；已勾选 ' + selectedCount + ' 篇 PDF，导出时会合并到同一个 Excel sheet。' + (editing ? ' 现在是手动编辑模式，系统追踪字段保持只读。' : '') + '</div>' +
        '</div>' +
        (rows.length && columns.length ? (
          '<div id="pdfWikiMetaCodingTableScroll" style="overflow:auto;max-height:560px;">' +
            '<table style="width:max-content;min-width:100%;border-collapse:collapse;">' +
              '<thead style="position:sticky;top:0;z-index:1;"><tr>' +
                '<th style="position:sticky;left:0;z-index:2;width:58px;min-width:58px;padding:7px 8px;border-bottom:1px solid var(--border-color);border-right:1px solid var(--border-color);background:var(--bg-primary);color:var(--text-secondary);font-size:11px;text-align:center;">' +
                  '<label style="display:inline-flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;white-space:nowrap;">' +
                    '<input id="pdfWikiMetaCodingRowsSelectAll" type="checkbox"' + (allRowsChecked ? ' checked' : '') + ' onchange="togglePdfWikiMetaAllCodingRows(this.checked)" title="全选或取消全选当前 PDF 的全部行" style="width:14px;height:14px;margin:0;accent-color:var(--accent-color);cursor:pointer;">' +
                    '<span>行</span>' +
                  '</label>' +
                '</th>' +
                headerHtml +
              '</tr></thead>' +
              '<tbody>' + bodyHtml + '</tbody>' +
            '</table>' +
          '</div>' +
          (hiddenRowCount > 0 ? '<div style="padding:8px 10px;border-top:1px solid var(--border-color);font-size:11px;color:var(--text-secondary);">还有 ' + hiddenRowCount + ' 行未在页面预览中渲染，导出 Excel 时会包含完整数据。</div>' : '')
        ) : (!detailLoaded
          ? '<div style="padding:14px;color:var(--text-secondary);font-size:12px;">' + (detailError ? 'Meta 详情读取失败：' + escapeHtml(detailError) : (detailLoading ? '正在加载当前 PDF 的完整 Meta 分析编码表...' : '点击该 PDF 后加载完整 Meta 分析编码表。')) + '</div>'
          : '<div style="padding:14px;color:var(--text-secondary);font-size:12px;">这篇 PDF 暂无可展示的整合数据。请用 Codex 重新处理 PDF，或确认 PDF 中包含表格、图注、正文数值或结构化信息。</div>')) +
      '</div>';
    }

    function getPdfWikiDigitizationCurrentItem() {
      return getPdfWikiMetaItemById(pdfWikiDigitizationCurrentPdfId || (pendingPdfWikiDigitizationImport && pendingPdfWikiDigitizationImport.pdfId) || pdfWikiMetaSelectedPdfId);
    }

    function ensurePdfWikiDigitizationTable(item) {
      if (!item) return { columns: [], rows: [], rowCount: 0 };
      if (!item.dataTable || typeof item.dataTable !== 'object') item.dataTable = { columns: [], rows: [], rowCount: 0 };
      var table = item.dataTable;
      if (!Array.isArray(table.columns)) table.columns = [];
      if (!Array.isArray(table.rows)) table.rows = [];
      if (table.columns.length === 0 && table.rows.length > 0) {
        var columnMap = {};
        table.rows.forEach(function(row) {
          if (!row || typeof row !== 'object') return;
          Object.keys(row).forEach(function(column) { columnMap[column] = true; });
        });
        table.columns = Object.keys(columnMap);
      }
      if (table.columns.length > 0 && table.rows.length === 0) table.rows.push({});
      table.rowCount = table.rows.length;
      return table;
    }

    function setPdfWikiDigitizationPendingValues(values) {
      pdfWikiDigitizationPendingValues = (Array.isArray(values) ? values : [])
        .map(function(item, index) {
          if (item && typeof item === 'object') {
            return {
              value: String(item.value == null ? '' : item.value).trim(),
              label: String(item.label || ('数据 ' + (index + 1))).trim(),
              meta: item.meta || {}
            };
          }
          return { value: String(item == null ? '' : item).trim(), label: '数据 ' + (index + 1), meta: {} };
        })
        .filter(function(item) { return item.value !== ''; });
      pdfWikiDigitizationPendingValueSelection = {};
      pdfWikiDigitizationPendingValues.forEach(function(_, index) {
        pdfWikiDigitizationPendingValueSelection[String(index)] = true;
      });
      var pendingContainer = document.getElementById('pdfWikiDigitizationPendingValues');
      if (pendingContainer) pendingContainer.innerHTML = renderPdfWikiDigitizationPendingValuesHtml();
      else updatePdfWikiDigitizationCodingTablePanel();
    }

    function getPdfWikiDigitizationSelectedPendingValues() {
      return pdfWikiDigitizationPendingValues.filter(function(_, index) {
        return !!pdfWikiDigitizationPendingValueSelection[String(index)];
      });
    }

    function renderPdfWikiDigitizationPendingValuesHtml() {
      if (!pdfWikiDigitizationPendingValues.length) {
        return '<div style="padding:8px 9px;border:1px dashed var(--border-color);border-radius:7px;color:var(--text-secondary);font-size:12px;line-height:1.5;">暂无待填数据。请先完成采点，在左侧选择计算方式并点击“计算”。</div>';
      }
      return '<div style="display:flex;gap:6px;flex-wrap:wrap;max-height:88px;overflow:auto;padding:6px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-primary);">' +
        pdfWikiDigitizationPendingValues.map(function(item, index) {
          var checked = !!pdfWikiDigitizationPendingValueSelection[String(index)];
          return '<label data-digitization-pending-label="' + index + '" style="display:inline-flex;align-items:center;gap:5px;padding:4px 7px;border:1px solid ' + (checked ? 'var(--accent-color)' : 'var(--border-color)') + ';border-radius:999px;background:' + (checked ? 'rgba(16,163,127,0.10)' : 'var(--bg-secondary)') + ';font-size:11px;color:var(--text-primary);cursor:pointer;">' +
            '<input data-digitization-pending-select="1" type="checkbox" value="' + index + '"' + (checked ? ' checked' : '') + ' onchange="setPdfWikiDigitizationPendingValueSelection(Number(this.value),this.checked)" style="width:13px;height:13px;accent-color:var(--accent-color);">' +
            '<span>' + escapeHtml(item.label) + ': <strong>' + escapeHtml(item.value) + '</strong></span>' +
          '</label>';
        }).join('') +
      '</div>';
    }

    function getPdfWikiDigitizationVisibleColumns(table) {
      var columns = table && Array.isArray(table.columns) ? table.columns : [];
      return columns.filter(function(column) { return !pdfWikiDigitizationHiddenColumns[column]; });
    }

    function getPdfWikiDigitizationFrozenColumns(visibleColumns) {
      visibleColumns = Array.isArray(visibleColumns) ? visibleColumns : [];
      if (!pdfWikiDigitizationFrozenColumns || typeof pdfWikiDigitizationFrozenColumns !== 'object') {
        pdfWikiDigitizationFrozenColumns = {};
      }
      var visibleMap = {};
      visibleColumns.forEach(function(column) { visibleMap[column] = true; });
      Object.keys(pdfWikiDigitizationFrozenColumns).forEach(function(column) {
        if (!visibleMap[column]) delete pdfWikiDigitizationFrozenColumns[column];
      });
      return visibleColumns.filter(function(column) { return !!pdfWikiDigitizationFrozenColumns[column]; });
    }

    function getPdfWikiDigitizationFrozenColumnOffsets(visibleColumns) {
      var offsets = {};
      var left = 42;
      getPdfWikiDigitizationFrozenColumns(visibleColumns).forEach(function(column) {
        offsets[column] = left;
        left += 132;
      });
      return offsets;
    }

    function renderPdfWikiDigitizationCodingControlPanel(item) {
      var table = ensurePdfWikiDigitizationTable(item);
      var columns = table.columns || [];
      var columnMap = {};
      columns.forEach(function(column) { columnMap[column] = true; });
      Object.keys(pdfWikiDigitizationHiddenColumns).forEach(function(column) {
        if (!columnMap[column]) delete pdfWikiDigitizationHiddenColumns[column];
      });
      Object.keys(pdfWikiDigitizationHideColumnSelection).forEach(function(column) {
        if (!columnMap[column] || pdfWikiDigitizationHiddenColumns[column]) delete pdfWikiDigitizationHideColumnSelection[column];
      });
      var visibleColumns = getPdfWikiDigitizationVisibleColumns(table);
      var rows = table.rows || [];
      var target = pdfWikiDigitizationTargetCell;
      var targetText = target ? ('第 ' + (target.rowIndex + 1) + ' 行 / ' + target.column) : '未选择目标单元格';
      var frozenColumns = getPdfWikiDigitizationFrozenColumns(visibleColumns);
      var frozenColumnText = frozenColumns.length ? ('已冻结 ' + frozenColumns.length + ' 列：' + frozenColumns.join('、')) : '未冻结列';
      var selectedHideColumns = Object.keys(pdfWikiDigitizationHideColumnSelection).filter(function(column) {
        return !!pdfWikiDigitizationHideColumnSelection[column] && visibleColumns.indexOf(column) >= 0;
      });
      var hideSummaryText = pdfWikiDigitizationHiddenColumns && Object.keys(pdfWikiDigitizationHiddenColumns).length
        ? ('已隐藏 ' + Object.keys(pdfWikiDigitizationHiddenColumns).length + ' 列')
        : '未隐藏列';
      var buttonStyle = 'padding:5px 5px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);cursor:pointer;font-size:11px;line-height:1.2;white-space:nowrap;';
      var accentButtonStyle = 'padding:5px 5px;border:1px solid var(--accent-color);border-radius:6px;background:transparent;color:var(--accent-color);cursor:pointer;font-size:11px;line-height:1.2;white-space:nowrap;';
      var dangerButtonStyle = 'padding:5px 5px;border:1px solid var(--danger-color);border-radius:6px;background:transparent;color:var(--danger-color);cursor:pointer;font-size:11px;line-height:1.2;white-space:nowrap;';
      return '<div id="pdfWikiDigitizationCodingControlPanel" style="height:520px;min-height:520px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:7px;display:flex;flex-direction:column;gap:6px;overflow:auto;min-width:0;">' +
        '<div>' +
          '<div style="font-size:12px;font-weight:800;color:var(--text-primary);">Meta 分析编码表手动填入</div>' +
          '<div style="margin-top:3px;font-size:10.5px;line-height:1.4;color:var(--text-secondary);">先选待填数据，再点目标单元格；批量竖填向下写入。新建列会加入全局 Meta 模板。</div>' +
        '</div>' +
        '<div class="pdf-wiki-inline-control-row" style="display:flex;flex-direction:row;flex-wrap:nowrap;gap:6px;align-items:flex-start;padding-top:8px;width:100%;">' +
          '<input id="pdfWikiDigitizationNewColumnInput" class="pdf-wiki-digitization-input" placeholder="新建列名" onpointerdown="focusPdfWikiDigitizationInput(this,event)" onmousedown="event.stopPropagation()" onclick="focusPdfWikiDigitizationInput(this,event)" onkeydown="event.stopPropagation()" style="flex:1 1 auto;min-width:0;height:30px;box-sizing:border-box;margin-top:0;padding:5px 7px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:11.5px;">' +
          '<button id="pdfWikiDigitizationAddColumnBtn" type="button" onclick="addPdfWikiDigitizationCodingColumn()" style="' + accentButtonStyle + 'flex:0 0 72px;min-width:72px;height:30px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;border:1px solid #111827 !important;background:#111827 !important;color:#ffffff !important;">新建列</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;">' +
          '<button type="button" onclick="selectAllPdfWikiDigitizationPendingValues(true)" style="' + buttonStyle + '">全选数据</button>' +
          '<button type="button" onclick="selectAllPdfWikiDigitizationPendingValues(false)" style="' + buttonStyle + '">清空数据</button>' +
          '<button type="button" onclick="selectAllPdfWikiDigitizationColumns(true)" style="' + buttonStyle + '">全选列</button>' +
          '<button type="button" onclick="selectAllPdfWikiDigitizationColumns(false)" style="' + buttonStyle + '">清空列选</button>' +
          '<button type="button" onclick="fillPdfWikiDigitizationSingleCell()" style="' + accentButtonStyle + '">填入</button>' +
          '<button type="button" onclick="fillPdfWikiDigitizationBatchVertical()" style="' + accentButtonStyle + '">批量竖填</button>' +
          '<button type="button" onclick="fillPdfWikiDigitizationAllRows()" style="' + accentButtonStyle + '">填入全部行</button>' +
          '<button type="button" onclick="hideSelectedPdfWikiDigitizationColumns()" style="' + buttonStyle + '">隐藏选中列</button>' +
          '<button type="button" onclick="showAllPdfWikiDigitizationColumns()" style="' + buttonStyle + '">显示全部列</button>' +
          '<button type="button" onclick="deleteSelectedPdfWikiDigitizationColumns()" style="' + dangerButtonStyle + '">删除选中列</button>' +
        '</div>' +
        '<div id="pdfWikiDigitizationCodingActionStatus" style="display:none;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-primary);color:var(--text-secondary);font-size:10.5px;line-height:1.4;"></div>' +
        '<div id="pdfWikiDigitizationPendingValues">' + renderPdfWikiDigitizationPendingValuesHtml() + '</div>' +
        '<div style="padding:8px 9px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-primary);font-size:11.5px;line-height:1.55;color:var(--text-secondary);">' +
          '目标：<strong id="pdfWikiDigitizationTargetSummary" style="color:var(--text-primary);">' + escapeHtml(targetText) + '</strong><br>' +
          '当前表：' + columns.length + ' 列 / ' + rows.length + ' 行；显示 ' + visibleColumns.length + ' 列；已选 ' + selectedHideColumns.length + ' 列<br>' +
          escapeHtml(frozenColumnText) + '；' + escapeHtml(hideSummaryText) +
        '</div>' +
      '</div>';
    }

    function renderPdfWikiDigitizationCodingTablePanel(item) {
      var table = ensurePdfWikiDigitizationTable(item);
      var columns = table.columns || [];
      var columnMap = {};
      columns.forEach(function(column) { columnMap[column] = true; });
      Object.keys(pdfWikiDigitizationHiddenColumns).forEach(function(column) {
        if (!columnMap[column]) delete pdfWikiDigitizationHiddenColumns[column];
      });
      Object.keys(pdfWikiDigitizationHideColumnSelection).forEach(function(column) {
        if (!columnMap[column] || pdfWikiDigitizationHiddenColumns[column]) delete pdfWikiDigitizationHideColumnSelection[column];
      });
      var visibleColumns = getPdfWikiDigitizationVisibleColumns(table);
      var rows = table.rows || [];
      var target = pdfWikiDigitizationTargetCell;
      var targetText = target ? ('第 ' + (target.rowIndex + 1) + ' 行 / ' + target.column) : '未选择目标单元格';
      var rowsForRender = rows.slice(0, 120);
      var hiddenCount = Math.max(0, rows.length - rowsForRender.length);
      var frozenColumns = getPdfWikiDigitizationFrozenColumns(visibleColumns);
      var frozenOffsetMap = getPdfWikiDigitizationFrozenColumnOffsets(visibleColumns);
      var selectedHideColumns = Object.keys(pdfWikiDigitizationHideColumnSelection).filter(function(column) {
        return !!pdfWikiDigitizationHideColumnSelection[column] && visibleColumns.indexOf(column) >= 0;
      });
      var hideSummaryText = pdfWikiDigitizationHiddenColumns && Object.keys(pdfWikiDigitizationHiddenColumns).length
        ? ('已隐藏 ' + Object.keys(pdfWikiDigitizationHiddenColumns).length + ' 列')
        : '未隐藏列';
      var headerHtml = visibleColumns.map(function(column) {
        var frozen = frozenColumns.indexOf(column) >= 0;
        var frozenLeft = frozen ? frozenOffsetMap[column] : 0;
        var encodedColumn = escapeHtml(encodeURIComponent(column));
        return '<th data-digitization-header-column="' + encodedColumn + '" style="padding:6px 8px;border-bottom:1px solid var(--border-color);border-right:1px solid var(--border-color);background:var(--bg-primary);color:var(--text-secondary);font-size:11px;text-align:left;white-space:nowrap;' + (frozen ? 'position:sticky;left:' + frozenLeft + 'px;z-index:4;min-width:132px;max-width:132px;box-shadow:2px 0 8px rgba(15,23,42,0.12);' : '') + '">' +
          '<div style="display:flex;align-items:center;gap:6px;justify-content:space-between;">' +
            '<label style="display:inline-flex;align-items:center;gap:5px;min-width:0;cursor:pointer;">' +
              '<input data-digitization-column-select="1" type="checkbox" value="' + encodedColumn + '"' + (pdfWikiDigitizationHideColumnSelection[column] ? ' checked' : '') + ' onchange="setPdfWikiDigitizationHideColumnSelection(this.value,this.checked)" title="选择后可批量隐藏" style="width:13px;height:13px;accent-color:var(--accent-color);">' +
              '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(column) + '</span>' +
            '</label>' +
            '<button data-digitization-freeze-column="' + encodedColumn + '" type="button" onclick="togglePdfWikiDigitizationFrozenColumn(\'' + encodedColumn + '\')" title="' + (frozen ? '取消冻结这一列' : '冻结这一列') + '" style="flex:0 0 auto;padding:2px 5px;border:1px solid ' + (frozen ? 'var(--accent-color)' : 'var(--border-color)') + ';border-radius:5px;background:' + (frozen ? 'rgba(16,163,127,0.12)' : 'var(--bg-secondary)') + ';color:' + (frozen ? 'var(--accent-color)' : 'var(--text-secondary)') + ';font-size:10px;line-height:1.2;cursor:pointer;">' + (frozen ? '解冻' : '冻结') + '</button>' +
          '</div>' +
        '</th>';
      }).join('');
      var bodyHtml = rowsForRender.map(function(row, rowIndex) {
        return '<tr data-digitization-row-index="' + rowIndex + '">' +
          '<td data-digitization-row-number="1" style="position:sticky;left:0;z-index:3;padding:6px 8px;border-bottom:1px solid var(--border-color);border-right:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-secondary);font-size:11px;text-align:center;">' + (rowIndex + 1) + '</td>' +
          visibleColumns.map(function(column) {
            var value = formatPdfWikiMetaValue(row && row[column]);
            var protectedColumn = isPdfWikiMetaProtectedCodingColumn(column);
            var selected = target && target.rowIndex === rowIndex && target.column === column;
            var frozen = frozenColumns.indexOf(column) >= 0;
            var frozenLeft = frozen ? frozenOffsetMap[column] : 0;
            var cellStickyStyle = frozen ? 'position:sticky;left:' + frozenLeft + 'px;z-index:2;min-width:132px;max-width:132px;box-shadow:2px 0 8px rgba(15,23,42,0.10);' : '';
            if (protectedColumn) {
              return '<td data-digitization-coding-cell="1" data-column="' + escapeHtml(encodeURIComponent(column)) + '" style="padding:6px 8px;border-bottom:1px solid var(--border-color);border-right:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-secondary);font-size:11px;white-space:pre-wrap;word-break:break-word;' + cellStickyStyle + '">' + escapeHtml(value) + '</td>';
            }
            return '<td data-digitization-coding-cell="1" data-column="' + escapeHtml(encodeURIComponent(column)) + '" class="' + (selected ? 'pdf-wiki-digitization-target-cell' : '') + '" style="padding:3px;border-bottom:1px solid var(--border-color);border-right:1px solid var(--border-color);background:' + (selected ? 'rgba(16,163,127,0.16)' : 'var(--bg-primary)') + ';' + cellStickyStyle + '">' +
              '<button type="button" data-digitization-target-cell="1" data-row-index="' + rowIndex + '" data-column="' + escapeHtml(encodeURIComponent(column)) + '" class="' + (selected ? 'pdf-wiki-digitization-target-button' : '') + '" aria-selected="' + (selected ? 'true' : 'false') + '" onclick="selectPdfWikiDigitizationTargetCell(' + rowIndex + ',\'' + escapeHtml(encodeURIComponent(column)) + '\',event)" style="display:block;width:100%;min-width:110px;min-height:32px;text-align:left;padding:5px 6px;border:1px solid ' + (selected ? 'var(--accent-color)' : 'transparent') + ';border-radius:5px;background:transparent;color:var(--text-primary);font-size:11px;line-height:1.35;white-space:pre-wrap;word-break:break-word;cursor:pointer;">' + escapeHtml(value) + '</button>' +
            '</td>';
          }).join('') +
        '</tr>';
      }).join('');
      return '<div id="pdfWikiDigitizationCodingTablePanel" style="margin-top:6px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);overflow:hidden;">' +
        (visibleColumns.length ? (
          '<div id="pdfWikiDigitizationCodingTableScroll" style="overflow:auto;max-height:390px;">' +
            '<table style="width:max-content;min-width:100%;border-collapse:collapse;">' +
              '<thead style="position:sticky;top:0;z-index:1;"><tr>' +
                '<th style="position:sticky;left:0;z-index:5;width:42px;padding:6px 8px;border-bottom:1px solid var(--border-color);border-right:1px solid var(--border-color);background:var(--bg-primary);color:var(--text-secondary);font-size:11px;text-align:center;">行</th>' +
                headerHtml +
              '</tr></thead>' +
              '<tbody>' + bodyHtml + '</tbody>' +
            '</table>' +
          '</div>'
        ) : '<div style="padding:12px;color:var(--text-secondary);font-size:12px;">当前 PDF 暂无 Meta 编码表表头。请先完成 Meta 数据提取，或回到 Meta 页面手动建立表头。</div>') +
      '</div>';
    }

    function updatePdfWikiDigitizationCodingTablePanel() {
      var panel = document.getElementById('pdfWikiDigitizationCodingTablePanel');
      if (!panel) return;
      var controlPanel = document.getElementById('pdfWikiDigitizationCodingControlPanel');
      var newColumnInput = document.getElementById('pdfWikiDigitizationNewColumnInput');
      var newColumnValue = newColumnInput ? newColumnInput.value : '';
      var shouldRestoreNewColumnFocus = newColumnInput && document.activeElement === newColumnInput;
      var newColumnSelectionStart = shouldRestoreNewColumnFocus ? newColumnInput.selectionStart : null;
      var newColumnSelectionEnd = shouldRestoreNewColumnFocus ? newColumnInput.selectionEnd : null;
      var reviewScroll = document.getElementById('pdfWikiDigitizationReviewScroll');
      var tableScroll = document.getElementById('pdfWikiDigitizationCodingTableScroll');
      var reviewTop = reviewScroll ? reviewScroll.scrollTop : 0;
      var reviewLeft = reviewScroll ? reviewScroll.scrollLeft : 0;
      var tableTop = tableScroll ? tableScroll.scrollTop : 0;
      var tableLeft = tableScroll ? tableScroll.scrollLeft : 0;
      var item = getPdfWikiDigitizationCurrentItem();
      if (controlPanel) controlPanel.outerHTML = renderPdfWikiDigitizationCodingControlPanel(item);
      panel.outerHTML = renderPdfWikiDigitizationCodingTablePanel(item);
      setTimeout(function() {
        var nextNewColumnInput = document.getElementById('pdfWikiDigitizationNewColumnInput');
        var nextReviewScroll = document.getElementById('pdfWikiDigitizationReviewScroll');
        var nextTableScroll = document.getElementById('pdfWikiDigitizationCodingTableScroll');
        if (nextNewColumnInput && newColumnValue) nextNewColumnInput.value = newColumnValue;
        if (nextNewColumnInput && shouldRestoreNewColumnFocus) {
          focusPdfWikiDigitizationInputElement(nextNewColumnInput);
          if (Number.isInteger(newColumnSelectionStart) && Number.isInteger(newColumnSelectionEnd)) {
            try {
              nextNewColumnInput.setSelectionRange(newColumnSelectionStart, newColumnSelectionEnd);
            } catch (_error) {}
          }
        }
        if (nextReviewScroll) {
          nextReviewScroll.scrollTop = reviewTop;
          nextReviewScroll.scrollLeft = reviewLeft;
        }
        if (nextTableScroll) {
          nextTableScroll.scrollTop = tableTop;
          nextTableScroll.scrollLeft = tableLeft;
        }
      }, 0);
    }

    function decodePdfWikiDigitizationColumn(value) {
      try {
        return decodeURIComponent(value || '');
      } catch (_) {
        return String(value || '');
      }
    }

    function setPdfWikiDigitizationCodingActionStatus(message, tone) {
      var status = document.getElementById('pdfWikiDigitizationCodingActionStatus');
      if (!status) return;
      status.style.display = message ? 'block' : 'none';
      status.style.color = tone === 'error' ? 'var(--danger-color)' : (tone === 'ok' ? 'var(--accent-color)' : 'var(--text-secondary)');
      status.textContent = String(message || '');
    }

    function syncPdfWikiDigitizationCodingTableDom() {
      var item = getPdfWikiDigitizationCurrentItem();
      var table = ensurePdfWikiDigitizationTable(item);
      var tableScroll = document.getElementById('pdfWikiDigitizationCodingTableScroll');
      var tbody = tableScroll ? tableScroll.querySelector('tbody') : null;
      if (!tbody) return false;
      var renderCount = Math.min(table.rows.length, 120);
      var templateRow = tbody.querySelector('tr');
      if (!templateRow && renderCount > 0) return false;
      while (tbody.children.length < renderCount && templateRow) {
        tbody.appendChild(templateRow.cloneNode(true));
      }
      while (tbody.children.length > renderCount) {
        tbody.lastElementChild.remove();
      }
      Array.prototype.forEach.call(tbody.children, function(rowElement, rowIndex) {
        var row = table.rows[rowIndex] || {};
        rowElement.setAttribute('data-digitization-row-index', String(rowIndex));
        var numberCell = rowElement.querySelector('[data-digitization-row-number="1"]');
        if (numberCell) numberCell.textContent = String(rowIndex + 1);
        rowElement.querySelectorAll('[data-digitization-coding-cell="1"]').forEach(function(cell) {
          var encodedColumn = cell.getAttribute('data-column') || '';
          var column = decodePdfWikiDigitizationColumn(encodedColumn);
          var value = formatPdfWikiMetaValue(row[column]);
          var button = cell.querySelector('[data-digitization-target-cell="1"]');
          if (!button) {
            cell.textContent = value;
            return;
          }
          var selected = !!pdfWikiDigitizationTargetCell &&
            pdfWikiDigitizationTargetCell.rowIndex === rowIndex &&
            pdfWikiDigitizationTargetCell.column === column;
          button.textContent = value;
          button.setAttribute('data-row-index', String(rowIndex));
          button.setAttribute('data-column', encodedColumn);
          button.setAttribute('onclick', 'selectPdfWikiDigitizationTargetCell(' + rowIndex + ',\'' + encodedColumn + '\',event)');
          button.setAttribute('aria-selected', selected ? 'true' : 'false');
          button.classList.toggle('pdf-wiki-digitization-target-button', selected);
          cell.classList.toggle('pdf-wiki-digitization-target-cell', selected);
        });
      });
      return true;
    }

    function syncPdfWikiDigitizationFrozenColumnsDom() {
      var item = getPdfWikiDigitizationCurrentItem();
      var table = ensurePdfWikiDigitizationTable(item);
      var visibleColumns = getPdfWikiDigitizationVisibleColumns(table);
      var offsets = getPdfWikiDigitizationFrozenColumnOffsets(visibleColumns);
      document.querySelectorAll('[data-digitization-header-column]').forEach(function(header) {
        var encodedColumn = header.getAttribute('data-digitization-header-column') || '';
        var column = decodePdfWikiDigitizationColumn(encodedColumn);
        var frozen = Object.prototype.hasOwnProperty.call(offsets, column);
        header.style.position = frozen ? 'sticky' : '';
        header.style.left = frozen ? offsets[column] + 'px' : '';
        header.style.zIndex = frozen ? '4' : '';
        header.style.minWidth = frozen ? '132px' : '';
        header.style.maxWidth = frozen ? '132px' : '';
        header.style.boxShadow = frozen ? '2px 0 8px rgba(15,23,42,0.12)' : '';
        var freezeButton = header.querySelector('[data-digitization-freeze-column]');
        if (freezeButton) {
          freezeButton.textContent = frozen ? '解冻' : '冻结';
          freezeButton.title = frozen ? '取消冻结这一列' : '冻结这一列';
          freezeButton.style.borderColor = frozen ? 'var(--accent-color)' : 'var(--border-color)';
          freezeButton.style.background = frozen ? 'rgba(16,163,127,0.12)' : 'var(--bg-secondary)';
          freezeButton.style.color = frozen ? 'var(--accent-color)' : 'var(--text-secondary)';
        }
      });
      document.querySelectorAll('[data-digitization-coding-cell="1"]').forEach(function(cell) {
        var column = decodePdfWikiDigitizationColumn(cell.getAttribute('data-column') || '');
        var frozen = Object.prototype.hasOwnProperty.call(offsets, column);
        cell.style.position = frozen ? 'sticky' : '';
        cell.style.left = frozen ? offsets[column] + 'px' : '';
        cell.style.zIndex = frozen ? '2' : '';
        cell.style.minWidth = frozen ? '132px' : '';
        cell.style.maxWidth = frozen ? '132px' : '';
        cell.style.boxShadow = frozen ? '2px 0 8px rgba(15,23,42,0.10)' : '';
      });
    }

    function setPdfWikiDigitizationColumnVisibilityDom(column, visible) {
      document.querySelectorAll('[data-digitization-header-column], [data-digitization-coding-cell="1"]').forEach(function(element) {
        var encodedColumn = element.getAttribute('data-digitization-header-column') || element.getAttribute('data-column') || '';
        if (decodePdfWikiDigitizationColumn(encodedColumn) === column) {
          element.style.display = visible ? '' : 'none';
        }
      });
    }

    function findPdfWikiDigitizationColumnElement(root, attribute, column) {
      if (!root) return null;
      var elements = root.querySelectorAll('[' + attribute + ']');
      for (var i = 0; i < elements.length; i += 1) {
        if (decodePdfWikiDigitizationColumn(elements[i].getAttribute(attribute) || '') === column) {
          return elements[i];
        }
      }
      return null;
    }

    function insertPdfWikiDigitizationNodeAfter(parent, node, afterNode) {
      if (!parent || !node) return;
      if (afterNode && afterNode.parentElement === parent) parent.insertBefore(node, afterNode.nextSibling);
      else parent.appendChild(node);
    }

    function insertPdfWikiDigitizationColumnDom(column, afterColumn) {
      var currentPanel = document.getElementById('pdfWikiDigitizationCodingTablePanel');
      if (!currentPanel) return false;
      var item = getPdfWikiDigitizationCurrentItem();
      var staging = document.createElement('div');
      staging.innerHTML = renderPdfWikiDigitizationCodingTablePanel(item);
      var sourcePanel = staging.firstElementChild;
      var currentHeaderRow = currentPanel.querySelector('thead tr');
      var sourceHeader = findPdfWikiDigitizationColumnElement(sourcePanel, 'data-digitization-header-column', column);
      if (!currentHeaderRow || !sourceHeader) return false;
      var currentAfterHeader = afterColumn
        ? findPdfWikiDigitizationColumnElement(currentHeaderRow, 'data-digitization-header-column', afterColumn)
        : null;
      insertPdfWikiDigitizationNodeAfter(currentHeaderRow, sourceHeader.cloneNode(true), currentAfterHeader);
      var currentRows = currentPanel.querySelectorAll('tbody tr');
      var sourceRows = sourcePanel.querySelectorAll('tbody tr');
      Array.prototype.forEach.call(currentRows, function(currentRow, rowIndex) {
        var sourceCell = sourceRows[rowIndex]
          ? findPdfWikiDigitizationColumnElement(sourceRows[rowIndex], 'data-column', column)
          : null;
        if (!sourceCell) return;
        var currentAfterCell = afterColumn
          ? findPdfWikiDigitizationColumnElement(currentRow, 'data-column', afterColumn)
          : null;
        insertPdfWikiDigitizationNodeAfter(currentRow, sourceCell.cloneNode(true), currentAfterCell);
      });
      syncPdfWikiDigitizationFrozenColumnsDom();
      return true;
    }

    function removePdfWikiDigitizationColumnsDom(columns) {
      var removeSet = {};
      (Array.isArray(columns) ? columns : []).forEach(function(column) { removeSet[column] = true; });
      document.querySelectorAll('[data-digitization-header-column], [data-digitization-coding-cell="1"]').forEach(function(element) {
        var encodedColumn = element.getAttribute('data-digitization-header-column') || element.getAttribute('data-column') || '';
        if (removeSet[decodePdfWikiDigitizationColumn(encodedColumn)]) element.remove();
      });
      syncPdfWikiDigitizationFrozenColumnsDom();
    }

    function focusPdfWikiDigitizationInputElement(input) {
      if (!input) return;
      try {
        input.focus({ preventScroll: true });
      } catch (_error) {
        input.focus();
      }
    }

    window.focusPdfWikiDigitizationInput = function(input, event) {
      if (event) event.stopPropagation();
      setTimeout(function() {
        focusPdfWikiDigitizationInputElement(input);
      }, 0);
    };

    function syncPdfWikiDigitizationPendingSelectionDom() {
      document.querySelectorAll('[data-digitization-pending-select="1"]').forEach(function(input) {
        var index = String(input.value || '');
        var checked = !!pdfWikiDigitizationPendingValueSelection[index];
        input.checked = checked;
        var label = input.closest('[data-digitization-pending-label]');
        if (label) {
          label.style.borderColor = checked ? 'var(--accent-color)' : 'var(--border-color)';
          label.style.background = checked ? 'rgba(16,163,127,0.10)' : 'var(--bg-secondary)';
        }
      });
    }

    window.setPdfWikiDigitizationPendingValueSelection = function(index, checked) {
      if (!Number.isInteger(index) || index < 0) return;
      if (checked) pdfWikiDigitizationPendingValueSelection[String(index)] = true;
      else delete pdfWikiDigitizationPendingValueSelection[String(index)];
      syncPdfWikiDigitizationPendingSelectionDom();
    };

    window.selectAllPdfWikiDigitizationPendingValues = function(checked) {
      pdfWikiDigitizationPendingValueSelection = {};
      if (checked) {
        pdfWikiDigitizationPendingValues.forEach(function(_, index) {
          pdfWikiDigitizationPendingValueSelection[String(index)] = true;
        });
      }
      syncPdfWikiDigitizationPendingSelectionDom();
    };

    window.selectPdfWikiDigitizationTargetCell = function(rowIndex, encodedColumn, event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      var column = '';
      try {
        column = decodeURIComponent(encodedColumn || '');
      } catch (_) {
        column = encodedColumn || '';
      }
      if (!Number.isInteger(rowIndex) || rowIndex < 0 || !column || isPdfWikiMetaProtectedCodingColumn(column)) return;
      pdfWikiDigitizationTargetCell = { rowIndex: rowIndex, column: column };
      document.querySelectorAll('[data-digitization-target-cell="1"]').forEach(function(button) {
        var buttonRow = Number(button.getAttribute('data-row-index'));
        var buttonColumn = '';
        try {
          buttonColumn = decodeURIComponent(button.getAttribute('data-column') || '');
        } catch (_) {
          buttonColumn = button.getAttribute('data-column') || '';
        }
        var selected = buttonRow === rowIndex && buttonColumn === column;
        button.classList.toggle('pdf-wiki-digitization-target-button', selected);
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
        var cell = button.closest('td');
        if (cell) cell.classList.toggle('pdf-wiki-digitization-target-cell', selected);
      });
      var targetSummary = document.getElementById('pdfWikiDigitizationTargetSummary');
      if (targetSummary) targetSummary.textContent = '第 ' + (rowIndex + 1) + ' 行 / ' + column;
    };

    window.togglePdfWikiDigitizationFrozenColumn = function(encodedColumn) {
      var column = '';
      try {
        column = decodeURIComponent(encodedColumn || '');
      } catch (_) {
        column = encodedColumn || '';
      }
      column = String(column || '').trim();
      if (!column) return;
      if (!pdfWikiDigitizationFrozenColumns || typeof pdfWikiDigitizationFrozenColumns !== 'object') {
        pdfWikiDigitizationFrozenColumns = {};
      }
      if (pdfWikiDigitizationFrozenColumns[column]) delete pdfWikiDigitizationFrozenColumns[column];
      else pdfWikiDigitizationFrozenColumns[column] = true;
      syncPdfWikiDigitizationFrozenColumnsDom();
    };

    window.setPdfWikiDigitizationHideColumnSelection = function(encodedColumn, checked) {
      var column = '';
      try {
        column = decodeURIComponent(encodedColumn || '');
      } catch (_) {
        column = encodedColumn || '';
      }
      column = String(column || '').trim();
      if (!column || pdfWikiDigitizationHiddenColumns[column]) return;
      if (checked) pdfWikiDigitizationHideColumnSelection[column] = true;
      else delete pdfWikiDigitizationHideColumnSelection[column];
    };

    window.selectAllPdfWikiDigitizationColumns = function(checked) {
      var item = getPdfWikiDigitizationCurrentItem();
      var table = ensurePdfWikiDigitizationTable(item);
      var visibleColumns = getPdfWikiDigitizationVisibleColumns(table);
      pdfWikiDigitizationHideColumnSelection = {};
      if (checked) {
        visibleColumns.forEach(function(column) {
          pdfWikiDigitizationHideColumnSelection[column] = true;
        });
      }
      document.querySelectorAll('[data-digitization-column-select="1"]').forEach(function(input) {
        var column = '';
        try {
          column = decodeURIComponent(input.value || '');
        } catch (_) {
          column = input.value || '';
        }
        input.checked = !!pdfWikiDigitizationHideColumnSelection[column];
      });
    };

    window.hideSelectedPdfWikiDigitizationColumns = function() {
      var item = getPdfWikiDigitizationCurrentItem();
      var table = ensurePdfWikiDigitizationTable(item);
      var columns = Array.isArray(table.columns) ? table.columns : [];
      var visibleColumns = columns.filter(function(column) { return !pdfWikiDigitizationHiddenColumns[column]; });
      var selected = Object.keys(pdfWikiDigitizationHideColumnSelection).filter(function(column) {
        return !!pdfWikiDigitizationHideColumnSelection[column] && visibleColumns.indexOf(column) >= 0;
      });
      if (!selected.length) {
        alert('请先在表头勾选需要隐藏的列。');
        return;
      }
      if (selected.length >= visibleColumns.length) {
        alert('至少需要保留 1 列可见。');
        return;
      }
      selected.forEach(function(column) {
        pdfWikiDigitizationHiddenColumns[column] = true;
        delete pdfWikiDigitizationHideColumnSelection[column];
        delete pdfWikiDigitizationFrozenColumns[column];
        setPdfWikiDigitizationColumnVisibilityDom(column, false);
      });
      if (pdfWikiDigitizationTargetCell && pdfWikiDigitizationHiddenColumns[pdfWikiDigitizationTargetCell.column]) {
        pdfWikiDigitizationTargetCell = null;
        var targetSummary = document.getElementById('pdfWikiDigitizationTargetSummary');
        if (targetSummary) targetSummary.textContent = '未选择目标单元格';
      }
      syncPdfWikiDigitizationFrozenColumnsDom();
      setPdfWikiDigitizationCodingActionStatus('已隐藏 ' + selected.length + ' 列。', 'ok');
    };

    window.showAllPdfWikiDigitizationColumns = function() {
      var hiddenColumns = Object.keys(pdfWikiDigitizationHiddenColumns || {});
      hiddenColumns.forEach(function(column) {
        setPdfWikiDigitizationColumnVisibilityDom(column, true);
      });
      pdfWikiDigitizationHiddenColumns = {};
      pdfWikiDigitizationHideColumnSelection = {};
      syncPdfWikiDigitizationFrozenColumnsDom();
      document.querySelectorAll('[data-digitization-column-select="1"]').forEach(function(input) {
        input.checked = false;
      });
      setPdfWikiDigitizationCodingActionStatus('已显示全部列。', 'ok');
    };

    function getSelectedVisiblePdfWikiDigitizationColumns() {
      var item = getPdfWikiDigitizationCurrentItem();
      var table = ensurePdfWikiDigitizationTable(item);
      var columns = Array.isArray(table.columns) ? table.columns : [];
      var visibleColumns = columns.filter(function(column) { return !pdfWikiDigitizationHiddenColumns[column]; });
      return Object.keys(pdfWikiDigitizationHideColumnSelection).filter(function(column) {
        return !!pdfWikiDigitizationHideColumnSelection[column] && visibleColumns.indexOf(column) >= 0;
      });
    }

    function removeColumnsFromLocalPdfWikiMetaTables(columns) {
      var removeSet = {};
      (Array.isArray(columns) ? columns : []).forEach(function(column) {
        removeSet[column] = true;
      });
      if (!pdfWikiMetaDatabaseData || !Array.isArray(pdfWikiMetaDatabaseData.items)) return;
      pdfWikiMetaDatabaseData.items.forEach(function(item) {
        if (!item.dataTable || typeof item.dataTable !== 'object') return;
        var table = item.dataTable;
        if (Array.isArray(table.columns)) {
          table.columns = table.columns.filter(function(column) { return !removeSet[column]; });
        }
        if (Array.isArray(table.rows)) {
          table.rows.forEach(function(row) {
            if (!row || typeof row !== 'object') return;
            Object.keys(removeSet).forEach(function(column) {
              delete row[column];
            });
          });
          table.rowCount = table.rows.length;
        }
      });
    }

    window.deleteSelectedPdfWikiDigitizationColumns = async function() {
      var item = getPdfWikiDigitizationCurrentItem();
      if (!item || !item.pdfId) {
        alert('未找到当前 PDF，无法删除列。');
        return;
      }
      var selected = getSelectedVisiblePdfWikiDigitizationColumns();
      if (!selected.length) {
        alert('请先在表头勾选需要删除的列。');
        return;
      }
      var protectedSelected = selected.filter(isPdfWikiMetaProtectedCodingColumn);
      var deletable = selected.filter(function(column) { return !isPdfWikiMetaProtectedCodingColumn(column); });
      if (!deletable.length) {
        alert('所选列属于系统追踪字段，不能删除。');
        return;
      }
      var message = '确认删除 Meta 编码表中的 ' + deletable.length + ' 列？\n\n列删除会更新全局 Meta 模板，并从所有 PDF 的已存编码行中移除这些字段。';
      if (protectedSelected.length) {
        message += '\n\n系统追踪字段不会删除：' + protectedSelected.join('、');
      }
      if (!confirm(message)) return;
      try {
        var response = await fetch('/api/pdf-wiki/meta/coding-table/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            pdfId: item.pdfId,
            columns: deletable
          })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '删除列失败');
        removeColumnsFromLocalPdfWikiMetaTables(deletable);
        deletable.forEach(function(column) {
          delete pdfWikiDigitizationHiddenColumns[column];
          delete pdfWikiDigitizationHideColumnSelection[column];
          delete pdfWikiDigitizationFrozenColumns[column];
        });
        protectedSelected.forEach(function(column) {
          delete pdfWikiDigitizationHideColumnSelection[column];
        });
        if (pdfWikiDigitizationTargetCell && deletable.indexOf(pdfWikiDigitizationTargetCell.column) >= 0) {
          pdfWikiDigitizationTargetCell = null;
          var targetSummary = document.getElementById('pdfWikiDigitizationTargetSummary');
          if (targetSummary) targetSummary.textContent = '未选择目标单元格';
        }
        pdfWikiDigitizationCurrentPdfId = data.pdfId || item.pdfId;
        removePdfWikiDigitizationColumnsDom(deletable);
        document.querySelectorAll('[data-digitization-column-select="1"]').forEach(function(input) {
          var column = decodePdfWikiDigitizationColumn(input.value || '');
          input.checked = !!pdfWikiDigitizationHideColumnSelection[column];
        });
        setPdfWikiDigitizationCodingActionStatus('已删除 ' + deletable.length + ' 列。', 'ok');
      } catch (error) {
        alert('删除列失败：' + error.message);
      }
    };

    function insertColumnNameAfter(columns, column, afterColumn) {
      columns = Array.isArray(columns) ? columns : [];
      var existingIndex = columns.indexOf(column);
      if (existingIndex >= 0) columns.splice(existingIndex, 1);
      var afterIndex = afterColumn ? columns.indexOf(afterColumn) : -1;
      if (afterIndex >= 0) columns.splice(afterIndex + 1, 0, column);
      else columns.push(column);
      return columns;
    }

    function addColumnToLocalPdfWikiMetaTables(column, afterColumn) {
      if (!pdfWikiMetaDatabaseData || !Array.isArray(pdfWikiMetaDatabaseData.items)) return;
      pdfWikiMetaDatabaseData.items.forEach(function(item) {
        if (!item.dataTable || typeof item.dataTable !== 'object') item.dataTable = { columns: [], rows: [], rowCount: 0 };
        var table = item.dataTable;
        if (!Array.isArray(table.columns)) table.columns = [];
        if (!Array.isArray(table.rows)) table.rows = [];
        table.columns = insertColumnNameAfter(table.columns, column, afterColumn);
        table.rows.forEach(function(row) {
          if (row && typeof row === 'object' && !Object.prototype.hasOwnProperty.call(row, column)) {
            row[column] = '';
          }
        });
        table.rowCount = table.rows.length;
      });
    }

    window.addPdfWikiDigitizationCodingColumn = async function() {
      var input = document.getElementById('pdfWikiDigitizationNewColumnInput');
      var column = input ? String(input.value || '').trim() : '';
      if (!column) {
        alert('请输入新建列名。');
        return;
      }
      if (isPdfWikiMetaProtectedCodingColumn(column)) {
        alert('系统追踪字段不能手动新建。');
        return;
      }
      var item = getPdfWikiDigitizationCurrentItem();
      if (!item || !item.pdfId) {
        alert('未找到当前 PDF，无法新建列。');
        return;
      }
      var afterColumn = pdfWikiDigitizationTargetCell && pdfWikiDigitizationTargetCell.column ? pdfWikiDigitizationTargetCell.column : '';
      addColumnToLocalPdfWikiMetaTables(column, afterColumn);
      if (!insertPdfWikiDigitizationColumnDom(column, afterColumn)) {
        updatePdfWikiDigitizationCodingTablePanel();
      }
      try {
        var response = await fetch('/api/pdf-wiki/meta/coding-table/columns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            column: column,
            afterColumn: afterColumn
          })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '新建列失败');
        if (input) input.value = '';
        pdfWikiDigitizationCurrentPdfId = item.pdfId;
        addColumnToLocalPdfWikiMetaTables(column, afterColumn);
        setPdfWikiDigitizationCodingActionStatus('已新建“' + column + '”列。', 'ok');
      } catch (error) {
        removeColumnsFromLocalPdfWikiMetaTables([column]);
        removePdfWikiDigitizationColumnsDom([column]);
        alert('新建列失败：' + error.message);
      }
    };

    function fillPdfWikiDigitizationCellValues(batch) {
      var item = getPdfWikiDigitizationCurrentItem();
      var table = ensurePdfWikiDigitizationTable(item);
      if (!pdfWikiDigitizationTargetCell) {
        alert('请先点击 Meta 编码表中的目标单元格。');
        return;
      }
      var values = getPdfWikiDigitizationSelectedPendingValues();
      if (!values.length) {
        alert('暂无已选择的待填数据。请先完成采点计算，并勾选需要填入的数据。');
        return;
      }
      var column = pdfWikiDigitizationTargetCell.column;
      if (table.columns.indexOf(column) < 0) table.columns.push(column);
      var startRow = pdfWikiDigitizationTargetCell.rowIndex;
      var writeValues = batch ? values : values.slice(0, 1);
      writeValues.forEach(function(item, offset) {
        var rowIndex = startRow + offset;
        while (table.rows.length <= rowIndex) table.rows.push({});
        table.rows[rowIndex][column] = item.value;
      });
      table.rowCount = table.rows.length;
      if (!syncPdfWikiDigitizationCodingTableDom()) updatePdfWikiDigitizationCodingTablePanel();
      setPdfWikiDigitizationCodingActionStatus(
        batch
          ? ('已从第 ' + (startRow + 1) + ' 行开始，向下填入 ' + writeValues.length + ' 个值到“' + column + '”列。')
          : ('已填入第 ' + (startRow + 1) + ' 行“' + column + '”单元格。'),
        'ok'
      );
    }

    window.fillPdfWikiDigitizationSingleCell = function() {
      fillPdfWikiDigitizationCellValues(false);
    };

    window.fillPdfWikiDigitizationBatchVertical = function() {
      fillPdfWikiDigitizationCellValues(true);
    };

    window.fillPdfWikiDigitizationAllRows = function() {
      var item = getPdfWikiDigitizationCurrentItem();
      var table = ensurePdfWikiDigitizationTable(item);
      if (!pdfWikiDigitizationTargetCell) {
        alert('请先点击目标列中的任意一个单元格。');
        return;
      }
      var values = getPdfWikiDigitizationSelectedPendingValues();
      if (!values.length) {
        alert('暂无已选择的待填数据。请先完成采点计算，并勾选需要填入的数据。');
        return;
      }
      if (!Array.isArray(table.rows) || table.rows.length === 0) {
        alert('当前 Meta 编码表没有现有行，无法填入全部行。');
        return;
      }
      var column = pdfWikiDigitizationTargetCell.column;
      if (table.columns.indexOf(column) < 0) table.columns.push(column);
      var value = values[0].value;
      table.rows = table.rows.map(function(row) {
        row = row && typeof row === 'object' ? row : {};
        row[column] = value;
        return row;
      });
      table.rowCount = table.rows.length;
      if (!syncPdfWikiDigitizationCodingTableDom()) updatePdfWikiDigitizationCodingTablePanel();
      setPdfWikiDigitizationCodingActionStatus('已将同一个值填入“' + column + '”列的全部 ' + table.rows.length + ' 行。', 'ok');
    };

    async function savePdfWikiDigitizationCodingTable(options) {
      options = options || {};
      var item = getPdfWikiDigitizationCurrentItem();
      if (!item || !item.pdfId) {
        throw new Error('未找到当前 PDF，无法保存。');
      }
      var table = ensurePdfWikiDigitizationTable(item);
      var response = await fetch('/api/pdf-wiki/meta/coding-table/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          pdfId: item.pdfId,
          columns: table.columns,
          rows: table.rows
        })
      });
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '保存失败');
      pdfWikiDigitizationCurrentPdfId = data.pdfId || item.pdfId;
      if (data.dataTable) item.dataTable = data.dataTable;
      if (options.reload !== false) {
        await reloadPdfWikiMetaDatabase(data.pdfId || item.pdfId);
        updatePdfWikiDigitizationCodingTablePanel();
      }
      return data;
    }

    window.savePdfWikiDigitizationCodingTableDraft = async function() {
      try {
        await savePdfWikiDigitizationCodingTable();
        alert('Meta 编码表已保存。');
      } catch (error) {
        alert('保存 Meta 编码表失败：' + error.message);
      }
    };

    function getPdfWikiMetaSourceFigures(selected) {
      var metaData = selected && selected.metaData && typeof selected.metaData === 'object' ? selected.metaData : {};
      var figures = Array.isArray(metaData.source_figures) ? metaData.source_figures : (Array.isArray(metaData.sourceFigures) ? metaData.sourceFigures : []);
      return figures.map(function(figure, index) {
        if (figure && typeof figure === 'object') {
          return Object.assign({ _index: index }, figure);
        }
        return { _index: index, label: String(figure || 'Figure ' + (index + 1)) };
      });
    }

    function getPdfWikiMetaFigureLabel(figure, index) {
      if (!figure || typeof figure !== 'object') return 'Figure ' + (index + 1);
      return figure.label || figure.title || figure.caption || figure.id || figure.figure_id || figure.number || ('Figure ' + (index + 1));
    }

    function collectPdfWikiMetaTreatmentOptions(item) {
      var values = [];
      function add(value) {
        var text = String(value || '').trim();
        if (!text || text.length > 120) return;
        if (!values.some(function(existing) { return existing.toLowerCase() === text.toLowerCase(); })) {
          values.push(text);
        }
      }
      (item && Array.isArray(item.treatmentCategories) ? item.treatmentCategories : []).forEach(add);
      var metaData = item && item.metaData && typeof item.metaData === 'object' ? item.metaData : {};
      [
        metaData.treatment_categories,
        metaData.treatmentCategories,
        metaData.treatments,
        metaData.treatment_groups,
        metaData.treatmentGroups
      ].forEach(function(list) {
        if (Array.isArray(list)) list.forEach(add);
      });
      var rows = item && item.dataTable && Array.isArray(item.dataTable.rows) ? item.dataTable.rows : [];
      rows.forEach(function(row) {
        if (!row || typeof row !== 'object') return;
        [
          row['处理'],
          row['Treatment'],
          row.treatment,
          row.treatmentName,
          row['图像数字化处理组'],
          row['图像数字化系列'],
          row.Series,
          row.series
        ].forEach(add);
      });
      return values.slice(0, 80);
    }

    function collectPdfWikiMetaSubfigureOptions(item, figures) {
      var values = [];
      function add(value) {
        var text = String(value || '').trim();
        if (!text || text.length > 140) return;
        if (!values.some(function(existing) { return existing.toLowerCase() === text.toLowerCase(); })) {
          values.push(text);
        }
      }
      (Array.isArray(figures) ? figures : []).forEach(function(figure, index) {
        add(getPdfWikiMetaFigureLabel(figure, index));
      });
      var metaData = item && item.metaData && typeof item.metaData === 'object' ? item.metaData : {};
      var sourceFigures = Array.isArray(metaData.source_figures) ? metaData.source_figures : (Array.isArray(metaData.sourceFigures) ? metaData.sourceFigures : []);
      sourceFigures.forEach(function(figure, index) {
        if (figure && typeof figure === 'object') {
          add(figure.label || figure.title || figure.id || figure.number || ('Figure ' + (index + 1)));
        }
      });
      var rows = item && item.dataTable && Array.isArray(item.dataTable.rows) ? item.dataTable.rows : [];
      rows.forEach(function(row) {
        if (!row || typeof row !== 'object') return;
        [row.Subfigure, row.subfigure, row['子图'], row['图像数字化子图'], row.source_figure, row['图像数字化图件']].forEach(add);
      });
      return values.slice(0, 80);
    }

    function normalizePdfWikiMetaVariableOptionKey(value) {
      return String(value || '').toLowerCase().replace(/[（）]/g, function(match) { return match === '（' ? '(' : ')'; }).replace(/[_\s#:/\\()]+/g, '').trim();
    }

    function collectPdfWikiMetaVariableOptions(item, aliases, extras) {
      var values = [];
      var seen = {};
      function add(value) {
        if (Array.isArray(value)) {
          value.forEach(add);
          return;
        }
        if (value && typeof value === 'object') {
          Object.keys(value).forEach(function(key) { add(value[key]); });
          return;
        }
        var text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length > 140) return;
        var key = text.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        values.push(text);
      }
      (Array.isArray(extras) ? extras : []).forEach(add);
      var aliasSet = {};
      (Array.isArray(aliases) ? aliases : []).forEach(function(alias) {
        aliasSet[normalizePdfWikiMetaVariableOptionKey(alias)] = true;
      });
      var metaData = item && item.metaData && typeof item.metaData === 'object' ? item.metaData : {};
      Object.keys(metaData).forEach(function(key) {
        if (aliasSet[normalizePdfWikiMetaVariableOptionKey(key)]) add(metaData[key]);
      });
      var rows = item && item.dataTable && Array.isArray(item.dataTable.rows) ? item.dataTable.rows : [];
      rows.forEach(function(row) {
        if (!row || typeof row !== 'object') return;
        Object.keys(row).forEach(function(key) {
          if (aliasSet[normalizePdfWikiMetaVariableOptionKey(key)]) add(row[key]);
        });
      });
      return values.slice(0, 80);
    }

    function isPdfWikiMetaDigitizationFactorColumn(column) {
      var label = String(column || '').trim();
      if (!label || isPdfWikiMetaProtectedCodingColumn(label)) return false;
      var normalized = normalizePdfWikiMetaVariableOptionKey(label);
      if (!normalized || ['obs', 'study', 'pdf'].indexOf(normalized) >= 0 || /图像数字化|digitization|source|evidence|doi|title|abstract/.test(normalized)) return false;
      if (/mean|sd|se|sem|variance|effect|yi|vi|weight|flux|emission|yield|rate|dose|ninput|nitrogeninput|period|duration|replicate|lat|long|latitude|longitude|temperature|precipitation|rain|irrigation|water|wfps|whc|texture|bulk|density|ph|som|soc|tc|tn|nh4|no3|cnratio|climate|fertilizationtimes|施氮量|氮投入|持续天数|重复数|纬度|经度|温度|降水|灌溉|纳水|土壤|质地|容重|有机质|有机碳|全碳|全氮|气候|施肥次数/.test(normalized)) return false;
      return /处理|treatment|group|组别|年份|year|作物|crop|season|季节|地点|location|site|品种|variety|cultivar|制度|system|rotation|轮作|管理|management/.test(label.toLowerCase());
    }

    function collectPdfWikiMetaDigitizationFactorDefinitions(item) {
      var table = item && item.dataTable ? item.dataTable : {};
      var columns = Array.isArray(table.columns) ? table.columns : [];
      var definitions = [];
      var seen = {};
      function add(column, aliases, extras, placeholder) {
        var label = String(column || '').trim();
        var key = normalizePdfWikiMetaVariableOptionKey(label);
        if (!label || !key || seen[key]) return;
        seen[key] = true;
        var aliasList = [label].concat(Array.isArray(aliases) ? aliases : []);
        var options = collectPdfWikiMetaVariableOptions(item, aliasList, extras || []);
        definitions.push({
          id: 'digitizationFactorVariable' + definitions.length,
          label: label,
          column: label,
          listId: 'digitizationFactorOptions' + definitions.length,
          options: options,
          value: getPdfWikiDigitizationFirstOption(options, ''),
          placeholder: placeholder || ('选择或输入' + label)
        });
      }
      columns.forEach(function(column) {
        var label = String(column || '').trim();
        var normalized = normalizePdfWikiMetaVariableOptionKey(label);
        if (!label || normalized === '处理' || normalized === 'treatment') return;
        if (isPdfWikiMetaDigitizationFactorColumn(label)) add(label);
      });
      var hasYear = definitions.some(function(definition) { return /年份|year/i.test(definition.label); });
      if (!hasYear) add('年份', ['实验年份', 'year', 'study year', 'experiment year', 'experimental year'], [item && item.year], '选择或输入实验年份');
      var hasCrop = definitions.some(function(definition) { return /作物|crop/i.test(definition.label); });
      if (!hasCrop) add('种植的作物', ['crop', 'crop type', 'croptype', '作物', '种植作物'], item && item.cropTypes || [], '选择或输入当前图对应作物');
      return definitions.filter(function(definition) {
        return definition.label === '年份' || definition.label === '种植的作物' || isPdfWikiMetaDigitizationFactorColumn(definition.label);
      }).slice(0, 10);
    }

    function renderPdfWikiDigitizationDatalist(id, values) {
      return '<datalist id="' + escapeHtml(id) + '">' + (Array.isArray(values) ? values : []).map(function(value) {
        return '<option value="' + escapeHtml(value) + '">';
      }).join('') + '</datalist>';
    }

    function getPdfWikiDigitizationFirstOption(values, fallback) {
      values = Array.isArray(values) ? values : [];
      return values.length ? values[0] : String(fallback || '');
    }

    function renderPdfWikiDigitizationVariableInput(definition) {
      var column = encodeURIComponent(definition.column || definition.label || '');
      return '<label style="font-size:12px;color:var(--text-secondary);">' + escapeHtml(definition.label) +
        '<input id="' + escapeHtml(definition.id) + '" data-digitization-factor-variable="1" data-column="' + escapeHtml(column) + '" list="' + escapeHtml(definition.listId || '') + '" value="' + escapeHtml(definition.value || '') + '" placeholder="' + escapeHtml(definition.placeholder || '') + '" style="width:100%;margin-top:5px;padding:8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);">' +
        (definition.listId ? renderPdfWikiDigitizationDatalist(definition.listId, definition.options || []) : '') +
      '</label>';
    }

    window.applyDigitizationTreatmentPreset = function() {
      var select = document.getElementById('digitizationTreatmentPreset');
      var input = document.getElementById('digitizationTreatment');
      if (!select || !input) return;
      var value = String(select.value || '').trim();
      if (value) input.value = value;
    };

    function isPdfWikiDigitizationControlTreatmentName(value) {
      var text = String(value || '').trim().toLowerCase();
      if (!text) return false;
      return /(^|\b)(ck|control|blank|baseline|untreated|no treatment|without treatment)(\b|$)|对照|空白|未处理|无处理|不处理|常规/.test(text);
    }

    function encodePdfWikiDigitizationReadRole(role, treatment) {
      return 'metaTreatmentRole::' + role + '::' + encodeURIComponent(String(treatment || ''));
    }

    function parsePdfWikiDigitizationReadRoleSelection(rawValue) {
      var raw = String(rawValue || '').trim();
      if (raw.indexOf('metaTreatmentRole::') !== 0) {
        return { readRole: raw, treatment: '', control: '', isMetaTreatmentRole: false };
      }
      var parts = raw.split('::');
      var role = String(parts[1] || '').trim();
      var name = '';
      try {
        name = decodeURIComponent(parts.slice(2).join('::') || '');
      } catch (error) {
        name = parts.slice(2).join('::') || '';
      }
      name = String(name || '').trim();
      var isControlRole = /^(controlMean|controlSd|controlN)$/.test(role);
      return {
        readRole: role,
        treatment: isControlRole ? '' : name,
        control: isControlRole ? name : '',
        isMetaTreatmentRole: true
      };
    }

    function buildPdfWikiDigitizationReadRoleOptions(treatmentOptions) {
      var baseOptions = [
        ['仅保存为图像数字化坐标', ''],
        ['处理组均值', 'treatmentMean'],
        ['处理组标准差', 'treatmentSd'],
        ['处理组样本量', 'treatmentN'],
        ['对照组均值', 'controlMean'],
        ['对照组标准差', 'controlSd'],
        ['对照组样本量', 'controlN'],
        ['累计值 / 通量 / 总量', 'cumulative']
      ].map(function(option) {
        return '<option value="' + escapeHtml(option[1]) + '">' + escapeHtml(option[0]) + '</option>';
      }).join('');
      var names = Array.isArray(treatmentOptions) ? treatmentOptions : [];
      if (!names.length) return baseOptions;
      var metricOptions = names.map(function(name) {
        var rolePrefix = isPdfWikiDigitizationControlTreatmentName(name) ? 'control' : 'treatment';
        return [
          '<option value="' + escapeHtml(encodePdfWikiDigitizationReadRole(rolePrefix + 'Mean', name)) + '">' + escapeHtml(name + ' - 均值') + '</option>',
          '<option value="' + escapeHtml(encodePdfWikiDigitizationReadRole(rolePrefix + 'Sd', name)) + '">' + escapeHtml(name + ' - 标准差') + '</option>',
          '<option value="' + escapeHtml(encodePdfWikiDigitizationReadRole(rolePrefix + 'N', name)) + '">' + escapeHtml(name + ' - 样本量') + '</option>'
        ].join('');
      }).join('');
      return baseOptions + '<optgroup label="按当前 PDF 处理名称">' + metricOptions + '</optgroup>';
    }

    window.applyDigitizationReadRoleSelection = function() {
      var select = document.getElementById('digitizationReadRole');
      if (!select) return;
      var parsed = parsePdfWikiDigitizationReadRoleSelection(select.value);
      if (!parsed.isMetaTreatmentRole) return;
      var treatmentInput = document.getElementById('digitizationTreatment');
      var controlInput = document.getElementById('digitizationControl');
      var seriesInput = document.getElementById('digitizationSeriesName');
      if (parsed.treatment && treatmentInput) treatmentInput.value = parsed.treatment;
      if (parsed.control && controlInput) controlInput.value = parsed.control;
      if (seriesInput && !String(seriesInput.value || '').trim()) {
        seriesInput.value = parsed.treatment || parsed.control || '';
      }
    };

    function getPdfWikiMetaFigurePreview(selected, figure, index) {
      if (figure && typeof figure === 'object') {
        var directUrl = figure.url || figure.image_url || figure.imageUrl || figure.preview_url || figure.previewUrl || figure.file_url || figure.fileUrl;
        if (directUrl) {
          return {
            url: String(directUrl),
            name: String(figure.name || figure.file || figure.fileName || ''),
            number: String(figure.number || figure.id || figure.figure_id || ''),
            title: String(figure.title || figure.caption || '')
          };
        }
      }
      var previews = Array.isArray(selected && selected.figurePreviews) ? selected.figurePreviews : [];
      if (!previews.length) return null;
      var tokens = [];
      if (figure && typeof figure === 'object') {
        var rawTokens = [
          figure.name,
          figure.file,
          figure.fileName,
          figure.filename,
          figure.figure_file,
          figure.id,
          figure.figure_id,
          figure.number,
          figure.title,
          figure.label,
          figure.caption
        ];
        rawTokens.forEach(function(value) {
          var token = String(value || '').trim().toLowerCase();
          if (!token) return;
          tokens.push(token);
          var baseName = token.split(/[\\/]/).pop();
          if (baseName && baseName !== token) tokens.push(baseName);
          var noExt = baseName ? baseName.replace(/\.[a-z0-9]+$/i, '') : '';
          if (noExt) tokens.push(noExt);
        });
        tokens = tokens.filter(function(token, tokenIndex) {
          return token && tokens.indexOf(token) === tokenIndex;
        });
      }
      var matched = previews.find(function(preview) {
        var haystack = [preview.name, preview.number, preview.title, preview.caption].map(function(value) {
          return String(value || '').trim().toLowerCase();
        }).join(' ');
        return tokens.some(function(token) { return token && haystack.indexOf(token) !== -1; });
      });
      return matched || previews[index] || null;
    }

    function isPdfWikiMetaDigitizationPanelExpanded(pdfId) {
      return !!(pdfId && pdfWikiMetaDigitizationPanelExpanded[pdfId]);
    }

    window.togglePdfWikiMetaDigitizationPanel = function(pdfId) {
      pdfId = String(pdfId || pdfWikiMetaSelectedPdfId || '');
      if (!pdfId) return;
      pdfWikiMetaDigitizationPanelExpanded[pdfId] = !isPdfWikiMetaDigitizationPanelExpanded(pdfId);
      if (pdfWikiMetaDatabaseData) renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
    };

    function renderPdfWikiFigureDigitizationPanel(selected) {
      if (!selected || !selected.detailLoaded) return '';
      var figures = getPdfWikiMetaSourceFigures(selected);
      var metaData = selected && selected.metaData && typeof selected.metaData === 'object' ? selected.metaData : {};
      var hasExplicitFigureList = Array.isArray(metaData.source_figures) || Array.isArray(metaData.sourceFigures);
      if (!figures.length && !hasExplicitFigureList && Array.isArray(selected.figurePreviews) && selected.figurePreviews.length) {
        figures = selected.figurePreviews.map(function(preview, index) {
          return {
            _index: index,
            label: preview.number || preview.title || preview.name || ('图片 ' + (index + 1)),
            title: preview.title || '',
            caption: preview.caption || '',
            page: preview.page || '',
            url: preview.url || '',
            name: preview.name || '',
            needs_manual_review: true,
            needs_digitization_with_getdata: true,
            note: 'PDF 解析阶段抽出的图片预览；尚未写入 source_figures，按待复核图件处理。'
          };
        });
      }
      var expanded = isPdfWikiMetaDigitizationPanelExpanded(selected.pdfId);
      var rows = figures.length ? figures.map(function(figure, index) {
        var label = getPdfWikiMetaFigureLabel(figure, index);
        var page = figure.page || figure.pages || figure.page_number || '';
        var needsDigitization = !!(figure.needs_digitization_with_getdata || figure.needsDigitizationWithGetdata || figure.needs_manual_review || figure.needsManualReview);
        var note = figure.note || figure.description || figure.caption || '';
        var preview = getPdfWikiMetaFigurePreview(selected, figure, index);
        var previewHtml = preview && preview.url
          ? '<button type="button" onclick="openPdfWikiDigitizationReview(\'' + escapeHtml(selected.pdfId || '') + '\',' + index + ')" style="width:112px;height:84px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-primary);padding:0;overflow:hidden;cursor:pointer;">' +
              '<img src="' + escapeHtml(preview.url || '') + '" alt="' + escapeHtml(label) + '" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:contain;display:block;">' +
            '</button>'
          : '<div style="width:112px;height:84px;border:1px dashed var(--border-color);border-radius:7px;background:var(--bg-primary);display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:11px;text-align:center;padding:8px;">未匹配到图片预览</div>';
        return '<div style="display:grid;grid-template-columns:112px 1fr auto;gap:10px;align-items:start;padding:10px 0;border-top:1px solid var(--border-color);">' +
          previewHtml +
          '<div style="min-width:0;">' +
            '<div style="font-size:12px;font-weight:700;color:var(--text-primary);line-height:1.4;word-break:break-word;">' + escapeHtml(label) + (needsDigitization ? ' <span style="font-size:10px;color:#f59e0b;">需图像数字化</span>' : '') + '</div>' +
            '<div style="margin-top:4px;font-size:11px;line-height:1.5;color:var(--text-secondary);">' + escapeHtml([page ? ('页码/位置：' + page) : '', note].filter(Boolean).join('；') || '可导入 GetData/WebPlotDigitizer 导出的坐标数据。') + '</div>' +
            (preview && preview.url ? '<div style="margin-top:6px;"><a href="' + escapeHtml(preview.url) + '" target="_blank" rel="noopener" style="font-size:11px;color:var(--accent-color);text-decoration:none;">打开原图</a></div>' : '') +
          '</div>' +
          '<button type="button" onclick="openPdfWikiDigitizationReview(\'' + escapeHtml(selected.pdfId || '') + '\',' + index + ')" style="padding:7px 10px;border:1px solid #111827 !important;border-radius:6px;background:#111827 !important;color:#ffffff !important;cursor:pointer;font-size:12px;white-space:nowrap;">复核/提取</button>' +
        '</div>';
      }).join('') : '<div style="padding-top:10px;border-top:1px solid var(--border-color);font-size:12px;color:var(--text-secondary);line-height:1.6;">当前 Meta 详情里没有 source_figures。可先用“重新提取当前PDF”让 Codex 整理图件；也可以直接导入某个图的 GetData 结果，系统会以“待复核图件”记录。</div>';

      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);margin-bottom:14px;overflow:hidden;">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 12px;">' +
          '<div style="min-width:0;">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
              '<div style="font-size:13px;font-weight:700;color:var(--text-primary);">图像数字化复核</div>' +
              '<span style="padding:2px 7px;border:1px solid var(--border-color);border-radius:999px;color:var(--text-secondary);font-size:10.5px;background:var(--bg-primary);">' + figures.length + ' 个候选图件</span>' +
              '<span style="padding:2px 7px;border:1px solid ' + (expanded ? 'rgba(16,163,127,0.35)' : 'var(--border-color)') + ';border-radius:999px;color:' + (expanded ? 'var(--accent-color)' : 'var(--text-secondary)') + ';font-size:10.5px;background:var(--bg-primary);">' + (expanded ? '已展开' : '默认折叠') + '</span>' +
            '</div>' +
            '<div style="margin-top:3px;font-size:11px;line-height:1.55;color:var(--text-secondary);">' + (expanded ? '点击“复核/提取”后可在软件内查看原图、导入 GetData 导出的 CSV/TXT/XLSX，并填写处理组、指标、单位等参数后再确认写入。' : '该区域默认折叠，避免图件列表挤占 Meta 编码表空间。需要处理图像数据时点击展开。') + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center;white-space:nowrap;">' +
            '<button type="button" onclick="togglePdfWikiMetaDigitizationPanel(\'' + escapeHtml(selected.pdfId || '') + '\')" style="padding:7px 10px;border:1px solid #111827 !important;border-radius:6px;background:#111827 !important;color:#ffffff !important;cursor:pointer;font-size:12px;">' + (expanded ? '折叠' : '展开') + '</button>' +
          '</div>' +
        '</div>' +
        (expanded ? '<div style="padding:0 12px 12px;">' + rows + '</div>' : '') +
      '</div>';
    }

    function renderPdfWikiMetaHeaderActions() {
      var buttonStyle = 'height:30px;padding:0 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:11px;white-space:nowrap;';
      var metaAnalysisButtonStyle = buttonStyle + 'border:1px solid #111827 !important;background:#111827 !important;color:#d4a017 !important;font-weight:700 !important;';
      return '' +
        '<button type="button" onclick="triggerPdfWikiMetaUpload()" style="' + buttonStyle + '">上传PDF批量提取</button>' +
        '<button type="button" onclick="exportPdfWikiMetaSelectedTables()" style="' + buttonStyle + '">导出</button>' +
        '<button type="button" onclick="deletePdfWikiMetaSelectedItems()" style="' + buttonStyle + '">删除</button>' +
        '<button type="button" onclick="openPdfWikiMetaAnalysisWizard()" style="' + metaAnalysisButtonStyle + '">进行meta分析</button>';
    }

    function renderPdfWikiMetaDatabase(data) {
      setPdfWikiWorkspaceMode('meta');
      var previousRenderedPdfId = pdfWikiMetaRenderedSelectedPdfId;
      var previousListScrollTop = getPdfWikiMetaListScrollTop();
      var previousDetailScrollTop = getPdfWikiMetaDetailScrollTop();
      var previousCodingTableScroll = getPdfWikiMetaCodingTableScrollState();
      var items = Array.isArray(data.items) ? data.items : [];
      var title = document.getElementById('pdfWikiViewerTitle');
      if (title) title.textContent = 'Meta分析';
      var subtitle = document.getElementById('pdfWikiViewerSubtitle');
      if (subtitle) subtitle.textContent = '';
      setPdfWikiViewerContextActions(renderPdfWikiMetaHeaderActions());

      var content = document.getElementById('pdfWikiViewerContent');
      if (!content) return;

      if (items.length === 0) {
        content.innerHTML =
          '<div style="height:100%;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;color:var(--text-secondary);font-size:13px;">' +
            renderPdfWikiMetaExtractionStatusBar() +
            '<div>还没有 Meta 数据。只有上传 PDF 时勾选“生成 Meta 分析数据表”的文件才会进入这里。</div>' +
            '<div style="width:min(720px,92%);">' + renderPdfWikiMetaTemplateControlsPanel(false) + '</div>' +
          '</div>';
        setTimeout(loadPdfWikiMetaTemplateStatus, 0);
        return;
      }

      var query = String(pdfWikiMetaSearchTerm || '').trim().toLowerCase();
      var visibleItems = query
        ? items.filter(function(item) {
            return getPdfWikiMetaItemSearchText(item).indexOf(query) !== -1;
          })
        : items.slice();
      if (visibleItems.length > 0 && !visibleItems.some(function(item) { return item.pdfId === pdfWikiMetaSelectedPdfId; })) {
        pdfWikiMetaSelectedPdfId = visibleItems[0].pdfId;
      }
      var selected = visibleItems.find(function(item) { return item.pdfId === pdfWikiMetaSelectedPdfId; }) || visibleItems[0] || items[0];
      pdfWikiMetaSelectedPdfId = selected ? selected.pdfId : null;
      var shouldRestoreDetailScroll = !!(selected && selected.pdfId && selected.pdfId === previousRenderedPdfId);
      pdfWikiMetaRenderedSelectedPdfId = selected ? selected.pdfId : null;
      var listRenderLimit = 400;
      var visibleItemsForRender = visibleItems.slice(0, listRenderLimit);
      var hiddenListCount = Math.max(0, visibleItems.length - visibleItemsForRender.length);
      var allVisibleItemsSelected = visibleItems.length > 0 && visibleItems.every(function(item) { return !!pdfWikiMetaSelectedDataPdfIds[item.pdfId]; });
      var someVisibleItemsSelected = visibleItems.some(function(item) { return !!pdfWikiMetaSelectedDataPdfIds[item.pdfId]; });

      var listHtml = '<table style="width:100%;border-collapse:collapse;table-layout:fixed;">' +
        '<thead><tr style="color:var(--text-secondary);font-size:11px;text-align:left;border-bottom:1px solid var(--border-color);">' +
          '<th style="padding:6px 4px;width:56px;">' +
            '<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap;">' +
              '<input id="pdfWikiMetaVisibleSelectAll" type="checkbox"' + (allVisibleItemsSelected ? ' checked' : '') + ' onchange="togglePdfWikiMetaVisiblePdfDataSelection(this.checked)" title="全选或取消全选当前列表" style="width:14px;height:14px;margin:0;accent-color:var(--accent-color);cursor:pointer;">' +
              '<span>选择</span>' +
            '</label>' +
          '</th>' +
          '<th style="padding:6px 6px;width:56%;">PDF</th>' +
          '<th style="padding:6px 6px;width:18%;">行数</th>' +
          '<th style="padding:6px 6px;width:20%;">解析</th>' +
        '</tr></thead><tbody>' +
        visibleItemsForRender.map(function(item) {
        var active = item.pdfId === pdfWikiMetaSelectedPdfId;
        var rowCount = item.dataTable && Number(item.dataTable.rowCount || 0) || 0;
        var isPlaceholderTable = !!(item.dataTable && item.dataTable.isPlaceholder);
        var rowCountText = isPlaceholderTable ? '待填写' : String(rowCount);
        var parserText = item.parser || (isPlaceholderTable ? '未完成' : 'unknown');
        var checked = !!pdfWikiMetaSelectedDataPdfIds[item.pdfId];
        return '<tr data-pdf-id="' + escapeHtml(item.pdfId) + '" onclick="selectPdfWikiMetaPdf(this.dataset.pdfId)" style="cursor:pointer;border-bottom:1px solid var(--border-color);background:' + (active ? 'rgba(16,163,127,0.12)' : 'transparent') + ';">' +
          '<td style="padding:8px 4px;vertical-align:top;text-align:center;">' +
            '<input type="checkbox" value="' + escapeHtml(item.pdfId || '') + '"' + (checked ? ' checked' : '') + ' onclick="event.stopPropagation()" onchange="setPdfWikiMetaPdfDataSelection(this.value,this.checked)" title="选择该 PDF，可导出已有整合表或重新批量提取 Meta 数据" style="width:14px;height:14px;accent-color:var(--accent-color);cursor:pointer;">' +
          '</td>' +
          '<td style="padding:8px 6px;vertical-align:top;">' +
            '<div style="font-size:12px;font-weight:700;line-height:1.35;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">' + escapeHtml(item.title || item.originalName || '未命名 PDF') + '</div>' +
            '<div style="margin-top:3px;color:var(--text-secondary);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml([item.authors, item.year].filter(Boolean).join(' · ') || item.originalName || '') + '</div>' +
          '</td>' +
          '<td style="padding:8px 6px;vertical-align:top;color:var(--text-secondary);font-size:12px;">' + escapeHtml(rowCountText) + '</td>' +
          '<td style="padding:8px 6px;vertical-align:top;color:var(--text-secondary);font-size:11px;">' + escapeHtml(parserText) + (item.needsReview ? '<br><span style="color:#f59e0b;">需核查</span>' : '') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>' +
      (hiddenListCount > 0 ? '<div style="padding:8px 4px;color:var(--text-secondary);font-size:11px;line-height:1.45;">当前匹配 ' + visibleItems.length + ' 个 PDF，页面仅渲染前 ' + listRenderLimit + ' 个；请用搜索词缩小范围。</div>' : '');

      var detailHtml = selected ? (
        '<div style="padding:18px;min-width:0;">' +
          '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px;">' +
            '<div style="min-width:0;">' +
              '<div style="font-size:18px;font-weight:700;color:var(--text-primary);line-height:1.35;word-break:break-word;">' + escapeHtml(selected.title || selected.originalName || '未命名 PDF') + '</div>' +
              '<div style="margin-top:6px;color:var(--text-secondary);font-size:12px;line-height:1.6;">' + escapeHtml(selected.originalName || '') + '</div>' +
              renderPdfWikiMetaDetailSummaryText(selected) +
            '</div>' +
            '<div style="display:flex;gap:8px;align-items:center;white-space:nowrap;">' +
              '<button type="button" onclick="openPdfWikiOriginalPdfReader(\'' + escapeHtml(selected.pdfId || '') + '\')" style="padding:8px 11px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">阅读原文</button>' +
              '<button type="button" onclick="extractCurrentPdfWikiMetaData()" style="padding:8px 11px;border:1px solid var(--accent-color);border-radius:6px;background:transparent;color:var(--accent-color);cursor:pointer;font-size:12px;">重新提取当前PDF</button>' +
              '<button type="button" onclick="reloadPdfWikiMetaDatabase(pdfWikiMetaSelectedPdfId,true)" style="padding:8px 11px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">刷新</button>' +
            '</div>' +
          '</div>' +
          renderPdfWikiMetaExtractionStatusBar() +
          renderPdfWikiFigureDigitizationPanel(selected) +
          renderPdfWikiIntegratedDataTable(selected) +
        '</div>'
      ) : '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);">请选择一个 PDF</div>';

      content.innerHTML =
        '<div style="display:grid;grid-template-columns:340px 1fr;gap:0;width:100%;height:100%;min-height:0;">' +
          '<aside style="border-right:1px solid var(--border-color);display:flex;flex-direction:column;min-height:0;">' +
            '<div style="padding:14px;border-bottom:1px solid var(--border-color);">' +
              renderPdfWikiMetaTemplateControlsPanel(true) +
              '<div id="pdfWikiMetaDatabaseSummary" style="padding:0 2px 9px;color:var(--text-secondary);font-size:11px;line-height:1.5;">Meta分析：' + items.length + ' 个 PDF，参考来源索引 ' + (data.referenceCount || 0) + ' 条</div>' +
              '<input id="pdfWikiMetaSearchInput" value="' + escapeHtml(pdfWikiMetaSearchTerm || '') + '" placeholder="搜索标题、作者、DOI、解析器、土壤指标" oninput="filterPdfWikiMetaDatabase(this.value)" style="width:100%;padding:9px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' +
            '</div>' +
            '<div id="pdfWikiMetaListScroll" onscroll="rememberPdfWikiMetaListScroll(this)" style="padding:12px;overflow:auto;min-height:0;flex:1;">' + (listHtml || '<div style="color:var(--text-secondary);font-size:13px;">没有匹配的 Meta 记录</div>') + '</div>' +
          '</aside>' +
          '<section id="pdfWikiMetaDetailScroll" style="min-width:0;min-height:0;overflow:auto;background:var(--bg-primary);">' + detailHtml + '</section>' +
        '</div>';
      var visibleSelectAll = document.getElementById('pdfWikiMetaVisibleSelectAll');
      if (visibleSelectAll) visibleSelectAll.indeterminate = someVisibleItemsSelected && !allVisibleItemsSelected;
      restorePdfWikiMetaListScroll(previousListScrollTop);
      restorePdfWikiMetaDetailScroll(shouldRestoreDetailScroll ? previousDetailScrollTop : 0);
      if (shouldRestoreDetailScroll) restorePdfWikiMetaCodingTableScroll(previousCodingTableScroll);
      setTimeout(loadPdfWikiMetaTemplateStatus, 0);
    }

    window.selectPdfWikiMetaPdf = function(pdfId) {
      rememberPdfWikiMetaListScroll(document.getElementById('pdfWikiMetaListScroll'));
      pdfWikiMetaSelectedPdfId = pdfId;
      var selected = getPdfWikiMetaItemById(pdfId);
      if (pdfWikiMetaDatabaseData && selected && selected.detailLoaded) {
        renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
      } else {
        showPdfWikiMetaDetailLoading(pdfId);
      }
      loadPdfWikiMetaDetail(pdfId).catch(function(error) {
        console.warn('[PdfWikiMeta] Failed to load detail:', error);
      });
    };

    window.filterPdfWikiMetaDatabase = function(value) {
      pdfWikiMetaSearchTerm = String(value || '');
      pdfWikiMetaListScrollTop = 0;
      if (pdfWikiMetaDatabaseData) renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
      if (pdfWikiMetaSelectedPdfId) {
        loadPdfWikiMetaDetail(pdfWikiMetaSelectedPdfId).catch(function(error) {
          console.warn('[PdfWikiMeta] Failed to load filtered detail:', error);
        });
      }
    };

    window.setPdfWikiMetaPdfDataSelection = function(pdfId, checked) {
      if (!pdfId) return;
      if (checked) {
        pdfWikiMetaSelectedDataPdfIds[pdfId] = true;
      } else {
        delete pdfWikiMetaSelectedDataPdfIds[pdfId];
      }
      if (pdfWikiMetaDatabaseData) renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
    };

    window.togglePdfWikiMetaVisiblePdfDataSelection = function(checked) {
      var items = pdfWikiMetaDatabaseData && Array.isArray(pdfWikiMetaDatabaseData.items) ? pdfWikiMetaDatabaseData.items : [];
      var query = String(pdfWikiMetaSearchTerm || '').trim().toLowerCase();
      var visibleItems = query
        ? items.filter(function(item) {
            return getPdfWikiMetaItemSearchText(item).indexOf(query) !== -1;
          })
        : items.slice();
      visibleItems.forEach(function(item) {
        if (!item.pdfId) return;
        if (checked) {
          pdfWikiMetaSelectedDataPdfIds[item.pdfId] = true;
        } else {
          delete pdfWikiMetaSelectedDataPdfIds[item.pdfId];
        }
      });
      if (pdfWikiMetaDatabaseData) renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
    };

    function getPdfWikiMetaAnalysisTargetPdfIds() {
      return getPdfWikiMetaSelectedDataPdfIds();
    }

    function showPdfWikiMetaAnalysisWizardModal(content) {
      return showModal('AI Meta 分析工作区', content, true, true, {
        overlayClass: 'app-secondary-overlay app-tertiary-overlay meta-analysis-shared-composer-overlay',
        preserveStandaloneSurfaceId: 'pdfWikiViewerModal'
      });
    }

    function borrowPdfWikiMetaSharedComposerNode(nodeId, slotId) {
      var node = document.getElementById(nodeId);
      var slot = document.getElementById(slotId);
      if (!node || !slot || !node.parentNode) return false;
      var existingEntry = pdfWikiMetaSharedComposerBorrowedNodes.find(function(entry) {
        return entry && entry.node === node;
      });
      if (existingEntry) {
        if (node.parentNode !== slot) slot.appendChild(node);
        return true;
      }
      var originalParent = node.parentNode;
      var originalNextSibling = node.nextSibling;
      var marker = document.createComment('pdf-wiki-meta-shared-composer:' + nodeId);
      originalParent.insertBefore(marker, node);
      slot.appendChild(node);
      pdfWikiMetaSharedComposerBorrowedNodes.push({
        node: node,
        nodeId: nodeId,
        marker: marker,
        originalParent: originalParent,
        originalNextSibling: originalNextSibling
      });
      return true;
    }

    function restorePdfWikiMetaSharedComposer() {
      document.body.classList.remove('meta-analysis-right-sidebar-layer-open');
      if (!pdfWikiMetaSharedComposerBorrowedNodes.length) return;
      pdfWikiMetaSharedComposerBorrowedNodes.slice().reverse().forEach(function(entry) {
        if (!entry || !entry.node) return;
        if (entry && entry.marker && entry.marker.parentNode && entry.node) {
          entry.marker.parentNode.replaceChild(entry.node, entry.marker);
          return;
        }
        if (entry.originalParent) {
          var referenceNode = entry.originalNextSibling && entry.originalNextSibling.parentNode === entry.originalParent
            ? entry.originalNextSibling
            : null;
          entry.originalParent.insertBefore(entry.node, referenceNode);
        }
        if (entry.marker && entry.marker.parentNode) {
          entry.marker.parentNode.removeChild(entry.marker);
        }
      });
      pdfWikiMetaSharedComposerBorrowedNodes = [];
      if (typeof renderMainContextSourceBar === 'function') renderMainContextSourceBar();
      if (typeof renderComposerProviderSelector === 'function') renderComposerProviderSelector();
      if (typeof renderWorkspaceDirectoryUi === 'function') renderWorkspaceDirectoryUi();
      if (typeof updateUploadedFilesPreview === 'function') updateUploadedFilesPreview();
      if (typeof syncArticleWritingProgressButtonState === 'function') syncArticleWritingProgressButtonState();
    }
    window.restorePdfWikiMetaSharedComposer = restorePdfWikiMetaSharedComposer;

    function installPdfWikiMetaSharedComposer() {
      // Meta 页面会在预检、历史切换和响应更新时多次重绘。每次安装前
      // 先完整归还上一轮节点，避免同一个主页控件被重复借用后留在已销毁的 modal 中。
      if (pdfWikiMetaSharedComposerBorrowedNodes.length) {
        restorePdfWikiMetaSharedComposer();
      }
      var sharedNodes = [
        ['uploadedFilesPreview', 'metaAnalysisComposerExtras'],
        ['experimentFigurePlanPanel', 'metaAnalysisComposerExtras'],
        ['workspaceDirectoryPanel', 'metaAnalysisComposerExtras'],
        ['uploadExperimentBtn', 'metaAnalysisComposerLeftActions'],
        ['mainContextSourceBar', 'metaAnalysisComposerLeftActions'],
        ['articleWritingProgressBtn', 'metaAnalysisComposerLeftActions'],
        ['workspaceDirectoryBtn', 'metaAnalysisComposerLeftActions'],
        ['composerProviderSelector', 'metaAnalysisComposerProviderSlot']
      ];
      sharedNodes.forEach(function(item) {
        borrowPdfWikiMetaSharedComposerNode(item[0], item[1]);
      });
      renderMainContextSourceBar();
      renderComposerProviderSelector();
      renderWorkspaceDirectoryUi();
      updateUploadedFilesPreview();
      if (typeof renderExperimentFigurePlanPanel === 'function') renderExperimentFigurePlanPanel();
      syncArticleWritingProgressButtonState();
    }

    function ensureMainComposerIntegrity() {
      var overlay = document.getElementById('modalOverlay');
      var metaComposerActive = !!(
        overlay
        && overlay.classList.contains('show')
        && overlay.classList.contains('meta-analysis-shared-composer-overlay')
      );
      if (!metaComposerActive && pdfWikiMetaSharedComposerBorrowedNodes.length) {
        restorePdfWikiMetaSharedComposer();
      }
    }
    window.ensureMainComposerIntegrity = ensureMainComposerIntegrity;

    function renderMetaAnalysisColumnOptions(columns, selected, includeEmpty) {
      var html = includeEmpty ? '<option value="">请选择字段</option>' : '';
      return html + (columns || []).map(function(column) {
        return '<option value="' + escapeHtml(column) + '"' + (column === selected ? ' selected' : '') + '>' + escapeHtml(column) + '</option>';
      }).join('');
    }

    function renderMetaAnalysisOutcomeCard(outcome, index, columns, measures, selectedSubgroups, selectedRangeRules) {
      outcome = outcome || {};
      var mapping = outcome.mapping || outcome;
      selectedSubgroups = selectedSubgroups || {};
      selectedRangeRules = selectedRangeRules || {};
      var directionValue = String(outcome.direction || '1');
      var measureOptions = (measures || []).map(function(measure) {
        var id = measure.id || measure;
        return '<option value="' + escapeHtml(id) + '"' + ((outcome.measure || 'lnRR') === id ? ' selected' : '') + '>' + escapeHtml((measure.name || id)) + '</option>';
      }).join('');
      var roleLabels = {
        '': '不参与',
        subgroupAnalysis: '参与亚组分析',
        treatmentMean: '处理组均值',
        treatmentSd: '处理组SD',
        treatmentN: '处理组n',
        controlMean: '对照组均值',
        controlSd: '对照组SD',
        controlN: '对照组n'
      };
      var selectedRoleByColumn = {};
      Object.keys(roleLabels).forEach(function(role) {
        if (!role || !mapping[role]) return;
        selectedRoleByColumn[mapping[role]] = role;
      });
      var headerRoleHtml = (columns || []).map(function(column) {
        var selectedRole = selectedRoleByColumn[column] || (selectedSubgroups[column] ? 'subgroupAnalysis' : '');
        var rangeInputClass = selectedRole === 'subgroupAnalysis' ? 'meta-header-range-input visible' : 'meta-header-range-input';
        var rangeSpec = selectedRangeRules[column] || '';
        var optionsHtml = Object.keys(roleLabels).map(function(role) {
          return '<option value="' + escapeHtml(role) + '"' + (selectedRole === role ? ' selected' : '') + '>' + escapeHtml(roleLabels[role]) + '</option>';
        }).join('');
        return '<div class="meta-header-role-card">' +
          '<div class="meta-header-role-name" title="' + escapeHtml(column) + '">' + escapeHtml(column) + '</div>' +
          '<select class="meta-header-role-select" data-meta-outcome-index="' + index + '" data-meta-column="' + escapeHtml(column) + '" onchange="handleMetaHeaderRoleChange(this)">' + optionsHtml + '</select>' +
          '<input class="' + rangeInputClass + '" data-meta-outcome-index="' + index + '" data-meta-range-column="' + escapeHtml(column) + '" value="' + escapeHtml(rangeSpec) + '" placeholder="可选范围分组：0-30=短期;30-90=中期;&gt;90=长期" oninput="syncMetaHeaderRangeRule(this)">' +
        '</div>';
      }).join('');
      var warningHtml = Array.isArray(outcome.warnings) && outcome.warnings.length
        ? '<div style="margin-top:8px;color:#f59e0b;font-size:11px;line-height:1.45;">' + outcome.warnings.map(escapeHtml).join('；') + '</div>'
        : '';
      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:12px;margin-bottom:10px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">' +
          '<label style="display:flex;align-items:center;gap:7px;font-weight:700;color:var(--text-primary);font-size:13px;min-width:0;">' +
            '<input id="metaOutcome_' + index + '_enabled" type="checkbox"' + (outcome.uiEnabled === false ? '' : ' checked') + ' style="width:14px;height:14px;accent-color:var(--accent-color);">' +
            '<span>因变量名称</span>' +
            '<input id="metaOutcome_' + index + '_label" value="' + escapeHtml(outcome.label || '') + '" placeholder="例如 N2O" style="width:150px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' +
          '</label>' +
          '<div style="font-size:11px;color:var(--text-secondary);white-space:nowrap;">完整行 ' + Number(outcome.completeRows || 0) + '/' + Number(outcome.totalRows || 0) + '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-bottom:9px;">' +
          '<label style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--text-secondary);grid-column:span 2;">' +
            '<span>效应量类型</span>' +
            '<select id="metaOutcome_' + index + '_measure" style="width:100%;padding:7px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' + measureOptions + '</select>' +
          '</label>' +
          '<label style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--text-secondary);">' +
            '<span>方向</span>' +
            '<select id="metaOutcome_' + index + '_direction" style="width:100%;padding:7px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' +
              '<option value="1"' + (directionValue !== '-1' ? ' selected' : '') + '>处理组 - 对照组</option>' +
              '<option value="-1"' + (directionValue === '-1' ? ' selected' : '') + '>反向解释</option>' +
            '</select>' +
          '</label>' +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:2px 0 7px;">' +
          '<div style="font-size:12px;font-weight:700;color:var(--text-primary);">表头用途标注</div>' +
          '<div style="font-size:11px;color:var(--text-secondary);line-height:1.4;">选择“参与亚组分析”后，可按数值范围分组，例如 0-30=短期;30-90=中期;&gt;90=长期。</div>' +
        '</div>' +
        '<div class="meta-header-role-grid">' + headerRoleHtml + '</div>' +
        warningHtml +
      '</div>';
    }

    function isPdfWikiMetaMeanOnlyMeasure(measure) {
      return measure === 'lnRR_mean_only' || measure === 'MD_mean_only';
    }

    window.handleMetaHeaderRoleChange = function(select) {
      if (!select) return;
      var role = select.value || '';
      var outcomeIndex = select.getAttribute('data-meta-outcome-index');
      if (role && role !== 'subgroupAnalysis') {
        var selector = '.meta-header-role-select[data-meta-outcome-index="' + outcomeIndex + '"]';
        Array.prototype.slice.call(document.querySelectorAll(selector)).forEach(function(other) {
          if (other !== select && other.value === role) {
            other.value = '';
          }
        });
      }
      updateMetaHeaderRangeRuleVisibility(select);
    };

    function updateMetaHeaderRangeRuleVisibility(select) {
      if (!select) return;
      var card = select.closest ? select.closest('.meta-header-role-card') : null;
      var input = card ? card.querySelector('.meta-header-range-input') : null;
      if (!input) return;
      if (select.value === 'subgroupAnalysis') {
        input.classList.add('visible');
      } else {
        input.classList.remove('visible');
        input.value = '';
        syncMetaHeaderRangeRule(input);
      }
    }

    window.syncMetaHeaderRangeRule = function(input) {
      if (!input) return;
      var column = input.getAttribute('data-meta-range-column') || '';
      if (!column) return;
      var value = input.value || '';
      Array.prototype.slice.call(document.querySelectorAll('.meta-header-range-input')).forEach(function(other) {
        if (other !== input && (other.getAttribute('data-meta-range-column') || '') === column) {
          other.value = value;
        }
      });
    };

    function ensurePdfWikiMetaAnalysisRunLog() {
      var output = document.getElementById('metaAnalysisRunResult');
      if (output) return output;
      var chat = document.getElementById('metaAnalysisAiOutput');
      if (!chat) return null;
      var messageElement = createSharedChatMessageElement(
        '<div class="meta-analysis-ai-section-head">运行日志</div><div id="metaAnalysisRunResult" class="meta-analysis-run-transcript"></div>',
        'bot',
        true,
        true
      );
      messageElement.id = 'metaAnalysisRunMessage';
      messageElement.classList.add('meta-analysis-chat-message', 'thinking-message');
      chat.appendChild(messageElement);
      return document.getElementById('metaAnalysisRunResult');
    }

    function appendPdfWikiMetaAnalysisLog(message, status) {
      var output = ensurePdfWikiMetaAnalysisRunLog();
      if (!output) return;
      var marker = status === 'error' ? '[ERROR]' : (status === 'done' ? '[DONE]' : '[INFO]');
      var time = new Date().toLocaleTimeString();
      typePdfWikiMetaAnalysisText(output, '[' + time + '] ' + marker + ' ' + message + '\n', { clear: false });
    }

    function setPdfWikiMetaAnalysisBusy(isBusy, activeButtonId) {
      ['metaAiPlanBtn', 'metaAiNewConversationBtn', 'metaAiDeleteConversationBtn', 'metaAiHistorySelect', 'metaApplyAiPlanBtn', 'metaRunBtn', 'metaRBtn', 'metaGenericAnalysisBtn', 'metaAddOutcomeBtn', 'metaDownloadEffectBtn'].forEach(function(id) {
        var button = document.getElementById(id);
        if (!button) return;
        if (!isBusy && id === 'metaApplyAiPlanBtn') {
          button.disabled = !(pdfWikiMetaAnalysisAiPlanLast && pdfWikiMetaAnalysisAiPlanLast.suggestedConfig && Array.isArray(pdfWikiMetaAnalysisAiPlanLast.suggestedConfig.outcomes) && pdfWikiMetaAnalysisAiPlanLast.suggestedConfig.outcomes.length);
        } else {
          button.disabled = !!isBusy && id !== activeButtonId;
        }
        button.style.opacity = button.disabled ? '0.55' : '1';
        button.style.cursor = button.disabled ? 'not-allowed' : 'pointer';
      });
      var sendButton = document.getElementById('metaAiPlanBtn');
      if (sendButton) {
        sendButton.classList.toggle('sending', !!isBusy);
        sendButton.classList.toggle('can-stop', !!isBusy);
        sendButton.title = isBusy ? '停止生成' : '发送';
        sendButton.setAttribute('aria-label', isBusy ? '停止生成' : '发送');
      }
      updatePdfWikiMetaPiSendButtonState();
      renderPdfWikiMetaPiQueue(pdfWikiMetaPiState);
      if (!isBusy) schedulePdfWikiMetaPiQueuePoll(120);
    }

    function getPdfWikiMetaPiSessionUrl(conversationId) {
      return '/api/chat-bridge/pi/sessions/' + encodeURIComponent(conversationId || ensurePdfWikiMetaAnalysisConversationId());
    }

    function getPdfWikiMetaProjectId() {
      return typeof getConversationHistoryProjectId === 'function'
        ? String(getConversationHistoryProjectId() || '')
        : '';
    }

    function createPdfWikiMetaPiQueuePanel() {
      var existing = document.getElementById('metaAnalysisPiQueuePanel');
      if (existing) return existing;
      var panel = document.createElement('section');
      panel.className = 'pi-queue-panel meta-analysis-running-strip';
      panel.id = 'metaAnalysisPiQueuePanel';
      panel.hidden = true;
      panel.setAttribute('aria-live', 'polite');
      panel.innerHTML = '<div class="pi-queue-head">' +
        '<div class="pi-queue-title">' +
          '<span class="pi-queue-live-dot" aria-hidden="true"></span>' +
          '<span id="metaAnalysisPiQueueTitle">运行中 · 可继续输入</span>' +
        '</div>' +
      '</div>' +
      '<div class="pi-queue-items" id="metaAnalysisPiQueueItems"></div>';
      return panel;
    }

    function attachPdfWikiMetaPiQueuePanelToMessage(messageElement) {
      if (!messageElement || !messageElement.classList || !messageElement.classList.contains('bot')) return null;
      if (pdfWikiMetaPiQueueHostMessage && pdfWikiMetaPiQueueHostMessage !== messageElement) {
        pdfWikiMetaPiQueueHostMessage.classList.remove('pi-agent-message');
      }
      var content = messageElement.querySelector('.content');
      if (!content) return null;
      var panel = createPdfWikiMetaPiQueuePanel();
      messageElement.insertBefore(panel, content);
      pdfWikiMetaPiQueueHostMessage = messageElement;
      renderPdfWikiMetaPiQueue(pdfWikiMetaPiState);
      return panel;
    }

    function resetPdfWikiMetaPiQueueHost() {
      if (pdfWikiMetaPiQueueHostMessage) pdfWikiMetaPiQueueHostMessage.classList.remove('pi-agent-message');
      pdfWikiMetaPiQueueHostMessage = null;
      var panel = document.getElementById('metaAnalysisPiQueuePanel');
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    }

    function getPdfWikiMetaPiQueueItemPrefix(behavior) {
      return behavior === 'steer' ? '转向当前任务：' : '后续执行：';
    }

    window.setPdfWikiMetaPiQueueBehavior = function(behavior) {
      pdfWikiMetaPiQueueBehavior = behavior === 'steer' ? 'steer' : 'follow_up';
      localStorage.setItem('scholarharness_meta_pi_queue_behavior', pdfWikiMetaPiQueueBehavior);
      renderPdfWikiMetaPiQueue(pdfWikiMetaPiState);
    };

    window.updatePdfWikiMetaPiSendButtonState = function() {
      var button = document.getElementById('metaAiPlanBtn');
      var input = document.getElementById('metaAiUserRequest');
      if (!button) return;
      var running = !!pdfWikiMetaAnalysisAiAbortController;
      var hasDraft = !!(input && String(input.value || '').trim());
      button.classList.toggle('queue-ready', running && hasDraft);
      if (running && hasDraft) {
        button.title = pdfWikiMetaPiQueueBehavior === 'steer' ? '转向当前 Meta Agent' : '加入 Meta 后续队列';
        button.setAttribute('aria-label', button.title);
      } else if (running) {
        button.title = '停止生成';
        button.setAttribute('aria-label', '停止生成');
      } else {
        button.title = '发送';
        button.setAttribute('aria-label', '发送');
      }
    };

    function renderPdfWikiMetaPiQueueItems(pending) {
      var container = document.getElementById('metaAnalysisPiQueueItems');
      if (!container) return;
      container.innerHTML = '';
      (Array.isArray(pending) ? pending : []).filter(function(item) {
        return item && item.status !== 'processing' && item.status !== 'applied' && item.status !== 'cancelled';
      }).forEach(function(item) {
        var row = document.createElement('div');
        row.className = 'pi-queue-item';
        row.dataset.queueId = String(item.id || '');
        var text = document.createElement('div');
        text.className = 'pi-queue-item-text';
        var prefix = document.createElement('span');
        prefix.className = 'pi-queue-item-prefix';
        prefix.textContent = getPdfWikiMetaPiQueueItemPrefix(item.behavior);
        var message = document.createElement('span');
        message.className = 'pi-queue-item-message';
        message.textContent = String(item.message || '');
        text.appendChild(prefix);
        text.appendChild(message);
        row.appendChild(text);
        var actions = document.createElement('span');
        actions.className = 'pi-queue-item-actions';
        var editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.textContent = '编辑';
        editButton.onclick = function(event) {
          event.stopPropagation();
          editPdfWikiMetaPiQueuedMessage(String(item.id || ''));
        };
        var cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.textContent = '撤回';
        cancelButton.onclick = function(event) {
          event.stopPropagation();
          cancelPdfWikiMetaPiQueuedMessage(String(item.id || ''));
        };
        actions.appendChild(editButton);
        actions.appendChild(cancelButton);
        row.appendChild(actions);
        container.appendChild(row);
      });
    }

    function renderPdfWikiMetaPiQueue(state) {
      if (pdfWikiMetaPiQueueHostMessage && !document.documentElement.contains(pdfWikiMetaPiQueueHostMessage)) {
        pdfWikiMetaPiQueueHostMessage = null;
      }
      if (!pdfWikiMetaPiQueueHostMessage) return;
      var panel = document.getElementById('metaAnalysisPiQueuePanel') || createPdfWikiMetaPiQueuePanel();
      var title = document.getElementById('metaAnalysisPiQueueTitle');
      if (!panel) return;
      var pending = state && Array.isArray(state.pending) ? state.pending : [];
      var displayedPending = pending.filter(function(item) {
        return item && item.status !== 'processing' && item.status !== 'applied' && item.status !== 'cancelled';
      });
      var running = !!pdfWikiMetaAnalysisAiAbortController;
      var hasRunningTranscript = !!(
        pdfWikiMetaPiQueueHostMessage
        && pdfWikiMetaPiQueueHostMessage.querySelector('.agent-transcript.is-running')
      );
      // Keep the Meta Agent state transition identical to the homepage:
      // the compact strip is the initial thinking indicator, then the real
      // execution transcript replaces it as soon as Running output arrives.
      var visible = !!pdfWikiMetaPiQueueHostMessage && (
        displayedPending.length > 0
        || (running && !hasRunningTranscript)
      );
      panel.hidden = !visible;
      if (pdfWikiMetaPiQueueHostMessage) pdfWikiMetaPiQueueHostMessage.classList.toggle('pi-agent-message', visible);
      panel.classList.toggle('running', running);
      renderPdfWikiMetaPiQueueItems(displayedPending);
      if (title) {
        var steerCount = displayedPending.filter(function(item) { return item.behavior === 'steer'; }).length;
        var followUpCount = displayedPending.filter(function(item) { return item.behavior !== 'steer'; }).length;
        title.textContent = (running ? '运行中' : '会话待继续')
          + (displayedPending.length ? ' · 转向 ' + steerCount + ' / 后续 ' + followUpCount : ' · 可继续输入');
      }
      window.updatePdfWikiMetaPiSendButtonState();
    }

    function updatePdfWikiMetaPiHistoryStatus(item, status) {
      if (!item || !item.id) return;
      var message = pdfWikiMetaAnalysisChatHistory.find(function(entry) {
        return entry && entry.piQueueId === item.id;
      });
      if (!message) return;
      message.piStatus = status || item.status || '';
      if (item.message) message.content = item.message;
      persistCurrentPdfWikiMetaAiConversation();
    }

    function schedulePdfWikiMetaPiQueuePoll(delay) {
      if (pdfWikiMetaPiPollTimer) clearTimeout(pdfWikiMetaPiPollTimer);
      var hasPending = !!(pdfWikiMetaPiState && Number(pdfWikiMetaPiState.pendingMessageCount || 0) > 0);
      if (!pdfWikiMetaAnalysisAiAbortController && !hasPending) {
        pdfWikiMetaPiPollTimer = null;
        return;
      }
      pdfWikiMetaPiPollTimer = setTimeout(function() {
        pdfWikiMetaPiPollTimer = null;
        syncPdfWikiMetaPiQueueState({ claimWhenIdle: true });
      }, Math.max(300, Number(delay || 800)));
    }

    async function syncPdfWikiMetaPiQueueState(options) {
      options = options || {};
      if (!pdfWikiMetaAnalysisConversationId || pdfWikiMetaPiSyncInFlight) return false;
      pdfWikiMetaPiSyncInFlight = true;
      try {
        var response = await fetch(getPdfWikiMetaPiSessionUrl(pdfWikiMetaAnalysisConversationId) + '?userId=' + encodeURIComponent(currentUserId || 'web-user') + '&projectId=' + encodeURIComponent(getPdfWikiMetaProjectId()));
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success || !result.state) throw new Error(result.error || ('HTTP ' + response.status));
        pdfWikiMetaPiState = result.state;
        (result.state.pending || []).forEach(function(item) { updatePdfWikiMetaPiHistoryStatus(item, item.status); });
        (result.state.recent || []).forEach(function(item) { updatePdfWikiMetaPiHistoryStatus(item, item.status); });
        renderPdfWikiMetaPiQueue(result.state);
        if (options.claimWhenIdle && !pdfWikiMetaAnalysisAiAbortController) {
          await claimNextPdfWikiMetaPiMessage();
        }
        schedulePdfWikiMetaPiQueuePoll();
        return true;
      } catch (error) {
        console.warn('[MetaPi] Queue state sync failed:', error);
        renderPdfWikiMetaPiQueue(pdfWikiMetaPiState);
        return false;
      } finally {
        pdfWikiMetaPiSyncInFlight = false;
      }
    }

    async function claimNextPdfWikiMetaPiMessage() {
      if (pdfWikiMetaAnalysisAiAbortController || pdfWikiMetaPiClaimInFlight || pdfWikiMetaPiContinuationStarting || !pdfWikiMetaAnalysisConversationId) return null;
      pdfWikiMetaPiClaimInFlight = true;
      try {
        var response = await fetch(getPdfWikiMetaPiSessionUrl(pdfWikiMetaAnalysisConversationId) + '/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId || 'web-user', projectId: getPdfWikiMetaProjectId() || undefined })
        });
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success) throw new Error(result.error || ('HTTP ' + response.status));
        pdfWikiMetaPiState = result.state || pdfWikiMetaPiState;
        renderPdfWikiMetaPiQueue(pdfWikiMetaPiState);
        if (!result.item) return null;
        updatePdfWikiMetaPiHistoryStatus(result.item, 'processing');
        pdfWikiMetaPiContinuationStarting = true;
        Promise.resolve(window.runPdfWikiMetaAnalysisAiPlan(result.item)).catch(function(error) {
          console.warn('[MetaPi] Queued continuation failed:', error);
        }).finally(function() {
          pdfWikiMetaPiContinuationStarting = false;
        });
        return result.item;
      } catch (error) {
        console.warn('[MetaPi] Failed to claim queued message:', error);
        return null;
      } finally {
        pdfWikiMetaPiClaimInFlight = false;
      }
    }

    async function enqueuePdfWikiMetaPiMessage(message, behavior) {
      var conversationId = ensurePdfWikiMetaAnalysisConversationId();
      var chatAttachments = [];
      if (pendingExperimentFiles.length > 0) {
        chatAttachments = await uploadPendingFilesAsChatAttachments();
      }
      var workspaceFiles = getSelectedWorkspacePreviewFiles();
      var response = await fetch(getPdfWikiMetaPiSessionUrl(conversationId) + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId || 'web-user',
          projectId: getPdfWikiMetaProjectId() || undefined,
          message: message,
          behavior: behavior === 'steer' ? 'steer' : 'follow_up',
          chatAttachments: chatAttachments,
          workspaceFileMentions: workspaceFiles
        })
      });
      var result = await response.json().catch(function() { return {}; });
      if (!response.ok || !result.success || !result.item) throw new Error(result.error || ('HTTP ' + response.status));
      pdfWikiMetaPiState = result.state || pdfWikiMetaPiState;
      pdfWikiMetaAnalysisChatHistory.push({
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
        piQueueId: result.item.id,
        piBehavior: result.item.behavior,
        piStatus: result.item.status
      });
      pdfWikiMetaAnalysisRecentQueries.push(message);
      persistCurrentPdfWikiMetaAiConversation();
      var output = document.getElementById('metaAnalysisAiOutput');
      if (pdfWikiMetaAnalysisAiAbortController && output) {
        var queuedMessageElement = createSharedChatMessageElement(message, 'user', false, false);
        queuedMessageElement.classList.add('meta-analysis-chat-message');
        queuedMessageElement.setAttribute('data-meta-pi-queue-id', String(result.item.id || ''));
        output.appendChild(queuedMessageElement);
        output.scrollTop = output.scrollHeight;
      } else {
        renderPdfWikiMetaAnalysisChat();
      }
      renderPdfWikiMetaPiQueue(pdfWikiMetaPiState);
      if (workspaceFiles.length > 0) clearWorkspacePreviewSelections();
      schedulePdfWikiMetaPiQueuePoll();
      return result.item;
    }

    window.editPdfWikiMetaPiQueuedMessage = async function(messageId) {
      var item = pdfWikiMetaPiState && Array.isArray(pdfWikiMetaPiState.pending)
        ? pdfWikiMetaPiState.pending.find(function(candidate) { return candidate && candidate.id === messageId; })
        : null;
      if (!item) return;
      var nextMessage = window.prompt('编辑排队消息', String(item.message || ''));
      if (nextMessage === null || !String(nextMessage).trim()) return;
      try {
        var response = await fetch(getPdfWikiMetaPiSessionUrl(pdfWikiMetaAnalysisConversationId) + '/messages/' + encodeURIComponent(messageId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId || 'web-user', projectId: getPdfWikiMetaProjectId() || undefined, message: String(nextMessage).trim() })
        });
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success) throw new Error(result.error || ('HTTP ' + response.status));
        pdfWikiMetaPiState = result.state || pdfWikiMetaPiState;
        updatePdfWikiMetaPiHistoryStatus(result.item, result.item && result.item.status);
        var queuedElement = document.querySelector('[data-meta-pi-queue-id="' + CSS.escape(messageId) + '"] .content');
        if (pdfWikiMetaAnalysisAiAbortController && queuedElement) {
          queuedElement.textContent = String(result.item && result.item.message || nextMessage);
        } else {
          renderPdfWikiMetaAnalysisChat();
        }
        renderPdfWikiMetaPiQueue(pdfWikiMetaPiState);
      } catch (error) {
        alert('编辑 Meta 排队消息失败：' + (error.message || String(error)));
      }
    };

    window.cancelPdfWikiMetaPiQueuedMessage = async function(messageId) {
      try {
        var response = await fetch(getPdfWikiMetaPiSessionUrl(pdfWikiMetaAnalysisConversationId) + '/messages/' + encodeURIComponent(messageId) + '?userId=' + encodeURIComponent(currentUserId || 'web-user') + '&projectId=' + encodeURIComponent(getPdfWikiMetaProjectId()), {
          method: 'DELETE'
        });
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success) throw new Error(result.error || ('HTTP ' + response.status));
        pdfWikiMetaPiState = result.state || pdfWikiMetaPiState;
        pdfWikiMetaAnalysisChatHistory = pdfWikiMetaAnalysisChatHistory.filter(function(message) {
          return !message || message.piQueueId !== messageId;
        });
        persistCurrentPdfWikiMetaAiConversation();
        var queuedElement = document.querySelector('[data-meta-pi-queue-id="' + CSS.escape(messageId) + '"]');
        if (queuedElement && queuedElement.parentNode) queuedElement.parentNode.removeChild(queuedElement);
        if (!pdfWikiMetaAnalysisAiAbortController) renderPdfWikiMetaAnalysisChat();
        renderPdfWikiMetaPiQueue(pdfWikiMetaPiState);
      } catch (error) {
        alert('撤回 Meta 排队消息失败：' + (error.message || String(error)));
      }
    };

    function pumpPdfWikiMetaAnalysisTypewriter() {
      if (pdfWikiMetaAnalysisTypeTimer || !pdfWikiMetaAnalysisTypeQueue.length) return;
      var item = pdfWikiMetaAnalysisTypeQueue.shift();
      var element = item && item.element;
      if (!element) {
        pumpPdfWikiMetaAnalysisTypewriter();
        return;
      }
      element.style.display = 'block';
      var index = 0;
      var source = String(item.text || '');
      pdfWikiMetaAnalysisTypeTimer = setInterval(function() {
        var step = source.length > 3000 ? 14 : 6;
        element.textContent += source.slice(index, index + step);
        index += step;
        element.scrollTop = element.scrollHeight;
        if (index >= source.length) {
          clearInterval(pdfWikiMetaAnalysisTypeTimer);
          pdfWikiMetaAnalysisTypeTimer = null;
          pumpPdfWikiMetaAnalysisTypewriter();
        }
      }, 12);
    }

    function typePdfWikiMetaAnalysisText(element, text, options) {
      if (!element) return;
      var clear = !options || options.clear !== false;
      if (clear) {
        if (pdfWikiMetaAnalysisTypeTimer) {
          clearInterval(pdfWikiMetaAnalysisTypeTimer);
          pdfWikiMetaAnalysisTypeTimer = null;
        }
        pdfWikiMetaAnalysisTypeQueue = [];
        element.textContent = '';
      }
      element.style.display = 'block';
      if (clear && element.scrollIntoView) {
        setTimeout(function() {
          try { element.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { element.scrollIntoView(); }
        }, 0);
      }
      pdfWikiMetaAnalysisTypeQueue.push({ element: element, text: String(text || '') });
      pumpPdfWikiMetaAnalysisTypewriter();
    }

    function stopPdfWikiMetaAiPendingLogs() {
      if (pdfWikiMetaAiPendingLogTimer) {
        clearInterval(pdfWikiMetaAiPendingLogTimer);
        pdfWikiMetaAiPendingLogTimer = null;
      }
      if (pdfWikiMetaAiPendingElapsedTimer) {
        clearInterval(pdfWikiMetaAiPendingElapsedTimer);
        pdfWikiMetaAiPendingElapsedTimer = null;
      }
      if (pdfWikiMetaAiPendingTypeTimer) {
        clearInterval(pdfWikiMetaAiPendingTypeTimer);
        pdfWikiMetaAiPendingTypeTimer = null;
      }
    }

    function formatPdfWikiMetaAiPendingElapsed(ms) {
      var total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
      var minutes = String(Math.floor(total / 60)).padStart(2, '0');
      var seconds = String(total % 60).padStart(2, '0');
      return minutes + ':' + seconds;
    }

    function updatePdfWikiMetaAiPendingElapsed() {
      var elapsedEl = document.getElementById('metaAnalysisAiPendingElapsed');
      if (!elapsedEl || !pdfWikiMetaAiPendingStartedAt) return;
      elapsedEl.textContent = formatPdfWikiMetaAiPendingElapsed(Date.now() - pdfWikiMetaAiPendingStartedAt);
    }

    function initPdfWikiMetaAiPendingLog() {
      var logEl = document.getElementById('metaAnalysisAiPendingLog');
      if (!logEl) return null;
      if (!logEl.dataset.initialized) {
        logEl.innerHTML =
          '<div class="meta-analysis-ai-pending-log">' +
            '<div class="meta-analysis-ai-pending-head">' +
              '<span>运行日志</span>' +
              '<span>已运行 <span id="metaAnalysisAiPendingElapsed">00:00</span></span>' +
            '</div>' +
            '<div class="meta-analysis-ai-pending-current">' +
              '<span class="meta-analysis-ai-pending-dot"></span>' +
              '<div>' +
                '<div class="meta-analysis-ai-pending-label">最新动态</div>' +
                '<div id="metaAnalysisAiPendingCurrentLine"></div>' +
              '</div>' +
            '</div>' +
            '<div id="metaAnalysisAiPendingSteps" class="meta-analysis-ai-pending-steps"></div>' +
            '<div class="meta-analysis-ai-pending-foot">AI 正在副本上判断列角色、处理对照关系、单位换算和可执行的 R 分析方案。</div>' +
          '</div>';
        logEl.dataset.initialized = '1';
      }
      return logEl;
    }

    function renderPdfWikiMetaAiPendingSteps() {
      var stepsEl = document.getElementById('metaAnalysisAiPendingSteps');
      if (!stepsEl) return;
      var recent = pdfWikiMetaAiPendingSteps.slice(-12).reverse();
      stepsEl.innerHTML = recent.map(function(item) {
        return '<div class="meta-analysis-ai-pending-step">' +
          '<span class="meta-analysis-ai-pending-time">' + escapeHtml(item.time || '') + '</span>' +
          '<span>' + escapeHtml(item.text || '') + '</span>' +
        '</div>';
      }).join('');
    }

    function typePdfWikiMetaAiPendingCurrent(text) {
      var lineEl = document.getElementById('metaAnalysisAiPendingCurrentLine');
      if (!lineEl) return;
      text = String(text || '');
      if (pdfWikiMetaAiPendingTypeTimer) {
        clearInterval(pdfWikiMetaAiPendingTypeTimer);
        pdfWikiMetaAiPendingTypeTimer = null;
      }
      if (/^等待 AI 返回/.test(text)) {
        lineEl.textContent = text;
        return;
      }
      lineEl.textContent = '';
      var index = 0;
      pdfWikiMetaAiPendingTypeTimer = setInterval(function() {
        lineEl.textContent += text.slice(index, index + 2);
        index += 2;
        if (index >= text.length) {
          clearInterval(pdfWikiMetaAiPendingTypeTimer);
          pdfWikiMetaAiPendingTypeTimer = null;
        }
      }, 18);
    }

    function appendPdfWikiMetaAiPendingLog(line) {
      var logEl = initPdfWikiMetaAiPendingLog();
      if (!logEl) return;
      var text = String(line || '');
      if (!/^等待 AI 返回/.test(text)) {
        pdfWikiMetaAiPendingSteps.push({
          time: new Date().toLocaleTimeString(),
          text: text
        });
        renderPdfWikiMetaAiPendingSteps();
      }
      typePdfWikiMetaAiPendingCurrent(text);
      updatePdfWikiMetaAiPendingElapsed();
    }

    function startPdfWikiMetaAiPendingLogs() {
      stopPdfWikiMetaAiPendingLogs();
      pdfWikiMetaAiPendingStartedAt = Date.now();
      pdfWikiMetaAiPendingSteps = [];
      initPdfWikiMetaAiPendingLog();
      updatePdfWikiMetaAiPendingElapsed();
      pdfWikiMetaAiPendingElapsedTimer = setInterval(updatePdfWikiMetaAiPendingElapsed, 1000);
      var lines = [
        '读取已勾选 PDF 的 Meta 编码表副本',
        '合并多 PDF / 多 sheet 数据并生成结构化 JSON 数据包',
        '统计每个表头的类型、单位、缺失率、唯一值和样例值',
        '预检 mean、SD/SE、n 的候选组合，检查 mean±SD/SE 混写',
        '识别 CK/control 与 treatment 处理水平',
        '筛选可用于亚组分析和元回归的处理、年份、作物等自变量',
        '检查单位换算、范围值取中点、重复行和无效效应量风险',
        '生成副本整理建议、效应量合并思路和 R 作图草案'
      ];
      var index = 0;
      var waitTick = 0;
      appendPdfWikiMetaAiPendingLog(lines[index]);
      index += 1;
      pdfWikiMetaAiPendingLogTimer = setInterval(function() {
        if (index < lines.length) {
          appendPdfWikiMetaAiPendingLog(lines[index]);
          index += 1;
        } else {
          waitTick += 1;
          appendPdfWikiMetaAiPendingLog('等待 AI 返回' + '.'.repeat((waitTick % 3) + 1) + ' 已运行 ' + formatPdfWikiMetaAiPendingElapsed(Date.now() - pdfWikiMetaAiPendingStartedAt));
        }
      }, 1400);
    }

    function appendPdfWikiMetaAiServerLogs(logs) {
      if (!Array.isArray(logs) || !logs.length) return;
      var pending = document.getElementById('metaAnalysisAiPendingLog');
      if (!pending) return;
      typePdfWikiMetaAnalysisText(pending, '\n后端处理日志：\n' + logs.map(function(line) { return '- ' + line; }).join('\n') + '\n', { clear: false });
    }

    function setPdfWikiMetaAnalysisStatusText(text) {
      var resultDiv = ensurePdfWikiMetaAnalysisRunLog();
      if (!resultDiv) return;
      typePdfWikiMetaAnalysisText(resultDiv, String(text || '') + '\n', { clear: true });
    }

    function formatPdfWikiMetaSkippedRowsDiagnostic(metaData) {
      var rows = metaData && Array.isArray(metaData.skippedRows) ? metaData.skippedRows : [];
      if (!rows.length) return '';
      var counts = {};
      rows.forEach(function(row) {
        var reason = row && row.reason ? String(row.reason) : '未知原因';
        counts[reason] = (counts[reason] || 0) + 1;
      });
      var reasonLines = Object.keys(counts)
        .sort(function(a, b) { return counts[b] - counts[a]; })
        .slice(0, 8)
        .map(function(reason) { return '- ' + reason + '：' + counts[reason] + ' 行'; });
      var examples = rows.slice(0, 8).map(function(row) {
        return '- 第 ' + (row.rowIndex || '?') + ' 行' +
          (row.studyId ? ' / ' + row.studyId : '') +
          '：' + (row.reason || '未知原因');
      });
      var skippedCount = Number(metaData.skippedCount || rows.length || 0);
      return '\n跳过原因诊断（后端返回前 ' + rows.length + ' 条，共 ' + skippedCount + ' 条）：\n' +
        reasonLines.join('\n') +
        (examples.length ? '\n\n示例行：\n' + examples.join('\n') : '') +
        '\n\n常见修正：均值列只选均值；SD列只选SD/SE换算后的SD；n列必须是样本量；lnRR要求处理组和对照组均值都大于0。';
    }

    function formatMetaAiConfidence(value) {
      var numeric = Number(value);
      if (!isFinite(numeric)) return '';
      if (numeric <= 1) numeric = numeric * 100;
      return '（置信度 ' + Math.max(0, Math.min(100, Math.round(numeric))) + '%）';
    }

    function formatMetaAiArrayValues(values, limit) {
      if (!Array.isArray(values)) return '';
      return values.slice(0, limit || 8).map(function(value) { return String(value || '').trim(); }).filter(Boolean).join('、');
    }

    function formatMetaAiUnderstandingSection(understanding) {
      if (!understanding || typeof understanding !== 'object') return '';
      var lines = ['\nAI 对数据表的自动判断：'];
      var dependent = Array.isArray(understanding.dependentVariables) ? understanding.dependentVariables : [];
      var independent = Array.isArray(understanding.independentVariables) ? understanding.independentVariables : [];
      var controls = Array.isArray(understanding.controlGroups) ? understanding.controlGroups : [];
      var treatments = Array.isArray(understanding.treatmentGroups) ? understanding.treatmentGroups : [];
      var merges = Array.isArray(understanding.mergeCandidates) ? understanding.mergeCandidates : [];
      var lowQuestions = Array.isArray(understanding.lowConfidenceQuestions) ? understanding.lowConfidenceQuestions : [];

      lines.push('\n因变量 / 结果变量：');
      if (dependent.length) {
        dependent.slice(0, 8).forEach(function(item) {
          var columns = item && item.columns && typeof item.columns === 'object' ? item.columns : {};
          var mapped = ['treatmentMean', 'treatmentSd', 'treatmentN', 'controlMean', 'controlSd', 'controlN']
            .map(function(role) { return columns[role] ? role + '=' + columns[role] : ''; })
            .filter(Boolean)
            .join('；');
          lines.push('- ' + (item.label || item.column || '未命名因变量') + (item.measure ? ' · ' + item.measure : '') + formatMetaAiConfidence(item.confidence) + (mapped ? '：' + mapped : ''));
          if (item.reason) lines.push('  理由：' + item.reason);
        });
      } else {
        lines.push('- 还没有高置信因变量判断，需要先整理副本或补充需求。');
      }

      if (independent.length) {
        lines.push('\n自变量 / 亚组 / 调节变量：');
        independent.slice(0, 12).forEach(function(item) {
          lines.push('- ' + (item.column || '未命名列') + (item.type ? ' · ' + item.type : '') + formatMetaAiConfidence(item.confidence) + (item.reason ? '：' + item.reason : ''));
        });
      }

      if (controls.length) {
        lines.push('\nCK / Control 判断：');
        controls.slice(0, 8).forEach(function(item) {
          lines.push('- ' + (item.column || '分组列') + '：' + formatMetaAiArrayValues(item.values, 10) + formatMetaAiConfidence(item.confidence) + (item.reason ? '；' + item.reason : ''));
        });
      }

      if (treatments.length) {
        lines.push('\nTreatment 判断：');
        treatments.slice(0, 8).forEach(function(item) {
          lines.push('- ' + (item.column || '分组列') + '：' + formatMetaAiArrayValues(item.values, 12) + formatMetaAiConfidence(item.confidence) + (item.reason ? '；' + item.reason : ''));
        });
      }

      if (merges.length) {
        lines.push('\n需要合并 / 拆分 / 换算的列：');
        merges.slice(0, 12).forEach(function(item) {
          var columns = formatMetaAiArrayValues(item.columns, 8);
          lines.push('- ' + (item.operation || '整理') + ' → ' + (item.target || columns || '目标列') + formatMetaAiConfidence(item.confidence) + (columns ? '；相关列：' + columns : ''));
          if (item.reason) lines.push('  理由：' + item.reason);
        });
      }

      if (lowQuestions.length) {
        lines.push('\n低置信待确认：');
        lowQuestions.slice(0, 8).forEach(function(item) { lines.push('- ' + item); });
      }

      return lines.join('\n');
    }

    function buildPdfWikiMetaAnalysisAiPlanText(plan) {
      if (!plan) return '';
      var workspace = plan.workspace || {};
      var dataset = workspace.dataset || {};
      var lines = [];
      lines.push('模型链路：' + (plan.provider || '本地规则') + (plan.workflowStage ? '；阶段：' + plan.workflowStage : ''));
      if (plan.usage && Number(plan.usage.inputTokens) > 0) {
        var metaUsage = plan.usage;
        var metaTotalInput = Number(metaUsage.inputTokens) + (metaUsage.cacheReadTokens !== undefined ? Number(metaUsage.cacheReadTokens) : 0);
        var metaCachePart = metaUsage.cacheReadTokens !== undefined && metaTotalInput > 0
          ? ' · 缓存命中 ' + Math.round((Number(metaUsage.cacheReadTokens) / metaTotalInput) * 100) + '%'
          : '';
        lines.push('Token 用量：输入 ' + Number(metaUsage.inputTokens).toLocaleString() + ' · 输出 ' + Number(metaUsage.outputTokens || 0).toLocaleString() + metaCachePart);
      }
      if (workspace.id) {
        lines.push('副本工作区：' + workspace.id + '；行 ' + Number(dataset.rowCount || 0) + '，列 ' + Number(dataset.columnCount || 0) + '。');
      }
      if (plan.assistantMessage) lines.push('\n' + plan.assistantMessage);
      if (Array.isArray(plan.progressLogs) && plan.progressLogs.length) {
        lines.push('\n后端处理日志：');
        plan.progressLogs.slice(0, 10).forEach(function(item) { lines.push('- ' + item); });
      }
      var understandingText = formatMetaAiUnderstandingSection(plan.dataUnderstanding);
      if (understandingText) lines.push(understandingText);
      if (plan.rPlan && typeof plan.rPlan === 'object') {
        var rPlan = plan.rPlan;
        var plots = Array.isArray(rPlan.plots) ? rPlan.plots : [];
        var diagnostics = Array.isArray(rPlan.diagnostics) ? rPlan.diagnostics : [];
        var packages = Array.isArray(rPlan.packages) ? rPlan.packages : [];
        lines.push('\n确认副本后 R 出图草案：');
        if (packages.length) lines.push('- R 包：' + packages.join(', '));
        if (plots.length) lines.push('- 图表：' + plots.join(', '));
        if (diagnostics.length) lines.push('- 诊断：' + diagnostics.join(', '));
      }
      if (Array.isArray(plan.warnings) && plan.warnings.length) {
        lines.push('\n警告：');
        plan.warnings.slice(0, 6).forEach(function(item) { lines.push('- ' + item); });
      }
      if (Array.isArray(plan.questions) && plan.questions.length) {
        lines.push('\n需要确认：');
        plan.questions.slice(0, 6).forEach(function(item) { lines.push('- ' + item); });
      }
      return lines.join('\n');
    }

    function createPdfWikiMetaAnalysisConversationId() {
      return 'meta_ai_chat_' + Date.now() + '_' + Math.random().toString(16).slice(2, 10);
    }

    function getPdfWikiMetaAiHistoryStorageKey() {
      return PDF_WIKI_META_AI_HISTORY_KEY + '_' + (currentUserId || 'web-user');
    }

    function loadPdfWikiMetaAiConversationHistory() {
      try {
        var raw = localStorage.getItem(getPdfWikiMetaAiHistoryStorageKey());
        var parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter(function(item) { return item && item.id; }) : [];
      } catch (error) {
        return [];
      }
    }

    function savePdfWikiMetaAiConversationHistory(history) {
      try {
        localStorage.setItem(getPdfWikiMetaAiHistoryStorageKey(), JSON.stringify(history || []));
      } catch (error) {
        console.warn('[MetaAI] Failed to save conversation history:', error);
      }
    }

    function buildPdfWikiMetaAiConversationTitle(messages) {
      var firstUser = (messages || []).find(function(message) { return message && message.role === 'user' && message.content; });
      var text = firstUser ? String(firstUser.content || '').replace(/\s+/g, ' ').trim() : '';
      return text ? (text.length > 34 ? text.slice(0, 34) + '...' : text) : '未命名 Meta 对话';
    }

    function persistCurrentPdfWikiMetaAiConversation(extra) {
      if (!pdfWikiMetaAnalysisConversationId) return;
      var history = loadPdfWikiMetaAiConversationHistory();
      var now = new Date().toISOString();
      var existing = history.find(function(item) { return item.id === pdfWikiMetaAnalysisConversationId; }) || {};
      var next = Object.assign({}, existing, extra || {}, {
        id: pdfWikiMetaAnalysisConversationId,
        title: (extra && extra.title) || existing.title || buildPdfWikiMetaAiConversationTitle(pdfWikiMetaAnalysisChatHistory),
        updatedAt: now,
        createdAt: existing.createdAt || now,
        messages: pdfWikiMetaAnalysisChatHistory || [],
        recentQueries: pdfWikiMetaAnalysisRecentQueries || []
      });
      history = [next].concat(history.filter(function(item) { return item.id !== next.id; }));
      savePdfWikiMetaAiConversationHistory(history);
      renderPdfWikiMetaAiConversationHistorySelect();
    }

    function renderPdfWikiMetaAiConversationHistorySelect() {
      var select = document.getElementById('metaAiHistorySelect');
      if (!select) return;
      var history = loadPdfWikiMetaAiConversationHistory();
      var hasActiveConversation = history.some(function(item) {
        return item.id === pdfWikiMetaAnalysisConversationId;
      });
      var options = ['<option value="" disabled hidden' + (hasActiveConversation ? '' : ' selected') + '>历史对话</option>'];
      history.forEach(function(item) {
        var active = item.id === pdfWikiMetaAnalysisConversationId ? ' selected' : '';
        var suffix = item.lastProvider ? ' · ' + item.lastProvider : '';
        options.push('<option value="' + escapeHtml(item.id) + '"' + active + '>' + escapeHtml((item.title || '未命名 Meta 对话') + suffix) + '</option>');
      });
      select.innerHTML = options.join('');
      var deleteButton = document.getElementById('metaAiDeleteConversationBtn');
      if (deleteButton) {
        deleteButton.disabled = !hasActiveConversation;
        deleteButton.style.opacity = hasActiveConversation ? '1' : '0.45';
        deleteButton.style.cursor = hasActiveConversation ? 'pointer' : 'not-allowed';
      }
    }

    function ensurePdfWikiMetaAnalysisConversationId() {
      if (!pdfWikiMetaAnalysisConversationId) {
        pdfWikiMetaAnalysisConversationId = createPdfWikiMetaAnalysisConversationId();
      }
      updatePdfWikiMetaAnalysisConversationLabel();
      return pdfWikiMetaAnalysisConversationId;
    }

    function updatePdfWikiMetaAnalysisConversationLabel() {
      renderPdfWikiMetaAiConversationHistorySelect();
    }

    window.startNewPdfWikiMetaAnalysisConversation = function() {
      stopPdfWikiMetaAiPendingLogs();
      persistCurrentPdfWikiMetaAiConversation();
      pdfWikiMetaAnalysisConversationId = createPdfWikiMetaAnalysisConversationId();
      pdfWikiMetaAnalysisChatHistory = [];
      pdfWikiMetaAnalysisRecentQueries = [];
      pdfWikiMetaAnalysisAiPlanLast = null;
      pdfWikiMetaPiState = null;
      if (pdfWikiMetaPiPollTimer) {
        clearTimeout(pdfWikiMetaPiPollTimer);
        pdfWikiMetaPiPollTimer = null;
      }
      var input = document.getElementById('metaAiUserRequest');
      if (input) input.value = '';
      var pending = document.getElementById('metaAnalysisAiPendingMessage');
      if (pending) pending.remove();
      var ops = document.getElementById('metaAnalysisAiOps');
      if (ops) {
        ops.style.display = 'none';
        ops.innerHTML = '';
      }
      updatePdfWikiMetaAnalysisConversationLabel();
      renderPdfWikiMetaAnalysisChat();
      renderPdfWikiMetaAiConversationHistorySelect();
      renderPdfWikiMetaPiQueue(null);
    };

    window.openPdfWikiMetaAnalysisConversation = async function(conversationId) {
      if (!conversationId) return;
      var history = loadPdfWikiMetaAiConversationHistory();
      var record = history.find(function(item) { return item.id === conversationId; });
      if (!record) return;
      stopPdfWikiMetaAiPendingLogs();
      persistCurrentPdfWikiMetaAiConversation();
      pdfWikiMetaAnalysisConversationId = record.id;
      pdfWikiMetaAnalysisChatHistory = Array.isArray(record.messages) ? record.messages : [];
      pdfWikiMetaAnalysisRecentQueries = Array.isArray(record.recentQueries) ? record.recentQueries : [];
      pdfWikiMetaAnalysisAiPlanLast = null;
      pdfWikiMetaPiState = null;
      var input = document.getElementById('metaAiUserRequest');
      if (input) input.value = '';
      updatePdfWikiMetaAnalysisConversationLabel();
      renderPdfWikiMetaAnalysisChat();
      try {
        await fetch('/api/meta-analysis/ai-conversation/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            conversationId: record.id,
            workspaceDirectory: getWorkspaceDirectoryPayload(currentConversationId)
          })
        });
      } catch (error) {
        console.warn('[MetaAI] Failed to open backend conversation:', error);
      }
      await syncPdfWikiMetaPiQueueState({ claimWhenIdle: true });
    };

    window.deleteCurrentPdfWikiMetaAnalysisConversation = async function() {
      var conversationId = pdfWikiMetaAnalysisConversationId;
      var history = loadPdfWikiMetaAiConversationHistory();
      var record = history.find(function(item) { return item.id === conversationId; });
      if (!record) return;
      var title = record.title || '未命名 Meta 对话';
      if (!confirm('确定删除 Meta AI 历史对话“' + title + '”吗？\n\n该操作会同时清理该对话的后台工作区和待处理队列，不能撤销。')) return;

      var deleteButton = document.getElementById('metaAiDeleteConversationBtn');
      if (deleteButton) {
        deleteButton.disabled = true;
        deleteButton.style.opacity = '0.55';
        deleteButton.textContent = '删除中...';
      }

      stopPdfWikiMetaAiPendingLogs();
      if (pdfWikiMetaPiPollTimer) {
        clearTimeout(pdfWikiMetaPiPollTimer);
        pdfWikiMetaPiPollTimer = null;
      }
      try {
        await Promise.allSettled([
          fetch('/api/meta-analysis/ai-conversation/' + encodeURIComponent(conversationId), {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: currentUserId || 'web-user',
              workspaceDirectory: getWorkspaceDirectoryPayload(currentConversationId)
            })
          }),
          fetch(getPdfWikiMetaPiSessionUrl(conversationId) + '?userId=' + encodeURIComponent(currentUserId || 'web-user') + '&projectId=' + encodeURIComponent(getPdfWikiMetaProjectId()), {
            method: 'DELETE'
          })
        ]);
      } catch (error) {
        console.warn('[MetaAI] Failed to clean deleted conversation resources:', error);
      }

      var remaining = history.filter(function(item) { return item.id !== conversationId; });
      savePdfWikiMetaAiConversationHistory(remaining);
      pdfWikiMetaAnalysisConversationId = '';
      pdfWikiMetaAnalysisChatHistory = [];
      pdfWikiMetaAnalysisRecentQueries = [];
      pdfWikiMetaAnalysisAiPlanLast = null;
      pdfWikiMetaPiState = null;
      var pending = document.getElementById('metaAnalysisAiPendingMessage');
      if (pending) pending.remove();
      renderPdfWikiMetaPiQueue(null);

      if (remaining.length) {
        await window.openPdfWikiMetaAnalysisConversation(remaining[0].id);
      } else {
        window.startNewPdfWikiMetaAnalysisConversation();
      }
      var currentDeleteButton = document.getElementById('metaAiDeleteConversationBtn');
      if (currentDeleteButton) currentDeleteButton.textContent = '删除对话';
    };

    function getPdfWikiMetaSharedMessageContent(message) {
      var content = String((message && message.content) || '');
      var rArtifacts = message && message.rArtifacts && typeof message.rArtifacts === 'object'
        ? message.rArtifacts
        : null;
      if (!rArtifacts) {
        return { content: content, isHtml: !!(message && message.isHtml) };
      }
      return {
        content: formatMessage(content, { skipOutputAttachments: true }) + renderRArtifactAttachmentCards(rArtifacts),
        isHtml: true
      };
    }

    function appendPdfWikiMetaAnalysisHistoryMessage(role, content, extra) {
      var message = Object.assign({
        role: role === 'user' ? 'user' : 'assistant',
        content: String(content || ''),
        createdAt: new Date().toISOString()
      }, extra || {});
      pdfWikiMetaAnalysisChatHistory.push(message);
      persistCurrentPdfWikiMetaAiConversation();
      renderPdfWikiMetaAnalysisChat();
      return message;
    }

    function snapshotPdfWikiMetaRArtifacts(execData) {
      var data = execData && typeof execData === 'object' ? execData : {};
      return {
        jobId: data.jobId || '',
        workDir: data.workDir || '',
        plotDir: data.plotDir || '',
        files: Array.isArray(data.files) ? data.files : [],
        imageFiles: Array.isArray(data.imageFiles) ? data.imageFiles : [],
        supportFiles: Array.isArray(data.supportFiles) ? data.supportFiles : []
      };
    }

    function renderPdfWikiMetaAnalysisChat() {
      var output = document.getElementById('metaAnalysisAiOutput');
      if (!output) return;
      bindMetaAnalysisQueryNavRail();
      resetPdfWikiMetaPiQueueHost();
      if (!pdfWikiMetaAnalysisChatHistory.length) {
        output.replaceChildren();
        scheduleQueryNavRender();
        return;
      }
      output.replaceChildren();
      var latestUserIndex = -1;
      var latestBotMessageElement = null;
      pdfWikiMetaAnalysisChatHistory.forEach(function(message, index) {
        if (message && message.role === 'user') latestUserIndex = index;
      });
      pdfWikiMetaAnalysisChatHistory.forEach(function(message, index) {
        if (!message) return;
        var role = message.role === 'user' ? 'user' : 'bot';
        var rendered = getPdfWikiMetaSharedMessageContent(message);
        var messageElement = createSharedChatMessageElement(rendered.content, role, rendered.isHtml, false);
        messageElement.classList.add('meta-analysis-chat-message');
        messageElement.setAttribute('data-meta-message-index', String(index));
        if (message.piQueueId) messageElement.setAttribute('data-meta-pi-queue-id', String(message.piQueueId));
        if (index === latestUserIndex) messageElement.id = 'metaAnalysisLatestUserMessage';
        output.appendChild(messageElement);
        if (role === 'bot') latestBotMessageElement = messageElement;
        initWorkspaceImageStacks(messageElement);
      });
      var hasPendingMetaPiMessages = !!(pdfWikiMetaPiState && Number(pdfWikiMetaPiState.pendingMessageCount || 0) > 0);
      if (latestBotMessageElement && (pdfWikiMetaAnalysisAiAbortController || hasPendingMetaPiMessages)) {
        attachPdfWikiMetaPiQueuePanelToMessage(latestBotMessageElement);
      }
      scrollPdfWikiMetaAnalysisChatToLatestUser();
      scheduleQueryNavRender();
    }

    function scrollPdfWikiMetaAnalysisChatToLatestUser() {
      var output = document.getElementById('metaAnalysisAiOutput');
      var latest = document.getElementById('metaAnalysisLatestUserMessage');
      if (!output || !latest) return;
      var nextTop = latest.offsetTop - output.offsetTop - 8;
      output.scrollTop = Math.max(0, nextTop);
    }

    function appendPdfWikiMetaAnalysisPendingMessage() {
      var output = document.getElementById('metaAnalysisAiOutput');
      if (!output) return null;
      var existing = document.getElementById('metaAnalysisAiPendingMessage');
      if (existing) existing.remove();
      var messageElement = document.createElement('div');
      messageElement.className = 'message bot thinking-message';
      messageElement.innerHTML = '<div class="avatar bot">' + getMessageAvatarHtml('bot') + '</div>' +
        '<div class="content">正在思考...</div>';
      messageElement.id = 'metaAnalysisAiPendingMessage';
      messageElement.classList.add('meta-analysis-chat-message');
      output.appendChild(messageElement);
      attachPdfWikiMetaPiQueuePanelToMessage(messageElement);
      return messageElement;
    }

    function renderPdfWikiMetaAnalysisAiPlan(plan, options) {
      var ops = document.getElementById('metaAnalysisAiOps');
      var applyBtn = document.getElementById('metaApplyAiPlanBtn');
      if (!plan) return;
      options = options || {};
      var assistantText = buildPdfWikiMetaAnalysisAiPlanText(plan);
      if (assistantText && !options.skipHistoryAppend) {
        pdfWikiMetaAnalysisChatHistory.push({ role: 'assistant', content: assistantText, createdAt: new Date().toISOString() });
        persistCurrentPdfWikiMetaAiConversation({
          lastProvider: plan.provider || '',
          lastWorkflowStage: plan.workflowStage || ''
        });
      }
      renderPdfWikiMetaAnalysisChat();
      if (ops) {
        ops.style.display = 'none';
        ops.innerHTML = '';
      }
      if (applyBtn) {
        applyBtn.disabled = !(plan.suggestedConfig && Array.isArray(plan.suggestedConfig.outcomes) && plan.suggestedConfig.outcomes.length);
        applyBtn.style.opacity = applyBtn.disabled ? '0.55' : '1';
        applyBtn.style.cursor = applyBtn.disabled ? 'not-allowed' : 'pointer';
      }
    }

    function setPdfWikiMetaManualModeOpen(open) {
      pdfWikiMetaAnalysisManualModeOpen = !!open;
      var panel = document.getElementById('metaExpertManualMode');
      if (panel) {
        panel.classList.toggle('open', pdfWikiMetaAnalysisManualModeOpen);
      }
    }

    window.togglePdfWikiMetaManualMode = function() {
      setPdfWikiMetaManualModeOpen(!pdfWikiMetaAnalysisManualModeOpen);
    };

    function installPdfWikiMetaAnalysisHeaderStats(pdfCount, rowCount, columnCount) {
      var header = document.querySelector('#modalOverlay .modal-header');
      var actions = document.getElementById('modalHeaderActions');
      if (!header || !actions) return;
      var existing = document.getElementById('metaAnalysisHeaderStats');
      if (existing) existing.remove();
      var existingSubtitle = document.getElementById('metaAnalysisHeaderSubtitle');
      if (existingSubtitle) existingSubtitle.remove();
      var stats = document.createElement('div');
      stats.id = 'metaAnalysisHeaderStats';
      stats.className = 'meta-analysis-header-stats modal-transient-action';
      stats.setAttribute('aria-label', 'Meta 分析数据概览');
      stats.innerHTML = [
        ['纳入PDF', pdfCount],
        ['原始行', rowCount],
        ['字段数', columnCount]
      ].map(function(item) {
        return '<span class="meta-analysis-header-stat"><span>' + escapeHtml(item[0]) + '</span><strong>' + escapeHtml(formatPdfWikiMetaValue(item[1])) + '</strong></span>';
      }).join('');
      var conversationControls = document.getElementById('metaAiConversationControls');
      if (conversationControls) stats.appendChild(conversationControls);
      header.insertBefore(stats, actions);
      var subtitle = document.createElement('div');
      subtitle.id = 'metaAnalysisHeaderSubtitle';
      subtitle.className = 'meta-analysis-header-subtitle modal-transient-action';
      subtitle.textContent = '在底部输入 Meta 分析需求后，AI 会把数据理解、字段判断、配置建议和运行结果直接显示在页面中。';
      header.insertBefore(subtitle, actions);
    }

    window.syncPdfWikiMetaManualModeState = function(panel) {
      setPdfWikiMetaManualModeOpen(!!(panel && panel.classList && panel.classList.contains('open')));
    };

    window.autoResizePdfWikiMetaAiInput = function(input) {
      if (!input) return;
      input.style.height = '46px';
      var nextHeight = Math.min(Math.max(input.scrollHeight, 46), 128);
      input.style.height = nextHeight + 'px';
      input.style.overflowY = input.scrollHeight > 128 ? 'auto' : 'hidden';
    };

    window.stopPdfWikiMetaAnalysisAiPlan = function() {
      if (pdfWikiMetaAnalysisAiAbortController) {
        var conversationId = ensurePdfWikiMetaAnalysisConversationId();
        fetch(getPdfWikiMetaPiSessionUrl(conversationId) + '/interrupt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId || 'web-user', projectId: getPdfWikiMetaProjectId() || undefined })
        }).then(function(response) {
          return response.json().catch(function() { return {}; });
        }).then(function(result) {
          if (result && result.state) {
            pdfWikiMetaPiState = result.state;
            renderPdfWikiMetaPiQueue(pdfWikiMetaPiState);
          }
        }).catch(function(error) {
          console.warn('[MetaPi] Failed to interrupt backend Agent:', error);
        });
        pdfWikiMetaAnalysisAiAbortController.abort();
      }
    };

    window.handlePdfWikiMetaAiSendAction = async function() {
      if (pdfWikiMetaAnalysisAiAbortController) {
        var input = document.getElementById('metaAiUserRequest');
        var queuedMessage = input ? String(input.value || '').trim() : '';
        if (queuedMessage) {
          try {
            await enqueuePdfWikiMetaPiMessage(queuedMessage, pdfWikiMetaPiQueueBehavior);
            input.value = '';
            window.autoResizePdfWikiMetaAiInput(input);
            window.updatePdfWikiMetaPiSendButtonState();
          } catch (error) {
            alert('加入 Meta Agent 队列失败：' + (error.message || String(error)));
          }
        } else {
          window.stopPdfWikiMetaAnalysisAiPlan();
        }
        return;
      }
      window.runPdfWikiMetaAnalysisAiPlan();
    };

    function buildPdfWikiMetaAgentPageContext(conversationId, workspaceDirectory, workspaceFiles, chatAttachments) {
      var inspect = pdfWikiMetaAnalysisInspectData || {};
      var compactVariables = (Array.isArray(inspect.variables) ? inspect.variables : []).slice(0, 120).map(function(item) {
        return {
          name: item && item.name || '',
          type: item && item.type || '',
          missingRate: item && item.missingRate,
          uniqueCount: item && item.uniqueCount,
          examples: Array.isArray(item && item.examples) ? item.examples.slice(0, 6) : undefined
        };
      });
      var compactModerators = (Array.isArray(inspect.moderatorCandidates) ? inspect.moderatorCandidates : []).slice(0, 60).map(function(item) {
        return {
          name: item && item.name || '',
          type: item && item.type || '',
          uniqueCount: item && item.uniqueCount,
          examples: Array.isArray(item && item.examples) ? item.examples.slice(0, 5) : undefined
        };
      });
      return {
        enabled: true,
        page: 'meta-analysis',
        conversationId: conversationId,
        writingConversationId: currentConversationId || '',
        selectedPdfIds: pdfWikiMetaAnalysisTargetPdfIds.slice(),
        dataset: inspect.dataset || null,
        variables: compactVariables,
        candidateOutcomes: (Array.isArray(inspect.candidateOutcomes) ? inspect.candidateOutcomes : []).slice(0, 40),
        moderatorCandidates: compactModerators,
        recommendedConfig: inspect.recommendedConfig || null,
        warnings: (Array.isArray(inspect.warnings) ? inspect.warnings : []).slice(0, 30),
        lastRun: pdfWikiMetaAnalysisLastRun ? {
          analysisId: pdfWikiMetaAnalysisLastRun.analysisId || '',
          dataset: pdfWikiMetaAnalysisLastRun.dataset || null,
          effectRowCount: Array.isArray(pdfWikiMetaAnalysisLastRun.effectRows) ? pdfWikiMetaAnalysisLastRun.effectRows.length : 0,
          skippedCount: Number(pdfWikiMetaAnalysisLastRun.skippedCount || 0),
          outputDirectory: pdfWikiMetaAnalysisLastRun.outputDirectory || ''
        } : null,
        workspaceDirectory: workspaceDirectory || null,
        workspaceFiles: Array.isArray(workspaceFiles) ? workspaceFiles.slice(0, 20) : [],
        chatAttachments: Array.isArray(chatAttachments) ? chatAttachments.slice(0, 12) : [],
        selectedContextSources: loadMainContextSourceSelection(),
        selectedSkills: loadMainContextSkillSelection(),
        capabilityNote: '本页面复用主页统一 Agent、Skill Runtime、MCP Runtime、工作目录工具、文献检索和 Pi 会话；Meta 原生工具只在 AI 根据 query 明确选择后执行。'
      };
    }

    function applyPdfWikiMetaChatProviderConfig(requestBody, provider) {
      if (!requestBody) return;
      if (provider) requestBody.forceProvider = provider;
      if (provider === 'codex' || provider === 'pi' || provider === 'opencode') {
        var runtimeSelection = typeof window.getComposerCodingRuntimeSelection === 'function'
          ? window.getComposerCodingRuntimeSelection(provider)
          : null;
        requestBody.agentRuntime = provider;
        if (runtimeSelection && runtimeSelection.model) requestBody.agentRuntimeModel = runtimeSelection.model;
        if (runtimeSelection && runtimeSelection.reasoningEffort) requestBody.agentRuntimeReasoningEffort = runtimeSelection.reasoningEffort;
        if (runtimeSelection && runtimeSelection.timeoutMs) requestBody.agentRuntimeTimeoutMs = runtimeSelection.timeoutMs;
        if (provider === 'codex') {
          var composerCodexSelection = getComposerCodexSelection();
          requestBody.codexModel = composerCodexSelection.model;
          requestBody.codexReasoningEffort = composerCodexSelection.reasoningEffort;
          flushComposerCodexSelectionSave().catch(function(error) {
            console.warn('[MetaAnalysisAI] Codex selection persistence failed:', error);
          });
        }
        return;
      }
      if (provider === 'primary') {
        if (chatBridgeConfig.primary && chatBridgeConfig.primary.model) {
          requestBody.model = chatBridgeConfig.primary.model;
        }
        return;
      }
      if (apiConfig.url && apiConfig.key) {
        requestBody.apiUrl = apiConfig.url;
        requestBody.apiKey = apiConfig.key;
        requestBody.model = apiConfig.model || 'qwen3.5-plus';
        requestBody.secondaryModel = apiConfig.model || 'qwen3.5-plus';
      } else if (chatBridgeConfig.secondary && chatBridgeConfig.secondary.model) {
        requestBody.model = chatBridgeConfig.secondary.model;
        requestBody.secondaryModel = chatBridgeConfig.secondary.model;
      }
    }

    async function readPdfWikiMetaAgentStream(response, messageElement) {
      if (!response.body || !response.body.getReader) throw new Error('当前环境不支持流式读取响应');
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var fullResponse = '';
      var streamRenderer = null;

      function ensureRenderer() {
        stopPdfWikiMetaAiPendingLogs();
        if (messageElement) {
          messageElement.classList.remove('thinking-message');
          var content = messageElement.querySelector('.content');
          if (content && !streamRenderer) content.innerHTML = '';
        }
        if (!streamRenderer) streamRenderer = createBotTextStreamer(messageElement);
        return streamRenderer;
      }

      function handleEvent(data) {
        if (!data || !data.type) return;
        if (data.type === 'chunk') {
          fullResponse += String(data.content || '');
          ensureRenderer().setText(fullResponse);
        } else if (data.type === 'status') {
          if (streamRenderer && typeof streamRenderer.setElapsedMs === 'function' && data.elapsedMs) {
            streamRenderer.setElapsedMs(data.elapsedMs);
          }
        } else if (data.type === 'complete' || data.type === 'done' || data.type === 'end') {
          if (typeof data.content === 'string' && data.content) fullResponse = data.content;
          if (fullResponse) ensureRenderer().setText(fullResponse);
        } else if (data.type === 'error') {
          throw new Error(data.error || '统一 Agent 返回错误');
        }
      }

      function processBuffer(flush) {
        var events = buffer.split(/\r?\n\r?\n/);
        buffer = flush ? '' : (events.pop() || '');
        events.forEach(function(eventText) {
          var payload = eventText.split(/\r?\n/)
            .filter(function(line) { return line.indexOf('data:') === 0; })
            .map(function(line) { return line.replace(/^data:\s?/, ''); })
            .join('\n').trim();
          if (!payload || payload === '[DONE]') return;
          handleEvent(JSON.parse(payload));
        });
        if (flush && buffer.trim()) {
          handleEvent(JSON.parse(buffer.replace(/^data:\s?/, '').trim()));
        }
      }

      while (true) {
        var next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        processBuffer(false);
      }
      buffer += decoder.decode();
      processBuffer(true);
      return executeFrontendUiActionsFromAiResponse(fullResponse).trim();
    }

    async function refreshPdfWikiMetaAgentRunState(conversationId, workspaceDirectory) {
      try {
        var response = await fetch('/api/meta-analysis/writing-context?userId=' + encodeURIComponent(currentUserId || 'web-user') + '&conversationId=' + encodeURIComponent(conversationId || ''));
        if (!response.ok) return false;
        var result = await response.json();
        if (!result.success || !result.data) return false;
        pdfWikiMetaAnalysisLastRun = Object.assign({}, result.data, {
          workspaceDirectory: workspaceDirectory || null
        });
        return true;
      } catch (error) {
        console.warn('[MetaAgent] Failed to refresh completed Meta run state:', error);
        return false;
      }
    }

    window.runPdfWikiMetaAnalysisAiPlan = async function(queuedItem) {
      if (!pdfWikiMetaAnalysisInspectData || !pdfWikiMetaAnalysisTargetPdfIds.length) {
        alert('请先打开 Meta 分析向导并读取数据。');
        return;
      }
      var input = document.getElementById('metaAiUserRequest');
      var output = document.getElementById('metaAnalysisAiOutput');
      var query = queuedItem && queuedItem.message
        ? String(queuedItem.message).trim()
        : (input ? String(input.value || '').trim() : '');
      if (!query) {
        query = '请先自动判断当前 Meta 数据库中哪些列是因变量、哪些列是自变量/亚组/调节变量、哪些处理是 CK/control、哪些是 treatment，以及哪些列需要合并、拆分或单位换算。';
      }
      var conversationId = ensurePdfWikiMetaAnalysisConversationId();
      if (queuedItem && queuedItem.id) {
        updatePdfWikiMetaPiHistoryStatus(queuedItem, 'processing');
      } else {
        pdfWikiMetaAnalysisChatHistory.push({ role: 'user', content: query, createdAt: new Date().toISOString() });
        pdfWikiMetaAnalysisRecentQueries.push(query);
      }
      persistCurrentPdfWikiMetaAiConversation();
      if (input) {
        input.value = '';
        window.autoResizePdfWikiMetaAiInput(input);
      }
      renderPdfWikiMetaAnalysisChat();
      setPdfWikiMetaAnalysisBusy(true, 'metaAiPlanBtn');
      if (output) {
        appendPdfWikiMetaAnalysisPendingMessage();
        scrollPdfWikiMetaAnalysisChatToLatestUser();
      }
      var abortController = new AbortController();
      pdfWikiMetaAnalysisAiAbortController = abortController;
      renderPdfWikiMetaPiQueue(pdfWikiMetaPiState);
      window.updatePdfWikiMetaPiSendButtonState();
      try {
        var metaChatAttachments = queuedItem && Array.isArray(queuedItem.chatAttachments)
          ? queuedItem.chatAttachments
          : [];
        if (!queuedItem && pendingExperimentFiles.length > 0) {
          appendPdfWikiMetaAnalysisLog('正在保存输入框中的附件...', 'active');
          metaChatAttachments = await uploadPendingFilesAsChatAttachments();
        }
        var metaWorkspaceDirectory = getWorkspaceDirectoryPayload(currentConversationId);
        var metaWorkspaceFiles = queuedItem && Array.isArray(queuedItem.workspaceFileMentions)
          ? queuedItem.workspaceFileMentions
          : getSelectedWorkspacePreviewFiles();
        var provider = getComposerChatProvider();
        var historyForAgent = pdfWikiMetaAnalysisChatHistory.slice(-20).map(function(message) {
          return {
            role: message && message.role === 'assistant' ? 'assistant' : 'user',
            content: String(message && message.content || '')
          };
        });
        var isFirstAgentTurn = historyForAgent.filter(function(message) { return message.role === 'assistant'; }).length === 0;
        var sharedContext = await prepareChatBridgeContext(
          query,
          isFirstAgentTurn,
          null,
          null,
          function(statusText) {
            var pendingMessage = document.getElementById('metaAnalysisAiPendingMessage');
            var pendingContent = pendingMessage && pendingMessage.querySelector
              ? pendingMessage.querySelector('.content')
              : null;
            if (pendingContent && statusText) pendingContent.textContent = statusText;
          },
          {
            rawMessage: query,
            history: historyForAgent,
            workspaceDirectory: metaWorkspaceDirectory,
            workspaceFileMentions: metaWorkspaceFiles,
            chatAttachments: metaChatAttachments,
            slashNames: [],
            provider: provider || undefined,
            conversationId: conversationId,
            abortSignal: abortController.signal
          }
        );
        sharedContext.workspaceFileMentions = metaWorkspaceFiles;
        sharedContext.chatAttachments = metaChatAttachments;
        sharedContext.metaAnalysisAgent = buildPdfWikiMetaAgentPageContext(
          conversationId,
          metaWorkspaceDirectory,
          metaWorkspaceFiles,
          metaChatAttachments
        );
        sharedContext.piSession = {
          enabled: true,
          architecture: 'pi',
          sessionId: conversationId,
          delivery: queuedItem && queuedItem.behavior !== 'steer' ? 'follow_up' : 'steer',
          steeringMode: 'one-at-a-time',
          followUpMode: 'one-at-a-time',
          refreshDiscussionWritingStateEachTurn: true
        };
        var requestBody = {
          message: query,
          userId: currentUserId || 'web-user',
          projectId: getPdfWikiMetaProjectId() || undefined,
          conversationId: conversationId,
          context: sharedContext,
          history: historyForAgent,
          stream: true,
          newPage: false,
          frontendState: buildFrontendPageStateSnapshot(query, provider || 'auto', queuedItem && queuedItem.behavior !== 'steer' ? 'queue' : 'steer'),
          queryEnvelope: buildChatQueryEnvelope(
            query,
            query,
            provider || 'auto',
            metaWorkspaceFiles,
            [],
            sharedContext,
            metaWorkspaceDirectory,
            queuedItem && queuedItem.behavior !== 'steer' ? 'queue' : 'steer'
          )
        };
        if (metaWorkspaceDirectory) requestBody.workspaceDirectory = metaWorkspaceDirectory;
        if (queuedItem && queuedItem.id) {
          requestBody.piQueueMessageId = queuedItem.id;
          requestBody.piQueueOriginalMessage = queuedItem.message;
        }
        if (metaChatAttachments.length > 0) {
          requestBody.chatAttachments = metaChatAttachments;
          var metaImagePaths = metaChatAttachments.filter(function(file) {
            return file && (file.type === 'image' || isVisionFileName(file.name || file.path || ''));
          }).map(function(file) { return file.path || ''; }).filter(Boolean);
          if (metaImagePaths.length > 0) {
            requestBody.codexImages = metaImagePaths;
            requestBody.visionImages = metaImagePaths;
            requestBody.requiresVision = true;
          }
        }
        applyPdfWikiMetaChatProviderConfig(requestBody, provider);
        var multimodalIntent = await classifyMultimodalAttachmentIntent(requestBody);
        if (multimodalIntent) {
          sharedContext.multimodalIntent = multimodalIntent;
          requestBody.context = sharedContext;
        }

        var response = await fetch('/api/chat-bridge/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify(requestBody)
        });
        if (!response.ok) {
          var errorData = await response.json().catch(function() { return {}; });
          throw new Error(errorData.error || errorData.message || ('HTTP ' + response.status));
        }
        if (metaWorkspaceFiles.length > 0) clearWorkspacePreviewSelections();
        var pending = document.getElementById('metaAnalysisAiPendingMessage');
        var fullResponse = await readPdfWikiMetaAgentStream(response, pending);
        if (!fullResponse) fullResponse = '统一 Agent 已完成本轮处理，但没有返回文本内容。';
        await refreshPdfWikiMetaAgentRunState(conversationId, metaWorkspaceDirectory);
        pdfWikiMetaAnalysisAiPlanLast = null;
        pdfWikiMetaAnalysisChatHistory.push({
          role: 'assistant',
          content: fullResponse,
          createdAt: new Date().toISOString()
        });
        persistCurrentPdfWikiMetaAiConversation({
          lastProvider: provider || 'auto',
          lastWorkflowStage: 'shared-agent'
        });
        renderPdfWikiMetaAnalysisChat();
      } catch (error) {
        stopPdfWikiMetaAiPendingLogs();
        var pendingMessage = document.getElementById('metaAnalysisAiPendingMessage');
        if (pendingMessage) pendingMessage.remove();
        var wasAborted = error && error.name === 'AbortError';
        pdfWikiMetaAnalysisChatHistory.push({ role: 'assistant', content: wasAborted ? '已停止本次 Meta AI 生成。' : ('Meta AI 分析助手失败：' + (error.message || String(error))), createdAt: new Date().toISOString() });
        persistCurrentPdfWikiMetaAiConversation({ lastProvider: wasAborted ? 'stopped' : 'error' });
        renderPdfWikiMetaAnalysisChat();
        if (queuedItem && queuedItem.id && !wasAborted) {
          try {
            await fetch(getPdfWikiMetaPiSessionUrl(conversationId) + '/messages/' + encodeURIComponent(queuedItem.id) + '/requeue', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: currentUserId || 'web-user', projectId: getPdfWikiMetaProjectId() || undefined })
            });
          } catch (requeueError) {
            console.warn('[MetaPi] Failed to requeue message after request error:', requeueError);
          }
        }
      } finally {
        if (pdfWikiMetaAnalysisAiAbortController === abortController) {
          pdfWikiMetaAnalysisAiAbortController = null;
        }
        setPdfWikiMetaAnalysisBusy(false);
        await syncPdfWikiMetaPiQueueState({ claimWhenIdle: true });
      }
    };

    window.handlePdfWikiMetaAiInputKeydown = function(event) {
      if (!event) return;
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      window.handlePdfWikiMetaAiSendAction();
    };

    function normalizePdfWikiMetaAiOutcomeForUi(outcome, index, totalRows) {
      outcome = outcome || {};
      var mapping = {};
      ['treatmentMean', 'treatmentSd', 'treatmentN', 'controlMean', 'controlSd', 'controlN'].forEach(function(role) {
        if (outcome[role]) mapping[role] = outcome[role];
      });
      return {
        id: outcome.id || ('ai_outcome_' + (index + 1)),
        label: outcome.label || outcome.id || ('因变量 ' + (index + 1)),
        measure: outcome.measure || 'lnRR',
        direction: String(outcome.direction || '1'),
        mapping: mapping,
        completeRows: 0,
        totalRows: totalRows || 0,
        warnings: ['AI 建议配置，请运行 Meta 分析后查看有效效应量和跳过原因。']
      };
    }

    window.applyPdfWikiMetaAnalysisAiPlan = function(options) {
      options = options || {};
      var plan = pdfWikiMetaAnalysisAiPlanLast;
      if (!plan || !plan.suggestedConfig) {
        if (!options.silent) alert('请先发送给 AI。');
        return false;
      }
      if (!pdfWikiMetaAnalysisInspectData) return false;
      var config = plan.suggestedConfig || {};
      var outcomes = Array.isArray(config.outcomes) ? config.outcomes : [];
      var totalRows = pdfWikiMetaAnalysisInspectData.dataset ? pdfWikiMetaAnalysisInspectData.dataset.rowCount : 0;
      if (outcomes.length) {
        pdfWikiMetaAnalysisInspectData.candidateOutcomes = outcomes.map(function(outcome, index) {
          return normalizePdfWikiMetaAiOutcomeForUi(outcome, index, totalRows);
        });
      }
      pdfWikiMetaAnalysisInspectData.recommendedConfig = Object.assign({}, pdfWikiMetaAnalysisInspectData.recommendedConfig || {}, {
        model: config.model || 'random',
        method: config.method || 'REML',
        studyIdColumn: config.studyIdColumn || (pdfWikiMetaAnalysisInspectData.recommendedConfig || {}).studyIdColumn || 'Study#',
        clusterBy: config.clusterBy || (pdfWikiMetaAnalysisInspectData.recommendedConfig || {}).clusterBy || config.studyIdColumn || 'Study#',
        moderatorColumns: Array.isArray(config.moderatorColumns) ? config.moderatorColumns : [],
        subgroupColumns: Array.isArray(config.subgroupColumns) ? config.subgroupColumns : [],
        columnPreprocess: Array.isArray(config.columnPreprocess) ? config.columnPreprocess : [],
        minCompleteRows: Number(config.minCompleteRows || 2),
        controlRules: Array.isArray(config.controlRules) ? config.controlRules : [],
        excludeManualReview: config.excludeManualReview !== false,
        manualReviewColumn: config.manualReviewColumn || '',
        outcomes: outcomes
      });
      renderPdfWikiMetaAnalysisWizard(pdfWikiMetaAnalysisInspectData, pdfWikiMetaAnalysisTargetPdfIds);
      pdfWikiMetaAnalysisAiPlanLast = plan;
      renderPdfWikiMetaAnalysisAiPlan(plan, { skipHistoryAppend: true });
      appendPdfWikiMetaAnalysisLog('已把 AI 建议应用到效应量配置。', 'done');
      return true;
    };

    function snapshotPdfWikiMetaAnalysisWizardState() {
      if (!pdfWikiMetaAnalysisInspectData) return false;
      var candidates = Array.isArray(pdfWikiMetaAnalysisInspectData.candidateOutcomes) && pdfWikiMetaAnalysisInspectData.candidateOutcomes.length
        ? pdfWikiMetaAnalysisInspectData.candidateOutcomes
        : [{ id: 'outcome', label: '', measure: 'lnRR', mapping: {} }];
      var subgroupColumnMap = {};
      var rangeRuleMap = {};
      var nextOutcomes = candidates.map(function(candidate, index) {
        var mapping = {};
        Array.prototype.slice.call(document.querySelectorAll('.meta-header-role-select[data-meta-outcome-index="' + index + '"]')).forEach(function(select) {
          var role = select.value || '';
          var column = select.getAttribute('data-meta-column') || '';
          if (!column) return;
          if (role === 'subgroupAnalysis') {
            subgroupColumnMap[column] = true;
            var card = select.closest ? select.closest('.meta-header-role-card') : null;
            var rangeInput = card ? card.querySelector('.meta-header-range-input') : null;
            var rangeSpec = rangeInput ? String(rangeInput.value || '').trim() : '';
            if (rangeSpec) rangeRuleMap[column] = rangeSpec;
          } else if (role) {
            mapping[role] = column;
          }
        });
        var enabled = document.getElementById('metaOutcome_' + index + '_enabled');
        var label = document.getElementById('metaOutcome_' + index + '_label');
        var measure = document.getElementById('metaOutcome_' + index + '_measure');
        var direction = document.getElementById('metaOutcome_' + index + '_direction');
        return Object.assign({}, candidate, {
          label: label ? String(label.value || '').trim() : (candidate.label || ''),
          measure: measure ? measure.value : (candidate.measure || 'lnRR'),
          direction: direction ? direction.value : (candidate.direction || '1'),
          mapping: mapping,
          uiEnabled: !enabled || !!enabled.checked
        });
      });
      var moderatorsSelect = document.getElementById('metaModeratorColumns');
      var moderatorColumns = moderatorsSelect
        ? Array.prototype.slice.call(moderatorsSelect.selectedOptions || []).map(function(option) { return option.value; }).filter(Boolean)
        : [];
      var modelInput = document.getElementById('metaModelType');
      var studyInput = document.getElementById('metaStudyIdColumn');
      var clusterInput = document.getElementById('metaClusterBy');
      var excludeManualReviewInput = document.getElementById('metaExcludeManualReview');
      var recommended = pdfWikiMetaAnalysisInspectData.recommendedConfig || {};
      pdfWikiMetaAnalysisInspectData.candidateOutcomes = nextOutcomes;
      pdfWikiMetaAnalysisInspectData.recommendedConfig = Object.assign({}, recommended, {
        model: modelInput ? modelInput.value : (recommended.model || 'random'),
        studyIdColumn: studyInput ? studyInput.value : (recommended.studyIdColumn || 'Study#'),
        clusterBy: clusterInput ? clusterInput.value : (recommended.clusterBy || recommended.studyIdColumn || 'Study#'),
        moderatorColumns: moderatorColumns,
        subgroupColumns: Object.keys(subgroupColumnMap),
        columnPreprocess: Object.keys(rangeRuleMap).map(function(column) {
          return { column: column, type: 'rangeGroups', spec: rangeRuleMap[column] };
        }),
        excludeManualReview: excludeManualReviewInput ? !!excludeManualReviewInput.checked : recommended.excludeManualReview !== false,
        outcomes: nextOutcomes.filter(function(outcome) { return outcome.uiEnabled !== false; }).map(function(outcome) {
          return Object.assign({
            id: outcome.id,
            label: outcome.label,
            measure: outcome.measure,
            direction: outcome.direction
          }, outcome.mapping || {});
        })
      });
      var manualDetails = document.getElementById('metaExpertManualMode');
      pdfWikiMetaAnalysisManualModeOpen = !!(manualDetails && manualDetails.classList.contains('open'));
      return true;
    }
    window.snapshotPdfWikiMetaAnalysisWizardState = snapshotPdfWikiMetaAnalysisWizardState;

    function renderPdfWikiMetaAnalysisWizard(data, pdfIds) {
      ensurePdfWikiMetaAnalysisConversationId();
      var variables = Array.isArray(data.variables) ? data.variables : [];
      var columns = variables.map(function(variable) { return variable.name; });
      var outcomes = Array.isArray(data.candidateOutcomes) && data.candidateOutcomes.length
        ? data.candidateOutcomes
        : [{ id: 'outcome', label: '', measure: 'lnRR', mapping: {}, completeRows: 0, totalRows: data.dataset ? data.dataset.rowCount : 0, warnings: ['未自动识别到完整字段，请手动映射。'] }];
      var moderators = Array.isArray(data.moderatorCandidates) ? data.moderatorCandidates : [];
      var recommended = data.recommendedConfig || {};
      var selectedModerators = {};
      (Array.isArray(recommended.moderatorColumns) ? recommended.moderatorColumns : []).forEach(function(column) {
        selectedModerators[column] = true;
      });
      var selectedSubgroups = {};
      (Array.isArray(recommended.subgroupColumns) ? recommended.subgroupColumns : []).forEach(function(column) {
        selectedSubgroups[column] = true;
      });
      var selectedRangeRules = {};
      (Array.isArray(recommended.columnPreprocess) ? recommended.columnPreprocess : []).forEach(function(item) {
        if (item && item.column && item.spec) selectedRangeRules[item.column] = item.spec;
      });
      var dataset = data.dataset || {};
      var moderatorOptions = moderators.map(function(variable) {
        return '<option value="' + escapeHtml(variable.name) + '"' + (selectedModerators[variable.name] ? ' selected' : '') + '>' + escapeHtml(variable.name + ' · ' + variable.type + ' · n=' + variable.nonMissingCount) + '</option>';
      }).join('');
      var manualOpenClass = pdfWikiMetaAnalysisManualModeOpen ? ' open' : '';
      var modelValue = recommended.model || 'random';
      var html =
        '<div class="meta-analysis-wizard">' +
          '<div class="meta-analysis-wizard-body">' +
          '<section class="meta-analysis-wizard-main">' +
            '<div class="meta-analysis-ai-panel meta-analysis-ai-workspace-panel">' +
              '<div id="metaAiConversationControls" class="meta-analysis-header-conversation-controls">' +
                '<select id="metaAiHistorySelect" onchange="openPdfWikiMetaAnalysisConversation(this.value)" title="打开历史 Meta AI 对话">' +
                  '<option value="" disabled hidden selected>历史对话</option>' +
                '</select>' +
                '<button id="metaAiNewConversationBtn" type="button" class="meta-analysis-wizard-btn" onclick="startNewPdfWikiMetaAnalysisConversation()" title="新建 Meta AI 对话">新建对话</button>' +
                '<button id="metaAiDeleteConversationBtn" type="button" class="meta-analysis-wizard-btn" onclick="deleteCurrentPdfWikiMetaAnalysisConversation()" title="删除当前 Meta AI 历史对话" disabled>删除对话</button>' +
              '</div>' +
              '<div id="metaAnalysisAiOutput" class="meta-analysis-ai-output"></div>' +
              '<div id="metaAnalysisAiOps" class="meta-analysis-ai-ops"></div>' +
            '</div>' +
            '<div id="metaExpertManualMode" class="meta-analysis-manual-details' + manualOpenClass + '">' +
            '<div class="meta-analysis-manual-content">' +
            '<div style="font-size:13px;font-weight:700;color:var(--text-primary);margin:12px 0 8px;">效应量配置</div>' +
            outcomes.map(function(outcome, index) {
              return renderMetaAnalysisOutcomeCard(outcome, index, columns, data.effectMeasures || [], selectedSubgroups, selectedRangeRules);
            }).join('') +
            '<div class="meta-analysis-wizard-side">' +
            '<div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:10px;">模型与协变量</div>' +
            '<div class="meta-analysis-wizard-side-controls">' +
            '<label style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--text-secondary);">模型' +
              '<select id="metaModelType" style="padding:7px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' +
                '<option value="random"' + (modelValue === 'random' ? ' selected' : '') + '>随机效应 REML</option>' +
                '<option value="mixed"' + (modelValue === 'mixed' ? ' selected' : '') + '>混合效应 rma.mv</option>' +
                '<option value="fixed"' + (modelValue === 'fixed' ? ' selected' : '') + '>固定效应</option>' +
              '</select>' +
            '</label>' +
            '<label style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--text-secondary);">研究ID字段' +
              '<select id="metaStudyIdColumn" style="padding:7px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' +
                renderMetaAnalysisColumnOptions(columns, recommended.studyIdColumn || 'Study#', false) +
              '</select>' +
            '</label>' +
            '<label style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--text-secondary);">聚类稳健字段' +
              '<select id="metaClusterBy" style="padding:7px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' +
                renderMetaAnalysisColumnOptions(columns, recommended.clusterBy || recommended.studyIdColumn || 'Study#', false) +
              '</select>' +
            '</label>' +
            '<label style="display:flex;align-items:center;gap:7px;padding:8px 9px;border:1px solid var(--border-color);border-radius:7px;font-size:12px;color:var(--text-secondary);">' +
              '<input id="metaExcludeManualReview" type="checkbox"' + (recommended.excludeManualReview !== false ? ' checked' : '') + '>' +
              '<span>主分析排除待人工复核行' + (recommended.manualReviewColumn ? '（' + escapeHtml(recommended.manualReviewColumn) + '）' : '') + '</span>' +
            '</label>' +
            '<label class="wide" style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--text-secondary);">调节变量 / 元回归变量' +
              '<select id="metaModeratorColumns" multiple style="height:120px;padding:7px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' + moderatorOptions + '</select>' +
            '</label>' +
            '</div>' +
            '<div style="margin-top:10px;padding:9px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);font-size:11px;line-height:1.55;color:var(--text-secondary);">亚组分析变量请在上方“表头用途标注”的下拉框里选择“参与亚组分析”。如果该列是连续数值，可以在表头卡片里填写范围分组规则，例如 0-30=短期;30-90=中期;&gt;90=长期。</div>' +
            '<div style="margin-top:9px;font-size:11px;color:var(--text-secondary);line-height:1.55;">标准方差型分析会按研究/聚类汇总后生成森林图、漏斗图（至少10个独立研究）、leave-one-study-out、Baujat 和数值型 Meta 回归图；mean-only 分析只生成研究级聚类 bootstrap 的总体和亚组结果。</div>' +
            '<div id="metaAnalysisRResult" style="display:none;margin-top:10px;padding:10px;border-radius:8px;background:rgba(16,163,127,0.08);font-size:12px;color:var(--text-primary);line-height:1.5;"></div>' +
            '<div class="meta-analysis-wizard-actions" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border-color);justify-content:flex-end;">' +
              '<button class="meta-analysis-wizard-btn danger" onclick="closeModal()">关闭</button>' +
              '<button id="metaAddOutcomeBtn" class="meta-analysis-wizard-btn" onclick="addPdfWikiMetaAnalysisOutcome()" title="新增一个因变量映射，用于自动识别不到字段或需要额外分析指标时手动配置。">添加因变量</button>' +
              '<button id="metaDownloadEffectBtn" class="meta-analysis-wizard-btn" onclick="downloadPdfWikiMetaAnalysisEffectCsv()" title="下载运行 Meta 分析后生成的效应量数据表。">下载效应量CSV</button>' +
              '<button id="metaGenericAnalysisBtn" class="meta-analysis-wizard-btn" onclick="runPdfWikiMetaEffectRowsDataAnalysis()" title="对已生成的效应量 CSV 做描述性统计、正态性和可视化预检，不重新计算 Meta 模型。">通用数据分析</button>' +
              '<button id="metaRunBtn" class="meta-analysis-wizard-btn primary" onclick="runPdfWikiMetaAnalysis()" title="按当前字段映射计算效应量，执行质量检查并生成 Meta 汇总和 R 脚本。">运行Meta分析</button>' +
              '<button id="metaRBtn" class="meta-analysis-wizard-btn primary" onclick="executePdfWikiMetaAnalysisR()" title="把上一步生成的效应量 CSV 和 R/metafor 脚本交给本机 R 插件，输出总体合并效应值和亚组 pooled 效应值。">执行R出图</button>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '</div>' +
          '</section>' +
          '</div>' +
          '<div class="meta-analysis-ai-panel meta-analysis-ai-input-panel">' +
            '<div class="input-wrapper meta-analysis-ai-input-wrapper">' +
              '<div id="metaAnalysisComposerExtras" class="meta-analysis-composer-slot"></div>' +
              '<div class="input-area-container meta-analysis-ai-composer">' +
                '<textarea id="metaAiUserRequest" class="chat-input meta-analysis-ai-input" rows="1" autocomplete="off" autocapitalize="off" spellcheck="false" oninput="autoResizePdfWikiMetaAiInput(this); updatePdfWikiMetaPiSendButtonState()" onkeydown="handlePdfWikiMetaAiInputKeydown(event)" placeholder="告诉 AI 你的 Meta 分析目标"></textarea>' +
                '<div class="composer-bottom-row">' +
                  '<div id="metaAnalysisComposerLeftActions" class="composer-left-actions"></div>' +
                  '<div class="composer-actions">' +
                    '<div id="metaAnalysisComposerProviderSlot" class="meta-analysis-composer-slot"></div>' +
                    '<button id="metaAiPlanBtn" class="send-btn" type="button" onclick="handlePdfWikiMetaAiSendAction()" title="发送" aria-label="发送">' +
                      '<svg id="metaAiSendIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"></path><path d="m5 12 7-7 7 7"></path></svg>' +
                      '<svg id="metaAiLoadingSpinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
                        '<circle cx="12" cy="12" r="9" stroke="#ffffff" stroke-width="2" opacity="0.28"></circle>' +
                        '<circle cx="12" cy="12" r="9" stroke="#ffffff" stroke-width="2.4" stroke-dasharray="42 16" stroke-linecap="round"></circle>' +
                      '</svg>' +
                    '</button>' +
                  '</div>' +
                '</div>' +
                '<button id="metaApplyAiPlanBtn" class="meta-analysis-wizard-btn" onclick="applyPdfWikiMetaAnalysisAiPlan()" disabled style="display:none;" title="内部按钮：把 AI 建议应用到下方字段映射。">应用建议</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="meta-analysis-wizard-footer">' +
          '<div class="meta-analysis-wizard-target">当前目标：已勾选 ' + pdfIds.length + ' 篇 PDF 的提取数据。</div>' +
          '</div>' +
        '</div>';
      showPdfWikiMetaAnalysisWizardModal(html);
      installPdfWikiMetaAnalysisHeaderStats(pdfIds.length, dataset.rowCount || 0, dataset.columnCount || 0);
      updatePdfWikiMetaAnalysisConversationLabel();
      renderPdfWikiMetaAiConversationHistorySelect();
      renderPdfWikiMetaAnalysisChat();
      installPdfWikiMetaSharedComposer();
      syncPdfWikiMetaPiQueueState({ claimWhenIdle: true });
      setTimeout(function() {
        var input = document.getElementById('metaAiUserRequest');
        if (input) window.autoResizePdfWikiMetaAiInput(input);
      }, 0);
    }

    function collectPdfWikiMetaAnalysisConfig() {
      var data = pdfWikiMetaAnalysisInspectData || {};
      var candidates = Array.isArray(data.candidateOutcomes) && data.candidateOutcomes.length
        ? data.candidateOutcomes
        : [{ id: 'outcome', label: '', mapping: {} }];
      var moderatorsSelect = document.getElementById('metaModeratorColumns');
      var moderatorColumns = moderatorsSelect
        ? Array.prototype.slice.call(moderatorsSelect.selectedOptions || []).map(function(option) { return option.value; }).filter(Boolean)
        : [];
      var subgroupColumnMap = {};
      var rangeRuleMap = {};
      var subgroupColumns = Object.keys(subgroupColumnMap);
      var outcomes = [];
      for (var i = 0; i < candidates.length; i++) {
        var enabled = document.getElementById('metaOutcome_' + i + '_enabled');
        if (enabled && !enabled.checked) continue;
        var labelInput = document.getElementById('metaOutcome_' + i + '_label');
        var measureInput = document.getElementById('metaOutcome_' + i + '_measure');
        var directionInput = document.getElementById('metaOutcome_' + i + '_direction');
        var outcome = {
          id: candidates[i].id || ('outcome_' + (i + 1)),
          label: labelInput ? labelInput.value.trim() : (candidates[i].label || ''),
          measure: measureInput ? measureInput.value : (candidates[i].measure || 'lnRR'),
          direction: directionInput ? Number(directionInput.value || '1') : 1,
          moderators: moderatorColumns
        };
        Array.prototype.slice.call(document.querySelectorAll('.meta-header-role-select[data-meta-outcome-index="' + i + '"]')).forEach(function(select) {
          var role = select.value || '';
          var column = select.getAttribute('data-meta-column') || '';
          if (role === 'subgroupAnalysis' && column) {
            subgroupColumnMap[column] = true;
            var card = select.closest ? select.closest('.meta-header-role-card') : null;
            var rangeInput = card ? card.querySelector('.meta-header-range-input') : null;
            var rangeSpec = rangeInput ? String(rangeInput.value || '').trim() : '';
            if (rangeSpec) rangeRuleMap[column] = rangeSpec;
          } else if (role && column) {
            outcome[role] = column;
          }
        });
        var requiredRoles = isPdfWikiMetaMeanOnlyMeasure(outcome.measure)
          ? ['treatmentMean', 'controlMean']
          : ['treatmentMean', 'treatmentSd', 'treatmentN', 'controlMean', 'controlSd', 'controlN'];
        var missing = requiredRoles.filter(function(role) { return !outcome[role]; });
        if (missing.length) {
          pdfWikiMetaAnalysisManualModeOpen = true;
          var manualDetails = document.getElementById('metaExpertManualMode');
          if (manualDetails) manualDetails.classList.add('open');
          var roleNames = {
            treatmentMean: '处理组均值',
            treatmentSd: '处理组SD',
            treatmentN: '处理组n',
            controlMean: '对照组均值',
            controlSd: '对照组SD',
            controlN: '对照组n'
          };
          alert('第 ' + (i + 1) + ' 个因变量缺少表头用途标注：' + missing.map(function(role) { return roleNames[role] || role; }).join('、'));
          return null;
        }
        outcomes.push(outcome);
      }
      subgroupColumns = Object.keys(subgroupColumnMap);
      var columnPreprocess = Object.keys(rangeRuleMap).map(function(column) {
        return { column: column, type: 'rangeGroups', spec: rangeRuleMap[column] };
      });
      if (outcomes.length === 0) {
        alert('请至少启用一个因变量。');
        return null;
      }
      var modelInput = document.getElementById('metaModelType');
      var studyInput = document.getElementById('metaStudyIdColumn');
      var clusterInput = document.getElementById('metaClusterBy');
      var excludeManualReviewInput = document.getElementById('metaExcludeManualReview');
      var recommended = data.recommendedConfig || {};
      return {
        model: modelInput ? modelInput.value : 'random',
        method: 'REML',
        studyIdColumn: studyInput ? studyInput.value : 'Study#',
        clusterBy: clusterInput ? clusterInput.value : (studyInput ? studyInput.value : 'Study#'),
        moderatorColumns: moderatorColumns,
        subgroupColumns: subgroupColumns,
        columnPreprocess: columnPreprocess,
        controlRules: Array.isArray(recommended.controlRules) ? recommended.controlRules : [],
        excludeManualReview: excludeManualReviewInput ? !!excludeManualReviewInput.checked : recommended.excludeManualReview !== false,
        manualReviewColumn: recommended.manualReviewColumn || '',
        outcomes: outcomes
      };
    }

    window.addPdfWikiMetaAnalysisOutcome = function() {
      if (!pdfWikiMetaAnalysisInspectData) return;
      if (!Array.isArray(pdfWikiMetaAnalysisInspectData.candidateOutcomes)) {
        pdfWikiMetaAnalysisInspectData.candidateOutcomes = [];
      }
      pdfWikiMetaAnalysisInspectData.candidateOutcomes.push({
        id: 'outcome_' + (pdfWikiMetaAnalysisInspectData.candidateOutcomes.length + 1),
        label: '',
        measure: 'lnRR',
        mapping: {},
        completeRows: 0,
        totalRows: pdfWikiMetaAnalysisInspectData.dataset ? pdfWikiMetaAnalysisInspectData.dataset.rowCount : 0,
        warnings: ['手动新增因变量，请映射 6 个效应量字段。']
      });
      pdfWikiMetaAnalysisManualModeOpen = true;
      renderPdfWikiMetaAnalysisWizard(pdfWikiMetaAnalysisInspectData, pdfWikiMetaAnalysisTargetPdfIds);
    };

    window.openPdfWikiMetaAnalysisWizard = async function() {
      var pdfIds = getPdfWikiMetaAnalysisTargetPdfIds();
      if (pdfIds.length < 2) {
        alert('请先在 Meta 列表中勾选至少 2 篇文献的提取数据，再进行 Meta 分析。当前已勾选 ' + pdfIds.length + ' 篇。');
        return;
      }
      pdfWikiMetaAnalysisTargetPdfIds = pdfIds;
      selectMainMetaAnalysisPdfData(pdfIds);
      setMainContextSourceSelected('metaAnalysis', true);
      setMainAnalysisWorkflowReturnContext(null);
      setMainMetaAnalysisReturnContext({
        conversationId: currentConversationId || '',
        pdfIds: pdfIds,
        selectedPdfId: pdfWikiMetaSelectedPdfId || pdfIds[0] || '',
        searchTerm: pdfWikiMetaSearchTerm || ''
      });
      await fetch('/api/meta-analysis/active-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId || 'web-user' })
      }).catch(function(error) {
        console.warn('[MetaAnalysis] Failed to persist active user during homepage handoff:', error);
      });
      var workspaceDirectory = getWorkspaceDirectoryPayload(currentConversationId);
      await prepareSelectedAnalysisWorkspaceFolders(
        workspaceDirectory,
        null,
        null,
        'metaAnalysis'
      );
      if (typeof window.closePdfWikiViewer === 'function') window.closePdfWikiViewer();
      collapseMainContextSourceBar();
      renderMainContextSourceBar();
      setTimeout(function() {
        if (typeof restoreMainChatInputInteractivity === 'function') restoreMainChatInputInteractivity();
        syncMainSelectedAnalysisInputPlaceholder('metaAnalysis').finally(function() {
          if (!userInput) return;
          try {
            userInput.focus({ preventScroll: true });
          } catch (error) {
            userInput.focus();
          }
        });
        if (typeof maybeScrollChatToBottom === 'function') maybeScrollChatToBottom(true);
      }, 0);
    };

    window.runPdfWikiMetaAnalysis = async function() {
      var config = collectPdfWikiMetaAnalysisConfig();
      if (!config) return null;
      setPdfWikiMetaAnalysisBusy(true, 'metaRunBtn');
      setPdfWikiMetaAnalysisStatusText('正在准备 Meta 分析...');
      appendPdfWikiMetaAnalysisLog('已读取页面配置：模型=' + config.model + '，因变量=' + config.outcomes.length + ' 个。', 'info');
      try {
        appendPdfWikiMetaAnalysisLog('正在提交到 /api/meta-analysis/run。', 'info');
        var metaWorkspaceDirectory = getWorkspaceDirectoryPayload(currentConversationId);
        var response = await fetch('/api/meta-analysis/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            conversationId: currentConversationId || '',
            workspaceId: pdfWikiMetaAnalysisConversationId || '',
            pdfIds: pdfWikiMetaAnalysisTargetPdfIds,
            workspaceDirectory: metaWorkspaceDirectory,
            config: config
          })
        });
        appendPdfWikiMetaAnalysisLog('后端已返回响应，正在解析质量检查和效应量表。', 'info');
        var result = await readPdfWikiMetaJsonResponse(response, 'Meta 分析运行');
        pdfWikiMetaAnalysisLastRun = result.data;
        pdfWikiMetaAnalysisLastRun.workspaceDirectory = metaWorkspaceDirectory;
        appendPdfWikiMetaAnalysisLog('Meta 分析完成：有效效应量 ' + ((result.data.effectRows || []).length || 0) + ' 行，跳过 ' + Number(result.data.skippedCount || 0) + ' 个组合。', 'done');
        appendPdfWikiMetaAnalysisHistoryMessage(
          'assistant',
          '## Meta 分析结果\n\n' + (result.data.markdown || 'Meta 分析已完成。')
        );
        return result.data;
      } catch (error) {
        var diagnostic = formatPdfWikiMetaSkippedRowsDiagnostic(error.metaData);
        appendPdfWikiMetaAnalysisLog('Meta 分析失败：' + (error.message || String(error)) + diagnostic, 'error');
        appendPdfWikiMetaAnalysisHistoryMessage(
          'assistant',
          '## Meta 分析失败\n\n' + (error.message || String(error)) + diagnostic
        );
        alert('Meta 分析失败：' + (error.message || String(error)));
        return null;
      } finally {
        setPdfWikiMetaAnalysisBusy(false);
      }
    };

    window.executePdfWikiMetaAnalysisR = async function() {
      if (!pdfWikiMetaAnalysisLastRun) {
        appendPdfWikiMetaAnalysisLog('尚未生成效应量表，先自动运行 Meta 分析。', 'info');
        await window.runPdfWikiMetaAnalysis();
      }
      if (!pdfWikiMetaAnalysisLastRun || !pdfWikiMetaAnalysisLastRun.rCode || !pdfWikiMetaAnalysisLastRun.effectRowsCsv) return;
      setPdfWikiMetaAnalysisBusy(true, 'metaRBtn');
      appendPdfWikiMetaAnalysisLog('正在把 meta_effect_sizes.csv 和 R 脚本发送给本机 R 插件。', 'info');
      var file = new File([pdfWikiMetaAnalysisLastRun.effectRowsCsv], pdfWikiMetaAnalysisLastRun.effectRowsFilename || 'meta_effect_sizes.csv', { type: 'text/csv;charset=utf-8' });
      try {
        var output = await executeGeneratedRPlot({
          rCode: pdfWikiMetaAnalysisLastRun.rCode,
          file: file,
          dataFilename: 'meta_effect_sizes.csv',
          originalFilename: 'meta-analysis.R',
          label: 'Meta分析 R 图表',
          workspaceDirectory: pdfWikiMetaAnalysisLastRun.workspaceDirectory || getWorkspaceDirectoryPayload(currentConversationId),
          workspaceOutputType: 'meta-analysis',
          workspaceOutputId: pdfWikiMetaAnalysisLastRun.analysisId || '',
          resultDiv: document.getElementById('metaAnalysisRResult'),
          suppressChatMessage: true,
          onStatus: function(message) {
            appendPdfWikiMetaAnalysisLog(message, 'info');
          },
          onSuccess: function(execData, markdown) {
            var files = execData && Array.isArray(execData.files) ? execData.files : [];
            appendPdfWikiMetaAnalysisLog('R 出图完成：生成 ' + files.length + ' 个图表/结果文件。右侧可打开图表链接。', 'done');
            fetch('/api/meta-analysis/r-artifacts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: currentUserId || 'web-user',
                analysisId: pdfWikiMetaAnalysisLastRun && pdfWikiMetaAnalysisLastRun.analysisId ? pdfWikiMetaAnalysisLastRun.analysisId : '',
                conversationId: pdfWikiMetaAnalysisLastRun && pdfWikiMetaAnalysisLastRun.conversationId
                  ? pdfWikiMetaAnalysisLastRun.conversationId
                  : (currentConversationId || ''),
                markdown: markdown || '',
                jobId: execData && execData.jobId ? execData.jobId : '',
                files: execData && Array.isArray(execData.files) ? execData.files : [],
                imageFiles: execData && Array.isArray(execData.imageFiles) ? execData.imageFiles : [],
                supportFiles: execData && Array.isArray(execData.supportFiles) ? execData.supportFiles : [],
                workDir: execData && execData.workDir ? execData.workDir : '',
                plotDir: execData && execData.plotDir ? execData.plotDir : ''
              })
            }).catch(function(error) {
              console.warn('[MetaAnalysis] Failed to persist R artifacts context:', error);
            });
            appendPdfWikiMetaAnalysisHistoryMessage(
              'assistant',
              '## Meta 分析 R 图表已生成\n\n' + renderRArtifactChatSummary(execData),
              { rArtifacts: snapshotPdfWikiMetaRArtifacts(execData) }
            );
          },
          onError: function(message) {
            appendPdfWikiMetaAnalysisLog('R 自动出图失败：' + message, 'error');
            appendPdfWikiMetaAnalysisHistoryMessage('assistant', '## R 自动出图失败\n\n' + message);
          }
        });
        if (!output) {
          appendPdfWikiMetaAnalysisLog('R 出图未完成，请查看右侧 R 结果提示。', 'error');
        }
      } finally {
        setPdfWikiMetaAnalysisBusy(false);
      }
    };

    window.downloadPdfWikiMetaAnalysisEffectCsv = function() {
      if (!pdfWikiMetaAnalysisLastRun || !pdfWikiMetaAnalysisLastRun.effectRowsCsv) {
        alert('请先运行 Meta 分析。');
        return;
      }
      var blob = new Blob([pdfWikiMetaAnalysisLastRun.effectRowsCsv], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = pdfWikiMetaAnalysisLastRun.effectRowsFilename || 'meta_effect_sizes.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    window.runPdfWikiMetaEffectRowsDataAnalysis = async function() {
      if (!pdfWikiMetaAnalysisLastRun) {
        appendPdfWikiMetaAnalysisLog('尚未生成效应量表，先自动运行 Meta 分析。', 'info');
        await window.runPdfWikiMetaAnalysis();
      }
      if (!pdfWikiMetaAnalysisLastRun || !pdfWikiMetaAnalysisLastRun.effectRowsCsv) return;
      setPdfWikiMetaAnalysisBusy(true, 'metaGenericAnalysisBtn');
      appendPdfWikiMetaAnalysisLog('正在调用通用数据分析工作台，对效应量表做描述性统计。', 'info');
      try {
        var file = new File([pdfWikiMetaAnalysisLastRun.effectRowsCsv], 'meta_effect_sizes.csv', { type: 'text/csv;charset=utf-8' });
        var formData = new FormData();
        formData.append('file', file);
        formData.append('userId', currentUserId || 'web-user');
        formData.append('methods', JSON.stringify(['descriptive', 'normality', 'visualization']));
        formData.append('numericVar', 'yi');
        formData.append('groupVar', 'outcome_label');
        formData.append('extraQuery', '这是 Meta 分析效应量数据表：yi 为效应量，vi/sei/weight 为方差信息；请重点检查缺失、离群、因变量分布和后续作图上下文。');
        var response = await fetch('/api/data-analysis/analyze', { method: 'POST', body: formData });
        var result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '通用数据分析失败');
        appendPdfWikiMetaAnalysisHistoryMessage(
          'assistant',
          '## Meta 效应量表通用数据分析\n\n' + (result.data && result.data.result ? result.data.result.markdown : '已完成。')
        );
        appendPdfWikiMetaAnalysisLog('通用数据分析完成，结果已发送到对话区。', 'done');
      } catch (error) {
        appendPdfWikiMetaAnalysisLog('通用数据分析失败：' + (error.message || String(error)), 'error');
        appendPdfWikiMetaAnalysisHistoryMessage('assistant', '## 通用数据分析失败\n\n' + (error.message || String(error)));
        alert('通用数据分析失败：' + (error.message || String(error)));
      } finally {
        setPdfWikiMetaAnalysisBusy(false);
      }
    };

    window.exportPdfWikiMetaSelectedTables = async function() {
      var pdfIds = getPdfWikiMetaSelectedDataPdfIds();
      if (pdfIds.length === 0) {
        alert('请先勾选需要导出的 PDF 整合数据表');
        return;
      }
      try {
        var response = await fetch('/api/pdf-wiki/meta/tables/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, pdfIds: pdfIds })
        });
        if (!response.ok) {
          var errorText = await response.text();
          try {
            var errorJson = JSON.parse(errorText);
            throw new Error(errorJson.error || '导出失败');
          } catch (parseError) {
            throw new Error(errorText || '导出失败');
          }
        }
        var blob = await response.blob();
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'pdf-wiki-meta-analysis-data.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        alert('导出失败：' + e.message);
      }
    };

    window.deletePdfWikiMetaSelectedItems = async function() {
      var pdfIds = getPdfWikiMetaSelectedDataPdfIds();
      if (pdfIds.length === 0) {
        alert('请先勾选需要删除的 Meta分析条目');
        return;
      }
      if (!confirm('确认从 Meta分析删除已勾选的 ' + pdfIds.length + ' 个条目？这不会删除 PDF 文件和 Wiki 论点库，只会让这些 PDF 不再出现在 Meta分析中。')) {
        return;
      }
      try {
        var response = await fetch('/api/pdf-wiki/meta/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, pdfIds: pdfIds })
        });
        var data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || '删除失败');
        }
        pdfWikiMetaSelectedDataPdfIds = {};
        await reloadPdfWikiMetaDatabase();
      } catch (e) {
        alert('删除失败：' + e.message);
      }
    };

    async function deletePdfWikiMetaCodingTableSelection(payload, confirmMessage) {
      if (!pdfWikiMetaSelectedPdfId) {
        alert('请先选择一个 PDF');
        return;
      }
      if (confirmMessage && !confirm(confirmMessage)) return;
      try {
        var response = await fetch('/api/pdf-wiki/meta/coding-table/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({
            userId: currentUserId,
            pdfId: pdfWikiMetaSelectedPdfId
          }, payload || {}))
        });
        var data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || '删除失败');
        }
        if (payload && Array.isArray(payload.rowIndexes) && payload.rowIndexes.length) {
          delete pdfWikiMetaSelectedCodingRows[pdfWikiMetaSelectedPdfId];
        }
        if (payload && Array.isArray(payload.columns) && payload.columns.length) {
          pdfWikiMetaSelectedCodingColumns = {};
        }
        await reloadPdfWikiMetaDatabase(data.pdfId || pdfWikiMetaSelectedPdfId);
      } catch (e) {
        alert('删除失败：' + e.message);
      }
    }

    window.deleteSelectedPdfWikiMetaCodingSelection = function() {
      var pdfId = pdfWikiMetaSelectedPdfId;
      var rowIndexes = getPdfWikiMetaSelectedCodingRowIndexes(pdfId);
      var columns = getPdfWikiMetaSelectedCodingColumns();
      if (rowIndexes.length === 0 && columns.length === 0) {
        alert('请先在 Meta 编码表中勾选需要删除的行或列');
        return;
      }
      var selectedParts = [];
      if (rowIndexes.length) selectedParts.push(rowIndexes.length + ' 行');
      if (columns.length) selectedParts.push(columns.length + ' 列');
      var confirmMessage = '确认删除当前选择的 ' + selectedParts.join('、') + '？';
      if (rowIndexes.length) confirmMessage += '\n\n所选行只会从当前 PDF 的 Meta 编码表中删除。';
      if (columns.length) confirmMessage += '\n\n所选列会从全局 Meta 模板及所有 PDF 的已存编码行中移除；Obs#、Study# 和来源追踪字段不会删除。';
      deletePdfWikiMetaCodingTableSelection(
        { rowIndexes: rowIndexes, columns: columns },
        confirmMessage
      );
    };

    window.triggerPdfWikiMetaUpload = function() {
      var input = document.getElementById('metaPdfFileInput');
      if (!input) {
        alert('Meta PDF 上传控件未加载，请刷新页面后重试。');
        return;
      }
      input.value = '';
      input.click();
    };

    async function handleMetaPdfFileInputChange(e) {
      var selectedFiles = Array.prototype.slice.call((e && e.target && e.target.files) || []);
      if (selectedFiles.length === 0) return;
      var pdfFiles = selectedFiles.filter(function(file) {
        return /\.pdf$/i.test(file.name || '') || String(file.type || '').toLowerCase().indexOf('pdf') !== -1;
      });
      if (pdfFiles.length === 0) {
        alert('请上传 PDF 文件');
        e.target.value = '';
        return;
      }

      var taskOptions = getDefaultPdfWikiUploadOptions();
      var formData = new FormData();
      pdfFiles.forEach(function(file) { formData.append('files', file); });
      formData.append('userId', currentUserId);
      formData.append('force', 'true');
      formData.append('pdfWikiTextExtractionEngine', taskOptions.textExtractionEngine || 'auto');
      formData.append('pdfWikiMetadataEngine', taskOptions.metadataEngine || 'auto');
      formData.append('pdfWikiMetaAnalysisEnabled', 'true');
      formData.append('pdfWikiMetaAnalysisEngine', taskOptions.metaAnalysisEngine && taskOptions.metaAnalysisEngine !== 'off' ? taskOptions.metaAnalysisEngine : 'auto');
      formData.append('pdfWikiMetaAnalysisUserRequirements', getPdfWikiMetaUserRequirementsForRequest());
      var pdfWikiLlmConfig = getPdfWikiLlmConfig();
      if (pdfWikiLlmConfig.apiUrl) formData.append('pdfWikiApiUrl', pdfWikiLlmConfig.apiUrl);
      if (pdfWikiLlmConfig.apiKey) formData.append('pdfWikiApiKey', pdfWikiLlmConfig.apiKey);
      if (pdfWikiLlmConfig.textInApiUrl) formData.append('pdfWikiTextInApiUrl', pdfWikiLlmConfig.textInApiUrl);
      if (pdfWikiLlmConfig.textInAppId) formData.append('pdfWikiTextInAppId', pdfWikiLlmConfig.textInAppId);
      if (pdfWikiLlmConfig.textInSecretCode) formData.append('pdfWikiTextInSecretCode', pdfWikiLlmConfig.textInSecretCode);
      if (pdfWikiLlmConfig.textInParseMode) formData.append('pdfWikiTextInParseMode', pdfWikiLlmConfig.textInParseMode);

      try {
        pdfWikiMetaExtractionRunning = true;
        var metaUploadStartedAt = new Date().toISOString();
        pdfWikiMetaExtractionProgress = {
          status: 'processing',
          queuedCount: pdfFiles.length,
          totalPdfs: pdfFiles.length,
          processedPdfs: 0,
          metaRowCount: 0,
          tableCount: 0,
          figureCount: 0,
          workerConcurrency: getPdfWikiMetaConfiguredCodexConcurrency(pdfFiles.length),
          codexWorkers: createPdfWikiMetaInitialCodexWorkers(pdfFiles.length, '正在上传 PDF 并启动 Meta 数据提取...'),
          message: '正在上传 PDF 并启动 Meta 数据提取...',
          startedAt: metaUploadStartedAt,
          updatedAt: metaUploadStartedAt
        };
        startPdfWikiMetaElapsedTimer();
        renderActivePdfWikiWorkspace();
        var response = await fetch('/api/pdf-wiki/meta/upload', {
          method: 'POST',
          body: formData
        });
        var result = await readPdfWikiMetaJsonResponse(response, 'Meta PDF 上传');
        pdfWikiMetaExtractionProgress.message = result.message || '已启动 Meta 数据提取任务';
        updatePdfWikiMetaExtractionStatusBarOnly();
        await waitForPdfWikiMetaExtraction('upload');
      } catch (error) {
        pdfWikiMetaExtractionRunning = false;
        stopPdfWikiMetaElapsedTimer();
        pdfWikiMetaExtractionProgress = {
          status: 'error',
          totalPdfs: pdfFiles.length,
          processedPdfs: 0,
          message: error.message || 'Meta PDF 上传失败',
          startedAt: pdfWikiMetaExtractionProgress && pdfWikiMetaExtractionProgress.startedAt,
          updatedAt: new Date().toISOString()
        };
        if (!updatePdfWikiMetaExtractionStatusBarOnly()) renderActivePdfWikiWorkspace();
        alert('Meta PDF 上传失败：' + error.message);
      } finally {
        e.target.value = '';
      }
    }

    function renderActivePdfWikiWorkspace() {
      if (pdfWikiPdfManagerData && document.getElementById('pdfWikiPdfManagerScroll')) {
        renderPdfWikiPdfManagerPreservingScroll();
        return;
      }
      if (pdfWikiMetaDatabaseData && document.getElementById('pdfWikiViewerContent')) {
        renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
      }
    }

    async function startPdfWikiMetaExtraction(pdfIds) {
      pdfIds = (pdfIds || []).filter(Boolean);
      if (pdfIds.length === 0 || pdfWikiMetaExtractionRunning) return;
      var taskOptions = getDefaultPdfWikiUploadOptions();
      pdfWikiMetaExtractionRunning = true;
      var metaExtractStartedAt = new Date().toISOString();
      pdfWikiMetaExtractionProgress = {
        status: 'processing',
        totalPdfs: pdfIds.length,
        processedPdfs: 0,
        metaRowCount: 0,
        tableCount: 0,
        figureCount: 0,
        workerConcurrency: getPdfWikiMetaConfiguredCodexConcurrency(pdfIds.length),
        codexWorkers: createPdfWikiMetaInitialCodexWorkers(pdfIds.length, '正在启动选中 PDF 的 Meta 数据提取...'),
        message: '正在启动选中 PDF 的 Meta 数据提取...',
        startedAt: metaExtractStartedAt,
        updatedAt: metaExtractStartedAt
      };
      startPdfWikiMetaElapsedTimer();
      renderActivePdfWikiWorkspace();
      try {
        var pdfWikiLlmConfig = getPdfWikiLlmConfig();
        var response = await fetch('/api/pdf-wiki/meta/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            pdfIds: pdfIds,
            force: true,
            pdfWikiTextExtractionEngine: taskOptions.textExtractionEngine || 'auto',
            pdfWikiMetadataEngine: taskOptions.metadataEngine || 'auto',
            pdfWikiMetaAnalysisEnabled: 'true',
            pdfWikiMetaAnalysisEngine: taskOptions.metaAnalysisEngine && taskOptions.metaAnalysisEngine !== 'off' ? taskOptions.metaAnalysisEngine : 'auto',
            pdfWikiMetaAnalysisUserRequirements: getPdfWikiMetaUserRequirementsForRequest(),
            pdfWikiApiUrl: pdfWikiLlmConfig.apiUrl || '',
            pdfWikiApiKey: pdfWikiLlmConfig.apiKey || '',
            pdfWikiTextInApiUrl: pdfWikiLlmConfig.textInApiUrl || '',
            pdfWikiTextInAppId: pdfWikiLlmConfig.textInAppId || '',
            pdfWikiTextInSecretCode: pdfWikiLlmConfig.textInSecretCode || '',
            pdfWikiTextInParseMode: pdfWikiLlmConfig.textInParseMode || ''
          })
        });
        var result = await readPdfWikiMetaJsonResponse(response, '批量提取 Meta 数据');
        pdfWikiMetaExtractionProgress.message = result.message || '已启动 Meta 数据提取任务';
        updatePdfWikiMetaExtractionStatusBarOnly();
        await waitForPdfWikiMetaExtraction('extract');
      } catch (error) {
        pdfWikiMetaExtractionRunning = false;
        stopPdfWikiMetaElapsedTimer();
        pdfWikiMetaExtractionProgress = {
          status: 'error',
          totalPdfs: pdfIds.length,
          processedPdfs: 0,
          message: error.message || '批量提取失败',
          startedAt: pdfWikiMetaExtractionProgress && pdfWikiMetaExtractionProgress.startedAt,
          updatedAt: new Date().toISOString()
        };
        if (!updatePdfWikiMetaExtractionStatusBarOnly()) renderActivePdfWikiWorkspace();
        alert('批量提取失败：' + error.message);
      }
    }

    async function waitForPdfWikiMetaExtraction(source) {
      var startedAt = Date.now();
      var timeoutMs = 30 * 60 * 1000;
      var timeoutNoticeShown = false;
      await new Promise(function(resolve) {
        var timer = setInterval(async function() {
          try {
            var response = await fetch('/api/pdf-wiki/status?userId=' + encodeURIComponent(currentUserId));
            var status = await readPdfWikiMetaJsonResponse(response, 'Meta 提取进度');
            pdfWikiMetaExtractionProgress = normalizePdfWikiMetaExtractionProgress(status);
            if (!updatePdfWikiMetaExtractionStatusBarOnly()) renderActivePdfWikiWorkspace();
            if (isPdfWikiMetaExtractionComplete(pdfWikiMetaExtractionProgress) || pdfWikiMetaExtractionProgress.status === 'error') {
              clearInterval(timer);
              resolve(undefined);
              return;
            }
            if (!timeoutNoticeShown && Date.now() - startedAt > timeoutMs) {
              timeoutNoticeShown = true;
              pdfWikiMetaExtractionProgress = Object.assign({}, pdfWikiMetaExtractionProgress || {}, {
                status: 'processing',
                message: '任务耗时已超过 30 分钟，但后台仍在处理或等待 Codex worker 输出；不会再误标为完成。' + (pdfWikiMetaExtractionProgress && pdfWikiMetaExtractionProgress.message ? ' ' + pdfWikiMetaExtractionProgress.message : '')
              });
              if (!updatePdfWikiMetaExtractionStatusBarOnly()) renderActivePdfWikiWorkspace();
            }
          } catch (error) {
            console.warn('[PdfWikiMeta] Progress poll failed:', error);
            pdfWikiMetaExtractionProgress = Object.assign({}, pdfWikiMetaExtractionProgress || {}, {
              status: 'error',
              message: error.message || 'Meta 提取进度读取失败'
            });
            if (!updatePdfWikiMetaExtractionStatusBarOnly()) renderActivePdfWikiWorkspace();
            if (/没有返回 JSON|HTTP 404|Cannot\s+(GET|POST)/i.test(error.message || '')) {
              clearInterval(timer);
              resolve(undefined);
              return;
            }
            if (Date.now() - startedAt > timeoutMs) {
              clearInterval(timer);
              resolve(undefined);
            }
          }
        }, 1000);
      });

      pdfWikiMetaExtractionRunning = false;
      if (pdfWikiMetaExtractionProgress && pdfWikiMetaExtractionProgress.status !== 'error') {
        pdfWikiMetaExtractionProgress = normalizePdfWikiMetaExtractionProgress(pdfWikiMetaExtractionProgress);
      }
      if (pdfWikiMetaExtractionProgress && !pdfWikiMetaExtractionProgress.updatedAt) {
        pdfWikiMetaExtractionProgress.updatedAt = new Date().toISOString();
      }
      updatePdfWikiMetaExtractionStatusBarOnly();
      stopPdfWikiMetaElapsedTimer();
      if (document.getElementById('pdfWikiViewerModal')) {
        if (document.getElementById('pdfWikiPdfManagerScroll') && pdfWikiPdfManagerData) {
          await reloadPdfWikiPdfManager();
        } else if (pdfWikiMetaDatabaseData) {
          await reloadPdfWikiMetaDatabase(pdfWikiMetaSelectedPdfId);
        }
      }
    }

    window.extractSelectedPdfWikiMetaData = function() {
      var pdfIds = getPdfWikiMetaSelectedDataPdfIds();
      if (pdfIds.length === 0) {
        alert('请先勾选需要批量提取 Meta 数据的 PDF');
        return;
      }
      startPdfWikiMetaExtraction(pdfIds);
    };

    window.extractCurrentPdfWikiMetaData = function() {
      var pdfId = pdfWikiMetaSelectedPdfId;
      if (!pdfId) {
        alert('请先选择一个 PDF');
        return;
      }
      startPdfWikiMetaExtraction([pdfId]);
    };

    window.extractSelectedPdfWikiPdfManagerMetaData = function() {
      var pdfIds = getPdfWikiSelectedPdfIds();
      if (pdfIds.length === 0) {
        alert('请先在 PDF 管理中勾选需要提取 Meta 数据的 PDF');
        return;
      }
      startPdfWikiMetaExtraction(pdfIds);
    };

    window.openPdfWikiDigitizationReview = function(pdfId, figureIndex) {
      var item = getPdfWikiMetaItemById(pdfId) || { pdfId: pdfId, metaData: {} };
      var figures = getPdfWikiMetaSourceFigures(item);
      var figure = Number(figureIndex) >= 0 ? figures[Number(figureIndex)] : null;
      var fallbackLabel = figure ? getPdfWikiMetaFigureLabel(figure, Number(figureIndex)) : '';
      var preview = figure ? getPdfWikiMetaFigurePreview(item, figure, Number(figureIndex)) : null;
      var page = figure && (figure.page || figure.pages || figure.page_number || '');
      var note = figure && (figure.note || figure.description || figure.caption || '');
      var axisHeaderControlHtml =
        '<label>X最小<input id="digitizerXMinValue" class="pdf-wiki-digitization-input" value="0" inputmode="decimal" onpointerdown="focusPdfWikiDigitizationInput(this,event)" onmousedown="event.stopPropagation()" onclick="focusPdfWikiDigitizationInput(this,event)" onkeydown="event.stopPropagation()"></label>' +
        '<label>X最大<input id="digitizerXMaxValue" class="pdf-wiki-digitization-input" value="1" inputmode="decimal" onpointerdown="focusPdfWikiDigitizationInput(this,event)" onmousedown="event.stopPropagation()" onclick="focusPdfWikiDigitizationInput(this,event)" onkeydown="event.stopPropagation()"></label>' +
        '<label>Y最小<input id="digitizerYMinValue" class="pdf-wiki-digitization-input" value="0" inputmode="decimal" onpointerdown="focusPdfWikiDigitizationInput(this,event)" onmousedown="event.stopPropagation()" onclick="focusPdfWikiDigitizationInput(this,event)" onkeydown="event.stopPropagation()"></label>' +
        '<label>Y最大<input id="digitizerYMaxValue" class="pdf-wiki-digitization-input" value="1" inputmode="decimal" onpointerdown="focusPdfWikiDigitizationInput(this,event)" onmousedown="event.stopPropagation()" onclick="focusPdfWikiDigitizationInput(this,event)" onkeydown="event.stopPropagation()"></label>' +
        '<button type="button" onclick="setInternalDigitizerMode(\'point\')" style="border:1px solid #9ca3af !important;border-radius:6px;background:var(--bg-secondary);">采点</button>' +
        '<button type="button" onclick="undoInternalDigitizerPoint()" style="border:1px solid #9ca3af !important;border-radius:6px;background:var(--bg-secondary);">撤销</button>' +
        '<button type="button" onclick="clearInternalDigitizerPoints()" style="border:1px solid #9ca3af !important;border-radius:6px;background:var(--bg-secondary);">清空</button>';
      var axisControlHtml =
        '<div style="min-width:0;display:flex;flex-direction:column;flex:1;min-height:0;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">' +
            '<div style="font-size:12px;font-weight:800;color:#064e3b;">内置数据提取</div>' +
            '<div style="font-size:11px;color:#475569;">校准后采点</div>' +
          '</div>' +
          '<div id="pdfWikiDigitizerOverlayHint" style="padding:7px 9px;margin-bottom:7px;border:1px solid rgba(16,163,127,0.35);border-radius:7px;background:#ecfdf5;color:#064e3b;font-size:11.5px;line-height:1.4;">当前：点击 X最小轴刻度点。先完成四点校准，再采集数据点。</div>' +
          '<div class="pdf-wiki-inline-control-row" style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px;align-items:center;margin-top:6px;">' +
            '<select id="digitizationAggregationMode" style="min-width:0;padding:7px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#0f172a;font-size:11px;">' +
              '<option value="none">保留每个采点</option>' +
              '<option value="meanAll">全部采点求均值</option>' +
              '<option value="sumAll">全部采点求和</option>' +
              '<option value="sdAll">全部采点计算 SD</option>' +
              '<option value="meanByTreatmentSeries">按子图/处理/系列求均值</option>' +
              '<option value="sumByTreatmentSeries">按子图/处理/系列求和</option>' +
              '<option value="sdByTreatmentSeries">按子图/处理/系列计算 SD</option>' +
              '<option value="meanByTreatmentSeriesX">按子图/处理/系列/X 求均值</option>' +
              '<option value="sumByTreatmentSeriesX">按子图/处理/系列/X 求和</option>' +
              '<option value="sdByTreatmentSeriesX">按子图/处理/系列/X 计算 SD</option>' +
            '</select>' +
            '<button id="digitizationCalculateBtn" type="button" onclick="calculateInternalDigitizerPoints()" style="padding:0 9px;border:1px solid #111827 !important;border-radius:6px;background:#111827 !important;color:#ffffff !important;font-size:11px;cursor:pointer;white-space:nowrap;">计算</button>' +
          '</div>' +
          '<div id="digitizationCalculationStatus" aria-live="polite" style="display:none;"></div>' +
          '<div id="pdfWikiInternalDigitizerPointsList" style="margin-top:6px;flex:1;min-height:200px;height:auto;overflow:auto;border:1px dashed #cbd5e1;border-radius:5px;background:#fff;padding:5px 6px;font-size:10.5px;line-height:1.4;color:#475569;">暂无采点。</div>' +
        '</div>';
      pendingPdfWikiDigitizationImport = {
        pdfId: pdfId,
        figureKey: String((figure && (figure.id || figure.figure_id || figure.figureId || figure.number)) || ''),
        figureLabel: String(fallbackLabel || '待复核图件'),
        figureIndex: Number(figureIndex),
        previewUrl: preview && preview.url ? String(preview.url) : ''
      };
      pendingPdfWikiDigitizationFile = null;
      pdfWikiDigitizationCurrentPdfId = pdfId;
      pdfWikiDigitizationPendingValues = [];
      pdfWikiDigitizationPendingValueSelection = {};
      pdfWikiDigitizationTargetCell = null;
      pdfWikiDigitizationFrozenColumns = {};
      pdfWikiDigitizationHiddenColumns = {};
      pdfWikiDigitizationHideColumnSelection = {};
      pdfWikiDigitizationEvidenceSaved = false;

      var imageHtml = preview && preview.url
        ? '<div style="display:flex;flex-direction:column;gap:8px;min-height:0;">' +
            '<div style="display:grid;grid-template-columns:minmax(230px,280px) minmax(0,1fr);gap:10px;align-items:start;">' +
              '<aside style="height:520px;min-height:520px;box-sizing:border-box;overflow:auto;display:flex;flex-direction:column;gap:8px;border:1px solid rgba(15,118,110,0.35);border-radius:8px;background:rgba(248,250,252,0.98);box-shadow:0 4px 14px rgba(15,23,42,0.08);padding:8px;color:#0f172a;">' +
                '<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:7px;">' +
                  '<div style="min-width:0;font-size:12px;font-weight:800;color:#064e3b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(fallbackLabel || '待复核图件') + '</div>' +
                  '<div style="font-size:10.5px;color:#475569;line-height:1.35;max-height:42px;overflow:auto;">' + escapeHtml([page ? ('页码/位置：' + page) : '', note || ''].filter(Boolean).join('；')) + '</div>' +
                  '<div style="font-size:10.5px;line-height:1.35;color:#475569;">左键校准/采点；Ctrl + 滚轮缩放；右键拖动平移。</div>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px;">' +
                    '<a href="' + escapeHtml(preview.url) + '" target="_blank" rel="noopener" style="padding:4px 7px;border:1px solid rgba(15,118,110,0.28);border-radius:6px;color:#0f766e;text-decoration:none;font-size:11px;background:white;">打开原图</a>' +
                    '<a href="' + escapeHtml(preview.url) + '" download style="padding:4px 7px;border:1px solid rgba(15,118,110,0.28);border-radius:6px;color:#0f766e;text-decoration:none;font-size:11px;background:white;">下载图片</a>' +
                  '</div>' +
                '</div>' +
                axisControlHtml +
              '</aside>' +
              '<section style="min-width:0;display:flex;flex-direction:column;gap:6px;">' +
                '<div style="display:grid;grid-template-columns:minmax(0,1.75fr) minmax(240px,0.66fr) minmax(205px,0.42fr);gap:9px;align-items:stretch;min-height:520px;">' +
                  '<div id="pdfWikiDigitizerCanvasWrap" style="position:relative;height:520px;min-height:520px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);overflow:hidden;">' +
                    '<canvas id="pdfWikiDigitizerCanvas" onclick="handleInternalDigitizerCanvasClick(event)" onmousedown="handleInternalDigitizerCanvasMouseDown(event)" onmousemove="handleInternalDigitizerCanvasMove(event)" onmouseup="stopInternalDigitizerPan(event)" oncontextmenu="handleInternalDigitizerCanvasContextMenu(event)" onwheel="handleInternalDigitizerCanvasWheel(event)" onmouseleave="handleInternalDigitizerCanvasLeave(event)" style="width:100%;height:100%;display:block;cursor:crosshair;"></canvas>' +
                  '</div>' +
                  '<div style="height:520px;min-height:520px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:8px;display:flex;flex-direction:column;gap:6px;min-width:0;">' +
                    '<div style="font-size:12px;font-weight:800;color:var(--text-primary);">局部放大</div>' +
                    '<canvas id="pdfWikiDigitizerMagnifierCanvas" style="width:100%;height:405px;display:block;border:1px solid var(--border-color);border-radius:7px;background:#f8fafc;"></canvas>' +
                    '<div id="pdfWikiDigitizerMagnifierStatus" style="font-size:10.5px;line-height:1.4;color:var(--text-secondary);">把鼠标移到左侧图片上查看局部放大。</div>' +
                  '</div>' +
                  renderPdfWikiDigitizationCodingControlPanel(item) +
                '</div>' +
              '</section>' +
            '</div>' +
          '</div>'
        : '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(205px,230px);gap:10px;align-items:stretch;">' +
            '<div style="height:520px;min-height:520px;overflow:auto;border:1px dashed var(--border-color);border-radius:8px;background:var(--bg-primary);display:flex;flex-direction:column;gap:10px;color:var(--text-secondary);font-size:13px;line-height:1.7;padding:14px;box-sizing:border-box;">' +
              '<div style="color:var(--text-primary);font-weight:800;">没有匹配到图片预览</div>' +
              '<div>当前图件没有可供数字化复核的图片，请返回图件列表检查原图。</div>' +
            '</div>' +
            renderPdfWikiDigitizationCodingControlPanel(item) +
          '</div>';

      var html =
        '<div id="pdfWikiDigitizationReviewScroll" style="height:calc(100vh - 145px);min-height:520px;max-height:calc(100vh - 145px);overflow:auto;padding-right:2px;">' +
          imageHtml +
          renderPdfWikiDigitizationCodingTablePanel(item) +
        '</div>' +
        '<div class="btns" style="margin-top:14px;">' +
          '<button class="cancel" onclick="pendingPdfWikiDigitizationFile=null;pendingPdfWikiDigitizationImport=null;pdfWikiDigitizationEvidenceSaved=false;closeModal()">取消</button>' +
          '<button class="ok" id="digitizationConfirmBtn" onclick="confirmPdfWikiDigitizationImport()">保存编码表并关闭</button>' +
        '</div>';
      showModal('图像数字化复核', html, true, true, {
        modalClass: 'modal-digitization-review',
        overlayClass: 'app-secondary-overlay app-tertiary-overlay',
        preserveStandaloneSurfaceId: 'pdfWikiViewerModal'
      });
      if (preview && preview.url) {
        var modalHeader = document.querySelector('#modalOverlay .modal-header');
        var modalHeaderActions = document.getElementById('modalHeaderActions');
        if (modalHeader && modalHeaderActions) {
          var headerControls = document.createElement('div');
          headerControls.id = 'pdfWikiDigitizerHeaderControls';
          headerControls.className = 'pdf-wiki-digitizer-header-controls modal-transient-action';
          headerControls.innerHTML = axisHeaderControlHtml;
          modalHeader.insertBefore(headerControls, modalHeaderActions);
        }
      }
      setTimeout(function() {
        if (preview && preview.url && typeof initializeInternalPdfWikiDigitizer === 'function') initializeInternalPdfWikiDigitizer(preview.url);
        if (typeof refreshBundledGetDataStatus === 'function') refreshBundledGetDataStatus();
      }, 0);
    };

    window.startPdfWikiDigitizationImport = function(pdfId, figureIndex) {
      openPdfWikiDigitizationReview(pdfId, figureIndex);
    };

    window.selectPdfWikiDigitizationExportFile = function() {
      var input = document.getElementById('metaDigitizationFileInput');
      if (!input) {
        alert('GetData 导入控件未加载，请刷新页面后重试。');
        return;
      }
      input.value = '';
      input.click();
    };

    window.savePendingPdfWikiDigitizationEvidence = async function() {
      if (!pendingPdfWikiDigitizationFile) {
        alert('请先点击“使用”生成内置数字化结果，或选择 GetData/WebPlot 导出的 CSV/TXT/XLSX 文件。');
        return;
      }
      var btn = document.getElementById('digitizationEvidenceSaveBtn');
      var originalText = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = '保存中...';
      }
      try {
        var result = await uploadPendingPdfWikiDigitizationFile('', {
          silent: true,
          close: false,
          reload: false,
          clearState: false
        });
        pdfWikiDigitizationEvidenceSaved = true;
        var selectedFile = document.getElementById('pdfWikiDigitizationSelectedFile');
        if (selectedFile) {
          selectedFile.innerHTML += '<br><span style="color:var(--accent-color);">已归档为复核证据：' + escapeHtml(result.storedFile || 'digitized file') + '</span>';
        }
        alert('图像数字化文件已保存为复核证据；Meta 编码表仍以你下方手动填入并保存的内容为准。');
      } catch (error) {
        alert('保存数字化证据失败：' + error.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = originalText || '保存证据';
        }
      }
    };

    function getInternalDigitizerValue(id, fallback) {
      var el = document.getElementById(id);
      var value = el ? Number(String(el.value || '').trim()) : NaN;
      return Number.isFinite(value) ? value : fallback;
    }

    function getInternalDigitizerText(id) {
      var el = document.getElementById(id);
      return el ? String(el.value || '').trim() : '';
    }

    function getInternalDigitizerModeText(mode) {
      var map = {
        xMin: '点击 X最小轴刻度点',
        xMax: '点击 X最大轴刻度点',
        yMin: '点击 Y最小轴刻度点',
        yMax: '点击 Y最大轴刻度点',
        point: '采集数据点'
      };
      return map[mode] || '采集数据点';
    }

    function updateInternalDigitizerModeLabel() {
      var label = document.getElementById('pdfWikiInternalDigitizerModeLabel');
      var hint = document.getElementById('pdfWikiDigitizerOverlayHint');
      if (!pdfWikiInternalDigitizerState) return;
      var state = pdfWikiInternalDigitizerState;
      var ready = isInternalDigitizerCalibrated();
      var text = '当前：' + getInternalDigitizerModeText(state.mode) + '；校准 ' + Object.keys(state.calibration || {}).length + '/4；采点 ' + state.points.length + ' 个。';
      if (label) label.textContent = text;
      if (hint) {
        hint.textContent = ready
          ? (state.mode === 'point' ? '已完成校准。直接点击图中的数据点；更换处理/系列时先在右侧改系列名或处理组。' : text)
          : text + ' 先点击图中对应轴刻度点。';
      }
    }

    function initializeInternalPdfWikiDigitizer(url) {
      var canvas = document.getElementById('pdfWikiDigitizerCanvas');
      var wrap = document.getElementById('pdfWikiDigitizerCanvasWrap');
      var magnifierCanvas = document.getElementById('pdfWikiDigitizerMagnifierCanvas');
      if (!canvas || !wrap || !url) return;
      if (pdfWikiInternalDigitizerState && pdfWikiInternalDigitizerState.resizeObserver) {
        pdfWikiInternalDigitizerState.resizeObserver.disconnect();
      }
      var image = new Image();
      pdfWikiInternalDigitizerState = {
        url: url,
        image: image,
        canvas: canvas,
        wrap: wrap,
        magnifierCanvas: magnifierCanvas,
        magnifierPoint: null,
        mode: 'xMin',
        calibration: {},
        points: [],
        imageRect: { x: 0, y: 0, width: 0, height: 0 },
        viewZoom: 1,
        viewOffsetX: 0,
        viewOffsetY: 0,
        isPanning: false,
        suppressNextClick: false,
        panStartClientX: 0,
        panStartClientY: 0,
        panStartOffsetX: 0,
        panStartOffsetY: 0,
        panLastImageRect: null,
        canvasCssWidth: 0,
        canvasCssHeight: 0,
        canvasRatio: 0,
        resizeObserver: null
      };
      image.onload = function() {
        drawInternalPdfWikiDigitizer();
        updateInternalDigitizerModeLabel();
      };
      image.onerror = function() {
        var hint = document.getElementById('pdfWikiDigitizerOverlayHint');
        if (hint) hint.textContent = '图片加载失败，无法使用内置数字化器。';
      };
      image.src = url;
      if (window.ResizeObserver) {
        pdfWikiInternalDigitizerState.resizeObserver = new ResizeObserver(function() {
          drawInternalPdfWikiDigitizer();
          if (pdfWikiInternalDigitizerState && pdfWikiInternalDigitizerState.magnifierPoint) {
            drawInternalDigitizerMagnifier(pdfWikiInternalDigitizerState.magnifierPoint.px, pdfWikiInternalDigitizerState.magnifierPoint.py);
          }
        });
        pdfWikiInternalDigitizerState.resizeObserver.observe(wrap);
        if (magnifierCanvas) pdfWikiInternalDigitizerState.resizeObserver.observe(magnifierCanvas);
      }
      if (!window.__pdfWikiInternalDigitizerResizeAttached) {
        window.__pdfWikiInternalDigitizerResizeAttached = true;
        window.addEventListener('resize', function() {
          if (pdfWikiInternalDigitizerState) drawInternalPdfWikiDigitizer();
        });
      }
      if (!window.__pdfWikiInternalDigitizerPanEventsAttached) {
        window.__pdfWikiInternalDigitizerPanEventsAttached = true;
        document.addEventListener('mousemove', function(event) {
          if (pdfWikiInternalDigitizerState && pdfWikiInternalDigitizerState.isPanning) {
            window.handleInternalDigitizerCanvasMove(event);
          }
        });
        document.addEventListener('mouseup', function(event) {
          if (pdfWikiInternalDigitizerState && pdfWikiInternalDigitizerState.isPanning) {
            window.stopInternalDigitizerPan(event);
          }
        });
      }
    }

    function remapInternalDigitizerPoint(point, oldRect, newRect) {
      if (!point || !oldRect || oldRect.width <= 0 || oldRect.height <= 0) return;
      var rx = (point.px - oldRect.x) / oldRect.width;
      var ry = (point.py - oldRect.y) / oldRect.height;
      point.px = newRect.x + rx * newRect.width;
      point.py = newRect.y + ry * newRect.height;
    }

    function remapInternalDigitizerMarkers(oldRect, newRect) {
      var state = pdfWikiInternalDigitizerState;
      if (!state || !oldRect || oldRect.width <= 0 || oldRect.height <= 0) return;
      Object.keys(state.calibration || {}).forEach(function(key) {
        remapInternalDigitizerPoint(state.calibration[key], oldRect, newRect);
      });
      state.points.forEach(function(point) {
        remapInternalDigitizerPoint(point, oldRect, newRect);
      });
    }

    function clampInternalDigitizerZoom(value) {
      var zoom = Number(value);
      if (!Number.isFinite(zoom)) zoom = 1;
      return Math.max(0.5, Math.min(8, zoom));
    }

    function setInternalDigitizerCanvasCursor(cursor) {
      var state = pdfWikiInternalDigitizerState;
      if (!state || !state.canvas) return;
      state.canvas.style.cursor = cursor || 'crosshair';
    }

    function getInternalDigitizerImageRect(cssWidth, cssHeight) {
      var state = pdfWikiInternalDigitizerState;
      if (!state || !state.image) return { x: 0, y: 0, width: 0, height: 0 };
      var naturalWidth = state.image.naturalWidth || state.image.width || 1;
      var naturalHeight = state.image.naturalHeight || state.image.height || 1;
      var padding = 14;
      var fitScale = Math.min((cssWidth - padding * 2) / naturalWidth, (cssHeight - padding * 2) / naturalHeight);
      if (!Number.isFinite(fitScale) || fitScale <= 0) fitScale = 1;
      var zoom = clampInternalDigitizerZoom(state.viewZoom || 1);
      state.viewZoom = zoom;
      var drawWidth = naturalWidth * fitScale * zoom;
      var drawHeight = naturalHeight * fitScale * zoom;
      return {
        x: (cssWidth - drawWidth) / 2 + Number(state.viewOffsetX || 0),
        y: (cssHeight - drawHeight) / 2 + Number(state.viewOffsetY || 0),
        width: drawWidth,
        height: drawHeight
      };
    }

    function drawInternalPdfWikiDigitizer() {
      var state = pdfWikiInternalDigitizerState;
      if (!state || !state.canvas || !state.wrap || !state.image || !state.image.complete) return;
      var canvas = state.canvas;
      var rect = state.wrap.getBoundingClientRect();
      var cssWidth = Math.max(320, Math.floor(rect.width || 800));
      var cssHeight = Math.max(420, Math.floor(rect.height || 520));
      var ratio = window.devicePixelRatio || 1;
      var sizeChanged = state.canvasCssWidth !== cssWidth || state.canvasCssHeight !== cssHeight || state.canvasRatio !== ratio;
      var oldImageRect = state.imageRect;
      if (sizeChanged) {
        canvas.width = Math.round(cssWidth * ratio);
        canvas.height = Math.round(cssHeight * ratio);
        canvas.style.width = cssWidth + 'px';
        canvas.style.height = cssHeight + 'px';
        state.canvasCssWidth = cssWidth;
        state.canvasCssHeight = cssHeight;
        state.canvasRatio = ratio;
      }
      var ctx = canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, cssWidth, cssHeight);

      var nextImageRect = getInternalDigitizerImageRect(cssWidth, cssHeight);
      var drawX = nextImageRect.x;
      var drawY = nextImageRect.y;
      var drawWidth = nextImageRect.width;
      var drawHeight = nextImageRect.height;
      if (sizeChanged && oldImageRect && oldImageRect.width > 0 && oldImageRect.height > 0) {
        remapInternalDigitizerMarkers(oldImageRect, nextImageRect);
      }
      state.imageRect = nextImageRect;
      ctx.drawImage(state.image, drawX, drawY, drawWidth, drawHeight);
      ctx.strokeStyle = '#0f766e';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(drawX, drawY, drawWidth, drawHeight);

      var colors = { xMin: '#2563eb', xMax: '#7c3aed', yMin: '#dc2626', yMax: '#059669' };
      Object.keys(state.calibration || {}).forEach(function(key) {
        var p = state.calibration[key];
        if (!p) return;
        drawDigitizerMarker(ctx, p.px, p.py, colors[key] || '#0f766e', key);
      });
      if (state.calibration.xMin && state.calibration.xMax) {
        drawDigitizerLine(ctx, state.calibration.xMin, state.calibration.xMax, '#2563eb');
      }
      if (state.calibration.yMin && state.calibration.yMax) {
        drawDigitizerLine(ctx, state.calibration.yMin, state.calibration.yMax, '#dc2626');
      }
      state.points.forEach(function(point, index) {
        drawDigitizerMarker(ctx, point.px, point.py, '#f97316', String(index + 1));
      });
      if (state.magnifierPoint) {
        drawInternalDigitizerMagnifier(state.magnifierPoint.px, state.magnifierPoint.py);
      }
    }

    function drawInternalDigitizerMagnifier(px, py) {
      var state = pdfWikiInternalDigitizerState;
      if (!state || !state.magnifierCanvas || !state.image || !state.image.complete || !state.imageRect) return;
      var mag = state.magnifierCanvas;
      var rect = mag.getBoundingClientRect();
      var cssWidth = Math.max(180, Math.floor(rect.width || 260));
      var cssHeight = Math.max(220, Math.floor(rect.height || 320));
      var ratio = window.devicePixelRatio || 1;
      if (mag.width !== Math.round(cssWidth * ratio) || mag.height !== Math.round(cssHeight * ratio)) {
        mag.width = Math.round(cssWidth * ratio);
        mag.height = Math.round(cssHeight * ratio);
      }
      var ctx = mag.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, cssWidth, cssHeight);

      var imageRect = state.imageRect;
      var naturalWidth = state.image.naturalWidth || state.image.width || 1;
      var naturalHeight = state.image.naturalHeight || state.image.height || 1;
      var rx = imageRect.width ? (px - imageRect.x) / imageRect.width : 0;
      var ry = imageRect.height ? (py - imageRect.y) / imageRect.height : 0;
      var sourceX = Math.max(0, Math.min(naturalWidth, rx * naturalWidth));
      var sourceY = Math.max(0, Math.min(naturalHeight, ry * naturalHeight));
      var zoom = 5;
      var sourceW = Math.max(8, cssWidth / zoom);
      var sourceH = Math.max(8, cssHeight / zoom);
      var desiredSx = sourceX - sourceW / 2;
      var desiredSy = sourceY - sourceH / 2;
      var visibleSx = Math.max(0, desiredSx);
      var visibleSy = Math.max(0, desiredSy);
      var visibleEx = Math.min(naturalWidth, desiredSx + sourceW);
      var visibleEy = Math.min(naturalHeight, desiredSy + sourceH);
      var visibleW = Math.max(0, visibleEx - visibleSx);
      var visibleH = Math.max(0, visibleEy - visibleSy);
      var destX = (visibleSx - desiredSx) * zoom;
      var destY = (visibleSy - desiredSy) * zoom;
      var destW = visibleW * zoom;
      var destH = visibleH * zoom;

      ctx.imageSmoothingEnabled = false;
      if (visibleW > 0 && visibleH > 0) {
        ctx.drawImage(state.image, visibleSx, visibleSy, visibleW, visibleH, destX, destY, destW, destH);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.save();
      ctx.strokeStyle = 'rgba(15,118,110,0.65)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect((0 - desiredSx) * zoom, (0 - desiredSy) * zoom, naturalWidth * zoom, naturalHeight * zoom);
      ctx.restore();
      ctx.strokeStyle = '#0f766e';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(0.5, 0.5, cssWidth - 1, cssHeight - 1);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cssWidth / 2, 0);
      ctx.lineTo(cssWidth / 2, cssHeight);
      ctx.moveTo(0, cssHeight / 2);
      ctx.lineTo(cssWidth, cssHeight / 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.fillRect(8, cssHeight - 28, cssWidth - 16, 20);
      ctx.fillStyle = '#0f172a';
      ctx.font = '11px Arial';
      ctx.fillText('x=' + Math.round(sourceX) + ', y=' + Math.round(sourceY) + ' · ' + zoom + 'x', 13, cssHeight - 14);

      var status = document.getElementById('pdfWikiDigitizerMagnifierStatus');
      if (status) {
        status.textContent = '当前像素：x=' + Math.round(sourceX) + '，y=' + Math.round(sourceY) + '；放大 ' + zoom + 'x。';
      }
    }

    window.handleInternalDigitizerCanvasMove = function(event) {
      var state = pdfWikiInternalDigitizerState;
      if (!state || !state.canvas) return;
      var rect = state.canvas.getBoundingClientRect();
      var px = event.clientX - rect.left;
      var py = event.clientY - rect.top;
      if (state.isPanning) {
        event.preventDefault();
        event.stopPropagation();
        var oldRect = state.panLastImageRect || (state.imageRect && state.imageRect.width > 0 ? Object.assign({}, state.imageRect) : null);
        state.viewOffsetX = state.panStartOffsetX + (event.clientX - state.panStartClientX);
        state.viewOffsetY = state.panStartOffsetY + (event.clientY - state.panStartClientY);
        var cssWidth = state.canvasCssWidth || rect.width || 800;
        var cssHeight = state.canvasCssHeight || rect.height || 520;
        var nextRect = getInternalDigitizerImageRect(cssWidth, cssHeight);
        if (oldRect && oldRect.width > 0 && oldRect.height > 0) {
          remapInternalDigitizerMarkers(oldRect, nextRect);
        }
        state.imageRect = nextRect;
        state.panLastImageRect = Object.assign({}, nextRect);
        state.magnifierPoint = { px: px, py: py };
        drawInternalPdfWikiDigitizer();
        drawInternalDigitizerMagnifier(px, py);
        return;
      }
      state.magnifierPoint = { px: px, py: py };
      drawInternalDigitizerMagnifier(px, py);
    };

    window.handleInternalDigitizerCanvasMouseDown = function(event) {
      var state = pdfWikiInternalDigitizerState;
      if (!state || !state.canvas || !state.image || !state.image.complete) return;
      if (event.button !== 2) return;
      event.preventDefault();
      event.stopPropagation();
      var rect = state.canvas.getBoundingClientRect();
      state.isPanning = true;
      state.suppressNextClick = true;
      state.panStartClientX = event.clientX;
      state.panStartClientY = event.clientY;
      state.panStartOffsetX = Number(state.viewOffsetX || 0);
      state.panStartOffsetY = Number(state.viewOffsetY || 0);
      state.panLastImageRect = state.imageRect && state.imageRect.width > 0
        ? Object.assign({}, state.imageRect)
        : getInternalDigitizerImageRect(state.canvasCssWidth || rect.width || 800, state.canvasCssHeight || rect.height || 520);
      setInternalDigitizerCanvasCursor('grabbing');
    };

    window.stopInternalDigitizerPan = function(event) {
      var state = pdfWikiInternalDigitizerState;
      if (!state || !state.isPanning) return;
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      state.isPanning = false;
      state.panLastImageRect = null;
      setInternalDigitizerCanvasCursor('crosshair');
      setTimeout(function() {
        if (pdfWikiInternalDigitizerState) pdfWikiInternalDigitizerState.suppressNextClick = false;
      }, 0);
    };

    window.handleInternalDigitizerCanvasContextMenu = function(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      return false;
    };

    window.handleInternalDigitizerCanvasWheel = function(event) {
      var state = pdfWikiInternalDigitizerState;
      if (!state || !state.canvas || !state.image || !state.image.complete || !event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      var canvasRect = state.canvas.getBoundingClientRect();
      var px = event.clientX - canvasRect.left;
      var py = event.clientY - canvasRect.top;
      var oldRect = state.imageRect && state.imageRect.width > 0 && state.imageRect.height > 0
        ? Object.assign({}, state.imageRect)
        : getInternalDigitizerImageRect(state.canvasCssWidth || canvasRect.width, state.canvasCssHeight || canvasRect.height);
      var rx = oldRect.width ? (px - oldRect.x) / oldRect.width : 0.5;
      var ry = oldRect.height ? (py - oldRect.y) / oldRect.height : 0.5;
      rx = Math.max(0, Math.min(1, Number.isFinite(rx) ? rx : 0.5));
      ry = Math.max(0, Math.min(1, Number.isFinite(ry) ? ry : 0.5));
      var oldZoom = clampInternalDigitizerZoom(state.viewZoom || 1);
      var zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      var nextZoom = clampInternalDigitizerZoom(oldZoom * zoomFactor);
      if (Math.abs(nextZoom - oldZoom) < 0.001) return;
      state.viewZoom = nextZoom;
      var cssWidth = state.canvasCssWidth || canvasRect.width || 800;
      var cssHeight = state.canvasCssHeight || canvasRect.height || 520;
      var baseRect = getInternalDigitizerImageRect(cssWidth, cssHeight);
      state.viewOffsetX += px - (baseRect.x + rx * baseRect.width);
      state.viewOffsetY += py - (baseRect.y + ry * baseRect.height);
      var nextRect = getInternalDigitizerImageRect(cssWidth, cssHeight);
      remapInternalDigitizerMarkers(oldRect, nextRect);
      state.imageRect = nextRect;
      state.magnifierPoint = { px: px, py: py };
      drawInternalPdfWikiDigitizer();
      drawInternalDigitizerMagnifier(px, py);
    };

    window.clearInternalDigitizerMagnifier = function() {
      var state = pdfWikiInternalDigitizerState;
      if (!state) return;
      state.magnifierPoint = null;
      var status = document.getElementById('pdfWikiDigitizerMagnifierStatus');
      if (status) status.textContent = '把鼠标移到左侧图片上查看局部放大。';
    };

    window.handleInternalDigitizerCanvasLeave = function(event) {
      var state = pdfWikiInternalDigitizerState;
      if (state && state.isPanning) return;
      window.clearInternalDigitizerMagnifier(event);
    };

    function drawDigitizerLine(ctx, a, b, color) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(a.px, a.py);
      ctx.lineTo(b.px, b.py);
      ctx.stroke();
      ctx.restore();
    }

    function drawDigitizerMarker(ctx, x, y, color, label) {
      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = '12px Arial';
      ctx.fillStyle = color;
      ctx.fillText(label, x + 8, y - 8);
      ctx.restore();
    }

    function isInternalDigitizerCalibrated() {
      var state = pdfWikiInternalDigitizerState;
      if (!state) return false;
      return !!(state.calibration.xMin && state.calibration.xMax && state.calibration.yMin && state.calibration.yMax);
    }

    function internalDigitizerPixelToData(px, py) {
      var state = pdfWikiInternalDigitizerState;
      if (!state || !isInternalDigitizerCalibrated()) return null;
      var xMinValue = getInternalDigitizerValue('digitizerXMinValue', 0);
      var xMaxValue = getInternalDigitizerValue('digitizerXMaxValue', 1);
      var yMinValue = getInternalDigitizerValue('digitizerYMinValue', 0);
      var yMaxValue = getInternalDigitizerValue('digitizerYMaxValue', 1);
      var xMin = state.calibration.xMin;
      var xMax = state.calibration.xMax;
      var yMin = state.calibration.yMin;
      var yMax = state.calibration.yMax;
      var xDenominator = xMax.px - xMin.px;
      var yDenominator = yMax.py - yMin.py;
      if (Math.abs(xDenominator) < 1 || Math.abs(yDenominator) < 1) return null;
      var x = xMinValue + (px - xMin.px) / xDenominator * (xMaxValue - xMinValue);
      var y = yMinValue + (py - yMin.py) / yDenominator * (yMaxValue - yMinValue);
      return { x: x, y: y };
    }

    function formatDigitizerNumber(value) {
      var num = Number(value);
      if (!Number.isFinite(num)) return '';
      return Math.abs(num) >= 1000 || Math.abs(num) < 0.001
        ? num.toExponential(6)
        : String(Math.round(num * 1000000) / 1000000);
    }

    function renderInternalDigitizerPointsList() {
      var list = document.getElementById('pdfWikiInternalDigitizerPointsList');
      var state = pdfWikiInternalDigitizerState;
      if (!list || !state) return;
      if (!state.points.length) {
        list.textContent = '暂无采点。';
        updateInternalDigitizerModeLabel();
        drawInternalPdfWikiDigitizer();
        return;
      }
      list.innerHTML = state.points.map(function(point, index) {
        return '<div style="display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid var(--border-color);padding:3px 0;">' +
          '<span>' + (index + 1) + '. ' + escapeHtml([point.subfigure, point.treatment || point.series || '未命名'].filter(Boolean).join(' / ')) + '</span>' +
          '<span>X=' + escapeHtml(formatDigitizerNumber(point.x)) + '；Y=' + escapeHtml(formatDigitizerNumber(point.y)) + '</span>' +
        '</div>';
      }).join('');
      updateInternalDigitizerModeLabel();
      drawInternalPdfWikiDigitizer();
    }

    window.setInternalDigitizerMode = function(mode) {
      if (!pdfWikiInternalDigitizerState) return;
      pdfWikiInternalDigitizerState.mode = mode || 'point';
      updateInternalDigitizerModeLabel();
    };

    window.clearInternalDigitizerPoints = function() {
      if (!pdfWikiInternalDigitizerState) return;
      if (!pdfWikiInternalDigitizerState.points.length || confirm('确认清空当前已采集的数据点？')) {
        pdfWikiInternalDigitizerState.points = [];
        renderInternalDigitizerPointsList();
      }
    };

    window.undoInternalDigitizerPoint = function() {
      var state = pdfWikiInternalDigitizerState;
      if (!state) return;
      if (state.points.length) {
        state.points.pop();
      } else {
        var order = ['yMax', 'yMin', 'xMax', 'xMin'];
        for (var i = 0; i < order.length; i++) {
          if (state.calibration[order[i]]) {
            delete state.calibration[order[i]];
            state.mode = order[i];
            break;
          }
        }
      }
      renderInternalDigitizerPointsList();
    };

    window.handleInternalDigitizerCanvasClick = function(event) {
      var state = pdfWikiInternalDigitizerState;
      if (!state || !state.canvas) return;
      if (state.suppressNextClick || event.button === 2) {
        state.suppressNextClick = false;
        return;
      }
      var rect = state.canvas.getBoundingClientRect();
      var px = event.clientX - rect.left;
      var py = event.clientY - rect.top;
      var mode = state.mode || 'point';
      if (mode !== 'point') {
        state.calibration[mode] = { px: px, py: py };
        var nextMode = { xMin: 'xMax', xMax: 'yMin', yMin: 'yMax', yMax: 'point' }[mode] || 'point';
        state.mode = nextMode;
        renderInternalDigitizerPointsList();
        return;
      }
      if (!isInternalDigitizerCalibrated()) {
        alert('请先完成 X最小、X最大、Y最小、Y最大四个轴刻度点校准。');
        return;
      }
      var data = internalDigitizerPixelToData(px, py);
      if (!data) {
        alert('坐标校准无效，请重新点击四个轴刻度点。');
        return;
      }
      var series = getInternalDigitizerText('digitizationSeriesName');
      var treatment = getInternalDigitizerText('digitizationTreatment');
      var control = getInternalDigitizerText('digitizationControl');
      var subfigure = getInternalDigitizerText('digitizationSubfigure');
      state.points.push({
        px: px,
        py: py,
        x: data.x,
        y: data.y,
        series: series || treatment || ('Series ' + (state.points.length + 1)),
        treatment: treatment,
        control: control,
        subfigure: subfigure
      });
      renderInternalDigitizerPointsList();
    };

    function csvEscape(value) {
      var text = String(value == null ? '' : value);
      return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    }

    function averageDigitizerValues(values) {
      var nums = values.map(Number).filter(function(value) { return Number.isFinite(value); });
      if (!nums.length) return NaN;
      return nums.reduce(function(sum, value) { return sum + value; }, 0) / nums.length;
    }

    function sumDigitizerValues(values) {
      var nums = values.map(Number).filter(function(value) { return Number.isFinite(value); });
      if (!nums.length) return NaN;
      return nums.reduce(function(sum, value) { return sum + value; }, 0);
    }

    function sdDigitizerValues(values) {
      var nums = values.map(Number).filter(function(value) { return Number.isFinite(value); });
      if (nums.length <= 1) return NaN;
      var mean = averageDigitizerValues(nums);
      var variance = nums.reduce(function(sum, value) { return sum + Math.pow(value - mean, 2); }, 0) / (nums.length - 1);
      return Math.sqrt(variance);
    }

    function getInternalDigitizerAggregationMode() {
      var el = document.getElementById('digitizationAggregationMode');
      return el ? String(el.value || 'none') : 'none';
    }

    function getInternalDigitizerAggregationLabel(mode) {
      return {
        none: 'raw',
        meanByTreatmentSeriesX: 'mean_by_subfigure_treatment_series_x',
        sumByTreatmentSeriesX: 'sum_by_subfigure_treatment_series_x',
        sdByTreatmentSeriesX: 'sd_by_subfigure_treatment_series_x',
        meanByTreatmentSeries: 'mean_by_subfigure_treatment_series',
        sumByTreatmentSeries: 'sum_by_subfigure_treatment_series',
        sdByTreatmentSeries: 'sd_by_subfigure_treatment_series',
        meanAll: 'mean_all_current_points',
        sumAll: 'sum_all_current_points',
        sdAll: 'sd_all_current_points'
      }[mode] || 'raw';
    }

    function getInternalDigitizerAggregationDisplayName(mode) {
      return {
        none: '保留每个采点',
        meanAll: '全部采点求均值',
        sumAll: '全部采点求和',
        sdAll: '全部采点计算 SD',
        meanByTreatmentSeries: '按子图/处理/系列求均值',
        sumByTreatmentSeries: '按子图/处理/系列求和',
        sdByTreatmentSeries: '按子图/处理/系列计算 SD',
        meanByTreatmentSeriesX: '按子图/处理/系列/X 求均值',
        sumByTreatmentSeriesX: '按子图/处理/系列/X 求和',
        sdByTreatmentSeriesX: '按子图/处理/系列/X 计算 SD'
      }[mode] || '保留每个采点';
    }

    function setInternalDigitizerCalculationStatus(message, tone) {
      var status = document.getElementById('digitizationCalculationStatus');
      if (!status) return;
      status.style.color = tone === 'error' ? '#b91c1c' : (tone === 'ok' ? '#047857' : '#475569');
      status.textContent = String(message || '');
    }

    function getInternalDigitizerAggregationStatistic(mode) {
      if (/^sum/.test(mode)) return 'sum';
      if (/^sd/.test(mode)) return 'sd';
      return 'mean';
    }

    function isInternalDigitizerAggregationAll(mode) {
      return mode === 'meanAll' || mode === 'sumAll' || mode === 'sdAll';
    }

    function isInternalDigitizerAggregationByX(mode) {
      return mode === 'meanByTreatmentSeriesX' || mode === 'sumByTreatmentSeriesX' || mode === 'sdByTreatmentSeriesX';
    }

    function getInternalDigitizerProcessedPoints() {
      var state = pdfWikiInternalDigitizerState;
      if (!state || !state.points.length) return [];
      var mode = getInternalDigitizerAggregationMode();
      if (mode === 'none') {
        return state.points.map(function(point) {
          return Object.assign({}, point, {
            n: 1,
            mean: point.y,
            sum: point.y,
            sd: '',
            sem: '',
            statistic: 'raw',
            aggregation: getInternalDigitizerAggregationLabel(mode)
          });
        });
      }
      var statistic = getInternalDigitizerAggregationStatistic(mode);
      var groups = {};
      state.points.forEach(function(point) {
        var keyParts = isInternalDigitizerAggregationAll(mode)
          ? ['all']
          : [
              point.subfigure || '',
              point.treatment || '',
              point.control || '',
              point.series || '',
              isInternalDigitizerAggregationByX(mode) ? formatDigitizerNumber(point.x) : ''
            ];
        var key = keyParts.join('\u0001');
        if (!groups[key]) groups[key] = [];
        groups[key].push(point);
      });
      return Object.keys(groups).map(function(key, groupIndex) {
        var points = groups[key];
        var first = points[0] || {};
        var meanX = averageDigitizerValues(points.map(function(point) { return point.x; }));
        var meanY = averageDigitizerValues(points.map(function(point) { return point.y; }));
        var sumY = sumDigitizerValues(points.map(function(point) { return point.y; }));
        var sdY = sdDigitizerValues(points.map(function(point) { return point.y; }));
        var semY = Number.isFinite(sdY) ? sdY / Math.sqrt(points.length) : NaN;
        var selectedY = statistic === 'sum' ? sumY : (statistic === 'sd' ? sdY : meanY);
        return {
          px: averageDigitizerValues(points.map(function(point) { return point.px; })),
          py: averageDigitizerValues(points.map(function(point) { return point.py; })),
          x: meanX,
          y: selectedY,
          series: isInternalDigitizerAggregationAll(mode) ? (first.series || 'All points') : (first.series || ''),
          treatment: isInternalDigitizerAggregationAll(mode) ? (first.treatment || '') : (first.treatment || ''),
          control: isInternalDigitizerAggregationAll(mode) ? (first.control || '') : (first.control || ''),
          subfigure: isInternalDigitizerAggregationAll(mode) ? (first.subfigure || '') : (first.subfigure || ''),
          n: points.length,
          mean: Number.isFinite(meanY) ? meanY : '',
          sum: Number.isFinite(sumY) ? sumY : '',
          sd: Number.isFinite(sdY) ? sdY : '',
          sem: Number.isFinite(semY) ? semY : '',
          statistic: statistic,
          aggregation: getInternalDigitizerAggregationLabel(mode),
          groupIndex: groupIndex + 1
        };
      });
    }

    function buildInternalDigitizerCsv() {
      var processedPoints = getInternalDigitizerProcessedPoints();
      if (!processedPoints.length) return '';
      var headers = ['X', 'Y', 'Series', 'Treatment', 'Control', 'Subfigure', 'N', 'Mean', 'Sum', 'SD', 'SEM', 'PixelX', 'PixelY', 'Statistic', 'Aggregation'];
      var rows = processedPoints.map(function(point) {
        return [
          formatDigitizerNumber(point.x),
          formatDigitizerNumber(point.y),
          point.series || '',
          point.treatment || '',
          point.control || '',
          point.subfigure || '',
          point.n || '',
          point.mean === '' ? '' : formatDigitizerNumber(point.mean),
          point.sum === '' ? '' : formatDigitizerNumber(point.sum),
          point.sd === '' ? '' : formatDigitizerNumber(point.sd),
          point.sem === '' ? '' : formatDigitizerNumber(point.sem),
          formatDigitizerNumber(point.px),
          formatDigitizerNumber(point.py),
          point.statistic || '',
          point.aggregation || ''
        ].map(csvEscape).join(',');
      });
      return headers.join(',') + '\n' + rows.join('\n') + '\n';
    }

    function buildPdfWikiDigitizationPendingValuesFromProcessedPoints(points) {
      return (Array.isArray(points) ? points : []).map(function(point, index) {
        var value = formatDigitizerNumber(point.y);
        var labelParts = ['#' + (index + 1)];
        if (point.treatment) labelParts.push(point.treatment);
        if (point.series && point.series !== point.treatment) labelParts.push(point.series);
        if (point.x !== '' && point.x != null) labelParts.push('X=' + formatDigitizerNumber(point.x));
        if (point.statistic && point.statistic !== 'raw') labelParts.push(point.statistic);
        return {
          value: value,
          label: labelParts.join(' / '),
          meta: point
        };
      }).filter(function(item) { return item.value !== ''; });
    }

    function parsePdfWikiDigitizationDelimitedText(text) {
      var lines = String(text || '').split(/\r?\n/).filter(function(line) { return line.trim(); });
      if (!lines.length) return { headers: [], rows: [] };
      var delimiter = lines[0].indexOf('\t') >= 0 ? '\t' : ',';
      function parseLine(line) {
        if (delimiter === '\t') return line.split('\t').map(function(cell) { return cell.trim(); });
        var cells = [];
        var current = '';
        var quoted = false;
        for (var i = 0; i < line.length; i += 1) {
          var ch = line[i];
          if (ch === '"') {
            if (quoted && line[i + 1] === '"') {
              current += '"';
              i += 1;
            } else {
              quoted = !quoted;
            }
          } else if (ch === ',' && !quoted) {
            cells.push(current.trim());
            current = '';
          } else {
            current += ch;
          }
        }
        cells.push(current.trim());
        return cells;
      }
      var first = parseLine(lines[0]);
      var firstHasText = first.some(function(cell) { return cell && !/^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(cell); });
      var headers = firstHasText ? first : first.map(function(_, index) { return index === 0 ? 'X' : (index === 1 ? 'Y' : '列' + (index + 1)); });
      var dataLines = firstHasText ? lines.slice(1) : lines;
      return {
        headers: headers,
        rows: dataLines.map(parseLine).filter(function(row) { return row.some(function(cell) { return String(cell || '').trim(); }); })
      };
    }

    function summarizePdfWikiDigitizationValues(values, mode) {
      var nums = values.map(Number).filter(function(value) { return Number.isFinite(value); });
      if (!nums.length) return [];
      if (/^sum/.test(mode)) return [{ value: formatDigitizerNumber(sumDigitizerValues(nums)), label: '求和', meta: { statistic: 'sum' } }];
      if (/^sd/.test(mode)) return [{ value: formatDigitizerNumber(sdDigitizerValues(nums)), label: 'SD', meta: { statistic: 'sd' } }];
      if (/^mean/.test(mode)) return [{ value: formatDigitizerNumber(averageDigitizerValues(nums)), label: '均值', meta: { statistic: 'mean' } }];
      return values.map(function(value, index) {
        return { value: String(value), label: '外部数据 #' + (index + 1), meta: {} };
      });
    }

    async function loadPdfWikiDigitizationPendingValuesFromFile(file) {
      if (!file || !file.name) return;
      if (!/\.(csv|txt|tsv)$/i.test(file.name)) {
        var selectedFile = document.getElementById('pdfWikiDigitizationSelectedFile');
        if (selectedFile) {
          selectedFile.innerHTML += '<br><span style="color:var(--text-secondary);">XLS/XLSX 可保存为复核证据；当前页暂不做浏览器内待填值预览。需要填表时建议另存为 CSV/TSV。</span>';
        }
        return;
      }
      var text = await file.text();
      var parsed = parsePdfWikiDigitizationDelimitedText(text);
      var headers = parsed.headers || [];
      var rows = parsed.rows || [];
      var yIndex = headers.findIndex(function(column) { return /^y$/i.test(column) || /纵坐标|value|mean|sum|sd|emission|flux|浓度|通量|排放/i.test(column); });
      if (yIndex < 0) yIndex = headers.length > 1 ? 1 : 0;
      var values = rows.map(function(row) { return String(row[yIndex] || '').trim(); }).filter(Boolean);
      var pending = summarizePdfWikiDigitizationValues(values, getInternalDigitizerAggregationMode());
      setPdfWikiDigitizationPendingValues(pending);
    }

    window.useInternalDigitizerCsv = function(options) {
      options = options || {};
      var state = pdfWikiInternalDigitizerState;
      if (!state || !state.points.length) {
        setInternalDigitizerCalculationStatus('尚未采集数据点。', 'error');
        alert('请先在图上采集至少 1 个数据点。');
        return null;
      }
      var mode = getInternalDigitizerAggregationMode();
      var processedPoints = getInternalDigitizerProcessedPoints();
      var processedCount = processedPoints.length;
      var pendingValues = buildPdfWikiDigitizationPendingValuesFromProcessedPoints(processedPoints);
      if (!pendingValues.length) {
        var invalidMessage = /^sd/.test(mode)
          ? '无法计算 SD：每个计算组至少需要 2 个采点。'
          : '当前采点没有生成有效计算结果。';
        setInternalDigitizerCalculationStatus(invalidMessage, 'error');
        alert(invalidMessage);
        return null;
      }
      var csv = buildInternalDigitizerCsv();
      var fileName = 'internal-digitizer-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.csv';
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      try {
        pendingPdfWikiDigitizationFile = new File([blob], fileName, { type: 'text/csv' });
      } catch {
        blob.name = fileName;
        pendingPdfWikiDigitizationFile = blob;
      }
      pdfWikiDigitizationEvidenceSaved = false;
      var selectedFile = document.getElementById('pdfWikiDigitizationSelectedFile');
      if (selectedFile) {
        selectedFile.innerHTML = '<strong style="color:var(--text-primary);">已生成内置数字化结果：</strong>' + escapeHtml(fileName) + ' <span style="color:var(--text-secondary);">(' + state.points.length + ' 个原始点，输出 ' + processedCount + ' 行)</span>';
      }
      var notesEl = document.getElementById('digitizationNotes');
      if (notesEl && !String(notesEl.value || '').includes('内置图像数字化')) {
        notesEl.value = (notesEl.value ? notesEl.value + '\n' : '') + '内置图像数字化：线性坐标轴四点校准；点选数据为图像估算值。';
      }
      setPdfWikiDigitizationPendingValues(pendingValues);
      setInternalDigitizerCalculationStatus(
        getInternalDigitizerAggregationDisplayName(mode) + '：' + state.points.length + ' 个采点，生成 ' + pendingValues.length + ' 个待填值。',
        'ok'
      );
      if (!options.silent) {
        alert('计算完成，已生成 ' + pendingValues.length + ' 个待填数据。请在右侧选择目标单元格后填入。');
      }
      return { points: processedPoints, pendingValues: pendingValues, fileName: fileName };
    };

    window.calculateInternalDigitizerPoints = function() {
      return window.useInternalDigitizerCsv({ silent: true });
    };

    function updateBundledGetDataStatus(message, tone) {
      var statusEl = document.getElementById('pdfWikiGetDataStatus');
      if (!statusEl) return;
      var color = tone === 'ok' ? 'var(--accent-color)' : (tone === 'error' ? 'var(--danger-color)' : 'var(--text-secondary)');
      statusEl.innerHTML = '<span style="color:' + color + ';">' + escapeHtml(message || '') + '</span>';
    }

    function stopBundledGetDataAutoDetect() {
      if (pdfWikiGetDataAutoDetectTimer) {
        clearInterval(pdfWikiGetDataAutoDetectTimer);
        pdfWikiGetDataAutoDetectTimer = null;
      }
    }

    function startBundledGetDataAutoDetect() {
      stopBundledGetDataAutoDetect();
      var startedAt = Date.now();
      pdfWikiGetDataAutoDetectTimer = setInterval(function() {
        if (!document.getElementById('pdfWikiGetDataStatus') || Date.now() - startedAt > 120000) {
          stopBundledGetDataAutoDetect();
          return;
        }
        refreshBundledGetDataStatus(false).catch(function(error) {
          console.warn('[PdfWiki] GetData 自动检测失败:', error);
        });
      }, 3000);
    }

    window.refreshBundledGetDataStatus = async function(showChecking) {
      var btn = document.getElementById('pdfWikiGetDataLaunchBtn');
      if (showChecking !== false) updateBundledGetDataStatus('正在检测 GetData.exe...', 'info');
      try {
        var response = await fetch('/api/pdf-wiki/getdata/status');
        var result = await response.json();
        var data = result && result.data ? result.data : {};
        if (data.available) {
          if (btn) btn.disabled = false;
          stopBundledGetDataAutoDetect();
          updateBundledGetDataStatus((data.message || '已检测到 GetData.exe。') + (data.executable ? '\n路径：' + data.executable : ''), 'ok');
        } else {
          if (btn) btn.disabled = true;
          updateBundledGetDataStatus(data.message || '未检测到 GetData.exe。请先安装或选择本机已有的 GetData.exe。', 'error');
        }
      } catch (error) {
        if (btn) btn.disabled = true;
        updateBundledGetDataStatus('检测 GetData.exe 失败：' + error.message, 'error');
      }
    };

    window.openGetDataDownloadPage = async function() {
      updateBundledGetDataStatus('正在打开 GetData 可用下载页...', 'info');
      try {
        var response = await fetch('/api/pdf-wiki/getdata/open-download-page', { method: 'POST' });
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success) throw new Error(result.error || '打开下载页失败');
        updateBundledGetDataStatus(result.message || '已打开下载页。安装完成后会自动检测。', 'info');
        startBundledGetDataAutoDetect();
      } catch (error) {
        updateBundledGetDataStatus('打开下载页失败：' + error.message, 'error');
        window.open('https://getdata-graph-digitizer.software.informer.com/download/', '_blank', 'noopener');
        startBundledGetDataAutoDetect();
      }
    };

    window.openBundledGetDataFolder = async function() {
      updateBundledGetDataStatus('正在打开本软件 GetData 目录...', 'info');
      try {
        var response = await fetch('/api/pdf-wiki/getdata/open-folder', { method: 'POST' });
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success) throw new Error(result.error || '打开目录失败');
        updateBundledGetDataStatus((result.message || '已打开目录。') + (result.installDir ? '\n目录：' + result.installDir : ''), 'info');
        startBundledGetDataAutoDetect();
      } catch (error) {
        updateBundledGetDataStatus('打开目录失败：' + error.message, 'error');
      }
    };

    window.selectBundledGetDataExe = function() {
      var input = document.getElementById('getDataExeInput');
      if (!input) {
        alert('GetData.exe 选择控件未加载，请刷新页面后重试。');
        return;
      }
      input.value = '';
      input.click();
    };

    function buildGetDataFigureFileName() {
      var label = pendingPdfWikiDigitizationImport && pendingPdfWikiDigitizationImport.figureLabel
        ? pendingPdfWikiDigitizationImport.figureLabel
        : 'current-figure';
      return String(label)
        .replace(/[<>:"\/\\|?*\x00-\x1F]+/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 80) + '.jpg';
    }

    function convertCurrentDigitizationImageToJpegBlob(url) {
      return new Promise(function(resolve, reject) {
        if (!url) {
          reject(new Error('当前图件没有可用预览图'));
          return;
        }
        var img = new Image();
        img.onload = function() {
          try {
            var width = img.naturalWidth || img.width;
            var height = img.naturalHeight || img.height;
            if (!width || !height) throw new Error('当前图片尺寸无效');
            var maxSide = 6000;
            var scale = Math.min(1, maxSide / Math.max(width, height));
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(function(blob) {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('当前图片转 JPEG 失败'));
              }
            }, 'image/jpeg', 0.96);
          } catch (error) {
            reject(error);
          }
        };
        img.onerror = function() {
          reject(new Error('当前图片加载失败'));
        };
        img.src = url;
      });
    }

    window.launchBundledGetData = async function() {
      var btn = document.getElementById('pdfWikiGetDataLaunchBtn');
      var originalText = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = '正在交给 GetData...';
      }
      updateBundledGetDataStatus('正在把当前图交给 GetData...', 'info');
      try {
        var previewUrl = pendingPdfWikiDigitizationImport && pendingPdfWikiDigitizationImport.previewUrl
          ? pendingPdfWikiDigitizationImport.previewUrl
          : '';
        var response;
        if (previewUrl) {
          var imageBlob = await convertCurrentDigitizationImageToJpegBlob(previewUrl);
          var formData = new FormData();
          formData.append('file', imageBlob, buildGetDataFigureFileName());
          formData.append('userId', currentUserId);
          formData.append('pdfId', pendingPdfWikiDigitizationImport && pendingPdfWikiDigitizationImport.pdfId ? pendingPdfWikiDigitizationImport.pdfId : '');
          formData.append('figureLabel', pendingPdfWikiDigitizationImport && pendingPdfWikiDigitizationImport.figureLabel ? pendingPdfWikiDigitizationImport.figureLabel : '');
          response = await fetch('/api/pdf-wiki/getdata/launch-image', {
            method: 'POST',
            body: formData
          });
        } else {
          response = await fetch('/api/pdf-wiki/getdata/launch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: currentUserId,
              pdfId: pendingPdfWikiDigitizationImport && pendingPdfWikiDigitizationImport.pdfId ? pendingPdfWikiDigitizationImport.pdfId : '',
              imageUrl: previewUrl
            })
          });
        }
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success) {
          throw new Error(result.error || '启动 GetData 失败');
        }
        updateBundledGetDataStatus(result.message || 'GetData 已打开当前图。完成提取后导出 CSV/TXT/XLSX 并回填。', 'ok');
      } catch (error) {
        updateBundledGetDataStatus('启动失败：' + error.message, 'error');
        alert('启动内置 GetData 失败：' + error.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = originalText || '使用 GetData 提取当前图';
        }
      }
    };

    async function handleGetDataExeFileInputChange(e) {
      var file = e && e.target && e.target.files && e.target.files[0];
      if (!file) return;
      if (!/\.exe$/i.test(file.name || '')) {
        alert('请选择 GetData.exe 文件。');
        e.target.value = '';
        return;
      }
      updateBundledGetDataStatus('正在复制 GetData.exe 到本软件目录...', 'info');
      var formData = new FormData();
      formData.append('file', file);
      formData.append('userId', currentUserId);
      try {
        var response = await fetch('/api/pdf-wiki/getdata/import-exe', {
          method: 'POST',
          body: formData
        });
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success) throw new Error(result.error || '复制 GetData.exe 失败');
        updateBundledGetDataStatus(result.message || '已复制 GetData.exe，正在重新检测...', 'ok');
        await refreshBundledGetDataStatus(false);
      } catch (error) {
        updateBundledGetDataStatus('复制失败：' + error.message, 'error');
        alert('复制 GetData.exe 失败：' + error.message);
      } finally {
        e.target.value = '';
      }
    }

    async function handlePdfWikiDigitizationFileInputChange(e) {
      var file = e && e.target && e.target.files && e.target.files[0];
      if (!file) return;
      if (!pendingPdfWikiDigitizationImport || !pendingPdfWikiDigitizationImport.pdfId) {
        alert('请先选择需要回填的 PDF 和图件');
        e.target.value = '';
        return;
      }
      pendingPdfWikiDigitizationFile = file;
      pdfWikiDigitizationEvidenceSaved = false;
      var selectedFile = document.getElementById('pdfWikiDigitizationSelectedFile');
      if (selectedFile) {
        selectedFile.innerHTML = '<strong style="color:var(--text-primary);">已选择：</strong>' + escapeHtml(file.name) + ' <span style="color:var(--text-secondary);">(' + Math.round(file.size / 1024) + ' KB)</span>';
        await loadPdfWikiDigitizationPendingValuesFromFile(file);
      } else {
        await uploadPendingPdfWikiDigitizationFile('');
      }
      e.target.value = '';
    }

    function collectPdfWikiDigitizationParameters() {
      function value(id) {
        var el = document.getElementById(id);
        return el ? String(el.value || '').trim() : '';
      }
      var rawReadRole = value('digitizationReadRole');
      var parsedReadRole = parsePdfWikiDigitizationReadRoleSelection(rawReadRole);
      var treatment = value('digitizationTreatment') || parsedReadRole.treatment;
      var control = value('digitizationControl') || parsedReadRole.control;
      var factorVariables = {};
      var factorInputs = document.querySelectorAll('[data-digitization-factor-variable="1"]');
      Array.prototype.forEach.call(factorInputs, function(input) {
        var encodedColumn = input.getAttribute('data-column') || '';
        var column = '';
        try {
          column = decodeURIComponent(encodedColumn);
        } catch (_) {
          column = encodedColumn;
        }
        column = String(column || '').trim();
        var text = String(input.value || '').trim();
        if (column && text) factorVariables[column] = text;
      });
      function firstFactorValue(pattern) {
        var keys = Object.keys(factorVariables);
        for (var i = 0; i < keys.length; i += 1) {
          if (pattern.test(keys[i])) return factorVariables[keys[i]];
        }
        return '';
      }
      return {
        outcome: value('digitizationOutcome'),
        readRole: parsedReadRole.readRole,
        readRoleRaw: rawReadRole,
        readRoleTreatment: parsedReadRole.treatment,
        readRoleControl: parsedReadRole.control,
        treatment: treatment,
        control: control,
        subfigure: value('digitizationSubfigure'),
        xVariable: value('digitizationXVariable'),
        unit: value('digitizationUnit'),
        seriesName: value('digitizationSeriesName'),
        aggregationMode: value('digitizationAggregationMode'),
        factorVariables: factorVariables,
        cropType: firstFactorValue(/作物|crop/i),
        studyYear: firstFactorValue(/年份|year/i)
      };
    }

    window.confirmPdfWikiDigitizationImport = async function() {
      var targetPdfId = pendingPdfWikiDigitizationImport && pendingPdfWikiDigitizationImport.pdfId
        ? pendingPdfWikiDigitizationImport.pdfId
        : pdfWikiDigitizationCurrentPdfId;
      if (!targetPdfId) {
        alert('未找到当前 PDF，无法保存。');
        return;
      }
      var confirmBtn = document.getElementById('digitizationConfirmBtn');
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = '保存中...';
      }
      try {
        var evidenceSavedNow = false;
        if (pendingPdfWikiDigitizationFile && !pdfWikiDigitizationEvidenceSaved) {
          if (confirmBtn) confirmBtn.textContent = '保存证据中...';
          await uploadPendingPdfWikiDigitizationFile('', {
            silent: true,
            close: false,
            reload: false,
            clearState: false
          });
          pdfWikiDigitizationEvidenceSaved = true;
          evidenceSavedNow = true;
        }
        if (confirmBtn) confirmBtn.textContent = '保存编码表中...';
        await savePdfWikiDigitizationCodingTable({ reload: false });
        pendingPdfWikiDigitizationFile = null;
        pdfWikiDigitizationEvidenceSaved = false;
        alert(evidenceSavedNow ? '图像数字化证据和 Meta 编码表已保存。' : 'Meta 编码表已保存。');
        closeModal();
        await reloadPdfWikiMetaDatabase(targetPdfId);
      } catch (error) {
        alert('保存 Meta 编码表失败：' + error.message);
      } finally {
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = '保存编码表并关闭';
        }
      }
    };

    async function uploadPendingPdfWikiDigitizationFile(note, options) {
      options = options || {};
      var file = pendingPdfWikiDigitizationFile;
      if (!file || !pendingPdfWikiDigitizationImport || !pendingPdfWikiDigitizationImport.pdfId) {
        alert('请先选择需要回填的 PDF、图件和 GetData 导出文件');
        return;
      }
      var targetPdfId = pendingPdfWikiDigitizationImport.pdfId;
      var confirmBtn = document.getElementById('digitizationConfirmBtn');
      if (confirmBtn && !options.silent) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = '保存证据中...';
      }
      var parameters = collectPdfWikiDigitizationParameters();
      var noteParts = [];
      if (note) noteParts.push(note);
      function summarizeDigitizationParameterValue(value) {
        if (value == null || value === '') return '';
        if (typeof value === 'object') {
          try {
            return JSON.stringify(value);
          } catch (_error) {
            return '';
          }
        }
        return String(value);
      }
      var paramSummary = Object.keys(parameters).map(function(key) {
        var value = summarizeDigitizationParameterValue(parameters[key]);
        return value ? (key + '=' + value) : '';
      }).filter(Boolean).join('; ');
      if (paramSummary) noteParts.push('人工参数：' + paramSummary);
      var formData = new FormData();
      formData.append('file', file);
      formData.append('userId', currentUserId);
      formData.append('pdfId', pendingPdfWikiDigitizationImport.pdfId);
      formData.append('figureKey', pendingPdfWikiDigitizationImport.figureKey || '');
      formData.append('figureLabel', pendingPdfWikiDigitizationImport.figureLabel || '');
      formData.append('tool', 'GetData Graph Digitizer');
      formData.append('notes', noteParts.join('\n'));
      formData.append('parameters', JSON.stringify(parameters || {}));
      try {
        var response = await fetch('/api/pdf-wiki/meta/figures/digitization/import', {
          method: 'POST',
          body: formData
        });
        var result = await readPdfWikiMetaJsonResponse(response, '导入 GetData 结果');
        if (!options.silent) {
          alert('已保存图像数字化导出文件：' + result.importedRows + ' 行。该文件只作为复核证据保存，不会自动新增 Meta 编码表行。');
        }
        pdfWikiDigitizationEvidenceSaved = true;
        if (options.close !== false) closeModal();
        if (options.reload !== false) await reloadPdfWikiMetaDatabase(result.pdfId || targetPdfId);
        return result;
      } catch (error) {
        if (!options.silent) alert('导入 GetData 结果失败：' + error.message);
        throw error;
      } finally {
        if (confirmBtn && !options.silent) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = '保存编码表并关闭';
        }
        if (options.clearState !== false) {
          pendingPdfWikiDigitizationImport = null;
          pendingPdfWikiDigitizationFile = null;
        }
      }
    }

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('meta-analysis', { source: '/app/meta-analysis.js' });
}
