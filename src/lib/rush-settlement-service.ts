/**
 * 排行榜赛季结算的接线层:把规则、存储、榜单查询和换期接到一起,
 * 并提供「到点自动结算」的调度器。
 *
 * 结算 = 冻结名次 → 发奖邮件 → 记账 → 换期,**四件事在一个 SQLite 事务里**。
 * 语义与边界见 src/lib/rush-settlement.ts 顶部。
 */

import { getDb } from "../data/db";
import {
    getAllRushSettlementConfigsSync,
    getRushSettlementConfigSync,
    isSeasonSettledSync,
    putRushSettlementConfigSync,
    writeSettlementSync
} from "../data/domains/rushSettlement";
import {
    getRushBotPlayerIdsSync,
    getRushFullRunLeaderboardSync,
    getRushSeasonFirstClearLeaderboardSync,
    rushLeaderboardStore
} from "../data/domains/rushLeaderboard";
import {
    isSettlementDue,
    matchConfiguredRewardTier,
    nextSettleAtMs,
    planRewardMails,
    type RushSettlementConfig
} from "./rush-settlement";
import { computeRushSeasonFingerprint, rolloverRushSeason } from "./rush-leaderboard";
import {
    getRushTowerFolderIdSync,
    isRushSeasonFingerprintStaleSync,
    markRushSeasonRolloverPending,
    noteRushSeasonRollover,
    reanchorRushSeasonInPlace,
    takePendingRushSeasonRollovers
} from "./rush-leaderboard-service";
import { getRushEventFolderMaxRounds } from "./assets";
import { grantPlayerDegreeSync } from "../data/domains/degree";

/** 结算调度一律用真实墙钟 —— 后台「时间控制」平移的是 getServerDate,不能拿来排期。 */
function nowMs(): number {
    return Date.now()
}

/**
 * 结算的结局分类。**换期该不该继续全看它**(见 {@link settleThenRolloverRushSeason}):
 *
 *  · `settled`         —— 结算成功,换期已在同一个事务里做完;
 *  · `already-settled` —— 这一期结算过了(幂等防重命中)。**良性**:再结一次只会重复发奖;
 *  · `empty-season`    —— 这一期一条完整成绩都没有。**良性**,而且必须是**无声 no-op**:
 *                          不发邮件、不写 `rush_season_settlements`、不写快照;
 *  · `no-folder`       —— 这个事件没有多轮 folder,根本没有可结算的榜。**良性**;
 *  · `error`           —— 真出错了(数据库、期号被别的进程改动、写快照失败……)。
 *                          **这一档必须挡住换期**:换掉就再也结算不了了。
 */
export type SettlementCode =
    | "settled"
    | "already-settled"
    | "empty-season"
    | "no-folder"
    | "error"

/**
 * 良性结局:结算没做成,但**没有任何东西可丢**,不该挡住换期。
 *
 * ⚠ 「不挡住」不等于「一定 +1」:`empty-season` 走的是**原地复用**那一支
 * (期号不动,只重新锚定指纹),理由见 {@link settleThenRolloverRushSeason}。
 */
function isBenignSettlementCode(code: SettlementCode): boolean {
    return code === "already-settled" || code === "empty-season" || code === "no-folder"
}

export interface SettlementOutcome {
    ok: boolean
    /** 结局分类;`ok=true` 时恒为 `settled`。 */
    code: SettlementCode
    reason?: string
    settlementId?: number
    season?: number
    nextSeason?: number
    fullRunRows?: number
    seasonFirstRows?: number
    mailCount?: number
    /** 本次授予的称号数(重复授予会被 players_degrees 的主键吃掉,这里是计划数)。 */
    degreeCount?: number
    skippedUnconfiguredRanks?: number[]
    /** 命中奖励档、但存档已被删除,发不了奖励的那些名次。 */
    skippedMissingPlayerRanks?: number[]
    /** 命中奖励档、但是机器人(`excludeBots` 打开时)不发奖的那些名次。 */
    skippedBotRanks?: number[]
    nextSettleAtMs?: number | null
}

