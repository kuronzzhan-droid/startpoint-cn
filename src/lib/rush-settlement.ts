/**
 * 深渊连战排行榜「赛季结算」的判定规则(纯逻辑层,不碰数据库)。
 *
 * ── 结算语义(事务边界)────────────────────────────────────
 * 一次结算是**一个 SQLite 事务**,四件事要么全成要么全不成:
 *   1. 冻结:把当期两张榜的完整名次抄进 `rush_season_results`(历史赛季记录);
 *   2. 发奖:按名次分档给前 N 名插邮件(`players_mails`),邮件 id 回填进快照行;
 *   3. 记账:`rush_season_settlements` 落一行,唯一索引 (event, folder, season)
 *      保证**同一期不可能被结算两次**(自动调度和手动按钮撞车也不会重复发奖);
 *   4. 换期:沿用既有语义 —— 期号 +1,进行中的 run 一并作废。
 * 任何一步抛错,整个事务回滚,不会出现「发了奖没换期」或「换了期没发奖」。
 *
 * ── 时钟 ───────────────────────────────────────────────────
 * 调度一律用**真实系统时间** `Date.now()`,不用 `getServerDate()` ——
 * 后台的「时间控制」能把服务器时间任意平移,拿它做结算调度会在时间回拨后
 * 反复触发。显示给作者的时间在前端按他的本地时区渲染。
 *
 * ── 奖励未配置时的行为 ─────────────────────────────────────
 * 档位里 `itemId` 与 `degreeId` **都**为 null = 这一档发不出任何东西。
 * 这种档位**跳过发奖**,但名次照常冻结、期照常换 —— 宁可不发,也不误发错道具。
 * 只配 `degreeId` 不配 `itemId`(只发称号)是合法配置,不算未配置。
 *
 * ── 发奖名单的去重口径(作者裁定 2026-08-28)─────────────────
 * 名次表最终都来自数据层榜单查询；展示通道由 `getRushBoardRecordsSync` 包一层
 * 500 行上限，结算通道则用同一 SQL 全量取数。战斗用时榜在**数据层**已按存档
 * 去重(`getRushFullRunLeaderboardSync`,一位玩家只留 battle_ms 最短那一程;
 * 排序量 = battle_ms,duration_ms 只作参考,2026-08-28 口径)。
 * 所以榜上每个名次都是**不同的存档**,同一个存档不可能兼领两档。
 * 这条推翻了 2026-08-27 的「可重复领」裁定;不要在这一层再补去重,
 * 补了就是两处口径,迟早分叉。
 *
 * ── 那两个问题都已拍板(2026-08-28 晚)────────────────────────────
 *  1. **跨期重复发奖 —— 已消除**。战斗用时榜现在只列**当期**成绩
 *     (`rushLeaderboard.ts::getRushFullRunLeaderboardSync` 的 season 参数；展示查询
 *     现读期次台账，结算服务显式传入冻结期号),而重摇塔一定换期
 *     (服务端 /rush_event/reset 钩子 / 后台按钮 / `mod-tools/wf_rogue_reroll.py`)。
 *     ⇒ 第 2 期的名单不可能逐行等于第 1 期。
 *     ⚠ 仍有一个边:`rewardBoard` 改成 `season-first` 时,那张榜按定义是跨期历史册
 *     (ORDER BY season DESC),前 N 名**多数**来自当期但不保证全部。默认是 full-run。
 *  2. **bot 排不排除 —— 做成开关**,见 {@link RushSettlementConfig.excludeBots}。
 *     默认**排除**;行为是「占名次但不发奖」(游戏内榜的名次和奖励名单的名次保持
 *     一致,bot 只是拿不到邮件),复用「已删存档占名次不发奖」那条现成的写法。
 */

/** 一档奖励:名次区间 + 发什么。 */
export interface RushRewardTier {
    fromRank: number
    /** 结束名次;null = 从 fromRank 一直到榜尾。 */
    toRank: number | null
    /** 道具 ID;null = 不发道具(该档只发称号,或还没配置)。 */
    itemId: number | null
    count: number
    /**
     * 称号(铭牌)ID;null = 该档不发称号。
     *
     * 称号不走邮件 —— `players_degrees` 是「拥有集合」,结算时直接 grant
     * (`grantPlayerDegreeSync`,重复授予是 no-op)。所以同一个存档反复夺冠
     * 不会攒出一堆重复铭牌。
     */
    degreeId?: number | null
}

export type RushRewardBoard = "full-run" | "season-first"

