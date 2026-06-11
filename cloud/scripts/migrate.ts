try {
  require('dotenv/config');
} catch {
  // dotenv is optional in managed deployment environments.
}

import { initializeDatabase } from '../database/connection';
import { MigrationRunner } from '../database/migrate';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

function resolveMigrationsDir(): string | undefined {
  const candidates = [
    path.join(process.cwd(), 'database', 'migrations'),
    path.join(__dirname, '..', 'database', 'migrations'),
  ];

  return candidates.find(candidate => fs.existsSync(candidate));
}

async function main(): Promise<void> {
  const db = await initializeDatabase();
  try {
    const migrationsDir = resolveMigrationsDir();
    const runner = new MigrationRunner(db, migrationsDir);
    await runner.runAllPending();
    logger.info('[Migration] Pending migrations completed');
  } finally {
    await db.disconnect();
  }
}

main().catch((error) => {
  logger.error('[Migration] Failed:', error);
  process.exit(1);
});