/**
 * 立刻结算当期。
 *
 * @param eventId 事件 ID。
 * @param folderId folder ID。
 * @param source 结算来源(`admin-manual` / `scheduler` / `cli`),写进台账。
 * @returns 结算结果;失败时 `ok=false` 且 `reason` 说明原因。
 */
export function settleRushSeasonNow(
    eventId: number,
    folderId: number,
    source: string
): SettlementOutcome {
    const at = nowMs()
    try {
        const config = getRushSettlementConfigSync(eventId, folderId, at)
        const fingerprint = computeRushSeasonFingerprint(getRushEventFolderMaxRounds(eventId))
        // 先把期次台账坐实再结算:台账不存在时若只是「默认当作第 1 期」,换期会从 0+1
        // 算出 1,结算完的期号和新期号撞在一起,下一次结算会被误判成「已结算过」。
        //
        // 刻意**不**走 ensureRushSeason:它带指纹比对,塔的轮数刚好变过时会在结算中途
        // 自己先换一期,于是结算的是一个刚开的空期。结算要settle「现在这一期」,
        // 换期由结算自己在事务里做,不接受隐式换期。
        let seasonRow = rushLeaderboardStore.getSeason(eventId)
        if (seasonRow === null) {
            seasonRow = { eventId, season: 1, startedAtMs: at, fingerprint, source: "settlement-init" }
            rushLeaderboardStore.putSeason(seasonRow)
        }
        const currentSeason = seasonRow.season

        // ── 幂等防重 ────────────────────────────────────────────────────
        // 同一期不许结算两次:作者完全可能先在后台点「立即结算」、再去重摇塔,
        // 而重摇那条路也会先结算。第二次跑过去就是**再发一轮奖**。
        // 判据是 `rush_season_settlements` 里有没有 (event, folder, season) 那行,
        // 而那行是和邮件、快照、换期在同一个事务里写的 ⇒ 「发了奖没记账」不可能发生。
        if (isSeasonSettledSync(eventId, folderId, currentSeason)) {
            return {
                ok: false,
                code: "already-settled",
                reason: `第 ${currentSeason} 期已经结算过了`,
                season: currentSeason
            }
        }

        // 冻结结算必须取全量。展示查询的 BOARD_FETCH_CAP=500 只服务 UI/公告分页；
        // 结算若复用它,第 501 名起永远拿不到 null 尾档。SQLite 的 LIMIT -1 = 不限行。
        // full-run 显式锁定当前期；season-first 保留跨期历史快照,发奖名单在下方收窄当前期。
        const fullRun = getRushFullRunLeaderboardSync(eventId, folderId, -1, currentSeason)
        const seasonFirst = getRushSeasonFirstClearLeaderboardSync(eventId, folderId, -1)

        // ── 空期 = 无声 no-op ───────────────────────────────────────────
        // 「一期里一条完整成绩都没有」时结算必须什么都不做:不发一轮空邮件
        // (奖励档位是按**名次**配的,没有名次就没有收件人,但 rewardRankLimit 之类的
        // 配置改动仍可能凑出奇怪的计划),也不写一条空的 `rush_season_settlements`
        // —— 那行会让这一期变成「已结算」,把幂等防重的语义污染成
        // 「重摇过一次就永远不能再结算了」。
        //
        // 判据必须**两张榜都按当期看**:`fullRun` 在数据层已按期收窄,
        // 而 `seasonFirst` 是跨期历史册(见下面发奖名单那段),
        // 直接看它的长度会把上一期的成绩当成「这一期有人打过」。
        const seasonFirstThisSeason = seasonFirst.filter(record => record.season === currentSeason)
        if (fullRun.length === 0 && seasonFirstThisSeason.length === 0) {
            return {
                ok: false,
                code: "empty-season",
                reason: `第 ${currentSeason} 期一条完整成绩都没有,跳过结算`,
                season: currentSeason
            }
        }
        // ⚠ 「当轮首通榜」是**跨期**的历史册(`getRushSeasonFirstClearLeaderboardSync`
        // 刻意不按期过滤,PARTITION BY season, player_id + ORDER BY season DESC),
        // 快照照抄整张没问题,但**发奖名单必须再收窄到当期**:否则前 N 名里会混进
        // 已经结算过的旧期成绩,「跨期重复发奖」这条老问题在 reward_board
        // = 'season-first' 这一档下没被堵死(而它是后台页上可以随手翻的开关)。
        // 战斗用时榜那一档不需要这一步 —— 它在数据层已经按期收窄了。
        const rewardRecords = config.rewardBoard === "season-first"
            ? seasonFirstThisSeason
            : fullRun

        // 名次按整张榜算(第 1 名就是第 1 名)。战斗用时榜在数据层已按存档去重
        // (作者裁定 2026-08-28「一位玩家只记录他的最优成绩」),所以每个名次
        // 都是不同的存档,不会有人兼领两档。但**已删除的存档不发邮件**:
        // players_mails 对 players 有外键,给不存在的存档插邮件会让整个结算事务失败。
        // 排行榜 runs 表刻意没挂外键(历史成绩要能活过删档),所以这种行确实会出现。
        //
        // 机器人走的是**同一条**「占名次但不发奖」的路(作者裁定 2026-08-28 晚):
        // 名次仍按整张榜算,只是从发奖名单里滤掉。这样游戏内榜的名次和奖励名单的
        // 名次永远一致 —— 剔除法会让第 4 名收到第 2 名的奖励,没有界面能解释。
        const botIds = config.excludeBots ? getRushBotPlayerIdsSync() : new Set<number>()
        const rankedRows = rewardRecords.map((record, index) => ({
            rank: index + 1,
            playerId: record.playerId,
            playerExists: record.playerExists,
            isBot: botIds.has(record.playerId),
            fullRun: record.fullRun
        }))

        // season-first 仍可作为**有限档**的名次来源,但参与尾档只认当期 full-run。
        // 不能把整张 season-first 先过滤后重排:那会让原第 4 名按第 2 名领奖。
        const eligibleTierRows = rankedRows.filter(row => {
            const tier = matchConfiguredRewardTier(config, row.rank)
            if (tier === null) return false
            if (tier.toRank === null && !row.fullRun) return false
            const degreeId = tier.degreeId ?? null
            return (tier.itemId !== null && tier.count > 0)
                || (degreeId !== null && degreeId > 0)
        })
        const missingPlayerRanks = eligibleTierRows
            .filter(row => !row.playerExists)
            .map(row => row.rank)
        const botRanks = eligibleTierRows
            .filter(row => row.playerExists && row.isBot)
            .map(row => row.rank)

        // 只过滤收件资格,不重排行自带 rank:机器人/删档/非完整参与者仍占原名次。
        const plan = planRewardMails(
            rankedRows.filter(row => {
                if (!row.playerExists || row.isBot) return false
                const tier = matchConfiguredRewardTier(config, row.rank)
                return tier === null || tier.toRank !== null || row.fullRun
            }),
            config
        )

        // 快照行上标出「这一名为什么是空的」。两种原因不可能同时命中
        // (isBot 那一支已经要求 playerExists)。
        const skips: Record<number, string> = {}
        for (const rank of missingPlayerRanks) skips[rank] = "deleted"
        for (const rank of botRanks) skips[rank] = "bot"

        let outcome: SettlementOutcome = { ok: false, code: "error", reason: "未执行" }

        // ── 事务边界:冻结 + 发奖 + 记账 + 换期,要么全成要么全不成 ──
        getDb().transaction(() => {
            // 上面读榜是在事务**外**做的。同进程内没问题(全是同步 sqlite、中间没有
            // await),但 `mod-tools/wf_rogue_reroll.py` 是**另一个进程**,它用独立连接
            // 直接 UPDATE rush_event_seasons。万一它恰好在「读榜」和「开事务」之间提交了
            // 一次换期,下面的 rolloverRushSeason 会在已经是 N+1 的基础上再 +1 得到 N+2:
            // 中间那一期永远是一张没人打过的空榜,而这次结算记的却是第 N 期(错账)。
            // 概率极低,代价却是一期空榜 + 一期错账,所以在事务里复核一次期号。
            const nowSeason = rushLeaderboardStore.getSeason(eventId)?.season ?? null
            if (nowSeason !== currentSeason) {
                throw new Error(
                    `结算期间期号被改动(读榜时 ${currentSeason},事务里 ${nowSeason});`
                    + "本次结算已放弃,请确认没有其他进程正在重摇塔后重试")
            }

            const written = writeSettlementSync({
                eventId,
                folderId,
                season: currentSeason,
                settledAtMs: at,
                source,
                nextSeason: currentSeason + 1,
                rewardBoard: config.rewardBoard,
                boards: [
                    { board: "full-run", records: fullRun },
                    { board: "season-first", records: seasonFirst }
                ],
                mails: plan.mails,
                skips,
                note: [
                    plan.skippedUnconfigured.length > 0
                        ? `奖励未配置,跳过名次: ${plan.skippedUnconfigured.join(",")}` : null,
                    missingPlayerRanks.length > 0
                        ? `存档已删除,跳过名次: ${missingPlayerRanks.join(",")}` : null,
                    botRanks.length > 0
                        ? `机器人不发奖,跳过名次: ${botRanks.join(",")}` : null
                ].filter(Boolean).join(" / ") || null
            })

            // 称号不走邮件:`players_degrees` 是拥有集合,直接 grant。
            // 放在同一个事务里,所以「发了称号没换期」不可能发生。
            for (const grant of plan.degrees) {
                grantPlayerDegreeSync(grant.playerId, grant.degreeId)
            }

            // 换期:沿用既有语义(期号 +1 + 作废进行中的 run)
            const rolled = rolloverRushSeason(rushLeaderboardStore, eventId, fingerprint, at, `settlement:${source}`)

            // 顺延下一次排期(一次性排期则清空)
            putRushSettlementConfigSync({
                ...config,
                settleAtMs: nextSettleAtMs(config, at),
                updatedAtMs: at
            })

            outcome = {
                ok: true,
                code: "settled",
                settlementId: written.settlementId,
                season: currentSeason,
                nextSeason: rolled.season,
                fullRunRows: written.fullRunRows,
                seasonFirstRows: written.seasonFirstRows,
                mailCount: written.mailCount,
                degreeCount: plan.degrees.length,
                skippedUnconfiguredRanks: plan.skippedUnconfigured,
                skippedMissingPlayerRanks: missingPlayerRanks,
                skippedBotRanks: botRanks,
                nextSettleAtMs: nextSettleAtMs(config, at)
            }
        })()

        console.log(`[RUSH-LB] settled season ${currentSeason} of ${eventId}/${folderId}`
            + ` source=${source} mails=${outcome.mailCount ?? 0} degrees=${plan.degrees.length}`
            + ` fullRun=${outcome.fullRunRows ?? 0} seasonFirst=${outcome.seasonFirstRows ?? 0}`
            + (plan.skippedUnconfigured.length > 0
                ? ` (奖励未配置,跳过名次 ${plan.skippedUnconfigured.join(",")})` : "")
            + (missingPlayerRanks.length > 0
                ? ` (存档已删除,跳过名次 ${missingPlayerRanks.join(",")})` : "")
            + (botRanks.length > 0
                ? ` (机器人不发奖,跳过名次 ${botRanks.join(",")})` : ""))
        return outcome
    } catch (error) {
        console.error("[RUSH-LB] settlement failed:", error)
        return { ok: false, code: "error", reason: (error as Error).message }
    }
}

