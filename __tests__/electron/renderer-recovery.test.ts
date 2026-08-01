import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

import { RendererRecoveryPolicy } from '../../electron/renderer-recovery-policy';

describe('RendererRecoveryPolicy', () => {
  it('allows a bounded number of recoveries inside the rolling window', () => {
    const policy = new RendererRecoveryPolicy(3, 1_000);

    expect(policy.tryAcquire(10_000)).toMatchObject({ allowed: true, attempt: 1 });
    expect(policy.tryAcquire(10_100)).toMatchObject({ allowed: true, attempt: 2 });
    expect(policy.tryAcquire(10_200)).toMatchObject({ allowed: true, attempt: 3 });
    expect(policy.tryAcquire(10_300)).toMatchObject({
      allowed: false,
      attempt: 3,
      retryAfterMs: 700,
    });
  });

  it('allows recovery again after the rolling window expires', () => {
    const policy = new RendererRecoveryPolicy(2, 1_000);

    policy.tryAcquire(5_000);
    policy.tryAcquire(5_100);

    expect(policy.tryAcquire(6_001)).toMatchObject({ allowed: true, attempt: 2 });
  });

  it('resets the recovery counter after a stable period', () => {
    const policy = new RendererRecoveryPolicy(2, 1_000);

    policy.tryAcquire(5_000);
    policy.reset();

    expect(policy.getAttemptCount(5_100)).toBe(0);
    expect(policy.tryAcquire(5_100)).toMatchObject({ allowed: true, attempt: 1 });
  });
});

describe('Electron renderer recovery wiring', () => {
  const mainSource = fs.readFileSync(
    path.resolve(__dirname, '../../electron/main.ts'),
    'utf-8',
  );

  it('monitors renderer crashes, unresponsive windows, and GPU exits', () => {
    expect(mainSource).toContain("app.on('render-process-gone'");
    expect(mainSource).toContain("window.on('unresponsive'");
    expect(mainSource).toContain("window.on('responsive'");
    expect(mainSource).toContain("app.on('child-process-gone'");
    expect(mainSource).toContain("details.type === 'GPU'");
  });

  it('lets Chromium rebuild a crashed GPU process without reloading the main page', () => {
    expect(mainSource).toContain('GPU process will be rebuilt by Chromium');
    expect(mainSource).not.toContain(
      "scheduleMainWindowRendererRecovery('gpu-process-gone'",
    );
  });

  it('uses the health-aware main-page reload and a recovery circuit breaker', () => {
    expect(mainSource).toContain('await ensureServerRunning()');
    expect(mainSource).toContain('await window.loadURL(MAIN_WINDOW_URL)');
    expect(mainSource).toContain('rendererRecoveryPolicy.tryAcquire()');
    expect(mainSource).toContain('promptRendererRecoveryExhausted');
  });
});
