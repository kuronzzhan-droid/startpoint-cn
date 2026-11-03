"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.countEquippedAbilitySoulSlotsSync = exports.countAbilitySoulUsedInPartiesSync = exports.updatePlayerPartyGroupSync = exports.updatePlayerPartySync = exports.ensurePlayerPartyGroupListSync = exports.insertPlayerPartyGroupListSync = exports.findValidNormalPartySlotSync = exports.isValidNormalPartySlotSync = exports.getPlayerPartyGroupListSync = exports.getFirstPlayerPartyDisplaySelectionsSync = void 0;
const load_snapshot_1 = require("../readers/load-snapshot");
const cached_statement_1 = require("../../lib/cached-statement");
const db_1 = require("../db");
const types_1 = require("../types");
const utils_1 = require("../utils");
const party_group_persistence_1 = require("../../lib/party-group-persistence");
const game_logging_1 = require("../../lib/game-logging");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const special_event_parties_1 = require("../../lib/special-event-parties");
const party_limit_1 = require("../../lib/weapon-riven/party-limit");
const PARTY_DISPLAY_BATCH_SIZE = 900;
function resolveEvolutionImgLevel(evolutionLevel, illustrationSettings) {
    if (evolutionLevel === null)
        return null;
    if (illustrationSettings !== null) {
        try {
            const parsed = JSON.parse(illustrationSettings);
            const selected = Array.isArray(parsed) ? parsed[0] : null;
            if (Number.isSafeInteger(selected))
                return Number(selected);
        }
        catch (_a) {
            // Damaged presentation settings use the owned character's evolution.
        }
    }
    return evolutionLevel;
}
/**
 * Loads the first explicitly saved party for many players in bounded batches.
 * Missing, stale, or unowned slots remain null for the caller's presentation
 * fallback. It deliberately does not inherit another party category.
 */
