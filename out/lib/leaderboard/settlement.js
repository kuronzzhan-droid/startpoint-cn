"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLeaderboardSettlementScheduler = exports.runDueLeaderboardSettlements = exports.runDueLeaderboardSettlementsSync = exports.settleLeaderboardSeason = exports.runLeaderboardSettlementWorkerSync = exports.getLeaderboardSettlementOverviewSync = exports.rolloverLeaderboardSeasonSync = exports.settleLeaderboardSeasonSync = exports.getLeaderboardSeasonRewardViewSync = exports.getLeaderboardRewardRankFilter = exports.validateRewardTiers = exports.putLeaderboardSettlementConfigSync = exports.getLeaderboardSettlementConfigSync = void 0;
const db_1 = require("../../data/db");
const leaderboard_1 = require("../../data/domains/leaderboard");
const content_master_1 = require("../content-master");
const mail_1 = require("../../data/domains/mail");
const competition_1 = require("./competition");
const rewards_1 = require("./rewards");
const availability_1 = require("./availability");
const persistence_coordinator_1 = require("../persistence-coordinator");
const work_control_1 = require("./work-control");
const sync_budget_1 = require("./sync-budget");
const node_worker_threads_1 = require("node:worker_threads");
const persistence_admission_1 = require("../persistence-admission");
const sqlite_write_coordinator_1 = require("../sqlite-write-coordinator");
const shutdown_state_1 = require("../shutdown-state");
const worker_cancellation_1 = require("./worker-cancellation");
function defaultConfig(competitionKey, nowMs) {
    var _a, _b;
    const displayName = (_b = (_a = (0, competition_1.getLeaderboardCompetition)(competitionKey)) === null || _a === void 0 ? void 0 : _a.displayName) !== null && _b !== void 0 ? _b : competitionKey;
    return {
        competitionKey,
        autoEnabled: false,
        freezeEnabled: false,
        settleAtMs: null,
        repeatIntervalMs: null,
        rewardTiers: competitionKey === "rush:700100:1"
            ? (0, rewards_1.buildAbyssExRewardRules)(getLeaderboardSettlementConfigSync("rush:700099:1", nowMs).rewardTiers)
            : [...(0, rewards_1.getLeaderboardRewardTiers)(competitionKey)],
        mailSubject: `${displayName}赛季排名报酬`,
        mailBody: `感谢参与${displayName}。本邮件为本赛季最终排名报酬。`,
        excludeBots: true,
        updatedAtMs: nowMs,
    };
}
function deserializeConfig(row) {
    return {
        competitionKey: row.competition_key,
        autoEnabled: row.auto_enabled !== 0,
        freezeEnabled: row.freeze_enabled !== 0 || row.auto_enabled !== 0,
        settleAtMs: row.settle_at_ms,
        repeatIntervalMs: row.repeat_interval_ms,
        rewardTiers: JSON.parse(row.reward_tiers_json),
        mailSubject: row.mail_subject,
        mailBody: row.mail_body,
        excludeBots: row.exclude_bots !== 0,
        updatedAtMs: row.updated_at_ms,
    };
}
function getLeaderboardSettlementConfigSync(competitionKey, nowMs = Date.now()) {
    const read = () => (0, db_1.getDb)().prepare(`SELECT * FROM leaderboard_settlement_configs WHERE competition_key = ?`)
        .get(competitionKey);
    let row = read();
    if (!row) {
        const initial = defaultConfig(competitionKey, nowMs);
        row = (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "leaderboard", operation: "initialize_settlement_config" }, () => {
            (0, db_1.getDb)().prepare(`
                INSERT OR IGNORE INTO leaderboard_settlement_configs (
                    competition_key, auto_enabled, settle_at_ms, repeat_interval_ms,
                    reward_tiers_json, mail_subject, mail_body, exclude_bots, updated_at_ms
                ) VALUES (?, 0, NULL, NULL, ?, ?, ?, 1, ?)
            `).run(competitionKey, JSON.stringify(initial.rewardTiers), initial.mailSubject, initial.mailBody, nowMs);
            return read();
        });
    }
    const config = deserializeConfig(row);
    const upgraded = (0, rewards_1.upgradeLeaderboardRewardRules)(competitionKey, config.rewardTiers);
    if (upgraded !== null) {
        config.rewardTiers = competitionKey === "rush:700100:1" && config.rewardTiers.length === 0
            ? defaultConfig(competitionKey, nowMs).rewardTiers : upgraded;
        config.updatedAtMs = nowMs;
        (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "leaderboard", operation: "upgrade_settlement_config" }, () => putLeaderboardSettlementConfigSync(config));
    }
    return config;
}
exports.getLeaderboardSettlementConfigSync = getLeaderboardSettlementConfigSync;
function putLeaderboardSettlementConfigSync(config) {
    validateRewardTiers(config.rewardTiers);
    if (typeof config.autoEnabled !== "boolean" || typeof config.freezeEnabled !== "boolean") {
        throw new Error("Schedule switches must be booleans.");
    }
    if (config.settleAtMs !== null && (!Number.isSafeInteger(config.settleAtMs)
        || config.settleAtMs < 0 || config.settleAtMs > 8640000000000000 - 28800000)) {
        throw new Error("settleAtMs must be an epoch millisecond value or null.");
    }
    if (config.repeatIntervalMs !== null
        && (!Number.isSafeInteger(config.repeatIntervalMs) || config.repeatIntervalMs <= 0))
        throw new Error("repeatIntervalMs must be a positive millisecond value or null.");
    (0, db_1.getDb)().prepare(`
        INSERT INTO leaderboard_settlement_configs (
            competition_key, auto_enabled, freeze_enabled, settle_at_ms, repeat_interval_ms,
            reward_tiers_json, mail_subject, mail_body, exclude_bots, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (competition_key) DO UPDATE SET
            auto_enabled = excluded.auto_enabled,
            freeze_enabled = excluded.freeze_enabled,
            settle_at_ms = excluded.settle_at_ms,
            repeat_interval_ms = excluded.repeat_interval_ms,
            reward_tiers_json = excluded.reward_tiers_json,
            mail_subject = excluded.mail_subject,
            mail_body = excluded.mail_body,
            exclude_bots = excluded.exclude_bots,
            updated_at_ms = excluded.updated_at_ms
    `).run(config.competitionKey, config.autoEnabled ? 1 : 0, config.freezeEnabled || config.autoEnabled ? 1 : 0, config.settleAtMs, config.repeatIntervalMs, JSON.stringify(config.rewardTiers), config.mailSubject, config.mailBody, config.excludeBots ? 1 : 0, config.updatedAtMs);
}
exports.putLeaderboardSettlementConfigSync = putLeaderboardSettlementConfigSync;
function validateRewardTiers(tiers) {
    if (!Array.isArray(tiers))
        throw new Error("Reward tiers must be an array.");
    const percentMode = tiers[0] !== null && typeof tiers[0] === "object"
        && (0, rewards_1.isPercentRewardTier)(tiers[0]);
    let expected = percentMode ? 0 : 1;
    for (const [index, tier] of tiers.entries()) {
        if (tier === null || typeof tier !== "object") {
            throw new Error("Every reward tier must be an object.");
        }
        if ((0, rewards_1.isPercentRewardTier)(tier) !== percentMode) {
            throw new Error("Cannot mix rank and percentage reward tiers.");
        }
        if ((0, rewards_1.isPercentRewardTier)(tier)) {
            if ("fromRank" in tier || "toRank" in tier
                || !Number.isSafeInteger(tier.fromPercent) || tier.fromPercent !== expected
                || !Number.isSafeInteger(tier.toPercent) || tier.toPercent <= tier.fromPercent
                || tier.toPercent > 100) {
                throw new Error("Percentage tiers must be contiguous integer percentages from 0 to 100.");
            }
            expected = tier.toPercent;
        }
        else {
            if ("toPercent" in tier || !Number.isSafeInteger(tier.fromRank) || tier.fromRank !== expected) {
                throw new Error(`Reward tiers must be contiguous from rank ${expected}.`);
            }
            if (tier.toRank !== null && (!Number.isSafeInteger(tier.toRank) || tier.toRank < tier.fromRank))
                throw new Error("Reward tier end rank is invalid.");
            if (tier.toRank === null && index !== tiers.length - 1) {
                throw new Error("An open-ended reward tier must be the final tier.");
            }
            expected = tier.toRank === null ? 0 : tier.toRank + 1;
        }
        if (tier.itemId !== null && (!Number.isSafeInteger(tier.itemId) || tier.itemId <= 0)) {
            throw new Error("Reward item id is invalid.");
        }
        if (!Number.isSafeInteger(tier.itemCount) || tier.itemCount < 0) {
            throw new Error("Reward item count is invalid.");
        }
        if (tier.itemId === null && tier.itemCount !== 0) {
            throw new Error("A reward tier without an item must use itemCount 0.");
        }
        if (tier.itemId !== null && (tier.itemCount <= 0
            || typeof tier.itemName !== "string"
            || tier.itemName.trim() === ""))
            throw new Error("An item reward requires a positive count and item name.");
        if (tier.degreeId !== null && (!Number.isSafeInteger(tier.degreeId) || tier.degreeId <= 0)) {
            throw new Error("Reward degree id is invalid.");
        }
        if (tier.degreeId !== null && (typeof tier.degreeName !== "string" || tier.degreeName.trim() === ""))
            throw new Error("A title reward requires a title name.");
        if (tier.itemId === null && tier.degreeId === null) {
            throw new Error("Every reward tier must grant an item or title.");
        }
    }
    if (percentMode && expected !== 100)
        throw new Error("Percentage tiers must cover through 100%.");
}
exports.validateRewardTiers = validateRewardTiers;
function getLeaderboardRewardRankFilter(config) {
    return config.rewardTiers.some(rewards_1.isPercentRewardTier)
        ? { excludeDeleted: true, excludeBots: config.excludeBots }
        : {};
}
exports.getLeaderboardRewardRankFilter = getLeaderboardRewardRankFilter;
// Settlement snapshots also serve old-season views after configuration changes.
function getLeaderboardSeasonRewardViewSync(competitionKey, season) {
    var _a, _b;
    const settled = (0, db_1.getDb)().prepare(`
        SELECT id, ranked_players, summary_json FROM leaderboard_settlements
        WHERE competition_key = ? AND season = ? AND status = 'completed'
    `).get(competitionKey, season);
    const config = getLeaderboardSettlementConfigSync(competitionKey);
    if (settled !== undefined) {
        const summary = JSON.parse(settled.summary_json);
        // Earlier settlements persisted actual prizes but not display metadata.
        // Recover their ranges from those results, never apply new percentages.
        const rewardTiers = (_a = summary.rewardTiers) !== null && _a !== void 0 ? _a : getLegacySettlementRewardTiers(settled.id, config.rewardTiers);
        return { total: settled.ranked_players, rewardTiers, rewardRules: (_b = summary.rewardRules) !== null && _b !== void 0 ? _b : rewardTiers,
            filter: { settled: true }, settled: true };
    }
    const filter = getLeaderboardRewardRankFilter(config);
    const total = (0, leaderboard_1.countLeaderboardRanksSync)(competitionKey, season, filter);
    return { total, rewardTiers: (0, rewards_1.resolveLeaderboardRewardTiers)(config.rewardTiers, total),
        rewardRules: config.rewardTiers, filter, settled: false };
}
exports.getLeaderboardSeasonRewardViewSync = getLeaderboardSeasonRewardViewSync;
function getLegacySettlementRewardTiers(settlementId, rules) {
    var _a, _b, _c;
    const rows = (0, db_1.getDb)().prepare(`
        SELECT rank_number, item_id, item_count, degree_id
        FROM leaderboard_settlement_results WHERE settlement_id = ? ORDER BY rank_number
    `).all(settlementId);
    const tiers = [];
    for (const row of rows) {
        if (row.item_id === null && row.degree_id === null)
            continue;
        const previous = tiers[tiers.length - 1];
        if (previous && previous.toRank === row.rank_number - 1
            && previous.itemId === row.item_id && previous.itemCount === row.item_count
            && previous.degreeId === row.degree_id) {
            previous.toRank = row.rank_number;
            continue;
        }
        const degree = row.degree_id === null ? undefined
            : content_master_1.degreeDefinitions[row.degree_id];
        tiers.push({
            fromRank: row.rank_number, toRank: row.rank_number,
            itemId: row.item_id, itemCount: row.item_count,
            itemName: row.item_id === null ? null
                : (_b = (_a = rules.find(tier => tier.itemId === row.item_id)) === null || _a === void 0 ? void 0 : _a.itemName) !== null && _b !== void 0 ? _b : `道具 #${row.item_id}`,
            degreeId: row.degree_id,
            degreeName: (_c = degree === null || degree === void 0 ? void 0 : degree.name) !== null && _c !== void 0 ? _c : (row.degree_id === null ? null : `称号 #${row.degree_id}`),
            degreeImage: degree ? `dynamic/degree/${degree.string_id}.png` : null,
        });
    }
    return tiers;
}
function isBotPlayerSync(playerId) {
    const row = (0, db_1.getDb)().prepare(`
        SELECT a.idp_code
        FROM players p JOIN accounts a ON a.id = p.account_id
        WHERE p.id = ?
    `).get(playerId);
    return (row === null || row === void 0 ? void 0 : row.idp_code) === "rushbot";
}
function mailTime(nowMs) {
    return new Date(nowMs).toISOString().replace("T", " ").slice(0, 19);
}
function settleLeaderboardSeasonSync(competitionKey, source, nowMs = Date.now()) {
    return settleLeaderboardSeasonInternal(competitionKey, source, nowMs, true);
}
exports.settleLeaderboardSeasonSync = settleLeaderboardSeasonSync;
function settleLeaderboardSeasonInternal(competitionKey, source, nowMs, synchronous) {
    (0, worker_cancellation_1.assertLeaderboardSettlementNotCancelled)();
    const season = (0, competition_1.getLeaderboardCompetitionSeasonSync)(competitionKey, nowMs);
    const existing = (0, db_1.getDb)().prepare(`
        SELECT id, ranked_players, rewarded_players
        FROM leaderboard_settlements
        WHERE competition_key = ? AND season = ? AND status = 'completed'
    `).get(competitionKey, season);
    if (existing !== undefined) {
        (0, availability_1.setLeaderboardAvailabilitySync)(competitionKey, false, nowMs);
        return {
            ok: true,
            competitionKey,
            season,
            settlementId: existing.id,
            rankedPlayers: existing.ranked_players,
            rewardedPlayers: existing.rewarded_players,
            reason: "already-settled",
        };
    }
    const config = getLeaderboardSettlementConfigSync(competitionKey, nowMs);
    const filter = getLeaderboardRewardRankFilter(config);
    const inTransaction = (0, db_1.getDb)().inTransaction;
    const checkSize = () => synchronous
        ? (0, sync_budget_1.checkSynchronousSettlementSize)(competitionKey, season, filter, config)
        : (0, leaderboard_1.countLeaderboardRanksSync)(competitionKey, season, filter);
    const admittedTotal = checkSize();
    (0, worker_cancellation_1.assertLeaderboardSettlementNotCancelled)();
    // Legacy synchronous jobs are refused before freezing or issuing any mail.
    // Due schedules retain their independent deadline freeze.
    (0, availability_1.setLeaderboardAvailabilitySync)(competitionKey, false, nowMs);
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "leaderboard", operation: "settle_leaderboard_season",
    }, () => {
        // Direct legacy callers may have raced another connection before BEGIN.
        const total = inTransaction ? admittedTotal : checkSize();
        const rewardTiers = (0, rewards_1.resolveLeaderboardRewardTiers)(config.rewardTiers, total);
        const settlement = (0, db_1.getDb)().prepare(`
            INSERT INTO leaderboard_settlements (
                competition_key, season, source, settled_at_ms,
                ranked_players, rewarded_players, status, summary_json
            ) VALUES (?, ?, ?, ?, ?, 0, 'running', '{}')
        `).run(competitionKey, season, source, nowMs, total);
        const settlementId = Number(settlement.lastInsertRowid);
        let rewardedPlayers = 0;
        const skipped = {};
        (0, leaderboard_1.forEachLeaderboardRankBatchSync)(competitionKey, season, filter, record => {
            var _a, _b, _c, _d;
            (0, worker_cancellation_1.assertLeaderboardSettlementNotCancelled)();
            const tier = (0, rewards_1.matchLeaderboardRewardTier)(rewardTiers, record.rankNumber);
            let skipReason = null;
            if (tier === null)
                skipReason = "no-tier";
            else if (!record.playerExists)
                skipReason = "deleted-player";
            else if (config.excludeBots && isBotPlayerSync(record.playerId))
                skipReason = "bot";
            const mailIds = [];
            if (tier !== null && skipReason === null) {
                const base = {
                    reason_id: 0,
                    subject: config.mailSubject,
                    description: `${config.mailBody}\n最终名次：第 ${record.rankNumber} 名`,
                    receive_time: "0000-00-00 00:00:00",
                    create_time: mailTime(nowMs),
                    reward_period_limited: 0,
                    reward_limit_time: null,
                };
                if (tier.itemId !== null && tier.itemCount > 0) {
                    mailIds.push((0, mail_1.insertMailSync)(record.playerId, Object.assign(Object.assign({}, base), { type: mail_1.MailType.ITEM, type_id: tier.itemId, number: tier.itemCount })));
                }
                if (tier.degreeId !== null) {
                    mailIds.push((0, mail_1.insertMailSync)(record.playerId, Object.assign(Object.assign({}, base), { type: mail_1.MailType.DEGREE, type_id: tier.degreeId, number: 1 })));
                }
                if (mailIds.length > 0)
                    rewardedPlayers++;
            }
            else if (skipReason !== null) {
                skipped[skipReason] = ((_a = skipped[skipReason]) !== null && _a !== void 0 ? _a : 0) + 1;
            }
            (0, db_1.getDb)().prepare(`
                INSERT INTO leaderboard_settlement_results (
                    settlement_id, rank_number, run_id, player_id, player_name,
                    client_battle_ms, item_id, item_count, degree_id,
                    skip_reason, mail_ids_json, clear_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(settlementId, record.rankNumber, record.id, record.playerId, record.displayName, record.clientBattleMs, (_b = tier === null || tier === void 0 ? void 0 : tier.itemId) !== null && _b !== void 0 ? _b : null, (_c = tier === null || tier === void 0 ? void 0 : tier.itemCount) !== null && _c !== void 0 ? _c : 0, (_d = tier === null || tier === void 0 ? void 0 : tier.degreeId) !== null && _d !== void 0 ? _d : null, skipReason, JSON.stringify(mailIds), record.clearCount);
        });
        (0, worker_cancellation_1.assertLeaderboardSettlementNotCancelled)();
        (0, db_1.getDb)().prepare(`
            UPDATE leaderboard_settlements
            SET rewarded_players = ?, status = 'completed', summary_json = ?
            WHERE id = ?
        `).run(rewardedPlayers, JSON.stringify({
            skipped, rewardTiers, rewardRules: config.rewardTiers,
            excludeBots: config.excludeBots, rounding: "cumulative-ceiling",
        }), settlementId);
        return {
            ok: true,
            competitionKey,
            season,
            settlementId,
            rankedPlayers: total,
            rewardedPlayers,
        };
    });
}
function rolloverLeaderboardSeasonSync(competitionKey, source, nowMs = Date.now()) {
    const season = (0, competition_1.getLeaderboardCompetitionSeasonSync)(competitionKey, nowMs);
    const settled = (0, db_1.getDb)().prepare(`
        SELECT 1 FROM leaderboard_settlements
        WHERE competition_key = ? AND season = ? AND status = 'completed'
    `).get(competitionKey, season);
    if (settled === undefined)
        return {
            ok: false,
            competitionKey,
            season,
            rolled: false,
            nextSeason: season,
            reason: "season-not-settled",
        };
    const nextSeason = season + 1;
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "leaderboard", operation: "rollover_leaderboard_season",
    }, () => {
        const result = (0, db_1.getDb)().prepare(`
            UPDATE leaderboard_seasons
            SET season = ?, started_at_ms = ?, source = ?
            WHERE competition_key = ? AND season = ?
        `).run(nextSeason, nowMs, source, competitionKey, season);
        if (result.changes !== 1)
            throw new Error("Leaderboard season changed concurrently.");
        (0, leaderboard_1.abandonLeaderboardRunsSync)({ competitionKey, endedAtMs: nowMs });
    });
    return { ok: true, competitionKey, season, rolled: true, nextSeason };
}
exports.rolloverLeaderboardSeasonSync = rolloverLeaderboardSeasonSync;
function getLeaderboardSettlementOverviewSync(competitionKey) {
    const config = getLeaderboardSettlementConfigSync(competitionKey);
    const season = (0, competition_1.getLeaderboardCompetitionSeasonSync)(competitionKey);
    const view = getLeaderboardSeasonRewardViewSync(competitionKey, season);
    const history = (0, db_1.getDb)().prepare(`
        SELECT id, season, source, settled_at_ms, ranked_players,
            rewarded_players, status, summary_json
        FROM leaderboard_settlements
        WHERE competition_key = ? ORDER BY season DESC LIMIT 30
    `).all(competitionKey);
    return {
        competitionKey,
        season,
        total: view.total,
        resolvedRewardTiers: view.rewardTiers,
        config,
        history,
    };
}
exports.getLeaderboardSettlementOverviewSync = getLeaderboardSettlementOverviewSync;
function runDueLeaderboardSettlementSync(competitionKey, nowMs, synchronous = true) {
    const config = getLeaderboardSettlementConfigSync(competitionKey, nowMs);
    if ((!config.freezeEnabled && !config.autoEnabled)
        || config.settleAtMs === null || config.settleAtMs > nowMs)
        return null;
    (0, availability_1.getLeaderboardAvailabilitySync)(competitionKey, nowMs);
    if (!config.autoEnabled)
        return null;
    const outcome = settleLeaderboardSeasonInternal(competitionKey, "scheduler", nowMs, synchronous);
    if (!outcome.ok)
        return outcome;
    (0, worker_cancellation_1.assertLeaderboardSettlementNotCancelled)();
    const nextSettleAtMs = config.repeatIntervalMs === null
        ? null
        : config.settleAtMs + (Math.floor((nowMs - config.settleAtMs) / config.repeatIntervalMs) + 1) * config.repeatIntervalMs;
    putLeaderboardSettlementConfigSync(Object.assign(Object.assign({}, config), { settleAtMs: nextSettleAtMs, autoEnabled: config.repeatIntervalMs !== null, freezeEnabled: config.repeatIntervalMs !== null, updatedAtMs: nowMs }));
    return outcome;
}
/** Only the dedicated worker may remove synchronous ceilings, inside its atomic transaction. */
function runLeaderboardSettlementWorkerSync(input) {
    (0, worker_cancellation_1.assertLeaderboardSettlementNotCancelled)();
    if (node_worker_threads_1.isMainThread || !(0, db_1.getDb)().inTransaction)
        throw new Error("Background settlement requires a worker-owned transaction.");
    if ((0, competition_1.getLeaderboardCompetitionSeasonSync)(input.competitionKey, input.nowMs) !== input.season) {
        throw new Error("Leaderboard season changed before background settlement; no rewards issued.");
    }
    return input.scheduled
        ? runDueLeaderboardSettlementSync(input.competitionKey, input.nowMs, false)
        : settleLeaderboardSeasonInternal(input.competitionKey, input.source, input.nowMs, false);
}
exports.runLeaderboardSettlementWorkerSync = runLeaderboardSettlementWorkerSync;
/** Manual HTTP callers keep their result contract while all ranking and mail work runs off-thread. */
function settleLeaderboardSeason(competitionKey, source, nowMs, expectedSeason) {
    return work_control_1.runLeaderboardWork.background(competitionKey, "settle", () => __awaiter(this, void 0, void 0, function* () {
        const { runLeaderboardSettlementInBackground } = yield Promise.resolve().then(() => __importStar(require("./background-worker")));
        const outcome = yield runLeaderboardSettlementInBackground({ competitionKey, source, nowMs, scheduled: false, expectedSeason });
        if (!outcome)
            throw new Error("Manual leaderboard settlement returned no result.");
        return outcome;
    }));
}
exports.settleLeaderboardSeason = settleLeaderboardSeason;
function runDueLeaderboardSettlementsSync(nowMs = Date.now()) {
    for (const competition of (0, competition_1.getLeaderboardCompetitions)()) {
        runDueLeaderboardSettlementSync(competition.key, nowMs);
    }
}
exports.runDueLeaderboardSettlementsSync = runDueLeaderboardSettlementsSync;
/**
 * Run scheduled leaderboard writes through the persistence ownership queue.
 * Each due job uses the same worker and atomic commit as manual settlement.
 * Inactive schedules do not create workers. Deadline freezing is independent.
 */
function runDueLeaderboardSettlements() {
    return __awaiter(this, arguments, void 0, function* (nowMs = Date.now(), shouldStop = shutdown_state_1.isServerShuttingDown) {
        const failures = [];
        for (const competition of (0, competition_1.getLeaderboardCompetitions)()) {
            if (shouldStop() || (0, shutdown_state_1.isServerShuttingDown)())
                break;
            try {
                yield work_control_1.runLeaderboardWork.background(competition.key, "scheduler", () => __awaiter(this, void 0, void 0, function* () {
                    // Read without lazy initialization/freeze writes before the
                    // background gate. Even a small BEGIN could wait on an active
                    // native writer and stall the main loop here.
                    const schedule = (0, db_1.getDb)().prepare(`SELECT c.auto_enabled, c.freeze_enabled, c.settle_at_ms, a.enabled
                    FROM leaderboard_settlement_configs c LEFT JOIN leaderboard_availability a
                    ON a.competition_key=c.competition_key WHERE c.competition_key=?`).get(competition.key);
                    if (!schedule || (!schedule.freeze_enabled && !schedule.auto_enabled)
                        || schedule.settle_at_ms === null || schedule.settle_at_ms > nowMs
                        || (!schedule.auto_enabled && schedule.enabled === 0))
                        return;
                    const { runLeaderboardSettlementInBackground } = yield Promise.resolve().then(() => __importStar(require("./background-worker")));
                    yield runLeaderboardSettlementInBackground({ competitionKey: competition.key, source: "scheduler", nowMs, scheduled: true });
                }));
            }
            catch (error) {
                // An active administrative job owns this turn; the next scheduler
                // tick catches up. A failing/oversized job must not starve other
                // competitions, but its failure is still reported after this tick.
                if (!(error instanceof work_control_1.LeaderboardWorkBusyError))
                    failures.push({ competitionKey: competition.key, error });
            }
        }
        if (failures.length === 1)
            throw failures[0].error;
        if (failures.length > 1)
            throw Object.assign(new Error("Multiple leaderboard settlements failed; due schedules retained for retry."), { failures });
    });
}
exports.runDueLeaderboardSettlements = runDueLeaderboardSettlements;
/** Freeze overdue seasons synchronously so clients observe the deadline immediately. */
function freezeDueLeaderboardSeasonsSync(nowMs) {
    const db = (0, db_1.getDb)(), timeout = db.pragma("busy_timeout", { simple: true });
    db.pragma("busy_timeout = 0");
    try {
        for (const competition of (0, competition_1.getLeaderboardCompetitions)()) {
            const config = getLeaderboardSettlementConfigSync(competition.key, nowMs);
            if ((!config.freezeEnabled && !config.autoEnabled)
                || config.settleAtMs === null || config.settleAtMs > nowMs)
                continue;
            (0, availability_1.getLeaderboardAvailabilitySync)(competition.key, nowMs);
        }
    }
    finally {
        db.pragma(`busy_timeout = ${timeout}`);
    }
}
function createLeaderboardSettlementScheduler(intervalMs = 60000) {
    let timer = null;
    let running = false;
    let pending = null;
    let localStopped = false;
    return {
        start() {
            if (timer !== null || (0, shutdown_state_1.isServerShuttingDown)())
                return;
            localStopped = false;
            const tick = () => {
                if (running || localStopped || (0, shutdown_state_1.isServerShuttingDown)())
                    return;
                running = true;
                const nowMs = Date.now();
                try {
                    freezeDueLeaderboardSeasonsSync(nowMs);
                }
                catch (error) {
                    // If a native writer owns the lock, queue the worker below.
                    // The deadline predicate already disallows new ranked runs.
                    if (!(0, sqlite_write_coordinator_1.isSqliteBusyError)(error) && !(0, persistence_admission_1.isPersistenceAdmissionError)(error)) {
                        running = false;
                        console.error("[LEADERBOARD] settlement deadline freeze failed", error);
                        return;
                    }
                }
                pending = runDueLeaderboardSettlements(nowMs, () => localStopped || (0, shutdown_state_1.isServerShuttingDown)())
                    .catch(error => console.error("[LEADERBOARD] settlement scheduler failed", error))
                    .finally(() => { running = false; pending = null; });
            };
            // Catch up an overdue schedule immediately when the service starts.
            tick();
            timer = setInterval(tick, intervalMs);
            timer.unref();
        },
        stop() {
            return __awaiter(this, void 0, void 0, function* () {
                localStopped = true;
                if (timer !== null)
                    clearInterval(timer);
                timer = null;
                // Finish the accepted job. Later competitions keep their due plan
                // and are picked up by a fresh scheduler after restart.
                yield pending;
            });
        },
    };
}
exports.createLeaderboardSettlementScheduler = createLeaderboardSettlementScheduler;
