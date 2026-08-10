// Dormant degree (category 5) computer.
//
// The top of the engine: it only orchestrates the four layers below it (master index, context,
// quest evaluator, coverage). No database handle, no writes, no settlement, no cache mutation —
// every value it returns comes from the frozen context it was handed.
//
// It is deliberately not wired up. The live registry still points category 5 at the untouched
// `computer-degree.ts` facade, nothing re-exports `DegreeComputerV2` from the mission barrel, and
// turning it on is a Wave2b commit of its own. Only the focused tests import it, by full path.
//
// Two SOURCE behaviours are corrected here. A title the engine cannot recompute returns undefined
// and keeps whatever the database holds, instead of collapsing to zero; and every recoverable value
// is checked to be a non-negative safe integer before it can raise stored progress, because an
// Infinity or a fraction reaching the client is worse than an abort.

import type { PlayerCharacter } from "../../../data/types"
import { getCharacterDataSync } from "../../assets"
import { characterExpCaps } from "../../character"
import { getRankDegree } from "../../stamina"
import type { CategoryContext, MissionComputer } from "../types"
import { buildDegreeContext, isDegreeContext, positiveSafeInteger, safeAdd, unsignedSafeInteger } from "./context"
import type { DegreeContext } from "./context"
import { SUPPORTED_FAMILIES } from "./coverage"
import { DEGREE_CATEGORY, optionalMasterInteger } from "./master-index"
import type { DegreeDefinition } from "./master-index"
import {
    bestSingleClearTimeMs,
    completedChapter,
    countQuestClears,
    matchesQuest,
    maxClearRankCount,
    maxHighScore,
    readCounter,
    requestedBattleMode,
    resolveQuestFilter,
} from "./quest-evaluator"

const STATISTIC_KIND_COLUMN = 4
const CHAPTER_COLUMN = 9
const ITEM_COLUMN = 13
const CHARACTER_COLUMN = 15
const BOND_TOKEN_RECEIVED = 2
const SS_CLEAR_RANK = 5
const DASH_KIND = 2
const FEVER_TIME_KIND = 15
const MILLISECONDS_PER_SECOND = 1000
const BATTLE_STAT_DIMENSION = "battle.stat"
const AWAKENING_LEVEL = 1
const LV5_EQUIPMENT_LEVEL = 5

/** Statistic kinds with a counter behind them; anything else is not recoverable at all. */
const STATISTIC_KIND_NAMES: Readonly<Record<number, string>> = Object.freeze({
    0: "weak_point", 2: "dash", 4: "skill", 5: "fever", 7: "enemy_kill", 8: "emotion",
    9: "buff_companion", 10: "heal_companion", 11: "coffin_reduce", 12: "clear_debuff_self",
    13: "debuff_enemy", 14: "clear_buff_enemy", 15: "fever_time_ms", 16: "power_flip_lv3",
})

/** Level 100 plus a received bond token, counted separately, so the value is 0, 1 or 2. */
export function getCharacterFavorProgress(characterId: number, character: PlayerCharacter | undefined): number {
    if (character === undefined) return 0
    const rarity = getCharacterDataSync(characterId)?.rarity
    const expCaps = typeof rarity === "number" ? characterExpCaps[rarity] : undefined
    const level100Exp = expCaps?.[expCaps.length - 1]
    const reachedLevel100 = level100Exp !== undefined && character.exp >= level100Exp
    const receivedBondToken = character.bondTokenList.some(token => token.status >= BOND_TOKEN_RECEIVED)
    return (reachedLevel100 ? 1 : 0) + (receivedBondToken ? 1 : 0)
}

/** The time limit only exists in the description text; a title without one can never be satisfied. */
function clearedWithinTimeLimit(ctx: DegreeContext, description: string): number {
    const match = /\d+/.exec(description)
    if (match === null) return 0
    const limitMs = unsignedSafeInteger(Number(match[0]) * MILLISECONDS_PER_SECOND, "degree clear time limit")
    const best = bestSingleClearTimeMs(ctx)
    return best !== undefined && best <= limitMs ? 1 : 0
}

