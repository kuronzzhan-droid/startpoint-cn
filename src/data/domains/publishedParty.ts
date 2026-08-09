import { randomInt } from "crypto";
import { getDb } from "../db";

const PARTY_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PARTY_CODE_LENGTH = 10;
export const MAX_PUBLISHED_PARTIES_PER_PLAYER = 20;

export interface PublishedPartyRecord {
    code: string;
    ownerPlayerId: number;
    partyName: string;
    battleParty: unknown;
    schemaVersion: number;
    createdAt: number;
}

interface PublishedPartyRow {
    code: string;
    owner_player_id: number;
    party_name: string;
    battle_party_json: string;
    schema_version: number;
    created_at: number;
}

function generatePartyCode(): string {
    let result = "";
    for (let index = 0; index < PARTY_CODE_LENGTH; index++) {
        result += PARTY_CODE_ALPHABET[randomInt(PARTY_CODE_ALPHABET.length)];
    }
    return result;
}

export function publishPartySync(
    ownerPlayerId: number,
    partyName: string,
    battleParty: unknown,
): string {
    const db = getDb();
    const battlePartyJson = JSON.stringify(battleParty);
    const createdAt = Date.now();

    return db.transaction(() => {
        let code = "";
        for (let attempt = 0; attempt < 20; attempt++) {
            const candidate = generatePartyCode();
            const exists = db.prepare(`SELECT 1 FROM published_parties WHERE code = ?`).get(candidate);
            if (!exists) {
                code = candidate;
                break;
            }
        }
        if (!code) throw new Error("Failed to generate a unique party code.");

        db.prepare(`
            INSERT INTO published_parties (
                code, owner_player_id, party_name, battle_party_json, schema_version, created_at
            ) VALUES (?, ?, ?, ?, 1, ?)
        `).run(code, ownerPlayerId, partyName, battlePartyJson, createdAt);

        // Keep the newest 20 codes. Once the limit is exceeded, the oldest
        // code immediately becomes invalid and /party/refer returns 3404.
        db.prepare(`
            DELETE FROM published_parties
            WHERE id IN (
                SELECT id
                FROM published_parties
                WHERE owner_player_id = ?
                ORDER BY id DESC
                LIMIT -1 OFFSET ?
            )
        `).run(ownerPlayerId, MAX_PUBLISHED_PARTIES_PER_PLAYER);

        return code;
    })();
}

export function getPublishedPartySync(code: string): PublishedPartyRecord | null {
    const row = getDb().prepare(`
        SELECT code, owner_player_id, party_name, battle_party_json, schema_version, created_at
        FROM published_parties
        WHERE code = ?
        LIMIT 1
    `).get(code) as PublishedPartyRow | undefined;
    if (!row) return null;

    let battleParty: unknown;
    try {
        battleParty = JSON.parse(row.battle_party_json);
    } catch {
        battleParty = null;
    }

    return {
        code: row.code,
        ownerPlayerId: row.owner_player_id,
        partyName: row.party_name,
        battleParty,
        schemaVersion: row.schema_version,
        createdAt: row.created_at,
    };
}
