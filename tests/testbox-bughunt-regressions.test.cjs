'use strict'

// Regressions found on the test box (2026-10-14 bug hunt): each case drives
// the compiled out/ against a scratch database and fails on the code before
// the matching fix.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Fastify = require('fastify')
const { pack, unpack } = require('msgpackr')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testbox-bughunt-'))
process.env.DATA_DIR = tempRoot
process.env.GAME_ROUTINE_LOGS = 'off'
delete process.env.CN_WRITER_THREAD
delete process.env.ROUTE_PERF_SUMMARY

const { initializeDatabase } = require('../out/data')
const { getDb } = require('../out/data/db')
const { insertAccountSync } = require('../out/data/domains/account')
const { insertDefaultPlayerSync, getPlayerSync } = require('../out/data/domains/player')
const { getPlayerCharactersSync, getPlayerCharacterSync } = require('../out/data/domains/character')
const writerClient = require('../out/lib/persistence/writer-client')
const { getWriterCommand } = require('../out/lib/persistence/command-registry')
const { MULTI_RECORD_BATTLE_FACTS } = require('../out/lib/persistence/command-names')
require('../out/lib/persistence/commands')
const assets = require('../out/lib/assets')
const { QuestCategory } = require('../out/lib/types')
const { buildRealParty } = require('../out/multi/party-snapshot')
const singleBattleRoutes = require('../out/routes/api/singleBattleQuest').default

let app
let sequence = 0

function createPlayer() {
    const account = insertAccountSync({
        appId: 'wf_cn', idpAlias: '', idpCode: 'test',
        idpId: `testbox-bughunt-${++sequence}`, status: 'normal',
    })
    const player = insertDefaultPlayerSync(account.id)
    const viewerId = 816000000 + player.id
    getDb().prepare('INSERT INTO sessions (token, account_id, expires, type) VALUES (?, ?, ?, 2)')
        .run(String(viewerId), account.id, new Date('2099-01-01T00:00:00.000Z').toISOString())
    return { playerId: player.id, viewerId }
}

function decode(response) {
    return unpack(Buffer.from(response.body, 'base64'))
}

async function startAndFinish({ playerId, viewerId }, category, questId, statistics) {
    const playId = `testbox-bughunt-${playerId}-${category}-${questId}`
    const start = await app.inject({
        method: 'POST', url: '/single_battle_quest/start',
        payload: {
            viewer_id: viewerId, quest_id: questId, category, party_id: 1, play_id: playId,
            use_boss_boost_point: false, use_boost_point: false,
            is_auto_start_mode: false, api_count: 1,
        },
    })
    assert.equal(start.statusCode, 200, start.body)
    return app.inject({
        method: 'POST', url: '/single_battle_quest/finish',
        payload: {
            viewer_id: viewerId, quest_id: questId, category, continue_count: 0,
            elapsed_time_ms: 60_000, score: 12_345, add_mana: 0,
            is_accomplished: true, is_restored: false, api_count: 2,
            statistics,
        },
    })
}

const soloStatistics = zones => ({
    clear_phase: 1,
    party: {
        characters: [{ id: 1 }, null, null],
        unison_characters: [null, null, null],
        equipments: [null, null, null],
        ability_soul_ids: [null, null, null],
    },
    zones,
})

before(async () => {
    initializeDatabase()
    app = Fastify()
    app.addHook('onSend', (_request, reply, payload, done) => {
        if (reply.getHeader('content-type') === 'application/x-msgpack') {
            done(null, pack(payload).toString('base64'))
            return
        }
        done(null, payload)
    })
    await app.register(singleBattleRoutes, { prefix: '/single_battle_quest' })
    await app.ready()
})

after(async () => {
    await writerClient.stopSqliteWriter()
    await app.close()
    getDb().close()
    fs.rmSync(tempRoot, { recursive: true, force: true })
})

