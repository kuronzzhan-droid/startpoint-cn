export interface PartyCoClearRow {
    readonly char_id_a: number
    readonly char_id_b: number
    readonly co_clear_count: number
}

export interface AwakeBattleRuleContext {
    readonly questCategory: number
    readonly questId: number
    readonly questAccomplished: boolean
    readonly isMulti?: boolean
    readonly clearTime?: number
    readonly party: {
        readonly characters: readonly ({ readonly id?: number | null } | null)[]
        readonly unison_characters: readonly ({ readonly id?: number | null } | null)[]
        readonly leader?: { readonly id?: number | null } | null
        readonly leader_character_id?: number | null
        readonly leader_id?: number | null
    }
    readonly statistics?: unknown
}

interface ParsedBattleContext {
    readonly questCategory: number
    readonly questId: number
    readonly isMulti: boolean
    readonly clearTime: unknown
    readonly characterIds: ReadonlySet<number>
    readonly leaderId: number | undefined
    readonly statistics: unknown
}

interface QuestPartyRule {
    readonly missionId: number
    readonly questCategory?: number
    readonly questId?: number
    readonly requiredCharacterIds: readonly number[]
    readonly leaderId?: number
    readonly singleOnly?: boolean
    readonly maxClearTime?: number
}

interface RangeRule {
    readonly missionId: number
    readonly questCategories: readonly number[]
    readonly questIds?: readonly number[]
    readonly requiredCharacterId: number
}

export const AWAKE_DIRECT_BATTLE_MISSION_IDS: readonly number[] = Object.freeze([
    1510062, 1610022, 2310012, 2310013, 2610072,
    3210132, 3210133, 3310032, 3310033, 3410012, 3410013,
])
const directBattleMissionIdSet = new Set(AWAKE_DIRECT_BATTLE_MISSION_IDS)

const questPartyRules: readonly QuestPartyRule[] = Object.freeze([
    Object.freeze({
        missionId: 2310013,
        questCategory: 21,
        questId: 1006,
        requiredCharacterIds: Object.freeze([231001]),
        leaderId: 231001,
        maxClearTime: 90000,
    }),
    Object.freeze({
        missionId: 2310013,
        questCategory: 2,
        questId: 1010004,
        requiredCharacterIds: Object.freeze([231001]),
        leaderId: 231001,
        maxClearTime: 90000,
    }),
    Object.freeze({
        missionId: 1510062,
        requiredCharacterIds: Object.freeze([151006, 263002]),
        leaderId: 151006,
    }),
    Object.freeze({
        missionId: 3310032,
        questCategory: 15,
        questId: 5,
        requiredCharacterIds: Object.freeze([331003, 1]),
        singleOnly: true,
    }),
    Object.freeze({
        missionId: 3310033,
        questCategory: 2,
        questId: 1010004,
        requiredCharacterIds: Object.freeze([331003, 10]),
        singleOnly: true,
    }),
])

const rangeRules: readonly RangeRule[] = Object.freeze([
    Object.freeze({
        missionId: 3210132,
        questCategories: Object.freeze([6, 13, 14, 20]),
        requiredCharacterId: 321013,
    }),
    Object.freeze({
        missionId: 3210133,
        questCategories: Object.freeze([13]),
        questIds: Object.freeze([2001, 2002, 2003, 2004, 2005, 2006]),
        requiredCharacterId: 321013,
    }),
    Object.freeze({
        missionId: 3410012,
        questCategories: Object.freeze([6, 13, 14, 20]),
        requiredCharacterId: 341001,
    }),
    Object.freeze({
        missionId: 3410013,
        questCategories: Object.freeze([13]),
        questIds: Object.freeze([1040]),
        requiredCharacterId: 341001,
    }),
])

const requiredRaceNames = Object.freeze(["Devil", "Dragon", "Human"])
const noDeathRules = Object.freeze([
    Object.freeze({ missionId: 1610022, leaderId: 161002 }),
    Object.freeze({ missionId: 2610072, leaderId: 261007 }),
])

function assertPositiveSafeId(value: unknown, label: string): asserts value is number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(label)
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(label)
}

function assertNonNegativeSafeCount(value: unknown, label: string): asserts value is number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(label)
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(label)
}

function isPositiveSafeId(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key)
}

export function normalizeCharacterPair(a: number, b: number): readonly [number, number] {
    assertPositiveSafeId(a, "character ID")
    assertPositiveSafeId(b, "character ID")
    if (a === b) throw new RangeError("character pair")
    return a < b ? [a, b] : [b, a]
}

