import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();
const indexSource = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf8');
const projectUiSource = readFileSync(path.resolve(__dirname, '../../src/public/app/chat-history.js'), 'utf8');
const projectRuntimeSource = readFileSync(path.resolve(__dirname, '../../src/public/app/project-runtime.js'), 'utf8');
const settingsRuntimeSource = readFileSync(path.resolve(__dirname, '../../src/public/app/settings-runtime.js'), 'utf8');
const popoverStyles = readFileSync(path.resolve(__dirname, '../../src/public/styles/popovers.css'), 'utf8');

describe('sidebar project manager', () => {
  it('replaces the two project buttons with a collapsible project row and plus action', () => {
    const sidebarStart = indexSource.indexOf('<div class="sidebar-panels">');
    const uploadStart = indexSource.indexOf('<div class="upload-section', sidebarStart);
    const projectArea = indexSource.slice(sidebarStart, uploadStart);

    expect(projectArea).toContain('data-sidebar-collapse-key="projects"');
    expect(projectArea).toContain('data-sidebar-toggle-key="projects"');
    expect(projectArea).toContain('id="sidebarProjectManagerBody"');
    expect(projectArea).not.toContain('<div class="sidebar-panel-title">新建</div>');
    expect(projectArea).toContain('class="project-manager-add"');
    expect(projectArea).toContain('aria-label="新建项目">＋</button>');
    expect(projectArea).not.toContain('class="lit-btn" onclick="showNewProjectDialog()"');
    expect(projectArea).not.toContain('class="lit-btn" onclick="showProjectManagerDialog()"');
  });

  it('loads the project manager inside the sidebar instead of opening a manager modal', () => {
    const managerStart = projectUiSource.indexOf('async function showProjectManagerDialog()');
    const managerEnd = projectUiSource.indexOf('async function completeSidebarProjectManagerAction', managerStart);
    const managerBody = projectUiSource.slice(managerStart, managerEnd);

    expect(managerBody).toContain('revealSidebarProjectManagerPanel()');
    expect(managerBody).toContain('await loadSidebarProjectManager()');
    expect(managerBody).not.toContain("showModal('项目管理'");
    expect(managerBody).not.toContain('appendMessage(');
    expect(html).toContain("panelKey === 'projects' && !collapsed");
    expect(html).toContain('window.refreshSidebarProjectManager()');
  });

  it('shows and refreshes background Agent runs for every project', () => {
    expect(projectUiSource).toContain("fetch('/api/chat-bridge/pi/runs?userId='");
    expect(projectUiSource).toContain('getSidebarProjectActiveRuns(projectId)');
    expect(projectUiSource).toContain("normalized === 'codex'");
    expect(projectUiSource).toContain("normalized === 'pi'");
    expect(projectUiSource).toContain("normalized === 'opencode'");
    expect(projectUiSource).toContain('class="project-manager-running-dot"');
    expect(projectUiSource).toContain('scheduleSidebarProjectRunPolling()');
    expect(html).toContain('.project-manager-running-dot');
    expect(html).toContain('project-manager-running-pulse');
  });

  it('opens from the whole card and keeps clone, rename and delete as title icons', () => {
    expect(html).toContain('onclick="openSidebarProjectManagerCard(this)"');
    expect(html).toContain('onkeydown="handleSidebarProjectManagerCardKeydown(event,this)"');
    expect(html).toContain('confirmOpenArchivedProject(projectId, false, card)');
    expect(html).not.toContain('function showOpenProjectNameDialog');
    expect(html).not.toContain("'打开项目',");
    expect(html).toContain("'自动保存项目 ' + new Date().toLocaleString()");
    expect(html).toContain("sourceCard.classList.add('is-opening')");
    expect(html).toContain('class="project-manager-card-actions"');
    expect(html).toContain("uiIcon('clipboard')");
    expect(html).toContain("uiIcon('edit')");
    expect(html).toContain("uiIcon('trash')");
    expect(html).toContain('event.stopPropagation(); showCloneProjectDialog');
    expect(html).toContain('showCloneProjectDialog(this.dataset.projectId, this.dataset.projectName, this)');
    expect(html).toContain('showRenameProjectDialog(this.dataset.projectId, this.dataset.projectName, this)');
    expect(html).toContain('deleteArchivedProject(this.dataset.projectId, this.dataset.projectName)');
    expect(html).toContain('class="project-manager-current-dot"');
    expect(html).not.toContain('project-manager-current-badge');
    expect(html).not.toContain('class="project-manager-action is-primary"');
    expect(html).toMatch(/\.project-manager-card \{[\s\S]*?padding: 6px 7px 5px;/);
    expect(html).toMatch(/\.project-manager-current-dot \{[\s\S]*?background: var\(--theme-primary/);
    expect(html).toContain('completeSidebarProjectManagerAction(');
    expect(html).toContain('project-manager-status');
    expect(projectUiSource).toContain("statusState === 'success'");
    expect(projectUiSource).toContain('}, 2600);');
  });

  it('keeps project editing dialogs as compact sidebar-attached popovers', () => {
    expect(projectUiSource).toContain("modalClass: 'project-manager-popover'");
    expect(projectUiSource).toContain("overlayClass: 'project-manager-popover-overlay'");
    expect(projectUiSource).toContain("showProjectManagerPopover(\n        '复制项目'");
    expect(projectRuntimeSource).toContain("modalClass: 'project-manager-popover project-new-popover'");
    expect(projectRuntimeSource).toContain("overlayClass: 'project-manager-popover-overlay project-new-popover-overlay'");
    expect(projectRuntimeSource).not.toContain('当前项目的聊天记录、长期记忆、草稿、上传资料和检索索引会保存到独立项目目录。');
    expect(projectRuntimeSource).not.toContain('API 配置、模型配置、登录状态和软件设置会继续保留。');
    expect(settingsRuntimeSource).toContain("overlay.style.setProperty('--modal-anchor-top'");
    expect(popoverStyles).toMatch(/\.modal\.project-manager-popover \{[\s\S]*?max-width: 400px;/);
    expect(popoverStyles).toContain('border-radius: 0 12px 12px 0 !important;');
    expect(popoverStyles).toContain('.modal.project-manager-popover::before');
    expect(popoverStyles).toContain('.modal.project-manager-popover::after');
    expect(popoverStyles).toMatch(/\.project-new-popover-overlay \{[\s\S]*?padding-left: 5px;/);
    expect(popoverStyles).toMatch(/\.modal\.project-manager-popover\.project-new-popover \{[\s\S]*?border-radius: 12px !important;/);
    expect(popoverStyles).toMatch(/\.modal\.project-manager-popover\.project-new-popover \{[\s\S]*?padding: 16px 18px 14px;/);
    expect(popoverStyles).toMatch(/\.modal\.project-manager-popover\.project-new-popover \{[\s\S]*?backdrop-filter: blur\(22px\) saturate\(145%\);/);
    expect(popoverStyles).toMatch(/\.modal\.project-manager-popover\.project-new-popover \{[\s\S]*?inset 0 1px 0 rgba\(255, 255, 255, 0\.72\)/);
    expect(popoverStyles).toMatch(/\.project-new-popover \.modal-header \{[\s\S]*?margin-bottom: 9px;/);
  });
});
