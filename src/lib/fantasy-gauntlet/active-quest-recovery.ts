export interface FantasyActiveQuestOwnership {
    /** 这条残留的进行中战斗是不是多人战斗。 */
    readonly isMulti: boolean
    /** 多人战斗里,这个存档是不是房主。 */
    readonly isMultiHost: boolean
}


/**
 * /load 撞见一条残留的幻想连战「进行中战斗」时,要不要把这一轮重置掉。
 *
 * 一条过期的多人战斗记录**不等于**这个存档输掉了自己的运行:救援客人在读条
 * 阶段掉线也会留下同样的残留,把他们的进度清掉纯属误伤。只有房主(以及单人关)
 * 才拥有这一轮的进度。
 *
 * @param isFantasy 这条残留是否属于幻想连战。
 * @param quest 归属信息。
 * @returns 是否应当重置这一轮。
 */
export function shouldResetFantasyRunForStaleActiveQuest(
    isFantasy: boolean,
    quest: FantasyActiveQuestOwnership,
): boolean {
    if (!isFantasy) return false
    return !quest.isMulti || quest.isMultiHost
}
