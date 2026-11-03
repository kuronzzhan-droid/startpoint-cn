"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBattleHistoryProtocolRecord = exports.BattleHistoryPayloadValidationError = void 0;
const utils_1 = require("../../data/utils");
/** Invalid optional client telemetry; storage and server identity errors are not payload errors. */
class BattleHistoryPayloadValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "BattleHistoryPayloadValidationError";
    }
}
exports.BattleHistoryPayloadValidationError = BattleHistoryPayloadValidationError;
function requiredNonNegativeNumber(value, field, label) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new BattleHistoryPayloadValidationError(`${label} ${field} must be a finite non-negative number`);
    }
    return value;
}
function optionalPositiveInteger(value, field, label) {
    if (value === undefined || value === null)
        return null;
    if (!Number.isSafeInteger(value) || Number(value) <= 0) {
        throw new BattleHistoryPayloadValidationError(`${label} ${field} must be a positive integer or null`);
    }
    return Number(value);
}
function optionalNonNegativeInteger(value, field, label) {
    if (value === undefined || value === null)
        return null;
    if (!Number.isSafeInteger(value) || Number(value) < 0) {
        throw new BattleHistoryPayloadValidationError(`${label} ${field} must be a non-negative integer or null`);
    }
    return Number(value);
}
function sumMemberDamage(zones, memberIndex, label) {
    var _a, _b;
    let found = false;
    let total = 0;
    for (const [zoneIndex, zone] of zones.entries()) {
        const value = (_b = (_a = zone.members) === null || _a === void 0 ? void 0 : _a[memberIndex]) === null || _b === void 0 ? void 0 : _b.origin_damage;
        if (value === undefined || value === null)
            continue;
        total += requiredNonNegativeNumber(value, `statistics.zones[${zoneIndex}].members[${memberIndex}].origin_damage`, label);
        if (!Number.isFinite(total))
            throw new BattleHistoryPayloadValidationError(`${label} member damage overflow`);
        found = true;
    }
    return found ? total : null;
}
function buildBattleHistoryProtocolRecord(input, expectedCategory, label) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    if (input.categoryId !== expectedCategory
        || !Number.isSafeInteger(input.questId) || input.questId <= 0
        || !Number.isSafeInteger(input.finishKind) || input.finishKind < 0
        || !Number.isFinite(input.createdAt.getTime())) {
        throw new Error(`${label} identity is invalid`);
    }
    const elapsedTimeMs = requiredNonNegativeNumber(input.elapsedTimeMs, "elapsed_time_ms", label);
    const score = input.score === null
        ? null
        : requiredNonNegativeNumber(input.score, "score", label);
    const clearRank = optionalNonNegativeInteger(input.clearRank, "clear_rank", label);
    const zones = input.statistics.zones;
    if (!Array.isArray(zones) || zones.length === 0) {
        throw new BattleHistoryPayloadValidationError(`${label} statistics.zones must not be empty`);
    }
    let totalDamage = 0;
    for (const [index, zone] of zones.entries()) {
        if (zone === null || typeof zone !== "object" || Array.isArray(zone)) {
            throw new BattleHistoryPayloadValidationError(`${label} statistics.zones[${index}] must be an object`);
        }
        totalDamage += requiredNonNegativeNumber(zone.damage_deal_total, `statistics.zones[${index}].damage_deal_total`, label);
        if (!Number.isFinite(totalDamage))
            throw new BattleHistoryPayloadValidationError(`${label} total damage overflow`);
    }
    const characters = [0, 1, 2].map(index => {
        var _a, _b;
        return optionalPositiveInteger((_b = (_a = input.party.characters) === null || _a === void 0 ? void 0 : _a[index]) === null || _b === void 0 ? void 0 : _b.id, `character_id_${index + 1}`, label);
    });
    const unisons = [0, 1, 2].map(index => {
        var _a, _b;
        return optionalPositiveInteger((_b = (_a = input.party.unison_characters) === null || _a === void 0 ? void 0 : _a[index]) === null || _b === void 0 ? void 0 : _b.id, `unison_character_id_${index + 1}`, label);
    });
    const equipments = [0, 1, 2].map(index => {
        var _a, _b;
        return optionalPositiveInteger((_b = (_a = input.party.equipments) === null || _a === void 0 ? void 0 : _a[index]) === null || _b === void 0 ? void 0 : _b.id, `equipment${index + 1}_id`, label);
    });
    const abilitySouls = [0, 1, 2].map(index => {
        var _a;
        return optionalPositiveInteger((_a = input.party.ability_soul_ids) === null || _a === void 0 ? void 0 : _a[index], `ability_soul_id_${index + 1}`, label);
    });
    const equipmentSnapshots = equipments.map((equipmentId, index) => {
        if (equipmentId === null)
            return null;
        const equipment = input.equipmentList[String(equipmentId)];
        if (!equipment)
            throw new BattleHistoryPayloadValidationError(`${label} equipment${index + 1}_id is not owned`);
        return equipment;
    });
    return {
        ability_soul_id_1: abilitySouls[0],
        ability_soul_id_2: abilitySouls[1],
        ability_soul_id_3: abilitySouls[2],
        category_id: input.categoryId,
        character_1_total_damage: sumMemberDamage(zones, 0, label),
        character_2_total_damage: sumMemberDamage(zones, 1, label),
        character_3_total_damage: sumMemberDamage(zones, 2, label),
        character_id_1: characters[0],
        character_id_2: characters[1],
        character_id_3: characters[2],
        clear_rank: clearRank,
        create_time: (0, utils_1.clientSerializeDate)(input.createdAt),
        elapsed_time_ms: elapsedTimeMs,
        enhancement_level_1: (_b = (_a = equipmentSnapshots[0]) === null || _a === void 0 ? void 0 : _a.enhancementLevel) !== null && _b !== void 0 ? _b : null,
        enhancement_level_2: (_d = (_c = equipmentSnapshots[1]) === null || _c === void 0 ? void 0 : _c.enhancementLevel) !== null && _d !== void 0 ? _d : null,
        enhancement_level_3: (_f = (_e = equipmentSnapshots[2]) === null || _e === void 0 ? void 0 : _e.enhancementLevel) !== null && _f !== void 0 ? _f : null,
        equipment1_id: equipments[0],
        equipment2_id: equipments[1],
        equipment3_id: equipments[2],
        equipment_level_1: (_h = (_g = equipmentSnapshots[0]) === null || _g === void 0 ? void 0 : _g.level) !== null && _h !== void 0 ? _h : null,
        equipment_level_2: (_k = (_j = equipmentSnapshots[1]) === null || _j === void 0 ? void 0 : _j.level) !== null && _k !== void 0 ? _k : null,
        equipment_level_3: (_m = (_l = equipmentSnapshots[2]) === null || _l === void 0 ? void 0 : _l.level) !== null && _m !== void 0 ? _m : null,
        finish_kind: input.finishKind,
        quest_id: input.questId,
        score,
        total_damage: totalDamage,
        unison_character_id_1: unisons[0],
        unison_character_id_2: unisons[1],
        unison_character_id_3: unisons[2],
    };
}
exports.buildBattleHistoryProtocolRecord = buildBattleHistoryProtocolRecord;
