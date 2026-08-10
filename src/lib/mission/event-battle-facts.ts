import adventQuests from "../../../assets/advent_event_quest.json"
import bossQuests from "../../../assets/boss_battle_quest.json"
import eventMissions from "../../../assets/mission_event.json"
import eventRules from "../../../assets/mission_event_battle_rules.json"
import worldStoryQuests from "../../../assets/world_story_event_boss_battle_quest.json"
import { getDb } from "../../data/db"
import { incrementPlayerCategoryMissionSync } from "../../data/domains/category_mission"
import type { FinishContext } from "../quest/finish/types"

type Role = "any" | "host" | "guest"
type Values = "all" | ReadonlySet<number>
interface Query { readonly kind: "All" | "Within"; readonly values?: readonly number[] }
interface ExactMultiRule {
    readonly missionId: number
    readonly patternType: 16 | 17 | 18
    readonly role: Role
    readonly categories: Values
    readonly selector: { readonly range: "All" | "BossBattle" | "AdventEvent" | "WorldStoryEventBossBattle"; readonly keys: readonly Query[] }
    readonly questIds: Values
}
interface Master { readonly pattern: string; readonly start: number; readonly end: number; readonly row: readonly unknown[] }

const CATEGORY = 3
const DELTA = 1
const DIGEST = "48d50f7930c5992699eb5aa687299e2f6c7800725acf3136a39d806c840213b1"
const RANGE_ROW = { BossBattle: "2", AdventEvent: "5", WorldStoryEventBossBattle: "10" } as const

function record(value: unknown, name: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) {
        throw new TypeError(`${name} must be a plain record`)
    }
    return value as Record<string, unknown>
}

function fields(value: unknown, name: string, expected?: readonly string[]): Record<string, unknown> {
    const output = record(value, name)
    const names = Object.getOwnPropertyNames(output)
    if (expected && (names.length !== expected.length || names.some((key, index) => key !== expected[index]))) {
        throw new TypeError(`${name} has unexpected fields`)
    }
    const result: Record<string, unknown> = {}
    for (const key of names) {
        const descriptor = Object.getOwnPropertyDescriptor(output, key)
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError(`${name} has an accessor`)
        result[key] = descriptor.value
    }
    return result
}

function dense(value: unknown, name: string): unknown[] {
    if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length) throw new TypeError(`${name} must be a dense array`)
    const length = Object.getOwnPropertyDescriptor(value, "length")
    if (!length || !("value" in length) || !Number.isSafeInteger(length.value) || length.value < 0) throw new TypeError(`${name} has invalid length`)
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== length.value + 1 || !names.includes("length")) throw new TypeError(`${name} must be dense`)
    const result: unknown[] = []
    for (let index = 0; index < length.value; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError(`${name} has an accessor`)
        result.push(descriptor.value)
    }
    return result
}

function positive(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`)
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be positive safe`)
    return value
}

function keyId(key: string, name: string): number {
    if (!/^[1-9]\d*$/.test(key)) throw new RangeError(`${name} must be canonical`)
    return positive(Number(key), name)
}

function cnTime(value: unknown, name: string): number
function cnTime(value: unknown, name: string, optional: true): number | undefined
function cnTime(value: unknown, name: string, optional = false): number | undefined {
    if (optional && value === "(None)") return undefined
    if (typeof value !== "string") throw new TypeError(`${name} must be a CN time`)
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value)
    if (!match) throw new RangeError(`${name} must be strict`)
    const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
    const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day
        || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second) throw new RangeError(`${name} is invalid`)
    return Date.UTC(year, month - 1, day, hour - 8, minute, second)
}

function masterPlan(value: unknown): ReadonlyMap<number, Master> {
    const rows = new Map<number, Master>()
    for (const [key, wrapper] of Object.entries(fields(value, "event master"))) {
        const id = keyId(key, "event mission key")
        if (rows.has(id)) throw new RangeError("event mission key collision")
        const outer = dense(wrapper, `event mission ${key}`)
        if (outer.length !== 1) throw new TypeError(`event mission ${key} must have one row`)
        const row = dense(outer[0], `event mission row ${key}`)
        if (row.length !== 35) throw new TypeError(`event mission row ${key} must have 35 fields`)
        if (typeof row[2] !== "string" || !/^\d+$/.test(row[2])) throw new TypeError(`event mission ${key} pattern is invalid`)
        const start = cnTime(row[25], `event mission ${key} start`)
        const end = cnTime(row[26], `event mission ${key} end`, true)
        if (end !== undefined && end < start) throw new RangeError(`event mission ${key} has invalid time range`)
        rows.set(id, { pattern: row[2], start, end: end ?? Number.POSITIVE_INFINITY, row })
    }
    if (rows.size !== 2512) throw new RangeError("event mission master count mismatch")
    return rows
}

