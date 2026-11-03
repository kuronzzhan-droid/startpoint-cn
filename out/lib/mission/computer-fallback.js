"use strict";
// Fallback computer — returns DB-stored progress for unhandled categories
Object.defineProperty(exports, "__esModule", { value: true });
exports.FallbackComputer = void 0;
const evaluation_context_1 = require("./evaluation-context");
function buildMinimal(playerId, category, shared) {
    const player = shared.player;
    return {
        category,
        playerId,
        player,
        questProgress: {},
        totalQuestClears: 0,
        totalStories: 0,
        rankCounts: {},
    };
}
exports.FallbackComputer = {
    name: "Fallback",
    buildContext(playerId, category, _evaluationTime, _missionIds, shared = new evaluation_context_1.MissionEvaluationReadContext(playerId)) {
        return buildMinimal(playerId, category, shared);
    },
    compute(_missionId, _ctx, dbProgress) {
        return dbProgress;
    },
};
