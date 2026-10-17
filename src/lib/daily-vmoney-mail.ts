import type { Database } from "better-sqlite3"
import { isServerShuttingDown, withServerWorkAdmission } from "./shutdown-state"

const CHINA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000
const MAX_MAIL_AMOUNT = 2_147_483_647
const DEFAULT_CONFIG = {
    enabled: false,
    amount: 150_000,
    sendHour: 5,
    sendMinute: 0,
    subject: "每日千抽",
    description: "每日星导石奖励，请查收。",
}

interface DailyVmoneyMailConfigRow {
    enabled: number
    amount: number
    send_hour: number
    send_minute: number
    subject: string
    description: string
    updated_at_ms: number
}

interface DailyVmoneyMailRunRow {
    bucket: string
    scheduled_at_ms: number
    executed_at_ms: number
    source: string
    amount: number
    subject: string
    description: string
    sent_count: number
}

interface CountRow {
    count: number
}

interface PlayerIdRow {
    id: number
}

interface MailIdRow {
    mail_id: number
}

export interface DailyVmoneyMailConfig {
    enabled: boolean
    amount: number
    sendHour: number
    sendMinute: number
    subject: string
    description: string
    updatedAtMs: number
}

export interface DailyVmoneyMailConfigUpdate {
    enabled?: boolean
    amount?: number
    sendHour?: number
    sendMinute?: number
    subject?: string
    description?: string
}

export interface DailyVmoneyMailRun {
    bucket: string
    scheduledAtMs: number
    executedAtMs: number
    source: string
    amount: number
    subject: string
    description: string
    sentCount: number
}

export interface DailyVmoneyMailDispatchResult {
    status: "disabled" | "not_due" | "already_sent" | "sent"
    run: DailyVmoneyMailRun | null
}

export interface DailyVmoneyMailOverview {
    config: DailyVmoneyMailConfig
    lastRun: DailyVmoneyMailRun | null
    currentBucket: string
    due: boolean
    nextRunAtMs: number | null
    totalPlayers: number
}

export interface DailyVmoneyMailScheduler {
    start(): void
    stop(): void
}

export interface DailyVmoneyMailLogger {
    log(message: string): void
    warn(message: string): void
}

interface Cycle {
    bucket: string
    scheduledAtMs: number
}

function productionDatabase(): Database {
    // Keep the database import lazy so isolated unit tests can inject an
    // in-memory database without initializing the repository's local DB.
    return require("../data/db").getDb() as Database
}

function isProductionDatabase(database: Database): boolean {
    // Do not initialize the production database merely by importing this
    // module: isolated tests pass their own in-memory connection. Once the
    // server has loaded data/db, compare the actual connection objects.
    const modulePath = require.resolve("../data/db")
    const cached = require.cache[modulePath]
    if (!cached) return false
    const getDb = (cached.exports as { getDb?: () => Database }).getDb
    return typeof getDb === "function" && getDb() === database
}

async function runDailyVmoneyPersistence<T>(
    database: Database,
    operation: () => T,
): Promise<T> {
    if (!isProductionDatabase(database)) return operation()
    const { runPersistenceTransaction } = require("./persistence-coordinator") as typeof import("./persistence-coordinator")
    return runPersistenceTransaction({
        domain: "mail", operation: "daily_vmoney_mail_scheduler",
    }, operation)
}

function twoDigits(value: number): string {
    return String(value).padStart(2, "0")
}

function chinaDateParts(nowMs: number): { year: number; month: number; day: number } {
    const shifted = new Date(nowMs + CHINA_UTC_OFFSET_MS)
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth(),
        day: shifted.getUTCDate(),
    }
}

function cycleForChinaDate(
    year: number,
    month: number,
    day: number,
    sendHour: number,
    sendMinute: number,
): Cycle {
    const scheduledAtMs = Date.UTC(year, month, day, sendHour, sendMinute) - CHINA_UTC_OFFSET_MS
    const normalized = chinaDateParts(scheduledAtMs)
    return {
        bucket: `${normalized.year}-${twoDigits(normalized.month + 1)}-${twoDigits(normalized.day)}`,
        scheduledAtMs,
    }
}

function todayCycle(nowMs: number, config: DailyVmoneyMailConfig): Cycle {
    const parts = chinaDateParts(nowMs)
    return cycleForChinaDate(parts.year, parts.month, parts.day, config.sendHour, config.sendMinute)
}

