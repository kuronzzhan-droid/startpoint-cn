import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import type { PlayerRushEventPlayedParty } from "../data/types"


const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-fantasy-run-"))
process.env.WF_DATABASE_DIR = databaseDir

const accountDomain = require("../data/domains/account") as typeof import("../data/domains/account")
const playerDomain = require("../data/domains/player") as typeof import("../data/domains/player")
const itemDomain = require("../data/domains/item") as typeof import("../data/domains/item")
const rushDomain = require("../data/domains/rushEvent") as typeof import("../data/domains/rushEvent")
const { getDb } = require("../data/db") as typeof import("../data/db")
const { RushEventBattleType } = require("../data/types") as typeof import("../data/types")
const { QuestCategory } = require("../lib/types") as typeof import("../lib/types")
const fantasy = require("../lib/fantasy-gauntlet") as typeof import("../lib/fantasy-gauntlet")

const {
    FANTASY_GAUNTLET,
    canJoinFantasyRescueSync,
    canStartFantasyQuestSync,
    getExpectedFantasyStageSync,
    resetFantasyRunSync,
    settleFantasyBattleSync,
} = fantasy

const DEEP_ABYSS_RUSH_EVENT_ID = 700099
const DREAM_EMBLEM_ID = FANTASY_GAUNTLET.dreamEmblemItemId
let identity = 0


function createPlayer(): number {
    identity += 1
    const account = accountDomain.insertAccountSync({
        appId: `fantasy-run-test-${identity}`,
        idpAlias: "test",
        idpCode: "test",
        idpId: `fantasy-run-test-${identity}`,
        status: "active",
    })
    return playerDomain.insertDefaultPlayerSync(account.id).id
}


function party(round: number, leaderId = 1001): PlayerRushEventPlayedParty {
    return {
        characterIds: [leaderId, leaderId + 1, leaderId + 2],
        unisonCharacterIds: [null, null, null],
        equipmentIds: [null, null, null],
        abilitySoulIds: [null, null, null],
        evolutionImgLevels: [0, 0, 0],
        unisonEvolutionImgLevels: [null, null, null],
        round,
        battleType: RushEventBattleType.FOLDER,
    }
}


/**
 * 模拟单人关结算写下的两样东西:folder 标记(rush-handler)与永久通关记录
 * (quest progress)。原生 EventFolder 的「已完成」分类读的是后者。
 */
function markStagesCleared(playerId: number, upToStage: number): void {
    for (let stage = 1; stage <= upToStage; stage += 1) {
        rushDomain.insertPlayerRushEventPlayedPartySync(
            playerId,
            FANTASY_GAUNTLET.rushEventId,
            party(FANTASY_GAUNTLET.rushEventId * 1000 + stage),
        )
        getDb().prepare(`
            INSERT OR IGNORE INTO players_quest_progress (
                section, quest_id, finished, unlocked, high_score, clear_rank,
                best_elapsed_time_ms, leader_character_id, multi_clear_count, player_id
            ) VALUES (?, ?, 1, 1, NULL, 5, NULL, NULL, 0, ?)
        `).run(
            Number(QuestCategory.RUSH_EVENT),
            FANTASY_GAUNTLET.rushEventId * 1000 + stage,
            playerId,
        )
    }
}


/** 给深渊连战埋一份完整的进度快照,用来证明幻想的任何路径都碰不到它。 */
function seedDeepAbyssProgress(playerId: number): void {
    rushDomain.insertPlayerRushEventSync(playerId, {
        eventId: DEEP_ABYSS_RUSH_EVENT_ID,
        endlessBattleNextRound: 8,
        activeRushBattleFolderId: 1,
        endlessBattleMaxRound: 7,
        endlessBattleMaxRoundTime: 12345,
        endlessBattleMaxRoundCharacterIds: [2001, 2002, 2003],
        endlessBattleMaxRoundCharacterEvolutionImgLvls: [1, 1, 1],
    })
    rushDomain.insertPlayerRushEventPlayedPartySync(
        playerId,
        DEEP_ABYSS_RUSH_EVENT_ID,
        party(DEEP_ABYSS_RUSH_EVENT_ID * 1000 + 1, 2001),
    )
    rushDomain.insertPlayerRushEventClearedFolderSync(playerId, DEEP_ABYSS_RUSH_EVENT_ID, 1)
    getDb().prepare(`
        INSERT INTO players_quest_progress (
            section, quest_id, finished, unlocked, high_score, clear_rank,
            best_elapsed_time_ms, leader_character_id, multi_clear_count, player_id
        ) VALUES (?, ?, 1, 1, 4321, 5, 9999, 2001, 0, ?)
    `).run(Number(QuestCategory.RUSH_EVENT), DEEP_ABYSS_RUSH_EVENT_ID * 1000 + 1, playerId)
}


