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
exports.drainServerWork = exports.withShutdownCleanup = exports.withServerWorkAdmission = exports.assertServerAcceptingWork = exports.beginServerShutdown = exports.hasServerWorkAdmission = exports.isServerShuttingDown = exports.createServerShutdownState = exports.ServerClosingError = void 0;
const node_async_hooks_1 = require("node:async_hooks");
class ServerClosingError extends Error {
    constructor() {
        super("服务器正在关闭，请稍后重试。");
        this.statusCode = 503;
        this.code = "SERVER_CLOSING";
    }
}
exports.ServerClosingError = ServerClosingError;
/** Admission is sticky; only work accepted before close may enqueue its remaining writes. */
function createServerShutdownState() {
    const context = new node_async_hooks_1.AsyncLocalStorage();
    const pending = new Set();
    let closing = false;
    const assertAccepting = () => {
        var _a;
        if (closing && !((_a = context.getStore()) === null || _a === void 0 ? void 0 : _a.active))
            throw new ServerClosingError();
    };
    const run = (operation, cleanup = false) => {
        if (!cleanup)
            assertAccepting();
        // Each child holds its own lifetime: an accepted queued write must not
        // lose admission when a caller returns without awaiting that write.
        const token = { active: true };
        return context.run(token, () => {
            let result;
            try {
                result = operation();
            }
            catch (error) {
                token.active = false;
                throw error;
            }
            if (result && typeof result.then === "function") {
                const tracked = Promise.resolve(result).finally(() => {
                    token.active = false;
                    pending.delete(tracked);
                });
                pending.add(tracked);
                return tracked;
            }
            token.active = false;
            return result;
        });
    };
    return {
        isClosing: () => closing,
        hasAdmission: () => { var _a; return ((_a = context.getStore()) === null || _a === void 0 ? void 0 : _a.active) === true; },
        beginClosing: () => { closing = true; },
        assertAccepting,
        run: (operation) => run(operation),
        cleanup: (operation) => run(operation, true),
        drain() {
            return __awaiter(this, void 0, void 0, function* () {
                // Accepted parents can add children after awaits. Wait for a stable
                // empty set rather than one snapshot of the persistence queue tail.
                while (pending.size)
                    yield Promise.allSettled([...pending]);
            });
        },
    };
}
exports.createServerShutdownState = createServerShutdownState;
const state = createServerShutdownState();
exports.isServerShuttingDown = state.isClosing;
exports.hasServerWorkAdmission = state.hasAdmission;
exports.beginServerShutdown = state.beginClosing;
exports.assertServerAcceptingWork = state.assertAccepting;
exports.withServerWorkAdmission = state.run;
exports.withShutdownCleanup = state.cleanup;
exports.drainServerWork = state.drain;
