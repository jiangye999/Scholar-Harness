import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..");

describe("autonomous literature and file retrieval defaults", () => {
  it("lets AI generate keywords and execute local evidence retrieval before answering", () => {
    const html = readFileSync(path.join(repoRoot, "src/public/index.html"), "utf-8");

    expect(html).toContain("var AUTO_LITERATURE_CONTEXT_ENABLED = true;");
    expect(html).toContain("var AUTO_RETRIEVAL_DETECTION_ENABLED = true;");
    expect(html).toContain("async function runAutonomousRetrievalForMessage(message, onProgress, queryIntent, recentHistory)");
    expect(html).toContain("queryIntent.needsLiteratureRetrieval !== true");
    expect(html).toContain("fetch('/api/retrieval/detect'");
    expect(html).toContain("fetch('/api/retrieval/execute'");
    expect(html).toContain("context.autonomousRetrieval = autonomousRetrieval;");
    expect(html).toContain("context.relevantLiterature = autonomousRetrieval.contextMarkdown;");
    expect(html).toContain("齿轮入口继续保留");
  });

  it("keeps the manual gear action as an explicit force-generate fallback", () => {
    const html = readFileSync(path.join(repoRoot, "src/public/index.html"), "utf-8");

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
    expect(route).toContain("## AI 自主检索证据（本轮自动生成检索词并执行）");
    expect(route).toContain("无需再让用户点击齿轮或确认检索");
    expect(server).toContain("const codexDetectionAvailable = isCodexCliLikelyAvailableForPdfWiki();");
    expect(server).toContain('forceProvider: "codex"');
    expect(server).toContain("detectionProvider");
  });
});
