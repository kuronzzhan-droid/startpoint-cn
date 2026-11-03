"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePlayerCharacterManaNodeAwakeLevelSync = exports.getPlayerCharactersManaNodeAwakeLevelsSync = exports.insertPlayerCharactersManaNodesSync = exports.insertPlayerCharacterManaNodesSync = exports.hasPlayerUnlockedCharacterManaNodeSync = exports.getPlayerCharacterManaNodesSync = exports.getPlayerCharactersManaNodesByIdsSync = exports.getPlayerCharacterManaNodeAwakeLevelsSync = exports.getPlayerCompletedManaBoardCharacterIdsSync = exports.countPlayerReceivedBondTokensSync = exports.countPlayerCharacterManaNodesSync = exports.getPlayerCharacterMissionStatsSync = exports.getPlayerCharactersManaNodesSync = exports.updatePlayerCharacterSync = exports.insertPlayerCharactersSync = exports.insertDefaultPlayerCharacterSync = exports.insertPlayerCharacterSync = exports.updatePlayerCharacterBondTokenSync = exports.insertPlayerCharacterBondTokenSync = exports.getPlayerCharacterFavorFactsSync = exports.getPlayerCharactersByIdsSync = exports.getPlayerCharactersSync = exports.getPlayerCharacterMissionFactsSync = exports.getPlayerCharacterSync = exports.playerOwnsCharacterSync = void 0;
const load_snapshot_1 = require("../readers/load-snapshot");
const db_1 = require("../db");
const utils_1 = require("../utils");
const assets_1 = require("../../lib/assets");
const cached_statement_1 = require("../../lib/cached-statement");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
function prepareCharacterMissionQuery(sql) {
    return (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), sql);
}
/**
 * Converts a RawPlayerCharacterBondToken into a PlayerCharacterBondToken
 *
 * @param rawBondToken The raw bond token to build/deserialize
 * @returns The built/deserialized PlayerCharacterBondToken
 */
/**
 * Builds a PlayerCharacterExBoost object.
 *
 * @param exBoostStatusId The ex boost's status ID
 * @param exBoostAbilityIdList The serialized string representing the ex boost's ability id list.
 * @returns A PlayerCharacterExBoost object or undefined.
 */
/**
 * Checks whether a player owns a given character or not.
 *
 * @param playerId The ID of the player.
 * @param characterId The ID of the character.
 * @returns A boolean, stating whether the player owns the character.
 */
