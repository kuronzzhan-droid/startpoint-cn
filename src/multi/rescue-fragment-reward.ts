import { QuestCategory, Reward, RewardType } from "../lib/types"
import adventEventQuests from "../../assets/advent_event_quest.json"
import bossBattleQuests from "../../assets/boss_battle_quest.json"
import hardMultiEventQuests from "../../assets/hard_multi_event_quest.json"
import raidEventQuests from "../../assets/raid_event_quest.json"
import worldStoryEventBossBattleQuests from "../../assets/world_story_event_boss_battle_quest.json"

export const RESCUE_SILVER_FRAGMENT_ITEM_ID = 49000
export const RESCUE_GOLD_FRAGMENT_ITEM_ID = 49001
export const RESCUE_PURPLE_FRAGMENT_ITEM_ID = 49002

// These groups are added to AdditionalRewardTable by the matching
// 1.4.58 -> 1.4.59 client asset patch. Unpatched clients still receive the
// inventory item; patched clients also render it on the result screen.
export const RESCUE_SILVER_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID = 490000
export const RESCUE_GOLD_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID = 490001
export const RESCUE_PURPLE_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID = 490002

export interface RescueFragmentAdditionalReward {
    group_id: number
    index: number
    number: number
}

type RawBattleQuest = {
    rankPointReward?: number
    [key: string]: unknown
}

type RawQuestTable = Record<string, RawBattleQuest>

const rescueFragmentItemByCategoryAndQuest = new Map<string, number>()

function rewardKey(category: number, questId: number): string {
    return `${category}:${Math.abs(Math.trunc(questId))}`
}

function registerReward(category: number, questId: number, itemId: number): void {
    rescueFragmentItemByCategoryAndQuest.set(rewardKey(category, questId), itemId)
}

function groupBattleQuestIds(table: RawQuestTable): number[][] {
    const groups = new Map<number, number[]>()
    for (const [rawQuestId, quest] of Object.entries(table)) {
        const questId = Number(rawQuestId)
        if (!Number.isSafeInteger(questId) || quest.rankPointReward === undefined) continue
        const groupId = Math.floor(questId / 1000)
        const group = groups.get(groupId) ?? []
        group.push(questId)
        groups.set(groupId, group)
    }
    return [...groups.values()].map(group => group.sort((a, b) => a - b))
}

function registerSequentialDifficultyRewards(
    category: number,
    table: RawQuestTable,
): void {
    for (const questIds of groupBattleQuestIds(table)) {
        for (let index = 0; index < questIds.length; index++) {
            let itemId: number
            if (questIds.length <= 2) {
                itemId = index === 0
                    ? RESCUE_SILVER_FRAGMENT_ITEM_ID
                    : RESCUE_GOLD_FRAGMENT_ITEM_ID
            } else if (questIds.length === 3) {
                itemId = index === 0
                    ? RESCUE_SILVER_FRAGMENT_ITEM_ID
                    : index === 1
                        ? RESCUE_GOLD_FRAGMENT_ITEM_ID
                        : RESCUE_PURPLE_FRAGMENT_ITEM_ID
            } else {
                itemId = index <= 1
                    ? RESCUE_SILVER_FRAGMENT_ITEM_ID
                    : index === 2
                        ? RESCUE_GOLD_FRAGMENT_ITEM_ID
                        : RESCUE_PURPLE_FRAGMENT_ITEM_ID
            }
            registerReward(category, questIds[index], itemId)
        }
    }
}

// Normal and later-added permanent bosses.
for (const questIds of groupBattleQuestIds(bossBattleQuests)) {
    const bossId = Math.floor(questIds[0] / 1000)
    for (const questId of questIds) {
        const difficulty = questId % 1000
        let itemId: number

        if (bossId === 1001) {
            // V・Solas and its later-added special variants do not form one
            // continuous difficulty ladder.
            itemId = difficulty === 1
                ? RESCUE_SILVER_FRAGMENT_ITEM_ID
                : difficulty === 2
                    ? RESCUE_GOLD_FRAGMENT_ITEM_ID
                    : RESCUE_PURPLE_FRAGMENT_ITEM_ID
        } else if (bossId === 1020) {
            // Yamata-no-Orochi has only three configured difficulties. Its
            // final "Super" rescue reward is gold on this server.
            itemId = difficulty === 1
                ? RESCUE_SILVER_FRAGMENT_ITEM_ID
                : RESCUE_GOLD_FRAGMENT_ITEM_ID
        } else {
            itemId = difficulty <= 2
                ? RESCUE_SILVER_FRAGMENT_ITEM_ID
                : difficulty === 3
                    ? RESCUE_GOLD_FRAGMENT_ITEM_ID
                    : RESCUE_PURPLE_FRAGMENT_ITEM_ID
        }
        registerReward(QuestCategory.BOSS_BATTLE, questId, itemId)
    }
}

