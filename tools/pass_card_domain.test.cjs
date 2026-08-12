require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-8-pass-domain-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const worktreeDatabase = path.resolve(__dirname, "..", ".database")
let database

function insertPlayer(playerId) {
    database.prepare(`
        INSERT INTO accounts (
            id, app_id, first_login_time, idp_alias, idp_code, idp_id,
            reg_time, last_login_time, status
        ) VALUES (?, 'wf_cn', '2025-01-01', '', 'test', ?, '2025-01-01', '2025-01-01', 'normal')
    `).run(playerId, `wave2a-8-pass-${playerId}`)
    database.prepare(`
        INSERT INTO players (
            id, stamina, stamina_heal_time, boost_point, boss_boost_point,
            transition_state, role, name, last_login_time, comment,
            vmoney, free_vmoney, rank_point, star_crumb, bond_token,
            exp_pool, exp_pooled_time, leader_character_id, party_slot,
            degree_id, birth, free_mana, paid_mana, enable_auto_3x, account_id
        ) VALUES (
            ?, 0, 0, 0, 0, 0, 0, 'tester', '2025-01-01', '',
            0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, ?
        )
    `).run(playerId, playerId)
}

function assertContractError(callback) {
    assert.throws(callback, error => error instanceof TypeError || error instanceof RangeError)
}

