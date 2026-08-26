import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { readPublicAppSource } from '../helpers/public-app-source';

const repoRoot = path.resolve(__dirname, "..", "..");

describe("autonomous literature and file retrieval defaults", () => {
  it("keeps legacy retrieval helpers available but does not run them before the formal Agent", () => {
    const html = readPublicAppSource();
    const prepareStart = html.indexOf('async function prepareChatBridgeContext(');
    const prepareEnd = html.indexOf('async function loadBibliometricsWritingContext(', prepareStart);
    const prepare = html.slice(prepareStart, prepareEnd);

    expect(html).toContain("var AUTO_LITERATURE_CONTEXT_ENABLED = true;");
    expect(html).toContain("var AUTO_RETRIEVAL_DETECTION_ENABLED = true;");
    expect(html).toContain("async function runAutonomousRetrievalForMessage(message, onProgress, queryIntent, recentHistory, abortSignal)");
    expect(html).toContain("fetch('/api/retrieval/detect'");
    expect(html).toContain("fetch('/api/retrieval/execute'");
    expect(prepare).not.toContain("await runAutonomousRetrievalForMessage(");
    expect(prepare).toContain("agentToolRouting: 'formal-agent'");
    expect(prepare).toContain('正式 Agent 决定何时检索，不预取论文或摘要');
  });

  it("keeps the manual gear action as an explicit force-generate fallback", () => {
    const html = readPublicAppSource();

    expect(html).toContain('onclick="generateKeywordsFromMessage(this)"');
    expect(html).toContain("window.generateKeywordsFromMessage = async function(btn)");
    expect(html).toContain("forceGenerate: true");
    expect(html).toContain("showRetrievalModal(result)");
  });

  it("keeps legacy unified-chat retrieval behind verified intent with a manual override", () => {
    const route = readFileSync(path.join(repoRoot, "src/server/routes/unified-chat.ts"), "utf-8");

    expect(route).not.toContain("useLiterature = true");
    expect(route).toContain("process.env.AUTO_LITERATURE_RETRIEVAL !== '0'");
    expect(route).toContain("verifiedQueryIntent.needsLiteratureRetrieval");
    expect(route).toContain("forceLiteratureRetrieval === true");
    expect(route).toContain("if (shouldRetrieveLiterature)");
  });

  it("tells all providers to perform read-only retrieval without asking for gear clicks", () => {
    const prompt = readFileSync(path.join(repoRoot, "src/server/services/chat-system-prompt.ts"), "utf-8");
    const route = readFileSync(path.join(repoRoot, "src/server/routes/chat-bridge.ts"), "utf-8");
    const server = readFileSync(path.join(repoRoot, "src/server/local-server.ts"), "utf-8");

    expect(prompt).toContain("不要要求用户先点击消息下方齿轮");
    expect(prompt).toContain("file_search、grep_files、list_dir、read_file");
    // 自主检索证据已 manifest 化：所有 provider 仍可通过按需资源读取，
    // 无需用户点击齿轮或确认检索。
    expect(route).toContain("## AI 自主检索证据（manifest）");
    expect(route).toContain('resourceId="autonomous-retrieval"');
    expect(route).toContain("引用前必须先调用 read_page_context");
    expect(server).toContain("const codexDetectionAvailable = isCodexCliLikelyAvailableForPdfWiki();");
    expect(server).toContain('forceProvider: "codex"');
    expect(server).toContain("detectionProvider");
  });
});
