"use strict";
// Pattern → mission_id reverse index (for update_mission_progress)
Object.defineProperty(exports, "__esModule", { value: true });
exports.isComputablePattern = exports.isMissionEnabledAt = exports.getMissionDefinition = exports.getMissionPattern = exports.getMissionsByPattern = void 0;
const master_data_1 = require("./master-data");
const patternIndex = {};
const missionPatternLookup = {};
const missionDefinitionLookup = {};
function indexPatterns(category) {
    for (const definition of (0, master_data_1.getMissionMasterDefinitions)(category)) {
        const { missionId, pattern, row } = definition;
        missionDefinitionLookup[`${category}_${missionId}`] = [...row];
        if (!patternIndex[pattern])
            patternIndex[pattern] = [];
        patternIndex[pattern].push({ missionId, category });
        missionPatternLookup[`${category}_${missionId}`] = pattern;
    }
}
for (const category of master_data_1.MISSION_CATEGORIES)
    indexPatterns(category);
function getMissionsByPattern(pattern) {
    return patternIndex[pattern] || [];
}
exports.getMissionsByPattern = getMissionsByPattern;
function getMissionPattern(category, missionId) {
    return missionPatternLookup[`${category}_${missionId}`] || '';
}
exports.getMissionPattern = getMissionPattern;
function getMissionDefinition(category, missionId) {
    return missionDefinitionLookup[`${category}_${missionId}`];
}
exports.getMissionDefinition = getMissionDefinition;
function isMissionEnabledAt(category, missionId, at, eventId) {
    const definition = (0, master_data_1.getMissionMasterDefinition)(category, missionId);
    if (!definition)
        return false;
    return (0, master_data_1.isMissionDefinitionEnabledAt)(definition, at, eventId);
}
exports.isMissionEnabledAt = isMissionEnabledAt;
function isComputablePattern(pattern) {
    if (!pattern)
        return false;
    if (pattern.startsWith('single_battle_play') || pattern.startsWith('single_battle_clear_count'))
        return true;
    if (pattern.startsWith('used_stamina_count') || pattern.includes('stamina_use'))
        return true;
    return pattern.startsWith('rank_ss') || pattern.startsWith('rank_s') || pattern.startsWith('rank_a') || pattern.startsWith('rank_b');
}
exports.isComputablePattern = isComputablePattern;
