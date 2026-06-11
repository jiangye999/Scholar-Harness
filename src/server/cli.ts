// 仅在开发环境加载 .env 文件
if (process.env.NODE_ENV !== 'production' && !process.env.ELECTRON_RUN_AS_NODE) {
  try {
    require('dotenv/config');
  } catch (e) {
    // dotenv 模块不存在时忽略
  }
}
import readline from 'readline';
import { ConversationFlow } from '../../workflows/conversation-flow';
import { HybridRetrievalEngine } from '../literature/retrieval';
import { logger } from '../utils/logger';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const userId = 'cli-user-' + Date.now();

const retrievalEngine = new HybridRetrievalEngine({}, { 
  url: process.env.API_URL, 
  key: process.env.API_KEY 
});

const conversationFlow = new ConversationFlow({
  send: async (userId: string, message: string) => {
    console.log(`\n🤖 ${message}\n`);
  }
}, undefined, undefined, retrievalEngine);

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  console.clear();
  console.log('========================================');
  console.log('  ScholarClaw CLI - 对话式论文写作助手');
  console.log('========================================');
  console.log('');
  console.log('开始你的论文写作之旅！');
  console.log('');

  while (true) {
    const session = await conversationFlow.getSession(userId);
    const message = await ask('👤 你: ');

    if (!message.trim()) continue;

    console.log('\n🤖 正在思考...');

    try {
      const response = await conversationFlow.processMessage(userId, message);
      console.log(`\n🤖 ScholarClaw: ${response}\n`);
      console.log(`[阶段: ${session.phase}]`);
      console.log('');

      if (session.phase === 'complete') {
        console.log('恭喜！论文写作流程已完成！');
        console.log('输入 "quit" 退出');
      }
    } catch (error) {
      console.error('错误:', error);
    }

    if (message.toLowerCase() === 'quit' || message.toLowerCase() === 'exit') {
      console.log('再见！');
      rl.close();
      process.exit(0);
    }
  }
}

main().catch(console.error);
