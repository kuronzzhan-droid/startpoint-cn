import { randomBytes, timingSafeEqual } from "node:crypto"
import { performance } from "node:perf_hooks"
import { getDb } from "../data/db"
import { insertAccountSync, updateAccountSync } from "../data/domains/account"
import { insertDefaultPlayerSync } from "../data/domains/player"
import { getViewerIdSync } from "../data/domains/session"
import { resolvePlayerIdSync, saveAccountDefaultPlayer } from "../data/activeAccount"
import { getRankDegree } from "./stamina"
import { generateViewerId } from "../utils"
import { runPersistenceTransaction, runPersistenceTransactionSync } from "./persistence-coordinator"

const DAY = 86400000
// Leave room for the existing client's 15-second network timeout.
export const PASSWORD_LOGIN_QUEUE_TIMEOUT_MS = 10_000
let initialized = false
let nextMaintenanceAt = 0
const statements = new Map<string, import("better-sqlite3").Statement<unknown[]>>()
function sql(query: string) {
    let statement = statements.get(query)
    if (!statement) { statement = getDb().prepare(query); statements.set(query, statement) }
    return statement
}
const verifiedRequests = new WeakMap<object, PlayerLoginSession>()
export function verifiedPlayerLogin(request: object): PlayerLoginSession | undefined { return verifiedRequests.get(request) }
export function rememberVerifiedPlayerLogin(request: object, session: PlayerLoginSession): void { verifiedRequests.set(request, session) }
let disconnectViewer: (viewerId: number) => void = () => {}
/** Close existing transports after an administrator has deleted the account. */
export function disconnectDeletedPlayerLogin(viewerId: number): void { disconnectViewer(viewerId) }
export class PlayerLoginError extends Error {
    constructor(message: string, public code = "INVALID_INPUT") { super(message) }
}
export interface PlayerLoginSession { token: string; account_id: number; viewer_id: number; udid: string; expires_at: number }
interface Identity { id: number; status: string; username: string | null; takeover_password: string | null; password: string | null }
interface ClaimCode { code: string; account_id: number; purpose: string; expires_at: number; consumed_at: number | null }

export function initializePlayerLogin(disconnect?: (viewerId: number) => void): void {
    getDb().exec(`
        CREATE TABLE IF NOT EXISTS player_login_credentials (
            account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
            password TEXT NOT NULL, created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS player_login_sessions (
            token TEXT PRIMARY KEY, account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
            viewer_id INTEGER NOT NULL, udid TEXT NOT NULL, expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS player_login_codes (
            code TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            purpose TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS player_login_claims (
            proof TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            source TEXT NOT NULL, original_value TEXT NOT NULL, expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS player_login_audit (
            id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, action TEXT NOT NULL, occurred_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_player_login_username
            ON accounts(lower(username)) WHERE username IS NOT NULL AND username <> '';
        CREATE INDEX IF NOT EXISTS idx_player_login_session_expiry ON player_login_sessions(expires_at);
        CREATE INDEX IF NOT EXISTS idx_player_login_claim_expiry ON player_login_claims(expires_at);
        CREATE INDEX IF NOT EXISTS idx_player_login_code_expiry ON player_login_codes(expires_at);
        CREATE INDEX IF NOT EXISTS idx_player_login_code_consumed ON player_login_codes(consumed_at) WHERE consumed_at IS NOT NULL;
    `)
    initialized = true
    if (disconnect) disconnectViewer = disconnect
}

