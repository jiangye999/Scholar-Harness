import { describe, expect, it } from 'vitest';

import { extractExplicitWorkspaceFileWriteIntent } from '../../src/utils/workspace-file-intent';

describe('explicit workspace file write intent', () => {
  it('detects a file stem supplied after a Chinese file label', () => {
    expect(extractExplicitWorkspaceFileWriteIntent('更新这个文件：paper-draft')).toEqual({
      target: 'paper-draft',
      operation: 'write',
    });
  });

  it('detects a quoted Office file name', () => {
    expect(extractExplicitWorkspaceFileWriteIntent('请修改 `paper-draft.docx` 中的 Discussion')).toEqual({
      target: 'paper-draft.docx',
      operation: 'write',
    });
  });

  it('does not treat an internal chapter save request as a workspace file operation', () => {
    expect(extractExplicitWorkspaceFileWriteIntent('把这段保存到 Discussion 草稿')).toBeNull();
    expect(extractExplicitWorkspaceFileWriteIntent('更新 Discussion 章节')).toBeNull();
  });
});