/** {@link settleThenRolloverRushSeason} 的结果。 */
export interface SettleThenRolloverOutcome {
    /** 现在的期号;换期没做(被结算失败挡住)或换期本身失败时是 null。 */
    season: number | null
    /**
     * 期号真的往前推了一格吗。
     *
     * `rolled=false` 且 `blocked=false` 只有一种情况:**这一期一条完整成绩都没有**,
     * 于是原地复用它(刷新指纹、作废进行中的 run),不白烧一个不可逆的期号。
     * 调用方的措辞要跟着分岔 —— 报「已开启第 N 期」而实际没动,下次就没人信这行日志了。
     */
    rolled: boolean
    /** 结算真的跑成了吗(false = 结算被跳过或失败)。 */
    settled: boolean
    /**
     * **换期被结算失败挡下了**。
     *
     * true 时期号一格没动:塔可能已经换了,但榜上还挂着旧塔的成绩。
     * 这是**可恢复**的(修好原因后到后台点「结算并开启新一期」),
     * 而换掉期号是**不可恢复**的 —— 所以宁可停在这里。调用方必须把它报出去。
     */
    blocked: boolean
    /** 结算的结局分类,给调用方决定怎么措辞。 */
    code: SettlementCode
    /** 结算没跑成的原因(`settled=true` 时是 undefined)。 */
    reason?: string
    /** 结算成功时的完整结果,给后台页显示发了几封邮件。 */
    settlement?: SettlementOutcome
}

