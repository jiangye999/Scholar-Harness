(function() {
  var CHAT_BACKGROUND_KEY = 'scholarharness_chat_background';
  var CHAT_BACKGROUND_CUSTOM_KEY = 'scholarharness_chat_background_custom';
  var CHAT_BACKGROUND_OPACITY_KEY = 'scholarharness_chat_background_opacity';
  var CHAT_BACKGROUND_GROUP_KEY = 'scholarharness_chat_background_group';
  var BUILTIN_BACKGROUND_COUNT = 107;
  var CUSTOM_IMAGE_MAX_EDGE = 1600;
  var CUSTOM_IMAGE_MAX_DATA_LENGTH = 3600000;
  var DEFAULT_BACKGROUND_GROUP = 'featured';
  var CHAT_BACKGROUND_GROUPS = [
    {
      id: 'featured',
      label: '推荐',
      indexes: [2, 11, 22, 27, 32, 41, 43, 46, 52, 58, 64, 65, 78, 85, 93, 96, 105, 107]
    },
    {
      id: 'humanities',
      label: '人文古建',
      indexes: [2, 4, 5, 8, 19, 24, 28, 30, 31, 32, 33, 34, 35, 38, 39, 42, 44, 70]
    },
    {
      id: 'architecture',
      label: '城市建筑',
      indexes: [3, 6, 7, 9, 12, 13, 16, 17, 20, 21, 36, 37, 40, 61, 63, 78, 92, 105]
    },
    {
      id: 'landscape',
      label: '山林旷野',
      indexes: [18, 22, 26, 43, 46, 50, 52, 53, 54, 55, 56, 57, 65, 66, 81, 86, 87, 88, 89, 93, 101, 102, 104]
    },
    {
      id: 'flora',
      label: '花草生灵',
      indexes: [51, 64, 67, 68, 69, 71, 72, 73, 74, 75, 76, 83, 84]
    },
    {
      id: 'sky-sea',
      label: '海天云光',
      indexes: [11, 23, 27, 48, 58, 59, 60, 62, 82, 85, 90, 91, 103]
    },
    {
      id: 'art',
      label: '艺术纹理',
      indexes: [1, 10, 14, 15, 25, 29, 41, 45, 47, 49, 77, 79, 80, 94, 95, 96, 97, 98, 99, 100, 106, 107]
    }
  ];
  var activePanel = 'color';
  var activeBackgroundGroup = DEFAULT_BACKGROUND_GROUP;

  function padBackgroundNumber(value) {
    return String(value).padStart(2, '0');
  }

  function builtinBackgroundId(index) {
    return 'builtin-' + padBackgroundNumber(index);
  }

  function builtinBackgroundUrl(index) {
    return '/theme-backgrounds/chat-bg-' + padBackgroundNumber(index) + '.webp';
  }

  function getCustomBackground() {
    try {
      return localStorage.getItem(CHAT_BACKGROUND_CUSTOM_KEY) || '';
    } catch (error) {
      return '';
    }
  }

  function getSavedBackground() {
    try {
      return localStorage.getItem(CHAT_BACKGROUND_KEY) || 'none';
    } catch (error) {
      return 'none';
    }
  }

  function getBackgroundGroup(groupId) {
    return CHAT_BACKGROUND_GROUPS.find(function(group) {
      return group.id === groupId;
    }) || null;
  }

  function getPrimaryGroupForIndex(index) {
    return CHAT_BACKGROUND_GROUPS.find(function(group) {
      return group.id !== 'featured' && group.indexes.indexOf(index) !== -1;
    }) || getBackgroundGroup(DEFAULT_BACKGROUND_GROUP);
  }

  function normalizeBackgroundGroup(groupId) {
    return getBackgroundGroup(String(groupId || ''))
      ? String(groupId)
      : DEFAULT_BACKGROUND_GROUP;
  }

  function getSavedBackgroundGroup(selection) {
    try {
      var saved = localStorage.getItem(CHAT_BACKGROUND_GROUP_KEY);
      if (getBackgroundGroup(saved)) return saved;
    } catch (error) {
      // Local storage can be unavailable in hardened Electron sessions.
    }

    var match = String(selection || '').match(/^builtin-(\d{2,3})$/);
    if (!match) return DEFAULT_BACKGROUND_GROUP;
    var primaryGroup = getPrimaryGroupForIndex(Number(match[1]));
    return primaryGroup ? primaryGroup.id : DEFAULT_BACKGROUND_GROUP;
  }

  function normalizeChatBackgroundOpacity(value) {
    if (value === null || value === undefined || value === '') return 100;
    var numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 100;
    return Math.min(100, Math.max(0, Math.round(numericValue)));
  }

  function getSavedChatBackgroundOpacity() {
    try {
      return normalizeChatBackgroundOpacity(localStorage.getItem(CHAT_BACKGROUND_OPACITY_KEY));
    } catch (error) {
      return 100;
    }
  }

  function getMainWrapper() {
    var chatContainer = document.getElementById('chatContainer');
    return chatContainer && chatContainer.closest
      ? chatContainer.closest('.main-wrapper')
      : document.querySelector('.main-wrapper');
  }

  function getChatBackgroundHost() {
    return document.body || document.documentElement;
  }

  function updateChatBackgroundOpacityControl(value) {
    var normalized = normalizeChatBackgroundOpacity(value);
    var input = document.getElementById('chatBackgroundOpacity');
    var output = document.getElementById('chatBackgroundOpacityValue');
    if (input) {
      input.value = String(normalized);
      input.setAttribute('aria-valuetext', normalized + '%');
    }
    if (output) {
      output.value = normalized + '%';
      output.textContent = normalized + '%';
    }
  }

  function applyChatBackgroundOpacity(value, persist) {
    var normalized = normalizeChatBackgroundOpacity(value);
    var mainWrapper = getMainWrapper();
    var backgroundHost = getChatBackgroundHost();
    if (backgroundHost) {
      backgroundHost.style.setProperty('--chat-background-opacity', String(normalized / 100));
    }
    if (mainWrapper) {
      mainWrapper.style.setProperty('--chat-background-opacity', String(normalized / 100));
    }
    updateChatBackgroundOpacityControl(normalized);

    if (persist !== false) {
      try {
        localStorage.setItem(CHAT_BACKGROUND_OPACITY_KEY, String(normalized));
      } catch (error) {
        console.warn('[ChatBackground] Failed to persist opacity:', error);
      }
    }
    window.dispatchEvent(new CustomEvent('scholarharness:chat-background-opacity-change', {
      detail: { percent: normalized, opacity: normalized / 100 }
    }));
    return normalized;
  }

  function normalizeChatBackground(selection) {
    if (selection === 'none') return 'none';
    if (selection === 'custom' && getCustomBackground()) return 'custom';
    var match = String(selection || '').match(/^builtin-(\d{2,3})$/);
    if (!match) return 'none';
    var index = Number(match[1]);
    return index >= 1 && index <= BUILTIN_BACKGROUND_COUNT
      ? builtinBackgroundId(index)
      : 'none';
  }

  function resolveChatBackgroundUrl(selection) {
    if (selection === 'custom') return getCustomBackground();
    var match = String(selection || '').match(/^builtin-(\d{2,3})$/);
    return match ? builtinBackgroundUrl(Number(match[1])) : '';
  }

  function updateChatBackgroundControls(selection) {
    document.querySelectorAll('[data-chat-background-option]').forEach(function(button) {
      var selected = button.getAttribute('data-chat-background-option') === selection;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
  }

  function applyChatBackground(selection, persist) {
    var normalized = normalizeChatBackground(selection);
    var mainWrapper = getMainWrapper();
    var backgroundHost = getChatBackgroundHost();
    var imageUrl = resolveChatBackgroundUrl(normalized);

    if (backgroundHost) {
      if (imageUrl) {
        backgroundHost.style.setProperty('--chat-background-image', 'url("' + imageUrl + '")');
        backgroundHost.classList.add('chat-background-active');
      } else {
        backgroundHost.style.removeProperty('--chat-background-image');
        backgroundHost.classList.remove('chat-background-active');
      }
    }

    // Keep the legacy wrapper state for integrations that still inspect it.
    // The actual image is painted by the fixed-size .app layer so opening or
    // resizing either sidebar cannot change the background composition.
    if (mainWrapper) {
      if (imageUrl) {
        mainWrapper.style.setProperty('--chat-background-image', 'url("' + imageUrl + '")');
        mainWrapper.classList.add('chat-background-active');
      } else {
        mainWrapper.style.removeProperty('--chat-background-image');
        mainWrapper.classList.remove('chat-background-active');
      }
    }

    if (persist !== false) {
      try {
        localStorage.setItem(CHAT_BACKGROUND_KEY, normalized);
      } catch (error) {
        console.warn('[ChatBackground] Failed to persist selection:', error);
      }
    }
    updateChatBackgroundControls(normalized);
    window.dispatchEvent(new CustomEvent('scholarharness:chat-background-change', {
      detail: { background: normalized, custom: normalized === 'custom' }
    }));
    return normalized;
  }

  function createBackgroundOption(selection, label, imageUrl, extraClass, showLabel) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-background-option' + (extraClass ? ' ' + extraClass : '');
    button.setAttribute('data-chat-background-option', selection);
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', 'false');
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);

    if (imageUrl) {
      var image = document.createElement('img');
      image.src = imageUrl;
      image.alt = label;
      image.loading = 'lazy';
      image.decoding = 'async';
      button.appendChild(image);
    }

    if (showLabel !== false) {
      var text = document.createElement('span');
      text.className = 'chat-background-option-label';
      text.textContent = label;
      button.appendChild(text);
    }
    button.addEventListener('click', function(event) {
      event.stopPropagation();
      applyChatBackground(selection, true);
    });
    return button;
  }

  function renderChatBackgroundGroups() {
    var container = document.getElementById('chatBackgroundGroups');
    if (!container) return;
    container.innerHTML = '';

    CHAT_BACKGROUND_GROUPS.forEach(function(group) {
      var button = document.createElement('button');
      var selected = group.id === activeBackgroundGroup;
      button.type = 'button';
      button.className = 'chat-background-group' + (selected ? ' active' : '');
      button.setAttribute('data-chat-background-group', group.id);
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.setAttribute('aria-controls', 'chatBackgroundOptions');
      button.innerHTML =
        '<span>' + group.label + '</span>' +
        '<small>' + group.indexes.length + '</small>';
      button.addEventListener('click', function(event) {
        event.stopPropagation();
        activeBackgroundGroup = group.id;
        try {
          localStorage.setItem(CHAT_BACKGROUND_GROUP_KEY, group.id);
        } catch (error) {
          console.warn('[ChatBackground] Failed to persist group:', error);
        }
        renderChatBackgroundGroups();
        renderChatBackgroundOptions();
      });
      container.appendChild(button);
    });
  }

  function renderChatBackgroundOptions() {
    var container = document.getElementById('chatBackgroundOptions');
    if (!container) return;
    container.innerHTML = '';
    container.appendChild(createBackgroundOption(
      'none',
      '无背景',
      '',
      'chat-background-option-none'
    ));

    var customImage = getCustomBackground();
    if (customImage) {
      container.appendChild(createBackgroundOption(
        'custom',
        '自定义背景',
        customImage,
        'chat-background-option-custom'
      ));
    }

    var activeGroup = getBackgroundGroup(activeBackgroundGroup) ||
      getBackgroundGroup(DEFAULT_BACKGROUND_GROUP);
    (activeGroup ? activeGroup.indexes : []).forEach(function(index) {
      container.appendChild(createBackgroundOption(
        builtinBackgroundId(index),
        (activeGroup ? activeGroup.label : '内置') + '背景',
        builtinBackgroundUrl(index),
        '',
        false
      ));
    });
    updateChatBackgroundControls(normalizeChatBackground(getSavedBackground()));
  }

  function switchThemePickerPanel(panel, event) {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    activePanel = panel === 'background' ? 'background' : 'color';
    var colorPanel = document.getElementById('colorThemePanel');
    var backgroundPanel = document.getElementById('chatBackgroundPanel');
    var colorTab = document.getElementById('colorThemeTab');
    var backgroundTab = document.getElementById('chatBackgroundTab');
    var showBackground = activePanel === 'background';

    if (colorPanel) colorPanel.hidden = showBackground;
    if (backgroundPanel) backgroundPanel.hidden = !showBackground;
    if (colorTab) {
      colorTab.classList.toggle('active', !showBackground);
      colorTab.setAttribute('aria-selected', showBackground ? 'false' : 'true');
    }
    if (backgroundTab) {
      backgroundTab.classList.toggle('active', showBackground);
      backgroundTab.setAttribute('aria-selected', showBackground ? 'true' : 'false');
    }

    if (typeof window.positionColorThemePicker === 'function') {
      requestAnimationFrame(window.positionColorThemePicker);
    }
  }

  function chooseCustomChatBackground(event) {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    var input = document.getElementById('customChatBackgroundInput');
    if (input) input.click();
  }

  function readFileAsDataUrl(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(String(reader.result || '')); };
      reader.onerror = function() { reject(reader.error || new Error('读取图片失败')); };
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl) {
    return new Promise(function(resolve, reject) {
      var image = new Image();
      image.onload = function() { resolve(image); };
      image.onerror = function() { reject(new Error('无法识别该图片')); };
      image.src = dataUrl;
    });
  }

  async function compressCustomBackground(file) {
    if (!file || !/^image\/(?:png|jpeg|webp|gif)$/i.test(String(file.type || ''))) {
      throw new Error('请选择 PNG、JPG、WebP 或 GIF 图片');
    }
    var sourceDataUrl = await readFileAsDataUrl(file);
    var image = await loadImage(sourceDataUrl);
    var scale = Math.min(1, CUSTOM_IMAGE_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    var context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('当前环境无法处理该图片');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    var qualitySteps = [0.78, 0.66, 0.54];
    var optimized = '';
    for (var index = 0; index < qualitySteps.length; index += 1) {
      optimized = canvas.toDataURL('image/webp', qualitySteps[index]);
      if (optimized.length <= CUSTOM_IMAGE_MAX_DATA_LENGTH) break;
    }
    if (!optimized || optimized.length > CUSTOM_IMAGE_MAX_DATA_LENGTH) {
      throw new Error('图片压缩后仍然过大，请选择尺寸更小的图片');
    }
    return optimized;
  }

  async function handleCustomChatBackgroundChange(event) {
    var input = event && event.target;
    var file = input && input.files && input.files[0];
    if (!file) return;
    try {
      var optimized = await compressCustomBackground(file);
      localStorage.setItem(CHAT_BACKGROUND_CUSTOM_KEY, optimized);
      localStorage.setItem(CHAT_BACKGROUND_KEY, 'custom');
      renderChatBackgroundOptions();
      applyChatBackground('custom', false);
      switchThemePickerPanel('background');
    } catch (error) {
      console.warn('[ChatBackground] Custom background failed:', error);
      alert(error && error.message ? error.message : '自定义聊天背景设置失败');
    } finally {
      input.value = '';
    }
  }

  function initChatBackgrounds() {
    activeBackgroundGroup = getSavedBackgroundGroup(getSavedBackground());
    renderChatBackgroundGroups();
    renderChatBackgroundOptions();
    applyChatBackgroundOpacity(getSavedChatBackgroundOpacity(), false);
    applyChatBackground(getSavedBackground(), false);

    var input = document.getElementById('customChatBackgroundInput');
    if (input) input.addEventListener('change', handleCustomChatBackgroundChange);
    var opacityInput = document.getElementById('chatBackgroundOpacity');
    if (opacityInput) {
      opacityInput.addEventListener('input', function(event) {
        applyChatBackgroundOpacity(event.target.value, false);
      });
      opacityInput.addEventListener('change', function(event) {
        applyChatBackgroundOpacity(event.target.value, true);
      });
    }
  }

  window.switchThemePickerPanel = switchThemePickerPanel;
  window.chooseCustomChatBackground = chooseCustomChatBackground;
  window.applyChatBackground = applyChatBackground;
  window.applyChatBackgroundOpacity = applyChatBackgroundOpacity;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChatBackgrounds, { once: true });
  } else {
    initChatBackgrounds();
  }
})();

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('chat-backgrounds', { source: '/app/chat-backgrounds.js' });
}
