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
exports.createTeamCodeClient = exports.TeamCodeLimiter = exports.teamCodeBaseUrl = exports.parseTeamCodePayload = exports.wikiPublicId = exports.TeamCodeError = exports.TEAM_GROUPS = exports.GAME_CODE_PATTERN = void 0;
const node_crypto_1 = require("node:crypto");
exports.GAME_CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/;
exports.TEAM_GROUPS = ["main", "unison", "weapon", "soul"];
class TeamCodeError extends Error {
    constructor(kind) {
        super(kind);
        this.kind = kind;
        this.name = "TeamCodeError";
    }
}
exports.TeamCodeError = TeamCodeError;
/** Stable opaque IDs shared with the Wiki. Raw game IDs never leave the server. */
function wikiPublicId(kind, id) {
    return kind + (0, node_crypto_1.createHash)("sha256")
        .update(`wf-wiki-public-v1:${kind}:${id}`)
        .digest("hex")
        .slice(0, 12);
}
exports.wikiPublicId = wikiPublicId;
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function parseTeamCodePayload(value) {
    if (!isRecord(value)
        || Object.keys(value).sort().join(",") !== "active,team,title"
        || value.active !== true
        || typeof value.title !== "string"
        || value.title.trim().length === 0
        || [...value.title].length > 80
        || /[\u0000-\u001f\u007f]/.test(value.title)
        || !isRecord(value.team)
        || Object.keys(value.team).sort().join(",") !== "main,soul,unison,weapon") {
        throw new TeamCodeError("incompatible");
    }
    const team = {};
    const seenCharacters = new Set();
    for (const group of exports.TEAM_GROUPS) {
        const ids = value.team[group];
        const isCharacter = group === "main" || group === "unison";
        if (!Array.isArray(ids) || ids.length !== 3)
            throw new TeamCodeError("incompatible");
        team[group] = ids.map((id) => {
            if (id === "" && group !== "main")
                return "";
            const pattern = isCharacter ? /^c[0-9a-f]{12}$/ : /^w[0-9a-f]{12}$/;
            if (typeof id !== "string" || !pattern.test(id)
                || (isCharacter && seenCharacters.has(id))) {
                throw new TeamCodeError("incompatible");
            }
            if (isCharacter)
                seenCharacters.add(id);
            return id;
        });
    }
    return { title: value.title, active: true, team };
}
exports.parseTeamCodePayload = parseTeamCodePayload;
function teamCodeBaseUrl(raw) {
    let url;
    try {
        url = new URL(raw || "");
    }
    catch (_a) {
        throw new TeamCodeError("unavailable");
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const pathname = url.pathname.replace(/\/+$/, "");
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
        || url.username
        || url.password
        || url.search
        || url.hash
        || pathname !== "/api/community/game-codes") {
        throw new TeamCodeError("unavailable");
    }
    url.pathname = pathname;
    return url;
}
exports.teamCodeBaseUrl = teamCodeBaseUrl;
class TeamCodeLimiter {
    constructor() {
        this.entries = new Map();
    }
    take(key, limit, now = Date.now()) {
        for (const [name, entry] of this.entries) {
            if (now - entry.start >= 60000)
                this.entries.delete(name);
        }
        const entry = this.entries.get(key);
        if (!entry) {
            if (this.entries.size >= 10000)
                return false;
            this.entries.set(key, { start: now, count: 1 });
            return true;
        }
        if (entry.count >= limit)
            return false;
        entry.count++;
        return true;
    }
}
exports.TeamCodeLimiter = TeamCodeLimiter;
function createTeamCodeClient(options = {}) {
    const fetcher = options.fetcher || fetch;
    const now = options.now || Date.now;
    const cache = new Map();
    return (code) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!exports.GAME_CODE_PATTERN.test(code))
            throw new TeamCodeError("not-found");
        const base = teamCodeBaseUrl((options.url || (() => process.env.COMMUNITY_TEAM_CODES_URL))());
        const key = `${base.href.replace(/\/$/, "")}/${code}`;
        const cached = cache.get(key);
        if (cached && cached.expires > now())
            return cached.value;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
            const response = yield fetcher(key, {
                headers: { Accept: "application/json" },
                redirect: "error",
                signal: controller.signal,
            });
            if (response.status === 404 || response.status === 410) {
                throw new TeamCodeError("not-found");
            }
            if (!response.ok
                || !((_a = response.headers.get("content-type")) === null || _a === void 0 ? void 0 : _a.includes("application/json"))
                || Number(response.headers.get("content-length")) > 16384
                || !response.body) {
                throw new TeamCodeError("unavailable");
            }
            const reader = response.body.getReader();
            const chunks = [];
            let size = 0;
            try {
                while (true) {
                    const part = yield reader.read();
                    if (part.done)
                        break;
                    size += part.value.length;
                    if (size > 16384) {
                        yield reader.cancel();
                        throw new TeamCodeError("unavailable");
                    }
                    chunks.push(part.value);
                }
            }
            finally {
                reader.releaseLock();
            }
            const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (isRecord(raw) && raw.active === false) {
                throw new TeamCodeError("not-found");
            }
            const value = parseTeamCodePayload(raw);
            for (const [name, entry] of cache) {
                if (entry.expires <= now())
                    cache.delete(name);
            }
            if (cache.size >= 500) {
                const oldest = cache.keys().next().value;
                if (oldest !== undefined)
                    cache.delete(oldest);
            }
            cache.set(key, { expires: now() + 5000, value });
            return value;
        }
        catch (error) {
            throw error instanceof TeamCodeError
                ? error
                : new TeamCodeError("unavailable");
        }
        finally {
            clearTimeout(timer);
        }
    });
}
exports.createTeamCodeClient = createTeamCodeClient;
