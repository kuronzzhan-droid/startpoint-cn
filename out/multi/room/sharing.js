"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRoomSharedWithRelation = exports.isRoomSharedWithPlayer = exports.hasRoomShareType = exports.mergeRoomShareTypes = exports.decodeRoomShareOptions = exports.encodeRoomShareOptions = exports.normalizeRoomShareTypes = exports.RANDOM_RECRUITMENT_SHARE_TYPE = exports.FOLLOWER_SHARE_TYPE = exports.MUTUAL_FOLLOW_SHARE_TYPE = void 0;
exports.MUTUAL_FOLLOW_SHARE_TYPE = 1;
/** The client's original one-way follow option: viewers who follow the host. */
exports.FOLLOWER_SHARE_TYPE = 2;
exports.RANDOM_RECRUITMENT_SHARE_TYPE = 3;
function normalizeRoomShareTypes(shareTypes) {
    if (!Array.isArray(shareTypes))
        return [];
    return [...new Set(shareTypes.filter(type => Number.isInteger(type)
            && type >= exports.MUTUAL_FOLLOW_SHARE_TYPE
            && type <= exports.RANDOM_RECRUITMENT_SHARE_TYPE))];
}
exports.normalizeRoomShareTypes = normalizeRoomShareTypes;
function encodeRoomShareOptions(shareTypes) {
    return shareTypes.reduce((options, type) => options | (1 << (type - 1)), 0);
}
exports.encodeRoomShareOptions = encodeRoomShareOptions;
function decodeRoomShareOptions(options) {
    const result = [];
    if (!Number.isSafeInteger(options))
        return result;
    for (const type of [exports.MUTUAL_FOLLOW_SHARE_TYPE, exports.FOLLOWER_SHARE_TYPE, exports.RANDOM_RECRUITMENT_SHARE_TYPE]) {
        if ((options & (1 << (type - 1))) !== 0)
            result.push(type);
    }
    return result;
}
exports.decodeRoomShareOptions = decodeRoomShareOptions;
/**
 * The legacy client only sends the share types that are newly enabled in a
 * dialog confirmation and permanently disables entries it already shared
 * (`RoomShareDialog`/`MultiBattleRoomScene.shareRequestAPI`). Its request is a
 * delta, so share state must be merged monotonically inside the room; a plain
 * replace drops earlier options (for example, enabling random recruitment
 * after mutual-follow sharing makes the room disappear from the follower
 * room list again).
 */
function mergeRoomShareTypes(currentOptions, requested) {
    return [...new Set([
            ...decodeRoomShareOptions(currentOptions),
            ...normalizeRoomShareTypes(requested),
        ])].sort((a, b) => a - b);
}
exports.mergeRoomShareTypes = mergeRoomShareTypes;
function hasRoomShareType(room, shareType) {
    return (room.share_room_options & (1 << (shareType - 1))) !== 0;
}
exports.hasRoomShareType = hasRoomShareType;
function isRoomSharedWithPlayer(room, viewerPlayerId) {
    const { getFollowRelationSync } = require("../../data/domains/follow");
    const relation = getFollowRelationSync(viewerPlayerId, room.host_player_id);
    return isRoomSharedWithRelation(room, relation);
}
exports.isRoomSharedWithPlayer = isRoomSharedWithPlayer;
function isRoomSharedWithRelation(room, relation) {
    // 1 = mutual follow only; 2 = any viewer who follows the host, including
    // a one-way follow where the host does not follow back.
    const mutualVisible = hasRoomShareType(room, exports.MUTUAL_FOLLOW_SHARE_TYPE)
        && relation.state === 1;
    const followerVisible = hasRoomShareType(room, exports.FOLLOWER_SHARE_TYPE)
        && relation.followTime !== null;
    return mutualVisible || followerVisible;
}
exports.isRoomSharedWithRelation = isRoomSharedWithRelation;
