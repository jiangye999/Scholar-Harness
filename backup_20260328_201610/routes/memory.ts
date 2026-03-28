/**
 * 记忆管理路由 - 手脚层功能
 * 负责根据 NiceAIGC 的响应更新跨会话的长期记忆
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import * as path from 'path';
import * as fs from 'fs';

const router = Router();

// 数据目录
const dataDir = path.resolve(__dirname, '..', '..', '..', 'data');
const uploadDir = path.join(dataDir, 'uploads');

interface MemoryEntry {
  key: string;
  value: string;
  source: string;
  timestamp: string;
}

interface UserMemory {
  userId: string;
  entries: MemoryEntry[];
  conversations: any[];
  updatedAt: string;
}

/**
 * POST /api/memory/update
 * 根据对话内容更新用户记忆
 */
router.post('/update', async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId || 'web-user';
    const userMessage = req.body.userMessage || '';
    const aiResponse = req.body.aiResponse || '';
    const apiUrl = req.body.apiUrl || process.env.API_URL || '';
    const apiKey = req.body.apiKey || process.env.API_KEY || '';
    const model = req.body.model || 'gpt-3.5-turbo';

    logger.info(`[Memory] Updating memory for user: ${userId}`);

    // 加载现有记忆
    const userMemory = loadUserMemory(userId);
    
    // 提取需要更新的记忆键值对
    const extractedInfo = await extractMemoryFromConversation(
      userMessage,
      aiResponse,
      apiUrl,
      apiKey,
      model
    );

    // 更新记忆
    const updatedKeys: string[] = [];
    for (const [key, value] of Object.entries(extractedInfo)) {
      if (value && value.trim()) {
        // 查找是否已存在
        const existingIndex = userMemory.entries.findIndex(e => e.key === key);
        const entry: MemoryEntry = {
          key,
          value: value.trim(),
          source: 'conversation',
          timestamp: new Date().toISOString()
        };

        if (existingIndex >= 0) {
          userMemory.entries[existingIndex] = entry;
        } else {
          userMemory.entries.push(entry);
        }
        updatedKeys.push(key);
        logger.info(`[Memory] Updated ${key} for user: ${userId}`);
      }
    }

    // 保存记忆
    userMemory.updatedAt = new Date().toISOString();
    saveUserMemory(userId, userMemory);

    res.json({
      success: true,
      updatedKeys,
      message: `Memory updated: ${updatedKeys.join(', ')}`
    });

  } catch (error) {
    logger.error('[Memory] Update error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

/**
 * 从对话中提取记忆信息
 */
async function extractMemoryFromConversation(
  userMessage: string,
  aiResponse: string,
  apiUrl: string,
  apiKey: string,
  model: string
): Promise<Record<string, string>> {
  const extracted: Record<string, string> = {};

  // 如果没有配置 API，使用简单的规则提取
  if (!apiUrl || !apiKey) {
    logger.info('[Memory] No API configured, using rule-based extraction');
    return extractMemoryByRules(userMessage, aiResponse);
  }

  // 使用 API 进行智能提取
  try {
    const prompt = `你是一个信息提取助手。请从以下对话中提取关键信息，用于更新用户画像。

## 需要提取的字段
1. writing_progress - 写作整体进度（如果有）
2. completed_chapters - 已完成的章节（如果有）
3. pending_chapters - 待完成的章节（如果有）
4. paper_topic - 论文主题（如果有）
5. target_journal - 目标期刊（如果有）
6. key_findings - 关键发现（如果有）
7. research_method - 研究方法（如果有）

## 对话内容

用户: ${userMessage}

AI: ${aiResponse}

## 输出格式
只返回 JSON 格式，例如：
{
  "writing_progress": "引言撰写中",
  "completed_chapters": "摘要",
  "pending_chapters": "引言、方法、结果、讨论",
  "paper_topic": "气候变化对农业的影响"
}

如果没有相关信息，不要编造，直接省略该字段。`;

    const response = await fetch(apiUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500
      })
    });

    if (response.ok) {
      const data: any = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      
      // 解析 JSON
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          Object.assign(extracted, parsed);
          logger.info('[Memory] AI extraction successful:', Object.keys(parsed));
        }
      } catch (e) {
        logger.warn('[Memory] Failed to parse AI response:', content);
      }
    }
  } catch (e) {
    logger.warn('[Memory] AI extraction failed, falling back to rules:', e);
  }

  // 如果 AI 提取失败或没有配置 API，使用规则提取
  if (Object.keys(extracted).length === 0) {
    return extractMemoryByRules(userMessage, aiResponse);
  }

  return extracted;
}

/**
 * 基于规则的简单记忆提取
 */
function extractMemoryByRules(userMessage: string, aiResponse: string): Record<string, string> {
  const extracted: Record<string, string> = {};
  const combined = (userMessage + ' ' + aiResponse).toLowerCase();

  // 提取写作进度
  if (combined.includes('引言') || combined.includes('introduction')) {
    if (combined.includes('写') || combined.includes('撰写')) {
      extracted.writing_progress = '引言撰写中';
    }
  }

  // 提取已完成章节
  const completedMatch = combined.match(/(已完成|finished|completed)[了]*[：:]?\s*([^\n]+)/i);
  if (completedMatch) {
    extracted.completed_chapters = completedMatch[2].trim();
  }

  // 提取目标期刊
  const journalMatch = combined.match(/(nature|science|cell|ieee|acm|springer|elsevier|wiley)[\s\w]*/i);
  if (journalMatch) {
    extracted.target_journal = journalMatch[0];
  }

  return extracted;
}

/**
 * 加载用户记忆
 */
function loadUserMemory(userId: string): UserMemory {
  const userDir = path.join(uploadDir, userId);
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  
  const memoryFile = path.join(userDir, 'memory.json');
  
  if (fs.existsSync(memoryFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(memoryFile, 'utf-8'));
      return {
        userId,
        entries: data.entries || [],
        conversations: data.conversations || [],
        updatedAt: data.updatedAt || new Date().toISOString()
      };
    } catch (e) {
      logger.warn(`[Memory] Failed to load memory for ${userId}:`, e);
    }
  }
  
  return {
    userId,
    entries: [],
    conversations: [],
    updatedAt: new Date().toISOString()
  };
}

/**
 * 保存用户记忆
 */
function saveUserMemory(userId: string, memory: UserMemory): void {
  const userDir = path.join(uploadDir, userId);
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  
  const memoryFile = path.join(userDir, 'memory.json');
  
  try {
    fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2));
    logger.info(`[Memory] Saved memory for user: ${userId}`);
  } catch (e) {
    logger.error(`[Memory] Failed to save memory for ${userId}:`, e);
  }
}

/**
 * GET /api/memory/:userId
 * 获取用户记忆
 */
router.get('/:userId', (req: Request, res: Response) => {
  const userId = req.params.userId;
  const memory = loadUserMemory(userId);
  res.json({
    success: true,
    memory
  });
});

export default router;
