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
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.acquireFinishExecution = exports.cacheFinishResponse = exports.getCachedFinishPlayId = exports.getCachedFinishResponse = exports.buildFinishResponseCacheKey = void 0;
const memory_diagnostics_1 = require("./memory-diagnostics");
const entries = new Map();
const executionTails = new Map();
(0, memory_diagnostics_1.registerMemoryCounters)("finishCache", () => ({ entries: entries.size, executing: executionTails.size }));
// Multiplayer clients can submit the same settlement again after the lobby has
// already been cleaned up (slow guest, reconnect or HTTP retry).  Keep the
// completed response long enough for that late request to remain idempotent.
const ttlMs = Math.max(5000, Number.parseInt((_a = process.env.FINISH_RESPONSE_CACHE_TTL_MS) !== null && _a !== void 0 ? _a : "120000", 10) || 120000);
const maxEntries = Math.max(32, Number.parseInt((_b = process.env.FINISH_RESPONSE_CACHE_MAX) !== null && _b !== void 0 ? _b : "512", 10) || 512);
function buildFinishResponseCacheKey(mode, viewerId, body) {
    var _a, _b;
    const playId = typeof body.play_id === "string" && body.play_id.length > 0
        ? body.play_id
        : body.api_count !== undefined && body.api_count !== null
            ? `api:${String(body.api_count)}`
            : null;
    // Without a client request token, two legitimate consecutive clears of the
    // same quest are indistinguishable.  In that case it is safer not to cache.
    if (playId === null)
        return null;
    return `${mode}:${viewerId}:${String((_a = body.category) !== null && _a !== void 0 ? _a : "")}:${String((_b = body.quest_id) !== null && _b !== void 0 ? _b : "")}:${playId}`;
}
exports.buildFinishResponseCacheKey = buildFinishResponseCacheKey;
function getCachedFinishResponse(key) {
    if (key === null)
        return undefined;
    const entry = entries.get(key);
    if (!entry)
        return undefined;
    if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
    }
    // Refresh insertion order so hot retry entries remain within the bound.
    entries.delete(key);
    entries.set(key, entry);
    return entry.response;
}
exports.getCachedFinishResponse = getCachedFinishResponse;
function getCachedFinishPlayId(key) {
    if (key === null)
        return undefined;
    const entry = entries.get(key);
    if (!entry)
        return undefined;
    if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
    }
    return entry.playId;
}
exports.getCachedFinishPlayId = getCachedFinishPlayId;
function cacheFinishResponse(key, response, playId) {
    if (key === null)
        return;
    entries.delete(key);
    entries.set(key, { expiresAt: Date.now() + ttlMs, response, playId });
    while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined)
            break;
        entries.delete(oldest);
    }
}
exports.cacheFinishResponse = cacheFinishResponse;
/** Serialize retries for the same battle/player until the first response is cached. */
function acquireFinishExecution(key) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (key === null)
            return () => undefined;
        const previous = (_a = executionTails.get(key)) !== null && _a !== void 0 ? _a : Promise.resolve();
        let releaseCurrent;
        const current = new Promise(resolve => { releaseCurrent = resolve; });
        const tail = previous.then(() => current);
        executionTails.set(key, tail);
        yield previous;
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            releaseCurrent();
            void tail.finally(() => {
                if (executionTails.get(key) === tail)
                    executionTails.delete(key);
            });
        };
    });
}
exports.acquireFinishExecution = acquireFinishExecution;
