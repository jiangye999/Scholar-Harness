import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

import type { LLMToolCall } from '../../src/utils/llm-client';

import {
  compactToolLoopMessagesOverBudget,
  constrainCurrentTitleLookupToolCalls,
  executeAgentImageAnalysisToolCall,
  executeAgentImageBatchAnalysisToolCall,
  filterUtilityAgentToolsByIntent,
  filterWorkspaceToolsByIntent,
  getAgentImageAnalysisToolDefinition,
  getAgentImageBatchAnalysisToolDefinition,
  hasPromptContentInHistory,
  isAgentCapabilityInventoryRequest,
  isAgentPageContextLookupRequest,
  isCodeDefinedVisualPropertyQuestion,
  shouldSkipInitialAgentPlan,
  isImageInspectionCall,
  isLikelyDiagnosticMeasurementScript,
  isLikelyTemporaryTestFile,
  isScriptedImageInspectionCommand,
  parseFileResourceSummaryLines,
  resolveEffectiveHardToolCycleLimit,
  shouldCountToolFailureForDisable,
  truncateToolResultText,
} from '../../src/server/routes/chat-bridge';

function assistantWithCalls(names: string[]): { role: string; content: string; tool_calls: Array<{ function: { name: string } }> } {
  return {
    role: 'assistant',
    content: 'thinking',
    tool_calls: names.map(name => ({ function: { name } })),
  };
}

function toolMessage(name: string, body: string): { role: string; tool_call_id: string; name: string; content: string } {
  return { role: 'tool', tool_call_id: 'id-' + name, name, content: body };
}

function buildLongToolLoop(): Array<{ role: string; content?: unknown; tool_calls?: unknown[] }> {
  const big = 'z'.repeat(30_000);
  const round = (name: string, body: string) => [assistantWithCalls([name]), toolMessage(name, body)];
  return [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'task' },
    ...round('file_search', big),
    ...round('read_file', big),
    ...round('write_file', big),
    ...round('move_file', big),
    ...round('grep_files', 'needle'),
    ...round('list_dir', 'dir'),
  ];
}

describe('truncateToolResultText (P0-1)', () => {
  it('keeps short tool results unchanged', () => {
    expect(truncateToolResultText('ok')).toBe('ok');
    const body = 'x'.repeat(11_999);
    expect(truncateToolResultText(body)).toBe(body);
  });

  it('truncates oversized results and adds a truncation marker', () => {
    const body = 'y'.repeat(30_000);
    const result = truncateToolResultText(body);
    expect(result.length).toBeLessThan(body.length);
    expect(result).toContain('<tool result truncated:');
    expect(result.startsWith('y'.repeat(12_000))).toBe(true);
  });

  it('handles non-string input', () => {
    expect(truncateToolResultText(undefined as unknown as string)).toBe('');
    expect(truncateToolResultText(null as unknown as string)).toBe('');
  });
});

describe('compactToolLoopMessagesOverBudget (P0-1)', () => {
  it('leaves messages untouched below the budget', async () => {
    const messages: Array<{ role: string; content?: unknown; tool_calls?: unknown[] }> = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      assistantWithCalls(['file_search']),
      toolMessage('file_search', 'hit'),
    ];
    await compactToolLoopMessagesOverBudget(messages);
    expect(messages.length).toBe(4);
    expect(messages[2].role).toBe('assistant');
  });

  it('folds the oldest rounds into a compact summary, keeping the recent ~20k tokens', async () => {
    const messages = buildLongToolLoop();

    await compactToolLoopMessagesOverBudget(messages);

    // The oldest round (file_search) collapsed into one user summary; the rest stay intact.
    const compact = messages.find(message => message.role === 'user' && String(message.content).includes('TOOL_LOOP_COMPACT'));
    expect(compact).toBeDefined();
    const compactText = String(compact && compact.content);
    expect(compactText).toContain('file_search');
    const keptNames = messages
      .filter(message => message.role === 'assistant' && Array.isArray(message.tool_calls))
      .flatMap(message => (message.tool_calls as Array<{ function: { name: string } }>).map(call => call.function.name));
    expect(keptNames).toContain('list_dir');
    expect(keptNames).toContain('grep_files');
    expect(keptNames).not.toContain('file_search');
  });

  it('is idempotent: a second pass does not double-fold', async () => {
    const messages = buildLongToolLoop();
    await compactToolLoopMessagesOverBudget(messages);
    const afterFirst = messages.map(message => JSON.stringify(message)).join('\n');
    await compactToolLoopMessagesOverBudget(messages);
    expect(messages.map(message => JSON.stringify(message)).join('\n')).toBe(afterFirst);
  });
});

