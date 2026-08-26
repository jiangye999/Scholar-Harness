// ============ 一键写作 ============
    var reviewWriterLastResult = null;
    var reviewWriterActiveJobId = localStorage.getItem('scholar_review_writer_job') || '';
    var reviewWriterLastJobId = localStorage.getItem('scholar_review_writer_last_job') || reviewWriterActiveJobId || '';
    var reviewWriterPollTimer = null;
    var reviewWriterFinalMessageAppended = false;
    var reviewWriterTypewriterTimers = {};
    var reviewWriterTypedText = {};

    async function showReviewWriterDialog(options) {
      updateAcademicWorkflowOverviewReturn(options);
      loadApiConfig();
      if (!projectManagerCurrentProject) {
        await fetchCurrentProjectInfo();
      }
      var profile = getProjectWritingProfile();
      var labels = getProjectUiLabels(profile.id);
      var isThesisProfile = profile.id === 'thesis-writing';
      var reviewSubtitle = isThesisProfile
        ? '大论文写作会按“总研究问题-章节问题-方法结果-讨论结论”的长链条规划；建议先在大论文工作台和章节框架中整理材料，再生成提纲、单章草稿或阶段性整合稿。'
        : '输入主题、要求和目标字数后，系统会按当前项目主题自主规划结构、段落和句子，再按句生成检索词；每句先检索资料库和 PDF 论点库 TOP20 候选，再筛选最相关的 1-3 条用于写作。';
      var autoResearchDesc = isThesisProfile
        ? '勾选后可不填主题和篇幅；系统会调用最新 Auto Research 报告、研究 Wiki、证据对象、草稿框架和文献综述材料作为上游依据。'
        : '勾选后可不填主题和篇幅；系统会调用最新 Auto Research 报告、论文蓝图、研究 Wiki、引用审计、证据对象和草稿作为上游写作依据。';
      var wordCountPlaceholder = isThesisProfile ? '可留空，默认 4000；整本大论文建议分章生成' : '可留空，默认 4000';
      var html = `
        <div class="review-dialog">
          <section class="review-hero academic-workflow-page-header">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
              <div style="min-width:0;">
                <h3 class="review-title">${escapeHtml(profile.oneClickTitle)}</h3>
                <div class="review-subtitle">${escapeHtml(reviewSubtitle)}</div>
              </div>
              <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;">
                <div id="reviewWriterInlineModalActions" style="display:inline-flex;align-items:center;gap:8px;"></div>
              </div>
            </div>
          </section>

          <div class="review-grid">
            <section class="review-panel">
              <div class="review-panel-title">${uiIcon('edit', 'sm')} 主题与篇幅</div>
              <label class="review-check" for="reviewWriterUseAutoResearch" style="margin-bottom:10px;">
                <input id="reviewWriterUseAutoResearch" type="checkbox" checked onchange="toggleReviewWriterAutoResearchMode()">
                <span class="review-check-text">
                  <span class="review-check-title">使用 Auto Research 结果</span>
                  <span class="review-check-desc">${escapeHtml(autoResearchDesc)}</span>
                </span>
              </label>
              <div class="review-field">
                <label for="reviewWriterTopic" id="reviewWriterTopicLabel">${escapeHtml(profile.topicLabel)}（可选，Auto Research 会自动补齐）</label>
                <textarea id="reviewWriterTopic" placeholder="可留空：勾选 Auto Research 时将使用最新 Auto Research 的主题/推荐题目"></textarea>
              </div>
              <div class="review-field">
                <label for="reviewWriterRequirements">${escapeHtml(profile.requirementLabel)}</label>
                <textarea id="reviewWriterRequirements" placeholder="请输入${escapeHtml(profile.requirementLabel)}，例如重点、格式、风格、限制和必须覆盖的内容。"></textarea>
              </div>
              <div class="review-field">
                <label for="reviewWriterWordCount" id="reviewWriterWordCountLabel">目标字数（可选）</label>
                <input id="reviewWriterWordCount" type="number" min="800" max="20000" step="500" value="" placeholder="${escapeHtml(wordCountPlaceholder)}">
              </div>
              <div class="review-field">
                <label for="reviewWriterReferenceFormat">${escapeHtml(labels.referenceFormat)}</label>
                <textarea id="reviewWriterReferenceFormat" placeholder="粘贴${escapeHtml(labels.referenceFormat)}或示例。例如：Author(s). (Year). Title. Journal, volume(issue), pages. https://doi.org/xx"></textarea>
              </div>
              <div class="review-field">
                <label for="reviewWriterCitationStyle">文中引用格式</label>
                <select id="reviewWriterCitationStyle" onchange="updateReviewCitationCustomField()">
                  <option value="authorYear">(Zhang et al., 2026)</option>
                  <option value="numeric">[1]</option>
                  <option value="custom">其他/自定义</option>
                </select>
              </div>
              <div class="review-field" id="reviewWriterCitationCustomWrap" style="display:none;">
                <label for="reviewWriterCitationCustom">自定义文中引用格式</label>
                <input id="reviewWriterCitationCustom" type="text" placeholder="例如：Zhang et al. (2026)、{author} ({year})、[{number}]">
              </div>
              <div class="review-field">
                <label>${escapeHtml(labels.styleGroup)}</label>
                <div id="reviewWriterJournalStyles" class="review-style-list">
                  <div class="review-style-state">正在读取已分析的${escapeHtml(labels.styleGroup)}...</div>
                </div>
                <div class="review-style-state">可多选；不选时后台会自动使用最新分析结果（如有）。</div>
              </div>
              <label class="review-check" for="reviewWriterUseCodexCli">
                <input id="reviewWriterUseCodexCli" type="checkbox" checked>
                <span class="review-check-text">
                  <span class="review-check-title">优先使用 Codex CLI</span>
                  <span class="review-check-desc">默认开启。提纲规划和逐句写作先调用本机 Codex；不可用或失败时自动降级小牛马。</span>
                </span>
              </label>
              <label class="review-check" for="reviewWriterUseLongMemory">
                <input id="reviewWriterUseLongMemory" type="checkbox">
                <span class="review-check-text">
                  <span class="review-check-title">使用跨会话长期记忆</span>
                  <span class="review-check-desc">勾选后，完整长期记忆保存在本地；每次 AI 调用按当前章节/句子选取相关片段，降低上下文溢出风险。</span>
                </span>
              </label>
              <label class="review-check" for="reviewWriterUseExperimentMaterials">
                <input id="reviewWriterUseExperimentMaterials" type="checkbox">
                <span class="review-check-text">
                  <span class="review-check-title">使用${escapeHtml(labels.materialEnabledLabel)}</span>
                  <span class="review-check-desc">${escapeHtml(labels.materialEnabledDesc)}</span>
                </span>
              </label>
            </section>

            <section class="review-panel">
              <div class="review-panel-title">${uiIcon('library', 'sm')} 写作流程</div>
              <div class="review-metric-grid">
                <div class="review-metric">
                  <div class="review-metric-value">AI</div>
                  <div class="review-metric-label">自动定结构</div>
                </div>
                <div class="review-metric">
                  <div class="review-metric-value">20→3</div>
                  <div class="review-metric-label">候选筛选</div>
                </div>
                <div class="review-metric">
                  <div class="review-metric-value">Word</div>
                  <div class="review-metric-label">导出格式</div>
                </div>
              </div>
              <div id="reviewWriterStatus" class="review-status">等待开始</div>
            </section>
          </div>

          <div class="btns review-footer">
            <div class="da-footer-note">章节数、段落数和每段句数由 AI 根据主题和目标字数决定；关闭弹窗后主页会继续显示进程。</div>
            <button class="cancel" onclick="closeModal()">关闭</button>
            <button class="cancel" id="reviewWriterStopBtn" onclick="stopReviewWriterJob()" disabled>停止</button>
            <button class="cancel" id="reviewWriterRestartBtn" onclick="restartReviewWriterJob()" disabled>重启</button>
            <button class="cancel" id="reviewWriterCopyBtn" onclick="copyReviewWriterContent()" disabled>复制</button>
            <button class="ok" id="reviewWriterDownloadBtn" onclick="downloadReviewWriterDocx()" disabled>导出Word</button>
            <button class="ok" id="reviewWriterGenerateBtn" onclick="generateReviewWriter()">${escapeHtml(profile.oneClickAction)}</button>
          </div>
        </div>
      `;
      showModal(profile.oneClickTitle, html, true, true, { hideTitle: true, inlineHeaderActionsTargetId: 'reviewWriterInlineModalActions' });
      toggleReviewWriterAutoResearchMode();
      if (reviewWriterLastResult) {
        renderReviewWriterResult(reviewWriterLastResult);
      } else if (reviewWriterActiveJobId) {
        pollReviewWriterJob();
      }
      setTimeout(updateReviewCitationCustomField, 0);
      setTimeout(loadReviewWriterJournalStyles, 0);
    }
    window.showReviewWriterDialog = showReviewWriterDialog;

    function toggleReviewWriterAutoResearchMode() {
      var profile = getProjectWritingProfile();
      var isThesisProfile = profile.id === 'thesis-writing';
      var useAuto = !!document.getElementById('reviewWriterUseAutoResearch')?.checked;
      var topicLabel = document.getElementById('reviewWriterTopicLabel');
      var topicInput = document.getElementById('reviewWriterTopic');
      var wordLabel = document.getElementById('reviewWriterWordCountLabel');
      var wordInput = document.getElementById('reviewWriterWordCount');
      if (topicLabel) {
        topicLabel.textContent = useAuto
          ? profile.topicLabel + '（可选，Auto Research 会自动补齐）'
          : profile.topicLabel + '（必填）';
      }
      if (topicInput) {
        topicInput.placeholder = useAuto
          ? (isThesisProfile ? '可留空：将使用最新 Auto Research、章节框架和综述资料补齐大论文主线' : '可留空：将使用最新 Auto Research 的主题/推荐题目')
          : '请输入' + profile.topicLabel;
      }
      if (wordLabel) {
        wordLabel.textContent = useAuto ? '目标字数（可选）' : '目标字数';
      }
      if (wordInput) {
        wordInput.placeholder = useAuto ? (isThesisProfile ? '可留空，默认 4000；整本大论文建议分章生成' : '可留空，默认 4000') : '例如：4000';
        if (!useAuto && !String(wordInput.value || '').trim()) wordInput.value = '4000';
      }
    }
    window.toggleReviewWriterAutoResearchMode = toggleReviewWriterAutoResearchMode;

    function updateReviewCitationCustomField() {
      var select = document.getElementById('reviewWriterCitationStyle');
      var wrap = document.getElementById('reviewWriterCitationCustomWrap');
      if (!select || !wrap) return;
      wrap.style.display = select.value === 'custom' ? 'block' : 'none';
    }
    window.updateReviewCitationCustomField = updateReviewCitationCustomField;

    function getReviewWriterSelectedJournalStyleIds() {
      return Array.prototype.slice.call(document.querySelectorAll('input[name="reviewWriterJournalStyle"]:checked'))
        .map(function(input) { return input.value; })
        .filter(Boolean);
    }

    async function loadReviewWriterJournalStyles() {
      var list = document.getElementById('reviewWriterJournalStyles');
      if (!list) return;
      var labels = getProjectUiLabels();
      list.innerHTML = '<div class="review-style-state">正在读取已分析的' + escapeHtml(labels.styleGroup) + '...</div>';
      try {
        var response = await fetch('/api/journal-styles/list?userId=' + encodeURIComponent(currentUserId || 'web-user'));
        var data = await response.json();
        var journals = (data && data.success && Array.isArray(data.journals)) ? data.journals : [];
        if (journals.length === 0) {
          list.innerHTML = '<div class="review-style-state">' + escapeHtml(labels.styleEmpty) + '</div>';
          return;
        }
        list.innerHTML = journals.map(function(journal, index) {
          var checked = index === 0 ? ' checked' : '';
          var updatedAt = journal.updatedAt ? new Date(journal.updatedAt).toLocaleString() : '未知时间';
          var sourceLabel = journal.sourceUserId && journal.sourceUserId !== currentUserId ? ' · 来源：' + escapeHtml(journal.sourceUserId) : '';
          return '' +
            '<label class="review-style-option">' +
              '<input type="checkbox" name="reviewWriterJournalStyle" value="' + escapeHtml(journal.id) + '"' + checked + '>' +
              '<span>' +
                '<span class="review-style-name">' + escapeHtml(journal.name || journal.id) + '</span>' +
                '<span class="review-style-meta">更新时间：' + escapeHtml(updatedAt) + sourceLabel + '</span>' +
              '</span>' +
            '</label>';
        }).join('');
      } catch (e) {
        list.innerHTML = '<div class="review-style-state">' + escapeHtml(labels.styleGroup) + '读取失败：' + escapeHtml(e.message) + '</div>';
      }
    }
    window.loadReviewWriterJournalStyles = loadReviewWriterJournalStyles;

    function setReviewWriterStatus(html, type) {
      var status = document.getElementById('reviewWriterStatus');
      if (!status) return;
      status.classList.add('show');
      status.style.borderColor = type === 'error' ? 'var(--danger-color)' : (type === 'success' ? 'var(--accent-color)' : 'var(--border-color)');
      status.innerHTML = html;
    }

    function typeReviewWriterLine(elementId, text) {
      var el = document.getElementById(elementId);
      if (!el) return;
      text = String(text || '');
      if (reviewWriterTypedText[elementId] === text) {
        el.textContent = text;
        return;
      }
      reviewWriterTypedText[elementId] = text;
      if (reviewWriterTypewriterTimers[elementId]) {
        clearInterval(reviewWriterTypewriterTimers[elementId]);
      }
      el.textContent = '';
      var index = 0;
      reviewWriterTypewriterTimers[elementId] = setInterval(function() {
        index += 2;
        el.textContent = text.slice(0, index);
        if (index >= text.length) {
          clearInterval(reviewWriterTypewriterTimers[elementId]);
          reviewWriterTypewriterTimers[elementId] = null;
        }
      }, 18);
    }

    function getReviewWriterDownloadFileStem(job) {
      var result = job && job.result ? job.result : {};
      var title = result.outline && result.outline.title ? result.outline.title : (job && job.topic ? job.topic : 'paper-draft');
      return String(title || 'paper-draft')
        .replace(/[\\/:*?"<>|\x00-\x1F]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'paper-draft';
    }

    function getReviewWriterDownloadUrl(job, format) {
      var jobId = job && job.jobId ? String(job.jobId) : '';
      if (!jobId) return '#';
      return '/api/review-writer/download/' + encodeURIComponent(jobId) +
        '?format=' + encodeURIComponent(format) +
        '&userId=' + encodeURIComponent(currentUserId || 'web-user');
    }

    function renderReviewWriterDownloadAttachments(job) {
      if (!job || job.status !== 'completed' || !job.result || !job.jobId) return '';
      var stem = getReviewWriterDownloadFileStem(job);
      var files = [
        { format: 'docx', label: 'Word', ext: 'docx' },
        { format: 'tex', label: 'LaTeX', ext: 'tex' },
        { format: 'md', label: 'Markdown', ext: 'md' },
        { format: 'txt', label: '纯文本', ext: 'txt' }
      ];
      return '' +
        '<div class="review-downloads">' +
          '<div class="review-downloads-title">可下载文件</div>' +
          '<div class="review-download-grid">' +
            files.map(function(file) {
              var filename = stem + '.' + file.ext;
              return '<a class="review-download-chip" href="' + escapeHtml(getReviewWriterDownloadUrl(job, file.format)) + '" download="' + escapeHtml(filename) + '" target="_blank" rel="noopener">' +
                uiIcon('fileText', 'sm') +
                '<span>' + escapeHtml(file.label) + '</span>' +
                '<span class="review-download-meta">.' + escapeHtml(file.ext) + '</span>' +
              '</a>';
            }).join('') +
          '</div>' +
        '</div>';
    }

    function renderReviewWriterFinalMessage(job) {
      var profile = getProjectWritingProfile(job && job.writingProfileId);
      var result = job && job.result ? job.result : {};
      var outline = result.outline || {};
      var content = String(result.content || '');
      var sections = Array.isArray(outline.sections) ? outline.sections : [];
      var preview = escapeHtml(content.slice(0, 9000));
      if (content.length > 9000) {
        preview += '\n\n...';
      }
      return '' +
        '<div class="review-home-card">' +
          '<div class="review-progress-head">' +
            '<div class="review-progress-title">' + uiIcon('edit', 'sm') + '<span>' + escapeHtml(profile.oneClickTitle || '一键写作') + '已生成</span></div>' +
            '<div class="review-progress-percent">已完成 · 100%</div>' +
          '</div>' +
          '<div class="review-metric-grid">' +
            '<div class="review-metric"><div class="review-metric-value">' + escapeHtml(String(result.totalSentences || 0)) + '</div><div class="review-metric-label">完成句子</div></div>' +
            '<div class="review-metric"><div class="review-metric-value">' + escapeHtml(String(result.referenceCount || 0)) + '</div><div class="review-metric-label">参考证据</div></div>' +
            '<div class="review-metric"><div class="review-metric-value">' + escapeHtml(String(sections.length || 0)) + '</div><div class="review-metric-label">章节</div></div>' +
          '</div>' +
          '<div class="review-output"><strong>正文预览：</strong><pre>' + preview + '</pre></div>' +
        '</div>' +
        renderReviewWriterDownloadAttachments(job);
    }

    function buildReviewWriterProgressHtml(job, typedId) {
      var profile = getProjectWritingProfile(job && job.writingProfileId);
      var percent = Math.max(0, Math.min(100, Math.round(job.progress || 0)));
      var logs = (job.logs || []).slice(-6).map(function(line) {
        return '<div>' + escapeHtml(line) + '</div>';
      }).join('');
      var statusLabel = job.status === 'completed'
        ? '已完成'
        : (job.status === 'error'
          ? '失败'
          : (job.status === 'stopped'
            ? '已停止'
            : (job.stopRequested ? '停止中' : '进行中')));
      return '' +
        '<div class="review-home-card">' +
          '<div class="review-progress-head">' +
            '<div class="review-progress-title">' + uiIcon('edit', 'sm') + '<span>' + escapeHtml(job.topic || profile.oneClickTitle) + '</span></div>' +
            '<div class="review-progress-percent">' + statusLabel + ' · ' + percent + '%</div>' +
          '</div>' +
          '<div class="review-progress-bar"><div class="review-progress-fill" style="width:' + percent + '%;"></div></div>' +
          '<div class="review-type-line" id="' + typedId + '"></div>' +
          (logs ? '<div class="review-log-list">' + logs + '</div>' : '') +
        '</div>' +
        renderReviewWriterDownloadAttachments(job);
    }

    function updateReviewWriterControls(job) {
      var profile = getProjectWritingProfile(job && job.writingProfileId);
      var generateBtn = document.getElementById('reviewWriterGenerateBtn');
      var stopBtn = document.getElementById('reviewWriterStopBtn');
      var restartBtn = document.getElementById('reviewWriterRestartBtn');
      var downloadBtn = document.getElementById('reviewWriterDownloadBtn');
      var copyBtn = document.getElementById('reviewWriterCopyBtn');
      var status = job && job.status;
      var isActive = status === 'queued' || status === 'running';
      if (stopBtn) stopBtn.disabled = !job || !isActive || !!job.stopRequested;
      if (restartBtn) restartBtn.disabled = !(job && job.jobId);
      if (generateBtn) {
        generateBtn.disabled = !!isActive;
        generateBtn.textContent = isActive ? '写作中' : (job ? '新建任务' : profile.oneClickAction);
      }
      if (downloadBtn) downloadBtn.disabled = !(job && job.status === 'completed' && job.result);
      if (copyBtn) copyBtn.disabled = !(job && job.status === 'completed' && job.result);
    }

    function ensureReviewWriterHomeProgress() {
      if (!messagesDiv) return null;
      if (emptyState) emptyState.style.display = 'none';
      var div = document.getElementById('reviewWriterHomeProgress');
      if (!div) {
        div = document.createElement('div');
        div.id = 'reviewWriterHomeProgress';
        div.className = 'message bot';
        div.innerHTML = '<div class="avatar bot">' + getMessageAvatarHtml('bot') + '</div><div class="content"></div>';
        messagesDiv.appendChild(div);
      }
      return div.querySelector('.content');
    }

    function renderReviewWriterJob(job) {
      if (!job) return;
      reviewWriterLastJobId = job.jobId || reviewWriterLastJobId;
      if (reviewWriterLastJobId) localStorage.setItem('scholar_review_writer_last_job', reviewWriterLastJobId);
      updateReviewWriterControls(job);
      var statusType = job.status === 'error' ? 'error' : ((job.status === 'completed' || job.status === 'stopped') ? 'success' : 'working');
      var dialogStatus = document.getElementById('reviewWriterStatus');
      if (dialogStatus) {
        setReviewWriterStatus(buildReviewWriterProgressHtml(job, 'reviewWriterDialogTyped'), statusType);
        typeReviewWriterLine('reviewWriterDialogTyped', job.message || '');
      }

      var homeContent = ensureReviewWriterHomeProgress();
      if (homeContent) {
        homeContent.innerHTML = buildReviewWriterProgressHtml(job, 'reviewWriterHomeTyped');
        typeReviewWriterLine('reviewWriterHomeTyped', job.message || '');
        maybeScrollChatToBottom();
      }

      if (job.status === 'completed' && job.result) {
        var profile = getProjectWritingProfile(job.writingProfileId);
        reviewWriterLastResult = job.result;
        reviewWriterActiveJobId = '';
        localStorage.removeItem('scholar_review_writer_job');
        var downloadBtn = document.getElementById('reviewWriterDownloadBtn');
        var copyBtn = document.getElementById('reviewWriterCopyBtn');
        var generateBtn = document.getElementById('reviewWriterGenerateBtn');
        if (downloadBtn) downloadBtn.disabled = false;
        if (copyBtn) copyBtn.disabled = false;
        if (generateBtn) {
          generateBtn.disabled = false;
          generateBtn.textContent = '重新' + profile.shortLabel;
        }
        if (!reviewWriterFinalMessageAppended) {
          reviewWriterFinalMessageAppended = true;
          appendMessage(renderReviewWriterFinalMessage(job), 'bot', true);
        }
      } else if (job.status === 'error' || job.status === 'stopped') {
        reviewWriterActiveJobId = '';
        localStorage.removeItem('scholar_review_writer_job');
        var generateBtnError = document.getElementById('reviewWriterGenerateBtn');
        if (generateBtnError) {
          generateBtnError.disabled = false;
          generateBtnError.textContent = '新建任务';
        }
      }
    }

    function renderReviewWriterResult(result) {
      var profile = getProjectWritingProfile(result && result.writingProfileId);
      var labels = getProjectUiLabels(profile.id);
      var outline = result.outline || {};
      var sections = outline.sections || [];
      var sectionNames = sections.map(function(section, index) {
        return (index + 1) + '. ' + escapeHtml(section.title || '未命名章节');
      }).join('<br>');
      var warnings = (result.warnings || []).map(function(item) {
        return '- ' + escapeHtml(item);
      }).join('<br>');
      var preview = escapeHtml((result.content || '').slice(0, 14000));
      if ((result.content || '').length > 14000) {
        preview += '\n\n...';
      }
      setReviewWriterStatus(
        '<strong>已生成：</strong>' + escapeHtml(outline.title || labels.draft) + '<br>' +
        '<div class="review-metric-grid">' +
          '<div class="review-metric"><div class="review-metric-value">' + (result.totalSentences || 0) + '</div><div class="review-metric-label">完成句子</div></div>' +
          '<div class="review-metric"><div class="review-metric-value">' + (result.referenceCount || 0) + '</div><div class="review-metric-label">参考证据</div></div>' +
          '<div class="review-metric"><div class="review-metric-value">' + sections.length + '</div><div class="review-metric-label">章节</div></div>' +
        '</div>' +
        '<strong>提纲：</strong><br>' + sectionNames +
        (warnings ? '<br><br><strong>检索提示：</strong><br>' + warnings : '') +
        '<div class="review-output"><strong>正文预览：</strong><pre>' + preview + '</pre></div>',
        'success'
      );
      var downloadBtn = document.getElementById('reviewWriterDownloadBtn');
      var copyBtn = document.getElementById('reviewWriterCopyBtn');
      if (downloadBtn) downloadBtn.disabled = false;
      if (copyBtn) copyBtn.disabled = false;
    }

    async function generateReviewWriter() {
      var profile = getProjectWritingProfile();
      var labels = getProjectUiLabels(profile.id);
      var topic = (document.getElementById('reviewWriterTopic')?.value || '').trim();
      var userRequirements = (document.getElementById('reviewWriterRequirements')?.value || '').trim();
      var useAutoResearchContext = document.getElementById('reviewWriterUseAutoResearch') ? !!document.getElementById('reviewWriterUseAutoResearch').checked : true;
      var wordCountRaw = (document.getElementById('reviewWriterWordCount')?.value || '').trim();
      var wordCount = wordCountRaw ? Number(wordCountRaw) : 4000;
      var referenceFormat = (document.getElementById('reviewWriterReferenceFormat')?.value || '').trim();
      var citationStyle = (document.getElementById('reviewWriterCitationStyle')?.value || 'authorYear').trim();
      var customCitationFormat = (document.getElementById('reviewWriterCitationCustom')?.value || '').trim();
      var useCodexCli = document.getElementById('reviewWriterUseCodexCli') ? !!document.getElementById('reviewWriterUseCodexCli').checked : true;
      var useLongTermMemory = !!document.getElementById('reviewWriterUseLongMemory')?.checked;
      var useExperimentMaterials = !!document.getElementById('reviewWriterUseExperimentMaterials')?.checked;
      var journalStyleIds = getReviewWriterSelectedJournalStyleIds();
      var generateBtn = document.getElementById('reviewWriterGenerateBtn');
      if (!topic && !useAutoResearchContext) {
        setReviewWriterStatus('请先填写' + escapeHtml(profile.topicLabel) + '，或勾选“使用 Auto Research 结果”', 'error');
        return;
      }
      if (!Number.isFinite(wordCount) || wordCount < 800 || wordCount > 20000) {
        setReviewWriterStatus('目标字数请填写 800 到 20000 之间的数字', 'error');
        return;
      }
      if (citationStyle === 'custom' && !customCitationFormat) {
        setReviewWriterStatus('请选择“其他/自定义”文中引用格式后，填写想要的格式', 'error');
        return;
      }
      loadApiConfig();
      if (!apiConfig.url || !apiConfig.key) {
        setReviewWriterStatus('请先在“配置”里填写可用的 AI API', 'error');
        return;
      }

      reviewWriterLastResult = null;
      reviewWriterFinalMessageAppended = false;
      if (generateBtn) {
        generateBtn.disabled = true;
        generateBtn.textContent = '启动中';
      }
      var downloadBtn = document.getElementById('reviewWriterDownloadBtn');
      var copyBtn = document.getElementById('reviewWriterCopyBtn');
      var stopBtn = document.getElementById('reviewWriterStopBtn');
      var restartBtn = document.getElementById('reviewWriterRestartBtn');
      if (downloadBtn) downloadBtn.disabled = true;
      if (copyBtn) copyBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = true;
      if (restartBtn) restartBtn.disabled = true;

      setReviewWriterStatus(
        '正在启动后台任务...\n\n项目主题：' + escapeHtml(profile.label) + '\n' + escapeHtml(profile.topicLabel) + '：' + escapeHtml(topic || '由 Auto Research 自动补齐') + (userRequirements ? '\n' + escapeHtml(profile.requirementLabel) + '：' + escapeHtml(userRequirements) : '') + '\n目标字数：' + (wordCountRaw ? wordCount : '默认 4000') + '\n结构：由 AI 自动决定\n' + escapeHtml(labels.styleGroup) + '：' + (journalStyleIds.length ? '已选择 ' + journalStyleIds.length + ' 个' : labels.styleAuto) + '\n文中引用：' + escapeHtml(citationStyle === 'custom' ? customCitationFormat : (citationStyle === 'numeric' ? '[1]' : '(Zhang et al., 2026)')) + '\n参考/来源格式：' + (referenceFormat ? '按用户输入的格式生成' : '使用默认格式') + '\nCodex CLI：' + (useCodexCli ? '优先使用，失败自动降级小牛马' : '不启用，直接使用小牛马') + '\n长期记忆：' + (useLongTermMemory ? '启用，按当前章节/句子选取相关片段' : '不启用') + '\n' + escapeHtml(labels.materialEnabledLabel) + '：' + (useExperimentMaterials ? '启用，按当前章节/句子选取相关片段' : '不启用') + '\nAuto Research：' + (useAutoResearchContext ? '启用，调用最新报告/论文蓝图/Wiki/审计/证据对象/草稿' : '不启用'),
        'working'
      );

      try {
        var reviewWriterWorkspace = typeof loadWorkspaceDirectorySetting === 'function'
          ? loadWorkspaceDirectorySetting(currentConversationId)
          : null;
        var response = await fetch('/api/review-writer/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            writingProfileId: profile.id,
            topic: topic,
            userRequirements: userRequirements,
            apiUrl: apiConfig.url,
            apiKey: apiConfig.key,
            model: currentModel,
            wordCount: wordCount,
            language: 'en',
            topK: 20,
            referenceFormat: referenceFormat,
            citationStyle: citationStyle,
            customCitationFormat: customCitationFormat,
            journalStyleIds: journalStyleIds,
            useCodexCli: useCodexCli,
            useLongTermMemory: useLongTermMemory,
            useExperimentMaterials: useExperimentMaterials,
            useAutoResearchContext: useAutoResearchContext,
            projectRoot: reviewWriterWorkspace
              && reviewWriterWorkspace.enabled
              && reviewWriterWorkspace.permission !== 'read-only'
              ? String(reviewWriterWorkspace.path || '').trim()
              : ''
          })
        });
        var result = await response.json();
        if (!result.success) {
          throw new Error(result.error || profile.shortLabel + '任务启动失败');
        }
        reviewWriterActiveJobId = result.job.jobId;
        reviewWriterLastJobId = result.job.jobId;
        localStorage.setItem('scholar_review_writer_job', reviewWriterActiveJobId);
        localStorage.setItem('scholar_review_writer_last_job', reviewWriterLastJobId);
        renderReviewWriterJob(result.job);
        beginReviewWriterPolling(reviewWriterActiveJobId);
      } catch (e) {
        setReviewWriterStatus('生成失败：' + escapeHtml(e.message), 'error');
        if (generateBtn) {
          generateBtn.disabled = false;
          generateBtn.textContent = profile.oneClickAction;
        }
      }
    }
    window.generateReviewWriter = generateReviewWriter;

    async function stopReviewWriterJob() {
      var jobId = reviewWriterActiveJobId || reviewWriterLastJobId;
      if (!jobId) {
        setReviewWriterStatus('没有可停止的一键写作任务', 'error');
        return;
      }
      var stopBtn = document.getElementById('reviewWriterStopBtn');
      if (stopBtn) {
        stopBtn.disabled = true;
        stopBtn.textContent = '停止中';
      }
      try {
        var response = await fetch('/api/review-writer/stop/' + encodeURIComponent(jobId), { method: 'POST' });
        var result = await response.json();
        if (!result.success) {
          throw new Error(result.error || '停止任务失败');
        }
        renderReviewWriterJob(result.job);
        beginReviewWriterPolling(jobId);
      } catch (e) {
        setReviewWriterStatus('停止失败：' + escapeHtml(e.message), 'error');
      } finally {
        if (stopBtn) stopBtn.textContent = '停止';
      }
    }
    window.stopReviewWriterJob = stopReviewWriterJob;

    async function restartReviewWriterJob() {
      var jobId = reviewWriterLastJobId || reviewWriterActiveJobId;
      if (!jobId) {
        setReviewWriterStatus('没有可重启的一键写作任务', 'error');
        return;
      }
      var restartBtn = document.getElementById('reviewWriterRestartBtn');
      if (restartBtn) {
        restartBtn.disabled = true;
        restartBtn.textContent = '重启中';
      }
      try {
        var response = await fetch('/api/review-writer/restart/' + encodeURIComponent(jobId), { method: 'POST' });
        var result = await response.json();
        if (!result.success) {
          throw new Error(result.error || '重启任务失败');
        }
        reviewWriterLastResult = null;
        reviewWriterFinalMessageAppended = false;
        reviewWriterActiveJobId = result.job.jobId;
        reviewWriterLastJobId = result.job.jobId;
        localStorage.setItem('scholar_review_writer_job', reviewWriterActiveJobId);
        localStorage.setItem('scholar_review_writer_last_job', reviewWriterLastJobId);
        renderReviewWriterJob(result.job);
        beginReviewWriterPolling(reviewWriterActiveJobId);
      } catch (e) {
        setReviewWriterStatus('重启失败：' + escapeHtml(e.message), 'error');
      } finally {
        if (restartBtn) restartBtn.textContent = '重启';
      }
    }
    window.restartReviewWriterJob = restartReviewWriterJob;

    function beginReviewWriterPolling(jobId) {
      if (!jobId) return;
      reviewWriterActiveJobId = jobId;
      localStorage.setItem('scholar_review_writer_job', jobId);
      if (reviewWriterPollTimer) {
        clearInterval(reviewWriterPollTimer);
      }
      pollReviewWriterJob();
      reviewWriterPollTimer = setInterval(pollReviewWriterJob, 1500);
    }

    async function pollReviewWriterJob() {
      if (!reviewWriterActiveJobId) return;
      try {
        var response = await fetch('/api/review-writer/progress/' + encodeURIComponent(reviewWriterActiveJobId));
        var result = await response.json();
        if (!result.success) {
          throw new Error(result.error || '获取写作进度失败');
        }
        var job = result.job;
        renderReviewWriterJob(job);
        if (job.status === 'completed' || job.status === 'error' || job.status === 'stopped') {
          if (reviewWriterPollTimer) {
            clearInterval(reviewWriterPollTimer);
            reviewWriterPollTimer = null;
          }
        }
      } catch (e) {
        var profile = getProjectWritingProfile();
        var fallbackJob = {
          jobId: reviewWriterActiveJobId,
          topic: profile.oneClickTitle,
          status: 'error',
          progress: 0,
          message: '进度同步失败：' + e.message,
          logs: []
        };
        renderReviewWriterJob(fallbackJob);
        if (reviewWriterPollTimer) {
          clearInterval(reviewWriterPollTimer);
          reviewWriterPollTimer = null;
        }
      }
    }
    window.pollReviewWriterJob = pollReviewWriterJob;

    async function resumeReviewWriterProgress() {
      if (reviewWriterActiveJobId) {
        beginReviewWriterPolling(reviewWriterActiveJobId);
        return;
      }
      try {
        var response = await fetch('/api/review-writer/latest?userId=' + encodeURIComponent(currentUserId));
        var result = await response.json();
        if (result.success && result.job && ['queued', 'running', 'stopped', 'error'].indexOf(result.job.status) >= 0) {
          reviewWriterActiveJobId = result.job.jobId;
          reviewWriterLastJobId = result.job.jobId;
          localStorage.setItem('scholar_review_writer_last_job', reviewWriterLastJobId);
          if (result.job.status === 'queued' || result.job.status === 'running') {
            localStorage.setItem('scholar_review_writer_job', reviewWriterActiveJobId);
          }
          renderReviewWriterJob(result.job);
          if (result.job.status === 'queued' || result.job.status === 'running') {
            beginReviewWriterPolling(reviewWriterActiveJobId);
          }
        }
      } catch (e) {
        console.warn('[ReviewWriter] Resume progress failed:', e);
      }
    }

    async function downloadReviewWriterDocx() {
      var labels = getProjectUiLabels(reviewWriterLastResult && reviewWriterLastResult.writingProfileId);
      if (!reviewWriterLastResult || !reviewWriterLastResult.content) {
        setReviewWriterStatus('没有可导出的' + labels.draft + '内容', 'error');
        return;
      }
      var btn = document.getElementById('reviewWriterDownloadBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '导出中';
      }
      try {
        var response = await fetch('/api/review-writer/docx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: reviewWriterLastResult.content })
        });
        if (!response.ok) {
          var errorText = await response.text();
          throw new Error(errorText || '导出失败');
        }
        var blob = await response.blob();
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = labels.draft + '.docx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        setReviewWriterStatus('Word 导出失败：' + escapeHtml(e.message), 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '导出Word';
        }
      }
    }
    window.downloadReviewWriterDocx = downloadReviewWriterDocx;

    async function copyReviewWriterContent() {
      var labels = getProjectUiLabels(reviewWriterLastResult && reviewWriterLastResult.writingProfileId);
      if (!reviewWriterLastResult || !reviewWriterLastResult.content) {
        setReviewWriterStatus('没有可复制的' + labels.draft + '内容', 'error');
        return;
      }
      var btn = document.getElementById('reviewWriterCopyBtn');
      try {
        await navigator.clipboard.writeText(reviewWriterLastResult.content);
        if (btn) {
          btn.textContent = '已复制';
          setTimeout(function() { btn.textContent = '复制'; }, 1600);
        }
      } catch (e) {
        setReviewWriterStatus('复制失败：' + escapeHtml(e.message), 'error');
      }
    }
    window.copyReviewWriterContent = copyReviewWriterContent;

    setTimeout(resumeReviewWriterProgress, 600);

    // ============ 数据分析功能 ============
    var dataAnalysisStructure = null;
    var dataAnalysisLastResult = null;
    var dataAnalysisPlotLink = null;
    var DATA_ANALYSIS_METHODS = [
      { id: 'descriptive', group: 'overview', badge: '本地统计', name: '描述性统计', desc: '均值、标准差、分位数、频数和缺失值概览' },
      { id: 'visualization', group: 'overview', badge: '图形建议', name: '图表建议', desc: '根据字段类型推荐适合图表' },
      { id: 'normality', group: 'diagnostics', badge: 'R代码', name: '正态性检验', desc: 'Shapiro-Wilk、QQ 图和分布诊断' },
      { id: 'variance_homogeneity', group: 'diagnostics', badge: 'R代码', name: '方差齐性检验', desc: 'Levene/Bartlett 方差齐性诊断' },
      { id: 'independent_t', group: 'comparison', badge: '本地统计', name: '独立样本 t 检验', desc: '比较两个独立组的连续变量均值差异' },
      { id: 'paired_t', group: 'comparison', badge: '本地统计', name: '配对样本 t 检验', desc: '比较两个配对连续变量的均值差异' },
      { id: 'anova', group: 'comparison', badge: '本地统计', name: '单因素方差分析', desc: '比较三个及以上组别的均值差异' },
      { id: 'nonparametric', group: 'comparison', badge: 'R代码', name: '非参数检验', desc: 'Mann-Whitney、Wilcoxon 或 Kruskal-Wallis' },
      { id: 'two_way_anova', group: 'comparison', badge: 'R代码', name: '双因素方差分析', desc: '两个因素及交互作用' },
      { id: 'correlation', group: 'relationship', badge: '本地统计', name: '相关分析', desc: 'Pearson 和 Spearman 相关' },
      { id: 'regression', group: 'relationship', badge: '本地统计', name: '线性回归', desc: '连续因变量和一个或多个连续自变量' },
      { id: 'chi_square', group: 'relationship', badge: '本地统计', name: '卡方检验', desc: '两个分类变量之间的关联' },
      { id: 'pca', group: 'advanced', badge: 'R代码', name: '主成分分析 PCA', desc: '降维、载荷和样本得分图' },
      { id: 'cluster', group: 'advanced', badge: 'R代码', name: '聚类分析', desc: '层次聚类或 K-means' },
      { id: 'mixed_effects', group: 'advanced', badge: 'R代码', name: '混合效应模型', desc: '随机效应/嵌套设计' },
      { id: 'survival', group: 'advanced', badge: 'R代码', name: '生存分析', desc: 'Kaplan-Meier 或 Cox 模型' }
    ];
    var DATA_ANALYSIS_METHOD_GROUPS = [
      { id: 'overview', name: '基础概览', hint: '先看数据结构' },
      { id: 'diagnostics', name: '前提诊断', hint: '正态性 / 方差' },
      { id: 'comparison', name: '组间比较', hint: '均值、秩和、方差' },
      { id: 'relationship', name: '关系与模型', hint: '相关、回归、关联' },
      { id: 'advanced', name: '高级分析', hint: '多变量 / 模型' }
    ];

    function renderDataAnalysisMethodCards() {
      return DATA_ANALYSIS_METHOD_GROUPS.map(function(group) {
        var methods = DATA_ANALYSIS_METHODS.filter(function(method) { return method.group === group.id; });
        if (!methods.length) return '';
        var cards = methods.map(function(method) {
          var checked = method.id === 'descriptive' ? ' checked' : '';
          return '' +
            '<label class="da-method-option" for="daMethod_' + escapeHtml(method.id) + '">' +
              '<input id="daMethod_' + escapeHtml(method.id) + '" type="checkbox" name="dataAnalysisMethods" value="' + escapeHtml(method.id) + '"' + checked + ' onchange="updateDataAnalysisControls()">' +
              '<span class="da-method-card-body">' +
                '<span class="da-method-name"><span class="da-method-check"></span>' + escapeHtml(method.name) + '</span>' +
                '<span class="da-method-desc">' + escapeHtml(method.desc) + '</span>' +
                '<span class="da-method-badge">' + escapeHtml(method.badge || '') + '</span>' +
              '</span>' +
            '</label>';
        }).join('');
        return '' +
          '<div class="da-method-group">' +
            '<div class="da-method-group-title"><span>' + escapeHtml(group.name) + '</span><span>' + escapeHtml(group.hint) + '</span></div>' +
            '<div class="da-method-grid">' + cards + '</div>' +
          '</div>';
      }).join('');
    }

    var sentenceClaimReferenceFormat = '';
    try {
      sentenceClaimReferenceFormat = localStorage.getItem('sentenceClaimReferenceFormat') || '';
    } catch (e) {
      sentenceClaimReferenceFormat = '';
    }

    function showSentenceClaimSearchDialog() {
      var html = '' +
        '<div style="height:100%;min-height:0;display:flex;flex-direction:column;gap:12px;overflow:hidden;">' +
          '<section id="sentenceClaimSearchResult" style="flex:1 1 auto;min-height:0;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:14px;overflow:auto;">' +
            '<div style="height:100%;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--text-secondary);font-size:13px;">' +
              '<div>' +
                '<div style="font-size:16px;font-weight:850;color:var(--text-primary);margin-bottom:6px;">句子级论点检索</div>' +
                '<div style="line-height:1.7;">输入一句需要参考文献支撑的论点，系统会在上方展示可追溯证据。</div>' +
              '</div>' +
            '</div>' +
          '</section>' +
          '<section class="sentence-claim-composer-shell">' +
            '<div class="sentence-claim-reference-format-row">' +
              '<button type="button" class="sentence-claim-reference-format-trigger" onclick="toggleSentenceClaimReferenceFormatPanel()" title="设置目标期刊参考文献尾注格式">' +
                '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="16" rx="2"></rect><path d="M8 8h8"></path><path d="M8 12h8"></path><path d="M8 16h5"></path></svg>' +
                '<span>目标期刊参考文献尾注格式</span>' +
                '<span id="sentenceClaimReferenceFormatState" class="sentence-claim-reference-format-state">未设置</span>' +
              '</button>' +
            '</div>' +
            '<div id="sentenceClaimReferenceFormatPanel" class="sentence-claim-reference-format-panel">' +
              '<textarea id="sentenceClaimReferenceFormatInput" placeholder="粘贴目标期刊 Reference / References 格式或示例。例如：Author(s). Year. Title. Journal Volume(Issue): Pages. DOI；也可使用 {authors} {year} {title} {journal} {doi} 等占位符。"></textarea>' +
              '<div class="sentence-claim-reference-format-actions">' +
                '<button type="button" onclick="clearSentenceClaimReferenceFormat()">清空</button>' +
                '<button type="button" onclick="saveSentenceClaimReferenceFormat()">保存格式</button>' +
              '</div>' +
            '</div>' +
            '<div class="input-area-container sentence-claim-input-area">' +
              '<button type="button" class="upload-experiment-btn" onclick="focusSentenceClaimSearchInput()" title="输入或粘贴论点" aria-label="输入或粘贴论点">' +
                '<svg class="ui-icon md" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>' +
              '</button>' +
              '<textarea id="sentenceClaimSearchInput" class="chat-input" rows="1" autocomplete="off" placeholder=" " oninput="autoResizeSentenceClaimSearchInput(this)" onkeydown="handleSentenceClaimInputKeydown(event)"></textarea>' +
              '<div class="chat-placeholder">输入需要参考文献支撑的句子或论点</div>' +
              '<div class="composer-actions">' +
                '<input type="hidden" id="sentenceClaimTopK" value="5">' +
                '<div class="composer-provider-selector" id="sentenceClaimTopKSelector">' +
                  '<button type="button" class="composer-provider-btn" onclick="toggleSentenceClaimTopKMenu(event)" title="返回数量">' +
                    '<span id="sentenceClaimTopKLabel">返回 5</span>' +
                    '<svg class="ui-icon sm" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
                  '</button>' +
                  '<div class="composer-provider-menu" id="sentenceClaimTopKMenu" role="menu" aria-label="返回数量">' +
                    '<button type="button" class="composer-provider-option active" data-value="5" onclick="setSentenceClaimTopK(5)" role="menuitem" aria-selected="true"><span>返回 5</span><span class="composer-provider-option-check">✓</span></button>' +
                    '<button type="button" class="composer-provider-option" data-value="8" onclick="setSentenceClaimTopK(8)" role="menuitem" aria-selected="false"><span>返回 8</span><span class="composer-provider-option-check">✓</span></button>' +
                    '<button type="button" class="composer-provider-option" data-value="10" onclick="setSentenceClaimTopK(10)" role="menuitem" aria-selected="false"><span>返回 10</span><span class="composer-provider-option-check">✓</span></button>' +
                    '<button type="button" class="composer-provider-option" data-value="15" onclick="setSentenceClaimTopK(15)" role="menuitem" aria-selected="false"><span>返回 15</span><span class="composer-provider-option-check">✓</span></button>' +
                  '</div>' +
                '</div>' +
                '<button id="sentenceClaimSearchBtn" class="send-btn" type="button" onclick="runSentenceClaimSearch()" title="检索" aria-label="检索">' +
                  '<svg class="sentence-claim-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16.5 16.5 4 4"></path></svg>' +
                '</button>' +
              '</div>' +
            '</div>' +
          '</section>' +
        '</div>';
      showModal('快速句子级论点检索', html, true, true);
      setTimeout(function() {
        initSentenceClaimReferenceFormatUi();
        var input = document.getElementById('sentenceClaimSearchInput');
        if (input) {
          autoResizeSentenceClaimSearchInput(input);
          input.focus();
        }
      }, 50);
    }
    window.showSentenceClaimSearchDialog = showSentenceClaimSearchDialog;

    function focusSentenceClaimSearchInput() {
      var input = document.getElementById('sentenceClaimSearchInput');
      if (input) {
        input.focus();
        autoResizeSentenceClaimSearchInput(input);
      }
    }
    window.focusSentenceClaimSearchInput = focusSentenceClaimSearchInput;

    function initSentenceClaimReferenceFormatUi() {
      var input = document.getElementById('sentenceClaimReferenceFormatInput');
      var state = document.getElementById('sentenceClaimReferenceFormatState');
      if (input) input.value = sentenceClaimReferenceFormat || '';
      if (state) state.textContent = sentenceClaimReferenceFormat ? '已设置' : '未设置';
    }

    function toggleSentenceClaimReferenceFormatPanel() {
      var panel = document.getElementById('sentenceClaimReferenceFormatPanel');
      if (!panel) return;
      panel.classList.toggle('open');
      initSentenceClaimReferenceFormatUi();
      if (panel.classList.contains('open')) {
        var input = document.getElementById('sentenceClaimReferenceFormatInput');
        if (input) input.focus();
      }
    }
    window.toggleSentenceClaimReferenceFormatPanel = toggleSentenceClaimReferenceFormatPanel;

    function saveSentenceClaimReferenceFormat() {
      var input = document.getElementById('sentenceClaimReferenceFormatInput');
      sentenceClaimReferenceFormat = (input && input.value ? input.value : '').trim();
      try {
        if (sentenceClaimReferenceFormat) {
          localStorage.setItem('sentenceClaimReferenceFormat', sentenceClaimReferenceFormat);
        } else {
          localStorage.removeItem('sentenceClaimReferenceFormat');
        }
      } catch (e) {}
      initSentenceClaimReferenceFormatUi();
      var panel = document.getElementById('sentenceClaimReferenceFormatPanel');
      if (panel) panel.classList.remove('open');
      focusSentenceClaimSearchInput();
    }
    window.saveSentenceClaimReferenceFormat = saveSentenceClaimReferenceFormat;

    function clearSentenceClaimReferenceFormat() {
      sentenceClaimReferenceFormat = '';
      try { localStorage.removeItem('sentenceClaimReferenceFormat'); } catch (e) {}
      initSentenceClaimReferenceFormatUi();
      focusSentenceClaimSearchInput();
    }
    window.clearSentenceClaimReferenceFormat = clearSentenceClaimReferenceFormat;

    function closeSentenceClaimTopKMenu() {
      var selector = document.getElementById('sentenceClaimTopKSelector');
      if (selector) selector.classList.remove('open');
    }

    function toggleSentenceClaimTopKMenu(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      var selector = document.getElementById('sentenceClaimTopKSelector');
      if (!selector) return;
      selector.classList.toggle('open');
    }
    window.toggleSentenceClaimTopKMenu = toggleSentenceClaimTopKMenu;

    function setSentenceClaimTopK(value) {
      var normalized = String(value || 5);
      var input = document.getElementById('sentenceClaimTopK');
      var label = document.getElementById('sentenceClaimTopKLabel');
      var selector = document.getElementById('sentenceClaimTopKSelector');
      if (input) input.value = normalized;
      if (label) label.textContent = '返回 ' + normalized;
      if (selector) {
        Array.prototype.slice.call(selector.querySelectorAll('.composer-provider-option')).forEach(function(option) {
          var active = option.getAttribute('data-value') === normalized;
          option.classList.toggle('active', active);
          option.setAttribute('aria-selected', active ? 'true' : 'false');
        });
      }
      closeSentenceClaimTopKMenu();
      focusSentenceClaimSearchInput();
    }
    window.setSentenceClaimTopK = setSentenceClaimTopK;

    document.addEventListener('click', function(event) {
      var selector = document.getElementById('sentenceClaimTopKSelector');
      if (selector && !selector.contains(event.target)) closeSentenceClaimTopKMenu();
    });

    function autoResizeSentenceClaimSearchInput(input) {
      if (!input) return;
      var maxHeight = 128;
      input.style.height = 'auto';
      var nextHeight = Math.min(maxHeight, Math.max(22, input.scrollHeight));
      input.style.height = nextHeight + 'px';
      input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
    window.autoResizeSentenceClaimSearchInput = autoResizeSentenceClaimSearchInput;

    function handleSentenceClaimInputKeydown(event) {
      if (!event) return;
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        runSentenceClaimSearch();
      }
    }
    window.handleSentenceClaimInputKeydown = handleSentenceClaimInputKeydown;

    function fillSentenceClaimSearchExample(text) {
      var input = document.getElementById('sentenceClaimSearchInput');
      if (input) {
        input.value = text;
        autoResizeSentenceClaimSearchInput(input);
      }
    }
    window.fillSentenceClaimSearchExample = fillSentenceClaimSearchExample;

    function formatSentenceClaimScore(value) {
      var score = Number(value || 0);
      return Number.isFinite(score) ? score.toFixed(3) : '0.000';
    }

    function getSentenceClaimSupportMeta(support) {
      var relation = support && support.relation ? String(support.relation) : 'unchecked';
      var map = {
        supports: { label: '支持', color: '#15803d', bg: 'transparent', border: '#16a34a', softBg: 'var(--bg-primary)', softColor: '#15803d' },
        contradicts: { label: '相反', color: '#dc2626', bg: 'transparent', border: '#dc2626', softBg: 'var(--bg-primary)', softColor: '#dc2626' },
        related: { label: '仅相关', color: '#d97706', bg: 'transparent', border: '#d97706', softBg: 'var(--bg-primary)', softColor: '#d97706' },
        irrelevant: { label: '无关', color: '#4b5563', bg: 'transparent', border: '#6b7280', softBg: 'var(--bg-primary)', softColor: '#4b5563' },
        unchecked: { label: '未核查', color: '#475569', bg: 'transparent', border: '#64748b', softBg: 'var(--bg-primary)', softColor: '#475569' }
      };
      return map[relation] || map.unchecked;
    }

    function renderSentenceClaimSupportSummary(counts, checked, sectionId, sticky, hiddenLowQualityCount) {
      if (!counts) return '';
      var containerStyle = sticky
        ? 'position:sticky;top:-14px;z-index:20;display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 -14px 8px -14px;padding:8px 24px;border:1px solid var(--border-color);border-top:0;border-radius:0 0 8px 8px;background:var(--bg-primary);box-shadow:0 8px 18px rgba(15,23,42,0.10);'
        : 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;';
      var items = [
        ['supports', '支持', counts.supports || 0, getSentenceClaimSupportMeta({ relation: 'supports' })],
        ['contradicts', '相反', counts.contradicts || 0, getSentenceClaimSupportMeta({ relation: 'contradicts' })],
        ['related', '仅相关', counts.related || 0, getSentenceClaimSupportMeta({ relation: 'related' })],
        ['irrelevant', '无关', counts.irrelevant || 0, getSentenceClaimSupportMeta({ relation: 'irrelevant' })],
        ['unchecked', '未核查', counts.unchecked || 0, getSentenceClaimSupportMeta({ relation: 'unchecked' })]
      ];
      return '<div style="' + containerStyle + '">' +
        '<span style="font-size:11px;color:var(--text-secondary);align-self:center;">证据判断：' + (checked ? '已执行' : '未执行') + '</span>' +
        '<button type="button" data-claim-filter-chip="1" data-claim-relation-filter="all" onclick="filterSentenceClaimPapers(\'' + escapeHtml(sectionId || '') + '\', \'all\')" class="sentence-claim-filter-chip" style="color:#0f766e;">全部</button>' +
        items.map(function(item) {
          var relation = item[0];
          var label = item[1];
          var count = item[2];
          var meta = item[3];
          if (!count) return '';
          if (relation === 'irrelevant') {
            return '<span data-claim-filter-chip="1" data-claim-relation-filter="' + escapeHtml(relation) + '" title="无关文献已隐藏，不进入结果列表" class="sentence-claim-filter-chip is-static" style="color:' + meta.color + ';">' + escapeHtml(label) + ' ' + escapeHtml(count) + '（已隐藏）</span>';
          }
          return '<button type="button" data-claim-filter-chip="1" data-claim-relation-filter="' + escapeHtml(relation) + '" onclick="filterSentenceClaimPapers(\'' + escapeHtml(sectionId || '') + '\', \'' + escapeHtml(relation) + '\')" class="sentence-claim-filter-chip" style="color:' + meta.color + ';">' + escapeHtml(label) + ' ' + escapeHtml(count) + '</button>';
        }).join('') +
        (Number(hiddenLowQualityCount || 0) > 0 ? '<span data-claim-filter-chip="1" data-claim-relation-filter="low-quality" title="语义相似度或证据置信度未达到动态门控要求，已隐藏" class="sentence-claim-filter-chip is-static" style="color:#475569;">低质 ' + escapeHtml(hiddenLowQualityCount) + '（已隐藏）</span>' : '') +
      '</div>';
    }

    function renderSentenceClaimSupportBox(paper) {
      var support = paper && paper.claimSupport ? paper.claimSupport : null;
      if (!support) return '';
      var meta = getSentenceClaimSupportMeta(support);
      var confidence = Number(support.confidence || 0);
      var confidenceText = Number.isFinite(confidence) && confidence > 0 ? Math.round(confidence * 100) + '%' : '-';
      var snippets = Array.isArray(support.evidenceSnippets) ? support.evidenceSnippets : [];
      return '<div style="margin-top:8px;border:1px solid ' + meta.border + ';border-radius:7px;background:' + (meta.softBg || meta.bg) + ';padding:8px;">' +
        '<div style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;">' +
          '<span style="font-size:12px;font-weight:850;color:' + (meta.softColor || meta.border) + ';">证据关系：' + escapeHtml(meta.label) + '</span>' +
          '<span style="font-size:11px;color:var(--text-secondary);">置信度 ' + escapeHtml(confidenceText) + '</span>' +
        '</div>' +
        (support.reason ? '<div style="margin-top:6px;font-size:12px;line-height:1.6;color:var(--text-primary);">' + escapeHtml(support.reason) + '</div>' : '') +
        (snippets.length ? '<div style="display:flex;flex-direction:column;gap:5px;margin-top:7px;">' + snippets.map(function(snippet) {
          return '<div style="border-left:3px solid ' + meta.color + ';padding-left:7px;font-size:11.5px;line-height:1.55;color:var(--text-secondary);word-break:break-word;">' + escapeHtml(snippet) + '</div>';
        }).join('') + '</div>' : '') +
      '</div>';
    }

    function renderSentenceClaimQueryBox(detail) {
      var groups = Array.isArray(detail.languageGroups) ? detail.languageGroups : [];
      var parserLabel = detail.parser === 'ai' ? 'AI解析' : '规则解析';
      return '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:11px;margin-bottom:12px;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:8px;">' +
          '<div style="font-size:13px;font-weight:800;color:var(--text-primary);">解析 query</div>' +
          '<span style="font-size:11px;color:var(--accent-color);white-space:nowrap;">' + escapeHtml(parserLabel) + '</span>' +
        '</div>' +
        (detail.parserReason ? '<div style="font-size:11.5px;color:var(--text-secondary);line-height:1.55;margin-bottom:8px;">' + escapeHtml(detail.parserReason) + '</div>' : '') +
        (detail.parserWarning ? '<div style="font-size:11.5px;color:var(--danger-color);line-height:1.55;margin-bottom:8px;">' + escapeHtml(detail.parserWarning) + '</div>' : '') +
        '<div style="display:flex;flex-direction:column;gap:7px;">' +
          groups.map(function(group) {
            return '<div style="border:1px solid var(--border-color);border-radius:7px;background:var(--bg-secondary);padding:8px;">' +
              '<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:5px;">' +
                '<span style="font-size:12px;font-weight:750;color:var(--text-primary);">' + escapeHtml(group.label || '') + '</span>' +
                '<span style="font-size:11px;color:var(--text-secondary);">候选 ' + escapeHtml(group.totalCount || 0) + ' / 返回 ' + escapeHtml(group.returned || 0) + ' · 语义 ' + (group.semanticUsed ? '已用' : '未用') + '</span>' +
              '</div>' +
              '<div style="font-size:11.5px;line-height:1.55;color:var(--text-secondary);word-break:break-word;">' + escapeHtml(group.query || '') + '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
    }

    function getSentenceClaimQualityMeta(qualityGate) {
      var gate = qualityGate || {};
      if (gate.label === 'high') {
        return { label: '高质量证据', color: '#1d4ed8', bg: 'transparent', border: '#2563eb' };
      }
      if (gate.label === 'reference') {
        return { label: '仅参考', color: '#d97706', bg: 'transparent', border: '#d97706' };
      }
      return { label: '质量门控', color: '#475569', bg: 'transparent', border: '#64748b' };
    }

    function renderSentenceClaimSourceItem(paper) {
      var source = paper && paper.sourceItem ? paper.sourceItem : null;
      if (!source || !source.excerpt) return '';
      return '<div style="margin-top:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-secondary);padding:8px;">' +
        '<div style="font-size:11px;font-weight:850;color:var(--text-primary);margin-bottom:5px;">来源片段</div>' +
        '<div style="font-size:11.5px;line-height:1.55;color:var(--text-secondary);word-break:break-word;">' + escapeHtml(source.excerpt || '') + '</div>' +
        '<div style="margin-top:6px;font-size:10.5px;color:var(--text-secondary);word-break:break-word;">' +
          escapeHtml(source.file || '') + (source.path ? ' · ' + escapeHtml(source.path) : '') +
        '</div>' +
      '</div>';
    }

    function renderSentenceClaimTargetReference(paper) {
      var reference = paper && paper.targetReference ? String(paper.targetReference || '').trim() : '';
      if (!reference) return '';
      return '<div style="margin-top:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-secondary);padding:8px;">' +
        '<div style="font-size:11px;font-weight:850;color:var(--text-primary);margin-bottom:5px;">目标期刊尾注格式</div>' +
        '<div style="font-size:11.5px;line-height:1.6;color:var(--text-primary);word-break:break-word;">' + escapeHtml(reference) + '</div>' +
      '</div>';
    }

    function renderSentenceClaimPaperCard(paper, index) {
      var abstract = String(paper.abstract || '');
      var sourceLine = [paper.journal, paper.year, paper.doi ? 'DOI: ' + paper.doi : ''].filter(Boolean).join(' · ');
      var relation = paper && paper.claimSupport && paper.claimSupport.relation ? String(paper.claimSupport.relation) : 'unchecked';
      var supportMeta = getSentenceClaimSupportMeta(paper.claimSupport);
      var qualityMeta = getSentenceClaimQualityMeta(paper.qualityGate);
      return '<article data-sentence-claim-paper data-claim-relation="' + escapeHtml(relation) + '" style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:11px;margin-bottom:9px;">' +
        '<div style="display:flex;gap:9px;align-items:flex-start;">' +
          '<div style="width:28px;height:28px;border-radius:7px;background:rgba(15,118,110,0.10);color:var(--accent-color);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:850;flex:0 0 auto;">' + (index + 1) + '</div>' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="font-size:13px;font-weight:800;color:var(--text-primary);line-height:1.45;">' + escapeHtml(paper.title || 'Untitled') + '</div>' +
            '<div style="margin-top:4px;font-size:11.5px;color:var(--text-secondary);line-height:1.55;">' + escapeHtml(paper.citation || '') + (paper.author ? ' · ' + escapeHtml(paper.author) : '') + '</div>' +
            (sourceLine ? '<div style="margin-top:3px;font-size:11.5px;color:var(--text-secondary);line-height:1.55;">' + escapeHtml(sourceLine) + '</div>' : '') +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px;">' +
              '<span style="font-size:11px;padding:2px 6px;border:1px solid #0f766e;border-radius:999px;background:transparent;color:#0f766e;font-weight:750;">' + escapeHtml(paper.retrievalPath || '-') + '</span>' +
              '<span style="font-size:11px;padding:2px 6px;border:1px solid ' + supportMeta.border + ';border-radius:999px;background:' + supportMeta.bg + ';color:' + supportMeta.color + ';font-weight:750;">证据 ' + escapeHtml(supportMeta.label) + '</span>' +
              '<span title="' + escapeHtml((paper.qualityGate && paper.qualityGate.reason) || '') + '" style="font-size:11px;padding:2px 6px;border:1px solid ' + qualityMeta.border + ';border-radius:999px;background:' + qualityMeta.bg + ';color:' + qualityMeta.color + ';font-weight:750;">' + escapeHtml(qualityMeta.label) + '</span>' +
              '<span style="font-size:11px;padding:2px 6px;border:1px solid var(--border-color);border-radius:999px;background:transparent;color:var(--text-secondary);">score ' + escapeHtml(formatSentenceClaimScore(paper.score)) + '</span>' +
              '<span style="font-size:11px;padding:2px 6px;border:1px solid var(--border-color);border-radius:999px;background:transparent;color:var(--text-secondary);">BM25 ' + escapeHtml(formatSentenceClaimScore(paper.bm25Score)) + '</span>' +
              '<span style="font-size:11px;padding:2px 6px;border:1px solid var(--border-color);border-radius:999px;background:transparent;color:var(--text-secondary);">semantic ' + escapeHtml(formatSentenceClaimScore(paper.vectorScore)) + '</span>' +
            '</div>' +
            renderSentenceClaimSupportBox(paper) +
            renderSentenceClaimTargetReference(paper) +
            renderSentenceClaimSourceItem(paper) +
            '<details open style="margin-top:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-secondary);padding:8px;">' +
              '<summary style="cursor:pointer;font-size:12px;font-weight:750;color:var(--text-primary);list-style-position:inside;">摘要</summary>' +
              '<div style="display:flex;justify-content:flex-end;margin-top:7px;">' +
                '<button type="button" onclick="translateSentenceClaimAbstract(this)" style="height:28px;padding:0 9px;border:1px solid var(--accent-color);border-radius:6px;background:transparent;color:var(--accent-color);cursor:pointer;font-size:11px;font-weight:750;">翻译摘要</button>' +
              '</div>' +
              '<div data-sentence-claim-translation style="display:none;margin-top:8px;border:1px solid rgba(15,118,110,0.28);border-radius:7px;background:rgba(15,118,110,0.08);padding:8px;font-size:12px;line-height:1.7;color:var(--text-primary);white-space:pre-wrap;word-break:break-word;"></div>' +
              '<div data-sentence-claim-abstract style="margin-top:7px;font-size:12px;line-height:1.7;color:var(--text-secondary);white-space:pre-wrap;word-break:break-word;">' + escapeHtml(abstract || '暂无摘要') + '</div>' +
            '</details>' +
          '</div>' +
        '</div>' +
      '</article>';
    }

    function setSentenceClaimFilterActive(sectionId, relation) {
      var section = document.getElementById(sectionId);
      if (!section) return;
      Array.prototype.slice.call(section.querySelectorAll('[data-claim-filter-chip]')).forEach(function(chip) {
        chip.classList.toggle('is-active', chip.getAttribute('data-claim-relation-filter') === relation);
      });
    }
    window.setSentenceClaimFilterActive = setSentenceClaimFilterActive;

    function updateSentenceClaimActiveFilterFromScroll(container) {
      if (!container) return;
      var containerRect = container.getBoundingClientRect();
      var targetTop = containerRect.top + 72;
      Array.prototype.slice.call(container.querySelectorAll('section[id^="sentenceClaimSection"]')).forEach(function(section) {
        var sectionRect = section.getBoundingClientRect();
        if (sectionRect.bottom < containerRect.top || sectionRect.top > containerRect.bottom) return;
        var bestCard = null;
        var bestDistance = Infinity;
        Array.prototype.slice.call(section.querySelectorAll('[data-sentence-claim-paper]')).forEach(function(card) {
          if (card.style.display === 'none') return;
          var rect = card.getBoundingClientRect();
          if (rect.bottom < containerRect.top + 48 || rect.top > containerRect.bottom) return;
          var distance = Math.abs(rect.top - targetTop);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestCard = card;
          }
        });
        if (bestCard) {
          setSentenceClaimFilterActive(section.id, bestCard.getAttribute('data-claim-relation') || 'unchecked');
        }
      });
    }

    function initSentenceClaimFilterTracking(container) {
      if (!container) return;
      Array.prototype.slice.call(container.querySelectorAll('[data-sentence-claim-paper]')).forEach(function(card) {
        card.addEventListener('mouseenter', function() {
          var section = card.closest('section[id^="sentenceClaimSection"]');
          if (section) setSentenceClaimFilterActive(section.id, card.getAttribute('data-claim-relation') || 'unchecked');
        });
      });
      if (!container._sentenceClaimFilterScrollBound) {
        container._sentenceClaimFilterScrollBound = true;
        container.addEventListener('scroll', function() {
          updateSentenceClaimActiveFilterFromScroll(container);
        }, { passive: true });
      }
    }

    function filterSentenceClaimPapers(sectionId, relation) {
      var section = document.getElementById(sectionId);
      if (!section) return;
      setSentenceClaimFilterActive(sectionId, relation);
      var cards = Array.prototype.slice.call(section.querySelectorAll('[data-sentence-claim-paper]'));
      var visible = 0;
      cards.forEach(function(card) {
        var cardRelation = card.getAttribute('data-claim-relation') || 'unchecked';
        var show = relation === 'all' || cardRelation === relation;
        card.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      var empty = section.querySelector('[data-sentence-claim-filter-empty]');
      if (empty) {
        empty.style.display = visible ? 'none' : 'block';
        empty.textContent = relation === 'all'
          ? '没有可展示的参考文献；无关或低质量文献已隐藏。'
          : '当前筛选条件下没有可展示的参考文献；无关或低质量文献已隐藏。';
      }
    }
    window.filterSentenceClaimPapers = filterSentenceClaimPapers;

    async function translateSentenceClaimAbstract(button) {
      var article = button ? button.closest('article') : null;
      var abstractNode = article ? article.querySelector('[data-sentence-claim-abstract]') : null;
      var translationNode = article ? article.querySelector('[data-sentence-claim-translation]') : null;
      var text = abstractNode ? abstractNode.textContent.trim() : '';
      if (!text || text === '暂无摘要') {
        alert('没有可翻译的摘要');
        return;
      }
      var originalText = button.textContent;
      button.disabled = true;
      button.textContent = '翻译中';
      if (translationNode) {
        translationNode.style.display = 'block';
        translationNode.textContent = '正在翻译摘要...';
      }
      try {
        var response = await fetch('/api/sentence/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: text,
            targetLanguage: '中文',
            userId: currentUserId || 'web-user'
          })
        });
        var data = await response.json();
        if (!data.success) throw new Error(data.error || '翻译失败');
        if (translationNode) {
          translationNode.textContent = data.translation || '';
          translationNode.style.display = 'block';
        }
        button.textContent = '重新翻译';
      } catch (e) {
        if (translationNode) {
          translationNode.textContent = '翻译失败：' + (e.message || String(e));
          translationNode.style.display = 'block';
        }
        button.textContent = originalText || '翻译摘要';
      } finally {
        button.disabled = false;
      }
    }
    window.translateSentenceClaimAbstract = translateSentenceClaimAbstract;

    function renderSentenceClaimSearchResult(data) {
      var details = Array.isArray(data.sentences) ? data.sentences : [];
      var resultMap = data.results || {};
      if (!details.length) {
        return '<div style="padding:16px;color:var(--text-secondary);font-size:13px;">没有返回可展示的检索结果。</div>';
      }
      return '<div style="display:flex;flex-direction:column;gap:14px;">' +
        '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;">' +
          '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:10px;"><div style="font-size:11px;color:var(--text-secondary);">文献库</div><div style="margin-top:3px;font-size:17px;font-weight:850;color:var(--text-primary);">' + escapeHtml(data.literatureCount || 0) + '</div></div>' +
          '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:10px;"><div style="font-size:11px;color:var(--text-secondary);">句子</div><div style="margin-top:3px;font-size:17px;font-weight:850;color:var(--text-primary);">' + escapeHtml(details.length) + '</div></div>' +
          '<div style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);padding:10px;"><div style="font-size:11px;color:var(--text-secondary);">每句返回</div><div style="margin-top:3px;font-size:17px;font-weight:850;color:var(--text-primary);">' + escapeHtml(data.topK || '-') + '</div></div>' +
        '</div>' +
        details.map(function(detail, detailIndex) {
          detail.sectionId = 'sentenceClaimSection' + detailIndex;
          var papers = Array.isArray(resultMap[detail.sentence]) ? resultMap[detail.sentence] : [];
          var filterNotes = [];
          if (Number(detail.requestedCount || data.topK || 0) > papers.length) {
            filterNotes.push('本句按证据关系过滤后返回 ' + papers.length + ' 条，低于用户要求的 ' + (detail.requestedCount || data.topK || '-') + ' 条；无关文献已隐藏。');
          }
          if (Number(detail.hiddenInvalidMetadataCount || 0) > 0) {
            filterNotes.push('已隐藏 ' + detail.hiddenInvalidMetadataCount + ' 条疑似示例/占位作者记录。');
          }
          if (Number(detail.hiddenLowQualityCount || 0) > 0) {
            filterNotes.push('动态质量门控已隐藏 ' + detail.hiddenLowQualityCount + ' 条语义或证据支持不足的候选。');
          }
          var shortage = filterNotes.length
            ? '<div style="border:1px solid rgba(245,158,11,0.28);border-radius:8px;background:rgba(245,158,11,0.08);padding:9px 10px;color:#92400e;font-size:12px;line-height:1.55;margin-bottom:8px;">' + escapeHtml(filterNotes.join(' ')) + '</div>'
            : '';
          return '<section id="' + escapeHtml(detail.sectionId) + '">' +
            '<div style="font-size:14px;font-weight:850;color:var(--text-primary);line-height:1.45;margin-bottom:8px;">' + escapeHtml(detail.sentence || '') + '</div>' +
            renderSentenceClaimQueryBox(detail) +
            renderSentenceClaimSupportSummary(detail.supportCounts, detail.evidenceChecked, detail.sectionId, true, detail.hiddenLowQualityCount) +
            shortage +
            '<div data-sentence-claim-filter-empty style="display:none;border:1px dashed var(--border-color);border-radius:8px;padding:14px;color:var(--text-secondary);font-size:13px;background:var(--bg-primary);margin-bottom:8px;"></div>' +
            (papers.length ? papers.map(renderSentenceClaimPaperCard).join('') : '<div style="border:1px dashed var(--border-color);border-radius:8px;padding:14px;color:var(--text-secondary);font-size:13px;background:var(--bg-primary);">未匹配到参考文献。</div>') +
          '</section>';
        }).join('') +
      '</div>';
    }

    var sentenceClaimRunLogQueue = [];
    var sentenceClaimRunLogTyping = false;

    function renderSentenceClaimRunLogPanel() {
      return '' +
        '<div style="height:100%;display:flex;align-items:flex-start;justify-content:flex-start;">' +
          '<div id="sentenceClaimRunLogs" style="width:100%;max-height:100%;overflow:auto;padding:0 2px;font-size:13px;line-height:1.75;color:var(--text-primary);text-align:left;"></div>' +
        '</div>';
    }

    function resetSentenceClaimRunLogs() {
      sentenceClaimRunLogQueue = [];
      sentenceClaimRunLogTyping = false;
    }

    function queueSentenceClaimRunLog(message) {
      sentenceClaimRunLogQueue.push(String(message || ''));
      if (!sentenceClaimRunLogTyping) drainSentenceClaimRunLogQueue();
    }

    function drainSentenceClaimRunLogQueue() {
      var logBox = document.getElementById('sentenceClaimRunLogs');
      if (!logBox) {
        resetSentenceClaimRunLogs();
        return;
      }
      var message = sentenceClaimRunLogQueue.shift();
      if (!message) {
        sentenceClaimRunLogTyping = false;
        return;
      }
      sentenceClaimRunLogTyping = true;
      Array.prototype.slice.call(logBox.querySelectorAll('[data-sentence-claim-log-line]')).forEach(function(node) {
        node.style.color = 'var(--text-secondary)';
      });
      var line = document.createElement('div');
      line.setAttribute('data-sentence-claim-log-line', '1');
      line.style.cssText = 'white-space:pre-wrap;word-break:break-word;margin-bottom:7px;color:var(--text-primary);font-weight:650;';
      logBox.appendChild(line);
      var text = '[' + new Date().toLocaleTimeString() + '] ' + message;
      var index = 0;
      function typeNext() {
        if (!document.getElementById('sentenceClaimRunLogs')) {
          resetSentenceClaimRunLogs();
          return;
        }
        line.textContent = text.slice(0, index);
        logBox.scrollTop = logBox.scrollHeight;
        index += 1;
        if (index <= text.length) {
          setTimeout(typeNext, 8);
        } else {
          setTimeout(drainSentenceClaimRunLogQueue, 35);
        }
      }
      typeNext();
    }

    async function readSentenceClaimSearchStream(response) {
      if (!response.body || !response.body.getReader) {
        throw new Error('当前环境不支持流式读取后端日志');
      }
      var reader = response.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buffer = '';
      var finalData = null;

      function handleLine(line) {
        if (!line.trim()) return;
        var payload = JSON.parse(line);
        if (payload.type === 'log') {
          queueSentenceClaimRunLog(payload.message || '');
        } else if (payload.type === 'result') {
          finalData = payload.data;
        } else if (payload.type === 'error') {
          throw new Error(payload.error || '检索失败');
        }
      }

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop() || '';
        lines.forEach(handleLine);
      }
      buffer += decoder.decode();
      if (buffer.trim()) handleLine(buffer);
      if (!finalData) throw new Error('后端未返回最终检索结果');
      return finalData;
    }

    async function runSentenceClaimSearch() {
      var input = document.getElementById('sentenceClaimSearchInput');
      var topKInput = document.getElementById('sentenceClaimTopK');
      var resultBox = document.getElementById('sentenceClaimSearchResult');
      var button = document.getElementById('sentenceClaimSearchBtn');
      var query = input ? input.value.trim() : '';
      if (button && button.disabled) return;
      if (!query) {
        alert('请输入句子或论点');
        return;
      }
      if (input) {
        input.value = '';
        autoResizeSentenceClaimSearchInput(input);
      }
      if (resultBox) {
        resultBox.innerHTML = renderSentenceClaimRunLogPanel();
        resetSentenceClaimRunLogs();
        queueSentenceClaimRunLog('前端已提交检索请求，等待后端开始处理。');
      }
      if (button) {
        button.disabled = true;
        button.classList.add('sending');
        button.setAttribute('title', '检索中');
        button.setAttribute('aria-label', '检索中');
      }
      try {
        var sentenceClaimWorkspace = typeof loadWorkspaceDirectorySetting === 'function'
          ? loadWorkspaceDirectorySetting(currentConversationId)
          : null;
        var requestPayload = {
          query: query,
          topK: topKInput ? Number(topKInput.value || 5) : 5,
          userId: currentUserId || 'web-user',
          targetReferenceFormat: sentenceClaimReferenceFormat || '',
          projectRoot: sentenceClaimWorkspace
            && sentenceClaimWorkspace.enabled
            && sentenceClaimWorkspace.permission !== 'read-only'
            ? String(sentenceClaimWorkspace.path || '').trim()
            : ''
        };
        var response = await fetch('/api/sentence/claim-match/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload)
        });
        if (!response.ok) throw new Error('后端日志流连接失败：HTTP ' + response.status);
        var data = await readSentenceClaimSearchStream(response);
        if (!data.success) throw new Error(data.error || '检索失败');
        if (resultBox) {
          resultBox.innerHTML = renderSentenceClaimSearchResult(data);
          initSentenceClaimFilterTracking(resultBox);
        }
      } catch (e) {
        if (resultBox) resultBox.innerHTML = '<div style="border:1px solid rgba(239,68,68,0.35);border-radius:8px;background:rgba(239,68,68,0.08);padding:14px;color:var(--danger-color);font-size:13px;line-height:1.6;">' + escapeHtml(e.message || String(e)) + '</div>';
      } finally {
        if (button) {
          button.disabled = false;
          button.classList.remove('sending');
          button.setAttribute('title', '检索');
          button.setAttribute('aria-label', '检索');
        }
      }
    }
    window.runSentenceClaimSearch = runSentenceClaimSearch;

    function showDataAnalysisDialog() {
      dataAnalysisStructure = null;
      var methodCards = renderDataAnalysisMethodCards();
      var html = `
        <div class="data-analysis-dialog">
          <section class="da-hero">
            <div>
              <div class="da-kicker">SPSS 风格统计工作台</div>
              <h3 class="da-title">上传数据，选择方法，自动得到统计结果和 R 作图上下文</h3>
              <div class="da-subtitle">支持 CSV、XLSX、XLS。系统会先识别变量类型和缺失值，再根据分析方法显示需要填写的变量。完成分析后可直接联动生成 R 作图代码。</div>
            </div>
            <div class="da-pills">
              <span class="da-pill">本地统计</span>
              <span class="da-pill">变量识别</span>
              <span class="da-pill">R 作图联动</span>
            </div>
          </section>

          <div class="da-layout">
            <section class="da-panel">
              <div class="da-panel-header">
                <div class="da-panel-title">${uiIcon('table', 'sm')} 数据与方法</div>
                <div class="da-panel-note">第一行作为变量名</div>
              </div>
              <div class="da-panel-body">
                <div class="da-field">
                  <label class="da-label" for="dataAnalysisFile">
                    <span>上传数据</span>
                    <span class="da-label-hint">CSV / XLSX / XLS</span>
                  </label>
                  <input class="da-input" type="file" id="dataAnalysisFile" accept=".xlsx,.xls,.csv">
                  <div class="da-help">上传后会自动读取字段、推断连续变量/分类变量/时间变量，并生成变量预览。</div>
                </div>
                <div id="dataAnalysisDatasetInfo" class="da-dataset-card">
                  <div class="da-dataset-name">等待上传数据</div>
                  <div>上传后会显示样本量、变量数量、变量类型和前若干字段标签。</div>
                </div>
              </div>
            </section>

            <section class="da-panel">
              <div class="da-panel-header">
                <div class="da-panel-title">${uiIcon('barChart', 'sm')} 变量配置</div>
                <div class="da-panel-note">自动隐藏无关字段</div>
              </div>
              <div class="da-panel-body">
                <div id="dataAnalysisControls" class="da-control-grid">
                  <div class="da-control" id="daNumericField">
                    <label for="daNumericVar">数值变量</label>
                    <select id="daNumericVar"></select>
                  </div>
                  <div class="da-control" id="daNumeric2Field">
                    <label for="daNumericVar2">第二数值变量</label>
                    <select id="daNumericVar2"></select>
                  </div>
                  <div class="da-control" id="daGroupField">
                    <label for="daGroupVar">分组变量</label>
                    <select id="daGroupVar" onchange="refreshDataAnalysisTreatmentColors()"></select>
                  </div>
                  <div class="da-control" id="daCategoryField">
                    <label for="daCategoryVar">分类变量 A</label>
                    <select id="daCategoryVar" onchange="refreshDataAnalysisTreatmentColors()"></select>
                  </div>
                  <div class="da-control" id="daCategory2Field">
                    <label for="daCategoryVar2">分类变量 B</label>
                    <select id="daCategoryVar2" onchange="refreshDataAnalysisTreatmentColors()"></select>
                  </div>
                  <div class="da-control" id="daDependentField">
                    <label for="daDependentVar">因变量</label>
                    <select id="daDependentVar" onchange="refreshDataAnalysisPredictors()"></select>
                  </div>
                  <div class="da-control da-control-wide" id="daPredictorsField">
                    <label for="daPredictorVars">回归自变量（可多选）</label>
                    <select id="daPredictorVars" multiple style="height:92px;"></select>
                  </div>
                </div>
                <div class="da-field" style="margin-top:12px;">
                  <label class="da-label" for="dataAnalysisExtraQuery">
                    <span>额外要求</span>
                    <span class="da-label-hint">可写补充检验、显著性或作图要求</span>
                  </label>
                  <textarea class="da-input" id="dataAnalysisExtraQuery" rows="4" placeholder="例如：显著性用 a/b/c 字母标注；按 Treatment 分组；只展示 N2O 的结果；没有显著性结果时预留 x；请同时输出正态性检验和箱线图。"></textarea>
                </div>
                <div id="dataAnalysisTreatmentColorPanel" class="r-palette-panel compact"></div>
                <div id="dataAnalysisResult" class="da-result"></div>
              </div>
            </section>

            <section class="da-panel da-method-panel">
              <div class="da-panel-header">
                <div class="da-panel-title">${uiIcon('settings', 'sm')} 分析方法</div>
                <div class="da-panel-note">按项目问题多选</div>
              </div>
              <div class="da-panel-body">
                <div class="da-method-board" id="dataAnalysisMethodBoard">
                  ${methodCards}
                </div>
                <div class="da-help">可直接勾选多个方法；系统会一次生成综合统计报告，并联动生成同一个 R 代码文件。</div>
              </div>
            </section>
          </div>

          <div class="btns da-footer">
            <div class="da-footer-note">建议先“开始分析”，再生成 R 作图；这样 AI 会拿到统计结果和变量选择。</div>
            <button class="cancel" onclick="closeModal()">关闭</button>
            <button class="cancel" onclick="openRPlotDialogFromDataAnalysis()">作图配置</button>
            <button class="ok" onclick="generateRPlotFromDataAnalysis()">生成R作图并出图</button>
            <button class="ok" onclick="runDataAnalysis()">开始分析</button>
          </div>
        </div>
      `;

      showModal('数据分析', html, true);
      setTimeout(function() {
        var fileInput = document.getElementById('dataAnalysisFile');
        if (fileInput) fileInput.addEventListener('change', inspectDataAnalysisFile);
        updateDataAnalysisControls();
        refreshDataAnalysisTreatmentColors();
      }, 50);
    }
    window.showDataAnalysisDialog = showDataAnalysisDialog;

    async function inspectDataAnalysisFile() {
      var fileInput = document.getElementById('dataAnalysisFile');
      var info = document.getElementById('dataAnalysisDatasetInfo');
      if (!fileInput || !fileInput.files || fileInput.files.length === 0) return;

      info.innerHTML = '正在读取字段...';
      var formData = new FormData();
      formData.append('file', fileInput.files[0]);

      try {
        var response = await fetch('/api/data-analysis/inspect', { method: 'POST', body: formData });
        var result = await response.json();
        if (!result.success) {
          info.innerHTML = '<span style="color:var(--danger-color);">读取失败：' + escapeHtml(result.error || '未知错误') + '</span>';
          return;
        }
        dataAnalysisStructure = result.data;
        dataAnalysisLastResult = null;
        dataAnalysisPlotLink = {
          file: fileInput.files[0],
          filename: fileInput.files[0].name,
          structure: dataAnalysisStructure,
          selections: null,
          chartType: '',
          analysisType: '',
          customRequirements: ''
        };
        renderDataAnalysisStructure();
        fillDataAnalysisVariableOptions();
        updateDataAnalysisControls();
        refreshDataAnalysisTreatmentColors();
      } catch (e) {
        info.innerHTML = '<span style="color:var(--danger-color);">读取失败：' + escapeHtml(e.message) + '</span>';
      }
    }
    window.inspectDataAnalysisFile = inspectDataAnalysisFile;

    function renderDataAnalysisStructure() {
      var info = document.getElementById('dataAnalysisDatasetInfo');
      if (!info || !dataAnalysisStructure) return;
      var variables = dataAnalysisStructure.variables || [];
      var numericCount = variables.filter(function(v) { return v.type === 'numeric'; }).length;
      var categoricalCount = variables.filter(function(v) { return v.type === 'categorical'; }).length;
      var dateCount = variables.filter(function(v) { return v.type === 'date'; }).length;
      var variableTags = variables.slice(0, 10).map(function(v) {
        var label = v.type === 'numeric' ? '连续' : (v.type === 'date' ? '时间' : '分类');
        return '<span class="da-tag"><strong>' + escapeHtml(v.name) + '</strong>&nbsp;·&nbsp;' + label + '</span>';
      }).join('');
      info.innerHTML =
        '<div class="da-dataset-name">' + escapeHtml(dataAnalysisStructure.filename) + '</div>' +
        '<div class="da-stats-grid">' +
          '<div class="da-stat"><div class="da-stat-value">' + dataAnalysisStructure.rowCount + '</div><div class="da-stat-label">样本行</div></div>' +
          '<div class="da-stat"><div class="da-stat-value">' + dataAnalysisStructure.columnCount + '</div><div class="da-stat-label">变量列</div></div>' +
          '<div class="da-stat"><div class="da-stat-value">' + numericCount + '</div><div class="da-stat-label">连续变量</div></div>' +
        '</div>' +
        '<div style="color:var(--text-secondary);font-size:11px;">分类变量 ' + categoricalCount + ' 个，时间变量 ' + dateCount + ' 个。</div>' +
        '<div class="da-tag-list">' + variableTags + (variables.length > 10 ? '<span class="da-tag">等 ' + variables.length + ' 个变量</span>' : '') + '</div>';
    }

    function fillDataAnalysisVariableOptions() {
      if (!dataAnalysisStructure) return;
      var variables = dataAnalysisStructure.variables || [];
      var numeric = variables.filter(function(v) { return v.type === 'numeric'; });
      var categorical = variables.filter(function(v) { return v.type === 'categorical'; });

      setDataAnalysisSelectOptions('daNumericVar', numeric, true);
      setDataAnalysisSelectOptions('daNumericVar2', numeric, true);
      setDataAnalysisSelectOptions('daDependentVar', numeric, false);
      setDataAnalysisSelectOptions('daGroupVar', categorical, true);
      setDataAnalysisSelectOptions('daCategoryVar', categorical, true);
      setDataAnalysisSelectOptions('daCategoryVar2', categorical, true);
      refreshDataAnalysisPredictors();
    }

    function setDataAnalysisSelectOptions(id, variables, optional) {
      var select = document.getElementById(id);
      if (!select) return;
      var html = optional ? '<option value="">自动选择</option>' : '';
      html += variables.map(function(v) {
        return '<option value="' + escapeHtml(v.name) + '">' + escapeHtml(v.name) + '（N=' + v.nonMissingCount + '）</option>';
      }).join('');
      select.innerHTML = html || '<option value="">无可用变量</option>';
    }

    function refreshDataAnalysisPredictors() {
      if (!dataAnalysisStructure) return;
      var dependent = document.getElementById('daDependentVar')?.value || '';
      var select = document.getElementById('daPredictorVars');
      if (!select) return;
      var numeric = (dataAnalysisStructure.variables || []).filter(function(v) {
        return v.type === 'numeric' && v.name !== dependent;
      });
      select.innerHTML = numeric.map(function(v, index) {
        return '<option value="' + escapeHtml(v.name) + '"' + (index === 0 ? ' selected' : '') + '>' + escapeHtml(v.name) + '（N=' + v.nonMissingCount + '）</option>';
      }).join('') || '<option value="">无可用自变量</option>';
    }
    window.refreshDataAnalysisPredictors = refreshDataAnalysisPredictors;

    function updateDataAnalysisControls() {
      var methods = getDataAnalysisSelectedMethods();
      var methodSet = {};
      methods.forEach(function(method) { methodSet[method] = true; });
      var controls = ['daNumericField', 'daNumeric2Field', 'daGroupField', 'daCategoryField', 'daCategory2Field', 'daDependentField', 'daPredictorsField'];
      controls.forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });

      function show(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = '';
      }

      if (methodSet.descriptive || methodSet.normality || methodSet.nonparametric || methodSet.variance_homogeneity) {
        show('daNumericField');
      }
      if (methodSet.independent_t || methodSet.anova || methodSet.nonparametric || methodSet.variance_homogeneity || methodSet.two_way_anova) {
        show('daNumericField');
        show('daGroupField');
      }
      if (methodSet.paired_t || methodSet.correlation) {
        show('daNumericField');
        show('daNumeric2Field');
      }
      if (methodSet.regression || methodSet.mixed_effects || methodSet.survival) {
        show('daDependentField');
        show('daPredictorsField');
      }
      if (methodSet.chi_square || methodSet.two_way_anova || methodSet.survival) {
        show('daCategoryField');
        show('daCategory2Field');
      }
    }
    window.updateDataAnalysisControls = updateDataAnalysisControls;

    function getDataAnalysisSelectedMethods() {
      var values = Array.from(document.querySelectorAll('input[name="dataAnalysisMethods"]:checked'))
        .map(function(input) { return input.value; })
        .filter(Boolean);
      return values.length ? values : ['descriptive'];
    }

    function formatDataAnalysisMethodNames(methods) {
      return (methods || []).map(getDataAnalysisMethodName).join(' + ');
    }

    function getDataAnalysisMethodName(methodId) {
      var method = DATA_ANALYSIS_METHODS.find(function(item) { return item.id === methodId; });
      return method ? method.name : methodId;
    }

    function getDataAnalysisSelectValue(id) {
      return document.getElementById(id)?.value || '';
    }

    function getDataAnalysisPredictorValues() {
      var predictorsSelect = document.getElementById('daPredictorVars');
      if (!predictorsSelect) return [];
      var dependent = getDataAnalysisSelectValue('daDependentVar');
      return Array.from(predictorsSelect.selectedOptions)
        .map(function(option) { return option.value; })
        .filter(function(value) { return value && value !== dependent; });
    }

    function getDataAnalysisExtraQuery() {
      return (document.getElementById('dataAnalysisExtraQuery')?.value || '').trim();
    }

    function getDataAnalysisSelectionSnapshot() {
      var methods = getDataAnalysisSelectedMethods();
      return {
        method: methods[0] || 'descriptive',
        methods: methods,
        extraQuery: getDataAnalysisExtraQuery(),
        numericVar: getDataAnalysisSelectValue('daNumericVar'),
        numericVar2: getDataAnalysisSelectValue('daNumericVar2'),
        groupVar: getDataAnalysisSelectValue('daGroupVar'),
        categoryVar: getDataAnalysisSelectValue('daCategoryVar'),
        categoryVar2: getDataAnalysisSelectValue('daCategoryVar2'),
        dependentVar: getDataAnalysisSelectValue('daDependentVar'),
        predictorVars: getDataAnalysisPredictorValues()
      };
    }

    function firstDataAnalysisVariable(type, excludeNames) {
      var variables = dataAnalysisStructure && Array.isArray(dataAnalysisStructure.variables) ? dataAnalysisStructure.variables : [];
      var excluded = {};
      (excludeNames || []).forEach(function(name) { if (name) excluded[name] = true; });
      var found = variables.find(function(variable) {
        return variable.type === type && !excluded[variable.name];
      });
      return found ? found.name : '';
    }

    function hasNonNegatedChartIntent(text, positivePattern, negativePattern) {
      var raw = String(text || '');
      if (!positivePattern.test(raw)) return false;
      if (negativePattern && negativePattern.test(raw)) return false;
      return true;
    }

    function inferRChartTypeFromUserQuery(text) {
      var raw = String(text || '');
      if (!raw.trim()) return null;
      var lower = raw.toLowerCase();
      if (hasNonNegatedChartIntent(lower, /(分组| grouped ).{0,8}(柱状|柱形|条形|bar)|grouped\s+bar/i, /(不要|不想|不是|非).{0,8}(分组柱|grouped\s+bar)/i)) {
        return { chartType: 'grouped_bar', analysisType: 'comparison', label: '分组柱状图' };
      }
      if (hasNonNegatedChartIntent(lower, /(堆叠|stacked).{0,8}(柱状|柱形|条形|bar)|stacked\s+bar/i, /(不要|不想|不是|非).{0,8}(堆叠柱|stacked\s+bar)/i)) {
        return { chartType: 'stacked_bar', analysisType: 'composition', label: '堆叠柱状图' };
      }
      if (hasNonNegatedChartIntent(lower, /(折线图?|线图|曲线图?|趋势图|趋势线|时序图|时间序列图|line\s*(plot|chart|graph)?|time\s*series)/i, /(不要|不想|不是|非).{0,8}(折线|线图|曲线|趋势图|line\s*(plot|chart|graph)?)/i)) {
        return { chartType: 'line', analysisType: 'trend', label: '折线图' };
      }
      if (hasNonNegatedChartIntent(lower, /(散点图?|scatter\s*(plot|chart|graph)?)/i, /(不要|不想|不是|非).{0,8}(散点|scatter)/i)) {
        return { chartType: 'scatter', analysisType: 'correlation', label: '散点图' };
      }
      if (hasNonNegatedChartIntent(lower, /(箱线图?|箱型图?|box\s*plot|boxplot)/i, /(不要|不想|不是|非).{0,8}(箱线|箱型|box)/i)) {
        return { chartType: 'boxplot', analysisType: 'comparison', label: '箱线图' };
      }
      if (hasNonNegatedChartIntent(lower, /(小提琴图?|violin)/i, /(不要|不想|不是|非).{0,8}(小提琴|violin)/i)) {
        return { chartType: 'violin', analysisType: 'distribution', label: '小提琴图' };
      }
      if (hasNonNegatedChartIntent(lower, /(直方图?|histogram)/i, /(不要|不想|不是|非).{0,8}(直方|histogram)/i)) {
        return { chartType: 'histogram', analysisType: 'distribution', label: '直方图' };
      }
      if (hasNonNegatedChartIntent(lower, /(热力图?|heat\s*map|heatmap)/i, /(不要|不想|不是|非).{0,8}(热力|heat)/i)) {
        return { chartType: 'heatmap', analysisType: 'multivariate', label: '热力图' };
      }
      if (hasNonNegatedChartIntent(lower, /(面积图?|area\s*(plot|chart|graph)?)/i, /(不要|不想|不是|非).{0,8}(面积|area)/i)) {
        return { chartType: 'area', analysisType: 'trend', label: '面积图' };
      }
      if (hasNonNegatedChartIntent(lower, /(密度图?|density)/i, /(不要|不想|不是|非).{0,8}(密度|density)/i)) {
        return { chartType: 'density', analysisType: 'distribution', label: '密度图' };
      }
      if (hasNonNegatedChartIntent(lower, /(饼图|pie\s*(chart)?)/i, /(不要|不想|不是|非).{0,8}(饼图|pie)/i)) {
        return { chartType: 'pie', analysisType: 'composition', label: '饼图' };
      }
      if (!/error\s*bar/i.test(lower) && hasNonNegatedChartIntent(lower, /(柱状图?|柱形图?|条形图?|bar\s*(plot|chart|graph)?)/i, /(不要|不想|不是|非).{0,8}(柱状|柱形|条形|bar\s*(plot|chart|graph)?)/i)) {
        return { chartType: 'bar', analysisType: 'comparison', label: '柱状图' };
      }
      return null;
    }

    function applyUserQueryChartPreference(inferred, queryText) {
      var preference = inferRChartTypeFromUserQuery(queryText);
      if (!preference) return inferred;
      return Object.assign({}, inferred || {}, {
        chartType: preference.chartType,
        analysisType: preference.analysisType || (inferred && inferred.analysisType) || 'comparison',
        userChartPreference: preference
      });
    }

    function buildUserQueryPriorityRBlock(queryText, chartPreference) {
      var query = String(queryText || '').trim();
      if (!query) return '';
      var lines = [
        '【用户原始 query 是最高优先级】',
        '用户原始 query：' + query,
        '如果用户原始 query 与自动数据分析推荐、默认图表类型、变量类型推断冲突，必须服从用户原始 query。'
      ];
      if (chartPreference && chartPreference.chartType) {
        lines.push('已从用户 query 明确识别图型：' + chartPreference.label + '（chartType=' + chartPreference.chartType + '）。必须生成该图型，不得改成其他图型。');
        if (chartPreference.chartType === 'line') {
          lines.push('用户要求折线图时，主图层必须包含 geom_line()，通常还应包含 geom_point()；禁止用 geom_col()/geom_bar() 生成柱状图来替代。');
        }
        if (chartPreference.chartType === 'bar' || chartPreference.chartType === 'grouped_bar' || chartPreference.chartType === 'stacked_bar') {
          lines.push('用户要求柱状图时才使用 geom_col()/geom_bar()；不要在用户要求折线/散点/箱线时自动切回柱状图。');
        }
      }
      return lines.join('\n');
    }

    function inferRPlotConfigFromDataAnalysis(selections) {
      var methods = Array.isArray(selections.methods) && selections.methods.length ? selections.methods : [selections.method || 'descriptive'];
      var method = methods[0] || 'descriptive';
      var numericA = selections.numericVar || selections.dependentVar || firstDataAnalysisVariable('numeric');
      var numericB = selections.numericVar2 || (selections.predictorVars && selections.predictorVars[0]) || firstDataAnalysisVariable('numeric', [numericA]);
      var group = selections.groupVar || selections.categoryVar || firstDataAnalysisVariable('categorical');
      var categoryB = selections.categoryVar2 || firstDataAnalysisVariable('categorical', [group]);
      var dependent = selections.dependentVar || numericA;
      var predictors = Array.isArray(selections.predictorVars) ? selections.predictorVars : [];
      var inferred;

      if (methods.indexOf('independent_t') >= 0 || methods.indexOf('anova') >= 0 || methods.indexOf('nonparametric') >= 0 || methods.indexOf('variance_homogeneity') >= 0) {
        inferred = { chartType: 'boxplot', analysisType: 'comparison', variables: [numericA, group].filter(Boolean) };
      } else if (methods.indexOf('paired_t') >= 0) {
        inferred = { chartType: 'line', analysisType: 'comparison', variables: [numericA, numericB].filter(Boolean) };
      } else if (methods.indexOf('correlation') >= 0) {
        inferred = { chartType: 'scatter', analysisType: 'correlation', variables: [numericA, numericB].filter(Boolean) };
      } else if (methods.indexOf('regression') >= 0) {
        inferred = { chartType: 'scatter', analysisType: 'correlation', variables: [dependent].concat(predictors.length ? predictors : [numericB]).filter(Boolean) };
      } else if (methods.indexOf('pca') >= 0) {
        inferred = { chartType: 'scatter', analysisType: 'multivariate', variables: [numericA, numericB].filter(Boolean) };
      } else if (methods.indexOf('cluster') >= 0) {
        inferred = { chartType: 'heatmap', analysisType: 'multivariate', variables: [numericA, numericB].filter(Boolean) };
      } else if (methods.indexOf('chi_square') >= 0) {
        inferred = { chartType: 'grouped_bar', analysisType: 'composition', variables: [group, categoryB].filter(Boolean) };
      } else if (method === 'visualization') {
        if (numericA && group) inferred = { chartType: 'boxplot', analysisType: 'comparison', variables: [numericA, group] };
        else if (numericA && numericB) inferred = { chartType: 'scatter', analysisType: 'correlation', variables: [numericA, numericB] };
        else inferred = { chartType: 'bar', analysisType: 'composition', variables: [group].filter(Boolean) };
      } else {
        inferred = { chartType: group ? 'boxplot' : 'histogram', analysisType: 'distribution', variables: [numericA, group].filter(Boolean) };
      }
      return applyUserQueryChartPreference(inferred, selections.extraQuery || '');
    }

    function buildDataAnalysisRRequirements(selections, resultMarkdown) {
      var inferred = inferRPlotConfigFromDataAnalysis(selections);
      var significance = dataAnalysisLastResult && dataAnalysisLastResult.result ? dataAnalysisLastResult.result.significance : null;
      var methods = Array.isArray(selections.methods) && selections.methods.length ? selections.methods : [selections.method || 'descriptive'];
      var extraQuery = selections.extraQuery || getDataAnalysisExtraQuery();
      var userQueryPriorityBlock = buildUserQueryPriorityRBlock(extraQuery, inferred.userChartPreference);
      var lines = [
        '这是从“数据分析”功能联动生成的 R 作图需求。',
        userQueryPriorityBlock,
        '数据分析方法：' + formatDataAnalysisMethodNames(methods) + '。',
        '如果用户多选了多个分析，请把这些分析和对应图形整合到同一个 R 代码文件中；可以生成多个图对象并统一保存为多个 PDF/PNG，或组合成一个多面板图。',
        extraQuery ? '用户额外要求：' + extraQuery : '用户额外要求：无。',
        inferred.variables.length ? '请优先使用这些变量作图：' + inferred.variables.join(', ') + '。' : '请根据数据结构选择最合适的变量作图。',
        '图形需要服务于统计分析结果，适合放入当前项目的结果、数据或支撑材料部分。',
        '显著性标注必须严格按照数据分析结果、用户补充说明或 R 代码真实计算结果；没有真实显著性信息时，不要标注 x、xx、xxx、p 值、星号或 abc 字母占位。',
        '坐标轴标题使用数据列名；如果横坐标是日期/时间/年份/月度数据，必须转换为 Date/POSIXct 连续时间轴，并按周、月、季度或年设置 date_breaks，同时默认设置 date_labels = "%Y-%m-%d"，显示为 2026-03-02 这种格式，禁止显示所有日期导致重叠，也不要用“5月 27”这类中文月份格式；图例必须根据数据分布放在左上角或右上角，或放在图外顶部/右侧，禁止放在图中间遮挡数据；输出 PDF 和高分辨率 PNG。'
      ];
      if (significance) {
        lines.push('结构化显著性信息如下，R 代码必须优先按这里的 comparisons / p 值 / stars 标注：');
        lines.push(JSON.stringify(significance, null, 2).slice(0, 4000));
      } else if (selections.method === 'independent_t' || selections.method === 'paired_t' || selections.method === 'anova') {
        lines.push('当前没有结构化显著性信息时，不要在图中预留 x/xx/xxx 显著性占位；如果用户明确要求 abc 字母分组，必须先在 R 代码中真实计算 post-hoc 和 compact letter display，计算不出则不标注并在代码注释说明。');
      }
      if (selections.method === 'correlation' || selections.method === 'regression') {
        lines.push('请添加拟合线或置信带，并突出变量关系。');
      }
      if (selections.method === 'chi_square') {
        lines.push('请使用分组柱状图或比例柱状图展示两个分类变量的关系。');
      }
      if (resultMarkdown) {
        lines.push('数据分析结果摘要如下，请据此设计图形，但不要把长表格硬塞进图中：');
        lines.push(String(resultMarkdown).slice(0, 1600));
      }
      return appendRPlotTreatmentColorRequirements(lines.join('\n'), selections);
    }

    function updateDataAnalysisPlotLink(resultMarkdown) {
      var fileInput = document.getElementById('dataAnalysisFile');
      var file = fileInput && fileInput.files && fileInput.files.length > 0
        ? fileInput.files[0]
        : (dataAnalysisPlotLink && dataAnalysisPlotLink.file);
      if (!file || !dataAnalysisStructure) return null;
      var selections = getDataAnalysisSelectionSnapshot();
      var inferred = inferRPlotConfigFromDataAnalysis(selections);
      dataAnalysisPlotLink = {
        file: file,
        filename: file.name,
        structure: dataAnalysisStructure,
        selections: selections,
        chartType: inferred.chartType,
        analysisType: inferred.analysisType,
        userChartPreference: inferred.userChartPreference || null,
        significance: dataAnalysisLastResult && dataAnalysisLastResult.result ? dataAnalysisLastResult.result.significance : null,
        customRequirements: buildDataAnalysisRRequirements(selections, resultMarkdown || '')
      };
      return dataAnalysisPlotLink;
    }

    function ensureDataAnalysisPlotLink(resultMarkdown) {
      var linked = updateDataAnalysisPlotLink(resultMarkdown);
      if (linked) return linked;
      if (dataAnalysisPlotLink && dataAnalysisPlotLink.file) return dataAnalysisPlotLink;
      alert('请先在“数据分析”里上传数据文件并选择分析方法');
      return null;
    }

    window.openRPlotDialogFromDataAnalysis = function() {
      var link = ensureDataAnalysisPlotLink(dataAnalysisLastResult && dataAnalysisLastResult.result ? dataAnalysisLastResult.result.markdown : '');
      if (!link) return;
      showRPlotDialog();
    };

    window.generateRPlotFromDataAnalysis = async function() {
      var link = ensureDataAnalysisPlotLink(dataAnalysisLastResult && dataAnalysisLastResult.result ? dataAnalysisLastResult.result.markdown : '');
      if (!link) return;
      loadApiConfig();
      var resultDiv = document.getElementById('dataAnalysisResult');
      if (!apiConfig.url || !apiConfig.key) {
        if (resultDiv) {
          resultDiv.style.display = 'block';
          resultDiv.style.background = 'rgba(220,38,38,0.15)';
          resultDiv.textContent = '请先在配置里填写 API，R 作图代码需要调用模型生成';
        } else {
          alert('请先在配置里填写 API');
        }
        return;
      }

      var themeId = 'paper_clean';
      var selectedTheme = R_THEMES.find(function(theme) { return theme.id === themeId; });
      var themeCode = selectedTheme ? selectedTheme.code : '';
      if (resultDiv) {
        resultDiv.style.display = 'block';
        resultDiv.style.background = 'rgba(255,193,7,0.15)';
        resultDiv.textContent = '正在根据数据分析结果生成 R 作图代码...';
      }

      try {
        var formData = new FormData();
        formData.append('file', link.file);
        formData.append('userId', currentUserId);
        formData.append('apiUrl', apiConfig.url);
        formData.append('apiKey', apiConfig.key);
        formData.append('model', currentModel);
        formData.append('chartType', link.chartType || 'boxplot');
        formData.append('analysisType', link.analysisType || 'comparison');
        formData.append('customRequirements', link.customRequirements || '');
        formData.append('workDir', '');
        formData.append('dataFilename', link.filename || link.file.name);
        formData.append('themeCode', themeCode);
        formData.append('themeId', themeId);
        formData.append('treatmentPaletteConfig', getRPlotTreatmentPaletteConfigJson(link.selections || {}));
        formData.append('mode', 'new');
        formData.append('linkedFromDataAnalysis', 'true');
        formData.append('analysisResult', dataAnalysisLastResult && dataAnalysisLastResult.result ? (dataAnalysisLastResult.result.markdown || '') : '');
        formData.append('analysisSelections', JSON.stringify(link.selections || {}));
        formData.append('analysisSignificance', JSON.stringify(link.significance || null));

        var response = await fetch('/api/r-code/generate', { method: 'POST', body: formData });
        var result = await response.json();
        if (!result.success) {
          throw new Error(result.error || '生成失败');
        }

        if (resultDiv) {
          resultDiv.style.background = 'rgba(16,163,127,0.15)';
          resultDiv.innerHTML = 'R 作图代码已生成，正在直接出图...';
        }
        appendMessage(buildRCodeChatMarkdown('## 📈 基于数据分析联动生成的 R 作图代码', '', result.data.rCode), 'bot', false, true);
        var savedCodePath = await saveRCodeToDesktop(result.data.rCode, link.filename || link.file.name);
        await executeGeneratedRPlot({
          rCode: result.data.rCode,
          file: link.file,
          dataFilename: result.data.dataFilename || link.filename || link.file.name,
          originalFilename: link.filename || link.file.name,
          codePath: savedCodePath || '',
          instruction: link.customRequirements || '',
          chartType: link.chartType || '',
          analysisType: link.analysisType || '',
          themeId: themeId,
          themeCode: themeCode,
          resultDiv: resultDiv,
          label: '基于数据分析联动的 R 图表'
        });
        closeModal();
      } catch (e) {
        if (resultDiv) {
          resultDiv.style.background = 'rgba(220,38,38,0.15)';
          resultDiv.textContent = 'R 作图生成失败：' + e.message;
        } else {
          alert('R 作图生成失败：' + e.message);
        }
      }
    };

    async function runDataAnalysis() {
      var resultDiv = document.getElementById('dataAnalysisResult');
      var fileInput = document.getElementById('dataAnalysisFile');
      if (!resultDiv || !fileInput || !fileInput.files || fileInput.files.length === 0) {
        if (resultDiv) {
          resultDiv.style.display = 'block';
          resultDiv.style.background = 'rgba(220,38,38,0.15)';
          resultDiv.textContent = '请先上传数据文件';
        }
        return;
      }

      var methods = getDataAnalysisSelectedMethods();
      var method = methods[0] || 'descriptive';
      var predictorsSelect = document.getElementById('daPredictorVars');
      var dependent = document.getElementById('daDependentVar')?.value || '';
      var predictorVars = predictorsSelect
        ? Array.from(predictorsSelect.selectedOptions).map(function(option) { return option.value; }).filter(function(value) { return value && value !== dependent; })
        : [];

      resultDiv.style.display = 'block';
      resultDiv.style.background = 'rgba(255,193,7,0.15)';
      resultDiv.textContent = '正在分析数据...';

      var formData = new FormData();
      formData.append('file', fileInput.files[0]);
      formData.append('userId', currentUserId || 'web-user');
      formData.append('method', method);
      formData.append('methods', JSON.stringify(methods));
      formData.append('numericVar', document.getElementById('daNumericVar')?.value || '');
      formData.append('numericVar2', document.getElementById('daNumericVar2')?.value || '');
      formData.append('groupVar', document.getElementById('daGroupVar')?.value || '');
      formData.append('categoryVar', document.getElementById('daCategoryVar')?.value || '');
      formData.append('categoryVar2', document.getElementById('daCategoryVar2')?.value || '');
      formData.append('dependentVar', dependent);
      formData.append('predictorVars', JSON.stringify(predictorVars));
      formData.append('extraQuery', getDataAnalysisExtraQuery());

      try {
        var response = await fetch('/api/data-analysis/analyze', { method: 'POST', body: formData });
        var result = await response.json();
        if (!result.success) {
          resultDiv.style.background = 'rgba(220,38,38,0.15)';
          resultDiv.textContent = '分析失败：' + (result.error || '未知错误');
          return;
        }

        var markdown = result.data.result.markdown || '';
        dataAnalysisLastResult = result.data;
        updateDataAnalysisPlotLink(markdown);
        resultDiv.style.background = 'rgba(16,163,127,0.15)';
        resultDiv.innerHTML =
          '分析完成，结果已发送到对话区。' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">' +
            '<button type="button" onclick="generateRPlotFromDataAnalysis()" style="padding:6px 9px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">生成R作图并出图</button>' +
            '<button type="button" onclick="openRPlotDialogFromDataAnalysis()" style="padding:6px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-bg);color:var(--text-primary);cursor:pointer;font-size:12px;">打开R作图配置</button>' +
          '</div>';
        appendMessage(markdown, 'bot', false, true);
      } catch (e) {
        resultDiv.style.background = 'rgba(220,38,38,0.15)';
        resultDiv.textContent = '分析出错：' + e.message;
      }
    }
    window.runDataAnalysis = runDataAnalysis;

    // ============ 数据分析功能结束 ============

    // ============ R 语言作图功能 ============
    
    var rPluginInstallPollTimer = null;
    var rPluginInstallLastTerminalStatus = '';
    var pythonPluginInstallPollTimer = null;
    var pythonPluginInstallLastTerminalStatus = '';
    var officeCliInstallPollTimer = null;
    var officeCliInstallLastTerminalStatus = '';
    var RECENT_R_PLOT_CONTEXT_PREFIX = 'scholarharness_recent_r_plot_context_';
    var recentRPlotRuntimeContext = null;

    function getRecentRPlotContextKey() {
      return RECENT_R_PLOT_CONTEXT_PREFIX + (currentUserId || 'web-user') + '_' + (currentConversationId || 'default');
    }

    function serializeRPlotFiles(files) {
      return (Array.isArray(files) ? files : []).map(function(file) {
        return {
          name: file.name || file.relativePath || '',
          relativePath: file.relativePath || '',
          url: file.url || '',
          size: file.size || 0,
          kind: file.kind || ''
        };
      }).filter(function(file) { return file.name || file.url || file.relativePath; });
    }

    function joinLocalRPath(dir, filename) {
      var base = String(dir || '').trim();
      var name = String(filename || '').trim();
      if (!base || !name) return '';
      var separator = base.indexOf('\\') >= 0 ? '\\' : '/';
      return base.replace(/[\\\/]+$/g, '') + separator + name.replace(/^[\\\/]+/g, '');
    }

    function inferRecentRPlotDataFilePath(context) {
      if (!context) return '';
      if (context.dataFilePath) return String(context.dataFilePath);
      var filename = context.dataFilename || context.originalFilename || '';
      if (!filename || /^https?:\/\//i.test(filename)) return '';
      if (context.workDir) return joinLocalRPath(context.workDir, filename);
      return '';
    }

    function getRecentRPlotCodePath(context) {
      if (!context) return '';
      return String(context.codePath || context.scriptPath || '').trim();
    }

    function buildRecentRPlotMarkdown(context) {
      if (!context || !context.available) return '';
      var lines = [
        '## 最近一次 R 作图上下文',
        '用户可能会继续说“把刚才的图改一下、调整图例、改颜色、改坐标轴”等。此时必须沿用下面这次作图的 Excel 数据、R 代码、输出图和工作目录，不要假装不知道上一张图。',
        '',
        '- 数据文件：' + (context.dataFilename || context.originalFilename || '未知'),
        '- 图表类型：' + (context.chartType || '未知'),
        '- 分析类型：' + (context.analysisType || '未知'),
        '- 工作目录：' + (context.workDir || '未知'),
        '- R 脚本路径：' + (context.scriptPath || context.codePath || '未知'),
        '- 数据文件路径：' + (context.dataFilePath || inferRecentRPlotDataFilePath(context) || '未知'),
        '- 代码文件：' + (context.codePath || '未保存到本地路径'),
        '- 用户原始作图要求：' + (context.instruction || '无')
      ];
      var files = serializeRPlotFiles(context.files || context.imageFiles);
      if (files.length) {
        lines.push('', '### 输出文件');
        files.forEach(function(file) {
          lines.push('- ' + (file.relativePath || file.name || 'artifact') + (file.url ? '：' + file.url : ''));
        });
      }
      if (context.rCode) {
        lines.push('', '### 上一次使用的 R 代码', '```r', String(context.rCode).slice(0, 24000), '```');
      }
      return lines.join('\n');
    }

    function loadRecentRPlotContext() {
      if (recentRPlotRuntimeContext && recentRPlotRuntimeContext.available) return recentRPlotRuntimeContext;
      try {
        var stored = JSON.parse(localStorage.getItem(getRecentRPlotContextKey()) || 'null');
        if (stored && stored.available) return stored;
      } catch (e) {}
      return null;
    }

    function rememberRecentRPlotContext(options, execData, markdown) {
      var files = serializeRPlotFiles(execData && execData.files);
      var imageFiles = serializeRPlotFiles(execData && execData.imageFiles);
      var context = {
        available: true,
        generatedAt: new Date().toISOString(),
        instruction: options && options.instruction ? String(options.instruction) : '',
        dataFilename: options && options.dataFilename ? String(options.dataFilename) : '',
        originalFilename: options && options.originalFilename ? String(options.originalFilename) : '',
        chartType: options && options.chartType ? String(options.chartType) : '',
        analysisType: options && options.analysisType ? String(options.analysisType) : '',
        themeId: options && options.themeId ? String(options.themeId) : '',
        themeCode: options && options.themeCode ? String(options.themeCode).slice(0, 12000) : '',
        rCode: String(options && options.rCode || '').slice(0, 30000),
        codePath: options && options.codePath ? String(options.codePath) : '',
        scriptPath: execData && execData.scriptPath ? String(execData.scriptPath) : '',
        dataFilePath: execData && execData.dataFilePath ? String(execData.dataFilePath) : (options && options.sourceDataFilePath ? String(options.sourceDataFilePath) : ''),
        workDir: execData && execData.workDir ? String(execData.workDir) : '',
        plotDir: execData && execData.plotDir ? String(execData.plotDir) : '',
        files: files,
        imageFiles: imageFiles,
        markdown: String(markdown || '').slice(0, 6000)
      };
      recentRPlotRuntimeContext = Object.assign({}, context, {
        file: options && options.file ? options.file : null
      });
      try {
        localStorage.setItem(getRecentRPlotContextKey(), JSON.stringify(context));
      } catch (e) {}
      saveConversationMessageLocal('assistant', buildRecentRPlotMarkdown(context), false);
    }

    function buildRecentRPlotContextForChat() {
      var context = loadRecentRPlotContext();
      if (!context || !context.available) return null;
      return {
        available: true,
        generatedAt: context.generatedAt || '',
        contextMarkdown: buildRecentRPlotMarkdown(context)
      };
    }

    function isRecentRPlotFollowupRequest(message) {
      var text = String(message || '');
      if (!text.trim()) return false;
      var context = loadRecentRPlotContext();
      if (!context || !context.available) return false;
      var refersToPlot = /(刚才|上次|上一张|这个图|这张图|这个|现在的|图|图片|plot|figure|r\s*图|作图)/i.test(text);
      var wantsEdit = /(改|调整|修改|优化|重新|再画|再生成|生成|出图|运行|执行|发给|展示|显示|看见|看到|没看见|没看到|没有图片|换|移动|放到|去掉|添加|加上|变成|改成|换成|替换|要的是|而不是|不是|颜色|配色|字体|字号|图例|legend|坐标|横坐标|纵坐标|x轴|y轴|标题|误差|误差棒|error\s*bar|阴影|置信区间|ribbon|shade|shadow|显著|标注|宽|高|大小|分辨率|导出|水平|斜着|倾斜|旋转|日期|刻度|标签)/i.test(text);
      var directPlotEdit = /(坐标轴|坐标|横坐标|纵坐标|x轴|y轴|日期|刻度|标签|图例|legend|颜色|配色|字体|字号|标题|水平|斜着|倾斜|旋转|误差棒|error\s*bar|阴影|置信区间|ribbon|shade|shadow|显著性|分辨率|png|pdf|svg)/i.test(text)
        && /(不要|别|改|调整|修改|优化|重新|再|换|移动|放到|去掉|添加|加上|变成|改成|换成|替换|设为|设置|显示|水平|斜着|倾斜|旋转|要的是|而不是|不是)/i.test(text);
      return (refersToPlot && wantsEdit) || directPlotEdit;
    }

    function isRecentRPlotRerunOnlyRequest(message) {
      var text = String(message || '');
      var asksForImage = /(没看见|没看到|没有图片|看不到图|看不见图|直接.*(?:生成|发|给|展示|显示).*图|(?:生成|重新生成|再生成|出图|运行|执行|展示|显示|发给).*(?:图|图片|plot|figure))/i.test(text);
      var asksForChange = /(改|调整|修改|优化|换|移动|放到|去掉|添加|加上|变成|颜色|配色|字体|字号|图例|legend|坐标|横坐标|纵坐标|x轴|y轴|标题|误差|显著|标注|宽|高|大小|分辨率|导出|水平|斜着|倾斜|旋转|日期|刻度|标签)/i.test(text);
      return asksForImage && !asksForChange;
    }

    function parseToolIntentJson(rawText) {
      var text = String(rawText || '').trim();
      var codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (codeBlock) text = String(codeBlock[1] || '').trim();
      var jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) text = jsonMatch[0];
      return JSON.parse(text);
    }

    function normalizeRecentRPlotToolIntent(value) {
      var intent = String(value && value.intent || '').trim();
      if (['r_plot_modify', 'r_plot_rerun', 'chat'].indexOf(intent) < 0) intent = 'chat';
      var confidence = Number(value && value.confidence);
      if (!isFinite(confidence)) confidence = intent === 'chat' ? 0.5 : 0.7;
      confidence = Math.max(0, Math.min(1, confidence));
      return {
        intent: intent,
        confidence: confidence,
        reason: String(value && value.reason || '').slice(0, 240),
        source: String(value && value.source || 'ai')
      };
    }

    function inferRecentRPlotToolIntentFallback(message) {
      var text = String(message || '');
      var context = loadRecentRPlotContext();
      if (!context || !context.available || !text.trim()) {
        return { intent: 'chat', confidence: 0.4, reason: '没有最近 R 图上下文', source: 'fallback' };
      }
      if (isRecentRPlotRerunOnlyRequest(text)) {
        return { intent: 'r_plot_rerun', confidence: 0.82, reason: '用户要求重新展示或生成上一张图', source: 'fallback' };
      }
      if (isRecentRPlotFollowupRequest(text)) {
        return { intent: 'r_plot_modify', confidence: 0.78, reason: '用户提到上一张图的样式或图形元素修改', source: 'fallback' };
      }
      var chartTerms = /(误差棒|error\s*bar|阴影|置信区间|ribbon|shade|shadow|折线|曲线|柱状|箱线|散点|图例|坐标轴|横坐标|纵坐标|刻度|标签|显著性|颜色|配色|字号|标题)/i.test(text);
      var editTerms = /(我要的是|要的是|而不是|不是|不要|别|改成|换成|替换|应该|需要|改|调|换|去掉|加上|添加|显示|不要显示)/i.test(text);
      if (chartTerms && editTerms) {
        return { intent: 'r_plot_modify', confidence: 0.86, reason: '用户使用图形术语表达修改意图', source: 'fallback' };
      }
      return { intent: 'chat', confidence: 0.55, reason: '未检测到明确 R 图工具调用意图', source: 'fallback' };
    }

    async function classifyRecentRPlotToolIntent(message) {
      var fallback = inferRecentRPlotToolIntentFallback(message);
      var context = loadRecentRPlotContext();
      if (!context || !context.available) return fallback;
      loadApiConfig();
      if (!apiConfig.url || !apiConfig.key) return fallback;

      var normalizedApiUrl = normalizeApiBaseUrl(apiConfig.url || '');
      var endpoint = normalizedApiUrl.indexOf('/chat/completions') >= 0
        ? normalizedApiUrl
        : normalizedApiUrl.replace(/\/+$/g, '') + '/chat/completions';
      var controller = new AbortController();
      var timer = setTimeout(function() { controller.abort(); }, 6000);
      try {
        var response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiConfig.key
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: apiConfig.model || currentModel || 'qwen3.5-plus',
            temperature: 0,
            max_tokens: 220,
            messages: [
              {
                role: 'system',
                content: [
                  '你是 Scholar Harness 的工具意图路由器，只判断用户这一句是否应该调用 R 作图插件。',
                  '已有最近一次 R 图上下文时，用户可能自然表达改图需求，例如“我要的是误差棒，不是阴影”“日期别斜着”“把图例移到右上角”。这些都属于 r_plot_modify。',
                  '如果用户只是说没看到图、重新发图、再生成图片、直接展示上一张图，属于 r_plot_rerun。',
                  '如果用户是在普通论文写作、解释概念、闲聊、配置界面问题，属于 chat。',
                  '不要根据第几次对话判断，只根据用户文本语义判断。',
                  '只返回 JSON：{"intent":"r_plot_modify|r_plot_rerun|chat","confidence":0到1,"reason":"简短中文原因"}'
                ].join('\n')
              },
              {
                role: 'user',
                content: [
                  '最近 R 图：',
                  '- 数据文件：' + (context.dataFilename || context.originalFilename || '未知'),
                  '- 图表类型：' + (context.chartType || '未知'),
                  '- 最近输出：' + serializeRPlotFiles(context.imageFiles || context.files).map(function(file) { return file.relativePath || file.name; }).join('、'),
                  '',
                  '用户新消息：' + String(message || '')
                ].join('\n')
              }
            ]
          })
        });
        clearTimeout(timer);
        if (!response.ok) throw new Error('intent route HTTP ' + response.status);
        var data = await response.json();
        var content = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
        var intent = normalizeRecentRPlotToolIntent(Object.assign(parseToolIntentJson(content), { source: 'ai' }));
        if (fallback.intent !== 'chat' && intent.intent === 'chat' && intent.confidence < 0.82) {
          return fallback;
        }
        return intent;
      } catch (error) {
        clearTimeout(timer);
        console.warn('[ToolIntentRouter] AI classification failed, using fallback:', error);
        return fallback;
      }
    }

    function isWorkspaceRPlotRequest(message) {
      var text = String(message || '');
      if (!text.trim()) return false;
      if (/@\s*codex/i.test(text)) return false;
      var asksR = /(R\s*语言|R\s*作图|R\s*代码|R\s*插件|用\s*R|ggplot|Rscript|r\s*plot)/i.test(text);
      var asksPlot = /(作图|画图|绘图|出图|生成.*图|plot|figure|箱线图|柱状图|折线图|散点图|热图|PCA|主成分|相关图|火山图|小提琴图)/i.test(text);
      var hasWorkspaceSignal = /(工作目录|路径|目录|文件|数据|xlsx?|csv|tsv|txt|[A-Za-z]:[\\/])/i.test(text);
      return asksR && asksPlot && hasWorkspaceSignal;
    }

    function isRPlotDataFilename(value) {
      return /\.(?:xlsx|xls|csv|tsv|txt)$/i.test(String(value || '').trim());
    }

    function trimLocalPathText(value) {
      return String(value || '')
        .replace(/^["'“”‘’]+|["'“”‘’，。；;、\s]+$/g, '')
        .trim();
    }

    function extractDirectRPlotDataFilePath(message) {
      var text = String(message || '');
      var matches = text.match(/[A-Za-z]:[\\/][^\r\n"'<>|]*?\.(?:xlsx|xls|csv|tsv|txt)\b/ig) || [];
      for (var i = 0; i < matches.length; i += 1) {
        var candidate = trimLocalPathText(matches[i]);
        if (isRPlotDataFilename(candidate)) return candidate;
      }
      return '';
    }

    function getLocalPathBasename(filePath) {
      var parts = String(filePath || '').split(/[\\/]+/);
      return parts[parts.length - 1] || String(filePath || '');
    }

    function getLocalPathDirname(filePath) {
      var text = String(filePath || '').replace(/[\\/]+$/g, '');
      var index = Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/'));
      return index > 0 ? text.slice(0, index) : '';
    }

    function stripFileExtension(name) {
      return String(name || '').replace(/\.[^.]+$/g, '');
    }

    function extractWorkspaceRPlotFileHints(message) {
      var text = String(message || '');
      var hints = [];
      var fullDataPath = extractDirectRPlotDataFilePath(text);
      if (fullDataPath) {
        hints.push(getLocalPathBasename(fullDataPath));
        hints.push(stripFileExtension(getLocalPathBasename(fullDataPath)));
      }
      var dataNames = text.match(/[\w\u4e00-\u9fff .()（）\-\[\]]+\.(?:xlsx|xls|csv|tsv|txt)\b/ig) || [];
      dataNames.forEach(function(name) {
        var clean = trimLocalPathText(name);
        if (clean) {
          hints.push(getLocalPathBasename(clean));
          hints.push(stripFileExtension(getLocalPathBasename(clean)));
        }
      });
      var tokens = text.match(/[A-Za-z0-9_\-]{4,}/g) || [];
      tokens.forEach(function(token) {
        if (!/^(?:xlsx?|csv|tsv|txt|plot|figure|ggplot|rscript)$/i.test(token)) hints.push(token);
      });
      var seen = {};
      return hints.map(function(item) { return String(item || '').trim(); })
        .filter(function(item) {
          if (!item || item.length < 3) return false;
          var key = item.toLowerCase();
          if (seen[key]) return false;
          seen[key] = true;
          return true;
        });
    }

    function scoreWorkspaceRPlotDataFile(fileInfo, message, hints) {
      var pathText = String(fileInfo && fileInfo.path || '');
      if (!isRPlotDataFilename(pathText)) return -1;
      var lowerPath = pathText.toLowerCase();
      var basename = getLocalPathBasename(pathText);
      var lowerBase = basename.toLowerCase();
      var lowerStem = stripFileExtension(basename).toLowerCase();
      var lowerMessage = String(message || '').toLowerCase();
      var score = 0;
      if (lowerMessage.indexOf(lowerBase) >= 0) score += 80;
      if (lowerStem && lowerMessage.indexOf(lowerStem) >= 0) score += 45;
      (hints || []).forEach(function(hint) {
        var lowerHint = String(hint || '').toLowerCase();
        if (!lowerHint) return;
        if (lowerBase === lowerHint) score += 90;
        else if (lowerStem === lowerHint) score += 60;
        else if (lowerPath.indexOf(lowerHint) >= 0) score += 30;
      });
      if (/data|result|figure|plot|raw|clean|统计|结果|数据|图/i.test(pathText)) score += 4;
      return score;
    }

    async function locateWorkspaceRPlotDataFile(message, workspacePayload) {
      var directPath = extractDirectRPlotDataFilePath(message);
      if (directPath) {
        return {
          sourceDataFilePath: directPath,
          dataFilename: getLocalPathBasename(directPath),
          workDir: getLocalPathDirname(directPath),
          matchedBy: 'direct-path'
        };
      }
      if (!workspacePayload || !workspacePayload.path) return null;

      var response = await fetch('/api/chat-bridge/workspace/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workspacePayload)
      });
      var payload = await response.json().catch(function() { return {}; });
      if (!response.ok || !payload.success || !payload.workspace) {
        throw new Error(payload.error || '工作目录检查失败');
      }
      var files = Array.isArray(payload.workspace.files) ? payload.workspace.files : [];
      var dataFiles = files.filter(function(file) { return file && isRPlotDataFilename(file.path); });
      if (!dataFiles.length) {
        throw new Error('工作目录中没有找到 Excel/CSV/TXT/TSV 数据文件。请在消息中写明具体数据文件路径，或先把数据文件放到工作目录里。');
      }
      var hints = extractWorkspaceRPlotFileHints(message);
      var ranked = dataFiles.map(function(file) {
        return { file: file, score: scoreWorkspaceRPlotDataFile(file, message, hints) };
      }).sort(function(a, b) { return b.score - a.score; });
      var selected = null;
      if (ranked[0] && ranked[0].score > 0) {
        selected = ranked[0].file;
      } else if (dataFiles.length === 1) {
        selected = dataFiles[0];
      }
      if (!selected) {
        var options = dataFiles.slice(0, 12).map(function(file, index) {
          return (index + 1) + '. ' + file.path;
        }).join('\n');
        appendMessage('我检测到这是 R 作图请求，但工作目录里有多个数据文件。请在消息里写明要用哪个文件名或完整路径：\n\n' + options, 'bot', false, true);
        return { needsUserChoice: true };
      }
      var root = payload.workspace.root || workspacePayload.path;
      return {
        sourceDataFilePath: joinLocalRPath(root, selected.path),
        dataFilename: getLocalPathBasename(selected.path),
        workDir: root,
        matchedBy: ranked[0] && ranked[0].score > 0 ? 'workspace-score' : 'workspace-single'
      };
    }

    function updateWorkspaceRPlotStatusMessage(messageElement, text) {
      if (!messageElement || !messageElement.isConnected) {
        return appendMessage(text, 'bot', false, true);
      }
      var replacement = createSharedChatMessageElement(text, 'bot', false, true);
      var currentContent = messageElement.querySelector(':scope > .content');
      var replacementContent = replacement.querySelector(':scope > .content');
      if (!currentContent || !replacementContent) {
        return messageElement;
      }
      currentContent.replaceWith(replacementContent);
      syncMessageLocalFileVisibilityClass(messageElement);
      scheduleChatMessageLayoutRepair(messageElement);
      maybeScrollChatToBottom(shouldAutoScrollChat());
      return messageElement;
    }

    async function runWorkspaceRPlotFromMessage(message, workspacePayload) {
      if (!isWorkspaceRPlotRequest(message)) return false;
      workspacePayload = workspacePayload || getWorkspaceDirectoryPayloadForMessage(message);
      var directPath = extractDirectRPlotDataFilePath(message);
      if (!workspacePayload && !directPath) return false;

      startToolWorkflowConversation(message);
      userInput.value = '';
      autoResize();
      loadApiConfig();
      if (!apiConfig.url || !apiConfig.key) {
        appendMessage('无法调用 R 插件生成图：请先在配置里填写小牛马文本 API。R 插件负责本地执行，但生成/修复 R 代码仍需要文本模型。', 'bot', false, true);
        return true;
      }

      setMainChatInputBusy(true);
      sendBtn.disabled = false;
      sendBtn.classList.add('sending');
      isGenerating = true;
      var progressMessage = appendMessage('已识别为工作目录 R 作图任务，正在定位数据文件并调用 R 插件...', 'bot', false, true);

      try {
        var dataFile = await locateWorkspaceRPlotDataFile(message, workspacePayload || { enabled: true, path: directPath, permission: 'read-only' });
        if (!dataFile || dataFile.needsUserChoice) return true;
        progressMessage = updateWorkspaceRPlotStatusMessage(
          progressMessage,
          '已定位数据文件：' + dataFile.sourceDataFilePath + '\n正在生成 R 作图代码...'
        );

        var themeId = 'paper_clean';
        var selectedTheme = Array.isArray(R_THEMES) ? R_THEMES.find(function(theme) { return theme.id === themeId; }) : null;
        var themeCode = selectedTheme ? selectedTheme.code : '';
        var chartPreference = inferRChartTypeFromUserQuery(message);
        var chartType = chartPreference && chartPreference.chartType ? chartPreference.chartType : 'boxplot';
        var analysisType = chartPreference && chartPreference.analysisType ? chartPreference.analysisType : 'comparison';
        var customRequirements = appendRPlotTreatmentColorRequirements([
          '这是从讨论式写作/工作目录触发的 R 作图任务。必须读取下面这个本地数据文件，并直接生成可运行 R 代码。',
          '数据文件路径：' + dataFile.sourceDataFilePath,
          '数据文件名：' + dataFile.dataFilename,
          '工作目录：' + (dataFile.workDir || ''),
          buildUserQueryPriorityRBlock(message, chartPreference),
          '用户原始要求：' + message
        ].filter(Boolean).join('\n\n'));

        var formData = new FormData();
        formData.append('userId', currentUserId || 'web-user');
        formData.append('apiUrl', apiConfig.url);
        formData.append('apiKey', apiConfig.key);
        formData.append('model', currentModel || apiConfig.model || 'qwen3.5-plus');
        formData.append('chartType', chartType);
        formData.append('analysisType', analysisType);
        formData.append('customRequirements', customRequirements);
        formData.append('workDir', dataFile.workDir || '');
        formData.append('dataFilename', dataFile.dataFilename || 'data.xlsx');
        formData.append('sourceDataFilePath', dataFile.sourceDataFilePath);
        formData.append('themeCode', themeCode);
        formData.append('themeId', themeId);
        formData.append('treatmentPaletteConfig', getRPlotTreatmentPaletteConfigJson());
        formData.append('mode', 'workspace-path');

        var response = await fetch('/api/r-code/generate', { method: 'POST', body: formData });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || 'R 作图代码生成失败');
        }

        appendMessage(buildRCodeChatMarkdown('## 📈 工作目录数据生成的 R 作图代码', '', result.data.rCode), 'bot', false, true);
        var savedCodePath = await saveRCodeToDesktop(result.data.rCode, dataFile.dataFilename || 'workspace-data.xlsx');
        await executeGeneratedRPlot({
          rCode: result.data.rCode,
          sourceDataFilePath: dataFile.sourceDataFilePath,
          dataFilename: result.data.dataFilename || dataFile.dataFilename || 'data.xlsx',
          originalFilename: dataFile.dataFilename || result.data.filename || 'workspace-data.xlsx',
          codePath: savedCodePath || '',
          instruction: message,
          chartType: chartType,
          analysisType: analysisType,
          themeId: themeId,
          themeCode: themeCode,
          label: '工作目录 R 图表'
        });
        return true;
      } catch (error) {
        appendMessage('工作目录 R 作图失败：' + (error.message || error), 'bot', false, true);
        return true;
      } finally {
        isGenerating = false;
        setMainChatInputBusy(false);
        sendBtn.classList.remove('sending');
        updateMainChatQueueButtonState();
      }
    }

    async function runRecentRPlotFollowup(message, toolIntent, workflowOptions) {
      var context = loadRecentRPlotContext();
      if (!context || !context.available) {
        return false;
      }
      workflowOptions = workflowOptions || {};
      if (workflowOptions.skipUserEcho) {
        ensureCurrentConversationId();
      } else {
        startToolWorkflowConversation(message);
        userInput.value = '';
        autoResize();
      }
      var normalizedToolIntent = normalizeRecentRPlotToolIntent(toolIntent || inferRecentRPlotToolIntentFallback(message));
      var rerunOnly = normalizedToolIntent.intent === 'r_plot_rerun' || isRecentRPlotRerunOnlyRequest(message);
      loadApiConfig();
      if (!rerunOnly && (!apiConfig.url || !apiConfig.key)) {
        appendMessage('无法修改上一张 R 图：请先在配置里填写小牛马文本 API，然后我会自动调用 R 插件重新出图。', 'bot', false, true);
        return true;
      }

      setMainChatInputBusy(true);
      sendBtn.disabled = false;
      sendBtn.classList.add('sending');
      isGenerating = true;
      appendMessage(rerunOnly ? '正在重新运行上一次 R 图，并把图片发到对话里...' : '正在基于上一次 R 图表和 Excel 数据重新生成修改版...', 'bot', false, true);

      try {
        var themeId = 'paper_clean';
        var selectedTheme = Array.isArray(R_THEMES) ? R_THEMES.find(function(theme) { return theme.id === themeId; }) : null;
        var previousMarkdown = buildRecentRPlotMarkdown(context);
        var runtimeFile = recentRPlotRuntimeContext && recentRPlotRuntimeContext.file ? recentRPlotRuntimeContext.file : null;
        var sourceDataFilePath = runtimeFile ? '' : inferRecentRPlotDataFilePath(context);
        var dataFilename = context.dataFilename || (runtimeFile ? runtimeFile.name : '') || context.originalFilename || 'data.xlsx';
        var codePath = getRecentRPlotCodePath(context);
        var existingCode = String(context.rCode || '').trim();

        if (!runtimeFile && !sourceDataFilePath) {
          throw new Error('找不到上一次 R 图使用的数据文件。请重新上传 Excel/CSV 后再让我修改图。');
        }
        if (!codePath && !existingCode) {
          throw new Error('找不到上一次 R 图使用的代码。请重新生成一次图后再追问修改。');
        }

        if (rerunOnly) {
          appendMessage('正在重新运行上一版 R 代码，并把图片发到对话里...', 'bot', false, true);
          await executeGeneratedRPlot({
            rCode: existingCode,
            file: runtimeFile,
            sourceDataFilePath: sourceDataFilePath,
            dataFilename: dataFilename,
            originalFilename: context.originalFilename || dataFilename,
            codePath: codePath || '',
            instruction: message,
            chartType: context.chartType || 'boxplot',
            analysisType: context.analysisType || 'comparison',
            themeId: context.themeId || themeId,
            themeCode: context.themeCode || (selectedTheme ? selectedTheme.code : ''),
            label: '重新生成的 R 图表'
          });
          return true;
        }

        var formData = new FormData();
        formData.append('userId', currentUserId || 'web-user');
        formData.append('apiUrl', apiConfig.url);
        formData.append('apiKey', apiConfig.key);
        formData.append('model', currentModel);
        if (codePath) formData.append('codePath', codePath);
        if (existingCode) formData.append('existingCode', existingCode);
        var errorBarFollowupHint = /(误差棒|误差线|error\s*bar|standard\s*deviation|标准差|\bsd\b|\bse\b|置信区间|confidence\s*interval|ci\b)/i.test(message)
          ? '本次用户明确要求误差棒：必须先判断当前图是折线图、点图、散点图、柱状图、箱线图/小提琴图、面积图还是水平柱状图，再选择对应误差图层。折线/点/散点图必须给每个已绘制点添加 geom_errorbar() 或 geom_linerange()；柱状图必须按柱子的同一 x/group 汇总粒度计算均值 ± SD/SE/CI，并让 geom_col() 和 geom_errorbar() 使用相同 position_dodge；水平柱状图用横向误差线；面积图优先用 geom_ribbon；箱线图/小提琴图只添加均值 ± 误差的 summary overlay。若数据表里存在 sd、SD、se、SE、std、error、err、ci 或类似误差列，必须优先使用该列作为每个点/柱的误差值，且 y 值做单位换算时误差列必须同步换算。禁止在一行一个点的数据上按 date/treatment 用 sd(y) 重新计算误差，因为单行分组会得到 NA，导致误差棒不可见。'
          : '';
        formData.append('customRequirements', appendRPlotTreatmentColorRequirements([
          '这是对上一张 R 图的连续修改请求。必须沿用上一版 R 代码和数据逻辑，只根据用户新要求做必要修改，并继续保存 PNG、PDF/SVG 等输出文件。',
          '如果用户要求横坐标日期水平显示，必须把 axis.text.x 的 angle 设置为 0，并使用 hjust = 0.5 或居中显示。',
          errorBarFollowupHint,
          '用户新要求：' + message,
          previousMarkdown
        ].filter(Boolean).join('\n\n')));
        formData.append('dataFilename', dataFilename);
        formData.append('themeCode', selectedTheme ? selectedTheme.code : '');
        formData.append('themeId', themeId);
        formData.append('treatmentPaletteConfig', getRPlotTreatmentPaletteConfigJson());

        var response = await fetch('/api/r-code/debug', { method: 'POST', body: formData });
        var result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '修改版 R 代码生成失败');
        }

        appendMessage('修改版 R 代码已生成，正在调用本机 R 插件出图...', 'bot', false, true);
        var savedCodePath = await saveRCodeToDesktop(result.data.rCode, dataFilename);
        await executeGeneratedRPlot({
          rCode: result.data.rCode,
          file: runtimeFile,
          sourceDataFilePath: sourceDataFilePath,
          dataFilename: dataFilename,
          originalFilename: context.originalFilename || dataFilename,
          codePath: savedCodePath || '',
          instruction: message,
          chartType: context.chartType || 'boxplot',
          analysisType: context.analysisType || 'comparison',
          themeId: context.themeId || themeId,
          themeCode: context.themeCode || (selectedTheme ? selectedTheme.code : ''),
          label: '修改后的 R 图表'
        });
        return true;
      } catch (error) {
        appendMessage('修改上一次 R 图失败：' + (error.message || error), 'bot', false, true);
        return true;
      } finally {
        setMainChatInputBusy(false);
        sendBtn.disabled = false;
        sendBtn.classList.remove('sending', 'can-stop');
        isGenerating = false;
        currentAbortController = null;
        activeMainChatProvider = null;
        renderHistory();
        updateMainChatQueueButtonState();
      }
    }

    // R 作图相关变量
    var rPlotConfig = {
      file: null,
      chartType: '',
      analysisType: '',
      customRequirements: ''
    };
    
    // 图表类型列表
    var R_CHART_TYPES = [
      { id: 'scatter', name: '散点图', description: '适合展示两个连续变量的关系' },
      { id: 'line', name: '折线图', description: '适合展示时间序列或趋势数据' },
      { id: 'bar', name: '柱状图', description: '适合展示分类数据的比较' },
      { id: 'histogram', name: '直方图', description: '适合展示数据分布' },
      { id: 'boxplot', name: '箱线图', description: '适合展示数据分布和异常值' },
      { id: 'heatmap', name: '热力图', description: '适合展示矩阵数据或相关性' },
      { id: 'pie', name: '饼图', description: '适合展示比例数据' },
      { id: 'violin', name: '小提琴图', description: '适合展示数据分布密度' },
      { id: 'density', name: '密度图', description: '适合展示连续变量的概率分布' },
      { id: 'area', name: '面积图', description: '适合展示累积数据或范围' },
      { id: 'contour', name: '等高线图', description: '适合展示三维数据的二维投影' },
      { id: 'bubble', name: '气泡图', description: '适合展示三个变量的关系' },
      { id: 'errorbar', name: '误差棒图', description: '适合展示数据的误差范围' },
      { id: 'grouped_bar', name: '分组柱状图', description: '适合展示多组分类数据的比较' },
      { id: 'stacked_bar', name: '堆叠柱状图', description: '适合展示分类数据的组成比例' }
    ];
    
    var R_ANALYSIS_TYPES = [
      { id: 'correlation', name: '相关性分析', description: '分析变量之间的相关性' },
      { id: 'comparison', name: '组间比较', description: '比较不同组之间的差异' },
      { id: 'distribution', name: '分布分析', description: '分析数据的分布特征' },
      { id: 'trend', name: '趋势分析', description: '分析数据随时间的变化趋势' },
      { id: 'composition', name: '组成分析', description: '分析数据的组成结构' },
      { id: 'ranking', name: '排序分析', description: '按某种指标排序展示' }
    ];

    var R_PLOT_PALETTE_STORAGE_PREFIX = 'scholarharness_r_plot_palette_';
    var R_TOP_JOURNAL_PALETTES = [
      {
        id: 'okabe_ito',
        name: 'Nature/Science 常用 Okabe-Ito',
        colors: ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#F0E442', '#000000']
      },
      {
        id: 'nejm_lancet',
        name: 'NEJM/Lancet 稳重离散色',
        colors: ['#1B9E77', '#D95F02', '#7570B3', '#E7298A', '#66A61E', '#E6AB02', '#A6761D', '#666666']
      },
      {
        id: 'cell_deep',
        name: 'Cell 风格高对比色',
        colors: ['#3B5B92', '#C44E52', '#55A868', '#8172B3', '#CCB974', '#64B5CD', '#8C564B', '#4C4C4C']
      },
      {
        id: 'muted_review',
        name: '综述图低饱和色',
        colors: ['#4E79A7', '#F28E2B', '#59A14F', '#E15759', '#76B7B2', '#B07AA1', '#EDC948', '#9C755F']
      }
    ];
    var rPlotPaletteState = null;

    function getRPlotPaletteStorageKey() {
      return R_PLOT_PALETTE_STORAGE_PREFIX + (currentUserId || 'web-user') + '_' + (currentConversationId || 'default');
    }

    function getDefaultRPlotPaletteState() {
      return {
        variable: '',
        levels: [],
        paletteId: 'okabe_ito',
        assignments: {},
        confirmed: false,
        updatedAt: ''
      };
    }

    function loadRPlotPaletteState() {
      if (rPlotPaletteState) return rPlotPaletteState;
      try {
        var parsed = JSON.parse(localStorage.getItem(getRPlotPaletteStorageKey()) || 'null');
        if (parsed && typeof parsed === 'object') {
          rPlotPaletteState = Object.assign(getDefaultRPlotPaletteState(), parsed);
          rPlotPaletteState.assignments = rPlotPaletteState.assignments && typeof rPlotPaletteState.assignments === 'object'
            ? rPlotPaletteState.assignments
            : {};
          rPlotPaletteState.levels = Array.isArray(rPlotPaletteState.levels) ? rPlotPaletteState.levels : [];
          return rPlotPaletteState;
        }
      } catch (e) {}
      rPlotPaletteState = getDefaultRPlotPaletteState();
      return rPlotPaletteState;
    }

    function saveRPlotPaletteState() {
      if (!rPlotPaletteState) return;
      try {
        localStorage.setItem(getRPlotPaletteStorageKey(), JSON.stringify(rPlotPaletteState));
      } catch (e) {}
    }

    function getRPlotPaletteById(id) {
      return R_TOP_JOURNAL_PALETTES.find(function(palette) { return palette.id === id; }) || R_TOP_JOURNAL_PALETTES[0];
    }

    function normalizeRPlotHexColor(value, fallback) {
      var text = String(value || '').trim();
      if (/^#[0-9a-f]{6}$/i.test(text)) return text.toUpperCase();
      if (/^[0-9a-f]{6}$/i.test(text)) return ('#' + text).toUpperCase();
      return fallback || '#0072B2';
    }

    function uniqueRPlotLevels(values) {
      var seen = {};
      return (Array.isArray(values) ? values : [])
        .map(function(value) { return String(value == null ? '' : value).trim(); })
        .filter(function(value) {
          if (!value || /^(na|n\/a|null|nan|\.)$/i.test(value)) return false;
          var key = value.toLowerCase();
          if (seen[key]) return false;
          seen[key] = true;
          return true;
        })
        .slice(0, 18);
    }

    function parseRPlotLevelsInput(text) {
      return uniqueRPlotLevels(String(text || '').split(/[\n,，;；|]+/));
    }

    function getRPlotPaletteColor(index, paletteId) {
      var palette = getRPlotPaletteById(paletteId);
      return palette.colors[index % palette.colors.length];
    }

    function getRPlotPaletteOptionsHtml(selectedId) {
      return R_TOP_JOURNAL_PALETTES.map(function(palette) {
        var selected = palette.id === selectedId ? ' selected' : '';
        return '<option value="' + escapeHtml(palette.id) + '"' + selected + '>' + escapeHtml(palette.name) + '</option>';
      }).join('');
    }

    function getDataAnalysisVariableByName(name) {
      var variables = dataAnalysisStructure && Array.isArray(dataAnalysisStructure.variables) ? dataAnalysisStructure.variables : [];
      return variables.find(function(variable) { return variable.name === name; }) || null;
    }

    function getDataAnalysisCategoricalVariables() {
      var variables = dataAnalysisStructure && Array.isArray(dataAnalysisStructure.variables) ? dataAnalysisStructure.variables : [];
      return variables.filter(function(variable) { return variable.type === 'categorical'; });
    }

    function getDataAnalysisVariableLevels(variableName) {
      if (!dataAnalysisStructure || !variableName) return [];
      var variable = getDataAnalysisVariableByName(variableName);
      var levels = variable ? (variable.sampleValues || []) : [];
      var previewRows = Array.isArray(dataAnalysisStructure.previewRows) ? dataAnalysisStructure.previewRows : [];
      if (previewRows.length > 1) {
        var headers = previewRows[0] || [];
        var columnIndex = headers.indexOf(variableName);
        if (columnIndex >= 0) {
          levels = levels.concat(previewRows.slice(1).map(function(row) { return row && row[columnIndex]; }));
        }
      }
      return uniqueRPlotLevels(levels);
    }

    function inferRPlotTreatmentVariableFromDataAnalysis(preferredSelections) {
      if (!dataAnalysisStructure) return { variable: '', levels: [] };
      var selections = preferredSelections || (getDataAnalysisSelectionSnapshot ? getDataAnalysisSelectionSnapshot() : {});
      var candidates = [
        selections.groupVar,
        selections.categoryVar,
        selections.categoryVar2
      ].filter(Boolean);
      var categorical = getDataAnalysisCategoricalVariables();
      var semantic = categorical.find(function(variable) {
        return /(treatment|group|处理|分组|组别|施肥|dose|rate|level|condition|category)/i.test(variable.name || '');
      });
      if (semantic && candidates.indexOf(semantic.name) < 0) candidates.push(semantic.name);
      categorical.forEach(function(variable) {
        if (candidates.indexOf(variable.name) < 0) candidates.push(variable.name);
      });
      for (var i = 0; i < candidates.length; i += 1) {
        var variableName = candidates[i];
        var levels = getDataAnalysisVariableLevels(variableName);
        if (levels.length) return { variable: variableName, levels: levels };
      }
      return { variable: '', levels: [] };
    }

    function buildRPlotPaletteAssignments(levels, paletteId, existingAssignments) {
      var assignments = {};
      levels.forEach(function(level, index) {
        var existing = existingAssignments && existingAssignments[level];
        assignments[level] = normalizeRPlotHexColor(existing, getRPlotPaletteColor(index, paletteId));
      });
      return assignments;
    }

    function getRPlotPaletteDomState(containerId) {
      var container = document.getElementById(containerId);
      if (!container) return null;
      var paletteId = container.querySelector('[data-r-palette-select]')?.value || loadRPlotPaletteState().paletteId || 'okabe_ito';
      var variable = String(container.querySelector('[data-r-palette-variable]')?.value || '').trim();
      var levelInput = container.querySelector('[data-r-palette-levels]');
      var levels = parseRPlotLevelsInput(levelInput ? levelInput.value : '');
      var rowInputs = Array.from(container.querySelectorAll('[data-r-palette-color]'));
      if (!levels.length && rowInputs.length) {
        levels = rowInputs.map(function(input) { return input.getAttribute('data-r-palette-color') || ''; }).filter(Boolean);
      }
      var assignments = {};
      levels.forEach(function(level, index) {
        var input = rowInputs.find(function(item) { return item.getAttribute('data-r-palette-color') === level; });
        assignments[level] = normalizeRPlotHexColor(input ? input.value : '', getRPlotPaletteColor(index, paletteId));
      });
      return {
        variable: variable,
        levels: levels,
        paletteId: paletteId,
        paletteName: getRPlotPaletteById(paletteId).name,
        assignments: assignments,
        confirmed: true,
        updatedAt: new Date().toISOString()
      };
    }

    function updateRPlotPaletteSwatch(input) {
      if (!input) return;
      var row = input.closest('.r-palette-row');
      var swatch = row ? row.querySelector('.r-palette-swatch') : null;
      if (swatch) swatch.style.background = normalizeRPlotHexColor(input.value, swatch.style.background || '#0072B2');
    }

    function applyRPlotPalettePanel(containerId, rerender) {
      var state = getRPlotPaletteDomState(containerId);
      if (!state) return null;
      rPlotPaletteState = Object.assign(getDefaultRPlotPaletteState(), state);
      saveRPlotPaletteState();
      if (rerender !== false) renderAllVisibleRPlotPalettePanels();
      return rPlotPaletteState;
    }

    function applyRPlotPalettePreset(containerId) {
      var container = document.getElementById(containerId);
      if (!container) return;
      var paletteId = container.querySelector('[data-r-palette-select]')?.value || 'okabe_ito';
      var state = getRPlotPaletteDomState(containerId) || loadRPlotPaletteState();
      state.paletteId = paletteId;
      state.assignments = buildRPlotPaletteAssignments(state.levels || [], paletteId, {});
      state.updatedAt = new Date().toISOString();
      rPlotPaletteState = Object.assign(getDefaultRPlotPaletteState(), state);
      saveRPlotPaletteState();
      renderAllVisibleRPlotPalettePanels();
    }
    window.applyRPlotPalettePreset = applyRPlotPalettePreset;

    function confirmRPlotPalettePanel(containerId) {
      var state = applyRPlotPalettePanel(containerId, true);
      if (!state) return;
      var status = document.getElementById(containerId + '_status');
      if (status) {
        status.textContent = state.levels.length
          ? '已确认 ' + state.levels.length + ' 个处理颜色，后续作图会保持一致。'
          : '已保存默认色板；未填写处理列表时，AI 会按识别到的分组水平续用该色板。';
      }
    }
    window.confirmRPlotPalettePanel = confirmRPlotPalettePanel;

    function renderAllVisibleRPlotPalettePanels() {
      if (document.getElementById('dataAnalysisTreatmentColorPanel')) {
        renderRPlotPalettePanel('dataAnalysisTreatmentColorPanel', { source: 'data-analysis', compact: true });
      }
      if (document.getElementById('rPlotTreatmentColorPanel')) {
        renderRPlotPalettePanel('rPlotTreatmentColorPanel', { source: 'r-plot', compact: false });
      }
    }

    function getRPlotPaletteInitialState(options) {
      var saved = loadRPlotPaletteState();
      var inferred = options && options.source === 'data-analysis' ? inferRPlotTreatmentVariableFromDataAnalysis(options.selections) : { variable: '', levels: [] };
      if (dataAnalysisPlotLink && dataAnalysisPlotLink.selections) {
        var linkVariable = dataAnalysisPlotLink.selections.groupVar || dataAnalysisPlotLink.selections.categoryVar || dataAnalysisPlotLink.selections.categoryVar2 || '';
        if (linkVariable) inferred = { variable: linkVariable, levels: getDataAnalysisVariableLevels(linkVariable) };
      }
      var variable = saved.variable || inferred.variable || '';
      var levels = saved.levels && saved.levels.length ? saved.levels : (inferred.levels || []);
      if (inferred.variable && saved.variable && saved.variable !== inferred.variable && inferred.levels.length) {
        variable = inferred.variable;
        levels = inferred.levels;
      }
      var paletteId = saved.paletteId || 'okabe_ito';
      return {
        variable: variable,
        levels: uniqueRPlotLevels(levels),
        paletteId: paletteId,
        assignments: buildRPlotPaletteAssignments(uniqueRPlotLevels(levels), paletteId, saved.assignments || {}),
        confirmed: !!saved.confirmed,
        updatedAt: saved.updatedAt || ''
      };
    }

    function renderRPlotPalettePanel(containerId, options) {
      var container = document.getElementById(containerId);
      if (!container) return;
      var state = getRPlotPaletteInitialState(options || {});
      var levelsText = state.levels.join('，');
      var rowsHtml = state.levels.length ? state.levels.map(function(level, index) {
        var color = normalizeRPlotHexColor(state.assignments[level], getRPlotPaletteColor(index, state.paletteId));
        return '<div class="r-palette-row">' +
          '<span class="r-palette-swatch" style="background:' + escapeHtml(color) + ';"></span>' +
          '<span class="r-palette-label" title="' + escapeHtml(level) + '">' + escapeHtml(level) + '</span>' +
          '<input class="r-palette-color-input" data-r-palette-color="' + escapeHtml(level) + '" value="' + escapeHtml(color) + '" oninput="updateRPlotPaletteSwatch(this)">' +
        '</div>';
      }).join('') : '<div class="r-palette-note" style="grid-column:1/-1;">未识别到处理水平。可以在上方手动输入处理列表，例如 Control，NPK，Biochar。</div>';
      var palette = getRPlotPaletteById(state.paletteId);
      container.innerHTML =
        '<div class="r-palette-head">' +
          '<div>' +
            '<div class="r-palette-title">处理颜色确认</div>' +
            '<div class="r-palette-note">默认推荐顶刊常用离散色板；确认后同一处理在所有图中固定同色。</div>' +
          '</div>' +
          '<div class="r-palette-note" style="text-align:right;">' + (state.confirmed ? '已保存' : '待确认') + '</div>' +
        '</div>' +
        '<div class="r-palette-controls">' +
          '<label>分组/处理变量' +
            '<input data-r-palette-variable value="' + escapeHtml(state.variable || '') + '" placeholder="例如 Treatment / Group / 处理">' +
          '</label>' +
          '<label>推荐色板' +
            '<select data-r-palette-select onchange="applyRPlotPalettePreset(\'' + escapeHtml(containerId) + '\')">' + getRPlotPaletteOptionsHtml(state.paletteId) + '</select>' +
          '</label>' +
        '</div>' +
        '<label style="display:grid;gap:4px;color:var(--text-secondary);font-size:11px;font-weight:650;">处理列表' +
          '<input class="r-palette-level-input" data-r-palette-levels value="' + escapeHtml(levelsText) + '" placeholder="多个处理用逗号分隔">' +
        '</label>' +
        '<div class="r-palette-note" style="margin-top:6px;">当前色板：' + escapeHtml(palette.name) + '。未列出的新增处理会从同一色板继续分配，不会改动已确认颜色。</div>' +
        '<div class="r-palette-rows">' + rowsHtml + '</div>' +
        '<div class="r-palette-actions">' +
          '<button type="button" onclick="applyRPlotPalettePanel(\'' + escapeHtml(containerId) + '\')">应用列表</button>' +
          '<button type="button" class="primary" onclick="confirmRPlotPalettePanel(\'' + escapeHtml(containerId) + '\')">确认颜色</button>' +
          '<span id="' + escapeHtml(containerId) + '_status" class="r-palette-status">' + (state.levels.length ? '已准备 ' + state.levels.length + ' 个颜色映射。' : '可先使用推荐色板，或手动补充处理列表。') + '</span>' +
        '</div>';
    }

    function refreshDataAnalysisTreatmentColors() {
      var panel = document.getElementById('dataAnalysisTreatmentColorPanel');
      if (!panel) return;
      var current = loadRPlotPaletteState();
      var inferred = inferRPlotTreatmentVariableFromDataAnalysis();
      var inferredLevelKey = (inferred.levels || []).join('\u0001');
      var currentLevelKey = (current.levels || []).join('\u0001');
      if (inferred.variable && (!current.variable || current.variable !== inferred.variable || inferredLevelKey !== currentLevelKey)) {
        rPlotPaletteState = Object.assign(getDefaultRPlotPaletteState(), current, {
          variable: inferred.variable,
          levels: inferred.levels,
          assignments: buildRPlotPaletteAssignments(inferred.levels, current.paletteId || 'okabe_ito', current.assignments || {}),
          confirmed: false
        });
        saveRPlotPaletteState();
      }
      renderRPlotPalettePanel('dataAnalysisTreatmentColorPanel', { source: 'data-analysis', compact: true });
    }
    window.refreshDataAnalysisTreatmentColors = refreshDataAnalysisTreatmentColors;

    function getRPlotTreatmentPaletteConfig(preferredSelections) {
      var activePanelIds = ['rPlotTreatmentColorPanel', 'dataAnalysisTreatmentColorPanel'];
      for (var i = 0; i < activePanelIds.length; i += 1) {
        var state = getRPlotPaletteDomState(activePanelIds[i]);
        if (state && (state.variable || state.levels.length)) {
          rPlotPaletteState = Object.assign(getDefaultRPlotPaletteState(), state);
          saveRPlotPaletteState();
          return state;
        }
      }
      var saved = loadRPlotPaletteState();
      if (saved && (saved.variable || (saved.levels && saved.levels.length))) return saved;
      var inferred = inferRPlotTreatmentVariableFromDataAnalysis(preferredSelections);
      if (inferred.variable || inferred.levels.length) {
        var paletteId = saved.paletteId || 'okabe_ito';
        return {
          variable: inferred.variable,
          levels: inferred.levels,
          paletteId: paletteId,
          paletteName: getRPlotPaletteById(paletteId).name,
          assignments: buildRPlotPaletteAssignments(inferred.levels, paletteId, saved.assignments || {}),
          confirmed: false,
          updatedAt: new Date().toISOString()
        };
      }
      return {
        variable: '',
        levels: [],
        paletteId: saved.paletteId || 'okabe_ito',
        paletteName: getRPlotPaletteById(saved.paletteId || 'okabe_ito').name,
        assignments: {},
        confirmed: false,
        updatedAt: new Date().toISOString()
      };
    }

    function buildRPlotTreatmentColorRequirementBlock(preferredSelections) {
      var config = getRPlotTreatmentPaletteConfig(preferredSelections);
      var palette = getRPlotPaletteById(config.paletteId);
      var lines = [
        '## 处理/分组颜色一致性',
        '用户需要在作图前确认各处理对应颜色，以保证整篇论文图件主题一致。',
        '推荐色板：' + (config.paletteName || palette.name) + '；色板 HEX：' + palette.colors.join(', ') + '。',
        config.variable ? '分组/处理变量：' + config.variable + '。' : '若数据中存在 Treatment、Group、处理、分组、组别、dose/rate/level 等变量，请将其作为主要颜色分组变量。',
        config.confirmed ? '颜色状态：用户已确认。' : '颜色状态：使用系统推荐映射；如果用户后续修改颜色，必须覆盖这套映射。'
      ];
      var levels = Array.isArray(config.levels) ? config.levels : [];
      if (levels.length) {
        lines.push('已确认/推荐的处理颜色映射如下，R 代码必须定义命名向量并用于所有 fill/color/colour scale：');
        levels.forEach(function(level, index) {
          var color = normalizeRPlotHexColor(config.assignments && config.assignments[level], getRPlotPaletteColor(index, config.paletteId));
          lines.push('- "' + level + '" = "' + color + '"');
        });
      } else {
        lines.push('当前没有明确处理列表；如果 R 代码识别到分组水平，请按上述色板顺序生成命名向量，并在同一代码文件所有图中复用。');
      }
      lines.push('硬性要求：同一处理/组别在多张图、多面板图、颜色和填充映射中必须保持同一 HEX 颜色；不要让 ggplot 使用默认灰色或随机离散色。');
      lines.push('硬性要求：如果同一图同时使用 color 和 fill，二者必须用同一命名向量；优先写 scholar_user_palette <- c(...)，再使用 scholar_scale_color_manual(values = scholar_user_palette)、scholar_scale_fill_manual(values = scholar_user_palette)。');
      lines.push('硬性要求：未在映射中列出的新增水平只能追加使用同一推荐色板的后续颜色，不能改变已列出处理的颜色。');
      return lines.join('\n');
    }

    function appendRPlotTreatmentColorRequirements(requirements, preferredSelections) {
      return [requirements || '', buildRPlotTreatmentColorRequirementBlock(preferredSelections)].filter(Boolean).join('\n\n');
    }

    function getRPlotTreatmentPaletteConfigJson(preferredSelections) {
      return JSON.stringify(getRPlotTreatmentPaletteConfig(preferredSelections));
    }
    
    // R 作图主题预设
    var R_THEMES = [
      { 
        id: 'paper_clean', 
        name: '专业简洁风格（推荐）', 
        code: `
new_theme1 <- theme_bw() +
  theme(panel.grid = element_blank())+
  theme(panel.border = element_rect(colour = "black",fill = NA,linewidth = 0.5))+
  theme(axis.text.x = element_text(size=14,color='black', family = "serif"),
        axis.text.y  = element_text(size=14,color='black', family = "serif"),
        axis.title=element_text(size=14,color='black',family = "serif"),
        legend.position = c(0.98, 0.98),
        legend.justification = c(1, 1),
        legend.background = element_rect(fill = rgb(1, 1, 1, 0.78), colour = NA))
`
      },
      { 
        id: 'paper_grid', 
        name: '专业网格风格', 
        code: `
new_theme1 <- theme_bw() +
  theme(panel.border = element_rect(colour = "black", fill = NA, linewidth = 0.5)) +
  theme(axis.text.x = element_text(size = 12, color = 'black', family = "serif"),
        axis.text.y = element_text(size = 12, color = 'black', family = "serif"),
        axis.title = element_text(size = 14, color = 'black', family = "serif"),
        legend.position = c(0.98, 0.98),
        legend.justification = c(1, 1),
        legend.background = element_rect(fill = rgb(1, 1, 1, 0.78), colour = NA))
`
      },
      { 
        id: 'nature', 
        name: 'Nature 图表风格（论文/报告）', 
        code: `
nature_palette <- c("#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#000000")

new_theme1 <- theme_classic(base_size = 10, base_family = "Arial") +
  theme(panel.grid = element_blank(),
        axis.text.x = element_text(size = 9, color = 'black'),
        axis.text.y = element_text(size = 9, color = 'black'),
        axis.title = element_text(size = 10, color = 'black'),
        axis.line = element_line(colour = "black", linewidth = 0.4),
        axis.ticks = element_line(colour = "black", linewidth = 0.35),
        legend.title = element_text(size = 9, color = 'black'),
        legend.text = element_text(size = 8, color = 'black'),
        legend.key = element_blank(),
        legend.position = c(0.98, 0.98),
        legend.justification = c(1, 1),
        legend.background = element_rect(fill = rgb(1, 1, 1, 0.78), colour = NA),
        plot.title = element_blank(),
        plot.margin = margin(6, 6, 6, 6))
`
      },
      { 
        id: 'minimal', 
        name: '极简风格', 
        code: `
new_theme1 <- theme_minimal() +
  theme(axis.text = element_text(size = 12),
        axis.title = element_text(size = 14),
        legend.position = c(0.98, 0.98),
        legend.justification = c(1, 1),
        legend.background = element_rect(fill = rgb(1, 1, 1, 0.78), colour = NA))
`
      },
      { 
        id: 'custom', 
        name: '自定义主题', 
        code: 'CUSTOM'
      }
    ];
    
    function getRPluginStatusElement() {
      return document.getElementById('configRPluginStatus') || document.getElementById('rPluginStatus');
    }

    function runtimePluginStatusBox(title, bodyId, pathInputId, saveFn, detectFn, placeholder, extraActions, kind, description) {
      var iconSvg = kind === 'r'
        ? '<svg class="runtime-brand-logo runtime-r-logo" viewBox="0 0 32 32" aria-hidden="true"><ellipse class="brand-fill r-ring" cx="15" cy="15" rx="13" ry="8"></ellipse><ellipse class="brand-fill r-hole" cx="14" cy="14" rx="8.5" ry="4.5"></ellipse><text class="brand-fill r-letter" x="13" y="22">R</text></svg>'
        : (kind === 'python'
          ? '<svg class="runtime-brand-logo runtime-python-logo" viewBox="0 0 32 32" aria-hidden="true"><path class="brand-fill python-blue" d="M16 3c-7 0-7 3-7 6v4h8v2H7c-3 0-5 2-5 6s2 6 5 6h4v-5c0-3 2-5 5-5h7c3 0 5-2 5-5V9c0-3-3-6-12-6Z"></path><circle class="brand-fill python-eye" cx="13" cy="8" r="1.3"></circle><path class="brand-fill python-yellow" d="M16 29c7 0 7-3 7-6v-4h-8v-2h10c3 0 5-2 5-6s-2-6-5-6h-4v5c0 3-2 5-5 5H9c-3 0-5 2-5 5v3c0 3 3 6 12 6Z"></path><circle class="brand-fill python-eye" cx="19" cy="24" r="1.3"></circle></svg>'
          : (kind === 'browser'
            ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="15" rx="2"></rect><path d="M3 8h18"></path><circle cx="6" cy="6" r=".7"></circle><path d="M9 14h6"></path><path d="m13 12 2 2-2 2"></path></svg>'
            : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l3 3v15H6z"></path><path d="M15 3v4h4"></path><path d="M9 11h6"></path><path d="M9 15h6"></path><path d="M9 19h4"></path></svg>'));
      var pathControls = pathInputId && saveFn
        ? '<div class="runtime-plugin-path">' +
            '<input id="' + pathInputId + '" type="text" placeholder="' + escapeHtml(placeholder) + '">' +
            '<button type="button" class="runtime-plugin-btn" onclick="' + saveFn + '()">保存路径</button>' +
          '</div>'
        : '';
      return '' +
        '<section class="runtime-plugin-item" data-runtime-kind="' + escapeHtml(kind || '') + '">' +
          '<div class="runtime-plugin-head">' +
            '<span class="runtime-plugin-icon">' + iconSvg + '</span>' +
            '<div style="min-width:0;">' +
              '<div class="runtime-plugin-title">' + escapeHtml(title) + '</div>' +
              '<div class="runtime-plugin-desc">' + escapeHtml(description || '') + '</div>' +
            '</div>' +
          '</div>' +
          '<div id="' + bodyId + '" class="runtime-plugin-status">正在检测...</div>' +
          '<div class="runtime-plugin-actions">' +
            '<button type="button" class="runtime-plugin-btn" onclick="' + detectFn + '()">自动检测</button>' +
            (extraActions || '') +
          '</div>' +
          pathControls +
        '</section>';
    }

    var mcpPluginMarketplaceCache = [];
    var installedMcpPluginsCache = [];
    var installingMcpPluginIds = new Set();
    var adaptingMcpProjectIds = new Set();
    var activeMcpIntegrationJobIds = new Set();
    var mcpIntegrationJobProjectIds = new Map();
    var mcpIntegrationProgressItems = new Map();

    async function readMcpPluginApiResponse(response) {
      var contentType = String(response.headers.get('content-type') || '').toLowerCase();
      var bodyText = await response.text();
      if (!contentType.includes('application/json')) {
        throw new Error(response.status === 404
          ? '当前本地服务版本过旧，尚未加载插件市场接口。请完全退出并重新启动 Scholar Harness。'
          : '插件接口返回了非 JSON 响应，请重新启动本地服务。');
      }
      try {
        return JSON.parse(bodyText || '{}');
      } catch (e) {
        throw new Error('插件接口返回数据格式异常，请重新启动本地服务。');
      }
    }

    function renderMcpPluginMark(plugin) {
      var iconKind = String(plugin && plugin.iconKind || 'custom');
      var iconUrl = String(plugin && plugin.iconUrl || '');
      if (/^https:\/\//i.test(iconUrl)) {
        return '<span class="mcp-plugin-mark icon-github"><img src="' + escapeHtml(iconUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></span>';
      }
      if (iconKind === 'npm') {
        return '<span class="mcp-plugin-mark icon-npm" aria-hidden="true">npm</span>';
      }
      var id = String(plugin && plugin.id || '');
      var svg = id.includes('browser-assist')
        ? '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="15" rx="2"></rect><path d="M3 8h18"></path><circle cx="6" cy="6" r=".7"></circle><path d="M9 14h6"></path><path d="m13 12 2 2-2 2"></path></svg>'
        : id.includes('filesystem')
        ? '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>'
        : (id.includes('memory')
          ? '<svg viewBox="0 0 24 24"><circle cx="6" cy="7" r="2"></circle><circle cx="18" cy="7" r="2"></circle><circle cx="12" cy="17" r="2"></circle><path d="m8 8 3 7"></path><path d="m16 8-3 7"></path><path d="M8 7h8"></path></svg>'
          : (id.includes('thinking')
            ? '<svg viewBox="0 0 24 24"><path d="M8 5h9"></path><path d="M8 12h9"></path><path d="M8 19h9"></path><path d="m3 5 1 1 2-2"></path><path d="m3 12 1 1 2-2"></path><path d="m3 19 1 1 2-2"></path></svg>'
            : (id.includes('github')
              ? '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2"></circle><circle cx="18" cy="18" r="2"></circle><path d="M6 8v5a5 5 0 0 0 5 5h5"></path><path d="M8 6h5a5 5 0 0 1 5 5v5"></path></svg>'
              : '<svg viewBox="0 0 24 24"><path d="M8 3v4"></path><path d="M16 3v4"></path><path d="M6 7h12v4a6 6 0 0 1-12 0z"></path><path d="M12 17v4"></path></svg>')));
      return '<span class="mcp-plugin-mark ' + (iconKind === 'github' ? 'icon-github' : 'icon-custom') + '" aria-hidden="true">' + svg + '</span>';
    }

    function getMcpMarketplaceOriginLabel(plugin) {
      var origin = String(plugin && plugin.origin || '');
      if (origin === 'github') return 'GitHub · ★ ' + Number(plugin.stars || 0);
      if (origin === 'npm') return 'npm · ' + String(plugin.version || '');
      if (origin === 'smithery') return 'Smithery';
      if (origin === 'glama') return 'Glama';
      if (origin === 'pulsemcp') return 'PulseMCP';
      if (origin === 'mcpso') return 'MCP.so';
      return '内置精选';
    }

    function renderMcpPluginMarketplace() {
      var container = document.getElementById('mcpPluginMarketplaceList');
      if (!container) return;
      var installedIds = new Set(installedMcpPluginsCache.map(function(plugin) { return String(plugin.id || ''); }));
      var visiblePlugins = mcpPluginMarketplaceCache.filter(function(plugin) {
        return String(plugin.id || '') !== 'browser-assist';
      });
      container.innerHTML = visiblePlugins.length
        ? visiblePlugins.map(function(plugin) {
            var installed = installedIds.has(String(plugin.id || ''));
            var installable = plugin.installable !== false;
            var installing = installingMcpPluginIds.has(String(plugin.id || ''));
            var aiAdaptable = plugin.aiAdaptable === true || (plugin.installable === false && !!plugin.url);
            var adapting = adaptingMcpProjectIds.has(String(plugin.id || ''));
            return '<div class="mcp-market-item">' +
              renderMcpPluginMark(plugin) +
              '<span class="mcp-plugin-copy">' +
                '<span class="mcp-plugin-name">' + escapeHtml(plugin.name || plugin.id || 'MCP 插件') + '</span>' +
                '<span class="mcp-plugin-description">' + escapeHtml(plugin.description || '') + '</span>' +
                '<span class="mcp-plugin-meta">' + escapeHtml(
                  (aiAdaptable ? '开源项目 · ' : '') + getMcpMarketplaceOriginLabel(plugin) +
                  ' · ' + (plugin.risk || 'network')
                ) + '</span>' +
              '</span>' +
              '<span class="mcp-plugin-row-actions">' +
                (plugin.url ? '<button type="button" class="runtime-plugin-btn" data-plugin-url="' + escapeHtml(plugin.url) + '" onclick="openExternalUrl(this.dataset.pluginUrl)">来源</button>' : '') +
                (aiAdaptable
                  ? '<button type="button" class="runtime-plugin-btn accent" data-plugin-id="' + escapeHtml(plugin.id || '') + '" onclick="analyzeMcpProjectIntegration(this.dataset.pluginId)" ' + (adapting ? 'disabled' : '') + '>' +
                      (adapting
                        ? '<span aria-label="正在后台接入" title="正在后台接入" style="display:inline-block;width:13px;height:13px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin .75s linear infinite;vertical-align:-2px;"></span>'
                        : '安装') +
                    '</button>'
                  : '<button type="button" class="runtime-plugin-btn' + (installed || !installable ? '' : ' accent') + '" data-plugin-id="' + escapeHtml(plugin.id || '') + '" onclick="installMarketplaceMcpPlugin(this.dataset.pluginId)" ' + (installed || !installable || installing ? 'disabled' : '') + '>' +
                  (installed
                    ? '已安装'
                    : (installing
                      ? '<span aria-label="正在安装" title="正在安装" style="display:inline-block;width:13px;height:13px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin .75s linear infinite;vertical-align:-2px;"></span>'
                      : (installable ? '安装' : '查看配置'))) +
                '</button>') +
              '</span>' +
            '</div>';
          }).join('')
        : '<div class="mcp-plugin-empty">暂无市场插件模板。</div>';
    }

    function renderInstalledMcpPlugins() {
      var container = document.getElementById('installedMcpPluginList');
      if (!container) return;
      var visiblePlugins = installedMcpPluginsCache.filter(function(plugin) {
        return String(plugin.id || '') !== 'browser-assist';
      });
      container.innerHTML = visiblePlugins.length
        ? visiblePlugins.map(function(plugin) {
            var toolCount = Array.isArray(plugin.tools) ? plugin.tools.length : 0;
            var statusLabel = plugin.status === 'ready'
              ? ('已发现 ' + toolCount + ' 个工具')
              : (plugin.status === 'error' ? ('检测失败：' + (plugin.error || '未知错误')) : '尚未检测');
            return '<div class="mcp-installed-item">' +
              renderMcpPluginMark(plugin) +
              '<span class="mcp-plugin-copy">' +
                '<span class="mcp-plugin-name">' + escapeHtml(plugin.name || plugin.id || 'MCP 插件') + '</span>' +
                '<span class="mcp-plugin-description">' + escapeHtml(plugin.description || '') + '</span>' +
                '<span class="mcp-plugin-meta">' + escapeHtml(statusLabel) + '</span>' +
              '</span>' +
              '<span class="mcp-plugin-row-actions">' +
                '<button type="button" class="runtime-plugin-btn" data-plugin-id="' + escapeHtml(plugin.id || '') + '" onclick="discoverInstalledMcpPlugin(this.dataset.pluginId)">检测</button>' +
                '<button type="button" class="runtime-plugin-btn' + (plugin.enabled ? ' accent' : '') + '" data-plugin-id="' + escapeHtml(plugin.id || '') + '" data-enabled="' + (plugin.enabled ? 'true' : 'false') + '" onclick="toggleInstalledMcpPlugin(this.dataset.pluginId, this.dataset.enabled !== \'true\')">' + (plugin.enabled ? '已启用' : '启用') + '</button>' +
                '<button type="button" class="runtime-plugin-btn" data-plugin-id="' + escapeHtml(plugin.id || '') + '" onclick="removeInstalledMcpPlugin(this.dataset.pluginId)">卸载</button>' +
              '</span>' +
            '</div>';
          }).join('')
        : '<div class="mcp-plugin-empty">还没有安装用户 MCP 插件。可以从左侧市场安装，或手动添加本地插件。</div>';
    }

    async function loadMcpPluginMarketplace(query) {
      var marketContainer = document.getElementById('mcpPluginMarketplaceList');
      if (marketContainer) marketContainer.innerHTML = '<div class="mcp-plugin-empty">正在读取插件市场...</div>';
      try {
        var response = await fetch('/api/mcp-plugins/marketplace?q=' + encodeURIComponent(String(query || '').trim()));
        var marketData = await readMcpPluginApiResponse(response);
        if (!response.ok || !marketData.success) throw new Error(marketData.error || '插件市场读取失败');
        mcpPluginMarketplaceCache = Array.isArray(marketData.plugins) ? marketData.plugins : [];
        renderMcpPluginMarketplace();
        var warning = Array.isArray(marketData.warnings) && marketData.warnings.length
          ? marketData.warnings.join('；')
          : '';
        var warningEl = document.getElementById('mcpMarketWarning');
        if (warningEl) warningEl.textContent = warning;
      } catch (e) {
        if (marketContainer) marketContainer.innerHTML = '<div class="mcp-plugin-empty" style="color:var(--danger-color);">' + escapeHtml(e.message || String(e)) + '</div>';
      }
    }

    async function loadInstalledMcpPlugins() {
      var installedContainer = document.getElementById('installedMcpPluginList');
      if (installedContainer) installedContainer.innerHTML = '<div class="mcp-plugin-empty">正在读取已安装插件...</div>';
      try {
        var response = await fetch('/api/mcp-plugins');
        var installedData = await readMcpPluginApiResponse(response);
        if (!response.ok || !installedData.success) throw new Error(installedData.error || '已安装插件读取失败');
        installedMcpPluginsCache = Array.isArray(installedData.plugins) ? installedData.plugins : [];
        renderInstalledMcpPlugins();
        renderMcpPluginMarketplace();
        updateBrowserAssistRuntimeStatus();
      } catch (e) {
        if (installedContainer) installedContainer.innerHTML = '<div class="mcp-plugin-empty" style="color:var(--danger-color);">' + escapeHtml(e.message || '插件配置读取失败。') + '</div>';
        updateBrowserAssistRuntimeStatus(e.message || '插件配置读取失败');
      }
    }

    async function loadMcpPluginCenter(query) {
      await Promise.all([
        loadInstalledMcpPlugins(),
        loadMcpPluginMarketplace(query)
      ]);
    }
    window.loadMcpPluginCenter = loadMcpPluginCenter;

    function searchOnlineMcpPlugins() {
      var input = document.getElementById('mcpMarketSearchInput');
      loadMcpPluginMarketplace(input ? input.value : '');
    }
    window.searchOnlineMcpPlugins = searchOnlineMcpPlugins;

    function toggleMcpMarketplaceConfig() {
      var form = document.getElementById('mcpMarketplaceConfigForm');
      if (form) form.classList.toggle('show');
    }
    window.toggleMcpMarketplaceConfig = toggleMcpMarketplaceConfig;

    async function loadMcpMarketplaceConfigStatus() {
      try {
        var response = await fetch('/api/mcp-plugins/marketplace-config');
        var data = await readMcpPluginApiResponse(response);
        if (!response.ok || !data.success) throw new Error(data.error || '市场配置读取失败');
        var status = document.getElementById('mcpMarketplaceConfigStatus');
        if (status) {
          status.textContent = 'Smithery：' + (data.config?.smitheryConfigured ? '已配置' : '未配置') +
            '　PulseMCP：' + (data.config?.pulseConfigured ? '已配置' : '未配置') +
            '　Glama / MCP.so：无需密钥';
        }
      } catch (e) {
        var status = document.getElementById('mcpMarketplaceConfigStatus');
        if (status) status.textContent = e.message || String(e);
      }
    }

    async function saveMcpMarketplaceConfigFromForm() {
      try {
        var payload = {};
        var smithery = String(document.getElementById('mcpSmitheryApiKey')?.value || '').trim();
        var pulseKey = String(document.getElementById('mcpPulseApiKey')?.value || '').trim();
        var pulseTenant = String(document.getElementById('mcpPulseTenantId')?.value || '').trim();
        if (smithery) payload.smitheryApiKey = smithery;
        if (pulseKey) payload.pulseApiKey = pulseKey;
        if (pulseTenant) payload.pulseTenantId = pulseTenant;
        var response = await fetch('/api/mcp-plugins/marketplace-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await readMcpPluginApiResponse(response);
        if (!response.ok || !data.success) throw new Error(data.error || '市场配置保存失败');
        ['mcpSmitheryApiKey', 'mcpPulseApiKey', 'mcpPulseTenantId'].forEach(function(id) {
          var input = document.getElementById(id);
          if (input) input.value = '';
        });
        await loadMcpMarketplaceConfigStatus();
        await loadMcpPluginMarketplace(document.getElementById('mcpMarketSearchInput')?.value || '');
      } catch (e) {
        alert('保存市场配置失败：' + (e.message || e));
      }
    }
    window.saveMcpMarketplaceConfigFromForm = saveMcpMarketplaceConfigFromForm;

    async function saveMcpPluginRecord(payload) {
      var response = await fetch('/api/mcp-plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await readMcpPluginApiResponse(response);
      if (!response.ok || !data.success) throw new Error(data.error || '插件保存失败');
      return data.plugin;
    }

    async function installMarketplaceMcpPlugin(pluginId) {
      var plugin = mcpPluginMarketplaceCache.find(function(item) { return String(item.id || '') === String(pluginId || ''); });
      if (!plugin || installingMcpPluginIds.has(String(pluginId || ''))) return;
      var normalizedPluginId = String(pluginId || '');
      var progressKey = 'install:' + normalizedPluginId;
      installingMcpPluginIds.add(normalizedPluginId);
      mcpIntegrationProgressItems.set(progressKey, {
        name: String(plugin.name || 'MCP 插件'),
        message: plugin.id === 'browser-assist'
          ? '正在安装可见浏览器 MCP、建立持久会话目录并检测安全工具'
          : '正在使用市场提供的启动配置安装并检测 MCP 工具'
      });
      updateMcpIntegrationBadge();
      renderMcpPluginMarketplace();
      try {
        await saveMcpPluginRecord(Object.assign({}, plugin, { enabled: false }));
        var detected = await discoverInstalledMcpPlugin(pluginId, true);
        if (!detected) {
          var failedPlugin = installedMcpPluginsCache.find(function(item) { return String(item.id || '') === normalizedPluginId; });
          var installationIssue = String(failedPlugin?.error || '启动后未完成 MCP initialize 或 tools/list 检测');
          if (plugin.id === 'browser-assist') {
            installingMcpPluginIds.delete(normalizedPluginId);
            mcpIntegrationProgressItems.delete(progressKey);
            updateMcpIntegrationBadge();
            renderMcpPluginMarketplace();
            alert(
              'Browser Assist MCP 安装或检测未完成：' + installationIssue +
              '\n\n请确认网络可访问 npm，然后在“已安装 MCP 插件”中点击“检测”重试。' +
              '插件记录和错误信息已保留，不会交给 AI 改写官方 Playwright MCP。'
            );
            return;
          }
          await fetch('/api/mcp-plugins/' + encodeURIComponent(pluginId), { method: 'DELETE' });
          await loadInstalledMcpPlugins();
          mcpIntegrationProgressItems.set(progressKey, {
            name: String(plugin.name || 'MCP 插件'),
            message: '直接启动未通过 MCP 检测，正在自动转交 AI 适配'
          });
          updateMcpIntegrationBadge();
          installingMcpPluginIds.delete(normalizedPluginId);
          mcpIntegrationProgressItems.delete(progressKey);
          renderMcpPluginMarketplace();
          await analyzeMcpProjectIntegration(pluginId, installationIssue);
          return;
        }
        if (plugin.autoEnableOnInstall === true) {
          await toggleInstalledMcpPlugin(pluginId, true);
        }
      } catch (e) {
        await fetch('/api/mcp-plugins/' + encodeURIComponent(pluginId), { method: 'DELETE' }).catch(function() {});
        mcpIntegrationProgressItems.set(progressKey, {
          name: String(plugin.name || 'MCP 插件'),
          message: '市场安装配置不可用，正在自动转交 AI 适配'
        });
        updateMcpIntegrationBadge();
        installingMcpPluginIds.delete(normalizedPluginId);
        mcpIntegrationProgressItems.delete(progressKey);
        renderMcpPluginMarketplace();
        await analyzeMcpProjectIntegration(pluginId, e.message || String(e));
        return;
      } finally {
        installingMcpPluginIds.delete(normalizedPluginId);
        mcpIntegrationProgressItems.delete(progressKey);
        updateMcpIntegrationBadge();
        renderMcpPluginMarketplace();
      }
    }
    window.installMarketplaceMcpPlugin = installMarketplaceMcpPlugin;

    function updateBrowserAssistRuntimeStatus(loadError) {
      var status = document.getElementById('configBrowserAssistStatus');
      var button = document.getElementById('installBrowserAssistPluginBtn');
      var installing = installingMcpPluginIds.has('browser-assist-runtime');
      var plugin = installedMcpPluginsCache.find(function(item) {
        return String(item.id || '') === 'browser-assist';
      });
      if (button) {
        button.disabled = installing;
        button.innerHTML = installing
          ? '<span aria-label="正在安装" title="正在安装" style="display:inline-block;width:13px;height:13px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin .75s linear infinite;vertical-align:-2px;"></span>'
          : (plugin && plugin.status === 'ready' && plugin.enabled ? '已安装' : '一键安装');
      }
      if (!status) return;
      if (loadError) {
        status.textContent = '检测失败：' + String(loadError);
      } else if (installing) {
        status.textContent = '正在安装官方 Playwright MCP、检测浏览器工具并自动启用，请稍候...';
      } else if (!plugin) {
        status.textContent = '尚未安装。点击“一键安装”即可自动完成安装、检测和启用。';
      } else if (plugin.status === 'ready' && plugin.enabled) {
        status.textContent = 'Browser Assist MCP 已安装并启用，可用安全浏览器工具 ' +
          (Array.isArray(plugin.tools) ? plugin.tools.length : 0) + ' 个。';
      } else if (plugin.status === 'ready') {
        status.textContent = '工具检测成功，当前尚未启用；点击“一键安装”可直接启用。';
      } else if (plugin.status === 'error') {
        status.textContent = '安装记录已保留，检测失败：' + String(plugin.error || '未知错误');
      } else {
        status.textContent = '已保存安装配置，尚未完成浏览器工具检测。';
      }
    }

    async function autoDetectBrowserAssistPlugin() {
      var plugin = installedMcpPluginsCache.find(function(item) {
        return String(item.id || '') === 'browser-assist';
      });
      if (!plugin) {
        updateBrowserAssistRuntimeStatus();
        alert('Browser Assist MCP 尚未安装，请点击“一键安装”。');
        return;
      }
      var detected = await discoverInstalledMcpPlugin('browser-assist', true);
      if (!detected) {
        updateBrowserAssistRuntimeStatus();
        alert('Browser Assist MCP 检测失败，请检查 npm 网络连接后重试。');
        return;
      }
      plugin = installedMcpPluginsCache.find(function(item) {
        return String(item.id || '') === 'browser-assist';
      });
      if (plugin && !plugin.enabled) await toggleInstalledMcpPlugin('browser-assist', true);
      updateBrowserAssistRuntimeStatus();
    }
    window.autoDetectBrowserAssistPlugin = autoDetectBrowserAssistPlugin;

    async function installBrowserAssistPlugin() {
      var installingKey = 'browser-assist-runtime';
      if (installingMcpPluginIds.has(installingKey)) return;
      installingMcpPluginIds.add(installingKey);
      mcpIntegrationProgressItems.set(installingKey, {
        name: 'Browser Assist MCP',
        message: '正在一键安装、检测并启用可见浏览器工具'
      });
      updateMcpIntegrationBadge();
      updateBrowserAssistRuntimeStatus();
      try {
        var response = await fetch('/api/mcp-plugins/browser-assist/install', { method: 'POST' });
        var data = await readMcpPluginApiResponse(response);
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Browser Assist MCP 安装或检测失败');
        }
        await loadInstalledMcpPlugins();
      } catch (e) {
        await loadInstalledMcpPlugins().catch(function() {});
        alert('Browser Assist MCP 一键安装失败：' + (e.message || e));
      } finally {
        installingMcpPluginIds.delete(installingKey);
        mcpIntegrationProgressItems.delete(installingKey);
        updateMcpIntegrationBadge();
        updateBrowserAssistRuntimeStatus();
      }
    }
    window.installBrowserAssistPlugin = installBrowserAssistPlugin;

    function renderMcpProjectAnalysisList(title, values) {
      var items = Array.isArray(values) ? values : [];
      if (!items.length) return '';
      return '<div style="margin-top:14px;"><div style="font-weight:800;margin-bottom:6px;">' + escapeHtml(title) + '</div><ul style="margin:0;padding-left:20px;line-height:1.7;">' +
        items.map(function(item) {
          var text = item && typeof item === 'object'
            ? ((item.name ? item.name + '：' : '') + (item.purpose || item.description || JSON.stringify(item)))
            : String(item || '');
          return '<li>' + escapeHtml(text) + '</li>';
        }).join('') +
      '</ul></div>';
    }

    async function analyzeMcpProjectIntegration(pluginId, installationIssue) {
      var plugin = mcpPluginMarketplaceCache.find(function(item) { return String(item.id || '') === String(pluginId || ''); });
      if (!plugin || !plugin.url || adaptingMcpProjectIds.has(String(pluginId || ''))) return;
      adaptingMcpProjectIds.add(String(pluginId || ''));
      mcpIntegrationProgressItems.set('project:' + String(pluginId || ''), {
        name: String(plugin.name || '开源项目'),
        message: 'AI 正在评估项目能力、依赖和 MCP 适配方式'
      });
      updateMcpIntegrationBadge();
      renderMcpPluginMarketplace();
      try {
        var analysisResponse = await fetch('/api/mcp-plugins/analyze-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: plugin.name,
            url: plugin.url,
            description: plugin.description || '',
            installationIssue: String(installationIssue || ''),
            iconKind: plugin.iconKind || 'custom',
            iconUrl: plugin.iconUrl || ''
          })
        });
        var analysisData = await readMcpPluginApiResponse(analysisResponse);
        if (!analysisResponse.ok || !analysisData.success) throw new Error(analysisData.error || '项目接入评估失败');
        if (analysisData.analysis?.feasible === false) {
          throw new Error(analysisData.analysis.summary || 'AI 评估认为该项目不适合安全接入');
        }
        var jobResponse = await fetch('/api/mcp-plugins/integration-jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: plugin.name,
            url: plugin.url,
            description: plugin.description || '',
            installationIssue: String(installationIssue || ''),
            iconKind: plugin.iconKind || 'custom',
            iconUrl: plugin.iconUrl || '',
            analysis: analysisData.analysis || {}
          })
        });
        var jobData = await readMcpPluginApiResponse(jobResponse);
        if (!jobResponse.ok || !jobData.success || !jobData.job?.id) throw new Error(jobData.error || '无法创建后台部署任务');
        var jobId = String(jobData.job.id);
        mcpIntegrationProgressItems.delete('project:' + String(pluginId || ''));
        mcpIntegrationProgressItems.set(jobId, {
          name: String(plugin.name || '开源项目'),
          message: String(jobData.job.message || '部署任务已进入后台队列')
        });
        activeMcpIntegrationJobIds.add(jobId);
        mcpIntegrationJobProjectIds.set(jobId, String(pluginId || ''));
        updateMcpIntegrationBadge();
        pollMcpIntegrationJob(jobId);
      } catch (e) {
        adaptingMcpProjectIds.delete(String(pluginId || ''));
        mcpIntegrationProgressItems.delete('project:' + String(pluginId || ''));
        updateMcpIntegrationBadge();
        renderMcpPluginMarketplace();
        alert('AI 辅助接入失败：' + (e.message || e));
      }
    }
    window.analyzeMcpProjectIntegration = analyzeMcpProjectIntegration;

    function updateMcpIntegrationBadge() {
      var badge = document.getElementById('mcpIntegrationJobBadge');
      if (!badge) return;
      var activeProjectIds = new Set([
        ...Array.from(adaptingMcpProjectIds),
        ...Array.from(installingMcpPluginIds)
      ]);
      var count = activeProjectIds.size;
      badge.hidden = count === 0;
      var items = Array.from(mcpIntegrationProgressItems.values());
      badge.innerHTML = '<span class="mcp-deploy-count">+' + count + '</span>' +
        '<span class="mcp-deploy-progress-popover">' +
          '<span class="mcp-deploy-progress-title">后台安装部署进度</span>' +
          (items.length
            ? items.map(function(item) {
                return '<span class="mcp-deploy-progress-item">' +
                  '<span class="mcp-deploy-progress-name">' + escapeHtml(item.name || 'MCP 项目') + '</span>' +
                  '<span class="mcp-deploy-progress-message">' + escapeHtml(item.message || '正在处理') + '</span>' +
                '</span>';
              }).join('')
            : '<span class="mcp-deploy-progress-message">正在准备后台任务...</span>') +
        '</span>';
    }

    async function pollMcpIntegrationJob(jobId) {
      try {
        var response = await fetch('/api/mcp-plugins/integration-jobs/' + encodeURIComponent(jobId));
        var data = await readMcpPluginApiResponse(response);
        if (!response.ok || !data.success) throw new Error(data.error || '无法读取部署状态');
        var job = data.job || {};
        var progressItem = mcpIntegrationProgressItems.get(jobId) || { name: job.projectName || 'MCP 项目' };
        progressItem.message = String(job.message || (job.status === 'queued' ? '等待后台部署' : '正在部署'));
        mcpIntegrationProgressItems.set(jobId, progressItem);
        updateMcpIntegrationBadge();
        if (job.status === 'queued' || job.status === 'running') {
          setTimeout(function() { pollMcpIntegrationJob(jobId); }, 2200);
          return;
        }
        activeMcpIntegrationJobIds.delete(jobId);
        var projectId = mcpIntegrationJobProjectIds.get(jobId);
        if (projectId) adaptingMcpProjectIds.delete(projectId);
        mcpIntegrationJobProjectIds.delete(jobId);
        mcpIntegrationProgressItems.delete(jobId);
        updateMcpIntegrationBadge();
        await loadInstalledMcpPlugins();
        showModal(
          job.status === 'success' ? 'MCP 部署完成' : 'MCP 部署失败',
          '<div style="padding:16px;line-height:1.7;color:' + (job.status === 'success' ? '#12633d' : 'var(--danger-color)') + ';">' +
            escapeHtml(job.message || (job.status === 'success' ? '插件已经部署并启用。' : '后台部署失败。')) +
          '</div><div class="btns"><button class="confirm" onclick="closeModal()">确定</button></div>',
          false,
          false
        );
      } catch (e) {
        activeMcpIntegrationJobIds.delete(jobId);
        var projectId = mcpIntegrationJobProjectIds.get(jobId);
        if (projectId) adaptingMcpProjectIds.delete(projectId);
        mcpIntegrationJobProjectIds.delete(jobId);
        mcpIntegrationProgressItems.delete(jobId);
        updateMcpIntegrationBadge();
        renderMcpPluginMarketplace();
        showModal('MCP 部署状态异常', '<div style="padding:16px;color:var(--danger-color);">' + escapeHtml(e.message || String(e)) + '</div><div class="btns"><button class="confirm" onclick="closeModal()">确定</button></div>', false, false);
      }
    }

    async function discoverInstalledMcpPlugin(pluginId, silent) {
      try {
        var response = await fetch('/api/mcp-plugins/' + encodeURIComponent(pluginId) + '/discover', { method: 'POST' });
        var data = await readMcpPluginApiResponse(response);
        await loadInstalledMcpPlugins();
        if (!response.ok || !data.success) throw new Error(data.error || '插件检测失败');
        return true;
      } catch (e) {
        if (!silent) alert('检测插件失败：' + (e.message || e));
        return false;
      }
    }
    window.discoverInstalledMcpPlugin = discoverInstalledMcpPlugin;

    async function toggleInstalledMcpPlugin(pluginId, enabled) {
      var plugin = installedMcpPluginsCache.find(function(item) { return String(item.id || '') === String(pluginId || ''); });
      if (enabled && (!plugin || plugin.status !== 'ready' || !Array.isArray(plugin.tools) || plugin.tools.length === 0)) {
        alert('请先检测插件并确认已经发现可用工具。');
        return;
      }
      try {
        var response = await fetch('/api/mcp-plugins/' + encodeURIComponent(pluginId) + '/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !!enabled })
        });
        var data = await readMcpPluginApiResponse(response);
        if (!response.ok || !data.success) throw new Error(data.error || '插件状态保存失败');
        await loadInstalledMcpPlugins();
      } catch (e) {
        alert('更新插件状态失败：' + (e.message || e));
      }
    }
    window.toggleInstalledMcpPlugin = toggleInstalledMcpPlugin;

    async function removeInstalledMcpPlugin(pluginId) {
      if (!confirm('确定卸载这个 MCP 插件吗？本地插件程序本身不会被删除。')) return;
      try {
        var response = await fetch('/api/mcp-plugins/' + encodeURIComponent(pluginId), { method: 'DELETE' });
        var data = await readMcpPluginApiResponse(response);
        if (!response.ok || !data.success) throw new Error(data.error || '插件卸载失败');
        await loadInstalledMcpPlugins();
      } catch (e) {
        alert('卸载插件失败：' + (e.message || e));
      }
    }
    window.removeInstalledMcpPlugin = removeInstalledMcpPlugin;

    function toggleCustomMcpPluginForm() {
      var form = document.getElementById('customMcpPluginForm');
      if (form) form.classList.toggle('show');
    }
    window.toggleCustomMcpPluginForm = toggleCustomMcpPluginForm;

    async function saveCustomMcpPlugin() {
      var id = String(document.getElementById('customMcpId')?.value || '').trim();
      var name = String(document.getElementById('customMcpName')?.value || '').trim();
      var description = String(document.getElementById('customMcpDescription')?.value || '').trim();
      var command = String(document.getElementById('customMcpCommand')?.value || '').trim();
      var args = String(document.getElementById('customMcpArgs')?.value || '').split(/\r?\n/).map(function(value) { return value.trim(); }).filter(Boolean);
      var env = {};
      String(document.getElementById('customMcpEnv')?.value || '').split(/\r?\n/).forEach(function(line) {
        var index = line.indexOf('=');
        if (index > 0) env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
      });
      try {
        await saveMcpPluginRecord({
          id: id,
          name: name,
          description: description,
          command: command,
          args: args,
          env: env,
          enabled: false,
          source: 'custom',
          risk: document.getElementById('customMcpRisk')?.value || 'network'
        });
        toggleCustomMcpPluginForm();
        await loadInstalledMcpPlugins();
      } catch (e) {
        alert('保存插件失败：' + (e.message || e));
      }
    }
    window.saveCustomMcpPlugin = saveCustomMcpPlugin;

    function showRuntimePluginConfigDialog() {
      var html = '' +
        '<div class="runtime-plugin-grid">' +
          runtimePluginStatusBox(
            'R 插件 / Rscript',
            'configRPluginStatus',
            'rManualPath',
            'saveManualRscriptPath',
            'autoDetectRPlugin',
            '粘贴 Rscript.exe 完整路径，例如 C:\\Program Files\\R\\R-4.4.2\\bin\\Rscript.exe',
            '<button type="button" class="runtime-plugin-btn accent" onclick="installRPlugin()">一键安装</button>',
            'r',
            '统计分析、模型计算与论文级作图'
          ) +
          runtimePluginStatusBox(
            'Python 插件 / Python',
            'configPythonPluginStatus',
            'pythonManualPath',
            'saveManualPythonPath',
            'autoDetectPythonPlugin',
            '粘贴 python.exe 完整路径，例如 C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
            '<button type="button" class="runtime-plugin-btn accent" onclick="installPythonPlugin()">一键安装</button>',
            'python',
            '数据处理、脚本运行与科研计算'
          ) +
          runtimePluginStatusBox(
            'OfficeCLI 插件 / Office 文档',
            'configOfficePluginStatus',
            'officeCliManualPath',
            'saveManualOfficeCliPath',
            'autoDetectOfficeCliPlugin',
            '粘贴 officecli.exe / officecli.cmd 完整路径，例如 C:\\Users\\Administrator\\AppData\\Roaming\\npm\\officecli.cmd',
            '<button type="button" class="runtime-plugin-btn accent" onclick="installOfficeCliPlugin()">一键安装</button>',
            'office',
            '读取、校验和处理 Word、Excel、PPT'
          ) +
          runtimePluginStatusBox(
            'Browser Assist MCP / 可见浏览器',
            'configBrowserAssistStatus',
            '',
            '',
            'autoDetectBrowserAssistPlugin',
            '',
            '<button id="installBrowserAssistPluginBtn" type="button" class="runtime-plugin-btn accent" onclick="installBrowserAssistPlugin()">一键安装</button>',
            'browser',
            '网页受登录或人机验证阻塞时，由用户接管验证，AI 随后继续读取'
          ) +
        '</div>' +
        '<section class="mcp-plugin-section">' +
          '<div class="mcp-plugin-section-head">' +
            '<div><div class="mcp-plugin-section-title">已安装 MCP 插件 <span id="mcpIntegrationJobBadge" class="mcp-deploy-badge" hidden>+1</span></div><div class="mcp-plugin-section-desc">检测成功并启用的插件工具会自动提供给 AI。</div></div>' +
          '</div>' +
          '<div class="mcp-plugin-panel mcp-installed-panel"><div id="installedMcpPluginList" class="mcp-plugin-list"><div class="mcp-plugin-empty">正在读取已安装插件...</div></div></div>' +
        '</section>' +
        '<section class="mcp-plugin-section">' +
          '<div class="mcp-plugin-section-head">' +
            '<div><div class="mcp-plugin-section-title">MCP 插件市场</div><div class="mcp-plugin-section-desc">默认展示学术写作相关插件；在线检索 npm、GitHub、Smithery、Glama、PulseMCP 与 MCP.so。</div></div>' +
            '<div style="display:flex;gap:7px;"><button type="button" class="runtime-plugin-btn" onclick="toggleMcpMarketplaceConfig()">市场 API 配置</button><button type="button" class="runtime-plugin-btn accent" onclick="toggleCustomMcpPluginForm()">＋ 手动添加 MCP</button></div>' +
          '</div>' +
          '<div id="mcpMarketplaceConfigForm" class="mcp-plugin-form">' +
            '<input id="mcpSmitheryApiKey" type="password" autocomplete="off" placeholder="Smithery API Key（留空则保留原值）">' +
            '<input id="mcpPulseApiKey" type="password" autocomplete="off" placeholder="PulseMCP API Key（留空则保留原值）">' +
            '<input id="mcpPulseTenantId" autocomplete="off" placeholder="PulseMCP Tenant ID（留空则保留原值）">' +
            '<div id="mcpMarketplaceConfigStatus" style="font-size:11px;color:var(--text-secondary);align-self:center;">正在读取市场配置...</div>' +
            '<div class="wide" style="display:flex;justify-content:flex-end;gap:7px;"><button type="button" class="runtime-plugin-btn" onclick="toggleMcpMarketplaceConfig()">取消</button><button type="button" class="runtime-plugin-btn accent" onclick="saveMcpMarketplaceConfigFromForm()">加密保存</button></div>' +
          '</div>' +
          '<div id="customMcpPluginForm" class="mcp-plugin-form">' +
            '<input id="customMcpId" placeholder="插件 ID，例如 my-search">' +
            '<input id="customMcpName" placeholder="插件名称">' +
            '<input id="customMcpCommand" placeholder="启动命令，例如 npx 或 C:\\tools\\server.exe">' +
            '<select id="customMcpRisk"><option value="read">只读</option><option value="network" selected>联网</option><option value="write">文件写入</option><option value="command">命令执行</option></select>' +
            '<input id="customMcpDescription" class="wide" placeholder="插件用途说明，AI 会依据这段说明选择插件">' +
            '<textarea id="customMcpArgs" placeholder="启动参数，每行一个"></textarea>' +
            '<textarea id="customMcpEnv" placeholder="环境变量，每行 KEY=value"></textarea>' +
            '<div class="wide" style="display:flex;justify-content:flex-end;gap:7px;"><button type="button" class="runtime-plugin-btn" onclick="toggleCustomMcpPluginForm()">取消</button><button type="button" class="runtime-plugin-btn accent" onclick="saveCustomMcpPlugin()">保存插件</button></div>' +
          '</div>' +
          '<div class="mcp-market-search">' +
            '<input id="mcpMarketSearchInput" placeholder="搜索文献、引用、DOI、期刊或其他 MCP 插件" onkeydown="if(event.key===\'Enter\'){event.preventDefault();searchOnlineMcpPlugins();}">' +
            '<button type="button" class="runtime-plugin-btn mcp-online-search-btn" onclick="searchOnlineMcpPlugins()">在线搜索</button>' +
          '</div>' +
          '<div id="mcpMarketWarning" style="min-height:0;margin:-5px 0 10px;color:var(--danger-color);font-size:10px;line-height:1.45;"></div>' +
          '<div class="mcp-plugin-panel mcp-market-panel"><div id="mcpPluginMarketplaceList" class="mcp-plugin-list"><div class="mcp-plugin-empty">正在读取插件市场...</div></div></div>' +
        '</section>';
      showHomeUtilityPage('plugins', '插件', '统一配置 R、Python 和 OfficeCLI；保存后自动注入工作目录、Codex CLI 与本地 AI 工具调用。', html);
      setTimeout(function() {
        refreshRPluginStatus();
        refreshPythonPluginStatus();
        resumePythonPluginInstallStatus();
        refreshOfficeCliPluginStatus();
        updateMcpIntegrationBadge();
        loadMcpMarketplaceConfigStatus();
        loadMcpPluginCenter();
      }, 60);
    }
    window.showRuntimePluginConfigDialog = showRuntimePluginConfigDialog;

    // 显示 R 作图对话框
    function showRPlotDialog() {
      var html = `
        <h3>📈 R 语言作图</h3>
        <div id="rPluginStatus" style="margin-bottom:10px;padding:8px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-tip-bg);color:var(--text-secondary);font-size:11px;line-height:1.55;">
          正在检测本机 R 插件...
        </div>
        
        <!-- 模式切换 -->
        <div style="margin-bottom: 12px; display: flex; gap: 8px;">
          <button id="rModeNew" onclick="switchRMode('new')" style="flex: 1; padding: 8px 12px; background: var(--accent-color); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;">
            🆕 新建代码
          </button>
          <button id="rModeDebug" onclick="switchRMode('debug')" style="flex: 1; padding: 8px 12px; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer; font-size: 13px;">
            🔧 调试已有代码
          </button>
        </div>
        
        <!-- 两列布局容器 -->
        <div style="display: flex; gap: 16px;">
          <!-- 左列：基础配置 -->
          <div style="flex: 1; min-width: 200px;">
            <div style="font-size: 11px; color: var(--accent-color); margin-bottom: 8px; font-weight: 600;">📋 基础配置</div>
            
            <!-- 新建模式：文件上传 -->
            <div id="rNewFileSection" style="margin-bottom: 12px;">
              <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">
                Excel 文件
              </label>
              <input type="file" id="rPlotFile" accept=".xlsx,.xls,.csv" style="width: 100%; padding: 6px; background: var(--modal-input-bg); border: 1px solid var(--modal-input-border); border-radius: 4px; color: var(--text-primary); font-size: 12px;">
              <div id="rDataAnalysisLinkNotice" style="display:none;margin-top:6px;padding:7px 8px;border:1px solid var(--accent-color);border-radius:6px;background:var(--modal-tip-bg);color:var(--text-secondary);font-size:11px;line-height:1.5;"></div>
            </div>
            
            <!-- 调试模式：代码路径 -->
            <div id="rDebugFileSection" style="margin-bottom: 12px; display: none;">
              <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">
                R 代码文件路径
              </label>
              <input type="text" id="rCodePath" placeholder="例如：D:/桌面文件/test_plot.R" style="width: 100%; padding: 6px; background: var(--modal-input-bg); border: 1px solid var(--modal-input-border); border-radius: 4px; color: var(--text-primary); font-size: 12px;">
              <small style="color: var(--text-secondary); font-size: 10px;">工作目录会自动从文件路径推断</small>
            </div>
            
            <!-- 新建模式：工作目录 -->
            <div id="rWorkDirSection" style="margin-bottom: 12px;">
              <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">
                工作目录（可选）
              </label>
              <input type="text" id="rWorkDir" placeholder="D:/桌面文件/..." style="width: 100%; padding: 6px; background: var(--modal-input-bg); border: 1px solid var(--modal-input-border); border-radius: 4px; color: var(--text-primary); font-size: 12px;">
            </div>
            
            <div style="margin-bottom: 12px;">
              <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">
                数据文件名
              </label>
              <input type="text" id="rDataFilename" placeholder="data.xlsx" style="width: 100%; padding: 6px; background: var(--modal-input-bg); border: 1px solid var(--modal-input-border); border-radius: 4px; color: var(--text-primary); font-size: 12px;">
            </div>
            
            <!-- 新建模式：图表和分析类型 -->
            <div id="rChartTypeSection" style="margin-bottom: 12px;">
              <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">
                图表类型
              </label>
              <select id="rPlotChartType" style="width: 100%; padding: 6px; background: var(--modal-input-bg); border: 1px solid var(--modal-input-border); border-radius: 4px; color: var(--text-primary); font-size: 12px;">
                <option value="">-- 请选择 --</option>
                ${R_CHART_TYPES.map(t => `<option value="${t.id}">${t.name}</option>`).join('\n')}
              </select>
            </div>
            
            <div id="rAnalysisTypeSection" style="margin-bottom: 12px;">
              <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">
                分析类型
              </label>
              <select id="rPlotAnalysisType" style="width: 100%; padding: 6px; background: var(--modal-input-bg); border: 1px solid var(--modal-input-border); border-radius: 4px; color: var(--text-primary); font-size: 12px;">
                <option value="">-- 请选择 --</option>
                ${R_ANALYSIS_TYPES.map(t => `<option value="${t.id}">${t.name}</option>`).join('\n')}
              </select>
            </div>
          </div>
          
          <!-- 右列：样式和需求 -->
          <div style="flex: 1; min-width: 200px;">
            <div style="font-size: 11px; color: var(--accent-color); margin-bottom: 8px; font-weight: 600;">🎨 样式配置</div>
            
            <div style="margin-bottom: 12px;">
              <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">
                作图主题
              </label>
              <select id="rPlotTheme" onchange="toggleCustomTheme()" style="width: 100%; padding: 6px; background: var(--modal-input-bg); border: 1px solid var(--modal-input-border); border-radius: 4px; color: var(--text-primary); font-size: 12px;">
                ${R_THEMES.map(t => `<option value="${t.id}">${t.name}</option>`).join('\n')}
              </select>
            </div>
            <div id="rPlotTreatmentColorPanel" class="r-palette-panel"></div>
            
            <div id="customThemeSection" style="margin-bottom: 12px; display: none;">
              <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">
                自定义主题代码
              </label>
              <textarea id="rCustomTheme" style="width: 100%; padding: 6px; height: 80px; background: var(--modal-code-bg); border: 1px solid var(--modal-input-border); border-radius: 4px; color: var(--text-primary); resize: vertical; font-family: inherit; font-size: 11px;">
new_theme1 <- theme_bw() +
  theme(panel.grid = element_blank())+
  theme(panel.border = element_rect(colour = "black",fill = NA,linewidth = 0.5))+
  theme(axis.text.x = element_text(size=14,color='black', family = "serif"),
        axis.text.y  = element_text(size=14,color='black', family = "serif"),
        axis.title=element_text(size=14,color='black',family = "serif"))
</textarea>
            </div>
            
            <div style="font-size: 11px; color: var(--accent-color); margin: 12px 0 8px 0; font-weight: 600;">💬 需求说明</div>
            
            <div style="margin-bottom: 12px;">
              <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">
                其他要求
              </label>
              <textarea id="rPlotCustom" placeholder="描述你的具体需求..." style="width: 100%; padding: 6px; height: 80px; background: var(--modal-input-bg); border: 1px solid var(--modal-input-border); border-radius: 4px; color: var(--text-primary); resize: vertical; font-size: 12px;"></textarea>
            </div>
            
            <!-- 调试模式特殊提示 -->
            <div id="rDebugTips" style="display: none; padding: 8px; background: var(--modal-tip-bg); border-radius: 4px; font-size: 11px; color: var(--text-secondary);">
              💡 调试模式说明：<br>
              • 填写已有R代码文件路径<br>
              • 在"其他要求"中描述需要修改的内容<br>
              • AI会读取代码并根据要求调整
            </div>
          </div>
        </div>
        
        <div id="rPlotResult" style="display: none; padding: 10px; border-radius: 6px; font-size: 12px; margin-top: 12px;"></div>
        
        <div class="btns" style="margin-top: 12px;">
          <button class="cancel" onclick="closeModal()">取消</button>
          <button class="ok" onclick="generateRCode()">生成代码并出图</button>
        </div>
      `;
      
      showModal('R 语言作图', html, true);  // true = 宽对话框
      
      // 默认为新建模式
      window.rCurrentMode = 'new';
      
      // 如果选择了文件，自动填充文件名
      setTimeout(function() {
        var fileInput = document.getElementById('rPlotFile');
        if (fileInput) {
          fileInput.addEventListener('change', function() {
            if (fileInput.files && fileInput.files.length > 0) {
              var filenameInput = document.getElementById('rDataFilename');
              if (filenameInput && !filenameInput.value) {
                filenameInput.value = fileInput.files[0].name;
              }
            }
          });
        }
        applyDataAnalysisLinkToRDialog();
        renderRPlotPalettePanel('rPlotTreatmentColorPanel', { source: 'r-plot' });
        refreshRPluginStatus();
      }, 100);
    }
    window.showRPlotDialog = showRPlotDialog;

    async function refreshRPluginStatus() {
      var statusDiv = getRPluginStatusElement();
      if (!statusDiv) return;
      try {
        var response = await fetch('/api/r-code/plugin/status');
        var payload = await response.json();
        var status = payload.data || {};
        var isConfigPanel = statusDiv.id === 'configRPluginStatus';
        var actionsHtml = isConfigPanel
          ? ''
          : '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px;">' +
              '<button type="button" onclick="showRuntimePluginConfigDialog()" style="padding:4px 8px;border:1px solid var(--accent-color);border-radius:6px;background:transparent;color:var(--accent-color);cursor:pointer;font-size:11px;font-weight:800;">到配置中心管理 R/Python 插件</button>' +
            '</div>';
        if (payload.success && status.available) {
          statusDiv.style.borderColor = 'var(--accent-color)';
          statusDiv.innerHTML = 'R 插件可用：' + escapeHtml(status.version || status.path || 'Rscript') +
            '<br><span style="word-break:break-all;">' + escapeHtml(status.path || '') + '</span>' +
            '<br>后续会自动执行 R 代码并返回 PNG/PDF 图表。' + actionsHtml;
        } else {
          statusDiv.style.borderColor = 'var(--warning-color)';
          statusDiv.innerHTML =
            '未检测到 Rscript。仍可生成 R 代码；请到配置中心填写 Rscript.exe，或使用一键安装 R 插件。运行时目录：<code>' +
            escapeHtml(status.runtimeRoot || 'data/r-runtime') +
            '</code>。' + actionsHtml;
        }
      } catch (error) {
        statusDiv.style.borderColor = 'var(--warning-color)';
        statusDiv.textContent = 'R 插件状态检测失败：' + (error.message || error);
      }
    }
    window.refreshRPluginStatus = refreshRPluginStatus;

    async function autoDetectRPlugin() {
      var statusDiv = getRPluginStatusElement();
      if (statusDiv) {
        statusDiv.style.borderColor = 'var(--warning-color)';
        statusDiv.textContent = '正在重新检测 Rscript...';
      }
      try {
        await fetch('/api/r-code/plugin/auto-detect', { method: 'POST' });
      } catch (error) {
        if (statusDiv) statusDiv.textContent = '重新检测失败：' + (error.message || error);
      }
      await refreshRPluginStatus();
    }
    window.autoDetectRPlugin = autoDetectRPlugin;

    async function saveManualRscriptPath() {
      var input = document.getElementById('rManualPath');
      var statusDiv = getRPluginStatusElement();
      var value = input ? input.value.trim() : '';
      if (!value) {
        if (statusDiv) statusDiv.textContent = '请先填写 Rscript.exe 完整路径。';
        return;
      }
      if (statusDiv) {
        statusDiv.style.borderColor = 'var(--warning-color)';
        statusDiv.textContent = '正在验证 Rscript 路径...';
      }
      try {
        var response = await fetch('/api/r-code/plugin/path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rscriptPath: value })
        });
        var payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || '保存失败');
        appendMessage('✅ Rscript 路径已保存：' + value, 'bot', false, true);
        await refreshRPluginStatus();
      } catch (error) {
        if (statusDiv) {
          statusDiv.style.borderColor = 'var(--danger-color)';
          statusDiv.textContent = 'Rscript 路径无效：' + (error.message || error);
        }
      }
    }
    window.saveManualRscriptPath = saveManualRscriptPath;

    async function refreshPythonPluginStatus() {
      var statusDiv = document.getElementById('configPythonPluginStatus');
      if (!statusDiv) return;
      try {
        var response = await fetch('/api/python-plugin/status');
        var payload = await response.json();
        var status = payload.data || {};
        if (payload.success && status.available) {
          statusDiv.style.borderColor = 'var(--accent-color)';
          statusDiv.innerHTML =
            'Python 插件可用：' + escapeHtml(status.version || status.path || 'Python') +
            '<br><span style="word-break:break-all;">' + escapeHtml(status.path || '') + '</span>' +
            '<br>工作目录 shell、Codex CLI 和本地工具会继承该 Python 环境。';
        } else {
          statusDiv.style.borderColor = 'var(--warning-color)';
          statusDiv.innerHTML = '未检测到 Python。请点击自动检测，或填写 python.exe/python3 的完整路径。';
        }
      } catch (error) {
        statusDiv.style.borderColor = 'var(--warning-color)';
        statusDiv.textContent = 'Python 插件状态检测失败：' + (error.message || error);
      }
    }
    window.refreshPythonPluginStatus = refreshPythonPluginStatus;

    async function autoDetectPythonPlugin() {
      var statusDiv = document.getElementById('configPythonPluginStatus');
      if (statusDiv) {
        statusDiv.style.borderColor = 'var(--warning-color)';
        statusDiv.textContent = '正在自动检测 Python...';
      }
      try {
        await fetch('/api/python-plugin/auto-detect', { method: 'POST' });
      } catch (error) {
        if (statusDiv) statusDiv.textContent = '自动检测失败：' + (error.message || error);
      }
      await refreshPythonPluginStatus();
    }
    window.autoDetectPythonPlugin = autoDetectPythonPlugin;

    async function saveManualPythonPath() {
      var input = document.getElementById('pythonManualPath');
      var statusDiv = document.getElementById('configPythonPluginStatus');
      var value = input ? input.value.trim() : '';
      if (!value) {
        if (statusDiv) statusDiv.textContent = '请先填写 python.exe/python3 的完整路径。';
        return;
      }
      if (statusDiv) {
        statusDiv.style.borderColor = 'var(--warning-color)';
        statusDiv.textContent = '正在验证 Python 路径...';
      }
      try {
        var response = await fetch('/api/python-plugin/path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pythonPath: value })
        });
        var payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || '保存失败');
        if (typeof appendMessage === 'function') appendMessage('✅ Python 路径已保存：' + value, 'bot', false, true);
        await refreshPythonPluginStatus();
      } catch (error) {
        if (statusDiv) {
          statusDiv.style.borderColor = 'var(--danger-color)';
          statusDiv.textContent = 'Python 路径无效：' + (error.message || error);
        }
      }
    }
    window.saveManualPythonPath = saveManualPythonPath;

    async function installPythonPlugin() {
      var statusDiv = document.getElementById('configPythonPluginStatus');
      if (statusDiv) {
        statusDiv.style.borderColor = 'var(--warning-color)';
        statusDiv.textContent = '正在启动 Python 插件一键安装...';
      }
      try {
        var response = await fetch('/api/python-plugin/install', { method: 'POST' });
        var payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || '启动安装失败');
        pythonPluginInstallLastTerminalStatus = '';
        pollPythonPluginInstallStatus(true);
      } catch (error) {
        if (statusDiv) {
          statusDiv.style.borderColor = 'var(--danger-color)';
          statusDiv.textContent = 'Python 插件安装启动失败：' + (error.message || error);
        }
        if (typeof appendMessage === 'function') {
          appendMessage('❌ Python 插件安装启动失败：' + (error.message || error), 'bot', false, true);
        }
      }
    }
    window.installPythonPlugin = installPythonPlugin;

    async function resumePythonPluginInstallStatus() {
      try {
        var response = await fetch('/api/python-plugin/install/status');
        var payload = await response.json();
        if (payload && payload.data && payload.data.status === 'running') {
          pollPythonPluginInstallStatus(true);
        }
      } catch (error) {
        // The regular Python status panel remains usable when no install job can be resumed.
      }
    }

    async function pollPythonPluginInstallStatus(startTimer) {
      if (startTimer && pythonPluginInstallPollTimer) {
        clearInterval(pythonPluginInstallPollTimer);
        pythonPluginInstallPollTimer = null;
      }
      try {
        var response = await fetch('/api/python-plugin/install/status');
        var payload = await response.json();
        var job = payload.data || {};
        renderPythonPluginInstallStatus(job);
        if (job.status === 'running' && startTimer && !pythonPluginInstallPollTimer) {
          pythonPluginInstallPollTimer = setInterval(function() {
            pollPythonPluginInstallStatus(false);
          }, 2000);
        }
        if (job.status === 'complete' || job.status === 'failed') {
          if (pythonPluginInstallPollTimer) {
            clearInterval(pythonPluginInstallPollTimer);
            pythonPluginInstallPollTimer = null;
          }
          if (pythonPluginInstallLastTerminalStatus !== job.status) {
            pythonPluginInstallLastTerminalStatus = job.status;
            if (typeof appendMessage === 'function') {
              appendMessage(job.status === 'complete'
                ? '✅ Python 插件已安装并自动配置完成。'
                : '❌ Python 插件安装失败：' + (job.error || job.message || '未知错误'), 'bot', false, true);
            }
          }
          if (job.status === 'complete') setTimeout(refreshPythonPluginStatus, 600);
        }
      } catch (error) {
        var statusDiv = document.getElementById('configPythonPluginStatus');
        if (statusDiv) statusDiv.textContent = '读取 Python 插件安装进度失败：' + (error.message || error);
      }
    }
    window.pollPythonPluginInstallStatus = pollPythonPluginInstallStatus;

    function renderPythonPluginInstallStatus(job) {
      var statusDiv = document.getElementById('configPythonPluginStatus');
      if (!statusDiv) return;
      var progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
      var color = job.status === 'failed' ? 'var(--danger-color)' : 'var(--accent-color)';
      statusDiv.style.borderColor = color;
      statusDiv.innerHTML =
        '<div style="font-weight:700;color:var(--text-primary);margin-bottom:5px;">Python 插件安装：' + escapeHtml(job.message || '处理中') + '</div>' +
        '<div style="height:7px;background:rgba(127,127,127,0.18);border-radius:999px;overflow:hidden;margin-bottom:6px;">' +
          '<div style="height:100%;width:' + progress + '%;background:' + color + ';"></div>' +
        '</div>' +
        '<div style="color:var(--text-secondary);">阶段：' + escapeHtml(job.stage || '-') + ' · ' + progress + '%</div>' +
        (job.packageManager ? '<div style="margin-top:6px;color:var(--text-secondary);">安装器：' + escapeHtml(job.packageManager) + '</div>' : '') +
        (job.version ? '<div style="margin-top:6px;color:var(--text-secondary);">版本：' + escapeHtml(job.version) + '</div>' : '') +
        (job.pythonPath ? '<div style="margin-top:6px;color:var(--text-secondary);word-break:break-all;">Python：' + escapeHtml(job.pythonPath) + '</div>' : '') +
        (job.error ? '<div style="margin-top:6px;color:var(--danger-color);white-space:pre-wrap;">' + escapeHtml(job.error) + '</div>' : '');
    }

    async function refreshOfficeCliPluginStatus() {
      var statusDiv = document.getElementById('configOfficePluginStatus');
      if (!statusDiv) return;
      try {
        var response = await fetch('/api/office-plugin/status');
        var payload = await response.json();
        var status = payload.data || {};
        if (payload.success && status.available) {
          statusDiv.style.borderColor = 'var(--accent-color)';
          statusDiv.innerHTML =
            'OfficeCLI 插件可用：' + escapeHtml(status.version || status.path || 'officecli') +
            '<br><span style="word-break:break-all;">' + escapeHtml(status.path || '') + '</span>' +
            '<br>工作目录工具可直接读取、校验、渲染和修改 docx/xlsx/pptx。';
        } else {
          statusDiv.style.borderColor = 'var(--warning-color)';
          statusDiv.innerHTML =
            '未检测到 OfficeCLI。仍可使用普通文件工具；需要 AI 直接处理 Word/Excel/PPT 时，请安装 OfficeCLI 或填写 officecli.exe/officecli.cmd 路径。';
        }
      } catch (error) {
        statusDiv.style.borderColor = 'var(--warning-color)';
        statusDiv.textContent = 'OfficeCLI 插件状态检测失败：' + (error.message || error);
      }
    }
    window.refreshOfficeCliPluginStatus = refreshOfficeCliPluginStatus;

    async function autoDetectOfficeCliPlugin() {
      var statusDiv = document.getElementById('configOfficePluginStatus');
      if (statusDiv) {
        statusDiv.style.borderColor = 'var(--warning-color)';
        statusDiv.textContent = '正在自动检测 OfficeCLI...';
      }
      try {
        await fetch('/api/office-plugin/auto-detect', { method: 'POST' });
      } catch (error) {
        if (statusDiv) statusDiv.textContent = '自动检测失败：' + (error.message || error);
      }
      await refreshOfficeCliPluginStatus();
    }
    window.autoDetectOfficeCliPlugin = autoDetectOfficeCliPlugin;

    async function saveManualOfficeCliPath() {
      var input = document.getElementById('officeCliManualPath');
      var statusDiv = document.getElementById('configOfficePluginStatus');
      var value = input ? input.value.trim() : '';
      if (!value) {
        if (statusDiv) statusDiv.textContent = '请先填写 officecli.exe / officecli.cmd 的完整路径。';
        return;
      }
      if (statusDiv) {
        statusDiv.style.borderColor = 'var(--warning-color)';
        statusDiv.textContent = '正在验证 OfficeCLI 路径...';
      }
      try {
        var response = await fetch('/api/office-plugin/path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ officeCliPath: value })
        });
        var payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || '保存失败');
        if (typeof appendMessage === 'function') appendMessage('✅ OfficeCLI 路径已保存：' + value, 'bot', false, true);
        await refreshOfficeCliPluginStatus();
      } catch (error) {
        if (statusDiv) {
          statusDiv.style.borderColor = 'var(--danger-color)';
          statusDiv.textContent = 'OfficeCLI 路径无效：' + (error.message || error);
        }
      }
    }
    window.saveManualOfficeCliPath = saveManualOfficeCliPath;

    async function installOfficeCliPlugin() {
      var statusDiv = document.getElementById('configOfficePluginStatus');
      if (statusDiv) {
        statusDiv.style.borderColor = 'var(--warning-color)';
        statusDiv.textContent = '正在启动 OfficeCLI 插件一键安装...';
      }
      try {
        var response = await fetch('/api/office-plugin/install', { method: 'POST' });
        var payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || '启动安装失败');
        officeCliInstallLastTerminalStatus = '';
        pollOfficeCliInstallStatus(true);
      } catch (error) {
        if (statusDiv) {
          statusDiv.style.borderColor = 'var(--danger-color)';
          statusDiv.textContent = 'OfficeCLI 插件安装启动失败：' + (error.message || error);
        }
        if (typeof appendMessage === 'function') appendMessage('❌ OfficeCLI 插件安装启动失败：' + (error.message || error), 'bot', false, true);
      }
    }
    window.installOfficeCliPlugin = installOfficeCliPlugin;

    async function pollOfficeCliInstallStatus(startTimer) {
      if (startTimer && officeCliInstallPollTimer) {
        clearInterval(officeCliInstallPollTimer);
        officeCliInstallPollTimer = null;
      }
      try {
        var response = await fetch('/api/office-plugin/install/status');
        var payload = await response.json();
        var job = payload.data || {};
        renderOfficeCliInstallStatus(job);
        if (job.status === 'running' && startTimer && !officeCliInstallPollTimer) {
          officeCliInstallPollTimer = setInterval(function() {
            pollOfficeCliInstallStatus(false);
          }, 2000);
        }
        if (job.status === 'complete' || job.status === 'failed') {
          if (officeCliInstallPollTimer) {
            clearInterval(officeCliInstallPollTimer);
            officeCliInstallPollTimer = null;
          }
          if (officeCliInstallLastTerminalStatus !== job.status) {
            officeCliInstallLastTerminalStatus = job.status;
            if (typeof appendMessage === 'function') {
              appendMessage(job.status === 'complete'
                ? '✅ OfficeCLI 插件已安装完成，现在可以直接处理 Word/Excel/PPT。'
                : '❌ OfficeCLI 插件安装失败：' + (job.error || job.message || '未知错误'), 'bot', false, true);
            }
          }
          if (job.status === 'complete') setTimeout(refreshOfficeCliPluginStatus, 600);
        }
      } catch (error) {
        var statusDiv = document.getElementById('configOfficePluginStatus');
        if (statusDiv) statusDiv.textContent = '读取 OfficeCLI 插件安装进度失败：' + (error.message || error);
      }
    }

    function renderOfficeCliInstallStatus(job) {
      var statusDiv = document.getElementById('configOfficePluginStatus');
      if (!statusDiv) return;
      var progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
      var color = job.status === 'failed' ? 'var(--danger-color)' : 'var(--accent-color)';
      statusDiv.style.borderColor = color;
      statusDiv.innerHTML =
        '<div style="font-weight:700;color:var(--text-primary);margin-bottom:5px;">OfficeCLI 插件安装：' + escapeHtml(job.message || '处理中') + '</div>' +
        '<div style="height:7px;background:rgba(127,127,127,0.18);border-radius:999px;overflow:hidden;margin-bottom:6px;">' +
          '<div style="height:100%;width:' + progress + '%;background:' + color + ';"></div>' +
        '</div>' +
        '<div style="color:var(--text-secondary);">阶段：' + escapeHtml(job.stage || '-') + ' · ' + progress + '%</div>' +
        (job.version ? '<div style="margin-top:6px;color:var(--text-secondary);">版本：' + escapeHtml(job.version) + '</div>' : '') +
        (job.officeCliPath ? '<div style="margin-top:6px;color:var(--text-secondary);word-break:break-all;">OfficeCLI：' + escapeHtml(job.officeCliPath) + '</div>' : '') +
        (job.error ? '<div style="margin-top:6px;color:var(--danger-color);white-space:pre-wrap;">' + escapeHtml(job.error) + '</div>' : '');
    }

    async function installRPlugin() {
      var statusDiv = getRPluginStatusElement();
      if (statusDiv) {
        statusDiv.style.borderColor = 'var(--warning-color)';
        statusDiv.textContent = '正在启动 R 插件一键安装...';
      }
      try {
        var response = await fetch('/api/r-code/plugin/install', { method: 'POST' });
        var payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || '启动安装失败');
        rPluginInstallLastTerminalStatus = '';
        pollRPluginInstallStatus(true);
      } catch (error) {
        if (statusDiv) {
          statusDiv.style.borderColor = 'var(--danger-color)';
          statusDiv.textContent = 'R 插件安装启动失败：' + (error.message || error);
        }
        appendMessage('❌ R 插件安装启动失败：' + (error.message || error), 'bot', false, true);
      }
    }
    window.installRPlugin = installRPlugin;

    async function pollRPluginInstallStatus(startTimer) {
      if (startTimer && rPluginInstallPollTimer) {
        clearInterval(rPluginInstallPollTimer);
        rPluginInstallPollTimer = null;
      }
      try {
        var response = await fetch('/api/r-code/plugin/install/status');
        var payload = await response.json();
        var job = payload.data || {};
        renderRPluginInstallStatus(job);
        if (job.status === 'running' && startTimer && !rPluginInstallPollTimer) {
          rPluginInstallPollTimer = setInterval(function() {
            pollRPluginInstallStatus(false);
          }, 2000);
        }
        if (job.status === 'complete' || job.status === 'failed') {
          if (rPluginInstallPollTimer) {
            clearInterval(rPluginInstallPollTimer);
            rPluginInstallPollTimer = null;
          }
          if (rPluginInstallLastTerminalStatus !== job.status) {
            rPluginInstallLastTerminalStatus = job.status;
            appendMessage(job.status === 'complete'
              ? '✅ R 插件已安装完成，现在可以直接生成 PNG/PDF 图表。'
              : '❌ R 插件安装失败：' + (job.error || job.message || '未知错误'), 'bot', false, true);
          }
          if (job.status === 'complete') setTimeout(refreshRPluginStatus, 600);
        }
      } catch (error) {
        var statusDiv = getRPluginStatusElement();
        if (statusDiv) statusDiv.textContent = '读取 R 插件安装进度失败：' + (error.message || error);
      }
    }

    function renderRPluginInstallStatus(job) {
      var statusDiv = getRPluginStatusElement();
      if (!statusDiv) return;
      var progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
      var color = job.status === 'failed' ? 'var(--danger-color)' : 'var(--accent-color)';
      statusDiv.style.borderColor = color;
      statusDiv.innerHTML =
        '<div style="font-weight:700;color:var(--text-primary);margin-bottom:5px;">R 插件安装：' + escapeHtml(job.message || '处理中') + '</div>' +
        '<div style="height:7px;background:rgba(127,127,127,0.18);border-radius:999px;overflow:hidden;margin-bottom:6px;">' +
          '<div style="height:100%;width:' + progress + '%;background:' + color + ';"></div>' +
        '</div>' +
        '<div style="color:var(--text-secondary);">阶段：' + escapeHtml(job.stage || '-') + ' · ' + progress + '%</div>' +
        (job.error ? '<div style="margin-top:6px;color:var(--danger-color);white-space:pre-wrap;">' + escapeHtml(job.error) + '</div>' : '') +
        (job.rscriptPath ? '<div style="margin-top:6px;color:var(--text-secondary);">Rscript：' + escapeHtml(job.rscriptPath) + '</div>' : '');
    }
    window.pollRPluginInstallStatus = pollRPluginInstallStatus;

    function applyDataAnalysisLinkToRDialog() {
      var notice = document.getElementById('rDataAnalysisLinkNotice');
      if (!dataAnalysisPlotLink || !dataAnalysisPlotLink.file) {
        if (notice) notice.style.display = 'none';
        return;
      }

      var filenameInput = document.getElementById('rDataFilename');
      var chartSelect = document.getElementById('rPlotChartType');
      var analysisSelect = document.getElementById('rPlotAnalysisType');
      var customTextarea = document.getElementById('rPlotCustom');
      if (filenameInput && !filenameInput.value) filenameInput.value = dataAnalysisPlotLink.filename || dataAnalysisPlotLink.file.name;
      if (chartSelect && dataAnalysisPlotLink.chartType) chartSelect.value = dataAnalysisPlotLink.chartType;
      if (analysisSelect && dataAnalysisPlotLink.analysisType) analysisSelect.value = dataAnalysisPlotLink.analysisType;
      if (customTextarea && dataAnalysisPlotLink.customRequirements && !customTextarea.value.trim()) {
        customTextarea.value = dataAnalysisPlotLink.customRequirements;
      }
      if (notice) {
        notice.style.display = 'block';
        notice.innerHTML =
          '已联动数据分析文件：<strong style="color:var(--text-primary);">' + escapeHtml(dataAnalysisPlotLink.filename || dataAnalysisPlotLink.file.name) + '</strong><br>' +
          '会自动带入分析方法、变量和推荐图表；手动选择新文件会覆盖联动文件。' +
          '<button type="button" onclick="clearDataAnalysisRLink()" style="margin-left:8px;border:0;background:transparent;color:var(--danger-color);cursor:pointer;font-size:11px;">清除</button>';
      }
    }

    window.clearDataAnalysisRLink = function() {
      dataAnalysisPlotLink = null;
      applyDataAnalysisLinkToRDialog();
    };
    
    // 切换新建/调试模式
    function switchRMode(mode) {
      window.rCurrentMode = mode;
      var newBtn = document.getElementById('rModeNew');
      var debugBtn = document.getElementById('rModeDebug');
      var newFileSection = document.getElementById('rNewFileSection');
      var debugFileSection = document.getElementById('rDebugFileSection');
      var workDirSection = document.getElementById('rWorkDirSection');
      var chartTypeSection = document.getElementById('rChartTypeSection');
      var analysisTypeSection = document.getElementById('rAnalysisTypeSection');
      var debugTips = document.getElementById('rDebugTips');
      
      if (mode === 'new') {
        // 新建模式样式
        newBtn.style.background = 'var(--accent-color)';
        newBtn.style.color = 'white';
        newBtn.style.border = 'none';
        debugBtn.style.background = 'var(--bg-secondary)';
        debugBtn.style.color = 'var(--text-primary)';
        debugBtn.style.border = '1px solid var(--border-color)';
        
        // 显示/隐藏相关区域
        newFileSection.style.display = 'block';
        debugFileSection.style.display = 'none';
        workDirSection.style.display = 'block';
        chartTypeSection.style.display = 'block';
        analysisTypeSection.style.display = 'block';
        debugTips.style.display = 'none';
      } else {
        // 调试模式样式
        debugBtn.style.background = 'var(--accent-color)';
        debugBtn.style.color = 'white';
        debugBtn.style.border = 'none';
        newBtn.style.background = 'var(--bg-secondary)';
        newBtn.style.color = 'var(--text-primary)';
        newBtn.style.border = '1px solid var(--border-color)';
        
        // 显示/隐藏相关区域
        newFileSection.style.display = 'none';
        debugFileSection.style.display = 'block';
        workDirSection.style.display = 'none';  // 调试模式隐藏工作目录（从代码路径推断）
        chartTypeSection.style.display = 'none';
        analysisTypeSection.style.display = 'none';
        debugTips.style.display = 'block';
      }
    }
    window.switchRMode = switchRMode;
    
    // 切换自定义主题显示
    function toggleCustomTheme() {
      var themeSelect = document.getElementById('rPlotTheme');
      var customSection = document.getElementById('customThemeSection');
      if (themeSelect && customSection) {
        customSection.style.display = themeSelect.value === 'custom' ? 'block' : 'none';
      }
    }
    window.toggleCustomTheme = toggleCustomTheme;
    
    // 生成 R 代码
    async function generateRCode() {
      var resultDiv = document.getElementById('rPlotResult');
      var mode = window.rCurrentMode || 'new';
      
      // 新增配置字段
      var workDir = document.getElementById('rWorkDir')?.value.trim() || '';
      var dataFilename = document.getElementById('rDataFilename')?.value.trim() || '';
      var themeId = document.getElementById('rPlotTheme')?.value || 'paper_clean';
      var customThemeCode = document.getElementById('rCustomTheme')?.value.trim() || '';
      var customReqs = document.getElementById('rPlotCustom').value;
      
      // 验证 API 配置
      if (!apiConfig.url || !apiConfig.key) {
        resultDiv.style.display = 'block';
        resultDiv.style.background = 'rgba(220,38,38,0.15)';
        resultDiv.textContent = '请先配置 API（点击 API 设置）';
        return;
      }
      
      // 根据模式验证
      if (mode === 'new') {
        // 新建模式验证
        var fileInput = document.getElementById('rPlotFile');
        var linkedDataAnalysisFile = dataAnalysisPlotLink && dataAnalysisPlotLink.file ? dataAnalysisPlotLink.file : null;
        var selectedRDataFile = fileInput && fileInput.files && fileInput.files.length > 0 ? fileInput.files[0] : linkedDataAnalysisFile;
        var chartType = document.getElementById('rPlotChartType').value;
        var analysisType = document.getElementById('rPlotAnalysisType').value;
        
        if (!selectedRDataFile) {
          resultDiv.style.display = 'block';
          resultDiv.style.background = 'rgba(220,38,38,0.15)';
          resultDiv.textContent = '请选择 Excel/CSV 文件，或先在数据分析中上传数据';
          return;
        }
        
        if (!chartType) {
          resultDiv.style.display = 'block';
          resultDiv.style.background = 'rgba(220,38,38,0.15)';
          resultDiv.textContent = '请选择图表类型';
          return;
        }
        
        if (!analysisType) {
          resultDiv.style.display = 'block';
          resultDiv.style.background = 'rgba(220,38,38,0.15)';
          resultDiv.textContent = '请选择分析类型';
          return;
        }
      } else {
        // 调试模式验证
        var codePath = document.getElementById('rCodePath')?.value.trim() || '';
        
        if (!codePath) {
          resultDiv.style.display = 'block';
          resultDiv.style.background = 'rgba(220,38,38,0.15)';
          resultDiv.textContent = '请填写 R 代码文件路径';
          return;
        }
        
        if (!customReqs) {
          resultDiv.style.display = 'block';
          resultDiv.style.background = 'rgba(220,38,38,0.15)';
          resultDiv.textContent = '请描述需要修改的内容';
          return;
        }
      }
      
      // 获取主题代码
      var themeCode = '';
      if (themeId === 'custom') {
        themeCode = customThemeCode;
      } else {
        var selectedTheme = R_THEMES.find(function(t) { return t.id === themeId; });
        themeCode = selectedTheme ? selectedTheme.code : '';
      }
      
      // 显示进度
      resultDiv.style.display = 'block';
      resultDiv.style.background = 'rgba(255,193,7,0.15)';
      resultDiv.textContent = mode === 'new' 
        ? '正在分析数据并生成 R 代码...' 
        : '正在读取代码并进行调整...';
      
      try {
        if (mode === 'new') {
          // 新建模式：上传Excel生成代码
          var fileInput = document.getElementById('rPlotFile');
          var chartType = document.getElementById('rPlotChartType').value;
          var analysisType = document.getElementById('rPlotAnalysisType').value;
          var userChartOverride = inferRChartTypeFromUserQuery(customReqs || '');
          var effectiveChartType = userChartOverride?.chartType || chartType;
          var effectiveAnalysisType = userChartOverride?.analysisType || analysisType;
          var effectiveCustomReqs = appendRPlotTreatmentColorRequirements([
            buildUserQueryPriorityRBlock(customReqs || '', userChartOverride),
            customReqs || ''
          ].filter(Boolean).join('\n\n'));
          var file = fileInput && fileInput.files && fileInput.files.length > 0
            ? fileInput.files[0]
            : (dataAnalysisPlotLink && dataAnalysisPlotLink.file);
          
          if (!dataFilename) {
            dataFilename = file.name;
          }
          
          var formData = new FormData();
          formData.append('file', file);
          formData.append('userId', currentUserId);
          formData.append('apiUrl', apiConfig.url);
          formData.append('apiKey', apiConfig.key);
          formData.append('model', currentModel);
          formData.append('chartType', effectiveChartType);
          formData.append('analysisType', effectiveAnalysisType);
          formData.append('customRequirements', effectiveCustomReqs);
          formData.append('workDir', workDir);
          formData.append('dataFilename', dataFilename);
          formData.append('themeCode', themeCode);
          formData.append('themeId', themeId);
          formData.append('treatmentPaletteConfig', getRPlotTreatmentPaletteConfigJson());
          formData.append('mode', 'new');
          if (file === (dataAnalysisPlotLink && dataAnalysisPlotLink.file)) {
            formData.append('linkedFromDataAnalysis', 'true');
            formData.append('analysisResult', dataAnalysisLastResult && dataAnalysisLastResult.result ? (dataAnalysisLastResult.result.markdown || '') : '');
            formData.append('analysisSelections', JSON.stringify(dataAnalysisPlotLink.selections || {}));
            formData.append('analysisSignificance', JSON.stringify(dataAnalysisPlotLink.significance || null));
          }
          
          var response = await fetch('/api/r-code/generate', {
            method: 'POST',
            body: formData
          });
          
          var result = await response.json();
          
          if (!result.success) {
            resultDiv.style.background = 'rgba(220,38,38,0.15)';
            resultDiv.textContent = '生成失败：' + (result.error || '未知错误');
            return;
          }
          
          // 显示成功
          resultDiv.style.background = 'rgba(16,163,127,0.15)';
          resultDiv.innerHTML = `
            R 代码已生成，正在直接出图...<br>
            <small style="color: var(--text-secondary);">
              文件: ${escapeHtml(result.data.filename)} | ${escapeHtml(result.data.dataStructure.rowCount)} 行数据
            </small>
          `;
          
          appendMessage(buildRCodeChatMarkdown('## 📈 R 语言作图代码已生成', '', result.data.rCode), 'bot', false, true);
          var savedCodePath = await saveRCodeToDesktop(result.data.rCode, file.name);
          await executeGeneratedRPlot({
            rCode: result.data.rCode,
            file: file,
            dataFilename: result.data.dataFilename || dataFilename || file.name,
            originalFilename: file.name,
            codePath: savedCodePath || '',
            instruction: effectiveCustomReqs || customReqs || '',
            chartType: effectiveChartType || '',
            analysisType: effectiveAnalysisType || '',
            themeId: themeId,
            themeCode: themeCode,
            resultDiv: resultDiv,
            label: 'R 语言作图'
          });
          closeModal();
          
        } else {
          // 调试模式：读取已有代码进行微调
          var codePath = document.getElementById('rCodePath').value.trim();
          
          var formData = new FormData();
          formData.append('userId', currentUserId);
          formData.append('apiUrl', apiConfig.url);
          formData.append('apiKey', apiConfig.key);
          formData.append('model', currentModel);
          formData.append('codePath', codePath);
          formData.append('customRequirements', customReqs);
          formData.append('workDir', workDir);
          formData.append('dataFilename', dataFilename);
          formData.append('themeCode', themeCode);
          formData.append('themeId', themeId);
          formData.append('treatmentPaletteConfig', getRPlotTreatmentPaletteConfigJson());
          formData.append('mode', 'debug');
          
          var response = await fetch('/api/r-code/debug', {
            method: 'POST',
            body: formData
          });
          
          var result = await response.json();
          
          if (!result.success) {
            resultDiv.style.background = 'rgba(220,38,38,0.15)';
            resultDiv.textContent = '调试失败：' + (result.error || '未知错误');
            return;
          }
          
          // 显示成功
          resultDiv.style.background = 'rgba(16,163,127,0.15)';
          resultDiv.textContent = 'R 代码已调整';
          
          appendMessage(buildRCodeChatMarkdown('## 🔧 R 代码已调整', '根据你的要求，代码已修改如下：', result.data.rCode), 'bot', false, true);
          var savedCodePath = await saveRCodeToDesktop(result.data.rCode, codePath);
          await executeGeneratedRPlot({
            rCode: result.data.rCode,
            originalFilename: codePath,
            codePath: savedCodePath || codePath,
            instruction: customReqs || '',
            themeId: themeId,
            themeCode: themeCode,
            resultDiv: resultDiv,
            label: '调整后的 R 图表'
          });
          closeModal();
        }
        
      } catch (e) {
        resultDiv.style.background = 'rgba(220,38,38,0.15)';
        resultDiv.textContent = '处理出错：' + e.message;
      }
    }
    window.generateRCode = generateRCode;
    
    // 保存 R 代码到桌面
    async function saveRCodeToDesktop(rCode, originalFilename) {
      var timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      var rFilename = originalFilename 
        ? originalFilename.replace(/\.[^.]+$/, '') + '_plot_' + timestamp + '.R'
        : 'r_plot_code_' + timestamp + '.R';
      
      // 检查是否在 Electron 环境
      if (window.electronAPI && window.electronAPI.saveFileToDesktop) {
        try {
          var saveResult = await window.electronAPI.saveFileToDesktop(rFilename, rCode);
          
          if (saveResult.success) {
            appendMessage('✅ R 代码已保存到桌面：' + saveResult.filepath, 'bot', false, true);
            return saveResult.filepath || '';
          } else {
            appendMessage('⚠️ 保存到桌面失败：' + (saveResult.error || '未知错误') + '\n\n请手动复制上面的代码。', 'bot', false, true);
          }
        } catch (e) {
          appendMessage('⚠️ 保存失败：' + e.message + '\n\n请手动复制上面的代码。', 'bot', false, true);
        }
      } else {
        // Web 环境：触发下载
        try {
          var blob = new Blob([rCode], { type: 'text/plain;charset=utf-8' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = rFilename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          
          appendMessage('✅ R 代码已下载：' + rFilename + '\n\n请在浏览器下载目录中查看。', 'bot', false, true);
          return '';
        } catch (e) {
          appendMessage('⚠️ 下载失败，请手动复制上面的代码并保存为 .R 文件。', 'bot', false, true);
        }
      }
      return '';
    }
    window.saveRCodeToDesktop = saveRCodeToDesktop;

    // ============ 流程图制作（Vism MASTER 兼容入口） ============
    var FLOWCHART_MAKER_STORAGE_KEY = 'scholarharness_flowchart_maker_dsl';
    var FLOWCHART_MAKER_SOURCES = [
      { id: 'overview', label: '全局 Overview', checked: true },
      { id: 'autoResearch', label: 'Auto Research 结果', checked: true },
      { id: 'pdfWiki', label: 'Wiki论点库', checked: true },
      { id: 'memory', label: '长期记忆', checked: false },
      { id: 'literature', label: 'Embedding 文献库', checked: false },
      { id: 'meta', label: 'Meta 分析编码表', checked: false },
      { id: 'bibliometrics', label: '文献计量分析结果', checked: false },
      { id: 'drafts', label: '一键写论文草稿', checked: false }
    ];
    var flowchartMakerMaterialsMarkdown = '';
    var flowchartMakerRenderTimer = null;
    var flowchartMakerSkillStartPos = -1;
    var flowchartMakerSkillActiveIndex = 0;
    var flowchartMakerSkillCandidates = [];

    function getFlowchartMakerDefaultDsl() {
      return [
        'graph TD',
        'P[确定研究问题与目标] --> D1[整理文献与PDF证据]',
        'P --> D2[整理实验数据与图表]',
        'D1 --> M[构建研究逻辑框架]',
        'D2 --> A[统计分析与R作图]',
        'M --> Q{是否需要补充检索或分析}',
        'A --> Q',
        'Q -->|是| R1[Auto Research / Meta / 文献计量补充]',
        'Q -->|否| R2[进入论文写作]',
        'R1 --> O[形成技术路线与论文结构]',
        'R2 --> O',
        'O --> W[一键写论文 / 讨论式写作]'
      ].join('\n');
    }

    function renderFlowchartMakerSourceOptions() {
      return FLOWCHART_MAKER_SOURCES.map(function(source) {
        return '' +
          '<label style="display:flex;align-items:center;gap:6px;padding:7px 8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-secondary);font-size:12px;color:var(--text-primary);cursor:pointer;">' +
            '<input type="checkbox" name="flowchartMakerSource" value="' + escapeHtml(source.id) + '"' + (source.checked ? ' checked' : '') + ' style="width:14px;height:14px;margin:0;accent-color:var(--accent-color);">' +
            '<span>' + escapeHtml(source.label) + '</span>' +
          '</label>';
      }).join('');
    }

    function normalizeFlowchartMakerSkillQuery(value) {
      return String(value || '').toLowerCase().replace(/^\/+/, '').trim();
    }

    function hideFlowchartMakerSkillDropdown() {
      var dropdown = document.getElementById('flowchartMakerSkillDropdown');
      if (dropdown) dropdown.style.display = 'none';
      flowchartMakerSkillStartPos = -1;
      flowchartMakerSkillActiveIndex = 0;
      flowchartMakerSkillCandidates = [];
    }
    window.hideFlowchartMakerSkillDropdown = hideFlowchartMakerSkillDropdown;

    function renderFlowchartMakerSkillDropdown(skills, query) {
      var dropdown = document.getElementById('flowchartMakerSkillDropdown');
      if (!dropdown) return;
      var normalizedQuery = normalizeFlowchartMakerSkillQuery(query);
      var enabledSkills = (Array.isArray(skills) ? skills : []).filter(function(skill) {
        if (!skill || skill.enabled === false || !skill.trigger) return false;
        var haystack = normalizeFlowchartMakerSkillQuery([skill.trigger, skill.name, skill.description].join(' '));
        return !normalizedQuery || haystack.includes(normalizedQuery);
      });
      flowchartMakerSkillCandidates = enabledSkills;
      flowchartMakerSkillActiveIndex = enabledSkills.length ? Math.min(flowchartMakerSkillActiveIndex, enabledSkills.length - 1) : 0;
      if (!enabledSkills.length) {
        dropdown.style.display = 'block';
        dropdown.innerHTML = '<div style="padding:9px 10px;color:var(--text-secondary);font-size:12px;">没有匹配的用户 Skill。请先在持续使用的 Skill 入口添加并启用 Skill。</div>';
        return;
      }
      dropdown.style.display = 'block';
      dropdown.innerHTML = enabledSkills.map(function(skill, index) {
        var active = index === flowchartMakerSkillActiveIndex;
        return '<button type="button" data-flowchart-skill-index="' + index + '" onclick="insertFlowchartMakerSkillFromDropdown(' + index + ')" style="width:100%;display:flex;align-items:center;gap:8px;text-align:left;padding:9px 10px;border:0;border-bottom:1px solid var(--border-color);background:' + (active ? 'var(--modal-tip-bg)' : 'transparent') + ';color:var(--text-primary);cursor:pointer;font-size:12px;">' +
          '<span style="font-weight:800;color:var(--accent-color);">/' + escapeHtml(skill.trigger || '') + '</span>' +
          '<span style="font-weight:700;">' + escapeHtml(skill.name || '用户 Skill') + '</span>' +
          '<span style="color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(skill.description || '') + '</span>' +
        '</button>';
      }).join('');
    }

    async function handleFlowchartMakerSkillInput() {
      var input = document.getElementById('flowchartMakerManualText');
      if (!input) return;
      var value = input.value || '';
      var pos = input.selectionStart || 0;
      var leadingSlashIndex = getLeadingInvocationMarkerIndex(value, '/');
      if (leadingSlashIndex === -1 || pos <= leadingSlashIndex) {
        hideFlowchartMakerSkillDropdown();
        return;
      }
      var textAfterSlash = value.substring(leadingSlashIndex, pos);
      if (/\s/.test(textAfterSlash)) {
        hideFlowchartMakerSkillDropdown();
        return;
      }
      flowchartMakerSkillStartPos = leadingSlashIndex;
      try {
        var skills = await fetchUserSkills();
        var currentValue = input.value || '';
        var currentPos = input.selectionStart || 0;
        var currentLeadingSlashIndex = getLeadingInvocationMarkerIndex(currentValue, '/');
        var currentTextAfterSlash = currentLeadingSlashIndex >= 0
          ? currentValue.substring(currentLeadingSlashIndex, currentPos)
          : '';
        if (
          currentLeadingSlashIndex !== leadingSlashIndex ||
          currentPos <= currentLeadingSlashIndex ||
          /\s/.test(currentTextAfterSlash)
        ) {
          hideFlowchartMakerSkillDropdown();
          return;
        }
        renderFlowchartMakerSkillDropdown(skills, currentTextAfterSlash.slice(1));
      } catch (error) {
        var dropdown = document.getElementById('flowchartMakerSkillDropdown');
        if (dropdown) {
          dropdown.style.display = 'block';
          dropdown.innerHTML = '<div style="padding:9px 10px;color:var(--danger-color);font-size:12px;">读取用户 Skill 失败：' + escapeHtml(error.message || error) + '</div>';
        }
      }
    }
    window.handleFlowchartMakerSkillInput = handleFlowchartMakerSkillInput;

    function insertFlowchartMakerSkillFromDropdown(index) {
      var input = document.getElementById('flowchartMakerManualText');
      var skill = flowchartMakerSkillCandidates[index];
      if (!input || !skill || flowchartMakerSkillStartPos < 0) return;
      var value = input.value || '';
      var pos = input.selectionStart || 0;
      var before = value.substring(0, flowchartMakerSkillStartPos);
      var after = value.substring(pos);
      var prefix = before && !/\s$/.test(before) ? before + ' ' : before;
      var insertText = '/' + skill.trigger + ' ';
      input.value = prefix + insertText + after;
      var newPos = prefix.length + insertText.length;
      input.focus();
      input.setSelectionRange(newPos, newPos);
      hideFlowchartMakerSkillDropdown();
    }
    window.insertFlowchartMakerSkillFromDropdown = insertFlowchartMakerSkillFromDropdown;

    function handleFlowchartMakerSkillKeydown(event) {
      var dropdown = document.getElementById('flowchartMakerSkillDropdown');
      if (!dropdown || dropdown.style.display !== 'block' || !flowchartMakerSkillCandidates.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        flowchartMakerSkillActiveIndex = (flowchartMakerSkillActiveIndex + 1) % flowchartMakerSkillCandidates.length;
        renderFlowchartMakerSkillDropdown(flowchartMakerSkillCandidates, '');
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        flowchartMakerSkillActiveIndex = (flowchartMakerSkillActiveIndex - 1 + flowchartMakerSkillCandidates.length) % flowchartMakerSkillCandidates.length;
        renderFlowchartMakerSkillDropdown(flowchartMakerSkillCandidates, '');
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        insertFlowchartMakerSkillFromDropdown(flowchartMakerSkillActiveIndex);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        hideFlowchartMakerSkillDropdown();
      }
    }
    window.handleFlowchartMakerSkillKeydown = handleFlowchartMakerSkillKeydown;

    function showFlowchartMakerDialog() {
      var savedDsl = '';
      try {
        savedDsl = localStorage.getItem(FLOWCHART_MAKER_STORAGE_KEY) || '';
      } catch (_) {}
      var html = `
        <div style="display:flex;flex-direction:column;gap:10px;color:var(--text-primary);height:100%;min-height:0;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--border-color);border-radius:9px;background:linear-gradient(180deg,rgba(16,163,127,0.08),rgba(16,163,127,0.02));">
            <div style="min-width:0;">
              <div style="font-size:15px;font-weight:800;color:var(--text-primary);">流程图制作</div>
              <div style="margin-top:3px;font-size:12px;color:var(--text-secondary);line-height:1.45;">可勾选项目内数据来源，也可上传文件；PDF 会先用 LiteParse 转成 Markdown，再进入流程图材料区。</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;white-space:nowrap;">
              <span style="padding:4px 7px;border:1px solid var(--border-color);border-radius:999px;background:var(--bg-secondary);font-size:11px;color:var(--text-secondary);">Vism MASTER 兼容入口</span>
              <span style="padding:4px 7px;border:1px solid rgba(16,163,127,0.35);border-radius:999px;background:rgba(16,163,127,0.08);font-size:11px;color:var(--accent-color);">本地 SVG 渲染</span>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:minmax(260px,0.8fr) minmax(320px,0.9fr) minmax(420px,1.35fr);gap:10px;align-items:stretch;min-height:0;flex:1;">
            <section style="min-width:0;min-height:0;display:flex;flex-direction:column;border:1px solid var(--border-color);border-radius:9px;background:var(--bg-primary);overflow:hidden;">
              <div style="padding:10px 10px 8px;border-bottom:1px solid var(--border-color);">
                <div style="font-size:13px;font-weight:800;color:var(--text-primary);">材料来源</div>
                <div style="margin-top:2px;font-size:11px;color:var(--text-secondary);">勾选已有模块，或上传 PDF/Markdown/文本文件。</div>
              </div>
              <div style="padding:10px;overflow:auto;min-height:0;flex:1;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px;">${renderFlowchartMakerSourceOptions()}</div>
                <label style="display:block;font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:5px;">手动补充材料</label>
                <textarea id="flowchartMakerManualText" rows="4" oninput="handleFlowchartMakerSkillInput()" onkeydown="handleFlowchartMakerSkillKeydown(event)" placeholder="可粘贴研究流程、实验步骤、软件功能、论文结构、项目需求等；在开头输入 / 可调用用户 Skill。" style="width:100%;min-height:76px;resize:vertical;margin:0 0 6px;padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:12px;line-height:1.5;"></textarea>
                <div id="flowchartMakerSkillDropdown" style="display:none;margin:0 0 8px;border:1px solid var(--border-color);border-radius:8px;background:var(--modal-bg);box-shadow:0 8px 24px rgba(15,23,42,0.12);overflow:hidden;max-height:160px;overflow-y:auto;"></div>
                <input id="flowchartMakerFiles" type="file" multiple accept=".pdf,.md,.markdown,.txt,.csv,.tsv,.json" style="width:100%;margin:0 0 8px;padding:7px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">
                <label style="display:flex;align-items:center;gap:6px;margin:0 0 8px;font-size:12px;color:var(--text-secondary);cursor:pointer;">
                  <input id="flowchartMakerAutoGenerate" type="checkbox" checked style="width:14px;height:14px;margin:0;accent-color:var(--accent-color);"> 整理材料后自动生成流程图草稿
                </label>
                <button id="flowchartMakerLoadBtn" type="button" onclick="loadFlowchartMakerMaterials()" style="width:100%;height:32px;border:1px solid var(--accent-color);border-radius:7px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">整理材料</button>
                <div id="flowchartMakerMaterialsStatus" style="margin-top:8px;padding:8px;border:1px dashed var(--border-color);border-radius:7px;background:var(--bg-secondary);color:var(--text-secondary);font-size:11px;line-height:1.55;">尚未整理材料。PDF 上传后会使用 LiteParse 转为 Markdown。</div>
              </div>
            </section>

            <section style="min-width:0;min-height:0;display:flex;flex-direction:column;border:1px solid var(--border-color);border-radius:9px;background:var(--bg-primary);overflow:hidden;">
              <div style="padding:10px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <div>
                  <div style="font-size:13px;font-weight:800;">流程语法</div>
                  <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">支持 graph TD/LR 与 A[节点] --> B[节点]。</div>
                </div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                <select id="flowchartMakerType" title="AI生成图类型" style="width:104px;margin:0;padding:6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">
                  <option value="research-route">技术路线</option>
                  <option value="paper-logic">论文逻辑</option>
                  <option value="experiment-design">实验设计</option>
                  <option value="analysis-workflow">分析流程</option>
                  <option value="software-module">软件模块</option>
                </select>
                <select id="flowchartMakerDetail" title="AI生成复杂度" style="width:92px;margin:0;padding:6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">
                  <option value="standard">标准</option>
                  <option value="detailed" selected>详细</option>
                  <option value="compact">简洁</option>
                </select>
                <select id="flowchartMakerTemplate" onchange="applyFlowchartMakerTemplate()" style="width:120px;margin:0;padding:6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">
                  <option value="">模板</option>
                  <option value="paper">论文全流程</option>
                  <option value="meta">Meta 分析</option>
                  <option value="bibliometrics">文献计量</option>
                  <option value="software">软件模块</option>
                </select>
                </div>
              </div>
              <div style="padding:10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--border-color);">
                <button type="button" onclick="buildFlowchartFromMaterials()" style="height:28px;padding:0 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">从材料生成</button>
                <button id="flowchartMakerAiBtn" type="button" onclick="generateFlowchartWithAi()" style="height:28px;padding:0 10px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;">AI生成流程图</button>
                <button type="button" onclick="renderFlowchartMaker()" style="height:28px;padding:0 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">刷新预览</button>
                <button type="button" onclick="copyFlowchartMakerDsl()" style="height:28px;padding:0 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;">复制语法</button>
                <button type="button" onclick="downloadFlowchartMakerSvg()" style="height:28px;padding:0 9px;border:1px solid var(--accent-color);border-radius:6px;background:transparent;color:var(--accent-color);cursor:pointer;font-size:12px;">SVG</button>
                <button type="button" onclick="downloadFlowchartMakerPng()" style="height:28px;padding:0 9px;border:1px solid var(--accent-color);border-radius:6px;background:transparent;color:var(--accent-color);cursor:pointer;font-size:12px;">PNG</button>
              </div>
              <textarea id="flowchartMakerDsl" oninput="scheduleFlowchartMakerRender()" spellcheck="false" style="flex:1;min-height:0;width:100%;margin:0;padding:11px;border:0;background:var(--bg-input);color:var(--text-primary);font-family:Consolas,'Courier New',monospace;font-size:12px;line-height:1.55;resize:none;">${escapeHtml(savedDsl || getFlowchartMakerDefaultDsl())}</textarea>
            </section>

            <section style="min-width:0;min-height:0;display:flex;flex-direction:column;border:1px solid var(--border-color);border-radius:9px;background:var(--bg-primary);overflow:hidden;">
              <div style="padding:10px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <div>
                  <div style="font-size:13px;font-weight:800;">预览</div>
                  <div id="flowchartMakerPreviewMeta" style="font-size:11px;color:var(--text-secondary);margin-top:2px;">等待渲染。</div>
                </div>
                <div style="font-size:11px;color:var(--text-secondary);">导出为本地 SVG / PNG</div>
              </div>
              <div id="flowchartMakerPreview" style="flex:1;min-height:0;overflow:auto;background:#f8fafc;padding:14px;"></div>
            </section>
          </div>

          <textarea id="flowchartMakerMaterialsMarkdown" readonly style="display:none;"></textarea>
        </div>
      `;
      showModal('流程图制作', html, true, true);
      setTimeout(function() {
        renderFlowchartMaker();
      }, 60);
    }
    window.showFlowchartMakerDialog = showFlowchartMakerDialog;

    function getSelectedFlowchartMakerSources() {
      return Array.prototype.slice.call(document.querySelectorAll('input[name="flowchartMakerSource"]:checked'))
        .map(function(input) { return input.value; })
        .filter(Boolean);
    }

    async function loadFlowchartMakerMaterials() {
      var status = document.getElementById('flowchartMakerMaterialsStatus');
      var button = document.getElementById('flowchartMakerLoadBtn');
      var filesInput = document.getElementById('flowchartMakerFiles');
      var manualText = document.getElementById('flowchartMakerManualText')?.value || '';
      if (status) {
        status.style.borderColor = 'var(--warning-color)';
        status.textContent = '正在整理材料；PDF 文件会先调用 LiteParse 转成 Markdown...';
      }
      if (button) button.disabled = true;
      try {
        var formData = new FormData();
        formData.append('userId', currentUserId || 'web-user');
        formData.append('selectedSources', JSON.stringify(getSelectedFlowchartMakerSources()));
        formData.append('manualText', manualText);
        var files = filesInput && filesInput.files ? Array.prototype.slice.call(filesInput.files) : [];
        files.forEach(function(file) { formData.append('files', file); });
        var response = await fetch('/api/flowchart-maker/materials', { method: 'POST', body: formData });
        var payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || '整理材料失败');
        var data = payload.data || {};
        flowchartMakerMaterialsMarkdown = data.markdown || '';
        var hidden = document.getElementById('flowchartMakerMaterialsMarkdown');
        if (hidden) hidden.value = flowchartMakerMaterialsMarkdown;
        var materials = Array.isArray(data.materials) ? data.materials : [];
        var okCount = materials.filter(function(item) { return !item.error; }).length;
        var failItems = materials.filter(function(item) { return item.error; });
        if (status) {
          status.style.borderColor = failItems.length ? 'var(--warning-color)' : 'var(--accent-color)';
          status.innerHTML =
            '<div style="font-weight:700;color:var(--text-primary);margin-bottom:4px;">已整理 ' + okCount + ' 个材料来源' + (failItems.length ? '，' + failItems.length + ' 个失败' : '') + '</div>' +
            materials.map(function(item) {
              var color = item.error ? 'var(--danger-color)' : 'var(--text-secondary)';
              var detail = item.error ? item.error : (item.parser + ' · ' + (item.length || 0) + ' 字符');
              return '<div style="color:' + color + ';">' + escapeHtml(item.label || item.source || '材料') + '：' + escapeHtml(detail) + '</div>';
            }).join('');
        }
        if (document.getElementById('flowchartMakerAutoGenerate')?.checked) buildFlowchartFromMaterials();
      } catch (error) {
        if (status) {
          status.style.borderColor = 'var(--danger-color)';
          status.textContent = '整理材料失败：' + (error.message || error);
        }
      } finally {
        if (button) button.disabled = false;
      }
    }
    window.loadFlowchartMakerMaterials = loadFlowchartMakerMaterials;

    function buildFlowchartFromMaterials() {
      var editor = document.getElementById('flowchartMakerDsl');
      if (!editor) return;
      var markdown = flowchartMakerMaterialsMarkdown || document.getElementById('flowchartMakerMaterialsMarkdown')?.value || '';
      editor.value = generateFlowchartDslFromMaterials(markdown);
      scheduleFlowchartMakerRender();
    }
    window.buildFlowchartFromMaterials = buildFlowchartFromMaterials;

    async function generateFlowchartWithAi() {
      var editor = document.getElementById('flowchartMakerDsl');
      var button = document.getElementById('flowchartMakerAiBtn');
      var status = document.getElementById('flowchartMakerMaterialsStatus');
      var meta = document.getElementById('flowchartMakerPreviewMeta');
      if (!editor) return;
      var markdown = flowchartMakerMaterialsMarkdown || document.getElementById('flowchartMakerMaterialsMarkdown')?.value || '';
      if (!String(markdown || '').trim()) {
        if (status) {
          status.style.borderColor = 'var(--warning-color)';
          status.textContent = '正在先整理材料，然后交给 AI 规划流程图...';
        }
        await loadFlowchartMakerMaterials();
        markdown = flowchartMakerMaterialsMarkdown || document.getElementById('flowchartMakerMaterialsMarkdown')?.value || '';
        if (!String(markdown || '').trim()) {
          if (status) {
            status.style.borderColor = 'var(--danger-color)';
            status.textContent = '没有可用于 AI 规划的材料。请勾选项目来源、上传文件或输入说明。';
          }
          return;
        }
      }
      var previousText = button ? button.textContent : '';
      if (button) {
        button.disabled = true;
        button.textContent = 'AI分析中...';
      }
      if (meta) meta.textContent = 'AI 正在阅读材料并规划流程图...';
      try {
        var response = await fetch('/api/flowchart-maker/ai-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId || 'web-user',
            markdown: markdown,
            currentDsl: editor.value || '',
            instruction: document.getElementById('flowchartMakerManualText')?.value || '',
            flowchartType: document.getElementById('flowchartMakerType')?.value || 'research-route',
            detailLevel: document.getElementById('flowchartMakerDetail')?.value || 'detailed'
          })
        });
        var payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || 'AI 生成流程图失败');
        var dsl = payload.data && payload.data.dsl ? payload.data.dsl : '';
        if (!dsl.trim()) throw new Error('AI 返回为空');
        editor.value = dsl;
        scheduleFlowchartMakerRender();
        if (status) {
          status.style.borderColor = 'var(--accent-color)';
          status.innerHTML = '<div style="font-weight:700;color:var(--accent-color);">AI 已基于整理材料生成流程图。</div>';
        }
      } catch (error) {
        if (status) {
          status.style.borderColor = 'var(--danger-color)';
          status.textContent = 'AI 生成失败：' + (error.message || error);
        }
        if (meta) meta.textContent = 'AI 生成失败，可先使用本地规则生成。';
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = previousText || 'AI生成流程图';
        }
      }
    }
    window.generateFlowchartWithAi = generateFlowchartWithAi;

    function generateFlowchartDslFromMaterials(markdown) {
      var text = String(markdown || '').trim();
      if (!text) return getFlowchartMakerDefaultDsl();
      var normalizeLabel = function(value) {
        var label = String(value || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/[`*_#>|{}[\]();]/g, ' ')
          .replace(/\\[nrt]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        label = label.replace(/^["'“”‘’：:,\-.\d\s]+/, '').replace(/["'“”‘’：:,\-.\s]+$/, '').trim();
        if (label.length > 34) label = label.slice(0, 34).replace(/[，,、；;:：]\S*$/, '') + '...';
        return label;
      };
      var isNoiseLabel = function(label) {
        if (!label || label.length < 3) return true;
        var lower = label.toLowerCase();
        return [
          'flowchart', 'markdown', 'json', 'undefined', 'null', 'true', 'false',
          '用户调用的流程图 skill', '用户手动输入材料', '全局 overview',
          '输出可编辑流程图', '整合输入材料', '对齐用户研究背景',
          '归纳关键模块与先后关系'
        ].some(function(token) { return lower === token || lower.indexOf(token) === 0; });
      };
      var categorizeLabel = function(label) {
        var lower = String(label || '').toLowerCase();
        if (/(研究问题|科学问题|目标|假设|目的|背景|knowledge gap|question|objective|aim|hypothesis|purpose|background)/i.test(label)) return 'problem';
        if (/(材料|数据|样本|文献|pdf|图|表|figure|fig\.|table|dataset|source|sample|record|database|资料|证据)/i.test(label)) return 'data';
        if (/(方法|实验|处理|设计|测定|采样|模型|算法|提取|解析|识别|method|experiment|treatment|design|measurement|sampling|model|extraction|parse)/i.test(label)) return 'method';
        if (/(分析|统计|回归|相关|效应量|异质性|亚组|敏感性|r语言|作图|analysis|statistics|regression|correlation|effect size|heterogeneity|subgroup|sensitivity)/i.test(label)) return 'analysis';
        if (/(结果|发现|结论|显著|增加|降低|减少|提高|影响|机制|result|finding|conclusion|significant|increase|decrease|reduce|improve|effect|mechanism)/i.test(label)) return 'result';
        if (/(论文|草稿|写作|报告|输出|导出|图件|投稿|draft|paper|writing|report|output|export|manuscript|figure)/i.test(label)) return 'output';
        return 'other';
      };
      var pushCandidate = function(list, raw, weight, index) {
        var label = normalizeLabel(raw);
        if (isNoiseLabel(label)) return;
        list.push({ label: label, weight: weight, index: index, category: categorizeLabel(label) });
      };
      var candidates = [];
      var lines = text.split(/\r?\n/).map(function(line) { return line.trim(); }).filter(Boolean);
      lines.slice(0, 900).forEach(function(line, index) {
        var match = line.match(/^#{1,4}\s+(.{3,160})$/);
        if (match) {
          pushCandidate(candidates, match[1], 12, index);
          return;
        }
        match = line.match(/^(?:[-*+]\s+|\d+[.)、]\s+)(.{6,180})$/);
        if (match) {
          pushCandidate(candidates, match[1], 9, index);
          return;
        }
        match = line.match(/^["']?(?:title|name|label|caption|summary|objective|method|result|finding|conclusion|stage|step|question|topic|核心问题|研究问题|研究目标|方法|结果|发现|结论|图题|表题)["']?\s*[:：=]\s*["']?(.{6,200})["']?,?$/i);
        if (match) {
          pushCandidate(candidates, match[1], 10, index);
          return;
        }
        match = line.match(/^(?:Figure|Fig\.?|Table|图|表)\s*[0-9A-Za-z一二三四五六七八九十.-]*\s*[:：.\-]?\s*(.{6,180})$/i);
        if (match) {
          pushCandidate(candidates, match[0], 11, index);
          return;
        }
        if (/(研究|实验|处理|施用|降低|增加|促进|抑制|影响|机制|模型|分析|结果|结论|流程|模块|数据|图|表)/.test(line) && line.length >= 12 && line.length <= 180) {
          pushCandidate(candidates, line, 5, index);
          return;
        }
        var sentenceMatch = line.match(/^(.{12,120}?[。.!?？])\s*$/);
        if (sentenceMatch && /(shows?|found|indicat|suggest|increase|decrease|reduce|improve|significant|研究|表明|发现|显著|增加|降低|减少|提高|影响)/i.test(sentenceMatch[1])) {
          pushCandidate(candidates, sentenceMatch[1], 4, index);
        }
      });
      var uniqueMap = {};
      candidates.forEach(function(item) {
        var key = item.label.toLowerCase().replace(/\s+/g, '');
        if (!uniqueMap[key] || item.weight > uniqueMap[key].weight) uniqueMap[key] = item;
      });
      var orderedItems = Object.keys(uniqueMap)
        .map(function(key) { return uniqueMap[key]; })
        .sort(function(a, b) {
          if (b.weight !== a.weight) return b.weight - a.weight;
          return a.index - b.index;
        })
        .slice(0, 18)
        .sort(function(a, b) { return a.index - b.index; });
      var ordered = orderedItems.map(function(item) { return item.label; });
      var steps = ordered.length >= 3 ? ordered : [];
      if (steps.length < 3) {
        var sectionTitles = [];
        (text.match(/^#\s+(.+)$/gm) || []).forEach(function(title) {
          pushCandidate(sectionTitles, title.replace(/^#\s+/, ''), 1, sectionTitles.length);
        });
        steps = sectionTitles.map(function(item) { return item.label; }).slice(0, 6);
      }
      if (steps.length < 3) return getFlowchartMakerDefaultDsl();
      var usedLabels = {};
      var pick = function(category, count) {
        var selected = [];
        orderedItems.forEach(function(item) {
          if (selected.length >= count) return;
          if (item.category === category && !usedLabels[item.label]) {
            usedLabels[item.label] = true;
            selected.push(item.label);
          }
        });
        return selected;
      };
      var fallbackPick = function(count) {
        var selected = [];
        orderedItems.forEach(function(item) {
          if (selected.length >= count) return;
          if (!usedLabels[item.label]) {
            usedLabels[item.label] = true;
            selected.push(item.label);
          }
        });
        return selected;
      };
      var problem = pick('problem', 1)[0] || fallbackPick(1)[0] || '明确研究目标';
      var data = pick('data', 3);
      var methods = pick('method', 3);
      var analyses = pick('analysis', 3);
      var results = pick('result', 3);
      var outputs = pick('output', 2);
      var ensureItems = function(list, minCount, defaults) {
        var next = list.slice();
        var guard = 0;
        while (next.length < minCount && guard < 12) {
          guard += 1;
          var more = fallbackPick(1);
          if (more.length) next = next.concat(more);
          else next.push(defaults[next.length] || defaults[defaults.length - 1] || '后续步骤');
        }
        return next;
      };
      data = ensureItems(data, 2, ['整理材料来源', '提取关键证据']);
      methods = ensureItems(methods, 2, ['构建方法路径', '执行数据处理']);
      analyses = ensureItems(analyses, 1, ['统计分析与结果整合']);
      results = ensureItems(results, 2, ['提炼关键结果', '解释结果机制']);
      outputs = ensureItems(outputs, 1, ['形成论文与图表输出']);
      var nodeText = function(id, label, shape) {
        var safe = normalizeLabel(label || id) || id;
        if (shape === 'decision') return id + '{' + safe + '}';
        if (shape === 'round') return id + '(' + safe + ')';
        return id + '[' + safe + ']';
      };
      var dslLines = ['graph TD'];
      dslLines.push(nodeText('P', problem, 'round') + ' --> ' + nodeText('D1', data[0] || '材料来源一'));
      if (data[1]) dslLines.push(nodeText('P', problem, 'round') + ' --> ' + nodeText('D2', data[1]));
      if (data[2]) dslLines.push(nodeText('P', problem, 'round') + ' --> ' + nodeText('D3', data[2]));
      dslLines.push('D1 --> ' + nodeText('M1', methods[0] || '方法路径一'));
      if (methods[1]) dslLines.push((data[1] ? 'D2' : 'D1') + ' --> ' + nodeText('M2', methods[1]));
      if (methods[2]) dslLines.push((data[2] ? 'D3' : 'D1') + ' --> ' + nodeText('M3', methods[2]));
      dslLines.push('M1 --> ' + nodeText('A1', analyses[0] || '核心分析'));
      if (methods[1]) dslLines.push('M2 --> A1');
      if (analyses[1]) dslLines.push('A1 --> ' + nodeText('Q', '是否需要补充分析', 'decision'));
      if (analyses[1]) dslLines.push('Q -->|是| ' + nodeText('A2', analyses[1]));
      if (analyses[2]) dslLines.push('A2 --> ' + nodeText('A3', analyses[2]));
      var resultStart = analyses[2] ? 'A3' : (analyses[1] ? 'A2' : 'A1');
      if (analyses[1]) dslLines.push('Q -->|否| ' + nodeText('R1', results[0] || '关键结果'));
      dslLines.push(resultStart + ' --> ' + (analyses[1] ? 'R1' : nodeText('R1', results[0] || '关键结果')));
      if (results[1]) dslLines.push('A1 --> ' + nodeText('R2', results[1]));
      if (results[2]) dslLines.push('A1 --> ' + nodeText('R3', results[2]));
      dslLines.push('R1 --> ' + nodeText('O1', outputs[0] || '形成论文输出', 'round'));
      if (results[1]) dslLines.push('R2 --> O1');
      if (outputs[1]) dslLines.push('O1 --> ' + nodeText('O2', outputs[1], 'round'));
      return dslLines.join('\n');
    }

    function applyFlowchartMakerTemplate() {
      var select = document.getElementById('flowchartMakerTemplate');
      var editor = document.getElementById('flowchartMakerDsl');
      if (!select || !editor || !select.value) return;
      var templates = {
        paper: ['graph TD', 'P(研究问题) --> L[文献证据]', 'P --> D[实验/数据证据]', 'L --> G[知识缺口]', 'D --> M[方法与统计分析]', 'G --> Q{逻辑链是否完整}', 'M --> Q', 'Q -->|否| S[补充检索或分析]', 'S --> Q', 'Q -->|是| W[章节写作]', 'W --> C[引用核查与质量控制]', 'C --> O(投稿稿件)'].join('\n'),
        meta: ['graph LR', 'A(研究问题与PICO/PECO) --> B[检索式与数据库]', 'B --> C{纳排筛选}', 'C -->|纳入| D[数据提取]', 'C -->|排除| X[记录排除原因]', 'D --> E[效应量计算]', 'E --> F[合并效应值]', 'F --> G[异质性评估]', 'G --> H[亚组/敏感性分析]', 'H --> I(森林图与结论)'].join('\n'),
        bibliometrics: ['graph TD', 'A[WoS Plain Text] --> B[字段解析与去重]', 'B --> C[年度趋势]', 'B --> D[关键词共现]', 'B --> E[作者/机构合作网络]', 'B --> F[共被引与文献耦合]', 'C --> G{主题是否清晰}', 'D --> G', 'E --> G', 'F --> G', 'G -->|否| H[合并关键词与重算]', 'H --> G', 'G -->|是| I(文献计量论文框架)'].join('\n'),
        software: ['graph LR', 'A(用户输入/文件) --> B[材料解析]', 'B --> C{任务类型识别}', 'C -->|文本| D[小牛马文本处理]', 'C -->|图片/表格| E[视觉/OCR/数据分析]', 'D --> F[结构化结果]', 'E --> F', 'F --> G[可视化与导出]', 'F --> H[写作上下文调用]', 'G --> O(项目输出)', 'H --> O'].join('\n')
      };
      editor.value = templates[select.value] || getFlowchartMakerDefaultDsl();
      select.value = '';
      scheduleFlowchartMakerRender();
    }
    window.applyFlowchartMakerTemplate = applyFlowchartMakerTemplate;

    function scheduleFlowchartMakerRender() {
      if (flowchartMakerRenderTimer) clearTimeout(flowchartMakerRenderTimer);
      flowchartMakerRenderTimer = setTimeout(renderFlowchartMaker, 90);
    }
    window.scheduleFlowchartMakerRender = scheduleFlowchartMakerRender;

    function parseFlowchartNodeToken(token, nodes) {
      var raw = String(token || '').trim().replace(/;$/, '').replace(/^\|[^|]*\|\s*/, '');
      var match = raw.match(/^([A-Za-z0-9_]+)\s*(?:\[([^\]]+)\]|\(([^\)]+)\)|\{([^}]+)\})?/);
      if (!match) return null;
      var id = match[1];
      var label = match[2] || match[3] || match[4] || id;
      var shape = match[4] ? 'decision' : (match[3] ? 'round' : 'rect');
      if (!nodes[id]) nodes[id] = { id: id, label: label, shape: shape };
      else if (label && nodes[id].label === id) nodes[id].label = label;
      if (shape === 'decision') nodes[id].shape = 'decision';
      return nodes[id];
    }

    function parseFlowchartMakerDsl(dsl) {
      var nodes = {};
      var edges = [];
      var direction = 'TD';
      String(dsl || '').split(/\r?\n/).forEach(function(line) {
        var trimmed = line.trim();
        if (!trimmed || trimmed.indexOf('%%') === 0 || trimmed.indexOf('#') === 0) return;
        var graphMatch = trimmed.match(/^graph\s+(TD|TB|BT|LR|RL)/i);
        if (graphMatch) {
          direction = graphMatch[1].toUpperCase();
          return;
        }
        var edgeMatch = trimmed.match(/^(.+?)\s*(?:-->|->)\s*(.+)$/);
        if (edgeMatch) {
          var from = parseFlowchartNodeToken(edgeMatch[1], nodes);
          var toToken = edgeMatch[2];
          var label = '';
          var labelMatch = String(toToken || '').match(/^\|([^|]{1,40})\|\s*(.+)$/);
          if (labelMatch) {
            label = labelMatch[1].trim();
            toToken = labelMatch[2];
          }
          var to = parseFlowchartNodeToken(toToken, nodes);
          if (from && to) edges.push({ from: from.id, to: to.id, label: label });
          return;
        }
        if (/^(subgraph|end|classDef|class\s+)/i.test(trimmed)) return;
        parseFlowchartNodeToken(trimmed, nodes);
      });
      return { direction: direction, nodes: Object.keys(nodes).map(function(id) { return nodes[id]; }), edges: edges };
    }

    function wrapFlowchartLabel(label, maxChars, maxLines) {
      var text = String(label || '').replace(/\s+/g, ' ').trim();
      if (!text) return [''];
      var lines = [];
      if (text.indexOf(' ') >= 0) {
        var current = '';
        text.split(' ').forEach(function(word) {
          var next = current ? current + ' ' + word : word;
          if (next.length > maxChars && current) {
            lines.push(current);
            current = word;
          } else {
            current = next;
          }
        });
        if (current) lines.push(current);
      } else {
        for (var i = 0; i < text.length; i += maxChars) lines.push(text.slice(i, i + maxChars));
      }
      if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        lines[maxLines - 1] = lines[maxLines - 1].replace(/.{1,2}$/, '') + '...';
      }
      return lines;
    }

    function layoutFlowchartMaker(parsed) {
      var nodes = parsed.nodes.slice();
      var byId = {};
      nodes.forEach(function(node) { byId[node.id] = node; });
      var indegree = {};
      var adjacency = {};
      nodes.forEach(function(node) { indegree[node.id] = 0; adjacency[node.id] = []; });
      parsed.edges.forEach(function(edge) {
        if (!byId[edge.from] || !byId[edge.to]) return;
        adjacency[edge.from].push(edge.to);
        indegree[edge.to] += 1;
      });
      var level = {};
      var queue = nodes.filter(function(node) { return indegree[node.id] === 0; }).map(function(node) { return node.id; });
      nodes.forEach(function(node) { level[node.id] = 0; });
      if (!queue.length && nodes.length) queue.push(nodes[0].id);
      var guard = 0;
      while (queue.length && guard < 1000) {
        guard += 1;
        var id = queue.shift();
        (adjacency[id] || []).forEach(function(next) {
          level[next] = Math.max(level[next] || 0, (level[id] || 0) + 1);
          indegree[next] -= 1;
          if (indegree[next] <= 0) queue.push(next);
        });
      }
      nodes.forEach(function(node, index) {
        if (!Number.isFinite(level[node.id])) level[node.id] = index;
      });
      var groups = {};
      nodes.forEach(function(node) {
        var key = String(level[node.id] || 0);
        if (!groups[key]) groups[key] = [];
        groups[key].push(node);
      });
      var horizontal = parsed.direction === 'LR' || parsed.direction === 'RL';
      var nodeW = 176;
      var nodeH = 58;
      var gapX = horizontal ? 92 : 48;
      var gapY = horizontal ? 34 : 72;
      var margin = 42;
      Object.keys(groups).sort(function(a, b) { return Number(a) - Number(b); }).forEach(function(key) {
        groups[key].forEach(function(node, index) {
          if (horizontal) {
            node.x = margin + Number(key) * (nodeW + gapX);
            node.y = margin + index * (nodeH + gapY);
          } else {
            node.x = margin + index * (nodeW + gapX);
            node.y = margin + Number(key) * (nodeH + gapY);
          }
          node.w = nodeW;
          node.h = nodeH;
        });
      });
      var width = Math.max(680, nodes.reduce(function(max, node) { return Math.max(max, (node.x || 0) + nodeW + margin); }, 0));
      var height = Math.max(420, nodes.reduce(function(max, node) { return Math.max(max, (node.y || 0) + nodeH + margin); }, 0));
      return { nodes: nodes, edges: parsed.edges, byId: byId, width: width, height: height, horizontal: horizontal };
    }

    function renderFlowchartText(label, cx, cy) {
      var lines = wrapFlowchartLabel(label, 12, 3);
      var startDy = lines.length === 1 ? 4 : (lines.length === 2 ? -4 : -12);
      return '<text x="' + cx + '" y="' + cy + '" text-anchor="middle" dominant-baseline="middle" style="font-size:13px;font-weight:700;fill:#1f2937;">' +
        lines.map(function(line, index) {
          return '<tspan x="' + cx + '" dy="' + (index === 0 ? startDy : 17) + '">' + escapeHtml(line) + '</tspan>';
        }).join('') +
        '</text>';
    }

    function buildFlowchartMakerSvg(parsed) {
      var layout = layoutFlowchartMaker(parsed);
      var svg = [];
      svg.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + layout.width + ' ' + layout.height + '" width="100%" height="100%" style="min-width:' + layout.width + 'px;min-height:' + layout.height + 'px;background:#f8fafc;">');
      svg.push('<defs><marker id="flowchartArrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#0f766e"/></marker><filter id="flowchartShadow" x="-15%" y="-20%" width="130%" height="145%"><feDropShadow dx="0" dy="5" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.10"/></filter></defs>');
      svg.push('<rect x="0" y="0" width="' + layout.width + '" height="' + layout.height + '" fill="#f8fafc"/>');
      layout.edges.forEach(function(edge) {
        var from = layout.byId[edge.from];
        var to = layout.byId[edge.to];
        if (!from || !to) return;
        var sx = layout.horizontal ? from.x + from.w : from.x + from.w / 2;
        var sy = layout.horizontal ? from.y + from.h / 2 : from.y + from.h;
        var tx = layout.horizontal ? to.x : to.x + to.w / 2;
        var ty = layout.horizontal ? to.y + to.h / 2 : to.y;
        var pathD = layout.horizontal
          ? 'M' + sx + ' ' + sy + ' C' + (sx + 42) + ' ' + sy + ' ' + (tx - 42) + ' ' + ty + ' ' + tx + ' ' + ty
          : 'M' + sx + ' ' + sy + ' C' + sx + ' ' + (sy + 38) + ' ' + tx + ' ' + (ty - 38) + ' ' + tx + ' ' + ty;
        svg.push('<path d="' + pathD + '" fill="none" stroke="#0f766e" stroke-width="2.2" marker-end="url(#flowchartArrow)" opacity="0.92"/>');
        if (edge.label) {
          var lx = layout.horizontal ? (sx + tx) / 2 : (sx + tx) / 2 + 18;
          var ly = layout.horizontal ? (sy + ty) / 2 - 10 : (sy + ty) / 2;
          var labelText = String(edge.label || '').slice(0, 12);
          var labelW = Math.max(32, labelText.length * 13 + 16);
          svg.push('<rect x="' + (lx - labelW / 2) + '" y="' + (ly - 13) + '" width="' + labelW + '" height="22" rx="11" fill="#ecfeff" stroke="#99f6e4" stroke-width="1"/>');
          svg.push('<text x="' + lx + '" y="' + ly + '" text-anchor="middle" dominant-baseline="middle" style="font-size:12px;font-weight:700;fill:#0f766e;">' + escapeHtml(labelText) + '</text>');
        }
      });
      layout.nodes.forEach(function(node, index) {
        var fill = index === 0 ? '#ecfdf5' : '#ffffff';
        var stroke = index === 0 ? '#0f766e' : '#cbd5e1';
        if (node.shape === 'decision') {
          var cx = node.x + node.w / 2;
          var cy = node.y + node.h / 2;
          svg.push('<polygon points="' + cx + ',' + node.y + ' ' + (node.x + node.w) + ',' + cy + ' ' + cx + ',' + (node.y + node.h) + ' ' + node.x + ',' + cy + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5" filter="url(#flowchartShadow)"/>');
          svg.push(renderFlowchartText(node.label, cx, cy));
        } else {
          svg.push('<rect x="' + node.x + '" y="' + node.y + '" width="' + node.w + '" height="' + node.h + '" rx="' + (node.shape === 'round' ? 18 : 8) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5" filter="url(#flowchartShadow)"/>');
          svg.push(renderFlowchartText(node.label, node.x + node.w / 2, node.y + node.h / 2));
        }
      });
      svg.push('</svg>');
      return svg.join('');
    }

    function renderFlowchartMaker() {
      var editor = document.getElementById('flowchartMakerDsl');
      var preview = document.getElementById('flowchartMakerPreview');
      var meta = document.getElementById('flowchartMakerPreviewMeta');
      if (!editor || !preview) return;
      var dsl = editor.value || '';
      try {
        localStorage.setItem(FLOWCHART_MAKER_STORAGE_KEY, dsl);
      } catch (_) {}
      var parsed = parseFlowchartMakerDsl(dsl);
      if (!parsed.nodes.length) {
        preview.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:13px;">没有可渲染节点。</div>';
        if (meta) meta.textContent = '0 个节点。';
        return;
      }
      preview.innerHTML = buildFlowchartMakerSvg(parsed);
      if (meta) meta.textContent = parsed.nodes.length + ' 个节点 · ' + parsed.edges.length + ' 条连接 · ' + parsed.direction;
    }
    window.renderFlowchartMaker = renderFlowchartMaker;

    function getFlowchartMakerSvgText() {
      var svg = document.querySelector('#flowchartMakerPreview svg');
      if (!svg) return '';
      return new XMLSerializer().serializeToString(svg);
    }

    function downloadFlowchartMakerSvg() {
      var svgText = getFlowchartMakerSvgText();
      if (!svgText) return;
      var blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'scholar-harness-flowchart.svg';
      link.click();
      URL.revokeObjectURL(link.href);
    }
    window.downloadFlowchartMakerSvg = downloadFlowchartMakerSvg;

    function downloadFlowchartMakerPng() {
      var svgText = getFlowchartMakerSvgText();
      if (!svgText) return;
      var blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var image = new Image();
      image.onload = function() {
        var viewBox = (document.querySelector('#flowchartMakerPreview svg')?.getAttribute('viewBox') || '0 0 1200 800').split(/\s+/).map(Number);
        var width = Math.max(800, viewBox[2] || 1200);
        var height = Math.max(500, viewBox[3] || 800);
        var canvas = document.createElement('canvas');
        canvas.width = width * 2;
        canvas.height = height * 2;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function(pngBlob) {
          if (!pngBlob) return;
          var link = document.createElement('a');
          link.href = URL.createObjectURL(pngBlob);
          link.download = 'scholar-harness-flowchart.png';
          link.click();
          URL.revokeObjectURL(link.href);
        }, 'image/png');
      };
      image.onerror = function() {
        URL.revokeObjectURL(url);
      };
      image.src = url;
    }
    window.downloadFlowchartMakerPng = downloadFlowchartMakerPng;

    async function copyFlowchartMakerDsl() {
      var editor = document.getElementById('flowchartMakerDsl');
      var text = editor ? editor.value : '';
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        if (editor) {
          editor.focus();
          editor.select();
          document.execCommand('copy');
        }
      }
    }
    window.copyFlowchartMakerDsl = copyFlowchartMakerDsl;

    // ============ PPT Master 汇报生成 ============
    var pptMasterTemplates = [];
    var pptMasterLastProjectPath = '';
    var pptMasterCurrentJobId = '';
    var pptMasterSeenLogCount = 0;
    var pptMasterPollTimer = null;
    var pptMasterTypingTimer = null;
    var pptMasterTypingQueue = [];
    var pptMasterTypingBusy = false;
    var pptMasterSkillStartPos = -1;
    var pptMasterSkillActiveIndex = 0;
    var pptMasterSkillCandidates = [];

    function renderPptMasterContextSourceOptions() {
      return FLOWCHART_MAKER_SOURCES.map(function(source) {
        return '' +
          '<label style="display:flex;align-items:center;gap:6px;padding:7px 8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-secondary);font-size:12px;color:var(--text-primary);cursor:pointer;">' +
            '<input type="checkbox" name="pptMasterContextSource" value="' + escapeHtml(source.id) + '"' + (source.checked ? ' checked' : '') + ' style="width:14px;height:14px;margin:0;accent-color:var(--accent-color);">' +
            '<span>' + escapeHtml(source.label) + '</span>' +
          '</label>';
      }).join('');
    }

    function getSelectedPptMasterContextSources() {
      return Array.prototype.slice.call(document.querySelectorAll('input[name="pptMasterContextSource"]:checked'))
        .map(function(input) { return input.value; })
        .filter(Boolean);
    }

    function setPptMasterContextSources(checked) {
      Array.prototype.slice.call(document.querySelectorAll('input[name="pptMasterContextSource"]')).forEach(function(input) {
        input.checked = !!checked;
      });
    }
    window.setPptMasterContextSources = setPptMasterContextSources;

    async function fetchPptMasterProjectContextMarkdown(selectedSources) {
      if (!selectedSources || !selectedSources.length) return { markdown: '', materials: [] };
      var formData = new FormData();
      formData.append('userId', currentUserId || 'web-user');
      formData.append('selectedSources', JSON.stringify(selectedSources));
      formData.append('manualText', '');
      var response = await fetch('/api/flowchart-maker/materials', { method: 'POST', body: formData });
      var payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || '项目资料整理失败');
      return payload.data || {};
    }

    function showPptMasterDialog() {
      var html = `
        <div id="pptMasterStatus" style="margin-bottom:10px;padding:8px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-tip-bg);color:var(--text-secondary);font-size:11px;line-height:1.55;">
          正在检测本地 ppt-master 工具链...
        </div>

        <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;">
          <div>
            <div style="font-size:11px;color:var(--accent-color);font-weight:700;margin-bottom:8px;">材料</div>
            <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px;">论文草稿、PDF、文献综述或其他源文件</label>
            <input type="file" id="pptMasterSources" multiple onchange="renderPptMasterFiles()" accept=".md,.markdown,.txt,.csv,.tsv,.pdf,.docx,.doc,.odt,.rtf,.pptx,.pptm,.ppsx,.ppsm,.potx,.potm,.xlsx,.xlsm,.xls,.epub,.html,.htm,.tex,.latex,.rst,.org,.ipynb,.typ,.png,.jpg,.jpeg,.gif,.webp,.bmp,.tiff,.tif,.emf,.wmf,.svg" style="width:100%;padding:6px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);border-radius:4px;color:var(--text-primary);font-size:12px;">
            <div id="pptMasterFiles" style="margin-top:7px;color:var(--text-secondary);font-size:11px;line-height:1.5;"></div>

            <div style="font-size:11px;color:var(--accent-color);font-weight:700;margin:14px 0 8px;">项目资料调用</div>
            <div style="margin-bottom:6px;font-size:11px;color:var(--text-secondary);line-height:1.5;">与流程图制作的材料来源一致，可单选或多选；生成前会整理成 Markdown 材料加入 PPT 项目。</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">${renderPptMasterContextSourceOptions()}</div>
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
              <button type="button" onclick="setPptMasterContextSources(true)" style="height:26px;padding:0 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:11px;">全选</button>
              <button type="button" onclick="setPptMasterContextSources(false)" style="height:26px;padding:0 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:11px;">清空</button>
            </div>

            <div style="font-size:11px;color:var(--accent-color);font-weight:700;margin:14px 0 8px;">用户模板</div>
            <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px;">上传 PPTX 模板（保留母版、版式和继承关系）</label>
            <input type="file" id="pptMasterTemplatePptx" accept=".pptx" onchange="renderPptMasterFiles()" style="width:100%;padding:6px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);border-radius:4px;color:var(--text-primary);font-size:12px;">
            <div style="margin-top:7px;color:var(--text-secondary);font-size:11px;line-height:1.5;">上传后会调用 <code>pptx_template_import.py --inheritance-mode both</code>，生成 manifest、layered SVG、flat SVG 和 inheritance graph。</div>
          </div>

          <div>
            <div style="font-size:11px;color:var(--accent-color);font-weight:700;margin-bottom:8px;">项目</div>
            <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px;">项目名称</label>
            <input type="text" id="pptMasterProjectName" placeholder="例如：论文开题汇报" style="width:100%;padding:7px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);border-radius:4px;color:var(--text-primary);font-size:12px;">

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
              <div>
                <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px;">画布</label>
                <select id="pptMasterFormat" style="width:100%;padding:7px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);border-radius:4px;color:var(--text-primary);font-size:12px;">
                  <option value="ppt169">16:9 汇报</option>
                  <option value="ppt43">4:3 汇报</option>
                  <option value="xhs">小红书竖版</option>
                  <option value="story">Story 竖版</option>
                </select>
              </div>
              <div>
                <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px;">页数</label>
                <input type="text" id="pptMasterPageCount" placeholder="例如：12-18页" style="width:100%;padding:7px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);border-radius:4px;color:var(--text-primary);font-size:12px;">
              </div>
            </div>

            <label style="font-size:12px;color:var(--text-secondary);display:block;margin:10px 0 4px;">内置模板</label>
            <select id="pptMasterBuiltInTemplate" style="width:100%;padding:7px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);border-radius:4px;color:var(--text-primary);font-size:12px;">
              <option value="">不使用内置模板</option>
            </select>

            <label style="font-size:12px;color:var(--text-secondary);display:block;margin:10px 0 4px;">听众</label>
            <input type="text" id="pptMasterAudience" placeholder="例如：课题组、答辩专家、投资人" style="width:100%;padding:7px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);border-radius:4px;color:var(--text-primary);font-size:12px;">

            <label style="font-size:12px;color:var(--text-secondary);display:block;margin:10px 0 4px;">风格要求</label>
            <input type="text" id="pptMasterStyle" placeholder="例如：学术答辩、简洁高级、中文汇报" style="width:100%;padding:7px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);border-radius:4px;color:var(--text-primary);font-size:12px;">
          </div>
        </div>

        <div style="margin-top:12px;">
          <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px;">具体要求</label>
          <textarea id="pptMasterRequirements" oninput="handlePptMasterSkillInput()" onkeydown="handlePptMasterSkillKeydown(event)" placeholder="例如：突出研究背景、方法流程、关键结果和创新点；调用 Skill 时请在开头输入 /。" style="width:100%;height:92px;padding:8px;background:var(--modal-input-bg);border:1px solid var(--modal-input-border);border-radius:4px;color:var(--text-primary);resize:vertical;font-size:12px;"></textarea>
          <div id="pptMasterSkillDropdown" style="display:none;margin-top:6px;border:1px solid var(--border-color);border-radius:8px;background:var(--modal-bg);box-shadow:0 8px 24px rgba(15,23,42,0.12);overflow:hidden;max-height:180px;overflow-y:auto;"></div>
          <div style="margin-top:6px;color:var(--text-secondary);font-size:11px;line-height:1.5;">仅当要求以 <code>/你的Skill命令</code> 开头时才调用用户 Skill，后端会把对应规则注入 PPT 规划和逐页生成。</div>
        </div>

        <div id="pptMasterResult" style="display:none;margin-top:12px;padding:10px;border-radius:6px;background:var(--modal-tip-bg);border:1px solid var(--border-color);color:var(--text-secondary);font-size:12px;line-height:1.55;"></div>

        <div class="btns" style="margin-top:12px;">
          <button class="cancel" onclick="closeModal()">取消</button>
          <button class="ok" id="pptMasterCreateBtn" onclick="createPptMasterProject()">生成 PPT</button>
        </div>
      `;

      showModal('PPT 汇报生成', html, true);
      setTimeout(function() {
        refreshPptMasterStatus();
        loadPptMasterTemplates();
        renderPptMasterFiles();
      }, 80);
    }
    window.showPptMasterDialog = showPptMasterDialog;

    function normalizePptMasterSkillQuery(value) {
      return String(value || '').toLowerCase().replace(/^\/+/, '').trim();
    }

    function getPptMasterRequirementsInput() {
      return document.getElementById('pptMasterRequirements');
    }

    function getPptMasterSkillDropdown() {
      return document.getElementById('pptMasterSkillDropdown');
    }

    function hidePptMasterSkillDropdown() {
      var dropdown = getPptMasterSkillDropdown();
      if (dropdown) dropdown.style.display = 'none';
      pptMasterSkillStartPos = -1;
      pptMasterSkillActiveIndex = 0;
      pptMasterSkillCandidates = [];
    }
    window.hidePptMasterSkillDropdown = hidePptMasterSkillDropdown;

    function renderPptMasterSkillDropdown(skills, query) {
      var dropdown = getPptMasterSkillDropdown();
      if (!dropdown) return;
      var normalizedQuery = normalizePptMasterSkillQuery(query);
      var enabledSkills = (Array.isArray(skills) ? skills : []).filter(function(skill) {
        if (!skill || skill.enabled === false || !skill.trigger) return false;
        var haystack = normalizePptMasterSkillQuery([
          skill.trigger,
          skill.name,
          skill.description
        ].join(' '));
        return !normalizedQuery || haystack.includes(normalizedQuery);
      });
      pptMasterSkillCandidates = enabledSkills;
      pptMasterSkillActiveIndex = enabledSkills.length ? Math.min(pptMasterSkillActiveIndex, enabledSkills.length - 1) : 0;
      if (!enabledSkills.length) {
        dropdown.style.display = 'block';
        dropdown.innerHTML = '<div style="padding:9px 10px;color:var(--text-secondary);font-size:12px;">没有匹配的用户 Skill。请先在持续使用的 Skill 入口添加并启用 Skill。</div>';
        return;
      }
      dropdown.style.display = 'block';
      dropdown.innerHTML = enabledSkills.map(function(skill, index) {
        var active = index === pptMasterSkillActiveIndex;
        return '<button type="button" data-ppt-skill-index="' + index + '" onclick="insertPptMasterSkillFromDropdown(' + index + ')" style="width:100%;display:flex;align-items:center;gap:8px;text-align:left;padding:9px 10px;border:0;border-bottom:1px solid var(--border-color);background:' + (active ? 'var(--modal-tip-bg)' : 'transparent') + ';color:var(--text-primary);cursor:pointer;font-size:12px;">' +
          '<span style="font-weight:800;color:var(--accent-color);">/' + escapeHtml(skill.trigger || '') + '</span>' +
          '<span style="font-weight:700;">' + escapeHtml(skill.name || '用户 Skill') + '</span>' +
          '<span style="color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(skill.description || '') + '</span>' +
        '</button>';
      }).join('');
    }

    async function handlePptMasterSkillInput() {
      var input = getPptMasterRequirementsInput();
      if (!input) return;
      var value = input.value || '';
      var pos = input.selectionStart || 0;
      var leadingSlashIndex = getLeadingInvocationMarkerIndex(value, '/');
      if (leadingSlashIndex === -1 || pos <= leadingSlashIndex) {
        hidePptMasterSkillDropdown();
        return;
      }
      var textAfterSlash = value.substring(leadingSlashIndex, pos);
      if (/\s/.test(textAfterSlash)) {
        hidePptMasterSkillDropdown();
        return;
      }
      pptMasterSkillStartPos = leadingSlashIndex;
      try {
        var skills = await fetchUserSkills();
        var currentValue = input.value || '';
        var currentPos = input.selectionStart || 0;
        var currentLeadingSlashIndex = getLeadingInvocationMarkerIndex(currentValue, '/');
        var currentTextAfterSlash = currentLeadingSlashIndex >= 0
          ? currentValue.substring(currentLeadingSlashIndex, currentPos)
          : '';
        if (
          currentLeadingSlashIndex !== leadingSlashIndex ||
          currentPos <= currentLeadingSlashIndex ||
          /\s/.test(currentTextAfterSlash)
        ) {
          hidePptMasterSkillDropdown();
          return;
        }
        renderPptMasterSkillDropdown(skills, currentTextAfterSlash.slice(1));
      } catch (error) {
        var dropdown = getPptMasterSkillDropdown();
        if (dropdown) {
          dropdown.style.display = 'block';
          dropdown.innerHTML = '<div style="padding:9px 10px;color:var(--danger-color);font-size:12px;">读取用户 Skill 失败：' + escapeHtml(error.message || error) + '</div>';
        }
      }
    }
    window.handlePptMasterSkillInput = handlePptMasterSkillInput;

    function insertPptMasterSkillFromDropdown(index) {
      var input = getPptMasterRequirementsInput();
      var skill = pptMasterSkillCandidates[index];
      if (!input || !skill || pptMasterSkillStartPos < 0) return;
      var value = input.value || '';
      var pos = input.selectionStart || 0;
      var before = value.substring(0, pptMasterSkillStartPos);
      var after = value.substring(pos);
      var prefix = before && !/\s$/.test(before) ? before + ' ' : before;
      var insertText = '/' + skill.trigger + ' ';
      input.value = prefix + insertText + after;
      var newPos = prefix.length + insertText.length;
      input.focus();
      input.setSelectionRange(newPos, newPos);
      hidePptMasterSkillDropdown();
    }
    window.insertPptMasterSkillFromDropdown = insertPptMasterSkillFromDropdown;

    function handlePptMasterSkillKeydown(event) {
      var dropdown = getPptMasterSkillDropdown();
      if (!dropdown || dropdown.style.display !== 'block' || !pptMasterSkillCandidates.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        pptMasterSkillActiveIndex = (pptMasterSkillActiveIndex + 1) % pptMasterSkillCandidates.length;
        renderPptMasterSkillDropdown(pptMasterSkillCandidates, '');
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        pptMasterSkillActiveIndex = (pptMasterSkillActiveIndex - 1 + pptMasterSkillCandidates.length) % pptMasterSkillCandidates.length;
        renderPptMasterSkillDropdown(pptMasterSkillCandidates, '');
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        insertPptMasterSkillFromDropdown(pptMasterSkillActiveIndex);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        hidePptMasterSkillDropdown();
      }
    }
    window.handlePptMasterSkillKeydown = handlePptMasterSkillKeydown;

    async function refreshPptMasterStatus() {
      var statusDiv = document.getElementById('pptMasterStatus');
      if (!statusDiv) return;
      try {
        var response = await fetch('/api/ppt-master/status');
        var payload = await response.json();
        var data = payload.data || {};
        if (data.available) {
          statusDiv.style.borderColor = 'var(--accent-color)';
          var markerInfo = data.pdfFastText && data.pdfFastText.available
            ? 'marker：可用'
            : 'marker：未检测';
          var visualInfo = data.pdfVisualExtractor && data.pdfVisualExtractor.available
            ? 'PDF图表裁剪：可用'
            : 'PDF图表裁剪：未检测';
          var codexInfo = data.codex && data.codex.available
            ? 'Codex：可用'
            : 'Codex：未检测';
          statusDiv.innerHTML =
            'ppt-master 已接入：<strong style="color:var(--text-primary);">' + escapeHtml(data.skillDir || '') + '</strong><br>' +
            '模板数：' + escapeHtml(String(data.templateCount || 0)) + ' · Python：' + escapeHtml(data.python && data.python.display ? data.python.display : '未检测') + ' · ' + markerInfo + ' · ' + visualInfo + ' · ' + codexInfo +
            '<br><span style="color:var(--text-secondary);">流程：marker 预处理 PDF → 自动裁剪 PDF 内嵌图表 → Codex 分析图片 → AI 全局规划 → 逐页 SVG → 质量门 → PPTX。</span>' +
            '<br><span style="color:var(--text-secondary);">如缺少依赖，请在终端执行：<code>' + escapeHtml(data.installCommand || '') + '</code></span>';
        } else {
          statusDiv.style.borderColor = 'var(--danger-color)';
          statusDiv.innerHTML = 'ppt-master 不可用：' + escapeHtml(data.error || '未找到工具链');
        }
      } catch (error) {
        statusDiv.style.borderColor = 'var(--danger-color)';
        statusDiv.textContent = 'ppt-master 状态检测失败：' + (error.message || error);
      }
    }
    window.refreshPptMasterStatus = refreshPptMasterStatus;

    async function loadPptMasterTemplates() {
      var select = document.getElementById('pptMasterBuiltInTemplate');
      if (!select) return;
      try {
        var response = await fetch('/api/ppt-master/templates');
        var payload = await response.json();
        pptMasterTemplates = payload.data && payload.data.templates ? payload.data.templates : [];
        var groups = { brand: [], layout: [], deck: [] };
        pptMasterTemplates.forEach(function(item) {
          var key = groups[item.kind] ? item.kind : 'layout';
          groups[key].push(item);
        });
        var labels = { brand: '品牌模板', layout: '版式模板', deck: '整套模板' };
        var html = '<option value="">不使用内置模板</option>';
        ['deck', 'layout', 'brand'].forEach(function(kind) {
          if (!groups[kind].length) return;
          html += '<optgroup label="' + labels[kind] + '">';
          groups[kind].forEach(function(item) {
            html += '<option value="' + escapeHtml(item.relativePath) + '">' + escapeHtml(item.label) + '</option>';
          });
          html += '</optgroup>';
        });
        select.innerHTML = html;
      } catch (error) {
        select.innerHTML = '<option value="">模板读取失败</option>';
      }
    }

    function renderPptMasterFiles() {
      var box = document.getElementById('pptMasterFiles');
      if (!box) return;
      var sourceInput = document.getElementById('pptMasterSources');
      var templateInput = document.getElementById('pptMasterTemplatePptx');
      var sourceFiles = sourceInput && sourceInput.files ? Array.prototype.slice.call(sourceInput.files) : [];
      var templateFile = templateInput && templateInput.files && templateInput.files.length ? templateInput.files[0] : null;
      var parts = [];
      if (sourceFiles.length) {
        parts.push('材料：' + sourceFiles.map(function(file) { return escapeHtml(file.name); }).join('、'));
      }
      if (templateFile) {
        parts.push('用户模板：' + escapeHtml(templateFile.name));
      }
      box.innerHTML = parts.length ? parts.join('<br>') : '尚未选择文件。也可以只填写具体要求创建项目。';
    }
    window.renderPptMasterFiles = renderPptMasterFiles;

    async function createPptMasterProject() {
      var resultDiv = document.getElementById('pptMasterResult');
      var createBtn = document.getElementById('pptMasterCreateBtn');
      var sourceInput = document.getElementById('pptMasterSources');
      var templateInput = document.getElementById('pptMasterTemplatePptx');
      var requirements = (document.getElementById('pptMasterRequirements')?.value || '').trim();
      var sourceFiles = sourceInput && sourceInput.files ? Array.prototype.slice.call(sourceInput.files) : [];
      var selectedContextSources = getSelectedPptMasterContextSources();
      if (!sourceFiles.length && !requirements && !selectedContextSources.length) {
        if (resultDiv) {
          resultDiv.style.display = 'block';
          resultDiv.style.borderColor = 'var(--danger-color)';
          resultDiv.textContent = '请至少上传一份材料、勾选项目资料来源，或填写具体要求。';
        }
        return;
      }

      var formData = new FormData();
      formData.append('userId', currentUserId || 'web-user');
      formData.append('projectName', document.getElementById('pptMasterProjectName')?.value || '');
      formData.append('format', document.getElementById('pptMasterFormat')?.value || 'ppt169');
      formData.append('selectedTemplate', document.getElementById('pptMasterBuiltInTemplate')?.value || '');
      formData.append('audience', document.getElementById('pptMasterAudience')?.value || '');
      formData.append('pageCount', document.getElementById('pptMasterPageCount')?.value || '');
      formData.append('styleRequest', document.getElementById('pptMasterStyle')?.value || '');
      formData.append('requirements', requirements);
      formData.append('apiUrl', apiConfig.url || '');
      formData.append('apiKey', apiConfig.key || '');
      formData.append('model', apiConfig.model || currentModel || '');
      sourceFiles.forEach(function(file) {
        formData.append('sources', file);
      });
      if (templateInput && templateInput.files && templateInput.files.length) {
        formData.append('templatePptx', templateInput.files[0]);
      }

      if (resultDiv) {
        resultDiv.style.display = 'block';
        resultDiv.style.borderColor = 'var(--warning-color)';
        resultDiv.innerHTML = '<div id="pptMasterTypewriterLog" style="white-space:pre-wrap;min-height:120px;"></div>';
        resetPptMasterTypewriter();
        enqueuePptMasterLogLine('开始生成 PPT：正在上传材料和要求...');
      }
      if (createBtn) createBtn.disabled = true;

      try {
        if (selectedContextSources.length) {
          enqueuePptMasterLogLine('正在整理已勾选的项目资料来源...');
          var contextData = await fetchPptMasterProjectContextMarkdown(selectedContextSources);
          var contextMarkdown = String(contextData.markdown || '').trim();
          var contextMaterials = Array.isArray(contextData.materials) ? contextData.materials : [];
          if (contextMarkdown) {
            var contextBlob = new Blob([contextMarkdown], { type: 'text/markdown;charset=utf-8' });
            formData.append('sources', contextBlob, 'scholar-harness-current-project-context.md');
            enqueuePptMasterLogLine('项目资料已加入 PPT 源文件：' + contextMaterials.length + ' 个来源。');
          } else {
            enqueuePptMasterLogLine('已勾选项目资料，但未整理到可用内容；继续使用上传文件和具体要求。');
          }
        }
        var response = await fetch('/api/ppt-master/jobs', {
          method: 'POST',
          body: formData
        });
        var payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || '启动失败');
        var data = payload.data || {};
        pptMasterCurrentJobId = data.jobId || '';
        pptMasterSeenLogCount = 0;
        enqueuePptMasterLogLine('任务已启动，后台会自动完成生成和导出。');
        pollPptMasterJob(true);
      } catch (error) {
        if (resultDiv) {
          resultDiv.style.borderColor = 'var(--danger-color)';
          enqueuePptMasterLogLine('启动失败：' + (error.message || error));
        }
        if (createBtn) createBtn.disabled = false;
      }
    }
    window.createPptMasterProject = createPptMasterProject;

    function resetPptMasterTypewriter() {
      pptMasterTypingQueue = [];
      pptMasterTypingBusy = false;
      if (pptMasterTypingTimer) {
        clearTimeout(pptMasterTypingTimer);
        pptMasterTypingTimer = null;
      }
      var log = document.getElementById('pptMasterTypewriterLog');
      if (log) log.textContent = '';
    }

    function enqueuePptMasterLogLine(line) {
      var text = '[' + new Date().toLocaleTimeString() + '] ' + String(line || '');
      pptMasterTypingQueue.push(text + '\n');
      if (!pptMasterTypingBusy) typeNextPptMasterChar();
    }

    function typeNextPptMasterChar() {
      var log = document.getElementById('pptMasterTypewriterLog');
      if (!log) {
        pptMasterTypingBusy = false;
        return;
      }
      if (!pptMasterTypingQueue.length) {
        pptMasterTypingBusy = false;
        return;
      }
      pptMasterTypingBusy = true;
      var current = pptMasterTypingQueue[0];
      log.textContent += current.charAt(0);
      pptMasterTypingQueue[0] = current.slice(1);
      log.scrollTop = log.scrollHeight;
      if (!pptMasterTypingQueue[0]) pptMasterTypingQueue.shift();
      pptMasterTypingTimer = setTimeout(typeNextPptMasterChar, 12);
    }

    async function pollPptMasterJob(startTimer) {
      if (!pptMasterCurrentJobId) return;
      if (startTimer && pptMasterPollTimer) {
        clearInterval(pptMasterPollTimer);
        pptMasterPollTimer = null;
      }
      try {
        var response = await fetch('/api/ppt-master/jobs/' + encodeURIComponent(pptMasterCurrentJobId));
        var payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || '读取任务失败');
        renderPptMasterJob(payload.data || {});
        var status = (payload.data && payload.data.status) || '';
        if ((status === 'queued' || status === 'running') && startTimer && !pptMasterPollTimer) {
          pptMasterPollTimer = setInterval(function() {
            pollPptMasterJob(false);
          }, 1800);
        }
        if (status === 'completed' || status === 'error') {
          if (pptMasterPollTimer) {
            clearInterval(pptMasterPollTimer);
            pptMasterPollTimer = null;
          }
          var createBtn = document.getElementById('pptMasterCreateBtn');
          if (createBtn) createBtn.disabled = false;
        }
      } catch (error) {
        enqueuePptMasterLogLine('读取任务状态失败：' + (error.message || error));
      }
    }
    window.pollPptMasterJob = pollPptMasterJob;

    function renderPptMasterJob(job) {
      var resultDiv = document.getElementById('pptMasterResult');
      if (!resultDiv) return;
      if (!document.getElementById('pptMasterTypewriterLog')) {
        resultDiv.innerHTML = '<div id="pptMasterTypewriterLog" style="white-space:pre-wrap;min-height:120px;"></div>';
      }
      var logs = Array.isArray(job.logs) ? job.logs : [];
      for (var i = pptMasterSeenLogCount; i < logs.length; i++) {
        enqueuePptMasterLogLine(logs[i].message || '');
      }
      pptMasterSeenLogCount = logs.length;
      pptMasterLastProjectPath = job.projectPath || pptMasterLastProjectPath;

      var progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
      var color = job.status === 'error' ? 'var(--danger-color)' : 'var(--accent-color)';
      resultDiv.style.borderColor = color;
      var progressHtml =
        '<div style="height:7px;background:rgba(127,127,127,0.18);border-radius:999px;overflow:hidden;margin:8px 0;">' +
          '<div style="height:100%;width:' + progress + '%;background:' + color + ';"></div>' +
        '</div>' +
        '<div style="color:var(--text-secondary);font-size:11px;">阶段：' + escapeHtml(job.step || '-') + ' · ' + progress + '%</div>';
      var files = Array.isArray(job.files) ? job.files : [];
      var filesHtml = '';
      if (job.status === 'completed') {
        filesHtml = '<div style="margin-top:10px;color:var(--text-primary);font-weight:700;">PPTX 已生成</div>';
        filesHtml += files.length
          ? files.map(function(file) {
              return '<a href="' + escapeHtml(file.url) + '" target="_blank" style="display:inline-block;margin:6px 6px 0 0;padding:6px 9px;border:1px solid var(--accent-color);border-radius:5px;color:var(--accent-color);text-decoration:none;background:var(--modal-bg);">' + escapeHtml(file.name) + '</a>';
            }).join('')
          : '<div style="margin-top:6px;color:var(--danger-color);">未发现导出的 PPTX 文件。</div>';
        appendMessage('PPT 已生成：\n' + files.map(function(file) { return file.path || file.name; }).join('\n'), 'bot', false, true);
      } else if (job.status === 'error') {
        filesHtml = '<div style="margin-top:10px;color:var(--danger-color);white-space:pre-wrap;">' + escapeHtml(job.error || job.message || '生成失败') + '</div>';
      }
      var logNode = document.getElementById('pptMasterTypewriterLog');
      var currentLogText = logNode ? escapeHtml(logNode.textContent) : '';
      resultDiv.innerHTML =
        progressHtml +
        '<pre id="pptMasterTypewriterLog" style="white-space:pre-wrap;min-height:120px;max-height:260px;overflow:auto;margin-top:8px;color:var(--text-secondary);font-family:inherit;font-size:12px;line-height:1.55;">' + currentLogText + '</pre>' +
        (job.projectPath ? '<div style="margin-top:8px;color:var(--text-secondary);word-break:break-all;">项目目录：<code>' + escapeHtml(job.projectPath) + '</code></div>' : '') +
        filesHtml;
    }

    async function runPptMasterQualityGate(projectPath) {
      var targetProject = projectPath || pptMasterLastProjectPath;
      var resultDiv = document.getElementById('pptMasterResult');
      if (!targetProject) {
        if (resultDiv) resultDiv.textContent = '请先创建 PPT Master 项目。';
        return;
      }
      if (resultDiv) {
        resultDiv.style.display = 'block';
        resultDiv.style.borderColor = 'var(--warning-color)';
        resultDiv.textContent = '正在运行 svg_quality_checker.py...';
      }
      try {
        var response = await fetch('/api/ppt-master/quality-gate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId || 'web-user', projectPath: targetProject })
        });
        var payload = await response.json();
        var log = payload.data || {};
        if (!response.ok || !payload.success) throw new Error(payload.error || log.stderr || log.stdout || '质量门未通过');
        if (resultDiv) {
          resultDiv.style.borderColor = 'var(--accent-color)';
          resultDiv.innerHTML = '<strong style="color:var(--text-primary);">SVG 质量门已通过</strong><pre style="white-space:pre-wrap;max-height:180px;overflow:auto;margin-top:8px;">' + escapeHtml((log.stdout || '').slice(-4000)) + '</pre>';
        }
      } catch (error) {
        if (resultDiv) {
          resultDiv.style.borderColor = 'var(--danger-color)';
          resultDiv.innerHTML = '<strong>SVG 质量门未通过</strong><br><pre style="white-space:pre-wrap;max-height:220px;overflow:auto;margin-top:8px;">' + escapeHtml(error.message || String(error)) + '</pre>';
        }
      }
    }
    window.runPptMasterQualityGate = runPptMasterQualityGate;

    async function runPptMasterExport(projectPath) {
      var targetProject = projectPath || pptMasterLastProjectPath;
      var resultDiv = document.getElementById('pptMasterResult');
      if (!targetProject) {
        if (resultDiv) resultDiv.textContent = '请先创建 PPT Master 项目。';
        return;
      }
      if (resultDiv) {
        resultDiv.style.display = 'block';
        resultDiv.style.borderColor = 'var(--warning-color)';
        resultDiv.textContent = '正在按质量门 -> total_md_split.py -> finalize_svg.py -> svg_to_pptx.py 导出...';
      }
      try {
        var response = await fetch('/api/ppt-master/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId || 'web-user', projectPath: targetProject })
        });
        var payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || '导出失败');
        var files = payload.data && payload.data.files ? payload.data.files : [];
        var filesHtml = files.length
          ? files.map(function(file) {
              return '<a href="' + escapeHtml(file.url) + '" target="_blank" style="display:inline-block;margin:4px 6px 0 0;padding:5px 8px;border:1px solid var(--accent-color);border-radius:5px;color:var(--accent-color);text-decoration:none;">' + escapeHtml(file.name) + '</a>';
            }).join('')
          : '导出完成，但未在 exports/ 中发现 PPTX 文件。';
        if (resultDiv) {
          resultDiv.style.borderColor = 'var(--accent-color)';
          resultDiv.innerHTML = '<strong style="color:var(--text-primary);">PPTX 已导出</strong><br>' + filesHtml;
        }
        appendMessage('PPTX 已导出：\n' + files.map(function(file) { return file.path || file.name; }).join('\n'), 'bot', false, true);
      } catch (error) {
        if (resultDiv) {
          resultDiv.style.borderColor = 'var(--danger-color)';
          resultDiv.textContent = '导出失败：' + (error.message || error);
        }
      }
    }
    window.runPptMasterExport = runPptMasterExport;
    
    // ============ R 语言作图功能结束 ============

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('analysis-tools', { source: '/app/analysis-tools.js' });
}
