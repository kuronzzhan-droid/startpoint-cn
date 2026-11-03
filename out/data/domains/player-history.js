"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePlayerHistorySettingsSync = exports.getPlayerHistorySettingsSync = void 0;
const db_1 = require("../db");
function parseCharacterIds(value, fallback) {
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)
            && parsed.length === 3
            && parsed.every(id => id === null || (Number.isSafeInteger(id) && id > 0))) {
            return parsed;
        }
    }
    catch (_a) {
        // Damaged presentation data falls back to the current favorite party.
    }
    return [...fallback];
}
function parseTopicVisibility(value) {
    try {
        const parsed = JSON.parse(value);
        if (parsed !== null
            && typeof parsed === "object"
            && !Array.isArray(parsed)
            && Object.entries(parsed).every(([key, visible]) => /^\d+$/.test(key) && typeof visible === "boolean")) {
            return parsed;
        }
    }
    catch (_a) {
        // Damaged presentation data is equivalent to using master defaults.
    }
    return {};
}
function getPlayerHistorySettingsSync(playerId, defaults) {
    const row = (0, db_1.getDb)().prepare(`
        SELECT player_history_id, background_card_id, degree_id,
               character_ids, unison_character_ids, topic_visibility
        FROM players_player_history_settings
        WHERE player_id = ?
    `).get(playerId);
    if (!row || row.player_history_id !== defaults.playerHistoryId) {
        return Object.assign(Object.assign({}, defaults), { characterIds: [...defaults.characterIds], unisonCharacterIds: [...defaults.unisonCharacterIds], topicVisibility: Object.assign({}, defaults.topicVisibility) });
    }
    return {
        playerHistoryId: row.player_history_id,
        backgroundCardId: row.background_card_id,
        degreeId: row.degree_id,
        characterIds: parseCharacterIds(row.character_ids, defaults.characterIds),
        unisonCharacterIds: parseCharacterIds(row.unison_character_ids, defaults.unisonCharacterIds),
        topicVisibility: parseTopicVisibility(row.topic_visibility),
    };
}
exports.getPlayerHistorySettingsSync = getPlayerHistorySettingsSync;
function updatePlayerHistorySettingsSync(playerId, defaults, update) {
    const current = getPlayerHistorySettingsSync(playerId, defaults);
    const next = Object.assign(Object.assign(Object.assign({}, current), update), { topicVisibility: update.topicVisibility === undefined
            ? current.topicVisibility
            : Object.assign(Object.assign({}, current.topicVisibility), update.topicVisibility) });
    (0, db_1.getDb)().prepare(`
        INSERT INTO players_player_history_settings (
            player_id, player_history_id, background_card_id, degree_id,
            character_ids, unison_character_ids, topic_visibility
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id) DO UPDATE SET
            player_history_id = excluded.player_history_id,
            background_card_id = excluded.background_card_id,
            degree_id = excluded.degree_id,
            character_ids = excluded.character_ids,
            unison_character_ids = excluded.unison_character_ids,
            topic_visibility = excluded.topic_visibility
    `).run(playerId, next.playerHistoryId, next.backgroundCardId, next.degreeId, JSON.stringify(next.characterIds), JSON.stringify(next.unisonCharacterIds), JSON.stringify(next.topicVisibility));
    return next;
}
exports.updatePlayerHistorySettingsSync = updatePlayerHistorySettingsSync;
