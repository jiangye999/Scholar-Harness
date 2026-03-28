import "dotenv/config";
import express, { Request, Response, Express } from "express";
import { logger } from "../utils/logger";
import { SessionStore } from "../storage/session-store";
import { BackupManager } from "../utils/backup-manager";
import * as path from "path";
import * as fs from "fs";
import multer from "multer";
import type { ChatOptions, Message } from "../types";
import { FeishuHandler } from "../messaging/feishu-handler";
import { FeishuWebSocketClient } from "../messaging/feishu-websocket";
import { ConversationFlow } from "../../workflows/conversation-flow";
import { HybridRetrievalEngine } from "../literature/retrieval";
import { setRetrievalEngine } from "./routes/literature";
import niceaigcRoutes, { initializeNiceAIGCRoutes } from "./routes/niceaigc";
import memoryRoutes from "./routes/memory";
import { NiceAIGCBridgeAdapter } from "../bridge/niceaigc/niceaigc-bridge";

const projectRoot = path.resolve(__dirname, "..", "..");
const dataDir = path.join(projectRoot, "data");
const publicDir = path.join(projectRoot, "src", "public");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const uploadDir = path.join(dataDir, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const sessionStore = new SessionStore(path.join(dataDir, "sessions"));

const backupManager = new BackupManager(dataDir, 10);
backupManager.initialize().catch(err => {
  logger.error('[Server] Failed to initialize backup manager:', err);
});

const memoryDir = path.join(dataDir, "memory");
if (!fs.existsSync(memoryDir)) {
  fs.mkdirSync(memoryDir, { recursive: true });
}

const skillDir = path.join(projectRoot, "sci_writing_skills");
if (!fs.existsSync(skillDir)) {
  logger.warn("[Skill] Writing skill directory not found:", skillDir);
} else {
  logger.info("[Skill] Writing skills loaded from:", skillDir);
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

// 逐句撰写状态
interface SentenceWritingState {
  chapter: string;           // 当前章节
  totalSentences: number;    // 总句数
  currentSentence: number;   // 当前句子索引（从1开始）
  sentences: Array<{
    id: string;              // S1, S2, S3...
    content?: string;        // 撰写内容
    searchQuery?: string;    // 检索词
    citations?: string[];    // 引用的文献
    status: 'pending' | 'searching' | 'writing' | 'completed';
  }>;
  updatedAt: string;
}

// 存储逐句撰写状态
const sentenceWritingStates = new Map<string, SentenceWritingState>();

// APIClient 实现
function createAPIClient(apiUrl: string, apiKey: string) {
  return {
    async chat(options: { model: string; messages: Message[]; temperature?: number; maxTokens?: number }): Promise<string> {
      const response = await fetch(apiUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify({
          model: options.model,
          messages: options.messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.maxTokens || 4000,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`API 错误 (${response.status}): ${await response.text()}`);
      }
      
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content || "";
    }
  };
}

function getMemoryFile(userId: string): string {
  const userMemoryDir = path.join(memoryDir, userId);
  if (!fs.existsSync(userMemoryDir)) {
    fs.mkdirSync(userMemoryDir, { recursive: true });
  }
  return path.join(userMemoryDir, "memory.json");
}

function getConversationFile(userId: string, conversationId: string): string {
  const conversationsDir = path.join(memoryDir, userId, "conversations");
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
      return {
        userId: data.userId || userId,
        entries: data.entries || [],
        conversations: data.conversations || [],
        updatedAt: data.updatedAt || new Date().toISOString()
      };
    } catch (e) {
      logger.warn("[Memory] Failed to load memory:", e);
    }
  }
  return { userId, entries: [], conversations: [], updatedAt: new Date().toISOString() };
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
  const conversationFile = getConversationFile(conversation.userId, conversation.id);
  conversation.updatedAt = new Date().toISOString();
  fs.writeFileSync(conversationFile, JSON.stringify(conversation, null, 2), 'utf-8');
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
    const response = await fetch(apiUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "system", content: extractPrompt }],
        temperature: 0.3,
        max_tokens: 2500,
      }),
    });
    
    let extracted: any = {};
    let content = "";
    
    if (response.ok) {
      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      content = data.choices?.[0]?.message?.content || "";
      
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
    } else {
      logger.warn("[Memory] API call failed, using fallback extraction");
    }
    
    // 无论 API 是否成功，都使用 fallback 确保数据被保存
    if (!extracted.experiment_summary || extracted.experiment_summary.length < 10) {
      logger.info("[Memory] Extraction failed, building summary from conversation...");
      extracted.experiment_summary = aiResponse.substring(0, 2000);
    }
    
    if (!extracted.data_summary || extracted.data_summary.length < 10) {
      logger.info("[Memory] Data extraction failed, building from conversation...");
      extracted.data_summary = userMessage.substring(0, 2000);
    }
    
    // 智能合并：将新提取的信息与现有记忆合并（仅 experiment_summary 和 data_summary）
    if (existingExperimentSummary && extracted.experiment_summary) {
      try {
        logger.info("[Memory] Merging experiment_summary with existing memory...");
        const mergeResponse = await fetch(apiUrl + "/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey,
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: "system", content: "你是一个研究数据管理助手。" },
              { role: "user", content: mergePrompt(existingExperimentSummary, extracted.experiment_summary, '实验资料总结') }
            ],
            temperature: 0.3,
            max_tokens: 3000,
          }),
        });
        
        if (mergeResponse.ok) {
          const mergeData = await mergeResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
          const mergedContent = mergeData.choices?.[0]?.message?.content;
          if (mergedContent && mergedContent.length > 10) {
            extracted.experiment_summary = mergedContent.trim();
            logger.info("[Memory] experiment_summary merged successfully, length:", extracted.experiment_summary.length);
          } else {
            logger.warn("[Memory] Merge response content too short, keeping original");
          }
        } else {
          const errorText = await mergeResponse.text();
          logger.warn("[Memory] Merge API failed with status:", mergeResponse.status, "-", errorText.substring(0, 200));
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
        const mergeResponse = await fetch(apiUrl + "/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey,
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: "system", content: "你是一个研究数据管理助手。" },
              { role: "user", content: mergePrompt(existingDataSummary, extracted.data_summary, '数据详细总结') }
            ],
            temperature: 0.3,
            max_tokens: 3000,
          }),
        });
        
        if (mergeResponse.ok) {
          const mergeData = await mergeResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
          const mergedContent = mergeData.choices?.[0]?.message?.content;
          if (mergedContent && mergedContent.length > 10) {
            extracted.data_summary = mergedContent.trim();
            logger.info("[Memory] data_summary merged successfully, length:", extracted.data_summary.length);
          } else {
            logger.warn("[Memory] Merge response content too short, keeping original");
          }
        } else {
          const errorText = await mergeResponse.text();
          logger.warn("[Memory] Merge API failed with status:", mergeResponse.status, "-", errorText.substring(0, 200));
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
        const mergeResponse = await fetch(apiUrl + "/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey,
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: "system", content: mergeWritingProgressPrompt(existingWritingProgress, extracted.writing_progress) }],
            temperature: 0.3,
            max_tokens: 2000,
          }),
        });
        
        if (mergeResponse.ok) {
          const mergeData = await mergeResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
          const mergedContent = mergeData.choices?.[0]?.message?.content;
          if (mergedContent && mergedContent.length > 5) {
            extracted.writing_progress = mergedContent.trim();
            logger.info("[Memory] writing_progress merged successfully, length:", extracted.writing_progress.length);
          }
        } else {
          logger.warn("[Memory] Writing progress merge API failed with status:", mergeResponse.status);
        }
      } catch (e) {
        logger.warn("[Memory] Writing progress merge failed:", (e as Error).message);
      }
    }
    
    // 智能合并已完成章节
    if (existingCompletedChapters && extracted.completed_chapters && extracted.completed_chapters !== "无") {
      try {
        logger.info("[Memory] Merging completed_chapters with existing memory...");
        const mergeResponse = await fetch(apiUrl + "/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey,
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: "system", content: mergeChaptersPrompt(existingCompletedChapters, extracted.completed_chapters) }],
            temperature: 0.3,
            max_tokens: 3000,
          }),
        });
        
        if (mergeResponse.ok) {
          const mergeData = await mergeResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
          const mergedContent = mergeData.choices?.[0]?.message?.content;
          if (mergedContent && mergedContent.length > 5) {
            extracted.completed_chapters = mergedContent.trim();
            logger.info("[Memory] completed_chapters merged successfully, length:", extracted.completed_chapters.length);
          }
        } else {
          logger.warn("[Memory] Completed chapters merge API failed with status:", mergeResponse.status);
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
    
    // ========== 自动生成结构化总结 ==========
    // 在后台异步生成结构化总结，不阻塞主流程
    generateStructuredSummaries(userId, memory.entries, apiUrl, apiKey, model).catch(e => {
      logger.warn("[Memory] Failed to generate structured summaries:", e);
    });
    // ======================================
    
    const conversationSummary = {
      summary: extracted.research_topic ? `讨论了${extracted.research_topic}` : "新对话",
      keyTopics: extracted.key_concepts ? extracted.key_concepts.split(/[,，]/).map((s: string) => s.trim()).filter((s: string) => s) : []
    };
    
    const conversation: Conversation = {
      id: conversationId,
      userId: userId,
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

// 自动生成结构化总结
async function generateStructuredSummaries(
  userId: string, 
  entries: MemoryEntry[], 
  apiUrl: string, 
  apiKey: string, 
  model: string
): Promise<void> {
  // 获取现有总结内容
  const experimentEntry = entries.find(e => e.key === 'experiment_summary');
  const dataEntry = entries.find(e => e.key === 'data_summary');
  
  const experimentContent = experimentEntry?.value || '';
  const dataContent = dataEntry?.value || '';
  
  if (!experimentContent && !dataContent) {
    logger.info('[StructuredSummary] No content to summarize');
    return;
  }
  
  // 获取已有的结构化总结（用于智能合并）
  const existingStructuredExperiment = entries.find(e => e.key === 'experiment_summary_structured')?.value || '';
  const existingStructuredData = entries.find(e => e.key === 'data_summary_structured')?.value || '';
  
  // 生成实验资料结构化总结
  if (experimentContent) {
    try {
      logger.info('[StructuredSummary] Generating structured experiment summary...');
      
      const experimentPrompt = existingStructuredExperiment 
        ? `请基于已有的结构化总结和新收集的实验资料，生成一份更新、更完整的实验资料全面总结。

## 已有的结构化总结
${existingStructuredExperiment.substring(0, 6000)}

## 新收集的实验资料
${experimentContent.substring(0, 6000)}

## 任务要求
请将新资料中的信息智能整合到已有总结中：
1. 补充缺失的信息（如新的实验细节、方法参数等）
2. 更新冲突的信息（以新资料为准）
3. 保持原有结构完整
4. 确保所有具体数值都被保留

请按以下结构输出（使用Markdown格式）：

### 📋 研究背景
[一句话概括]

### 🎯 实验目的
[明确目标]

### 📍 实验地点与环境
- 地理位置：[具体地点]
- 气候条件：[年均温、降水量]
- 土壤性质：[土壤类型、理化性质]

### 🔬 实验设计
- 处理设置：[各处理组]
- 采样方法：[装置、频率、时间]
- 测定方法：[各指标方法]

### 📊 主要结果
- [关键发现1]
- [关键发现2]
- [关键发现3]

### 💡 核心结论
[一句话总结]`
        : `请对以下实验资料进行结构化总结，生成一份清晰、完整的实验资料全面总结。

## 原始实验资料
${experimentContent.substring(0, 12000)}

## 输出要求
请按以下结构生成总结（使用Markdown格式）：

### 📋 研究背景
[一句话概括研究背景和意义]

### 🎯 实验目的
[明确实验的主要目标]

### 📍 实验地点与环境
- 地理位置：[具体地点和坐标]
- 气候条件：[年均温、降水量等]
- 土壤性质：[土壤类型、基本理化性质]

### 🔬 实验设计
- 处理设置：[各处理组名称及设置]
- 采样方法：[采样装置、频率、时间]
- 测定方法：[各指标测定方法]

### 📊 主要结果
- [关键发现1]
- [关键发现2]
- [关键发现3]

### 💡 核心结论
[一句话总结核心结论]

要求：
1. 保留所有关键数值（温度、降水、土壤性质等）
2. 结构清晰，层次分明
3. 语言简洁专业`;

      const response = await fetch(apiUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: "你是一个专业的学术实验资料分析和总结助手。请确保保留所有具体数值和关键细节。" },
            { role: "user", content: experimentPrompt }
          ],
          temperature: 0.3,
          max_tokens: 4000,
        }),
      });
      
      if (response.ok) {
        const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const summary = result.choices?.[0]?.message?.content || "";
        
        if (summary.length > 100) {
          const memory = loadUserMemory(userId);
          const existingIndex = memory.entries.findIndex(e => e.key === 'experiment_summary_structured');
          const newEntry: MemoryEntry = {
            key: "experiment_summary_structured",
            value: summary.trim(),
            source: existingStructuredExperiment ? "ai-merged" : "ai-structured",
            timestamp: new Date().toISOString()
          };
          
          if (existingIndex >= 0) {
            memory.entries[existingIndex] = newEntry;
          } else {
            memory.entries.push(newEntry);
          }
          saveUserMemory(memory);
          logger.info(`[StructuredSummary] Experiment summary ${existingStructuredExperiment ? 'merged' : 'generated'}: ${summary.length} chars`);
        }
      }
    } catch (error) {
      logger.warn('[StructuredSummary] Failed to generate experiment summary:', error);
    }
  }
  
  // 生成数据详细结构化总结
  if (dataContent) {
    try {
      logger.info('[StructuredSummary] Generating structured data summary...');
      
      const dataPrompt = existingStructuredData
        ? `请基于已有的结构化数据总结和新收集的数据资料，生成一份更新、更完整的数据详细总结。

## 已有的结构化总结
${existingStructuredData.substring(0, 6000)}

## 新收集的数据资料
${dataContent.substring(0, 6000)}

## 任务要求
请将新资料中的数据智能整合到已有总结中：
1. 补充缺失的数据（如新的年份、新的指标等）
2. 更新冲突的数据（以新资料为准）
3. 保持原有结构完整
4. 确保所有具体数值都被保留

请按以下结构输出（使用Markdown格式）：

### 📊 数据概览
- 数据年份：[年份范围]
- 数据类型：[观测/实验/模型]
- 数据量：[样本数量]

### 🌡️ 环境条件数据
- 温度数据：[年均温、变化]
- 降水数据：[年降水量、分布]
- 土壤条件：[WFPS等]

### 📈 排放/测量数据
- 主要指标：[数据范围]
- 峰值特征：[条件、数值]
- 累积排放：[处理对比]

### 🔬 统计分析结果
- 处理间差异：[显著性、幅度]
- 年际变异：[年份对比]
- 关键比值：[如NO/N2O]

### 💡 数据解读要点
- [关键规律]
- [数据特点]`
        : `请对以下实验数据进行结构化总结，生成一份清晰、完整的数据详细总结。

## 原始数据资料
${dataContent.substring(0, 12000)}

## 输出要求
请按以下结构生成总结（使用Markdown格式）：

### 📊 数据概览
- 数据年份：[包含哪些年份的数据]
- 数据类型：[观测数据/实验数据/模型数据等]
- 数据量：[样本数量、观测频次等]

### 🌡️ 环境条件数据
- 温度数据：[年均温、季节变化、年际变异等]
- 降水数据：[年降水量、季节分布、年际变异等]
- 土壤条件：[水分含量、WFPS等关键指标]

### 📈 排放/测量数据
- 主要指标：[N2O、NO等排放数据范围]
- 峰值特征：[峰值出现条件、数值范围]
- 累积排放：[各处理累积排放量对比]

### 🔬 统计分析结果
- 处理间差异：[显著性水平、差异幅度]
- 年际变异：[不同年份数据对比]
- 关键比值：[如NO/N2O比值等]

### 💡 数据解读要点
- [数据反映的关键规律]
- [与预期的差异]

要求：
1. 保留所有具体数值和单位
2. 突出数据间的对比关系
3. 结构清晰，便于查阅`;

      const response = await fetch(apiUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: "你是一个专业的学术数据分析和总结助手。请确保保留所有具体数值和关键细节。" },
            { role: "user", content: dataPrompt }
          ],
          temperature: 0.3,
          max_tokens: 4000,
        }),
      });
      
      if (response.ok) {
        const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const summary = result.choices?.[0]?.message?.content || "";
        
        if (summary.length > 100) {
          const memory = loadUserMemory(userId);
          const existingIndex = memory.entries.findIndex(e => e.key === 'data_summary_structured');
          const newEntry: MemoryEntry = {
            key: "data_summary_structured",
            value: summary.trim(),
            source: existingStructuredData ? "ai-merged" : "ai-structured",
            timestamp: new Date().toISOString()
          };
          
          if (existingIndex >= 0) {
            memory.entries[existingIndex] = newEntry;
          } else {
            memory.entries.push(newEntry);
          }
          saveUserMemory(memory);
          logger.info(`[StructuredSummary] Data summary ${existingStructuredData ? 'merged' : 'generated'}: ${summary.length} chars`);
        }
      }
    } catch (error) {
      logger.warn('[StructuredSummary] Failed to generate data summary:', error);
    }
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
  
  // 所有字段使用同样的单行提取方式
  const allFields = [
    { key: "research_topic", label: "研究主题：" },
    { key: "target_journal", label: "目标期刊：" },
    { key: "key_concepts", label: "关键概念：" },
    { key: "important_findings", label: "重要发现：" },
    { key: "experimental_design", label: "实验设计：" },
    { key: "data_status", label: "数据状态：" },
    { key: "user_preferences", label: "用户偏好：" },
    { key: "experiment_summary", label: "实验资料总结：" },
    { key: "data_summary", label: "数据详细总结：" },
    { key: "writing_progress", label: "写作进度：" },
    { key: "completed_chapters", label: "已完成章节：" },
    { key: "pending_chapters", label: "待完成章节：" }
  ];
  
  for (const field of allFields) {
    const pattern = field.label + '(.+?)(?=\n(?:研究主题|目标期刊|关键概念|重要发现|实验设计|数据状态|用户偏好|实验资料总结|数据详细总结)：|$)';
    const regex = new RegExp(pattern);
    const match = content.match(regex);
    if (match) {
      (result as any)[field.key] = match[1].trim();
    }
  }
  
  return result;
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const userId = req.body.userId || "web-user";
    const userDir = path.join(uploadDir, userId);
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