describe('hasPromptContentInHistory (P0-2)', () => {
  const fullSkill = '这是完整 Skill 指令内容。'.repeat(200);

  it('detects a full skill body already present in history', () => {
    const history = [
      { role: 'user', content: '某轮消息' },
      { role: 'assistant', content: fullSkill },
    ];
    expect(hasPromptContentInHistory(history, fullSkill)).toBe(true);
  });

  it('detects the fingerprint even when history was truncated by budget', () => {
    const truncated = fullSkill.slice(0, 1_800);
    expect(hasPromptContentInHistory([{ role: 'user', content: truncated }], fullSkill)).toBe(true);
  });

  it('returns false when the skill body is new to the conversation', () => {
    expect(hasPromptContentInHistory([{ role: 'user', content: '无关内容' }], fullSkill)).toBe(false);
    expect(hasPromptContentInHistory(undefined, fullSkill)).toBe(false);
  });

  it('treats empty content as already present (nothing to inject)', () => {
    expect(hasPromptContentInHistory([], '   ')).toBe(true);
  });
});

describe('shouldSkipInitialAgentPlan', () => {
  const base = {
    codexProvider: false,
    piSessionActive: false,
    workspaceConfigured: false,
    requiresVision: false,
    invokedUserSkills: [],
    chatAttachments: [],
  };

  it('lets a plain chat turn skip plan ceremony without disabling tools', () => {
    expect(shouldSkipInitialAgentPlan({
      ...base,
      queryIntent: { needsToolExecution: false, needsWorkspaceSearch: false, needsLiteratureRetrieval: false },
    })).toBe(true);
  });

  it('keeps Harness tools for capability inventory questions while plain greetings stay tool-free', () => {
    const noToolsIntent = { needsToolExecution: false, needsWorkspaceSearch: false, needsLiteratureRetrieval: false };
    expect(isAgentCapabilityInventoryRequest('你现在有哪些 Skill、插件和 MCP？')).toBe(true);
    expect(shouldSkipInitialAgentPlan({
      ...base,
      userMessage: '你现在有哪些 Skill、插件和 MCP？',
      queryIntent: noToolsIntent,
    })).toBe(false);
    expect(isAgentCapabilityInventoryRequest('你好')).toBe(false);
    expect(shouldSkipInitialAgentPlan({ ...base, userMessage: '你好', queryIntent: noToolsIntent })).toBe(true);
  });

  it('keeps page-context tools for short current-project lookup questions', () => {
    const noToolsIntent = { needsToolExecution: false, needsWorkspaceSearch: false, needsLiteratureRetrieval: false };
    expect(isAgentPageContextLookupRequest('现在的标题是什么')).toBe(true);
    expect(isAgentPageContextLookupRequest('当前项目的写作进度到哪了？')).toBe(true);
    expect(isAgentPageContextLookupRequest('什么是论文标题？')).toBe(false);
    expect(isAgentPageContextLookupRequest('论文标题如何写？')).toBe(false);
    expect(shouldSkipInitialAgentPlan({
      ...base,
      userMessage: '现在的标题是什么',
      queryIntent: noToolsIntent,
    })).toBe(false);
  });

  it('uses one authoritative page resource before broad scans for a current-title lookup', () => {
    const call = (name: string, args: Record<string, unknown>, id: string): LLMToolCall => ({
      id,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    });
    const requested = [
      call('read_page_context', { resourceId: 'discussion-framework', detailLevel: 'full' }, 'framework'),
      call('read_file', { paths: ['drafts/title.txt'] }, 'file'),
      call('file_search', { query: 'title' }, 'search'),
      call('read_page_context', { resourceId: 'ordinary-draft', detailLevel: 'full' }, 'draft'),
      call('read_page_context', { resourceId: 'memory', detailLevel: 'full' }, 'memory'),
    ];

    expect(constrainCurrentTitleLookupToolCalls(requested, '帮我查看当前论文的标题')).toEqual([requested[3]]);
    expect(constrainCurrentTitleLookupToolCalls(requested, '帮我修改当前论文的标题')).toEqual(requested);
  });

  it('lets a plain chat turn skip plan ceremony even when a workspace is configured', () => {
    // A configured workspace is a capability, not a reason to force the loop.
    expect(shouldSkipInitialAgentPlan({
      ...base,
      workspaceConfigured: true,
      queryIntent: { needsToolExecution: false, needsWorkspaceSearch: false, needsLiteratureRetrieval: false },
    })).toBe(true);
  });

  it('keeps the tool loop when the intent needs tools', () => {
    expect(shouldSkipInitialAgentPlan({
      ...base,
      queryIntent: { needsToolExecution: true, needsWorkspaceSearch: false, needsLiteratureRetrieval: false },
    })).toBe(false);
  });

  it('does not let the pi run identity alone force the tool loop', () => {
    const needsToolsIntent = { needsToolExecution: false, needsWorkspaceSearch: false, needsLiteratureRetrieval: false };
    expect(shouldSkipInitialAgentPlan({ ...base, piSessionActive: true, queryIntent: needsToolsIntent })).toBe(true);
  });

  it('keeps the tool loop on actual capability signals', () => {
    const needsToolsIntent = { needsToolExecution: false, needsWorkspaceSearch: false, needsLiteratureRetrieval: false };
    expect(shouldSkipInitialAgentPlan({ ...base, requiresVision: true, queryIntent: needsToolsIntent })).toBe(false);
    expect(shouldSkipInitialAgentPlan({ ...base, invokedUserSkills: ['a'], queryIntent: needsToolsIntent })).toBe(false);
    expect(shouldSkipInitialAgentPlan({ ...base, chatAttachments: ['a'], queryIntent: needsToolsIntent })).toBe(false);
    expect(shouldSkipInitialAgentPlan({ ...base, queryIntent: { needsToolExecution: false, needsWorkspaceSearch: true, needsLiteratureRetrieval: false } })).toBe(false);
    expect(shouldSkipInitialAgentPlan({ ...base, queryIntent: { needsToolExecution: false, needsWorkspaceSearch: false, needsLiteratureRetrieval: true } })).toBe(false);
  });

  it('lets Coding Agent runtimes skip Scholar Harness tools for an explicit tool-free turn', () => {
    expect(shouldSkipInitialAgentPlan({
      ...base,
      codexProvider: true,
      queryIntent: { needsToolExecution: false, needsWorkspaceSearch: false, needsLiteratureRetrieval: false },
    })).toBe(true);
  });

  it('keeps the tool loop when the intent is missing (conservative)', () => {
    expect(shouldSkipInitialAgentPlan({ ...base, queryIntent: undefined })).toBe(false);
    expect(shouldSkipInitialAgentPlan({ ...base, queryIntent: null })).toBe(false);
  });
});

