import { getDb } from "../../data/db"
import { SaveValidator } from "./types"

const MAIN_QUEST_SECTION = 1
const UNISON_UNLOCK_QUEST_ID = 1006001
const FIRST_QUEST_AFTER_UNISON_UNLOCK = 1006002
const UNISON_UNLOCK_TUTORIAL_ID = 12

export type UnisonUnlockRepairStatus = "not_eligible" | "needs_repair" | "already_unlocked"

interface RawUnisonUnlockProgress {
    finished: number
    host_finished: number
    unlocked: number
    clear_rank: number | null
}

/**
 * Reports whether a player has enough story evidence for the repair and
 * whether the persisted 1-6-1 row and tutorial marker 12 are both complete.
 */
export function getUnisonUnlockRepairStatusSync(playerId: number): UnisonUnlockRepairStatus {
    const evidence = getDb().prepare(`
        SELECT 1
        FROM players_quest_progress
        WHERE player_id = ?
          AND section = ?
          AND (
              quest_id = ?
              OR (quest_id >= ? AND finished = 1)
          )
        LIMIT 1
    `).get(
        playerId,
        MAIN_QUEST_SECTION,
        UNISON_UNLOCK_QUEST_ID,
        FIRST_QUEST_AFTER_UNISON_UNLOCK,
    )
    if (!evidence) return "not_eligible"

    const progress = getDb().prepare(`
        SELECT finished, host_finished, unlocked, clear_rank
        FROM players_quest_progress
        WHERE player_id = ?
          AND section = ?
          AND quest_id = ?
    `).get(
        playerId,
        MAIN_QUEST_SECTION,
        UNISON_UNLOCK_QUEST_ID,
    ) as RawUnisonUnlockProgress | undefined

    const tutorial = getDb().prepare(`
        SELECT 1
        FROM players_triggered_tutorials
        WHERE player_id = ?
          AND id = ?
        LIMIT 1
    `).get(playerId, UNISON_UNLOCK_TUTORIAL_ID)

    if (
        progress
        && progress.finished === 1
        && progress.host_finished === 1
        && progress.unlocked === 1
        && (progress.clear_rank ?? 0) >= 5
        && tutorial
    ) {
        return "already_unlocked"
    }
    return "needs_repair"
}

/**
 * Repairs legacy saves that progressed past 1-6-1 without retaining its
 * completion row or tutorial marker 12. The client needs both records before
 * it exposes unison.
 *
 * An existing 1-6-1 row or a later completed main quest is required as
 * evidence, so this never unlocks unison early for accounts that have not yet
 * reached the required story point.
 */
export function repairUnisonUnlockProgressSync(playerId: number): number {
    const db = getDb()
    const changes = db.transaction(() => {
        const questResult = db.prepare(`
            INSERT INTO players_quest_progress (
                section,
                quest_id,
                finished,
                host_finished,
                unlocked,
                clear_rank,
                player_id
            )
            SELECT ?, ?, 1, 1, 1, 5, ?
            WHERE EXISTS (
                SELECT 1
                FROM players_quest_progress
                WHERE player_id = ?
                  AND section = ?
                  AND (
                      quest_id = ?
                      OR (quest_id >= ? AND finished = 1)
                  )
            )
            ON CONFLICT(section, quest_id, player_id) DO UPDATE SET
                finished = 1,
                host_finished = 1,
                unlocked = 1,
                clear_rank = MAX(COALESCE(players_quest_progress.clear_rank, 0), 5)
            WHERE players_quest_progress.finished = 0
               OR players_quest_progress.host_finished = 0
               OR players_quest_progress.unlocked = 0
               OR COALESCE(players_quest_progress.clear_rank, 0) < 5
        `).run(
            MAIN_QUEST_SECTION,
            UNISON_UNLOCK_QUEST_ID,
            playerId,
            playerId,
            MAIN_QUEST_SECTION,
            UNISON_UNLOCK_QUEST_ID,
            FIRST_QUEST_AFTER_UNISON_UNLOCK
        )

        const tutorialResult = db.prepare(`
            INSERT OR IGNORE INTO players_triggered_tutorials (id, player_id)
            SELECT ?, ?
            WHERE EXISTS (
                SELECT 1
                FROM players_quest_progress
                WHERE player_id = ?
                  AND section = ?
                  AND quest_id = ?
                  AND finished = 1
                  AND host_finished = 1
                  AND unlocked = 1
                  AND COALESCE(clear_rank, 0) >= 5
            )
        `).run(
            UNISON_UNLOCK_TUTORIAL_ID,
            playerId,
            playerId,
            MAIN_QUEST_SECTION,
            UNISON_UNLOCK_QUEST_ID,
        )

        return questResult.changes + tutorialResult.changes
    })()

    if (changes > 0) {
        console.log(
            `[UNISON_UNLOCK] repaired player=${playerId} `
            + `quest=${UNISON_UNLOCK_QUEST_ID} tutorial=${UNISON_UNLOCK_TUTORIAL_ID}`
        )
    }
    return changes
}

export const UnisonUnlockValidator: SaveValidator = {
    name: "unison-unlock",
    validate: repairUnisonUnlockProgressSync
}
