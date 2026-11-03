"use strict";
/**
 * Process-level guards for the CN server.
 *
 * Since Node 15 an unhandled promise rejection terminates the process, which
 * drops every connected player at once. A rejection only means one async task
 * failed without a handler; the event loop and all other state are intact, so
 * it is logged with its stack and the server keeps running.
 *
 * An uncaught synchronous exception is different: it unwinds through code
 * that may have left shared state half-updated, and Node documents that
 * resuming afterwards is unsafe. It is logged and then the caller-provided
 * graceful shutdown runs (Fastify close hooks drain realtime and persistence
 * work), exiting with code 1 instead of the abrupt default exit.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.installProcessGuards = exports.describeFailure = void 0;
function describeFailure(value) {
    if (value instanceof Error)
        return value.stack || `${value.name}: ${value.message}`;
    if (typeof value === "string")
        return value;
    try {
        return `non-error value: ${JSON.stringify(value)}`;
    }
    catch (_a) {
        return `non-error value: ${String(value)}`;
    }
}
exports.describeFailure = describeFailure;
function installProcessGuards(options) {
    var _a, _b, _c, _d, _e;
    const target = (_a = options.target) !== null && _a !== void 0 ? _a : process;
    const log = (_b = options.log) !== null && _b !== void 0 ? _b : ((message) => console.error(message));
    const now = (_c = options.now) !== null && _c !== void 0 ? _c : Date.now;
    const limit = Math.max(1, (_d = options.rejectionLogLimit) !== null && _d !== void 0 ? _d : 20);
    const windowMs = Math.max(1, (_e = options.rejectionLogWindowMs) !== null && _e !== void 0 ? _e : 60000);
    const stats = { unhandledRejections: 0, uncaughtExceptions: 0 };
    let windowStart = now();
    let loggedInWindow = 0;
    let suppressedInWindow = 0;
    let fatalRequested = false;
    const onRejection = (reason) => {
        stats.unhandledRejections++;
        const current = now();
        if (current - windowStart >= windowMs) {
            if (suppressedInWindow > 0) {
                log(`[PROCESS] unhandledRejection: ${suppressedInWindow} further rejection(s) not logged in the previous window`);
            }
            windowStart = current;
            loggedInWindow = 0;
            suppressedInWindow = 0;
        }
        if (loggedInWindow >= limit) {
            suppressedInWindow++;
            return;
        }
        loggedInWindow++;
        log(`[PROCESS] unhandledRejection (total ${stats.unhandledRejections}); server keeps running: ${describeFailure(reason)}`);
    };
    const onException = (error, origin) => {
        stats.uncaughtExceptions++;
        log(`[PROCESS] uncaughtException${origin ? ` (${origin})` : ""}; starting graceful shutdown: ${describeFailure(error)}`);
        if (fatalRequested)
            return;
        fatalRequested = true;
        options.onFatal("uncaughtException");
    };
    target.on("unhandledRejection", onRejection);
    target.on("uncaughtException", onException);
    return {
        stats,
        uninstall() {
            target.off("unhandledRejection", onRejection);
            target.off("uncaughtException", onException);
        },
    };
}
exports.installProcessGuards = installProcessGuards;