/**
 * **换塔的唯一入口:先结算,再开新一期。**
 *
 * ── 为什么必须捆在一起 ──────────────────────────────────────────
 * 作者原话(2026-08-28):「每次重 roll 塔,排行榜结算,新塔是新榜不会有之前的排行」。
 * 换期那半句本来就实现了,**结算那半句没有** —— 而 {@link settleRushSeasonNow}
 * 只能结算「台账里当前的那一期」(它没有 season 形参,也不该有:冻结名次要现读榜,
 * 旧期的榜早就被后来的成绩改写了)。所以一旦先换了期,上一期的名次冻结和奖励邮件
 * 就**永远补不回来**:`rush_season_results` 里那一期是空的,后台「结算结果」页
 * 对它永远查不到东西。⇒ 顺序不能反,而且不许有第二条只换期的路。
 *
 * ── 结算失败时换期还继不继续(2026-08-28 裁定:**看失败的种类**)──────
 * 早先这里是「照换」,理由是塔在物理上已经被重造了,不换期就是「新塔挂旧成绩」。
 * 现在改成:
 *
 *  · **良性失败照换** —— 这一期已经结算过 / 这个事件根本没有多轮 folder。
 *    这两种都**没有任何东西可丢**,停下来只会让新塔上一直挂着旧塔的榜。
 *  · **空期原地复用,不推期号** —— 「这一期一条完整成绩都没有」时 +1 只会在台账里
 *    留下一段没人打过的空榜,而期号不可逆。改成刷新指纹 + 作废进行中的 run,
 *    期号保持不动(`rolled=false`,见 {@link SettleThenRolloverOutcome.rolled})。
 *  · **真失败挡住换期** —— 数据库错、期号被别的进程改动、写快照/发邮件炸了。
 *    这一档必须停:
 *      ① 「塔换了但榜没换期」是**可恢复**的 —— 修好原因后到后台点
 *         「结算并开启新一期」,名次和奖励一分不少;
 *      ② 「换了期但没结算」是**不可恢复**的 —— 结算只能结算台账里当前那一期,
 *         上一期的名次冻结和奖励邮件永远补不回来。
 *    一边可恢复一边不可恢复,那就没什么好权衡的了(作者原话:宁可塔没换,
 *    别把成绩丢了)。调用方拿到 `blocked=true` 必须把原因喊出来。
 *
 * @param eventId 事件 ID。
 * @param source 来源(`admin-manual` / `reroll-hook` / `reroll-cli` / `gui-*` /
 *        `fingerprint`),写进台账和结算备查。
 * @returns 新期号 + 结算是否真的跑成了 + 换期是否被挡下。
 */
