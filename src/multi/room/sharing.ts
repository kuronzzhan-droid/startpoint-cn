import type { MultiRoom } from "../types"

export const MUTUAL_FOLLOW_SHARE_TYPE = 1
/** The client's original one-way follow option: viewers who follow the host. */
export const FOLLOWER_SHARE_TYPE = 2
export const RANDOM_RECRUITMENT_SHARE_TYPE = 3

export function normalizeRoomShareTypes(shareTypes: unknown): number[] {
    if (!Array.isArray(shareTypes)) return []
    return [...new Set(
        shareTypes.filter(type =>
            Number.isInteger(type)
            && type >= MUTUAL_FOLLOW_SHARE_TYPE
            && type <= RANDOM_RECRUITMENT_SHARE_TYPE
        ),
    )] as number[]
}

export function encodeRoomShareOptions(shareTypes: number[]): number {
    return shareTypes.reduce((options, type) => options | (1 << (type - 1)), 0)
}

export function decodeRoomShareOptions(options: number): number[] {
    const result: number[] = []
    if (!Number.isSafeInteger(options)) return result
    for (const type of [MUTUAL_FOLLOW_SHARE_TYPE, FOLLOWER_SHARE_TYPE, RANDOM_RECRUITMENT_SHARE_TYPE]) {
        if ((options & (1 << (type - 1))) !== 0) result.push(type)
    }
    return result
}

/**
 * The legacy client only sends the share types that are newly enabled in a
 * dialog confirmation and permanently disables entries it already shared
 * (`RoomShareDialog`/`MultiBattleRoomScene.shareRequestAPI`). Its request is a
 * delta, so share state must be merged monotonically inside the room; a plain
 * replace drops earlier options (for example, enabling random recruitment
 * after mutual-follow sharing makes the room disappear from the follower
 * room list again).
 */
export function mergeRoomShareTypes(currentOptions: number, requested: unknown): number[] {
    return [...new Set([
        ...decodeRoomShareOptions(currentOptions),
        ...normalizeRoomShareTypes(requested),
    ])].sort((a, b) => a - b)
}

export function hasRoomShareType(room: Pick<MultiRoom, "share_room_options">, shareType: number): boolean {
    return (room.share_room_options & (1 << (shareType - 1))) !== 0
}

export function isRoomSharedWithPlayer(
    room: Pick<MultiRoom, "share_room_options" | "host_player_id">,
    viewerPlayerId: number,
): boolean {
    const { getFollowRelationSync } = require("../../data/domains/follow") as typeof import("../../data/domains/follow")
    const relation = getFollowRelationSync(viewerPlayerId, room.host_player_id)
    return isRoomSharedWithRelation(room, relation)
}

export function isRoomSharedWithRelation(
    room: Pick<MultiRoom, "share_room_options">,
    relation: { state: number; followTime: unknown | null },
): boolean {
    // 1 = mutual follow only; 2 = any viewer who follows the host, including
    // a one-way follow where the host does not follow back.
    const mutualVisible = hasRoomShareType(room, MUTUAL_FOLLOW_SHARE_TYPE)
        && relation.state === 1
    const followerVisible = hasRoomShareType(room, FOLLOWER_SHARE_TYPE)
        && relation.followTime !== null
    return mutualVisible || followerVisible
}
