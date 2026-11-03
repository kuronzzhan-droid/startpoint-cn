"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantSoloTimeAttackClearTimeRewardsSync = void 0;
// 极时试炼通关时间奖励（作者 1103，开服前补）：官方 solo_time_attack_clear_time_reward 表（222 档，每关 37 档）
// 导出成 assets/solo_time_attack_clear_time_reward.json。结算时把这次时间达到、以前没发过的档位一次发完；
// 每档只发一次（players_solo_time_attack_rewards 记账）。称号（kind 7）由 degree.js 的时间称号规则发，这里跳过。
const solo_time_attack_clear_time_reward_json_1 = __importDefault(require("../../assets/solo_time_attack_clear_time_reward.json"));
const db_1 = require("../data/db");
const mail_1 = require("../data/domains/mail");
const TIERS = Object.entries(solo_time_attack_clear_time_reward_json_1.default).map(([key, tier]) => (Object.assign({ key: Number(key) }, tier)));
// 客户端 GeneralRewardKind：0 道具 1 装备 2 星导石 3 玛娜 4 经验池 5 修行点数 6 角色 7 称号
const MAIL_TYPE_BY_KIND = {
    0: mail_1.MailType.ITEM,
    1: mail_1.MailType.EQUIPMENT,
    2: mail_1.MailType.FREE_VMONEY,
    3: mail_1.MailType.FREE_MANA,
    4: mail_1.MailType.EXP_POOL,
    5: mail_1.MailType.PASS_CARD_POINT,
    6: mail_1.MailType.CHARACTER,
};
const SUBJECT = "极时试炼通关时间奖励";
let tableReady = false;
function ensureTable() {
    if (tableReady)
        return;
    (0, db_1.getDb)().prepare(`CREATE TABLE IF NOT EXISTS players_solo_time_attack_rewards (
        player_id INTEGER NOT NULL,
        reward_key INTEGER NOT NULL,
        granted_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, reward_key),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();
    tableReady = true;
}
/** 返回这次新发的档位 key 列表（客户端 solo_time_attack_clear_time_reward 的键，结算动画用）。elapsedTimeMs 是本次（或历史最好）通关时间。 */
function grantSoloTimeAttackClearTimeRewardsSync(playerId, questId, elapsedTimeMs) {
    if (!Number.isFinite(elapsedTimeMs) || elapsedTimeMs < 0)
        return [];
    ensureTable();
    const db = (0, db_1.getDb)();
    const insert = db.prepare(`INSERT OR IGNORE INTO players_solo_time_attack_rewards (player_id, reward_key, granted_at) VALUES (?, ?, ?)`);
    const now = Date.now();
    const sums = new Map();
    const rewardIds = [];
    for (const tier of TIERS) {
        if (tier.questId !== questId || elapsedTimeMs > tier.clearTimeMs)
            continue;
        if (insert.run(playerId, tier.key, now).changes === 0)
            continue;
        rewardIds.push(tier.key);
        for (const reward of tier.rewards) {
            const type = MAIL_TYPE_BY_KIND[reward.kind];
            if (type === undefined)
                continue;
            const key = `${type}:${reward.id === null ? "" : reward.id}`;
            const prev = sums.get(key);
            sums.set(key, { type, typeId: reward.id, number: (prev ? prev.number : 0) + reward.count });
        }
    }
    const createTime = new Date().toISOString().replace("T", " ").substring(0, 19);
    for (const { type, typeId, number } of sums.values()) {
        (0, mail_1.insertMailSync)(playerId, {
            reason_id: 0, subject: SUBJECT, description: `${SUBJECT}（${rewardIds.length} 档）`,
            type, type_id: typeId, number,
            receive_time: "0000-00-00 00:00:00", create_time: createTime,
            reward_period_limited: 0, reward_limit_time: null,
        });
    }
    return rewardIds;
}
exports.grantSoloTimeAttackClearTimeRewardsSync = grantSoloTimeAttackClearTimeRewardsSync;
