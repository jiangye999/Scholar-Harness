import { Router } from 'express';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';

import { chatBridge } from '../../bridge/chat-bridge/chat-bridge';
import { logger } from '../../utils/logger';
import { getDataDir } from '../../utils/paths';
import {
  discoverMcpPlugin,
  getMcpMarketplaceConfigStatus,
  listMcpPlugins,
  removeMcpPlugin,
  saveMcpPlugin,
  saveMcpMarketplaceConfig,
  searchMcpPluginMarketplace,
  setMcpPluginEnabled,
} from '../services/mcp-plugin-manager';

const router = Router();

const idSchema = z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/i);
const toggleSchema = z.object({ enabled: z.boolean() });
const projectAnalysisSchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.string().url().max(2000).refine(value => /^https:\/\//i.test(value), '项目来源必须使用 HTTPS'),
  description: z.string().trim().max(1000).default(''),
  installationIssue: z.string().trim().max(6000).default(''),
  iconKind: z.enum(['curated', 'npm', 'github', 'custom']).default('custom'),
  iconUrl: z.string().url().max(2000).optional().or(z.literal('')),
});
const integrationJobSchema = projectAnalysisSchema.extend({
  analysis: z.record(z.unknown()).default({}),
});
const integrationManifestSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/i),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  entry: z.string().trim().min(1).max(500),
  env: z.record(z.string().max(8000)).default({}),
  risk: z.enum(['read', 'network', 'write', 'command']).default('network'),
});

type IntegrationJob = {
  id: string;
  status: 'queued' | 'running' | 'success' | 'error';
  projectName: string;
  pluginId?: string;
  message: string;
  createdAt: string;
  updatedAt: string;
};

const integrationJobs = new Map<string, IntegrationJob>();

function publicIntegrationJob(job: IntegrationJob): IntegrationJob {
  return { ...job };
}

function logIntegrationJob(job: IntegrationJob, message: string): void {
  logger.info(`[McpIntegration:${job.id}] ${job.projectName} | ${message}`);
}