function latestScheduledCycle(nowMs: number, config: DailyVmoneyMailConfig): Cycle {
    const today = todayCycle(nowMs, config)
    if (nowMs >= today.scheduledAtMs) return today
    const yesterday = new Date(today.scheduledAtMs - 24 * 60 * 60 * 1000 + CHINA_UTC_OFFSET_MS)
    return cycleForChinaDate(
        yesterday.getUTCFullYear(),
        yesterday.getUTCMonth(),
        yesterday.getUTCDate(),
        config.sendHour,
        config.sendMinute,
    )
}

function tomorrowCycle(nowMs: number, config: DailyVmoneyMailConfig): Cycle {
    const today = todayCycle(nowMs, config)
    const tomorrow = new Date(today.scheduledAtMs + 24 * 60 * 60 * 1000 + CHINA_UTC_OFFSET_MS)
    return cycleForChinaDate(
        tomorrow.getUTCFullYear(),
        tomorrow.getUTCMonth(),
        tomorrow.getUTCDate(),
        config.sendHour,
        config.sendMinute,
    )
}

function formatDatabaseTime(nowMs: number): string {
    return new Date(nowMs).toISOString().replace("T", " ").substring(0, 19)
}

function mapRun(row: DailyVmoneyMailRunRow | undefined): DailyVmoneyMailRun | null {
    if (!row) return null
    return {
        bucket: row.bucket,
        scheduledAtMs: row.scheduled_at_ms,
        executedAtMs: row.executed_at_ms,
        source: row.source,
        amount: row.amount,
        subject: row.subject,
        description: row.description,
        sentCount: row.sent_count,
    }
}

function getRunSync(database: Database, bucket: string): DailyVmoneyMailRun | null {
    const row = database.prepare(`
        SELECT bucket, scheduled_at_ms, executed_at_ms, source, amount, subject, description, sent_count
        FROM daily_vmoney_mail_runs
        WHERE bucket = ?
    `).get(bucket) as DailyVmoneyMailRunRow | undefined
    return mapRun(row)
}

function getLastRunSync(database: Database): DailyVmoneyMailRun | null {
    const row = database.prepare(`
        SELECT bucket, scheduled_at_ms, executed_at_ms, source, amount, subject, description, sent_count
        FROM daily_vmoney_mail_runs
        ORDER BY bucket DESC
        LIMIT 1
    `).get() as DailyVmoneyMailRunRow | undefined
    return mapRun(row)
}

export function getDailyVmoneyMailConfigSync(database: Database = productionDatabase()): DailyVmoneyMailConfig {
    database.prepare(`
        INSERT OR IGNORE INTO daily_vmoney_mail_config
            (id, enabled, amount, send_hour, send_minute, subject, description, updated_at_ms)
        VALUES (1, 0, ?, ?, ?, ?, ?, 0)
    `).run(
        DEFAULT_CONFIG.amount,
        DEFAULT_CONFIG.sendHour,
        DEFAULT_CONFIG.sendMinute,
        DEFAULT_CONFIG.subject,
        DEFAULT_CONFIG.description,
    )
    const row = database.prepare(`
        SELECT enabled, amount, send_hour, send_minute, subject, description, updated_at_ms
        FROM daily_vmoney_mail_config
        WHERE id = 1
    `).get() as DailyVmoneyMailConfigRow
    return {
        enabled: row.enabled === 1,
        amount: row.amount,
        sendHour: row.send_hour,
        sendMinute: row.send_minute,
        subject: row.subject,
        description: row.description,
        updatedAtMs: row.updated_at_ms,
    }
}

