import { describe, expect, it } from 'vitest';

import {
  buildMultimodalIntentClassifierPrompt,
  buildMultimodalIntentPromptBlock,
  normalizeMultimodalIntent,
  parseMultimodalIntentResponse,
} from '../../../src/server/services/multimodal-intent';

describe('multimodal intent orchestration', () => {
  it('turns vision output into a follow-up workspace analysis plan', () => {
    const intent = parseMultimodalIntentResponse(JSON.stringify({
      primaryIntent: 'workspace_data_analysis',
      imageRole: 'visual_reference',
      dataSource: 'workspace',
      requiresFollowupAction: true,
      requestedActions: ['search workspace data', 'run PCA', 'generate a matching plot'],
      requestedMethods: ['PCA'],
      imageFindings: 'The reference uses two treatment groups and a score plot.',
      visualRequirements: 'Rename panel A to Spr_O and panel B to Sum_O.',
      executionInstruction: 'Read the workspace dataset, run PCA, and reproduce the visual logic.',
      routingReason: 'The image specifies the plot while the workspace supplies the data.',
      confidence: 0.96,
    }));

    expect(intent.visionAnalyzed).toBe(true);
    expect(intent.imageRole).toBe('visual_reference');
    expect(intent.dataSource).toBe('workspace');
    expect(intent.requiresFollowupAction).toBe(true);
    expect(intent.requestedActions).toContain('run PCA');

    const promptBlock = buildMultimodalIntentPromptBlock(intent);
    expect(promptBlock).toContain('视觉分析只是中间结果，不是本轮最终答案');
    expect(promptBlock).toContain('立即结合 CURRENT_USER_REQUEST');
    expect(promptBlock).toContain('必须实际搜索、读取并核对数据文件');
  });

  it('keeps a non-JSON AI analysis usable and requires the execution stage to continue', () => {
    const intent = parseMultimodalIntentResponse('The image is a PCA visual reference with two seasonal groups.');

    expect(intent.visionAnalyzed).toBe(true);
    expect(intent.primaryIntent).toBe('other');
    expect(intent.requiresFollowupAction).toBe(true);
    expect(intent.imageFindings).toContain('PCA visual reference');
  });

  it('builds a classifier prompt that treats the image analysis as an intermediate step', () => {
    const prompt = buildMultimodalIntentClassifierPrompt({
      message: '参考这张图，用工作目录的数据继续做 PCA。',
      attachments: [{ name: 'reference.png', type: 'image' }],
      workspaceRoot: 'E:\\research\\dataset',
    });

    expect(prompt).toContain('图片分析只是中间步骤');
    expect(prompt).toContain('参考这张图，用工作目录的数据继续做 PCA。');
    expect(prompt).toContain('configured_root: E:\\research\\dataset');
    expect(prompt).toContain('requiresFollowupAction 必须为 true');
  });

  it('rejects unverified frontend intent objects', () => {
    expect(normalizeMultimodalIntent({ primaryIntent: 'workspace_data_analysis' })).toBeNull();
  });
});
