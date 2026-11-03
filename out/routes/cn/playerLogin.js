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
exports.installPlayerLoginGuard = void 0;
const player_login_rate_limit_1 = require("../../lib/player-login-rate-limit");
const account_creation_budget_1 = require("../../lib/account-creation-budget");
const request_route_path_1 = require("../../lib/request-route-path");
const persistence_admission_1 = require("../../lib/persistence-admission");
const db_1 = require("../../data/db");
const utils_1 = require("../../utils");
const player_login_1 = require("../../lib/player-login");
function installPlayerLoginGuard(app) {
    app.addHook("preHandler", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const path = (0, request_route_path_1.requestRoutePath)(request);
        if (!path.startsWith("/api/index.php/"))
            return;
        const body = (request.body && typeof request.body === "object" ? request.body : {});
        const supplied = request.headers["x-sp-session"];
        const viewer = body.viewer_id || body.keychain;
        const session = (0, player_login_1.readPlayerLoginAccess)(supplied, viewer);
        let denied = Boolean(supplied && !session);
        const viewerAccess = session ? null : (0, player_login_1.readPlayerLoginViewerAccess)(viewer);
        const accountId = session ? session.request_account_id : (_a = viewerAccess === null || viewerAccess === void 0 ? void 0 : viewerAccess.accountId) !== null && _a !== void 0 ? _a : null;
        if (session && viewer && Number(viewer) !== 0 && accountId !== session.account_id)
            denied = true;
        if (!session && (viewerAccess === null || viewerAccess === void 0 ? void 0 : viewerAccess.managed))
            denied = true;
        // Bound saves are recovered via player login; legacy transfer must never delete a signed-up account.
        if (path.includes("/take_over")) {
            const legacyTarget = (0, player_login_1.readPlayerLoginViewerAccess)(body.input_viewer_id);
            if (session || (viewerAccess === null || viewerAccess === void 0 ? void 0 : viewerAccess.managed) || (legacyTarget === null || legacyTarget === void 0 ? void 0 : legacyTarget.managed))
                denied = true;
        }
        if (path.endsWith("/tool/signup") && !session) {
            if ((_b = (0, player_login_1.readPlayerLoginDeviceAccess)(body.device_id)) === null || _b === void 0 ? void 0 : _b.managed)
                denied = true;
        }
        if (!denied) {
            if (session)
                (0, player_login_1.rememberVerifiedPlayerLogin)(request, session);
            return;
        }
        reply.type("application/x-msgpack");
        return reply.send({ data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: Number(viewer) || 0, result_code: 516 }), data: {} });
    }));
}
exports.installPlayerLoginGuard = installPlayerLoginGuard;
function playerLoginRoutes(app) {
    return __awaiter(this, void 0, void 0, function* () {
        const limited = (0, player_login_rate_limit_1.createPlayerLoginRateLimiter)();
        const creation = (0, account_creation_budget_1.accountCreationBudget)(app);
        function route(path, handler, admin = false) {
            app.post(path, { bodyLimit: 4096 }, (request, reply) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                reply.header("cache-control", "no-store");
                const input = request.body;
                const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
                const restoring = path.endsWith("/resume") || path.endsWith("/logout");
                // New-account admission has its own source/global budget; attempts
                // to register must not consume existing players' login/bind quotas.
                if (!admin && path !== "/player-auth/register" && limited(request.ip, path, body, restoring ? (_b = (_a = (0, player_login_1.readPlayerLoginSession)(body.token)) === null || _a === void 0 ? void 0 : _a.account_id) !== null && _b !== void 0 ? _b : null : null))
                    return { ok: false, code: "RATE_LIMITED", message: "操作较频繁，请稍后再试。" };
                try {
                    const body = request.body;
                    if (!body || typeof body !== "object" || Array.isArray(body))
                        throw new player_login_1.PlayerLoginError("请求内容无效。");
                    return { ok: true, data: yield handler(body, request, reply) };
                }
                catch (error) {
                    if ((0, persistence_admission_1.isPersistenceAdmissionError)(error) || (error instanceof player_login_1.PlayerLoginError && error.code === "SERVER_BUSY")) {
                        reply.header("retry-after", "1");
                        return { ok: false, code: "SERVER_BUSY", message: "服务器写入繁忙，请稍后重试。" };
                    }
                    // Never serialize request bodies, passwords, proofs, session tokens or raw database errors.
                    return { ok: false, code: error instanceof player_login_1.PlayerLoginError ? error.code : "SERVER_ERROR", message: error instanceof player_login_1.PlayerLoginError ? error.message : "暂时无法完成，请稍后重试。" };
                }
            }));
        }
        function activate(b, next) {
            (0, player_login_1.finishPlayerLoginSwitch)(b.previous_token, next);
            return next;
        }
        route("/player-auth/register", (b, request) => {
            const reservation = creation.reserve(request.ip);
            if (!reservation)
                throw new player_login_1.PlayerLoginError("新建账号较频繁，请稍后再试。", "RATE_LIMITED");
            const username = typeof b.username === "string" && /^[A-Za-z0-9_]{4,24}$/.test(b.username)
                ? b.username.toLowerCase() : null;
            let originalId;
            const accountId = () => {
                var _a;
                return username === null ? undefined : (_a = (0, db_1.getDb)().prepare("SELECT id FROM accounts WHERE lower(username)=? AND username IS NOT NULL AND username<>''")
                    .get(username)) === null || _a === void 0 ? void 0 : _a.id;
            };
            try {
                originalId = accountId();
                const registered = (0, player_login_1.registerPlayerLogin)(b.username, b.password, b.remember === true);
                reservation.commit();
                return activate(b, registered);
            }
            catch (error) {
                // The library commits before preference writes/transport callbacks.
                // A post-commit failure must still consume the creation quota.
                try {
                    const currentId = accountId();
                    if (currentId !== undefined && currentId !== originalId)
                        reservation.commit();
                    else
                        reservation.release();
                }
                catch (_a) {
                    reservation.commit();
                } // Unknown durable outcome: fail closed.
                throw error;
            }
        });
        route("/player-auth/login", (b, request, reply) => __awaiter(this, void 0, void 0, function* () {
            const cancellation = new AbortController();
            const abort = () => cancellation.abort();
            const close = () => { if (!reply.raw.writableEnded)
                abort(); };
            request.raw.once("aborted", abort);
            reply.raw.once("close", close);
            if (request.raw.aborted || reply.raw.destroyed)
                abort();
            try {
                return yield (0, player_login_1.loginPlayerAsync)(b.username, b.password, b.remember === true, {
                    previousToken: b.previous_token, signal: cancellation.signal,
                });
            }
            finally {
                request.raw.removeListener("aborted", abort);
                reply.raw.removeListener("close", close);
            }
        }));
        route("/player-auth/resume", b => activate(b, (0, player_login_1.resumePlayerLogin)(b.token)));
        route("/player-auth/logout", b => { (0, player_login_1.logoutPlayer)(b.token); return {}; });
        route("/player-auth/claim-preview", b => (0, player_login_1.previewPlayerClaim)(b));
        route("/player-auth/local-claim-preview", b => (0, player_login_1.previewLocalPlayerClaim)(b));
        route("/player-auth/bind", b => activate(b, (0, player_login_1.bindPlayerLogin)(b.proof, b.username, b.password, b.remember === true)));
        route("/player-auth/reset-password", b => (0, player_login_1.resetPlayerLoginPassword)(b.code, b.password));
        // The existing management-auth onRequest hook protects /api/server and /admin.
        route("/api/server/account/player-login-code", b => (0, player_login_1.createPlayerLoginCode)(b.viewer_id, b.purpose), true);
        app.get("/admin/player-login", (_req, reply) => __awaiter(this, void 0, void 0, function* () {
            return reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>玩家账号管理</title>
<style>body{font:16px system-ui;background:#edf6f3;color:#243d3b;padding:36px}main{max-width:440px;margin:auto;background:white;border-radius:22px;padding:28px}input,select,button{box-sizing:border-box;width:100%;font:inherit;padding:13px;margin:8px 0 18px;border:1px solid #d4e5df;border-radius:10px}button{background:#21b6aa;color:white;cursor:pointer}pre{white-space:pre-wrap;word-break:break-all}a{color:#168a81}</style>
<main><a href="/admin/">返回管理面板</a><h1>玩家账号管理</h1><p>核实玩家归属后，为指定存档生成一次性验证码。有效期 15 分钟，新码会替换旧码。</p>
<label>玩家 UID<input id="uid" inputmode="numeric"></label><label>用途<select id="purpose"><option value="bind">绑定已有存档</option><option value="reset">重置登录密码</option></select></label><button id="make">生成验证码</button><pre id="result" aria-live="polite"></pre></main>
<script>document.querySelector('#make').onclick=async()=>{const b=document.querySelector('#make'),r=document.querySelector('#result');b.disabled=true;r.textContent='正在生成…';try{const x=await fetch('/api/server/account/player-login-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({viewer_id:document.querySelector('#uid').value,purpose:document.querySelector('#purpose').value})});if(!x.ok)throw Error();const j=await x.json();r.textContent=j.ok?j.data.profile.name+' / UID '+j.data.profile.viewer_id+'\\n\\n验证码：'+j.data.code+'\\n\\n到期：'+new Date(j.data.expires_at).toLocaleString():j.message}catch(e){r.textContent='请求失败，请检查管理登录状态。'}finally{b.disabled=false}}</script></html>`);
        }));
    });
}
exports.default = playerLoginRoutes;
