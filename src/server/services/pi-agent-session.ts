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
  projectId?: string;
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
  projectId?: string;
  pending: PiQueuedMessage[];
  history: PiQueuedMessage[];
  run?: PiPersistedRun;
  updatedAt: string;
}

export type PiRunStatus = 'running' | 'cancelling' | 'completed' | 'cancelled' | 'error' | 'interrupted';

export interface PiRunEvent {
  sequence: number;
  type: 'status' | 'chunk' | 'thinking' | 'complete' | 'error';
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface PiPersistedRun {
  runId: string;
  provider: string;
  startedAt: string;
  updatedAt: string;
  status: PiRunStatus;
  cancellationRequestedAt?: string;
  completedAt?: string;
  error?: string;
  lastEventSequence: number;
  events: PiRunEvent[];
}

interface PiActiveRun {
  userId: string;
  conversationId: string;
  runId: string;
  provider: string;
  startedAt: string;
  projectId?: string;
  cancellationRequestedAt?: string;
  abortController: AbortController;
}

export interface PiSessionPublicState {
  version: 1;
  userId: string;
  conversationId: string;
  projectId?: string;
  running: boolean;
  runId?: string;
  provider?: string;
  startedAt?: string;
  cancellationRequested?: boolean;
  cancellationRequestedAt?: string;
  runStatus?: PiRunStatus;
  completedAt?: string;
  runError?: string;
  lastEventSequence: number;
  runEvents: PiRunEvent[];
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
const MAX_RUN_EVENTS = 600;
const MAX_RUN_EVENT_PAYLOAD_CHARS = 1_500_000;
const RUN_CHUNK_SAVE_DEBOUNCE_MS = 250;

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

function cloneRunEvent(event: PiRunEvent): PiRunEvent {
  return JSON.parse(JSON.stringify(event)) as PiRunEvent;
}

function sanitizeRunPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
    if (typeof raw === 'string') output[key] = raw.slice(0, MAX_RUN_EVENT_PAYLOAD_CHARS);
    else if (typeof raw === 'number' && Number.isFinite(raw)) output[key] = raw;
    else if (typeof raw === 'boolean') output[key] = raw;
    else if (raw === null) output[key] = null;
  }
  return output;
}

