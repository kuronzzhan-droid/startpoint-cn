"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveMissionEventMasterDefinition = exports.getActiveMissionEventMasterDefinitions = exports.getActiveMissionMasterDefinitionsByPatterns = exports.getActiveMissionMasterDefinition = exports.getActiveMissionMasterDefinitions = void 0;
const mission_active_json_1 = __importDefault(require("../../../assets/mission_active.json"));
const mission_active_event_json_1 = __importDefault(require("../../../assets/mission_active_event.json"));
function buildDefinitions(table, create) {
    return Object.entries(table).flatMap(([rawId, rawRows]) => {
        const id = Number(rawId);
        if (!Number.isSafeInteger(id)
            || id <= 0
            || String(id) !== rawId
            || !Array.isArray(rawRows)
            || !Array.isArray(rawRows[0]))
            return [];
        return [create(id, rawRows[0])];
    });
}
function getMissionTable(repository) {
    return repository
        ? repository.table("mission_active.json")
        : mission_active_json_1.default;
}
function getEventTable(repository) {
    return repository
        ? repository.table("mission_active_event.json")
        : mission_active_event_json_1.default;
}
function buildMissionDefinitions(repository) {
    return buildDefinitions(getMissionTable(repository), (missionId, row) => ({ missionId, row }));
}
function buildEventDefinitions(repository) {
    return buildDefinitions(getEventTable(repository), (eventId, row) => ({ eventId, row }));
}
const missionDefinitions = buildMissionDefinitions();
const eventDefinitions = buildEventDefinitions();
const missionById = new Map(missionDefinitions.map(definition => [definition.missionId, definition]));
const eventById = new Map(eventDefinitions.map(definition => [definition.eventId, definition]));
const missionDefinitionsByPattern = buildMissionDefinitionsByPattern(missionDefinitions);
const repositoryMissionDefinitions = new WeakMap();
const repositoryEventDefinitions = new WeakMap();
const repositoryMissionById = new WeakMap();
const repositoryEventById = new WeakMap();
const repositoryMissionDefinitionsByPattern = new WeakMap();
function buildMissionDefinitionsByPattern(definitions) {
    var _a;
    const byPattern = new Map();
    for (const definition of definitions) {
        const pattern = Number(definition.row[29]);
        if (!Number.isSafeInteger(pattern) || pattern < 0)
            continue;
        const entries = (_a = byPattern.get(pattern)) !== null && _a !== void 0 ? _a : [];
        entries.push(definition);
        byPattern.set(pattern, entries);
    }
    return byPattern;
}
function cachedMissionDefinitions(repository) {
    const cached = repositoryMissionDefinitions.get(repository);
    if (cached)
        return cached;
    const definitions = buildMissionDefinitions(repository);
    repositoryMissionDefinitions.set(repository, definitions);
    repositoryMissionById.set(repository, new Map(definitions.map(definition => [definition.missionId, definition])));
    repositoryMissionDefinitionsByPattern.set(repository, buildMissionDefinitionsByPattern(definitions));
    return definitions;
}
function cachedEventDefinitions(repository) {
    const cached = repositoryEventDefinitions.get(repository);
    if (cached)
        return cached;
    const definitions = buildEventDefinitions(repository);
    repositoryEventDefinitions.set(repository, definitions);
    repositoryEventById.set(repository, new Map(definitions.map(definition => [definition.eventId, definition])));
    return definitions;
}
function getActiveMissionMasterDefinitions(repository) {
    return repository ? cachedMissionDefinitions(repository) : missionDefinitions;
}
exports.getActiveMissionMasterDefinitions = getActiveMissionMasterDefinitions;
function getActiveMissionMasterDefinition(missionId, repository) {
    var _a;
    if (!repository)
        return missionById.get(missionId);
    cachedMissionDefinitions(repository);
    return (_a = repositoryMissionById.get(repository)) === null || _a === void 0 ? void 0 : _a.get(missionId);
}
exports.getActiveMissionMasterDefinition = getActiveMissionMasterDefinition;
/** Returns only definitions whose condition pattern can be affected by the caller. */
function getActiveMissionMasterDefinitionsByPatterns(patterns, repository) {
    const requested = [...new Set(patterns.filter(pattern => Number.isSafeInteger(pattern) && pattern >= 0))];
    if (requested.length === 0)
        return [];
    let byPattern = missionDefinitionsByPattern;
    if (repository) {
        cachedMissionDefinitions(repository);
        byPattern = repositoryMissionDefinitionsByPattern.get(repository);
    }
    return requested.flatMap(pattern => { var _a; return (_a = byPattern.get(pattern)) !== null && _a !== void 0 ? _a : []; });
}
exports.getActiveMissionMasterDefinitionsByPatterns = getActiveMissionMasterDefinitionsByPatterns;
function getActiveMissionEventMasterDefinitions(repository) {
    return repository ? cachedEventDefinitions(repository) : eventDefinitions;
}
exports.getActiveMissionEventMasterDefinitions = getActiveMissionEventMasterDefinitions;
function getActiveMissionEventMasterDefinition(eventId, repository) {
    var _a;
    if (!repository)
        return eventById.get(eventId);
    cachedEventDefinitions(repository);
    return (_a = repositoryEventById.get(repository)) === null || _a === void 0 ? void 0 : _a.get(eventId);
}
exports.getActiveMissionEventMasterDefinition = getActiveMissionEventMasterDefinition;