describe('resolveEffectiveHardToolCycleLimit (cost budget)', () => {
  it('does not preset a round limit when the request does not specify one', () => {
    expect(resolveEffectiveHardToolCycleLimit(undefined)).toBe(0);
    expect(resolveEffectiveHardToolCycleLimit(null)).toBe(0);
  });

  it('honors an explicit positive budget', () => {
    expect(resolveEffectiveHardToolCycleLimit(3)).toBe(3);
    expect(resolveEffectiveHardToolCycleLimit(100)).toBe(100);
  });

  it('keeps the unlimited opt-out for an explicit 0', () => {
    expect(resolveEffectiveHardToolCycleLimit(0)).toBe(0);
  });

  it('treats invalid values as absent', () => {
    expect(resolveEffectiveHardToolCycleLimit(-1)).toBe(0);
    expect(resolveEffectiveHardToolCycleLimit(Number.NaN)).toBe(0);
  });
});

describe('shouldCountToolFailureForDisable (tool disable guard)', () => {
  it('does not disable exec_shell on a non-zero exit code (command executed)', () => {
    expect(shouldCountToolFailureForDisable('exec_shell', { data: { executed: true } })).toBe(false);
    expect(shouldCountToolFailureForDisable('exec_shell', { data: { executed: true, exitCode: 1 } })).toBe(false);
  });

  it('counts call-level failures for exec_shell', () => {
    expect(shouldCountToolFailureForDisable('exec_shell', undefined)).toBe(true);
    expect(shouldCountToolFailureForDisable('exec_shell', { data: {} })).toBe(true);
    expect(shouldCountToolFailureForDisable('exec_shell', { data: { executed: false } })).toBe(true);
  });

  it('counts failures for other tools', () => {
    expect(shouldCountToolFailureForDisable('read_file', { data: { executed: true } })).toBe(true);
    expect(shouldCountToolFailureForDisable('write_file', {})).toBe(true);
  });
});

