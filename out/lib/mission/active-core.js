"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.settleActiveMissionProgress = exports.isActiveMissionClaimable = exports.isActiveMissionAvailable = exports.getActiveMissionEventReleasePhase = exports.getActiveMissionRewardStageIds = exports.getParsedActiveMissionEventDefinition = exports.getParsedActiveMissionDefinition = exports.parseActiveMissionEventDefinition = exports.parseActiveMissionDefinition = exports.parseJstDateTime = exports.parseCnMasterDateTime = void 0;
const active_master_data_1 = require("./active-master-data");
const rewards_1 = require("./rewards");
// CN keeps the upstream JST symbol name but initializes its offset to UTC+8.
const CN_MASTER_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;
const NONE_VALUES = new Set([undefined, null, "", "(None)"]);
function parseRequiredInteger(value, field) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed))
        throw new TypeError(`Invalid Active Mission ${field}.`);
    return parsed;
}
function parseOptionalInteger(value, field) {
    return NONE_VALUES.has(value) ? undefined : parseRequiredInteger(value, field);
}
function parseStageReference(missionIdValue, stageValue, field) {
    if (NONE_VALUES.has(missionIdValue))
        return undefined;
    const missionId = parseRequiredInteger(missionIdValue, `${field} mission id`);
    const stage = parseRequiredInteger(stageValue, `${field} stage`);
    if (missionId <= 0 || stage <= 0)
        throw new TypeError(`Invalid Active Mission ${field}.`);
    return { missionId, stage };
}
function parseCnMasterDateTime(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (!match)
        throw new TypeError(`Invalid CN master date time: ${value}`);
    const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    if (year < 1970 || year > 2200
        || month < 1 || month > 12
        || day < 1 || day > 31
        || hour > 23 || minute > 59 || second > 59) {
        throw new TypeError(`Invalid CN master date time: ${value}`);
    }
    const utcWithoutOffset = Date.UTC(year, month - 1, day, hour, minute, second);
    const normalized = new Date(utcWithoutOffset);
    if (normalized.getUTCFullYear() !== year
        || normalized.getUTCMonth() !== month - 1
        || normalized.getUTCDate() !== day
        || normalized.getUTCHours() !== hour
        || normalized.getUTCMinutes() !== minute
        || normalized.getUTCSeconds() !== second) {
        throw new TypeError(`Invalid CN master date time: ${value}`);
    }
    return utcWithoutOffset - CN_MASTER_OFFSET_MILLISECONDS;
}
exports.parseCnMasterDateTime = parseCnMasterDateTime;
exports.parseJstDateTime = parseCnMasterDateTime;
function parseOptionalCnMasterDateTime(value, field) {
    if (NONE_VALUES.has(value))
        return undefined;
    if (typeof value !== "string")
        throw new TypeError(`Invalid Active Mission ${field}.`);
    return parseCnMasterDateTime(value);
}
function parseActiveMissionDefinition(missionId, row) {
    const eventId = parseRequiredInteger(row[0], "event id");
    const phase = parseOptionalInteger(row[1], "phase");
    const stringId = row[3];
    if (typeof stringId !== "string" || stringId.length === 0) {
        throw new TypeError("Invalid Active Mission string id.");
    }
    const need = parseStageReference(row[56], row[57], "need");
    const show = parseStageReference(row[58], row[59], "show");
    const enableStartTime = parseOptionalCnMasterDateTime(row[60], "enable start time");
    const enableEndTime = parseOptionalCnMasterDateTime(row[61], "enable end time");
    const showStartTime = parseOptionalCnMasterDateTime(row[62], "show start time");
    const showEndTime = parseOptionalCnMasterDateTime(row[63], "show end time");
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ missionId,
        eventId }, (phase !== undefined ? { phase } : {})), { stringId }), (need ? { need } : {})), (show ? { show } : {})), (enableStartTime !== undefined ? { enableStartTime } : {})), (enableEndTime !== undefined ? { enableEndTime } : {})), (showStartTime !== undefined ? { showStartTime } : {})), (showEndTime !== undefined ? { showEndTime } : {}));
}
exports.parseActiveMissionDefinition = parseActiveMissionDefinition;
function parseActiveMissionEventDefinition(eventId, row) {
    const maxPhase = parseOptionalInteger(row[3], "event max phase");
    const startTime = parseOptionalCnMasterDateTime(row[14], "event start time");
    if (startTime === undefined)
        throw new TypeError("Invalid Active Mission event start time.");
    const endTime = parseOptionalCnMasterDateTime(row[15], "event end time");
    const needQuestMultipliedId = parseOptionalInteger(row[22], "event prerequisite quest");
    return Object.assign(Object.assign(Object.assign(Object.assign({ eventId, kind: parseRequiredInteger(row[2], "event kind") }, (maxPhase !== undefined ? { maxPhase } : {})), { startTime }), (endTime !== undefined ? { endTime } : {})), (needQuestMultipliedId !== undefined ? { needQuestMultipliedId } : {}));
}
exports.parseActiveMissionEventDefinition = parseActiveMissionEventDefinition;
const bundledMissionParseCache = new Map();
const bundledEventParseCache = new Map();
const repositoryMissionParseCaches = new WeakMap();
const repositoryEventParseCaches = new WeakMap();
function repositoryCache(repository, bundled, caches) {
    if (!repository)
        return bundled;
    const cached = caches.get(repository);
    if (cached)
        return cached;
    const created = new Map();
    caches.set(repository, created);
    return created;
}
function readParsedCacheEntry(entry) {
    if (entry.ok)
        return entry.value;
    throw entry.error;
}
function getParsedActiveMissionDefinition(missionId, repository) {
    const master = (0, active_master_data_1.getActiveMissionMasterDefinition)(missionId, repository);
    if (!master)
        return undefined;
    const cache = repositoryCache(repository, bundledMissionParseCache, repositoryMissionParseCaches);
    const cached = cache.get(missionId);
    if (cached)
        return readParsedCacheEntry(cached);
    let entry;
    try {
        entry = { ok: true, value: parseActiveMissionDefinition(missionId, master.row) };
    }
    catch (error) {
        entry = { ok: false, error };
    }
    cache.set(missionId, entry);
    return readParsedCacheEntry(entry);
}
exports.getParsedActiveMissionDefinition = getParsedActiveMissionDefinition;
function getParsedActiveMissionEventDefinition(eventId, repository) {
    const master = (0, active_master_data_1.getActiveMissionEventMasterDefinition)(eventId, repository);
    if (!master)
        return undefined;
    const cache = repositoryCache(repository, bundledEventParseCache, repositoryEventParseCaches);
    const cached = cache.get(eventId);
    if (cached)
        return readParsedCacheEntry(cached);
    let entry;
    try {
        entry = { ok: true, value: parseActiveMissionEventDefinition(eventId, master.row) };
    }
    catch (error) {
        entry = { ok: false, error };
    }
    cache.set(eventId, entry);
    return readParsedCacheEntry(entry);
}
exports.getParsedActiveMissionEventDefinition = getParsedActiveMissionEventDefinition;
const rewardStageIdsByRepository = new WeakMap();
const missionDefinitionsByEventRepository = new WeakMap();
function getActiveMissionDefinitionsForEvent(eventId, repository) {
    var _a, _b;
    let byEvent = missionDefinitionsByEventRepository.get(repository);
    if (!byEvent) {
        const mutable = new Map();
        for (const definition of (0, active_master_data_1.getActiveMissionMasterDefinitions)(repository)) {
            try {
                const parsed = getParsedActiveMissionDefinition(definition.missionId, repository);
                if (!parsed)
                    continue;
                const eventDefinitions = (_a = mutable.get(parsed.eventId)) !== null && _a !== void 0 ? _a : [];
                eventDefinitions.push(parsed);
                mutable.set(parsed.eventId, eventDefinitions);
            }
            catch (_c) {
                // Malformed master rows remain unavailable, matching the caller's
                // existing fail-closed behavior.
            }
        }
        byEvent = mutable;
        missionDefinitionsByEventRepository.set(repository, byEvent);
    }
    return (_b = byEvent.get(eventId)) !== null && _b !== void 0 ? _b : [];
}
function getActiveMissionRewardStageIds(missionId, repository) {
    let cache = rewardStageIdsByRepository.get(repository);
    if (!cache) {
        cache = new Map();
        rewardStageIdsByRepository.set(repository, cache);
    }
    const cached = cache.get(missionId);
    if (cached)
        return cached;
    const table = repository.table("mission_active_reward.json");
    const stageTable = table[String(missionId)];
    if (!stageTable) {
        cache.set(missionId, []);
        return [];
    }
    const stageIds = Object.keys(stageTable)
        .map(Number)
        .filter(stage => Number.isSafeInteger(stage) && stage > 0)
        .sort((left, right) => left - right);
    cache.set(missionId, stageIds);
    return stageIds;
}
exports.getActiveMissionRewardStageIds = getActiveMissionRewardStageIds;
function isMissionCurrentStageComplete(missionId, state, repository) {
    var _a;
    const stageIds = getActiveMissionRewardStageIds(missionId, repository);
    if (stageIds.length === 0)
        return false;
    const progress = (_a = state === null || state === void 0 ? void 0 : state.progress) !== null && _a !== void 0 ? _a : 0;
    for (const stage of stageIds) {
        const definition = (0, rewards_1.getMissionRewardStageDefinition)(missionId, stage, repository);
        if (!definition || progress < definition.targetProgress)
            return false;
    }
    return true;
}
function getActiveMissionEventReleasePhase(eventId, activeMissions, repository) {
    const event = getParsedActiveMissionEventDefinition(eventId, repository);
    if (!event)
        return 0;
    const maxPhase = event.maxPhase;
    if (maxPhase === undefined || maxPhase <= 0)
        return 0;
    const missions = getActiveMissionDefinitionsForEvent(eventId, repository);
    let releasedPhase = 1;
    for (let phase = 1; phase < maxPhase; phase++) {
        const phaseMissions = missions.filter(mission => mission.phase === phase);
        if (!phaseMissions.every(mission => isMissionCurrentStageComplete(mission.missionId, activeMissions[String(mission.missionId)], repository)))
            break;
        releasedPhase = phase + 1;
    }
    return Math.min(releasedPhase, maxPhase);
}
exports.getActiveMissionEventReleasePhase = getActiveMissionEventReleasePhase;
function isStageReceivedAndComplete(activeMissions, reference, repository) {
    var _a;
    if (!reference)
        return true;
    const state = activeMissions[String(reference.missionId)];
    const definition = (0, rewards_1.getMissionRewardStageDefinition)(reference.missionId, reference.stage, repository);
    return ((_a = state === null || state === void 0 ? void 0 : state.stages) === null || _a === void 0 ? void 0 : _a[String(reference.stage)]) === true
        && definition !== null
        && state.progress >= definition.targetProgress;
}
function isQuestFinished(questProgress, questId) {
    if (questId === undefined)
        return true;
    return Object.entries(questProgress).some(([category, progressList]) => progressList.some(progress => {
        const normalizedQuestId = Number(category) === 4 && progress.questId < 10000000
            ? progress.questId + 10000000
            : progress.questId;
        return normalizedQuestId === questId && progress.finished === true;
    }));
}
function isActiveMissionUsable(missionId, context, period) {
    try {
        const mission = getParsedActiveMissionDefinition(missionId, context.repository);
        if (!mission)
            return false;
        const event = getParsedActiveMissionEventDefinition(mission.eventId, context.repository);
        if (!event)
            return false;
        const now = context.now instanceof Date ? context.now.getTime() : context.now;
        const missionStartTime = period === "enable"
            ? mission.enableStartTime
            : mission.showStartTime;
        const missionEndTime = period === "enable"
            ? mission.enableEndTime
            : mission.showEndTime;
        if (!Number.isFinite(now)
            || now < event.startTime
            || (event.endTime !== undefined && now > event.endTime)
            || !isQuestFinished(context.questProgress, event.needQuestMultipliedId)
            || (missionStartTime !== undefined && now < missionStartTime)
            || (missionEndTime !== undefined && now > missionEndTime)
            || (mission.phase !== undefined && mission.phase > getActiveMissionEventReleasePhase(mission.eventId, context.activeMissions, context.repository))
            || !isStageReceivedAndComplete(context.activeMissions, mission.need, context.repository)
            || !isStageReceivedAndComplete(context.activeMissions, mission.show, context.repository)) {
            return false;
        }
        return true;
    }
    catch (_a) {
        return false;
    }
}
function isActiveMissionAvailable(missionId, context) {
    return isActiveMissionUsable(missionId, context, "enable");
}
exports.isActiveMissionAvailable = isActiveMissionAvailable;
function isActiveMissionClaimable(missionId, context) {
    return isActiveMissionUsable(missionId, context, "show");
}
exports.isActiveMissionClaimable = isActiveMissionClaimable;
function settleActiveMissionProgress(missionId, currentState, authoritativeProgress, options = {}) {
    var _a, _b;
    if (!Number.isFinite(authoritativeProgress) || authoritativeProgress < 0) {
        throw new TypeError("Active Mission absolute progress must be a finite non-negative number.");
    }
    if (!(0, active_master_data_1.getActiveMissionMasterDefinition)(missionId, options.repository)) {
        throw new TypeError(`Unknown Active Mission ${missionId}.`);
    }
    const settledProgress = Math.max((_a = currentState === null || currentState === void 0 ? void 0 : currentState.progress) !== null && _a !== void 0 ? _a : 0, authoritativeProgress);
    const stages = Object.assign({}, ((_b = currentState === null || currentState === void 0 ? void 0 : currentState.stages) !== null && _b !== void 0 ? _b : {}));
    const completedStages = [];
    const stageIds = options.repository
        ? getActiveMissionRewardStageIds(missionId, options.repository)
        : Object.keys(requireBundledRewardStages(missionId)).map(Number).sort((a, b) => a - b);
    for (const stage of stageIds) {
        const stageKey = String(stage);
        if (stages[stageKey] !== undefined)
            continue;
        const definition = (0, rewards_1.getMissionRewardStageDefinition)(missionId, stage, options.repository);
        if (!definition || settledProgress < definition.targetProgress)
            continue;
        if (definition.targetClearSeconds !== undefined
            && (!Number.isFinite(options.clearSeconds)
                || options.clearSeconds === undefined
                || options.clearSeconds > definition.targetClearSeconds))
            continue;
        stages[stageKey] = false;
        completedStages.push({ stage, received: false });
    }
    const changed = (currentState === null || currentState === void 0 ? void 0 : currentState.progress) !== settledProgress || completedStages.length > 0;
    return {
        state: { progress: settledProgress, stages },
        delta: changed ? {
            mission_id: missionId,
            progress_value: settledProgress,
            stages: completedStages,
        } : null,
    };
}
exports.settleActiveMissionProgress = settleActiveMissionProgress;
function requireBundledRewardStages(missionId) {
    const stages = {};
    for (let stage = 1;; stage++) {
        if (!(0, rewards_1.getMissionRewardStageDefinition)(missionId, stage))
            break;
        stages[String(stage)] = true;
    }
    return stages;
}
