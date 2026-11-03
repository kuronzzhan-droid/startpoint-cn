"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MISSION_CATEGORIES = exports.isMissionDefinitionEnabledAt = exports.getMissionMasterDefinition = exports.getMissionMasterDefinitions = void 0;
const mission_regular_json_1 = __importDefault(require("../../../assets/mission_regular.json"));
const mission_daily_json_1 = __importDefault(require("../../../assets/mission_daily.json"));
const mission_event_json_1 = __importDefault(require("../../../assets/mission_event.json"));
const mission_collect_item_json_1 = __importDefault(require("../../../assets/mission_collect_item.json"));
const mission_degree_json_1 = __importDefault(require("../../../assets/mission_degree.json"));
const mission_weekly_def_json_1 = __importDefault(require("../../../assets/mission_weekly_def.json"));
const mission_pass_daily_json_1 = __importDefault(require("../../../assets/mission_pass_daily.json"));
const mission_pass_week_json_1 = __importDefault(require("../../../assets/mission_pass_week.json"));
const mission_pass_event_json_1 = __importDefault(require("../../../assets/mission_pass_event.json"));
const awake_master_assets_1 = require("./awake-master-assets");
const CATEGORY_LAYOUT = {
    1: { pattern: 0, start: 25, end: 26 },
    2: { pattern: 0, start: 25, end: 26 },
    3: { pattern: 0, start: 25, end: 26 },
    4: { eventId: 0, pattern: 2, start: 27, end: 28, requiresEventScope: true },
    5: { pattern: 1, start: 26, end: 27 },
    6: { eventId: 0, pattern: 1, patternType: 3, start: 26, end: 27 },
    7: { eventId: 0, pattern: 1, patternType: 3, start: 26, end: 27 },
    8: { eventId: 0, pattern: 1, patternType: 3, start: 26, end: 27 },
    9: { pattern: 2, start: 27, end: 28 },
    10: { pattern: 0, start: 25, end: 26 },
};
const TABLE_BY_CATEGORY = {
    1: mission_regular_json_1.default,
    2: mission_daily_json_1.default,
    3: mission_event_json_1.default,
    4: mission_collect_item_json_1.default,
    5: mission_degree_json_1.default,
    6: mission_pass_daily_json_1.default,
    7: mission_pass_week_json_1.default,
    8: mission_pass_event_json_1.default,
    9: awake_master_assets_1.characterAwakeDefinitions,
    10: mission_weekly_def_json_1.default,
};
const definitionCache = new Map();
const definitionIndex = new Map();
const enableTimes = new WeakMap();
function optionalMasterString(value) {
    if (value === undefined || value === null || value === "" || value === "(None)")
        return undefined;
    return String(value);
}
function getFirstRow(value) {
    if (!Array.isArray(value) || !Array.isArray(value[0]))
        return undefined;
    return value[0];
}
function parseMasterCnTime(value) {
    if (value === undefined)
        return undefined;
    return Date.parse(`${value.replace(" ", "T")}+08:00`);
}
function getMissionMasterDefinitions(category) {
    const table = TABLE_BY_CATEGORY[category];
    const layout = CATEGORY_LAYOUT[category];
    if (!table || !layout)
        throw new Error(`unsupported mission category: ${category}`);
    const cached = definitionCache.get(category);
    if (cached)
        return cached;
    const definitions = [];
    for (const [missionIdValue, rows] of Object.entries(table)) {
        const row = getFirstRow(rows);
        if (!row)
            continue;
        const missionId = Number(missionIdValue);
        const pattern = optionalMasterString(row[layout.pattern]);
        if (!Number.isInteger(missionId) || pattern === undefined)
            continue;
        const eventIdValue = layout.eventId === undefined ? undefined : Number(row[layout.eventId]);
        const patternTypeValue = layout.patternType === undefined ? undefined : Number(row[layout.patternType]);
        definitions.push(Object.freeze(Object.assign(Object.assign(Object.assign(Object.assign({ category,
            missionId,
            pattern }, (Number.isInteger(eventIdValue) ? { eventId: eventIdValue } : {})), (Number.isInteger(patternTypeValue) ? { patternType: patternTypeValue } : {})), (layout.requiresEventScope ? { requiresEventScope: true } : {})), { enableStart: optionalMasterString(row[layout.start]), enableEnd: optionalMasterString(row[layout.end]), row })));
    }
    const frozen = Object.freeze(definitions);
    definitionCache.set(category, frozen);
    definitionIndex.set(category, new Map(definitions.map(definition => [definition.missionId, definition])));
    for (const definition of definitions) {
        enableTimes.set(definition, {
            start: parseMasterCnTime(definition.enableStart),
            end: parseMasterCnTime(definition.enableEnd),
        });
    }
    return frozen;
}
exports.getMissionMasterDefinitions = getMissionMasterDefinitions;
function getMissionMasterDefinition(category, missionId) {
    var _a;
    if (!definitionIndex.has(category))
        getMissionMasterDefinitions(category);
    return (_a = definitionIndex.get(category)) === null || _a === void 0 ? void 0 : _a.get(missionId);
}
exports.getMissionMasterDefinition = getMissionMasterDefinition;
function isMissionDefinitionEnabledAt(definition, at, eventId) {
    if (definition.requiresEventScope && definition.eventId !== eventId)
        return false;
    const now = at.getTime();
    // Only repository-owned immutable definitions are cached. Callers can also
    // supply a mutable definition (e.g. a preview), which must reflect edits.
    const times = enableTimes.get(definition);
    const start = times ? times.start : parseMasterCnTime(definition.enableStart);
    const end = times ? times.end : parseMasterCnTime(definition.enableEnd);
    if (!Number.isFinite(now))
        return false;
    if (start !== undefined && (!Number.isFinite(start) || start > now))
        return false;
    if (end !== undefined && (!Number.isFinite(end) || now > end))
        return false;
    return true;
}
exports.isMissionDefinitionEnabledAt = isMissionDefinitionEnabledAt;
exports.MISSION_CATEGORIES = Object.freeze(Object.keys(CATEGORY_LAYOUT).map(Number));