function normalizePersistedRun(value: unknown): PiPersistedRun | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Partial<PiPersistedRun>;
  const runId = String(raw.runId || '').trim();
  if (!runId) return undefined;
  const allowedStatuses: PiRunStatus[] = [
    'running',
    'cancelling',
    'completed',
    'cancelled',
    'error',
    'interrupted',
  ];
  const status = allowedStatuses.includes(raw.status as PiRunStatus)
    ? raw.status as PiRunStatus
    : 'interrupted';
  const events = Array.isArray(raw.events)
    ? raw.events.slice(-MAX_RUN_EVENTS).map((event, index) => {
        const candidate = event && typeof event === 'object' && !Array.isArray(event)
          ? event as Partial<PiRunEvent>
          : {};
        const type = ['status', 'chunk', 'thinking', 'complete', 'error'].includes(String(candidate.type))
          ? candidate.type as PiRunEvent['type']
          : 'status';
        return {
          sequence: Number.isFinite(Number(candidate.sequence))
            ? Math.max(1, Math.floor(Number(candidate.sequence)))
            : index + 1,
          type,
          payload: sanitizeRunPayload(candidate.payload),
          createdAt: String(candidate.createdAt || nowIso()),
        };
      })
    : [];
  const lastEventSequence = Math.max(
    Number(raw.lastEventSequence || 0),
    events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0),
  );
  return {
    runId,
    provider: String(raw.provider || 'auto'),
    startedAt: String(raw.startedAt || nowIso()),
    updatedAt: String(raw.updatedAt || nowIso()),
    status,
    cancellationRequestedAt: raw.cancellationRequestedAt
      ? String(raw.cancellationRequestedAt)
      : undefined,
    completedAt: raw.completedAt ? String(raw.completedAt) : undefined,
    error: raw.error ? String(raw.error).slice(0, 4000) : undefined,
    lastEventSequence,
    events,
  };
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
  private readonly pendingSaveTimers = new Map<string, NodeJS.Timeout>();

  private getKey(userId: string, conversationId: string, projectId = ''): string {
    return `${userId}\u0001${projectId || 'current-workspace'}\u0001${conversationId}`;
  }

  private getSessionPath(userId: string, conversationId: string, projectId = ''): string {
    const base = path.join(getDataDir(), 'pi-agent-sessions');
    return projectId
      ? path.join(base, 'projects', safeSegment(projectId, 'project'), safeSegment(userId, 'web-user'), `${safeSegment(conversationId, 'conversation')}.json`)
      : path.join(base, safeSegment(userId, 'web-user'), `${safeSegment(conversationId, 'conversation')}.json`);
  }

  private createSession(userId: string, conversationId: string, projectId = ''): PiPersistedSession {
    return {
      version: 1,
      userId,
      conversationId,
      projectId: projectId || undefined,
      pending: [],
      history: [],
      updatedAt: nowIso(),
    };
  }

  private load(userId: string, conversationId: string, projectId = ''): PiPersistedSession {
    const key = this.getKey(userId, conversationId, projectId);
    const cached = this.sessions.get(key);
    if (cached) return cached;
    const filePath = this.getSessionPath(userId, conversationId, projectId);
    let session = this.createSession(userId, conversationId, projectId);
    let recoveredProcessingClaim = false;
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<PiPersistedSession>;
        session = {
          version: 1,
          userId,
          conversationId,
          projectId: projectId || String(parsed.projectId || '').trim() || undefined,
          pending: Array.isArray(parsed.pending) ? parsed.pending.slice(0, MAX_PENDING_MESSAGES) : [],
          history: Array.isArray(parsed.history) ? parsed.history.slice(-MAX_HISTORY_MESSAGES) : [],
          run: normalizePersistedRun(parsed.run),
          updatedAt: String(parsed.updatedAt || nowIso()),
        };
        // Runtime AbortControllers cannot survive a local-server restart. Keep
        // the journal for diagnosis/replay, but never advertise a ghost run as
        // active after the process has restarted.
        if (session.run?.status === 'running' || session.run?.status === 'cancelling') {
          session.run.status = 'interrupted';
          session.run.completedAt = nowIso();
          session.run.updatedAt = session.run.completedAt;
          session.run.error = 'Local service restarted before the Agent run settled';
          recoveredProcessingClaim = true;
        }
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
      session = this.createSession(userId, conversationId, projectId);
    }
    this.sessions.set(key, session);
    if (recoveredProcessingClaim) this.save(session);
    return session;
  }

  private save(session: PiPersistedSession): void {
    const key = this.getKey(session.userId, session.conversationId, session.projectId);
    const pendingTimer = this.pendingSaveTimers.get(key);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.pendingSaveTimers.delete(key);
    }
    session.updatedAt = nowIso();
    const filePath = this.getSessionPath(session.userId, session.conversationId, session.projectId);
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

  private scheduleSave(session: PiPersistedSession): void {
    const key = this.getKey(session.userId, session.conversationId, session.projectId);
    if (this.pendingSaveTimers.has(key)) return;
    const timer = setTimeout(() => {
      this.pendingSaveTimers.delete(key);
      this.save(session);
    }, RUN_CHUNK_SAVE_DEBOUNCE_MS);
    timer.unref?.();
    this.pendingSaveTimers.set(key, timer);
  }

  private recoverExpiredContinuationClaims(session: PiPersistedSession): void {
    if (this.activeRuns.has(this.getKey(session.userId, session.conversationId, session.projectId))) return;
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

  getState(userId: string, conversationId: string, projectId = ''): PiSessionPublicState {
    const session = this.load(userId, conversationId, projectId);
    this.recoverExpiredContinuationClaims(session);
    const active = this.activeRuns.get(this.getKey(userId, conversationId, projectId));
    const pending = session.pending.filter(item => item.status === 'queued' || item.status === 'processing');
    const steeringCount = pending.filter(item => item.behavior === 'steer').length;
    const followUpCount = pending.filter(item => item.behavior === 'follow_up').length;
    return {
      version: 1,
      userId,
      conversationId,
      projectId: projectId || undefined,
      running: Boolean(active),
      runId: active?.runId || session.run?.runId,
      provider: active?.provider || session.run?.provider,
      startedAt: active?.startedAt || session.run?.startedAt,
      cancellationRequested: Boolean(
        active?.cancellationRequestedAt || session.run?.cancellationRequestedAt
      ),
      cancellationRequestedAt:
        active?.cancellationRequestedAt || session.run?.cancellationRequestedAt,
      runStatus: active
        ? (active.cancellationRequestedAt ? 'cancelling' : 'running')
        : session.run?.status,
      completedAt: session.run?.completedAt,
      runError: session.run?.error,
      lastEventSequence: session.run?.lastEventSequence || 0,
      runEvents: (session.run?.events || []).map(cloneRunEvent),
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

  beginRun(userId: string, conversationId: string, provider = 'auto', projectId = ''): { accepted: boolean; runId: string; state: PiSessionPublicState } {
    const key = this.getKey(userId, conversationId, projectId);
    const existing = this.activeRuns.get(key);
    if (existing) {
      return { accepted: false, runId: existing.runId, state: this.getState(userId, conversationId, projectId) };
    }
    const active: PiActiveRun = {
      userId,
      conversationId,
      runId: `pi_run_${randomUUID()}`,
      provider: String(provider || 'auto'),
      startedAt: nowIso(),
      projectId: projectId || undefined,
      abortController: new AbortController(),
    };
    this.activeRuns.set(key, active);
    const session = this.load(userId, conversationId, projectId);
    session.run = {
      runId: active.runId,
      provider: active.provider,
      startedAt: active.startedAt,
      updatedAt: active.startedAt,
      status: 'running',
      lastEventSequence: 0,
      events: [],
    };
    this.save(session);
    return { accepted: true, runId: active.runId, state: this.getState(userId, conversationId, projectId) };
  }

  listActiveStates(userId?: string): PiSessionPublicState[] {
    const states: PiSessionPublicState[] = [];
    for (const active of this.activeRuns.values()) {
      if (userId && active.userId !== userId) continue;
      states.push(this.getState(active.userId, active.conversationId, active.projectId));
    }
    return states.sort((left, right) => String(left.startedAt || '').localeCompare(String(right.startedAt || '')));
  }

  appendRunEvent(
    userId: string,
    conversationId: string,
    runId: string,
    type: PiRunEvent['type'],
    payload: Record<string, unknown>,
    projectId = '',
  ): PiRunEvent | null {
    const session = this.load(userId, conversationId, projectId);
    if (!session.run || session.run.runId !== runId) return null;
    const event: PiRunEvent = {
      sequence: session.run.lastEventSequence + 1,
      type,
      payload: sanitizeRunPayload(payload),
      createdAt: nowIso(),
    };
    session.run.lastEventSequence = event.sequence;
    session.run.updatedAt = event.createdAt;
    session.run.events.push(event);
    if (session.run.events.length > MAX_RUN_EVENTS) {
      session.run.events.splice(0, session.run.events.length - MAX_RUN_EVENTS);
    }
    let payloadChars = session.run.events.reduce((total, item) => {
      try {
        return total + JSON.stringify(item.payload).length;
      } catch {
        return total;
      }
    }, 0);
    while (session.run.events.length > 1 && payloadChars > MAX_RUN_EVENT_PAYLOAD_CHARS) {
      const removed = session.run.events.shift();
      try {
        payloadChars -= removed ? JSON.stringify(removed.payload).length : 0;
      } catch {
        // The remaining bounded event list is still safe to persist.
      }
    }
    if (type === 'chunk') this.scheduleSave(session);
    else this.save(session);
    return cloneRunEvent(event);
  }

  completeRun(
    userId: string,
    conversationId: string,
    runId: string,
    outcome: { status: 'completed' | 'cancelled' | 'error'; error?: string },
    projectId = '',
  ): PiSessionPublicState {
    const session = this.load(userId, conversationId, projectId);
    if (session.run?.runId === runId) {
      session.run.status = outcome.status;
      session.run.error = outcome.error ? String(outcome.error).slice(0, 4000) : undefined;
      session.run.completedAt = nowIso();
      session.run.updatedAt = session.run.completedAt;
      this.save(session);
    }
    return this.getState(userId, conversationId, projectId);
  }

  settleRun(userId: string, conversationId: string, runId: string, projectId = ''): PiSessionPublicState {
    const key = this.getKey(userId, conversationId, projectId);
    const active = this.activeRuns.get(key);
    if (active?.runId === runId) this.activeRuns.delete(key);
    const session = this.load(userId, conversationId, projectId);
    let changed = false;
    if (session.run?.runId === runId) {
      if (session.run.status === 'running') {
        session.run.status = 'completed';
      } else if (session.run.status === 'cancelling') {
        session.run.status = 'cancelled';
      }
      if (!session.run.completedAt) {
        session.run.completedAt = nowIso();
      }
      session.run.updatedAt = nowIso();
      changed = true;
    }
    // A cancelled run can settle after the next run has already started.
    // Never requeue processing messages owned by that newer active run.
    if (!this.activeRuns.has(key)) {
      session.pending.forEach(item => {
        if (item.status === 'processing') {
          item.status = 'queued';
          item.updatedAt = nowIso();
          delete item.claimedAt;
          changed = true;
        }
      });
    }
    if (changed) this.save(session);
    return this.getState(userId, conversationId, projectId);
  }

  requestRunCancellation(
    userId: string,
    conversationId: string,
    expectedRunId?: string,
    projectId = '',
  ): { requested: boolean; runId?: string; state: PiSessionPublicState } {
    const active = this.activeRuns.get(this.getKey(userId, conversationId, projectId));
    if (!active || (expectedRunId && active.runId !== expectedRunId)) {
      return {
        requested: false,
        runId: active?.runId,
        state: this.getState(userId, conversationId, projectId),
      };
    }
    active.cancellationRequestedAt = active.cancellationRequestedAt || nowIso();
    const session = this.load(userId, conversationId, projectId);
    if (session.run?.runId === active.runId) {
      session.run.status = 'cancelling';
      session.run.cancellationRequestedAt = active.cancellationRequestedAt;
      session.run.updatedAt = active.cancellationRequestedAt;
      this.save(session);
    }
    if (!active.abortController.signal.aborted) {
      active.abortController.abort(new Error('Pi Agent run cancelled by user'));
    }
    return {
      requested: true,
      runId: active.runId,
      state: this.getState(userId, conversationId, projectId),
    };
  }

  getRunAbortSignal(userId: string, conversationId: string, runId: string, projectId = ''): AbortSignal | undefined {
    const active = this.activeRuns.get(this.getKey(userId, conversationId, projectId));
    return active?.runId === runId ? active.abortController.signal : undefined;
  }

  isRunCancellationRequested(userId: string, conversationId: string, runId: string, projectId = ''): boolean {
    const active = this.activeRuns.get(this.getKey(userId, conversationId, projectId));
    return active?.runId === runId
      && (Boolean(active.cancellationRequestedAt) || active.abortController.signal.aborted);
  }

  enqueue(input: {
    userId: string;
    conversationId: string;
    projectId?: string;
    message: string;
    behavior: PiQueueBehavior;
    clientMessageId?: string;
    chatAttachments?: unknown;
    workspaceFileMentions?: unknown;
  }): PiQueuedMessage {
    const session = this.load(input.userId, input.conversationId, input.projectId);
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
      projectId: input.projectId || undefined,
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
  }, projectId = ''): PiQueuedMessage | null {
    const session = this.load(userId, conversationId, projectId);
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

  cancelMessage(userId: string, conversationId: string, messageId: string, projectId = ''): PiQueuedMessage | null {
    const session = this.load(userId, conversationId, projectId);
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

  claimNextForContinuation(userId: string, conversationId: string, projectId = ''): PiQueuedMessage | null {
    if (this.activeRuns.has(this.getKey(userId, conversationId, projectId))) return null;
    const session = this.load(userId, conversationId, projectId);
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
    projectId = '',
  ): PiQueuedMessage | null {
    const session = this.load(userId, conversationId, projectId);
    this.recoverExpiredContinuationClaims(session);
    const item = session.pending.find(candidate => candidate.id === messageId && candidate.status === 'processing');
    const normalizedMessage = String(message || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!item || item.message !== normalizedMessage) return null;
    return cloneMessage(item);
  }

  takeSteeringMessages(userId: string, conversationId: string, options?: { allowAttachments?: boolean }, projectId = ''): PiQueuedMessage[] {
    if (!this.activeRuns.has(this.getKey(userId, conversationId, projectId))) return [];
    const session = this.load(userId, conversationId, projectId);
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

  markApplied(userId: string, conversationId: string, messageId: string, completionMode: 'steered' | 'continued', projectId = ''): PiQueuedMessage | null {
    const session = this.load(userId, conversationId, projectId);
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

  requeueMessage(userId: string, conversationId: string, messageId: string, projectId = ''): PiQueuedMessage | null {
    const session = this.load(userId, conversationId, projectId);
    const item = session.pending.find(candidate => candidate.id === messageId);
    if (!item || item.status !== 'processing') return null;
    item.status = 'queued';
    item.updatedAt = nowIso();
    delete item.claimedAt;
    this.save(session);
    return cloneMessage(item);
  }

  clear(userId: string, conversationId: string, projectId = ''): void {
    const key = this.getKey(userId, conversationId, projectId);
    this.sessions.delete(key);
    this.activeRuns.delete(key);
    const filePath = this.getSessionPath(userId, conversationId, projectId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

export const piAgentSessionManager = new PiAgentSessionManager();
