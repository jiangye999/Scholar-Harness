import { Router } from 'express';
import { NiceAIGCBridgeAdapter } from '../../bridge/niceaigc/niceaigc-bridge';
import { logger } from '../../utils/logger';

const router = Router();

let niceAIGCAdapter: NiceAIGCBridgeAdapter | null = null;

export function initializeNiceAIGCRoutes(adapter: NiceAIGCBridgeAdapter): void {
  niceAIGCAdapter = adapter;
}

router.post('/chat', async (req, res) => {
  try {
    if (!niceAIGCAdapter) {
      res.status(503).json({ error: 'NiceAIGC Bridge not initialized' });
      return;
    }

    const { message, context = {}, options = {} } = req.body;

    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    logger.info(`[NiceAIGC Route] Received chat request with context`);

    // 构建增强的消息内容（包含所有上下文）
    const enrichedMessage = buildEnrichedMessage(message, context);

    const response = await niceAIGCAdapter.chat({
      messages: [{ role: 'user', content: enrichedMessage }],
      ...options,
    });

    res.json({
      success: true,
      response,
      provider: 'niceaigc',
    });
  } catch (error) {
    logger.error('[NiceAIGC Route] Error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * 构建增强消息（包含所有上下文）
 * 与 API Flow 保持一致
 */
function buildEnrichedMessage(message: string, context: any): string {
  let enrichedPrompt = '';

  // 1. 系统提示词（完整版）
  if (context.systemPrompt) {
    enrichedPrompt += `${context.systemPrompt}\n\n`;
  } else {
    // 默认系统提示词
    enrichedPrompt += `你是一个专业的学术论文写作助手。\n\n`;
  }

  // 2. 用户自定义灵魂（soulContent）
  if (context.soulContent) {
    enrichedPrompt += `## 👤 用户自定义设定\n${context.soulContent}\n\n`;
  }

  // 3. 写作任务类型
  if (context.taskType) {
    enrichedPrompt += `## 🎯 写作任务\n${context.taskType}\n\n`;
  }

  // 4. 写作进度
  if (context.memory?.writingProgress) {
    enrichedPrompt += `## 📝 当前写作进度\n${context.memory.writingProgress}\n\n`;
  }

  // 5. 已完成章节
  if (context.memory?.completedChapters) {
    enrichedPrompt += `## ✅ 已完成章节\n${context.memory.completedChapters}\n\n`;
  }

  // 6. 待完成章节
  if (context.memory?.pendingChapters) {
    enrichedPrompt += `## 📋 待完成章节\n${context.memory.pendingChapters}\n\n`;
  }

  // 7. 跨会话长久记忆
  if (context.memory?.conversations && context.memory.conversations.length > 0) {
    enrichedPrompt += `## 🧠 跨会话长久记忆\n`;
    enrichedPrompt += `系统已记录您之前分享的信息：\n`;
    for (const entry of context.memory.conversations.slice(-5)) {
      enrichedPrompt += `- **${entry.title}**: ${entry.summary?.substring(0, 100) || '无摘要'}...\n`;
    }
    enrichedPrompt += '\n';
  }

  // 8. 历史记忆（其他）
  if (context.memory?.other && context.memory.other.length > 0) {
    enrichedPrompt += `## 🧠 历史记忆\n`;
    for (const entry of context.memory.other.slice(-5)) {
      if (entry.key && entry.value) {
        enrichedPrompt += `- **${entry.key}**: ${entry.value}\n`;
      }
    }
    enrichedPrompt += '\n';
  }

  // 9. 写作技能指导（重要！）
  if (context.writingSkill) {
    enrichedPrompt += `## ✨ SCI写作技能指导\n`;
    enrichedPrompt += `系统已自动加载 **${context.writingSkill.chapter}** 章节的写作技能指南。\n`;
    enrichedPrompt += `请严格按照以下技能要求指导用户写作：\n\n`;
    enrichedPrompt += `${context.writingSkill.content}\n\n---\n\n`;
  }

  // 10. 文献上下文
  if (context.literature) {
    enrichedPrompt += `## 📚 相关文献 (${context.literature.count || 0}篇)\n`;
    if (context.literature.summary) {
      enrichedPrompt += `${context.literature.summary}\n`;
    }
    if (context.literature.recent && context.literature.recent.length > 0) {
      for (let i = 0; i < context.literature.recent.length; i++) {
        const paper = context.literature.recent[i];
        enrichedPrompt += `[${i + 1}] ${paper.title || 'Unknown Title'}`;
        if (paper.authors) enrichedPrompt += ` - ${paper.authors}`;
        if (paper.year) enrichedPrompt += ` (${paper.year})`;
        if (paper.journal) enrichedPrompt += `, ${paper.journal}`;
        if (paper.abstract) enrichedPrompt += `\n    ${paper.abstract.substring(0, 200)}...`;
        enrichedPrompt += '\n';
      }
    }
    enrichedPrompt += '\n';
  }

  // 11. 代码自动检索的参考文献
  if (context.relevantLiterature) {
    enrichedPrompt += `## 🔍 代码自动检索的参考文献\n`;
    enrichedPrompt += `系统已从您的文献库中检索出最相关的文献：\n`;
    enrichedPrompt += `${context.relevantLiterature}\n\n`;
  }

  // 12. 期刊风格要求（详细版）
  if (context.journalStyle) {
    enrichedPrompt += `## 📝 目标期刊风格指南\n`;
    if (typeof context.journalStyle === 'object') {
      if (context.journalStyle.papers) {
        enrichedPrompt += `已分析 ${context.journalStyle.papers.length} 篇论文的写作风格。\n\n`;
        for (let i = 0; i < Math.min(context.journalStyle.papers.length, 2); i++) {
          const paper = context.journalStyle.papers[i];
          enrichedPrompt += `### 文献 ${i + 1}: ${paper.paper_title || 'Unknown'}\n`;
          enrichedPrompt += `期刊：${paper.journal || 'Unknown'}, 年份：${paper.year || 'Unknown'}\n`;
          if (paper.overall_style) {
            enrichedPrompt += `风格：${paper.overall_style.formality || ''}, 语气：${paper.overall_style.argument_tone || ''}\n`;
          }
          if (paper.transferable_rules && paper.transferable_rules.length > 0) {
            enrichedPrompt += `规则：${paper.transferable_rules.slice(0, 3).join('; ')}\n`;
          }
          enrichedPrompt += '\n';
        }
      } else {
        for (const [key, value] of Object.entries(context.journalStyle)) {
          enrichedPrompt += `- ${key}: ${value}\n`;
        }
      }
    } else {
      enrichedPrompt += `${context.journalStyle}\n`;
    }
    enrichedPrompt += '\n**你需要参考上述目标期刊的写作风格来撰写内容。**\n\n';
  }

  // 13. 联网搜索结果
  if (context.webSearchContext) {
    enrichedPrompt += `## 🌐 联网搜索结果\n`;
    enrichedPrompt += `${context.webSearchContext}\n\n`;
  }

  // 14. 回答要求
  enrichedPrompt += `## ⚠️ 重要要求\n`;
  enrichedPrompt += `1. **文献引用**：必须使用 "(作者，年份)" 格式，如 "(Wang et al., 2023)"\n`;
  enrichedPrompt += `2. **参考文献**：严格使用【代码自动检索的参考文献】中提供的格式\n`;
  enrichedPrompt += `3. **期刊风格**：遵循上述目标期刊的写作风格\n`;
  enrichedPrompt += `4. **专业表达**：使用学术英语，结构清晰，逻辑严密\n`;
  enrichedPrompt += `5. **禁止编造**：严禁编造不存在的文献或细节\n\n`;

  // 15. 论文草稿功能说明
  enrichedPrompt += `## 📝 论文草稿功能\n`;
  enrichedPrompt += `当用户要求"保存到草稿"时，请在回复最后包含以下格式的触发指令：\n`;
  enrichedPrompt += '\`\`\`\n';
  enrichedPrompt += '🔧 调用工具：save_draft\n';
  enrichedPrompt += 'content: |\n';
  enrichedPrompt += '[LaTeX格式的内容]\n';
  enrichedPrompt += 'section: [章节名，如 introduction, methods]\n';
  enrichedPrompt += '\`\`\`\n\n';

  // 16. 用户请求
  enrichedPrompt += `## 💬 用户请求\n${message}`;

  return enrichedPrompt;
}

router.get('/test', async (req, res) => {
  try {
    if (!niceAIGCAdapter) {
      res.status(503).json({ error: 'NiceAIGC Bridge not initialized' });
      return;
    }

    const connected = await niceAIGCAdapter.testConnection();

    if (connected) {
      res.json({
        success: true,
        message: 'NiceAIGC connection successful',
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'NiceAIGC connection failed',
      });
    }
  } catch (error) {
    logger.error('[NiceAIGC Route] Test error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

export default router;
