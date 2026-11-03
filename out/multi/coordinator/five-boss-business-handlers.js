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
exports.registerFiveBossBusinessHandlers = exports.handleFiveBossBusiness = void 0;
/** Parent-only module: no room/session imports or volatile authority construction. */
function handleFiveBossBusiness(kind, payload) {
    return __awaiter(this, void 0, void 0, function* () {
        if (kind !== "fiveBoss.proof.persist")
            throw new Error("Unknown five-boss business operation");
        const p = payload;
        if (!p || typeof p.runId !== "string" || !p.runId || typeof p.roomNumber !== "string" || !p.roomNumber
            || !Number.isSafeInteger(p.playerId) || p.playerId <= 0 || !["scene_ready", "level_next", "finalize"].includes(p.signal))
            throw new Error("Invalid five-boss proof");
        const { runPersistenceTransaction } = require("../../lib/persistence-coordinator");
        const { recordMemberBattleSignalSync } = require("../../data/domains/fiveBossGauntletRun");
        yield runPersistenceTransaction({ domain: "multi-settlement", playerId: p.playerId, operation: `five_boss_${p.signal}` }, () => recordMemberBattleSignalSync(p));
        return { persisted: true };
    });
}
exports.handleFiveBossBusiness = handleFiveBossBusiness;
function registerFiveBossBusinessHandlers(register) {
    register("fiveBoss.proof.persist", payload => handleFiveBossBusiness("fiveBoss.proof.persist", payload));
}
exports.registerFiveBossBusinessHandlers = registerFiveBossBusinessHandlers;
