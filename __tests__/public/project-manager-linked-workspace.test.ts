import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();
const projectManagerSource = readFileSync(path.resolve(__dirname, '../../src/utils/project-manager.ts'), 'utf-8');

describe('linked project workspace switching', () => {
  it('keeps the existing project API while activating project directories through links', () => {
    expect(html).toContain("'/api/projects/' + encodeURIComponent(projectId) + '/open'");
    expect(projectManagerSource).toContain('createDirectoryLink');
    expect(projectManagerSource).toContain("process.platform === 'win32' ? 'junction' : 'dir'");
    expect(projectManagerSource).toContain('completeProjectSwitch');
  });

  it('does not perform recursive copies in the project open path', () => {
    const openProjectBody = projectManagerSource.slice(
      projectManagerSource.indexOf('  openProject('),
      projectManagerSource.indexOf('  cloneProject('),
    );
    expect(openProjectBody).not.toContain('fs.cpSync');
    expect(openProjectBody).toContain('completeProjectSwitch');
  });

  it('prevents deletion of the currently active project in both UI and backend', () => {
    expect(html).toContain('disabled title="当前项目不能删除"');
    expect(projectManagerSource).toContain('Cannot delete the currently open project');
  });
});
