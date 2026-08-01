import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();
const chatBridgeRoute = readFileSync(path.resolve(__dirname, '../../src/server/routes/chat-bridge.ts'), 'utf-8');

describe('target venue peer review Skill UI', () => {
  it('shows the bundled review Skill with a target and official requirement search', () => {
    expect(html).toContain('id="targetVenuePeerReviewSkillCard"');
    expect(html).toContain('id="targetVenuePeerReviewVenue"');
    expect(html).toContain('id="targetVenuePeerReviewArticleType"');
    expect(html).toContain('id="targetVenuePeerReviewResearchBtn"');
    expect(html).toContain("'/target-venue-requirements'");
    expect(html).toContain('联网检索要求');
  });

  it('attaches the configured venue only for review intent', () => {
    expect(html).toContain('function isTargetVenuePeerReviewIntent(message)');
    expect(html).toContain('context.targetVenuePeerReview = await ensureTargetVenuePeerReviewContext(message)');
    expect(html).toContain("skillId: TARGET_VENUE_PEER_REVIEW_SKILL_ID");
    expect(html).toContain('用户本轮明确指定的目标优先于 Skill 界面的默认目标');
  });

  it('auto-loads the full bundled Skill before sending a review request', () => {
    expect(chatBridgeRoute).toContain('if (targetVenueReviewContext?.enabled)');
    expect(chatBridgeRoute).toContain("targetVenueReviewContext.skillId || 'scholar-harness-core:target-venue-peer-review'");
    expect(chatBridgeRoute).toContain('if (autoLoadedReviewSkill.ok && autoLoadedReviewSkill.content)');
    expect(chatBridgeRoute).toContain('context.autoAgentSkillPrompt = [');
    expect(chatBridgeRoute).toContain('上述内置 Skill 已由应用自动加载');
  });
});