/**
 * Load SCI writing skill by chapter type
 * @param chapterType - Type of chapter: introduction, methods, results, discussion, etc.
 * @returns Skill content or empty string if not found
 */
function loadWritingSkill(chapterType: string): string {
  const skillMap: Record<string, string> = {
    'title': '01_title_skill.md',
    'abstract': '02_abstract_skill.md',
    'introduction': '03_introduction_skill.md',
    'intro': '03_introduction_skill.md',
    'methods': '04_methods_skill.md',
    'method': '04_methods_skill.md',
    'methodology': '04_methods_skill.md',
    'materials': '04_methods_skill.md',
    'results': '05_results_skill.md',
    'result': '05_results_skill.md',
    'figures': '06_figures_tables_skill.md',
    'tables': '06_figures_tables_skill.md',
    'discussion': '07_discussion_skill.md',
    'conclusion': '08_conclusion_skill.md',
    'conclusions': '08_conclusion_skill.md',
    'additional': '09_additional_statements_skill.md',
    'statement': '09_additional_statements_skill.md'
  };
  
  const skillFile = skillMap[chapterType.toLowerCase()];
  if (!skillFile) {
    logger.info(`[Skill] No skill found for chapter type: ${chapterType}`);
    return '';
  }
  
  const skillPath = path.join(skillDir, skillFile);
  if (!fs.existsSync(skillPath)) {
    logger.warn(`[Skill] Skill file not found: ${skillPath}`);
    return '';
  }
  
  try {
    const skillContent = fs.readFileSync(skillPath, 'utf-8');
    logger.info(`[Skill] Loaded skill: ${skillFile} for chapter: ${chapterType}`);
    return skillContent;
  } catch (e) {
    logger.error(`[Skill] Failed to load skill: ${skillPath}`, e);
    return '';
  }
}

/**
 * Detect chapter type from user message and conversation context
 * @param message - User's current message
 * @param history - Recent conversation history
 * @returns Detected chapter type or null
 */
function detectChapterType(message: string, history?: Array<{ role: string; content: string }>): string | null {
  const messageLower = message.toLowerCase();
  
  // ========== 1. 先检测用户当前消息中的明确章节提及 ==========
  
  // 检测明确的章节动词："写"、"开始写"、"生成" 等
  const explicitWriteActions = [
    '写', '开始写', '开始', '生成', '帮我', '给我', 
    'write', 'start writing', 'begin', 'generate', 'draft'
  ];
  
  const hasWriteAction = explicitWriteActions.some(action => 
    messageLower.includes(action)
  );
  
  // 如果消息包含写作动作，优先检测章节类型
  if (hasWriteAction) {
    if (messageLower.includes('引言') || messageLower.includes('introduction') || 
        messageLower.includes('intro')) {
      return 'introduction';
    }
    
    if (messageLower.includes('方法') || messageLower.includes('methods') || 
        messageLower.includes('methodology') || messageLower.includes('材料')) {
      return 'methods';
    }
    
    if (messageLower.includes('结果') || messageLower.includes('results') || 
        messageLower.includes('数据')) {
      return 'results';
    }
    
    if (messageLower.includes('讨论') || messageLower.includes('discussion') || 
        messageLower.includes('discuss')) {
      return 'discussion';
    }
    
    if (messageLower.includes('结论') || messageLower.includes('conclusion') || 
        messageLower.includes('总结')) {
      return 'conclusion';
    }
    
    if (messageLower.includes('摘要') || messageLower.includes('abstract')) {
      return 'abstract';
    }
    
    if (messageLower.includes('标题') || messageLower.includes('title')) {
      return 'title';
    }
    
    if (messageLower.includes('图表') || messageLower.includes('figures') || 
        messageLower.includes('tables') || messageLower.includes('图') || messageLower.includes('表')) {
      return 'figures';
    }
  }
  
  // ========== 2. 检测模糊的写作请求（无明确章节） ==========
  
  // 模糊写作请求关键词
  const vagueWriteRequests = [
    '按这个结构写', '按照这个结构', '开始写吧', '开始写作', 
    '可以写了', '帮我写', '给我写', '写吧', '写',
    'write this', 'follow this structure', 'start writing', 'go ahead'
  ];
  
  const isVagueWriteRequest = vagueWriteRequests.some(req => 
    messageLower.includes(req)
  );
  
  // 如果是模糊写作请求，检查历史消息寻找讨论中的章节
  if (isVagueWriteRequest && history && history.length > 0) {
    logger.info("[Skill] Detected vague write request, searching conversation context for chapter type");
    
    // 检查最近的 AI 回复和用户消息（最多 5 轮）
    const recentContext = history.slice(-10);
    
    for (let i = recentContext.length - 1; i >= 0; i--) {
      const msg = recentContext[i].content.toLowerCase();
      
      // 检测 AI 回复中提到的章节（AI 可能说过"您的结果部分应该包含..."）
      if (msg.includes('结果部分') || msg.includes('results section')) {
        logger.info(`[Skill] Found 'results' in conversation context at message ${i}`);
        return 'results';
      }
      
      if (msg.includes('讨论部分') || msg.includes('discussion section')) {
        logger.info(`[Skill] Found 'discussion' in conversation context at message ${i}`);
        return 'discussion';
      }
      
      if (msg.includes('引言部分') || msg.includes('introduction section')) {
        logger.info(`[Skill] Found 'introduction' in conversation context at message ${i}`);
        return 'introduction';
      }
      
      if (msg.includes('方法部分') || msg.includes('methods section')) {
        logger.info(`[Skill] Found 'methods' in conversation context at message ${i}`);
        return 'methods';
      }
      
      if (msg.includes('结论部分') || msg.includes('conclusion section')) {
        logger.info(`[Skill] Found 'conclusion' in conversation context at message ${i}`);
        return 'conclusion';
      }
    }
  }
  
  // ========== 3. 检查最近提到的章节（通过记忆） ==========
  
  // 如果用户最近讨论过某个章节，应该继续该章节
  
  if (history && history.length > 0) {
    const recentContext = history.slice(-5);
    const contextText = recentContext.map(msg => msg.content).join(' ').toLowerCase();
    
    // 统计每个章节在上下文中出现的频率
    const chapterMentions = {
      'introduction': (contextText.match(/引言 |introduction|intro/g) || []).length,
      'methods': (contextText.match(/方法|methods|methodology/g) || []).length,
      'results': (contextText.match(/结果|results|数据/g) || []).length,
      'discussion': (contextText.match(/讨论|discussion/g) || []).length,
      'conclusion': (contextText.match(/结论|conclusion/g) || []).length
    };
    
    // 找出最频繁提到的章节
    let maxMentions = 0;
    let detectedChapter: string | null = null;
    
    for (const [chapter, count] of Object.entries(chapterMentions)) {
      if (count > maxMentions) {
        maxMentions = count;
        detectedChapter = chapter;
      }
    }
    
    // 如果某个章节被提到 2 次以上，认为这是当前讨论的章节
    if (detectedChapter && maxMentions >= 2) {
      logger.info(`[Skill] Inferred chapter '${detectedChapter}' from context (${maxMentions} mentions)`);
      return detectedChapter;
    }
  }
  
  // 未检测到章节
  return null;
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

async function generateEmbeddingForPaper(
  paper: LitPaper, 
  apiUrl: string, 
  apiKey: string, 
  model: string = 'text-embedding-v4',
  maxRetries: number = 3
): Promise<number[]> {
  const text = `${paper.title} ${paper.keywords} ${paper.abstract}`.slice(0, 8000);
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(`${apiUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          input: text,
        }),
      });

      if (response.ok) {
        const data = await response.json() as { data?: Array<{ embedding: number[] }> };
        return data.data?.[0]?.embedding || [];
      }

      if (response.status === 429) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.warn(`[Embedding] Rate limited (429), retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      logger.warn(`[Embedding] API failed for paper "${paper.title.slice(0, 50)}...", status: ${response.status}`);
      return [];
    } catch (error) {
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 500;
        logger.warn(`[Embedding] Error, retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        logger.error(`[Embedding] Failed after ${maxRetries} attempts for "${paper.title.slice(0, 50)}...":`, error);
        return [];
      }
    }
  }
  
  return [];
}

async function generateEmbeddingsForPapers(
  papers: LitPaper[], 
  apiUrl: string, 
  apiKey: string, 
  model: string = 'text-embedding-v4'
): Promise<LitPaper[]> {
  if (!apiUrl || !apiKey) {
    logger.warn('[Embedding] No API config provided, skipping embedding generation');
    return papers;
  }

  logger.info(`[Embedding] Generating embeddings for ${papers.length} papers...`);
  
  const papersWithEmbeddings: LitPaper[] = [];
  const batchSize = 10;
  const delayBetweenRequests = 200;
  
  for (let i = 0; i < papers.length; i += batchSize) {
    const batch = papers.slice(i, i + batchSize);
    logger.info(`[Embedding] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(papers.length / batchSize)} (${batch.length} papers)`);
    
    for (const paper of batch) {
      const embedding = await generateEmbeddingForPaper(paper, apiUrl, apiKey, model);
      papersWithEmbeddings.push({ ...paper, embedding });
      
      await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
    }
  }
  
  const successCount = papersWithEmbeddings.filter(p => p.embedding && p.embedding.length > 0).length;
  logger.info(`[Embedding] Generated embeddings for ${successCount}/${papers.length} papers`);
  
  return papersWithEmbeddings;
}

async function mergePapersWithExisting(
  newPapers: LitPaper[],
  existingPapers: LitPaper[]
): Promise<LitPaper[]> {
  const merged = new Map<string, LitPaper>();
  
  for (const paper of existingPapers) {
    const key = `${paper.title}_${paper.year}`.toLowerCase();
    merged.set(key, paper);
  }
  
  for (const paper of newPapers) {
    const key = `${paper.title}_${paper.year}`.toLowerCase();
    const existing = merged.get(key);
    
    if (existing && existing.embedding && existing.embedding.length > 0) {
      merged.set(key, { ...paper, embedding: existing.embedding });
    } else {
      merged.set(key, paper);
    }
  }
  
  return Array.from(merged.values());
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
      
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        // 检查是否是续行（缩进但不是新字段）
        const isContinuation = line.match(/^\s{3,}/) && !trimmed.includes('  -');
        
        // 标题
        if (trimmed.startsWith('TI ') || trimmed.startsWith('TI-') || trimmed.startsWith('T1 ')) {
          title = trimmed.replace(/^(TI|T1)\s*-?\s*/, '').trim();
          let j = lineIndex + 1;
          while (j < lines.length && lines[j].match(/^   \S/)) {
            title += ' ' + lines[j].trim();
            j++;
          }
          lineIndex = j - 1;
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
  vectorScore: number;
  lexicalScore: number;
  matchFields: string[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  const length = Math.min(a.length, b.length);
  
  for (let i = 0; i < length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function simpleEmbedding(text: string, dimensions: number = 1536): number[] {
  const normalized = text.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/g, ' ');
  const tokens = normalized.split(/\s+/).filter(t => t.length > 1);
  
  const embedding: number[] = new Array(dimensions).fill(0);
  const tokenSet = new Set(tokens);
  
  for (const token of tokenSet) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = ((hash << 5) - hash) + token.charCodeAt(i);
      hash = hash & hash;
    }
    
    const index = Math.abs(hash) % dimensions;
    const tf = tokens.filter(t => t === token).length / tokens.length;
    embedding[index] = tf;
  }
  
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  
  if (magnitude > 0) {
    return embedding.map(val => val / magnitude);
  }
  
  return embedding;
}

interface CitationInfo {
  author: string;
  year: string;
  fullMatch: string;
}

function extractCitations(content: string): CitationInfo[] {
  const citations: CitationInfo[] = [];
  const seen = new Set<string>();
  
  const regex = /\(([A-Z][a-zA-Z]+(?:\s+et\s+al\.)?),?\s*(\d{4})[a-z]?\)/g;
  let match;
  
  while ((match = regex.exec(content)) !== null) {
    const author = match[1].trim();
    const year = match[2];
    const key = `${author}_${year}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      citations.push({ author, year, fullMatch: match[0] });
    }
  }
  
  return citations;
}

