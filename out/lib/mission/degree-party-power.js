"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordDegreePartyPowerClearSync = exports.getClearedPartyPowerSync = void 0;
const db_1 = require("../../data/db");
const types_1 = require("../../data/types");
const special_event_parties_1 = require("../special-event-parties");
const types_2 = require("../types");
const counters_1 = require("./counters");
function partyCategoryForQuest(questCategory) {
    switch (questCategory) {
        case types_2.QuestCategory.CARNIVAL_EVENT:
            return types_1.PartyCategory.CARNIVAL;
        case types_2.QuestCategory.RAID_EVENT:
            return types_1.PartyCategory.RAID;
        case types_2.QuestCategory.RUSH_EVENT:
            return types_1.PartyCategory.RUSH;
        default:
            return types_1.PartyCategory.NORMAL;
    }
}
function partyIds(values, length) {
    if (!Array.isArray(values))
        return undefined;
    return Array.from({ length }, (_, index) => {
        var _a;
        const value = Number((_a = values[index]) === null || _a === void 0 ? void 0 : _a.id);
        return Number.isSafeInteger(value) && value > 0 ? value : null;
    });
}
function sameIds(actual, expected) {
    return actual.length === expected.length
        && actual.every((value, index) => value === expected[index]);
}
function matchesClearedParty(row, party) {
    const characters = partyIds(party === null || party === void 0 ? void 0 : party.characters, 3);
    if (!characters || !sameIds(characters, [
        row.character_id_1,
        row.character_id_2,
        row.character_id_3,
    ]))
        return false;
    const unisons = partyIds(party === null || party === void 0 ? void 0 : party.unison_characters, 3);
    if (unisons && !sameIds(unisons, [
        row.unison_character_1,
        row.unison_character_2,
        row.unison_character_3,
    ]))
        return false;
    const equipments = partyIds(party === null || party === void 0 ? void 0 : party.equipments, 3);
    if (equipments && !sameIds(equipments, [
        row.equipment_1,
        row.equipment_2,
        row.equipment_3,
    ]))
        return false;
    return true;
}
/** Resolves the client-computed power for the exact party that cleared a quest. */
function getClearedPartyPowerSync(context) {
    var _a;
    const parsedPartyId = (0, special_event_parties_1.parseGlobalPartyId)((_a = context.partySlot) !== null && _a !== void 0 ? _a : context.player.partySlot);
    if (!parsedPartyId)
        return 0;
    const rows = (0, db_1.getDb)().prepare(`
        SELECT category, current_battle_power,
               character_id_1, character_id_2, character_id_3,
               unison_character_1, unison_character_2, unison_character_3,
               equipment_1, equipment_2, equipment_3
        FROM players_parties
        WHERE player_id = ? AND group_id = ? AND slot = ?
    `).all(context.playerId, parsedPartyId.groupId, parsedPartyId.slot);
    const expectedCategory = partyCategoryForQuest(context.questCategory);
    rows.sort((left, right) => (Number(right.category === expectedCategory) - Number(left.category === expectedCategory)));
    const matched = rows.find(row => matchesClearedParty(row, context.party));
    return Math.max(0, Math.trunc(Number(matched === null || matched === void 0 ? void 0 : matched.current_battle_power) || 0));
}
exports.getClearedPartyPowerSync = getClearedPartyPowerSync;
function recordDegreePartyPowerClearSync(context) {
    if (!context.questAccomplished)
        return 0;
    const partyPower = getClearedPartyPowerSync(context);
    if (partyPower <= 0)
        return 0;
    return (0, counters_1.setMissionCounterMaxSync)(context.playerId, {
        dimension: "battle.max_party_power",
        scopeType: "lifetime",
        scopeKey: "all",
        qualifier: {},
    }, partyPower);
}
exports.recordDegreePartyPowerClearSync = recordDegreePartyPowerClearSync;
