import { getPlayerCharacterSync, getPlayerCharactersSync } from "../data/domains/character";
import { getFollowRelationSync, getViewerIdByPlayerIdSync } from "../data/domains/follow";
import { getAccountFromPlayerIdSync, getPlayerSync } from "../data/domains/player";
import { getRankDegree } from "./stamina";
import { getServerTime, realToVirtual } from "../utils";
import { getFavoritePartySelectionSync } from "./profileFavorite";

export function buildFollowUserInfoSync(requesterPlayerId: number, targetPlayerId: number): any | null {
    const player = getPlayerSync(targetPlayerId);
    const viewerId = getViewerIdByPlayerIdSync(targetPlayerId);
    if (!player || viewerId === null) return null;

    const relation = getFollowRelationSync(requesterPlayerId, targetPlayerId);
    // Follow/follower/search cards use the first character selected in the
    // profile's favorite-character party. The legacy player leader field is
    // commonly left at character 1 (Arcl), which made unrelated users appear
    // to share the same profile avatar.
    const favorite = getFavoritePartySelectionSync(
        targetPlayerId,
        player.leaderCharacterId,
    );
    const profileLeaderId =
        favorite.characterIds[0] ?? player.leaderCharacterId ?? 1;
    const leader = getPlayerCharacterSync(targetPlayerId, profileLeaderId);
    const account = getAccountFromPlayerIdSync(targetPlayerId);
    return {
        comment: player.comment || "",
        degree_id: player.degreeId || 1,
        follow_state: relation.state,
        follow_time: relation.followTime,
        followed_time: relation.followedTime,
        last_login_region: null,
        // Account login timestamps use real wall-clock time. Shift the epoch by
        // the same offset as servertime so their relative age remains correct.
        last_login_time: account ? realToVirtual(account.lastLoginTime) : getServerTime(player.lastLoginTime),
        leader_character_evolution_img_level: leader?.evolutionLevel ?? 0,
        leader_character_id: profileLeaderId,
        name: player.name || "",
        profile_image_url: null,
        rank: getRankDegree(player.rankPoint || 0),
        role: player.role || 1,
        viewer_id: viewerId,
    };
}

export function buildTargetProfileSync(requesterPlayerId: number, targetPlayerId: number): any | null {
    const player = getPlayerSync(targetPlayerId);
    if (!player) return null;
    const publicInfo = buildFollowUserInfoSync(requesterPlayerId, targetPlayerId);
    if (!publicInfo) return null;

    const characters = getPlayerCharactersSync(targetPlayerId);
    const charCount = Object.keys(characters).length;
    const favorite = getFavoritePartySelectionSync(
        targetPlayerId,
        player.leaderCharacterId,
    );
    const favoriteLeaderId =
        favorite.characterIds[0] ?? player.leaderCharacterId;
    const favoriteLeader = characters[String(favoriteLeaderId)];
    const exBoost = (characterId: number | null) => {
        if (characterId === null) return null;
        const character = characters[String(characterId)];
        return character?.exBoost ? {
            ability_id_list: character.exBoost.abilityIdList,
            status_id: character.exBoost.statusId,
        } : null;
    };
    return {
        favorite_character: {
            character_ids: favorite.characterIds,
            unison_character_ids: favorite.unisonCharacterIds,
            character_ex_boost: favorite.characterIds.map(exBoost),
            unison_character_ex_boost:
                favorite.unisonCharacterIds.map(exBoost),
        },
        target_user_info: {
            comment: publicInfo.comment,
            degree_id: publicInfo.degree_id,
            follow_state: publicInfo.follow_state,
            // OtherProfileLogic throws C2821 when this optional value is None.
            // The CN server has a single region, so always provide it here.
            last_login_region: "CN",
            leader_character_full_shot_evolution_level:
                favoriteLeader?.evolutionLevel ?? 0,
            max_opened_mana_board_second_count: 0,
            max_owned_character_count: charCount,
            max_owned_degree_count: 1,
            name: publicInfo.name,
            opened_mana_board_second_count: 0,
            owned_character_count: charCount,
            owned_degree_count: 1,
            rank: publicInfo.rank,
            role: publicInfo.role,
            viewer_id: publicInfo.viewer_id,
        },
    };
}
