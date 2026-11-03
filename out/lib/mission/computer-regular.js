"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegularComputer = void 0;
const cached_statement_1 = require("../cached-statement");
const main_quest_json_1 = __importDefault(require("../../../assets/main_quest.json"));
const ex_quest_json_1 = __importDefault(require("../../../assets/ex_quest.json"));
const db_1 = require("../../data/db");
const stamina_1 = require("../stamina");
const types_1 = require("../types");
const counters_1 = require("./counters");
const evaluation_context_1 = require("./evaluation-context");
const master_data_1 = require("./master-data");
const patterns_1 = require("./patterns");
const chapterKeyByMissionId = new Map();
const questIdsByChapter = new Map();
for (const [category, quests] of [
    [types_1.QuestCategory.MAIN, main_quest_json_1.default],
    [types_1.QuestCategory.EX, ex_quest_json_1.default],
]) {
    for (const id of Object.keys(quests)) {
        const questId = Number(id);
        const chapter = Math.floor(questId / 1000000);
        if (!Number.isSafeInteger(questId) || chapter <= 0)
            continue;
        const key = `${category}:${chapter}`;
        const ids = (_a = questIdsByChapter.get(key)) !== null && _a !== void 0 ? _a : [];
        ids.push(questId);
        questIdsByChapter.set(key, ids);
    }
}
for (const definition of (0, master_data_1.getMissionMasterDefinitions)(1)) {
    if (Number(definition.row[2]) !== 22)
        continue;
    // Mission master uses 0/1 for normal/EX, not the API section IDs 1/4.
    const mode = String(definition.row[7]);
    const chapter = Number(definition.row[8]);
    if ((mode !== "0" && mode !== "1") || !Number.isSafeInteger(chapter) || chapter <= 0)
        continue;
    const category = mode === "0" ? types_1.QuestCategory.MAIN : types_1.QuestCategory.EX;
    chapterKeyByMissionId.set(definition.missionId, `${category}:${chapter}`);
}
function readCompletedChapters(playerId, missionIds) {
    var _a;
    const requestedChapters = new Set(missionIds === undefined
        ? chapterKeyByMissionId.values()
        : missionIds.flatMap(missionId => {
            const key = chapterKeyByMissionId.get(missionId);
            return key === undefined ? [] : [key];
        }));
    const completed = new Set();
    if (requestedChapters.size === 0)
        return completed;
    // Recover old saves from authoritative clear records. Only read the two
    // chapter sections and IDs, not every event quest's full progress payload.
    const rows = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT section, quest_id FROM players_quest_progress
        WHERE player_id = ? AND section IN (?, ?) AND finished = 1
    `).all(playerId, types_1.QuestCategory.MAIN, types_1.QuestCategory.EX);
    const finished = new Set(rows.map(row => `${row.section}:${row.quest_id}`));
    for (const key of requestedChapters) {
        const required = (_a = questIdsByChapter.get(key)) !== null && _a !== void 0 ? _a : [];
        const category = key.split(":")[0];
        // MAIN includes story nodes as well as battles. An empty/missing
        // chapter or a finished quest in another section cannot complete it.
        if (required.length > 0 && required.every(id => finished.has(`${category}:${id}`))) {
            completed.add(key);
        }
    }
    return completed;
}
function rescueRankQuery(rank) {
    return {
        dimension: "battle.multi_rescue_clear",
        scopeType: "lifetime",
        scopeKey: "all",
        qualifier: { questRank: rank },
    };
}
function buildStats(playerId, category, missionIds, shared = new evaluation_context_1.MissionEvaluationReadContext(playerId)) {
    const player = shared.player;
    // Keep full quest histories out of regular/daily/weekly/pass contexts;
    // chapter missions use a separate, narrowly scoped finished-ID read.
    const totalQuestClears = category === 7
        ? shared.totalQuestClears
        : 0;
    const snapshot = category === 2 || category === 6
        ? shared.snapshot("daily")
        : category === 7 || category === 10
            ? shared.snapshot("weekly")
            : null;
    const rescueRanks = category !== 1
        ? []
        : missionIds === undefined
            ? [1, 2, 3, 4, 5]
            : [...new Set(missionIds.flatMap(missionId => {
                    const match = (0, patterns_1.getMissionPattern)(category, missionId).match(/^boss_battle_attention_rank([1-5])$/);
                    return match ? [Number(match[1])] : [];
                }))];
    const rescueQueries = rescueRanks.map(rescueRankQuery);
    return {
        category,
        playerId,
        player,
        questProgress: {},
        totalQuestClears,
        totalStories: 0,
        rankCounts: {},
        battleCounters: shared.battleCounters,
        missionCounterValues: shared.missionCounters(rescueQueries),
        snapshot,
        completedChapters: category === 1
            ? readCompletedChapters(playerId, missionIds)
            : new Set(),
    };
}
function periodValue(current, baseline) {
    return Math.max(0, current - (baseline !== null && baseline !== void 0 ? baseline : 0));
}
function computeLifetime(pattern, ctx, dbProgress) {
    var _a, _b, _c, _d, _e, _f;
    const counters = ctx.battleCounters;
    if (pattern === "max_combo")
        return Math.max(dbProgress, (_a = ctx.player.maxComboAchieved) !== null && _a !== void 0 ? _a : 0);
    if (pattern === "rank_ss")
        return Math.max(dbProgress, counters.rankSsCount);
    if (pattern === "use_dash")
        return Math.max(dbProgress, (_b = ctx.player.totalDashes) !== null && _b !== void 0 ? _b : 0);
    if (pattern === "single_battle_play")
        return Math.max(dbProgress, counters.singleClearCount);
    if (pattern === "use_power_flip")
        return Math.max(dbProgress, (_c = ctx.player.totalPowerflips) !== null && _c !== void 0 ? _c : 0);
    if (pattern === "user_rank")
        return Math.max(dbProgress, (0, stamina_1.getRankDegree)(ctx.player.rankPoint));
    if (pattern === "total_login")
        return Math.max(dbProgress, (_d = ctx.player.totalLoginDays) !== null && _d !== void 0 ? _d : 0);
    if (pattern === "multi_battle_play")
        return Math.max(dbProgress, counters.multiClearCount);
    if (pattern === "multi_play_host")
        return Math.max(dbProgress, counters.multiHostClearCount);
    if (pattern === "multi_play_guest")
        return Math.max(dbProgress, counters.multiGuestClearCount);
    const rescueRankMatch = pattern.match(/^boss_battle_attention_rank([1-5])$/);
    if (rescueRankMatch) {
        const query = rescueRankQuery(Number(rescueRankMatch[1]));
        return Math.max(dbProgress, (_f = (_e = ctx.missionCounterValues) === null || _e === void 0 ? void 0 : _e.get((0, counters_1.makeMissionCounterKey)(query))) !== null && _f !== void 0 ? _f : 0);
    }
    return dbProgress;
}
function computeDaily(pattern, ctx, dbProgress) {
    var _a, _b;
    const snapshot = ctx.snapshot;
    const counters = ctx.battleCounters;
    if (/^single_battle_play(?:_[23])?$/.test(pattern)) {
        return Math.max(dbProgress, periodValue(counters.singleClearCount, snapshot === null || snapshot === void 0 ? void 0 : snapshot.singleClearCount));
    }
    if (/^multi_battle_play(?:_[23])?$/.test(pattern)) {
        return Math.max(dbProgress, periodValue(counters.multiClearCount, snapshot === null || snapshot === void 0 ? void 0 : snapshot.multiClearCount));
    }
    if (/^use_dash(?:_[23])?$/.test(pattern)) {
        return Math.max(dbProgress, periodValue((_a = ctx.player.totalDashes) !== null && _a !== void 0 ? _a : 0, snapshot === null || snapshot === void 0 ? void 0 : snapshot.dashCount));
    }
    if (pattern === "daily_quest_stamina_use_2024_02") {
        return Math.max(dbProgress, periodValue((_b = ctx.player.totalStaminaUsed) !== null && _b !== void 0 ? _b : 0, snapshot === null || snapshot === void 0 ? void 0 : snapshot.staminaUsed));
    }
    return dbProgress;
}
function computeWeekly(pattern, ctx, dbProgress) {
    var _a;
    const snapshot = ctx.snapshot;
    const counters = ctx.battleCounters;
    if (pattern === "weekly_mission_1") {
        return Math.max(dbProgress, periodValue((_a = ctx.player.totalLoginDays) !== null && _a !== void 0 ? _a : 0, snapshot === null || snapshot === void 0 ? void 0 : snapshot.loginDays));
    }
    if (pattern === "weekly_mission_2") {
        return Math.max(dbProgress, periodValue(counters.multiClearCount, snapshot === null || snapshot === void 0 ? void 0 : snapshot.multiClearCount));
    }
    return dbProgress;
}
exports.RegularComputer = {
    name: "Regular",
    buildContext(playerId, category, _evaluationTime, missionIds, readContext) {
        return buildStats(playerId, category, missionIds, readContext);
    },
    compute(missionId, ctx, dbProgress) {
        const pattern = (0, patterns_1.getMissionPattern)(ctx.category, missionId);
        if (ctx.category === 1) {
            const chapterKey = chapterKeyByMissionId.get(missionId);
            if (chapterKey !== undefined) {
                return Math.max(dbProgress, ctx.completedChapters.has(chapterKey) ? 1 : 0);
            }
            return computeLifetime(pattern, ctx, dbProgress);
        }
        if (ctx.category === 2)
            return computeDaily(pattern, ctx, dbProgress);
        if (ctx.category === 10)
            return computeWeekly(pattern, ctx, dbProgress);
        return dbProgress;
    },
};
