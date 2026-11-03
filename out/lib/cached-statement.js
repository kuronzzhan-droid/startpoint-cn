"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.cachedStatement = void 0;
const memory_diagnostics_1 = require("./memory-diagnostics");
const caches = new WeakMap();
const stats = { hits: 0, misses: 0, evictions: 0, busyBypasses: 0 };
const LIMIT = 128;
const enabled = !/^(0|false|no|off)$/i.test((_a = process.env.SQL_STATEMENT_CACHE) !== null && _a !== void 0 ? _a : "true");
(0, memory_diagnostics_1.registerMemoryCounters)("sqlStatements", () => (Object.assign(Object.assign({}, stats), { perConnectionLimit: LIMIT })));
/** For audited get/all/run callers only; do not mutate a shared statement's bind/raw/pluck mode. */
function cachedStatement(db, sql) {
    if (!enabled)
        return db.prepare(sql);
    let cache = caches.get(db);
    if (!cache) {
        cache = new Map();
        caches.set(db, cache);
    }
    const previous = cache.get(sql);
    if (previous && !previous.busy) {
        stats.hits++;
        cache.delete(sql);
        cache.set(sql, previous);
        return previous;
    }
    if (previous === null || previous === void 0 ? void 0 : previous.busy) {
        stats.busyBypasses++;
        return db.prepare(sql);
    }
    stats.misses++;
    const statement = db.prepare(sql);
    cache.set(sql, statement);
    if (cache.size > LIMIT) {
        cache.delete(cache.keys().next().value);
        stats.evictions++;
    }
    return statement;
}
exports.cachedStatement = cachedStatement;
