import adventQuests from "../../../assets/advent_event_quest.json"
import dailyMissions from "../../../assets/mission_daily.json"
import scoreAttackQuests from "../../../assets/score_attack_event_quest.json"
import { getDb } from "../../data/db"
import type { FinishContext } from "../quest/finish/types"

const CATEGORY = 2
const DELTA = 1
const TARGET_IDS = [10075, 800115, 800116, 800117, 800124, 800125, 800126, 800392]

interface TargetSpec {
    readonly id: number
    readonly pattern: string
    readonly range: string
    readonly selector: string
    readonly start: string
    readonly end: string
    readonly rangeIndex: number
    readonly selectorIndex: number
}

interface DailyTarget extends TargetSpec {
    readonly startTime: number
    readonly endTime: number | undefined
}

function plainRecord(value: unknown, name: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new TypeError(`${name} must be a plain record`)
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${name} must be a plain record`)
    }
    return value as Record<string, unknown>
}

function canonicalPositiveKey(key: string, name: string): number {
    if (!/^[1-9]\d*$/.test(key)) throw new RangeError(`${name} must be canonical`)
    const number = Number(key)
    if (!Number.isSafeInteger(number)) throw new RangeError(`${name} must be safe`)
    return number
}

function ownDataEntries(record: Record<string, unknown>, name: string): Array<[string, unknown]> {
    if (Object.getOwnPropertySymbols(record).length !== 0) throw new TypeError(`${name} has symbols`)
    const keys = Object.getOwnPropertyNames(record)
    const descriptors = new Map<string, PropertyDescriptor>()
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(record, key)
        if (descriptor === undefined) throw new TypeError(`${name} changed during inspection`)
        if (!descriptor.enumerable || !("value" in descriptor)) throw new TypeError(`${name} has an accessor`)
        descriptors.set(key, descriptor)
    }
    return keys.map(key => [key, descriptors.get(key)?.value] as [string, unknown])
}

function denseArray(value: unknown, length: number, name: string): unknown[] {
    if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length !== 0) {
        throw new TypeError(`${name} must be a dense array`)
    }
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== length + 1 || !names.includes("length")) {
        throw new TypeError(`${name} must be a dense array`)
    }
    const result: unknown[] = []
    for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
            throw new TypeError(`${name} must be a dense data array`)
        }
        result.push(descriptor.value)
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length")
    if (lengthDescriptor === undefined || !("value" in lengthDescriptor) || lengthDescriptor.value !== length) {
        throw new TypeError(`${name} has an invalid length`)
    }
    return result
}

function cnTime(value: unknown, name: string): number | undefined {
    if (value === "(None)") return undefined
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

function targetSpec(id: number, pattern: string, range: string, selector: string, start: string, end: string,
    rangeIndex: number = 7, selectorIndex: number = 8): TargetSpec {
    return Object.freeze({ id, pattern, range, selector, start, end, rangeIndex, selectorIndex })
}

const TARGET_SPECS = Object.freeze([
    targetSpec(10075, "14", "20", "1", "2024-09-27 12:00:00", "2051-10-11 11:59:59"),
    targetSpec(800115, "16", "5", "200015", "2024-08-01 12:00:00", "2024-08-16 23:59:59"),
    targetSpec(800116, "16", "5", "200015", "2024-08-01 12:00:00", "2024-08-16 23:59:59"),
    targetSpec(800117, "16", "5", "200015", "2024-08-01 12:00:00", "2024-08-16 23:59:59"),
    targetSpec(800124, "16", "2", "", "2024-08-08 12:00:00", "2024-08-21 23:59:59"),
    targetSpec(800125, "16", "2", "", "2024-08-08 12:00:00", "2024-08-21 23:59:59"),
    targetSpec(800126, "16", "2", "", "2024-08-08 12:00:00", "2024-08-21 23:59:59"),
    targetSpec(800392, "23", "3", "", "2025-06-26 12:00:00", "(None)", 5, -1),
])

function matchesTargetDescriptor(row: readonly unknown[], spec: TargetSpec): boolean {
    return row[2] === spec.pattern && row[spec.rangeIndex] === spec.range
        && (spec.selectorIndex < 0 || row[spec.selectorIndex] === spec.selector)
        && row[25] === spec.start && row[26] === spec.end
}

function compileDailyTargets(raw: unknown): readonly DailyTarget[] {
    const entries = ownDataEntries(plainRecord(raw, "daily mission master"), "daily mission master")
    const rows = new Map<number, unknown[]>()
    for (const [key, value] of entries) {
        const id = canonicalPositiveKey(key, "daily mission key")
        if (rows.has(id)) throw new RangeError("daily mission key collision")
        const wrapper = denseArray(value, 1, `daily mission ${key}`)
        rows.set(id, denseArray(wrapper[0], 35, `daily mission row ${key}`))
    }
    for (const [id, row] of rows) {
        const matches = TARGET_SPECS.filter(spec => matchesTargetDescriptor(row, spec))
        if (matches.length > 0 && !matches.some(spec => spec.id === id)) {
            throw new RangeError(`daily mission target ${id} is unapproved`)
        }
    }
    const targets = TARGET_SPECS.map(spec => {
        const row = rows.get(spec.id)
        if (row === undefined) throw new Error(`daily mission target ${spec.id} is missing`)
        if (row[2] !== spec.pattern || row[spec.rangeIndex] !== spec.range
            || (spec.selectorIndex >= 0 && row[spec.selectorIndex] !== spec.selector)) {
            throw new TypeError(`daily mission target ${spec.id} shape mismatch`)
        }
        if (row[25] !== spec.start || row[26] !== spec.end) {
            throw new RangeError(`daily mission target ${spec.id} time mismatch`)
        }
        const startTime = cnTime(row[25], `daily mission ${spec.id} start`)
        const endTime = cnTime(row[26], `daily mission ${spec.id} end`)
        if (startTime === undefined || (endTime !== undefined && endTime < startTime)) {
            throw new RangeError(`daily mission ${spec.id} has an invalid time range`)
        }
        return Object.freeze({ ...spec, startTime, endTime })
    })
    if (entries.length !== 656) throw new RangeError("daily mission master count mismatch")
    const ids = targets.map(target => target.id)
    if (ids.length !== TARGET_IDS.length || ids.some((id, index) => id !== TARGET_IDS[index])) {
        throw new Error("daily mission target plan mismatch")
    }
    return Object.freeze(targets)
}

function compileAdventQuestIds(raw: unknown): ReadonlySet<number> {
    const entries = ownDataEntries(plainRecord(raw, "advent quest master"), "advent quest master")
    if (entries.length !== 459) throw new RangeError("advent quest master count mismatch")
    const ids = new Set<number>()
    for (const [key] of entries) {
        const id = canonicalPositiveKey(key, "advent quest key")
        if (ids.has(id)) throw new RangeError("advent quest key collision")
        ids.add(id)
    }
    return ids
}

function compileScoreEventIds(raw: unknown): ReadonlyMap<number, number> {
    const entries = ownDataEntries(plainRecord(raw, "score attack quest master"), "score attack quest master")
    if (entries.length !== 123) throw new RangeError("score attack quest master count mismatch")
    const events = new Map<number, number>()
    for (const [key, value] of entries) {
        const questId = canonicalPositiveKey(key, "score attack quest key")
        const fields = ownDataEntries(plainRecord(value, `score attack quest ${key}`), `score attack quest ${key}`)
        const eventId = fields.find(([field]) => field === "eventId")?.[1]
        if (typeof eventId !== "number" || !Number.isSafeInteger(eventId) || eventId <= 0) {
            throw new TypeError(`score attack quest ${key} eventId must be positive safe`)
        }
        if (events.has(questId)) throw new RangeError("score attack quest key collision")
        events.set(questId, eventId)
    }
    return events
}

const DAILY_TARGETS = compileDailyTargets(dailyMissions)
const ADVENT_QUEST_IDS = compileAdventQuestIds(adventQuests)
const SCORE_EVENT_IDS = compileScoreEventIds(scoreAttackQuests)

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

function isActive(target: DailyTarget, time: number): boolean {
    return target.startTime <= time && (target.endTime === undefined || time <= target.endTime)
}

export function recordDailyMissionBattleFacts(context: FinishContext, evaluationTime: Date): number[] {
    if (typeof context !== "object" || context === null) throw new TypeError("finish context must be an object")
    const playerId = positiveSafe(context.playerId, "playerId")
    const questId = positiveSafe(context.questId, "questId")
    const questCategory = nonNegativeSafe(context.questCategory, "questCategory")
    if (typeof context.questAccomplished !== "boolean") throw new TypeError("questAccomplished must be a boolean")
    const isMulti = optionalBoolean(context.isMulti, "isMulti")
    optionalBoolean(context.isMultiHost, "isMultiHost")
    const time = validTime(evaluationTime)
    if (!context.questAccomplished) return []

    const matched = DAILY_TARGETS.filter(target => {
        if (!isActive(target, time)) return false
        if (target.id === 10075) return questCategory === 27 && SCORE_EVENT_IDS.get(questId) === Number(target.selector)
        if (target.id === 800392) return true
        if (target.range === "5") return isMulti === true && questCategory === 7
            && Math.floor(questId / 1000) === Number(target.selector) && ADVENT_QUEST_IDS.has(questId)
        return isMulti === true && questCategory === 2
    })
    if (matched.length === 0) return []
    const result = matched.map(target => target.id)
    const { incrementPlayerCategoryMissionSync } = require("../../data/domains/category_mission") as typeof import("../../data/domains/category_mission")
    getDb().transaction(() => {
        for (const missionId of result) incrementPlayerCategoryMissionSync(playerId, CATEGORY, missionId, DELTA)
    })()
    return result
}
