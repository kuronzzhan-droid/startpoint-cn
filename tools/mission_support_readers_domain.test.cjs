require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-8-support-domain-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const worktreeDatabase = path.resolve(__dirname, "..", ".database")
let database

function insertPlayer(playerId) {
    database.prepare(`
        INSERT INTO accounts (
            id, app_id, first_login_time, idp_alias, idp_code, idp_id,
            reg_time, last_login_time, status
        ) VALUES (?, 'wf_cn', '2025-01-01', '', 'test', ?, '2025-01-01', '2025-01-01', 'normal')
    `).run(playerId, `wave2a-8-support-${playerId}`)
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

    assert.throws(
        () => database.prepare("SELECT * FROM players_collected_items").get(),
        /no such table: players_collected_items/,
    )

    const characterClear = require("../src/data/domains/character_clear")
    const quest = require("../src/data/domains/quest")
    const item = require("../src/data/domains/item")
    assert.equal(typeof characterClear.getPlayerCharacterClearsSync, "function")
    assert.equal(typeof quest.countFinishedPlayerQuestsByCategorySync, "function")
    assert.equal(typeof quest.countFinishedPlayerQuestsSync, "function")
    assert.equal(typeof quest.incrementPlayerQuestMultiClearSync, "function")
    assert.equal(typeof item.getPlayerCollectedItemTotalSync, "function")
    assert.equal(typeof item.getPlayerCollectedItemTotalsSync, "function")
    assert.throws(() => item.getPlayerCollectedItemTotalSync(1, 1), /no such table/)

    assert.deepEqual(characterClear.getPlayerCharacterClearsSync(1), {})
    database.prepare(`
        INSERT INTO players_character_quest_clears (
            player_id, character_id, clear_count, multi_count,
            leader_clear_count, leader_multi_count, leader_power_flip_count
        ) VALUES (1, 200, 3, 4, 5, 6, 7)
    `).run()
    database.prepare(`
        INSERT INTO players_character_quest_clears (
            player_id, character_id, clear_count, multi_count,
            leader_clear_count, leader_multi_count, leader_power_flip_count
        ) VALUES (1, 100, 1, 2, 3, 4, 5)
    `).run()
    assert.deepEqual(characterClear.getPlayerCharacterClearsSync(1), {
        "100": {
            clear_count: 1,
            multi_count: 2,
            leader_clear_count: 3,
            leader_multi_count: 4,
            leader_power_flip_count: 5,
        },
        "200": {
            clear_count: 3,
            multi_count: 4,
            leader_clear_count: 5,
            leader_multi_count: 6,
            leader_power_flip_count: 7,
        },
    })
    assertContractError(() => characterClear.getPlayerCharacterClearsSync(0))
    database.prepare("UPDATE players_character_quest_clears SET multi_count = -1 WHERE player_id = 1 AND character_id = 100").run()
    assert.throws(() => characterClear.getPlayerCharacterClearsSync(1), RangeError)
    database.prepare("UPDATE players_character_quest_clears SET multi_count = 2 WHERE player_id = 1 AND character_id = 100").run()

    database.prepare(`
        INSERT INTO players_quest_progress (section, quest_id, finished, unlocked, player_id)
        VALUES (1, 10, 1, 1, 1), (1, 11, 0, 1, 1), (2, 10, 1, 1, 1)
    `).run()
    assert.equal(quest.countFinishedPlayerQuestsByCategorySync(1, 1), 1)
    assert.equal(quest.countFinishedPlayerQuestsByCategorySync(1, 2), 1)
    assert.equal(quest.countFinishedPlayerQuestsSync(1), 2)
    quest.incrementPlayerQuestMultiClearSync(1, "1", "10")
    assert.equal(database.prepare(`
        SELECT multi_clear_count FROM players_quest_progress
        WHERE player_id = 1 AND section = 1 AND quest_id = 10
    `).get().multi_clear_count, 1)
    assert.throws(() => quest.incrementPlayerQuestMultiClearSync(1, 1, 999), RangeError)
    database.prepare(`
        UPDATE players_quest_progress SET multi_clear_count = ?
        WHERE player_id = 1 AND section = 1 AND quest_id = 10
    `).run(Number.MAX_SAFE_INTEGER)
    assert.throws(() => quest.incrementPlayerQuestMultiClearSync(1, 1, 10), RangeError)
    assert.equal(database.prepare(`
        SELECT multi_clear_count FROM players_quest_progress
        WHERE player_id = 1 AND section = 1 AND quest_id = 10
    `).get().multi_clear_count, Number.MAX_SAFE_INTEGER)

    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "01", " 1"] ) {
        assertContractError(() => quest.countFinishedPlayerQuestsByCategorySync(1, invalid))
        assertContractError(() => quest.incrementPlayerQuestMultiClearSync(1, invalid, 10))
        assertContractError(() => quest.incrementPlayerQuestMultiClearSync(1, 1, invalid))
    }
    assertContractError(() => quest.countFinishedPlayerQuestsSync(0))

    database.prepare("INSERT INTO players_items (id, amount, player_id) VALUES (50, 9, 1)").run()
    const inventoryBeforeReaders = database.prepare("SELECT * FROM players_items WHERE player_id = 1 ORDER BY id").all()
    const { missionFactsMigration } = require("../src/data/migrations/wdfp/mission-facts")
    missionFactsMigration.apply(database)

    assert.equal(item.getPlayerCollectedItemTotalSync(1, 100), 0)
    assert.deepEqual(item.getPlayerCollectedItemTotalsSync(1), {})
    database.prepare(`
        INSERT INTO players_collected_items (player_id, item_id, total_obtained)
        VALUES (1, 200, 8), (1, 100, 5)
    `).run()
    assert.equal(item.getPlayerCollectedItemTotalSync(1, "100"), 5)
    assert.deepEqual(item.getPlayerCollectedItemTotalsSync(1), { "100": 5, "200": 8 })
    assert.deepEqual(database.prepare("SELECT * FROM players_items WHERE player_id = 1 ORDER BY id").all(), inventoryBeforeReaders)

    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "01", " 1"] ) {
        assertContractError(() => item.getPlayerCollectedItemTotalSync(1, invalid))
    }
    assertContractError(() => item.getPlayerCollectedItemTotalsSync(0))
    database.prepare("UPDATE players_collected_items SET total_obtained = -1 WHERE player_id = 1 AND item_id = 100").run()
    assert.throws(() => item.getPlayerCollectedItemTotalSync(1, 100), RangeError)
    assert.throws(() => item.getPlayerCollectedItemTotalsSync(1), RangeError)

    database.prepare("DELETE FROM players WHERE id = 1").run()
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM players_collected_items WHERE player_id = 1").get().count, 0)
} finally {
    if (database?.open) database.close()
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

assert.equal(fs.existsSync(temporaryRoot), false)
assert.equal(fs.existsSync(worktreeDatabase), false)
console.log("mission support reader domain tests passed")