describe('filterUtilityAgentToolsByIntent (tool pruning)', () => {
  const tools = [
    { type: 'function' as const, function: { name: 'utility_sentence_claim_search', description: '', parameters: {} } },
    { type: 'function' as const, function: { name: 'utility_data_analysis', description: '', parameters: {} } },
    { type: 'function' as const, function: { name: 'utility_r_plot', description: '', parameters: {} } },
    { type: 'function' as const, function: { name: 'utility_flowchart_generate', description: '', parameters: {} } },
    { type: 'function' as const, function: { name: 'utility_ppt_generate', description: '', parameters: {} } },
  ];

  it('keeps the full set for unknown/empty intent (conservative)', () => {
    expect(filterUtilityAgentToolsByIntent(tools, '').length).toBe(5);
  });

  it('prunes all utility tools for general chat', () => {
    expect(filterUtilityAgentToolsByIntent(tools, 'general_chat').length).toBe(0);
  });

  it('keeps only data-analysis/plot tools for r_plot intent', () => {
    const names = filterUtilityAgentToolsByIntent(tools, 'r_plot').map(tool => tool.function.name);
    expect(names).toEqual(['utility_data_analysis', 'utility_r_plot']);
  });

  it('keeps only claim-search for literature retrieval', () => {
    const names = filterUtilityAgentToolsByIntent(tools, 'literature_retrieval').map(tool => tool.function.name);
    expect(names).toEqual(['utility_sentence_claim_search']);
  });
});

