import passEventMissions from "../../../assets/mission_pass_event.json"
import { getDb } from "../../data/db"
import { incrementPlayerCategoryMissionSync } from "../../data/domains/category_mission"
import type { FinishContext } from "../quest/finish/types"
import { getMissionMasterDefinitions } from "./master-data"

const CATEGORY = 8
const DELTA = 1
const MASTER_KEY_COUNT = 115
const ROW_LENGTH = 36
const BOSS_RANGE = "2"

const PATTERN16_IDS: readonly number[] = Object.freeze([
    3, 4, 5, 6, 8, 10, 11, 12, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 26, 27,
    28, 29, 30, 32, 33, 34, 35, 36, 38, 40, 41, 42, 44, 45, 46, 47, 48, 49, 51, 52,
    53, 54, 58, 59, 60, 61, 63, 64, 65, 66, 67, 69, 70, 71, 73, 75, 76, 77, 78, 79,
    81, 82, 83, 84, 85, 87, 88, 89, 90, 91,
])
const PATTERN23_IDS: readonly number[] = Object.freeze([2, 9, 39, 55, 57, 72])

// row[8] range kind -> FinishContext.questCategory. These are two distinct enumerations that only
// happen to agree on 2; every other pair differs, so the mapping must stay explicit.
const RANGE_CATEGORY: ReadonlyMap<string, number> = new Map([
    ["2", 2], ["5", 7], ["7", 13], ["8", 11], ["10", 19], ["15", 22], ["16", 23], ["17", 24],
])

type Selector = ReadonlySet<number> | undefined

interface PassTarget {
    readonly id: number
    readonly singleAllowed: boolean
    readonly multiAllowed: boolean
    readonly category: number
    readonly boss: boolean
    readonly first: Selector
    readonly second: Selector
    readonly third: Selector
    readonly start: number
    readonly end: number
}

function plainRecord(value: unknown, name: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)
        || Object.getOwnPropertySymbols(value).length !== 0) {
        throw new TypeError(`${name} must be a plain record`)
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record`)
    return value as Record<string, unknown>
}

function ownDataEntries(source: Record<string, unknown>, name: string): Array<[string, unknown]> {
    return Object.getOwnPropertyNames(source).map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(source, key)
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
            throw new TypeError(`${name} has a non-data property`)
        }
        return [key, descriptor.value] as [string, unknown]
    })
}

function denseArray(value: unknown, length: number, name: string): unknown[] {
    if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length !== 0) {
        throw new TypeError(`${name} must be a dense array`)
    }
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== length + 1 || !names.includes("length")) throw new TypeError(`${name} must be dense`)
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length")
    if (lengthDescriptor === undefined || !("value" in lengthDescriptor) || lengthDescriptor.value !== length) {
        throw new TypeError(`${name} has an invalid length`)
    }
    const result: unknown[] = []
    for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
            throw new TypeError(`${name} must be a dense data array`)
        }
        result.push(descriptor.value)
    }
    return result
}

function canonicalPositiveKey(key: string, name: string): number {
    if (!/^[1-9]\d*$/.test(key)) throw new RangeError(`${name} must be canonical`)
    const id = Number(key)
    if (!Number.isSafeInteger(id)) throw new RangeError(`${name} must be safe`)
    return id
}

function patternTypeCell(value: unknown, name: string): string {
    if (typeof value !== "string") throw new TypeError(`${name} must be a string`)
    if (!/^(0|[1-9]\d*)$/.test(value)) throw new RangeError(`${name} must be a canonical decimal`)
    return value
}

function selectorSet(value: unknown, name: string): Selector {
    if (typeof value !== "string") throw new TypeError(`${name} must be a string`)
    if (value === "" || value === "(None)") return undefined
    const result: number[] = []
    for (const part of value.split(",")) {
        if (!/^[1-9]\d*$/.test(part)) throw new RangeError(`${name} must be a canonical decimal CSV`)
        const entry = Number(part)
        if (!Number.isSafeInteger(entry)) throw new RangeError(`${name} must stay safe`)
        if (result.length !== 0 && entry <= result[result.length - 1]) {
            throw new RangeError(`${name} must be sorted and unique`)
        }
        result.push(entry)
    }
    return new Set(result)
}

function battleKind(value: unknown, patternType: string, name: string): number {
    if (patternType === "16") {
        if (value !== "") throw new TypeError(`${name} must be the empty sentinel`)
        return 0
    }
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer`)
        if (value < 1 || value > 3) throw new RangeError(`${name} must be 1, 2 or 3`)
        return value
    }
    if (typeof value !== "string") throw new TypeError(`${name} must be a number or a canonical decimal`)
    if (!/^[1-3]$/.test(value)) throw new RangeError(`${name} must be canonical 1, 2 or 3`)
    return Number(value)
}

function cnTime(value: unknown, name: string): number {
    if (typeof value !== "string") throw new TypeError(`${name} must be a CN calendar string`)
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value)
    if (match === null) throw new RangeError(`${name} must be a strict CN calendar string`)
    const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
    const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day
        || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second) {
        throw new RangeError(`${name} is not a real calendar time`)
    }
    return Date.UTC(year, month - 1, day, hour - 8, minute, second)
}

function compileRows(raw: unknown): ReadonlyMap<number, readonly unknown[]> {
    const entries = ownDataEntries(plainRecord(raw, "pass mission master"), "pass mission master")
    if (entries.length !== MASTER_KEY_COUNT) throw new RangeError("pass mission master count mismatch")
    const rows = new Map<number, readonly unknown[]>()
    for (const [key, value] of entries) {
        const id = canonicalPositiveKey(key, "pass mission key")
        if (rows.has(id)) throw new RangeError("pass mission key collision")
        const wrapper = denseArray(value, 1, `pass mission ${key}`)
        rows.set(id, denseArray(wrapper[0], ROW_LENGTH, `pass mission row ${key}`))
    }
    return rows
}

