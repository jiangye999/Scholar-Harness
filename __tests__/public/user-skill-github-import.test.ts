import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf-8');

describe('GitHub Skill import UI', () => {
  it('explains repository batch import and reports collection counts', () => {
    expect(html).toContain('仓库/分类目录可批量导入');
    expect(html).toContain('function buildGithubSkillImportStatusHtml(data, prefix)');
    expect(html).toContain("source.importMode === 'collection'");
    expect(html).toContain('新增 ');
    expect(html).toContain('更新 ');
  });

  it('shows the built-in Orchestra AI Research library', () => {
    expect(html).toContain('id="orchestraAiResearchSkillCard"');
    expect(html).toContain('内置 98 项 · 23 类');
    expect(html).toContain('orchestra-ai-research:ai-research-skills');
    expect(html).toContain('按当前任务只读取相关子 Skill');
  });
});