try {
    process.env.WF_DATABASE_DIR = temporaryRoot
    const { getDb } = require("../src/data/db")
    database = getDb()
    const mainDatabase = database.pragma("database_list").find(entry => entry.name === "main")
    assert.equal(path.dirname(path.resolve(mainDatabase.file)), path.resolve(temporaryRoot))
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1)
    insertPlayer(1)
    insertPlayer(2)
    insertPlayer(3)
    insertPlayer(4)

    const passCard = require("../src/data/domains/pass-card")
    assert.deepEqual(passCard.getPlayerPassCardStateSync(1, 10), {
        eventId: 10,
        point: 0,
        isBuy: false,
    })
    assert.equal(passCard.ensurePlayerPassCardLoginProgressSync(1, 10, 5), 1)
    assert.equal(passCard.ensurePlayerPassCardLoginProgressSync(1, 10, 7), 3)
    assert.equal(passCard.ensurePlayerPassCardLoginProgressSync(1, 10, 3), 0)
    assert.deepEqual(passCard.getPlayerPassCardStateSync(1, 10), {
        eventId: 10,
        point: 0,
        isBuy: false,
        loginBaseline: 4,
    })

    assert.equal(passCard.addPlayerPassCardPointSync(1, 10, 0), 0)
    assert.equal(passCard.addPlayerPassCardPointSync(1, 10, 80, 100), 80)
    assert.equal(passCard.addPlayerPassCardPointSync(1, 10, 50, 100), 100)
    assert.equal(passCard.addPlayerPassCardPointSync(1, 10, 0, 50), 100)
    assert.equal(passCard.getPlayerPassCardStateSync(1, 10).point, 100)

    database.prepare(`
        INSERT INTO players_pass_cards (player_id, event_id, point, is_buy)
        VALUES (2, 20, ?, 0)
    `).run(Number.MAX_SAFE_INTEGER - 1)
    assert.equal(
        passCard.addPlayerPassCardPointSync(2, 20, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        Number.MAX_SAFE_INTEGER,
    )
    assert.equal(passCard.getPlayerPassCardStateSync(2, 20).point, Number.MAX_SAFE_INTEGER)

    passCard.setPlayerPassCardRewardReceivedSync(1, 10, 2, true, false)
    passCard.setPlayerPassCardRewardReceivedSync(1, 10, 1, false, true)
    passCard.setPlayerPassCardRewardReceivedSync(1, 10, 2, false, true)
    passCard.setPlayerPassCardRewardReceivedSync(1, 10, 2, false, false)
    assert.deepEqual(passCard.getPlayerPassCardRewardRecordsSync(1, 10), [
        { rewardId: 1, isReceived1: 0, isReceived2: 1 },
        { rewardId: 2, isReceived1: 1, isReceived2: 1 },
    ])

    assert.throws(
        () => passCard.setPlayerPassCardRewardReceivedSync(3, 30, 1, true, false),
        /FOREIGN KEY/,
    )
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM players_pass_card_rewards WHERE player_id = 3").get().count, 0)

    const invalidIds = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "01", " 1", "+1"]
    for (const invalid of invalidIds) {
        assertContractError(() => passCard.getPlayerPassCardStateSync(1, invalid))
        assertContractError(() => passCard.addPlayerPassCardPointSync(1, invalid, 1))
        assertContractError(() => passCard.setPlayerPassCardRewardReceivedSync(1, 10, invalid, true, false))
    }
    for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
        assertContractError(() => passCard.ensurePlayerPassCardLoginProgressSync(3, 30, invalid))
        assertContractError(() => passCard.addPlayerPassCardPointSync(3, 30, invalid))
        assertContractError(() => passCard.addPlayerPassCardPointSync(3, 30, 1, invalid))
    }
    assertContractError(() => passCard.setPlayerPassCardRewardReceivedSync(1, 10, 3, 1, false))
    assertContractError(() => passCard.setPlayerPassCardRewardReceivedSync(1, 10, 3, true, 0))

    assert.throws(() => database.transaction(() => {
        passCard.ensurePlayerPassCardLoginProgressSync(3, 31, 8)
        passCard.addPlayerPassCardPointSync(3, 31, 10)
        passCard.setPlayerPassCardRewardReceivedSync(3, 31, 1, true, true)
        throw new Error("rollback pass")
    })(), /rollback pass/)
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM players_pass_cards WHERE player_id = 3").get().count, 0)
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM players_pass_card_rewards WHERE player_id = 3").get().count, 0)

    passCard.ensurePlayerPassCardLoginProgressSync(4, 40, 1)
    passCard.setPlayerPassCardRewardReceivedSync(4, 40, 1, true, true)
    database.prepare("DELETE FROM players_pass_cards WHERE player_id = 4 AND event_id = 40").run()
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM players_pass_card_rewards WHERE player_id = 4").get().count, 0)
    passCard.ensurePlayerPassCardLoginProgressSync(4, 41, 1)
    passCard.setPlayerPassCardRewardReceivedSync(4, 41, 1, true, true)
    database.prepare("DELETE FROM players WHERE id = 4").run()
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM players_pass_cards WHERE player_id = 4").get().count, 0)
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM players_pass_card_rewards WHERE player_id = 4").get().count, 0)

    database.prepare("UPDATE players_pass_cards SET point = -1 WHERE player_id = 1 AND event_id = 10").run()
    assert.throws(() => passCard.getPlayerPassCardStateSync(1, 10), RangeError)
    database.prepare("UPDATE players_pass_cards SET point = 1, is_buy = 2 WHERE player_id = 1 AND event_id = 10").run()
    assert.throws(() => passCard.getPlayerPassCardStateSync(1, 10), TypeError)
    database.prepare("UPDATE players_pass_cards SET is_buy = 0, login_baseline = -1 WHERE player_id = 1 AND event_id = 10").run()
    assert.throws(() => passCard.getPlayerPassCardStateSync(1, 10), RangeError)
    database.prepare("UPDATE players_pass_card_rewards SET is_received_1 = 2 WHERE player_id = 1 AND event_id = 10").run()
    assert.throws(() => passCard.getPlayerPassCardRewardRecordsSync(1, 10), TypeError)
} finally {
    if (database?.open) database.close()
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

assert.equal(fs.existsSync(temporaryRoot), false)
assert.equal(fs.existsSync(worktreeDatabase), false)
console.log("pass card domain tests passed")
