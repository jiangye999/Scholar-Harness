import "dotenv/config";
import express, { Request, Response, Express } from "express";
import { logger } from "../utils/logger";
import { SessionStore } from "../storage/session-store";
import * as path from "path";
import * as fs from "fs";
import multer from "multer";
import type { ChatOptions, Message } from "../types";
import { FeishuHandler } from "../messaging/feishu-handler";
import { FeishuWebSocketClient } from "../messaging/feishu-websocket";
import { ConversationFlow } from "../../workflows/conversation-flow";

// 找到项目根目录（包含 data 文件夹的目录）
function findProjectRoot(): string {
  // 首先尝试 process.cwd()（启动目录）
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "data"))) {
    return cwd;
  }
  
  // 尝试从 __dirname 向上查找
  let currentDir = __dirname;
  for (let i = 0; i < 5; i++) {
    const parentDir = path.dirname(currentDir);
    if (fs.existsSync(path.join(parentDir, "data"))) {
      return parentDir;
    }
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  
  // 默认使用 cwd
  return cwd;
}

const projectRoot = findProjectRoot();
const dataDir = path.join(projectRoot, "data");
const publicDir = path.join(projectRoot, "src", "public");
logger.info(`[Startup] projectRoot=${projectRoot}`);
logger.info(`[Startup] dataDir=${dataDir}`);
logger.info(`[Startup] __dirname=${__dirname}`);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const uploadDir = path.join(dataDir, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const sessionStore = new SessionStore(path.join(dataDir, "sessions"));

const memoryDir = path.join(dataDir, "memory");
if (!fs.existsSync(memoryDir)) {
  fs.mkdirSync(memoryDir, { recursive: true });
}

interface MemoryEntry {
  key: string;
  value: string;
  source: string;
  timestamp: string;
}

interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

interface Conversation {
  id: string;
  userId: string;
  messages: ConversationMessage[];
  summary: string;
  keyTopics: string[];
  createdAt: string;
  updatedAt: string;
}

interface ConversationSummary {
  id: string;
  title: string;
  summary: string;
  keyTopics: string[];
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface UserMemory {
  userId: string;
  entries: MemoryEntry[];
  conversations: ConversationSummary[];
  updatedAt: string;
}

interface IdMapping {
  [feishuUnionId: string]: string;
}

const idMappingFile = path.join(dataDir, "id-mappings.json");

function loadIdMappings(): IdMapping {
  try {
    if (fs.existsSync(idMappingFile)) {
      return JSON.parse(fs.readFileSync(idMappingFile, 'utf-8'));
    }
  } catch (e) {
    logger.warn("[IDMapping] Failed to load ID mappings:", e);
  }
  return {};
}

function saveIdMappings(mappings: IdMapping): void {
  fs.writeFileSync(idMappingFile, JSON.stringify(mappings, null, 2), 'utf-8');
  logger.info("[IDMapping] Saved ID mappings");
}

function getUnifiedUserId(feishuId: string): string {
  return "web-user";
}

function isFeishuUserId(userId: string): boolean {
  return userId.startsWith('ou_') || userId.startsWith('cu_') || userId.startsWith('on_');
}

function isAnthropicModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes('minimax-m2.7') || m.includes('claude') || m.includes('anthropic');
}

interface LLMResponse {
  content: string;
  thinking?: string;
}

async function callLLM(
  apiUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  temperature?: number,
  maxTokens?: number
): Promise<LLMResponse> {
  const useAnthropic = isAnthropicModel(model);
  
  if (useAnthropic) {
    const response = await fetch(apiUrl + "/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model,
        messages: messages.map(m => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content
        })),
        temperature: temperature || 0.7,
        max_tokens: maxTokens || 4096,
      }),
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API 错误 (${response.status}): ${errText}`);
    }
    
    const data = await response.json() as {
      content?: Array<{ type: string; text?: string; thinking?: string }>;
    };
    
    let content = "";
    let thinking: string | undefined;
    
    if (data.content) {
      for (const block of data.content) {
        if (block.type === "text" && block.text) {
          content += block.text;
        } else if (block.type === "thinking" && block.thinking) {
          thinking = block.thinking;
        }
      }
    }
    
    return { content, thinking };
  } else {
    const response = await fetch(apiUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: temperature || 0.7,
        max_tokens: maxTokens || 4096,
      }),
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API 错误 (${response.status}): ${errText}`);
    }
    
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return { content: data.choices?.[0]?.message?.content || "" };
  }
}

// APIClient 实现
function createAPIClient(apiUrl: string, apiKey: string) {
  return {
    async chat(options: { model: string; messages: Message[]; temperature?: number; maxTokens?: number }): Promise<string> {
      const result = await callLLM(apiUrl, apiKey, options.model, options.messages, options.temperature, options.maxTokens);
      return result.content;
    }
  };
}

function getMemoryFile(userId: string): string {
  const unifiedId = isFeishuUserId(userId) ? getUnifiedUserId(userId) : userId;
  const userMemoryDir = path.join(memoryDir, unifiedId);
  if (!fs.existsSync(userMemoryDir)) {
    fs.mkdirSync(userMemoryDir, { recursive: true });
  }
  const memoryFile = path.join(userMemoryDir, "memory.json");
  logger.info(`[getMemoryFile] userId=${userId}, unifiedId=${unifiedId}, file=${memoryFile}, exists=${fs.existsSync(memoryFile)}`);
  return memoryFile;
}

function getConversationFile(userId: string, conversationId: string): string {
  const unifiedId = isFeishuUserId(userId) ? getUnifiedUserId(userId) : userId;
  const conversationsDir = path.join(memoryDir, unifiedId, "conversations");
  if (!fs.existsSync(conversationsDir)) {
    fs.mkdirSync(conversationsDir, { recursive: true });
  }
  return path.join(conversationsDir, `${conversationId}.json`);
}

function loadUserMemory(userId: string): UserMemory {
  const memoryFile = getMemoryFile(userId);
  if (fs.existsSync(memoryFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(memoryFile, 'utf-8'));
      const unifiedId = isFeishuUserId(userId) ? getUnifiedUserId(userId) : userId;
      return {
        userId: unifiedId,
        entries: data.entries || [],
        conversations: data.conversations || [],
        updatedAt: data.updatedAt || new Date().toISOString()
      };
    } catch (e) {
      logger.warn("[Memory] Failed to load memory:", e);
    }
  }
  const unifiedId = isFeishuUserId(userId) ? getUnifiedUserId(userId) : userId;
  return { userId: unifiedId, entries: [], conversations: [], updatedAt: new Date().toISOString() };
}

function saveUserMemory(memory: UserMemory): void {
  const memoryFile = getMemoryFile(memory.userId);
  memory.updatedAt = new Date().toISOString();
  fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2), 'utf-8');
}

function loadConversation(userId: string, conversationId: string): Conversation | null {
  const conversationFile = getConversationFile(userId, conversationId);
  if (fs.existsSync(conversationFile)) {
    try {
      return JSON.parse(fs.readFileSync(conversationFile, 'utf-8'));
    } catch (e) {
      logger.warn("[Memory] Failed to load conversation:", e);
    }
  }
  return null;
}

function saveConversation(conversation: Conversation): void {
  const unifiedId = isFeishuUserId(conversation.userId) ? getUnifiedUserId(conversation.userId) : conversation.userId;
  const conversationFile = getConversationFile(unifiedId, conversation.id);
  conversation.updatedAt = new Date().toISOString();
  conversation.userId = unifiedId;
  fs.writeFileSync(conversationFile, JSON.stringify(conversation, null, 2), 'utf-8');
}

function getUserDir(userId: string): string {
  const unifiedId = isFeishuUserId(userId) ? getUnifiedUserId(userId) : userId;
  const userDir = path.join(uploadDir, unifiedId);
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  return userDir;
}

function searchConversations(userId: string, query: string): ConversationSummary[] {
  const memory = loadUserMemory(userId);
  const queryLower = query.toLowerCase();
  
  return memory.conversations.filter(conv => {
    if (conv.title.toLowerCase().includes(queryLower)) return true;
    if (conv.summary.toLowerCase().includes(queryLower)) return true;
    if (conv.keyTopics.some(topic => topic.toLowerCase().includes(queryLower))) return true;
    return false;
  });
}

function extractKeyInfo(userMessage: string, aiResponse: string, history: Array<{ role: string; content: string }>): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  
  const combinedText = `用户问题: ${userMessage}\n\nAI回复: ${aiResponse}`;
  
  const yearMatch = combinedText.match(/(20\d{2})/g);
  if (yearMatch) {
    const years = [...new Set(yearMatch)];
    entries.push({
      key: "years_mentioned",
      value: years.join(", "),
      source: "auto-extracted",
      timestamp: new Date().toISOString()
    });
  }
  
  const journalMatch = combinedText.match(/期刊[:\s]+([^，。,\n]+)/g);
  if (journalMatch) {
    const journals = [...new Set(journalMatch.map(m => m.replace(/期刊[:\s]+/, '').trim()))];
    entries.push({
      key: "journals_mentioned",
      value: journals.join(", "),
      source: "auto-extracted",
      timestamp: new Date().toISOString()
    });
  }
  
  const topicMatch = userMessage.match(/(?:关于|研究|探讨|分析)([^，。,\n]+)/);
  if (topicMatch) {
    entries.push({
      key: "research_topic",
      value: topicMatch[1].trim(),
      source: "user-message",
      timestamp: new Date().toISOString()
    });
  }
  
  return entries;
}

function safeMergeSummary(existing: string, incoming: string): string {
  if (!existing || existing.trim().length === 0) {
    return incoming;
  }
  if (!incoming || incoming.trim().length === 0) {
    return existing;
  }
  
  const existingSentences = existing.split(/[。！？.!?]+/).filter(s => s.trim().length > 5);
  const incomingSentences = incoming.split(/[。！？.!?]+/).filter(s => s.trim().length > 5);
  
  const existingSet = new Set(existingSentences.map(s => s.trim().toLowerCase()));
  const newSentences: string[] = [];
  
  for (const sent of incomingSentences) {
    const normalized = sent.trim().toLowerCase();
    let isDuplicate = false;
    
    for (const existing of existingSet) {
      if (existing.includes(normalized) || normalized.includes(existing)) {
        isDuplicate = true;
        break;
      }
      const shorterLen = Math.min(existing.length, normalized.length);
      if (shorterLen > 20) {
        const overlap = calculateTextOverlap(existing, normalized);
        if (overlap > 0.7) {
          isDuplicate = true;
          break;
        }
      }
    }
    
    if (!isDuplicate) {
      newSentences.push(sent.trim());
    }
  }
  
  if (newSentences.length === 0) {
    return existing;
  }
  
  return existing.trim() + ' ' + newSentences.join('。') + '。';
}

