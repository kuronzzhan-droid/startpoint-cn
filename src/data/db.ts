import type { Database as SqliteDatabase } from "better-sqlite3";
import getDatabase, { Database } from ".";

// The connection is resolved lazily so the SQLite writer thread can point the
// same domain modules at its own connection before the first getDb() call, and
// so importing a domain module no longer opens/migrates the database as a side
// effect.
let override: SqliteDatabase | null = null;
let resolved: SqliteDatabase | null = null;

/**
 * Route getDb() to an externally owned connection.
 *
 * Only the SQLite writer worker uses this: it opens a plain connection without
 * the initializer/migration pipeline and then lets the identical domain code
 * run against it. Call before the first getDb() call.
 */
export function setDbOverride(db: SqliteDatabase | null): void {
    override = db;
    resolved = null;
}

export function getDb(): SqliteDatabase {
    if (process.env.MULTI_REALTIME_OWNER_CHILD === "1") throw new Error("REALTIME_OWNER_CANNOT_OPEN_PLAYER_DATABASE")
    if (override !== null) return override;
    if (resolved === null) resolved = getDatabase(Database.WDFP_DATA);
    return resolved;
}
