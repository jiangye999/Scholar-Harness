import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PiAgentSessionManager } from '../../../src/server/services/pi-agent-session';
import { clearPathCache } from '../../../src/utils/paths';

describe('Pi agent session queue', () => {
  let dataDir = '';
  let previousDataDir: string | undefined;

  beforeEach(() => {
    previousDataDir = process.env.DATA_DIR;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-pi-session-'));
    process.env.DATA_DIR = dataDir;
    clearPathCache();
  });

  afterEach(() => {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    clearPathCache();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('delivers steering before follow-up and only one message at a time', () => {
    const manager = new PiAgentSessionManager();
    manager.enqueue({
      userId: 'user-1',
      conversationId: 'conversation-1',
      message: '完成后再总结一次。',
      behavior: 'follow_up',
    });
    const steer = manager.enqueue({
      userId: 'user-1',
      conversationId: 'conversation-1',
      message: '先改成机制解释，再继续。',
      behavior: 'steer',
    });

    const run = manager.beginRun('user-1', 'conversation-1', 'codex');
    expect(run.accepted).toBe(true);
    expect(manager.beginRun('user-1', 'conversation-1', 'codex').accepted).toBe(false);

    const steering = manager.takeSteeringMessages('user-1', 'conversation-1');
    expect(steering.map(item => item.id)).toEqual([steer.id]);
    expect(manager.takeSteeringMessages('user-1', 'conversation-1')).toEqual([]);
    manager.markApplied('user-1', 'conversation-1', steer.id, 'steered');
    manager.settleRun('user-1', 'conversation-1', run.runId);

    const next = manager.claimNextForContinuation('user-1', 'conversation-1');
    expect(next?.behavior).toBe('follow_up');
    expect(next?.message).toContain('总结');
  });

  it('runs the same conversation id independently in two projects', () => {
    const manager = new PiAgentSessionManager();
    const projectA = 'project-20260819000100-aaaaaa';
    const projectB = 'project-20260819000200-bbbbbb';

    const runA = manager.beginRun('user-project', 'shared-conversation', 'codex', projectA);
    const runB = manager.beginRun('user-project', 'shared-conversation', 'pi', projectB);
    expect(runA.accepted).toBe(true);
    expect(runB.accepted).toBe(true);
    expect(runA.runId).not.toBe(runB.runId);

    manager.enqueue({
      userId: 'user-project',
      projectId: projectA,
      conversationId: 'shared-conversation',
      message: '只属于项目 A',
      behavior: 'follow_up',
    });
    expect(manager.getState('user-project', 'shared-conversation', projectA).pendingMessageCount).toBe(1);
    expect(manager.getState('user-project', 'shared-conversation', projectB).pendingMessageCount).toBe(0);

    manager.settleRun('user-project', 'shared-conversation', runA.runId, projectA);
    expect(manager.getState('user-project', 'shared-conversation', projectA).running).toBe(false);
    expect(manager.getState('user-project', 'shared-conversation', projectB).running).toBe(true);
    manager.settleRun('user-project', 'shared-conversation', runB.runId, projectB);
  });

  it('keeps image steering queued for a text tool loop but allows Codex to claim it', () => {
    const manager = new PiAgentSessionManager();
    const item = manager.enqueue({
      userId: 'user-2',
      conversationId: 'conversation-2',
      message: '按这张图调整当前分析。',
      behavior: 'steer',
      chatAttachments: [{ name: 'reference.png', path: 'C:\\tmp\\reference.png', type: 'image' }],
    });
    const run = manager.beginRun('user-2', 'conversation-2', 'secondary');

    expect(manager.takeSteeringMessages('user-2', 'conversation-2', { allowAttachments: false })).toEqual([]);
    expect(manager.takeSteeringMessages('user-2', 'conversation-2', { allowAttachments: true })[0]?.id).toBe(item.id);
    manager.settleRun('user-2', 'conversation-2', run.runId);
    expect(manager.getState('user-2', 'conversation-2').pending[0]?.status).toBe('queued');
  });

  it('persists queued messages and recovers an interrupted processing claim', () => {
    const first = new PiAgentSessionManager();
    const item = first.enqueue({
      userId: 'user-3',
      conversationId: 'conversation-3',
      message: '关闭软件后仍需继续执行。',
      behavior: 'follow_up',
    });
    expect(first.claimNextForContinuation('user-3', 'conversation-3')?.status).toBe('processing');

    const restored = new PiAgentSessionManager();
    const state = restored.getState('user-3', 'conversation-3');
    expect(state.pendingMessageCount).toBe(1);
    expect(state.pending[0]).toMatchObject({ id: item.id, status: 'queued' });
  });

  it('supports editing and withdrawing only messages that are still queued', () => {
    const manager = new PiAgentSessionManager();
    const item = manager.enqueue({
      userId: 'user-4',
      conversationId: 'conversation-4',
      message: '初始要求',
      behavior: 'follow_up',
    });
    const edited = manager.updateMessage('user-4', 'conversation-4', item.id, {
      message: '更新后的要求',
      behavior: 'steer',
    });
    expect(edited).toMatchObject({ message: '更新后的要求', behavior: 'steer' });
    expect(manager.cancelMessage('user-4', 'conversation-4', item.id)?.status).toBe('cancelled');
    expect(manager.getState('user-4', 'conversation-4').pendingMessageCount).toBe(0);
  });

  it('treats a retried client message id as one idempotent enqueue', () => {
    const manager = new PiAgentSessionManager();
    const input = {
      userId: 'user-5',
      conversationId: 'conversation-5',
      clientMessageId: 'pi_msg_retry_12345678',
      message: '只应排队一次',
      behavior: 'follow_up' as const,
    };
    expect(manager.enqueue(input).id).toBe(input.clientMessageId);
    expect(manager.enqueue(input).id).toBe(input.clientMessageId);
    expect(manager.getState('user-5', 'conversation-5').pendingMessageCount).toBe(1);
  });

  it('accepts only the matching claimed continuation and acknowledges it after success', () => {
    const manager = new PiAgentSessionManager();
    const item = manager.enqueue({
      userId: 'user-6',
      conversationId: 'conversation-6',
      message: '继续核对讨论部分。',
      behavior: 'follow_up',
    });

    expect(manager.markApplied('user-6', 'conversation-6', item.id, 'continued')).toBeNull();
    expect(manager.claimNextForContinuation('user-6', 'conversation-6')?.id).toBe(item.id);
    expect(manager.validateContinuationClaim('user-6', 'conversation-6', item.id, '被篡改的消息')).toBeNull();
    expect(manager.validateContinuationClaim('user-6', 'conversation-6', item.id, item.message)?.id).toBe(item.id);
    expect(manager.markApplied('user-6', 'conversation-6', item.id, 'continued')?.status).toBe('applied');
    expect(manager.getState('user-6', 'conversation-6').pendingMessageCount).toBe(0);
  });

  it('marks the active run as cancelling until the backend settles it', () => {
    const manager = new PiAgentSessionManager();
    const run = manager.beginRun('user-7', 'conversation-7', 'codex');
    const signal = manager.getRunAbortSignal('user-7', 'conversation-7', run.runId);

    const cancellation = manager.requestRunCancellation(
      'user-7',
      'conversation-7',
      run.runId,
    );

    expect(cancellation.requested).toBe(true);
    expect(cancellation.state).toMatchObject({
      running: true,
      runId: run.runId,
      cancellationRequested: true,
    });
    expect(signal?.aborted).toBe(true);
    expect(manager.isRunCancellationRequested('user-7', 'conversation-7', run.runId)).toBe(true);
    expect(manager.settleRun('user-7', 'conversation-7', run.runId).running).toBe(false);
  });

  it('does not let a late cancelled run requeue work claimed by a newer run', () => {
    const manager = new PiAgentSessionManager();
    const firstRun = manager.beginRun('user-8', 'conversation-8', 'secondary');
    const item = manager.enqueue({
      userId: 'user-8',
      conversationId: 'conversation-8',
      message: '切换到新的执行要求。',
      behavior: 'steer',
    });
    expect(manager.takeSteeringMessages('user-8', 'conversation-8')[0]?.id).toBe(item.id);

    manager.requestRunCancellation('user-8', 'conversation-8', firstRun.runId);
    manager.settleRun('user-8', 'conversation-8', firstRun.runId);
    const secondRun = manager.beginRun('user-8', 'conversation-8', 'secondary');
    expect(manager.takeSteeringMessages('user-8', 'conversation-8')[0]?.id).toBe(item.id);

    manager.settleRun('user-8', 'conversation-8', firstRun.runId);
    expect(manager.getState('user-8', 'conversation-8')).toMatchObject({
      running: true,
      runId: secondRun.runId,
      pending: [expect.objectContaining({ id: item.id, status: 'processing' })],
    });
  });

  it('persists run progress and the canonical final response for renderer reattachment', () => {
    const manager = new PiAgentSessionManager();
    const run = manager.beginRun('user-9', 'conversation-9', 'secondary');

    manager.appendRunEvent('user-9', 'conversation-9', run.runId, 'status', {
      message: '正在检索文献',
      elapsedMs: 1200,
    });
    manager.appendRunEvent('user-9', 'conversation-9', run.runId, 'chunk', {
      content: '阶段性输出',
    });
    manager.appendRunEvent('user-9', 'conversation-9', run.runId, 'complete', {
      content: '最终回答',
      provider: 'chat-bridge',
    });
    manager.completeRun('user-9', 'conversation-9', run.runId, { status: 'completed' });
    manager.settleRun('user-9', 'conversation-9', run.runId);

    const state = manager.getState('user-9', 'conversation-9');
    expect(state).toMatchObject({
      running: false,
      runId: run.runId,
      runStatus: 'completed',
      lastEventSequence: 3,
    });
    expect(state.runEvents).toEqual([
      expect.objectContaining({ sequence: 1, type: 'status' }),
      expect.objectContaining({ sequence: 2, type: 'chunk' }),
      expect.objectContaining({
        sequence: 3,
        type: 'complete',
        payload: expect.objectContaining({ content: '最终回答' }),
      }),
    ]);
  });

  it('marks a disk-restored in-flight run as interrupted instead of advertising a ghost task', () => {
    const first = new PiAgentSessionManager();
    const run = first.beginRun('user-10', 'conversation-10', 'codex');
    first.appendRunEvent('user-10', 'conversation-10', run.runId, 'status', {
      message: '正在运行',
    });

    const restored = new PiAgentSessionManager();
    expect(restored.getState('user-10', 'conversation-10')).toMatchObject({
      running: false,
      runId: run.runId,
      runStatus: 'interrupted',
      runError: 'Local service restarted before the Agent run settled',
    });
  });
});
