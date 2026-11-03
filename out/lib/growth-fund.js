"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.receiveGrowthFundBonusesSync = exports.getPlayerFundReceiveListSync = exports.GROWTH_FUND_ALWAYS_BOUGHT = void 0;
// 成长基金：测试服默认全部开通。实际发奖以 assets/growth_fund.json 为准（客户端 growth_fund 表只管显示），改奖励两边一起改。
const growth_fund_json_1 = __importDefault(require("../../assets/growth_fund.json"));
const db_1 = require("../data/db");
const stamina_1 = require("./stamina");
exports.GROWTH_FUND_ALWAYS_BOUGHT = true;
let tableReady = false;
function ensureTable() {
    if (tableReady)
        return;
    (0, db_1.getDb)().prepare(`CREATE TABLE IF NOT EXISTS players_growth_fund_rewards (
        player_id INTEGER NOT NULL,
        bonus_id INTEGER NOT NULL,
        received_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, bonus_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();
    tableReady = true;
}
function getPlayerFundReceiveListSync(playerId) {
    ensureTable();
    return (0, db_1.getDb)().prepare(`SELECT bonus_id FROM players_growth_fund_rewards WHERE player_id = ? ORDER BY bonus_id`)
        .all(playerId).map(row => row.bonus_id);
}
exports.getPlayerFundReceiveListSync = getPlayerFundReceiveListSync;
function isQuestCleared(playerId, section, questId) {
    const row = (0, db_1.getDb)().prepare(`SELECT finished FROM players_quest_progress WHERE player_id = ? AND section = ? AND quest_id = ?`)
        .get(playerId, section, questId);
    return (row === null || row === void 0 ? void 0 : row.finished) === 1;
}
function canReceive(playerId, player, bonus) {
    switch (bonus.fundKind) {
        case "rank": return (0, stamina_1.getRankDegree)(player.rankPoint) >= bonus.rank;
        case "main_quest": return isQuestCleared(playerId, 1, bonus.questId);
        case "ex_quest": return isQuestCleared(playerId, 4, bonus.questId);
        default: return false;
    }
}
/** Returns the rewards to grant, or a message when the whole request must be rejected. */
function receiveGrowthFundBonusesSync(playerId, player, bonusIds) {
    ensureTable();
    const received = new Set(getPlayerFundReceiveListSync(playerId));
    const rewards = [];
    const insert = (0, db_1.getDb)().prepare(`INSERT OR IGNORE INTO players_growth_fund_rewards (player_id, bonus_id, received_at) VALUES (?, ?, ?)`);
    const now = Math.floor(Date.now() / 1000);
    const pending = [];
    for (const bonusId of new Set(bonusIds)) {
        const bonus = growth_fund_json_1.default[String(bonusId)];
        if (!bonus)
            return { ok: false, message: `Unknown growth fund bonus ${bonusId}.` };
        if (received.has(bonusId))
            continue;
        if (!canReceive(playerId, player, bonus))
            return { ok: false, message: `Growth fund bonus ${bonusId} is not reached yet.` };
        if (bonus.freeVmoney > 0)
            rewards.push({ kind: 0, amount: bonus.freeVmoney });
        for (const item of bonus.items || [])
            rewards.push({ kind: 1, itemId: item.itemId, amount: item.amount });
        pending.push(bonusId);
    }
    for (const bonusId of pending) {
        insert.run(playerId, bonusId, now);
        received.add(bonusId);
    }
    return { ok: true, rewards, receiveList: [...received].sort((a, b) => a - b) };
}
exports.receiveGrowthFundBonusesSync = receiveGrowthFundBonusesSync;
