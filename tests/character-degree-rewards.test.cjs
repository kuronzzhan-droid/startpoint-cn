const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// The database module opens its connection at import time.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starpoint-character-degrees-'))
process.env.DATA_DIR = dataDir
process.env.GACHA_SEED_DIR = path.join(dataDir, 'isolated-seeds')
fs.mkdirSync(process.env.GACHA_SEED_DIR)
const Fastify = require('fastify')
const { pack, unpack } = require('msgpackr')
const { getDb } = require('../out/data/db')
const accountApi = require('../out/data/domains/account')
const playerApi = require('../out/data/domains/player')
const characters = require('../out/data/domains/character')
const degreeApi = require('../out/data/domains/degree')
const rewards = require('../out/lib/character-degree-rewards')
const catalog = require('../out/lib/character-degree-catalog')
const content = require('../out/lib/content-master')
const { characterExpCaps, givePlayerCharactersExpSync } = require('../out/lib/character')
const { summarizeBattleStatistics } = require('../out/lib/mission/events')
const { recordBattleMissionDimensions } = require('../out/lib/mission/battle-dimensions')
const { QuestCategory } = require('../out/lib/types')
const { saveAccountDefaultPlayer } = require('../out/data/activeAccount')
const { insertSessionWithToken } = require('../out/data/domains/session')
const snapshots = require('../out/data/snapshots/player-snapshot')
const catalogIds = [
    ...Array.from({ length: 62 }, (_, index) => 9910001 + index),
    9910063, 9910064, 9910065, 9910066, 9910067, 9910068,
    9910069, 9910070, 9910071, 9910072, 9910073, 9910074,
    9910087, 9910088, 9910089, 9910075, 9910076, 9910077,
    9910078, 9910079, 9910080, 9910081, 9910082, 9910083,
    9910084, 9910085, 9910086,
    9910090, 9910091,
]
const allIds = [...catalogIds].sort((a, b) => a - b)
const db = getDb()
const identity = require('../out/lib/gameplay-request-identity')
identity.initializeGameplayRequestIdentitySchemaSync(db)
const logins = new Map()

function player(label = 'fixture') {
    const account = accountApi.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'fixture', idpId: label, status: 'normal' })
    const saved = playerApi.insertDefaultPlayerSync(account.id)
    saveAccountDefaultPlayer(account.id, saved.id)
    return { id: saved.id, accountId: account.id, viewerId: 745000000 + saved.id }
}
function own(p, id = 119989, exp = 379988, overLimitStep = 4) {
    if (!characters.getPlayerCharacterSync(p.id, id)) characters.insertDefaultPlayerCharacterSync(p.id, id)
    characters.updatePlayerCharacterSync(p.id, id, { exp, overLimitStep, evolutionLevel: 0, stack: 2 })
}
function owned(p) {
    const allowed = new Set(allIds)
    return degreeApi.getPlayerDegreeIdsSync(p.id).filter(id => allowed.has(id)).sort((a, b) => a - b)
}
function practice(p, overrides = {}) {
    return { type: 'battle_finish', playerId: p.id, questCategory: QuestCategory.PRACTICE,
        questId: 1, accomplished: true, mode: 'single', clearTimeMs: 180000,
        partyCharacterIds: [], unisonCharacterIds: [], statistics: summarizeBattleStatistics({}), ...overrides }
}
async function session(p) {
    await insertSessionWithToken({ token: String(p.viewerId), accountId: p.accountId, type: 2,
        expires: new Date(Date.now() + 86400000) })
    const token = db.transaction(() => identity.issueGameplayLoginTokenSync(db, {
        accountId: p.accountId, viewerId: p.viewerId, udid: `degree-${p.viewerId}`, expiresAt: Date.now() + 86400000,
    }))()
    logins.set(p.viewerId, { token, count: 0 })
}
async function gameApp(t) {
    const app = Fastify({ logger: false })
    app.addHook('onSend', (_request, reply, payload, done) => {
        done(null, reply.getHeader('content-type') === 'application/x-msgpack' ? pack(payload) : payload)
    })
    await app.register(require('../out/routes/api/character').default, { prefix: '/character' })
    await app.register(require('../out/routes/api/profile').default, { prefix: '/profile' })
    await app.ready()
    t.after(() => app.close())
    return async (url, body, status = 200) => {
        const login = logins.get(body.viewer_id)
        const response = await app.inject({ method: 'POST', url,
            headers: login ? { login_token: login.token } : {},
            payload: { ...body, ...(login ? { api_count: ++login.count } : {}) } })
        assert.equal(response.statusCode, status, response.payload)
        return response.headers['content-type'].startsWith('application/x-msgpack')
            ? unpack(response.rawPayload) : response.json()
    }
}

