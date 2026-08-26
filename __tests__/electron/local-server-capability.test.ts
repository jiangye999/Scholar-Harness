import { readFileSync } from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

const electronMain = readFileSync(path.resolve(process.cwd(), 'electron/main.ts'), 'utf-8');
const localServer = readFileSync(path.resolve(process.cwd(), 'src/server/local-server.ts'), 'utf-8');

describe('Electron local-server capability handshake', () => {
  it('does not reuse a packaged server that predates conversation archiving', () => {
    expect(localServer).toContain('localServerApiVersion: 4');
    expect(localServer).toContain('conversationArchive: true');
    expect(electronMain).toContain('Number(parsed.capabilities?.localServerApiVersion || 0) >= 4');
    expect(electronMain).toContain('parsed.capabilities?.conversationArchive === true');
    expect(electronMain).toContain('health/capability check failed or DATA_DIR mismatched');
  });
});
