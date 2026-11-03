"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensurePlayerActivityDegreesSync = exports.grantEligibleRushEventDegreesSync = exports.getEligibleRushDegreeIds = exports.getRushDegreeRewardSourceEventId = exports.grantEligibleRaidEventDegreesSync = exports.getEligibleRaidDegreeIdsSync = exports.getRaidQuestDifficulty = exports.grantEligibleRankingEventDegreesSync = exports.getEligibleRankingDegreeIdsSync = exports.getRankingPlacementSync = exports.rankingEventIdQuestMap = void 0;
const rush_event_ranking_reward_json_1 = __importDefault(require("../../assets/rush_event_ranking_reward.json"));
const db_1 = require("../data/db");
const degree_1 = require("../data/domains/degree");
const cached_statement_1 = require("./cached-statement");
exports.rankingEventIdQuestMap = {
    1: 1001,
    2: 2001,
    3: 3001,
    4: 4001,
    5: 5001,
    1000: 1000001,
    1001: 1001001,
};
const RANKING_TIME_DEGREES = {
    2: [
        { degreeId: 54050, maxElapsedTimeMs: Number.MAX_SAFE_INTEGER },
        { degreeId: 54060, maxElapsedTimeMs: 280000 },
        { degreeId: 54070, maxElapsedTimeMs: 150000 },
        { degreeId: 54080, maxElapsedTimeMs: 80000 },
        { degreeId: 54090, maxElapsedTimeMs: 42000 },
    ],
    3: [
        { degreeId: 54100, maxElapsedTimeMs: Number.MAX_SAFE_INTEGER },
        { degreeId: 54110, maxElapsedTimeMs: 240000 },
        { degreeId: 54120, maxElapsedTimeMs: 120000 },
        { degreeId: 54130, maxElapsedTimeMs: 35000 },
        { degreeId: 54140, maxElapsedTimeMs: 23000 },
    ],
    4: [
        { degreeId: 54150, maxElapsedTimeMs: Number.MAX_SAFE_INTEGER },
        { degreeId: 54160, maxElapsedTimeMs: 420000 },
        { degreeId: 54170, maxElapsedTimeMs: 150000 },
        { degreeId: 54180, maxElapsedTimeMs: 70000 },
        { degreeId: 54190, maxElapsedTimeMs: 45000 },
    ],
};
const RANKING_PERCENTILE_DEGREES = {
    1: [
        { degreeId: 54040, maxPercentile: 0.03 },
        { degreeId: 54030, maxPercentile: 0.10 },
        { degreeId: 54020, maxPercentile: 0.30 },
        { degreeId: 54010, maxPercentile: 0.50 },
        { degreeId: 54000, maxPercentile: 1.00 },
    ],
    5: [
        { degreeId: 54240, maxPercentile: 0.03 },
        { degreeId: 54230, maxPercentile: 0.10 },
        { degreeId: 54220, maxPercentile: 0.30 },
        { degreeId: 54210, maxPercentile: 0.50 },
        { degreeId: 54200, maxPercentile: 1.00 },
    ],
};
function getRankingPlacementSync(playerId, eventId) {
    const questId = exports.rankingEventIdQuestMap[eventId];
    if (questId === undefined)
        return null;
    const own = (0, db_1.getDb)().prepare(`
        SELECT best_elapsed_time_ms
        FROM players_quest_progress
        WHERE player_id = ? AND section = 11 AND quest_id = ?
          AND finished = 1 AND best_elapsed_time_ms > 0
    `).get(playerId, questId);
    if (!own)
        return null;
    const placement = (0, db_1.getDb)().prepare(`
        SELECT
            COUNT(*) AS participant_count,
            1 + SUM(CASE WHEN best_elapsed_time_ms < ? THEN 1 ELSE 0 END) AS rank_number
        FROM players_quest_progress
        WHERE section = 11 AND quest_id = ?
          AND finished = 1 AND best_elapsed_time_ms > 0
    `).get(own.best_elapsed_time_ms, questId);
    const participantCount = Math.max(1, Number(placement.participant_count) || 0);
    const rankNumber = Math.max(1, Number(placement.rank_number) || 1);
    return {
        bestElapsedTimeMs: own.best_elapsed_time_ms,
        participantCount,
        rankNumber,
        percentile: rankNumber / participantCount,
    };
}
exports.getRankingPlacementSync = getRankingPlacementSync;
function getEligibleRankingDegreeIdsSync(playerId, eventId) {
    const placement = getRankingPlacementSync(playerId, eventId);
    if (!placement)
        return [];
    const timeRules = RANKING_TIME_DEGREES[eventId];
    if (timeRules) {
        return timeRules
            .filter(rule => placement.bestElapsedTimeMs <= rule.maxElapsedTimeMs)
            .map(rule => rule.degreeId);
    }
    const percentileRules = RANKING_PERCENTILE_DEGREES[eventId];
    const matched = percentileRules === null || percentileRules === void 0 ? void 0 : percentileRules.find(rule => placement.percentile <= rule.maxPercentile);
    return matched ? [matched.degreeId] : [];
}
exports.getEligibleRankingDegreeIdsSync = getEligibleRankingDegreeIdsSync;
function grantDegreeIds(playerId, degreeIds) {
    const granted = [];
    for (const degreeId of degreeIds) {
        if ((0, degree_1.grantPlayerDegreeSync)(playerId, degreeId))
            granted.push(degreeId);
    }
    return granted;
}
function grantEligibleRankingEventDegreesSync(playerId, eventId) {
    return grantDegreeIds(playerId, getEligibleRankingDegreeIdsSync(playerId, eventId));
}
exports.grantEligibleRankingEventDegreesSync = grantEligibleRankingEventDegreesSync;
function getRaidQuestDifficulty(questId) {
    if (questId === 7001)
        return "super";
    if (questId === 7002)
        return "hell";
    if (questId < 7003 || questId > 7026)
        return null;
    return ["beginner", "advanced", "super", "hell"][(questId - 7003) % 4];
}
exports.getRaidQuestDifficulty = getRaidQuestDifficulty;
const RAID_DEGREE_RULES = [
    { difficulty: "hell", count: 700, offset: 0 },
    { difficulty: "hell", count: 300, offset: 1 },
    { difficulty: "hell", count: 100, offset: 2 },
    { difficulty: "hell", count: 10, offset: 3 },
    { difficulty: "super", count: 200, offset: 4 },
    { difficulty: "super", count: 100, offset: 5 },
    { difficulty: "super", count: 50, offset: 6 },
    { difficulty: "super", count: 10, offset: 7 },
    { difficulty: "advanced", count: 100, offset: 8 },
    { difficulty: "advanced", count: 50, offset: 9 },
    { difficulty: "advanced", count: 10, offset: 10 },
    { difficulty: "beginner", count: 100, offset: 11 },
    { difficulty: "beginner", count: 10, offset: 12 },
];
function getEligibleRaidDegreeIdsSync(playerId, eventId) {
    if (!Number.isInteger(eventId) || eventId < 1 || eventId > 7)
        return [];
    const rows = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT quest_id, COUNT(*) AS clear_count
        FROM raid_event_global_kill_ledger
        WHERE player_id = ? AND event_id = ?
        GROUP BY quest_id
    `).all(playerId, eventId);
    const counts = {
        beginner: 0,
        advanced: 0,
        super: 0,
        hell: 0,
    };
    for (const row of rows) {
        const difficulty = getRaidQuestDifficulty(row.quest_id);
        if (difficulty)
            counts[difficulty] += Math.max(0, Number(row.clear_count) || 0);
    }
    const baseDegreeId = 63000 + (eventId - 1) * 13;
    return RAID_DEGREE_RULES
        .filter(rule => counts[rule.difficulty] >= rule.count)
        .map(rule => baseDegreeId + rule.offset);
}
exports.getEligibleRaidDegreeIdsSync = getEligibleRaidDegreeIdsSync;
function grantEligibleRaidEventDegreesSync(playerId, eventId) {
    return grantDegreeIds(playerId, getEligibleRaidDegreeIdsSync(playerId, eventId));
}
exports.grantEligibleRaidEventDegreesSync = grantEligibleRaidEventDegreesSync;
const rushRewards = rush_event_ranking_reward_json_1.default;
/**
 * Rush reruns reuse the original event's endless-round title milestones.
 * These rewards are unrelated to leaderboard placement despite the legacy
 * master-data filename and field names.
 */
function getRushDegreeRewardSourceEventId(eventId) {
    return eventId >= 700011 && eventId <= 700017 ? eventId - 10 : eventId;
}
exports.getRushDegreeRewardSourceEventId = getRushDegreeRewardSourceEventId;
function getEligibleRushDegreeIds(eventId, maxRound) {
    var _a;
    if (!Number.isFinite(maxRound) || Number(maxRound) <= 0)
        return [];
    const rewardSourceEventId = getRushDegreeRewardSourceEventId(eventId);
    const eventRewards = (_a = rushRewards[String(rewardSourceEventId)]) !== null && _a !== void 0 ? _a : {};
    const degreeIds = [];
    for (const entries of Object.values(eventRewards)) {
        for (const entry of entries) {
            if (entry.kind === 7
                && maxRound >= entry.fromRank
                && maxRound <= entry.toRank) {
                degreeIds.push(entry.kindId);
            }
        }
    }
    return degreeIds;
}
exports.getEligibleRushDegreeIds = getEligibleRushDegreeIds;
function grantEligibleRushEventDegreesSync(playerId, eventId, maxRound) {
    var _a;
    const resolvedMaxRound = maxRound !== null && maxRound !== void 0 ? maxRound : (_a = (0, db_1.getDb)().prepare(`
        SELECT endless_battle_max_round
        FROM players_rush_events
        WHERE player_id = ? AND event_id = ?
    `).get(playerId, eventId)) === null || _a === void 0 ? void 0 : _a.endless_battle_max_round;
    return grantDegreeIds(playerId, getEligibleRushDegreeIds(eventId, resolvedMaxRound));
}
exports.grantEligibleRushEventDegreesSync = grantEligibleRushEventDegreesSync;
/** Restores activity titles from authoritative persisted results when profile data is opened. */
function ensurePlayerActivityDegreesSync(playerId) {
    const granted = [];
    for (const eventId of [1, 2, 3, 4, 5]) {
        granted.push(...grantEligibleRankingEventDegreesSync(playerId, eventId));
    }
    const raidEvents = (0, db_1.getDb)().prepare(`
        SELECT DISTINCT event_id
        FROM raid_event_global_kill_ledger
        WHERE player_id = ?
    `).all(playerId);
    for (const row of raidEvents) {
        granted.push(...grantEligibleRaidEventDegreesSync(playerId, row.event_id));
    }
    const rushEvents = (0, db_1.getDb)().prepare(`
        SELECT event_id, endless_battle_max_round
        FROM players_rush_events
        WHERE player_id = ? AND endless_battle_max_round IS NOT NULL
    `).all(playerId);
    for (const row of rushEvents) {
        granted.push(...grantEligibleRushEventDegreesSync(playerId, row.event_id, row.endless_battle_max_round));
    }
    return granted;
}
exports.ensurePlayerActivityDegreesSync = ensurePlayerActivityDegreesSync;
