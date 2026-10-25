'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const Fastify = require('fastify')
const { pack, unpack } = require('msgpackr')

// The same script can reproduce a failure against the unchanged production out/.
// No import below depends on a helper introduced by the fix.
const repository = path.resolve(process.env.SINGLE_FINISH_TEST_REPO || path.join(__dirname, '..'))
const replay = process.env.SINGLE_FINISH_REPLAY ? JSON.parse(process.env.SINGLE_FINISH_REPLAY) : null
const directory = replay ? replay.directory : fs.mkdtempSync(path.join(os.tmpdir(), 'single-finish-idempotency-'))
process.env.DATA_DIR = directory
process.env.GAME_ROUTINE_LOGS = 'off'
process.env.FINISH_RESPONSE_CACHE_MAX = '32'
delete process.env.CN_WRITER_THREAD
delete process.env.QUEST_FINISH_STRICT
delete process.env.SQLITE_WRITER_EXTRA_COMMANDS
const compiled = relative => require(path.join(repository, 'out', relative))

compiled('data').initializeDatabase()
const db = compiled('data/db').getDb()
assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
const accounts = compiled('data/domains/account')
const players = compiled('data/domains/player')
const sessions = compiled('data/domains/session')
const items = compiled('data/domains/item')
const validator = compiled('lib/quest/finish/session-validator')
const writer = compiled('lib/persistence/writer-client')
const assets = compiled('lib/assets')
const { QuestCategory } = compiled('lib/types')
compiled('utils').setServerTimeOffset(0)

const BOSS = { category: QuestCategory.BOSS_BATTLE, questId: 1001001 }
const EXPERT = { category: QuestCategory.EXPERT_SINGLE_EVENT, questId: 1001 }
const FIXED = { category: QuestCategory.MAIN, questId: 12001002 }
const REWARD_ITEM = 14040
const DAILY_MISSION = 800392
const originalFindQuest = assets.getQuestFromCategorySync
let boostRewardFixture = false
// Deterministic reward inputs cross the writer boundary in questData. This is
// fixture setup, not a main-thread mock pretending to inject worker failures.
assets.getQuestFromCategorySync = (category, questId) => {
    const quest = originalFindQuest(category, questId)
    if (!quest || ![BOSS, EXPERT].some(q => q.category === Number(category) && q.questId === Number(questId))) return quest
    return {
        ...quest, rankPointReward: 14, characterExpReward: 26, poolExpReward: 26, manaReward: 135,
        clearReward: { type: 0, id: REWARD_ITEM, count: 2 },
        sPlusReward: { type: 0, id: REWARD_ITEM, count: 3 },
        scoreRewardGroupId: boostRewardFixture ? 987654321 : undefined,
        scoreRewardGroup: boostRewardFixture ? [{ name: 'boost eligibility', type: 0,
            reward_type: 0, id: REWARD_ITEM, count: 7, field5: 1, ignore_drop_multiplier: true }] : undefined,
    }
}

let single = compiled('routes/api/singleBattleQuest')
let app
let sequence = 0

async function makeApp() {
    const instance = Fastify()
    instance.addHook('onSend', (_request, reply, payload, done) => {
        done(null, reply.getHeader('content-type') === 'application/x-msgpack'
            ? pack(payload).toString('base64') : payload)
    })
    await instance.register(single.default, { prefix: '/single_battle_quest' })
    await instance.ready()
    return instance
}

