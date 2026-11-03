"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.openWriterConnection = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const sqlite_diagnostics_1 = require("../sqlite-diagnostics");
const sqlite_settings_1 = require("../sqlite-settings");
/**
 * Open the writer thread's own connection to the business database.
 *
 * The main process stays the schema owner: this factory deliberately skips the
 * initializer/update pipeline in `src/data/index.ts` so a worker restart can
 * never re-run migrations, rewrite the version file or race storage
 * maintenance. Only pragmas and instrumentation are applied, mirroring the
 * main connection so both sides observe the same durability settings.
 *
 * Checkpoint ownership starts on the automatic owner (1000) and is handed to
 * the external checkpoint worker through the `checkpoint_owner` protocol
 * message once that worker reports a successful checkpoint.
 */
function openWriterConnection(options) {
    const db = new better_sqlite3_1.default(options.databasePath);
    db.pragma("temp_store = FILE");
    db.pragma("journal_mode = WAL");
    (0, sqlite_settings_1.applySqliteSettings)(db);
    db.pragma(`busy_timeout = ${Math.max(0, options.busyTimeoutMs)}`);
    db.pragma("wal_autocheckpoint = 1000");
    db.pragma("foreign_keys = ON");
    (0, sqlite_diagnostics_1.observeSqliteDatabase)(db, "writer");
    return db;
}
exports.openWriterConnection = openWriterConnection;
