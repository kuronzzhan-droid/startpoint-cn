// Local/test adapter only. Production receives the native D1 binding.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function openDatabase(filename = ':memory:') {
  const database = new DatabaseSync(filename);
  database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  database.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  function prepare(sql, parameters = []) {
    const statement = database.prepare(sql);
    return {
      bind: (...values) => prepare(sql, values),
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
