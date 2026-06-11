import * as fs from 'fs/promises';
import * as path from 'path';
import { DatabaseConnection } from './connection';
import { logger } from '../utils/logger';

export class MigrationRunner {
  private db: DatabaseConnection;
  private migrationsDir: string;

  constructor(db: DatabaseConnection, migrationsDir?: string) {
    this.db = db;
    this.migrationsDir = migrationsDir || path.join(__dirname, 'migrations');
  }

  async ensureMigrationsTable(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async getExecutedMigrations(): Promise<string[]> {
    const rows = await this.db.query<{ name: string }>(
      'SELECT name FROM _migrations ORDER BY name'
    );
    return rows.map(r => r.name);
  }

  async getPendingMigrations(): Promise<string[]> {
    await this.ensureMigrationsTable();
    const executed = await this.getExecutedMigrations();
    
    const files = await fs.readdir(this.migrationsDir);
    const migrations = files
      .filter(f => f.endsWith('.sql'))
      .sort();

    return migrations.filter(m => !executed.includes(m));
  }

  async runMigration(filename: string): Promise<void> {
    const filePath = path.join(this.migrationsDir, filename);
    const sql = await fs.readFile(filePath, 'utf-8');

    logger.info(`[Migration] Running: ${filename}`);

    await this.db.transaction(async (client) => {
      await client.query(sql);
      await client.query(
        'INSERT INTO _migrations (name) VALUES ($1)',
        [filename]
      );
    });

    logger.info(`[Migration] Completed: ${filename}`);
  }

  async runAllPending(): Promise<{ executed: string[]; failed: string[] }> {
    const pending = await this.getPendingMigrations();
    const executed: string[] = [];
    const failed: string[] = [];

    for (const migration of pending) {
      try {
        await this.runMigration(migration);
        executed.push(migration);
      } catch (error) {
        logger.error(`[Migration] Failed: ${migration}`, error);
        failed.push(migration);
        break;
      }
    }

    return { executed, failed };
  }

  async runSchema(): Promise<void> {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf-8');

    logger.info('[Migration] Running schema.sql...');
    await this.db.query(schema);
    logger.info('[Migration] Schema completed');
  }

  async initialize(): Promise<void> {
    try {
      await this.runSchema();
      await this.ensureMigrationsTable();
      const result = await this.runAllPending();
      
      logger.info(`[Migration] Initialization complete. Executed: ${result.executed.length}, Failed: ${result.failed.length}`);
    } catch (error) {
      logger.error('[Migration] Initialization failed:', error);
      throw error;
    }
  }
}

export async function runMigrations(db: DatabaseConnection): Promise<void> {
  const runner = new MigrationRunner(db);
  await runner.runAllPending();
}

export async function initializeDatabase(db: DatabaseConnection): Promise<void> {
  const runner = new MigrationRunner(db);
  await runner.initialize();
}