async function runIntegrationJob(
  job: IntegrationJob,
  input: z.infer<typeof integrationJobSchema>,
): Promise<void> {
  const jobRoot = path.join(getDataDir(), 'mcp-integrations', job.id);
  const manifestPath = path.join(jobRoot, 'scholar-harness-mcp.json');
  try {
    await fs.mkdir(jobRoot, { recursive: true });
    job.status = 'running';
    job.message = 'AI 正在下载项目并创建 MCP 适配层';
    job.updatedAt = new Date().toISOString();
    logIntegrationJob(job, `开始后台部署 | root=${jobRoot}`);

    const prompt = [
      '你正在执行 Scholar Harness 已由用户明确确认的第三方项目后台接入任务。',
      `项目：${input.name}`,
      `项目来源：${input.url}`,
      `简介：${input.description || '无'}`,
      `需要继续解决的安装/检测问题：${input.installationIssue || '无'}`,
      `预评估：${JSON.stringify(input.analysis)}`,
      `唯一允许写入的部署目录：${jobRoot}`,
      '',
      '任务要求：',
      '1. 在部署目录内读取或克隆项目，检查 README、许可证和实际代码。禁止写入部署目录之外。',
      '2. 创建最小、可审查的 Node.js stdio MCP 适配器；不得暴露任意 shell、任意文件路径或任意代码执行工具。',
      '3. 可以在部署目录内安装必要依赖，但不得修改系统级配置，不得写全局环境变量。',
      '4. 适配器必须使用 stdio JSON Lines：stdin 每行接收一个完整 JSON-RPC 对象，stdout 每行只输出一个完整 JSON-RPC 对象；不要使用 Content-Length 头；日志只能写 stderr。',
      '5. 至少实现 initialize、tools/list 和计划中的安全工具；参数使用严格 JSON Schema。',
      '6. 最终在部署目录根部写 scholar-harness-mcp.json，格式严格为：',
      '{"id":"安全ID","name":"名称","description":"用途","entry":"相对部署目录的适配器入口.mjs","env":{},"risk":"read|network|write|command"}',
      '7. entry 必须是部署目录内真实存在的 .mjs 文件。不要调用 Scholar Harness API，不要自行注册插件。',
      '8. 如果项目不适合安全适配，停止并说明原因，不得伪造 manifest。',
      '9. 不要生成、绘制、下载或创建任何项目图标；Scholar Harness 会直接沿用市场提供的原项目 icon。',
    ].join('\n');

    logIntegrationJob(job, '正在调用 Codex 下载项目并生成隔离的 stdio MCP 适配器');
    await chatBridge.chat({
      messages: [{ role: 'user', content: prompt }],
      conversationId: `mcp-integration-${job.id}`,
      forceProvider: 'codex',
      disableFallback: true,
      maxTokens: 5000,
      codexTimeoutMs: -1,
      workspaceDirectory: {
        root: jobRoot,
        path: jobRoot,
        permission: 'workspace-write',
        aiWorkRoot: jobRoot,
        safeWorkRoot: jobRoot,
      },
    });

    job.message = 'AI 适配器已生成，正在校验入口并检测 MCP 工具';
    job.updatedAt = new Date().toISOString();
    logIntegrationJob(job, 'Codex 任务完成，正在校验 manifest 和适配器入口');
    const manifest = integrationManifestSchema.parse(
      JSON.parse(await fs.readFile(manifestPath, 'utf-8')),
    );
    const entryPath = path.resolve(jobRoot, manifest.entry);
    const relativeEntry = path.relative(jobRoot, entryPath);
    if (relativeEntry.startsWith('..') || path.isAbsolute(relativeEntry)) {
      throw new Error('AI 生成的适配器入口超出隔离部署目录');
    }
    if (path.extname(entryPath).toLowerCase() !== '.mjs') {
      throw new Error('适配器入口必须是可审查的 .mjs 文件');
    }
    await fs.access(entryPath);

    await saveMcpPlugin({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      command: process.execPath,
      args: [entryPath],
      env: manifest.env,
      enabled: false,
      source: 'custom',
      risk: manifest.risk,
      iconKind: input.iconKind,
      iconUrl: input.iconUrl || '',
    });
    logIntegrationJob(job, `适配器已保存，正在执行 MCP initialize 与 tools/list 检测 | plugin=${manifest.id}`);
    const discovered = await discoverMcpPlugin(manifest.id, {
      initializeTimeoutMs: 30_000,
      listToolsTimeoutMs: 30_000,
    });
    if (discovered.status !== 'ready' || !discovered.tools.length) {
      await removeMcpPlugin(manifest.id);
      throw new Error(discovered.error || '适配器没有发现可用 MCP 工具');
    }
    job.message = 'MCP 工具检测成功，正在注册并启用插件';
    job.updatedAt = new Date().toISOString();
    logIntegrationJob(job, `检测到 ${discovered.tools.length} 个工具，正在启用插件 | plugin=${manifest.id}`);
    await setMcpPluginEnabled(manifest.id, true);
    job.status = 'success';
    job.pluginId = manifest.id;
    job.message = `“${manifest.name}”已完成部署、检测并启用`;
    logIntegrationJob(job, `部署完成并已启用 | plugin=${manifest.id} | tools=${discovered.tools.length}`);
  } catch (error) {
    job.status = 'error';
    job.message = (error as Error).message || '后台部署失败';
    logger.error(`[McpIntegration:${job.id}] ${job.projectName} | 部署失败`, error);
  } finally {
    job.updatedAt = new Date().toISOString();
  }
}

function extractJsonObject(text: string): Record<string, unknown> {
  const normalized = String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(normalized) as Record<string, unknown>;
  } catch {
    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(normalized.slice(start, end + 1)) as Record<string, unknown>;
    throw new Error('AI 没有返回可解析的接入评估');
  }
}

