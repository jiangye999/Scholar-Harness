"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const readline = __importStar(require("node:readline"));
const SERVER_NAME = 'scholar-harness-meta-analysis';
const SERVER_VERSION = '1.1.0';
const DEFAULT_BASE_URL = 'http://127.0.0.1:18789';
const DEFAULT_TIMEOUT_MS = 600_000;
const MAX_RESPONSE_CHARS = 180_000;
const BASE_URL = String(process.env.SCHOLAR_HARNESS_META_URL
    || process.env.SCHOLAR_HARNESS_URL
    || DEFAULT_BASE_URL).replace(/\/+$/, '');
const sharedUserIdProperty = {
    userId: {
        type: 'string',
        description: 'Scholar Harness user ID. Defaults to SCHOLAR_HARNESS_META_USER_ID, then the active desktop user, then web-user.',
    },
};
const TOOLS = [
    {
        name: 'meta_health',
        description: 'Check whether Scholar Harness and its globally configured R plugin are available.',
        inputSchema: { type: 'object', properties: sharedUserIdProperty, additionalProperties: false },
    },
    {
        name: 'meta_list_sources',
        description: 'List the PDF Meta database, extraction state, coding-table size, and figure digitization status.',
        inputSchema: {
            type: 'object',
            properties: {
                ...sharedUserIdProperty,
                includeDetails: { type: 'boolean', description: 'Include coding-table details. Default false.' },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'meta_upload_pdfs',
        description: 'Upload local PDF files and queue Meta data extraction in Scholar Harness.',
        inputSchema: {
            type: 'object',
            properties: {
                ...sharedUserIdProperty,
                filePaths: { type: 'array', minItems: 1, items: { type: 'string' } },
                force: { type: 'boolean', description: 'Re-extract files that already exist.' },
                engine: { type: 'string', enum: ['auto', 'codex', 'api'] },
            },
            required: ['filePaths'],
            additionalProperties: false,
        },
    },
    {
        name: 'meta_extract_sources',
        description: 'Queue or rebuild Meta data extraction for exact PDF IDs already stored in Scholar Harness.',
        inputSchema: {
            type: 'object',
            properties: {
                ...sharedUserIdProperty,
                pdfIds: { type: 'array', minItems: 1, items: { type: 'string' } },
                force: { type: 'boolean' },
                engine: { type: 'string', enum: ['auto', 'codex', 'api'] },
            },
            required: ['pdfIds'],
            additionalProperties: false,
        },
    },
    {
        name: 'meta_get_source',
        description: 'Read one PDF Meta record, including its full coding table and extracted figure metadata.',
        inputSchema: {
            type: 'object',
            properties: { ...sharedUserIdProperty, pdfId: { type: 'string' } },
            required: ['pdfId'],
            additionalProperties: false,
        },
    },
    {
        name: 'meta_add_coding_column',
        description: 'Add a coding-table column to the shared Meta template and existing Meta records.',
        inputSchema: {
            type: 'object',
            properties: {
                ...sharedUserIdProperty,
                column: { type: 'string' },
                afterColumn: { type: 'string', description: 'Optional existing column after which the new column is inserted.' },
            },
            required: ['column'],
            additionalProperties: false,
        },
    },
    {
        name: 'meta_save_coding_table',
        description: 'Replace one PDF coding table after an explicit review or correction.',
        inputSchema: {
            type: 'object',
            properties: {
                ...sharedUserIdProperty,
                pdfId: { type: 'string' },
                columns: { type: 'array', items: { type: 'string' } },
                rows: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
            required: ['pdfId', 'columns', 'rows'],
            additionalProperties: false,
        },
    },
    {
        name: 'meta_delete_coding_selection',
        description: 'Delete selected zero-based rows and/or named columns from one PDF coding table.',
        inputSchema: {
            type: 'object',
            properties: {
                ...sharedUserIdProperty,
                pdfId: { type: 'string' },
                rowIndexes: { type: 'array', items: { type: 'integer', minimum: 0 } },
                columns: { type: 'array', items: { type: 'string' } },
            },
            required: ['pdfId'],
            additionalProperties: false,
        },
    },
    {
        name: 'meta_import_digitized_data',
        description: 'Import GetData or other figure-digitization CSV/TXT/TSV/XLS/XLSX data for a PDF figure.',
        inputSchema: {
            type: 'object',
            properties: {
                ...sharedUserIdProperty,
                pdfId: { type: 'string' },
                filePath: { type: 'string' },
                figureKey: { type: 'string' },
                figureLabel: { type: 'string' },
                tool: { type: 'string' },
                notes: { type: 'string' },
                parameters: { type: 'object', additionalProperties: true },
            },
            required: ['pdfId', 'filePath'],
            additionalProperties: false,
        },
    },
    {
        name: 'meta_export_coding_tables',
        description: 'Export selected PDF integrated coding tables and evidence tables to an XLSX file.',
        inputSchema: {
            type: 'object',
            properties: {
                ...sharedUserIdProperty,
                pdfIds: { type: 'array', minItems: 1, items: { type: 'string' } },
                outputPath: { type: 'string', description: 'Absolute destination .xlsx path.' },
            },
            required: ['pdfIds', 'outputPath'],
            additionalProperties: false,
        },
    },
    {
        name: 'meta_inspect_dataset',
        description: 'Inspect selected coding tables and infer variables, outcomes, moderators, warnings, and a preliminary config.',
        inputSchema: {
            type: 'object',
            properties: {
                ...sharedUserIdProperty,
                pdfIds: { type: 'array', minItems: 1, items: { type: 'string' } },
            },
            required: ['pdfIds'],
            additionalProperties: false,
        },
    },
    {
        name: 'meta_plan_analysis',
        description: 'Ask the Scholar Harness Meta agent to interpret columns and propose a treatment/control and effect-size plan. Set confirmed only after explicit user confirmation.',
        inputSchema: {
            type: 'object',
            properties: {
                ...sharedUserIdProperty,
                pdfIds: { type: 'array', minItems: 1, items: { type: 'string' } },
                query: { type: 'string', description: 'Scientific objective and any treatment/control, outcome, or model requirements.' },
                conversationId: { type: 'string' },
                provider: { type: 'string', enum: ['secondary', 'primary', 'codex'] },
                confirmed: { type: 'boolean', description: 'True only after the user explicitly confirms the proposed mapping.' },
                chatHistory: { type: 'array', items: { type: 'object', additionalProperties: true } },
                recentUserQueries: { type: 'array', items: { type: 'string' } },
                renderPlots: { type: 'boolean', description: 'Render R plots if a confirmed plan produces an analysis.' },
            },
            required: ['pdfIds', 'query'],
            additionalProperties: false,
        },
    },
    {
        name: 'meta_run_analysis',
        description: 'Run the explicitly confirmed Meta config; optionally execute the generated R/metafor script and register artifacts.',
        inputSchema: {
            type: 'object',
            properties: {
                ...sharedUserIdProperty,
                pdfIds: { type: 'array', minItems: 1, items: { type: 'string' } },
                config: { type: 'object', description: 'Confirmed config returned by inspect or plan.', additionalProperties: true },
                conversationId: { type: 'string', description: 'Main Scholar Harness conversation that owns this analysis result.' },
                workspaceId: { type: 'string', description: 'Meta AI workspace/session ID, if available.' },
                renderPlots: { type: 'boolean', description: 'Default true.' },
                rTimeoutMs: { type: 'integer', minimum: 10000, maximum: 600000 },
            },
            required: ['pdfIds', 'config'],
            additionalProperties: false,
        },
    },
    {
        name: 'meta_get_results',
        description: 'Read the latest shared Meta result, quality checks, effect summaries, subgroups, skipped rows, and R artifacts.',
        inputSchema: {
            type: 'object',
            properties: {
                ...sharedUserIdProperty,
                analysisId: { type: 'string', description: 'Exact analysis run ID. Preferred over an unscoped latest result.' },
                conversationId: { type: 'string', description: 'Read the latest result bound to this conversation.' },
                detail: { type: 'string', enum: ['summary', 'full'], description: 'Full includes effect rows and context markdown.' },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'meta_export_results',
        description: 'Export latest effect sizes as CSV or a completed R job as a ZIP archive.',
        inputSchema: {
            type: 'object',
            properties: {
                ...sharedUserIdProperty,
                analysisId: { type: 'string', description: 'Exact analysis run ID for effect-size export.' },
                conversationId: { type: 'string', description: 'Conversation-scoped latest analysis for effect-size export.' },
                kind: { type: 'string', enum: ['effect-sizes', 'r-artifacts'] },
                outputPath: { type: 'string', description: 'Absolute destination path.' },
                jobId: { type: 'string', description: 'Required for r-artifacts.' },
                artifactScope: { type: 'string', enum: ['all', 'images'] },
            },
            required: ['kind', 'outputPath'],
            additionalProperties: false,
        },
    },
    {
        name: 'pdfwiki_obsidian_status',
        description: 'Check whether the shared Scholar Harness PDF Wiki has been synchronized to its managed Obsidian-compatible Markdown Vault.',
        inputSchema: {
            type: 'object',
            properties: sharedUserIdProperty,
            additionalProperties: false,
        },
    },
    {
        name: 'pdfwiki_obsidian_sync',
        description: 'One-click synchronize the shared sentence-level PDF Wiki to the Scholar Harness managed Obsidian-compatible Markdown Vault. This does not install or launch the Obsidian desktop client.',
        inputSchema: {
            type: 'object',
            properties: sharedUserIdProperty,
            additionalProperties: false,
        },
    },
    {
        name: 'pdfwiki_obsidian_search',
        description: 'Search notes in the synchronized PDF Wiki Obsidian Vault and return matching sentence-level evidence, PDF, topic, and index notes.',
        inputSchema: {
            type: 'object',
            properties: {
                ...sharedUserIdProperty,
                query: { type: 'string', description: 'Exact keyword or phrase to search in the synchronized Vault.' },
                limit: { type: 'integer', minimum: 1, maximum: 80, description: 'Maximum matches. Default 30.' },
            },
            required: ['query'],
            additionalProperties: false,
        },
    },
    {
        name: 'pdfwiki_obsidian_export',
        description: 'Export a timestamped standalone copy of the current sentence-level PDF Wiki as an Obsidian-compatible Markdown Vault.',
        inputSchema: {
            type: 'object',
            properties: sharedUserIdProperty,
            additionalProperties: false,
        },
    },
];
async function getUserId(args) {
    const supplied = typeof args.userId === 'string' ? args.userId.trim() : '';
    const configured = process.env.SCHOLAR_HARNESS_META_USER_ID?.trim() || '';
    if (supplied || configured)
        return supplied || configured;
    try {
        const response = await apiJson('/api/meta-analysis/active-user');
        const active = asObject(response.data);
        const userId = typeof active.userId === 'string' ? active.userId.trim() : '';
        if (userId)
            return userId;
    }
    catch {
        // The health tool will report service availability; retain legacy fallback here.
    }
    return 'web-user';
}
function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function asString(value, field) {
    const result = typeof value === 'string' ? value.trim() : '';
    if (!result)
        throw new Error(`Missing required field: ${field}`);
    return result;
}
function asStringArray(value, field) {
    if (!Array.isArray(value))
        throw new Error(`Missing required array: ${field}`);
    const result = value.map(item => String(item || '').trim()).filter(Boolean);
    if (result.length === 0)
        throw new Error(`${field} must contain at least one value`);
    return result;
}
function requestHeaders(extra = {}) {
    const headers = { Accept: 'application/json', ...extra };
    const cookie = process.env.SCHOLAR_HARNESS_SESSION_COOKIE?.trim();
    if (cookie)
        headers.Cookie = cookie;
    return headers;
}
function requestTimeoutMs() {
    const configured = Number(process.env.SCHOLAR_HARNESS_META_TIMEOUT_MS);
    return Number.isFinite(configured) && configured >= 10_000 ? configured : DEFAULT_TIMEOUT_MS;
}
async function apiResponse(endpoint, init = {}) {
    const url = `${BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const response = await fetch(url, {
        ...init,
        headers: requestHeaders(init.headers),
        signal: init.signal || AbortSignal.timeout(requestTimeoutMs()),
    });
    if (!response.ok) {
        const text = await response.text();
        let message = text;
        try {
            const parsed = JSON.parse(text);
            message = String(parsed.error || parsed.message || text);
        }
        catch {
            // Keep the plain response body.
        }
        throw new Error(`Scholar Harness ${response.status} ${response.statusText}: ${message || endpoint}`);
    }
    return response;
}
async function apiJson(endpoint, init = {}) {
    const response = await apiResponse(endpoint, init);
    return asObject(await response.json());
}
async function postJson(endpoint, body) {
    return apiJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}
function unwrapData(response) {
    return asObject(response.data);
}
function responsePreview(value) {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized.length <= MAX_RESPONSE_CHARS)
        return value;
    return {
        truncated: true,
        totalCharacters: serialized.length,
        preview: serialized.slice(0, MAX_RESPONSE_CHARS),
        hint: 'Request a narrower source or summary view to retrieve the omitted details.',
    };
}
function toolResult(value, isError = false) {
    const preview = responsePreview(value);
    return {
        content: [{ type: 'text', text: JSON.stringify(preview, null, 2) }],
        ...(isError ? { isError: true } : {}),
    };
}
async function readLocalFile(filePath) {
    const absolutePath = path.resolve(filePath);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile())
        throw new Error(`Not a file: ${absolutePath}`);
    return { absolutePath, name: path.basename(absolutePath), buffer: await fs.readFile(absolutePath) };
}
function toBlobPart(buffer) {
    const bytes = new Uint8Array(buffer.byteLength);
    bytes.set(buffer);
    return bytes.buffer;
}
async function writeBinaryResponse(response, outputPath) {
    const absolutePath = path.resolve(outputPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(absolutePath, buffer);
    return { outputPath: absolutePath, bytes: buffer.byteLength };
}
function summarizeMetaList(payload) {
    const items = Array.isArray(payload.items) ? payload.items.map(itemValue => {
        const item = asObject(itemValue);
        const table = asObject(item.dataTable);
        const figures = Array.isArray(item.figurePreviews) ? item.figurePreviews : [];
        return {
            pdfId: item.pdfId,
            title: item.title || item.pdfTitle || item.name,
            fileName: item.fileName || item.pdfName,
            status: item.status || item.metaStatus || item.extractionStatus,
            error: item.error || item.lastError,
            rowCount: table.rowCount ?? (Array.isArray(table.rows) ? table.rows.length : 0),
            columnCount: Array.isArray(table.columns) ? table.columns.length : table.columnCount,
            figureCount: figures.length,
            updatedAt: item.updatedAt || item.generatedAt,
        };
    }) : [];
    return {
        metaCount: payload.metaCount ?? items.length,
        generatedAt: payload.generatedAt,
        status: payload.status,
        items,
    };
}
function summarizeRun(run, rArtifacts) {
    const effects = Array.isArray(run.effectRows) ? run.effectRows : [];
    const skipped = Array.isArray(run.skippedRows) ? run.skippedRows : [];
    return {
        analysisId: run.analysisId,
        conversationId: run.conversationId,
        workspaceId: run.workspaceId,
        sourcePdfIds: run.sourcePdfIds,
        dataset: run.dataset,
        config: run.config,
        effectCount: effects.length,
        skippedCount: run.skippedCount ?? skipped.length,
        summaries: run.summaries,
        subgroups: run.subgroups,
        quality: run.quality,
        markdown: run.markdown,
        preparedDataset: run.preparedDataset,
        rArtifacts,
        writingContextSynchronized: effects.length > 0,
    };
}
async function executeRArtifacts(userId, run, timeoutMs) {
    const rCode = asString(run.rCode, 'run.rCode');
    const csv = asString(run.effectRowsCsv, 'run.effectRowsCsv');
    const csvName = typeof run.effectRowsFilename === 'string' && run.effectRowsFilename.trim()
        ? run.effectRowsFilename.trim()
        : 'meta_effect_sizes.csv';
    const form = new FormData();
    form.append('userId', userId);
    form.append('rCode', rCode);
    form.append('filename', 'scholar_harness_meta_analysis.R');
    form.append('dataFilename', csvName);
    form.append('timeoutMs', String(timeoutMs || 300_000));
    form.append('file', new Blob([csv], { type: 'text/csv;charset=utf-8' }), csvName);
    const response = await apiJson('/api/r-code/execute', { method: 'POST', body: form });
    const artifacts = unwrapData(response);
    await postJson('/api/meta-analysis/r-artifacts', {
        userId,
        analysisId: run.analysisId,
        conversationId: run.conversationId,
        markdown: run.markdown,
        jobId: artifacts.jobId,
        files: artifacts.files,
        imageFiles: artifacts.imageFiles,
        supportFiles: artifacts.supportFiles,
        workDir: artifacts.workDir,
        plotDir: artifacts.plotDir,
    });
    return artifacts;
}
async function handleTool(name, args) {
    const userId = await getUserId(args);
    switch (name) {
        case 'meta_health': {
            const health = await apiJson('/health');
            let rPlugin;
            try {
                rPlugin = await apiJson('/api/r-code/plugin/status');
            }
            catch (error) {
                rPlugin = { success: false, error: error.message };
            }
            return toolResult({ baseUrl: BASE_URL, userId, health, rPlugin });
        }
        case 'meta_list_sources': {
            const includeDetails = args.includeDetails === true;
            const payload = await apiJson(`/api/pdf-wiki/meta?userId=${encodeURIComponent(userId)}${includeDetails ? '' : '&summary=1'}`);
            return toolResult(includeDetails ? payload : summarizeMetaList(payload));
        }
        case 'meta_upload_pdfs': {
            const filePaths = asStringArray(args.filePaths, 'filePaths');
            const files = await Promise.all(filePaths.map(readLocalFile));
            const form = new FormData();
            form.append('userId', userId);
            form.append('force', String(args.force === true));
            form.append('pdfWikiMetaAnalysisEngine', typeof args.engine === 'string' ? args.engine : 'auto');
            for (const file of files) {
                form.append('files', new Blob([toBlobPart(file.buffer)], { type: 'application/pdf' }), file.name);
            }
            const payload = await apiJson('/api/pdf-wiki/meta/upload', { method: 'POST', body: form });
            return toolResult({ ...payload, uploadedFiles: files.map(file => file.absolutePath) });
        }
        case 'meta_extract_sources': {
            const payload = await postJson('/api/pdf-wiki/meta/extract', {
                userId,
                pdfIds: asStringArray(args.pdfIds, 'pdfIds'),
                force: args.force === true,
                pdfWikiMetaAnalysisEngine: typeof args.engine === 'string' ? args.engine : 'auto',
            });
            return toolResult(payload);
        }
        case 'meta_get_source': {
            const pdfId = asString(args.pdfId, 'pdfId');
            const payload = await apiJson(`/api/pdf-wiki/meta?userId=${encodeURIComponent(userId)}&pdfId=${encodeURIComponent(pdfId)}`);
            return toolResult(payload);
        }
        case 'meta_add_coding_column': {
            const payload = await postJson('/api/pdf-wiki/meta/coding-table/columns', {
                userId,
                column: asString(args.column, 'column'),
                afterColumn: typeof args.afterColumn === 'string' ? args.afterColumn : '',
            });
            return toolResult(payload);
        }
        case 'meta_save_coding_table': {
            if (!Array.isArray(args.columns) || !Array.isArray(args.rows)) {
                throw new Error('columns and rows must be arrays');
            }
            const payload = await postJson('/api/pdf-wiki/meta/coding-table/save', {
                userId,
                pdfId: asString(args.pdfId, 'pdfId'),
                columns: args.columns,
                rows: args.rows,
            });
            return toolResult(payload);
        }
        case 'meta_delete_coding_selection': {
            const rowIndexes = Array.isArray(args.rowIndexes) ? args.rowIndexes : [];
            const columns = Array.isArray(args.columns) ? args.columns : [];
            if (rowIndexes.length === 0 && columns.length === 0) {
                throw new Error('Select at least one row index or column');
            }
            const payload = await postJson('/api/pdf-wiki/meta/coding-table/delete', {
                userId,
                pdfId: asString(args.pdfId, 'pdfId'),
                rowIndexes,
                columns,
            });
            return toolResult(payload);
        }
        case 'meta_import_digitized_data': {
            const file = await readLocalFile(asString(args.filePath, 'filePath'));
            const form = new FormData();
            form.append('userId', userId);
            form.append('pdfId', asString(args.pdfId, 'pdfId'));
            form.append('figureKey', typeof args.figureKey === 'string' ? args.figureKey : '');
            form.append('figureLabel', typeof args.figureLabel === 'string' ? args.figureLabel : '');
            form.append('tool', typeof args.tool === 'string' ? args.tool : 'GetData Graph Digitizer');
            form.append('notes', typeof args.notes === 'string' ? args.notes : '');
            form.append('parameters', JSON.stringify(asObject(args.parameters)));
            form.append('file', new Blob([toBlobPart(file.buffer)]), file.name);
            const payload = await apiJson('/api/pdf-wiki/meta/figures/digitization/import', { method: 'POST', body: form });
            return toolResult({ ...payload, importedFile: file.absolutePath });
        }
        case 'meta_export_coding_tables': {
            const outputPath = asString(args.outputPath, 'outputPath');
            const response = await apiResponse('/api/pdf-wiki/meta/tables/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, pdfIds: asStringArray(args.pdfIds, 'pdfIds') }),
            });
            return toolResult(await writeBinaryResponse(response, outputPath));
        }
        case 'meta_inspect_dataset': {
            const response = await postJson('/api/meta-analysis/inspect', {
                userId,
                pdfIds: asStringArray(args.pdfIds, 'pdfIds'),
            });
            return toolResult(unwrapData(response));
        }
        case 'meta_plan_analysis': {
            const query = asString(args.query, 'query');
            const confirmed = args.confirmed === true;
            const response = await postJson('/api/meta-analysis/ai-plan', {
                userId,
                pdfIds: asStringArray(args.pdfIds, 'pdfIds'),
                query: confirmed ? `${query}\n\n用户已明确确认上述处理组、对照组、字段映射和分析方案，请执行。` : query,
                conversationId: typeof args.conversationId === 'string' ? args.conversationId : '',
                writingConversationId: typeof args.conversationId === 'string' ? args.conversationId : '',
                forceProvider: typeof args.provider === 'string' ? args.provider : undefined,
                chatHistory: Array.isArray(args.chatHistory) ? args.chatHistory : [],
                recentUserQueries: Array.isArray(args.recentUserQueries) ? args.recentUserQueries : [],
            });
            const plan = unwrapData(response);
            let rArtifacts;
            const autoRun = asObject(plan.autoRun);
            if (confirmed && args.renderPlots === true && typeof autoRun.rCode === 'string') {
                rArtifacts = await executeRArtifacts(userId, autoRun);
            }
            const planResult = { ...plan, ...(rArtifacts ? { rArtifacts } : {}) };
            return toolResult(planResult);
        }
        case 'meta_run_analysis': {
            const config = asObject(args.config);
            if (Object.keys(config).length === 0)
                throw new Error('config must be a non-empty object');
            const response = await postJson('/api/meta-analysis/run', {
                userId,
                pdfIds: asStringArray(args.pdfIds, 'pdfIds'),
                config,
                conversationId: typeof args.conversationId === 'string' ? args.conversationId : '',
                workspaceId: typeof args.workspaceId === 'string' ? args.workspaceId : '',
            });
            const run = unwrapData(response);
            let rArtifacts;
            if (args.renderPlots !== false) {
                rArtifacts = await executeRArtifacts(userId, run, typeof args.rTimeoutMs === 'number' ? args.rTimeoutMs : undefined);
            }
            return toolResult(summarizeRun(run, rArtifacts));
        }
        case 'meta_get_results': {
            const params = new URLSearchParams({ userId });
            if (typeof args.analysisId === 'string' && args.analysisId.trim())
                params.set('analysisId', args.analysisId.trim());
            if (typeof args.conversationId === 'string' && args.conversationId.trim())
                params.set('conversationId', args.conversationId.trim());
            const response = await apiJson(`/api/meta-analysis/writing-context?${params.toString()}`);
            const context = unwrapData(response);
            if (args.detail === 'full')
                return toolResult(context);
            return toolResult({
                analysisId: context.analysisId,
                conversationId: context.conversationId,
                workspaceId: context.workspaceId,
                sourcePdfIds: context.sourcePdfIds,
                generatedAt: context.generatedAt,
                available: context.available,
                dataset: context.dataset,
                config: context.config,
                summaries: context.summaries,
                subgroups: context.subgroups,
                quality: context.quality,
                effectCount: Array.isArray(context.effectRows) ? context.effectRows.length : 0,
                skippedCount: context.skippedCount,
                markdown: context.markdown,
                rArtifacts: context.rArtifacts,
                exports: context.exports,
            });
        }
        case 'meta_export_results': {
            const kind = asString(args.kind, 'kind');
            const outputPath = asString(args.outputPath, 'outputPath');
            if (kind === 'effect-sizes') {
                const params = new URLSearchParams({ userId });
                if (typeof args.analysisId === 'string' && args.analysisId.trim())
                    params.set('analysisId', args.analysisId.trim());
                if (typeof args.conversationId === 'string' && args.conversationId.trim())
                    params.set('conversationId', args.conversationId.trim());
                const response = await apiResponse(`/api/meta-analysis/writing-context/effect-sizes.csv?${params.toString()}`);
                return toolResult(await writeBinaryResponse(response, outputPath));
            }
            if (kind === 'r-artifacts') {
                const jobId = asString(args.jobId, 'jobId');
                const scope = args.artifactScope === 'images' ? 'images' : 'all';
                const response = await apiResponse(`/api/r-code/artifact-zip/${encodeURIComponent(userId)}/${encodeURIComponent(jobId)}?scope=${scope}`);
                return toolResult(await writeBinaryResponse(response, outputPath));
            }
            throw new Error(`Unsupported export kind: ${kind}`);
        }
        case 'pdfwiki_obsidian_status': {
            const payload = await apiJson(`/api/pdf-wiki/obsidian/status?userId=${encodeURIComponent(userId)}`);
            return toolResult({
                ...payload,
                sourceOfTruth: 'Scholar Harness PDF Wiki',
                installsObsidianClient: false,
            });
        }
        case 'pdfwiki_obsidian_sync': {
            const payload = await postJson('/api/pdf-wiki/obsidian/deploy', { userId });
            return toolResult({
                ...payload,
                sourceOfTruth: 'Scholar Harness PDF Wiki',
                operation: 'synchronize-managed-vault',
                installsObsidianClient: false,
            });
        }
        case 'pdfwiki_obsidian_search': {
            const query = asString(args.query, 'query');
            const requestedLimit = typeof args.limit === 'number' ? Math.trunc(args.limit) : 30;
            const limit = Math.max(1, Math.min(80, requestedLimit));
            const payload = await apiJson(`/api/pdf-wiki/obsidian/search?userId=${encodeURIComponent(userId)}&q=${encodeURIComponent(query)}&limit=${limit}`);
            return toolResult(payload);
        }
        case 'pdfwiki_obsidian_export': {
            const payload = await postJson('/api/pdf-wiki/export-obsidian', { userId });
            return toolResult({
                ...payload,
                sourceOfTruth: 'Scholar Harness PDF Wiki',
                operation: 'export-standalone-vault-copy',
                installsObsidianClient: false,
            });
        }
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}
function send(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}
async function dispatch(request) {
    if (request.id === undefined || request.id === null)
        return;
    try {
        if (request.method === 'initialize') {
            const params = asObject(request.params);
            send({
                jsonrpc: '2.0',
                id: request.id,
                result: {
                    protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05',
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
                    instructions: 'Use the Meta workflow skill for analysis and the PDF Wiki Obsidian workflow skill for Vault synchronization. Confirm treatment/control mappings before running an analysis, and synchronize a Vault only after an explicit user request.',
                },
            });
            return;
        }
        if (request.method === 'ping') {
            send({ jsonrpc: '2.0', id: request.id, result: {} });
            return;
        }
        if (request.method === 'tools/list') {
            send({ jsonrpc: '2.0', id: request.id, result: { tools: TOOLS } });
            return;
        }
        if (request.method === 'tools/call') {
            const params = asObject(request.params);
            const toolName = asString(params.name, 'params.name');
            try {
                const result = await handleTool(toolName, asObject(params.arguments));
                send({ jsonrpc: '2.0', id: request.id, result });
            }
            catch (error) {
                send({
                    jsonrpc: '2.0',
                    id: request.id,
                    result: toolResult({
                        error: error.message || String(error),
                        recoverable: true,
                        baseUrl: BASE_URL,
                    }, true),
                });
            }
            return;
        }
        send({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32601, message: `Method not found: ${request.method}` },
        });
    }
    catch (error) {
        send({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32603, message: error.message || String(error) },
        });
    }
}
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', line => {
    const trimmed = line.trim();
    if (!trimmed)
        return;
    let request;
    try {
        request = JSON.parse(trimmed);
    }
    catch (error) {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: `Parse error: ${error.message}` } });
        return;
    }
    void dispatch(request).catch(error => {
        process.stderr.write(`[${SERVER_NAME}] ${String(error)}\n`);
    });
});