function calculateTextOverlap(text1: string, text2: string): number {
  const words1 = text1.split(/\s+/);
  const words2 = text2.split(/\s+/);
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  
  let intersection = 0;
  for (const word of set1) {
    if (set2.has(word)) intersection++;
  }
  
  const union = set1.size + set2.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function isLikelyFallback(content: string, originalMessage: string): boolean {
  if (!content) return true;
  if (content.length < 20) return true;
  if (content === originalMessage.substring(0, 2000)) return true;
  if (content.includes("抱歉") || content.includes("错误") || content.includes("失败")) return true;
  return false;
}

async function updateMemoryWithAI(userId: string, conversationId: string, userMessage: string, aiResponse: string, history: Array<{ role: string; content: string }>, apiUrl: string, apiKey: string, model: string): Promise<void> {
  const memory = loadUserMemory(userId);
  
  // 获取现有的记忆内容（用于智能合并）
  const existingExperimentSummary = memory.entries.find(e => e.key === 'experiment_summary')?.value || '';
  const existingDataSummary = memory.entries.find(e => e.key === 'data_summary')?.value || '';
  const existingWritingProgress = memory.entries.find(e => e.key === 'writing_progress')?.value || '';
  const existingCompletedChapters = memory.entries.find(e => e.key === 'completed_chapters')?.value || '';
  
  const extractPrompt = `请分析以下对话，提取关键研究信息和写作进度。

【用户消息】
${userMessage.substring(0, 1500)}

【AI 回复】
${aiResponse.substring(0, 2500)}

【输出格式 - 请严格按以下格式返回】
研究主题：[一句话概括]
目标期刊：[期刊名称]
关键概念：[关键词 1, 关键词 2]
重要发现：[发现 1；发现 2]
实验设计：[设计概述]
数据状态：[有/无]
用户偏好：[特殊要求]
实验资料总结：[从对话中提取所有实验背景、目的、方法、结果、结论等信息，写成一段话]
数据详细总结：[从对话中提取所有数据、统计结果、对比分析等，写成一段话]
写作进度：[描述当前写作进展，如"已完成引言和方法，正在写结果部分"或"尚未开始写作"]
已完成章节：[列出已完成的章节名称及其核心内容摘要，每个章节 50 字以内，用分号分隔]
待完成章节：[列出待完成的章节名称及写作重点，用分号分隔]

【重要】
- 实验资料总结和数据详细总结必须填写
- 写作进度、已完成章节、待完成章节：如果有相关对话内容则填写，没有则填"无"
- 直接写成连贯的文字段落，不要分点
- 保留所有具体数值`;

  // 智能合并提示词：用于将新提取的内容与现有记忆合并
  const mergePrompt = (existingMemory: string, newExtract: string, fieldName: string) => {
    return `你是一个研究数据管理助手。你的任务是将新对话中提取的信息与现有的记忆进行智能合并。

## 现有记忆
${existingMemory ? existingMemory : '（暂无现有记忆）'}

## 新对话中提取的信息
${newExtract}

## 你的任务
请将上述两部分信息合并成一个完整、简洁的"${fieldName}"。

## 合并原则
1. **去重**：如果新信息与现有记忆重复，保留一份即可，不要重复
2. **补充**：如果新信息是现有记忆的补充（新的实验细节、新的数据等），将其自然融入到现有内容中
3. **更新**：如果新信息与现有记忆冲突（如修正了之前的数据），以新信息为准
4. **简洁**：合并后的内容应该简洁连贯，不要有冗余的过渡语句
5. **完整**：确保所有重要信息都被保留，形成一个完整的${fieldName}

## 输出要求
- 输出一个连贯的文字段落
- 不要使用"新增"、"补充"、"更新"等过渡词
- 直接输出合并后的完整内容，不要解释
- 保留所有具体数值和关键细节

## 输出格式
直接输出合并后的完整${fieldName}内容，不要有其他文字。`;
  };
  
  // 写作进度合并提示词
  const mergeWritingProgressPrompt = (existingProgress: string, newProgress: string) => {
    return `你是一个写作进度管理助手。请合并以下写作进度信息：

## 现有进度
${existingProgress}

## 新进度
${newProgress}

## 合并要求
1. 如果有新完成的章节，更新进度
2. 保持简洁，只描述当前整体进展状态
3. 不要重复信息
4. 输出一个连贯的进度描述

直接输出合并后的写作进度，不要其他文字。`;
  };
  
  // 已完成章节合并提示词
  const mergeChaptersPrompt = (existingChapters: string, newChapters: string) => {
    return `你是一个论文章节管理助手。请合并以下已完成章节信息：

## 现有已完成章节
${existingChapters}

## 新增已完成章节
${newChapters}

## 合并要求
1. 去重：如果章节已存在，更新其内容摘要
2. 补充：新完成的章节添加到列表中
3. 保持简洁：每个章节 50 字以内
4. 格式：章节名：内容摘要；章节名：内容摘要

直接输出合并后的章节列表，不要其他文字。`;
  };

  try {
    logger.info("[Memory] Extracting key info from conversation...");
    const result = await callLLM(apiUrl, apiKey, model, [
      { role: "system", content: extractPrompt },
      { role: "user", content: "请分析上述对话并提取关键信息。" }
    ], 0.3, 2500);
    
    let extracted: any = {};
    let content = result.content;
    
    logger.info("[Memory] AI extraction response:");
    logger.info("Content preview:", content.substring(0, 500));
    logger.info("Full content length:", content.length);
    
    try {
      extracted = parseExtractedContent(content);
      
      logger.info("[Memory] Parsed research_topic:", extracted.research_topic ? "✓" : "✗");
      logger.info("[Memory] Parsed experiment_summary:", extracted.experiment_summary ? "✓ (" + extracted.experiment_summary.length + " chars)" : "✗");
      logger.info("[Memory] Parsed data_summary:", extracted.data_summary ? "✓ (" + extracted.data_summary.length + " chars)" : "✗");
    } catch (e) {
      logger.warn("[Memory] Failed to parse extracted info:", e);
      logger.warn("[Memory] Content was:", content.substring(0, 300));
    }
    
    // 安全增量合并逻辑：提取失败时不应直接覆盖
    const experimentExtractionFailed = !extracted.experiment_summary || extracted.experiment_summary.length < 10;
    const dataExtractionFailed = !extracted.data_summary || extracted.data_summary.length < 10;
    
    if (experimentExtractionFailed) {
      if (existingExperimentSummary) {
        logger.warn("[Memory] ⚠️ experiment_summary 提取失败，但存在旧值，跳过更新（保留旧值）");
        logger.warn("[Memory] Fallback 被拒绝，旧值长度:", existingExperimentSummary.length);
        extracted.experiment_summary = existingExperimentSummary;
      } else {
        const fallbackContent = aiResponse.substring(0, 2000);
        if (!isLikelyFallback(fallbackContent, aiResponse)) {
          logger.info("[Memory] experiment_summary 提取失败且无旧值，使用 aiResponse fallback");
          extracted.experiment_summary = fallbackContent;
        } else {
          logger.warn("[Memory] ⚠️ experiment_summary 提取失败，且 fallback 内容不可靠，跳过保存");
          extracted.experiment_summary = "";
        }
      }
    }
    
    if (dataExtractionFailed) {
      if (existingDataSummary) {
        logger.warn("[Memory] ⚠️ data_summary 提取失败，但存在旧值，跳过更新（保留旧值）");
        logger.warn("[Memory] Fallback 被拒绝，旧值长度:", existingDataSummary.length);
        extracted.data_summary = existingDataSummary;
      } else {
        const fallbackContent = userMessage.substring(0, 2000);
        if (!isLikelyFallback(fallbackContent, userMessage)) {
          logger.info("[Memory] data_summary 提取失败且无旧值，使用 userMessage fallback");
          extracted.data_summary = fallbackContent;
        } else {
          logger.warn("[Memory] ⚠️ data_summary 提取失败，且 fallback 内容不可靠，跳过保存");
          extracted.data_summary = "";
        }
      }
    }
    
    // 使用 safeMergeSummary 进行代码层合并（作为 LLM 合并的安全补充）
    if (existingExperimentSummary && extracted.experiment_summary && extracted.experiment_summary !== existingExperimentSummary) {
      const oldLen = existingExperimentSummary.length;
      const newLen = extracted.experiment_summary.length;
      const merged = safeMergeSummary(existingExperimentSummary, extracted.experiment_summary);
      const mergedLen = merged.length;
      
      logger.info(`[Memory] safeMergeSummary: experiment_summary 合并前旧=${oldLen}, 新=${newLen}, 合并后=${mergedLen}`);
      
      if (mergedLen > oldLen + 10) {
        logger.info("[Memory] ✓ 检测到新增内容，将使用合并结果");
        extracted.experiment_summary = merged;
      } else if (mergedLen < oldLen - 50) {
        logger.warn("[Memory] ⚠️ 合并后反而变短，可能丢失内容，保留 LLM 合并结果");
      } else {
        logger.info("[Memory] 未检测到显著新增内容，保留 LLM 合并结果");
      }
    }
    
    if (existingDataSummary && extracted.data_summary && extracted.data_summary !== existingDataSummary) {
      const oldLen = existingDataSummary.length;
      const newLen = extracted.data_summary.length;
      const merged = safeMergeSummary(existingDataSummary, extracted.data_summary);
      const mergedLen = merged.length;
      
      logger.info(`[Memory] safeMergeSummary: data_summary 合并前旧=${oldLen}, 新=${newLen}, 合并后=${mergedLen}`);
      
      if (mergedLen > oldLen + 10) {
        logger.info("[Memory] ✓ 检测到新增内容，将使用合并结果");
        extracted.data_summary = merged;
      } else if (mergedLen < oldLen - 50) {
        logger.warn("[Memory] ⚠️ 合并后反而变短，可能丢失内容，保留 LLM 合并结果");
      } else {
        logger.info("[Memory] 未检测到显著新增内容，保留 LLM 合并结果");
      }
    }
    
    // 智能合并：将新提取的信息与现有记忆合并（仅 experiment_summary 和 data_summary）
    if (existingExperimentSummary && extracted.experiment_summary) {
      try {
        logger.info("[Memory] Merging experiment_summary with existing memory...");
        const mergeResult = await callLLM(apiUrl, apiKey, model, [
          { role: "system", content: mergePrompt(existingExperimentSummary, extracted.experiment_summary, '实验资料总结') },
          { role: "user", content: "请合并上述实验资料。" }
        ], 0.3, 3000);
        const mergedContent = mergeResult.content;
        if (mergedContent && mergedContent.length > 10) {
          extracted.experiment_summary = mergedContent.trim();
          logger.info("[Memory] experiment_summary merged successfully, length:", extracted.experiment_summary.length);
        } else {
          logger.warn("[Memory] Merge response content too short, keeping original");
        }
      } catch (e) {
        logger.warn("[Memory] Merge failed, keeping original extracted content:", (e as Error).message);
      }
    } else {
      logger.info("[Memory] No existing experiment_summary to merge with, using extracted content directly");
    }
    
    if (existingDataSummary && extracted.data_summary) {
      try {
        logger.info("[Memory] Merging data_summary with existing memory...");
        const mergeResult = await callLLM(apiUrl, apiKey, model, [
          { role: "system", content: mergePrompt(existingDataSummary, extracted.data_summary, '数据详细总结') },
          { role: "user", content: "请合并上述数据总结。" }
        ], 0.3, 3000);
        const mergedContent = mergeResult.content;
        if (mergedContent && mergedContent.length > 10) {
          extracted.data_summary = mergedContent.trim();
          logger.info("[Memory] data_summary merged successfully, length:", extracted.data_summary.length);
        } else {
          logger.warn("[Memory] Merge response content too short, keeping original");
        }
      } catch (e) {
        logger.warn("[Memory] Merge failed, keeping original extracted content:", (e as Error).message);
      }
    } else {
      logger.info("[Memory] No existing data_summary to merge with, using extracted content directly");
    }
    
    // 智能合并写作进度
    if (existingWritingProgress && extracted.writing_progress && extracted.writing_progress !== "无") {
      try {
        logger.info("[Memory] Merging writing_progress with existing memory...");
        const mergeResult = await callLLM(apiUrl, apiKey, model, [
          { role: "system", content: mergeWritingProgressPrompt(existingWritingProgress, extracted.writing_progress) },
          { role: "user", content: "请合并写作进度。" }
        ], 0.3, 2000);
        const mergedContent = mergeResult.content;
        if (mergedContent && mergedContent.length > 5) {
          extracted.writing_progress = mergedContent.trim();
          logger.info("[Memory] writing_progress merged successfully, length:", extracted.writing_progress.length);
        }
      } catch (e) {
        logger.warn("[Memory] Writing progress merge failed:", (e as Error).message);
      }
    }
    
    // 智能合并已完成章节
    if (existingCompletedChapters && extracted.completed_chapters && extracted.completed_chapters !== "无") {
      try {
        logger.info("[Memory] Merging completed_chapters with existing memory...");
        const mergeResult = await callLLM(apiUrl, apiKey, model, [
          { role: "system", content: mergeChaptersPrompt(existingCompletedChapters, extracted.completed_chapters) },
          { role: "user", content: "请合并章节信息。" }
        ], 0.3, 3000);
        const mergedContent = mergeResult.content;
        if (mergedContent && mergedContent.length > 5) {
          extracted.completed_chapters = mergedContent.trim();
          logger.info("[Memory] completed_chapters merged successfully, length:", extracted.completed_chapters.length);
        }
      } catch (e) {
        logger.warn("[Memory] Completed chapters merge failed:", (e as Error).message);
      }
    }
    
    logger.info("[Memory] experiment_summary final length:", extracted.experiment_summary.length);
    logger.info("[Memory] data_summary final length:", extracted.data_summary.length);
    logger.info("[Memory] writing_progress:", extracted.writing_progress || "未提取");
    logger.info("[Memory] completed_chapters:", extracted.completed_chapters || "未提取");
    
    const entriesToUpdate = [
      { key: "research_topic", value: extracted.research_topic },
      { key: "target_journal", value: extracted.target_journal },
      { key: "key_concepts", value: extracted.key_concepts },
      { key: "important_findings", value: extracted.important_findings },
      { key: "experimental_design", value: extracted.experimental_design },
      { key: "data_status", value: extracted.data_status },
      { key: "user_preferences", value: extracted.user_preferences },
      { key: "experiment_summary", value: extracted.experiment_summary },
      { key: "data_summary", value: extracted.data_summary },
      { key: "writing_progress", value: extracted.writing_progress },
      { key: "completed_chapters", value: extracted.completed_chapters },
      { key: "pending_chapters", value: extracted.pending_chapters }
    ];
    
    for (const item of entriesToUpdate) {
      const mustSave = item.key === "experiment_summary" || item.key === "data_summary";
      const isValid = item.value && item.value !== "未提供" && item.value.length > 5;
      
      if (mustSave) {
        logger.info(`[Memory] ${item.key}: MUST SAVE, length=${item.value?.length || 0}`);
      } else {
        logger.info(`[Memory] ${item.key}: isValid=${isValid}, length=${item.value?.length || 0}`);
      }
      
      if (isValid || mustSave) {
        const existingIndex = memory.entries.findIndex(e => e.key === item.key);
        const newEntry: MemoryEntry = {
          key: item.key,
          value: item.value,
          source: "ai-extracted",
          timestamp: new Date().toISOString()
        };
        
        if (existingIndex >= 0) {
          // 智能合并：已在上游完成，这里直接覆盖
          memory.entries[existingIndex] = newEntry;
          logger.info(`[Memory] Updated existing entry: ${item.key}`);
        } else {
          memory.entries.push(newEntry);
          logger.info(`[Memory] Added new entry: ${item.key}`);
        }
      }
    }
    
    saveUserMemory(memory);
    logger.info("[Memory] Final entries count:", memory.entries.length);
    logger.info("[Memory] Entry keys:", memory.entries.map(e => e.key));
    
    const conversationSummary = {
      summary: extracted.research_topic ? `讨论了${extracted.research_topic}` : "新对话",
      keyTopics: extracted.key_concepts ? extracted.key_concepts.split(/[,，]/).map((s: string) => s.trim()).filter((s: string) => s) : []
    };
    
    const conversation: Conversation = {
      id: conversationId,
      userId: memory.userId,
      messages: [
        ...history.map(h => ({ 
          role: (h.role === 'bot' ? 'assistant' : h.role) as 'user' | 'assistant' | 'system', 
          content: h.content, 
          timestamp: new Date().toISOString() 
        })),
        { role: 'user' as const, content: userMessage, timestamp: new Date().toISOString() },
        { role: 'assistant' as const, content: aiResponse, timestamp: new Date().toISOString() }
      ],
      summary: conversationSummary.summary,
      keyTopics: conversationSummary.keyTopics,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    saveConversation(conversation);
    logger.info("[Memory] Saved full conversation to file:", conversationId);
    
  } catch (e) {
    logger.error("[Memory] Failed to extract key info:", e);
  }
}

function parseExtractedContent(content: string) {
  const result: any = {
    research_topic: "",
    target_journal: "",
    key_concepts: "",
    important_findings: "",
    experimental_design: "",
    data_status: "",
    user_preferences: "",
    experiment_summary: "",
    data_summary: "",
    writing_progress: "",
    completed_chapters: "",
    pending_chapters: ""
  };
  
  // 字段标签映射表（按出现顺序排列）
  const allFields = [
    { key: "research_topic", labels: ["研究主题：", "研究主题:"] },
    { key: "target_journal", labels: ["目标期刊：", "目标期刊:"] },
    { key: "key_concepts", labels: ["关键概念：", "关键概念:"] },
    { key: "important_findings", labels: ["重要发现：", "重要发现:"] },
    { key: "experimental_design", labels: ["实验设计：", "实验设计:"] },
    { key: "data_status", labels: ["数据状态：", "数据状态:"] },
    { key: "user_preferences", labels: ["用户偏好：", "用户偏好:"] },
    { key: "experiment_summary", labels: ["实验资料总结：", "实验资料总结:"] },
    { key: "data_summary", labels: ["数据详细总结：", "数据详细总结:"] },
    { key: "writing_progress", labels: ["写作进度：", "写作进度:"] },
    { key: "completed_chapters", labels: ["已完成章节：", "已完成章节:"] },
    { key: "pending_chapters", labels: ["待完成章节：", "待完成章节:"] }
  ];
  
  // 构建所有标签的正则（用于分割）
  const allLabelsPattern = allFields.map(f => f.labels.map(l => l.replace(/[：:]/g, '[：:]')).join('|')).join('|');
  
  // 按行解析，逐字段提取
  const lines = content.split('\n');
  let currentField: string | null = null;
  let currentValue: string[] = [];
  
  for (const line of lines) {
    let matchedField: string | null = null;
    
    // 检查是否是新字段开头
    for (const field of allFields) {
      for (const label of field.labels) {
        if (line.startsWith(label)) {
          matchedField = field.key;
          break;
        }
      }
      if (matchedField) break;
    }
    
    if (matchedField) {
      // 保存上一个字段的值
      if (currentField && currentValue.length > 0) {
        result[currentField] = currentValue.join('\n').trim();
      }
      // 开始新字段
      currentField = matchedField;
      // 提取当前行的值（标签后面的内容）
      const fieldDef = allFields.find(f => f.key === matchedField);
      if (fieldDef) {
        for (const label of fieldDef.labels) {
          if (line.startsWith(label)) {
            currentValue = [line.substring(label.length).trim()];
            break;
          }
        }
      }
    } else if (currentField) {
      // 当前行是当前字段的续行（不匹配任何新标签）
      // 只有在内容不为空且不是新字段时才追加
      const trimmedLine = line.trim();
      if (trimmedLine && !allLabelsPattern.split('|').some(p => trimmedLine.match(new RegExp('^' + p)))) {
        currentValue.push(trimmedLine);
      }
    }
  }
  
  // 保存最后一个字段
  if (currentField && currentValue.length > 0) {
    result[currentField] = currentValue.join('\n').trim();
  }
  
  return result;
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const userId = req.body.userId || "web-user";
    const userDir = getUserDir(userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage: storage });

const chatUpload = multer({ storage: multer.memoryStorage() });

const app: Express = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const port = parseInt(process.env.PORT || "18789", 10);

let currentApiUrl = process.env.API_URL || "";
let currentApiKey = process.env.API_KEY || "";
let currentModel = process.env.PRIMARY_MODEL || "qwen3.5-plus";
let currentWebSearchKey = process.env.TAVILY_API_KEY || process.env.EXA_API_KEY || "";

const apiUrl = process.env.API_URL || "";
const apiKey = process.env.API_KEY || "";
const primaryModel = process.env.PRIMARY_MODEL || "qwen3.5-plus";
const exaApiKey = process.env.EXA_API_KEY || "";

function extractTextFromFile(file: Express.Multer.File): string {
  const ext = path.extname(file.originalname).toLowerCase();
  let content: string;
  
  if (file.buffer) {
    content = file.buffer.toString('utf-8');
  } else {
    content = fs.readFileSync(file.path, 'utf-8');
  }
  
  // 移除 BOM 字符（WoS 导出文件常见）
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  
  // WoS 文件：直接返回原始内容（让后续解析函数处理）
  if (content.includes('Clarivate Analytics Web of Science') || 
      content.includes('Web of Science') ||
      content.match(/^FN\s+Clarivate/m) ||
      (content.match(/^ER\s*$/m) && content.match(/^TI\s+/m))) {
    return content;
  }
  
  if (ext === '.txt' || ext === '.md') {
    return content;
  }
  
  if (ext === '.json') {
    return content;
  }
  
  if (ext === '.ris') {
    return parseRisContent(content);
  }
  
  if (ext === '.bib') {
    return parseBibContent(content);
  }
  
  // PDF 文件：直接返回原始内容让 AI 处理
  if (ext === '.pdf') {
    return `[PDF Document: ${file.originalname}]\n\n${content}`;
  }
  
  return `[File: ${file.originalname}]\n${content.slice(0, 5000)}]`;
}

function parseWosContent(content: string): string {
  const papers: string[] = [];
  
  // 修复 1: 支持多种 ER 结尾格式（ER\n, ER \n, \nER\n）
  const records = content.split(/^ER\s*$/m);
  
  for (const record of records) {
    // 修复 2: 检查记录是否有效（必须有 TI 字段且不是空记录）
    if (!record.trim() || !record.match(/^TI\s/m)) continue;
    
    let title = '', author = '', journal = '', year = '', abstract = '', keywords = '';
    const authors: string[] = [];
    const keywordsArr: string[] = [];
    
    const lines = record.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // 跳过空行和元数据行（FN, VR 等）
      if (!trimmed || trimmed.startsWith('FN ') || trimmed.startsWith('VR ') || trimmed.startsWith('PT ')) {
        continue;
      }
      
      // 标题 (TI)
      if (line.startsWith('TI ')) {
        title = line.replace('TI ', '').trim();
        // 处理续行（以 3 个空格开头的续行）
        let j = i + 1;
        while (j < lines.length && lines[j].match(/^   \S/)) {
          title += ' ' + lines[j].trim();
          j++;
        }
        i = j - 1;
      }
      
      // 作者 (AU) - 每行一个作者
      else if (line.startsWith('AU ')) {
        const au = line.replace('AU ', '').trim();
        if (au && !authors.includes(au)) {
          authors.push(au);
        }
      }
      
      // 期刊 (SO)
      else if (line.startsWith('SO ')) {
        journal = line.replace('SO ', '').trim();
      }
      
      // 出版年份 (PY)
      else if (line.startsWith('PY ')) {
        const pyMatch = line.match(/PY\s+(\d{4})/);
        if (pyMatch) {
          year = pyMatch[1];
        }
      }
      
      // 出版日期 (PD) - 备用年份来源
      else if (line.startsWith('PD ') && !year) {
        const pdMatch = line.match(/(\d{4})/);
        if (pdMatch) {
          year = pdMatch[1];
        }
      }
      
      // 摘要 (AB)
      else if (line.startsWith('AB ')) {
        const abs: string[] = [];
        abs.push(line.replace('AB ', '').trim());
        // 处理续行（以 3 个空格开头，直到遇到新字段）
        let j = i + 1;
        while (j < lines.length && lines[j].match(/^   \S/) && !lines[j].match(/^   [A-Z][A-Z] /)) {
          const cont = lines[j].trim();
          if (cont && !cont.startsWith('RI ') && !cont.startsWith('OI ') && !cont.startsWith('C1 ')) {
            abs.push(cont);
          }
          j++;
        }
        abstract = abs.join(' ');
        i = j - 1;
      }
      
      // 关键词 (DE - Author Keywords)
      else if (line.startsWith('DE ')) {
        const kw = line.replace('DE ', '').trim();
        if (kw) {
          keywordsArr.push(...kw.split(/;/).map(k => k.trim()).filter(k => k));
        }
      }
      
      // 关键词 (ID - Keywords Plus)
      else if (line.startsWith('ID ')) {
        const kw = line.replace('ID ', '').trim();
        if (kw) {
          keywordsArr.push(...kw.split(/;/).map(k => k.trim()).filter(k => k));
        }
      }
      
      // DOI (DI) - 可选信息
      else if (line.startsWith('DI ')) {
        // DOI 可用于验证，但不在输出中显示
      }
      
      // UT (Unique Identifier) - WoS ID
      else if (line.startsWith('UT ')) {
        // WoS ID 可用于验证
      }
    }
    
    author = authors.join('; ');
    keywords = keywordsArr.join('; ');
    
    // 只添加有标题的记录
    if (title) {
      papers.push(`【文献 ${papers.length + 1}】
标题：${title}
作者：${author}
期刊：${journal}
年份：${year}
摘要：${abstract}
关键词：${keywords}`);
    }
  }
  
  logger.info('[WoS Parse] Parsed', papers.length, 'papers');
  return papers.join('\n\n');
}

function parseRisContent(content: string): string {
  const papers: string[] = [];
  const entries = content.split('\n\n');
  
  for (const entry of entries) {
    if (!entry.trim()) continue;
    
    let title = '', author = '', journal = '', year = '', abstract = '', keywords = '';
    
    const lines = entry.split('\n');
    for (const line of lines) {
      const parts = line.match(/^([A-Z][A-Z0-9])  - (.*)$/);
      if (!parts) continue;
      
      const tag = parts[1];
      const value = parts[2];
      
      switch (tag) {
        case 'TI': title = value; break;
        case 'AU': author += (author ? '; ' : '') + value; break;
        case 'JO': case 'JF': journal = value; break;
        case 'PY': case 'Y1': year = value.split('/')[0]; break;
        case 'AB': abstract = value; break;
        case 'KW': keywords += (keywords ? '; ' : '') + value; break;
      }
    }
    
    if (title) {
      papers.push(`【文献 ${papers.length + 1}】
标题: ${title}
作者: ${author}
期刊: ${journal}
年份: ${year}
摘要: ${abstract}
关键词: ${keywords}`);
    }
  }
  
  return papers.join('\n\n');
}

function parseBibContent(content: string): string {
  const papers: string[] = [];
  const entries = content.split('@');
  
  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry.trim()) continue;
    
    let title = '', author = '', journal = '', year = '', abstract = '';
    
    const matches = entry.matchAll(/(\w+)\s*=\s*\{([^}]+)\}/g);
    for (const match of matches) {
      const key = match[1].toLowerCase();
      const value = match[2];
      
      switch (key) {
        case 'title': title = value; break;
        case 'author': author = value.replace(/ and /g, '; '); break;
        case 'journal': case 'booktitle': journal = value; break;
        case 'year': year = value; break;
        case 'abstract': abstract = value; break;
      }
    }
    
    if (title) {
      papers.push(`【文献 ${papers.length + 1}】
标题: ${title}
作者: ${author}
期刊: ${journal}
年份: ${year}
摘要: ${abstract}`);
    }
  }
  
  return papers.join('\n\n');
}

