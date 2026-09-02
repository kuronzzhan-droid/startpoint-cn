import { QuestCategory } from "../types"


/**
 * 幻想连战(Fantasy Gauntlet)的运行期身份。
 *
 * 这是整套逻辑**唯一**的 ID 来源:所有分支都必须以这里的事件号为门,
 * 深渊连战 700099 的任何一条既有路径都不得被本模块触及
 * (作者 2026-09-02 裁定)。
 *
 * 15 关的编排:
 *  · 1/2/3/4、6/7/8/9、11/12/13/14 是 Rush 单人关(category=RUSH_EVENT,
 *    quest id = 700098 * 1000 + 关号);
 *  · 5/10/15 是 AdventEvent 多人关(quest id = 300098 * 1000 + 第几个 boss),
 *    Rush 侧同号的 700098005/010/015 只是客户端占位行,服务端一律拒绝直接开打。
 */
export const FANTASY_GAUNTLET = Object.freeze({
    routeId: "fantasy_gauntlet_v1",
    rushEventId: 700098,
    multiEventId: 300098,
    /** 幻想代币(每个 boss 关结算发放)。 */
    tokenItemId: 2370098,
    /** 究极图腾(全 15 关通关发放)。 */
    fullClearTokenItemId: 2370097,
    /** 梦幻纹章 —— 官方通用素材,solo 里程碑与全通都发。 */
    dreamEmblemItemId: 99,
    /** 练习模式(folder 2,round 0),不参与顺序门。 */
    practiceQuestId: 700098 * 1000 + 16,
    /** 15 关本体所在的 Rush folder。 */
    rushFolderId: 1,
    /** 练习模式所在的 Rush folder。 */
    practiceFolderId: 2,
    finalStage: 15,
    /**
     * 交给 rush-handler 的 folder 轮数哨兵。
     *
     * 原生 folder 通关路径(insertClearedFolder + 一次性 folder 奖励)在幻想连战
     * 里是**错的**:这套 15 关设计成可反复刷,而原生路径只发一次奖励并把
     * folder 关掉。把上限抬到 16(> 第 15 关)后原生路径永不触发,全通奖励
     * 全部由 {@link settleFantasyBattleSync} 负责 —— 这就是 A13「二选一」的选择。
     */
    folderRoundSentinel: 16,
    /** 客户端 additional_reward 组:boss 代币。 */
    bossTokenRewardGroupId: 237009800,
    /** 客户端 additional_reward 组:全通。 */
    fullClearRewardGroupId: 237009700,
    /** 客户端 additional_reward 组基址:solo 第 N 关 = base + N。 */
    soloRewardGroupBaseId: 237098000,
})


/** 幻想连战专属装备(仅可在幻想连战中使用)。 */
export const FANTASY_EXCLUSIVE_EQUIPMENT_IDS: readonly number[] = Object.freeze(
    Array.from({ length: 11 }, (_, index) => 100013 + index),
)


/**
 * 不施加「幻想专属装备禁用」的连战事件。
 *
 *  · 700098 —— 幻想连战自己,这些装备就是给它用的;
 *  · 700099 —— 深渊连战。作者 2026-09-02 裁定:深渊的任何逻辑分支都不许改动。
 *    在开战路径上新增一条可能拒绝的判断属于改动,所以先豁免。
 *    **待作者拍板**:要不要把深渊也纳入限制(否则幻想装备可以带进深渊),
 *    拍板后从这个集合里删掉 700099 即可,不需要动别的代码。
 */
export const FANTASY_EQUIPMENT_EXEMPT_RUSH_EVENT_IDS: ReadonlySet<number> =
    Object.freeze(new Set<number>([700098, 700099]))


export const FANTASY_SOLO_STAGES: readonly number[] =
    Object.freeze([1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14])

export const FANTASY_BOSS_STAGES: readonly number[] = Object.freeze([5, 10, 15])


/**
 * CN 的 AdventEvent 多人客户端发的是 category 7(ADVENT_EVENT_SINGLE),
 * 尽管服务端枚举把 8 命名为 ADVENT_EVENT_MULTI。以 7 为准,8 作兼容别名。
 */
export const FANTASY_MULTI_CATEGORY = QuestCategory.ADVENT_EVENT_SINGLE

const FANTASY_MULTI_CATEGORY_ALIASES: readonly QuestCategory[] = Object.freeze([
    QuestCategory.ADVENT_EVENT_SINGLE,
    QuestCategory.ADVENT_EVENT_MULTI,
])


/** 每个 boss 关结算发放的幻想代币数量。 */
export const FANTASY_BOSS_TOKEN_REWARDS: Readonly<Record<number, number>> =
    Object.freeze({ 5: 5, 10: 10, 15: 20 })


