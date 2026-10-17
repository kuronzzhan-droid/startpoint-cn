import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { createPlayerLoginRateLimiter } from "../../lib/player-login-rate-limit"
import { accountCreationBudget } from "../../lib/account-creation-budget"
import { requestRoutePath } from "../../lib/request-route-path"
import { isPersistenceAdmissionError } from "../../lib/persistence-admission"
import { getDb } from "../../data/db"
import { generateDataHeaders } from "../../utils"
import { bindPlayerLogin, createPlayerLoginCode, loginPlayerAsync, logoutPlayer,
    PlayerLoginError, previewPlayerClaim, readPlayerLoginSession,
    registerPlayerLogin, resetPlayerLoginPassword, resumePlayerLogin, readPlayerLoginAccess,
    rememberVerifiedPlayerLogin, finishPlayerLoginSwitch, previewLocalPlayerClaim,
    readPlayerLoginDeviceAccess, readPlayerLoginViewerAccess } from "../../lib/player-login"

export function installPlayerLoginGuard(app: FastifyInstance): void {
    app.addHook("preHandler", async (request, reply) => {
        const path = requestRoutePath(request)
        if (!path.startsWith("/api/index.php/")) return
        const body = (request.body && typeof request.body === "object" ? request.body : {}) as Record<string, unknown>
        const supplied = request.headers["x-sp-session"]
        const viewer = body.viewer_id || body.keychain
        const session = readPlayerLoginAccess(supplied, viewer)
        let denied = Boolean(supplied && !session)
        const viewerAccess = session ? null : readPlayerLoginViewerAccess(viewer)
        const accountId = session ? session.request_account_id : viewerAccess?.accountId ?? null
        if (session && viewer && Number(viewer) !== 0 && accountId !== session.account_id) denied = true
        if (!session && viewerAccess?.managed) denied = true
        // Bound saves are recovered via player login; legacy transfer must never delete a signed-up account.
        if (path.includes("/take_over")) {
            const legacyTarget = readPlayerLoginViewerAccess(body.input_viewer_id)
            if (session || viewerAccess?.managed || legacyTarget?.managed) denied = true
        }
        if (path.endsWith("/tool/signup") && !session) {
            if (readPlayerLoginDeviceAccess(body.device_id)?.managed) denied = true
        }
        if (!denied) {
            if (session) rememberVerifiedPlayerLogin(request, session)
            return
        }
        reply.type("application/x-msgpack")
        return reply.send({ data_headers: generateDataHeaders({ viewer_id: Number(viewer) || 0, result_code: 516 }), data: {} })
    })
}