interface LitPaper {
  citationId?: number;
  title: string;
  author: string;
  journal: string;
  year: string;
  abstract: string;
  keywords: string;
  doi?: string;
  embedding?: number[];
  raw?: string;
}

function convertCitationsToLaTeX(content: string, papers: LitPaper[]): string {
  const citationRegex = /\(([A-Z][a-z]+(?:\s+et\s+al\.)?),?\s*(\d{4})[a-z]?\)/g;
  
  return content.replace(citationRegex, (match, author, year) => {
    const authorName = author.toLowerCase().replace(' et al.', '');
    
    for (const paper of papers) {
      const paperAuthors = (paper.author || '').toLowerCase();
      const paperYear = String(paper.year || '');
      
      if (paperAuthors.includes(authorName) && paperYear === year && paper.citationId) {
        return `\\cite{${paper.citationId}}`;
      }
    }
    
    return match;
  });
}

function parseLiteratureToStructured(content: string): LitPaper[] {
  // 通用字段映射表：各种格式 → 标准字段
  const FIELD_MAP: Record<string, {title: string[], author: string[], journal: string[], year: string[], abstract: string[], keywords: string[]}> = {
    // Web of Science 格式
    'wos': {
      title: ['TI  ', 'TI-'],
      author: ['AU  ', 'AU-', 'AF  ', 'AF-'],
      journal: ['SO  ', 'SO-', 'J9  ', 'J9-'],
      year: ['PY  ', 'PY-', 'Y1  ', 'Y1-'],
      abstract: ['AB  ', 'AB-'],
      keywords: ['DE  ', 'DE-', 'ID  ', 'ID-']
    },
    // CNKI 格式
    'cnki': {
      title: ['T1 ', 'TI '],
      author: ['A1 ', 'AU ', 'A3 '],
      journal: ['PB ', 'JO ', 'JF ', 'SO '],
      year: ['YR ', 'PY ', 'Y1 '],
      abstract: ['AB '],
      keywords: ['K1 ', 'KW ']
    },
    // RefWorks/EndNote 格式
    'refworks': {
      title: ['TI  -', 'T1  -'],
      author: ['AU  -', 'A1  -', 'AF  -'],
      journal: ['SO  -', 'JO  -', 'JF  -'],
      year: ['PY  -', 'Y1  -'],
      abstract: ['AB  -', 'N2  -'],
      keywords: ['KW  -', 'K1  -']
    }
  };
  
  const papers: LitPaper[] = [];
  
  // 分割记录：支持多种分隔方式
  const separators = [
    /^ER\s*$/m,           // WoS: ER 单独一行（修复：支持 ER\n, ER \n）
    /(?=^RT\s)/m,         // CNKI: RT 开头
    /(?=%\s*\d)/,         // RefWorks: % 数字
    /(?=^TY\s*-\s*JOUR)/m // RefWorks: TY  - JOUR
  ];
  
  let entries: string[] = [];
  for (const sep of separators) {
    if (content.match(sep)) {
      entries = content.split(sep);
      break;
    }
  }
  
  // 如果没有找到分隔符，尝试按空行分割
  if (entries.length <= 1) {
    entries = content.split(/\n\s*\n/).filter(e => e.trim().length > 10);
  }
  
    for (const entry of entries) {
      if (!entry.trim() || entry.length < 20) continue;
      
      const lines = entry.split('\n');
      let title = '', author = '', journal = '', year = '', abstract = '', keywords = '';
      const authors: string[] = [];
      const keywordsArr: string[] = [];
      let currentField: 'author' | null = null;
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        // 检查是否是续行（缩进但不是新字段）
        const isContinuation = line.match(/^\s{3,}/) && !trimmed.includes('  -');
        
        // 标题
        if (trimmed.startsWith('TI ') || trimmed.startsWith('TI-') || trimmed.startsWith('T1 ')) {
          title = trimmed.replace(/^(TI|T1)\s*-?\s*/, '').trim();
          currentField = null;
        }
        // 作者
        else if (trimmed.startsWith('AU ') || trimmed.startsWith('AU-') || 
                 trimmed.startsWith('A1 ') || trimmed.startsWith('AF ') || trimmed.startsWith('AF-')) {
          const au = trimmed.replace(/^(AU|A1|AF)\s*-?\s*/, '').trim();
          if (au && !authors.includes(au)) authors.push(au);
          currentField = 'author';
        }
        // 其他作者 (CNKI A3 或 WoS 续行)
        else if (trimmed.startsWith('A3 ')) {
          const aus = trimmed.replace(/^A3\s*/, '').trim();
          if (aus) {
            authors.push(...aus.split(/[;]/).map(a => a.trim()).filter(a => a));
          }
          currentField = 'author';
        }
        // 续行处理：如果是作者字段的续行
        else if (isContinuation && currentField === 'author') {
          // WoS 格式：续行是作者名的 continuation
          const cont = trimmed.replace(/^,\s*/, '').trim();
          if (cont && authors.length > 0) {
            // 追加到最后一个作者
            const lastAuthor = authors[authors.length - 1];
            authors[authors.length - 1] = lastAuthor + ' ' + cont;
          }
        }
        // 期刊
        else if (trimmed.startsWith('SO ') || trimmed.startsWith('SO-') || 
                 trimmed.startsWith('PB ') || trimmed.startsWith('JO ') || trimmed.startsWith('JF ')) {
          if (!journal) {
            journal = trimmed.replace(/^(SO|PB|JO|JF)\s*-?\s*/, '').trim();
          }
          currentField = null;
        }
        // 年份
        else if (trimmed.startsWith('PY ') || trimmed.startsWith('PY-') || 
                 trimmed.startsWith('YR ') || trimmed.startsWith('Y1 ')) {
          if (!year) {
            year = trimmed.replace(/^(PY|YR|Y1)\s*-?\s*/, '').trim().substring(0, 4);
          }
          currentField = null;
        }
        // 摘要
        else if (trimmed.startsWith('AB ') || trimmed.startsWith('AB-')) {
          if (!abstract) {
            abstract = trimmed.replace(/^AB\s*-?\s*/, '').trim();
          }
          currentField = null;
        }
        // 关键词
        else if (trimmed.startsWith('DE ') || trimmed.startsWith('DE-') || 
                 trimmed.startsWith('ID ') || trimmed.startsWith('ID-') ||
                 trimmed.startsWith('KW ') || trimmed.startsWith('K1 ')) {
          const kw = trimmed.replace(/^(DE|ID|KW|K1)\s*-?\s*/, '').trim();
          if (kw) {
            // 支持分号或逗号分隔的多个关键词
            keywordsArr.push(...kw.split(/[;,,]/).map(k => k.trim()).filter(k => k));
          }
          currentField = null;
        }
        else {
          currentField = null;
        }
      }
      
      // 只添加有标题的记录
      if (title && !title.startsWith('FN ') && !title.startsWith('VR ') && !title.startsWith('ER')) {
        papers.push({
          title,
          author: authors.join(', '),
          journal,
          year,
          abstract,
          keywords: keywordsArr.join(', '),
          raw: entry
        });
      }
    }
  
  logger.info('[Parse] Parsed', papers.length, 'papers');
  return papers;
}

// Web of Science 格式解析
function parseWoSFormat(content: string): LitPaper[] {
  const papers: LitPaper[] = [];
  const entries = content.split(/\nER\s*\n/);
  
  for (const entry of entries) {
    if (!entry.trim() || !entry.includes('TI  -')) continue;
    
    const lines = entry.split('\n');
    let title = '', author = '', journal = '', year = '', abstract = '', keywords = '';
    let authors: string[] = [];
    let keywordsArr: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.startsWith('TI  -')) {
        title = line.replace(/^TI\s*-\s*/, '').trim();
      } else if (line.startsWith('AU  -')) {
        const au = line.replace(/^AU\s*-\s*/, '').trim();
        if (au) authors.push(au);
      } else if (line.startsWith('AF  -')) {
        const af = line.replace(/^AF\s*-\s*/, '').trim();
        if (af && !authors.includes(af)) authors.push(af);
      } else if (line.startsWith('SO  -')) {
        journal = line.replace(/^SO\s*-\s*/, '').trim();
      } else if (line.startsWith('PY  -')) {
        year = line.replace(/^PY\s*-\s*/, '').trim().substring(0, 4);
      } else if (line.startsWith('AB  -')) {
        abstract = line.replace(/^AB\s*-\s*/, '').trim();
        // 多行摘要
        let j = i + 1;
        while (j < lines.length && lines[j].startsWith('   ')) {
          abstract += ' ' + lines[j].trim();
          j++;
        }
      } else if (line.startsWith('DE  -') || line.startsWith('ID  -')) {
        const kw = line.replace(/^(DE|ID)\s*-\s*/, '').trim();
        if (kw) keywordsArr.push(kw);
      }
    }
    
    author = authors.join(', ');
    keywords = keywordsArr.join(', ');
    
    if (title) {
      papers.push({ title, author, journal, year, abstract, keywords, raw: entry });
    }
  }
  
  return papers;
}

// CNKI/RefWorks 格式解析（知网导出格式）
// 支持两种格式:
// 1. 标准 RefWorks: TY  -, AU  -, TI  -, AB  -
// 2. CNKI 专用：RT, A1, A3, T1, K1, YR, PB, DS CNKI
function parseCNKIFormat(content: string): LitPaper[] {
  const papers: LitPaper[] = [];
  
  // 检测是否为 CNKI 专用格式（有 RT 和 DS CNKI 标识）
  if (content.includes('DS CNKI') || content.includes('DS cnki')) {
    // CNKI 专用格式：按 RT (Reference Type) 分割记录
    const entries = content.split(/(?=^RT\s)/m);
    
    for (const entry of entries) {
      if (!entry.trim() || (!entry.includes('T1 ') && !entry.includes('TI '))) continue;
      
      const lines = entry.split('\n');
      let title = '', author = '', journal = '', year = '', abstract = '', keywords = '';
      let authors: string[] = [];
      let keywordsArr: string[] = [];
      
      for (const line of lines) {
        const trimmed = line.trim();
        
        // 标题
        if (trimmed.startsWith('T1 ') || trimmed.startsWith('TI ')) {
          title = trimmed.replace(/^(T1|TI)\s*/, '').trim();
        }
        // 第一作者
        else if (trimmed.startsWith('A1 ')) {
          const au = trimmed.replace(/^A1\s*/, '').trim();
          if (au) authors.push(au);
        }
        // 其他作者
        else if (trimmed.startsWith('A3 ')) {
          const aus = trimmed.replace(/^A3\s*/, '').trim();
          if (aus) {
            authors.push(...aus.split(/[;]/).map(a => a.trim()).filter(a => a));
          }
        }
        // 期刊/出版社
        else if (trimmed.startsWith('PB ') || trimmed.startsWith('JO ') || trimmed.startsWith('JF ')) {
          journal = trimmed.replace(/^(PB|JO|JF)\s*/, '').trim();
        }
        // 年份
        else if (trimmed.startsWith('YR ') || trimmed.startsWith('PY ')) {
          year = trimmed.replace(/^(YR|PY)\s*/, '').trim().substring(0, 4);
        }
        // 摘要
        else if (trimmed.startsWith('AB ')) {
          abstract = trimmed.replace(/^AB\s*/, '').trim();
        }
        // 关键词（K1 可能有多个，用分号分隔）
        else if (trimmed.startsWith('K1 ')) {
          const kw = trimmed.replace(/^K1\s*/, '').trim();
          if (kw) {
            keywordsArr.push(...kw.split(/[;]/).map(k => k.trim()).filter(k => k));
          }
        }
      }
      
      author = authors.join(', ');
      keywords = keywordsArr.join(', ');
      
      if (title) {
        papers.push({ title, author, journal, year, abstract, keywords, raw: entry });
      }
    }
  } else {
    // 标准 RefWorks 格式
    const entries = content.split(/(?=%\s*\d)|(?=^TY\s*-\s*JOUR)|(?=^TY\s*-\s*CONF)/m);
    
    for (const entry of entries) {
      if (!entry.trim() || !entry.includes('TI  -')) continue;
      
      const lines = entry.split('\n');
      let title = '', author = '', journal = '', year = '', abstract = '', keywords = '';
      let authors: string[] = [];
      let keywordsArr: string[] = [];
      
      for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed.startsWith('TI  -') || trimmed.startsWith('T1  -')) {
          title = trimmed.replace(/^(TI|T1)\s*-\s*/, '').trim();
        } else if (trimmed.startsWith('AU  -') || trimmed.startsWith('A1  -')) {
          const au = trimmed.replace(/^(AU|A1)\s*-\s*/, '').trim();
          if (au) authors.push(au);
        } else if (trimmed.startsWith('AF  -')) {
          const af = trimmed.replace(/^AF\s*-\s*/, '').trim();
          if (af && !authors.includes(af)) authors.push(af);
        } else if (trimmed.startsWith('SO  -') || trimmed.startsWith('JO  -') || trimmed.startsWith('JF  -')) {
          journal = trimmed.replace(/^(SO|JO|JF)\s*-\s*/, '').trim();
        } else if (trimmed.startsWith('PY  -') || trimmed.startsWith('Y1  -')) {
          year = trimmed.replace(/^(PY|Y1)\s*-\s*/, '').trim().substring(0, 4);
        } else if (trimmed.startsWith('AB  -') || trimmed.startsWith('N2  -')) {
          abstract = trimmed.replace(/^(AB|N2)\s*-\s*/, '').trim();
        } else if (trimmed.startsWith('KW  -') || trimmed.startsWith('K1  -')) {
          const kw = trimmed.replace(/^(KW|K1)\s*-\s*/, '').trim();
          if (kw) keywordsArr.push(kw);
        }
      }
      
      author = authors.join(', ');
      keywords = keywordsArr.join(', ');
      
      if (title) {
        papers.push({ title, author, journal, year, abstract, keywords, raw: entry });
      }
    }
  }
  
  return papers;
}

// 原有中文格式解析（保持兼容）
function parseChineseFormat(content: string): LitPaper[] {
  const papers: LitPaper[] = [];
  const entries = content.split('  [文献');
  
  for (const entry of entries) {
    if (!entry.trim()) continue;
    
    const lines = entry.split('\n');
    let title = '', author = '', journal = '', year = '', abstract = '', keywords = '';
    
    for (const line of lines) {
      if (line.startsWith('标题:')) title = line.replace('标题:', '').trim();
      else if (line.startsWith('作者:')) author = line.replace('作者:', '').trim();
      else if (line.startsWith('期刊:')) journal = line.replace('期刊:', '').trim();
      else if (line.startsWith('年份:')) year = line.replace('年份:', '').trim();
      else if (line.startsWith('摘要:')) abstract = line.replace('摘要:', '').trim();
      else if (line.startsWith('关键词:')) keywords = line.replace('关键词:', '').trim();
    }
    
    if (title) {
      papers.push({ title, author, journal, year, abstract, keywords, raw: entry });
    }
  }
  
  return papers;
}

interface SearchResult {
  paper: LitPaper;
  score: number;
  matchFields: string[];
}

function searchLiterature(query: string, papers: LitPaper[], maxResults: number = 10): SearchResult[] {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);
  
  const results: SearchResult[] = [];
  
  for (const paper of papers) {
    let score = 0;
    const matchFields: string[] = [];
    
    const titleLower = (paper.title || '').toLowerCase();
    const abstractLower = (paper.abstract || '').toLowerCase();
    const keywordsLower = (Array.isArray(paper.keywords) ? paper.keywords.join(', ') : (paper.keywords || '')).toLowerCase();
    const authorLower = (paper.author || '').toLowerCase();
    const journalLower = (paper.journal || '').toLowerCase();
    
    for (const word of queryWords) {
      if (titleLower.includes(word)) {
        score += 10;
        matchFields.push('title');
      }
      if (keywordsLower.includes(word)) {
        score += 8;
        if (!matchFields.includes('keywords')) matchFields.push('keywords');
      }
      if (abstractLower.includes(word)) {
        score += 5;
        if (!matchFields.includes('abstract')) matchFields.push('abstract');
      }
      if (authorLower.includes(word)) {
        score += 3;
        if (!matchFields.includes('author')) matchFields.push('author');
      }
      if (journalLower.includes(word)) {
        score += 2;
        if (!matchFields.includes('journal')) matchFields.push('journal');
      }
    }
    
    const yearMatch = query.match(/\d{4}/);
    if (yearMatch && paper.year.includes(yearMatch[0])) {
      score += 4;
      matchFields.push('year');
    }
    
    if (score > 0) {
      results.push({ paper, score, matchFields });
    }
  }
  
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