// Limited-event co-op bosses. Story-only rows are excluded by the absence of
// rankPointReward; the remaining rows are the actual battle difficulty ladder.
registerSequentialDifficultyRewards(
    QuestCategory.ADVENT_EVENT_MULTI,
    adventEventQuests,
)

// World-story event boss tables commonly interleave two single-player rows
// followed by the same two co-op rows. Each pair is Advanced / Advanced+.
for (const questIds of groupBattleQuestIds(worldStoryEventBossBattleQuests)) {
    for (let index = 0; index < questIds.length; index++) {
        const pairIndex = questIds.length >= 4 ? index % 2 : index
        registerReward(
            QuestCategory.WORLD_STORY_EVENT_BOSS_BATTLE,
            questIds[index],
            pairIndex === 0
                ? RESCUE_SILVER_FRAGMENT_ITEM_ID
                : RESCUE_GOLD_FRAGMENT_ITEM_ID,
        )
    }
}

// Raid-event IDs contain a few short/offset blocks, so use the configured
// rank-point tier instead of deriving a difficulty from the numeric suffix.
for (const [rawQuestId, quest] of Object.entries(raidEventQuests)) {
    const questId = Number(rawQuestId)
    if (!Number.isSafeInteger(questId)) continue
    const rankPointReward = quest.rankPointReward
    registerReward(
        QuestCategory.RAID_EVENT,
        questId,
        rankPointReward <= 50
            ? RESCUE_SILVER_FRAGMENT_ITEM_ID
            : rankPointReward < 100
                ? RESCUE_GOLD_FRAGMENT_ITEM_ID
                : RESCUE_PURPLE_FRAGMENT_ITEM_ID,
    )
}

// Every configured hard-multi quest is a decisive/special steam-robot battle.
// This intentionally includes the three post-added IDs 100000001-100002001.
for (const rawQuestId of Object.keys(hardMultiEventQuests)) {
    const questId = Number(rawQuestId)
    if (!Number.isSafeInteger(questId)) continue
    registerReward(
        QuestCategory.HARD_MULTI_EVENT,
        questId,
        RESCUE_PURPLE_FRAGMENT_ITEM_ID,
    )
}

/**
 * Returns the repeatable reward for one successful rescue clear.
 *
 * Rewards are registered only for quest IDs that exist in the shipped master
 * tables. This covers permanent bosses, limited co-op events, world-story
 * bosses, raid-event quests and all decisive steam robots without accepting
 * arbitrary IDs that merely resemble a valid difficulty suffix.
 */
export function getRescueFragmentReward(
    category: number,
    questId: number,
): Reward | null {
    const itemId = rescueFragmentItemByCategoryAndQuest.get(
        rewardKey(category, questId),
    )
    if (itemId === undefined) return null
    return {
        type: RewardType.ITEM,
        id: itemId,
        count: 10,
    } as Reward
}

export function getRescueFragmentAdditionalReward(
    reward: Reward | null,
): RescueFragmentAdditionalReward | null {
    if (reward === null || reward.type !== RewardType.ITEM) return null
    const itemReward = reward as Reward & { id: number; count: number }

    let groupId: number
    switch (itemReward.id) {
        case RESCUE_SILVER_FRAGMENT_ITEM_ID:
            groupId = RESCUE_SILVER_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID
            break
        case RESCUE_GOLD_FRAGMENT_ITEM_ID:
            groupId = RESCUE_GOLD_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID
            break
        case RESCUE_PURPLE_FRAGMENT_ITEM_ID:
            groupId = RESCUE_PURPLE_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID
            break
        default:
            return null
    }

    return {
        group_id: groupId,
        index: 1,
        number: itemReward.count,
    }
}
