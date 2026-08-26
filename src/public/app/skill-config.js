    function configCenterButton(label, description, iconName, action) {
      return '' +
        '<button class="config-center-btn" type="button" onclick="' + action + '">' +
          '<span class="config-center-icon">' + uiIcon(iconName, 'md') + '</span>' +
          '<span class="config-center-text">' +
            '<span class="config-center-name">' + label + '</span>' +
            '<span class="config-center-desc">' + description + '</span>' +
          '</span>' +
        '</button>';
    }

    var userSkillManagerSkills = [];
    var userSkillDropdownLoaded = false;
    var userSkillDropdownLoading = false;
    var userSkillDialogReturnTarget = 'config';
    var userSkillDiscoveryCandidates = [];
    var userSkillDiscoverySearchResults = [];
    var skillOptimizationLabState = null;
    var skillOptimizationEditingCaseId = '';
    var availableAgentSkills = [];
    var targetVenuePeerReviewRuntimeCache = {};
    var TARGET_VENUE_PEER_REVIEW_SKILL_ID = 'scholar-harness-core:target-venue-peer-review';
    var AI_RESEARCH_SKILLS_LIBRARY_ID = 'orchestra-ai-research:ai-research-skills';

    function getTargetVenuePeerReviewStorageKey() {
      return 'scholarharness_target_venue_peer_review_' + (currentUserId || 'web-user');
    }

    function normalizeTargetVenuePeerReviewSetting(value) {
      var source = value && typeof value === 'object' ? value : {};
      return {
        enabled: source.enabled !== false,
        venue: String(source.venue || '').trim().slice(0, 180),
        articleType: String(source.articleType || '').trim().slice(0, 120),
        retrievedAt: String(source.retrievedAt || ''),
        requirementsMarkdown: String(source.requirementsMarkdown || '').slice(0, 30000),
        sources: Array.isArray(source.sources) ? source.sources.slice(0, 10) : [],
        officialSourceCount: Math.max(0, Number(source.officialSourceCount || 0)),
        warning: String(source.warning || '').slice(0, 1000)
      };
    }

    function loadTargetVenuePeerReviewSetting() {
      try {
        return normalizeTargetVenuePeerReviewSetting(JSON.parse(localStorage.getItem(getTargetVenuePeerReviewStorageKey()) || '{}'));
      } catch (e) {
        return normalizeTargetVenuePeerReviewSetting({});
      }
    }

    function persistTargetVenuePeerReviewSetting(value) {
      var normalized = normalizeTargetVenuePeerReviewSetting(value);
      localStorage.setItem(getTargetVenuePeerReviewStorageKey(), JSON.stringify(normalized));
      return normalized;
    }

    function normalizeTargetVenueComparison(value) {
      return String(value || '').toLowerCase().replace(/[\s\-_:：·•]+/g, ' ').trim();
    }

    function isTargetVenuePeerReviewIntent(message) {
      return /审稿|审阅|同行评审|评审报告|投稿前(?:评估|检查)|拒稿风险|目标(?:期刊|会议).{0,12}(?:要求|评审|审稿)|rebuttal|peer[\s-]?review|review(?:er)?\s+(?:report|comments?|manuscript|paper)|target[\s-]venue/i.test(String(message || ''));
    }

    function extractTargetVenueFromReviewMessage(message) {
      var text = String(message || '').replace(/[\r\n]+/g, ' ').trim();
      var match = /(?:投稿(?:到|至|给|于)|投稿目标|目标(?:期刊|会议)|target\s*(?:journal|venue|conference)?|venue)\s*(?:为|是|:|：)?\s*[《“"']?([^》”"'，。；;!?！？]{2,80})/i.exec(text);
      if (!match) return '';
      var candidate = String(match[1] || '')
        .replace(/\s*(?:进行|来|做|的)?(?:严格)?(?:审稿|评审|投稿前评估|要求).*/i, '')
        .replace(/[》”"']+$/g, '')
        .trim();
      if (!candidate || /^(?:的|要求|未指定|还没|按照|当前)/.test(candidate)) return '';
      return candidate.slice(0, 180);
    }

    async function fetchAvailableAgentSkills() {
      var response = await fetch(getUserSkillApiBase() + '/available');
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok || !data.success) throw new Error(data.error || '读取内置 Agent Skill 失败');
      availableAgentSkills = Array.isArray(data.skills) ? data.skills : [];
      return availableAgentSkills;
    }

    async function requestTargetVenueRequirements(venue, articleType) {
      var response = await fetch(getUserSkillApiBase() + '/target-venue-requirements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue: venue, articleType: articleType || '', maxSources: 7 })
      });
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok || !data.success) throw new Error(data.error || '目标期刊要求检索失败');
      return normalizeTargetVenuePeerReviewSetting({
        enabled: true,
        venue: data.venue || venue,
        articleType: data.articleType || articleType || '',
        retrievedAt: data.retrievedAt || '',
        requirementsMarkdown: data.requirementsMarkdown || '',
        sources: data.sources || [],
        officialSourceCount: data.officialSourceCount || 0,
        warning: data.warning || ''
      });
    }

    function saveTargetVenuePeerReviewConfig() {
      var current = loadTargetVenuePeerReviewSetting();
      var venue = String(document.getElementById('targetVenuePeerReviewVenue')?.value || '').trim();
      var articleType = String(document.getElementById('targetVenuePeerReviewArticleType')?.value || '').trim();
      var enabled = document.getElementById('targetVenuePeerReviewEnabled')?.checked !== false;
      var sameTarget = normalizeTargetVenueComparison(venue) === normalizeTargetVenueComparison(current.venue)
        && normalizeTargetVenueComparison(articleType) === normalizeTargetVenueComparison(current.articleType);
      persistTargetVenuePeerReviewSetting({
        enabled: enabled,
        venue: venue,
        articleType: articleType,
        retrievedAt: sameTarget ? current.retrievedAt : '',
        requirementsMarkdown: sameTarget ? current.requirementsMarkdown : '',
        sources: sameTarget ? current.sources : [],
        officialSourceCount: sameTarget ? current.officialSourceCount : 0,
        warning: sameTarget ? current.warning : ''
      });
      renderUserSkillManager('');
      var status = document.getElementById('targetVenuePeerReviewStatus');
      if (status) status.textContent = venue ? '目标已保存。审稿时会自动识别并调用该 Skill。' : '配置已保存；未指定目标时，审稿 Skill 会先要求用户提供期刊或会议。';
    }
    window.saveTargetVenuePeerReviewConfig = saveTargetVenuePeerReviewConfig;

    async function researchTargetVenuePeerReviewRequirements() {
      var venue = String(document.getElementById('targetVenuePeerReviewVenue')?.value || '').trim();
      var articleType = String(document.getElementById('targetVenuePeerReviewArticleType')?.value || '').trim();
      var status = document.getElementById('targetVenuePeerReviewStatus');
      var button = document.getElementById('targetVenuePeerReviewResearchBtn');
      if (!venue) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">请先填写目标期刊或会议。</span>';
        return;
      }
      if (button) {
        button.disabled = true;
        button.textContent = '检索中...';
      }
      if (status) status.textContent = '正在检索目标期刊/会议的官方投稿与评审要求...';
      try {
        var result = await requestTargetVenueRequirements(venue, articleType);
        result.enabled = document.getElementById('targetVenuePeerReviewEnabled')?.checked !== false;
        persistTargetVenuePeerReviewSetting(result);
        targetVenuePeerReviewRuntimeCache[normalizeTargetVenueComparison(venue)] = result;
        renderUserSkillManager('');
        var nextStatus = document.getElementById('targetVenuePeerReviewStatus');
        if (nextStatus) nextStatus.textContent = '已更新目标期刊要求，并保存 ' + result.sources.length + ' 个来源。';
      } catch (e) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">检索失败：' + escapeHtml(e.message || String(e)) + '</span>';
      } finally {
        var nextButton = document.getElementById('targetVenuePeerReviewResearchBtn');
        if (nextButton) {
          nextButton.disabled = false;
          nextButton.textContent = '联网检索要求';
        }
      }
    }
    window.researchTargetVenuePeerReviewRequirements = researchTargetVenuePeerReviewRequirements;

    function openTargetVenueRequirementSource(index) {
      var setting = loadTargetVenuePeerReviewSetting();
      var safeIndex = parseInt(index, 10);
      var source = Number.isFinite(safeIndex) ? setting.sources[safeIndex] : null;
      if (source && source.url) openExternalUrl(source.url);
    }
    window.openTargetVenueRequirementSource = openTargetVenueRequirementSource;

    function clearTargetVenuePeerReviewRequirements() {
      var setting = loadTargetVenuePeerReviewSetting();
      persistTargetVenuePeerReviewSetting({ enabled: setting.enabled });
      renderUserSkillManager('');
    }
    window.clearTargetVenuePeerReviewRequirements = clearTargetVenuePeerReviewRequirements;

    function renderBundledAgentSkillsHtml() {
      var bundledSkills = (Array.isArray(availableAgentSkills) ? availableAgentSkills : []).filter(function(skill) {
        return skill
          && skill.source === 'bundled'
          && skill.id !== TARGET_VENUE_PEER_REVIEW_SKILL_ID
          && skill.id !== AI_RESEARCH_SKILLS_LIBRARY_ID;
      });
      var cards = bundledSkills.length
        ? bundledSkills.map(function(skill) {
          return '<article style="display:flex;align-items:flex-start;gap:10px;padding:10px 11px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input);">' +
            '<div style="min-width:0;flex:1;">' +
              '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">' +
                '<span style="font-size:12px;font-weight:850;color:var(--text-primary);">' + escapeHtml(skill.name || skill.id || '内置 Skill') + '</span>' +
                '<span style="padding:2px 6px;border-radius:999px;background:var(--modal-tip-bg);color:var(--accent-color);font-size:9px;font-weight:850;">已内置</span>' +
                '<span style="font-size:9px;color:var(--text-secondary);">' + escapeHtml(skill.category || 'skill') + '</span>' +
              '</div>' +
              '<div style="margin-top:3px;color:var(--text-secondary);font-size:10px;line-height:1.5;">' + escapeHtml(skill.description || '无说明') + '</div>' +
              '<div style="margin-top:3px;color:var(--text-secondary);font-size:9px;">' + escapeHtml(skill.sourceLabel || '') + ' · ' + escapeHtml(skill.id || '') + '</div>' +
            '</div>' +
            '<button type="button" data-skill-id="' + escapeHtml(skill.id || '') + '" data-skill-name="' + escapeHtml(skill.name || '') + '" onclick="deleteBundledAgentSkillFromDialog(this.dataset.skillId, this.dataset.skillName)" style="flex:0 0 auto;height:28px;padding:0 8px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--danger-color);cursor:pointer;font-size:10px;">删除</button>' +
          '</article>';
        }).join('')
        : '<div style="padding:12px;border:1px dashed var(--border-color);border-radius:8px;color:var(--text-secondary);font-size:11px;">当前没有其他内置 Skill。</div>';
      return '<section style="margin-bottom:12px;padding:12px;border:1px solid var(--border-color);border-radius:9px;background:var(--bg-secondary);">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:9px;">' +
          '<div>' +
            '<div style="font-size:13px;font-weight:850;color:var(--text-primary);">已内置 Skill</div>' +
            '<div style="margin-top:3px;color:var(--text-secondary);font-size:10px;line-height:1.45;">随软件提供并参与自动意图识别。删除后仅对当前用户移除，不再提供给 AI。</div>' +
          '</div>' +
          '<span style="color:var(--text-secondary);font-size:10px;white-space:nowrap;">' + bundledSkills.length + ' 个</span>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:8px;">' + cards + '</div>' +
      '</section>';
    }

    function renderTargetVenuePeerReviewSkillHtml() {
      var setting = loadTargetVenuePeerReviewSetting();
      var descriptor = (availableAgentSkills || []).find(function(skill) {
        return skill && skill.id === TARGET_VENUE_PEER_REVIEW_SKILL_ID;
      });
      if (!descriptor) return '';
      var sourceHtml = setting.sources.length
        ? setting.sources.map(function(source, index) {
          return '<button type="button" data-index="' + index + '" onclick="openTargetVenueRequirementSource(this.dataset.index)" style="width:100%;display:flex;align-items:center;gap:8px;padding:7px 0;border:0;border-bottom:1px solid var(--border-color);background:transparent;color:var(--text-primary);text-align:left;cursor:pointer;font-size:11px;">' +
            '<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(source.title || source.url || '来源') + '</span>' +
            '<span style="flex:0 0 auto;color:' + (source.likelyOfficial ? 'var(--accent-color)' : 'var(--text-secondary)') + ';font-size:10px;">' + (source.likelyOfficial ? '疑似官方' : '待核验') + '</span>' +
          '</button>';
        }).join('')
        : '<div style="padding:8px 0;color:var(--text-secondary);font-size:11px;line-height:1.5;">填写目标后点击“联网检索要求”。系统会优先查找官方作者指南、范围、稿件类型、评审、匿名、数据代码、伦理与 AI 政策。</div>';
      var retrievedLabel = setting.retrievedAt
        ? new Date(setting.retrievedAt).toLocaleString('zh-CN', { hour12: false })
        : '';
      return '' +
        '<section id="targetVenuePeerReviewSkillCard" style="margin-bottom:12px;padding:12px;border:1px solid var(--border-color);border-radius:9px;background:var(--bg-secondary);">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">' +
            '<div style="min-width:0;">' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                '<span style="font-size:13px;font-weight:850;color:var(--text-primary);">目标期刊严格审稿</span>' +
                '<span style="font-size:10px;font-weight:800;color:var(--accent-color);">内置 Agent Skill</span>' +
              '</div>' +
              '<div style="margin-top:3px;font-size:11px;color:var(--text-secondary);line-height:1.5;">' + escapeHtml(descriptor?.description || '依据上传论文和目标期刊当前官方要求，生成证据可定位的严格审稿报告与改稿策略。') + '</div>' +
            '</div>' +
            '<label style="display:flex;align-items:center;gap:6px;flex:0 0 auto;color:var(--text-primary);font-size:11px;cursor:pointer;"><input id="targetVenuePeerReviewEnabled" type="checkbox" ' + (setting.enabled ? 'checked' : '') + ' style="width:14px;height:14px;accent-color:var(--accent-color);">审稿时自动调用</label>' +
          '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px;">' +
            '<input id="targetVenuePeerReviewVenue" value="' + escapeHtml(setting.venue) + '" placeholder="目标期刊或会议，例如 Nature Communications / ICML 2026" style="flex:2 1 320px;min-width:180px;height:34px;box-sizing:border-box;padding:0 9px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' +
            '<input id="targetVenuePeerReviewArticleType" value="' + escapeHtml(setting.articleType) + '" placeholder="文章类型/Track（可选）" style="flex:1 1 210px;min-width:160px;height:34px;box-sizing:border-box;padding:0 9px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' +
            '<button type="button" onclick="saveTargetVenuePeerReviewConfig()" style="height:34px;padding:0 11px;border:1px solid var(--border-color);border-radius:7px;background:transparent;color:var(--text-primary);cursor:pointer;font-size:12px;font-weight:750;white-space:nowrap;">保存目标</button>' +
            '<button type="button" id="targetVenuePeerReviewResearchBtn" onclick="researchTargetVenuePeerReviewRequirements()" style="height:34px;padding:0 11px;border:1px solid var(--accent-color);border-radius:7px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;font-weight:800;white-space:nowrap;">联网检索要求</button>' +
          '</div>' +
          '<div id="targetVenuePeerReviewStatus" style="min-height:17px;margin-top:7px;color:var(--text-secondary);font-size:11px;line-height:1.45;">' +
            (retrievedLabel ? '最近检索：' + escapeHtml(retrievedLabel) + '；来源 ' + setting.sources.length + ' 个，其中疑似官方 ' + setting.officialSourceCount + ' 个。' : '') +
          '</div>' +
          (setting.warning ? '<div style="margin-top:4px;color:var(--text-secondary);font-size:10px;line-height:1.5;">' + escapeHtml(setting.warning) + '</div>' : '') +
          '<details style="margin-top:6px;" ' + (setting.sources.length ? '' : 'open') + '>' +
            '<summary style="cursor:pointer;color:var(--text-primary);font-size:11px;font-weight:750;">目标期刊要求来源</summary>' +
            '<div style="max-height:170px;overflow:auto;margin-top:4px;">' + sourceHtml + '</div>' +
            (setting.requirementsMarkdown ? '<pre style="white-space:pre-wrap;max-height:190px;overflow:auto;margin:8px 0 0;padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--modal-bg);color:var(--text-primary);font-size:10px;line-height:1.5;">' + escapeHtml(setting.requirementsMarkdown) + '</pre>' : '') +
          '</details>' +
          '<div style="display:flex;justify-content:flex-end;margin-top:7px;"><button type="button" onclick="clearTargetVenuePeerReviewRequirements()" style="height:26px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:10px;">清除目标与检索结果</button></div>' +
        '</section>';
    }

    function renderAiResearchSkillsLibraryHtml() {
      var descriptor = (availableAgentSkills || []).find(function(skill) {
        return skill && skill.id === AI_RESEARCH_SKILLS_LIBRARY_ID;
      });
      if (!descriptor) return '';
      var categories = [
        '自主研究', '研究选题', 'ML 论文写作', '模型架构', '微调', '后训练',
        '分布式训练', '评测', '推理部署', 'RAG', 'Agent', '多模态', 'MLOps', '研究严谨性'
      ];
      return '' +
        '<section id="orchestraAiResearchSkillCard" style="margin-bottom:12px;padding:12px;border:1px solid var(--border-color);border-radius:9px;background:var(--bg-secondary);">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">' +
            '<div style="min-width:0;">' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                '<span style="font-size:13px;font-weight:850;color:var(--text-primary);">AI Research SKILLs</span>' +
                '<span style="font-size:10px;font-weight:800;color:var(--accent-color);">内置 98 项 · 23 类</span>' +
              '</div>' +
              '<div style="margin-top:3px;font-size:11px;color:var(--text-secondary);line-height:1.5;">' + escapeHtml(descriptor.description || '') + '</div>' +
            '</div>' +
            '<span style="flex:0 0 auto;font-size:10px;color:var(--accent-color);font-weight:800;">自动意图调用</span>' +
          '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:9px;">' + categories.map(function(category) {
            return '<span style="padding:2px 6px;border:1px solid var(--border-color);border-radius:999px;color:var(--text-secondary);font-size:10px;">' + escapeHtml(category) + '</span>';
          }).join('') + '</div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:9px;">' +
            '<span style="color:var(--text-secondary);font-size:10px;line-height:1.45;">按当前任务只读取相关子 Skill，不会把 98 项内容全部塞进每轮上下文。</span>' +
            '<button type="button" onclick="openExternalUrl(\'https://github.com/Orchestra-Research/AI-Research-SKILLs\')" style="height:28px;padding:0 9px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-primary);cursor:pointer;font-size:11px;white-space:nowrap;">查看来源</button>' +
          '</div>' +
        '</section>';
    }

    async function ensureTargetVenuePeerReviewContext(message) {
      if (!isTargetVenuePeerReviewIntent(message)) return null;
      var setting = loadTargetVenuePeerReviewSetting();
      if (!setting.enabled) return null;
      var explicitVenue = extractTargetVenueFromReviewMessage(message);
      var venue = explicitVenue || setting.venue;
      if (!venue) {
        return {
          enabled: true,
          skillId: TARGET_VENUE_PEER_REVIEW_SKILL_ID,
          venue: '',
          articleType: setting.articleType,
          requirementsMarkdown: '',
          sources: [],
          instruction: '当前没有确定目标期刊或会议。执行审稿前先向用户索要目标，不得猜测。'
        };
      }
      var sameConfiguredVenue = normalizeTargetVenueComparison(venue) === normalizeTargetVenueComparison(setting.venue);
      var retrievedTime = Date.parse(setting.retrievedAt || '') || 0;
      var cacheFresh = sameConfiguredVenue && setting.requirementsMarkdown && Date.now() - retrievedTime < 14 * 24 * 60 * 60 * 1000;
      var cacheKey = normalizeTargetVenueComparison(venue);
      var result = cacheFresh ? setting : targetVenuePeerReviewRuntimeCache[cacheKey];
      if (!result) {
        try {
          result = await requestTargetVenueRequirements(venue, sameConfiguredVenue ? setting.articleType : '');
          targetVenuePeerReviewRuntimeCache[cacheKey] = result;
          if (sameConfiguredVenue) persistTargetVenuePeerReviewSetting(result);
        } catch (e) {
          result = normalizeTargetVenuePeerReviewSetting({
            enabled: true,
            venue: venue,
            articleType: sameConfiguredVenue ? setting.articleType : '',
            warning: '联网检索失败：' + (e.message || String(e))
          });
        }
      }
      return Object.assign({}, result, {
        enabled: true,
        skillId: TARGET_VENUE_PEER_REVIEW_SKILL_ID,
        configuredVenue: setting.venue,
        explicitVenue: explicitVenue,
        instruction: explicitVenue
          ? '用户本轮明确指定的目标优先于 Skill 界面的默认目标。'
          : '本轮未明确改写目标，使用 Skill 界面保存的默认目标。'
      });
    }

    function getUserSkillDialogBackAction() {
      return userSkillDialogReturnTarget === 'main-context-skill'
        ? 'showMainContextSkillDialog()'
        : 'showConfigCenterDialog()';
    }

    function getUserSkillDialogBackLabel() {
      return userSkillDialogReturnTarget === 'main-context-skill'
        ? '返回 Skill'
        : '返回配置首页';
    }

    function getUserSkillApiBase() {
      return '/api/user-skills/' + encodeURIComponent(currentUserId || 'web-user');
    }

    function getSkillOptimizationApiBase(skillId) {
      return getUserSkillApiBase() + '/' + encodeURIComponent(skillId || '') + '/optimization';
    }

    function renderSkillOptimizationEntryHtml(selectedSkillId) {
      var skills = Array.isArray(userSkillManagerSkills) ? userSkillManagerSkills : [];
      var activeId = selectedSkillId || (skills[0] && skills[0].id) || '';
      var options = skills.map(function(skill) {
        return '<option value="' + escapeHtml(skill.id) + '" ' + (skill.id === activeId ? 'selected' : '') + '>/' + escapeHtml(skill.trigger || '') + ' · ' + escapeHtml(skill.name || 'Skill') + '</option>';
      }).join('');
      return '' +
        '<section style="margin-bottom:12px;padding:12px;border:1px solid var(--border-color);border-radius:9px;background:var(--bg-secondary);">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
            '<div style="min-width:0;flex:1 1 360px;">' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                '<span style="font-size:13px;font-weight:850;color:var(--text-primary);">Skill 优化实验室</span>' +
                '<span style="font-size:10px;font-weight:800;color:var(--accent-color);">验证门控 · 本地版本</span>' +
              '</div>' +
              '<div style="margin-top:3px;font-size:11px;color:var(--text-secondary);line-height:1.5;">从真实聊天轨迹中生成候选 Skill，分别用 Little corse、Grass 或 Codex 复测；只有候选分数严格高于当前版本才允许启用。</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;flex:1 1 320px;justify-content:flex-end;">' +
              '<select id="skillOptimizationEntrySelect" ' + (skills.length ? '' : 'disabled') + ' style="min-width:190px;max-width:320px;height:34px;padding:0 8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:11px;">' + (options || '<option>请先创建用户 Skill</option>') + '</select>' +
              '<button type="button" onclick="openSelectedSkillOptimizationLab()" ' + (skills.length ? '' : 'disabled') + ' style="height:34px;padding:0 11px;border:1px solid var(--accent-color);border-radius:7px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;font-weight:800;white-space:nowrap;">打开实验室</button>' +
            '</div>' +
          '</div>' +
          '<div style="margin-top:8px;color:var(--text-secondary);font-size:10px;line-height:1.5;">不会自动覆盖正式 Skill；轨迹和版本只保存在本机，发送给优化模型前会遮蔽本地路径、邮箱和疑似密钥。</div>' +
        '</section>';
    }

    function openSelectedSkillOptimizationLab() {
      var select = document.getElementById('skillOptimizationEntrySelect');
      var skillId = String(select && select.value || '').trim();
      if (skillId) showSkillOptimizationLab(skillId);
    }
    window.openSelectedSkillOptimizationLab = openSelectedSkillOptimizationLab;

    function normalizeUserSkillTrigger(value) {
      return String(value || '').trim().replace(/^\/+/, '').replace(/\s+/g, '');
    }

    function makeUserSkillTriggerFromText(value) {
      var raw = String(value || '').trim().toLowerCase();
      raw = raw
        .replace(/\.(md|markdown|txt)$/i, '')
        .replace(/[_\s]+/g, '-')
        .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32);
      return raw || 'skill';
    }

    function getUniqueUserSkillTrigger(baseTrigger) {
      var base = makeUserSkillTriggerFromText(baseTrigger);
      var existing = new Set((userSkillManagerSkills || []).map(function(skill) {
        return String(skill.trigger || '').toLowerCase();
      }));
      if (!existing.has(base.toLowerCase())) return base;
      var root = base.slice(0, 28).replace(/-+$/g, '') || 'skill';
      for (var i = 2; i < 100; i++) {
        var candidate = (root + '-' + i).slice(0, 32);
        if (!existing.has(candidate.toLowerCase())) return candidate;
      }
      return (root + '-' + Date.now().toString(36)).slice(0, 32);
    }

    function inferUserSkillFromMarkdown(filename, content) {
      var text = String(content || '').trim();
      var firstHeading = '';
      var headingMatch = text.match(/^\s*#\s+(.+)$/m);
      if (headingMatch) {
        firstHeading = headingMatch[1].trim().replace(/\s+#*$/, '');
      }
      var stem = String(filename || 'skill').replace(/\.(md|markdown|txt)$/i, '').trim();
      var displayName = firstHeading || (stem && !/^skill$/i.test(stem) ? stem : '用户 Skill');
      var triggerSource = firstHeading || stem || displayName;
      return {
        name: displayName.slice(0, 80),
        trigger: getUniqueUserSkillTrigger(triggerSource),
        description: '从 ' + filename + ' 导入',
        prompt: text,
        enabled: true
      };
    }

    function readUserSkillFileAsText(file) {
      return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function() { resolve(String(reader.result || '')); };
        reader.onerror = function() { reject(reader.error || new Error('读取文件失败')); };
        reader.readAsText(file, 'utf-8');
      });
    }

    async function fetchUserSkills() {
      var response = await fetch(getUserSkillApiBase());
      var data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || '读取用户 Skill 失败');
      }
      userSkillManagerSkills = Array.isArray(data.skills) ? data.skills : [];
      return userSkillManagerSkills;
    }

    function renderUserSkillDiscoveryResultsHtml() {
      var hasCandidates = Array.isArray(userSkillDiscoveryCandidates) && userSkillDiscoveryCandidates.length > 0;
      var hasSearchResults = Array.isArray(userSkillDiscoverySearchResults) && userSkillDiscoverySearchResults.length > 0;
      if (!hasCandidates && !hasSearchResults) {
        return '';
      }
      var parts = [];
      if (hasSearchResults) {
        parts.push('<div style="grid-column:1/-1;margin-top:2px;font-size:12px;font-weight:850;color:var(--text-primary);">联网检索结果</div>');
        parts.push(userSkillDiscoverySearchResults.map(function(result, index) {
          return '' +
            '<div style="padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input);min-width:0;">' +
              '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">' +
                '<div style="min-width:0;">' +
                  '<div style="font-size:12px;font-weight:850;color:var(--text-primary);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + escapeHtml(result.title || '检索结果') + '</div>' +
                  '<div style="margin-top:4px;color:var(--text-secondary);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(result.url || '') + '</div>' +
                '</div>' +
                '<span style="flex:0 0 auto;font-size:10px;color:var(--accent-color);font-weight:800;">' + escapeHtml(result.source || 'web') + '</span>' +
              '</div>' +
              (result.snippet ? '<div style="margin-top:7px;color:var(--text-secondary);font-size:11px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">' + escapeHtml(result.snippet) + '</div>' : '') +
              '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:9px;">' +
                '<button type="button" data-index="' + index + '" onclick="openUserSkillDiscoveryResult(this.dataset.index)" style="height:28px;padding:0 9px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-primary);cursor:pointer;font-size:11px;font-weight:700;">打开链接</button>' +
                (result.importable ? '<button type="button" data-index="' + index + '" onclick="importUserSkillDiscoveryResult(this.dataset.index)" style="height:28px;padding:0 9px;border:1px solid var(--accent-color);border-radius:6px;background:transparent;color:var(--accent-color);cursor:pointer;font-size:11px;font-weight:800;">从此 GitHub 导入</button>' : '') +
              '</div>' +
            '</div>';
        }).join(''));
      }
      if (hasCandidates) {
        parts.push('<div style="grid-column:1/-1;margin-top:2px;font-size:12px;font-weight:850;color:var(--text-primary);">可直接安装的内置候选</div>');
      }
      parts.push(userSkillDiscoveryCandidates.map(function(candidate, index) {
        var tags = Array.isArray(candidate.tags) ? candidate.tags.slice(0, 5) : [];
        return '' +
          '<div style="padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input);min-width:0;">' +
            '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">' +
              '<div style="min-width:0;">' +
                '<div style="font-size:12px;font-weight:850;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">/' + escapeHtml(candidate.trigger || '') + ' · ' + escapeHtml(candidate.name || '学术写作 Skill') + '</div>' +
                '<div style="margin-top:4px;color:var(--text-secondary);font-size:11px;line-height:1.45;">' + escapeHtml(candidate.description || '') + '</div>' +
              '</div>' +
              '<span style="flex:0 0 auto;font-size:10px;color:var(--accent-color);font-weight:800;">' + escapeHtml(String(candidate.relevance || '')) + '</span>' +
            '</div>' +
            (tags.length ? '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;">' + tags.map(function(tag) {
              return '<span style="padding:2px 6px;border:1px solid var(--border-color);border-radius:999px;color:var(--text-secondary);font-size:10px;">' + escapeHtml(tag) + '</span>';
            }).join('') + '</div>' : '') +
            '<details style="margin-top:8px;color:var(--text-secondary);font-size:11px;line-height:1.5;">' +
              '<summary style="cursor:pointer;color:var(--text-primary);font-weight:700;">预览 Skill 指令</summary>' +
              '<pre style="white-space:pre-wrap;max-height:150px;overflow:auto;margin:7px 0 0;padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--modal-bg);color:var(--text-primary);font-size:11px;line-height:1.45;">' + escapeHtml(candidate.prompt || '') + '</pre>' +
            '</details>' +
            '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:9px;">' +
              '<button type="button" data-index="' + index + '" onclick="fillUserSkillFormWithDiscovery(this.dataset.index)" style="height:28px;padding:0 9px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-primary);cursor:pointer;font-size:11px;font-weight:700;">填入表单</button>' +
              '<button type="button" data-index="' + index + '" onclick="saveDiscoveredUserSkill(this.dataset.index, false)" style="height:28px;padding:0 9px;border:1px solid var(--accent-color);border-radius:6px;background:transparent;color:var(--accent-color);cursor:pointer;font-size:11px;font-weight:800;">保存 Skill</button>' +
              '<button type="button" data-index="' + index + '" onclick="saveDiscoveredUserSkill(this.dataset.index, true)" style="height:28px;padding:0 9px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:11px;font-weight:800;">保存并持续使用</button>' +
            '</div>' +
          '</div>';
      }).join(''));
      return parts.join('');
    }

    function renderUserSkillManager(editId, embedded) {
      var selected = editId
        ? userSkillManagerSkills.find(function(skill) { return skill.id === editId; })
        : null;
      var formSkill = selected || { id: '', name: '', trigger: '', description: '', prompt: '', enabled: true };
      var listHtml = userSkillManagerSkills.length
        ? userSkillManagerSkills.map(function(skill) {
          var active = selected && selected.id === skill.id;
          return '' +
            '<button class="user-skill-list-item" type="button" data-skill-id="' + escapeHtml(skill.id) + '" onclick="selectUserSkillForEdit(this.dataset.skillId)" style="width:100%;display:flex;align-items:center;gap:10px;text-align:left;margin-bottom:0;color:var(--text-primary);cursor:pointer;">' +
              '<span class="skill-catalog-icon category-user" aria-hidden="true"></span>' +
              '<span style="flex:1;min-width:0;">' +
                '<span style="display:block;font-size:12px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">/' + escapeHtml(skill.trigger) + ' · ' + escapeHtml(skill.name) + '</span>' +
                '<span style="display:block;margin-top:2px;font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(skill.description || '无说明') + '</span>' +
              '</span>' +
              '<span style="font-size:10px;color:' + (skill.enabled === false ? 'var(--text-secondary)' : 'var(--accent-color)') + ';">' + (skill.enabled === false ? '停用' : '启用') + '</span>' +
            '</button>';
        }).join('')
        : '<div style="padding:14px;border:1px dashed var(--border-color);border-radius:8px;color:var(--text-secondary);font-size:12px;line-height:1.6;">还没有用户 Skill。右侧新增后，可以在任意聊天框输入 <code>/命令名</code> 调用。</div>';

      var html = '' +
        '<div id="userSkillDropZone" ondragover="handleUserSkillDragOver(event)" ondragleave="handleUserSkillDragLeave(event)" ondrop="handleUserSkillDrop(event)" style="margin-bottom:14px;padding:6px;border:1px dashed var(--border-color);border-radius:10px;background:var(--bg-secondary);">' +
          '<input id="userSkillFileInput" type="file" accept=".md,.markdown,.txt" multiple onchange="importUserSkillFiles(this.files)" style="display:none;">' +
          '<div style="display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:center;">' +
            '<button type="button" class="home-utility-search-action" onclick="document.getElementById(\'userSkillFileInput\')?.click()" style="height:38px;"><span aria-hidden="true">＋</span><span>导入已有 Skill 文件</span></button>' +
            '<input id="userSkillUnifiedInput" onkeydown="if(event.key===\'Enter\'){event.preventDefault();handleUnifiedUserSkillInput();}" placeholder="输入 Skill 需求、粘贴 GitHub 链接，或拖入 .md / .txt 文件" style="min-width:0;width:100%;height:38px;padding:0 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' +
            '<button type="button" id="userSkillUnifiedActionBtn" onclick="handleUnifiedUserSkillInput()" style="height:38px;padding:0 13px;border:1px solid var(--accent-color);border-radius:8px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;font-weight:800;white-space:nowrap;">识别并执行</button>' +
          '</div>' +
          '<div id="userSkillDiscoveryStatus" class="user-skill-unified-status" style="color:var(--text-secondary);font-size:11px;line-height:1.45;"></div>' +
          '<div id="userSkillDiscoveryResults" class="user-skill-unified-results" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;">' + renderUserSkillDiscoveryResultsHtml() + '</div>' +
        '</div>' +
        '<div>' +
          '<section style="min-width:0;padding:12px;border:1px solid var(--border-color);border-radius:9px;background:var(--bg-secondary);">' +
            '<div style="margin:0 0 12px;font-size:14px;font-weight:800;color:var(--text-primary);">手动添加 Skill</div>' +
            '<input type="hidden" id="userSkillId" value="' + escapeHtml(formSkill.id || '') + '">' +
            '<input type="hidden" id="userSkillTrigger" value="' + escapeHtml(formSkill.trigger || '') + '">' +
            '<label style="display:block;font-size:12px;font-weight:750;color:var(--text-primary);margin-bottom:5px;">Skill 名称</label>' +
            '<input id="userSkillName" value="' + escapeHtml(formSkill.name || '') + '" placeholder="例如：GCB讨论段落" style="width:100%;padding:9px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:12px;margin-bottom:10px;">' +
            '<label style="display:block;font-size:12px;font-weight:750;color:var(--text-primary);margin-bottom:5px;">Skill 用途说明</label>' +
            '<input id="userSkillDescription" value="' + escapeHtml(formSkill.description || '') + '" placeholder="简要说明这个 Skill 适合处理什么任务" style="width:100%;padding:9px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:12px;margin-bottom:10px;">' +
            '<label style="display:block;font-size:12px;font-weight:750;color:var(--text-primary);margin-bottom:5px;">Skill 指令</label>' +
            '<textarea id="userSkillPrompt" placeholder="写清楚这个 skill 要约束 AI 做什么，例如写作风格、论证结构、引用要求、输出格式等。" style="width:100%;min-height:170px;padding:9px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:12px;line-height:1.55;resize:vertical;">' + escapeHtml(formSkill.prompt || '') + '</textarea>' +
            '<input id="userSkillEnabled" type="checkbox" checked hidden>' +
            '<div class="user-skill-form-actions">' +
              (formSkill.id ? '<button class="user-skill-form-action user-skill-form-delete" type="button" data-skill-id="' + escapeHtml(formSkill.id) + '" onclick="deleteUserSkillFromDialog(this.dataset.skillId)">删除</button>' : '') +
              '<button id="userSkillSaveButton" class="user-skill-form-action user-skill-form-save" type="button" onclick="saveUserSkillFromDialog()">保存 Skill</button>' +
            '</div>' +
            '<div id="userSkillDialogStatus" style="min-height:18px;margin-top:5px;font-size:12px;color:var(--text-secondary);line-height:1.5;"></div>' +
          '</section>' +
        '</div>';
      if (embedded) return html;
      showHomeUtilityPage(
        'persistent-skill',
        'Skill',
        '选择持续使用规则，并添加、导入和维护 Skill',
        html
      );
    }

    async function showUserSkillDialog(editId, returnTarget) {
      userSkillDialogReturnTarget = returnTarget || 'config';
      showHomeUtilityPage(
        'persistent-skill',
        'Skill',
        '选择持续使用规则，并添加、导入和维护 Skill',
        '<div class="home-page-card" style="color:var(--text-secondary);">正在读取用户 Skill...</div>'
      );
      try {
        var skillLoads = await Promise.allSettled([fetchUserSkills(), fetchAvailableAgentSkills()]);
        if (skillLoads[0].status === 'rejected') throw skillLoads[0].reason;
        if (skillLoads[1].status === 'rejected') {
          console.warn('[AgentSkills] Failed to load bundled Skill descriptors:', skillLoads[1].reason);
        }
        renderUserSkillManager(editId || '');
      } catch (e) {
        showHomeUtilityPage(
          'persistent-skill',
          'Skill',
          '选择持续使用规则，并添加、导入和维护 Skill',
          '<div class="home-page-card" style="color:var(--danger-color);">读取失败：' + escapeHtml(e.message || String(e)) + '</div><div class="btns"><button class="cancel" onclick="' + getUserSkillDialogBackAction() + '">' + getUserSkillDialogBackLabel() + '</button></div>'
        );
      }
    }
    window.showUserSkillDialog = showUserSkillDialog;

    function skillOptimizationProviderLabel(value) {
      if (value === 'primary') return 'Grass';
      if (value === 'codex') return 'Codex';
      return 'Little corse';
    }

    function skillOptimizationOutcomeLabel(value) {
      if (value === 'success') return '成功';
      if (value === 'partial') return '部分成功';
      if (value === 'failure') return '失败';
      return '待复核';
    }

    function parseSkillOptimizationTerms(value) {
      var seen = new Set();
      return String(value || '').split(/[，,;；\n]+/).map(function(item) {
        return item.trim();
      }).filter(function(item) {
        var key = item.toLowerCase();
        if (!item || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 30);
    }

    function findSkillOptimizationCase(caseId) {
      var cases = skillOptimizationLabState && Array.isArray(skillOptimizationLabState.trajectories)
        ? skillOptimizationLabState.trajectories
        : [];
      return cases.find(function(item) { return item.id === caseId; }) || null;
    }

    function findSkillOptimizationCandidate(candidateId) {
      var candidates = skillOptimizationLabState && Array.isArray(skillOptimizationLabState.candidates)
        ? skillOptimizationLabState.candidates
        : [];
      return candidates.find(function(item) { return item.id === candidateId; }) || null;
    }

    async function requestSkillOptimization(url, options) {
      var response = await fetch(url, options || {});
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok || !data.success) throw new Error(data.error || 'Skill 优化操作失败');
      return data;
    }

    function skillOptimizationStatChip(label, value) {
      return '<span style="display:inline-flex;align-items:center;gap:5px;height:27px;padding:0 8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-secondary);font-size:10px;"><strong style="color:var(--text-primary);font-size:11px;">' + escapeHtml(String(value || 0)) + '</strong>' + escapeHtml(label) + '</span>';
    }

    function renderSkillOptimizationCasesHtml() {
      var cases = skillOptimizationLabState && Array.isArray(skillOptimizationLabState.trajectories)
        ? skillOptimizationLabState.trajectories.slice(0, 30)
        : [];
      if (!cases.length) {
        return '<div style="padding:12px;border:1px dashed var(--border-color);border-radius:8px;color:var(--text-secondary);font-size:11px;line-height:1.6;">使用用户 Skill 完成聊天后，轨迹会自动出现在这里；也可以手动添加验证任务。</div>';
      }
      return cases.map(function(item) {
        var configured = (item.expectedTerms && item.expectedTerms.length) || (item.forbiddenTerms && item.forbiddenTerms.length);
        var color = item.outcome === 'failure' ? 'var(--danger-color)' : (configured ? 'var(--accent-color)' : 'var(--text-secondary)');
        return '' +
          '<article style="padding:9px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input);margin-bottom:7px;">' +
            '<div style="display:flex;align-items:flex-start;gap:8px;">' +
              '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:11px;font-weight:750;color:var(--text-primary);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + escapeHtml(item.query || '') + '</div>' +
                '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;color:var(--text-secondary);font-size:9px;">' +
                  '<span style="color:' + color + ';font-weight:800;">' + escapeHtml(skillOptimizationOutcomeLabel(item.outcome)) + '</span>' +
                  '<span>' + escapeHtml(skillOptimizationProviderLabel(item.provider)) + '</span>' +
                  '<span>' + (item.source === 'chat' ? '聊天轨迹' : '手动案例') + '</span>' +
                  (configured ? '<span>验证规则 ' + Number((item.expectedTerms || []).length + (item.forbiddenTerms || []).length) + ' 条</span>' : '<span>尚未配置验证规则</span>') +
                '</div>' +
              '</div>' +
              '<div style="display:flex;gap:5px;flex:0 0 auto;">' +
                '<button type="button" data-case-id="' + escapeHtml(item.id) + '" onclick="editSkillOptimizationCase(this.dataset.caseId)" style="height:25px;padding:0 7px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-primary);cursor:pointer;font-size:10px;">' + (configured ? '编辑' : '配置验证') + '</button>' +
                '<button type="button" data-case-id="' + escapeHtml(item.id) + '" onclick="deleteSkillOptimizationCaseFromLab(this.dataset.caseId)" title="删除案例" style="width:25px;height:25px;border:0;border-radius:6px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:15px;">×</button>' +
              '</div>' +
            '</div>' +
            (item.response ? '<details style="margin-top:6px;"><summary style="cursor:pointer;color:var(--text-secondary);font-size:10px;">查看原回答</summary><pre style="white-space:pre-wrap;max-height:150px;overflow:auto;margin:6px 0 0;padding:7px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-bg);color:var(--text-primary);font-size:10px;line-height:1.45;">' + escapeHtml(item.response) + '</pre></details>' : '') +
          '</article>';
      }).join('');
    }

    function renderSkillOptimizationCandidatesHtml() {
      var candidates = skillOptimizationLabState && Array.isArray(skillOptimizationLabState.candidates)
        ? skillOptimizationLabState.candidates.slice(0, 12)
        : [];
      if (!candidates.length) {
        return '<div style="padding:12px;border:1px dashed var(--border-color);border-radius:8px;color:var(--text-secondary);font-size:11px;line-height:1.6;">复核至少一条轨迹后，使用 Grass 生成受控修改的候选 Skill。</div>';
      }
      return candidates.map(function(candidate) {
        var evaluation = candidate.evaluation || null;
        var accepted = !!(evaluation && evaluation.accepted);
        var statusLabel = candidate.status === 'activated' ? '已启用' : (accepted ? '验证通过' : (candidate.status === 'rejected' ? '未超过基线' : '待验证'));
        var statusColor = candidate.status === 'activated' || accepted ? 'var(--accent-color)' : (candidate.status === 'rejected' ? 'var(--danger-color)' : 'var(--text-secondary)');
        return '' +
          '<article style="padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input);margin-bottom:8px;">' +
            '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">' +
              '<div style="min-width:0;">' +
                '<div style="font-size:11px;font-weight:800;color:var(--text-primary);">候选版本 · ' + escapeHtml(skillOptimizationProviderLabel(candidate.targetProvider)) + '</div>' +
                '<div style="margin-top:3px;color:var(--text-secondary);font-size:10px;">优化器：' + escapeHtml(skillOptimizationProviderLabel(candidate.optimizerProvider)) + ' · 证据 ' + Number((candidate.sourceTrajectoryIds || []).length) + ' 条</div>' +
              '</div>' +
              '<span style="flex:0 0 auto;color:' + statusColor + ';font-size:10px;font-weight:850;">' + statusLabel + '</span>' +
            '</div>' +
            (evaluation ? '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:8px;">' +
              skillOptimizationStatChip('基线', evaluation.baselineScore) +
              skillOptimizationStatChip('候选', evaluation.candidateScore) +
              skillOptimizationStatChip('提升', (evaluation.improvement > 0 ? '+' : '') + evaluation.improvement) +
            '</div>' : '') +
            ((candidate.editSummary || []).length ? '<div style="margin-top:7px;color:var(--text-secondary);font-size:10px;line-height:1.5;">' + candidate.editSummary.map(function(item) { return '• ' + escapeHtml(item); }).join('<br>') + '</div>' : '') +
            '<details style="margin-top:7px;"><summary style="cursor:pointer;color:var(--text-primary);font-size:10px;font-weight:750;">预览完整候选 Skill</summary><pre style="white-space:pre-wrap;max-height:240px;overflow:auto;margin:6px 0 0;padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--modal-bg);color:var(--text-primary);font-size:10px;line-height:1.5;">' + escapeHtml(candidate.candidatePrompt || '') + '</pre></details>' +
            '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:9px;">' +
              (candidate.status === 'pending' || candidate.status === 'rejected' ? '<button type="button" data-candidate-id="' + escapeHtml(candidate.id) + '" onclick="evaluateSkillOptimizationCandidateFromLab(this.dataset.candidateId)" style="height:28px;padding:0 9px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-primary);cursor:pointer;font-size:10px;font-weight:750;">运行基线/候选验证</button>' : '') +
              (candidate.status === 'validated' && accepted ? '<button type="button" data-candidate-id="' + escapeHtml(candidate.id) + '" onclick="activateSkillOptimizationCandidateFromLab(this.dataset.candidateId)" style="height:28px;padding:0 9px;border:1px solid var(--accent-color);border-radius:6px;background:var(--accent-color);color:white;cursor:pointer;font-size:10px;font-weight:800;">确认启用</button>' : '') +
            '</div>' +
          '</article>';
      }).join('');
    }

    function renderSkillOptimizationVersionsHtml() {
      var versions = skillOptimizationLabState && Array.isArray(skillOptimizationLabState.versions)
        ? skillOptimizationLabState.versions.slice(0, 16)
        : [];
      if (!versions.length) {
        return '<div style="color:var(--text-secondary);font-size:10px;line-height:1.5;">首次启用通过验证的候选后，会自动保存当前版本用于回滚。</div>';
      }
      return versions.map(function(version) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border-color);">' +
          '<div style="flex:1;min-width:0;"><div style="font-size:10px;font-weight:750;color:var(--text-primary);">' + escapeHtml(version.label || 'Skill 版本') + '</div><div style="margin-top:2px;color:var(--text-secondary);font-size:9px;">' + escapeHtml(new Date(version.createdAt).toLocaleString('zh-CN', { hour12: false })) + (version.provider ? ' · ' + escapeHtml(skillOptimizationProviderLabel(version.provider)) : '') + '</div></div>' +
          '<button type="button" data-version-id="' + escapeHtml(version.id) + '" onclick="rollbackSkillOptimizationVersionFromLab(this.dataset.versionId)" style="height:25px;padding:0 7px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-primary);cursor:pointer;font-size:10px;">恢复</button>' +
        '</div>';
      }).join('');
    }

    function renderSkillOptimizationLab() {
      var lab = skillOptimizationLabState || {};
      var skill = lab.skill || {};
      var stats = lab.stats || {};
      var skillOptions = (userSkillManagerSkills || []).map(function(item) {
        return '<option value="' + escapeHtml(item.id) + '" ' + (item.id === skill.id ? 'selected' : '') + '>/' + escapeHtml(item.trigger || '') + ' · ' + escapeHtml(item.name || 'Skill') + '</option>';
      }).join('');
      var html = '' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:11px;">' +
          '<select id="skillOptimizationSkillSelect" onchange="changeSkillOptimizationLab(this.value)" style="flex:1 1 260px;min-width:220px;height:36px;padding:0 9px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' + skillOptions + '</select>' +
          '<select id="skillOptimizationTargetProvider" style="height:36px;padding:0 9px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:11px;">' +
            '<option value="secondary">Little corse 验证</option><option value="primary">Grass 验证</option><option value="codex">Codex 验证</option>' +
          '</select>' +
          '<button type="button" id="skillOptimizationGenerateBtn" onclick="generateSkillOptimizationCandidateFromLab()" style="height:36px;padding:0 11px;border:1px solid var(--accent-color);border-radius:7px;background:var(--accent-color);color:white;cursor:pointer;font-size:11px;font-weight:800;">生成候选版本</button>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:9px;">' +
          skillOptimizationStatChip('轨迹', stats.totalTrajectories) + skillOptimizationStatChip('验证案例', stats.validationCases) + skillOptimizationStatChip('待复核', stats.pendingReview) + skillOptimizationStatChip('候选', stats.pendingCandidates) +
        '</div>' +
        '<div style="padding:8px 9px;border-radius:7px;background:var(--modal-tip-bg);color:var(--text-secondary);font-size:10px;line-height:1.5;margin-bottom:11px;">' + escapeHtml(lab.privacy || '') + '</div>' +
        '<div id="skillOptimizationStatus" style="min-height:18px;margin-bottom:7px;color:var(--text-secondary);font-size:11px;line-height:1.5;"></div>' +
        '<div style="display:grid;grid-template-columns:minmax(300px,0.9fr) minmax(360px,1.1fr);gap:12px;align-items:start;">' +
          '<section style="min-width:0;">' +
            '<div style="font-size:12px;font-weight:850;color:var(--text-primary);margin-bottom:7px;">轨迹与验证案例</div>' +
            '<div style="padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);margin-bottom:9px;">' +
              '<input type="hidden" id="skillOptimizationCaseId" value="">' +
              '<textarea id="skillOptimizationCaseQuery" placeholder="验证任务，例如：根据上传文件判断哪一个 Word 草稿最新，并直接回答用户问题" style="width:100%;min-height:68px;padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:11px;line-height:1.45;resize:vertical;"></textarea>' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px;">' +
                '<input id="skillOptimizationExpectedTerms" placeholder="期望词，用逗号分隔" style="min-width:0;height:33px;padding:0 8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:10px;">' +
                '<input id="skillOptimizationForbiddenTerms" placeholder="禁用词，用逗号分隔" style="min-width:0;height:33px;padding:0 8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:10px;">' +
              '</div>' +
              '<div style="display:grid;grid-template-columns:auto 1fr;gap:7px;margin-top:7px;">' +
                '<select id="skillOptimizationCaseOutcome" style="height:33px;padding:0 8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:10px;"><option value="failure">失败案例</option><option value="partial">部分成功</option><option value="success">成功案例</option><option value="unreviewed">待复核</option></select>' +
                '<input id="skillOptimizationCaseNotes" placeholder="失败原因或需要保留的行为" style="min-width:0;height:33px;padding:0 8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:10px;">' +
              '</div>' +
              '<div style="display:flex;justify-content:flex-end;gap:7px;margin-top:8px;"><button type="button" onclick="clearSkillOptimizationCaseForm()" style="height:27px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:10px;">清空</button><button type="button" onclick="saveSkillOptimizationCaseFromLab()" style="height:27px;padding:0 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--modal-bg);color:var(--text-primary);cursor:pointer;font-size:10px;font-weight:750;">保存验证案例</button></div>' +
            '</div>' +
            '<div style="max-height:430px;overflow:auto;padding-right:2px;">' + renderSkillOptimizationCasesHtml() + '</div>' +
          '</section>' +
          '<section style="min-width:0;">' +
            '<div style="font-size:12px;font-weight:850;color:var(--text-primary);margin-bottom:7px;">候选版本与验证门</div>' +
            '<div style="max-height:520px;overflow:auto;padding-right:2px;">' + renderSkillOptimizationCandidatesHtml() + '</div>' +
            '<details style="margin-top:10px;padding:9px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);"><summary style="cursor:pointer;color:var(--text-primary);font-size:11px;font-weight:800;">版本历史与回滚</summary><div style="margin-top:5px;">' + renderSkillOptimizationVersionsHtml() + '</div></details>' +
          '</section>' +
        '</div>' +
        '<div class="btns" style="margin-top:13px;"><button class="cancel" onclick="showUserSkillDialog(\'' + escapeHtml(skill.id || '') + '\', userSkillDialogReturnTarget)">返回 Skill 管理</button><button class="cancel" onclick="closeModal()">关闭</button></div>';
      showModal('Skill 优化实验室', html, true, false);
    }

    async function showSkillOptimizationLab(skillId) {
      if (!skillId) return;
      skillOptimizationEditingCaseId = '';
      showModal('Skill 优化实验室', '<div style="padding:20px;color:var(--text-secondary);">正在读取本地轨迹、候选版本和验证结果...</div>', true, false);
      try {
        skillOptimizationLabState = await requestSkillOptimization(getSkillOptimizationApiBase(skillId));
        renderSkillOptimizationLab();
      } catch (e) {
        showModal('Skill 优化实验室', '<div style="padding:12px;color:var(--danger-color);">读取失败：' + escapeHtml(e.message || String(e)) + '</div><div class="btns"><button class="cancel" onclick="showUserSkillDialog(\'' + escapeHtml(skillId) + '\', userSkillDialogReturnTarget)">返回 Skill 管理</button></div>', true, false);
      }
    }
    window.showSkillOptimizationLab = showSkillOptimizationLab;

    function changeSkillOptimizationLab(skillId) {
      if (skillId) showSkillOptimizationLab(skillId);
    }
    window.changeSkillOptimizationLab = changeSkillOptimizationLab;

    function setSkillOptimizationStatus(message, danger) {
      var status = document.getElementById('skillOptimizationStatus');
      if (!status) return;
      status.style.color = danger ? 'var(--danger-color)' : 'var(--text-secondary)';
      status.textContent = message || '';
    }

    function clearSkillOptimizationCaseForm() {
      skillOptimizationEditingCaseId = '';
      ['skillOptimizationCaseId', 'skillOptimizationCaseQuery', 'skillOptimizationExpectedTerms', 'skillOptimizationForbiddenTerms', 'skillOptimizationCaseNotes'].forEach(function(id) {
        var element = document.getElementById(id);
        if (element) element.value = '';
      });
      var outcome = document.getElementById('skillOptimizationCaseOutcome');
      if (outcome) outcome.value = 'failure';
    }
    window.clearSkillOptimizationCaseForm = clearSkillOptimizationCaseForm;

    function editSkillOptimizationCase(caseId) {
      var item = findSkillOptimizationCase(caseId);
      if (!item) return;
      skillOptimizationEditingCaseId = item.id;
      document.getElementById('skillOptimizationCaseId').value = item.id;
      document.getElementById('skillOptimizationCaseQuery').value = item.query || '';
      document.getElementById('skillOptimizationExpectedTerms').value = (item.expectedTerms || []).join('，');
      document.getElementById('skillOptimizationForbiddenTerms').value = (item.forbiddenTerms || []).join('，');
      document.getElementById('skillOptimizationCaseOutcome').value = item.outcome || 'unreviewed';
      document.getElementById('skillOptimizationCaseNotes').value = item.notes || '';
      document.getElementById('skillOptimizationCaseQuery').focus();
      setSkillOptimizationStatus('正在编辑已有轨迹；补充期望词或禁用词后，它才会进入验证集。');
    }
    window.editSkillOptimizationCase = editSkillOptimizationCase;

    async function saveSkillOptimizationCaseFromLab() {
      var skill = skillOptimizationLabState && skillOptimizationLabState.skill;
      if (!skill) return;
      var query = String(document.getElementById('skillOptimizationCaseQuery')?.value || '').trim();
      var expectedTerms = parseSkillOptimizationTerms(document.getElementById('skillOptimizationExpectedTerms')?.value || '');
      var forbiddenTerms = parseSkillOptimizationTerms(document.getElementById('skillOptimizationForbiddenTerms')?.value || '');
      if (!query) return setSkillOptimizationStatus('验证任务不能为空。', true);
      if (!expectedTerms.length && !forbiddenTerms.length) return setSkillOptimizationStatus('至少填写一个期望词或禁用词，系统才能确定性评分。', true);
      var existing = skillOptimizationEditingCaseId ? findSkillOptimizationCase(skillOptimizationEditingCaseId) : null;
      var payload = {
        query: query,
        expectedTerms: expectedTerms,
        forbiddenTerms: forbiddenTerms,
        outcome: document.getElementById('skillOptimizationCaseOutcome')?.value || 'failure',
        notes: String(document.getElementById('skillOptimizationCaseNotes')?.value || '').trim(),
        provider: existing && existing.provider || 'secondary',
        source: existing && existing.source || 'manual'
      };
      setSkillOptimizationStatus('正在保存验证案例...');
      try {
        var url = getSkillOptimizationApiBase(skill.id) + '/cases' + (existing ? '/' + encodeURIComponent(existing.id) : '');
        skillOptimizationLabState = await requestSkillOptimization(url, {
          method: existing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        skillOptimizationEditingCaseId = '';
        renderSkillOptimizationLab();
        setSkillOptimizationStatus('验证案例已保存。');
      } catch (e) {
        setSkillOptimizationStatus(e.message || String(e), true);
      }
    }
    window.saveSkillOptimizationCaseFromLab = saveSkillOptimizationCaseFromLab;

    async function deleteSkillOptimizationCaseFromLab(caseId) {
      var skill = skillOptimizationLabState && skillOptimizationLabState.skill;
      if (!skill || !caseId || !confirm('删除这条本地轨迹/验证案例？')) return;
      try {
        skillOptimizationLabState = await requestSkillOptimization(getSkillOptimizationApiBase(skill.id) + '/cases/' + encodeURIComponent(caseId), { method: 'DELETE' });
        renderSkillOptimizationLab();
      } catch (e) {
        setSkillOptimizationStatus(e.message || String(e), true);
      }
    }
    window.deleteSkillOptimizationCaseFromLab = deleteSkillOptimizationCaseFromLab;

    async function generateSkillOptimizationCandidateFromLab() {
      var skill = skillOptimizationLabState && skillOptimizationLabState.skill;
      var button = document.getElementById('skillOptimizationGenerateBtn');
      if (!skill) return;
      var targetProvider = document.getElementById('skillOptimizationTargetProvider')?.value || 'secondary';
      if (button) { button.disabled = true; button.textContent = '优化中...'; }
      setSkillOptimizationStatus('Grass 正在分析已复核的成功/失败轨迹，并生成受控候选版本...');
      try {
        skillOptimizationLabState = await requestSkillOptimization(getSkillOptimizationApiBase(skill.id) + '/candidates', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optimizerProvider: 'primary', targetProvider: targetProvider })
        });
        renderSkillOptimizationLab();
        setSkillOptimizationStatus('候选版本已生成。请运行基线/候选验证，不会自动替换正式 Skill。');
      } catch (e) {
        setSkillOptimizationStatus(e.message || String(e), true);
        if (button) { button.disabled = false; button.textContent = '生成候选版本'; }
      }
    }
    window.generateSkillOptimizationCandidateFromLab = generateSkillOptimizationCandidateFromLab;

    async function evaluateSkillOptimizationCandidateFromLab(candidateId) {
      var skill = skillOptimizationLabState && skillOptimizationLabState.skill;
      if (!skill || !candidateId) return;
      var targetProvider = document.getElementById('skillOptimizationTargetProvider')?.value || findSkillOptimizationCandidate(candidateId)?.targetProvider || 'secondary';
      if (!confirm('将分别使用当前 Skill 和候选 Skill 执行验证案例。每个案例会调用模型两次，继续吗？')) return;
      setSkillOptimizationStatus('正在使用' + skillOptimizationProviderLabel(targetProvider) + '执行基线与候选验证；完成前请不要关闭软件...');
      try {
        skillOptimizationLabState = await requestSkillOptimization(getSkillOptimizationApiBase(skill.id) + '/candidates/' + encodeURIComponent(candidateId) + '/evaluate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetProvider: targetProvider })
        });
        renderSkillOptimizationLab();
        var candidate = findSkillOptimizationCandidate(candidateId);
        setSkillOptimizationStatus(candidate && candidate.evaluation && candidate.evaluation.accepted ? '验证通过：候选分数严格高于基线，可以人工确认启用。' : '候选没有严格超过基线，已拒绝本次更新。', !(candidate && candidate.evaluation && candidate.evaluation.accepted));
      } catch (e) {
        setSkillOptimizationStatus(e.message || String(e), true);
      }
    }
    window.evaluateSkillOptimizationCandidateFromLab = evaluateSkillOptimizationCandidateFromLab;

    async function activateSkillOptimizationCandidateFromLab(candidateId) {
      var skill = skillOptimizationLabState && skillOptimizationLabState.skill;
      if (!skill || !candidateId || !confirm('启用这个已通过验证的候选 Skill？当前版本会自动加入回滚历史。')) return;
      setSkillOptimizationStatus('正在备份当前版本并启用候选 Skill...');
      try {
        skillOptimizationLabState = await requestSkillOptimization(getSkillOptimizationApiBase(skill.id) + '/candidates/' + encodeURIComponent(candidateId) + '/activate', { method: 'POST' });
        await fetchUserSkills();
        renderSkillOptimizationLab();
        setSkillOptimizationStatus('候选 Skill 已启用，旧版本已保存，可随时回滚。');
      } catch (e) {
        setSkillOptimizationStatus(e.message || String(e), true);
      }
    }
    window.activateSkillOptimizationCandidateFromLab = activateSkillOptimizationCandidateFromLab;

    async function rollbackSkillOptimizationVersionFromLab(versionId) {
      var skill = skillOptimizationLabState && skillOptimizationLabState.skill;
      if (!skill || !versionId || !confirm('恢复这个 Skill 历史版本？当前版本也会自动备份。')) return;
      setSkillOptimizationStatus('正在恢复历史版本...');
      try {
        skillOptimizationLabState = await requestSkillOptimization(getSkillOptimizationApiBase(skill.id) + '/rollback', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionId: versionId })
        });
        await fetchUserSkills();
        renderSkillOptimizationLab();
        setSkillOptimizationStatus('历史版本已恢复。');
      } catch (e) {
        setSkillOptimizationStatus(e.message || String(e), true);
      }
    }
    window.rollbackSkillOptimizationVersionFromLab = rollbackSkillOptimizationVersionFromLab;

    function refreshUserSkillDiscoveryResults() {
      var container = document.getElementById('userSkillDiscoveryResults');
      if (container) container.innerHTML = renderUserSkillDiscoveryResultsHtml();
    }

    function clearUserSkillDiscovery() {
      userSkillDiscoveryCandidates = [];
      userSkillDiscoverySearchResults = [];
      var input = document.getElementById('userSkillDiscoveryQuery') || document.getElementById('userSkillUnifiedInput');
      var status = document.getElementById('userSkillDiscoveryStatus');
      if (input) input.value = '';
      if (status) status.textContent = '';
      refreshUserSkillDiscoveryResults();
    }
    window.clearUserSkillDiscovery = clearUserSkillDiscovery;

    async function discoverAcademicWritingSkills() {
      var input = document.getElementById('userSkillDiscoveryQuery') || document.getElementById('userSkillUnifiedInput');
      var status = document.getElementById('userSkillDiscoveryStatus');
      var btn = document.getElementById('userSkillDiscoveryBtn') || document.getElementById('userSkillUnifiedActionBtn');
      var query = (input && input.value ? input.value : '').trim();
      if (btn) {
        btn.disabled = true;
        btn.textContent = '发现中...';
      }
      if (status) status.textContent = query ? '正在联网检索并匹配 Skill...' : '正在加载推荐的学术写作 Skill...';
      try {
        var response = await fetch(getUserSkillApiBase() + '/discover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: query, limit: 6, online: true })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '发现 Skill 失败');
        userSkillDiscoveryCandidates = Array.isArray(data.candidates) ? data.candidates : [];
        userSkillDiscoverySearchResults = Array.isArray(data.searchResults) ? data.searchResults : [];
        refreshUserSkillDiscoveryResults();
        if (status) {
          var resultParts = [];
          if (userSkillDiscoverySearchResults.length) resultParts.push('联网结果 ' + userSkillDiscoverySearchResults.length + ' 条');
          if (userSkillDiscoveryCandidates.length) resultParts.push('内置候选 ' + userSkillDiscoveryCandidates.length + ' 个');
          status.innerHTML = resultParts.length
            ? '已找到：' + resultParts.join('，') + '。GitHub 结果可直接导入，普通网页可打开查看。'
            : '<span style="color:var(--danger-color);">没有检索到结果，请换一个更具体的 Skill 需求。</span>';
        }
      } catch (e) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">发现失败：' + escapeHtml(e.message || String(e)) + '</span>';
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.id === 'userSkillUnifiedActionBtn' ? '识别并执行' : '发现 Skill';
        }
      }
    }
    window.discoverAcademicWritingSkills = discoverAcademicWritingSkills;

    function handleUnifiedUserSkillInput() {
      var input = document.getElementById('userSkillUnifiedInput');
      var value = String(input && input.value || '').trim();
      if (/^https:\/\/(github\.com|raw\.githubusercontent\.com)\//i.test(value)) {
        importUserSkillFromGithubUrl();
        return;
      }
      discoverAcademicWritingSkills();
    }
    window.handleUnifiedUserSkillInput = handleUnifiedUserSkillInput;

    function getUserSkillDiscoverySearchResult(index) {
      var safeIndex = parseInt(index, 10);
      if (!Number.isFinite(safeIndex) || safeIndex < 0) return null;
      return userSkillDiscoverySearchResults[safeIndex] || null;
    }

    function openUserSkillDiscoveryResult(index) {
      var result = getUserSkillDiscoverySearchResult(index);
      if (!result || !result.url) return;
      openExternalUrl(result.url);
    }
    window.openUserSkillDiscoveryResult = openUserSkillDiscoveryResult;

    function buildGithubSkillImportStatusHtml(data, prefix) {
      var importedSkills = Array.isArray(data && data.importedSkills) ? data.importedSkills : [];
      var failedFiles = Array.isArray(data && data.failedFiles) ? data.failedFiles : [];
      var count = importedSkills.length || (data && data.skill ? 1 : 0);
      var source = data && data.source ? data.source : {};
      if (source.importMode === 'collection' || count > 1) {
        return escapeHtml(prefix || '已从 GitHub 导入') + ' <strong>' + count + ' 个 Skill</strong>' +
          (source.repository ? '<br><span style="color:var(--text-secondary);">' + escapeHtml(source.repository) + ' · ' + escapeHtml(source.branch || 'default') + '</span>' : '') +
          '<br><span style="color:var(--text-secondary);">新增 ' + Number(data.createdCount || 0) + '，更新 ' + Number(data.updatedCount || 0) + '</span>' +
          (failedFiles.length ? '<br><span style="color:var(--danger-color);">另有 ' + failedFiles.length + ' 个文件暂时下载失败；再次导入同一链接即可补齐。</span>' : '');
      }
      return escapeHtml(prefix || '已从 GitHub 导入') + '：<strong>/' + escapeHtml(data && data.skill ? data.skill.trigger || '' : '') + '</strong>' +
        (source.githubPath ? '<br><span style="color:var(--text-secondary);">' + escapeHtml(source.githubPath) + '</span>' : '');
    }

    async function importUserSkillDiscoveryResult(index) {
      var result = getUserSkillDiscoverySearchResult(index);
      var status = document.getElementById('userSkillDiscoveryStatus') || document.getElementById('userSkillDialogStatus');
      if (!result || !result.url) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">检索结果不存在。</span>';
        return;
      }
      if (!result.importable || !/^https:\/\/(github\.com|raw\.githubusercontent\.com)\//i.test(result.url)) {
        openUserSkillDiscoveryResult(index);
        return;
      }
      if (status) status.textContent = '正在识别 GitHub 中的 SKILL.md；仓库或分类目录包含多个 Skill 时会批量导入...';
      try {
        var response = await fetch(getUserSkillApiBase() + '/import-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: result.url })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'GitHub 导入失败');
        userSkillManagerSkills = Array.isArray(data.skills) ? data.skills : [];
        userSkillDropdownLoaded = false;
        renderMainContextSourceBar();
        renderUserSkillManager(data.skill?.id || '');
        var nextStatus = document.getElementById('userSkillDialogStatus');
        if (nextStatus) {
          nextStatus.innerHTML = buildGithubSkillImportStatusHtml(data, '已从联网检索结果导入');
        }
      } catch (e) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">导入失败：' + escapeHtml(e.message || String(e)) + '</span>';
      }
    }
    window.importUserSkillDiscoveryResult = importUserSkillDiscoveryResult;

    function getUserSkillDiscoveryCandidate(index) {
      var safeIndex = parseInt(index, 10);
      if (!Number.isFinite(safeIndex) || safeIndex < 0) return null;
      return userSkillDiscoveryCandidates[safeIndex] || null;
    }

    function fillUserSkillFormWithDiscovery(index) {
      var candidate = getUserSkillDiscoveryCandidate(index);
      var status = document.getElementById('userSkillDialogStatus');
      if (!candidate) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">候选 Skill 不存在。</span>';
        return;
      }
      var idEl = document.getElementById('userSkillId');
      var nameEl = document.getElementById('userSkillName');
      var triggerEl = document.getElementById('userSkillTrigger');
      var descEl = document.getElementById('userSkillDescription');
      var promptEl = document.getElementById('userSkillPrompt');
      var enabledEl = document.getElementById('userSkillEnabled');
      if (idEl) idEl.value = '';
      if (nameEl) nameEl.value = candidate.name || '';
      if (triggerEl) triggerEl.value = candidate.trigger || getUniqueUserSkillTrigger(candidate.name || 'academic-skill');
      if (descEl) descEl.value = candidate.description || '';
      if (promptEl) promptEl.value = candidate.prompt || '';
      if (enabledEl) enabledEl.checked = candidate.enabled !== false;
      if (status) status.innerHTML = '已填入候选 Skill：<strong>/' + escapeHtml(candidate.trigger || '') + '</strong>，确认后点击“保存 Skill”。';
    }
    window.fillUserSkillFormWithDiscovery = fillUserSkillFormWithDiscovery;

    async function saveDiscoveredUserSkill(index, persist) {
      var candidate = getUserSkillDiscoveryCandidate(index);
      var status = document.getElementById('userSkillDiscoveryStatus') || document.getElementById('userSkillDialogStatus');
      if (!candidate) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">候选 Skill 不存在。</span>';
        return;
      }
      if (status) status.textContent = persist ? '正在保存并加入持续使用...' : '正在保存 Skill...';
      try {
        var skill = await createUserSkillFromImportedPayload({
          name: candidate.name || '学术写作 Skill',
          trigger: candidate.trigger || getUniqueUserSkillTrigger(candidate.name || 'academic-skill'),
          description: candidate.description || '',
          prompt: candidate.prompt || '',
          enabled: candidate.enabled !== false
        });
        if (persist && skill && skill.id) {
          var tokens = loadMainContextSkillSelection();
          tokens.push('user:' + skill.id);
          saveMainContextSkillSelection(tokens);
          renderMainContextSourceBar();
        }
        await fetchUserSkills();
        userSkillDropdownLoaded = false;
        renderUserSkillManager(skill && skill.id ? skill.id : '');
        var nextStatus = document.getElementById('userSkillDialogStatus');
        if (nextStatus) {
          nextStatus.innerHTML = '已保存：<strong>/' + escapeHtml(skill && skill.trigger ? skill.trigger : '') + '</strong>' + (persist ? '，并已加入持续使用。' : '。');
        }
      } catch (e) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">保存失败：' + escapeHtml(e.message || String(e)) + '</span>';
      }
    }
    window.saveDiscoveredUserSkill = saveDiscoveredUserSkill;

    window.selectUserSkillForEdit = function(skillId) {
      renderUserSkillManager(skillId || '');
    };

    window.clearUserSkillForm = function() {
      renderUserSkillManager('');
    };

    async function saveUserSkillFromDialog() {
      var status = document.getElementById('userSkillDialogStatus');
      var saveButton = document.getElementById('userSkillSaveButton');
      var id = (document.getElementById('userSkillId')?.value || '').trim();
      var name = (document.getElementById('userSkillName')?.value || '').trim();
      var trigger = normalizeUserSkillTrigger(document.getElementById('userSkillTrigger')?.value || '');
      if (!trigger && name) trigger = getUniqueUserSkillTrigger(name);
      var payload = {
        name: name,
        trigger: trigger,
        description: (document.getElementById('userSkillDescription')?.value || '').trim(),
        prompt: (document.getElementById('userSkillPrompt')?.value || '').trim(),
        enabled: !!document.getElementById('userSkillEnabled')?.checked
      };
      if (!payload.name || !payload.trigger || !payload.prompt) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">名称和指令不能为空。</span>';
        return;
      }
      if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]{1,32}$/.test(payload.trigger)) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">命令只能包含 1-32 位中文、英文、数字、下划线或短横线。</span>';
        return;
      }
      if (status) status.textContent = '正在保存...';
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = '保存中...';
      }
      try {
        var response = await fetch(id ? (getUserSkillApiBase() + '/' + encodeURIComponent(id)) : getUserSkillApiBase(), {
          method: id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '保存失败');
        userSkillManagerSkills = Array.isArray(data.skills) ? data.skills : [];
        userSkillDropdownLoaded = false;
        renderMainContextSourceBar();
        await showMainContextSkillDialog();
      } catch (e) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">保存失败：' + escapeHtml(e.message || String(e)) + '</span>';
        if (saveButton) {
          saveButton.disabled = false;
          saveButton.textContent = '保存 Skill';
        }
      }
    }
    window.saveUserSkillFromDialog = saveUserSkillFromDialog;

    function setUserSkillDropZoneActive(active) {
      var zone = document.getElementById('userSkillDropZone');
      if (!zone) return;
      zone.style.borderColor = active ? 'var(--accent-color)' : 'var(--border-color)';
      zone.style.background = active ? 'var(--modal-tip-bg)' : 'var(--bg-secondary)';
    }

    function handleUserSkillDragOver(event) {
      event.preventDefault();
      setUserSkillDropZoneActive(true);
    }
    window.handleUserSkillDragOver = handleUserSkillDragOver;

    function handleUserSkillDragLeave(event) {
      event.preventDefault();
      setUserSkillDropZoneActive(false);
    }
    window.handleUserSkillDragLeave = handleUserSkillDragLeave;

    function handleUserSkillDrop(event) {
      event.preventDefault();
      setUserSkillDropZoneActive(false);
      importUserSkillFiles(event.dataTransfer ? event.dataTransfer.files : null);
    }
    window.handleUserSkillDrop = handleUserSkillDrop;

    async function createUserSkillFromImportedPayload(payload) {
      var response = await fetch(getUserSkillApiBase(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || '导入失败');
      }
      userSkillManagerSkills = Array.isArray(data.skills) ? data.skills : userSkillManagerSkills;
      return data.skill;
    }

    async function importUserSkillFiles(fileList) {
      var files = Array.prototype.slice.call(fileList || []).filter(function(file) {
        return /\.(md|markdown|txt)$/i.test(file.name || '');
      });
      var status = document.getElementById('userSkillDialogStatus');
      if (!files.length) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">请拖入 .md、.markdown 或 .txt 文件。</span>';
        return;
      }
      if (status) status.textContent = '正在导入 ' + files.length + ' 个 Skill 文件...';
      var imported = [];
      var failed = [];
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        try {
          var content = await readUserSkillFileAsText(file);
          var payload = inferUserSkillFromMarkdown(file.name, content);
          if (!payload.prompt) throw new Error('文件内容为空');
          var skill = await createUserSkillFromImportedPayload(payload);
          imported.push(skill);
        } catch (e) {
          failed.push(file.name + ': ' + (e.message || String(e)));
        }
      }
      try {
        await fetchUserSkills();
      } catch (e) {}
      userSkillDropdownLoaded = false;
      renderUserSkillManager(imported.length === 1 ? imported[0].id : '');
      var nextStatus = document.getElementById('userSkillDialogStatus');
      if (nextStatus) {
        nextStatus.innerHTML = '已导入 ' + imported.length + ' 个 Skill' + (failed.length ? '<br><span style="color:var(--danger-color);">失败：' + escapeHtml(failed.join('；')) + '</span>' : '');
      }
    }
    window.importUserSkillFiles = importUserSkillFiles;

    async function importUserSkillFromGithubUrl() {
      var input = document.getElementById('userSkillGithubUrl') || document.getElementById('userSkillUnifiedInput');
      var status = document.getElementById('userSkillDialogStatus');
      var url = (input?.value || '').trim();
      if (!url) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">请先粘贴 GitHub Skill 链接。</span>';
        return;
      }
      if (!/^https:\/\/(github\.com|raw\.githubusercontent\.com)\//i.test(url)) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">只支持 github.com 或 raw.githubusercontent.com 链接。</span>';
        return;
      }
      if (status) status.textContent = '正在识别 GitHub 中的 SKILL.md；仓库或分类目录包含多个 Skill 时会批量导入...';
      try {
        var response = await fetch(getUserSkillApiBase() + '/import-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'GitHub 导入失败');
        userSkillManagerSkills = Array.isArray(data.skills) ? data.skills : [];
        userSkillDropdownLoaded = false;
        renderUserSkillManager(data.skill?.id || '');
        var nextStatus = document.getElementById('userSkillDialogStatus');
        if (nextStatus) {
          nextStatus.innerHTML = buildGithubSkillImportStatusHtml(data, '已从 GitHub 导入');
        }
      } catch (e) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">GitHub 导入失败：' + escapeHtml(e.message || String(e)) + '</span>';
      }
    }
    window.importUserSkillFromGithubUrl = importUserSkillFromGithubUrl;

    async function deleteBundledAgentSkillFromDialog(skillId, skillName) {
      if (!skillId) return;
      var label = skillName || skillId;
      if (!confirm('确定删除内置 Skill“' + label + '”吗？\n\n删除后，该 Skill 将从当前用户的 Skill 配置和 AI 自动调用目录中移除。')) return;
      try {
        var response = await fetch(
          getUserSkillApiBase() + '/bundled/' + encodeURIComponent(skillId),
          { method: 'DELETE' }
        );
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok || !data.success) throw new Error(data.error || '删除内置 Skill 失败');
        availableAgentSkills = Array.isArray(data.skills) ? data.skills : [];
        if (skillId === TARGET_VENUE_PEER_REVIEW_SKILL_ID) {
          targetVenuePeerReviewRuntimeCache = {};
        }
        renderUserSkillManager('');
        var status = document.getElementById('userSkillDialogStatus');
        if (status) status.innerHTML = '已删除内置 Skill：<strong>' + escapeHtml(label) + '</strong>。';
      } catch (e) {
        var status = document.getElementById('userSkillDialogStatus');
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">删除失败：' + escapeHtml(e.message || String(e)) + '</span>';
      }
    }
    window.deleteBundledAgentSkillFromDialog = deleteBundledAgentSkillFromDialog;

    async function deleteUserSkillFromDialog(skillId) {
      if (!skillId) return;
      if (!confirm('确定删除这个用户 Skill 吗？')) return;
      var status = document.getElementById('userSkillDialogStatus');
      if (status) status.textContent = '正在删除...';
      try {
        var response = await fetch(getUserSkillApiBase() + '/' + encodeURIComponent(skillId), { method: 'DELETE' });
        var data = await response.json();
        if (!response.ok || !data.success || data.deleted === false) throw new Error(data.error || '删除失败');
        userSkillManagerSkills = Array.isArray(data.skills) ? data.skills : [];
        userSkillDropdownLoaded = false;
        var activeIds = new Set(userSkillManagerSkills.map(function(skill) { return String(skill.id || ''); }));
        saveMainContextSkillSelection(loadMainContextSkillSelection().filter(function(token) {
          var parsed = parseMainContextSkillToken(token);
          return !parsed || parsed.kind !== 'user' || activeIds.has(String(parsed.id || ''));
        }));
        renderMainContextSourceBar();
        renderUserSkillManager('');
      } catch (e) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">删除失败：' + escapeHtml(e.message || String(e)) + '</span>';
      }
    }
    window.deleteUserSkillFromDialog = deleteUserSkillFromDialog;

    var FIRST_RUN_ONBOARDING_KEY = 'scholarharness_first_run_onboarding_v1';
    var FIRST_RUN_ONBOARDING_STEPS = ['secondary', 'embedding', 'plugins'];
    var firstRunOnboardingReadiness = null;
    var firstRunOnboardingChecking = false;
    var firstRunOnboardingScheduled = false;
    var guidedConfigState = null;

    function getFirstRunOnboardingStorageKey() {
      return FIRST_RUN_ONBOARDING_KEY + ':' + String(currentUserId || 'web-user');
    }

    function loadFirstRunOnboardingState() {
      try {
        var parsed = JSON.parse(localStorage.getItem(getFirstRunOnboardingStorageKey()) || '{}');
        var visited = parsed && parsed.visited && typeof parsed.visited === 'object'
          ? parsed.visited
          : {};
        return {
          status: String(parsed?.status || ''),
          visited: {
            secondary: !!visited.secondary,
            embedding: !!visited.embedding,
            plugins: !!visited.plugins
          },
          version: String(parsed?.version || ''),
          updatedAt: String(parsed?.updatedAt || '')
        };
      } catch (e) {
        return {
          status: '',
          visited: { secondary: false, embedding: false, plugins: false },
          version: '',
          updatedAt: ''
        };
      }
    }

    function saveFirstRunOnboardingState(status, visited) {
      try {
        var current = loadFirstRunOnboardingState();
        var nextVisited = visited && typeof visited === 'object' ? visited : current.visited;
        localStorage.setItem(getFirstRunOnboardingStorageKey(), JSON.stringify({
          status: status,
          visited: {
            secondary: !!nextVisited.secondary,
            embedding: !!nextVisited.embedding,
            plugins: !!nextVisited.plugins
          },
          version: '1.0.9',
          updatedAt: new Date().toISOString()
        }));
      } catch (e) {}
    }

    function hasCompletedFirstRunOnboardingSteps(visited) {
      return FIRST_RUN_ONBOARDING_STEPS.every(function(step) {
        return !!(visited && visited[step]);
      });
    }

    function removeFirstRunOnboardingBubble() {
      var bubble = document.getElementById('firstRunOnboardingBubble');
      if (!bubble) return;
      bubble.classList.remove('show');
      setTimeout(function() {
        if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
      }, 180);
    }

    function markFirstRunOnboardingStepVisited(step) {
      var state = loadFirstRunOnboardingState();
      if (FIRST_RUN_ONBOARDING_STEPS.indexOf(step) < 0) return state;
      state.visited[step] = true;
      state.status = hasCompletedFirstRunOnboardingSteps(state.visited) ? 'completed' : 'in-progress';
      saveFirstRunOnboardingState(state.status, state.visited);
      return state;
    }

    function hasPriorChatUsageForOnboarding() {
      var prefix = MSG_KEY + String(currentUserId || 'web-user') + '_';
      try {
        for (var index = 0; index < localStorage.length; index += 1) {
          var key = localStorage.key(index) || '';
          if (key.indexOf(prefix) !== 0) continue;
          var messages = JSON.parse(localStorage.getItem(key) || '[]');
          if (Array.isArray(messages) && messages.length > 0) return true;
        }
      } catch (e) {}
      return false;
    }

    async function fetchFirstRunStatus(url, options) {
      try {
        var response = await fetch(url, options || {});
        var payload = await response.json().catch(function() { return {}; });
        return response.ok ? payload : { success: false, error: payload.error || ('HTTP ' + response.status) };
      } catch (error) {
        return { success: false, error: error.message || String(error) };
      }
    }

    function firstRunPluginAvailable(payload) {
      var data = payload && payload.data ? payload.data : payload || {};
      return !!(payload && payload.success && data.available);
    }

    async function inspectFirstRunReadiness(runAutoDetect) {
      firstRunOnboardingChecking = true;
      if (runAutoDetect) {
        await Promise.all([
          fetchFirstRunStatus('/api/r-code/plugin/auto-detect', { method: 'POST' }),
          fetchFirstRunStatus('/api/python-plugin/auto-detect', { method: 'POST' }),
          fetchFirstRunStatus('/api/office-plugin/auto-detect', { method: 'POST' })
        ]);
      }
      try {
        await loadChatBridgeConfig();
      } catch (e) {}
      loadApiConfig();
      var results = await Promise.all([
        fetchFirstRunStatus('/api/chat-bridge/codex/status'),
        fetchFirstRunStatus('/api/r-code/plugin/status'),
        fetchFirstRunStatus('/api/python-plugin/status'),
        fetchFirstRunStatus('/api/office-plugin/status'),
        fetchFirstRunStatus('/api/user-skills/' + encodeURIComponent(currentUserId || 'web-user') + '/available'),
        fetchFirstRunStatus('/api/mcp-plugins')
      ]);
      var codexStatus = results[0] || {};
      var secondary = chatBridgeConfig.secondary || {};
      var primary = chatBridgeConfig.primary || {};
      var secondaryReady = !!((apiConfig.url && apiConfig.key && apiConfig.model) || (secondary.apiUrl && secondary.hasApiKey && secondary.model));
      var primaryReady = !!(primary.apiUrl && primary.hasApiKey && primary.model);
      var codexAvailable = !!(codexStatus.success && codexStatus.available);
      var codexReady = !!(codexAvailable && chatBridgeConfig.codex && chatBridgeConfig.codex.enabled !== false && chatBridgeConfig.codex.prefer);
      var embeddingConfig = getEmbeddingConfig();
      var availableSkills = Array.isArray(results[4]?.skills) ? results[4].skills : [];
      var installedMcpPlugins = Array.isArray(results[5]?.plugins) ? results[5].plugins : [];
      firstRunOnboardingReadiness = {
        aiReady: secondaryReady || primaryReady || codexReady,
        secondaryReady: secondaryReady,
        primaryReady: primaryReady,
        codexAvailable: codexAvailable,
        codexReady: codexReady,
        codexVersion: codexStatus.version || '',
        rReady: firstRunPluginAvailable(results[1]),
        pythonReady: firstRunPluginAvailable(results[2]),
        officeReady: firstRunPluginAvailable(results[3]),
        embeddingReady: !!(embeddingConfig.enabled !== false && embeddingConfig.url && embeddingConfig.key && embeddingConfig.model),
        skillCount: availableSkills.length,
        bundledSkillCount: availableSkills.filter(function(skill) { return skill && skill.source === 'bundled'; }).length,
        userSkillCount: availableSkills.filter(function(skill) { return skill && skill.source === 'user'; }).length,
        mcpPluginCount: installedMcpPlugins.length,
        enabledMcpPluginCount: installedMcpPlugins.filter(function(plugin) { return plugin && plugin.enabled !== false; }).length
      };
      firstRunOnboardingChecking = false;
      return firstRunOnboardingReadiness;
    }

    function firstRunStatusRow(label, detail, ready, tag) {
      var optional = tag === '可选';
      var stateClass = ready ? 'ready' : (optional ? 'optional' : 'missing');
      return '<div class="first-run-status-row ' + stateClass + '">' +
        '<span class="first-run-status-icon">' + (ready ? '✓' : (optional ? '–' : '!')) + '</span>' +
        '<span><span class="first-run-status-name">' + escapeHtml(label) + '</span><span class="first-run-status-detail">' + escapeHtml(detail) + '</span></span>' +
        '<span class="first-run-status-tag">' + escapeHtml(tag || '') + '</span>' +
      '</div>';
    }

    function renderFirstRunOnboardingContent() {
      var state = loadFirstRunOnboardingState();
      var completedCount = FIRST_RUN_ONBOARDING_STEPS.filter(function(step) {
        return !!state.visited[step];
      }).length;
      var stepMeta = [
        {
          id: 'secondary',
          label: '配置 Little corse',
          detail: '连接日常聊天与写作模型'
        },
        {
          id: 'embedding',
          label: '配置 Embedding',
          detail: '启用句子与文献语义检索'
        },
        {
          id: 'plugins',
          label: '配置插件',
          detail: '管理 R、Python、OfficeCLI 与 MCP'
        }
      ];
      return '' +
        '<div class="first-run-bubble-head">' +
          '<div class="first-run-bubble-heading">' +
            '<strong>AI 配置与使用向导</strong>' +
            '<span>首次使用先访问三个配置入口，之后可以随时在配置中心调整。</span>' +
          '</div>' +
          '<button type="button" class="first-run-bubble-close" onclick="dismissFirstRunOnboarding()" title="关闭向导" aria-label="关闭向导">×</button>' +
        '</div>' +
        '<div class="first-run-bubble-actions" role="group" aria-label="首次配置入口">' +
          stepMeta.map(function(step) {
            var visited = !!state.visited[step.id];
            return '<button type="button" class="first-run-bubble-action' + (visited ? ' visited' : '') + '" onclick="openFirstRunOnboardingStep(\'' + step.id + '\')">' +
              '<span class="first-run-bubble-action-mark" aria-hidden="true">' + (visited ? '✓' : '') + '</span>' +
              '<span class="first-run-bubble-action-copy"><strong>' + escapeHtml(step.label) + '</strong><small>' + escapeHtml(step.detail) + '</small></span>' +
              '<span class="first-run-bubble-action-arrow" aria-hidden="true">›</span>' +
            '</button>';
          }).join('') +
        '</div>' +
        '<div class="first-run-bubble-progress"><span>已访问 ' + completedCount + '/3</span><span>访问第三个入口后自动关闭</span></div>';
    }

    async function showFirstRunOnboardingDialog(options) {
      var state = loadFirstRunOnboardingState();
      var force = !!(options && options.manual);
      if (!force && (state.status === 'completed' || state.status === 'dismissed')) return state;
      if (hasCompletedFirstRunOnboardingSteps(state.visited)) {
        saveFirstRunOnboardingState('completed', state.visited);
        removeFirstRunOnboardingBubble();
        return state;
      }
      var bubble = document.getElementById('firstRunOnboardingBubble');
      if (!bubble) {
        bubble = document.createElement('aside');
        bubble.id = 'firstRunOnboardingBubble';
        bubble.className = 'first-run-onboarding-bubble';
        bubble.setAttribute('role', 'dialog');
        bubble.setAttribute('aria-modal', 'false');
        bubble.setAttribute('aria-label', 'AI 配置与使用向导');
        document.body.appendChild(bubble);
      }
      bubble.innerHTML = renderFirstRunOnboardingContent();
      requestAnimationFrame(function() { bubble.classList.add('show'); });
      return state;
    }
    window.showFirstRunOnboardingDialog = showFirstRunOnboardingDialog;

    async function refreshFirstRunOnboarding() {
      await showFirstRunOnboardingDialog({ manual: true });
    }
    window.refreshFirstRunOnboarding = refreshFirstRunOnboarding;

    function openFirstRunOnboardingStep(step) {
      var state = markFirstRunOnboardingStepVisited(step);
      if (hasCompletedFirstRunOnboardingSteps(state.visited)) {
        removeFirstRunOnboardingBubble();
      } else {
        showFirstRunOnboardingDialog({ manual: true });
      }
      if (step === 'secondary') {
        openFirstRunAiConfig();
        return;
      }
      if (step === 'embedding') {
        openFirstRunEmbeddingConfig();
        return;
      }
      if (step === 'plugins') {
        if (typeof showRuntimePluginConfigDialog === 'function') {
          showRuntimePluginConfigDialog();
        } else if (typeof openAiConfigurationPluginPage === 'function') {
          openAiConfigurationPluginPage();
        }
      }
    }
    window.openFirstRunOnboardingStep = openFirstRunOnboardingStep;

    function openFirstRunAiConfig() {
      initGuidedConfigState('secondary');
      guidedConfigState.returnTarget = 'onboarding';
      showGuidedConfigDialog('secondary', 0);
    }
    window.openFirstRunAiConfig = openFirstRunAiConfig;

    function openFirstRunEmbeddingConfig() {
      initGuidedConfigState('embedding');
      guidedConfigState.returnTarget = 'onboarding';
      showGuidedConfigDialog('embedding', 0);
    }
    window.openFirstRunEmbeddingConfig = openFirstRunEmbeddingConfig;

    function openAiGuidedConfig(kind) {
      initGuidedConfigState(kind);
      guidedConfigState.returnTarget = 'ai-configuration';
      showGuidedConfigDialog(kind, 0);
    }
    window.openAiGuidedConfig = openAiGuidedConfig;

    function openAiConfigurationSkillPage() {
      closeModal();
      showMainContextSkillDialog();
    }
    window.openAiConfigurationSkillPage = openAiConfigurationSkillPage;

    function openAiConfigurationPluginPage() {
      closeModal();
      showRuntimePluginConfigDialog();
    }
    window.openAiConfigurationPluginPage = openAiConfigurationPluginPage;

    function openAiCodexConfiguration() {
      closeModal();
      showConfigCenterDialog();
      setTimeout(function() {
        var details = document.querySelector('#homeUtilityPage .config-inline-advanced');
        if (details) {
          details.open = true;
          details.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
      }, 80);
    }
    window.openAiCodexConfiguration = openAiCodexConfiguration;

    function uploadLiteratureFromAiConfiguration() {
      closeModal();
      if (document.body.classList.contains('home-utility-open')) {
        closeHomeUtilityPage({ skipReturn: true });
      }
      var literatureInput = document.getElementById('fileInput');
      if (!literatureInput) {
        alert('文献库上传控件未加载，请刷新页面后重试。');
        return;
      }
      literatureInput.value = '';
      literatureInput.click();
    }
    window.uploadLiteratureFromAiConfiguration = uploadLiteratureFromAiConfiguration;

    async function startAiConfigurationAssistant(focus) {
      var status = document.getElementById('firstRunOnboardingStatus');
      if (status) status.textContent = '正在检查 Little corse 和当前配置...';
      var readiness = await inspectFirstRunReadiness(false);
      if (!readiness.secondaryReady) {
        if (status) status.textContent = '请先完成 Little corse 配置；保存成功后会自动继续。';
        openAiGuidedConfig('secondary');
        return;
      }
      saveFirstRunOnboardingState('completed');
      closeModal();
      if (document.body.classList.contains('home-utility-open')) {
        closeHomeUtilityPage({ skipReturn: true });
      }
      setComposerChatProvider('secondary');
      var focusText = focus === 'literature'
        ? '我想了解并完成 WoS、CNKI、RIS、TXT 和 PDF 的正确导出、上传与后续使用。请先区分题录库和 PDF Wiki，再一次只带我完成一个步骤。'
        : '请先询问我主要要完成的科研任务，再根据目标给出最小配置方案；按顺序帮我配置 Grass、Embedding、Codex、Skill 或插件，只配置真正需要的项目。';
      var readinessText = [
        'Little corse=' + (readiness.secondaryReady ? '已配置' : '未配置'),
        'Grass=' + (readiness.primaryReady ? '已配置' : '未配置'),
        'Embedding=' + (readiness.embeddingReady ? '已配置' : '未配置'),
        'Codex=' + (readiness.codexReady ? '已启用' : (readiness.codexAvailable ? '已检测未启用' : '未检测')),
        '本地运行时=' + [readiness.rReady, readiness.pythonReady, readiness.officeReady].filter(Boolean).length + '/3',
        'Skill=' + Number(readiness.skillCount || 0),
        'MCP=' + Number(readiness.mcpPluginCount || 0)
      ].join('；');
      if (userInput) {
        userInput.value = '请使用 Scholar Harness 配置与使用向导 Skill。' + focusText + '\n\n当前自动检测：' + readinessText + '。涉及 API Key 时请直接打开本机密码配置框，不要让我把 Key 发到聊天记录里。';
        autoResize();
        userInput.focus();
        setTimeout(function() { sendMessage(); }, 100);
      }
    }
    window.startAiConfigurationAssistant = startAiConfigurationAssistant;

    function returnFromGuidedConfig() {
      var returnToOnboarding = guidedConfigState && String(guidedConfigState.returnTarget || '').indexOf('onboarding') === 0;
      if (returnToOnboarding) {
        closeModal();
        showFirstRunOnboardingDialog({ manual: true, autoDetect: false });
      } else if (guidedConfigState && guidedConfigState.returnTarget === 'ai-configuration') {
        closeModal();
        if (userInput) userInput.focus();
      } else {
        showConfigCenterDialog();
      }
    }
    window.returnFromGuidedConfig = returnFromGuidedConfig;

    async function enableFirstRunCodex() {
      var codex = chatBridgeConfig.codex || {};
      var response = await fetch('/api/chat-bridge/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codex: {
            enabled: true,
            prefer: true,
            command: codex.command || '',
            model: codex.model || 'gpt-5.5',
            reasoning_effort: codex.reasoning_effort || 'xhigh',
            sandbox: codex.sandbox || 'workspace-write',
            pdf_wiki_sandbox: codex.pdf_wiki_sandbox || 'danger-full-access',
            timeout_ms: Number(codex.timeout_ms || 300000),
            pdf_wiki_concurrency: Math.max(1, Math.min(6, Number(codex.pdf_wiki_concurrency || 1)))
          }
        })
      });
      var result = await response.json().catch(function() { return {}; });
      if (!response.ok || !result.success) throw new Error(result.error || 'Codex 配置保存失败');
      await loadChatBridgeConfig();
      setComposerChatProvider('codex');
    }

    function completeFirstRunOnboarding(action) {
      if (action !== 'literature' || (firstRunOnboardingReadiness && firstRunOnboardingReadiness.aiReady)) {
        saveFirstRunOnboardingState('completed');
      }
      closeModal();
      setTimeout(function() {
        if (action === 'pdf') {
          triggerPdfWikiUpload();
          return;
        }
        if (action === 'workspace') {
          var panel = document.getElementById('workspaceDirectoryPanel');
          if (panel && !panel.classList.contains('open')) toggleWorkspaceDirectoryPanel({ stopPropagation: function() {} });
          return;
        }
        if (action === 'literature') {
          var literatureInput = document.getElementById('fileInput');
          if (!literatureInput) {
            alert('文献库上传控件未加载，请刷新页面后重试。');
            return;
          }
          literatureInput.value = '';
          literatureInput.click();
          return;
        }
        if (userInput) userInput.focus();
      }, 80);
    }

    async function applyFirstRunRecommendedConfig(action) {
      var status = document.getElementById('firstRunOnboardingStatus');
      var button = document.getElementById('firstRunPrimaryAction');
      if (button) button.disabled = true;
      if (status) status.textContent = '正在应用推荐配置...';
      try {
        var readiness = firstRunOnboardingReadiness || await inspectFirstRunReadiness(false);
        if (action === 'literature') {
          if (!readiness.embeddingReady) {
            openFirstRunEmbeddingConfig();
            return;
          }
          completeFirstRunOnboarding('literature');
          return;
        }
        if (!readiness.aiReady && readiness.codexAvailable) {
          await enableFirstRunCodex();
          readiness = await inspectFirstRunReadiness(false);
        }
        if (!readiness.aiReady) {
          openFirstRunAiConfig();
          return;
        }
        if (readiness.codexReady) setComposerChatProvider('codex');
        else if (readiness.secondaryReady) setComposerChatProvider('secondary');
        else if (readiness.primaryReady) setComposerChatProvider('primary');
        completeFirstRunOnboarding(action || 'ask');
      } catch (error) {
        if (status) status.textContent = '自动配置失败：' + (error.message || String(error));
      } finally {
        if (button) button.disabled = false;
      }
    }
    window.applyFirstRunRecommendedConfig = applyFirstRunRecommendedConfig;

    function dismissFirstRunOnboarding() {
      var state = loadFirstRunOnboardingState();
      saveFirstRunOnboardingState('dismissed', state.visited);
      removeFirstRunOnboardingBubble();
    }
    window.dismissFirstRunOnboarding = dismissFirstRunOnboarding;

    function scheduleFirstRunOnboarding(attempt) {
      if (firstRunOnboardingScheduled) return;
      var state = loadFirstRunOnboardingState();
      if (state.status === 'completed' || state.status === 'dismissed' || hasPriorChatUsageForOnboarding()) return;
      firstRunOnboardingScheduled = true;
      setTimeout(function openWhenIdle() {
        var overlay = document.getElementById('modalOverlay');
        if (overlay && overlay.classList.contains('show')) {
          firstRunOnboardingScheduled = false;
          if (Number(attempt || 0) < 4) {
            scheduleFirstRunOnboarding(Number(attempt || 0) + 1);
          }
          return;
        }
        showFirstRunOnboardingDialog({ auto: true });
      }, Number(attempt || 0) ? 1200 : 700);
    }

    function getGuidedConfigMeta(kind) {
      if (kind === 'primary') {
        var configuredPrimaryModel = chatBridgeConfig.primary?.model || '';
        var defaultFreeModel = configuredPrimaryModel === 'openrouter/free' || configuredPrimaryModel.endsWith(':free')
          ? configuredPrimaryModel
          : 'openrouter/free';
        return {
          kind: 'primary',
          title: 'Grass 引导配置',
          name: 'Grass',
          subtitle: '通过 OpenRouter 免费模型负责规划、Skill 生成、质量检查和复杂推理。',
          role: '粘贴 OpenRouter API Key 后，系统会实时筛选价格为零、可输出文本且支持 Agent 工具的模型。',
          defaultUrl: OPENROUTER_API_URL,
          defaultKey: '',
          hasKey: !!chatBridgeConfig.primary?.hasApiKey,
          defaultModel: defaultFreeModel,
          advancedAction: 'showChatBridgeDialog()',
          saveLabel: '保存 Grass 配置'
        };
      }
      if (kind === 'embedding') {
        var embeddingConfig = getEmbeddingConfig();
        return {
          kind: 'embedding',
          title: 'Embedding 引导配置',
          name: 'Embedding',
          subtitle: '负责语义检索，让句子、论点和文献摘要按含义匹配。',
          role: '建议使用阿里云百炼的 text-embedding-v4；配置后文献检索会从关键词匹配升级为语义相似度重排。',
          defaultUrl: embeddingConfig.url || DEFAULT_EMBEDDING_API_URL,
          defaultKey: embeddingConfig.key || '',
          hasKey: !!embeddingConfig.key,
          defaultModel: embeddingConfig.model || DEFAULT_EMBEDDING_MODEL,
          enabled: embeddingConfig.enabled !== false,
          advancedAction: 'showEmbeddingDialog()',
          saveLabel: '保存 Embedding 配置'
        };
      }
      loadApiConfig();
      return {
        kind: 'secondary',
        title: 'Little corse 引导配置',
        name: 'Little corse',
        subtitle: '负责日常聊天、写作执行、引用验证和快速内容生成。',
        role: '建议使用稳定、便宜、响应快的模型，例如通义千问、DeepSeek、Kimi 或豆包。',
        defaultUrl: apiConfig.url || DEFAULT_EMBEDDING_API_URL,
        defaultKey: apiConfig.key || '',
        hasKey: !!apiConfig.key,
        defaultModel: apiConfig.model || currentModel || 'qwen3.5-plus',
        advancedAction: 'showConnectDialog()',
        saveLabel: '保存 Little corse 配置'
      };
    }

    function initGuidedConfigState(kind) {
      var meta = getGuidedConfigMeta(kind);
      guidedConfigState = {
        kind: meta.kind,
        step: 0,
        provider: meta.kind === 'primary' ? 'openrouter' : 'qwen',
        apiUrl: meta.defaultUrl,
        apiKey: meta.defaultKey,
        model: meta.defaultModel,
        enabled: meta.enabled !== false,
        hasKey: meta.hasKey
      };
      return meta;
    }

    function captureGuidedConfigInputs() {
      if (!guidedConfigState) return;
      var providerInput = document.querySelector('input[name="guidedProvider"]:checked');
      if (providerInput) guidedConfigState.provider = providerInput.value;
      var apiUrl = document.getElementById('guidedApiUrl');
      var apiKey = document.getElementById('guidedApiKey');
      var model = document.getElementById('guidedModel');
      var enabled = document.getElementById('guidedEmbeddingEnabled');
      if (apiUrl) guidedConfigState.apiUrl = apiUrl.value.trim();
      if (apiKey) guidedConfigState.apiKey = apiKey.value.trim();
      if (model) guidedConfigState.model = model.value.trim();
      if (enabled) guidedConfigState.enabled = enabled.checked;
    }

    function getGuidedProviderList(kind) {
      if (kind === 'primary') {
        return [{
          id: 'openrouter',
          name: 'OpenRouter',
          apiUrl: OPENROUTER_API_URL,
          applyUrl: OPENROUTER_KEYS_URL,
          modelHint: 'openrouter/free 或具体的 :free 模型',
          note: 'Grass 只显示支持 Agent 工具的实时免费模型，列表会随 OpenRouter 自动更新。'
        }];
      }
      var providers = [];
      CHINA_AI_API_PROVIDERS.forEach(function(provider) {
        providers.push(provider);
      });
      if (kind === 'embedding') {
        return [{
          id: 'qwen',
          name: '阿里云百炼',
          apiUrl: DEFAULT_EMBEDDING_API_URL,
          applyUrl: QWEN_API_KEY_URL,
          modelHint: DEFAULT_EMBEDDING_MODEL,
          note: '推荐配置，当前语义检索默认按这个模型优化。'
        }];
      }
      return providers;
    }

    function renderGuidedStepPills(step) {
      var labels = ['选择平台', '填写 Key', '模型与保存'];
      return '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0 14px;">' + labels.map(function(label, index) {
        var active = index === step;
        var done = index < step;
        return '<div style="padding:8px 9px;border:1px solid ' + (active ? 'var(--accent-color)' : 'var(--border-color)') + ';border-radius:8px;background:' + (active ? 'var(--modal-tip-bg)' : 'var(--bg-secondary)') + ';color:' + (active || done ? 'var(--text-primary)' : 'var(--text-secondary)') + ';font-size:12px;font-weight:' + (active ? '800' : '650') + ';text-align:center;">' + (index + 1) + '. ' + label + '</div>';
      }).join('') + '</div>';
    }

    function renderGuidedProviderCards(kind) {
      var providers = getGuidedProviderList(kind);
      return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;">' + providers.map(function(provider, index) {
        var checked = guidedConfigState.provider === provider.id || (!guidedConfigState.provider && index === 0);
        return '' +
          '<label style="display:flex;gap:9px;align-items:flex-start;padding:10px;border:1px solid ' + (checked ? 'var(--accent-color)' : 'var(--border-color)') + ';border-radius:9px;background:' + (checked ? 'var(--modal-tip-bg)' : 'var(--bg-secondary)') + ';cursor:pointer;">' +
            '<input type="radio" name="guidedProvider" value="' + escapeHtml(provider.id) + '"' + (checked ? ' checked' : '') + ' onchange="applyGuidedProviderPreset()" style="width:15px;height:15px;margin-top:2px;accent-color:var(--accent-color);">' +
            '<span style="min-width:0;">' +
              '<span style="display:block;font-size:13px;font-weight:800;color:var(--text-primary);">' + escapeHtml(provider.name) + '</span>' +
              '<span style="display:block;margin-top:3px;font-size:11px;line-height:1.5;color:var(--text-secondary);">模型示例：' + escapeHtml(provider.modelHint || '') + '</span>' +
              '<span style="display:block;margin-top:5px;font-size:11px;line-height:1.5;color:var(--text-secondary);">' + escapeHtml(provider.note || provider.apiUrl || '') + '</span>' +
            '</span>' +
          '</label>';
      }).join('') + '</div>';
    }

    function renderGuidedConfigPanel(meta) {
      var step = guidedConfigState.step || 0;
      var status = '<div id="guidedConfigStatus" style="min-height:18px;font-size:12px;color:var(--text-secondary);line-height:1.6;"></div>';
      if (step === 0) {
        return '' +
          '<section style="border:1px solid var(--border-color);border-radius:10px;background:var(--bg-secondary);padding:14px;">' +
            '<div style="font-size:13px;font-weight:800;color:var(--text-primary);margin-bottom:8px;">这一步要做什么</div>' +
            '<div style="font-size:12px;line-height:1.7;color:var(--text-secondary);margin-bottom:12px;">先选择你准备用哪个模型服务商。系统会自动填入常见 API 地址，用户只需要去对应平台申请 API Key。</div>' +
            renderGuidedProviderCards(meta.kind) +
          '</section>' +
          status +
          '<div class="btns" style="margin-top:14px;"><button class="cancel" onclick="returnFromGuidedConfig()">返回</button><button class="ok" onclick="guidedConfigNextStep()">下一步</button></div>';
      }
      if (step === 1) {
        var provider = getGuidedProviderList(meta.kind).find(function(item) { return item.id === guidedConfigState.provider; }) || getGuidedProviderList(meta.kind)[0];
        return '' +
          '<section style="border:1px solid var(--border-color);border-radius:10px;background:var(--bg-secondary);padding:14px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">' +
              '<div><div style="font-size:13px;font-weight:800;color:var(--text-primary);">申请并粘贴 API Key</div><div style="font-size:11px;color:var(--text-secondary);margin-top:3px;">API Key 是模型平台给你的调用密码，只粘贴在本机配置里。</div></div>' +
              '<button type="button" onclick="openVendorConfigBrowser(\'' + escapeHtml(provider.id || '') + '\')" style="padding:7px 10px;border:1px solid var(--accent-color);border-radius:7px;background:var(--accent-color);color:white;cursor:pointer;font-size:12px;font-weight:750;white-space:nowrap;">在右侧打开官网</button>' +
            '</div>' +
            '<label style="display:block;margin-bottom:5px;font-size:12px;font-weight:750;color:var(--text-primary);">API 地址</label>' +
            '<input id="guidedApiUrl" type="text" value="' + escapeHtml(guidedConfigState.apiUrl || provider.apiUrl || '') + '" style="width:100%;padding:9px 10px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:12px;margin-bottom:10px;">' +
            '<label style="display:block;margin-bottom:5px;font-size:12px;font-weight:750;color:var(--text-primary);">API Key</label>' +
            '<input id="guidedApiKey" type="password" value="' + escapeHtml(guidedConfigState.apiKey || '') + '" placeholder="' + (guidedConfigState.hasKey && !guidedConfigState.apiKey ? '已保存；留空保持原 Key' : '粘贴平台生成的 API Key') + '" style="width:100%;padding:9px 10px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' +
            '<div style="margin-top:8px;font-size:11px;line-height:1.6;color:var(--text-secondary);">不要填写 Scholar Harness 官网账号接口。这里必须是模型服务商的 OpenAI 兼容 API 地址。</div>' +
          '</section>' +
          status +
          '<div class="btns" style="margin-top:14px;"><button class="cancel" onclick="guidedConfigPrevStep()">上一步</button><button class="ok" onclick="guidedConfigNextStep()">下一步</button></div>';
      }
      var guidedModelControl = '';
      if (meta.kind === 'primary') {
        var freeModels = Array.isArray(guidedConfigState.freeModels) ? guidedConfigState.freeModels : [];
        var freeModelOptions = freeModels.map(function(model) {
          var id = typeof model === 'string' ? model : model.id;
          var name = typeof model === 'string' ? model : (model.name || model.id);
          var tools = typeof model === 'object' && model.supportsTools ? ' · 工具' : '';
          return '<option value="' + escapeHtml(id) + '"' + (id === guidedConfigState.model ? ' selected' : '') + '>' + escapeHtml(name + (name !== id ? ' · ' + id : '') + tools) + '</option>';
        }).join('');
        guidedModelControl = '<select id="guidedModel" style="width:100%;padding:9px 10px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' + freeModelOptions + '</select>';
      } else {
        guidedModelControl = '<input id="guidedModel" type="text" value="' + escapeHtml(guidedConfigState.model || meta.defaultModel) + '" style="width:100%;padding:9px 10px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">';
      }
      return '' +
        '<section style="border:1px solid var(--border-color);border-radius:10px;background:var(--bg-secondary);padding:14px;">' +
          '<div style="font-size:13px;font-weight:800;color:var(--text-primary);margin-bottom:8px;">模型与开关</div>' +
          '<div style="font-size:12px;line-height:1.7;color:var(--text-secondary);margin-bottom:10px;">' + (meta.kind === 'primary' ? '下面是使用当前 API Key 实时获取并自动筛选出的 OpenRouter 免费 Agent 模型。' : '模型名称要和服务商后台显示的 Model ID 一致。') + '</div>' +
          '<label style="display:block;margin-bottom:5px;font-size:12px;font-weight:750;color:var(--text-primary);">' + (meta.kind === 'primary' ? '免费模型' : '模型名称') + '</label>' +
          guidedModelControl +
          (meta.kind === 'embedding' ? '<label style="display:flex;align-items:center;gap:8px;margin-top:12px;color:var(--text-primary);font-size:12px;cursor:pointer;"><input id="guidedEmbeddingEnabled" type="checkbox" ' + (guidedConfigState.enabled !== false ? 'checked' : '') + ' style="width:15px;height:15px;accent-color:var(--accent-color);">启用 Embedding 语义检索</label>' : '') +
        '</section>' +
        status +
        '<div class="btns" style="margin-top:14px;"><button class="cancel" onclick="guidedConfigPrevStep()">上一步</button><button class="ok" id="guidedConfigSaveButton" onclick="saveGuidedConfig()">检测连接并' + escapeHtml(meta.saveLabel) + '</button></div>';
    }

    async function showGuidedConfigDialog(kind, step) {
      if (!guidedConfigState || guidedConfigState.kind !== kind) {
        if (kind === 'primary') await loadChatBridgeConfig();
        initGuidedConfigState(kind);
      }
      if (typeof step === 'number') guidedConfigState.step = Math.max(0, Math.min(2, step));
      var meta = getGuidedConfigMeta(kind);
      var html = '' +
        '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px;">' +
          '<div style="min-width:0;">' +
            '<div style="font-size:16px;font-weight:850;color:var(--text-primary);">' + escapeHtml(meta.name) + '</div>' +
            '<div style="margin-top:4px;font-size:12px;line-height:1.65;color:var(--text-secondary);">' + escapeHtml(meta.subtitle) + '<br>' + escapeHtml(meta.role) + '</div>' +
          '</div>' +
          '<button type="button" onclick="' + meta.advancedAction + '" style="padding:7px 10px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;white-space:nowrap;">高级配置</button>' +
        '</div>' +
        renderGuidedStepPills(guidedConfigState.step || 0) +
        renderGuidedConfigPanel(meta);
      showModal(meta.title, html, true);
    }
    window.showGuidedConfigDialog = showGuidedConfigDialog;

    function applyGuidedProviderPreset() {
      captureGuidedConfigInputs();
      if (!guidedConfigState) return;
      var provider = getGuidedProviderList(guidedConfigState.kind).find(function(item) { return item.id === guidedConfigState.provider; });
      if (!provider) return;
      guidedConfigState.apiUrl = provider.apiUrl || guidedConfigState.apiUrl;
      if (guidedConfigState.kind === 'embedding') {
        guidedConfigState.model = DEFAULT_EMBEDDING_MODEL;
      } else if (provider.id === 'qwen') {
        guidedConfigState.model = guidedConfigState.kind === 'primary' ? 'qwen-max' : 'qwen3.5-plus';
      } else if (provider.id === 'openrouter') {
        guidedConfigState.model = 'openrouter/free';
      } else if (!guidedConfigState.model) {
        guidedConfigState.model = provider.modelHint || '';
      }
      showGuidedConfigDialog(guidedConfigState.kind, guidedConfigState.step);
    }
    window.applyGuidedProviderPreset = applyGuidedProviderPreset;

    async function guidedConfigNextStep() {
      captureGuidedConfigInputs();
      if (!guidedConfigState) return;
      var previousStep = guidedConfigState.step || 0;
      if (guidedConfigState.step === 1) {
        if (!guidedConfigState.apiUrl) {
          var status = document.getElementById('guidedConfigStatus');
          if (status) status.innerHTML = '<span style="color:var(--danger-color);">请先填写 API 地址。</span>';
          return;
        }
        if (isScholarHarnessAccountApiUrl(guidedConfigState.apiUrl)) {
          var status2 = document.getElementById('guidedConfigStatus');
          if (status2) status2.innerHTML = '<span style="color:var(--danger-color);">这个地址是官网账号接口，不是模型 API 地址。请填写模型服务商的 API 地址。</span>';
          return;
        }
        if (!guidedConfigState.apiKey && !guidedConfigState.hasKey) {
          var status3 = document.getElementById('guidedConfigStatus');
          if (status3) status3.innerHTML = '<span style="color:var(--danger-color);">请先粘贴 API Key。</span>';
          return;
        }
        if (guidedConfigState.kind === 'primary') {
          var loadingStatus = document.getElementById('guidedConfigStatus');
          if (loadingStatus) loadingStatus.textContent = '正在连接 OpenRouter 并筛选免费模型...';
          try {
            var freeResponse = await fetch('/api/chat-bridge/models', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                agent: 'primary',
                apiUrl: OPENROUTER_API_URL,
                apiKey: guidedConfigState.apiKey || undefined
              })
            });
            var freeResult = await freeResponse.json().catch(function() { return {}; });
            if (!freeResponse.ok || !freeResult.success || !freeResult.freeOnly || !Array.isArray(freeResult.models) || !freeResult.models.length) {
              throw new Error(freeResult.error || '没有获取到可用免费模型');
            }
            guidedConfigState.freeModels = Array.isArray(freeResult.modelDetails) && freeResult.modelDetails.length
              ? freeResult.modelDetails
              : freeResult.models;
            if (freeResult.models.indexOf(guidedConfigState.model) < 0) {
              guidedConfigState.model = freeResult.models[0];
            }
          } catch (error) {
            if (loadingStatus) loadingStatus.innerHTML = '<span style="color:var(--danger-color);">OpenRouter 验证失败：' + escapeHtml(error.message || String(error)) + '。请检查 API Key 后重试。</span>';
            return;
          }
        }
      }
      guidedConfigState.step = Math.min(2, (guidedConfigState.step || 0) + 1);
      showGuidedConfigDialog(guidedConfigState.kind, guidedConfigState.step);
        if (previousStep === 0 && guidedConfigState.returnTarget === 'ai-configuration') {
          var provider = getGuidedProviderList(guidedConfigState.kind).find(function(item) {
            return item.id === guidedConfigState.provider;
          });
          if (provider && provider.id) {
            openVendorConfigBrowser(provider.id);
          }
        }
    }
    window.guidedConfigNextStep = guidedConfigNextStep;

    function guidedConfigPrevStep() {
      captureGuidedConfigInputs();
      if (!guidedConfigState) return;
      guidedConfigState.step = Math.max(0, (guidedConfigState.step || 0) - 1);
      showGuidedConfigDialog(guidedConfigState.kind, guidedConfigState.step);
    }
    window.guidedConfigPrevStep = guidedConfigPrevStep;

    async function verifyGuidedAiConnection(kind) {
      var status = document.getElementById('guidedConfigStatus');
      var saveButton = document.getElementById('guidedConfigSaveButton');
      if (status) status.textContent = '正在验证 API 地址、密钥和模型列表...';
      if (saveButton) saveButton.disabled = true;
      try {
        var response = await fetch('/api/chat-bridge/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent: kind === 'primary' ? 'primary' : 'secondary',
            apiUrl: normalizeApiBaseUrl(guidedConfigState.apiUrl),
            apiKey: guidedConfigState.apiKey || undefined
          })
        });
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.success) {
          if (status) status.innerHTML = '<span style="color:var(--danger-color);">连接验证失败：' + escapeHtml(result.error || ('HTTP ' + response.status)) + '。请检查 API 地址和 Key。</span>';
          return false;
        }
        var models = Array.isArray(result.models) ? result.models : [];
        if (models.length && guidedConfigState.model && models.indexOf(guidedConfigState.model) < 0) {
          if (status) status.innerHTML = '<span style="color:var(--danger-color);">连接成功，但当前账户没有返回模型 “' + escapeHtml(guidedConfigState.model) + '”。请填写服务商模型列表中的 Model ID。</span>';
          return false;
        }
        if (status) status.innerHTML = '<span style="color:var(--success-color);">连接验证通过，正在保存...</span>';
        return true;
      } catch (error) {
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">连接验证失败：' + escapeHtml(error.message || String(error)) + '</span>';
        return false;
      } finally {
        if (saveButton) saveButton.disabled = false;
      }
    }

    async function saveGuidedConfig() {
      captureGuidedConfigInputs();
      if (!guidedConfigState) return;
      if (!guidedConfigState.model) {
        var status = document.getElementById('guidedConfigStatus');
        if (status) status.innerHTML = '<span style="color:var(--danger-color);">请填写模型名称。</span>';
        return;
      }
      if (guidedConfigState.kind === 'secondary') {
        if (!(await verifyGuidedAiConnection('secondary'))) return;
        apiConfig.url = normalizeApiBaseUrl(guidedConfigState.apiUrl);
        apiConfig.key = guidedConfigState.apiKey;
        apiConfig.model = guidedConfigState.model;
        if (!apiConfig.key) {
          var secondaryStatus = document.getElementById('guidedConfigStatus');
          if (secondaryStatus) secondaryStatus.innerHTML = '<span style="color:var(--danger-color);">Little corse 需要填写 API Key。</span>';
          return;
        }
        saveApiConfig();
        var returnToOnboarding = guidedConfigState.returnTarget === 'onboarding';
        var returnToAiConfiguration = guidedConfigState.returnTarget === 'ai-configuration';
        appendMessage('✅ Little corse 配置已保存\n\n模型：' + currentModel, 'bot', false, true);
        if (returnToOnboarding) {
          closeModal();
          showFirstRunOnboardingDialog({ manual: true, autoDetect: false });
        } else if (returnToAiConfiguration) {
          guidedConfigState = null;
          firstRunOnboardingReadiness = null;
          closeModal();
          setTimeout(function() { startAiConfigurationAssistant('all'); }, 120);
        } else {
          showConfigCenterDialog();
        }
        return;
      }
      if (guidedConfigState.kind === 'embedding') {
        var embeddingReturnTarget = guidedConfigState.returnTarget || '';
        var embeddingUrl = document.createElement('input');
        var embeddingKey = document.createElement('input');
        var embeddingModel = document.createElement('input');
        var embeddingEnabled = document.createElement('input');
        embeddingUrl.id = 'embeddingUrl';
        embeddingKey.id = 'embeddingKey';
        embeddingModel.id = 'embeddingModel';
        embeddingEnabled.id = 'embeddingEnabled';
        embeddingEnabled.type = 'checkbox';
        embeddingUrl.value = guidedConfigState.apiUrl || DEFAULT_EMBEDDING_API_URL;
        embeddingKey.value = guidedConfigState.apiKey || '';
        embeddingModel.value = guidedConfigState.model || DEFAULT_EMBEDDING_MODEL;
        embeddingEnabled.checked = guidedConfigState.enabled !== false;
        [embeddingUrl, embeddingKey, embeddingModel, embeddingEnabled].forEach(function(node) {
          node.style.display = 'none';
          document.body.appendChild(node);
        });
        try {
          var embeddingSaved = await saveEmbeddingConfig({
            returnAction: embeddingReturnTarget === 'onboarding'
              ? 'first-run-onboarding'
              : (embeddingReturnTarget === 'ai-configuration' ? 'ai-configuration' : '')
          });
          if (embeddingSaved && embeddingReturnTarget === 'onboarding') {
            closeModal();
            showFirstRunOnboardingDialog({ manual: true, autoDetect: false });
          }
        } finally {
          [embeddingUrl, embeddingKey, embeddingModel, embeddingEnabled].forEach(function(node) { node.remove(); });
        }
        return;
      }
      if (!(await verifyGuidedAiConnection('primary'))) return;
      var existingPool = chatBridgeConfig.primary?.pool;
      var existingOpenRouterEntry = existingPool && Array.isArray(existingPool.models)
        ? existingPool.models.find(function(entry) { return normalizeApiBaseUrl(entry.api_url || '') === OPENROUTER_API_URL; })
        : null;
      var grasslandEntryId = existingOpenRouterEntry?.id || 'grassland-openrouter';
      var primaryResponse;
      try {
        primaryResponse = await fetch('/api/chat-bridge/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: true,
            mode: 'api',
            primary: {
              description: 'Grass - OpenRouter 免费模型',
              pool: {
                models: [{
                  id: grasslandEntryId,
                  label: 'OpenRouter',
                  model: guidedConfigState.model,
                  api_url: OPENROUTER_API_URL,
                  api_key: guidedConfigState.apiKey || '',
                  enabled: true,
                  priority: 0
                }],
                active_model_id: grasslandEntryId,
                auto_fallback: true
              }
            }
          })
        });
      } catch (error) {
        var primaryNetworkStatus = document.getElementById('guidedConfigStatus');
        if (primaryNetworkStatus) primaryNetworkStatus.innerHTML = '<span style="color:var(--danger-color);">保存失败：' + escapeHtml(error.message || String(error)) + '</span>';
        return;
      }
      var primaryResult = await primaryResponse.json().catch(function() { return {}; });
      if (!primaryResponse.ok || !primaryResult.success) {
        var primaryStatus = document.getElementById('guidedConfigStatus');
        if (primaryStatus) primaryStatus.innerHTML = '<span style="color:var(--danger-color);">保存失败：' + escapeHtml(primaryResult.error || ('HTTP ' + primaryResponse.status)) + '</span>';
        return;
      }
      await loadChatBridgeConfig();
      localStorage.setItem(CHAT_BRIDGE_KEY, JSON.stringify(chatBridgeConfig));
      updateModelBadge();
      appendMessage('✅ Grass 配置已保存\n\nOpenRouter 免费模型：' + guidedConfigState.model, 'bot', false, true);
      var primaryReturnTarget = guidedConfigState.returnTarget || '';
      guidedConfigState = null;
      firstRunOnboardingReadiness = null;
      closeModal();
      if (primaryReturnTarget === 'onboarding') {
        showFirstRunOnboardingDialog({ manual: true, autoDetect: false });
      } else if (primaryReturnTarget === 'ai-configuration') {
        setTimeout(function() { startAiConfigurationAssistant('all'); }, 120);
      } else {
        showConfigCenterDialog();
      }
    }
    window.saveGuidedConfig = saveGuidedConfig;

    var configCenterCodexModels = [];
    var configCenterCodexModelsMeta = {};
    var CONFIG_CENTER_CODEX_EFFORTS_KEY = 'scholarharness_codex_effort_by_model';
    var configCenterCodexEffortByModel = {};
    var configCenterCodexCommandAutoSaveTimer = null;
    var configCenterRuntimeModelsById = { pi: [], opencode: [] };
    var configCenterRuntimeProvidersById = { pi: [], opencode: [] };
    var CONFIG_CENTER_RUNTIME_INSTALLERS = {
      codex: { label: 'Codex', packageName: '@openai/codex' },
      pi: { label: 'Pi', packageName: '@earendil-works/pi-coding-agent' },
      opencode: { label: 'OpenCode', packageName: 'opencode-ai' }
    };

    function scheduleConfigCenterCodexCommandAutoSave() {
      if (configCenterCodexCommandAutoSaveTimer) {
        clearTimeout(configCenterCodexCommandAutoSaveTimer);
      }
      var statusDiv = document.getElementById('configCenterCodexStatus');
      if (statusDiv) statusDiv.textContent = '正在自动识别 Codex CLI 路径...';
      configCenterCodexCommandAutoSaveTimer = setTimeout(flushConfigCenterCodexCommandAutoSave, 500);
    }
    window.scheduleConfigCenterCodexCommandAutoSave = scheduleConfigCenterCodexCommandAutoSave;

    async function flushConfigCenterCodexCommandAutoSave() {
      if (configCenterCodexCommandAutoSaveTimer) {
        clearTimeout(configCenterCodexCommandAutoSaveTimer);
        configCenterCodexCommandAutoSaveTimer = null;
      }
      var commandInput = document.getElementById('configCenterCodexCommand');
      if (!commandInput) return;
      var command = String(commandInput.value || '').trim();
      var savedCommand = String(chatBridgeConfig.codex?.command || '').trim();
      if (command === savedCommand) {
        await refreshConfigCenterCodexStatus();
        return;
      }
      await saveConfigCenterAgentRuntimes();
    }
    window.flushConfigCenterCodexCommandAutoSave = flushConfigCenterCodexCommandAutoSave;

    function loadConfigCenterCodexEffortByModel() {
      try {
        var parsed = JSON.parse(localStorage.getItem(CONFIG_CENTER_CODEX_EFFORTS_KEY) || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch (e) {
        return {};
      }
    }

    function rememberConfigCenterCodexEffort(model, effort) {
      var normalizedModel = String(model || '').trim();
      var normalizedEffort = String(effort || '').trim();
      if (!normalizedModel || !normalizedEffort) return;
      configCenterCodexEffortByModel[normalizedModel] = normalizedEffort;
      try {
        localStorage.setItem(CONFIG_CENTER_CODEX_EFFORTS_KEY, JSON.stringify(configCenterCodexEffortByModel));
      } catch (e) {}
    }

    function configCenterRuntimeCard(runtimeId, label, description) {
      var runtimes = chatBridgeConfig.agentRuntimes || {};
      var config = runtimes[runtimeId] || {};
      var prefix = 'configCenterRuntime' + (runtimeId === 'pi' ? 'Pi' : 'Opencode');
      var initialEfforts = runtimeId === 'pi'
        ? ['off','minimal','low','medium','high','xhigh','max']
        : ['low','medium','high','xhigh'];
      var savedModelOption = config.model
        ? '<option value="' + escapeHtml(config.model) + '" selected>当前配置 · ' + escapeHtml(config.model) + '</option>'
        : '';
      var providerAuth = config.provider_auth || {};
      var savedProvider = String(providerAuth.provider || '');
      var authMode = providerAuth.mode === 'api_key' ? 'api_key' : 'cli_login';
      var savedProviderOption = savedProvider
        ? '<option value="' + escapeHtml(savedProvider) + '" selected>当前厂商 · ' + escapeHtml(savedProvider) + '</option>'
        : '';
      return '<section class="agent-runtime-card" data-runtime-id="' + runtimeId + '">' +
        '<div class="agent-runtime-head">' +
          '<span><strong>' + escapeHtml(label) + '</strong><small>' + escapeHtml(description) + '</small></span>' +
          '<label class="agent-runtime-enable"><input id="' + prefix + 'Enabled" type="checkbox" ' + (config.enabled ? 'checked' : '') + '>启用</label>' +
        '</div>' +
        '<div class="agent-runtime-auth">' +
          '<div class="agent-runtime-auth-title"><strong>模型厂商与认证</strong><span>认证只提供给当前 Agent 进程，API Key 加密保存且不会回显。</span></div>' +
          '<div class="agent-runtime-fields">' +
            '<label class="agent-runtime-field"><span>模型厂商</span><select id="' + prefix + 'Provider" data-selected="' + escapeHtml(savedProvider) + '" onchange="handleConfigCenterRuntimeProviderChange(\'' + runtimeId + '\')"><option value="">选择厂商</option>' + savedProviderOption + '<option value="__custom__">其他厂商 ID</option></select></label>' +
            '<label class="agent-runtime-field"><span>认证方式</span><select id="' + prefix + 'AuthMode" onchange="syncConfigCenterRuntimeAuthMode(\'' + runtimeId + '\')"><option value="cli_login" ' + (authMode === 'cli_login' ? 'selected' : '') + '>CLI 登录</option><option value="api_key" ' + (authMode === 'api_key' ? 'selected' : '') + '>API Key</option></select></label>' +
            '<label id="' + prefix + 'ApiKeyField" class="agent-runtime-field agent-runtime-field-wide"><span>API Key</span><input id="' + prefix + 'ApiKey" type="password" value="" autocomplete="off" placeholder="' + (providerAuth.has_api_key ? '已安全保存，留空保持不变' : '输入该厂商 API Key') + '"></label>' +
            '<label id="' + prefix + 'CustomProviderField" class="agent-runtime-field agent-runtime-field-wide" hidden><span>其他厂商 ID</span><input id="' + prefix + 'CustomProvider" type="text" value="" placeholder="例如 digitalocean 或自定义 provider id"></label>' +
          '</div>' +
          '<div id="' + prefix + 'AuthStatus" class="agent-runtime-auth-status" data-state="idle">' + (providerAuth.has_api_key ? '已保存 API Key，可刷新模型验证。' : '请选择厂商并完成认证。') + '</div>' +
          '<div class="agent-runtime-actions"><button id="' + prefix + 'LoginButton" class="agent-runtime-button" type="button" onclick="openConfigCenterRuntimeLogin(\'' + runtimeId + '\')">打开登录终端</button></div>' +
        '</div>' +
        '<div class="agent-runtime-fields">' +
          '<label class="agent-runtime-field agent-runtime-field-wide"><span>CLI 路径</span><input id="' + prefix + 'Command" type="text" value="' + escapeHtml(config.command || '') + '" placeholder="留空自动检测 ' + runtimeId + '"></label>' +
          '<label class="agent-runtime-field"><span>模型</span><select id="' + prefix + 'Model" data-selected="' + escapeHtml(config.model || '') + '" onchange="handleConfigCenterRuntimeModelChange(\'' + runtimeId + '\')"><option value="">运行时默认</option>' + savedModelOption + '</select></label>' +
          '<label class="agent-runtime-field"><span>推理强度</span><select id="' + prefix + 'Effort" data-selected="' + escapeHtml(config.reasoning_effort || 'medium') + '" onchange="this.setAttribute(\'data-selected\', this.value)">' +
            initialEfforts.map(function(effort) { return '<option value="' + effort + '" ' + ((config.reasoning_effort || 'medium') === effort ? 'selected' : '') + '>' + effort + '</option>'; }).join('') +
          '</select></label>' +
          '<label class="agent-runtime-field"><span>工作区权限</span><select id="' + prefix + 'Sandbox">' +
            ['read-only','workspace-write','danger-full-access'].map(function(level) { return '<option value="' + level + '" ' + ((config.sandbox || 'workspace-write') === level ? 'selected' : '') + '>' + level + '</option>'; }).join('') +
          '</select></label>' +
          '<label class="agent-runtime-field"><span>单轮超时，毫秒</span><input id="' + prefix + 'Timeout" type="number" min="10000" max="3600000" step="10000" value="' + Number(config.timeout_ms || 1800000) + '"></label>' +
        '</div>' +
        '<details class="agent-runtime-manual-model"><summary>使用未列出的模型 ID</summary><label class="agent-runtime-field"><span>手动模型 ID</span><input id="' + prefix + 'CustomModel" type="text" placeholder="例如 provider/model" oninput="handleConfigCenterRuntimeCustomModelInput(\'' + runtimeId + '\')"></label></details>' +
        '<div id="' + prefix + 'ModelSource" class="agent-runtime-model-source">检测 CLI 后可读取模型。</div>' +
        '<div id="' + prefix + 'Status" class="agent-runtime-status" data-state="idle">尚未检测</div>' +
        '<div class="agent-runtime-actions">' +
          '<button id="' + prefix + 'InstallButton" class="agent-runtime-button agent-runtime-button-primary" type="button" onclick="installConfigCenterRuntime(\'' + runtimeId + '\')" hidden>一键部署 CLI</button>' +
          '<button id="' + prefix + 'RefreshModelsButton" class="agent-runtime-button" type="button" onclick="loadConfigCenterRuntimeModels(\'' + runtimeId + '\')">刷新模型</button>' +
          '<button id="' + prefix + 'DetectButton" class="agent-runtime-button" type="button" onclick="refreshConfigCenterRuntimeStatus(\'' + runtimeId + '\')">检测 CLI</button>' +
        '</div>' +
      '</section>';
    }

    function configCenterCodexRuntimeHtml(currentCodexModel, currentCodexEffort, currentCodexConcurrency) {
      var codex = chatBridgeConfig.codex || {};
      var enabled = codex.enabled === true || codex.prefer === true;
      return '<div style="padding:14px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);margin-bottom:10px;">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">' +
          '<span><strong style="font-size:13px;color:var(--text-primary);">Codex</strong><small style="display:block;margin-top:3px;color:var(--text-secondary);line-height:1.5;">App Server 持久会话、MCP 工具、steer、取消和安全工作区。</small></span>' +
          '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-secondary);"><input id="configCenterCodexCliPrefer" type="checkbox" ' + (enabled ? 'checked' : '') + '>启用</label>' +
        '</div>' +
        '<input id="configCenterCodexCommand" type="text" value="' + escapeHtml(codex.command || '') + '" placeholder="CLI 路径；留空自动检测 codex" oninput="scheduleConfigCenterCodexCommandAutoSave()" onchange="flushConfigCenterCodexCommandAutoSave()" style="margin-top:10px;min-width:0;width:100%;padding:8px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' +
        '<div style="margin-top:12px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;"><strong style="font-size:12px;color:var(--text-primary);">模型</strong><button type="button" onclick="loadConfigCenterCodexModels(true)" style="padding:4px 7px;border:0;border-radius:6px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:10.8px;">刷新模型</button></div>' +
          '<div id="configCenterCodexModelList" data-selected="' + escapeHtml(currentCodexModel) + '" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;"><div style="font-size:11px;color:var(--text-secondary);">正在读取 Codex 可用模型...</div></div>' +
          '<div id="configCenterCodexModelSource" style="margin-top:6px;font-size:10.8px;line-height:1.5;color:var(--text-secondary);"></div>' +
        '</div>' +
        '<div style="margin-top:12px;">' +
          '<strong style="display:block;font-size:12px;color:var(--text-primary);margin-bottom:7px;">Reasoning Effort</strong>' +
          '<div id="configCenterCodexEffortList" data-selected="' + escapeHtml(currentCodexEffort) + '" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;"><div style="font-size:11px;color:var(--text-secondary);">选择模型后显示可用档位。</div></div>' +
          '<div id="configCenterCodexEffortHint" style="margin-top:6px;font-size:10.8px;line-height:1.5;color:var(--text-secondary);"></div>' +
        '</div>' +
        '<div id="configCenterCodexStatus" class="agent-runtime-status" data-state="loading">正在自动检测 Codex CLI...</div>' +
        '<div class="agent-runtime-actions">' +
          '<button id="configCenterCodexInstallButton" class="agent-runtime-button agent-runtime-button-primary" type="button" onclick="installConfigCenterRuntime(\'codex\')" hidden>一键部署 CLI</button>' +
          '<button class="agent-runtime-button" type="button" onclick="refreshConfigCenterCodexStatus()">检测 CLI</button>' +
        '</div>' +
        '<div style="margin-top:12px;display:grid;grid-template-columns:170px 1fr;gap:10px;align-items:center;">' +
          '<label for="configCenterCodexConcurrency" style="font-size:12px;font-weight:700;color:var(--text-primary);">PDF Wiki 多开数</label>' +
          '<input id="configCenterCodexConcurrency" type="number" min="1" max="6" step="1" value="' + currentCodexConcurrency + '" style="width:100%;padding:8px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12px;">' +
        '</div>' +
      '</div>';
    }

    function configCenterAgentRuntimeHtml(currentCodexModel, currentCodexEffort, currentCodexConcurrency) {
      var runtimes = chatBridgeConfig.agentRuntimes || {};
      var currentDefault = runtimes.default || (chatBridgeConfig.codex?.prefer ? 'codex' : '');
      return '<details class="config-inline-advanced">' +
        '<summary><span class="config-center-icon" aria-hidden="true"></span><span><strong>Agent 容器</strong><small>统一配置 Codex、Pi 与 OpenCode</small></span></summary>' +
        '<div style="margin:0 0 18px;padding:16px 8px;border-top:1px solid var(--border-color);">' +
          '<label style="display:grid;grid-template-columns:130px minmax(180px,1fr);align-items:center;gap:8px;margin-bottom:12px;font-size:12px;color:var(--text-primary);"><strong>默认运行时</strong>' +
            '<select id="configCenterRuntimeDefault" style="padding:8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);">' +
              [['','不设默认'],['codex','Codex'],['pi','Pi'],['opencode','OpenCode']].map(function(item) { return '<option value="' + item[0] + '" ' + (currentDefault === item[0] ? 'selected' : '') + '>' + item[1] + '</option>'; }).join('') +
            '</select>' +
          '</label>' +
          configCenterCodexRuntimeHtml(currentCodexModel, currentCodexEffort, currentCodexConcurrency) +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;">' +
            configCenterRuntimeCard('pi', 'Pi', 'RPC 持久会话；支持 steer、follow-up、取消和 Scholar Harness 工具扩展。') +
            configCenterRuntimeCard('opencode', 'OpenCode', 'JSON 事件流与 MCP；会话自动恢复，真实产物仍由 Scholar Harness 校验。') +
          '</div>' +
          '<div style="display:flex;justify-content:flex-end;margin-top:12px;"><button type="button" onclick="saveConfigCenterAgentRuntimes()" style="padding:8px 12px;border:1px solid #111;border-radius:6px;background:#111;color:#d6a928;cursor:pointer;font-size:12px;font-weight:700;">保存 Agent 容器</button></div>' +
        '</div>' +
      '</details>';
    }

    function getConfigCenterRuntimePrefix(runtimeId) {
      return 'configCenterRuntime' + (runtimeId === 'pi' ? 'Pi' : 'Opencode');
    }

    function setConfigCenterRuntimeInstallVisibility(runtimeId, visible) {
      var id = runtimeId === 'codex'
        ? 'configCenterCodexInstallButton'
        : getConfigCenterRuntimePrefix(runtimeId) + 'InstallButton';
      var button = document.getElementById(id);
      if (button) button.hidden = !visible;
    }

    function getConfigCenterRuntimeProviderValue(runtimeId) {
      var prefix = getConfigCenterRuntimePrefix(runtimeId);
      var select = document.getElementById(prefix + 'Provider');
      var custom = (document.getElementById(prefix + 'CustomProvider')?.value || '').trim().toLowerCase();
      return select?.value === '__custom__' ? custom : String(select?.value || '').trim().toLowerCase();
    }

    function syncConfigCenterRuntimeAuthMode(runtimeId) {
      var prefix = getConfigCenterRuntimePrefix(runtimeId);
      var mode = document.getElementById(prefix + 'AuthMode')?.value || 'cli_login';
      var apiKeyField = document.getElementById(prefix + 'ApiKeyField');
      var loginButton = document.getElementById(prefix + 'LoginButton');
      if (apiKeyField) apiKeyField.hidden = mode !== 'api_key';
      if (loginButton) loginButton.hidden = mode !== 'cli_login';
    }
    window.syncConfigCenterRuntimeAuthMode = syncConfigCenterRuntimeAuthMode;

    function handleConfigCenterRuntimeProviderChange(runtimeId) {
      var prefix = getConfigCenterRuntimePrefix(runtimeId);
      var select = document.getElementById(prefix + 'Provider');
      var customField = document.getElementById(prefix + 'CustomProviderField');
      if (select) select.setAttribute('data-selected', select.value || '');
      if (customField) customField.hidden = select?.value !== '__custom__';
      var modelSelect = document.getElementById(prefix + 'Model');
      if (modelSelect) modelSelect.innerHTML = '<option value="">请刷新该厂商模型</option>';
      configCenterRuntimeModelsById[runtimeId] = [];
    }
    window.handleConfigCenterRuntimeProviderChange = handleConfigCenterRuntimeProviderChange;

    function renderConfigCenterRuntimeProviders(runtimeId, providers) {
      var prefix = getConfigCenterRuntimePrefix(runtimeId);
      var select = document.getElementById(prefix + 'Provider');
      if (!select) return;
      var selected = select.getAttribute('data-selected') || String((chatBridgeConfig.agentRuntimes?.[runtimeId] || {}).provider_auth?.provider || '');
      var known = providers.some(function(provider) { return String(provider.id || '') === selected; });
      var html = '<option value="">选择厂商</option>';
      if (selected && !known) html += '<option value="' + escapeHtml(selected) + '">当前厂商 · ' + escapeHtml(selected) + '</option>';
      html += providers.map(function(provider) {
        return '<option value="' + escapeHtml(provider.id) + '">' + escapeHtml(provider.label || provider.id) + '</option>';
      }).join('');
      html += '<option value="__custom__">其他厂商 ID</option>';
      select.innerHTML = html;
      select.value = selected || '';
      select.setAttribute('data-selected', selected || '');
    }

    async function loadConfigCenterRuntimeProviders(runtimeId) {
      var prefix = getConfigCenterRuntimePrefix(runtimeId);
      var authStatus = document.getElementById(prefix + 'AuthStatus');
      try {
        var response = await fetch('/api/chat-bridge/agent-runtimes/' + runtimeId + '/providers', { cache: 'no-store' });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '模型厂商读取失败');
        var providers = Array.isArray(data.providers) ? data.providers : [];
        configCenterRuntimeProvidersById[runtimeId] = providers;
        renderConfigCenterRuntimeProviders(runtimeId, providers);
      } catch (error) {
        if (authStatus) {
          authStatus.setAttribute('data-state', 'error');
          authStatus.textContent = '厂商列表读取失败：' + (error && error.message ? error.message : String(error));
        }
      }
      syncConfigCenterRuntimeAuthMode(runtimeId);
    }

    async function openConfigCenterRuntimeLogin(runtimeId) {
      var prefix = getConfigCenterRuntimePrefix(runtimeId);
      var provider = getConfigCenterRuntimeProviderValue(runtimeId);
      var authStatus = document.getElementById(prefix + 'AuthStatus');
      if (!provider) {
        if (authStatus) {
          authStatus.setAttribute('data-state', 'error');
          authStatus.textContent = '请先选择模型厂商。';
        }
        return;
      }
      if (authStatus) {
        authStatus.setAttribute('data-state', 'loading');
        authStatus.textContent = '正在打开登录终端...';
      }
      try {
        var response = await fetch('/api/chat-bridge/agent-runtimes/' + runtimeId + '/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: provider,
            command: (document.getElementById(prefix + 'Command')?.value || '').trim()
          })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '登录终端启动失败');
        if (authStatus) {
          authStatus.setAttribute('data-state', data.launched ? 'success' : 'idle');
          authStatus.textContent = data.instruction || data.command || '请在终端完成登录。';
        }
      } catch (error) {
        if (authStatus) {
          authStatus.setAttribute('data-state', 'error');
          authStatus.textContent = error && error.message ? error.message : String(error);
        }
      }
    }
    window.openConfigCenterRuntimeLogin = openConfigCenterRuntimeLogin;

    function getConfigCenterRuntimeModelValue(runtimeId) {
      var prefix = getConfigCenterRuntimePrefix(runtimeId);
      var custom = (document.getElementById(prefix + 'CustomModel')?.value || '').trim();
      return custom || (document.getElementById(prefix + 'Model')?.value || '').trim();
    }

    function syncConfigCenterRuntimeEfforts(runtimeId) {
      var prefix = getConfigCenterRuntimePrefix(runtimeId);
      var effortSelect = document.getElementById(prefix + 'Effort');
      if (!effortSelect) return;
      var selectedModel = getConfigCenterRuntimeModelValue(runtimeId);
      var model = (configCenterRuntimeModelsById[runtimeId] || []).find(function(item) {
        return String(item.slug || item.id || '') === selectedModel;
      });
      var fallback = runtimeId === 'pi'
        ? ['off','minimal','low','medium','high','xhigh','max']
        : ['low','medium','high','xhigh'];
      var levels = model && Array.isArray(model.supportedReasoningLevels) && model.supportedReasoningLevels.length
        ? model.supportedReasoningLevels.map(function(level) { return String(level.effort || level); }).filter(Boolean)
        : fallback;
      var configured = effortSelect.getAttribute('data-selected') || effortSelect.value || model?.defaultReasoningLevel || 'medium';
      if (!levels.includes(configured)) {
        configured = levels.includes(String(model?.defaultReasoningLevel || ''))
          ? String(model.defaultReasoningLevel)
          : (levels.includes('medium') ? 'medium' : levels[0]);
      }
      effortSelect.innerHTML = levels.map(function(effort) {
        return '<option value="' + escapeHtml(effort) + '"' + (effort === configured ? ' selected' : '') + '>' + escapeHtml(effort) + '</option>';
      }).join('');
      effortSelect.value = configured;
      effortSelect.setAttribute('data-selected', configured);
    }

    function handleConfigCenterRuntimeModelChange(runtimeId) {
      var prefix = getConfigCenterRuntimePrefix(runtimeId);
      var select = document.getElementById(prefix + 'Model');
      var custom = document.getElementById(prefix + 'CustomModel');
      if (select) select.setAttribute('data-selected', select.value || '');
      if (select?.value && custom) custom.value = '';
      syncConfigCenterRuntimeEfforts(runtimeId);
    }
    window.handleConfigCenterRuntimeModelChange = handleConfigCenterRuntimeModelChange;

    function handleConfigCenterRuntimeCustomModelInput(runtimeId) {
      var prefix = getConfigCenterRuntimePrefix(runtimeId);
      var select = document.getElementById(prefix + 'Model');
      var custom = document.getElementById(prefix + 'CustomModel');
      if (select && String(custom?.value || '').trim()) select.value = '';
      syncConfigCenterRuntimeEfforts(runtimeId);
    }
    window.handleConfigCenterRuntimeCustomModelInput = handleConfigCenterRuntimeCustomModelInput;

    function renderConfigCenterRuntimeModels(runtimeId, models) {
      var prefix = getConfigCenterRuntimePrefix(runtimeId);
      var select = document.getElementById(prefix + 'Model');
      var source = document.getElementById(prefix + 'ModelSource');
      if (!select) return;
      var selectedModel = getConfigCenterRuntimeModelValue(runtimeId)
        || select.getAttribute('data-selected')
        || String((chatBridgeConfig.agentRuntimes?.[runtimeId] || {}).model || '');
      var groups = {};
      models.forEach(function(model) {
        var slug = String(model.slug || model.id || model || '').trim();
        if (!slug) return;
        var provider = String(model.provider || (slug.includes('/') ? slug.split('/')[0] : '其他'));
        if (!groups[provider]) groups[provider] = [];
        groups[provider].push({ slug: slug, displayName: String(model.displayName || slug) });
      });
      var known = models.some(function(model) { return String(model.slug || model.id || model || '') === selectedModel; });
      var html = '<option value="">运行时默认</option>';
      if (selectedModel && !known) {
        html += '<option value="' + escapeHtml(selectedModel) + '">当前配置 · ' + escapeHtml(selectedModel) + '</option>';
      }
      Object.keys(groups).sort().forEach(function(provider) {
        html += '<optgroup label="' + escapeHtml(provider) + '">' + groups[provider].map(function(model) {
          return '<option value="' + escapeHtml(model.slug) + '">' + escapeHtml(model.displayName) + '</option>';
        }).join('') + '</optgroup>';
      });
      select.innerHTML = html;
      select.value = selectedModel;
      select.setAttribute('data-selected', selectedModel);
      if (source) {
        var providerCount = Object.keys(groups).length;
        source.textContent = models.length
          ? ('已发现 ' + models.length + ' 个模型，来自 ' + providerCount + ' 个提供商。手动模型 ID 仍可作为兜底。')
          : '运行时没有返回模型。请先完成模型提供商登录，或填写手动模型 ID。';
      }
      syncConfigCenterRuntimeEfforts(runtimeId);
    }
    window.renderConfigCenterRuntimeModels = renderConfigCenterRuntimeModels;

    async function refreshConfigCenterRuntimeStatus(runtimeId) {
      var prefix = getConfigCenterRuntimePrefix(runtimeId);
      var status = document.getElementById(prefix + 'Status');
      var command = (document.getElementById(prefix + 'Command')?.value || '').trim();
      if (status) {
        status.textContent = '正在检测 CLI...';
        status.setAttribute('data-state', 'loading');
      }
      try {
        var response = await fetch('/api/chat-bridge/agent-runtimes/' + runtimeId + '/status' + (command ? '?command=' + encodeURIComponent(command) : ''));
        var data = await response.json();
        if (status) {
          status.setAttribute('data-state', data.available ? 'success' : 'missing');
          status.innerHTML = data.available
            ? ('已检测到 ' + escapeHtml(data.version || runtimeId) + '<br><span>' + escapeHtml(data.path || 'PATH') + '</span>')
            : ('未检测到 ' + escapeHtml(runtimeId) + ' CLI。可以一键部署，也可以手动填写路径。');
        }
        setConfigCenterRuntimeInstallVisibility(runtimeId, !data.available);
        var modelButton = document.getElementById(prefix + 'RefreshModelsButton');
        if (modelButton) modelButton.disabled = !data.available;
        return data;
      } catch (error) {
        if (status) {
          status.setAttribute('data-state', 'error');
          status.textContent = '检测失败：' + (error && error.message ? error.message : String(error));
        }
        setConfigCenterRuntimeInstallVisibility(runtimeId, true);
        return { available: false };
      }
    }
    window.refreshConfigCenterRuntimeStatus = refreshConfigCenterRuntimeStatus;

    async function loadConfigCenterRuntimeModels(runtimeId) {
      var prefix = getConfigCenterRuntimePrefix(runtimeId);
      var status = document.getElementById(prefix + 'Status');
      var authStatus = document.getElementById(prefix + 'AuthStatus');
      var command = (document.getElementById(prefix + 'Command')?.value || '').trim();
      var provider = getConfigCenterRuntimeProviderValue(runtimeId);
      var authMode = document.getElementById(prefix + 'AuthMode')?.value || 'cli_login';
      var apiKey = (document.getElementById(prefix + 'ApiKey')?.value || '').trim();
      var savedAuth = (chatBridgeConfig.agentRuntimes?.[runtimeId] || {}).provider_auth || {};
      var hasMatchingSavedApiKey = !!savedAuth.has_api_key && String(savedAuth.provider || '') === provider;
      if (!provider) {
        if (authStatus) {
          authStatus.setAttribute('data-state', 'error');
          authStatus.textContent = '请先选择模型厂商。';
        }
        return [];
      }
      if (authMode === 'api_key' && !apiKey && !hasMatchingSavedApiKey) {
        if (authStatus) {
          authStatus.setAttribute('data-state', 'error');
          authStatus.textContent = '请输入 API Key，或切换为 CLI 登录。';
        }
        return [];
      }
      if (status) {
        status.textContent = '正在读取模型...';
        status.setAttribute('data-state', 'loading');
      }
      if (authStatus) {
        authStatus.textContent = '正在验证认证并读取厂商模型...';
        authStatus.setAttribute('data-state', 'loading');
      }
      try {
        var response = await fetch('/api/chat-bridge/agent-runtimes/' + runtimeId + '/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: command, provider: provider, auth_mode: authMode, api_key: apiKey })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '运行时模型读取失败');
        var models = data.success && Array.isArray(data.models) ? data.models : [];
        configCenterRuntimeModelsById[runtimeId] = models;
        renderConfigCenterRuntimeModels(runtimeId, models);
        if (status) {
          status.textContent = models.length ? ('模型列表已更新，共 ' + models.length + ' 个。') : 'CLI 可用，但还没有模型。请先完成提供商登录。';
          status.setAttribute('data-state', models.length ? 'success' : 'idle');
        }
        if (authStatus) {
          authStatus.textContent = models.length
            ? ('认证可用，已读取 ' + models.length + ' 个 ' + provider + ' 模型。')
            : ('未读取到 ' + provider + ' 模型，请检查认证后重试。');
          authStatus.setAttribute('data-state', models.length ? 'success' : 'error');
        }
        return models;
      } catch (error) {
        if (status) {
          status.textContent = '模型读取失败：' + (error && error.message ? error.message : String(error));
          status.setAttribute('data-state', 'error');
        }
        if (authStatus) {
          authStatus.textContent = '认证或模型读取失败：' + (error && error.message ? error.message : String(error));
          authStatus.setAttribute('data-state', 'error');
        }
        return [];
      }
    }
    window.loadConfigCenterRuntimeModels = loadConfigCenterRuntimeModels;

    async function installConfigCenterRuntime(runtimeId) {
      var installer = CONFIG_CENTER_RUNTIME_INSTALLERS[runtimeId];
      if (!installer) return;
      var accepted = window.confirm('将通过 npm 全局安装官方 ' + installer.label + ' CLI（' + installer.packageName + '）。安装可能需要数分钟，是否继续？');
      if (!accepted) return;
      var prefix = runtimeId === 'codex' ? 'configCenterCodex' : getConfigCenterRuntimePrefix(runtimeId);
      var button = document.getElementById(prefix + 'InstallButton');
      var status = document.getElementById(prefix + 'Status');
      if (button) {
        button.disabled = true;
        button.textContent = '部署中...';
      }
      if (status) {
        status.textContent = '正在检查 npm 并部署 ' + installer.label + ' CLI，请勿关闭应用...';
        status.setAttribute('data-state', 'loading');
      }
      try {
        var response = await fetch('/api/chat-bridge/agent-runtimes/' + runtimeId + '/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmed: true })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.installation?.message || data.error || 'CLI 部署失败');
        var commandInput = document.getElementById(runtimeId === 'codex' ? 'configCenterCodexCommand' : prefix + 'Command');
        if (commandInput && data.installation?.commandPath) commandInput.value = data.installation.commandPath;
        if (status) {
          status.setAttribute('data-state', 'success');
          status.textContent = data.installation.message + ' ' + data.installation.authenticationHint;
        }
        await saveConfigCenterAgentRuntimes();
        if (runtimeId === 'codex') {
          await refreshConfigCenterCodexStatus();
          await loadConfigCenterCodexModels(true);
        } else {
          await refreshConfigCenterRuntimeStatus(runtimeId);
          await loadConfigCenterRuntimeModels(runtimeId);
        }
      } catch (error) {
        if (status) {
          status.setAttribute('data-state', 'error');
          status.textContent = error && error.message ? error.message : String(error);
        }
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = '一键部署 CLI';
        }
      }
    }
    window.installConfigCenterRuntime = installConfigCenterRuntime;

    async function saveConfigCenterAgentRuntimes() {
      function collect(runtimeId) {
        var prefix = getConfigCenterRuntimePrefix(runtimeId);
        return {
          enabled: !!document.getElementById(prefix + 'Enabled')?.checked,
          command: (document.getElementById(prefix + 'Command')?.value || '').trim(),
          model: getConfigCenterRuntimeModelValue(runtimeId),
          reasoning_effort: document.getElementById(prefix + 'Effort')?.value || 'medium',
          sandbox: document.getElementById(prefix + 'Sandbox')?.value || 'workspace-write',
          timeout_ms: Number(document.getElementById(prefix + 'Timeout')?.value || 1800000),
          fallback_to_secondary: true,
          provider_auth: {
            mode: document.getElementById(prefix + 'AuthMode')?.value || 'cli_login',
            provider: getConfigCenterRuntimeProviderValue(runtimeId),
            api_key: (document.getElementById(prefix + 'ApiKey')?.value || '').trim()
          }
        };
      }
      var payload = {
        default: document.getElementById('configCenterRuntimeDefault')?.value || '',
        codex: {},
        pi: collect('pi'),
        opencode: Object.assign(collect('opencode'), { auto_approve: true })
      };
      if (payload.default === 'pi') payload.pi.enabled = true;
      if (payload.default === 'opencode') payload.opencode.enabled = true;
      var codexModel = document.querySelector('input[name="configCenterCodexModel"]:checked')?.value || chatBridgeConfig.codex?.model || 'gpt-5.5';
      var codexEffort = document.querySelector('input[name="configCenterCodexEffort"]:checked')?.value || chatBridgeConfig.codex?.reasoning_effort || 'xhigh';
      var codexEnabled = !!document.getElementById('configCenterCodexCliPrefer')?.checked || payload.default === 'codex';
      var codexConcurrency = Math.max(1, Math.min(6, parseInt(document.getElementById('configCenterCodexConcurrency')?.value || 1, 10) || 1));
      var codex = Object.assign({}, chatBridgeConfig.codex || {}, {
        enabled: codexEnabled,
        prefer: payload.default === 'codex',
        command: (document.getElementById('configCenterCodexCommand')?.value || '').trim(),
        model: codexModel,
        reasoning_effort: codexEffort,
        sandbox: chatBridgeConfig.codex?.sandbox || 'workspace-write',
        pdf_wiki_sandbox: chatBridgeConfig.codex?.pdf_wiki_sandbox || 'danger-full-access',
        timeout_ms: Number(chatBridgeConfig.codex?.timeout_ms || 300000),
        pdf_wiki_concurrency: codexConcurrency
      });
      payload.codex = {
        enabled: codex.enabled,
        prefer: codex.prefer,
        command: codex.command,
        model: codex.model,
        reasoning_effort: codex.reasoning_effort,
        sandbox: codex.sandbox,
        timeout_ms: codex.timeout_ms,
        fallback_to_secondary: true
      };
      var response = await fetch('/api/chat-bridge/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'api', codex: codex, agent_runtimes: payload }) });
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Agent Runtime 配置保存失败');
      chatBridgeConfig.agentRuntimes = data.config?.agent_runtimes || payload;
      chatBridgeConfig.codex = codex;
      try { localStorage.setItem(CHAT_BRIDGE_KEY, JSON.stringify(chatBridgeConfig)); } catch (e) {}
      updateModelBadge();
      renderComposerProviderSelector();
      await Promise.all([refreshConfigCenterCodexStatus(), refreshConfigCenterRuntimeStatus('pi'), refreshConfigCenterRuntimeStatus('opencode')]);
    }
    window.saveConfigCenterAgentRuntimes = saveConfigCenterAgentRuntimes;

    window.showConfigCenterDialog = async function() {
      await loadChatBridgeConfig();
      var currentCodexModel = chatBridgeConfig.codex?.model || 'gpt-5.5';
      var currentCodexEffort = chatBridgeConfig.codex?.reasoning_effort || 'xhigh';
      configCenterCodexEffortByModel = loadConfigCenterCodexEffortByModel();
      rememberConfigCenterCodexEffort(currentCodexModel, currentCodexEffort);
      var currentCodexConcurrency = Math.max(1, Math.min(6, parseInt(chatBridgeConfig.codex?.pdf_wiki_concurrency || chatBridgeConfig.codex?.concurrency || 1, 10) || 1));
      var html = '' +
        '<div style="margin-top:6px;font-size:15px;font-weight:650;color:var(--text-primary);">配置项</div>' +
        '<div class="config-center-grid">' +
          configCenterButton('AI 配置与使用向导', '让 Little corse 检测环境、配置能力并讲解文献导入', 'settings', 'startAiConfigurationAssistant(\'all\')') +
          configCenterAgentRuntimeHtml(currentCodexModel, currentCodexEffort, currentCodexConcurrency) +
          configCenterButton('Little corse', '写作执行', 'messageCircle', 'showConnectDialog()') +
          configCenterButton('Grass', 'OpenRouter 免费模型', 'settings', 'showChatBridgeDialog()') +
          configCenterButton('Embedding', '语义检索', 'network', 'showEmbeddingDialog()') +
          configCenterButton('PDF Wiki/Marker', 'PDF 解析', 'bookOpen', 'showPdfWikiLlmDialog()') +
          configCenterButton('本地插件', 'R / Python / OfficeCLI 全局运行时', 'wrench', 'showRuntimePluginConfigDialog()') +
          configCenterButton('联网搜索配置', 'Tavily / Exa', 'globe', 'showWebSearchDialog()') +
        '</div>';
      showHomeUtilityPage('config', '配置中心', '管理模型、检索、解析和本地运行环境', html);
      setTimeout(refreshConfigCenterCodexStatus, 0);
      setTimeout(loadConfigCenterCodexModels, 0);
      setTimeout(async function() {
        await Promise.all([
          loadConfigCenterRuntimeProviders('pi'),
          loadConfigCenterRuntimeProviders('opencode')
        ]);
        var statuses = await Promise.all([
          refreshConfigCenterRuntimeStatus('pi'),
          refreshConfigCenterRuntimeStatus('opencode')
        ]);
        if (statuses[0]?.available) loadConfigCenterRuntimeModels('pi');
        if (statuses[1]?.available) loadConfigCenterRuntimeModels('opencode');
      }, 0);
    };

    async function refreshConfigCenterCodexStatus() {
      var statusDiv = document.getElementById('configCenterCodexStatus');
      if (!statusDiv) return;
      statusDiv.textContent = '正在自动检测 Codex CLI...';
      statusDiv.setAttribute('data-state', 'loading');
      try {
        var command = (document.getElementById('configCenterCodexCommand')?.value || '').trim();
        var response = await fetch('/api/chat-bridge/codex/status' + (command ? '?command=' + encodeURIComponent(command) : ''));
        var data = await response.json();
        if (data.success && data.available) {
          statusDiv.innerHTML = '已检测到 Codex CLI：<strong>' + escapeHtml(data.version || 'codex') + '</strong><br><span style="word-break:break-all;">' + escapeHtml(data.path || 'PATH') + '</span>';
          statusDiv.setAttribute('data-state', 'success');
          setConfigCenterRuntimeInstallVisibility('codex', false);
        } else {
          statusDiv.innerHTML = '未检测到 Codex CLI。可以一键部署，也可以手动填写路径；不可用时仍会自动降级 Little corse。';
          statusDiv.setAttribute('data-state', 'missing');
          setConfigCenterRuntimeInstallVisibility('codex', true);
        }
      } catch (e) {
        statusDiv.innerHTML = 'Codex CLI 检测失败。可以重试检测或一键部署；不可用时仍会自动降级 Little corse。';
        statusDiv.setAttribute('data-state', 'error');
        setConfigCenterRuntimeInstallVisibility('codex', true);
      }
    }
    window.refreshConfigCenterCodexStatus = refreshConfigCenterCodexStatus;

    function renderConfigCenterCodexModels(models) {
      var list = document.getElementById('configCenterCodexModelList');
      if (!list) return;
      var selectedModel = list.getAttribute('data-selected') || chatBridgeConfig.codex?.model || 'gpt-5.5';
      list.innerHTML = models.map(function(model, index) {
        var slug = model.slug || model.id || '';
        var checked = slug === selectedModel || (!selectedModel && index === 0);
        return '' +
          '<label style="display:flex;gap:8px;align-items:flex-start;padding:9px;border:1px solid var(--border-color);border-radius:7px;background:var(--modal-bg);cursor:pointer;">' +
            '<input type="radio" name="configCenterCodexModel" value="' + escapeHtml(slug) + '"' + (checked ? ' checked' : '') + ' onchange="handleConfigCenterCodexModelChange(this.value)" style="width:15px;height:15px;margin-top:2px;accent-color:var(--accent-color);">' +
            '<span style="min-width:0;">' +
              '<span style="display:block;font-size:12px;font-weight:700;color:var(--text-primary);">' + escapeHtml(model.displayName || slug) + (checked ? ' <span style="font-size:10px;color:var(--accent-color);">current</span>' : '') + (model.unlisted ? ' <span style="font-size:10px;color:var(--text-secondary);">未列出</span>' : '') + '</span>' +
              '<span style="display:block;margin-top:2px;font-size:10.5px;line-height:1.45;color:var(--text-secondary);">' + escapeHtml(model.description || '') + '</span>' +
            '</span>' +
          '</label>';
      }).join('');
    }

    function handleConfigCenterCodexModelChange(model) {
      var modelList = document.getElementById('configCenterCodexModelList');
      var effortList = document.getElementById('configCenterCodexEffortList');
      if (modelList) modelList.setAttribute('data-selected', String(model || ''));
      if (effortList) effortList.removeAttribute('data-selected');
      renderConfigCenterCodexEfforts();
    }
    window.handleConfigCenterCodexModelChange = handleConfigCenterCodexModelChange;

    function handleConfigCenterCodexEffortChange(model, effort) {
      model = model || document.querySelector('input[name="configCenterCodexModel"]:checked')?.value || '';
      var list = document.getElementById('configCenterCodexEffortList');
      if (list) list.setAttribute('data-selected', String(effort || ''));
      rememberConfigCenterCodexEffort(model, effort);
    }
    window.handleConfigCenterCodexEffortChange = handleConfigCenterCodexEffortChange;

    function renderConfigCenterCodexEfforts() {
      var list = document.getElementById('configCenterCodexEffortList');
      if (!list) return;
      var selectedModel = document.querySelector('input[name="configCenterCodexModel"]:checked')?.value || chatBridgeConfig.codex?.model || 'gpt-5.5';
      var model = configCenterCodexModels.find(function(item) { return item.slug === selectedModel; }) || configCenterCodexModels[0] || {};
      var levels = Array.isArray(model.supportedReasoningLevels) && model.supportedReasoningLevels.length
        ? model.supportedReasoningLevels
        : [
          { effort: 'low', description: 'Fast responses with lighter reasoning' },
          { effort: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
          { effort: 'high', description: 'Greater reasoning depth for complex problems' },
          { effort: 'xhigh', description: 'Extra high reasoning depth for complex problems' }
        ];
      var modelDefault = model.defaultReasoningLevel || 'medium';
      var selectedEffort = configCenterCodexEffortByModel[selectedModel]
        || (selectedModel === (chatBridgeConfig.codex?.model || 'gpt-5.5') ? chatBridgeConfig.codex?.reasoning_effort : '')
        || modelDefault;
      if (!levels.some(function(level) { return level.effort === selectedEffort; })) {
        selectedEffort = levels.some(function(level) { return level.effort === modelDefault; })
          ? modelDefault
          : levels[0].effort;
      }
      rememberConfigCenterCodexEffort(selectedModel, selectedEffort);
      list.setAttribute('data-selected', selectedEffort);
      list.innerHTML = levels.map(function(level) {
        var checked = level.effort === selectedEffort;
        var recommended = level.effort === modelDefault;
        return '' +
          '<label style="display:flex;gap:7px;align-items:flex-start;padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--modal-bg);cursor:pointer;">' +
            '<input type="radio" name="configCenterCodexEffort" value="' + escapeHtml(level.effort) + '"' + (checked ? ' checked' : '') + ' onchange="handleConfigCenterCodexEffortChange(null, this.value)" style="width:15px;height:15px;margin-top:1px;accent-color:var(--accent-color);">' +
            '<span style="min-width:0;">' +
              '<span style="display:block;font-size:12px;font-weight:700;color:var(--text-primary);">' + escapeHtml(level.effort) + (recommended ? ' <span style="font-size:10px;font-weight:500;color:var(--text-secondary);">推荐</span>' : '') + '</span>' +
              '<span style="display:block;margin-top:2px;font-size:10.5px;line-height:1.45;color:var(--text-secondary);">' + escapeHtml(level.description || '') + '</span>' +
            '</span>' +
          '</label>';
      }).join('');
      var hint = document.getElementById('configCenterCodexEffortHint');
      if (hint) hint.textContent = '当前模型支持：' + levels.map(function(level) { return level.effort; }).join(' / ') + '；切换模型时会恢复该模型上次选择，首次使用采用推荐档位。';
    }
    window.renderConfigCenterCodexEfforts = renderConfigCenterCodexEfforts;

    async function loadConfigCenterCodexModels(forceRefresh) {
      var list = document.getElementById('configCenterCodexModelList');
      if (!list) return;
      var source = document.getElementById('configCenterCodexModelSource');
      if (forceRefresh) {
        list.innerHTML = '<div style="font-size:11px;color:var(--text-secondary);">正在重新读取 Codex 模型缓存...</div>';
      }
      try {
        var response = await fetch('/api/chat-bridge/codex/models?_=' + Date.now(), { cache: 'no-store' });
        var data = await response.json();
        configCenterCodexModels = (data.success && Array.isArray(data.models) && data.models.length) ? data.models : [];
        configCenterCodexModelsMeta = data && data.success ? data : {};
      } catch (e) {
        configCenterCodexModels = [];
        configCenterCodexModelsMeta = { source: 'error', error: e && e.message ? e.message : String(e) };
      }
      if (!configCenterCodexModels.length) {
        configCenterCodexModels = [
          { slug: 'gpt-5.5', displayName: 'GPT-5.5', description: 'Frontier model for complex coding, research, and real-world work.' },
          { slug: 'gpt-5.4', displayName: 'GPT-5.4', description: 'Strong model for everyday coding.' },
          { slug: 'gpt-5.4-mini', displayName: 'GPT-5.4-Mini', description: 'Small, fast, and cost-efficient model for simpler coding tasks.' },
          { slug: 'gpt-5.3-codex', displayName: 'GPT-5.3-Codex', description: 'Coding-optimized model.' },
          { slug: 'gpt-5.3-codex-spark', displayName: 'GPT-5.3-Codex-Spark', description: 'Ultra-fast coding model.' },
          { slug: 'gpt-5.2', displayName: 'GPT-5.2', description: 'Optimized for professional work and long-running agents.' }
        ];
      }
      var selectedModel = list.getAttribute('data-selected') || chatBridgeConfig.codex?.model || 'gpt-5.5';
      if (selectedModel && !configCenterCodexModels.some(function(model) { return model.slug === selectedModel; })) {
        configCenterCodexModels.unshift({
          slug: selectedModel,
          displayName: selectedModel,
          description: '当前已保存配置；本机 Codex 模型缓存暂未返回该模型。',
          defaultReasoningLevel: chatBridgeConfig.codex?.reasoning_effort || 'medium',
          supportedReasoningLevels: [
            { effort: 'low', description: 'Fast responses with lighter reasoning' },
            { effort: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
            { effort: 'high', description: 'Greater reasoning depth for complex problems' },
            { effort: 'xhigh', description: 'Extra high reasoning depth for complex problems' }
          ],
          unlisted: true
        });
      }
      renderConfigCenterCodexModels(configCenterCodexModels);
      renderConfigCenterCodexEfforts();
      if (source) {
        var sourceLabel = configCenterCodexModelsMeta.source === 'cache+local'
          ? 'Codex 模型缓存 + 本机配置/真实会话'
          : (configCenterCodexModelsMeta.source === 'local'
            ? '本机 Codex 配置/真实会话'
            : (configCenterCodexModelsMeta.source === 'cache' ? 'Codex 本地模型缓存' : (configCenterCodexModelsMeta.source === 'fallback' ? '软件回退列表' : '模型列表读取失败')));
        var fetchedAt = configCenterCodexModelsMeta.fetchedAt ? new Date(configCenterCodexModelsMeta.fetchedAt).toLocaleString('zh-CN') : '';
        var clientVersion = configCenterCodexModelsMeta.clientVersion ? ' · 缓存客户端 ' + configCenterCodexModelsMeta.clientVersion : '';
        source.textContent = '来源：' + sourceLabel + (fetchedAt ? ' · 更新于 ' + fetchedAt : '') + clientVersion + '。缓存未返回的模型不会自动标记为可用。';
      }
    }
    window.loadConfigCenterCodexModels = loadConfigCenterCodexModels;

    function renderConfigCenterMetaTemplateStatus(data) {
      var statusDiv = document.getElementById('configCenterMetaTemplateStatus');
      if (!statusDiv) return;
      if (!data || !data.configured) {
        statusDiv.innerHTML = '未配置模板；PDF Wiki 会使用系统默认 Meta 分析字段。';
        return;
      }
      var columns = Array.isArray(data.columns) ? data.columns : [];
      var preview = columns.slice(0, 16).map(function(column) {
        return '<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 6px;border:1px solid var(--border-color);border-radius:999px;color:var(--text-secondary);">' + escapeHtml(column) + '</span>';
      }).join('');
      statusDiv.innerHTML = '' +
        '当前模板：<strong>' + escapeHtml(data.filename || 'meta-template') + '</strong>，共 ' + columns.length + ' 个字段。后续上传或重建 PDF Wiki 时按该结构抽取。' +
        (preview ? '<div style="margin-top:5px;">' + preview + (columns.length > 16 ? '<span style="color:var(--text-secondary);">...</span>' : '') + '</div>' : '');
    }

    async function loadConfigCenterMetaTemplateStatus() {
      var statusDiv = document.getElementById('configCenterMetaTemplateStatus');
      if (!statusDiv) return;
      statusDiv.textContent = '正在读取 Meta分析模板...';
      try {
        var response = await fetch('/api/pdf-wiki/meta-template?userId=web-user');
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '读取模板失败');
        renderConfigCenterMetaTemplateStatus(data);
      } catch (e) {
        statusDiv.textContent = 'Meta分析模板读取失败：' + e.message;
      }
    }
    window.loadConfigCenterMetaTemplateStatus = loadConfigCenterMetaTemplateStatus;

    async function uploadConfigCenterMetaTemplate(file) {
      var statusDiv = document.getElementById('configCenterMetaTemplateStatus');
      var input = document.getElementById('configCenterMetaTemplateInput');
      if (!file) return;
      if (statusDiv) statusDiv.textContent = '正在上传并解析 Meta分析模板...';
      try {
        var formData = new FormData();
        formData.append('file', file);
        formData.append('userId', 'web-user');
        var response = await fetch('/api/pdf-wiki/meta-template', {
          method: 'POST',
          body: formData
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '保存模板失败');
        renderConfigCenterMetaTemplateStatus(data);
      } catch (e) {
        if (statusDiv) statusDiv.textContent = '模板保存失败：' + e.message;
      } finally {
        if (input) input.value = '';
      }
    }
    window.uploadConfigCenterMetaTemplate = uploadConfigCenterMetaTemplate;

    async function clearConfigCenterMetaTemplate() {
      var statusDiv = document.getElementById('configCenterMetaTemplateStatus');
      if (statusDiv) statusDiv.textContent = '正在清除 Meta分析模板...';
      try {
        var response = await fetch('/api/pdf-wiki/meta-template?userId=web-user', { method: 'DELETE' });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '清除模板失败');
        renderConfigCenterMetaTemplateStatus(data);
      } catch (e) {
        if (statusDiv) statusDiv.textContent = '模板清除失败：' + e.message;
      }
    }
    window.clearConfigCenterMetaTemplate = clearConfigCenterMetaTemplate;

    function getPdfWikiMetaUserRequirements() {
      try {
        return String(localStorage.getItem(PDF_WIKI_META_REQUIREMENTS_KEY) || '').trim();
      } catch (e) {
        return '';
      }
    }

    function getPdfWikiMetaUserRequirementsForRequest() {
      var input = document.getElementById('pdfWikiMetaUserRequirementsInput');
      var value = input ? String(input.value || '').trim() : getPdfWikiMetaUserRequirements();
      return value.slice(0, 5000);
    }

    window.savePdfWikiMetaUserRequirementsFromInput = function(value) {
      try {
        localStorage.setItem(PDF_WIKI_META_REQUIREMENTS_KEY, String(value || '').trim().slice(0, 5000));
      } catch (e) {}
    };

    function isPdfWikiMetaTemplatePanelCollapsed() {
      try {
        return localStorage.getItem(PDF_WIKI_META_TEMPLATE_COLLAPSED_KEY) === 'true';
      } catch (e) {
        return false;
      }
    }

    window.togglePdfWikiMetaTemplatePanelCollapsed = function() {
      var collapsed = !isPdfWikiMetaTemplatePanelCollapsed();
      try {
        localStorage.setItem(PDF_WIKI_META_TEMPLATE_COLLAPSED_KEY, collapsed ? 'true' : 'false');
      } catch (e) {}
      var body = document.getElementById('pdfWikiMetaTemplatePanelBody');
      if (body) body.style.display = collapsed ? 'none' : 'block';
      var button = document.getElementById('pdfWikiMetaTemplateCollapseBtn');
      if (button) button.textContent = collapsed ? '展开' : '折叠';
      if (!collapsed) setTimeout(loadPdfWikiMetaTemplateStatus, 0);
    };

    function renderPdfWikiMetaTemplateStatus(data) {
      var statusDiv = document.getElementById('pdfWikiMetaTemplateStatus');
      if (!statusDiv) return;
      if (!data || !data.configured) {
        statusDiv.innerHTML = '未上传表头模板；系统会使用默认 Meta 分析字段。';
        return;
      }
      var columns = Array.isArray(data.columns) ? data.columns : [];
      var preview = columns.slice(0, 14).map(function(column) {
        return '<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 6px;border:1px solid var(--border-color);border-radius:999px;color:var(--text-secondary);max-width:100%;overflow:hidden;text-overflow:ellipsis;vertical-align:middle;">' + escapeHtml(column) + '</span>';
      }).join('');
      statusDiv.innerHTML = '' +
        '当前表头：<strong>' + escapeHtml(data.filename || 'meta-template') + '</strong>，共 ' + columns.length + ' 列；带单位的表头会作为统一单位标准。' +
        (preview ? '<div style="margin-top:5px;max-height:70px;overflow:auto;">' + preview + (columns.length > 14 ? '<span style="color:var(--text-secondary);">...</span>' : '') + '</div>' : '');
    }

    async function loadPdfWikiMetaTemplateStatus(force) {
      var statusDiv = document.getElementById('pdfWikiMetaTemplateStatus');
      if (!statusDiv) return;
      var scopeKey = getPdfWikiMetaCacheScopeKey();
      if (!force && pdfWikiMetaTemplateStatusCacheByScope[scopeKey]) {
        renderPdfWikiMetaTemplateStatus(pdfWikiMetaTemplateStatusCacheByScope[scopeKey]);
        return;
      }
      if (!force && pdfWikiMetaTemplateStatusRequests[scopeKey]) {
        await pdfWikiMetaTemplateStatusRequests[scopeKey];
        if (pdfWikiMetaTemplateStatusCacheByScope[scopeKey]) renderPdfWikiMetaTemplateStatus(pdfWikiMetaTemplateStatusCacheByScope[scopeKey]);
        return;
      }
      statusDiv.textContent = '正在读取 Meta 表头模板...';
      try {
        pdfWikiMetaTemplateStatusRequests[scopeKey] = (async function() {
          var response = await fetch('/api/pdf-wiki/meta-template?userId=' + encodeURIComponent(currentUserId || 'web-user'));
          var data = await response.json();
          if (!response.ok || !data.success) throw new Error(data.error || '读取模板失败');
          pdfWikiMetaTemplateStatusCacheByScope[scopeKey] = data;
          return data;
        })();
        var data = await pdfWikiMetaTemplateStatusRequests[scopeKey];
        renderPdfWikiMetaTemplateStatus(data);
      } catch (e) {
        statusDiv.textContent = 'Meta 表头模板读取失败：' + e.message;
      } finally {
        delete pdfWikiMetaTemplateStatusRequests[scopeKey];
      }
    }
    window.loadPdfWikiMetaTemplateStatus = loadPdfWikiMetaTemplateStatus;

    window.uploadPdfWikiMetaTemplate = async function(file) {
      var statusDiv = document.getElementById('pdfWikiMetaTemplateStatus');
      var input = document.getElementById('pdfWikiMetaTemplateInput');
      if (!file) return;
      if (statusDiv) statusDiv.textContent = '正在上传并解析 Meta 表头模板...';
      try {
        var formData = new FormData();
        formData.append('file', file);
        formData.append('userId', currentUserId || 'web-user');
        var response = await fetch('/api/pdf-wiki/meta-template', {
          method: 'POST',
          body: formData
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '保存模板失败');
        pdfWikiMetaTemplateStatusCacheByScope[getPdfWikiMetaCacheScopeKey()] = data;
        renderPdfWikiMetaTemplateStatus(data);
        if (pdfWikiMetaDatabaseData) renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
      } catch (e) {
        if (statusDiv) statusDiv.textContent = '表头模板保存失败：' + e.message;
      } finally {
        if (input) input.value = '';
      }
    };

    window.clearPdfWikiMetaTemplate = async function() {
      var statusDiv = document.getElementById('pdfWikiMetaTemplateStatus');
      if (statusDiv) statusDiv.textContent = '正在清除 Meta 表头模板...';
      try {
        var response = await fetch('/api/pdf-wiki/meta-template?userId=' + encodeURIComponent(currentUserId || 'web-user'), { method: 'DELETE' });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '清除模板失败');
        pdfWikiMetaTemplateStatusCacheByScope[getPdfWikiMetaCacheScopeKey()] = data;
        renderPdfWikiMetaTemplateStatus(data);
        if (pdfWikiMetaDatabaseData) renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData);
      } catch (e) {
        if (statusDiv) statusDiv.textContent = '表头模板清除失败：' + e.message;
      }
    };

    function renderPdfWikiMetaTemplateControlsPanel(compact) {
      var requirements = getPdfWikiMetaUserRequirements();
      var collapsed = isPdfWikiMetaTemplatePanelCollapsed();
      return '' +
        '<div style="margin-top:' + (compact ? '10px' : '0') + ';margin-bottom:' + (compact ? '9px' : '0') + ';padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);">' +
          '<input id="pdfWikiMetaTemplateInput" type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="uploadPdfWikiMetaTemplate(this.files && this.files[0])">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:' + (collapsed ? '0' : '7px') + ';">' +
            '<div style="font-size:12px;font-weight:800;color:var(--text-primary);">Meta 表头模板</div>' +
            '<div style="display:flex;gap:6px;white-space:nowrap;">' +
              '<button id="pdfWikiMetaTemplateCollapseBtn" type="button" onclick="togglePdfWikiMetaTemplatePanelCollapsed()" style="padding:5px 7px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:11px;">' + (collapsed ? '展开' : '折叠') + '</button>' +
              '<button id="pdfWikiMetaTemplateUploadBtn" type="button" onclick="document.getElementById(\'pdfWikiMetaTemplateInput\')?.click()" style="padding:5px 7px;border:1px solid #111827 !important;border-radius:6px;background:#111827 !important;color:#ffffff !important;cursor:pointer;font-size:11px;">上传表头</button>' +
              '<button type="button" onclick="clearPdfWikiMetaTemplate()" style="padding:5px 7px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:11px;">清除</button>' +
            '</div>' +
          '</div>' +
          '<div id="pdfWikiMetaTemplatePanelBody" style="display:' + (collapsed ? 'none' : 'block') + ';">' +
            '<div style="font-size:10.8px;line-height:1.55;color:var(--text-secondary);margin-bottom:7px;">先上传用户的 Meta 编码表表头；带单位的字段会成为所有 PDF 的统一单位，后续不同单位自动换算，范围值自动取均值。</div>' +
            '<div id="pdfWikiMetaTemplateStatus" style="font-size:10.8px;line-height:1.55;color:var(--text-secondary);">正在读取 Meta 表头模板...</div>' +
            '<label style="display:block;margin-top:8px;font-size:11px;font-weight:700;color:var(--text-primary);">用户要求</label>' +
            '<textarea id="pdfWikiMetaUserRequirementsInput" oninput="savePdfWikiMetaUserRequirementsFromInput(this.value)" placeholder="例如：只提取 N2O 和蔬菜产量；按处理×年份×作物拆行；优先提取表 2 和 Fig. 3；缺失值留空。" style="width:100%;min-height:' + (compact ? '58px' : '78px') + ';margin-top:5px;padding:7px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:11.5px;line-height:1.45;resize:vertical;">' + escapeHtml(requirements) + '</textarea>' +
          '</div>' +
        '</div>';
    }

    async function saveConfigCenterCodexPreference(prefer) {
      if (document.getElementById('configCenterRuntimeDefault')) {
        return saveConfigCenterAgentRuntimes();
      }
      var checkbox = document.getElementById('configCenterCodexCliPrefer');
      var commandInput = document.getElementById('configCenterCodexCommand');
      var concurrencyInput = document.getElementById('configCenterCodexConcurrency');
      var statusDiv = document.getElementById('configCenterCodexStatus');
      var codexCommand = String(commandInput?.value || '').trim();
      var codexModel = document.querySelector('input[name="configCenterCodexModel"]:checked')?.value || chatBridgeConfig.codex?.model || 'gpt-5.5';
      var codexEffort = document.querySelector('input[name="configCenterCodexEffort"]:checked')?.value || chatBridgeConfig.codex?.reasoning_effort || 'xhigh';
      var selectedCodexModel = configCenterCodexModels.find(function(item) { return item.slug === codexModel; }) || null;
      var supportedCodexEfforts = selectedCodexModel && Array.isArray(selectedCodexModel.supportedReasoningLevels)
        ? selectedCodexModel.supportedReasoningLevels.map(function(level) { return level.effort; })
        : ['low', 'medium', 'high', 'xhigh'];
      if (supportedCodexEfforts.indexOf(codexEffort) === -1) {
        codexEffort = selectedCodexModel?.defaultReasoningLevel || supportedCodexEfforts[0] || 'medium';
      }
      rememberConfigCenterCodexEffort(codexModel, codexEffort);
      var codexConcurrency = Math.max(1, Math.min(6, parseInt(concurrencyInput?.value || chatBridgeConfig.codex?.pdf_wiki_concurrency || chatBridgeConfig.codex?.concurrency || 1, 10) || 1));
      if (checkbox) checkbox.disabled = true;
      if (commandInput) commandInput.disabled = true;
      if (concurrencyInput) concurrencyInput.disabled = true;
      if (statusDiv) statusDiv.textContent = '正在保存 Codex 设置...';
      try {
        var response = await fetch('/api/chat-bridge/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            codex: {
              enabled: !!prefer,
              prefer: !!prefer,
              command: codexCommand,
              model: codexModel,
              reasoning_effort: codexEffort,
              sandbox: 'workspace-write',
              pdf_wiki_sandbox: 'danger-full-access',
              timeout_ms: 300000,
              pdf_wiki_concurrency: codexConcurrency
            }
          })
        });
        var result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '保存 Codex 设置失败');
        chatBridgeConfig.codex = {
          enabled: !!prefer,
          prefer: !!prefer,
          command: codexCommand,
          model: codexModel,
          reasoning_effort: codexEffort,
          sandbox: 'workspace-write',
          pdf_wiki_sandbox: 'danger-full-access',
          timeout_ms: 300000,
          pdf_wiki_concurrency: codexConcurrency
        };
        localStorage.setItem(CHAT_BRIDGE_KEY, JSON.stringify(chatBridgeConfig));
        updateModelBadge();
        if (statusDiv) statusDiv.textContent = prefer ? 'Codex CLI 已设为默认优先：' + codexModel + ' / ' + codexEffort + '；PDF Wiki 多开 ' + codexConcurrency + '，失败会自动降级 Little corse。' : 'Codex CLI 默认优先已关闭；模型和 PDF Wiki 多开设置已保存。';
        setTimeout(refreshConfigCenterCodexStatus, 500);
      } catch (e) {
        if (checkbox) checkbox.checked = !prefer;
        if (statusDiv) statusDiv.textContent = '保存失败：' + e.message;
      } finally {
        if (checkbox) checkbox.disabled = false;
        if (commandInput) commandInput.disabled = false;
        if (concurrencyInput) concurrencyInput.disabled = false;
      }
    }
    window.saveConfigCenterCodexPreference = saveConfigCenterCodexPreference;
    
    /**
     * 显示草稿确认弹窗（检测到重复时）
     * @param result - 后端返回的确认请求信息
     * @param originalContent - 用户要保存的原始内容
     */

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('skill-config', { source: '/app/skill-config.js' });
}