function findPaperByCitation(citation: CitationInfo, papers: LitPaper[]): LitPaper | undefined {
  const authorName = citation.author.toLowerCase().replace(' et al.', '');
  
  for (const paper of papers) {
    const paperAuthors = (paper.author || '').toLowerCase();
    const paperYear = String(paper.year || '');
    
    if (paperAuthors.includes(authorName) && paperYear === citation.year) {
      return paper;
    }
  }
  
  return undefined;
}

function formatReference(paper: LitPaper, index: number): string {
  const authors = paper.author || 'Unknown';
  const year = paper.year || 'n.d.';
  const title = paper.title || 'Untitled';
  const journal = paper.journal || '';
  const doi = paper.doi || '';
  
  let ref = `\\bibitem{ref${index}} ${authors} (${year}). ${title}.`;
  
  if (journal) {
    ref += ` \\textit{${journal}}`;
  }
  
  if (doi) {
    ref += `, ${doi}`;
  }
  
  return ref;
}

function generateBibliography(content: string, papers: LitPaper[]): { bibliography: string; stats: { totalCitations: number; matched: number; unmatched: number } } {
  const citations = extractCitations(content);
  
  if (citations.length === 0) {
    return { bibliography: '', stats: { totalCitations: 0, matched: 0, unmatched: 0 } };
  }
  
  const matchedPapers: LitPaper[] = [];
  const unmatchedCitations: CitationInfo[] = [];
  
  for (const citation of citations) {
    const paper = findPaperByCitation(citation, papers);
    if (paper) {
      matchedPapers.push(paper);
    } else {
      unmatchedCitations.push(citation);
    }
  }
  
  if (matchedPapers.length === 0) {
    logger.warn(`[Bibliography] No matched papers found for ${citations.length} citations`);
    return { bibliography: '', stats: { totalCitations: citations.length, matched: 0, unmatched: citations.length } };
  }
  
  let bibliography = '\\section*{References}\n\\begin{thebibliography}{99}\n\n';
  
  matchedPapers.forEach((paper, index) => {
    bibliography += formatReference(paper, index + 1) + '\n\n';
  });
  
  bibliography += '\\end{thebibliography}';
  
  const stats = {
    totalCitations: citations.length,
    matched: matchedPapers.length,
    unmatched: unmatchedCitations.length
  };
  
  logger.info(`[Bibliography] Generated with ${stats.matched}/${stats.totalCitations} citations matched`);
  
  if (unmatchedCitations.length > 0) {
    logger.warn(`[Bibliography] Unmatched citations: ${unmatchedCitations.map(c => `${c.author} ${c.year}`).join(', ')}`);
  }
  
  return { bibliography, stats };
}

function searchLiterature(query: string, papers: LitPaper[], maxResults: number = 10): SearchResult[] {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);
  
  const queryEmbedding = simpleEmbedding(query);
  
  const results: SearchResult[] = [];
  
  for (const paper of papers) {
    let lexicalScore = 0;
    const matchFields: string[] = [];
    
    const titleLower = paper.title.toLowerCase();
    const abstractLower = paper.abstract.toLowerCase();
    const keywordsLower = paper.keywords.toLowerCase();
    const authorLower = paper.author.toLowerCase();
    const journalLower = paper.journal.toLowerCase();
    
    for (const word of queryWords) {
      if (titleLower.includes(word)) {
        lexicalScore += 10;
        if (!matchFields.includes('title')) matchFields.push('title');
      }
      if (keywordsLower.includes(word)) {
        lexicalScore += 8;
        if (!matchFields.includes('keywords')) matchFields.push('keywords');
      }
      if (abstractLower.includes(word)) {
        lexicalScore += 5;
        if (!matchFields.includes('abstract')) matchFields.push('abstract');
      }
      if (authorLower.includes(word)) {
        lexicalScore += 3;
        if (!matchFields.includes('author')) matchFields.push('author');
      }
      if (journalLower.includes(word)) {
        lexicalScore += 2;
        if (!matchFields.includes('journal')) matchFields.push('journal');
      }
    }
    
    const yearMatch = query.match(/\d{4}/);
    if (yearMatch && paper.year.includes(yearMatch[0])) {
      lexicalScore += 4;
      matchFields.push('year');
    }
    
    let vectorScore = 0;
    if (paper.embedding && paper.embedding.length > 0) {
      vectorScore = cosineSimilarity(queryEmbedding, paper.embedding);
    }
    
    const combinedScore = lexicalScore * 2 + vectorScore * 100;
    
    if (combinedScore > 0) {
      results.push({ 
        paper, 
        score: combinedScore, 
        vectorScore,
        lexicalScore,
        matchFields 
      });
    }
  }
  
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

// 代码直接控制：检索文献并格式化为标准引用格式
function getReferencesForWriting(
  query: string, 
  papers: LitPaper[], 
  maxResults: number = 10
): { 
  references: string; 
  papers: SearchResult[];
  formattedCitations: string[];
} {
  const searchResults = searchLiterature(query, papers, maxResults);
  
  if (searchResults.length === 0) {
    return { references: "", papers: [], formattedCitations: [] };
  }
  
  const formattedCitations: string[] = [];
  
  searchResults.forEach((result) => {
    const paper = result.paper;
    const authors = paper.author.split(/[,;]/).map(a => a.trim());
    const firstAuthor = authors[0];
    const authorLastName = firstAuthor.split(/\s+/).pop() || firstAuthor;
    
    let citationText = "";
    if (authors.length >= 3) {
      citationText = `(${authorLastName} et al., ${paper.year})`;
    } else if (authors.length === 2) {
      const secondAuthor = authors[1].split(/\s+/).pop() || authors[1];
      citationText = `(${authorLastName} and ${secondAuthor}, ${paper.year})`;
    } else {
      citationText = `(${authorLastName}, ${paper.year})`;
    }
    
    formattedCitations.push(citationText);
  });
  
  let referencesText = `【代码自动检索的前${searchResults.length}篇相关文献】\n\n`;
  referencesText += `**检索关键词：** ${query}\n`;
  referencesText += `**文献总数：** ${searchResults.length} 篇（按相关度排序）\n\n`;
  referencesText += `**可用的引用格式（必须严格使用）：**\n`;
  formattedCitations.forEach((c, i) => {
    referencesText += `${i + 1}. ${c}\n`;
  });
  referencesText += `\n**文献详细信息（AI撰写时必须参考）：**\n\n`;
  
  searchResults.forEach((result, index) => {
    const paper = result.paper;
    referencesText += `文献 ${index + 1}（相关度：${result.score.toFixed(2)}）：\n`;
    referencesText += `  标题：${paper.title}\n`;
    referencesText += `  作者：${paper.author}\n`;
    referencesText += `  年份：${paper.year}\n`;
    referencesText += `  期刊：${paper.journal}\n`;
    referencesText += `  DOI：${paper.doi || 'N/A'}\n`;
    referencesText += `  关键词：${paper.keywords}\n`;
    referencesText += `  摘要：${paper.abstract || '无'}\n`;
    referencesText += `  引用格式：${formattedCitations[index]}\n\n`;
  });
  
  referencesText += `**⚠️ 严格要求：**\n`;
  referencesText += `- AI只能使用上述列表中的文献\n`;
  referencesText += `- 必须保持作者、年份、标题完全一致\n`;
  referencesText += `- 严禁自行编造或修改任何信息\n`;
  referencesText += `- 摘要可用于理解内容，但不得编造原文中不存在的细节\n`;
  referencesText += `- 引用时必须使用指定的引用格式\n`;
  
  logger.info(`[References] Auto-generated ${searchResults.length} references for query: ${query}`);
  
  return { references: referencesText, papers: searchResults, formattedCitations };
}

// 从用户消息中提取需要检索的句子
function extractSentencesFromMessage(message: string): string[] {
  const sentences: string[] = [];
  
  // 模式1: 引号中的内容 "xxx" 或 "xxx"
  const quotePatterns = [
    /[""]([^""]+)[""]/g,
    /[""]([^""]+)[""]/g,
  ];
  
  for (const pattern of quotePatterns) {
    const matches = message.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[1].length > 5) {
        sentences.push(match[1].trim());
      }
    }
  }
  
  // 模式2: 数字编号列表 1. xxx 2. xxx
  const numberedPattern = /\d+[.．、]\s*([^\n]+)/g;
  const numberedMatches = message.matchAll(numberedPattern);
  for (const match of numberedMatches) {
    if (match[1] && match[1].length > 5) {
      sentences.push(match[1].trim());
    }
  }
  
  // 模式3: 换行分隔的句子（长度>10的独立行）
  const lines = message.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 10 && trimmed.length < 200 && !trimmed.startsWith('#')) {
      // 检查是否已经是引号内容（避免重复）
      if (!sentences.includes(trimmed)) {
        sentences.push(trimmed);
      }
    }
  }
  
  // 去重并返回
  return [...new Set(sentences)].slice(0, 10); // 最多10个句子
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

    let context = '=== Web Search Results ===\n\n';
    for (let i = 0; i < Math.min(data.results.length, 10); i++) {
      const r = data.results[i];
      context += `[${i + 1}] ${r.title}\n`;
      context += `URL: ${r.url}\n`;
      context += `Content: ${r.content ? r.content.substring(0, 300) : 'N/A'}\n\n`;
    }

    logger.info("[WebSearch] Found", data.results.length, "results for:", query);
    return context;
  } catch (e) {
    logger.error("[WebSearch] Error:", e);
    return '';
  }
}

