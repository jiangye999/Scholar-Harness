# Public frontend module boundaries

The desktop renderer still uses classic browser scripts, but feature code no
longer lives in one multi-megabyte inline script in `src/public/index.html`.
The HTML file owns markup, shared CSS, and deterministic script loading only.

## Load order

1. `app/module-runtime.js`
2. `app/app-core.js`
3. `app/shell-navigation.js`
4. `app/chat-context.js`
5. `app/writing-workspace.js`
6. `app/experiment-composer.js`
7. `app/settings-runtime.js`
8. `app/skill-config.js`
9. `app/provider-config.js`
10. `app/content-tools.js`
11. `app/memory-management.js`
12. `app/project-runtime.js`
13. `app/feature-state.js`
14. `app/academic-workflows.js`
15. `embedding-library.js`
16. `bibliometrics.js`
17. `app/pdf-wiki-core.js`
18. `app/meta-analysis.js`
19. `app/pdf-wiki-workspace.js`
20. `app/auto-research.js`
21. `app/chat-history.js`
22. `app/pdf-wiki-upload.js`
23. `app/chat.js`
24. `app/analysis-tools.js`

Classic script order is intentional. Existing top-level functions and variables
remain available to later modules while feature ownership becomes explicit.

## Stylesheet order

1. `styles/core.css` — reset, tokens, typography, base controls, and shared
   accessibility behavior.
2. `styles/shell-layout.css` — application shell, sidebars, workspace pages,
   dialogs, PDF/Meta/Skill/plugin layouts, and shared cards.
3. `styles/experiment-upload.css` — experiment upload composer and its file
   previews.
4. `styles/chat-composer.css` — chat messages, Pi Agent status, attachments,
   image galleries, input composer, and right-side preview surfaces.
5. `styles/popovers.css` — provider/model selectors and compact popovers.
6. `styles/compatibility.css` — narrow compatibility overrides that must load
   after the main component styles.
7. `styles/responsive.css` — viewport and container responsive rules; this
   remains last so its cascade behavior matches the former inline stylesheet.

The order above is a compatibility contract. Move a rule to the stylesheet that
owns the component, but do not change stylesheet order merely to solve a local
specificity issue.

## Ownership

- `app-core`: shared icons, storage keys, provider defaults, and base runtime
  configuration.
- `shell-navigation`: home utility pages, application menus, theme, and left
  and right sidebar lifecycle.
- `chat-context`: main chat state, query navigation, attached analysis
  contexts, workspace directory, provider selector, and query envelopes.
- `writing-workspace`: article progress, figure library, discussion framework,
  and writing target state.
- `experiment-composer`: experiment file intake, multimodal routing, generated
  R execution, and attachment result rendering.
- `settings-runtime`: API persistence, modal lifecycle, feedback, and shared
  settings primitives.
- `skill-config`: user/system Skills, optimization lab, onboarding, guided
  configuration, and Codex preference controls.
- `provider-config`: provider setup, model/web/PDF/Embedding configuration,
  parser installation controls, and update prompts.
- `content-tools`: journal style, draft, experiment/data summary, and memory
  update tools.
- `memory-management`: long-term memory inspection and deletion UI.
- `project-runtime`: conversation persistence, project profiles, and project
  lifecycle.
- `feature-state`: shared PDF Wiki, Meta, Auto Research, and overview state
  declarations required before feature modules load.
- `academic-workflows`: thesis and research-enhancement workspace navigation.
- `pdf-wiki-core`: PDF Wiki viewer, topic workspace, network graph, and
  sentence-level interactions.
- `pdf-wiki-workspace`: PDF management, reader, figures, recognition, and
  paper-specific workspace behavior.
- `pdf-wiki-upload`: PDF Wiki upload composer, duplicate preflight, and
  persistent queue progress.
- `meta-analysis`: Meta database, coding table, digitization review, and Meta
  analysis workspace.
- `bibliometrics`: bibliometric workspace, networks, artifacts, and writing
  preparation.
- `chat-history`: project and conversation persistence and history UI.
- `chat`: main composer, intent orchestration, streaming output, and message
  rendering.
- `auto-research`: Auto Research workspace and result integration.
- `analysis-tools`: experiment/data analysis, R plotting, and presentation
  utilities.

## Rules for future changes

- Add feature behavior to its owning module instead of putting new inline
  JavaScript back into `index.html`.
- Add CSS to the owning stylesheet under `src/public/styles`; do not recreate a
  monolithic inline `<style>` block.
- Keep cross-module entry points explicit on `window` until the renderer is
  migrated to bundled ES modules.
- Register every loaded module with `window.ScholarHarnessModules` so startup
  diagnostics can identify missing scripts.
- Do not reorder script tags without checking downstream global dependencies.
- Source-contract tests must use `readPublicAppSource()` when they need the
  complete renderer, or `readPublicModuleSource()` for module-scoped negative
  assertions.

## Validation

```bash
node scripts/check-public-js.js
npx vitest run __tests__/public
npm run build
```
