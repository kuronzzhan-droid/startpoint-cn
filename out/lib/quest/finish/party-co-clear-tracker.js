"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackPartyCoClears = void 0;
const cached_statement_1 = require("../../cached-statement");
// Tracks party member co-clears (pairwise) for multi-character awake missions
// When 3+ specific characters must be in the same party, this tracks their co-appearances
const db_1 = require("../../../data/db");
const persistence_coordinator_1 = require("../../persistence-coordinator");
const mission_1 = require("../../../data/domains/mission");
const awake_battle_rules_1 = require("../../mission/awake-battle-rules");
const race_utils_1 = require("./race-utils");
function trackPartyCoClears(ctx) {
    const ids = [];
    const allRaces = [];
    for (const c of ctx.party.characters) {
        if (c === null || c === void 0 ? void 0 : c.id) {
            ids.push(c.id);
            allRaces.push(...(0, race_utils_1.getCharacterRaces)(c.id));
        }
    }
    for (const c of ctx.party.unison_characters) {
        if (c === null || c === void 0 ? void 0 : c.id) {
            ids.push(c.id);
            allRaces.push(...(0, race_utils_1.getCharacterRaces)(c.id));
        }
    }
    // Co-clears (pairwise character IDs)
    const unique = [...new Set(ids)].sort((a, b) => a - b);
    if (unique.length >= 2) {
        const db = (0, db_1.getDb)();
        const insert = (0, cached_statement_1.cachedStatement)(db, `
        INSERT INTO players_party_member_co_clears (player_id, char_id_a, char_id_b, co_clear_count)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(player_id, char_id_a, char_id_b) DO UPDATE SET
            co_clear_count = co_clear_count + 1
        `);
        (0, persistence_coordinator_1.runPersistenceTransactionSync)({
            domain: "mission", playerId: ctx.playerId, operation: "track_party_co_clears",
        }, () => {
            for (let i = 0; i < unique.length - 1; i++) {
                for (let j = i + 1; j < unique.length; j++) {
                    const [charIdA, charIdB] = (0, awake_battle_rules_1.normalizeCharacterPair)(unique[i], unique[j]);
                    insert.run(ctx.playerId, charIdA, charIdB);
                }
            }
        });
    }
    // Race clears (unique race set)
    const raceKey = (0, race_utils_1.getRaceKeyString)(allRaces);
    if (raceKey) {
        (0, persistence_coordinator_1.runPersistenceTransactionSync)({
            domain: "mission", playerId: ctx.playerId, operation: "track_party_race_clear",
        }, () => (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
            INSERT INTO players_party_race_clears (player_id, race_key, clear_count)
            VALUES (?, ?, 1)
            ON CONFLICT(player_id, race_key) DO UPDATE SET
                clear_count = clear_count + 1
        `).run(ctx.playerId, raceKey));
    }
    const matchedMissionIds = (0, awake_battle_rules_1.getMatchedAwakeDirectBattleMissionIds)(ctx, raceKey);
    for (const missionId of matchedMissionIds) {
        (0, mission_1.incrementPlayerCategoryMissionSync)(ctx.playerId, 9, missionId, 1);
    }
    return matchedMissionIds;
}
exports.trackPartyCoClears = trackPartyCoClears;
