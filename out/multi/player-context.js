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
exports.resolveMultiPlayerContext = exports.invalidateMultiPlayerContext = exports.getCachedMultiPlayerContext = exports.cacheMultiPlayerContext = void 0;
const activeAccount_1 = require("../data/activeAccount");
const player_1 = require("../data/domains/player");
const session_1 = require("../data/domains/session");
const memory_diagnostics_1 = require("../lib/memory-diagnostics");
const CONTEXT_CACHE_TTL_MS = Math.max(5000, Number.parseInt((_a = process.env.MULTI_CONTEXT_CACHE_TTL_MS) !== null && _a !== void 0 ? _a : "10000", 10) || 10000);
const CONTEXT_CACHE_MAX_ENTRIES = Math.max(100, Number.parseInt((_b = process.env.MULTI_CONTEXT_CACHE_MAX_ENTRIES) !== null && _b !== void 0 ? _b : "1000", 10) || 1000);
const contextCache = new Map();
let contextCacheHits = 0;
let contextCacheMisses = 0;
(0, memory_diagnostics_1.registerMemoryCounters)("multiPlayerContext", _detailed => ({
    entries: contextCache.size,
    hits: contextCacheHits,
    misses: contextCacheMisses,
    ttlMs: CONTEXT_CACHE_TTL_MS,
    maxEntries: CONTEXT_CACHE_MAX_ENTRIES,
}));
function readCachedContext(viewerId) {
    const entry = contextCache.get(viewerId);
    if (!entry)
        return null;
    if (entry.expiresAt <= Date.now()) {
        contextCache.delete(viewerId);
        return null;
    }
    contextCacheHits++;
    return entry.context;
}
/** Cache only after an HTTP route has authenticated the viewer. */
function cacheMultiPlayerContext(viewerId, context) {
    if (!Number.isSafeInteger(viewerId) || viewerId <= 0)
        return;
    if (!contextCache.has(viewerId) && contextCache.size >= CONTEXT_CACHE_MAX_ENTRIES) {
        const oldest = contextCache.keys().next().value;
        if (Number.isSafeInteger(oldest))
            contextCache.delete(oldest);
    }
    contextCache.set(viewerId, { context, expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS });
}
exports.cacheMultiPlayerContext = cacheMultiPlayerContext;
function getCachedMultiPlayerContext(viewerId) {
    return readCachedContext(viewerId);
}
exports.getCachedMultiPlayerContext = getCachedMultiPlayerContext;
function invalidateMultiPlayerContext(viewerId) {
    contextCache.delete(viewerId);
}
exports.invalidateMultiPlayerContext = invalidateMultiPlayerContext;
/** Resolve a multiplayer viewer token to that account's selected save. */
function resolveMultiPlayerContext(viewerId_1) {
    return __awaiter(this, arguments, void 0, function* (viewerId, dependencies = {}) {
        var _a, _b, _c;
        if (!Number.isSafeInteger(viewerId) || viewerId <= 0)
            return null;
        const session = yield ((_a = dependencies.getSession) !== null && _a !== void 0 ? _a : session_1.getSession)(String(viewerId));
        if (!session)
            return null;
        const playerId = ((_b = dependencies.resolvePlayerIdSync) !== null && _b !== void 0 ? _b : activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (!playerId)
            return null;
        const player = ((_c = dependencies.getPlayerSync) !== null && _c !== void 0 ? _c : player_1.getPlayerSync)(playerId);
        if (!player)
            return null;
        const context = { playerId, player };
        contextCacheMisses++;
        return context;
    });
}
exports.resolveMultiPlayerContext = resolveMultiPlayerContext;
