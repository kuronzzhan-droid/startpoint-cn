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
exports.runLeaderboardWork = exports.createLeaderboardWorkControl = exports.LeaderboardWorkBusyError = void 0;
const competition_1 = require("./competition");
const persistence_coordinator_1 = require("../persistence-coordinator");
const shutdown_state_1 = require("../shutdown-state");
class LeaderboardWorkBusyError extends Error {
    constructor() {
        super("排行榜维护繁忙，请稍后重试。");
        this.statusCode = 429;
        this.code = "LEADERBOARD_BUSY";
    }
}
exports.LeaderboardWorkBusyError = LeaderboardWorkBusyError;
/** One accepted maintenance job; repeated admin clicks never accumulate work. */
function createLeaderboardWorkControl(clock = Date.now) {
    let running = false, lastNow = -Infinity;
    // Keys are limited to registered competitions and these two admin actions.
    const nextAllowed = new Map();
    const run = (key, action, operation) => (0, shutdown_state_1.withServerWorkAdmission)(() => __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!(0, competition_1.getLeaderboardCompetition)(key))
            throw new Error("Unknown leaderboard competition");
        const now = lastNow = Math.max(lastNow, clock());
        const budgetKey = `${key}:${action}`;
        if (running || action !== "scheduler" && now < ((_a = nextAllowed.get(budgetKey)) !== null && _a !== void 0 ? _a : -Infinity)) {
            throw new LeaderboardWorkBusyError();
        }
        running = true;
        if (action !== "scheduler")
            nextAllowed.set(budgetKey, now + 2000);
        try {
            const result = yield operation();
            // A precondition failure (for example rollover before settlement)
            // must not prevent a corrected action immediately afterwards.
            if (result && typeof result === "object" && "ok" in result && result.ok === false)
                nextAllowed.delete(budgetKey);
            return result;
        }
        finally {
            running = false;
        }
    }));
    return Object.assign((key, action, operation) => run(key, action, () => ((0, persistence_coordinator_1.runPersistenceTransaction)({ domain: "leaderboard", operation: `${action}:${key}` }, operation))), 
    // Async work owns its transaction on another connection. Share the same
    // one-job/cooldown control without holding a main-thread transaction.
    { background: run });
}
exports.createLeaderboardWorkControl = createLeaderboardWorkControl;
exports.runLeaderboardWork = createLeaderboardWorkControl();
