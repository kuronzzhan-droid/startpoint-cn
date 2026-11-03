"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertPlayerCarnivalEventRecordSync = exports.migrateCarnivalEventFolderRecordsSync = exports.getPlayerCarnivalEventRecordSync = exports.getPlayerCarnivalEventRecordsSync = exports.deserializeCarnivalPartySlots = void 0;
const db_1 = require("../db");
const utils_1 = require("../utils");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
// The migration is idempotent in SQLite, but checking its marker still takes
// a write transaction. Keep the completed event IDs per database connection so
// repeated /carnival_event/index and finish requests do not enqueue the same
// maintenance transaction over and over. A WeakMap keeps test/runtime
// database lifetimes isolated when the connection is replaced.
const migratedCarnivalEvents = new WeakMap();
/**
 * Carnival record parties have three fixed slots.  Empty slots are persisted
 * by Array#join as empty CSV fields (for example `149998,,`).  The generic
 * number-list deserializer turns an empty string into numeric zero, which is
 * not a valid character id and makes the client try to resolve master key 0.
 * Keep slot positions intact while restoring empty/invalid fields to null.
 */
function deserializeCarnivalPartySlots(value) {
    return value.split(",").map(part => {
        if (part.trim() === "")
            return null;
        const characterId = Number(part);
        return Number.isInteger(characterId) && characterId > 0 ? characterId : null;
    });
}
exports.deserializeCarnivalPartySlots = deserializeCarnivalPartySlots;
function buildRecord(raw) {
    return {
        eventId: raw.event_id,
        folderId: raw.folder_id,
        bestScore: raw.best_score,
        previousScore: raw.previous_score,
        previousCharacterIds: raw.previous_character_ids !== null ? deserializeCarnivalPartySlots(raw.previous_character_ids) : null,
        previousUnisonCharacterIds: raw.previous_unison_character_ids !== null ? deserializeCarnivalPartySlots(raw.previous_unison_character_ids) : null,
    };
}
function getPlayerCarnivalEventRecordsSync(playerId, eventId) {
    const rows = (0, db_1.getDb)().prepare(`
    SELECT player_id, event_id, folder_id, best_score, previous_score, previous_character_ids, previous_unison_character_ids
    FROM players_carnival_event_records
    WHERE player_id = ? AND event_id = ?
    `).all(playerId, eventId);
    return rows.map(buildRecord);
}
exports.getPlayerCarnivalEventRecordsSync = getPlayerCarnivalEventRecordsSync;
function getPlayerCarnivalEventRecordSync(playerId, eventId, folderId) {
    const raw = (0, db_1.getDb)().prepare(`
    SELECT player_id, event_id, folder_id, best_score, previous_score, previous_character_ids, previous_unison_character_ids
    FROM players_carnival_event_records
    WHERE player_id = ? AND event_id = ? AND folder_id = ?
    `).get(playerId, eventId, folderId);
    return raw ? buildRecord(raw) : null;
}
exports.getPlayerCarnivalEventRecordSync = getPlayerCarnivalEventRecordSync;
/**
 * The first Carnival score lookup treated each difficulty as a separate
 * folder.  Carnival actually has three difficulties per folder, so old rows
 * must be collapsed once before the corrected lookup is used.  The marker
 * makes the migration safe to call from both index and quest-finish routes.
 */