export interface RushSettlementConfig {
    eventId: number
    folderId: number
    /** 到点自动结算的总开关。 */
    autoEnabled: boolean
    /** 下次自动结算的真实墙钟时刻(ms);null = 没排期。 */
    settleAtMs: number | null
    /** 结算后自动顺延的周期(ms);null = 一次性,结算后清空排期。 */
    repeatIntervalMs: number | null
    /** 按哪张榜发奖。 */
    rewardBoard: RushRewardBoard
    /**
     * 有限档(`toRank !== null`)发到第几名为止。
     * `toRank=null` 的到榜尾档不受这条截断线限制。
     */
    rewardRankLimit: number
    rewardTiers: RushRewardTier[]
    mailSubject: string
    mailBody: string
    updatedAtMs: number
    /**
     * 机器人(`accounts.idp_code = 'rushbot'` 名下的存档)发不发奖。
     * **默认 true = 不发**。
     *
     * 语义是「**占名次但不发奖**」而不是「从榜上剔除」:游戏内那张榜和奖励名单
     * 必须是同一份名次,否则玩家看到自己第 4 名、却按第 2 名的档位收到奖励,
     * 没有任何界面能解释。落地方式与「已删存档」完全相同 —— 只是把它从
     * {@link planRewardMails} 的输入里滤掉,名次仍由整张榜算。
     *
     * 关掉(false)= 恢复 2026-08-28 之前的行为:bot 照发。
     */
    excludeBots: boolean
}

/**
 * 出厂默认四档。只在缺配置时 lazy-create;已有作者配置不会被改写。
 */
export function defaultRushRewardTiers(): RushRewardTier[] {
    return [
        { fromRank: 1, toRank: 1, itemId: 999015, count: 10, degreeId: 9900002 },
        { fromRank: 2, toRank: 3, itemId: 999015, count: 5, degreeId: 9900003 },
        { fromRank: 4, toRank: 15, itemId: 999015, count: 2, degreeId: 9900004 },
        { fromRank: 16, toRank: null, itemId: null, count: 1, degreeId: 9900005 }
    ]
}

/**
 * 出厂默认配置。
 *
 * @param eventId 事件 ID。
 * @param folderId folder ID。
 * @param nowMs 当前真实时间。
 */
export function defaultRushSettlementConfig(
    eventId: number,
    folderId: number,
    nowMs: number
): RushSettlementConfig {
    return {
        eventId,
        folderId,
        autoEnabled: false,
        settleAtMs: null,
        repeatIntervalMs: null,
        rewardBoard: "full-run",
        rewardRankLimit: 15,
        rewardTiers: defaultRushRewardTiers(),
        mailSubject: "深渊连战 排行奖励",
        mailBody: "恭喜在本期深渊连战中取得第 {rank} 名，这是你的奖励。",
        updatedAtMs: nowMs,
        // 出厂默认排除机器人:榜上曾有大量 bot(实测 2026-08-28),
        // 默认发奖等于把奖励发给自己写的假玩家。
        excludeBots: true
    }
}

/**
 * 找出某个名次命中的奖励档。
 *
 * 档位重叠时**第一条命中的生效**(配置顺序即优先级),这样作者手写配置时
 * 不需要保证区间互斥。
 *
 * @param tiers 奖励档位表。
 * @param rank 名次(1 起)。
 * @returns 命中的档;没有命中返回 null。
 */
export function matchRewardTier(tiers: RushRewardTier[], rank: number): RushRewardTier | null {
    for (const tier of tiers) {
        if (rank >= tier.fromRank && (tier.toRank === null || rank <= tier.toRank)) return tier
    }
    return null
}

/**
 * 按配置取某名次真正生效的档位。
 * `rewardRankLimit` 只截断有限档;null 尾档不受它影响。
 */
export function matchConfiguredRewardTier(
    config: RushSettlementConfig,
    rank: number
): RushRewardTier | null {
    for (const tier of config.rewardTiers) {
        if (rank < tier.fromRank) continue
        if (tier.toRank !== null && rank > tier.toRank) continue
        if (tier.toRank !== null && rank > config.rewardRankLimit) continue
        return tier
    }
    return null
}

/** 一封待发的奖励邮件。 */
export interface PlannedRewardMail {
    rank: number
    playerId: number
    itemId: number
    count: number
    subject: string
    body: string
}

export interface RewardPlanRow {
    rank: number
    playerId: number
}

/** 一次待授予的称号。 */
export interface PlannedRewardDegree {
    rank: number
    playerId: number
    degreeId: number
}

export interface RewardPlan {
    mails: PlannedRewardMail[]
    /** 结算时要授予的称号(不走邮件,直接进 players_degrees)。 */
    degrees: PlannedRewardDegree[]
    /** 命中了档位但**既没道具也没称号**的名次,用来在日志/后台里提醒作者。 */
    skippedUnconfigured: number[]
}

/**
 * 把名次表算成待发邮件表。
 *
 * @param rows 已排好序的名次行(rank 从 1 开始连续)。
 * @param config 结算配置。
 * @returns 发奖计划。
 */
