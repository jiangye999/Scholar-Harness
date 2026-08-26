import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  resolveAuthorizedChatAttachmentPath,
  resolveAuthorizedChatImagePaths,
} from '../../../src/server/services/chat-attachment-policy';

const temporaryRoots: string[] = [];

function makeFixture(): { root: string; uploadRoot: string; workspaceRoot: string; outsideFile: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-chat-attachment-'));
  temporaryRoots.push(root);
  const uploadRoot = path.join(root, 'uploads');
  const workspaceRoot = path.join(root, 'workspace');
  fs.mkdirSync(uploadRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(uploadRoot, 'upload.png'), 'upload');
  fs.writeFileSync(path.join(workspaceRoot, 'figure.png'), 'workspace');
  const outsideFile = path.join(root, 'private.txt');
  fs.writeFileSync(outsideFile, 'private');
  return { root, uploadRoot, workspaceRoot, outsideFile };
}

afterEach(() => {
  temporaryRoots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

describe('chat attachment path policy', () => {
  it('accepts existing files in the user upload directory and authorized workspace', () => {
    const fixture = makeFixture();
    const options = {
      userId: 'test-user',
      attachmentRoot: fixture.uploadRoot,
      workspace: { root: fixture.workspaceRoot },
    };

    expect(resolveAuthorizedChatAttachmentPath(path.join(fixture.uploadRoot, 'upload.png'), options))
      .toBe(fs.realpathSync(path.join(fixture.uploadRoot, 'upload.png')));
    expect(resolveAuthorizedChatAttachmentPath(path.join(fixture.workspaceRoot, 'figure.png'), options))
      .toBe(fs.realpathSync(path.join(fixture.workspaceRoot, 'figure.png')));
  });

  it('rejects files outside the upload and workspace roots', () => {
    const fixture = makeFixture();
    expect(() => resolveAuthorizedChatAttachmentPath(fixture.outsideFile, {
      userId: 'test-user',
      attachmentRoot: fixture.uploadRoot,
      workspace: { root: fixture.workspaceRoot },
    })).toThrow('附件不在当前用户上传目录或已授权工作目录中');
  });

  it('deduplicates authorized image paths and rejects missing files', () => {
    const fixture = makeFixture();
    const image = path.join(fixture.uploadRoot, 'upload.png');
    expect(resolveAuthorizedChatImagePaths([image, image], {
      userId: 'test-user',
      attachmentRoot: fixture.uploadRoot,
    })).toEqual([fs.realpathSync(image)]);
    expect(() => resolveAuthorizedChatImagePaths([path.join(fixture.uploadRoot, 'missing.png')], {
      userId: 'test-user',
      attachmentRoot: fixture.uploadRoot,
    })).toThrow('附件不存在');
  });
});
