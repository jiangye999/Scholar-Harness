import { describe, expect, it } from 'vitest';

import {
  classifyDraftSection,
  createDynamicDraftChapter,
  findAllowedDraftChapter,
  includeCreatableCanonicalDraftChapters,
  normalizeAllowedDraftChapters,
  resolveAllowedDraftChapter,
  resolveDraftSaveTarget,
} from '../../src/utils/draft-section-classifier';

describe('draft-section-classifier', () => {
  it('uses a user-selected chapter as the strongest signal', () => {
    const result = classifyDraftSection({
      content: 'The treatment significantly increased soil N2O emissions (Fig. 2).',
      preferredSection: 'discussion',
    });

    expect(result.section).toBe('discussion');
    expect(result.source).toBe('preferred');
    expect(result.confidence).toBe(1);
  });

  it('uses an explicit chapter in the user query', () => {
    const result = classifyDraftSection({
      content: 'This paragraph should remain unchanged.',
      sourceQuery: '把这段更新到 Results 章节草稿。',
      declaredSection: 'introduction',
    });

    expect(result.section).toBe('results');
    expect(result.source).toBe('query-explicit');
  });

  it('recognizes quantitative figure reporting as results', () => {
    const result = classifyDraftSection({
      content: 'N2O emissions increased by 28.4% under R1 and were significantly higher than R3 (P < 0.05; Fig. 2a). The mean flux reached 3.6 mg m-2 h-1.',
      declaredSection: 'introduction',
    });

    expect(result.section).toBe('results');
    expect(result.confidence).toBeGreaterThanOrEqual(0.58);
  });

  it('recognizes mechanism and literature comparison as discussion', () => {
    const result = classifyDraftSection({
      content: 'The increase may be attributed to greater substrate availability. This mechanism is consistent with previous studies and suggests an important implication for irrigation management.',
      declaredSection: 'results',
    });

    expect(result.section).toBe('discussion');
    expect(result.confidence).toBeGreaterThanOrEqual(0.58);
  });

  it('uses an explicit content heading before an AI declaration', () => {
    const result = classifyDraftSection({
      content: '## Materials and Methods\nSoil samples were collected from three replicated plots.',
      declaredSection: 'results',
    });

    expect(result.section).toBe('methods');
    expect(result.source).toBe('content-heading');
  });

  it('does not default ambiguous prose to introduction', () => {
    const result = classifyDraftSection({
      content: 'The manuscript text was revised for clarity and consistency.',
      declaredSection: 'introduction',
    });

    expect(result.section).toBeNull();
    expect(result.source).toBe('ambiguous');
  });
});

describe('draft chapter whitelist', () => {
  const chapters = normalizeAllowedDraftChapters([
    { key: 'introduction', title: 'Introduction' },
    { key: 'results', title: '3. Results' },
    { key: 'discussion', title: 'Discussion' },
  ]);

  it('maps a classified section only to an existing chapter', () => {
    expect(resolveAllowedDraftChapter({ chapters, classifiedSection: 'results' })?.target.key).toBe('results');
    expect(resolveAllowedDraftChapter({ chapters, classifiedSection: 'methods' })).toBeNull();
  });

  it('does not accept an AI-invented chapter key', () => {
    expect(findAllowedDraftChapter(chapters, 'results_33')).toBeNull();
    expect(resolveAllowedDraftChapter({
      chapters,
      classifiedSection: 'results',
      declaredChapter: 'results_33',
    })?.target.key).toBe('results');
  });

  it('honors an explicitly selected existing custom chapter', () => {
    const custom = normalizeAllowedDraftChapters([
      ...chapters,
      { key: 'mechanism_analysis', title: 'Mechanism analysis' },
    ]);
    const resolved = resolveAllowedDraftChapter({
      chapters: custom,
      preferredChapter: 'mechanism_analysis',
    });
    expect(resolved?.target.key).toBe('mechanism_analysis');
    expect(resolved?.source).toBe('preferred');
  });

  it('does not expose numbered subsections as top-level save targets', () => {
    const normalized = normalizeAllowedDraftChapters([
      { key: 'results', title: '3. Results' },
      { key: '3_3_summer_maize', title: '3.3 Summer maize emissions' },
      { key: 'discussion', title: '4. Discussion' },
    ]);

    expect(normalized.map(chapter => chapter.key)).toEqual(['results', 'discussion']);
  });

  it('adds missing canonical chapters as AI-creatable save targets', () => {
    const creatable = includeCreatableCanonicalDraftChapters([
      { key: 'results', title: '3. Results' },
    ]);

    expect(resolveAllowedDraftChapter({
      chapters: creatable,
      classifiedSection: 'discussion',
    })?.target).toMatchObject({
      key: 'discussion',
      title: 'Discussion',
    });
    expect(creatable.filter(chapter => chapter.canonicalSection === 'results')).toHaveLength(1);
  });

  it('automatically resolves and creates a missing Discussion chapter', () => {
    const chapters = includeCreatableCanonicalDraftChapters([
      { key: 'results', title: 'Results' },
    ]);
    const resolution = resolveDraftSaveTarget({
      chapters,
      content: 'This response may be attributed to soil moisture and is consistent with previous studies.',
      sourceQuery: '保存这段内容',
      declaredChapter: 'discussion',
      declaredConfidence: 0.9,
    });

    expect(resolution).toMatchObject({
      target: { key: 'discussion' },
      source: 'ai-declared',
    });
  });

  it('lets a manual lock override a conflicting AI declaration', () => {
    const chapters = includeCreatableCanonicalDraftChapters([]);
    const resolution = resolveDraftSaveTarget({
      chapters,
      content: 'The values differed significantly among treatments (Fig. 2).',
      sourceQuery: '保存这段',
      preferredChapter: 'discussion',
      declaredChapter: 'results',
      declaredConfidence: 0.95,
    });

    expect(resolution).toMatchObject({
      target: { key: 'discussion' },
      source: 'manual-lock',
      confidence: 1,
    });
  });

  it('creates a meaningful new top-level chapter requested by the writing plan', () => {
    const resolution = resolveDraftSaveTarget({
      chapters: includeCreatableCanonicalDraftChapters([]),
      content: 'These findings have several implications for adaptive nitrogen management.',
      sourceQuery: '新建 Implications 章节并保存这段内容',
      declaredChapter: 'implications',
      declaredTitle: 'Implications',
      declaredConfidence: 0.94,
    });

    expect(resolution).toMatchObject({
      target: { key: 'implications', title: 'Implications', canonicalSection: null },
      source: 'dynamic-created',
    });
  });

  it('rejects generic keys and numbered subsection keys as dynamic chapters', () => {
    expect(createDynamicDraftChapter('section')).toBeNull();
    expect(createDynamicDraftChapter('results_33')).toBeNull();
    expect(createDynamicDraftChapter('3.3 Summer maize')).toBeNull();
  });
});