function projection(value: unknown, name: string, count: number): ReadonlySet<number> {
    const result = new Set<number>()
    for (const key of Object.keys(fields(value, name))) {
        const id = keyId(key, `${name} key`)
        if (result.has(id)) throw new RangeError(`${name} key collision`)
        result.add(id)
    }
    if (result.size !== count) throw new RangeError(`${name} count mismatch`)
    return result
}

function values(value: unknown, name: string): Values {
    if (value === "all") return "all"
    const result = dense(value, name).map(entry => positive(entry, name))
    if (!result.length || result.some((entry, index) => index && entry <= result[index - 1])) throw new RangeError(`${name} must be sorted`)
    return new Set(result)
}

function selector(value: unknown): ExactMultiRule["selector"] {
    const source = fields(value, "rule selector", ["range", "keys"])
    if (source.range !== "All" && source.range !== "BossBattle" && source.range !== "AdventEvent" && source.range !== "WorldStoryEventBossBattle") {
        throw new TypeError("rule selector range is invalid")
    }
    const keys = dense(source.keys, "rule selector keys").map((entry, index) => {
        const query = fields(entry, `rule selector key ${index}`)
        if (query.kind === "All" && Object.keys(query).length === 1) return { kind: "All" as const }
        if (query.kind === "Within" && Object.keys(query).length === 2) {
            const list = dense(query.values, `rule selector key ${index} values`).map(item => positive(item, "selector value"))
            if (!list.length || list.some((item, i) => i && item <= list[i - 1])) throw new RangeError("selector values must be sorted")
            return { kind: "Within" as const, values: list }
        }
        throw new TypeError("rule selector key is invalid")
    })
    if ((source.range === "All") !== (keys.length === 0)) throw new RangeError("rule selector keys mismatch")
    return { range: source.range, keys }
}

function same(a: readonly number[], b: readonly number[]): boolean { return a.length === b.length && a.every((value, index) => value === b[index]) }

function compileRules(value: unknown): readonly ExactMultiRule[] {
    const root = fields(value, "event battle rules", ["schemaVersion", "rules"])
    if (typeof root.schemaVersion !== "number" || root.schemaVersion !== 1) throw new TypeError("rule schema version is invalid")
    const source = dense(root.rules, "event battle rules")
    if (!source.length) throw new RangeError("event battle rules are empty")
    const seen = new Set<number>()
    const output = source.map((entry, index): ExactMultiRule => {
        const rule = fields(entry, `event rule ${index}`, ["missionId", "patternType", "role", "categories", "selector", "questIds", "rank", "compatibility"])
        const missionId = positive(rule.missionId, "event rule missionId")
        if (seen.has(missionId)) throw new RangeError("event rule missionId is duplicated")
        seen.add(missionId)
        if (rule.patternType !== 16 && rule.patternType !== 17 && rule.patternType !== 18) throw new RangeError("event rule patternType is invalid")
        if (rule.role !== "any" && rule.role !== "host" && rule.role !== "guest") throw new TypeError("event rule role is invalid")
        if (rule.rank !== null || rule.compatibility !== null) throw new TypeError("event rule compatibility is invalid")
        return { missionId, patternType: rule.patternType, role: rule.role, categories: values(rule.categories, "rule categories"), selector: selector(rule.selector), questIds: values(rule.questIds, "rule questIds") }
    })
    return output.sort((left, right) => left.missionId - right.missionId)
}

const MASTERS = masterPlan(eventMissions)
const BOSSES = projection(bossQuests, "boss quest master", 232)
const ADVENTS = projection(adventQuests, "advent quest master", 459)
const WORLDS = projection(worldStoryQuests, "world story quest master", 96)

