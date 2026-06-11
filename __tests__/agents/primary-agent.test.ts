import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrimaryAgent } from '../../agents/primary-agent';

vi.mock('../../src/server/services/academic-research-skills', () => ({
  runAcademicResearchSkill: vi.fn().mockResolvedValue({
    provider: 'mock',
    content: 'Mock multi-review report',
  }),
}));

describe('PrimaryAgent', () => {
  let agent: PrimaryAgent;
const mockApiClient = {
    chat: vi.fn().mockResolvedValue('{"sectionName":"test","userWritingFocus":"test focus","userKeyPoints":[],"styleGuideContent":"","overallStructure":{"paragraphCount":1,"mainSections":[],"transitionStrategy":""},"paragraphDetails":[],"executionInstructions":[]}'),
  };

  beforeEach(() => {
    agent = new PrimaryAgent(mockApiClient as any, 'claude-sonnet-4-5');
  });

  it('should create agent with default model', () => {
    expect(agent).toBeDefined();
  });

  it('should generate skill from user plan', async () => {
    const input = {
      chapterName: 'introduction',
      userPlan: {
        chapterName: 'introduction',
        writingFocus: 'Test focus',
        keyPoints: ['Point 1', 'Point 2'],
      },
      styleGuide: 'Test style guide',
      researchContent: 'Test research content',
    };

    const skill = await agent.generateSkill(input);
    expect(skill).toHaveProperty('sectionName');
  });

  it('should handle quality check', async () => {
    const content = 'Test content';
    const styleGuide = 'Test style';
    const chapterPlan = {
      chapterName: 'introduction',
      writingFocus: 'Focus',
      keyPoints: [],
    };

    const result = await agent.qualityCheck(content, styleGuide, chapterPlan);
    expect(typeof result).toBe('string');
  });
});
