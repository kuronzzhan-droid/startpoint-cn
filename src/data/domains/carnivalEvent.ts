import { getDb } from "../db";
import { PlayerCarnivalEventRecord, RawPlayerCarnivalEventRecord } from "../types";
import { deserializeNumberList, serializeNumberList } from "../utils";

function buildRecord(raw: RawPlayerCarnivalEventRecord): PlayerCarnivalEventRecord {
    return {
        eventId: raw.event_id,
        folderId: raw.folder_id,
        bestScore: raw.best_score,
        previousScore: raw.previous_score,
        previousCharacterIds: raw.previous_character_ids !== null ? deserializeNumberList(raw.previous_character_ids) : null,
        previousUnisonCharacterIds: raw.previous_unison_character_ids !== null ? deserializeNumberList(raw.previous_unison_character_ids) : null,
    }
}

export function getPlayerCarnivalEventRecordsSync(
    playerId: number,
    eventId: number
): PlayerCarnivalEventRecord[] {
    const rows = getDb().prepare(`
    SELECT player_id, event_id, folder_id, best_score, previous_score, previous_character_ids, previous_unison_character_ids
    FROM players_carnival_event_records
    WHERE player_id = ? AND event_id = ?
    `).all(playerId, eventId) as RawPlayerCarnivalEventRecord[]

    return rows.map(buildRecord)
}

export function getPlayerCarnivalEventRecordSync(
    playerId: number,
    eventId: number,
    folderId: number
): PlayerCarnivalEventRecord | null {
    const raw = getDb().prepare(`
    SELECT player_id, event_id, folder_id, best_score, previous_score, previous_character_ids, previous_unison_character_ids
    FROM players_carnival_event_records
    WHERE player_id = ? AND event_id = ? AND folder_id = ?
    `).get(playerId, eventId, folderId) as RawPlayerCarnivalEventRecord | undefined

    return raw ? buildRecord(raw) : null
}

/**
 * The first Carnival score lookup treated each difficulty as a separate
 * folder.  Carnival actually has three difficulties per folder, so old rows
 * must be collapsed once before the corrected lookup is used.  The marker
 * makes the migration safe to call from both index and quest-finish routes.
 */
