import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  buildCodexCapacityAttemptModels,
  buildCodexVerifiedArtifactBlock,
  buildCodexConversationHandoff,
  buildCodexResumePrompt,
  buildPortableAgentResumePrompt,
  buildPortableAgentSessionContext,
  filterChangedCodexSourceArtifacts,
  isCodexDraftWordExportRequest,
  isCodexFileMutationRequest,
  sanitizeCodexFinalAnswer,
} from '../../src/bridge/chat-bridge/chat-bridge';
import type { ChatOptions } from '../../src/types';

describe('Codex visible-conversation handoff', () => {
  const options: ChatOptions = {
    messages: [{ role: 'user', content: '按照方案 A 进行全篇重写' }],
    queryEnvelope: { text: '按照方案 A 进行全篇重写', provider: 'codex' },
    conversationHandoff: [
      { role: 'user', content: '请审核完整论文并给出重写方案。' },
      {
        role: 'assistant',
        content: [
          '方案 A（推荐）：逐段改写。',
          '新段落 1：核心主结论。',
          '新段落 2：WFPS 作为水文开关。',
          '方案 B：只做语言微调。',
        ].join('\n'),
      },
    ],
  };

  it('retries the selected Codex model before cached alternatives', () => {
    expect(buildCodexCapacityAttemptModels('gpt-5.6-sol', [
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
    ])).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]);
  });

  it('carries fallback-generated option definitions into Codex resume prompts', () => {
    const handoff = buildCodexConversationHandoff(options);
    const prompt = buildCodexResumePrompt(options, 'D:\\paper', null, 'workspace-write');

    expect(handoff).toContain('方案 A（推荐）：逐段改写');
    expect(prompt).toContain('WFPS 作为水文开关');
    expect(prompt).toContain('按照方案 A 进行全篇重写');
    expect(prompt).toContain('不要要求用户重复粘贴已经出现的定义');
    expect(prompt).toContain('禁止直接在 PNG/JPG/TIFF 等成品图上');
    expect(prompt).toContain('默认优先相关候选中的最新文件');
  });

  it('does not resend stable catalog or unrelated visible history on an independent resume turn', () => {
    const prompt = buildCodexResumePrompt({
      messages: [{ role: 'user', content: '请解释叶绿素的作用' }],
      queryEnvelope: { text: '请解释叶绿素的作用', provider: 'codex' },
      agentSkillCatalogPrompt: 'VERY LARGE STABLE SKILL CATALOG',
      conversationHandoff: [{ role: 'assistant', content: '旧轮次中的无关长回答' }],
    }, 'D:\\paper', null, 'workspace-write');

    expect(prompt).not.toContain('VERY LARGE STABLE SKILL CATALOG');
    expect(prompt).not.toContain('旧轮次中的无关长回答');
    expect(prompt).toContain('请解释叶绿素的作用');
  });

  it('forces only an unsynchronized cross-Agent delta into an existing native session', () => {
    const forcedOptions: ChatOptions = {
      messages: [{ role: 'user', content: '现在继续整合结果' }],
      queryEnvelope: { text: '现在继续整合结果', provider: 'codex' },
      conversationHandoff: [
        { role: 'assistant', content: 'Pi Agent 新完成了统计结果核查。' },
      ],
      forceConversationHandoff: true,
    };

    const codexPrompt = buildCodexResumePrompt(
      forcedOptions,
      'D:\\paper',
      null,
      'workspace-write',
    );
    const portablePrompt = buildPortableAgentResumePrompt(
      forcedOptions,
      'OpenCode',
      'D:\\paper',
      null,
      'workspace-write',
    );

    expect(codexPrompt).toContain('Pi Agent 新完成了统计结果核查');
    expect(portablePrompt).toContain('Pi Agent 新完成了统计结果核查');
  });

  it('builds a compact portable-runtime delta without the full bootstrap history', () => {
    const prompt = buildPortableAgentResumePrompt({
      messages: [
        { role: 'system', content: 'FULL STABLE SYSTEM BOOTSTRAP' },
        { role: 'assistant', content: 'FULL OLD ASSISTANT HISTORY' },
        { role: 'user', content: '检查新的结果' },
      ],
      queryEnvelope: { text: '检查新的结果', provider: 'codex' },
      agentSkillCatalogPrompt: 'FULL STABLE SKILL CATALOG',
      runtimeContextDelta: {
        writingProgress: '## 写作页面状态变化\n- 当前写作目标：Results',
      },
    }, 'Pi', 'D:\\paper', null, 'workspace-write');

    expect(prompt).toContain('Scholar Harness Pi Session Delta');
    expect(prompt).toContain('检查新的结果');
    expect(prompt).not.toContain('FULL STABLE SYSTEM BOOTSTRAP');
    expect(prompt).not.toContain('FULL OLD ASSISTANT HISTORY');
    expect(prompt).not.toContain('FULL STABLE SKILL CATALOG');
    expect(prompt).toContain('当前写作目标：Results');
    expect(prompt).not.toContain('当前授权工作目录：D:\\paper');
    expect(prompt).not.toContain('<CURRENT_USER_REQUEST_RULES>');
  });

  it('builds stable portable-session context separately from the per-turn request', () => {
    const sessionContext = buildPortableAgentSessionContext({
      messages: [{ role: 'user', content: '继续' }],
      draftContext: {
        articleWritingProgress: {
          available: true,
          completedChapterCount: 2,
          totalChapterCount: 5,
          totalSubsectionCount: 10,
          activeTarget: { chapterKey: 'results', chapterTitle: 'Results' },
        },
      },
    }, 'D:\\paper', 'D:\\paper\\ScholarHarness_AI_Workspaces\\run-1', 'workspace-write');

    expect(sessionContext.workspace).toContain('D:\\paper');
    expect(sessionContext.writingProgress).toContain('当前写作目标：Results');
    expect(sessionContext.writingProgress).not.toContain('继续');
  });

  it('carries the verified file-follow-up intent into an existing Codex thread', () => {
    const prompt = buildCodexResumePrompt({
      messages: [{ role: 'user', content: '除了这个呢：supporting information' }],
      queryEnvelope: {
        text: '除了这个呢：supporting information',
        provider: 'codex',
      },
      draftContext: {
        queryIntent: {
          version: 1,
          source: 'ai',
          primaryIntent: 'workspace_file',
          secondaryIntents: [],
          action: 'search',
          dataSource: 'workspace',
          isContextualFollowUp: true,
          needsWorkspaceSearch: true,
          needsWebSearch: false,
          needsLiteratureRetrieval: false,
          needsToolExecution: true,
          needsClarification: false,
          resolvedQuery: '排除 supporting information.docx 后，按 mtime 查找下一个最新 DOCX。',
          referencedFiles: ['supporting information.docx'],
          excludedFiles: ['supporting information.docx'],
          requestedOutputs: [],
          requestedMethods: [],
          confidence: 0.99,
          reason: '上一轮文件结果的排除式追问。',
          recognizedAt: new Date().toISOString(),
        },
      },
    }, 'D:\\paper', 'D:\\paper\\ScholarHarness_AI_Workspaces\\run-1', 'workspace-write');

    expect(prompt).toContain('## 统一 AI Query 意图（本轮路由）');
    expect(prompt).toContain('primaryIntent: workspace_file');
    expect(prompt).toContain('needsLiteratureRetrieval: false');
    expect(prompt).toContain('excludedFiles: supporting information.docx');
    expect(prompt).toContain('不能改判为文献检索');
  });

  it('clears a thread after any failed Codex run instead of retaining a half-started thread', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../../src/bridge/chat-bridge/chat-bridge.ts'),
      'utf-8',
    );

    expect(source).toContain('clearCodexThreadState(conversationKey);');
    expect(source).toMatch(/catch \(error\) \{\s*clearCodexThreadState\(conversationKey\);/);
    expect(source).not.toMatch(/onThreadId:\s*\(threadId\)[\s\S]{0,160}codexSessionByConversation\.set/);
  });

  it('lets an explicit workspace file target override the active draft chapter on resume', () => {
    const prompt = buildCodexResumePrompt({
      messages: [{ role: 'user', content: '更新这个文件：paper-draft' }],
      queryEnvelope: { text: '更新这个文件：paper-draft', provider: 'codex' },
      draftContext: {
        articleWritingProgress: {
          available: true,
          completedChapterCount: 3,
          totalChapterCount: 5,
          totalSubsectionCount: 12,
          activeTarget: {
            chapterKey: 'discussion',
            chapterTitle: 'Discussion',
          },
        },
      },
    }, 'D:\\paper', 'D:\\paper\\ScholarHarness_AI_Workspaces\\run-1', 'workspace-write');

    expect(prompt).toContain('本轮显式工作目录文件目标');
    expect(prompt).toContain('目标：paper-draft');
    expect(prompt).toContain('该状态仅作内容参考，不能改变写入目标');
    expect(prompt).toContain('不要调用 save_draft');
    expect(prompt).not.toContain('## Scholar Harness 草稿写入协议（本轮请求涉及保存）');
  });

  it('treats a chapter TXT extraction as an application draft save', () => {
    const prompt = buildCodexResumePrompt({
      messages: [{ role: 'user', content: '把摘要里的标题单独拿出来，放到一个 txt 文件里面' }],
      queryEnvelope: { text: '把摘要里的标题单独拿出来，放到一个 txt 文件里面', provider: 'codex' },
    }, 'D:\\paper', 'D:\\paper\\ScholarHarness_AI_Workspaces\\run-1', 'workspace-write');

    expect(prompt).toContain('本轮请求涉及章节 TXT');
    expect(prompt).toContain('最终章节内容必须通过 save_draft 写入应用内部章节库');
  });

  it('removes accidental Codex link-format deliberation from the final answer', () => {
    const cleaned = sanitizeCodexFinalAnswer(
      '标题已提取。\n\n[abstract_title.txt](</mnt/data?>) hmm need proper Windows absolute? Need include exact path.'
    );
    expect(cleaned).toBe('标题已提取。\n\nabstract_title.txt');
    expect(cleaned).not.toContain('Need include');
  });

  it('recognizes canonical draft-to-Word export requests', () => {
    expect(isCodexDraftWordExportRequest('把 title、abstract 和 Results 草稿整合到一个 Word 里面')).toBe(true);
    expect(isCodexDraftWordExportRequest('只帮我审查 Results 草稿')).toBe(false);
    expect(isCodexFileMutationRequest('生成并保存 paper-draft.docx')).toBe(true);
  });

  it('marks only server-verified Codex artifacts for attachment rendering', () => {
    const block = buildCodexVerifiedArtifactBlock([
      'D:\\paper\\ScholarHarness_AI_Workspaces\\run-1\\paper-draft.docx',
    ]);

    expect(block).toContain('[[SH_VERIFIED_ARTIFACTS_BEGIN]]');
    expect(block).toContain('生成/更新文件（已验证）');
    expect(block).toContain('paper-draft.docx');
    expect(block).toContain('[[SH_VERIFIED_ARTIFACTS_END]]');
  });

  it('does not expose page-by-page visual-QA screenshots as verified artifacts', () => {
    const block = buildCodexVerifiedArtifactBlock([
      'D:\\paper\\ScholarHarness_AI_Workspaces\\run-1\\review_v9\\page1.png',
      'D:\\paper\\ScholarHarness_AI_Workspaces\\run-1\\review_v9\\page2.png',
      'D:\\paper\\ScholarHarness_AI_Workspaces\\run-1\\paper_manuscript_revised_v9.docx',
    ]);

    expect(block).toContain('paper_manuscript_revised_v9.docx');
    expect(block).not.toContain('page1.png');
    expect(block).not.toContain('page2.png');
  });

  it('detects overwritten artifacts even when their size and modified time are preserved', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../../src/bridge/chat-bridge/chat-bridge.ts'),
      'utf-8',
    );

    expect(source).toContain('ctimeMs: stat.ctimeMs');
    expect(source).toContain('previous.ctimeMs !== current.ctimeMs');
  });

  it('verifies a changed source-workspace file when Codex reports only its bare file name', () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'scholar-harness-artifact-'));
    const artifactPath = path.join(workspaceRoot, 'paper_manuscript_revised_v7.docx');
    const unrelatedPath = path.join(workspaceRoot, 'unrelated.docx');
    writeFileSync(artifactPath, 'verified artifact');
    writeFileSync(unrelatedPath, 'unrelated');

    try {
      const verified = filterChangedCodexSourceArtifacts(
        [artifactPath, unrelatedPath],
        workspaceRoot,
        '文件链接：\n- paper_manuscript_revised_v7.docx',
      );

      expect(verified).toEqual([artifactPath]);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
