import { getDb } from "../../data/db"
import { getMissionBattleCountersSync } from "../../data/domains/mission_battle_facts"
import type { Player } from "../../data/types"

export interface SnapshotData {
    questClears: number
    staminaUsed: number
    rankSs: number
    rankS: number
    rankA: number
    rankB: number
    singlePlayCount: number
    singleClearCount: number
    multiPlayCount: number
    multiClearCount: number
    multiHostClearCount: number
    multiGuestClearCount: number
    dashCount: number
    powerFlipCount: number
    loginDays: number
}

const SNAPSHOT_FIELDS = [
    "questClears", "staminaUsed", "rankSs", "rankS", "rankA", "rankB",
    "singlePlayCount", "singleClearCount", "multiPlayCount", "multiClearCount",
    "multiHostClearCount", "multiGuestClearCount", "dashCount", "powerFlipCount",
    "loginDays",
] as const

function positiveSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`)
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`)
    return value
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`)
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`)
    return value
}

function snapshotType(value: unknown): string {
    if (value === "daily" || value === "weekly") return value
    if (typeof value !== "string") throw new TypeError("periodType must be a string")
    const match = value.match(/^pass-week:([1-9]\d*)$/)
    if (!match || !Number.isSafeInteger(Number(match[1]))) {
        throw new RangeError("periodType is not canonical")
    }
    return value
}

function validateSnapshot(data: unknown): SnapshotData {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new TypeError("snapshot must be an object")
    }
    const record = data as Record<string, unknown>
    return Object.fromEntries(SNAPSHOT_FIELDS.map(field => [
        field,
        nonNegativeSafeInteger(record[field], `snapshot.${field}`),
    ])) as unknown as SnapshotData
}

export function getPassWeekSnapshotType(eventId: number): string {
    return `pass-week:${positiveSafeInteger(eventId, "eventId")}`
}

export function buildPeriodicSnapshotData(
    playerId: number,
    player: Pick<Player, "totalStaminaUsed" | "totalDashes" | "totalPowerflips" | "totalLoginDays">,
    questClears: number,
): SnapshotData {
    positiveSafeInteger(playerId, "playerId")
    const counters = getMissionBattleCountersSync(playerId)
    return validateSnapshot({
        questClears,
        staminaUsed: player.totalStaminaUsed ?? 0,
        rankSs: counters.rankSsCount,
        rankS: counters.rankSCount,
        rankA: counters.rankACount,
        rankB: counters.rankBCount,
        singlePlayCount: counters.singlePlayCount,
        singleClearCount: counters.singleClearCount,
        multiPlayCount: counters.multiPlayCount,
        multiClearCount: counters.multiClearCount,
        multiHostClearCount: counters.multiHostClearCount,
        multiGuestClearCount: counters.multiGuestClearCount,
        dashCount: player.totalDashes ?? 0,
        powerFlipCount: player.totalPowerflips ?? 0,
        loginDays: player.totalLoginDays ?? 0,
    })
}

export function initializePeriodicMissionSnapshots(
    playerId: number,
    player: Pick<Player, "totalStaminaUsed" | "totalDashes" | "totalPowerflips" | "totalLoginDays">,
    options: { countCurrentLoginDay?: boolean } = {},
): void {
    const baseline = buildPeriodicSnapshotData(playerId, player, 0)
    takeSnapshot(playerId, "daily", baseline)
    takeSnapshot(playerId, "weekly", {
        ...baseline,
        loginDays: options.countCurrentLoginDay ? Math.max(0, baseline.loginDays - 1) : baseline.loginDays,
    })
}

export function takeSnapshot(playerId: number, periodType: string, rawData: SnapshotData): void {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const validType = snapshotType(periodType)
    const data = validateSnapshot(rawData)
    const result = getDb().prepare(`
        INSERT INTO players_periodic_snapshots (
            player_id, period_type, quest_clears, stamina_used, rank_ss, rank_s, rank_a, rank_b,
            single_play_count, single_clear_count, multi_play_count, multi_clear_count,
            multi_host_clear_count, multi_guest_clear_count, dash_count, power_flip_count,
            login_days, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(player_id, period_type) DO UPDATE SET
            quest_clears=excluded.quest_clears, stamina_used=excluded.stamina_used,
            rank_ss=excluded.rank_ss, rank_s=excluded.rank_s, rank_a=excluded.rank_a, rank_b=excluded.rank_b,
            single_play_count=excluded.single_play_count, single_clear_count=excluded.single_clear_count,
            multi_play_count=excluded.multi_play_count, multi_clear_count=excluded.multi_clear_count,
            multi_host_clear_count=excluded.multi_host_clear_count,
            multi_guest_clear_count=excluded.multi_guest_clear_count, dash_count=excluded.dash_count,
            power_flip_count=excluded.power_flip_count, login_days=excluded.login_days,
            updated_at=excluded.updated_at
    `).run(validPlayerId, validType, ...SNAPSHOT_FIELDS.map(field => data[field]))
    if (result.changes !== 1) throw new Error("periodic snapshot write count mismatch")
}

export function getSnapshot(playerId: number, periodType: string): SnapshotData | null {
    const row = getDb().prepare(`
        SELECT quest_clears, stamina_used, rank_ss, rank_s, rank_a, rank_b,
               single_play_count, single_clear_count, multi_play_count, multi_clear_count,
               multi_host_clear_count, multi_guest_clear_count, dash_count, power_flip_count,
               login_days
        FROM players_periodic_snapshots
        WHERE player_id = ? AND period_type = ?
    `).get(positiveSafeInteger(playerId, "playerId"), snapshotType(periodType)) as Record<string, unknown> | undefined
    if (!row) return null
    return validateSnapshot({
        questClears: row.quest_clears,
        staminaUsed: row.stamina_used,
        rankSs: row.rank_ss,
        rankS: row.rank_s,
        rankA: row.rank_a,
        rankB: row.rank_b,
        singlePlayCount: row.single_play_count,
        singleClearCount: row.single_clear_count,
        multiPlayCount: row.multi_play_count,
        multiClearCount: row.multi_clear_count,
        multiHostClearCount: row.multi_host_clear_count,
        multiGuestClearCount: row.multi_guest_clear_count,
        dashCount: row.dash_count,
        powerFlipCount: row.power_flip_count,
        loginDays: row.login_days,
    })
}
