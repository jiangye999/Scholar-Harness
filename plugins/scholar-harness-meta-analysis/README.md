# Scholar Harness Meta + PDF Wiki Plugin

This Codex plugin exposes the complete Scholar Harness Meta-analysis workflow plus PDF Wiki to
Obsidian Vault synchronization as MCP tools. The desktop application remains the source of truth
for PDF records, sentence-level evidence, coding tables, analysis results, R artifacts, and writing
context.

## Prerequisites

1. Start Scholar Harness. Its local service normally listens on `http://127.0.0.1:18789`.
2. Configure the global R plugin in Scholar Harness before requesting R plots.
3. Keep the desktop application running while Codex uses this plugin.

Obsidian itself is optional. The plugin generates and searches a standard Markdown Vault through
Scholar Harness; it does not install or launch the Obsidian desktop client. To browse the generated
notes in Obsidian, open the returned `vaultDir` as an existing Vault.

Optional environment variables:

- `SCHOLAR_HARNESS_META_URL`: local service URL.
- `SCHOLAR_HARNESS_META_USER_ID`: default Scholar Harness user ID.
- `SCHOLAR_HARNESS_SESSION_COOKIE`: session cookie when local API authentication requires it.
- `SCHOLAR_HARNESS_META_TIMEOUT_MS`: request timeout, default 600000 ms.

## Build and validate

```powershell
npx tsc -p plugins/scholar-harness-meta-analysis/tsconfig.json
node plugins/scholar-harness-meta-analysis/scripts/smoke-test.cjs
python C:/Users/Administrator/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/scholar-harness-meta-analysis
```

## Data ownership

The MCP server does not maintain a second Meta-analysis or PDF Wiki database. Every write goes
through the Scholar Harness local API, so Meta results and Obsidian-compatible notes are generated
from the existing desktop data and can be reused by the writing workflow.

## PDF Wiki to Obsidian

- `pdfwiki_obsidian_status`: inspect the managed Vault state and path.
- `pdfwiki_obsidian_sync`: one-click rebuild/synchronize the managed Vault from the current PDF Wiki.
- `pdfwiki_obsidian_search`: search sentence, PDF, topic, and index Markdown notes.
- `pdfwiki_obsidian_export`: create a timestamped standalone Vault copy for sharing or backup.

Suggested Codex prompt: `把当前 PDF Wiki 一键同步为 Obsidian Vault。`
