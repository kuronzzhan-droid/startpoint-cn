import { getRaceKeyString } from "../quest/finish/race-utils"

export interface PartyCoClearRow {
    char_id_a: number
    char_id_b: number
    co_clear_count: number
}

interface QuestPartyRule {
    missionId: number
    category?: number
    questIds?: readonly number[]
    requiredCharacterIds: readonly number[]
    singleOnly: boolean
    leaderCharacterId?: number
    maxClearTimeMs?: number
}

interface QuestPartyFactContext {
    questCategory: number
    questId: number
    isMulti?: boolean
    party: {
        characters: readonly ({ id?: number | null } | null)[]
        unison_characters: readonly ({ id?: number | null } | null)[]
        leader?: { id?: number | null } | null
        leader_character_id?: number | null
        leader_id?: number | null
    }
    statistics?: unknown
    questAccomplished?: boolean
    clearTime?: number
}

interface QuestRangeRule {
    missionId: number
    categories: readonly number[]
    questIds?: readonly number[]
    requiredCharacterId: number
    singleOnly: boolean
}

interface NoDeathRule {
    missionId: number
    leaderCharacterId: number
}

const QUEST_PARTY_RULES: readonly QuestPartyRule[] = Object.freeze([
    {
        // Current CN client route for 寄居蟹船长 地狱级.
        missionId: 2310013,
        category: 21,
        questIds: [1006],
        requiredCharacterIds: [231001],
        singleOnly: false,
        leaderCharacterId: 231001,
        maxClearTimeMs: 90000,
    },
    {
        // Legacy/private-server route retained for old clients and saves.
        missionId: 2310013,
        category: 2,
        questIds: [1010004],
        requiredCharacterIds: [231001],
        singleOnly: false,
        leaderCharacterId: 231001,
        maxClearTimeMs: 90000,
    },
    {
        missionId: 1510062,
        requiredCharacterIds: [151006, 263002],
        singleOnly: false,
        leaderCharacterId: 151006,
    },
    {
        missionId: 3310032,
        category: 15,
        questIds: [5],
        requiredCharacterIds: [331003, 1],
        singleOnly: true,
    },
    {
        missionId: 3310033,
        category: 2,
        questIds: [1010004],
        requiredCharacterIds: [331003, 10],
        singleOnly: true,
    },
])

const QUEST_RANGE_RULES: readonly QuestRangeRule[] = Object.freeze([
    {
        missionId: 3210132,
        categories: [6, 13, 14, 20],
        requiredCharacterId: 321013,
        singleOnly: true,
    },
    {
        missionId: 3210133,
        categories: [13],
        questIds: [2001, 2002, 2003, 2004, 2005, 2006],
        requiredCharacterId: 321013,
        singleOnly: true,
    },
    {
        missionId: 3410012,
        categories: [6, 13, 14, 20],
        requiredCharacterId: 341001,
        singleOnly: true,
    },
    {
        missionId: 3410013,
        categories: [13],
        questIds: [1040],
        requiredCharacterId: 341001,
        singleOnly: true,
    },
])

const NO_DEATH_RULES: readonly NoDeathRule[] = Object.freeze([
    { missionId: 1610022, leaderCharacterId: 161002 },
    { missionId: 2610072, leaderCharacterId: 261007 },
])

export const AWAKE_QUEST_PARTY_MISSION_IDS = new Set(
    QUEST_PARTY_RULES.map(rule => rule.missionId),
)

export const AWAKE_RACE_MISSION_KEYS = new Map<number, string>([
    [2310012, getRaceKeyString(["Human", "Dragon", "Devil"])],
])

export const AWAKE_DIRECT_BATTLE_MISSION_IDS = new Set([
    ...AWAKE_QUEST_PARTY_MISSION_IDS,
    ...AWAKE_RACE_MISSION_KEYS.keys(),
    ...QUEST_RANGE_RULES.map(rule => rule.missionId),
    ...NO_DEATH_RULES.map(rule => rule.missionId),
])

export function normalizeCharacterPair(a: number, b: number): readonly [number, number] {
    return a <= b ? [a, b] : [b, a]
}

export function getCharacterPairKey(a: number, b: number): string {
    const [first, second] = normalizeCharacterPair(a, b)
    return `${first}_${second}`
}

export function mergePartyCoClearRows(rows: readonly PartyCoClearRow[]): Map<string, number> {
    const result = new Map<string, number>()
    for (const row of rows) {
        const key = getCharacterPairKey(row.char_id_a, row.char_id_b)
        result.set(key, (result.get(key) ?? 0) + row.co_clear_count)
    }
    return result
}

