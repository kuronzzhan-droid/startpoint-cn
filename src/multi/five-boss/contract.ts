import { QuestCategory } from "../../lib/types"


/**
 * Runtime identifiers shared by the multiplayer route and the generated client package.
 * The cross-stack test pins these values to mod-tools/five_boss_coop_v1.json.
 */
export const FIVE_BOSS_GAUNTLET = Object.freeze({
    routeId: "five_boss_coop_v1",
    category: QuestCategory.BOSS_BATTLE,
    visibleQuestId: 1099001,
    hiddenQuestIds: [1099002, 1099003] as const,
    ticketItemId: 10000143,
    roomMemberLimit: 3,
    sceneBossCounts: [3, 4] as const,
    aiFillTimeoutMs: 120_000,
})


export function isFiveBossGauntletQuest(
    category: number,
    questId: number | string,
): boolean {
    return category === FIVE_BOSS_GAUNTLET.category
        && questId === FIVE_BOSS_GAUNTLET.visibleQuestId
}