function playerOwnsCharacterSync(playerId, characterId) {
    return (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT id
    FROM players_characters
    WHERE player_id = ? AND id = ?
    `).get(playerId, characterId) !== undefined;
}
exports.playerOwnsCharacterSync = playerOwnsCharacterSync;
/**
 * Gets a singular character from a player's data.
 *
 * @param playerId The ID of the player.
 * @param characterId The ID of the character.
 * @returns The PlayerCharacter or null if it doesn't exist.
 */
function getPlayerCharacterSync(playerId, characterId) {
    const rawCharacter = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT id, entry_count, evolution_level, over_limit_step, protection,
        join_time, update_time, exp, stack, mana_board_index, ex_boost_status_id,
        ex_boost_ability_id_list, illustration_settings
    FROM players_characters
    WHERE player_id = ? AND id = ?
    `).get(playerId, characterId);
    if (rawCharacter === undefined)
        return null;
    // get bond tokens
    const rawBondTokens = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT mana_board_index, status, character_id
    FROM players_characters_bond_tokens
    WHERE player_id = ? AND character_id = ?
    ORDER BY mana_board_index
    `).all(playerId, characterId);
    return (0, load_snapshot_1.buildPlayerCharacter)(rawCharacter, rawBondTokens.map(raw => (0, load_snapshot_1.buildCharacterBondToken)(raw)));
}
exports.getPlayerCharacterSync = getPlayerCharacterSync;
/** Facts used by mission computers; no dates, cosmetic state or boost payloads. */
function getPlayerCharacterMissionFactsSync(playerId) {
    var _a;
    const db = (0, db_1.getDb)();
    const rows = (0, cached_statement_1.cachedStatement)(db, `
        SELECT id, exp, evolution_level, over_limit_step
        FROM players_characters WHERE player_id = ?
    `).all(playerId);
    const result = {};
    for (const row of rows) {
        result[String(row.id)] = {
            exp: row.exp, evolutionLevel: row.evolution_level,
            overLimitStep: row.over_limit_step, bondTokenList: [],
        };
    }
    const tokens = (0, cached_statement_1.cachedStatement)(db, `
        SELECT mana_board_index, status, character_id
        FROM players_characters_bond_tokens WHERE player_id = ?
        ORDER BY character_id, mana_board_index
    `).all(playerId);
    for (const token of tokens)
        (_a = result[String(token.character_id)]) === null || _a === void 0 ? void 0 : _a.bondTokenList.push((0, load_snapshot_1.buildCharacterBondToken)(token));
    return result;
}
exports.getPlayerCharacterMissionFactsSync = getPlayerCharacterMissionFactsSync;
function getPlayerCharactersSync(playerId) {
    return (0, load_snapshot_1.readPlayerCharactersSync)((0, db_1.getDb)(), playerId);
}
exports.getPlayerCharactersSync = getPlayerCharactersSync;
/** Retrieves only the requested owned characters with two bounded reads. */
function getPlayerCharactersByIdsSync(playerId, characterIds) {
    var _a, _b;
    const ids = [...new Set(characterIds)].filter(characterId => Number.isSafeInteger(characterId) && characterId > 0);
    if (ids.length === 0)
        return {};
    const placeholders = ids.map(() => "?").join(", ");
    const rawCharacters = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT id, entry_count, evolution_level, over_limit_step, protection,
        join_time, update_time, exp, stack, mana_board_index, ex_boost_status_id,
        ex_boost_ability_id_list, illustration_settings
    FROM players_characters
    WHERE player_id = ? AND id IN (${placeholders})
    `).all(playerId, ...ids);
    const rawBondTokens = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT mana_board_index, status, character_id
    FROM players_characters_bond_tokens
    WHERE player_id = ? AND character_id IN (${placeholders})
    ORDER BY character_id, mana_board_index
    `).all(playerId, ...ids);
    const bondBuckets = {};
    for (const rawBondToken of rawBondTokens) {
        const characterId = String(rawBondToken.character_id);
        const bucket = (_a = bondBuckets[characterId]) !== null && _a !== void 0 ? _a : [];
        bucket.push((0, load_snapshot_1.buildCharacterBondToken)(rawBondToken));
        bondBuckets[characterId] = bucket;
    }
    const result = {};
    for (const rawCharacter of rawCharacters) {
        const characterId = String(rawCharacter.id);
        result[characterId] = (0, load_snapshot_1.buildPlayerCharacter)(rawCharacter, (_b = bondBuckets[characterId]) !== null && _b !== void 0 ? _b : []);
    }
    return result;
}
exports.getPlayerCharactersByIdsSync = getPlayerCharactersByIdsSync;
/** Only EXP and received-token presence are needed by character favor titles. */
function getPlayerCharacterFavorFactsSync(playerId, characterIds) {
    const ids = [...new Set(characterIds)].filter(id => Number.isSafeInteger(id) && id > 0);
    const result = {};
    for (let offset = 0; offset < ids.length; offset += 400) {
        const chunk = ids.slice(offset, offset + 400);
        const rows = prepareCharacterMissionQuery(`
            SELECT owned.id, owned.exp, EXISTS (
                SELECT 1 FROM players_characters_bond_tokens AS token
                WHERE token.player_id = owned.player_id AND token.character_id = owned.id AND token.status >= 2
            ) AS received_bond
            FROM players_characters AS owned
            WHERE owned.player_id = ? AND owned.id IN (${chunk.map(() => "?").join(", ")})
        `).all(playerId, ...chunk);
        for (const row of rows)
            result[String(row.id)] = { exp: row.exp, hasReceivedBondToken: row.received_bond === 1 };
    }
    return result;
}
exports.getPlayerCharacterFavorFactsSync = getPlayerCharacterFavorFactsSync;
/**
 * Inserts a single character's bond token into a player's data.
 *
 * @param playerId The ID of the player.
 * @param characterId The ID of the character.
 * @param bondToken The bond token to insert.
 */
function insertPlayerCharacterBondTokenSync(playerId, characterId, bondToken) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_characters_bond_tokens (mana_board_index, status, player_id, character_id)
    VALUES (?, ?, ?, ?)
    `).run(bondToken.manaBoardIndex, bondToken.status, playerId, Number(characterId));
}
exports.insertPlayerCharacterBondTokenSync = insertPlayerCharacterBondTokenSync;
/**
 * Updates a player's character's bond token.
 *
 * @param playerId The ID of the player.
 * @param characterId The ID of the character.
 * @param bondToken The updated bondToken.
 */
