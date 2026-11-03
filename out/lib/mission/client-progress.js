"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveClientProgressTargets = exports.resolveClientProgressTargetsFromDefinitions = exports.isClientProgressMissionPattern = exports.collectClientProgressDeltas = exports.MAX_CLIENT_PROGRESS_DELTA = void 0;
const master_data_1 = require("./master-data");
const CLIENT_REPORTED_PATTERN_PREFIXES = Object.freeze({
    character_detail_zoom_illust_for_1min_count: ["degree_sukimono"],
    character_detail_play_dot_sp_motion_count: ["degree_dot_image_looking"],
    home_tap_town_character_count: ["degree_character_tap"],
    home_change_voice_count: ["degree_voice_change_in_home"],
    twitter_check: ["twitter_check"],
});
exports.MAX_CLIENT_PROGRESS_DELTA = 100;
/** Bound only client UI counters; server-computed mission facts are separate. */
function collectClientProgressDeltas(params) {
    var _a;
    const deltas = new Map();
    if (!Array.isArray(params))
        return deltas;
    for (const param of params) {
        if (!param || typeof param !== "object" || Array.isArray(param))
            continue;
        const { mission_pattern: pattern, progress_value: delta } = param;
        if (typeof pattern !== "string"
            || !Object.prototype.hasOwnProperty.call(CLIENT_REPORTED_PATTERN_PREFIXES, pattern)
            || typeof delta !== "number" || !Number.isSafeInteger(delta) || delta <= 0)
            continue;
        // A repeated pattern must share the same request budget rather than
        // multiplying it. Cap before addition to avoid unsafe integer sums.
        deltas.set(pattern, Math.min(exports.MAX_CLIENT_PROGRESS_DELTA, ((_a = deltas.get(pattern)) !== null && _a !== void 0 ? _a : 0) + Math.min(delta, exports.MAX_CLIENT_PROGRESS_DELTA)));
    }
    return deltas;
}
exports.collectClientProgressDeltas = collectClientProgressDeltas;
function matchesClientPattern(masterPattern, clientPattern) {
    var _a;
    const prefixes = CLIENT_REPORTED_PATTERN_PREFIXES[clientPattern];
    return (_a = prefixes === null || prefixes === void 0 ? void 0 : prefixes.some(prefix => (masterPattern === prefix || masterPattern.startsWith(`${prefix}_`)))) !== null && _a !== void 0 ? _a : false;
}
function isClientProgressMissionPattern(masterPattern) {
    return Object.keys(CLIENT_REPORTED_PATTERN_PREFIXES).some(pattern => matchesClientPattern(masterPattern, pattern));
}
exports.isClientProgressMissionPattern = isClientProgressMissionPattern;
function resolveClientProgressTargetsFromDefinitions(clientPattern, evaluationTime, definitions) {
    if (!Object.prototype.hasOwnProperty.call(CLIENT_REPORTED_PATTERN_PREFIXES, clientPattern))
        return [];
    const targets = [];
    for (const definition of definitions) {
        if (!matchesClientPattern(definition.pattern, clientPattern))
            continue;
        if (definition.eventId !== undefined)
            continue;
        if (!(0, master_data_1.isMissionDefinitionEnabledAt)(definition, evaluationTime))
            continue;
        targets.push({ category: definition.category, missionId: definition.missionId });
    }
    return targets;
}
exports.resolveClientProgressTargetsFromDefinitions = resolveClientProgressTargetsFromDefinitions;
function resolveClientProgressTargets(clientPattern, evaluationTime) {
    const definitions = [];
    for (const category of master_data_1.MISSION_CATEGORIES) {
        definitions.push(...(0, master_data_1.getMissionMasterDefinitions)(category));
    }
    return resolveClientProgressTargetsFromDefinitions(clientPattern, evaluationTime, definitions);
}
exports.resolveClientProgressTargets = resolveClientProgressTargets;
