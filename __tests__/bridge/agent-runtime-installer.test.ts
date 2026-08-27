import * as path from 'path';

import { describe, expect, it } from 'vitest';

import {
  getCodingAgentRuntimeInstallDescriptor,
  installCodingAgentRuntime,
} from '../../src/bridge/agent-runtime/installer';
import type { CodingAgentRuntimeId } from '../../src/bridge/agent-runtime/types';

describe('Coding Agent runtime installer', () => {
  it.each([
    ['codex', '@openai/codex', []],
    ['pi', '@earendil-works/pi-coding-agent', ['--ignore-scripts']],
    ['opencode', 'opencode-ai', []],
  ] as const)('installs only the approved %s npm package', async (runtimeId, packageName, extraArgs) => {
    const descriptor = getCodingAgentRuntimeInstallDescriptor(runtimeId);
    const globalPrefix = path.join('C:', 'test-npm-global');
    const expectedCommand = path.join(globalPrefix, `${descriptor.commandName}.cmd`);
    const calls: Array<{ executable: string; args: string[] }> = [];
    const result = await installCodingAgentRuntime(runtimeId, {
      platform: 'win32',
      resolveExecutable: (_configured, commands) => commands[0] === 'npm' ? 'npm-test.cmd' : null,
      fileExists: commandPath => commandPath === expectedCommand,
      capture: async (executable, args) => {
        calls.push({ executable, args });
        if (args[0] === '--version') {
          return { stdout: executable === expectedCommand ? `${runtimeId} 1.0.0` : '10.8.2', stderr: '', code: 0 };
        }
        if (args[0] === 'prefix') return { stdout: globalPrefix, stderr: '', code: 0 };
        return { stdout: 'installed', stderr: '', code: 0 };
      },
    });

    expect(result).toMatchObject({
      success: true,
      runtimeId,
      packageName,
      commandPath: expectedCommand,
    });
    const installCall = calls.find(call => call.args[0] === 'install');
    expect(installCall?.executable).toBe('npm-test.cmd');
    expect(installCall?.args.some(arg => arg.startsWith(`${packageName}@`))).toBe(true);
    expect(installCall?.args).toContain('--global');
    extraArgs.forEach(arg => expect(installCall?.args).toContain(arg));
  });

  it('returns a structured prerequisite error when npm is unavailable', async () => {
    const result = await installCodingAgentRuntime('codex', {
      resolveExecutable: () => null,
    });

    expect(result).toMatchObject({
      success: false,
      errorCode: 'NPM_NOT_FOUND',
      commandPath: '',
    });
  });

  it('rejects runtime identifiers outside the fixed installer inventory', () => {
    expect(() => getCodingAgentRuntimeInstallDescriptor('shell-template' as CodingAgentRuntimeId))
      .toThrow(/Unknown Coding Agent runtime installer/);
  });
});