async function processChatMessage(userId: string, userMessage: string): Promise<string> {
  // 统一用户 ID：所有用户（飞书 + Web UI）共用同一个 "web-user" ID
  // 这样飞书和 Web UI 用户可以共享记忆、文献库、写作进度等所有数据
  const unifiedUserId = "web-user";
  
  const model = currentModel;
  const webSearchKey = currentWebSearchKey;
  const useApiUrl = currentApiUrl;
  const useApiKey = currentApiKey;
  
  logger.info(`[ChatProcessor] Processing for ${userId} (unified: ${unifiedUserId}): ${userMessage.substring(0, 50)}...`);
  logger.info(`[ChatProcessor] Using API: ${useApiUrl}, Model: ${model}`);
  
  const userMemory = loadUserMemory(unifiedUserId);
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
  
  const userDir = path.join(uploadDir, unifiedUserId);
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
分析用户的问题，做出决策：
1. 是否需要联网搜索最新信息？
2. 用户想要做什么？（回答问题/写讨论/写引言/逐句检索/其他）

## 决策规则
- 如果问题涉及最新研究成果（2024-2026）、实时数据，**必须联网搜索**
- 如果用户要求"逐句检索"、"为这句话找文献"、"检索支撑文献"等，**task_type = "逐句检索"**
- 如果用户要求写某个章节（引言/讨论/方法等），**task_type = "写XX"**
- 普通问答，**task_type = "回答问题"**

## 输出格式
返回以下 JSON 格式：
{
  "need_web_search": true/false,
  "web_search_query": "联网搜索关键词",
  "task_type": "回答问题/写讨论/写引言/逐句检索/其他",
  "reason": "判断理由"
}

只返回 JSON，不要有其他文字。`;

  let needWebSearch = false;
  let webSearchQuery = "";
  let taskType = "回答问题";
  
  try {
    const decisionResponse = await fetch(useApiUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + useApiKey,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: decisionPrompt },
          { role: "user", content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });
    
    if (decisionResponse.ok) {
      const decisionData = await decisionResponse.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const decisionText = decisionData.choices?.[0]?.message?.content || "";
      
      const jsonMatch = decisionText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const decision = JSON.parse(jsonMatch[0]);
        needWebSearch = decision.need_web_search === true;
        webSearchQuery = decision.web_search_query || userMessage;
        taskType = decision.task_type || "回答问题";
        logger.info(`[ChatProcessor] Decision: web=${needWebSearch}, task=${taskType}`);
      }
    }
  } catch (e) {
    logger.warn("[ChatProcessor] Decision API failed:", e);
  }
  
  // ========== 🚀 写作任务检测：使用 ConversationFlow 完整流程 ==========
  const isWritingTask = taskType.includes('写') || 
                        taskType.includes('写作') || 
                        taskType.includes('撰写') ||
                        taskType.includes('逐句检索') ||
                        taskType.includes('检索文献') ||
                        /(introduction|discussion|methods|results|conclusion|abstract)/i.test(taskType);
  
  if (isWritingTask && globalConversationFlow) {
    logger.info(`[ChatProcessor] Detected writing task: ${taskType}, delegating to ConversationFlow`);
    try {
      // 将请求转发到 ConversationFlow，使用完整流程（包含逐句检索）
      const flowResponse = await globalConversationFlow.processMessage(unifiedUserId, userMessage);
      logger.info(`[ChatProcessor] ConversationFlow completed writing task`);
      return flowResponse;
    } catch (flowError) {
      logger.error(`[ChatProcessor] ConversationFlow error:`, flowError);
      // ConversationFlow 失败时，降级到原有流程
      logger.info(`[ChatProcessor] Falling back to standard chat flow`);
    }
  }
  
  // ========== 🚀 逐句检索任务：直接调用检索引擎 ==========
  if (taskType.includes('逐句检索') || taskType.includes('检索支撑文献')) {
    logger.info(`[ChatProcessor] Detected sentence-level retrieval task`);
    try {
      // 从用户消息中提取句子
      const sentences = extractSentencesFromMessage(userMessage);
      
      // 如果没有提取到句子，询问用户提供具体论点
      if (sentences.length === 0) {
        return `好的，我来帮您逐句检索文献支撑。

请提供您需要检索的具体论点或句子，支持以下格式：

**格式1 - 引号包裹：**
"硝化抑制剂减少NO排放"
"干旱条件下土壤氮素转化增强"

**格式2 - 编号列表：**
1. 硝化抑制剂减少NO排放
2. DCD在玉米田中的应用效果
3. 干旱对土壤氮循环的影响

**格式3 - 直接提供（每行一个）：**
硝化抑制剂通过抑制氨氧化细菌减少NO排放
DCD和nitrapyrin是常用的硝化抑制剂
干旱条件会改变土壤氮素转化速率

请发送您需要检索的具体内容，我将为每句话检索最相关的文献。`;
      }
      
      // 使用全局检索引擎进行逐句检索
      const results: Record<string, any[]> = {};
      
      for (const sentence of sentences) {
        const queryResults = await globalRetrievalEngine.retrieve({
          query: sentence,
          topK: 5,
          searchMode: 'hybrid'
        });
        
        results[sentence] = queryResults.results.map(doc => ({
          title: doc.title,
          author: doc.authors.map(a => a.name).join(', '),
          year: doc.year,
          journal: doc.journal,
          doi: doc.doi,
          abstract: doc.abstract,
          score: doc.combinedScore,
          citation: `(${doc.authors[0]?.name?.split(/\s+/).pop() || 'Unknown'} et al., ${doc.year})`
        }));
      }
      
      // 格式化返回结果
      let response = `## 逐句检索结果\n\n`;
      response += `已为 **${sentences.length}** 个句子检索文献支撑\n\n`;
      
      for (const [sentence, papers] of Object.entries(results)) {
        response += `### 「${sentence}」\n\n`;
        if (papers.length === 0) {
          response += `*未找到相关文献*\n\n`;
        } else {
          papers.forEach((paper, idx) => {
            response += `${idx + 1}. **${paper.title}**\n`;
            response += `   ${paper.citation}\n`;
            response += `   *${paper.journal}*\n`;
            response += `   ${paper.abstract?.substring(0, 150)}...\n\n`;
          });
        }
      }
      
      response += `---\n`;
      response += `**使用建议**：\n`;
      response += `- 相关度 ≥ 0.5 的文献可以直接引用\n`;
      response += `- 相关度 0.3-0.5 的文献需要验证内容匹配度\n`;
      response += `- 相关度 < 0.3 的文献建议重新检索或使用其他关键词\n`;
      
      return response;
    } catch (retrievalError) {
      logger.error(`[ChatProcessor] Sentence retrieval error:`, retrievalError);
      return `逐句检索时出现错误：${(retrievalError as Error).message}。请稍后重试。`;
    }
  }
  
  // ========== 🚀 自动加载 SCI 写作技能（增强上下文检测） ==========
  let writingSkillContent = "";
  
  // 获取对话历史用于上下文检测
  const contextHistory = conversationHistory.get(unifiedUserId) || [];
  const detectedChapter = detectChapterType(userMessage, contextHistory);
  
  if (detectedChapter) {
    writingSkillContent = loadWritingSkill(detectedChapter);
    if (writingSkillContent) {
      logger.info(`[Skill] Auto-loaded ${detectedChapter} skill for writing task (context-aware)`);
    }
  } else {
    logger.info("[Skill] No chapter type detected, skipping skill load");
  }
  
  let relevantLiterature = "";
  
  if (literaturePapers.length > 0) {
    const { references } = getReferencesForWriting(userMessage, literaturePapers, 10);
    relevantLiterature = references;
    logger.info(`[ChatProcessor] Auto-retrieved references for: ${userMessage}`);
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
    taskHint = "\n## 写作任务\n用户想要写 Discussion。请使用【代码自动检索的参考文献】中提供的引用格式撰写内容。\n";
  } else if (taskType === "写引言") {
    taskHint = "\n## 写作任务\n用户想要写 Introduction。请使用【代码自动检索的参考文献】中提供的引用格式撰写内容。\n";
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
  
  // 🚀 注入写作技能指导
  let writingSkillSection = "";
  if (writingSkillContent) {
    writingSkillSection = `\n\n## ✨ SCI写作技能指导\n\n系统已自动加载 **${detectedChapter}** 章节的写作技能指南。\n请严格按照以下技能要求指导用户写作：\n\n${writingSkillContent}\n\n---\n`;
  }
  
  const finalSystemPrompt = `你是一个专业的学术论文写作助手。${soulContent ? "\n" + soulContent : ""}
${memoryIntro}
${memoryContext}
${writingProgressContext}

## 你的能力
1. **文献库搜索**：使用系统提供的【代码自动检索的参考文献】
2. **联网搜索**：搜索互联网最新研究（仅用于背景信息，**不能用于参考文献**）
3. **智能引用**：自动使用"(作者，年份)" 格式引用文献

${writingSkillSection}

## 文献库信息
${hasLiterature ? literatureSummary : "用户还没有上传文献。"}
${journalStyleContent}
${journalStyleHint}

${relevantLiterature}
${webSearchContext}
${taskHint}

## 回答要求
1. 回答必须有文献依据
2. 必须使用 "(作者，年份)" 格式引用文献，如 "(Wang et al., 2023)" 或 "(Zhang et al., 2022; Li et al., 2024)"
3. 如果有相关文献，必须引用；不要编造引用
4. 使用专业的学术表达

### 系统已自动完成
- 代码已从您的文献库中检索出最相关的10篇文献
- 每篇文献的完整信息（标题、作者、年份、期刊、DOI、摘要）已提供
- 标准化的引用格式已生成

### 你的任务（严格遵循）
1. **阅读【代码自动检索的参考文献】部分**
2. **使用提供的引用格式**（如：(Wang et al., 2023)）
3. **复制粘贴，严禁修改**：
   - 不要修改作者姓名
   - 不要修改年份
   - 不要修改标题
   - 不要编造文献中不存在的细节

### 绝对禁止
❌ **严禁以下行为**：
- 编造不存在的文献
- 修改代码提供的引用格式
- 从摘要中编造原文不存在的细节
- 使用网络搜索结果作为参考文献

✅ **唯一正确的做法**：
- 从【代码自动检索的参考文献】列表中选择合适的文献
- 复制代码提供的引用格式到正文中
- 基于提供的摘要撰写内容，但不编造细节

## 文献库信息
${hasLiterature ? literatureSummary : "用户还没有上传文献。"}
${journalStyleContent}
${journalStyleHint}

${relevantLiterature}
${webSearchContext}
${taskHint}

## 回答要求
1. 回答必须有文献依据
2. 必须使用 "(作者，年份)" 格式引用文献，如 "(Wang et al., 2023)" 或 "(Zhang et al., 2022; Li et al., 2024)"
3. 如果有相关文献，必须引用；不要编造引用
4. 使用专业的学术表达

## 🎯 逐句检索写作流程（当用户要求写某个章节时）

当用户说"写4.2节讨论"或"写结果部分"时，请按以下流程：

### 阶段1：结构规划
1. 分析聊天记录和记忆中的实验数据
2. 确定该章节应该包含的句子（S1, S2, S3...）
3. 向用户展示结构，等待确认

### 阶段2：逐句撰写（每句话独立处理）
对于每句话（如S1）：

**Step 1: 确定核心论点**
- 这句话要表达什么科学观点？
- 需要什么类型的文献支撑？

**Step 2: 提取检索关键词**
- 将核心论点转化为英文检索词
- 例如："温度塑造微生物群落" → "temperature microbial community structure"

**Step 3: 逐句顺序撰写（自动执行，无需用户逐句确认）**

**核心原则**：一句话一句话写，每句话独立检索、独立撰写，**不需要用户逐句确认**，直接写完整个段落。

**自动执行流程**：
1. **规划阶段**：与用户讨论确定本段包含几句话（S1, S2, S3...）及每句话的核心论点
2. **自动执行S1**：
   - 生成S1的检索词
   - 使用工具调用检索S1文献
   - 等待系统返回S1文献
   - 基于S1文献撰写S1内容
   - **自动继续S2，不询问用户**
3. **自动执行S2**（无需用户确认）：
   - 生成S2的检索词（可基于S1结果调整）
   - 使用工具调用检索S2文献
   - 等待系统返回S2文献
   - 基于S2文献撰写S2内容
   - **自动继续S3**
4. **自动执行S3**（无需用户确认）：
   - 以此类推...
5. **完成段落**：将所有句子组合成完整段落，整体呈现给用户

**单句检索工具调用格式**：
每写一句话时，输出工具调用：

【代码块开始】
🔧 调用工具：sentence_search_single
sentence_id: S1
topic: 这句话的核心论点
search_query: 英文检索词
【代码块结束】

**重要**：
- **不要逐句询问用户**，直接顺序写完所有句子
- 每句话独立检索，不要复用其他句子的文献
- 检索词要具体，针对该句子的核心论点
- 最后将所有句子组合成完整段落呈现给用户
- 在段落末尾添加参考文献列表

**Step 4: 评估文献质量**
- 系统已为每句话检索并返回了相关文献
- 检查返回的文献是否：
  ✓ 直接支持你的论点
  ✓ 研究方法可靠
  ✓ 期刊质量较高

**Step 5: 撰写决策**
- **如果文献质量OK**：
  → 使用文献内容撰写句子
  → 添加引用格式：(Author et al., Year)
  → 标记为 ✓

- **如果文献质量不行或没有相关文献**：
  → 基于你的知识撰写句子
  → 在句子末尾添加标记：[需补充检索: 具体检索词]
  → 标记为 ⚠️

### 阶段3：输出格式
[S1] 第一句话内容 (Author et al., Year). ✓
[S2] 第二句话内容 [需补充检索: 英文检索词]. ⚠️

### 重要提醒
- 每句话独立检索、独立评估
- 不要为了引用而引用，不相关的文献宁可不用
- 标记为⚠️的句子需要用户后续自行检索补充

## 🎯 逐句检索写作流程（当用户要求写某个章节时）

当用户说"写4.2节讨论"或"写结果部分"时，请按以下流程：

### 阶段1：结构规划
1. 分析聊天记录和记忆中的实验数据
2. 确定该章节应该包含的句子（S1, S2, S3...）
3. 向用户展示结构，等待确认

### 阶段2：逐句撰写（每句话独立处理）
对于每句话（如S1）：

**Step 1: 确定核心论点**
- 这句话要表达什么科学观点？
- 需要什么类型的文献支撑？

**Step 2: 提取检索关键词**
- 将核心论点转化为英文检索词
- 例如："温度塑造微生物群落" → "temperature microbial community structure"

**Step 3: 评估文献质量**
- 系统已自动检索相关文献
- 检查返回的文献是否：
  ✓ 直接支持你的论点
  ✓ 研究方法可靠
  ✓ 期刊质量较高

**Step 4: 撰写决策**
- **如果文献质量OK**：
  → 使用文献内容撰写句子
  → 添加引用格式：(Author et al., Year)
  → 标记为 ✓

- **如果文献质量不行或没有相关文献**：
  → 基于你的知识撰写句子
  → 在句子末尾添加标记：[需检索: 具体检索词]
  → 标记为 ⚠️

### 阶段3：输出格式示例

[S1] Contrary to the prevailing assumption that elevated soil temperature 
accelerates N₂O emissions (Smith et al., 2023), our findings demonstrate 
that temperature primarily restructures microbial communities (Wang et al., 2024). ✓

[S2] Principal coordinates analysis revealed significant seasonal 
partitioning of AOA communities [需检索: AOA seasonal variation temperature]. ⚠️

### 重要提醒
- 每句话独立检索、独立评估
- 不要为了引用而引用，不相关的文献宁可不用
- 标记为⚠️的句子需要用户后续自行检索补充

### 🔍 AI 自查功能
系统会自动检查你生成的参考文献：
- 如果参考文献包含正文中未引用的文献，系统会自动移除
- 如果正文中引用的文献缺失，系统会提示补充
- 确保最终输出的参考文献完全匹配正文引用

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
  
  const history = conversationHistory.get(userId) || [];
  for (const msg of history.slice(-10)) {
    messages.push(msg);
  }
  
  messages.push({ role: "user", content: userMessage });
  
  try {
    const response = await fetch(useApiUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + useApiKey,
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });
    
    if (!response.ok) {
      const errText = await response.text();
      logger.error("[ChatProcessor] API error:", response.status, errText);
      return `抱歉，API 调用失败: ${response.status}`;
    }
    
    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    
    let aiResponse = data.choices?.[0]?.message?.content || "抱歉，我无法生成回复。";
    
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
          const { bibliography, stats } = generateBibliography(draftContent, literaturePapers);
          const finalContent = bibliography 
            ? `${draftContent}\n\n${bibliography}` 
            : draftContent;
          await sessionStore.saveDraft(userId, section, finalContent);
          const bibInfo = stats.matched > 0 ? `（含参考文献: ${stats.matched}篇匹配/${stats.totalCitations}篇引用）` : '';
          logger.info(`[ChatProcessor] Draft saved: ${section} for ${unifiedUserId}${bibInfo}`);
          aiResponse = aiResponse.replace(draftMatch[0], `\n✅ 已保存到 ${section} 草稿${bibInfo}\n`);
        } catch (e) {
          logger.error("[ChatProcessor] Failed to save draft:", e);
          aiResponse = aiResponse.replace(draftMatch[0], `\n⚠️ 草稿保存失败：${(e as Error).message}\n`);
        }
      }
    }
    
    // 捕获AI的句子检索工具调用
    const sentenceSearchMatch = aiResponse.match(/```[\s\S]*?🔧 调用工具：sentence_search[\s\S]*?```/);
    if (sentenceSearchMatch) {
      const searchBlock = sentenceSearchMatch[0];
      const sentencesMatch = searchBlock.match(/sentences:\s*([\s\S]*?)(?=```|$)/);
      
      if (sentencesMatch) {
        try {
          // 解析句子列表
          const sentencesText = sentencesMatch[1].trim();
          const sentences = sentencesText
            .split('\n')
            .map(s => s.trim().replace(/^-\s*/, '').replace(/^[""']|[""']$/g, ''))
            .filter(s => s.length > 0);
          
          if (sentences.length > 0) {
            logger.info(`[ChatProcessor] AI requested sentence search for ${sentences.length} sentences`);
            
            // 执行逐句检索
            const searchResults: Record<string, any[]> = {};
            for (const sentence of sentences) {
              const queryResults = await globalRetrievalEngine.retrieve({
                query: sentence,
                topK: 5,
                searchMode: 'hybrid'
              });
              
              searchResults[sentence] = queryResults.results.map(doc => ({
                title: doc.title,
                author: doc.authors.map(a => a.name).join(', '),
                year: doc.year,
                journal: doc.journal,
                doi: doc.doi,
                abstract: doc.abstract,
                score: doc.combinedScore,
                citation: `(${doc.authors[0]?.name?.split(/\s+/).pop() || 'Unknown'} et al., ${doc.year})`
              }));
            }
            
            // 格式化检索结果
            let searchResultText = `\n\n## 逐句检索结果\n\n`;
            searchResultText += `已为 **${sentences.length}** 个检索词检索文献\n\n`;
            
            for (const [query, papers] of Object.entries(searchResults)) {
              searchResultText += `### 检索词：「${query}」\n\n`;
              if (papers.length === 0) {
                searchResultText += `*未找到相关文献*\n\n`;
              } else {
                papers.forEach((paper, idx) => {
                  searchResultText += `${idx + 1}. **${paper.title}**\n`;
                  searchResultText += `   ${paper.citation}\n`;
                  searchResultText += `   *${paper.journal}*\n`;
                  searchResultText += `   ${paper.abstract?.substring(0, 150)}...\n\n`;
                });
              }
            }
            
            // 将检索结果附加到AI响应
            aiResponse = aiResponse.replace(sentenceSearchMatch[0], 
              `\n✅ 已完成逐句检索，共找到 ${Object.values(searchResults).flat().length} 篇相关文献\n${searchResultText}`);
            
            logger.info(`[ChatProcessor] Sentence search completed`);
          }
        } catch (e) {
          logger.error("[ChatProcessor] Sentence search failed:", e);
          aiResponse = aiResponse.replace(sentenceSearchMatch[0], 
            `\n⚠️ 逐句检索失败：${(e as Error).message}\n`);
        }
      }
    }
    
    // 捕获AI的单句检索工具调用（sentence_search_single）
    const singleSentenceSearchMatch = aiResponse.match(/```[\s\S]*?🔧 调用工具：sentence_search_single[\s\S]*?```/);
    if (singleSentenceSearchMatch) {
      const searchBlock = singleSentenceSearchMatch[0];
      const sentenceIdMatch = searchBlock.match(/sentence_id:\s*(S\d+)/);
      const topicMatch = searchBlock.match(/topic:\s*([^\n]+)/);
      const queryMatch = searchBlock.match(/search_query:\s*([^\n]+)/);
      
      if (sentenceIdMatch && queryMatch) {
        const sentenceId = sentenceIdMatch[1];
        const topic = topicMatch ? topicMatch[1].trim() : '';
        const searchQuery = queryMatch[1].trim();
        
        try {
          logger.info(`[ChatProcessor] AI requested single sentence search: ${sentenceId} - ${searchQuery}`);
          
          // 执行单句检索
          const queryResults = await globalRetrievalEngine.retrieve({
            query: searchQuery,
            topK: 5,
            searchMode: 'hybrid'
          });
          
          // 格式化检索结果
          let searchResultText = `\n\n## ${sentenceId} 文献检索结果\n\n`;
          searchResultText += `**检索词**：${searchQuery}\n`;
          searchResultText += `**主题**：${topic}\n`;
          searchResultText += `**找到 ${queryResults.results.length} 篇相关文献**：\n\n`;
          
          queryResults.results.forEach((doc, idx) => {
            const citation = `(${doc.authors[0]?.name?.split(/\s+/).pop() || 'Unknown'} et al., ${doc.year})`;
            searchResultText += `${idx + 1}. **${doc.title}**\n`;
            searchResultText += `   ${citation}\n`;
            searchResultText += `   *${doc.journal}*\n`;
            searchResultText += `   ${doc.abstract?.substring(0, 150)}...\n\n`;
          });
          
          searchResultText += `---\n`;
          searchResultText += `**基于以上文献撰写 ${sentenceId} 的内容，然后自动继续下一句**\n`;
          
          // 将检索结果附加到AI响应
          aiResponse = aiResponse.replace(singleSentenceSearchMatch[0], 
            `\n✅ 已完成 ${sentenceId} 的文献检索\n${searchResultText}`);
          
          logger.info(`[ChatProcessor] Single sentence search completed: ${sentenceId}`);
        } catch (e) {
          logger.error("[ChatProcessor] Single sentence search failed:", e);
          aiResponse = aiResponse.replace(singleSentenceSearchMatch[0], 
            `\n⚠️ ${sentenceId} 检索失败：${(e as Error).message}\n`);
        }
      }
    }
    
    const currentHistory = conversationHistory.get(unifiedUserId) || [];
    currentHistory.push({ role: "user", content: userMessage });
    currentHistory.push({ role: "assistant", content: aiResponse });
    if (currentHistory.length > 20) {
      currentHistory.splice(0, currentHistory.length - 20);
    }
    conversationHistory.set(unifiedUserId, currentHistory);
    
    const conversationId = `conv-${Date.now()}`;
    updateMemoryWithAI(unifiedUserId, conversationId, userMessage, aiResponse, history, useApiUrl, useApiKey, model).catch(e => {
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
      const response = await fetch(apiUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify({
          model: options.model,
          messages: options.messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.maxTokens || 4096,
        }),
      });
      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content || "";
    },
  };
}

