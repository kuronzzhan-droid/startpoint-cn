import { getDb } from "../db"
import { RushEventBattleType } from "../types"
import { ABYSS_EVENT_IDS, ABYSS_EX_EVENT_ID, ABYSS_NORMAL_EVENT_ID,
    abyssEventFromQuest, isAbyssEvent } from "../../lib/abyss-modes"
import { getAbyssTimeRevision } from "../../lib/abyss-time-revision"
import { compareVersion, getPatchManifest } from "../../lib/version"
import { QuestCategory } from "../../lib/types/quest"
import { resetLeaderboardCompetitionSync } from "../../lib/leaderboard/service"
import { runPersistenceTransactionSync } from "../../lib/persistence-coordinator";

/** An explicit publication marker prevents ordinary asset updates from resetting runs. */
export function getAbyssTowerResetRevision(eventId: number): string | null {
    if (!isAbyssEvent(eventId)) return null
    const key = `rush:${eventId}`
    const patches = getPatchManifest().patches.filter(patch => patch.enabled && patch.type === "patch")
    let winner: { version: string; revision: string } | null = null
    for (const patch of patches) {
        const preserved = patch.rush_tower_preserves?.[key]
        if (preserved !== undefined && (!/^[a-f0-9]{64}$/.test(preserved)
            || !/^[a-f0-9]{64}$/.test(patch.quest_time_revisions?.[key] ?? "")
            || patch.rush_tower_resets?.[key] !== undefined))
            throw new Error(`Invalid tower preservation marker for ${key} in ${patch.id}`)
        const revision = patch.rush_tower_resets?.[key]
        if (revision === undefined) continue
        if (!/^[a-f0-9]{64}$/.test(revision) || patch.quest_time_revisions?.[key] !== revision)
            throw new Error(`Invalid tower reset marker for ${key} in ${patch.id}`)
        const order = winner === null ? 1 : compareVersion(patch.version, winner.version)
        if (order === 0 && winner!.revision !== revision)
            throw new Error(`Conflicting tower reset markers for ${key}`)
        if (order > 0) winner = { version: patch.version, revision }
    }
    if (winner === null) return null
    if (getAbyssTimeRevision(eventId) !== winner.revision) {
        const timing = patches.filter(patch => patch.quest_time_revisions?.[key] !== undefined)
            .sort((a, b) => compareVersion(b.version, a.version))
        const latest = timing.filter(patch => patch.version === timing[0]?.version)
        // An explicit repair binds the new timing fingerprint to the existing run.
        // Missing, conflicting or obsolete declarations still fail closed.
        if (!latest.length || latest.some(patch => compareVersion(patch.version, winner!.version) <= 0
            || patch.rush_tower_preserves?.[key] !== winner!.revision))
            throw new Error(`Tower ${key} changed without a matching progress reset marker`)
    }
    return winner.revision
}

/** Historical finite clear is permanent; restarting a run cannot relock EX. */
export function hasAbyssExUnlockSync(playerId: number): boolean {
    const db = getDb()
    return !!db.prepare(`SELECT 1 FROM players_rush_events_cleared_folders
        WHERE player_id=? AND event_id=? AND folder_id=1`).get(playerId, ABYSS_NORMAL_EVENT_ID)
        || !!db.prepare(`SELECT 1 FROM players_quest_progress
        WHERE player_id=? AND section=? AND quest_id=? AND finished=1`)
            .get(playerId, QuestCategory.RUSH_EVENT, ABYSS_NORMAL_EVENT_ID * 1000 + 30)
}

function towerNeedsReset(playerId: number, eventId: number, revision: string): boolean {
    const row = getDb().prepare(`SELECT tower_revision FROM players_rush_events
        WHERE player_id=? AND event_id=?`).get(playerId, eventId) as { tower_revision: string | null } | undefined
    return row !== undefined && row.tower_revision !== revision
}

/** Only current finite-run state is reset. Clears, inventories and reward receipts survive. */
export function refreshPlayerAbyssTowerSync(playerId: number, eventId: number): boolean {
    const revision = getAbyssTowerResetRevision(eventId)
    if (revision === null) return false
    // Read first: an up-to-date tower needs no write transaction. The check
    // is repeated inside the transaction before anything is reset.
    if (!towerNeedsReset(playerId, eventId, revision)) return false
    const db = getDb()
    return runPersistenceTransactionSync({ domain: "event", playerId, operation: "refresh_abyss_tower" }, () => {
        if (!towerNeedsReset(playerId, eventId, revision)) return false
        resetLeaderboardCompetitionSync(playerId, { category: QuestCategory.RUSH_EVENT, eventId, folderId: 1 })
        db.prepare(`DELETE FROM players_rush_events_played_parties
            WHERE player_id=? AND event_id=? AND battle_type=?`).run(playerId, eventId, RushEventBattleType.FOLDER)
        db.prepare(`UPDATE players_rush_events SET active_rush_battle_folder_id=1, tower_revision=?
            WHERE player_id=? AND event_id=?`).run(revision, playerId, eventId)
        // Keep an old active battle's revision intact: settlement/load reject it as stale.
        return true
    })
}

export function refreshPlayerAbyssTowersSync(playerId: number): void {
    // Read-only check first; the common case (every tower current) opens no
    // write transaction. Otherwise all towers reset atomically as before.
    const needed = ABYSS_EVENT_IDS.some(eventId => {
        const revision = getAbyssTowerResetRevision(eventId)
        return revision !== null && towerNeedsReset(playerId, eventId, revision)
    })
    if (!needed) return
    runPersistenceTransactionSync({ domain: "event", playerId, operation: "refresh_abyss_towers" }, () => {
        for (const eventId of ABYSS_EVENT_IDS) refreshPlayerAbyssTowerSync(playerId, eventId)
    })
}

export function canStartAbyssQuestSync(playerId: number, category: number, questId: number): boolean {
    const eventId = abyssEventFromQuest(category, questId)
    if (eventId === null) return true
    if (eventId === ABYSS_EX_EVENT_ID && !hasAbyssExUnlockSync(playerId)) return false
    refreshPlayerAbyssTowerSync(playerId, eventId)
    const round = questId % 1000
    if (round === 99) return true // native endless compatibility, never a finite round
    if (round < 1 || round > 30) return false
    // Preserve the deployed normal tower until the split's first publication.
    if (eventId === ABYSS_NORMAL_EVENT_ID && getAbyssTowerResetRevision(eventId) === null) return true
    const rows = getDb().prepare(`SELECT round FROM players_rush_events_played_parties
        WHERE player_id=? AND event_id=? AND battle_type=? ORDER BY round`)
        .all(playerId, eventId, RushEventBattleType.FOLDER) as { round: number }[]
    let expected = 1
    for (const row of rows) {
        if (row.round !== eventId * 1000 + expected) break
        expected++
    }
    return round === expected
}
