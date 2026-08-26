import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_RULE_INDEX,
  WORKSPACE_RULE_KEYS_PROMPT,
  getWorkspaceRuleContent,
} from '../../../src/server/services/workspace-rule-index';

describe('workspace rule index (prompt slimming)', () => {
  it('exposes known rule keys with titles and content', () => {
    for (const key of ['workspace_scope', 'safe_workspace', 'office_tools', 'docx_fonts', 'read_file_window', 'powershell_syntax', 'search_followup', 'legacy_block']) {
      expect(WORKSPACE_RULE_INDEX[key]).toBeDefined();
      expect(WORKSPACE_RULE_INDEX[key].title.length).toBeGreaterThan(0);
      expect(WORKSPACE_RULE_INDEX[key].content.length).toBeGreaterThan(0);
    }
  });

  it('returns content for a known key and null for unknown keys', () => {
    expect(getWorkspaceRuleContent('office_tools')).toContain('Office');
    expect(getWorkspaceRuleContent('nope')).toBeNull();
    expect(getWorkspaceRuleContent('')).toBeNull();
  });

  it('builds a compact index prompt listing every key', () => {
    expect(WORKSPACE_RULE_KEYS_PROMPT).toContain('read_workspace_rule');
    for (const key of Object.keys(WORKSPACE_RULE_INDEX)) {
      expect(WORKSPACE_RULE_KEYS_PROMPT).toContain(key);
    }
  });
});