function makePlayer() {
    const account = accounts.insertAccountSync({
        appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: `single-idempotency-${++sequence}`, status: 'normal',
    })
    const player = players.insertDefaultPlayerSync(account.id)
    compiled('data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    const viewerId = 871000000 + player.id
    sessions.insertSessionWithTokenSync({
        token: String(viewerId), accountId: account.id, type: 2,
        expires: new Date('2099-01-01T00:00:00Z'),
    })
    return { id: player.id, viewerId }
}

const statistics = () => ({
    clear_phase: 1, max_combo_count: 17,
    party: {
        characters: [{ id: 1 }, null, null], unison_characters: [null, null, null],
        equipments: [null, null, null], ability_soul_ids: [null, null, null],
    },
})

function start(p, playId, quest = BOSS, extra = {}) {
    return app.inject({ method: 'POST', url: '/single_battle_quest/start', payload: {
        viewer_id: p.viewerId, quest_id: quest.questId, category: quest.category, party_id: 1,
        play_id: playId, use_boss_boost_point: false, use_boost_point: false,
        is_auto_start_mode: false, api_count: 1, ...extra,
    } })
}

function finish(p, extra = {}, quest = BOSS) {
    return app.inject({ method: 'POST', url: '/single_battle_quest/finish', payload: {
        viewer_id: p.viewerId, quest_id: quest.questId, category: quest.category,
        continue_count: 0, elapsed_time_ms: 60000, score: 100, add_mana: 0,
        is_accomplished: true, is_restored: false, statistics: statistics(), ...extra,
    } })
}

function decode(response) {
    assert.equal(response.statusCode, 200, response.body)
    assert.match(response.headers['content-type'], /^application\/x-msgpack/)
    return unpack(Buffer.from(response.body, 'base64'))
}

const identifier = value => `"${value.replaceAll('"', '""')}"`
// Capture every directly player-linked table, including inventory children,
// mission facts/stages, daily points, histories and the receipt. Preserve all
// columns and timestamps; a duplicate/failure must leave exactly the same bytes.
const playerTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(({ name }) => ({ name, columns: db.prepare(`PRAGMA table_info(${identifier(name)})`).all().map(c => c.name) }))
    .filter(table => table.name === 'players' || table.columns.some(column => column === 'player_id' || column === 'source_player_id'))

function snapshot(playerId) {
    return Object.fromEntries(playerTables.map(({ name, columns }) => {
        const owner = name === 'players' ? 'id' : columns.includes('player_id') ? 'player_id' : 'source_player_id'
        const rows = db.prepare(`SELECT * FROM ${identifier(name)} WHERE ${identifier(owner)} = ?`).all(playerId)
        rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
        return [name, rows]
    }))
}

function receiptRows(playerId) {
    return db.prepare("SELECT * FROM player_operation_receipts WHERE player_id = ? AND operation = 'quest_finish.single' ORDER BY request_key").all(playerId)
}

function balances(playerId) {
    return {
        ...db.prepare('SELECT rank_point, free_mana, exp_pool, boost_point, boss_boost_point, total_mana_obtained FROM players WHERE id = ?').get(playerId),
        characterExp: db.prepare('SELECT exp FROM players_characters WHERE player_id = ? AND id = 1').get(playerId).exp,
        item: items.getPlayerItemSync(playerId, REWARD_ITEM) ?? 0,
        daily: db.prepare('SELECT progress FROM players_category_missions WHERE player_id = ? AND category = 2 AND id = ?').get(playerId, DAILY_MISSION)?.progress ?? 0,
    }
}

function assertPaid(before, after, count = 1) {
    assert.equal(after.rank_point - before.rank_point, 14 * count)
    assert.equal(after.characterExp - before.characterExp, 26 * count, 'actual party character receives EXP')
    assert.ok(after.exp_pool - before.exp_pool >= 26 * count)
    assert.ok(after.free_mana - before.free_mana >= 135 * count)
    assert.equal(after.item - before.item, 5, 'first clear and SS items are granted once per quest')
    assert.equal(after.daily - before.daily, count, 'daily battle fact counts each distinct play once')
}

function withinTimeout(promise, label) {
    let timer
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: player finish lock did not release`)), 10000) }),
    ])
}

async function replayInFreshProcess(p, playId, extra = {}) {
    const payload = { directory, player: p, playId, extra }
    const output = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [__filename], { cwd: repository, env: {
            ...process.env, SINGLE_FINISH_TEST_REPO: repository, SINGLE_FINISH_REPLAY: JSON.stringify(payload),
        }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        let stdout = '', stderr = ''
        const timeout = setTimeout(() => { child.kill(); reject(new Error(`fresh process replay timed out: ${stderr}`)) }, 30000)
        child.stdout.on('data', bytes => { stdout += bytes })
        child.stderr.on('data', bytes => { stderr += bytes })
        child.once('error', error => { clearTimeout(timeout); reject(error) })
        child.once('exit', code => {
            clearTimeout(timeout)
            if (code !== 0) return reject(new Error(`fresh process exited ${code}: ${stderr}\n${stdout}`))
            const line = stdout.split(/\r?\n/).find(value => value.startsWith('SINGLE_REPLAY_RESULT:'))
            if (!line) return reject(new Error(`fresh process emitted no replay result: ${stdout}`))
            resolve(JSON.parse(line.slice('SINGLE_REPLAY_RESULT:'.length)))
        })
    })
    return output
}

const alternateCharacter = 243001
function saveRosterParty(p, partyId = 1, leader = 1) {
    compiled('data/domains/party').updatePlayerPartySync(p.id, partyId, {
        category: 1, name: 'roster fixture', characterIds: [leader, null, null],
        unisonCharacterIds: [null, null, null], equipmentIds: [null, null, null], abilitySoulIds: [null, null, null],
        edited: true, options: { allowOtherPlayersToHealMe: true },
    }, 1)
}
function rosterPlayer() {
    const p = makePlayer()
    assert.ok(compiled('lib/character').givePlayerCharacterSync(p.id, alternateCharacter))
    const characters = compiled('data/domains/character')
    for (const id of [1, alternateCharacter]) characters.updatePlayerCharacterSync(p.id, id, { exp: 0 })
    saveRosterParty(p)
    saveRosterParty(p, 2, alternateCharacter)
    players.updatePlayerSync({ id: p.id, partySlot: 1 })
    return p
}
function reportedRoster(leader = alternateCharacter) {
    const value = statistics()
    value.party.characters[0] = { id: leader }
    return value
}
const characterExp = (p, id) => compiled('data/domains/character').getPlayerCharacterSync(p.id, id).exp
function assertRosterFacts(p, leader, other) {
    const facts = compiled('data/domains/character_clear')
    assert.equal(facts.getPlayerCharacterClearSync(p.id, leader).leader_clear_count, 1)
    assert.equal(facts.getPlayerCharacterClearSync(p.id, other).clear_count, 0)
    const progress = compiled('data/domains/quest').getPlayerSingleQuestProgressSync(p.id, BOSS.category, BOSS.questId)
    assert.equal(progress.leaderCharacterId, leader)
}

if (replay) {
    void (async () => {
        app = await makeApp()
        try {
            const response = decode(await finish(replay.player, { ...replay.extra, play_id: replay.playId, api_count: 99 }))
            console.log(`SINGLE_REPLAY_RESULT:${JSON.stringify(response)}`)
        } finally {
            await app.close()
            db.close()
        }
    })().catch(error => { console.error(error); process.exitCode = 1 })
} else {
    test.before(async () => { app = await makeApp() })
    test.after(async () => {
        await writer.stopSqliteWriter()
        if (app) await app.close()
        assets.getQuestFromCategorySync = originalFindQuest
        if (db.open) db.close()
        const actual = fs.realpathSync(directory)
        assert.equal(path.dirname(actual), fs.realpathSync(os.tmpdir()))
        fs.rmSync(actual, { recursive: true })
    })

    for (const mode of ['in-process', 'writer']) {
        test(`single finish idempotency (${mode})`, async t => {
            if (mode === 'writer') {
                process.env.CN_WRITER_THREAD = '1'
                assert.equal(writer.startSqliteWriter(db.name), true)
                assert.equal(await writer.waitForSqliteWriterReady(30000), true)
            }
            const workerBefore = writer.sqliteWriterStats()
            const selected = process.env.SINGLE_FINISH_TEST_CASES?.split(',')
            const roster = (title, callback) => !selected || selected.includes('roster') ? t.test(title, callback) : Promise.resolve()

            await t.test('malformed boost flags cannot register a battle or change player state', async () => {
                const p = makePlayer(), before = snapshot(p.id)
                for (const value of ['true', 'false', 1, 0, null, [], {}]) {
                    for (const key of ['use_boost_point', 'use_boss_boost_point']) {
                        assert.equal((await start(p, 'invalid-boost', BOSS, { [key]: value })).statusCode, 400)
                        assert.deepEqual(snapshot(p.id), before)
                    }
                }
            })

            await t.test('invalid field mana leaves the exact pending battle and rewards untouched', async () => {
                const p = makePlayer(), playId = `invalid-field-${p.id}`
                decode(await start(p, playId))
                const before = snapshot(p.id), memory = structuredClone(single.activeQuests[p.id])
                for (const value of [-1, 0.5, '100', true, null, {}, [], 0x80000000]) {
                    const response = await finish(p, { play_id: playId, add_mana: value })
                    assert.equal(response.statusCode, 400, response.body)
                    assert.deepEqual(snapshot(p.id), before)
                    assert.deepEqual(single.activeQuests[p.id], memory)
                }
                decode(await finish(p, { play_id: playId, add_mana: 12 }))
            })

            await t.test('large, accumulated and omitted field mana retain native rewards and replay exactly once', async () => {
                for (const value of [0, 98765, 0x7fffffff, undefined]) {
                    const p = makePlayer(), playId = `valid-field-${p.id}`
                    decode(await start(p, playId))
                    const before = balances(p.id), amount = value ?? 0
                    const result = decode(await finish(p, { play_id: playId, add_mana: value }))
                    const after = balances(p.id)
                    assert.equal(result.data.rewards.field_mana, amount)
                    assert.equal(result.data.rewards.reward_mana, 135)
                    assert.equal(after.total_mana_obtained - before.total_mana_obtained, 135 + amount)
                    const settled = snapshot(p.id)
                    assert.deepEqual(decode(await finish(p, { play_id: playId, add_mana: -1, api_count: 9 })).data, result.data)
                    assert.deepEqual(snapshot(p.id), settled)
                }
            })

            await t.test('writer rechecks raw field mana and preserves precision-limited lifetime statistics', async () => {
                const p = makePlayer(), playId = `writer-field-${p.id}`
                decode(await start(p, playId))
                const before = snapshot(p.id), persistence = compiled('lib/persistence-coordinator')
                const dispatch = persistence.runWriterCommand
                const command = compiled('lib/persistence/command-names').SINGLE_SETTLE_FINISH
                persistence.runWriterCommand = (name, args, options) => dispatch(name, name === command
                    ? { ...args, body: { ...args.body, add_mana: -1 }, manaObtained: 135 } : args, options)
                try { assert.equal((await finish(p, { play_id: playId })).statusCode, 400) }
                finally { persistence.runWriterCommand = dispatch }
                assert.deepEqual(snapshot(p.id), before)
                players.updatePlayerSync({ id: p.id, totalManaObtained: Number.MAX_SAFE_INTEGER - 100 })
                const limited = players.getPlayerSync(p.id)
                const result = decode(await finish(p, { play_id: playId, add_mana: 8 }))
                const paid = players.getPlayerSync(p.id)
                assert.equal(paid.totalManaObtained, limited.totalManaObtained)
                assert.equal(paid.freeMana, Math.min(compiled('lib/mana').getMaxManaSync() - paid.paidMana, limited.freeMana + 143))
                assert.equal(result.data.rewards.field_mana, 8)
                const settled = snapshot(p.id)
                decode(await finish(p, { play_id: playId, api_count: 9 }))
                assert.deepEqual(snapshot(p.id), settled)
            })

            await t.test('boost selection cannot make an exhausted balance negative and replay never charges again', async () => {
                for (const useBoss of [false, true]) {
                    const p = makePlayer(), playId = `boost-exhausted-${p.id}`
                    players.updatePlayerSync({ id: p.id, boostPoint: 1, bossBoostPoint: 1 })
                    decode(await start(p, playId, BOSS, { use_boost_point: !useBoss, use_boss_boost_point: useBoss }))
                    players.updatePlayerSync({ id: p.id, boostPoint: 0, bossBoostPoint: 0 })
                    const result = decode(await finish(p, { play_id: playId }))
                    assert.equal(result.data.user_info.boost_point, 0)
                    assert.equal(result.data.user_info.boss_boost_point, 0)
                    const settled = snapshot(p.id)
                    assert.deepEqual(decode(await finish(p, { play_id: playId, api_count: 8 })).data, result.data)
                    assert.deepEqual(snapshot(p.id), settled)
                }
            })

            await t.test('score drops double only when a selected point was actually consumed', async () => {
                boostRewardFixture = true
                try {
                    for (const available of [0, 1]) {
                        const p = makePlayer(), playId = `boost-reward-${p.id}`
                        players.updatePlayerSync({ id: p.id, boostPoint: available, bossBoostPoint: 0 })
                        decode(await start(p, playId, BOSS, { use_boost_point: true }))
                        const before = items.getPlayerItemSync(p.id, REWARD_ITEM) ?? 0
                        decode(await finish(p, { play_id: playId }))
                        assert.equal(items.getPlayerItemSync(p.id, REWARD_ITEM) - before, 5 + 7 * (available ? 2 : 1))
                        assert.equal(players.getPlayerSync(p.id).boostPoint, 0)
                    }
                } finally { boostRewardFixture = false }
            })

            await t.test('available boost is consumed once and receipt failure rolls it back with rewards', async () => {
                const p = makePlayer(), playId = `boost-rollback-${p.id}`
                players.updatePlayerSync({ id: p.id, boostPoint: 2, bossBoostPoint: 1 })
                decode(await start(p, playId, BOSS, { use_boost_point: true, use_boss_boost_point: true }))
                const before = snapshot(p.id), memory = structuredClone(single.activeQuests[p.id])
                db.exec(`CREATE TRIGGER boost_receipt_fault BEFORE INSERT ON player_operation_receipts
                    WHEN NEW.player_id=${p.id} AND NEW.operation='quest_finish.single'
                    BEGIN SELECT RAISE(ABORT, 'boost receipt fault'); END`)
                try { assert.equal((await finish(p, { play_id: playId })).statusCode, 500) }
                finally { db.exec('DROP TRIGGER boost_receipt_fault') }
                assert.deepEqual(snapshot(p.id), before); assert.deepEqual(single.activeQuests[p.id], memory)
                const result = decode(await finish(p, { play_id: playId }))
                assert.equal(result.data.user_info.boost_point, 1)
                assert.equal(result.data.user_info.boss_boost_point, 0)
                const settled = snapshot(p.id)
                decode(await finish(p, { play_id: playId, api_count: 9 }))
                assert.deepEqual(snapshot(p.id), settled)
            })

            await roster('start freezes the actual SET through edits, another selected slot and same-play retries', async () => {
                const p = rosterPlayer(), playId = `roster-switch-${p.id}`
                decode(await start(p, playId))
                const pending = db.prepare('SELECT * FROM players_active_quests WHERE player_id=?').get(p.id)
                saveRosterParty(p, 1, alternateCharacter)
                players.updatePlayerSync({ id: p.id, partySlot: 2 })
                decode(await start(p, playId, BOSS, { api_count: 9 }))
                assert.deepEqual(db.prepare('SELECT * FROM players_active_quests WHERE player_id=?').get(p.id), pending,
                    'retry cannot replace the original roster with the edited SET')
                const before = balances(p.id)
                const first = decode(await finish(p, { play_id: playId, statistics: reportedRoster() }))
                assert.equal(characterExp(p, 1), 26, 'the original leader receives EXP')
                assert.equal(characterExp(p, alternateCharacter), 0, 'the later SET/finish leader receives no EXP')
                assert.equal(balances(p.id).exp_pool - before.exp_pool, 26)
                assertRosterFacts(p, 1, alternateCharacter)
                assert.deepEqual(first.data.add_exp_list.map(row => row.character_id), [1])
                const paid = snapshot(p.id)
                assert.deepEqual(decode(await finish(p, { play_id: playId, statistics: reportedRoster(1), api_count: 88 })), first)
                assert.deepEqual(snapshot(p.id), paid)
            })

            await roster('malformed and duplicate finish rosters cannot change EXP, pool overflow, tasks or the pending play', async () => {
                const p = rosterPlayer(), playId = `roster-invalid-${p.id}`
                decode(await start(p, playId))
                const before = snapshot(p.id), memory = structuredClone(single.activeQuests[p.id])
                const duplicate = reportedRoster(1); duplicate.party.unison_characters[0] = { id: 1 }
                const tooLong = reportedRoster(1); tooLong.party.characters.push({ id: alternateCharacter })
                const wrongType = reportedRoster(1); wrongType.party.characters[0].id = '1'
                for (const stats of [duplicate, tooLong, wrongType, { ...statistics(), party: null }]) {
                    const rejected = await finish(p, { play_id: playId, statistics: stats })
                    assert.equal(rejected.statusCode, 400, rejected.body)
                    assert.deepEqual(snapshot(p.id), before, 'no repeated EXP or pool overflow is paid for an invalid party')
                    assert.deepEqual(single.activeQuests[p.id], memory)
                }
                decode(await finish(p, { play_id: playId }))
                assert.equal(characterExp(p, 1), 26)
                assert.equal(characterExp(p, alternateCharacter), 0)
            })

            await roster('a fresh process before settlement uses the durable original roster without an in-memory active quest', async () => {
                const p = rosterPlayer(), playId = `roster-restart-${p.id}`
                decode(await start(p, playId))
                saveRosterParty(p, 1, alternateCharacter)
                players.updatePlayerSync({ id: p.id, partySlot: 2 })
                delete single.activeQuests[p.id]
                assert.equal(receiptRows(p.id).length, 0)
                await replayInFreshProcess(p, playId, { statistics: reportedRoster() })
                assert.equal(characterExp(p, 1), 26)
                assert.equal(characterExp(p, alternateCharacter), 0)
                assertRosterFacts(p, 1, alternateCharacter)
                assert.equal(receiptRows(p.id).length, 1)
                const paid = snapshot(p.id)
                decode(await finish(p, { play_id: playId, api_count: 101 }))
                assert.deepEqual(snapshot(p.id), paid)
            })

            await roster('a legacy NULL roster validates the reported owned party without reconstructing today\'s SET', async () => {
                const p = rosterPlayer(), playId = `roster-legacy-${p.id}`
                decode(await start(p, playId))
                const columns = db.prepare('PRAGMA table_info(players_active_quests)').all().map(row => row.name)
                if (columns.includes('battle_roster_json')) db.prepare('UPDATE players_active_quests SET battle_roster_json=NULL WHERE player_id=?').run(p.id)
                delete single.activeQuests[p.id]
                saveRosterParty(p, 1, alternateCharacter)
                decode(await finish(p, { play_id: playId, statistics: reportedRoster(1) }))
                assert.equal(characterExp(p, 1), 26)
                assert.equal(characterExp(p, alternateCharacter), 0)
                assertRosterFacts(p, 1, alternateCharacter)
            })

            await roster('the last receipt SQL failure restores the frozen roster and all reward and mission writes', async () => {
                const p = rosterPlayer(), playId = `roster-rollback-${p.id}`
                decode(await start(p, playId))
                saveRosterParty(p, 1, alternateCharacter)
                const before = snapshot(p.id), memory = structuredClone(single.activeQuests[p.id])
                const previousStats = writer.sqliteWriterStats()
                db.exec(`CREATE TRIGGER single_roster_receipt_failure BEFORE INSERT ON player_operation_receipts
                    WHEN NEW.player_id=${p.id} AND NEW.operation='quest_finish.single'
                    BEGIN SELECT RAISE(ABORT, 'injected single roster receipt failure'); END`)
                try {
                    const failed = await finish(p, { play_id: playId, statistics: reportedRoster() })
                    assert.equal(failed.statusCode, 500, failed.body)
                    assert.match(failed.body, /injected single roster receipt failure/)
                    assert.deepEqual(snapshot(p.id), before)
                    assert.deepEqual(single.activeQuests[p.id], memory)
                    if (mode === 'writer') assert.ok(writer.sqliteWriterStats().failed > previousStats.failed)
                } finally { db.exec('DROP TRIGGER single_roster_receipt_failure') }
                decode(await finish(p, { play_id: playId, statistics: reportedRoster() }))
                assert.equal(characterExp(p, 1), 26)
                assert.equal(characterExp(p, alternateCharacter), 0)
                assertRosterFacts(p, 1, alternateCharacter)
            })

            await roster('real fixed-party quests preserve their no-owned-character EXP behavior', async () => {
                const p = rosterPlayer(), playId = `roster-fixed-${p.id}`
                assert.ok(originalFindQuest(FIXED.category, FIXED.questId).fixedParty)
                const first = decode(await start(p, playId, FIXED))
                assert.equal(first.data_headers.result_code, 1)
                const pending = db.prepare('SELECT * FROM players_active_quests WHERE player_id=?').get(p.id)
                saveRosterParty(p, 1, alternateCharacter)
                decode(await start(p, playId, FIXED))
                assert.deepEqual(db.prepare('SELECT * FROM players_active_quests WHERE player_id=?').get(p.id), pending)
                const fixedStats = reportedRoster(1)
                fixedStats.party.unison_characters[0] = { id: 1 }
                decode(await finish(p, { play_id: playId, statistics: fixedStats }, FIXED))
                assert.equal(characterExp(p, 1), 0)
                assert.equal(characterExp(p, alternateCharacter), 0)
            })

            await roster('reserved recommended-party starts retain bounded owned-party compatibility', async () => {
                const p = rosterPlayer(), playId = `roster-recommended-${p.id}`
                const started = decode(await start(p, playId, BOSS, { party_id: 1000 }))
                assert.equal(started.data_headers.result_code, 1)
                decode(await finish(p, { play_id: playId, statistics: reportedRoster() }))
                assert.equal(characterExp(p, alternateCharacter), 26)
                assert.equal(characterExp(p, 1), 0)
            })

            if (!selected || selected.includes('existing')) {
            await t.test('concurrent duplicate pays all rewards once, then every replay writes nothing', async () => {
                const p = makePlayer()
                assert.equal((await start(p, 'concurrent')).statusCode, 200)
                const before = balances(p.id)
                const [a, b] = await Promise.all([
                    finish(p, { play_id: 'concurrent', api_count: 2 }),
                    finish(p, { play_id: 'concurrent', api_count: 3 }),
                ])
                assert.deepEqual(decode(b), decode(a))
                assertPaid(before, balances(p.id))
                assert.equal(receiptRows(p.id).length, 1)
                assert.equal(db.prepare('SELECT COUNT(*) n FROM battle_settlement_ledger WHERE player_id=?').get(p.id).n, 1)
                const settled = snapshot(p.id)
                decode(await finish(p, { play_id: 'concurrent', api_count: 8 }))
                assert.deepEqual(snapshot(p.id), settled)
                assert.equal(db.prepare('SELECT COUNT(*) AS n FROM players_active_quests WHERE player_id = ?').get(p.id).n, 0)
            })

            await t.test('same pending start preserves its clock and all costs; terminal ids cannot replace a new play', async () => {
                const p = makePlayer()
                assert.equal((await start(p, 'start-retry')).statusCode, 200)
                db.prepare('UPDATE players_active_quests SET started_at_ms=started_at_ms-60000 WHERE player_id=?').run(p.id)
                single.activeQuests[p.id].startedAtMs -= 60000
                const pending = snapshot(p.id), memory = structuredClone(single.activeQuests[p.id])
                assert.equal((await start(p, 'start-retry')).statusCode, 200)
                assert.deepEqual(snapshot(p.id), pending, 'retry must not reset clock, challenge facts or nominal stamina counters')
                assert.deepEqual(single.activeQuests[p.id], memory)
                const mismatch = await start(p, 'start-retry', BOSS, { party_id: 2 })
                assert.equal(mismatch.statusCode, 400, mismatch.body)
                assert.deepEqual(snapshot(p.id), pending)
                decode(await finish(p, { play_id: 'start-retry', api_count: 2 }))
                assert.equal((await start(p, 'new-after-terminal')).statusCode, 200)
                const newer = snapshot(p.id), newerMemory = structuredClone(single.activeQuests[p.id])
                const terminal = await start(p, 'start-retry')
                assert.equal(terminal.statusCode, 400, terminal.body)
                assert.deepEqual(snapshot(p.id), newer)
                assert.deepEqual(single.activeQuests[p.id], newerMemory)
            })

            await t.test('24-hour expiry and payload deletion block explicit and tokenless cached retries without paying again', async () => {
                const p = makePlayer(), playId = 'expired-result'
                assert.equal((await start(p, playId)).statusCode, 200)
                decode(await finish(p, { api_count: 2 }))
                const cache = compiled('lib/finish-response-cache')
                const alias = cache.buildFinishResponseCacheKey('single', p.viewerId, { category: BOSS.category, quest_id: BOSS.questId, api_count: 2 })
                assert.equal(cache.getCachedFinishPlayId(alias), playId)
                assert.ok(cache.getCachedFinishResponse(alias), 'cached alias is deliberately still live')
                const expiredAt = Date.now() - 24 * 60 * 60 * 1000
                db.transaction(() => {
                    db.prepare("UPDATE player_operation_receipts SET created_at=? WHERE player_id=? AND operation='quest_finish.single'").run(expiredAt, p.id)
                    db.prepare('UPDATE battle_settlement_ledger SET settled_at=? WHERE player_id=?').run(expiredAt, p.id)
                    db.prepare('UPDATE battle_receipt_payload_queue SET created_at=? WHERE player_id=?').run(expiredAt, p.id)
                })()
                for (const prune of [false, true]) {
                    if (prune) db.prepare("DELETE FROM player_operation_receipts WHERE player_id=? AND operation='quest_finish.single'").run(p.id)
                    const settled = snapshot(p.id)
                    for (const request of [{ play_id: playId, api_count: 3 }, { api_count: 2 }]) {
                        const rejected = await finish(p, request)
                        assert.equal(rejected.statusCode, 400, rejected.body)
                    }
                    assert.equal((await start(p, playId)).statusCode, 400)
                    assert.deepEqual(snapshot(p.id), settled, 'guard blocks expired replay, alias and old start even without response bytes')
                }
                assert.equal((await start(p, 'fresh-after-expiry')).statusCode, 200)
                const newer = snapshot(p.id)
                assert.equal((await finish(p, { play_id: playId, api_count: 4 })).statusCode, 400)
                assert.equal((await start(p, playId)).statusCode, 400)
                assert.deepEqual(snapshot(p.id), newer, 'expired play cannot consume or replace a newer registration')
            })

            await t.test('queued writer rechecks a terminal identity inserted after route preparation', async t => {
                const p = makePlayer(), playId = 'queued-terminal'
                assert.equal((await start(p, playId)).statusCode, 200)
                const coordinator = compiled('lib/persistence-coordinator'), original = coordinator.runWriterCommand
                let intercepted = false, terminalSnapshot
                const hook = t.mock.method(coordinator, 'runWriterCommand', async (name, args, context) => {
                    if (name === 'single.settle_finish' && args.playerId === p.id && !intercepted) {
                        intercepted = true
                        db.transaction(() => {
                            const terminal = compiled('data/domains/battle-settlement-ledger').insertBattleSettlementSync(p.id, playId, 'multi', Date.now() - 86400000)
                            compiled('data/domains/player-operation-receipt').insertPlayerOperationReceiptSync({
                                playerId: p.id, operation: 'quest_finish.multi', requestKey: playId,
                                response: { data_headers: {}, data: { is_multi: 'multi', user_info: {}, rewards: {} } },
                            }, terminal.settledAtMs)
                        })()
                        terminalSnapshot = snapshot(p.id)
                    }
                    return original(name, args, context)
                })
                try {
                    const rejected = await finish(p, { play_id: playId, api_count: 2 })
                    assert.equal(rejected.statusCode, 400, rejected.body)
                    assert.equal(intercepted, true)
                    assert.deepEqual(snapshot(p.id), terminalSnapshot, 'actual writer blocks another mode without consuming the pending active row')
                } finally { hook.mock.restore() }
            })

            await t.test('ledger insertion failure rolls back rewards, receipt and active consumption', async () => {
                const p = makePlayer(), playId = 'ledger-failure'
                assert.equal((await start(p, playId)).statusCode, 200)
                const before = snapshot(p.id), memory = structuredClone(single.activeQuests[p.id])
                db.exec(`CREATE TRIGGER single_ledger_failure BEFORE INSERT ON battle_settlement_ledger
                    WHEN NEW.player_id=${p.id} BEGIN SELECT RAISE(ABORT, 'injected ledger failure'); END`)
                try {
                    const rejected = await finish(p, { play_id: playId, api_count: 2 })
                    assert.equal(rejected.statusCode, 500, rejected.body)
                    assert.match(rejected.body, /injected ledger failure/)
                    assert.deepEqual(snapshot(p.id), before)
                    assert.deepEqual(single.activeQuests[p.id], memory)
                } finally { db.exec('DROP TRIGGER single_ledger_failure') }
                decode(await finish(p, { play_id: playId, api_count: 3 }))
                const settled = snapshot(p.id)
                decode(await finish(p, { play_id: playId, api_count: 4 }))
                assert.deepEqual(snapshot(p.id), settled)
            })

            await t.test('durable replay survives loss of memory and a fresh process', async () => {
                const p = makePlayer()
                assert.equal((await start(p, 'restart')).statusCode, 200)
                const first = decode(await finish(p, { play_id: 'restart', api_count: 2 }))
                const settled = snapshot(p.id)
                delete single.activeQuests[p.id]
                const cache = compiled('lib/finish-response-cache')
                for (let i = 0; i < 40; i++) cache.cacheFinishResponse(`filler:${mode}:${i}`, {})
                // A separate process has no response cache, active registration,
                // module registry or finish locks from the original request.
                const second = await replayInFreshProcess(p, 'restart')
                assert.deepEqual(second.data, first.data)
                assert.deepEqual(snapshot(p.id), settled)
                for (const corrupt of ['null', '{}']) {
                    db.prepare("UPDATE player_operation_receipts SET response_json = ? WHERE player_id = ? AND operation = 'quest_finish.single'").run(corrupt, p.id)
                    for (let i = 0; i < 40; i++) cache.cacheFinishResponse(`corrupt:${mode}:${corrupt}:${i}`, {})
                    const damaged = snapshot(p.id)
                    const rejected = await finish(p, { play_id: 'restart', api_count: 101 })
                    assert.equal(rejected.statusCode, 400, rejected.body)
                    assert.deepEqual(snapshot(p.id), damaged, 'damaged receipt still blocks another payout')
                }
            })

            await t.test('unregistered plays are rejected and three registered plays settle with deduplication', async () => {
                const p = makePlayer()
                const untouched = snapshot(p.id)
                const unknown = await finish(p, { play_id: 'unregistered-old', api_count: 2 })
                assert.equal(unknown.statusCode, 400, unknown.body)
                assert.deepEqual(snapshot(p.id), untouched, 'unknown play cannot write any player-linked state')
                const before = balances(p.id)
                assert.equal((await start(p, 'registered-1')).statusCode, 200)
                decode(await finish(p, { play_id: 'registered-1', api_count: 2 }))
                assert.equal((await start(p, 'registered-2')).statusCode, 200)
                decode(await finish(p, { play_id: 'registered-2', api_count: 3 }))
                assert.equal((await start(p, 'registered-3')).statusCode, 200)
                const [a, b] = await Promise.all([
                    finish(p, { play_id: 'registered-3', api_count: 4 }),
                    finish(p, { play_id: 'registered-3', api_count: 5 }),
                ])
                assert.deepEqual(decode(a), decode(b))
                assertPaid(before, balances(p.id), 3)
                assert.equal(receiptRows(p.id).length, 3)
            })

            await t.test('tokenless finishes require a registration and each registered play owns its durable identity', async () => {
                const p = makePlayer()
                const untouched = snapshot(p.id)
                const rejected = await Promise.all([finish(p), finish(p), finish(p)])
                rejected.forEach(response => assert.equal(response.statusCode, 400, response.body))
                assert.deepEqual(snapshot(p.id), untouched, 'missing request identity cannot create a playable registration or payout')
                const before = balances(p.id)
                for (const playId of ['tokenless-1', 'tokenless-2', 'tokenless-3']) {
                    assert.equal((await start(p, playId)).statusCode, 200)
                    decode(await finish(p))
                }
                assertPaid(before, balances(p.id), 3)
                assert.deepEqual(receiptRows(p.id).map(row => row.request_key), ['tokenless-1', 'tokenless-2', 'tokenless-3'], 'durable identity comes from each real registration')

                // The old /start accepted an omitted/empty play_id. Such a
                // malformed historical row cannot produce a permanent guard;
                // valid tokenless finishes above still bind to their active ID.
                const malformed = makePlayer()
                assert.equal((await start(malformed, 'before-empty-fixture')).statusCode, 200)
                db.prepare("UPDATE players_active_quests SET play_id='' WHERE player_id=? AND play_id='before-empty-fixture'").run(malformed.id)
                single.activeQuests[malformed.id].playId = ''
                const malformedBefore = snapshot(malformed.id)
                const noIdentity = await finish(malformed, { api_count: 2 })
                assert.equal(noIdentity.statusCode, 400, noIdentity.body)
                assert.deepEqual(snapshot(malformed.id), malformedBefore, 'empty historical identity must not pay without a guard')
            })

            await t.test('settlement reads fresh balances after session validation', async t => {
                const p = makePlayer()
                assert.equal((await start(p, 'fresh')).statusCode, 200)
                const before = balances(p.id)
                const original = validator.validateSessionAndPlayer
                let injected = false
                t.mock.method(validator, 'validateSessionAndPlayer', async viewerId => {
                    const result = await original(viewerId)
                    if (viewerId === p.viewerId && !injected) {
                        injected = true
                        db.prepare('UPDATE players SET rank_point = rank_point + 5, free_mana = free_mana + 7, boost_point = boost_point + 1, boss_boost_point = boss_boost_point + 1, total_mana_obtained = total_mana_obtained + 11 WHERE id = ?').run(p.id)
                    }
                    return result
                })
                const data = decode(await finish(p, { play_id: 'fresh', api_count: 2 })).data
                const after = balances(p.id)
                assert.equal(after.rank_point, before.rank_point + 5 + 14)
                assert.equal(data.before_rank_point, before.rank_point + 5)
                assert.equal(data.user_info.rank_point, after.rank_point)
                assert.ok(after.free_mana >= before.free_mana + 7 + 135)
                assert.equal(data.user_info.free_mana, after.free_mana)
                assert.equal(after.boost_point, before.boost_point + 1)
                assert.equal(after.boss_boost_point, before.boss_boost_point + 1)
                assert.ok(after.total_mana_obtained >= before.total_mana_obtained + 11 + 135)
                assert.equal(injected, true)
            })

            await t.test('a persisted legacy version-zero play restores and settles once without migration', async () => {
                const clock = compiled('utils')
                const originalOffset = clock.getLegacyTimeOffset()
                const legacyOffset = -421 * 86400_000
                clock.setServerTimeOffset(legacyOffset)
                try {
                    const p = makePlayer()
                    assert.equal((await start(p, 'legacy-durable')).statusCode, 200)
                    const registered = db.prepare('SELECT * FROM players_active_quests WHERE player_id=?').get(p.id)
                    assert.equal(registered.clock_version, 1)
                    db.prepare('UPDATE players_active_quests SET clock_version=0,started_at_ms=? WHERE player_id=?')
                        .run(registered.started_at_ms + legacyOffset, p.id)
                    delete single.activeQuests[p.id]
                    const schemaBefore = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
                    const before = balances(p.id)
                    const first = decode(await finish(p, { play_id: 'legacy-durable', api_count: 2 }))
                    assertPaid(before, balances(p.id))
                    assert.equal(receiptRows(p.id).length, 1)
                    const settled = snapshot(p.id)
                    assert.deepEqual(decode(await finish(p, { play_id: 'legacy-durable', api_count: 3 })), first)
                    assert.deepEqual(snapshot(p.id), settled)
                    assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all(), schemaBefore,
                        'restoring an existing play cannot configure cutover or create migration tables')
                } finally { clock.setServerTimeOffset(originalOffset) }
            })

            await t.test('receipt failure rolls back the entire reward chain and permits the same play retry', async () => {
                const operations = compiled('lib/content-operations'), store = operations.contentOperations()
                const member = `${EXPERT.category}:${EXPERT.questId}`
                const key = operations.contentCatalog.questMap[member]
                assert.equal(key, 'expert_single_event:1')
                const action = { enabled: true, endsAtMs: null, readiness: 'verified', evidence: 'Isolated native Expert entry and daily-point rollback fixture' }
                store.update(key, { expectedRevision: store.revision(), catalogDigest: store.digest,
                    reason: 'Explicit reviewed Expert fixture; retain original point and finish rules',
                    actionOverrides: { visible: action, enter: { ...action, questKeys: [member] } } }, Date.now())
                assert.equal(operations.contentQuestDecision(EXPERT.category, EXPERT.questId), true)
                const p = makePlayer()
                assert.equal(decode(await start(p, 'rollback', EXPERT)).data_headers.result_code, 1)
                const before = snapshot(p.id)
                const registered = structuredClone(single.activeQuests[p.id])
                assert.equal(registered.playId, 'rollback', 'successful start must register the actual Expert play')
                const pointBefore = db.prepare('SELECT point FROM daily_challenge_point_list_entries WHERE player_id = ? AND id = 1').get(p.id).point
                assert.ok(pointBefore > 0, 'fixture must exercise daily point consumption')
                // A durable trigger is seen by the writer's separate connection.
                db.exec(`CREATE TRIGGER single_finish_receipt_failure BEFORE INSERT ON player_operation_receipts
                    WHEN NEW.player_id = ${p.id} AND NEW.operation = 'quest_finish.single'
                    BEGIN SELECT RAISE(ABORT, 'injected single receipt failure'); END`)
                const statsBefore = writer.sqliteWriterStats()
                try {
                    const failure = await withinTimeout(finish(p, { play_id: 'rollback', api_count: 2 }, EXPERT), 'failed finish')
                    assert.equal(failure.statusCode, 500, failure.body)
                    assert.match(failure.body, /injected single receipt failure/)
                    assert.deepEqual(snapshot(p.id), before, 'all player-linked writes and active-row consumption roll back')
                    assert.deepEqual(single.activeQuests[p.id], registered)
                    assert.equal(receiptRows(p.id).length, 0)
                    if (mode === 'writer') assert.ok(writer.sqliteWriterStats().failed > statsBefore.failed, 'failure executed in the real writer')
                } finally {
                    db.exec('DROP TRIGGER single_finish_receipt_failure')
                }
                const first = decode(await withinTimeout(finish(p, { play_id: 'rollback', api_count: 3 }, EXPERT), 'same play retry'))
                assert.equal(items.getPlayerItemSync(p.id, REWARD_ITEM), 5)
                assert.equal(db.prepare('SELECT point FROM daily_challenge_point_list_entries WHERE player_id = ? AND id = 1').get(p.id).point, pointBefore - 1)
                assert.equal(receiptRows(p.id).length, 1)
                const settled = snapshot(p.id)
                assert.deepEqual(decode(await finish(p, { play_id: 'rollback', api_count: 4 }, EXPERT)).data, first.data)
                assert.deepEqual(snapshot(p.id), settled)
            })

            await t.test('old finished or unregistered plays cannot consume a newer start', async t => {
                const p = makePlayer()
                assert.equal((await start(p, 'old')).statusCode, 200)
                const oldResponse = decode(await finish(p, { play_id: 'old', api_count: 2 }))
                assert.equal((await start(p, 'new')).statusCode, 200)
                const newer = snapshot(p.id)
                const registered = structuredClone(single.activeQuests[p.id])
                assert.deepEqual(decode(await finish(p, { play_id: 'old', api_count: 3 })).data, oldResponse.data)
                assert.deepEqual(snapshot(p.id), newer)
                assert.deepEqual(single.activeQuests[p.id], registered)
                const rejected = await finish(p, { play_id: 'unknown-old', api_count: 4 })
                assert.equal(rejected.statusCode, 400, rejected.body)
                assert.deepEqual(snapshot(p.id), newer)
                assert.deepEqual(single.activeQuests[p.id], registered)
                // Remove memory to force the database/rebuilt resolver branch.
                delete single.activeQuests[p.id]
                const mismatched = await finish(p, { play_id: 'unknown-other', api_count: 5 }, EXPERT)
                assert.equal(mismatched.statusCode, 400, mismatched.body)
                assert.deepEqual(snapshot(p.id), newer)
                decode(await withinTimeout(finish(p, { play_id: 'new', api_count: 6 }), 'new registered play'))
                assert.equal(receiptRows(p.id).length, 2)

                // Legacy clients omit play_id at finish and reuse api_count in
                // a new battle. The current /start registration owns identity.
                const legacy = makePlayer()
                assert.equal((await start(legacy, 'legacy-a')).statusCode, 200)
                decode(await finish(legacy, { api_count: 2 }))
                const afterA = balances(legacy.id)
                assert.equal((await start(legacy, 'legacy-b')).statusCode, 200)
                decode(await finish(legacy, { api_count: 2 }))
                const afterB = balances(legacy.id)
                assert.equal(afterB.rank_point - afterA.rank_point, 14)
                assert.equal(afterB.characterExp - afterA.characterExp, 26)
                assert.equal(afterB.daily - afterA.daily, 1)
                assert.deepEqual(receiptRows(legacy.id).map(row => row.request_key), ['legacy-a', 'legacy-b'])

                // Hold the route immediately before dispatch, after it already
                // captured either a registered or rebuilt active quest. A new
                // /start now lands before the transaction reads/consumes it.
                for (const registeredOld of [true, false]) {
                    const raced = makePlayer()
                    if (registeredOld) assert.equal((await start(raced, 'queued-old')).statusCode, 200)
                    const coordinator = compiled('lib/persistence-coordinator')
                    const originalCommand = coordinator.runWriterCommand
                    let signalReached, releaseCommand
                    const reached = new Promise(resolve => { signalReached = resolve })
                    const released = new Promise(resolve => { releaseCommand = resolve })
                    let paused = false
                    const hook = t.mock.method(coordinator, 'runWriterCommand', async (name, args, context) => {
                        if (name === 'single.settle_finish' && args.playerId === raced.id && !paused) {
                            paused = true
                            signalReached()
                            await released
                        }
                        return originalCommand(name, args, context)
                    })
                    const pending = finish(raced, { play_id: 'queued-old', api_count: 2 })
                    try {
                        await withinTimeout(reached, 'captured old finish')
                        assert.equal((await start(raced, 'queued-new')).statusCode, 200)
                        const newState = snapshot(raced.id)
                        const newMemory = structuredClone(single.activeQuests[raced.id])
                        releaseCommand()
                        const rejectedOld = await withinTimeout(pending, 'old queued finish')
                        assert.equal(rejectedOld.statusCode, 400, rejectedOld.body)
                        assert.deepEqual(snapshot(raced.id), newState, `${registeredOld ? 'registered' : 'rebuilt'} old transaction preserves new registration`)
                        assert.deepEqual(single.activeQuests[raced.id], newMemory)
                    } finally {
                        releaseCommand()
                        hook.mock.restore()
                    }
                    decode(await withinTimeout(finish(raced, { play_id: 'queued-new', api_count: 3 }), 'new play after queued rejection'))
                    assert.equal(receiptRows(raced.id).length, 1)
                }
            })

            }
            if (mode === 'writer') {
                const stats = writer.sqliteWriterStats()
                assert.ok(stats.submitted > workerBefore.submitted)
                assert.ok(stats.completed > workerBefore.completed, 'real writer committed successful settle commands')
                assert.ok(stats.failed > workerBefore.failed, 'real writer rolled back the receipt fault')
                assert.equal(stats.completed + stats.failed, stats.submitted)
            }
        })
    }
}