function updatePlayerCharacterBondTokenSync(playerId, characterId, bondToken) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    UPDATE players_characters_bond_tokens
    SET status = ?
    WHERE player_id = ? AND character_id = ? AND mana_board_index = ?
    `).run(bondToken.status, playerId, Number(characterId), bondToken.manaBoardIndex);
}
exports.updatePlayerCharacterBondTokenSync = updatePlayerCharacterBondTokenSync;
/**
 * Inserts a single character into a player's inventory.
 *
 * @param playerId The ID of the player to add the character to.
 * @param characterId The ID of the character to add.
 * @param character The character data.
 */
function insertPlayerCharacterSync(playerId, characterId, character) {
    var _a, _b;
    // insert into characters table
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_characters (id, entry_count, evolution_level, over_limit_step,
        protection, join_time, update_time, exp, stack, mana_board_index, player_id,
        ex_boost_status_id, ex_boost_ability_id_list, illustration_settings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(Number(characterId), character.entryCount, character.evolutionLevel, character.overLimitStep, (0, utils_1.serializeBoolean)(character.protection), character.joinTime.toISOString(), character.updateTime.toISOString(), character.exp, character.stack, character.manaBoardIndex, playerId, ((_a = character.exBoost) === null || _a === void 0 ? void 0 : _a.statusId) === undefined ? null : character.exBoost.statusId, ((_b = character.exBoost) === null || _b === void 0 ? void 0 : _b.abilityIdList) === undefined ? null : (0, utils_1.serializeNumberList)(character.exBoost.abilityIdList), character.illustrationSettings === undefined ? null : (0, utils_1.serializeNumberList)(character.illustrationSettings));
    // insert mana board nodes
    for (const token of character.bondTokenList) {
        insertPlayerCharacterBondTokenSync(playerId, characterId, token);
    }
}
exports.insertPlayerCharacterSync = insertPlayerCharacterSync;
/**
 * Inserts a default single character into a player's inventory.
 *
 * @param playerId The ID of the player to add the character to.
 * @param characterId The ID of the character to add.
 */
function insertDefaultPlayerCharacterSync(playerId, characterId) {
    const dateNow = new Date();
    const bondTokenList = [
        {
            manaBoardIndex: 1,
            status: 0
        }
    ];
    const assetData = (0, assets_1.getCharacterDataSync)(characterId);
    if (assetData && assetData.skill_count > 3) {
        bondTokenList.push({
            manaBoardIndex: 2,
            status: 0
        });
    }
    insertPlayerCharacterSync(playerId, characterId, {
        entryCount: 1,
        evolutionLevel: 0,
        overLimitStep: 0,
        protection: false,
        joinTime: dateNow,
        updateTime: dateNow,
        exp: 0,
        stack: 0,
        manaBoardIndex: 1,
        bondTokenList: bondTokenList
    });
}
exports.insertDefaultPlayerCharacterSync = insertDefaultPlayerCharacterSync;
/**
 * Batch inserts a record of characters into a player's inventory.
 *
 * @param playerId The ID of the player.
 * @param characters The record of characters to insert.
 */
function insertPlayerCharactersSync(playerId, characters) {
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "insert_player_characters" }, () => {
        for (const [characterId, data] of Object.entries(characters)) {
            insertPlayerCharacterSync(playerId, characterId, data);
        }
    });
}
exports.insertPlayerCharactersSync = insertPlayerCharactersSync;
/**
 * Updates a single character within a player's data.
 *
 * @param playerId The ID of the player.
 * @param characterId The ID of the character.
 * @param character The partial data of the character to update.
 */
function updatePlayerCharacterSync(playerId, characterId, character) {
    const fieldMap = {
        'entryCount': 'entry_count',
        'evolutionLevel': 'evolution_level',
        'overLimitStep': 'over_limit_step',
        'protection': 'protection',
        'joinTime': 'join_time',
        'updateTime': 'update_time',
        'exp': 'exp',
        'stack': 'stack',
        'manaBoardIndex': 'mana_board_index'
    };
    // set the update time to now
    character.updateTime = new Date();
    const sets = [];
    const values = [];
    for (const key in character) {
        const value = character[key];
        const mapped = fieldMap[key];
        if (mapped && value !== undefined) {
            sets.push(`${mapped} = ?`);
            if (value instanceof Date) {
                values.push(value.toISOString());
            }
            else if (typeof (value) === "boolean") {
                values.push((0, utils_1.serializeBoolean)(value));
            }
            else {
                values.push(value);
            }
        }
    }
    const exBoost = character.exBoost;
    if (exBoost !== undefined) {
        sets.push('ex_boost_status_id = ?');
        sets.push('ex_boost_ability_id_list = ?');
        values.push(exBoost.statusId);
        values.push((0, utils_1.serializeNumberList)(exBoost.abilityIdList));
    }
    const illustration_settings = character.illustrationSettings;
    if (illustration_settings !== undefined) {
        sets.push('illustration_settings = ?');
        values.push((0, utils_1.serializeNumberList)(illustration_settings));
    }
    if (sets.length > 0)
        (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        UPDATE players_characters
        SET ${sets.join(', ')}
        WHERE id = ? AND player_id = ?
        `).run([...values, characterId, playerId]);
}
exports.updatePlayerCharacterSync = updatePlayerCharacterSync;
/**
 * Retrieves the mana node statuses of a player's characters.
 *
 * @param playerId The ID of the player.
 * @returns A record containing the statuses of the player's characters.
 */
