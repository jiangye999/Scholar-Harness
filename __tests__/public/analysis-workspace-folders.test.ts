import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();
const chatBridgeRoute = readFileSync(path.resolve(__dirname, '../../src/server/routes/chat-bridge.ts'), 'utf-8');
const bibliometricsRoute = readFileSync(path.resolve(__dirname, '../../src/server/routes/bibliometrics.ts'), 'utf-8');
const autoResearchRoute = readFileSync(path.resolve(__dirname, '../../src/server/routes/autoresearch.ts'), 'utf-8');
const metaAnalysisRoute = readFileSync(path.resolve(__dirname, '../../src/server/routes/meta-analysis.ts'), 'utf-8');

describe('analysis workflow workspace folders', () => {
  it('prepares and scopes the selected main-chat analysis context', () => {
    expect(html).toContain("bibliometrics: '文献计量分析'");
    expect(html).toContain("metaAnalysis: 'Meta分析'");
    expect(html).toContain("autoResearch: 'Auto Research'");
    expect(html).toContain("fetch('/api/chat-bridge/workspace/prepare-analysis-folders'");
    expect(html).toContain('scopeWorkspaceDirectoryForSelectedAnalysis(');
    expect(html).toContain('analysisWorkspaceDirectories = preparedAnalysisWorkspaceDirectories');
    expect(html).toContain('preferredSourceId');
    expect(html).toContain('function addSelectedKind(sourceId)');
    expect(html).toContain('addSelectedKind(preferredSourceId)');
    expect(html).toContain("if (selectedSources[sourceId] === true) addSelectedKind(sourceId)");
    expect(html).toContain("window.activateMainAnalysisWorkflowHandoff('autoResearch')");
  });

  it('creates the three backend workflow directories beneath the configured workspace', () => {
    expect(chatBridgeRoute).toContain("bibliometrics: '文献计量分析'");
    expect(chatBridgeRoute).toContain("metaAnalysis: 'Meta分析'");
    expect(chatBridgeRoute).toContain("autoResearch: 'Auto Research'");
    expect(chatBridgeRoute).toContain("router.post('/workspace/prepare-analysis-folders'");
    expect(bibliometricsRoute).toContain("['文献计量分析']");
    expect(metaAnalysisRoute).toContain("['Meta分析']");
    expect(autoResearchRoute).toContain("['Auto Research']");
  });
});
