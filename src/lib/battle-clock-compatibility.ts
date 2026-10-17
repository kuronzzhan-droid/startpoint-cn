import type { Database } from "better-sqlite3"
import { getLegacyTimeOffset, getRealServerDate } from "../utils"

export const BATTLE_CLOCK_VERSION = 1
export const CLOCK_ABORT_OPERATION = "clock_migration.abort"

/** Version 0 is a preserved legacy registration, not proof of a forged play. */
export function isSupportedBattleClockVersion(version: number | undefined): boolean {
    return version === undefined || version === 0 || version === BATTLE_CLOCK_VERSION
}

export function getBattleClockDate(version: number): Date {
    if (!isSupportedBattleClockVersion(version)) throw new Error("Unsupported battle clock version")
    const real = getRealServerDate().getTime()
    return new Date(real + (version === 0 ? getLegacyTimeOffset() ?? 0 : 0))
}

/** Existing terminal receipts stay terminal; no legacy battle is migrated or aborted here. */
export function isClockAbortedPlaySync(db: Database, playerId: number, playId: string): boolean {
    return !!db.prepare("SELECT 1 FROM player_operation_receipts WHERE player_id=? AND operation=? AND request_key=?")
        .get(playerId, CLOCK_ABORT_OPERATION, playId)
}
