import { getDb } from "../db"

export interface MissionBattleCounters {
    singlePlayCount: number
    singleClearCount: number
    multiPlayCount: number
    multiClearCount: number
    multiHostClearCount: number
    multiGuestClearCount: number
    singleRankSsCount: number
    rankSsCount: number
    rankSCount: number
    rankACount: number
    rankBCount: number
}

export interface MissionBattleResult {
    isMulti: boolean
    isHost?: boolean
    accomplished: boolean
    clearRank?: number | null
}

const COUNTER_COLUMNS = [
    "single_play_count",
    "single_clear_count",
    "multi_play_count",
    "multi_clear_count",
    "multi_host_clear_count",
    "multi_guest_clear_count",
    "single_rank_ss_count",
    "rank_ss_count",
    "rank_s_count",
    "rank_a_count",
    "rank_b_count",
] as const

const EMPTY_COUNTERS: Readonly<MissionBattleCounters> = Object.freeze({
    singlePlayCount: 0,
    singleClearCount: 0,
    multiPlayCount: 0,
    multiClearCount: 0,
    multiHostClearCount: 0,
    multiGuestClearCount: 0,
    singleRankSsCount: 0,
    rankSsCount: 0,
    rankSCount: 0,
    rankACount: 0,
    rankBCount: 0,
})

function positiveSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`)
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`)
    }
    return value
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`)
    }
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`)
    }
    return value
}

export function getMissionBattleCountersSync(playerId: number): MissionBattleCounters {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const row = getDb().prepare(`
        SELECT ${COUNTER_COLUMNS.join(", ")}
        FROM players_mission_battle_counters
        WHERE player_id = ?
    `).get(validPlayerId) as Record<string, unknown> | undefined
    if (row === undefined) return { ...EMPTY_COUNTERS }
    const values = COUNTER_COLUMNS.map(column => nonNegativeSafeInteger(row[column], column))
    return {
        singlePlayCount: values[0]!,
        singleClearCount: values[1]!,
        multiPlayCount: values[2]!,
        multiClearCount: values[3]!,
        multiHostClearCount: values[4]!,
        multiGuestClearCount: values[5]!,
        singleRankSsCount: values[6]!,
        rankSsCount: values[7]!,
        rankSCount: values[8]!,
        rankACount: values[9]!,
        rankBCount: values[10]!,
    }
}

function validateResult(value: unknown): MissionBattleResult {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new TypeError("result must be an object")
    }
    const result = value as Partial<MissionBattleResult>
    if (typeof result.isMulti !== "boolean" || typeof result.accomplished !== "boolean") {
        throw new TypeError("isMulti and accomplished must be booleans")
    }
    if (result.isHost !== undefined && typeof result.isHost !== "boolean") {
        throw new TypeError("isHost must be a boolean or undefined")
    }
    if (result.clearRank !== undefined && result.clearRank !== null) {
        nonNegativeSafeInteger(result.clearRank, "clearRank")
    }
    return result as MissionBattleResult
}

export function recordMissionBattleResultSync(
    playerId: number,
    rawResult: MissionBattleResult,
): void {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const result = validateResult(rawResult)
    const cleared = result.accomplished
    const rank = result.clearRank
    const increments = [
        result.isMulti ? 0 : 1,
        !result.isMulti && cleared ? 1 : 0,
        result.isMulti ? 1 : 0,
        result.isMulti && cleared ? 1 : 0,
        result.isMulti && cleared && result.isHost === true ? 1 : 0,
        result.isMulti && cleared && result.isHost === false ? 1 : 0,
        !result.isMulti && cleared && rank === 5 ? 1 : 0,
        cleared && rank === 5 ? 1 : 0,
        cleared && rank === 4 ? 1 : 0,
        cleared && rank === 3 ? 1 : 0,
        cleared && rank === 2 ? 1 : 0,
    ]
    const updates = COUNTER_COLUMNS.map(column => `${column} = ${column} + excluded.${column}`)
    const guards = COUNTER_COLUMNS.map(column =>
        `typeof(${column}) = 'integer' AND ${column} BETWEEN 0 AND ?`
    )
    const resultWrite = getDb().prepare(`
        INSERT INTO players_mission_battle_counters (player_id, ${COUNTER_COLUMNS.join(", ")})
        VALUES (?, ${COUNTER_COLUMNS.map(() => "?").join(", ")})
        ON CONFLICT(player_id) DO UPDATE SET ${updates.join(", ")}
        WHERE ${guards.join(" AND ")}
    `).run(
        validPlayerId,
        ...increments,
        ...increments.map(increment => Number.MAX_SAFE_INTEGER - increment),
    )
    if (resultWrite.changes !== 1) {
        throw new RangeError("mission battle counters cannot be incremented safely")
    }
}
