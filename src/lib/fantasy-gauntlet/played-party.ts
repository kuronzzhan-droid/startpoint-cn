import type { UserRushEventPlayedParty } from "../../data/types"
import { FANTASY_BOSS_STAGES, FANTASY_GAUNTLET } from "./contract"


/**
 * 抹掉一条已出战队伍记录里的成员 ID(保留记录本身)。
 *
 * 客户端的「角色已用锁」(RushEventPartyGroupHolder)纯粹由这张表推导,
 * 而 folder 的下一轮号来自记录**条数**。所以抹成员 = 解锁角色 + 保住进度。
 *
 * @param party 序列化后的出战队伍。
 */
export function clearSerializedPlayedPartyMembers(
    party: UserRushEventPlayedParty,
): void {
    party.character_id_1 = party.character_id_2 = party.character_id_3 = null
    party.unison_character_id_1 = party.unison_character_id_2 =
        party.unison_character_id_3 = null
    party.evolution_img_level_1 = party.evolution_img_level_2 =
        party.evolution_img_level_3 = null
    party.unison_evolution_img_level_1 = party.unison_evolution_img_level_2 =
        party.unison_evolution_img_level_3 = null
}


/**
 * 幻想连战的 5/10/15 关是多人 boss,通关标记由服务端补写。
 *
 * 这三条标记只是「这一轮过了」的占位,不该消耗角色 —— 多人段用的是另一套队伍,
 * 把它们算进单人侧的角色锁会让后续关卡莫名其妙地缺人。
 *
 * `round` 存的是 quest id(rush-handler 的 `let round: number = questId`),
 * 所以取模 1000 才是显示关号。
 *
 * @param eventId 连战事件 ID。
 * @param round 该条记录的 round 列(实际是 quest id)。
 * @returns 是否应当在下发给客户端前抹掉成员 ID。
 */
export function shouldHideFantasyPlayedPartyMembers(
    eventId: number,
    round: number,
): boolean {
    if (Number(eventId) !== FANTASY_GAUNTLET.rushEventId) return false
    const stage = Math.abs(Math.trunc(Number(round))) % 1000
    return FANTASY_BOSS_STAGES.includes(stage)
}


/**
 * 对一整份 round → 队伍 的映射就地施加上面的规则。
 *
 * @param eventId 连战事件 ID。
 * @param parties round(quest id)→ 序列化队伍。
 * @returns 实际被抹掉的条数(供日志/测试断言)。
 */
export function hideFantasyBossPlayedPartyMembers(
    eventId: number,
    parties: Record<string | number, UserRushEventPlayedParty>,
): number {
    if (Number(eventId) !== FANTASY_GAUNTLET.rushEventId) return 0
    let hidden = 0
    for (const [round, party] of Object.entries(parties)) {
        if (!shouldHideFantasyPlayedPartyMembers(eventId, Number(round))) continue
        clearSerializedPlayedPartyMembers(party)
        hidden += 1
    }
    return hidden
}
