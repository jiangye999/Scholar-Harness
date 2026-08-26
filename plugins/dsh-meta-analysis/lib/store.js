/**
 * Local JSON storage for the Meta analysis plugin. Everything lives under
 * `<dshHome>/meta-analysis/<userId>/` — a completely independent data root
 * with zero connection to the Scholar Harness desktop service.
 *
 * Store shape:
 *   store.json: { version, projects: Project[] }
 *   Project: { id, name, createdAt, updatedAt, sources: Source[], analyses: Analysis[] }
 *   Source: { pdfId, title, authors, year, parser, needsReview,
 *             dataTable: { columns: string[], rows: Record<string,unknown>[], rowCount },
 *             figures: Figure[] }
 *   Figure: { id, label, page, caption, note, needsDigitization, digitized: { columns, rows } }
 *   Analysis: { analysisId, createdAt, config, effectRows, skippedRows, summaries,
 *               subgroups, quality, markdown, rCode, effectRowsCsv, writingContext }
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'

/** Default data root: $DSH_HOME (or ~/.dsh) / meta-analysis. */
export function defaultDataRoot() {
  return process.env.DSH_META_DATA_ROOT
    || path.join(process.env.DSH_HOME || path.join(homedir(), '.dsh'), 'meta-analysis')
}

/** Sanitize a user id to a safe path segment. */
export function sanitizeUserId(userId) {
  const value = String(userId ?? '').trim() || 'default'
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 64)
}

/** One JSON file store bound to a user directory. */
export class MetaStore {
  /**
   * @param options - dataRoot and userId.
   */
  constructor(options = {}) {
    this.dataRoot = options.dataRoot ?? defaultDataRoot()
    this.userId = sanitizeUserId(options.userId ?? 'default')
    this.dir = path.join(this.dataRoot, this.userId)
    this.path = path.join(this.dir, 'store.json')
  }

  /** Ensure the store directory exists. */
  ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true })
  }

  /** Read the store (creates an empty one when missing or corrupt). */
  read() {
    this.ensureDir()
    if (!fs.existsSync(this.path)) return { version: 1, projects: [] }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.path, 'utf-8'))
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.projects)) return parsed
      return { version: 1, projects: [] }
    } catch {
      return { version: 1, projects: [] }
    }
  }

  /** Atomic write of the whole store. */
  write(store) {
    this.ensureDir()
    const tmp = `${this.path}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8')
    fs.renameSync(tmp, this.path)
  }

  // ------------------------------------------------------------ projects

  /** List projects (summaries only). */
  listProjects() {
    const store = this.read()
    return store.projects.map(p => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      sourceCount: (p.sources || []).length,
      analysisCount: (p.analyses || []).length,
    }))
  }

  /** Get one project by id, or the first project (auto-create when empty). */
  getProject(projectId) {
    const store = this.read()
    if (store.projects.length === 0) {
      return this.createProject({ name: '默认 Meta 分析项目' })
    }
    const project = store.projects.find(p => p.id === projectId)
    if (project) return project
    return store.projects[0]
  }

  /** Create a project. */
  createProject(input) {
    const store = this.read()
    const now = new Date().toISOString()
    const project = {
      id: `proj_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      name: String(input?.name ?? '').trim() || '未命名项目',
      createdAt: now,
      updatedAt: now,
      sources: [],
      analyses: [],
    }
    store.projects.push(project)
    this.write(store)
    return project
  }

  /** Rename a project. */
  renameProject(projectId, name) {
    const store = this.read()
    const project = store.projects.find(p => p.id === projectId)
    if (!project) return null
    project.name = String(name ?? '').trim() || project.name
    project.updatedAt = new Date().toISOString()
    this.write(store)
    return project
  }

  /** Delete a project. */
  deleteProject(projectId) {
    const store = this.read()
    const before = store.projects.length
    store.projects = store.projects.filter(p => p.id !== projectId)
    if (store.projects.length === before) return false
    this.write(store)
    return true
  }

  /** Mutate one project with a transaction function and persist. */
  updateProject(projectId, mutate) {
    const store = this.read()
    const project = store.projects.find(p => p.id === projectId)
    if (!project) return null
    const result = mutate(project)
    project.updatedAt = new Date().toISOString()
    this.write(store)
    return result === undefined ? project : result
  }
}
