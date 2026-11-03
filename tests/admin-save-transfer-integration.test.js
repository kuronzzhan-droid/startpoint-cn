const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starpoint-save-transfer-'))
process.env.DATA_DIR = dataDir
process.env.ADMIN_PANEL_PASSWORD = 'save-transfer-admin-fixture'
const { getDb } = require('../out/data/db')
const { insertAccountSync, updateAccountSync } = require('../out/data/domains/account')
const { insertDefaultPlayerSync } = require('../out/data/domains/player')
const { insertDeviceBindingSync } = require('../out/data/domains/session')
const { saveAccountDefaultPlayer } = require('../out/data/activeAccount')
const snapshots = require('../out/data/snapshots/player-snapshot')
const auth = require('../out/lib/player-login')
const { installManagementAuth } = require('../out/lib/management-auth')
const { installPlayerLoginGuard } = require('../out/routes/cn/playerLogin')
const db = getDb()
const app = require('fastify')({ logger: false, bodyLimit: 262144 })
const ledgerTables = [
    'abyss_floor_records',
    'player_payment_receipts', 'player_operation_receipts', 'battle_settlement_ledger', 'battle_receipt_payload_queue',
    'five_boss_continue_receipts', 'five_boss_solo_runs', 'five_boss_gauntlet_runs',
    'five_boss_gauntlet_members', 'five_boss_gauntlet_receipts',
]

function legacy(label) {
    const account = insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'fixture', idpId: label, status: 'normal' })
    const player = insertDefaultPlayerSync(account.id)
    saveAccountDefaultPlayer(account.id, player.id)
    return { accountId: account.id, playerId: player.id }
}
function bound(username, deviceId) {
    const login = auth.registerPlayerLogin(username, 'TransferFixture11', true)
    const accountId = auth.playerAccountByViewer(login.profile.viewer_id)
    const playerId = db.prepare('SELECT id FROM players WHERE account_id=?').get(accountId).id
    updateAccountSync({ id: accountId, adminNote: '保留备注-' + username })
    insertDeviceBindingSync(deviceId, accountId)
    return { accountId, playerId, login }
}
function seedRun(key, host, guest) {
    db.prepare(`INSERT INTO five_boss_gauntlet_runs
        (run_id,host_player_id,route_id,room_number,ticket_item_id,expected_member_count,status,created_at,updated_at)
        VALUES (?,?,'fixture',?,1,2,'settled','2026-09-10','2026-09-10')`).run(key, host, key)
    for (const id of [host, guest]) {
        db.prepare(`INSERT INTO five_boss_gauntlet_members
            (run_id,player_id,client_play_id,is_auto_mode,started_at) VALUES (?,?,?,0,'2026-09-10')`).run(key, id, key + '-' + id)
        db.prepare(`INSERT INTO five_boss_gauntlet_receipts
            (run_id,player_id,reward_multiplier,reward_json,settled_at) VALUES (?,?,2,'{"item":7}','2026-09-10')`).run(key, id)
        db.prepare(`INSERT INTO five_boss_continue_receipts(player_id,play_id,is_multi,request_key)
            VALUES (?,?,1,?)`).run(id, key, 'continue-' + key)
        db.prepare(`INSERT INTO five_boss_solo_runs
            (player_id,play_id,status,finish_request_key,response_json) VALUES (?,?,'settled',?,'{"ok":true}')`).run(id, key, 'finish-' + key)
    }
}
function ledgerState() {
    return Object.fromEntries(ledgerTables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all()]))
}
function identityState() {
    return Object.fromEntries(['accounts', 'sessions', 'device_bindings', 'player_login_credentials', 'player_login_sessions']
        .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}
function backupSnapshot(result) {
    const folder = path.basename(result.backup.replace(/\\/g, '/'))
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'admin-backups', folder, 'player-save.json'), 'utf8'))
}