export function getMatchedAwakeQuestPartyMissionIds(
    ctx: QuestPartyFactContext,
): number[] {
    const partyCharacterIds = new Set<number>()
    for (const character of [...ctx.party.characters, ...ctx.party.unison_characters]) {
        if (character?.id) partyCharacterIds.add(character.id)
    }

    return QUEST_PARTY_RULES
        .filter(rule => rule.category === undefined || rule.category === ctx.questCategory)
        .filter(rule => rule.questIds === undefined || rule.questIds.includes(ctx.questId))
        .filter(rule => !rule.singleOnly || !ctx.isMulti)
        .filter(rule => rule.leaderCharacterId === undefined
            || ctx.party.characters[0]?.id === rule.leaderCharacterId)
        .filter(rule => rule.maxClearTimeMs === undefined
            || (ctx.questAccomplished !== false
                && Number.isFinite(ctx.clearTime)
                && (ctx.clearTime as number) <= rule.maxClearTimeMs))
        .filter(rule => rule.requiredCharacterIds.every(id => partyCharacterIds.has(id)))
        .map(rule => rule.missionId)
}

export function getMatchedAwakeDirectBattleMissionIds(
    ctx: QuestPartyFactContext,
    raceKey: string,
): number[] {
    const matched = [
        ...getMatchedAwakeRaceMissionIds(ctx, raceKey),
        ...getMatchedAwakeQuestPartyMissionIds(ctx),
    ]
    const partyCharacterIds = new Set<number>()
    for (const character of [...ctx.party.characters, ...ctx.party.unison_characters]) {
        if (character?.id) partyCharacterIds.add(character.id)
    }

    for (const rule of QUEST_RANGE_RULES) {
        if (!rule.categories.includes(ctx.questCategory)) continue
        if (rule.questIds && !rule.questIds.includes(ctx.questId)) continue
        if (rule.singleOnly && ctx.isMulti === true) continue
        if (partyCharacterIds.has(rule.requiredCharacterId)) matched.push(rule.missionId)
    }

    const totalEncoffinCount = getTotalEncoffinCount(ctx.statistics)
    if (totalEncoffinCount === 0) {
        const leaderId = getPartyLeaderCharacterId(ctx.party)
        for (const rule of NO_DEATH_RULES) {
            if (leaderId === rule.leaderCharacterId) matched.push(rule.missionId)
        }
    }

    return [...new Set(matched)]
}

/** Accept the payload locations used by old and new clients. */
function getBattleZones(statistics: unknown): unknown {
    if (!statistics || typeof statistics !== "object") return undefined
    const value = statistics as Record<string, unknown>
    for (const candidate of [
        value.zones,
        (value.quest_statistics as Record<string, unknown> | undefined)?.zones,
        (value.battle as Record<string, unknown> | undefined)?.zones,
        value.zone_statistics,
    ]) {
        if (Array.isArray(candidate)) return candidate
    }
    return undefined
}

function getTotalEncoffinCount(statistics: unknown): number | undefined {
    const zones = getBattleZones(statistics)
    if (!Array.isArray(zones) || zones.length === 0) return undefined

    let total = 0
    for (const zone of zones) {
        if (zone === null || typeof zone !== "object") return undefined
        const record = zone as Record<string, unknown>
        // CN 1.8.1 can omit zero-valued statistics from a zone. An omitted
        // encoffin_count therefore means zero, but an explicitly malformed
        // value must still fail closed.
        if (!Object.prototype.hasOwnProperty.call(record, "encoffin_count")) continue
        const encoffinCount = record.encoffin_count
        if (!Number.isSafeInteger(encoffinCount) || (encoffinCount as number) < 0) {
            return undefined
        }
        total += encoffinCount as number
    }
    return total
}

/**
 * Some client builds include an explicit leader field while others only send
 * the ordered main-character array. Prefer the explicit value when available,
 * then retain compatibility with the original array representation.
 */
function getPartyLeaderCharacterId(
    party: QuestPartyFactContext["party"],
): number | undefined {
    for (const value of [
        party.leader?.id,
        party.leader_character_id,
        party.leader_id,
        party.characters[0]?.id,
    ]) {
        if (Number.isSafeInteger(value) && (value as number) > 0) return value as number
    }
    return undefined
}

export function getMatchedAwakeRaceMissionIds(
    ctx: QuestPartyFactContext,
    raceKey: string,
): number[] {
    const leaderId = ctx.party.characters[0]?.id
    if (leaderId !== 231001) return []
    const actualRaces = new Set(raceKey.split("+").filter(Boolean))
    const requiredRaces = (AWAKE_RACE_MISSION_KEYS.get(2310012) ?? "")
        .split("+")
        .filter(Boolean)
    return requiredRaces.every(race => actualRaces.has(race)) ? [2310012] : []
}

export function isBondTokenMissionComplete(
    bondTokens: readonly { status: number }[] | undefined,
): boolean {
    return bondTokens !== undefined
        && bondTokens.length > 0
        && bondTokens.every(bondToken => bondToken.status >= 2)
}
