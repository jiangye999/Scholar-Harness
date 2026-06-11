/**
 * 实验结果上传和分析路由
 * 
 * 功能：
 * 1. 支持上传图片、表格、PDF、Word、截图等实验结果文件
 * 2. 默认使用 Codex CLI 进行结构化信息提取，不可用时降级到小牛马/大牛马 API
 * 3. 返回 JSON 格式的实验结果数据
 */

import { Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { logger } from '../../utils/logger';
import { getUserUploadDir, getMemoryDir, getDataDir } from '../../utils/paths';
import { extractPdfTextWithFastText } from '../../utils/pdf-fast-text';
import {
  analyzeExperimentResults,
  analyzeExperimentResultsWithCodex,
  type ExperimentAnalysisInput,
  type ExperimentAnalysisResult
} from '../services/experiment-analyzer';
import { chatBridge } from '../../bridge/chat-bridge/chat-bridge';
import { decrypt, isEncrypted } from '../../utils/encryption';
import { 
  loadUserMemory, 
  saveUserMemory, 
  saveMemoryToFiles, 
  generateStructuredSummaries,
  isKeyDeleted,
  autoRestoreDeletedKeyIfEmpty,
  type MemoryEntry 
} from './memory';

const router = Router();

interface AgentApiRuntimeConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  visionModel?: string;
}

function readUploadText(value: unknown, maxLength = 12000): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || '').trim().slice(0, maxLength);
}

function decryptConfigSecret(value?: string): string {
  if (!value) return '';
  try {
    return isEncrypted(value) ? decrypt(value) : value;
  } catch (error) {
    logger.warn('[ExperimentResults] Failed to decrypt saved API key, using raw value');
    return value;
  }
}

function readChatBridgeAgentConfigs(): { primary: AgentApiRuntimeConfig; secondary: AgentApiRuntimeConfig } {
  const defaults = {
    primary: {
      apiUrl: process.env.PRIMARY_API_URL || process.env.API_URL || '',
      apiKey: process.env.PRIMARY_API_KEY || process.env.API_KEY || '',
      model: process.env.PRIMARY_MODEL || 'claude-sonnet-4-5',
      visionModel: process.env.PRIMARY_VISION_MODEL || process.env.PRIMARY_MODEL || 'claude-sonnet-4-5',
    },
    secondary: {
      apiUrl: process.env.SECONDARY_API_URL || process.env.API_URL || '',
      apiKey: process.env.SECONDARY_API_KEY || process.env.API_KEY || '',
      model: process.env.SECONDARY_MODEL || 'gpt-4o',
      visionModel: process.env.SECONDARY_VISION_MODEL || process.env.SECONDARY_MODEL || 'gpt-4o',
    },
  };

  try {
    const configPath = path.join(getDataDir(), 'chat-bridge-config.json');
    const parsed = JSON.parse(fsSync.readFileSync(configPath, 'utf-8'));
    return {
      primary: {
        apiUrl: String(parsed.primary?.api_url || defaults.primary.apiUrl || '').trim().replace(/\/+$/, ''),
        apiKey: decryptConfigSecret(parsed.primary?.api_key) || defaults.primary.apiKey,
        model: String(parsed.primary?.model || defaults.primary.model || 'claude-sonnet-4-5'),
        visionModel: String(parsed.primary?.vision_model || parsed.primary?.model || defaults.primary.visionModel || defaults.primary.model || 'claude-sonnet-4-5'),
      },
      secondary: {
        apiUrl: String(parsed.secondary?.api_url || defaults.secondary.apiUrl || '').trim().replace(/\/+$/, ''),
        apiKey: decryptConfigSecret(parsed.secondary?.api_key) || defaults.secondary.apiKey,
        model: String(parsed.secondary?.model || defaults.secondary.model || 'gpt-4o'),
        visionModel: String(parsed.secondary?.vision_model || parsed.secondary?.model || defaults.secondary.visionModel || defaults.secondary.model || 'gpt-4o'),
      },
    };
  } catch {
    return defaults;
  }
}

function isUsableCodexAnalysisResult(result: ExperimentAnalysisResult): boolean {
  if (result.error) return false;
  if ((result.results?.length || 0) > 0) return true;
  const uncertainText = (result.overall_summary?.uncertain_items || []).join('\n');
  return !/(无法读取|无法处理|不可用|需要.*降级|需要.*API|请.*降级|cannot read|unavailable|fallback)/i.test(uncertainText);
}