export function validateDailyVmoneyMailConfigUpdate(body: unknown): DailyVmoneyMailConfigUpdate {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
        throw new Error("配置格式无效")
    }
    const raw = body as Record<string, unknown>
    const update: DailyVmoneyMailConfigUpdate = {}
    if ("enabled" in raw) {
        if (typeof raw.enabled !== "boolean") throw new Error("启用状态无效")
        update.enabled = raw.enabled
    }
    for (const [key, label, minimum, maximum] of [
        ["amount", "星导石数量", 1, MAX_MAIL_AMOUNT],
        ["sendHour", "发送小时", 0, 23],
        ["sendMinute", "发送分钟", 0, 59],
    ] as const) {
        if (!(key in raw)) continue
        const value = raw[key]
        if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
            throw new Error(`${label}无效`)
        }
        update[key] = value as number
    }
    if ("subject" in raw) {
        if (typeof raw.subject !== "string") throw new Error("邮件标题无效")
        const subject = raw.subject.trim()
        if (!subject || subject.length > 64) throw new Error("邮件标题须为 1–64 个字符")
        update.subject = subject
    }
    if ("description" in raw) {
        if (typeof raw.description !== "string" || raw.description.length > 512) {
            throw new Error("邮件正文最多 512 个字符")
        }
        update.description = raw.description.trim()
    }
    if (Object.keys(update).length === 0) throw new Error("没有可更新的配置")
    return update
}

export function updateDailyVmoneyMailConfigSync(
    update: DailyVmoneyMailConfigUpdate,
    nowMs: number = Date.now(),
    database: Database = productionDatabase(),
): DailyVmoneyMailConfig {
    const current = getDailyVmoneyMailConfigSync(database)
    const next = { ...current, ...update, updatedAtMs: nowMs }
    database.prepare(`
        UPDATE daily_vmoney_mail_config
        SET enabled = ?, amount = ?, send_hour = ?, send_minute = ?, subject = ?, description = ?, updated_at_ms = ?
        WHERE id = 1
    `).run(
        next.enabled ? 1 : 0,
        next.amount,
        next.sendHour,
        next.sendMinute,
        next.subject,
        next.description,
        next.updatedAtMs,
    )
    return next
}

export function dispatchDailyVmoneyMailSync(
    nowMs: number = Date.now(),
    source: "scheduler" | "manual" = "scheduler",
    force: boolean = false,
    database: Database = productionDatabase(),
): DailyVmoneyMailDispatchResult {
    const config = getDailyVmoneyMailConfigSync(database)
    if (!config.enabled) return { status: "disabled", run: null }

    const cycle = force ? todayCycle(nowMs, config) : latestScheduledCycle(nowMs, config)
    const existing = getRunSync(database, cycle.bucket)
    if (existing) return { status: "already_sent", run: existing }
    if (!force && cycle.scheduledAtMs <= config.updatedAtMs) {
        return { status: "not_due", run: null }
    }

    const send = database.transaction((): DailyVmoneyMailRun => {
        const duplicate = getRunSync(database, cycle.bucket)
        if (duplicate) return duplicate

        database.prepare(`
            INSERT INTO daily_vmoney_mail_runs
                (bucket, scheduled_at_ms, executed_at_ms, source, amount, subject, description, sent_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `).run(
            cycle.bucket,
            cycle.scheduledAtMs,
            nowMs,
            source,
            config.amount,
            config.subject,
            config.description,
        )

        const players = database.prepare("SELECT id FROM players ORDER BY id").all() as PlayerIdRow[]
        const insertMail = database.prepare(`
            INSERT INTO players_mails
                (player_id, reason_id, subject, description, type, type_id, number, receive_time, create_time, reward_period_limited, reward_limit_time)
            VALUES (?, 0, ?, ?, 4, NULL, ?, '0000-00-00 00:00:00', ?, 0, NULL)
        `)
        const insertGrant = database.prepare(`
            INSERT INTO daily_vmoney_mail_grants (bucket, player_id, mail_id, created_at_ms)
            VALUES (?, ?, ?, ?)
        `)
        const databaseTime = formatDatabaseTime(nowMs)
        for (const player of players) {
            const result = insertMail.run(
                player.id,
                config.subject,
                config.description || null,
                config.amount,
                databaseTime,
            )
            insertGrant.run(cycle.bucket, player.id, Number(result.lastInsertRowid), nowMs)
        }
        database.prepare(`
            UPDATE daily_vmoney_mail_runs SET sent_count = ? WHERE bucket = ?
        `).run(players.length, cycle.bucket)

        return getRunSync(database, cycle.bucket) as DailyVmoneyMailRun
    })

    return { status: "sent", run: send() }
}

