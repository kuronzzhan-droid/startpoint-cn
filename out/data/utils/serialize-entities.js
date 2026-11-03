"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeRushEvent = exports.serializePartyGroupList = exports.serializeGachaCampaign = exports.serializeBondTokenStatuses = void 0;
const codeMap_1 = require("../codeMap");
/**
 * Serializes a list of PlayerCharacterBondTokens into UserCharacterBondTokenStatuses
 *
 * @param toSerialize
 * @returns
 */
function serializeBondTokenStatuses(toSerialize) {
    return toSerialize.map(bondToken => {
        return {
            mana_board_index: bondToken.manaBoardIndex,
            status: bondToken.status
        };
    });
}
exports.serializeBondTokenStatuses = serializeBondTokenStatuses;
/**
 * Serializes a PlayerGachaCampaign into a UserGachaCampaign.
 *
 * @param campaign
 * @returns
 */
function serializeGachaCampaign(campaign) {
    return {
        gacha_id: campaign.gachaId,
        campaign_id: campaign.campaignId,
        count: campaign.count
    };
}
exports.serializeGachaCampaign = serializeGachaCampaign;
/**
 * Converts a record of PlayerPartyGroup objects into a record of UserPartyGroup objects.
 *
 * @param partyGrouplist
 * @returns
 */
function serializePartyGroupList(partyGrouplist) {
    var _a, _b, _c, _d;
    const serialized = {};
    for (const [groupId, group] of Object.entries(partyGrouplist)) {
        const list = {};
        for (const [slot, party] of Object.entries(group.list)) {
            // Convert per-group slot to CN global PartyId: (groupId - 1) * 10 + slot
            const globalPartyId = (Number(groupId) - 1) * 10 + Number(slot);
            list[globalPartyId] = {
                "name": party.name,
                "character_ids": (_a = party.characterIds) === null || _a === void 0 ? void 0 : _a.map((id) => id != null ? (0, codeMap_1.kIdToBusinessCode)(id) : null),
                "unison_character_ids": (_b = party.unisonCharacterIds) === null || _b === void 0 ? void 0 : _b.map((id) => id != null ? (0, codeMap_1.kIdToBusinessCode)(id) : null),
                "equipment_ids": party.equipmentIds,
                "ability_soul_ids": party.abilitySoulIds,
                "edited": party.edited,
                "options": {
                    "allow_other_players_to_heal_me": party.options.allowOtherPlayersToHealMe
                },
                "current_battle_power": (_c = party.currentBattlePower) !== null && _c !== void 0 ? _c : 0,
                "before_battle_power": (_d = party.beforeBattlePower) !== null && _d !== void 0 ? _d : 0
            };
        }
        serialized[groupId] = {
            "list": list,
            "color_id": group.colorId
        };
    }
    return serialized;
}
exports.serializePartyGroupList = serializePartyGroupList;
/**
 * Serializes a PlayerRushEvent into a UserRushEvent.
 *
 * @param rushEvent The data for the rush event.
 */
function serializeRushEvent(rushEvent) {
    const characterIds = rushEvent.endlessBattleMaxRoundCharacterIds;
    const characterEvolutionImgLevels = rushEvent.endlessBattleMaxRoundCharacterEvolutionImgLvls;
    return {
        active_rush_battle_folder_id: rushEvent.activeRushBattleFolderId,
        endless_battle_max_round: rushEvent.endlessBattleMaxRound,
        endless_battle_max_round_time: rushEvent.endlessBattleMaxRoundTime,
        endless_battle_max_round_character_id_1: (characterIds === null || characterIds === void 0 ? void 0 : characterIds[0]) != null ? (0, codeMap_1.kIdToBusinessCode)(characterIds[0]) : null,
        endless_battle_max_round_character_id_2: (characterIds === null || characterIds === void 0 ? void 0 : characterIds[1]) != null ? (0, codeMap_1.kIdToBusinessCode)(characterIds[1]) : null,
        endless_battle_max_round_character_id_3: (characterIds === null || characterIds === void 0 ? void 0 : characterIds[2]) != null ? (0, codeMap_1.kIdToBusinessCode)(characterIds[2]) : null,
        endless_battle_max_round_character_evolution_img_lvl_1: characterEvolutionImgLevels === null || characterEvolutionImgLevels === void 0 ? void 0 : characterEvolutionImgLevels[0],
        endless_battle_max_round_character_evolution_img_lvl_2: characterEvolutionImgLevels === null || characterEvolutionImgLevels === void 0 ? void 0 : characterEvolutionImgLevels[1],
        endless_battle_max_round_character_evolution_img_lvl_3: characterEvolutionImgLevels === null || characterEvolutionImgLevels === void 0 ? void 0 : characterEvolutionImgLevels[2],
    };
}
exports.serializeRushEvent = serializeRushEvent;