export default async function playerLoginRoutes(app: FastifyInstance): Promise<void> {
    const limited = createPlayerLoginRateLimiter()
    const creation = accountCreationBudget(app)
    function route(path: string, handler: (body: Record<string, unknown>, req: FastifyRequest, reply: FastifyReply) => unknown, admin = false) {
        app.post(path, { bodyLimit: 4096 }, async (request: FastifyRequest, reply: FastifyReply) => {
            reply.header("cache-control", "no-store")
            const input = request.body
            const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {}
            const restoring = path.endsWith("/resume") || path.endsWith("/logout")
            // New-account admission has its own source/global budget; attempts
            // to register must not consume existing players' login/bind quotas.
            if (!admin && path !== "/player-auth/register" && limited(request.ip, path, body, restoring ? readPlayerLoginSession(body.token)?.account_id ?? null : null)) return { ok: false, code: "RATE_LIMITED", message: "操作较频繁，请稍后再试。" }
            try {
                const body = request.body
                if (!body || typeof body !== "object" || Array.isArray(body)) throw new PlayerLoginError("请求内容无效。")
                return { ok: true, data: await handler(body as Record<string, unknown>, request, reply) }
            } catch (error) {
                if (isPersistenceAdmissionError(error) || (error instanceof PlayerLoginError && error.code === "SERVER_BUSY")) {
                    reply.header("retry-after", "1")
                    return { ok: false, code: "SERVER_BUSY", message: "服务器写入繁忙，请稍后重试。" }
                }
                // Never serialize request bodies, passwords, proofs, session tokens or raw database errors.
                return { ok: false, code: error instanceof PlayerLoginError ? error.code : "SERVER_ERROR", message: error instanceof PlayerLoginError ? error.message : "暂时无法完成，请稍后重试。" }
            }
        })
    }
    function activate(b: Record<string, unknown>, next: ReturnType<typeof resumePlayerLogin>) {
        finishPlayerLoginSwitch(b.previous_token, next)
        return next
    }
    route("/player-auth/register", (b, request) => {
        const reservation = creation.reserve(request.ip)
        if (!reservation) throw new PlayerLoginError("新建账号较频繁，请稍后再试。", "RATE_LIMITED")
        const username = typeof b.username === "string" && /^[A-Za-z0-9_]{4,24}$/.test(b.username)
            ? b.username.toLowerCase() : null
        let originalId: number | undefined
        const accountId = () => username === null ? undefined : (getDb().prepare(
            "SELECT id FROM accounts WHERE lower(username)=? AND username IS NOT NULL AND username<>''")
            .get(username) as { id: number } | undefined)?.id
        try {
            originalId = accountId()
            const registered = registerPlayerLogin(b.username, b.password, b.remember === true)
            reservation.commit()
            return activate(b, registered)
        } catch (error) {
            // The library commits before preference writes/transport callbacks.
            // A post-commit failure must still consume the creation quota.
            try {
                const currentId = accountId()
                if (currentId !== undefined && currentId !== originalId) reservation.commit()
                else reservation.release()
            } catch { reservation.commit() } // Unknown durable outcome: fail closed.
            throw error
        }
    })
    route("/player-auth/login", async (b, request, reply) => {
        const cancellation = new AbortController()
        const abort = () => cancellation.abort()
        const close = () => { if (!reply.raw.writableEnded) abort() }
        request.raw.once("aborted", abort)
        reply.raw.once("close", close)
        if (request.raw.aborted || reply.raw.destroyed) abort()
        try {
            return await loginPlayerAsync(b.username, b.password, b.remember === true, {
                previousToken: b.previous_token, signal: cancellation.signal,
            })
        } finally {
            request.raw.removeListener("aborted", abort)
            reply.raw.removeListener("close", close)
        }
    })
    route("/player-auth/resume", b => activate(b, resumePlayerLogin(b.token)))
    route("/player-auth/logout", b => { logoutPlayer(b.token); return {} })
    route("/player-auth/claim-preview", b => previewPlayerClaim(b))
    route("/player-auth/local-claim-preview", b => previewLocalPlayerClaim(b))
    route("/player-auth/bind", b => activate(b, bindPlayerLogin(b.proof, b.username, b.password, b.remember === true)))
    route("/player-auth/reset-password", b => resetPlayerLoginPassword(b.code, b.password))
    // The existing management-auth onRequest hook protects /api/server and /admin.
    route("/api/server/account/player-login-code", b => createPlayerLoginCode(b.viewer_id, b.purpose), true)
    app.get("/admin/player-login", async (_req, reply) => reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>玩家账号管理</title>
<style>body{font:16px system-ui;background:#edf6f3;color:#243d3b;padding:36px}main{max-width:440px;margin:auto;background:white;border-radius:22px;padding:28px}input,select,button{box-sizing:border-box;width:100%;font:inherit;padding:13px;margin:8px 0 18px;border:1px solid #d4e5df;border-radius:10px}button{background:#21b6aa;color:white;cursor:pointer}pre{white-space:pre-wrap;word-break:break-all}a{color:#168a81}</style>
<main><a href="/admin/">返回管理面板</a><h1>玩家账号管理</h1><p>核实玩家归属后，为指定存档生成一次性验证码。有效期 15 分钟，新码会替换旧码。</p>
<label>玩家 UID<input id="uid" inputmode="numeric"></label><label>用途<select id="purpose"><option value="bind">绑定已有存档</option><option value="reset">重置登录密码</option></select></label><button id="make">生成验证码</button><pre id="result" aria-live="polite"></pre></main>
<script>document.querySelector('#make').onclick=async()=>{const b=document.querySelector('#make'),r=document.querySelector('#result');b.disabled=true;r.textContent='正在生成…';try{const x=await fetch('/api/server/account/player-login-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({viewer_id:document.querySelector('#uid').value,purpose:document.querySelector('#purpose').value})});if(!x.ok)throw Error();const j=await x.json();r.textContent=j.ok?j.data.profile.name+' / UID '+j.data.profile.viewer_id+'\\n\\n验证码：'+j.data.code+'\\n\\n到期：'+new Date(j.data.expires_at).toLocaleString():j.message}catch(e){r.textContent='请求失败，请检查管理登录状态。'}finally{b.disabled=false}}</script></html>`))
}