function fail(message: string, code = "INVALID_INPUT"): never { throw new PlayerLoginError(message, code) }
function token(): string { return randomBytes(32).toString("hex") }
function equal(left: string, right: string): boolean {
    const a = Buffer.from(left), b = Buffer.from(right)
    return a.length === b.length && timingSafeEqual(a, b)
}
function identity(accountId: number): Identity | undefined {
    return getDb().prepare(`SELECT a.id,a.status,a.username,a.takeover_password,c.password
        FROM accounts a LEFT JOIN player_login_credentials c ON c.account_id=a.id WHERE a.id=?`).get(accountId) as Identity | undefined
}
function active(accountId: number): Identity {
    const row = identity(accountId)
    if (!row || row.status !== "normal") fail("该账号当前无法登录，请联系管理员。")
    return row
}
function audit(accountId: number, action: string): void {
    const inserted = sql("INSERT INTO player_login_audit(account_id,action,occurred_at) VALUES(?,?,?)").run(accountId, action, Date.now())
    // One indexed row in steady state; also drains an older backlog in bounded batches.
    sql("DELETE FROM player_login_audit WHERE id IN (SELECT id FROM player_login_audit WHERE id<=? ORDER BY id LIMIT 100)").run(Number(inserted.lastInsertRowid) - 5000)
    maintainPlayerLogin()
}
/** Opportunistic, bounded cleanup; expiration is always enforced by reads, regardless of cleanup timing. */
export function maintainPlayerLogin(): void {
    const now = Date.now()
    if (now < nextMaintenanceAt) return
    nextMaintenanceAt = now + 60000
    for (const table of ["player_login_claims", "player_login_codes", "player_login_sessions"]) {
        sql(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE expires_at <= ? ORDER BY expires_at LIMIT 100)`).run(now)
    }
    sql("DELETE FROM player_login_codes WHERE rowid IN (SELECT rowid FROM player_login_codes WHERE consumed_at IS NOT NULL ORDER BY consumed_at LIMIT 100)").run()
}
function input(username: unknown, password: unknown): { username: string; password: string } {
    if (typeof username !== "string" || !/^[A-Za-z0-9_]{4,24}$/.test(username)) fail("账号需为 4–24 位字母、数字或下划线。")
    if (typeof password !== "string" || password.length < 6 || password.length > 64 || /[\x00-\x1f]/.test(password)) fail("密码需为 6–64 位字符。")
    return { username: username.toLowerCase(), password }
}
function setCredentials(accountId: number, username: unknown, password: unknown): void {
    const value = input(username, password)
    if (getDb().prepare("SELECT 1 FROM accounts WHERE lower(username)=? AND id<>?").get(value.username, accountId)) fail("这个账号名已被使用，请换一个。")
    if (getDb().prepare("SELECT 1 FROM player_login_credentials WHERE account_id=?").get(accountId)) fail("该存档已经绑定账号，请使用账号登录。")
    // Plaintext player passwords are an explicit project requirement. Never return or log this column.
    getDb().prepare("INSERT INTO player_login_credentials(account_id,password,created_at) VALUES(?,?,?)").run(accountId, value.password, Date.now())
    updateAccountSync({ id: accountId, username: value.username })
}
export function playerLoginManaged(accountId: number): boolean {
    return initialized && Boolean(sql("SELECT 1 FROM player_login_credentials WHERE account_id=?").get(accountId))
}
export interface PlayerLoginViewerAccess {
    accountId: number
    managed: boolean
}
/** One indexed read for the legacy viewer identity and its login-binding state. */
export function readPlayerLoginViewerAccess(viewer: unknown): PlayerLoginViewerAccess | null {
    if (!/^\d{1,15}$/.test(String(viewer ?? ""))) return null
    if (!initialized) {
        const accountId = playerAccountByViewer(viewer)
        return accountId === null ? null : { accountId, managed: false }
    }
    const row = sql(`SELECT v.account_id,
            CASE WHEN c.account_id IS NULL THEN 0 ELSE 1 END AS managed
        FROM sessions v
        LEFT JOIN player_login_credentials c ON c.account_id=v.account_id
        WHERE v.token=? AND v.type=2`).get(String(viewer)) as
        { account_id: number; managed: number } | undefined
    return row ? { accountId: row.account_id, managed: row.managed === 1 } : null
}
export function readPlayerLoginDeviceAccess(device: unknown): PlayerLoginViewerAccess | null {
    const deviceId = Number(device)
    if (!Number.isSafeInteger(deviceId) || deviceId <= 0) return null
    if (!initialized) {
        const row = sql("SELECT account_id FROM device_bindings WHERE device_id=?").get(deviceId) as
            { account_id: number } | undefined
        return row ? { accountId: row.account_id, managed: false } : null
    }
    const row = sql(`SELECT d.account_id,
            CASE WHEN c.account_id IS NULL THEN 0 ELSE 1 END AS managed
        FROM device_bindings d
        LEFT JOIN player_login_credentials c ON c.account_id=d.account_id
        WHERE d.device_id=?`).get(deviceId) as
        { account_id: number; managed: number } | undefined
    return row ? { accountId: row.account_id, managed: row.managed === 1 } : null
}
export function playerAccountByViewer(viewer: unknown): number | null {
    if (!/^\d{1,15}$/.test(String(viewer ?? ""))) return null
    const row = sql("SELECT account_id FROM sessions WHERE token=? AND type=2").get(String(viewer)) as { account_id: number } | undefined
    return row?.account_id ?? null
}
export function readPlayerLoginSession(value: unknown): PlayerLoginSession | null {
    if (!initialized || typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) return null
    return (sql(`SELECT s.* FROM player_login_sessions s JOIN accounts a ON a.id=s.account_id
        WHERE s.token=? AND s.expires_at>? AND a.status='normal'`).get(value, Date.now()) as PlayerLoginSession | undefined) ?? null
}
/** One indexed query on the authenticated game hot path; no cross-request authorization cache. */
export function readPlayerLoginAccess(value: unknown, viewer: unknown): (PlayerLoginSession & { request_account_id: number | null }) | null {
    if (!initialized || typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) return null
    const viewerKey = /^\d{1,15}$/.test(String(viewer ?? "")) ? String(viewer) : ""
    return (sql(`SELECT s.*,v.account_id AS request_account_id
        FROM player_login_sessions s JOIN accounts a ON a.id=s.account_id
        LEFT JOIN sessions v ON v.token=? AND v.type=2
        WHERE s.token=? AND s.expires_at>? AND a.status='normal'`).get(viewerKey, value, Date.now()) as (PlayerLoginSession & { request_account_id: number | null }) | undefined) ?? null
}
export function playerSocketAllowed(viewer: unknown, value: unknown): boolean {
    const access = readPlayerLoginViewerAccess(viewer)
    if (!access?.managed) return true
    return readPlayerLoginSession(value)?.account_id === access.accountId
}
export function playerLoginProfile(accountId: number) {
    const acc = active(accountId)
    const playerId = resolvePlayerIdSync(accountId)
    const player = playerId ? sql("SELECT name,rank_point,leader_character_id FROM players WHERE id=?").get(playerId) as { name: string; rank_point: number; leader_character_id: number } | undefined : null
    if (!player) fail("没有找到该账号的存档，请联系管理员。")
    return { username: acc.username, viewer_id: getViewerIdSync(accountId), name: player.name,
        rank: getRankDegree(player.rank_point), leader_character_id: player.leader_character_id }
}
export function playerLoginAdminOverview() {
    if (!initialized) return new Map<number, { bound: boolean; boundAt: number; sessionExpiresAt: number | null }>()
    const rows = sql(`SELECT c.account_id,c.created_at,s.expires_at FROM player_login_credentials c
        JOIN accounts a ON a.id=c.account_id LEFT JOIN player_login_sessions s
        ON s.account_id=c.account_id AND s.expires_at>? AND a.status='normal'`).all(Date.now()) as Array<{ account_id: number; created_at: number; expires_at: number | null }>
    return new Map(rows.map(row => [row.account_id, { bound: true, boundAt: row.created_at, sessionExpiresAt: row.expires_at }]))
}
/** Switching disconnects previous transports, while keeping other saved accounts' credentials valid. */
export function finishPlayerLoginSwitch(previous: unknown, next: { profile: { viewer_id: number } }): void {
    const old = readPlayerLoginSession(previous)
    if (old && old.viewer_id !== next.profile.viewer_id) disconnectViewer(old.viewer_id)
}
function issue(accountId: number, remember: boolean): PlayerLoginSession {
    active(accountId)
    const result = { token: token(), account_id: accountId, viewer_id: getViewerIdSync(accountId),
        udid: token().slice(0, 32), expires_at: Date.now() + (remember ? 30 * DAY : DAY / 2) }
    if (!result.viewer_id) fail("存档缺少玩家序号，请联系管理员。")
    getDb().prepare("DELETE FROM player_login_sessions WHERE account_id=?").run(accountId)
    getDb().prepare("INSERT INTO player_login_sessions(token,account_id,viewer_id,udid,expires_at) VALUES(@token,@account_id,@viewer_id,@udid,@expires_at)").run(result)
    updateAccountSync({ id: accountId, takeoverUdid: result.udid, lastLoginTime: new Date() })
    audit(accountId, "login")
    return result
}
function loginResponse(session: PlayerLoginSession) {
    return { token: session.token, udid: session.udid, expires_at: session.expires_at, profile: playerLoginProfile(session.account_id) }
}
function result(session: PlayerLoginSession) {
    disconnectViewer(session.viewer_id)
    return loginResponse(session)
}
// ── Test-server tester accounts (deployment-local patch, not upstream) ──
// TEST_SERVER_SHARED_PASSWORD: one password for every tester; an unknown account name logging in with it
// gets a fresh account whose save is a copy of TEST_SERVER_TEMPLATE_SAVE (a V2 player snapshot JSON).
const testerPassword = process.env.TEST_SERVER_SHARED_PASSWORD || ""
const testerTemplatePath = process.env.TEST_SERVER_TEMPLATE_SAVE || ""
let testerTemplate: unknown = null
function loadTesterTemplate(): unknown {
    if (testerTemplate === null) {
        const { readFileSync } = require("node:fs") as typeof import("node:fs")
        testerTemplate = JSON.parse(readFileSync(testerTemplatePath, "utf8"))
    }
    return testerTemplate
}
function createTesterAccount(username: string, password: string, remember: boolean) {
    const { restorePlayerSaveSnapshotV2Sync } = require("../data/snapshots/player-snapshot") as typeof import("../data/snapshots/player-snapshot")
    const template = loadTesterTemplate()
    let newPlayerId = 0
    const session = runPersistenceTransactionSync({
        domain: "account", operation: "register_tester_login",
    }, () => {
        const account = insertAccountSync({ appId: "wf_cn", idpAlias: "", idpCode: "leiting", idpId: "", status: "normal" })
        setCredentials(account.id, username, password)
        const player = insertDefaultPlayerSync(account.id)
        newPlayerId = player.id
        restorePlayerSaveSnapshotV2Sync(template, player.id, { includeArchiveHistory: false })
        getDb().prepare("UPDATE players SET name=? WHERE id=?").run(username.slice(0, 12), player.id)
        let viewer = generateViewerId()
        while (getDb().prepare("SELECT 1 FROM sessions WHERE token=?").get(String(viewer))) viewer = generateViewerId()
        getDb().prepare("INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)").run(String(viewer), account.id, new Date(Date.now() + 365 * DAY).toISOString())
        return issue(account.id, remember)
    })
    saveAccountDefaultPlayer(session.account_id, newPlayerId)
    console.log(`[TESTER] new tester account created player=${newPlayerId}`)
    return result(session)
}
function testerLogin(username: unknown, password: unknown, remember: boolean) {
    const value = input(username, password)
    if (!equal(value.password, testerPassword)) fail("测试服密码不正确，请向作者索取。")
    const row = getDb().prepare(`SELECT a.id FROM accounts a JOIN player_login_credentials c ON c.account_id=a.id
        WHERE lower(a.username)=? AND a.username IS NOT NULL AND a.username<>''`).get(value.username) as { id: number } | undefined
    if (!row) return createTesterAccount(value.username, value.password, remember)
    const session = runPersistenceTransactionSync({ domain: "account", operation: "login_tester" }, () => issue(row.id, remember))
    return result(session)
}

export function registerPlayerLogin(username: unknown, password: unknown, remember: boolean) {
    if (testerPassword && testerTemplatePath) return testerLogin(username, password, remember)
    input(username, password)
    let newPlayerId = 0
    const session = runPersistenceTransactionSync({
        domain: "account", operation: "register_player_login",
    }, () => {
        const account = insertAccountSync({ appId: "wf_cn", idpAlias: "", idpCode: "leiting", idpId: "", status: "normal" })
        setCredentials(account.id, username, password)
        const player = insertDefaultPlayerSync(account.id)
        newPlayerId = player.id
        let viewer = generateViewerId()
        while (getDb().prepare("SELECT 1 FROM sessions WHERE token=?").get(String(viewer))) viewer = generateViewerId()
        getDb().prepare("INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)").run(String(viewer), account.id, new Date(Date.now() + 365 * DAY).toISOString())
        return issue(account.id, remember)
    })
    saveAccountDefaultPlayer(session.account_id, newPlayerId)
    return result(session)
}
function passwordLoginSync(value: ReturnType<typeof input>, remember: boolean) {
    const row = getDb().prepare(`SELECT a.id,c.password FROM accounts a JOIN player_login_credentials c ON c.account_id=a.id
        WHERE lower(a.username)=? AND a.username IS NOT NULL AND a.username<>''`).get(value.username) as { id: number; password: string } | undefined
    if (!row || !equal(row.password, value.password)) fail("账号或密码不正确。")
    // Prepare the response inside the transaction too: missing/corrupt profile
    // data must not revoke the old session and then report a failed login.
    return loginResponse(issue(row.id, remember))
}
export function loginPlayer(username: unknown, password: unknown, remember: boolean) {
    if (testerPassword && testerTemplatePath) return testerLogin(username, password, remember)
    const value = input(username, password)
    const response = runPersistenceTransactionSync({
        domain: "account", operation: "login_player",
    }, () => passwordLoginSync(value, remember))
    disconnectViewer(response.profile.viewer_id)
    return response
}

/** Password requests share bounded account admission and recheck credentials after waiting. */
export async function loginPlayerAsync(
    username: unknown, password: unknown, remember: boolean,
    options: { previousToken?: unknown; signal?: AbortSignal } = {},
) {
    const value = input(username, password)
    if (options.signal?.aborted) fail("登录请求已取消，请重新登录。", "REQUEST_CANCELLED")
    const deadline = performance.now() + PASSWORD_LOGIN_QUEUE_TIMEOUT_MS
    let committed = false, waitingFailure: PlayerLoginError | undefined
    let rejectWaiting!: (error: PlayerLoginError) => void
    const stopped = new Promise<never>((_resolve, reject) => { rejectWaiting = reject })
    const queueTimeout = () => new PlayerLoginError("服务器写入繁忙，请稍后重试。", "SERVER_BUSY")
    const stopWaiting = (error: PlayerLoginError) => {
        if (committed || waitingFailure) return
        waitingFailure = error
        rejectWaiting(error)
    }
    const abort = () => stopWaiting(new PlayerLoginError("登录请求已取消，请重新登录。", "REQUEST_CANCELLED"))
    options.signal?.addEventListener("abort", abort, { once: true })
    const timer = setTimeout(() => stopWaiting(queueTimeout()), PASSWORD_LOGIN_QUEUE_TIMEOUT_MS)
    timer.unref()
    const pending = runPersistenceTransaction({ domain: "account", operation: "login_player" }, () => {
        // A client that left while queued must not lose its still-valid session
        // to a token it will never receive. Cancellation after COMMIT cannot be
        // reported as a rolled-back login.
        if (waitingFailure) throw waitingFailure
        if (options.signal?.aborted) fail("登录请求已取消，请重新登录。", "REQUEST_CANCELLED")
        if (performance.now() >= deadline) throw queueTimeout()
        const response = passwordLoginSync(value, remember)
        return { response, previousViewerId: readPlayerLoginSession(options.previousToken)?.viewer_id }
    }, {
        afterCommit: ({ response, previousViewerId }) => {
            committed = true
            for (const viewerId of new Set([response.profile.viewer_id, previousViewerId])) {
                if (viewerId === undefined) continue
                try { disconnectViewer(viewerId) }
                catch {
                    // Transport cleanup cannot undo the committed session or
                    // turn success into a retry; never log tokens or raw errors.
                    console.error("[PLAYER-LOGIN] transport disconnect failed after committed login")
                }
            }
        },
    })
    try {
        // Return promptly, but retain admission until the original queued
        // closure drains. Both outcomes stay observed after timeout/cancel.
        const completed = await Promise.race([pending, stopped])
        return completed.response
    } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener("abort", abort)
    }
}
export function resumePlayerLogin(value: unknown) {
    const session = readPlayerLoginSession(value)
    if (!session) fail("登录已过期或已在其他设备登录，请重新登录。", "SESSION_INVALID")
    return { token: session.token, udid: session.udid, expires_at: session.expires_at, profile: playerLoginProfile(session.account_id) }
}
export function logoutPlayer(value: unknown): void {
    const session = readPlayerLoginSession(value)
    if (!session) return
    runPersistenceTransactionSync({
        domain: "account", operation: "logout_player",
    }, () => {
        getDb().prepare("DELETE FROM player_login_sessions WHERE token=?").run(session.token)
        audit(session.account_id, "logout")
    })
    disconnectViewer(session.viewer_id)
}
export function createPlayerLoginCode(viewer: unknown, purpose: unknown) {
    if (purpose !== "bind" && purpose !== "reset") fail("绑定码用途无效。")
    const accountId = playerAccountByViewer(viewer)
    if (!accountId) fail("没有找到这个玩家序号。")
    active(accountId)
    if (playerLoginManaged(accountId) !== (purpose === "reset")) fail(purpose === "bind" ? "该存档已经绑定账号。" : "该存档尚未绑定账号。")
    const code = randomBytes(12).toString("hex").toUpperCase()
    const expiresAt = Date.now() + 15 * 60000
    runPersistenceTransactionSync({
        domain: "account", operation: `create_player_login_${purpose}_code`,
    }, () => {
        getDb().prepare("DELETE FROM player_login_codes WHERE account_id=? AND purpose=?").run(accountId, purpose)
        getDb().prepare("INSERT INTO player_login_codes(code,account_id,purpose,expires_at) VALUES(?,?,?,?)").run(code, accountId, purpose, expiresAt)
        audit(accountId, `admin_${purpose}_code`)
    })
    return { code, expires_at: expiresAt, profile: playerLoginProfile(accountId) }
}
function readCode(value: unknown, purpose: string): ClaimCode {
    const code = typeof value === "string" ? value.replace(/[\s-]/g, "").toUpperCase() : ""
    const row = getDb().prepare("SELECT * FROM player_login_codes WHERE code=? AND purpose=? AND consumed_at IS NULL AND expires_at>?").get(code, purpose, Date.now()) as ClaimCode | undefined
    if (!row) fail("该验证码无效、已使用或已过期。")
    active(row.account_id)
    return row
}
interface LocalSaveEvidence { viewer_id: string; device_id: number; udid: string }
function localSaveEvidence(body: Record<string, unknown>): LocalSaveEvidence | null {
    const viewer = String(body.viewer_id ?? "")
    const device = typeof body.device_id === "number" || typeof body.device_id === "string" ? Number(body.device_id) : 0
    if (!/^[1-9]\d{0,14}$/.test(viewer)) return null
    return { viewer_id: viewer, device_id: Number.isSafeInteger(device) && device > 0 ? device : 0,
        udid: typeof body.udid === "string" && body.udid.length <= 128 ? body.udid : "" }
}
function localSaveMatch(evidence: LocalSaveEvidence) {
    // Both lookups use primary keys. UID alone is never sufficient to claim a save.
    const row = sql(`SELECT a.id,a.status,a.takeover_udid,c.account_id AS bound_id,d.device_id
        FROM sessions v JOIN accounts a ON a.id=v.account_id
        LEFT JOIN player_login_credentials c ON c.account_id=a.id
        LEFT JOIN device_bindings d ON d.device_id=? AND d.account_id=a.id
        WHERE v.token=? AND v.type=2`).get(evidence.device_id, evidence.viewer_id) as
        { id: number; status: string; takeover_udid: string | null; bound_id: number | null; device_id: number | null } | undefined
    if (!row || row.status !== "normal") return null
    if (row.bound_id) return { accountId: row.id, source: "bound" }
    // Once a transfer has installed a valid UDID, an old device binding cannot override it.
    if (row.takeover_udid && row.takeover_udid !== "unknown") {
        return evidence.udid.length >= 16 && equal(row.takeover_udid, evidence.udid)
            ? { accountId: row.id, source: "local_udid" } : null
    }
    return row.device_id ? { accountId: row.id, source: "local_device" } : null
}
/** First-upgrade discovery only; does not sign up, change device bindings or load a full save. */
export function previewLocalPlayerClaim(body: Record<string, unknown>) {
    const evidence = localSaveEvidence(body)
    return runPersistenceTransactionSync({
        domain: "account", operation: "preview_local_player_claim",
    }, () => {
        const match = evidence && localSaveMatch(evidence)
        if (!match) return { status: "manual_required" }
        // Do not reveal an existing username or profile from public UID input.
        if (match.source === "bound") return { status: "login_required" }
        const proof = token()
        getDb().prepare("INSERT INTO player_login_claims(proof,account_id,source,original_value,expires_at) VALUES(?,?,?,?,?)")
            .run(proof, match.accountId, match.source, JSON.stringify(evidence), Date.now() + 5 * 60000)
        audit(match.accountId, "local_claim_preview")
        return { status: "claimable", proof, profile: playerLoginProfile(match.accountId) }
    })
}
export function previewPlayerClaim(body: Record<string, unknown>) {
    return runPersistenceTransactionSync({
        domain: "account", operation: "preview_player_claim",
    }, () => {
        let accountId: number, source: string, original: string
        if (body.code) {
            const row = readCode(body.code, "bind")
            accountId = row.account_id; source = "code"; original = row.code
        } else {
            const id = playerAccountByViewer(body.viewer_id)
            const row = id ? identity(id) : undefined
            if (!row || typeof body.inherit_password !== "string" || !row.takeover_password || !equal(row.takeover_password, body.inherit_password)) fail("玩家序号或引继密码不正确。")
            active(row.id); accountId = row.id; source = "inherit"; original = row.takeover_password
        }
        if (playerLoginManaged(accountId)) fail("该存档已经绑定账号，请使用账号登录。")
        const proof = token()
        getDb().prepare("INSERT INTO player_login_claims(proof,account_id,source,original_value,expires_at) VALUES(?,?,?,?,?)").run(proof, accountId, source, original, Date.now() + 5 * 60000)
        audit(accountId, "claim_preview")
        return { proof, profile: playerLoginProfile(accountId) }
    })
}
export function bindPlayerLogin(proof: unknown, username: unknown, password: unknown, remember: boolean) {
    input(username, password)
    const session = runPersistenceTransactionSync({
        domain: "account", operation: "bind_player_login",
    }, () => {
        const row = getDb().prepare("SELECT * FROM player_login_claims WHERE proof=? AND expires_at>?").get(typeof proof === "string" ? proof : "", Date.now()) as { account_id: number; source: string; original_value: string } | undefined
        if (!row) fail("存档验证已过期，请重新验证。")
        const acc = active(row.account_id)
        if (playerLoginManaged(row.account_id)) fail("该存档已经绑定账号，请使用账号登录。")
        if (row.source === "code") {
            readCode(row.original_value, "bind")
            getDb().prepare("UPDATE player_login_codes SET consumed_at=? WHERE code=?").run(Date.now(), row.original_value)
        } else if (row.source === "inherit") {
            if (!acc.takeover_password || !equal(acc.takeover_password, row.original_value)) fail("引继密码已变化，请重新验证。")
        } else if (row.source === "local_device" || row.source === "local_udid") {
            const evidence = localSaveEvidence(JSON.parse(row.original_value))
            const match = evidence && localSaveMatch(evidence)
            if (!match || match.accountId !== row.account_id || match.source !== row.source) fail("原账号信息已变化，请重新验证存档。")
        } else fail("存档验证方式无效，请重新验证。")
        setCredentials(row.account_id, username, password)
        getDb().prepare("DELETE FROM player_login_claims WHERE account_id=?").run(row.account_id)
        audit(row.account_id, "bind_existing_save")
        return issue(row.account_id, remember)
    })
    return result(session)
}
export function resetPlayerLoginPassword(code: unknown, password: unknown) {
    input("validation", password)
    const accountId = runPersistenceTransactionSync({
        domain: "account", operation: "reset_player_login_password",
    }, () => {
        const row = readCode(code, "reset")
        if (!playerLoginManaged(row.account_id)) fail("该存档尚未绑定账号。")
        getDb().prepare("UPDATE player_login_credentials SET password=? WHERE account_id=?").run(password, row.account_id)
        getDb().prepare("DELETE FROM player_login_sessions WHERE account_id=?").run(row.account_id)
        getDb().prepare("UPDATE player_login_codes SET consumed_at=? WHERE code=?").run(Date.now(), row.code)
        audit(row.account_id, "reset_password")
        return row.account_id
    })
    disconnectViewer(getViewerIdSync(accountId))
    return { username: active(accountId).username }
}
