/**
 * 「点榜上某一行 → 那个玩家的个人资料」这一屏的**编队投影**(P4/S5)。
 *
 * ── 为什么要单独一个文件 ──────────────────────────────────────────────
 * 因为客户端在这一格上有一条**硬抛异常**的路,而不是「渲染成空框」:
 *
 *   `OtherProfileLogic.getLeaderFullShotImageId()`
 *   (`弹国服/scripts/pinball/scene/playerProfile/profile/otherProfile/OtherProfileLogic.as:308-323`)
 *
 *       var _loc2_:Option = response.favorite_character.character_ids[0];
 *       switch(_loc2_.index) {
 *          case 0: _loc3_ = int(_loc2_.params[0]); break;
 *          case 1: Boot.lastError = new Error();
 *                  throw "No Value(f8ce8390-af35-4a8d-b28d-e7cdbccc9fb9)";
 *       }
 *
 * 而 `PlayerProfileView.registerButtons()` 的 `ProfileKind.Other` 分支
 * (`PlayerProfileView.as:640 / :701 / :826` —— follow_state 三个分支**全都**调)
 * 无条件调用 `replaceLeaderFullshot()` → 上面那个 getter。
 *
 * ⇒ **`character_ids[0]` 为 null = 整屏抛异常**,没有任何一条绕过去的路。
 *
 * 其余五个槽位都是 None-safe 的(`prepare()` 的两个 while 循环、
 * `calcExBoostFrame`、`preparePixelAnimations` 的 `case 1:` 都写了 `Option.None`
 * 分支),所以**只有槽 0 是硬约束**。
 *
 * ── 这为什么会真的发生 ────────────────────────────────────────────────
 * 榜上第 2 行「艾利西弗」的 `players.party_slot` 指的那一队,主位 1 是 **700016**
 * —— 助战角色段(700000..700099),`isShippableCharacterId` 拒发(发了会让客户端
 * `GeneralCharacterLogic` 抛 `ClientError(8013)`)。降级成 null 之后槽 0 就空了。
 * 也就是说「拒发助战角色」这条正确的防线,恰好把另一条防线的前提打破了。
 *
 * ── 本文件的规则(按顺序试,第一条命中就用)────────────────────────────
 *   1. `party`            —— 主位 1 可下发:原样发,槽位一个不动。
 *   2. `party-compacted`  —— 主位 1 不可下发但队里还有别人:把 (主位, 合击位)
 *                            **成对**左压缩。成对是关键:合击位是挂在主位上的,
 *                            单独压主位会把 A 的合击安到 B 头上。
 *   3. `leader`           —— 整队一个可下发主位都没有:退回该存档的队长角色
 *                            (`players.leader_character_id`)。
 *   4. `owned`            —— 连队长角色都不可下发:退回已拥有角色里 ID 最小的
 *                            那一个(要**确定性**:同一次点击两次请求必须同结果)。
 *   5. `null`             —— 一个可下发角色都没有(空存档)。调用方应当返回 400,
 *                            让客户端弹一个错误框 —— 而不是发一份必抛的响应。
 *
 * 3/4 两条只发**一个**角色、合击位全空:那时队伍本来就渲染不出来,发的是
 * 「开得起这一屏的最小集合」,不是一支假队伍。
 *
 * ⚠ 仍然管不到的一件事:槽 0 那个角色的 `full_shot` 贴图如果在客户端资产链里
 *   不存在,`getFullShotImagePathWithAttributeOfEvolutionLevel` 会走
 *   `SectionCommand.FileNotFound` 弹「数据不足」(**不是崩**,是拉去重下资源)。
 *   自制角色整包发布要求 37/37 必需资产,full_shot 在其中,所以正常不会遇上。
 */

import { isShippableCharacterId } from "./rush-leaderboard-ranking"

/** 一支队伍的槽位数(主位 3 + 合击位 3)。客户端按下标读,长度必须恒为 3。 */
export const PROFILE_PARTY_SLOTS = 3

/** 编队是从哪一条规则来的 —— 只用于日志和单测断言,不下发。 */
export type ProfilePartySource = "party" | "party-compacted" | "leader" | "owned"

export interface ProfileFavoriteParty {
    /** 主位;长度恒 3,**下标 0 保证非 null**。 */
    mains: (number | null)[]
    /** 合击位;长度恒 3。 */
    unisons: (number | null)[]
    /** 命中了哪一条规则。 */
    source: ProfilePartySource
}

