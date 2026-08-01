import { logger } from '../../utils/logger';
import {
  piAgentSessionManager,
  type PiRunEvent,
  type PiRunStatus,
  type PiSessionPublicState,
} from './pi-agent-session';

export interface AgentRunIdentity {
  userId: string;
  conversationId: string;
  runId: string;
}

export interface BeginAgentRunResult {
  accepted: boolean;
  runId: string;
  state: PiSessionPublicState;
}

export interface AgentExecutionKernelOptions {
  label: string;
  cancellationErrorName: string;
}

/**
 * Shared lifecycle kernel for every chat-shaped Agent entry.
 *
 * The HTTP renderer is only a transport. Losing it never cancels the backend
 * run; explicit interrupt requests are the sole cancellation authority.
 * Events and terminal state are persisted by PiAgentSessionManager so any page
 * can reattach to the same conversation after navigation or renderer recovery.
 */
export class AgentExecutionKernel {
  private identityValue: AgentRunIdentity | null = null;
  private transportDetachedValue = false;
  private outcomeRecordedValue = false;
  private settledValue = false;

  constructor(private readonly options: AgentExecutionKernelOptions) {}

  get identity(): AgentRunIdentity | null {
    return this.identityValue;
  }

  get transportDetached(): boolean {
    return this.transportDetachedValue;
  }

  get outcomeRecorded(): boolean {
    return this.outcomeRecordedValue;
  }

  begin(userId: string, conversationId: string, provider = 'auto'): BeginAgentRunResult {
    const result = piAgentSessionManager.beginRun(userId, conversationId, provider);
    if (result.accepted) {
      this.identityValue = { userId, conversationId, runId: result.runId };
      logger.info(`[${this.options.label}] Agent run started`, {
        userId,
        conversationId,
        runId: result.runId,
        provider,
      });
    }
    return result;
  }

  detachTransport(reason = 'client-transport-closed'): void {
    this.transportDetachedValue = true;
    logger.info(`[${this.options.label}] Client transport detached; Agent run continues for renderer recovery`, {
      conversationId: this.identityValue?.conversationId,
      runId: this.identityValue?.runId,
      reason,
    });
  }

  isCancelled(): boolean {
    if (!this.identityValue) return false;
    return piAgentSessionManager.isRunCancellationRequested(
      this.identityValue.userId,
      this.identityValue.conversationId,
      this.identityValue.runId,
    );
  }

  assertActive(message = 'Agent request was cancelled by the user'): void {
    if (!this.isCancelled()) return;
    const error = new Error(message);
    error.name = this.options.cancellationErrorName;
    throw error;
  }

  appendEvent(type: PiRunEvent['type'], payload: Record<string, unknown>): void {
    if (!this.identityValue) return;
    piAgentSessionManager.appendRunEvent(
      this.identityValue.userId,
      this.identityValue.conversationId,
      this.identityValue.runId,
      type,
      payload,
    );
  }

  getAbortSignal(): AbortSignal | undefined {
    if (!this.identityValue) return undefined;
    return piAgentSessionManager.getRunAbortSignal(
      this.identityValue.userId,
      this.identityValue.conversationId,
      this.identityValue.runId,
    );
  }

  async requestCancellation(
    reason: string,
    interrupt?: (userId: string, conversationId: string) => Promise<void>,
  ): Promise<void> {
    if (!this.identityValue) return;
    const request = piAgentSessionManager.requestRunCancellation(
      this.identityValue.userId,
      this.identityValue.conversationId,
      this.identityValue.runId,
    );
    logger.info(`[${this.options.label}] Explicit Agent cancellation requested`, {
      conversationId: this.identityValue.conversationId,
      runId: this.identityValue.runId,
      reason,
      requested: request.requested,
    });
    if (interrupt) {
      await interrupt(this.identityValue.userId, this.identityValue.conversationId).catch(error => {
        logger.warn(`[${this.options.label}] Provider interruption failed`, error);
      });
    }
  }

  complete(
    status: Extract<PiRunStatus, 'completed' | 'cancelled' | 'error'>,
    options: { error?: string; event?: Record<string, unknown> } = {},
  ): void {
    if (!this.identityValue || this.outcomeRecordedValue) return;
    if (options.event) {
      this.appendEvent(status === 'completed' ? 'complete' : 'error', options.event);
    }
    piAgentSessionManager.completeRun(
      this.identityValue.userId,
      this.identityValue.conversationId,
      this.identityValue.runId,
      { status, error: options.error },
    );
    this.outcomeRecordedValue = true;
  }

  settle(): PiSessionPublicState | null {
    if (!this.identityValue || this.settledValue) return null;
    this.settledValue = true;
    const state = piAgentSessionManager.settleRun(
      this.identityValue.userId,
      this.identityValue.conversationId,
      this.identityValue.runId,
    );
    logger.info(`[${this.options.label}] Agent run settled`, {
      conversationId: this.identityValue.conversationId,
      pending: state.pendingMessageCount,
    });
    return state;
  }
}
