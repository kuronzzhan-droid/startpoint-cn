"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.awardBattleStarCrumbSync = exports.STAR_CRUMB_BATTLE_RULES = void 0;
// 星之碎片战斗奖励（作者 1103，开荒编排「星之碎片优化推荐」；1104 编排 16 回调）：
// 只保留每周第三局协力胜利发 1200，走邮件；单局入账和每日第一局协力奖励取消（数值为 0 即不发）。
// 客户端任务奖励没有星碎类型，所以每日 / 每周这两档不进任务面板，只发邮件。
const db_1 = require("../data/db");
const player_1 = require("../data/domains/player");
const mail_1 = require("../data/domains/mail");
const time_utils_1 = require("./time-utils");
exports.STAR_CRUMB_BATTLE_RULES = {
    single: 0,
    multi: 0,
    dailyMultiCount: 1,
    dailyMultiReward: 0,
    weeklyMultiCount: 3,
    weeklyMultiReward: 1200,
};
let tableReady = false;
function ensureTable() {
    if (tableReady)
        return;
    (0, db_1.getDb)().prepare(`CREATE TABLE IF NOT EXISTS players_star_crumb_battle (
        player_id INTEGER PRIMARY KEY,
        day_key INTEGER NOT NULL,
        day_multi_count INTEGER NOT NULL,
        week_key INTEGER NOT NULL,
        week_multi_count INTEGER NOT NULL,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();
    tableReady = true;
}
function dayKey(date) {
    const b = (0, time_utils_1.getDayBucket)(date);
    return Date.UTC(b.y, b.m, b.d) / 86400000;
}
function sendStarCrumbMail(playerId, number, subject) {
    (0, mail_1.insertMailSync)(playerId, {
        reason_id: 0,
        subject,
        description: subject,
        type: mail_1.MailType.STAR_CRUMB,
        type_id: null,
        number,
        receive_time: '0000-00-00 00:00:00',
        create_time: new Date().toISOString().replace('T', ' ').substring(0, 19),
        reward_period_limited: 0,
        reward_limit_time: null,
    });
}
/** 战斗胜利结算时调用（单人 / 协力的房主和房客都算）；失败局不给。 */
function awardBattleStarCrumbSync(ctx, evaluationTime) {
    if (!ctx.questAccomplished)
        return;
    const rules = exports.STAR_CRUMB_BATTLE_RULES;
    const player = (0, player_1.getPlayerSync)(ctx.playerId);
    if (!player)
        return;
    const perBattle = ctx.isMulti === true ? rules.multi : rules.single;
    if (perBattle > 0)
        (0, player_1.updatePlayerSync)({ id: ctx.playerId, starCrumb: player.starCrumb + perBattle });
    if (ctx.isMulti !== true)
        return;
    ensureTable();
    const db = (0, db_1.getDb)();
    const today = dayKey(evaluationTime);
    const week = (0, time_utils_1.getWeekBucket)(evaluationTime).w;
    const row = db.prepare(`SELECT day_key, day_multi_count, week_key, week_multi_count FROM players_star_crumb_battle WHERE player_id = ?`).get(ctx.playerId);
    const dayCount = (row && row.day_key === today ? row.day_multi_count : 0) + 1;
    const weekCount = (row && row.week_key === week ? row.week_multi_count : 0) + 1;
    db.prepare(`INSERT INTO players_star_crumb_battle (player_id, day_key, day_multi_count, week_key, week_multi_count) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(player_id) DO UPDATE SET day_key = excluded.day_key, day_multi_count = excluded.day_multi_count,
        week_key = excluded.week_key, week_multi_count = excluded.week_multi_count`).run(ctx.playerId, today, dayCount, week, weekCount);
    if (dayCount === rules.dailyMultiCount && rules.dailyMultiReward > 0)
        sendStarCrumbMail(ctx.playerId, rules.dailyMultiReward, '每日协力奖励');
    if (weekCount === rules.weeklyMultiCount && rules.weeklyMultiReward > 0)
        sendStarCrumbMail(ctx.playerId, rules.weeklyMultiReward, '每周协力奖励');
}
exports.awardBattleStarCrumbSync = awardBattleStarCrumbSync;