test.after(() => {
    if (db.open) db.close()
    const resolved = fs.realpathSync(dataDir)
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()))
    assert.ok(path.basename(resolved).startsWith('starpoint-character-degrees-'))
    fs.rmSync(resolved, { recursive: true })
})

test('44 characters and 91 stable client/server definitions agree with the active master accessor', () => {
    assert.equal(catalog.CHARACTER_DEGREE_CATALOG.length, 44)
    assert.deepEqual(catalog.CHARACTER_DEGREE_CATALOG.flatMap(row => [...row.degree_ids]), catalogIds)
    assert.equal(characterExpCaps[5][4], catalog.CHARACTER_DEGREE_LEVEL_100_EXP)
    assert.equal(rewards.characterDegreeRewardsEnabled(), true)
    const manifest = require('../assets/asset-patch/audit/reborn-character-degrees-1.4.108/degree-manifest.json')
    for (const entry of manifest.degrees) {
        assert.equal(content.serverCharacters[entry.character_id].rarity, 5)
        const definition = content.degreeDefinitions[entry.degree_id]
        assert.equal(definition.string_id, entry.row[0])
        assert.equal(definition.name, entry.row[2])
        assert.equal(definition.condition, entry.row[4])
        assert.equal(definition.category_id, Number(entry.row[5]))
    }
    const added = require('../assets/asset-patch/audit/seasonal-characters-1.4.110/degree-manifest.json')
        .filter(entry => entry.degree_id >= 9910049 && entry.degree_id <= 9910062)
    assert.equal(added.length, 14)
    for (const entry of added) {
        assert.equal(content.degreeDefinitions[entry.degree_id].name, entry.row[2])
        assert.equal(content.degreeDefinitions[entry.degree_id].condition, entry.row[4])
    }
    assert.deepEqual(catalog.CHARACTER_DEGREE_CATALOG.slice(0, 24).flatMap(row => [...row.degree_ids]), catalogIds.slice(0, 48))
})

test('the legacy missing-acquired_at insert loses the grant; the adapted writer persists both variants', () => {
    const p = player(); own(p)
    const old = db.prepare('INSERT OR IGNORE INTO players_degrees (player_id,degree_id) VALUES (?,?)').run(p.id, 9910001)
    assert.equal(old.changes, 0)
    assert.deepEqual(owned(p), [])
    assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(p.id), [9910001, 9910002])
    const rows = db.prepare('SELECT acquired_at FROM players_degrees WHERE player_id=? AND degree_id>=9910001').all(p.id)
    assert.equal(rows.length, 2)
    assert.ok(rows.every(row => Number.isSafeInteger(row.acquired_at) && row.acquired_at > 0))
    assert.equal(rows[0].acquired_at, rows[1].acquired_at)
})

test('requires persisted level-100 EXP and exactly four limit breaks, without an awakening condition', () => {
    const p = player(); own(p, 119989, 379987)
    assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(p.id), [])
    for (const overLimitStep of [3, 5]) {
        characters.updatePlayerCharacterSync(p.id, 119989, { exp: 379988, overLimitStep })
        assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(p.id), [])
    }
    characters.updatePlayerCharacterSync(p.id, 119989, { overLimitStep: 4, evolutionLevel: 0 })
    assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(p.id), [9910001, 9910002])
    for (const exp of [NaN, Infinity, 379988.5]) assert.equal(catalog.isCharacterDegreeEligible({ exp, over_limit_step: 4 }), false)
})

test('unowned characters, bosses, minibosses and unknown players cannot earn these titles', () => {
    const p = player(); own(p, 159999); own(p, 179981)
    assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(p.id), [])
    assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(p.id, [119989, 159999, 179981]), [])
    assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(987654321), [])
    assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(-1), [])
})

