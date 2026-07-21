import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { logger } from '../../utils/logger';
import { getDataDir } from '../../utils/paths';

export type PiQueueBehavior = 'steer' | 'follow_up';
export type PiQueueMessageStatus = 'queued' | 'processing' | 'applied' | 'cancelled';

export interface PiQueueAttachment {
  name?: string;
  path?: string;
  type?: string;
  size?: number;
  previewUrl?: string;
  originalName?: string;
  originalPath?: string;
  lastModified?: number;
  inputSource?: string;
  [key: string]: unknown;
}

export interface PiQueueWorkspaceFile {
  name?: string;
  path?: string;
  kind?: string;
  size?: number;
  [key: string]: unknown;
}

export interface PiQueuedMessage {
  id: string;
  userId: string;
  conversationId: string;
  message: string;
  behavior: PiQueueBehavior;
  status: PiQueueMessageStatus;
  chatAttachments: PiQueueAttachment[];
  workspaceFileMentions: PiQueueWorkspaceFile[];
  createdAt: string;
  updatedAt: string;
  claimedAt?: string;
  appliedAt?: string;
  cancelledAt?: string;
  completionMode?: 'steered' | 'continued';
}

interface PiPersistedSession {
  version: 1;
  userId: string;
  conversationId: string;
  pending: PiQueuedMessage[];
  history: PiQueuedMessage[];
  updatedAt: string;
}

interface PiActiveRun {
  runId: string;
  provider: string;
  startedAt: string;
  cancellationRequestedAt?: string;
}

export interface PiSessionPublicState {
  version: 1;
  userId: string;
  conversationId: string;
  running: boolean;
  runId?: string;
  provider?: string;
  startedAt?: string;
  cancellationRequested?: boolean;
  cancellationRequestedAt?: string;
  pending: PiQueuedMessage[];
  recent: PiQueuedMessage[];
  steeringCount: number;
  followUpCount: number;
  pendingMessageCount: number;
  steeringMode: 'one-at-a-time';
  followUpMode: 'one-at-a-time';
  updatedAt: string;
}

const MAX_PENDING_MESSAGES = 100;
const MAX_HISTORY_MESSAGES = 80;
const MAX_MESSAGE_LENGTH = 20_000;
const CONTINUATION_CLAIM_LEASE_MS = 120_000;

function nowIso(): string {
  return new Date().toISOString();
}

function safeSegment(value: string, fallback: string): string {
  const raw = String(value || '').trim();
  const readable = raw
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 72) || fallback;
  const digest = createHash('sha256').update(raw || fallback).digest('hex').slice(0, 12);
  return `${readable}-${digest}`;
}

function cloneMessage(message: PiQueuedMessage): PiQueuedMessage {
  return JSON.parse(JSON.stringify(message)) as PiQueuedMessage;
}

function sanitizeRecordList<T extends Record<string, unknown>>(value: unknown, maxItems: number): T[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return {} as T;
    const output: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(item as Record<string, unknown>).slice(0, 40)) {
      if (typeof raw === 'string') output[key] = raw.slice(0, 2400);
      else if (typeof raw === 'number' && Number.isFinite(raw)) output[key] = raw;
      else if (typeof raw === 'boolean') output[key] = raw;
      else if (raw && typeof raw === 'object') {
        try {
          output[key] = JSON.parse(JSON.stringify(raw));
        } catch {
          // Ignore unserializable attachment metadata.
        }
      }
    }
    return output as T;
  });
}

export class PiAgentSessionManager {
  private readonly sessions = new Map<string, PiPersistedSession>();
  private readonly activeRuns = new Map<string, PiActiveRun>();

  private getKey(userId: string, conversationId: string): string {
    return `${userId}\u0001${conversationId}`;
  }

  private getSessionPath(userId: string, conversationId: string): string {
    return path.join(
      getDataDir(),
      'pi-agent-sessions',
      safeSegment(userId, 'web-user'),
      `${safeSegment(conversationId, 'conversation')}.json`,
    );
  }

