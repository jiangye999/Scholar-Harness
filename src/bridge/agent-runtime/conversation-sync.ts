import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { getDataDir } from '../../utils/paths';
import { logger } from '../../utils/logger';

export interface AgentVisibleMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ConversationSyncEntry {
  fingerprints: string[];
  contextFingerprints?: Record<string, string>;
  updatedAt: string;
}

type ConversationSyncState = Record<string, ConversationSyncEntry>;

const MAX_SYNC_FINGERPRINTS = 64;
const FINGERPRINT_HEAD_CHARS = 512;
const FINGERPRINT_TAIL_CHARS = 256;

function normalizeMessages(messages: AgentVisibleMessage[]): AgentVisibleMessage[] {
  return (Array.isArray(messages) ? messages : [])
    .map(message => ({
      role: message?.role === 'assistant' || message?.role === 'system' ? message.role : 'user',
      content: String(message?.content || '').trim(),
    } as AgentVisibleMessage))
    .filter(message => message.content);
}

function fingerprintMessage(message: AgentVisibleMessage): string {
  // The canonical session log may budget a long message by preserving its
  // head and tail. Fingerprint the same stable edges so a compacted copy is
  // still recognized as a message the native Agent has already consumed.
  const content = message.content.length > FINGERPRINT_HEAD_CHARS + FINGERPRINT_TAIL_CHARS
    ? `${message.content.slice(0, FINGERPRINT_HEAD_CHARS)}\u0001${message.content.slice(-FINGERPRINT_TAIL_CHARS)}`
    : message.content;
  return createHash('sha256')
    .update(`${message.role}\u0000${content}`)
    .digest('hex');
}

function fingerprintContextValue(value: string): string {
  return createHash('sha256').update(String(value || '').trim()).digest('hex');
}

function findSequenceOverlap(previous: string[], current: string[]): number {
  const upperBound = Math.min(previous.length, current.length);
  for (let size = upperBound; size > 0; size -= 1) {
    let matches = true;
    for (let index = 0; index < size; index += 1) {
      if (previous[previous.length - size + index] !== current[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return size;
  }
  return 0;
}

/**
 * Tracks which visible Scholar Harness messages have already been synchronized
 * into each native coding-agent session. Only hashes are persisted; chat text
 * remains in the canonical conversation/session log.
 */
export class AgentConversationSyncStore {
  private readonly filePath: string;
  private state: ConversationSyncState = {};

  constructor(filePath = path.join(getDataDir(), 'agent-runtimes', 'conversation-sync.json')) {
    this.filePath = path.resolve(filePath);
    this.load();
  }

  getDelta(sessionKey: string, messages: AgentVisibleMessage[]): AgentVisibleMessage[] {
    const normalized = normalizeMessages(messages);
    if (!normalized.length) return [];
    const currentFingerprints = normalized.map(fingerprintMessage);
    const previous = this.state[sessionKey]?.fingerprints || [];
    const overlap = findSequenceOverlap(previous, currentFingerprints);
    return normalized.slice(overlap);
  }

  getContextDelta(sessionKey: string, context: Record<string, string>): Record<string, string> {
    const previous = this.state[sessionKey]?.contextFingerprints || {};
    return Object.fromEntries(
      Object.entries(context || {})
        .map(([key, value]) => [String(key), String(value || '').trim()] as const)
        .filter(([, value]) => value)
        .filter(([key, value]) => previous[key] !== fingerprintContextValue(value)),
    );
  }

  acknowledge(
    sessionKey: string,
    messages: AgentVisibleMessage[],
    currentRequest = '',
    assistantAnswer = '',
    context?: Record<string, string>,
  ): void {
    const acknowledged = normalizeMessages([
      ...messages,
      ...(String(currentRequest || '').trim()
        ? [{ role: 'user' as const, content: String(currentRequest).trim() }]
        : []),
      ...(String(assistantAnswer || '').trim()
        ? [{ role: 'assistant' as const, content: String(assistantAnswer).trim() }]
        : []),
    ]);
    const previousContextFingerprints = this.state[sessionKey]?.contextFingerprints || {};
    const contextFingerprints = context === undefined
      ? previousContextFingerprints
      : Object.fromEntries(
          Object.entries(context)
            .map(([key, value]) => [String(key), String(value || '').trim()] as const)
            .filter(([, value]) => value)
            .map(([key, value]) => [key, fingerprintContextValue(value)]),
        );
    this.state[sessionKey] = {
      fingerprints: acknowledged
        .map(fingerprintMessage)
        .slice(-MAX_SYNC_FINGERPRINTS),
      contextFingerprints,
      updatedAt: new Date().toISOString(),
    };
    this.save();
  }

  clear(sessionKey: string): void {
    if (!this.state[sessionKey]) return;
    delete this.state[sessionKey];
    this.save();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as ConversationSyncState;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      this.state = Object.fromEntries(Object.entries(parsed).filter(([, entry]) => (
        !!entry
        && Array.isArray(entry.fingerprints)
        && entry.fingerprints.every(value => typeof value === 'string')
        && (
          entry.contextFingerprints === undefined
          || (
            !!entry.contextFingerprints
            && typeof entry.contextFingerprints === 'object'
            && !Array.isArray(entry.contextFingerprints)
            && Object.values(entry.contextFingerprints).every(value => typeof value === 'string')
          )
        )
      )));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`[AgentConversationSync] Failed to load sync state: ${(error as Error).message}`);
      }
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf-8');
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error) {
      logger.warn(`[AgentConversationSync] Failed to persist sync state: ${(error as Error).message}`);
    }
  }
}
