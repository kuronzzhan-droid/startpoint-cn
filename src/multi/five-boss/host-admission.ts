import { getDb } from "../../data/db"
import { getPlayerActiveQuestSync } from "../../data/domains/quest_active"

/** Owner observation of the host's exact previous play, made before SQL admission. */
export interface FiveBossHostAdmissionAuthorization {
    playId: string
    recoverable: boolean
    reason: string
    retained?: true
}

/** The caller verifies durable Finalize/entry proof and preserves the old result. */
export type FiveBossHostDetach = (hostPlayerId: number, expectedPlayId: string) => boolean

// Explicit nonrecoverable outcomes from classifyMultiActiveQuestRecovery.
// An owner observation alone never authorizes deletion: SQL proof remains required.
const endedGameplayReasons: ReadonlySet<string> = new Set([
    "result_pending",
    "missing_room_number",
    "room_missing",
    "room_not_in_battle",
    "quest_mismatch",
    "member_not_in_battle",
    "battle_identity_missing",
    "battle_identity_mismatch",
])

function conflict(message: string): never {
    // The domain calls this guard; resolving its error at call time avoids a static cycle.
    const { FiveBossGauntletRunError } = require("../../data/domains/fiveBossGauntletRun")
    throw new FiveBossGauntletRunError("run_conflict", message)
}

/** Check payment-time host admission inside the same transaction as the first debit. */
export function prepareFiveBossHostAdmissionSync(
    hostPlayerId: number,
    runId: string,
    authorization: FiveBossHostAdmissionAuthorization | null | undefined,
    detachCallback: FiveBossHostDetach,
): void {
    if (!getDb().inTransaction) {
        conflict("five-boss host admission must share the run payment transaction")
    }
    const active = getPlayerActiveQuestSync(hostPlayerId)
    if (active === null) return
    if (
        authorization?.playId !== active.playId
        || authorization.recoverable !== false
        || !endedGameplayReasons.has(authorization.reason)
    ) {
        conflict(`host cannot enter five-boss run ${runId} while its previous play remains active`)
    }
    if (
        detachCallback(hostPlayerId, active.playId) !== true
        || getPlayerActiveQuestSync(hostPlayerId) !== null
    ) {
        conflict(`host previous play could not be detached for five-boss run ${runId}`)
    }
}
