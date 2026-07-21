---
name: pdf-wiki-obsidian-workflow
description: Synchronize, inspect, search, or export the Scholar Harness sentence-level PDF Wiki as an Obsidian-compatible Markdown Vault. Use whenever the user asks Codex to deploy, sync, search, open, share, or back up PDF Wiki notes in Obsidian.
---

# Scholar Harness PDF Wiki to Obsidian Workflow

Use the `scholarHarnessMetaAnalysis` MCP tools. Scholar Harness PDF Wiki is the source of truth;
do not create a second evidence database or rewrite reference mappings outside its local API.

## Workflow

1. Call `meta_health` first. If unavailable, ask the user to start Scholar Harness and keep it open.
2. Call `pdfwiki_obsidian_status` to inspect whether a managed Vault already exists, where it is,
   and when it was last synchronized.
3. Call `pdfwiki_obsidian_sync` only when the user explicitly asks to deploy, generate, rebuild, or
   synchronize the Vault. Report the returned `vaultDir`, note counts, and synchronization time.
4. For searches, call `pdfwiki_obsidian_search` with the user's exact keyword or phrase. Do not
   substitute a broader query unless the user asks for expansion.
5. Call `pdfwiki_obsidian_export` when the user wants a standalone copy for transfer, backup, or
   team sharing. Report the returned export directory.

## Data and citation constraints

- Preserve every stable `sentenceId`, `evidenceSentenceIds`, `inTextCitations`, and
  `referenceIndexes` mapping returned by Scholar Harness.
- Never infer a reference number from semantic similarity or a BM25 match.
- Treat the managed Vault as a generated view of PDF Wiki, not as a bidirectional database.
- Re-synchronize after PDF Wiki content changes; do not edit generated notes to replace source data.

## Obsidian boundary

The synchronization action generates an Obsidian-compatible Markdown Vault with YAML frontmatter
and Wiki links. It does not install, start, configure, or control the Obsidian desktop client. If the
user wants to browse the result in Obsidian, tell them to use **Open folder as vault** and select the
returned `vaultDir`.
