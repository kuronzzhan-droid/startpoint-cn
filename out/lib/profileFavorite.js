"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFavoritePartyGroupListSync = exports.getFavoritePartySelectionSync = exports.PROFILE_FAVORITE_PARTY_CATEGORY = void 0;
const party_1 = require("../data/domains/party");
const types_1 = require("../data/types");
exports.PROFILE_FAVORITE_PARTY_CATEGORY = 99;
function triplet(values) {
    var _a, _b, _c;
    return [(_a = values === null || values === void 0 ? void 0 : values[0]) !== null && _a !== void 0 ? _a : null, (_b = values === null || values === void 0 ? void 0 : values[1]) !== null && _b !== void 0 ? _b : null, (_c = values === null || values === void 0 ? void 0 : values[2]) !== null && _c !== void 0 ? _c : null];
}
function normalizeParty(party) {
    var _a, _b, _c, _d, _e;
    return {
        characterIds: triplet(party.characterIds),
        unisonCharacterIds: triplet(party.unisonCharacterIds),
        equipmentIds: triplet(party.equipmentIds),
        abilitySoulIds: triplet(party.abilitySoulIds),
        name: party.name || "Party A",
        edited: (_a = party.edited) !== null && _a !== void 0 ? _a : false,
        allowOtherPlayersToHealMe: (_c = (_b = party.options) === null || _b === void 0 ? void 0 : _b.allowOtherPlayersToHealMe) !== null && _c !== void 0 ? _c : true,
        currentBattlePower: (_d = party.currentBattlePower) !== null && _d !== void 0 ? _d : 0,
        beforeBattlePower: (_e = party.beforeBattlePower) !== null && _e !== void 0 ? _e : 0,
    };
}
function firstParty(groups) {
    const groupEntries = Object.entries(groups).sort(([left], [right]) => Number(left) - Number(right));
    for (const [, group] of groupEntries) {
        const partyEntries = Object.entries(group.list || {}).sort(([left], [right]) => Number(left) - Number(right));
        if (partyEntries.length > 0) {
            return normalizeParty(partyEntries[0][1]);
        }
    }
    return null;
}
function getFavoritePartySelectionSync(playerId, fallbackLeaderCharacterId) {
    const favorite = firstParty((0, party_1.getPlayerPartyGroupListSync)(playerId, exports.PROFILE_FAVORITE_PARTY_CATEGORY));
    if (favorite)
        return favorite;
    const normal = firstParty((0, party_1.getPlayerPartyGroupListSync)(playerId, types_1.PartyCategory.NORMAL));
    if (normal)
        return normal;
    return {
        characterIds: [fallbackLeaderCharacterId || 1, null, null],
        unisonCharacterIds: [null, null, null],
        equipmentIds: [null, null, null],
        abilitySoulIds: [null, null, null],
        name: "Party A",
        edited: false,
        allowOtherPlayersToHealMe: true,
        currentBattlePower: 0,
        beforeBattlePower: 0,
    };
}
exports.getFavoritePartySelectionSync = getFavoritePartySelectionSync;
function getFavoritePartyGroupListSync(playerId, fallbackLeaderCharacterId) {
    const favoriteGroups = (0, party_1.getPlayerPartyGroupListSync)(playerId, exports.PROFILE_FAVORITE_PARTY_CATEGORY);
    const serialized = Object.entries(favoriteGroups)
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([groupId, group]) => {
        const partyList = Object.entries(group.list || {})
            .sort(([left], [right]) => Number(left) - Number(right))
            .map(([slot, party]) => {
            const normalized = normalizeParty(party);
            return {
                ability_soul_ids: normalized.abilitySoulIds,
                character_ids: normalized.characterIds,
                equipment_ids: normalized.equipmentIds,
                options: {
                    allow_other_players_to_heal_me: normalized.allowOtherPlayersToHealMe,
                },
                party_edited: normalized.edited,
                party_id: (Number(groupId) - 1) * 10 + Number(slot),
                party_name: normalized.name,
                unison_character_ids: normalized.unisonCharacterIds,
                current_battle_power: normalized.currentBattlePower,
                before_battle_power: normalized.beforeBattlePower,
            };
        });
        return {
            party_group_color_id: group.colorId || 15,
            party_group_id: Number(groupId),
            party_list: partyList,
        };
    })
        .filter(group => group.party_list.length > 0);
    if (serialized.length > 0)
        return serialized;
    const fallback = getFavoritePartySelectionSync(playerId, fallbackLeaderCharacterId);
    return [{
            party_group_color_id: 15,
            party_group_id: 1,
            party_list: [{
                    ability_soul_ids: fallback.abilitySoulIds,
                    character_ids: fallback.characterIds,
                    equipment_ids: fallback.equipmentIds,
                    options: {
                        allow_other_players_to_heal_me: fallback.allowOtherPlayersToHealMe,
                    },
                    party_edited: fallback.edited,
                    party_id: 1,
                    party_name: fallback.name,
                    unison_character_ids: fallback.unisonCharacterIds,
                    current_battle_power: fallback.currentBattlePower,
                    before_battle_power: fallback.beforeBattlePower,
                }],
        }];
}
exports.getFavoritePartyGroupListSync = getFavoritePartyGroupListSync;