describe('parseFileResourceSummaryLines (conversation-end file resource summary)', () => {
  it('parses "path | summary | keep|temp" lines into a map', () => {
    const parsed = parseFileResourceSummaryLines([
      'figure5/QZ-field-paper-GCB.R | 生成 figure5 的 R 源码，已修改误差条与角标位置 | keep',
      'figure5/diag_v33.py | 诊断脚本，输出 raw vs clean 像素对比 | temp',
      '不合法行没有竖线',
      '',
    ].join('\n'));
    expect(parsed.size).toBe(2);
    expect(parsed.get('figure5/QZ-field-paper-GCB.R')?.summary).toContain('误差条');
    expect(parsed.get('figure5/QZ-field-paper-GCB.R')?.keep).toBe(true);
    expect(parsed.get('figure5/diag_v33.py')?.summary).toContain('诊断脚本');
    expect(parsed.get('figure5/diag_v33.py')?.keep).toBe(false);
  });

  it('defaults to keep when the flag is missing and normalizes backslashes', () => {
    const parsed = parseFileResourceSummaryLines('figure5\\a.R |  摘要内容  ');
    expect(parsed.get('figure5/a.R')?.summary).toBe('摘要内容');
    expect(parsed.get('figure5/a.R')?.keep).toBe(true);
  });

  it('handles empty input', () => {
    expect(parseFileResourceSummaryLines('').size).toBe(0);
    expect(parseFileResourceSummaryLines('no separator').size).toBe(0);
  });
});

describe('isLikelyTemporaryTestFile (temp test file classification)', () => {
  it('classifies diagnostic/measure/inspect scripts as temporary', () => {
    expect(isLikelyTemporaryTestFile('figure5/diag_v33.py')).toBe(true);
    expect(isLikelyTemporaryTestFile('figure5/measure_bcef2.py')).toBe(true);
    expect(isLikelyTemporaryTestFile('figure5/inspect_pointpath.py')).toBe(true);
    expect(isLikelyTemporaryTestFile('figure5/scan_pixels.py')).toBe(true);
    expect(isLikelyTemporaryTestFile('figure5/diag_v33_crops/fig_a.png')).toBe(true);
  });

  it('keeps deliverable source files and outputs', () => {
    expect(isLikelyTemporaryTestFile('figure5/QZ-field-paper-GCB.R')).toBe(false);
    expect(isLikelyTemporaryTestFile('figure5/prepare_clean_panels.py')).toBe(false);
    expect(isLikelyTemporaryTestFile('figure5/figure5_gcb.png')).toBe(false);
    expect(isLikelyTemporaryTestFile('data/analysis_results.csv')).toBe(false);
    expect(isLikelyTemporaryTestFile('')).toBe(false);
  });
});

describe('isCodeDefinedVisualPropertyQuestion (no vision for code-defined properties)', () => {
  it('detects font-size / color / line-width questions', () => {
    expect(isCodeDefinedVisualPropertyQuestion('对比三个面板的坐标轴字号')).toBe(true);
    expect(isCodeDefinedVisualPropertyQuestion('g 的 X 轴日期字号是否和 a/b 一致？')).toBe(true);
    expect(isCodeDefinedVisualPropertyQuestion('检查 element_text size 是否统一')).toBe(true);
    expect(isCodeDefinedVisualPropertyQuestion('各面板线条颜色和线宽是否一致')).toBe(true);
  });

  it('does not flag pure rendering-effect questions', () => {
    expect(isCodeDefinedVisualPropertyQuestion('图里有没有残留的标签文字？')).toBe(false);
    expect(isCodeDefinedVisualPropertyQuestion('描述三个面板的布局')).toBe(false);
    expect(isCodeDefinedVisualPropertyQuestion('')).toBe(false);
  });
});

