"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMissionRewardClaims = void 0;
const rewards_1 = require("./rewards");
const active_master_data_1 = require("./active-master-data");
const active_core_1 = require("./active-core");
function normalizeAvailabilityMissions(activeMissions) {
    return Object.fromEntries(Object.entries(activeMissions).map(([missionId, mission]) => [
        missionId,
        {
            progress: mission.progress,
            stages: mission.stages && !Array.isArray(mission.stages) ? mission.stages : {},
        },
    ]));
}
function validateMissionRewardClaims(activeMissions, requestList, context) {
    if (!Array.isArray(requestList))
        return { ok: false, message: "Invalid active mission claim." };
    const claims = [];
    const seen = new Set();
    const availabilityMissions = context
        ? normalizeAvailabilityMissions(activeMissions)
        : null;
    for (const rawEntry of requestList) {
        if (!rawEntry || typeof rawEntry !== "object") {
            return { ok: false, message: "Invalid active mission claim." };
        }
        const entry = rawEntry;
        const missionId = Number(entry.mission_id);
        if (!Number.isInteger(missionId) || missionId <= 0 || !Array.isArray(entry.stages)) {
            return { ok: false, message: "Invalid active mission claim." };
        }
        if (!(0, active_master_data_1.getActiveMissionMasterDefinition)(missionId, context === null || context === void 0 ? void 0 : context.repository)) {
            return { ok: false, message: "Unknown active mission." };
        }
        if (context && availabilityMissions && !(0, active_core_1.isActiveMissionClaimable)(missionId, Object.assign(Object.assign({}, context), { activeMissions: availabilityMissions })))
            return { ok: false, message: "Active mission is not available." };
        const mission = activeMissions[String(missionId)];
        if (!mission)
            return { ok: false, message: "Mission is not active." };
        const existingStages = mission.stages && !Array.isArray(mission.stages) ? mission.stages : {};
        for (const rawStage of entry.stages) {
            const stage = Number(rawStage);
            if (!Number.isInteger(stage) || stage <= 0) {
                return { ok: false, message: "Invalid mission stage." };
            }
            const key = `${missionId}:${stage}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            if (existingStages[String(stage)] === true)
                continue;
            const definition = (0, rewards_1.getMissionRewardStageDefinition)(missionId, stage, context === null || context === void 0 ? void 0 : context.repository);
            if (!definition)
                return { ok: false, message: "Unknown mission reward stage." };
            if (existingStages[String(stage)] !== false && (mission.progress < definition.targetProgress || definition.targetClearSeconds !== undefined)) {
                return { ok: false, message: "Mission stage is not complete." };
            }
            claims.push({ missionId, stage, progress: mission.progress, rewards: definition.rewards });
        }
    }
    return { ok: true, claims };
}
exports.validateMissionRewardClaims = validateMissionRewardClaims;