export function planRewardMails(
    rows: RewardPlanRow[],
    config: RushSettlementConfig
): RewardPlan {
    const mails: PlannedRewardMail[] = []
    const degrees: PlannedRewardDegree[] = []
    const skippedUnconfigured: number[] = []

    for (const row of rows) {
        const tier = matchConfiguredRewardTier(config, row.rank)
        if (tier === null) continue

        const hasItem = tier.itemId !== null && tier.count > 0
        const degreeId = tier.degreeId ?? null
        const hasDegree = degreeId !== null && degreeId > 0

        if (hasItem) {
            mails.push({
                rank: row.rank,
                playerId: row.playerId,
                itemId: tier.itemId as number,
                count: tier.count,
                subject: config.mailSubject,
                body: renderMailBody(config.mailBody, row.rank)
            })
        }
        if (hasDegree) {
            degrees.push({ rank: row.rank, playerId: row.playerId, degreeId: degreeId as number })
        }
        // 「这一档配了但发不出东西」才算未配置。只发称号不发道具是合法配置。
        if (!hasItem && !hasDegree) skippedUnconfigured.push(row.rank)
    }

    return { mails, degrees, skippedUnconfigured }
}

/**
 * 渲染邮件正文里的占位符。目前只支持 `{rank}`。
 *
 * @param template 正文模板。
 * @param rank 名次。
 */
export function renderMailBody(template: string, rank: number): string {
    return template.replace(/\{rank\}/g, String(rank))
}

/**
 * 结算后算下一次排期。
 *
 * @param config 结算配置。
 * @param settledAtMs 本次结算的时刻。
 * @returns 下次排期时刻;一次性排期返回 null(清空)。
 */
export function nextSettleAtMs(
    config: RushSettlementConfig,
    settledAtMs: number
): number | null {
    const interval = config.repeatIntervalMs
    if (interval === null || interval <= 0) return null

    // 服务端停机跨过了好几个周期时,一路推到「下一个还没到的时刻」,
    // 而不是只加一个周期然后在下一 tick 又立刻触发。
    let next = (config.settleAtMs ?? settledAtMs) + interval
    while (next <= settledAtMs) next += interval
    return next
}

/**
 * 是否到点该自动结算了。
 *
 * @param config 结算配置。
 * @param nowMs 当前真实时间。
 */
export function isSettlementDue(config: RushSettlementConfig, nowMs: number): boolean {
    return config.autoEnabled
        && config.settleAtMs !== null
        && nowMs >= config.settleAtMs
}

/**
 * 校验一份奖励档位配置,返回人类可读的错误列表(空数组=合法)。
 *
 * @param tiers 奖励档位表。
 */
export function validateRewardTiers(tiers: unknown): string[] {
    const errors: string[] = []
    if (!Array.isArray(tiers)) return ["奖励档位必须是数组"]
    if (tiers.length === 0) return ["奖励档位不能为空"]

    tiers.forEach((raw, index) => {
        const label = `第 ${index + 1} 档`
        if (raw === null || typeof raw !== "object") {
            errors.push(`${label}: 不是对象`)
            return
        }
        const tier = raw as Record<string, unknown>
        const from = Number(tier.fromRank)
        const to = tier.toRank === null ? null : Number(tier.toRank)
        const count = Number(tier.count)

        if (!Number.isInteger(from) || from < 1) errors.push(`${label}: fromRank 必须是 ≥1 的整数`)
        if (to !== null && (!Number.isInteger(to) || to < 1)) {
            errors.push(`${label}: toRank 必须是 ≥1 的整数,或 null 表示到榜尾`)
        }
        if (Number.isInteger(from) && to !== null && Number.isInteger(to) && to < from) {
            errors.push(`${label}: toRank 不能小于 fromRank`)
        }
        if (!Number.isInteger(count) || count < 1) errors.push(`${label}: count 必须是 ≥1 的整数`)
        if (tier.itemId !== null && tier.itemId !== undefined) {
            const itemId = Number(tier.itemId)
            if (!Number.isInteger(itemId) || itemId < 1) {
                errors.push(`${label}: itemId 必须是 ≥1 的整数,或留空表示未配置`)
            }
        }
        if (tier.degreeId !== null && tier.degreeId !== undefined) {
            const degreeId = Number(tier.degreeId)
            if (!Number.isInteger(degreeId) || degreeId < 1) {
                errors.push(`${label}: degreeId 必须是 ≥1 的整数,或留空表示不发称号`)
            }
        }
    })

    return errors
}

/**
 * 把任意输入规整成合法的档位数组(调用前应先跑 validateRewardTiers)。
 *
 * @param tiers 原始输入。
 */
export function normalizeRewardTiers(tiers: unknown): RushRewardTier[] {
    if (!Array.isArray(tiers)) return []
    return tiers.map(raw => {
        const tier = raw as Record<string, unknown>
        const itemId = tier.itemId === null || tier.itemId === undefined
            ? null
            : Number(tier.itemId)
        const degreeId = tier.degreeId === null || tier.degreeId === undefined
            ? null
            : Number(tier.degreeId)
        const toRank = tier.toRank === null ? null : Number(tier.toRank)
        return {
            fromRank: Number(tier.fromRank),
            toRank,
            itemId: itemId === null || !Number.isFinite(itemId) ? null : itemId,
            count: Number(tier.count),
            degreeId: degreeId === null || !Number.isFinite(degreeId) ? null : degreeId
        }
    })
}
