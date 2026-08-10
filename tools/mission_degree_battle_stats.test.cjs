require("ts-node/register/transpile-only")

// Context storage and the compute matrix, over a populated player built entirely by hand. The
// battle producers (events.ts / battle-dimensions.ts) stay out of scope, so every counter is
// inserted as a canonical four-segment row, and every condition's value has exactly one source.

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const masterIndexRequest = "../src/lib/mission/degree/master-index"
const contextRequest = "../src/lib/mission/degree/context"
const computerRequest = "../src/lib/mission/degree/computer"
const migrationRequest = "../src/data/migrations/wdfp/degree-query-index"
const COUNTER_TABLE = "players_mission_counters"
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-14-battle-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const worktreeRoot = path.resolve(__dirname, "..")
let database
let closedArtifacts = []
let capturedError

// Locks the exact constructor plus an anchored message fragment, so a case cannot pass by being
// stopped at an earlier guard than the one it targets.
function expectError(callback, ErrorConstructor, label, pattern) {
    assert.throws(callback, error => error?.constructor === ErrorConstructor
        && (pattern === undefined || pattern.test(String(error?.message))), label)
}

function insertPlayer(playerId) {
    database.prepare(`INSERT INTO accounts (
        id, app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status
    ) VALUES (?, 'wf_cn', '2025-01-01', '', 'wave2a-14', ?, '2025-01-01', '2025-01-01', 'normal')`)
        .run(playerId, `degree-stats-${playerId}`)
    database.prepare(`INSERT INTO players (
        id, stamina, stamina_heal_time, boost_point, boss_boost_point, transition_state, role, name,
        last_login_time, comment, vmoney, free_vmoney, rank_point, star_crumb, bond_token, exp_pool,
        exp_pooled_time, leader_character_id, party_slot, degree_id, birth, free_mana, paid_mana,
        enable_auto_3x, account_id
    ) VALUES (?, 0, 0, 0, 0, 0, 0, 'degree', '2025-01-01', '', 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, ?)`)
        .run(playerId, playerId)
}

// The live writer builds counter_key as dimension|scopeType|scopeKey|qualifier, and the v2 reader
// is contracted to lifetime/all only. Fixtures therefore always spell out all four segments.
function insertCounter(playerId, dimension, scopeType, scopeKey, qualifier, value) {
    const qualifierJson = JSON.stringify(qualifier)
    database.prepare(`INSERT INTO ${COUNTER_TABLE} (player_id, counter_key, dimension, scope_type,
        scope_key, qualifier_json, value, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '2025-01-01')`)
        .run(playerId, [dimension, scopeType, scopeKey, qualifierJson].join("|"), dimension,
            scopeType, scopeKey, qualifierJson, value)
}