export function getCharacterPairKey(a: number, b: number): string {
    const [first, second] = normalizeCharacterPair(a, b)
    return `${first}_${second}`
}

export function mergePartyCoClearRows(rows: readonly PartyCoClearRow[]): Map<string, number> {
    if (!Array.isArray(rows)) throw new TypeError("co-clear rows")
    const merged = new Map<string, number>()
    for (let index = 0; index < rows.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(rows, index)) throw new TypeError("co-clear row")
        const row: unknown = rows[index]
        if (!isRecord(row)) throw new TypeError("co-clear row")
        const key = getCharacterPairKey(row.char_id_a as number, row.char_id_b as number)
        assertNonNegativeSafeCount(row.co_clear_count, "co-clear count")
        const previous = merged.get(key) ?? 0
        if (previous > Number.MAX_SAFE_INTEGER - row.co_clear_count) {
            throw new RangeError("co-clear count sum")
        }
        merged.set(key, previous + row.co_clear_count)
    }
    return merged
}

function parsePartyCharacterIds(value: unknown): Set<number> | undefined {
    if (!Array.isArray(value)) return undefined
    const ids = new Set<number>()
    for (let index = 0; index < value.length; index += 1) {
        const slot: unknown = value[index]
        if (slot === null || slot === undefined) continue
        if (!isRecord(slot)) return undefined
        const id = slot.id
        if (id === null || id === undefined) continue
        if (!isPositiveSafeId(id)) return undefined
        ids.add(id)
    }
    return ids
}

function leaderCandidate(value: unknown): number | undefined | null {
    if (value === null || value === undefined) return undefined
    return isPositiveSafeId(value) ? value : null
}

function parseBattleContext(ctx: unknown): ParsedBattleContext | undefined {
    if (!isRecord(ctx)) return undefined
    if (!isPositiveSafeId(ctx.questCategory) || !isPositiveSafeId(ctx.questId)) return undefined
    if (ctx.questAccomplished !== true) return undefined
    if (ctx.isMulti !== undefined && typeof ctx.isMulti !== "boolean") return undefined
    if (!isRecord(ctx.party)) return undefined

    const mainIds = parsePartyCharacterIds(ctx.party.characters)
    const unisonIds = parsePartyCharacterIds(ctx.party.unison_characters)
    if (!mainIds || !unisonIds) return undefined
    const characterIds = new Set([...mainIds, ...unisonIds])

    const candidates: number[] = []
    const mainCharacters = ctx.party.characters as readonly unknown[]
    const slotZero = mainCharacters[0]
    if (isRecord(slotZero)) {
        const candidate = leaderCandidate(slotZero.id)
        if (candidate === null) return undefined
        if (candidate !== undefined) candidates.push(candidate)
    }

    const explicitLeader = ctx.party.leader
    if (explicitLeader !== null && explicitLeader !== undefined) {
        if (!isRecord(explicitLeader)) return undefined
        const candidate = leaderCandidate(explicitLeader.id)
        if (candidate === null) return undefined
        if (candidate !== undefined) candidates.push(candidate)
    }
    for (const value of [ctx.party.leader_character_id, ctx.party.leader_id]) {
        const candidate = leaderCandidate(value)
        if (candidate === null) return undefined
        if (candidate !== undefined) candidates.push(candidate)
    }
    if (candidates.some(candidate => candidate !== candidates[0])) return undefined

    return {
        questCategory: ctx.questCategory,
        questId: ctx.questId,
        isMulti: ctx.isMulti ?? false,
        clearTime: ctx.clearTime,
        characterIds,
        leaderId: candidates[0],
        statistics: ctx.statistics,
    }
}

function matchesQuestPartyRule(ctx: ParsedBattleContext, rule: QuestPartyRule): boolean {
    if (rule.questCategory !== undefined && ctx.questCategory !== rule.questCategory) return false
    if (rule.questId !== undefined && ctx.questId !== rule.questId) return false
    if (rule.singleOnly && ctx.isMulti) return false
    if (rule.leaderId !== undefined && ctx.leaderId !== rule.leaderId) return false
    if (!rule.requiredCharacterIds.every(id => ctx.characterIds.has(id))) return false
    if (rule.maxClearTime !== undefined) {
        if (typeof ctx.clearTime !== "number" || !Number.isSafeInteger(ctx.clearTime)) return false
        if (ctx.clearTime < 0 || ctx.clearTime > rule.maxClearTime) return false
    }
    return true
}

