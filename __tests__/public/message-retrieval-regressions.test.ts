import { readFileSync } from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { readPublicAppSource } from '../helpers/public-app-source';

const repoRoot = path.resolve(__dirname, "..", "..");

describe("chat message and retrieval regressions", () => {
  it("keeps short inline-code chips intact and lets long expressions wrap safely", () => {
    const html = readPublicAppSource();

    expect(html).toMatch(/\.content code\.message-inline-code\.is-atomic \{[\s\S]*?display: inline-block;[\s\S]*?white-space: nowrap;[\s\S]*?word-break: keep-all;/);
    expect(html).toMatch(/\.content code\.message-inline-code\.is-wrap \{[\s\S]*?display: inline;[\s\S]*?overflow-wrap: break-word;/);
    expect(html).toContain("compactText.length <= 48");
    expect(html).toContain('<code class="message-inline-code \' + layoutClass + \'">');
    expect(html).toMatch(/\.content pre code \{[\s\S]*?white-space: inherit;/);
    expect(html).toMatch(/\.message-list-body \{[\s\S]*?width: 100%;[\s\S]*?overflow-wrap: break-word;/);
  });

  it("repairs bot prose when a list or bubble collapses to one glyph per line", () => {
    const html = readPublicAppSource();

    expect(html).toContain(".message.bot:not(.pi-agent-message) > .content");
    expect(html).toContain("flex: 1 1 0 !important;");
    expect(html).toContain(".message.bot .message-list-item");
    expect(html).toContain("flex-flow: row nowrap !important;");
    expect(html).toContain("writing-mode: horizontal-tb !important;");
    expect(html).toContain("function repairCollapsedChatMessageLayout(messageElement)");
    expect(html).toContain("bodyRect.width >= Math.min(120, stableContentWidth * 0.35)");
    expect(html).toContain("chatMessageLayoutObserver.observe(messagesDiv");
    expect(html).toContain("chatMessageLayoutResizeObserver.observe(messagesDiv)");
  });

  it("uses the final agent answer and explicitly requests keyword generation", () => {
    const html = readPublicAppSource();

    expect(html).toContain("function getRetrievalMessageText(contentDiv)");
    expect(html).toContain("contentDiv.querySelector('.agent-transcript-answer')");
    expect(html).toContain("textContent = getRetrievalMessageText(contentDiv);");
    expect(html).toContain("message: textContent.substring(0, 12000)");
    expect(html).toContain("forceGenerate: true");
  });

  it("does not let forced keyword generation reject substantive content", () => {
    const server = readFileSync(path.join(repoRoot, "src/server/local-server.ts"), "utf-8");

    expect(server).toContain("const forceGenerate = req.body.forceGenerate === true;");
    expect(server).toContain("用户已经主动点击“生成检索词”");
    expect(server).toContain("forceGenerate && !isPureGreeting");
    expect(server).toContain("已根据消息中的实质内容生成可编辑候选");
  });

  it("keeps only the latest literature request and retries transient failures", () => {
    const html = readPublicAppSource();

    expect(html).toContain("var literatureLoadSequence = 0;");
    expect(html).toContain("requestId === literatureLoadSequence");
    expect(html).toContain("literatureLoadController.abort()");
    expect(html).toContain("正在自动重试");
  });

  it("attaches the exact page writing target to every AI request", () => {
    const html = readPublicAppSource();

    expect(html).toContain("function getArticleWritingProgressSnapshot()");
    expect(html).toContain("context.articleWritingProgress = writingProgress;");
    expect(html).toContain("本章还没有小节结构");
    expect(html).toContain("未锁定时 AI 自动识别保存章节");
  });

  it("allows the current writing lock to be cleared and restores automatic classification", () => {
    const html = readPublicAppSource();

    expect(html).toContain("function clearArticleWritingTarget()");
    expect(html).toContain("function toggleArticleWritingTarget(input, chapterKey, chapterId, subsectionId)");
    expect(html).toContain("取消当前");
    expect(html).toContain("AI 自动识别章节");
    expect(html).not.toContain("尚未设置当前写作小节");
  });
});
