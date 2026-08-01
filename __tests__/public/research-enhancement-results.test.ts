import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

describe('research enhancement result center', () => {
  it('keeps the sidebar entry and result bubbles', () => {
    expect(html).toContain('onclick="showResearchEnhancementWorkspace()"');
    expect(html).toContain("title: '科研证据账本'");
    expect(html).toContain("title: '审稿人 Agent'");
    expect(html).toContain("title: '可复现实验包'");
    expect(html).toContain("title: '内置 Obsidian 知识库'");
    expect(html).toContain("title: '期刊投稿准备'");
  });

  it('keeps AI-first result panels while exposing safe Obsidian Vault controls', () => {
    const start = html.indexOf('function getResearchEnhancementItems()');
    const end = html.indexOf('function researchEnhancementBubbleHtml', start);
    const source = html.slice(start, end);

    expect(source).toContain('AI 会在主要章节形成后提示是否生成证据账本');
    expect(source).toContain('确认后通过 MCP 执行');
    expect(source).not.toContain('onclick="generateResearchEvidenceLedger()"');
    expect(source).not.toContain('onclick="runResearchReviewerAgent()"');
    expect(source).not.toContain('onclick="exportResearchReproducibleBundle()"');
    expect(source).toContain('id="researchEnhancementObsidianSyncBtn"');
    expect(source).toContain('onclick="deployResearchObsidianVault()"');
    expect(source).toContain('id="researchEnhancementObsidianSearchBtn"');
    expect(source).toContain('onclick="searchResearchObsidianVault()"');
    expect(source).toContain('不会安装或启动 Obsidian 客户端');
    expect(source).not.toContain('id="submissionPrepJournal"');
  });

  it('loads the latest persisted tool results when the workspace opens', () => {
    expect(html).toContain('void loadResearchEnhancementResults();');
    expect(html).toContain('async function loadResearchEnhancementResults()');
    expect(html).toContain("'/api/research-session/current?userId='");
    expect(html).toContain("'/api/research-session/evidence-ledger?userId='");
    expect(html).toContain("'/api/pdf-wiki/obsidian/status?userId='");
    expect(html).toContain("item.metadata.enhancementType === 'submission-prep'");
  });
});
