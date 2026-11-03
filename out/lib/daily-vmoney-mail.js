"use strict";
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
exports.createDailyVmoneyMailScheduler = exports.getDailyVmoneyMailOverviewSync = exports.ensureDailyVmoneyMailForPlayerSync = exports.dispatchDailyVmoneyMailSync = exports.updateDailyVmoneyMailConfigSync = exports.validateDailyVmoneyMailConfigUpdate = exports.getDailyVmoneyMailConfigSync = void 0;
const shutdown_state_1 = require("./shutdown-state");
const CHINA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const MAX_MAIL_AMOUNT = 2147483647;
const DEFAULT_CONFIG = {
    enabled: false,
    amount: 150000,
    sendHour: 5,
    sendMinute: 0,
    subject: "每日千抽",
    description: "每日星导石奖励，请查收。",
};
function productionDatabase() {
    // Keep the database import lazy so isolated unit tests can inject an
    // in-memory database without initializing the repository's local DB.
    return require("../data/db").getDb();
}
function isProductionDatabase(database) {
    // Do not initialize the production database merely by importing this
    // module: isolated tests pass their own in-memory connection. Once the
    // server has loaded data/db, compare the actual connection objects.
    const modulePath = require.resolve("../data/db");
    const cached = require.cache[modulePath];
    if (!cached)
        return false;
    const getDb = cached.exports.getDb;
    return typeof getDb === "function" && getDb() === database;
}
function runDailyVmoneyPersistence(database, operation) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!isProductionDatabase(database))
            return operation();
        const { runPersistenceTransaction } = require("./persistence-coordinator");
        return runPersistenceTransaction({
            domain: "mail", operation: "daily_vmoney_mail_scheduler",
        }, operation);
    });
}
function twoDigits(value) {
    return String(value).padStart(2, "0");
}
function chinaDateParts(nowMs) {
    const shifted = new Date(nowMs + CHINA_UTC_OFFSET_MS);
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth(),
        day: shifted.getUTCDate(),
    };
}
function cycleForChinaDate(year, month, day, sendHour, sendMinute) {
    const scheduledAtMs = Date.UTC(year, month, day, sendHour, sendMinute) - CHINA_UTC_OFFSET_MS;
    const normalized = chinaDateParts(scheduledAtMs);
    return {
        bucket: `${normalized.year}-${twoDigits(normalized.month + 1)}-${twoDigits(normalized.day)}`,
        scheduledAtMs,
    };
}
function todayCycle(nowMs, config) {
    const parts = chinaDateParts(nowMs);
    return cycleForChinaDate(parts.year, parts.month, parts.day, config.sendHour, config.sendMinute);
}
function latestScheduledCycle(nowMs, config) {
    const today = todayCycle(nowMs, config);
    if (nowMs >= today.scheduledAtMs)
        return today;
    const yesterday = new Date(today.scheduledAtMs - 24 * 60 * 60 * 1000 + CHINA_UTC_OFFSET_MS);
    return cycleForChinaDate(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate(), config.sendHour, config.sendMinute);
}
function tomorrowCycle(nowMs, config) {
    const today = todayCycle(nowMs, config);
    const tomorrow = new Date(today.scheduledAtMs + 24 * 60 * 60 * 1000 + CHINA_UTC_OFFSET_MS);
    return cycleForChinaDate(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), config.sendHour, config.sendMinute);
}
function formatDatabaseTime(nowMs) {
    return new Date(nowMs).toISOString().replace("T", " ").substring(0, 19);
}
function mapRun(row) {
    if (!row)
        return null;
    return {
        bucket: row.bucket,
        scheduledAtMs: row.scheduled_at_ms,
        executedAtMs: row.executed_at_ms,
        source: row.source,
        amount: row.amount,
        subject: row.subject,
        description: row.description,
        sentCount: row.sent_count,
    };
}
function getRunSync(database, bucket) {
    const row = database.prepare(`
        SELECT bucket, scheduled_at_ms, executed_at_ms, source, amount, subject, description, sent_count
        FROM daily_vmoney_mail_runs
        WHERE bucket = ?
    `).get(bucket);
    return mapRun(row);
}
function getLastRunSync(database) {
    const row = database.prepare(`
        SELECT bucket, scheduled_at_ms, executed_at_ms, source, amount, subject, description, sent_count
        FROM daily_vmoney_mail_runs
        ORDER BY bucket DESC
        LIMIT 1
    `).get();
    return mapRun(row);
}
function getDailyVmoneyMailConfigSync(database = productionDatabase()) {
    database.prepare(`
        INSERT OR IGNORE INTO daily_vmoney_mail_config
            (id, enabled, amount, send_hour, send_minute, subject, description, updated_at_ms)
        VALUES (1, 0, ?, ?, ?, ?, ?, 0)
    `).run(DEFAULT_CONFIG.amount, DEFAULT_CONFIG.sendHour, DEFAULT_CONFIG.sendMinute, DEFAULT_CONFIG.subject, DEFAULT_CONFIG.description);
    const row = database.prepare(`
        SELECT enabled, amount, send_hour, send_minute, subject, description, updated_at_ms
        FROM daily_vmoney_mail_config
        WHERE id = 1
    `).get();
    return {
        enabled: row.enabled === 1,
        amount: row.amount,
        sendHour: row.send_hour,
        sendMinute: row.send_minute,
        subject: row.subject,
        description: row.description,
        updatedAtMs: row.updated_at_ms,
    };
}
exports.getDailyVmoneyMailConfigSync = getDailyVmoneyMailConfigSync;
function validateDailyVmoneyMailConfigUpdate(body) {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
        throw new Error("配置格式无效");
    }
    const raw = body;
    const update = {};
    if ("enabled" in raw) {
        if (typeof raw.enabled !== "boolean")
            throw new Error("启用状态无效");
        update.enabled = raw.enabled;
    }
    for (const [key, label, minimum, maximum] of [
        ["amount", "星导石数量", 1, MAX_MAIL_AMOUNT],
        ["sendHour", "发送小时", 0, 23],
        ["sendMinute", "发送分钟", 0, 59],
    ]) {
        if (!(key in raw))
            continue;
        const value = raw[key];
        if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
            throw new Error(`${label}无效`);
        }
        update[key] = value;
    }
    if ("subject" in raw) {
        if (typeof raw.subject !== "string")
            throw new Error("邮件标题无效");
        const subject = raw.subject.trim();
        if (!subject || subject.length > 64)
            throw new Error("邮件标题须为 1–64 个字符");
        update.subject = subject;
    }
    if ("description" in raw) {
        if (typeof raw.description !== "string" || raw.description.length > 512) {
            throw new Error("邮件正文最多 512 个字符");
        }
        update.description = raw.description.trim();
    }
    if (Object.keys(update).length === 0)
        throw new Error("没有可更新的配置");
    return update;
}
exports.validateDailyVmoneyMailConfigUpdate = validateDailyVmoneyMailConfigUpdate;
function updateDailyVmoneyMailConfigSync(update, nowMs = Date.now(), database = productionDatabase()) {
    const current = getDailyVmoneyMailConfigSync(database);
    const next = Object.assign(Object.assign(Object.assign({}, current), update), { updatedAtMs: nowMs });
    database.prepare(`
        UPDATE daily_vmoney_mail_config
        SET enabled = ?, amount = ?, send_hour = ?, send_minute = ?, subject = ?, description = ?, updated_at_ms = ?
        WHERE id = 1
    `).run(next.enabled ? 1 : 0, next.amount, next.sendHour, next.sendMinute, next.subject, next.description, next.updatedAtMs);
    return next;
}
exports.updateDailyVmoneyMailConfigSync = updateDailyVmoneyMailConfigSync;
function dispatchDailyVmoneyMailSync(nowMs = Date.now(), source = "scheduler", force = false, database = productionDatabase()) {
    const config = getDailyVmoneyMailConfigSync(database);
    if (!config.enabled)
        return { status: "disabled", run: null };
    const cycle = force ? todayCycle(nowMs, config) : latestScheduledCycle(nowMs, config);
    const existing = getRunSync(database, cycle.bucket);
    if (existing)
        return { status: "already_sent", run: existing };
    if (!force && cycle.scheduledAtMs <= config.updatedAtMs) {
        return { status: "not_due", run: null };
    }
    const send = database.transaction(() => {
        const duplicate = getRunSync(database, cycle.bucket);
        if (duplicate)
            return duplicate;
        database.prepare(`
            INSERT INTO daily_vmoney_mail_runs
                (bucket, scheduled_at_ms, executed_at_ms, source, amount, subject, description, sent_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `).run(cycle.bucket, cycle.scheduledAtMs, nowMs, source, config.amount, config.subject, config.description);
        // 作者 1103：每日星导石改成「登录才发」。定时任务只记下当天这一期，不再群发；
        // 玩家登录 / 加载时由 ensureDailyVmoneyMailForPlayerSync 给本人补发一封（每期每人一次）。
        const players = [];
        const insertMail = database.prepare(`
            INSERT INTO players_mails
                (player_id, reason_id, subject, description, type, type_id, number, receive_time, create_time, reward_period_limited, reward_limit_time)
            VALUES (?, 0, ?, ?, 4, NULL, ?, '0000-00-00 00:00:00', ?, 0, NULL)
        `);
        const insertGrant = database.prepare(`
            INSERT INTO daily_vmoney_mail_grants (bucket, player_id, mail_id, created_at_ms)
            VALUES (?, ?, ?, ?)
        `);
        const databaseTime = formatDatabaseTime(nowMs);
        for (const player of players) {
            const result = insertMail.run(player.id, config.subject, config.description || null, config.amount, databaseTime);
            insertGrant.run(cycle.bucket, player.id, Number(result.lastInsertRowid), nowMs);
        }
        database.prepare(`
            UPDATE daily_vmoney_mail_runs SET sent_count = ? WHERE bucket = ?
        `).run(players.length, cycle.bucket);
        return getRunSync(database, cycle.bucket);
    });
    return { status: "sent", run: send() };
}
exports.dispatchDailyVmoneyMailSync = dispatchDailyVmoneyMailSync;
function ensureDailyVmoneyMailForPlayerSync(playerId, nowMs = Date.now(), database = productionDatabase()) {
    const config = getDailyVmoneyMailConfigSync(database);
    if (!config.enabled)
        return false;
    const currentBucket = todayCycle(nowMs, config).bucket;
    const activeBucket = latestScheduledCycle(nowMs, config).bucket;
    const row = database.prepare(`
        SELECT bucket, scheduled_at_ms, executed_at_ms, source, amount, subject, description, sent_count
        FROM daily_vmoney_mail_runs
        WHERE bucket IN (?, ?)
        ORDER BY bucket DESC
        LIMIT 1
    `).get(currentBucket, activeBucket);
    const run = mapRun(row);
    if (!run)
        return false;
    return database.transaction(() => {
        const existing = database.prepare(`
            SELECT mail_id FROM daily_vmoney_mail_grants WHERE bucket = ? AND player_id = ?
        `).get(run.bucket, playerId);
        if (existing)
            return false;
        const result = database.prepare(`
            INSERT INTO players_mails
                (player_id, reason_id, subject, description, type, type_id, number, receive_time, create_time, reward_period_limited, reward_limit_time)
            VALUES (?, 0, ?, ?, 4, NULL, ?, '0000-00-00 00:00:00', ?, 0, NULL)
        `).run(playerId, run.subject, run.description || null, run.amount, formatDatabaseTime(nowMs));
        database.prepare(`
            INSERT INTO daily_vmoney_mail_grants (bucket, player_id, mail_id, created_at_ms)
            VALUES (?, ?, ?, ?)
        `).run(run.bucket, playerId, Number(result.lastInsertRowid), nowMs);
        database.prepare(`
            UPDATE daily_vmoney_mail_runs SET sent_count = sent_count + 1 WHERE bucket = ?
        `).run(run.bucket);
        return true;
    })();
}
exports.ensureDailyVmoneyMailForPlayerSync = ensureDailyVmoneyMailForPlayerSync;
function getDailyVmoneyMailOverviewSync(nowMs = Date.now(), database = productionDatabase()) {
    const config = getDailyVmoneyMailConfigSync(database);
    const latest = latestScheduledCycle(nowMs, config);
    const today = todayCycle(nowMs, config);
    const latestRun = getRunSync(database, latest.bucket);
    const due = config.enabled
        && nowMs >= latest.scheduledAtMs
        && latest.scheduledAtMs > config.updatedAtMs
        && latestRun === null;
    let nextRunAtMs = null;
    if (config.enabled) {
        if (due)
            nextRunAtMs = latest.scheduledAtMs;
        else if (nowMs < today.scheduledAtMs && getRunSync(database, today.bucket) === null) {
            nextRunAtMs = today.scheduledAtMs;
        }
        else {
            nextRunAtMs = tomorrowCycle(nowMs, config).scheduledAtMs;
        }
    }
    const totalPlayers = database.prepare("SELECT COUNT(*) AS count FROM players").get().count;
    return {
        config,
        lastRun: getLastRunSync(database),
        currentBucket: today.bucket,
        due,
        nextRunAtMs,
        totalPlayers,
    };
}
exports.getDailyVmoneyMailOverviewSync = getDailyVmoneyMailOverviewSync;
function createDailyVmoneyMailScheduler(database = productionDatabase(), options = {}) {
    var _a, _b;
    const intervalMs = (_a = options.intervalMs) !== null && _a !== void 0 ? _a : 60000;
    const logger = (_b = options.logger) !== null && _b !== void 0 ? _b : console;
    let timer = null;
    let running = false;
    const tick = () => {
        if (running || (0, shutdown_state_1.isServerShuttingDown)())
            return;
        running = true;
        void (0, shutdown_state_1.withServerWorkAdmission)(() => runDailyVmoneyPersistence(database, () => dispatchDailyVmoneyMailSync(Date.now(), "scheduler", false, database))).then(result => {
            if (result.status === "sent" && result.run) {
                logger.log(`[DAILY_VMONEY_MAIL] bucket=${result.run.bucket} amount=${result.run.amount} sent=${result.run.sentCount}`);
            }
        }).catch(error => {
            const detail = error instanceof Error ? error.message : String(error);
            logger.warn(`[DAILY_VMONEY_MAIL] scheduler failed: ${detail}`);
        }).finally(() => { running = false; });
    };
    return {
        start() {
            var _a;
            if (timer)
                return;
            tick();
            timer = setInterval(tick, intervalMs);
            (_a = timer.unref) === null || _a === void 0 ? void 0 : _a.call(timer);
        },
        stop() {
            if (!timer)
                return;
            clearInterval(timer);
            timer = null;
        },
    };
}
exports.createDailyVmoneyMailScheduler = createDailyVmoneyMailScheduler;
