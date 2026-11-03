"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startContentsGuideMission = void 0;
const mission_1 = require("../../data/domains/mission");
const quest_1 = require("../../data/domains/quest");
const persistence_coordinator_1 = require("../persistence-coordinator");
const active_master_data_1 = require("./active-master-data");
const active_core_1 = require("./active-core");
const CONTENTS_GUIDE_EVENT_KIND = 2;
const CONTENTS_GUIDE_START_STRING_ID = "contents_guide_start";
function normalizeActiveMissions(activeMissions) {
    return Object.fromEntries(Object.entries(activeMissions).map(([missionId, mission]) => [
        missionId,
        {
            progress: mission.progress,
            stages: mission.stages && !Array.isArray(mission.stages) ? mission.stages : {},
        },
    ]));
}
function resolveContentsGuideStartMissionId(eventId, repository) {
    try {
        const eventMaster = (0, active_master_data_1.getActiveMissionEventMasterDefinition)(eventId, repository);
        if (!eventMaster)
            return null;
        const event = (0, active_core_1.parseActiveMissionEventDefinition)(eventId, eventMaster.row);
        if (event.kind !== CONTENTS_GUIDE_EVENT_KIND)
            return null;
        const candidates = (0, active_master_data_1.getActiveMissionMasterDefinitions)(repository).filter(definition => (Number(definition.row[0]) === eventId
            && definition.row[3] === CONTENTS_GUIDE_START_STRING_ID));
        if (candidates.length !== 1)
            return null;
        const mission = (0, active_core_1.parseActiveMissionDefinition)(candidates[0].missionId, candidates[0].row);
        if (mission.eventId !== eventId || mission.stringId !== CONTENTS_GUIDE_START_STRING_ID)
            return null;
        return mission.missionId;
    }
    catch (_a) {
        return null;
    }
}
function startContentsGuideMission(input) {
    const missionId = resolveContentsGuideStartMissionId(input.eventId, input.repository);
    if (missionId === null) {
        return { ok: false, message: "Invalid contents guide event." };
    }
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "mission", playerId: input.playerId, operation: "start_contents_guide_mission",
    }, () => {
        const activeMissions = normalizeActiveMissions((0, mission_1.getPlayerActiveMissionsSync)(input.playerId));
        const questProgress = (0, quest_1.getPlayerQuestProgressSync)(input.playerId);
        if (!(0, active_core_1.isActiveMissionAvailable)(missionId, {
            repository: input.repository,
            now: input.now,
            activeMissions,
            questProgress,
        })) {
            return { ok: false, message: "Contents guide mission is not available." };
        }
        const settlement = (0, active_core_1.settleActiveMissionProgress)(missionId, activeMissions[String(missionId)], 1, { repository: input.repository });
        if (settlement.delta === null)
            return { ok: true, delta: null };
        (0, mission_1.updatePlayerActiveMissionSync)(input.playerId, missionId, settlement.state.progress);
        for (const stage of settlement.delta.stages) {
            (0, mission_1.updatePlayerActiveMissionStageSync)(input.playerId, stage.stage, missionId, false);
        }
        return { ok: true, delta: settlement.delta };
    });
}
exports.startContentsGuideMission = startContentsGuideMission;
