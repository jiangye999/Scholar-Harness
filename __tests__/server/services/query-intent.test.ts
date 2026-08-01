import { describe, expect, it } from 'vitest';

import {
  buildQueryIntentClassifierPrompt,
  buildQueryIntentPromptBlock,
  classifyQueryIntentFallback,
  parseQueryIntentResponse,
  shouldUseAiQueryIntentClassifier,
} from '../../../src/orchestrator/query-intent';

const fileFollowUpInput = {
  message: '除了这个呢：supporting information',
  history: [
    {
      role: 'user' as const,
      content: '帮我找工作目录里最后修改的 Word 文件。',
    },
    {
      role: 'assistant' as const,
      content: '当前最后修改的 DOCX 文件是：supporting information.docx。',
    },
  ],
  workspaceRoot: 'E:\\research\\configured',
  aiWorkRoot: 'E:\\research\\ai-work',
};

describe('unified query intent classifier', () => {
  it.each([
    '检索 N2O 排放与降水关系的论文，并给我可核验的参考文献。',
    '读取工作目录的 CSV，用 R 做 PCA 图并沿用各处理组配色。',
    '帮我采集极端降雨对农田土壤 N2O 排放影响的文献。',
    '你好，介绍一下这个软件。',
  ])('sends every meaningful query to the semantic classifier first: %s', (message) => {
    const input = { message, workspaceRoot: 'E:\\research\\configured' };
    expect(shouldUseAiQueryIntentClassifier(input)).toBe(true);
  });

  it('uses the semantic classifier only for an unresolved contextual reference', () => {
    const input = {
      message: '这个还是不太对，换成刚才那个。',
      history: [
        { role: 'user' as const, content: '给我两个不同的分析方案。' },
        { role: 'assistant' as const, content: '方案 A 使用分层模型，方案 B 使用稳健回归。' },
      ],
    };
    expect(classifyQueryIntentFallback(input).primaryIntent).toBe('general_chat');
    expect(shouldUseAiQueryIntentClassifier(input)).toBe(true);
  });

  it('keeps semantic review for a correction that refers to prior retrieved evidence', () => {
    const input = {
      message: '我的意思是把对应段落的这句话替换一下，再把你检索到的三篇文献插进去。',
      history: [
        { role: 'assistant' as const, content: '已检索并提供三篇相关文献。' },
      ],
    };
    expect(shouldUseAiQueryIntentClassifier(input)).toBe(true);
  });

  it('authorizes workspace search when the user explicitly pastes a local path', () => {
    const intent = classifyQueryIntentFallback({
      message: '看看这里面的内容',
      history: [],
      workspaceRoot: 'E:\\research\\project',
      explicitParts: [{
        type: 'workspace',
        path: 'E:\\research\\project',
        source: 'message-path',
      }],
    });

    expect(intent.primaryIntent).toBe('workspace_file');
    expect(intent.needsWorkspaceSearch).toBe(true);
    expect(intent.dataSource).toBe('workspace');
  });

  it.each([
    '找一下之前 AI 输出里的相关内容',
    '继续使用刚才生成的结果',
    '检查 ScholarHarness_AI_Workspaces 里面的产物',
  ])('routes authorized AI output reuse through workspace search: %s', (message) => {
    const intent = classifyQueryIntentFallback({
      message,
      workspaceRoot: 'E:\\research\\project',
      aiWorkRoot: 'E:\\research\\project\\ScholarHarness_AI_Workspaces\\Conversation-conv-1',
    });

    expect(intent.primaryIntent).toBe('workspace_file');
    expect(intent.needsWorkspaceSearch).toBe(true);
    expect(intent.needsWebSearch).toBe(false);
    expect(intent.needsLiteratureRetrieval).toBe(false);
    expect(intent.reason).toContain('AI 历史产物');
  });

  it('does not scan a filesystem for an ambiguous related-content request without an authorized workspace', () => {
    const intent = classifyQueryIntentFallback({
      message: '找一下之前 AI 输出里的相关内容',
    });

    expect(intent.primaryIntent).toBe('general_chat');
    expect(intent.needsWorkspaceSearch).toBe(false);
  });

  it('preserves the AI-resolved topic for an authorized workspace reuse request', () => {
    const intent = parseQueryIntentResponse(JSON.stringify({
      primaryIntent: 'workspace_file',
      action: 'search',
      dataSource: 'workspace',
      needsWorkspaceSearch: true,
      needsWebSearch: false,
      needsLiteratureRetrieval: false,
      needsToolExecution: true,
      resolvedQuery: '递归搜索 ScholarHarness_AI_Workspaces 中与 N2O 季节响应有关的既有输出，并优先检查当前会话目录。',
      confidence: 0.96,
      reason: '用户要求复用先前 AI 输出。',
    }), {
      message: '找一下之前 AI 输出里的相关内容',
      workspaceRoot: 'E:\\research\\project',
      aiWorkRoot: 'E:\\research\\project\\ScholarHarness_AI_Workspaces\\Conversation-conv-1',
      history: [{
        role: 'user',
        content: '我们刚才分析的是 N2O 的季节响应。',
      }],
    });

    expect(intent.primaryIntent).toBe('workspace_file');
    expect(intent.needsWorkspaceSearch).toBe(true);
    expect(intent.resolvedQuery).toContain('N2O 季节响应');
  });

  it('resolves an exclusion follow-up as a workspace file search', () => {
    const intent = classifyQueryIntentFallback(fileFollowUpInput);

    expect(intent.primaryIntent).toBe('workspace_file');
    expect(intent.action).toBe('search');
    expect(intent.isContextualFollowUp).toBe(true);
    expect(intent.needsWorkspaceSearch).toBe(true);
    expect(intent.needsWebSearch).toBe(false);
    expect(intent.needsLiteratureRetrieval).toBe(false);
    expect(intent.excludedFiles).toContain('supporting information.docx');
    expect(intent.resolvedQuery).toContain('排除文件：supporting information.docx');
    expect(intent.resolvedQuery).toContain('按实际修改时间降序');
  });

  it('keeps the AI semantic decision instead of replacing it with a local file rule', () => {
    const intent = parseQueryIntentResponse(JSON.stringify({
      primaryIntent: 'literature_retrieval',
      action: 'search',
      dataSource: 'literature',
      isContextualFollowUp: false,
      needsWorkspaceSearch: false,
      needsWebSearch: true,
      needsLiteratureRetrieval: true,
      needsToolExecution: true,
      needsClarification: false,
      resolvedQuery: 'Search literature about supporting information',
      referencedFiles: [],
      excludedFiles: [],
      requestedOutputs: [],
      requestedMethods: [],
      confidence: 0.99,
      reason: 'Contains an English academic phrase.',
    }), fileFollowUpInput);

    expect(intent.primaryIntent).toBe('literature_retrieval');
    expect(intent.needsWorkspaceSearch).toBe(false);
    expect(intent.needsWebSearch).toBe(false);
    expect(intent.needsLiteratureRetrieval).toBe(true);
  });

  it('routes an explicit evidence request to literature retrieval', () => {
    const intent = classifyQueryIntentFallback({
      message: '检索 N2O 排放与降水关系的论文，并给我可核验的参考文献。',
    });

    expect(intent.primaryIntent).toBe('literature_retrieval');
    expect(intent.action).toBe('search');
    expect(intent.needsLiteratureRetrieval).toBe(true);
    expect(intent.needsWorkspaceSearch).toBe(false);
  });

  it('routes new-literature collection to WoS/CNKI instead of the local evidence libraries', () => {
    const intent = classifyQueryIntentFallback({
      message: '帮我采集极端降雨对农田土壤 N2O 排放及氮循环微生物影响的文献',
    });

    expect(intent.primaryIntent).toBe('literature_collection');
    expect(intent.action).toBe('collect');
    expect(intent.dataSource).toBe('external_literature');
    expect(intent.needsLiteratureRetrieval).toBe(false);
    expect(intent.needsToolExecution).toBe(true);
  });

  it.each([
    '从 WoS 检索极端降雨与农田 N2O 排放相关文献',
    '给我去 Web of Science 导出3000篇关于华北平原玉米N2O排放相关的文献',
    '从知网下载500篇农田氮循环相关论文',
    '使用 CNKI 收集农田氮循环微生物研究',
    '批量下载这个主题的论文并加入文献库',
  ])('recognizes an explicit external literature source or collection action: %s', (message) => {
    const intent = classifyQueryIntentFallback({ message });

    expect(intent.primaryIntent).toBe('literature_collection');
    expect(intent.needsLiteratureRetrieval).toBe(false);
  });

  it('does not treat exporting a WoS search expression as a literature collection job', () => {
    const intent = classifyQueryIntentFallback({
      message: '帮我导出 WoS 检索式，不要下载文献',
    });

    expect(intent.primaryIntent).not.toBe('literature_collection');
  });

  it('keeps the AI semantic decision instead of replacing it with a local collection rule', () => {
    const message = '帮我采集极端降雨对农田土壤 N2O 排放及氮循环微生物影响的文献';
    const intent = parseQueryIntentResponse(JSON.stringify({
      primaryIntent: 'literature_retrieval',
      action: 'search',
      dataSource: 'literature',
      needsWorkspaceSearch: false,
      needsWebSearch: false,
      needsLiteratureRetrieval: true,
      needsToolExecution: true,
      resolvedQuery: message,
      confidence: 0.99,
      reason: '需要检索文献。',
    }), { message });

    expect(intent.primaryIntent).toBe('literature_retrieval');
    expect(intent.action).toBe('search');
    expect(intent.needsLiteratureRetrieval).toBe(true);
  });

  it('keeps evidence verification in the local Embedding/PDF Wiki route', () => {
    const intent = classifyQueryIntentFallback({
      message: '在我已有的文献库里找支持“极端降雨促进 N2O 排放”的证据并给出引用',
    });

    expect(intent.primaryIntent).toBe('literature_retrieval');
    expect(intent.needsLiteratureRetrieval).toBe(true);
  });

  it('routes data plotting to the R workflow without inventing a literature task', () => {
    const intent = classifyQueryIntentFallback({
      message: '读取工作目录的 CSV，用 R 做 PCA 图并沿用各处理组配色。',
      workspaceRoot: 'E:\\research\\configured',
    });

    expect(intent.primaryIntent).toBe('r_plot');
    expect(intent.needsWorkspaceSearch).toBe(true);
    expect(intent.needsLiteratureRetrieval).toBe(false);
    expect(intent.secondaryIntents).toContain('workspace_file');
  });

  it.each([
    'Please update preference settings and preview profile.',
    'Format the References section in APA style.',
    'Search the References section for duplicate entries.',
  ])('does not treat English substrings or formatting language as retrieval: %s', (message) => {
    const intent = classifyQueryIntentFallback({ message });

    expect(intent.needsWorkspaceSearch).toBe(false);
    expect(intent.needsWebSearch).toBe(false);
    expect(intent.needsLiteratureRetrieval).toBe(false);
  });

  it.each([
    ['Explain what Figure 1 shows.', 'r_plot'],
    ['Generate a Figure 1 caption.', 'r_plot'],
    ['What is regression?', 'data_analysis'],
  ])('requires an action-object pair before selecting a specialized workflow: %s', (message, rejectedIntent) => {
    const intent = classifyQueryIntentFallback({ message });

    expect(intent.primaryIntent).not.toBe(rejectedIntent);
    expect(intent.needsToolExecution).toBe(false);
  });

  it('does not interpret manuscript writing as an implicit workspace scan', () => {
    const intent = classifyQueryIntentFallback({
      message: 'Write a manuscript about greenhouse-gas mitigation.',
    });

    expect(intent.primaryIntent).toBe('academic_writing');
    expect(intent.needsWorkspaceSearch).toBe(false);
    expect(intent.needsLiteratureRetrieval).toBe(false);
  });

  it.each([
    '请撰写论文引言，说明降水格局变化对农田 N2O 排放的影响。',
    'Write the Discussion section and compare our findings with previous studies.',
    '扩写文献综述中的研究现状与理论框架。',
  ])('requires local literature retrieval for citation-heavy section writing: %s', (message) => {
    const intent = classifyQueryIntentFallback({ message });

    expect(intent.primaryIntent).toBe('academic_writing');
    expect(intent.needsLiteratureRetrieval).toBe(true);
    expect(intent.needsToolExecution).toBe(true);
    expect(intent.secondaryIntents).toContain('literature_retrieval');
  });

  it('inherits citation-heavy retrieval for a contextual writing follow-up', () => {
    const intent = classifyQueryIntentFallback({
      message: '继续写下一段。',
      history: [
        { role: 'user', content: '请撰写 Discussion，解释处理效应并与已有研究比较。' },
        { role: 'assistant', content: '已完成第一段讨论。' },
      ],
    });

    expect(intent.primaryIntent).toBe('academic_writing');
    expect(intent.needsLiteratureRetrieval).toBe(true);
  });

  it('reuses already retrieved papers for a local correction instead of searching again', () => {
    const message = '我的意思是你给我把对应段落的这句话替换一下，并且把你检索到的三篇文献插进去，你怎么把那一段的内容用这句话替换了？';
    const aiIntent = parseQueryIntentResponse(JSON.stringify({
      primaryIntent: 'academic_writing',
      action: 'edit',
      dataSource: 'conversation',
      needsLiteratureRetrieval: false,
      needsToolExecution: true,
      resolvedQuery: message,
      confidence: 0.98,
    }), {
      message,
      history: [
        { role: 'assistant', content: '已检索并提供三篇相关文献。' },
      ],
    });

    expect(aiIntent.needsLiteratureRetrieval).toBe(false);
    expect(aiIntent.dataSource).toBe('conversation');
  });

  it('reuses the preceding result when the user accepts suggestions and asks to insert citations', () => {
    const message = '接受你的结果和建议，给我把参考文献补充进对应句子后面，以及尾注。';
    const intent = parseQueryIntentResponse(JSON.stringify({
      primaryIntent: 'literature_retrieval',
      action: 'edit',
      dataSource: 'conversation',
      isContextualFollowUp: true,
      literatureEvidenceMode: 'reuse_existing',
      needsLiteratureRetrieval: true,
      needsToolExecution: true,
      resolvedQuery: message,
      confidence: 0.98,
    }), {
      message,
      history: [
        { role: 'assistant', content: '已给出参考文献补充方案和对应句子的修改建议。' },
      ],
    });

    expect(intent.literatureEvidenceMode).toBe('reuse_existing');
    expect(intent.needsLiteratureRetrieval).toBe(false);
    expect(intent.dataSource).toBe('conversation');
  });

  it('does not turn a literature label into search authorization when AI says reuse', () => {
    const intent = parseQueryIntentResponse(JSON.stringify({
      primaryIntent: 'literature_retrieval',
      action: 'edit',
      dataSource: 'conversation',
      needsLiteratureRetrieval: false,
      needsToolExecution: true,
      resolvedQuery: '把刚才找到的文献写入尾注。',
      confidence: 0.95,
    }), {
      message: '把刚才找到的文献写入尾注。',
    });

    expect(intent.needsLiteratureRetrieval).toBe(false);
    expect(intent.literatureEvidenceMode).toBe('reuse_existing');
  });

  it('keeps a fresh retrieval decision made by the contextual AI classifier', () => {
    const message = '先改回原段落，再重新检索三篇文献并插入对应句子。';
    const intent = parseQueryIntentResponse(JSON.stringify({
      primaryIntent: 'academic_writing',
      action: 'edit',
      dataSource: 'mixed',
      needsLiteratureRetrieval: true,
      needsToolExecution: true,
      resolvedQuery: message,
      confidence: 0.97,
    }), { message });

    expect(intent.needsLiteratureRetrieval).toBe(true);
  });

  it.each([
    'Open references.docx',
    'Search workspace for analysis_results.csv',
    'Find the latest file in workspace',
  ])('keeps explicit file operations out of literature and web search: %s', (message) => {
    const intent = classifyQueryIntentFallback({ message });

    expect(intent.primaryIntent).toBe('workspace_file');
    expect(intent.needsWorkspaceSearch).toBe(true);
    expect(intent.needsWebSearch).toBe(false);
    expect(intent.needsLiteratureRetrieval).toBe(false);
  });

  it.each([
    '去掉 code、data、images 子目录，三类文件直接放在 figureX 下',
    '把 code、data、images 里的文件移动到 figure1 到 figure6 根目录，并删除空子目录',
    '不要套子目录，直接放 figureX 下',
    'Flatten the code, data, and images folders into each figure directory.',
  ])('routes directory reorganization requests through workspace tools: %s', (message) => {
    const intent = classifyQueryIntentFallback({ message });

    expect(intent.primaryIntent).toBe('workspace_file');
    expect(intent.needsWorkspaceSearch).toBe(true);
    expect(intent.needsToolExecution).toBe(true);
    expect(intent.needsWebSearch).toBe(false);
    expect(intent.needsLiteratureRetrieval).toBe(false);
  });

  it.each([
    'Search papers about N2O emissions.',
    'Give me references for this claim.',
    '检索相关论文并给出可核验引用。',
  ])('requires both a literature object and an explicit retrieval action: %s', (message) => {
    const intent = classifyQueryIntentFallback({ message });

    expect(intent.primaryIntent).toBe('literature_retrieval');
    expect(intent.needsLiteratureRetrieval).toBe(true);
  });

  it('requires an explicit web request instead of a bare latest/search/find token', () => {
    const intent = classifyQueryIntentFallback({
      message: 'Search the web for the latest N2O policy.',
    });

    expect(intent.needsWebSearch).toBe(true);
    expect(intent.needsToolExecution).toBe(true);
    expect(intent.needsLiteratureRetrieval).toBe(false);
  });

  it('treats a parsed leading literature-search Skill as explicit authorization', () => {
    const intent = classifyQueryIntentFallback({
      message: 'N2O emissions under rainfall treatments',
      explicitParts: [{
        type: 'slash',
        trigger: 'literature-search',
      }],
    });

    expect(intent.primaryIntent).toBe('skill_or_tool');
    expect(intent.needsLiteratureRetrieval).toBe(true);
    expect(intent.needsToolExecution).toBe(true);
  });

  it('trusts the AI literature decision while keeping web access fail-closed', () => {
    const intent = parseQueryIntentResponse(JSON.stringify({
      primaryIntent: 'literature_retrieval',
      action: 'search',
      dataSource: 'literature',
      needsWorkspaceSearch: false,
      needsWebSearch: true,
      needsLiteratureRetrieval: true,
      needsToolExecution: true,
      resolvedQuery: 'Update preference settings',
      confidence: 0.99,
    }), {
      message: 'Please update preference settings.',
    });

    expect(intent.primaryIntent).toBe('literature_retrieval');
    expect(intent.needsWebSearch).toBe(false);
    expect(intent.needsLiteratureRetrieval).toBe(true);
  });

  it('does not locally veto an AI-selected tool workflow', () => {
    const intent = parseQueryIntentResponse(JSON.stringify({
      primaryIntent: 'r_plot',
      action: 'plot',
      dataSource: 'workspace',
      needsWorkspaceSearch: true,
      needsWebSearch: false,
      needsLiteratureRetrieval: false,
      needsToolExecution: true,
      resolvedQuery: 'Explain what Figure 1 shows.',
      confidence: 0.99,
    }), {
      message: 'Explain what Figure 1 shows.',
    });

    expect(intent.primaryIntent).toBe('r_plot');
    expect(intent.needsWorkspaceSearch).toBe(true);
    expect(intent.needsToolExecution).toBe(true);
  });

  it('preserves an AI workspace decision for downstream capability checks', () => {
    const intent = parseQueryIntentResponse(JSON.stringify({
      primaryIntent: 'general_chat',
      action: 'explain',
      dataSource: 'workspace',
      needsWorkspaceSearch: true,
      needsWebSearch: false,
      needsLiteratureRetrieval: false,
      needsToolExecution: true,
      resolvedQuery: 'Preview profile settings.',
      confidence: 0.99,
    }), {
      message: 'Preview profile settings.',
    });

    expect(intent.needsWorkspaceSearch).toBe(true);
  });

  it('gives the AI recent conversation, both roots, and the critical file example', () => {
    const prompt = buildQueryIntentClassifierPrompt(fileFollowUpInput);

    expect(prompt).toContain('<RECENT_CONVERSATION>');
    expect(prompt).toContain('supporting information.docx');
    expect(prompt).toContain('configuredWorkspace: E:\\research\\configured');
    expect(prompt).toContain('currentAiWorkRoot: E:\\research\\ai-work');
    expect(prompt).toContain('不能因为文件名包含英文或论文术语就改判成文献检索');
  });

  it('builds an execution block that preserves exclusions and retrieval gating', () => {
    const block = buildQueryIntentPromptBlock(classifyQueryIntentFallback(fileFollowUpInput));

    expect(block).toContain('"primaryIntent": "workspace_file"');
    expect(block).toContain('"needsWebSearch": false');
    expect(block).toContain('"needsLiteratureRetrieval": false');
    expect(block).toContain('只有正式 Agent 判断当前任务确实需要核对文件时才调用目录工具');
    expect(block).toContain('不得仅因英文术语、论文文件名或历史学术内容而擅自触发文献检索');
  });
});
