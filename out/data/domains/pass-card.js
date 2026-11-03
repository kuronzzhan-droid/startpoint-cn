"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setPlayerPassCardRewardReceivedSync = exports.getPlayerPassCardRewardRecordsSync = exports.addPlayerPassCardPointSync = exports.ensurePlayerPassCardLoginProgressSync = exports.getPlayerPassCardStateSync = void 0;
const db_1 = require("../db");
function getPlayerPassCardStateSync(playerId, eventId) {
    var _a;
    const row = (0, db_1.getDb)().prepare(`
        SELECT event_id, point, is_buy, login_baseline
        FROM players_pass_cards
        WHERE player_id = ? AND event_id = ?
    `).get(playerId, eventId);
    return Object.assign({ eventId, point: (_a = row === null || row === void 0 ? void 0 : row.point) !== null && _a !== void 0 ? _a : 0, isBuy: true }, ((row === null || row === void 0 ? void 0 : row.login_baseline) === null || (row === null || row === void 0 ? void 0 : row.login_baseline) === undefined
        ? {}
        : { loginBaseline: row.login_baseline }));
}
exports.getPlayerPassCardStateSync = getPlayerPassCardStateSync;
function ensurePlayerPassCardLoginProgressSync(playerId, eventId, totalLoginDays) {
    const initialBaseline = Math.max(0, totalLoginDays - 1);
    const row = (0, db_1.getDb)().prepare(`
        INSERT INTO players_pass_cards (player_id, event_id, point, is_buy, login_baseline)
        VALUES (?, ?, 0, 0, ?)
        ON CONFLICT(player_id, event_id) DO UPDATE SET
            login_baseline = COALESCE(login_baseline, excluded.login_baseline)
        RETURNING login_baseline
    `).get(playerId, eventId, initialBaseline);
    return Math.max(0, totalLoginDays - row.login_baseline);
}
exports.ensurePlayerPassCardLoginProgressSync = ensurePlayerPassCardLoginProgressSync;
function addPlayerPassCardPointSync(playerId, eventId, amount, maxPoint = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new TypeError("Pass point amount must be a non-negative safe integer.");
    }
    if (!Number.isSafeInteger(maxPoint) || maxPoint < 0) {
        throw new TypeError("Pass point limit must be a non-negative safe integer.");
    }
    const cappedAmount = Math.min(amount, maxPoint);
    const row = (0, db_1.getDb)().prepare(`
        INSERT INTO players_pass_cards (player_id, event_id, point, is_buy, login_baseline)
        VALUES (?, ?, ?, 0, NULL)
        ON CONFLICT(player_id, event_id) DO UPDATE SET
            point = MIN(point + excluded.point, ?)
        RETURNING point
    `).get(playerId, eventId, cappedAmount, maxPoint);
    return row.point;
}
exports.addPlayerPassCardPointSync = addPlayerPassCardPointSync;
function getPlayerPassCardRewardRecordsSync(playerId, eventId) {
    const rows = (0, db_1.getDb)().prepare(`
        SELECT reward_id, is_received_1, is_received_2
        FROM players_pass_card_rewards
        WHERE player_id = ? AND event_id = ?
        ORDER BY reward_id
    `).all(playerId, eventId);
    return rows.map(row => ({
        rewardId: row.reward_id,
        isReceived1: row.is_received_1,
        isReceived2: row.is_received_2,
    }));
}
exports.getPlayerPassCardRewardRecordsSync = getPlayerPassCardRewardRecordsSync;
function setPlayerPassCardRewardReceivedSync(playerId, eventId, rewardId, receive1, receive2) {
    (0, db_1.getDb)().prepare(`
        INSERT INTO players_pass_card_rewards (
            player_id, event_id, reward_id, is_received_1, is_received_2
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(player_id, event_id, reward_id) DO UPDATE SET
            is_received_1 = MAX(is_received_1, excluded.is_received_1),
            is_received_2 = MAX(is_received_2, excluded.is_received_2)
    `).run(playerId, eventId, rewardId, receive1 ? 1 : 0, receive2 ? 1 : 0);
}
exports.setPlayerPassCardRewardReceivedSync = setPlayerPassCardRewardReceivedSync;
