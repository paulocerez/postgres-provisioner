import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database, { type Database as SqliteDatabase } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { env } from '../env.js';
import * as schema from './schema.js';

mkdirSync(env.DATA_DIR, { recursive: true });

const sqlite: SqliteDatabase = new Database(path.join(env.DATA_DIR, 'app.db'));
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });
export type Db = typeof db;

/**
 * Applied on every boot before the server listens. `drizzle/` is committed, so
 * a deploy never needs drizzle-kit at runtime.
 */
export function runMigrations(): void {
  const migrationsFolder = path.resolve(import.meta.dirname, '../../drizzle');
  migrate(db, { migrationsFolder });
}

export { sqlite };