async function webSearch(query: string, numResults: number = 10, customUrl?: string, customKey?: string): Promise<string> {
  const apiKey = customKey || exaApiKey;
  
  if (!apiKey) {
    logger.warn("[WebSearch] No API key configured");
    return '';
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: query,
        max_results: numResults,
        include_answer: true,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      logger.error("[WebSearch] Tavily API error:", response.status);
      return '';
    }

    const data = await response.json() as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        score?: number;
      }>;
    };

    if (!data.results || data.results.length === 0) {
      return '';
    }

    let context = `=== 网络检索结果 ===\n\n`;
    for (let i = 0; i < Math.min(data.results.length, 10); i++) {
      const r = data.results[i];
      context += `【${i + 1}】${r.title}\n`;
      context += `链接: ${r.url}\n`;
      context += `摘要: ${r.content ? r.content.substring(0, 300) : '无'}\n\n`;
    }

    logger.info("[WebSearch] Found", data.results.length, "results for:", query);
    return context;
  } catch (e) {
    logger.error("[WebSearch] Error:", e);
    return '';
  }
}

async function processChatMessage(userId: string, userMessage: string): Promise<string> {
  const model = currentModel;
  const webSearchKey = currentWebSearchKey;
  const useApiUrl = currentApiUrl;
  const useApiKey = currentApiKey;
  
  // 统一用户 ID（飞书用户映射到 web-user）
  const unifiedId = isFeishuUserId(userId) ? getUnifiedUserId(userId) : userId;
  
  // 检查是否为新建会话命令
  const newChatCommands = ['新建会话', '新会话', '清空历史', '清空对话', 'new chat', 'newchat', '/new', '重置对话'];
  const isNewChatCommand = newChatCommands.some(cmd => 
    userMessage.trim().toLowerCase() === cmd.toLowerCase()
  );
  
  if (isNewChatCommand) {
    // 清空对话历史
    conversationHistory.delete(unifiedId);
    logger.info(`[ChatProcessor] New chat session for ${unifiedId}, history cleared`);
    return `✅ 已新建会话，对话历史已清空。

📌 **提示**：
- 跨会话记忆（实验资料、数据总结等）仍保留
- 如需清空记忆，请说"清空记忆"
- 开始新的对话吧！`;
  }
  
  // 检查是否为清空记忆命令
  if (userMessage.trim() === '清空记忆' || userMessage.trim().toLowerCase() === 'clear memory') {
    conversationHistory.delete(unifiedId);
    const memory = loadUserMemory(unifiedId);
    memory.entries = [];
    saveUserMemory(memory);
    logger.info(`[ChatProcessor] Memory cleared for ${unifiedId}`);
    return `✅ 已清空所有记忆和对话历史。

你可以重新开始，告诉我你的研究内容。`;
  }
  
  logger.info(`[ChatProcessor] Processing for ${userId} → ${unifiedId}: ${userMessage.substring(0, 50)}...`);
  logger.info(`[ChatProcessor] Using API: ${useApiUrl}, Model: ${model}`);
  
  const userMemory = loadUserMemory(unifiedId);
  let memoryContext = "";
  let writingProgressContext = "";
  
  if (userMemory.entries.length > 0) {
    const writingProgressEntry = userMemory.entries.find(e => e.key === 'writing_progress');
    const completedChaptersEntry = userMemory.entries.find(e => e.key === 'completed_chapters');
    const pendingChaptersEntry = userMemory.entries.find(e => e.key === 'pending_chapters');
    
    if (writingProgressEntry || completedChaptersEntry || pendingChaptersEntry) {
      writingProgressContext = "\n## 📝 当前写作进度\n";
      if (writingProgressEntry?.value && writingProgressEntry.value !== "无") {
        writingProgressContext += `**整体进度**: ${writingProgressEntry.value}\n`;
      }
      if (completedChaptersEntry?.value && completedChaptersEntry.value !== "无") {
        writingProgressContext += `**已完成章节**: ${completedChaptersEntry.value}\n`;
      }
      if (pendingChaptersEntry?.value && pendingChaptersEntry.value !== "无") {
        writingProgressContext += `**待完成章节**: ${pendingChaptersEntry.value}\n`;
      }
    }
    
    memoryContext = "\n## 🧠 历史记忆\n";
    for (const entry of userMemory.entries.slice(-10)) {
      if (!['writing_progress', 'completed_chapters', 'pending_chapters'].includes(entry.key)) {
        memoryContext += `- ${entry.key}: ${entry.value}\n`;
      }
    }
  }
  
  const userDir = getUserDir(userId);
  const litFile = path.join(userDir, "literature.txt");
  const litJsonFile = path.join(userDir, "literature.json");
  
  let literaturePapers: LitPaper[] = [];
  let literatureSummary = "";
  let hasLiterature = false;
  
  if (fs.existsSync(litFile)) {
    hasLiterature = true;
    if (fs.existsSync(litJsonFile)) {
      try {
        literaturePapers = JSON.parse(fs.readFileSync(litJsonFile, 'utf-8'));
      } catch (e) {
        const litContent = fs.readFileSync(litFile, 'utf-8');
        literaturePapers = parseLiteratureToStructured(litContent);
      }
    } else {
      const litContent = fs.readFileSync(litFile, 'utf-8');
      literaturePapers = parseLiteratureToStructured(litContent);
    }
    
    const summary = getLitSummary(fs.readFileSync(litFile, 'utf-8'));
    literatureSummary = `文献总数: ${summary.count} 篇, 年份: ${summary.years.join(", ")}, 期刊: ${summary.journals.slice(0, 5).join(", ")}`;
  }
  
  let journalStyleContent = "";
  let journalStyleHint = "";
  const journalStyleDir = path.join(userDir, "journal-styles");
  if (fs.existsSync(journalStyleDir)) {
    const styleFiles = fs.readdirSync(journalStyleDir);
    if (styleFiles.length > 0) {
      const latestStyle = styleFiles.sort().pop();
      if (latestStyle) {
        const stylePath = path.join(journalStyleDir, latestStyle, "style.json");
        if (fs.existsSync(stylePath)) {
          try {
            const styleData = JSON.parse(fs.readFileSync(stylePath, 'utf-8'));
            journalStyleContent = "\n## 目标期刊风格指南\n";
            journalStyleContent += `已分析 ${styleData.length} 篇论文的写作风格。\n\n`;
            for (let i = 0; i < Math.min(styleData.length, 2); i++) {
              const paper = styleData[i];
              journalStyleContent += `### 文献 ${i + 1}: ${paper.paper_title}\n`;
              journalStyleContent += `期刊：${paper.journal}, 年份：${paper.year}\n`;
              if (paper.overall_style) {
                journalStyleContent += `风格：${paper.overall_style.formality || ''}, 语气：${paper.overall_style.argument_tone || ''}\n`;
              }
              if (paper.transferable_rules && paper.transferable_rules.length > 0) {
                journalStyleContent += `规则：${paper.transferable_rules.slice(0, 3).join('; ')}\n`;
              }
              journalStyleContent += "\n";
            }
            journalStyleHint = "\n你需要参考上述目标期刊的写作风格。\n";
          } catch (e) {
            logger.warn("[ChatProcessor] Failed to load journal style:", e);
          }
        }
      }
    }
  }
  
  const decisionPrompt = `你是一个专业的学术论文写作助手。

## 文献库信息
${hasLiterature ? literatureSummary : "用户还没有上传文献。"}
${journalStyleHint}

## 用户问题
"${userMessage}"

## 你的任务
分析用户的问题，做出三个决策：
1. 是否需要从文献库中搜索相关文献？
2. 是否需要联网搜索最新信息？
3. 用户想要做什么？（回答问题/写讨论/写引言/其他）

## 决策规则
- 如果用户问的是具体研究问题、需要引用文献、或者要写Discussion/引言，**必须搜索文献库**
- 如果问题涉及最新研究成果（2024-2026）、实时数据，**必须联网搜索**
- 文献库搜索优先级更高

## 输出格式
返回以下 JSON 格式：
{
  "need_lit_search": true/false,
  "lit_search_keywords": "搜索关键词",
  "need_web_search": true/false,
  "web_search_query": "联网搜索关键词",
  "task_type": "回答问题/写讨论/写引言/其他",
  "reason": "判断理由"
}

只返回 JSON，不要有其他文字。`;

  let needLitSearch = false;
  let litSearchKeywords = "";
  let needWebSearch = false;
  let webSearchQuery = "";
  let taskType = "回答问题";
  
  try {
    const decisionResult = await callLLM(useApiUrl, useApiKey, model, [{ role: "system", content: decisionPrompt }, { role: "user", content: userMessage }], 0.3, 500);
    const decisionText = decisionResult.content;
    
    const jsonMatch = decisionText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const decision = JSON.parse(jsonMatch[0]);
      needLitSearch = decision.need_lit_search === true;
      litSearchKeywords = decision.lit_search_keywords || "";
      needWebSearch = decision.need_web_search === true;
      webSearchQuery = decision.web_search_query || userMessage;
      taskType = decision.task_type || "回答问题";
      logger.info(`[ChatProcessor] Decision: lit=${needLitSearch}(${litSearchKeywords}), web=${needWebSearch}, task=${taskType}`);
    }
  } catch (e) {
    logger.warn("[ChatProcessor] Decision API failed:", e);
  }
  
  let relevantLiterature = "";
  if (needLitSearch && literaturePapers.length > 0) {
    const keywords = litSearchKeywords.split(/[,，]/).map(k => k.trim()).filter(k => k);
    const searchQuery = keywords.join(" ") || userMessage;
    
    const searchResults = searchLiterature(searchQuery, literaturePapers, 8);
    
    if (searchResults.length > 0) {
      relevantLiterature = "\n【相关文献】\n";
      for (let i = 0; i < searchResults.length; i++) {
        const r = searchResults[i];
        relevantLiterature += `文献 ${i + 1}: ${r.paper.title}\n`;
        relevantLiterature += `  作者: ${r.paper.author}\n`;
        relevantLiterature += `  年份: ${r.paper.year}\n`;
        relevantLiterature += `  期刊: ${r.paper.journal}\n`;
        relevantLiterature += `  摘要: ${r.paper.abstract || '无'}\n\n`;
      }
      logger.info(`[ChatProcessor] Found ${searchResults.length} papers for: ${searchQuery}`);
    }
  }
  
  let webSearchContext = "";
  if (needWebSearch && webSearchKey) {
    try {
      logger.info("[ChatProcessor] Web searching for:", webSearchQuery);
      const searchResponse = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: webSearchKey,
          query: webSearchQuery,
          max_results: 5,
          include_answer: true,
        }),
      });
      
      const searchData = await searchResponse.json() as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
      };
      
      if (searchData.results && searchData.results.length > 0) {
        webSearchContext = "\n【网络搜索结果】\n";
        for (let i = 0; i < Math.min(searchData.results.length, 5); i++) {
          const r = searchData.results[i];
          webSearchContext += `${i + 1}. ${r.title}\n   ${r.content ? r.content.substring(0, 250) : ''}\n\n`;
        }
        logger.info("[ChatProcessor] Web search found", searchData.results.length, "results");
      }
    } catch (e) {
      logger.error("[ChatProcessor] Web search error:", e);
    }
  }
  
  let taskHint = "";
  if (taskType === "写讨论") {
    taskHint = "\n## 写作任务\n用户想要写 Discussion。请基于文献比较研究发现，使用 '(作者, 年份)' 格式引用。\n";
  } else if (taskType === "写引言") {
    taskHint = "\n## 写作任务\n用户想要写 Introduction。请介绍研究背景、缺口和目标，使用 '(作者, 年份)' 格式引用。\n";
  }
  
  let memoryIntro = "";
  if (userMemory.entries.length > 0) {
    memoryIntro = "\n## 跨会话长久记忆\n系统已记录您之前分享的信息：\n";
    for (const entry of userMemory.entries.slice(-8)) {
      memoryIntro += `- **${entry.key}**: ${entry.value}\n`;
    }
  } else {
    memoryIntro = "\n## 跨会话长久记忆\n本对话结束后，系统将自动提取重要信息并保存。\n";
  }
  
  const finalSystemPrompt = `你是一个专业的学术论文写作助手。${soulContent ? "\n" + soulContent : ""}
${memoryIntro}
${memoryContext}
${writingProgressContext}

## 你的能力
1. **文献库搜索**：可以从用户上传的【相关文献】中查找信息
2. **联网搜索**：可以搜索互联网最新研究（仅用于背景信息，**不能用于参考文献**）
3. **智能引用**：自动使用 "(作者，年份)" 格式引用【相关文献】

## ⚠️ 重要：引用来源限制

### 可以引用的来源（【相关文献】）
- 用户上传的文献库中的文献
- 位于 【相关文献】 部分的文献
- 包含完整作者、年份、标题、期刊信息

### 不可以引用的来源
- 【网络搜索结果】**绝对不能**用于参考文献
- 不要从网络搜索结果中编造作者和年份
- 不要引用你未在【相关文献】中看到的文献

### 严格禁止
❌ **严禁编造引用**：
- 不要编造不存在的 "(作者, 年份)"
- 不要猜测网络搜索结果的作者
- 如果不确定，宁可不引用

✅ **正确做法**：
- 只引用【相关文献】中明确列出的文献
- 如果【相关文献】中没有相关信息，请明确告知用户
- 可以建议用户上传更多相关文献

## 文献库信息
${hasLiterature ? literatureSummary : "用户还没有上传文献。"}
${journalStyleContent}
${journalStyleHint}

${relevantLiterature}
${webSearchContext}
${taskHint}

## 回答要求
1. 回答必须有文献依据
2. 必须使用 "(作者，年份)" 格式引用文献
3. 如果有相关文献，必须引用；不要编造引用
4. 使用专业的学术表达

## 📝 论文草稿功能
当用户说"保存到草稿"时，你必须在回复最后包含：

\`\`\`
🔧 调用工具：save_draft
content: |
[LaTeX 格式内容]
section: [章节名]
\`\`\`

## 写作流程要求
不要一次性生成整个章节！采用渐进式写作：
1. 先询问写作重点
2. 建议章节结构，等用户确认
3. 分段写作，逐段确认`;

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: finalSystemPrompt }
  ];
  
  const history = conversationHistory.get(unifiedId) || [];
  for (const msg of history.slice(-10)) {
    messages.push(msg);
  }
  
  messages.push({ role: "user", content: userMessage });
  
  let aiResponse: string;
  try {
    logger.info(`[ChatProcessor] Calling LLM with ${messages.length} messages...`);
    const result = await callLLM(useApiUrl, useApiKey, model, messages, 0.7, 4096);
    logger.info(`[ChatProcessor] LLM returned, content length: ${result.content?.length || 0}`);
    aiResponse = result.content || "抱歉，我无法生成回复。";
    
    const draftMatch = aiResponse.match(/```[\s\S]*?🔧 调用工具：save_draft[\s\S]*?```/);
    if (draftMatch) {
      const draftBlock = draftMatch[0];
      const contentMatch = draftBlock.match(/content:\s*\|[\s\S]*?(?=\n\s*section:)/);
      const sectionMatch = draftBlock.match(/section:\s*(\w+)/);
      
      if (contentMatch && sectionMatch) {
        let draftContent = contentMatch[1].trim();
        const section = sectionMatch[1];
        
        draftContent = draftContent.replace(/^```/, '').replace(/```$/,'').trim();
        
        try {
          await sessionStore.saveDraft(unifiedId, section, draftContent);
          logger.info(`[ChatProcessor] Draft saved: ${section} for ${unifiedId}`);
          aiResponse = aiResponse.replace(draftMatch[0], `\n✅ 已保存到 ${section} 草稿\n`);
        } catch (e) {
          logger.error("[ChatProcessor] Failed to save draft:", e);
          aiResponse = aiResponse.replace(draftMatch[0], `\n⚠️ 草稿保存失败: ${(e as Error).message}\n`);
        }
      }
    }
    
    const currentHistory = conversationHistory.get(unifiedId) || [];
    currentHistory.push({ role: "user", content: userMessage });
    currentHistory.push({ role: "assistant", content: aiResponse });
    if (currentHistory.length > 20) {
      currentHistory.splice(0, currentHistory.length - 20);
    }
    conversationHistory.set(unifiedId, currentHistory);
    
    const conversationId = `feishu-${Date.now()}`;
    updateMemoryWithAI(unifiedId, conversationId, userMessage, aiResponse, history, useApiUrl, useApiKey, model).catch(e => {
      logger.warn("[ChatProcessor] Failed to update memory:", e);
    });
    
    return aiResponse;
    
  } catch (error) {
    logger.error("[ChatProcessor] Error:", error);
    return `抱歉，处理请求时出错: ${(error as Error).message}`;
  }
}

function loadSoulFile(): string {
  const soulPath = path.join(__dirname, "..", "..", "SOUL.md");
  if (fs.existsSync(soulPath)) {
    return fs.readFileSync(soulPath, 'utf-8');
  }
  return '';
}

const soulContent = loadSoulFile();
if (soulContent) {
  logger.info("[SOUL] Loaded AI personality file");
}

function createApiClient() {
  return {
    async chat(options: {
      model: string;
      messages: Array<{ role: string; content: string }>;
      temperature?: number;
      maxTokens?: number;
    }) {
      const result = await callLLM(apiUrl, apiKey, options.model, options.messages, options.temperature, options.maxTokens);
      return result.content;
    },
  };
}

const conversationHistory = new Map<
  string,
  Array<{ role: string; content: string }>
>();

app.use(express.static(publicDir));

app.get("/", (req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/api/model", (req: Request, res: Response) => {
  res.json({ model: primaryModel });
});

app.post("/api/models", async (req: Request, res: Response) => {
  const customApiUrl = req.body.apiUrl || apiUrl;
  const customApiKey = req.body.apiKey || apiKey;

  try {
    const response = await fetch(customApiUrl + "/models", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + customApiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json() as {
      data?: Array<{ id: string; owned_by?: string }>;
    };

    const modelIds = (data.data || [])
      .map((m) => m.id)
      .filter((id) => id && !id.includes(":"))
      .sort();

    res.json({ models: modelIds, success: true });
  } catch (error) {
    res.json({
      models: [],
      success: false,
      error: (error as Error).message
    });
  }
});

app.post("/api/settings", (req: Request, res: Response) => {
  const { apiUrl: newApiUrl, apiKey: newApiKey, model: newModel, webSearchKey: newWebSearchKey } = req.body;
  
  if (newApiUrl) {
    currentApiUrl = newApiUrl;
    logger.info(`[Settings] API URL updated: ${newApiUrl}`);
  }
  if (newApiKey) {
    currentApiKey = newApiKey;
    logger.info(`[Settings] API Key updated`);
  }
  if (newModel) {
    currentModel = newModel;
    logger.info(`[Settings] Model updated: ${newModel}`);
  }
  if (newWebSearchKey !== undefined) {
    currentWebSearchKey = newWebSearchKey;
    logger.info(`[Settings] Web Search Key updated`);
  }
  
  res.json({ 
    success: true, 
    settings: {
      apiUrl: currentApiUrl,
      model: currentModel,
      hasApiKey: !!currentApiKey,
      hasWebSearchKey: !!currentWebSearchKey
    }
  });
});

app.get("/api/settings", (req: Request, res: Response) => {
  res.json({
    apiUrl: currentApiUrl,
    model: currentModel,
    hasApiKey: !!currentApiKey,
    hasWebSearchKey: !!currentWebSearchKey
  });
});

app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), model: primaryModel });
});