function masterInteger(definition: DegreeDefinition, column: number, name: string): number | undefined {
    return optionalMasterInteger(definition.row[column], `degree mission ${definition.missionId} ${name}`)
}

function equipmentAwakenings(ctx: DegreeContext): number {
    let total = 0
    for (const piece of Object.values(ctx.equipment)) {
        total = safeAdd(total, Math.max(0, piece.level - AWAKENING_LEVEL), "degree equipment awakenings")
    }
    return total
}

function persistedMultiClears(ctx: DegreeContext): number {
    let total = 0
    for (const entry of ctx.flatQuestProgress) {
        total = safeAdd(total, entry.multiClearCount ?? 0, "degree persisted multi clears")
    }
    return total
}

function statisticProgress(definition: DegreeDefinition, ctx: DegreeContext): number | undefined {
    const statisticKind = masterInteger(definition, STATISTIC_KIND_COLUMN, "statistic kind")
    const kind = statisticKind === undefined ? undefined : STATISTIC_KIND_NAMES[statisticKind]
    if (kind === undefined) return undefined
    const mode = requestedBattleMode(definition.row)
    const current = readCounter(ctx, BATTLE_STAT_DIMENSION, { kind, mode })
    // Rows written before the mode qualifier existed carry no mode, and only "any" may claim them.
    const legacy = mode === "any" ? readCounter(ctx, BATTLE_STAT_DIMENSION, { kind }) : 0
    if (statisticKind === DASH_KIND && mode === "any") {
        return Math.max(ctx.player.totalDashes, current, legacy)
    }
    // The only kind stored in a different unit from the one the title asks about.
    if (statisticKind === FEVER_TIME_KIND) {
        return Math.floor(Math.max(current, legacy) / MILLISECONDS_PER_SECOND)
    }
    return Math.max(current, legacy)
}

/**
 * What this engine can recompute for one title from the context alone, or undefined when it cannot.
 * Undefined is a real answer: client-reported and persisted-only titles must keep stored progress.
 */
