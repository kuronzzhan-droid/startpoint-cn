'use strict'

const path = require('node:path')
const { isMainThread, threadId } = require('node:worker_threads')
const compiled = relative => require(path.join(__dirname, '..', 'out', relative))

// The worker imports this same file through the existing test-command hook.
// Faults are installed in the thread that actually executes the settlement.
function installFaultCommands() {
    const equipment = compiled('data/domains/equipment')
    const history = compiled('lib/quest/practice-battle-history')
    const originalEquipment = equipment.getPlayerEquipmentListSync
    const originalHistory = history.buildPracticeBattleHistoryRecord
    let fault = null
    let hits = 0
    equipment.getPlayerEquipmentListSync = (...args) => {
        if (fault === 'equipment-read') {
            hits++
            throw Object.assign(new Error('injected practice equipment read failure'), { code: 'SQLITE_IOERR' })
        }
        return originalEquipment(...args)
    }
    history.buildPracticeBattleHistoryRecord = (...args) => {
        if (fault === 'builder-program') {
            hits++
            throw new TypeError('injected practice history programming failure')
        }
        return originalHistory(...args)
    }
    compiled('lib/persistence/command-registry').registerWriterCommand('test.practice_history_fault', args => {
        if (Object.hasOwn(args, 'fault')) {
            fault = args.fault
            hits = 0
        }
        return { fault, hits, threadId, isMainThread }
    })
}