function getFirstPlayerPartyDisplaySelectionsSync(playerIds, category) {
    const uniquePlayerIds = [...new Set(playerIds)].filter(playerId => Number.isSafeInteger(playerId) && playerId > 0);
    const selections = new Map();
    for (let offset = 0; offset < uniquePlayerIds.length; offset += PARTY_DISPLAY_BATCH_SIZE) {
        const batch = uniquePlayerIds.slice(offset, offset + PARTY_DISPLAY_BATCH_SIZE);
        const placeholders = batch.map(() => "?").join(", ");
        const rows = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
            WITH ordered_parties AS (
                SELECT player_id, character_id_1, character_id_2, character_id_3,
                    ROW_NUMBER() OVER (
                        PARTITION BY player_id ORDER BY group_id ASC, slot ASC
                    ) AS party_number
                FROM players_parties
                WHERE category = ? AND player_id IN (${placeholders})
            )
            SELECT party.player_id,
                character_1.id AS character_id_1,
                character_2.id AS character_id_2,
                character_3.id AS character_id_3,
                character_1.evolution_level AS evolution_level_1,
                character_2.evolution_level AS evolution_level_2,
                character_3.evolution_level AS evolution_level_3,
                character_1.illustration_settings AS illustration_settings_1,
                character_2.illustration_settings AS illustration_settings_2,
                character_3.illustration_settings AS illustration_settings_3
            FROM ordered_parties party
            LEFT JOIN players_characters character_1
                ON character_1.player_id = party.player_id
                AND character_1.id = party.character_id_1
            LEFT JOIN players_characters character_2
                ON character_2.player_id = party.player_id
                AND character_2.id = party.character_id_2
            LEFT JOIN players_characters character_3
                ON character_3.player_id = party.player_id
                AND character_3.id = party.character_id_3
            WHERE party.party_number = 1
        `).all(category, ...batch);
        for (const row of rows) {
            selections.set(row.player_id, {
                characterIds: [
                    row.character_id_1,
                    row.character_id_2,
                    row.character_id_3,
                ],
                evolutionImgLevels: [
                    resolveEvolutionImgLevel(row.evolution_level_1, row.illustration_settings_1),
                    resolveEvolutionImgLevel(row.evolution_level_2, row.illustration_settings_2),
                    resolveEvolutionImgLevel(row.evolution_level_3, row.illustration_settings_3),
                ],
            });
        }
    }
    return selections;
}
exports.getFirstPlayerPartyDisplaySelectionsSync = getFirstPlayerPartyDisplaySelectionsSync;
function getPlayerPartyGroupListSync(playerId, category = types_1.PartyCategory.NORMAL) {
    return (0, load_snapshot_1.readPlayerPartyGroupListSync)((0, db_1.getDb)(), playerId, category);
}
exports.getPlayerPartyGroupListSync = getPlayerPartyGroupListSync;
/**
 * The player row's party_slot is the legacy home/normal-party pointer.  Event
 * party categories reuse the same global group/slot numbers, so callers must
 * validate this pointer against NORMAL instead of treating its numeric range
 * as sufficient.
 */
function isValidNormalPartySlotSync(playerId, partySlot) {
    const parsed = (0, special_event_parties_1.parseGlobalPartyId)(partySlot);
    if (parsed === null)
        return false;
    const row = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT 1 AS valid
        FROM players_parties party
        JOIN players_party_groups party_group
            ON party_group.player_id = party.player_id
            AND party_group.id = party.group_id
            AND party_group.category = party.category
        JOIN players_characters character
            ON character.player_id = party.player_id
            AND character.id = party.character_id_1
        WHERE party.player_id = ? AND party.category = ?
            AND party.group_id = ? AND party.slot = ?
        LIMIT 1
    `).get(playerId, types_1.PartyCategory.NORMAL, parsed.groupId, parsed.slot);
    return (row === null || row === void 0 ? void 0 : row.valid) === 1;
}
exports.isValidNormalPartySlotSync = isValidNormalPartySlotSync;
/** Resolve a safe normal-party pointer, preferring the caller's selection. */
function findValidNormalPartySlotSync(playerId, preferredPartySlot) {
    if (preferredPartySlot !== undefined
        && isValidNormalPartySlotSync(playerId, preferredPartySlot)) {
        return preferredPartySlot;
    }
    const row = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT party.group_id, party.slot
        FROM players_parties party
        JOIN players_party_groups party_group
            ON party_group.player_id = party.player_id
            AND party_group.id = party.group_id
            AND party_group.category = party.category
        JOIN players_characters character
            ON character.player_id = party.player_id
            AND character.id = party.character_id_1
        WHERE party.player_id = ? AND party.category = ?
        ORDER BY party.group_id ASC, party.slot ASC
        LIMIT 1
    `).get(playerId, types_1.PartyCategory.NORMAL);
    if (!row)
        return null;
    return (Number(row.group_id) - 1) * 10 + Number(row.slot);
}
exports.findValidNormalPartySlotSync = findValidNormalPartySlotSync;
function insertPlayerPartySync(playerId, slot, groupId, party) {
    var _a, _b;
    const db = (0, db_1.getDb)();
    const souls = (0, party_limit_1.limitWeaponRivenPartySouls)(party.abilitySoulIds);
    (0, cached_statement_1.cachedStatement)(db, `
    INSERT INTO players_parties (slot, name, character_id_1, character_id_2, character_id_3,
        unison_character_1, unison_character_2, unison_character_3, equipment_1, equipment_2,
        equipment_3, ability_soul_1, ability_soul_2, ability_soul_3, edited, player_id, group_id, category,
        current_battle_power, before_battle_power)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(Number(slot), party.name, party.characterIds[0] || null, party.characterIds[1] || null, party.characterIds[2] || null, party.unisonCharacterIds[0] || null, party.unisonCharacterIds[1] || null, party.unisonCharacterIds[2] || null, party.equipmentIds[0] || null, party.equipmentIds[1] || null, party.equipmentIds[2] || null, souls[0] || null, souls[1] || null, souls[2] || null, (0, utils_1.serializeBoolean)(party.edited), playerId, Number(groupId), party.category, (_a = party.currentBattlePower) !== null && _a !== void 0 ? _a : 0, (_b = party.beforeBattlePower) !== null && _b !== void 0 ? _b : 0);
}
function insertPlayerPartyGroupSync(playerId, groupId, group) {
    const db = (0, db_1.getDb)();
    (0, cached_statement_1.cachedStatement)(db, `
    INSERT INTO players_party_groups (id, color_id, player_id, category)
    VALUES (?, ?, ?, ?)
    `).run(Number(groupId), group.colorId, playerId, group.category);
    for (const [slot, party] of Object.entries(group.list)) {
        insertPlayerPartySync(playerId, slot, groupId, party);
    }
}
function insertPlayerPartyGroupListSync(playerId, groups) {
    const db = (0, db_1.getDb)();
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "insert_player_party_groups" }, () => {
        for (const [groupId, group] of Object.entries(groups)) {
            insertPlayerPartyGroupSync(playerId, groupId, group);
        }
    });
}
exports.insertPlayerPartyGroupListSync = insertPlayerPartyGroupListSync;
function ensurePlayerPartyGroupListSync(playerId, groups) {
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "ensure_player_party_groups" }, () => {
        (0, party_group_persistence_1.insertMissingPartyGroupListSync)((0, db_1.getDb)(), playerId, groups);
    });
}
exports.ensurePlayerPartyGroupListSync = ensurePlayerPartyGroupListSync;
function updatePlayerPartySync(playerId, slot, party, groupId = 1) {
    var _a, _b;
    const db = (0, db_1.getDb)();
    const souls = (0, party_limit_1.limitWeaponRivenPartySouls)(party.abilitySoulIds);
    // Upsert: try update first, insert if not exists
    const result = (0, cached_statement_1.cachedStatement)(db, `
    UPDATE players_parties SET name = ?, character_id_1 = ?, character_id_2 = ?, character_id_3 = ?,
        unison_character_1 = ?, unison_character_2 = ?, unison_character_3 = ?,
        equipment_1 = ?, equipment_2 = ?, equipment_3 = ?,
        ability_soul_1 = ?, ability_soul_2 = ?, ability_soul_3 = ?, edited = ?,
        current_battle_power = ?, before_battle_power = ?
    WHERE slot = ? AND player_id = ? AND group_id = ? AND category = ?
    `).run(party.name, party.characterIds[0], party.characterIds[1], party.characterIds[2], party.unisonCharacterIds[0], party.unisonCharacterIds[1], party.unisonCharacterIds[2], party.equipmentIds[0], party.equipmentIds[1], party.equipmentIds[2], souls[0], souls[1], souls[2], (0, utils_1.serializeBoolean)(party.edited), (_a = party.currentBattlePower) !== null && _a !== void 0 ? _a : 0, (_b = party.beforeBattlePower) !== null && _b !== void 0 ? _b : 0, slot, playerId, groupId, party.category);
    if (result.changes === 0) {
        (0, game_logging_1.gameVerboseLog)(() => `[PARTY-DB] insert: player=${playerId} group=${groupId} slot=${slot} name="${party.name}" chars=${party.characterIds.filter(Boolean).length}`);
        // Ensure group exists
        const groupExists = (0, cached_statement_1.cachedStatement)(db, 'SELECT id FROM players_party_groups WHERE id = ? AND player_id = ? AND category = ?').get(groupId, playerId, party.category);
        if (!groupExists) {
            (0, game_logging_1.gameVerboseLog)(() => `[PARTY-DB] new group: player=${playerId} id=${groupId}`);
            (0, cached_statement_1.cachedStatement)(db, 'INSERT INTO players_party_groups (id, color_id, player_id, category) VALUES (?, ?, ?, ?)').run(groupId, 15, playerId, party.category);
        }
        insertPlayerPartySync(playerId, slot, groupId, party);
    }
    else {
        (0, game_logging_1.gameVerboseLog)(() => `[PARTY-DB] update: player=${playerId} group=${groupId} slot=${slot} name="${party.name}" chars=${party.characterIds.filter(Boolean).length}`);
    }
}
exports.updatePlayerPartySync = updatePlayerPartySync;
function updatePlayerPartyGroupSync(playerId, groupId, colorId, category = types_1.PartyCategory.NORMAL) {
    const db = (0, db_1.getDb)();
    (0, cached_statement_1.cachedStatement)(db, `
    UPDATE players_party_groups SET color_id = ?
    WHERE id = ? AND player_id = ? AND category = ?
    `).run(colorId, groupId, playerId, category);
}
exports.updatePlayerPartyGroupSync = updatePlayerPartyGroupSync;
/**
 * Count how many parties currently have the given ability soul equipped.
 * Used by /item/sell to prevent selling souls that are in use.
 */