function isImageExperimentFile(fileType: ExperimentAnalysisInput['fileType']): boolean {
  return fileType === 'image';
}

function modelForExperimentFile(provider: AgentApiRuntimeConfig, fileType: ExperimentAnalysisInput['fileType']): string {
  return isImageExperimentFile(fileType)
    ? (provider.visionModel || provider.model)
    : provider.model;
}

function buildMaterialPassport(input: {
  fileName: string;
  fileType: ExperimentAnalysisInput['fileType'];
  savedPath?: string;
  result: ExperimentAnalysisResult;
  extractionSource?: string;
  providers: { primary: AgentApiRuntimeConfig; secondary: AgentApiRuntimeConfig };
}): ExperimentAnalysisResult['materialPassport'] {
  const uncertainItems = input.result.overall_summary?.uncertain_items || [];
  const resultConfidences = (input.result.results || [])
    .map(item => item.confidence)
    .filter((value): value is 'high' | 'medium' | 'low' => value === 'high' || value === 'medium' || value === 'low');
  const hasLowConfidence = resultConfidences.includes('low') || uncertainItems.length > 0 || !!input.result.error;
  const hasHighConfidence = resultConfidences.length > 0 && resultConfidences.every(value => value === 'high');
  const confidence: 'high' | 'medium' | 'low' = hasLowConfidence ? 'low' : (hasHighConfidence ? 'high' : 'medium');
  const provider = input.result.analysisProvider || '';
  const visionModel = input.fileType === 'image'
    ? (provider.startsWith('secondary:')
        ? input.providers.secondary.visionModel
        : provider.startsWith('primary:')
          ? input.providers.primary.visionModel
          : input.providers.secondary.visionModel || input.providers.primary.visionModel)
    : undefined;
  const hasResults = (input.result.results?.length || 0) > 0;
  const linkedChapters = hasResults ? ['Results', 'Discussion'] : [];

  return {
    fileName: input.fileName,
    fileType: input.fileType,
    source: 'homepage-experiment-upload',
    savedPath: input.savedPath,
    analysisProvider: input.result.analysisProvider,
    visionModel,
    extractionSource: input.extractionSource,
    confidence,
    uncertainItems,
    includeInWriting: hasResults && !input.result.error,
    linkedChapters,
    createdAt: new Date().toISOString(),
  };
}

async function analyzeExperimentResultsWithDefaultFallback(input: ExperimentAnalysisInput, providers: {
  primary: AgentApiRuntimeConfig;
  secondary: AgentApiRuntimeConfig;
}): Promise<ExperimentAnalysisResult> {
  const attempts: string[] = [];

  const codexStatus = await chatBridge.getCodexCliStatus().catch(error => ({
    available: false,
    path: '',
    error: (error as Error).message,
  }));

  if (codexStatus.available) {
    const codexResult = await analyzeExperimentResultsWithCodex(input);
    if (isUsableCodexAnalysisResult(codexResult)) {
      return { ...codexResult, fallbackAttempts: attempts };
    }
    attempts.push(`Codex CLI: ${codexResult.error || '未得到可用分析结果'}`);
  } else {
    attempts.push(`Codex CLI: ${codexStatus.error || '不可用'}`);
  }

  if (providers.secondary.apiUrl && providers.secondary.apiKey) {
    const model = modelForExperimentFile(providers.secondary, input.fileType);
    const secondaryResult = await analyzeExperimentResults({
      ...input,
      apiUrl: providers.secondary.apiUrl,
      apiKey: providers.secondary.apiKey,
      model,
    });
    if (!secondaryResult.error) {
      return { ...secondaryResult, analysisProvider: `secondary:${model}`, fallbackAttempts: attempts };
    }
    attempts.push(`小牛马 API: ${secondaryResult.error}`);
  } else {
    attempts.push('小牛马 API: 未配置');
  }

  if (providers.primary.apiUrl && providers.primary.apiKey) {
    const model = modelForExperimentFile(providers.primary, input.fileType);
    const primaryResult = await analyzeExperimentResults({
      ...input,
      apiUrl: providers.primary.apiUrl,
      apiKey: providers.primary.apiKey,
      model,
    });
    if (!primaryResult.error) {
      return { ...primaryResult, analysisProvider: `primary:${model}`, fallbackAttempts: attempts };
    }
    attempts.push(`大牛马 API: ${primaryResult.error}`);
  } else {
    attempts.push('大牛马 API: 未配置');
  }

  return {
    fileName: input.fileName,
    fileType: input.fileType,
    paper_title: '',
    results: [],
    overall_summary: {
      main_findings: [],
      best_model_claims: [],
      ablation_findings: [],
      robustness_findings: [],
      efficiency_findings: [],
      uncertain_items: attempts,
    },
    fallbackAttempts: attempts,
    error: 'Codex CLI、小牛马 API、大牛马 API 均不可用或调用失败',
  };
}

