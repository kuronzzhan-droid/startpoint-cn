"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSnapshot = exports.takeSnapshot = exports.initializePeriodicMissionSnapshots = exports.buildPeriodicSnapshotData = exports.getPassWeekSnapshotType = void 0;
const cached_statement_1 = require("../cached-statement");
// Periodic snapshot — stores counter baselines for daily/weekly mission reset
const db_1 = require("../../data/db");
const mission_battle_facts_1 = require("../../data/domains/mission_battle_facts");
function getPassWeekSnapshotType(eventId) {
    return `pass-week:${eventId}`;
}
exports.getPassWeekSnapshotType = getPassWeekSnapshotType;
function buildPeriodicSnapshotData(playerId, player, questClears) {
    var _a, _b, _c, _d;
    const counters = (0, mission_battle_facts_1.getMissionBattleCountersSync)(playerId);
    return {
        questClears,
        staminaUsed: (_a = player.totalStaminaUsed) !== null && _a !== void 0 ? _a : 0,
        rankSs: counters.rankSsCount,
        rankS: counters.rankSCount,
        rankA: counters.rankACount,
        rankB: counters.rankBCount,
        singlePlayCount: counters.singlePlayCount,
        singleClearCount: counters.singleClearCount,
        multiPlayCount: counters.multiPlayCount,
        multiClearCount: counters.multiClearCount,
        multiHostClearCount: counters.multiHostClearCount,
        multiGuestClearCount: counters.multiGuestClearCount,
        dashCount: (_b = player.totalDashes) !== null && _b !== void 0 ? _b : 0,
        powerFlipCount: (_c = player.totalPowerflips) !== null && _c !== void 0 ? _c : 0,
        loginDays: (_d = player.totalLoginDays) !== null && _d !== void 0 ? _d : 0,
    };
}
exports.buildPeriodicSnapshotData = buildPeriodicSnapshotData;
function initializePeriodicMissionSnapshots(playerId, player, options = {}) {
    const baseline = buildPeriodicSnapshotData(playerId, player, 0);
    takeSnapshot(playerId, "daily", baseline);
    takeSnapshot(playerId, "weekly", Object.assign(Object.assign({}, baseline), { loginDays: options.countCurrentLoginDay
            ? Math.max(0, baseline.loginDays - 1)
            : baseline.loginDays }));
}
exports.initializePeriodicMissionSnapshots = initializePeriodicMissionSnapshots;
function takeSnapshot(playerId, periodType, data) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT OR REPLACE INTO players_periodic_snapshots
        (player_id, period_type, quest_clears, stamina_used, rank_ss, rank_s, rank_a, rank_b,
         single_play_count, single_clear_count, multi_play_count, multi_clear_count,
         multi_host_clear_count, multi_guest_clear_count, dash_count, power_flip_count,
         login_days, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(playerId, periodType, data.questClears, data.staminaUsed, data.rankSs, data.rankS, data.rankA, data.rankB, data.singlePlayCount, data.singleClearCount, data.multiPlayCount, data.multiClearCount, data.multiHostClearCount, data.multiGuestClearCount, data.dashCount, data.powerFlipCount, data.loginDays);
}
exports.takeSnapshot = takeSnapshot;
function getSnapshot(playerId, periodType) {
    const row = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT quest_clears, stamina_used, rank_ss, rank_s, rank_a, rank_b,
           single_play_count, single_clear_count, multi_play_count, multi_clear_count,
           multi_host_clear_count, multi_guest_clear_count, dash_count, power_flip_count,
           login_days
    FROM players_periodic_snapshots
    WHERE player_id = ? AND period_type = ?
    `).get(playerId, periodType);
    if (!row)
        return null;
    return {
        questClears: row.quest_clears,
        staminaUsed: row.stamina_used,
        rankSs: row.rank_ss,
        rankS: row.rank_s,
        rankA: row.rank_a,
        rankB: row.rank_b,
        singlePlayCount: row.single_play_count,
        singleClearCount: row.single_clear_count,
        multiPlayCount: row.multi_play_count,
        multiClearCount: row.multi_clear_count,
        multiHostClearCount: row.multi_host_clear_count,
        multiGuestClearCount: row.multi_guest_clear_count,
        dashCount: row.dash_count,
        powerFlipCount: row.power_flip_count,
        loginDays: row.login_days,
    };
}
exports.getSnapshot = getSnapshot;
