import type { Database } from "better-sqlite3"
import { getServerDate, getTimeOffset } from "../utils"

export interface PlayerTimeState {
    playerId: number
    version: number
    cutoverRealMs: number
    dayAnchorMs: number
    weekAnchorMs: number
}
export interface PlayerArchiveTimeBasis {
    kind: "real-system"
    version: 1
    cutoverRealMs: number
    dayAnchorMs: number
    weekAnchorMs: number
}

function database(db?: Database): Database { return db ?? require("../data/db").getDb() }
function assertEpoch(value: unknown, field: string): asserts value is number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) {
        throw new Error(`${field}: invalid real-time epoch`)
    }
}

/** Read existing markers only. This compatibility module never creates or migrates state. */
export function getExistingPlayerTimeStateSync(playerId: number, db?: Database): PlayerTimeState | null {
    const connection = database(db)
    if (!connection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='player_time_state'").get()) return null
    const row = connection.prepare("SELECT version,cutover_real_ms,day_anchor_ms,week_anchor_ms FROM player_time_state WHERE player_id=?")
        .get(playerId) as {version: number; cutover_real_ms: number; day_anchor_ms: number; week_anchor_ms: number} | undefined
    if (!row) return null
    if (row.version !== 1) throw new Error("Unsupported existing player time version")
    assertEpoch(row.cutover_real_ms, "cutoverRealMs")
    assertEpoch(row.day_anchor_ms, "dayAnchorMs")
    assertEpoch(row.week_anchor_ms, "weekAnchorMs")
    return { playerId, version: row.version, cutoverRealMs: row.cutover_real_ms,
        dayAnchorMs: row.day_anchor_ms, weekAnchorMs: row.week_anchor_ms }
}

export function getPlayerBusinessOffsetSync(playerId: number, db?: Database): number {
    return getExistingPlayerTimeStateSync(playerId, db) ? 0 : getTimeOffset() ?? 0
}

/** Maintenance storage only: the supplied date uses the current effective context, never an assumed global offset. */
export function getPlayerBusinessDateSync(playerId: number, providedDate = getServerDate(), db?: Database): Date {
    return new Date(providedDate.getTime() - (getTimeOffset() ?? 0) + getPlayerBusinessOffsetSync(playerId, db))
}

export function validatePlayerArchiveTimeBasis(value: unknown): asserts value is PlayerArchiveTimeBasis {
    if (!value || typeof value !== "object") throw new Error("Invalid archive time basis")
    const basis = value as PlayerArchiveTimeBasis
    if (basis.kind !== "real-system" || basis.version !== 1) throw new Error("Unsupported archive time basis")
    assertEpoch(basis.cutoverRealMs, "timeBasis.cutoverRealMs")
    assertEpoch(basis.dayAnchorMs, "timeBasis.dayAnchorMs")
    assertEpoch(basis.weekAnchorMs, "timeBasis.weekAnchorMs")
    if (basis.dayAnchorMs < basis.cutoverRealMs || basis.weekAnchorMs < basis.cutoverRealMs) throw new Error("Archive time anchors predate cutover")
}

/** Existing real maintenance fields are translated back to the legacy client coordinate. */
export function getPlayerClientMaintenanceDateSync(playerId: number, date: Date): Date {
    return new Date(date.getTime() - getPlayerBusinessOffsetSync(playerId) + (getTimeOffset() ?? 0))
}

/** Saved EXP offsets identify the checkpoint coordinate, not the displayed content date. */
export function getPlayerClientExpTime(player: { expPooledTime: Date; timeOffset?: number | null }): number {
    const clientOffset = getTimeOffset() ?? 0
    const storedOffset = typeof player.timeOffset === "number" && Number.isFinite(player.timeOffset)
        ? player.timeOffset : clientOffset
    return Math.floor((player.expPooledTime.getTime() - storedOffset + clientOffset) / 1000)
}
