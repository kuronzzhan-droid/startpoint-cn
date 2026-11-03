"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordActiveMissionQuestChallengeFactSync = void 0;
const active_mission_counters_1 = require("../../data/domains/active_mission_counters");
const types_1 = require("../types");
function recordActiveMissionQuestChallengeFactSync(playerId, questCategory) {
    if (questCategory !== types_1.QuestCategory.PRACTICE)
        return;
    (0, active_mission_counters_1.incrementActiveMissionPracticeQuestChallengeCountSync)(playerId);
}
exports.recordActiveMissionQuestChallengeFactSync = recordActiveMissionQuestChallengeFactSync;
