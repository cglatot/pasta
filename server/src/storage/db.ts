import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { getDataDir } from './crypto.ts';
import { SCHEMA_SQL } from './schema.ts';

let dbInstance: DatabaseSync | null = null;

export const getDatabase = (overrideDataDir?: string): DatabaseSync => {
    if (dbInstance && !overrideDataDir) {
        return dbInstance;
    }

    const dataDir = getDataDir(overrideDataDir);
    const dbPath = join(dataDir, 'pasta.db');
    const db = new DatabaseSync(dbPath);

    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA_SQL);

    if (!overrideDataDir) {
        dbInstance = db;
    }

    return db;
};

/**
 * Executes a synchronous callback inside a SQLite BEGIN IMMEDIATE / COMMIT transaction.
 */
export const withTransaction = <T>(fn: (db: DatabaseSync) => T, overrideDb?: DatabaseSync): T => {
    const db = overrideDb || getDatabase();
    db.exec('BEGIN IMMEDIATE;');
    try {
        const result = fn(db);
        db.exec('COMMIT;');
        return result;
    } catch (err) {
        try {
            db.exec('ROLLBACK;');
        } catch {
            // Ignore rollback errors if already rolled back
        }
        throw err;
    }
};

/**
 * Prunes auto_operations and manual_batch_logs older than each server's configured retention_days.
 */
export const pruneOldLogs = (overrideDb?: DatabaseSync): void => {
    const db = overrideDb || getDatabase();
    const serversStmt = db.prepare(
        'SELECT machine_identifier, retention_days FROM monitored_servers'
    );
    const servers = serversStmt.all() as Array<{
        machine_identifier: string;
        retention_days: number;
    }>;

    const deleteAutoOpsStmt = db.prepare(
        'DELETE FROM auto_operations WHERE machine_identifier = ? AND created_at < ?'
    );
    const deleteManualLogsStmt = db.prepare(
        'DELETE FROM manual_batch_logs WHERE machine_identifier = ? AND created_at < ?'
    );

    const nowMs = Date.now();
    for (const s of servers) {
        const days = s.retention_days > 0 ? s.retention_days : 90;
        const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;
        deleteAutoOpsStmt.run(s.machine_identifier, cutoffMs);
        deleteManualLogsStmt.run(s.machine_identifier, cutoffMs);
    }
};

/**
 * Checkpoints the WAL journal and closes the SQLite connection cleanly on SIGTERM / SIGINT.
 */
export const closeDatabase = (): void => {
    if (!dbInstance) return;
    try {
        dbInstance.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
        // Ignore checkpoint error on close
    }
    try {
        dbInstance.close();
    } finally {
        dbInstance = null;
    }
};
