"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePlayerProfileSettingsSync = exports.getPlayerProfileSettingsSync = exports.updatePlayerOptionsInTransactionSync = exports.updatePlayerOptionsSync = exports.updatePlayerOptionSync = exports.getPlayerOptionSync = exports.getPlayerOptionsSync = exports.insertPlayerOptionsSync = exports.insertPlayerOptionSync = void 0;
const db_1 = require("../db");
const utils_1 = require("../utils");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const cached_statement_1 = require("../../lib/cached-statement");
const PROFILE_SETTING_KEYS = {
    showOpenedManaBoardSecondCount: "profile.show_opened_mana_board_second_count",
    showOwnedCharacterCount: "profile.show_owned_character_count",
    showOwnedDegreeCount: "profile.show_owned_degree_count",
};
const DEFAULT_PROFILE_SETTINGS = {
    showOpenedManaBoardSecondCount: false,
    showOwnedCharacterCount: true,
    showOwnedDegreeCount: true,
};
function isClientOptionKey(key) {
    return !key.startsWith("profile.");
}
/**
 * Inserts a value for a player option.
 *
 * @param playerId The ID of the player.
 * @param key The key of the option.
 * @param value The value of the option
 */
function insertPlayerOptionSync(playerId, key, value) {
    const db = (0, db_1.getDb)();
    db.prepare(`
    INSERT INTO players_options (key, value, player_id)
    VALUES (?, ?, ?)
    `).run(key, (0, utils_1.serializeBoolean)(value), playerId);
}
exports.insertPlayerOptionSync = insertPlayerOptionSync;
/**
 * Batch inserts a record of options into the database.
 *
 * @param playerId The ID of the player that these options belong to.
 * @param options The record of options to insert.
 */
function insertPlayerOptionsSync(playerId, options) {
    const db = (0, db_1.getDb)();
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "insert_player_options" }, () => {
        for (const [key, value] of Object.entries(options)) {
            if (!isClientOptionKey(key))
                continue;
            insertPlayerOptionSync(playerId, key, value);
        }
    });
}
exports.insertPlayerOptionsSync = insertPlayerOptionsSync;
/**
 * Gets all of the options that a player has saved.
 *
 * @param playerId The ID of the player.
 * @returns A record of options.
 */
function getPlayerOptionsSync(playerId) {
    const db = (0, db_1.getDb)();
    const rawOptions = (0, cached_statement_1.cachedStatement)(db, `
        SELECT key, value
        FROM players_options
        WHERE player_id = ?
          AND key NOT LIKE 'profile.%'
    `).all(playerId);
    const result = {};
    for (const rawOption of rawOptions) {
        result[rawOption.key] = (0, utils_1.deserializeBoolean)(rawOption.value);
    }
    return result;
}
exports.getPlayerOptionsSync = getPlayerOptionsSync;
/**
 * Gets one player option without materializing the full option record.
 */
function getPlayerOptionSync(playerId, key, defaultValue = false) {
    const db = (0, db_1.getDb)();
    const rawOption = db.prepare(`
    SELECT key, value
    FROM players_options
    WHERE player_id = ? AND key = ?
    `).get(playerId, key);
    return rawOption === undefined ? defaultValue : (0, utils_1.deserializeBoolean)(rawOption.value);
}
exports.getPlayerOptionSync = getPlayerOptionSync;
/**
 * Updates the value of a player option.
 *
 * @param playerId The ID of the player to update the option of.
 * @param key The key of the option to update.
 * @param value The new value.
 */
function updatePlayerOptionSync(playerId, key, value) {
    const db = (0, db_1.getDb)();
    db.prepare(`
    UPDATE players_options
    SET value = ?
    WHERE key = ? AND player_id = ?
    `).run((0, utils_1.serializeBoolean)(value), key, playerId);
}
exports.updatePlayerOptionSync = updatePlayerOptionSync;
/**
 * Batch updates a player's options.
 *
 * @param playerId The ID of the player to update the options of.
 * @param options A record of options to update the values of.
 */
function updatePlayerOptionsSync(playerId, options) {
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "update_player_options" }, () => updatePlayerOptionsInTransactionSync(playerId, options));
}
exports.updatePlayerOptionsSync = updatePlayerOptionsSync;
/** The caller must roll back its transaction if any option or AUTO update fails. */
function updatePlayerOptionsInTransactionSync(playerId, options) {
    const db = (0, db_1.getDb)();
    if (!db.inTransaction)
        throw new Error("Player option updates require a caller-owned transaction.");
    const entries = Object.entries(options).filter(([key]) => isClientOptionKey(key));
    if (entries.length === 0)
        return;
    const upsert = db.prepare(`
        INSERT INTO players_options (key, value, player_id) VALUES (?, ?, ?)
        ON CONFLICT(key, player_id) DO UPDATE SET value = excluded.value
        WHERE players_options.value IS NOT excluded.value
    `);
    for (const [key, value] of entries) {
        upsert.run(key, (0, utils_1.serializeBoolean)(value), playerId);
    }
}
exports.updatePlayerOptionsInTransactionSync = updatePlayerOptionsInTransactionSync;
function getPlayerProfileSettingsSync(playerId) {
    var _a, _b, _c;
    const keys = Object.values(PROFILE_SETTING_KEYS);
    const rows = (0, db_1.getDb)().prepare(`
        SELECT key, value
        FROM players_options
        WHERE player_id = ? AND key IN (?, ?, ?)
    `).all(playerId, ...keys);
    const stored = new Map(rows.map(row => [row.key, (0, utils_1.deserializeBoolean)(row.value)]));
    return {
        showOpenedManaBoardSecondCount: (_a = stored.get(PROFILE_SETTING_KEYS.showOpenedManaBoardSecondCount)) !== null && _a !== void 0 ? _a : DEFAULT_PROFILE_SETTINGS.showOpenedManaBoardSecondCount,
        showOwnedCharacterCount: (_b = stored.get(PROFILE_SETTING_KEYS.showOwnedCharacterCount)) !== null && _b !== void 0 ? _b : DEFAULT_PROFILE_SETTINGS.showOwnedCharacterCount,
        showOwnedDegreeCount: (_c = stored.get(PROFILE_SETTING_KEYS.showOwnedDegreeCount)) !== null && _c !== void 0 ? _c : DEFAULT_PROFILE_SETTINGS.showOwnedDegreeCount,
    };
}
exports.getPlayerProfileSettingsSync = getPlayerProfileSettingsSync;
function updatePlayerProfileSettingsSync(playerId, settings) {
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "update_player_profile_settings" }, () => {
        const upsert = (0, db_1.getDb)().prepare(`
            INSERT INTO players_options (key, value, player_id)
            VALUES (?, ?, ?)
            ON CONFLICT(key, player_id) DO UPDATE SET value = excluded.value
        `);
        for (const [property, value] of Object.entries(settings)) {
            upsert.run(PROFILE_SETTING_KEYS[property], (0, utils_1.serializeBoolean)(value), playerId);
        }
    });
    return getPlayerProfileSettingsSync(playerId);
}
exports.updatePlayerProfileSettingsSync = updatePlayerProfileSettingsSync;
