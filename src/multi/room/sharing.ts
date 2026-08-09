import { getFollowRelationSync } from "../../data/domains/follow"
import type { MultiRoom } from "../types"

export const MUTUAL_FOLLOW_SHARE_TYPE = 1
export const AI_RECRUITMENT_SHARE_TYPE = 2
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

export function hasRoomShareType(room: MultiRoom, shareType: number): boolean {
    return (room.share_room_options & (1 << (shareType - 1))) !== 0
}

export function isRoomSharedWithPlayer(
    room: MultiRoom,
    viewerPlayerId: number,
    randomRecruiting: boolean,
): boolean {
    if (randomRecruiting) return true
    if (!hasRoomShareType(room, MUTUAL_FOLLOW_SHARE_TYPE)) return false
    return getFollowRelationSync(viewerPlayerId, room.host_player_id).state === 1
}
