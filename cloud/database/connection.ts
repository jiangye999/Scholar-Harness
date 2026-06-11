import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { logger } from '../utils/logger';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  maxConnections?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export class DatabaseConnection {
  private pool: Pool | null = null;
  private config: DatabaseConfig;

  constructor(config?: DatabaseConfig) {
    this.config = config || this.loadConfigFromEnv();
  }

  private loadConfigFromEnv(): DatabaseConfig {
    const databaseUrl = process.env.DATABASE_URL;
    
    if (databaseUrl) {
      return this.parseDatabaseUrl(databaseUrl);
    }

    return {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'scholar_harness',
      user: process.env.DB_USER || 'scholar_user',
      password: process.env.DB_PASSWORD || '',
      ssl: process.env.DB_SSL === 'true',
      maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '2000', 10),
    };
  }

  private parseDatabaseUrl(url: string): DatabaseConfig {
    try {
      const parsed = new URL(url);
      return {
        host: parsed.hostname,
        port: parseInt(parsed.port || '5432', 10),
        database: parsed.pathname.slice(1),
        user: parsed.username,
        password: parsed.password,
        ssl: parsed.searchParams.get('ssl') === 'true',
      };
    } catch (error) {
      logger.error('[Database] Failed to parse DATABASE_URL:', error);
      throw new Error('Invalid DATABASE_URL format');
    }
  }

  async connect(): Promise<void> {
    if (this.pool) {
      logger.warn('[Database] Pool already exists, reusing existing connection');
      return;
    }

    const poolConfig: PoolConfig = {
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      max: this.config.maxConnections || 20,
      idleTimeoutMillis: this.config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: this.config.connectionTimeoutMillis || 2000,
    };

    if (this.config.ssl) {
      poolConfig.ssl = { rejectUnauthorized: false };
    }

    this.pool = new Pool(poolConfig);

    this.pool.on('error', (err: Error) => {
      logger.error('[Database] Unexpected error on idle client:', err);
    });

    try {
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      logger.info('[Database] Connected successfully to:', this.config.database);
    } catch (error) {
      logger.error('[Database] Connection failed:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.pool) {
      return;
    }

    try {
      await this.pool.end();
      this.pool = null;
      logger.info('[Database] Disconnected successfully');
    } catch (error) {
      logger.error('[Database] Disconnect failed:', error);
      throw error;
    }
  }

  async query<T extends QueryResultRow = any>(sql: string, params?: any[]): Promise<T[]> {
    if (!this.pool) {
      throw new Error('Database not connected. Call connect() first.');
    }

    try {
      const result: QueryResult<T> = await this.pool.query(sql, params);
      return result.rows;
    } catch (error) {
      logger.error('[Database] Query error:', { sql: sql.substring(0, 200), error });
      throw error;
    }
  }

  async queryOne<T extends QueryResultRow = any>(sql: string, params?: any[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  async transaction<T>(callback: (client: any) => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new Error('Database not connected. Call connect() first.');
    }

    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('[Database] Transaction failed, rolled back:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  getPoolStatus(): { totalConnections: number; idleConnections: number; waitingClients: number } {
    if (!this.pool) {
      return { totalConnections: 0, idleConnections: 0, waitingClients: 0 };
    }

    return {
      totalConnections: this.pool.totalCount,
      idleConnections: this.pool.idleCount,
      waitingClients: this.pool.waitingCount,
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    if (!this.pool) {
      return { healthy: false, error: 'Pool not initialized' };
    }

    try {
      const start = Date.now();
      await this.query('SELECT 1');
      const latency = Date.now() - start;
      return { healthy: true, latency };
    } catch (error) {
      return { healthy: false, error: (error as Error).message };
    }
  }
}

let dbInstance: DatabaseConnection | null = null;

export function getDatabase(config?: DatabaseConfig): DatabaseConnection {
  if (!dbInstance) {
    dbInstance = new DatabaseConnection(config);
  }
  return dbInstance;
}

export async function initializeDatabase(config?: DatabaseConfig): Promise<DatabaseConnection> {
  const db = getDatabase(config);
  await db.connect();
  return db;
}
