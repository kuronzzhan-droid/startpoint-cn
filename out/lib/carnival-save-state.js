"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertCarnivalSaveStateSync = exports.getCarnivalSaveStateSync = void 0;
function deserializeNullableNumberList(value) {
    if (value === null)
        return null;
    return value.split(",").map(part => part === "" ? null : Number(part));
}
function serializeNullableNumberList(value) {
    return value === null ? null : value.map(entry => entry !== null && entry !== void 0 ? entry : "").join(",");
}
function getCarnivalSaveStateSync(db, playerId) {
    const records = db.prepare(`
        SELECT event_id, folder_id, best_score, previous_score,
            previous_character_ids, previous_unison_character_ids
        FROM players_carnival_event_records
        WHERE player_id = ?
        ORDER BY event_id, folder_id
    `).all(playerId);
    const rewardClaims = db.prepare(`
        SELECT event_id, reward_id
        FROM players_carnival_event_rewards
        WHERE player_id = ?
        ORDER BY event_id, reward_id
    `).all(playerId);
    const degrees = db.prepare(`
        SELECT degree_id
        FROM players_degrees
        WHERE player_id = ?
        ORDER BY degree_id
    `).all(playerId);
    return {
        carnivalEventRecords: records.map(record => ({
            eventId: record.event_id,
            folderId: record.folder_id,
            bestScore: record.best_score,
            previousScore: record.previous_score,
            previousCharacterIds: deserializeNullableNumberList(record.previous_character_ids),
            previousUnisonCharacterIds: deserializeNullableNumberList(record.previous_unison_character_ids),
        })),
        carnivalRewardClaims: rewardClaims.map(claim => ({
            eventId: claim.event_id,
            rewardId: claim.reward_id,
        })),
        degreeIds: degrees.map(degree => degree.degree_id),
    };
}
exports.getCarnivalSaveStateSync = getCarnivalSaveStateSync;
function insertCarnivalSaveStateSync(db, playerId, state) {
    const insertRecord = db.prepare(`
        INSERT INTO players_carnival_event_records
            (player_id, event_id, folder_id, best_score, previous_score,
                previous_character_ids, previous_unison_character_ids)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertClaim = db.prepare(`
        INSERT INTO players_carnival_event_rewards (player_id, event_id, reward_id)
        VALUES (?, ?, ?)
    `);
    const insertDegree = db.prepare(`
        INSERT INTO players_degrees (player_id, degree_id)
        VALUES (?, ?)
    `);
    db.transaction(() => {
        var _a, _b, _c;
        for (const record of (_a = state.carnivalEventRecords) !== null && _a !== void 0 ? _a : []) {
            insertRecord.run(playerId, record.eventId, record.folderId, record.bestScore, record.previousScore, serializeNullableNumberList(record.previousCharacterIds), serializeNullableNumberList(record.previousUnisonCharacterIds));
        }
        for (const claim of (_b = state.carnivalRewardClaims) !== null && _b !== void 0 ? _b : []) {
            insertClaim.run(playerId, claim.eventId, claim.rewardId);
        }
        for (const degreeId of (_c = state.degreeIds) !== null && _c !== void 0 ? _c : [])
            insertDegree.run(playerId, degreeId);
    })();
}
exports.insertCarnivalSaveStateSync = insertCarnivalSaveStateSync;