try {
    process.env.WF_DATABASE_DIR = temporaryRoot
    const { getDb } = require("../src/data/db")
    database = getDb()
    const main = database.pragma("database_list").find(entry => entry.name === "main")
    assert.equal(path.dirname(path.resolve(main.file)), path.resolve(temporaryRoot))
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1)
    insertPlayer(1)
    const { missionFactsMigration } = require("../src/data/migrations/wdfp/mission-facts")
    missionFactsMigration.apply(database)

    const { getDegreeMasterIndex } = require(masterIndexRequest)
    const { degreeQueryIndexMigration } = require(migrationRequest)
    degreeQueryIndexMigration.apply(database)

    const index = getDegreeMasterIndex()
    assert.equal(index.definitionCount, 1288)

    insertCounter(1, "battle.stat", "lifetime", "all", { kind: "fever", mode: "single" }, 7)
    insertCounter(1, "battle.max_skill_chain", "lifetime", "all", {}, 4)
    // Same dimension, character scope: the reader must never let this row shadow the lifetime row.
    insertCounter(1, "battle.stat", "character", "111001", { kind: "fever", mode: "single" }, 99)
    const counters = database.prepare(`SELECT counter_key, dimension, scope_type, scope_key,
        qualifier_json, value FROM ${COUNTER_TABLE} WHERE player_id = 1 ORDER BY counter_key`).all()
    assert.equal(counters.length, 3)
    for (const row of counters) {
        assert.deepEqual(row.counter_key.split("|"),
            [row.dimension, row.scope_type, row.scope_key, row.qualifier_json],
            `counter_key must carry all four segments: ${row.counter_key}`)
    }
    assert.deepEqual(counters.filter(row => row.scope_type === "lifetime").map(row => row.value), [4, 7])

    const { buildDegreeContext, degreeCounterKey, isDegreeContext, safeAdd } = require(contextRequest)
    const evaluatedAt = new Date("2025-06-01T00:00:00Z")
    const ctx = buildDegreeContext(1, 5, evaluatedAt, undefined, index)
    assert.equal(isDegreeContext(ctx), true)
    assert.equal(isDegreeContext({ playerId: 1, category: 5 }), false, "an unbranded object is not a context")
    assert.equal(ctx.category, 5)
    assert.equal(ctx.playerId, 1)
    assert.equal(ctx.evaluationTime, evaluatedAt)
    assert.equal(Object.isFrozen(ctx), true)
    assert.equal(Object.isFrozen(ctx.counterValues), true)
    assert.equal(Object.isFrozen(ctx.flatQuestProgress), true)
    // A frozen Set still accepts add(), so the context replaces the mutators instead.
    expectError(() => ctx.completedSecondBoards.add(7), TypeError, "sealed set", /set is read-only/)
    expectError(() => ctx.degreeStats.level100BondedCharacterIds.add(7), TypeError, "sealed bond set",
        /set is read-only/)
    // The character-scoped row carries the same dimension and qualifier as the lifetime row. SOURCE
    // keyed both as `dimension|qualifier` and filtered no scope, so whichever row came last won.
    assert.equal(ctx.counterValues[degreeCounterKey("battle.stat", { kind: "fever", mode: "single" })], 7,
        "a character-scoped row must not shadow the lifetime total")
    assert.equal(ctx.counterValues[degreeCounterKey("battle.max_skill_chain")], 4)
    assert.equal(Object.keys(ctx.counterValues).length, 2, "only lifetime/all rows may be loaded")
    assert.equal(ctx.degreeStats.companionCount, 0)
    assert.equal(ctx.battleCounters.multiClearCount, 0)
    // Condition 1 needs no counter table at all, so nothing may be read for it.
    assert.deepEqual(Object.keys(buildDegreeContext(1, 5, evaluatedAt, [1000], index).counterValues), [])
    assert.equal(buildDegreeContext(1, 5, evaluatedAt, [999999], index).playerId, 1,
        "an unknown but canonical mission id is legal")
    for (const [label, build, ErrorConstructor, pattern] of [
        ["playerId 0", () => buildDegreeContext(0, 5, evaluatedAt, undefined, index),
            RangeError, /^degree playerId /],
        ["playerId string", () => buildDegreeContext("1", 5, evaluatedAt, undefined, index),
            TypeError, /^degree playerId /],
        ["category 4", () => buildDegreeContext(1, 4, evaluatedAt, undefined, index),
            RangeError, /degree category must be 5/],
        ["invalid date", () => buildDegreeContext(1, 5, new Date("not a date"), undefined, index),
            TypeError, /evaluationTime must be a valid Date/],
        ["non date", () => buildDegreeContext(1, 5, 0, undefined, index),
            TypeError, /evaluationTime must be a valid Date/],
        ["missionIds not an array", () => buildDegreeContext(1, 5, evaluatedAt, "1000", index),
            TypeError, /missionIds must be an array/],
        ["missionId 0", () => buildDegreeContext(1, 5, evaluatedAt, [0], index),
            RangeError, /^degree missionId /],
        ["missing player", () => buildDegreeContext(2, 5, evaluatedAt, undefined, index),
            RangeError, /degree player 2 does not exist/],
        ["master index missing", () => buildDegreeContext(1, 5, evaluatedAt, undefined, {}),
            TypeError, /masterIndex must be a built master index/],
    ]) expectError(build, ErrorConstructor, label, pattern)
    assert.equal(degreeCounterKey("d", { b: 1, a: 2 }), 'd|{"a":2,"b":1}', "qualifier keys must be sorted")
    assert.equal(degreeCounterKey("d", { a: "", b: "(None)", c: 1 }), 'd|{"c":1}', "sentinels drop out")
    assert.equal(degreeCounterKey("d"), "d|{}")
    expectError(() => safeAdd(Number.MAX_SAFE_INTEGER, 1, "total"), RangeError, "safeAdd overflow",
        /^total left the safe integer range$/)

    // Bad counter storage aborts the build; SOURCE turned every one of these into a 0 or a {}.
    const insertRawCounter = (counterKey, dimension, qualifierJson, value) => {
        database.prepare(`INSERT INTO ${COUNTER_TABLE} (player_id, counter_key, dimension, scope_type,
            scope_key, qualifier_json, value, updated_at)
            VALUES (1, ?, ?, 'lifetime', 'all', ?, ?, '2025-01-01')`)
            .run(counterKey, dimension, qualifierJson, value)
    }
    const questClearJson = '{"mode":"coop","questCategory":1,"questId":2}'
    const questIdJson = '{"mode":"any","questCategory":1,"questId":"01"}'
    for (const [label, dimension, qualifierJson, value, ErrorConstructor, pattern] of [
        ["broken json", "d.a", "{", 1, RangeError, /qualifier is not valid JSON/],
        ["array qualifier", "d.b", "[]", 1, TypeError, /qualifier must be a JSON object/],
        ["nested qualifier", "d.c", '{"a":{}}', 1, TypeError, /qualifier a must be a primitive/],
        ["unsorted key", "d.d", '{"b":1,"a":2}', 1, RangeError, /counter key .* is not canonical/],
        ["negative value", "d.e", "{}", -1, RangeError, /value must be a non-negative/],
        ["fractional value", "d.f", "{}", 1.5, RangeError, /value must be a non-negative/],
        ["empty dimension", "", "{}", 1, TypeError, /dimension must be a non-empty string/],
        ["bad quest mode", "battle.quest_clear", questClearJson, 1, RangeError, /mode coop is not a battle mode/],
        ["bad quest id", "battle.quest_clear", questIdJson, 1, RangeError, /questId must be a canonical/],
    ]) {
        const counterKey = [dimension, "lifetime", "all", qualifierJson].join("|")
        insertRawCounter(counterKey, dimension, qualifierJson, value)
        expectError(() => buildDegreeContext(1, 5, evaluatedAt, undefined, index), ErrorConstructor,
            `counter storage: ${label}`, pattern)
        database.prepare(`DELETE FROM ${COUNTER_TABLE} WHERE player_id = 1 AND counter_key = ?`).run(counterKey)
    }
    // Two stored keys that normalise onto the same quest triple: adding them would double count.
    for (const category of [1, "1"]) {
        const json = JSON.stringify({ mode: "any", questCategory: category, questId: 2 })
        insertRawCounter(["battle.quest_clear", "lifetime", "all", json].join("|"), "battle.quest_clear", json, 3)
    }
    expectError(() => buildDegreeContext(1, 5, evaluatedAt, undefined, index), RangeError,
        "duplicate quest clear triple", /quest clear counter 1:2:any is duplicated/)
    database.prepare(`DELETE FROM ${COUNTER_TABLE} WHERE player_id = 1
        AND dimension = 'battle.quest_clear'`).run()

    // Character and item storage is validated on the same terms.
    const insertCharacter = (characterId, exp = 0, overLimitStep = 0) => {
        database.prepare(`INSERT INTO players_characters (id, entry_count, evolution_level,
            over_limit_step, protection, join_time, update_time, exp, stack, mana_board_index,
            player_id) VALUES (?, 1, 0, ?, 0, '2025-01-01', '2025-01-01', ?, 0, 1, 1)`)
            .run(characterId, overLimitStep, exp)
    }
    // A row id of 0 is the only way a record key can reach the reader in a non-canonical shape.
    insertCharacter(0)
    expectError(() => buildDegreeContext(1, 5, evaluatedAt, undefined, index), RangeError,
        "character id 0", /degree character id 0 must be a canonical decimal key/)
    database.prepare(`DELETE FROM players_characters WHERE player_id = 1`).run()
    insertCharacter(111001)
    const withCharacter = buildDegreeContext(1, 5, evaluatedAt, undefined, index)
    assert.equal(withCharacter.degreeStats.companionCount, 1)
    assert.equal(Object.isFrozen(withCharacter.characters), true)
    assert.equal(Object.isFrozen(withCharacter.characters["111001"]), true)
    database.prepare(`UPDATE players_characters SET exp = -1 WHERE id = 111001`).run()
    expectError(() => buildDegreeContext(1, 5, evaluatedAt, undefined, index), RangeError,
        "negative character exp", /character 111001 exp must be a non-negative/)
    database.prepare(`DELETE FROM players_characters WHERE player_id = 1`).run()
    database.prepare(`INSERT INTO players_items (id, amount, player_id) VALUES (1, -5, 1)`).run()
    expectError(() => buildDegreeContext(1, 5, evaluatedAt, undefined, index), RangeError,
        "negative item amount", /item 1 amount must be a non-negative/)
    database.prepare(`DELETE FROM players_items WHERE player_id = 1`).run()
    // The character loop re-checks its own keys, so only a second record type can observe the key
    // guard inside the shared record reader.
    database.prepare(`INSERT INTO players_items (id, amount, player_id) VALUES (0, 1, 1)`).run()
    expectError(() => buildDegreeContext(1, 5, evaluatedAt, undefined, index), RangeError,
        "item id 0", /degree item id 0 must be a canonical decimal key/)
    database.prepare(`DELETE FROM players_items WHERE player_id = 1`).run()
    assert.equal(buildDegreeContext(1, 5, evaluatedAt, undefined, index).degreeStats.companionCount, 0)

    // A populated player. Without one the equipment / mana / battle-counter / shop / episode
    // readers were never entered, so emptying any NEEDS_* list or dropping any accumulator changed
    // no assertion at all.
    const insertBondToken = (characterId, manaBoardIndex, status) =>
        database.prepare(`INSERT INTO players_characters_bond_tokens (mana_board_index, status,
            player_id, character_id) VALUES (?, ?, 1, ?)`).run(manaBoardIndex, status, characterId)
    const insertManaNodes = (characterId, base, count) => {
        for (let offset = 0; offset < count; offset++) {
            database.prepare(`INSERT INTO players_characters_mana_nodes (value, awake_level,
                character_id, player_id) VALUES (?, 0, ?, 1)`).run(base + offset, characterId)
        }
    }
    const insertEquipment = (equipmentId, level) =>
        database.prepare(`INSERT INTO players_equipment (id, level, enhancement_level, protection,
            stack, player_id) VALUES (?, ?, 1, 0, 0, 1)`).run(equipmentId, level)
    const insertQuest = (section, questId, highScore = null, clearRank = null, elapsedMs = null) =>
        database.prepare(`INSERT INTO players_quest_progress (section, quest_id, finished, unlocked,
            high_score, clear_rank, best_elapsed_time_ms, multi_clear_count, player_id,
            host_finished) VALUES (?, ?, 1, 1, ?, ?, ?, 0, 1, 0)`)
            .run(section, questId, highScore, clearRank, elapsedMs)
    const insertShopPurchase = (shopItemId, count) =>
        database.prepare(`INSERT INTO players_shop_purchases (player_id, shop_item_id, count)
            VALUES (1, ?, ?)`).run(shopItemId, count)
    // 111001 sits at the rarity-5 experience cap with two over-limit steps, one received bond token
    // and all eighteen nodes of its second mana board (222002401..). 111002 stops at level 79 with
    // one node of a different board, so "every node unlocked" has to stay false for it and the
    // level-100 gate on the bonded set has to matter.
    insertCharacter(111001, 379988, 2)
    insertCharacter(111002, 0, 3)
    insertBondToken(111001, 1, 2)
    insertBondToken(111001, 2, 1)
    insertBondToken(111002, 1, 2)
    insertManaNodes(111001, 222002401, 18)
    insertManaNodes(111002, 222004401, 1)
    insertEquipment(5001, 5)
    insertEquipment(5002, 3)
    database.prepare(`INSERT INTO players_items (id, amount, player_id) VALUES (100000, 12, 1)`).run()
    insertQuest(3, 3001001)
    insertQuest(3, 3001002)
    insertQuest(4, 4001001)
    // A boss quest clear with a score, a rank and a clear time, so the quest-driven titles have
    // something other than zero to recover.
    insertQuest(2, 1003004, 1500, 4, 45000)
    insertShopPurchase(200001, 4)
    insertShopPurchase(200002, 3)
    // Not a treasure shop id: only the master index list keeps it out of the total.
    insertShopPurchase(300001, 9)
    database.prepare(`INSERT INTO players_mission_battle_counters (player_id, single_play_count,
        single_clear_count, multi_play_count, multi_clear_count, multi_host_clear_count,
        multi_guest_clear_count, single_rank_ss_count, rank_ss_count, rank_s_count, rank_a_count,
        rank_b_count) VALUES (1, 0, 0, 0, 8, 3, 0, 6, 0, 0, 0, 0)`).run()
    insertCounter(1, "battle.quest_clear", "lifetime", "all",
        { mode: "single", questCategory: 1, questId: 1001001 }, 6)
    // Counters chosen so that every "take the larger of the two sources" branch is decided by a
    // different side: battle.clear and multi_role_clear beat the battle counter row, while
    // equipment.awakening, shop.treasure_purchase and battle.max_combo lose to the derived value.
    for (const [dimension, qualifier, value] of [
        ["battle.stat", { kind: "fever_time_ms", mode: "single" }, 185000],
        ["battle.stat", { kind: "dash", mode: "any" }, 15],
        // No mode at all: rows written before the qualifier existed, which only "any" may claim.
        ["battle.stat", { kind: "fever" }, 50],
        ["battle.clear", { mode: "multi" }, 12],
        ["battle.multi_role_clear", { role: "host" }, 5],
        ["battle.multi_mvp", {}, 9],
        ["battle.multi_rescue_clear", {}, 2],
        ["battle.multi_newbie_rescue_clear", {}, 3],
        ["shop.treasure_mana_spent", {}, 400],
        ["shop.treasure_purchase", {}, 5],
        ["equipment.awakening", {}, 4],
        ["battle.max_combo", {}, 20],
    ]) insertCounter(1, dimension, "lifetime", "all", qualifier, value)
    database.prepare(`UPDATE players SET rank_point = 1000000, total_login_days = 7,
        total_stamina_used = 250, total_dashes = 40, max_combo_achieved = 33 WHERE id = 1`).run()

    // Each NEEDS_* gate has to open for its own conditions and stay shut for every other one, so
    // both directions are pinned: a cleared list and an always-open gate each break a row.
    const gateShape = missionIds => {
        const scoped = buildDegreeContext(1, 5, evaluatedAt, missionIds, index)
        return [Object.keys(scoped.characters).length, Object.keys(scoped.manaNodes).length,
            Object.keys(scoped.equipment).length, Object.keys(scoped.items).length,
            scoped.flatQuestProgress.length, Object.keys(scoped.counterValues).length,
            scoped.battleCounters.singleRankSsCount, scoped.treasureShopPurchaseCount,
            scoped.degreeStats.episodeClearCount]
    }
    // characters / manaNodes / equipment / items / quests / counters / rank-SS / shop / episodes
    for (const [label, missionIds, expected] of [
        ["condition 1 reads nothing", [1000], [0, 0, 0, 0, 0, 0, 0, 0, 0]],
        ["condition 4 characters only", [2000], [2, 0, 0, 0, 0, 0, 0, 0, 0]],
        ["condition 7 mana nodes without characters", [5000], [0, 2, 0, 0, 0, 0, 0, 0, 0]],
        ["condition 14 quests and counters", [10000], [0, 0, 0, 0, 4, 15, 0, 0, 0]],
        ["condition 21 episode clears", [7000], [0, 0, 0, 0, 0, 0, 0, 0, 2]],
        ["condition 26 battle counters", [13000], [0, 0, 0, 0, 4, 15, 6, 0, 0]],
        ["condition 34 equipment", [42000], [0, 0, 2, 0, 0, 15, 0, 0, 0]],
        ["condition 37 items", [41000], [0, 0, 0, 1, 0, 0, 0, 0, 0]],
        ["condition 45 treasure shop", [46000], [0, 0, 0, 0, 0, 15, 0, 7, 0]],
        ["everything", undefined, [2, 2, 2, 1, 4, 15, 6, 7, 2]],
    ]) assert.deepEqual(gateShape(missionIds), expected, label)

    const full = buildDegreeContext(1, 5, evaluatedAt, undefined, index)
    const stats = full.degreeStats
    // One deepEqual over the whole derived block: every accumulator, every domain constant and the
    // two sets are read by exactly one field each, so none of them can be dropped unobserved.
    assert.deepEqual({ ...stats, level100BondedCharacterIds: [...stats.level100BondedCharacterIds],
        completedSecondManaBoardCharacterIds: [...stats.completedSecondManaBoardCharacterIds] }, {
        companionCount: 2, maxCharacterLevel: 100, overLimitCount: 5, manaBoardCount: 19,
        bondTokenCount: 2, secondManaBoardCompleteCount: 1, singleSsCount: 6, multiClearCount: 8,
        multiHostClearCount: 3, episodeClearCount: 2, level100BondedCharacterIds: [111001],
        completedSecondManaBoardCharacterIds: [111001],
    })
    assert.deepEqual(full.questClearCounters,
        [{ questCategory: 1, questId: 1001001, mode: "single", value: 6 }])
    assert.equal(Object.isFrozen(full.questProgress), true)
    assert.equal(Object.isFrozen(full.questProgress["3"]), true, "each section bucket is frozen too")

    // One representative title per switch branch, over the populated context above. The label is
    // derived from the master so a case cannot silently move to another condition.
    const { computeRecoverableProgress, DegreeComputerV2 } = require(computerRequest)
    for (const [missionId, expected] of [
        [53000, 7], [1000, 107], [45000, 400], [2000, 2], [3000, 100], [5000, 19], [6000, 2],
        [4000, 5], [10000, 0], [11010, 1], [15000, 1], [23000, 12], [24000, 5], [26000, 9],
        [25000, 2], [70004, 3], [7000, 2], [9000, 0], [30000, 1], [14000, 1500], [13000, 6],
        [12000, 0], [34000, 33], [27000, 4], [42000, 6], [43000, 1], [41000, 12], [52000, 250],
        [111001, 2], [111002, 1], [111003, 0], [46000, 7], [55000, 1], [1111001, 1], [1111002, 0],
        [16000, 7], [17000, 185], [37000, 40], [38000, 0],
        // Client-reported and persisted-only titles must stay unrecoverable rather than become 0.
        [47000, undefined], [48000, undefined], [32000, undefined], [35000, undefined],
        [8000, undefined],
    ]) {
        const definition = index.getDefinition(missionId)
        assert.equal(computeRecoverableProgress(definition, full), expected,
            `mission ${missionId} condition ${definition.conditionType}`)
    }
    // Every branch that combines a derived statistic with a counter is decided by a different side
    // here, so swapping a max for a min or dropping either argument shows up above.
    assert.equal(index.getDefinition(23000).conditionType, 16, "counter side wins for condition 16")
    assert.equal(index.getDefinition(46000).conditionType, 45, "derived side wins for condition 45")

    // The read pass has to run inside one transaction. ts-node compiles the context's import to a
    // property access on the domain module, so swapping the export is enough to observe it.
    const playerDomain = require("../src/data/domains/player")
    const originalGetPlayerSync = playerDomain.getPlayerSync
    let insideTransaction
    playerDomain.getPlayerSync = playerId => {
        insideTransaction = database.inTransaction
        return originalGetPlayerSync(playerId)
    }
    try {
        buildDegreeContext(1, 5, evaluatedAt, undefined, index)
    } finally {
        playerDomain.getPlayerSync = originalGetPlayerSync
    }
    assert.equal(insideTransaction, true, "the whole read pass must run in one read transaction")
    assert.equal(database.inTransaction, false, "and it must be closed again when the pass returns")

    // Storage guards on the readers the gates above just made reachable.
    for (const [label, breakSql, restoreSql, pattern] of [
        ["over limit step", `UPDATE players_characters SET over_limit_step = -1 WHERE id = 111001`,
            `UPDATE players_characters SET over_limit_step = 2 WHERE id = 111001`,
            /character 111001 over limit step must be a non-negative/],
        ["bond token status", `UPDATE players_characters_bond_tokens SET status = -1
            WHERE character_id = 111001 AND mana_board_index = 1`,
            `UPDATE players_characters_bond_tokens SET status = 2
            WHERE character_id = 111001 AND mana_board_index = 1`,
            /character 111001 bond token status must be a non-negative/],
        ["mana node value", `UPDATE players_characters_mana_nodes SET value = -1
            WHERE value = 222002401`,
            `UPDATE players_characters_mana_nodes SET value = 222002401 WHERE value = -1`,
            /degree mana node of 111001 must be a non-negative/],
        ["equipment level", `UPDATE players_equipment SET level = -1 WHERE id = 5001`,
            `UPDATE players_equipment SET level = 5 WHERE id = 5001`,
            /equipment 5001 level must be a non-negative/],
        ["equipment enhancement level",
            `UPDATE players_equipment SET enhancement_level = -1 WHERE id = 5001`,
            `UPDATE players_equipment SET enhancement_level = 1 WHERE id = 5001`,
            /equipment 5001 enhancement level must be a non-negative/],
        ["treasure shop count", `UPDATE players_shop_purchases SET count = -1 WHERE shop_item_id = 200001`,
            `UPDATE players_shop_purchases SET count = 4 WHERE shop_item_id = 200001`,
            /degree shop purchase 200001 must be a non-negative/],
        // Two legal counts whose sum is not a safe integer: only the checked add can see this.
        ["treasure shop overflow",
            `UPDATE players_shop_purchases SET count = ${Number.MAX_SAFE_INTEGER} WHERE shop_item_id = 200002`,
            `UPDATE players_shop_purchases SET count = 3 WHERE shop_item_id = 200002`,
            /treasure shop purchase count left the safe integer range/],
    ]) {
        database.prepare(breakSql).run()
        expectError(() => buildDegreeContext(1, 5, evaluatedAt, undefined, index), RangeError,
            `populated storage: ${label}`, pattern)
        database.prepare(restoreSql).run()
    }
    assert.deepEqual(gateShape(undefined), [2, 2, 2, 1, 4, 15, 6, 7, 2], "every fixture restored")
    expectError(() => computeRecoverableProgress(null, full), TypeError, "definition null",
        /needs a master definition/)
    // Two stored values that are each legal but whose sum is not a safe integer: only the checked
    // adds inside compute can see these, and only after a context has accepted the rows.
    for (const [label, breakSql, restoreSql, missionId, pattern] of [
        ["persisted multi clears",
            `UPDATE players_quest_progress SET multi_clear_count = ${Number.MAX_SAFE_INTEGER}
             WHERE section IN (2, 3)`,
            `UPDATE players_quest_progress SET multi_clear_count = 0 WHERE section IN (2, 3)`,
            23000, /persisted multi clears left the safe integer range/],
        ["equipment awakenings",
            `UPDATE players_equipment SET level = ${Number.MAX_SAFE_INTEGER}`,
            `UPDATE players_equipment SET level = CASE id WHEN 5001 THEN 5 ELSE 3 END`,
            42000, /equipment awakenings left the safe integer range/],
    ]) {
        database.prepare(breakSql).run()
        const overflowing = buildDegreeContext(1, 5, evaluatedAt, undefined, index)
        expectError(() => computeRecoverableProgress(index.getDefinition(missionId), overflowing),
            RangeError, `compute overflow: ${label}`, pattern)
        database.prepare(restoreSql).run()
    }
    assert.deepEqual(gateShape(undefined), [2, 2, 2, 1, 4, 15, 6, 7, 2], "the overflow fixtures are restored")
    // The context does not validate the player row, so a fractional stored statistic is the one way
    // a recoverable value reaches compute out of range. It must be refused, not handed on.
    database.prepare(`UPDATE players SET total_stamina_used = 1.5 WHERE id = 1`).run()
    const fractional = buildDegreeContext(1, 5, evaluatedAt, undefined, index)
    expectError(() => DegreeComputerV2.compute(52000, fractional, 0), RangeError,
        "fractional recoverable value", /recoverable progress must be a non-negative safe integer/)
    database.prepare(`UPDATE players SET total_stamina_used = 250 WHERE id = 1`).run()
} catch (error) {
    capturedError = error
} finally {
    if (database?.open) database.close()
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    if (fs.existsSync(temporaryRoot)) closedArtifacts = fs.readdirSync(temporaryRoot)
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

// Rethrown before the artifact assertions: a body failure that happens before the database exists
// would otherwise be swallowed by an empty-artifact deepEqual instead of being reported.
if (capturedError !== undefined) throw capturedError
assert.equal(fs.existsSync(temporaryRoot), false)
assert.deepEqual(closedArtifacts.sort(), ["wdfp_data.db", "wdfp_data.db.version"])
assert.deepEqual(fs.readdirSync(worktreeRoot).filter(name => name.startsWith(".database")), [])

console.log("degree battle stats tests passed")
