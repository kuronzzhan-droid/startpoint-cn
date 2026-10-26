import {
    buildCharacterBondToken,
    buildPlayerCharacter,
    readPlayerCharactersManaNodesSync,
    readPlayerCharactersSync,
} from "../readers/load-snapshot"
import { getDb } from "../db";
import { PlayerCharacter, PlayerCharacterBondToken, RawPlayerCharacter, RawPlayerCharacterBondToken, RawPlayerCharacterManaNode } from "../types";
import { serializeBoolean, serializeNumberList, deserializeNumberList } from "../utils";
import { getCharacterDataSync } from "../../lib/assets";
import type { Statement } from "better-sqlite3";
import { cachedStatement } from "../../lib/cached-statement";
import { runPersistenceTransactionSync } from "../../lib/persistence-coordinator";

function prepareCharacterMissionQuery(sql: string): Statement {
    return cachedStatement(getDb(), sql)
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
export function playerOwnsCharacterSync(
    playerId: number,
    characterId: number
): boolean {
    return cachedStatement(getDb(), `
    SELECT id
    FROM players_characters
    WHERE player_id = ? AND id = ?
    `).get(playerId, characterId) !== undefined
}

/**
 * Gets a singular character from a player's data.
 * 
 * @param playerId The ID of the player.
 * @param characterId The ID of the character.
 * @returns The PlayerCharacter or null if it doesn't exist.
 */
export function getPlayerCharacterSync(
    playerId: number,
    characterId: number
): PlayerCharacter | null {

    const rawCharacter = cachedStatement(getDb(), `
    SELECT id, entry_count, evolution_level, over_limit_step, protection,
        join_time, update_time, exp, stack, mana_board_index, ex_boost_status_id,
        ex_boost_ability_id_list, illustration_settings
    FROM players_characters
    WHERE player_id = ? AND id = ?
    `).get(playerId, characterId) as RawPlayerCharacter

    if (rawCharacter === undefined) return null

    // get bond tokens
    const rawBondTokens = cachedStatement(getDb(), `
    SELECT mana_board_index, status, character_id
    FROM players_characters_bond_tokens
    WHERE player_id = ? AND character_id = ?
    ORDER BY mana_board_index
    `).all(playerId, characterId) as RawPlayerCharacterBondToken[]

    return buildPlayerCharacter(
        rawCharacter,
        rawBondTokens.map(raw => buildCharacterBondToken(raw))
    )
}

/** Cosmetic state only; rendering a party does not need character bond tokens. */
export function getPlayerCharacterEvolutionImageStatesSync(
    playerId: number,
    characterIds: readonly number[],
): Record<string, Pick<PlayerCharacter, "evolutionLevel" | "illustrationSettings">> {
    const ids = [...new Set(characterIds)]
    const result: Record<string, Pick<PlayerCharacter, "evolutionLevel" | "illustrationSettings">> = {}
    for (let offset = 0; offset < ids.length; offset += 400) {
        const chunk = ids.slice(offset, offset + 400)
        const rows = cachedStatement(getDb(), `
            SELECT id, evolution_level, illustration_settings
            FROM players_characters
            WHERE player_id = ? AND id IN (${chunk.map(() => "?").join(", ")})
        `).all(playerId, ...chunk) as Pick<RawPlayerCharacter, "id" | "evolution_level" | "illustration_settings">[]
        for (const row of rows) result[String(row.id)] = {
            evolutionLevel: row.evolution_level,
            illustrationSettings: row.illustration_settings === null
                ? undefined : deserializeNumberList(row.illustration_settings),
        }
    }
    return result
}

/**
 * Gets a list of all of the characters that a player owns.
 * 
 * @param playerId The ID of the player.
 * @returns A list of the characters that the player owns.
 */
export type PlayerCharacterMissionFacts = Pick<PlayerCharacter,
    "exp" | "evolutionLevel" | "overLimitStep" | "bondTokenList">

/** Facts used by mission computers; no dates, cosmetic state or boost payloads. */
export function getPlayerCharacterMissionFactsSync(playerId: number): Record<string, PlayerCharacterMissionFacts> {
    const db = getDb()
    const rows = cachedStatement(db, `
        SELECT id, exp, evolution_level, over_limit_step
        FROM players_characters WHERE player_id = ?
    `).all(playerId) as Pick<RawPlayerCharacter, "id" | "exp" | "evolution_level" | "over_limit_step">[]
    const result: Record<string, PlayerCharacterMissionFacts> = {}
    for (const row of rows) {
        result[String(row.id)] = {
            exp: row.exp, evolutionLevel: row.evolution_level,
            overLimitStep: row.over_limit_step, bondTokenList: [],
        }
    }
    const tokens = cachedStatement(db, `
        SELECT mana_board_index, status, character_id
        FROM players_characters_bond_tokens WHERE player_id = ?
        ORDER BY character_id, mana_board_index
    `).all(playerId) as RawPlayerCharacterBondToken[]
    for (const token of tokens) result[String(token.character_id)]?.bondTokenList.push(buildCharacterBondToken(token))
    return result
}

export function getPlayerCharactersSync(
    playerId: number
): Record<string, PlayerCharacter> {
    return readPlayerCharactersSync(getDb(), playerId)
}

/** Retrieves only the requested owned characters with two bounded reads. */
export function getPlayerCharactersByIdsSync(
    playerId: number,
    characterIds: readonly number[],
): Record<string, PlayerCharacter> {
    const ids = [...new Set(characterIds)].filter(
        characterId => Number.isSafeInteger(characterId) && characterId > 0,
    )
    if (ids.length === 0) return {}

    const placeholders = ids.map(() => "?").join(", ")
    const rawCharacters = cachedStatement(getDb(), `
    SELECT id, entry_count, evolution_level, over_limit_step, protection,
        join_time, update_time, exp, stack, mana_board_index, ex_boost_status_id,
        ex_boost_ability_id_list, illustration_settings
    FROM players_characters
    WHERE player_id = ? AND id IN (${placeholders})
    `).all(playerId, ...ids) as RawPlayerCharacter[]
    const rawBondTokens = cachedStatement(getDb(), `
    SELECT mana_board_index, status, character_id
    FROM players_characters_bond_tokens
    WHERE player_id = ? AND character_id IN (${placeholders})
    ORDER BY character_id, mana_board_index
    `).all(playerId, ...ids) as RawPlayerCharacterBondToken[]

    const bondBuckets: Record<string, PlayerCharacterBondToken[]> = {}
    for (const rawBondToken of rawBondTokens) {
        const characterId = String(rawBondToken.character_id)
        const bucket = bondBuckets[characterId] ?? []
        bucket.push(buildCharacterBondToken(rawBondToken))
        bondBuckets[characterId] = bucket
    }

    const result: Record<string, PlayerCharacter> = {}
    for (const rawCharacter of rawCharacters) {
        const characterId = String(rawCharacter.id)
        result[characterId] = buildPlayerCharacter(
            rawCharacter,
            bondBuckets[characterId] ?? [],
        )
    }
    return result
}

/** Only EXP and received-token presence are needed by character favor titles. */
export function getPlayerCharacterFavorFactsSync(
    playerId: number,
    characterIds: readonly number[],
): Record<string, { exp: number; hasReceivedBondToken: boolean }> {
    const ids = [...new Set(characterIds)].filter(id => Number.isSafeInteger(id) && id > 0)
    const result: Record<string, { exp: number; hasReceivedBondToken: boolean }> = {}
    for (let offset = 0; offset < ids.length; offset += 400) {
        const chunk = ids.slice(offset, offset + 400)
        const rows = prepareCharacterMissionQuery(`
            SELECT owned.id, owned.exp, EXISTS (
                SELECT 1 FROM players_characters_bond_tokens AS token
                WHERE token.player_id = owned.player_id AND token.character_id = owned.id AND token.status >= 2
            ) AS received_bond
            FROM players_characters AS owned
            WHERE owned.player_id = ? AND owned.id IN (${chunk.map(() => "?").join(", ")})
        `).all(playerId, ...chunk) as { id: number; exp: number; received_bond: number }[]
        for (const row of rows) result[String(row.id)] = { exp: row.exp, hasReceivedBondToken: row.received_bond === 1 }
    }
    return result
}

/**
 * Inserts a single character's bond token into a player's data.
 * 
 * @param playerId The ID of the player.
 * @param characterId The ID of the character.
 * @param bondToken The bond token to insert.
 */
export function insertPlayerCharacterBondTokenSync(
    playerId: number,
    characterId: number | string,
    bondToken: PlayerCharacterBondToken
) {
    cachedStatement(getDb(), `
    INSERT INTO players_characters_bond_tokens (mana_board_index, status, player_id, character_id)
    VALUES (?, ?, ?, ?)
    `).run(
        bondToken.manaBoardIndex,
        bondToken.status,
        playerId,
        Number(characterId)
    )
}

/**
 * Updates a player's character's bond token.
 * 
 * @param playerId The ID of the player.
 * @param characterId The ID of the character.
 * @param bondToken The updated bondToken.
 */
export function updatePlayerCharacterBondTokenSync(
    playerId: number,
    characterId: number | string,
    bondToken: PlayerCharacterBondToken
) {
    cachedStatement(getDb(), `
    UPDATE players_characters_bond_tokens
    SET status = ?
    WHERE player_id = ? AND character_id = ? AND mana_board_index = ?
    `).run(
        bondToken.status,
        playerId,
        Number(characterId),
        bondToken.manaBoardIndex
    )
}

/**
 * Inserts a single character into a player's inventory.
 * 
 * @param playerId The ID of the player to add the character to.
 * @param characterId The ID of the character to add.
 * @param character The character data.
 */
export function insertPlayerCharacterSync(
    playerId: number,
    characterId: number | string,
    character: PlayerCharacter
) {
    // insert into characters table
    cachedStatement(getDb(), `
    INSERT INTO players_characters (id, entry_count, evolution_level, over_limit_step,
        protection, join_time, update_time, exp, stack, mana_board_index, player_id,
        ex_boost_status_id, ex_boost_ability_id_list, illustration_settings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        Number(characterId),
        character.entryCount,
        character.evolutionLevel,
        character.overLimitStep,
        serializeBoolean(character.protection),
        character.joinTime.toISOString(),
        character.updateTime.toISOString(),
        character.exp,
        character.stack,
        character.manaBoardIndex,
        playerId,
        character.exBoost?.statusId === undefined ? null : character.exBoost.statusId,
        character.exBoost?.abilityIdList === undefined ? null : serializeNumberList(character.exBoost.abilityIdList),
        character.illustrationSettings === undefined ? null : serializeNumberList(character.illustrationSettings)
    )

    // insert mana board nodes
    for (const token of character.bondTokenList) {
        insertPlayerCharacterBondTokenSync(playerId, characterId, token)
    }
}

/**
 * Inserts a default single character into a player's inventory.
 * 
 * @param playerId The ID of the player to add the character to.
 * @param characterId The ID of the character to add.
 */
export function insertDefaultPlayerCharacterSync(
    playerId: number,
    characterId: number | string
) {
    const dateNow = new Date()

    const bondTokenList = [
        {
            manaBoardIndex: 1,
            status: 0
        }
    ]

    const assetData = getCharacterDataSync(characterId)
    if (assetData && assetData.skill_count > 3) {
        bondTokenList.push({
            manaBoardIndex: 2,
            status: 0
        })
    }

    insertPlayerCharacterSync(
        playerId,
        characterId,
        {
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
        }
    )
}

/**
 * Batch inserts a record of characters into a player's inventory.
 * 
 * @param playerId The ID of the player.
 * @param characters The record of characters to insert.
 */
export function insertPlayerCharactersSync(
    playerId: number,
    characters: Record<string, PlayerCharacter>
) {
    runPersistenceTransactionSync({ domain: "player", playerId, operation: "insert_player_characters" }, () => {
        for (const [characterId, data] of Object.entries(characters)) {
            insertPlayerCharacterSync(playerId, characterId, data)
        }
    })
}

/**
 * Updates a single character within a player's data.
 * 
 * @param playerId The ID of the player.
 * @param characterId The ID of the character.
 * @param character The partial data of the character to update.
 */
export function updatePlayerCharacterSync(
    playerId: number,
    characterId: number,
    character: Partial<PlayerCharacter>
) {
    const fieldMap: Record<string, string> = {
        'entryCount': 'entry_count',
        'evolutionLevel': 'evolution_level',
        'overLimitStep': 'over_limit_step',
        'protection': 'protection',
        'joinTime': 'join_time',
        'updateTime': 'update_time',
        'exp': 'exp',
        'stack': 'stack',
        'manaBoardIndex': 'mana_board_index'
    }

    // set the update time to now
    character.updateTime = new Date()

    const sets: string[] = []
    const values: any[] = []
    for (const key in character) {
        const value = character[key as keyof PlayerCharacter]
        const mapped = fieldMap[key]
        if (mapped && value !== undefined) {
            sets.push(`${mapped} = ?`)
            if (value instanceof Date) {
                values.push(value.toISOString())
            } else if (typeof (value) === "boolean") {
                values.push(serializeBoolean(value))
            } else {
                values.push(value)
            }
        }
    }

    const exBoost = character.exBoost
    if (exBoost !== undefined) {
        sets.push('ex_boost_status_id = ?')
        sets.push('ex_boost_ability_id_list = ?')
        values.push(exBoost.statusId)
        values.push(serializeNumberList(exBoost.abilityIdList))
    }

    const illustration_settings = character.illustrationSettings
    if (illustration_settings !== undefined) {
        sets.push('illustration_settings = ?')
        values.push(serializeNumberList(illustration_settings))
    }

    if (sets.length > 0) cachedStatement(getDb(), `
        UPDATE players_characters
        SET ${sets.join(', ')}
        WHERE id = ? AND player_id = ?
        `).run([...values, characterId, playerId]);
}

/**
 * Retrieves the mana node statuses of a player's characters.
 * 
 * @param playerId The ID of the player.
 * @returns A record containing the statuses of the player's characters.
 */
export function getPlayerCharactersManaNodesSync(
    playerId: number
): Record<string, number[]> {
    return readPlayerCharactersManaNodesSync(getDb(), playerId)
}

/** Scalar counts and an optional compact id list; no full character/node objects. */
export function getPlayerCharacterMissionStatsSync(playerId: number, needs: {
    manaNodes?: boolean,
    bondTokens?: boolean,
    ownedCharacterIds?: boolean,
}): { manaNodeCount: number; bondTokenCount: number; ownedCharacterIds: number[] } {
    if (!needs.manaNodes && !needs.bondTokens && !needs.ownedCharacterIds) {
        return { manaNodeCount: 0, bondTokenCount: 0, ownedCharacterIds: [] }
    }
    const manaCount = needs.manaNodes
        ? "(SELECT COUNT(*) FROM players_characters_mana_nodes WHERE player_id = @playerId)" : "0"
    const bondCount = needs.bondTokens ? `(
        SELECT COUNT(*) FROM players_characters_bond_tokens AS token
        JOIN players_characters AS owned
          ON owned.player_id = token.player_id AND owned.id = token.character_id
        WHERE token.player_id = @playerId AND token.status >= 2
    )` : "0"
    const ownedIds = needs.ownedCharacterIds
        ? "(SELECT json_group_array(id) FROM players_characters WHERE player_id = @playerId)" : "'[]'"
    const row = prepareCharacterMissionQuery(`SELECT ${manaCount} AS mana_count, ${bondCount} AS bond_count, ${ownedIds} AS owned_ids`)
        .get({ playerId }) as { mana_count: number; bond_count: number; owned_ids: string }
    return { manaNodeCount: row.mana_count, bondTokenCount: row.bond_count, ownedCharacterIds: JSON.parse(row.owned_ids) }
}

export function countPlayerCharacterManaNodesSync(playerId: number): number {
    return getPlayerCharacterMissionStatsSync(playerId, { manaNodes: true }).manaNodeCount
}

export function countPlayerReceivedBondTokensSync(playerId: number): number {
    return getPlayerCharacterMissionStatsSync(playerId, { bondTokens: true }).bondTokenCount
}

/**
 * Returns owned characters containing every required node. Extra or awakened
 * nodes do not substitute for missing requirements; empty boards never complete.
 */
export function getPlayerCompletedManaBoardCharacterIdsSync(
    playerId: number,
    requiredNodes: Readonly<Record<string, readonly number[]>>,
    ownedCharacterIds?: readonly number[],
): Set<number> {
    if (Object.keys(requiredNodes).length === 0) return new Set()
    // Small saves should not serialize or scan the entire master roster.
    // Keep only owned ids here; character details and individual nodes stay in SQLite.
    const ids = ownedCharacterIds ?? getPlayerCharacterMissionStatsSync(playerId, { ownedCharacterIds: true }).ownedCharacterIds
    const boards = Object.fromEntries(ids.flatMap(id => {
        const nodes = requiredNodes[String(id)]
        return nodes?.length ? [[String(id), nodes]] : []
    }))
    if (Object.keys(boards).length === 0) return new Set()
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
    `).all(JSON.stringify(boards), playerId) as { character_id: number }[]
    return new Set(rows.map(row => row.character_id))
}

/** Reads both learned membership and awake levels for one character. */
export function getPlayerCharacterManaNodeAwakeLevelsSync(
    playerId: number,
    characterId: number,
): Record<number, number> {
    const rows = cachedStatement(getDb(), `
        SELECT value, awake_level FROM players_characters_mana_nodes
        WHERE player_id = ? AND character_id = ?
    `).all(playerId, characterId) as { value: number; awake_level: number }[]
    return Object.fromEntries(rows.map(row => [row.value, row.awake_level]))
}

/** Retrieves mana nodes for only the requested characters with one bounded read. */
export function getPlayerCharactersManaNodesByIdsSync(
    playerId: number,
    characterIds: readonly number[],
): Record<string, number[]> {
    const ids = [...new Set(characterIds)].filter(
        characterId => Number.isSafeInteger(characterId) && characterId > 0,
    )
    if (ids.length === 0) return {}

    const placeholders = ids.map(() => "?").join(", ")
    const rawNodes = cachedStatement(getDb(), `
    SELECT value, character_id
    FROM players_characters_mana_nodes
    WHERE player_id = ? AND character_id IN (${placeholders})
    `).all(playerId, ...ids) as RawPlayerCharacterManaNode[]
    const buckets: Record<string, number[]> = {}
    for (const rawNode of rawNodes) {
        const characterId = String(rawNode.character_id)
        const bucket = buckets[characterId] ?? []
        bucket.push(rawNode.value)
        buckets[characterId] = bucket
    }
    return buckets
}

/**
 * Gets all of the mana nodes that a player has unlocked for a specific character.
 * 
 * @param playerId The ID of the player.
 * @param characterId The ID of the character.
 * @returns A list of unlocked mana node ids.
 */
export function getPlayerCharacterManaNodesSync(
    playerId: number,
    characterId: number
): number[] {
    const rawNodes = cachedStatement(getDb(), `
    SELECT value, character_id
    FROM players_characters_mana_nodes
    WHERE character_id = ? AND player_id = ?
    `).all(characterId, playerId) as RawPlayerCharacterManaNode[]

    return rawNodes.map(rawNode => rawNode.value);
}

/**
 * Checks whether a player has unlocked a specific mana node.
 * 
 * @param playerId The ID of the player to check.
 * @param characterId The ID of the character.
 * @param manaNodeId The ID of the mana node.
 * @returns Whether the specified mana node has been unlocked or not.
 */
export function hasPlayerUnlockedCharacterManaNodeSync(
    playerId: number,
    characterId: number,
    manaNodeId: string | number
): boolean {
    return cachedStatement(getDb(), `
    SELECT value
    FROM players_characters_mana_nodes
    WHERE player_id = ? AND character_id = ? AND value = ?
    `).get(playerId, characterId, Number(manaNodeId)) !== undefined
}

/**
 * Inserts mana nodes for a particular character into the database.
 * 
 * @param playerId The ID of the player.
 * @param characterId The ID of the character to insert the mana nodes of.
 * @param manaNodes The mana nodes values to insert.
 */
export function insertPlayerCharacterManaNodesSync(
    playerId: number,
    characterId: number | string,
    manaNodes: number[]
) {
    for (const node of manaNodes) {
        cachedStatement(getDb(), `
        INSERT INTO players_characters_mana_nodes (value, character_id, player_id)
        VALUES (?, ?, ?)
        `).run(
            node,
            Number(characterId),
            playerId
        )
    }
}

/**
 * Batch inserts a record of characters' mana nodes into the database.
 * 
 * @param playerId The ID of the player.
 * @param charactersManaNodes The record of character mana node values.
 */
export function insertPlayerCharactersManaNodesSync(
    playerId: number,
    charactersManaNodes: Record<string, number[]>
) {
    runPersistenceTransactionSync({ domain: "player", playerId, operation: "insert_player_character_mana_nodes" }, () => {
        for (const [characterId, manaNodes] of Object.entries(charactersManaNodes)) {
            insertPlayerCharacterManaNodesSync(playerId, characterId, manaNodes)
        }
    })
}

/**
 * Gets the awake_level values for all mana nodes owned by a player.
 * 
 * @param playerId The ID of the player.
 * @returns A record mapping character_id → { node_id → awake_level }.
 */
export function getPlayerCharactersManaNodeAwakeLevelsSync(
    playerId: number
): Record<string, Record<number, number>> {
    const rawNodes = cachedStatement(getDb(), `
    SELECT value, character_id, awake_level
    FROM players_characters_mana_nodes
    WHERE player_id = ?
    `).all(playerId) as RawPlayerCharacterManaNode[]

    const result: Record<string, Record<number, number>> = {}
    for (const rawNode of rawNodes) {
        const charId = rawNode.character_id.toString()
        if (!result[charId]) result[charId] = {}
        result[charId][rawNode.value] = rawNode.awake_level ?? 0
    }
    return result
}

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
export function updatePlayerCharacterManaNodeAwakeLevelSync(
    playerId: number,
    characterId: number,
    manaNodeId: number,
    awakeLevel: number
) {
    cachedStatement(getDb(), `
    UPDATE players_characters_mana_nodes
    SET awake_level = ?
    WHERE value = ? AND character_id = ? AND player_id = ?
    `).run(awakeLevel, manaNodeId, characterId, playerId)
    // Only discard the DB fallback cache; active room/NPC/frozen battle
    // snapshots keep the exact party already accepted for that play.
    require("../../multi/party-snapshot").invalidateRealPartySnapshot(playerId)
}
