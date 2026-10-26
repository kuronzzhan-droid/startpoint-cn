'use strict'

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRequire } = require('node:module')

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'single-reward-images-'))
process.env.DATA_DIR = directory
process.env.SQL_STATEMENT_CACHE = 'false'
process.env.GAME_ROUTINE_LOGS = 'off'
delete process.env.CN_WRITER_THREAD

const { getDb } = require('../out/data/db')
const { insertAccountSync } = require('../out/data/domains/account')
const { insertDefaultPlayerSync } = require('../out/data/domains/player')
const { runPersistenceTransactionSync } = require('../out/lib/persistence-coordinator')
const { startAbyssEnduranceQuestSync } = require('../out/lib/abyss-endurance-degree-rewards')
const { setLeaderboardAvailabilitySync } = require('../out/lib/leaderboard/availability')
const version = require('../out/lib/version')
const originalManifest = version.getPatchManifest
// Stable public tower metadata; all domain SQL below still executes on real SQLite.
version.getPatchManifest = () => ({ cdn_version: '1.4.136', patches: [{
    id: 'snapshot-test', type: 'patch', version: '1.4.136', enabled: true,
    quest_time_revisions: { 'rush:700099': 'a'.repeat(64) },
}] })

const characterLib = require('../out/lib/character')
const originalImages = characterLib.getCharactersEvolutionImgLevels
let imageCalls = null, queries = null
characterLib.getCharactersEvolutionImgLevels = (...args) => {
    if (imageCalls) imageCalls.push([...args[1]])
    return originalImages(...args)
}
const db = getDb()
assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
const prepare = db.prepare.bind(db)
db.prepare = function (sql) {
    const statement = prepare(sql)
    return new Proxy(statement, {
        get(target, property) {
            const value = Reflect.get(target, property, target)
            if (typeof value !== 'function') return value
            if (!['all', 'get', 'run'].includes(property)) return value.bind(target)
            return (...args) => {
                const result = value.apply(target, args)
                if (queries) queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), operation: property })
                return result
            }
        },
    })
}

// Exercise the actual compiled Rush/leaderboard/repair block without executing
// unrelated settlement rewards. Its imported domains use this isolated real DB.
const compiledFile = path.resolve(__dirname, '../out/lib/quest/finish/single-finish-transaction.js')
const source = fs.readFileSync(compiledFile, 'utf8')
const start = source.indexOf('bodyTiming.step("mode_rewards")')
const end = source.indexOf('const rogueFolderMaxRounds', start)
assert.ok(start >= 0 && end > start, 'compiled mode-reward block must be present')
const block = source.slice(start, end)
const requireCompiled = createRequire(compiledFile)
const imports = [...source.matchAll(/^const (\w+) = require\("([^"]+)"\);/gm)]
    .filter(match => new RegExp(`\\b${match[1]}\\.`).test(block))
    .map(match => ({ name: match[1], request: match[2], value: requireCompiled(match[2]) }))
const core = new Function(...imports.map(row => row.name), 'input', `
    const { bodyTiming, bodyPartyStatistics, playerId, viewerId, questId,
        questCategory, questData, questAccomplished, clearTime } = input;
    ${block}
    return { rushEventData, abyssEnduranceDegrees };
`)

let sequence = 0
const ids = [940001, 940002, 940003, 940004, 940005, 940006]
function insertCharacter(playerId, id, evolution = 1, illustration = null) {
    prepare(`INSERT OR REPLACE INTO players_characters (id, player_id, entry_count, evolution_level,
        over_limit_step, protection, join_time, update_time, exp, stack, mana_board_index,
        ex_boost_status_id, ex_boost_ability_id_list, illustration_settings)
        VALUES (?, ?, 1, ?, 0, 0, '2025-01-01', '2025-01-01', 0, 0, 1, NULL, NULL, ?)`)
        .run(id, playerId, evolution, illustration)
}
function input({ category = 24, eventId = 700099, round = 1, accomplished = true, missing = [] } = {}) {
    const account = insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test',
        idpId: `single-reward-images-${++sequence}`, status: 'normal' })
    const playerId = insertDefaultPlayerSync(account.id).id
    ids.forEach((id, index) => {
        if (missing.includes(id)) return
        insertCharacter(playerId, id, index + 1, index === 1 ? '7' : null)
        prepare('INSERT OR REPLACE INTO players_characters_bond_tokens (mana_board_index, player_id, character_id, status) VALUES (2, ?, ?, 2)')
            .run(playerId, id)
    })
    return {
        bodyTiming: { step() {} }, playerId, viewerId: 990000000 + playerId,
        questId: eventId * 1000 + round, questCategory: category,
        questData: category === 24
            ? { rushEventId: eventId, rushEventFolderId: 1, rushEventRound: round } : {},
        questAccomplished: accomplished, clearTime: 1000,
        bodyPartyStatistics: {
            characters: ids.slice(0, 3).map(id => ({ id })),
            unison_characters: ids.slice(3).map(id => ({ id })),
            equipments: [null, null, null], ability_soul_ids: [null, null, null],
        },
    }
}
function startRun(value) {
    startAbyssEnduranceQuestSync(value.playerId, {
        category: 24, eventId: 700099, folderId: 1, round: value.questData.rushEventRound,
        questId: value.questId, totalRounds: 30,
    }, Date.now() - 1000)
}
function execute(value, overrides = {}) {
    imageCalls = []
    queries = []
    try {
        const result = runPersistenceTransactionSync({ domain: 'single-quest',
            playerId: value.playerId, operation: 'snapshot_test' }, () => (
            core(...imports.map(row => overrides[row.request] ?? row.value), value)
        ))
        return { result, calls: imageCalls, reads: queries.filter(row =>
            /^SELECT id, evolution_level, illustration_settings FROM players_characters /.test(row.sql)), queries }
    } finally { imageCalls = null; queries = null }
}
function imagesForRound(playerId, round) {
    return prepare(`SELECT rr.evolution_img_level_1 AS first, rr.evolution_img_level_2 AS second,
        rr.unison_evolution_img_level_3 AS last FROM leaderboard_run_rounds AS rr
        JOIN leaderboard_runs AS run ON run.id = rr.run_id
        WHERE run.player_id = ? AND rr.round_number = ? ORDER BY run.id DESC LIMIT 1`).get(playerId, round)
}

