import { readPlayerPartyGroupListSync } from "../readers/load-snapshot"
import { cachedStatement } from "../../lib/cached-statement"
import { getDb } from "../db";
import { PartyCategory, PlayerParty, PlayerPartyGroup } from "../types";
import { serializeBoolean } from "../utils";
import { insertMissingPartyGroupListSync } from "../../lib/party-group-persistence";
import { gameVerboseLog } from "../../lib/game-logging";
import { runPersistenceTransactionSync } from "../../lib/persistence-coordinator";
import { parseGlobalPartyId } from "../../lib/special-event-parties";
import { limitWeaponRivenPartySouls } from "../../lib/weapon-riven/party-limit";

export interface PlayerPartyDisplaySelection {
    characterIds: (number | null)[];
    evolutionImgLevels: (number | null)[];
}

interface RawPlayerPartyDisplaySelection {
    player_id: number;
    character_id_1: number | null;
    character_id_2: number | null;
    character_id_3: number | null;
    evolution_level_1: number | null;
    evolution_level_2: number | null;
    evolution_level_3: number | null;
    illustration_settings_1: string | null;
    illustration_settings_2: string | null;
    illustration_settings_3: string | null;
}

const PARTY_DISPLAY_BATCH_SIZE = 900;

function resolveEvolutionImgLevel(
    evolutionLevel: number | null,
    illustrationSettings: string | null,
): number | null {
    if (evolutionLevel === null) return null;
    if (illustrationSettings !== null) {
        try {
            const parsed = JSON.parse(illustrationSettings);
            const selected = Array.isArray(parsed) ? parsed[0] : null;
            if (Number.isSafeInteger(selected)) return Number(selected);
        } catch {
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
export function getFirstPlayerPartyDisplaySelectionsSync(
    playerIds: readonly number[],
    category: PartyCategory,
): Map<number, PlayerPartyDisplaySelection> {
    const uniquePlayerIds = [...new Set(playerIds)].filter(
        playerId => Number.isSafeInteger(playerId) && playerId > 0,
    );
    const selections = new Map<number, PlayerPartyDisplaySelection>();

    for (let offset = 0; offset < uniquePlayerIds.length; offset += PARTY_DISPLAY_BATCH_SIZE) {
        const batch = uniquePlayerIds.slice(offset, offset + PARTY_DISPLAY_BATCH_SIZE);
        const placeholders = batch.map(() => "?").join(", ");
        const rows = cachedStatement(getDb(), `
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
        `).all(category, ...batch) as RawPlayerPartyDisplaySelection[];

        for (const row of rows) {
            selections.set(row.player_id, {
                characterIds: [
                    row.character_id_1,
                    row.character_id_2,
                    row.character_id_3,
                ],
                evolutionImgLevels: [
                    resolveEvolutionImgLevel(
                        row.evolution_level_1,
                        row.illustration_settings_1,
                    ),
                    resolveEvolutionImgLevel(
                        row.evolution_level_2,
                        row.illustration_settings_2,
                    ),
                    resolveEvolutionImgLevel(
                        row.evolution_level_3,
                        row.illustration_settings_3,
                    ),
                ],
            });
        }
    }

    return selections;
}

export function getPlayerPartyGroupListSync(
    playerId: number,
    category: PartyCategory = PartyCategory.NORMAL
): Record<string, PlayerPartyGroup> {
    return readPlayerPartyGroupListSync(getDb(), playerId, category)
}

/**
 * The player row's party_slot is the legacy home/normal-party pointer.  Event
 * party categories reuse the same global group/slot numbers, so callers must
 * validate this pointer against NORMAL instead of treating its numeric range
 * as sufficient.
 */
export function isValidNormalPartySlotSync(playerId: number, partySlot: number): boolean {
    const parsed = parseGlobalPartyId(partySlot)
    if (parsed === null) return false
    const row = cachedStatement(getDb(), `
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
    `).get(playerId, PartyCategory.NORMAL, parsed.groupId, parsed.slot) as { valid: number } | undefined
    return row?.valid === 1
}

/** Resolve a safe normal-party pointer, preferring the caller's selection. */
export function findValidNormalPartySlotSync(
    playerId: number,
    preferredPartySlot?: number,
): number | null {
    if (preferredPartySlot !== undefined
        && isValidNormalPartySlotSync(playerId, preferredPartySlot)) {
        return preferredPartySlot
    }
    const row = cachedStatement(getDb(), `
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
    `).get(playerId, PartyCategory.NORMAL) as { group_id: number; slot: number } | undefined
    if (!row) return null
    return (Number(row.group_id) - 1) * 10 + Number(row.slot)
}

function insertPlayerPartySync(playerId: number, slot: number | string, groupId: number | string, party: PlayerParty) {
    const db = getDb();
    const souls = limitWeaponRivenPartySouls(party.abilitySoulIds);
    cachedStatement(db, `
    INSERT INTO players_parties (slot, name, character_id_1, character_id_2, character_id_3,
        unison_character_1, unison_character_2, unison_character_3, equipment_1, equipment_2,
        equipment_3, ability_soul_1, ability_soul_2, ability_soul_3, edited, player_id, group_id, category,
        current_battle_power, before_battle_power)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        Number(slot), party.name,
        party.characterIds[0] || null, party.characterIds[1] || null, party.characterIds[2] || null,
        party.unisonCharacterIds[0] || null, party.unisonCharacterIds[1] || null, party.unisonCharacterIds[2] || null,
        party.equipmentIds[0] || null, party.equipmentIds[1] || null, party.equipmentIds[2] || null,
        souls[0] || null, souls[1] || null, souls[2] || null,
        serializeBoolean(party.edited), playerId, Number(groupId), party.category,
        party.currentBattlePower ?? 0, party.beforeBattlePower ?? 0
    )
}

function insertPlayerPartyGroupSync(playerId: number, groupId: number | string, group: PlayerPartyGroup) {
    const db = getDb();
    cachedStatement(db, `
    INSERT INTO players_party_groups (id, color_id, player_id, category)
    VALUES (?, ?, ?, ?)
    `).run(Number(groupId), group.colorId, playerId, group.category)

    for (const [slot, party] of Object.entries(group.list)) {
        insertPlayerPartySync(playerId, slot, groupId, party)
    }
}

export function insertPlayerPartyGroupListSync(playerId: number, groups: Record<string, PlayerPartyGroup>) {
    const db = getDb();
    runPersistenceTransactionSync({ domain: "player", playerId, operation: "insert_player_party_groups" }, () => {
        for (const [groupId, group] of Object.entries(groups)) {
            insertPlayerPartyGroupSync(playerId, groupId, group)
        }
    })
}

export function ensurePlayerPartyGroupListSync(
    playerId: number,
    groups: Record<string, PlayerPartyGroup>,
) {
    runPersistenceTransactionSync({ domain: "player", playerId, operation: "ensure_player_party_groups" }, () => {
        insertMissingPartyGroupListSync(getDb(), playerId, groups)
    })
}

export function updatePlayerPartySync(playerId: number, slot: number, party: PlayerParty, groupId: number = 1) {
    const db = getDb();
    const souls = limitWeaponRivenPartySouls(party.abilitySoulIds);
    // Upsert: try update first, insert if not exists
    const result = cachedStatement(db, `
    UPDATE players_parties SET name = ?, character_id_1 = ?, character_id_2 = ?, character_id_3 = ?,
        unison_character_1 = ?, unison_character_2 = ?, unison_character_3 = ?,
        equipment_1 = ?, equipment_2 = ?, equipment_3 = ?,
        ability_soul_1 = ?, ability_soul_2 = ?, ability_soul_3 = ?, edited = ?,
        current_battle_power = ?, before_battle_power = ?
    WHERE slot = ? AND player_id = ? AND group_id = ? AND category = ?
    `).run(
        party.name,
        party.characterIds[0], party.characterIds[1], party.characterIds[2],
        party.unisonCharacterIds[0], party.unisonCharacterIds[1], party.unisonCharacterIds[2],
        party.equipmentIds[0], party.equipmentIds[1], party.equipmentIds[2],
        souls[0], souls[1], souls[2],
        serializeBoolean(party.edited),
        party.currentBattlePower ?? 0, party.beforeBattlePower ?? 0,
        slot, playerId, groupId, party.category
    )
    if (result.changes === 0) {
        gameVerboseLog(() => `[PARTY-DB] insert: player=${playerId} group=${groupId} slot=${slot} name="${party.name}" chars=${party.characterIds.filter(Boolean).length}`)
        // Ensure group exists
        const groupExists = cachedStatement(db, 'SELECT id FROM players_party_groups WHERE id = ? AND player_id = ? AND category = ?').get(groupId, playerId, party.category)
        if (!groupExists) {
                gameVerboseLog(() => `[PARTY-DB] new group: player=${playerId} id=${groupId}`)
                    cachedStatement(db, 'INSERT INTO players_party_groups (id, color_id, player_id, category) VALUES (?, ?, ?, ?)').run(groupId, 15, playerId, party.category)
        }
        insertPlayerPartySync(playerId, slot, groupId, party)
    } else {
        gameVerboseLog(() => `[PARTY-DB] update: player=${playerId} group=${groupId} slot=${slot} name="${party.name}" chars=${party.characterIds.filter(Boolean).length}`)
    }
}

export function updatePlayerPartyGroupSync(
    playerId: number, groupId: number, colorId: number,
    category: PartyCategory = PartyCategory.NORMAL
) {
    const db = getDb();
    cachedStatement(db, `
    UPDATE players_party_groups SET color_id = ?
    WHERE id = ? AND player_id = ? AND category = ?
    `).run(colorId, groupId, playerId, category)
}

/**
 * Count how many parties currently have the given ability soul equipped.
 * Used by /item/sell to prevent selling souls that are in use.
 */
export function countAbilitySoulUsedInPartiesSync(
    playerId: number,
    abilitySoulId: number
): number {
    const db = getDb()
    const row = cachedStatement(db, `
    SELECT COUNT(*) AS cnt FROM players_parties
    WHERE player_id = ?
    AND (ability_soul_1 = ? OR ability_soul_2 = ? OR ability_soul_3 = ?)
    `).get(playerId, abilitySoulId, abilitySoulId, abilitySoulId) as { cnt: number } | undefined
    return row?.cnt ?? 0
}

/** Counts occupied ability-soul slots, used as a conservative historical floor. */
export function countEquippedAbilitySoulSlotsSync(playerId: number): number {
    const row = cachedStatement(getDb(), `
    SELECT
        SUM(CASE WHEN ability_soul_1 IS NOT NULL THEN 1 ELSE 0 END)
        + SUM(CASE WHEN ability_soul_2 IS NOT NULL THEN 1 ELSE 0 END)
        + SUM(CASE WHEN ability_soul_3 IS NOT NULL THEN 1 ELSE 0 END) AS cnt
    FROM players_parties
    WHERE player_id = ?
    `).get(playerId) as { cnt: number | null } | undefined
    return Number(row?.cnt) || 0
}
