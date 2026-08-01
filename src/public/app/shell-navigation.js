    // ========== 用户信息侧边栏显示 ==========

    var activeHomeUtilityPage = '';
    var homeUtilityReturnContext = null;

    function captureHomeUtilityReturnContext() {
      var overlay = document.getElementById('modalOverlay');
      var title = document.getElementById('modalTitle');
      var isMetaAnalysisWizard = !!(
        overlay
        && overlay.classList.contains('show')
        && overlay.classList.contains('meta-analysis-shared-composer-overlay')
        && title
        && title.textContent === 'AI Meta 分析工作区'
      );
      if (!isMetaAnalysisWizard || !pdfWikiMetaAnalysisInspectData || !pdfWikiMetaAnalysisTargetPdfIds.length) return null;
      if (typeof snapshotPdfWikiMetaAnalysisWizardState === 'function') {
        snapshotPdfWikiMetaAnalysisWizardState();
      }
      var input = document.getElementById('metaAiUserRequest');
      var runResult = document.getElementById('metaAnalysisRunResult');
      var rResult = document.getElementById('metaAnalysisRResult');
      var modalContent = document.getElementById('modalContent');
      return {
        type: 'meta-analysis-wizard',
        pdfIds: pdfWikiMetaAnalysisTargetPdfIds.slice(),
        inputDraft: input ? String(input.value || '') : '',
        runResultText: runResult ? String(runResult.textContent || '') : '',
        runResultDisplay: runResult ? runResult.style.display : '',
        rResultHtml: rResult ? String(rResult.innerHTML || '') : '',
        rResultDisplay: rResult ? rResult.style.display : '',
        scrollTop: modalContent ? Number(modalContent.scrollTop || 0) : 0
      };
    }

    function restoreHomeUtilityReturnContext(context) {
      if (!context || context.type !== 'meta-analysis-wizard') return false;
      if (!pdfWikiMetaAnalysisInspectData || !Array.isArray(context.pdfIds) || !context.pdfIds.length) return false;
      pdfWikiMetaAnalysisTargetPdfIds = context.pdfIds.slice();
      renderPdfWikiMetaAnalysisWizard(pdfWikiMetaAnalysisInspectData, pdfWikiMetaAnalysisTargetPdfIds);
      var input = document.getElementById('metaAiUserRequest');
      if (input) {
        input.value = context.inputDraft || '';
        if (typeof window.autoResizePdfWikiMetaAiInput === 'function') window.autoResizePdfWikiMetaAiInput(input);
      }
      var runResult = context.runResultText && typeof ensurePdfWikiMetaAnalysisRunLog === 'function'
        ? ensurePdfWikiMetaAnalysisRunLog()
        : document.getElementById('metaAnalysisRunResult');
      if (runResult && context.runResultText) {
        runResult.textContent = context.runResultText;
        runResult.style.display = context.runResultDisplay || 'block';
      }
      var rResult = document.getElementById('metaAnalysisRResult');
      if (rResult && context.rResultHtml) {
        rResult.innerHTML = context.rResultHtml;
        rResult.style.display = context.rResultDisplay || 'block';
      }
      var modalContent = document.getElementById('modalContent');
      if (modalContent) modalContent.scrollTop = Number(context.scrollTop || 0);
      return true;
    }

    function showHomeUtilityPage(pageId, title, subtitle, content) {
      var wasHomeUtilityOpen = !!activeHomeUtilityPage || document.body.classList.contains('home-utility-open');
      if (!wasHomeUtilityOpen) {
        homeUtilityReturnContext = captureHomeUtilityReturnContext();
      }
      var activeModalOverlay = document.getElementById('modalOverlay');
      if (activeModalOverlay && activeModalOverlay.classList.contains('show')) {
        closeModal();
      }
      closeStandaloneWorkspaceSurfaces();
      var page = document.getElementById('homeUtilityPage');
      var chat = document.getElementById('chatContainer');
      var input = document.getElementById('mainInputContainer');
      if (!page) return;
      document.body.classList.add('home-utility-open');
      hideQueryNavPreview();
      activeHomeUtilityPage = String(pageId || '');
      page.dataset.pageId = activeHomeUtilityPage;
      var settingsPageIds = ['plugins', 'config', 'persistent-skill', 'skill-config'];
      var settingsTabs = settingsPageIds.indexOf(activeHomeUtilityPage) >= 0
        ? '<nav class="home-utility-tabs" aria-label="配置页面导航">' +
            '<button type="button" class="home-utility-tab' + (activeHomeUtilityPage === 'config' ? ' active' : '') + '" onclick="showConfigCenterDialog()">配置</button>' +
            '<button type="button" class="home-utility-tab' + (activeHomeUtilityPage === 'persistent-skill' || activeHomeUtilityPage === 'skill-config' ? ' active' : '') + '" onclick="showMainContextSkillDialog()">技能</button>' +
            '<button type="button" class="home-utility-tab' + (activeHomeUtilityPage === 'plugins' ? ' active' : '') + '" onclick="showRuntimePluginConfigDialog()">插件</button>' +
          '</nav>'
        : '';
      var settingsSearchPlaceholder = activeHomeUtilityPage === 'plugins'
        ? '搜索插件'
        : (activeHomeUtilityPage === 'config' ? '搜索配置' : '搜索 Skill');
      var settingsSearch = activeHomeUtilityPage === 'persistent-skill' || activeHomeUtilityPage === 'plugins'
        ? ''
        : (settingsPageIds.indexOf(activeHomeUtilityPage) >= 0
        ? '<div class="home-utility-search">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>' +
            '<input type="search" placeholder="' + settingsSearchPlaceholder + '" aria-label="' + settingsSearchPlaceholder + '" oninput="filterHomeConfigurationItems(this.value)">' +
          '</div>'
        : '');
      var isSettingsPage = settingsPageIds.indexOf(activeHomeUtilityPage) >= 0;
      var backButton = isSettingsPage
        ? ''
        : '<button type="button" class="home-utility-back" onclick="closeHomeUtilityPage()" title="返回聊天" aria-label="返回聊天">‹</button>';
      var settingsChatReturn = isSettingsPage
        ? '<button type="button" class="home-utility-chat-return" onclick="closeHomeUtilityPage()" title="返回聊天">返回聊天</button>'
        : '';
      page.innerHTML = '<div class="home-utility-shell">' +
        settingsTabs +
        '<div class="home-utility-header">' +
          backButton +
          '<div style="min-width:0;">' +
            '<div class="home-utility-title">' + escapeHtml(title || '') + '</div>' +
            (subtitle ? '<div class="home-utility-subtitle">' + escapeHtml(subtitle) + '</div>' : '') +
          '</div>' +
          settingsChatReturn +
        '</div>' +
        '<div class="home-utility-body"><div class="home-utility-content">' + settingsSearch + (content || '') + '</div></div>' +
      '</div>';
      page.hidden = false;
      if (chat) chat.style.display = 'none';
      if (input) input.style.display = 'none';
      document.querySelectorAll('.app-chrome-actions [data-home-utility]').forEach(function(button) {
        button.classList.toggle('active', button.getAttribute('data-home-utility') === activeHomeUtilityPage);
      });
    }

    function closeHomeUtilityPage(options) {
      var closeOptions = options && typeof options === 'object' ? options : {};
      var returnContext = closeOptions.skipReturn ? null : homeUtilityReturnContext;
      homeUtilityReturnContext = null;
      var page = document.getElementById('homeUtilityPage');
      var chat = document.getElementById('chatContainer');
      var input = document.getElementById('mainInputContainer');
      activeHomeUtilityPage = '';
      document.body.classList.remove('home-utility-open');
      if (page) {
        page.hidden = true;
        page.innerHTML = '';
        delete page.dataset.pageId;
      }
      if (chat) chat.style.display = '';
      if (input) input.style.display = '';
      document.querySelectorAll('.app-chrome-actions [data-home-utility]').forEach(function(button) {
        button.classList.remove('active');
      });
      scheduleQueryNavRender();
      setTimeout(function() {
        if (returnContext && restoreHomeUtilityReturnContext(returnContext)) return;
        if (typeof focusMainChatInput === 'function') focusMainChatInput();
      }, 0);
    }
    window.showHomeUtilityPage = showHomeUtilityPage;
    window.closeHomeUtilityPage = closeHomeUtilityPage;

    function filterHomeConfigurationItems(query) {
      var normalized = String(query || '').trim().toLowerCase();
      document.querySelectorAll('#homeUtilityPage .config-center-btn, #homeUtilityPage .config-inline-advanced, #homeUtilityPage .skill-catalog-item, #homeUtilityPage .user-skill-list-item, #homeUtilityPage .runtime-plugin-item, #homeUtilityPage .mcp-market-item, #homeUtilityPage .mcp-installed-item').forEach(function(item) {
        item.hidden = !!normalized && !String(item.textContent || '').toLowerCase().includes(normalized);
      });
    }
    window.filterHomeConfigurationItems = filterHomeConfigurationItems;

    function scrollToSkillConfiguration() {
      var section = document.getElementById('unifiedSkillConfiguration');
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    window.scrollToSkillConfiguration = scrollToSkillConfiguration;

    function formatUserInfoPlanName(value) {
      var names = { monthly: '月度套餐', quarterly: '季度套餐', yearly: '年度套餐', lifetime: '永久套餐', trial: '试用套餐' };
      return names[String(value || '')] || String(value || '暂无套餐');
    }

    function formatUserInfoDate(value) {
      if (!value) return '-';
      var date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('zh-CN');
    }
    
    /**
     * 打开用户信息窗口（Electron 环境）
     */
    async function openUserInfoWindow() {
      showHomeUtilityPage(
        'user',
        '用户信息',
        '查看账号、订阅状态和快捷操作',
        '<div class="home-page-card" style="text-align:center;color:var(--text-secondary);">正在读取用户信息...</div>'
      );
      var result = await fetchUserInfoForSidebar();
      if (activeHomeUtilityPage !== 'user') return;
      if (!result || result.error || !result.user) {
        showHomeUtilityPage(
          'user',
          '用户信息',
          '查看账号、订阅状态和快捷操作',
          '<div class="home-page-card" style="color:var(--danger-color);">读取失败：' + escapeHtml(result && result.error ? result.error : '未登录') + '</div>'
        );
        return;
      }
      var user = result.user || {};
      var subscription = result.subscription || {};
      var subscriptionActive = subscription.status === 'active';
      var referralCode = String(user.referral_code || '');
      var referralLink = referralCode ? ('https://scholarharness.com/register?ref=' + encodeURIComponent(referralCode)) : '';
      var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;">' +
        '<section class="home-page-card">' +
          '<div style="font-size:14px;font-weight:850;color:var(--text-primary);margin-bottom:12px;">账号信息</div>' +
          '<div style="display:grid;gap:10px;font-size:12px;">' +
            '<div><span style="color:var(--text-secondary);">用户名</span><div style="margin-top:3px;color:var(--text-primary);font-weight:750;">' + escapeHtml(user.username || '未设置') + '</div></div>' +
            '<div><span style="color:var(--text-secondary);">邮箱</span><div style="margin-top:3px;color:var(--text-primary);">' + escapeHtml(user.email || '-') + '</div></div>' +
            '<div><span style="color:var(--text-secondary);">账号角色</span><div style="margin-top:3px;color:var(--text-primary);">' + (user.role === 'admin' ? '管理员' : '普通用户') + '</div></div>' +
          '</div>' +
        '</section>' +
        '<section class="home-page-card">' +
          '<div style="font-size:14px;font-weight:850;color:var(--text-primary);margin-bottom:12px;">订阅状态</div>' +
          (subscriptionActive
            ? '<div style="display:grid;gap:10px;font-size:12px;"><div><span style="color:var(--text-secondary);">套餐</span><div style="margin-top:3px;color:var(--text-primary);font-weight:750;">' + escapeHtml(formatUserInfoPlanName(subscription.plan_type)) + '</div></div><div><span style="color:var(--text-secondary);">状态</span><div style="margin-top:3px;color:var(--accent-color);font-weight:750;">活跃</div></div><div><span style="color:var(--text-secondary);">有效期至</span><div style="margin-top:3px;color:var(--text-primary);">' + escapeHtml(subscription.plan_type === 'lifetime' ? '永久' : formatUserInfoDate(subscription.end_date)) + '</div></div></div>'
            : '<div style="color:var(--text-secondary);font-size:12px;line-height:1.7;">当前没有有效订阅。</div>') +
          '<button type="button" onclick="openExternalUrl(\'https://scholarharness.com/register/\')" style="margin-top:14px;height:32px;padding:0 12px;border:1px solid var(--accent-color);border-radius:7px;background:var(--accent-color);color:#fff;cursor:pointer;font-size:12px;font-weight:750;">查看套餐</button>' +
        '</section>' +
        '<section class="home-page-card" style="grid-column:1 / -1;">' +
          '<div style="font-size:14px;font-weight:850;color:var(--text-primary);margin-bottom:10px;">邀请信息</div>' +
          '<div style="font-size:12px;color:var(--text-secondary);">邀请码：<span style="color:var(--text-primary);">' + escapeHtml(referralCode || '登录后自动生成') + '</span></div>' +
          (referralLink ? '<div style="margin-top:7px;font-size:11px;color:var(--text-secondary);overflow-wrap:anywhere;">' + escapeHtml(referralLink) + '</div>' : '') +
        '</section>' +
      '</div>';
      showHomeUtilityPage('user', '用户信息', '查看账号、订阅状态和快捷操作', html);
    }
    window.openUserInfoWindow = openUserInfoWindow;
    
    /**
     * 加载用户信息并显示在侧边栏顶部
     */
    async function fetchUserInfoForSidebar() {
      var lastError = null;

      if (window.electronAPI && window.electronAPI.getUserInfo) {
        try {
          var electronResult = await window.electronAPI.getUserInfo();
          if (electronResult && !electronResult.error && electronResult.user) {
            return electronResult;
          }
          lastError = electronResult && electronResult.error ? electronResult.error : 'Electron 用户信息为空';
        } catch (error) {
          lastError = error;
          console.warn('[Sidebar] Electron getUserInfo failed, falling back to /api/auth/me:', error);
        }
      }

      try {
        var response = await fetch('/api/auth/me', { cache: 'no-store' });
        var data = await response.json();
        if (data && !data.error && data.user) {
          return data;
        }
        lastError = data && data.error ? data.error : '本地用户信息为空';
      } catch (error) {
        lastError = error;
        console.warn('[Sidebar] Local /api/auth/me failed:', error);
      }

      return { error: String(lastError || '未登录') };
    }

    async function loadUserInfoForSidebar(retryCount) {
      var avatarEl = document.getElementById('sidebarUserAvatar');
      var nameEl = document.getElementById('sidebarUserName');
      var emailEl = document.getElementById('sidebarUserEmail');
      
      if (!avatarEl || !nameEl || !emailEl) return;

      var attemptsLeft = typeof retryCount === 'number' ? retryCount : 2;

      try {
        var result = await fetchUserInfoForSidebar();

        if (result.error) {
          if (attemptsLeft > 0) {
            setTimeout(function() {
              loadUserInfoForSidebar(attemptsLeft - 1);
            }, 800);
            return;
          }

          nameEl.textContent = '未登录';
          emailEl.textContent = '点击登录';
          avatarEl.innerHTML = getMessageAvatarHtml('user');
          return;
        }

        if (result.user) {
          nameEl.textContent = result.user.username || (result.user.email ? result.user.email.split('@')[0] : '未设置');
          emailEl.textContent = result.user.email || '-';

          avatarEl.innerHTML = getMessageAvatarHtml('user');
        }
      } catch (error) {
        console.warn('[Sidebar] Failed to load user info:', error);
        if (attemptsLeft > 0) {
          setTimeout(function() {
            loadUserInfoForSidebar(attemptsLeft - 1);
          }, 800);
          return;
        }
        nameEl.textContent = '加载失败';
        emailEl.textContent = '点击重试';
      }
    }
    
    // 页面加载时获取用户信息
    loadUserInfoForSidebar();
    window.loadUserInfoForSidebar = loadUserInfoForSidebar;

    // ========== 顶部应用菜单 ==========
    var APP_MENU_ITEMS = {
      file: [
        { label: '重新加载', command: 'reload', shortcut: 'Ctrl+R' },
        { separator: true },
        { label: '退出', command: 'quit', shortcut: 'Ctrl+Q' }
      ],
      edit: [
        { label: '撤销', editCommand: 'undo', shortcut: 'Ctrl+Z' },
        { label: '重做', editCommand: 'redo', shortcut: 'Ctrl+Y' },
        { separator: true },
        { label: '剪切', editCommand: 'cut', shortcut: 'Ctrl+X' },
        { label: '复制', editCommand: 'copy', shortcut: 'Ctrl+C' },
        { label: '粘贴', editCommand: 'paste', shortcut: 'Ctrl+V' },
        { label: '全选', editCommand: 'selectAll', shortcut: 'Ctrl+A' }
      ],
      view: [
        { label: '重新加载', command: 'reload', shortcut: 'Ctrl+R' },
        { label: '强制重新加载', command: 'force-reload' },
        { label: '开发者工具', command: 'devtools' },
        { separator: true },
        { label: '重置缩放', command: 'reset-zoom' },
        { label: '放大', command: 'zoom-in', shortcut: 'Ctrl+=' },
        { label: '缩小', command: 'zoom-out', shortcut: 'Ctrl+-' },
        { separator: true },
        { label: '全屏', command: 'fullscreen' }
      ],
      help: [
        { label: '关于', command: 'about' },
        { label: '检查更新', command: 'check-updates' },
        { label: '查看文档', command: 'docs' }
      ]
    };
    var appMenuOpenKey = null;

    function escapeMenuHtml(value) {
      return String(value || '').replace(/[&<>"']/g, function(char) {
        return {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        }[char];
      });
    }

    function closeAppMenu() {
      var popover = document.getElementById('appMenuPopover');
      if (!popover) return;
      popover.hidden = true;
      popover.innerHTML = '';
      appMenuOpenKey = null;
    }

    function runAppMenuItem(menuKey, itemIndex) {
      var items = APP_MENU_ITEMS[menuKey] || [];
      var item = items[itemIndex];
      closeAppMenu();
      if (!item || item.separator) return;
      if (item.editCommand) {
        document.execCommand(item.editCommand);
        return;
      }
      if (item.command === 'check-updates' && window.electronAPI && window.electronAPI.checkAppUpdate) {
        checkAppUpdateAndRender({ manual: true });
        return;
      }
      if (window.electronAPI && window.electronAPI.appMenuCommand) {
        window.electronAPI.appMenuCommand(item.command);
        return;
      }
      if (item.command === 'reload' || item.command === 'force-reload') {
        window.location.reload();
      } else if (item.command === 'docs') {
        window.open('https://github.com/your-repo/scholar-harness', '_blank');
      } else if (item.command === 'about') {
        alert('Scholar Harness');
      }
    }

    function toggleAppMenu(menuKey, trigger) {
      var popover = document.getElementById('appMenuPopover');
      var chrome = document.querySelector('.app-chrome');
      if (!popover || !chrome) return;
      if (appMenuOpenKey === menuKey && !popover.hidden) {
        closeAppMenu();
        return;
      }
      var items = APP_MENU_ITEMS[menuKey] || [];
      popover.innerHTML = items.map(function(item, index) {
        if (item.separator) return '<div class="app-menu-separator" role="separator"></div>';
        var shortcut = item.shortcut ? '<span class="app-menu-shortcut">' + escapeMenuHtml(item.shortcut) + '</span>' : '';
        return '<button type="button" class="app-menu-command" onclick="runAppMenuItem(\'' + menuKey + '\',' + index + ')">' +
          '<span>' + escapeMenuHtml(item.label) + '</span>' + shortcut + '</button>';
      }).join('');
      var triggerRect = trigger.getBoundingClientRect();
      var chromeRect = chrome.getBoundingClientRect();
      popover.style.left = Math.max(8, Math.round(triggerRect.left - chromeRect.left)) + 'px';
      popover.hidden = false;
      appMenuOpenKey = menuKey;
    }

    document.addEventListener('click', function(event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest('.app-menu-strip') || target.closest('#appMenuPopover')) return;
      closeAppMenu();
    });

    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') closeAppMenu();
    });

    window.toggleAppMenu = toggleAppMenu;
    window.runAppMenuItem = runAppMenuItem;

    async function handleWindowControl(action) {
      try {
        if (window.electronAPI && window.electronAPI.windowControl) {
          await window.electronAPI.windowControl(action);
          return;
        }
        if (action === 'close') window.close();
      } catch (error) {
        console.warn('[Window] Control failed:', action, error);
      }
    }
    window.handleWindowControl = handleWindowControl;
    
    // ========== 主题颜色管理 ==========
    // 页面始终保持陶瓷白底；切换的是深色主色和与其同色相的灰阶。
    var COLOR_THEME_KEY = 'scholarharness_color_theme';
    var COLOR_THEMES = {
      ink: { label: '墨黑', description: '经典黑白灰' },
      pink: { label: '樱粉', description: '粉色与淡粉灰' },
      ocean: { label: '海蓝', description: '蓝色与雾蓝灰' },
      teal: { label: '青绿', description: '青绿与薄荷灰' },
      violet: { label: '葡萄', description: '紫色与淡紫灰' },
      clay: { label: '赤陶', description: '陶红与暖杏灰' },
      amber: { label: '琥珀', description: '金棕与米金灰' },
      aurora: { label: '极光紫', description: '#9F82FD' },
      crimson: { label: '中国红', description: '朱红与暖红' },
      mountain: { label: '山茶蓝', description: '山蓝与水蓝' },
      magenta: { label: '玫红', description: '玫红与淡粉' },
      cocoa: { label: '茶棕', description: '茶棕与米杏' },
      midnight: { label: '午夜蓝', description: '深蓝与冰蓝' },
      royal: { label: '克莱因蓝', description: '#0B3289' },
      orange: { label: '爱马仕橙', description: '#FF8A00' },
      peacock: { label: '马尔斯绿', description: '#008C8D' },
      jade: { label: '青瓷', description: '青绿与淡瓷' },
      fluorescent: { label: '荧光绿', description: '#00E08E' },
      pomegranate: { label: '石榴红', description: '#E72D48' },
      honey: { label: '蜜柚黄', description: '#FBEA03' },
      deepsea: { label: '深海蓝', description: '#122E8A' },
      charcoal: { label: '炭黑色', description: '#1A1A1D' },
      sweetpink: { label: '甜酷粉', description: '#E6397C' },
      'ji-green': { label: '績绿', description: '#215A59' },
      lingxiao: { label: '凌霄', description: '#ED723F' },
      shanzhi: { label: '山栀', description: '#999A7E' },
      wanxiang: { label: '晚香', description: '#D7C6A6' },
      pinegreen: { label: '松绿', description: '#3D6036' },
      fochi: { label: '佛赤', description: '#C7935F' },
      mogreen: { label: '茉绿', description: '#A0C198' },
      mossgreen: { label: '苔绿', description: '#535E4B' },
      oubi: { label: '欧碧', description: '#C0D695' },
      landy: { label: '兰迪', description: '#7A916D' },
      calyxgreen: { label: '萼绿', description: '#014946' },
      'true-red': { label: '正红', description: '#C3272B' },
      liuli: { label: '琉璃', description: '#0B6051' },
      yuzi: { label: '玉子', description: '#FABE51' },
      xungreen: { label: '逊绿', description: '#1C6C4C' },
      greentea: { label: '绿茶', description: '#91B821' },
      inkgreen: { label: '墨绿', description: '#1C2D25' },
      greenshen: { label: '绿沈', description: '#354E40' },
      'headdress-red': { label: '鹤顶', description: '#BC3823' },
      tea: { label: '茶色', description: '#765A35' },
      goldred: { label: '金红', description: '#EE781F' },
      qinglu: { label: '青騼', description: '#000013' },
      titian: { label: '提香红', description: '#B05B24' },
      tiffany: { label: '蒂芙尼蓝', description: '#81CAC4' },
      bordeaux: { label: '波尔多红', description: '#4A010A' },
      botanical: { label: '草木绿', description: '#8AB04D' },
      blackoak: { label: '黑橡', description: '#202F39' },
      capri: { label: '卡布里蓝', description: '#015697' },
      scarlet: { label: '绯红', description: '#C23738' },
      'ink-teal': { label: '墨青', description: '#034342' },
      'chestnut-red': { label: '栗红', description: '#8C4643' },
      berry: { label: '莓果红', description: '#D81E5B' },
      'blaze-orange': { label: '炽橙', description: '#FF5F00' },
      'electric-blue': { label: '电光蓝', description: '#0099FF' },
      'lime-green': { label: '青柠绿', description: '#BFFF00' },
      'oak-blue': { label: '橡兰', description: '#212F3A' },
      'dai-blue': { label: '黛蓝', description: '#584C5E' },
      'lang-green': { label: '榔绿', description: '#555B37' },
      'elegant-yellow': { label: '雅黄', description: '#FFD217' },
      kelai: { label: '克菜', description: '#002E9F' },
      'yin-red': { label: '殷红', description: '#BE002F' },
      'red-gold': { label: '赤金', description: '#F2BE1D' }
    };
    var COLOR_THEME_GROUPS = [
      {
        label: '中性与深色',
        themes: ['ink', 'charcoal', 'qinglu', 'blackoak', 'oak-blue', 'dai-blue']
      },
      {
        label: '红 · 粉 · 紫',
        themes: ['pink', 'violet', 'aurora', 'crimson', 'magenta', 'pomegranate', 'sweetpink', 'true-red', 'scarlet', 'chestnut-red', 'berry', 'yin-red', 'bordeaux']
      },
      {
        label: '橙 · 金 · 棕',
        themes: ['clay', 'amber', 'cocoa', 'orange', 'honey', 'lingxiao', 'fochi', 'yuzi', 'headdress-red', 'tea', 'goldred', 'titian', 'blaze-orange', 'elegant-yellow', 'red-gold']
      },
      {
        label: '蓝色',
        themes: ['ocean', 'mountain', 'midnight', 'royal', 'deepsea', 'capri', 'electric-blue', 'kelai']
      },
      {
        label: '青 · 绿色',
        themes: ['teal', 'peacock', 'jade', 'fluorescent', 'ji-green', 'pinegreen', 'mossgreen', 'calyxgreen', 'liuli', 'xungreen', 'greentea', 'inkgreen', 'greenshen', 'tiffany', 'ink-teal', 'lime-green']
      },
      {
        label: '自然低饱和',
        themes: ['shanzhi', 'wanxiang', 'mogreen', 'oubi', 'landy', 'botanical', 'lang-green']
      }
    ];

    function organizeColorThemeOptions() {
      var container = document.querySelector('#colorThemePicker .color-theme-options');
      if (!container || container.getAttribute('data-grouped') === 'true') return;
      var buttons = Array.from(container.querySelectorAll('[data-color-theme-option]'));
      var byTheme = {};
      buttons.forEach(function(button) {
        byTheme[button.getAttribute('data-color-theme-option')] = button;
      });
      var assigned = {};
      container.innerHTML = '';

      COLOR_THEME_GROUPS.forEach(function(group) {
        var groupButtons = group.themes.map(function(theme) {
          assigned[theme] = true;
          return byTheme[theme];
        }).filter(Boolean);
        if (!groupButtons.length) return;
        var section = document.createElement('section');
        section.className = 'color-theme-group';
        section.setAttribute('aria-label', group.label);
        var heading = document.createElement('div');
        heading.className = 'color-theme-group-title';
        heading.textContent = group.label;
        var grid = document.createElement('div');
        grid.className = 'color-theme-group-grid';
        groupButtons.forEach(function(button) { grid.appendChild(button); });
        section.appendChild(heading);
        section.appendChild(grid);
        container.appendChild(section);
      });

      var otherButtons = buttons.filter(function(button) {
        return !assigned[button.getAttribute('data-color-theme-option')];
      });
      if (otherButtons.length) {
        var otherSection = document.createElement('section');
        otherSection.className = 'color-theme-group';
        otherSection.setAttribute('aria-label', '其他');
        otherSection.innerHTML = '<div class="color-theme-group-title">其他</div>';
        var otherGrid = document.createElement('div');
        otherGrid.className = 'color-theme-group-grid';
        otherButtons.forEach(function(button) { otherGrid.appendChild(button); });
        otherSection.appendChild(otherGrid);
        container.appendChild(otherSection);
      }
      container.setAttribute('data-grouped', 'true');
    }

    function normalizeColorTheme(theme) {
      return Object.prototype.hasOwnProperty.call(COLOR_THEMES, theme) ? theme : 'ink';
    }

    function positionColorThemePicker() {
      var picker = document.getElementById('colorThemePicker');
      var toggleBtn = document.querySelector('.theme-toggle');
      if (!picker || !toggleBtn || picker.hidden) return;
      var rect = toggleBtn.getBoundingClientRect();
      var pickerWidth = Math.min(720, Math.max(300, window.innerWidth - 24));
      var left = Math.min(
        Math.max(12, rect.right - pickerWidth),
        Math.max(12, window.innerWidth - pickerWidth - 12)
      );
      picker.style.width = pickerWidth + 'px';
      picker.style.left = left + 'px';
      var pickerHeight = Math.min(picker.scrollHeight || 420, Math.max(180, window.innerHeight - 24));
      picker.style.top = Math.max(12, Math.min(rect.bottom + 7, window.innerHeight - pickerHeight - 12)) + 'px';
    }

    function syncColorThemeControls(theme) {
      var normalized = normalizeColorTheme(theme);
      var meta = COLOR_THEMES[normalized];
      var toggleBtn = document.querySelector('.theme-toggle');
      if (toggleBtn) {
        toggleBtn.setAttribute('data-color-theme', normalized);
        toggleBtn.setAttribute('title', '界面主题，当前颜色：' + meta.label);
        toggleBtn.setAttribute('aria-label', '选择界面主题，当前颜色为' + meta.label);
      }
      document.querySelectorAll('[data-color-theme-option]').forEach(function(button) {
        var selected = button.getAttribute('data-color-theme-option') === normalized;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-checked', selected ? 'true' : 'false');
      });
    }

    function applyColorTheme(theme, persist) {
      var normalized = normalizeColorTheme(theme);
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.setAttribute('data-color-theme', normalized);
      if (persist !== false) {
        localStorage.setItem(COLOR_THEME_KEY, normalized);
        // 保留旧键供旧版本回退；新版不再切换深色背景。
        localStorage.setItem(THEME_KEY, 'light');
      }
      syncColorThemeControls(normalized);
      window.dispatchEvent(new CustomEvent('scholarharness:color-theme-change', {
        detail: { theme: normalized }
      }));
      return normalized;
    }

    function closeColorThemePicker() {
      var picker = document.getElementById('colorThemePicker');
      var toggleBtn = document.querySelector('.theme-toggle');
      if (picker) picker.hidden = true;
      if (toggleBtn) {
        toggleBtn.classList.remove('active');
        toggleBtn.setAttribute('aria-expanded', 'false');
      }
    }

    function toggleColorThemePicker(event) {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      var picker = document.getElementById('colorThemePicker');
      var toggleBtn = document.querySelector('.theme-toggle');
      if (!picker || !toggleBtn) return;
      var shouldOpen = picker.hidden;
      if (!shouldOpen) {
        closeColorThemePicker();
        return;
      }
      picker.hidden = false;
      toggleBtn.classList.add('active');
      toggleBtn.setAttribute('aria-expanded', 'true');
      syncColorThemeControls(document.documentElement.getAttribute('data-color-theme'));
      positionColorThemePicker();
    }

    function selectColorTheme(theme, event) {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      applyColorTheme(theme, true);
      closeColorThemePicker();
    }

    function initTheme() {
      var savedColorTheme = localStorage.getItem(COLOR_THEME_KEY);
      organizeColorThemeOptions();
      applyColorTheme(savedColorTheme || 'ink', false);
      var picker = document.getElementById('colorThemePicker');
      if (picker) {
        picker.addEventListener('click', function(event) {
          event.stopPropagation();
        });
      }
      document.addEventListener('click', function(event) {
        var target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('#colorThemePicker') || target.closest('.theme-toggle')) return;
        closeColorThemePicker();
      });
      document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') closeColorThemePicker();
      });
      window.addEventListener('resize', function() {
        var activePicker = document.getElementById('colorThemePicker');
        if (activePicker && !activePicker.hidden) positionColorThemePicker();
      });
    }

    // 兼容原有入口：原来的黑白切换按钮现在打开颜色选择面板。
    function toggleTheme(event) {
      toggleColorThemePicker(event);
    }
    window.toggleTheme = toggleTheme;
    window.toggleColorThemePicker = toggleColorThemePicker;
    window.closeColorThemePicker = closeColorThemePicker;
    window.selectColorTheme = selectColorTheme;
    window.applyColorTheme = applyColorTheme;
    window.positionColorThemePicker = positionColorThemePicker;
    
    function syncLeftSidebarLayoutState() {
      var sidebar = document.querySelector('.sidebar');
      var collapsed = !!(sidebar && sidebar.classList.contains('collapsed'));
      document.body.classList.toggle('left-sidebar-collapsed', collapsed);
      syncGlobalLeftSidebarInset(collapsed);
      return collapsed;
    }

    function syncGlobalLeftSidebarInset(collapsed) {
      var sidebar = document.querySelector('.sidebar');
      var shouldCollapse = typeof collapsed === 'boolean'
        ? collapsed
        : !!(sidebar && sidebar.classList.contains('collapsed'));
      var root = document.documentElement;
      if (root) {
        root.style.setProperty(
          '--active-left-sidebar-width',
          shouldCollapse ? '0px' : 'var(--left-sidebar-width)'
        );
      }
      if (!sidebar) return shouldCollapse;
      if (shouldCollapse) {
        sidebar.style.setProperty('width', '0px', 'important');
        sidebar.style.setProperty('min-width', '0px', 'important');
        sidebar.style.setProperty('max-width', '0px', 'important');
        sidebar.style.setProperty('flex', '0 0 0px', 'important');
        sidebar.style.setProperty('padding', '0px', 'important');
        sidebar.style.setProperty('border-right-width', '0px', 'important');
        sidebar.style.setProperty('visibility', 'hidden', 'important');
        sidebar.style.setProperty('pointer-events', 'none', 'important');
      } else {
        [
          'width',
          'min-width',
          'max-width',
          'flex',
          'padding',
          'border-right-width',
          'visibility',
          'pointer-events'
        ].forEach(function(propertyName) {
          sidebar.style.removeProperty(propertyName);
        });
      }
      return shouldCollapse;
    }
    window.syncGlobalLeftSidebarInset = syncGlobalLeftSidebarInset;

    function resetMainWorkspaceHorizontalPosition() {
      var scrollingElement = document.scrollingElement || document.documentElement;
      if (scrollingElement) scrollingElement.scrollLeft = 0;
      document.documentElement.scrollLeft = 0;
      document.body.scrollLeft = 0;
      ['.app', '.main-wrapper', '.main'].forEach(function(selector) {
        var element = document.querySelector(selector);
        if (element) element.scrollLeft = 0;
      });
      requestAnimationFrame(function() {
        window.dispatchEvent(new Event('resize'));
        if (typeof scheduleQueryNavRender === 'function') scheduleQueryNavRender();
      });
    }

    function setLeftSidebarCollapsed(collapsed, options) {
      var sidebar = document.querySelector('.sidebar');
      var toggleBtn = document.querySelector('.sidebar-toggle');
      if (!sidebar || !toggleBtn) return;
      var shouldCollapse = collapsed === true;
      document.body.classList.toggle('left-sidebar-collapsed', shouldCollapse);
      sidebar.classList.toggle('collapsed', shouldCollapse);
      toggleBtn.classList.toggle('collapsed', shouldCollapse);
      toggleBtn.classList.toggle('sidebar-hidden', shouldCollapse);
      syncGlobalLeftSidebarInset(shouldCollapse);
      localStorage.setItem('scholarclaw_sidebar_collapsed', shouldCollapse ? 'true' : 'false');
      if (typeof syncPdfWikiReaderOverlayInset === 'function') {
        syncPdfWikiReaderOverlayInset(shouldCollapse);
      }
      if (!shouldCollapse && !(options && options.skipMutualCollapse) && typeof setRightSidebarCollapsed === 'function') {
        setRightSidebarCollapsed(true, false, { skipMutualCollapse: true });
      }
      requestAnimationFrame(function() {
        syncLeftSidebarLayoutState();
        if (typeof syncPdfWikiReaderOverlayInset === 'function') {
          syncPdfWikiReaderOverlayInset(shouldCollapse);
        }
        resetMainWorkspaceHorizontalPosition();
      });
      [80, 260].forEach(function(delay) {
        setTimeout(function() {
          if (typeof syncPdfWikiReaderOverlayInset === 'function') {
            syncPdfWikiReaderOverlayInset(shouldCollapse);
          }
        }, delay);
      });
    }
    window.setLeftSidebarCollapsed = setLeftSidebarCollapsed;

    function toggleSidebar() {
      var sidebar = document.querySelector('.sidebar');
      if (!sidebar) return;
      setLeftSidebarCollapsed(!sidebar.classList.contains('collapsed'));
    }
    window.toggleSidebar = toggleSidebar;
    
    function initSidebar() {
      var collapsed = localStorage.getItem('scholarclaw_sidebar_collapsed') === 'true';
      setLeftSidebarCollapsed(collapsed, { skipMutualCollapse: true });
    }
    
    initSidebar();

    function getSidebarPanelCollapseKey(panelKey) {
      return 'scholarclaw_sidebar_panel_collapsed_' + panelKey;
    }

    function setSidebarPanelCollapsed(panel, collapsed) {
      if (!panel) return;
      panel.classList.toggle('is-collapsed', collapsed);
      var toggle = panel.querySelector('.sidebar-panel-toggle');
      if (toggle) {
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        toggle.setAttribute('title', collapsed ? '展开' : '折叠');
      }
    }

    function toggleSidebarPanel(panelKey) {
      var panel = document.querySelector('[data-sidebar-collapse-key="' + panelKey + '"]');
      if (!panel) return;
      var collapsed = !panel.classList.contains('is-collapsed');
      setSidebarPanelCollapsed(panel, collapsed);
      localStorage.setItem(getSidebarPanelCollapseKey(panelKey), collapsed ? 'true' : 'false');
    }
    window.toggleSidebarPanel = toggleSidebarPanel;

    function initSidebarPanelCollapse() {
      document.querySelectorAll('[data-sidebar-toggle-key]').forEach(function(toggle) {
        var panelKey = toggle.getAttribute('data-sidebar-toggle-key');
        if (!panelKey) return;
        toggle.addEventListener('click', function() {
          toggleSidebarPanel(panelKey);
        });
      });

      document.querySelectorAll('[data-sidebar-collapse-key]').forEach(function(panel) {
        var panelKey = panel.getAttribute('data-sidebar-collapse-key');
        if (!panelKey) return;
        var collapsed = localStorage.getItem(getSidebarPanelCollapseKey(panelKey)) === 'true';
        setSidebarPanelCollapsed(panel, collapsed);
      });
    }

    initSidebarPanelCollapse();
    
    // ========== 右侧写作框架面板折叠功能 ==========
    var RIGHT_SIDEBAR_WIDTH_KEY = 'scholarclaw_right_sidebar_width';
    var RIGHT_SIDEBAR_WIDTH_VERSION_KEY = 'scholarharness_right_sidebar_width_version';
    var RIGHT_SIDEBAR_CUSTOM_WIDTH_KEY = 'scholarharness_right_sidebar_custom_width';
    var RIGHT_SIDEBAR_WIDTH_VERSION = '9';
    var RIGHT_SIDEBAR_DEFAULT_RATIO = 0.375;
    var RIGHT_SIDEBAR_TAB_KEY = 'scholarharness_right_sidebar_active_tab';
    var RIGHT_SIDEBAR_MIN_WIDTH = 240;
    var RIGHT_SIDEBAR_REOPEN_MIN_WIDTH = 420;
    var RIGHT_SIDEBAR_MAX_WIDTH = 1350;
    var rightSidebarTransientTab = '';
    var rightSidebarPreviousTab = 'article';
    var rightSidebarFilePreviewState = null;
    var rightSidebarVendorConfigState = null;
    var rightSidebarPdfOverviewState = null;
    var rightSidebarAvatarPickerState = null;
    var rightSidebarAvatarReturnTab = 'article';
    var customChatAvatarOptions = [];
    var customChatAvatarLoadPromise = null;
    var customChatAvatarLoadedUserId = '';
    var rightSidebarVendorBoundsFrame = 0;
    var rightSidebarVendorResizeObserver = null;
    var rightSidebarFilePreviewRequestId = 0;
    var rightSidebarImageResizeObserver = null;
    var rightSidebarImageResizeFrame = 0;
    var rightSidebarImagePanCleanup = null;
    var RIGHT_SIDEBAR_IMAGE_MIN_ZOOM = 0.25;
    var RIGHT_SIDEBAR_IMAGE_MAX_ZOOM = 8;
    var RIGHT_SIDEBAR_IMAGE_ZOOM_STEP = 1.12;

    function getRightSidebarDefaultWidth() {
      var viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      return Math.round(viewportWidth * RIGHT_SIDEBAR_DEFAULT_RATIO);
    }

    function getRightSidebarReopenMinimumWidth() {
      return Math.min(getRightSidebarDefaultWidth(), RIGHT_SIDEBAR_REOPEN_MIN_WIDTH);
    }

    function clearSavedRightSidebarWidth() {
      try {
        localStorage.removeItem(RIGHT_SIDEBAR_WIDTH_KEY);
        localStorage.setItem(RIGHT_SIDEBAR_CUSTOM_WIDTH_KEY, 'false');
        localStorage.setItem(RIGHT_SIDEBAR_WIDTH_VERSION_KEY, RIGHT_SIDEBAR_WIDTH_VERSION);
      } catch (e) {}
    }

    function hasCustomRightSidebarWidth() {
      try {
        return localStorage.getItem(RIGHT_SIDEBAR_WIDTH_VERSION_KEY) === RIGHT_SIDEBAR_WIDTH_VERSION
          && localStorage.getItem(RIGHT_SIDEBAR_CUSTOM_WIDTH_KEY) === 'true';
      } catch (e) {
        return false;
      }
    }

    function getSavedRightSidebarWidth() {
      if (!hasCustomRightSidebarWidth()) return 0;
      try {
        var savedWidth = Number(localStorage.getItem(RIGHT_SIDEBAR_WIDTH_KEY) || 0);
        return Number.isFinite(savedWidth) && savedWidth >= getRightSidebarReopenMinimumWidth()
          ? savedWidth
          : 0;
      } catch (e) {
        return 0;
      }
    }

    function getPreferredRightSidebarWidth() {
      return getSavedRightSidebarWidth() || getRightSidebarDefaultWidth();
    }

    function getRightSidebarActiveTab() {
      if (rightSidebarTransientTab === 'preview' && rightSidebarFilePreviewState) return 'preview';
      if (rightSidebarTransientTab === 'vendor' && rightSidebarVendorConfigState) return 'vendor';
      if (rightSidebarTransientTab === 'pdf-overview' && rightSidebarPdfOverviewState) return 'pdf-overview';
      if (rightSidebarTransientTab === 'avatar' && rightSidebarAvatarPickerState) return 'avatar';
      try {
        var saved = localStorage.getItem(RIGHT_SIDEBAR_TAB_KEY);
        return saved === 'figures' ? 'figures' : 'article';
      } catch (e) {}
      return 'article';
    }

    function renderRightSidebarChrome() {
      var activeTab = getRightSidebarActiveTab();
      var title = document.getElementById('rightSidebarTitle');
      var meta = document.getElementById('articleWritingProgressMeta');
      var articlePage = document.getElementById('articleProgressPage');
      var figuresPage = document.getElementById('paperFiguresPage');
      var previewPage = document.getElementById('rightSidebarFilePreviewPage');
      var vendorPage = document.getElementById('rightSidebarVendorConfigPage');
      var pdfOverviewPage = document.getElementById('rightSidebarPdfOverviewPage');
      var avatarPage = document.getElementById('rightSidebarAvatarPage');
      var articleTab = document.getElementById('rightSidebarArticleTab');
      var figuresTab = document.getElementById('rightSidebarFiguresTab');
      var previewTab = document.getElementById('rightSidebarFilePreviewTab');
      var vendorTab = document.getElementById('rightSidebarVendorConfigTab');
      var pdfOverviewTab = document.getElementById('rightSidebarPdfOverviewTab');
      var avatarTab = document.getElementById('rightSidebarAvatarTab');
      var wordImport = document.getElementById('rightSidebarWordImport');
      var paperFigureRefreshButton = document.getElementById('paperFigureRefreshButton');
      if (title) {
        title.textContent = activeTab === 'preview'
          ? String(rightSidebarFilePreviewState && rightSidebarFilePreviewState.name || '文件预览')
          : (activeTab === 'vendor'
            ? String(rightSidebarVendorConfigState && rightSidebarVendorConfigState.name || '模型厂商配置')
            : (activeTab === 'pdf-overview'
              ? String(rightSidebarPdfOverviewState && rightSidebarPdfOverviewState.title || '论文一览图')
              : (activeTab === 'avatar'
                ? (rightSidebarAvatarPickerState && rightSidebarAvatarPickerState.role === 'user' ? '我的头像' : 'AI 头像')
                : (activeTab === 'figures' ? '论文图片' : '文章写作进度'))));
      }
      if (meta && activeTab === 'preview') {
        meta.textContent = getOutputAttachmentKindLabel(rightSidebarFilePreviewState && rightSidebarFilePreviewState.kind || 'file');
      } else if (meta && activeTab === 'vendor') {
        meta.textContent = rightSidebarVendorConfigState && rightSidebarVendorConfigState.loading
          ? '正在加载官网…'
          : '安全隔离网页视图';
      } else if (meta && activeTab === 'pdf-overview') {
        meta.textContent = String(rightSidebarPdfOverviewState && rightSidebarPdfOverviewState.engineLabel || '结构与研究逻辑');
      } else if (meta && activeTab === 'avatar') {
        meta.textContent = '内置头像 + 本地自定义';
      }
      if (articlePage) articlePage.classList.toggle('active', activeTab === 'article');
      if (figuresPage) figuresPage.classList.toggle('active', activeTab === 'figures');
      if (previewPage) previewPage.classList.toggle('active', activeTab === 'preview');
      if (vendorPage) vendorPage.classList.toggle('active', activeTab === 'vendor');
      if (pdfOverviewPage) pdfOverviewPage.classList.toggle('active', activeTab === 'pdf-overview');
      if (avatarPage) avatarPage.classList.toggle('active', activeTab === 'avatar');
      if (wordImport) wordImport.hidden = activeTab !== 'article' && activeTab !== 'figures';
      if (paperFigureRefreshButton) paperFigureRefreshButton.hidden = activeTab !== 'figures';
      if (articleTab) {
        articleTab.classList.toggle('active', activeTab === 'article');
        articleTab.setAttribute('aria-selected', activeTab === 'article' ? 'true' : 'false');
      }
      if (figuresTab) {
        figuresTab.classList.toggle('active', activeTab === 'figures');
        figuresTab.setAttribute('aria-selected', activeTab === 'figures' ? 'true' : 'false');
      }
      if (previewTab) {
        previewTab.hidden = !rightSidebarFilePreviewState;
        previewTab.classList.toggle('active', activeTab === 'preview');
        previewTab.setAttribute('aria-selected', activeTab === 'preview' ? 'true' : 'false');
      }
      if (vendorTab) {
        vendorTab.hidden = !rightSidebarVendorConfigState;
        vendorTab.classList.toggle('active', activeTab === 'vendor');
        vendorTab.setAttribute('aria-selected', activeTab === 'vendor' ? 'true' : 'false');
      }
      if (pdfOverviewTab) {
        pdfOverviewTab.hidden = !rightSidebarPdfOverviewState;
        pdfOverviewTab.textContent = rightSidebarPdfOverviewState && rightSidebarPdfOverviewState.kind === 'image'
          ? 'PDF 图片'
          : '论文一览图';
        pdfOverviewTab.classList.toggle('active', activeTab === 'pdf-overview');
        pdfOverviewTab.setAttribute('aria-selected', activeTab === 'pdf-overview' ? 'true' : 'false');
      }
      if (avatarTab) {
        avatarTab.hidden = !rightSidebarAvatarPickerState;
        avatarTab.textContent = rightSidebarAvatarPickerState && rightSidebarAvatarPickerState.role === 'user'
          ? '我的头像'
          : 'AI 头像';
        avatarTab.classList.toggle('active', activeTab === 'avatar');
        avatarTab.setAttribute('aria-selected', activeTab === 'avatar' ? 'true' : 'false');
      }
      syncVendorConfigBrowserVisibility();
      syncPdfWikiOverviewRightSidebarLayer();
      syncArticleWritingProgressButtonState();
    }

    function setRightSidebarTab(tabName) {
      var nextTab = tabName === 'preview' && rightSidebarFilePreviewState
        ? 'preview'
        : (tabName === 'vendor' && rightSidebarVendorConfigState
          ? 'vendor'
          : (tabName === 'pdf-overview' && rightSidebarPdfOverviewState
            ? 'pdf-overview'
            : (tabName === 'avatar' && rightSidebarAvatarPickerState
              ? 'avatar'
              : (tabName === 'figures' ? 'figures' : 'article'))));
      if (nextTab === 'preview' || nextTab === 'vendor' || nextTab === 'pdf-overview' || nextTab === 'avatar') {
        rightSidebarTransientTab = nextTab;
      } else {
        rightSidebarTransientTab = '';
        try {
          localStorage.setItem(RIGHT_SIDEBAR_TAB_KEY, nextTab);
        } catch (e) {}
      }
      setRightSidebarCollapsed(false, true);
      renderRightSidebarActivePanel();
    }
    window.setRightSidebarTab = setRightSidebarTab;

    function renderRightSidebarActivePanel() {
      renderRightSidebarChrome();
      if (getRightSidebarActiveTab() === 'preview') {
        renderRightSidebarFilePreviewPanel();
      } else if (getRightSidebarActiveTab() === 'vendor') {
        syncVendorConfigBrowserVisibility();
      } else if (getRightSidebarActiveTab() === 'pdf-overview') {
        renderRightSidebarPdfOverviewPanel();
      } else if (getRightSidebarActiveTab() === 'avatar') {
        renderChatAvatarPickerPanel();
      } else if (getRightSidebarActiveTab() === 'figures') {
        renderPaperFigureLibraryPanel();
      } else {
        renderArticleWritingProgressPanel();
      }
    }
    window.renderRightSidebarActivePanel = renderRightSidebarActivePanel;

    function openArticleWritingProgressPanel() {
      setRightSidebarTab('article');
    }
    window.openArticleWritingProgressPanel = openArticleWritingProgressPanel;

    function syncPdfWikiMetaSharedComposerRightSidebarLayer() {
      var overlay = document.getElementById('modalOverlay');
      var rightSidebar = document.querySelector('.right-sidebar');
      var shouldLiftRightSidebar = !!(
        overlay
        && overlay.classList.contains('show')
        && overlay.classList.contains('meta-analysis-shared-composer-overlay')
        && rightSidebar
        && !rightSidebar.classList.contains('collapsed')
      );
      document.body.classList.toggle('meta-analysis-right-sidebar-layer-open', shouldLiftRightSidebar);
    }

    function syncPdfWikiOverviewRightSidebarLayer() {
      var viewer = document.getElementById('pdfWikiViewerModal');
      var rightSidebar = document.querySelector('.right-sidebar');
      var shouldLiftRightSidebar = !!(
        viewer
        && rightSidebarPdfOverviewState
        && getRightSidebarActiveTab() === 'pdf-overview'
        && rightSidebar
        && !rightSidebar.classList.contains('collapsed')
      );
      document.body.classList.toggle('pdf-wiki-overview-sidebar-open', shouldLiftRightSidebar);
    }

    function syncArticleWritingProgressButtonState() {
      var button = document.getElementById('articleWritingProgressBtn');
      var rightSidebar = document.querySelector('.right-sidebar');
      syncPdfWikiMetaSharedComposerRightSidebarLayer();
      if (!button) return;
      var expanded = !!(
        rightSidebar
        && !rightSidebar.classList.contains('collapsed')
        && getRightSidebarActiveTab() === 'article'
      );
      button.classList.toggle('active', expanded);
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      button.title = expanded ? '关闭文章写作进度' : '文章写作进度';
      button.setAttribute('aria-label', button.title);
    }

    function toggleArticleWritingProgressPanel() {
      var rightSidebar = document.querySelector('.right-sidebar');
      if (!rightSidebar) return;
      var articleProgressIsOpen = !rightSidebar.classList.contains('collapsed')
        && getRightSidebarActiveTab() === 'article';
      if (articleProgressIsOpen) {
        setRightSidebarCollapsed(true);
        return;
      }
      openArticleWritingProgressPanel();
    }
    window.toggleArticleWritingProgressPanel = toggleArticleWritingProgressPanel;

    function openPaperFigureLibraryPanel() {
      setRightSidebarTab('figures');
    }
    window.openPaperFigureLibraryPanel = openPaperFigureLibraryPanel;

    function getVendorConfigProvider(providerId) {
      var normalizedId = String(providerId || '').trim().toLowerCase();
      if (normalizedId === 'openrouter') {
        return { id: 'openrouter', name: 'OpenRouter', applyUrl: OPENROUTER_KEYS_URL };
      }
      if (normalizedId === 'qwen') {
        return { id: 'qwen', name: '阿里云百炼 / 通义千问', applyUrl: QWEN_API_KEY_URL };
      }
      return CHINA_AI_API_PROVIDERS.find(function(provider) {
        return provider && provider.id === normalizedId;
      }) || null;
    }

    function getVendorConfigBrowserBounds() {
      var host = document.getElementById('vendorConfigBrowserHost');
      if (!host) return null;
      var rect = host.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) return null;
      return {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    }

    function renderVendorConfigBrowserState() {
      var state = rightSidebarVendorConfigState || {};
      var location = document.getElementById('vendorConfigBrowserLocation');
      var placeholder = document.getElementById('vendorConfigBrowserPlaceholder');
      var backButton = document.getElementById('vendorConfigBrowserBack');
      if (location) {
        location.textContent = state.error
          ? state.error
          : (state.loading ? '正在加载 ' + (state.name || '厂商官网') + '…' : (state.url || state.name || '厂商官网'));
        location.title = state.url || state.error || '';
      }
      if (placeholder) {
        placeholder.textContent = state.error
          ? state.error + ' 可以点击“浏览器打开”继续。'
          : '正在安全隔离视图中打开 ' + (state.name || '厂商官网') + '…';
      }
      if (backButton) backButton.disabled = !state.canGoBack;
      renderRightSidebarChrome();
    }

    function scheduleVendorConfigBrowserBoundsSync() {
      if (rightSidebarVendorBoundsFrame) cancelAnimationFrame(rightSidebarVendorBoundsFrame);
      rightSidebarVendorBoundsFrame = requestAnimationFrame(function() {
        rightSidebarVendorBoundsFrame = 0;
        if (!rightSidebarVendorConfigState || getRightSidebarActiveTab() !== 'vendor') return;
        var rightSidebar = document.querySelector('.right-sidebar');
        if (!rightSidebar || rightSidebar.classList.contains('collapsed')) return;
        var bounds = getVendorConfigBrowserBounds();
        if (!bounds || !window.electronAPI) return;
        if (rightSidebarVendorConfigState.hidden && window.electronAPI.openVendorConfigBrowser) {
          window.electronAPI.openVendorConfigBrowser(rightSidebarVendorConfigState.providerId, bounds).then(function(result) {
            if (result && result.success && rightSidebarVendorConfigState) {
              rightSidebarVendorConfigState.hidden = false;
            }
          }).catch(function() {});
          return;
        }
        if (window.electronAPI.setVendorConfigBrowserBounds) {
          window.electronAPI.setVendorConfigBrowserBounds(bounds).catch(function() {});
        }
      });
    }

    function syncVendorConfigBrowserVisibility() {
      if (!window.electronAPI || !window.electronAPI.hideVendorConfigBrowser) return;
      var rightSidebar = document.querySelector('.right-sidebar');
      var shouldShow = !!(
        rightSidebarVendorConfigState
        && getRightSidebarActiveTab() === 'vendor'
        && rightSidebar
        && !rightSidebar.classList.contains('collapsed')
      );
      if (shouldShow) {
        scheduleVendorConfigBrowserBoundsSync();
      } else {
        window.electronAPI.hideVendorConfigBrowser().catch(function() {});
      }
    }

    async function openVendorConfigBrowser(providerId) {
      var provider = getVendorConfigProvider(providerId);
      if (!provider || !provider.applyUrl) {
        appendMessage('无法打开厂商官网：不支持的厂商 ID。', 'bot', false, true);
        return false;
      }
      if (!window.electronAPI || !window.electronAPI.openVendorConfigBrowser) {
        openExternalUrl(provider.applyUrl);
        return true;
      }
      var currentTab = getRightSidebarActiveTab();
      if (currentTab !== 'vendor') rightSidebarPreviousTab = currentTab === 'figures' ? 'figures' : 'article';
      rightSidebarVendorConfigState = {
        providerId: provider.id,
        name: provider.name,
        url: provider.applyUrl,
        loading: true,
        canGoBack: false,
        error: ''
      };
      rightSidebarTransientTab = 'vendor';
      setRightSidebarCollapsed(false, true);
      renderRightSidebarActivePanel();
      await new Promise(function(resolve) { requestAnimationFrame(resolve); });
      var bounds = getVendorConfigBrowserBounds();
      if (!bounds) {
        rightSidebarVendorConfigState.error = '右侧边栏尚未准备好，请重试。';
        renderVendorConfigBrowserState();
        return false;
      }
      var result = await window.electronAPI.openVendorConfigBrowser(provider.id, bounds);
      if (!result || !result.success) {
        rightSidebarVendorConfigState.error = result && result.error ? result.error : '厂商官网打开失败';
        rightSidebarVendorConfigState.loading = false;
        renderVendorConfigBrowserState();
        return false;
      }
      rightSidebarVendorConfigState.name = result.name || provider.name;
      rightSidebarVendorConfigState.url = result.url || provider.applyUrl;
      renderVendorConfigBrowserState();
      return true;
    }
    window.openVendorConfigBrowser = openVendorConfigBrowser;

    async function vendorConfigBrowserCommand(command) {
      if (!window.electronAPI || !window.electronAPI.vendorConfigBrowserCommand) return;
      var result = await window.electronAPI.vendorConfigBrowserCommand(command);
      if (!result || !result.success) {
        if (rightSidebarVendorConfigState) {
          rightSidebarVendorConfigState.error = result && result.error ? result.error : '厂商页面操作失败';
          renderVendorConfigBrowserState();
        }
      }
    }
    window.vendorConfigBrowserCommand = vendorConfigBrowserCommand;

    function closeVendorConfigBrowser() {
      if (window.electronAPI && window.electronAPI.vendorConfigBrowserCommand) {
        window.electronAPI.vendorConfigBrowserCommand('close').catch(function() {});
      }
      rightSidebarVendorConfigState = null;
      rightSidebarTransientTab = '';
      setRightSidebarTab(rightSidebarPreviousTab === 'figures' ? 'figures' : 'article');
    }
    window.closeVendorConfigBrowser = closeVendorConfigBrowser;

    function initVendorConfigBrowserBridge() {
      var host = document.getElementById('vendorConfigBrowserHost');
      if (typeof ResizeObserver === 'function' && host) {
        rightSidebarVendorResizeObserver = new ResizeObserver(function() {
          scheduleVendorConfigBrowserBoundsSync();
        });
        rightSidebarVendorResizeObserver.observe(host);
      }
      if (!window.electronAPI || !window.electronAPI.onVendorConfigBrowserState) return;
      if (window.electronAPI.removeVendorConfigBrowserStateListener) {
        window.electronAPI.removeVendorConfigBrowserStateListener();
      }
      window.electronAPI.onVendorConfigBrowserState(function(state) {
        if (!rightSidebarVendorConfigState || !state) return;
        if (state.providerId && state.providerId !== rightSidebarVendorConfigState.providerId) return;
        Object.assign(rightSidebarVendorConfigState, state);
        renderVendorConfigBrowserState();
      });
    }

    function clampRightSidebarWidth(width) {
      var viewportLimit = Math.max(RIGHT_SIDEBAR_MIN_WIDTH, Math.min(RIGHT_SIDEBAR_MAX_WIDTH, Math.floor(window.innerWidth * 0.72)));
      return Math.max(RIGHT_SIDEBAR_MIN_WIDTH, Math.min(Number(width) || getRightSidebarDefaultWidth(), viewportLimit));
    }

    function applyRightSidebarWidth(width) {
      var rightSidebar = document.querySelector('.right-sidebar');
      if (!rightSidebar) return;
      var nextWidth = clampRightSidebarWidth(width);
      rightSidebar.style.setProperty('--right-sidebar-width', nextWidth + 'px');
      document.documentElement.style.setProperty('--active-right-sidebar-width', nextWidth + 'px');
      // Fixed workflow pages do not participate in the app flex row. Keep
      // their right edge bound to the live sidebar width while it is dragged.
      if (typeof syncPdfWikiMetaSharedComposerRightSidebarLayer === 'function') {
        syncPdfWikiMetaSharedComposerRightSidebarLayer();
      }
    }

    function saveRightSidebarWidth(width) {
      var nextWidth = clampRightSidebarWidth(width);
      try {
        localStorage.setItem(RIGHT_SIDEBAR_WIDTH_KEY, String(nextWidth));
        localStorage.setItem(RIGHT_SIDEBAR_WIDTH_VERSION_KEY, RIGHT_SIDEBAR_WIDTH_VERSION);
        localStorage.setItem(RIGHT_SIDEBAR_CUSTOM_WIDTH_KEY, 'true');
      } catch (e) {}
      applyRightSidebarWidth(nextWidth);
    }

    function initRightSidebarWidth() {
      var initialWidth = getRightSidebarDefaultWidth();
      try {
        var savedVersion = localStorage.getItem(RIGHT_SIDEBAR_WIDTH_VERSION_KEY);
        var customWidth = localStorage.getItem(RIGHT_SIDEBAR_CUSTOM_WIDTH_KEY) === 'true';
        var savedNumber = getSavedRightSidebarWidth();
        if (
          savedVersion === RIGHT_SIDEBAR_WIDTH_VERSION
          && customWidth
          && savedNumber
        ) {
          initialWidth = savedNumber;
        } else {
          clearSavedRightSidebarWidth();
        }
        localStorage.setItem(RIGHT_SIDEBAR_WIDTH_VERSION_KEY, RIGHT_SIDEBAR_WIDTH_VERSION);
      } catch (e) {}
      applyRightSidebarWidth(initialWidth);
    }

    function initRightSidebarResize() {
      var rightSidebar = document.querySelector('.right-sidebar');
      var resizer = document.getElementById('rightSidebarResizer');
      if (!rightSidebar || !resizer) return;
      var resizing = false;
      var startX = 0;
      var startWidth = getRightSidebarDefaultWidth();
      var pointerId = null;

      resizer.addEventListener('pointerdown', function(event) {
        if (event.button !== undefined && event.button !== 0) return;
        resizing = true;
        pointerId = event.pointerId;
        startX = event.clientX;
        startWidth = rightSidebar.getBoundingClientRect().width || 320;
        rightSidebar.classList.add('resizing');
        document.body.classList.add('right-sidebar-resizing');
        document.body.style.cursor = 'col-resize';
        try { resizer.setPointerCapture(pointerId); } catch (e) {}
        event.preventDefault();
      });

      function handleMove(event) {
        if (!resizing || (pointerId !== null && event.pointerId !== pointerId)) return;
        var delta = startX - event.clientX;
        applyRightSidebarWidth(startWidth + delta);
        event.preventDefault();
      }

      function finishResize(event) {
        if (!resizing || (pointerId !== null && event.pointerId !== pointerId)) return;
        resizing = false;
        rightSidebar.classList.remove('resizing');
        document.body.classList.remove('right-sidebar-resizing');
        document.body.style.cursor = '';
        saveRightSidebarWidth(rightSidebar.getBoundingClientRect().width || startWidth);
        try { resizer.releasePointerCapture(pointerId); } catch (e) {}
        pointerId = null;
      }

      resizer.addEventListener('pointermove', handleMove);
      document.addEventListener('pointermove', handleMove);
      resizer.addEventListener('pointerup', finishResize);
      resizer.addEventListener('pointercancel', finishResize);
      document.addEventListener('pointerup', finishResize);
      document.addEventListener('pointercancel', finishResize);
      window.addEventListener('resize', function() {
        // Do not feed the live flex-layout width back into the sidebar. Opening
        // a historical attachment can briefly resize the viewport while its
        // preview iframe is mounted; the old implementation treated that
        // transient, squeezed width as the user's preferred width.
        applyRightSidebarWidth(getPreferredRightSidebarWidth());
      });
    }

    function ensureRightSidebarExpandedWidth() {
      var rightSidebar = document.querySelector('.right-sidebar');
      if (!rightSidebar) return;
      var preferredWidth = getPreferredRightSidebarWidth();
      if (!getSavedRightSidebarWidth() && hasCustomRightSidebarWidth()) {
        clearSavedRightSidebarWidth();
        preferredWidth = getRightSidebarDefaultWidth();
      }
      // Always re-assert the preferred width when a transient panel opens.
      // Historical message restoration and iframe creation may have already
      // completed one layout pass at a narrower measured width.
      applyRightSidebarWidth(preferredWidth);
    }

    function captureMainChatViewportAnchor() {
      var chat = document.getElementById('chatContainer');
      if (!chat || chat.clientHeight <= 0 || chat.getClientRects().length === 0) return null;
      var distanceFromBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
      var chatRect = chat.getBoundingClientRect();
      var anchor = null;
      var messages = chat.querySelectorAll('#messages > .message');
      for (var index = 0; index < messages.length; index += 1) {
        var messageRect = messages[index].getBoundingClientRect();
        if (messageRect.bottom > chatRect.top + 1 && messageRect.top < chatRect.bottom - 1) {
          anchor = messages[index];
          break;
        }
      }
      return {
        chat: chat,
        anchor: anchor,
        anchorOffset: anchor ? anchor.getBoundingClientRect().top - chatRect.top : 0,
        scrollTop: chat.scrollTop,
        followBottom: distanceFromBottom <= 48
      };
    }

    function restoreMainChatViewportAnchor(state) {
      var chat = state && state.chat;
      if (!chat || !chat.isConnected || chat.clientHeight <= 0) return;
      if (state.followBottom) {
        chat.scrollTop = Math.max(0, chat.scrollHeight - chat.clientHeight);
        return;
      }
      if (state.anchor && state.anchor.isConnected) {
        var nextOffset = state.anchor.getBoundingClientRect().top - chat.getBoundingClientRect().top;
        var offsetDelta = nextOffset - Number(state.anchorOffset || 0);
        if (Math.abs(offsetDelta) > 0.5) chat.scrollTop += offsetDelta;
        return;
      }
      chat.scrollTop = Math.min(
        Math.max(0, Number(state.scrollTop || 0)),
        Math.max(0, chat.scrollHeight - chat.clientHeight)
      );
    }

    function scheduleMainChatViewportRestore(state) {
      if (!state) return;
      var remainingLayoutPasses = 3;
      function restoreAfterLayout() {
        restoreMainChatViewportAnchor(state);
        remainingLayoutPasses -= 1;
        if (remainingLayoutPasses > 0) requestAnimationFrame(restoreAfterLayout);
      }
      requestAnimationFrame(restoreAfterLayout);
    }

    function setRightSidebarCollapsed(collapsed, ensureDefaultWidth, options) {
      var rightSidebar = document.querySelector('.right-sidebar');
      var rightToggle = document.querySelector('.history-toggle');
      var themeToggle = document.querySelector('.theme-toggle');
      if (!rightSidebar || !rightToggle) return;
      var mainChatViewportAnchor = captureMainChatViewportAnchor();
      if (collapsed !== true && ensureDefaultWidth) {
        ensureRightSidebarExpandedWidth();
      }
      rightSidebar.classList.toggle('collapsed', collapsed === true);
      document.body.classList.toggle('right-sidebar-collapsed', collapsed === true);
      rightToggle.classList.toggle('collapsed', collapsed === true);
      rightToggle.classList.toggle('history-hidden', collapsed === true);
      if (themeToggle) themeToggle.classList.toggle('history-hidden', collapsed === true);
      localStorage.setItem('scholarclaw_right_sidebar_collapsed', collapsed ? 'true' : 'false');
      syncArticleWritingProgressButtonState();
      syncVendorConfigBrowserVisibility();
      syncPdfWikiOverviewRightSidebarLayer();
      if (typeof hideQueryNavPreview === 'function') hideQueryNavPreview();
      if (collapsed !== true && !(options && options.skipMutualCollapse) && typeof setLeftSidebarCollapsed === 'function') {
        setLeftSidebarCollapsed(true, { skipMutualCollapse: true });
      }
      scheduleMainChatViewportRestore(mainChatViewportAnchor);
    }

    function toggleRightSidebar() {
      var rightSidebar = document.querySelector('.right-sidebar');
      if (!rightSidebar) return;
      var shouldCollapse = !rightSidebar.classList.contains('collapsed');
      setRightSidebarCollapsed(shouldCollapse, !shouldCollapse);
    }
    window.toggleRightSidebar = toggleRightSidebar;
    window.toggleHistorySidebar = toggleRightSidebar;
    
    function initRightSidebar() {
      initRightSidebarWidth();
      var collapsed = localStorage.getItem('scholarclaw_right_sidebar_collapsed');
      if (collapsed === null) collapsed = localStorage.getItem('scholarclaw_history_sidebar_collapsed');
      setRightSidebarCollapsed(collapsed === 'true');
      initRightSidebarResize();
      initVendorConfigBrowserBridge();
    }
    
    initRightSidebar();
    
    // 初始化主题
    initTheme();
    
    function getUserId() {
      // 始终使用 web-user 作为用户 ID，确保记忆共享
      // 不在 New Chat 时创建新用户 ID
      var id = localStorage.getItem(USER_ID_KEY);
      // 如果 id 不存在或者是 chat- 开头（旧格式），强制使用 web-user
      if (!id || id.indexOf('chat-') === 0) {
        id = 'web-user';
        localStorage.setItem(USER_ID_KEY, id);
        console.log('[getUserId] 创建/重置默认用户 ID:', id);
      } else {
        console.log('[getUserId] 使用已有用户 ID:', id);
      }
      return id;
    }

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('shell-navigation', { source: '/app/shell-navigation.js' });
}
