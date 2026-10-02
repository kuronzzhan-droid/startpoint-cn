// Local/test adapter only. Production receives the native D1 binding.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function openDatabase(filename = ':memory:') {
  const database = new DatabaseSync(filename);
  database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  database.exec('BEGIN IMMEDIATE');
  try {
    const columns = database.prepare('PRAGMA table_info(community_teams)').all();
    if (columns.length && !columns.some((column) => column.name === 'category'))
      database.exec(readFileSync(new URL('./migrations/0001-team-category.sql', import.meta.url), 'utf8'));
    if (columns.length && !columns.some((column) => column.name === 'section'))
      database.exec(readFileSync(new URL('./migrations/0002-team-section.sql', import.meta.url), 'utf8'));
    if (columns.length && !columns.some((column) => column.name === 'visibility'))
      database.exec(readFileSync(new URL('./migrations/0003-team-visibility.sql', import.meta.url), 'utf8'));
    const teamSQL = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='community_teams'").get()?.sql;
    if (teamSQL && !teamSQL.includes("'original'"))
      database.exec(readFileSync(new URL('./migrations/0006-original-section.sql', import.meta.url), 'utf8'));
    if (teamSQL && !teamSQL.includes("'abyss-ex'"))
      database.exec(readFileSync(new URL('./migrations/0017-abyss-ex-section.sql', import.meta.url), 'utf8'));
    database.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    database.exec('COMMIT');
  } catch (error) {database.exec('ROLLBACK'); database.close(); throw error;}
  function prepare(sql, parameters = []) {
    const statement = database.prepare(sql);
    return {
      bind: (...values) => prepare(sql, values.map((value) => value instanceof ArrayBuffer ? new Uint8Array(value) : value)),
      first: async () => statement.get(...parameters) || null,
      all: async () => ({results: statement.all(...parameters), success: true}),
      run: async () => {const result = statement.run(...parameters); return {success: true, meta: {changes: Number(result.changes)}};},
      _run: () => {const result = statement.run(...parameters); return {success: true, meta: {changes: Number(result.changes)}};}
    };
  }
  return {prepare, async batch(statements) {
    database.exec('BEGIN IMMEDIATE');
    try {const results = statements.map((statement) => statement._run()); database.exec('COMMIT'); return results;}
    catch (error) {database.exec('ROLLBACK'); throw error;}
  }, close: () => database.close(), raw: database};
}
