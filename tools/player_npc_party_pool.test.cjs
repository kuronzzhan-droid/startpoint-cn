const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

require("ts-node/register/transpile-only")

const useCompiledServer = process.env.PLAYER_NPC_POOL_COMPILED === "1"
const serverModuleRoot = useCompiledServer ? "../out" : "../src"
const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sp-player-npc-pool-"))
process.env.DATA_DIR = dataDirectory

const { getDb } = require(`${serverModuleRoot}/data/db`)
const { insertAccountSync } = require(`${serverModuleRoot}/data/domains/account`)
const { insertDefaultPlayerSync } = require(`${serverModuleRoot}/data/domains/player`)
const { insertDefaultPlayerCharacterSync } = require(`${serverModuleRoot}/data/domains/character`)
const { updatePlayerPartySync } = require(`${serverModuleRoot}/data/domains/party`)
const { PartyCategory } = require(`${serverModuleRoot}/data/types`)
const {
    getNpcPartySelectionOptions,
    getPlayerNpcPartyPoolStats,
    getRandomPlayerNpcPartiesSync,
    refreshPlayerNpcPartyPoolSync,
} = require(`${serverModuleRoot}/multi/npc/player-party-pool`)
const { QuestCategory } = require(`${serverModuleRoot}/lib/types/quest`)

function createPlayer(idpId) {
    const account = insertAccountSync({
        appId: "wf_cn",
        idpAlias: "",
        idpCode: "leiting",
        idpId,
        status: "normal",
    })
    return insertDefaultPlayerSync(account.id).id
}

function addParty(playerId, name, characterIds, unisonCharacterIds, battlePower) {
    for (const characterId of [...characterIds, ...unisonCharacterIds]) {
        if (characterId) insertDefaultPlayerCharacterSync(playerId, characterId)
    }
    updatePlayerPartySync(playerId, 1, {
        name,
        characterIds,
        unisonCharacterIds,
        equipmentIds: [null, null, null],
        abilitySoulIds: [null, null, null],
        edited: true,
        options: { allowOtherPlayersToHealMe: true },
        category: PartyCategory.NORMAL,
        currentBattlePower: battlePower,
        beforeBattlePower: battlePower,
    }, 1)
}

try {
    const hostPlayerId = createPlayer("npc-pool-host")
    const ordinaryPlayerId = createPlayer("npc-pool-ordinary")
    const lowPowerPlayerId = createPlayer("npc-pool-low-power")
    const waterPlayerId = createPlayer("npc-pool-water")
    const weakWaterPlayerId = createPlayer("npc-pool-weak-water")
    const mixedWaterPlayerId = createPlayer("npc-pool-mixed-water")

    addParty(
        ordinaryPlayerId,
        "ordinary-exact-threshold",
        [111001, 121001, 131001],
        [null, null, null],
        8000,
    )
    addParty(
        lowPowerPlayerId,
        "below-ordinary-threshold",
        [111001, 121001, 131001],
        [null, null, null],
        7999,
    )
    addParty(
        waterPlayerId,
        "water-exact-decisive-threshold",
        [121001, 121002, 121003],
        [121004, null, null],
        10000,
    )
    addParty(
        weakWaterPlayerId,
        "water-below-decisive-threshold",
        [121001, 121002, 121003],
        [null, null, null],
        9999,
    )
    addParty(
        mixedWaterPlayerId,
        "water-main-with-fire-unison",
        [121001, 121002, 121003],
        [111001, null, null],
        11000,
    )

    assert.equal(refreshPlayerNpcPartyPoolSync(true), 4)
    assert.equal(getPlayerNpcPartyPoolStats().size, 4)
    assert.equal(getPlayerNpcPartyPoolStats().minBattlePowerInclusive, 8000)

    const ordinarySelected = getRandomPlayerNpcPartiesSync(hostPlayerId, 10)
    assert.deepEqual(
        new Set(ordinarySelected.map(entry => entry.sourcePlayerId)),
        new Set([ordinaryPlayerId, waterPlayerId, weakWaterPlayerId, mixedWaterPlayerId]),
    )

    const waterOptions = getNpcPartySelectionOptions(
        QuestCategory.HARD_MULTI_EVENT,
        1001001,
    )
    assert.deepEqual(waterOptions, {
        questCategory: QuestCategory.HARD_MULTI_EVENT,
        questId: 1001001,
        minimumBattlePower: 10000,
        requiredElement: 1,
    })
    const decisiveSelected = getRandomPlayerNpcPartiesSync(hostPlayerId, 10, waterOptions)
    assert.equal(decisiveSelected.length, 1)
    assert.equal(decisiveSelected[0].sourcePlayerId, waterPlayerId)
    assert.deepEqual(
        decisiveSelected[0].party.characters.map(entry => entry[1]?.id),
        [121001, 121002, 121003],
    )

    assert.deepEqual(
        [
            [1001001, 1],
            [1002001, 2],
            [1003001, 3],
            [1004001, 0],
            [1005001, 5],
            [1006001, 4],
        ].map(([questId, requiredElement]) => [
            questId,
            getNpcPartySelectionOptions(QuestCategory.HARD_MULTI_EVENT, questId),
            requiredElement,
        ]),
        [
            [1001001, { questCategory: QuestCategory.HARD_MULTI_EVENT, questId: 1001001, minimumBattlePower: 10000, requiredElement: 1 }, 1],
            [1002001, { questCategory: QuestCategory.HARD_MULTI_EVENT, questId: 1002001, minimumBattlePower: 10000, requiredElement: 2 }, 2],
            [1003001, { questCategory: QuestCategory.HARD_MULTI_EVENT, questId: 1003001, minimumBattlePower: 10000, requiredElement: 3 }, 3],
            [1004001, { questCategory: QuestCategory.HARD_MULTI_EVENT, questId: 1004001, minimumBattlePower: 10000, requiredElement: 0 }, 0],
            [1005001, { questCategory: QuestCategory.HARD_MULTI_EVENT, questId: 1005001, minimumBattlePower: 10000, requiredElement: 5 }, 5],
            [1006001, { questCategory: QuestCategory.HARD_MULTI_EVENT, questId: 1006001, minimumBattlePower: 10000, requiredElement: 4 }, 4],
        ],
    )
    assert.deepEqual(getNpcPartySelectionOptions(QuestCategory.MAIN, 1001001), {
        questCategory: QuestCategory.MAIN,
        questId: 1001001,
    })
    const ownHistoricalFallback = getRandomPlayerNpcPartiesSync(waterPlayerId, 1, waterOptions)
    assert.equal(ownHistoricalFallback.length, 1)
    assert.equal(ownHistoricalFallback[0].sourcePlayerId, waterPlayerId)
    console.log("player NPC party pool tests passed")
} finally {
    getDb().close()
    fs.rmSync(dataDirectory, { recursive: true, force: true })
}
process.exit(0)
