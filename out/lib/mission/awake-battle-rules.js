"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBondTokenMissionComplete = exports.getMatchedAwakeRaceMissionIds = exports.getMatchedAwakeDirectBattleMissionIds = exports.getMatchedAwakeQuestPartyMissionIds = exports.mergePartyCoClearRows = exports.getCharacterPairKey = exports.normalizeCharacterPair = exports.AWAKE_DIRECT_BATTLE_MISSION_IDS = exports.AWAKE_RACE_MISSION_KEYS = exports.AWAKE_QUEST_PARTY_MISSION_IDS = exports.BARAK_AWAKE_PRACTICE_QUEST_ID = void 0;
const race_utils_1 = require("../quest/finish/race-utils");
// CharacterAwakeMissionValues parses mission 1310052's quest_kind=Practice
// from row[12]. The CN master row contains "25" there; 96 was an earlier
// mistaken interpretation and does not match the quest ID sent at settlement.
exports.BARAK_AWAKE_PRACTICE_QUEST_ID = 25;
const QUEST_PARTY_RULES = Object.freeze([
    {
        // Current CN client route for 寄居蟹船长 地狱级.
        missionId: 2310013,
        category: 21,
        questIds: [1006],
        requiredCharacterIds: [231001],
        singleOnly: false,
        leaderCharacterId: 231001,
        maxClearTimeMs: 90000,
    },
    {
        // Legacy/private-server route retained for old clients and saves.
        missionId: 2310013,
        category: 2,
        questIds: [1010004],
        requiredCharacterIds: [231001],
        singleOnly: false,
        leaderCharacterId: 231001,
        maxClearTimeMs: 90000,
    },
    {
        missionId: 1510062,
        requiredCharacterIds: [151006, 263002],
        singleOnly: false,
        leaderCharacterId: 151006,
    },
    {
        missionId: 3310032,
        category: 15,
        questIds: [5],
        requiredCharacterIds: [331003, 1],
        singleOnly: true,
    },
    {
        missionId: 3310033,
        category: 2,
        questIds: [1010004],
        requiredCharacterIds: [331003, 10],
        singleOnly: true,
    },
]);
const QUEST_RANGE_RULES = Object.freeze([
    {
        missionId: 3210132,
        categories: [6, 13, 14, 20],
        requiredCharacterId: 321013,
        singleOnly: true,
    },
    {
        missionId: 3210133,
        categories: [13],
        questIds: [2001, 2002, 2003, 2004, 2005, 2006],
        requiredCharacterId: 321013,
        singleOnly: true,
    },
    {
        missionId: 3410012,
        categories: [6, 13, 14, 20],
        requiredCharacterId: 341001,
        singleOnly: true,
    },
    {
        missionId: 3410013,
        categories: [13],
        questIds: [1040],
        requiredCharacterId: 341001,
        singleOnly: true,
    },
]);
const NO_DEATH_RULES = Object.freeze([
    { missionId: 1610022, leaderCharacterId: 161002 },
    { missionId: 2610072, leaderCharacterId: 261007 },
]);
const EXACT_QUEST_RULES = Object.freeze([
    {
        // 巴拉克作为队长，通关“结实假人·水”。
        // This must be recorded from the successful battle event itself: the
        // generic quest-progress row only retains the most recent leader and
        // can otherwise erase an earlier valid clear.
        missionId: 1310052,
        category: 15,
        questIds: [exports.BARAK_AWAKE_PRACTICE_QUEST_ID],
        leaderCharacterId: 131005,
        singleOnly: true,
    },
]);
exports.AWAKE_QUEST_PARTY_MISSION_IDS = new Set(QUEST_PARTY_RULES.map(rule => rule.missionId));
exports.AWAKE_RACE_MISSION_KEYS = new Map([
    [2310012, (0, race_utils_1.getRaceKeyString)(["Human", "Dragon", "Devil"])],
]);
exports.AWAKE_DIRECT_BATTLE_MISSION_IDS = new Set([
    ...exports.AWAKE_QUEST_PARTY_MISSION_IDS,
    ...exports.AWAKE_RACE_MISSION_KEYS.keys(),
    ...QUEST_RANGE_RULES.map(rule => rule.missionId),
    ...NO_DEATH_RULES.map(rule => rule.missionId),
    ...EXACT_QUEST_RULES.map(rule => rule.missionId),
]);
function normalizeCharacterPair(a, b) {
    return a <= b ? [a, b] : [b, a];
}
exports.normalizeCharacterPair = normalizeCharacterPair;
function getCharacterPairKey(a, b) {
    const [first, second] = normalizeCharacterPair(a, b);
    return `${first}_${second}`;
}
exports.getCharacterPairKey = getCharacterPairKey;
function mergePartyCoClearRows(rows) {
    var _a;
    const result = new Map();
    for (const row of rows) {
        const key = getCharacterPairKey(row.char_id_a, row.char_id_b);
        result.set(key, ((_a = result.get(key)) !== null && _a !== void 0 ? _a : 0) + row.co_clear_count);
    }
    return result;
}
exports.mergePartyCoClearRows = mergePartyCoClearRows;
function getMatchedAwakeQuestPartyMissionIds(ctx) {
    const partyCharacterIds = new Set();
    for (const character of [...ctx.party.characters, ...ctx.party.unison_characters]) {
        if (character === null || character === void 0 ? void 0 : character.id)
            partyCharacterIds.add(character.id);
    }
    return QUEST_PARTY_RULES
        .filter(rule => rule.category === undefined || rule.category === ctx.questCategory)
        .filter(rule => rule.questIds === undefined || rule.questIds.includes(ctx.questId))
        .filter(rule => !rule.singleOnly || !ctx.isMulti)
        .filter(rule => {
        var _a;
        return rule.leaderCharacterId === undefined
            || ((_a = ctx.party.characters[0]) === null || _a === void 0 ? void 0 : _a.id) === rule.leaderCharacterId;
    })
        .filter(rule => rule.maxClearTimeMs === undefined
        || (ctx.questAccomplished !== false
            && Number.isFinite(ctx.clearTime)
            && ctx.clearTime <= rule.maxClearTimeMs))
        .filter(rule => rule.requiredCharacterIds.every(id => partyCharacterIds.has(id)))
        .map(rule => rule.missionId);
}
exports.getMatchedAwakeQuestPartyMissionIds = getMatchedAwakeQuestPartyMissionIds;
function getMatchedAwakeDirectBattleMissionIds(ctx, raceKey) {
    const matched = [
        ...getMatchedAwakeRaceMissionIds(ctx, raceKey),
        ...getMatchedAwakeQuestPartyMissionIds(ctx),
    ];
    const partyCharacterIds = new Set();
    for (const character of [...ctx.party.characters, ...ctx.party.unison_characters]) {
        if (character === null || character === void 0 ? void 0 : character.id)
            partyCharacterIds.add(character.id);
    }
    for (const rule of QUEST_RANGE_RULES) {
        if (!rule.categories.includes(ctx.questCategory))
            continue;
        if (rule.questIds && !rule.questIds.includes(ctx.questId))
            continue;
        if (rule.singleOnly && ctx.isMulti === true)
            continue;
        if (partyCharacterIds.has(rule.requiredCharacterId))
            matched.push(rule.missionId);
    }
    const leaderId = getPartyLeaderCharacterId(ctx.party);
    for (const rule of EXACT_QUEST_RULES) {
        if (rule.category !== ctx.questCategory)
            continue;
        if (!rule.questIds.includes(ctx.questId))
            continue;
        if (rule.singleOnly && ctx.isMulti === true)
            continue;
        if (leaderId !== rule.leaderCharacterId)
            continue;
        matched.push(rule.missionId);
    }
    const totalEncoffinCount = getTotalEncoffinCount(ctx.statistics);
    if (totalEncoffinCount === 0) {
        for (const rule of NO_DEATH_RULES) {
            if (leaderId === rule.leaderCharacterId)
                matched.push(rule.missionId);
        }
    }
    return [...new Set(matched)];
}
exports.getMatchedAwakeDirectBattleMissionIds = getMatchedAwakeDirectBattleMissionIds;
/** Accept the payload locations used by old and new clients. */
function getBattleZones(statistics) {
    var _a, _b;
    if (!statistics || typeof statistics !== "object")
        return undefined;
    const value = statistics;
    for (const candidate of [
        value.zones,
        (_a = value.quest_statistics) === null || _a === void 0 ? void 0 : _a.zones,
        (_b = value.battle) === null || _b === void 0 ? void 0 : _b.zones,
        value.zone_statistics,
    ]) {
        if (Array.isArray(candidate))
            return candidate;
    }
    return undefined;
}
function getTotalEncoffinCount(statistics) {
    const zones = getBattleZones(statistics);
    if (!Array.isArray(zones) || zones.length === 0)
        return undefined;
    let total = 0;
    for (const zone of zones) {
        if (zone === null || typeof zone !== "object")
            return undefined;
        const record = zone;
        // CN 1.8.1 can omit zero-valued statistics from a zone. An omitted
        // encoffin_count therefore means zero, but an explicitly malformed
        // value must still fail closed.
        if (!Object.prototype.hasOwnProperty.call(record, "encoffin_count"))
            continue;
        const encoffinCount = record.encoffin_count;
        if (!Number.isSafeInteger(encoffinCount) || encoffinCount < 0) {
            return undefined;
        }
        total += encoffinCount;
    }
    return total;
}
/**
 * Some client builds include an explicit leader field while others only send
 * the ordered main-character array. Prefer the explicit value when available,
 * then retain compatibility with the original array representation.
 */