test('idempotent awards repair a missing variant and preserve account isolation and the original timestamp', () => {
    const p = player(); const other = player(); own(p); own(other)
    degreeApi.grantPlayerDegreeSync(p.id, 9910001, 123456789)
    assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(p.id, [119989, 119989]), [9910002])
    assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(p.id), [])
    assert.deepEqual(owned(other), [])
    assert.equal(db.prepare('SELECT acquired_at FROM players_degrees WHERE player_id=? AND degree_id=9910001').get(p.id).acquired_at, 123456789)
    assert.equal(playerApi.getPlayerSync(p.id).degreeId, 1)
})

test('the entire pair rolls back when its second ownership insert fails', t => {
    const p = player(); own(p)
    db.exec(`CREATE TRIGGER reject_character_degree_pair BEFORE INSERT ON players_degrees
        WHEN NEW.player_id=${p.id} AND NEW.degree_id=9910002 BEGIN SELECT RAISE(ABORT,'pair failure'); END`)
    t.after(() => db.exec('DROP TRIGGER reject_character_degree_pair'))
    assert.throws(() => rewards.grantCharacterDegreeRewardsSync(p.id), /pair failure/)
    assert.deepEqual(owned(p), [])
})

test('missing, disabled, malformed and redirected activation files fail closed', () => {
    const p = player(); own(p)
    const configPath = path.join(dataDir, 'activation.json')
    assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(p.id, undefined, { configPath }), [])
    const active = { schema_version: 1, enabled: true, characters: catalog.CHARACTER_DEGREE_CATALOG }
    const badRoster = structuredClone(active)
    badRoster.characters[0].degree_ids[0] = 1
    for (const value of ['{', '{}', JSON.stringify({ ...active, enabled: false }),
        JSON.stringify({ ...active, enabled: 'true' }), JSON.stringify(badRoster)]) {
        fs.writeFileSync(configPath, value)
        assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(p.id, undefined, { configPath }), [])
    }
    assert.deepEqual(owned(p), [])
})

test('one successful practice grants all 91 eligible inventory variants, without putting them in the party', () => {
    const p = player(); for (const id of catalog.CHARACTER_DEGREE_CHARACTER_IDS) own(p, id)
    recordBattleMissionDimensions(practice(p))
    assert.deepEqual(owned(p), allIds)
    assert.deepEqual(rewards.grantPracticeCharacterDegreeRewardsSync(practice(p)), [])
})

test('failed, multiplayer, non-practice, unknown and malformed finish events do not backfill', () => {
    const p = player(); own(p)
    for (const overrides of [{ accomplished: false }, { accomplished: 1 }, { mode: 'multi' },
        { questCategory: QuestCategory.MAIN }, { questCategory: QuestCategory.RUSH_EVENT, questId: 700098016 },
        { questId: 999999999 }, { questId: -1 }, { questId: 1.5 }, { type: 'history' }]) {
        assert.deepEqual(rewards.grantPracticeCharacterDegreeRewardsSync(practice(p, overrides)), [])
    }
    recordBattleMissionDimensions(practice(p, { accomplished: false }))
    recordBattleMissionDimensions(practice(p, { questCategory: QuestCategory.MAIN }))
    assert.deepEqual(owned(p), [])
})

test('the real EXP entry point awards at the threshold and ignores fixed-party updates', () => {
    const p = player(); own(p, 119989, 379987)
    givePlayerCharactersExpSync(p.id, [119989], 1, true)
    assert.deepEqual(owned(p), [])
    givePlayerCharactersExpSync(p.id, [119989], 1, false)
    assert.deepEqual(owned(p), [9910001, 9910002])
    givePlayerCharactersExpSync(p.id, [119989], 100, false)
    assert.equal(characters.getPlayerCharacterSync(p.id, 119989).exp, 379988)
})

