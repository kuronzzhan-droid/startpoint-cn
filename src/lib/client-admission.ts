import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { generateDataHeaders } from "../utils"
import { requestRoutePath } from "./request-route-path"

const ID = /^[a-zA-Z0-9_-]{1,80}$/
const HEX = /^[a-f0-9]{64}$/
const MAX_ENTRIES = 10000, TTL = 30 * 60 * 1000, RENEW_GRACE = 5 * 60 * 1000
type Platform = "android" | "ios"
type Recovery = "update" | "handshake" | "renew" | "login" | "retry"
interface Build { id: string; name: string; platform: Platform; enabled: boolean; until: number; key: string; keyHash: string; capabilities: ReadonlySet<string>; weaponRivenCatalog: string }
export interface WeaponRivenAdmission { p1: boolean; p2: boolean; catalog: string }
export interface SocketAdmissionLease { ok: boolean; remainingMs: number; weaponRiven?: WeaponRivenAdmission }
interface Policy { enforce: boolean; updateMessage: string; builds: Map<string, Build> }
interface Challenge { build: string; keyHash: string; platform: Platform; nonce: string; expires: number; ip: string }
interface Grant { build: string; platform: Platform; keyHash: string; expires: number; session: string }
export type AdmissionResult = { ok: true } | { ok: false; code: string; message: string; action: Recovery; retry_after_ms?: number }
const digest = (text: string) => createHash("sha256").update(text).digest("hex")
const scalar = (v: unknown): string => typeof v === "string" && v.length <= 256 ? v : ""
export function proofMessage(build: string, challenge: string, nonce: string): string {
    return `SP-ADMISSION-1\n${build}\n${challenge}\n${nonce}`
}

/** No player persistence. Credentials are process-local and never enter save exports. */
export class ClientAdmission {
    private policy?: Policy
    private fingerprint = ""
    private timer?: NodeJS.Timeout
    private lastError = ""
    private challenges = new Map<string, Challenge>()
    private grants = new Map<string, Grant>()
    private limits = new Map<string, { n: number; expires: number }>()
    constructor(readonly configPath: string, readonly keysPath: string,
        private now = Date.now, private warn: (message: string) => void = console.warn) {}

