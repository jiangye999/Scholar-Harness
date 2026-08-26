import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const bridgeSource = readFileSync(path.join(repoRoot, 'src/server/routes/chat-bridge.ts'), 'utf-8');
const metaSource = readFileSync(path.join(repoRoot, 'src/server/routes/meta-analysis.ts'), 'utf-8');
const logSource = readFileSync(path.join(repoRoot, 'src/server/services/session-log.ts'), 'utf-8');

describe('Phase 4: PI steering force-injection and queue<->log alignment', () => {
  it('defines a shared steering formatter at module scope', () => {
    expect(bridgeSource).toContain('function formatPiSteeringMessageForChat(');
    expect(bridgeSource).toContain('<PI_STEERING_MESSAGE id="');
  });

  it('pre-call force-injects queued steering for API providers without a tool loop', () => {
    expect(bridgeSource).toContain('Pre-call steering injection');
    expect(bridgeSource).toContain('takeSteeringMessages({ allowAttachments: false })');
    expect(bridgeSource).toMatch(/shouldUseCodexProvider[\s\S]{0,80}piSessionRuntime/);
  });

  it('remembers claimed steering ids so consumed steering lands in the session log', () => {
    expect(bridgeSource).toContain('const steeringContentById = new Map<string, string>();');
    expect(bridgeSource).toContain("sessionLog.append({ type: 'user', content, delivery: 'steer' })");
    expect(bridgeSource).toContain('markSteeringApplied: async (messageId: string) => {');
  });

  it('aligns the Meta session log with consumed steering', () => {
    expect(metaSource).toContain('const metaSteeringContentById = new Map<string, string>();');
    expect(metaSource).toMatch(/metaSessionLog\.append\(\{ type: 'user', content, delivery: 'steer' \}\)/);
  });

  it('session log accepts steer delivery events and renders them as history', () => {
    expect(logSource).toContain("delivery?: 'steer' | 'follow_up' | 'normal'");
  });
});
