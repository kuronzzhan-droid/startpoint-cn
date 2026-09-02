import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import {
    FANTASY_BOSS_STAGES,
    FANTASY_BOSS_TOKEN_REWARDS,
    FANTASY_EQUIPMENT_EXEMPT_RUSH_EVENT_IDS,
    FANTASY_EXCLUSIVE_EQUIPMENT_IDS,
    FANTASY_GAUNTLET,
    FANTASY_MULTI_CATEGORY,
    FANTASY_SOLO_STAGES,
    getFantasyQuestRef,
    isFantasyMultiQuest,
    isFantasyPracticeQuest,
    isFantasyQuest,
    listFantasyMultiQuestIds,
    listFantasyQuests,
    withFantasyFolderSentinel,
} from "../lib/fantasy-gauntlet"
import {
    hideFantasyBossPlayedPartyMembers,
    shouldHideFantasyPlayedPartyMembers,
} from "../lib/fantasy-gauntlet/played-party"
import type { UserRushEventPlayedParty } from "../data/types"
import { QuestCategory } from "../lib/types"
import { handleRushEventFinish } from "../lib/quest/finish/rush-handler"


const DEEP_ABYSS_RUSH_EVENT_ID = 700099


function playedParty(characterId: number): UserRushEventPlayedParty {
    return {
        character_id_1: characterId,
        character_id_2: characterId + 1,
        character_id_3: characterId + 2,
        unison_character_id_1: characterId + 3,
        unison_character_id_2: null,
        unison_character_id_3: null,
        equipment_id_1: 100013,
        equipment_id_2: null,
        equipment_id_3: null,
        ability_soul_id_1: null,
        ability_soul_id_2: null,
        ability_soul_id_3: null,
        evolution_img_level_1: 1,
        evolution_img_level_2: 1,
        evolution_img_level_3: 1,
        unison_evolution_img_level_1: 1,
        unison_evolution_img_level_2: null,
        unison_evolution_img_level_3: null,
    }
}


test("the 15 rounds split into 12 solo rush stages and 3 multiplayer bosses", () => {
    const quests = listFantasyQuests()
    assert.equal(quests.length, 15)
    assert.deepEqual(quests.map(ref => ref.stage), [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ])
    assert.deepEqual(FANTASY_SOLO_STAGES, [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14])
    assert.deepEqual(FANTASY_BOSS_STAGES, [5, 10, 15])

    for (const stage of FANTASY_SOLO_STAGES) {
        const ref = getFantasyQuestRef(
            QuestCategory.RUSH_EVENT,
            FANTASY_GAUNTLET.rushEventId * 1000 + stage,
        )
        assert.equal(ref?.stage, stage)
        assert.equal(ref?.isMulti, false)
    }
    assert.deepEqual(listFantasyMultiQuestIds(), [300098001, 300098002, 300098003])
})


test("the rush rows at 5/10/15 are client placeholders and never resolve to a startable quest", () => {
    for (const stage of FANTASY_BOSS_STAGES) {
        const placeholderQuestId = FANTASY_GAUNTLET.rushEventId * 1000 + stage
        assert.equal(
            getFantasyQuestRef(QuestCategory.RUSH_EVENT, placeholderQuestId),
            null,
            `rush placeholder ${placeholderQuestId} must not be startable`,
        )
    }
})


test("the multiplayer bosses answer on the category the CN client actually posts", () => {
    // CN 的 AdventEvent 多人客户端发 category 7,尽管枚举把 8 叫 ADVENT_EVENT_MULTI。
    assert.equal(FANTASY_MULTI_CATEGORY, QuestCategory.ADVENT_EVENT_SINGLE)
    for (const category of [
        QuestCategory.ADVENT_EVENT_SINGLE,
        QuestCategory.ADVENT_EVENT_MULTI,
    ]) {
        const ref = getFantasyQuestRef(category, 300098002)
        assert.equal(ref?.stage, 10)
        assert.equal(ref?.isMulti, true)
        assert.equal(isFantasyMultiQuest(category, 300098002), true)
    }
    assert.equal(isFantasyMultiQuest(QuestCategory.RUSH_EVENT, 700098004), false)
})


test("nothing in the Deep Abyss gauntlet is ever claimed by the fantasy runtime", () => {
    const abyssQuestIds = [
        ...Array.from({ length: 30 }, (_, index) => DEEP_ABYSS_RUSH_EVENT_ID * 1000 + index + 1),
        DEEP_ABYSS_RUSH_EVENT_ID * 1000 + 99,
    ]
    for (const questId of abyssQuestIds) {
        assert.equal(
            isFantasyQuest(QuestCategory.RUSH_EVENT, questId),
            false,
            `abyss quest ${questId} must stay outside the fantasy runtime`,
        )
    }
    // 五重决战(BOSS_BATTLE 1099001..3)同样不该被认领。
    for (const questId of [1099001, 1099002, 1099003]) {
        assert.equal(isFantasyQuest(QuestCategory.BOSS_BATTLE, questId), false)
    }
})


