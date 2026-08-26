import type { CodexBridgeToolSet, PiSteeringMessage } from '../../types';

export type CodingAgentRuntimeId = 'codex' | 'pi' | 'opencode';
export type CodingAgentSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';
export type CodingAgentProviderAuthMode = 'api_key' | 'cli_login';

export interface CodingAgentProviderAuthConfig {
  mode?: CodingAgentProviderAuthMode;
  provider?: string;
  api_key?: string;
  has_api_key?: boolean;
}

export interface CodingAgentRuntimeConfig {
  enabled?: boolean;
  prefer?: boolean;
  command?: string;
  model?: string;
  reasoning_effort?: string;
  sandbox?: CodingAgentSandbox;
  timeout_ms?: number;
  auto_approve?: boolean;
  fallback_to_secondary?: boolean;
  provider_auth?: CodingAgentProviderAuthConfig;
}

export interface CodingAgentRuntimeCapabilities {
  persistentSession: boolean;
  streaming: boolean;
  tools: boolean;
  mcp: boolean;
  steering: boolean;
  followUp: boolean;
  cancellation: boolean;
  images: boolean;
  modelDiscovery: boolean;
}

export interface CodingAgentRuntimeDescriptor {
  id: CodingAgentRuntimeId;
  label: string;
  protocol: 'codex-app-server' | 'pi-rpc' | 'opencode-json';
  defaultCommand: string;
  defaultModel: string;
  capabilities: CodingAgentRuntimeCapabilities;
}

export interface CodingAgentRuntimeStatus {
  id: CodingAgentRuntimeId;
  available: boolean;
  path: string;
  version?: string;
  error?: string;
}

export interface CodingAgentRuntimeModel {
  slug: string;
  displayName: string;
  provider?: string;
  defaultReasoningLevel?: string;
  supportedReasoningLevels?: Array<{ effort: string; description?: string }>;
}

export interface CodingAgentProviderDescriptor {
  id: string;
  label: string;
  apiKeySupported: boolean;
  loginSupported: boolean;
  environmentVariable?: string;
}

export interface CodingAgentRuntimeInstallDescriptor {
  runtimeId: CodingAgentRuntimeId;
  label: string;
  packageName: string;
  commandName: string;
  installArgs: string[];
  authenticationHint: string;
}

export interface CodingAgentRuntimeInstallResult {
  success: boolean;
  runtimeId: CodingAgentRuntimeId;
  packageName: string;
  commandName: string;
  commandPath: string;
  npmVersion?: string;
  version?: string;
  message: string;
  authenticationHint: string;
  output?: string;
  errorCode?: 'NPM_NOT_FOUND' | 'NPM_UNAVAILABLE' | 'NPM_PERMISSION_DENIED' | 'INSTALL_FAILED' | 'INSTALL_EXCEPTION';
}

export type CodingAgentRuntimeEventType =
  | 'session.started'
  | 'turn.started'
  | 'assistant.delta'
  | 'thinking.delta'
  | 'tool.started'
  | 'tool.progress'
  | 'tool.completed'
  | 'permission.requested'
  | 'usage.updated'
  | 'turn.completed'
  | 'turn.failed'
  | 'runtime.stderr';

export interface CodingAgentRuntimeEvent {
  type: CodingAgentRuntimeEventType;
  runtimeId: CodingAgentRuntimeId;
  sessionId?: string;
  text?: string;
  toolName?: string;
  usage?: CodingAgentRuntimeUsage;
  data?: Record<string, unknown>;
}

export interface CodingAgentRuntimeUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  totalTokens: number;
}

export interface CodingAgentRuntimeToolReceipt {
  callId: string;
  name: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface CodingAgentRuntimeTurnRequest {
  runtimeId: CodingAgentRuntimeId;
  conversationKey: string;
  cwd: string;
  /** Full one-time bootstrap prompt used only when a runtime session is new. */
  prompt: string;
  /** Small per-turn delta used when the runtime confirms that it resumed a session. */
  resumePrompt?: string;
  developerInstructions?: string;
  command?: string;
  model?: string;
  reasoningEffort?: string;
  providerAuth?: CodingAgentProviderAuthConfig;
  sandbox: CodingAgentSandbox;
  timeoutMs: number;
  compactInputTokenThreshold?: number;
  imagePaths?: string[];
  skillRoots?: string[];
  toolSet?: CodexBridgeToolSet;
  mcpServerScript?: string;
  isCancelled?: () => boolean;
  takeSteeringMessages?: (options?: { allowAttachments?: boolean }) => Promise<PiSteeringMessage[]>;
  markSteeringApplied?: (messageId: string) => Promise<void>;
  requeueSteeringMessage?: (messageId: string) => Promise<void>;
  onEvent?: (event: CodingAgentRuntimeEvent) => void;
}

export interface CodingAgentRuntimeTurnResult {
  answer: string;
  sessionId: string;
  resumed: boolean;
  usage?: CodingAgentRuntimeUsage;
  receipts: CodingAgentRuntimeToolReceipt[];
}

export interface CodingAgentProtocolAdapter {
  readonly descriptor: CodingAgentRuntimeDescriptor;
  status(config?: CodingAgentRuntimeConfig): Promise<CodingAgentRuntimeStatus>;
  listModels(config?: CodingAgentRuntimeConfig): Promise<CodingAgentRuntimeModel[]>;
  runTurn(request: CodingAgentRuntimeTurnRequest): Promise<CodingAgentRuntimeTurnResult>;
  interrupt(conversationKeyPrefix: string): Promise<number>;
  /** Forget an oversized native context while retaining the runtime configuration and tools. */
  resetContext?(conversationKey: string): Promise<void> | void;
  dispose?(conversationKey: string): void;
}
