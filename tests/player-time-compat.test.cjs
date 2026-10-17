'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
const load = name => require(path.join(out, name))
const migrationTables = ['server_time_migration_config', 'player_time_state', 'player_time_migration_ledger']

function assertNoAutomaticMigrationTables(db) {
    for (const name of migrationTables) {
        assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name=?").get(name).n, 0,
            `ordinary initialization cannot create ${name}`)
    }
}

function createPlayer(label) {
    const account = load('data/domains/account').insertAccountSync({
        appId: 'wf_cn', idpAlias: '', idpCode: 'clock-column-test', idpId: label, status: 'normal',
    })
    return load('data/domains/player').insertDefaultPlayerSync(account.id)
}

function insertCurrentPlay(playerId, playId) {
    load('data/domains/quest_active').insertPlayerActiveQuestSync(playerId, {
        playerId, playId, questId: 1001001, category: 2,
        useBossBoostPoint: false, useBoostPoint: false, isAutoStartMode: false,
        isMulti: false, isMultiHost: false, roomNumber: null, entryItemId: null,
        eventId: null, continueCount: 0, startedAtMs: Date.now(), partySlot: 1,
    })
}

if (process.argv.includes('--column-upgrade-child')) {
    const expected = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'legacy-row.json'), 'utf8'))
    // A new process exercises the actual database initialization path, rather
    // than a cached connection or a test copy of the production schema logic.
    const db = load('data/db').getDb()
    try {
        assertNoAutomaticMigrationTables(db)
        const row = db.prepare('SELECT * FROM players_active_quests WHERE player_id=?').get(expected.player_id)
        assert.equal(row.clock_version, 0, 'an existing unmarked play receives legacy version zero')
        const { clock_version, ...originalColumns } = row
        assert.deepEqual(originalColumns, expected, 'column upgrade preserves every existing play field')
        const next = createPlayer('after-existing-column-upgrade')
        insertCurrentPlay(next.id, 'new-after-upgrade')
        assert.equal(db.prepare('SELECT clock_version FROM players_active_quests WHERE player_id=?').get(next.id).clock_version, 1)
        assertNoAutomaticMigrationTables(db)
    } finally { db.close() }
} else {
    const test = require('node:test')
    test('fresh and legacy database initialization retains the required battle clock column without starting player time migration', t => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'player-time-column-'))
        const previousDirectory = process.env.DATA_DIR
        process.env.DATA_DIR = directory
        let db
        t.after(() => {
            if (db?.open) db.close()
            assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir()))
            fs.rmSync(directory, { recursive: true })
            if (previousDirectory === undefined) delete process.env.DATA_DIR
            else process.env.DATA_DIR = previousDirectory
        })
        db = load('data/db').getDb()
        assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
        assertNoAutomaticMigrationTables(db)
        assert.equal(db.prepare('PRAGMA table_info(players_active_quests)').all().some(column => column.name === 'clock_version'), true)
        const player = createPlayer('fresh-clock-column')
        insertCurrentPlay(player.id, 'fresh-version-one')
        assert.equal(db.prepare('SELECT clock_version FROM players_active_quests WHERE player_id=?').get(player.id).clock_version, 1)

        // Derive an old schema from the real fresh database. Removing only the
        // new column avoids restating CREATE TABLE or the initializer in tests.
        db.exec('ALTER TABLE players_active_quests DROP COLUMN clock_version')
        const original = db.prepare('SELECT * FROM players_active_quests WHERE player_id=?').get(player.id)
        fs.writeFileSync(path.join(directory, 'legacy-row.json'), JSON.stringify(original))
        db.close()
        db = null
        const child = spawnSync(process.execPath, [__filename, '--column-upgrade-child'], {
            env: { ...process.env, DATA_DIR: directory, STARPOINT_TEST_OUT_DIR: out },
            encoding: 'utf8', timeout: 30_000, windowsHide: true,
        })
        assert.equal(child.error, undefined, child.error?.message)
        assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`)
    })
}