function deepAbyssSnapshot(playerId: number): string {
    return JSON.stringify({
        rushEvent: getDb().prepare(
            `SELECT * FROM players_rush_events WHERE player_id = ? AND event_id = ?`,
        ).all(playerId, DEEP_ABYSS_RUSH_EVENT_ID),
        playedParties: getDb().prepare(
            `SELECT * FROM players_rush_events_played_parties
             WHERE player_id = ? AND event_id = ? ORDER BY round`,
        ).all(playerId, DEEP_ABYSS_RUSH_EVENT_ID),
        clearedFolders: getDb().prepare(
            `SELECT * FROM players_rush_events_cleared_folders
             WHERE player_id = ? AND event_id = ? ORDER BY folder_id`,
        ).all(playerId, DEEP_ABYSS_RUSH_EVENT_ID),
        questProgress: getDb().prepare(
            `SELECT * FROM players_quest_progress
             WHERE player_id = ? AND quest_id BETWEEN ? AND ? ORDER BY section, quest_id`,
        ).all(
            playerId,
            DEEP_ABYSS_RUSH_EVENT_ID * 1000,
            DEEP_ABYSS_RUSH_EVENT_ID * 1000 + 999,
        ),
    })
}


function questProgressRow(playerId: number, category: number, questId: number) {
    return getDb().prepare(
        `SELECT * FROM players_quest_progress
         WHERE player_id = ? AND section = ? AND quest_id = ?`,
    ).get(playerId, Number(category), questId) as Record<string, unknown> | undefined
}


function folderMarkerCount(playerId: number): number {
    const row = getDb().prepare(`
        SELECT COUNT(*) AS marker_count
        FROM players_rush_events_played_parties
        WHERE player_id = ? AND event_id = ? AND battle_type = ?
    `).get(
        playerId,
        FANTASY_GAUNTLET.rushEventId,
        RushEventBattleType.FOLDER,
    ) as { marker_count: number }
    return row.marker_count
}


test("the expected stage follows the folder markers, and wraps after a full run", () => {
    const playerId = createPlayer()
    assert.equal(getExpectedFantasyStageSync(playerId), 1)

    markStagesCleared(playerId, 4)
    assert.equal(getExpectedFantasyStageSync(playerId), 5)

    markStagesCleared(playerId, 15)
    assert.equal(getExpectedFantasyStageSync(playerId), 1, "a finished run restarts at stage 1")
})


test("the order gate admits only the stage the run is actually on", () => {
    const playerId = createPlayer()
    markStagesCleared(playerId, 3)

    const onTrack = canStartFantasyQuestSync(playerId, QuestCategory.RUSH_EVENT, 700098004)
    assert.equal(onTrack.allowed, true)
    assert.equal(onTrack.stage, 4)
    assert.equal(onTrack.expectedStage, 4)

    const replay = canStartFantasyQuestSync(playerId, QuestCategory.RUSH_EVENT, 700098002)
    assert.equal(replay.allowed, false)
    assert.equal(replay.expectedStage, 4)

    const skipAhead = canStartFantasyQuestSync(playerId, QuestCategory.RUSH_EVENT, 700098008)
    assert.equal(skipAhead.allowed, false)

    // Rush 侧的 boss 占位关无论进度到哪都开不了。
    const placeholder = canStartFantasyQuestSync(playerId, QuestCategory.RUSH_EVENT, 700098005)
    assert.equal(placeholder.allowed, false)
    assert.equal(placeholder.stage, null)
})


test("rescue guests may join any boss round without owning the run", () => {
    const playerId = createPlayer()
    markStagesCleared(playerId, 2)

    const rescue = canJoinFantasyRescueSync(playerId, QuestCategory.ADVENT_EVENT_SINGLE, 300098003)
    assert.equal(rescue.allowed, true)
    assert.equal(rescue.stage, 15)
    assert.equal(rescue.expectedStage, 3)

    assert.equal(
        canJoinFantasyRescueSync(playerId, QuestCategory.RUSH_EVENT, 700099001).allowed,
        false,
        "a Deep Abyss quest is never a fantasy rescue target",
    )
})