function matchQuestAndRangeRules(ctx: ParsedBattleContext): number[] {
    const missionIds = new Set<number>()
    for (const rule of questPartyRules) {
        if (matchesQuestPartyRule(ctx, rule)) missionIds.add(rule.missionId)
    }
    if (!ctx.isMulti) {
        for (const rule of rangeRules) {
            if (!rule.questCategories.includes(ctx.questCategory)) continue
            if (rule.questIds !== undefined && !rule.questIds.includes(ctx.questId)) continue
            if (ctx.characterIds.has(rule.requiredCharacterId)) missionIds.add(rule.missionId)
        }
    }
    return [...missionIds].sort((a, b) => a - b)
}

function canonicalRaceSet(raceKey: unknown): Set<string> | undefined {
    if (typeof raceKey !== "string") return undefined
    if (raceKey === "") return new Set()
    const names = raceKey.split("+")
    const races = new Set<string>()
    let previous: string | undefined
    for (const name of names) {
        if (name === "" || name.trim() !== name) return undefined
        if (previous !== undefined && previous >= name) return undefined
        races.add(name)
        previous = name
    }
    return races.size === names.length ? races : undefined
}

function matchRaceRule(ctx: ParsedBattleContext, raceKey: unknown): number[] {
    const races = canonicalRaceSet(raceKey)
    if (!races || ctx.leaderId !== 231001) return []
    return requiredRaceNames.every(name => races.has(name)) ? [2310012] : []
}

function firstZoneCandidate(statistics: unknown): unknown {
    if (!isRecord(statistics)) return undefined
    if (hasOwn(statistics, "zones")) return statistics.zones
    if (statistics.quest_statistics !== undefined) {
        if (!isRecord(statistics.quest_statistics)) return null
        if (hasOwn(statistics.quest_statistics, "zones")) return statistics.quest_statistics.zones
    }
    if (statistics.battle !== undefined) {
        if (!isRecord(statistics.battle)) return null
        if (hasOwn(statistics.battle, "zones")) return statistics.battle.zones
    }
    if (hasOwn(statistics, "zone_statistics")) return statistics.zone_statistics
    return undefined
}

function isNoDeathBattle(statistics: unknown): boolean {
    const zones = firstZoneCandidate(statistics)
    if (!Array.isArray(zones) || zones.length === 0) return false
    let total = 0
    for (const zone of zones) {
        if (!isRecord(zone)) return false
        const count = Object.prototype.hasOwnProperty.call(zone, "encoffin_count")
            ? zone.encoffin_count
            : 0
        if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return false
        if (total > Number.MAX_SAFE_INTEGER - count) return false
        total += count
    }
    return total === 0
}

function matchNoDeathRules(ctx: ParsedBattleContext): number[] {
    if (!isNoDeathBattle(ctx.statistics)) return []
    return noDeathRules
        .filter(rule => rule.leaderId === ctx.leaderId)
        .map(rule => rule.missionId)
}

export function getMatchedAwakeQuestPartyMissionIds(ctx: AwakeBattleRuleContext): number[] {
    const parsed = parseBattleContext(ctx)
    return parsed ? matchQuestAndRangeRules(parsed) : []
}

export function getMatchedAwakeRaceMissionIds(
    ctx: AwakeBattleRuleContext,
    raceKey: string,
): number[] {
    const parsed = parseBattleContext(ctx)
    return parsed ? matchRaceRule(parsed, raceKey) : []
}

export function getMatchedAwakeDirectBattleMissionIds(
    ctx: AwakeBattleRuleContext,
    raceKey: string,
): number[] {
    const parsed = parseBattleContext(ctx)
    if (!parsed) return []
    const missionIds = new Set([
        ...matchQuestAndRangeRules(parsed),
        ...matchRaceRule(parsed, raceKey),
        ...matchNoDeathRules(parsed),
    ])
    return [...missionIds]
        .filter(missionId => directBattleMissionIdSet.has(missionId))
        .sort((a, b) => a - b)
}

export function isBondTokenMissionComplete(
    bondTokens: readonly { readonly status: number }[] | undefined,
): boolean {
    if (!Array.isArray(bondTokens) || bondTokens.length === 0) return false
    for (let index = 0; index < bondTokens.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(bondTokens, index)) return false
        const token: unknown = bondTokens[index]
        if (!isRecord(token)) return false
        const status = token.status
        if (typeof status !== "number" || !Number.isSafeInteger(status) || status < 2) return false
    }
    return true
}
