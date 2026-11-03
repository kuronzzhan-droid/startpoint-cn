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
exports.resetPlayerLoginPassword = exports.bindPlayerLogin = exports.previewPlayerClaim = exports.previewLocalPlayerClaim = exports.createPlayerLoginCode = exports.logoutPlayer = exports.resumePlayerLogin = exports.loginPlayerAsync = exports.loginPlayer = exports.registerPlayerLogin = exports.finishPlayerLoginSwitch = exports.playerLoginAdminOverview = exports.playerLoginProfile = exports.playerSocketAllowed = exports.readPlayerLoginAccess = exports.readPlayerLoginSession = exports.playerAccountByViewer = exports.readPlayerLoginDeviceAccess = exports.readPlayerLoginViewerAccess = exports.playerLoginManaged = exports.maintainPlayerLogin = exports.initializePlayerLogin = exports.PlayerLoginError = exports.disconnectDeletedPlayerLogin = exports.rememberVerifiedPlayerLogin = exports.verifiedPlayerLogin = exports.PASSWORD_LOGIN_QUEUE_TIMEOUT_MS = void 0;
const node_crypto_1 = require("node:crypto");
const node_perf_hooks_1 = require("node:perf_hooks");
const db_1 = require("../data/db");
const account_1 = require("../data/domains/account");
const player_1 = require("../data/domains/player");
const session_1 = require("../data/domains/session");
const activeAccount_1 = require("../data/activeAccount");
const stamina_1 = require("./stamina");
const utils_1 = require("../utils");
const persistence_coordinator_1 = require("./persistence-coordinator");
const DAY = 86400000;
// Leave room for the existing client's 15-second network timeout.
exports.PASSWORD_LOGIN_QUEUE_TIMEOUT_MS = 10000;
let initialized = false;
let nextMaintenanceAt = 0;
const statements = new Map();
function sql(query) {
    let statement = statements.get(query);
    if (!statement) {
        statement = (0, db_1.getDb)().prepare(query);
        statements.set(query, statement);
    }
    return statement;
}
const verifiedRequests = new WeakMap();
function verifiedPlayerLogin(request) { return verifiedRequests.get(request); }
exports.verifiedPlayerLogin = verifiedPlayerLogin;
function rememberVerifiedPlayerLogin(request, session) { verifiedRequests.set(request, session); }
exports.rememberVerifiedPlayerLogin = rememberVerifiedPlayerLogin;
let disconnectViewer = () => { };
/** Close existing transports after an administrator has deleted the account. */
function disconnectDeletedPlayerLogin(viewerId) { disconnectViewer(viewerId); }
exports.disconnectDeletedPlayerLogin = disconnectDeletedPlayerLogin;
class PlayerLoginError extends Error {
    constructor(message, code = "INVALID_INPUT") {
        super(message);
        this.code = code;
    }
}
exports.PlayerLoginError = PlayerLoginError;
function initializePlayerLogin(disconnect) {
    (0, db_1.getDb)().exec(`
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
    `);
    initialized = true;
    if (disconnect)
        disconnectViewer = disconnect;
}
exports.initializePlayerLogin = initializePlayerLogin;
function fail(message, code = "INVALID_INPUT") { throw new PlayerLoginError(message, code); }
function token() { return (0, node_crypto_1.randomBytes)(32).toString("hex"); }
function equal(left, right) {
    const a = Buffer.from(left), b = Buffer.from(right);
    return a.length === b.length && (0, node_crypto_1.timingSafeEqual)(a, b);
}
function identity(accountId) {
    return (0, db_1.getDb)().prepare(`SELECT a.id,a.status,a.username,a.takeover_password,c.password
        FROM accounts a LEFT JOIN player_login_credentials c ON c.account_id=a.id WHERE a.id=?`).get(accountId);
}
function active(accountId) {
    const row = identity(accountId);
    if (!row || row.status !== "normal")
        fail("该账号当前无法登录，请联系管理员。");
    return row;
}
function audit(accountId, action) {
    const inserted = sql("INSERT INTO player_login_audit(account_id,action,occurred_at) VALUES(?,?,?)").run(accountId, action, Date.now());
    // One indexed row in steady state; also drains an older backlog in bounded batches.
    sql("DELETE FROM player_login_audit WHERE id IN (SELECT id FROM player_login_audit WHERE id<=? ORDER BY id LIMIT 100)").run(Number(inserted.lastInsertRowid) - 5000);
    maintainPlayerLogin();
}
/** Opportunistic, bounded cleanup; expiration is always enforced by reads, regardless of cleanup timing. */
function maintainPlayerLogin() {
    const now = Date.now();
    if (now < nextMaintenanceAt)
        return;
    nextMaintenanceAt = now + 60000;
    for (const table of ["player_login_claims", "player_login_codes", "player_login_sessions"]) {
        sql(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE expires_at <= ? ORDER BY expires_at LIMIT 100)`).run(now);
    }
    sql("DELETE FROM player_login_codes WHERE rowid IN (SELECT rowid FROM player_login_codes WHERE consumed_at IS NOT NULL ORDER BY consumed_at LIMIT 100)").run();
}
exports.maintainPlayerLogin = maintainPlayerLogin;
function input(username, password) {
    if (typeof username !== "string" || !/^[A-Za-z0-9_]{4,24}$/.test(username))
        fail("账号需为 4–24 位字母、数字或下划线。");
    if (typeof password !== "string" || password.length < 6 || password.length > 64 || /[\x00-\x1f]/.test(password))
        fail("密码需为 6–64 位字符。");
    return { username: username.toLowerCase(), password };
}
function setCredentials(accountId, username, password) {
    const value = input(username, password);
    if ((0, db_1.getDb)().prepare("SELECT 1 FROM accounts WHERE lower(username)=? AND id<>?").get(value.username, accountId))
        fail("这个账号名已被使用，请换一个。");
    if ((0, db_1.getDb)().prepare("SELECT 1 FROM player_login_credentials WHERE account_id=?").get(accountId))
        fail("该存档已经绑定账号，请使用账号登录。");
    // Plaintext player passwords are an explicit project requirement. Never return or log this column.
    (0, db_1.getDb)().prepare("INSERT INTO player_login_credentials(account_id,password,created_at) VALUES(?,?,?)").run(accountId, value.password, Date.now());
    (0, account_1.updateAccountSync)({ id: accountId, username: value.username });
}
function playerLoginManaged(accountId) {
    return initialized && Boolean(sql("SELECT 1 FROM player_login_credentials WHERE account_id=?").get(accountId));
}
exports.playerLoginManaged = playerLoginManaged;
/** One indexed read for the legacy viewer identity and its login-binding state. */
function readPlayerLoginViewerAccess(viewer) {
    if (!/^\d{1,15}$/.test(String(viewer !== null && viewer !== void 0 ? viewer : "")))
        return null;
    if (!initialized) {
        const accountId = playerAccountByViewer(viewer);
        return accountId === null ? null : { accountId, managed: false };
    }
    const row = sql(`SELECT v.account_id,
            CASE WHEN c.account_id IS NULL THEN 0 ELSE 1 END AS managed
        FROM sessions v
        LEFT JOIN player_login_credentials c ON c.account_id=v.account_id
        WHERE v.token=? AND v.type=2`).get(String(viewer));
    return row ? { accountId: row.account_id, managed: row.managed === 1 } : null;
}
exports.readPlayerLoginViewerAccess = readPlayerLoginViewerAccess;
function readPlayerLoginDeviceAccess(device) {
    const deviceId = Number(device);
    if (!Number.isSafeInteger(deviceId) || deviceId <= 0)
        return null;
    if (!initialized) {
        const row = sql("SELECT account_id FROM device_bindings WHERE device_id=?").get(deviceId);
        return row ? { accountId: row.account_id, managed: false } : null;
    }
    const row = sql(`SELECT d.account_id,
            CASE WHEN c.account_id IS NULL THEN 0 ELSE 1 END AS managed
        FROM device_bindings d
        LEFT JOIN player_login_credentials c ON c.account_id=d.account_id
        WHERE d.device_id=?`).get(deviceId);
    return row ? { accountId: row.account_id, managed: row.managed === 1 } : null;
}
exports.readPlayerLoginDeviceAccess = readPlayerLoginDeviceAccess;
function playerAccountByViewer(viewer) {
    var _a;
    if (!/^\d{1,15}$/.test(String(viewer !== null && viewer !== void 0 ? viewer : "")))
        return null;
    const row = sql("SELECT account_id FROM sessions WHERE token=? AND type=2").get(String(viewer));
    return (_a = row === null || row === void 0 ? void 0 : row.account_id) !== null && _a !== void 0 ? _a : null;
}
exports.playerAccountByViewer = playerAccountByViewer;
function readPlayerLoginSession(value) {
    var _a;
    if (!initialized || typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
        return null;
    return (_a = sql(`SELECT s.* FROM player_login_sessions s JOIN accounts a ON a.id=s.account_id
        WHERE s.token=? AND s.expires_at>? AND a.status='normal'`).get(value, Date.now())) !== null && _a !== void 0 ? _a : null;
}
exports.readPlayerLoginSession = readPlayerLoginSession;
/** One indexed query on the authenticated game hot path; no cross-request authorization cache. */
function readPlayerLoginAccess(value, viewer) {
    var _a;
    if (!initialized || typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
        return null;
    const viewerKey = /^\d{1,15}$/.test(String(viewer !== null && viewer !== void 0 ? viewer : "")) ? String(viewer) : "";
    return (_a = sql(`SELECT s.*,v.account_id AS request_account_id
        FROM player_login_sessions s JOIN accounts a ON a.id=s.account_id
        LEFT JOIN sessions v ON v.token=? AND v.type=2
        WHERE s.token=? AND s.expires_at>? AND a.status='normal'`).get(viewerKey, value, Date.now())) !== null && _a !== void 0 ? _a : null;
}
exports.readPlayerLoginAccess = readPlayerLoginAccess;
function playerSocketAllowed(viewer, value) {
    var _a;
    const access = readPlayerLoginViewerAccess(viewer);
    if (!(access === null || access === void 0 ? void 0 : access.managed))
        return true;
    return ((_a = readPlayerLoginSession(value)) === null || _a === void 0 ? void 0 : _a.account_id) === access.accountId;
}
exports.playerSocketAllowed = playerSocketAllowed;
function playerLoginProfile(accountId) {
    const acc = active(accountId);
    const playerId = (0, activeAccount_1.resolvePlayerIdSync)(accountId);
    const player = playerId ? sql("SELECT name,rank_point,leader_character_id FROM players WHERE id=?").get(playerId) : null;
    if (!player)
        fail("没有找到该账号的存档，请联系管理员。");
    return { username: acc.username, viewer_id: (0, session_1.getViewerIdSync)(accountId), name: player.name,
        rank: (0, stamina_1.getRankDegree)(player.rank_point), leader_character_id: player.leader_character_id };
}
exports.playerLoginProfile = playerLoginProfile;
function playerLoginAdminOverview() {
    if (!initialized)
        return new Map();
    const rows = sql(`SELECT c.account_id,c.created_at,s.expires_at FROM player_login_credentials c
        JOIN accounts a ON a.id=c.account_id LEFT JOIN player_login_sessions s
        ON s.account_id=c.account_id AND s.expires_at>? AND a.status='normal'`).all(Date.now());
    return new Map(rows.map(row => [row.account_id, { bound: true, boundAt: row.created_at, sessionExpiresAt: row.expires_at }]));
}
exports.playerLoginAdminOverview = playerLoginAdminOverview;
/** Switching disconnects previous transports, while keeping other saved accounts' credentials valid. */
function finishPlayerLoginSwitch(previous, next) {
    const old = readPlayerLoginSession(previous);
    if (old && old.viewer_id !== next.profile.viewer_id)
        disconnectViewer(old.viewer_id);
}
exports.finishPlayerLoginSwitch = finishPlayerLoginSwitch;
function issue(accountId, remember) {
    active(accountId);
    const result = { token: token(), account_id: accountId, viewer_id: (0, session_1.getViewerIdSync)(accountId),
        udid: token().slice(0, 32), expires_at: Date.now() + (remember ? 30 * DAY : DAY / 2) };
    if (!result.viewer_id)
        fail("存档缺少玩家序号，请联系管理员。");
    (0, db_1.getDb)().prepare("DELETE FROM player_login_sessions WHERE account_id=?").run(accountId);
    (0, db_1.getDb)().prepare("INSERT INTO player_login_sessions(token,account_id,viewer_id,udid,expires_at) VALUES(@token,@account_id,@viewer_id,@udid,@expires_at)").run(result);
    (0, account_1.updateAccountSync)({ id: accountId, takeoverUdid: result.udid, lastLoginTime: new Date() });
    audit(accountId, "login");
    return result;
}
function loginResponse(session) {
    return { token: session.token, udid: session.udid, expires_at: session.expires_at, profile: playerLoginProfile(session.account_id) };
}
function result(session) {
    disconnectViewer(session.viewer_id);
    return loginResponse(session);
}
// ── Test-server tester accounts (deployment-local patch, not upstream) ──
// TEST_SERVER_SHARED_PASSWORD: one password for every tester; an unknown account name logging in with it
// gets a fresh account whose save is a copy of TEST_SERVER_TEMPLATE_SAVE (a V2 player snapshot JSON).
const testerPassword = process.env.TEST_SERVER_SHARED_PASSWORD || "";
// α 测试群公告里的公开密码（作者 1103）；和原来的共享密码并存，老测试员不受影响
const testerPublicPassword = process.env.TEST_SERVER_PUBLIC_PASSWORD || "";
const testerTemplatePath = process.env.TEST_SERVER_TEMPLATE_SAVE || "";
let testerTemplate = null;
function loadTesterTemplate() {
    if (testerTemplate === null) {
        const { readFileSync } = require("node:fs");
        testerTemplate = JSON.parse(readFileSync(testerTemplatePath, "utf8"));
    }
    return testerTemplate;
}
function createTesterAccount(username, password, remember) {
    const { restorePlayerSaveSnapshotV2Sync } = require("../data/snapshots/player-snapshot");
    const template = loadTesterTemplate();
    let newPlayerId = 0;
    const session = (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "account", operation: "register_tester_login",
    }, () => {
        const account = (0, account_1.insertAccountSync)({ appId: "wf_cn", idpAlias: "", idpCode: "leiting", idpId: "", status: "normal" });
        setCredentials(account.id, username, password);
        const player = (0, player_1.insertDefaultPlayerSync)(account.id);
        newPlayerId = player.id;
        // 测试服：test 前缀账号=满存档模板，其余=新手开局
        if (username.toLowerCase().startsWith("test"))
            restorePlayerSaveSnapshotV2Sync(template, player.id, { includeArchiveHistory: false });
        (0, db_1.getDb)().prepare("UPDATE players SET name=? WHERE id=?").run(username.slice(0, 12), player.id);
        let viewer = (0, utils_1.generateViewerId)();
        while ((0, db_1.getDb)().prepare("SELECT 1 FROM sessions WHERE token=?").get(String(viewer)))
            viewer = (0, utils_1.generateViewerId)();
        (0, db_1.getDb)().prepare("INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)").run(String(viewer), account.id, new Date(Date.now() + 365 * DAY).toISOString());
        return issue(account.id, remember);
    });
    (0, activeAccount_1.saveAccountDefaultPlayer)(session.account_id, newPlayerId);
    console.log(`[TESTER] new tester account created player=${newPlayerId}`);
    return result(session);
}
function testerLogin(username, password, remember) {
    const value = input(username, password);
    if (!equal(value.password, testerPassword) && !(testerPublicPassword && equal(value.password, testerPublicPassword)))
        fail("测试服密码不正确，请向作者索取。");
    const row = (0, db_1.getDb)().prepare(`SELECT a.id FROM accounts a JOIN player_login_credentials c ON c.account_id=a.id
        WHERE lower(a.username)=? AND a.username IS NOT NULL AND a.username<>''`).get(value.username);
    if (!row)
        return createTesterAccount(value.username, value.password, remember);
    const session = (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "account", operation: "login_tester" }, () => issue(row.id, remember));
    return result(session);
}
function registerPlayerLogin(username, password, remember) {
    if (testerPassword && testerTemplatePath)
        return testerLogin(username, password, remember);
    input(username, password);
    let newPlayerId = 0;
    const session = (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "account", operation: "register_player_login",
    }, () => {
        const account = (0, account_1.insertAccountSync)({ appId: "wf_cn", idpAlias: "", idpCode: "leiting", idpId: "", status: "normal" });
        setCredentials(account.id, username, password);
        const player = (0, player_1.insertDefaultPlayerSync)(account.id);
        newPlayerId = player.id;
        let viewer = (0, utils_1.generateViewerId)();
        while ((0, db_1.getDb)().prepare("SELECT 1 FROM sessions WHERE token=?").get(String(viewer)))
            viewer = (0, utils_1.generateViewerId)();
        (0, db_1.getDb)().prepare("INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)").run(String(viewer), account.id, new Date(Date.now() + 365 * DAY).toISOString());
        return issue(account.id, remember);
    });
    (0, activeAccount_1.saveAccountDefaultPlayer)(session.account_id, newPlayerId);
    return result(session);
}
exports.registerPlayerLogin = registerPlayerLogin;
function passwordLoginSync(value, remember) {
    const row = (0, db_1.getDb)().prepare(`SELECT a.id,c.password FROM accounts a JOIN player_login_credentials c ON c.account_id=a.id
        WHERE lower(a.username)=? AND a.username IS NOT NULL AND a.username<>''`).get(value.username);
    if (!row || !equal(row.password, value.password))
        fail("账号或密码不正确。");
    // Prepare the response inside the transaction too: missing/corrupt profile
    // data must not revoke the old session and then report a failed login.
    return loginResponse(issue(row.id, remember));
}
function loginPlayer(username, password, remember) {
    if (testerPassword && testerTemplatePath)
        return testerLogin(username, password, remember);
    const value = input(username, password);
    const response = (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "account", operation: "login_player",
    }, () => passwordLoginSync(value, remember));
    disconnectViewer(response.profile.viewer_id);
    return response;
}
exports.loginPlayer = loginPlayer;
/** Password requests share bounded account admission and recheck credentials after waiting. */
function loginPlayerAsync(username_1, password_1, remember_1) {
    return __awaiter(this, arguments, void 0, function* (username, password, remember, options = {}) {
        var _a, _b, _c;
        const value = input(username, password);
        // 测试服：用共享密码或公开密码点「登录」也走测试员通道（已有账号直接登录、没有就建号），和「注册」一致
        if (testerPassword && testerTemplatePath
            && (equal(value.password, testerPassword) || (testerPublicPassword && equal(value.password, testerPublicPassword))))
            return testerLogin(username, password, remember);
        if ((_a = options.signal) === null || _a === void 0 ? void 0 : _a.aborted)
            fail("登录请求已取消，请重新登录。", "REQUEST_CANCELLED");
        const deadline = node_perf_hooks_1.performance.now() + exports.PASSWORD_LOGIN_QUEUE_TIMEOUT_MS;
        let committed = false, waitingFailure;
        let rejectWaiting;
        const stopped = new Promise((_resolve, reject) => { rejectWaiting = reject; });
        const queueTimeout = () => new PlayerLoginError("服务器写入繁忙，请稍后重试。", "SERVER_BUSY");
        const stopWaiting = (error) => {
            if (committed || waitingFailure)
                return;
            waitingFailure = error;
            rejectWaiting(error);
        };
        const abort = () => stopWaiting(new PlayerLoginError("登录请求已取消，请重新登录。", "REQUEST_CANCELLED"));
        (_b = options.signal) === null || _b === void 0 ? void 0 : _b.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(() => stopWaiting(queueTimeout()), exports.PASSWORD_LOGIN_QUEUE_TIMEOUT_MS);
        timer.unref();
        const pending = (0, persistence_coordinator_1.runPersistenceTransaction)({ domain: "account", operation: "login_player" }, () => {
            var _a, _b;
            // A client that left while queued must not lose its still-valid session
            // to a token it will never receive. Cancellation after COMMIT cannot be
            // reported as a rolled-back login.
            if (waitingFailure)
                throw waitingFailure;
            if ((_a = options.signal) === null || _a === void 0 ? void 0 : _a.aborted)
                fail("登录请求已取消，请重新登录。", "REQUEST_CANCELLED");
            if (node_perf_hooks_1.performance.now() >= deadline)
                throw queueTimeout();
            const response = passwordLoginSync(value, remember);
            return { response, previousViewerId: (_b = readPlayerLoginSession(options.previousToken)) === null || _b === void 0 ? void 0 : _b.viewer_id };
        }, {
            afterCommit: ({ response, previousViewerId }) => {
                committed = true;
                for (const viewerId of new Set([response.profile.viewer_id, previousViewerId])) {
                    if (viewerId === undefined)
                        continue;
                    try {
                        disconnectViewer(viewerId);
                    }
                    catch (_a) {
                        // Transport cleanup cannot undo the committed session or
                        // turn success into a retry; never log tokens or raw errors.
                        console.error("[PLAYER-LOGIN] transport disconnect failed after committed login");
                    }
                }
            },
        });
        try {
            // Return promptly, but retain admission until the original queued
            // closure drains. Both outcomes stay observed after timeout/cancel.
            const completed = yield Promise.race([pending, stopped]);
            return completed.response;
        }
        finally {
            clearTimeout(timer);
            (_c = options.signal) === null || _c === void 0 ? void 0 : _c.removeEventListener("abort", abort);
        }
    });
}
exports.loginPlayerAsync = loginPlayerAsync;
function resumePlayerLogin(value) {
    const session = readPlayerLoginSession(value);
    if (!session)
        fail("登录已过期或已在其他设备登录，请重新登录。", "SESSION_INVALID");
    return { token: session.token, udid: session.udid, expires_at: session.expires_at, profile: playerLoginProfile(session.account_id) };
}
exports.resumePlayerLogin = resumePlayerLogin;
function logoutPlayer(value) {
    const session = readPlayerLoginSession(value);
    if (!session)
        return;
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "account", operation: "logout_player",
    }, () => {
        (0, db_1.getDb)().prepare("DELETE FROM player_login_sessions WHERE token=?").run(session.token);
        audit(session.account_id, "logout");
    });
    disconnectViewer(session.viewer_id);
}
exports.logoutPlayer = logoutPlayer;
function createPlayerLoginCode(viewer, purpose) {
    if (purpose !== "bind" && purpose !== "reset")
        fail("绑定码用途无效。");
    const accountId = playerAccountByViewer(viewer);
    if (!accountId)
        fail("没有找到这个玩家序号。");
    active(accountId);
    if (playerLoginManaged(accountId) !== (purpose === "reset"))
        fail(purpose === "bind" ? "该存档已经绑定账号。" : "该存档尚未绑定账号。");
    const code = (0, node_crypto_1.randomBytes)(12).toString("hex").toUpperCase();
    const expiresAt = Date.now() + 15 * 60000;
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "account", operation: `create_player_login_${purpose}_code`,
    }, () => {
        (0, db_1.getDb)().prepare("DELETE FROM player_login_codes WHERE account_id=? AND purpose=?").run(accountId, purpose);
        (0, db_1.getDb)().prepare("INSERT INTO player_login_codes(code,account_id,purpose,expires_at) VALUES(?,?,?,?)").run(code, accountId, purpose, expiresAt);
        audit(accountId, `admin_${purpose}_code`);
    });
    return { code, expires_at: expiresAt, profile: playerLoginProfile(accountId) };
}
exports.createPlayerLoginCode = createPlayerLoginCode;
function readCode(value, purpose) {
    const code = typeof value === "string" ? value.replace(/[\s-]/g, "").toUpperCase() : "";
    const row = (0, db_1.getDb)().prepare("SELECT * FROM player_login_codes WHERE code=? AND purpose=? AND consumed_at IS NULL AND expires_at>?").get(code, purpose, Date.now());
    if (!row)
        fail("该验证码无效、已使用或已过期。");
    active(row.account_id);
    return row;
}
function localSaveEvidence(body) {
    var _a;
    const viewer = String((_a = body.viewer_id) !== null && _a !== void 0 ? _a : "");
    const device = typeof body.device_id === "number" || typeof body.device_id === "string" ? Number(body.device_id) : 0;
    if (!/^[1-9]\d{0,14}$/.test(viewer))
        return null;
    return { viewer_id: viewer, device_id: Number.isSafeInteger(device) && device > 0 ? device : 0,
        udid: typeof body.udid === "string" && body.udid.length <= 128 ? body.udid : "" };
}
function localSaveMatch(evidence) {
    // Both lookups use primary keys. UID alone is never sufficient to claim a save.
    const row = sql(`SELECT a.id,a.status,a.takeover_udid,c.account_id AS bound_id,d.device_id
        FROM sessions v JOIN accounts a ON a.id=v.account_id
        LEFT JOIN player_login_credentials c ON c.account_id=a.id
        LEFT JOIN device_bindings d ON d.device_id=? AND d.account_id=a.id
        WHERE v.token=? AND v.type=2`).get(evidence.device_id, evidence.viewer_id);
    if (!row || row.status !== "normal")
        return null;
    if (row.bound_id)
        return { accountId: row.id, source: "bound" };
    // Once a transfer has installed a valid UDID, an old device binding cannot override it.
    if (row.takeover_udid && row.takeover_udid !== "unknown") {
        return evidence.udid.length >= 16 && equal(row.takeover_udid, evidence.udid)
            ? { accountId: row.id, source: "local_udid" } : null;
    }
    return row.device_id ? { accountId: row.id, source: "local_device" } : null;
}
/** First-upgrade discovery only; does not sign up, change device bindings or load a full save. */
function previewLocalPlayerClaim(body) {
    const evidence = localSaveEvidence(body);
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "account", operation: "preview_local_player_claim",
    }, () => {
        const match = evidence && localSaveMatch(evidence);
        if (!match)
            return { status: "manual_required" };
        // Do not reveal an existing username or profile from public UID input.
        if (match.source === "bound")
            return { status: "login_required" };
        const proof = token();
        (0, db_1.getDb)().prepare("INSERT INTO player_login_claims(proof,account_id,source,original_value,expires_at) VALUES(?,?,?,?,?)")
            .run(proof, match.accountId, match.source, JSON.stringify(evidence), Date.now() + 5 * 60000);
        audit(match.accountId, "local_claim_preview");
        return { status: "claimable", proof, profile: playerLoginProfile(match.accountId) };
    });
}
exports.previewLocalPlayerClaim = previewLocalPlayerClaim;
function previewPlayerClaim(body) {
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "account", operation: "preview_player_claim",
    }, () => {
        let accountId, source, original;
        if (body.code) {
            const row = readCode(body.code, "bind");
            accountId = row.account_id;
            source = "code";
            original = row.code;
        }
        else {
            const id = playerAccountByViewer(body.viewer_id);
            const row = id ? identity(id) : undefined;
            if (!row || typeof body.inherit_password !== "string" || !row.takeover_password || !equal(row.takeover_password, body.inherit_password))
                fail("玩家序号或引继密码不正确。");
            active(row.id);
            accountId = row.id;
            source = "inherit";
            original = row.takeover_password;
        }
        if (playerLoginManaged(accountId))
            fail("该存档已经绑定账号，请使用账号登录。");
        const proof = token();
        (0, db_1.getDb)().prepare("INSERT INTO player_login_claims(proof,account_id,source,original_value,expires_at) VALUES(?,?,?,?,?)").run(proof, accountId, source, original, Date.now() + 5 * 60000);
        audit(accountId, "claim_preview");
        return { proof, profile: playerLoginProfile(accountId) };
    });
}
exports.previewPlayerClaim = previewPlayerClaim;
function bindPlayerLogin(proof, username, password, remember) {
    input(username, password);
    const session = (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "account", operation: "bind_player_login",
    }, () => {
        const row = (0, db_1.getDb)().prepare("SELECT * FROM player_login_claims WHERE proof=? AND expires_at>?").get(typeof proof === "string" ? proof : "", Date.now());
        if (!row)
            fail("存档验证已过期，请重新验证。");
        const acc = active(row.account_id);
        if (playerLoginManaged(row.account_id))
            fail("该存档已经绑定账号，请使用账号登录。");
        if (row.source === "code") {
            readCode(row.original_value, "bind");
            (0, db_1.getDb)().prepare("UPDATE player_login_codes SET consumed_at=? WHERE code=?").run(Date.now(), row.original_value);
        }
        else if (row.source === "inherit") {
            if (!acc.takeover_password || !equal(acc.takeover_password, row.original_value))
                fail("引继密码已变化，请重新验证。");
        }
        else if (row.source === "local_device" || row.source === "local_udid") {
            const evidence = localSaveEvidence(JSON.parse(row.original_value));
            const match = evidence && localSaveMatch(evidence);
            if (!match || match.accountId !== row.account_id || match.source !== row.source)
                fail("原账号信息已变化，请重新验证存档。");
        }
        else
            fail("存档验证方式无效，请重新验证。");
        setCredentials(row.account_id, username, password);
        (0, db_1.getDb)().prepare("DELETE FROM player_login_claims WHERE account_id=?").run(row.account_id);
        audit(row.account_id, "bind_existing_save");
        return issue(row.account_id, remember);
    });
    return result(session);
}
exports.bindPlayerLogin = bindPlayerLogin;
function resetPlayerLoginPassword(code, password) {
    input("validation", password);
    const accountId = (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "account", operation: "reset_player_login_password",
    }, () => {
        const row = readCode(code, "reset");
        if (!playerLoginManaged(row.account_id))
            fail("该存档尚未绑定账号。");
        (0, db_1.getDb)().prepare("UPDATE player_login_credentials SET password=? WHERE account_id=?").run(password, row.account_id);
        (0, db_1.getDb)().prepare("DELETE FROM player_login_sessions WHERE account_id=?").run(row.account_id);
        (0, db_1.getDb)().prepare("UPDATE player_login_codes SET consumed_at=? WHERE code=?").run(Date.now(), row.code);
        audit(row.account_id, "reset_password");
        return row.account_id;
    });
    disconnectViewer((0, session_1.getViewerIdSync)(accountId));
    return { username: active(accountId).username };
}
exports.resetPlayerLoginPassword = resetPlayerLoginPassword;