export function settleThenRolloverRushSeason(
    eventId: number,
    source: string
): SettleThenRolloverOutcome {
    let settlement: SettlementOutcome | null = null
    try {
        const folderId = getRushTowerFolderIdSync(eventId)
        settlement = folderId === null
            ? { ok: false, code: "no-folder", reason: "这座塔没有可结算的 folder" }
            : settleRushSeasonNow(eventId, folderId, source)
    } catch (error) {
        console.error("[RUSH-LB] settle-before-rollover failed:", error)
        settlement = { ok: false, code: "error", reason: (error as Error).message }
    }

    // 结算成功时它**自己已经在同一个事务里换过期了**(见上面那句 rolloverRushSeason),
    // 再换一次就是一次重摇跳两期、中间夹一张没人打过的空榜。
    if (settlement.ok) {
        return {
            season: settlement.nextSeason ?? null,
            rolled: true,
            settled: true,
            blocked: false,
            code: settlement.code,
            settlement
        }
    }

    const reason = settlement.reason ?? "结算失败(无原因)"
    if (!isBenignSettlementCode(settlement.code)) {
        console.error(`[RUSH-LB] ⛔ season NOT rolled: event=${eventId} source=${source}`
            + ` reason=${reason}。塔可能已经换了,但榜还留在第`
            + ` ${settlement.season ?? "?"} 期 —— 这是刻意的:换掉期号之后这一期`
            + `再也结算不了。修好上面这个原因后到后台点「结算并开启新一期」补上。`)
        return {
            season: null, rolled: false, settled: false, blocked: true,
            code: settlement.code, reason
        }
    }

    // ── 空期不烧期号(2026-08-28 三轮复核)──────────────────────────────
    // 「这一期一条完整成绩都没有」时再 +1,换来的只是台账里一段没人打过的空榜,
    // 而期号推进不可逆。真实触发路径不止一条:
    //   · 后台点「立即结算」(它自己已经在结算事务里换到 N+1)之后再游戏内重摇
    //     ⇒ 第二刀落在刚开张的空期上,白烧一格;
    //   · CLI 回调超时(30s)但服务端其实已经处理完,操作者按提示去后台再点一次。
    // ⇒ 原地复用这一期:刷新指纹(不刷的话指纹兜底会一直认为塔没收口)、
    //   重记开张时刻、并**照常作废进行中的 run**(空期 ≠ 没人在爬 —— run 要打完
    //   才会产生榜行,有人爬到一半时换塔那一程必须作废)。
    if (settlement.code === "empty-season") {
        const reanchored = reanchorRushSeasonInPlace(eventId, source)
        console.warn(`[RUSH-LB] season reused (nobody played it): event=${eventId}`
            + ` source=${source} season=${reanchored?.season ?? "?"} reason=${reason}`)
        return {
            season: reanchored?.season ?? null,
            rolled: false,
            settled: false,
            // 复用失败(台账读写炸了)才算被挡住:那时连指纹都没刷新,要喊人。
            blocked: reanchored === null,
            code: settlement.code,
            reason
        }
    }

    console.warn(`[RUSH-LB] rollover without settlement: event=${eventId} source=${source}`
        + ` code=${settlement.code} reason=${reason}`)
    const rolled = noteRushSeasonRollover(eventId, source)
    return {
        season: rolled?.season ?? null,
        rolled: rolled !== null,
        settled: false,
        // 换期本身炸了也算被挡住:期号一格没动,调用方同样要喊出来。
        blocked: rolled === null,
        code: settlement.code,
        reason
    }
}

