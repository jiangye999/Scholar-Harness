import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUTO_RESEARCH_STAGE_IDS, AutoResearchManager } from '../../src/utils/autoresearch-manager';
import type { PdfWikiStore } from '../../src/utils/pdf-wiki-manager';

function createPdfWikiStore(withCitation = true): PdfWikiStore {
  return {
    version: 1,
    userId: 'web-user',
    generatedAt: '2026-05-27T09:00:00.000Z',
    pdfs: [{
      id: 'pdf-1',
      originalName: 'source-paper.pdf',
      fileName: 'source-paper.pdf',
      filePath: 'source-paper.pdf',
      size: 1024,
      title: 'Source Paper',
      authors: 'Doe et al.',
      year: '2026',
      journal: 'Soil',
      doi: '10.1000/source',
    }],
    referenceIndex: withCitation ? [{
      id: 'ref-1',
      raw: 'Doe J. 2026. Source Paper. Soil.',
      sourcePdfId: 'pdf-1',
      sourcePdfName: 'source-paper.pdf',
      index: 1,
      title: 'Source Paper',
      authors: 'Doe J.',
      year: '2026',
      journal: 'Soil',
      doi: '10.1000/source',
    }] : [],
    entries: [{
      id: 'claim-1',
      groupId: 'group-1',
      claim: 'Soil nitrogen retention improves yield stability',
      normalizedClaim: 'Soil nitrogen retention improves yield stability',
      sourcePdfIds: ['pdf-1'],
      sourcePdfNames: ['source-paper.pdf'],
      sections: ['Discussion'],
      pro: [{
        stance: 'support',
        summary: 'Higher retention is linked to more stable yields.',
        evidence: 'Higher retention reduced interannual yield variability in the field experiment.',
        section: 'Discussion',
        location: 'pages 4-5',
        inTextCitations: withCitation ? ['Doe et al., 2026'] : [],
        evidenceSentenceIds: ['discussion:s1'],
        evidenceSentences: ['Higher retention reduced interannual yield variability in the field experiment.'],
        references: withCitation ? [{
          id: 'ref-1',
          raw: 'Doe J. 2026. Source Paper. Soil.',
          sourcePdfId: 'pdf-1',
          sourcePdfName: 'source-paper.pdf',
          index: 1,
          title: 'Source Paper',
          authors: 'Doe J.',
          year: '2026',
          journal: 'Soil',
          doi: '10.1000/source',
        }] : [],
        sourcePdfId: 'pdf-1',
        sourcePdfName: 'source-paper.pdf',
      }],
      con: [],
      neutral: [],
      inTextCitations: withCitation ? ['Doe et al., 2026'] : [],
      evidenceSentenceIds: ['discussion:s1'],
      references: withCitation ? [{
        id: 'ref-1',
        raw: 'Doe J. 2026. Source Paper. Soil.',
        sourcePdfId: 'pdf-1',
        sourcePdfName: 'source-paper.pdf',
        index: 1,
        title: 'Source Paper',
        authors: 'Doe J.',
        year: '2026',
        journal: 'Soil',
        doi: '10.1000/source',
      }] : [],
      evidenceSnippets: ['Higher retention reduced interannual yield variability in the field experiment.'],
      updatedAt: '2026-05-27T09:00:00.000Z',
    }],
  };
}