describe('filterWorkspaceToolsByIntent (schema pruning)', () => {
  const tools = [
    'list_dir', 'file_search', 'read_file', 'write_file', 'exec_shell',
    'office_view', 'office_apply', 'move_file', 'remove_empty_directory',
    'import_workspace_assets', 'list_archived_sessions', 'build_figures_tables_docx',
  ].map(name => ({ function: { name } }));

  const names = (result: Array<{ function: { name: string } }>) => result.map(tool => tool.function.name);

  it('keeps core file tools always', () => {
    const result = filterWorkspaceToolsByIntent(tools, {
      userMessage: '看看图里有没有残留标签',
      queryIntent: { primaryIntent: 'general_chat' },
    });
    for (const core of ['list_dir', 'file_search', 'read_file', 'write_file', 'exec_shell']) {
      expect(names(result)).toContain(core);
    }
  });

  it('prunes office/move/import/archive for a pure pixel task', () => {
    const result = filterWorkspaceToolsByIntent(tools, {
      userMessage: '检查 figure5 图片的像素',
      queryIntent: { primaryIntent: 'general_chat' },
    });
    expect(names(result)).not.toContain('office_view');
    expect(names(result)).not.toContain('office_apply');
    expect(names(result)).not.toContain('move_file');
    expect(names(result)).not.toContain('remove_empty_directory');
    expect(names(result)).not.toContain('import_workspace_assets');
    expect(names(result)).not.toContain('list_archived_sessions');
    expect(names(result)).not.toContain('build_figures_tables_docx');
  });

  it('keeps office tools when the message mentions office files', () => {
    const result = filterWorkspaceToolsByIntent(tools, {
      userMessage: '把论文里的表格改一下，保存为 docx',
      queryIntent: { primaryIntent: 'academic_writing' },
    });
    expect(names(result)).toContain('office_view');
    expect(names(result)).toContain('office_apply');
    expect(names(result)).toContain('build_figures_tables_docx');
  });

  it('keeps move/import/archive when signals are present', () => {
    const result = filterWorkspaceToolsByIntent(tools, {
      userMessage: '把文件移到 figure1 并导入资产，看看归档会话',
      queryIntent: { primaryIntent: 'workspace_file', needsWorkspaceSearch: true },
    });
    const resultNames = names(result);
    expect(resultNames).toContain('move_file');
    expect(resultNames).toContain('remove_empty_directory');
    expect(resultNames).toContain('import_workspace_assets');
    expect(resultNames).toContain('list_archived_sessions');
  });
});