export function computeRecoverableProgress(
    definition: DegreeDefinition,
    ctx: DegreeContext,
): number | undefined {
    if (typeof definition !== "object" || definition === null) {
        throw new TypeError("degree compute needs a master definition")
    }
    const { conditionType, row, description, pattern } = definition
    const stats = ctx.degreeStats
    switch (conditionType) {
        case 0:
            return ctx.player.totalLoginDays
        case 1:
            return getRankDegree(ctx.player.rankPoint)
        case 3:
            return readCounter(ctx, "shop.treasure_mana_spent")
        case 4:
            return stats.companionCount
        case 5:
            return stats.maxCharacterLevel
        case 7:
            return stats.manaBoardCount
        case 8:
            return stats.bondTokenCount
        case 9:
            return stats.overLimitCount
        case 14:
            return countQuestClears(ctx, resolveQuestFilter(row, ctx.masterIndex), "single")
        case 15:
            return clearedWithinTimeLimit(ctx, description)
        case 16:
            // Stored rows, the battle counter row and the lifetime counter all describe the same
            // clears, so the largest wins; adding them would count one clear up to three times.
            return Math.max(persistedMultiClears(ctx), stats.multiClearCount,
                readCounter(ctx, "battle.clear", { mode: "multi" }))
        case 17:
            return Math.max(stats.multiHostClearCount,
                readCounter(ctx, "battle.multi_role_clear", { role: "host" }))
        case 19:
            return readCounter(ctx, "battle.multi_mvp")
        case 20:
            return readCounter(ctx, "battle.multi_rescue_clear")
        case 21:
            return stats.episodeClearCount
        case 22: {
            const chapter = masterInteger(definition, CHAPTER_COLUMN, "chapter")
            return chapter !== undefined && completedChapter(ctx, chapter) ? 1 : 0
        }
        case 23:
            return countQuestClears(ctx, resolveQuestFilter(row, ctx.masterIndex), requestedBattleMode(row))
        case 25:
            return maxHighScore(ctx)
        case 26: {
            if (pattern.startsWith(SUPPORTED_FAMILIES.singleSsCount)) return stats.singleSsCount
            const filter = resolveQuestFilter(row, ctx.masterIndex)
            // A title about specific quests asks whether one of them was cleared at SS, not how
            // many SS clears the player has in total.
            if (filter.exactQuestIds !== undefined && filter.exactQuestIds.size > 0) {
                return ctx.flatQuestProgress.some(entry => entry.finished
                    && entry.clearRank === SS_CLEAR_RANK
                    && matchesQuest(filter, entry.section, entry.questId)) ? 1 : 0
            }
            return maxClearRankCount(ctx, SS_CLEAR_RANK)
        }
        case 28:
            return statisticProgress(definition, ctx)
        case 30:
            return Math.max(ctx.player.maxComboAchieved, readCounter(ctx, "battle.max_combo"))
        case 31:
            return readCounter(ctx, "battle.max_skill_chain")
        case 34:
            return Math.max(equipmentAwakenings(ctx), readCounter(ctx, "equipment.awakening"))
        case 36:
            return Math.max(
                Object.values(ctx.equipment).filter(piece => piece.level >= LV5_EQUIPMENT_LEVEL).length,
                readCounter(ctx, "equipment.lv5_count"))
        case 37: {
            const itemId = masterInteger(definition, ITEM_COLUMN, "item id")
            return itemId === undefined ? undefined : ctx.items[String(itemId)] ?? 0
        }
        case 39:
            return ctx.player.totalStaminaUsed
        case 44: {
            const characterId = masterInteger(definition, CHARACTER_COLUMN, "character id")
            if (characterId === undefined) return 0
            return getCharacterFavorProgress(characterId, ctx.characters[String(characterId)])
        }
        case 45:
            return Math.max(ctx.treasureShopPurchaseCount, readCounter(ctx, "shop.treasure_purchase"))
        case 48: {
            const characterId = masterInteger(definition, CHARACTER_COLUMN, "character id")
            if (characterId === undefined) return ctx.completedSecondBoards.size
            return ctx.completedSecondBoards.has(characterId) ? 1 : 0
        }
        case 92:
            return readCounter(ctx, "battle.multi_newbie_rescue_clear")
        default:
            return undefined
    }
}

/** The brand travels down a prototype chain, so category and master index are checked as well. */
function assertDegreeContext(ctx: CategoryContext): DegreeContext {
    if (!isDegreeContext(ctx)) throw new TypeError("degree compute needs a branded degree context")
    if (ctx.category !== DEGREE_CATEGORY) {
        throw new RangeError(`degree context category must be ${DEGREE_CATEGORY}`)
    }
    if (typeof ctx.masterIndex?.getDefinition !== "function") {
        throw new TypeError("degree context must carry a built master index")
    }
    return ctx
}

export const DegreeComputerV2: MissionComputer = {
    name: "DegreeV2",

    buildContext(
        playerId: number,
        category: number,
        evaluationTime: Date = new Date(),
        missionIds?: readonly number[],
    ): CategoryContext {
        return buildDegreeContext(playerId, category, evaluationTime, missionIds)
    },

    compute(missionId: number, ctx: CategoryContext, dbProgress: number): number {
        positiveSafeInteger(missionId, "degree missionId")
        unsignedSafeInteger(dbProgress, "degree dbProgress")
        const context = assertDegreeContext(ctx)
        // Resolved through the context's own master index, so one round can never mix two masters.
        const definition = context.masterIndex.getDefinition(missionId)
        if (definition === undefined) return dbProgress
        const recoverable = computeRecoverableProgress(definition, context)
        if (recoverable === undefined) return dbProgress
        // Monotonic by construction: a recoverable value may raise stored progress, never lower it.
        return Math.max(dbProgress,
            unsignedSafeInteger(recoverable, `degree mission ${missionId} recoverable progress`))
    },
}