function getPlayerCharactersManaNodesSync(playerId) {
    return (0, load_snapshot_1.readPlayerCharactersManaNodesSync)((0, db_1.getDb)(), playerId);
}
exports.getPlayerCharactersManaNodesSync = getPlayerCharactersManaNodesSync;
/** Scalar counts and an optional compact id list; no full character/node objects. */
function getPlayerCharacterMissionStatsSync(playerId, needs) {
    if (!needs.manaNodes && !needs.bondTokens && !needs.ownedCharacterIds) {
        return { manaNodeCount: 0, bondTokenCount: 0, ownedCharacterIds: [] };
    }
    const manaCount = needs.manaNodes
        ? "(SELECT COUNT(*) FROM players_characters_mana_nodes WHERE player_id = @playerId)" : "0";
    const bondCount = needs.bondTokens ? `(
        SELECT COUNT(*) FROM players_characters_bond_tokens AS token
        JOIN players_characters AS owned
          ON owned.player_id = token.player_id AND owned.id = token.character_id
        WHERE token.player_id = @playerId AND token.status >= 2
    )` : "0";
    const ownedIds = needs.ownedCharacterIds
        ? "(SELECT json_group_array(id) FROM players_characters WHERE player_id = @playerId)" : "'[]'";
    const row = prepareCharacterMissionQuery(`SELECT ${manaCount} AS mana_count, ${bondCount} AS bond_count, ${ownedIds} AS owned_ids`)
        .get({ playerId });
    return { manaNodeCount: row.mana_count, bondTokenCount: row.bond_count, ownedCharacterIds: JSON.parse(row.owned_ids) };
}
exports.getPlayerCharacterMissionStatsSync = getPlayerCharacterMissionStatsSync;
function countPlayerCharacterManaNodesSync(playerId) {
    return getPlayerCharacterMissionStatsSync(playerId, { manaNodes: true }).manaNodeCount;
}
exports.countPlayerCharacterManaNodesSync = countPlayerCharacterManaNodesSync;
function countPlayerReceivedBondTokensSync(playerId) {
    return getPlayerCharacterMissionStatsSync(playerId, { bondTokens: true }).bondTokenCount;
}
exports.countPlayerReceivedBondTokensSync = countPlayerReceivedBondTokensSync;
/**
 * Returns owned characters containing every required node. Extra or awakened
 * nodes do not substitute for missing requirements; empty boards never complete.
 */
