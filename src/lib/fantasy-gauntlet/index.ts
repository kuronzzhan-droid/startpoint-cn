/**
 * 幻想连战(Fantasy Gauntlet / 700098 + 300098)服务端运行期。
 *
 * ── 边界 ────────────────────────────────────────────────────────────
 * 本目录下所有分支**必须**以 700098 / 300098 为门。深渊连战 700099 及其
 * 装备、商店、rogue 配置的既有路径一条都不许被这里改写(作者 2026-09-02 裁定)。
 *
 * 装载缝对标 `src/multi/five-boss/*`:运行期留在 `src/`,`modes.d` 模块只做
 * 身份声明 + 单人入口守卫,靠 `fantasy-gauntlet.multiplayer-runtime@1`
 * 这个 server capability 失败即关闭。
 */
export {
    FANTASY_BOSS_STAGES,
    FANTASY_BOSS_TOKEN_REWARDS,
    FANTASY_EQUIPMENT_EXEMPT_RUSH_EVENT_IDS,
    FANTASY_EXCLUSIVE_EQUIPMENT_IDS,
    FANTASY_GAUNTLET,
    FANTASY_MULTI_CATEGORY,
    FANTASY_SOLO_STAGES,
    getFantasyQuestRef,
    isFantasyGauntletEnabled,
    isFantasyMultiQuest,
    isFantasyPracticeQuest,
    isFantasyQuest,
    listFantasyMultiQuestIds,
    listFantasyQuests,
    withFantasyFolderSentinel,
    type FantasyQuestRef,
} from "./contract"

export {
    clearSerializedPlayedPartyMembers,
    hideFantasyBossPlayedPartyMembers,
    shouldHideFantasyPlayedPartyMembers,
} from "./played-party"

export { repairFantasyCompletionClassificationSync } from "./completion"

export {
    canJoinFantasyRescueSync,
    canStartFantasyQuestSync,
    FANTASY_RUSH_PARTY_CATEGORY,
    getExpectedFantasyStageSync,
    getFantasyExclusiveGlobalPartyItemsSync,
    getFantasyExclusivePartyItemsSync,
    resetFantasyRunSync,
    type FantasyRunGate,
} from "./run-gate"

export {
    FANTASY_FULL_CLEAR_REWARDS,
    FANTASY_SOLO_FIXED_REWARDS,
    settleFantasyBattleSync,
    type FantasyAdditionalRewardEntry,
    type FantasySettlementOptions,
    type FantasySettlementResult,
} from "./settlement"

export {
    shouldResetFantasyRunForStaleActiveQuest,
    type FantasyActiveQuestOwnership,
} from "./active-quest-recovery"
