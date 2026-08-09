const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const Database = require("better-sqlite3")

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sp-quest-npc-worker-"))
process.env.DATA_DIR = dataDirectory

const { getDb } = require("../out/data/db")
const { insertAccountSync } = require("../out/data/domains/account")
const { insertDefaultPlayerSync } = require("../out/data/domains/player")
const { insertDefaultPlayerCharacterSync } = require("../out/data/domains/character")
const { updatePlayerPartySync } = require("../out/data/domains/party")
const { PartyCategory } = require("../out/data/types")
const {
    getPlayerNpcPartyPoolStats,
    getRandomPlayerNpcPartiesSync,
    recordSuccessfulQuestNpcParty,
    startQuestNpcPartyPoolWorker,
    stopQuestNpcPartyPoolWorker,
} = require("../out/multi/npc/player-party-pool")

let poolDb = null

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (predicate()) return
        await delay(25)
    }
    throw new Error("timed out waiting for quest NPC party worker")
}

async function main() {
    const account = insertAccountSync({
        appId: "wf_cn",
        idpAlias: "",
        idpCode: "leiting",
        idpId: "quest-npc-worker-source",
        status: "normal",
    })
    const playerId = insertDefaultPlayerSync(account.id).id
    const characterIds = [111001, 121001, 131001]
    for (const characterId of characterIds) {
        insertDefaultPlayerCharacterSync(playerId, characterId)
    }
    updatePlayerPartySync(playerId, 1, {
        name: "quest-clear-snapshot",
        characterIds,
        unisonCharacterIds: [null, null, null],
        equipmentIds: [null, null, null],
        abilitySoulIds: [null, null, null],
        edited: true,
        options: { allowOtherPlayersToHealMe: true },
        category: PartyCategory.NORMAL,
        currentBattlePower: 9000,
        beforeBattlePower: 9000,
    }, 1)

    startQuestNpcPartyPoolWorker()
    recordSuccessfulQuestNpcParty(playerId, 2, 987654, 1)
    await waitFor(() => getPlayerNpcPartyPoolStats().questPoolEntryCount === 1)
    poolDb = new Database(path.join(dataDirectory, "quest_ai_party_pool.db"))

    let rows = poolDb.prepare(`
        SELECT source_player_id, battle_power, party_payload
        FROM quest_npc_party_pool
        WHERE quest_category = 2 AND quest_id = 987654
    `).all()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].source_player_id, playerId)
    assert.equal(rows[0].battle_power, 9000)
    assert.equal(JSON.parse(rows[0].party_payload).characters.length >= 3, true)

    const selected = getRandomPlayerNpcPartiesSync(playerId, 2, {
        questCategory: 2,
        questId: 987654,
        minimumBattlePower: 8000,
    })
    assert.equal(selected.length, 2)
    assert.equal(selected[0].sourcePlayerId, playerId)
    assert.equal(selected[1].sourcePlayerId, playerId)

    updatePlayerPartySync(playerId, 1, {
        name: "quest-clear-snapshot-updated",
        characterIds,
        unisonCharacterIds: [null, null, null],
        equipmentIds: [null, null, null],
        abilitySoulIds: [null, null, null],
        edited: true,
        options: { allowOtherPlayersToHealMe: true },
        category: PartyCategory.NORMAL,
        currentBattlePower: 9500,
        beforeBattlePower: 9500,
    }, 1)
    recordSuccessfulQuestNpcParty(playerId, 2, 987654, 1)
    await waitFor(() => {
        const row = poolDb.prepare(`
            SELECT battle_power FROM quest_npc_party_pool
            WHERE quest_category = 2 AND quest_id = 987654 AND source_player_id = ?
        `).get(playerId)
        return row?.battle_power === 9500
    })
    rows = poolDb.prepare(`
        SELECT source_player_id, battle_power FROM quest_npc_party_pool
        WHERE quest_category = 2 AND quest_id = 987654
    `).all()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].battle_power, 9500)

    console.log("quest NPC party worker test passed")
}

main()
    .then(async () => {
        await stopQuestNpcPartyPoolWorker()
        poolDb?.close()
        getDb().close()
        fs.rmSync(dataDirectory, { recursive: true, force: true })
        process.exit(0)
    })
    .catch(async error => {
        console.error(error)
        await stopQuestNpcPartyPoolWorker()
        try { poolDb?.close() } catch {}
        try { getDb().close() } catch {}
        fs.rmSync(dataDirectory, { recursive: true, force: true })
        process.exit(1)
    })
