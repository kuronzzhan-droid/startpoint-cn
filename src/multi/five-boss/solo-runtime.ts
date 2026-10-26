import { getDb } from "../../data/db"
import { getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getPlayerActiveQuestSync } from "../../data/domains/quest_active"
import { getPlayerOptionSync } from "../../data/domains/option"
import { FiveBossGauntletRunError, detachFinalizedFiveBossActiveSync } from "../../data/domains/fiveBossGauntletRun"
import { computeRealTimeStamina } from "../../lib/stamina"
import { runPersistenceTransaction, runPersistenceTransactionSync } from "../../lib/persistence-coordinator"
import { FIVE_BOSS_GAUNTLET, isFiveBossGauntletQuest } from "./contract"

function startFiveBossSoloInTransaction<T>(playerId: number, playId: string, persist: () => T): T | null {
    if (typeof playId !== "string" || !playId.length || playId.length > 255) throw new Error("Invalid play id.")
    const db = getDb()
    const previous = getPlayerActiveQuestSync(playerId)
    if (previous?.isMulti && previous.playId !== playId && isFiveBossGauntletQuest(previous.category, previous.questId)) {
        detachFinalizedFiveBossActiveSync(playerId, previous.playId)
    }
    const active = getPlayerActiveQuestSync(playerId)
    if (active?.isMulti && isFiveBossGauntletQuest(active.category, active.questId)) {
        throw new Error("Finish or abort the multiplayer run before starting solo.")
    }
    const old = db.prepare("SELECT status FROM five_boss_solo_runs WHERE player_id = ? AND play_id = ?")
        .get(playerId, playId) as { status: string } | undefined
    if (old) {
        if (old.status !== "active" || active?.playId !== playId) throw new Error("This play id has ended.")
        return null
    }
    const player = getPlayerSync(playerId)
    if (!player) throw new Error("Player does not exist.")
    // The legacy helper rounds now to seconds. Subsecond heal timestamps
    // must not make its negative fraction consume an extra stamina point.
    const stamina = Math.max(player.stamina, computeRealTimeStamina(player))
    const staminaCost = FIVE_BOSS_GAUNTLET.staminaCost
    if (stamina < staminaCost) throw new Error("Insufficient stamina.")
    const debit = db.prepare(`UPDATE players_items SET amount = amount - 1
        WHERE player_id = ? AND id = ? AND amount >= 1`).run(playerId, FIVE_BOSS_GAUNTLET.ticketItemId)
    if (debit.changes !== 1) throw new FiveBossGauntletRunError("insufficient_ticket", "Not enough entry tickets.")
    updatePlayerSync({ id: playerId, stamina: stamina - staminaCost, staminaHealTime: new Date(),
        totalStaminaUsed: (player.totalStaminaUsed ?? 0) + staminaCost })
    db.prepare("UPDATE five_boss_solo_runs SET status = 'aborted' WHERE player_id = ? AND status = 'active'").run(playerId)
    const autoAtStart = getPlayerOptionSync(playerId, "auto_play", true)
    db.prepare(`INSERT INTO five_boss_solo_runs(player_id, play_id, status, auto_at_start, auto_used)
        VALUES (?, ?, 'active', ?, ?)`).run(playerId, playId, autoAtStart ? 1 : 0, autoAtStart ? 1 : 0)
    return persist()
}

export function startFiveBossSoloSync<T>(playerId: number, playId: string, persist: () => T): T | null {
    return runPersistenceTransactionSync({
        domain: "single-quest", playerId, operation: "five_boss_solo_start",
    }, () => startFiveBossSoloInTransaction(playerId, playId, persist))
}

/** Async HTTP entry point; keeps the single-player start off the request's synchronous transaction path. */
export function startFiveBossSolo<T>(playerId: number, playId: string, persist: () => T): Promise<T | null> {
    return runPersistenceTransaction({
        domain: "single-quest", playerId, operation: "five_boss_solo_start",
    }, () => startFiveBossSoloInTransaction(playerId, playId, persist))
}

/** Monotone marker, bound to the persistent current solo play, never a retry snapshot. */
export function markFiveBossSoloAutoUsedSync(playerId: number): void {
    getDb().prepare(`UPDATE five_boss_solo_runs SET auto_used = 1
        WHERE player_id = ? AND play_id = (
            SELECT play_id FROM players_active_quests
            WHERE player_id = ? AND is_multi = 0 AND category = ? AND quest_id = ?
        ) AND status = 'active' AND auto_used = 0`)
        .run(playerId, playerId, FIVE_BOSS_GAUNTLET.category, FIVE_BOSS_GAUNTLET.visibleQuestId)
}

export function getFiveBossSoloRewardMultiplierSync(playerId: number, playId: string): 1 | 2 {
    const row = getDb().prepare(`SELECT auto_at_start, auto_used FROM five_boss_solo_runs
        WHERE player_id = ? AND play_id = ? AND status = 'active'`)
        .get(playerId, playId) as { auto_at_start: number | null, auto_used: number } | undefined
    return row?.auto_at_start === 0 && row.auto_used === 0 ? 2 : 1
}

/** An explicit new multiplayer start abandons the old solo run without inventing a room. */
export function abandonFiveBossSoloForMultiSync(playerId: number, playId: string): boolean {
    return runPersistenceTransactionSync({
        domain: "multi-settlement", playerId, operation: "abandon_five_boss_solo_for_multi",
    }, () => {
        const active = getPlayerActiveQuestSync(playerId)
        if (!active || active.isMulti || active.playId !== playId
            || !isFiveBossGauntletQuest(active.category, active.questId)) return false
        abortFiveBossSoloSync(playerId, playId)
        getDb().prepare("DELETE FROM players_active_quests WHERE player_id = ? AND play_id = ? AND is_multi = 0")
            .run(playerId, playId)
        return true
    })
}

/** Called in the single-abort transaction before its active quest is cleared. */
export function abortFiveBossSoloSync(playerId: number, playId: string): void {
    getDb().prepare(`UPDATE five_boss_solo_runs SET status = 'aborted'
        WHERE player_id = ? AND play_id = ? AND status = 'active'`).run(playerId, playId)
}

export function getFiveBossSoloReceiptSync(playerId: number, requestKey: string | null): unknown | undefined {
    if (!requestKey) return undefined
    const row = getDb().prepare(`SELECT response_json FROM five_boss_solo_runs
        WHERE player_id = ? AND finish_request_key = ? AND status = 'settled'`)
        .get(playerId, requestKey) as { response_json: string } | undefined
    return row ? JSON.parse(row.response_json) : undefined
}

export function isActiveFiveBossSoloSync(playerId: number, playId: string): boolean {
    return !!getDb().prepare(`SELECT 1 FROM five_boss_solo_runs
        WHERE player_id = ? AND play_id = ? AND status = 'active'`).get(playerId, playId)
}

/** Called inside the ordinary single-finish transaction with all rewards. */
export function saveFiveBossSoloReceiptSync(playerId: number, playId: string, requestKey: string | null, response: unknown): void {
    if (!requestKey) throw new Error("Missing five-boss finish request identity.")
    const result = getDb().prepare(`UPDATE five_boss_solo_runs
        SET status = 'settled', finish_request_key = ?, response_json = ?
        WHERE player_id = ? AND play_id = ? AND status = 'active'`)
        .run(requestKey, JSON.stringify(response), playerId, playId)
    if (result.changes !== 1) throw new Error("Five-boss solo run is no longer active.")
}