test('hard multi clear rewards pay 30 stones for repaired rows and retain the existing item reward', () => {
    const quests = require('../assets/hard_multi_event_quest.json')
    const repairedIds = ['1001', '2001', '3001', '1001001', '1002001', '1003001',
        '1004001', '1005001', '1006001', '100000001', '100001001']
    assert.deepEqual(Object.keys(quests).sort(), [...repairedIds, '100002001'].sort())
    for (const questId of repairedIds) {
        const quest = assets.getQuestFromCategorySync(QuestCategory.HARD_MULTI_EVENT, questId)
        assert.equal(quests[questId].clearRewardId, 34)
        assert.deepEqual(quest.clearReward, { name: '', type: 3, count: 30 }, `quest ${questId}`)
    }
    assert.equal(quests['100002001'].clearRewardId, 31)
    const retainedReward = assets.getQuestFromCategorySync(QuestCategory.HARD_MULTI_EVENT, 100002001).clearReward
    assert.deepEqual(retainedReward, assets.getClearRewardSync(31))
    assert.equal(retainedReward.type, 0)
    assert.equal(retainedReward.id, 11003)
    assert.equal(retainedReward.count, 1)
})

test('a dangling clear reward id reads as no reward instead of null', () => {
    // Any quest table row whose clearRewardId is missing from clear_reward.json.
    const quests = require('../assets/hard_multi_event_quest.json')
    const original = quests['1001'].clearRewardId
    quests['1001'].clearRewardId = 999999999
    try {
        assert.equal(assets.getQuestFromCategorySync(QuestCategory.HARD_MULTI_EVENT, 1001).clearReward, undefined)
    } finally {
        quests['1001'].clearRewardId = original
    }
})

test('hard multi solo finish pays the clear reward instead of returning 500', async () => {
    const statistics = soloStatistics([{ damage_deal_total: 1, members: [{ origin_damage: 1 }, null, null] }])
    const beadsGained = async () => {
        const player = createPlayer()
        const before = getPlayerSync(player.playerId).freeVmoney
        const finish = await startAndFinish(player, QuestCategory.HARD_MULTI_EVENT, 1001, statistics)
        assert.equal(finish.statusCode, 200, finish.body)
        return getPlayerSync(player.playerId).freeVmoney - before
    }
    const withReward = await beadsGained()
    // Same finish with the reward id dangling: rank-up beads are identical, the
    // clear reward is skipped, and the request must still settle.
    const quests = require('../assets/hard_multi_event_quest.json')
    const original = quests['1001'].clearRewardId
    quests['1001'].clearRewardId = 999999999
    let withoutReward
    try {
        withoutReward = await beadsGained()
    } finally {
        quests['1001'].clearRewardId = original
    }
    assert.equal(withReward - withoutReward, 30)
})

test('legacy co-op battle-facts command grants character EXP unless the party is fixed', () => {
    const handler = getWriterCommand(MULTI_RECORD_BATTLE_FACTS)
    for (const fixedParty of [false, true]) {
        const { playerId } = createPlayer()
        const characterId = Object.keys(getPlayerCharactersSync(playerId))[0]
        assert.ok(characterId, 'default player owns a character')
        const expBefore = getPlayerCharacterSync(playerId, characterId).exp
        handler({
            finishCtx: {
                playerId, questCategory: QuestCategory.BOSS_BATTLE, questId: 1001001,
                questAccomplished: true, clearTime: 60_000, clearRank: 1,
                party: { characters: [{ id: Number(characterId) }, null, null],
                    unison_characters: [null, null, null] },
                statistics: {}, player: getPlayerSync(playerId),
                questPreviouslyCompleted: false, questProgress: null,
                partySlot: 1, isMulti: true, isMultiHost: true,
            },
            partyCharacterIdsArray: [Number(characterId)],
            characterExpReward: 100,
            fixedParty,
            evaluationTimeMs: Date.now(),
        }, { meta: {}, afterCommit() {} })
        const gained = getPlayerCharacterSync(playerId, characterId).exp - expBefore
        if (fixedParty) assert.equal(gained, 0, 'fixed parties keep character EXP unchanged')
        else assert.equal(gained, 100, 'free parties gain character EXP')
    }
})

test('multiplayer party snapshot keeps exactly one unison slot per member', () => {
    const { playerId } = createPlayer()
    const party = buildRealParty(playerId, {
        name: '', characterIds: [null, 999999999, null],
        unisonCharacterIds: [null, null, null],
        equipmentIds: [null, null, null], abilitySoulIds: [null, null, null],
    })
    assert.equal(party.characters.length, 3)
    assert.equal(party.unison_characters.length, 3)
    assert.deepEqual(party.unison_characters, [[1], [1], [1]])
})
