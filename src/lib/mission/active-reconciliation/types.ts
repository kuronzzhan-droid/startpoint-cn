import type { ReadonlyContentRepository } from "../../../content/runtime/content-snapshot"

export interface ActiveMissionEventEligibilityContext {
    readonly playerId: number
    readonly eventId: number
    readonly eventStringId: string
    readonly eventKind: number
}

export interface ReconcileActiveMissionFactsInput {
    readonly playerId: number
    readonly repository: ReadonlyContentRepository
    readonly now: number | Date
    readonly isEventEligible?: (context: ActiveMissionEventEligibilityContext) => boolean
    readonly patterns?: readonly number[]
}

export interface ActiveMissionFactCharacter {
    readonly rarity?: number
    readonly exp: number
    readonly evolutionLevel: number
    readonly overLimitStep: number
    readonly bondTokenList: readonly { readonly status: number }[]
}

export interface ActiveMissionFactQuestProgress {
    readonly category: number
    readonly questId: number
    readonly finished: boolean
    readonly clearRank?: number
    readonly leaderCharacterId?: number
    readonly multiClearCount: number
}

export interface ActiveMissionFactState {
    readonly player: Readonly<{
        readonly totalLoginDays: number
        readonly totalStaminaUsed: number
    }>
    readonly battleCounters: Readonly<{
        readonly singleClearCount?: number
        readonly multiClearCount?: number
        readonly multiHostClearCount?: number
        readonly singleRankSsCount?: number
        readonly rankSsCount?: number
    }>
    readonly finishedQuestIds: ReadonlySet<number>
    readonly questProgress: readonly ActiveMissionFactQuestProgress[]
    readonly chapterQuestIds: Readonly<Record<string, readonly number[]>>
    readonly practiceQuestChallengeCount: number
    readonly leaderClearCounts: Readonly<Record<string, Readonly<{
        readonly all: number
        readonly multi: number
    }>>>
    readonly conditionalBattleFacts: Readonly<Record<string, number>>
    readonly loadoutBattleFacts: Readonly<Record<string, number>>
    readonly characterStoryQuestIds: Readonly<Record<string, readonly number[]>>
    readonly characters: Readonly<Record<string, ActiveMissionFactCharacter>>
    readonly equipment: readonly Readonly<{
        readonly level: number
        readonly maxLevel: number
        readonly enhancementLevel?: number
    }>[]
    readonly manaNodes: Readonly<Record<string, readonly number[]>>
    readonly manaBoardNodes: Readonly<Record<string, Readonly<Record<string, readonly number[]>>>>
    readonly manaNodeSlots: Readonly<Record<string, Readonly<Record<string, number>>>>
    readonly partyAbilitySoulCount: number
    readonly treasureShopPurchaseCount: number
    readonly bossCoinShopPurchaseCount: number
    readonly bossCoinEquipmentShopPurchaseCount: number
    readonly totalUsedManaCount: number
    readonly totalGachaCharacterCount: number
    readonly totalEquipmentEquipCount: number
    readonly totalUnisonSetCount: number
    readonly totalPartyCharacterSetCount: number
    readonly totalInjectedExpCount: number
    readonly totalGachaCampaignCount: number
}
