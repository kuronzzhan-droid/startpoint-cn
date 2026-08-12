require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2b-active-host-domain-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
let database

function insertPlayer(playerId) {
    database.prepare(`INSERT INTO accounts (
        id, app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status
    ) VALUES (?, 'wf_cn', '2025-01-01', '', 'active-host-domain', ?, '2025-01-01', '2025-01-01', 'normal')`)
        .run(playerId, `active-host-domain-${playerId}`)
    database.prepare(`INSERT INTO players (
        id, stamina, stamina_heal_time, boost_point, boss_boost_point, transition_state, role, name,
        last_login_time, comment, vmoney, free_vmoney, rank_point, star_crumb, bond_token, exp_pool,
        exp_pooled_time, leader_character_id, party_slot, degree_id, birth, free_mana, paid_mana,
        enable_auto_3x, account_id
    ) VALUES (?, 0, 0, 0, 0, 0, 0, 'active-host', '2025-01-01', '', 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 0, 0, 0, 0, ?)`)
        .run(playerId, playerId)
}

function quest(playerId, isMultiHost) {
    return {
        playerId,
        playId: `play-${playerId}`,
        questId: 200010001,
        category: 7,
        useBossBoostPoint: false,
        useBoostPoint: false,
        isAutoStartMode: false,
        isMulti: true,
        isMultiHost,
        roomNumber: `room-${playerId}`,
        entryItemId: null,
        eventId: null,
        continueCount: 0,
    }
}

try {
    process.env.WF_DATABASE_DIR = temporaryRoot
    const { getDb } = require("../src/data/db")
    const {
        getPlayerActiveQuestSync,
        insertPlayerActiveQuestSync,
    } = require("../src/data/domains/quest_active")
    database = getDb()
    for (const playerId of [1, 2, 3, 4]) insertPlayer(playerId)

    for (const [playerId, host] of [[1, true], [2, false], [3, undefined]]) {
        insertPlayerActiveQuestSync(playerId, quest(playerId, host))
        assert.equal(getPlayerActiveQuestSync(playerId).isMultiHost, host)
        assert.equal(database.prepare(`SELECT is_multi_host FROM players_active_quests
            WHERE player_id = ?`).get(playerId).is_multi_host, host === undefined ? null : Number(host))
    }

    database.prepare(`INSERT INTO players_active_quests (
        player_id, play_id, quest_id, category, is_multi, is_multi_host
    ) VALUES (4, 'bad-host', 200010001, 7, 1, NULL)`).run()
    database.pragma("ignore_check_constraints = ON")
    database.prepare(`UPDATE players_active_quests SET is_multi_host = 2 WHERE player_id = 4`).run()
    database.pragma("ignore_check_constraints = OFF")
    assert.throws(() => getPlayerActiveQuestSync(4), /invalid persisted is_multi_host/)

    console.log("active quest host persistence tests passed")
} finally {
    if (database?.open) database.close()
    for (const request of ["../src/data/domains/quest_active", "../src/data/db", "../src/data/index"]) {
        try { delete require.cache[require.resolve(request)] } catch {}
    }
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
