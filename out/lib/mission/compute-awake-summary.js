"use strict";
// Compute awake mission summary for /load response
// Returns active_mission_list (Array format for data.active_mission_list)
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeAwakeSummary = void 0;
const mission_1 = require("../../data/domains/mission");
const character_1 = require("../../data/domains/character");
const character_awake_1 = require("../../data/domains/character_awake");
const stages_1 = require("./stages");
const character_queries_1 = require("./character-queries");
const computer_awake_1 = require("./computer-awake");
const awakeMissionIds = Object.freeze((0, stages_1.getMissionIdsByCategory)(9));
const awakeMissionIdsByCharacter = new Map();
const awakeStageIdsByMission = new Map();
for (const missionId of awakeMissionIds) {
    const characterId = (0, character_queries_1.getCharacterIdFromMission)(missionId);
    const missionIds = (_a = awakeMissionIdsByCharacter.get(characterId)) !== null && _a !== void 0 ? _a : [];
    awakeMissionIdsByCharacter.set(characterId, Object.freeze([...missionIds, missionId]));
    awakeStageIdsByMission.set(missionId, Object.freeze((0, stages_1.getMissionStageIds)(9, missionId)));
}
function computeAwakeSummary(playerId, snapshot = {}) {
    var _a, _b, _c, _d, _e, _f;
    const activeMissions = (_a = snapshot.activeMissions) !== null && _a !== void 0 ? _a : (0, mission_1.getPlayerCategoryMissionsSync)(playerId, 9);
    const playerChars = (_b = snapshot.characterList) !== null && _b !== void 0 ? _b : (0, character_1.getPlayerCharactersSync)(playerId);
    const ctx = (0, computer_awake_1.buildAwakeContext)(playerId, undefined, {
        player: snapshot.player,
        characterList: playerChars,
        questProgress: snapshot.questProgress,
        persistedMissions: activeMissions,
    });
    const activeMissionList = [];
    const manaBoardAwakeMap = (0, character_awake_1.getPlayerCharacterAwakeUnlocksSync)(playerId);
    for (const [charKId, missionIds] of awakeMissionIdsByCharacter) {
        if (!playerChars[charKId])
            continue;
        for (const missionId of missionIds) {
            const dbProgress = (_d = (_c = activeMissions[String(missionId)]) === null || _c === void 0 ? void 0 : _c.progress) !== null && _d !== void 0 ? _d : 0;
            const progress = computer_awake_1.AwakeComputer.compute(missionId, ctx, dbProgress);
            const allStageIds = (_e = awakeStageIdsByMission.get(missionId)) !== null && _e !== void 0 ? _e : [];
            const persistedStages = (_f = activeMissions[String(missionId)]) === null || _f === void 0 ? void 0 : _f.stages;
            const stages = allStageIds.map(sid => ({
                stage: sid,
                received: !Array.isArray(persistedStages) && (persistedStages === null || persistedStages === void 0 ? void 0 : persistedStages[String(sid)]) === true,
            }));
            activeMissionList.push({
                mission_id: missionId,
                progress_value: progress,
                stages,
            });
        }
    }
    return { activeMissionList, manaBoardAwakeMap };
}
exports.computeAwakeSummary = computeAwakeSummary;
