import { readFileSync } from 'fs';
import path from 'path';
import * as vm from 'vm';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

function extractFunction(name: string): string {
  const match = html.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}`));
  if (!match) throw new Error(`${name} was not found`);
  return match[0];
}

function loadInvocationHelpers() {
  const context = vm.createContext({});
  vm.runInContext(
    [
      extractFunction('getLeadingInvocationMarkerIndex'),
      extractFunction('findActiveWorkspaceMention'),
      extractFunction('extractWorkspaceFileMentions'),
      'this.helpers = { getLeadingInvocationMarkerIndex, findActiveWorkspaceMention, extractWorkspaceFileMentions };',
    ].join('\n'),
    context,
  );
  return (context as unknown as {
    helpers: {
      getLeadingInvocationMarkerIndex: (value: string, marker: string) => number;
      findActiveWorkspaceMention: (value: string, cursor: number) => { start: number; query: string } | null;
      extractWorkspaceFileMentions: (value: string) => Array<{ path: string }>;
    };
  }).helpers;
}

describe('manual invocation position rules', () => {
  it('only recognizes @ and / as invocation markers at the first non-whitespace character', () => {
    const helpers = loadInvocationHelpers();

    expect(helpers.getLeadingInvocationMarkerIndex('@"figures/result.png" 请分析', '@')).toBe(0);
    expect(helpers.getLeadingInvocationMarkerIndex('  /discussion 请改写', '/')).toBe(2);
    expect(helpers.getLeadingInvocationMarkerIndex('请分析 @"figures/result.png"', '@')).toBe(-1);
    expect(helpers.getLeadingInvocationMarkerIndex('请使用 /discussion 改写', '/')).toBe(-1);
  });

  it('opens and extracts a workspace file mention only when @ starts the message', () => {
    const helpers = loadInvocationHelpers();
    const leading = '@"figures/result.png';

    expect(helpers.findActiveWorkspaceMention(leading, leading.length)).toEqual({
      start: 0,
      query: 'figures/result.png',
    });
    expect(helpers.findActiveWorkspaceMention('请分析 @result.png', '请分析 @result.png'.length)).toBeNull();
    expect(helpers.extractWorkspaceFileMentions('@"figures/result.png" 请分析')).toEqual([
      expect.objectContaining({ path: 'figures/result.png' }),
    ]);
    expect(helpers.extractWorkspaceFileMentions('请分析 @"figures/result.png"')).toHaveLength(0);
  });

  it('anchors every slash dropdown and built-in slash parser to the message start', () => {
    expect(html).not.toContain("lastIndexOf('/', pos - 1)");
    expect(html).not.toContain("lastIndexOf('@', pos - 1)");
    expect(
      html.match(/getLeadingInvocationMarkerIndex\(value, '\/'\)/g)?.length || 0,
    ).toBeGreaterThanOrEqual(3);
    expect(html).toContain(
      'message = message.replace(/^\\/\\+?(标题|题目|摘要|summary|引言|绪论|introduction|intro|材料与方法|方法|methods|method|methodology|结果|results|result|讨论|discussion|结论|conclusions|conclusion)(?=\\s|$)/i',
    );
    expect(html).toContain(
      'var slashPattern = /^\\/\\+?(skill|style|context):([^\\s，。,.!?！？;；:：]+)/gi;',
    );
  });
});
