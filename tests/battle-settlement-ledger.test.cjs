'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Database = require('better-sqlite3')
const out = path.resolve(process.env.BATTLE_LEDGER_OUT_DIR || path.join(__dirname, '../out'))
const dbPath = require.resolve(path.join(out, 'data/db.js'))
let db
const previous = require.cache[dbPath]
// Isolate the DAO from application initialization; every test owns an in-memory database.
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getDb: () => db } }
const ledger = require(path.join(out, 'data/domains/battle-settlement-ledger.js'))
const receipts = require(path.join(out, 'data/domains/player-operation-receipt.js'))
if (previous) require.cache[dbPath] = previous
else delete require.cache[dbPath]
const now = 1700000000000
const response = mode => ({ data_headers: {}, data: { is_multi: mode, user_info: {}, rewards: {} } })

test.beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys=ON')
    db.exec(`CREATE TABLE players(id INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0);
      INSERT INTO players(id) VALUES(1),(2);
      CREATE TABLE player_operation_receipts(player_id INTEGER,operation TEXT,request_key TEXT,response_json TEXT,created_at INTEGER,
        PRIMARY KEY(player_id,operation,request_key), FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE);
      CREATE TABLE battle_settlement_ledger(player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        play_id TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('single','multi','legacy-conflict')),settled_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK(version=1),PRIMARY KEY(player_id,play_id)) WITHOUT ROWID;
      CREATE TABLE battle_receipt_payload_queue(player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        play_id TEXT NOT NULL,operation TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(player_id,play_id,operation),
        FOREIGN KEY(player_id,play_id) REFERENCES battle_settlement_ledger(player_id,play_id) ON DELETE CASCADE) WITHOUT ROWID;
      CREATE TABLE five_boss_solo_runs(player_id INTEGER,play_id TEXT,status TEXT,PRIMARY KEY(player_id,play_id));
      CREATE TABLE five_boss_gauntlet_runs(run_id TEXT PRIMARY KEY,status TEXT);
      CREATE TABLE five_boss_gauntlet_members(run_id TEXT,player_id INTEGER,client_play_id TEXT,aborted_at TEXT,UNIQUE(player_id,client_play_id));
      CREATE TABLE five_boss_gauntlet_receipts(run_id TEXT,player_id INTEGER,PRIMARY KEY(run_id,player_id));`)
})
test.afterEach(() => { if (db.open) db.close() })

function pay(playerId, playId, mode, at = now) {
    return db.transaction(() => {
        const fact = ledger.insertBattleSettlementSync(playerId, playId, mode, at)
        db.prepare('UPDATE players SET balance=balance+7 WHERE id=?').run(playerId)
        receipts.insertPlayerOperationReceiptSync({ playerId, operation: `quest_finish.${mode}`, requestKey: playId, response: response(mode) }, fact.settledAtMs)
        return fact
    })()
}

test('payment and queued payload have one timestamp; expired or deleted payload keeps the terminal cross-mode guard', () => {
    pay(1, 'play', 'single')
    assert.equal(db.prepare('SELECT created_at FROM battle_receipt_payload_queue').get().created_at,
        db.prepare('SELECT created_at FROM player_operation_receipts').get().created_at)
    assert.equal(ledger.getBattleReplaySync(1, 'single', 'play', now + ledger.BATTLE_REPLAY_RETENTION_MS - 1).kind, 'available')
    assert.equal(ledger.getBattleReplaySync(1, 'single', 'play', now + ledger.BATTLE_REPLAY_RETENTION_MS).kind, 'expired')
    assert.equal(ledger.getBattleReplaySync(1, 'multi', 'play', now).kind, 'other-mode')
    db.prepare('DELETE FROM player_operation_receipts').run()
    assert.equal(ledger.getBattleReplaySync(1, 'single', 'play', now).kind, 'corrupt')
    assert.equal(ledger.getBattleReplaySync(1, 'single', 'play', now + ledger.BATTLE_REPLAY_RETENTION_MS).kind, 'expired')
    assert.throws(() => db.transaction(() => ledger.assertBattleCanStartSync(1, 'play'))(), { code: 'BATTLE_ALREADY_SETTLED' })
    assert.throws(() => pay(1, 'play', 'multi'), { code: 'BATTLE_ALREADY_SETTLED' })
    assert.equal(db.prepare('SELECT balance FROM players WHERE id=1').get().balance, 7)
})

test('legacy response metadata blocks restarts even when its JSON is corrupt, expired, or conflicts across modes', () => {
    db.prepare('INSERT INTO player_operation_receipts VALUES(?,?,?,?,?)').run(1, 'quest_finish.single', 'old', '{', now)
    assert.equal(ledger.getBattleSettlementSync(1, 'old').source, 'legacy-receipt')
    assert.equal(ledger.getBattleReplaySync(1, 'single', 'old', now).kind, 'corrupt')
    assert.equal(ledger.getBattleReplaySync(1, 'single', 'old', now + ledger.BATTLE_REPLAY_RETENTION_MS).kind, 'expired')
    assert.throws(() => pay(1, 'old', 'single'), { code: 'BATTLE_ALREADY_SETTLED' })
    db.prepare('INSERT INTO player_operation_receipts VALUES(?,?,?,?,?)').run(1, 'quest_finish.multi', 'old', JSON.stringify(response('multi')), now + 1)
    assert.equal(ledger.getBattleSettlementSync(1, 'old').mode, 'legacy-conflict')
    assert.equal(ledger.getBattleReplaySync(1, 'multi', 'old', now).kind, 'other-mode')
    assert.equal(db.prepare('SELECT balance FROM players WHERE id=1').get().balance, 0)
})

