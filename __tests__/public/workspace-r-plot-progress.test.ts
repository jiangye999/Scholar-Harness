import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const analysisTools = readFileSync(
  path.resolve(__dirname, '../../src/public/app/analysis-tools.js'),
  'utf-8'
);
const chat = readFileSync(
  path.resolve(__dirname, '../../src/public/app/chat.js'),
  'utf-8'
);

describe('workspace R plot progress rendering', () => {
  it('updates one progress bubble instead of appending a bubble for every stage', () => {
    expect(analysisTools).toContain('function updateWorkspaceRPlotStatusMessage(messageElement, text)');
    expect(analysisTools).toContain("var progressMessage = appendMessage('已识别为工作目录 R 作图任务");
    expect(analysisTools).toContain('progressMessage = updateWorkspaceRPlotStatusMessage(');
    expect(analysisTools).not.toContain("appendMessage('已定位数据文件：' + dataFile.sourceDataFilePath");
  });

  it('does not execute a second R workflow by scanning the completed assistant response', () => {
    expect(chat).not.toContain('await maybeExecuteRCodeFromAiResponse(fullResponse, actualMessage)');
    expect(chat).toContain('Do not scan a completed assistant response and turn it into a new R task.');
    expect(analysisTools).toContain('async function runRecentRPlotFollowup(message, toolIntent, workflowOptions)');
  });
});
