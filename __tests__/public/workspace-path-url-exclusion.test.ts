import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

import { describe, expect, it } from 'vitest';

function loadWorkspacePathExtractor(): (message: string) => string {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'public', 'app', 'chat-context.js'),
    'utf8'
  );
  const start = source.indexOf('    function extractWorkspacePathFromMessage(message) {');
  const end = source.indexOf('    function isLocalPathWithinWorkspace', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  const functionSource = source.slice(start, end);
  return vm.runInNewContext(`
    ${functionSource}
    extractWorkspacePathFromMessage;
  `) as (message: string) => string;
}

describe('workspace path extraction from chat messages', () => {
  const extractWorkspacePathFromMessage = loadWorkspacePathExtractor();

  it('does not treat http or https URLs as Windows drive paths', () => {
    expect(extractWorkspacePathFromMessage('DOI: https://doi.org/10.3390/su141912574')).toBe('');
    expect(extractWorkspacePathFromMessage('来源：http://example.com/article/123')).toBe('');
  });

  it('still extracts an explicit Windows path when the message also contains a URL', () => {
    expect(
      extractWorkspacePathFromMessage(
        '参考 https://doi.org/10.3390/su141912574，并读取 D:\\research\\references.docx'
      )
    ).toBe('D:\\research\\references.docx');
  });

  it('continues to support forward-slash Windows paths', () => {
    expect(extractWorkspacePathFromMessage('读取 E:/projects/paper/data.csv')).toBe(
      'E:/projects/paper/data.csv'
    );
  });
});