function getPlayerCompletedManaBoardCharacterIdsSync(playerId, requiredNodes, ownedCharacterIds) {
    if (Object.keys(requiredNodes).length === 0)
        return new Set();
    // Small saves should not serialize or scan the entire master roster.
    // Keep only owned ids here; character details and individual nodes stay in SQLite.
    const ids = ownedCharacterIds !== null && ownedCharacterIds !== void 0 ? ownedCharacterIds : getPlayerCharacterMissionStatsSync(playerId, { ownedCharacterIds: true }).ownedCharacterIds;
    const boards = Object.fromEntries(ids.flatMap(id => {
        const nodes = requiredNodes[String(id)];
        return (nodes === null || nodes === void 0 ? void 0 : nodes.length) ? [[String(id), nodes]] : [];
    }));
    if (Object.keys(boards).length === 0)
        return new Set();
    // Keep board enumeration outermost; an ordinary JOIN can make SQLite
    // rescan every JSON board for each owned character.
    const rows = prepareCharacterMissionQuery(`
        SELECT owned.id AS character_id
        FROM json_each(?) AS board
        CROSS JOIN players_characters AS owned
          ON owned.id = CAST(board.key AS INTEGER) AND owned.player_id = ?
        WHERE json_array_length(board.value) > 0
          AND NOT EXISTS (
            SELECT 1 FROM json_each(board.value) AS required
            WHERE NOT EXISTS (
                SELECT 1 FROM players_characters_mana_nodes AS learned
                WHERE learned.value = required.value
                  AND learned.character_id = owned.id AND learned.player_id = owned.player_id
            )
          )
    `).all(JSON.stringify(boards), playerId);
    return new Set(rows.map(row => row.character_id));
}
exports.getPlayerCompletedManaBoardCharacterIdsSync = getPlayerCompletedManaBoardCharacterIdsSync;
/** Reads both learned membership and awake levels for one character. */
function getPlayerCharacterManaNodeAwakeLevelsSync(playerId, characterId) {
    const rows = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT value, awake_level FROM players_characters_mana_nodes
        WHERE player_id = ? AND character_id = ?
    `).all(playerId, characterId);
    return Object.fromEntries(rows.map(row => [row.value, row.awake_level]));
}
exports.getPlayerCharacterManaNodeAwakeLevelsSync = getPlayerCharacterManaNodeAwakeLevelsSync;
/** Retrieves mana nodes for only the requested characters with one bounded read. */
function getPlayerCharactersManaNodesByIdsSync(playerId, characterIds) {
    var _a;
    const ids = [...new Set(characterIds)].filter(characterId => Number.isSafeInteger(characterId) && characterId > 0);
    if (ids.length === 0)
        return {};
    const placeholders = ids.map(() => "?").join(", ");
    const rawNodes = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT value, character_id
    FROM players_characters_mana_nodes
    WHERE player_id = ? AND character_id IN (${placeholders})
    `).all(playerId, ...ids);
    const buckets = {};
    for (const rawNode of rawNodes) {
        const characterId = String(rawNode.character_id);
        const bucket = (_a = buckets[characterId]) !== null && _a !== void 0 ? _a : [];
        bucket.push(rawNode.value);
        buckets[characterId] = bucket;
    }
    return buckets;
}
exports.getPlayerCharactersManaNodesByIdsSync = getPlayerCharactersManaNodesByIdsSync;
/**
 * Gets all of the mana nodes that a player has unlocked for a specific character.
 *
 * @param playerId The ID of the player.
 * @param characterId The ID of the character.
 * @returns A list of unlocked mana node ids.
 */