export interface FantasyQuestRef {
    /** 显示关号 1..15。 */
    readonly stage: number
    readonly category: QuestCategory
    readonly questId: number
    /** 该关是否走多人 AdventEvent 路线。 */
    readonly isMulti: boolean
}


const FANTASY_QUESTS: readonly FantasyQuestRef[] = Object.freeze([
    ...FANTASY_SOLO_STAGES.map(stage => Object.freeze({
        stage,
        category: QuestCategory.RUSH_EVENT,
        questId: FANTASY_GAUNTLET.rushEventId * 1000 + stage,
        isMulti: false,
    })),
    ...FANTASY_BOSS_STAGES.map((stage, index) => Object.freeze({
        stage,
        category: FANTASY_MULTI_CATEGORY,
        questId: FANTASY_GAUNTLET.multiEventId * 1000 + index + 1,
        isMulti: true,
    })),
].sort((left, right) => left.stage - right.stage))


const FANTASY_BY_QUEST = new Map<string, FantasyQuestRef>()
for (const ref of FANTASY_QUESTS) {
    FANTASY_BY_QUEST.set(`${Number(ref.category)}:${ref.questId}`, ref)
    if (ref.isMulti) {
        for (const category of FANTASY_MULTI_CATEGORY_ALIASES) {
            FANTASY_BY_QUEST.set(`${Number(category)}:${ref.questId}`, ref)
        }
    }
}


export function listFantasyQuests(): readonly FantasyQuestRef[] {
    return FANTASY_QUESTS
}


/**
 * 把 (category, questId) 解析成幻想连战的关卡引用。
 *
 * Rush 侧的 700098005/010/015 三个占位行**刻意不在表里**:它们在客户端上
 * 只是通往多人房的入口,直接开打是没有补丁时的降级误触,必须被拒绝。
 *
 * @param category 关卡分类。
 * @param questId 关卡 ID。
 * @returns 关卡引用;不是幻想连战的关则为 null。
 */
export function getFantasyQuestRef(
    category: number,
    questId: number,
): FantasyQuestRef | null {
    return FANTASY_BY_QUEST.get(`${Number(category)}:${Number(questId)}`) ?? null
}


export function isFantasyQuest(category: number, questId: number): boolean {
    return getFantasyQuestRef(category, questId) !== null
}


/** 该关是否属于幻想连战的多人段(AdventEvent 300098)。 */
export function isFantasyMultiQuest(category: number, questId: number): boolean {
    return getFantasyQuestRef(category, questId)?.isMulti === true
}


/** 幻想连战的多人关 quest id 全集(供 modes.d 单人入口守卫核对)。 */
export function listFantasyMultiQuestIds(): readonly number[] {
    return Object.freeze(FANTASY_QUESTS.filter(ref => ref.isMulti)
        .map(ref => ref.questId))
}


/** 幻想连战的练习关(不参与顺序门,可随时重复打)。 */
export function isFantasyPracticeQuest(category: number, questId: number): boolean {
    return Number(category) === Number(QuestCategory.RUSH_EVENT)
        && Number(questId) === FANTASY_GAUNTLET.practiceQuestId
}


/**
 * folder 轮数上限的幻想连战覆写。
 *
 * assets 侧的派生结果是**共享缓存对象**,这里必须复制后再改,
 * 否则会把 700098 的哨兵写进缓存、污染别的调用方。
 *
 * @param eventId 连战事件 ID。
 * @param folderMaxRounds assets 派生出来的 folder → 轮数。
 * @returns 幻想连战返回带哨兵的副本;其余事件原样返回(含 700099)。
 */
export function withFantasyFolderSentinel(
    eventId: number,
    folderMaxRounds: Record<number, number>,
): Record<number, number> {
    if (Number(eventId) !== FANTASY_GAUNTLET.rushEventId) return folderMaxRounds
    return {
        ...folderMaxRounds,
        [FANTASY_GAUNTLET.rushFolderId]: FANTASY_GAUNTLET.folderRoundSentinel,
    }
}


/**
 * 运维总开关。
 *
 * 默认开启:这套逻辑全部以 700098/300098 为门,数据没落盘之前它本来就打不着。
 * `WF_FANTASY_GAUNTLET=0` 用于**出事时当场关掉**幻想连战的服务端分支,
 * 而不必回滚构建;它不影响深渊连战的任何路径。
 *
 * @returns 幻想连战的服务端分支是否生效。
 */
export function isFantasyGauntletEnabled(): boolean {
    return (process.env.WF_FANTASY_GAUNTLET ?? "").trim() !== "0"
}
