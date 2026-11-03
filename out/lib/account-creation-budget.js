"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accountCreationBudget = exports.createAccountCreationBudget = exports.AccountCreationBudgetError = exports.ACCOUNT_CREATION_DEFAULTS = void 0;
// Shared sources such as NAT/portproxy need headroom. These are provisional
// admission ceilings, not a measured production-capacity guarantee. Windows
// are anchored per root/source, process-local, and reset on server restart.
exports.ACCOUNT_CREATION_DEFAULTS = Object.freeze({
    shortWindowMs: 60000, hourWindowMs: 3600000,
    sourceAttemptMax: 30, globalAttemptMax: 60,
    sourceSuccessMax: 120, globalSuccessMax: 300, maxSources: 4096,
});
class AccountCreationBudgetError extends Error {
    constructor() { super("Account creation budget exhausted"); }
}
exports.AccountCreationBudgetError = AccountCreationBudgetError;
function createAccountCreationBudget(options = {}) {
    var _a;
    const config = Object.assign(Object.assign({}, exports.ACCOUNT_CREATION_DEFAULTS), options);
    for (const [key, value] of Object.entries(config)) {
        if (key === "enabled" || key === "clock")
            continue;
        if (!Number.isSafeInteger(value) || Number(value) <= 0)
            throw new Error(`Invalid creation budget: ${key}`);
    }
    const clock = (_a = options.clock) !== null && _a !== void 0 ? _a : Date.now;
    const sources = new Map();
    let nextSweep = 0;
    let lastNow = -Infinity;
    function now() {
        const current = clock();
        // A backwards wall-clock adjustment must not prematurely replenish quotas.
        if (!Number.isFinite(current))
            throw new Error("Invalid creation budget clock");
        return lastNow = Math.max(lastNow, current);
    }
    function makeSource(at) {
        return { attempts: { count: 0, expires: at + config.shortWindowMs },
            successes: { count: 0, expires: at + config.hourWindowMs }, pending: 0 };
    }
    const global = makeSource(now());
    function refresh(source, at) {
        if (source.attempts.expires <= at)
            source.attempts = { count: 0, expires: at + config.shortWindowMs };
        if (source.successes.expires <= at)
            source.successes = { count: 0, expires: at + config.hourWindowMs };
    }
    function attempt(window, maximum) {
        window.count = Math.min(window.count + 1, maximum + 1);
        return window.count <= maximum;
    }
    return {
        reserve(ip) {
            if (options.enabled === false || typeof ip !== "string" || !ip || ip.length > 128)
                return null;
            const at = now();
            refresh(global, at);
            // A source is retained while any reservation is outstanding, even
            // across window rollover; a new window cannot over-admit work.
            if (at >= nextSweep) {
                for (const [key, source] of sources) {
                    if (source.pending === 0 && source.attempts.expires <= at && source.successes.expires <= at)
                        sources.delete(key);
                }
                nextSweep = at + config.shortWindowMs;
            }
            const globalAttempt = attempt(global.attempts, config.globalAttemptMax);
            let source = sources.get(ip);
            if (!source) {
                if (!globalAttempt || sources.size >= config.maxSources)
                    return null;
                source = makeSource(at);
                sources.set(ip, source);
            }
            refresh(source, at);
            const sourceAttempt = attempt(source.attempts, config.sourceAttemptMax);
            if (!globalAttempt || !sourceAttempt
                || source.successes.count + source.pending >= config.sourceSuccessMax
                || global.successes.count + global.pending >= config.globalSuccessMax)
                return null;
            source.pending++;
            global.pending++;
            const accepted = source;
            let finished = false;
            const finish = (created) => {
                if (finished)
                    return;
                finished = true;
                // Refresh before charging successes to the actual commit window.
                const committedAt = now();
                refresh(accepted, committedAt);
                refresh(global, committedAt);
                accepted.pending--;
                global.pending--;
                if (created) {
                    accepted.successes.count++;
                    global.successes.count++;
                }
            };
            return { commit: () => finish(true), release: () => finish(false) };
        },
        // Bounded counts for diagnostics/tests; no account identity or IP export.
        inspect: () => ({ sources: sources.size, pending: global.pending,
            successes: global.successes.count, attempts: global.attempts.count }),
    };
}
exports.createAccountCreationBudget = createAccountCreationBudget;
const rootBudgets = new WeakMap();
/** Fastify encapsulated plugins share one server object, distinct roots do not. */
function accountCreationBudget(app, options) {
    const existing = rootBudgets.get(app.server);
    if (existing) {
        if (options !== undefined)
            throw new Error("Account creation budget already initialized");
        return existing;
    }
    const budget = createAccountCreationBudget(options);
    rootBudgets.set(app.server, budget);
    return budget;
}
exports.accountCreationBudget = accountCreationBudget;