function migrateCarnivalEventFolderRecordsSync(eventId, difficultiesPerFolder = 3) {
    const db = (0, db_1.getDb)();
    let migratedEvents = migratedCarnivalEvents.get(db);
    if (!migratedEvents) {
        migratedEvents = new Set();
        migratedCarnivalEvents.set(db, migratedEvents);
    }
    if (migratedEvents.has(eventId))
        return;
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "event", operation: "migrate_carnival_event_folder_records" }, () => {
        var _a, _b;
        db.prepare(`
        CREATE TABLE IF NOT EXISTS carnival_event_folder_migrations (
            event_id INTEGER PRIMARY KEY,
            migrated_at INTEGER NOT NULL
        )
        `).run();
        const migrated = db.prepare(`
        SELECT event_id FROM carnival_event_folder_migrations WHERE event_id = ?
        `).get(eventId);
        if (migrated)
            return;
        const rows = db.prepare(`
        SELECT player_id, event_id, folder_id, best_score, previous_score,
               previous_character_ids, previous_unison_character_ids
        FROM players_carnival_event_records
        WHERE event_id = ?
        ORDER BY player_id, folder_id
        `).all(eventId);
        const records = new Map();
        for (const raw of rows) {
            const folderId = Math.floor((raw.folder_id - 1) / difficultiesPerFolder) + 1;
            const key = `${raw.player_id}:${folderId}`;
            const existing = records.get(key);
            if (!existing || ((_a = raw.best_score) !== null && _a !== void 0 ? _a : 0) > ((_b = existing.best_score) !== null && _b !== void 0 ? _b : 0)) {
                records.set(key, Object.assign(Object.assign({}, raw), { folder_id: folderId, 
                    // The party stored in this row produced the retained best
                    // score, so expose that score alongside it after migration.
                    previous_score: raw.best_score }));
            }
        }
        db.prepare(`DELETE FROM players_carnival_event_records WHERE event_id = ?`).run(eventId);
        const insert = db.prepare(`
        INSERT INTO players_carnival_event_records (
            player_id, event_id, folder_id, best_score, previous_score,
            previous_character_ids, previous_unison_character_ids
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const record of records.values()) {
            insert.run(record.player_id, record.event_id, record.folder_id, record.best_score, record.previous_score, record.previous_character_ids, record.previous_unison_character_ids);
        }
        db.prepare(`
        INSERT INTO carnival_event_folder_migrations (event_id, migrated_at)
        VALUES (?, ?)
        `).run(eventId, Date.now());
    });
    // Mark only after the coordinator reports a successful commit. If a disk
    // or locking error aborts the transaction, the next request must retry.
    migratedEvents.add(eventId);
}
exports.migrateCarnivalEventFolderRecordsSync = migrateCarnivalEventFolderRecordsSync;
function upsertPlayerCarnivalEventRecordSync(playerId, eventId, folderId, score, characterIds, unisonCharacterIds) {
    const db = (0, db_1.getDb)();
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "event", playerId, operation: "upsert_carnival_event_record" }, () => {
        var _a, _b, _c, _d;
        const records = getPlayerCarnivalEventRecordsSync(playerId, eventId);
        const existing = (_a = records.find(record => record.folderId === folderId)) !== null && _a !== void 0 ? _a : null;
        // A character can contribute to only one Haniwa folder at a time.
        // The client warns about this before battle, but the server must be
        // authoritative because a modified or stale client can still submit a
        // conflicting result. Main and unison slots share the same lock.
        const attemptedCharacterIds = new Set([...characterIds, ...unisonCharacterIds]
            .filter((id) => id !== null && Number.isInteger(id) && id > 0));
        const conflictingFolderIds = [];
        if (attemptedCharacterIds.size > 0) {
            for (const record of records) {
                if (record.folderId === folderId)
                    continue;
                const recordedCharacterIds = [
                    ...((_b = record.previousCharacterIds) !== null && _b !== void 0 ? _b : []),
                    ...((_c = record.previousUnisonCharacterIds) !== null && _c !== void 0 ? _c : []),
                ];
                if (recordedCharacterIds.some(id => id !== null && id > 0 && attemptedCharacterIds.has(id))) {
                    conflictingFolderIds.push(record.folderId);
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
        `);
        for (const conflictingFolderId of conflictingFolderIds) {
            resetRecord.run(playerId, eventId, conflictingFolderId);
        }
        // Replaying a folder with a lower score must not overwrite that
        // folder's retained high score or the party which achieved it.
        const isNewBest = !existing || score > ((_d = existing.bestScore) !== null && _d !== void 0 ? _d : 0);
        if (!isNewBest && existing) {
            if (conflictingFolderIds.length > 0) {
                console.log(`[CARNIVAL] reset conflicting folders player=${playerId} event=${eventId} ` +
                    `current=${folderId} reset=${JSON.stringify(conflictingFolderIds)}`);
            }
            return existing;
        }
        const bestScore = score;
        db.prepare(`
        INSERT INTO players_carnival_event_records (player_id, event_id, folder_id, best_score, previous_score, previous_character_ids, previous_unison_character_ids)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id, event_id, folder_id) DO UPDATE SET
            best_score = excluded.best_score,
            previous_score = excluded.previous_score,
            previous_character_ids = excluded.previous_character_ids,
            previous_unison_character_ids = excluded.previous_unison_character_ids
        `).run(playerId, eventId, folderId, bestScore, bestScore, (0, utils_1.serializeNumberList)(characterIds), (0, utils_1.serializeNumberList)(unisonCharacterIds));
        if (conflictingFolderIds.length > 0) {
            console.log(`[CARNIVAL] reset conflicting folders player=${playerId} event=${eventId} ` +
                `current=${folderId} reset=${JSON.stringify(conflictingFolderIds)}`);
        }
        return {
            eventId,
            folderId,
            bestScore,
            previousScore: bestScore,
            previousCharacterIds: characterIds,
            previousUnisonCharacterIds: unisonCharacterIds,
        };
    });
}
exports.upsertPlayerCarnivalEventRecordSync = upsertPlayerCarnivalEventRecordSync;