/**
 * 把「指纹兜底发现塔变了」的待办消化掉:先结算,再换期。
 *
 * 这是指纹兜底那条路的**后半截**,而且现在只服务两种落网之鱼:
 *  · 漂移是在**第 2 关及以后**被发现的(那一程本来就已经注定作废,不值得在
 *    玩家爬塔中途做结算);
 *  · 第 1 关那次**当场收口失败**(结算真炸了 ⇒ 换期被主动挡下)。
 * 第 1 关正常情况下已经在 `noteRushRoundStart` 里同步结算 + 换期了 ——
 * 不那么做的话,触发检测的那一程会被这里 30 秒后的换期连根拔掉,
 * 玩家白爬一整座塔(见 `settleStaleRushSeasonBeforeStart` 的长注释)。
 *
 * 取走待办之后会**重新核对指纹**:待办是进程内内存,这中间可能已经有别的入口
 * (后台按钮 / CLI / 重摇钩子)把期换掉了,那时指纹已经对上,不该再白换一期。
 *
 * @returns 本次真的动过的事件及其结果。
 */
export function drainPendingRushSeasonRollovers(): SettleThenRolloverOutcome[] {
    const done: SettleThenRolloverOutcome[] = []
    for (const eventId of takePendingRushSeasonRollovers()) {
        try {
            if (!isRushSeasonFingerprintStaleSync(eventId)) continue
            console.log(`[RUSH-LB] fingerprint drift settled+rolled by scheduler: event=${eventId}`)
            const outcome = settleThenRolloverRushSeason(eventId, "fingerprint")
            // 被挡住了(真失败)⇒ 待办放回去,下一 tick 再试;否则这次漂移就此消失,
            // 只有下一个开第 1 关的玩家才会重新标记它。
            if (outcome.blocked) markRushSeasonRolloverPending(eventId)
            done.push(outcome)
        } catch (error) {
            console.error("[RUSH-LB] pending season rollover failed:", error)
            markRushSeasonRolloverPending(eventId)
        }
    }
    return done
}

