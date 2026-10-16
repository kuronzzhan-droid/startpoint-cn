import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";

const SESSION_COOKIE = "sp_admin_session";
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

interface Session {
    expiresAt: number;
}

interface FailureBucket {
    failures: number;
    resetAt: number;
}

const sessions = new Map<string, Session>();
const failures = new Map<string, FailureBucket>();

const FAILURE_MAP_MAX = 4096;
let nextFailureSweepAt = 0;

function pathOf(request: FastifyRequest): string {
    return (request.raw.url ?? request.url).split("?", 1)[0] || "/";
}

/**
 * Paths the router may resolve this request to. The router decodes and
 * normalises the URL, so the guard must judge the same forms, not only the
 * raw request line. Returns null when the path cannot be decoded.
 */
function routedPathsOf(request: FastifyRequest): string[] | null {
    const raw = pathOf(request);
    let decoded: string;
    try {
        decoded = decodeURIComponent(raw);
    } catch {
        return null;
    }
    const collapsed = decoded.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
    const candidates = [raw, collapsed, path.posix.normalize(collapsed), collapsed.split(";", 1)[0] || "/"];
    const routeUrl = request.routeOptions?.url;
    if (routeUrl) candidates.push(routeUrl);
    return candidates;
}

function cookies(request: FastifyRequest): Record<string, string> {
    const raw = request.headers.cookie ?? "";
    return Object.fromEntries(raw.split(";").map(part => {
        const separator = part.indexOf("=");
        if (separator < 0) return ["", ""];
        const value = part.slice(separator + 1).trim();
        try {
            return [part.slice(0, separator).trim(), decodeURIComponent(value)];
        } catch {
            return [part.slice(0, separator).trim(), value];
        }
    }).filter(([key]) => key !== ""));
}

function clientIp(request: FastifyRequest): string {
    // Fastify resolves forwarded addresses only for configured trusted proxies.
    return request.ip;
}

function isManagementPath(pathname: string): boolean {
    return pathname === "/"
        || pathname === "/player"
        || pathname.startsWith("/player/")
        || pathname === "/mail"
        || pathname.startsWith("/mail/")
        || pathname === "/seeds"
        || pathname.startsWith("/seeds/")
        || pathname === "/admin"
        || pathname.startsWith("/admin/")
        || ["/api/server", "/api/player", "/api/mail", "/api/lookup", "/api/seeds", "/api/news", "/api/mod-admin"]
            .some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function hasSession(request: FastifyRequest): boolean {
    const token = cookies(request)[SESSION_COOKIE];
    if (!token) return false;
    const session = sessions.get(token);
    if (!session) return false;
    if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return false;
    }
    return true;
}

function setSessionCookie(reply: FastifyReply, token: string, ttlMs: number): void {
    const secure = process.env.ADMIN_COOKIE_SECURE === "true" ? "; Secure" : "";
    reply.header(
        "set-cookie",
        `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ttlMs / 1000)}${secure}`,
    );
}

function clearSessionCookie(reply: FastifyReply): void {
    reply.header("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function loginPage(error = ""): string {
    const message = error ? `<p class="error">${error}</p>` : "";
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>管理面板登录</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101827;color:#eef2ff;font:16px system-ui}.card{width:min(360px,calc(100vw - 32px));padding:28px;border-radius:12px;background:#1f2937;box-sizing:border-box}h1{margin-top:0;font-size:22px}input,button{box-sizing:border-box;width:100%;padding:11px;border-radius:7px;font-size:16px}input{border:1px solid #64748b;margin:10px 0 14px}button{border:0;background:#38bdf8;color:#082f49;font-weight:700;cursor:pointer}.error{color:#fca5a5}</style></head><body><main class="card"><h1>管理面板登录</h1>${message}<form id="login"><label>管理密码</label><input id="password" type="password" autocomplete="current-password" required autofocus><button>登录</button></form><script>document.querySelector('#login').addEventListener('submit',async e=>{e.preventDefault();const r=await fetch('/admin-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:document.querySelector('#password').value})});if(r.ok)location.replace('/admin/');else location.replace('/admin-login?error=1')})</script></main></body></html>`;
}

function failureAllowed(ip: string): boolean {
    const current = failures.get(ip);
    if (!current) return true;
    if (current.resetAt <= Date.now()) {
        failures.delete(ip);
        return true;
    }
    return current.failures < LOGIN_MAX_FAILURES;
}

function recordFailure(ip: string): void {
    const now = Date.now();
    if (now >= nextFailureSweepAt) {
        for (const [key, bucket] of failures) {
            if (bucket.resetAt <= now) failures.delete(key);
        }
        nextFailureSweepAt = now + LOGIN_WINDOW_MS;
    }
    const current = failures.get(ip);
    if (!current || current.resetAt <= now) {
        if (!current && failures.size >= FAILURE_MAP_MAX) {
            // Drop the oldest bucket instead of growing without bound.
            const oldest = failures.keys().next().value;
            if (oldest !== undefined) failures.delete(oldest);
        }
        failures.set(ip, { failures: 1, resetAt: now + LOGIN_WINDOW_MS });
        return;
    }
    current.failures += 1;
}

function passwordsEqual(left: string, right: string): boolean {
    const supplied = Buffer.from(left, "utf8");
    const configured = Buffer.from(right, "utf8");
    return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}

export function installManagementAuth(fastify: { addHook: Function, get: Function, post: Function }): void {
    const passwordText = process.env.ADMIN_PANEL_PASSWORD;
    const ttlHours = Math.max(1, Math.min(168, Number(process.env.ADMIN_SESSION_TTL_HOURS ?? "12") || 12));
    const ttlMs = ttlHours * 60 * 60 * 1000;

    fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
        const pathname = pathOf(request);
        const routedPaths = routedPathsOf(request);
        if (routedPaths === null) return reply.status(400).send({ error: "bad request" });
        if (!routedPaths.some(isManagementPath)) return;
        if (hasSession(request)) {
            if (request.method === "GET" && pathname === "/") return reply.redirect("/admin/");
            return;
        }
        if (routedPaths.some(candidate => candidate.startsWith("/api/"))) return reply.status(401).send({ error: "unauthorized" });
        return reply.redirect("/admin-login");
    });

    fastify.get("/admin-login", async (request: FastifyRequest, reply: FastifyReply) => {
        if (hasSession(request)) return reply.redirect("/admin/");
        const showError = (request.query as { error?: string }).error === "1";
        return reply.type("text/html; charset=utf-8").send(loginPage(showError ? "密码错误或尝试次数过多。" : ""));
    });

    fastify.post("/admin-login", async (request: FastifyRequest, reply: FastifyReply) => {
        const ip = clientIp(request);
        const password = (request.body as { password?: unknown } | undefined)?.password;
        if (!passwordText || typeof password !== "string" || !failureAllowed(ip)) {
            recordFailure(ip);
            return reply.status(401).send({ error: "unauthorized" });
        }
        if (!passwordsEqual(password, passwordText)) {
            recordFailure(ip);
            return reply.status(401).send({ error: "unauthorized" });
        }
        failures.delete(ip);
        const token = randomBytes(32).toString("base64url");
        sessions.set(token, { expiresAt: Date.now() + ttlMs });
        setSessionCookie(reply, token, ttlMs);
        return reply.send({ ok: true });
    });

    fastify.post("/admin-logout", async (request: FastifyRequest, reply: FastifyReply) => {
        const token = cookies(request)[SESSION_COOKIE];
        if (token) sessions.delete(token);
        clearSessionCookie(reply);
        return reply.send({ ok: true });
    });
}