  private createSession(userId: string, conversationId: string): PiPersistedSession {
    return {
      version: 1,
      userId,
      conversationId,
      pending: [],
      history: [],
      updatedAt: nowIso(),
    };
  }

  private load(userId: string, conversationId: string): PiPersistedSession {
    const key = this.getKey(userId, conversationId);
    const cached = this.sessions.get(key);
    if (cached) return cached;
    const filePath = this.getSessionPath(userId, conversationId);
    let session = this.createSession(userId, conversationId);
    let recoveredProcessingClaim = false;
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<PiPersistedSession>;
        session = {
          version: 1,
          userId,
          conversationId,
          pending: Array.isArray(parsed.pending) ? parsed.pending.slice(0, MAX_PENDING_MESSAGES) : [],
          history: Array.isArray(parsed.history) ? parsed.history.slice(-MAX_HISTORY_MESSAGES) : [],
          updatedAt: String(parsed.updatedAt || nowIso()),
        };
        // A process restart cannot preserve an in-flight claim. Put it back in
        // the queue so a user instruction is never lost after closing the app.
        session.pending.forEach(item => {
          if (item.status === 'processing') {
            item.status = 'queued';
            delete item.claimedAt;
            item.updatedAt = nowIso();
            recoveredProcessingClaim = true;
          }
        });
      }
    } catch (error) {
      logger.warn('[PiSession] Failed to load persisted queue; starting with an empty queue:', error);
      session = this.createSession(userId, conversationId);
    }
    this.sessions.set(key, session);
    if (recoveredProcessingClaim) this.save(session);
    return session;
  }

  private save(session: PiPersistedSession): void {
    session.updatedAt = nowIso();
    const filePath = this.getSessionPath(session.userId, session.conversationId);
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(session, null, 2), 'utf-8');
    try {
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      fs.renameSync(temporaryPath, filePath);
      logger.debug('[PiSession] Replaced queue state after atomic rename fallback', error);
    }
  }

  private recoverExpiredContinuationClaims(session: PiPersistedSession): void {
    if (this.activeRuns.has(this.getKey(session.userId, session.conversationId))) return;
    const cutoff = Date.now() - CONTINUATION_CLAIM_LEASE_MS;
    let changed = false;
    session.pending.forEach(item => {
      if (item.status !== 'processing') return;
      const claimedAt = item.claimedAt ? Date.parse(item.claimedAt) : Number.NaN;
      if (Number.isFinite(claimedAt) && claimedAt > cutoff) return;
      item.status = 'queued';
      item.updatedAt = nowIso();
      delete item.claimedAt;
      changed = true;
    });
    if (changed) this.save(session);
  }

  getState(userId: string, conversationId: string): PiSessionPublicState {
    const session = this.load(userId, conversationId);
    this.recoverExpiredContinuationClaims(session);
    const active = this.activeRuns.get(this.getKey(userId, conversationId));
    const pending = session.pending.filter(item => item.status === 'queued' || item.status === 'processing');
    const steeringCount = pending.filter(item => item.behavior === 'steer').length;
    const followUpCount = pending.filter(item => item.behavior === 'follow_up').length;
    return {
      version: 1,
      userId,
      conversationId,
      running: Boolean(active),
      runId: active?.runId,
      provider: active?.provider,
      startedAt: active?.startedAt,
      cancellationRequested: Boolean(active?.cancellationRequestedAt),
      cancellationRequestedAt: active?.cancellationRequestedAt,
      pending: pending.map(cloneMessage),
      recent: session.history.slice(-20).map(cloneMessage),
      steeringCount,
      followUpCount,
      pendingMessageCount: pending.length,
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
      updatedAt: session.updatedAt,
    };
  }

  beginRun(userId: string, conversationId: string, provider = 'auto'): { accepted: boolean; runId: string; state: PiSessionPublicState } {
    const key = this.getKey(userId, conversationId);
    const existing = this.activeRuns.get(key);
    if (existing) {
      return { accepted: false, runId: existing.runId, state: this.getState(userId, conversationId) };
    }
    const active: PiActiveRun = {
      runId: `pi_run_${randomUUID()}`,
      provider: String(provider || 'auto'),
      startedAt: nowIso(),
    };
    this.activeRuns.set(key, active);
    return { accepted: true, runId: active.runId, state: this.getState(userId, conversationId) };
  }

  settleRun(userId: string, conversationId: string, runId: string): PiSessionPublicState {
    const key = this.getKey(userId, conversationId);
    const active = this.activeRuns.get(key);
    if (active?.runId === runId) this.activeRuns.delete(key);
    const session = this.load(userId, conversationId);
    let changed = false;
    session.pending.forEach(item => {
      if (item.status === 'processing') {
        item.status = 'queued';
        item.updatedAt = nowIso();
        delete item.claimedAt;
        changed = true;
      }
    });
    if (changed) this.save(session);
    return this.getState(userId, conversationId);
  }

  requestRunCancellation(
    userId: string,
    conversationId: string,
    expectedRunId?: string,
  ): { requested: boolean; runId?: string; state: PiSessionPublicState } {
    const active = this.activeRuns.get(this.getKey(userId, conversationId));
    if (!active || (expectedRunId && active.runId !== expectedRunId)) {
      return {
        requested: false,
        runId: active?.runId,
        state: this.getState(userId, conversationId),
      };
    }
    active.cancellationRequestedAt = active.cancellationRequestedAt || nowIso();
    return {
      requested: true,
      runId: active.runId,
      state: this.getState(userId, conversationId),
    };
  }

  isRunCancellationRequested(userId: string, conversationId: string, runId: string): boolean {
    const active = this.activeRuns.get(this.getKey(userId, conversationId));
    return active?.runId === runId && Boolean(active.cancellationRequestedAt);
  }

  enqueue(input: {
    userId: string;
    conversationId: string;
    message: string;
    behavior: PiQueueBehavior;
    clientMessageId?: string;
    chatAttachments?: unknown;
    workspaceFileMentions?: unknown;
  }): PiQueuedMessage {
    const session = this.load(input.userId, input.conversationId);
    const requestedId = String(input.clientMessageId || '').trim();
    const safeRequestedId = /^pi_msg_[a-zA-Z0-9_-]{8,120}$/.test(requestedId) ? requestedId : '';
    if (safeRequestedId) {
      const existing = session.pending.find(item => item.id === safeRequestedId)
        || session.history.find(item => item.id === safeRequestedId);
      if (existing) return cloneMessage(existing);
    }
    if (session.pending.filter(item => item.status === 'queued' || item.status === 'processing').length >= MAX_PENDING_MESSAGES) {
      throw new Error(`Pi 会话队列已达到 ${MAX_PENDING_MESSAGES} 条上限`);
    }
    const text = String(input.message || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!text) throw new Error('排队消息不能为空');
    const timestamp = nowIso();
    const item: PiQueuedMessage = {
      id: safeRequestedId || `pi_msg_${randomUUID()}`,
      userId: input.userId,
      conversationId: input.conversationId,
      message: text,
      behavior: input.behavior === 'steer' ? 'steer' : 'follow_up',
      status: 'queued',
      chatAttachments: sanitizeRecordList<PiQueueAttachment>(input.chatAttachments, 12),
      workspaceFileMentions: sanitizeRecordList<PiQueueWorkspaceFile>(input.workspaceFileMentions, 30),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    session.pending.push(item);
    this.save(session);
    return cloneMessage(item);
  }

  updateMessage(userId: string, conversationId: string, messageId: string, input: {
    message?: string;
    behavior?: PiQueueBehavior;
  }): PiQueuedMessage | null {
    const session = this.load(userId, conversationId);
    const item = session.pending.find(candidate => candidate.id === messageId);
    if (!item || item.status !== 'queued') return null;
    if (input.message !== undefined) {
      const text = String(input.message || '').trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!text) throw new Error('排队消息不能为空');
      item.message = text;
    }
    if (input.behavior) item.behavior = input.behavior === 'steer' ? 'steer' : 'follow_up';
    item.updatedAt = nowIso();
    this.save(session);
    return cloneMessage(item);
  }

  cancelMessage(userId: string, conversationId: string, messageId: string): PiQueuedMessage | null {
    const session = this.load(userId, conversationId);
    const index = session.pending.findIndex(candidate => candidate.id === messageId);
    if (index < 0 || session.pending[index].status !== 'queued') return null;
    const [item] = session.pending.splice(index, 1);
    item.status = 'cancelled';
    item.cancelledAt = nowIso();
    item.updatedAt = item.cancelledAt;
    session.history.push(item);
    session.history = session.history.slice(-MAX_HISTORY_MESSAGES);
    this.save(session);
    return cloneMessage(item);
  }

  claimNextForContinuation(userId: string, conversationId: string): PiQueuedMessage | null {
    if (this.activeRuns.has(this.getKey(userId, conversationId))) return null;
    const session = this.load(userId, conversationId);
    this.recoverExpiredContinuationClaims(session);
    const item = session.pending.find(candidate => candidate.status === 'queued' && candidate.behavior === 'steer')
      || session.pending.find(candidate => candidate.status === 'queued' && candidate.behavior === 'follow_up');
    if (!item) return null;
    item.status = 'processing';
    item.claimedAt = nowIso();
    item.updatedAt = item.claimedAt;
    this.save(session);
    return cloneMessage(item);
  }

  validateContinuationClaim(
    userId: string,
    conversationId: string,
    messageId: string,
    message: string,
  ): PiQueuedMessage | null {
    const session = this.load(userId, conversationId);
    this.recoverExpiredContinuationClaims(session);
    const item = session.pending.find(candidate => candidate.id === messageId && candidate.status === 'processing');
    const normalizedMessage = String(message || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!item || item.message !== normalizedMessage) return null;
    return cloneMessage(item);
  }

  takeSteeringMessages(userId: string, conversationId: string, options?: { allowAttachments?: boolean }): PiQueuedMessage[] {
    if (!this.activeRuns.has(this.getKey(userId, conversationId))) return [];
    const session = this.load(userId, conversationId);
    const item = session.pending.find(candidate => {
      if (candidate.status !== 'queued' || candidate.behavior !== 'steer') return false;
      if (options?.allowAttachments === false && candidate.chatAttachments.length > 0) return false;
      return true;
    });
    if (!item) return [];
    item.status = 'processing';
    item.claimedAt = nowIso();
    item.updatedAt = item.claimedAt;
    this.save(session);
    return [cloneMessage(item)];
  }

  markApplied(userId: string, conversationId: string, messageId: string, completionMode: 'steered' | 'continued'): PiQueuedMessage | null {
    const session = this.load(userId, conversationId);
    const index = session.pending.findIndex(candidate => candidate.id === messageId);
    if (index < 0 || session.pending[index].status !== 'processing') return null;
    const [item] = session.pending.splice(index, 1);
    item.status = 'applied';
    item.completionMode = completionMode;
    item.appliedAt = nowIso();
    item.updatedAt = item.appliedAt;
    session.history.push(item);
    session.history = session.history.slice(-MAX_HISTORY_MESSAGES);
    this.save(session);
    return cloneMessage(item);
  }

  requeueMessage(userId: string, conversationId: string, messageId: string): PiQueuedMessage | null {
    const session = this.load(userId, conversationId);
    const item = session.pending.find(candidate => candidate.id === messageId);
    if (!item || item.status !== 'processing') return null;
    item.status = 'queued';
    item.updatedAt = nowIso();
    delete item.claimedAt;
    this.save(session);
    return cloneMessage(item);
  }

  clear(userId: string, conversationId: string): void {
    const key = this.getKey(userId, conversationId);
    this.sessions.delete(key);
    this.activeRuns.delete(key);
    const filePath = this.getSessionPath(userId, conversationId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

export const piAgentSessionManager = new PiAgentSessionManager();
