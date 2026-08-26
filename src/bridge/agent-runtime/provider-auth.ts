import { spawn } from 'child_process';

import { logger } from '../../utils/logger';
import { resolveRuntimeExecutable } from './process-utils';
import type {
  CodingAgentProviderAuthConfig,
  CodingAgentProviderDescriptor,
  CodingAgentRuntimeId,
} from './types';

type ProviderDefinition = CodingAgentProviderDescriptor & { piEnvironmentVariable?: string };

const PROVIDERS: ProviderDefinition[] = [
  { id: 'anthropic', label: 'Anthropic', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'ANTHROPIC_API_KEY' },
  { id: 'openai', label: 'OpenAI', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'OPENAI_API_KEY' },
  { id: 'openai-codex', label: 'OpenAI Codex 登录', apiKeySupported: false, loginSupported: true },
  { id: 'google', label: 'Google Gemini', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'GEMINI_API_KEY' },
  { id: 'openrouter', label: 'OpenRouter', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'OPENROUTER_API_KEY' },
  { id: 'deepseek', label: 'DeepSeek', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'DEEPSEEK_API_KEY' },
  { id: 'xai', label: 'xAI', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'XAI_API_KEY' },
  { id: 'mistral', label: 'Mistral', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'MISTRAL_API_KEY' },
  { id: 'groq', label: 'Groq', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'GROQ_API_KEY' },
  { id: 'cerebras', label: 'Cerebras', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'CEREBRAS_API_KEY' },
  { id: 'nvidia', label: 'NVIDIA NIM', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'NVIDIA_API_KEY' },
  { id: 'fireworks', label: 'Fireworks AI', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'FIREWORKS_API_KEY' },
  { id: 'together', label: 'Together AI', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'TOGETHER_API_KEY' },
  { id: 'huggingface', label: 'Hugging Face', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'HF_TOKEN' },
  { id: 'vercel-ai-gateway', label: 'Vercel AI Gateway', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'AI_GATEWAY_API_KEY' },
  { id: 'azure-openai-responses', label: 'Azure OpenAI', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'AZURE_OPENAI_API_KEY' },
  { id: 'amazon-bedrock', label: 'Amazon Bedrock', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'AWS_BEARER_TOKEN_BEDROCK' },
  { id: 'github-copilot', label: 'GitHub Copilot 登录', apiKeySupported: false, loginSupported: true },
  { id: 'opencode', label: 'OpenCode Zen', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'OPENCODE_API_KEY' },
  { id: 'opencode-go', label: 'OpenCode Go', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'OPENCODE_API_KEY' },
  { id: 'zai', label: 'Z.AI', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'ZAI_API_KEY' },
  { id: 'zai-coding-cn', label: 'Z.AI Coding Plan 中国', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'ZAI_CODING_CN_API_KEY' },
  { id: 'kimi-coding', label: 'Kimi For Coding', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'KIMI_API_KEY' },
  { id: 'minimax', label: 'MiniMax', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'MINIMAX_API_KEY' },
  { id: 'minimax-cn', label: 'MiniMax 中国', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'MINIMAX_CN_API_KEY' },
  { id: 'baseten', label: 'Baseten', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'BASETEN_API_KEY' },
  { id: 'ant-ling', label: 'Ant Ling', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'ANT_LING_API_KEY' },
  { id: 'radius', label: 'Radius', apiKeySupported: true, loginSupported: true, piEnvironmentVariable: 'RADIUS_API_KEY' },
];

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,119}$/;

export function normalizeProviderId(value: unknown): string {
  const provider = String(value || '').trim().toLowerCase();
  if (!provider || !PROVIDER_ID_PATTERN.test(provider)) return '';
  return provider;
}

export function getCodingAgentProviders(runtimeId: CodingAgentRuntimeId): CodingAgentProviderDescriptor[] {
  if (runtimeId === 'codex') return [];
  return PROVIDERS
    .filter(provider => runtimeId === 'opencode' || provider.id !== 'openai-codex')
    .map(provider => ({
      id: provider.id,
      label: provider.label,
      apiKeySupported: runtimeId === 'opencode' ? provider.apiKeySupported : Boolean(provider.piEnvironmentVariable),
      loginSupported: provider.loginSupported,
      ...(runtimeId === 'pi' && provider.piEnvironmentVariable
        ? { environmentVariable: provider.piEnvironmentVariable }
        : {}),
    }));
}

export function buildCodingAgentAuthEnvironment(
  runtimeId: Exclude<CodingAgentRuntimeId, 'codex'>,
  auth?: CodingAgentProviderAuthConfig,
): Record<string, string> {
  if (auth?.mode !== 'api_key' || !auth.api_key) return {};
  const provider = normalizeProviderId(auth.provider);
  if (!provider) throw new Error('MODEL_PROVIDER_REQUIRED: 请先选择模型厂商');
  if (runtimeId === 'opencode') {
    return {
      OPENCODE_AUTH_CONTENT: JSON.stringify({
        [provider]: { type: 'api', key: auth.api_key },
      }),
    };
  }
  const definition = PROVIDERS.find(item => item.id === provider);
  if (!definition?.piEnvironmentVariable) {
    throw new Error(`PI_PROVIDER_API_KEY_UNSUPPORTED: Pi 暂不支持通过界面向 ${provider} 注入单一 API Key，请改用 CLI 登录`);
  }
  return { [definition.piEnvironmentVariable]: auth.api_key };
}

export interface RuntimeLoginLaunchResult {
  launched: boolean;
  command: string;
  instruction: string;
}

function quoteCommandPart(value: string): string {
  return /\s|"/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

export function launchCodingAgentLogin(
  runtimeId: Exclude<CodingAgentRuntimeId, 'codex'>,
  command: string | undefined,
  providerValue: string,
): RuntimeLoginLaunchResult {
  const provider = normalizeProviderId(providerValue);
  if (!provider) throw new Error('MODEL_PROVIDER_REQUIRED: 请先选择模型厂商');
  const executable = resolveRuntimeExecutable(command, [runtimeId === 'pi' ? 'pi' : 'opencode']);
  if (!executable) throw new Error(`${runtimeId.toUpperCase()}_RUNTIME_UNAVAILABLE: CLI 未安装或路径不可用`);
  const args = runtimeId === 'opencode' ? ['--pure', 'auth', 'login', '--provider', provider] : [];
  const previewArgs = runtimeId === 'pi' ? [`进入 Pi 后输入 /login ${provider}`] : args;
  const preview = [executable, ...previewArgs].map(quoteCommandPart).join(' ');
  const instruction = runtimeId === 'pi'
    ? `已打开 Pi 登录终端，请输入 /login ${provider} 并按提示完成认证。`
    : `已打开 OpenCode 登录终端，请按提示完成 ${provider} 认证。`;

  if (process.platform !== 'win32') {
    return { launched: false, command: preview, instruction: `请在系统终端运行：${preview}` };
  }
  const comspec = process.env.ComSpec || 'cmd.exe';
  const child = spawn(comspec, ['/d', '/k', 'call', executable, ...args], {
    detached: true,
    windowsHide: false,
    stdio: 'ignore',
  });
  child.once('error', error => {
    logger.warn(`[AgentRuntimeAuth] Unable to launch ${runtimeId} login terminal`, error);
  });
  child.unref();
  return { launched: true, command: preview, instruction };
}