app.get("/debug/paths", (req: Request, res: Response) => {
  const memoryFile = path.join(memoryDir, "web-user", "memory.json");
  res.json({
    projectRoot,
    dataDir,
    memoryDir,
    memoryFile,
    memoryFileExists: fs.existsSync(memoryFile),
    memoryFileContent: fs.existsSync(memoryFile) ? fs.readFileSync(memoryFile, 'utf-8').substring(0, 500) : 'not found'
  });
});

app.post("/api/reset", (req: Request, res: Response) => {
  const userId = req.body.userId || "web-user";
  const unifiedId = isFeishuUserId(userId) ? getUnifiedUserId(userId) : userId;
  conversationHistory.delete(unifiedId);
  res.json({ ok: true });
});

interface LitInfo {
  count: number;
  years: string[];
  journals: string[];
  keywords: string[];
}

function getLitSummary(content: string): LitInfo {
  // 通用字段提取：支持 WoS, CNKI, RefWorks 等所有格式
  const years: string[] = [];
  const journals: string[] = [];
  const keywords: string[] = [];
  let count = 0;
  
  // 分割记录
  const separators = [/^ER\s*$/m, /(?=^RT\s)/m, /(?=%\s*\d)/, /(?=^TY\s*-\s*JOUR)/m];
  let entries: string[] = [];
  
  for (const sep of separators) {
    if (content.match(sep)) {
      entries = content.split(sep);
      break;
    }
  }
  
  if (entries.length <= 1) {
    entries = content.split(/\n\s*\n/).filter(e => e.trim().length > 10);
  }
  
  for (const entry of entries) {
    if (!entry.trim() || entry.length < 20) continue;
    
    // 检查是否有标题字段
    const hasTitle = entry.match(/^(TI|T1)\s*-?\s*/m);
    if (!hasTitle) continue;
    
    count++;
    
    // 年份
    const yearMatch = entry.match(/^(PY|YR|Y1)\s*-?\s*(\d{4})/m);
    if (yearMatch) years.push(yearMatch[2]);
    
    // 期刊
    const journalMatch = entry.match(/^(SO|PB|JO|JF)\s*-?\s*([^\n]+)/m);
    if (journalMatch) {
      const j = journalMatch[2].trim();
      if (j && j.length < 100 && !journals.includes(j)) journals.push(j);
    }
    
    // 关键词
    const kwMatches = entry.match(/^(DE|ID|KW|K1)\s*-?\s*([^\n]+)/gm);
    if (kwMatches) {
      for (const kw of kwMatches) {
        const cleaned = kw.replace(/^(DE|ID|KW|K1)\s*-?\s*/, '').trim();
        if (cleaned) {
          keywords.push(...cleaned.split(/[;,,]/).map(k => k.trim()).filter(k => k));
        }
      }
    }
  }
  
  return {
    count,
    years: [...new Set(years)].sort(),
    journals: [...new Set(journals)].slice(0, 10),
    keywords: [...new Set(keywords)].slice(0, 20)
  };
}

function getWoSSummary(content: string): LitInfo {
  const years: string[] = [];
  const journals: string[] = [];
  const keywords: string[] = [];
  
  const entries = content.split(/\nER\s*\n/);
  for (const entry of entries) {
    if (!entry.trim() || !entry.includes('TI  -')) continue;
    
    const yearMatch = entry.match(/PY\s*-\s*(\d{4})/);
    if (yearMatch) years.push(yearMatch[1]);
    
    const journalMatch = entry.match(/SO\s*-\s*([^\n]+)/);
    if (journalMatch) {
      const j = journalMatch[1].trim();
      if (j && j.length < 100) journals.push(j);
    }
    
    const kwMatch = entry.match(/(DE|ID)\s*-\s*([^\n]+)/g);
    if (kwMatch) {
      for (const kw of kwMatch) {
        const cleaned = kw.replace(/^(DE|ID)\s*-\s*/, '').trim();
        if (cleaned) keywords.push(cleaned);
      }
    }
  }
  
  const uniqueYears = [...new Set(years)].sort();
  const uniqueJournals = [...new Set(journals)].slice(0, 10);
  const topKeywords = [...new Set(keywords)].slice(0, 20);
  
  return {
    count: entries.filter(e => e.trim() && e.includes('TI  -')).length,
    years: uniqueYears,
    journals: uniqueJournals,
    keywords: topKeywords
  };
}

function getCNKISummary(content: string): LitInfo {
  const years: string[] = [];
  const journals: string[] = [];
  const keywords: string[] = [];
  
  // 检测是否为 CNKI 专用格式
  if (content.includes('DS CNKI') || content.includes('DS cnki')) {
    // CNKI 专用格式：按 RT 分割
    const entries = content.split(/(?=^RT\s)/m);
    for (const entry of entries) {
      if (!entry.trim() || (!entry.includes('T1 ') && !entry.includes('TI '))) continue;
      
      // 年份
      const yearMatch = entry.match(/(YR|PY)\s+(\d{4})/);
      if (yearMatch) years.push(yearMatch[2]);
      
      // 期刊/出版社
      const journalMatch = entry.match(/(PB|JO|JF)\s+([^\n]+)/);
      if (journalMatch) {
        const j = journalMatch[2].trim();
        if (j && j.length < 100) journals.push(j);
      }
      
      // 关键词
      const kwMatch = entry.match(/K1\s+([^\n]+)/g);
      if (kwMatch) {
        for (const kw of kwMatch) {
          const cleaned = kw.replace(/^K1\s+/, '').trim();
          if (cleaned) {
            keywords.push(...cleaned.split(/[;]/).map(k => k.trim()).filter(k => k));
          }
        }
      }
    }
    
    return {
      count: entries.filter(e => e.trim() && (e.includes('T1 ') || e.includes('TI '))).length,
      years: [...new Set(years)].sort(),
      journals: [...new Set(journals)].slice(0, 10),
      keywords: [...new Set(keywords)].slice(0, 20)
    };
  } else {
    // 标准 RefWorks 格式
    const entries = content.split(/(?=%\s*\d)|(?=^TY\s*-\s*JOUR)|(?=^TY\s*-\s*CONF)/m);
    for (const entry of entries) {
      if (!entry.trim() || !entry.includes('TI  -')) continue;
      
      const yearMatch = entry.match(/(PY|Y1)\s*-\s*(\d{4})/);
      if (yearMatch) years.push(yearMatch[2]);
      
      const journalMatch = entry.match(/(SO|JO|JF)\s*-\s*([^\n]+)/);
      if (journalMatch) {
        const j = journalMatch[2].trim();
        if (j && j.length < 100) journals.push(j);
      }
      
      const kwMatch = entry.match(/(KW|K1)\s*-\s*([^\n]+)/g);
      if (kwMatch) {
        for (const kw of kwMatch) {
          const cleaned = kw.replace(/^(KW|K1)\s*-\s*/, '').trim();
          if (cleaned) keywords.push(cleaned);
        }
      }
    }
    
    return {
      count: entries.filter(e => e.trim() && e.includes('TI  -')).length,
      years: [...new Set(years)].sort(),
      journals: [...new Set(journals)].slice(0, 10),
      keywords: [...new Set(keywords)].slice(0, 20)
    };
  }
}

function getChineseSummary(content: string): LitInfo {
  const papers = content.split('  [文献').filter(p => p.includes('标题:'));
  const years: string[] = [];
  const journals: string[] = [];
  const keywords: string[] = [];
  
  for (const paper of papers) {
    const yearMatch = paper.match(/年份:\s*(\d{4})/);
    if (yearMatch) years.push(yearMatch[1]);
    
    const journalMatch = paper.match(/期刊:\s*([^]+?)(?=\n|$)/);
    if (journalMatch) {
      const j = journalMatch[1].trim();
      if (j && j.length < 100) journals.push(j);
    }
    
    const kwMatch = paper.match(/关键词:\s*([^]+?)(?=\n|$)/);
    if (kwMatch) {
      const kw = kwMatch[1].trim();
      if (kw) {
        keywords.push(...kw.split(/[,，;；]/).map(k => k.trim()).filter(k => k));
      }
    }
  }
  
  const uniqueYears = [...new Set(years)].sort();
  const uniqueJournals = [...new Set(journals)].slice(0, 10);
  const topKeywords = [...new Set(keywords)].slice(0, 20);
  
  return {
    count: papers.length,
    years: uniqueYears,
    journals: uniqueJournals,
    keywords: topKeywords
  };
}

app.post("/api/upload", upload.array("files", 20), async (req: Request, res: Response) => {
  const userId = req.body.userId || "web-user";
  const userDir = getUserDir(userId);
  
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  
  const files = req.files as Express.Multer.File[];
  let allContent = '';
  let totalPapers = 0;
  
  for (const file of files) {
    const content = await extractTextFromFile(file);
    allContent += content + '\n\n';
    const info = getLitSummary(content);
    logger.info(`[Upload Debug] Single file summary: count=${info.count}, years=${info.years.length}, content length=${content.length}`);
    totalPapers += info.count;
  }
  
  const summary = getLitSummary(allContent);
  logger.info(`[Upload Debug] Final summary: count=${summary.count}, years=${summary.years.length}, total content length=${allContent.length}`);
  
  const papers = parseLiteratureToStructured(allContent);
  const jsonFile = path.join(userDir, "literature.json");
  fs.writeFileSync(jsonFile, JSON.stringify(papers, null, 2), 'utf-8');
  logger.info("[Upload] Saved literature.json with", papers.length, "papers");
  
  fs.writeFileSync(path.join(userDir, "literature.txt"), allContent, 'utf-8');
  
  logger.info("[Upload] User " + userId + " uploaded " + files.length + " files, " + totalPapers + " papers");
  
  res.json({
    success: true,
    files: files.map(f => f.originalname),
    summary: summary
  });
});

app.get("/api/literature/:userId", async (req: Request, res: Response) => {
  let userId = req.params.userId;
  let litFile = path.join(getUserDir(userId), "literature.txt");
  
  if (!fs.existsSync(litFile)) {
    const webUserLitFile = path.join(uploadDir, "web-user", "literature.txt");
    const webUserLitJsonFile = path.join(uploadDir, "web-user", "literature.json");
    if (fs.existsSync(webUserLitFile)) {
      const newUserDir = getUserDir(userId);
      if (!fs.existsSync(newUserDir)) {
        fs.mkdirSync(newUserDir, { recursive: true });
      }
      fs.copyFileSync(webUserLitFile, litFile);
      // Also copy literature.json if it exists (contains embeddings)
      if (fs.existsSync(webUserLitJsonFile)) {
        const litJsonFile = path.join(getUserDir(userId), "literature.json");
        fs.copyFileSync(webUserLitJsonFile, litJsonFile);
        logger.info("[Literature] Copied literature.json from web-user to " + userId);
      }
      logger.info("[Literature] Copied literature from web-user to " + userId);
    }
  }
  
  if (!fs.existsSync(litFile)) {
    const dirs = fs.readdirSync(uploadDir);
    for (const dir of dirs) {
      if (dir.startsWith("web-") && dir !== "web-user") {
        const oldLit = path.join(uploadDir, dir, "literature.txt");
        const oldLitJson = path.join(uploadDir, dir, "literature.json");
        if (fs.existsSync(oldLit)) {
          const newUserDir = getUserDir(userId);
          if (!fs.existsSync(newUserDir)) {
            fs.mkdirSync(newUserDir, { recursive: true });
          }
          fs.copyFileSync(oldLit, litFile);
          if (fs.existsSync(oldLitJson)) {
            const litJsonFile = path.join(getUserDir(userId), "literature.json");
            fs.copyFileSync(oldLitJson, litJsonFile);
            logger.info("[Literature] Migrated literature.json from " + dir + " to " + userId);
          }
          logger.info("[Literature] Migrated literature from " + dir + " to " + userId);
          break;
        }
      }
    }
  }
  
  if (!fs.existsSync(litFile)) {
    res.json({ exists: false });
    return;
  }
  
  const content = fs.readFileSync(litFile, 'utf-8');
  const summary = getLitSummary(content);
  
  const userDir = getUserDir(userId);
  const journalStyleDir = path.join(userDir, "journal-styles");
  let journalStyles: string[] = [];
  
  if (fs.existsSync(journalStyleDir)) {
    const styleFolders = fs.readdirSync(journalStyleDir);
    for (const folder of styleFolders) {
      const stylePath = path.join(journalStyleDir, folder, "style.json");
      if (fs.existsSync(stylePath)) {
        try {
          const styleData = JSON.parse(fs.readFileSync(stylePath, 'utf-8'));
          if (Array.isArray(styleData) && styleData.length > 0) {
            const journalName = styleData[0]?.journal || folder;
            journalStyles.push(`${journalName} (${styleData.length}篇)`);
          }
        } catch (e) {
          logger.warn("[Literature] Failed to read style:", folder);
        }
      }
    }
  }
  
  if (journalStyles.length === 0 && userId !== "web-user") {
    const webUserStyleDir = path.join(uploadDir, "web-user", "journal-styles");
    if (fs.existsSync(webUserStyleDir)) {
      const styleFolders = fs.readdirSync(webUserStyleDir);
      for (const folder of styleFolders) {
        const stylePath = path.join(webUserStyleDir, folder, "style.json");
        if (fs.existsSync(stylePath)) {
          try {
            const styleData = JSON.parse(fs.readFileSync(stylePath, 'utf-8'));
            if (Array.isArray(styleData) && styleData.length > 0) {
              const journalName = styleData[0]?.journal || folder;
              journalStyles.push(`${journalName} (${styleData.length}篇)`);
            }
          } catch (e) {
            logger.warn("[Literature] Failed to read style from web-user:", folder);
          }
        }
      }
    }
  }
  
  res.json({ exists: true, summary, content, journalStyles });
});