/**
 * 扫一遍所有配置,把到点的都结算掉。调度器每 tick 调一次;也可以手动调。
 *
 * @returns 本次真正结算了的 (事件, folder) 列表。
 */
export function runDueRushSettlements(): SettlementOutcome[] {
    // 先消化指纹漂移:它本身也可能刚给某个事件换了期,
    // 让下面的到点结算读到最新的期号。
    drainPendingRushSeasonRollovers()

    const results: SettlementOutcome[] = []
    let configs: RushSettlementConfig[] = []
    try {
        configs = getAllRushSettlementConfigsSync()
    } catch (error) {
        console.error("[RUSH-LB] settlement scan failed:", error)
        return results
    }

    const at = nowMs()
    for (const config of configs) {
        if (!isSettlementDue(config, at)) continue
        const outcome = settleRushSeasonNow(config.eventId, config.folderId, "scheduler")
        // 空期是**无声 no-op**,连排期都不会被 settleRushSeasonNow 顺延(它在开事务之前
        // 就返回了)。不在这里补一手的话:排期时刻永远停在过去,调度器每 30 秒重试一次,
        // 而等到某天真有人打出成绩,会在下一 tick **立刻**被结算掉 —— 「到点结算」就成了
        // 「谁先通关谁触发」。所以照常顺延:到点了、只是没人有成绩,这次排期就算用掉了。
        //
        // 刻意只在调度器里做,不做进 settleRushSeasonNow:后台那颗「立即结算」
        // 撞上空期时不该把作者排好的下一次结算悄悄取消掉。
        if (outcome.code === "empty-season") {
            try {
                putRushSettlementConfigSync({
                    ...config,
                    settleAtMs: nextSettleAtMs(config, at),
                    updatedAtMs: at
                })
                console.log(`[RUSH-LB] scheduled settlement skipped (empty season):`
                    + ` ${config.eventId}/${config.folderId} → 下次排期 ${nextSettleAtMs(config, at)}`)
            } catch (error) {
                console.error("[RUSH-LB] empty-season schedule advance failed:", error)
            }
        }
        results.push(outcome)
    }
    return results
}

let schedulerTimer: NodeJS.Timeout | null = null

/**
 * 启动「到点自动结算」调度器。
 *
 * 刻意不在模块加载时自启 —— 那样测试进程会被 timer 吊住。由 cn-server 显式调用。
 *
 * @param intervalMs 轮询间隔,默认 30 秒(结算是分钟级的事,不需要更密)。
 */
export function startRushSettlementScheduler(intervalMs: number = 30_000): void {
    if (schedulerTimer !== null) return
    schedulerTimer = setInterval(() => {
        try {
            runDueRushSettlements()
        } catch (error) {
            console.error("[RUSH-LB] scheduler tick failed:", error)
        }
    }, intervalMs)
    // 不要因为这个定时器就让进程无法退出
    schedulerTimer.unref?.()
    console.log(`[RUSH-LB] settlement scheduler started (every ${Math.round(intervalMs / 1000)}s, real wall clock)`)
}

/** 停掉调度器(测试和优雅关闭用)。 */
export function stopRushSettlementScheduler(): void {
    if (schedulerTimer === null) return
    clearInterval(schedulerTimer)
    schedulerTimer = null
}