test("the practice round is recognised but stays outside the ordered run", () => {
    assert.equal(FANTASY_GAUNTLET.practiceQuestId, 700098016)
    assert.equal(
        isFantasyPracticeQuest(QuestCategory.RUSH_EVENT, FANTASY_GAUNTLET.practiceQuestId),
        true,
    )
    assert.equal(
        getFantasyQuestRef(QuestCategory.RUSH_EVENT, FANTASY_GAUNTLET.practiceQuestId),
        null,
    )
    assert.equal(isFantasyPracticeQuest(QuestCategory.RUSH_EVENT, 700098015), false)
})


test("the folder sentinel applies to fantasy only and never mutates the shared asset map", () => {
    const fantasyDerived = { 1: 15, 2: 0 }
    const patched = withFantasyFolderSentinel(FANTASY_GAUNTLET.rushEventId, fantasyDerived)
    assert.equal(patched[1], FANTASY_GAUNTLET.folderRoundSentinel)
    assert.equal(patched[2], 0)
    // assets 那份是共享缓存对象,就地改会污染所有调用方。
    assert.deepEqual(fantasyDerived, { 1: 15, 2: 0 })
    assert.notEqual(patched, fantasyDerived)

    const abyssDerived = { 1: 30, 2: 0 }
    const abyssResult = withFantasyFolderSentinel(DEEP_ABYSS_RUSH_EVENT_ID, abyssDerived)
    assert.equal(abyssResult, abyssDerived, "the abyss map must be handed back untouched")
    assert.deepEqual(abyssResult, { 1: 30, 2: 0 })
})


test("the exclusive equipment set is exactly the eleven fantasy weapons", () => {
    assert.deepEqual(FANTASY_EXCLUSIVE_EQUIPMENT_IDS, [
        100013, 100014, 100015, 100016, 100017, 100018,
        100019, 100020, 100021, 100022, 100023,
    ])
    // 深渊武器与灰的开发残留一件都不许混进来。
    for (const excluded of [
        5900101, 5900911, 5900916,
        8000101, 8000115, 8000201, 8000211,
    ]) {
        assert.equal(FANTASY_EXCLUSIVE_EQUIPMENT_IDS.includes(excluded), false)
    }
})


test("the exclusive-equipment guard deliberately exempts the Deep Abyss event", () => {
    // 作者 2026-09-02 裁定:深渊 700099 的任何逻辑分支都不许动,包括「开战时
    // 因为带了幻想装备而被拒」这条新分支。要改口径就删掉这一项。
    assert.equal(
        FANTASY_EQUIPMENT_EXEMPT_RUSH_EVENT_IDS.has(DEEP_ABYSS_RUSH_EVENT_ID),
        true,
    )
    assert.equal(
        FANTASY_EQUIPMENT_EXEMPT_RUSH_EVENT_IDS.has(FANTASY_GAUNTLET.rushEventId),
        true,
    )
    assert.equal(FANTASY_EQUIPMENT_EXEMPT_RUSH_EVENT_IDS.has(700001), false)
})


test("boss token payout is 5/10/20 and solo rounds pay no token", () => {
    assert.deepEqual({ ...FANTASY_BOSS_TOKEN_REWARDS }, { 5: 5, 10: 10, 15: 20 })
    assert.equal(FANTASY_BOSS_TOKEN_REWARDS[4], undefined)
})


test("only fantasy boss round markers get their members hidden", () => {
    const parties: Record<number, UserRushEventPlayedParty> = {
        700098004: playedParty(1101),
        700098005: playedParty(1201),
        700098010: playedParty(1301),
        700098015: playedParty(1401),
    }
    const hidden = hideFantasyBossPlayedPartyMembers(FANTASY_GAUNTLET.rushEventId, parties)
    assert.equal(hidden, 3)
    assert.equal(parties[700098004].character_id_1, 1101, "solo rounds keep their members")
    for (const round of [700098005, 700098010, 700098015]) {
        assert.equal(parties[round].character_id_1, null)
        assert.equal(parties[round].character_id_3, null)
        assert.equal(parties[round].unison_character_id_1, null)
        assert.equal(parties[round].evolution_img_level_1, null)
        // 装备/魂珠不属于角色锁,刻意保留。
        assert.equal(parties[round].equipment_id_1, 100013)
    }
})


