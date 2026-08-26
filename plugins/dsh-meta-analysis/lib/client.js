/**
 * dsh-meta-analysis — browser half. Runs inside the dsh web GUI.
 *
 * Renders a sidebar entry (「Meta 分析」) and a full Meta analysis workspace in
 * the center column, replicating the Scholar Harness Meta module's interface:
 * project/source management, coding-table editor (columns/rows), figure
 * digitization import, inspect → effect-size config → run, and results.
 * Pure DOM + fetch (no React, no platform module imports), hand-authored in
 * the loader closure format. Data lives on the host at /api/dsh-meta/* — zero
 * connection to Scholar Harness.
 */
window.__ModuleLoader__.load({
  id: "dsh-meta-analysis",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    /* ------------------------------------------------------------------ *
     * Constants
     * ------------------------------------------------------------------ */

    var ENTRY_SELECTOR = "[data-dsh-meta-entry]";
    var VIEW_SELECTOR = "[data-dsh-meta-view]";
    var ACTIVE_ATTR = "data-dsh-meta-active";
    var OTHER_ACTIVE_ATTRS = ["data-dsh-taskboard-active", "data-dsh-ssh-active", "data-dsh-scholar-active"];
    var ACTIVATE_EVENT = "dsh-panel-activate";
    var PANEL_NAME = "meta-analysis";
    var CONVERSATION_COLUMN_SELECTOR = "[data-pane=\"conversation\"]";
    var API = {
      status: "/api/dsh-meta/status",
      sources: "/api/dsh-meta/sources",
      sourceDetail: "/api/dsh-meta/sources/detail",
      sourceAdd: "/api/dsh-meta/sources/add",
      sourceDelete: "/api/dsh-meta/sources/delete",
      codingColumnsAdd: "/api/dsh-meta/coding/columns/add",
      codingRowsAdd: "/api/dsh-meta/coding/rows/add",
      codingSave: "/api/dsh-meta/coding/save",
      codingDelete: "/api/dsh-meta/coding/delete",
      digitizationImport: "/api/dsh-meta/digitization/import",
      inspect: "/api/dsh-meta/inspect",
      run: "/api/dsh-meta/run",
      analyses: "/api/dsh-meta/analyses",
      analysisDetail: "/api/dsh-meta/analyses/detail",
      analysisDelete: "/api/dsh-meta/analyses/delete",
    };

    var ICON = "<svg viewBox=\"0 0 16 16\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M2 13.5h12\"/><path d=\"M3 13.5V9h2.5v4.5\"/><path d=\"M7 13.5V4h2.5v9.5\"/><path d=\"M11 13.5V6.5h2.5v7\"/></svg>";

    /* ------------------------------------------------------------------ *
     * Stylesheet (injected once; scoped by data attributes)
     * ------------------------------------------------------------------ */

    var STYLE_ID = "dsh-meta-analysis/styles.css";
    var CSS = [
      "[data-pane='conversation'] { position: relative; }",
      "[data-dsh-meta-view] { position: absolute; inset: 0; display: none; z-index: 60; overflow: auto; background: var(--dsw-alias-bg-base, #fff); }",
      "html[data-dsh-meta-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]):not([data-dsh-scholar-active]) [data-dsh-meta-view] { display: block; }",
      "html[data-dsh-meta-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]):not([data-dsh-scholar-active]) [data-pane='conversation'] > :not([data-dsh-meta-view]),",
      "html[data-dsh-meta-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]):not([data-dsh-scholar-active]) [class*='centerCol'] > :not([data-dsh-meta-view]) { display: none !important; }",
      ".dsh-meta-entry { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 12px; background: transparent; border: none; border-radius: 8px; color: var(--dsw-alias-label-secondary, #666); cursor: pointer; font-size: 13px; }",
      ".dsh-meta-entry:hover { background: var(--dsw-alias-bg-hover, rgba(0,0,0,0.06)); color: var(--dsw-alias-label, #222); }",
      ".dsh-meta-entry[data-active='true'] { background: var(--dsw-alias-bg-active, rgba(0,0,0,0.1)); color: var(--dsw-alias-label, #222); }",
      ".dsh-meta-entry-icon { display: inline-flex; }",
      ".dsh-meta-view { padding: 20px; color: var(--dsw-alias-label, #222); font-size: 14px; }",
      ".dsh-meta-heading { margin: 0 0 12px; font-size: 18px; font-weight: 600; }",
      ".dsh-meta-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }",
      ".dsh-meta-tabs { display: flex; gap: 4px; flex-wrap: wrap; }",
      ".dsh-meta-tab { padding: 6px 12px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary, #666); cursor: pointer; font-size: 13px; }",
      ".dsh-meta-tab.active { background: var(--dsw-alias-bg-active, rgba(0,0,0,0.1)); color: var(--dsw-alias-label, #222); font-weight: 600; }",
      ".dsh-meta-btn { padding: 6px 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-border, #ddd); background: transparent; color: var(--dsw-alias-label, #222); cursor: pointer; font-size: 13px; }",
      ".dsh-meta-btn.primary { border-color: #111827; background: #111827; color: #d4a017; font-weight: 700; }",
      ".dsh-meta-btn.accent { border-color: var(--dsw-alias-accent, #10a37f); background: transparent; color: var(--dsw-alias-accent, #10a37f); }",
      ".dsh-meta-btn:disabled { opacity: 0.55; cursor: not-allowed; }",
      ".dsh-meta-card { border: 1px solid var(--dsw-alias-border, #eee); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; background: var(--dsw-alias-bg-card, #fff); }",
      ".dsh-meta-card-title { margin: 0 0 8px; font-size: 14px; font-weight: 600; }",
      ".dsh-meta-muted { color: var(--dsw-alias-label-tertiary, #999); font-size: 13px; }",
      ".dsh-meta-grid { display: grid; grid-template-columns: 320px 1fr; gap: 14px; min-height: 0; }",
      ".dsh-meta-source-list { border: 1px solid var(--dsw-alias-border, #eee); border-radius: 12px; overflow: auto; max-height: 600px; }",
      ".dsh-meta-source-item { padding: 10px 12px; border-bottom: 1px solid var(--dsw-alias-border, #f0f0f0); cursor: pointer; font-size: 13px; }",
      ".dsh-meta-source-item:hover { background: var(--dsw-alias-bg-hover, rgba(0,0,0,0.04)); }",
      ".dsh-meta-source-item.active { background: var(--dsw-alias-bg-active, rgba(0,0,0,0.08)); }",
      ".dsh-meta-table-wrap { overflow: auto; max-height: 480px; border: 1px solid var(--dsw-alias-border, #eee); border-radius: 8px; }",
      ".dsh-meta-table { border-collapse: collapse; font-size: 12px; width: max-content; min-width: 100%; }",
      ".dsh-meta-table th { position: sticky; top: 0; background: var(--dsw-alias-bg-card, #fff); padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border, #eee); border-right: 1px solid var(--dsw-alias-border, #f0f0f0); color: var(--dsw-alias-label-secondary, #666); font-weight: 600; text-align: left; white-space: nowrap; }",
      ".dsh-meta-table td { padding: 5px 8px; border-bottom: 1px solid var(--dsw-alias-border, #f0f0f0); border-right: 1px solid var(--dsw-alias-border, #f5f5f5); vertical-align: top; white-space: pre-wrap; word-break: break-word; }",
      ".dsh-meta-table textarea { width: 100%; min-width: 140px; height: 44px; resize: vertical; border: 1px solid var(--dsw-alias-border, #ddd); border-radius: 6px; padding: 5px 6px; font-size: 12px; background: var(--dsw-alias-bg-input, #fff); color: var(--dsw-alias-label, #222); }",
      ".dsh-meta-toolbar { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }",
      ".dsh-meta-input { padding: 6px 8px; border: 1px solid var(--dsw-alias-border, #ddd); border-radius: 6px; font-size: 12px; background: var(--dsw-alias-bg-input, #fff); color: var(--dsw-alias-label, #222); }",
      ".dsh-meta-select { padding: 6px 8px; border: 1px solid var(--dsw-alias-border, #ddd); border-radius: 6px; font-size: 12px; background: var(--dsw-alias-bg-input, #fff); color: var(--dsw-alias-label, #222); }",
      ".dsh-meta-warn { color: #f59e0b; font-size: 12px; }",
      ".dsh-meta-ok { color: var(--dsw-alias-accent, #10a37f); }",
      ".dsh-meta-outcome { border: 1px solid var(--dsw-alias-border, #eee); border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; background: var(--dsw-alias-bg-card, #fff); }",
      ".dsh-meta-outcome h4 { margin: 0 0 8px; font-size: 13px; }",
      ".dsh-meta-role-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; }",
      ".dsh-meta-role-cell { font-size: 11px; }",
      ".dsh-meta-role-cell select { width: 100%; font-size: 11px; }",
      ".dsh-meta-analysis-row { display: flex; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--dsw-alias-border, #f0f0f0); font-size: 12px; }",
      ".dsh-meta-pre { white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.5; }",
      ".dsh-meta-summary-table td, .dsh-meta-summary-table th { padding: 5px 8px; border: 1px solid var(--dsw-alias-border, #eee); font-size: 12px; }",
    ].join("\n");

    function injectStyles() {
      try {
        if (document.querySelector("style[data-plugin-css=\"" + STYLE_ID + "\"]") !== null) return;
        var tag = document.createElement("style");
        tag.dataset.plugin = "dsh-meta-analysis";
        tag.dataset.pluginCss = STYLE_ID;
        tag.textContent = CSS;
        document.head.appendChild(tag);
      } catch (error) {
        console.warn("[dsh-meta-analysis] style injection failed:", error);
      }
    }

    /* ------------------------------------------------------------------ *
     * Helpers
     * ------------------------------------------------------------------ */

    function el(tag, className, text) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function apiGet(path, params) {
      var url = path;
      if (params) {
        var search = new URLSearchParams();
        for (var key in params) if (params[key] !== undefined && params[key] !== '') search.set(key, String(params[key]));
        var text = search.toString();
        if (text) url += '?' + text;
      }
      return fetch(url, { headers: { accept: 'application/json' } }).then(function (res) {
        return res.json().catch(function () { return { error: 'invalid json' }; });
      });
    }

    function apiPost(path, body) {
      return fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body || {}),
      }).then(function (res) {
        return res.json().catch(function () { return { error: 'invalid json' }; });
      });
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmt(value) {
      if (value === null || value === undefined) return '';
      return String(value);
    }

    /* ------------------------------------------------------------------ *
     * Sidebar entry (self-healing, dsh-ssh sidebar-entry style)
     * ------------------------------------------------------------------ */

    function sidebarRoot() {
      var column = document.querySelector("[data-pane=\"sidebar\"], [class*=\"sidebarCol\"]");
      if (column === null) return undefined;
      var logoOwner = column.querySelector("[class*=\"logoRow\"]")?.parentElement;
      return logoOwner ?? (column.firstElementChild || undefined);
    }

    function newSessionButton(root) {
      var nested = root.querySelector("button[class*=\"newSession\"]");
      if (nested !== null) return nested;
      for (var i = 0; i < root.children.length; i++) {
        if (root.children[i].tagName === "BUTTON") return root.children[i];
      }
      return undefined;
    }

    function createEntry(controller) {
      var entry = document.createElement("button");
      entry.type = "button";
      entry.dataset.dshMetaEntry = "";
      entry.className = "dsh-meta-entry";
      entry.setAttribute("aria-label", "Meta 分析");
      entry.setAttribute("title", "Meta 分析（独立本地数据）");
      entry.innerHTML = "<span class=\"dsh-meta-entry-icon\">" + ICON + "</span><span class=\"dsh-meta-entry-label\">Meta 分析</span>";
      entry.addEventListener("click", function () { controller.toggle(); });
      return entry;
    }

    function placeEntry(root, entry) {
      var button = newSessionButton(root);
      if (button === undefined) return false;
      if (entry.parentElement !== root) {
        var row = button.closest("[class*=\"logoRow\"]");
        var base = (row !== null && row.parentElement === root) ? row : button;
        var family = Array.prototype.filter.call(root.children, function (el) {
          return el instanceof HTMLElement && el.matches("[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-scholar-entry], [data-dsh-meta-entry]");
        });
        var anchor = family.length > 0 ? family[family.length - 1].nextElementSibling : base.nextElementSibling;
        root.insertBefore(entry, anchor);
      }
      return true;
    }

    function mountSidebarEntry(controller) {
      var entry = createEntry(controller);
      var root;
      var placed = false;
      var rootObserver;

      var tryPlace = function () {
        if (root !== undefined && !root.isConnected) {
          rootObserver.disconnect();
          root = undefined;
          placed = false;
        }
        if (placed) {
          if (document.body.contains(entry)) return;
          rootObserver.disconnect();
          root = undefined;
          placed = false;
        }
        root = root ?? sidebarRoot();
        if (root === undefined) return;
        placed = placeEntry(root, entry);
        if (placed) rootObserver.observe(root, { childList: true, subtree: true });
      };

      var waitObserver = new MutationObserver(function () { tryPlace(); });
      waitObserver.observe(document.body, { childList: true, subtree: true });

      rootObserver = new MutationObserver(function () {
        if (root === undefined || !root.isConnected) { placed = false; tryPlace(); return; }
        if (!root.contains(entry)) placed = placeEntry(root, entry);
      });

      var syncActive = function () {
        if (controller.getSnapshot().panelOpen) entry.dataset.active = "true";
        else delete entry.dataset.active;
      };
      var unsubscribe = controller.subscribe(syncActive);
      syncActive();
      tryPlace();

      return function () {
        waitObserver.disconnect();
        rootObserver.disconnect();
        unsubscribe();
        entry.remove();
      };
    }

    /* ------------------------------------------------------------------ *
     * Panel mount (center-column takeover)
     * ------------------------------------------------------------------ */

    function mountPanel(controller) {
      var container;

      var ensure = function () {
        if (container !== undefined && !container.isConnected) { container.remove(); container = undefined; }
        if (container !== undefined) return;
        var column = document.querySelector(CONVERSATION_COLUMN_SELECTOR);
        if (column === null) return;
        container = document.createElement("div");
        container.dataset.dshMetaView = "";
        container.className = "dsh-meta-view";
        column.appendChild(container);
      };

      var waitObserver = new MutationObserver(function () { ensure(); });
      waitObserver.observe(document.body, { childList: true, subtree: true });

      var applyActive = function () {
        if (controller.getSnapshot().panelOpen) {
          for (var i = 0; i < OTHER_ACTIVE_ATTRS.length; i++) document.documentElement.removeAttribute(OTHER_ACTIVE_ATTRS[i]);
          document.documentElement.setAttribute(ACTIVE_ATTR, "");
          document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }));
        } else {
          document.documentElement.removeAttribute(ACTIVE_ATTR);
        }
      };
      var onOtherActivate = function (event) {
        if (event.detail !== PANEL_NAME && controller.getSnapshot().panelOpen) controller.close();
      };
      var SIDEBAR_ROW_SELECTOR = "[class*=\"sessionRow\"], [class*=\"projectRow\"], [class*=\"searchResultRow\"], [class*=\"searchResultWorkspace\"], [class*=\"newSession\"]";
      var onClickSidebarRow = function (event) {
        if (!controller.getSnapshot().panelOpen) return;
        var target = event.target;
        if (target instanceof HTMLElement && target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.close();
      };
      document.addEventListener("click", onClickSidebarRow, true);
      document.addEventListener(ACTIVATE_EVENT, onOtherActivate);
      var unsubscribe = controller.subscribe(applyActive);
      applyActive();
      ensure();

      return function () {
        document.removeEventListener("click", onClickSidebarRow, true);
        document.removeEventListener(ACTIVATE_EVENT, onOtherActivate);
        waitObserver.disconnect();
        unsubscribe();
        document.documentElement.removeAttribute(ACTIVE_ATTR);
        if (container !== undefined) { container.remove(); container = undefined; }
      };
    }

    /* ------------------------------------------------------------------ *
     * Panel controller
     * ------------------------------------------------------------------ */

    function PanelController() {
      this.panelOpen = false;
      this.listeners = new Set();
    }
    PanelController.prototype.getSnapshot = function () { return { panelOpen: this.panelOpen }; };
    PanelController.prototype.subscribe = function (fn) {
      this.listeners.add(fn);
      return (function (self, f) { return function () { self.listeners.delete(f); }; })(this, fn);
    };
    PanelController.prototype.open = function () {
      if (this.panelOpen) return;
      this.panelOpen = true;
      this.notify();
    };
    PanelController.prototype.close = function () {
      if (!this.panelOpen) return;
      this.panelOpen = false;
      this.notify();
    };
    PanelController.prototype.toggle = function () {
      if (this.panelOpen) this.close();
      else this.open();
    };
    PanelController.prototype.notify = function () {
      Array.from(this.listeners).forEach(function (fn) { fn(); });
    };

    /* ------------------------------------------------------------------ *
     * App state + views
     * ------------------------------------------------------------------ */

    function createApp() {
      return {
        projectId: null,
        projectName: '…',
        sources: [],
        selectedPdfId: null,
        sourceDetail: null,
        codingEdit: false,
        codingSaving: false,
        currentTab: 'sources',
        inspect: null,
        config: null,
        running: false,
        analyses: [],
        selectedAnalysis: null,
        message: '',
      };
    }

    function renderPanel(rootEl, controller, app) {
      rootEl.textContent = "";
      rootEl.appendChild(el("h2", "dsh-meta-heading", "Meta 分析"));
      rootEl.appendChild(el("p", "dsh-meta-muted", "本地独立数据（" + (app.projectName || '…') + "）· 与 Scholar Harness 服务无关联"));

      var header = el("div", "dsh-meta-header");
      var tabs = el("div", "dsh-meta-tabs");
      var tabDefs = [
        { key: "sources", label: "研究来源" },
        { key: "coding", label: "编码表" },
        { key: "digitization", label: "数字化复核" },
        { key: "analysis", label: "Meta 分析" },
        { key: "results", label: "结果" },
      ];
      var content = el("div", "dsh-meta-content");

      var select = function (key) {
        app.currentTab = key;
        Array.prototype.forEach.call(tabs.children, function (tab) {
          tab.classList.toggle("active", tab.dataset.tab === key);
        });
        renderTab(key);
      };

      tabDefs.forEach(function (def) {
        var tab = el("button", "dsh-meta-tab", def.label);
        tab.dataset.tab = def.key;
        tab.addEventListener("click", function () { select(def.key); });
        tabs.appendChild(tab);
      });
      header.appendChild(tabs);
      rootEl.appendChild(header);
      rootEl.appendChild(content);

      var renderTab = function (key) {
        if (key === "sources") renderSourcesTab(content, app, select);
        else if (key === "coding") renderCodingTab(content, app, select);
        else if (key === "digitization") renderDigitizationTab(content, app, select);
        else if (key === "analysis") renderAnalysisTab(content, app, select);
        else if (key === "results") renderResultsTab(content, app, select);
      };

      // Initial load.
      apiGet(API.status).then(function (response) {
        var project = response && response.project ? response.project : {};
        app.projectId = project.id || null;
        app.projectName = project.name || '';
        select(app.currentTab);
      }).catch(function () {
        content.textContent = "";
        content.appendChild(el("p", "dsh-meta-muted", "Meta 分析服务不可用"));
      });
    }

    function withProject(app, fn) {
      return apiGet(API.status).then(function (response) {
        var project = response && response.project ? response.project : {};
        app.projectId = project.id || null;
        app.projectName = project.name || '';
        return fn();
      });
    }

    function card(title) {
      var node = el("div", "dsh-meta-card");
      if (title) node.appendChild(el("h3", "dsh-meta-card-title", title));
      return node;
    }

    function loadSources(app) {
      return apiGet(API.sources, { projectId: app.projectId }).then(function (response) {
        app.sources = (response && response.sources) || [];
        if (!app.selectedPdfId && app.sources.length) app.selectedPdfId = app.sources[0].pdfId;
        return app.sources;
      });
    }

    function loadSourceDetail(app) {
      if (!app.selectedPdfId) { app.sourceDetail = null; return Promise.resolve(null); }
      return apiGet(API.sourceDetail, { projectId: app.projectId, pdfId: app.selectedPdfId }).then(function (response) {
        app.sourceDetail = (response && response.source) || null;
        return app.sourceDetail;
      });
    }

    /* ------------------------------------------------------- sources tab */

    function renderSourcesTab(content, app, select) {
      content.textContent = "";
      var header = el("div", "dsh-meta-toolbar");
      var addBtn = el("button", "dsh-meta-btn accent", "+ 添加研究来源");
      addBtn.addEventListener("click", function () { showAddSourceDialog(app, function () { refreshSources(content, app, select); }); });
      header.appendChild(addBtn);
      content.appendChild(header);

      var list = el("div", "dsh-meta-card");
      list.appendChild(el("h3", "dsh-meta-card-title", "研究来源（编码表）"));
      var placeholder = el("p", "dsh-meta-muted", "加载中…");
      list.appendChild(placeholder);
      content.appendChild(list);

      loadSources(app).then(function (sources) {
        list.removeChild(placeholder);
        if (!sources.length) {
          list.appendChild(el("p", "dsh-meta-muted", "还没有研究来源。点击「+ 添加研究来源」创建，然后在「编码表」页填写处理组/对照组均值、SD、n 等字段。"));
          return;
        }
        sources.forEach(function (source) {
          var row = el("div", "dsh-meta-source-item");
          row.textContent = [source.title, source.year ? '(' + source.year + ')' : '', source.authors || '', source.rowCount + ' 行 / ' + source.columnCount + ' 列'].join(' ');
          row.addEventListener("click", function () {
            app.selectedPdfId = source.pdfId;
            select("coding");
          });
          list.appendChild(row);
        });
      });
    }

    function refreshSources(content, app, select) {
      content.textContent = "";
      renderSourcesTab(content, app, select);
    }

    function showAddSourceDialog(app, done) {
      var overlay = el("div");
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:200;display:flex;align-items:center;justify-content:center;";
      var dialog = el("div", "dsh-meta-card");
      dialog.style.cssText = "width:min(560px,92%);max-height:80vh;overflow:auto;";
      dialog.appendChild(el("h3", "dsh-meta-card-title", "添加研究来源"));
      var titleInput = el("input", "dsh-meta-input", "");
      titleInput.placeholder = "标题（必填）";
      titleInput.style.cssText = "width:100%;margin-bottom:8px;";
      var authorInput = el("input", "dsh-meta-input", "");
      authorInput.placeholder = "作者（可选）";
      authorInput.style.cssText = "width:100%;margin-bottom:8px;";
      var yearInput = el("input", "dsh-meta-input", "");
      yearInput.placeholder = "年份（可选）";
      yearInput.style.cssText = "width:100%;margin-bottom:8px;";
      var colInput = el("input", "dsh-meta-input", "");
      colInput.placeholder = "初始编码列（逗号分隔，可选）。常用：处理组均值,处理组SD,处理组n,对照组均值,对照组SD,对照组n";
      colInput.style.cssText = "width:100%;margin-bottom:12px;";
      dialog.appendChild(titleInput);
      dialog.appendChild(authorInput);
      dialog.appendChild(yearInput);
      dialog.appendChild(colInput);

      var actions = el("div", "dsh-meta-toolbar");
      var ok = el("button", "dsh-meta-btn primary", "创建");
      var cancel = el("button", "dsh-meta-btn", "取消");
      var close = function () { overlay.remove(); };
      ok.addEventListener("click", function () {
        var title = titleInput.value.trim();
        if (!title) { titleInput.focus(); return; }
        var columns = colInput.value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
        ok.disabled = true;
        apiPost(API.sourceAdd, {
          projectId: app.projectId,
          title: title,
          authors: authorInput.value.trim(),
          year: yearInput.value.trim(),
          columns: columns,
          rows: columns.length ? [{}] : [],
        }).then(function () {
          close();
          done();
        }).catch(function () { ok.disabled = false; });
      });
      cancel.addEventListener("click", close);
      actions.appendChild(ok);
      actions.appendChild(cancel);
      dialog.appendChild(actions);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      titleInput.focus();
    }

    /* ------------------------------------------------------- coding tab */

    function renderCodingTab(content, app, select) {
      content.textContent = "";
      var grid = el("div", "dsh-meta-grid");
      var listCol = el("div", "");
      var detailCol = el("div", "");

      listCol.appendChild(el("h3", "dsh-meta-card-title", "选择来源"));
      var list = el("div", "dsh-meta-source-list");
      listCol.appendChild(list);

      var detail = el("div", "");
      detailCol.appendChild(detail);
      grid.appendChild(listCol);
      grid.appendChild(detailCol);
      content.appendChild(grid);

      loadSources(app).then(function (sources) {
        list.textContent = "";
        if (!sources.length) {
          list.appendChild(el("p", "dsh-meta-muted", "暂无来源"));
          return;
        }
        sources.forEach(function (source) {
          var row = el("div", "dsh-meta-source-item");
          row.classList.toggle("active", source.pdfId === app.selectedPdfId);
          row.textContent = [source.title, source.rowCount + '行'].join(' · ');
          row.addEventListener("click", function () {
            app.selectedPdfId = source.pdfId;
            renderCodingTab(content, app, select);
          });
          list.appendChild(row);
        });
        renderCodingDetail(detail, app, select);
      });
    }

    function renderCodingDetail(detail, app, select) {
      detail.textContent = "";
      detail.appendChild(el("p", "dsh-meta-muted", "加载编码表…"));
      loadSourceDetail(app).then(function (source) {
        detail.textContent = "";
        if (!source) {
          detail.appendChild(el("p", "dsh-meta-muted", "请选择一个来源"));
          return;
        }
        var title = el("h3", "dsh-meta-card-title", source.title || source.pdfId);
        detail.appendChild(title);

        var toolbar = el("div", "dsh-meta-toolbar");
        var editBtn = el("button", "dsh-meta-btn accent", app.codingEdit ? "保存修改" : "编辑编码表");
        var addRowBtn = el("button", "dsh-meta-btn", "新增行");
        var addColBtn = el("button", "dsh-meta-btn", "新增列");
        addRowBtn.disabled = !app.codingEdit;
        addColBtn.disabled = !app.codingEdit;

        editBtn.addEventListener("click", function () {
          if (!app.codingEdit) {
            app.codingEdit = true;
            renderCodingDetail(detail, app, select);
            return;
          }
          // Save current edits from the DOM.
          var table = detail.querySelector(".dsh-meta-table");
          if (!table) return;
          var columnNames = Array.prototype.map.call(table.querySelectorAll("thead th[data-col]"), function (th) { return th.dataset.col; });
          var rowEls = table.querySelectorAll("tbody tr");
          var rows = Array.prototype.map.call(rowEls, function (tr) {
            var row = {};
            Array.prototype.forEach.call(tr.querySelectorAll("textarea[data-col]"), function (textarea) {
              row[textarea.dataset.col] = textarea.value;
            });
            return row;
          });
          app.codingSaving = true;
          editBtn.disabled = true;
          apiPost(API.codingSave, {
            projectId: app.projectId,
            pdfId: source.pdfId,
            columns: columnNames,
            rows: rows,
          }).then(function () {
            app.codingEdit = false;
            app.codingSaving = false;
            renderCodingDetail(detail, app, select);
          }).catch(function () {
            app.codingSaving = false;
            editBtn.disabled = false;
          });
        });

        addRowBtn.addEventListener("click", function () {
          apiPost(API.codingRowsAdd, { projectId: app.projectId, pdfId: source.pdfId }).then(function () {
            renderCodingDetail(detail, app, select);
          });
        });

        addColBtn.addEventListener("click", function () {
          var name = window.prompt("新列名称：");
          if (!name || !name.trim()) return;
          apiPost(API.codingColumnsAdd, { projectId: app.projectId, pdfId: source.pdfId, column: name.trim() }).then(function () {
            renderCodingDetail(detail, app, select);
          });
        });

        toolbar.appendChild(editBtn);
        toolbar.appendChild(addRowBtn);
        toolbar.appendChild(addColBtn);
        if (!app.codingEdit) {
          var analyzeBtn = el("button", "dsh-meta-btn primary", "进行 Meta 分析");
          analyzeBtn.addEventListener("click", function () { select("analysis"); });
          toolbar.appendChild(analyzeBtn);
        }
        detail.appendChild(toolbar);

        var table = source.dataTable || { columns: [], rows: [] };
        var columns = Array.isArray(table.columns) ? table.columns : [];
        var rows = Array.isArray(table.rows) ? table.rows : [];
        var wrap = el("div", "dsh-meta-table-wrap");
        var tbl = el("table", "dsh-meta-table");

        var thead = document.createElement("thead");
        var headerRow = document.createElement("tr");
        headerRow.appendChild(el("th", "", "行"));
        columns.forEach(function (column) {
          var th = el("th", "", column);
          th.dataset.col = column;
          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        tbl.appendChild(thead);

        var tbody = document.createElement("tbody");
        rows.forEach(function (row, rowIndex) {
          var tr = document.createElement("tr");
          tr.appendChild(el("td", "", String(rowIndex + 1)));
          columns.forEach(function (column) {
            var td = document.createElement("td");
            var value = fmt(row[column]);
            if (app.codingEdit) {
              var textarea = document.createElement("textarea");
              textarea.value = value;
              textarea.dataset.col = column;
              td.appendChild(textarea);
            } else {
              td.textContent = value;
            }
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        wrap.appendChild(tbl);
        detail.appendChild(wrap);

        if (app.codingEdit) {
          var hint = el("p", "dsh-meta-muted", "编辑完成后点击「保存修改」。提示：列名含“处理组均值/处理组SD/处理组n/对照组均值/对照组SD/对照组n”（或 tmean/tsd/tn/ckmean/cksd/ckn 等后缀）会被自动识别为效应量字段。");
          detail.appendChild(hint);
        }
      });
    }

    /* ------------------------------------------------- digitization tab */

    function renderDigitizationTab(content, app, select) {
      content.textContent = "";
      var card = el("div", "dsh-meta-card");
      card.appendChild(el("h3", "dsh-meta-card-title", "图像数字化复核（GetData / WebPlotDigitizer 导入）"));
      card.appendChild(el("p", "dsh-meta-muted", "把 GetData/WebPlotDigitizer 导出的坐标数据（CSV/TXT）导入为编码表列。先在「研究来源」选中目标来源，选择要追加的目标列，再粘贴数据。"));
      content.appendChild(card);

      var sourceSelect = el("select", "dsh-meta-select");
      loadSources(app).then(function (sources) {
        sources.forEach(function (source) {
          var option = document.createElement("option");
          option.value = source.pdfId;
          option.textContent = source.title || source.pdfId;
          if (source.pdfId === app.selectedPdfId) option.selected = true;
          sourceSelect.appendChild(option);
        });
      });
      var colInput = el("input", "dsh-meta-input", "");
      colInput.placeholder = "目标列名（如 处理组均值 或 土壤pH）";
      colInput.style.cssText = "min-width:200px;";
      var dataInput = document.createElement("textarea");
      dataInput.className = "dsh-meta-input";
      dataInput.placeholder = "粘贴 CSV/TXT 数据：第一行是列名，后续行是数据。例如：\n处理组,对照组\n12.3,9.8\n11.5,10.1";
      dataInput.style.cssText = "width:100%;height:160px;margin:8px 0;font-family:ui-monospace,monospace;font-size:12px;";

      var row = el("div", "dsh-meta-toolbar");
      row.appendChild(el("span", "dsh-meta-muted", "来源:"));
      row.appendChild(sourceSelect);
      row.appendChild(el("span", "dsh-meta-muted", "目标列:"));
      row.appendChild(colInput);
      content.appendChild(row);
      content.appendChild(dataInput);

      var actions = el("div", "dsh-meta-toolbar");
      var importBtn = el("button", "dsh-meta-btn primary", "导入到目标列");
      var appendBtn = el("button", "dsh-meta-btn accent", "导入并追加为新列");
      var status = el("span", "dsh-meta-muted", "");
      actions.appendChild(importBtn);
      actions.appendChild(appendBtn);
      actions.appendChild(status);
      content.appendChild(actions);

      function parseCsv(text) {
        var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
        if (!lines.length) return null;
        var split = function (line) {
          // Simple CSV: honor quotes.
          var out = [];
          var current = '';
          var inQuotes = false;
          for (var i = 0; i < line.length; i++) {
            var ch = line[i];
            if (inQuotes) {
              if (ch === '"') {
                if (line[i + 1] === '"') { current += '"'; i += 1; }
                else inQuotes = false;
              } else current += ch;
            } else if (ch === '"') inQuotes = true;
            else if (ch === ',' || ch === '\t') { out.push(current); current = ''; }
            else current += ch;
          }
          out.push(current);
          return out;
        };
        var header = split(lines[0]).map(function (s) { return s.trim(); });
        var rows = [];
        for (var i = 1; i < lines.length; i++) {
          var cells = split(lines[i]);
          var rowObj = {};
          for (var j = 0; j < header.length; j++) rowObj[header[j] || ('列' + (j + 1))] = cells[j] !== undefined ? cells[j].trim() : '';
          rows.push(rowObj);
        }
        return { columns: header, rows: rows };
      }

      function doImport(mode) {
        var pdfId = sourceSelect.value;
        var colName = colInput.value.trim();
        var parsed = parseCsv(dataInput.value);
        if (!parsed || !parsed.rows.length) { status.textContent = '数据为空或格式不对'; return; }
        if (mode === 'toColumn' && !colName) { colInput.focus(); return; }
        importBtn.disabled = true;
        appendBtn.disabled = true;

        // First read the current source detail to append the new column.
        apiGet(API.sourceDetail, { projectId: app.projectId, pdfId: pdfId }).then(function (response) {
          var source = (response && response.source) || null;
          if (!source) throw new Error('来源不存在');
          var table = source.dataTable || { columns: [], rows: [] };
          var columns = Array.isArray(table.columns) ? table.columns.slice() : [];
          var rows = Array.isArray(table.rows) ? table.rows.map(function (r) { return Object.assign({}, r); }) : [];

          var newCol = colName;
          if (mode === 'append' || !columns.includes(colName)) {
            newCol = colName || ('数字化_' + new Date().toTimeString().slice(0, 5).replace(':', ''));
            if (!columns.includes(newCol)) columns.push(newCol);
          }

          var valueRows = parsed.rows;
          // Extend existing rows or create rows when the table is empty.
          if (rows.length === 0) {
            rows = valueRows.map(function () { return {}; });
          }
          valueRows.forEach(function (rowObj, index) {
            if (index < rows.length) {
              var firstValue = rowObj[Object.keys(rowObj)[0]];
              rows[index][newCol] = firstValue !== undefined ? String(firstValue) : '';
            } else {
              var extra = {};
              extra[newCol] = String(rowObj[Object.keys(rowObj)[0]] || '');
              rows.push(extra);
            }
          });

          return apiPost(API.codingSave, { projectId: app.projectId, pdfId: pdfId, columns: columns, rows: rows });
        }).then(function () {
          status.textContent = '✓ 已导入（' + parsed.rows.length + ' 行 → ' + (mode === 'append' ? '新列' : colName) + '）';
          app.codingEdit = false;
        }).catch(function (error) {
          status.textContent = '导入失败：' + (error && error.message ? error.message : String(error));
        }).finally(function () {
          importBtn.disabled = false;
          appendBtn.disabled = false;
        });
      }

      importBtn.addEventListener("click", function () { doImport('toColumn'); });
      appendBtn.addEventListener("click", function () { doImport('append'); });
    }

    /* ------------------------------------------------------ analysis tab */

    function renderAnalysisTab(content, app, select) {
      content.textContent = "";
      var card = el("div", "dsh-meta-card");
      card.appendChild(el("h3", "dsh-meta-card-title", "Meta 分析向导"));
      card.appendChild(el("p", "dsh-meta-muted", "先预检（自动识别变量/候选结果/推荐配置），确认效应量映射后运行。"));
      content.appendChild(card);

      var toolbar = el("div", "dsh-meta-toolbar");
      var inspectBtn = el("button", "dsh-meta-btn primary", "① 预检（识别变量与候选结果）");
      var runBtn = el("button", "dsh-meta-btn", "③ 运行分析");
      runBtn.disabled = true;
      var status = el("span", "dsh-meta-muted", "");
      toolbar.appendChild(inspectBtn);
      toolbar.appendChild(runBtn);
      toolbar.appendChild(status);
      content.appendChild(toolbar);

      var result = el("div", "");
      content.appendChild(result);

      inspectBtn.addEventListener("click", function () {
        inspectBtn.disabled = true;
        status.textContent = '预检中…';
        apiPost(API.inspect, { projectId: app.projectId, pdfIds: [] }).then(function (response) {
          var data = response && response.result ? response.result : response;
          if (!data || !data.dataset) throw new Error(data && data.error ? data.error : '预检失败');
          app.inspect = data;
          app.config = cloneConfig(data.recommendedConfig);
          runBtn.disabled = false;
          status.textContent = '预检完成，已载入推荐配置（可修改下方映射）。';
          renderInspectResult(result, app, runBtn, status);
        }).catch(function (error) {
          status.textContent = '预检失败：' + (error && error.message ? error.message : String(error));
        }).finally(function () {
          inspectBtn.disabled = false;
        });
      });

      runBtn.addEventListener("click", function () {
        if (!app.config || !app.config.outcomes || !app.config.outcomes.length) {
          status.textContent = '请先预检并确认至少一个结果映射。';
          return;
        }
        runBtn.disabled = true;
        app.running = true;
        status.textContent = '运行中…';
        apiPost(API.run, { projectId: app.projectId, pdfIds: [], config: app.config }).then(function (response) {
          var run = response && response.run ? response.run : response;
          app.selectedAnalysis = run;
          status.textContent = '✓ 分析完成：' + (run.analysisId || '') + '（效应量 ' + (run.effectRows ? run.effectRows.length : 0) + ' 行，跳过 ' + (run.skippedCount || 0) + ' 行）';
          select("results");
        }).catch(function (error) {
          status.textContent = '运行失败：' + (error && error.message ? error.message : String(error));
        }).finally(function () {
          runBtn.disabled = false;
          app.running = false;
        });
      });
    }

    function cloneConfig(config) {
      if (!config) return null;
      return JSON.parse(JSON.stringify(config));
    }

    function renderInspectResult(result, app, runBtn, status) {
      result.textContent = "";
      var data = app.inspect;
      if (!data) return;

      var dataset = data.dataset || {};
      var summary = card("数据概览");
      summary.appendChild(el("p", "", "PDF/来源：" + dataset.pdfCount + " · 行：" + dataset.rowCount + " · 列：" + dataset.columnCount));
      if (data.warnings && data.warnings.length) {
        data.warnings.forEach(function (warning) {
          summary.appendChild(el("p", "dsh-meta-warn", "⚠ " + warning));
        });
      }
      result.appendChild(summary);

      // Outcome config cards.
      var configCard = card("结果变量与效应量映射（确认后运行）");
      var outcomes = (app.config && app.config.outcomes) || [];
      if (!outcomes.length) {
        configCard.appendChild(el("p", "dsh-meta-muted", "未自动识别到完整映射，请在下方手动添加。"));
      }
      outcomes.forEach(function (outcome, index) {
        var node = el("div", "dsh-meta-outcome");
        var title = el("h4", "", "结果 " + (index + 1) + "：" + (outcome.label || outcome.id || ''));
        node.appendChild(title);
        var measureSelect = el("select", "dsh-meta-select");
        (data.effectMeasures || [{ id: 'lnRR', name: 'lnRR' }]).forEach(function (m) {
          var option = document.createElement("option");
          option.value = m.id;
          option.textContent = m.name || m.id;
          if (m.id === (outcome.measure || 'lnRR')) option.selected = true;
          measureSelect.appendChild(option);
        });
        measureSelect.addEventListener("change", function () { outcome.measure = measureSelect.value; });
        node.appendChild(el("label", "", "效应量类型: "));
        node.appendChild(measureSelect);

        var roles = [
          ['treatmentMean', '处理组均值'], ['treatmentSd', '处理组SD'], ['treatmentN', '处理组n'],
          ['controlMean', '对照组均值'], ['controlSd', '对照组SD'], ['controlN', '对照组n'],
        ];
        var grid = el("div", "dsh-meta-role-grid");
        var columns = (data.dataset ? null : null) || inferColumnsFromInspect(data);
        roles.forEach(function (pair) {
          var role = pair[0];
          var label = pair[1];
          var cell = el("div", "dsh-meta-role-cell");
          var select = el("select", "dsh-meta-select");
          var empty = document.createElement("option");
          empty.value = '';
          empty.textContent = label + '（不映射）';
          select.appendChild(empty);
          (columns || []).forEach(function (column) {
            var option = document.createElement("option");
            option.value = column;
            option.textContent = column;
            if (column === outcome[role]) option.selected = true;
            select.appendChild(option);
          });
          select.addEventListener("change", function () {
            if (select.value) outcome[role] = select.value;
            else delete outcome[role];
          });
          cell.appendChild(select);
          grid.appendChild(cell);
        });
        node.appendChild(grid);
        configCard.appendChild(node);
      });

      var addOutcomeBtn = el("button", "dsh-meta-btn", "+ 添加结果变量");
      addOutcomeBtn.addEventListener("click", function () {
        app.config.outcomes.push({ id: 'outcome_' + (app.config.outcomes.length + 1), label: '结果' + (app.config.outcomes.length + 1), measure: 'lnRR', direction: 1 });
        renderInspectResult(result, app, runBtn, status);
      });
      configCard.appendChild(addOutcomeBtn);
      result.appendChild(configCard);
    }

    function inferColumnsFromInspect(data) {
      // From the recommended config mapping, collect every mentioned column.
      var columns = [];
      var seen = {};
      (data.recommendedConfig && data.recommendedConfig.outcomes || []).forEach(function (outcome) {
        Object.keys(outcome).forEach(function (key) {
          if (['treatmentMean', 'treatmentSd', 'treatmentN', 'controlMean', 'controlSd', 'controlN'].includes(key)) {
            var column = outcome[key];
            if (column && !seen[column]) { seen[column] = true; columns.push(column); }
          }
        });
      });
      // Fall back to all variables.
      if (!columns.length) {
        (data.variables || []).forEach(function (v) {
          if (!seen[v.name]) { seen[v.name] = true; columns.push(v.name); }
        });
      }
      return columns;
    }

    /* ------------------------------------------------------ results tab */

    function renderResultsTab(content, app, select) {
      content.textContent = "";
      var toolbar = el("div", "dsh-meta-toolbar");
      var reloadBtn = el("button", "dsh-meta-btn", "刷新历史");
      toolbar.appendChild(reloadBtn);
      content.appendChild(toolbar);

      var listCard = card("历史分析");
      content.appendChild(listCard);

      var load = function () {
        listCard.textContent = "";
        listCard.appendChild(el("h3", "dsh-meta-card-title", "历史分析"));
        apiGet(API.analyses, { projectId: app.projectId }).then(function (response) {
          app.analyses = (response && response.analyses) || [];
          if (!app.analyses.length) {
            listCard.appendChild(el("p", "dsh-meta-muted", "暂无历史分析。"));
            return;
          }
          app.analyses.forEach(function (analysis) {
            var row = el("div", "dsh-meta-analysis-row");
            row.textContent = [analysis.createdAt || '', (analysis.outcomeLabels || []).join('、') || analysis.analysisId, '效应量 ' + analysis.effectRowCount + ' · 跳过 ' + analysis.skippedCount].join('  ');
            row.addEventListener("click", function () {
              renderAnalysisDetail(content, app, analysis.analysisId);
            });
            listCard.appendChild(row);
          });
        });
      };

      reloadBtn.addEventListener("click", load);
      load();

      if (app.selectedAnalysis) {
        renderAnalysisDetail(content, app, app.selectedAnalysis.analysisId);
      }
    }

    function renderAnalysisDetail(content, app, analysisId) {
      apiGet(API.analysisDetail, { projectId: app.projectId, analysisId: analysisId }).then(function (response) {
        var analysis = response && response.analysis ? response.analysis : null;
        if (!analysis) return;
        app.selectedAnalysis = analysis;
        var existing = document.querySelector("[data-dsh-meta-analysis-detail]");
        if (existing) existing.remove();
        var detail = el("div", "");
        detail.dataset.dshMetaAnalysisDetail = "";
        content.appendChild(detail);

        var summary = card("分析摘要");
        summary.appendChild(el("p", "", "ID：" + analysis.analysisId + " · " + (analysis.createdAt || '')));
        summary.appendChild(el("p", "", "数据：" + (analysis.dataset ? analysis.dataset.pdfCount + ' 篇 / ' + analysis.dataset.rowCount + ' 行' : '') + " · 效应量 " + (analysis.effectRows ? analysis.effectRows.length : 0) + " 行 · 跳过 " + (analysis.skippedCount || 0) + " 行"));
        if (analysis.quality && analysis.quality.warnings && analysis.quality.warnings.length) {
          analysis.quality.warnings.forEach(function (warning) {
            summary.appendChild(el("p", "dsh-meta-warn", "⚠ " + warning));
          });
        }
        detail.appendChild(summary);

        if (analysis.summaries && analysis.summaries.length) {
          var sumCard = card("合并效应量");
          var table = el("table", "dsh-meta-summary-table");
          var thead = document.createElement("thead");
          var headerRow = document.createElement("tr");
          ['结果', '效应量', 'k', '固定估计', '固定95%CI', '随机估计', '随机95%CI', 'I²', 'τ²'].forEach(function (h) {
            headerRow.appendChild(el("th", "", h));
          });
          thead.appendChild(headerRow);
          table.appendChild(thead);
          var tbody = document.createElement("tbody");
          analysis.summaries.forEach(function (s) {
            var tr = document.createElement("tr");
            var ci = function (est) {
              return est && Number.isFinite(est.ciLower) ? '[' + est.ciLower.toFixed(3) + ', ' + est.ciUpper.toFixed(3) + ']' : '-';
            };
            var num = function (est) { return est && Number.isFinite(est.estimate) ? est.estimate.toFixed(3) : '-'; };
            tr.appendChild(el("td", "", s.outcomeLabel || s.outcomeId));
            tr.appendChild(el("td", "", s.measure || ''));
            tr.appendChild(el("td", "", String(s.k)));
            tr.appendChild(el("td", "", num(s.fixed)));
            tr.appendChild(el("td", "", ci(s.fixed)));
            tr.appendChild(el("td", "", num(s.random)));
            tr.appendChild(el("td", "", ci(s.random)));
            var het = s.heterogeneity || {};
            tr.appendChild(el("td", "", Number.isFinite(het.i2) ? het.i2.toFixed(1) + '%' : '-'));
            tr.appendChild(el("td", "", Number.isFinite(het.tau2) ? het.tau2.toFixed(4) : '-'));
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          sumCard.appendChild(table);
          detail.appendChild(sumCard);
        }

        if (analysis.subgroups && analysis.subgroups.length) {
          var subCard = card("亚组分析");
          analysis.subgroups.forEach(function (sub) {
            var est = sub.random;
            var line = sub.outcomeLabel + ' / ' + sub.subgroupColumn + '=' + sub.subgroupLevel + '（k=' + sub.k + '）：' + (est && Number.isFinite(est.estimate) ? est.estimate.toFixed(3) : '-') + (est && Number.isFinite(est.ciLower) ? ' [' + est.ciLower.toFixed(3) + ', ' + est.ciUpper.toFixed(3) + ']' : '');
            subCard.appendChild(el("p", "", line));
          });
          detail.appendChild(subCard);
        }

        var exportCard = card("导出");
        var toolRow = el("div", "dsh-meta-toolbar");
        var csvBtn = el("button", "dsh-meta-btn", "下载效应量 CSV");
        var ctxBtn = el("button", "dsh-meta-btn", "下载写作上下文 JSON");
        var rBtn = el("button", "dsh-meta-btn", "复制 R/metafor 脚本");
        var mdBtn = el("button", "dsh-meta-btn", "复制报告 Markdown");
        csvBtn.addEventListener("click", function () {
          var blob = new Blob([analysis.effectRowsCsv || ''], { type: 'text/csv;charset=utf-8' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = analysis.effectRowsFilename || 'meta_effect_sizes.csv';
          a.click();
          URL.revokeObjectURL(url);
        });
        ctxBtn.addEventListener("click", function () {
          var url = '/api/dsh-meta/analyses/writing-context?projectId=' + encodeURIComponent(app.projectId || '') + '&analysisId=' + encodeURIComponent(analysis.analysisId || '');
          window.open(url, '_blank');
        });
        rBtn.addEventListener("click", function () {
          navigator.clipboard && navigator.clipboard.writeText(analysis.rCode || '').then(function () {
            rBtn.textContent = '已复制';
            setTimeout(function () { rBtn.textContent = '复制 R/metafor 脚本'; }, 1500);
          });
        });
        mdBtn.addEventListener("click", function () {
          navigator.clipboard && navigator.clipboard.writeText(analysis.markdown || '').then(function () {
            mdBtn.textContent = '已复制';
            setTimeout(function () { mdBtn.textContent = '复制报告 Markdown'; }, 1500);
          });
        });
        toolRow.appendChild(csvBtn);
        toolRow.appendChild(ctxBtn);
        toolRow.appendChild(rBtn);
        toolRow.appendChild(mdBtn);
        exportCard.appendChild(toolRow);
        detail.appendChild(exportCard);

        var reportCard = card("报告预览（Markdown）");
        var pre = el("div", "dsh-meta-pre", analysis.markdown || '');
        reportCard.appendChild(pre);
        detail.appendChild(reportCard);
      });
    }

    /* ------------------------------------------------------------------ *
     * Plugin surface: inject + apply
     * ------------------------------------------------------------------ */

    var inject = [];

    function apply(ctx) {
      var controller = new PanelController();
      var app = createApp();
      var disposers = [];
      try {
        injectStyles();
        var appReady = false;
        var mountApp = function () {
          var view = document.querySelector(VIEW_SELECTOR);
          if (view === null || appReady) return;
          appReady = true;
          renderPanel(view, controller, app);
        };
        var observer = new MutationObserver(function () { mountApp(); });
        observer.observe(document.body, { childList: true, subtree: true });

        disposers.push(mountSidebarEntry(controller));
        disposers.push(mountPanel(controller));
        disposers.push(function () { observer.disconnect(); });
        mountApp();
      } catch (error) {
        console.warn("[dsh-meta-analysis] mount failed:", error);
      }
      ctx.effect(function () {
        return function () {
          for (var i = 0; i < disposers.length; i++) { try { disposers[i](); } catch (e) { /* best effort */ } }
        };
      }, "dsh-meta-analysis: ui mounts");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
