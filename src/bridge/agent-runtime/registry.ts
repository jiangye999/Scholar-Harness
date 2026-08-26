import type {
  CodingAgentProtocolAdapter,
  CodingAgentRuntimeConfig,
  CodingAgentRuntimeDescriptor,
  CodingAgentRuntimeId,
  CodingAgentRuntimeModel,
  CodingAgentRuntimeStatus,
  CodingAgentRuntimeTurnRequest,
  CodingAgentRuntimeTurnResult,
} from './types';

export class CodingAgentRuntimeRegistry {
  private readonly adapters = new Map<CodingAgentRuntimeId, CodingAgentProtocolAdapter>();

  register(adapter: CodingAgentProtocolAdapter): void {
    if (this.adapters.has(adapter.descriptor.id)) {
      throw new Error(`Coding Agent runtime already registered: ${adapter.descriptor.id}`);
    }
    this.adapters.set(adapter.descriptor.id, adapter);
  }

  list(): CodingAgentRuntimeDescriptor[] {
    return Array.from(this.adapters.values()).map(adapter => adapter.descriptor);
  }

  get(id: CodingAgentRuntimeId): CodingAgentProtocolAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Unknown Coding Agent runtime: ${id}`);
    return adapter;
  }

  status(id: CodingAgentRuntimeId, config?: CodingAgentRuntimeConfig): Promise<CodingAgentRuntimeStatus> {
    return this.get(id).status(config);
  }

  listModels(id: CodingAgentRuntimeId, config?: CodingAgentRuntimeConfig): Promise<CodingAgentRuntimeModel[]> {
    return this.get(id).listModels(config);
  }

  runTurn(request: CodingAgentRuntimeTurnRequest): Promise<CodingAgentRuntimeTurnResult> {
    return this.get(request.runtimeId).runTurn(request);
  }

  interrupt(id: CodingAgentRuntimeId, conversationKeyPrefix: string): Promise<number> {
    return this.get(id).interrupt(conversationKeyPrefix);
  }

  async resetContext(id: CodingAgentRuntimeId, conversationKey: string): Promise<void> {
    const adapter = this.get(id);
    if (adapter.resetContext) {
      await adapter.resetContext(conversationKey);
      return;
    }
    adapter.dispose?.(conversationKey);
  }

  dispose(id: CodingAgentRuntimeId, conversationKey: string): void {
    this.get(id).dispose?.(conversationKey);
  }
}
