    window.showJournalStyleDialog = function() {
      loadApiConfig();
      var profile = getProjectWritingProfile();
      var labels = getProjectUiLabels(profile.id);
      var styleAnalysisTitle = getProjectStyleAnalysisTitle(profile.id);
      var styleSourceName = getProjectStyleSourceName(profile.id);
      
      if (!apiConfig.url || !apiConfig.key) {
        showModal(styleAnalysisTitle,
          '<div style="color:var(--danger-color);font-size:14px;margin-bottom:15px;padding:12px;background:rgba(239,68,68,0.1);border:1px solid var(--danger-color);border-radius:8px;">' +
          '⚠️ 请先配置 API 设置' +
          '</div>' +
          '<div style="color:var(--text-secondary);font-size:13px;margin-bottom:15px;">' +
          '分析' + escapeHtml(labels.styleGroup) + '需要调用 AI 模型，请先在 API 设置中配置您的 API 地址和密钥。' +
          '</div>' +
          '<div style="background:var(--modal-tip-bg);border:1px solid var(--accent-color);border-radius:8px;padding:12px;margin-bottom:15px;">' +
          '<div style="color:var(--accent-color);font-weight:bold;margin-bottom:8px;">💡 推荐使用</div>' +
          '<div style="color:var(--text-primary);font-size:12px;line-height:1.8;">' +
          '• <b>千问 (Qwen)</b>：阿里云通义千问，中文理解能力强<br>' +
          '• <b>Kimi</b>：月之暗面，长文本处理出色<br>' +
          '• 两者均支持长文本材料分析与风格提取' +
          '</div>' +
          '</div>' +
          '<div class="btns">' +
          '<button class="cancel" onclick="closeModal()">取消</button>' +
          '<button class="ok" onclick="closeModal();showConnectDialog()">前往 API 设置</button>' +
          '</div>'
        );
        return;
      }
      
      showModal(styleAnalysisTitle,
        '<div style="color:var(--text-secondary);font-size:13px;margin-bottom:15px;">上传' + escapeHtml(styleSourceName) + '，也可以补充期刊官网 Author Guidelines 和 Cover Letter 要求；AI 将分析结构、表达、投稿格式和提交材料要求，生成可用于当前' + escapeHtml(profile.shortLabel) + '的风格指南</div>' +
        '<div style="margin-bottom:12px;">' +
        '<input type="file" id="journalStyleFiles" multiple accept=".txt,.ris,.bib,.json,.pdf" ' +
        'style="width:100%;padding:10px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);color:var(--text-primary);border-radius:4px;">' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:12px;">' +
          '<input id="journalNameForCrawler" type="text" placeholder="期刊名称（用于自动爬取官网指南，可选）" ' +
          'style="width:100%;padding:10px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);color:var(--text-primary);border-radius:4px;">' +
          '<input id="journalAuthorGuidelinesUrl" type="url" placeholder="期刊官网 Author Guidelines URL（可选）" ' +
          'style="width:100%;padding:10px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);color:var(--text-primary);border-radius:4px;">' +
          '<label style="display:flex;align-items:center;gap:8px;color:var(--text-secondary);font-size:12px;line-height:1.5;">' +
            '<input id="journalAutoCrawlGuidelines" type="checkbox" checked style="width:14px;height:14px;">' +
            '<span>自动爬取 Author Guidelines、Instructions for Authors、Submission Guidelines 和 Cover Letter 要求</span>' +
          '</label>' +
          '<textarea id="journalAuthorGuidelinesText" placeholder="粘贴 Author Guidelines / Instructions for Authors / Submission Guidelines 文本（可选）" rows="4" ' +
          'style="width:100%;padding:10px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);color:var(--text-primary);border-radius:4px;resize:vertical;"></textarea>' +
          '<textarea id="journalCoverLetterRequirements" placeholder="粘贴 Cover Letter 要求、模板或你希望系统遵守的投稿信要求（可选）" rows="3" ' +
          'style="width:100%;padding:10px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);color:var(--text-primary);border-radius:4px;resize:vertical;"></textarea>' +
        '</div>' +
        '<div style="color:var(--text-secondary);font-size:12px;margin-bottom:15px;">建议选择与当前项目最接近的模板、样例或要求文件；如果没有样例论文，也可以只填写官网指南或 Cover Letter 要求。</div>' +
        '<div style="background:var(--modal-tip-bg);border:1px solid var(--accent-color);border-radius:8px;padding:12px;margin-bottom:15px;">' +
        '<div style="color:var(--accent-color);font-weight:bold;margin-bottom:8px;">💡 推荐模型</div>' +
        '<div style="color:var(--text-primary);font-size:12px;line-height:1.8;">' +
        '• <b>千问 (Qwen)</b>：中文理解能力强，分析准确<br>' +
        '• <b>Kimi</b>：长文本处理出色，支持大篇幅材料' +
        '</div>' +
        '</div>' +
        '<div style="background:var(--modal-tip-bg);border:1px solid var(--accent-color);border-radius:8px;padding:12px;margin-bottom:15px;">' +
        '<div style="color:var(--accent-color);font-weight:bold;margin-bottom:8px;">🐄 分析执行者</div>' +
        '<div style="color:var(--text-primary);font-size:12px;line-height:1.8;">' +
        escapeHtml(labels.styleGroup) + '分析由 <b>小牛马</b>（Secondary Agent）执行<br>' +
        '小牛马负责：分析结构、提取写作风格特征、生成风格指南' +
        '</div>' +
        '</div>' +
        '<div class="btns">' +
        '<button class="cancel" onclick="closeModal()">取消</button>' +
        '<button class="ok" onclick="analyzeJournalStyle()">开始分析</button>' +
        '</div>'
      );
    }
    
    window.analyzeJournalStyle = async function() {
      var profile = getProjectWritingProfile();
      var labels = getProjectUiLabels(profile.id);
      var styleAnalysisTitle = getProjectStyleAnalysisTitle(profile.id);
      var fileInput = document.getElementById('journalStyleFiles');
      var selectedFiles = fileInput && fileInput.files ? fileInput.files : [];
      var journalName = (document.getElementById('journalNameForCrawler')?.value || '').trim();
      var authorGuidelinesUrl = (document.getElementById('journalAuthorGuidelinesUrl')?.value || '').trim();
      var autoCrawlGuidelines = document.getElementById('journalAutoCrawlGuidelines')?.checked !== false;
      var authorGuidelinesText = (document.getElementById('journalAuthorGuidelinesText')?.value || '').trim();
      var coverLetterRequirements = (document.getElementById('journalCoverLetterRequirements')?.value || '').trim();
      if (selectedFiles.length === 0 && !journalName && !authorGuidelinesUrl && !authorGuidelinesText && !coverLetterRequirements) {
        alert('请至少上传一个文件，或填写 Author Guidelines / Cover Letter 要求');
        return;
      }
      
      closeModal();
      
      // 创建进度显示元素
      var progressDiv = document.createElement('div');
      progressDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:12px;padding:24px;min-width:400px;max-width:600px;z-index:2000;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
      progressDiv.innerHTML = 
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">' +
        '<div style="width:24px;height:24px;border:3px solid var(--accent-color);border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></div>' +
        '<h3 style="color:var(--text-primary);margin:0;font-size:18px;">' + escapeHtml(styleAnalysisTitle) + '</h3>' +
        '</div>' +
        '<div id="journalProgressText" style="color:var(--text-secondary);font-size:14px;margin-bottom:16px;min-height:24px;">正在准备...</div>' +
        '<div style="background:var(--bg-input);border-radius:8px;height:24px;overflow:hidden;margin-bottom:16px;">' +
        '<div id="journalProgressBar" style="background:linear-gradient(90deg,var(--accent-color),#00f0b8);height:100%;width:0%;transition:width 0.3s ease;"></div>' +
        '</div>' +
        '<div id="journalPaperList" style="max-height:200px;overflow-y:auto;font-size:12px;color:var(--text-secondary);line-height:1.8;"></div>';
      document.body.appendChild(progressDiv);
      
      var progressText = document.getElementById('journalProgressText');
      var progressBar = document.getElementById('journalProgressBar');
      var paperList = document.getElementById('journalPaperList');
      
      // 上传文件
      var formData = new FormData();
      for (var i = 0; i < selectedFiles.length; i++) {
        formData.append('files', selectedFiles[i]);
      }
      formData.append('userId', currentUserId);
      formData.append('apiUrl', apiConfig.url);
      formData.append('apiKey', apiConfig.key);
      if (journalName) formData.append('journalName', journalName);
      if (authorGuidelinesUrl) formData.append('authorGuidelinesUrl', authorGuidelinesUrl);
      formData.append('autoCrawlGuidelines', autoCrawlGuidelines ? 'true' : 'false');
      if (authorGuidelinesText) formData.append('authorGuidelinesText', authorGuidelinesText);
      if (coverLetterRequirements) formData.append('coverLetterRequirements', coverLetterRequirements);
      
      try {
        var response = await fetch('/api/analyze-journal-style', {
          method: 'POST',
          body: formData
        });
        
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        
        while (true) {
          var result = await reader.read();
          if (result.done) break;
          
          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split('\n\n');
          buffer = lines.pop() || '';
          
          for (var j = 0; j < lines.length; j++) {
            var line = lines[j];
            if (line.startsWith('data: ')) {
              try {
                var data = JSON.parse(line.slice(6));
                
                if (data.type === 'start') {
                  progressText.textContent = data.message;
                  progressBar.style.width = '0%';
                } else if (data.type === 'progress') {
                  progressText.textContent = data.message;
                  var percent = (data.current / data.total) * 100;
                  progressBar.style.width = percent + '%';
                } else if (data.type === 'paper_complete') {
                  var percent = (data.current / data.total) * 100;
                  progressBar.style.width = percent + '%';
                  
                  // 添加到列表
                  var itemDiv = document.createElement('div');
                  itemDiv.style.cssText = 'padding:6px 0;border-bottom:1px solid var(--border-color);';
                  itemDiv.innerHTML = data.message;
                  paperList.appendChild(itemDiv);
                  paperList.scrollTop = paperList.scrollHeight;
                } else if (data.type === 'complete') {
                  progressBar.style.width = '100%';
                  progressText.textContent = data.message;
                  
                  // 重置期刊风格加载状态
                  loadedJournalStyles = false;
                  mainContextJournalStylesLoaded = false;
                  mainContextJournalStylesCache = [];
                  var section = document.getElementById('journalStylesSection');
                  if (section) section.innerHTML = '';
                  
                  // 延迟移除进度显示
                  setTimeout(function() {
                    progressDiv.remove();
                    appendMessage('✅ ' + labels.styleGroup + '分析完成！\n\n' +
                      labels.styleGroup + ': ' + data.result.journal_name + '\n' +
                      '已分析文件: ' + data.result.papers_count + ' 个\n' +
                      '已分析章节: ' + data.result.sections.join(', ') + '\n\n' +
                      (data.result.has_author_guidelines ? '✅ 已纳入期刊官网 Author Guidelines\n' : '') +
                      (data.result.has_cover_letter_requirements ? '✅ 已纳入 Cover Letter 要求\n' : '') +
                      '💡 使用方法：在输入框开头输入 / 即可选择' + labels.styleGroup + '。\n' +
                      'AI 将根据此风格指南生成' + labels.draft + '。', 'bot', false, true);
                  }, 1500);
                } else if (data.type === 'error') {
                  progressDiv.remove();
                  appendMessage('❌ 分析失败: ' + data.error, 'bot', false, true);
                }
              } catch (e) {
                console.warn('Failed to parse SSE data:', e);
              }
            }
          }
        }
      } catch (e) {
        progressDiv.remove();
        appendMessage('❌ 请求失败: ' + e.message, 'bot', false, true);
      }
      
      fileInput.value = '';
    }
    
    window.showExperimentSummary = async function() {
      var pageRequestId = beginWorkspacePageRequest('experiment-summary');
      var initialLabels = getProjectUiLabels();
      showWorkspaceRequestModal(pageRequestId, initialLabels.materialSummary, '<div style="text-align:center;padding:30px;color:var(--text-secondary);">正在读取实验资料总结...</div>', true, undefined, { modalClass: 'modal-reading' });
      try {
        var labels = getProjectUiLabels();
        var materialSummaryLabel = labels.materialSummary;
        console.log('[showExperimentSummary] currentUserId:', currentUserId);
        
        // Bug #4 修复：先获取状态信息
        var statusResponse = await fetch('/api/memory/summary-status/' + currentUserId);
        var statusData = await statusResponse.json();
        
        var expStatus = statusData.experimentSummary?.status || 'none';
        console.log('[showExperimentSummary] status:', expStatus);
        
        var response = await fetch('/api/memory/' + currentUserId);
        var data = await response.json();
        if (!isWorkspacePageRequestCurrent(pageRequestId)) return;
        
        var entries = data.memory?.entries || data.entries || [];
        
        // 优先显示结构化总结
        var structuredSummary = entries.find(function(e) { return e.key === 'experiment_summary_structured'; });
        var expSummary = entries.find(function(e) { return e.key === 'experiment_summary'; });
        
        console.log('[showExperimentSummary] structured found:', !!structuredSummary, 'raw found:', !!expSummary, 'entries count:', entries.length);
        
        if (structuredSummary && structuredSummary.value && structuredSummary.value.length > 100) {
          // 显示已生成的结构化总结（complete 状态）
          var summaryContent = structuredSummary.value || '';
          var html = '<div class="draft-dialog">' +
            '<div class="draft-dialog-header">' +
            '<h3 style="color:#10a37f;margin:0;">' + escapeHtml(materialSummaryLabel) + '</h3>' +
            '<div class="draft-meta" style="margin-bottom:0;">' + uiIcon('checkCircle', 'sm') + '<span>已生成 | ' + summaryContent.length + ' 字</span></div>' +
            '</div>' +
            '<div class="draft-meta">' + uiIcon('flask', 'sm') + '<span>类型：结构化总结 | 状态：已生成</span></div>' +
            '<div class="draft-content-view">' + escapeHtml(summaryContent) + '</div>' +
            '</div>';
          showWorkspaceRequestModal(pageRequestId, materialSummaryLabel, html, true, undefined, { modalClass: 'modal-reading' });
        } else if (expStatus === 'failed') {
          // Bug #4 修复：显示失败状态和重试按钮
          var previewContent = expSummary && expSummary.value && expSummary.value !== '未提供'
            ? expSummary.value.substring(0, 500) + (expSummary.value.length > 500 ? '...' : '')
            : '';
          var html = '<div class="draft-dialog">' +
            '<div class="draft-dialog-header">' +
            '<h3 style="color:#ff6b6b;margin:0;">' + escapeHtml(materialSummaryLabel) + '</h3>' +
            '<div class="draft-meta" style="margin-bottom:0;">' + uiIcon('x', 'sm') + '<span>结构化总结生成失败</span></div>' +
            '</div>' +
            '<div class="draft-tip error">' +
            '<div class="draft-tip-title">结构化总结生成可能因以下原因失败</div>' +
            '<div class="draft-tip-body">' +
            '<ul style="margin:0;padding-left:18px;line-height:1.7;">' +
            '<li>API 调用超时或网络问题</li>' +
            '<li>模型输出长度限制</li>' +
            '<li>原始内容格式不清晰</li>' +
            '</ul>' +
            '</div>' +
            '</div>' +
            '<div class="draft-meta">' + uiIcon('flask', 'sm') + '<span>原始数据字数：' + (expSummary?.value?.length || 0) + ' 字 | 发送一条新消息后会自动重试生成</span></div>' +
            (previewContent ?
            '<div class="draft-content-view">' + escapeHtml(previewContent) + '</div>' : 
            '<div class="draft-content-view" style="color:var(--text-secondary);text-align:center;">暂无可预览的原始内容</div>') +
            '</div>' +
          showWorkspaceRequestModal(pageRequestId, materialSummaryLabel, html, true, undefined, { modalClass: 'modal-reading' });
        } else if (expSummary && expSummary.value && expSummary.value !== '未提供') {
          // pending 状态：有原始内容但无结构化
          var rawContent = expSummary.value || '';
          var html = '<div class="draft-dialog">' +
            '<div class="draft-dialog-header">' +
            '<h3 style="color:#10a37f;margin:0;">' + escapeHtml(materialSummaryLabel) + '</h3>' +
            '<div class="draft-meta" style="margin-bottom:0;">' + uiIcon('flask', 'sm') + '<span>结构化总结生成中</span></div>' +
            '</div>' +
            '<div class="draft-tip warning">' +
            '<div class="draft-tip-title">提示</div>' +
            '<div class="draft-tip-body">结构化总结将在下次对话时自动生成。你也可以继续提供更多相关信息。</div>' +
            '</div>' +
            '<div class="draft-meta">' + uiIcon('flask', 'sm') + '<span>类型：原始资料 | 已记录 ' + rawContent.length + ' 字</span></div>' +
            '<div class="draft-content-view">' + escapeHtml(rawContent) + '</div>' +
            '</div>';
          showWorkspaceRequestModal(pageRequestId, materialSummaryLabel, html, true, undefined, { modalClass: 'modal-reading' });
        } else {
          showWorkspaceRequestModal(pageRequestId, materialSummaryLabel, '<div style="color:#8e8ea0;text-align:center;padding:20px;">' + labels.materialPlaceholder + '</div>', true);
        }
      } catch (e) {
        if (!isWorkspacePageRequestCurrent(pageRequestId)) return;
        console.error('[showExperimentSummary] Error:', e);
        var labels = getProjectUiLabels();
        showWorkspaceRequestModal(pageRequestId, labels.materialSummary, '<div style="color:#ff4f40;text-align:center;padding:20px;">获取失败：' + e.message + '</div>', true);
      }
    }
    
    // 查看当前项目草稿
    window.showDraftDialog = async function() {
      var pageRequestId = beginWorkspacePageRequest('draft');
      var initialLabels = getProjectUiLabels();
      showWorkspaceRequestModal(
        pageRequestId,
        initialLabels.draft,
        '<div style="text-align:center;padding:30px;color:var(--text-secondary);">正在读取论文草稿...</div>',
        true,
        undefined,
        { modalClass: 'modal-reading' }
      );
      try {
        var labels = getProjectUiLabels();
        var draftLabel = labels.draft;
        var response = await fetch('/api/draft/' + currentUserId);
        var data = await response.json();
        if (!isWorkspacePageRequestCurrent(pageRequestId)) return;
        
        if (data.exists && data.content) {
          var draftContent = data.content || '';
          var journalStyle = escapeHtml(data.journal_style || labels.styleGroup);
          var html = '<div class="draft-dialog">' +
            '<div class="draft-dialog-header">' +
            '<h3 style="color:#10a37f;margin:0;">' + escapeHtml(draftLabel) + '</h3>' +
            '<div class="draft-toolbar">' +
            '<button class="ok" id="draftEditBtn" onclick="enableDraftEdit()">' + uiIcon('edit', 'sm') + '编辑</button>' +
            '<button class="ok" id="draftSaveBtn" onclick="saveDraftEdit()" style="display:none;">' + uiIcon('checkCircle', 'sm') + '保存</button>' +
            '<button class="cancel" id="draftCancelEditBtn" onclick="cancelDraftEdit()" style="display:none;">' + uiIcon('x', 'sm') + '取消</button>' +
            '<button class="ok" id="draftCopyBtn" onclick="copyDraftToClipboard()">' + uiIcon('clipboard', 'sm') + '复制</button>' +
            '<button class="ok" id="draftDownloadBtn" onclick="downloadDraft()">' + uiIcon('fileText', 'sm') + '下载</button>' +
            '</div>' +
            '</div>' +
            '<div class="draft-tip">' +
            '<div class="draft-tip-title">导入到 Overleaf 提示</div>' +
            '<div class="draft-tip-body">' +
            '1. 登录 <a href="https://cn.overleaf.com/" target="_blank" style="color:#818cf8;text-decoration:underline;">Overleaf</a> 并创建新项目<br>' +
            '2. 上传下载的 .tex 文件<br>' +
            '3. <strong style="color:#fbbf24;">重要：选择 XeLaTeX 编译器</strong>（Menu → Compiler → XeLaTeX）' +
            '</div>' +
            '</div>' +
            '<div class="draft-meta">' +
            uiIcon('fileText', 'sm') + '<span>格式：LaTeX | 引用格式：' + journalStyle + '</span>' +
            '</div>' +
            '<div id="draftViewContent" class="draft-content-view">' + escapeHtml(draftContent) + '</div>' +
            '<textarea id="draftEditTextarea" class="draft-editor-textarea" spellcheck="false" style="display:none;">' + escapeHtml(draftContent) + '</textarea>' +
            '</div>';
          showWorkspaceRequestModal(pageRequestId, draftLabel, html, true, undefined, { modalClass: 'modal-reading' });
        } else {
          var styleInfo = data.journal_style ? '<br><br>' + escapeHtml(labels.styleGroup) + '：<strong>' + escapeHtml(data.journal_style) + '</strong>' : '';
          showWorkspaceRequestModal(pageRequestId, draftLabel,
            '<div style="color:#8e8ea0;text-align:center;padding:20px;">' +
            '暂无' + escapeHtml(draftLabel) + '<br><br>' +
            '💡 与 AI 讨论写作内容后，说：<br>' +
            '<code style="background:#343541;padding:8px 16px;border-radius:6px;display:inline-block;margin:12px 0;">"把这段更新到草稿里面吧"</code><br><br>' +
            '或者点击消息下方的保存按钮。<br><br>' +
            'AI 会将您满意的段落保存到草稿中。' + styleInfo +
            '</div>',
            true,
            undefined,
            { modalClass: 'modal-reading' }
          );
        }
      } catch (e) {
        if (!isWorkspacePageRequestCurrent(pageRequestId)) return;
        var labels = getProjectUiLabels();
        showWorkspaceRequestModal(pageRequestId, labels.draft, '<div style="color:#ff4f40;text-align:center;padding:20px;">获取失败：' + e.message + '</div>', true);
      }
    }

    function setDraftEditMode(isEditing) {
      var view = document.getElementById('draftViewContent');
      var editor = document.getElementById('draftEditTextarea');
      var editBtn = document.getElementById('draftEditBtn');
      var saveBtn = document.getElementById('draftSaveBtn');
      var cancelBtn = document.getElementById('draftCancelEditBtn');
      var copyBtn = document.getElementById('draftCopyBtn');
      var downloadBtn = document.getElementById('draftDownloadBtn');

      if (view) view.style.display = isEditing ? 'none' : 'block';
      if (editor) editor.style.display = isEditing ? 'block' : 'none';
      if (editBtn) editBtn.style.display = isEditing ? 'none' : 'inline-flex';
      if (saveBtn) saveBtn.style.display = isEditing ? 'inline-flex' : 'none';
      if (cancelBtn) cancelBtn.style.display = isEditing ? 'inline-flex' : 'none';
      if (copyBtn) copyBtn.style.display = isEditing ? 'none' : 'inline-flex';
      if (downloadBtn) downloadBtn.style.display = isEditing ? 'none' : 'inline-flex';

      if (isEditing && editor) {
        editor.focus();
        editor.setSelectionRange(editor.value.length, editor.value.length);
      }
    }

    window.enableDraftEdit = function() {
      setDraftEditMode(true);
    };

    window.cancelDraftEdit = function() {
      var view = document.getElementById('draftViewContent');
      var editor = document.getElementById('draftEditTextarea');
      if (view && editor) {
        editor.value = view.textContent || '';
      }
      setDraftEditMode(false);
    };

    window.saveDraftEdit = async function() {
      var editor = document.getElementById('draftEditTextarea');
      var saveBtn = document.getElementById('draftSaveBtn');
      if (!editor) return;

      var content = editor.value;
      if (!content.trim()) {
        alert('草稿内容为空，未保存。');
        return;
      }

      var originalHtml = saveBtn ? saveBtn.innerHTML : '';
      try {
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.innerHTML = uiIcon('checkCircle', 'sm') + '保存中';
        }

        var response = await fetch('/api/draft/' + currentUserId, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: content })
        });
        var result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || '保存失败');
        }

        var preservedNotice = Array.isArray(result.preservedChapters) && result.preservedChapters.length
          ? '\n\n为避免误删，本次未出现在编辑器中的章节已保留：' + result.preservedChapters.join(', ')
          : '';
        alert('草稿已保存。' + preservedNotice);
        invalidateArticleDraftProgressCache();
        await showDraftDialog();
      } catch (e) {
        alert('保存失败：' + e.message);
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = originalHtml;
        }
      }
    };
    
    // 复制草稿到剪贴板
    window.copyDraftToClipboard = async function() {
      try {
        var response = await fetch('/api/draft/' + currentUserId);
        var data = await response.json();
        if (data.content) {
          await navigator.clipboard.writeText(data.content);
          alert('草稿已复制到剪贴板！');
        }
      } catch (e) {
        alert('复制失败：' + e.message);
      }
    }
    
    // 下载草稿文件 - 显示格式选择
    window.downloadDraft = async function() {
      // 显示格式选择对话框
      var formatHtml = '<div style="text-align:center;padding:20px;">' +
        '<h3 style="color:#10a37f;margin-bottom:20px;">选择下载格式</h3>' +
        '<div style="display:flex;flex-direction:column;gap:12px;">' +
        '<button onclick="downloadDraftFormat(\'tex\')" style="padding:12px 20px;background:linear-gradient(135deg,#a855f7,#6366f1);color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;">' +
        '📄 LaTeX (.tex) - 推荐 Overleaf 使用</button>' +
        '<button onclick="downloadDraftFormat(\'zip\')" style="padding:12px 20px;background:linear-gradient(135deg,#3b82f6,#06b6d4);color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;">' +
        '📦 ZIP 压缩包 (.zip) - Overleaf 直接导入</button>' +
        '<button onclick="downloadDraftFormat(\'txt\')" style="padding:12px 20px;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:8px;cursor:pointer;font-size:14px;">' +
        '📝 纯文本 (.txt)</button>' +
        '<button onclick="downloadDraftFormat(\'docx\')" style="padding:12px 20px;background:linear-gradient(135deg,#10b981,#059669);color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;">' +
        '📘 Word 文档 (.docx)</button>' +
        '</div>' +
        '<div style="margin-top:20px;padding:12px;background:var(--bg-secondary);border-radius:6px;text-align:left;">' +
        '<div style="color:#a855f7;font-size:13px;font-weight:600;margin-bottom:8px;">💡 提示</div>' +
        '<ul style="color:var(--text-secondary);font-size:12px;line-height:1.6;margin:0;padding-left:20px;">' +
        '<li><strong style="color:#fbbf24;">ZIP 格式</strong>可直接上传到 Overleaf</li>' +
        '<li>上传后记得选择 <strong style="color:#fbbf24;">XeLaTeX 编译器</strong></li>' +
        '<li>Word 格式方便在本地编辑查看</li>' +
        '</ul>' +
        '</div>' +
        '</div>';
      
      showModal('下载草稿', formatHtml);
    };
    
    // 下载指定格式的草稿
    window.downloadDraftFormat = async function(format) {
      closeModal();
      
      try {
        var response = await fetch('/api/draft/' + currentUserId + '/download?format=' + format);
        
        if (!response.ok) {
          throw new Error('下载失败');
        }
        
        var blob = await response.blob();
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        
        // 根据格式设置文件扩展名
        var ext = format;
        if (format === 'tex') ext = 'tex';
        else if (format === 'zip') ext = 'zip';
        else if (format === 'txt') ext = 'txt';
        else if (format === 'docx') ext = 'docx';
        
        a.download = 'paper-draft.' + ext;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        alert('下载失败：' + e.message);
      }
    };
    
    window.showDataSummary = async function() {
      var pageRequestId = beginWorkspacePageRequest('data-summary');
      var initialLabels = getProjectUiLabels();
      showWorkspaceRequestModal(pageRequestId, initialLabels.resultSummary, '<div style="text-align:center;padding:30px;color:var(--text-secondary);">正在读取数据详细总结...</div>', true, undefined, { modalClass: 'modal-reading' });
      try {
        var labels = getProjectUiLabels();
        var resultSummaryLabel = labels.resultSummary;
        console.log('[showDataSummary] currentUserId:', currentUserId);
        
        // Bug #4 修复：先获取状态信息
        var statusResponse = await fetch('/api/memory/summary-status/' + currentUserId);
        var statusData = await statusResponse.json();
        
        var dataStatus = statusData.dataSummary?.status || 'none';
        console.log('[showDataSummary] status:', dataStatus);
        
        var response = await fetch('/api/memory/' + currentUserId);
        var data = await response.json();
        if (!isWorkspacePageRequestCurrent(pageRequestId)) return;
        
        var entries = data.memory?.entries || data.entries || [];
        
        // 优先显示结构化总结
        var structuredSummary = entries.find(function(e) { return e.key === 'data_summary_structured'; });
        var dataSummary = entries.find(function(e) { return e.key === 'data_summary'; });
        
        console.log('[showDataSummary] structured found:', !!structuredSummary, 'raw found:', !!dataSummary, 'entries count:', entries.length);
        
        if (structuredSummary && structuredSummary.value && structuredSummary.value.length > 100) {
          // 显示已生成的结构化总结（complete 状态）
          var summaryContent = structuredSummary.value || '';
          var html = '<div class="draft-dialog">' +
            '<div class="draft-dialog-header">' +
            '<h3 style="color:#10a37f;margin:0;">' + escapeHtml(resultSummaryLabel) + '</h3>' +
            '<div class="draft-meta" style="margin-bottom:0;">' + uiIcon('checkCircle', 'sm') + '<span>已生成 | ' + summaryContent.length + ' 字</span></div>' +
            '</div>' +
            '<div class="draft-meta">' + uiIcon('barChart', 'sm') + '<span>类型：结构化总结 | 状态：已生成</span></div>' +
            '<div class="draft-content-view">' + escapeHtml(summaryContent) + '</div>' +
            '</div>';
          showWorkspaceRequestModal(pageRequestId, resultSummaryLabel, html, true, undefined, { modalClass: 'modal-reading' });
        } else if (dataStatus === 'failed') {
          // Bug #4 修复：显示失败状态和重试按钮
          var previewContent = dataSummary && dataSummary.value && dataSummary.value !== '未提供'
            ? dataSummary.value.substring(0, 500) + (dataSummary.value.length > 500 ? '...' : '')
            : '';
          var html = '<div class="draft-dialog">' +
            '<div class="draft-dialog-header">' +
            '<h3 style="color:#ff6b6b;margin:0;">' + escapeHtml(resultSummaryLabel) + '</h3>' +
            '<div class="draft-meta" style="margin-bottom:0;">' + uiIcon('x', 'sm') + '<span>结构化总结生成失败</span></div>' +
            '</div>' +
            '<div class="draft-tip error">' +
            '<div class="draft-tip-title">结构化总结生成可能因以下原因失败</div>' +
            '<div class="draft-tip-body">' +
            '<ul style="margin:0;padding-left:18px;line-height:1.7;">' +
            '<li>API 调用超时或网络问题</li>' +
            '<li>模型输出长度限制</li>' +
            '<li>数据格式不清晰</li>' +
            '</ul>' +
            '</div>' +
            '</div>' +
            '<div class="draft-meta">' + uiIcon('barChart', 'sm') + '<span>原始数据字数：' + (dataSummary?.value?.length || 0) + ' 字 | 发送一条新消息后会自动重试生成</span></div>' +
            (previewContent ?
            '<div class="draft-content-view">' + escapeHtml(previewContent) + '</div>' :
            '<div class="draft-content-view" style="color:var(--text-secondary);text-align:center;">暂无可预览的原始内容</div>') +
            '</div>' +
          showWorkspaceRequestModal(pageRequestId, resultSummaryLabel, html, true, undefined, { modalClass: 'modal-reading' });
        } else if (dataSummary && dataSummary.value && dataSummary.value !== '未提供') {
          // pending 状态：有原始内容但无结构化
          var rawContent = dataSummary.value || '';
          var html = '<div class="draft-dialog">' +
            '<div class="draft-dialog-header">' +
            '<h3 style="color:#10a37f;margin:0;">' + escapeHtml(resultSummaryLabel) + '</h3>' +
            '<div class="draft-meta" style="margin-bottom:0;">' + uiIcon('barChart', 'sm') + '<span>结构化总结生成中</span></div>' +
            '</div>' +
            '<div class="draft-tip warning">' +
            '<div class="draft-tip-title">提示</div>' +
            '<div class="draft-tip-body">结构化总结将在下次对话时自动生成。你也可以继续提供更多关键信息。</div>' +
            '</div>' +
            '<div class="draft-meta">' + uiIcon('barChart', 'sm') + '<span>类型：原始信息记录 | 已记录 ' + rawContent.length + ' 字</span></div>' +
            '<div class="draft-content-view">' + escapeHtml(rawContent) + '</div>' +
            '</div>';
          showWorkspaceRequestModal(pageRequestId, resultSummaryLabel, html, true, undefined, { modalClass: 'modal-reading' });
        } else {
          showWorkspaceRequestModal(pageRequestId, resultSummaryLabel, '<div style="color:#8e8ea0;text-align:center;padding:20px;">' + labels.resultPlaceholder + '</div>', true);
        }
      } catch (e) {
        if (!isWorkspacePageRequestCurrent(pageRequestId)) return;
        console.error('[showDataSummary] Error:', e);
        var labels = getProjectUiLabels();
        showWorkspaceRequestModal(pageRequestId, labels.resultSummary, '<div style="color:#ff4f40;text-align:center;padding:20px;">获取失败: ' + e.message + '</div>', true);
      }
    }
    
    window.updateMemoryManual = async function() {
      var content = document.getElementById('memoryInput').value;
      if (!content.trim()) {
        alert('请输入要保存的内容');
        return;
      }
      
      closeModal();
      appendMessage('正在保存，请稍候...', 'bot', false, true);
      
      try {
        // 使用新的专用 API，传递用户的 API 配置
        var response = await fetch('/api/research-material/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: content,
            append: true,  // 追加模式
            apiKey: apiConfig.key,      // 用户配置的 API 密钥
            apiUrl: apiConfig.url       // 用户配置的 API URL
          })
        });
        
        var result = await response.json();
        if (result.success) {
          var labels = getProjectUiLabels();
          appendMessage('✅ ' + labels.materialSummary + '已保存！当前总字数：' + (result.characters || result.length), 'bot', false, true);
        } else {
          appendMessage('❌ 保存失败：' + (result.error || '未知错误'), 'bot', false, true);
        }
      } catch (e) {
        // 如果新 API 失败，降级到旧 API
        console.warn('[UpdateMemory] New API failed, using fallback:', e);
        
        try {
          // 降级到旧 API（正确路径：POST /api/memory/update）
          var fallbackResponse = await fetch('/api/memory/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: currentUserId,
              userMessage: content,
              aiResponse: '',
              apiUrl: apiConfig.url,
              apiKey: apiConfig.key,
              model: apiConfig.model,
              secondaryModel: apiConfig.model || currentModel
            })
          });
          
          var fallbackResult = await fallbackResponse.json();
          if (fallbackResult.success) {
            appendMessage('✅ 记忆已更新！(使用旧 API)', 'bot', false, true);
          } else {
            appendMessage('❌ 更新失败：' + (fallbackResult.error || '未知错误'), 'bot', false, true);
          }
        } catch (fallbackError) {
          appendMessage('❌ 保存失败：' + e.message, 'bot', false, true);
        }
      }
    }
    
    window.showMemoryUpdateDialog = function() {
      var profile = getProjectWritingProfile();
      var labels = getProjectUiLabels(profile.id);
      showModal('手动更新记忆', 
        '<div style="color:#ececf1;margin-bottom:15px;">请输入' + escapeHtml(labels.materialEnabledLabel) + '或' + escapeHtml(profile.requirementLabel) + '：</div>' +
        '<textarea id="memoryInput" style="width:100%;height:200px;background:#2d2d2d;border:1px solid #343541;color:#ececf1;padding:12px;border-radius:6px;resize:vertical;font-family:inherit;" placeholder="在此输入当前项目的背景、目标、材料来源、方法/方案、结果/要点、格式要求或待解决问题。&#10;&#10;例如：&#10;- ' + escapeHtml(profile.topicLabel) + '：...&#10;- 核心目标：...&#10;- 已有资料：...&#10;- 方法/方案：...&#10;- 关键结果或要点：...&#10;- 特殊要求：..."></textarea>' +
        '<div style="margin-top:15px;text-align:right;">' +
        '<button class="cancel" onclick="closeModal()" style="margin-right:10px;">取消</button>' +
        '<button class="ok" onclick="updateMemoryManual()">保存到记忆</button>' +
        '</div>'
      );
    }

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('content-tools', { source: '/app/content-tools.js' });
}
