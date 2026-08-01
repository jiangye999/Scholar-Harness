import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const source = readPublicAppSource();

describe('user Skill form navigation', () => {
  it('uses bordered form actions and removes the standalone return button', () => {
    expect(source).toContain('class="user-skill-form-action user-skill-form-delete"');
    expect(source).toContain('class="user-skill-form-action user-skill-form-save"');
    expect(source).toContain('.user-skill-form-action {');
    expect(source).not.toContain(
      '<button class="cancel" onclick="showMainContextSkillDialog()">返回 Skill</button>',
    );
  });

  it('returns to the complete Skill page after a successful save', () => {
    const saveStart = source.indexOf('async function saveUserSkillFromDialog()');
    const saveEnd = source.indexOf('window.saveUserSkillFromDialog = saveUserSkillFromDialog;');
    const saveSource = source.slice(saveStart, saveEnd);

    expect(saveStart).toBeGreaterThan(-1);
    expect(saveSource).toContain('await showMainContextSkillDialog();');
    expect(saveSource).not.toContain("renderUserSkillManager(data.skill?.id || '')");
  });

  it('lets users delete custom Skills directly from the persistent Skill catalog', () => {
    expect(source).toContain('onclick="deleteUserSkillFromMainContext(this.dataset.skillId, this.dataset.skillName)"');
    expect(source).toContain('window.deleteUserSkillFromMainContext = async function(skillId, skillName)');
    expect(source).toContain("data.deleted === false");
    expect(source).toContain("parsed.kind !== 'user' || String(parsed.id || '') !== String(skillId)");
    expect(source).toContain('renderMainContextSkillDialog();');
  });
});