async function main() {
    auth.initializePlayerLogin()
    const source = legacy('source')
    const host = bound('transferhost', 910011)
    const member = bound('transfermember', 910012)
    const unbound = legacy('unbound-target')
    const other = legacy('other-player')
    // Nonempty receipts ensure a complete save import preserves server-owned
    // ledgers; these rows must never travel inside a player archive.
    for (const owner of [source, host, member, unbound, other]) {
        db.prepare(`INSERT INTO player_payment_receipts
            (player_id,payment_key,product_id,paid_vmoney,free_vmoney,after_vmoney,after_free_vmoney,purchase_count,created_at)
            VALUES (?,?,?,10,20,30,40,1,123456789)`)
            .run(owner.playerId, 'payment-' + owner.playerId, 'fixture-product')
        db.prepare(`INSERT INTO player_operation_receipts
            (player_id,operation,request_key,response_json,created_at) VALUES (?,?,?, ?,123456789)`)
            .run(owner.playerId, 'mail_claim', 'request-' + owner.playerId, JSON.stringify({ owner: owner.playerId }))
        db.prepare(`INSERT INTO battle_settlement_ledger(player_id,play_id,mode,settled_at,version)
            VALUES (?,?,'single',123456789,1)`).run(owner.playerId, 'settled-' + owner.playerId)
        db.prepare(`INSERT INTO battle_receipt_payload_queue(player_id,play_id,operation,created_at)
            VALUES (?,?,'quest_finish.single',123456789)`).run(owner.playerId, 'settled-' + owner.playerId)
    }
    seedRun('target-host', host.playerId, other.playerId)
    seedRun('target-member', other.playerId, member.playerId)
    seedRun('source-run', source.playerId, other.playerId)
    db.prepare(`INSERT INTO abyss_floor_records VALUES (?,700099001,45678,?,123456789)`)
        .run('a'.repeat(64), host.login.profile.viewer_id)
    db.prepare(`INSERT INTO abyss_floor_records VALUES (?,700100001,56789,?,123456789)`)
        .run('b'.repeat(64), member.login.profile.viewer_id)
    db.prepare('UPDATE players SET name=?,free_vmoney=? WHERE id=?').run('导出来源', 13579, source.playerId)
    db.prepare('UPDATE players SET free_vmoney=? WHERE id=?').run(24680, other.playerId)
    const insert = db.prepare(`INSERT INTO players_receive_history
        (player_id,type,type_id,number,reason_id,create_time) VALUES (?,1,2,1,0,'2026-09-10T00:00:00Z')`)
    db.transaction(() => { for (let i = 0; i < 6000; i++) insert.run(source.playerId) })()

    const ledgersBefore = ledgerState()
    const identityBefore = identityState()
    const sourceFingerprint = snapshots.createPlayerSaveSnapshotV2Sync(source.playerId).schemaFingerprint
    installManagementAuth(app)
    installPlayerLoginGuard(app)
    await app.register(require('../out/routes/web_api').default, { prefix: '/api' })
    const origin = await app.listen({ host: '127.0.0.1', port: 0 })
    const loginResponse = await fetch(origin + '/admin-login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: process.env.ADMIN_PANEL_PASSWORD }),
    })
    assert.equal(loginResponse.status, 200)
    const cookie = loginResponse.headers.get('set-cookie').split(';')[0]
    const getSave = (id, authenticated = true) => fetch(origin + `/api/player/save?id=${id}`, {
        headers: authenticated ? { cookie } : {},
    })
    const putSave = (id, payload, authenticated = true) => {
        const form = new FormData()
        form.append('file', new Blob([typeof payload === 'string' ? payload : JSON.stringify(payload)], { type: 'application/json' }), 'save.json')
        return fetch(origin + `/api/player/save?id=${id}`, {
            method: 'POST', headers: { Accept: 'application/json', ...(authenticated ? { cookie } : {}) }, body: form,
        })
    }
    assert.equal((await getSave(source.playerId, false)).status, 401)
    assert.equal((await putSave(host.playerId, {}, false)).status, 401)
    const exported = await getSave(source.playerId)
    assert.equal(exported.status, 200)
    assert.match(exported.headers.get('content-disposition'), /attachment; filename="save_\d+\.json"/)
    const payload = await exported.text()
    assert.ok(Buffer.byteLength(payload) > 262144, 'exercise multipart above the ordinary game body limit')
    assert.ok(!payload.includes('TransferFixture11'), 'player snapshots must not include login passwords')
    const snapshot = JSON.parse(payload)
    assert.equal(snapshot.schemaFingerprint, sourceFingerprint)
    assert.equal(snapshot.data.tables.players_receive_history.rows.length, 6000)
    assert.ok(ledgerTables.every(table => !snapshot.data.tables[table]))
    assert.ok(ledgerTables.every(table => snapshot.summary.excludedState.some(entry => entry.policy === 'preserve-target' && entry.tables.includes(table))))
    // A V2 exported before this policy entry still has the same portable schema.
    const oldV2 = structuredClone(snapshot)
    oldV2.summary.excludedState = oldV2.summary.excludedState.filter(entry => !entry.tables.some(table => ledgerTables.includes(table)))
    snapshots.validatePlayerSaveSnapshotV2Sync(oldV2)

    for (const target of [host, unbound]) {
        const before = snapshots.createPlayerSaveSnapshotV2Sync(target.playerId)
        const imported = await putSave(target.playerId, oldV2)
        assert.equal(imported.status, 200, await imported.clone().text())
        const result = await imported.json()
        assert.equal(result.snapshotVersion, 2)
        assert.deepEqual(backupSnapshot(result).data.tables, before.data.tables)
        assert.deepEqual(identityState(), identityBefore, 'V2 must preserve login, UID, notes and device bindings')
        assert.deepEqual(ledgerState(), ledgersBefore, 'V2 must preserve server battle and idempotency ledgers')
        const reexported = await getSave(target.playerId)
        assert.equal(reexported.status, 200)
        const restored = await reexported.json()
        assert.equal(restored.summary.playerName, '导出来源')
        assert.equal(restored.data.tables.players_receive_history.rows.length, 6000)
        const row = restored.data.tables.players
        assert.equal(row.rows[0][row.columns.indexOf('account_id')], target.accountId)
    }
    const targetBeforeLegacy = snapshots.createPlayerSaveSnapshotV2Sync(host.playerId)
    const legacyV1 = { schema: 'starpoint-cn-save', version: 1, exportedAt: new Date().toISOString(), playerId: source.playerId, data: {} }
    const rejectedLegacy = await putSave(host.playerId, legacyV1)
    assert.equal(rejectedLegacy.status, 400)
    assert.match(await rejectedLegacy.text(), /仅支持 V2 完整存档/)
    assert.deepEqual(snapshots.createPlayerSaveSnapshotV2Sync(host.playerId).data.tables, targetBeforeLegacy.data.tables)
    assert.deepEqual(identityState(), identityBefore)
    const targetBeforeInvalid = snapshots.createPlayerSaveSnapshotV2Sync(host.playerId)
    assert.equal((await putSave(host.playerId, 'invalid-json')).status, 400)
    assert.deepEqual(snapshots.createPlayerSaveSnapshotV2Sync(host.playerId).data.tables, targetBeforeInvalid.data.tables)
    db.exec('CREATE TABLE future_unclassified_player_state (player_id INTEGER REFERENCES players(id))')
    assert.throws(() => snapshots.createPlayerSaveSnapshotV2Sync(source.playerId), /尚未登记.*future_unclassified_player_state/)
    db.exec('DROP TABLE future_unclassified_player_state')
    assert.equal(db.prepare('SELECT free_vmoney FROM players WHERE id=?').get(other.playerId).free_vmoney, 24680)
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
    assert.deepEqual(db.pragma('foreign_key_check'), [])
    console.log('admin save transfer passed: real HTTP auth/download/multipart; V2 bound/unbound; V1 rejected without mutation; exact rollback snapshots; identities and server ledgers preserved; unknown tables still rejected')
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
    await app.close()
    await require('../out/multi/npc/player-party-pool').stopQuestNpcPartyPoolWorker()
    if (db.open) db.close()
    const resolved = path.resolve(dataDir)
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep))
    fs.rmSync(resolved, { recursive: true, force: true })
}).then(() => {
    // The admin route tree also imports multiplayer timers; the HTTP server,
    // worker and temporary database have all been closed before ending this test.
    process.exit(process.exitCode || 0)
})