test('duplicate and item breakthrough routes grant only after the fourth persisted break', async t => {
    const request = await gameApp(t)
    for (const useStack of [true, false]) {
        const p = player(); own(p, 119989, 379988, 3); await session(p)
        const items = require('../out/data/domains/item')
        if (!useStack) items.givePlayerItemSync(p.id, 10003, 2)
        const body = { viewer_id: p.viewerId, character_id: 119989, use_stack: useStack, item_id: 10003, over_limit_count: 1 }
        await request('/character/over_limit', { ...body, viewer_id: 0 }, 400)
        assert.deepEqual(owned(p), [])
        const result = await request('/character/over_limit', body)
        assert.equal(result.data.character_list[0].over_limit_step, 4)
        assert.deepEqual(owned(p), [9910001, 9910002])
        if (!useStack) assert.equal(items.getPlayerItemSync(p.id, 10003), 1)
    }
})

test('bulk breakthrough awards ready characters and defers other characters until they gain enough EXP', async t => {
    const p = player(); own(p, 119989, 323488, 3); own(p, 119996, 379988, 3); await session(p)
    const request = await gameApp(t)
    await request('/character/bulk_over_limit', { viewer_id: p.viewerId })
    assert.deepEqual(owned(p), [9910003, 9910004])
    givePlayerCharactersExpSync(p.id, [119989], 56500, false)
    assert.deepEqual(owned(p), [9910001, 9910002, 9910003, 9910004])
})

test('native title list does not grant on read; only owners can equip and ownership survives reopening the database', async t => {
    const p = player(); own(p); await session(p)
    const request = await gameApp(t)
    await request('/profile/get_degree_list', { viewer_id: p.viewerId })
    assert.deepEqual(owned(p), [])
    await request('/profile/update_degree', { viewer_id: p.viewerId, degree_id: 9910002 }, 400)
    recordBattleMissionDimensions(practice(p))
    const list = await request('/profile/get_degree_list', { viewer_id: p.viewerId })
    assert.ok(list.data.degree_ids.includes(9910001) && list.data.degree_ids.includes(9910002))
    await request('/profile/update_degree', { viewer_id: p.viewerId, degree_id: 9910002 })
    assert.equal(playerApi.getPlayerSync(p.id).degreeId, 9910002)
    const code = `const d=require('./out/data/domains/degree');const p=require('./out/data/domains/player');
        console.log(JSON.stringify({owned:d.getPlayerDegreeIdsSync(${p.id}),equipped:p.getPlayerSync(${p.id}).degreeId}));`
    const child = spawnSync(process.execPath, ['-e', code], { cwd: path.resolve(__dirname, '..'), env: process.env, encoding: 'utf8', timeout: 30000 })
    assert.equal(child.status, 0, child.stderr)
    const persisted = JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1))
    assert.ok(persisted.owned.includes(9910002))
    assert.equal(persisted.equipped, 9910002)
})

