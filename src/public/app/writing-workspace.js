    var DISCUSSION_FRAMEWORK_MEMORY_DEFS = [
      { key: 'data_summary_structured', label: '数据详细总结', desc: '图表数据、数值结果和关键发现' },
      { key: 'experiment_summary_structured', label: '实验资料总结', desc: '实验设计、图片规划、图注和材料说明' },
      { key: 'writing_progress', label: '写作进度', desc: '长期记忆中的当前写作阶段、已完成和待完成内容' },
      { key: 'draft_progress', label: '草稿进度', desc: '已写草稿、章节状态和修改记录' },
      { key: 'key_findings', label: '关键发现', desc: '长期记忆中提取的核心发现' }
    ];
    var discussionFrameworkFilesByChapter = {};
    var discussionFrameworkStructureSyncStatus = '';
    var discussionFrameworkStructureSyncing = false;
    var discussionFrameworkFloatingInitialized = false;
    var discussionFrameworkLastPointerMoved = false;
    var discussionFrameworkSuppressNextClick = false;

    function createDiscussionFrameworkId(prefix) {
      return (prefix || 'item') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function getDiscussionFrameworkPreset(profileId) {
      var id = (typeof getProjectWritingProfile === 'function') ? getProjectWritingProfile(profileId).id : (profileId || 'paper-writing');
      if (id === 'thesis-writing') {
        return [
          { title: '摘要', subsections: ['研究背景与目的', '方法与主要结果', '结论与创新点'] },
          { title: '绪论', subsections: ['研究背景', '科学问题', '研究目标与技术路线'] },
          { title: '文献综述', subsections: ['研究进展', '争议与不足', '本研究切入点'] },
          { title: '材料与方法', subsections: ['研究区与试验设计', '指标测定', '数据分析方法'] },
          { title: '结果', subsections: ['主要图表结果', '统计检验结果', '关键现象总结'] },
          { title: '讨论', subsections: ['机制解释', '与已有研究比较', '不确定性与局限'] },
          { title: '结论与展望', subsections: ['主要结论', '创新贡献', '后续研究'] }
        ];
      }
      if (id === 'grant-writing') {
        return [
          { title: '立项依据', subsections: ['研究背景', '科学问题', '国内外进展'] },
          { title: '研究目标', subsections: ['总体目标', '关键科学问题', '预期成果'] },
          { title: '研究内容', subsections: ['任务一', '任务二', '任务三'] },
          { title: '技术路线', subsections: ['材料与方法', '数据分析', '风险控制'] },
          { title: '创新点', subsections: ['理论创新', '方法创新', '应用价值'] }
        ];
      }
      if (id === 'general-writing') {
        return [
          { title: '背景与目标', subsections: ['写作背景', '核心目标', '受众定位'] },
          { title: '主体内容', subsections: ['要点一', '要点二', '证据材料'] },
          { title: '结论与行动', subsections: ['结论', '建议', '下一步'] }
        ];
      }
      return [
        { title: 'Title / Abstract', subsections: ['研究问题', '方法概述', '主要发现'] },
        { title: 'Introduction', subsections: ['研究背景', '知识缺口', '研究目标与假设'] },
        { title: 'Materials and Methods', subsections: ['试验设计', '指标测定', '统计分析'] },
        { title: 'Results', subsections: ['主图结果', '亚组/补充结果', '关键统计结论'] },
        { title: 'Discussion', subsections: ['机制解释', '与文献比较', '局限与意义'] },
        { title: 'Conclusion', subsections: ['核心结论', '实践意义', '未来方向'] }
      ];
    }

    function buildDiscussionFrameworkChapters(profileId) {
      return getDiscussionFrameworkPreset(profileId).map(function(section) {
        return {
          id: createDiscussionFrameworkId('chapter'),
          title: section.title,
          idea: '',
          analysis: '',
          analysisUpdatedAt: '',
          analysisProgress: '',
          analysisProgressStatus: '',
          syncedFigures: [],
          figureReferences: [],
          syncedDraftKey: '',
          syncedDraftFile: '',
          syncedAt: '',
          writingStatus: 'not_started',
          collapsed: true,
          subsections: (section.subsections || []).map(function(title) {
            return { id: createDiscussionFrameworkId('sub'), title: title, idea: '' };
          })
        };
      });
    }

    function createDefaultDiscussionFrameworkState(profileId) {
      var resolvedProfileId = (typeof getProjectWritingProfile === 'function') ? getProjectWritingProfile(profileId).id : (profileId || 'paper-writing');
      return {
        version: 2,
        profileId: resolvedProfileId,
        expanded: false,
        activeChapterId: '',
        activeChapterKey: '',
        activeSubsectionId: '',
        writingTargetUpdatedAt: '',
        draftChapterStatuses: {},
        memoryKeys: {},
        chapters: buildDiscussionFrameworkChapters(resolvedProfileId)
      };
    }

    function getDiscussionFrameworkStorageKey() {
      return 'scholarharness_discussion_framework_' + (currentUserId || 'web-user') + '_' + getMainContextProjectKeyPart();
    }

    function getDiscussionFrameworkFloatStorageKey() {
      return 'scholarharness_discussion_framework_float_' + (currentUserId || 'web-user') + '_' + getMainContextProjectKeyPart();
    }

    function loadDiscussionFrameworkFloatPosition() {
      try {
        var saved = JSON.parse(localStorage.getItem(getDiscussionFrameworkFloatStorageKey()) || 'null');
        if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
          return saved;
        }
      } catch (e) {}
      return { left: Math.max(16, window.innerWidth - 168), top: Math.max(82, window.innerHeight - 230) };
    }

    function saveDiscussionFrameworkFloatPosition(left, top) {
      try {
        localStorage.setItem(getDiscussionFrameworkFloatStorageKey(), JSON.stringify({ left: left, top: top }));
      } catch (e) {}
    }

    function applyDiscussionFrameworkFloatPosition(left, top) {
      var root = document.getElementById('discussionFrameworkFloat');
      if (!root) return;
      var rect = root.getBoundingClientRect();
      var width = rect.width || 150;
      var height = rect.height || 58;
      var nextLeft = Math.max(10, Math.min(Number(left) || 10, window.innerWidth - width - 10));
      var nextTop = Math.max(10, Math.min(Number(top) || 10, window.innerHeight - height - 10));
      root.style.left = nextLeft + 'px';
      root.style.top = nextTop + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      saveDiscussionFrameworkFloatPosition(nextLeft, nextTop);
    }

    function normalizeDiscussionFrameworkState(raw) {
      var profileId = (typeof getProjectWritingProfile === 'function') ? getProjectWritingProfile().id : 'paper-writing';
      if (!raw || typeof raw !== 'object' || raw.profileId !== profileId || !Array.isArray(raw.chapters)) {
        return createDefaultDiscussionFrameworkState(profileId);
      }
      raw.version = 2;
      raw.expanded = raw.expanded === true;
      raw.activeChapterId = String(raw.activeChapterId || '');
      raw.activeChapterKey = String(raw.activeChapterKey || '');
      raw.activeSubsectionId = String(raw.activeSubsectionId || '');
      raw.writingTargetUpdatedAt = String(raw.writingTargetUpdatedAt || '');
      raw.draftChapterStatuses = raw.draftChapterStatuses && typeof raw.draftChapterStatuses === 'object'
        ? raw.draftChapterStatuses
        : {};
      raw.memoryKeys = raw.memoryKeys && typeof raw.memoryKeys === 'object' ? raw.memoryKeys : {};
      raw.chapters = raw.chapters.map(function(chapter) {
        var normalized = {
          id: chapter.id || createDiscussionFrameworkId('chapter'),
          title: String(chapter.title || ''),
          idea: String(chapter.idea || ''),
          analysis: String(chapter.analysis || ''),
          analysisUpdatedAt: String(chapter.analysisUpdatedAt || ''),
          analysisProgress: String(chapter.analysisProgress || ''),
          analysisProgressStatus: String(chapter.analysisProgressStatus || ''),
          syncedFigures: Array.isArray(chapter.syncedFigures) ? chapter.syncedFigures : [],
          figureReferences: Array.isArray(chapter.figureReferences) ? chapter.figureReferences.map(function(item) { return String(item || ''); }).filter(Boolean) : [],
          syncedDraftKey: String(chapter.syncedDraftKey || ''),
          syncedDraftFile: String(chapter.syncedDraftFile || ''),
          syncedAt: String(chapter.syncedAt || ''),
          writingStatus: chapter.writingStatus === 'completed'
            ? 'completed'
            : (chapter.writingStatus === 'in_progress' ? 'in_progress' : 'not_started'),
          collapsed: chapter.collapsed !== false,
          subsections: Array.isArray(chapter.subsections) ? chapter.subsections : []
        };
        normalized.subsections = normalized.subsections.map(function(sub) {
          return {
            id: sub.id || createDiscussionFrameworkId('sub'),
            title: String(sub.title || ''),
            idea: String(sub.idea || '')
          };
        });
        return normalized;
      });
      return raw;
    }

    function loadDiscussionFrameworkState() {
      try {
        return normalizeDiscussionFrameworkState(JSON.parse(localStorage.getItem(getDiscussionFrameworkStorageKey()) || 'null'));
      } catch (e) {
        return createDefaultDiscussionFrameworkState();
      }
    }

    function saveDiscussionFrameworkState(state) {
      try {
        localStorage.setItem(getDiscussionFrameworkStorageKey(), JSON.stringify(normalizeDiscussionFrameworkState(state)));
      } catch (e) {}
    }

    function getDiscussionFrameworkChapterFiles(chapter) {
      if (!chapter) return [];
      var localFiles = discussionFrameworkFilesByChapter[chapter.id] || [];
      var syncedFigures = Array.isArray(chapter.syncedFigures) ? chapter.syncedFigures : [];
      var seen = {};
      return localFiles.concat(syncedFigures).filter(function(fileInfo) {
        var identity = String(fileInfo && (fileInfo.syncedAssetId || fileInfo.url || fileInfo.name) || '').toLowerCase();
        if (!identity || seen[identity]) return false;
        seen[identity] = true;
        return true;
      });
    }

    function countDiscussionFrameworkContent(state) {
      var chapterCount = 0;
      var subsectionCount = 0;
      var fileCount = 0;
      (state.chapters || []).forEach(function(chapter) {
        var files = getDiscussionFrameworkChapterFiles(chapter);
        var hasChapterContent = String(chapter.idea || '').trim() || files.length > 0 || (chapter.figureReferences || []).length > 0;
        var activeSubsections = (chapter.subsections || []).filter(function(sub) {
          return String(sub.idea || '').trim();
        }).length;
        if (hasChapterContent || activeSubsections > 0) chapterCount++;
        subsectionCount += activeSubsections;
        fileCount += files.length + (Array.isArray(chapter.figureReferences) ? chapter.figureReferences.length : 0);
      });
      return { chapters: chapterCount, subsections: subsectionCount, files: fileCount };
    }

    var articleDraftProgressCache = {
      userId: '',
      loading: false,
      refreshing: false,
      reloadPending: false,
      loaded: false,
      drafts: [],
      memoryProgress: '',
      request: null,
      lastRefreshedAt: '',
      lastError: ''
    };
    var articleDraftSaveTimers = {};
    var articleDraftEditOriginalByKey = {};
    var paperFigureLibraryCache = {
      userId: '',
      loading: false,
      loaded: false,
      figures: [],
      request: null,
      lastRefreshedAt: '',
      lastError: ''
    };
    var selectedPaperFigureIds = new Set();
    var paperFigureMergeInProgress = false;
    var rightSidebarWordImportBusy = false;
    var selectedArticleQuestionChapters = (function() {
      try {
        var parsed = JSON.parse(localStorage.getItem('articleQuestionChapterSelection') || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (e) {
        return {};
      }
    })();

    function setRightSidebarWordImportStatus(message, busy) {
      var region = document.getElementById('rightSidebarWordImport');
      var trigger = document.getElementById('rightSidebarWordImportTrigger');
      var status = document.getElementById('rightSidebarWordImportStatus');
      rightSidebarWordImportBusy = !!busy;
      if (region) region.classList.toggle('busy', rightSidebarWordImportBusy);
      if (trigger) trigger.disabled = rightSidebarWordImportBusy;
      if (status) status.textContent = String(message || '自动填入章节草稿，并把嵌入图片归档到论文图片');
    }

    function requestRightSidebarWordImport(file, mode) {
      var body = new FormData();
      body.append('file', file);
      body.append('userId', currentUserId || 'web-user');
      body.append('mode', mode || 'preview');
      return fetch('/api/draft-assets/import-word', {
        method: 'POST',
        body: body
      }).then(function(response) {
        return response.json().catch(function() { return {}; }).then(function(payload) {
          if (!response.ok || !payload.success) {
            throw new Error(payload.error || ('Word 导入接口返回 HTTP ' + response.status));
          }
          return payload;
        });
      });
    }

    function buildRightSidebarWordImportConfirmation(preview) {
      var sections = Array.isArray(preview.sections) ? preview.sections : [];
      var figures = Array.isArray(preview.figures) ? preview.figures : [];
      var sectionLines = sections.map(function(section) {
        return '• ' + (section.title || section.key || '未命名章节')
          + '（' + Number(section.chars || 0) + ' 字符'
          + (section.exists ? '，将覆盖现有草稿' : '，新建') + '）';
      });
      var lines = [
        '已识别 Word：' + String(preview.documentName || ''),
        '',
        sectionLines.length ? '章节：\n' + sectionLines.join('\n') : '未识别到可写入的标准章节。',
        '嵌入图片：' + figures.length + ' 张',
        '',
        Number(preview.conflictCount || 0) > 0
          ? '继续后将覆盖 ' + Number(preview.conflictCount || 0) + ' 个现有章节；系统会先保存覆盖前备份。'
          : '继续后将把识别内容写入右侧章节草稿和论文图片。'
      ];
      return lines.join('\n');
    }

    function handleRightSidebarWordImportFile(file) {
      if (rightSidebarWordImportBusy || !file) return;
      var name = String(file.name || '');
      if (!/\.docx$/i.test(name)) {
        setRightSidebarWordImportStatus('只支持 .docx Word 文件', false);
        alert('请拖入 .docx 格式的 Word 文件。');
        return;
      }
      if (Number(file.size || 0) > 64 * 1024 * 1024) {
        setRightSidebarWordImportStatus('Word 文件不能超过 64 MB', false);
        alert('Word 文件超过 64 MB，无法导入。');
        return;
      }
      setRightSidebarWordImportStatus('正在识别 Word 章节和嵌入图片…', true);
      requestRightSidebarWordImport(file, 'preview')
        .then(function(preview) {
          var sectionCount = Array.isArray(preview.sections) ? preview.sections.length : 0;
          var figureCount = Array.isArray(preview.figures) ? preview.figures.length : 0;
          if (!sectionCount && !figureCount) {
            throw new Error('没有识别到标准章节或可导入的嵌入图片。请检查 Word 是否使用章节标题，并确认图片是嵌入对象。');
          }
          setRightSidebarWordImportStatus('已识别 ' + sectionCount + ' 个章节、' + figureCount + ' 张图片，等待确认', false);
          if (!window.confirm(buildRightSidebarWordImportConfirmation(preview))) {
            setRightSidebarWordImportStatus('已取消导入，右侧内容未改变', false);
            return null;
          }
          setRightSidebarWordImportStatus('正在写入章节草稿并归档论文图片…', true);
          return requestRightSidebarWordImport(file, 'overwrite');
        })
        .then(function(result) {
          if (!result) return;
          var sectionCount = Array.isArray(result.importedSections) ? result.importedSections.length : 0;
          var figureCount = Array.isArray(result.importedFigures) ? result.importedFigures.length : 0;
          articleDraftProgressCache.loaded = false;
          paperFigureLibraryCache.loaded = false;
          return Promise.all([
            loadArticleDraftProgress(true),
            loadPaperFigureLibrary(true)
          ]).then(function() {
            if (getRightSidebarActiveTab() === 'article') renderArticleWritingProgressPanel();
            if (getRightSidebarActiveTab() === 'figures') renderPaperFigureLibraryPanel();
            setRightSidebarWordImportStatus('已导入 ' + sectionCount + ' 个章节、' + figureCount + ' 张图片', false);
          });
        })
        .catch(function(error) {
          console.warn('[WordSidebarImport] Import failed:', error);
          setRightSidebarWordImportStatus('导入失败：' + (error && error.message ? error.message : '未知错误'), false);
          alert('Word 导入失败：' + (error && error.message ? error.message : '未知错误'));
        });
    }
    window.handleRightSidebarWordImportFile = handleRightSidebarWordImportFile;

    function initRightSidebarWordImport() {
      var region = document.getElementById('rightSidebarWordImport');
      var trigger = document.getElementById('rightSidebarWordImportTrigger');
      var input = document.getElementById('rightSidebarWordImportInput');
      if (!region || !trigger || !input || region.dataset.bound === 'true') return;
      region.dataset.bound = 'true';
      trigger.addEventListener('click', function() {
        if (!rightSidebarWordImportBusy) input.click();
      });
      input.addEventListener('change', function() {
        var file = input.files && input.files[0];
        input.value = '';
        if (file) handleRightSidebarWordImportFile(file);
      });
      ['dragenter', 'dragover'].forEach(function(eventName) {
        region.addEventListener(eventName, function(event) {
          event.preventDefault();
          if (!rightSidebarWordImportBusy) region.classList.add('drag-active');
        });
      });
      ['dragleave', 'drop'].forEach(function(eventName) {
        region.addEventListener(eventName, function(event) {
          event.preventDefault();
          region.classList.remove('drag-active');
        });
      });
      region.addEventListener('drop', function(event) {
        if (rightSidebarWordImportBusy) return;
        var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) handleRightSidebarWordImportFile(file);
      });
    }

    function stripLatexForProgress(text) {
      return String(text || '')
        .replace(/\\section\{([^}]*)\}/g, '$1 ')
        .replace(/\\subsection\{([^}]*)\}/g, '$1 ')
        .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{([^}]*)\})?/g, '$1 ')
        .replace(/[{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function makeArticleProgressExcerpt(text, maxChars) {
      var cleaned = stripLatexForProgress(text);
      var limit = Number(maxChars) || 160;
      if (!cleaned) return '';
      return cleaned.length > limit ? cleaned.slice(0, limit) + '...' : cleaned;
    }

    function inferArticleChapterKey(title) {
      var value = String(title || '').toLowerCase();
      if (/abstract|摘要/.test(value)) return 'abstract';
      if (/intro|introduction|引言|绪论/.test(value)) return 'introduction';
      if (/method|material|材料|方法/.test(value)) return 'methods';
      if (/result|结果/.test(value)) return 'results';
      if (/discussion|讨论/.test(value)) return 'discussion';
      if (/conclusion|结论|展望/.test(value)) return 'conclusion';
      if (/title|题目|标题/.test(value)) return 'title';
      if (/literature|review|综述|文献/.test(value)) return 'literature_review';
      return value.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_').replace(/^_+|_+$/g, '');
    }

    function normalizeNestedDraftSectionsForSidebar(content) {
      return String(content || '').replace(/\\section(\*?)\{([^{}]+)\}/g, function(fullMatch, star, rawTitle) {
        var title = String(rawTitle || '').trim();
        return /^\d+(?:\.\d+)+(?:[.)、:：\s-]+|$)/.test(title)
          ? '\\subsection*{' + title + '}'
          : fullMatch;
      });
    }

    function splitDraftContentIntoChapters(content, chapterNames) {
      var drafts = [];
      var text = normalizeNestedDraftSectionsForSidebar(content);
      var sectionRe = /\\section\{([^}]+)\}\s*([\s\S]*?)(?=\\section\{|$)/g;
      var match;
      while ((match = sectionRe.exec(text)) !== null) {
        drafts.push({
          chapterName: String(match[1] || '').trim(),
          key: inferArticleChapterKey(match[1]),
          content: String(match[2] || '').trim()
        });
      }
      if (!drafts.length && text.trim()) {
        drafts.push({
          chapterName: Array.isArray(chapterNames) && chapterNames[0] ? String(chapterNames[0]) : 'paper',
          key: Array.isArray(chapterNames) && chapterNames[0] ? inferArticleChapterKey(chapterNames[0]) : 'paper',
          content: text.trim()
        });
      }
      return drafts.filter(function(item) { return item.content; });
    }

    function findArticleDraftForChapter(chapter, draftMap) {
      if (!draftMap) return null;
      var title = String(chapter && chapter.title || '');
      var key = inferArticleChapterKey(title);
      if (draftMap[key]) return draftMap[key];
      if (key === 'abstract' && draftMap.title) return draftMap.title;
      if (key === 'title' && draftMap.abstract) return draftMap.abstract;
      if (/title|abstract|标题|摘要/i.test(title)) return draftMap.abstract || draftMap.title || null;
      var normalizedTitle = title.toLowerCase();
      var draftKeys = Object.keys(draftMap);
      for (var i = 0; i < draftKeys.length; i++) {
        var draft = draftMap[draftKeys[i]];
        var draftName = String(draft.chapterName || '').toLowerCase();
        if (draftName && (normalizedTitle.indexOf(draftName) !== -1 || draftName.indexOf(normalizedTitle) !== -1)) {
          return draft;
        }
      }
      return null;
    }

    function parseArticleDraftPayload(data) {
      if (!data || data.exists !== true) return [];
      if (Array.isArray(data.chapterRecords) && data.chapterRecords.length) {
        return data.chapterRecords.map(function(record) {
          var key = String(record.key || inferArticleChapterKey(record.chapterName) || '').trim();
          var content = String(record.content || '');
          return {
            chapterName: record.chapterName || key,
            key: key,
            content: content,
            chars: stripLatexForProgress(content).length,
            excerpt: makeArticleProgressExcerpt(content, 180),
            fileName: record.fileName || (key ? key + '.txt' : ''),
            storagePath: record.storagePath || (key ? 'drafts/' + key + '.txt' : ''),
            savedAt: record.savedAt || '',
            source: data.source || 'chapter-txt'
          };
        }).filter(function(item) { return item.key && item.content.trim(); });
      }
      var mergedByKey = {};
      var orderedKeys = [];
      splitDraftContentIntoChapters(data.content || '', data.chapters || []).forEach(function(item) {
        var key = item.key || inferArticleChapterKey(item.chapterName);
        if (!key) key = 'draft_' + orderedKeys.length;
        var content = String(item.content || '').trim();
        if (!content) return;
        if (!mergedByKey[key]) {
          orderedKeys.push(key);
          mergedByKey[key] = {
            chapterName: item.chapterName,
            key: key,
            content: content
          };
          return;
        }
        var existing = String(mergedByKey[key].content || '').trim();
        var existingCompact = stripLatexForProgress(existing).replace(/\s+/g, '');
        var incomingCompact = stripLatexForProgress(content).replace(/\s+/g, '');
        if (incomingCompact && existingCompact.indexOf(incomingCompact) !== -1) return;
        if (existingCompact && incomingCompact.indexOf(existingCompact) !== -1) {
          mergedByKey[key].content = content;
          return;
        }
        mergedByKey[key].content = [existing, content].filter(Boolean).join('\n\n');
      });
      return orderedKeys.map(function(key) {
        var item = mergedByKey[key];
        return {
          chapterName: item.chapterName,
          key: item.key,
          content: item.content,
          chars: stripLatexForProgress(item.content).length,
          excerpt: makeArticleProgressExcerpt(item.content, 180),
          fileName: (data.chapterFiles && data.chapterFiles[item.key]) || (item.key + '.txt'),
          storagePath: 'drafts/' + ((data.chapterFiles && data.chapterFiles[item.key]) || (item.key + '.txt')),
          source: data.source || 'draft'
        };
      });
    }

    function parseArticleMemoryDraftPayload(data, chapterNames) {
      var entries = data && data.success && data.memory && Array.isArray(data.memory.entries) ? data.memory.entries : [];
      var entry = entries.find(function(item) { return item && item.key === 'draft_progress'; });
      var value = entry && entry.value ? String(entry.value) : '';
      if (!value.trim()) return { drafts: [], progress: '' };
      return { drafts: [], progress: value.trim() };
    }

    function mergeArticleDraftSources(primaryDrafts, memoryDrafts) {
      var merged = [];
      var seen = {};
      (primaryDrafts || []).forEach(function(draft) {
        var key = draft.key || inferArticleChapterKey(draft.chapterName);
        if (!key) key = 'draft_' + merged.length;
        if (seen[key]) return;
        seen[key] = true;
        merged.push(Object.assign({}, draft, { key: key }));
      });
      (memoryDrafts || []).forEach(function(draft) {
        var key = draft.key || inferArticleChapterKey(draft.chapterName);
        if (!key || seen[key]) return;
        seen[key] = true;
        merged.push(Object.assign({}, draft, { key: key }));
      });
      return merged;
    }

    function getArticleDraftDomId(value) {
      return String(value || 'chapter')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'chapter';
    }

    function persistArticleQuestionChapterSelection() {
      try {
        localStorage.setItem('articleQuestionChapterSelection', JSON.stringify(selectedArticleQuestionChapters || {}));
      } catch (e) {
        console.warn('[ArticleDraft] Failed to persist selected question chapters:', e);
      }
    }

    function normalizeArticleQuestionChapterKey(key, title) {
      return String(key || inferArticleChapterKey(title) || '').trim();
    }

    function isArticleChapterSelectedForQuestion(key, title) {
      var normalizedKey = normalizeArticleQuestionChapterKey(key, title);
      return !!(normalizedKey && selectedArticleQuestionChapters[normalizedKey] === true);
    }

    function makeArticleChapterQuestionPath(key, title, draft) {
      var normalizedKey = normalizeArticleQuestionChapterKey(key, title) || 'chapter';
      return draft && draft.storagePath
        ? String(draft.storagePath)
        : 'drafts/' + normalizedKey + '.txt';
    }

    function toggleArticleChapterForQuestion(input) {
      if (!input) return;
      var key = normalizeArticleQuestionChapterKey(
        input.getAttribute('data-article-question-key') || '',
        input.getAttribute('data-article-question-title') || ''
      );
      if (!key) return;
      if (input.checked) {
        selectedArticleQuestionChapters[key] = true;
      } else {
        delete selectedArticleQuestionChapters[key];
      }
      persistArticleQuestionChapterSelection();
      var label = input.closest ? input.closest('.article-structure-question-toggle') : null;
      if (label) label.classList.toggle('active', input.checked);
    }
    window.toggleArticleChapterForQuestion = toggleArticleChapterForQuestion;

    async function deleteArticleWritingProgressChapter(input) {
      if (!input || !input.checked) return;
      var key = String(input.getAttribute('data-article-delete-key') || '').trim();
      var title = String(input.getAttribute('data-article-delete-title') || key || '未命名章节').trim();
      var frameworkId = String(input.getAttribute('data-article-framework-id') || '').trim();
      if (!key) {
        input.checked = false;
        return;
      }

      var confirmed = window.confirm('确定删除「' + title + '」吗？\n\n该操作会同时删除右侧章节框架、章节草稿，并同步更新整篇导出文件。');
      if (!confirmed) {
        input.checked = false;
        return;
      }

      var label = input.closest ? input.closest('.article-structure-delete-toggle') : null;
      if (label) label.classList.add('deleting');
      input.disabled = true;
      try {
        var availableChapters = getArticleDraftChapterTargets({ includeAllVisible: true });
        var response = await fetch(
          '/api/draft/' + encodeURIComponent(currentUserId || 'web-user') + '/chapter/' + encodeURIComponent(key),
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ availableChapters: availableChapters })
          }
        );
        var result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '删除失败');

        var state = loadDiscussionFrameworkState();
        var chapterIndex = (state.chapters || []).findIndex(function(chapter) {
          if (frameworkId && String(chapter.id || '') === frameworkId) return true;
          return inferArticleChapterKey(chapter.title) === key;
        });
        if (chapterIndex >= 0) {
          var removedChapter = state.chapters[chapterIndex];
          if (removedChapter && removedChapter.id) {
            delete discussionFrameworkFilesByChapter[removedChapter.id];
          }
          state.chapters.splice(chapterIndex, 1);
        }
        if (state.draftChapterStatuses) delete state.draftChapterStatuses[key];
        if (String(state.activeChapterKey || '') === key) {
          state.activeChapterId = '';
          state.activeChapterKey = '';
          state.activeSubsectionId = '';
        }
        saveDiscussionFrameworkState(state);

        delete selectedArticleQuestionChapters[key];
        persistArticleQuestionChapterSelection();
        var combinedTitleAbstract = /title.*abstract|abstract.*title|标题.*摘要|摘要.*标题/i.test(title);
        articleDraftProgressCache.drafts = (articleDraftProgressCache.drafts || []).filter(function(draft) {
          var draftKey = String(draft.key || inferArticleChapterKey(draft.chapterName) || '');
          if (draftKey === key) return false;
          return !(combinedTitleAbstract && (draftKey === 'title' || draftKey === 'abstract'));
        });
        articleDraftProgressCache.loaded = true;
        articleDraftProgressCache.userId = currentUserId || 'web-user';
        renderArticleWritingProgressPanel();
      } catch (error) {
        input.checked = false;
        input.disabled = false;
        if (label) label.classList.remove('deleting');
        alert('删除章节失败：' + (error.message || error));
      }
    }
    window.deleteArticleWritingProgressChapter = deleteArticleWritingProgressChapter;

    function findArticleChapterTextareaByKey(key) {
      var normalizedKey = String(key || '');
      var textareas = document.querySelectorAll('.article-structure-content[data-article-chapter-key]');
      for (var i = 0; i < textareas.length; i++) {
        if (String(textareas[i].getAttribute('data-article-chapter-key') || '') === normalizedKey) {
          return textareas[i];
        }
      }
      return null;
    }

    function getArticleWritingProgressItemsForContext() {
      var order = ['title', 'abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusion'];
      return (articleDraftProgressCache.drafts || [])
        .filter(function(draft) {
          return !!(draft && String(draft.key || '').trim() && String(draft.content || '').trim());
        })
        .slice()
        .sort(function(a, b) {
          var aIndex = order.indexOf(String(a.key || '').toLowerCase());
          var bIndex = order.indexOf(String(b.key || '').toLowerCase());
          if (aIndex < 0) aIndex = order.length;
          if (bIndex < 0) bIndex = order.length;
          return aIndex - bIndex || String(a.chapterName || a.key || '').localeCompare(String(b.chapterName || b.key || ''), 'zh-CN', { numeric: true });
        })
        .map(function(draft, draftIndex) {
          return {
            type: 'draft',
            chapter: null,
            chapterIndex: draftIndex,
            title: draft.chapterName || draft.key || '未命名章节',
            key: draft.key || inferArticleChapterKey(draft.chapterName),
            draft: draft
          };
        });
    }

    function getArticleWritingProgressSnapshot() {
      var items = getArticleWritingProgressItemsForContext();
      var chapters = items.map(function(item, itemIndex) {
        var key = normalizeArticleQuestionChapterKey(item.key, item.title);
        var status = item.draft ? 'drafted' : 'not_started';
        return {
          key: key,
          title: String(item.title || key),
          chapterId: '',
          status: status,
          completed: false,
          current: false,
          subsectionCount: 0,
          drafted: !!item.draft,
          draftChars: item.draft ? Number(item.draft.chars || 0) : 0,
          fileName: item.draft && item.draft.fileName ? item.draft.fileName : key + '.txt',
          storagePath: item.draft && item.draft.storagePath ? item.draft.storagePath : 'drafts/' + key + '.txt',
          subsections: [],
          order: itemIndex + 1
        };
      });
      return {
        available: chapters.length > 0,
        updatedAt: String(articleDraftProgressCache.lastRefreshedAt || ''),
        activeTarget: null,
        completedChapterKeys: [],
        completedChapterCount: 0,
        totalChapterCount: chapters.length,
        totalSubsectionCount: 0,
        chapters: chapters
      };
    }

    function setArticleWritingTarget(chapterKey, chapterId, subsectionId) {
      var state = loadDiscussionFrameworkState();
      var normalizedKey = String(chapterKey || '').trim();
      var normalizedId = String(chapterId || '').trim();
      var chapter = (state.chapters || []).find(function(item) {
        return (normalizedId && String(item.id || '') === normalizedId)
          || (normalizedKey && inferArticleChapterKey(item.title) === normalizedKey);
      });
      (state.chapters || []).forEach(function(item) {
        if (item && item.writingStatus === 'in_progress') item.writingStatus = 'not_started';
      });
      Object.keys(state.draftChapterStatuses || {}).forEach(function(key) {
        if (state.draftChapterStatuses[key] === 'in_progress') state.draftChapterStatuses[key] = 'not_started';
      });
      if (chapter) {
        var normalizedSubsectionId = String(subsectionId || '').trim();
        if (normalizedSubsectionId && !(chapter.subsections || []).some(function(sub) { return String(sub.id || '') === normalizedSubsectionId; })) {
          return;
        }
        chapter.writingStatus = 'in_progress';
        state.activeChapterId = String(chapter.id || normalizedId);
        state.activeChapterKey = normalizedKey || inferArticleChapterKey(chapter.title);
        state.activeSubsectionId = normalizedSubsectionId;
      } else if (normalizedKey) {
        state.activeChapterId = '';
        state.activeChapterKey = normalizedKey;
        state.activeSubsectionId = '';
        state.draftChapterStatuses[normalizedKey] = 'in_progress';
      } else {
        return;
      }
      state.writingTargetUpdatedAt = new Date().toISOString();
      saveDiscussionFrameworkState(state);
      renderArticleWritingProgressPanel();
    }
    window.setArticleWritingTarget = setArticleWritingTarget;

    function clearArticleWritingTarget() {
      var state = loadDiscussionFrameworkState();
      (state.chapters || []).forEach(function(item) {
        if (item && item.writingStatus === 'in_progress') item.writingStatus = 'not_started';
      });
      Object.keys(state.draftChapterStatuses || {}).forEach(function(key) {
        if (state.draftChapterStatuses[key] === 'in_progress') state.draftChapterStatuses[key] = 'not_started';
      });
      state.activeChapterId = '';
      state.activeChapterKey = '';
      state.activeSubsectionId = '';
      state.writingTargetUpdatedAt = new Date().toISOString();
      saveDiscussionFrameworkState(state);
      renderArticleWritingProgressPanel();
    }
    window.clearArticleWritingTarget = clearArticleWritingTarget;

    function toggleArticleWritingTarget(input, chapterKey, chapterId, subsectionId) {
      if (!input) return;
      var current = getArticleWritingProgressSnapshot().activeTarget;
      var sameTarget = !!current
        && String(current.chapterKey || '') === String(chapterKey || '')
        && String(current.subsectionId || '') === String(subsectionId || '');
      if (!input.checked && sameTarget) {
        clearArticleWritingTarget();
        return;
      }
      if (input.checked) {
        setArticleWritingTarget(chapterKey, chapterId, subsectionId);
      }
    }
    window.toggleArticleWritingTarget = toggleArticleWritingTarget;

    function toggleArticleChapterCompleted(input) {
      if (!input) return;
      var key = String(input.getAttribute('data-article-complete-key') || '').trim();
      var chapterId = String(input.getAttribute('data-article-framework-id') || '').trim();
      var state = loadDiscussionFrameworkState();
      var chapter = (state.chapters || []).find(function(item) {
        return (chapterId && String(item.id || '') === chapterId)
          || (key && inferArticleChapterKey(item.title) === key);
      });
      if (chapter) {
        chapter.writingStatus = input.checked ? 'completed' : (
          String(state.activeChapterKey || '') === key ? 'in_progress' : 'not_started'
        );
      } else if (key) {
        state.draftChapterStatuses[key] = input.checked ? 'completed' : (
          String(state.activeChapterKey || '') === key ? 'in_progress' : 'not_started'
        );
      } else {
        return;
      }
      if (input.checked && String(state.activeChapterKey || '') === key) {
        state.activeChapterId = '';
        state.activeChapterKey = '';
        state.activeSubsectionId = '';
      }
      state.writingTargetUpdatedAt = new Date().toISOString();
      saveDiscussionFrameworkState(state);
      renderArticleWritingProgressPanel();
    }
    window.toggleArticleChapterCompleted = toggleArticleChapterCompleted;

    function getCurrentArticleWritingTarget() {
      return getArticleWritingProgressSnapshot().activeTarget;
    }

    function getArticleDraftChapterTargets(options) {
      var settings = options || {};
      var includeAllVisible = settings.includeAllVisible === true;
      var includeSelectedVisible = settings.includeSelectedVisible !== false;
      var targets = [];
      var seen = {};
      getArticleWritingProgressItemsForContext().forEach(function(item) {
        var title = String(item.title || item.key || '').trim();
        var key = normalizeArticleQuestionChapterKey(item.key, title);
        if (!key) return;
        var selected = selectedArticleQuestionChapters[key] === true;
        if (item.type !== 'framework' && !includeAllVisible && !(includeSelectedVisible && selected)) return;
        var identity = String(key).trim().toLowerCase();
        if (!identity || seen[identity]) return;
        seen[identity] = true;
        targets.push({
          key: key,
          title: title || key,
          exists: !!item.draft,
          fileName: item.draft && item.draft.fileName ? item.draft.fileName : key + '.txt',
          savedAt: item.draft && item.draft.savedAt ? item.draft.savedAt : ''
        });
      });
      return targets;
    }

    function collectSelectedArticleChapterQuestionContexts() {
      var items = getArticleWritingProgressItemsForContext();
      var selected = [];
      items.forEach(function(item, itemIndex) {
        var title = item.title || '未命名章节';
        var key = normalizeArticleQuestionChapterKey(item.key, title);
        if (!key || selectedArticleQuestionChapters[key] !== true) return;
        var chapter = item.chapter || {};
        var draft = item.draft || null;
        var textarea = findArticleChapterTextareaByKey(key);
        var content = textarea ? textarea.value : (draft ? String(draft.content || '') : '');
        var subsections = Array.isArray(chapter.subsections) ? chapter.subsections.map(function(sub, subIndex) {
          return {
            index: subIndex + 1,
            title: sub.title || ('小节 ' + (subIndex + 1)),
            idea: sub.idea || ''
          };
        }) : [];
        selected.push({
          index: itemIndex + 1,
          key: key,
          title: title,
          path: makeArticleChapterQuestionPath(key, title, draft),
          storagePath: draft && draft.storagePath ? draft.storagePath : 'drafts/' + key + '.txt',
          fileName: draft && draft.fileName ? draft.fileName : key + '.txt',
          savedAt: draft && draft.savedAt ? draft.savedAt : '',
          source: draft ? (draft.source || 'draft') : 'framework',
          content: content,
          chars: stripLatexForProgress(content).length,
          chapterIdea: chapter.idea || '',
          chapterAnalysis: chapter.analysis || '',
          subsections: subsections
        });
      });
      return selected;
    }

    function buildSelectedArticleChapterQuestionMarkdown(chapters) {
      if (!Array.isArray(chapters) || chapters.length === 0) return '';
      var lines = [
        '## 右侧文章写作进度：用户勾选章节',
        '用户在右侧“文章写作进度”中勾选了以下章节用于本轮提问。回答时必须把这些内容视为当前章节版本；如果用户要求修改、续写、评价或提问，优先针对这些章节内容作答，不要用旧长期记忆覆盖。',
        ''
      ];
      chapters.forEach(function(chapter, idx) {
        lines.push('### ' + (idx + 1) + '. ' + (chapter.title || chapter.key || '未命名章节'));
        lines.push('- 章节路径：' + (chapter.path || ''));
        lines.push('- 草稿存储：' + (chapter.storagePath || ''));
        if (chapter.savedAt) lines.push('- TXT 最近保存时间：' + chapter.savedAt);
        lines.push('- 章节 key：' + (chapter.key || ''));
        lines.push('- 来源：' + (chapter.source || ''));
        lines.push('- 当前草稿字符数：' + (chapter.chars || 0));
        if (chapter.chapterIdea) {
          lines.push('');
          lines.push('#### 章节框架 / 写作要求');
          lines.push(String(chapter.chapterIdea));
        }
        if (Array.isArray(chapter.subsections) && chapter.subsections.length > 0) {
          lines.push('');
          lines.push('#### 小节结构');
          chapter.subsections.forEach(function(sub) {
            lines.push('- ' + sub.index + '. ' + (sub.title || '未命名小节') + (sub.idea ? '：' + sub.idea : ''));
          });
        }
        if (chapter.chapterAnalysis) {
          lines.push('');
          lines.push('#### 章节图表/数据分析结果');
          lines.push(String(chapter.chapterAnalysis));
        }
        lines.push('');
        lines.push('#### 当前章节草稿');
        lines.push('```text');
        lines.push(String(chapter.content || '').trim() || '（当前章节还没有草稿正文）');
        lines.push('```');
        lines.push('');
      });
      return lines.join('\n');
    }

    async function refreshArticleDraftRegistryCacheForChat() {
      var userId = currentUserId || 'web-user';
      try {
        var response = await fetch('/api/draft/' + encodeURIComponent(userId) + '?_=' + Date.now(), { cache: 'no-store' });
        if (!response.ok) return;
        var data = await response.json();
        var primaryDrafts = parseArticleDraftPayload(data);
        var memoryDrafts = (articleDraftProgressCache.drafts || []).filter(function(draft) {
          return draft && draft.source === 'memory';
        });
        articleDraftProgressCache.drafts = mergeArticleDraftSources(primaryDrafts, memoryDrafts);
        articleDraftProgressCache.loaded = true;
        articleDraftProgressCache.userId = userId;
      } catch (error) {
        console.warn('[ArticleDraft] Failed to refresh chapter registry before chat:', error);
      }
    }

    async function attachSelectedArticleChaptersToChatContext(context) {
      await refreshArticleDraftRegistryCacheForChat();
      var availableChapters = getArticleDraftChapterTargets({ includeAllVisible: true });
      if (availableChapters.length) {
        context.articleDraftChapterRegistry = {
          available: true,
          refreshedAt: new Date().toISOString(),
          chapters: availableChapters
        };
      }
      var writingProgress = getArticleWritingProgressSnapshot();
      if (writingProgress.available) {
        context.articleWritingProgress = writingProgress;
      }
      var selected = collectSelectedArticleChapterQuestionContexts();
      if (!selected.length) return context;
      var markdown = buildSelectedArticleChapterQuestionMarkdown(selected);
      context.articleChapterQuestionContext = {
        available: true,
        count: selected.length,
        selectedAt: new Date().toISOString(),
        chapters: selected,
        contextMarkdown: markdown
      };
      markMainContextAttached(
        context,
        'articleChapterQuestionContext',
        '右侧勾选章节',
        selected.map(function(item) { return item.title || item.key; }).filter(Boolean).join('；')
      );
      return context;
    }
    window.attachSelectedArticleChaptersToChatContext = attachSelectedArticleChaptersToChatContext;

    function upsertArticleDraftProgressCache(key, title, content, metadata) {
      var draftKey = key || inferArticleChapterKey(title) || 'section';
      var info = metadata || {};
      var nextDraft = {
        chapterName: title || draftKey,
        key: draftKey,
        content: String(content || ''),
        chars: stripLatexForProgress(content).length,
        excerpt: makeArticleProgressExcerpt(content, 180),
        fileName: info.chapterFile || info.fileName || draftKey + '.txt',
        storagePath: 'drafts/' + (info.chapterFile || info.fileName || draftKey + '.txt'),
        savedAt: info.savedAt || new Date().toISOString(),
        source: 'chapter-txt'
      };
      var drafts = articleDraftProgressCache.drafts || [];
      var updated = false;
      articleDraftProgressCache.drafts = drafts.map(function(draft) {
        if ((draft.key || inferArticleChapterKey(draft.chapterName)) === draftKey) {
          updated = true;
          return nextDraft;
        }
        return draft;
      });
      if (!updated) articleDraftProgressCache.drafts.push(nextDraft);
      articleDraftProgressCache.loaded = true;
      articleDraftProgressCache.userId = currentUserId || 'web-user';
    }

    function invalidateArticleDraftProgressCache(refreshNow) {
      articleDraftProgressCache.loaded = false;
      if (articleDraftProgressCache.loading) {
        articleDraftProgressCache.reloadPending = true;
      }
      if (refreshNow !== false && getRightSidebarActiveTab() === 'article') {
        renderArticleWritingProgressPanel(true);
      }
    }
    window.invalidateArticleDraftProgressCache = invalidateArticleDraftProgressCache;

    function loadArticleDraftProgress(force) {
      var userId = currentUserId || 'web-user';
      if (!force && articleDraftProgressCache.loaded && articleDraftProgressCache.userId === userId) {
        return Promise.resolve(true);
      }
      if (articleDraftProgressCache.loading) {
        if (force) articleDraftProgressCache.reloadPending = true;
        return articleDraftProgressCache.request || Promise.resolve(false);
      }
      articleDraftProgressCache.loading = true;
      articleDraftProgressCache.reloadPending = false;
      articleDraftProgressCache.userId = userId;
      articleDraftProgressCache.lastError = '';
      var request = Promise.all([
        fetch('/api/draft/' + encodeURIComponent(userId) + '?_=' + Date.now(), { cache: 'no-store' }).then(function(response) {
          if (!response.ok) {
            return response.json().catch(function() { return null; }).then(function(payload) {
              throw new Error(payload && payload.error ? payload.error : ('草稿接口返回 HTTP ' + response.status));
            });
          }
          return response.json();
        }),
        fetch('/api/memory/' + encodeURIComponent(userId)).then(function(response) {
          return response.ok ? response.json() : null;
        }).catch(function() { return null; })
      ])
        .then(function(results) {
          var draftData = results[0] || {};
          var memoryData = results[1] || null;
          var primaryDrafts = parseArticleDraftPayload(draftData);
          var memoryResult = parseArticleMemoryDraftPayload(memoryData, draftData.chapters || []);
          articleDraftProgressCache.drafts = mergeArticleDraftSources(primaryDrafts, memoryResult.drafts);
          articleDraftProgressCache.memoryProgress = memoryResult.progress || '';
          articleDraftProgressCache.loaded = true;
          articleDraftProgressCache.lastRefreshedAt = new Date().toISOString();
          return true;
        })
        .catch(function(error) {
          console.warn('[ArticleProgress] Failed to load draft progress:', error);
          articleDraftProgressCache.lastError = error && error.message ? error.message : String(error || '刷新失败');
          articleDraftProgressCache.loaded = false;
          return false;
        })
        .finally(function() {
          articleDraftProgressCache.loading = false;
          articleDraftProgressCache.request = null;
          if (articleDraftProgressCache.reloadPending) {
            articleDraftProgressCache.reloadPending = false;
            return loadArticleDraftProgress(true);
          }
          if (getRightSidebarActiveTab() === 'article') {
            renderArticleWritingProgressPanel();
          }
        });
      articleDraftProgressCache.request = request;
      return request;
    }

    function invalidatePaperFigureLibraryCache(refreshNow) {
      paperFigureLibraryCache.loaded = false;
      if (refreshNow !== false && getRightSidebarActiveTab() === 'figures') {
        renderPaperFigureLibraryPanel(true);
      }
    }
    window.invalidatePaperFigureLibraryCache = invalidatePaperFigureLibraryCache;

    function loadPaperFigureLibrary(force) {
      var userId = currentUserId || 'web-user';
      if (!force && paperFigureLibraryCache.loaded && paperFigureLibraryCache.userId === userId) {
        return Promise.resolve(true);
      }
      if (paperFigureLibraryCache.loading) return paperFigureLibraryCache.request || Promise.resolve(false);
      paperFigureLibraryCache.loading = true;
      paperFigureLibraryCache.userId = userId;
      paperFigureLibraryCache.lastError = '';
      var request = fetch('/api/draft-assets/figures?userId=' + encodeURIComponent(userId) + '&_=' + Date.now(), { cache: 'no-store' })
        .then(function(response) {
          return response.json().catch(function() { return {}; }).then(function(payload) {
            if (!response.ok || !payload.success) throw new Error(payload.error || ('HTTP ' + response.status));
            return payload;
          });
        })
        .then(function(payload) {
          paperFigureLibraryCache.figures = Array.isArray(payload.figures) ? payload.figures : [];
          var availableIds = new Set(paperFigureLibraryCache.figures.map(function(asset) {
            return String(asset && asset.id || '');
          }).filter(Boolean));
          Array.from(selectedPaperFigureIds).forEach(function(assetId) {
            if (!availableIds.has(assetId)) selectedPaperFigureIds.delete(assetId);
          });
          paperFigureLibraryCache.loaded = true;
          paperFigureLibraryCache.lastRefreshedAt = new Date().toISOString();
          return true;
        })
        .catch(function(error) {
          paperFigureLibraryCache.lastError = error && error.message ? error.message : String(error || '读取失败');
          paperFigureLibraryCache.loaded = false;
          return false;
        })
        .finally(function() {
          paperFigureLibraryCache.loading = false;
          paperFigureLibraryCache.request = null;
          if (getRightSidebarActiveTab() === 'figures') renderPaperFigureLibraryPanel();
        });
      paperFigureLibraryCache.request = request;
      return request;
    }

    function renderPaperFigureLibraryPanel(forceReload) {
      var panel = document.getElementById('paperFigureLibraryPanel');
      var meta = document.getElementById('articleWritingProgressMeta');
      var refreshButton = document.getElementById('paperFigureRefreshButton');
      if (!panel) return;
      if (forceReload === true) paperFigureLibraryCache.loaded = false;
      loadPaperFigureLibrary(forceReload === true);
      var figures = Array.isArray(paperFigureLibraryCache.figures) ? paperFigureLibraryCache.figures : [];
      if (meta && getRightSidebarActiveTab() === 'figures') {
        meta.textContent = paperFigureLibraryCache.loading ? '正在读取...' : figures.length + ' 张图片';
      }
      if (refreshButton) {
        refreshButton.disabled = paperFigureLibraryCache.loading;
        refreshButton.textContent = paperFigureLibraryCache.loading ? '刷新中...' : '刷新';
      }
      var selectedCount = figures.filter(function(asset) {
        return selectedPaperFigureIds.has(String(asset && asset.id || ''));
      }).length;
      var allSelected = figures.length > 0 && selectedCount === figures.length;
      var html = (paperFigureLibraryCache.lastError ? '<div class="article-structure-save-state">读取失败：' + escapeHtml(paperFigureLibraryCache.lastError) + '</div>' : '') +
        '<div class="paper-figure-library-selection">' +
          '<label class="paper-figure-library-select-all">' +
            '<input id="paperFigureSelectAll" type="checkbox" onchange="toggleAllPaperFigureSelection(this.checked)"' + (allSelected ? ' checked' : '') + (figures.length ? '' : ' disabled') + '>' +
            '<span>全选</span>' +
          '</label>' +
          '<span class="paper-figure-library-selection-count" id="paperFigureSelectionCount">已选 ' + selectedCount + ' / ' + figures.length + '</span>' +
          '<button type="button" class="article-structure-mini-btn" id="paperFigureMergeSelectedBtn" onclick="showPaperFigureMergeDialog()"' + (selectedCount >= 2 ? '' : ' disabled') + '>合并</button>' +
          '<button type="button" class="article-structure-mini-btn" id="paperFigureDeleteSelectedBtn" onclick="deleteSelectedPaperFigures()"' + (selectedCount ? '' : ' disabled') + '>删除</button>' +
        '</div>' +
        '<div class="paper-figure-library-list">';
      if (!figures.length) {
        html += '<div class="article-progress-empty">暂无论文图片。上传图片时勾选“保存到右侧论文图片”，并填写图号、标题和图注。</div>';
      }
      figures.forEach(function(asset) {
        var assetId = String(asset.id || '');
        var previewUrl = String(asset.url || '') + (String(asset.url || '').indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(asset.createdAt || Date.now());
        var title = String(asset.title || '').trim() || String(asset.caption || '').trim() || String(asset.figureLabel || 'Figure');
        var caption = String(asset.caption || '').trim();
        var linkedToDraft = asset.draftLinked === true || (asset.draftLinked === undefined && asset.chapterKey && asset.chapterKey !== 'paper-figures');
        var chapterText = linkedToDraft ? ('已写入 ' + (asset.chapterName || asset.chapterKey || '章节')) : '独立论文图片';
        var selected = selectedPaperFigureIds.has(assetId);
        html += '<article class="paper-figure-library-card' + (selected ? ' selected' : '') + '" data-paper-figure-id="' + escapeHtml(assetId) + '">' +
          '<label class="paper-figure-library-checkbox" title="选择这张图片">' +
            '<input type="checkbox" aria-label="选择 ' + escapeHtml(title) + '" onchange="togglePaperFigureSelection(this)"' + (selected ? ' checked' : '') + '>' +
          '</label>' +
          '<button type="button" class="paper-figure-library-preview" data-file-path="' + escapeHtml(asset.filePath || '') + '" data-preview-url="' + escapeHtml(previewUrl) + '" data-file-name="' + escapeHtml(asset.fileName || title) + '" data-file-kind="image" onclick="previewOutputAttachment(this)" title="在软件内查看图片">' +
            '<img src="' + escapeHtml(previewUrl) + '" alt="' + escapeHtml(title) + '" loading="lazy" decoding="async">' +
          '</button>' +
          '<div class="paper-figure-library-body">' +
            '<div class="paper-figure-library-view">' +
              '<div class="paper-figure-library-label">' + escapeHtml(asset.figureLabel || 'Figure') + '</div>' +
              '<div class="paper-figure-library-title">' + escapeHtml(title) + '</div>' +
              (caption && caption !== title ? '<div class="paper-figure-library-caption">' + escapeHtml(caption) + '</div>' : '') +
              '<div class="paper-figure-library-meta">' + escapeHtml(asset.fileName || '') + ' · ' + escapeHtml(chapterText) + '</div>' +
            '</div>' +
            '<div class="paper-figure-library-edit" style="display:none;">' +
              '<input data-paper-figure-field="figureLabel" value="' + escapeHtml(asset.figureLabel || '') + '" placeholder="图号，如 Figure 2(a)">' +
              '<input data-paper-figure-field="title" value="' + escapeHtml(asset.title || '') + '" placeholder="图片标题">' +
              '<textarea data-paper-figure-field="caption" placeholder="完整图注">' + escapeHtml(asset.caption || '') + '</textarea>' +
            '</div>' +
            '<div class="paper-figure-library-actions">' +
              '<button type="button" class="article-structure-mini-btn" data-file-path="' + escapeHtml(asset.filePath || '') + '" data-preview-url="' + escapeHtml(previewUrl) + '" onclick="openOutputAttachmentFile(this)">打开</button>' +
              '<button type="button" class="article-structure-mini-btn" data-paper-figure-action="edit" onclick="togglePaperFigureEdit(this, true)">编辑</button>' +
              '<button type="button" class="article-structure-mini-btn primary" data-paper-figure-action="save" onclick="savePaperFigureMetadata(this)" style="display:none;">保存</button>' +
              '<button type="button" class="article-structure-mini-btn" data-paper-figure-action="cancel" onclick="togglePaperFigureEdit(this, false)" style="display:none;">取消</button>' +
            '</div>' +
          '</div>' +
        '</article>';
      });
      html += '</div>';
      panel.innerHTML = html;
      syncPaperFigureSelectionUi();
    }
    window.renderPaperFigureLibraryPanel = renderPaperFigureLibraryPanel;

    function getSelectedPaperFigureAssets() {
      var figures = Array.isArray(paperFigureLibraryCache.figures) ? paperFigureLibraryCache.figures : [];
      return figures.filter(function(asset) {
        return selectedPaperFigureIds.has(String(asset && asset.id || ''));
      });
    }

    function syncPaperFigureSelectionUi() {
      var panel = document.getElementById('paperFigureLibraryPanel');
      if (!panel) return;
      var figures = Array.isArray(paperFigureLibraryCache.figures) ? paperFigureLibraryCache.figures : [];
      var availableIds = new Set(figures.map(function(asset) {
        return String(asset && asset.id || '');
      }).filter(Boolean));
      Array.from(selectedPaperFigureIds).forEach(function(assetId) {
        if (!availableIds.has(assetId)) selectedPaperFigureIds.delete(assetId);
      });
      var selectedCount = selectedPaperFigureIds.size;
      panel.querySelectorAll('.paper-figure-library-card').forEach(function(card) {
        var assetId = card.getAttribute('data-paper-figure-id') || '';
        var selected = selectedPaperFigureIds.has(assetId);
        card.classList.toggle('selected', selected);
        var checkbox = card.querySelector('.paper-figure-library-checkbox input');
        if (checkbox) checkbox.checked = selected;
      });
      var selectAll = document.getElementById('paperFigureSelectAll');
      if (selectAll) {
        selectAll.checked = figures.length > 0 && selectedCount === figures.length;
        selectAll.indeterminate = selectedCount > 0 && selectedCount < figures.length;
      }
      var count = document.getElementById('paperFigureSelectionCount');
      if (count) count.textContent = '已选 ' + selectedCount + ' / ' + figures.length;
      var mergeButton = document.getElementById('paperFigureMergeSelectedBtn');
      if (mergeButton) mergeButton.disabled = paperFigureMergeInProgress || selectedCount < 2;
      var deleteButton = document.getElementById('paperFigureDeleteSelectedBtn');
      if (deleteButton) deleteButton.disabled = paperFigureMergeInProgress || selectedCount < 1;
    }

    function togglePaperFigureSelection(input, checked) {
      var card = input && input.closest ? input.closest('.paper-figure-library-card') : null;
      var assetId = card ? (card.getAttribute('data-paper-figure-id') || '') : String(input || '');
      var nextChecked = card ? !!input.checked : !!checked;
      if (!assetId) return;
      if (nextChecked) selectedPaperFigureIds.add(assetId);
      else selectedPaperFigureIds.delete(assetId);
      syncPaperFigureSelectionUi();
    }
    window.togglePaperFigureSelection = togglePaperFigureSelection;

    function toggleAllPaperFigureSelection(checked) {
      var figures = Array.isArray(paperFigureLibraryCache.figures) ? paperFigureLibraryCache.figures : [];
      selectedPaperFigureIds.clear();
      if (checked) {
        figures.forEach(function(asset) {
          var assetId = String(asset && asset.id || '');
          if (assetId) selectedPaperFigureIds.add(assetId);
        });
      }
      syncPaperFigureSelectionUi();
    }
    window.toggleAllPaperFigureSelection = toggleAllPaperFigureSelection;

    async function deleteSelectedPaperFigures() {
      var assets = getSelectedPaperFigureAssets();
      if (!assets.length) return;
      var promptText = '确定删除已选择的 ' + assets.length + ' 张论文图片吗？删除后文件和图片库记录都会移除。';
      if (typeof confirm === 'function' && !confirm(promptText)) return;
      paperFigureMergeInProgress = true;
      syncPaperFigureSelectionUi();
      try {
        var response = await fetch('/api/draft-assets/figures', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId || 'web-user',
            assetIds: assets.map(function(asset) { return String(asset.id || ''); })
          })
        });
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success) throw new Error(result.error || ('HTTP ' + response.status));
        selectedPaperFigureIds.clear();
        invalidatePaperFigureLibraryCache(false);
        await loadPaperFigureLibrary(true);
      } catch (error) {
        alert('批量删除论文图片失败：' + (error && error.message ? error.message : error));
      } finally {
        paperFigureMergeInProgress = false;
        syncPaperFigureSelectionUi();
      }
    }
    window.deleteSelectedPaperFigures = deleteSelectedPaperFigures;

    function loadPaperFigureMergeImage(asset) {
      return new Promise(function(resolve, reject) {
        var image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = function() { resolve(image); };
        image.onerror = function() {
          reject(new Error('无法读取图片：' + String(asset && (asset.fileName || asset.title || asset.id) || '未知图片')));
        };
        var url = String(asset && asset.url || '');
        image.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'merge=' + Date.now();
      });
    }

    async function composePaperFigureCanvas(assetIds, options) {
      var requestedIds = Array.isArray(assetIds) ? assetIds.map(String) : [];
      var assets = (Array.isArray(paperFigureLibraryCache.figures) ? paperFigureLibraryCache.figures : []).filter(function(asset) {
        return requestedIds.indexOf(String(asset && asset.id || '')) >= 0;
      });
      assets.sort(function(left, right) {
        return requestedIds.indexOf(String(left && left.id || '')) - requestedIds.indexOf(String(right && right.id || ''));
      });
      if (assets.length < 2) throw new Error('至少选择两张图片才能合并');
      var images = await Promise.all(assets.map(loadPaperFigureMergeImage));
      var settings = options && typeof options === 'object' ? options : {};
      var columns = Math.max(1, Math.min(Number(settings.columns || Math.ceil(Math.sqrt(images.length))) || 1, Math.min(5, images.length)));
      var rows = Math.ceil(images.length / columns);
      var cellWidth = Math.min(1400, Math.max.apply(Math, images.map(function(image) { return image.naturalWidth || image.width || 800; })));
      var cellHeight = Math.min(1000, Math.max.apply(Math, images.map(function(image) { return image.naturalHeight || image.height || 600; })));
      var showLabels = settings.showLabels !== false;
      var gap = 18;
      var labelHeight = showLabels ? 42 : 0;
      var rawWidth = columns * cellWidth + Math.max(0, columns - 1) * gap;
      var rawHeight = rows * (cellHeight + labelHeight) + Math.max(0, rows - 1) * gap;
      var maxPixels = 16000000;
      var scale = Math.min(1, 5000 / rawWidth, 5000 / rawHeight, Math.sqrt(maxPixels / (rawWidth * rawHeight)));
      cellWidth = Math.max(160, Math.floor(cellWidth * scale));
      cellHeight = Math.max(120, Math.floor(cellHeight * scale));
      gap = Math.max(4, Math.floor(gap * scale));
      labelHeight = showLabels ? Math.max(24, Math.floor(labelHeight * scale)) : 0;

      var canvas = document.createElement('canvas');
      canvas.width = columns * cellWidth + Math.max(0, columns - 1) * gap;
      canvas.height = rows * (cellHeight + labelHeight) + Math.max(0, rows - 1) * gap;
      var context = canvas.getContext('2d');
      if (!context) throw new Error('当前环境无法创建图片合并画布');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      images.forEach(function(image, index) {
        var column = index % columns;
        var row = Math.floor(index / columns);
        var cellX = column * (cellWidth + gap);
        var cellY = row * (cellHeight + labelHeight + gap);
        var naturalWidth = image.naturalWidth || image.width || cellWidth;
        var naturalHeight = image.naturalHeight || image.height || cellHeight;
        var imageScale = Math.min(cellWidth / naturalWidth, cellHeight / naturalHeight);
        var drawWidth = Math.max(1, Math.floor(naturalWidth * imageScale));
        var drawHeight = Math.max(1, Math.floor(naturalHeight * imageScale));
        var drawX = cellX + Math.floor((cellWidth - drawWidth) / 2);
        var drawY = cellY + labelHeight + Math.floor((cellHeight - drawHeight) / 2);
        context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
        if (showLabels) {
          context.fillStyle = '#111111';
          context.font = '700 ' + Math.max(16, Math.floor(labelHeight * 0.52)) + 'px Arial, sans-serif';
          context.textBaseline = 'middle';
          context.fillText('(' + String.fromCharCode(97 + index) + ')', cellX + 4, cellY + Math.floor(labelHeight / 2));
        }
      });
      return canvas;
    }
    window.composePaperFigureCanvas = composePaperFigureCanvas;

    function showPaperFigureMergeDialog() {
      var assets = getSelectedPaperFigureAssets();
      if (assets.length < 2) {
        alert('请至少选择两张图片后再合并。');
        return;
      }
      var suggestedColumns = Math.min(3, Math.ceil(Math.sqrt(assets.length)));
      var selectedSummary = assets.map(function(asset, index) {
        return '<div style="padding:6px 8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-primary);">' +
          '<strong>(' + String.fromCharCode(97 + index) + ')</strong> ' +
          escapeHtml(asset.figureLabel || asset.title || asset.fileName || ('图片 ' + (index + 1))) +
        '</div>';
      }).join('');
      var html = '<div style="display:grid;gap:12px;">' +
        '<div style="font-size:12px;line-height:1.6;color:var(--text-secondary);">将按当前图片库顺序合并 ' + assets.length + ' 张图片；原图片会保留，合并结果作为一张新图片加入论文图片库。</div>' +
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;">' + selectedSummary + '</div>' +
        '<div style="display:grid;grid-template-columns:minmax(0,0.7fr) minmax(0,1.3fr);gap:8px;">' +
          '<label style="display:grid;gap:4px;font-size:12px;">图号<input id="paperFigureMergeLabel" value="Figure" style="padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-primary);color:var(--text-primary);"></label>' +
          '<label style="display:grid;gap:4px;font-size:12px;">标题<input id="paperFigureMergeTitle" value="Merged figure" style="padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-primary);color:var(--text-primary);"></label>' +
        '</div>' +
        '<label style="display:grid;gap:4px;font-size:12px;">图注<textarea id="paperFigureMergeCaption" style="min-height:76px;padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-primary);color:var(--text-primary);resize:vertical;"></textarea></label>' +
        '<div style="display:flex;align-items:center;gap:14px;">' +
          '<label style="display:flex;align-items:center;gap:6px;font-size:12px;">每行列数 <input id="paperFigureMergeColumns" type="number" min="1" max="5" value="' + suggestedColumns + '" style="width:62px;padding:6px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-primary);color:var(--text-primary);"></label>' +
          '<label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input id="paperFigureMergeLabels" type="checkbox" checked> 添加 (a)、(b) 小图标签</label>' +
        '</div>' +
        '<div id="paperFigureMergeStatus" style="min-height:18px;font-size:12px;color:var(--text-secondary);"></div>' +
        '<div class="btns"><button class="cancel" type="button" onclick="closeModal()">取消</button><button class="ok" type="button" id="paperFigureMergeConfirmBtn" onclick="createMergedPaperFigure()">生成合并图片</button></div>' +
      '</div>';
      showModal('合并论文图片', html, true, false);
    }
    window.showPaperFigureMergeDialog = showPaperFigureMergeDialog;

    async function createMergedPaperFigure() {
      if (paperFigureMergeInProgress) return;
      var assets = getSelectedPaperFigureAssets();
      if (assets.length < 2) {
        alert('选择的图片已经变化，请重新选择。');
        closeModal();
        return;
      }
      var button = document.getElementById('paperFigureMergeConfirmBtn');
      var status = document.getElementById('paperFigureMergeStatus');
      paperFigureMergeInProgress = true;
      if (button) button.disabled = true;
      if (status) status.textContent = '正在读取原图并生成合并图片...';
      try {
        var canvas = await composePaperFigureCanvas(assets.map(function(asset) { return String(asset.id || ''); }), {
          columns: Number(document.getElementById('paperFigureMergeColumns') && document.getElementById('paperFigureMergeColumns').value || 2),
          showLabels: !!(document.getElementById('paperFigureMergeLabels') && document.getElementById('paperFigureMergeLabels').checked)
        });
        if (status) status.textContent = '正在保存合并图片...';
        var response = await fetch('/api/draft-assets/figures/merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId || 'web-user',
            assetIds: assets.map(function(asset) { return String(asset.id || ''); }),
            figureLabel: String(document.getElementById('paperFigureMergeLabel') && document.getElementById('paperFigureMergeLabel').value || 'Figure'),
            title: String(document.getElementById('paperFigureMergeTitle') && document.getElementById('paperFigureMergeTitle').value || 'Merged figure'),
            caption: String(document.getElementById('paperFigureMergeCaption') && document.getElementById('paperFigureMergeCaption').value || ''),
            dataUrl: canvas.toDataURL('image/png')
          })
        });
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success) throw new Error(result.error || ('HTTP ' + response.status));
        selectedPaperFigureIds.clear();
        closeModal();
        invalidatePaperFigureLibraryCache(false);
        await loadPaperFigureLibrary(true);
      } catch (error) {
        if (status) status.textContent = '合并失败：' + (error && error.message ? error.message : error);
        if (button) button.disabled = false;
      } finally {
        paperFigureMergeInProgress = false;
        syncPaperFigureSelectionUi();
      }
    }
    window.createMergedPaperFigure = createMergedPaperFigure;

    function togglePaperFigureEdit(button, editing) {
      var card = button && button.closest ? button.closest('.paper-figure-library-card') : null;
      if (!card) return;
      var view = card.querySelector('.paper-figure-library-view');
      var edit = card.querySelector('.paper-figure-library-edit');
      if (view) view.style.display = editing ? 'none' : '';
      if (edit) edit.style.display = editing ? 'grid' : 'none';
      ['edit', 'save', 'cancel'].forEach(function(action) {
        var actionButton = card.querySelector('[data-paper-figure-action="' + action + '"]');
        if (!actionButton) return;
        actionButton.style.display = action === 'edit' ? (editing ? 'none' : '') : (editing ? '' : 'none');
      });
    }
    window.togglePaperFigureEdit = togglePaperFigureEdit;

    async function savePaperFigureMetadata(button) {
      var card = button && button.closest ? button.closest('.paper-figure-library-card') : null;
      if (!card) return;
      var assetId = card.getAttribute('data-paper-figure-id') || '';
      var payload = { userId: currentUserId || 'web-user' };
      card.querySelectorAll('[data-paper-figure-field]').forEach(function(input) {
        payload[input.getAttribute('data-paper-figure-field')] = input.value || '';
      });
      button.disabled = true;
      try {
        var response = await fetch('/api/draft-assets/figures/' + encodeURIComponent(assetId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success) throw new Error(result.error || ('HTTP ' + response.status));
        invalidatePaperFigureLibraryCache(false);
        await loadPaperFigureLibrary(true);
      } catch (error) {
        alert('保存图片信息失败：' + (error.message || error));
        button.disabled = false;
      }
    }
    window.savePaperFigureMetadata = savePaperFigureMetadata;

    function renderArticleWritingProgressPanelLegacy(forceDraftReload) {
      var panel = document.getElementById('articleWritingProgressPanel');
      var meta = document.getElementById('discussionFrameworkMeta');
      if (!panel) return;
      if (forceDraftReload === true) {
        articleDraftProgressCache.loaded = false;
      }
      loadArticleDraftProgress(forceDraftReload === true);

      var memoryProgress = articleDraftProgressCache.memoryProgress || '';
      var items = getArticleWritingProgressItemsForContext();

      var totalChapters = items.length;
      var totalSubsections = 0;
      var plannedSubsections = 0;
      var draftedChapters = 0;
      items.forEach(function(item) {
        var chapter = item.chapter || {};
        var subsections = Array.isArray(chapter.subsections) ? chapter.subsections : [];
        if (item.draft) draftedChapters++;
        totalSubsections += subsections.length;
        plannedSubsections += subsections.filter(function(sub) {
          return !!String(sub.idea || '').trim();
        }).length;
      });
      var writingProgress = getArticleWritingProgressSnapshot();
      var activeWritingTarget = writingProgress.activeTarget;
      var completedChapters = writingProgress.completedChapterCount || 0;

      if (meta && getRightSidebarActiveTab() === 'article') {
        meta.textContent = totalChapters + ' 章 / ' + totalSubsections + ' 小节 / 完成 ' + completedChapters + ' / 草稿 ' + draftedChapters;
      }

      var html = '<div class="article-structure-toolbar">' +
          '<div><strong>真实文章结构</strong><br>每章对应一个 TXT。“正在写”是可取消的手动锁定；未锁定时 AI 自动识别保存章节。</div>' +
          '<div class="article-structure-actions">' +
            '<button type="button" class="article-structure-btn" id="articleWritingProgressRefreshBtn" onclick="refreshArticleWritingProgress()"' + (articleDraftProgressCache.refreshing ? ' disabled' : '') + '>' + (articleDraftProgressCache.refreshing ? '刷新中...' : '刷新') + '</button>' +
            '<button type="button" class="article-structure-btn" onclick="setRightSidebarTab(\'discussion\')">编辑框架</button>' +
          '</div>' +
        '</div>' +
        '<div class="article-writing-target-summary">' +
          (activeWritingTarget
            ? '<strong>手动锁定：</strong>' + escapeHtml(activeWritingTarget.chapterTitle || activeWritingTarget.chapterKey) + (activeWritingTarget.subsectionTitle ? ' / ' + escapeHtml(activeWritingTarget.subsectionTitle) : ' / 章节正文') +
              '<button type="button" class="article-structure-mini-btn" onclick="clearArticleWritingTarget()" title="取消手动锁定，恢复 AI 自动识别">取消当前</button>'
            : '<strong>保存模式：</strong>AI 自动识别章节（也可勾选“正在写”进行手动锁定）') +
          '　<strong>已完成章节：</strong>' + completedChapters + '/' + totalChapters +
        '</div>' +
        (articleDraftProgressCache.lastError
          ? '<div class="article-structure-save-state">刷新失败：' + escapeHtml(articleDraftProgressCache.lastError) + '</div>'
          : (articleDraftProgressCache.lastRefreshedAt
            ? '<div class="article-structure-save-state">已读取章节 TXT · ' + escapeHtml(new Date(articleDraftProgressCache.lastRefreshedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })) + '</div>'
            : '')) +
        '<div class="article-structure-list">';

      if (!items.length) {
        html += '<div class="article-progress-empty">当前还没有文章结构或草稿。切换到“讨论式写作”页添加章节，或让 AI 生成并保存草稿后，这里会显示真实文章内容。</div>';
      } else if (memoryProgress) {
        html += '<div class="article-structure-frame">草稿进度摘要：' + escapeHtml(makeArticleProgressExcerpt(memoryProgress, 220)) + '</div>';
      }

      items.forEach(function(item, itemIndex) {
        var chapter = item.chapter || {};
        var chapterIndex = item.chapterIndex;
        var subsections = Array.isArray(chapter.subsections) ? chapter.subsections : [];
        var draft = item.draft;
        var chapterHasPlan = !!String(chapter.idea || '').trim();
        var chapterHasAnalysis = !!String(chapter.analysis || '').trim();
        var filledSubsections = subsections.filter(function(sub) { return !!String(sub.idea || '').trim(); }).length;
        var draftContent = draft ? String(draft.content || '') : '';
        var draftChars = draft ? draft.chars : 0;
        var status = draft ? (draft.source === 'memory' ? '长期记忆草稿' : '草稿已保存') : (item.type === 'framework' ? '框架待成稿' : '草稿');
        var saveKey = item.key || inferArticleChapterKey(item.title) || ('chapter_' + (itemIndex + 1));
        var saveDomId = 'articleDraftSaveState_' + getArticleDraftDomId(saveKey);
        var textareaDomId = 'articleDraftContent_' + getArticleDraftDomId(saveKey) + '_' + itemIndex;
        var questionSelected = isArticleChapterSelectedForQuestion(saveKey, item.title);
        var frameworkChapterId = chapter.id || '';
        var progressRecord = (writingProgress.chapters || []).find(function(record) { return record.key === saveKey; }) || {};
        var isCurrentChapter = progressRecord.current === true;
        var isCompletedChapter = progressRecord.completed === true;
        var progressStatus = isCompletedChapter
          ? '已完成'
          : (isCurrentChapter || progressRecord.status === 'in_progress'
              ? '写作中'
              : (progressRecord.drafted ? '已有草稿' : '未开始'));
        html += '<div class="article-structure-chapter' + (isCurrentChapter ? ' current-writing-target' : '') + (isCompletedChapter ? ' chapter-completed' : '') + '">' +
          '<div class="article-structure-chapter-head">' +
            '<div class="article-structure-title">' + (itemIndex + 1) + '. ' + escapeHtml(item.title || '未命名章节') + '</div>' +
            '<div class="article-structure-head-actions">' +
              '<label class="article-structure-question-toggle' + (questionSelected ? ' active' : '') + '" title="勾选后，本章路径和内容会随下一次提问发送给 AI">' +
                '<input type="checkbox" data-article-question-key="' + escapeHtml(saveKey) + '" data-article-question-title="' + escapeHtml(item.title || saveKey) + '" onchange="toggleArticleChapterForQuestion(this)"' + (questionSelected ? ' checked' : '') + '>' +
                '<span>随问</span>' +
              '</label>' +
              (subsections.length === 0
                ? '<label class="article-structure-question-toggle article-structure-current-toggle' + (isCurrentChapter ? ' active' : '') + '" title="设为当前写作章节">' +
                    '<input type="checkbox" onchange="toggleArticleWritingTarget(this, decodeURIComponent(\'' + encodeURIComponent(saveKey) + '\'), decodeURIComponent(\'' + encodeURIComponent(frameworkChapterId) + '\'), \'\')"' + (isCurrentChapter ? ' checked' : '') + '>' +
                    '<span>正在写</span>' +
                  '</label>'
                : '') +
              '<label class="article-structure-question-toggle article-structure-complete-toggle' + (isCompletedChapter ? ' active' : '') + '" title="记录本章是否已经写完">' +
                '<input type="checkbox" data-article-complete-key="' + escapeHtml(saveKey) + '" data-article-framework-id="' + escapeHtml(frameworkChapterId) + '" onchange="toggleArticleChapterCompleted(this)"' + (isCompletedChapter ? ' checked' : '') + '>' +
                '<span>完成</span>' +
              '</label>' +
              '<label class="article-structure-question-toggle article-structure-delete-toggle" title="勾选后删除本章框架和分章节草稿">' +
                '<input type="checkbox" data-article-delete-key="' + escapeHtml(saveKey) + '" data-article-delete-title="' + escapeHtml(item.title || saveKey) + '" data-article-framework-id="' + escapeHtml(frameworkChapterId) + '" onchange="deleteArticleWritingProgressChapter(this)">' +
                '<span>删除</span>' +
              '</label>' +
              '<span class="article-structure-badge">' + escapeHtml(progressStatus) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="article-progress-chapter-meta">文件 ' + escapeHtml(draft && draft.fileName ? draft.fileName : saveKey + '.txt') + '；小节 ' + subsections.length + ' 个；章节草稿 ' + draftChars + ' 字符</div>' +
          '<div class="article-structure-section">' +
            '<div class="article-structure-label">章节框架 / 写作要求</div>' +
            (chapterHasPlan ? '<div class="article-structure-frame">' + escapeHtml(chapter.idea) + '</div>' : '<div class="article-structure-empty">还没有章节框架。点击“编辑框架”补充章节写作思路。</div>') +
          '</div>';

        html += '<div class="article-structure-section">' +
          '<div class="article-structure-label">小节结构和内容要求</div>' +
          '<div class="article-structure-subsections">';
        if (!subsections.length) {
          html += '<div class="article-structure-empty">本章还没有小节结构。</div>';
        }
        subsections.forEach(function(sub, subIndex) {
          var hasIdea = !!String(sub.idea || '').trim();
          var isCurrentSubsection = isCurrentChapter && activeWritingTarget && String(activeWritingTarget.subsectionId || '') === String(sub.id || '');
          html += '<div class="article-structure-subsection' + (isCurrentSubsection ? ' current-writing-target' : '') + '">' +
            '<div class="article-structure-subsection-head">' +
              '<div class="article-structure-subsection-title">' + (itemIndex + 1) + '.' + (subIndex + 1) + ' ' + escapeHtml(sub.title || '未命名小节') + '</div>' +
              '<label class="article-structure-question-toggle article-structure-current-toggle' + (isCurrentSubsection ? ' active' : '') + '" title="AI 下一次保存只会写入这个章节和小节">' +
                '<input type="checkbox" onchange="toggleArticleWritingTarget(this, decodeURIComponent(\'' + encodeURIComponent(saveKey) + '\'), decodeURIComponent(\'' + encodeURIComponent(frameworkChapterId) + '\'), decodeURIComponent(\'' + encodeURIComponent(String(sub.id || '')) + '\'))"' + (isCurrentSubsection ? ' checked' : '') + '>' +
                '<span>正在写</span>' +
              '</label>' +
            '</div>' +
            (hasIdea ? '<div class="article-progress-text">' + escapeHtml(sub.idea) + '</div>' : '<div class="article-structure-empty">还没有填写这个小节要写什么。</div>') +
          '</div>';
        });
        html += '</div></div>';

        if (chapterHasAnalysis) {
          html += '<div class="article-structure-section">' +
            '<div class="article-structure-label">章节图表/数据分析结果</div>' +
            '<div class="article-structure-frame">' + escapeHtml(chapter.analysis) + '</div>' +
          '</div>';
        }

        html += '<div class="article-structure-section">' +
          '<div class="article-structure-label article-structure-label-row">' +
            '<span>章节全文草稿</span>' +
            '<span class="article-structure-edit-actions">' +
              '<button type="button" class="article-structure-mini-btn" data-article-draft-target="' + escapeHtml(textareaDomId) + '" onclick="enableArticleChapterDraftEdit(this)">编辑</button>' +
              '<button type="button" class="article-structure-mini-btn primary" data-article-draft-target="' + escapeHtml(textareaDomId) + '" onclick="saveArticleChapterDraftEdit(this)" style="display:none;">保存</button>' +
              '<button type="button" class="article-structure-mini-btn" data-article-draft-target="' + escapeHtml(textareaDomId) + '" onclick="cancelArticleChapterDraftEdit(this)" style="display:none;">取消</button>' +
            '</span>' +
          '</div>' +
          '<textarea id="' + escapeHtml(textareaDomId) + '" class="article-structure-content" data-article-chapter-key="' + escapeHtml(saveKey) + '" data-article-chapter-title="' + escapeHtml(item.title || saveKey) + '" data-article-save-state-id="' + escapeHtml(saveDomId) + '" readonly placeholder="这一章的正式草稿内容会显示在这里。AI 生成并保存草稿后会自动写入；点击编辑可手动修改并保存。">' + escapeHtml(draftContent) + '</textarea>' +
          '<div class="article-structure-save-state" id="' + escapeHtml(saveDomId) + '">' + (draft ? '已加载 ' + escapeHtml(draft.fileName || saveKey + '.txt') : '暂无章节 TXT') + '</div>' +
        '</div></div>';
      });
      html += '</div>';
      panel.innerHTML = html;
    }
    function renderArticleWritingProgressPanel(forceDraftReload) {
      var panel = document.getElementById('articleWritingProgressPanel');
      var meta = document.getElementById('articleWritingProgressMeta');
      if (!panel) return;
      if (forceDraftReload === true) articleDraftProgressCache.loaded = false;
      loadArticleDraftProgress(forceDraftReload === true);

      var items = getArticleWritingProgressItemsForContext();
      var totalChars = items.reduce(function(sum, item) {
        return sum + Number(item && item.draft ? item.draft.chars || 0 : 0);
      }, 0);
      if (meta && getRightSidebarActiveTab() === 'article') {
        meta.textContent = items.length + ' 个章节 TXT / ' + totalChars + ' 字符';
      }

      var html = '<div class="article-structure-toolbar">' +
          '<div><strong>章节 TXT</strong></div>' +
          '<div class="article-structure-actions">' +
            '<button type="button" class="article-structure-btn" id="articleWritingProgressRefreshBtn" onclick="refreshArticleWritingProgress()"' + (articleDraftProgressCache.refreshing ? ' disabled' : '') + '>' + (articleDraftProgressCache.refreshing ? '刷新中...' : '刷新') + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="article-writing-target-summary"><strong>写作进度：</strong>已保存 ' + items.length + ' 个章节 TXT，共 ' + totalChars + ' 字符</div>' +
        (articleDraftProgressCache.lastError
          ? '<div class="article-structure-save-state">刷新失败：' + escapeHtml(articleDraftProgressCache.lastError) + '</div>'
          : (articleDraftProgressCache.lastRefreshedAt
            ? '<div class="article-structure-save-state">已读取章节 TXT · ' + escapeHtml(new Date(articleDraftProgressCache.lastRefreshedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })) + '</div>'
            : '')) +
        '<div class="article-structure-list">';

      if (!items.length) {
        html += '<div class="article-progress-empty">暂无章节 TXT。</div>';
      }

      items.forEach(function(item, itemIndex) {
        var draft = item.draft || {};
        var saveKey = item.key || inferArticleChapterKey(item.title) || ('chapter_' + (itemIndex + 1));
        var title = item.title || saveKey || '未命名章节';
        var questionSelected = isArticleChapterSelectedForQuestion(saveKey, title);
        var status = 'TXT 已保存';
        var savedAt = draft.savedAt ? String(draft.savedAt) : '';
        var savedLabel = '';
        if (savedAt) {
          var savedDate = new Date(savedAt);
          savedLabel = Number.isNaN(savedDate.getTime()) ? savedAt : savedDate.toLocaleString('zh-CN');
        }
        html += '<section class="article-structure-chapter">' +
          '<div class="article-structure-chapter-head">' +
            '<div class="article-structure-title">' + (itemIndex + 1) + '. ' + escapeHtml(title) + '</div>' +
            '<div class="article-structure-head-actions">' +
              '<label class="article-structure-question-toggle' + (questionSelected ? ' active' : '') + '" title="随下一次提问发送本章 TXT 内容">' +
                '<input type="checkbox" data-article-question-key="' + escapeHtml(saveKey) + '" data-article-question-title="' + escapeHtml(title) + '" onchange="toggleArticleChapterForQuestion(this)"' + (questionSelected ? ' checked' : '') + '>' +
                '<span>随问</span>' +
              '</label>' +
              '<span class="article-structure-badge">' + escapeHtml(status) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="article-progress-chapter-meta">' + escapeHtml(draft.fileName || (saveKey + '.txt')) + ' · ' + Number(draft.chars || 0) + ' 字符' + (savedLabel ? ' · ' + escapeHtml(savedLabel) : '') + '</div>' +
          '<div class="article-draft-readonly-content" tabindex="0" aria-label="' + escapeHtml(title) + ' TXT 内容">' + escapeHtml(String(draft.content || '')) + '</div>' +
        '</section>';
      });

      html += '</div>';
      panel.innerHTML = html;
    }
    window.renderArticleWritingProgressPanel = renderArticleWritingProgressPanel;

    function scheduleArticleChapterDraftSave(textarea) {
      if (!textarea) return;
      var key = textarea.getAttribute('data-article-chapter-key') || '';
      var stateId = textarea.getAttribute('data-article-save-state-id') || ('articleDraftSaveState_' + getArticleDraftDomId(key));
      var stateEl = document.getElementById(stateId);
      if (stateEl) stateEl.textContent = '有未保存修改，点击“保存”写入分章节草稿';
    }
    window.scheduleArticleChapterDraftSave = scheduleArticleChapterDraftSave;

    function getArticleDraftTextareaFromButton(button) {
      if (!button) return null;
      var targetId = button.getAttribute('data-article-draft-target') || '';
      return targetId ? document.getElementById(targetId) : null;
    }

    function setArticleChapterDraftEditMode(textarea, editing) {
      if (!textarea) return;
      textarea.readOnly = !editing;
      textarea.classList.toggle('editing', !!editing);
      var section = textarea.closest ? textarea.closest('.article-structure-section') : null;
      if (!section) return;
      var buttons = section.querySelectorAll('.article-structure-edit-actions button');
      for (var i = 0; i < buttons.length; i++) {
        var button = buttons[i];
        var label = String(button.textContent || '').trim();
        if (label === '编辑') {
          button.style.display = editing ? 'none' : '';
          button.disabled = false;
        } else {
          button.style.display = editing ? '' : 'none';
          button.disabled = false;
        }
      }
    }

    function enableArticleChapterDraftEdit(button) {
      var textarea = getArticleDraftTextareaFromButton(button);
      if (!textarea) return;
      var key = textarea.getAttribute('data-article-chapter-key') || '';
      articleDraftEditOriginalByKey[key] = textarea.value;
      setArticleChapterDraftEditMode(textarea, true);
      var stateEl = document.getElementById(textarea.getAttribute('data-article-save-state-id') || '');
      if (stateEl) stateEl.textContent = '编辑中，修改后点击“保存”';
      setTimeout(function() {
        try {
          textarea.focus();
          textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        } catch (e) {}
      }, 0);
    }
    window.enableArticleChapterDraftEdit = enableArticleChapterDraftEdit;

    async function saveArticleChapterDraftEdit(button) {
      var textarea = getArticleDraftTextareaFromButton(button);
      if (!textarea) return;
      var section = textarea.closest ? textarea.closest('.article-structure-section') : null;
      var buttons = section ? section.querySelectorAll('.article-structure-edit-actions button') : [];
      for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;
      var key = textarea.getAttribute('data-article-chapter-key') || '';
      var title = textarea.getAttribute('data-article-chapter-title') || key || 'section';
      if (!key) key = inferArticleChapterKey(title);
      var stateEl = document.getElementById(textarea.getAttribute('data-article-save-state-id') || '');
      var saved = await saveArticleChapterDraftFromSidebar(key, title, textarea.value, stateEl);
      for (var j = 0; j < buttons.length; j++) buttons[j].disabled = false;
      if (!saved) return;
      articleDraftEditOriginalByKey[key] = textarea.value;
      setArticleChapterDraftEditMode(textarea, false);
    }
    window.saveArticleChapterDraftEdit = saveArticleChapterDraftEdit;

    async function flushPendingArticleChapterDraftEditsBeforeSend() {
      var textareas = Array.prototype.slice.call(document.querySelectorAll('.article-structure-content.editing[data-article-chapter-key]'));
      if (!textareas.length) return { saved: 0, failed: 0 };
      var saved = 0;
      var failed = 0;
      for (var i = 0; i < textareas.length; i++) {
        var textarea = textareas[i];
        var key = textarea.getAttribute('data-article-chapter-key') || '';
        var title = textarea.getAttribute('data-article-chapter-title') || key || 'section';
        if (!key) key = inferArticleChapterKey(title);
        var stateEl = document.getElementById(textarea.getAttribute('data-article-save-state-id') || '');
        if (stateEl) stateEl.textContent = '发送前正在同步最新章节草稿...';
        var ok = await saveArticleChapterDraftFromSidebar(key, title, textarea.value, stateEl);
        if (ok) {
          articleDraftEditOriginalByKey[key] = textarea.value;
          setArticleChapterDraftEditMode(textarea, false);
          saved++;
        } else {
          failed++;
        }
      }
      return { saved: saved, failed: failed };
    }
    window.flushPendingArticleChapterDraftEditsBeforeSend = flushPendingArticleChapterDraftEditsBeforeSend;

    function cancelArticleChapterDraftEdit(button) {
      var textarea = getArticleDraftTextareaFromButton(button);
      if (!textarea) return;
      var key = textarea.getAttribute('data-article-chapter-key') || '';
      if (Object.prototype.hasOwnProperty.call(articleDraftEditOriginalByKey, key)) {
        textarea.value = articleDraftEditOriginalByKey[key];
      }
      setArticleChapterDraftEditMode(textarea, false);
      var stateEl = document.getElementById(textarea.getAttribute('data-article-save-state-id') || '');
      if (stateEl) stateEl.textContent = '已取消编辑，未保存修改';
    }
    window.cancelArticleChapterDraftEdit = cancelArticleChapterDraftEdit;

    async function saveArticleChapterDraftFromSidebar(key, title, content, stateEl) {
      if (stateEl) stateEl.textContent = '正在保存...';
      try {
        var cachedDraft = (articleDraftProgressCache.drafts || []).find(function(draft) {
          return String(draft.key || inferArticleChapterKey(draft.chapterName) || '') === String(key || '');
        });
        var response = await fetch('/api/draft/' + encodeURIComponent(currentUserId || 'web-user') + '/chapter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chapter: key || title || 'section',
            content: String(content || ''),
            expectedSavedAt: cachedDraft && cachedDraft.savedAt ? cachedDraft.savedAt : '',
            availableChapters: getArticleDraftChapterTargets({ includeAllVisible: true })
          })
        });
        var result = await response.json();
        if (response.status === 409 || result.conflict) {
          articleDraftProgressCache.loaded = false;
          if (stateEl) stateEl.textContent = '保存冲突：章节已有更新，正在刷新最新版本';
          await loadArticleDraftProgress(true);
          return false;
        }
        if (!response.ok || !result.success) throw new Error(result.error || '保存失败');
        upsertArticleDraftProgressCache(key, title, content, result);
        articleDraftProgressCache.lastRefreshedAt = new Date().toISOString();
        articleDraftProgressCache.lastError = '';
        if (stateEl) stateEl.textContent = '已保存到 ' + (result.chapterFile || key + '.txt') + ' · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        return true;
      } catch (error) {
        if (stateEl) stateEl.textContent = '保存失败：' + (error.message || error);
        return false;
      }
    }

    async function refreshArticleWritingProgress() {
      if (articleDraftProgressCache.refreshing) return;
      articleDraftProgressCache.refreshing = true;
      articleDraftProgressCache.lastError = '';
      renderArticleWritingProgressPanel();
      try {
        await loadArticleDraftProgress(true);
      } finally {
        articleDraftProgressCache.refreshing = false;
        renderArticleWritingProgressPanel();
      }
    }
    window.refreshArticleWritingProgress = refreshArticleWritingProgress;

    function shouldRefreshArticleDraftProgressAfterAiResponse(text) {
      var value = String(text || '');
      return /已将工作目录草稿文件同步到右侧文章写作进度|已创建并保存到[\s\S]{0,60}草稿|已(?:自动)?保存到[\s\S]{0,60}草稿|已智能保存到[\s\S]{0,60}草稿|同步整篇导出文件|save_draft/i.test(value);
    }

    function refreshArticleDraftProgressAfterAiResponse(text) {
      invalidateArticleDraftProgressCache();
      if (shouldRefreshArticleDraftProgressAfterAiResponse(text)) {
        refreshArticleWritingProgress();
      }
    }
    window.refreshArticleDraftProgressAfterAiResponse = refreshArticleDraftProgressAfterAiResponse;

    function normalizeDiscussionFrameworkStructureIdentity(value) {
      return String(value || '')
        .replace(/\\[a-zA-Z]+\*?\{([^}]*)\}/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s*/, '')
        .replace(/^\s*\d+(?:\.\d+)+[.)、:：\s-]*/, '')
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
    }

    function extractDiscussionFrameworkSubsections(content) {
      var text = String(content || '');
      var headings = [];
      var seen = {};
      function addHeading(rawTitle) {
        var title = String(rawTitle || '')
          .replace(/\\[a-zA-Z]+\*?\{([^}]*)\}/g, '$1')
          .replace(/^\s{0,3}#{1,6}\s*/, '')
          .trim()
          .slice(0, 240);
        var identity = normalizeDiscussionFrameworkStructureIdentity(title);
        if (!identity || seen[identity] || /^(references?|bibliography|参考文献|致谢|acknowledgements?)$/i.test(title)) return;
        seen[identity] = true;
        headings.push(title);
      }

      var latexPattern = /\\subsection\*?\{([^}]*)\}/g;
      var match;
      while ((match = latexPattern.exec(text)) !== null) addHeading(match[1]);

      var markdownPattern = /^\s{0,3}#{2,6}\s+(.+)$/gm;
      while ((match = markdownPattern.exec(text)) !== null) addHeading(match[1]);

      var numberedPattern = /^\s*(\d+(?:\.\d+)+)\s+([^\n]{2,220})\s*$/gm;
      while ((match = numberedPattern.exec(text)) !== null) addHeading(match[1] + ' ' + match[2]);
      return headings;
    }

    function extractDiscussionFrameworkFigureReferences(content) {
      var text = String(content || '');
      var references = [];
      var seen = {};
      var patterns = [
        /\bfig(?:ure)?s?\.?\s*\d+(?:\s*[a-z])?(?:\s*[,/&-]\s*(?:\d+)?[a-z0-9]+)*/gi,
        /图\s*\d+(?:\s*[a-z])?(?:\s*[,、/&-]\s*(?:\d+)?[a-z0-9]+)*/gi,
        /\btable\s*\d+[a-z]?/gi,
        /表\s*\d+[a-z]?/gi
      ];
      patterns.forEach(function(pattern) {
        var matches = text.match(pattern) || [];
        matches.forEach(function(value) {
          var label = String(value || '').replace(/\s+/g, ' ').trim();
          var identity = label.toLowerCase().replace(/\s+/g, '');
          if (!identity || seen[identity]) return;
          seen[identity] = true;
          references.push(label);
        });
      });
      return references.slice(0, 80);
    }

    function mergeDiscussionFrameworkSubsections(existingSubsections, detectedTitles) {
      var existing = Array.isArray(existingSubsections) ? existingSubsections : [];
      if (!detectedTitles.length) return existing;
      var used = {};
      var merged = detectedTitles.map(function(title) {
        var identity = normalizeDiscussionFrameworkStructureIdentity(title);
        var matched = existing.find(function(sub) {
          return normalizeDiscussionFrameworkStructureIdentity(sub.title) === identity;
        });
        if (matched) used[matched.id] = true;
        return {
          id: matched && matched.id ? matched.id : createDiscussionFrameworkId('sub'),
          title: title,
          idea: matched ? String(matched.idea || '') : ''
        };
      });
      existing.forEach(function(sub) {
        if (used[sub.id] || !String(sub.idea || '').trim()) return;
        merged.push(sub);
      });
      return merged;
    }

    function getDraftFigureSourceName(asset) {
      var source = asset && asset.source ? asset.source : {};
      var sourcePath = String(source.originalPath || source.relativePath || asset.fileName || 'figure.png');
      return sourcePath.split(/[\\/]+/).pop() || asset.fileName || 'figure.png';
    }

    function buildDiscussionFrameworkSyncedFigure(asset, previous) {
      var originalFileName = getDraftFigureSourceName(asset);
      var figureLabel = String(asset.figureLabel || '').trim();
      var figureName = figureLabel;
      var panelLabel = '';
      var panelMatch = figureLabel.match(/^(.*?\d+)\s*\(?([a-z])\)?$/i);
      if (panelMatch) {
        figureName = panelMatch[1].trim();
        panelLabel = panelMatch[2].trim();
      }
      return {
        syncedAssetId: String(asset.id || ''),
        syncedDraftAsset: true,
        name: figureLabel ? figureLabel + ' · ' + originalFileName : originalFileName,
        originalFileName: originalFileName,
        size: Number(asset.size || 0),
        type: getFileType(originalFileName),
        figureName: previous && previous.figureName ? previous.figureName : figureName,
        panelLabel: previous && previous.panelLabel ? previous.panelLabel : panelLabel,
        caption: previous && previous.caption ? previous.caption : String(asset.caption || ''),
        url: String(asset.url || ''),
        subsectionId: String(asset.subsectionId || ''),
        subsectionTitle: String(asset.subsectionTitle || ''),
        source: asset.source || null
      };
    }

    async function updateDiscussionFrameworkFromArticleProgress() {
      if (discussionFrameworkStructureSyncing) return;
      discussionFrameworkStructureSyncing = true;
      discussionFrameworkStructureSyncStatus = '正在读取文章写作进度、章节 TXT 和已归档图件...';
      renderDiscussionFrameworkPanel();
      try {
        var userId = currentUserId || 'web-user';
        var responses = await Promise.all([
          fetch('/api/draft/' + encodeURIComponent(userId) + '?_=' + Date.now(), { cache: 'no-store' }),
          fetch('/api/draft-assets/figures?userId=' + encodeURIComponent(userId) + '&_=' + Date.now(), { cache: 'no-store' })
        ]);
        if (!responses[0].ok) throw new Error('读取文章写作进度失败');
        var draftData = await responses[0].json();
        var figureData = responses[1].ok ? await responses[1].json() : { success: false, figures: [] };
        var drafts = parseArticleDraftPayload(draftData);
        if (!drafts.length) throw new Error('文章写作进度中还没有可同步的章节 TXT');
        var figures = figureData && figureData.success && Array.isArray(figureData.figures) ? figureData.figures : [];
        var state = loadDiscussionFrameworkState();
        var existingChapters = state.chapters || [];
        var usedChapterIds = {};
        var syncedChapters = [];
        var subsectionCount = 0;
        var syncedFigureCount = 0;

        drafts.forEach(function(draft) {
          var draftKey = String(draft.key || inferArticleChapterKey(draft.chapterName) || '').trim();
          if (!draftKey) return;
          var chapter = existingChapters.find(function(item) {
            var itemKey = String(item.syncedDraftKey || inferArticleChapterKey(item.title) || '').trim();
            return itemKey === draftKey;
          });
          if (!chapter) {
            chapter = {
              id: createDiscussionFrameworkId('chapter'),
              title: draft.chapterName || draftKey,
              idea: '',
              analysis: '',
              analysisUpdatedAt: '',
              analysisProgress: '',
              analysisProgressStatus: '',
              syncedFigures: [],
              figureReferences: [],
              collapsed: false,
              subsections: []
            };
          }

          var detectedSubsections = extractDiscussionFrameworkSubsections(draft.content);
          chapter.title = draft.chapterName || chapter.title || draftKey;
          chapter.subsections = mergeDiscussionFrameworkSubsections(chapter.subsections, detectedSubsections);
          chapter.figureReferences = extractDiscussionFrameworkFigureReferences(draft.content);
          chapter.syncedDraftKey = draftKey;
          chapter.syncedDraftFile = draft.fileName || draftKey + '.txt';
          chapter.syncedAt = new Date().toISOString();

          var previousFigures = {};
          (chapter.syncedFigures || []).forEach(function(item) {
            if (item.syncedAssetId) previousFigures[item.syncedAssetId] = item;
          });
          chapter.syncedFigures = figures.filter(function(asset) {
            return String(asset.chapterKey || inferArticleChapterKey(asset.chapterName) || '') === draftKey;
          }).map(function(asset) {
            return buildDiscussionFrameworkSyncedFigure(asset, previousFigures[asset.id]);
          });

          subsectionCount += chapter.subsections.length;
          syncedFigureCount += chapter.syncedFigures.length;
          usedChapterIds[chapter.id] = true;
          syncedChapters.push(chapter);
        });

        existingChapters.forEach(function(chapter) {
          if (!usedChapterIds[chapter.id]) syncedChapters.push(chapter);
        });
        state.chapters = syncedChapters;
        state.expanded = true;
        saveDiscussionFrameworkState(state);

        articleDraftProgressCache.drafts = drafts;
        articleDraftProgressCache.loaded = true;
        articleDraftProgressCache.userId = userId;
        discussionFrameworkStructureSyncStatus = '已从文章写作进度更新 ' + drafts.length + ' 个章节、' + subsectionCount + ' 个小节、' + syncedFigureCount + ' 个归档图件；正文图表引用已同步。';
      } catch (error) {
        discussionFrameworkStructureSyncStatus = '更新失败：' + (error.message || error);
      } finally {
        discussionFrameworkStructureSyncing = false;
        renderDiscussionFrameworkPanel();
      }
    }
    window.updateDiscussionFrameworkFromArticleProgress = updateDiscussionFrameworkFromArticleProgress;

    function renderDiscussionFrameworkPanel() {
      var shell = document.getElementById('discussionFrameworkShell');
      var panel = document.getElementById('discussionFrameworkPanel');
      var overlay = document.getElementById('discussionFrameworkOverlay');
      var meta = document.getElementById('discussionFrameworkMeta');
      if (!panel) return;
      var state = loadDiscussionFrameworkState();
      if (overlay) overlay.classList.toggle('open', state.expanded === true);
      if (shell) shell.classList.add('open');
      var counts = countDiscussionFrameworkContent(state);
      if (meta && getRightSidebarActiveTab() === 'discussion') {
        var parts = [];
        if (counts.chapters) parts.push(counts.chapters + ' 章');
        if (counts.subsections) parts.push(counts.subsections + ' 小节');
        if (counts.files) parts.push(counts.files + ' 个图表数据');
        meta.textContent = parts.length ? parts.join(' / ') : '未填写';
      }

      var memoryHtml = DISCUSSION_FRAMEWORK_MEMORY_DEFS.map(function(item) {
        var active = state.memoryKeys && state.memoryKeys[item.key] === true;
        return '<label class="discussion-framework-memory-chip' + (active ? ' active' : '') + '" title="' + escapeHtml(item.desc) + '">' +
          '<input type="checkbox" ' + (active ? 'checked ' : '') + 'onchange="toggleDiscussionFrameworkMemoryKey(\'' + escapeHtml(item.key) + '\', this.checked)">' +
          '<span>' + escapeHtml(item.label) + '</span>' +
        '</label>';
      }).join('');

      var html = '<div class="discussion-framework-toolbar">' +
        '<div class="discussion-framework-hint">在这里给每章和每个小节写清楚写作思路；可直接分析章节图表数据，发送讨论式写作问题时 AI 会优先按这个框架和分析结果组织回答。</div>' +
        '<div class="discussion-framework-actions">' +
          '<button type="button" class="discussion-framework-mini-btn" onclick="addDiscussionFrameworkChapter()">添加章节</button>' +
          '<button type="button" class="discussion-framework-mini-btn" id="discussionFrameworkStructureSyncBtn" onclick="updateDiscussionFrameworkFromArticleProgress()"' + (discussionFrameworkStructureSyncing ? ' disabled' : '') + '>' + (discussionFrameworkStructureSyncing ? '正在更新...' : '更新章节结构') + '</button>' +
          '<button type="button" class="discussion-framework-mini-btn" onclick="resetDiscussionFramework()">重置框架</button>' +
        '</div>' +
      '</div>' +
      (discussionFrameworkStructureSyncStatus ? '<div class="discussion-framework-analysis-status">' + escapeHtml(discussionFrameworkStructureSyncStatus) + '</div>' : '') +
      '<div class="discussion-framework-memory-row">' +
        '<span class="discussion-framework-memory-label">选择长期记忆材料：</span>' +
        memoryHtml +
      '</div>' +
      '<div class="discussion-framework-list">';

      state.chapters.forEach(function(chapter, chapterIndex) {
        var files = getDiscussionFrameworkChapterFiles(chapter);
        html += '<div class="discussion-framework-section' + (chapter.collapsed ? ' collapsed' : '') + '">' +
          '<div class="discussion-framework-section-head">' +
            '<button type="button" class="discussion-framework-section-toggle" onclick="toggleDiscussionFrameworkChapter(' + chapterIndex + ')">' + (chapter.collapsed ? '+' : '-') + '</button>' +
            '<input class="discussion-framework-section-title" value="' + escapeHtml(chapter.title || '') + '" placeholder="章节标题" oninput="updateDiscussionFrameworkChapter(' + chapterIndex + ', \'title\', this.value)">' +
            '<button type="button" class="discussion-framework-mini-btn" onclick="removeDiscussionFrameworkChapter(' + chapterIndex + ')">删除</button>' +
          '</div>' +
          '<div class="discussion-framework-section-body">' +
            (chapter.syncedDraftFile ? '<div class="discussion-framework-analysis-status">结构来源：' + escapeHtml(chapter.syncedDraftFile) + (chapter.syncedAt ? ' · ' + escapeHtml(new Date(chapter.syncedAt).toLocaleString('zh-CN')) : '') + '</div>' : '') +
            '<div>' +
              '<div class="discussion-framework-field-label">本章写作思路</div>' +
              '<textarea class="discussion-framework-textarea" placeholder="例如：本章先交代科学问题，再围绕 Figure 1 和 Table 1 展开结果解释。" oninput="updateDiscussionFrameworkChapter(' + chapterIndex + ', \'idea\', this.value)">' + escapeHtml(chapter.idea || '') + '</textarea>' +
            '</div>' +
            '<div>' +
              '<div class="discussion-framework-field-label">小节写作思路</div>' +
              '<div class="discussion-framework-subsections">';
        (chapter.subsections || []).forEach(function(sub, subIndex) {
          html += '<div class="discussion-framework-subsection">' +
            '<input class="discussion-framework-input" value="' + escapeHtml(sub.title || '') + '" placeholder="小节标题" oninput="updateDiscussionFrameworkSubsection(' + chapterIndex + ', ' + subIndex + ', \'title\', this.value)">' +
            '<textarea class="discussion-framework-textarea" placeholder="这个小节要写什么、用哪些图表或记忆材料支撑" oninput="updateDiscussionFrameworkSubsection(' + chapterIndex + ', ' + subIndex + ', \'idea\', this.value)">' + escapeHtml(sub.idea || '') + '</textarea>' +
            '<button type="button" class="discussion-framework-remove-btn" onclick="removeDiscussionFrameworkSubsection(' + chapterIndex + ', ' + subIndex + ')" title="删除小节">×</button>' +
          '</div>';
        });
        html += '</div>' +
              '<button type="button" class="discussion-framework-mini-btn discussion-framework-add-subsection-btn" onclick="addDiscussionFrameworkSubsection(' + chapterIndex + ')" title="添加小节" aria-label="添加小节">+</button>' +
            '</div>' +
            '<div>' +
              '<div class="discussion-framework-field-label">本章图表/数据文件</div>' +
              '<div class="discussion-framework-file-row">' +
                '<label class="discussion-framework-mini-btn" for="discussionFrameworkFileInput_' + chapterIndex + '">上传图表数据</label>' +
                '<button type="button" class="discussion-framework-mini-btn" onclick="analyzeDiscussionFrameworkChapterFiles(' + chapterIndex + ')">分析图表数据</button>' +
                '<input class="discussion-framework-file-input" id="discussionFrameworkFileInput_' + chapterIndex + '" type="file" multiple accept=".csv,.tsv,.txt,.md,.json,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.pdf,.doc,.docx" onchange="handleDiscussionFrameworkFilesSelected(' + chapterIndex + ', this.files)">';
        files.forEach(function(fileInfo, fileIndex) {
          if (isExperimentImageFile(fileInfo)) return;
          html += '<span class="discussion-framework-file-chip" title="' + escapeHtml(fileInfo.name) + '">' +
            '<span>' + escapeHtml(fileInfo.name) + '</span>' +
            '<button type="button" onclick="removeDiscussionFrameworkFile(' + chapterIndex + ', ' + fileIndex + ')">×</button>' +
          '</span>';
        });
        html += '</div>' +
            renderDiscussionFrameworkFigurePlanRows(chapterIndex, files) +
            (Array.isArray(chapter.figureReferences) && chapter.figureReferences.length
              ? '<div class="discussion-framework-analysis-status">正文使用图表：' + chapter.figureReferences.map(function(label) { return '<span class="discussion-framework-file-chip">' + escapeHtml(label) + '</span>'; }).join(' ') + '</div>'
              : '') +
            (chapter.analysisProgress ? '<div class="discussion-framework-progress ' + escapeHtml(chapter.analysisProgressStatus || '') + '">' + escapeHtml(chapter.analysisProgress) + '</div>' : '') +
            (chapter.analysis ? '<div style="margin-top:8px;"><div class="discussion-framework-field-label">章节图表数据分析结果' + (chapter.analysisUpdatedAt ? ' · ' + escapeHtml(chapter.analysisUpdatedAt) : '') + '</div><div class="discussion-framework-analysis-box">' + escapeHtml(chapter.analysis) + '</div></div>' : '<div class="discussion-framework-analysis-status">上传 CSV/TXT/MD/JSON 后可直接随聊天读取；图片需要按 Figure 名称、小图标签、图注/注释填写后再分析；点击“分析图表数据”会调用实验资料分析接口，结果写回本章并同步进入后续讨论。</div>') +
            '</div>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
      panel.innerHTML = html;
    }

    function updateDiscussionFrameworkMetaOnly() {
      var state = loadDiscussionFrameworkState();
      var meta = document.getElementById('discussionFrameworkMeta');
      if (!meta) return;
      if (getRightSidebarActiveTab() !== 'discussion') {
        renderArticleWritingProgressPanel();
        return;
      }
      var counts = countDiscussionFrameworkContent(state);
      var parts = [];
      if (counts.chapters) parts.push(counts.chapters + ' 章');
      if (counts.subsections) parts.push(counts.subsections + ' 小节');
      if (counts.files) parts.push(counts.files + ' 个图表数据');
      meta.textContent = parts.length ? parts.join(' / ') : '未填写';
    }

    function renderDiscussionFrameworkFigurePlanRows(chapterIndex, files) {
      var imageEntries = [];
      (files || []).forEach(function(fileInfo, fileIndex) {
        if (isExperimentImageFile(fileInfo)) {
          imageEntries.push({ fileInfo: fileInfo, fileIndex: fileIndex });
        }
      });
      if (!imageEntries.length) return '';
      var completeCount = imageEntries.filter(function(entry) {
        return isExperimentFigurePlanComplete(entry.fileInfo);
      }).length;
      var html = '<div class="discussion-framework-figure-plan">' +
        '<div class="discussion-framework-field-label">图片规划（与主页上传图表字段一致） · ' + completeCount + '/' + imageEntries.length + ' 已填写 Figure 名称</div>';
      imageEntries.forEach(function(entry) {
        var fileInfo = entry.fileInfo;
        var fileIndex = entry.fileIndex;
        var planText = formatExperimentFigureLabel(fileInfo.figureName, fileInfo.panelLabel);
        var ready = isExperimentFigurePlanComplete(fileInfo);
        html += '<div class="discussion-framework-figure-plan-row">' +
          '<div class="discussion-framework-file-main">' +
            '<div>' + getFileTypeIcon(fileInfo.type) + ' ' + escapeHtml(fileInfo.name) + '</div>' +
            '<span class="experiment-figure-plan-status' + (ready ? ' ready' : '') + '">' + escapeHtml(planText || getExperimentFigurePlanStatus(fileInfo)) + '</span>' +
          '</div>' +
          '<div>' +
            '<div class="experiment-figure-choice-row">';
        experimentFigurePlanChoices.forEach(function(choice, choiceIndex) {
          var active = fileInfo.figureName === choice.figureName && String(fileInfo.panelLabel || '') === String(choice.panelLabel || '');
          html += '<button type="button" class="experiment-figure-choice' + (active ? ' active' : '') + '" onclick="applyDiscussionFrameworkFigureChoice(' + chapterIndex + ', ' + fileIndex + ', ' + choiceIndex + ')">' + escapeHtml(choice.label) + '</button>';
        });
        html += '</div>' +
            '<div class="experiment-figure-plan-fields">' +
              '<input value="' + escapeHtml(fileInfo.figureName || '') + '" placeholder="Figure 1 / 图1" oninput="updateDiscussionFrameworkFilePlan(' + chapterIndex + ', ' + fileIndex + ', \'figureName\', this.value)">' +
              '<input value="' + escapeHtml(fileInfo.panelLabel || '') + '" placeholder="a / b / 小图标签" oninput="updateDiscussionFrameworkFilePlan(' + chapterIndex + ', ' + fileIndex + ', \'panelLabel\', this.value)">' +
              '<input value="' + escapeHtml(fileInfo.caption || '') + '" placeholder="注释/图注：如 N2O 累积排放" oninput="updateDiscussionFrameworkFilePlan(' + chapterIndex + ', ' + fileIndex + ', \'caption\', this.value)">' +
            '</div>' +
          '</div>' +
          '<button type="button" class="discussion-framework-remove-btn" onclick="removeDiscussionFrameworkFile(' + chapterIndex + ', ' + fileIndex + ')" title="删除图片">×</button>' +
        '</div>';
      });
      html += '</div>';
      return html;
    }

    function updateDiscussionFrameworkFilePlan(chapterIndex, fileIndex, field, value) {
      if (!['figureName', 'panelLabel', 'caption'].includes(field)) return;
      var state = loadDiscussionFrameworkState();
      var chapter = state.chapters[chapterIndex];
      if (!chapter) return;
      var list = getDiscussionFrameworkChapterFiles(chapter);
      var fileInfo = list[fileIndex];
      if (!fileInfo) return;
      fileInfo[field] = value;
      if (fileInfo.syncedAssetId) {
        chapter.syncedFigures = (chapter.syncedFigures || []).map(function(item) {
          return item.syncedAssetId === fileInfo.syncedAssetId ? Object.assign({}, item, { [field]: value }) : item;
        });
        saveDiscussionFrameworkState(state);
      }
    }
    window.updateDiscussionFrameworkFilePlan = updateDiscussionFrameworkFilePlan;

    function applyDiscussionFrameworkFigureChoice(chapterIndex, fileIndex, choiceIndex) {
      var choice = experimentFigurePlanChoices[choiceIndex];
      if (!choice) return;
      updateDiscussionFrameworkFilePlan(chapterIndex, fileIndex, 'figureName', choice.figureName || '');
      updateDiscussionFrameworkFilePlan(chapterIndex, fileIndex, 'panelLabel', choice.panelLabel || '');
      renderDiscussionFrameworkPanel();
    }
    window.applyDiscussionFrameworkFigureChoice = applyDiscussionFrameworkFigureChoice;

    function setDiscussionFrameworkChapterAnalysisProgress(chapterIndex, message, status) {
      var state = loadDiscussionFrameworkState();
      if (!state.chapters[chapterIndex]) return;
      state.chapters[chapterIndex].analysisProgress = String(message || '');
      state.chapters[chapterIndex].analysisProgressStatus = String(status || '');
      state.chapters[chapterIndex].collapsed = false;
      saveDiscussionFrameworkState(state);
      renderDiscussionFrameworkPanel();
    }

    function ensureDiscussionFrameworkFigurePlansBeforeAnalysis(chapterIndex, files) {
      var missing = (files || []).filter(function(fileInfo) {
        return isExperimentImageFile(fileInfo) && !isExperimentFigurePlanComplete(fileInfo);
      });
      if (!missing.length) return true;
      setDiscussionFrameworkChapterAnalysisProgress(
        chapterIndex,
        '请先给图片填写 Figure 名称后再分析：\n' + missing.map(function(fileInfo) { return '- ' + fileInfo.name; }).join('\n'),
        'error'
      );
      return false;
    }

    function toggleDiscussionFrameworkPanel() {
      toggleRightSidebar();
    }
    window.toggleDiscussionFrameworkPanel = toggleDiscussionFrameworkPanel;

    function openDiscussionFrameworkPanel() {
      openArticleWritingProgressPanel();
    }
    window.openDiscussionFrameworkPanel = openDiscussionFrameworkPanel;

    function closeDiscussionFrameworkPanel() {
      var state = loadDiscussionFrameworkState();
      state.expanded = false;
      saveDiscussionFrameworkState(state);
      setRightSidebarCollapsed(true);
      renderRightSidebarActivePanel();
    }
    window.closeDiscussionFrameworkPanel = closeDiscussionFrameworkPanel;

    function handleDiscussionFrameworkBallClick(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (discussionFrameworkSuppressNextClick || discussionFrameworkLastPointerMoved) {
        discussionFrameworkSuppressNextClick = false;
        discussionFrameworkLastPointerMoved = false;
        return;
      }
      openDiscussionFrameworkPanel();
    }
    window.handleDiscussionFrameworkBallClick = handleDiscussionFrameworkBallClick;

    function initDiscussionFrameworkFloating() {
      if (discussionFrameworkFloatingInitialized) return;
      var root = document.getElementById('discussionFrameworkFloat');
      var ball = document.getElementById('discussionFrameworkBall');
      if (!root || !ball) return;
      discussionFrameworkFloatingInitialized = true;
      var position = loadDiscussionFrameworkFloatPosition();
      applyDiscussionFrameworkFloatPosition(position.left, position.top);
      closeDiscussionFrameworkPanel();

      var pointerActive = false;
      var startX = 0;
      var startY = 0;
      var startLeft = 0;
      var startTop = 0;
      var pointerId = null;

      ball.addEventListener('pointerdown', function(event) {
        if (event.button !== undefined && event.button !== 0) return;
        pointerId = event.pointerId;
        pointerActive = true;
        discussionFrameworkLastPointerMoved = false;
        discussionFrameworkSuppressNextClick = false;
        var rect = root.getBoundingClientRect();
        startX = event.clientX;
        startY = event.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        try { ball.setPointerCapture(pointerId); } catch (e) {}
      });

      function movePointer(event) {
        if (!pointerActive || event.pointerId !== pointerId) return;
        var dx = event.clientX - startX;
        var dy = event.clientY - startY;
        if (Math.abs(dx) + Math.abs(dy) > 8) {
          discussionFrameworkLastPointerMoved = true;
          root.classList.add('dragging');
          event.preventDefault();
          applyDiscussionFrameworkFloatPosition(startLeft + dx, startTop + dy);
        }
      }
      ball.addEventListener('pointermove', movePointer);
      document.addEventListener('pointermove', movePointer);

      function finishPointer(event) {
        if (!pointerActive || (pointerId !== null && event.pointerId !== pointerId)) return;
        var shouldOpen = !discussionFrameworkLastPointerMoved;
        pointerActive = false;
        root.classList.remove('dragging');
        try { ball.releasePointerCapture(pointerId); } catch (e) {}
        pointerId = null;
        if (shouldOpen) {
          discussionFrameworkSuppressNextClick = true;
          openDiscussionFrameworkPanel();
          setTimeout(function() {
            discussionFrameworkSuppressNextClick = false;
          }, 0);
          return;
        }
        discussionFrameworkSuppressNextClick = true;
        setTimeout(function() {
          discussionFrameworkSuppressNextClick = false;
          discussionFrameworkLastPointerMoved = false;
        }, 0);
      }
      ball.addEventListener('pointerup', finishPointer);
      ball.addEventListener('pointercancel', finishPointer);
      document.addEventListener('pointerup', finishPointer);
      document.addEventListener('pointercancel', finishPointer);
      ball.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDiscussionFrameworkPanel();
        }
      });
      window.addEventListener('resize', function() {
        var pos = loadDiscussionFrameworkFloatPosition();
        applyDiscussionFrameworkFloatPosition(pos.left, pos.top);
      });
    }
    window.initDiscussionFrameworkFloating = initDiscussionFrameworkFloating;

    function toggleDiscussionFrameworkMemoryKey(key, checked) {
      var state = loadDiscussionFrameworkState();
      state.memoryKeys = state.memoryKeys || {};
      state.memoryKeys[key] = checked === true;
      saveDiscussionFrameworkState(state);
      renderDiscussionFrameworkPanel();
    }
    window.toggleDiscussionFrameworkMemoryKey = toggleDiscussionFrameworkMemoryKey;

    function updateDiscussionFrameworkChapter(chapterIndex, field, value) {
      var state = loadDiscussionFrameworkState();
      if (!state.chapters[chapterIndex] || !['title', 'idea'].includes(field)) return;
      state.chapters[chapterIndex][field] = value || '';
      saveDiscussionFrameworkState(state);
      updateDiscussionFrameworkMetaOnly();
    }
    window.updateDiscussionFrameworkChapter = updateDiscussionFrameworkChapter;

    function toggleDiscussionFrameworkChapter(chapterIndex) {
      var state = loadDiscussionFrameworkState();
      if (!state.chapters[chapterIndex]) return;
      state.chapters[chapterIndex].collapsed = !state.chapters[chapterIndex].collapsed;
      saveDiscussionFrameworkState(state);
      renderDiscussionFrameworkPanel();
    }
    window.toggleDiscussionFrameworkChapter = toggleDiscussionFrameworkChapter;

    function addDiscussionFrameworkChapter() {
      var state = loadDiscussionFrameworkState();
      state.chapters.push({
        id: createDiscussionFrameworkId('chapter'),
        title: '新章节',
        idea: '',
        analysis: '',
        analysisUpdatedAt: '',
        analysisProgress: '',
        analysisProgressStatus: '',
        syncedFigures: [],
        figureReferences: [],
        syncedDraftKey: '',
        syncedDraftFile: '',
        syncedAt: '',
        writingStatus: 'not_started',
        collapsed: false,
        subsections: [{ id: createDiscussionFrameworkId('sub'), title: '新小节', idea: '' }]
      });
      saveDiscussionFrameworkState(state);
      renderDiscussionFrameworkPanel();
    }
    window.addDiscussionFrameworkChapter = addDiscussionFrameworkChapter;

    function removeDiscussionFrameworkChapter(chapterIndex) {
      var state = loadDiscussionFrameworkState();
      if (!state.chapters[chapterIndex]) return;
      var removedChapter = state.chapters[chapterIndex];
      delete discussionFrameworkFilesByChapter[removedChapter.id];
      if (String(state.activeChapterId || '') === String(removedChapter.id || '')
          || String(state.activeChapterKey || '') === inferArticleChapterKey(removedChapter.title)) {
        state.activeChapterId = '';
        state.activeChapterKey = '';
        state.activeSubsectionId = '';
        state.writingTargetUpdatedAt = new Date().toISOString();
      }
      state.chapters.splice(chapterIndex, 1);
      saveDiscussionFrameworkState(state);
      renderDiscussionFrameworkPanel();
    }
    window.removeDiscussionFrameworkChapter = removeDiscussionFrameworkChapter;

    function updateDiscussionFrameworkSubsection(chapterIndex, subIndex, field, value) {
      var state = loadDiscussionFrameworkState();
      var chapter = state.chapters[chapterIndex];
      if (!chapter || !chapter.subsections || !chapter.subsections[subIndex] || !['title', 'idea'].includes(field)) return;
      chapter.subsections[subIndex][field] = value || '';
      saveDiscussionFrameworkState(state);
      updateDiscussionFrameworkMetaOnly();
    }
    window.updateDiscussionFrameworkSubsection = updateDiscussionFrameworkSubsection;

    function addDiscussionFrameworkSubsection(chapterIndex) {
      var state = loadDiscussionFrameworkState();
      var chapter = state.chapters[chapterIndex];
      if (!chapter) return;
      chapter.subsections = chapter.subsections || [];
      chapter.subsections.push({ id: createDiscussionFrameworkId('sub'), title: '新小节', idea: '' });
      chapter.collapsed = false;
      saveDiscussionFrameworkState(state);
      renderDiscussionFrameworkPanel();
    }
    window.addDiscussionFrameworkSubsection = addDiscussionFrameworkSubsection;

    function removeDiscussionFrameworkSubsection(chapterIndex, subIndex) {
      var state = loadDiscussionFrameworkState();
      var chapter = state.chapters[chapterIndex];
      if (!chapter || !chapter.subsections || !chapter.subsections[subIndex]) return;
      var removedSubsection = chapter.subsections[subIndex];
      if (String(state.activeSubsectionId || '') === String(removedSubsection.id || '')) {
        state.activeSubsectionId = '';
        state.writingTargetUpdatedAt = new Date().toISOString();
      }
      chapter.subsections.splice(subIndex, 1);
      saveDiscussionFrameworkState(state);
      renderDiscussionFrameworkPanel();
    }
    window.removeDiscussionFrameworkSubsection = removeDiscussionFrameworkSubsection;

    function handleDiscussionFrameworkFilesSelected(chapterIndex, files) {
      var state = loadDiscussionFrameworkState();
      var chapter = state.chapters[chapterIndex];
      if (!chapter || !files || !files.length) return;
      var list = discussionFrameworkFilesByChapter[chapter.id] || [];
      Array.prototype.forEach.call(files, function(file) {
        var exists = list.some(function(item) {
          return item.name === file.name && item.size === file.size;
        });
        if (!exists) {
          list.push({
            file: file,
            name: file.name,
            size: file.size,
            type: getFileType(file.name),
            figureName: '',
            panelLabel: '',
            caption: ''
          });
        }
      });
      discussionFrameworkFilesByChapter[chapter.id] = list;
      renderDiscussionFrameworkPanel();
    }
    window.handleDiscussionFrameworkFilesSelected = handleDiscussionFrameworkFilesSelected;

    function removeDiscussionFrameworkFile(chapterIndex, fileIndex) {
      var state = loadDiscussionFrameworkState();
      var chapter = state.chapters[chapterIndex];
      if (!chapter) return;
      var localList = discussionFrameworkFilesByChapter[chapter.id] || [];
      var list = getDiscussionFrameworkChapterFiles(chapter);
      var selected = list[fileIndex];
      if (!selected) return;
      if (selected.syncedAssetId) {
        chapter.syncedFigures = (chapter.syncedFigures || []).filter(function(item) {
          return item.syncedAssetId !== selected.syncedAssetId;
        });
        saveDiscussionFrameworkState(state);
      } else {
        var localIndex = localList.indexOf(selected);
        if (localIndex !== -1) localList.splice(localIndex, 1);
        discussionFrameworkFilesByChapter[chapter.id] = localList;
      }
      renderDiscussionFrameworkPanel();
    }
    window.removeDiscussionFrameworkFile = removeDiscussionFrameworkFile;

    function summarizeDiscussionFrameworkAnalysisResult(result) {
      var lines = [];
      if (result && result.combinedSummary) {
        var summary = result.combinedSummary;
        if (summary.summary) lines.push(String(summary.summary));
        if (Array.isArray(summary.main_findings) && summary.main_findings.length) {
          lines.push('主要发现：');
          summary.main_findings.slice(0, 12).forEach(function(item) {
            lines.push('- ' + stringifyExperimentValue(item));
          });
        }
        if (summary.totalResultsCount) {
          lines.push('结构化结果数量：' + summary.totalResultsCount);
        }
      }
      if (result && Array.isArray(result.results) && result.results.length) {
        lines.push('文件级分析：');
        result.results.slice(0, 8).forEach(function(item, index) {
          var name = item.fileName || item.originalName || item.name || ('文件 ' + (index + 1));
          var text = item.summary || item.analysis || item.content || item.text || '';
          if (!text && item.structuredData) text = stringifyExperimentValue(item.structuredData);
          lines.push('- ' + name + '：' + String(text || '已完成分析').slice(0, 900));
        });
      }
      if (!lines.length && result) {
        lines.push(JSON.stringify(result).slice(0, 4000));
      }
      return lines.join('\n').slice(0, 10000);
    }

    async function materializeDiscussionFrameworkFile(fileInfo) {
      if (fileInfo && fileInfo.file) return fileInfo;
      if (!fileInfo || !fileInfo.url) return null;
      var response = await fetch(fileInfo.url, { cache: 'no-store' });
      if (!response.ok) throw new Error('读取同步图件失败：' + (fileInfo.name || fileInfo.url));
      var blob = await response.blob();
      return Object.assign({}, fileInfo, {
        file: new File([blob], fileInfo.originalFileName || fileInfo.name || 'figure.png', {
          type: blob.type || 'application/octet-stream'
        })
      });
    }

    async function analyzeDiscussionFrameworkChapterFiles(chapterIndex) {
      var state = loadDiscussionFrameworkState();
      var chapter = state.chapters[chapterIndex];
      if (!chapter) return;
      var files = getDiscussionFrameworkChapterFiles(chapter);
      if (!files.length) {
        appendMessage('请先在“' + (chapter.title || '当前章节') + '”上传图表或数据文件。', 'bot', false, true);
        return;
      }
      if (!ensureDiscussionFrameworkFigurePlansBeforeAnalysis(chapterIndex, files)) {
        return;
      }

      var instruction = [
        '这是讨论式写作框架中“' + (chapter.title || '未命名章节') + '”章节的图表/数据材料。',
        chapter.idea ? '本章写作思路：' + chapter.idea : '',
        '用户已在框架中为图片填写 Figure 名称、小图标签和图注/注释；请优先使用这些编号组织结果表述。',
        files.map(function(fileInfo, index) {
          var figureLabel = formatExperimentFigureLabel(fileInfo.figureName, fileInfo.panelLabel);
          return (index + 1) + '. ' + fileInfo.name + (figureLabel ? ' → ' + figureLabel : '') + (fileInfo.caption ? '；注释：' + fileInfo.caption : '');
        }).join('\n'),
        '请按论文写作需要分析这些材料：提取关键变量、处理/分组、主要趋势、显著差异、可用于本章的结果表述、图表描述和需要谨慎表述的不确定项。'
      ].filter(Boolean).join('\n');
      var workflowIntent = inferExperimentWorkflowIntent(instruction);

      setDiscussionFrameworkChapterAnalysisProgress(
        chapterIndex,
        '准备分析“' + (chapter.title || '当前章节') + '”的 ' + files.length + ' 个图表/数据文件...',
        'running'
      );
      try {
        var responses = [];
        for (var i = 0; i < files.length; i++) {
          var fileInfo = await materializeDiscussionFrameworkFile(files[i]);
          if (!fileInfo) continue;
          var figureLabel = formatExperimentFigureLabel(fileInfo.figureName, fileInfo.panelLabel);
          setDiscussionFrameworkChapterAnalysisProgress(
            chapterIndex,
            '正在分析 ' + (i + 1) + '/' + files.length + '：' + fileInfo.name + (figureLabel ? '\n图表编号：' + figureLabel : '') + (fileInfo.caption ? '\n图注/注释：' + fileInfo.caption : ''),
            'running'
          );
          responses.push(await uploadSingleExperimentResultFile(fileInfo, instruction, workflowIntent));
        }
        if (!responses.length) throw new Error('当前章节只有图表引用，没有可读取的图表文件。');
        var combined = combineExperimentUploadResponses(responses, instruction, workflowIntent);
        var analysisText = summarizeDiscussionFrameworkAnalysisResult(combined);
        var latestState = loadDiscussionFrameworkState();
        if (latestState.chapters[chapterIndex]) {
          latestState.chapters[chapterIndex].analysis = analysisText || '已完成分析，但未返回可读摘要。';
          latestState.chapters[chapterIndex].analysisUpdatedAt = new Date().toLocaleString('zh-CN');
          latestState.chapters[chapterIndex].analysisProgress = '已完成 ' + files.length + '/' + files.length + ' 个图表/数据文件分析，结果已写回本章。';
          latestState.chapters[chapterIndex].analysisProgressStatus = 'done';
          latestState.chapters[chapterIndex].collapsed = false;
          saveDiscussionFrameworkState(latestState);
        }
        renderDiscussionFrameworkPanel();
        appendMessage('✅ 已完成“' + (chapter.title || '当前章节') + '”图表/数据分析，并写回讨论式写作框架。后续讨论式写作会自动使用这段分析。', 'bot', false, true);
      } catch (error) {
        console.error('[DiscussionFramework] Chapter file analysis failed:', error);
        setDiscussionFrameworkChapterAnalysisProgress(
          chapterIndex,
          '图表/数据分析失败：' + (error.message || error),
          'error'
        );
        appendMessage('❌ “' + (chapter.title || '当前章节') + '”图表/数据分析失败：' + (error.message || error), 'bot', false, true);
      }
    }
    window.analyzeDiscussionFrameworkChapterFiles = analyzeDiscussionFrameworkChapterFiles;

    function resetDiscussionFramework() {
      if (!confirm('确定重置讨论式写作框架吗？当前填写的章节思路和本次选择的图表数据会被清空。')) return;
      discussionFrameworkFilesByChapter = {};
      var state = createDefaultDiscussionFrameworkState();
      state.expanded = true;
      saveDiscussionFrameworkState(state);
      renderDiscussionFrameworkPanel();
    }
    window.resetDiscussionFramework = resetDiscussionFramework;

    function isDiscussionFrameworkTextFile(fileInfo) {
      var name = String(fileInfo && fileInfo.name || '').toLowerCase();
      var type = String(fileInfo && fileInfo.type || '').toLowerCase();
      return type.indexOf('text/') === 0 || /\.(csv|tsv|txt|md|json|xml|r|py|js|ts)$/i.test(name);
    }

    function readDiscussionFrameworkFileText(file, maxChars) {
      return new Promise(function(resolve) {
        if (!file) return resolve('');
        var reader = new FileReader();
        reader.onload = function() {
          resolve(String(reader.result || '').slice(0, maxChars || 6000));
        };
        reader.onerror = function() {
          resolve('');
        };
        reader.readAsText(file);
      });
    }

    async function loadDiscussionFrameworkSelectedMemoryEntries(keys) {
      if (!keys || !keys.length) return [];
      try {
        var response = await fetch('/api/memory/' + encodeURIComponent(currentUserId || 'web-user'));
        if (!response.ok) return [];
        var data = await response.json();
        var entries = data.memory?.entries || data.entries || [];
        return keys.map(function(key) {
          var entry = entries.find(function(item) { return item.key === key; });
          if (!entry || !entry.value) return null;
          var def = DISCUSSION_FRAMEWORK_MEMORY_DEFS.find(function(item) { return item.key === key; });
          return {
            key: key,
            label: def ? def.label : key,
            value: String(entry.value || '').slice(0, 7000)
          };
        }).filter(Boolean);
      } catch (e) {
        console.warn('[DiscussionFramework] Failed to load selected memory entries:', e);
        return [];
      }
    }

    function buildDiscussionFrameworkProgressSummary(state) {
      var chapters = state.chapters || [];
      var totalChapters = chapters.length;
      var activeChapters = 0;
      var analyzedChapters = 0;
      var totalSubsections = 0;
      var activeSubsections = 0;
      var chapterLines = [];
      chapters.forEach(function(chapter, index) {
        var hasIdea = !!String(chapter.idea || '').trim();
        var hasAnalysis = !!String(chapter.analysis || '').trim();
        var subs = chapter.subsections || [];
        var filledSubs = subs.filter(function(sub) { return !!String(sub.idea || '').trim(); }).length;
        totalSubsections += subs.length;
        activeSubsections += filledSubs;
        if (hasIdea || filledSubs || hasAnalysis) activeChapters++;
        if (hasAnalysis) analyzedChapters++;
        chapterLines.push((index + 1) + '. ' + (chapter.title || '未命名章节') + '：' +
          (hasIdea ? '已有章节思路' : '未写章节思路') + '，' +
          '小节思路 ' + filledSubs + '/' + subs.length + '，' +
          (hasAnalysis ? '已有图表数据分析' : '未分析图表数据'));
      });
      return {
        totalChapters: totalChapters,
        activeChapters: activeChapters,
        analyzedChapters: analyzedChapters,
        totalSubsections: totalSubsections,
        activeSubsections: activeSubsections,
        text: '讨论式写作框架进度：已填写章节 ' + activeChapters + '/' + totalChapters +
          '，已填写小节思路 ' + activeSubsections + '/' + totalSubsections +
          '，已有图表数据分析章节 ' + analyzedChapters + '/' + totalChapters + '。\n' +
          chapterLines.join('\n')
      };
    }

    async function buildDiscussionFrameworkContextForChat() {
      var state = loadDiscussionFrameworkState();
      var progressSummary = buildDiscussionFrameworkProgressSummary(state);
      var selectedMemoryKeys = Object.keys(state.memoryKeys || {}).filter(function(key) {
        return state.memoryKeys[key] === true;
      });
      var chapters = [];
      for (var i = 0; i < (state.chapters || []).length; i++) {
        var chapter = state.chapters[i];
        var files = getDiscussionFrameworkChapterFiles(chapter);
        var subsections = (chapter.subsections || []).filter(function(sub) {
          return String(sub.title || '').trim() || String(sub.idea || '').trim();
        }).map(function(sub) {
          return { title: String(sub.title || '').trim(), idea: String(sub.idea || '').trim() };
        });
        var hasContent = String(chapter.title || '').trim() || String(chapter.idea || '').trim() || subsections.length || files.length;
        if (!hasContent) continue;
        var fileSummaries = [];
        for (var f = 0; f < files.length; f++) {
          var fileInfo = files[f];
          var snippet = '';
          if (isDiscussionFrameworkTextFile(fileInfo)) {
            snippet = await readDiscussionFrameworkFileText(fileInfo.file, 6000);
          }
          fileSummaries.push({
            name: fileInfo.name,
            size: fileInfo.size || 0,
            type: fileInfo.type || getFileType(fileInfo.name),
            url: fileInfo.url || '',
            figureName: fileInfo.figureName || '',
            panelLabel: fileInfo.panelLabel || '',
            caption: fileInfo.caption || '',
            textSnippet: snippet
          });
        }
        chapters.push({
          key: inferArticleChapterKey(chapter.title),
          title: String(chapter.title || '').trim(),
          idea: String(chapter.idea || '').trim(),
          analysis: String(chapter.analysis || '').trim(),
          analysisUpdatedAt: String(chapter.analysisUpdatedAt || '').trim(),
          subsections: subsections,
          figureReferences: Array.isArray(chapter.figureReferences) ? chapter.figureReferences.slice() : [],
          files: fileSummaries
        });
      }

      var memoryEntries = await loadDiscussionFrameworkSelectedMemoryEntries(selectedMemoryKeys);
      if (!chapters.length && !memoryEntries.length) return null;

      var markdown = '## 讨论式写作框架\n';
      markdown += '请把下面内容作为用户当前讨论式写作的结构规划。回答章节写作、修改、续写、图表描述或写作进度问题时，优先按该框架组织，不要把未填写内容当作事实。\n\n';
      markdown += '## 当前讨论式写作进度\n' + progressSummary.text + '\n\n';
      chapters.forEach(function(chapter, index) {
        markdown += '### ' + (index + 1) + '. ' + (chapter.title || '未命名章节') + '\n';
        if (chapter.idea) markdown += '- 本章写作思路：' + chapter.idea + '\n';
        if (chapter.analysis) {
          markdown += '- 本章图表/数据分析结果' + (chapter.analysisUpdatedAt ? '（' + chapter.analysisUpdatedAt + '）' : '') + '：\n' + chapter.analysis + '\n';
        }
        if (chapter.subsections && chapter.subsections.length) {
          markdown += '- 小节规划：\n';
          chapter.subsections.forEach(function(sub) {
            markdown += '  - ' + (sub.title || '未命名小节') + (sub.idea ? '：' + sub.idea : '') + '\n';
          });
        }
        if (chapter.files && chapter.files.length) {
          markdown += '- 本章图表/数据：\n';
          chapter.files.forEach(function(file) {
            markdown += '  - ' + file.name + '（' + (file.type || 'file') + '）\n';
            if (file.textSnippet) {
              markdown += '    数据片段：\n```text\n' + file.textSnippet.slice(0, 3000) + '\n```\n';
            } else {
              markdown += '    说明：该文件为二进制或暂不可直接读取文本，当前只提供文件名；如需完整分析，请让用户通过实验资料上传流程进行解析。\n';
            }
          });
        }
        if (chapter.figureReferences && chapter.figureReferences.length) {
          markdown += '- 正文使用图表：' + chapter.figureReferences.join('、') + '\n';
        }
        markdown += '\n';
      });
      if (memoryEntries.length) {
        markdown += '## 框架中选中的长期记忆材料\n';
        memoryEntries.forEach(function(entry) {
          markdown += '### ' + entry.label + '（' + entry.key + '）\n' + entry.value + '\n\n';
        });
      }
      return {
        available: true,
        profileId: state.profileId,
        progressSummary: progressSummary,
        selectedMemoryKeys: selectedMemoryKeys,
        chapters: chapters,
        selectedMemoryEntries: memoryEntries,
        contextMarkdown: markdown
      };
    }
    window.buildDiscussionFrameworkContextForChat = buildDiscussionFrameworkContextForChat;

    function isCodexCliConfiguredForBadge() {
      var codex = chatBridgeConfig && chatBridgeConfig.codex ? chatBridgeConfig.codex : null;
      if (!codex) return false;
      return codex.enabled !== false && !!codex.prefer;
    }

    function getCodexCliBadgeText() {
      if (!isCodexCliConfiguredForBadge()) return '';
      var codex = chatBridgeConfig.codex || {};
      var model = String(codex.model || 'gpt-5.5').trim();
      var effort = String(codex.reasoning_effort || '').trim();
      return 'Codex CLI: ' + model + (effort ? ' ' + effort : '');
    }

    function updateModelBadge() {
      var parts = [currentModel || 'qwen3.5-plus'];
      var codexLabel = getCodexCliBadgeText();
      if (codexLabel) parts.push(codexLabel);
      if (modelBadge) {
        modelBadge.textContent = parts.join(' / ');
      }
      renderMainContextModelStatus();
    }

    function getChatBottomDistance() {
      if (!chatContainer) return 0;
      return chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
    }

    function isChatNearBottom(threshold) {
      return getChatBottomDistance() <= (threshold || 120);
    }

    function shouldAutoScrollChat() {
      if (chatStreamTailActive) return !chatStreamTailPaused;
      if (chatTurnScrollLocked) return false;
      return chatAutoScrollEnabled || isChatNearBottom(120);
    }

    function maybeScrollChatToBottom(force) {
      if (!chatContainer) return;
      if (chatTurnScrollLocked && !chatStreamTailActive) return;
      if (chatStreamTailActive && chatStreamTailPaused && !force) return;
      if (force || shouldAutoScrollChat()) {
        // A run can start in the same frame that the taller composer finishes
        // laying out. Measure it before reading scrollHeight so the initial
        // Running bubble is positioned above the composer, not under it.
        if (typeof updateMainChatComposerOverlayHeight === 'function') {
          updateMainChatComposerOverlayHeight(null);
        }
        chatAutoScrollEnabled = true;
        if (chatStreamTailActive) chatStreamTailPaused = false;
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
    }

    function startChatStreamTail() {
      chatStreamTailActive = true;
      chatStreamTailPaused = false;
      if (chatTurnScrollLocked) {
        clearChatTurnScrollLock();
      }
      chatAutoScrollEnabled = true;
      requestAnimationFrame(function() {
        maybeScrollChatToBottom(true);
      });
    }

    function stopChatStreamTail() {
      chatStreamTailActive = false;
      chatStreamTailPaused = false;
      chatAutoScrollEnabled = isChatNearBottom(96);
      if (typeof scheduleQueryNavActiveUpdate === 'function') {
        scheduleQueryNavActiveUpdate();
      }
    }

    function scrollChatMessageToTop(messageEl) {
      if (!chatContainer || !messageEl) return;
      requestAnimationFrame(function() {
        if (!chatContainer || !messageEl || !messageEl.getBoundingClientRect) return;
        var containerRect = chatContainer.getBoundingClientRect();
        var messageRect = messageEl.getBoundingClientRect();
        var nextTop = chatContainer.scrollTop + messageRect.top - containerRect.top - 12;
        chatContainer.scrollTop = Math.max(0, Math.round(nextTop));
      });
    }

    function focusChatTurnOnUserMessage(messageEl) {
      if (!messageEl) return;
      clearChatTurnScrollLock();
      chatTurnAnchorEl = messageEl;
      chatTurnScrollLocked = true;
      chatAutoScrollEnabled = false;
      messageEl.classList.add('chat-turn-anchor');
      scrollChatMessageToTop(messageEl);
    }

    function clearChatTurnScrollLock() {
      if (chatTurnAnchorEl && chatTurnAnchorEl.classList) {
        chatTurnAnchorEl.classList.remove('chat-turn-anchor');
      }
      chatTurnAnchorEl = null;
      chatTurnScrollLocked = false;
      chatAutoScrollEnabled = isChatNearBottom(96);
    }

    if (chatContainer) {
      chatContainer.addEventListener('scroll', function() {
        if (chatStreamTailActive) {
          chatStreamTailPaused = !isChatNearBottom(96);
          chatAutoScrollEnabled = !chatStreamTailPaused;
          return;
        }
        if (chatTurnScrollLocked) return;
        chatAutoScrollEnabled = isChatNearBottom(96);
      }, { passive: true });
    }
    initRightSidebarWordImport();
    initQueryNavRail();

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('writing-workspace', { source: '/app/writing-workspace.js' });
}