app.post("/api/chat", chatUpload.none(), async (req: Request, res: Response) => {
  const userId = req.body.userId;
  const userMessage = req.body.message || "";
  const conversationId = req.body.conversationId || "";
  const history = JSON.parse(req.body.history || "[]");
  const apiUrl = req.body.apiUrl || process.env.API_URL;
  const apiKey = req.body.apiKey || process.env.API_KEY || "";
  const model = req.body.model || primaryModel;
  const agentConfig = req.body.agentConfig ? JSON.parse(req.body.agentConfig) : null;
  const webSearchKey = req.body.webSearchKey || process.env.TAVILY_API_KEY || "";
  
  logger.info(`[Chat] User: ${userId}, Message: ${userMessage.substring(0, 50)}..., API: ${apiUrl}`);
  
  // 加载用户记忆和文献
  const userMemory = loadUserMemory(userId);
  let memoryContext = "";
  let writingProgressContext = "";
  
  if (userMemory.entries.length > 0) {
    // 提取写作进度相关记忆
    const writingProgressEntry = userMemory.entries.find(e => e.key === 'writing_progress');
    const completedChaptersEntry = userMemory.entries.find(e => e.key === 'completed_chapters');
    const pendingChaptersEntry = userMemory.entries.find(e => e.key === 'pending_chapters');
    
    if (writingProgressEntry || completedChaptersEntry || pendingChaptersEntry) {
      writingProgressContext = "\n## 📝 当前写作进度\n";
      if (writingProgressEntry?.value && writingProgressEntry.value !== "无") {
        writingProgressContext += `**整体进度**: ${writingProgressEntry.value}\n`;
      }
      if (completedChaptersEntry?.value && completedChaptersEntry.value !== "无") {
        writingProgressContext += `**已完成章节**: ${completedChaptersEntry.value}\n`;
      }
      if (pendingChaptersEntry?.value && pendingChaptersEntry.value !== "无") {
        writingProgressContext += `**待完成章节**: ${pendingChaptersEntry.value}\n`;
      }
      logger.info("[Memory] Loaded writing progress for user:", userId);
    }
    
    // 其他记忆
    memoryContext = "\n## 🧠 历史记忆\n";
    for (const entry of userMemory.entries.slice(-10)) {
      if (!['writing_progress', 'completed_chapters', 'pending_chapters'].includes(entry.key)) {
        memoryContext += `- ${entry.key}: ${entry.value}\n`;
      }
    }
    logger.info("[Memory] Loaded", userMemory.entries.length, "memory entries for user:", userId);
  }
  
  try {
    const userDir = getUserDir(userId);
    const litFile = path.join(userDir, "literature.txt");
    const litJsonFile = path.join(userDir, "literature.json");
    
    let literaturePapers: LitPaper[] = [];
    let literatureSummary = "";
    let hasLiterature = false;
    
    if (fs.existsSync(litFile)) {
      hasLiterature = true;
      if (fs.existsSync(litJsonFile)) {
        try {
          literaturePapers = JSON.parse(fs.readFileSync(litJsonFile, 'utf-8'));
        } catch (e) {
          const litContent = fs.readFileSync(litFile, 'utf-8');
          literaturePapers = parseLiteratureToStructured(litContent);
        }
      } else {
        const litContent = fs.readFileSync(litFile, 'utf-8');
        literaturePapers = parseLiteratureToStructured(litContent);
      }
      
      const summary = getLitSummary(fs.readFileSync(litFile, 'utf-8'));
      literatureSummary = `文献总数: ${summary.count} 篇, 年份: ${summary.years.join(", ")}, 期刊: ${summary.journals.slice(0, 5).join(", ")}`;
    }
    
    const journalStyleDir = path.join(userDir, "journal-styles");
    let journalStyleContent = "";
    let journalStyleHint = "";
    if (fs.existsSync(journalStyleDir)) {
      const styleFiles = fs.readdirSync(journalStyleDir);
      if (styleFiles.length > 0) {
        const latestStyle = styleFiles.sort().pop();
        if (latestStyle) {
          const stylePath = path.join(journalStyleDir, latestStyle, "style.json");
          if (fs.existsSync(stylePath)) {
            try {
              const styleData = JSON.parse(fs.readFileSync(stylePath, 'utf-8'));
              journalStyleContent = "\n## 目标期刊风格指南\n";
              journalStyleContent += `已分析 ${styleData.length} 篇论文的写作风格。详细内容：\n\n`;
              for (let i = 0; i < Math.min(styleData.length, 3); i++) {
                const paper = styleData[i];
                journalStyleContent += `### 文献 ${i + 1}: ${paper.paper_title}\n`;
                journalStyleContent += `期刊：${paper.journal}, 年份：${paper.year}\n`;
                
                // 整体风格
                if (paper.overall_style) {
                  const os = paper.overall_style;
                  journalStyleContent += `风格特点：${os.formality || 'unknown'}, 语气：${os.argument_tone || 'unknown'}, 模糊限制词：${os.hedging_frequency || 'unknown'}\n`;
                  if (os.summary) {
                    journalStyleContent += `总结：${os.summary}\n`;
                  }
                }
                
                // 引用格式
                if (paper.citation_format) {
                  const cf = paper.citation_format;
                  journalStyleContent += `引用格式：${cf.in_text_style || 'unknown'} (例：${cf.example || 'unknown'})\n`;
                }
                
                // 章节特征
                if (paper.section_features) {
                  for (const [sectionName, sectionData] of Object.entries(paper.section_features)) {
                    const sd = sectionData as Record<string, unknown>;
                    if (Array.isArray(sd.common_verbs) && sd.common_verbs.length > 0) {
                      journalStyleContent += `\n${sectionName} 常用动词：${(sd.common_verbs as string[]).slice(0, 10).join(", ")}\n`;
                    }
                    if (Array.isArray(sd.common_phrases) && sd.common_phrases.length > 0) {
                      journalStyleContent += `${sectionName} 常用短语：${(sd.common_phrases as string[]).slice(0, 5).join("; ")}\n`;
                    }
                    if (sd.tense) {
                      journalStyleContent += `${sectionName} 时态：${sd.tense}\n`;
                    }
                    if (sd.voice) {
                      journalStyleContent += `${sectionName} 语态：${sd.voice}\n`;
                    }
                  }
                }
                
                // 可迁移写作规则
                if (Array.isArray(paper.transferable_rules) && paper.transferable_rules.length > 0) {
                  journalStyleContent += `\n写作规则:\n`;
                  for (let j = 0; j < Math.min(paper.transferable_rules.length, 5); j++) {
                    journalStyleContent += `- ${paper.transferable_rules[j]}\n`;
                  }
                }
                
                journalStyleContent += "\n";
              }
              journalStyleHint = "\n你需要参考上述目标期刊的写作风格来撰写内容。\n";
            } catch (e) {
              logger.warn("[JournalStyle] Failed to load style file:", e);
            }
          }
        }
      }
    }
    
    const decisionPrompt = `你是一个专业的学术论文写作助手。

## 文献库信息
${hasLiterature ? literatureSummary : "用户还没有上传文献。"}
${journalStyleHint}

## 用户问题
"${userMessage}"

## 你的任务
分析用户的问题，做出三个决策：
1. 是否需要从文献库中搜索相关文献？
2. 是否需要联网搜索最新信息？
3. 用户想要做什么？（回答问题/写讨论/写引言/其他）

## 决策规则
- 如果用户问的是具体研究问题、需要引用文献、或者要写Discussion/引言，**必须搜索文献库**
- 如果问题涉及最新研究成果（2024-2026）、实时数据，**必须联网搜索**
- 文献库搜索优先级更高，因为用户上传的文献更可信

## 输出格式
返回以下 JSON 格式：
{
  "need_lit_search": true/false,
  "lit_search_keywords": "文献库搜索关键词（多个用逗号分隔）",
  "need_web_search": true/false,
  "web_search_query": "联网搜索关键词",
  "task_type": "回答问题/写讨论/写引言/其他",
  "reason": "判断理由"
}

只返回 JSON，不要有其他文字。`;

    const decisionMessages = [
      { role: "system", content: decisionPrompt },
      { role: "user", content: userMessage }
    ];
    
    let needLitSearch = false;
    let litSearchKeywords = "";
    let needWebSearch = false;
    let webSearchQuery = "";
    let taskType = "回答问题";
    
    let decisionText = "";
    try {
      const decisionResult = await callLLM(apiUrl, apiKey, model, decisionMessages, 0.3, 600);
      decisionText = decisionResult.content;
      
      const jsonMatch = decisionText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const decision = JSON.parse(jsonMatch[0]);
        needLitSearch = decision.need_lit_search === true;
        litSearchKeywords = decision.lit_search_keywords || "";
        needWebSearch = decision.need_web_search === true;
        webSearchQuery = decision.web_search_query || userMessage;
        taskType = decision.task_type || "回答问题";
        logger.info(`[Chat] AI decision: lit=${needLitSearch}(${litSearchKeywords}), web=${needWebSearch}, task=${taskType}, reason=${decision.reason}`);
      }
    } catch (e) {
      logger.warn("[Chat] Failed to parse decision, text was:", decisionText.substring(0, 100));
    }
    
    let relevantLiterature = "";
    
    if (needLitSearch && literaturePapers.length > 0) {
      const keywords = litSearchKeywords.split(/[,，]/).map(k => k.trim()).filter(k => k);
      const searchQuery = keywords.join(" ") || userMessage;
      
      const searchResults = searchLiterature(searchQuery, literaturePapers, 10);
      
      if (searchResults.length > 0) {
        relevantLiterature = "\n【相关文献】\n以下是相关文献的完整信息（已包含作者、年份、标题、期刊、DOI、摘要等，可直接用于引用）：\n\n";
        for (let i = 0; i < searchResults.length; i++) {
          const r = searchResults[i];
          relevantLiterature += `文献 ${i + 1}（可直接引用）：\n`;
          relevantLiterature += `  标题: ${r.paper.title}\n`;
          relevantLiterature += `  作者: ${r.paper.author}\n`;
          relevantLiterature += `  年份: ${r.paper.year}\n`;
          relevantLiterature += `  期刊: ${r.paper.journal}\n`;
          relevantLiterature += `  DOI: ${r.paper.doi || 'N/A'}\n`;
          relevantLiterature += `  摘要: ${r.paper.abstract || '无'}\n`;
          relevantLiterature += `  匹配字段: ${r.matchFields.join(", ")}\n\n`;
        }
        logger.info(`[LitSearch] Found ${searchResults.length} relevant papers for: ${searchQuery}`);
      } else {
        logger.info(`[LitSearch] No relevant papers found for: ${searchQuery}`);
      }
    }
    
    let webSearchContext = "";
    
    if (needWebSearch && webSearchKey) {
      try {
        logger.info("[WebSearch] AI decided to search for:", webSearchQuery);
        const searchResponse = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: webSearchKey,
            query: webSearchQuery,
            max_results: 5,
            include_answer: true,
            include_raw_content: false,
          }),
        });
        
        const searchData = await searchResponse.json() as {
          results?: Array<{ title?: string; url?: string; content?: string }>;
        };
        
        if (searchData.results && searchData.results.length > 0) {
          webSearchContext = "\n【网络搜索结果】\n";
          for (let i = 0; i < Math.min(searchData.results.length, 5); i++) {
            const r = searchData.results[i];
            webSearchContext += `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content ? r.content.substring(0, 300) : ''}\n\n`;
          }
          logger.info("[WebSearch] Found", searchData.results.length, "results");
        }
      } catch (e) {
        logger.error("[WebSearch] Error:", e);
      }
    } else if (needWebSearch && !webSearchKey) {
      logger.warn("[WebSearch] AI wanted to search but no API key configured");
    }
    
    let taskHint = "";
    if (taskType === "写讨论") {
      taskHint = "\n## 写作任务\n用户想要你写 Discussion（讨论）部分。请：\n1. 基于提供的相关文献来写\n2. 比较不同研究的发现\n3. 解释结果与现有文献的一致性或差异\n4. 讨论研究局限性和未来方向\n5. 使用 '(作者, 年份)' 格式引用文献\n";
    } else if (taskType === "写引言") {
      taskHint = "\n## 写作任务\n用户想要你写 Introduction（引言）部分。请：\n1. 介绍研究背景\n2. 阐述研究缺口\n3. 提出研究目标\n4. 使用 '(作者, 年份)' 格式引用文献\n";
    }
    
    let memoryIntro = "";
    if (userMemory.entries.length > 0 || userMemory.conversations.length > 0) {
      memoryIntro = "\n## 跨会话长久记忆\n系统已记录您之前分享的信息：\n";
      for (const entry of userMemory.entries.slice(-8)) {
        memoryIntro += `- **${entry.key}**: ${entry.value}\n`;
      }
      if (userMemory.conversations.length > 0) {
        memoryIntro += `\n**历史对话**：共 ${userMemory.conversations.length} 个对话\n`;
        for (const conv of userMemory.conversations.slice(-5)) {
          memoryIntro += `- ${conv.title}: ${conv.summary.substring(0, 50)}...\n`;
        }
      }
      memoryIntro += "\n注意：每次对话结束后，系统会自动提取本对话的重要信息并更新到长久记忆中。如果需要查找特定历史对话的详细内容，可以使用搜索功能。\n";
    } else {
      memoryIntro = "\n## 跨会话长久记忆\n本对话结束后，系统将自动提取重要信息（研究主题、目标期刊、关键概念等）并保存到长久记忆中，供未来对话使用。\n";
    }
    
    const finalSystemPrompt = `你是一个专业的学术论文写作助手。${soulContent ? soulContent + "\n" : ""}
${memoryIntro}
${memoryContext}
${writingProgressContext}

## 你的能力
1. **文献库搜索**：可以从用户上传的【相关文献】中查找信息
2. **联网搜索**：已配置 Tavily API，可以搜索互联网最新研究（仅用于背景信息，**不能用于参考文献**）
3. **智能引用**：自动使用 "(作者，年份)" 格式引用【相关文献】
4. **写作进度追踪**：系统记录用户的写作进度，可以continuation 未完成的章节

## ⚠️ 重要：引用来源限制

### 可以引用的来源（【相关文献】）
- 用户上传的文献库中的文献
- 位于 【相关文献】 部分的文献
- 包含完整作者、年份、标题、期刊信息

### 不可以引用的来源
- 【网络搜索结果】**绝对不能**用于参考文献
- 不要从网络搜索结果中编造作者和年份
- 不要引用你未在【相关文献】中看到的文献

### 严格禁止
❌ **严禁编造引用**：
- 不要编造不存在的 "(作者, 年份)"
- 不要猜测网络搜索结果的作者
- 如果不确定，宁可不引用

✅ **正确做法**：
- 只引用【相关文献】中明确列出的文献
- 如果【相关文献】中没有相关信息，请明确告知用户
- 可以建议用户上传更多相关文献

## 文献库信息
${hasLiterature ? literatureSummary : "用户还没有上传文献。"}
${journalStyleContent}
${journalStyleHint}

${relevantLiterature ? relevantLiterature : "【相关文献】\n暂无相关文献匹配当前查询。\n"}
${webSearchContext}
${taskHint}

## 历史对话检索
你有访问历史对话的能力。当用户询问之前讨论过的内容，而你的长期记忆中没有足够细节时，你可以：
1. 根据用户提供的关键词（如"上周讨论的实验设计"、"关于 WFPS 的对话"）
2. 从对话历史列表中找到相关的对话标题或摘要
3. 如果找到了相关对话但信息不够，可以告知用户你记得有这个对话，但建议查看具体对话获取完整信息

目前系统已保存 ${userMemory.conversations.length} 个历史对话的摘要，你可以查看它们的标题和主题。

## 自动记忆系统（重要）
**本系统会自动提取和保存对话中的重要信息，你不需要手动创建文件。**

每次对话结束后，系统会自动：
1. 提取实验资料信息 - 保存到 experiment_summary
2. 提取数据详情 - 保存到 data_summary
3. 提取写作进度 - 保存到 writing_progress、completed_chapters、pending_chapters
4. 提取关键信息 - 如研究主题、目标期刊、关键概念等

用户可以通过界面左侧按钮查看总结。

## 回答要求
1. 回答必须有文献依据
2. 必须使用 "(作者，年份)" 格式引用具体文献，如 "(Wang et al., 2023)"
3. 如果有相关文献，必须引用；不要编造引用
4. 必须遵循上述目标期刊的写作风格
5. 使用专业的学术表达
6. 结构清晰，逻辑严密
7. **重要**：【相关文献】部分已包含每篇文献的完整信息（作者、年份、标题、期刊、DOI、摘要），请直接使用这些信息撰写内容，**不要**向用户索要文献信息
8. **绝对禁止**说"无法确认"、"无法访问"、"无法验证"等 - 你拥有完整信息，请直接使用！

## 📝 论文草稿功能（重要）
**用户可以让你将写作内容保存到论文草稿中。**

当用户说"保存到草稿"、"更新到草稿"等时，你必须在回复最后包含以下格式的触发指令（三个反引号开始，三个反引号结束）：

🔧 调用工具：save_draft
content: |
[这里写入 LaTeX 格式的内容，可以包含多行]
section: [章节名，如 introduction, methods, results, discussion, conclusion, abstract]

示例格式（三个反引号开始）：
🔧 调用工具：save_draft
content: |
\\section{Introduction}
Climate change has become one of the most pressing challenges facing global agriculture (Smith et al., 2023).
section: introduction
（三个反引号结束）

LaTeX 格式要求：
- 使用 \\section{}, \\subsection{} 组织章节
- 使用 \\cite{} 引用文献
- 使用 \\begin{equation} 编写公式
- 使用 \\textbf{}, \\textit{} 强调文字

注意事项：
1. 只要用户请求保存到草稿，就必须包含上述触发指令
2. content 后面使用 | 符号表示多行内容
3. section 必须是英文小写章节名
4. 保存后告知用户已保存到哪个章节

## 📰 目标期刊智能（新功能）
**当用户提到目标期刊名称时：**
1. 告知用户你会搜索该期刊的官网，获取官方写作要求
2. 系统会自动提取期刊的：
   - 期刊范围（Aims & Scope）
   - 文章类型（Research Article, Review 等）
   - 字数限制和格式要求
   - 写作偏好和审稿标准
3. 这些信息会保存到用户的长期记忆中
4. 在后续写作中参考这些要求

**示例响应**：
"好的，Nature Climate Change 是顶级期刊。我会搜索该期刊的官方网站，获取其 aims & scope 和 author guidelines，然后帮你按照期刊要求来写作。"

## ⚠️ 写作流程要求（非常重要）
**绝对不要一次性生成整个章节！** 必须采用渐进式写作：

1. **用户请求写作时，先询问写作重点**
   - "好的，我来帮你写引言。请问你想在引言中重点阐述什么？"
   - 引导用户说明：研究背景、研究缺口、研究问题、创新点

2. **建议章节结构，等用户确认**
   - "根据你的研究，建议引言包括 3 段：①研究背景 ②研究缺口 ③研究目标"
   - "你觉得这个结构可以吗？需要调整吗？"

3. **分段写作，逐段确认**
   - 一次只写 1 个段落
   - 写完后问："第 1 段写好了，你看这样可以吗？需要调整什么吗？"
   - **等用户确认后再写下一段**

4. **记住：用户是研究专家，你是写作助手。不要替用户做决定。**
7. 如果用户continuation 之前未完成的章节，请基于写作进度记忆继续`;

    const messages: Array<{ role: string; content: string }> = [{ role: "system", content: finalSystemPrompt }];
    
    for (const msg of history.slice(-10)) {
      const role = msg.role === "bot" ? "assistant" : (msg.role === "user" ? "user" : msg.role);
      messages.push({ role: role, content: msg.content });
    }
    
    messages.push({ role: "user", content: userMessage });
    
    const llmResult = await callLLM(apiUrl, apiKey, model, messages, 0.7, 4096);
    let response = llmResult.content || "抱歉，我无法生成回复。";
    
    const draftMatch = response.match(/```[\s\S]*?🔧 调用工具：save_draft[\s\S]*?```/);
    if (draftMatch) {
      const draftBlock = draftMatch[0];
      const contentMatch = draftBlock.match(/content:\s*\|[\s\S]*?(?=\n\s*section:)/);
      const sectionMatch = draftBlock.match(/section:\s*(\w+)/);
      
      if (contentMatch && sectionMatch) {
        let draftContent = contentMatch[1].trim();
        const section = sectionMatch[1];
        
        draftContent = draftContent.replace(/^```/, '').replace(/```$/,'').trim();
        
        try {
          const unifiedId = isFeishuUserId(userId) ? getUnifiedUserId(userId) : userId;
          const latexContent = hasLiterature && literaturePapers.length > 0 
            ? convertCitationsToLaTeX(draftContent, literaturePapers)
            : draftContent;
          await saveDraftContent(userId, section, latexContent, 'append');
          logger.info(`[Chat] Draft saved: ${section} for ${unifiedId}`);
          response = response.replace(draftMatch[0], `\n✅ 已保存到 ${section} 草稿\n`);
        } catch (e) {
          logger.error("[Chat] Failed to save draft:", e);
          response = response.replace(draftMatch[0], `\n⚠️ 草稿保存失败: ${(e as Error).message}\n`);
        }
      }
    }
    
    const conversationId = req.body.conversationId || `conv-${Date.now()}`;
    updateMemoryWithAI(userId, conversationId, userMessage, response, history, apiUrl, apiKey, model).then(() => {
      logger.info("[Memory] Memory update completed for user:", userId);
    }).catch(e => {
      logger.warn("[Memory] Failed to update memory:", e);
    });
    
    res.json({ response, conversationId });
  } catch (error) {
    logger.error("[Chat] Error:", error);
    res.json({ error: "处理请求时出错: " + (error as Error).message });
  }
});

app.get("/api/memory/:userId", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const unifiedId = isFeishuUserId(userId) ? getUnifiedUserId(userId) : userId;
  logger.info(`[Memory API] Request for userId: ${userId} -> unifiedId: ${unifiedId}`);
  const memory = loadUserMemory(userId);
  logger.info(`[Memory API] Returning ${memory.entries.length} entries, userId in memory: ${memory.userId}`);
  res.json({ 
    entries: memory.entries,
    conversations: memory.conversations,
    count: memory.conversations.length,
    unifiedId: unifiedId
  });
});

app.get("/api/memory/:userId/search", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const query = req.query.q as string;
  
  if (!query) {
    res.json({ results: [] });
    return;
  }
  
  const results = searchConversations(userId, query);
  res.json({ results, query });
});