after(() => {
    characterLib.getCharactersEvolutionImgLevels = originalImages
    version.getPatchManifest = originalManifest
    db.close()
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir()))
    fs.rmSync(directory, { recursive: true })
})

test('Rush and a tracked endurance round share one combined image snapshot', () => {
    setLeaderboardAvailabilitySync('rush:700099:1', false)
    const value = input()
    startRun(value)
    const beforeCharacters = prepare('SELECT * FROM players_characters WHERE player_id = ? ORDER BY id').all(value.playerId)
    const beforeBonds = prepare('SELECT * FROM players_characters_bond_tokens WHERE player_id = ? ORDER BY character_id, mana_board_index').all(value.playerId)
    const sample = execute(value)
    assert.deepEqual(sample.calls, [ids])
    assert.equal(sample.reads.length, 1)
    assert.deepEqual(imagesForRound(value.playerId, 1), { first: 1, second: 7, last: 6 })
    assert.deepEqual(prepare('SELECT * FROM players_characters WHERE player_id = ? ORDER BY id').all(value.playerId), beforeCharacters)
    assert.deepEqual(prepare('SELECT * FROM players_characters_bond_tokens WHERE player_id = ? ORDER BY character_id, mana_board_index').all(value.playerId), beforeBonds)
})

test('branches that do not consume a party do not read image state', () => {
    for (const value of [input({ category: 1 }), input({ accomplished: false })]) {
        const sample = execute(value)
        assert.deepEqual(sample.calls, [])
        assert.deepEqual(sample.reads, [])
    }
    const untracked = execute(input())
    assert.deepEqual(untracked.calls, [ids], 'the real Rush handler still needs its own party record')
    assert.equal(untracked.reads.length, 1, 'an absent endurance run does not request another snapshot')
})

test('a later mode-reward call sees character changes rather than a cross-call cache', () => {
    const value = input()
    execute(value)
    prepare('UPDATE players_characters SET evolution_level = 9, illustration_settings = NULL WHERE player_id = ? AND id = ?')
        .run(value.playerId, ids[0])
    startRun(value)
    const sample = execute(value)
    assert.deepEqual(sample.calls, [ids])
    assert.equal(imagesForRound(value.playerId, 1).first, 9)
})

test('folder rewards invalidate an earlier snapshot before adding or changing characters', () => {
    const value = input({ round: 30, missing: [ids[5]] })
    startRun(value)
    const questDependency = imports.find(row => row.request === '../../quest')
    assert.ok(questDependency, 'the compiled block must call the real reward boundary')
    let rewarded = 0
    const sample = execute(value, { '../../quest': {
        ...questDependency.value,
        givePlayerRewardsSync(playerId) {
            rewarded++
            prepare('UPDATE players_characters SET evolution_level = 8, illustration_settings = NULL WHERE player_id = ? AND id = ?')
                .run(playerId, ids[0])
            insertCharacter(playerId, ids[5], 4)
            prepare('DELETE FROM players_characters_bond_tokens WHERE player_id = ? AND character_id = ?')
                .run(playerId, ids[0])
            return { items: {}, character_list: [], equipment_list: [] }
        },
    } })
    assert.equal(rewarded, 1)
    assert.deepEqual(sample.calls, [ids, ids])
    assert.equal(sample.reads.length, 2)
    assert.deepEqual(imagesForRound(value.playerId, 30), { first: 8, second: 7, last: 4 })
    assert.equal(prepare('SELECT COUNT(*) AS n FROM players_characters_bond_tokens WHERE player_id = ? AND character_id = ?')
        .get(value.playerId, ids[0]).n, 0)
})