if (!isMainThread) {
    installFaultCommands()
} else {
    const test = require('node:test')
    const assert = require('node:assert/strict')
    const fs = require('node:fs')
    const os = require('node:os')
    const Fastify = require('fastify')
    const { pack, unpack } = require('msgpackr')
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'practice-history-recovery-'))
    process.env.DATA_DIR = directory
    process.env.GAME_ROUTINE_LOGS = 'off'
    delete process.env.CN_WRITER_THREAD
    delete process.env.QUEST_FINISH_STRICT
    process.env.SQLITE_WRITER_EXTRA_COMMANDS = __filename
    compiled('data').initializeDatabase()
    const db = compiled('data/db').getDb()
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
    const writer = compiled('lib/persistence/writer-client')
    const coordinator = compiled('lib/persistence-coordinator')
    const assets = compiled('lib/assets')
    const single = compiled('routes/api/singleBattleQuest')
    compiled('utils').setServerTimeOffset(0)
    installFaultCommands()

    const category = 15
    const questId = 1
    const rewardItem = 14040
    const originalQuest = assets.getQuestFromCategorySync
    // These deterministic master inputs are serialized into the real writer.
    assets.getQuestFromCategorySync = (requestedCategory, requestedQuest) => {
        const quest = originalQuest(requestedCategory, requestedQuest)
        if (!quest || Number(requestedCategory) !== category || Number(requestedQuest) !== questId) return quest
        return {
            ...quest, rankPointReward: 14, characterExpReward: 26, poolExpReward: 26, manaReward: 135,
            clearReward: { type: 0, id: rewardItem, count: 2 },
            sPlusReward: { type: 0, id: rewardItem, count: 3 },
            fixedParty: undefined, scoreRewardGroupId: undefined, scoreRewardGroup: undefined,
        }
    }
    let app
    let sequence = 0
    const identifier = value => `"${value.replaceAll('"', '""')}"`
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
    function makePlayer() {
        const account = compiled('data/domains/account').insertAccountSync({
            appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: `practice-history-${++sequence}`, status: 'normal',
        })
        const player = compiled('data/domains/player').insertDefaultPlayerSync(account.id)
        compiled('data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
        const viewerId = 875000000 + player.id
        compiled('data/domains/session').insertSessionWithTokenSync({
            token: String(viewerId), accountId: account.id, type: 2, expires: new Date('2099-01-01T00:00:00Z'),
        })
        return { id: player.id, viewerId, playId: `practice-history-${sequence}` }
    }
    const statistics = (zones = [{ damage_deal_total: 10, members: [{ origin_damage: 10 }, null, null] }]) => ({
        clear_phase: 1, max_combo_count: 17, zones,
        party: {
            characters: [{ id: 1 }, null, null], unison_characters: [null, null, null],
            equipments: [null, null, null], ability_soul_ids: [null, null, null],
        },
    })
    async function start(player) {
        const response = await app.inject({ method: 'POST', url: '/single_battle_quest/start', payload: {
            viewer_id: player.viewerId, category, quest_id: questId, party_id: 1, play_id: player.playId,
            use_boss_boost_point: false, use_boost_point: false, is_auto_start_mode: false, api_count: 1,
        } })
        assert.equal(response.statusCode, 200, response.body)
    }
    function finish(player, telemetry = statistics()) {
        return app.inject({ method: 'POST', url: '/single_battle_quest/finish', payload: {
            viewer_id: player.viewerId, category, quest_id: questId, play_id: player.playId,
            continue_count: 0, elapsed_time_ms: 60000, score: 100, add_mana: 0,
            is_accomplished: true, is_restored: false, statistics: telemetry, api_count: 2,
        } })
    }
    function decode(response) {
        assert.equal(response.statusCode, 200, response.body)
        assert.match(response.headers['content-type'], /^application\/x-msgpack/)
        return unpack(Buffer.from(response.body, 'base64'))
    }
    function rows(table, playerId) {
        return db.prepare(`SELECT * FROM ${table} WHERE player_id = ?`).all(playerId)
    }
    function assertPaidOnce(before, after) {
        assert.equal(after.players[0].rank_point - before.players[0].rank_point, 14)
        assert.ok(after.players[0].free_mana - before.players[0].free_mana >= 135)
        assert.ok(after.players[0].exp_pool - before.players[0].exp_pool >= 26)
        assert.equal(after.players_characters.find(row => row.id === 1).exp - before.players_characters.find(row => row.id === 1).exp, 26)
        const itemCount = state => state.players_items.find(row => row.id === rewardItem)?.amount ?? 0
        assert.equal(itemCount(after) - itemCount(before), 5)
        assert.equal(after.players_active_quests.length, 0)
        assert.equal(after.player_operation_receipts.filter(row => row.operation === 'quest_finish.single').length, 1)
    }
    async function faultCommand(args, mode) {
        const result = await coordinator.runWriterCommand('test.practice_history_fault', args, { domain: 'single-quest', operation: 'test_fault' })
        assert.equal(result.isMainThread, mode === 'in-process')
        assert.equal(result.threadId === 0, mode === 'in-process')
        return result
    }

    test.before(async () => {
        app = Fastify()
        app.addHook('onSend', (_request, reply, payload, done) => {
            done(null, reply.getHeader('content-type') === 'application/x-msgpack' ? pack(payload).toString('base64') : payload)
        })
        await app.register(single.default, { prefix: '/single_battle_quest' })
        await app.ready()
    })
    test.after(async () => {
        await writer.stopSqliteWriter()
        await app.close()
        assets.getQuestFromCategorySync = originalQuest
        if (db.open) db.close()
        assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir()))
        fs.rmSync(directory, { recursive: true })
    })

    test('history identity invariants are not optional payload validation errors', () => {
        const { buildPracticeBattleHistoryRecord } = compiled('lib/quest/practice-battle-history')
        const { BattleHistoryPayloadValidationError } = compiled('lib/quest/battle-history')
        const input = {
            playerId: 1, playId: 'identity', categoryId: category, questId, finishKind: 0,
            createdAt: new Date(), elapsedTimeMs: 60000, score: 100, clearRank: 5,
            party: statistics().party, statistics: statistics(), equipmentList: {},
        }
        for (const invalid of [{ playerId: 0 }, { playId: '' }, { categoryId: 26 }, { questId: 0 }, { createdAt: new Date(NaN) }]) {
            assert.throws(() => buildPracticeBattleHistoryRecord({ ...input, ...invalid }), error =>
                error instanceof Error && !(error instanceof BattleHistoryPayloadValidationError))
        }
        assert.throws(() => buildPracticeBattleHistoryRecord({ ...input, statistics: statistics([]) }), BattleHistoryPayloadValidationError)
        for (const zone of [null, [], 1, 'invalid']) {
            assert.throws(() => buildPracticeBattleHistoryRecord({ ...input, statistics: statistics([zone]) }), BattleHistoryPayloadValidationError)
        }
    })

    for (const mode of ['in-process', 'writer']) {
        test(`practice history failure recovery (${mode})`, async t => {
            if (mode === 'writer') {
                process.env.CN_WRITER_THREAD = '1'
                assert.equal(writer.startSqliteWriter(db.name), true)
                assert.equal(await writer.waitForSqliteWriterReady(30000), true)
            }
            await faultCommand({ fault: null }, mode)
            for (const [name, telemetry, expectedHistory] of [
                ['valid telemetry is archived', statistics(), 1],
                ['empty zones skips only optional history', statistics([]), 0],
            ]) {
                await t.test(name, async () => {
                    const player = makePlayer()
                    await start(player)
                    const before = snapshot(player.id)
                    const workerBefore = writer.sqliteWriterStats()
                    const first = decode(await finish(player, telemetry))
                    const settled = snapshot(player.id)
                    assertPaidOnce(before, settled)
                    assert.equal(rows('players_practice_battle_history', player.id).length, expectedHistory)
                    assert.deepEqual(decode(await finish(player, telemetry)).data, first.data)
                    assert.deepEqual(snapshot(player.id), settled, 'successful replay never pays twice or alters history')
                    if (mode === 'writer') assert.ok(writer.sqliteWriterStats().completed > workerBefore.completed)
                })
            }

            for (const fault of ['equipment-read', 'builder-program', 'history-insert', 'null-zone-payload']) {
                await t.test(`${fault} rolls back all writes and permits one same-play payment after recovery`, async () => {
                    const player = makePlayer()
                    await start(player)
                    const before = snapshot(player.id)
                    const registered = structuredClone(single.activeQuests[player.id])
                    if (fault === 'history-insert') {
                        // This durable SQLite fault is observed by both connections.
                        db.exec(`CREATE TRIGGER practice_history_failure BEFORE INSERT ON players_practice_battle_history
                            WHEN NEW.player_id = ${player.id}
                            BEGIN SELECT RAISE(ABORT, 'injected practice history insert failure'); END`)
                    } else if (fault !== 'null-zone-payload') {
                        await faultCommand({ fault }, mode)
                    }
                    const workerBefore = writer.sqliteWriterStats()
                    try {
                        // A null zone is explicitly rejected as history telemetry,
                        // but existing battle trackers also reject it later. Keep
                        // that HTTP boundary atomic rather than mocking trackers.
                        const response = await finish(player, fault === 'null-zone-payload' ? statistics([null]) : statistics())
                        assert.equal(response.statusCode, 500, response.body)
                        if (fault !== 'null-zone-payload') assert.match(response.body, /injected practice/)
                        assert.deepEqual(snapshot(player.id), before, 'progress, rewards, facts, active quest and receipt all roll back')
                        assert.deepEqual(single.activeQuests[player.id], registered, 'memory registration is retained')
                        assert.equal(rows('player_operation_receipts', player.id).length, 0)
                        assert.equal(rows('players_practice_battle_history', player.id).length, 0)
                        if (['equipment-read', 'builder-program'].includes(fault)) assert.equal((await faultCommand({}, mode)).hits, 1)
                        if (mode === 'writer') assert.ok(writer.sqliteWriterStats().failed > workerBefore.failed, 'failure occurred in the real writer')
                    } finally {
                        if (fault === 'history-insert') db.exec('DROP TRIGGER practice_history_failure')
                        await faultCommand({ fault: null }, mode)
                    }
                    const first = decode(await finish(player))
                    const settled = snapshot(player.id)
                    assertPaidOnce(before, settled)
                    assert.equal(rows('players_practice_battle_history', player.id).length, 1)
                    assert.deepEqual(decode(await finish(player)).data, first.data)
                    assert.deepEqual(snapshot(player.id), settled, 'same-play recovery and replay pay exactly once')
                })
            }
        })
    }
}
