import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..");

describe("automatic literature retrieval disable switches", () => {
  it("keeps browser-side automatic retrieval disabled by default", () => {
    const html = readFileSync(path.join(repoRoot, "src/public/index.html"), "utf-8");

    expect(html).toContain("var AUTO_LITERATURE_CONTEXT_ENABLED = false;");
    expect(html).toContain("var AUTO_RETRIEVAL_DETECTION_ENABLED = false;");
    expect(html).toContain("if (!AUTO_RETRIEVAL_DETECTION_ENABLED) return;");
    expect(html).toContain("AUTO_LITERATURE_CONTEXT_ENABLED && !isRetrievalResultMessage");
  });

  it("keeps server-side context retrieval behind the explicit environment flag", () => {
    const route = readFileSync(path.join(repoRoot, "src/server/routes/unified-chat.ts"), "utf-8");

    expect(route).toContain("process.env.AUTO_LITERATURE_RETRIEVAL === '1'");
    expect(route).toContain("if (useLiterature && !automaticLiteratureRetrievalEnabled)");
    expect(route).toContain("if (automaticLiteratureRetrievalEnabled && useLiterature)");
  });
});