export function ensureDailyVmoneyMailForPlayerSync(
    playerId: number,
    nowMs: number = Date.now(),
    database: Database = productionDatabase(),
): boolean {
    const config = getDailyVmoneyMailConfigSync(database)
    if (!config.enabled) return false
    const currentBucket = todayCycle(nowMs, config).bucket
    const activeBucket = latestScheduledCycle(nowMs, config).bucket
    const row = database.prepare(`
        SELECT bucket, scheduled_at_ms, executed_at_ms, source, amount, subject, description, sent_count
        FROM daily_vmoney_mail_runs
        WHERE bucket IN (?, ?)
        ORDER BY bucket DESC
        LIMIT 1
    `).get(currentBucket, activeBucket) as DailyVmoneyMailRunRow | undefined
    const run = mapRun(row)
    if (!run) return false

    return database.transaction((): boolean => {
        const existing = database.prepare(`
            SELECT mail_id FROM daily_vmoney_mail_grants WHERE bucket = ? AND player_id = ?
        `).get(run.bucket, playerId) as MailIdRow | undefined
        if (existing) return false

        const result = database.prepare(`
            INSERT INTO players_mails
                (player_id, reason_id, subject, description, type, type_id, number, receive_time, create_time, reward_period_limited, reward_limit_time)
            VALUES (?, 0, ?, ?, 4, NULL, ?, '0000-00-00 00:00:00', ?, 0, NULL)
        `).run(
            playerId,
            run.subject,
            run.description || null,
            run.amount,
            formatDatabaseTime(nowMs),
        )
        database.prepare(`
            INSERT INTO daily_vmoney_mail_grants (bucket, player_id, mail_id, created_at_ms)
            VALUES (?, ?, ?, ?)
        `).run(run.bucket, playerId, Number(result.lastInsertRowid), nowMs)
        database.prepare(`
            UPDATE daily_vmoney_mail_runs SET sent_count = sent_count + 1 WHERE bucket = ?
        `).run(run.bucket)
        return true
    })()
}

export function getDailyVmoneyMailOverviewSync(
    nowMs: number = Date.now(),
    database: Database = productionDatabase(),
): DailyVmoneyMailOverview {
    const config = getDailyVmoneyMailConfigSync(database)
    const latest = latestScheduledCycle(nowMs, config)
    const today = todayCycle(nowMs, config)
    const latestRun = getRunSync(database, latest.bucket)
    const due = config.enabled
        && nowMs >= latest.scheduledAtMs
        && latest.scheduledAtMs > config.updatedAtMs
        && latestRun === null
    let nextRunAtMs: number | null = null
    if (config.enabled) {
        if (due) nextRunAtMs = latest.scheduledAtMs
        else if (nowMs < today.scheduledAtMs && getRunSync(database, today.bucket) === null) {
            nextRunAtMs = today.scheduledAtMs
        } else {
            nextRunAtMs = tomorrowCycle(nowMs, config).scheduledAtMs
        }
    }
    const totalPlayers = (database.prepare("SELECT COUNT(*) AS count FROM players").get() as CountRow).count
    return {
        config,
        lastRun: getLastRunSync(database),
        currentBucket: today.bucket,
        due,
        nextRunAtMs,
        totalPlayers,
    }
}

export function createDailyVmoneyMailScheduler(
    database: Database = productionDatabase(),
    options: { intervalMs?: number; logger?: DailyVmoneyMailLogger } = {},
): DailyVmoneyMailScheduler {
    const intervalMs = options.intervalMs ?? 60_000
    const logger = options.logger ?? console
    let timer: NodeJS.Timeout | null = null
    let running = false
    const tick = () => {
        if (running || isServerShuttingDown()) return
        running = true
        void withServerWorkAdmission(() => runDailyVmoneyPersistence(
            database,
            () => dispatchDailyVmoneyMailSync(Date.now(), "scheduler", false, database),
        )).then(result => {
            if (result.status === "sent" && result.run) {
                logger.log(
                    `[DAILY_VMONEY_MAIL] bucket=${result.run.bucket} amount=${result.run.amount} sent=${result.run.sentCount}`,
                )
            }
        }).catch(error => {
            const detail = error instanceof Error ? error.message : String(error)
            logger.warn(`[DAILY_VMONEY_MAIL] scheduler failed: ${detail}`)
        }).finally(() => { running = false })
    }
    return {
        start() {
            if (timer) return
            tick()
            timer = setInterval(tick, intervalMs)
            timer.unref?.()
        },
        stop() {
            if (!timer) return
            clearInterval(timer)
            timer = null
        },
    }
}