    reload(): boolean {
        try {
            const configText = readFileSync(this.configPath, "utf8").replace(/^\uFEFF/, "")
            if (Buffer.byteLength(configText) > 256 * 1024) throw Error("configuration too large")
            const c = JSON.parse(configText)
            if (typeof c.enforce !== "boolean" || !Array.isArray(c.builds) || c.builds.length > 256
                || typeof c.updateMessage !== "string" || !c.updateMessage.trim() || c.updateMessage.length > 500
                || Object.keys(c).some(k => !["enforce", "builds", "updateMessage"].includes(k))) throw Error("invalid configuration")
            // An empty transition policy does not need a key file. Any listed build must have its key.
            const keyText = c.builds.length ? readFileSync(this.keysPath, "utf8").replace(/^\uFEFF/, "") : "{}"
            if (Buffer.byteLength(keyText) > 256 * 1024) throw Error("key file too large")
            const fingerprint = digest(configText + "\n" + keyText)
            if (fingerprint === this.fingerprint) { this.lastError = ""; return true }
            const keys = JSON.parse(keyText), builds = new Map<string, Build>()
            for (const b of c.builds) {
                if (!b || !ID.test(b.id) || typeof b.id !== "string" || builds.has(b.id)
                    || typeof b.name !== "string" || b.name.length > 100 || typeof b.enabled !== "boolean"
                    || (b.platform !== undefined && b.platform !== "android" && b.platform !== "ios")
                    || (b.capabilities !== undefined && (!Array.isArray(b.capabilities) || b.capabilities.length > 64
                        || b.capabilities.some((value: unknown) => typeof value !== "string" || !ID.test(value))))
                    || (b.weaponRivenCatalog !== undefined && (typeof b.weaponRivenCatalog !== "string" || !/^[a-zA-Z0-9_-]{1,96}$/.test(b.weaponRivenCatalog)))
                    || Object.keys(b).some(k => !["id", "name", "platform", "enabled", "allowUntil", "capabilities", "weaponRivenCatalog"].includes(k))) throw Error("invalid build")
                let until = Infinity
                if (b.allowUntil !== null) {
                    if (typeof b.allowUntil !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)$/.test(b.allowUntil)) throw Error("invalid expiry")
                    until = Date.parse(b.allowUntil)
                    if (!Number.isFinite(until)) throw Error("invalid expiry")
                }
                if (typeof keys[b.id] !== "string" || !HEX.test(keys[b.id])) throw Error("missing build key")
                builds.set(b.id, { id: b.id, name: b.name, platform: b.platform ?? "android", enabled: b.enabled, until, key: keys[b.id], keyHash: digest(keys[b.id]), capabilities: new Set(b.capabilities ?? []), weaponRivenCatalog: b.weaponRivenCatalog ?? "none" })
            }
            this.policy = { enforce: c.enforce, updateMessage: c.updateMessage, builds }
            this.fingerprint = fingerprint; this.lastError = ""
            // Revocation survives a later re-enable: old tickets require a fresh handshake.
            for (const [token, grant] of this.grants) if (!this.allowed(grant)) this.grants.delete(token)
            for (const [id, challenge] of this.challenges) if (!this.allowed(challenge)) this.challenges.delete(id)
            this.sweep()
            return true
        } catch {
            // Never include file contents, parser excerpts, proofs or keys in logs.
            if (!this.lastError) this.warn("[client-admission] 配置读取失败；保留上一份有效配置。无有效配置时拒绝游戏接入。")
            this.lastError = "invalid"; return false
        }
    }
    start(): void {
        this.reload()
        if (!this.timer) { this.timer = setInterval(() => { this.reload(); this.sweep() }, 2000); this.timer.unref() }
    }
    close(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined }
    private fail(code = "CLIENT_NOT_ALLOWED", action: Recovery = "update"): AdmissionResult & { ok: false } {
        if (code === "RATE_LIMITED") return { ok: false, code, action: "retry", retry_after_ms: 60000, message: "校验请求较多，请稍后重试。" }
        const message = !this.policy ? "客户端准入配置暂时不可用，请联系管理员。"
            : action === "handshake" || action === "renew" ? "客户端校验状态已过期，正在等待重新连接。"
            : action === "login" ? "登录状态不匹配，请重新登录。" : this.policy.updateMessage
        return { ok: false, code, message, action: this.policy ? action : "retry" }
    }
    private build(id: string): Build | undefined {
        const b = this.policy?.builds.get(id)
        return b?.enabled && b.until > this.now() ? b : undefined
    }
    private allowed(g: Pick<Grant, "build" | "keyHash" | "platform">): boolean {
        const b = this.build(g.build)
        return !!b && b.keyHash === g.keyHash && b.platform === g.platform
    }
    private current(g: Grant): boolean {
        return g.expires > this.now() && this.allowed(g)
    }
    private sweep(): void {
        const now = this.now()
        for (const [id, c] of this.challenges) if (c.expires <= now) this.challenges.delete(id)
        // Grace permits only authenticated renewal, never gameplay with an expired ticket.
        for (const [id, g] of this.grants) if (g.expires + (g.session ? RENEW_GRACE : 0) <= now) this.grants.delete(id)
        for (const [id, l] of this.limits) if (l.expires <= now) this.limits.delete(id)
    }
    private limited(ip: string): boolean {
        const now = this.now(), old = this.limits.get(ip)
        if (old && old.expires > now) return ++old.n > 120
        this.sweep()
        if (this.limits.size >= 4096) return true
        this.limits.set(ip, { n: 1, expires: now + 60000 }); return false
    }
    challenge(body: any, ip: string): object {
        if (this.limited(ip)) return this.fail("RATE_LIMITED")
        const build = scalar(body?.build), b = this.build(build)
        if (!b || body?.protocol !== 1 || (body?.platform !== undefined && body.platform !== b.platform)) return this.fail()
        if (this.challenges.size >= MAX_ENTRIES) return this.fail("RATE_LIMITED")
        const id = randomBytes(24).toString("hex"), nonce = randomBytes(32).toString("hex")
        this.challenges.set(id, { build, keyHash: b.keyHash, platform: b.platform, nonce, expires: this.now() + 60000, ip })
        return { ok: true, data: { challenge: id, nonce, expires_at: this.now() + 60000, server_time: this.now(), expires_in_ms: 60000, platform: b.platform } }
    }
    prove(body: any, ip: string): object {
        if (this.limited(ip)) return this.fail("RATE_LIMITED")
        const id = scalar(body?.challenge), c = this.challenges.get(id)
        this.challenges.delete(id) // One attempt, including a wrong proof.
        const b = c && this.build(c.build), proof = scalar(body?.proof)
        if (!c || !b || !this.allowed(c) || c.ip !== ip || c.expires <= this.now() || !HEX.test(proof)) return this.fail()
        const expected = createHmac("sha256", Buffer.from(b.key, "hex")).update(proofMessage(b.id, id, c.nonce)).digest()
        if (!timingSafeEqual(expected, Buffer.from(proof, "hex"))) return this.fail()
        if (this.grants.size >= MAX_ENTRIES) return this.fail("RATE_LIMITED")
        const token = randomBytes(32).toString("hex"), expires = this.now() + TTL
        const grant: Grant = { build: b.id, platform: b.platform, keyHash: b.keyHash, expires, session: "" }
        this.grants.set(token, grant)
        return this.issued(token, grant)
    }
    private issued(token: string, grant: Grant): object {
        const expiresIn = Math.max(0, grant.expires - this.now())
        return { ok: true, data: { token, expires_at: grant.expires, server_time: this.now(), expires_in_ms: expiresIn,
            renew_after_ms: Math.max(0, expiresIn - 5 * 60000), renew_grace_ms: RENEW_GRACE, platform: grant.platform } }
    }
    check(token: unknown, session?: unknown, requireBinding = false): AdmissionResult {
        if (!this.policy) return this.fail("CLIENT_CONFIG_UNAVAILABLE")
        // Compatibility is an explicit global transition, never a platform-header bypass.
        if (!token && !this.policy.enforce) return { ok: true }
        const g = this.grants.get(scalar(token))
        if (!g) return this.fail("CLIENT_ADMISSION_REQUIRED", token ? "handshake" : "update")
        if (!this.allowed(g)) return this.fail()
        if (requireBinding && (!g.session || g.session !== digest(scalar(session)))) return this.fail("CLIENT_SESSION_MISMATCH", "login")
        if (session && g.session !== digest(scalar(session))) return this.fail("CLIENT_SESSION_MISMATCH", "login")
        if (g.expires <= this.now()) return this.fail("CLIENT_ADMISSION_REQUIRED", "renew")
        return { ok: true }
    }
    /** Valid, account-bound HTTP/TCP activity keeps the same ticket alive without an extra request. */
    checkActivity(token: unknown, session: unknown): AdmissionResult {
        const result = this.check(token, session, true)
        if (result.ok) {
            const g = this.grants.get(scalar(token))
            if (g) g.expires = this.now() + TTL
        }
        return result
    }
    /** Capabilities come from an authenticated build, never an HTTP declaration or legacy bypass. */
    hasCapability(token: unknown, session: unknown, capability: string): boolean {
        const grant = this.grants.get(scalar(token))
        return !!grant && this.check(token, session, true).ok
            && this.build(grant.build)?.capabilities.has(capability) === true
    }
    /** Serializable, short socket capability. Grant storage and keys stay in the business process. */
    socketLease(token: unknown, session: unknown, active: boolean): SocketAdmissionLease {
        const result = active ? this.checkActivity(token, session) : this.check(token, session, true)
        if (!result.ok) return { ok: false, remainingMs: 0 }
        const g = this.grants.get(scalar(token))
        const b = g && this.build(g.build)
        return { ok: true, remainingMs: Math.max(0, Math.min(60_000, g ? g.expires - this.now() : 60_000)),
            weaponRiven: { p1: !!b?.capabilities.has("weapon-riven-v1"), p2: !!b?.capabilities.has("weapon-riven-multi-v1"),
                catalog: b?.weaponRivenCatalog ?? "none" } }
    }
    bind(token: unknown, session: string): void {
        const g = this.grants.get(scalar(token))
        if (g && this.current(g)) g.session = digest(session)
    }
    renew(token: unknown, session: unknown, ip: string): object {
        if (this.limited(ip)) return this.fail("RATE_LIMITED")
        const g = this.grants.get(scalar(token))
        if (!g) return this.fail("CLIENT_ADMISSION_REQUIRED", "handshake")
        if (!this.allowed(g)) return this.fail()
        if (g.session && g.session !== digest(scalar(session))) return this.fail("CLIENT_SESSION_MISMATCH", "login")
        if (g.expires + (g.session ? RENEW_GRACE : 0) <= this.now()) return this.fail("CLIENT_ADMISSION_REQUIRED", "handshake")
        g.expires = this.now() + TTL
        return this.issued(scalar(token), g)
    }
}

