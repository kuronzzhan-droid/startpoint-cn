"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPublishedPartySync = exports.publishPartySync = exports.MAX_PUBLISHED_PARTIES_PER_PLAYER = void 0;
const crypto_1 = require("crypto");
const db_1 = require("../db");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const public_payload_1 = require("../../lib/weapon-riven/public-payload");
const PARTY_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PARTY_CODE_LENGTH = 10;
exports.MAX_PUBLISHED_PARTIES_PER_PLAYER = 50;
function generatePartyCode() {
    let result = "";
    for (let index = 0; index < PARTY_CODE_LENGTH; index++) {
        result += PARTY_CODE_ALPHABET[(0, crypto_1.randomInt)(PARTY_CODE_ALPHABET.length)];
    }
    return result;
}
function publishPartySync(ownerPlayerId, partyName, battleParty) {
    const db = (0, db_1.getDb)();
    const battlePartyJson = JSON.stringify((0, public_payload_1.stripWeaponRivenPublicPayload)(battleParty));
    const createdAt = Date.now();
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId: ownerPlayerId, operation: "publish_party" }, () => {
        let code = "";
        for (let attempt = 0; attempt < 20; attempt++) {
            const candidate = generatePartyCode();
            const exists = db.prepare(`SELECT 1 FROM published_parties WHERE code = ?`).get(candidate);
            if (!exists) {
                code = candidate;
                break;
            }
        }
        if (!code)
            throw new Error("Failed to generate a unique party code.");
        db.prepare(`
            INSERT INTO published_parties (
                code, owner_player_id, party_name, battle_party_json, schema_version, created_at
            ) VALUES (?, ?, ?, ?, 1, ?)
        `).run(code, ownerPlayerId, partyName, battlePartyJson, createdAt);
        // Keep the newest 50 codes. Once the limit is exceeded, the oldest
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
        `).run(ownerPlayerId, exports.MAX_PUBLISHED_PARTIES_PER_PLAYER);
        return code;
    });
}
exports.publishPartySync = publishPartySync;
function getPublishedPartySync(code) {
    const row = (0, db_1.getDb)().prepare(`
        SELECT code, owner_player_id, party_name, battle_party_json, schema_version, created_at
        FROM published_parties
        WHERE code = ?
        LIMIT 1
    `).get(code);
    if (!row)
        return null;
    let battleParty;
    try {
        battleParty = (0, public_payload_1.stripWeaponRivenPublicPayload)(JSON.parse(row.battle_party_json));
    }
    catch (_a) {
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
exports.getPublishedPartySync = getPublishedPartySync;
