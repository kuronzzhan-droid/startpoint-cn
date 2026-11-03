"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTargetProfileSync = exports.buildFollowUserInfoSync = void 0;
const player_time_compat_1 = require("./player-time-compat");
const character_1 = require("../data/domains/character");
const follow_1 = require("../data/domains/follow");
const player_1 = require("../data/domains/player");
const stamina_1 = require("./stamina");
const utils_1 = require("../utils");
const profileFavorite_1 = require("./profileFavorite");
const option_1 = require("../data/domains/option");
const profile_stats_1 = require("./profile-stats");
function buildFollowUserInfoSync(requesterPlayerId, targetPlayerId) {
    var _a, _b, _c;
    const player = (0, player_1.getPlayerSync)(targetPlayerId);
    const viewerId = (0, follow_1.getViewerIdByPlayerIdSync)(targetPlayerId);
    if (!player || viewerId === null)
        return null;
    const relation = (0, follow_1.getFollowRelationSync)(requesterPlayerId, targetPlayerId);
    // Follow/follower/search cards use the first character selected in the
    // profile's favorite-character party. The legacy player leader field is
    // commonly left at character 1 (Arcl), which made unrelated users appear
    // to share the same profile avatar.
    const favorite = (0, profileFavorite_1.getFavoritePartySelectionSync)(targetPlayerId, player.leaderCharacterId);
    const profileLeaderId = (_b = (_a = favorite.characterIds[0]) !== null && _a !== void 0 ? _a : player.leaderCharacterId) !== null && _b !== void 0 ? _b : 1;
    const leader = (0, character_1.getPlayerCharacterSync)(targetPlayerId, profileLeaderId);
    const account = (0, player_1.getAccountFromPlayerIdSync)(targetPlayerId);
    return {
        comment: player.comment || "",
        degree_id: player.degreeId || 1,
        follow_state: relation.state,
        follow_time: relation.followTime,
        followed_time: relation.followedTime,
        last_login_region: null,
        // Account login timestamps use real wall-clock time. Shift the epoch by
        // the same offset as servertime so their relative age remains correct.
        last_login_time: account ? (0, utils_1.realToVirtual)(account.lastLoginTime) : (0, utils_1.getServerTime)((0, player_time_compat_1.getPlayerClientMaintenanceDateSync)(player.id, player.lastLoginTime)),
        leader_character_evolution_img_level: (_c = leader === null || leader === void 0 ? void 0 : leader.evolutionLevel) !== null && _c !== void 0 ? _c : 0,
        leader_character_id: profileLeaderId,
        name: player.name || "",
        profile_image_url: null,
        rank: (0, stamina_1.getRankDegree)(player.rankPoint || 0),
        role: player.role || 1,
        viewer_id: viewerId,
    };
}
exports.buildFollowUserInfoSync = buildFollowUserInfoSync;
function buildTargetProfileSync(requesterPlayerId, targetPlayerId) {
    var _a, _b;
    const player = (0, player_1.getPlayerSync)(targetPlayerId);
    if (!player)
        return null;
    const publicInfo = buildFollowUserInfoSync(requesterPlayerId, targetPlayerId);
    if (!publicInfo)
        return null;
    const characters = (0, character_1.getPlayerCharactersSync)(targetPlayerId);
    const stats = (0, profile_stats_1.getPlayerProfileStatsSync)(targetPlayerId, characters);
    const profileSettings = (0, option_1.getPlayerProfileSettingsSync)(targetPlayerId);
    const favorite = (0, profileFavorite_1.getFavoritePartySelectionSync)(targetPlayerId, player.leaderCharacterId);
    const favoriteLeaderId = (_a = favorite.characterIds[0]) !== null && _a !== void 0 ? _a : player.leaderCharacterId;
    const favoriteLeader = characters[String(favoriteLeaderId)];
    const exBoost = (characterId) => {
        if (characterId === null)
            return null;
        const character = characters[String(characterId)];
        return (character === null || character === void 0 ? void 0 : character.exBoost) ? {
            ability_id_list: character.exBoost.abilityIdList,
            status_id: character.exBoost.statusId,
        } : null;
    };
    return {
        favorite_character: {
            character_ids: favorite.characterIds,
            unison_character_ids: favorite.unisonCharacterIds,
            character_ex_boost: favorite.characterIds.map(exBoost),
            unison_character_ex_boost: favorite.unisonCharacterIds.map(exBoost),
        },
        target_user_info: {
            comment: publicInfo.comment,
            degree_id: publicInfo.degree_id,
            // The client already uses the same four-state relation enum as
            // getFollowRelationSync: 0=none, 1=mutual, 2=following,
            // 3=follower. Preserve it exactly for button actions.
            follow_state: publicInfo.follow_state,
            // OtherProfileLogic throws C2821 when this optional value is None.
            // The CN server has a single region, so always provide it here.
            last_login_region: "CN",
            leader_character_full_shot_evolution_level: (_b = favoriteLeader === null || favoriteLeader === void 0 ? void 0 : favoriteLeader.evolutionLevel) !== null && _b !== void 0 ? _b : 0,
            max_opened_mana_board_second_count: profileSettings.showOpenedManaBoardSecondCount
                ? stats.maxOpenedManaBoardSecondCount
                : null,
            max_owned_character_count: profileSettings.showOwnedCharacterCount
                ? stats.maxOwnedCharacterCount
                : null,
            max_owned_degree_count: profileSettings.showOwnedDegreeCount
                ? stats.maxOwnedDegreeCount
                : null,
            name: publicInfo.name,
            opened_mana_board_second_count: profileSettings.showOpenedManaBoardSecondCount
                ? stats.openedManaBoardSecondCount
                : null,
            owned_character_count: profileSettings.showOwnedCharacterCount
                ? stats.ownedCharacterCount
                : null,
            owned_degree_count: profileSettings.showOwnedDegreeCount
                ? stats.ownedDegreeCount
                : null,
            rank: publicInfo.rank,
            role: publicInfo.role,
            viewer_id: publicInfo.viewer_id,
        },
    };
}
exports.buildTargetProfileSync = buildTargetProfileSync;
