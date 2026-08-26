import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createDailyPapersRouter } from '../../src/server/routes/daily-papers';
import {
  DailyPaperManager,
  type DailyPaperRecommendation,
} from '../../src/server/services/daily-paper-manager';

const paper: DailyPaperRecommendation = {
  id: 'doi:10.1000/daily-test',
  title: 'Daily paper import test',
  authors: ['Test Author'],
  abstract: 'An abstract that can be imported into the embedding library.',
  abstractZh: '可入库的测试摘要。',
  publishedAt: '2026-08-25',
  url: 'https://example.test/paper',
  pdfUrl: 'https://example.test/paper.pdf',
  category: 'Test Science',
  sources: ['test'],
  hfUpvotes: 0,
  score: 10,
  doi: '10.1000/daily-test',
  tier: 'must_read',
  reason: 'Test reason',
  relevance: 'Test relevance',
  caution: 'Test caution',
};

function createApp(targetPaper: DailyPaperRecommendation | null = paper) {
  const saveFeedback = vi.fn(async (_userId, paperId, decision) => ({
    paperId,
    decision,
    title: paper.title,
    updatedAt: '2026-08-25T00:00:00.000Z',
  }));
  const saveLibraryState = vi.fn(async (_userId, _paperId, _target, state) => ({
    ...state,
    updatedAt: '2026-08-25T00:00:00.000Z',
  }));
  const manager = {
    getRecommendation: vi.fn(async () => targetPaper),
    saveFeedback,
    saveLibraryState,
  } as unknown as DailyPaperManager;
  const addToPdfLibrary = vi.fn(async () => ({
    status: 'queued' as const,
    message: 'PDF 已加入队列。',
    duplicate: false,
    details: { addedPdfs: 1 },
  }));
  const addToEmbeddingLibrary = vi.fn(async () => ({
    status: 'included' as const,
    message: '文献已入库。',
    duplicate: false,
  }));
  const runInProject = vi.fn(async <T>(projectId: string, operation: () => Promise<T>) => ({
    value: await operation(),
    projectId,
    projectName: 'Selected Project',
  }));
  const app = express();
  app.use(express.json());
  app.use('/api/daily-papers', createDailyPapersRouter(manager, {
    addToPdfLibrary,
    addToEmbeddingLibrary,
    runInProject,
  }));
  return { app, addToPdfLibrary, addToEmbeddingLibrary, runInProject, saveFeedback, saveLibraryState };
}

describe('daily paper routes', () => {
  it('rejects the removed later feedback type', async () => {
    const test = createApp();
    const response = await request(test.app)
      .post('/api/daily-papers/feedback')
      .send({ paperId: paper.id, decision: 'later' })
      .expect(400);

    expect(test.saveFeedback).not.toHaveBeenCalled();
    expect(response.body.error.code).toBe('DAILY_PAPER_FEEDBACK_INVALID');
  });

  it('dispatches PDF imports and persists the returned card state', async () => {
    const test = createApp();
    const response = await request(test.app)
      .post('/api/daily-papers/library')
      .send({
        userId: 'researcher@example.com',
        paperId: paper.id,
        target: 'pdf',
        projectId: 'project-test-1',
      })
      .expect(200);

    expect(test.runInProject).toHaveBeenCalledWith('project-test-1', expect.any(Function));
    expect(test.addToPdfLibrary).toHaveBeenCalledWith('researcher@example.com', paper);
    expect(test.addToEmbeddingLibrary).not.toHaveBeenCalled();
    expect(test.saveLibraryState).toHaveBeenCalledWith(
      'researcher@example.com',
      paper.id,
      'pdf',
      expect.objectContaining({
        status: 'queued',
        duplicate: false,
        projectId: 'project-test-1',
        projectName: 'Selected Project',
      }),
    );
    expect(response.body).toMatchObject({
      success: true,
      target: 'pdf',
      project: { projectId: 'project-test-1', name: 'Selected Project' },
      libraryState: {
        status: 'queued',
        message: 'PDF 已加入队列。',
        projectId: 'project-test-1',
        projectName: 'Selected Project',
      },
      details: { addedPdfs: 1 },
    });
  });

  it('requires an explicit existing project selection before importing', async () => {
    const test = createApp();
    const response = await request(test.app)
      .post('/api/daily-papers/library')
      .send({ paperId: paper.id, target: 'embedding' })
      .expect(400);

    expect(test.runInProject).not.toHaveBeenCalled();
    expect(test.addToEmbeddingLibrary).not.toHaveBeenCalled();
    expect(response.body.error.code).toBe('DAILY_PAPER_PROJECT_REQUIRED');
  });

  it('rejects unknown papers before an import handler is called', async () => {
    const test = createApp(null);
    const response = await request(test.app)
      .post('/api/daily-papers/library')
      .send({ paperId: 'missing', target: 'embedding', projectId: 'project-test-1' })
      .expect(404);

    expect(test.addToEmbeddingLibrary).not.toHaveBeenCalled();
    expect(response.body.error.code).toBe('DAILY_PAPER_NOT_FOUND');
  });
});
