import { existsSync } from 'fs';
import * as path from 'path';

import { logger } from '../../utils/logger';
import { captureRuntimeCommand, resolveRuntimeExecutable } from './process-utils';
import type {
  CodingAgentRuntimeId,
  CodingAgentRuntimeInstallDescriptor,
  CodingAgentRuntimeInstallResult,
} from './types';

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_LIMIT = 4_000;

const RUNTIME_INSTALLERS: Record<CodingAgentRuntimeId, CodingAgentRuntimeInstallDescriptor> = {
  codex: {
    runtimeId: 'codex',
    label: 'Codex',
    packageName: '@openai/codex',
    commandName: 'codex',
    installArgs: ['install', '--global', '--no-audit', '--no-fund', '@openai/codex'],
    authenticationHint: '部署完成后首次使用时，请按 Codex CLI 提示登录。',
  },
  pi: {
    runtimeId: 'pi',
    label: 'Pi',
    packageName: '@earendil-works/pi-coding-agent',
    commandName: 'pi',
    installArgs: ['install', '--global', '--no-audit', '--no-fund', '--ignore-scripts', '@earendil-works/pi-coding-agent'],
    authenticationHint: '部署完成后，请在 Pi 中使用 /login 配置模型提供商。',
  },
  opencode: {
    runtimeId: 'opencode',
    label: 'OpenCode',
    packageName: 'opencode-ai',
    commandName: 'opencode',
    installArgs: ['install', '--global', '--no-audit', '--no-fund', 'opencode-ai'],
    authenticationHint: '部署完成后，请在 OpenCode 中使用 /connect 配置模型提供商。',
  },
};

type CommandCapture = typeof captureRuntimeCommand;
type ExecutableResolver = typeof resolveRuntimeExecutable;

export interface CodingAgentRuntimeInstallerDependencies {
  capture?: CommandCapture;
  resolveExecutable?: ExecutableResolver;
  fileExists?: typeof existsSync;
  platform?: NodeJS.Platform;
}

function tailOutput(value: string): string {
  const normalized = String(value || '').trim();
  return normalized.length > OUTPUT_LIMIT ? normalized.slice(-OUTPUT_LIMIT) : normalized;
}

function installedCommandCandidates(
  prefix: string,
  commandName: string,
  platform: NodeJS.Platform,
): string[] {
  const root = String(prefix || '').trim();
  if (!root) return [];
  if (platform === 'win32') {
    return [path.join(root, `${commandName}.cmd`), path.join(root, `${commandName}.exe`)];
  }
  return [path.join(root, 'bin', commandName)];
}

export function getCodingAgentRuntimeInstallDescriptor(
  runtimeId: CodingAgentRuntimeId,
): CodingAgentRuntimeInstallDescriptor {
  const descriptor = RUNTIME_INSTALLERS[runtimeId];
  if (!descriptor) throw new Error(`Unknown Coding Agent runtime installer: ${runtimeId}`);
  return descriptor;
}

export async function installCodingAgentRuntime(
  runtimeId: CodingAgentRuntimeId,
  dependencies: CodingAgentRuntimeInstallerDependencies = {},
): Promise<CodingAgentRuntimeInstallResult> {
  const descriptor = getCodingAgentRuntimeInstallDescriptor(runtimeId);
  const capture = dependencies.capture || captureRuntimeCommand;
  const resolveExecutable = dependencies.resolveExecutable || resolveRuntimeExecutable;
  const fileExists = dependencies.fileExists || existsSync;
  const platform = dependencies.platform || process.platform;
  const baseResult = {
    runtimeId,
    packageName: descriptor.packageName,
    commandName: descriptor.commandName,
    authenticationHint: descriptor.authenticationHint,
  };
  const npmExecutable = resolveExecutable('', ['npm']);
  if (!npmExecutable) {
    return {
      ...baseResult,
      success: false,
      commandPath: '',
      message: '未检测到 npm。请先安装 Node.js 22 或更高版本，再重试一键部署。',
      errorCode: 'NPM_NOT_FOUND',
    };
  }

  try {
    const npmVersionResult = await capture(npmExecutable, ['--version'], { timeoutMs: 20_000 });
    const npmVersion = tailOutput(npmVersionResult.stdout || npmVersionResult.stderr).split(/\r?\n/)[0] || '';
    if (npmVersionResult.code !== 0) {
      return {
        ...baseResult,
        success: false,
        commandPath: '',
        npmVersion,
        message: 'npm 无法正常运行，请检查 Node.js 安装后重试。',
        output: tailOutput(npmVersionResult.stderr || npmVersionResult.stdout),
        errorCode: 'NPM_UNAVAILABLE',
      };
    }

    logger.info(`[AgentRuntimeInstaller] Installing ${descriptor.packageName} for ${runtimeId}`);
    const installResult = await capture(npmExecutable, descriptor.installArgs, {
      timeoutMs: INSTALL_TIMEOUT_MS,
      env: { npm_config_update_notifier: 'false' },
    });
    const output = tailOutput(`${installResult.stdout}\n${installResult.stderr}`);
    if (installResult.code !== 0) {
      const permissionFailure = /(?:EACCES|EPERM|permission denied|access is denied)/i.test(output);
      return {
        ...baseResult,
        success: false,
        commandPath: '',
        npmVersion,
        message: permissionFailure
          ? 'npm 没有全局安装权限。请调整 npm 全局目录，或手动安装后填写 CLI 路径。'
          : `部署 ${descriptor.label} CLI 失败，请检查网络和 npm 配置后重试。`,
        output,
        errorCode: permissionFailure ? 'NPM_PERMISSION_DENIED' : 'INSTALL_FAILED',
      };
    }

    const prefixResult = await capture(npmExecutable, ['prefix', '--global'], { timeoutMs: 20_000 });
    const prefix = prefixResult.code === 0 ? tailOutput(prefixResult.stdout).split(/\r?\n/)[0] : '';
    const candidate = installedCommandCandidates(prefix, descriptor.commandName, platform)
      .find(commandPath => fileExists(commandPath));
    const commandPath = candidate || resolveExecutable('', [descriptor.commandName]) || '';
    let version = '';
    if (commandPath) {
      try {
        const versionResult = await capture(commandPath, ['--version'], { timeoutMs: 20_000 });
        version = tailOutput(versionResult.stdout || versionResult.stderr).split(/\r?\n/)[0] || '';
      } catch {
        // Installation succeeded even if the version probe needs a fresh process environment.
      }
    }
    return {
      ...baseResult,
      success: true,
      commandPath,
      npmVersion,
      version,
      message: commandPath
        ? `${descriptor.label} CLI 已部署并检测成功。`
        : `${descriptor.label} CLI 已由 npm 安装，但暂未定位到命令路径。请重启应用后重新检测。`,
      output,
    };
  } catch (error) {
    logger.error(`[AgentRuntimeInstaller] ${runtimeId} installation failed`, error);
    return {
      ...baseResult,
      success: false,
      commandPath: '',
      message: `部署 ${descriptor.label} CLI 时发生错误：${(error as Error).message}`,
      errorCode: 'INSTALL_EXCEPTION',
    };
  }
}