app.get("/api/memory/:userId/conversation/:conversationId", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const conversationId = req.params.conversationId;
  const conversation = loadConversation(userId, conversationId);
  
  if (conversation) {
    res.json({ found: true, conversation });
  } else {
    res.json({ found: false });
  }
});

app.post("/api/memory/:userId/update", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const { experimentSummary, dataSummary, merge = true } = req.body;
  
  try {
    const memory = loadUserMemory(userId);
    
    const existingExperimentSummary = memory.entries.find(e => e.key === 'experiment_summary')?.value || '';
    const existingDataSummary = memory.entries.find(e => e.key === 'data_summary')?.value || '';
    
    const mergePrompt = (existingMemory: string, newContent: string, fieldName: string) => {
      return `你是一个研究数据管理助手。你的任务是将用户提供的新信息与现有的记忆进行智能合并。

## 现有记忆
${existingMemory ? existingMemory : '（暂无现有记忆）'}

## 用户提供的新信息
${newContent}

## 你的任务
请将上述两部分信息合并成一个完整、简洁的"${fieldName}"。

## 合并原则
1. **去重**：如果新信息与现有记忆重复，保留一份即可，不要重复
2. **补充**：如果新信息是现有记忆的补充（新的实验细节、新的数据等），将其自然融入到现有内容中
3. **更新**：如果新信息与现有记忆冲突（如修正了之前的数据），以新信息为准
4. **简洁**：合并后的内容应该简洁连贯，不要有冗余的过渡语句
5. **完整**：确保所有重要信息都被保留，形成一个完整的${fieldName}

## 输出要求
- 输出一个连贯的文字段落
- 不要使用"新增"、"补充"、"更新"等过渡词
- 直接输出合并后的完整内容，不要解释
- 保留所有具体数值和关键细节

## 输出格式
直接输出合并后的完整${fieldName}内容，不要有其他文字。`;
    };
    
    let finalExperimentSummary = experimentSummary;
    let finalDataSummary = dataSummary;
    
    if (merge && experimentSummary) {
const apiUrl = process.env.API_URL || "";
      const apiKey = process.env.API_KEY || "";
      const model = process.env.PRIMARY_MODEL || "qwen3.5-plus";
      
      if (existingExperimentSummary) {
        const oldLen = existingExperimentSummary.length;
        const newLen = experimentSummary.length;
        logger.info(`[Memory/Update] experiment_summary: 旧值长度=${oldLen}, 新值长度=${newLen}`);
        
        try {
          logger.info("[Memory/Update] 尝试 LLM 合并 experiment_summary...");
          const mergeResult = await callLLM(apiUrl, apiKey, model, [
            { role: "system", content: mergePrompt(existingExperimentSummary, experimentSummary, '实验资料总结') },
            { role: "user", content: "请合并上述实验资料。" }
          ], 0.3, 3000);
          const mergedContent = mergeResult.content;
          if (mergedContent && mergedContent.length > 10) {
            finalExperimentSummary = mergedContent.trim();
            logger.info("[Memory/Update] ✓ LLM 合并成功, 最终长度:", finalExperimentSummary.length);
          } else {
            logger.warn("[Memory/Update] LLM 合并返回内容过短，使用 safeMergeSummary 备用");
            finalExperimentSummary = safeMergeSummary(existingExperimentSummary, experimentSummary);
          }
        } catch (e) {
          logger.warn("[Memory/Update] LLM 合并失败，使用 safeMergeSummary 备用:", (e as Error).message);
          finalExperimentSummary = safeMergeSummary(existingExperimentSummary, experimentSummary);
        }
        
        const mergedLen = finalExperimentSummary.length;
        logger.info(`[Memory/Update] 合并结果: ${oldLen} + ${newLen} → ${mergedLen}`);
      }
      
      if (dataSummary && existingDataSummary) {
        const oldLen = existingDataSummary.length;
        const newLen = dataSummary.length;
        logger.info(`[Memory/Update] data_summary: 旧值长度=${oldLen}, 新值长度=${newLen}`);
        
        try {
          logger.info("[Memory/Update] 尝试 LLM 合并 data_summary...");
          const mergeResult = await callLLM(apiUrl, apiKey, model, [
            { role: "system", content: mergePrompt(existingDataSummary, dataSummary, '数据详细总结') },
            { role: "user", content: "请合并上述数据总结。" }
          ], 0.3, 3000);
          const mergedContent = mergeResult.content;
          if (mergedContent && mergedContent.length > 10) {
            finalDataSummary = mergedContent.trim();
            logger.info("[Memory/Update] ✓ LLM 合并成功, 最终长度:", finalDataSummary.length);
          } else {
            logger.warn("[Memory/Update] LLM 合并返回内容过短，使用 safeMergeSummary 备用");
            finalDataSummary = safeMergeSummary(existingDataSummary, dataSummary);
          }
        } catch (e) {
          logger.warn("[Memory/Update] LLM 合并失败，使用 safeMergeSummary 备用:", (e as Error).message);
          finalDataSummary = safeMergeSummary(existingDataSummary, dataSummary);
        }
        
        const mergedLen = finalDataSummary.length;
        logger.info(`[Memory/Update] 合并结果: ${oldLen} + ${newLen} → ${mergedLen}`);
      }
    }
    
    if (finalExperimentSummary) {
      const existingIndex = memory.entries.findIndex(e => e.key === 'experiment_summary');
      const newEntry: MemoryEntry = {
        key: 'experiment_summary',
        value: finalExperimentSummary,
        source: 'user-updated',
        timestamp: new Date().toISOString()
      };
      
      if (existingIndex >= 0) {
        memory.entries[existingIndex] = newEntry;
        logger.info("[Memory/Update] ✓ 已更新 experiment_summary");
      } else {
        memory.entries.push(newEntry);
        logger.info("[Memory/Update] ✓ 已新增 experiment_summary");
      }
    }
    
    if (finalDataSummary) {
      const existingIndex = memory.entries.findIndex(e => e.key === 'data_summary');
      const newEntry: MemoryEntry = {
        key: 'data_summary',
        value: finalDataSummary,
        source: 'user-updated',
        timestamp: new Date().toISOString()
      };
      
      if (existingIndex >= 0) {
        memory.entries[existingIndex] = newEntry;
        logger.info("[Memory/Update] ✓ 已更新 data_summary");
      } else {
        memory.entries.push(newEntry);
        logger.info("[Memory/Update] ✓ 已新增 data_summary");
      }
    }
    
    saveUserMemory(memory);
    logger.info("[Memory/Update] 手动更新完成, 用户:", userId);
    
    res.json({ 
      success: true, 
      message: "记忆已更新", 
      merged: merge,
      experimentSummaryLength: finalExperimentSummary?.length || 0,
      dataSummaryLength: finalDataSummary?.length || 0
    });
  } catch (e) {
    logger.error("[Memory/Update] 手动更新失败:", e);
    res.json({ success: false, error: "更新失败：" + (e as Error).message });
  }
});

app.post("/api/analyze-journal-style", upload.array("files", 10), async (req: Request, res: Response) => {
  const userId = req.body.userId || "web-user";
  const apiUrl = req.body.apiUrl || process.env.API_URL;
  const apiKey = req.body.apiKey || process.env.API_KEY || "";
  const userDir = getUserDir(userId);
  
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  
  const files = req.files as Express.Multer.File[];
  if (files.length === 0) {
    res.json({ success: false, error: "请上传目标期刊的文献" });
    return;
  }
  
  logger.info(`[JournalStyle] Starting analysis of ${files.length} papers`);
  
  try {
    // 逐个处理每篇论文
    const allStyleGuides: any[] = [];
  
  for (let i = 0; i < Math.min(files.length, 5); i++) {
    const file = files[i];
    const ext = path.extname(file.originalname).toLowerCase();
    logger.info(`[JournalStyle] Processing paper ${i + 1}/${Math.min(files.length, 5)}: ${file.originalname}`);
    
    // 直接读取文件内容发送给 AI
    let paperContent = '';
    
    if (file.buffer) {
      // 将 PDF 转为 base64 发送给 AI
      const base64 = file.buffer.toString('base64');
      paperContent = `文件名：${file.originalname}\n文件类型：${ext}\n文件内容（base64）：${base64.slice(0, 50000)}`;
    } else {
      const content = fs.readFileSync(file.path);
      const base64 = content.toString('base64');
      paperContent = `文件名：${file.originalname}\n文件类型：${ext}\n文件内容（base64）：${base64.slice(0, 50000)}`;
    }
    
    const singlePaperPrompt = `你是一名学术写作风格分析专家。你的任务不是总结论文内容，而是从输入的期刊论文中提取"可用于模仿写作"的风格特征，尤其是适用于小论文（short paper / brief article / journal article）的写作风格。

请基于提供的论文全文或分章节内容，分析该期刊论文的写作风格，并输出为结构化 JSON。

## 分析目标维度

### 1. 整体风格
- 语言风格是正式、客观、谨慎，还是直接、强调结论？
- 论证语气偏保守还是肯定？
- 是否常用模糊限制词（如 may, might, suggest, likely）？

### 2. 篇章结构
- 摘要、引言、方法、结果、讨论、结论各部分的典型长度和功能
- 常见章节组织顺序
- 每一部分常见的写作目的与推进方式

### 3. 论证模式
- 引言是否采用"研究背景 → 文献不足 → 研究目标/贡献"的套路
- 结果部分是"先报结果再解释"，还是"边展示边讨论"
- 讨论部分是否强调理论意义、实践意义、局限性、未来研究

### 4. 词汇与短语模式
- 每个章节常见高频动词、名词短语、连接表达（top20） 
- 常见学术套话，例如 "the results indicate that", "this study examines"
- 避免提取过于领域专属、不可迁移的实体名词，优先提取可复用的写作表达

### 5. 句法特征
- 平均句长、长短句比例
- 简单句、并列句、复合句比例
- 是否频繁使用从句、名词化结构、插入语
- 是否偏好长句压缩信息

### 6. 时态与语态
- 各章节的主要时态分布（一般现在时、一般过去时、现在完成时等）
- 主动语态与被动语态分布
- 哪些章节更偏被动表达

### 7. 引用与学术表达规范
- 文内引用格式
- 参考文献格式特征
- 是否常通过引用来支持背景、方法或讨论

### 8. 可迁移写作规则
- 最后请总结成可供 AI 写作调用的规则列表
- 规则应可执行、可模仿、简洁明确
- 例如：
  - "引言第一段先交代研究背景，第二段指出现有研究不足，最后一句明确本文目标"
  - "结果部分优先使用过去时描述实验发现，再用现在时概括其意义"
  - "避免使用口语化表达，倾向使用被动语态和名词化表达"

## 输出格式要求

1. **仅输出合法 JSON，不要输出解释性文字。**

2. **JSON 顶层字段必须包含：**
   - paper_title
   - journal
   - year
   - overall_style
   - tone_features
   - structure_features
   - argument_pattern
   - lexical_patterns
   - syntax_features
   - tense_distribution
   - voice_distribution
   - citation_format
   - section_features
   - transferable_rules

3. **section_features 必须至少包括：**
   - abstract
   - introduction
   - methods
   - results
   - discussion
   - conclusion

4. **每个 section 需要尽量包含：**
   - purpose
   - typical_moves
   - common_verbs
   - common_phrases
   - tense
   - voice
   - sentence_style

5. **transferable_rules 请输出 8-15 条具体规则，每条规则必须适合用于后续提示词注入。**

## JSON 输出模板

{
  "paper_title": "论文完整标题",
  "journal": "期刊名称",
  "year": "出版年份",
  
  "overall_style": {
    "formality": "正式/客观/谨慎/直接",
    "argument_tone": "保守/平衡/肯定",
    "hedging_frequency": "高/中/低",
    "summary": "整体风格总结（100 字以内）"
  },
  
  "tone_features": {
    "objectivity_level": "高/中/低",
    "confidence_level": "谨慎/平衡/自信",
    "common_hedging_words": ["may", "might", "suggest", "likely"],
    "emphasis_pattern": "描述性/分析性/批判性"
  },
  
  "structure_features": {
    "typical_section_order": ["introduction", "methods", "results", "discussion", "conclusion"],
    "section_lengths": {
      "abstract": "150-250 词",
      "introduction": "800-1500 词",
      "methods": "1000-2000 词",
      "results": "1500-2500 词",
      "discussion": "1500-2500 词",
      "conclusion": "300-500 词"
    },
    "paragraph_structure": "主题句 + 支撑句 + 结论句"
  },
  
  "argument_pattern": {
    "introduction_flow": "研究背景 → 文献不足 → 研究目标/贡献",
    "results_presentation": "先报结果再解释/边展示边讨论",
    "discussion_emphasis": ["理论意义", "实践意义", "局限性", "未来研究"]
  },
  
  "lexical_patterns": {
    "common_verbs": {
      "introduction": ["examine", "investigate", "explore", "address"],
      "methods": ["conducted", "measured", "analyzed", "calculated"],
      "results": ["showed", "revealed", "demonstrated", "indicated"],
      "discussion": ["suggest", "imply", "support", "highlight"]
    },
    "common_phrases": {
      "introduction": ["Previous studies have shown", "However, little is known", "This study aims to"],
      "methods": ["Data were collected", "Statistical analysis was performed", "We used"],
      "results": ["The results showed that", "Figure 1 presents", "There was a significant"],
      "discussion": ["These findings suggest", "Consistent with previous studies", "One limitation is"]
    },
    "transition_words": ["however", "therefore", "furthermore", "in addition", "consequently"]
  },
  
  "syntax_features": {
    "average_sentence_length": "20-25 词",
    "sentence_complexity": {
      "simple": 15,
      "compound": 35,
      "complex": 50
    },
    "frequent_structures": ["从句", "名词化", "插入语", "被动语态"],
    "information_density": "高/中/低"
  },
  
  "tense_distribution": {
    "abstract": { "present": 60, "past": 35, "present_perfect": 5 },
    "introduction": { "present": 65, "past": 30, "present_perfect": 5 },
    "methods": { "past": 90, "present": 10 },
    "results": { "past": 80, "present": 20 },
    "discussion": { "present": 60, "past": 35, "present_perfect": 5 },
    "conclusion": { "present": 60, "past": 20, "future": 20 }
  },
  
  "voice_distribution": {
    "abstract": { "active": 40, "passive": 60 },
    "introduction": { "active": 45, "passive": 55 },
    "methods": { "active": 20, "passive": 80 },
    "results": { "active": 35, "passive": 65 },
    "discussion": { "active": 50, "passive": 50 },
    "conclusion": { "active": 55, "passive": 45 }
  },
  
  "citation_format": {
    "in_text_style": "作者年份制/数字制",
    "example": "(Smith et al., 2023) 或 [1]",
    "reference_style": "APA/IEEE/Vancouver/Chicago/其他",
    "citation_frequency": "高/中/低"
  },
  
  "section_features": {
    "abstract": {
      "purpose": "概括研究目的、方法、主要发现和结论",
      "typical_moves": ["背景陈述", "研究目的", "方法概述", "主要结果", "结论"],
      "common_verbs": ["examine", "investigate", "show", "demonstrate"],
      "common_phrases": ["This study examines", "The results show", "We conclude that"],
      "tense": "一般现在时（目的/结论）+ 一般过去时（方法/结果）",
      "voice": "被动语态为主",
      "sentence_style": "简洁、紧凑、无引用"
    },
    "introduction": {
      "purpose": "建立研究背景、指出现有不足、明确研究目标",
      "typical_moves": ["广泛背景", "具体问题", "文献总结", "研究缺口", "研究目标/贡献"],
      "common_verbs": ["examine", "investigate", "address", "explore", "propose"],
      "common_phrases": ["Previous studies have shown", "However, little is known", "This study aims to", "We hypothesize that"],
      "tense": "一般现在时（已知事实）+ 一般过去时（前人研究）",
      "voice": "主动与被动混合",
      "sentence_style": "复杂句较多，大量引用"
    },
    "methods": {
      "purpose": "详细描述研究设计、数据收集和分析方法",
      "typical_moves": ["研究设计", "参与者/材料", "程序", "统计分析", "伦理声明"],
      "common_verbs": ["conducted", "measured", "collected", "analyzed", "calculated"],
      "common_phrases": ["Data were collected", "Statistical analysis was performed", "We used", "All procedures were"],
      "tense": "一般过去时为主",
      "voice": "被动语态为主",
      "sentence_style": "详细、技术性、标准化"
    },
    "results": {
      "purpose": "客观呈现研究发现",
      "typical_moves": ["主要结果", "次要结果", "补充分析", "图表引用"],
      "common_verbs": ["showed", "revealed", "demonstrated", "indicated", "found"],
      "common_phrases": ["The results showed that", "Figure 1 presents", "There was a significant", "As shown in"],
      "tense": "一般过去时（研究发现）+ 一般现在时（图表引用）",
      "voice": "被动语态较多",
      "sentence_style": "客观、数据驱动、标准化统计报告"
    },
    "discussion": {
      "purpose": "解释结果、与文献对比、讨论意义和局限性",
      "typical_moves": ["主要发现总结", "与文献对比", "解释说明", "局限性", "未来方向"],
      "common_verbs": ["suggest", "imply", "support", "highlight", "indicate"],
      "common_phrases": ["These findings suggest", "Consistent with previous studies", "One limitation is", "Future research should"],
      "tense": "一般现在时（解释）+ 一般过去时（结果回顾）",
      "voice": "主动与被动平衡",
      "sentence_style": "分析性、批判性、大量使用模糊限制语"
    },
    "conclusion": {
      "purpose": "总结主要贡献、阐述意义、展望未来",
      "typical_moves": ["研究总结", "贡献说明", "实践意义", "未来展望"],
      "common_verbs": ["conclude", "demonstrate", "provide", "suggest"],
      "common_phrases": ["In conclusion", "This study demonstrates", "Our findings suggest", "Future work should"],
      "tense": "一般现在时（结论）+ 一般将来时（展望）",
      "voice": "主动语态较多",
      "sentence_style": "简洁有力、前瞻性"
    }
  },
  
  "transferable_rules": [
    "引言第一段先交代研究背景，第二段指出现有研究不足，最后一句明确本文目标",
    "结果部分优先使用过去时描述实验发现，再用现在时概括其意义",
    "避免使用口语化表达，倾向使用被动语态和名词化表达",
    "方法部分使用一般过去时和被动语态，详细描述实验步骤",
    "讨论部分先总结主要发现，再与前人研究对比，最后说明局限性",
    "使用模糊限制词（may, suggest, likely）表达学术谨慎",
    "图表引用使用一般现在时（如'Figure 1 shows...'）",
    "摘要不包含引用，高度浓缩研究目的、方法、结果和结论",
    "引言大量引用前人研究来建立研究缺口",
    "结论部分避免引入新信息，专注于总结和展望",
    "使用连接词（however, therefore, furthermore）保证段落连贯",
    "统计结果报告遵循标准格式（M ± SD, 95% CI, p 值）",
    "讨论部分使用批判性分析，避免过度解读结果",
    "每段以主题句开头，随后是支撑句和结论句"
  ]
}

## 注意事项

- 你的目标是提取"写作风格"，不是复述研究内容。
- 不要把论文主题本身当作风格。
- 不要只做统计描述，要归纳为"可供生成模型模仿的写作规则"。
- 如果输入信息不足以判断某项，请明确写"unknown"或给出低置信度标记。
- 所有百分比数据总和应为 100%。
- 只返回 JSON，不要任何其他文字说明。

文件内容：
${paperContent}`;

    try {
      const result = await callLLM(apiUrl, apiKey, "qwen3.5-plus", [{ role: "user", content: singlePaperPrompt }], 0.3, 8000);
      const content = result.content;
      
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const styleGuide = JSON.parse(jsonMatch[0]);
          allStyleGuides.push(styleGuide);
          logger.info(`[JournalStyle] Paper ${i + 1} analyzed successfully`);
        } else {
          logger.warn(`[JournalStyle] Paper ${i + 1} no JSON found`);
        }
      } catch (e) {
        logger.warn(`[JournalStyle] Paper ${i + 1} parse error:`, e);
      }
    } catch (e) {
      logger.warn(`[JournalStyle] Paper ${i + 1} request error:`, e);
    }
  }
  
  if (allStyleGuides.length === 0) {
    res.json({ success: false, error: "所有论文分析失败，请检查 API 配置或文献内容" });
    return;
  }
  
  logger.info(`[JournalStyle] Completed analysis of ${allStyleGuides.length} papers`);
  
  // 保存所有风格分析结果
  const journalName = allStyleGuides[0]?.journal || "未知期刊";
  const safeName = journalName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').slice(0, 50);
  const styleDir = path.join(userDir, "journal-styles", safeName);
  
  if (!fs.existsSync(styleDir)) {
    fs.mkdirSync(styleDir, { recursive: true });
  }
  
  const styleFile = path.join(styleDir, "style.json");
  fs.writeFileSync(styleFile, JSON.stringify(allStyleGuides, null, 2), 'utf-8');
  
  logger.info("[JournalStyle] Saved styles for:", journalName, "Papers:", allStyleGuides.length);
  
  res.json({
    success: true,
    journal_name: journalName,
    papers_count: allStyleGuides.length,
    sections: ["abstract", "introduction", "methods", "results", "discussion", "conclusion"],
    folder: "journal-styles/" + safeName
  });
} catch (e) {
  logger.error("[JournalStyle] Error:", e);
  res.json({ success: false, error: "分析失败：" + (e as Error).message });
}
});

