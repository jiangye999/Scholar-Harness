import { describe, expect, it } from 'vitest';

import type { ChatBridgeAdapter } from '../../src/bridge/chat-bridge/chat-bridge';
import {
  ScholarClawOrchestrator,
} from '../../src/orchestrator/task-orchestrator';

const orchestrator = new ScholarClawOrchestrator({} as ChatBridgeAdapter);

describe('ScholarClawOrchestrator query routing', () => {
  it('does not turn English substrings into web or literature search', async () => {
    const analysis = await orchestrator.analyzeTask(
      'Please update preference settings and preview profile.',
      []
    );

    expect(analysis.requiresWebSearch).toBe(false);
    expect(analysis.requiresLiterature).toBe(false);
    expect(analysis.queryIntent.needsWorkspaceSearch).toBe(false);
  });

  it('keeps latest workspace file search local', async () => {
    const analysis = await orchestrator.analyzeTask(
      'Find the latest file in workspace.',
      []
    );

    expect(analysis.queryIntent.primaryIntent).toBe('workspace_file');
    expect(analysis.queryIntent.needsWorkspaceSearch).toBe(true);
    expect(analysis.requiresWebSearch).toBe(false);
    expect(analysis.requiresLiterature).toBe(false);
  });

  it('separates explicit web search from literature retrieval', async () => {
    const webAnalysis = await orchestrator.analyzeTask(
      'Search the web for the current N2O policy.',
      []
    );
    const literatureAnalysis = await orchestrator.analyzeTask(
      'Search papers about N2O emissions.',
      []
    );

    expect(webAnalysis.requiresWebSearch).toBe(true);
    expect(webAnalysis.requiresLiterature).toBe(false);
    expect(literatureAnalysis.requiresWebSearch).toBe(false);
    expect(literatureAnalysis.requiresLiterature).toBe(true);
  });
});
