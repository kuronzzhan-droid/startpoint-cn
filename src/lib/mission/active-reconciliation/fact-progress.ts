import type {
    ActiveMissionFactCharacter,
    ActiveMissionFactQuestProgress,
    ActiveMissionFactState,
} from "./types"
import {
    matchesActiveMissionQuestRange,
    parseCanonicalNonNegativeInteger,
} from "./quest-range"

const CHARACTER_EXP_CAPS: Readonly<Record<number, readonly number[]>> = Object.freeze({
    1: Object.freeze([11416, 15820, 21477, 28538, 37241, 49481, 66600, 91180, 125223, 170928, 216633, 262338, 308043]),
    2: Object.freeze([21477, 28538, 37241, 49481, 66600, 91180, 125223, 170928, 216633, 262338, 308043]),
    3: Object.freeze([37241, 49481, 66600, 91180, 125223, 170928, 216633, 262338, 308043]),
    4: Object.freeze([76272, 102829, 139190, 189995, 240800, 291605, 342410]),
    5: Object.freeze([153988, 210488, 266988, 323488, 379988]),
})

function nonNegativeSafe(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
        throw new TypeError(`Invalid Active Mission ${field}.`)
    }
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Unsafe Active Mission ${field}.`)
    return value
}

function positiveSafe(value: unknown, field: string): number {
    const result = nonNegativeSafe(value, field)
    if (result === 0) throw new RangeError(`Invalid Active Mission ${field}.`)
    return result
}

function safeAdd(left: number, right: number, field: string): number {
    const result = left + right
    if (!Number.isSafeInteger(result) || result < 0) {
        throw new RangeError(`Unsafe Active Mission ${field}.`)
    }
    return result
}

function battleKind(row: readonly unknown[]): number {
    const kind = parseCanonicalNonNegativeInteger(row[32], "battle kind")
    if (kind < 1 || kind > 3) throw new TypeError(`Unsupported Active Mission battle kind ${kind}.`)
    return kind
}

function questProgressEntry(entry: ActiveMissionFactQuestProgress): ActiveMissionFactQuestProgress {
    nonNegativeSafe(entry.category, "quest category")
    positiveSafe(entry.questId, "quest id")
    if (typeof entry.finished !== "boolean") throw new TypeError("Invalid Active Mission quest finished flag.")
    nonNegativeSafe(entry.multiClearCount, "quest multi clear count")
    if (entry.clearRank !== undefined) nonNegativeSafe(entry.clearRank, "quest clear rank")
    if (entry.leaderCharacterId !== undefined) positiveSafe(entry.leaderCharacterId, "leader character id")
    return entry
}

function countBattleClears(row: readonly unknown[], state: ActiveMissionFactState): number {
    const kind = battleKind(row)
    let result = 0
    for (const raw of state.questProgress) {
        const progress = questProgressEntry(raw)
        if (!matchesActiveMissionQuestRange(row, progress.category, progress.questId)) continue
        const contribution = kind === 1
            ? (progress.finished ? 1 : 0)
            : kind === 2
                ? progress.multiClearCount
                : Math.max(progress.finished ? 1 : 0, progress.multiClearCount)
        result = safeAdd(result, contribution, "battle clear count")
    }
    return result
}

function countSsRanks(row: readonly unknown[], state: ActiveMissionFactState): number | null {
    const kind = battleKind(row)
    if (row[34] !== undefined && row[34] !== null && row[34] !== "(None)") return null
    const single = nonNegativeSafe(state.battleCounters.singleRankSsCount, "single SS count")
    const all = nonNegativeSafe(state.battleCounters.rankSsCount, "SS count")
    if (single > all) throw new RangeError("Invalid Active Mission SS counters.")
    return kind === 1 ? single : kind === 2 ? all - single : all
}

function normalizeQuestId(category: number, questId: number): number {
    const normalized = category === 4 && questId < 10_000_000 ? questId + 10_000_000 : questId
    return positiveSafe(normalized, "normalized quest id")
}

function chapterComplete(row: readonly unknown[], state: ActiveMissionFactState): number | null {
    const rangeKind = parseCanonicalNonNegativeInteger(row[34], "quest range kind")
    const category = rangeKind === 0 ? 1 : rangeKind === 1 ? 4 : null
    if (category === null) return null
    const source = state.chapterQuestIds[String(category)] ?? []
    const targets = source.map(id => positiveSafe(id, "chapter quest id"))
        .filter(id => matchesActiveMissionQuestRange(row, category, id))
    if (targets.length === 0) return null
    const ranks = new Map<number, number | undefined>()
    for (const raw of state.questProgress) {
        const progress = questProgressEntry(raw)
        if (progress.category === category) {
            ranks.set(normalizeQuestId(category, progress.questId), progress.clearRank)
        }
    }
    return targets.every(id => ranks.get(id) === 5) ? 1 : 0
}

function specificPartyClear(row: readonly unknown[], state: ActiveMissionFactState): number | null {
    const characterId = parseCanonicalNonNegativeInteger(row[46], "specific leader character id")
    if (characterId === 0) throw new RangeError("Invalid Active Mission specific leader character id.")
    const kind = battleKind(row)
    const ranged = row[34] !== undefined && row[34] !== null && row[34] !== "(None)"
    if (!ranged) {
        const clears = state.leaderClearCounts[String(characterId)] ?? { all: 0, multi: 0 }
        const all = nonNegativeSafe(clears.all, "leader clear count")
        const multi = nonNegativeSafe(clears.multi, "leader multi clear count")
        if (multi > all) throw new RangeError("Invalid Active Mission leader clear counters.")
        return kind === 1 ? all - multi : kind === 2 ? multi : all
    }
    if (kind !== 1) return null
    let result = 0
    for (const raw of state.questProgress) {
        const progress = questProgressEntry(raw)
        if (progress.finished
            && progress.leaderCharacterId === characterId
            && matchesActiveMissionQuestRange(row, progress.category, progress.questId)) {
            result = safeAdd(result, 1, "specific party clear count")
        }
    }
    return result
}

function characterEntries(state: ActiveMissionFactState): readonly [string, ActiveMissionFactCharacter][] {
    return Object.entries(state.characters).map(([id, character]) => {
        const parsed = parseCanonicalNonNegativeInteger(id, "character id")
        if (parsed === 0) throw new RangeError("Invalid Active Mission character id.")
        return [id, character] as const
    })
}

export function estimateActiveMissionCharacterLevel(character: ActiveMissionFactCharacter): number {
    const exp = nonNegativeSafe(character.exp, "character exp")
    const rarity = character.rarity
    if (rarity === undefined) return 0
    const validRarity = positiveSafe(rarity, "character rarity")
    const caps = CHARACTER_EXP_CAPS[validRarity]
    if (!caps) return 0
    const baseLevel = 40 + (validRarity - 1) * 10
    let level = baseLevel - 1
    caps.forEach((cap, index) => {
        if (exp >= cap) level = baseLevel + index * 5
    })
    return level
}

function sumCharacters(
    entries: readonly [string, ActiveMissionFactCharacter][],
    value: (character: ActiveMissionFactCharacter) => number,
    field: string,
): number {
    return entries.reduce((total, [, character]) => safeAdd(total, value(character), field), 0)
}

function directCounter(value: unknown, field: string): number {
    return nonNegativeSafe(value, field)
}

export function computeActiveMissionFactProgress(
    pattern: number,
    row: readonly unknown[],
    state: ActiveMissionFactState,
    missionId?: number,
): number | null {
    const validPattern = nonNegativeSafe(pattern, "pattern")
    const characters = characterEntries(state)
    switch (validPattern) {
        case 0: return directCounter(state.player.totalLoginDays, "total login days")
        case 39: return directCounter(state.player.totalStaminaUsed, "used stamina count")
        case 14: return directCounter(state.battleCounters.singleClearCount, "single clear count")
        case 16: return directCounter(state.battleCounters.multiClearCount, "multi clear count")
        case 17: return directCounter(state.battleCounters.multiHostClearCount, "multi host clear count")
        case 23: return countBattleClears(row, state)
        case 26: return countSsRanks(row, state)
        case 66: return chapterComplete(row, state)
        case 65: return row[34] === "11" ? directCounter(state.practiceQuestChallengeCount, "practice count") : null
        case 70: return specificPartyClear(row, state)
        case 71:
        case 72:
        case 73: {
            const characterId = parseCanonicalNonNegativeInteger(row[43], "conditional battle character id")
            if (characterId === 0) throw new RangeError("Invalid Active Mission conditional battle character id.")
            return directCounter(state.conditionalBattleFacts[`${validPattern}:${characterId}`] ?? 0, "conditional battle count")
        }
        case 89:
            return missionId === undefined
                ? null
                : directCounter(state.loadoutBattleFacts[String(positiveSafe(missionId, "mission id"))] ?? 0, "loadout battle count")
        case 21: {
            const storyIds = new Set(characters.flatMap(([id]) => state.characterStoryQuestIds[id] ?? []))
            let total = 0
            for (const id of storyIds) {
                const questId = positiveSafe(id, "character story quest id")
                if (state.finishedQuestIds.has(questId)) total = safeAdd(total, 1, "episode clear count")
            }
            return total
        }
        case 5: return characters.reduce((max, [, character]) => Math.max(max, estimateActiveMissionCharacterLevel(character)), 0)
        case 4: {
            const target = row[43]
            if (target === undefined || target === null || target === "(None)") return characters.length
            const characterId = parseCanonicalNonNegativeInteger(target, "target character id")
            if (characterId === 0) throw new RangeError("Invalid Active Mission target character id.")
            return state.characters[String(characterId)] === undefined ? 0 : 1
        }
        case 61: return characters.filter(([, character]) => nonNegativeSafe(character.evolutionLevel, "evolution level") > 0).length
        case 36: return state.equipment.filter(item => (
            positiveSafe(item.level, "equipment level") >= positiveSafe(item.maxLevel, "equipment max level")
        )).length
        case 34: return state.equipment.reduce((total, item) => {
            const level = positiveSafe(item.level, "equipment level")
            positiveSafe(item.maxLevel, "equipment max level")
            if (item.enhancementLevel !== undefined) nonNegativeSafe(item.enhancementLevel, "equipment enhancement level")
            return safeAdd(total, level - 1, "equipment upgrade count")
        }, 0)
        case 35: return directCounter(state.partyAbilitySoulCount, "party ability soul count")
        case 45: return directCounter(state.treasureShopPurchaseCount, "treasure purchase count")
        case 64: return directCounter(state.bossCoinEquipmentShopPurchaseCount, "boss coin equipment count")
        case 84: return directCounter(state.bossCoinShopPurchaseCount, "boss coin purchase count")
        case 9: return sumCharacters(characters, character => nonNegativeSafe(character.overLimitStep, "over limit step"), "over limit count")
        case 8: return sumCharacters(characters, character => character.bondTokenList.reduce((total, token) => {
            const status = nonNegativeSafe(token.status, "bond token status")
            return safeAdd(total, status >= 1 ? 1 : 0, "bond token count")
        }, 0), "bond token count")
        case 7: return Object.values(state.manaNodes).reduce((total, nodes) => nodes.reduce((inner, id) => {
            positiveSafe(id, "mana node id")
            return safeAdd(inner, 1, "released mana node count")
        }, total), 0)
        case 62: return Object.entries(state.manaNodes).reduce((total, [characterId, nodes]) => {
            const slots = state.manaNodeSlots[characterId] ?? {}
            const count = nodes.filter(id => {
                const nodeId = positiveSafe(id, "mana node id")
                const slot = slots[String(nodeId)]
                return slot !== undefined && nonNegativeSafe(slot, "mana node slot") >= 1 && slot <= 3
            }).length
            return safeAdd(total, count, "released ability node count")
        }, 0)
        case 48: return Object.entries(state.manaBoardNodes).filter(([characterId, boards]) => {
            const nodes = boards["2"] ?? []
            const unlocked = new Set((state.manaNodes[characterId] ?? []).map(id => positiveSafe(id, "mana node id")))
            return nodes.length > 0 && nodes.every(id => unlocked.has(positiveSafe(id, "mana board node id")))
        }).length
        case 46: return directCounter(state.totalUsedManaCount, "used mana count")
        case 78: return directCounter(state.totalGachaCharacterCount, "gacha character count")
        case 58: return directCounter(state.totalEquipmentEquipCount, "equipment equip count")
        case 59: return directCounter(state.totalUnisonSetCount, "unison set count")
        case 60: return directCounter(state.totalPartyCharacterSetCount, "party character set count")
        case 63: return directCounter(state.totalInjectedExpCount, "injected exp count")
        case 83: return directCounter(state.totalGachaCampaignCount, "gacha campaign count")
        default: return null
    }
}
