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
exports.installClientAdmission = exports.getInstalledClientAdmission = exports.hasWeaponRivenCapability = exports.clientAdmission = exports.ClientAdmission = exports.proofMessage = void 0;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const utils_1 = require("../utils");
const request_route_path_1 = require("./request-route-path");
const ID = /^[a-zA-Z0-9_-]{1,80}$/;
const HEX = /^[a-f0-9]{64}$/;
const MAX_ENTRIES = 10000, TTL = 30 * 60 * 1000, RENEW_GRACE = 5 * 60 * 1000;
const digest = (text) => (0, node_crypto_1.createHash)("sha256").update(text).digest("hex");
const scalar = (v) => typeof v === "string" && v.length <= 256 ? v : "";
function proofMessage(build, challenge, nonce) {
    return `SP-ADMISSION-1\n${build}\n${challenge}\n${nonce}`;
}
exports.proofMessage = proofMessage;
/** No player persistence. Credentials are process-local and never enter save exports. */
class ClientAdmission {
    constructor(configPath, keysPath, now = Date.now, warn = console.warn) {
        this.configPath = configPath;
        this.keysPath = keysPath;
        this.now = now;
        this.warn = warn;
        this.fingerprint = "";
        this.lastError = "";
        this.challenges = new Map();
        this.grants = new Map();
        this.limits = new Map();
    }
    reload() {
        var _a, _c, _d;
        try {
            const configText = (0, node_fs_1.readFileSync)(this.configPath, "utf8").replace(/^\uFEFF/, "");
            if (Buffer.byteLength(configText) > 256 * 1024)
                throw Error("configuration too large");
            const c = JSON.parse(configText);
            if (typeof c.enforce !== "boolean" || !Array.isArray(c.builds) || c.builds.length > 256
                || typeof c.updateMessage !== "string" || !c.updateMessage.trim() || c.updateMessage.length > 500
                || Object.keys(c).some(k => !["enforce", "builds", "updateMessage"].includes(k)))
                throw Error("invalid configuration");
            // An empty transition policy does not need a key file. Any listed build must have its key.
            const keyText = c.builds.length ? (0, node_fs_1.readFileSync)(this.keysPath, "utf8").replace(/^\uFEFF/, "") : "{}";
            if (Buffer.byteLength(keyText) > 256 * 1024)
                throw Error("key file too large");
            const fingerprint = digest(configText + "\n" + keyText);
            if (fingerprint === this.fingerprint) {
                this.lastError = "";
                return true;
            }
            const keys = JSON.parse(keyText), builds = new Map();
            for (const b of c.builds) {
                if (!b || !ID.test(b.id) || typeof b.id !== "string" || builds.has(b.id)
                    || typeof b.name !== "string" || b.name.length > 100 || typeof b.enabled !== "boolean"
                    || (b.platform !== undefined && b.platform !== "android" && b.platform !== "ios")
                    || (b.capabilities !== undefined && (!Array.isArray(b.capabilities) || b.capabilities.length > 64
                        || b.capabilities.some((value) => typeof value !== "string" || !ID.test(value))))
                    || (b.weaponRivenCatalog !== undefined && (typeof b.weaponRivenCatalog !== "string" || !/^[a-zA-Z0-9_-]{1,96}$/.test(b.weaponRivenCatalog)))
                    || Object.keys(b).some(k => !["id", "name", "platform", "enabled", "allowUntil", "capabilities", "weaponRivenCatalog"].includes(k)))
                    throw Error("invalid build");
                let until = Infinity;
                if (b.allowUntil !== null) {
                    if (typeof b.allowUntil !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)$/.test(b.allowUntil))
                        throw Error("invalid expiry");
                    until = Date.parse(b.allowUntil);
                    if (!Number.isFinite(until))
                        throw Error("invalid expiry");
                }
                if (typeof keys[b.id] !== "string" || !HEX.test(keys[b.id]))
                    throw Error("missing build key");
                builds.set(b.id, { id: b.id, name: b.name, platform: (_a = b.platform) !== null && _a !== void 0 ? _a : "android", enabled: b.enabled, until, key: keys[b.id], keyHash: digest(keys[b.id]), capabilities: new Set((_c = b.capabilities) !== null && _c !== void 0 ? _c : []), weaponRivenCatalog: (_d = b.weaponRivenCatalog) !== null && _d !== void 0 ? _d : "none" });
            }
            this.policy = { enforce: c.enforce, updateMessage: c.updateMessage, builds };
            this.fingerprint = fingerprint;
            this.lastError = "";
            // Revocation survives a later re-enable: old tickets require a fresh handshake.
            for (const [token, grant] of this.grants)
                if (!this.allowed(grant))
                    this.grants.delete(token);
            for (const [id, challenge] of this.challenges)
                if (!this.allowed(challenge))
                    this.challenges.delete(id);
            this.sweep();
            return true;
        }
        catch (_e) {
            // Never include file contents, parser excerpts, proofs or keys in logs.
            if (!this.lastError)
                this.warn("[client-admission] 配置读取失败；保留上一份有效配置。无有效配置时拒绝游戏接入。");
            this.lastError = "invalid";
            return false;
        }
    }
    start() {
        this.reload();
        if (!this.timer) {
            this.timer = setInterval(() => { this.reload(); this.sweep(); }, 2000);
            this.timer.unref();
        }
    }
    close() { if (this.timer)
        clearInterval(this.timer); this.timer = undefined; }
    fail(code = "CLIENT_NOT_ALLOWED", action = "update") {
        if (code === "RATE_LIMITED")
            return { ok: false, code, action: "retry", retry_after_ms: 60000, message: "校验请求较多，请稍后重试。" };
        const message = !this.policy ? "客户端准入配置暂时不可用，请联系管理员。"
            : action === "handshake" || action === "renew" ? "客户端校验状态已过期，正在等待重新连接。"
                : action === "login" ? "登录状态不匹配，请重新登录。" : this.policy.updateMessage;
        return { ok: false, code, message, action: this.policy ? action : "retry" };
    }
    build(id) {
        var _a;
        const b = (_a = this.policy) === null || _a === void 0 ? void 0 : _a.builds.get(id);
        return (b === null || b === void 0 ? void 0 : b.enabled) && b.until > this.now() ? b : undefined;
    }
    allowed(g) {
        const b = this.build(g.build);
        return !!b && b.keyHash === g.keyHash && b.platform === g.platform;
    }
    current(g) {
        return g.expires > this.now() && this.allowed(g);
    }
    sweep() {
        const now = this.now();
        for (const [id, c] of this.challenges)
            if (c.expires <= now)
                this.challenges.delete(id);
        // Grace permits only authenticated renewal, never gameplay with an expired ticket.
        for (const [id, g] of this.grants)
            if (g.expires + (g.session ? RENEW_GRACE : 0) <= now)
                this.grants.delete(id);
        for (const [id, l] of this.limits)
            if (l.expires <= now)
                this.limits.delete(id);
    }
    limited(ip) {
        const now = this.now(), old = this.limits.get(ip);
        if (old && old.expires > now)
            return ++old.n > 120;
        this.sweep();
        if (this.limits.size >= 4096)
            return true;
        this.limits.set(ip, { n: 1, expires: now + 60000 });
        return false;
    }
    challenge(body, ip) {
        if (this.limited(ip))
            return this.fail("RATE_LIMITED");
        const build = scalar(body === null || body === void 0 ? void 0 : body.build), b = this.build(build);
        // test-server diagnostics: build id and reason only, never keys or proofs
        console.log(`[ADMISSION-DIAG] challenge build=${build.slice(0, 80)} known=${!!b} protocol=${body === null || body === void 0 ? void 0 : body.protocol} platform=${body === null || body === void 0 ? void 0 : body.platform} ip=${ip}`);
        if (!b || (body === null || body === void 0 ? void 0 : body.protocol) !== 1 || ((body === null || body === void 0 ? void 0 : body.platform) !== undefined && body.platform !== b.platform))
            return this.fail();
        if (this.challenges.size >= MAX_ENTRIES)
            return this.fail("RATE_LIMITED");
        const id = (0, node_crypto_1.randomBytes)(24).toString("hex"), nonce = (0, node_crypto_1.randomBytes)(32).toString("hex");
        this.challenges.set(id, { build, keyHash: b.keyHash, platform: b.platform, nonce, expires: this.now() + 60000, ip });
        return { ok: true, data: { challenge: id, nonce, expires_at: this.now() + 60000, server_time: this.now(), expires_in_ms: 60000, platform: b.platform } };
    }
    prove(body, ip) {
        if (this.limited(ip))
            return this.fail("RATE_LIMITED");
        const id = scalar(body === null || body === void 0 ? void 0 : body.challenge), c = this.challenges.get(id);
        this.challenges.delete(id); // One attempt, including a wrong proof.
        const b = c && this.build(c.build), proof = scalar(body === null || body === void 0 ? void 0 : body.proof);
        if (!c || !b || !this.allowed(c) || c.ip !== ip || c.expires <= this.now() || !HEX.test(proof)) {
            console.log(`[ADMISSION-DIAG] prove reject challenge=${!!c} build=${!!b} sameIp=${c ? c.ip === ip : "-"} ip=${ip} expired=${c ? c.expires <= this.now() : "-"} proofHex=${HEX.test(proof)}`);
            return this.fail();
        }
        const expected = (0, node_crypto_1.createHmac)("sha256", Buffer.from(b.key, "hex")).update(proofMessage(b.id, id, c.nonce)).digest();
        if (!(0, node_crypto_1.timingSafeEqual)(expected, Buffer.from(proof, "hex"))) {
            console.log(`[ADMISSION-DIAG] prove reject hmac-mismatch ip=${ip}`);
            return this.fail();
        }
        console.log(`[ADMISSION-DIAG] prove ok build=${b.id} ip=${ip}`);
        if (this.grants.size >= MAX_ENTRIES)
            return this.fail("RATE_LIMITED");
        const token = (0, node_crypto_1.randomBytes)(32).toString("hex"), expires = this.now() + TTL;
        const grant = { build: b.id, platform: b.platform, keyHash: b.keyHash, expires, session: "" };
        this.grants.set(token, grant);
        return this.issued(token, grant);
    }
    issued(token, grant) {
        const expiresIn = Math.max(0, grant.expires - this.now());
        return { ok: true, data: { token, expires_at: grant.expires, server_time: this.now(), expires_in_ms: expiresIn,
                renew_after_ms: Math.max(0, expiresIn - 5 * 60000), renew_grace_ms: RENEW_GRACE, platform: grant.platform } };
    }
    check(token, session, requireBinding = false) {
        if (!this.policy)
            return this.fail("CLIENT_CONFIG_UNAVAILABLE");
        // Compatibility is an explicit global transition, never a platform-header bypass.
        if (!token && !this.policy.enforce)
            return { ok: true };
        const g = this.grants.get(scalar(token));
        if (!g)
            return this.fail("CLIENT_ADMISSION_REQUIRED", token ? "handshake" : "update");
        if (!this.allowed(g))
            return this.fail();
        if (requireBinding && (!g.session || g.session !== digest(scalar(session))))
            return this.fail("CLIENT_SESSION_MISMATCH", "login");
        if (session && g.session !== digest(scalar(session)))
            return this.fail("CLIENT_SESSION_MISMATCH", "login");
        if (g.expires <= this.now())
            return this.fail("CLIENT_ADMISSION_REQUIRED", "renew");
        return { ok: true };
    }
    /** Valid, account-bound HTTP/TCP activity keeps the same ticket alive without an extra request. */
    checkActivity(token, session) {
        const result = this.check(token, session, true);
        if (result.ok) {
            const g = this.grants.get(scalar(token));
            if (g)
                g.expires = this.now() + TTL;
        }
        return result;
    }
    /** Capabilities come from an authenticated build, never an HTTP declaration or legacy bypass. */
    hasCapability(token, session, capability) {
        var _a;
        const grant = this.grants.get(scalar(token));
        return !!grant && this.check(token, session, true).ok
            && ((_a = this.build(grant.build)) === null || _a === void 0 ? void 0 : _a.capabilities.has(capability)) === true;
    }
    /** Pre-login bootstrap routes (such as asset/get_path) have no bound session yet. */
    buildHasCapabilityUnbound(token, cap) {
        var _a;
        const t = scalar(token);
        if (!t || typeof cap !== "string" || !cap)
            return false;
        const grant = this.grants.get(t);
        return !!grant && this.current(grant)
            && ((_a = this.build(grant.build)) === null || _a === void 0 ? void 0 : _a.capabilities.has(cap)) === true;
    }
    /** Serializable, short socket capability. Grant storage and keys stay in the business process. */
    socketLease(token, session, active) {
        var _a;
        const result = active ? this.checkActivity(token, session) : this.check(token, session, true);
        if (!result.ok)
            return { ok: false, remainingMs: 0 };
        const g = this.grants.get(scalar(token));
        const b = g && this.build(g.build);
        return { ok: true, remainingMs: Math.max(0, Math.min(60000, g ? g.expires - this.now() : 60000)),
            weaponRiven: { p1: !!(b === null || b === void 0 ? void 0 : b.capabilities.has("weapon-riven-v1")), p2: !!(b === null || b === void 0 ? void 0 : b.capabilities.has("weapon-riven-multi-v1")),
                catalog: (_a = b === null || b === void 0 ? void 0 : b.weaponRivenCatalog) !== null && _a !== void 0 ? _a : "none" } };
    }
    bind(token, session) {
        const g = this.grants.get(scalar(token));
        if (g && this.current(g))
            g.session = digest(session);
    }
    renew(token, session, ip) {
        if (this.limited(ip))
            return this.fail("RATE_LIMITED");
        const g = this.grants.get(scalar(token));
        if (!g)
            return this.fail("CLIENT_ADMISSION_REQUIRED", "handshake");
        if (!this.allowed(g))
            return this.fail();
        if (g.session && g.session !== digest(scalar(session)))
            return this.fail("CLIENT_SESSION_MISMATCH", "login");
        if (g.expires + (g.session ? RENEW_GRACE : 0) <= this.now())
            return this.fail("CLIENT_ADMISSION_REQUIRED", "handshake");
        g.expires = this.now() + TTL;
        return this.issued(scalar(token), g);
    }
}
exports.ClientAdmission = ClientAdmission;
let instance;
function clientAdmission() {
    if (!instance) {
        instance = new ClientAdmission((0, node_path_1.resolve)(process.env.CLIENT_ADMISSION_CONFIG || "config/client-admission.json"), (0, node_path_1.resolve)(process.env.CLIENT_ADMISSION_KEYS || "config/client-admission.keys.json"));
        instance.start();
    }
    return instance;
}
exports.clientAdmission = clientAdmission;
function hasWeaponRivenCapability(request) {
    return clientAdmission().hasCapability(request.headers["x-sp-admission"], request.headers["x-sp-session"], "weapon-riven-v1");
}
exports.hasWeaponRivenCapability = hasWeaponRivenCapability;
const installedGates = new WeakMap();
function getInstalledClientAdmission(app) {
    return app ? installedGates.get(app) : undefined;
}
exports.getInstalledClientAdmission = getInstalledClientAdmission;
function installClientAdmission(app, gate = clientAdmission()) {
    installedGates.set(app, gate);
    app.addHook("onClose", () => __awaiter(this, void 0, void 0, function* () { return gate.close(); }));
    app.addHook("preHandler", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        const path = (0, request_route_path_1.requestRoutePath)(request);
        const game = path.startsWith("/api/index.php/");
        if (!game && !path.startsWith("/player-auth/"))
            return;
        // Account ownership remains checked by the existing player-login guard.
        const bootstrap = /^\/api\/index\.php\/(asset\/|assetintitle\/)/.test(path) || path === "/api/index.php/tool/auth";
        const result = game && !bootstrap
            ? gate.checkActivity(request.headers["x-sp-admission"], request.headers["x-sp-session"])
            : gate.check(request.headers["x-sp-admission"], game ? request.headers["x-sp-session"] : undefined);
        if (result.ok)
            return;
        console.log(`[ADMISSION-DIAG] gate reject path=${path.slice(0, 80)} code=${result.code} hasTicket=${!!request.headers["x-sp-admission"]} ip=${request.ip}`);
        reply.header("cache-control", "no-store");
        if (!game)
            return reply.send(result);
        reply.type("application/x-msgpack");
        return reply.send({ data_headers: Object.assign(Object.assign({}, (0, utils_1.generateDataHeaders)({ result_code: 516 })), { client_admission: result }), data: {} });
    }));
    app.addHook("onRoute", options => {
        if (!/^\/player-auth\/(login|register|resume|bind)$/.test(options.url))
            return;
        const previous = options.preSerialization;
        options.preSerialization = [...(Array.isArray(previous) ? previous : previous ? [previous] : []),
            (request, _reply, payload) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                if ((payload === null || payload === void 0 ? void 0 : payload.ok) && typeof ((_a = payload.data) === null || _a === void 0 ? void 0 : _a.token) === "string")
                    gate.bind(request.headers["x-sp-admission"], payload.data.token);
                return payload;
            })];
    });
    const route = (path, fn) => app.post(path, { bodyLimit: 2048 }, (req, reply) => __awaiter(this, void 0, void 0, function* () {
        reply.header("cache-control", "no-store");
        return fn(req.body, req);
    }));
    route("/client-admission/challenge", (b, req) => gate.challenge(b, req.ip));
    route("/client-admission/prove", (b, req) => gate.prove(b, req.ip));
    route("/client-admission/renew", (_b, req) => gate.renew(req.headers["x-sp-admission"], req.headers["x-sp-session"], req.ip));
}
exports.installClientAdmission = installClientAdmission;
