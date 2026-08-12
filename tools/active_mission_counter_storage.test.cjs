require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-8-active-storage-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const worktreeDatabase = path.resolve(__dirname, "..", ".database")
let database

function insertPlayer(playerId) {
    database.prepare(`
        INSERT INTO accounts (
            id, app_id, first_login_time, idp_alias, idp_code, idp_id,
            reg_time, last_login_time, status
        ) VALUES (?, 'wf_cn', '2025-01-01', '', 'test', ?, '2025-01-01', '2025-01-01', 'normal')
    `).run(playerId, `wave2a-8-active-${playerId}`)
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

function assertNoRows(tableName, playerId) {
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE player_id = ?`).get(playerId).count, 0)
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

    const conditional = require("../src/data/domains/active_mission_battle_condition_facts")
    const battle = require("../src/data/domains/active_mission_battle_facts")
    const counters = require("../src/data/domains/active_mission_counters")

    assert.deepEqual(conditional.getActiveMissionConditionalBattleFactsSync(1), {})
    assert.deepEqual(battle.getActiveMissionBattleFactsSync(1), {})
    assert.deepEqual(counters.getActiveMissionCountersSync(1), {
        totalUsedManaCount: 0,
        totalGachaCharacterCount: 0,
        totalEquipmentEquipCount: 0,
        totalUnisonSetCount: 0,
        totalPartyCharacterSetCount: 0,
        totalInjectedExpCount: 0,
        totalGachaCampaignCount: 0,
    })
    assert.equal(counters.getActiveMissionPracticeQuestChallengeCountSync(1), 0)

    conditional.incrementActiveMissionConditionalBattleFactSync(1, 2, 20)
    conditional.incrementActiveMissionConditionalBattleFactSync(1, 1, 30)
    conditional.incrementActiveMissionConditionalBattleFactSync(1, 2, 20)
    assert.deepEqual(conditional.getActiveMissionConditionalBattleFactsSync(1), {
        "1:30": 1,
        "2:20": 2,
    })

    battle.incrementActiveMissionBattleFactSync(1, "10")
    battle.incrementActiveMissionBattleFactSync(1, 5, 3)
    battle.incrementActiveMissionBattleFactSync(1, 10, 2)
    assert.deepEqual(battle.getActiveMissionBattleFactsSync(1), { "5": 3, "10": 3 })

    counters.incrementActiveMissionUsedManaCountSync(1, 120)
    counters.incrementActiveMissionGachaCharacterCountSync(1, 5)
    counters.incrementActiveMissionPartyActionCountsSync(1, {
        equipmentEquipCount: 1,
        unisonSetCount: 2,
        partyCharacterSetCount: 3,
    })
    counters.incrementActiveMissionInjectedExpCountSync(1)
    counters.incrementActiveMissionGachaCampaignCountSync(1)
    counters.incrementActiveMissionPracticeQuestChallengeCountSync(1)
    assert.deepEqual(counters.getActiveMissionCountersSync(1), {
        totalUsedManaCount: 120,
        totalGachaCharacterCount: 5,
        totalEquipmentEquipCount: 1,
        totalUnisonSetCount: 2,
        totalPartyCharacterSetCount: 3,
        totalInjectedExpCount: 1,
        totalGachaCampaignCount: 1,
    })
    assert.equal(counters.getActiveMissionPracticeQuestChallengeCountSync(1), 1)

    counters.incrementActiveMissionPartyActionCountsSync(2, {})
    counters.incrementActiveMissionPartyActionCountsSync(2, {
        equipmentEquipCount: 0,
        unisonSetCount: 0,
        partyCharacterSetCount: 0,
    })
    assertNoRows("players_active_mission_counters", 2)

    const invalidIdCases = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "01", " 1", "+1"]
    for (const invalid of invalidIdCases) {
        assertContractError(() => battle.incrementActiveMissionBattleFactSync(2, invalid, 1))
        assertNoRows("players_active_mission_battle_facts", 2)
    }
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        assertContractError(() => conditional.incrementActiveMissionConditionalBattleFactSync(2, invalid, 1))
        assertContractError(() => conditional.incrementActiveMissionConditionalBattleFactSync(2, 1, invalid))
        assertContractError(() => counters.incrementActiveMissionUsedManaCountSync(2, invalid))
        assertNoRows("players_active_mission_battle_condition_facts", 2)
        assertNoRows("players_active_mission_counters", 2)
    }
    assertContractError(() => counters.incrementActiveMissionPartyActionCountsSync(2, { equipmentEquipCount: -1 }))
    assertContractError(() => counters.incrementActiveMissionPartyActionCountsSync(2, { unisonSetCount: 1.5 }))
    assertContractError(() => counters.incrementActiveMissionPartyActionCountsSync(2, { partyCharacterSetCount: Number.NaN }))
    assertNoRows("players_active_mission_counters", 2)

    assertContractError(() => counters.getActiveMissionCountersSync(0))
    assertContractError(() => counters.getActiveMissionPracticeQuestChallengeCountSync(0))
    assertContractError(() => battle.getActiveMissionBattleFactsSync(0))
    assertContractError(() => conditional.getActiveMissionConditionalBattleFactsSync(0))

    database.prepare(`
        INSERT INTO players_active_mission_battle_facts (player_id, mission_id, progress)
        VALUES (2, 1, ?)
    `).run(Number.MAX_SAFE_INTEGER)
    assert.throws(() => battle.incrementActiveMissionBattleFactSync(2, 1), RangeError)
    assert.equal(battle.getActiveMissionBattleFactsSync(2)["1"], Number.MAX_SAFE_INTEGER)

    database.prepare(`
        INSERT INTO players_active_mission_battle_condition_facts (player_id, pattern, character_id, progress)
        VALUES (2, 1, 1, ?)
    `).run(Number.MAX_SAFE_INTEGER)
    assert.throws(() => conditional.incrementActiveMissionConditionalBattleFactSync(2, 1, 1), RangeError)
    assert.equal(conditional.getActiveMissionConditionalBattleFactsSync(2)["1:1"], Number.MAX_SAFE_INTEGER)

    database.prepare(`
        INSERT INTO players_active_mission_counters (player_id, total_used_mana_count)
        VALUES (2, ?)
    `).run(Number.MAX_SAFE_INTEGER)
    assert.throws(() => counters.incrementActiveMissionUsedManaCountSync(2, 1), RangeError)
    assert.equal(counters.getActiveMissionCountersSync(2).totalUsedManaCount, Number.MAX_SAFE_INTEGER)

    assert.throws(() => battle.incrementActiveMissionBattleFactSync(999, 1), /FOREIGN KEY/)
    assert.throws(() => conditional.incrementActiveMissionConditionalBattleFactSync(999, 1, 1), /FOREIGN KEY/)
    assert.throws(() => counters.incrementActiveMissionInjectedExpCountSync(999), /FOREIGN KEY/)

    assert.throws(() => database.transaction(() => {
        battle.incrementActiveMissionBattleFactSync(3, 10, 2)
        conditional.incrementActiveMissionConditionalBattleFactSync(3, 4, 40)
        counters.incrementActiveMissionGachaCharacterCountSync(3, 3)
        throw new Error("rollback active storage")
    })(), /rollback active storage/)
    assertNoRows("players_active_mission_battle_facts", 3)
    assertNoRows("players_active_mission_battle_condition_facts", 3)
    assertNoRows("players_active_mission_counters", 3)

    battle.incrementActiveMissionBattleFactSync(4, 1)
    conditional.incrementActiveMissionConditionalBattleFactSync(4, 1, 1)
    counters.incrementActiveMissionGachaCampaignCountSync(4)
    database.prepare("DELETE FROM players WHERE id = 4").run()
    assertNoRows("players_active_mission_battle_facts", 4)
    assertNoRows("players_active_mission_battle_condition_facts", 4)
    assertNoRows("players_active_mission_counters", 4)

    database.prepare("UPDATE players_active_mission_battle_facts SET progress = -1 WHERE player_id = 1").run()
    assert.throws(() => battle.getActiveMissionBattleFactsSync(1), RangeError)
    database.prepare("UPDATE players_active_mission_battle_condition_facts SET progress = -1 WHERE player_id = 1").run()
    assert.throws(() => conditional.getActiveMissionConditionalBattleFactsSync(1), RangeError)
    database.prepare("UPDATE players_active_mission_counters SET total_gacha_character_count = -1 WHERE player_id = 1").run()
    assert.throws(() => counters.getActiveMissionCountersSync(1), RangeError)
} finally {
    if (database?.open) database.close()
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

assert.equal(fs.existsSync(temporaryRoot), false)
assert.equal(fs.existsSync(worktreeDatabase), false)
console.log("active mission storage domain tests passed")
