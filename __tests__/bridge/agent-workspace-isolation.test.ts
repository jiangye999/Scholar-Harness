import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

const sourcePath = path.resolve(process.cwd(), 'src/bridge/chat-bridge/chat-bridge.ts');
const source = fs.readFileSync(sourcePath, 'utf-8');

describe('coding agent workspace isolation', () => {
  it('uses a data-directory fallback instead of the application cwd', () => {
    expect(source).toContain("'agent-workspaces'");
    expect(source).toContain("await prepareAgentFallbackWorkspace(options, 'codex')");
    expect(source).toContain('await prepareAgentFallbackWorkspace(options, runtimeId)');
    expect(source).not.toMatch(/const (?:codexCwd|runtimeCwd) = [^;]+: process\.cwd\(\)/);
  });

  it('does not automatically mirror CLI snapshots into the source workspace', () => {
    expect(source).not.toContain('mirrorCodexWorkspaceArtifacts(');
    expect(source).toContain('publish_workspace_artifacts');
  });

  it('submits Agent turns without eagerly mirroring the source workspace', () => {
    expect(source).not.toContain('prepareWorkspaceWorkbench');
    expect(source).toContain('finalizeWorkspaceWorkbench');
    expect(source.match(/await prepareCodexSafeWorkspace\(/g)).toHaveLength(3);
    expect(source).toContain("PORTABLE_AGENT_BOOTSTRAP_VERSION = '2026-08-26-query-first-v3'");
  });

  it('creates only the runtime cwd before prompt delivery', () => {
    expect(source).toContain('Do not mirror source files, write bootstrap files, initialize Git');
    expect(source).toContain('await mkdir(safeRoot, { recursive: true });');
    expect(source).not.toContain('options.workspaceDirectory?.preparedForTurn === true');
  });
});