test('V2 HTTP import/export preserves identity, title progress, and the pre-import rollback backup while V1 is rejected', async t => {
    const app = Fastify({ logger: false })
    await app.register(require('@fastify/multipart'))
    await app.register(require('../out/routes/web_api/player').default, { prefix: '/player' })
    await app.ready()
    t.after(() => app.close())
    const source = player('export-source')
    for (const id of catalog.CHARACTER_DEGREE_CHARACTER_IDS) own(source, id)
    const oldV2 = snapshots.createPlayerSaveSnapshotV2Sync(source.id)
    recordBattleMissionDimensions(practice(source))
    degreeApi.grantPlayerDegreeSync(source.id, 9911101)
    playerApi.updatePlayerSync({ id: source.id, degreeId: 9910048 })
    const download = await app.inject({ method: 'GET', url: `/player/save?id=${source.id}` })
    assert.equal(download.statusCode, 200, download.payload)
    assert.match(download.headers['content-disposition'], /attachment/)
    const exported = download.json()
    assert.equal(exported.schemaFingerprint, oldV2.schemaFingerprint)
    assert.equal(exported.data.tables.players_degrees.rows.filter(row => row.includes(9910048)).length, 1)
    const login = require('../out/lib/player-login')
    login.initializePlayerLogin()
    const boundLogin = login.registerPlayerLogin('degreeimportfixture', 'DegreeFixture11', true)
    const boundAccount = login.playerAccountByViewer(boundLogin.profile.viewer_id)
    const bound = { id: db.prepare('SELECT id FROM players WHERE account_id=?').get(boundAccount).id, accountId: boundAccount }
    const targets = [bound, player('unbound-import-target')]
    const endurance = require('../out/lib/abyss-endurance-degree-rewards')
    for (const target of targets) endurance.startAbyssEnduranceQuestSync(target.id, {
        category: QuestCategory.RUSH_EVENT, eventId: 700099, folderId: 1,
        round: 1, questId: 700099001, totalRounds: 30,
    })
    const localRuns = () => db.prepare("SELECT * FROM leaderboard_runs WHERE competition_key LIKE 'achievement:%' ORDER BY id").all()
    const localRunsBefore = localRuns()
    assert.equal(localRunsBefore.length, 2)
    const identity = () => JSON.stringify(Object.fromEntries(['accounts','sessions','player_login_credentials','player_login_sessions']
        .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])))
    const identityBefore = identity()
    const upload = (target, value) => {
        const boundary = 'character-degree-fixture-boundary'
        return app.inject({ method: 'POST', url: `/player/save?id=${target.id}`,
            headers: { accept: 'application/json', 'content-type': `multipart/form-data; boundary=${boundary}` },
            payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="save.json"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(value)}\r\n--${boundary}--\r\n`) })
    }
    const importAndCheckBackup = async (target, value) => {
        const before = snapshots.createPlayerSaveSnapshotV2Sync(target.id)
        const response = await upload(target, value)
        assert.equal(response.statusCode, 200, response.payload)
        const folder = path.basename(response.json().backup.replace(/\\/g, '/'))
        const backup = JSON.parse(fs.readFileSync(path.join(dataDir, 'admin-backups', folder, 'player-save.json'), 'utf8'))
        assert.deepEqual(backup.data.tables, before.data.tables)
        assert.equal(identity(), identityBefore)
        assert.deepEqual(localRuns(), localRunsBefore)
        assert.equal(db.prepare('SELECT account_id FROM players WHERE id=?').get(target.id).account_id, target.accountId)
    }
    for (const target of targets) {
        await importAndCheckBackup(target, exported)
        assert.deepEqual(owned(target), allIds)
        assert.ok(degreeApi.getPlayerDegreeIdsSync(target.id).includes(9911101))
        assert.equal(playerApi.getPlayerSync(target.id).degreeId, 9910048)
        const reread = await app.inject({ method: 'GET', url: `/player/save?id=${target.id}` })
        assert.equal(reread.statusCode, 200)
        snapshots.validatePlayerSaveSnapshotV2Sync(reread.json())
        await importAndCheckBackup(target, oldV2)
        assert.deepEqual(owned(target), [])
        assert.equal(degreeApi.getPlayerDegreeIdsSync(target.id).includes(9911101), false)
        recordBattleMissionDimensions(practice(target))
        assert.deepEqual(owned(target), allIds)
        const beforeLegacy = snapshots.createPlayerSaveSnapshotV2Sync(target.id)
        const legacy = { schema: 'starpoint-cn-save', version: 1, exportedAt: new Date().toISOString(),
            playerId: source.id, data: {} }
        const rejectedLegacy = await upload(target, legacy)
        assert.equal(rejectedLegacy.statusCode, 400)
        assert.match(rejectedLegacy.json().error, /仅支持 V2 完整存档/)
        assert.deepEqual(snapshots.createPlayerSaveSnapshotV2Sync(target.id).data.tables, beforeLegacy.data.tables)
        const beforeBadDegree = snapshots.createPlayerSaveSnapshotV2Sync(target.id)
        const malformedLegacy = JSON.parse(JSON.stringify(legacy))
        malformedLegacy.data.degreeList = [{ degreeId: 9911101, acquiredAt: -1 }]
        const malformedResult = await upload(target, malformedLegacy)
        assert.ok(malformedResult.statusCode >= 400)
        assert.deepEqual(snapshots.createPlayerSaveSnapshotV2Sync(target.id).data.tables, beforeBadDegree.data.tables)
        assert.deepEqual(localRuns(), localRunsBefore)
        const beforeInvalid = snapshots.createPlayerSaveSnapshotV2Sync(target.id)
        const invalid = await upload(target, { ...exported, schemaFingerprint: 'unsupported' })
        assert.ok(invalid.statusCode >= 400)
        assert.deepEqual(snapshots.createPlayerSaveSnapshotV2Sync(target.id).data.tables, beforeInvalid.data.tables)
        assert.equal(identity(), identityBefore)
    }
})