describe('analyze_image vision tool', () => {
  it('defines the tool with a required path parameter', () => {
    const def = getAgentImageAnalysisToolDefinition();
    expect(def.function.name).toBe('analyze_image');
    const params = def.function.parameters as { required?: string[] };
    expect(params.required).toContain('path');
  });

  it('rejects calls without a path argument', async () => {
    await expect(executeAgentImageAnalysisToolCall(
      { id: 'x', type: 'function', function: { name: 'analyze_image', arguments: '{}' } },
      { workspaceRoot: 'C:/any' },
    )).rejects.toThrow('需要 path');
  });

  it('rejects calls without a configured workspace', async () => {
    await expect(executeAgentImageAnalysisToolCall(
      { id: 'x', type: 'function', function: { name: 'analyze_image', arguments: JSON.stringify({ path: 'a.png' }) } },
      {},
    )).rejects.toThrow('未配置工作目录');
  });

  it('rejects missing image files with a no-guessing hint', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-tool-test-'));
    try {
      await expect(executeAgentImageAnalysisToolCall(
        { id: 'x', type: 'function', function: { name: 'analyze_image', arguments: JSON.stringify({ path: 'figure5/nope.png' }) } },
        { workspaceRoot: root },
      )).rejects.toThrow('图片文件不存在');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('isImageInspectionCall (vision convergence)', () => {
  const call = (name: string, args: string) => ({ id: 'x', type: 'function' as const, function: { name, arguments: args } });

  it('recognizes analyze_image and PIL/crop/numpy shell scripts as image inspection', () => {
    expect(isImageInspectionCall(call('analyze_image', '{"path":"a.png"}'))).toBe(true);
    expect(isImageInspectionCall(call('analyze_images_batch', '{"paths":["a.png","b.png"]}'))).toBe(true);
    expect(isImageInspectionCall(call('exec_shell', '{"command":"python -c \\"from PIL import Image; im.crop()\\""}'))).toBe(true);
    expect(isImageInspectionCall(call('exec_shell', '{"command":"python -c \\"import numpy; resize\\""}'))).toBe(true);
  });

  it('does not treat ordinary file tools as image inspection', () => {
    expect(isImageInspectionCall(call('read_file', '{"path":"script.py"}'))).toBe(false);
    expect(isImageInspectionCall(call('list_dir', '{"path":"images"}'))).toBe(false);
    expect(isImageInspectionCall(call('exec_shell', '{"command":"Get-ChildItem *.py"}'))).toBe(false);
  });
});

describe('isScriptedImageInspectionCommand (vision-first steering)', () => {
  it('detects read-only PIL/numpy pixel inspection without output files', () => {
    expect(isScriptedImageInspectionCommand('python -c "from PIL import Image; im = Image.open(\'a.png\'); print(im.getpixel((0,0)))"')).toBe(true);
    expect(isScriptedImageInspectionCommand('python -c "import numpy as np; from PIL import Image; a = np.array(Image.open(\'x.png\')); print((a[:,:,:3] == 255).all(axis=2).sum())"')).toBe(true);
    expect(isScriptedImageInspectionCommand('python -c "from PIL import Image; im = Image.open(\'a.png\').crop((0,0,10,10)); print(im.size)"')).toBe(true);
  });

  it('does not steer image processing that saves output files', () => {
    expect(isScriptedImageInspectionCommand('python -c "from PIL import Image; im = Image.open(\'a.png\').crop((0,0,10,10)); im.save(\'out.png\')"')).toBe(false);
    expect(isScriptedImageInspectionCommand('python -c "import cv2; img = cv2.imread(\'a.png\'); cv2.imwrite(\'out.png\', img)"')).toBe(false);
  });

  it('does not match non-image commands', () => {
    expect(isScriptedImageInspectionCommand('Get-ChildItem *.png')).toBe(false);
    expect(isScriptedImageInspectionCommand('Get-Content notes.txt')).toBe(false);
    expect(isScriptedImageInspectionCommand('')).toBe(false);
  });
});

describe('isLikelyDiagnosticMeasurementScript (file-first guard)', () => {
  it('detects python measurement/diagnostic script execution', () => {
    expect(isLikelyDiagnosticMeasurementScript('python figure5\\diag_v33.py')).toBe(true);
    expect(isLikelyDiagnosticMeasurementScript('python figure5\\measure_bcef2.py')).toBe(true);
    expect(isLikelyDiagnosticMeasurementScript('python scan_pixels.py')).toBe(true);
    expect(isLikelyDiagnosticMeasurementScript('python inspect_pointpath.py')).toBe(true);
  });

  it('does not flag non-diagnostic commands', () => {
    expect(isLikelyDiagnosticMeasurementScript('python figure5\\plot_figure.py')).toBe(false);
    expect(isLikelyDiagnosticMeasurementScript('Get-ChildItem *.png')).toBe(false);
    expect(isLikelyDiagnosticMeasurementScript('')).toBe(false);
  });
});

describe('analyze_images_batch tool', () => {
  it('defines the batch tool with a required paths array', () => {
    const def = getAgentImageBatchAnalysisToolDefinition();
    expect(def.function.name).toBe('analyze_images_batch');
    const params = def.function.parameters as { required?: string[]; properties?: Record<string, unknown> };
    expect(params.required).toContain('paths');
    expect((params.properties?.paths as { type?: string }).type).toBe('array');
  });

  it('rejects calls without paths', async () => {
    await expect(executeAgentImageBatchAnalysisToolCall(
      { id: 'x', type: 'function', function: { name: 'analyze_images_batch', arguments: '{}' } },
      { workspaceRoot: 'C:/any' },
    )).rejects.toThrow('paths 数组');
  });

  it('rejects calls without a workspace', async () => {
    await expect(executeAgentImageBatchAnalysisToolCall(
      { id: 'x', type: 'function', function: { name: 'analyze_images_batch', arguments: JSON.stringify({ paths: ['a.png'] }) } },
      {},
    )).rejects.toThrow('未配置工作目录');
  });
});
