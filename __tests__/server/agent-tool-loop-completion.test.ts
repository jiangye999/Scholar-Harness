import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

const routeSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/server/routes/chat-bridge.ts'),
  'utf-8',
);

function readAgentToolLoopSource(): string {
  const start = routeSource.indexOf('async function chatWithAgentToolsLoop(');
  const end = routeSource.indexOf('\nfunction normalizePiConversationId', start);
  if (start < 0 || end < 0) {
    throw new Error('Unable to locate chatWithAgentToolsLoop source');
  }
  return routeSource.slice(start, end);
}

describe('completion-driven Agent tool loop', () => {
  const loopSource = readAgentToolLoopSource();

  it('keeps the completion-driven loop with a plan-first first round and no preset round cap', () => {
    // 不引入旧的固定轮次文案 / 轮次 for 循环；收敛由“首轮计划 + 无新进展软收敛”驱动。
    expect(routeSource).not.toContain('WORKSPACE_TOOL_MAX_TURNS');
    expect(routeSource).not.toContain('Agent 工具已达到最大执行轮次');
    expect(loopSource).toContain('while (true)');
    expect(loopSource).not.toMatch(/for\s*\(\s*let\s+turn\b/);
    expect(routeSource).not.toContain('DEFAULT_HARD_TOOL_CYCLE_LIMIT');
    expect(routeSource).toContain('NO_PROGRESS_ROUND_LIMIT = 4');
    expect(routeSource).toContain('LENGTH_FINISH_ROUND_LIMIT = 3');
    expect(routeSource).toContain('COMPLETION_CONTRACT_RECOVERY_LIMIT = 3');
    expect(loopSource).toContain('convergeToolLoop(');
    // 首轮计划：先输出执行计划，并同时发起本轮可立即执行的工具调用。
    expect(routeSource).toContain('TASK_PLAN_REQUEST');
    expect(loopSource).toContain('planReceived');
    expect(loopSource).toContain('planRequestInjected');
    expect(loopSource).toContain('📋 执行计划');
    expect(loopSource).toContain('result.toolCalls.length === 0 && planText');
    // 计划不是一次性承诺：每 PLAN_CHECKPOINT_INTERVAL 轮对账一次，偏离时更新计划。
    expect(routeSource).toContain('PLAN_CHECKPOINT_INTERVAL = 5');
    expect(routeSource).toContain('PLAN_CHECKPOINT_PROMPT');
    expect(loopSource).toContain('planCheckpointInjected');
    expect(loopSource).toContain('🔄 计划对账');
    // 对账/计划文本已流式显示时不再重复打印；写文件+执行同轮合并。
    expect(loopSource).toContain('streamedContentThisRound');
    expect(loopSource).toContain('!streamedContentThisRound');
    expect(loopSource).toContain('不要拆成两轮');
    // 视觉优先：视觉工具可用时，脚本式“纯看图”拦截一次并引导到视觉工具。
    expect(routeSource).toContain('SCRIPTED_INSPECTION_NUDGE_LIMIT');
    expect(loopSource).toContain('visionInspectionAvailable');
    expect(loopSource).toContain('isScriptedImageInspectionCommand(commandArg)');
    expect(loopSource).toContain('analyze_images_batch');
    // 视觉结果跨轮缓存：相同参数的识图调用直接复用，不重复打视觉模型。
    expect(loopSource).toContain('visionResultCache');
    expect(loopSource).toContain('cachedVisionResult');
    expect(loopSource).toContain('markVisionCached');
    expect(loopSource).toContain('缓存复用');
    // 文件优先：计划阶段强制先定位并读取源文件；没读源文件就运行测量脚本会被提示。
    expect(routeSource).toContain('文件优先（强制）');
    expect(routeSource).toContain('文件 → 图片识别 → 像素识别');
    expect(routeSource).toContain('像素级脚本分析是最后手段');
    expect(routeSource).toContain('禁止作为首选');
    expect(loopSource).toContain('sourceFileReadsThisTurn');
    expect(loopSource).toContain('sourceReadNudges');
    expect(loopSource).toContain('isLikelyDiagnosticMeasurementScript(commandArg)');
    // 对话遗产：记录并注入最近读取/修改的文件；定位源文件时对比修改时间。
    expect(routeSource).toContain('modifiedAt（修改时间）');
    expect(routeSource).toContain('最新修改的就是刚处理过的权威文件');
    expect(routeSource).toContain('继承遗产');
    expect(routeSource).toContain('遗产没有匹配项或内容不相关时');
    expect(loopSource).toContain('recentFilesTouched');
    expect(loopSource).toContain('recordTouchedFile');
    expect(loopSource).toContain('persistRecentFilesIfAny');
    // 会话结束时生成文件资源摘要，供下一次对话直接读取。
    expect(routeSource).toContain('summarizeTouchedFilesForLegacy');
    expect(routeSource).toContain('文件资源摘要器');
    expect(loopSource).toContain('keepEntries');
    expect(loopSource).toContain('tempEntries');
    expect(loopSource).toContain('turnContext: lastContent');
    // 临时测试文件不进遗产，会话结束后清理。
    expect(routeSource).toContain('isLikelyTemporaryTestFile');
    expect(routeSource).toContain('removeTemporaryTestFilesBestEffort');
    expect(loopSource).toContain('临时测试/诊断文件');
    // exec_shell 提升为一级批量工具；read+edit 允许同轮按顺序发出。
    expect(loopSource).toContain('exec_shell 是一级效率工具');
    expect(loopSource).toContain('可在同一轮先发 read_file 再发 edit_file');
    expect(loopSource).toContain('read_file(paths=[...])');
    // 代码已定义属性禁止用视觉模型核对（字号/颜色/线宽直接读源码）。
    expect(routeSource).toContain('禁止用视觉模型核对');
    expect(routeSource).toContain('isCodeDefinedVisualPropertyQuestion');
    expect(loopSource).toContain('codeDefinedVisionNudges');
    expect(loopSource).toContain('视觉模型测不了精确字号');
    // 工作目录细则索引化：常驻安全底线 + read_workspace_rule 按需拉取。
    expect(routeSource).toContain('WORKSPACE_RULE_KEYS_PROMPT');
    expect(routeSource).toContain('安全底线');
    // 动态上下文 manifest：记忆与自主检索证据按需读取。
    expect(routeSource).toContain("resourceId=\"memory\"");
    expect(routeSource).toContain("resourceId=\"autonomous-retrieval\"");
    expect(routeSource).toContain('对话记忆（manifest）');
    expect(routeSource).toContain('AI 自主检索证据（manifest）');
    // 任务级大块 manifest：R 作图 / 联网搜索 / 期刊要求 / 讨论框架。
    expect(routeSource).toContain("resourceId=\"r-plot\"");
    expect(routeSource).toContain("resourceId=\"web-search\"");
    expect(routeSource).toContain("resourceId=\"target-venue-requirements\"");
    expect(routeSource).toContain("resourceId=\"discussion-framework\"");
    expect(routeSource).toContain('最近一次 R 作图上下文（manifest）');
    expect(routeSource).toContain('联网搜索结果（manifest）');
    expect(routeSource).toContain('当前项目论文框架规划（manifest）');
    // 软收敛按“新的有效工作”判定：重复成功调用不算进展，正常推进不误伤。
    expect(loopSource).toContain('successfulToolSignatures');
    expect(loopSource).toContain('newWorkThisRound === 0');
    expect(loopSource).toContain('回复“继续完成”');
    // 达到预算时先请求阶段性结论（检查点），而不是直接裸停。
    expect(routeSource).toContain('TOOL_LOOP_CHECKPOINT_PROMPT');
    expect(loopSource).toContain('checkpointAnswerRequested');
    expect(loopSource).toContain('阶段性结论');
  });

  it('finishes on a model final response and remains user-cancellable', () => {
    expect(loopSource).toContain('if (!result.toolCalls.length)');
    expect(loopSource).toContain('return finalAnswer');
    expect(loopSource).toContain('assertAgentLoopActive()');
    expect(loopSource).toContain('options.isCancelled?.()');
  });

  it('recovers strict textual tool calls before treating them as final answers', () => {
    expect(loopSource).toContain('recoverTextualToolCalls');
    expect(loopSource).toContain('partitionTextualToolProgress');
    expect(loopSource).toContain('textualRecoveryTools');
    expect(loopSource).toContain('activeTextualRecoveryTools');
    expect(loopSource).toContain('...researchEnhancementTools');
    expect(loopSource).toContain('...metaAnalysisTools');
    expect(loopSource).toContain('...utilityTools');
    expect(loopSource).toContain('系统已拦截原始调用文本');
    expect(loopSource).toContain('bufferedPotentialTextToolProgress');
    expect(loopSource).toContain('Recovered textual tool call from provider content/reasoning');
    expect(loopSource).toContain('textualToolRepairAttempts');
    expect(loopSource).toContain('<TOOL_CALL_FORMAT_REPAIR>');
    expect(loopSource).toContain('正在自动纠正后重试');
    const recoveryIndex = loopSource.indexOf('recoverTextualToolCalls');
    const finalAnswerGuardIndex = loopSource.indexOf('if (!result.toolCalls.length)', recoveryIndex);
    expect(recoveryIndex).toBeGreaterThan(-1);
    expect(recoveryIndex).toBeLessThan(finalAnswerGuardIndex);
  });

  it('recovers from identical failed calls without terminating the task', () => {
    expect(loopSource).toContain('IDENTICAL_FAILED_TOOL_RETRY_LIMIT');
    expect(loopSource).toContain('这不会结束 Agent 任务');
    expect(loopSource).toContain('继续推理直至任务完成');
    // pi-style: identical retries are short-circuited structurally; the loop is
    // driven by the model + user interrupt, not by prompt-injection nudges.
    expect(loopSource).not.toContain('<AGENT_LOOP_RECOVERY>');
  });

  it('converges on repeated length-finish rounds instead of re-issuing forever', () => {
    expect(loopSource).toContain("if (result.finishReason === 'length')");
    expect(loopSource).toContain('consecutiveLengthFinishes >= LENGTH_FINISH_ROUND_LIMIT');
    expect(loopSource).toContain('已按已有内容收敛');
  });
});