function setValues(value: Values): number[] { return value === "all" ? [] : [...value] }
function sameSet(left: Values, right: readonly number[]): boolean { return left !== "all" && same(setValues(left), right) }
function masterValues(value: unknown): number[] {
    if (typeof value !== "string") throw new TypeError("event selector field must be a string")
    if (!value || value === "(None)") return []
    const result = value.split(",").map(item => {
        if (!/^[1-9]\d*$/.test(item)) throw new RangeError("event selector field is invalid")
        return positive(Number(item), "event selector field")
    })
    if (result.some((item, index) => index && item <= result[index - 1])) throw new RangeError("event selector field is unsorted")
    return result
}

function sameQueries(actual: readonly Query[], expected: readonly Query[]): boolean {
    return actual.length === expected.length && actual.every((query, index) => query.kind === expected[index].kind
        && (query.kind === "All" || same(query.values!, expected[index].values!)))
}

function matchingIds(source: ReadonlySet<number>, predicate: (id: number) => boolean): number[] {
    return [...source].filter(predicate).sort((left, right) => left - right)
}

function validateRule(rule: ExactMultiRule): ExactMultiRule {
    const master = MASTERS.get(rule.missionId)
    if (!master || master.pattern !== String(rule.patternType)) throw new RangeError("event rule master mismatch")
    const row = master.row
    const range = rule.selector.range
    if ((rule.role === "any" && rule.patternType !== 16) || (rule.role === "host" && rule.patternType !== 17)
        || (rule.role === "guest" && rule.patternType !== 18)) throw new RangeError("event rule role mismatch")
    if (range === "All") {
        if (row[7] !== "(None)" || rule.categories !== "all" || rule.questIds !== "all" || rule.selector.keys.length) {
            throw new RangeError("event All selector mismatch")
        }
        return rule
    }
    if (row[7] !== RANGE_ROW[range]) throw new RangeError("event selector range mismatch")
    if (range === "WorldStoryEventBossBattle") {
        const declared = setValues(rule.questIds)
        if (!declared.length || declared.some(id => !WORLDS.has(id))) throw new RangeError("event world story questIds are not tracked")
        throw new RangeError("event world story selector derivation is not established")
    }
    const boss = range === "BossBattle"
    const third = masterValues(row[10])
    const expectedQueries = boss ? [{ kind: "Within" as const, values: masterValues(row[8]) },
        { kind: "Within" as const, values: masterValues(row[9]) }, ...(third.length
            ? [{ kind: "Within" as const, values: third }] : [{ kind: "All" as const }])]
        : [{ kind: "Within" as const, values: masterValues(row[8]) }, { kind: "Within" as const, values: masterValues(row[10]) }]
    if (!sameQueries(rule.selector.keys, expectedQueries)) throw new RangeError("event selector keys mismatch")
    if (!sameSet(rule.categories, boss ? [2] : [7])) throw new RangeError("event rule categories mismatch")
    const expectedIds = boss ? matchingIds(BOSSES, id => expectedQueries[0].values!.includes(Math.floor(id / 1_000_000))
        && expectedQueries[1].values!.includes(Math.floor(id / 1000) % 1000)
        && (expectedQueries[2].kind === "All" || expectedQueries[2].values!.includes(id % 1000)))
        : matchingIds(ADVENTS, id => expectedQueries[0].values!.includes(Math.floor(id / 1000))
            && expectedQueries[1].values!.includes(id % 1000))
    if (!sameSet(rule.questIds, expectedIds)) throw new RangeError("event rule questIds mismatch")
    return rule
}

function validateRules(rules: readonly ExactMultiRule[]): readonly ExactMultiRule[] { return rules.map(validateRule) }