test("a cleared solo round pays its round-keyed material bundle", () => {
    const playerId = createPlayer()
    const result = settleFantasyBattleSync(playerId, QuestCategory.RUSH_EVENT, 700098004, true)

    assert.notEqual(result, null)
    assert.equal(result!.stage, 4)
    assert.equal(result!.fullClear, false)
    assert.equal(result!.tokenAmount, 0)
    assert.equal(itemDomain.getPlayerItemSync(playerId, DREAM_EMBLEM_ID), 5)
    assert.equal(itemDomain.getPlayerItemSync(playerId, 2), 150)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FANTASY_GAUNTLET.tokenItemId), null)

    const groupIds = new Set(result!.fantasy_additional_reward_ids.map(entry => entry.group_id))
    assert.deepEqual([...groupIds], [FANTASY_GAUNTLET.soloRewardGroupBaseId + 4])
    assert.equal(result!.fantasy_additional_reward_ids.length, 7)
})


test("a host boss clear pays its token, completes the rush placeholder and writes the marker", () => {
    const playerId = createPlayer()
    markStagesCleared(playerId, 4)

    const result = settleFantasyBattleSync(
        playerId,
        QuestCategory.ADVENT_EVENT_SINGLE,
        300098001,
        true,
        {
            rescue: false,
            playedParty: {
                characterIds: [1101, 1102, 1103],
                unisonCharacterIds: [null, null, null],
                equipmentIds: [null, null, null],
                abilitySoulIds: [null, null, null],
                evolutionImgLevels: [0, 0, 0],
                unisonEvolutionImgLevels: [null, null, null],
            },
        },
    )

    assert.equal(result!.stage, 5)
    assert.equal(result!.tokenAmount, 5)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FANTASY_GAUNTLET.tokenItemId), 5)
    assert.deepEqual(result!.fantasy_additional_reward_ids, [
        { group_id: FANTASY_GAUNTLET.bossTokenRewardGroupId, index: 1, number: 5 },
    ])

    const placeholder = questProgressRow(playerId, QuestCategory.RUSH_EVENT, 700098005)
    assert.equal(placeholder?.finished, 1)
    assert.equal(getExpectedFantasyStageSync(playerId), 6, "the boss marker advances the run")
})


test("a rescue guest is paid but neither advances nor loses their own run", () => {
    const playerId = createPlayer()
    markStagesCleared(playerId, 2)

    const result = settleFantasyBattleSync(
        playerId,
        QuestCategory.ADVENT_EVENT_SINGLE,
        300098002,
        true,
        { rescue: true, playedParty: {
            characterIds: [1201, null, null],
            unisonCharacterIds: [null, null, null],
            equipmentIds: [null, null, null],
            abilitySoulIds: [null, null, null],
            evolutionImgLevels: [0, null, null],
            unisonEvolutionImgLevels: [null, null, null],
        } },
    )

    assert.equal(result!.tokenAmount, 10)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FANTASY_GAUNTLET.tokenItemId), 10)
    assert.equal(result!.fullClear, false)
    assert.equal(
        questProgressRow(playerId, QuestCategory.RUSH_EVENT, 700098010),
        undefined,
        "a rescue guest must not complete the host's placeholder",
    )
    assert.equal(getExpectedFantasyStageSync(playerId), 3)
    assert.equal(folderMarkerCount(playerId), 2)
})


test("an empty boss party is refused as a marker instead of crashing the rush page", () => {
    const playerId = createPlayer()
    markStagesCleared(playerId, 4)

    settleFantasyBattleSync(playerId, QuestCategory.ADVENT_EVENT_SINGLE, 300098001, true, {
        rescue: false,
        playedParty: {
            characterIds: [null, null, null],
            unisonCharacterIds: [null, null, null],
            equipmentIds: [null, null, null],
            abilitySoulIds: [null, null, null],
            evolutionImgLevels: [null, null, null],
            unisonEvolutionImgLevels: [null, null, null],
        },
    })

    assert.equal(folderMarkerCount(playerId), 4, "no empty marker row is written")
    assert.equal(questProgressRow(playerId, QuestCategory.RUSH_EVENT, 700098005)?.finished, 1)
})