export interface ProfileFavoritePartyInput {
    /** 该存档当前选中那一队的主位(任意长度,会被规整成 3)。 */
    mains: (number | null | undefined)[]
    /** 同一队的合击位。 */
    unisons: (number | null | undefined)[]
    /** `players.leader_character_id`。 */
    leaderCharacterId?: number | null
    /** 该存档已拥有的角色 ID(顺序无所谓,本函数自己排序取最小)。 */
    ownedCharacterIds?: (number | null | undefined)[]
    /**
     * 逃生门:只发一个「开得起这一屏」的角色,编队一律不发。
     *
     * ⚠ **发不了「零个角色」** —— 客户端槽 0 是硬约束(见文件头)。
     *   `WF_RUSH_PROFILE_CHARACTERS=0` 的旧语义(六个槽全发 null)会让
     *   **每一行都必崩**,那是加重不是止血,20260828 复核后改成本条。
     */
    leaderOnly?: boolean
}

/** 规整到恰好 3 个槽位,并把不可下发的 ID 降级成 null。 */
function toSafeSlots(ids: (number | null | undefined)[]): (number | null)[] {
    const out: (number | null)[] = []
    for (let i = 0; i < PROFILE_PARTY_SLOTS; i++) {
        const raw = ids[i]
        const id = raw === undefined || raw === null ? null : Number(raw)
        out.push(isShippableCharacterId(id) ? id : null)
    }
    return out
}

function firstShippable(ids: (number | null | undefined)[]): number | null {
    for (const raw of ids) {
        const id = raw === undefined || raw === null ? null : Number(raw)
        if (isShippableCharacterId(id)) return id
    }
    return null
}

/** 只发一个角色的那两条规则共用的收尾。 */
function soloParty(leader: number, source: ProfilePartySource): ProfileFavoriteParty {
    return { mains: [leader, null, null], unisons: [null, null, null], source }
}

/**
 * 把一支队伍投影成个人资料页能安全渲染的 `favorite_character`。
 *
 * @param input 队伍 + 兜底来源。
 * @returns 槽 0 保证非 null 的编队;一个可下发角色都找不到时返回 `null`
 *          (调用方应当回 400,不要发一份必抛的响应)。
 */
export function buildProfileFavoriteParty(
    input: ProfileFavoritePartyInput
): ProfileFavoriteParty | null {
    const mains = toSafeSlots(input.mains ?? [])
    const unisons = toSafeSlots(input.unisons ?? [])

    // 兜底来源按优先级排好,`leaderOnly` 和「整队都不可发」共用这一条链。
    const leaderFallback = (): ProfileFavoriteParty | null => {
        const fromLeader = firstShippable([input.leaderCharacterId ?? null])
        if (fromLeader !== null) return soloParty(fromLeader, "leader")
        // 已拥有角色:取 ID 最小的那一个 —— 必须确定性,否则同一次点击的两次
        // 请求可能给出不同的立绘,排障时会以为是随机崩。
        const owned = (input.ownedCharacterIds ?? [])
            .map(raw => (raw === undefined || raw === null ? null : Number(raw)))
            .filter((id): id is number => isShippableCharacterId(id))
            .sort((a, b) => a - b)
        return owned.length === 0 ? null : soloParty(owned[0], "owned")
    }

    if (input.leaderOnly === true) {
        const fromParty = firstShippable([...mains, ...unisons])
        return fromParty !== null ? soloParty(fromParty, "leader") : leaderFallback()
    }

    // ① 主位 1 本来就能发 —— 什么都不动。
    if (mains[0] !== null) return { mains, unisons, source: "party" }

    // ② 成对左压缩:合击位跟着它的主位一起搬,不许拆散。
    const pairs: { main: number, unison: number | null }[] = []
    for (let slot = 0; slot < PROFILE_PARTY_SLOTS; slot++) {
        const main = mains[slot]
        if (main !== null) pairs.push({ main, unison: unisons[slot] })
    }
    if (pairs.length > 0) {
        const compactedMains: (number | null)[] = [null, null, null]
        const compactedUnisons: (number | null)[] = [null, null, null]
        pairs.forEach((pair, slot) => {
            compactedMains[slot] = pair.main
            compactedUnisons[slot] = pair.unison
        })
        return { mains: compactedMains, unisons: compactedUnisons, source: "party-compacted" }
    }

    // ③④⑤ 队伍整支都发不出去。
    return leaderFallback()
}