router.post('/analyze-project', async (req, res) => {
  try {
    const project = projectAnalysisSchema.parse(req.body || {});
    const prompt = [
      '你是 Scholar Harness 的第三方项目接入审查员。只做静态分析和接入规划，不执行命令、不下载、不修改文件。',
      `项目：${project.name}`,
      `项目来源：${project.url}`,
      `简介：${project.description || '无'}`,
      `已有安装/检测问题：${project.installationIssue || '无，属于首次接入'}`,
      '判断该项目怎样通过一个本地 stdio MCP 适配层供论文写作 AI 调用。',
      '必须考虑：真正可暴露的工具、输入输出、安装依赖、许可证、网络/文件/命令风险、密钥、Windows 兼容性、隔离目录、健康检查和失败回滚。',
      '只返回 JSON：{"summary":"","feasible":true,"strategy":"","tools":[{"name":"","purpose":""}],"dependencies":[],"requiredEnv":[],"risks":[],"steps":[],"verification":[]}',
      '不能确认的内容明确写“需读取仓库后确认”，禁止编造命令、包名、许可证或 API。',
    ].join('\n');
    const output = await chatBridge.chat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 2200,
      codexTimeoutMs: -1,
    });
    res.json({ success: true, analysis: extractJsonObject(output), project });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 502;
    res.status(status).json({ success: false, error: (error as Error).message });
  }
});

router.post('/integration-jobs', async (req, res) => {
  try {
    const input = integrationJobSchema.parse(req.body || {});
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const job: IntegrationJob = {
      id,
      status: 'queued',
      projectName: input.name,
      message: '部署任务已加入后台队列',
      createdAt: now,
      updatedAt: now,
    };
    integrationJobs.set(id, job);
    logIntegrationJob(job, '部署任务已加入后台队列');
    setImmediate(() => void runIntegrationJob(job, input));
    res.status(202).json({ success: true, job: publicIntegrationJob(job) });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ success: false, error: (error as Error).message });
  }
});

router.get('/integration-jobs/:jobId', (req, res) => {
  const job = integrationJobs.get(String(req.params.jobId || ''));
  if (!job) {
    res.status(404).json({ success: false, error: '部署任务不存在或本地服务已经重启' });
    return;
  }
  res.json({ success: true, job: publicIntegrationJob(job) });
});

router.get('/marketplace-config', async (_req, res) => {
  try {
    res.json({ success: true, config: await getMcpMarketplaceConfigStatus() });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.post('/marketplace-config', async (req, res) => {
  try {
    res.json({ success: true, config: await saveMcpMarketplaceConfig(req.body || {}) });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ success: false, error: (error as Error).message });
  }
});

router.get('/marketplace', async (req, res) => {
  try {
    const query = z.string().max(120).catch('').parse(req.query.q);
    const result = await searchMcpPluginMarketplace(query);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(502).json({ success: false, error: (error as Error).message });
  }
});

router.get('/', async (_req, res) => {
  try {
    res.json({ success: true, plugins: await listMcpPlugins() });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.post('/', async (req, res) => {
  try {
    const plugin = await saveMcpPlugin(req.body || {});
    res.json({ success: true, plugin });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ success: false, error: (error as Error).message });
  }
});

router.post('/:id/toggle', async (req, res) => {
  try {
    const id = idSchema.parse(req.params.id);
    const body = toggleSchema.parse(req.body || {});
    res.json({ success: true, plugin: await setMcpPluginEnabled(id, body.enabled) });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ success: false, error: (error as Error).message });
  }
});

router.post('/:id/discover', async (req, res) => {
  try {
    const id = idSchema.parse(req.params.id);
    const plugin = await discoverMcpPlugin(id);
    res.status(plugin.status === 'ready' ? 200 : 422).json({
      success: plugin.status === 'ready',
      plugin,
      error: plugin.error || undefined,
    });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ success: false, error: (error as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = idSchema.parse(req.params.id);
    const removed = await removeMcpPlugin(id);
    res.status(removed ? 200 : 404).json({
      success: removed,
      error: removed ? undefined : '插件不存在',
    });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ success: false, error: (error as Error).message });
  }
});

export default router;
