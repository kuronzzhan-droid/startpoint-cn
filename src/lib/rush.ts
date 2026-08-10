import { PartyCategory, Player, PlayerRushEvent, PlayerRushEventPlayedParty, RushEventBattleType, UserRushEventEndlessBattleMyRankingPartyMemberListItem, UserRushEventEndlessBattleRanking, UserRushEventPlayedParty } from "../data/types";
import { getPlayerIdFromRushEventEndlessRankSync, getPlayerRushEventPlayedPartiesSync, getPlayerRushEventSync, serializePlayerRushEventPlayedParty } from "../data/domains/rushEvent"
import { getPlayerPartyGroupListSync } from "../data/domains/party";
import { getPlayerSync } from "../data/domains/player"
import { getCharactersEvolutionImgLevels } from "./character";
import { SerializedPlayerRushEventPlayedPartyList, SerializedPlayerRushEventPlayedParties } from "./types";
import {
    MODE15_RUSH_EVENT_ID,
    shouldUnlockMode15PlayedParties,
    shouldUnlockMode15MultiplayerPlayedParty,
} from "./mode15-optional";
import { getRogueEventConfig } from "./assets";

function clearSerializedPlayedPartyMembers(
    party: UserRushEventPlayedParty,
): void {
    party.character_id_1 = party.character_id_2 = party.character_id_3 = null
    party.unison_character_id_1 = party.unison_character_id_2 = party.unison_character_id_3 = null
    party.evolution_img_level_1 = party.evolution_img_level_2 = party.evolution_img_level_3 = null
    party.unison_evolution_img_level_1 = party.unison_evolution_img_level_2 = party.unison_evolution_img_level_3 = null
}

function getMode15LegacyPartyFallbackSync(
    playerId: number,
): Omit<PlayerRushEventPlayedParty, "round" | "battleType"> | null {
    for (const category of [PartyCategory.RUSH, PartyCategory.NORMAL]) {
        const groups = getPlayerPartyGroupListSync(playerId, category);
        for (const group of Object.values(groups)) {
            for (const party of Object.values(group.list)) {
                if (!party.characterIds.some(id => id !== null)) continue;
                return {
                    characterIds: [...party.characterIds],
                    unisonCharacterIds: [...party.unisonCharacterIds],
                    equipmentIds: [...party.equipmentIds],
                    abilitySoulIds: [...party.abilitySoulIds],
                    evolutionImgLevels: getCharactersEvolutionImgLevels(playerId, party.characterIds),
                    unisonEvolutionImgLevels: getCharactersEvolutionImgLevels(playerId, party.unisonCharacterIds),
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
export function getSerializedPlayerRushEventPlayedPartiesSync(
    playerId: number,
    eventId: number
): SerializedPlayerRushEventPlayedParties {
    // get played parties
    const playedParties = getPlayerRushEventPlayedPartiesSync(playerId, eventId)

    // convert played parties to the expected client format
    const rushBattlePlayedPartyList: SerializedPlayerRushEventPlayedPartyList = {}
    const endlessBattlePlayedPartyList: SerializedPlayerRushEventPlayedPartyList = {}

    let mode15LegacyFallback: ReturnType<typeof getMode15LegacyPartyFallbackSync> | undefined;
    for (const storedParty of playedParties) {
        let party = storedParty;
        if (
            eventId === MODE15_RUSH_EVENT_ID
            && !party.characterIds.some(id => id !== null)
        ) {
            mode15LegacyFallback ??= getMode15LegacyPartyFallbackSync(playerId);
            if (mode15LegacyFallback === null) {
                // Omitting an invalid legacy marker lets the user replay the
                // boundary floor. Sending character id 0 crashes the client.
                continue;
            }
            party = { ...party, ...mode15LegacyFallback };
        }
        const record = party.battleType === RushEventBattleType.FOLDER ? rushBattlePlayedPartyList : endlessBattlePlayedPartyList;
        const serializedParty = serializePlayerRushEventPlayedParty(party)
        if (
            shouldUnlockMode15PlayedParties(eventId)
            || shouldUnlockMode15MultiplayerPlayedParty(eventId, party.round)
        ) {
            clearSerializedPlayedPartyMembers(serializedParty)
        }
        record[party.round] = serializedParty
    }

    // Deep Abyss keeps the round markers (so the next floor advances) but
    // deliberately clears member ids.  This mirrors the upstream roguelike
    // behavior and lets the same party participate in later rounds.
    if (getRogueEventConfig(eventId)?.unlock_played_parties === true) {
        for (const record of [rushBattlePlayedPartyList, endlessBattlePlayedPartyList]) {
            for (const party of Object.values(record)) {
                clearSerializedPlayedPartyMembers(party)
            }
        }
    }

    // return parties
    return {
        folderParties: rushBattlePlayedPartyList,
        endlessParties: endlessBattlePlayedPartyList
    }
}

/**
 * Converts player data & rush event data into the format that the client expects for rush event endless battle rankings.
 * 
 * @param playerId The ID of the player.
 * @param eventId The ID of the rush event.
 * @param playerData Existing data to use instead of fetching brand new data.
 * @returns A UserRushEventEndlessBattleRanking object or null.
 */
export function getPlayerRushEventEndlessBattleRankingSync(
    playerId: number,
    eventId: number,
    useData?: {
        playerData?: Player,
        rushEventData?: PlayerRushEvent,
        rankNumber?: number
    }
): UserRushEventEndlessBattleRanking | null {

    const playerData = useData?.playerData === undefined ? getPlayerSync(playerId) : useData?.playerData
    if (playerData === null) return null;

    const rushEventData = useData?.rushEventData === undefined ? getPlayerRushEventSync(playerId, eventId) : useData?.rushEventData
    if (rushEventData === null) return null;

    const bestRound = rushEventData.endlessBattleMaxRound
    const bestTime = rushEventData.endlessBattleMaxRoundTime
    const endlessCharacterIds = rushEventData.endlessBattleMaxRoundCharacterIds
    const endlessCharacterEvolutionImgLevel = rushEventData.endlessBattleMaxRoundCharacterEvolutionImgLvls 
    if (bestRound === null || bestTime === null || endlessCharacterIds === null || endlessCharacterEvolutionImgLevel === null)
        return null;

    // build party member list
    const partyMemberList: UserRushEventEndlessBattleMyRankingPartyMemberListItem[] = []
    for (let n = 0; n < endlessCharacterIds.length; n++) {
        const characterId = endlessCharacterIds[n]
        if (characterId !== null) {
            partyMemberList.push({
                character_id: characterId,
                evolution_img_level: endlessCharacterEvolutionImgLevel[n] ?? 0
            })
        }
    }

    return {
        best_round: bestRound,
        elapsed_time_ms: bestTime,
        name: playerData.name,
        party_member_list: partyMemberList,
        rank_number: useData?.rankNumber ?? 0,
        user_rank: 215
    }
}

/**
 * Gets the played party list for the player currently at a rank in an endless battle leaderboard for a rush event.
 * 
 * @param rank The rank of the player.
 * @param eventId The ID of the rush event.
 * @returns A serialized player rush event played party list or null.
 */
export function getRushEventEndlessBattleRankPlayedPartyListSync(
    rank: number,
    eventId: number
): SerializedPlayerRushEventPlayedPartyList | null {
    // Get the ID of the player who is currently at rank [rank].
    const playerId = getPlayerIdFromRushEventEndlessRankSync(rank, eventId);
    if (playerId === null) return null;

    // get the played party list
    const parties = getSerializedPlayerRushEventPlayedPartiesSync(playerId, eventId);

    return parties.endlessParties;
}
