"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRushEventEndlessBattleRankPlayedPartyListSync = exports.getPlayerRushEventEndlessBattleRankingSync = exports.getSerializedPlayerRushEventPlayedPartiesSync = void 0;
const public_payload_1 = require("./weapon-riven/public-payload");
const types_1 = require("../data/types");
const rushEvent_1 = require("../data/domains/rushEvent");
const party_1 = require("../data/domains/party");
const player_1 = require("../data/domains/player");
const character_1 = require("./character");
const mode15_optional_1 = require("./mode15-optional");
const assets_1 = require("./assets");
const rush_party_categories_1 = require("./rush-party-categories");
function clearSerializedPlayedPartyMembers(party) {
    party.character_id_1 = party.character_id_2 = party.character_id_3 = null;
    party.unison_character_id_1 = party.unison_character_id_2 = party.unison_character_id_3 = null;
    party.evolution_img_level_1 = party.evolution_img_level_2 = party.evolution_img_level_3 = null;
    party.unison_evolution_img_level_1 = party.unison_evolution_img_level_2 = party.unison_evolution_img_level_3 = null;
}
function getMode15LegacyPartyFallbackSync(playerId, eventId) {
    const categories = [
        (0, rush_party_categories_1.partyCategoryForRushEvent)(eventId),
        types_1.PartyCategory.RUSH,
        types_1.PartyCategory.NORMAL,
    ].filter((category, index, all) => all.indexOf(category) === index);
    for (const category of categories) {
        const groups = (0, party_1.getPlayerPartyGroupListSync)(playerId, category);
        for (const group of Object.values(groups)) {
            for (const party of Object.values(group.list)) {
                if (!party.characterIds.some(id => id !== null))
                    continue;
                return {
                    characterIds: [...party.characterIds],
                    unisonCharacterIds: [...party.unisonCharacterIds],
                    equipmentIds: [...party.equipmentIds],
                    abilitySoulIds: [...party.abilitySoulIds],
                    evolutionImgLevels: (0, character_1.getCharactersEvolutionImgLevels)(playerId, party.characterIds),
                    unisonEvolutionImgLevels: (0, character_1.getCharactersEvolutionImgLevels)(playerId, party.unisonCharacterIds),
                };
            }
        }
    }
    return null;
}
/**
 * Gets all of a player's played parties, serializes them into client formant, and organizes them by their RushEventBattleType.
 *
 * @param playerId The ID of the player.
 * @param eventId The ID of the rush event.
 * @returns The serialized parties organized by type.
 */
function getSerializedPlayerRushEventPlayedPartiesSync(playerId, eventId) {
    var _a;
    // get played parties
    const playedParties = (0, rushEvent_1.getPlayerRushEventPlayedPartiesSync)(playerId, eventId);
    // convert played parties to the expected client format
    const rushBattlePlayedPartyList = {};
    const endlessBattlePlayedPartyList = {};
    let mode15LegacyFallback;
    for (const storedParty of playedParties) {
        let party = storedParty;
        if (eventId === mode15_optional_1.MODE15_RUSH_EVENT_ID
            && !party.characterIds.some(id => id !== null)) {
            mode15LegacyFallback !== null && mode15LegacyFallback !== void 0 ? mode15LegacyFallback : (mode15LegacyFallback = getMode15LegacyPartyFallbackSync(playerId, eventId));
            if (mode15LegacyFallback === null) {
                // Omitting an invalid legacy marker lets the user replay the
                // boundary floor. Sending character id 0 crashes the client.
                continue;
            }
            party = Object.assign(Object.assign({}, party), mode15LegacyFallback);
        }
        const record = party.battleType === types_1.RushEventBattleType.FOLDER ? rushBattlePlayedPartyList : endlessBattlePlayedPartyList;
        const serializedParty = (0, rushEvent_1.serializePlayerRushEventPlayedParty)(party);
        if ((0, mode15_optional_1.shouldUnlockMode15PlayedParties)(eventId)
            || (0, mode15_optional_1.shouldUnlockMode15MultiplayerPlayedParty)(eventId, party.round)) {
            clearSerializedPlayedPartyMembers(serializedParty);
        }
        record[party.round] = serializedParty;
    }
    // Deep Abyss keeps the round markers (so the next floor advances) but
    // deliberately clears member ids.  This mirrors the upstream roguelike
    // behavior and lets the same party participate in later rounds.
    if (((_a = (0, assets_1.getRogueEventConfig)(eventId)) === null || _a === void 0 ? void 0 : _a.unlock_played_parties) === true) {
        for (const record of [rushBattlePlayedPartyList, endlessBattlePlayedPartyList]) {
            for (const party of Object.values(record)) {
                clearSerializedPlayedPartyMembers(party);
            }
        }
    }
    // return parties
    return {
        folderParties: rushBattlePlayedPartyList,
        endlessParties: endlessBattlePlayedPartyList
    };
}
exports.getSerializedPlayerRushEventPlayedPartiesSync = getSerializedPlayerRushEventPlayedPartiesSync;
/**
 * Converts player data & rush event data into the format that the client expects for rush event endless battle rankings.
 *
 * @param playerId The ID of the player.
 * @param eventId The ID of the rush event.
 * @param playerData Existing data to use instead of fetching brand new data.
 * @returns A UserRushEventEndlessBattleRanking object or null.
 */