test("the played-party scrub never touches another rush event", () => {
    const abyssParties: Record<number, UserRushEventPlayedParty> = {
        700099005: playedParty(2101),
        700099010: playedParty(2201),
        700099015: playedParty(2301),
    }
    const hidden = hideFantasyBossPlayedPartyMembers(DEEP_ABYSS_RUSH_EVENT_ID, abyssParties)
    assert.equal(hidden, 0)
    for (const round of [700099005, 700099010, 700099015]) {
        assert.notEqual(abyssParties[round].character_id_1, null)
    }
    assert.equal(shouldHideFantasyPlayedPartyMembers(DEEP_ABYSS_RUSH_EVENT_ID, 700099005), false)
    assert.equal(shouldHideFantasyPlayedPartyMembers(FANTASY_GAUNTLET.rushEventId, 700098005), true)
})


test("the modes.d sidecar guards exactly the multiplayer quest ids the runtime owns", () => {
    const configPath = path.join(process.cwd(), "modes.d", "fantasy-gauntlet.config.json")
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
        route_id: string
        quest_category: number
        guarded_quest_ids: number[]
        solo_entry: string
    }
    assert.equal(config.route_id, FANTASY_GAUNTLET.routeId)
    assert.equal(config.quest_category, Number(FANTASY_MULTI_CATEGORY))
    assert.equal(config.solo_entry, "reject")
    assert.deepEqual(config.guarded_quest_ids, [...listFantasyMultiQuestIds()])
})


test("with the sentinel in place the native folder-clear payout never fires on round 15", () => {
    // A13 的「二选一」在这里被钉死:全通奖励只由 settleFantasyBattleSync 发。
    // 原生路径一旦被触发就会 ① 再发一次 99×200 + 究极图腾 ②「一次性」标记
    // 让第二轮全通颗粒无收 ③ 把 folder 关掉。任何一条都是回归。
    const calls = { folderRewards: 0, clearedFolder: 0, deletedPartyList: 0, insertedParty: 0 }
    const derived = withFantasyFolderSentinel(
        FANTASY_GAUNTLET.rushEventId,
        { 1: 15, 2: 0 },
    )

    const { rushEventData } = handleRushEventFinish({
        questCategory: QuestCategory.RUSH_EVENT,
        questData: {
            rushEventId: FANTASY_GAUNTLET.rushEventId,
            rushEventFolderId: FANTASY_GAUNTLET.rushFolderId as never,
            rushEventRound: 15,
        },
        clearTime: 1000,
        party: {
            characters: [{ id: 1001 }, null, null],
            unison_characters: [null, null, null],
            equipments: [null, null, null],
            ability_soul_ids: [null, null, null],
        },
        playerId: 1,
        questId: FANTASY_GAUNTLET.rushEventId * 1000 + 15,
        getEvoLevels: (_playerId, ids) => ids.map(() => 0),
        folderMaxRounds: derived,
        getRushEvent: () => null,
        updateRushEvent: () => undefined,
        insertParty: () => { calls.insertedParty += 1 },
        insertClearedFolder: () => { calls.clearedFolder += 1 },
        deletePartyList: () => { calls.deletedPartyList += 1 },
        getSerializedParties: () => ({ folderParties: {}, endlessParties: {} }),
        getFolderRewards: () => {
            calls.folderRewards += 1
            return [{ type: 0, id: 99, count: 200 }]
        },
        giveRewards: () => null,
        getClearedFolders: () => [],
    })

    assert.deepEqual(calls, {
        folderRewards: 0,
        clearedFolder: 0,
        deletedPartyList: 0,
        insertedParty: 1,
    })
    assert.deepEqual(rushEventData?.rush_battle_reward_list, [])
})


test("without the sentinel the same round would have paid the folder bundle twice over", () => {
    // 反证:证明上一条断言真的在测哨兵,而不是在测别的东西。
    let folderRewardCalls = 0
    handleRushEventFinish({
        questCategory: QuestCategory.RUSH_EVENT,
        questData: {
            rushEventId: FANTASY_GAUNTLET.rushEventId,
            rushEventFolderId: FANTASY_GAUNTLET.rushFolderId as never,
            rushEventRound: 15,
        },
        clearTime: 1000,
        party: {
            characters: [{ id: 1001 }, null, null],
            unison_characters: [null, null, null],
            equipments: [null, null, null],
            ability_soul_ids: [null, null, null],
        },
        playerId: 1,
        questId: FANTASY_GAUNTLET.rushEventId * 1000 + 15,
        getEvoLevels: (_playerId, ids) => ids.map(() => 0),
        folderMaxRounds: { 1: 15, 2: 0 },
        getRushEvent: () => null,
        updateRushEvent: () => undefined,
        insertParty: () => undefined,
        insertClearedFolder: () => undefined,
        deletePartyList: () => undefined,
        getSerializedParties: () => ({ folderParties: {}, endlessParties: {} }),
        getFolderRewards: () => {
            folderRewardCalls += 1
            return [{ type: 0, id: 99, count: 200 }]
        },
        giveRewards: () => null,
        getClearedFolders: () => [],
    })
    assert.equal(folderRewardCalls, 1)
})