// 配置 multer 存储 - 内存存储，适合处理图片和文档
const storage = multer.memoryStorage();

// 文件过滤器 - 支持图片、PDF、Word
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedExtensions = [
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp',  // 图片
    '.pdf',                                             // PDF
    '.doc', '.docx',                                    // Word
    '.xlsx', '.xls',                                    // Excel (表格)
    '.csv',                                             // CSV
    '.tiff', '.tif',                                    // TIFF 图片
    '.heic', '.heif',                                   // Apple 图片格式
    '.svg',                                             // SVG
    '.txt',                                             // 文本
    '.md',                                              // Markdown
  ];
  
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的文件类型: ${ext}。支持的格式: 图片(png/jpg/gif/bmp/webp/tiff), PDF, Word(doc/docx), Excel(xlsx/xls/csv), 文本(txt/md)`));
  }
};

// 配置上传 - 最大 50MB，最多 20 个文件
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,  // 50MB
    files: 20,                    // 最多20个文件
  },
  fileFilter,
});

/**
 * POST /api/experiment-results/upload
 * 上传实验结果文件并进行 AI 分析
 * 
 * 请求体:
 * - files: 多个文件 (multipart/form-data)
 * - userId: 用户 ID (可选，默认 'web-user')
 * - apiUrl: AI API 地址 (可选，使用服务器配置)
 * - apiKey: AI API Key (可选，使用服务器配置)
 * - model: AI 模型 (可选，默认使用配置的模型)
 * - userInstruction/userMessage/extraQuery: 用户在输入框中随文件提交的分析要求
 * 
 * 响应:
 * - success: boolean
 * - results: ExperimentAnalysisResult[] - 每个文件的分析结果
 * - combinedSummary: 所有结果的合并总结
 * - error: string (如果失败)
 */
router.post('/upload', upload.array('files', 20), async (req, res) => {
  try {
    const userId = req.body.userId || 'web-user';
    let apiUrl = req.body.apiUrl || '';
    let apiKey = req.body.apiKey || '';
    let model = req.body.model || '';
    let secondaryModel = req.body.secondaryModel || '';
    let secondaryVisionModel = req.body.secondaryVisionModel || '';
    const userInstruction = readUploadText(req.body.userInstruction || req.body.userMessage || req.body.extraQuery);
    const workflowIntent = readUploadText(req.body.workflowIntent, 2000);
    
    const files = req.files as Express.Multer.File[];
    
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: '请上传实验结果文件',
        results: [],
      });
    }
    
    logger.info(`[ExperimentResults] Processing ${files.length} files for user ${userId}${userInstruction ? ' with user instruction' : ''}`);
    
    const savedAgentConfigs = readChatBridgeAgentConfigs();
    const providers = {
      secondary: {
        apiUrl: String(apiUrl || savedAgentConfigs.secondary.apiUrl || '').trim().replace(/\/+$/, ''),
        apiKey: String(apiKey || savedAgentConfigs.secondary.apiKey || ''),
        model: String(secondaryModel || model || savedAgentConfigs.secondary.model || 'gpt-4o'),
        visionModel: String(secondaryVisionModel || savedAgentConfigs.secondary.visionModel || secondaryModel || model || savedAgentConfigs.secondary.model || 'gpt-4o'),
      },
      primary: savedAgentConfigs.primary,
    };
    
    // 保存上传的文件到用户目录（便于后续引用）
    const userDir = getUserUploadDir(userId);
    const experimentDir = path.join(userDir, 'experiment-results');
    
    // 确保目录存在
    await fs.mkdir(experimentDir, { recursive: true });
    
    // 处理每个文件
    const results: ExperimentAnalysisResult[] = [];
    const savedFiles: Array<{ originalName: string; savedPath: string; type: string }> = [];
    for (const file of files) {
      let fileType: 'image' | 'pdf' | 'word' | 'table' | 'text' | 'unknown' = 'unknown';
      let savedPath = '';

      try {
        const ext = path.extname(file.originalname).toLowerCase();
        const timestamp = Date.now();
        const savedName = `${timestamp}-${file.originalname}`;
        savedPath = path.join(experimentDir, savedName);
        
        // 保存文件
        await fs.writeFile(savedPath, file.buffer);
        
        // 确定文件类型
        if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tiff', '.tif', '.heic', '.heif', '.svg'].includes(ext)) {
          fileType = 'image';
        } else if (ext === '.pdf') {
          fileType = 'pdf';
        } else if (['.doc', '.docx'].includes(ext)) {
          fileType = 'word';
        } else if (['.xlsx', '.xls', '.csv'].includes(ext)) {
          fileType = 'table';
        } else if (['.txt', '.md'].includes(ext)) {
          fileType = 'text';
        }
        
        savedFiles.push({
          originalName: file.originalname,
          savedPath,
          type: fileType,
        });
        
        logger.info(`[ExperimentResults] Saved file: ${file.originalname} (${fileType}, ${file.buffer.length} bytes)`);

        let extractedText: string | undefined;
        let extractionSource: string | undefined;
        if (fileType === 'pdf') {
          const fastText = await extractPdfTextWithFastText(savedPath, {
            outputDir: path.join(experimentDir, 'pdf-fast-text'),
            label: file.originalname,
          });
          extractedText = fastText.text;
          extractionSource = 'pdf-marker-md 快速文本 PDF 解析结果';
        }
        
        // 调用 AI 分析服务：Codex CLI -> 小牛马 -> 大牛马
        const analysisResult = await analyzeExperimentResultsWithDefaultFallback({
          fileBuffer: file.buffer,
          fileName: file.originalname,
          fileType,
          apiUrl: providers.secondary.apiUrl,
          apiKey: providers.secondary.apiKey,
          model: providers.secondary.model,
          savedPath,
          extractedText,
          extractionSource,
          userInstruction,
        }, providers);
        
        const materialPassport = buildMaterialPassport({
          fileName: file.originalname,
          fileType,
          savedPath,
          result: analysisResult,
          extractionSource,
          providers,
        });

        results.push({
          ...analysisResult,
          savedPath,
          materialPassport,
        });
        
      } catch (fileError) {
        logger.error(`[ExperimentResults] Failed to process file ${file.originalname}:`, fileError);
        results.push({
          fileName: file.originalname,
          fileType,
          savedPath,
          materialPassport: {
            fileName: file.originalname,
            fileType,
            source: 'homepage-experiment-upload',
            savedPath,
            confidence: 'low',
            uncertainItems: [`文件处理失败: ${(fileError as Error).message}`],
            includeInWriting: false,
            linkedChapters: [],
            createdAt: new Date().toISOString(),
          },
          paper_title: '',
          results: [],
          overall_summary: {
            main_findings: [],
            best_model_claims: [],
            ablation_findings: [],
            robustness_findings: [],
            efficiency_findings: [],
            uncertain_items: [`文件处理失败: ${(fileError as Error).message}`],
          },
          error: (fileError as Error).message,
        });
      }
    }
    
    // 合并所有结果的总结
    const combinedSummary = combineAnalysisResults(results);
    
    logger.info(`[ExperimentResults] Completed analysis for ${files.length} files, ${results.length} results`);
    
    // ========== 关键修复：将分析结果写入 Memory ==========
    // 上传图片后的分析结果也需要更新到 data_summary
    try {
      const memoryDir = getMemoryDir();
      const memory = await loadUserMemory(userId);
      
      // 构建分析结果的文本描述
      const analysisTextParts: string[] = [];

      if (userInstruction) {
        analysisTextParts.push(`【用户随实验资料提交的要求】\n${userInstruction}`);
      }
      
      // 1. 整体总结（combinedSummary 直接包含 main_findings 等字段）
      const summaryLines: string[] = [];
      if (combinedSummary.main_findings?.length > 0) {
        summaryLines.push('主要发现：');
        combinedSummary.main_findings.forEach((f: string) => summaryLines.push(`  - ${f}`));
      }
      if (combinedSummary.best_model_claims?.length > 0) {
        summaryLines.push('最佳模型结果：');
        combinedSummary.best_model_claims.forEach((c: string) => summaryLines.push(`  - ${c}`));
      }
      if (summaryLines.length > 0) {
        analysisTextParts.push(`【${files.length}个实验结果文件分析总结】\n${summaryLines.join('\n')}`);
      }
      
      // 2. 每个文件的详细结果
      for (const result of results) {
        if (result.results && result.results.length > 0) {
          const fileLines: string[] = [];
          fileLines.push(`文件：${result.fileName}`);
          
          // 提取数值型结果
          for (const r of result.results) {
            if (r.metric_value && r.metric_name) {
              const metricLine = `${r.metric_name}: ${r.metric_value}${r.unit || ''}`;
              if (r.model_name) {
                fileLines.push(`  ${r.model_name} - ${metricLine}`);
              } else {
                fileLines.push(`  ${metricLine}`);
              }
            }
          }
          
          if (fileLines.length > 1) {
            analysisTextParts.push(fileLines.join('\n'));
          }
        }
        
        // 添加不确定性说明
        if (result.overall_summary?.uncertain_items?.length > 0) {
          analysisTextParts.push(`注意：${result.overall_summary.uncertain_items.join('; ')}`);
        }
      }
      
      const analysisText = analysisTextParts.join('\n\n');
      
      // 更新 data_summary（数值型结果）
      if (analysisText.length > 50) {
        // ========== Bug fix: 检查 deletedKeys ==========
        autoRestoreDeletedKeyIfEmpty(memory, 'data_summary');
        
        if (isKeyDeleted(memory, 'data_summary')) {
          logger.info(`[ExperimentResults] SKIP "data_summary" - user has deleted this key`);
        } else {
          const existingDataSummary = memory.entries.find(e => e.key === 'data_summary');
          
          // 检查是否已存在相同内容
          const isDuplicate = existingDataSummary?.value?.includes(analysisText.substring(0, 100));
          
          if (!isDuplicate) {
            const newDataValue = existingDataSummary?.value 
              ? existingDataSummary.value + '\n\n---\n\n' + analysisText
              : analysisText;
            
            const newDataEntry: MemoryEntry = {
              key: 'data_summary',
              value: newDataValue,
              source: 'experiment-results-upload',
              timestamp: new Date().toISOString()
            };
            
            const existingIndex = memory.entries.findIndex(e => e.key === 'data_summary');
            if (existingIndex >= 0) {
              memory.entries[existingIndex] = newDataEntry;
            } else {
              memory.entries.push(newDataEntry);
            }
            
            logger.info(`[ExperimentResults] Updated data_summary with analysis results (${analysisText.length} chars)`);
          } else {
            logger.info(`[ExperimentResults] Skip duplicate content in data_summary`);
          }
          
          // 保存 memory
          memory.updatedAt = new Date().toISOString();
          await saveUserMemory(memory);
          
          // 写入具体文件
          await saveMemoryToFiles(userId, memory);
          
          // 触发结构化总结生成（后台异步，使用用户配置的小牛马模型）
          if (providers.secondary.apiUrl && providers.secondary.apiKey) {
            const effectiveSecondaryModel = providers.secondary.model || process.env.SECONDARY_MODEL || 'gpt-4o-mini';
            generateStructuredSummaries(userId, memory.entries, providers.secondary.apiUrl, providers.secondary.apiKey, effectiveSecondaryModel).catch(e => {
              logger.warn('[ExperimentResults] Failed to generate structured summaries:', e);
            });
            logger.info(`[ExperimentResults] Triggered structured summary generation (SecondaryAgent model: ${effectiveSecondaryModel})`);
          }
        }
      }
      
    } catch (memoryError) {
      logger.warn('[ExperimentResults] Failed to update memory:', memoryError);
      // 不影响主流程，继续返回结果
    }
    
    res.json({
      success: true,
      results,
      combinedSummary,
      savedFiles: savedFiles.map(f => ({ name: f.originalName, type: f.type })),
      userInstruction,
      workflowIntent,
    });
    
  } catch (error) {
    logger.error('[ExperimentResults] Upload error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
      results: [],
    });
  }
});

/**
 * GET /api/experiment-results/:userId
 * 获取用户上传的实验结果文件列表
 */
router.get('/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const userDir = getUserUploadDir(userId);
    const experimentDir = path.join(userDir, 'experiment-results');
    
    // 检查目录是否存在
    try {
      await fs.access(experimentDir);
    } catch {
      return res.json({
        success: true,
        files: [],
        message: '暂无上传的实验结果文件',
      });
    }
    
    // 读取目录中的文件
    const files = await fs.readdir(experimentDir);
    const fileInfos: Array<{ name: string; type: string; size: number; uploadTime: string }> = [];
    
    for (const fileName of files) {
      const filePath = path.join(experimentDir, fileName);
      const stats = await fs.stat(filePath);
      const ext = path.extname(fileName).toLowerCase();
      
      let type = 'unknown';
      if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext)) type = 'image';
      else if (ext === '.pdf') type = 'pdf';
      else if (['.doc', '.docx'].includes(ext)) type = 'word';
      else if (['.xlsx', '.xls', '.csv'].includes(ext)) type = 'table';
      
      // 从文件名中提取上传时间（格式: timestamp-originalname）
      const timestampMatch = fileName.match(/^(\d+)-/);
      const uploadTime = timestampMatch 
        ? new Date(parseInt(timestampMatch[1])).toISOString()
        : stats.mtime.toISOString();
      
      fileInfos.push({
        name: fileName.replace(/^\d+-/, ''),  // 移除时间戳前缀
        type,
        size: stats.size,
        uploadTime,
      });
    }
    
    res.json({
      success: true,
      files: fileInfos,
    });
    
  } catch (error) {
    logger.error('[ExperimentResults] Get files error:', error);
    res.json({
      success: false,
      files: [],
      error: (error as Error).message,
    });
  }
});

/**
 * DELETE /api/experiment-results/:userId/:fileName
 * 删除指定的实验结果文件
 */
router.delete('/:userId/:fileName', async (req, res) => {
  try {
    const { userId, fileName } = req.params;
    const userDir = getUserUploadDir(userId);
    const experimentDir = path.join(userDir, 'experiment-results');
    
    // 查找匹配的文件（考虑时间戳前缀）
    const files = await fs.readdir(experimentDir);
    const matchingFile = files.find(f => f.endsWith(`-${fileName}`) || f === fileName);
    
    if (!matchingFile) {
      return res.status(404).json({
        success: false,
        error: '文件不存在',
      });
    }
    
    const filePath = path.join(experimentDir, matchingFile);
    await fs.unlink(filePath);
    
    logger.info(`[ExperimentResults] Deleted file: ${fileName} for user ${userId}`);
    
    res.json({
      success: true,
      message: '文件已删除',
    });
    
  } catch (error) {
    logger.error('[ExperimentResults] Delete file error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * 合合多个分析结果
 */
function combineAnalysisResults(results: ExperimentAnalysisResult[]): {
  main_findings: string[];
  best_model_claims: string[];
  ablation_findings: string[];
  robustness_findings: string[];
  efficiency_findings: string[];
  uncertain_items: string[];
  totalResultsCount: number;
} {
  const combined = {
    main_findings: [] as string[],
    best_model_claims: [] as string[],
    ablation_findings: [] as string[],
    robustness_findings: [] as string[],
    efficiency_findings: [] as string[],
    uncertain_items: [] as string[],
    totalResultsCount: 0,
  };
  
  for (const result of results) {
    if (result.overall_summary) {
      combined.main_findings.push(...result.overall_summary.main_findings || []);
      combined.best_model_claims.push(...result.overall_summary.best_model_claims || []);
      combined.ablation_findings.push(...result.overall_summary.ablation_findings || []);
      combined.robustness_findings.push(...result.overall_summary.robustness_findings || []);
      combined.efficiency_findings.push(...result.overall_summary.efficiency_findings || []);
      combined.uncertain_items.push(...result.overall_summary.uncertain_items || []);
    }
    combined.totalResultsCount += result.results?.length || 0;
  }
  
  // 去重
  combined.main_findings = [...new Set(combined.main_findings)];
  combined.best_model_claims = [...new Set(combined.best_model_claims)];
  combined.ablation_findings = [...new Set(combined.ablation_findings)];
  combined.robustness_findings = [...new Set(combined.robustness_findings)];
  combined.efficiency_findings = [...new Set(combined.efficiency_findings)];
  
  return combined;
}

export default router;
