import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicModuleSource } from '../../helpers/public-app-source';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const route = readFileSync(path.join(repoRoot, 'src/server/routes/chat-bridge.ts'), 'utf8');
const server = readFileSync(path.join(repoRoot, 'src/server/local-server.ts'), 'utf8');
const chat = readPublicModuleSource('app/chat.js');

function getPrepareContextSource(): string {
  const start = chat.indexOf('async function prepareChatBridgeContext(');
  const end = chat.indexOf('async function loadBibliometricsWritingContext(', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return chat.slice(start, end);
}

describe('formal Agent on-demand literature and page resources', () => {
  it('exposes local literature and page context as formal Agent tools', () => {
    expect(route).toContain("name: 'search_local_literature'");
    expect(route).toContain("name: 'read_page_context'");
    expect(route).toContain('executeAgentResourceToolCall(');
    expect(route).toContain('用户勾选资源表示授权可用，不表示每轮必须读取');
    expect(server).toContain('searchLocalLiterature: async');
    expect(server).toContain('loadPageContextResource: async');
  });

  it('only sends a lightweight resource catalogue before the formal Agent runs', () => {
    const prepare = getPrepareContextSource();

    expect(prepare).toContain("registerMainChatAgentResource(context, 'current-pdf'");
    expect(prepare).toContain("registerMainChatAgentResource(context, 'bibliometrics'");
    expect(prepare).toContain("registerMainChatAgentResource(context, 'meta-analysis'");
    expect(prepare).toContain("registerMainChatAgentResource(context, 'auto-research'");
    expect(prepare).toContain("'?summaryOnly=1'");
    expect(prepare).not.toContain('await runAutonomousRetrievalForMessage(');
    expect(prepare).not.toContain('await loadBibliometricsWritingContext(');
    expect(prepare).not.toContain('await loadMetaAnalysisWritingContext(');
    expect(prepare).not.toContain('await loadAutoResearchWritingContext(');
    expect(prepare).not.toContain('await loadActivePdfPaperChatContextForTurn(');
  });

  it('keeps current-PDF selection and validates page resource authorization', () => {
    expect(server).toContain("const selectedText = String(resource?.selectedText || '').trim().slice(0, 12_000)");
    expect(server).toContain('selectedText,');
    expect(route).toContain('if (!availableIds.has(resourceId))');
    expect(route).toContain('不在当前会话资源目录中');
  });
});