type DraftMode = 'append' | 'replace_section' | 'replace_paragraph' | 'format_only';

async function saveDraftContent(
  userId: string,
  section: string,
  content: string,
  mode: DraftMode = 'append'
): Promise<{ success: boolean; mode: DraftMode; section: string; length: number }> {
  const unifiedId = isFeishuUserId(userId) ? getUnifiedUserId(userId) : userId;
  
  const existingDraft = await sessionStore.loadDraft(unifiedId, section);
  let finalContent = content;
  let actualMode = mode;
  
  if (existingDraft && existingDraft.content) {
    const existingContent = existingDraft.content;
    
    switch (mode) {
      case 'append':
        if (existingContent.includes(content.trim())) {
          finalContent = existingContent;
          actualMode = 'format_only';
          logger.info(`[Draft] Content already exists in section ${section}, skipping append`);
        } else {
          finalContent = existingContent.trim() + '\n\n' + content.trim();
          logger.info(`[Draft] Appended to section ${section}, old=${existingContent.length}, added=${content.length}`);
        }
        break;
        
      case 'replace_section':
        finalContent = content;
        logger.info(`[Draft] Replaced section ${section}, old=${existingContent.length}, new=${content.length}`);
        break;
        
      case 'replace_paragraph':
        const paragraphs = existingContent.split(/\n\n+/);
        const newParagraphs = content.split(/\n\n+/);
        let replaced = false;
        
        for (let i = 0; i < Math.min(paragraphs.length, newParagraphs.length); i++) {
          if (newParagraphs[i].trim().length > 50) {
            paragraphs[i] = newParagraphs[i];
            replaced = true;
          }
        }
        
        if (!replaced && newParagraphs.length > 0) {
          paragraphs.push(...newParagraphs);
          actualMode = 'append';
        }
        
        finalContent = paragraphs.join('\n\n');
        logger.info(`[Draft] Replaced paragraphs in section ${section}`);
        break;
        
      case 'format_only':
        finalContent = existingContent;
        actualMode = 'format_only';
        logger.info(`[Draft] Format only mode, content unchanged for section ${section}`);
        break;
    }
  } else {
    actualMode = 'replace_section';
    logger.info(`[Draft] No existing content for section ${section}, creating new`);
  }
  
  await sessionStore.saveDraft(unifiedId, section, finalContent);
  
  return {
    success: true,
    mode: actualMode,
    section,
    length: finalContent.length
  };
}

function extractSectionFromLaTeX(content: string, sectionName: string): string | null {
  const patterns = [
    new RegExp(`\\\\section\\{${sectionName}[^\\}]*\\}([\\s\\S]*?)(?=\\\\section\\{|\\\\end\\{document\\}|$)`, 'i'),
    new RegExp(`\\\\subsection\\{${sectionName}[^\\}]*\\}([\\s\\S]*?)(?=\\\\subsection\\{|\\\\section\\{|\\\\end\\{document\\}|$)`, 'i'),
  ];
  
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  return null;
}

function replaceSectionInLaTeX(fullContent: string, sectionName: string, newSectionContent: string): string {
  const sectionPattern = new RegExp(
    `(\\\\section\\{${sectionName}[^\\}]*\\})([\\s\\S]*?)(?=\\\\section\\{|\\\\end\\{document\\}|$)`,
    'i'
  );
  
  const match = fullContent.match(sectionPattern);
  if (match) {
    return fullContent.replace(sectionPattern, `$1\n${newSectionContent}\n\n`);
  }
  
  const endDocPattern = /\\end\{document\}/;
  if (endDocPattern.test(fullContent)) {
    return fullContent.replace(endDocPattern, `\n\\section{${sectionName}}\n${newSectionContent}\n\n\\end{document}`);
  }
  
  return fullContent + `\n\n\\section{${sectionName}}\n${newSectionContent}\n`;
}

// ============ 论文草稿管理 ============

// 获取论文草稿
app.get("/api/draft/:userId", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const userDir = getUserDir(userId);
  const draftFile = path.join(userDir, "paper-draft.tex");
  const journalStyleDir = path.join(userDir, "journal-styles");
  
  // 获取目标期刊信息
  let journalName = "";
  if (fs.existsSync(journalStyleDir)) {
    const styleFolders = fs.readdirSync(journalStyleDir);
    if (styleFolders.length > 0) {
      journalName = styleFolders[0].replace(/_/g, ' ');
    }
  }
  
  if (fs.existsSync(draftFile)) {
    const content = fs.readFileSync(draftFile, 'utf-8');
    res.json({
      exists: true,
      content: content,
      journal_style: journalName || '目标期刊',
      filename: `paper-draft-${userId}`
    });
  } else {
    res.json({
      exists: false,
      journal_style: journalName || '目标期刊'
    });
  }
});

// 保存/更新论文草稿（section-aware 更新）
app.post("/api/draft/:userId", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const { content, section, append = true, mode = 'append' } = req.body;
  
  if (!content) {
    res.json({ success: false, error: "内容为空" });
    return;
  }
  
  const userDir = getUserDir(userId);
  const draftDir = path.join(userDir, "drafts");
  const draftFile = path.join(userDir, "paper-draft.tex");
  
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  if (!fs.existsSync(draftDir)) {
    fs.mkdirSync(draftDir, { recursive: true });
  }
  
  try {
    const journalStyleDir = path.join(userDir, "journal-styles");
    let latexStyle = "article";
    
    if (fs.existsSync(journalStyleDir)) {
      const styleFolders = fs.readdirSync(journalStyleDir);
      if (styleFolders.length > 0) {
        const styleFile = path.join(journalStyleDir, styleFolders[0], "style.json");
        if (fs.existsSync(styleFile)) {
          const styleData = JSON.parse(fs.readFileSync(styleFile, 'utf-8'));
          const citationFormat = styleData[0]?.citation_format;
          
          if (citationFormat?.reference_style === 'Nature') {
            latexStyle = "nature";
          }
        }
      }
    }
    
    let existingContent = "";
    if (fs.existsSync(draftFile)) {
      existingContent = fs.readFileSync(draftFile, 'utf-8');
    }
    
    if (!existingContent.includes("\\section{")) {
      const preamble = `\\documentclass[${latexStyle === 'nature' ? 'nature' : '12pt'}]{${latexStyle}}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{graphicx}
\\usepackage{natbib}
\\usepackage{hyperref}
\\usepackage[utf8]{inputenc}
\\usepackage{setspace}
\\doublespacing

\\title{学术论文草稿}
\\author{作者}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
摘要内容待填写...
\\end{abstract}

`;
      existingContent = preamble;
    }
    
    let newContent = "";
    let actualMode = mode;
    
    if (section && mode === 'replace_section') {
      const sectionResult = replaceSectionInLaTeX(existingContent, section, content);
      newContent = sectionResult;
      actualMode = 'replace_section';
      logger.info(`[Draft] Section-aware update for section: ${section}`);
    } else if (append && existingContent) {
      if (existingContent.includes("\\end{document}")) {
        const parts = existingContent.split("\\end{document}");
        newContent = parts[0] + content + "\n\n\\end{document}";
      } else {
        newContent = existingContent + "\n\n" + content;
      }
      actualMode = 'append';
    } else {
      newContent = content;
      actualMode = 'replace_all';
    }
    
    fs.writeFileSync(draftFile, newContent, 'utf-8');
    
    if (section) {
      const unifiedId = isFeishuUserId(userId) ? getUnifiedUserId(userId) : userId;
      await sessionStore.saveDraft(unifiedId, section, content);
      logger.info(`[Draft] Also saved section "${section}" to sessionStore`);
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupFile = path.join(draftDir, `draft-${section || 'section'}-${timestamp}.tex`);
    fs.writeFileSync(backupFile, newContent, 'utf-8');
    
    logger.info(`[Draft] Saved draft for user ${userId}, section: ${section || 'unknown'}, mode: ${actualMode}`);
    
    res.json({
      success: true,
      message: "草稿已保存",
      filename: `paper-draft-${userId}.tex`,
      mode: actualMode,
      section: section || null
    });
    
  } catch (e) {
    logger.error("[Draft] Error:", e);
    res.json({ success: false, error: "保存失败：" + (e as Error).message });
  }
});

// 清空草稿
app.delete("/api/draft/:userId", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const userDir = getUserDir(userId);
  const draftFile = path.join(userDir, "paper-draft.tex");
  
  if (fs.existsSync(draftFile)) {
    fs.unlinkSync(draftFile);
    logger.info(`[Draft] Deleted draft for user ${userId}`);
  }
  
  res.json({ success: true });
});

// ============ 章节草稿管理（统一使用 SessionStore） ============

// 保存章节草稿（支持多种模式）
app.post("/api/chapter-draft/:userId", async (req: Request, res: Response) => {
  try {
    const { chapter, content, mode = 'append' } = req.body;
    const userId = req.params.userId;
    
    if (!chapter || !content) {
      res.json({ success: false, error: "缺少章节名或内容" });
      return;
    }
    
    const validModes: DraftMode[] = ['append', 'replace_section', 'replace_paragraph', 'format_only'];
    const actualMode: DraftMode = validModes.includes(mode) ? mode : 'append';
    
    const result = await saveDraftContent(userId, chapter, content, actualMode);
    
    logger.info(`[ChapterDraft] Saved for user ${userId}, chapter ${chapter}, mode: ${result.mode}`);
    
    res.json({
      success: true,
      section: result.section,
      mode: result.mode,
      length: result.length,
      message: `章节 "${chapter}" 已保存 (模式: ${result.mode})`
    });
  } catch (e) {
    logger.error("[ChapterDraft] Save failed:", e);
    res.json({ success: false, error: "保存失败：" + (e as Error).message });
  }
});

app.delete("/api/chapter-draft/:userId/:chapter", async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;
    const chapter = req.params.chapter;
    const unifiedId = isFeishuUserId(userId) ? getUnifiedUserId(userId) : userId;
    
    await sessionStore.deleteDraft(unifiedId, chapter);
    
    const filePath = path.join(dataDir, 'output', 'chapters', userId, `${chapter}.md`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    logger.info(`[ChapterDraft] Deleted for user ${userId}, chapter ${chapter}`);
    res.json({ success: true });
  } catch (e) {
    logger.error("[ChapterDraft] Delete failed:", e);
    res.json({ success: false, error: "删除失败：" + (e as Error).message });
  }
});

// ============ 飞书配置管理 ============

app.post("/api/feishu/config", async (req: Request, res: Response) => {
  const { appId, appSecret } = req.body;
  
  if (!appId || !appSecret) {
    res.json({ success: false, error: "App ID 和 App Secret 不能为空" });
    return;
  }
  
  feishuAppId = appId;
  feishuAppSecret = appSecret;
  
  // 如果已有连接，先关闭并重新启动
  if (feishuWebSocketClient) {
    try {
      await feishuWebSocketClient.stop();
      logger.info('[Feishu] Stopped old WebSocket client');
    } catch (e) {
      logger.warn("[Feishu] Error stopping old client:", e);
    }
  }
  
  // 使用新配置启动 WebSocket
  try {
    const feishuHandler = new FeishuHandler({
      appId: feishuAppId,
      appSecret: feishuAppSecret,
    }, undefined, processChatMessage);
    
    feishuWebSocketClient = new FeishuWebSocketClient({
      appId: feishuAppId,
      appSecret: feishuAppSecret,
    }, feishuHandler);
    
    await feishuWebSocketClient.start();
    logger.info('[Feishu] WebSocket client restarted with new config');
    
    res.json({ 
      success: true, 
      message: "配置已更新，飞书机器人已自动启动",
      connected: feishuWebSocketClient.isConnectionAlive()
    });
  } catch (error) {
    logger.error('[Feishu] Failed to restart WebSocket:', error);
    res.json({ 
      success: false, 
      error: "配置已保存，但启动失败：" + (error as Error).message
    });
  }
});

app.get("/api/feishu/status", (req: Request, res: Response) => {
  res.json({
    configured: !!feishuAppId && !!feishuAppSecret,
    connected: feishuWebSocketClient?.isConnectionAlive() || false,
    appId: feishuAppId ? feishuAppId.substring(0, 8) + '...' : ''
  });
});

app.get("/api/chapter-draft/:userId/:chapterName", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const chapterName = req.params.chapterName;
  const unifiedId = isFeishuUserId(userId) ? getUnifiedUserId(userId) : userId;
  
  try {
    const draft = await sessionStore.loadDraft(unifiedId, chapterName);
    if (draft) {
      res.json({
        success: true,
        chapterName,
        content: draft.content,
        savedAt: draft.savedAt
      });
    } else {
      res.json({
        success: false,
        message: "草稿不存在"
      });
    }
  } catch (e) {
    logger.error("[ChapterDraft] Load failed:", e);
    res.json({ success: false, error: "加载失败：" + (e as Error).message });
  }
});

// 列出所有章节草稿
app.get("/api/chapter-drafts/:userId", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const unifiedId = isFeishuUserId(userId) ? getUnifiedUserId(userId) : userId;
  
  try {
    const drafts = await sessionStore.listDrafts(unifiedId);
    res.json({
      success: true,
      drafts,
      count: drafts.length
    });
  } catch (e) {
    logger.error("[ChapterDraft] List failed:", e);
    res.json({ success: false, error: "列出草稿失败：" + (e as Error).message });
  }
});

// 删除章节草稿
app.delete("/api/chapter-draft/:userId/:chapterName", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const chapterName = req.params.chapterName;
  const unifiedId = isFeishuUserId(userId) ? getUnifiedUserId(userId) : userId;
  
  try {
    await sessionStore.deleteDraft(unifiedId, chapterName);
    res.json({
      success: true,
      message: `章节 "${chapterName}" 草稿已删除`
    });
  } catch (e) {
    logger.error("[ChapterDraft] Delete failed:", e);
    res.json({ success: false, error: "删除失败：" + (e as Error).message });
  }
});

// 飞书配置（支持运行时动态更新）
let feishuAppId = process.env.FEISHU_APP_ID || "";
let feishuAppSecret = process.env.FEISHU_APP_SECRET || "";
let feishuWebSocketClient: FeishuWebSocketClient | undefined;

async function startFeishuWebSocket() {
  if (!feishuAppId || !feishuAppSecret) {
    logger.info('[Feishu] WebSocket not enabled (missing FEISHU_APP_ID or FEISHU_APP_SECRET)');
    return;
  }

  try {
    const feishuHandler = new FeishuHandler({
      appId: feishuAppId,
      appSecret: feishuAppSecret,
    }, undefined, processChatMessage);

    feishuWebSocketClient = new FeishuWebSocketClient({
      appId: feishuAppId,
      appSecret: feishuAppSecret,
    }, feishuHandler);

    await feishuWebSocketClient.start();
    logger.info('[Feishu] WebSocket client started successfully');

  } catch (error) {
    logger.error('[Feishu] Failed to start WebSocket client:', error);
  }
}

app.listen(port, () => {
  logger.info(
    "ScholarClaw running at http://localhost:" + port + " (Model: " + primaryModel + ")"
  );
  console.log("");
  console.log("========================================");
  console.log("     ScholarClaw - 论文写作助手");
  console.log("========================================");
  console.log(" 打开浏览器访问：http://localhost:" + port);
  console.log(" AI 模型：" + primaryModel);
  console.log("========================================");
  console.log("");

  startFeishuWebSocket();
});

process.on('SIGINT', async () => {
  logger.info('[Server] Shutting down...');
  if (feishuWebSocketClient) {
    await feishuWebSocketClient.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('[Server] Shutting down...');
  if (feishuWebSocketClient) {
    await feishuWebSocketClient.stop();
  }
  process.exit(0);
});

export default app;