const conversationHistory = new Map<
  string,
  Array<{ role: string; content: string }>
>();

app.use(express.static(publicDir));

const niceAIGCAdapter = new NiceAIGCBridgeAdapter();
niceAIGCAdapter.loadConfig().then(() => {
  initializeNiceAIGCRoutes(niceAIGCAdapter);
  logger.info('[NiceAIGC] Adapter initialized');
}).catch(err => {
  logger.error('[NiceAIGC] Failed to initialize:', err);
});

app.use("/api/niceaigc", niceaigcRoutes);
app.use("/api/memory", memoryRoutes);

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

app.post("/api/reset", (req: Request, res: Response) => {
  const userId = req.body.userId || "web-user";
  conversationHistory.delete(userId);
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
  const userDir = path.join(uploadDir, userId);
  
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
  
  let papers = parseLiteratureToStructured(allContent);
  
  const jsonFile = path.join(userDir, "literature.json");
  let existingPapers: LitPaper[] = [];
  
  if (fs.existsSync(jsonFile)) {
    try {
      const existingContent = fs.readFileSync(jsonFile, 'utf-8');
      existingPapers = JSON.parse(existingContent);
      logger.info(`[Upload] Loaded ${existingPapers.length} existing papers with embeddings`);
    } catch (e) {
      logger.warn('[Upload] Failed to load existing literature.json');
    }
  }
  
  papers = await mergePapersWithExisting(papers, existingPapers);
  
  const apiUrl = req.body.apiUrl || req.body.embeddingUrl || process.env.API_URL;
  const apiKey = req.body.apiKey || req.body.embeddingKey || process.env.API_KEY;
  const embeddingModel = req.body.embeddingModel || 'text-embedding-3-small';
  
  if (apiUrl && apiKey) {
    const papersWithoutEmbedding = papers.filter(p => !p.embedding || p.embedding.length === 0);
    if (papersWithoutEmbedding.length > 0) {
      logger.info(`[Upload] Generating embeddings for ${papersWithoutEmbedding.length} new papers`);
      const papersWithEmbeddings = await generateEmbeddingsForPapers(
        papersWithoutEmbedding, 
        apiUrl, 
        apiKey, 
        embeddingModel
      );
      
      const embeddingMap = new Map(papersWithEmbeddings.map(p => 
        [`${p.title}_${p.year}`.toLowerCase(), p.embedding]
      ));
      
      papers = papers.map(p => {
        const key = `${p.title}_${p.year}`.toLowerCase();
        const newEmbedding = embeddingMap.get(key);
        return newEmbedding && newEmbedding.length > 0 
          ? { ...p, embedding: newEmbedding } 
          : p;
      });
    } else {
      logger.info('[Upload] All papers already have embeddings, skipping generation');
    }
  } else {
    logger.warn('[Upload] No API config, skipping embedding generation for new papers');
  }
  
  fs.writeFileSync(jsonFile, JSON.stringify(papers, null, 2), 'utf-8');
  logger.info("[Upload] Saved literature.json with", papers.length, "papers");
  
  fs.writeFileSync(path.join(userDir, "literature.txt"), allContent, 'utf-8');
  
  await backupManager.createBackup(userId);
  logger.info("[Upload] Auto-backed up literature data for user:", userId);
  
  logger.info("[Upload] User " + userId + " uploaded " + files.length + " files, " + totalPapers + " papers");
  
  res.json({
    success: true,
    files: files.map(f => f.originalname),
    summary: summary
  });
});

