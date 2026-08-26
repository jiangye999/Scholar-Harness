(function() {
  var CHAT_BACKGROUND_KEY = 'scholarharness_chat_background';
  var CHAT_BACKGROUND_CUSTOM_KEY = 'scholarharness_chat_background_custom';
  var CHAT_BACKGROUND_OPACITY_KEY = 'scholarharness_chat_background_opacity';
  var CHAT_BACKGROUND_GROUP_KEY = 'scholarharness_chat_background_group';
  var CHAT_BACKGROUND_DB_NAME = 'scholarharness-chat-backgrounds';
  var CHAT_BACKGROUND_DB_STORE = 'custom-backgrounds';
  var CHAT_BACKGROUND_DB_VERSION = 1;
  var BUILTIN_BACKGROUND_COUNT = 107;
  var CUSTOM_IMAGE_MAX_EDGE = 1600;
  var CUSTOM_IMAGE_MAX_DATA_LENGTH = 3600000;
  var MAX_CUSTOM_BACKGROUND_COUNT = 50;
  var DEFAULT_BACKGROUND_GROUP = 'humanities';
  var CHAT_BACKGROUND_GROUPS = [
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
    },
    {
      id: 'custom',
      label: '自定义',
      indexes: []
    }
  ];
  var activePanel = 'color';
  var activeBackgroundGroup = DEFAULT_BACKGROUND_GROUP;
  var customBackgrounds = [];

  function padBackgroundNumber(value) {
    return String(value).padStart(2, '0');
  }

  function builtinBackgroundId(index) {
    return 'builtin-' + padBackgroundNumber(index);
  }

  function builtinBackgroundUrl(index) {
    return '/theme-backgrounds/chat-bg-' + padBackgroundNumber(index) + '.webp';
  }

  function customBackgroundSelection(id) {
    return 'custom-' + String(id || '');
  }

  function getCustomBackgroundId(selection) {
    var value = String(selection || '');
    return value.indexOf('custom-') === 0 ? value.slice(7) : '';
  }

  function getCustomBackgroundRecord(selection) {
    var id = getCustomBackgroundId(selection);
    if (!id && selection === 'custom' && customBackgrounds.length) return customBackgrounds[0];
    return customBackgrounds.find(function(item) { return item.id === id; }) || null;
  }

  function openCustomBackgroundDatabase() {
    return new Promise(function(resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('当前环境不支持自定义背景图库'));
        return;
      }
      var request = window.indexedDB.open(CHAT_BACKGROUND_DB_NAME, CHAT_BACKGROUND_DB_VERSION);
      request.onupgradeneeded = function() {
        var database = request.result;
        if (!database.objectStoreNames.contains(CHAT_BACKGROUND_DB_STORE)) {
          database.createObjectStore(CHAT_BACKGROUND_DB_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = function() { resolve(request.result); };
      request.onerror = function() { reject(request.error || new Error('无法打开自定义背景图库')); };
    });
  }

  function runCustomBackgroundStore(mode, operation) {
    return openCustomBackgroundDatabase().then(function(database) {
      return new Promise(function(resolve, reject) {
        var transaction = database.transaction(CHAT_BACKGROUND_DB_STORE, mode);
        var store = transaction.objectStore(CHAT_BACKGROUND_DB_STORE);
        var request = operation(store);
        request.onsuccess = function() { resolve(request.result); };
        request.onerror = function() { reject(request.error || new Error('自定义背景图库操作失败')); };
        transaction.oncomplete = function() { database.close(); };
        transaction.onerror = function() { database.close(); };
        transaction.onabort = function() { database.close(); };
      });
    });
  }

  function readCustomBackgrounds() {
    return runCustomBackgroundStore('readonly', function(store) { return store.getAll(); })
      .then(function(items) {
        return (Array.isArray(items) ? items : []).sort(function(left, right) {
          return Number(right.createdAt || 0) - Number(left.createdAt || 0);
        });
      });
  }

  function saveCustomBackgroundRecord(record) {
    return runCustomBackgroundStore('readwrite', function(store) { return store.put(record); });
  }

  function saveCustomBackgroundRecords(records) {
    return openCustomBackgroundDatabase().then(function(database) {
      return new Promise(function(resolve, reject) {
        var transaction = database.transaction(CHAT_BACKGROUND_DB_STORE, 'readwrite');
        var store = transaction.objectStore(CHAT_BACKGROUND_DB_STORE);
        records.forEach(function(record) { store.put(record); });
        transaction.oncomplete = function() {
          database.close();
          resolve();
        };
        transaction.onerror = function() {
          var error = transaction.error || new Error('自定义背景批量保存失败');
          database.close();
          reject(error);
        };
        transaction.onabort = function() {
          var error = transaction.error || new Error('自定义背景批量保存已取消');
          database.close();
          reject(error);
        };
      });
    });
  }

  function removeCustomBackgroundRecord(id) {
    return runCustomBackgroundStore('readwrite', function(store) { return store.delete(id); });
  }

  function createCustomBackgroundId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  async function loadCustomBackgroundGallery() {
    var records = [];
    try {
      records = await readCustomBackgrounds();
    } catch (error) {
      console.warn('[ChatBackground] Failed to load custom gallery:', error);
    }

    var legacyImage = '';
    try {
      legacyImage = localStorage.getItem(CHAT_BACKGROUND_CUSTOM_KEY) || '';
    } catch (error) {
      legacyImage = '';
    }
    if (legacyImage && !records.some(function(item) { return item.legacy === true; })) {
      var legacyRecord = {
        id: 'legacy',
        name: '原自定义背景',
        dataUrl: legacyImage,
        createdAt: Date.now(),
        legacy: true
      };
      try {
        await saveCustomBackgroundRecord(legacyRecord);
        records.unshift(legacyRecord);
        localStorage.removeItem(CHAT_BACKGROUND_CUSTOM_KEY);
      } catch (error) {
        console.warn('[ChatBackground] Failed to migrate legacy custom background:', error);
        if (!records.length) records.push(legacyRecord);
      }
    }
    customBackgrounds = records.slice(0, MAX_CUSTOM_BACKGROUND_COUNT);

    try {
      if (localStorage.getItem(CHAT_BACKGROUND_KEY) === 'custom' && customBackgrounds.length) {
        localStorage.setItem(CHAT_BACKGROUND_KEY, customBackgroundSelection(customBackgrounds[0].id));
      }
    } catch (error) {
      // Selection migration is best effort.
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
      return group.id !== 'custom' && group.indexes.indexOf(index) !== -1;
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
      if (saved === 'featured') return 'custom';
      if (getBackgroundGroup(saved)) return saved;
    } catch (error) {
      // Local storage can be unavailable in hardened Electron sessions.
    }

    if (String(selection || '').indexOf('custom') === 0) return 'custom';
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
    var customRecord = getCustomBackgroundRecord(selection);
    if (customRecord) return customBackgroundSelection(customRecord.id);
    var match = String(selection || '').match(/^builtin-(\d{2,3})$/);
    if (!match) return 'none';
    var index = Number(match[1]);
    return index >= 1 && index <= BUILTIN_BACKGROUND_COUNT
      ? builtinBackgroundId(index)
      : 'none';
  }

  function resolveChatBackgroundUrl(selection) {
    var customRecord = getCustomBackgroundRecord(selection);
    if (customRecord) return customRecord.dataUrl;
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
      detail: { background: normalized, custom: normalized.indexOf('custom-') === 0 }
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

  function createCustomBackgroundOption(record) {
    var shell = document.createElement('div');
    shell.className = 'chat-background-custom-card';
    shell.appendChild(createBackgroundOption(
      customBackgroundSelection(record.id),
      record.name || '自定义背景',
      record.dataUrl,
      'chat-background-option-custom'
    ));

    var removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'chat-background-custom-remove';
    removeButton.setAttribute('aria-label', '删除背景 ' + (record.name || ''));
    removeButton.setAttribute('title', '删除这张背景');
    removeButton.textContent = '×';
    removeButton.addEventListener('click', async function(event) {
      event.preventDefault();
      event.stopPropagation();
      try {
        var removedSelection = customBackgroundSelection(record.id);
        var wasSelected = getSavedBackground() === removedSelection;
        await removeCustomBackgroundRecord(record.id);
        customBackgrounds = customBackgrounds.filter(function(item) { return item.id !== record.id; });
        if (wasSelected) {
          applyChatBackground(customBackgrounds.length
            ? customBackgroundSelection(customBackgrounds[0].id)
            : 'none', true);
        }
        renderChatBackgroundGroups();
        renderChatBackgroundOptions();
      } catch (error) {
        console.warn('[ChatBackground] Failed to remove custom background:', error);
        alert(error && error.message ? error.message : '删除自定义背景失败');
      }
    });
    shell.appendChild(removeButton);
    return shell;
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
        '<small>' + (group.id === 'custom' ? customBackgrounds.length : group.indexes.length) + '</small>';
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

    var activeGroup = getBackgroundGroup(activeBackgroundGroup) ||
      getBackgroundGroup(DEFAULT_BACKGROUND_GROUP);
    if (activeGroup && activeGroup.id === 'custom') {
      customBackgrounds.forEach(function(record) {
        container.appendChild(createCustomBackgroundOption(record));
      });
      if (!customBackgrounds.length) {
        var empty = document.createElement('div');
        empty.className = 'chat-background-custom-empty';
        empty.textContent = '还没有自定义背景，可以一次选择多张图片上传。';
        container.appendChild(empty);
      }
      updateChatBackgroundControls(normalizeChatBackground(getSavedBackground()));
      return;
    }
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
    var files = input && input.files ? Array.from(input.files) : [];
    if (!files.length) return;
    try {
      if (customBackgrounds.length + files.length > MAX_CUSTOM_BACKGROUND_COUNT) {
        throw new Error('自定义背景最多保存 ' + MAX_CUSTOM_BACKGROUND_COUNT + ' 张，请先删除不需要的图片');
      }
      var added = [];
      for (var fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        var file = files[fileIndex];
        var optimized = await compressCustomBackground(file);
        var record = {
          id: createCustomBackgroundId(),
          name: String(file.name || ('自定义背景 ' + (customBackgrounds.length + added.length + 1))),
          dataUrl: optimized,
          createdAt: Date.now() + fileIndex
        };
        added.push(record);
      }
      await saveCustomBackgroundRecords(added);
      customBackgrounds = added.slice().reverse().concat(customBackgrounds);
      activeBackgroundGroup = 'custom';
      localStorage.setItem(CHAT_BACKGROUND_GROUP_KEY, 'custom');
      var selectedBackground = customBackgroundSelection(added[added.length - 1].id);
      localStorage.setItem(CHAT_BACKGROUND_KEY, selectedBackground);
      renderChatBackgroundGroups();
      renderChatBackgroundOptions();
      applyChatBackground(selectedBackground, false);
      switchThemePickerPanel('background');
    } catch (error) {
      console.warn('[ChatBackground] Custom background failed:', error);
      alert(error && error.message ? error.message : '自定义聊天背景设置失败');
    } finally {
      input.value = '';
    }
  }

  async function initChatBackgrounds() {
    await loadCustomBackgroundGallery();
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
    document.addEventListener('DOMContentLoaded', function() {
      initChatBackgrounds().catch(function(error) {
        console.warn('[ChatBackground] Initialization failed:', error);
      });
    }, { once: true });
  } else {
    initChatBackgrounds().catch(function(error) {
      console.warn('[ChatBackground] Initialization failed:', error);
    });
  }
})();

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('chat-backgrounds', { source: '/app/chat-backgrounds.js' });
}
