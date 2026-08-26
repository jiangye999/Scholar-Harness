import * as fs from 'fs';
import * as path from 'path';

import { sanitizeUserId } from '../../utils/paths';

export type WorkspaceDirectoryPreferencePermission =
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access';

export interface WorkspaceDirectoryPreference {
  enabled: boolean;
  path: string;
  permission: WorkspaceDirectoryPreferencePermission;
  aiWorkRoot: string;
  updatedAt: number;
}

interface WorkspaceDirectoryPreferenceScope {
  lastConversationId: string;
  directories: Record<string, WorkspaceDirectoryPreference>;
}

interface WorkspaceDirectoryPreferenceFile {
  version: 1;
  scopes: Record<string, WorkspaceDirectoryPreferenceScope>;
}

const MAX_SCOPES = 100;
const MAX_DIRECTORIES_PER_SCOPE = 500;

function normalizePermission(value: unknown): WorkspaceDirectoryPreferencePermission {
  const permission = String(value || '').trim();
  if (permission === 'workspace-write' || permission === 'danger-full-access') return permission;
  return 'read-only';
}

function normalizeId(value: unknown, fallback = ''): string {
  return String(value || fallback).trim().slice(0, 240);
}

function normalizePreference(value: unknown): WorkspaceDirectoryPreference {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    enabled: raw.enabled === true,
    path: String(raw.path || '').trim().slice(0, 8192),
    permission: normalizePermission(raw.permission),
    aiWorkRoot: String(raw.aiWorkRoot || raw.safeWorkRoot || '').trim().slice(0, 8192),
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

function emptyFile(): WorkspaceDirectoryPreferenceFile {
  return { version: 1, scopes: {} };
}

function normalizeFile(value: unknown): WorkspaceDirectoryPreferenceFile {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rawScopes = raw.scopes && typeof raw.scopes === 'object' && !Array.isArray(raw.scopes)
    ? raw.scopes as Record<string, unknown>
    : {};
  const scopes: Record<string, WorkspaceDirectoryPreferenceScope> = {};

  Object.entries(rawScopes).slice(0, MAX_SCOPES).forEach(([rawScopeId, rawScope]) => {
    const scopeId = normalizeId(rawScopeId);
    if (!scopeId || !rawScope || typeof rawScope !== 'object' || Array.isArray(rawScope)) return;
    const scopeRecord = rawScope as Record<string, unknown>;
    const rawDirectories = scopeRecord.directories
      && typeof scopeRecord.directories === 'object'
      && !Array.isArray(scopeRecord.directories)
      ? scopeRecord.directories as Record<string, unknown>
      : {};
    const directories: Record<string, WorkspaceDirectoryPreference> = {};
    Object.entries(rawDirectories)
      .map(([conversationId, setting]) => [normalizeId(conversationId), normalizePreference(setting)] as const)
      .filter(([conversationId]) => Boolean(conversationId))
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_DIRECTORIES_PER_SCOPE)
      .forEach(([conversationId, setting]) => {
        directories[conversationId] = setting;
      });
    scopes[scopeId] = {
      lastConversationId: normalizeId(scopeRecord.lastConversationId),
      directories,
    };
  });

  return { version: 1, scopes };
}

export class WorkspaceDirectoryPreferenceStore {
  constructor(private readonly dataDir: string) {}

  private getStorePath(userId: unknown): string {
    return path.join(
      this.dataDir,
      'workspace-directory-preferences',
      `${sanitizeUserId(String(userId || 'web-user'))}.json`,
    );
  }

  private read(userId: unknown): WorkspaceDirectoryPreferenceFile {
    const storePath = this.getStorePath(userId);
    try {
      if (!fs.existsSync(storePath)) return emptyFile();
      return normalizeFile(JSON.parse(fs.readFileSync(storePath, 'utf-8')));
    } catch {
      return emptyFile();
    }
  }

  private write(userId: unknown, value: WorkspaceDirectoryPreferenceFile): void {
    const storePath = this.getStorePath(userId);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const temporaryPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(normalizeFile(value), null, 2), 'utf-8');
    fs.renameSync(temporaryPath, storePath);
  }

  get(
    userId: unknown,
    projectId: unknown,
    conversationId: unknown,
  ): { setting: WorkspaceDirectoryPreference | null; inheritedFromConversationId: string } {
    const scopeId = normalizeId(projectId, 'current-workspace') || 'current-workspace';
    const requestedConversationId = normalizeId(conversationId);
    const scope = this.read(userId).scopes[scopeId];
    if (!scope) return { setting: null, inheritedFromConversationId: '' };

    if (requestedConversationId && scope.directories[requestedConversationId]) {
      return {
        setting: normalizePreference(scope.directories[requestedConversationId]),
        inheritedFromConversationId: '',
      };
    }
    const fallbackConversationId = scope.lastConversationId && scope.directories[scope.lastConversationId]
      ? scope.lastConversationId
      : Object.keys(scope.directories).sort((left, right) => (
          scope.directories[right].updatedAt - scope.directories[left].updatedAt
        ))[0] || '';
    return {
      setting: fallbackConversationId ? normalizePreference(scope.directories[fallbackConversationId]) : null,
      inheritedFromConversationId: fallbackConversationId,
    };
  }

  save(
    userId: unknown,
    projectId: unknown,
    conversationId: unknown,
    setting: unknown,
  ): WorkspaceDirectoryPreference {
    const scopeId = normalizeId(projectId, 'current-workspace') || 'current-workspace';
    const targetConversationId = normalizeId(conversationId);
    if (!targetConversationId) throw new Error('conversationId is required');

    const store = this.read(userId);
    const scope = store.scopes[scopeId] || { lastConversationId: '', directories: {} };
    const normalized = normalizePreference(setting);
    normalized.updatedAt = Math.max(Date.now(), normalized.updatedAt);
    scope.directories[targetConversationId] = normalized;
    scope.lastConversationId = targetConversationId;

    const compactDirectories: Record<string, WorkspaceDirectoryPreference> = {};
    Object.entries(scope.directories)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_DIRECTORIES_PER_SCOPE)
      .forEach(([id, value]) => {
        compactDirectories[id] = value;
      });
    scope.directories = compactDirectories;
    store.scopes[scopeId] = scope;
    this.write(userId, store);
    return normalized;
  }
}
