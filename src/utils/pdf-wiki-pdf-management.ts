import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger";
import { sanitizeUserId } from "./paths";

export interface PdfWikiPdfGroup {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface PdfWikiPdfManagementStore {
  version: 1;
  userId: string;
  groups: PdfWikiPdfGroup[];
  assignments: Record<string, string[]>;
  updatedAt: string;
}

function createEmptyStore(userId: string): PdfWikiPdfManagementStore {
  return {
    version: 1,
    userId,
    groups: [],
    assignments: {},
    updatedAt: new Date(0).toISOString(),
  };
}

function getManagementPath(dataDir: string, userId: string): string {
  return path.join(dataDir, "uploads", sanitizeUserId(userId), "pdf-wiki", "pdf-management.json");
}

function normalizeStore(raw: unknown, userId: string): PdfWikiPdfManagementStore {
  const data = raw && typeof raw === "object" ? raw as Partial<PdfWikiPdfManagementStore> : {};
  const now = new Date(0).toISOString();
  const seen = new Set<string>();
  const groups = (Array.isArray(data.groups) ? data.groups : [])
    .map(group => ({
      id: String(group.id || "").trim(),
      name: String(group.name || "").trim(),
      createdAt: typeof group.createdAt === "string" ? group.createdAt : now,
      updatedAt: typeof group.updatedAt === "string" ? group.updatedAt : now,
    }))
    .filter(group => group.id && group.name && !seen.has(group.id) && seen.add(group.id));
  const validGroupIds = new Set(groups.map(group => group.id));
  const rawAssignments = data.assignments && typeof data.assignments === "object" ? data.assignments as Record<string, unknown> : {};
  const assignments: Record<string, string[]> = {};
  for (const [pdfId, rawGroupIds] of Object.entries(rawAssignments)) {
    const pdfKey = String(pdfId || "").trim();
    const groupIds = Array.isArray(rawGroupIds) ? rawGroupIds : [rawGroupIds];
    const normalizedGroupIds = Array.from(new Set(
      groupIds
        .map(groupId => String(groupId || "").trim())
        .filter(groupId => validGroupIds.has(groupId))
    ));
    if (pdfKey && normalizedGroupIds.length > 0) {
      assignments[pdfKey] = normalizedGroupIds;
    }
  }

  return {
    version: 1,
    userId,
    groups,
    assignments,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : now,
  };
}

export function loadPdfWikiPdfManagement(dataDir: string, userId: string): PdfWikiPdfManagementStore {
  const managementPath = getManagementPath(dataDir, userId);
  if (!fs.existsSync(managementPath)) {
    return createEmptyStore(userId);
  }

  try {
    return normalizeStore(JSON.parse(fs.readFileSync(managementPath, "utf-8")), userId);
  } catch (error) {
    logger.warn(`[PdfWikiPdfManagement] Failed to read PDF management for ${userId}:`, error);
    return createEmptyStore(userId);
  }
}

export function savePdfWikiPdfManagement(
  dataDir: string,
  userId: string,
  store: PdfWikiPdfManagementStore
): PdfWikiPdfManagementStore {
  const normalized = normalizeStore(store, userId);
  normalized.updatedAt = new Date().toISOString();
  const managementPath = getManagementPath(dataDir, userId);
  fs.mkdirSync(path.dirname(managementPath), { recursive: true });
  fs.writeFileSync(managementPath, JSON.stringify(normalized, null, 2), "utf-8");
  return normalized;
}

export function createPdfWikiPdfGroup(dataDir: string, userId: string, name: string): PdfWikiPdfManagementStore {
  const trimmedName = String(name || "").trim();
  if (trimmedName.length < 1) {
    throw new Error("分组名称不能为空");
  }

  const store = loadPdfWikiPdfManagement(dataDir, userId);
  const now = new Date().toISOString();
  const id = `group_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  store.groups.push({
    id,
    name: trimmedName.slice(0, 80),
    createdAt: now,
    updatedAt: now,
  });
  return savePdfWikiPdfManagement(dataDir, userId, store);
}

export function renamePdfWikiPdfGroup(
  dataDir: string,
  userId: string,
  groupId: string,
  name: string
): PdfWikiPdfManagementStore {
  const trimmedName = String(name || "").trim();
  if (trimmedName.length < 1) {
    throw new Error("分组名称不能为空");
  }

  const store = loadPdfWikiPdfManagement(dataDir, userId);
  const group = store.groups.find(item => item.id === groupId);
  if (!group) {
    throw new Error("未找到该 PDF 分组");
  }

  group.name = trimmedName.slice(0, 80);
  group.updatedAt = new Date().toISOString();
  return savePdfWikiPdfManagement(dataDir, userId, store);
}

export function deletePdfWikiPdfGroup(dataDir: string, userId: string, groupId: string): PdfWikiPdfManagementStore {
  const store = loadPdfWikiPdfManagement(dataDir, userId);
  const before = store.groups.length;
  store.groups = store.groups.filter(group => group.id !== groupId);
  if (store.groups.length === before) {
    throw new Error("未找到该 PDF 分组");
  }

  for (const [pdfId, assignedGroupIds] of Object.entries(store.assignments)) {
    const nextGroupIds = assignedGroupIds.filter(assignedGroupId => assignedGroupId !== groupId);
    if (nextGroupIds.length > 0) {
      store.assignments[pdfId] = nextGroupIds;
    } else {
      delete store.assignments[pdfId];
    }
  }
  return savePdfWikiPdfManagement(dataDir, userId, store);
}

export function assignPdfWikiPdfGroup(
  dataDir: string,
  userId: string,
  pdfId: string,
  groupId: string
): PdfWikiPdfManagementStore {
  return assignPdfWikiPdfGroups(dataDir, userId, pdfId, groupId ? [groupId] : []);
}

export function assignPdfWikiPdfGroups(
  dataDir: string,
  userId: string,
  pdfId: string,
  groupIds: string[]
): PdfWikiPdfManagementStore {
  const pdfKey = String(pdfId || "").trim();
  if (!pdfKey) {
    throw new Error("缺少 PDF ID");
  }

  const store = loadPdfWikiPdfManagement(dataDir, userId);
  const normalizedGroupIds = Array.from(new Set(
    (Array.isArray(groupIds) ? groupIds : [])
      .map(groupId => String(groupId || "").trim())
      .filter(Boolean)
  ));
  if (normalizedGroupIds.length === 0) {
    delete store.assignments[pdfKey];
    return savePdfWikiPdfManagement(dataDir, userId, store);
  }

  const validGroupIds = new Set(store.groups.map(group => group.id));
  const unknownGroupId = normalizedGroupIds.find(groupId => !validGroupIds.has(groupId));
  if (unknownGroupId) {
    throw new Error("未找到该 PDF 分组");
  }

  store.assignments[pdfKey] = normalizedGroupIds;
  return savePdfWikiPdfManagement(dataDir, userId, store);
}