function getPlayerRushEventEndlessBattleRankingSync(playerId, eventId, useData) {
    var _a, _b;
    const playerData = (useData === null || useData === void 0 ? void 0 : useData.playerData) === undefined ? (0, player_1.getPlayerSync)(playerId) : useData === null || useData === void 0 ? void 0 : useData.playerData;
    if (playerData === null)
        return null;
    const rushEventData = (useData === null || useData === void 0 ? void 0 : useData.rushEventData) === undefined ? (0, rushEvent_1.getPlayerRushEventSync)(playerId, eventId) : useData === null || useData === void 0 ? void 0 : useData.rushEventData;
    if (rushEventData === null)
        return null;
    const bestRound = rushEventData.endlessBattleMaxRound;
    const bestTime = rushEventData.endlessBattleMaxRoundTime;
    const endlessCharacterIds = rushEventData.endlessBattleMaxRoundCharacterIds;
    const endlessCharacterEvolutionImgLevel = rushEventData.endlessBattleMaxRoundCharacterEvolutionImgLvls;
    if (bestRound === null || bestTime === null || endlessCharacterIds === null || endlessCharacterEvolutionImgLevel === null)
        return null;
    // build party member list
    const partyMemberList = [];
    for (let n = 0; n < endlessCharacterIds.length; n++) {
        const characterId = endlessCharacterIds[n];
        if (characterId !== null) {
            partyMemberList.push({
                character_id: characterId,
                evolution_img_level: (_a = endlessCharacterEvolutionImgLevel[n]) !== null && _a !== void 0 ? _a : 0
            });
        }
    }
    return {
        best_round: bestRound,
        elapsed_time_ms: bestTime,
        name: playerData.name,
        party_member_list: partyMemberList,
        rank_number: (_b = useData === null || useData === void 0 ? void 0 : useData.rankNumber) !== null && _b !== void 0 ? _b : 0,
        user_rank: 215
    };
}
exports.getPlayerRushEventEndlessBattleRankingSync = getPlayerRushEventEndlessBattleRankingSync;
/**
 * Gets the played party list for the player currently at a rank in an endless battle leaderboard for a rush event.
 *
 * @param rank The rank of the player.
 * @param eventId The ID of the rush event.
 * @returns A serialized player rush event played party list or null.
 */
function getRushEventEndlessBattleRankPlayedPartyListSync(rank, eventId) {
    // Get the ID of the player who is currently at rank [rank].
    const playerId = (0, rushEvent_1.getPlayerIdFromRushEventEndlessRankSync)(rank, eventId);
    if (playerId === null)
        return null;
    // get the played party list
    const parties = getSerializedPlayerRushEventPlayedPartiesSync(playerId, eventId);
    return (0, public_payload_1.stripWeaponRivenPublicPayload)(parties.endlessParties);
}
exports.getRushEventEndlessBattleRankPlayedPartyListSync = getRushEventEndlessBattleRankPlayedPartyListSync;