export function migrateCarnivalEventFolderRecordsSync(
    eventId: number,
    difficultiesPerFolder: number = 3
): void {
    const db = getDb()

    db.transaction(() => {
        db.prepare(`
        CREATE TABLE IF NOT EXISTS carnival_event_folder_migrations (
            event_id INTEGER PRIMARY KEY,
            migrated_at INTEGER NOT NULL
        )
        `).run()

        const migrated = db.prepare(`
        SELECT event_id FROM carnival_event_folder_migrations WHERE event_id = ?
        `).get(eventId)
        if (migrated) return

        const rows = db.prepare(`
        SELECT player_id, event_id, folder_id, best_score, previous_score,
               previous_character_ids, previous_unison_character_ids
        FROM players_carnival_event_records
        WHERE event_id = ?
        ORDER BY player_id, folder_id
        `).all(eventId) as RawPlayerCarnivalEventRecord[]

        type MigratedRecord = RawPlayerCarnivalEventRecord & { player_id: number }
        const records = new Map<string, MigratedRecord>()
        for (const raw of rows as MigratedRecord[]) {
            const folderId = Math.floor((raw.folder_id - 1) / difficultiesPerFolder) + 1
            const key = `${raw.player_id}:${folderId}`
            const existing = records.get(key)
            if (!existing || (raw.best_score ?? 0) > (existing.best_score ?? 0)) {
                records.set(key, {
                    ...raw,
                    folder_id: folderId,
                    // The party stored in this row produced the retained best
                    // score, so expose that score alongside it after migration.
                    previous_score: raw.best_score,
                })
            }
        }

        db.prepare(`DELETE FROM players_carnival_event_records WHERE event_id = ?`).run(eventId)
        const insert = db.prepare(`
        INSERT INTO players_carnival_event_records (
            player_id, event_id, folder_id, best_score, previous_score,
            previous_character_ids, previous_unison_character_ids
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        for (const record of records.values()) {
            insert.run(
                record.player_id,
                record.event_id,
                record.folder_id,
                record.best_score,
                record.previous_score,
                record.previous_character_ids,
                record.previous_unison_character_ids
            )
        }

        db.prepare(`
        INSERT INTO carnival_event_folder_migrations (event_id, migrated_at)
        VALUES (?, ?)
        `).run(eventId, Date.now())
    })()
}

export function upsertPlayerCarnivalEventRecordSync(
    playerId: number,
    eventId: number,
    folderId: number,
    score: number,
    characterIds: (number | null)[],
    unisonCharacterIds: (number | null)[]
): PlayerCarnivalEventRecord {
    const db = getDb()

    return db.transaction((): PlayerCarnivalEventRecord => {
        const records = getPlayerCarnivalEventRecordsSync(playerId, eventId)
        const existing = records.find(record => record.folderId === folderId) ?? null

        // A character can contribute to only one Haniwa folder at a time.
        // The client warns about this before battle, but the server must be
        // authoritative because a modified or stale client can still submit a
        // conflicting result. Main and unison slots share the same lock.
        const attemptedCharacterIds = new Set(
            [...characterIds, ...unisonCharacterIds]
                .filter((id): id is number => id !== null && Number.isInteger(id) && id > 0)
        )
        const conflictingFolderIds: number[] = []
        if (attemptedCharacterIds.size > 0) {
            for (const record of records) {
                if (record.folderId === folderId) continue
                const recordedCharacterIds = [
                    ...(record.previousCharacterIds ?? []),
                    ...(record.previousUnisonCharacterIds ?? []),
                ]
                if (recordedCharacterIds.some(id => id !== null && id > 0 && attemptedCharacterIds.has(id))) {
                    conflictingFolderIds.push(record.folderId)
                }
            }
        }

        // Keep an explicit zero-score row instead of deleting it. After a
        // battle the client automatically fetches /carnival_event/index, but
        // merges only the returned folders and does not remove folders absent
        // from the response. Returning this tombstone makes the old score and
        // party disappear immediately without requiring a relog.
        const resetRecord = db.prepare(`
        UPDATE players_carnival_event_records
        SET best_score = 0,
            previous_score = 0,
            previous_character_ids = NULL,
            previous_unison_character_ids = NULL
        WHERE player_id = ? AND event_id = ? AND folder_id = ?
        `)
        for (const conflictingFolderId of conflictingFolderIds) {
            resetRecord.run(playerId, eventId, conflictingFolderId)
        }

        // Replaying a folder with a lower score must not overwrite that
        // folder's retained high score or the party which achieved it.
        const isNewBest = !existing || score > (existing.bestScore ?? 0)
        if (!isNewBest && existing) {
            if (conflictingFolderIds.length > 0) {
                console.log(
                    `[CARNIVAL] reset conflicting folders player=${playerId} event=${eventId} ` +
                    `current=${folderId} reset=${JSON.stringify(conflictingFolderIds)}`
                )
            }
            return existing
        }

        const bestScore = score
        db.prepare(`
        INSERT INTO players_carnival_event_records (player_id, event_id, folder_id, best_score, previous_score, previous_character_ids, previous_unison_character_ids)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id, event_id, folder_id) DO UPDATE SET
            best_score = excluded.best_score,
            previous_score = excluded.previous_score,
            previous_character_ids = excluded.previous_character_ids,
            previous_unison_character_ids = excluded.previous_unison_character_ids
        `).run(
            playerId,
            eventId,
            folderId,
            bestScore,
            bestScore,
            serializeNumberList(characterIds),
            serializeNumberList(unisonCharacterIds)
        )

        if (conflictingFolderIds.length > 0) {
            console.log(
                `[CARNIVAL] reset conflicting folders player=${playerId} event=${eventId} ` +
                `current=${folderId} reset=${JSON.stringify(conflictingFolderIds)}`
            )
        }

        return {
            eventId,
            folderId,
            bestScore,
            previousScore: bestScore,
            previousCharacterIds: characterIds,
            previousUnisonCharacterIds: unisonCharacterIds,
        }
    })()
}
