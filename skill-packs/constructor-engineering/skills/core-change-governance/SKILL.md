---
name: core-change-governance
description: Govern Constructor Agent changes that modify Scholar Harness core frontend, backend, Electron, cloud, database, authentication, payment, update, or user-data behavior. Use when a requested feature cannot be delivered as an isolated runtime feature package, when existing behavior will be replaced or removed, or when a generated core-change candidate is about to be applied or rolled back.
---

# Core Change Governance

## Purpose

Allow the Constructor Agent to understand and improve the entire Scholar Harness codebase without treating user consent, validation, or rollback as optional. Separate planning, candidate generation, application, and rollback into auditable stages.

## Non-negotiable Model

- Read the generated software capability map before naming affected modules.
- Prefer a runtime feature package for isolated, reversible UI, navigation, command, and private-storage additions.
- Use a core change only when the requirement must alter existing source, contracts, data flow, Electron behavior, cloud behavior, or shared state.
- Never interpret silence, prior consent, a queued message, or a general request such as “继续” as approval for a major change.
- Never modify `app.asar`, an installation directory, production data, secrets, or deployment credentials in place.
- Generate core candidates in an isolated source copy. A candidate is not permission to apply it.

## Risk Classification

Classify before generating code:

- `low`: a new isolated runtime page, navigation item, command, or feature-private storage. Install disabled by default.
- `medium`: changes visibility or behavior of an existing page, imports/exports, shared UI state, or migration-free shared data. Require plan approval.
- `high`: modifies local routes, services, shared chat/PDF/Meta/literature contracts, Electron main process, packaging, updater, or website release behavior. Require plan approval and apply approval.
- `critical`: affects identity, authentication, payment, subscription, licensing, distributor accounting, database migrations, deletion, or user data. Require two explicit approvals, backups, targeted tests, and automatic rollback on failure.

Escalate to the higher level when uncertain.

## Workflow

### 1. Establish the Change Contract

Record:

- objective and observable acceptance criteria;
- affected product domains, routes, services, UI modules, data stores, and recovery flows;
- unchanged behavior that must remain intact;
- risk level and why;
- validation commands;
- rollback strategy.

Do not begin candidate generation for medium, high, or critical changes until the user explicitly approves the plan.

### 2. Generate an Isolated Candidate

- Copy the permitted source set into the Constructor Agent workspace.
- Save a content-hash baseline outside that workspace.
- Give the engineering executor only the relevant capability-map slices.
- Exclude `.env`, credentials, user files, databases, `node_modules`, build products, installers, and release artifacts.
- Require a `CONSTRUCTOR_CHANGE_REPORT.md` that lists changed files, tests, limitations, migrations, and rollback notes.

The candidate may inspect and edit only its isolated workspace.

### 3. Review Before Application

Compute added, modified, and deleted files against the saved baseline. Present this exact file list to the user. For high and critical changes, require a second explicit approval phrase before application.

Reject candidates that:

- introduce undeclared network, shell, filesystem, or secret access;
- alter package lifecycle scripts without a separately approved dependency plan;
- remove functionality or data outside the accepted scope;
- lack tests or a rollback route;
- touch paths outside the permitted source set.

### 4. Backup, Apply, and Validate

- Back up every existing destination file and record which candidate files are new.
- Apply only the reviewed diff.
- Run `node scripts/check-public-js.js` for frontend changes.
- Run `npm run build` for local application changes.
- Run the narrowest applicable Vitest suites from `AGENTS.md`.
- Run cloud or website builds when those layers changed.
- Do not claim completion while the running process still uses stale backend code; state when a restart is required.

If required validation fails, restore the backup automatically and mark the change `rolled-back`.

### 5. Preserve Rollback

Keep the backup manifest and change record after a successful application. A manual rollback must restore modified/deleted files and remove files that did not exist before application. Do not delete user-created data as part of code rollback.

## Output Contract

Every governed change must expose:

- change id;
- mode and risk;
- current approval/application status;
- affected domains and files;
- validation results;
- backup location or versioned update artifact;
- explicit rollback action;
- restart/deployment requirement.

Use factual status language. “Candidate generated” is not “installed”; “files applied” is not “running in the current process”; “build passed” is not “production deployed”.