describe('AutoResearchManager', () => {
  let tempDir: string;
  let manager: AutoResearchManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoresearch-manager-'));
    manager = new AutoResearchManager(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('starts a long-running task with the autonomous research stages and replay log', async () => {
    const state = await manager.startTask('web-user', {
      title: 'Rice mitigation review',
      topic: 'Rice farming N2O mitigation',
      project: { projectId: 'project-test', projectName: 'Test Project' },
    });

    expect(state.task.title).toBe('Rice mitigation review');
    expect(state.task.topic).toBe('Rice farming N2O mitigation');
    expect(state.task.stages.map(stage => stage.id)).toEqual([...AUTO_RESEARCH_STAGE_IDS]);
    expect(state.operations[0].kind).toBe('autoresearch.start');
    expect(state.operations[0].replayFile).toBeTruthy();
    expect(fs.existsSync(path.join(tempDir, 'autoresearch', 'web-user', state.operations[0].replayFile!))).toBe(true);
  });

  it('syncs PDF Wiki claims into traceable evidence objects', async () => {
    const result = await manager.syncPdfWikiStore('web-user', createPdfWikiStore(), {
      projectId: 'project-test',
      projectName: 'Test Project',
    });

    expect(result.snapshot.evidenceObjectCount).toBe(1);
    expect(result.snapshot.added).toBe(1);
    expect(result.state.evidenceLibrary.objects).toHaveLength(1);
    const evidence = result.state.evidenceLibrary.objects[0];
    expect(evidence.claimId).toBe('claim-1');
    expect(evidence.stance).toBe('support');
    expect(evidence.sourcePdfId).toBe('pdf-1');
    expect(evidence.references[0].doi).toBe('10.1000/source');
    expect(evidence.trace.sourceUri).toBe('pdf-wiki://web-user/entries/claim-1');
    expect(result.state.projectMemory[0].kind).toBe('evidence');
  });

  it('rebuilds an ARIS-style research wiki graph from literature and evidence', async () => {
    await manager.startTask('web-user', {
      title: 'Rice mitigation review',
      topic: 'Rice farming N2O mitigation',
      project: { projectId: 'project-test', projectName: 'Test Project' },
    });
    await manager.syncPdfWikiStore('web-user', createPdfWikiStore(), {
      projectId: 'project-test',
      projectName: 'Test Project',
    });

    const result = await manager.rebuildResearchWiki('web-user', {
      projectId: 'project-test',
      projectName: 'Test Project',
    });

    expect(result.wiki.nodes.some(node => node.type === 'paper')).toBe(true);
    expect(result.wiki.nodes.some(node => node.type === 'claim')).toBe(true);
    expect(result.wiki.edges.some(edge => edge.type === 'supports')).toBe(true);
    expect(result.wiki.queryPack).toContain('Core claims');
    expect(result.state.researchWiki.nodes.length).toBe(result.wiki.nodes.length);
    expect(result.state.operations[0].kind).toBe('autoresearch.research_wiki.rebuild');
  });

  it('runs deterministic citation and claim audit over the research wiki', async () => {
    await manager.syncPdfWikiStore('web-user', createPdfWikiStore(false), {
      projectId: 'project-test',
      projectName: 'Test Project',
    });
    await manager.rebuildResearchWiki('web-user', {
      projectId: 'project-test',
      projectName: 'Test Project',
    });

    const result = await manager.runAudit('web-user', {
      projectId: 'project-test',
      projectName: 'Test Project',
    });

    expect(result.report.verdict).not.toBe('pass');
    expect(result.report.findings.some(finding => finding.category === 'citation' && finding.level !== 'pass')).toBe(true);
    expect(result.report.trace.wikiNodeCount).toBeGreaterThan(0);
    expect(result.state.auditReports[0].id).toBe(result.report.id);
    expect(result.state.operations[0].kind).toBe('autoresearch.audit');
  });

  it('syncs embedding literature records into the AutoResearch literature map', async () => {
    const result = await manager.syncEmbeddingLibrary('web-user', [
      {
        id: 'paper-1',
        title: 'Nitrogen cycling in rice systems',
        author: 'Liao K.',
        year: 2021,
        journal: 'Soil',
        doi: '10.1000/ncycle',
        abstract: 'A synthesis of nitrogen cycling indicators.',
        keywords: ['nitrogen cycling', 'soil delta 15N'],
        aiKeywords: ['rice systems'],
        documentType: 'Article',
        embedding: [0.1, 0.2, 0.3],
      },
      {
        id: 'paper-2',
        title: 'Methane mitigation by water management',
        author: 'Chen Y.',
        year: 2024,
        journal: 'Agriculture',
        keywords: ['methane mitigation', 'water management'],
        aiKeywords: ['rice systems'],
        documentType: 'Review',
      },
      {
        id: 'pdf-record',
        title: 'Uploaded PDF should stay in PDF Wiki',
        isPdf: true,
      },
    ], {
      mergedTags: [{
        name: 'rice n cycling',
        originalKeywords: ['nitrogen cycling', 'rice systems'],
        count: 0,
        literatureIds: ['paper-1', 'paper-2'],
      }],
      promotedTags: [],
    }, {
      projectId: 'project-test',
      projectName: 'Test Project',
    });

    expect(result.snapshot.literatureCount).toBe(2);
    expect(result.snapshot.embeddingCount).toBe(1);
    expect(result.state.literatureMap.nodes).toHaveLength(2);
    expect(result.state.literatureMap.nodes[0].trace.sourceType).toBe('embedding-library');
    expect(result.state.literatureMap.tags.some(tag => tag.kind === 'mergedTag' && tag.count === 2)).toBe(true);
    expect(result.state.task.currentStageId).toBe('literature_map');
    expect(result.state.task.stages.find(stage => stage.id === 'literature_map')?.status).toBe('done');
    expect(result.state.operations[0].kind).toBe('autoresearch.embedding_library.sync');
    expect(result.state.projectMemory[0].source).toBe('embedding-library-sync');
  });

  it('evaluates citation alignment and reproducibility from stored evidence', async () => {
    await manager.syncPdfWikiStore('web-user', createPdfWikiStore(false), {
      projectId: 'project-test',
      projectName: 'Test Project',
    });

    const result = await manager.evaluate('web-user', {
      projectId: 'project-test',
      projectName: 'Test Project',
    });

    const citationMetric = result.report.metrics.find(metric => metric.id === 'citation_alignment');
    expect(citationMetric?.level).toBe('warn');
    expect(result.report.issues.some(issue => issue.includes('证据缺少引用'))).toBe(true);
    expect(result.state.operations[0].kind).toBe('autoresearch.self_evaluation');
    expect(result.state.evaluations[0].id).toBe(result.report.id);
  });

  it('uses embedding abstracts as paper-level evidence when PDF Wiki evidence is absent', async () => {
    await manager.startTask('web-user', {
      title: 'Nitrogen fertilizer N2O review',
      topic: '不同氮肥管理措施对华北农田N2O排放的影响及其机理',
      project: { projectId: 'project-test', projectName: 'Test Project' },
    });
    await manager.syncEmbeddingLibrary('web-user', [{
      id: 'paper-n2o-1',
      title: 'Nitrogen fertilizer management reduces N2O emissions in North China Plain croplands',
      author: 'Zhang L.',
      year: 2025,
      journal: 'Agriculture Ecosystems and Environment',
      doi: '10.1000/n2o-fertilizer',
      abstract: 'Optimized nitrogen fertilizer timing and reduced application rates lowered nitrous oxide emissions in North China Plain wheat-maize croplands while maintaining crop yield. The mitigation effect was linked to lower nitrate accumulation and reduced denitrification potential after rainfall.',
      keywords: ['nitrogen fertilizer', 'N2O emissions', 'North China Plain'],
      aiKeywords: ['denitrification', 'cropland'],
      documentType: 'Article',
      embedding: [0.1, 0.2, 0.3],
    }], { mergedTags: [], promotedTags: [] }, {
      projectId: 'project-test',
      projectName: 'Test Project',
    });

    const evaluation = await manager.evaluate('web-user', {
      projectId: 'project-test',
      projectName: 'Test Project',
    });

    const citationMetric = evaluation.report.metrics.find(metric => metric.id === 'citation_alignment');
    const sufficiencyMetric = evaluation.report.metrics.find(metric => metric.id === 'evidence_sufficiency');
    expect(citationMetric?.level).toBe('pass');
    expect(citationMetric?.summary).toContain('embedding 摘要证据 1 个');
    expect(sufficiencyMetric?.summary).toContain('1 个论点组');

    const final = await manager.generateFinalReport('web-user', {
      projectId: 'project-test',
      projectName: 'Test Project',
    });

    expect(final.report.title).toContain('摘要证据分析');
    expect(final.report.trace.evidenceObjectCount).toBe(1);
    expect(final.report.trace.pdfWikiEvidenceObjectCount).toBe(0);
    expect(final.report.trace.embeddingEvidenceObjectCount).toBe(1);
    expect(final.report.evidenceSynthesis[0].claim).toContain('Nitrogen fertilizer management');
    expect(final.report.limitations.some(item => item.includes('embedding 文献摘要'))).toBe(true);
  });

  it('generates a final AutoResearch report from literature, evidence, and evaluation state', async () => {
    await manager.startTask('web-user', {
      title: 'Rice mitigation review',
      topic: 'Rice farming N2O mitigation',
      project: { projectId: 'project-test', projectName: 'Test Project' },
    });
    await manager.syncEmbeddingLibrary('web-user', [{
      id: 'paper-1',
      title: 'Nitrogen mitigation in rice systems',
      author: 'Doe J.',
      year: 2025,
      journal: 'Soil',
      keywords: ['nitrogen mitigation', 'rice systems'],
      aiKeywords: ['greenhouse gas'],
      embedding: [0.1, 0.2],
    }], { mergedTags: [], promotedTags: [] }, {
      projectId: 'project-test',
      projectName: 'Test Project',
    });
    await manager.syncPdfWikiStore('web-user', createPdfWikiStore(), {
      projectId: 'project-test',
      projectName: 'Test Project',
    });
    await manager.evaluate('web-user', {
      projectId: 'project-test',
      projectName: 'Test Project',
    });

    const result = await manager.generateFinalReport('web-user', {
      projectId: 'project-test',
      projectName: 'Test Project',
    });

    expect(result.report.topic).toBe('Rice farming N2O mitigation');
    expect(result.report.hypotheses.length).toBeGreaterThan(0);
    expect(result.report.experimentPlan.length).toBeGreaterThan(0);
    expect(result.report.trace.literatureNodeCount).toBe(1);
    expect(result.report.trace.evidenceObjectCount).toBe(2);
    expect(result.report.trace.pdfWikiEvidenceObjectCount).toBe(1);
    expect(result.report.trace.embeddingEvidenceObjectCount).toBe(1);
    expect(result.state.finalReports[0].id).toBe(result.report.id);
    expect(result.state.task.status).toBe('completed');
    expect(result.state.operations[0].kind).toBe('autoresearch.final_report');

    const draft = await manager.generatePaperDraft('web-user', {
      reportId: result.report.id,
      project: { projectId: 'project-test', projectName: 'Test Project' },
    });
    expect(draft.draft.markdown).toContain('## 摘要');
    expect(draft.draft.markdown).toContain('## 参考文献');
    expect(draft.draft.referenceCount).toBeGreaterThan(0);
    expect(draft.draft.trace.finalReportId).toBe(result.report.id);
    expect(draft.state.paperDrafts[0].id).toBe(draft.draft.id);
    expect(draft.state.operations[0].kind).toBe('autoresearch.paper_draft');

    const editedDraft = await manager.updatePaperDraftMarkdown('web-user', {
      draftId: draft.draft.id,
      markdown: '# Edited Paper Draft\n\n用户修订论文内容',
      project: { projectId: 'project-test', projectName: 'Test Project' },
    });
    expect(editedDraft.draft.editedMarkdown).toContain('用户修订论文内容');
    expect(editedDraft.draft.wordCountEstimate).toBeGreaterThan(0);
    expect(editedDraft.state.operations[0].kind).toBe('autoresearch.paper_draft.edit');

    const edited = await manager.updateFinalReportMarkdown('web-user', {
      reportId: result.report.id,
      markdown: '# Edited AutoResearch Report\n\n用户修订内容',
      project: { projectId: 'project-test', projectName: 'Test Project' },
    });
    expect(edited.report.editedMarkdown).toContain('用户修订内容');
    expect(edited.report.editedAt).toBeTruthy();
    expect(edited.state.operations[0].kind).toBe('autoresearch.final_report.edit');
  });

  it('deletes selected completed task records without deleting final reports', async () => {
    const project = { projectId: 'project-test', projectName: 'Test Project' };
    await manager.startTask('web-user', {
      title: 'Rice mitigation review',
      topic: 'Rice farming N2O mitigation',
      project,
    });
    const final = await manager.generateFinalReport('web-user', project);
    const recordId = final.state.completedTaskRecords[0]?.id;

    expect(recordId).toBeTruthy();
    expect(final.state.completedTaskRecords).toHaveLength(1);
    expect(final.state.finalReports).toHaveLength(1);

    const deleted = await manager.deleteCompletedTaskRecords('web-user', {
      recordIds: [recordId!],
      project,
    });

    expect(deleted.deletedCount).toBe(1);
    expect(deleted.deletedRecordIds).toEqual([recordId]);
    expect(deleted.state.completedTaskRecords).toHaveLength(0);
    expect(deleted.state.finalReports).toHaveLength(1);
    expect(deleted.state.operations[0].kind).toBe('autoresearch.completed_task_records.delete');

    const reloaded = await manager.getState('web-user', project);
    expect(reloaded.completedTaskRecords).toHaveLength(0);
    expect(reloaded.finalReports).toHaveLength(1);
  });
});
