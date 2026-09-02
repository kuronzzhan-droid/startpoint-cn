import {
    canStartFantasyQuestSync,
    isFantasyGauntletEnabled,
    isFantasyQuest,
    type FantasyRunGate,
} from "../lib/fantasy-gauntlet"
import type { MultiRoom } from "./types"


type RoomIdentity = Pick<MultiRoom, "host_player_id" | "category" | "quest_id">


/**
 * 一间幻想连战多人房是否还对得上房主的进度。
 *
 * 救援客人**刻意不参与**这道检查:他们可以反复来帮忙打同一个 boss,
 * 一次性顺序门只约束房间的拥有者。
 *
 * @param room 房间(只用到房主/分类/关卡三项)。
 * @returns 幻想连战房返回判定;别的房返回 null。
 */
export function getFantasyHostRoomGate(room: RoomIdentity): FantasyRunGate | null {
    if (!isFantasyGauntletEnabled()) return null
    if (!isFantasyQuest(room.category, room.quest_id)) return null
    return canStartFantasyQuestSync(
        room.host_player_id,
        room.category,
        room.quest_id,
    )
}


/**
 * 这间房是不是「房主已经打完了、不该再进」的幻想连战房。
 *
 * 房主第一次成功结算就会当场推进整轮进度,而旧客户端可能仍拿着这间房再发一次
 * 开战/入房请求。房间门是 fail-closed 的那一半:对不上就不给进。
 *
 * @param room 房间。
 * @returns 是否应当拒绝进入/开战/恢复。
 */
export function isFantasyRoomClosed(room: RoomIdentity): boolean {
    const gate = getFantasyHostRoomGate(room)
    return gate !== null && !gate.allowed
}
