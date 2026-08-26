import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  executeAgentDraftSaveTool,
  getAgentDraftSaveToolDefinitions,
  hasVerifiedDraftSaveReceipt,
  initializeChatBridgeRoutes,
  isAgentDraftSaveToolName,
  shouldSyncWorkspaceDraftFiles,
} from '../../../src/server/routes/chat-bridge';

describe('ChatBridge native draft tool', () => {
  afterEach(() => {
    initializeChatBridgeRoutes({} as any);
  });

  it('writes a canonical chapter through the configured draft service', async () => {
    const saveDraft = vi.fn(async () => undefined);
    const getDraftContext = vi.fn(async () => ({
      available: true,
      exportContent: '\\section{Discussion}\nCurrent complete draft.',
    }));
    initializeChatBridgeRoutes({} as any, { saveDraft, getDraftContext });

    expect(getAgentDraftSaveToolDefinitions().map(tool => tool.function.name)).toContain('save_draft');
    const result = await executeAgentDraftSaveTool({
      id: 'draft-call-1',
      type: 'function',
      function: {
        name: 'save_draft',
        arguments: JSON.stringify({
          content: '## Discussion\nThe observed response may be attributed to soil moisture.',
          section: 'discussion',
          references: '(Zhang et al., 2026) Zhang, A. (2026). Example.',
          mode: 'replace',
        }),
      },
    }, 'user-1', '把这段保存到 Discussion 草稿', {
      articleDraftChapterRegistry: {
        chapters: [{ key: 'discussion', title: 'Discussion', exists: true }],
      },
      articleWritingProgress: {
        activeTarget: {
          chapterKey: 'discussion',
          chapterTitle: 'Discussion',
          chapterId: 'chapter-discussion',
          subsectionId: 'sub-mechanism',
          subsectionTitle: 'Moisture mechanism',
          subsectionIndex: 2,
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      draftExportContent: '\\section{Discussion}\nCurrent complete draft.',
      data: {
        chapter: 'discussion',
        fileName: 'discussion.txt',
        mode: 'replace',
      },
    });
    expect(saveDraft).toHaveBeenCalledWith(
      'user-1',
      'discussion',
      expect.stringContaining('\\section*{References}'),
      expect.objectContaining({
        mode: 'replace',
        subsection: expect.objectContaining({ title: 'Moisture mechanism' }),
      }),
    );
    expect(getDraftContext).toHaveBeenCalledWith('user-1', '把这段保存到 Discussion 草稿');
  });

  it('ignores a model-declared Results target when the page target is Discussion', async () => {
    const saveDraft = vi.fn(async () => undefined);
    initializeChatBridgeRoutes({} as any, { saveDraft });

    const result = await executeAgentDraftSaveTool({
      id: 'draft-call-2',
      type: 'function',
      function: {
        name: 'save_draft',
        arguments: JSON.stringify({
          content: 'This paragraph interprets the observed treatment response.',
          section: 'results',
        }),
      },
    }, 'user-1', '保存这一段', {
      articleDraftChapterRegistry: {
        chapters: [
          { key: 'results', title: 'Results', exists: true },
          { key: 'discussion', title: 'Discussion', exists: true },
        ],
      },
      articleWritingProgress: {
        activeTarget: {
          chapterKey: 'discussion',
          chapterTitle: 'Discussion',
          subsectionId: 'sub-1',
          subsectionTitle: 'Mechanistic interpretation',
          subsectionIndex: 1,
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(saveDraft).toHaveBeenCalledWith(
      'user-1',
      'discussion',
      expect.any(String),
      expect.objectContaining({ subsection: expect.objectContaining({ title: 'Mechanistic interpretation' }) }),
    );
    expect(saveDraft).not.toHaveBeenCalledWith('user-1', 'results', expect.anything(), expect.anything());
  });

  it('automatically creates a classified chapter when the page has no manual lock', async () => {
    const saveDraft = vi.fn(async () => undefined);
    initializeChatBridgeRoutes({} as any, { saveDraft });

    const result = await executeAgentDraftSaveTool({
      id: 'draft-call-3',
      type: 'function',
      function: {
        name: 'save_draft',
        arguments: JSON.stringify({
          content: 'This mechanism may explain the observed response and is consistent with previous studies.',
          section: 'discussion',
          section_confidence: 0.92,
        }),
      },
    }, 'user-1', '把这段保存到草稿', {
      articleDraftChapterRegistry: { chapters: [] },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        chapter: 'discussion',
        createdChapter: true,
      },
    });
    expect(saveDraft).toHaveBeenCalledWith(
      'user-1',
      'discussion',
      expect.any(String),
      expect.objectContaining({ mode: 'merge' }),
    );
  });

  it('refuses an ambiguous save when neither the query nor the tool identifies a chapter', async () => {
    const saveDraft = vi.fn(async () => undefined);
    initializeChatBridgeRoutes({} as any, { saveDraft });

    const result = await executeAgentDraftSaveTool({
      id: 'draft-call-4',
      type: 'function',
      function: { name: 'save_draft', arguments: JSON.stringify({ content: 'Draft paragraph.' }) },
    }, 'user-1', '保存', {});

    expect(result.ok).toBe(false);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('blocks正文 saving until the current project framework is confirmed by the user', async () => {
    const saveDraft = vi.fn(async () => undefined);
    initializeChatBridgeRoutes({} as any, { saveDraft });

    const result = await executeAgentDraftSaveTool({
      id: 'draft-call-unconfirmed-framework',
      type: 'function',
      function: {
        name: 'save_draft',
        arguments: JSON.stringify({ content: 'Draft paragraph.', section: 'discussion' }),
      },
    }, 'user-1', '开始写 Discussion', {
      discussionFramework: {
        available: true,
        planningStatus: 'draft',
        chapters: [{ key: 'discussion', title: 'Discussion' }],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toBe('论文正文尚未保存');
    expect(result.error).toContain('当前项目既没有确认论文框架');
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('does not redirect an explicit workspace file update into the active chapter draft', async () => {
    const saveDraft = vi.fn(async () => undefined);
    initializeChatBridgeRoutes({} as any, { saveDraft });

    const result = await executeAgentDraftSaveTool({
      id: 'draft-call-explicit-file',
      type: 'function',
      function: {
        name: 'save_draft',
        arguments: JSON.stringify({
          content: '## Discussion\nUpdated discussion content.',
          section: 'discussion',
          mode: 'replace',
        }),
      },
    }, 'user-1', '更新这个文件：paper-draft', {
      articleWritingProgress: {
        activeTarget: {
          chapterKey: 'discussion',
          chapterTitle: 'Discussion',
        },
      },
      explicitWorkspaceFileWriteIntent: {
        target: 'paper-draft',
        operation: 'write',
      },
    });

    expect(result).toMatchObject({
      ok: false,
      summary: '未写入章节草稿',
    });
    expect(result.error).toContain('paper-draft');
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('creates a new top-level chapter chosen from the current writing requirements', async () => {
    const saveDraft = vi.fn(async () => undefined);
    initializeChatBridgeRoutes({} as any, { saveDraft });

    const tool = getAgentDraftSaveToolDefinitions()[0];
    const sectionSchema = tool.function.parameters.properties.section as Record<string, unknown>;
    expect(sectionSchema.enum).toBeUndefined();

    const result = await executeAgentDraftSaveTool({
      id: 'draft-call-dynamic-chapter',
      type: 'function',
      function: {
        name: 'save_draft',
        arguments: JSON.stringify({
          content: 'These findings have direct implications for adaptive nitrogen management.',
          section: 'implications',
          section_title: 'Implications',
          section_confidence: 0.96,
          mode: 'replace',
        }),
      },
    }, 'user-1', '根据当前写作要求新建 Implications 章节并保存', {
      articleDraftChapterRegistry: {
        chapters: [{ key: 'discussion', title: 'Discussion', exists: true }],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        chapter: 'implications',
        title: 'Implications',
        createdChapter: true,
        targetSource: 'dynamic-created',
      },
    });
    expect(saveDraft).toHaveBeenCalledWith(
      'user-1',
      'implications',
      expect.any(String),
      expect.objectContaining({ mode: 'replace' }),
    );
  });

  it('recognizes newly-created chapter receipts as verified saves', () => {
    initializeChatBridgeRoutes({} as any, { saveDraft: vi.fn(async () => undefined) });
    const receipt = '✅ 已创建并保存到 Conclusion 草稿 conclusion.txt（自动识别，置信度 99%）。';
    expect(hasVerifiedDraftSaveReceipt(receipt)).toBe(true);
    expect(shouldSyncWorkspaceDraftFiles('保存到结论部分的txt', receipt, {
      workspaceDirectory: { available: true },
    })).toBe(false);
  });

  it('does not treat paper-framework confirmations as chapter draft saves', () => {
    initializeChatBridgeRoutes({} as any, { saveDraft: vi.fn(async () => undefined) });
    const context = { workspaceDirectory: { available: true } };

    expect(shouldSyncWorkspaceDraftFiles(
      '请更新右侧论文的章节框架，先让我确认',
      '已保存并同步章节框架，等待你在右侧确认。',
      context,
    )).toBe(false);
    expect(shouldSyncWorkspaceDraftFiles(
      '把这段正文保存到 Discussion 草稿',
      '已保存 Discussion 章节。',
      context,
    )).toBe(true);
  });

  it('does not expose the tool when the draft service is unavailable', () => {
    initializeChatBridgeRoutes({} as any);
    expect(getAgentDraftSaveToolDefinitions()).toEqual([]);
  });

  it('recognizes exact and provider-namespaced save_draft calls', () => {
    expect(isAgentDraftSaveToolName('save_draft')).toBe(true);
    expect(isAgentDraftSaveToolName('scholar_harness.save_draft')).toBe(true);
    expect(isAgentDraftSaveToolName('scholar_harness__save_draft')).toBe(true);
    expect(isAgentDraftSaveToolName('save_file')).toBe(false);
  });
});
