import { describe, expect, it } from 'vitest';

import { readPublicStyleSource } from '../helpers/public-app-source';

const responsiveCss = readPublicStyleSource('styles/responsive.css');

describe('sentence claim search composer plus-button placement', () => {
  it('moves the plus button from top-left to bottom-left in the narrow composer', () => {
    // 窄屏（static 布局）下，加号按钮默认作为 flex column 首子元素显示在左上角。
    // 这里为句子论点检索输入框添加专项定位，将其固定到左下角。
    expect(responsiveCss).toContain(
      '.input-area-container.sentence-claim-input-area .upload-experiment-btn {',
    );
    expect(responsiveCss).toMatch(
      /\.input-area-container\.sentence-claim-input-area \.upload-experiment-btn\s*\{[\s\S]*?position: absolute !important;[\s\S]*?top: auto;[\s\S]*?bottom: 8px;[\s\S]*?\}/,
    );
  });

  it('keeps the plus button inside the narrow input area bounds', () => {
    expect(responsiveCss).toMatch(
      /\.input-area-container\.sentence-claim-input-area \.upload-experiment-btn\s*\{[\s\S]*?\bleft: 8px;[\s\S]*?\}/,
    );
  });
});