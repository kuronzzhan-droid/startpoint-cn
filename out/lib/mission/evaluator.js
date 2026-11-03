"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateMissionCounterProgress = exports.isFilteredMissionUnsupported = exports.FILTERED_MISSION_UNSUPPORTED_REASON = void 0;
const counters_1 = require("./counters");
exports.FILTERED_MISSION_UNSUPPORTED_REASON = "filtered mission";
function cell(row, index) {
    const value = row === null || row === void 0 ? void 0 : row[index];
    if (value === undefined || value === null || value === "(None)")
        return "";
    return String(value);
}
function isIntrinsicDefinitionCell(kind, index) {
    if (kind === 23)
        return index === 5;
    return kind === 28 && (index === 3 || index === 5);
}
function hasPopulatedFilterCells(definition, kind) {
    for (let index = 3; index <= 24; index++) {
        if (isIntrinsicDefinitionCell(kind, index))
            continue;
        if (cell(definition, index) !== "")
            return true;
    }
    return false;
}
function readCounter(playerId, query, period) {
    return period
        ? (0, counters_1.getMissionCounterDeltaSync)(playerId, period, query)
        : (0, counters_1.getMissionCounterValueSync)(playerId, query);
}
function supported(progress) {
    return { supported: true, progress };
}
function unsupported(reason) {
    return { supported: false, progress: 0, reason };
}
function unsupportedFiltered() {
    return unsupported(exports.FILTERED_MISSION_UNSUPPORTED_REASON);
}
function isFilteredMissionUnsupported(result) {
    return !result.supported && result.reason === exports.FILTERED_MISSION_UNSUPPORTED_REASON;
}
exports.isFilteredMissionUnsupported = isFilteredMissionUnsupported;
function evaluateMissionCounterProgress(input) {
    const kind = parseInt(cell(input.definition, 2));
    const period = input.period;
    const hasFilters = hasPopulatedFilterCells(input.definition, kind);
    if (kind === 14 || input.pattern.startsWith("single_battle_play")) {
        if (hasFilters)
            return unsupportedFiltered();
        return supported(readCounter(input.playerId, {
            dimension: "battle.clear",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: { mode: "single" },
        }, period));
    }
    if (kind === 16 || input.pattern.startsWith("multi_battle_play")) {
        if (hasFilters)
            return unsupportedFiltered();
        return supported(readCounter(input.playerId, {
            dimension: "battle.clear",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: { mode: "multi" },
        }, period));
    }
    if (kind === 23 || input.pattern.startsWith("battle_clear_count")) {
        if (hasFilters)
            return unsupportedFiltered();
        return supported(readCounter(input.playerId, {
            dimension: "battle.clear",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: { mode: "any" },
        }, period));
    }
    if (kind === 28 && input.pattern.startsWith("use_dash")) {
        if (hasFilters)
            return unsupportedFiltered();
        return supported(readCounter(input.playerId, {
            dimension: "battle.stat",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: { kind: "dash" },
        }, period));
    }
    if (kind === 28 && input.pattern.startsWith("use_power_flip")) {
        if (hasFilters)
            return unsupportedFiltered();
        return supported(readCounter(input.playerId, {
            dimension: "battle.stat",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: { kind: "power_flip" },
        }, period));
    }
    if (kind === 28 && input.pattern.startsWith("use_skill")) {
        if (hasFilters)
            return unsupportedFiltered();
        return supported(readCounter(input.playerId, {
            dimension: "battle.stat",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: { kind: "skill" },
        }, period));
    }
    return unsupported(`unsupported mission kind ${Number.isNaN(kind) ? "unknown" : kind}`);
}
exports.evaluateMissionCounterProgress = evaluateMissionCounterProgress;
