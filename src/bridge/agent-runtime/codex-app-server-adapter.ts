import type { ChildProcess } from 'child_process';

import {
  codexAppServerManager,
  type CodexToolGatewayConnection,
} from '../chat-bridge/codex-app-server';
import type {
  CodingAgentProtocolAdapter,
  CodingAgentRuntimeConfig,
  CodingAgentRuntimeModel,
  CodingAgentRuntimeStatus,
  CodingAgentRuntimeTurnRequest,
  CodingAgentRuntimeTurnResult,
} from './types';

export interface CodexAppServerRuntimeAdapterOptions {
  status: (config?: CodingAgentRuntimeConfig) => Promise<CodingAgentRuntimeStatus>;
  listModels: (config?: CodingAgentRuntimeConfig) => Promise<CodingAgentRuntimeModel[]>;
  spawnAppServer: (connection: CodexToolGatewayConnection) => ChildProcess;
}

export class CodexAppServerRuntimeAdapter implements CodingAgentProtocolAdapter {
  readonly descriptor = {
    id: 'codex' as const,
    label: 'Codex',
    protocol: 'codex-app-server' as const,
    defaultCommand: 'codex',
    defaultModel: 'gpt-5.5',
    capabilities: {
      persistentSession: true,
      streaming: true,
      tools: true,
      mcp: true,
      steering: true,
      followUp: true,
      cancellation: true,
      images: true,
      modelDiscovery: true,
    },
  };

  constructor(private readonly options: CodexAppServerRuntimeAdapterOptions) {}

  status(config?: CodingAgentRuntimeConfig): Promise<CodingAgentRuntimeStatus> {
    return this.options.status(config);
  }

  listModels(config?: CodingAgentRuntimeConfig): Promise<CodingAgentRuntimeModel[]> {
    return this.options.listModels(config);
  }

  async runTurn(request: CodingAgentRuntimeTurnRequest): Promise<CodingAgentRuntimeTurnResult> {
    const result = await codexAppServerManager.runTurn({
      conversationKey: request.conversationKey,
      cwd: request.cwd,
      prompt: request.prompt,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      sandbox: request.sandbox,
      timeoutMs: request.timeoutMs,
      compactInputTokenThreshold: request.compactInputTokenThreshold,
      developerInstructions: request.developerInstructions,
      imagePaths: request.imagePaths,
      skillRoots: request.skillRoots,
      toolSet: request.toolSet,
      isCancelled: request.isCancelled,
      takeSteeringMessages: request.takeSteeringMessages,
      markSteeringApplied: request.markSteeringApplied,
      requeueSteeringMessage: request.requeueSteeringMessage,
      spawnAppServer: this.options.spawnAppServer,
      onProgress: chunk => request.onEvent?.({
        type: 'assistant.delta',
        runtimeId: 'codex',
        sessionId: codexAppServerManager.getThreadId(request.conversationKey) || undefined,
        text: chunk,
      }),
    });
    return {
      answer: result.answer,
      sessionId: result.threadId,
      resumed: result.resumed,
      usage: result.usage,
      receipts: result.receipts,
    };
  }

  async interrupt(conversationKeyPrefix: string): Promise<number> {
    const result = await codexAppServerManager.interruptConversationsByPrefix(conversationKeyPrefix);
    return result.interrupted;
  }

  dispose(conversationKey: string): void {
    codexAppServerManager.disposeConversation(conversationKey);
  }

  resetContext(conversationKey: string): void {
    codexAppServerManager.disposeConversation(conversationKey, true);
  }
}
