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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.installManagementAuth = void 0;
const node_crypto_1 = require("node:crypto");
const node_path_1 = __importDefault(require("node:path"));
const request_route_path_1 = require("./request-route-path");
const SESSION_COOKIE = "sp_admin_session";
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const sessions = new Map();
const failures = new Map();
const FAILURE_MAP_MAX = 4096;
let nextFailureSweepAt = 0;
function pathOf(request) {
    var _a;
    return ((_a = request.raw.url) !== null && _a !== void 0 ? _a : request.url).split("?", 1)[0] || "/";
}
/**
 * Paths the router may resolve this request to. The router decodes and
 * normalises the URL, so the guard must judge the same forms, not only the
 * raw request line. Returns null when the path cannot be decoded.
 */
function routedPathsOf(request) {
    const raw = pathOf(request);
    let decoded;
    try {
        decoded = decodeURIComponent(raw);
    }
    catch (_a) {
        return null;
    }
    const collapsed = decoded.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
    const candidates = [raw, collapsed, node_path_1.default.posix.normalize(collapsed), collapsed.split(";", 1)[0] || "/"];
    const routeUrl = (0, request_route_path_1.requestRoutePath)(request);
    if (routeUrl)
        candidates.push(routeUrl);
    return candidates;
}
function cookies(request) {
    var _a;
    const raw = (_a = request.headers.cookie) !== null && _a !== void 0 ? _a : "";
    return Object.fromEntries(raw.split(";").map(part => {
        const separator = part.indexOf("=");
        if (separator < 0)
            return ["", ""];
        const value = part.slice(separator + 1).trim();
        try {
            return [part.slice(0, separator).trim(), decodeURIComponent(value)];
        }
        catch (_a) {
            return [part.slice(0, separator).trim(), value];
        }
    }).filter(([key]) => key !== ""));
}
function clientIp(request) {
    // Fastify resolves forwarded addresses only for configured trusted proxies.
    return request.ip;
}
function isManagementPath(pathname) {
    return pathname === "/"
        || pathname === "/player"
        || pathname.startsWith("/player/")
        || pathname === "/mail"
        || pathname.startsWith("/mail/")
        || pathname === "/seeds"
        || pathname.startsWith("/seeds/")
        || pathname === "/admin"
        || pathname.startsWith("/admin/")
        || ["/api/server", "/api/player", "/api/mail", "/api/lookup", "/api/seeds", "/api/news", "/api/mod-admin", "/api/leaderboards"]
            .some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
function hasSession(request) {
    const token = cookies(request)[SESSION_COOKIE];
    if (!token)
        return false;
    const session = sessions.get(token);
    if (!session)
        return false;
    if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return false;
    }
    return true;
}
function setSessionCookie(reply, token, ttlMs) {
    const secure = process.env.ADMIN_COOKIE_SECURE === "true" ? "; Secure" : "";
    reply.header("set-cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ttlMs / 1000)}${secure}`);
}
function clearSessionCookie(reply) {
    reply.header("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}
function loginPage(error = "") {
    const message = error ? `<p class="error">${error}</p>` : "";
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>管理面板登录</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101827;color:#eef2ff;font:16px system-ui}.card{width:min(360px,calc(100vw - 32px));padding:28px;border-radius:12px;background:#1f2937;box-sizing:border-box}h1{margin-top:0;font-size:22px}input,button{box-sizing:border-box;width:100%;padding:11px;border-radius:7px;font-size:16px}input{border:1px solid #64748b;margin:10px 0 14px}button{border:0;background:#38bdf8;color:#082f49;font-weight:700;cursor:pointer}.error{color:#fca5a5}</style></head><body><main class="card"><h1>管理面板登录</h1>${message}<form id="login"><label>管理密码</label><input id="password" type="password" autocomplete="current-password" required autofocus><button>登录</button></form><script>document.querySelector('#login').addEventListener('submit',async e=>{e.preventDefault();const r=await fetch('/admin-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:document.querySelector('#password').value})});if(r.ok)location.replace('/admin/');else location.replace('/admin-login?error=1')})</script></main></body></html>`;
}
function failureAllowed(ip) {
    const current = failures.get(ip);
    if (!current)
        return true;
    if (current.resetAt <= Date.now()) {
        failures.delete(ip);
        return true;
    }
    return current.failures < LOGIN_MAX_FAILURES;
}
function recordFailure(ip) {
    const now = Date.now();
    if (now >= nextFailureSweepAt) {
        for (const [key, bucket] of failures) {
            if (bucket.resetAt <= now)
                failures.delete(key);
        }
        nextFailureSweepAt = now + LOGIN_WINDOW_MS;
    }
    const current = failures.get(ip);
    if (!current || current.resetAt <= now) {
        if (!current && failures.size >= FAILURE_MAP_MAX) {
            // Drop the oldest bucket instead of growing without bound.
            const oldest = failures.keys().next().value;
            if (oldest !== undefined)
                failures.delete(oldest);
        }
        failures.set(ip, { failures: 1, resetAt: now + LOGIN_WINDOW_MS });
        return;
    }
    current.failures += 1;
}
function passwordsEqual(left, right) {
    const supplied = Buffer.from(left, "utf8");
    const configured = Buffer.from(right, "utf8");
    return supplied.length === configured.length && (0, node_crypto_1.timingSafeEqual)(supplied, configured);
}
function installManagementAuth(fastify) {
    var _a;
    const passwordText = process.env.ADMIN_PANEL_PASSWORD;
    const ttlHours = Math.max(1, Math.min(168, Number((_a = process.env.ADMIN_SESSION_TTL_HOURS) !== null && _a !== void 0 ? _a : "12") || 12));
    const ttlMs = ttlHours * 60 * 60 * 1000;
    fastify.addHook("onRequest", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        const pathname = pathOf(request);
        const routedPaths = routedPathsOf(request);
        if (routedPaths === null)
            return reply.status(400).send({ error: "bad request" });
        if (!routedPaths.some(isManagementPath))
            return;
        if (hasSession(request)) {
            if (request.method === "GET" && pathname === "/")
                return reply.redirect("/admin/");
            return;
        }
        if (routedPaths.some(candidate => candidate.startsWith("/api/")))
            return reply.status(401).send({ error: "unauthorized" });
        return reply.redirect("/admin-login");
    }));
    fastify.get("/admin-login", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        if (hasSession(request))
            return reply.redirect("/admin/");
        const showError = request.query.error === "1";
        return reply.type("text/html; charset=utf-8").send(loginPage(showError ? "密码错误或尝试次数过多。" : ""));
    }));
    fastify.post("/admin-login", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        var _b;
        const ip = clientIp(request);
        const password = (_b = request.body) === null || _b === void 0 ? void 0 : _b.password;
        if (!passwordText || typeof password !== "string" || !failureAllowed(ip)) {
            recordFailure(ip);
            return reply.status(401).send({ error: "unauthorized" });
        }
        if (!passwordsEqual(password, passwordText)) {
            recordFailure(ip);
            return reply.status(401).send({ error: "unauthorized" });
        }
        failures.delete(ip);
        const token = (0, node_crypto_1.randomBytes)(32).toString("base64url");
        sessions.set(token, { expiresAt: Date.now() + ttlMs });
        setSessionCookie(reply, token, ttlMs);
        return reply.send({ ok: true });
    }));
    fastify.post("/admin-logout", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        const token = cookies(request)[SESSION_COOKIE];
        if (token)
            sessions.delete(token);
        clearSessionCookie(reply);
        return reply.send({ ok: true });
    }));
}
exports.installManagementAuth = installManagementAuth;