function sameList(actual: readonly number[], expected: readonly number[], name: string): void {
    if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
        throw new RangeError(`${name} target set mismatch`)
    }
}

function crossValidate(rows: ReadonlyMap<number, readonly unknown[]>): void {
    const seen = new Set<number>()
    for (const definition of getMissionMasterDefinitions(CATEGORY)) {
        const missionId = definition?.missionId
        if (typeof missionId !== "number" || !Number.isFinite(missionId)) {
            throw new TypeError("pass mission definition id must be finite")
        }
        if (!Number.isSafeInteger(missionId) || missionId <= 0) {
            throw new RangeError("pass mission definition id must be positive safe")
        }
        if (seen.has(missionId)) throw new RangeError(`pass mission definition ${missionId} is duplicated`)
        seen.add(missionId)
        const row = rows.get(missionId)
        if (row === undefined) continue
        const patternType = patternTypeCell(row[3], `pass mission ${missionId} patternType`)
        if (patternType !== "16" && patternType !== "23") continue
        if (definition.patternType !== Number(patternType)) {
            throw new RangeError(`pass mission definition ${missionId} patternType mismatch`)
        }
    }
}

function parseTarget(id: number, row: readonly unknown[]): PassTarget {
    const patternType = patternTypeCell(row[3], `pass mission ${id} patternType`)
    const kind = battleKind(row[6], patternType, `pass mission ${id} battle kind`)
    const range = row[8]
    if (typeof range !== "string") throw new TypeError(`pass mission ${id} range kind must be a string`)
    if (!/^[1-9]\d*$/.test(range)) throw new RangeError(`pass mission ${id} range kind must be canonical`)
    const category = RANGE_CATEGORY.get(range)
    if (category === undefined) throw new RangeError(`pass mission ${id} range kind is not approved`)
    // All three selector cells are validated even when this range's matcher never reads one of them.
    const first = selectorSet(row[9], `pass mission ${id} selector 9`)
    const second = selectorSet(row[10], `pass mission ${id} selector 10`)
    const third = selectorSet(row[11], `pass mission ${id} selector 11`)
    if (row[12] !== "(None)") throw new TypeError(`pass mission ${id} reserved cell must be the none sentinel`)
    const start = cnTime(row[26], `pass mission ${id} start`)
    const end = cnTime(row[27], `pass mission ${id} end`)
    if (end < start) throw new RangeError(`pass mission ${id} has an invalid time range`)
    return Object.freeze({
        id,
        singleAllowed: patternType !== "16" && (kind === 1 || kind === 3),
        multiAllowed: patternType === "16" || kind === 2 || kind === 3,
        category,
        boss: range === BOSS_RANGE,
        first,
        second,
        third,
        start,
        end,
    })
}

function compilePlan(raw: unknown): readonly PassTarget[] {
    const rows = compileRows(raw)
    const found16: number[] = []
    const found23: number[] = []
    for (const [id, row] of rows) {
        const patternType = patternTypeCell(row[3], `pass mission ${id} patternType`)
        if (patternType === "16") found16.push(id)
        else if (patternType === "23") found23.push(id)
    }
    const ascending = (left: number, right: number): number => left - right
    sameList(found16.sort(ascending), PATTERN16_IDS, "pass pattern 16")
    sameList(found23.sort(ascending), PATTERN23_IDS, "pass pattern 23")
    crossValidate(rows)
    const plan = [...PATTERN16_IDS, ...PATTERN23_IDS]
        .map(id => parseTarget(id, rows.get(id) as readonly unknown[]))
        .sort((left, right) => left.id - right.id)
    return Object.freeze(plan)
}

const PASS_TARGETS = compilePlan(passEventMissions)

function positiveSafe(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`)
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be positive safe`)
    return value
}

function nonNegativeSafe(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`)
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be non-negative safe`)
    return value
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

function selectorHit(selector: Selector, part: number): boolean {
    return selector === undefined || selector.has(part)
}

function matches(target: PassTarget, questCategory: number, questId: number, multi: boolean, time: number): boolean {
    if (multi ? !target.multiAllowed : !target.singleAllowed) return false
    if (target.category !== questCategory) return false
    if (time < target.start || time > target.end) return false
    if (target.boss) {
        return selectorHit(target.first, Math.floor(questId / 1_000_000))
            && selectorHit(target.second, Math.floor(questId / 1000) % 1000)
            && selectorHit(target.third, questId % 1000)
    }
    return selectorHit(target.first, Math.floor(questId / 1000)) && selectorHit(target.third, questId % 1000)
}

export function recordPassMissionBattleFacts(context: FinishContext, evaluationTime: Date): number[] {
    if (typeof context !== "object" || context === null) throw new TypeError("finish context must be an object")
    const playerId = positiveSafe(context.playerId, "playerId")
    const questId = positiveSafe(context.questId, "questId")
    const questCategory = nonNegativeSafe(context.questCategory, "questCategory")
    if (typeof context.questAccomplished !== "boolean") throw new TypeError("questAccomplished must be a boolean")
    const isMulti = optionalBoolean(context.isMulti, "isMulti")
    optionalBoolean(context.isMultiHost, "isMultiHost")
    const time = validTime(evaluationTime)
    if (!context.questAccomplished) return []

    const multi = isMulti === true
    const result = PASS_TARGETS
        .filter(target => matches(target, questCategory, questId, multi, time))
        .map(target => target.id)
    if (result.length === 0) return []
    getDb().transaction(() => {
        for (const missionId of result) incrementPlayerCategoryMissionSync(playerId, CATEGORY, missionId, DELTA)
    })()
    return result
}