function getPlayerCharacterManaNodesSync(playerId, characterId) {
    const rawNodes = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT value, character_id
    FROM players_characters_mana_nodes
    WHERE character_id = ? AND player_id = ?
    `).all(characterId, playerId);
    return rawNodes.map(rawNode => rawNode.value);
}
exports.getPlayerCharacterManaNodesSync = getPlayerCharacterManaNodesSync;
/**
 * Checks whether a player has unlocked a specific mana node.
 *
 * @param playerId The ID of the player to check.
 * @param characterId The ID of the character.
 * @param manaNodeId The ID of the mana node.
 * @returns Whether the specified mana node has been unlocked or not.
 */
function hasPlayerUnlockedCharacterManaNodeSync(playerId, characterId, manaNodeId) {
    return (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT value
    FROM players_characters_mana_nodes
    WHERE player_id = ? AND character_id = ? AND value = ?
    `).get(playerId, characterId, Number(manaNodeId)) !== undefined;
}
exports.hasPlayerUnlockedCharacterManaNodeSync = hasPlayerUnlockedCharacterManaNodeSync;
/**
 * Inserts mana nodes for a particular character into the database.
 *
 * @param playerId The ID of the player.
 * @param characterId The ID of the character to insert the mana nodes of.
 * @param manaNodes The mana nodes values to insert.
 */
function insertPlayerCharacterManaNodesSync(playerId, characterId, manaNodes) {
    for (const node of manaNodes) {
        (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        INSERT INTO players_characters_mana_nodes (value, character_id, player_id)
        VALUES (?, ?, ?)
        `).run(node, Number(characterId), playerId);
    }
}
exports.insertPlayerCharacterManaNodesSync = insertPlayerCharacterManaNodesSync;
/**
 * Batch inserts a record of characters' mana nodes into the database.
 *
 * @param playerId The ID of the player.
 * @param charactersManaNodes The record of character mana node values.
 */
function insertPlayerCharactersManaNodesSync(playerId, charactersManaNodes) {
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "insert_player_character_mana_nodes" }, () => {
        for (const [characterId, manaNodes] of Object.entries(charactersManaNodes)) {
            insertPlayerCharacterManaNodesSync(playerId, characterId, manaNodes);
        }
    });
}
exports.insertPlayerCharactersManaNodesSync = insertPlayerCharactersManaNodesSync;
/**
 * Gets the awake_level values for all mana nodes owned by a player.
 *
 * @param playerId The ID of the player.
 * @returns A record mapping character_id → { node_id → awake_level }.
 */
function getPlayerCharactersManaNodeAwakeLevelsSync(playerId) {
    var _a;
    const rawNodes = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT value, character_id, awake_level
    FROM players_characters_mana_nodes
    WHERE player_id = ?
    `).all(playerId);
    const result = {};
    for (const rawNode of rawNodes) {
        const charId = rawNode.character_id.toString();
        if (!result[charId])
            result[charId] = {};
        result[charId][rawNode.value] = (_a = rawNode.awake_level) !== null && _a !== void 0 ? _a : 0;
    }
    return result;
}
exports.getPlayerCharactersManaNodeAwakeLevelsSync = getPlayerCharactersManaNodeAwakeLevelsSync;
/**
 * Updates the awake_level for a player's character mana node.
 * Uses INSERT OR REPLACE to handle nodes that may already exist (from learn_mana_node)
 * or may not exist yet (first-time awaken).
 *
 * @param playerId The ID of the player.
 * @param characterId The character's ID.
 * @param manaNodeId The mana node multiplied_id.
 * @param awakeLevel The new awake_level to set.
 */
function updatePlayerCharacterManaNodeAwakeLevelSync(playerId, characterId, manaNodeId, awakeLevel) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    UPDATE players_characters_mana_nodes
    SET awake_level = ?
    WHERE value = ? AND character_id = ? AND player_id = ?
    `).run(awakeLevel, manaNodeId, characterId, playerId);
}
exports.updatePlayerCharacterManaNodeAwakeLevelSync = updatePlayerCharacterManaNodeAwakeLevelSync;