function getPartyLeaderCharacterId(party) {
    var _a, _b;
    for (const value of [
        (_a = party.leader) === null || _a === void 0 ? void 0 : _a.id,
        party.leader_character_id,
        party.leader_id,
        (_b = party.characters[0]) === null || _b === void 0 ? void 0 : _b.id,
    ]) {
        if (Number.isSafeInteger(value) && value > 0)
            return value;
    }
    return undefined;
}
function getMatchedAwakeRaceMissionIds(ctx, raceKey) {
    var _a, _b;
    const leaderId = (_a = ctx.party.characters[0]) === null || _a === void 0 ? void 0 : _a.id;
    if (leaderId !== 231001)
        return [];
    const actualRaces = new Set(raceKey.split("+").filter(Boolean));
    const requiredRaces = ((_b = exports.AWAKE_RACE_MISSION_KEYS.get(2310012)) !== null && _b !== void 0 ? _b : "")
        .split("+")
        .filter(Boolean);
    return requiredRaces.every(race => actualRaces.has(race)) ? [2310012] : [];
}
exports.getMatchedAwakeRaceMissionIds = getMatchedAwakeRaceMissionIds;
function isBondTokenMissionComplete(bondTokens) {
    return bondTokens !== undefined
        && bondTokens.length > 0
        && bondTokens.every(bondToken => bondToken.status >= 2);
}
exports.isBondTokenMissionComplete = isBondTokenMissionComplete;
