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
exports.createGracefulShutdown = exports.shutdownDeadlines = void 0;
function shutdownDeadlines(timeoutMs) {
    const totalMs = Math.max(5000, Number.isFinite(timeoutMs) ? timeoutMs : 180000);
    return {
        totalMs,
        cancelAtMs: totalMs - Math.min(30000, totalMs / 3),
        terminateAtMs: totalMs - Math.min(15000, totalMs / 6),
    };
}
exports.shutdownDeadlines = shutdownDeadlines;
/** One absolute deadline; worker runtime limits continue from their original start. */
function createGracefulShutdown(options) {
    var _a;
    const logger = (_a = options.logger) !== null && _a !== void 0 ? _a : console;
    const deadlines = shutdownDeadlines(options.timeoutMs);
    let pending = null;
    return (source) => {
        if (pending)
            return pending;
        // Withdraw admission/readiness and stop all producers before the first
        // await (Fastify may wait for active HTTP requests before onClose).
        let quiesceFailed = false, quiesceError;
        try {
            options.quiesce();
        }
        catch (error) {
            quiesceFailed = true;
            quiesceError = error;
        }
        logger.warn(`[SHUTDOWN] ${source} received; draining accepted work (deadline=${deadlines.totalMs}ms)`);
        pending = (() => __awaiter(this, void 0, void 0, function* () {
            let hardTimeout;
            const cancelTimeout = setTimeout(() => {
                logger.warn("[SHUTDOWN] drain reserve reached; requesting leaderboard rollback");
                options.cancel();
            }, deadlines.cancelAtMs);
            const terminateTimeout = setTimeout(() => {
                logger.warn("[SHUTDOWN] rollback reserve reached; terminating remaining leaderboard workers");
                void options.terminate().catch(error => logger.error("[SHUTDOWN] worker termination failed", error));
            }, deadlines.terminateAtMs);
            try {
                yield Promise.race([
                    options.close(),
                    new Promise((_, reject) => {
                        hardTimeout = setTimeout(() => reject(new Error(`graceful shutdown timed out after ${deadlines.totalMs}ms`)), deadlines.totalMs);
                    }),
                ]);
                if (quiesceFailed)
                    throw quiesceError;
                logger.log("[SHUTDOWN] graceful shutdown complete");
            }
            catch (error) {
                logger.error(`[SHUTDOWN] graceful shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
                options.failed(error);
            }
            finally {
                clearTimeout(cancelTimeout);
                clearTimeout(terminateTimeout);
                if (hardTimeout)
                    clearTimeout(hardTimeout);
            }
        }))();
        return pending;
    };
}
exports.createGracefulShutdown = createGracefulShutdown;
