"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordEventMissionBattleFacts = exports.getExactEventBattleRuleCoverage = exports.loadExactEventBattleRules = void 0;
const mission_1 = require("../../data/domains/mission");
const master_data_1 = require("./master-data");
const mission_event_battle_rules_json_1 = __importDefault(require("../../../assets/mission_event_battle_rules.json"));
const boss_battle_quest_json_1 = __importDefault(require("../../../assets/boss_battle_quest.json"));
const advent_event_quest_json_1 = __importDefault(require("../../../assets/advent_event_quest.json"));
const world_story_event_boss_battle_quest_json_1 = __importDefault(require("../../../assets/world_story_event_boss_battle_quest.json"));
const TOP_LEVEL_FIELDS = new Set(["schemaVersion", "rules"]);
const RULE_FIELDS = new Set([
    "missionId",
    "patternType",
    "role",
    "categories",
    "selector",
    "questIds",
    "rank",
    "compatibility",
]);
function isPlainRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function hasOnlyFields(value, fields) {
    const keys = Object.keys(value);
    return keys.length === fields.size && keys.every(key => fields.has(key));
}
function isStrictPositiveIntegerList(value) {
    if (!Array.isArray(value) || value.length === 0)
        return false;
    return value.every((entry, index) => (Number.isSafeInteger(entry)
        && entry > 0
        && (index === 0 || entry > value[index - 1])));
}
function isKnownKeyQuery(value) {
    if (!isPlainRecord(value))
        return false;
    const query = value;
    if (query.kind === "All")
        return Object.keys(query).length === 1;
    return query.kind === "Within"
        && Object.keys(query).length === 2
        && isStrictPositiveIntegerList(query.values);
}
function isKnownSelector(value) {
    if (!isPlainRecord(value))
        return false;
    const selector = value;
    if (Object.keys(selector).length !== 2 || !Array.isArray(selector.keys))
        return false;
    const keyCountByRange = {
        All: 0,
        BossBattle: 3,
        AdventEvent: 2,
        WorldStoryEventBossBattle: 2,
    };
    if (typeof selector.range !== "string")
        return false;
    const expectedKeyCount = keyCountByRange[selector.range];
    return expectedKeyCount !== undefined
        && selector.keys.length === expectedKeyCount
        && selector.keys.every(isKnownKeyQuery);
}
function parseMasterQuery(value, single = false) {
    if (value === "(None)")
        return { kind: "All" };
    const entries = value === "" ? [] : String(value).split(",");
    if (single && entries.length > 1)
        return null;
    const values = entries.map(entry => Number(entry));
    if (values.some(entry => !Number.isSafeInteger(entry) || entry <= 0))
        return null;
    return { kind: "Within", values };
}
function selectorFromDefinition(row) {
    const questKind = String(row[7]);
    if (questKind === "(None)")
        return { range: "All", keys: [] };
    const rangeByQuestKind = {
        "2": "BossBattle",
        "5": "AdventEvent",
        "10": "WorldStoryEventBossBattle",
    };
    const range = rangeByQuestKind[questKind];
    if (!range)
        return null;
    const keys = range === "BossBattle"
        ? [parseMasterQuery(row[8]), parseMasterQuery(row[9]), parseMasterQuery(row[10])]
        : [parseMasterQuery(row[8], true), parseMasterQuery(row[10])];
    if (keys.some(query => query === null))
        return null;
    return { range, keys: keys };
}
function selectorsEqual(left, right) {
    if (left.range !== right.range || left.keys.length !== right.keys.length)
        return false;
    return left.keys.every((query, index) => {
        const other = right.keys[index];
        if (query.kind !== other.kind)
            return false;
        if (query.kind === "All")
            return true;
        return query.values.length === other.values.length
            && query.values.every((value, valueIndex) => value === other.values[valueIndex]);
    });
}
function queryMatches(query, value) {
    return query.kind === "All" || query.values.includes(value);
}
function questIdValues(range, questId) {
    if (range === "BossBattle") {
        return [
            Math.trunc(questId / 1000000),
            Math.trunc(questId / 1000) % 1000,
            questId % 1000,
        ];
    }
    if (range === "AdventEvent" || range === "WorldStoryEventBossBattle") {
        return [Math.trunc(questId / 1000), questId % 1000];
    }
    return null;
}
function trackedQuestIds(table) {
    const ids = Object.keys(table).map(key => {
        const id = Number(key);
        return Number.isSafeInteger(id) && id > 0 && String(id) === key ? id : null;
    });
    if (ids.some(id => id === null))
        return null;
    return ids.sort((left, right) => left - right);
}
const TRACKED_QUEST_IDS = {
    BossBattle: trackedQuestIds(boss_battle_quest_json_1.default),
    AdventEvent: trackedQuestIds(advent_event_quest_json_1.default),
    WorldStoryEventBossBattle: trackedQuestIds(world_story_event_boss_battle_quest_json_1.default),
};
function hasMatchingRangeData(selector, categories, questIds) {
    if (selector.range === "All") {
        return categories === "all" && questIds === "all" && selector.keys.length === 0;
    }
    const categoryByRange = {
        BossBattle: 2,
        AdventEvent: 7,
        WorldStoryEventBossBattle: 19,
    };
    if (!isStrictPositiveIntegerList(categories)
        || categories.length !== 1
        || categories[0] !== categoryByRange[selector.range]
        || !isStrictPositiveIntegerList(questIds))
        return false;
    const sourceQuestIds = TRACKED_QUEST_IDS[selector.range];
    if (sourceQuestIds === null)
        return false;
    const expectedQuestIds = sourceQuestIds.filter(questId => {
        const values = questIdValues(selector.range, questId);
        return values !== null
            && values.length === selector.keys.length
            && values.every((value, index) => queryMatches(selector.keys[index], value));
    });
    return questIds.length === expectedQuestIds.length
        && questIds.every((questId, index) => questId === expectedQuestIds[index]);
}
function hasMatchingRole(patternType, role) {
    return patternType === 16 && role === "any"
        || patternType === 17 && role === "host"
        || patternType === 18 && role === "guest";
}
function loadExactEventBattleRules(assetValue) {
    if (!isPlainRecord(assetValue)
        || !hasOnlyFields(assetValue, TOP_LEVEL_FIELDS)
        || assetValue.schemaVersion !== 1
        || !Array.isArray(assetValue.rules))
        return [];
    const rawRules = assetValue.rules;
    const missionIds = new Set();
    for (const value of rawRules) {
        if (!isPlainRecord(value))
            continue;
        const missionId = value.missionId;
        if (!Number.isSafeInteger(missionId) || missionId <= 0)
            continue;
        if (missionIds.has(missionId))
            return [];
        missionIds.add(missionId);
    }
    const definitions = new Map((0, master_data_1.getMissionMasterDefinitions)(3).map(definition => [definition.missionId, definition]));
    const rules = [];
    for (const value of rawRules) {
        if (!isPlainRecord(value) || !hasOnlyFields(value, RULE_FIELDS))
            continue;
        const raw = value;
        if (!Number.isSafeInteger(raw.missionId)
            || raw.missionId <= 0
            || !Number.isSafeInteger(raw.patternType))
            continue;
        const missionId = raw.missionId;
        const patternType = raw.patternType;
        if (!hasMatchingRole(patternType, raw.role))
            continue;
        if (raw.compatibility !== null || raw.rank !== null || !isKnownSelector(raw.selector))
            continue;
        if (!hasMatchingRangeData(raw.selector, raw.categories, raw.questIds))
            continue;
        const definition = definitions.get(missionId);
        if (!definition
            || Number(definition.row[2]) !== patternType
            || definition.row[11] !== "(None)")
            continue;
        const masterSelector = selectorFromDefinition(definition.row);
        if (masterSelector === null || !selectorsEqual(raw.selector, masterSelector))
            continue;
        rules.push({
            missionId,
            patternType: patternType,
            role: raw.role,
            categories: raw.categories === "all" ? "all" : new Set(raw.categories),
            questIds: raw.questIds === "all" ? "all" : new Set(raw.questIds),
            definition,
        });
    }
    return Object.freeze(rules);
}
exports.loadExactEventBattleRules = loadExactEventBattleRules;
const exactMultiRules = loadExactEventBattleRules(mission_event_battle_rules_json_1.default);
function matchesRole(role, isMultiHost) {
    if (role === "any")
        return true;
    if (role === "host")
        return isMultiHost === true;
    if (role === "guest")
        return isMultiHost === false;
    return false;
}
function getExactEventBattleRuleCoverage() {
    const roles = exactMultiRules.reduce((counts, rule) => {
        counts[rule.role]++;
        return counts;
    }, { any: 0, host: 0, guest: 0 });
    return {
        totalEventMissions: (0, master_data_1.getMissionMasterDefinitions)(3).length,
        exactMultiRules: exactMultiRules.length,
        roles,
    };
}
exports.getExactEventBattleRuleCoverage = getExactEventBattleRuleCoverage;
function recordEventMissionBattleFacts(ctx, evaluationTime) {
    if (!ctx.questAccomplished || ctx.isMulti !== true)
        return [];
    const matchedMissionIds = [];
    for (const rule of exactMultiRules) {
        if (!matchesRole(rule.role, ctx.isMultiHost))
            continue;
        if (rule.categories !== "all" && !rule.categories.has(ctx.questCategory))
            continue;
        if (rule.questIds !== "all" && !rule.questIds.has(ctx.questId))
            continue;
        if (!(0, master_data_1.isMissionDefinitionEnabledAt)(rule.definition, evaluationTime))
            continue;
        (0, mission_1.incrementPlayerCategoryMissionSync)(ctx.playerId, 3, rule.missionId, 1);
        matchedMissionIds.push(rule.missionId);
    }
    return matchedMissionIds;
}
exports.recordEventMissionBattleFacts = recordEventMissionBattleFacts;
