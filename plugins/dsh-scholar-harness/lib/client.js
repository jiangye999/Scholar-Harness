/**
 * dsh-scholar-harness — browser half. Runs inside the dsh web GUI.
 *
 * Registers a sidebar entry row (「Scholar」) and mounts an overview /
 * literature / PDF Wiki / Meta panel in the center column. Pure DOM + fetch
 * (no React, no platform module imports), so the bundle is self-contained and
 * hand-authored in the loader closure format. Failure policy: DOM mounting
 * problems are logged, never thrown — the web shell fails the whole boot when
 * a plugin apply throws, and an external plugin must not take the GUI down.
 */
window.__ModuleLoader__.load({
  id: "dsh-scholar-harness",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    /* ------------------------------------------------------------------ *
     * Constants
     * ------------------------------------------------------------------ */

    var NS = "dsh-scholar-harness";
    var ENTRY_SELECTOR = "[data-dsh-scholar-entry]";
    var VIEW_SELECTOR = "[data-dsh-scholar-view]";
    var ACTIVE_ATTR = "data-dsh-scholar-active";
    var OTHER_ACTIVE_ATTRS = ["data-dsh-taskboard-active", "data-dsh-ssh-active"];
    var ACTIVATE_EVENT = "dsh-panel-activate";
    var PANEL_NAME = "scholar";
    var CONVERSATION_COLUMN_SELECTOR = "[data-pane=\"conversation\"]";
    var API = {
      health: "/api/dsh-scholar/health",
      literature: "/api/dsh-scholar/literature",
      search: "/api/dsh-scholar/literature/search",
      pdfWikiStatus: "/api/dsh-scholar/pdf-wiki/status",
      pdfWikiTopics: "/api/dsh-scholar/pdf-wiki/topics",
      meta: "/api/dsh-scholar/meta",
    };

    var ICON = "<svg viewBox=\"0 0 16 16\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4 2.5h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z\"/><path d=\"M5.5 5.5h5M5.5 8h3M5.5 10.5h4\"/></svg>";

    /* ------------------------------------------------------------------ *
     * Stylesheet (injected once; scoped by data attributes so nothing leaks)
     * ------------------------------------------------------------------ */

    var STYLE_ID = "dsh-scholar-harness/styles.css";
    var CSS = [
      "[data-pane='conversation'] { position: relative; }",
      "[data-dsh-scholar-view] { position: absolute; inset: 0; display: none; z-index: 60; overflow: auto; background: var(--dsw-alias-bg-base, #fff); }",
      "html[data-dsh-scholar-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-dsh-scholar-view] { display: block; }",
      "html[data-dsh-scholar-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-pane='conversation'] > :not([data-dsh-scholar-view]),",
      "html[data-dsh-scholar-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [class*='centerCol'] > :not([data-dsh-scholar-view]) { display: none !important; }",
      ".dsh-scholar-entry { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 12px; background: transparent; border: none; border-radius: 8px; color: var(--dsw-alias-label-secondary, #666); cursor: pointer; font-size: 13px; }",
      ".dsh-scholar-entry:hover { background: var(--dsw-alias-bg-hover, rgba(0,0,0,0.06)); color: var(--dsw-alias-label, #222); }",
      ".dsh-scholar-entry[data-active='true'] { background: var(--dsw-alias-bg-active, rgba(0,0,0,0.1)); color: var(--dsw-alias-label, #222); }",
      ".dsh-scholar-entry-icon { display: inline-flex; }",
      ".dsh-scholar-view { padding: 20px; color: var(--dsw-alias-label, #222); font-size: 14px; }",
      ".dsh-scholar-heading { margin: 0 0 12px; font-size: 18px; font-weight: 600; }",
      ".dsh-scholar-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }",
      ".dsh-scholar-tabs { display: flex; gap: 4px; flex-wrap: wrap; }",
      ".dsh-scholar-tab { padding: 6px 12px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary, #666); cursor: pointer; font-size: 13px; }",
      ".dsh-scholar-tab.active { background: var(--dsw-alias-bg-active, rgba(0,0,0,0.1)); color: var(--dsw-alias-label, #222); font-weight: 600; }",
      ".dsh-scholar-refresh { padding: 6px 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-border, #ddd); background: transparent; color: var(--dsw-alias-label, #222); cursor: pointer; font-size: 13px; }",
      ".dsh-scholar-card { border: 1px solid var(--dsw-alias-border, #eee); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; background: var(--dsw-alias-bg-card, #fff); }",
      ".dsh-scholar-card-title { margin: 0 0 8px; font-size: 14px; font-weight: 600; }",
      ".dsh-scholar-summary { margin: 0 0 8px; font-size: 13px; }",
      ".dsh-scholar-muted { color: var(--dsw-alias-label-tertiary, #999); font-size: 13px; }",
      ".dsh-scholar-table { width: 100%; border-collapse: collapse; font-size: 13px; }",
      ".dsh-scholar-table td { padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border, #f0f0f0); vertical-align: top; }",
      ".dsh-scholar-key { font-weight: 600; white-space: nowrap; width: 110px; }",
      ".dsh-scholar-year { white-space: nowrap; width: 60px; text-align: right; }",
      ".dsh-scholar-journal { white-space: nowrap; max-width: 160px; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-tertiary, #999); }",
      ".dsh-scholar-topics { margin: 0; padding-left: 18px; font-size: 13px; }",
      ".dsh-scholar-topics li { margin-bottom: 6px; }",
    ].join("\n");

    function injectStyles() {
      try {
        if (document.querySelector("style[data-plugin-css=\"" + STYLE_ID + "\"]") !== null) return;
        var tag = document.createElement("style");
        tag.dataset.plugin = "dsh-scholar-harness";
        tag.dataset.pluginCss = STYLE_ID;
        tag.textContent = CSS;
        document.head.appendChild(tag);
      } catch (error) {
        console.warn("[dsh-scholar-harness] style injection failed:", error);
      }
    }

    /* ------------------------------------------------------------------ *
     * Tiny fetch helper (same-origin /api/dsh-scholar/*)
     * ------------------------------------------------------------------ */

    function apiGet(path) {
      return fetch(path, { headers: { accept: "application/json" } }).then(function (res) {
        return res.json().catch(function () { return { error: "invalid json" }; });
      });
    }

    function apiPost(path, body) {
      return fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      }).then(function (res) {
        return res.json().catch(function () { return { error: "invalid json" }; });
      });
    }

    /* ------------------------------------------------------------------ *
     * Sidebar entry (pure DOM, self-healing, dsh-ssh sidebar-entry style)
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
      entry.dataset.dshScholarEntry = "";
      entry.className = "dsh-scholar-entry";
      entry.setAttribute("aria-label", "Scholar");
      entry.setAttribute("title", "Scholar Harness：文献 / PDF Wiki / Meta");
      entry.innerHTML = "<span class=\"dsh-scholar-entry-icon\">" + ICON + "</span><span class=\"dsh-scholar-entry-label\">Scholar</span>";
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
          return el instanceof HTMLElement && el.matches("[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-scholar-entry]");
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
     * Panel view (center-column takeover, dsh-ssh mount style)
     * ------------------------------------------------------------------ */

    function mountPanel(controller) {
      var container;

      var ensure = function () {
        if (container !== undefined && !container.isConnected) { container.remove(); container = undefined; }
        if (container !== undefined) return;
        var column = document.querySelector(CONVERSATION_COLUMN_SELECTOR);
        if (column === null) return;
        // The container ITSELF carries the view marker: it is a direct child of
        // the conversation pane, and the stylesheet's center-column hide rule
        // (`[data-pane='conversation'] > :not([data-dsh-scholar-view])`) must
        // NOT match it. Wrapping the marker on an inner frame would hide the
        // whole container and leave the panel blank.
        container = document.createElement("div");
        container.dataset.dshScholarView = "";
        container.className = "dsh-scholar-view";
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
     * Panel controller (framework-free state owner)
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
      var self = this;
      Array.from(this.listeners).forEach(function (fn) { fn(); });
    };

    /* ------------------------------------------------------------------ *
     * Panel render: tabs + data sections
     * ------------------------------------------------------------------ */

    function el(tag, className, text) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function sectionCard(title) {
      var card = el("div", "dsh-scholar-card");
      if (title) card.appendChild(el("h3", "dsh-scholar-card-title", title));
      return card;
    }

    function renderHealth(host, result) {
      host.textContent = "";
      var card = sectionCard("概览");
      var r = result && result.result ? result.result : result;
      if (!r || r.reachable !== true) {
        card.appendChild(el("p", "dsh-scholar-muted", "Scholar Harness 本地服务不可达：" + ((r && r.error) || "unknown")));
        card.appendChild(el("p", "dsh-scholar-muted", "请先启动 Scholar Harness 桌面软件（默认 http://127.0.0.1:18789），然后点此页面的「刷新」。"));
        host.appendChild(card);
        return;
      }
      var rows = [
        ["服务", "可达"],
        ["当前用户", r.activeUserId || "-"],
        ["R 插件", (r.rPlugin && (r.rPlugin.label || (r.rPlugin.available ? "available" : "unavailable"))) || "-"],
      ];
      var table = el("table", "dsh-scholar-table");
      rows.forEach(function (row) {
        var tr = document.createElement("tr");
        tr.appendChild(el("td", "dsh-scholar-key", row[0]));
        tr.appendChild(el("td", "", row[1]));
        table.appendChild(tr);
      });
      card.appendChild(table);
      host.appendChild(card);
    }

    function renderLiterature(host, result) {
      host.textContent = "";
      var card = sectionCard("文献库");
      var r = result && result.result ? result.result : result;
      if (!r || r.success !== true) {
        card.appendChild(el("p", "dsh-scholar-muted", "文献库读取失败：" + ((r && r.error) || "unknown")));
        host.appendChild(card);
        return;
      }
      var summary = r.summary;
      if (summary && summary.count !== undefined) {
        card.appendChild(el("p", "dsh-scholar-summary",
          "共 " + summary.count + " 篇" +
          (summary.years && summary.years.length ? " · 年份 " + summary.years.join(", ") : "") +
          (summary.journals && summary.journals.length ? " · 期刊 " + summary.journals.slice(0, 5).join(", ") : "")));
      }
      var list = r.papers && r.papers.length ? r.papers.slice(0, 20) : [];
      if (list.length === 0) {
        card.appendChild(el("p", "dsh-scholar-muted", "文献库为空"));
      } else {
        var table = el("table", "dsh-scholar-table");
        list.forEach(function (p) {
          var tr = document.createElement("tr");
          tr.appendChild(el("td", "", p.title || "(无标题)"));
          tr.appendChild(el("td", "dsh-scholar-year", p.year ? String(p.year) : ""));
          tr.appendChild(el("td", "dsh-scholar-journal", p.journal || ""));
          table.appendChild(tr);
        });
        card.appendChild(table);
        if (r.papers.length > list.length) card.appendChild(el("p", "dsh-scholar-muted", "仅显示前 20 条，共 " + r.papers.length + " 条"));
      }
      host.appendChild(card);
    }

    function renderPdfWiki(host, result) {
      host.textContent = "";
      var r = result && result.result ? result.result : result;
      var card = sectionCard("PDF Wiki 句子级证据库");
      if (!r || r.success !== true) {
        card.appendChild(el("p", "dsh-scholar-muted", "PDF Wiki 状态读取失败：" + ((r && r.error) || "unknown")));
        host.appendChild(card);
        return;
      }
      var rows = [
        ["状态", r.status || "-"],
        ["PDF", (r.processedPdfs ?? 0) + " / " + (r.totalPdfs ?? 0)],
        ["论点组", String(r.entryCount ?? 0)],
        ["句子级论点", String(r.sentencePointCount ?? 0)],
        ["队列", [r.queuedJobs, r.runningJobs, r.completedJobs, r.failedJobs].join(" / ") + "（排队/运行/完成/失败）"],
      ];
      var table = el("table", "dsh-scholar-table");
      rows.forEach(function (row) {
        var tr = document.createElement("tr");
        tr.appendChild(el("td", "dsh-scholar-key", row[0]));
        tr.appendChild(el("td", "", row[1]));
        table.appendChild(tr);
      });
      card.appendChild(table);
      if (r.message) card.appendChild(el("p", "dsh-scholar-muted", r.message));
      host.appendChild(card);
    }

    function renderTopics(host, result) {
      var r = result && result.result ? result.result : result;
      var card = sectionCard("PDF Wiki 主题");
      if (!r || r.success !== true) {
        card.appendChild(el("p", "dsh-scholar-muted", "主题读取失败：" + ((r && r.error) || "unknown")));
        host.appendChild(card);
        return;
      }
      if (!r.topics || r.topics.length === 0) {
        card.appendChild(el("p", "dsh-scholar-muted", "暂无主题"));
      } else {
        var ul = el("ul", "dsh-scholar-topics");
        r.topics.slice(0, 15).forEach(function (t) {
          var li = el("li", "");
          li.appendChild(el("strong", "", t.label || "(无标签)"));
          if (t.description) li.appendChild(el("span", "dsh-scholar-muted", " — " + t.description.slice(0, 80)));
          ul.appendChild(li);
        });
        card.appendChild(ul);
        if (r.topics.length > 15) card.appendChild(el("p", "dsh-scholar-muted", "共 " + r.topics.length + " 个主题"));
      }
      host.appendChild(card);
    }

    function renderMeta(host, result) {
      host.textContent = "";
      var r = result && result.result ? result.result : result;
      var card = sectionCard("Meta 分析数据库");
      if (!r || r.success !== true) {
        card.appendChild(el("p", "dsh-scholar-muted", "Meta 数据库读取失败：" + ((r && r.error) || "unknown")));
        host.appendChild(card);
        return;
      }
      card.appendChild(el("p", "dsh-scholar-summary", "PDF " + (r.pdfCount ?? 0) + " 篇 · 参考文献 " + (r.referenceCount ?? 0) + " 条" + (r.generatedAt ? " · 生成 " + r.generatedAt : "")));
      var list = r.items && r.items.length ? r.items.slice(0, 20) : [];
      if (list.length === 0) {
        card.appendChild(el("p", "dsh-scholar-muted", "暂无 Meta 数据"));
      } else {
        var table = el("table", "dsh-scholar-table");
        list.forEach(function (item) {
          var tr = document.createElement("tr");
          var name = item.originalName ? String(item.originalName) : String(item.pdfId || "(无名称)");
          tr.appendChild(el("td", "", name));
          tr.appendChild(el("td", "dsh-scholar-year", item.year ? String(item.year) : ""));
          table.appendChild(tr);
        });
        card.appendChild(table);
      }
      host.appendChild(card);
    }

    function renderPanel(rootEl, controller) {
      rootEl.textContent = "";
      rootEl.appendChild(el("h2", "dsh-scholar-heading", "Scholar Harness"));

      var tabs = el("div", "dsh-scholar-tabs");
      var tabDefs = [
        { key: "overview", label: "概览" },
        { key: "literature", label: "文献" },
        { key: "pdfwiki", label: "PDF Wiki" },
        { key: "meta", label: "Meta" },
      ];
      var content = el("div", "dsh-scholar-content");
      var current = "overview";
      var refreshBtn = el("button", "dsh-scholar-refresh", "刷新");
      var loading = el("p", "dsh-scholar-muted", "加载中…");
      content.appendChild(loading);

      var loaders = {
        overview: function () { apiGet(API.health).then(function (r) { renderHealth(content, r); }); },
        literature: function () { apiGet(API.literature).then(function (r) { renderLiterature(content, r); }); },
        pdfwiki: function () {
          apiGet(API.pdfWikiStatus).then(function (status) {
            apiGet(API.pdfWikiTopics).then(function (topics) {
              content.textContent = "";
              renderPdfWiki(content, status);
              renderTopics(content, topics);
            });
          });
        },
        meta: function () { apiGet(API.meta).then(function (r) { renderMeta(content, r); }); },
      };

      var select = function (key) {
        current = key;
        Array.prototype.forEach.call(tabs.children, function (tab) {
          tab.classList.toggle("active", tab.dataset.tab === key);
        });
        content.textContent = "";
        content.appendChild(el("p", "dsh-scholar-muted", "加载中…"));
        var loader = loaders[key];
        if (loader) loader();
      };

      tabDefs.forEach(function (def) {
        var tab = el("button", "dsh-scholar-tab", def.label);
        tab.dataset.tab = def.key;
        tab.addEventListener("click", function () { select(def.key); });
        tabs.appendChild(tab);
      });
      refreshBtn.addEventListener("click", function () { select(current); });

      var header = el("div", "dsh-scholar-header");
      header.appendChild(tabs);
      header.appendChild(refreshBtn);
      rootEl.appendChild(header);
      rootEl.appendChild(content);
      select("overview");
    }

    /* ------------------------------------------------------------------ *
     * Plugin surface: inject + apply
     * ------------------------------------------------------------------ */

    var inject = [];

    function apply(ctx) {
      var controller = new PanelController();
      var disposers = [];
      try {
        injectStyles();
        // Panel frame: render once when the frame enters the DOM, then re-render
        // nothing (data loads happen per tab click / refresh).
        var frameReady = false;
        var mountFrame = function () {
          var frame = document.querySelector(VIEW_SELECTOR);
          if (frame === null || frameReady) return;
          frameReady = true;
          renderPanel(frame, controller);
        };
        // The frame element is created in mountPanel; hook into its insertion by
        // observing the document for VIEW_SELECTOR arrival.
        var observer = new MutationObserver(function () { mountFrame(); });
        observer.observe(document.body, { childList: true, subtree: true });

        disposers.push(mountSidebarEntry(controller));
        disposers.push(mountPanel(controller));
        disposers.push(function () { observer.disconnect(); });
        mountFrame();
      } catch (error) {
        console.warn("[dsh-scholar-harness] mount failed:", error);
      }
      ctx.effect(function () {
        return function () {
          for (var i = 0; i < disposers.length; i++) { try { disposers[i](); } catch (e) { /* best effort */ } }
        };
      }, "dsh-scholar-harness: ui mounts");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