function sha256(text: string): string {
    const input = new TextEncoder().encode(text)
    const bytes = new Uint8Array((input.length + 72) & ~63)
    bytes.set(input); bytes[input.length] = 128
    const view = new DataView(bytes.buffer); view.setUint32(bytes.length - 4, input.length * 8)
    const h = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225])
    const k = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298]
    for (let offset = 0; offset < bytes.length; offset += 64) {
        const w = new Uint32Array(64)
        for (let index = 0; index < 16; index++) w[index] = view.getUint32(offset + index * 4)
        for (let index = 16; index < 64; index++) { const x = w[index - 15], y = w[index - 2]; w[index] = (((x >>> 7 | x << 25) ^ (x >>> 18 | x << 14) ^ x >>> 3) + w[index - 7] + ((y >>> 17 | y << 15) ^ (y >>> 19 | y << 13) ^ y >>> 10) + w[index - 16]) >>> 0 }
        let [a, b, c, d, e, f, g, q] = h
        for (let index = 0; index < 64; index++) { const s1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7); const choice = e & f ^ ~e & g; const t1 = (q + s1 + choice + k[index] + w[index]) >>> 0; const s0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10); const majority = a & b ^ a & c ^ b & c; q = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + s0 + majority) >>> 0 }
        h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0; h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + q) >>> 0
    }
    return [...h].map(value => value.toString(16).padStart(8, "0")).join("")
}

function approved(rules: readonly ExactMultiRule[]): readonly ExactMultiRule[] {
    const ids = rules.map(rule => rule.missionId)
    if (ids.length !== 805 || sha256(ids.join(",")) !== DIGEST) throw new RangeError("event battle rule authority mismatch")
    return rules
}

const DEFAULT_RULES = approved(validateRules(compileRules(eventRules)))

export function loadExactEventBattleRules(assetValue: unknown): readonly ExactMultiRule[] {
    return validateRules(compileRules(assetValue)).map(rule => ({ ...rule, categories: rule.categories === "all" ? "all" : new Set(rule.categories),
        selector: { range: rule.selector.range, keys: rule.selector.keys.map(key => key.kind === "All" ? { kind: "All" } : { kind: "Within", values: [...key.values!] }) },
        questIds: rule.questIds === "all" ? "all" : new Set(rule.questIds) }))
}

export function getExactEventBattleRuleCoverage() {
    const roles = { any: 0, host: 0, guest: 0 }
    for (const rule of DEFAULT_RULES) roles[rule.role]++
    return { totalEventMissions: MASTERS.size, exactMultiRules: DEFAULT_RULES.length, roles }
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
    if (value === undefined || typeof value === "boolean") return value
    throw new TypeError(`${name} must be a boolean when present`)
}

function validTime(value: unknown): number {
    try {
        const time = Date.prototype.getTime.call(value)
        if (!Number.isFinite(time)) throw new TypeError("evaluation time must be finite")
        return time
    } catch (error) {
        if (error instanceof TypeError) throw error
        throw new TypeError("evaluation time must be a genuine Date")
    }
}

function matches(rule: ExactMultiRule, category: number, questId: number, host: boolean | undefined, time: number): boolean {
    const master = MASTERS.get(rule.missionId)!
    if (time < master.start || time > master.end || (rule.categories !== "all" && !rule.categories.has(category))
        || (rule.questIds !== "all" && !rule.questIds.has(questId))) return false
    return rule.role === "any" || (rule.role === "host" ? host === true : host === false)
}

export function recordEventMissionBattleFacts(context: FinishContext, evaluationTime: Date): number[] {
    if (typeof context !== "object" || context === null) throw new TypeError("finish context must be an object")
    const playerId = positive(context.playerId, "playerId")
    const questId = positive(context.questId, "questId")
    if (typeof context.questCategory !== "number" || !Number.isFinite(context.questCategory)) throw new TypeError("questCategory must be finite")
    if (!Number.isSafeInteger(context.questCategory) || context.questCategory < 0) throw new RangeError("questCategory must be non-negative safe")
    if (typeof context.questAccomplished !== "boolean") throw new TypeError("questAccomplished must be a boolean")
    const isMulti = optionalBoolean(context.isMulti, "isMulti")
    const isMultiHost = optionalBoolean(context.isMultiHost, "isMultiHost")
    const time = validTime(evaluationTime)
    if (!context.questAccomplished || isMulti !== true) return []
    const result = DEFAULT_RULES.filter(rule => matches(rule, context.questCategory, questId, isMultiHost, time)).map(rule => rule.missionId)
    if (!result.length) return []
    getDb().transaction(() => {
        for (const missionId of result) incrementPlayerCategoryMissionSync(playerId, CATEGORY, missionId, DELTA)
    })()
    return result.slice()
}