test('a partially backfilled ledger still recognizes an opposite legacy response as conflict', () => {
    db.prepare("INSERT INTO battle_settlement_ledger VALUES(1,'mixed','single',?,1)").run(now)
    db.prepare('INSERT INTO player_operation_receipts VALUES(?,?,?,?,?)').run(1, 'quest_finish.multi', 'mixed', JSON.stringify(response('multi')), now + 1)
    assert.equal(ledger.getBattleSettlementSync(1, 'mixed').mode, 'legacy-conflict')
    assert.equal(ledger.getBattleReplaySync(1, 'single', 'mixed', now).kind, 'other-mode')
})

test('queue or payload SQL failure rolls back reward and permanent guard together and permits one retry', () => {
    db.exec("CREATE TRIGGER stop_queue BEFORE INSERT ON battle_receipt_payload_queue BEGIN SELECT RAISE(ABORT,'queue-fixture'); END")
    assert.throws(() => pay(1, 'rollback', 'single'), /queue-fixture/)
    assert.equal(ledger.getBattleSettlementSync(1, 'rollback'), null)
    db.exec('DROP TRIGGER stop_queue')
    db.exec("CREATE TRIGGER stop_payload BEFORE INSERT ON player_operation_receipts BEGIN SELECT RAISE(ABORT,'payload-fixture'); END")
    assert.throws(() => pay(1, 'rollback', 'single'), /payload-fixture/)
    assert.equal(ledger.getBattleSettlementSync(1, 'rollback'), null)
    assert.equal(db.prepare('SELECT balance FROM players WHERE id=1').get().balance, 0)
    db.exec('DROP TRIGGER stop_payload')
    pay(1, 'rollback', 'single')
    assert.equal(db.prepare('SELECT balance FROM players WHERE id=1').get().balance, 7)
})

test('malformed replay, unknown ledger version and clock-abort fail closed rather than becoming missing', () => {
    pay(1, 'broken', 'single')
    db.prepare("UPDATE player_operation_receipts SET response_json='null'").run()
    assert.equal(ledger.getBattleReplaySync(1, 'single', 'broken', now).kind, 'corrupt')
    db.pragma('ignore_check_constraints=ON')
    db.prepare('UPDATE battle_settlement_ledger SET version=99').run()
    assert.equal(ledger.getBattleReplaySync(1, 'single', 'broken', now).kind, 'corrupt')
    assert.throws(() => db.transaction(() => ledger.assertBattleCanStartSync(1, 'broken'))(), { code: 'BATTLE_LEDGER_CORRUPT' })
    db.prepare('INSERT INTO player_operation_receipts VALUES(?,?,?,?,?)').run(1, 'clock_migration.abort', 'aborted', '{}', now)
    assert.equal(ledger.getBattleReplaySync(1, 'multi', 'aborted', now).kind, 'aborted')
    assert.throws(() => db.transaction(() => ledger.assertBattleCanStartSync(1, 'aborted'))(), { code: 'BATTLE_CLOCK_ABORTED' })
})

test('special five-boss terminal IDs block starts without intercepting dedicated replay', () => {
    db.prepare("INSERT INTO five_boss_solo_runs VALUES(1,'solo-ended','settled')").run()
    db.prepare("INSERT INTO five_boss_solo_runs VALUES(1,'solo-aborted','aborted')").run()
    db.prepare("INSERT INTO five_boss_gauntlet_runs VALUES('run','active')").run()
    db.prepare("INSERT INTO five_boss_gauntlet_members VALUES('run',1,'multi-ended',NULL)").run()
    db.prepare("INSERT INTO five_boss_gauntlet_receipts VALUES('run',1)").run()
    for (const playId of ['solo-ended', 'solo-aborted', 'multi-ended']) {
        assert.throws(() => db.transaction(() => ledger.assertBattleCanStartSync(1, playId))(), { code: 'BATTLE_ALREADY_SETTLED' })
        assert.equal(ledger.getBattleReplaySync(1, 'single', playId, now).kind, 'missing')
    }
})

test('eligibility and payment require transactions, while deleting one player cascades only that player ledger and queue', () => {
    assert.throws(() => ledger.assertBattleCanStartSync(1, 'fresh'), /inside its transaction/)
    assert.throws(() => ledger.insertBattleSettlementSync(1, 'fresh', 'single'), /inside its payment transaction/)
    pay(1, 'one', 'single')
    pay(2, 'two', 'multi')
    db.prepare('DELETE FROM players WHERE id=1').run()
    assert.equal(db.prepare('SELECT count(*) AS n FROM battle_settlement_ledger WHERE player_id=1').get().n, 0)
    assert.equal(db.prepare('SELECT count(*) AS n FROM battle_receipt_payload_queue WHERE player_id=1').get().n, 0)
    assert.equal(ledger.getBattleReplaySync(2, 'multi', 'two', now).kind, 'available')
    assert.deepEqual(db.pragma('foreign_key_check'), [])
})

test('SQLite read failures propagate rather than masquerading as corrupt or missing replay', () => {
    pay(1, 'read-error', 'single')
    db.exec('DROP TABLE battle_receipt_payload_queue; DROP TABLE battle_settlement_ledger')
    assert.throws(() => ledger.getBattleReplaySync(1, 'single', 'read-error', now), /no such table/)
})

test('closed-connection errors including native TypeError propagate to the existing error handler', () => {
    db.close()
    assert.throws(() => ledger.getBattleReplaySync(1, 'single', 'read-error', now), /not open|closed/i)
})
