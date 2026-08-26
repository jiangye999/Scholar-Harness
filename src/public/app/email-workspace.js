(function() {
  'use strict';

  var ALL_MAILBOXES_ID = '__all_mailboxes__';

  var state = {
    accounts: [],
    messages: [],
    selectedAccountId: '',
    selectedMessageId: '',
    mailFolder: 'inbox',
    messageFilter: 'all',
    searchQuery: '',
    loadingMessageId: '',
    messageDetailError: '',
    messageDetailRequestId: 0,
    eventSource: null,
    eventSourceUserId: '',
    deleteConfirmId: '',
    replyAttachments: [],
    composeMode: false,
    workspaceView: 'list',
    attachmentRefreshMessageId: '',
    syncStatus: '',
    syncing: false,
    mailboxSummary: { total: 0, unread: 0, read: 0, accounts: [] }
  };

  var emailWikiRuntime = null;
  var emailUnreadTimer = null;
  var emailBackgroundRefreshPromise = null;
  var emailBackgroundListenersInstalled = false;
  var EMAIL_BADGE_POLL_INTERVAL_MS = 30000;
  var EMAIL_LAYOUT_STORAGE_KEY = 'scholar-harness.email-layout.v1';
  var emailColumnResizeCleanup = null;

  var providerCatalog = {
    gmail: {
      label: 'Gmail',
      credential: '16 位应用专用密码',
      url: 'https://myaccount.google.com/apppasswords',
      action: '申请应用专用密码',
      steps: ['开启 Google 两步验证', '打开“应用专用密码”', '创建 Scholar Harness 专用密码']
    },
    outlook: {
      label: 'Outlook / Microsoft 365',
      credential: '应用密码（仅部分账户提供）',
      url: 'https://account.live.com/proofs/manage/additional',
      action: '打开高级安全选项',
      steps: ['开启 Microsoft 两步验证', '在高级安全选项中查找“应用密码”', '若没有该选项，请使用支持 OAuth2 的账户接入方式'],
      notice: 'Outlook.com 当前优先要求 OAuth2。账户未提供应用密码时，请勿填写普通登录密码。'
    },
    qq: {
      label: 'QQ 邮箱',
      credential: 'IMAP/SMTP 授权码',
      url: 'https://mail.qq.com/',
      action: '打开 QQ 邮箱设置',
      steps: ['进入“设置 → 账号”', '开启 IMAP/SMTP 服务', '完成安全验证并复制授权码']
    },
    '163': {
      label: '网易 163 邮箱',
      credential: '客户端授权密码',
      url: 'https://email.163.com/',
      action: '打开网易邮箱设置',
      steps: ['进入“设置 → POP3/SMTP/IMAP”', '开启 IMAP/SMTP 服务', '点击“新增授权密码”并复制']
    },
    school: {
      label: '学校邮箱',
      credential: '学校邮箱密码或客户端授权码',
      url: '',
      action: '',
      steps: ['填写完整学校邮箱地址', '系统从学校域名生成 IMAP/SMTP 推荐配置', '核对学校说明后连接验证；推荐值可手动修改'],
      notice: '高校邮箱服务器并非完全统一；系统会优先生成 mail.<学校域名>:993 与 smtp.<学校域名>:465，并以真实连接结果为准。'
    },
    custom: {
      label: '其他 IMAP 邮箱',
      credential: '服务商提供的客户端密码',
      url: '',
      action: '',
      steps: ['向邮箱服务商确认 IMAP/SMTP 已开启', '获取应用密码或客户端授权码', '填写收件与发件服务器和加密端口']
    }
  };

  function userId() {
    return typeof currentUserId !== 'undefined' && currentUserId ? currentUserId : 'web-user';
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeEmailBodyUrl(value) {
    try {
      var parsed = new URL(String(value || ''));
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch (_) {
      return '';
    }
  }

  function linkifyEmailBody(value) {
    var text = String(value == null ? '' : value);
    var urlPattern = /https?:\/\/[^\s<>"']+/gi;
    var html = '';
    var cursor = 0;
    var match;
    while ((match = urlPattern.exec(text)) !== null) {
      var rawUrl = match[0];
      var visibleUrl = rawUrl.replace(/[),.;!?\]}>，。；！？”’]+$/g, '');
      var trailingText = rawUrl.slice(visibleUrl.length);
      var safeUrl = safeEmailBodyUrl(visibleUrl);
      html += esc(text.slice(cursor, match.index));
      if (safeUrl) {
        html += '<a href="' + esc(safeUrl) + '" target="_blank" rel="noopener noreferrer" onclick="return openEmailBodyLink(event,this)">' + esc(visibleUrl) + '</a>';
      } else {
        html += esc(visibleUrl);
      }
      html += esc(trailingText);
      cursor = match.index + rawUrl.length;
    }
    return html + esc(text.slice(cursor));
  }

  function openEmailBodyLink(event, anchor) {
    var safeUrl = safeEmailBodyUrl(anchor && anchor.getAttribute('href'));
    if (event) event.preventDefault();
    if (!safeUrl) return false;
    if (typeof window.openExternalUrl === 'function') window.openExternalUrl(safeUrl);
    else window.open(safeUrl, '_blank', 'noopener,noreferrer');
    return false;
  }

  async function jsonFetch(url, options) {
    var requestOptions = Object.assign({}, options || {});
    var timeoutMs = Math.max(0, Number(requestOptions.timeoutMs || 0));
    delete requestOptions.timeoutMs;
    var timeoutId = null;
    var controller = null;
    if (timeoutMs > 0 && typeof AbortController === 'function' && !requestOptions.signal) {
      controller = new AbortController();
      requestOptions.signal = controller.signal;
      timeoutId = window.setTimeout(function() { controller.abort(); }, timeoutMs);
    }
    try {
      var response = await fetch(url, requestOptions);
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok || data.success === false) {
        throw new Error(data && data.error && data.error.message ? data.error.message : ('请求失败（HTTP ' + response.status + '）'));
      }
      return data;
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new Error('读取邮件正文超时。请检查邮箱网络连接后重试。');
      }
      throw error;
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  }

  function mailboxMarkup() {
    return '<div class="email-workspace" id="emailWorkspace">' +
      '<aside class="email-left-rail" aria-label="邮箱账户与收件箱">' +
        '<section class="email-pane email-account-pane">' +
          '<div class="email-pane-head email-account-head"><span class="email-pane-title">邮箱</span><span class="email-pane-kicker">账户与文件夹</span></div>' +
          '<nav class="email-folder-tabs" id="emailFolderTabs" role="group" aria-label="邮箱夹"><button type="button" class="email-folder-button active" data-folder="inbox" aria-pressed="true" onclick="setEmailFolder(\'inbox\')"><span class="email-folder-icon" aria-hidden="true">▣</span><span>收件箱</span></button><button type="button" class="email-folder-button" data-folder="drafts" aria-pressed="false" onclick="setEmailFolder(\'drafts\')"><span class="email-folder-icon" aria-hidden="true">▤</span><span>草稿箱</span></button><button type="button" class="email-folder-button" data-folder="sent" aria-pressed="false" onclick="setEmailFolder(\'sent\')"><span class="email-folder-icon" aria-hidden="true">➤</span><span>已发送</span></button></nav>' +
          '<div class="email-account-section-label">邮箱账户</div>' +
          '<div class="email-inline-status email-account-list-status" id="emailAccountListStatus"></div>' +
          '<div class="email-account-list" id="emailAccountList"><div class="email-empty">正在读取邮箱账户…</div></div>' +
        '</section>' +
        '<div class="email-column-resizer" data-resize="email-account" role="separator" aria-label="调整邮箱账户栏宽度" aria-orientation="vertical" tabindex="0" onpointerdown="startEmailColumnResize(event,\'account\')" onkeydown="nudgeEmailColumnWidth(event,\'account\')"></div>' +
        '<section class="email-pane email-inbox-pane">' +
          '<div class="email-pane-head email-inbox-head"><div class="email-inbox-topbar"><div class="email-inbox-heading"><span class="email-pane-title" id="emailFolderTitle">收件箱</span><span class="email-list-count" id="emailVisibleCount">0 封</span></div><div class="email-list-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16.2 16.2 4 4"></path></svg><input id="emailMessageSearch" type="search" autocomplete="off" placeholder="搜索发件人、主题或正文摘要" aria-label="搜索当前邮箱夹" oninput="setEmailSearchQuery(this.value)"><button type="button" class="email-search-clear" id="emailSearchClear" onclick="clearEmailSearch()" aria-label="清空邮件搜索" hidden>×</button></div><button type="button" class="email-compose-button email-list-compose" onclick="startNewEmailCompose()">写邮件</button></div></div>' +
          '<div class="email-visually-hidden" id="emailMessageSummary" aria-live="polite"></div>' +
          '<div class="email-message-list" id="emailMessageList"><div class="email-empty">添加并选择邮箱后查看来信。</div></div>' +
        '</section>' +
      '</aside>' +
      '<section class="email-pane email-detail-pane" hidden>' +
        '<div class="email-pane-head email-detail-head"><h2 class="email-detail-subject email-detail-header-subject" id="emailDetailHeaderSubject">邮件与 AI 回复草稿</h2><button id="emailDetailCloseBtn" type="button" class="lit-btn" style="width:auto;margin:0;padding:8px 12px;" onclick="showEmailInboxList()">关闭</button></div>' +
        '<div class="email-detail-header-meta" id="emailDetailHeaderMeta"></div>' +
        '<div class="email-detail" id="emailMessageDetail"><div class="email-empty">选择一封邮件查看正文；点击“生成回复草稿”后，AI 才会读取当前邮件。</div></div>' +
      '</section>' +
    '</div>';
  }

  function readEmailLayoutPreference() {
    try {
      var parsed = JSON.parse(window.localStorage.getItem(EMAIL_LAYOUT_STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeEmailLayoutPreference(preference) {
    try {
      window.localStorage.setItem(EMAIL_LAYOUT_STORAGE_KEY, JSON.stringify(preference || {}));
    } catch (_) {}
  }

  function restoreEmailColumnWidths() {
    var workspace = document.getElementById('emailWorkspace');
    if (!workspace) return;
    var preference = readEmailLayoutPreference();
    var accountWidth = Number(preference.accountWidth);
    if (Number.isFinite(accountWidth) && accountWidth >= 150 && accountWidth <= 360) {
      workspace.style.setProperty('--email-account-width', Math.round(accountWidth) + 'px');
    }
  }

  function updateEmailColumnWidth(kind, clientX, shouldSave) {
    var workspace = document.getElementById('emailWorkspace');
    var leftRail = workspace && workspace.querySelector('.email-left-rail');
    if (!workspace || !leftRail || kind !== 'account') return;
    var preference = readEmailLayoutPreference();
    var railRect = leftRail.getBoundingClientRect();
    var maximumAccountWidth = Math.max(150, railRect.width - 346);
    var accountWidth = Math.max(150, Math.min(maximumAccountWidth, clientX - railRect.left));
    workspace.style.setProperty('--email-account-width', Math.round(accountWidth) + 'px');
    preference.accountWidth = Math.round(accountWidth);
    if (shouldSave) writeEmailLayoutPreference(preference);
  }

  function setEmailWorkspaceView(view) {
    var workspace = document.getElementById('emailWorkspace');
    var utilityPage = workspace && workspace.closest('#homeUtilityPage[data-page-id="email"]');
    var utilityHeader = utilityPage && utilityPage.querySelector('.home-utility-shell > .home-utility-header');
    var list = workspace && workspace.querySelector('.email-left-rail');
    var detail = workspace && workspace.querySelector('.email-detail-pane');
    if (!workspace || !list || !detail) return;
    state.workspaceView = view === 'detail' ? 'detail' : 'list';
    var detailActive = state.workspaceView === 'detail';
    workspace.classList.toggle('email-detail-view', detailActive);
    workspace.classList.toggle('email-list-view', !detailActive);
    if (utilityPage) utilityPage.classList.toggle('email-detail-active', detailActive);
    if (utilityHeader) utilityHeader.hidden = detailActive;
    list.hidden = detailActive;
    detail.hidden = !detailActive;
    syncEmailFolderControls();
    if (!detailActive) {
      window.requestAnimationFrame(function() {
        var selected = document.querySelector('.email-message-card.active');
        if (selected) selected.scrollIntoView({ block: 'nearest' });
      });
    }
  }

  function showEmailInboxList() {
    setEmailWorkspaceView('list');
  }

  function startEmailColumnResize(event, kind) {
    if (!event || event.button !== 0) return;
    event.preventDefault();
    if (emailColumnResizeCleanup) emailColumnResizeCleanup();
    var separator = event.currentTarget;
    separator.classList.add('active');
    document.body.classList.add('email-column-resizing');
    var move = function(pointerEvent) {
      updateEmailColumnWidth(kind, pointerEvent.clientX, false);
    };
    var stop = function(pointerEvent) {
      updateEmailColumnWidth(kind, pointerEvent.clientX, true);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      separator.classList.remove('active');
      document.body.classList.remove('email-column-resizing');
      emailColumnResizeCleanup = null;
    };
    emailColumnResizeCleanup = function() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      separator.classList.remove('active');
      document.body.classList.remove('email-column-resizing');
      emailColumnResizeCleanup = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  function nudgeEmailColumnWidth(event, kind) {
    if (!event || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    var separator = event.currentTarget;
    var separatorRect = separator.getBoundingClientRect();
    var step = event.shiftKey ? 32 : 12;
    var clientX = separatorRect.left + (event.key === 'ArrowRight' ? step : -step);
    updateEmailColumnWidth(kind, clientX, true);
  }

  function emailWikiMarkup() {
    return '<div class="email-wiki-shell" id="emailWikiShell">' +
      '<div class="email-wiki-toolbar">' +
        '<div class="email-wiki-heading"><strong>全部邮箱邮件 Wiki</strong><span class="email-wiki-badge">网状图</span><span class="email-wiki-live"><i></i>持续动态</span><span id="emailWikiCounts">正在构建本地关系图…</span></div>' +
        '<div class="email-wiki-actions">' +
          '<details class="email-wiki-control" data-control-group="motion" ontoggle="handleEmailWikiControlToggle(this)">' +
            '<summary aria-label="选择邮件网状图动效"><i class="motion"></i><span id="emailWikiMotionSummary">律动</span><b></b></summary>' +
            '<div class="email-wiki-control-menu" role="group" aria-label="律动">' +
              '<button type="button" data-motion-effect="wave" aria-pressed="false" onclick="selectEmailWikiMotion(\'wave\')">波浪</button>' +
              '<button type="button" data-motion-effect="vortex" aria-pressed="false" onclick="selectEmailWikiMotion(\'vortex\')">旋涡</button>' +
              '<button type="button" data-motion-effect="breathe" aria-pressed="false" onclick="selectEmailWikiMotion(\'breathe\')">呼吸</button>' +
              '<button type="button" data-motion-effect="voice" aria-pressed="false" onclick="selectEmailWikiMotion(\'voice\')">声浪</button>' +
            '</div>' +
          '</details>' +
          '<details class="email-wiki-control" data-control-group="shape" ontoggle="handleEmailWikiControlToggle(this)">' +
            '<summary aria-label="选择邮件网状图形状"><i class="shape"></i><span id="emailWikiShapeSummary">形状 · 圆形</span><b></b></summary>' +
            '<div class="email-wiki-control-menu" role="group" aria-label="形状">' +
              '<button type="button" data-shape-effect="circle" aria-pressed="true" class="active" onclick="selectEmailWikiShape(\'circle\')">圆形</button>' +
              '<button type="button" data-shape-effect="blackhole" aria-pressed="false" onclick="selectEmailWikiShape(\'blackhole\')">黑洞</button>' +
              '<button type="button" data-shape-effect="saturn" aria-pressed="false" onclick="selectEmailWikiShape(\'saturn\')">土星</button>' +
              '<button type="button" data-shape-effect="galaxy" aria-pressed="false" onclick="selectEmailWikiShape(\'galaxy\')">银河系</button>' +
              '<button type="button" data-shape-effect="starfield" aria-pressed="false" onclick="selectEmailWikiShape(\'starfield\')">星空</button>' +
              '<button type="button" data-shape-effect="starrynight" aria-pressed="false" onclick="selectEmailWikiShape(\'starrynight\')">星月夜</button>' +
              '<button type="button" data-shape-effect="painted-eye" aria-pressed="false" onclick="selectEmailWikiShape(\'painted-eye\')">油画之眼</button>' +
              '<button type="button" data-shape-effect="cubist-face" aria-pressed="false" onclick="selectEmailWikiShape(\'cubist-face\')">抽象人像</button>' +
            '</div>' +
          '</details>' +
          '<details class="email-wiki-control" data-control-group="color" ontoggle="handleEmailWikiControlToggle(this)">' +
            '<summary aria-label="选择邮件网状图节点配色"><i class="color"></i><span id="emailWikiColorSummary">配色 · 原始</span><b></b></summary>' +
            '<div class="email-wiki-control-menu" role="group" aria-label="节点配色">' +
              '<button type="button" data-color-palette="original" aria-pressed="true" class="active" onclick="selectEmailWikiColorPalette(\'original\')">原始配色</button>' +
              '<button type="button" data-color-palette="ice" aria-pressed="false" onclick="selectEmailWikiColorPalette(\'ice\')">冰蓝</button>' +
              '<button type="button" data-color-palette="nebula" aria-pressed="false" onclick="selectEmailWikiColorPalette(\'nebula\')">星云紫</button>' +
              '<button type="button" data-color-palette="gold" aria-pressed="false" onclick="selectEmailWikiColorPalette(\'gold\')">暖金</button>' +
              '<button type="button" data-color-palette="emerald" aria-pressed="false" onclick="selectEmailWikiColorPalette(\'emerald\')">翡翠</button>' +
            '</div>' +
          '</details>' +
          '<button type="button" class="email-wiki-action-button" onclick="restartEmailWikiGraph()">重新布局</button>' +
          '<button type="button" class="email-wiki-action-button" onclick="fitEmailWikiGraph()">适应画布</button>' +
        '</div>' +
        '<div class="email-wiki-legend"><span><i class="account"></i>账户</span><span><i class="sender"></i>发件人</span><span><i class="message"></i>邮件</span><span><i class="keyword"></i>关键词</span></div>' +
      '</div>' +
      '<div class="email-wiki-stage">' +
        '<div class="email-wiki-canvas-wrap"><canvas id="emailWikiCanvas" aria-label="邮箱邮件关系网状图"></canvas><div class="email-wiki-help">滚轮缩放 · 拖动平移 · 点击节点固定详情 · 双击邮件回到正文</div></div>' +
        '<aside class="email-wiki-detail" id="emailWikiDetail"><div class="email-wiki-empty"><strong>悬停预览，点击固定</strong><span>图谱在本机从全部已同步邮箱生成，不会把邮件正文上传到第三方图谱服务。</span></div></aside>' +
      '</div>' +
    '</div>';
  }

  function providerGuideMarkup(providerId) {
    var provider = providerCatalog[providerId];
    var action = provider.url
      ? '<button type="button" class="email-button email-provider-link" onclick="openEmailProviderAuthorization(\'' + esc(providerId) + '\')">' + esc(provider.action) + '<span aria-hidden="true">↗</span></button>'
      : '<span class="email-security-note">请查看邮箱服务商帮助中心</span>';
    return '<article class="email-provider-guide" data-provider="' + esc(providerId) + '">' +
      '<div class="email-provider-guide-head"><div><strong>' + esc(provider.label) + '</strong><span>' + esc(provider.credential) + '</span></div>' + action + '</div>' +
      '<ol>' + provider.steps.map(function(step) { return '<li>' + esc(step) + '</li>'; }).join('') + '</ol>' +
      (provider.notice ? '<div class="email-provider-notice">' + esc(provider.notice) + '</div>' : '') +
      '<button type="button" class="email-provider-choose" onclick="chooseEmailProvider(\'' + esc(providerId) + '\')">配置此平台</button>' +
    '</article>';
  }

  function settingsMarkup() {
    return '<div class="email-settings-page" id="emailSettingsPage">' +
      '<section class="email-settings-guides" aria-labelledby="emailProviderGuideTitle">' +
        '<div class="email-settings-section-head"><div><h2 id="emailProviderGuideTitle">先获取专用密码</h2><p>点击邮箱平台后直达官方页面，完成最少步骤再回来连接。</p></div></div>' +
        '<div class="email-provider-grid">' + ['gmail', 'outlook', 'qq', '163', 'school'].map(providerGuideMarkup).join('') + '</div>' +
      '</section>' +
      '<div class="email-settings-columns">' +
        '<section class="email-settings-card email-connect-card">' +
          '<div class="email-settings-section-head"><div><h2>连接邮箱</h2><p>普通邮箱登录密码不能代替授权码。</p></div></div>' +
          '<div class="email-form-grid">' +
            '<div class="email-field"><label for="emailProvider">邮箱平台</label><select id="emailProvider" onchange="syncEmailProviderFields()"><option value="gmail">Gmail</option><option value="outlook">Outlook / Microsoft 365</option><option value="qq">QQ 邮箱</option><option value="163">网易 163 邮箱</option><option value="school">学校邮箱</option><option value="custom">其他 IMAP 邮箱</option></select></div>' +
            '<div class="email-field"><label for="emailDisplayName">账户名称</label><input id="emailDisplayName" placeholder="例如：工作邮箱"></div>' +
            '<div class="email-field"><label for="emailAddress">邮箱地址</label><input id="emailAddress" type="email" autocomplete="username" placeholder="name@example.com" oninput="syncSchoolEmailSettings(false)"></div>' +
            '<div class="email-field"><label for="emailCredential">授权码 / 应用专用密码</label><input id="emailCredential" type="password" autocomplete="new-password" placeholder="仅在本机加密保存"></div>' +
            '<div class="email-school-settings" id="emailSchoolSettings" hidden>' +
              '<div class="email-field"><label for="emailSchoolDomain">学校邮箱域名</label><input id="emailSchoolDomain" placeholder="例如：cau.edu.cn" oninput="syncSchoolEmailSettings(true)"><small>会从完整邮箱地址自动识别；这里填写域名，不填写学校中文名称。</small></div>' +
            '</div>' +
            '<div class="email-custom-settings" id="emailCustomSettings" hidden>' +
              '<div class="email-field"><label for="emailImapHost">IMAP 服务器</label><input id="emailImapHost" placeholder="imap.example.com"></div>' +
              '<div class="email-field"><label for="emailImapPort">TLS 端口</label><input id="emailImapPort" type="number" value="993" min="1" max="65535"></div>' +
              '<div class="email-field"><label for="emailSmtpHost">SMTP 服务器</label><input id="emailSmtpHost" placeholder="smtp.example.com"></div>' +
              '<div class="email-field"><label for="emailSmtpPort">SSL/TLS 端口</label><input id="emailSmtpPort" type="number" value="465" min="1" max="65535"></div>' +
              '<label class="email-consent email-smtp-secure"><input id="emailSmtpSecure" type="checkbox" checked><span>SMTP 使用直接 SSL/TLS（465）；使用 STARTTLS（587）时取消勾选。</span></label>' +
            '</div>' +
          '</div>' +
          '<div class="email-security-note email-local-security">凭据仅在本机加密保存，不会发送给 AI。连接时验证 IMAP 登录；发送回复时使用同一授权码连接 SMTP。</div>' +
          '<div class="email-inline-status" id="emailAccountStatus"></div>' +
          '<div class="email-form-actions"><button class="email-button primary" id="emailAddButton" type="button" onclick="addEmailAccount()">连接并添加</button></div>' +
        '</section>' +
        '<section class="email-settings-card email-managed-accounts">' +
          '<div class="email-settings-section-head"><div><h2>已连接账户</h2><p>移除账户会同时删除该账户的本地邮件缓存。</p></div><button class="email-button danger" id="emailRemoveAccountButton" type="button" onclick="removeSelectedEmailAccount()" disabled>移除</button></div>' +
          '<div class="email-inline-status email-account-list-status" id="emailAccountListStatus"></div>' +
          '<div class="email-account-list" id="emailAccountList"><div class="email-empty">正在读取邮箱账户…</div></div>' +
        '</section>' +
      '</div>' +
    '</div>';
  }

  function selectedAccount() {
    return state.accounts.find(function(item) { return item.id === state.selectedAccountId; }) || null;
  }

  function selectedMessage() {
    return state.messages.find(function(item) { return item.id === state.selectedMessageId; }) || null;
  }

  function emailAddressFrom(value) {
    var text = String(value || '');
    var bracket = text.match(/<([^<>\s]+@[^<>\s]+)>/);
    var plain = text.match(/[^\s<>,;]+@[^\s<>,;]+/);
    return String((bracket && bracket[1]) || (plain && plain[0]) || '').trim().toLowerCase();
  }

  function replySubject(value) {
    var subject = String(value || '（无主题）').trim();
    return /^re\s*:/i.test(subject) ? subject : 'Re: ' + subject;
  }

  function formatEmailFileSize(value) {
    var bytes = Math.max(0, Number(value || 0));
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
  }

  function emailAttachmentFileIcon(fileName) {
    var value = String(fileName || '');
    var match = value.toLowerCase().match(/\.([a-z0-9]+)$/);
    var ext = match ? match[1] : '';
    var label = 'FILE';
    var color = '#77746c';
    var light = '#f4f3ef';
    if (ext === 'pdf') {
      label = 'PDF'; color = '#d93025'; light = '#fff1f0';
    } else if (/^(doc|docx)$/.test(ext)) {
      label = 'DOC'; color = '#2563eb'; light = '#eef4ff';
    } else if (/^(xls|xlsx|csv|tsv)$/.test(ext)) {
      label = ext === 'csv' || ext === 'tsv' ? 'CSV' : 'XLS'; color = '#188038'; light = '#edf7ed';
    } else if (/^(ppt|pptx)$/.test(ext)) {
      label = 'PPT'; color = '#c2410c'; light = '#fff3ed';
    } else if (/^(png|jpg|jpeg|gif|webp|svg|bmp|tif|tiff)$/.test(ext)) {
      label = 'IMG'; color = '#7c3aed'; light = '#f4efff';
    } else if (/^(zip|rar|7z|tar|gz)$/.test(ext)) {
      label = 'ZIP'; color = '#8a5a00'; light = '#fff7dc';
    } else if (/^(txt|md|markdown|html|htm)$/.test(ext)) {
      label = 'TXT'; color = '#5f6368'; light = '#f4f4f4';
    } else if (/^(r|rmd|py|js|mjs|cjs|ts|tsx|jsx|css|json|yaml|yml|xml|tex|latex)$/.test(ext)) {
      label = ext ? ext.toUpperCase().slice(0, 3) : 'CODE'; color = '#2b6cb0'; light = '#edf4ff';
    }
    return '<svg class="email-filetype-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M6 2.8h8.4L19 7.4v13.1c0 .9-.7 1.7-1.7 1.7H6.7c-.9 0-1.7-.7-1.7-1.7v-16c0-.9.7-1.7 1.7-1.7z" fill="' + light + '" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round"></path>' +
      '<path d="M14.2 2.9v4.7H19" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round"></path>' +
      '<rect x="4.2" y="11" width="15.6" height="7.2" rx="1.5" fill="' + color + '"></rect>' +
      '<text x="12" y="14.85" font-size="' + (label.length > 3 ? '4.2' : '4.8') + '" fill="#fff">' + label + '</text>' +
    '</svg>';
  }

  function incomingAttachmentsMarkup(message) {
    var attachments = Array.isArray(message && message.attachments) ? message.attachments : [];
    if (!attachments.length) return '';
    return '<section class="email-incoming-attachments" aria-label="邮件附件">' +
      '<div class="email-incoming-attachment-list">' + attachments.map(function(attachment) {
        var available = attachment.available !== false && attachment.previewPath;
        var common = ' data-file-path="' + esc(attachment.previewPath || '') + '"' +
          ' data-preview-url="' + esc(attachment.previewPath || '') + '"' +
          ' data-file-name="' + esc(attachment.filename || '附件') + '"' +
          ' data-file-kind="file"' +
          ' data-workspace-root="' + esc(attachment.previewRoot || '') + '"' +
          ' data-message-id="' + esc(message.id || '') + '"' +
          ' data-account-id="' + esc(message.accountId || '') + '"' +
          ' data-attachment-id="' + esc(attachment.id || '') + '"';
        if (!available) {
          var pending = !attachment.error || String(attachment.error).indexOf('后台准备') >= 0;
          return '<div class="email-incoming-attachment unavailable' + (pending ? ' is-pending' : '') + '" role="button" tabindex="0"' + common +
            ' onclick="openEmailAttachmentPreview(this,event)" onkeydown="handleEmailAttachmentPreviewKeydown(this,event)" title="' + esc(pending ? '点击后等待附件准备完成并打开' : (attachment.error || '附件暂不可用')) + '">' +
            '<span class="email-attachment-icon">' + emailAttachmentFileIcon(attachment.filename) + '</span><span class="email-attachment-copy"><strong>' + esc(attachment.filename || '附件') + '</strong><small>' + esc(formatEmailFileSize(attachment.size)) + ' · ' + esc(attachment.error || '暂不可预览') + '</small></span>' +
          '</div>';
        }
        var downloadUrl = '/api/email/messages/' + encodeURIComponent(message.id) + '/attachments/' + encodeURIComponent(attachment.id) + '/download' +
          '?userId=' + encodeURIComponent(userId()) + '&accountId=' + encodeURIComponent(message.accountId);
        return '<div class="email-incoming-attachment" role="button" tabindex="0"' + common + ' onclick="openEmailAttachmentPreview(this,event)" onkeydown="handleEmailAttachmentPreviewKeydown(this,event)" title="点击在右侧边栏查看 ' + esc(attachment.filename || '附件') + '">' +
          '<span class="email-attachment-icon">' + emailAttachmentFileIcon(attachment.filename) + '</span><span class="email-attachment-copy"><strong>' + esc(attachment.filename || '附件') + '</strong><small>' + esc(formatEmailFileSize(attachment.size)) + ' · ' + esc(attachment.contentType || '文件') + '</small></span>' +
          '<span class="email-incoming-attachment-actions"><button type="button" class="email-attachment-action email-attachment-view"' + common + ' onclick="openEmailAttachmentPreview(this,event)">查看</button><a class="email-attachment-action email-attachment-download" href="' + esc(downloadUrl) + '" download="' + esc(attachment.filename || '附件') + '" onclick="event.stopPropagation()">下载</a></span>' +
        '</div>';
      }).join('') + '</div>' +
    '</section>';
  }

  function replyAttachmentsMarkup() {
    if (!state.replyAttachments.length) {
      return '<div class="email-reply-attachment-empty">尚未添加附件</div>';
    }
    return state.replyAttachments.map(function(item) {
      return '<div class="email-reply-attachment-chip"><span><strong>' + esc(item.file.name || '附件') + '</strong><small>' + esc(formatEmailFileSize(item.file.size)) + '</small></span>' +
        '<button type="button" onclick="removeEmailReplyAttachment(\'' + esc(item.id) + '\')" aria-label="移除附件 ' + esc(item.file.name || '') + '">×</button></div>';
    }).join('');
  }

  function statusLabel(account) {
    if (account.connectionStatus === 'connected') return '已连接';
    if (account.connectionStatus === 'connecting') return '正在连接';
    if (account.connectionStatus === 'error') return account.error || '连接异常，将自动重试';
    return '未连接';
  }

  function accountUnreadCount(accountId) {
    var accounts = state.mailboxSummary && Array.isArray(state.mailboxSummary.accounts)
      ? state.mailboxSummary.accounts
      : [];
    var summary = accounts.find(function(item) { return item.accountId === accountId; });
    return Math.max(0, Number(summary && summary.unread || 0));
  }

  function unreadBadgeLabel(unread) {
    return unread > 99 ? '99+' : String(unread);
  }

  function syncEmailAccountUnreadBadges() {
    document.querySelectorAll('[data-email-account-unread]').forEach(function(badge) {
      var unread = accountUnreadCount(badge.getAttribute('data-email-account-unread') || '');
      badge.hidden = unread < 1;
      badge.textContent = unreadBadgeLabel(unread);
      badge.title = unread ? (unread + ' 封未读邮件') : '';
      badge.setAttribute('aria-label', unread ? (unread + ' 封未读邮件') : '没有未读邮件');
    });
  }

  function renderAccounts() {
    var host = document.getElementById('emailAccountList');
    if (!host) return;
    if (!state.accounts.length) {
      host.innerHTML = '<div class="email-empty">还没有已连接邮箱。请点击“邮件”标题右侧的齿轮完成配置。</div>';
      return;
    }
    var allSelected = state.selectedAccountId === ALL_MAILBOXES_ID;
    var allCard = '<button type="button" class="email-account-card email-account-all' + (allSelected ? ' active' : '') + '" aria-pressed="' + (allSelected ? 'true' : 'false') + '" onclick="selectEmailAccount(\'' + ALL_MAILBOXES_ID + '\')">' +
      '<div class="email-account-details"><div class="email-account-name">全部邮箱<span class="email-account-inline-count"><span aria-hidden="true">·</span><strong>' + state.accounts.length + '</strong></span></div></div></button>';
    host.innerHTML = allCard + state.accounts.map(function(account) {
      var provider = providerCatalog[account.provider] || providerCatalog.custom;
      var selected = account.id === state.selectedAccountId;
      var connected = account.connectionStatus === 'connected';
      var unread = accountUnreadCount(account.id);
      return '<button type="button" class="email-account-card' + (selected ? ' active' : '') + '" aria-pressed="' + (selected ? 'true' : 'false') + '" onclick="selectEmailAccount(\'' + esc(account.id) + '\')">' +
        '<span class="email-account-provider-row"><span class="email-account-provider">' + esc(provider.label) + '</span>' +
          '<span class="email-account-provider-unread" data-email-account-unread="' + esc(account.id) + '" title="' + (unread ? esc(unread + ' 封未读邮件') : '') + '" aria-label="' + (unread ? esc(unread + ' 封未读邮件') : '没有未读邮件') + '"' + (unread ? '' : ' hidden') + '>' + unreadBadgeLabel(unread) + '</span></span>' +
        '<div class="email-account-details">' +
          '<div class="email-account-name"><span class="email-status-dot ' + esc(account.connectionStatus) + '"></span><span>' + esc(account.displayName || account.email) + '</span></div>' +
          '<div class="email-account-email">' + esc(account.email) + '</div>' +
        '</div>' +
        (connected ? '' : '<div class="email-status-row"><span>' + esc(statusLabel(account)) + '</span></div>') +
      '</button>';
    }).join('');
  }

  function emailFolderLabel(folder) {
    if (folder === 'drafts') return '草稿箱';
    if (folder === 'sent') return '已发送';
    return '收件箱';
  }

  function syncEmailFolderControls() {
    var isInbox = state.mailFolder === 'inbox' && state.workspaceView !== 'detail';
    var filters = document.getElementById('emailReadFilters');
    var markAllButton = document.getElementById('emailMarkAllReadButton');
    document.querySelectorAll('.email-folder-button').forEach(function(button) {
      var selected = button.getAttribute('data-folder') === state.mailFolder;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    if (filters) filters.hidden = !isInbox;
    if (markAllButton) markAllButton.hidden = !isInbox;
  }

  async function setEmailFolder(folder) {
    var nextFolder = ['inbox', 'drafts', 'sent'].indexOf(folder) >= 0 ? folder : 'inbox';
    if (state.mailFolder === nextFolder) return;
    state.mailFolder = nextFolder;
    state.messageFilter = 'all';
    state.selectedMessageId = '';
    state.composeMode = false;
    state.loadingMessageId = '';
    state.messageDetailError = '';
    state.syncStatus = '';
    state.searchQuery = '';
    state.workspaceView = 'list';
    syncEmailSearchControls();
    syncEmailFolderControls();
    setEmailWorkspaceView('list');
    setEmailMessageFilter('all');
    await loadMessages();
    syncSelectedEmailAccount().catch(function() {});
  }

  function renderMessages() {
    var host = document.getElementById('emailMessageList');
    if (!host) return;
    if (!state.selectedAccountId) {
      host.innerHTML = '<div class="email-empty">请选择邮箱账户。</div>';
      renderMessageSummary(0);
      return;
    }
    syncEmailFolderControls();
    if (!state.messages.length) {
      host.innerHTML = '<div class="email-empty">' + esc(emailFolderLabel(state.mailFolder)) + '暂无已同步邮件。点击刷新可从邮箱服务器读取。</div>';
      renderMessageSummary(0);
      return;
    }
    var visibleMessages = state.messages.filter(function(message) {
      if (state.mailFolder !== 'inbox') return true;
      if (state.messageFilter === 'unread') return !message.seen;
      if (state.messageFilter === 'read') return !!message.seen;
      return true;
    }).filter(function(message) {
      var query = String(state.searchQuery || '').trim().toLocaleLowerCase();
      if (!query) return true;
      return [message.from, message.to, message.subject, message.snippet, message.text]
        .some(function(value) { return String(value || '').toLocaleLowerCase().indexOf(query) >= 0; });
    });
    renderMessageSummary(visibleMessages.length);
    if (!visibleMessages.length) {
      host.innerHTML = '<div class="email-empty">当前筛选条件下没有邮件。</div>';
      return;
    }
    host.innerHTML = visibleMessages.map(function(message) {
      var parsedDate = message.date ? new Date(message.date) : null;
      var date = parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
        : '';
      var party = state.mailFolder === 'inbox' ? (message.from || '未知发件人') : ('收件人：' + (message.to || '未填写'));
      var unreadDot = state.mailFolder === 'inbox' ? '<span class="email-unread-dot' + (message.seen ? ' is-read' : '') + '" aria-label="' + (message.seen ? '已读' : '未读') + '"></span>' : '';
      var unreadBadge = state.mailFolder === 'inbox' && !message.seen
        ? '<span class="email-message-unread-pill" aria-label="未读邮件">未读</span>'
        : '';
      var hasAttachment = Array.isArray(message.attachments) && message.attachments.length > 0;
      return '<button type="button" class="email-message-card' + (!message.seen && state.mailFolder === 'inbox' ? ' unread' : '') + (message.id === state.selectedMessageId ? ' active' : '') + '" onclick="selectEmailMessage(\'' + esc(message.id) + '\')">' +
        '<span class="email-message-state">' + unreadDot + '</span>' +
        '<span class="email-message-party">' + esc(party) + '</span>' +
        '<span class="email-message-copy"><strong class="email-message-subject">' + esc(message.subject || '（无主题）') + '</strong><span class="email-message-snippet">' + esc(message.snippet || '') + '</span></span>' +
        '<span class="email-message-attachment" aria-label="' + (hasAttachment ? '包含附件' : '无附件') + '">' + (hasAttachment ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m20.5 11.5-8.7 8.7a5.7 5.7 0 0 1-8-8l9.1-9.1a3.8 3.8 0 0 1 5.4 5.4l-9.1 9.1a1.9 1.9 0 1 1-2.7-2.7l8.5-8.5"></path></svg>' : '') + '</span>' +
        '<span class="email-message-date-slot">' + unreadBadge + '<time class="email-message-date" datetime="' + esc(message.date || '') + '">' + esc(date) + '</time></span>' +
      '</button>';
    }).join('');
  }

  function renderMessageSummary(visibleCount) {
    var host = document.getElementById('emailMessageSummary');
    var unread = state.messages.filter(function(message) { return !message.seen; }).length;
    var read = state.messages.length - unread;
    var summary = state.mailFolder === 'inbox'
      ? ('显示 ' + Number(visibleCount || 0) + ' 封 · 全部 ' + state.messages.length + ' · 未读 ' + unread + ' · 已读 ' + read)
      : (emailFolderLabel(state.mailFolder) + ' ' + state.messages.length + ' 封');
    var allCount = document.getElementById('emailFilterCountAll');
    var unreadCount = document.getElementById('emailFilterCountUnread');
    var readCount = document.getElementById('emailFilterCountRead');
    if (allCount) allCount.textContent = String(state.messages.length);
    if (unreadCount) unreadCount.textContent = String(unread);
    if (readCount) readCount.textContent = String(read);
    if (host) host.textContent = state.syncStatus ? (summary + ' · ' + state.syncStatus) : summary;
    var folderTitle = document.getElementById('emailFolderTitle');
    var visibleCountHost = document.getElementById('emailVisibleCount');
    if (folderTitle) folderTitle.textContent = emailFolderLabel(state.mailFolder);
    if (visibleCountHost) visibleCountHost.textContent = Number(visibleCount || 0) + ' 封';
    var refreshButton = document.getElementById('emailRefreshButton');
    if (refreshButton) refreshButton.title = state.syncStatus || ('强制同步' + emailFolderLabel(state.mailFolder));
  }

  function setEmailMessageFilter(filter) {
    state.messageFilter = ['all', 'unread', 'read'].indexOf(filter) >= 0 ? filter : 'all';
    document.querySelectorAll('.email-filter-button').forEach(function(button) {
      var selected = button.getAttribute('data-filter') === state.messageFilter;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    renderMessages();
  }

  function setEmailSearchQuery(value) {
    state.searchQuery = String(value || '').slice(0, 240);
    syncEmailSearchControls();
    renderMessages();
  }

  function syncEmailSearchControls() {
    var input = document.getElementById('emailMessageSearch');
    var clearButton = document.getElementById('emailSearchClear');
    if (input && input.value !== state.searchQuery) input.value = state.searchQuery;
    if (clearButton) clearButton.hidden = !state.searchQuery;
  }

  function clearEmailSearch() {
    state.searchQuery = '';
    var input = document.getElementById('emailMessageSearch');
    var clearButton = document.getElementById('emailSearchClear');
    if (input) {
      input.value = '';
      input.focus();
    }
    if (clearButton) clearButton.hidden = true;
    renderMessages();
  }

  function composeSenderOptionsMarkup() {
    var connectedAccounts = state.accounts.filter(function(account) {
      return account.connectionStatus === 'connected';
    });
    var preferredId = state.selectedAccountId && state.selectedAccountId !== ALL_MAILBOXES_ID
      ? state.selectedAccountId
      : (connectedAccounts[0] && connectedAccounts[0].id || '');
    if (!connectedAccounts.length) return '<option value="">请先连接可发送邮件的邮箱</option>';
    return connectedAccounts.map(function(account) {
      var selected = account.id === preferredId ? ' selected' : '';
      return '<option value="' + esc(account.id) + '"' + selected + '>' +
        esc((account.displayName || account.email) + ' · ' + account.email) + '</option>';
    }).join('');
  }

  function composeEmailMarkup() {
    var hasSender = state.accounts.some(function(account) { return account.connectionStatus === 'connected'; });
    return '<section class="email-compose-panel" aria-labelledby="emailComposeTitle">' +
      '<div class="email-ai-title" id="emailComposeTitle">写邮件</div>' +
      '<div class="email-security-note">填写发件邮箱、收件人、主题和正文后直接发送；附件仍保存在本机并随邮件上传。</div>' +
      '<div class="email-compose-routing">' +
        '<div class="email-field"><label for="emailComposeAccount">发件邮箱</label><select id="emailComposeAccount"' + (hasSender ? '' : ' disabled') + '>' + composeSenderOptionsMarkup() + '</select></div>' +
        '<div class="email-field"><label for="emailReplyTo">收件人</label><input id="emailReplyTo" type="email" autocomplete="email" placeholder="name@example.com" oninput="resetEmailSendConfirmation()"></div>' +
        '<div class="email-field email-compose-subject"><label for="emailReplySubject">主题</label><input id="emailReplySubject" placeholder="填写邮件主题" oninput="resetEmailSendConfirmation()"></div>' +
      '</div>' +
      '<div class="email-field"><label for="emailReplyDraft">邮件正文</label>' +
        '<div class="email-draft-wrap"><textarea class="email-draft" id="emailReplyDraft" placeholder="在这里填写邮件正文" oninput="resetEmailSendConfirmation()"></textarea>' +
          '<div class="email-form-actions email-draft-actions"><button class="email-button primary" type="button" onclick="copyEmailReplyDraft()">复制正文</button><button class="email-button primary" id="emailSendButton" type="button" onclick="sendEmailReply()"' + (hasSender ? '' : ' disabled') + '>发送邮件</button></div>' +
        '</div>' +
      '</div>' +
      '<div class="email-reply-attachment-dropzone" id="emailReplyAttachmentDropzone" ondragenter="handleEmailReplyAttachmentDrag(event,true)" ondragover="handleEmailReplyAttachmentDrag(event,true)" ondragleave="handleEmailReplyAttachmentDrag(event,false)" ondrop="dropEmailReplyAttachments(event)">' +
        '<input id="emailReplyAttachmentInput" type="file" multiple hidden onchange="addEmailReplyAttachments(this.files)">' +
        '<div class="email-attachment-section-head"><div><strong>随邮件发送的附件</strong><span>拖拽多个文件到这里，或点击加号批量添加</span></div><button class="email-attachment-add" type="button" onclick="chooseEmailReplyAttachments()" aria-label="批量添加附件">+</button></div>' +
        '<div class="email-reply-attachment-list" id="emailReplyAttachmentList">' + replyAttachmentsMarkup() + '</div>' +
      '</div>' +
      '<div class="email-inline-status" id="emailAiStatus"></div>' +
      '<div class="email-inline-status" id="emailSendStatus"></div>' +
    '</section>';
  }

  function startNewEmailCompose() {
    resetEmailSendConfirmation();
    state.composeMode = true;
    state.selectedMessageId = '';
    state.loadingMessageId = '';
    state.messageDetailError = '';
    state.messageDetailRequestId += 1;
    state.replyAttachments = [];
    setEmailWorkspaceView('detail');
    renderMessages();
    renderDetail();
    window.setTimeout(function() {
      var recipient = document.getElementById('emailReplyTo');
      if (recipient) recipient.focus();
    }, 0);
  }

  function renderDetail() {
    var host = document.getElementById('emailMessageDetail');
    var headerSubject = document.getElementById('emailDetailHeaderSubject');
    var headerMeta = document.getElementById('emailDetailHeaderMeta');
    if (!host) return;
    if (state.composeMode) {
      if (headerSubject) headerSubject.textContent = '写邮件';
      if (headerMeta) headerMeta.innerHTML = '';
      host.innerHTML = composeEmailMarkup();
      return;
    }
    var message = selectedMessage();
    var messageAttachments = Array.isArray(message && message.attachments) ? message.attachments : [];
    if (headerSubject) headerSubject.textContent = message ? (message.subject || '（无主题）') : '邮件与 AI 回复草稿';
    if (headerMeta) {
      headerMeta.innerHTML = message
        ? (messageAttachments.length
            ? '<span class="email-detail-header-attachments"><strong>附件</strong> · ' + messageAttachments.length + ' 个</span>'
            : '') +
          '<span><strong>发件人：</strong>' + esc(message.from || '未知') + '</span>' +
          '<span><strong>收件人：</strong>' + esc(message.to || '') + '</span>' +
          '<span><strong>时间：</strong>' + esc(message.date ? new Date(message.date).toLocaleString('zh-CN') : '') + '</span>'
        : '';
    }
    if (!message) {
      host.innerHTML = '<div class="email-empty">选择一封邮件查看正文；点击“生成回复草稿”后，AI 才会读取当前邮件。</div>';
      return;
    }
    if (state.messageDetailError) {
      host.innerHTML = '<div class="email-empty email-error-text">' + esc(state.messageDetailError) +
          '<div class="email-form-actions"><button class="email-button primary" type="button" onclick="retryEmailMessage(\'' + esc(message.id) + '\')">重新读取正文</button></div></div>';
      return;
    }
    if (state.loadingMessageId === message.id) {
      host.innerHTML = '<div class="email-detail-loading"><span class="email-status-dot connecting"></span><span>正在从邮箱读取正文…</span></div>';
      return;
    }
    if (!message.contentLoaded && !message.text) {
      host.innerHTML = '<div class="email-empty">正文尚未读取。<div class="email-form-actions"><button class="email-button primary" type="button" onclick="retryEmailMessage(\'' + esc(message.id) + '\')">读取正文</button></div></div>';
      return;
    }
    if (state.mailFolder !== 'inbox') {
      host.innerHTML = incomingAttachmentsMarkup(message) +
        '<div class="email-detail-body">' + linkifyEmailBody(message.text || '（邮件正文为空）') + '</div>' +
        '<div class="email-folder-detail-note">当前查看的是' + esc(emailFolderLabel(state.mailFolder)) + '邮件。</div>';
      return;
    }
    host.innerHTML = incomingAttachmentsMarkup(message) +
      '<div class="email-detail-body">' + linkifyEmailBody(message.text || '（邮件正文为空）') + '</div>' +
      '<div class="email-ai-panel">' +
        '<div class="email-ai-panel-header">' +
          '<div class="email-ai-title">AI 编辑回复</div>' +
          '<div class="email-reply-routing">' +
            '<div class="email-field"><label for="emailReplyTo">收件人</label><input id="emailReplyTo" type="email" value="' + esc(message.replyToAddress || emailAddressFrom(message.from)) + '" readonly></div>' +
            '<div class="email-field"><label for="emailReplySubject">主题</label><input id="emailReplySubject" value="' + esc(replySubject(message.subject)) + '" oninput="resetEmailSendConfirmation()"></div>' +
          '</div>' +
        '</div>' +
        '<div class="email-field"><label for="emailReplyInstruction">补充要求（可选）</label>' +
          '<div class="email-reply-instruction-wrap">' +
            '<textarea id="emailReplyInstruction" placeholder="例如：确认已收到附件，并询问下周二是否方便开会。"></textarea>' +
            '<div class="email-ai-compose-controls">' +
              '<label class="email-tone-control" for="emailReplyTone"><span>回复语气</span><select id="emailReplyTone"><option>专业、礼貌、简洁</option><option>正式、审慎</option><option>友好、自然</option><option>学术、严谨</option></select></label>' +
              '<button class="email-button primary email-ai-generate-button" id="emailAiDraftButton" type="button" onclick="generateEmailReplyDraft()">生成回复草稿</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="email-inline-status" id="emailAiStatus"></div>' +
        '<div class="email-field" id="emailDraftField" hidden>' +
          '<label for="emailReplyDraft">回复草稿</label>' +
          '<div class="email-draft-wrap email-reply-draft-drop-target" id="emailReplyAttachmentDropzone" title="可将附件拖入回复草稿" ondragenter="handleEmailReplyAttachmentDrag(event,true)" ondragover="handleEmailReplyAttachmentDrag(event,true)" ondragleave="handleEmailReplyAttachmentDrag(event,false)" ondrop="dropEmailReplyAttachments(event)">' +
            '<input id="emailReplyAttachmentInput" type="file" multiple hidden onchange="addEmailReplyAttachments(this.files)">' +
            '<textarea class="email-draft" id="emailReplyDraft" oninput="resetEmailSendConfirmation()"></textarea>' +
            '<div class="email-reply-attachment-list" id="emailReplyAttachmentList">' + replyAttachmentsMarkup() + '</div>' +
            '<div class="email-form-actions email-draft-actions"><button class="email-button primary email-upload-attachment-button" type="button" onclick="chooseEmailReplyAttachments()">上传附件</button><button class="email-button primary" type="button" onclick="copyEmailReplyDraft()">复制草稿</button><button class="email-button primary" id="emailSendButton" type="button" onclick="sendEmailReply()">发送邮件</button></div>' +
          '</div>' +
          '<div class="email-inline-status" id="emailSendStatus"></div>' +
        '</div>' +
      '</div>';
  }

  async function loadAccounts() {
    var data = await jsonFetch('/api/email/accounts?userId=' + encodeURIComponent(userId()));
    state.accounts = Array.isArray(data.accounts) ? data.accounts : [];
    if (!state.selectedAccountId && state.accounts.length) state.selectedAccountId = ALL_MAILBOXES_ID;
    if (state.selectedAccountId && state.selectedAccountId !== ALL_MAILBOXES_ID && !state.accounts.some(function(item) { return item.id === state.selectedAccountId; })) {
      state.selectedAccountId = state.accounts.length ? ALL_MAILBOXES_ID : '';
    }
    renderAccounts();
    syncEmailRemoveButton();
  }

  function syncEmailRemoveButton() {
    var button = document.getElementById('emailRemoveAccountButton');
    if (!button) return;
    button.disabled = !state.selectedAccountId || state.selectedAccountId === ALL_MAILBOXES_ID;
    button.textContent = state.deleteConfirmId === state.selectedAccountId ? '再次点击确认' : '移除';
  }

  async function loadMessages() {
    if (!state.selectedAccountId) {
      state.messages = [];
      renderMessages();
      renderDetail();
      return;
    }
    var accountQuery = state.selectedAccountId === ALL_MAILBOXES_ID ? '' : ('&accountId=' + encodeURIComponent(state.selectedAccountId));
    var data = await jsonFetch('/api/email/messages?userId=' + encodeURIComponent(userId()) + accountQuery + '&folder=' + encodeURIComponent(state.mailFolder) + '&limit=0');
    var currentDetail = selectedMessage();
    state.messages = Array.isArray(data.messages) ? data.messages : [];
    if (currentDetail && currentDetail.contentLoaded) {
      state.messages = state.messages.map(function(message) {
        return message.id === currentDetail.id ? Object.assign({}, message, currentDetail) : message;
      });
    }
    if (state.selectedMessageId && !state.messages.some(function(item) { return item.id === state.selectedMessageId; })) state.selectedMessageId = '';
    renderMessages();
    renderDetail();
    refreshEmailUnreadBadge().catch(function() {});
  }

  function connectEvents() {
    if (typeof EventSource !== 'function') return;
    var targetUserId = userId();
    if (state.eventSource && state.eventSourceUserId === targetUserId && state.eventSource.readyState !== EventSource.CLOSED) return;
    if (state.eventSource) state.eventSource.close();
    var source = new EventSource('/api/email/events?userId=' + encodeURIComponent(targetUserId));
    state.eventSource = source;
    state.eventSourceUserId = targetUserId;
    source.addEventListener('mailbox', function(event) {
      var payload;
      try { payload = JSON.parse(event.data || '{}'); } catch (error) { return; }
      var workspace = document.querySelector('#homeUtilityPage[data-page-id="email"]:not([hidden])');
      if (payload.type === 'account-status' && workspace) loadAccounts().catch(function() {});
      if (workspace && payload.type === 'messages-updated' && (state.selectedAccountId === ALL_MAILBOXES_ID || payload.accountId === state.selectedAccountId)) {
        var pendingDetail = selectedMessage();
        var pendingMessageId = pendingDetail && pendingDetail.accountId === payload.accountId && pendingDetail.contentLoaded && pendingDetail.attachmentsLoaded === false
          ? pendingDetail.id
          : '';
        loadMessages().then(function() {
          if (pendingMessageId) refreshSelectedEmailAttachments(pendingMessageId).catch(function() {});
        }).catch(function() {});
      }
      if (workspace && payload.type === 'message-body-updated' && payload.messageId === state.selectedMessageId) {
        selectEmailMessage(payload.messageId).catch(function() {});
      }
      if (payload.type === 'messages-updated') refreshEmailUnreadBadge().catch(function() {});
    });
  }

  async function refreshSelectedEmailAttachments(messageId) {
    if (!messageId || state.selectedMessageId !== messageId || state.attachmentRefreshMessageId === messageId) return;
    var message = selectedMessage();
    if (!message) return;
    state.attachmentRefreshMessageId = messageId;
    try {
      var data = await jsonFetch('/api/email/messages/' + encodeURIComponent(messageId) +
        '?userId=' + encodeURIComponent(userId()) + '&accountId=' + encodeURIComponent(message.accountId), { timeoutMs: 40000 });
      if (state.selectedMessageId !== messageId || !data.message) return;
      var index = state.messages.findIndex(function(item) { return item.id === messageId; });
      if (index >= 0) state.messages[index] = Object.assign({}, state.messages[index], data.message);
      renderDetail();
    } finally {
      if (state.attachmentRefreshMessageId === messageId) state.attachmentRefreshMessageId = '';
    }
  }

  async function showEmailWorkspace() {
    state.messageFilter = 'all';
    state.workspaceView = 'list';
    // Class-based page-open state lets the layout CSS widen the chat gutters
    // for the three-pane mailbox without a relational sibling selector.
    document.body.classList.add('email-page-open');
    window.showHomeUtilityPage('email', '邮件', '', mailboxMarkup());
    restoreEmailColumnWidths();
    setEmailWorkspaceView('list');
    installEmailHeaderSettingsButton();
    connectEvents();
    try {
      await loadAccounts();
      await loadMessages();
    } catch (error) {
      var host = document.getElementById('emailAccountList');
      if (host) host.innerHTML = '<div class="email-empty" style="color:#b52335;">读取邮箱失败：' + esc(error.message) + '</div>';
    }
  }

  function installEmailHeaderSettingsButton() {
    var title = document.querySelector('#homeUtilityPage[data-page-id="email"] .home-utility-title');
    if (!title || title.querySelector('.email-header-actions')) return;
    var titleLabel = document.createElement('span');
    titleLabel.className = 'email-header-title-label';
    titleLabel.textContent = String(title.textContent || '邮件').trim() || '邮件';
    title.textContent = '';
    title.appendChild(titleLabel);
    var actions = document.createElement('span');
    actions.className = 'email-header-actions';
    var filters = document.createElement('span');
    filters.className = 'email-read-filters email-header-filters';
    filters.id = 'emailReadFilters';
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', '邮件读取状态');
    filters.innerHTML = '<button type="button" class="email-filter-button active" data-filter="all" aria-pressed="true" onclick="setEmailMessageFilter(\'all\')">全部 <span class="email-filter-count" id="emailFilterCountAll">0</span></button><button type="button" class="email-filter-button" data-filter="unread" aria-pressed="false" onclick="setEmailMessageFilter(\'unread\')">未读 <span class="email-filter-count" id="emailFilterCountUnread">0</span></button><button type="button" class="email-filter-button" data-filter="read" aria-pressed="false" onclick="setEmailMessageFilter(\'read\')">已读 <span class="email-filter-count" id="emailFilterCountRead">0</span></button>';
    actions.appendChild(filters);
    var markAllButton = document.createElement('button');
    markAllButton.type = 'button';
    markAllButton.className = 'email-button email-mark-all-read email-header-mark-all';
    markAllButton.id = 'emailMarkAllReadButton';
    markAllButton.textContent = '一键已读';
    markAllButton.onclick = markAllEmailRead;
    actions.appendChild(markAllButton);
    var refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.className = 'email-button email-icon-button email-header-refresh';
    refreshButton.id = 'emailRefreshButton';
    refreshButton.title = '强制同步当前邮箱夹';
    refreshButton.setAttribute('aria-label', '刷新当前邮箱夹');
    refreshButton.innerHTML = '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M204-318q-22-38-33-78t-11-82q0-134 93-228t227-94h7l-64-64 56-56 160 160-160 160-56-56 64-64h-7q-100 0-170 70.5T240-478q0 26 6 51t18 49l-60 60ZM481-40 321-200l160-160 56 56-64 64h7q100 0 170-70.5T720-482q0-26-6-51t-18-49l60-60q22 38 33 78t11 82q0 134-93 228t-227 94h-7l64 64-56 56Z"></path></svg>';
    refreshButton.onclick = syncSelectedEmailAccount;
    actions.appendChild(refreshButton);
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'email-header-settings';
    button.title = '配置邮箱';
    button.setAttribute('aria-label', '配置邮箱');
    button.onclick = showEmailSettingsPage;
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"></path></svg>';
    actions.appendChild(button);
    var wikiButton = document.createElement('button');
    wikiButton.type = 'button';
    wikiButton.className = 'email-header-wiki';
    wikiButton.title = '打开全部邮箱邮件网状图';
    wikiButton.setAttribute('aria-label', '邮件网状图');
    wikiButton.onclick = showEmailWiki;
    wikiButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="5" r="2"></circle><circle cx="19" cy="10" r="2"></circle><circle cx="14" cy="19" r="2"></circle><path d="m6.5 10.6 4-4.2M13.9 5.8l3.2 2.9m.3 3.1-2.1 5.3M12.3 17.4 6.8 13"></path></svg>';
    actions.appendChild(wikiButton);
    title.appendChild(actions);
  }

  async function showEmailSettingsPage() {
    window.showHomeUtilityPage('email-settings', '配置邮箱', '获取平台专用密码、连接邮箱并管理已登录账户', settingsMarkup());
    var back = document.querySelector('#homeUtilityPage[data-page-id="email-settings"] .home-utility-back');
    if (back) {
      back.onclick = showEmailWorkspace;
      back.title = '返回邮件';
      back.setAttribute('aria-label', '返回邮件');
    }
    syncEmailProviderFields();
    try {
      await loadAccounts();
    } catch (error) {
      var host = document.getElementById('emailAccountList');
      if (host) host.innerHTML = '<div class="email-empty email-error-text">读取邮箱账户失败：' + esc(error.message) + '</div>';
    }
  }

  function chooseEmailProvider(providerId) {
    var select = document.getElementById('emailProvider');
    if (!select || !providerCatalog[providerId]) return;
    select.value = providerId;
    syncEmailProviderFields();
    document.querySelectorAll('.email-provider-guide').forEach(function(card) {
      card.classList.toggle('selected', card.getAttribute('data-provider') === providerId);
    });
    var address = document.getElementById('emailAddress');
    if (address) address.focus();
  }

  function openEmailProviderAuthorization(providerId) {
    var provider = providerCatalog[providerId];
    if (!provider || !provider.url) return;
    if (typeof window.openExternalUrl === 'function') window.openExternalUrl(provider.url);
    else window.open(provider.url, '_blank', 'noopener');
  }

  function toggleEmailAccountForm(show) {
    var panel = document.getElementById('emailAddPanel');
    if (panel) panel.hidden = show !== true;
  }

  function syncEmailProviderFields() {
    var provider = document.getElementById('emailProvider');
    var custom = document.getElementById('emailCustomSettings');
    var school = document.getElementById('emailSchoolSettings');
    var usesManualServers = !!provider && (provider.value === 'custom' || provider.value === 'school');
    if (custom) custom.hidden = !usesManualServers;
    if (school) school.hidden = !provider || provider.value !== 'school';
    if (provider && provider.value === 'school') syncSchoolEmailSettings(false);
    document.querySelectorAll('.email-provider-guide').forEach(function(card) {
      card.classList.toggle('selected', !!provider && card.getAttribute('data-provider') === provider.value);
    });
  }

  function normalizeSchoolDomain(value) {
    var domain = String(value || '').trim().toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^@/, '')
      .split('/')[0]
      .split(':')[0];
    if (domain.indexOf('@') >= 0) domain = domain.split('@').pop();
    domain = domain.replace(/^(?:mail|imap|smtp|www)\./, '').replace(/^\.+|\.+$/g, '');
    var labels = domain.split('.').filter(Boolean);
    if (labels.length >= 3 && labels.slice(-2).join('.') === 'edu.cn') return labels.slice(-3).join('.');
    if (labels.length >= 2 && labels[labels.length - 1] === 'edu') return labels.slice(-2).join('.');
    return labels.join('.');
  }

  function syncSchoolEmailSettings(domainEdited) {
    var provider = document.getElementById('emailProvider');
    if (!provider || provider.value !== 'school') return;
    var address = document.getElementById('emailAddress');
    var domainInput = document.getElementById('emailSchoolDomain');
    var addressDomain = normalizeSchoolDomain(address && address.value);
    var typedDomain = normalizeSchoolDomain(domainInput && domainInput.value);
    var domain = domainEdited ? typedDomain : (addressDomain || typedDomain);
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return;
    if (domainInput && (!domainEdited || domainInput.value !== domain)) domainInput.value = domain;
    var imapHost = document.getElementById('emailImapHost');
    var imapPort = document.getElementById('emailImapPort');
    var smtpHost = document.getElementById('emailSmtpHost');
    var smtpPort = document.getElementById('emailSmtpPort');
    var smtpSecure = document.getElementById('emailSmtpSecure');
    if (imapHost) imapHost.value = 'mail.' + domain;
    if (imapPort) imapPort.value = '993';
    if (smtpHost) smtpHost.value = 'smtp.' + domain;
    if (smtpPort) smtpPort.value = '465';
    if (smtpSecure) smtpSecure.checked = true;
  }

  async function addEmailAccount() {
    var status = document.getElementById('emailAccountStatus');
    var button = document.getElementById('emailAddButton');
    if (status) { status.textContent = '正在验证 IMAP 登录并建立安全连接…'; status.className = 'email-inline-status'; }
    if (button) button.disabled = true;
    try {
      var provider = document.getElementById('emailProvider').value;
      var usesManualServers = provider === 'custom' || provider === 'school';
      await jsonFetch('/api/email/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId(),
          provider: provider,
          email: document.getElementById('emailAddress').value,
          displayName: document.getElementById('emailDisplayName').value,
          credential: document.getElementById('emailCredential').value,
          imapHost: usesManualServers ? document.getElementById('emailImapHost').value : undefined,
          imapPort: usesManualServers ? Number(document.getElementById('emailImapPort').value || 993) : undefined,
          imapSecure: true,
          smtpHost: usesManualServers ? document.getElementById('emailSmtpHost').value : undefined,
          smtpPort: usesManualServers ? Number(document.getElementById('emailSmtpPort').value || 465) : undefined,
          smtpSecure: usesManualServers ? document.getElementById('emailSmtpSecure').checked : undefined
        })
      });
      document.getElementById('emailCredential').value = '';
      await loadAccounts();
      if (status) status.textContent = '邮箱已连接并开始实时同步。';
    } catch (error) {
      if (status) { status.textContent = error.message; status.className = 'email-inline-status error'; }
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function selectEmailAccount(accountId) {
    state.selectedAccountId = accountId;
    state.selectedMessageId = '';
    state.searchQuery = '';
    state.composeMode = false;
    state.deleteConfirmId = '';
    renderAccounts();
    syncEmailSearchControls();
    syncEmailRemoveButton();
    await loadMessages().catch(function(error) {
      var host = document.getElementById('emailMessageList');
      if (host) host.innerHTML = '<div class="email-empty" style="color:#b52335;">' + esc(error.message) + '</div>';
    });
  }

  async function removeSelectedEmailAccount() {
    var accountId = state.selectedAccountId;
    if (!accountId || accountId === ALL_MAILBOXES_ID) return;
    var status = document.getElementById('emailAccountListStatus');
    if (state.deleteConfirmId !== accountId) {
      state.deleteConfirmId = accountId;
      syncEmailRemoveButton();
      if (status) status.textContent = '再次点击“再次点击确认”即可移除该账户及其本地邮件缓存。';
      window.setTimeout(function() {
        if (state.deleteConfirmId !== accountId) return;
        state.deleteConfirmId = '';
        syncEmailRemoveButton();
      }, 5000);
      return;
    }
    var button = document.getElementById('emailRemoveAccountButton');
    if (button) button.disabled = true;
    try {
      await jsonFetch('/api/email/accounts/' + encodeURIComponent(accountId), {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: userId() })
      });
      state.deleteConfirmId = '';
      state.selectedAccountId = '';
      state.selectedMessageId = '';
      await loadAccounts();
      await loadMessages();
      if (status) status.textContent = '邮箱账户及其本地缓存已移除。';
    } catch (error) {
      state.deleteConfirmId = '';
      syncEmailRemoveButton();
      if (status) { status.textContent = error.message; status.className = 'email-inline-status error'; }
    }
  }

  async function selectEmailMessage(messageId) {
    resetEmailSendConfirmation();
    if (state.selectedMessageId !== messageId) state.replyAttachments = [];
    state.composeMode = false;
    state.selectedMessageId = messageId;
    state.loadingMessageId = messageId;
    state.messageDetailError = '';
    state.messageDetailRequestId += 1;
    var requestId = state.messageDetailRequestId;
    var message = selectedMessage();
    var wasUnread = state.mailFolder === 'inbox' && !!message && !message.seen;
    if (message && wasUnread) message.seen = true;
    setEmailWorkspaceView('detail');
    renderMessages();
    renderDetail();
    if (!message) {
      state.loadingMessageId = '';
      return;
    }
    var detailPromise = jsonFetch('/api/email/messages/' + encodeURIComponent(messageId) +
      '?userId=' + encodeURIComponent(userId()) + '&accountId=' + encodeURIComponent(message.accountId), {
        timeoutMs: 40000
      });
    if (wasUnread) {
      var markRead = function() {
        return jsonFetch('/api/email/messages/' + encodeURIComponent(messageId) + '/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: userId(), accountId: message.accountId }),
          timeoutMs: 15000
        }).then(function(readData) {
          var currentIndex = state.messages.findIndex(function(item) { return item.id === messageId; });
          if (currentIndex >= 0) {
            state.messages[currentIndex] = readData.message
              ? Object.assign({}, state.messages[currentIndex], readData.message, { seen: true })
              : Object.assign({}, state.messages[currentIndex], { seen: true });
          }
          renderMessages();
          refreshEmailUnreadBadge().catch(function() {});
        }).catch(function() {
          var currentIndex = state.messages.findIndex(function(item) { return item.id === messageId; });
          if (currentIndex >= 0) state.messages[currentIndex] = Object.assign({}, state.messages[currentIndex], { seen: false });
          renderMessages();
          refreshEmailUnreadBadge().catch(function() {});
        });
      };
      // ImapFlow serializes commands on one mailbox connection. Marking the
      // message read only after the body request settles keeps the small flag
      // update from competing with the user-visible body download.
      detailPromise.then(markRead, markRead);
    }
    try {
      var data = await detailPromise;
      if (requestId !== state.messageDetailRequestId || state.selectedMessageId !== messageId) return;
      if (data.message) {
        var index = state.messages.findIndex(function(item) { return item.id === messageId; });
        if (index >= 0) state.messages[index] = Object.assign({}, data.message, { seen: wasUnread || data.message.seen });
      }
    } catch (error) {
      if (requestId === state.messageDetailRequestId && state.selectedMessageId === messageId) {
        state.messageDetailError = error.message;
      }
    } finally {
      if (requestId === state.messageDetailRequestId && state.loadingMessageId === messageId) state.loadingMessageId = '';
      renderMessages();
      renderDetail();
    }
  }

  function retryEmailMessage(messageId) {
    var message = state.messages.find(function(item) { return item.id === messageId; });
    if (!message) return;
    state.messageDetailError = '';
    selectEmailMessage(messageId);
  }

  async function syncSelectedEmailAccount() {
    if (!state.selectedAccountId) return;
    var refreshButton = document.getElementById('emailRefreshButton');
    state.syncing = true;
    state.syncStatus = '正在向邮箱服务器请求完整' + emailFolderLabel(state.mailFolder) + '…';
    if (refreshButton) { refreshButton.disabled = true; refreshButton.classList.add('is-syncing'); }
    renderMessages();
    try {
      var targetAccounts = state.selectedAccountId === ALL_MAILBOXES_ID
        ? state.accounts.slice()
        : state.accounts.filter(function(account) { return account.id === state.selectedAccountId; });
      var fetched = 0;
      for (var index = 0; index < targetAccounts.length; index += 1) {
        state.syncStatus = '正在同步 ' + (index + 1) + '/' + targetAccounts.length + '：' + (targetAccounts[index].displayName || targetAccounts[index].email);
        renderMessages();
        var result = await jsonFetch('/api/email/accounts/' + encodeURIComponent(targetAccounts[index].id) + '/sync', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: userId(), folder: state.mailFolder })
        });
        fetched += Number(result.count || 0);
      }
      await loadAccounts();
      await loadMessages();
      state.syncStatus = '刷新完成：服务器本轮返回 ' + fetched + ' 封，当前显示 ' + state.messages.length + ' 封';
    } catch (error) {
      state.syncStatus = '同步失败：' + error.message;
    } finally {
      state.syncing = false;
      if (refreshButton) { refreshButton.disabled = false; refreshButton.classList.remove('is-syncing'); }
      renderMessages();
    }
  }

  async function markAllEmailRead() {
    if (state.mailFolder !== 'inbox') return;
    var button = document.getElementById('emailMarkAllReadButton');
    if (button) button.disabled = true;
    try {
      var accountId = state.selectedAccountId === ALL_MAILBOXES_ID ? '' : state.selectedAccountId;
      var data = await jsonFetch('/api/email/messages/read-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId(), accountId: accountId }),
        timeoutMs: 60000
      });
      state.messages = state.messages.map(function(message) { return Object.assign({}, message, { seen: true }); });
      state.syncStatus = Number(data.count || 0) > 0 ? ('已将 ' + Number(data.count || 0) + ' 封邮件标记为已读') : '当前没有未读邮件';
      renderMessages();
      refreshEmailUnreadBadge().catch(function() {});
    } catch (error) {
      state.syncStatus = '一键已读失败：' + error.message;
      renderMessages();
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function generateEmailReplyDraft() {
    var message = selectedMessage();
    if (!message) return;
    var button = document.getElementById('emailAiDraftButton');
    var status = document.getElementById('emailAiStatus');
    if (button) button.disabled = true;
    if (status) { status.textContent = 'AI 正在阅读当前邮件并编辑回复草稿…'; status.className = 'email-inline-status'; }
    try {
      var data = await jsonFetch('/api/email/draft-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId(), accountId: message.accountId, messageId: message.id, authorized: true,
          tone: document.getElementById('emailReplyTone').value,
          instruction: document.getElementById('emailReplyInstruction').value
        })
      });
      document.getElementById('emailReplyDraft').value = data.draft || '';
      document.getElementById('emailDraftField').hidden = false;
      if (status) status.textContent = '草稿已生成。请核对收件人、主题和正文后再发送。';
    } catch (error) {
      if (status) { status.textContent = error.message; status.className = 'email-inline-status error'; }
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function copyEmailReplyDraft() {
    var draft = document.getElementById('emailReplyDraft');
    if (!draft) return;
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(draft.value);
      else { draft.focus(); draft.select(); document.execCommand('copy'); }
      var status = document.getElementById('emailAiStatus');
      if (status) status.textContent = '草稿已复制。';
    } catch (error) {
      var fallbackStatus = document.getElementById('emailAiStatus');
      if (fallbackStatus) { fallbackStatus.textContent = '复制失败，请手动选择草稿复制。'; fallbackStatus.className = 'email-inline-status error'; }
    }
  }

  function resetEmailSendConfirmation() {
    var button = document.getElementById('emailSendButton');
    if (button && !button.disabled) button.textContent = '发送邮件';
    var status = document.getElementById('emailSendStatus');
    if (status && status.dataset.sent !== 'true') status.textContent = '';
  }

  function renderEmailReplyAttachments() {
    var list = document.getElementById('emailReplyAttachmentList');
    if (list) list.innerHTML = replyAttachmentsMarkup();
  }

  function chooseEmailReplyAttachments() {
    var input = document.getElementById('emailReplyAttachmentInput');
    if (input) input.click();
  }

  function addEmailReplyAttachments(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var status = document.getElementById('emailSendStatus');
    var existingKeys = {};
    state.replyAttachments.forEach(function(item) {
      existingKeys[[item.file.name, item.file.size, item.file.lastModified].join(':')] = true;
    });
    var totalBytes = state.replyAttachments.reduce(function(sum, item) { return sum + Number(item.file.size || 0); }, 0);
    var rejected = [];
    files.forEach(function(file) {
      var key = [file.name, file.size, file.lastModified].join(':');
      if (existingKeys[key]) return;
      if (state.replyAttachments.length >= 20) { rejected.push('一次最多添加 20 个附件'); return; }
      if (Number(file.size || 0) > 25 * 1024 * 1024) { rejected.push((file.name || '附件') + ' 超过 25 MB'); return; }
      if (totalBytes + Number(file.size || 0) > 50 * 1024 * 1024) { rejected.push('附件总大小不能超过 50 MB'); return; }
      totalBytes += Number(file.size || 0);
      existingKeys[key] = true;
      state.replyAttachments.push({
        id: 'email_attachment_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9),
        file: file
      });
    });
    var input = document.getElementById('emailReplyAttachmentInput');
    if (input) input.value = '';
    renderEmailReplyAttachments();
    resetEmailSendConfirmation();
    if (status && rejected.length) {
      status.dataset.sent = 'false';
      status.className = 'email-inline-status error';
      status.textContent = rejected[0];
    }
  }

  function removeEmailReplyAttachment(attachmentId) {
    state.replyAttachments = state.replyAttachments.filter(function(item) { return item.id !== attachmentId; });
    renderEmailReplyAttachments();
    resetEmailSendConfirmation();
  }

  function handleEmailReplyAttachmentDrag(event, active) {
    if (!event) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    if (active !== true && event.currentTarget && event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
    var dropzone = event.currentTarget || document.getElementById('emailReplyAttachmentDropzone');
    if (dropzone) dropzone.classList.toggle('is-dragging', active === true);
  }

  function dropEmailReplyAttachments(event) {
    handleEmailReplyAttachmentDrag(event, false);
    if (event && event.dataTransfer) addEmailReplyAttachments(event.dataTransfer.files);
  }

  function handleEmailAttachmentPreviewKeydown(element, event) {
    if (!event || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    openEmailAttachmentPreview(element, event);
  }

  async function openEmailAttachmentPreview(button, event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    if (!button) return;
    var previewPath = button.getAttribute('data-file-path') || '';
    if (previewPath && typeof window.previewOutputAttachment === 'function') {
      await window.previewOutputAttachment(button);
      return;
    }
    var status = document.getElementById('emailAiStatus');
    var messageId = button.getAttribute('data-message-id') || '';
    var accountId = button.getAttribute('data-account-id') || '';
    var attachmentId = button.getAttribute('data-attachment-id') || '';
    if (!messageId || !accountId || !attachmentId) {
      if (status) {
        status.className = 'email-inline-status error';
        status.textContent = '附件信息不完整，请刷新邮件后重试。';
      }
      return;
    }
    if (button.classList.contains('is-loading')) return;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    var detail = button.querySelector('.email-attachment-copy small');
    var previousDetail = detail ? detail.textContent : '';
    if (detail) detail.textContent = '正在准备附件，完成后将自动打开…';
    try {
      var data = await jsonFetch('/api/email/messages/' + encodeURIComponent(messageId) + '/attachments/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId(), accountId: accountId }),
        timeoutMs: 120000
      });
      var refreshed = data && data.message;
      var attachment = refreshed && Array.isArray(refreshed.attachments)
        ? refreshed.attachments.find(function(item) { return item.id === attachmentId; })
        : null;
      if (!attachment || !attachment.previewPath) {
        throw new Error((attachment && attachment.error) || '附件准备失败，请重新读取邮件后重试。');
      }
      var index = state.messages.findIndex(function(item) { return item.id === messageId; });
      if (index >= 0) state.messages[index] = Object.assign({}, state.messages[index], refreshed);
      button.setAttribute('data-file-path', attachment.previewPath);
      button.setAttribute('data-preview-url', attachment.previewPath);
      button.setAttribute('data-file-name', attachment.filename || button.getAttribute('data-file-name') || '附件');
      button.setAttribute('data-workspace-root', attachment.previewRoot || '');
      if (typeof window.previewOutputAttachment !== 'function') throw new Error('右侧文件预览尚未加载，请稍后重试。');
      await window.previewOutputAttachment(button);
      renderDetail();
    } catch (error) {
      if (detail) detail.textContent = previousDetail || '附件暂不可预览';
      if (status) {
        status.className = 'email-inline-status error';
        status.textContent = error.message || '附件预览失败，请稍后重试。';
      }
    } finally {
      if (button && button.classList) button.classList.remove('is-loading');
      if (button && button.removeAttribute) button.removeAttribute('aria-busy');
    }
  }

  async function sendEmailReply() {
    var message = selectedMessage();
    var composing = state.composeMode === true;
    var button = document.getElementById('emailSendButton');
    var status = document.getElementById('emailSendStatus');
    var to = document.getElementById('emailReplyTo');
    var subject = document.getElementById('emailReplySubject');
    var draft = document.getElementById('emailReplyDraft');
    var sender = document.getElementById('emailComposeAccount');
    if ((!message && !composing) || !button || !to || !subject || !draft) return;
    var accountId = composing ? String(sender && sender.value || '') : String(message && message.accountId || '');
    if (!accountId) {
      if (status) { status.textContent = '请先选择已连接的发件邮箱。'; status.className = 'email-inline-status error'; }
      return;
    }
    if (!String(to.value || '').trim()) {
      if (status) { status.textContent = '收件人不能为空。'; status.className = 'email-inline-status error'; }
      to.focus();
      return;
    }
    if (!String(subject.value || '').trim()) {
      if (status) { status.textContent = '邮件主题不能为空。'; status.className = 'email-inline-status error'; }
      subject.focus();
      return;
    }
    if (!String(draft.value || '').trim()) {
      if (status) { status.textContent = (composing ? '邮件' : '回复') + '正文不能为空。'; status.className = 'email-inline-status error'; }
      draft.focus();
      return;
    }
    button.disabled = true;
    button.textContent = '发送中…';
    if (status) { status.textContent = '正在通过当前邮箱的 SMTP 安全发送…'; status.className = 'email-inline-status'; }
    try {
      var formData = new FormData();
      formData.append('userId', userId());
      formData.append('accountId', accountId);
      formData.append('messageId', composing ? '' : message.id);
      formData.append('to', to.value);
      formData.append('subject', subject.value);
      formData.append('body', draft.value);
      formData.append('confirmed', 'true');
      state.replyAttachments.forEach(function(item) { formData.append('attachments', item.file, item.file.name); });
      var data = await jsonFetch('/api/email/send', { method: 'POST', body: formData });
      state.replyAttachments = [];
      renderEmailReplyAttachments();
      button.textContent = '已发送';
      if (status) {
        var delivery = data.result || {};
        status.dataset.sent = 'true';
        status.className = 'email-inline-status email-send-success';
        if (delivery.recordedLocally && delivery.archivedToServer) {
          status.textContent = '邮件已发送，已记录到“已发送”并同步到邮箱服务器。';
        } else if (delivery.recordedLocally) {
          status.textContent = delivery.archiveWarning || '邮件已发送，已记录到本机“已发送”；服务器归档将在后续同步时核对。';
        } else {
          status.textContent = delivery.archiveWarning || ('邮件已发送。Message-ID：' + (delivery.messageId || '服务器已接受'));
        }
      }
    } catch (error) {
      button.disabled = false;
      button.textContent = '发送邮件';
      if (status) { status.textContent = error.message; status.className = 'email-inline-status error'; }
    }
  }

  async function refreshEmailUnreadBadge() {
    var badge = document.getElementById('appEmailUnreadBadge');
    var button = document.getElementById('appEmailButton');
    try {
      var data = await jsonFetch('/api/email/summary?userId=' + encodeURIComponent(userId()));
      var summary = data.summary || {};
      state.mailboxSummary = {
        total: Math.max(0, Number(summary.total || 0)),
        unread: Math.max(0, Number(summary.unread || 0)),
        read: Math.max(0, Number(summary.read || 0)),
        accounts: Array.isArray(summary.accounts) ? summary.accounts : []
      };
      var unread = state.mailboxSummary.unread;
      if (badge) {
        badge.hidden = unread < 1;
        badge.textContent = unreadBadgeLabel(unread);
        badge.title = unread ? ('全部邮箱共 ' + unread + ' 封未读邮件') : '';
      }
      if (button) button.setAttribute('aria-label', unread ? ('邮件，' + unread + ' 封未读') : '邮件');
      syncEmailAccountUnreadBadges();
    } catch (error) {
      // Badge refresh is deliberately non-blocking; the mail workspace can still open.
    }
  }

  function wikiHash(value) {
    var hash = 2166136261;
    var text = String(value || '');
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function prepareEmailWikiGraph(graph, width, height) {
    var centerX = width * 0.5;
    var centerY = height * 0.5;
    var span = Math.max(180, Math.min(width, height));
    var nodes = (graph.nodes || []).map(function(raw) {
      var seed = wikiHash(raw.id);
      var angle = (seed % 3600) / 3600 * Math.PI * 2;
      var jitter = ((seed >>> 9) % 1000) / 1000;
      var radiusFactor = raw.type === 'account' ? 0.05 : raw.type === 'sender' ? 0.25 : raw.type === 'keyword' ? 0.42 : 0.34;
      var radius = span * (radiusFactor + (jitter - 0.5) * 0.12);
      var baseSize = raw.type === 'account' ? 8 : raw.type === 'sender' ? 5 : raw.type === 'keyword' ? 4.5 : 2.4;
      var naturalX = centerX + Math.cos(angle) * radius;
      var naturalY = centerY + Math.sin(angle) * radius * 0.72;
      return Object.assign({}, raw, {
        x: naturalX,
        y: naturalY,
        naturalX: naturalX,
        naturalY: naturalY,
        shapeTargetX: naturalX,
        shapeTargetY: naturalY,
        vx: 0,
        vy: 0,
        radius: Math.min(14, baseSize + Math.log2(Math.max(1, Number(raw.weight || 1))) * 0.9)
      });
    });
    var nodeById = new Map(nodes.map(function(node) { return [node.id, node]; }));
    var links = (graph.links || []).map(function(link) {
      return { source: nodeById.get(link.source), target: nodeById.get(link.target), type: link.type };
    }).filter(function(link) { return link.source && link.target; });
    return { nodes: nodes, nodeById: nodeById, links: links };
  }

  function resizeEmailWikiCanvas(runtime) {
    if (!runtime || !runtime.canvas) return;
    var rect = runtime.canvas.getBoundingClientRect();
    var ratio = Math.min(2, window.devicePixelRatio || 1);
    var width = Math.max(320, Math.floor(rect.width));
    var height = Math.max(360, Math.floor(rect.height));
    if (runtime.width === width && runtime.height === height && runtime.ratio === ratio) return;
    runtime.width = width;
    runtime.height = height;
    runtime.ratio = ratio;
    runtime.canvas.width = Math.floor(width * ratio);
    runtime.canvas.height = Math.floor(height * ratio);
    runtime.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    assignEmailWikiShapeTargets(runtime);
  }

  function emailWikiNodeAt(runtime, clientX, clientY) {
    var rect = runtime.canvas.getBoundingClientRect();
    var worldX = (clientX - rect.left - runtime.offsetX) / runtime.scale;
    var worldY = (clientY - rect.top - runtime.offsetY) / runtime.scale;
    var nearest = null;
    var nearestDistance = Infinity;
    runtime.nodes.forEach(function(node) {
      var nodeX = Number.isFinite(node.drawX) ? node.drawX : node.x;
      var nodeY = Number.isFinite(node.drawY) ? node.drawY : node.y;
      var distance = Math.hypot(nodeX - worldX, nodeY - worldY);
      if (distance <= Math.max(7 / runtime.scale, node.radius + 3) && distance < nearestDistance) {
        nearest = node;
        nearestDistance = distance;
      }
    });
    return nearest;
  }

  function emailWikiPalette(name) {
    var palettes = {
      original: { account: '#f6c453', sender: '#32d6d2', keyword: '#a78bfa', message: '#6ea8fe', unread: '#ff6b6b', link: '90,190,210', accent: '246,196,83' },
      ice: { account: '#e0f2fe', sender: '#67e8f9', keyword: '#93c5fd', message: '#38bdf8', unread: '#f0f9ff', link: '103,232,249', accent: '224,242,254' },
      nebula: { account: '#f9a8d4', sender: '#c4b5fd', keyword: '#a78bfa', message: '#818cf8', unread: '#fda4af', link: '167,139,250', accent: '249,168,212' },
      gold: { account: '#fff7cc', sender: '#fde68a', keyword: '#f6c453', message: '#f59e0b', unread: '#fb923c', link: '246,196,83', accent: '255,247,204' },
      emerald: { account: '#d1fae5', sender: '#a7f3d0', keyword: '#6ee7b7', message: '#34d399', unread: '#fef3c7', link: '52,211,153', accent: '167,243,208' }
    };
    return palettes[name] || palettes.original;
  }

  function emailWikiColor(node) {
    var palette = emailWikiPalette(emailWikiRuntime && emailWikiRuntime.colorPalette);
    if (node.type === 'account') return palette.account;
    if (node.type === 'sender') return palette.sender;
    if (node.type === 'keyword') return palette.keyword;
    if (node.unread) return palette.unread;
    return palette.message;
  }

  function emailWikiUnit(seed, shift) {
    var value = Math.imul((seed ^ (shift * 2654435761)) >>> 0, 2246822519) >>> 0;
    value ^= value >>> 13;
    return (value >>> 0) / 4294967295;
  }

  function assignEmailWikiShapeTargets(runtime) {
    if (!runtime || !runtime.nodes.length) return;
    var width = Math.max(540, runtime.width || runtime.canvas.clientWidth || 900);
    var height = Math.max(420, runtime.height || runtime.canvas.clientHeight || 620);
    var cx = width * 0.5;
    var cy = height * 0.5;
    var sx = Math.max(180, width * 0.39);
    var sy = Math.max(150, height * 0.38);
    var mode = runtime.shapeMode || 'circle';
    runtime.nodes.forEach(function(node, index) {
      var seed = wikiHash(node.id);
      var u = emailWikiUnit(seed, 1);
      var v = emailWikiUnit(seed, 2);
      var w = emailWikiUnit(seed, 3);
      var angle = Math.PI * 2 * u;
      var x = node.naturalX;
      var y = node.naturalY;

      if (mode === 'blackhole') {
        if (v < 0.18) {
          var lensRadius = Math.min(sx, sy) * (0.2 + w * 0.12);
          x = cx + Math.cos(angle) * lensRadius;
          y = cy + Math.sin(angle) * lensRadius * 0.76;
        } else if (v < 0.78) {
          var diskRadius = sx * (0.2 + Math.pow(w, 0.62) * 0.88);
          var diskY = (emailWikiUnit(seed, 4) - 0.5) * (10 + diskRadius * 0.11);
          x = cx + Math.cos(angle) * diskRadius;
          y = cy + Math.sin(angle) * diskY + (x - cx) * -0.2;
        } else {
          x = width * (0.05 + u * 0.9);
          y = height * (0.08 + w * 0.84);
        }
      } else if (mode === 'saturn') {
        if (v < 0.35) {
          var bodyRadius = Math.sqrt(w) * Math.min(sx, sy) * 0.42;
          x = cx + Math.cos(angle) * bodyRadius;
          y = cy + Math.sin(angle) * bodyRadius;
        } else if (v < 0.88) {
          var ringRadius = sx * (0.48 + w * 0.55);
          x = cx + Math.cos(angle) * ringRadius;
          y = cy + Math.sin(angle) * ringRadius * 0.24 + (x - cx) * -0.12;
        } else {
          x = width * (0.04 + u * 0.92);
          y = height * (0.06 + w * 0.88);
        }
      } else if (mode === 'galaxy') {
        var arm = index % 4;
        var galaxyRadius = Math.pow(v, 0.7) * Math.min(sx, sy) * 1.18;
        var spiralAngle = arm * Math.PI * 0.5 + galaxyRadius / Math.max(70, sx * 0.16) + (w - 0.5) * 0.55;
        x = cx + Math.cos(spiralAngle) * galaxyRadius * 1.45 + (u - 0.5) * 22;
        y = cy + Math.sin(spiralAngle) * galaxyRadius * 0.82 + (w - 0.5) * 18;
      } else if (mode === 'starfield') {
        x = width * (0.045 + u * 0.91);
        y = height * (0.06 + v * 0.88);
      } else if (mode === 'starrynight') {
        if (v < 0.72) {
          var swirlRadius = Math.pow(w, 0.68) * Math.min(sx, sy) * 1.1;
          var swirlAngle = angle + swirlRadius / 58;
          x = cx + Math.cos(swirlAngle) * swirlRadius * 1.55;
          y = cy * 0.72 + Math.sin(swirlAngle) * swirlRadius * 0.62;
        } else if (v < 0.86) {
          var moonRadius = Math.min(sx, sy) * (0.16 + w * 0.07);
          x = width * 0.78 + Math.cos(angle) * moonRadius;
          y = height * 0.23 + Math.sin(angle) * moonRadius;
        } else {
          x = width * (0.1 + u * 0.16);
          y = height * (0.38 + Math.pow(w, 0.55) * 0.53);
        }
      } else if (mode === 'painted-eye') {
        if (v < 0.62) {
          var eyeAngle = Math.PI * 2 * u;
          var eyeHalf = Math.abs(Math.cos(eyeAngle)) * sx * 0.9;
          x = cx + Math.cos(eyeAngle) * sx;
          y = cy + Math.sin(eyeAngle) * sy * 0.38 * (0.55 + eyeHalf / sx * 0.45);
        } else if (v < 0.9) {
          var irisRadius = Math.sqrt(w) * Math.min(sx, sy) * 0.42;
          x = cx + Math.cos(angle) * irisRadius;
          y = cy + Math.sin(angle) * irisRadius;
        } else {
          var pupilRadius = Math.sqrt(w) * Math.min(sx, sy) * 0.15;
          x = cx + Math.cos(angle) * pupilRadius;
          y = cy + Math.sin(angle) * pupilRadius;
        }
      } else if (mode === 'cubist-face') {
        var facePoints = [[-.72,-.62],[-.05,-.88],[.66,-.55],[.78,.15],[.25,.82],[-.45,.72],[-.78,.08],[-.34,-.16],[.28,-.24],[.08,.18],[-.18,.42]];
        var start = facePoints[index % facePoints.length];
        var end = facePoints[(index + 1) % facePoints.length];
        x = cx + (start[0] + (end[0] - start[0]) * u) * sx * 0.78 + (w - 0.5) * 14;
        y = cy + (start[1] + (end[1] - start[1]) * v) * sy * 0.9 + (u - 0.5) * 12;
      }
      node.shapeTargetX = Number.isFinite(x) ? x : cx;
      node.shapeTargetY = Number.isFinite(y) ? y : cy;
    });
  }

  function stopEmailWikiAudio(runtime) {
    if (!runtime) return;
    if (runtime.audioStream) runtime.audioStream.getTracks().forEach(function(track) { track.stop(); });
    if (runtime.audioContext && runtime.audioContext.state !== 'closed') runtime.audioContext.close().catch(function() {});
    runtime.audioContext = null;
    runtime.audioStream = null;
    runtime.audioAnalyser = null;
    runtime.audioData = null;
    runtime.audioLevel = 0;
  }

  async function startEmailWikiAudio(runtime) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('当前设备不支持麦克风声浪');
    var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      stream.getTracks().forEach(function(track) { track.stop(); });
      throw new Error('当前环境不支持音频分析');
    }
    var audioContext = new AudioContextClass();
    var analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    runtime.audioContext = audioContext;
    runtime.audioStream = stream;
    runtime.audioAnalyser = analyser;
    runtime.audioData = new Uint8Array(analyser.frequencyBinCount);
  }

  function updateEmailWikiControlState(runtime) {
    if (!runtime) return;
    var motionLabels = { wave: '波浪', vortex: '旋涡', breathe: '呼吸', voice: '声浪' };
    var shapeLabels = { circle: '圆形', blackhole: '黑洞', saturn: '土星', galaxy: '银河系', starfield: '星空', starrynight: '星月夜', 'painted-eye': '油画之眼', 'cubist-face': '抽象人像' };
    var colorLabels = { original: '原始', ice: '冰蓝', nebula: '星云紫', gold: '暖金', emerald: '翡翠' };
    var motionSummary = document.getElementById('emailWikiMotionSummary');
    var shapeSummary = document.getElementById('emailWikiShapeSummary');
    var colorSummary = document.getElementById('emailWikiColorSummary');
    if (motionSummary) motionSummary.textContent = runtime.motionEffect ? '律动 · ' + motionLabels[runtime.motionEffect] : '律动';
    if (shapeSummary) shapeSummary.textContent = '形状 · ' + shapeLabels[runtime.shapeMode || 'circle'];
    if (colorSummary) colorSummary.textContent = '配色 · ' + colorLabels[runtime.colorPalette || 'original'];
    document.querySelectorAll('#emailWikiShell [data-motion-effect]').forEach(function(button) {
      var active = button.getAttribute('data-motion-effect') === runtime.motionEffect;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('#emailWikiShell [data-shape-effect]').forEach(function(button) {
      var active = button.getAttribute('data-shape-effect') === runtime.shapeMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('#emailWikiShell [data-color-palette]').forEach(function(button) {
      var active = button.getAttribute('data-color-palette') === runtime.colorPalette;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('#emailWikiShell .email-wiki-control').forEach(function(control) {
      var group = control.getAttribute('data-control-group');
      control.classList.toggle('has-active', group === 'motion' ? Boolean(runtime.motionEffect) : true);
    });
  }

  function handleEmailWikiControlToggle(details) {
    if (!details || !details.open) return;
    document.querySelectorAll('#emailWikiShell .email-wiki-control[open]').forEach(function(other) {
      if (other !== details) other.open = false;
    });
  }

  async function selectEmailWikiMotion(effect) {
    var runtime = emailWikiRuntime;
    if (!runtime) return;
    var next = runtime.motionEffect === effect ? '' : effect;
    stopEmailWikiAudio(runtime);
    runtime.motionEffect = next;
    runtime.motionStartedAt = performance.now();
    if (next === 'voice') {
      try {
        await startEmailWikiAudio(runtime);
      } catch (error) {
        runtime.motionEffect = '';
        if (window.showToast) window.showToast(error.message || '无法启用麦克风声浪');
      }
    }
    updateEmailWikiControlState(runtime);
    var control = document.querySelector('#emailWikiShell .email-wiki-control[data-control-group="motion"]');
    if (control) control.open = false;
  }

  function selectEmailWikiShape(shape) {
    var runtime = emailWikiRuntime;
    if (!runtime) return;
    runtime.shapeMode = shape || 'circle';
    runtime.shapeTransitionStartedAt = performance.now();
    assignEmailWikiShapeTargets(runtime);
    updateEmailWikiControlState(runtime);
    var control = document.querySelector('#emailWikiShell .email-wiki-control[data-control-group="shape"]');
    if (control) control.open = false;
  }

  function selectEmailWikiColorPalette(paletteName) {
    var runtime = emailWikiRuntime;
    if (!runtime) return;
    runtime.colorPalette = paletteName || 'original';
    var palette = emailWikiPalette(runtime.colorPalette);
    var shell = document.getElementById('emailWikiShell');
    if (shell) {
      shell.style.setProperty('--wiki-account', palette.account);
      shell.style.setProperty('--wiki-sender', palette.sender);
      shell.style.setProperty('--wiki-message', palette.message);
      shell.style.setProperty('--wiki-keyword', palette.keyword);
    }
    updateEmailWikiControlState(runtime);
    if (runtime.selected || runtime.hover) renderEmailWikiDetail(runtime.selected || runtime.hover);
    var control = document.querySelector('#emailWikiShell .email-wiki-control[data-control-group="color"]');
    if (control) control.open = false;
  }

  function restartEmailWikiGraph() {
    var runtime = emailWikiRuntime;
    if (!runtime) return;
    var cx = runtime.width * 0.5;
    var cy = runtime.height * 0.5;
    runtime.nodes.forEach(function(node) {
      var seed = wikiHash(node.id);
      var angle = emailWikiUnit(seed, 8) * Math.PI * 2;
      var radius = Math.min(runtime.width, runtime.height) * (0.05 + emailWikiUnit(seed, 9) * 0.36);
      node.naturalX = cx + Math.cos(angle) * radius;
      node.naturalY = cy + Math.sin(angle) * radius * 0.72;
      node.x = cx + (emailWikiUnit(seed, 10) - 0.5) * 70;
      node.y = cy + (emailWikiUnit(seed, 11) - 0.5) * 70;
      node.vx = 0;
      node.vy = 0;
    });
    assignEmailWikiShapeTargets(runtime);
    fitEmailWikiGraph();
  }

  function fitEmailWikiGraph() {
    var runtime = emailWikiRuntime;
    if (!runtime || !runtime.nodes.length) return;
    var points = runtime.nodes.map(function(node) {
      return { x: runtime.shapeMode === 'circle' ? node.x : node.shapeTargetX, y: runtime.shapeMode === 'circle' ? node.y : node.shapeTargetY };
    });
    var minX = Math.min.apply(null, points.map(function(point) { return point.x; }));
    var maxX = Math.max.apply(null, points.map(function(point) { return point.x; }));
    var minY = Math.min.apply(null, points.map(function(point) { return point.y; }));
    var maxY = Math.max.apply(null, points.map(function(point) { return point.y; }));
    var scale = Math.min((runtime.width - 70) / Math.max(120, maxX - minX), (runtime.height - 70) / Math.max(120, maxY - minY), 1.6);
    runtime.scale = Math.max(0.25, scale);
    runtime.offsetX = runtime.width * 0.5 - (minX + maxX) * 0.5 * runtime.scale;
    runtime.offsetY = runtime.height * 0.5 - (minY + maxY) * 0.5 * runtime.scale;
  }

  function emailWikiDisplayPosition(runtime, node, timestamp) {
    var x = node.x;
    var y = node.y;
    var elapsed = Math.max(0, (timestamp || 0) - (runtime.motionStartedAt || 0));
    var seed = wikiHash(node.id);
    if (runtime.motionEffect === 'wave') {
      var wavePhase = elapsed / 30000 * Math.PI * 2;
      y += Math.sin(wavePhase + node.x / Math.max(75, runtime.width * 0.08) + emailWikiUnit(seed, 5) * 0.6) * 18;
    } else if (runtime.motionEffect === 'vortex') {
      var vortexPhase = elapsed / 12000 * Math.PI * 2;
      var dx = x - runtime.width * 0.5;
      var dy = y - runtime.height * 0.5;
      var rotate = vortexPhase * 0.13;
      x = runtime.width * 0.5 + dx * Math.cos(rotate) - dy * Math.sin(rotate);
      y = runtime.height * 0.5 + dx * Math.sin(rotate) + dy * Math.cos(rotate);
    } else if (runtime.motionEffect === 'breathe') {
      var breath = 1 + Math.sin(elapsed / 30000 * Math.PI * 2) * 0.085;
      x = runtime.width * 0.5 + (x - runtime.width * 0.5) * breath;
      y = runtime.height * 0.5 + (y - runtime.height * 0.5) * breath;
    } else if (runtime.motionEffect === 'voice') {
      var voicePhase = elapsed / 1700 * Math.PI * 2;
      y += Math.sin(voicePhase - x / Math.max(42, runtime.width * 0.055)) * (5 + runtime.audioLevel * 48);
    }
    node.drawX = x;
    node.drawY = y;
    return { x: x, y: y };
  }

  function renderEmailWikiDetail(node) {
    var runtime = emailWikiRuntime;
    var host = document.getElementById('emailWikiDetail');
    if (!host || !runtime) return;
    if (!node) {
      host.innerHTML = '<div class="email-wiki-empty"><strong>悬停预览，点击固定</strong><span>账户、发件人、邮件和关键词共同组成这一本地 Wiki。</span></div>';
      return;
    }
    var typeLabels = { account: '邮箱账户', sender: '发件人', message: '邮件', keyword: '关键词' };
    var linked = [];
    runtime.links.forEach(function(link) {
      if (link.source.id === node.id) linked.push(link.target);
      else if (link.target.id === node.id) linked.push(link.source);
    });
    var unique = [];
    var seen = new Set();
    linked.forEach(function(item) { if (!seen.has(item.id)) { seen.add(item.id); unique.push(item); } });
    host.innerHTML = '<div class="email-wiki-detail-head"><span class="email-wiki-node-dot" style="background:' + emailWikiColor(node) + '"></span><div><small>' + esc(typeLabels[node.type] || node.type) + '</small><h3>' + esc(node.label) + '</h3></div></div>' +
      (node.subtitle ? '<p class="email-wiki-subtitle">' + esc(node.subtitle) + '</p>' : '') +
      '<div class="email-wiki-metrics"><span><strong>' + Number(node.weight || 1) + '</strong>权重</span><span><strong>' + unique.length + '</strong>连接</span></div>' +
      (node.type === 'message' ? '<button type="button" class="email-wiki-open-message" onclick="openEmailWikiMessage(\'' + esc(node.accountId) + '\',\'' + esc(node.messageId) + '\')">回到邮件查看正文</button>' : '') +
      '<div class="email-wiki-related"><strong>关联节点</strong>' + unique.slice(0, 24).map(function(item) {
        return '<button type="button" data-wiki-node="' + esc(item.id) + '">' + esc(item.label) + '</button>';
      }).join('') + (unique.length > 24 ? '<span>其余 ' + (unique.length - 24) + ' 个连接已在图中保留</span>' : '') + '</div>';
    host.querySelectorAll('[data-wiki-node]').forEach(function(button) {
      button.onclick = function() {
        var related = runtime.nodeById.get(button.getAttribute('data-wiki-node'));
        if (!related) return;
        runtime.selected = related;
        renderEmailWikiDetail(related);
      };
    });
  }

  function drawEmailWiki(runtime, timestamp) {
    if (!runtime || runtime !== emailWikiRuntime || !document.body.contains(runtime.canvas)) return;
    resizeEmailWikiCanvas(runtime);
    var context = runtime.context;
    var width = runtime.width;
    var height = runtime.height;
    context.clearRect(0, 0, width, height);

    var background = context.createRadialGradient(width * 0.48, height * 0.46, 10, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
    if (runtime.shapeMode === 'blackhole') {
      background.addColorStop(0, '#010205');
      background.addColorStop(0.42, '#070a11');
      background.addColorStop(1, '#000000');
    } else if (runtime.shapeMode === 'starfield' || runtime.shapeMode === 'starrynight') {
      background.addColorStop(0, '#07162b');
      background.addColorStop(0.56, '#040d1c');
      background.addColorStop(1, '#01040b');
    } else {
      background.addColorStop(0, '#17212b');
      background.addColorStop(0.58, '#111820');
      background.addColorStop(1, '#090c12');
    }
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    if (runtime.audioAnalyser && runtime.audioData) {
      runtime.audioAnalyser.getByteFrequencyData(runtime.audioData);
      var audioSum = 0;
      for (var audioIndex = 0; audioIndex < runtime.audioData.length; audioIndex += 1) audioSum += runtime.audioData[audioIndex];
      var measuredLevel = audioSum / Math.max(1, runtime.audioData.length) / 255;
      runtime.audioLevel = runtime.audioLevel * 0.76 + measuredLevel * 0.24;
    }

    var centerX = width * 0.5;
    var centerY = height * 0.5;
    var pulse = Math.sin((timestamp || 0) / 3200) * 0.018;
    runtime.links.forEach(function(link) {
      if (runtime.dragNode !== link.source && runtime.dragNode !== link.target) {
        var dx = link.target.x - link.source.x;
        var dy = link.target.y - link.source.y;
        var distance = Math.max(1, Math.hypot(dx, dy));
        var targetLength = link.type === 'owns' ? 95 : link.type === 'sent' ? 72 : 62;
        var pull = (distance - targetLength) * (runtime.shapeMode === 'circle' ? 0.000012 : 0.0000016);
        link.source.vx += dx * pull;
        link.source.vy += dy * pull;
        link.target.vx -= dx * pull;
        link.target.vy -= dy * pull;
      }
    });
    runtime.nodes.forEach(function(node) {
      if (runtime.dragNode === node) return;
      if (runtime.shapeMode === 'circle') {
        node.vx += (centerX - node.x) * 0.000008;
        node.vy += (centerY - node.y) * 0.000008;
      } else {
        node.vx += (node.shapeTargetX - node.x) * 0.0019;
        node.vy += (node.shapeTargetY - node.y) * 0.0019;
      }
      node.vx *= runtime.shapeMode === 'circle' ? 0.91 : 0.87;
      node.vy *= runtime.shapeMode === 'circle' ? 0.91 : 0.87;
      node.x += node.vx + Math.sin((timestamp + wikiHash(node.id)) / 9000) * pulse;
      node.y += node.vy + Math.cos((timestamp + wikiHash(node.id)) / 11000) * pulse;
    });

    runtime.nodes.forEach(function(node) { emailWikiDisplayPosition(runtime, node, timestamp); });

    context.save();
    context.translate(runtime.offsetX, runtime.offsetY);
    context.scale(runtime.scale, runtime.scale);
    var palette = emailWikiPalette(runtime.colorPalette);
    runtime.links.forEach(function(link) {
      var emphasized = runtime.selected && (link.source === runtime.selected || link.target === runtime.selected);
      context.beginPath();
      context.moveTo(link.source.drawX, link.source.drawY);
      context.lineTo(link.target.drawX, link.target.drawY);
      context.strokeStyle = emphasized ? 'rgba(' + palette.accent + ',.68)' : 'rgba(' + palette.link + ',' + (runtime.shapeMode === 'circle' ? '.12' : '.075') + ')';
      context.lineWidth = emphasized ? 1.15 / runtime.scale : 0.55 / runtime.scale;
      context.stroke();
    });
    runtime.nodes.forEach(function(node) {
      var active = node === runtime.hover || node === runtime.selected;
      context.beginPath();
      context.arc(node.drawX, node.drawY, node.radius * (active ? 1.45 : 1), 0, Math.PI * 2);
      context.fillStyle = emailWikiColor(node);
      context.globalAlpha = active ? 1 : (node.type === 'message' ? 0.66 : 0.9);
      context.fill();
      if (active) {
        context.lineWidth = 2 / runtime.scale;
        context.strokeStyle = '#ffffff';
        context.stroke();
      }
      context.globalAlpha = 1;
      if (active || node.type === 'account' || ((node.type === 'sender' || node.type === 'keyword') && Number(node.weight || 0) >= 8)) {
        context.font = (active ? '600 ' : '500 ') + Math.max(10, 12 / runtime.scale) + 'px system-ui, sans-serif';
        var label = String(node.label || '').slice(0, active ? 50 : 24);
        var labelX = node.drawX + node.radius + 5;
        context.textBaseline = 'middle';
        context.lineJoin = 'round';
        context.lineWidth = Math.max(2.6, 3.4 / runtime.scale);
        context.strokeStyle = 'rgba(3, 7, 12, .92)';
        context.strokeText(label, labelX, node.drawY);
        context.fillStyle = '#f8fafc';
        context.fillText(label, labelX, node.drawY);
      }
    });
    context.restore();
    runtime.frame = requestAnimationFrame(function(nextTimestamp) { drawEmailWiki(runtime, nextTimestamp); });
  }

  function bindEmailWikiCanvas(runtime) {
    runtime.canvas.addEventListener('pointerdown', function(event) {
      runtime.canvas.setPointerCapture(event.pointerId);
      runtime.dragNode = emailWikiNodeAt(runtime, event.clientX, event.clientY);
      runtime.pointerStart = { x: event.clientX, y: event.clientY, offsetX: runtime.offsetX, offsetY: runtime.offsetY };
      if (runtime.dragNode) {
        runtime.selected = runtime.dragNode;
        renderEmailWikiDetail(runtime.selected);
      }
    });
    runtime.canvas.addEventListener('pointermove', function(event) {
      if (runtime.pointerStart) {
        if (runtime.dragNode) {
          var rect = runtime.canvas.getBoundingClientRect();
          runtime.dragNode.x = (event.clientX - rect.left - runtime.offsetX) / runtime.scale;
          runtime.dragNode.y = (event.clientY - rect.top - runtime.offsetY) / runtime.scale;
          runtime.dragNode.vx = 0;
          runtime.dragNode.vy = 0;
        } else {
          runtime.offsetX = runtime.pointerStart.offsetX + event.clientX - runtime.pointerStart.x;
          runtime.offsetY = runtime.pointerStart.offsetY + event.clientY - runtime.pointerStart.y;
        }
        return;
      }
      runtime.hover = emailWikiNodeAt(runtime, event.clientX, event.clientY);
      runtime.canvas.style.cursor = runtime.hover ? 'pointer' : 'grab';
      if (!runtime.selected) renderEmailWikiDetail(runtime.hover);
    });
    var release = function(event) {
      if (runtime.canvas.hasPointerCapture && runtime.canvas.hasPointerCapture(event.pointerId)) runtime.canvas.releasePointerCapture(event.pointerId);
      runtime.dragNode = null;
      runtime.pointerStart = null;
    };
    runtime.canvas.addEventListener('pointerup', release);
    runtime.canvas.addEventListener('pointercancel', release);
    runtime.canvas.addEventListener('pointerleave', function() {
      runtime.hover = null;
      if (!runtime.selected) renderEmailWikiDetail(null);
    });
    runtime.canvas.addEventListener('contextmenu', function(event) {
      event.preventDefault();
      var node = emailWikiNodeAt(runtime, event.clientX, event.clientY);
      if (node) {
        runtime.selected = node;
        renderEmailWikiDetail(node);
      }
    });
    runtime.canvas.addEventListener('dblclick', function(event) {
      var node = emailWikiNodeAt(runtime, event.clientX, event.clientY);
      if (node && node.type === 'message') openEmailWikiMessage(node.accountId, node.messageId);
    });
    runtime.canvas.addEventListener('wheel', function(event) {
      event.preventDefault();
      var rect = runtime.canvas.getBoundingClientRect();
      var cursorX = event.clientX - rect.left;
      var cursorY = event.clientY - rect.top;
      var oldScale = runtime.scale;
      var factor = event.deltaY < 0 ? 1.12 : 0.89;
      runtime.scale = Math.max(0.25, Math.min(4, runtime.scale * factor));
      runtime.offsetX = cursorX - (cursorX - runtime.offsetX) * runtime.scale / oldScale;
      runtime.offsetY = cursorY - (cursorY - runtime.offsetY) * runtime.scale / oldScale;
    }, { passive: false });
  }

  async function showEmailWiki() {
    closeEmailWiki();
    window.showHomeUtilityPage('email-wiki', '邮件 Wiki', '全部邮箱的账户、发件人、邮件与关键词关系，仅保存在本机', emailWikiMarkup());
    var back = document.querySelector('#homeUtilityPage[data-page-id="email-wiki"] .home-utility-back');
    if (back) {
      back.onclick = showEmailWorkspace;
      back.title = '返回邮件';
      back.setAttribute('aria-label', '返回邮件');
    }
    try {
      var data = await jsonFetch('/api/email/wiki?userId=' + encodeURIComponent(userId()));
      var graph = data.graph || { counts: {}, nodes: [], links: [] };
      var counts = document.getElementById('emailWikiCounts');
      if (counts) counts.textContent = '账户 ' + Number(graph.counts.accounts || 0) + ' · 发件人 ' + Number(graph.counts.senders || 0) + ' · 邮件 ' + Number(graph.counts.messages || 0) + ' · 关键词 ' + Number(graph.counts.keywords || 0);
      var canvas = document.getElementById('emailWikiCanvas');
      if (!canvas) return;
      var context = canvas.getContext('2d');
      var rect = canvas.getBoundingClientRect();
      var prepared = prepareEmailWikiGraph(graph, Math.max(700, rect.width), Math.max(540, rect.height));
      emailWikiRuntime = Object.assign(prepared, {
        graph: graph,
        canvas: canvas,
        context: context,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        hover: null,
        selected: null,
        dragNode: null,
        pointerStart: null,
        frame: 0,
        width: 0,
        height: 0,
        ratio: 1,
        motionEffect: '',
        motionStartedAt: performance.now(),
        shapeMode: 'circle',
        shapeTransitionStartedAt: performance.now(),
        colorPalette: 'original',
        audioContext: null,
        audioStream: null,
        audioAnalyser: null,
        audioData: null,
        audioLevel: 0
      });
      resizeEmailWikiCanvas(emailWikiRuntime);
      assignEmailWikiShapeTargets(emailWikiRuntime);
      selectEmailWikiColorPalette('original');
      updateEmailWikiControlState(emailWikiRuntime);
      bindEmailWikiCanvas(emailWikiRuntime);
      drawEmailWiki(emailWikiRuntime, performance.now());
    } catch (error) {
      var shell = document.getElementById('emailWikiShell');
      if (shell) shell.innerHTML = '<div class="email-empty email-error-text">构建邮件 Wiki 失败：' + esc(error.message) + '</div>';
    }
  }

  function closeEmailWiki() {
    if (emailWikiRuntime && emailWikiRuntime.frame) cancelAnimationFrame(emailWikiRuntime.frame);
    stopEmailWikiAudio(emailWikiRuntime);
    emailWikiRuntime = null;
  }

  async function openEmailWikiMessage(accountId, messageId) {
    closeEmailWiki();
    await showEmailWorkspace();
    if (accountId && state.selectedAccountId !== accountId) await selectEmailAccount(accountId);
    await selectEmailMessage(messageId);
  }

  function closeEmailWorkspace() {
    // The mailbox event stream belongs to the application, not this page. It
    // must remain alive after closing the workspace so the header badge can
    // react to IMAP IDLE notifications in the background.
    document.body.classList.remove('email-page-open');
    state.deleteConfirmId = '';
    state.replyAttachments = [];
    state.composeMode = false;
    state.workspaceView = 'list';
    if (emailColumnResizeCleanup) emailColumnResizeCleanup();
    resetEmailSendConfirmation();
    closeEmailWiki();
  }

  window.showEmailWorkspace = showEmailWorkspace;
  window.showEmailSettingsPage = showEmailSettingsPage;
  window.chooseEmailProvider = chooseEmailProvider;
  window.openEmailProviderAuthorization = openEmailProviderAuthorization;
  window.toggleEmailAccountForm = toggleEmailAccountForm;
  window.syncEmailProviderFields = syncEmailProviderFields;
  window.syncSchoolEmailSettings = syncSchoolEmailSettings;
  window.addEmailAccount = addEmailAccount;
  window.removeSelectedEmailAccount = removeSelectedEmailAccount;
  window.startNewEmailCompose = startNewEmailCompose;
  window.selectEmailAccount = selectEmailAccount;
  window.selectEmailMessage = selectEmailMessage;
  window.retryEmailMessage = retryEmailMessage;
  window.syncSelectedEmailAccount = syncSelectedEmailAccount;
  window.generateEmailReplyDraft = generateEmailReplyDraft;
  window.copyEmailReplyDraft = copyEmailReplyDraft;
  window.resetEmailSendConfirmation = resetEmailSendConfirmation;
  window.sendEmailReply = sendEmailReply;
  window.chooseEmailReplyAttachments = chooseEmailReplyAttachments;
  window.addEmailReplyAttachments = addEmailReplyAttachments;
  window.removeEmailReplyAttachment = removeEmailReplyAttachment;
  window.handleEmailReplyAttachmentDrag = handleEmailReplyAttachmentDrag;
  window.dropEmailReplyAttachments = dropEmailReplyAttachments;
  window.openEmailAttachmentPreview = openEmailAttachmentPreview;
  window.handleEmailAttachmentPreviewKeydown = handleEmailAttachmentPreviewKeydown;
  window.setEmailMessageFilter = setEmailMessageFilter;
  window.setEmailSearchQuery = setEmailSearchQuery;
  window.clearEmailSearch = clearEmailSearch;
  window.showEmailInboxList = showEmailInboxList;
  window.startEmailColumnResize = startEmailColumnResize;
  window.nudgeEmailColumnWidth = nudgeEmailColumnWidth;
  window.setEmailFolder = setEmailFolder;
  window.markAllEmailRead = markAllEmailRead;
  window.closeEmailWorkspace = closeEmailWorkspace;
  window.refreshEmailUnreadBadge = refreshEmailUnreadBadge;
  window.showEmailWiki = showEmailWiki;
  window.openEmailWikiMessage = openEmailWikiMessage;
  window.openEmailBodyLink = openEmailBodyLink;
  window.handleEmailWikiControlToggle = handleEmailWikiControlToggle;
  window.selectEmailWikiMotion = selectEmailWikiMotion;
  window.selectEmailWikiShape = selectEmailWikiShape;
  window.selectEmailWikiColorPalette = selectEmailWikiColorPalette;
  window.restartEmailWikiGraph = restartEmailWikiGraph;
  window.fitEmailWikiGraph = fitEmailWikiGraph;

  function startEmailUnreadBadge() {
    connectEvents();
    refreshEmailBackgroundState();
    if (emailUnreadTimer) window.clearInterval(emailUnreadTimer);
    emailUnreadTimer = window.setInterval(refreshEmailBackgroundState, EMAIL_BADGE_POLL_INTERVAL_MS);
    if (!emailBackgroundListenersInstalled) {
      emailBackgroundListenersInstalled = true;
      document.addEventListener('visibilitychange', function() {
        if (!document.hidden) refreshEmailBackgroundState();
      });
      window.addEventListener('focus', refreshEmailBackgroundState);
      window.addEventListener('online', refreshEmailBackgroundState);
    }
  }

  function refreshEmailBackgroundState() {
    if (emailBackgroundRefreshPromise) return emailBackgroundRefreshPromise;
    connectEvents();
    emailBackgroundRefreshPromise = refreshEmailUnreadBadge()
      .catch(function() {})
      .finally(function() { emailBackgroundRefreshPromise = null; });
    return emailBackgroundRefreshPromise;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startEmailUnreadBadge, { once: true });
  else window.setTimeout(startEmailUnreadBadge, 0);

  if (window.ScholarHarnessModules) {
    window.ScholarHarnessModules.register('email-workspace', { source: '/app/email-workspace.js' });
  }
})();
