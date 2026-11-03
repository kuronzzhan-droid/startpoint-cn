"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantCarnivalTotalScoreRewardsSync = exports.ensurePlayerClaimedCarnivalDegreesSync = void 0;
const db_1 = require("../../../data/db");
const persistence_coordinator_1 = require("../../persistence-coordinator");
const quest_1 = require("../../quest");
const types_1 = require("../../types");
const carnival_event_total_score_rewards_json_1 = __importDefault(require("../../../../assets/carnival_event_total_score_rewards.json"));
const degree_1 = require("../../../data/domains/degree");
const claimTablesReady = new WeakSet();
const rewardTable = carnival_event_total_score_rewards_json_1.default;
function emptyResult() {
    return { rewardIds: [], newDegreeIds: [], rewards: null };
}
function ensureClaimTableSync() {
    const db = (0, db_1.getDb)();
    if (claimTablesReady.has(db))
        return;
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "event", operation: "ensure_carnival_reward_claims",
    }, () => db.prepare(`
        CREATE TABLE IF NOT EXISTS players_carnival_event_reward_claims (
            player_id INTEGER NOT NULL,
            event_id INTEGER NOT NULL,
            reward_id INTEGER NOT NULL,
            claimed_at INTEGER NOT NULL,
            PRIMARY KEY (player_id, event_id, reward_id),
            FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
        )
    `).run());
    claimTablesReady.add(db);
}
const carnivalDegreeByClaim = new Map();
for (const [eventId, tiers] of Object.entries(rewardTable)) {
    for (const [rewardId, , rewards] of tiers) {
        for (const [kind, degreeId] of rewards) {
            if (kind === 7) {
                carnivalDegreeByClaim.set(`${eventId}:${rewardId}`, degreeId);
            }
        }
    }
}
/**
 * Repairs historical Carnival title rewards whose tier was marked claimed
 * before title ownership was persisted.  Claim rows are authoritative here:
 * scores may later be reduced by the duplicate-party conflict rule, while an
 * already claimed reward must remain owned.
 */
function ensurePlayerClaimedCarnivalDegreesSync(playerId) {
    if (!Number.isInteger(playerId) || playerId <= 0)
        return [];
    ensureClaimTableSync();
    const rows = (0, db_1.getDb)().prepare(`
        SELECT event_id, reward_id, claimed_at
        FROM players_carnival_event_reward_claims
        WHERE player_id = ?
        ORDER BY claimed_at ASC, event_id ASC, reward_id ASC
    `).all(playerId);
    const granted = [];
    for (const row of rows) {
        const degreeId = carnivalDegreeByClaim.get(`${row.event_id}:${row.reward_id}`);
        if (degreeId !== undefined &&
            (0, degree_1.grantPlayerDegreeSync)(playerId, degreeId, row.claimed_at) &&
            !granted.includes(degreeId)) {
            granted.push(degreeId);
        }
    }
    if (granted.length > 0) {
        console.log(`[CARNIVAL] restored claimed degrees player=${playerId} degrees=${JSON.stringify(granted)}`);
    }
    return granted;
}
exports.ensurePlayerClaimedCarnivalDegreesSync = ensurePlayerClaimedCarnivalDegreesSync;
/**
 * Grants every reached-but-unclaimed total-score tier atomically.  Looking at
 * the claim table (rather than only the previous score) also repairs players
 * whose score was recorded before server-side Carnival rewards existed.
 */
function grantCarnivalTotalScoreRewardsSync(playerId, eventId, totalBestScore) {
    var _a;
    const tiers = (_a = rewardTable[String(eventId)]) !== null && _a !== void 0 ? _a : [];
    if (tiers.length === 0)
        return emptyResult();
    const db = (0, db_1.getDb)();
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "event", playerId, operation: "grant_carnival_total_score_rewards",
    }, () => {
        ensureClaimTableSync();
        const restoredDegreeIds = ensurePlayerClaimedCarnivalDegreesSync(playerId);
        const claimedRows = db.prepare(`
        SELECT reward_id FROM players_carnival_event_reward_claims
        WHERE player_id = ? AND event_id = ?
        `).all(playerId, eventId);
        const claimed = new Set(claimedRows.map(row => row.reward_id));
        const reached = tiers.filter(([rewardId, score]) => score <= totalBestScore && !claimed.has(rewardId));
        if (reached.length === 0) {
            return { rewardIds: [], newDegreeIds: restoredDegreeIds, rewards: null };
        }
        const insertClaim = db.prepare(`
        INSERT INTO players_carnival_event_reward_claims
            (player_id, event_id, reward_id, claimed_at)
        VALUES (?, ?, ?, ?)
        `);
        const now = Date.now();
        for (const [rewardId] of reached)
            insertClaim.run(playerId, eventId, rewardId, now);
        // Merge repeated items from adjacent tiers before granting them.  This
        // keeps the response item_list at the actual post-grant inventory total.
        const merged = new Map();
        const newDegreeIds = [...restoredDegreeIds];
        for (const [, , rewards] of reached) {
            for (const reward of rewards) {
                const [kind, id, count] = reward;
                if (kind === 7) {
                    if ((0, degree_1.grantPlayerDegreeSync)(playerId, id) &&
                        !newDegreeIds.includes(id)) {
                        newDegreeIds.push(id);
                    }
                    continue;
                }
                const key = `${kind}:${id}`;
                const existing = merged.get(key);
                if (existing)
                    existing[2] += count;
                else
                    merged.set(key, [...reward]);
            }
        }
        const rewards = [];
        for (const [kind, id, count] of merged.values()) {
            switch (kind) {
                case 0:
                    rewards.push({ type: types_1.RewardType.ITEM, id, count });
                    break;
                case 1:
                    rewards.push({ type: types_1.RewardType.EQUIPMENT, id, count });
                    break;
                case 2:
                    rewards.push({ type: types_1.RewardType.BEADS, count });
                    break;
                case 3:
                    rewards.push({ type: types_1.RewardType.MANA, count });
                    break;
                case 4:
                    rewards.push({ type: types_1.RewardType.EXP, count });
                    break;
                case 6: {
                    for (let index = 0; index < count; index++) {
                        rewards.push({ type: types_1.RewardType.CHARACTER, id });
                    }
                    break;
                }
                default:
                    console.warn(`[CARNIVAL] unsupported total-score reward kind=${kind} id=${id}`);
            }
        }
        const result = rewards.length > 0 ? (0, quest_1.givePlayerRewardsSync)(playerId, rewards) : null;
        const rewardIds = reached.map(([rewardId]) => rewardId);
        console.log(`[CARNIVAL] granted event=${eventId} player=${playerId} total=${totalBestScore} tiers=${JSON.stringify(rewardIds)}`);
        return { rewardIds, newDegreeIds, rewards: result };
    });
}
exports.grantCarnivalTotalScoreRewardsSync = grantCarnivalTotalScoreRewardsSync;