app.get("/api/literature/:userId", async (req: Request, res: Response) => {
  let userId = req.params.userId;
  let litFile = path.join(uploadDir, userId, "literature.txt");
  
  if (!fs.existsSync(litFile)) {
    const webUserLitFile = path.join(uploadDir, "web-user", "literature.txt");
    const webUserLitJsonFile = path.join(uploadDir, "web-user", "literature.json");
    if (fs.existsSync(webUserLitFile)) {
      const newUserDir = path.join(uploadDir, userId);
      if (!fs.existsSync(newUserDir)) {
        fs.mkdirSync(newUserDir, { recursive: true });
      }
      fs.copyFileSync(webUserLitFile, litFile);
      if (fs.existsSync(webUserLitJsonFile)) {
        const litJsonFile = path.join(uploadDir, userId, "literature.json");
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
          const newUserDir = path.join(uploadDir, userId);
          if (!fs.existsSync(newUserDir)) {
            fs.mkdirSync(newUserDir, { recursive: true });
          }
          fs.copyFileSync(oldLit, litFile);
          if (fs.existsSync(oldLitJson)) {
            const litJsonFile = path.join(uploadDir, userId, "literature.json");
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
  
  const userDir = path.join(uploadDir, userId);
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

app.get("/api/backups/:userId", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  try {
    const backups = await backupManager.listBackups(userId);
    res.json({ success: true, backups });
  } catch (error) {
    logger.error(`[Backups] Failed to list backups for ${userId}:`, error);
    res.status(500).json({ success: false, error: 'Failed to list backups' });
  }
});

app.post("/api/backups/create/:userId", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  try {
    const backupPath = await backupManager.createBackup(userId);
    if (backupPath) {
      res.json({ success: true, message: 'Backup created successfully', path: backupPath });
    } else {
      res.status(400).json({ success: false, error: 'No data to backup' });
    }
  } catch (error) {
    logger.error(`[Backups] Failed to create backup for ${userId}:`, error);
    res.status(500).json({ success: false, error: 'Failed to create backup' });
  }
});

app.post("/api/backups/restore", async (req: Request, res: Response) => {
  const { backupName, userId } = req.body;
  try {
    const success = await backupManager.restoreBackup(backupName, userId);
    if (success) {
      res.json({ success: true, message: 'Backup restored successfully' });
    } else {
      res.status(400).json({ success: false, error: 'Failed to restore backup' });
    }
  } catch (error) {
    logger.error(`[Backups] Failed to restore backup ${backupName}:`, error);
    res.status(500).json({ success: false, error: 'Failed to restore backup' });
  }
});

app.post("/api/chat", chatUpload.none(), async (req: Request, res: Response) => {
  const userId = req.body.userId || "web-user";
  const userMessage = req.body.message || "";
  const conversationId = req.body.conversationId || "";
  const history = JSON.parse(req.body.history || "[]");
  const apiUrl = req.body.apiUrl || process.env.API_URL || "";
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
    const userDir = path.join(uploadDir, userId);
    const litFile = path.join(userDir, "literature.txt");
    const litJsonFile = path.join(userDir, "literature.json");
    
    logger.info(`[Chat] Checking literature for user: ${userId}`);
    logger.info(`[Chat] Looking for: ${litFile}`);
    logger.info(`[Chat] Looking for JSON: ${litJsonFile}`);
    
    let literaturePapers: LitPaper[] = [];
    let literatureSummary = "";
    let hasLiterature = false;
    
    if (fs.existsSync(litFile)) {
      hasLiterature = true;
      logger.info(`[Chat] Found literature.txt for ${userId}`);
      if (fs.existsSync(litJsonFile)) {
        try {
          literaturePapers = JSON.parse(fs.readFileSync(litJsonFile, 'utf-8'));
          logger.info(`[Chat] Loaded ${literaturePapers.length} papers from literature.json for ${userId}`);
          if (literaturePapers.length > 0 && literaturePapers[0].embedding) {
            logger.info(`[Chat] Papers have embeddings: ${literaturePapers.filter(p => p.embedding && p.embedding.length > 0).length}/${literaturePapers.length}`);
          }
        } catch (e) {
          logger.warn(`[Chat] Failed to parse literature.json, falling back to txt: ${e}`);
          const litContent = fs.readFileSync(litFile, 'utf-8');
          literaturePapers = parseLiteratureToStructured(litContent);
        }
      } else {
        logger.info(`[Chat] No literature.json found, parsing from txt`);
        const litContent = fs.readFileSync(litFile, 'utf-8');
        literaturePapers = parseLiteratureToStructured(litContent);
      }
      
      const summary = getLitSummary(fs.readFileSync(litFile, 'utf-8'));
      literatureSummary = `文献总数: ${summary.count} 篇, 年份: ${summary.years.join(", ")}, 期刊: ${summary.journals.slice(0, 5).join(", ")}`;
    } else {
      logger.warn(`[Chat] No literature.txt found for user: ${userId} at ${litFile}`);
    }
    
    const journalStyleDir = path.join(userDir, "journal-styles");
    let journalStyleContent = "";
    let journalStyleHint = "";
    
    logger.info(`[Chat] Checking journal styles at: ${journalStyleDir}`);
    
    if (fs.existsSync(journalStyleDir)) {
      logger.info(`[Chat] Found journal-styles directory for ${userId}`);
      const styleFiles = fs.readdirSync(journalStyleDir);
      logger.info(`[Chat] Style files found: ${styleFiles.length}`);
      if (styleFiles.length > 0) {
        const latestStyle = styleFiles.sort().pop();
        logger.info(`[Chat] Latest style: ${latestStyle}`);
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
              logger.info(`[Chat] Loaded journal style for ${userId}: ${styleData.length} papers analyzed`);
            } catch (e) {
              logger.warn("[Chat] Failed to load journal style:", e);
            }
          } else {
            logger.warn(`[Chat] style.json not found at: ${stylePath}`);
          }
        }
      }
    } else {
      logger.warn(`[Chat] No journal-styles directory for user: ${userId}`);
    }
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
分析用户的问题，做出决策：
1. 是否需要联网搜索最新信息？
2. 用户想要做什么？（回答问题/写讨论/写引言/逐句检索/其他）

## 决策规则
- 如果问题涉及最新研究成果（2024-2026）、实时数据，**必须联网搜索**
- 如果用户要求"逐句检索"、"为这句话找文献"、"检索支撑文献"等，**task_type = "逐句检索"**
- 如果用户要求写某个章节（引言/讨论/方法等），**task_type = "写XX"**
- 普通问答，**task_type = "回答问题"**

## 输出格式
返回以下 JSON 格式：
{
  "need_web_search": true/false,
  "web_search_query": "联网搜索关键词",
  "task_type": "回答问题/写讨论/写引言/逐句检索/其他",
  "reason": "判断理由"
}

只返回 JSON，不要有其他文字。`;

    const decisionMessages = [
      { role: "system", content: decisionPrompt },
      { role: "user", content: userMessage }
    ];
    
    const decisionResponse = await fetch(apiUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: model,
        messages: decisionMessages,
        temperature: 0.3,
        max_tokens: 600,
      }),
    });
    
    let needWebSearch = false;
    let webSearchQuery = "";
    let taskType = "回答问题";
    
    if (decisionResponse.ok) {
      const decisionData = await decisionResponse.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const decisionText = decisionData.choices?.[0]?.message?.content || "";
      
      try {
        const jsonMatch = decisionText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const decision = JSON.parse(jsonMatch[0]);
          needWebSearch = decision.need_web_search === true;
          webSearchQuery = decision.web_search_query || userMessage;
          taskType = decision.task_type || "回答问题";
          logger.info(`[Chat] AI decision: web=${needWebSearch}, task=${taskType}, reason=${decision.reason}`);
        }
      } catch (e) {
        logger.warn("[Chat] Failed to parse decision:", decisionText);
      }
    }
    
    let relevantLiterature = "";
    
    if (literaturePapers.length > 0) {
      const { references } = getReferencesForWriting(userMessage, literaturePapers, 10);
      relevantLiterature = references;
      logger.info(`[Chat] Auto-retrieved references for: ${userMessage}`);
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
      taskHint = "\n## 写作任务\n用户想要你写 Discussion（讨论）部分。请使用【代码自动检索的参考文献】中提供的引用格式撰写内容。\n";
    } else if (taskType === "写引言") {
      taskHint = "\n## 写作任务\n用户想要你写 Introduction（引言）部分。请使用【代码自动检索的参考文献】中提供的引用格式撰写内容。\n";
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
1. **文献库搜索**：使用系统提供的【代码自动检索的参考文献】
2. **联网搜索**：已配置 Tavily API，可以搜索互联网最新研究（仅用于背景信息，**不能用于参考文献**）
3. **复制粘贴引用**：严格使用代码提供的引用格式，严禁修改
4. **写作进度追踪**：系统记录用户的写作进度，可以continuation 未完成的章节

## ⚠️ 重要：代码控制参考文献

### 系统已自动完成
- 代码已从您的文献库中检索出最相关的10篇文献
- 每篇文献的完整信息（标题、作者、年份、期刊、DOI、摘要）已提供
- 标准化的引用格式已生成

### 你的任务（严格遵循）
1. **阅读【代码自动检索的参考文献】部分**
2. **使用提供的引用格式**（如：(Wang et al., 2023)）
3. **复制粘贴，严禁修改**：
   - 不要修改作者姓名
   - 不要修改年份
   - 不要修改标题
   - 不要编造文献中不存在的细节

### 绝对禁止
❌ **严禁以下行为**：
- 编造不存在的文献
- 修改代码提供的引用格式
- 从摘要中编造原文不存在的细节
- 使用网络搜索结果作为参考文献

✅ **唯一正确的做法**：
- 从【代码自动检索的参考文献】列表中选择合适的文献
- 复制代码提供的引用格式到正文中
- 基于提供的摘要撰写内容，但不编造细节

## 文献库信息
${hasLiterature ? literatureSummary : "用户还没有上传文献。"}
${journalStyleContent}
${journalStyleHint}

${relevantLiterature}
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
    
    const llmResponse = await fetch(apiUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });
    
    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      logger.error("[Chat] LLM API error:", llmResponse.status, errText);
      res.json({ error: `API 错误 (${llmResponse.status}): ${errText.substring(0, 100)}` });
      return;
    }
    
    const llmData = await llmResponse.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    
    if (llmData.error) {
      logger.error("[Chat] LLM error:", llmData.error);
      res.json({ error: "LLM 错误: " + (llmData.error.message || "未知错误") });
      return;
    }
    
    const response = llmData.choices?.[0]?.message?.content || "抱歉，我无法生成回复。";
    
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
  const memory = loadUserMemory(userId);
  res.json({ 
    success: true,
    memory: {
      entries: memory.entries,
      conversations: memory.conversations,
      count: memory.conversations.length
    }
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
  const { experimentSummary, dataSummary, merge = true, append = false } = req.body;
  
  try {
    const memory = loadUserMemory(userId);
    
    // 获取现有记忆
    const existingExperimentSummary = memory.entries.find(e => e.key === 'experiment_summary')?.value || '';
    const existingDataSummary = memory.entries.find(e => e.key === 'data_summary')?.value || '';
    
    // 智能合并提示词
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
    
    // 简单追加逻辑（用户明确要求追加时使用）
    const simpleAppend = (existing: string, newContent: string): string => {
      if (!existing) return newContent;
      if (!newContent) return existing;
      return existing + '\n\n' + newContent;
    };
    
    // 如果需要合并且有现有记忆
    let finalExperimentSummary = experimentSummary;
    let finalDataSummary = dataSummary;
    
    // 实验资料总结追加逻辑
    if (experimentSummary) {
      if (append) {
        // 简单追加模式
        finalExperimentSummary = simpleAppend(existingExperimentSummary, experimentSummary);
        logger.info(`[Memory] Appended experiment_summary, new length: ${finalExperimentSummary.length}`);
      } else if (merge && existingExperimentSummary) {
        // AI 智能合并模式（默认）
        const apiUrl = process.env.API_URL || "";
        const apiKey = process.env.API_KEY || "";
        const model = process.env.PRIMARY_MODEL || "qwen3.5-plus";
        
        try {
          logger.info("[Memory] Merging experiment_summary with existing memory...");
          const mergeResponse = await fetch(apiUrl + "/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + apiKey,
            },
            body: JSON.stringify({
              model: model,
              messages: [{ role: "system", content: mergePrompt(existingExperimentSummary, experimentSummary, '实验资料总结') }],
              temperature: 0.3,
              max_tokens: 32000,
            }),
          });
          
          if (mergeResponse.ok) {
            const mergeData = await mergeResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
            const mergedContent = mergeData.choices?.[0]?.message?.content;
            if (mergedContent && mergedContent.length > 10) {
              finalExperimentSummary = mergedContent.trim();
              logger.info("[Memory] experiment_summary merged successfully, length:", finalExperimentSummary.length);
            }
          }
        } catch (e) {
          logger.warn("[Memory] Merge failed, using original content:", (e as Error).message);
        }
      }
    }
    
    // 数据详细总结追加逻辑
    if (dataSummary) {
      if (append) {
        // 简单追加模式
        finalDataSummary = simpleAppend(existingDataSummary, dataSummary);
        logger.info(`[Memory] Appended data_summary, new length: ${finalDataSummary.length}`);
      } else if (merge && existingDataSummary) {
        // AI 智能合并模式（默认）
        const apiUrl = process.env.API_URL || "";
        const apiKey = process.env.API_KEY || "";
        const model = process.env.PRIMARY_MODEL || "qwen3.5-plus";
        
        try {
          logger.info("[Memory] Merging data_summary with existing memory...");
          const mergeResponse = await fetch(apiUrl + "/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + apiKey,
            },
            body: JSON.stringify({
              model: model,
              messages: [{ role: "system", content: mergePrompt(existingDataSummary, dataSummary, '数据详细总结') }],
              temperature: 0.3,
              max_tokens: 32000,
            }),
          });
          
          if (mergeResponse.ok) {
            const mergeData = await mergeResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
            const mergedContent = mergeData.choices?.[0]?.message?.content;
            if (mergedContent && mergedContent.length > 10) {
              finalDataSummary = mergedContent.trim();
              logger.info("[Memory] data_summary merged successfully, length:", finalDataSummary.length);
            }
          }
        } catch (e) {
          logger.warn("[Memory] Merge failed, using original content:", (e as Error).message);
        }
      }
    }
    
    // 更新记忆
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
      } else {
        memory.entries.push(newEntry);
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
      } else {
        memory.entries.push(newEntry);
      }
    }
    
    saveUserMemory(memory);
    logger.info("[Memory] Manual update completed for user:", userId);
    
    res.json({ success: true, message: "记忆已更新", merged: merge });
  } catch (e) {
    logger.error("[Memory] Manual update failed:", e);
    res.json({ success: false, error: "更新失败：" + (e as Error).message });
  }
});

app.post("/api/analyze-journal-style", upload.array("files", 10), async (req: Request, res: Response) => {
  const userId = req.body.userId || "web-user";
  const apiUrl = req.body.apiUrl || process.env.API_URL || "";
  const apiKey = req.body.apiKey || process.env.API_KEY || "";
  const userDir = path.join(uploadDir, userId);
  
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
      const response = await fetch(apiUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify({
          model: "qwen3.5-plus",
          messages: [{ role: "user", content: singlePaperPrompt }],
          temperature: 0.3,
          max_tokens: 8000,
        }),
      });
      
      if (!response.ok) {
        logger.warn(`[JournalStyle] Paper ${i + 1} failed: ${response.status}`);
        continue;
      }
      
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content || "";
      
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

// ============ 论文草稿管理 ============

// 获取论文草稿
app.get("/api/draft/:userId", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const userDir = path.join(uploadDir, userId);
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
  
  // 优先从 sessionStore 读取章节草稿
  try {
    const drafts = await sessionStore.listDrafts(userId);
    if (drafts.length > 0) {
      // 按章节顺序合并所有草稿
      const chapterOrder = ['title', 'abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusion'];
      const sortedDrafts = drafts.sort((a, b) => {
        const indexA = chapterOrder.indexOf(a.chapterName.toLowerCase());
        const indexB = chapterOrder.indexOf(b.chapterName.toLowerCase());
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime();
      });
      
      // 加载每个章节的内容并合并
      let combinedContent = '';
      for (const draft of sortedDrafts) {
        const draftData = await sessionStore.loadDraft(userId, draft.chapterName);
        if (draftData) {
          combinedContent += `\\section{${draft.chapterName.charAt(0).toUpperCase() + draft.chapterName.slice(1)}}\n`;
          combinedContent += draftData.content + '\n\n';
        }
      }
      
      if (combinedContent.length > 0) {
        logger.info(`[Draft] Loaded ${drafts.length} chapters from sessionStore for user ${userId}`);
        res.json({
          exists: true,
          content: combinedContent,
          journal_style: journalName || '目标期刊',
          filename: `paper-draft-${userId}`,
          chapters: drafts.map(d => d.chapterName),
          source: 'sessionStore'
        });
        return;
      }
    }
  } catch (error) {
    logger.warn(`[Draft] Failed to load from sessionStore: ${error}`);
  }
  
  // 回退到旧的 paper-draft.tex 文件
  if (fs.existsSync(draftFile)) {
    const content = fs.readFileSync(draftFile, 'utf-8');
    res.json({
      exists: true,
      content: content,
      journal_style: journalName || '目标期刊',
      filename: `paper-draft-${userId}`,
      source: 'legacy'
    });
  } else {
    res.json({
      exists: false,
      journal_style: journalName || '目标期刊'
    });
  }
});

// 保存/更新论文草稿
app.post("/api/draft/:userId", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const { content, section, append = true } = req.body;
  
  if (!content) {
    res.json({ success: false, error: "内容为空" });
    return;
  }
  
  const userDir = path.join(uploadDir, userId);
  const draftDir = path.join(userDir, "drafts");
  const draftFile = path.join(userDir, "paper-draft.tex");
  
  // 确保目录存在
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  if (!fs.existsSync(draftDir)) {
    fs.mkdirSync(draftDir, { recursive: true });
  }
  
  try {
    // 获取期刊风格信息（用于 LaTeX 格式）
    const journalStyleDir = path.join(userDir, "journal-styles");
    let latexStyle = "article";
    let citationStyle = "apalike";
    
    if (fs.existsSync(journalStyleDir)) {
      const styleFolders = fs.readdirSync(journalStyleDir);
      if (styleFolders.length > 0) {
        const styleFile = path.join(journalStyleDir, styleFolders[0], "style.json");
        if (fs.existsSync(styleFile)) {
          const styleData = JSON.parse(fs.readFileSync(styleFile, 'utf-8'));
          const citationFormat = styleData[0]?.citation_format;
          
          if (citationFormat) {
            if (citationFormat.reference_style === 'APA' || citationFormat.in_text_style === '作者年份制') {
              citationStyle = "apalike";
            } else if (citationFormat.reference_style === 'IEEE') {
              citationStyle = "ieeetr";
            } else if (citationFormat.reference_style === 'Nature') {
              citationStyle = "nature";
            } else if (citationFormat.reference_style === 'Chicago') {
              citationStyle = "chicago";
            }
          }
        }
      }
    }
    
    let existingContent = "";
    if (fs.existsSync(draftFile)) {
      existingContent = fs.readFileSync(draftFile, 'utf-8');
    }
    
    // 如果是第一个章节，需要添加 LaTeX 导言区
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
    if (append && existingContent) {
      // 追加模式：在 \\end{document} 之前插入
      if (existingContent.includes("\\end{document}")) {
        const parts = existingContent.split("\\end{document}");
        newContent = parts[0] + content + "\n\n\\end{document}";
      } else {
        newContent = existingContent + "\n\n" + content;
      }
    } else {
      // 覆盖模式
      newContent = content;
    }
    
    fs.writeFileSync(draftFile, newContent, 'utf-8');
    
    // 同时保存一个备份（带时间戳）
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupFile = path.join(draftDir, `draft-${section || 'section'}-${timestamp}.tex`);
    fs.writeFileSync(backupFile, newContent, 'utf-8');
    
    logger.info(`[Draft] Saved draft for user ${userId}, section: ${section || 'unknown'}`);
    
    res.json({
      success: true,
      message: "草稿已保存",
      filename: `paper-draft-${userId}.tex`
    });
    
  } catch (e) {
    logger.error("[Draft] Error:", e);
    res.json({ success: false, error: "保存失败：" + (e as Error).message });
  }
});

// 清空草稿
app.delete("/api/draft/:userId", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const userDir = path.join(uploadDir, userId);
  const draftFile = path.join(userDir, "paper-draft.tex");
  
  if (fs.existsSync(draftFile)) {
    fs.unlinkSync(draftFile);
    logger.info(`[Draft] Deleted draft for user ${userId}`);
  }
  
  res.json({ success: true });
});

// ============ 章节草稿管理（使用 SessionStore） ============

// 保存章节草稿（支持追加模式）
app.post("/api/chapter-draft/:userId", async (req: Request, res: Response) => {
  try {
    const { chapter, content, append = false } = req.body;
    const userId = req.params.userId;
    
    const draftDir = path.join(dataDir, 'output', 'chapters', userId);
    if (!fs.existsSync(draftDir)) {
      fs.mkdirSync(draftDir, { recursive: true });
    }
    
    const filePath = path.join(draftDir, `${chapter}.md`);
    
    // 如果是追加模式，读取现有内容并追加
    let finalContent = content;
    if (append && fs.existsSync(filePath)) {
      const existingContent = fs.readFileSync(filePath, 'utf-8');
      finalContent = existingContent + '\n\n' + content;
      logger.info(`[ChapterDraft] Appended for user ${userId}, chapter ${chapter}`);
    } else {
      logger.info(`[ChapterDraft] Created/Overwritten for user ${userId}, chapter ${chapter}`);
    }
    
    fs.writeFileSync(filePath, finalContent, 'utf-8');
    
    // 同时保存到 memory.json 中的 draft_progress
    // 记录最新更新时间
    const memory = loadUserMemory(userId);
    const draftProgressEntry = memory.entries.find(e => e.key === 'draft_progress');
    if (draftProgressEntry) {
      draftProgressEntry.value = `最后更新：${new Date().toLocaleString('zh-CN')} - 章节 ${chapter}`;
      draftProgressEntry.timestamp = new Date().toISOString();
    } else {
      memory.entries.push({
        key: 'draft_progress',
        value: `最后更新：${new Date().toLocaleString('zh-CN')} - 章节 ${chapter}`,
        source: 'ai-extracted',
        timestamp: new Date().toISOString()
      });
    }
    saveUserMemory(memory);
    
    res.json({ success: true, filePath, mode: append ? 'append' : 'overwrite' });
  } catch (e) {
    logger.error("[ChapterDraft] Save failed:", e);
    res.json({ success: false, error: "保存失败：" + (e as Error).message });
  }
});

app.delete("/api/chapter-draft/:userId/:chapter", async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;
    const chapter = req.params.chapter;
    
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

// 1. 保存实验资料总结（专用接口）
app.post("/api/research-material/save", async (req: Request, res: Response) => {
  const { content, append = true, apiKey, apiUrl } = req.body;
  const userId = "web-user";
  
  const useApiKey = apiKey || process.env.API_KEY || "";
  const useApiUrl = apiUrl || process.env.API_URL || "";
  
  logger.info(`[ResearchMaterial] API called - userId: ${userId}, content length: ${content?.length || 0}, append: ${append}`);
  logger.info(`[ResearchMaterial] Using API URL: ${useApiUrl}, API Key provided: ${useApiKey ? 'YES' : 'NO (using env)'}`);
  
  if (!content) {
    logger.warn(`[ResearchMaterial] Rejected - empty content`);
    res.json({ success: false, error: "内容为空" });
    return;
  }
  
  const memory = loadUserMemory(userId);
  let existingEntry = memory.entries.find(e => e.key === 'experiment_summary');
  
  if (!existingEntry) {
    logger.info(`[ResearchMaterial] Creating new entry for experiment_summary`);
    existingEntry = {
      key: 'experiment_summary',
      value: '',
      source: 'user-updated',
      timestamp: new Date().toISOString()
    };
    memory.entries.push(existingEntry);
  } else {
    logger.info(`[ResearchMaterial] Found existing entry - current length: ${existingEntry.value?.length || 0}`);
  }
  
  let finalContent = content;
  if (append && existingEntry.value) {
    logger.info(`[ResearchMaterial] Append mode - merging with existing content`);
    try {
      const mergeStartTime = Date.now();
      const mergedResponse = await fetch(useApiUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + useApiKey,
        },
        body: JSON.stringify({
          model: "qwen3.5-plus",
          messages: [
            { role: "system", content: "You are a research data management expert. Merge new experimental content with existing content. Remove duplicates, organize logically, and output the complete merged document without explanations or markers like '新增' or '补充'." },
            { role: "user", content: `Existing content:\n${existingEntry.value.substring(0, 28000)}\n\nNew content:\n${content.substring(0, 8000)}\n\nPlease merge these two experimental materials into a coherent document.` }
          ],
          temperature: 0.2,
          max_tokens: 32000,
        }),
      });
      
      const mergeDuration = Date.now() - mergeStartTime;
      logger.info(`[ResearchMaterial] AI merge request completed in ${mergeDuration}ms - status: ${mergedResponse.status}`);
      
      if (mergedResponse.ok) {
        const data = await mergedResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
        const merged = data.choices?.[0]?.message?.content;
        if (merged && merged.length > 10) {
          finalContent = merged.trim();
          logger.info(`[ResearchMaterial] AI merge successful - merged content length: ${finalContent.length}`);
        } else {
          logger.warn(`[ResearchMaterial] AI merge returned empty or invalid content, using simple append`);
          finalContent = existingEntry.value + "\n\n---\n\n" + content;
        }
      } else {
        const errorText = await mergedResponse.text();
        logger.error(`[ResearchMaterial] AI merge failed - status: ${mergedResponse.status}, error: ${errorText}`);
        finalContent = existingEntry.value + "\n\n---\n\n" + content;
      }
    } catch (e) {
      logger.error(`[ResearchMaterial] AI merge exception: ${(e as Error).message}, using simple append`);
      finalContent = existingEntry.value + "\n\n---\n\n" + content;
    }
  } else {
    logger.info(`[ResearchMaterial] Overwrite mode or no existing content - saving new content directly`);
  }
  
  existingEntry.value = finalContent;
  existingEntry.timestamp = new Date().toISOString();
  saveUserMemory(memory);
  
  logger.info(`[ResearchMaterial] Save completed - final length: ${finalContent.length}, saved to memory.json`);
  
  res.json({ 
    success: true, 
    length: finalContent.length,
    characters: finalContent.length
  });
});

// 2. 保存数据详细总结（专用接口）
app.post("/api/data-summary/save", async (req: Request, res: Response) => {
  const { content, append = true, apiKey, apiUrl } = req.body;
  const userId = "web-user";
  
  const useApiKey = apiKey || process.env.API_KEY || "";
  const useApiUrl = apiUrl || process.env.API_URL || "";
  
  logger.info(`[DataSummary] API called - userId: ${userId}, content length: ${content?.length || 0}, append: ${append}`);
  logger.info(`[DataSummary] Using API URL: ${useApiUrl}, API Key provided: ${useApiKey ? 'YES' : 'NO (using env)'}`);
  
  if (!content) {
    logger.warn(`[DataSummary] Rejected - empty content`);
    res.json({ success: false, error: "内容为空" });
    return;
  }
  
  const memory = loadUserMemory(userId);
  let existingEntry = memory.entries.find(e => e.key === 'data_summary');
  
  if (!existingEntry) {
    logger.info(`[DataSummary] Creating new entry for data_summary`);
    existingEntry = {
      key: 'data_summary',
      value: '',
      source: 'user-updated',
      timestamp: new Date().toISOString()
    };
    memory.entries.push(existingEntry);
  } else {
    logger.info(`[DataSummary] Found existing entry - current length: ${existingEntry.value?.length || 0}`);
  }
  
  let finalContent = content;
  if (append && existingEntry.value) {
    logger.info(`[DataSummary] Append mode - merging with existing content`);
    try {
      const mergeStartTime = Date.now();
      const mergedResponse = await fetch(useApiUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + useApiKey,
        },
        body: JSON.stringify({
          model: "qwen3.5-plus",
          messages: [
            { role: "system", content: "You are a research data management expert. Merge new data analysis with existing data. Preserve all numerical values, statistics, and results. Remove duplicates, organize logically, and output the complete merged document without explanations." },
            { role: "user", content: `Existing data:\n${existingEntry.value.substring(0, 28000)}\n\nNew data:\n${content.substring(0, 8000)}\n\nPlease merge these data analyses into a coherent document.` }
          ],
          temperature: 0.2,
          max_tokens: 32000,
        }),
      });
      
      const mergeDuration = Date.now() - mergeStartTime;
      logger.info(`[DataSummary] AI merge request completed in ${mergeDuration}ms - status: ${mergedResponse.status}`);
      
      if (mergedResponse.ok) {
        const data = await mergedResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
        const merged = data.choices?.[0]?.message?.content;
        if (merged && merged.length > 10) {
          finalContent = merged.trim();
          logger.info(`[DataSummary] AI merge successful - merged content length: ${finalContent.length}`);
        } else {
          logger.warn(`[DataSummary] AI merge returned empty or invalid content, using simple append`);
          finalContent = existingEntry.value + "\n\n---\n\n" + content;
        }
      } else {
        const errorText = await mergedResponse.text();
        logger.error(`[DataSummary] AI merge failed - status: ${mergedResponse.status}, error: ${errorText}`);
        finalContent = existingEntry.value + "\n\n---\n\n" + content;
      }
    } catch (e) {
      logger.error(`[DataSummary] AI merge exception: ${(e as Error).message}, using simple append`);
      finalContent = existingEntry.value + "\n\n---\n\n" + content;
    }
  } else {
    logger.info(`[DataSummary] Overwrite mode or no existing content - saving new content directly`);
  }
  
  existingEntry.value = finalContent;
  existingEntry.timestamp = new Date().toISOString();
  saveUserMemory(memory);
  
  logger.info(`[DataSummary] Save completed - final length: ${finalContent.length}, saved to memory.json`);
  
  res.json({ 
    success: true, 
    length: finalContent.length,
    characters: finalContent.length
  });
});

// 3. 保存论文草稿（专用接口）
app.post("/api/paper-draft/save", async (req: Request, res: Response) => {
  const { content, append = true, apiKey, apiUrl, section = "main" } = req.body;
  const userId = "web-user";
  
  const useApiKey = apiKey || process.env.API_KEY || "";
  const useApiUrl = apiUrl || process.env.API_URL || "";
  
  logger.info(`[PaperDraft] API called - userId: ${userId}, section: ${section}, content length: ${content?.length || 0}, append: ${append}`);
  logger.info(`[PaperDraft] Using API URL: ${useApiUrl}, API Key provided: ${useApiKey ? 'YES' : 'NO (using env)'}`);
  
  if (!content) {
    logger.warn(`[PaperDraft] Rejected - empty content`);
    res.json({ success: false, error: "内容为空" });
    return;
  }
  
  const memory = loadUserMemory(userId);
  let existingEntry = memory.entries.find(e => e.key === 'draft_progress');
  
  if (!existingEntry) {
    logger.info(`[PaperDraft] Creating new entry for draft_progress`);
    existingEntry = {
      key: 'draft_progress',
      value: '',
      source: 'ai-extracted',
      timestamp: new Date().toISOString()
    };
    memory.entries.push(existingEntry);
  } else {
    logger.info(`[PaperDraft] Found existing entry - current length: ${existingEntry.value?.length || 0}`);
  }
  
  let finalContent = content;
  if (append && existingEntry.value) {
    logger.info(`[PaperDraft] Append mode - merging with existing content`);
    try {
      const mergeStartTime = Date.now();
      const mergedResponse = await fetch(useApiUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + useApiKey,
        },
        body: JSON.stringify({
          model: "qwen3.5-plus",
          messages: [
            { role: "system", content: "You are an academic writing expert. Merge new draft content with existing draft. Maintain coherence, consistent style and terminology. Insert new content at appropriate positions, not just at the end. Output the complete merged academic paper without explanations." },
            { role: "user", content: `Existing draft:\n${existingEntry.value.substring(0, 28000)}\n\nNew content:\n${content.substring(0, 8000)}\n\nPlease merge these into a coherent academic paper draft.` }
          ],
          temperature: 0.2,
          max_tokens: 32000,
        }),
      });
      
      const mergeDuration = Date.now() - mergeStartTime;
      logger.info(`[PaperDraft] AI merge request completed in ${mergeDuration}ms - status: ${mergedResponse.status}`);
      
      if (mergedResponse.ok) {
        const data = await mergedResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
        const merged = data.choices?.[0]?.message?.content;
        if (merged && merged.length > 10) {
          finalContent = merged.trim();
          logger.info(`[PaperDraft] AI merge successful - merged content length: ${finalContent.length}`);
        } else {
          logger.warn(`[PaperDraft] AI merge returned empty or invalid content, using simple append`);
          finalContent = existingEntry.value + "\n\n---\n\n" + content;
        }
      } else {
        const errorText = await mergedResponse.text();
        logger.error(`[PaperDraft] AI merge failed - status: ${mergedResponse.status}, error: ${errorText}`);
        finalContent = existingEntry.value + "\n\n---\n\n" + content;
      }
    } catch (e) {
      logger.error(`[PaperDraft] AI merge exception: ${(e as Error).message}, using simple append`);
      finalContent = existingEntry.value + "\n\n---\n\n" + content;
    }
  } else {
    logger.info(`[PaperDraft] Overwrite mode or no existing content - saving new content directly`);
  }
  
  existingEntry.value = finalContent;
  existingEntry.timestamp = new Date().toISOString();
  saveUserMemory(memory);
  
  logger.info(`[PaperDraft] Save completed - final length: ${finalContent.length}, saved to memory.json`);
  
  res.json({ 
    success: true, 
    length: finalContent.length,
    characters: finalContent.length,
    section: section
  });
});

// ============ 全局共享组件（飞书和 Web UI 共用） ============

// 全局检索引擎单例 - 所有用户共用同一个文献索引
const globalRetrievalEngine = new HybridRetrievalEngine({}, { 
  url: currentApiUrl, 
  key: currentApiKey 
});

// 设置文献路由使用全局检索引擎
setRetrievalEngine(globalRetrievalEngine);

// 全局消息处理器 - 用于飞书和 Web UI
const globalMessageHandler = {
  async send(userId: string, message: string): Promise<void> {
    // Web UI 的 send 实现（通过 HTTP 响应）
    logger.info(`[GlobalHandler] Message to ${userId}: ${message.substring(0, 50)}...`);
  },
  async handle(userId: string, message: string): Promise<string> {
    return await processChatMessage(userId, message);
  },
};

// 全局 ConversationFlow - 管理所有用户的会话状态
const globalConversationFlow = new ConversationFlow(
  globalMessageHandler,
  sessionStore,
  { 
    apiUrl: currentApiUrl, 
    apiKey: currentApiKey,
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    maxConcurrency: 5 
  },
  globalRetrievalEngine  // 传入共享的检索引擎实例
);

// ============ 飞书配置（支持运行时动态更新） ============

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
    }, globalConversationFlow, processChatMessage);

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
    }, undefined as any, processChatMessage);
    
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
      error: "启动失败：" + (error as Error).message
    });
  }
});

// 飞书状态查询 API
app.get("/api/feishu/status", (req: Request, res: Response) => {
  res.json({
    configured: !!feishuAppId && !!feishuAppSecret,
    connected: feishuWebSocketClient?.isConnectionAlive() || false,
    appId: feishuAppId ? feishuAppId.substring(0, 8) + '...' : ''
  });
});

// ============ AI 总结生成 API ============

// 生成结构化实验资料总结
app.post("/api/summary/generate", async (req: Request, res: Response) => {
  const { content, type, apiKey, apiUrl, model = "qwen3.5-plus" } = req.body;
  
  // 必须使用用户提供的 API 配置
  if (!apiKey || !apiUrl) {
    res.json({ success: false, error: "未配置 API，请在左下角设置 API 地址和密钥" });
    return;
  }
  
  const useApiKey = apiKey;
  const useApiUrl = apiUrl;
  
  if (!content) {
    res.json({ success: false, error: "内容为空" });
    return;
  }
  
  if (!type || !['experiment', 'data'].includes(type)) {
    res.json({ success: false, error: "类型无效，应为 'experiment' 或 'data'" });
    return;
  }
  
  try {
    logger.info(`[Summary] Generating ${type} summary, content length: ${content.length}`);
    
    const isExperiment = type === 'experiment';
    const summaryPrompt = isExperiment 
      ? `请对以下实验资料进行结构化总结，生成一份清晰、简洁的实验资料全面总结。

## 原始实验资料
${content.substring(0, 15000)}

## 输出要求
请按以下结构生成总结（使用Markdown格式）：

### 📋 研究背景
[一句话概括研究背景和意义]

### 🎯 实验目的
[明确实验的主要目标]

### 📍 实验地点与环境
- 地理位置：[具体地点和坐标]
- 气候条件：[年均温、降水量等]
- 土壤性质：[土壤类型、基本理化性质]

### 🔬 实验设计
- 处理设置：[各处理组名称及设置]
- 采样方法：[采样装置、频率、时间]
- 测定方法：[各指标测定方法]

### 📊 主要结果
- [关键发现1]
- [关键发现2]
- [关键发现3]

### 💡 核心结论
[一句话总结核心结论]

### 📝 补充说明
[其他重要信息，如年际变异、特殊情况等]

要求：
1. 保留所有关键数值（温度、降水、土壤性质等）
2. 结构清晰，层次分明
3. 语言简洁专业
4. 总字数控制在800-1500字`
      : `请对以下实验数据进行结构化总结，生成一份清晰、简洁的数据详细总结。

## 原始数据资料
${content.substring(0, 15000)}

## 输出要求
请按以下结构生成总结（使用Markdown格式）：

### 📊 数据概览
- 数据年份：[包含哪些年份的数据]
- 数据类型：[观测数据/实验数据/模型数据等]
- 数据量：[样本数量、观测频次等]

### 🌡️ 环境条件数据
- 温度数据：[年均温、季节变化、年际变异等]
- 降水数据：[年降水量、季节分布、年际变异等]
- 土壤条件：[水分含量、WFPS等关键指标]

### 📈 排放/测量数据
- 主要指标：[N2O、NO等排放数据范围]
- 峰值特征：[峰值出现条件、数值范围]
- 累积排放：[各处理累积排放量对比]

### 🔬 统计分析结果
- 处理间差异：[显著性水平、差异幅度]
- 年际变异：[不同年份数据对比]
- 关键比值：[如NO/N2O比值等]

### 🧬 微生物数据（如有）
- 功能基因丰度：[关键基因丰度变化]
- 群落结构：[主要微生物类群]

### 💡 数据解读要点
- [数据反映的关键规律]
- [与预期的差异]
- [数据质量和局限性说明]

要求：
1. 保留所有具体数值和单位
2. 突出数据间的对比关系
3. 结构清晰，便于查阅
4. 总字数控制在800-1500字`;
    
    const response = await fetch(useApiUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + useApiKey,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: "你是一个专业的学术数据分析和总结助手。" },
          { role: "user", content: summaryPrompt }
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });
    
    if (response.ok) {
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const summary = data.choices?.[0]?.message?.content || "";
      
      if (summary.length > 50) {
        logger.info(`[Summary] Generated successfully, length: ${summary.length}`);
        res.json({ 
          success: true, 
          summary: summary.trim(),
          type: type,
          originalLength: content.length,
          summaryLength: summary.length
        });
      } else {
        logger.warn(`[Summary] Generated content too short: ${summary.length}`);
        res.json({ 
          success: false, 
          error: "生成的总结过短，请检查原始内容" 
        });
      }
    } else {
      const errorText = await response.text();
      logger.error(`[Summary] API failed: ${response.status} - ${errorText}`);
      res.json({ 
        success: false, 
        error: `AI 服务返回错误 (${response.status})` 
      });
    }
  } catch (error) {
    logger.error("[Summary] Error:", error);
    res.json({ 
      success: false, 
      error: "生成失败：" + (error as Error).message 
    });
  }
});

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

// ============ 逐句检索写作 API ============

// 句子级文献检索
app.post("/api/sentence/search", async (req: Request, res: Response) => {
  const { sentences, userId, apiKey, apiUrl } = req.body;
  
  if (!sentences || !Array.isArray(sentences) || sentences.length === 0) {
    res.json({ success: false, error: "请提供需要检索的句子数组" });
    return;
  }
  
  try {
    const userDir = path.join(uploadDir, userId || "web-user");
    const litJsonFile = path.join(userDir, "literature.json");
    
    let literaturePapers: LitPaper[] = [];
    if (fs.existsSync(litJsonFile)) {
      literaturePapers = JSON.parse(fs.readFileSync(litJsonFile, 'utf-8'));
    }
    
    if (literaturePapers.length === 0) {
      res.json({ success: false, error: "文献库为空，请先上传文献" });
      return;
    }
    
    logger.info(`[SentenceSearch] Searching references for ${sentences.length} sentences`);
    
    // 为每个句子检索文献
    const results: Record<string, any[]> = {};
    
    for (const sentence of sentences) {
      if (!sentence || typeof sentence !== 'string') continue;
      
      // 提取关键词（简化版，使用整个句子作为查询）
      const searchResults = searchLiterature(sentence, literaturePapers, 5);
      
      results[sentence] = searchResults.map(result => ({
        title: result.paper.title,
        author: result.paper.author,
        year: result.paper.year,
        journal: result.paper.journal,
        doi: result.paper.doi,
        abstract: result.paper.abstract,
        score: result.score,
        citation: formatCitation(result.paper)
      }));
      
      logger.info(`[SentenceSearch] "${sentence.substring(0, 30)}..." found ${searchResults.length} refs`);
    }
    
    res.json({ 
      success: true, 
      results,
      totalSentences: sentences.length,
      literatureCount: literaturePapers.length
    });
    
  } catch (error) {
    logger.error("[SentenceSearch] Error:", error);
    res.json({ success: false, error: "检索失败: " + (error as Error).message });
  }
});

// 辅助函数：格式化引用
function formatCitation(paper: LitPaper): string {
  const authors = paper.author.split(/[,;]/).map(a => a.trim());
  const firstAuthor = authors[0];
  const authorLastName = firstAuthor.split(/\s+/).pop() || firstAuthor;
  
  if (authors.length >= 3) {
    return `(${authorLastName} et al., ${paper.year})`;
  } else if (authors.length === 2) {
    const secondAuthor = authors[1].split(/\s+/).pop() || authors[1];
    return `(${authorLastName} and ${secondAuthor}, ${paper.year})`;
  } else {
    return `(${authorLastName}, ${paper.year})`;
  }
}