function countAbilitySoulUsedInPartiesSync(playerId, abilitySoulId) {
    var _a;
    const db = (0, db_1.getDb)();
    const row = (0, cached_statement_1.cachedStatement)(db, `
    SELECT COUNT(*) AS cnt FROM players_parties
    WHERE player_id = ?
    AND (ability_soul_1 = ? OR ability_soul_2 = ? OR ability_soul_3 = ?)
    `).get(playerId, abilitySoulId, abilitySoulId, abilitySoulId);
    return (_a = row === null || row === void 0 ? void 0 : row.cnt) !== null && _a !== void 0 ? _a : 0;
}
exports.countAbilitySoulUsedInPartiesSync = countAbilitySoulUsedInPartiesSync;
/** Counts occupied ability-soul slots, used as a conservative historical floor. */
function countEquippedAbilitySoulSlotsSync(playerId) {
    const row = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT
        SUM(CASE WHEN ability_soul_1 IS NOT NULL THEN 1 ELSE 0 END)
        + SUM(CASE WHEN ability_soul_2 IS NOT NULL THEN 1 ELSE 0 END)
        + SUM(CASE WHEN ability_soul_3 IS NOT NULL THEN 1 ELSE 0 END) AS cnt
    FROM players_parties
    WHERE player_id = ?
    `).get(playerId);
    return Number(row === null || row === void 0 ? void 0 : row.cnt) || 0;
}
exports.countEquippedAbilitySoulSlotsSync = countEquippedAbilitySoulSlotsSync;