let instance: ClientAdmission | undefined
export function clientAdmission(): ClientAdmission {
    if (!instance) {
        instance = new ClientAdmission(resolve(process.env.CLIENT_ADMISSION_CONFIG || "config/client-admission.json"),
            resolve(process.env.CLIENT_ADMISSION_KEYS || "config/client-admission.keys.json"))
        instance.start()
    }
    return instance
}
export function hasWeaponRivenCapability(request: Pick<FastifyRequest, "headers">): boolean {
    return clientAdmission().hasCapability(request.headers["x-sp-admission"], request.headers["x-sp-session"], "weapon-riven-v1")
}
export function installClientAdmission(app: FastifyInstance, gate = clientAdmission()): void {
    app.addHook("onClose", async () => gate.close())
    app.addHook("preHandler", async (request, reply) => {
        const path = requestRoutePath(request)
        const game = path.startsWith("/api/index.php/")
        if (!game && !path.startsWith("/player-auth/")) return
        // Account ownership remains checked by the existing player-login guard.
        const bootstrap = /^\/api\/index\.php\/(asset\/|assetintitle\/)/.test(path) || path === "/api/index.php/tool/auth"
        const result = game && !bootstrap
            ? gate.checkActivity(request.headers["x-sp-admission"], request.headers["x-sp-session"])
            : gate.check(request.headers["x-sp-admission"], game ? request.headers["x-sp-session"] : undefined)
        if (result.ok) return
        reply.header("cache-control", "no-store")
        if (!game) return reply.send(result)
        reply.type("application/x-msgpack")
        return reply.send({ data_headers: { ...generateDataHeaders({ result_code: 516 }), client_admission: result }, data: {} })
    })
    app.addHook("onRoute", options => {
        if (!/^\/player-auth\/(login|register|resume|bind)$/.test(options.url)) return
        const previous = options.preSerialization
        options.preSerialization = [ ...(Array.isArray(previous) ? previous : previous ? [previous] : []),
            async (request, _reply, payload: any) => {
                if (payload?.ok && typeof payload.data?.token === "string") gate.bind(request.headers["x-sp-admission"], payload.data.token)
                return payload
            } ]
    })
    const route = (path: string, fn: (body: any, req: FastifyRequest) => object) => app.post(path, { bodyLimit: 2048 }, async (req, reply) => {
        reply.header("cache-control", "no-store")
        return fn(req.body, req)
    })
    route("/client-admission/challenge", (b, req) => gate.challenge(b, req.ip))
    route("/client-admission/prove", (b, req) => gate.prove(b, req.ip))
    route("/client-admission/renew", (_b, req) => gate.renew(req.headers["x-sp-admission"], req.headers["x-sp-session"], req.ip))
}
