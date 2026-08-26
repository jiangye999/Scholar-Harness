    // ============ 实验结果上传相关变量和函数 ============
    var pendingExperimentFiles = [];  // 待上传的实验结果文件
    var isUploadingExperiment = false;  // 上传状态
    var isExperimentUploadRequestInFlight = false;
    var mainDragUploadDepth = 0;
    var experimentFigurePlanChoices = [
      { label: 'Figure 1(a)', figureName: 'Figure 1', panelLabel: 'a' },
      { label: 'Figure 1(b)', figureName: 'Figure 1', panelLabel: 'b' },
      { label: 'Figure 2(a)', figureName: 'Figure 2', panelLabel: 'a' },
      { label: 'Figure 2(b)', figureName: 'Figure 2', panelLabel: 'b' },
      { label: 'Fig. S1', figureName: 'Supplementary Figure S1', panelLabel: '' }
    ];
    
    // 触发实验结果文件选择
    function triggerExperimentUpload() {
      var input = document.getElementById('experimentFileInput');
      if (input) {
        input.click();
      }
    }
    window.triggerExperimentUpload = triggerExperimentUpload;
    
    // 初始化实验结果文件输入监听
    function initExperimentUpload() {
      var input = document.getElementById('experimentFileInput');
      if (input) {
        input.addEventListener('change', handleExperimentFileSelect);
      }
    }

    function getExperimentUploadAcceptedExtensions() {
      return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'heic', 'heif', 'svg', 'pdf', 'doc', 'docx', 'xlsx', 'xls', 'csv', 'txt', 'md'];
    }

    function isSupportedExperimentUploadFile(fileName) {
      var ext = String(fileName || '').split('.').pop().toLowerCase();
      return getExperimentUploadAcceptedExtensions().indexOf(ext) !== -1;
    }

    function getLocalPathForUploadedFile(file) {
      if (!file) return '';
      try {
        if (window.electronAPI && typeof window.electronAPI.getPathForFile === 'function') {
          var electronPath = String(window.electronAPI.getPathForFile(file) || '').trim();
          if (electronPath) return electronPath;
        }
      } catch (error) {
        console.warn('[ExperimentUpload] Failed to resolve Electron file path:', error);
      }
      return String(file.path || '').trim();
    }

    function addExperimentFilesToPending(files, source) {
      var list = Array.prototype.slice.call(files || []);
      var added = 0;
      var duplicate = 0;
      var unsupported = 0;
      var pathsRecorded = 0;
      if (files && files.length > 0) {
        for (var i = 0; i < list.length; i++) {
          var file = list[i];
          if (!file || !file.name) continue;
          if (!isSupportedExperimentUploadFile(file.name)) {
            unsupported += 1;
            continue;
          }
          // 检查是否已在列表中（避免重复）
          var originalPath = getLocalPathForUploadedFile(file);
          var exists = pendingExperimentFiles.some(function(f) {
            return f.name === file.name && f.size === file.size && (!originalPath || !f.originalPath || f.originalPath === originalPath);
          });
          if (exists) {
            duplicate += 1;
            continue;
          }
          if (!exists) {
            pendingExperimentFiles.push({
              file: file,
              name: file.name,
              originalName: file.name,
              originalPath: originalPath,
              lastModified: Number(file.lastModified || 0),
              inputSource: source === 'drop' ? 'drop' : 'file-picker',
              size: file.size,
              type: getFileType(file.name),
              figureName: '',
              panelLabel: '',
              title: '',
              caption: '',
              requestedFileName: '',
              saveAsPaperFigure: !isLikelyScreenshotFile({ name: file.name })
            });
            if (originalPath) pathsRecorded += 1;
            added += 1;
          }
        }
      }
      if (added > 0 || duplicate > 0 || unsupported > 0) {
        updateUploadedFilesPreview();
        console.log('[ExperimentUpload] ' + (source || 'select') + ' added=' + added + ', duplicate=' + duplicate + ', unsupported=' + unsupported + ', total pending=' + pendingExperimentFiles.length);
      }
      return { added: added, duplicate: duplicate, unsupported: unsupported, pathsRecorded: pathsRecorded };
    }

    // 处理文件选择
    function handleExperimentFileSelect(event) {
      var files = event.target.files;
      if (files && files.length > 0) {
        addExperimentFilesToPending(files, 'select');
      }
      // 清空 input，允许再次选择相同文件
      event.target.value = '';
    }

    function hasDraggedFiles(event) {
      var types = event && event.dataTransfer && event.dataTransfer.types;
      if (!types) return false;
      for (var i = 0; i < types.length; i++) {
        if (types[i] === 'Files') return true;
      }
      return false;
    }

    function isMainDragUploadTarget(event) {
      var target = event && event.target;
      if (!target || !target.closest) return false;
      if (target.closest('.modal-overlay, .modal, .sidebar, .right-sidebar')) return false;
      return !!target.closest('.main');
    }

    function ensureMainDragUploadOverlay() {
      var overlay = document.getElementById('mainDragUploadOverlay');
      if (overlay) return overlay;
      overlay = document.createElement('div');
      overlay.id = 'mainDragUploadOverlay';
      overlay.className = 'main-drag-upload-overlay';
      overlay.innerHTML =
        '<div class="main-drag-upload-card">' +
          uiIcon('upload', 'lg') +
          '<div class="main-drag-upload-title">松手上传文件</div>' +
          '<div class="main-drag-upload-subtitle">支持图片、表格、PDF、Word 和文本资料，上传后会出现在输入框上方。</div>' +
        '</div>';
      document.body.appendChild(overlay);
      return overlay;
    }

    function setMainDragUploadActive(active) {
      var overlay = ensureMainDragUploadOverlay();
      overlay.classList.toggle('active', !!active);
    }

    function initMainDragUpload() {
      ensureMainDragUploadOverlay();

      document.addEventListener('dragenter', function(event) {
        if (!hasDraggedFiles(event) || !isMainDragUploadTarget(event)) return;
        event.preventDefault();
        mainDragUploadDepth += 1;
        setMainDragUploadActive(true);
      });

      document.addEventListener('dragover', function(event) {
        if (!hasDraggedFiles(event) || !isMainDragUploadTarget(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setMainDragUploadActive(true);
      });

      document.addEventListener('dragleave', function(event) {
        if (!hasDraggedFiles(event)) return;
        mainDragUploadDepth = Math.max(0, mainDragUploadDepth - 1);
        if (mainDragUploadDepth === 0) setMainDragUploadActive(false);
      });

      document.addEventListener('drop', function(event) {
        if (!hasDraggedFiles(event)) return;
        if (!isMainDragUploadTarget(event)) {
          mainDragUploadDepth = 0;
          setMainDragUploadActive(false);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        mainDragUploadDepth = 0;
        setMainDragUploadActive(false);
        var result = addExperimentFilesToPending(event.dataTransfer.files, 'drop');
        if (result.added > 0) {
          focusMainChatInput();
          appendMessage(
            '已添加 ' + result.added + ' 个文件到输入框上方，并记录文件名' +
            (result.pathsRecorded ? '及 ' + result.pathsRecorded + ' 个原始路径' : '') +
            '。填写要求后点击发送即可上传分析。' +
            (result.unsupported ? '\n\n已忽略 ' + result.unsupported + ' 个不支持的文件。' : ''),
            'bot',
            false,
            true
          );
        } else if (result.unsupported > 0) {
          appendMessage('未添加文件：拖入的文件类型暂不支持。', 'bot', false, true);
        }
      });

      window.addEventListener('dragend', function() {
        mainDragUploadDepth = 0;
        setMainDragUploadActive(false);
      });
    }
    
    // 获取文件类型图标
    function getFileType(fileName) {
      var ext = fileName.split('.').pop().toLowerCase();
      if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'heic', 'heif', 'svg'].includes(ext)) {
        return 'image';
      } else if (ext === 'pdf') {
        return 'pdf';
      } else if (['doc', 'docx'].includes(ext)) {
        return 'word';
      } else if (['xlsx', 'xls', 'csv'].includes(ext)) {
        return 'table';
      } else if (['txt', 'md'].includes(ext)) {
        return 'text';
      }
      return 'unknown';
    }

    function isVisionFileName(fileName) {
      return /\.(png|jpe?g|gif|bmp|webp|tiff?|heic|heif|svg)$/i.test(String(fileName || ''));
    }

    function hasVisionInputForMainChat() {
      return Array.isArray(uploadedFiles) && uploadedFiles.some(function(file) {
        var name = file && (file.name || file.fileName || file.filename || file.path || '');
        return file && (file.type === 'image' || isVisionFileName(name));
      });
    }
    
    // 获取文件类型图标显示
    function getFileTypeIcon(type) {
      var icons = {
        'image': uiIcon('image'),
        'pdf': uiIcon('fileText'),
        'word': uiIcon('fileText'),
        'table': uiIcon('table'),
        'text': uiIcon('clipboard'),
        'unknown': uiIcon('paperclip')
      };
      return icons[type] || uiIcon('paperclip');
    }

    function isExperimentImageFile(fileInfo) {
      var type = String(fileInfo && fileInfo.type || '').toLowerCase();
      var name = String(fileInfo && fileInfo.name || '').toLowerCase();
      return !!fileInfo && (type === 'image' || type.indexOf('image/') === 0 || isVisionFileName(name));
    }

    function isExperimentFigurePlanComplete(fileInfo) {
      if (!isExperimentImageFile(fileInfo)) return true;
      return !!String(fileInfo.figureName || '').trim();
    }

    function getExperimentFigurePlanStatus(fileInfo) {
      if (!isExperimentImageFile(fileInfo)) return '';
      return isExperimentFigurePlanComplete(fileInfo) ? '已规划' : '待填写 Figure 名称';
    }

    function buildExperimentFigurePlanPayload(fileInfo) {
      if (!isExperimentImageFile(fileInfo)) return null;
      return {
        originalFileName: fileInfo.name || '',
        figureName: String(fileInfo.figureName || '').trim(),
        panelLabel: String(fileInfo.panelLabel || '').trim(),
        title: String(fileInfo.title || '').trim(),
        caption: String(fileInfo.caption || '').trim()
      };
    }

    function experimentFigureNameAlreadyIncludesPanelLabel(figureName, panelLabel) {
      var name = String(figureName || '').trim();
      var panel = String(panelLabel || '').trim();
      if (!name || !panel) return false;
      var escapedPanel = panel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('(?:\\(' + escapedPanel + '\\)|[-_\\s]?' + escapedPanel + ')$', 'i').test(name);
    }

    function formatExperimentFigureLabel(figureName, panelLabel) {
      var name = String(figureName || '').trim();
      var panel = String(panelLabel || '').trim();
      if (!name) return panel ? 'Figure (' + panel + ')' : '';
      if (!panel || experimentFigureNameAlreadyIncludesPanelLabel(name, panel)) return name;
      return name + '(' + panel + ')';
    }

    function updateExperimentFilePlan(index, field, value) {
      if (index < 0 || index >= pendingExperimentFiles.length) return;
      if (!['figureName', 'panelLabel', 'title', 'caption', 'requestedFileName'].includes(field)) return;
      pendingExperimentFiles[index][field] = value;
    }
    window.updateExperimentFilePlan = updateExperimentFilePlan;

    function toggleExperimentPaperFigureSave(index, checked) {
      if (index < 0 || index >= pendingExperimentFiles.length) return;
      pendingExperimentFiles[index].saveAsPaperFigure = checked === true;
      renderExperimentFigurePlanPanel();
      updateUploadedFilesPreview();
    }
    window.toggleExperimentPaperFigureSave = toggleExperimentPaperFigureSave;

    function applyExperimentFigureChoice(index, figureName, panelLabel) {
      if (index < 0 || index >= pendingExperimentFiles.length) return;
      pendingExperimentFiles[index].figureName = figureName || '';
      pendingExperimentFiles[index].panelLabel = panelLabel || '';
      renderExperimentFigurePlanPanel();
      updateUploadedFilesPreview();
    }
    window.applyExperimentFigureChoice = applyExperimentFigureChoice;

    function renderExperimentFigurePlanPanel() {
      var panel = document.getElementById('experimentFigurePlanPanel');
      if (!panel) return;
      var imageEntries = [];
      for (var i = 0; i < pendingExperimentFiles.length; i++) {
        if (isExperimentImageFile(pendingExperimentFiles[i])) {
          imageEntries.push({ index: i, fileInfo: pendingExperimentFiles[i] });
        }
      }
      if (!imageEntries.length) {
        panel.classList.remove('active');
        panel.innerHTML = '';
        return;
      }

      var completeCount = imageEntries.filter(function(entry) {
        return isExperimentFigurePlanComplete(entry.fileInfo);
      }).length;
      var html = '<div class="experiment-figure-plan-head">' +
        '<div><span class="experiment-figure-plan-title">图片规划</span> <span>按 Figure 和小图组织上传图片</span></div>' +
        '<div>' + completeCount + '/' + imageEntries.length + ' 已填写</div>' +
      '</div>';
      html += '<div class="experiment-figure-plan-list">';
      imageEntries.forEach(function(entry) {
        var index = entry.index;
        var fileInfo = entry.fileInfo;
        var planText = formatExperimentFigureLabel(fileInfo.figureName, fileInfo.panelLabel);
        var ready = isExperimentFigurePlanComplete(fileInfo);
        html += '<div class="experiment-figure-plan-row">' +
          '<div class="experiment-figure-plan-file">' +
            '<div>' + getFileTypeIcon(fileInfo.type) + ' ' + escapeHtml(fileInfo.name) + '</div>' +
            '<span class="experiment-figure-plan-status' + (ready ? ' ready' : '') + '">' + escapeHtml(planText || getExperimentFigurePlanStatus(fileInfo)) + '</span>' +
          '</div>' +
          '<div>' +
            '<div class="experiment-figure-choice-row">';
        experimentFigurePlanChoices.forEach(function(choice) {
          var active = fileInfo.figureName === choice.figureName && String(fileInfo.panelLabel || '') === String(choice.panelLabel || '');
          html += '<button type="button" class="experiment-figure-choice' + (active ? ' active' : '') + '" onclick="applyExperimentFigureChoice(' + index + ', \'' + escapeHtml(choice.figureName) + '\', \'' + escapeHtml(choice.panelLabel) + '\')">' + escapeHtml(choice.label) + '</button>';
        });
        html += '</div>' +
            '<label class="experiment-paper-save-toggle">' +
              '<input type="checkbox" onchange="toggleExperimentPaperFigureSave(' + index + ', this.checked)"' + (fileInfo.saveAsPaperFigure ? ' checked' : '') + '>' +
              '<span>保存到右侧“论文图片”</span>' +
            '</label>' +
            '<div class="experiment-figure-plan-fields">' +
              '<input value="' + escapeHtml(fileInfo.figureName || '') + '" placeholder="Figure 1 / 图1" oninput="updateExperimentFilePlan(' + index + ', \'figureName\', this.value)">' +
              '<input value="' + escapeHtml(fileInfo.panelLabel || '') + '" placeholder="a / b / 小图标签" oninput="updateExperimentFilePlan(' + index + ', \'panelLabel\', this.value)">' +
              '<input value="' + escapeHtml(fileInfo.requestedFileName || '') + '" placeholder="保存文件名（可选）" oninput="updateExperimentFilePlan(' + index + ', \'requestedFileName\', this.value)">' +
              '<input value="' + escapeHtml(fileInfo.title || '') + '" placeholder="图片标题：如 Seasonal N2O flux" oninput="updateExperimentFilePlan(' + index + ', \'title\', this.value)">' +
              '<input class="wide" value="' + escapeHtml(fileInfo.caption || '') + '" placeholder="完整图注：变量、处理、单位、统计检验和显著性说明" oninput="updateExperimentFilePlan(' + index + ', \'caption\', this.value)">' +
            '</div>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
      panel.innerHTML = html;
      panel.classList.add('active');
    }

    function getExperimentPanelLabelByIndex(index) {
      var alphabet = 'abcdefghijklmnopqrstuvwxyz';
      var value = Number(index || 0);
      if (value < alphabet.length) return alphabet[value];
      return 'p' + (value + 1);
    }

    function ensureExperimentFigurePlansBeforeUpload() {
      var imageEntries = pendingExperimentFiles.filter(isExperimentImageFile);
      if (!imageEntries.length) return true;
      var autoLabels = [];
      imageEntries.forEach(function(fileInfo, imageIndex) {
        if (isExperimentFigurePlanComplete(fileInfo)) return;
        fileInfo.figureName = 'Figure 1';
        fileInfo.panelLabel = imageEntries.length > 1 ? getExperimentPanelLabelByIndex(imageIndex) : '';
        autoLabels.push(fileInfo.name + ' → ' + formatExperimentFigureLabel(fileInfo.figureName, fileInfo.panelLabel));
      });
      if (!autoLabels.length) return true;
      renderExperimentFigurePlanPanel();
      updateUploadedFilesPreview();
      appendMessage('未填写 Figure 分组的图片已按文件顺序自动标记：\n' + autoLabels.join('\n'), 'bot', false, true);
      return true;
    }
    
    // 更新已上传文件预览
    function updateUploadedFilesPreview() {
      var previewContainer = document.getElementById('uploadedFilesPreview');
      if (!previewContainer) return;
      
      previewContainer.innerHTML = '';
      
      for (var i = 0; i < pendingExperimentFiles.length; i++) {
        var fileInfo = pendingExperimentFiles[i];
        var item = document.createElement('div');
        item.className = 'uploaded-file-preview-item';
        var statusText = getExperimentFigurePlanStatus(fileInfo);
        var sourceTrace = [
          statusText,
          '文件名：' + String(fileInfo.originalName || fileInfo.name || ''),
          fileInfo.originalPath ? '原始路径：' + fileInfo.originalPath : ''
        ].filter(Boolean).join('\n');
        item.innerHTML = 
          '<span class="file-icon">' + getFileTypeIcon(fileInfo.type) + '</span>' +
          '<span class="file-name" title="' + escapeHtml(sourceTrace || fileInfo.name) + '">' + escapeHtml(fileInfo.name) + '</span>' +
          '<span class="remove-file" onclick="removePendingFile(' + i + ')">' + uiIcon('x', 'sm') + '</span>';
        previewContainer.appendChild(item);
      }
      
      // 显示/隐藏预览区域
      previewContainer.style.display = pendingExperimentFiles.length > 0 ? 'flex' : 'none';
      var wrapper = previewContainer.closest('.input-wrapper');
      if (wrapper) {
        wrapper.classList.toggle('has-pending-experiment-files', pendingExperimentFiles.length > 0);
      }
      renderExperimentFigurePlanPanel();
    }
    
    // 移除待上传文件
    function removePendingFile(index) {
      if (index >= 0 && index < pendingExperimentFiles.length) {
        pendingExperimentFiles.splice(index, 1);
        updateUploadedFilesPreview();
        console.log('[ExperimentUpload] Removed file at index ' + index + ', remaining: ' + pendingExperimentFiles.length);
      }
    }
    window.removePendingFile = removePendingFile;

    function getPendingExperimentFileIdentity(fileInfo) {
      if (!fileInfo) return '';
      return [
        String(fileInfo.originalPath || ''),
        String(fileInfo.originalName || fileInfo.name || ''),
        String(fileInfo.size || 0),
        String(fileInfo.lastModified || 0)
      ].join('\u0001');
    }

    function detachPendingExperimentFilesForSend(files) {
      var submittedFiles = Array.isArray(files) ? files.filter(Boolean) : [];
      if (!submittedFiles.length) return;
      pendingExperimentFiles = pendingExperimentFiles.filter(function(fileInfo) {
        return submittedFiles.indexOf(fileInfo) < 0;
      });
      updateUploadedFilesPreview();
    }

    function restorePendingExperimentFilesAfterFailure(files) {
      var failedFiles = Array.isArray(files) ? files.filter(Boolean) : [];
      if (!failedFiles.length) return;
      var existing = {};
      pendingExperimentFiles.forEach(function(fileInfo) {
        existing[getPendingExperimentFileIdentity(fileInfo)] = true;
      });
      var restored = failedFiles.filter(function(fileInfo) {
        var key = getPendingExperimentFileIdentity(fileInfo);
        if (existing[key]) return false;
        existing[key] = true;
        return true;
      });
      pendingExperimentFiles = restored.concat(pendingExperimentFiles);
      updateUploadedFilesPreview();
    }

    function getExperimentUploadContextText() {
      return (document.getElementById('userInput')?.value || '').trim();
    }

    function clearExperimentUploadInput(submittedText) {
      var input = document.getElementById('userInput');
      if (!input) return;
      if (!submittedText || input.value.trim() === submittedText) {
        input.value = '';
        autoResize();
        syncChatPlaceholder();
      }
    }

    function inferExperimentWorkflowIntent(text) {
      var raw = String(text || '');
      var dataAnalysis = /(数据分析|统计分析|重新计算|重新算|计算|重算|sheet|worksheet|工作表|excel|xlsx|xls|csv|数据表|表格数据|变量|列|行|spss|显著性|p\s*[<=>]|t\s*检验|t检验|方差分析|anova|相关|回归|卡方|正态|方差齐性|非参数|pca|主成分|聚类|混合效应|生存分析)/i.test(raw);
      var rPlot = /(r\s*语言|r\s*作图|作图|绘图|画图|图表|可视化|ggplot|箱线图|柱状图|折线图|散点图|热图|小提琴图|显著性标注)/i.test(raw);
      return {
        dataAnalysis: dataAnalysis,
        rPlot: rPlot,
        needsWorkflow: dataAnalysis || rPlot
      };
    }

    function hasExperimentUploadIntent(text) {
      var raw = String(text || '');
      return /(实验资料|实验结果|数据分析|统计分析|r\s*语言|r\s*作图|作图|绘图|画图|图表|可视化|ggplot|显著性|方差分析|anova|t\s*检验|p\s*[<=>]|箱线图|柱状图|折线图|散点图|热图|小提琴图|meta\s*分析|效应量)/i.test(raw);
    }

    function isLikelyScreenshotFile(fileInfo) {
      var name = String(fileInfo && fileInfo.name || '').toLowerCase();
      return /(screenshot|screen\s*shot|截屏|截图|屏幕|screen_shot|screen-shot|snip|capture|微信图片|qq图片)/i.test(name);
    }

    function hasWorkspaceBackedVisualReferenceIntent(text) {
      var raw = String(text || '').trim();
      if (!raw) return false;
      var usesUploadedImageAsReference = /(?:这个|这张|上传的|上面的|刚才的)?\s*(?:图|图片|截图).{0,28}(?:参考|参照|照着|仿照|类似|一样|思路|风格|布局|作为|当做|命名|标记)|(?:参考|参照|照着|仿照|按照|按|类似|一样).{0,28}(?:图|图片|截图)|(?:图|figure|panel)\s*[a-z0-9]+.{0,20}(?:当做|作为|命名为|改成)/i.test(raw);
      var readsDataOutsideTheUpload = /(?:工作路径|工作目录|当前目录|本地路径|项目目录|路径|目录).{0,24}(?:下面|下|里面|中|内|已有|有|读取|查找|寻找)?\s*(?:数据|文件)|(?:数据|文件).{0,24}(?:在|位于|来自|读取自)?\s*(?:工作路径|工作目录|当前目录|本地路径|项目目录|路径|目录)/i.test(raw);
      return usesUploadedImageAsReference && readsDataOutsideTheUpload;
    }

    function shouldRoutePendingFilesToChatAttachments(text) {
      if (!pendingExperimentFiles.length) return false;
      var raw = String(text || '').trim();
      var imageFiles = pendingExperimentFiles.filter(isExperimentImageFile);
      var allPendingFilesAreImages = imageFiles.length === pendingExperimentFiles.length;
      // 只要本轮只有图片且用户给出了 query，就先交给视觉 AI 做结构化意图识别。
      // 是否需要数据分析、R 作图、UI 排错或仅回答图片问题，由 AI 结合 query 判断，
      // 不再用关键词提前把图片消息截走到某个固定工作流。
      if (allPendingFilesAreImages && raw) return true;
      if (hasExperimentUploadIntent(raw)) return false;
      // 用户已经提出具体问题时，附件只是本轮 query 的材料。不能让通用的
      // “实验资料结构化分析”提前消费消息，否则 Word/PDF 会答非所问。
      if (raw) return true;
      if (!allPendingFilesAreImages) return false;
      if (imageFiles.some(function(fileInfo) { return fileInfo.saveAsPaperFigure === true; })) return true;
      return imageFiles.some(isLikelyScreenshotFile);
    }

    function hasChatAttachmentVision(attachments) {
      return Array.isArray(attachments) && attachments.some(function(file) {
        return file && (file.type === 'image' || isVisionFileName(file.name || file.path || ''));
      });
    }

    async function classifyMultimodalAttachmentIntent(chatRequestBody) {
      var attachments = Array.isArray(chatRequestBody && chatRequestBody.chatAttachments)
        ? chatRequestBody.chatAttachments
        : [];
      if (!hasChatAttachmentVision(attachments)) return null;
      var nativeAgentRuntime = String(
        chatRequestBody.agentRuntime || chatRequestBody.forceProvider || ''
      ).trim().toLowerCase();
      if (nativeAgentRuntime === 'codex' || nativeAgentRuntime === 'pi' || nativeAgentRuntime === 'opencode') {
        console.log('[MultimodalIntent] Native Agent will inspect the image directly; skipping the duplicate vision classifier');
        return null;
      }
      var payload = {
        message: String(chatRequestBody.message || '').trim(),
        userId: chatRequestBody.userId || currentUserId || 'web-user',
        conversationId: chatRequestBody.conversationId || currentConversationId || null,
        chatAttachments: attachments,
        workspaceDirectory: chatRequestBody.workspaceDirectory,
        forceProvider: chatRequestBody.forceProvider,
        apiUrl: chatRequestBody.apiUrl,
        apiKey: chatRequestBody.apiKey,
        model: chatRequestBody.model,
        visionApiUrl: chatRequestBody.visionApiUrl,
        visionApiKey: chatRequestBody.visionApiKey,
        visionModel: chatRequestBody.visionModel,
        codexImages: chatRequestBody.codexImages || [],
        visionImages: chatRequestBody.visionImages || []
      };
      try {
        console.log('[MultimodalIntent] Stage 1: analyzing image role and requested follow-up action');
        var response = await fetch('/api/chat-bridge/multimodal-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: currentAbortController ? currentAbortController.signal : undefined
        });
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success || !result.intent) {
          console.warn('[MultimodalIntent] Stage 1 unavailable; falling back to direct multimodal chat:', result.error || response.status);
          return null;
        }
        console.log('[MultimodalIntent] Stage 1 complete:', {
          primaryIntent: result.intent.primaryIntent,
          imageRole: result.intent.imageRole,
          requiresFollowupAction: result.intent.requiresFollowupAction,
          requestedActions: result.intent.requestedActions
        });
        return result.intent;
      } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        console.warn('[MultimodalIntent] Stage 1 failed; falling back to direct multimodal chat:', error);
        return null;
      }
    }

    function getDefaultChatAttachmentMessage(files) {
      var count = Array.isArray(files) ? files.length : 0;
      return count > 0 ? '请查看我上传的截图，并结合截图内容处理。' : '';
    }

    function getPaperFigureFallbackTitle(fileInfo) {
      return String(fileInfo && fileInfo.name || '')
        .replace(/\.[^.]+$/, '')
        .replace(/[-_]+/g, ' ')
        .trim();
    }

    function extractPaperFigureInstructionValue(text, labels) {
      var labelPattern = labels.join('|');
      var match = String(text || '').match(new RegExp('(?:' + labelPattern + ')\\s*(?:为|是|[:：=])\\s*([^\\n；;]+)', 'i'));
      return match && match[1] ? match[1].trim().replace(/[。,.，]+$/, '') : '';
    }

    function applyPaperFigureMetadataFromInstruction(fileInfos, instructionText) {
      var images = (fileInfos || []).filter(isExperimentImageFile);
      var text = String(instructionText || '').trim();
      if (!text || images.length !== 1) return;
      var fileInfo = images[0];
      var figureMatch = text.match(/(?:Figure|Fig\.?|图)\s*[-_ ]*(\d+(?:\s*\(?[a-z]\)?)?|S\d+(?:\s*\(?[a-z]\)?)?)/i);
      if (figureMatch && !String(fileInfo.figureName || '').trim()) {
        var rawFigure = figureMatch[0].replace(/\s+/g, ' ').trim();
        var panelMatch = rawFigure.match(/\(([a-z])\)\s*$/i);
        fileInfo.figureName = panelMatch ? rawFigure.replace(/\s*\([a-z]\)\s*$/i, '') : rawFigure;
        if (panelMatch && !String(fileInfo.panelLabel || '').trim()) fileInfo.panelLabel = panelMatch[1];
      }
      var title = extractPaperFigureInstructionValue(text, ['图片标题', '图题', 'title']);
      var caption = extractPaperFigureInstructionValue(text, ['完整图注', '图注', 'caption', 'legend']);
      var requestedFileName = extractPaperFigureInstructionValue(text, ['保存文件名', '文件名', '命名为']);
      if (title && !String(fileInfo.title || '').trim()) fileInfo.title = title;
      if (caption && !String(fileInfo.caption || '').trim()) fileInfo.caption = caption;
      if (requestedFileName && !String(fileInfo.requestedFileName || '').trim()) fileInfo.requestedFileName = requestedFileName;
      if (/(?:保存|归档|加入|添加).{0,20}(?:论文图片|稿件图片|图片库|figure)/i.test(text)) {
        fileInfo.saveAsPaperFigure = true;
      }
    }

    async function archiveUploadedPaperFigures(fileInfos, savedFiles, sourceKind) {
      var archived = [];
      var errors = [];
      var savedList = Array.isArray(savedFiles) ? savedFiles : [];
      for (var i = 0; i < (fileInfos || []).length; i++) {
        var fileInfo = fileInfos[i];
        if (!isExperimentImageFile(fileInfo) || fileInfo.saveAsPaperFigure !== true) continue;
        var savedFile = savedList.find(function(item) {
          return item && String(item.name || '') === String(fileInfo.name || '');
        }) || savedList[i];
        if (!savedFile) {
          errors.push((fileInfo.name || '图片') + '：未找到上传后的文件路径');
          continue;
        }
        var source = savedFile.source || {
          kind: sourceKind,
          originalPath: savedFile.path || ''
        };
        if (!source.originalPath) {
          errors.push((fileInfo.name || '图片') + '：缺少保存路径');
          continue;
        }
        var figureLabel = formatExperimentFigureLabel(fileInfo.figureName, fileInfo.panelLabel)
          || inferFigureLabelFromFileName(fileInfo.name || '')
          || 'Figure';
        var title = String(fileInfo.title || '').trim() || getPaperFigureFallbackTitle(fileInfo);
        var caption = String(fileInfo.caption || '').trim() || title || figureLabel;
        try {
          var response = await fetch('/api/draft-assets/figures/library', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: currentUserId || 'web-user',
              figureLabel: figureLabel,
              title: title,
              caption: caption,
              requestedFileName: String(fileInfo.requestedFileName || '').trim(),
              source: source
            })
          });
          var result = await response.json().catch(function() { return {}; });
          if (!response.ok || !result.success) throw new Error(result.error || ('HTTP ' + response.status));
          savedFile.paperFigureAsset = result.asset;
          savedFile.figurePlan = buildExperimentFigurePlanPayload(fileInfo);
          archived.push(result.asset);
        } catch (error) {
          errors.push((fileInfo.name || '图片') + '：' + (error.message || error));
        }
      }
      if (archived.length) {
        invalidatePaperFigureLibraryCache(false);
        if (getRightSidebarActiveTab() === 'figures') renderPaperFigureLibraryPanel(true);
      }
      if (errors.length) {
        console.warn('[PaperFigures] Archive failed:', errors);
      }
      return { archived: archived, errors: errors };
    }

    async function uploadPendingFilesAsChatAttachments() {
      applyPaperFigureMetadataFromInstruction(pendingExperimentFiles, getExperimentUploadContextText());
      var files = pendingExperimentFiles.slice();
      if (!files.length) return [];
      // Once the user clicks Send, the attachment belongs to that chat turn
      // rather than the composer. Hide it immediately; restore it only when
      // the attachment upload itself fails.
      detachPendingExperimentFilesForSend(files);
      var savedFiles = [];
      try {
        var formData = new FormData();
        formData.append('userId', currentUserId || 'web-user');
        formData.append('sourceMetadata', JSON.stringify(files.map(function(fileInfo) {
          return {
            originalName: String(fileInfo.originalName || fileInfo.name || ''),
            originalPath: String(fileInfo.originalPath || ''),
            lastModified: Number(fileInfo.lastModified || 0),
            inputSource: String(fileInfo.inputSource || '')
          };
        })));
        files.forEach(function(fileInfo) {
          if (fileInfo && fileInfo.file) {
            formData.append('files', fileInfo.file, fileInfo.name || fileInfo.file.name || 'attachment');
          }
        });
        var response = await fetch('/api/chat-bridge/attachments', { method: 'POST', body: formData });
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success) {
          throw new Error(result.error || ('HTTP ' + response.status));
        }
        savedFiles = Array.isArray(result.files) ? result.files : [];
      } catch (error) {
        restorePendingExperimentFilesAfterFailure(files);
        throw error;
      }
      await archiveUploadedPaperFigures(files, savedFiles, 'chat-upload');
      return savedFiles;
    }

    function isTabularExperimentFile(fileInfo) {
      var name = (fileInfo && (fileInfo.name || fileInfo.file?.name) || '').toLowerCase();
      return !!fileInfo && (fileInfo.type === 'table' || /\.(xlsx|xls|csv)$/.test(name));
    }

    function extractRequestedSheetNameFromInstruction(text) {
      var raw = String(text || '').trim();
      if (!/(sheet|worksheet|工作表)/i.test(raw)) return '';
      var patterns = [
        /(?:sheet|worksheet|工作表)[\s\S]{0,40}[：:]\s*([A-Za-z0-9_\-. \u4e00-\u9fff]+)/i,
        /(?:sheet|worksheet|工作表)(?:\s*(?:名|名称|name))?\s*(?:为|是|=|叫|使用|用)?\s*([A-Za-z0-9_\-. \u4e00-\u9fff]{2,80})/i
      ];
      for (var i = 0; i < patterns.length; i++) {
        var match = raw.match(patterns[i]);
        if (!match || !match[1]) continue;
        var candidate = match[1]
          .replace(/(?:的数据|数据|重新计算|重新算|计算|进行|来|里面|中的|这个|那个).*$/i, '')
          .replace(/[，。；;,.!?！？]+.*$/g, '')
          .trim();
        if (candidate) return candidate;
      }
      return '';
    }

    function shouldRunTabularUploadDataAnalysis(fileInfos, instructionText, workflowIntent) {
      var tableFiles = (fileInfos || []).filter(isTabularExperimentFile);
      if (!tableFiles.length) return false;
      if (workflowIntent && workflowIntent.dataAnalysis) return true;
      return /(sheet|worksheet|工作表|重新计算|重新算|计算|数据表|表格数据|excel|xlsx|xls|csv|变量|列|行)/i.test(String(instructionText || ''));
    }

    function inferDataAnalysisMethodsFromInstruction(text, intent) {
      var raw = String(text || '');
      var methods = [];
      function add(method) {
        if (methods.indexOf(method) < 0) methods.push(method);
      }
      add('descriptive');
      if (/图表建议|可视化|作图|绘图|画图|r\s*作图/i.test(raw) || intent.rPlot) add('visualization');
      if (/正态|shapiro|qq\s*图/i.test(raw)) add('normality');
      if (/方差齐性|levene|bartlett/i.test(raw)) add('variance_homogeneity');
      if (/独立.*t|t\s*检验|t检验/i.test(raw)) add('independent_t');
      if (/配对.*t/i.test(raw)) add('paired_t');
      if (/方差分析|anova|组间比较|多组/i.test(raw)) add('anova');
      if (/非参数|mann|wilcoxon|kruskal/i.test(raw)) add('nonparametric');
      if (/双因素|交互作用/i.test(raw)) add('two_way_anova');
      if (/相关|pearson|spearman/i.test(raw)) add('correlation');
      if (/回归|regression/i.test(raw)) add('regression');
      if (/卡方|chi/i.test(raw)) add('chi_square');
      if (/pca|主成分/i.test(raw)) add('pca');
      if (/聚类|cluster/i.test(raw)) add('cluster');
      if (/混合效应|随机效应|嵌套/i.test(raw)) add('mixed_effects');
      if (/生存分析|kaplan|cox/i.test(raw)) add('survival');
      return methods;
    }

    function buildAutoDataAnalysisSelections(methods, extraQuery) {
      var variables = dataAnalysisStructure && Array.isArray(dataAnalysisStructure.variables) ? dataAnalysisStructure.variables : [];
      var numeric = variables.filter(function(v) { return v.type === 'numeric'; });
      var categorical = variables.filter(function(v) { return v.type === 'categorical'; });
      var dependent = numeric[0]?.name || '';
      return {
        method: methods[0] || 'descriptive',
        methods: methods,
        extraQuery: extraQuery || '',
        numericVar: numeric[0]?.name || '',
        numericVar2: numeric[1]?.name || '',
        groupVar: categorical[0]?.name || '',
        categoryVar: categorical[0]?.name || '',
        categoryVar2: categorical[1]?.name || '',
        dependentVar: dependent,
        predictorVars: numeric.slice(1, 4).map(function(v) { return v.name; }).filter(function(name) { return name && name !== dependent; })
      };
    }

    async function runExperimentUploadDataAnalysis(file, instructionText, intent) {
      var methods = inferDataAnalysisMethodsFromInstruction(instructionText, intent);
      var requestedSheetName = extractRequestedSheetNameFromInstruction(instructionText);
      appendMessage(
        '📊 检测到数据分析/作图需求，正在按左侧“数据分析”流程读取并分析：' + file.name +
        (requestedSheetName ? '\n指定工作表：' + requestedSheetName : ''),
        'bot',
        false,
        true
      );

      var formData = new FormData();
      formData.append('file', file);
      formData.append('userId', currentUserId || 'web-user');
      formData.append('method', methods[0] || 'descriptive');
      formData.append('methods', JSON.stringify(methods));
      formData.append('numericVar', '');
      formData.append('numericVar2', '');
      formData.append('groupVar', '');
      formData.append('categoryVar', '');
      formData.append('categoryVar2', '');
      formData.append('dependentVar', '');
      formData.append('predictorVars', JSON.stringify([]));
      formData.append('extraQuery', instructionText || '');
      if (requestedSheetName) {
        formData.append('sheetName', requestedSheetName);
      }

      var response = await fetch('/api/data-analysis/analyze', {
        method: 'POST',
        body: formData,
        signal: getMainChatAbortSignal()
      });
      var result = await response.json();
      if (!result.success) {
        appendMessage('❌ 数据分析失败：' + (result.error || '未知错误'), 'bot', false, true);
        return null;
      }

      dataAnalysisStructure = result.data.dataset;
      dataAnalysisLastResult = result.data;
      var selections = buildAutoDataAnalysisSelections(result.data.methods || methods, instructionText || '');
      var inferred = inferRPlotConfigFromDataAnalysis(selections);
      dataAnalysisPlotLink = {
        file: file,
        filename: file.name,
        sheetName: result.data.dataset ? result.data.dataset.sheetName : requestedSheetName,
        structure: dataAnalysisStructure,
        selections: selections,
        chartType: inferred.chartType,
        analysisType: inferred.analysisType,
        userChartPreference: inferred.userChartPreference || null,
        significance: result.data.result ? result.data.result.significance : null,
        customRequirements: buildDataAnalysisRRequirements(selections, result.data.result ? (result.data.result.markdown || '') : '')
      };

      appendMessage(result.data.result.markdown || '数据分析完成。', 'bot', false, true);
      return result.data;
    }

    function renderRArtifactMarkdown(execData) {
      var files = execData && Array.isArray(execData.files) ? execData.files : [];
      if (!files.length) return '未检测到图表文件，请检查 R 代码是否调用了 `ggsave()` 或生成了图形对象。';
      var lines = [];
      if (execData && execData.workDir) {
        lines.push('本地文件夹：`' + execData.workDir + '`');
        lines.push('');
      }
      lines.push('R 图表文件：');
      files.forEach(function(file) {
        var label = file.relativePath || file.name || 'artifact';
        var size = file.size ? (' · ' + Math.round(file.size / 1024) + ' KB') : '';
        lines.push('- [' + label + '](' + file.url + ')' + size);
      });
      return lines.join('\n');
    }

    function renderRArtifactChatSummary(execData) {
      var imageFiles = execData && Array.isArray(execData.imageFiles) ? execData.imageFiles : [];
      var pdfFiles = execData && Array.isArray(execData.files) ? execData.files.filter(function(file) { return file && (file.kind === 'pdf' || /\.pdf$/i.test(file.name || file.relativePath || '')); }) : [];
      var supportFiles = execData && Array.isArray(execData.supportFiles)
        ? execData.supportFiles.filter(function(file) { return file && file.kind !== 'pdf' && !/\.pdf$/i.test(file.name || file.relativePath || ''); })
        : [];
      var lines = [];
      if (execData && execData.workDir) {
        lines.push('文件位置：`' + execData.workDir + '`');
      }
      if (imageFiles.length) {
        lines.push('图片文件：' + imageFiles.map(function(file) {
          return file.relativePath || file.name || 'image';
        }).join('、'));
      }
      if (pdfFiles.length) {
        lines.push('PDF 文件：' + pdfFiles.map(function(file) {
          return file.relativePath || file.name || 'PDF';
        }).join('、'));
      }
      if (supportFiles.length) {
        lines.push('附带文件：' + supportFiles.map(function(file) {
          return file.relativePath || file.name || 'artifact';
        }).join('、'));
      }
      return lines.join('\n\n') || renderRArtifactMarkdown(execData);
    }

    function renderRArtifactAttachmentCards(execData) {
      var allFiles = execData && Array.isArray(execData.files) ? execData.files : [];
      var displayFiles = [];
      var seen = new Set();
      allFiles.forEach(function(file) {
        if (!file) return;
        var key = file.relativePath || file.name || file.url || '';
        if (!key || seen.has(key)) return;
        seen.add(key);
        displayFiles.push(file);
      });
      if (!displayFiles.length) return '';
      var workDir = execData && execData.workDir ? String(execData.workDir) : '';
      var displayInfoCache = new Map();

      function getRArtifactDisplayInfo(file) {
        if (displayInfoCache.has(file)) return displayInfoCache.get(file);
        var name = file.name || file.relativePath || 'artifact';
        var relativePath = file.relativePath || name;
        var localPath = file.absolutePath || file.filePath || (workDir ? joinLocalRPath(workDir, relativePath) : '');
        var previewUrl = getOutputAttachmentPreviewUrl(file.url || localPath);
        var ext = getOutputAttachmentExtension(name).toUpperCase() || 'FILE';
        var kind = file.kind || getOutputAttachmentKind(name);
        var filePathForOpen = localPath || file.url || previewUrl;
        var info = {
          name: name,
          relativePath: relativePath,
          localPath: localPath,
          previewUrl: previewUrl,
          ext: ext,
          kind: kind,
          isImage: kind === 'image',
          filePathForOpen: filePathForOpen
        };
        displayInfoCache.set(file, info);
        return info;
      }

      function renderRArtifactFileCard(file) {
        var info = getRArtifactDisplayInfo(file);
        var name = info.name;
        var relativePath = info.relativePath;
        var localPath = info.localPath;
        var previewUrl = info.previewUrl;
        var ext = info.ext;
        var kind = info.kind;
        var isImage = info.isImage;
        var filePathForOpen = info.filePathForOpen;
        var metaLabel = getOutputAttachmentKindLabel(kind);
        var previewHtml = isImage
          ? '<button type="button" class="output-attachment-preview" data-file-path="' + escapeHtml(localPath || previewUrl) + '" data-preview-url="' + escapeHtml(previewUrl) + '" data-file-name="' + escapeHtml(name) + '" data-file-kind="image" data-workspace-root="' + escapeHtml(workDir) + '" onclick="previewOutputAttachment(this)" title="在软件内查看图片" aria-label="在软件内查看图片">' +
              '<img src="' + escapeHtml(previewUrl) + '" alt="' + escapeHtml(name) + '" loading="lazy" decoding="async" onerror="handleOutputAttachmentPreviewError(this)">' +
            '</button>'
          : '';
        var draftFigurePayload = isImage && execData && execData.jobId && relativePath
          ? encodeURIComponent(JSON.stringify({
              fileName: name,
              source: {
                kind: 'r-code',
                jobId: execData.jobId,
                relativePath: relativePath,
                url: file.url || ''
              }
            }))
          : '';
        var iconButtonHtml = '<button type="button" class="output-attachment-icon output-attachment-icon-button" data-file-path="' + escapeHtml(filePathForOpen) + '" data-preview-url="' + escapeHtml(previewUrl) + '" data-file-name="' + escapeHtml(name) + '" data-file-kind="' + escapeHtml(kind) + '" onclick="openOutputAttachmentFile(this)" title="打开文件" aria-label="打开文件">' + outputAttachmentIcon(kind, name) + '</button>';
        var infoHtml = isImage
          ? '<span class="output-attachment-info">' +
              '<span class="output-attachment-title-row">' +
                iconButtonHtml +
                '<span class="output-attachment-text-stack">' +
                  '<span class="output-attachment-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span>' +
                  '<span class="output-attachment-meta">' + escapeHtml(metaLabel) + ' · ' + escapeHtml(ext) + '</span>' +
                '</span>' +
              '</span>' +
            '</span>'
          : iconButtonHtml +
            '<span class="output-attachment-info">' +
              '<span class="output-attachment-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span>' +
              '<span class="output-attachment-meta">' + escapeHtml(metaLabel) + ' · ' + escapeHtml(ext) + '</span>' +
            '</span>';
        var saveToDraftHtml = draftFigurePayload
          ? '<button type="button" class="output-attachment-open" data-draft-figure="' + escapeHtml(draftFigurePayload) + '" onclick="openSaveRFigureToDraftDialog(this)">保存到章节</button>'
          : '';
        return '' +
          '<div class="output-attachment-card output-attachment-card-clickable' + (isImage ? ' output-attachment-card-combined' : '') + '" data-file-path="' + escapeHtml(filePathForOpen) + '" data-preview-url="' + escapeHtml(previewUrl) + '" data-file-name="' + escapeHtml(name) + '" data-file-kind="' + escapeHtml(kind) + '" data-workspace-root="' + escapeHtml(workDir) + '" onclick="openOutputAttachmentCardInSidebar(this,event)">' +
            previewHtml +
            infoHtml +
            '<button type="button" class="output-attachment-open" data-file-path="' + escapeHtml(filePathForOpen) + '" data-preview-url="' + escapeHtml(previewUrl) + '" onclick="openOutputAttachmentFile(this)">打开文件</button>' +
            saveToDraftHtml +
            (localPath ? '<button type="button" class="output-attachment-open" data-file-path="' + escapeHtml(localPath) + '" data-preview-url="' + escapeHtml(previewUrl) + '" onclick="openOutputAttachmentFolder(this)">打开所在文件夹</button>' : '') +
          '</div>';
      }

      var imageFiles = displayFiles.filter(function(file) {
        return getRArtifactDisplayInfo(file).isImage;
      });
      if (imageFiles.length <= 3) {
        return '<div class="output-attachments">' + displayFiles.map(renderRArtifactFileCard).join('') + '</div>';
      }

      var nonImageFiles = displayFiles.filter(function(file) {
        return !getRArtifactDisplayInfo(file).isImage;
      });
      var imagePaths = imageFiles.map(function(file) {
        return getRArtifactDisplayInfo(file).filePathForOpen;
      }).filter(Boolean);
      return '<div class="output-attachments">' +
        renderOutputImageCollection(imagePaths, workDir) +
        nonImageFiles.map(renderRArtifactFileCard).join('') +
        '<details class="output-attachment-overflow">' +
          '<summary><span>图片文件操作 ' + imageFiles.length + ' 项</span><span class="output-attachment-overflow-state" aria-hidden="true"></span></summary>' +
          '<div class="output-attachment-overflow-list">' + imageFiles.map(renderRArtifactFileCard).join('') + '</div>' +
        '</details>' +
      '</div>';
    }

    var pendingDraftFigurePayload = null;

    function inferFigureLabelFromFileName(fileName) {
      var text = String(fileName || '');
      var match = text.match(/(?:figure|fig\.?|图)\s*[-_ ]*(\d+[a-z]?)/i);
      if (match && match[1]) return 'Figure ' + match[1].toUpperCase();
      return 'Figure';
    }

    window.openSaveRFigureToDraftDialog = function(button) {
      try {
        var encoded = button ? button.getAttribute('data-draft-figure') || '' : '';
        pendingDraftFigurePayload = JSON.parse(decodeURIComponent(encoded));
      } catch (error) {
        appendMessage('❌ 图件信息解析失败：' + (error.message || error), 'bot', false, true);
        return;
      }

      var fileName = pendingDraftFigurePayload.fileName || 'figure';
      var suggestedLabel = inferFigureLabelFromFileName(fileName);
      var html =
        '<div style="display:grid;gap:10px;font-size:12px;color:var(--text-primary);">' +
          '<div style="padding:8px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-tip-bg);color:var(--text-secondary);word-break:break-all;">' +
            '图件：' + escapeHtml(fileName) +
          '</div>' +
          '<label>章节' +
            '<select id="draftFigureChapter" style="width:100%;margin-top:4px;padding:7px;border:1px solid var(--border-color);border-radius:5px;background:var(--modal-input-bg);color:var(--text-primary);">' +
              '<option value="results">Results</option>' +
              '<option value="discussion">Discussion</option>' +
              '<option value="methods">Methods</option>' +
              '<option value="introduction">Introduction</option>' +
              '<option value="abstract">Abstract</option>' +
              '<option value="conclusion">Conclusion</option>' +
              '<option value="custom">自定义章节</option>' +
            '</select>' +
          '</label>' +
          '<label>自定义章节名（选择“自定义章节”时填写）' +
            '<input id="draftFigureCustomChapter" type="text" placeholder="例如 Results / 第三章 结果" style="width:100%;margin-top:4px;padding:7px;border:1px solid var(--border-color);border-radius:5px;background:var(--modal-input-bg);color:var(--text-primary);">' +
          '</label>' +
          '<div style="display:grid;grid-template-columns:1fr 1.4fr;gap:8px;">' +
            '<label>小节编号' +
              '<input id="draftFigureSubsectionId" type="text" placeholder="3.2" style="width:100%;margin-top:4px;padding:7px;border:1px solid var(--border-color);border-radius:5px;background:var(--modal-input-bg);color:var(--text-primary);">' +
            '</label>' +
            '<label>小节标题' +
              '<input id="draftFigureSubsectionTitle" type="text" placeholder="Treatment effects on N2O flux" style="width:100%;margin-top:4px;padding:7px;border:1px solid var(--border-color);border-radius:5px;background:var(--modal-input-bg);color:var(--text-primary);">' +
            '</label>' +
          '</div>' +
          '<label>图号' +
            '<input id="draftFigureLabel" type="text" value="' + escapeHtml(suggestedLabel) + '" placeholder="Figure 3" style="width:100%;margin-top:4px;padding:7px;border:1px solid var(--border-color);border-radius:5px;background:var(--modal-input-bg);color:var(--text-primary);">' +
          '</label>' +
          '<label>图注' +
            '<textarea id="draftFigureCaption" placeholder="写入论文草稿的图注" style="width:100%;height:86px;margin-top:4px;padding:7px;border:1px solid var(--border-color);border-radius:5px;background:var(--modal-input-bg);color:var(--text-primary);resize:vertical;"></textarea>' +
          '</label>' +
          '<div id="draftFigureSaveStatus" style="display:none;padding:8px;border-radius:6px;"></div>' +
          '<div class="btns" style="margin-top:4px;">' +
            '<button class="cancel" onclick="closeModal()">取消</button>' +
            '<button class="ok" onclick="savePendingRFigureToDraft()">保存到章节</button>' +
          '</div>' +
        '</div>';
      showModal('保存图件到章节', html, false);
    };

    window.savePendingRFigureToDraft = async function() {
      if (!pendingDraftFigurePayload) return;
      var status = document.getElementById('draftFigureSaveStatus');
      var chapterSelect = document.getElementById('draftFigureChapter');
      var customChapter = document.getElementById('draftFigureCustomChapter');
      var chapterValue = chapterSelect ? chapterSelect.value : 'results';
      var chapterName = chapterValue === 'custom'
        ? (customChapter ? customChapter.value.trim() : '')
        : chapterValue;
      var subsectionId = document.getElementById('draftFigureSubsectionId')?.value.trim() || '';
      var subsectionTitle = document.getElementById('draftFigureSubsectionTitle')?.value.trim() || '';
      var figureLabel = document.getElementById('draftFigureLabel')?.value.trim() || 'Figure';
      var caption = document.getElementById('draftFigureCaption')?.value.trim() || figureLabel;

      if (!chapterName) {
        if (status) {
          status.style.display = 'block';
          status.style.background = 'rgba(220,38,38,0.15)';
          status.textContent = '请填写章节名';
        }
        return;
      }

      if (status) {
        status.style.display = 'block';
        status.style.background = 'rgba(255,193,7,0.15)';
        status.textContent = '正在保存图件并写入草稿...';
      }

      try {
        var response = await fetch('/api/draft-assets/figures', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId || 'web-user',
            chapterName: chapterName,
            subsectionId: subsectionId,
            subsectionTitle: subsectionTitle,
            figureLabel: figureLabel,
            caption: caption,
            source: pendingDraftFigurePayload.source
          })
        });
        var result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '保存失败');
        if (typeof invalidateArticleDraftProgressCache === 'function') invalidateArticleDraftProgressCache();
        var asset = result.asset || {};
        closeModal();
        appendMessage(
          '✅ 已保存 ' + (asset.figureLabel || figureLabel) + ' 到草稿章节：' + (asset.chapterName || chapterName) +
          (asset.subsectionTitle || asset.subsectionId ? ' / ' + [asset.subsectionId, asset.subsectionTitle].filter(Boolean).join(' ') : '') +
          '\n\n图片已复制到：' + (asset.relativePath || asset.filePath || ''),
          'bot',
          false,
          true
        );
      } catch (error) {
        if (status) {
          status.style.display = 'block';
          status.style.background = 'rgba(220,38,38,0.15)';
          status.textContent = '保存失败：' + (error.message || error);
        }
      }
    };

    function renderRArtifactHtml(execData) {
      var files = execData && Array.isArray(execData.files) ? execData.files : [];
      if (!files.length) return '未检测到图表文件，请检查 R 代码是否调用了 ggsave() 或生成了图形对象。';
      var folderHtml = execData && execData.workDir
        ? '<div style="margin-top:6px;font-size:12px;color:var(--text-secondary);">本地文件夹：<code>' + escapeHtml(execData.workDir) + '</code></div>'
        : '';
      return folderHtml + '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">' + files.map(function(file) {
        var label = file.relativePath || file.name || 'artifact';
        return '<a href="' + escapeHtml(file.url || '#') + '" target="_blank" style="padding:4px 7px;border:1px solid var(--border-color);border-radius:6px;color:var(--accent-color);text-decoration:none;background:var(--modal-bg);">' + escapeHtml(label) + '</a>';
      }).join('') + '</div>';
    }

    function buildRExecutionFailureHint(message) {
      var text = message || 'R 执行失败';
      if (/未检测到 Rscript|R 已启动，但缺少脚本依赖包/i.test(text)) {
        return text;
      }
      if (/Rscript|ENOENT|未找到 R/i.test(text)) {
        return text + '\n\n未检测到 Rscript。请打开“配置中心 → 本地插件”，自动检测或粘贴 Rscript.exe 完整路径；也可以在这里一键安装 R 插件。';
      }
      if (/Missing R packages|there is no package|找不到.*包|没有.*程序包/i.test(text)) {
        var missingPackages = [];
        text.replace(/there is no package called ['"]([^'"]+)['"]/gi, function(match, pkg) {
          if (pkg && missingPackages.indexOf(pkg) < 0) missingPackages.push(pkg);
          return match;
        });
        text.replace(/Missing R packages?(?: after auto-install)?:\s*([^\r\n]+)/gi, function(match, pkgList) {
          String(pkgList || '').split(/[,，\s]+/).forEach(function(pkg) {
            pkg = pkg.trim();
            if (/^[A-Za-z][A-Za-z0-9._]*$/.test(pkg) && missingPackages.indexOf(pkg) < 0) missingPackages.push(pkg);
          });
          return match;
        });
        text.replace(/Scholar Harness installing missing R packages:\s*([^\r\n]+)/gi, function(match, pkgList) {
          String(pkgList || '').split(/[,，\s]+/).forEach(function(pkg) {
            pkg = pkg.trim();
            if (/^[A-Za-z][A-Za-z0-9._]*$/.test(pkg) && missingPackages.indexOf(pkg) < 0) missingPackages.push(pkg);
          });
          return match;
        });
        var installHint = missingPackages.length
          ? '缺少的 R 包：' + missingPackages.join(', ') + '。\n可在 R 中运行：install.packages(c(' + missingPackages.map(function(pkg) { return '"' + pkg + '"'; }).join(', ') + '))'
          : 'R 已启动，但缺少脚本依赖包。';
        return text + '\n\n' + installHint + '\n也可以打开“R语言作图”窗口点击“一键安装R插件”补齐常用包。';
      }
      return text;
    }

    function extractMissingRPackagesFromMessage(message) {
      var text = String(message || '');
      var missingPackages = [];
      function addPackage(pkg) {
        pkg = String(pkg || '').trim();
        if (/^[A-Za-z][A-Za-z0-9._]*$/.test(pkg) && missingPackages.indexOf(pkg) < 0) {
          missingPackages.push(pkg);
        }
      }
      text.replace(/there is no package called ['"]([^'"]+)['"]/gi, function(match, pkg) {
        addPackage(pkg);
        return match;
      });
      text.replace(/Missing R packages?(?: after auto-install)?:\s*([^\r\n]+)/gi, function(match, pkgList) {
        String(pkgList || '').split(/[,，\s]+/).forEach(addPackage);
        return match;
      });
      text.replace(/Scholar Harness installing missing R packages:\s*([^\r\n]+)/gi, function(match, pkgList) {
        String(pkgList || '').split(/[,，\s]+/).forEach(addPackage);
        return match;
      });
      return missingPackages;
    }

    function isRepairableOptionalRPackageMissing(message) {
      var optionalPackages = [
        'multcompView', 'agricolae', 'emmeans', 'ggpubr', 'ggsignif',
        'rstatix', 'multcomp', 'PMCMRplus', 'car', 'lme4', 'lmerTest'
      ];
      var missingPackages = extractMissingRPackagesFromMessage(message);
      return missingPackages.length > 0 && missingPackages.every(function(pkg) {
        return optionalPackages.indexOf(pkg) >= 0;
      });
    }

    function sanitizeGeneratedRCode(rawCode) {
      var text = String(rawCode || '').trim();
      if (!text) return '';
      var codeBlocks = Array.prototype.slice.call(text.matchAll(/```(?:r|R|rscript|Rscript)?\s*([\s\S]*?)```/g));
      if (codeBlocks.length) {
        var preferredBlock = codeBlocks.find(function(match) {
          return /\b(?:library|ggplot|geom_|ggsave|safe_ggsave|read_excel|read\.csv|read_csv)\b|<-/.test(match[1] || '');
        });
        text = String((preferredBlock || codeBlocks[0])[1] || '').trim();
      }
      var lines = text.split(/\r?\n/);
      var firstCodeLine = -1;
      for (var i = 0; i < lines.length; i++) {
        var line = String(lines[i] || '').trim();
        if (/^(#|library\s*\(|require\s*\(|requireNamespace\s*\(|suppressPackageStartupMessages\s*\(|options\s*\(|setwd\s*\(|dir\.create\s*\(|read_|write_|ggplot\s*\(|[A-Za-z.][A-Za-z0-9._]*\s*(<-|=|\())/.test(line)) {
          firstCodeLine = i;
          break;
        }
      }
      if (firstCodeLine > 0) {
        text = lines.slice(firstCodeLine).join('\n').trim();
      }
      return text;
    }

    function aiResponseContainsRPlotCode(rawText) {
      var text = String(rawText || '');
      return /\b(?:library\s*\(|ggplot\s*\(|geom_[A-Za-z0-9_]+\s*\(|ggsave\s*\(|safe_ggsave\s*\(|read_excel\s*\(|read\.csv\s*\(|read_csv\s*\()/i.test(text);
    }

    function hasExecutableRPlotCode(rawCode) {
      var code = String(rawCode || '');
      return /\b(?:ggplot\s*\(|geom_[A-Za-z0-9_]+\s*\()/i.test(code)
        && /\b(?:ggsave\s*\(|safe_ggsave\s*\(|pdf\s*\(|png\s*\()/i.test(code);
    }

    function hasRunnableRScriptFormatting(rawCode) {
      var code = String(rawCode || '');
      var lineCount = code.split(/\r?\n/).filter(function(line) { return String(line || '').trim(); }).length;
      var semicolonCount = (code.match(/;/g) || []).length;
      return lineCount >= 5 || semicolonCount >= 5;
    }

    async function maybeExecuteRCodeFromAiResponse(aiResponse, userMessage) {
      var context = loadRecentRPlotContext();
      if (!context || !context.available) return false;
      if (!aiResponseContainsRPlotCode(aiResponse)) return false;
      if (/连接失败|请求失败|Error:/i.test(String(aiResponse || ''))) return false;

      var runtimeFile = recentRPlotRuntimeContext && recentRPlotRuntimeContext.file ? recentRPlotRuntimeContext.file : null;
      var sourceDataFilePath = runtimeFile ? '' : inferRecentRPlotDataFilePath(context);
      var dataFilename = context.dataFilename || (runtimeFile ? runtimeFile.name : '') || context.originalFilename || 'data.xlsx';
      var cleanRCode = sanitizeGeneratedRCode(aiResponse);

      if (cleanRCode && hasExecutableRPlotCode(cleanRCode) && hasRunnableRScriptFormatting(cleanRCode)) {
        appendMessage('检测到 AI 回复中包含 R 作图代码，正在自动调用 R 插件出图...', 'bot', false, true);
        var savedCodePath = await saveRCodeToDesktop(cleanRCode, dataFilename);
        await executeGeneratedRPlot({
          rCode: cleanRCode,
          file: runtimeFile,
          sourceDataFilePath: sourceDataFilePath,
          dataFilename: dataFilename,
          originalFilename: context.originalFilename || dataFilename,
          codePath: savedCodePath || getRecentRPlotCodePath(context) || '',
          instruction: userMessage || '',
          chartType: context.chartType || 'boxplot',
          analysisType: context.analysisType || 'comparison',
          themeId: context.themeId || 'paper_clean',
          themeCode: context.themeCode || '',
          label: 'AI 回复中的 R 图表'
        });
        return true;
      }

      appendMessage('检测到 AI 回复里写了 R 作图代码，但代码格式不够干净；正在按你的原始要求重新调用 R 插件出图...', 'bot', false, true);
      await runRecentRPlotFollowup(userMessage || '根据上一张图继续修改并出图', { intent: 'r_plot_modify', confidence: 0.74, reason: 'AI 回复包含 R 作图代码但未自动执行', source: 'post_response' }, { skipUserEcho: true });
      return true;
    }

    function shouldAutoRepairRExecutionFailure(message) {
      var text = String(message || '');
      if (!text) return false;
      if (isRepairableOptionalRPackageMissing(text)) return true;
      if (/未检测到\s*Rscript|Rscript\s*不(?:可用|存在)|请安装\s*R|R\s*执行超时|Missing R packages after auto-install|there is no package called|AI API|请配置 API/i.test(text)) {
        return false;
      }
      return /R\s*执行失败|Execution halted|Error in|charToDate|unused argument|object .* not found|could not find function|Insufficient values|node stack overflow|evaluation nested too deeply|non-numeric|invalid|找不到|不存在|错误|图像质量检查失败|疑似空白|空白图|有效绘图内容过少|没有生成.*图片/i.test(text);
    }

    function resolveRThemeForAutoRepair(options) {
      var themeId = (options && options.themeId) || 'paper_clean';
      var themeCode = options && typeof options.themeCode === 'string' ? options.themeCode : '';
      if (!themeCode && Array.isArray(R_THEMES)) {
        var selectedTheme = R_THEMES.find(function(theme) { return theme.id === themeId; });
        themeCode = selectedTheme ? selectedTheme.code : '';
      }
      return { themeId: themeId, themeCode: themeCode };
    }

    function buildRExecutionAutoRepairRequirements(options, failureMessage, partialData, attempt) {
      var logs = partialData
        ? [partialData.stderr || '', partialData.stdout || ''].filter(Boolean).join('\n\n')
        : '';
      var files = partialData && Array.isArray(partialData.files)
        ? partialData.files.map(function(file) {
            return '- ' + (file.relativePath || file.name || 'artifact') + (file.kind ? ' (' + file.kind + ')' : '');
          }).join('\n')
        : '无';
      return [
        '自动纠错闭环第 ' + attempt + ' 次：上一版 R 代码已经在本机 Rscript 中执行失败。请根据错误日志重写完整、可直接运行的 R 代码。',
        '不要解释原因，不要输出调试说明；只输出一个完整 R 代码块。',
        '必须修复导致 Rscript 退出码非 0 的根因，不能只用 try() 把错误吞掉。',
        '最终脚本必须完整执行到最后，并保存且只保留 1 个 PNG 和 1 个 PDF 主图；不要生成 Rplots.pdf、last_plot.png、last_plot.pdf 或其他冗余图件。',
        '如果错误涉及日期、月份、年份、Excel 日期序列、factor/character 日期，请使用稳健解析逻辑，兼容 Excel 数字日期和常见字符日期格式，禁止裸 as.Date() 直接解析未知字符/因子。',
        '如果错误涉及缺少 multcompView、agricolae、emmeans、ggpubr、ggsignif、rstatix 等可选 R 包，必须移除这些 library()/require()/pkg:: 调用，改用 base R + ggplot2/readxl/dplyr/tidyr/scales 可运行方案；如果因此无法可靠计算 abc/显著性字母，就不要标注字母，并在代码注释说明。',
        '如果错误出现在 safe_ggsave()/ggsave()，请检查 plot 对象、图层数据和坐标轴类型，确保保存 PDF 与 PNG 都能成功。',
        '如果错误提示图像质量检查失败、疑似空白或有效绘图内容过少，请重点检查作图数据是否被过滤为空、列名映射是否错位、日期/分组/y 值是否全 NA、坐标轴 limits 是否把数据裁掉、以及 geom 图层是否使用了正确的数据对象；必须修复为空的根因，不要保存只有坐标轴和标题的空白图。',
        '原始数据文件名：' + (options && (options.dataFilename || options.originalFilename) || 'data.xlsx'),
        '图表类型：' + (options && options.chartType || '未指定'),
        '分析类型：' + (options && options.analysisType || '未指定'),
        '用户原始要求：' + (options && options.instruction || '无'),
        'R 执行错误：\n' + String(failureMessage || '').slice(0, 4000),
        '已生成的部分文件：\n' + files,
        logs ? ('R stdout/stderr 尾部日志：\n' + logs.slice(-8000)) : ''
      ].filter(Boolean).join('\n\n');
    }

    async function repairRCodeAfterExecutionFailure(options, currentRCode, failureMessage, partialData, attempt) {
      loadApiConfig();
      if (!apiConfig.url || !apiConfig.key) {
        throw new Error('无法自动修复：未配置小牛马文本 API。');
      }
      var theme = resolveRThemeForAutoRepair(options || {});
      var formData = new FormData();
      formData.append('userId', currentUserId || 'web-user');
      formData.append('apiUrl', apiConfig.url);
      formData.append('apiKey', apiConfig.key);
      formData.append('model', currentModel || apiConfig.model || 'qwen3.5-plus');
      if (options && options.codePath) formData.append('codePath', options.codePath);
      formData.append('existingCode', currentRCode);
      formData.append('customRequirements', appendRPlotTreatmentColorRequirements(buildRExecutionAutoRepairRequirements(options || {}, failureMessage, partialData, attempt)));
      formData.append('dataFilename', options && (options.dataFilename || options.originalFilename) || 'data.xlsx');
      formData.append('themeCode', theme.themeCode || '');
      formData.append('themeId', theme.themeId || 'paper_clean');
      formData.append('treatmentPaletteConfig', getRPlotTreatmentPaletteConfigJson());

      var response = await fetch('/api/r-code/debug', { method: 'POST', body: formData });
      var result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'AI 自动修复 R 代码失败');
      }
      var repairedCode = sanitizeGeneratedRCode(result.data && result.data.rCode ? result.data.rCode : '');
      if (!repairedCode || !hasRunnableRScriptFormatting(repairedCode)) {
        throw new Error('AI 自动修复后没有返回可执行的完整 R 代码');
      }
      return repairedCode;
    }

    async function executeGeneratedRPlot(options) {
      var rCode = sanitizeGeneratedRCode(options && options.rCode ? options.rCode : '');
      if (!rCode) return null;
      if (options) options.rCode = rCode;
      var resultDiv = options.resultDiv || null;
      var label = options.label || 'R 图表';
      if (resultDiv) {
        resultDiv.style.display = 'block';
        resultDiv.style.background = 'rgba(255,193,7,0.15)';
        resultDiv.textContent = 'R 代码已生成，正在本机 R 插件中出图...';
      }
      if (options && typeof options.onStatus === 'function') {
        options.onStatus('R 代码已生成，正在本机 R 插件中出图...');
      }

      var formData = new FormData();
      formData.append('userId', currentUserId || 'web-user');
      formData.append('rCode', rCode);
      formData.append('filename', (options.originalFilename || 'r-plot').replace(/\.[^.]+$/, '') + '.R');
      formData.append('timeoutMs', '180000');
      if (options.workspaceDirectory) {
        formData.append('workspaceDirectory', JSON.stringify(options.workspaceDirectory));
      }
      if (options.workspaceOutputType) {
        formData.append('workspaceOutputType', String(options.workspaceOutputType));
      }
      if (options.workspaceOutputId) {
        formData.append('workspaceOutputId', String(options.workspaceOutputId));
      }
      if (options.file) {
        formData.append('file', options.file);
        formData.append('dataFilename', options.dataFilename || options.file.name);
      } else if (options.sourceDataFilePath) {
        formData.append('sourceDataFilePath', options.sourceDataFilePath);
        formData.append('dataFilename', options.dataFilename || options.originalFilename || 'data.xlsx');
      } else if (options.dataFilename) {
        formData.append('dataFilename', options.dataFilename);
      }

      try {
        var response = await fetch('/api/r-code/execute', { method: 'POST', body: formData });
        var payload = await response.json();
        if (!response.ok || !payload.success) {
          var details = payload && payload.data
            ? ((payload.data.stderr || payload.data.stdout || '').trim())
            : '';
          var executionError = new Error(buildRExecutionFailureHint((payload.error || '自动出图失败') + (details ? '：' + details.slice(0, 800) : '')));
          executionError.partialData = payload && payload.data ? payload.data : null;
          throw executionError;
        }
        var markdown = renderRArtifactMarkdown(payload.data);
        if (resultDiv) {
          resultDiv.style.background = 'rgba(16,163,127,0.15)';
          resultDiv.innerHTML = 'R 图表已生成：' + renderRArtifactHtml(payload.data);
        }
        if (options && typeof options.onSuccess === 'function') {
          options.onSuccess(payload.data, markdown);
        }
        rememberRecentRPlotContext(options || {}, payload.data, markdown);
        if (!options || !options.suppressChatMessage) {
          var chatMarkdown = renderRArtifactChatSummary(payload.data);
          var artifactHtml = formatMessage('## ✅ ' + label + '已直接生成\n\n' + chatMarkdown, { skipOutputAttachments: true }) + renderRArtifactAttachmentCards(payload.data);
          appendMessage(artifactHtml, 'bot', true, true);
        }
        return payload.data;
      } catch (error) {
        var message = buildRExecutionFailureHint(error.message || String(error));
        var partialData = error && error.partialData ? error.partialData : null;
        var repairAttempt = Number(options && options.rRepairAttempt || 0);
        var maxRepairAttempts = Number(options && options.maxRepairAttempts !== undefined ? options.maxRepairAttempts : 2);
        if (repairAttempt < maxRepairAttempts && shouldAutoRepairRExecutionFailure(message)) {
          var nextAttempt = repairAttempt + 1;
          var repairStatus = 'R 执行失败，正在把错误返回给 AI 自动修复并重新出图（第 ' + nextAttempt + '/' + maxRepairAttempts + ' 次）...';
          if (resultDiv) {
            resultDiv.style.background = 'rgba(255,193,7,0.15)';
            resultDiv.textContent = repairStatus;
          }
          if (options && typeof options.onStatus === 'function') {
            options.onStatus(repairStatus);
          }
          if (!options || !options.suppressChatMessage) {
            appendMessage(repairStatus, 'bot', false, true);
          }
          try {
            var repairedCode = await repairRCodeAfterExecutionFailure(options || {}, rCode, message, partialData, nextAttempt);
            return await executeGeneratedRPlot(Object.assign({}, options || {}, {
              rCode: repairedCode,
              rRepairAttempt: nextAttempt,
              label: label + '（自动修复版）'
            }));
          } catch (repairError) {
            message = message + '\n\n自动修复也失败：' + (repairError.message || String(repairError));
          }
        }
        if (resultDiv) {
          resultDiv.style.background = 'rgba(220,38,38,0.15)';
          resultDiv.innerHTML = 'R 自动出图失败：' + escapeHtml(message) + (partialData ? renderRArtifactHtml(partialData) : '');
        }
        if (options && typeof options.onError === 'function') {
          options.onError(message);
        }
        if (!options || !options.suppressChatMessage) {
          if (partialData && Array.isArray(partialData.files) && partialData.files.length) {
            rememberRecentRPlotContext(options || {}, partialData, renderRArtifactMarkdown(partialData));
            var failedMarkdown = renderRArtifactChatSummary(partialData);
            var failedHtml = formatMessage('## ⚠️ R 代码已生成，但自动出图失败\n\n' + failedMarkdown + '\n\n错误：' + message, { skipOutputAttachments: true }) + renderRArtifactAttachmentCards(partialData);
            appendMessage(failedHtml, 'bot', true, true);
          } else {
            appendMessage('⚠️ R 代码已生成，但自动出图失败：' + message, 'bot', false, true);
          }
        }
        return null;
      }
    }

    async function generateExperimentUploadRPlot(file, instructionText) {
      if (!dataAnalysisPlotLink || !dataAnalysisPlotLink.file) return;
      loadApiConfig();
      if (!apiConfig.url || !apiConfig.key) {
        appendMessage('⚠️ 已完成数据分析，但 R 作图需要先在配置里填写 API。', 'bot', false, true);
        return;
      }

      appendMessage('📈 正在按左侧“R语言作图”流程生成作图代码：' + file.name, 'bot', false, true);
      var themeId = 'paper_clean';
      var selectedTheme = Array.isArray(R_THEMES) ? R_THEMES.find(function(theme) { return theme.id === themeId; }) : null;
      var userChartOverride = inferRChartTypeFromUserQuery(instructionText || '');
      var effectiveChartType = userChartOverride?.chartType || dataAnalysisPlotLink.chartType || 'boxplot';
      var effectiveAnalysisType = userChartOverride?.analysisType || dataAnalysisPlotLink.analysisType || 'comparison';
      var customRequirements = appendRPlotTreatmentColorRequirements([
        buildUserQueryPriorityRBlock(instructionText || '', userChartOverride || dataAnalysisPlotLink.userChartPreference),
        dataAnalysisPlotLink.customRequirements || instructionText || ''
      ].filter(Boolean).join('\n\n'), dataAnalysisPlotLink.selections || {});
      var formData = new FormData();
      formData.append('file', file);
      formData.append('userId', currentUserId || 'web-user');
      formData.append('apiUrl', apiConfig.url);
      formData.append('apiKey', apiConfig.key);
      formData.append('model', currentModel);
      formData.append('chartType', effectiveChartType);
      formData.append('analysisType', effectiveAnalysisType);
      formData.append('customRequirements', customRequirements);
      formData.append('workDir', '');
      formData.append('dataFilename', file.name);
      formData.append('themeCode', selectedTheme ? selectedTheme.code : '');
      formData.append('themeId', themeId);
      formData.append('treatmentPaletteConfig', getRPlotTreatmentPaletteConfigJson(dataAnalysisPlotLink.selections || {}));
      formData.append('mode', 'new');
      formData.append('linkedFromDataAnalysis', 'true');
      formData.append('analysisResult', dataAnalysisLastResult && dataAnalysisLastResult.result ? (dataAnalysisLastResult.result.markdown || '') : '');
      formData.append('analysisSelections', JSON.stringify(dataAnalysisPlotLink.selections || {}));
      formData.append('analysisSignificance', JSON.stringify(dataAnalysisPlotLink.significance || null));

      var response = await fetch('/api/r-code/generate', {
        method: 'POST',
        body: formData,
        signal: getMainChatAbortSignal()
      });
      var result = await response.json();
      if (!result.success) {
        appendMessage('❌ R 作图生成失败：' + (result.error || '未知错误'), 'bot', false, true);
        return;
      }
      appendMessage(buildRCodeChatMarkdown('## 📈 基于上传数据自动生成的 R 作图代码', '', result.data.rCode), 'bot', false, true);
      var savedCodePath = await saveRCodeToDesktop(result.data.rCode, file.name);
      await executeGeneratedRPlot({
        rCode: result.data.rCode,
        file: file,
        dataFilename: result.data.dataFilename || file.name,
        originalFilename: file.name,
        codePath: savedCodePath || '',
        instruction: instructionText || '',
        chartType: effectiveChartType || '',
        analysisType: effectiveAnalysisType || '',
        themeId: themeId,
        themeCode: selectedTheme ? selectedTheme.code : '',
        label: '基于上传数据的 R 图表'
      });
    }

    async function uploadSingleExperimentResultFile(fileInfo, uploadContextText, workflowIntent) {
      loadSecondaryVisionApiConfig();
      var formData = new FormData();
      formData.append('userId', currentUserId);
      formData.append('apiUrl', apiConfig.url);
      formData.append('apiKey', apiConfig.key);
      formData.append('model', currentModel);
      formData.append('secondaryModel', apiConfig.model || currentModel || '');
      if (secondaryVisionApiConfig.url) {
        formData.append('secondaryVisionApiUrl', secondaryVisionApiConfig.url);
      }
      if (secondaryVisionApiConfig.key) {
        formData.append('secondaryVisionApiKey', secondaryVisionApiConfig.key);
      }
      if (secondaryVisionApiConfig.model) {
        formData.append('secondaryVisionModel', secondaryVisionApiConfig.model);
      }
      formData.append('userInstruction', uploadContextText);
      formData.append('userMessage', uploadContextText);
      formData.append('extraQuery', uploadContextText);
      formData.append('workflowIntent', JSON.stringify(workflowIntent));
      formData.append('sourceFileName', String(fileInfo.originalName || fileInfo.name || fileInfo.file?.name || ''));
      formData.append('sourceFilePath', String(fileInfo.originalPath || ''));
      formData.append('inputSource', String(fileInfo.inputSource || ''));
      var figurePlan = buildExperimentFigurePlanPayload(fileInfo);
      if (figurePlan) {
        formData.append('figurePlan', JSON.stringify(figurePlan));
      }
      formData.append('files', fileInfo.file);

      var response = await fetch('/api/experiment-results/upload', {
        method: 'POST',
        body: formData,
        signal: getMainChatAbortSignal()
      });
      var result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '上传分析失败');
      }
      return result;
    }

    function combineExperimentUploadResponses(responses, userInstruction, workflowIntent) {
      var allResults = [];
      var savedFiles = [];
      responses.forEach(function(response) {
        if (Array.isArray(response.results)) {
          allResults = allResults.concat(response.results);
        }
        if (Array.isArray(response.savedFiles)) {
          savedFiles = savedFiles.concat(response.savedFiles);
        }
      });
      return {
        success: true,
        results: allResults,
        savedFiles: savedFiles,
        userInstruction: userInstruction,
        workflowIntent: JSON.stringify(workflowIntent),
        combinedSummary: combineExperimentResultSummaries(allResults)
      };
    }

    function stringifyExperimentValue(value) {
      if (value === null || value === undefined) return '';
      if (Array.isArray(value)) {
        return value.map(stringifyExperimentValue).filter(Boolean).join('；');
      }
      if (typeof value === 'object') {
        var keys = Object.keys(value).filter(function(key) {
          var text = stringifyExperimentValue(value[key]);
          return text !== '';
        });
        return keys.slice(0, 12).map(function(key) {
          return key + ': ' + stringifyExperimentValue(value[key]);
        }).join('；');
      }
      return String(value).replace(/\s+/g, ' ').trim();
    }

    function uniqueExperimentTextList(values) {
      var seen = new Set();
      var output = [];
      (values || []).forEach(function(value) {
        var text = stringifyExperimentValue(value);
        if (!text || seen.has(text)) return;
        seen.add(text);
        output.push(text);
      });
      return output;
    }

    function formatExperimentRecord(record, index) {
      record = record || {};
      var primaryParts = [];
      function add(label, value) {
        var text = stringifyExperimentValue(value);
        if (text) primaryParts.push(label + '：' + text);
      }
      var metricValue = stringifyExperimentValue(record.metric_value);
      var unit = stringifyExperimentValue(record.unit);
      add('图表', record.table_or_figure_id);
      add('任务', record.task);
      add('数据/设置', [record.dataset, record.split_or_setting].filter(Boolean));
      add('处理/模型', record.model_name || record.baseline_or_proposed);
      add('指标', record.metric_name);
      add('数值', metricValue ? (metricValue + (unit && !metricValue.endsWith(unit) ? ' ' + unit : '')) : '');
      add('比较对象', record.compared_to);
      add('变化/提升', record.improvement_value);
      add('显著性', record.significance);
      add('类型', record.result_type);

      var line = '- **记录 ' + (index + 1) + '**';
      line += primaryParts.length ? '：' + primaryParts.join('；') : '：' + stringifyExperimentValue(record);
      var evidence = stringifyExperimentValue(record.evidence_text || record.caption);
      var location = stringifyExperimentValue(record.page_or_location);
      var confidence = stringifyExperimentValue(record.confidence);
      var uncertainty = stringifyExperimentValue(record.uncertainty_note);
      if (evidence) line += '\n  - 证据：' + evidence;
      if (location || confidence || uncertainty) {
        var trace = [];
        if (location) trace.push('位置：' + location);
        if (confidence) trace.push('置信度：' + confidence);
        if (uncertainty) trace.push('不确定：' + uncertainty);
        line += '\n  - ' + trace.join('；');
      }
      return line;
    }

    function combineExperimentResultSummaries(results) {
      var combined = {
        main_findings: [],
        best_model_claims: [],
        ablation_findings: [],
        robustness_findings: [],
        efficiency_findings: [],
        uncertain_items: [],
        totalResultsCount: 0
      };
      (results || []).forEach(function(result) {
        var summary = result.overall_summary || {};
        combined.main_findings = combined.main_findings.concat(summary.main_findings || []);
        combined.best_model_claims = combined.best_model_claims.concat(summary.best_model_claims || []);
        combined.ablation_findings = combined.ablation_findings.concat(summary.ablation_findings || []);
        combined.robustness_findings = combined.robustness_findings.concat(summary.robustness_findings || []);
        combined.efficiency_findings = combined.efficiency_findings.concat(summary.efficiency_findings || []);
        combined.uncertain_items = combined.uncertain_items.concat(summary.uncertain_items || []);
        combined.totalResultsCount += (result.results || []).length;
      });
      ['main_findings', 'best_model_claims', 'ablation_findings', 'robustness_findings', 'efficiency_findings', 'uncertain_items'].forEach(function(key) {
        combined[key] = uniqueExperimentTextList(combined[key]);
      });
      return combined;
    }

    async function handleExperimentUploadFollowupWorkflows(fileInfos, instructionText) {
      var intent = inferExperimentWorkflowIntent(instructionText);
      if (!intent.needsWorkflow) return;

      var tableFile = (fileInfos || []).find(isTabularExperimentFile);
      if (!tableFile || !tableFile.file) {
        appendMessage('⚠️ 检测到数据分析/R 作图需求，但本次上传没有 CSV/XLSX/XLS 数据文件。请补充表格数据后再运行。', 'bot', false, true);
        return;
      }

      var analysisData = await runExperimentUploadDataAnalysis(tableFile.file, instructionText, intent);
      if (analysisData && intent.rPlot) {
        await generateExperimentUploadRPlot(tableFile.file, instructionText);
      }
    }

    async function runChatRPlotWorkflowFromUploads(fileInfos, instructionText, workflowIntent) {
      var tableFiles = (fileInfos || []).filter(isTabularExperimentFile);
      if (!tableFiles.length) {
        appendMessage('⚠️ 检测到 R 作图需求，但本次上传没有 CSV/XLSX/XLS 数据文件。请先上传表格数据。', 'bot', false, true);
        return;
      }
      var shouldReleaseComposerBusy = !isGenerating;
      if (shouldReleaseComposerBusy) {
        setMainChatInputBusy(true);
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.classList.add('sending');
        }
        isGenerating = true;
      }

      try {
        appendMessage(
          '📈 已从聊天输入识别到 R 作图需求，正在直接调用 R 语言插件处理 ' + tableFiles.length + ' 个数据文件。' +
          (instructionText ? '\n\n作图要求：' + instructionText : ''),
          'bot',
          false,
          true
        );

        for (var i = 0; i < tableFiles.length; i++) {
          var fileInfo = tableFiles[i];
          if (!fileInfo || !fileInfo.file) continue;
          if (tableFiles.length > 1) {
            appendMessage('📈 R 作图队列 ' + (i + 1) + '/' + tableFiles.length + '：' + fileInfo.name, 'bot', false, true);
          }
          try {
            var analysisData = await runExperimentUploadDataAnalysis(fileInfo.file, instructionText, workflowIntent);
            if (analysisData) {
              await generateExperimentUploadRPlot(fileInfo.file, instructionText);
            }
          } catch (workflowError) {
            console.error('[ExperimentUpload] Chat R plot workflow failed:', workflowError);
            appendMessage('❌ R 作图流程失败：' + (workflowError.message || String(workflowError)), 'bot', false, true);
          }
        }
      } finally {
        if (shouldReleaseComposerBusy) {
          setMainChatInputBusy(false);
          if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.classList.remove('sending', 'can-stop');
          }
          isGenerating = false;
          renderMainChatPiQueue(mainChatPiState);
        }
      }
    }
    
    // 上传并分析实验结果
    async function uploadAndAnalyzeExperimentResults() {
      var labels = getProjectUiLabels();
      if (isExperimentUploadRequestInFlight || isUploadingExperiment) {
        appendMessage('⏳ ' + labels.materialEnabledLabel + '正在排队分析，请等待当前文件完成。', 'bot', false, true);
        return;
      }
      if (pendingExperimentFiles.length === 0) {
        appendMessage('⚠️ 请先选择要上传的' + labels.materialEnabledLabel + '文件', 'bot', false, true);
        return;
      }
      isExperimentUploadRequestInFlight = true;
      var ownsComposerBusy = beginMainChatExperimentBusy(getComposerChatProvider());
      try {
        await uploadAndAnalyzeExperimentResultsCore(labels);
      } catch (error) {
        if (error && error.name === 'AbortError') {
          appendMessage('已停止当前文件上传/分析任务。', 'bot', false, true);
        } else {
          appendMessage('❌ 文件上传/分析出错：' + ((error && error.message) || String(error)), 'bot', false, true);
        }
      } finally {
        isExperimentUploadRequestInFlight = false;
        if (ownsComposerBusy) {
          endMainChatExperimentBusy();
        }
      }
    }

    async function uploadAndAnalyzeExperimentResultsCore(labels) {
      var uploadContextText = getExperimentUploadContextText();
      applyPaperFigureMetadataFromInstruction(pendingExperimentFiles, uploadContextText);
      startToolWorkflowConversation(uploadContextText || '上传实验资料并作图');
      clearExperimentUploadInput(uploadContextText);
      var workflowIntent = inferExperimentWorkflowIntent(uploadContextText);
      var filesForFollowup = pendingExperimentFiles.slice();
      var directRPlotFiles = filesForFollowup.filter(isTabularExperimentFile);
      var directDataAnalysisFiles = filesForFollowup.filter(isTabularExperimentFile);

      if (workflowIntent.rPlot && directRPlotFiles.length > 0) {
        loadApiConfig();
        if (!apiConfig.url || !apiConfig.key) {
          appendMessage('⚠️ 已识别到 R 作图需求，但生成 R 代码需要先在配置里填写小牛马文本 API。', 'bot', false, true);
          return;
        }

        clearExperimentUploadInput(uploadContextText);
        isUploadingExperiment = true;
        var directUploadBtn = document.getElementById('uploadExperimentBtn');
        if (directUploadBtn) {
          directUploadBtn.classList.add('uploading');
          directUploadBtn.title = '正在调用 R 语言插件...';
        }

        try {
          pendingExperimentFiles = filesForFollowup.filter(function(fileInfo) {
            return !isTabularExperimentFile(fileInfo);
          });
          updateUploadedFilesPreview();
          await runChatRPlotWorkflowFromUploads(directRPlotFiles, uploadContextText, workflowIntent);
          if (pendingExperimentFiles.length > 0) {
            appendMessage('📎 表格数据已完成 R 作图；其他附件仍保留在输入框，可继续发送进行资料分析。', 'bot', false, true);
          }
        } finally {
          isUploadingExperiment = false;
          if (directUploadBtn) {
            directUploadBtn.classList.remove('uploading');
            directUploadBtn.title = '上传实验资料（图片/表格/PDF/Word）';
          }
        }
        return;
      }

      if (!workflowIntent.rPlot && shouldRunTabularUploadDataAnalysis(filesForFollowup, uploadContextText, workflowIntent)) {
        clearExperimentUploadInput(uploadContextText);
        pendingExperimentFiles = filesForFollowup.filter(function(fileInfo) {
          return !isTabularExperimentFile(fileInfo);
        });
        updateUploadedFilesPreview();
        for (var dataIndex = 0; dataIndex < directDataAnalysisFiles.length; dataIndex++) {
          var dataFileInfo = directDataAnalysisFiles[dataIndex];
          if (!dataFileInfo || !dataFileInfo.file) continue;
          if (directDataAnalysisFiles.length > 1) {
            appendMessage('📊 数据分析队列 ' + (dataIndex + 1) + '/' + directDataAnalysisFiles.length + '：' + dataFileInfo.name, 'bot', false, true);
          }
          await runExperimentUploadDataAnalysis(dataFileInfo.file, uploadContextText, workflowIntent);
        }
        if (pendingExperimentFiles.length > 0) {
          appendMessage('📎 表格数据已按你的要求进入数据分析流程；其他附件仍保留在输入框，可继续发送进行资料分析。', 'bot', false, true);
        }
        return;
      }

      if (!ensureExperimentFigurePlansBeforeUpload()) {
        return;
      }

      clearExperimentUploadInput(uploadContextText);
      loadSecondaryVisionApiConfig();
      var hasTextApiConfig = !!(apiConfig.url && apiConfig.key);
      var hasVisionApiConfigForImages = !!(secondaryVisionApiConfig.url && secondaryVisionApiConfig.key);
      var allQueuedFilesAreImages = filesForFollowup.length > 0 && filesForFollowup.every(function(fileInfo) {
        return fileInfo && fileInfo.type === 'image';
      });
      
      if (!hasTextApiConfig && !(hasVisionApiConfigForImages && allQueuedFilesAreImages)) {
        var tableFileWithoutApi = filesForFollowup.find(isTabularExperimentFile);
        if (workflowIntent.dataAnalysis && !workflowIntent.rPlot && tableFileWithoutApi && tableFileWithoutApi.file) {
          pendingExperimentFiles = [];
          updateUploadedFilesPreview();
          appendMessage('📊 未配置 API，已跳过' + labels.materialEnabledLabel + ' AI 解读；正在直接按“数据分析”流程处理表格数据。', 'bot', false, true);
          try {
            await runExperimentUploadDataAnalysis(tableFileWithoutApi.file, uploadContextText, workflowIntent);
          } catch (workflowError) {
            console.error('[ExperimentUpload] Data analysis without API failed:', workflowError);
            if (workflowError && workflowError.name === 'AbortError') {
              appendMessage('已停止当前数据分析任务。', 'bot', false, true);
            } else {
              appendMessage('❌ 数据分析流程失败：' + workflowError.message, 'bot', false, true);
            }
          }
          return;
        }
        appendMessage('⚠️ 请先配置小牛马文本 API；如果只上传图片，也可以只配置小牛马视觉 API。', 'bot', false, true);
        return;
      }
      
      isUploadingExperiment = true;
      var uploadBtn = document.getElementById('uploadExperimentBtn');
      if (uploadBtn) {
        uploadBtn.classList.add('uploading');
        uploadBtn.title = '正在上传' + labels.materialEnabledLabel + '...';
      }

      var queuedFiles = filesForFollowup.slice();
      var completedFileCount = 0;
      // The files have been committed to this send action. Remove their chips
      // and image-planning panel before the long analysis starts. Files added
      // by the user during processing remain untouched.
      detachPendingExperimentFilesForSend(queuedFiles);
      
      appendMessage(
        '📤 正在上传 ' + queuedFiles.length + ' 个' + labels.materialEnabledLabel + '文件进行分析...' +
        (uploadContextText ? '\n\n随文件提交的要求：' + uploadContextText : ''),
        'bot',
        false,
        true
      );
      
      try {
        var responses = [];
        for (var i = 0; i < queuedFiles.length; i++) {
          var fileInfo = queuedFiles[i];
          appendMessage(
            '📤 队列分析 ' + (i + 1) + '/' + queuedFiles.length + '：' + fileInfo.name,
            'bot',
            false,
            true
          );
          var singleResult = await uploadSingleExperimentResultFile(fileInfo, uploadContextText, workflowIntent);
          responses.push(singleResult);
          completedFileCount = i + 1;
        }

        var result = combineExperimentUploadResponses(responses, uploadContextText, workflowIntent);

        if (result.success) {
          var paperFigureArchive = await archiveUploadedPaperFigures(queuedFiles, result.savedFiles, 'experiment-results');

          // 显示分析结果
          displayExperimentAnalysisResults(result);
          if (paperFigureArchive.archived.length) {
            appendMessage('已保存 ' + paperFigureArchive.archived.length + ' 张图片到右侧“论文图片”，并按填写的图号、标题和图注归档。', 'bot', false, true);
          }
          if (paperFigureArchive.errors.length) {
            appendMessage('⚠️ 部分论文图片归档失败：\n' + paperFigureArchive.errors.join('\n'), 'bot', false, true);
          }
          try {
            await handleExperimentUploadFollowupWorkflows(filesForFollowup, uploadContextText);
          } catch (workflowError) {
            console.error('[ExperimentUpload] Follow-up workflow error:', workflowError);
            appendMessage('⚠️ ' + labels.materialEnabledLabel + '文件已上传，但后续数据分析/R 作图流程失败：' + workflowError.message, 'bot', false, true);
          }
        } else {
          restorePendingExperimentFilesAfterFailure(queuedFiles.slice(completedFileCount));
          appendMessage('❌ 上传失败：' + (result.error || '未知错误'), 'bot', false, true);
        }
        
      } catch (error) {
        restorePendingExperimentFilesAfterFailure(queuedFiles.slice(completedFileCount));
        console.error('[ExperimentUpload] Upload error:', error);
        if (error && error.name === 'AbortError') {
          appendMessage('已停止当前文件上传/分析任务。', 'bot', false, true);
        } else {
          appendMessage('❌ 上传出错：' + error.message, 'bot', false, true);
        }
      } finally {
        isUploadingExperiment = false;
        if (uploadBtn) {
          uploadBtn.classList.remove('uploading');
          uploadBtn.title = labels.uploadMaterial + '（图片/表格/PDF/Word）';
        }
      }
    }
    
    // 显示上传材料分析结果
    function displayExperimentAnalysisResults(result) {
      var labels = getProjectUiLabels();
      var messageText = '✅ ' + labels.materialEnabledLabel + '分析完成！\n\n';
      
      if (result.results && result.results.length > 0) {
        messageText += '**共处理 ' + result.results.length + ' 个文件：**\n';
        
        for (var i = 0; i < result.results.length; i++) {
          var fileResult = result.results[i];
          messageText += '\n### ' + (i + 1) + '. ' + fileResult.fileName + ' (' + fileResult.fileType + ')\n';

          if (fileResult.figurePlan && (fileResult.figurePlan.figureName || fileResult.figurePlan.panelLabel || fileResult.figurePlan.caption)) {
            var figurePlanParts = [];
            var figureLabel = formatExperimentFigureLabel(fileResult.figurePlan.figureName, fileResult.figurePlan.panelLabel);
            if (figureLabel) figurePlanParts.push(figureLabel);
            if (fileResult.figurePlan.caption) figurePlanParts.push('：' + fileResult.figurePlan.caption);
            messageText += '**图片规划**: ' + figurePlanParts.join('') + '\n';
          }
          
          if (fileResult.paper_title) {
            messageText += '**来源标题**: ' + fileResult.paper_title + '\n';
          }
          
          if (fileResult.results && fileResult.results.length > 0) {
            messageText += '**提取结果**: ' + fileResult.results.length + ' 条记录\n';
            var visibleRecordCount = Math.min(20, fileResult.results.length);
            for (var j = 0; j < visibleRecordCount; j++) {
              messageText += formatExperimentRecord(fileResult.results[j], j) + '\n';
            }
            if (fileResult.results.length > visibleRecordCount) {
              messageText += '- 其余 ' + (fileResult.results.length - visibleRecordCount) + ' 条已写入长期记忆，可继续让我按章节调用。\n';
            }
          }
          
          if (fileResult.error) {
            messageText += '**错误**: ' + stringifyExperimentValue(fileResult.error) + '\n';
          }
          
          if (fileResult.overall_summary && fileResult.overall_summary.uncertain_items && fileResult.overall_summary.uncertain_items.length > 0) {
            messageText += '**不确定项**: ' + uniqueExperimentTextList(fileResult.overall_summary.uncertain_items).join('; ') + '\n';
          }
        }
      }
      
      // 显示合并总结
      if (result.combinedSummary) {
        messageText += '\n---\n\n## 📊 整体总结\n\n';
        
        if (result.combinedSummary.main_findings && result.combinedSummary.main_findings.length > 0) {
          messageText += '**主要发现**:\n';
          for (var k = 0; k < result.combinedSummary.main_findings.length; k++) {
            messageText += '- ' + stringifyExperimentValue(result.combinedSummary.main_findings[k]) + '\n';
          }
        }
        
        if (result.combinedSummary.totalResultsCount) {
          messageText += '\n**总计提取 ' + result.combinedSummary.totalResultsCount + ' 条结构化结果**\n';
        }
      }
      
      if (result.userInstruction) {
        messageText += '\n**随文件提交的要求**：' + result.userInstruction + '\n';
      }
      messageText += '\n💡 您可以要求我根据这些材料继续撰写对应章节；如果上传的是 CSV/XLSX/XLS，也可以直接要求数据分析或 R 作图。';
      
      appendMessage(messageText, 'bot', false, true);
    }
    
    // 页面加载完成后初始化
    initExperimentUpload();
    initMainDragUpload();
    
    // ============ 实验结果上传功能结束 ============

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('experiment-composer', { source: '/app/experiment-composer.js' });
}
