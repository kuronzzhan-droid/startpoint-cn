"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PassComputer = void 0;
const master_data_1 = require("./master-data");
const computer_regular_1 = require("./computer-regular");
const pass_card_1 = require("../../data/domains/pass-card");
const snapshot_1 = require("./snapshot");
function periodValue(current, baseline) {
    return Math.max(0, current - (baseline !== null && baseline !== void 0 ? baseline : 0));
}
function computePeriodicPassProgress(patternType, context, dbProgress) {
    var _a, _b;
    const counters = context.battleCounters;
    const snapshot = context.snapshot;
    if (!counters)
        return dbProgress;
    switch (patternType) {
        case 14:
            return Math.max(dbProgress, periodValue(counters.singleClearCount, snapshot === null || snapshot === void 0 ? void 0 : snapshot.singleClearCount));
        case 16:
            return Math.max(dbProgress, periodValue(counters.multiClearCount, snapshot === null || snapshot === void 0 ? void 0 : snapshot.multiClearCount));
        case 28:
            return Math.max(dbProgress, periodValue((_a = context.player.totalDashes) !== null && _a !== void 0 ? _a : 0, snapshot === null || snapshot === void 0 ? void 0 : snapshot.dashCount));
        case 39:
            return Math.max(dbProgress, periodValue((_b = context.player.totalStaminaUsed) !== null && _b !== void 0 ? _b : 0, snapshot === null || snapshot === void 0 ? void 0 : snapshot.staminaUsed));
        default:
            return dbProgress;
    }
}
exports.PassComputer = {
    name: "Pass",
    buildContext(playerId, category, evaluationTime, missionIds, readContext) {
        var _a, _b;
        const context = computer_regular_1.RegularComputer.buildContext(playerId, category, evaluationTime, missionIds, readContext);
        if (category === 7) {
            const eventId = (_a = (0, master_data_1.getMissionMasterDefinitions)(7).find(definition => definition.eventId !== undefined
                && (0, master_data_1.isMissionDefinitionEnabledAt)(definition, evaluationTime))) === null || _a === void 0 ? void 0 : _a.eventId;
            if (eventId === undefined)
                return context;
            const snapshotType = (0, snapshot_1.getPassWeekSnapshotType)(eventId);
            let snapshot = readContext
                ? readContext.snapshot(snapshotType)
                : (0, snapshot_1.getSnapshot)(playerId, snapshotType);
            if (!snapshot) {
                snapshot = (0, snapshot_1.buildPeriodicSnapshotData)(playerId, context.player, context.totalQuestClears);
                (0, snapshot_1.takeSnapshot)(playerId, snapshotType, snapshot);
                readContext === null || readContext === void 0 ? void 0 : readContext.setSnapshot(snapshotType, snapshot);
            }
            context.snapshot = snapshot;
            return context;
        }
        if (category !== 8)
            return context;
        const loginProgress = {};
        const requestedMissionIds = missionIds === undefined ? undefined : new Set(missionIds);
        for (const definition of (0, master_data_1.getMissionMasterDefinitions)(8)) {
            if (definition.patternType !== 0
                || definition.eventId === undefined
                || (requestedMissionIds !== undefined && !requestedMissionIds.has(definition.missionId))
                || !(0, master_data_1.isMissionDefinitionEnabledAt)(definition, evaluationTime))
                continue;
            loginProgress[definition.missionId] = (0, pass_card_1.ensurePlayerPassCardLoginProgressSync)(playerId, definition.eventId, (_b = context.player.totalLoginDays) !== null && _b !== void 0 ? _b : 0);
        }
        context.passEventLoginProgress = loginProgress;
        return context;
    },
    compute(missionId, context, dbProgress) {
        var _a, _b;
        const definition = (0, master_data_1.getMissionMasterDefinition)(context.category, missionId);
        if (!definition)
            return dbProgress;
        if (context.category === 6 || context.category === 7) {
            return computePeriodicPassProgress(definition.patternType, context, dbProgress);
        }
        if (context.category === 8 && definition.patternType === 0) {
            return Math.max(dbProgress, (_b = (_a = context.passEventLoginProgress) === null || _a === void 0 ? void 0 : _a[missionId]) !== null && _b !== void 0 ? _b : 0);
        }
        return dbProgress;
    },
};