test("the fifteenth boss pays the full-clear bundle exactly once and restarts the run", () => {
    const playerId = createPlayer()
    markStagesCleared(playerId, 14)
    getDb().prepare(`
        INSERT INTO players_quest_progress (
            section, quest_id, finished, unlocked, high_score, clear_rank,
            best_elapsed_time_ms, leader_character_id, multi_clear_count, player_id
        ) VALUES (?, ?, 1, 1, NULL, 5, NULL, NULL, 0, ?)
    `).run(Number(QuestCategory.ADVENT_EVENT_SINGLE), 300098002, playerId)

    const result = settleFantasyBattleSync(
        playerId,
        QuestCategory.ADVENT_EVENT_SINGLE,
        300098003,
        true,
        { rescue: false, playedParty: {
            characterIds: [1301, 1302, 1303],
            unisonCharacterIds: [null, null, null],
            equipmentIds: [null, null, null],
            abilitySoulIds: [null, null, null],
            evolutionImgLevels: [0, 0, 0],
            unisonEvolutionImgLevels: [null, null, null],
        } },
    )

    assert.equal(result!.fullClear, true)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FANTASY_GAUNTLET.tokenItemId), 20)
    assert.equal(itemDomain.getPlayerItemSync(playerId, DREAM_EMBLEM_ID), 200)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FANTASY_GAUNTLET.fullClearTokenItemId), 1)
    assert.deepEqual(
        result!.fantasy_additional_reward_ids.filter(
            entry => entry.group_id === FANTASY_GAUNTLET.fullClearRewardGroupId,
        ),
        [
            { group_id: FANTASY_GAUNTLET.fullClearRewardGroupId, index: 1, number: 200 },
            { group_id: FANTASY_GAUNTLET.fullClearRewardGroupId, index: 2, number: 1 },
        ],
    )

    // 全通把这一轮重置回第 1 关,而 Rush 侧的通关记录作为历史保留。
    assert.equal(getExpectedFantasyStageSync(playerId), 1)
    assert.equal(folderMarkerCount(playerId), 0)
    assert.equal(
        questProgressRow(playerId, QuestCategory.ADVENT_EVENT_SINGLE, 300098002),
        undefined,
        "the multiplayer visibility chain is run-scoped and gets cleared",
    )
    assert.equal(questProgressRow(playerId, QuestCategory.RUSH_EVENT, 700098015)?.finished, 1)
    assert.equal(
        questProgressRow(playerId, QuestCategory.RUSH_EVENT, FANTASY_GAUNTLET.practiceQuestId)
            ?.finished,
        1,
        "the native completed-tab classification row is repaired on full clear",
    )
})


test("a failed round throws the run away, but a rescue guest's failure does not", () => {
    const owner = createPlayer()
    markStagesCleared(owner, 6)
    assert.equal(settleFantasyBattleSync(owner, QuestCategory.RUSH_EVENT, 700098007, false), null)
    assert.equal(getExpectedFantasyStageSync(owner), 1)
    assert.equal(folderMarkerCount(owner), 0)

    const guest = createPlayer()
    markStagesCleared(guest, 6)
    assert.equal(
        settleFantasyBattleSync(
            guest, QuestCategory.ADVENT_EVENT_SINGLE, 300098001, false, { rescue: true },
        ),
        null,
    )
    assert.equal(getExpectedFantasyStageSync(guest), 7)
    assert.equal(folderMarkerCount(guest), 6)
})


test("nothing the fantasy runtime does touches Deep Abyss rows", () => {
    const playerId = createPlayer()
    seedDeepAbyssProgress(playerId)
    const before = deepAbyssSnapshot(playerId)

    markStagesCleared(playerId, 14)
    settleFantasyBattleSync(playerId, QuestCategory.RUSH_EVENT, 700098004, true)
    settleFantasyBattleSync(playerId, QuestCategory.ADVENT_EVENT_SINGLE, 300098003, true, {
        rescue: false,
        playedParty: {
            characterIds: [1401, 1402, 1403],
            unisonCharacterIds: [null, null, null],
            equipmentIds: [null, null, null],
            abilitySoulIds: [null, null, null],
            evolutionImgLevels: [0, 0, 0],
            unisonEvolutionImgLevels: [null, null, null],
        },
    })
    settleFantasyBattleSync(playerId, QuestCategory.RUSH_EVENT, 700098001, false)
    resetFantasyRunSync(playerId)

    assert.equal(deepAbyssSnapshot(playerId), before, "Deep Abyss state must be byte-identical")
})


test("resetting the fantasy run keeps tokens and the rush clear history", () => {
    const playerId = createPlayer()
    markStagesCleared(playerId, 5)
    itemDomain.setPlayerItemSync(playerId, FANTASY_GAUNTLET.tokenItemId, 42)

    resetFantasyRunSync(playerId)

    assert.equal(getExpectedFantasyStageSync(playerId), 1)
    assert.equal(folderMarkerCount(playerId), 0)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FANTASY_GAUNTLET.tokenItemId), 42)
    assert.equal(questProgressRow(playerId, QuestCategory.RUSH_EVENT, 700098003)?.finished, 1)

    const rushEventRow = getDb().prepare(
        `SELECT active_rush_battle_folder_id FROM players_rush_events
         WHERE player_id = ? AND event_id = ?`,
    ).get(playerId, FANTASY_GAUNTLET.rushEventId) as
        { active_rush_battle_folder_id: number } | undefined
    assert.equal(rushEventRow?.active_rush_battle_folder_id, FANTASY_GAUNTLET.rushFolderId)
})
