/**
 * 深渊连战排行榜的接线层:把纯规则(lib/rush-leaderboard)、SQLite 存储
 * (data/domains/rushLeaderboard)和资产表(lib/assets)接到游戏主流程上。
 *
 * 铁律:这里所有对外函数都吞异常。排行榜是旁挂功能,任何错误都不许把
 * `battle/start` 或 `single_battle_quest/finish` 拖崩 —— 玩家正在打塔。
 */

import {
    computeRushSeasonFingerprint,
    ensureRushSeason,
    planRoundFinish,
    planRunStart,
    reanchorRushSeason,
    rolloverRushSeason,
    type EnsureRushSeasonResult,
    type RushSeason
} from "./rush-leaderboard";
import {
    abandonPlayerRushRunSync,
    rushLeaderboardStore
} from "../data/domains/rushLeaderboard";
import { getRushEventFolderMaxRounds } from "./assets";
import { getPlayerSync } from "../data/domains/player";
import { ABYSS_ENDURANCE_EVENT, ABYSS_ENDURANCE_FOLDER, grantAbyssEnduranceDegreesSync } from "./abyss-endurance-degree-reward";

/** 计时一律用真实系统时间:后台「时间控制」能平移服务器时间,拿它算用时会出负数。 */
function nowMs(): number {
    return Date.now()
}

function fingerprintOf(eventId: number): string {
    return computeRushSeasonFingerprint(getRushEventFolderMaxRounds(eventId))
}

/**
 * 「指纹兜底发现塔变了、但还没结算+换期」的待办集合。
 *
 * 为什么是**进程内内存**而不是落库:这个待办完全可以从台账重新推导出来 ——
 * 只要 `rush_event_seasons.fingerprint` 还是旧的,下一个开第 1 关的玩家就会再标一次
 * ({@link noteRushRoundStart})。进程重启丢掉它没有任何后果,
 * 换来的是这条同步链路上一次数据库写都不多加。
 *
 * 消费者是 `rush-settlement-service.ts` 的调度器(每 30 秒一次),
 * 它取走之后会**重新核对**指纹,所以脏待办也不会造成一次假换期。
 */
const pendingSeasonRollovers = new Set<number>()

/** 记一笔「这个事件的塔变了,等调度器来结算+换期」。 */
export function markRushSeasonRolloverPending(eventId: number): void {
    pendingSeasonRollovers.add(eventId)
}

/** 取走全部待办(取走即清空;调用方负责重新核对指纹)。 */
export function takePendingRushSeasonRollovers(): number[] {
    const pending = [...pendingSeasonRollovers]
    pendingSeasonRollovers.clear()
    return pending
}

/** 只看一眼有哪些待办(后台/测试用,不清空)。 */
export function peekPendingRushSeasonRollovers(): number[] {
    return [...pendingSeasonRollovers]
}

/**
 * 台账里那行指纹和现在算出来的对不上吗?
 *
 * 调度器在真的动手换期之前用它复核一次:待办是内存里的,
 * 而这中间可能已经有别的入口(后台按钮 / CLI)把期换掉了。
 *
 * @param eventId 事件 ID。
 * @returns true = 塔在服务端看得见的那一层确实变过;读不出台账时一律 false(宁可不换)。
 */
export function isRushSeasonFingerprintStaleSync(eventId: number): boolean {
    try {
        const existing = rushLeaderboardStore.getSeason(eventId)
        if (existing === null) return false
        return existing.fingerprint !== fingerprintOf(eventId)
    } catch (error) {
        console.error("[RUSH-LB] fingerprint check failed:", error)
        return false
    }
}

/**
 * 取某事件的「主塔 folder」—— 轮数最多的那个 folder。
 * 700099 的 folder 1 有 30 轮(深渊连战本体),folder 2 是无尽(0 轮)。
 *
 * @param eventId 事件 ID。
 * @returns folder ID;该事件没有多轮 folder 时返回 null。
 */
export function getRushTowerFolderIdSync(eventId: number): number | null {
    const maxRounds = getRushEventFolderMaxRounds(eventId)
    let bestFolder: number | null = null
    let bestRounds = 0
    for (const [folder, rounds] of Object.entries(maxRounds)) {
        if (rounds > bestRounds) {
            bestRounds = rounds
            bestFolder = Number(folder)
        }
    }
    return bestFolder
}

/** 某事件某 folder 的总轮数(深渊连战 = 30)。 */
export function getRushFolderTotalRoundsSync(eventId: number, folderId: number): number {
    return getRushEventFolderMaxRounds(eventId)[folderId] ?? 0
}

/**
 * 只读地看一眼该事件的期号 —— 后台的 GET 端点用这个。
 *
 * 刻意不建/不推进台账:GET 不该有副作用,否则光是打开排行榜页就会给
 * 几十个从没玩过的连战写上「第 1 期」。台账在第一关开打时(noteRushRoundStart)
 * 自然建立。
 *
 * @param eventId 事件 ID。
 * @returns 期次台账;还没开打过则为 null。
 */
export function peekRushSeasonSync(eventId: number): RushSeason | null {
    try {
        return rushLeaderboardStore.getSeason(eventId)
    } catch (error) {
        console.error("[RUSH-LB] season peek failed:", error)
        return null
    }
}

export interface RushRoundStartInput {
    playerId: number
    eventId: number
    folderId: number
    round: number
}

/**
 * 指纹兜底发现塔变了时的收口:**第 1 关当场结算 + 换期**,其余关次只挂待办。
 *
 * ── 为什么第 1 关不能只挂待办(20260828 三轮复核抓到的洞)────────────────
 * 上一版这里一律「标记待办 + 调度器 30 秒后补」,理由是「玩家请求里不能做重活」。
 * 可**这一程正是在这个请求里出生的**:它会被开在**旧**期上,而 30 秒后那次换期的
 * `abandonActiveRuns` 会把它连根拔掉 —— 之后 `noteRushRoundFinish` 找不到 active run
 * 就什么都不记,下一关 `planRunStart` 走 `adopt` 开出 `trackedFromRound=2` 的 run,
 * 永远不合 `isFullRunRecord`。玩家(本机就是作者自己)安安静静白爬一整座 30 层塔,
 * 榜上一行都不留,而且没有任何提示。
 *
 * 「重活」这个理由在这一刻并不成立:漂移**每次只需处理一次** —— 处理完指纹就对上了,
 * 后续每个请求都是零成本的一次比较。而这一次的代价(读两张榜 + 写快照 + 插邮件)
 * 换来的是「这一程算数」。
 *
 * round > 1 才退回挂待办:漂移意味着 folder→轮数变过,而这个存档正爬着的那一程
 * 多半已经注定作废 —— 若变的正是它所在的 folder,`planRunStart` 的 `tower-resized`
 * 分支下一关就会把它作废;即便变的是同事件的**别的** folder,调度器那次换期也会
 * 一并作废它(`rolloverRushSeason` 按事件作废)。既然救不回来,就没必要在别人
 * 爬到一半的请求里做一次结算 —— 那才是真的「玩家请求里的重活」。
 *
 * 整段吞异常:排行榜是旁挂功能,收口失败也得让玩家照常开关卡(退回挂待办)。
 *
 * @param eventId 事件 ID。
 * @param round folder 内轮号。
 * @param ensured 换期前那次 `ensureRushSeason` 的结果(收口没做成时原样返回)。
 * @param fingerprint 当前塔的指纹。
 * @returns 收口之后重新读到的期次(没收口成功就是传进来的那个)。
 */
function settleStaleRushSeasonBeforeStart(
    eventId: number,
    round: number,
    ensured: EnsureRushSeasonResult,
    fingerprint: string
): EnsureRushSeasonResult {
    const stale = ensured.season
    const drift = `event=${eventId} season=${stale.season}`
        + ` (台账里是 "${stale.fingerprint}",实际算出 "${fingerprint}")`
    if (round > 1) {
        markRushSeasonRolloverPending(eventId)
        console.warn(`[RUSH-LB] ⚠ FINGERPRINT MISMATCH: ${drift}。`
            + ` 这一关不是第 1 关(这一程本来就已经作废),挂待办交给结算调度器收口。`)
        return ensured
    }

    try {
        // 延迟 require 打破模块环:rush-settlement-service 在模块顶层 import 了本文件。
        // 与 `src/data/domains/player.ts` 里那处同一手法;调用时机在两边都加载完之后。
        const settlement =
            require("./rush-settlement-service") as typeof import("./rush-settlement-service")
        const outcome = settlement.settleThenRolloverRushSeason(eventId, "fingerprint")
        if (outcome.blocked) {
            // 结算真失败 ⇒ 期号一格没动(刻意的)。挂待办让调度器继续重试,
            // 这一程只能记在旧期上 —— 但至少它没被一次「先换期后结算」白白作废。
            markRushSeasonRolloverPending(eventId)
            console.error(`[RUSH-LB] ⛔ FINGERPRINT MISMATCH 收口失败: ${drift}:`
                + ` ${outcome.reason ?? "未知原因"}。榜仍是上一座塔的成绩,`
                + ` 修好原因后到后台点「结算并开启新一期」。`)
            return ensured
        }
        console.log(`[RUSH-LB] fingerprint drift settled+rolled at round 1: ${drift}`
            + ` → 第 ${outcome.season} 期(${outcome.rolled ? "期号已推进" : "复用刚开的空期"};`
            + `${outcome.settled ? "已结算发奖" : `未结算:${outcome.reason ?? "未知原因"}`})`)
        // 重新读一次:换期之后期号/指纹都变了,这一程要出生在**新**一期里。
        return ensureRushSeason(rushLeaderboardStore, eventId, fingerprint, nowMs())
    } catch (error) {
        markRushSeasonRolloverPending(eventId)
        console.error(`[RUSH-LB] fingerprint drift handling failed (${drift}):`, error)
        return ensured
    }
}

/**
 * 玩家开始打某一关时调用。第 1 关开新 run,后续关沿用。
 *
 * @param input 关卡上下文(round 为 folder 内轮号,无尽模式的 0 会被忽略)。
 */
/**
 * 幻想连战 700098 不进排行榜(第 5/10/15 关走
 * 多人 AdventEvent 结算,`src/multi/http/battle.ts` 没有榜钩子,期次开了永远收不了榜)
 * 不进台账。2026-09-02 作者裁决"幻想系列不能覆盖深渊"的排行榜口径;其余 rush 事件行为不变。
 */
const RUSH_LEADERBOARD_EXCLUDED_EVENT_IDS: ReadonlySet<number> = new Set([700098])

export function isRushLeaderboardTrackedEvent(eventId: number): boolean {
    return !RUSH_LEADERBOARD_EXCLUDED_EVENT_IDS.has(Number(eventId))
}

export function noteRushRoundStart(input: RushRoundStartInput): void {
    try {
        const { playerId, eventId, folderId, round } = input
        if (!isRushLeaderboardTrackedEvent(eventId)) return
        // 无尽模式(round 0)有它自己的官方排行榜,不进这个榜。
        if (round <= 0) return

        const totalRounds = getRushFolderTotalRoundsSync(eventId, folderId)
        if (totalRounds <= 0) return

        // 指纹兜底:塔在服务端看得见的那一层(folder→轮数)被改过 ⇒ 该「结算 + 换期」。
        // **换期永远不许绕过结算**(20260828 作者裁定):结算只能结算「台账里当前那一期」,
        // 期号一旦被悄悄推走,上一期的名次冻结和奖励邮件就永远补不回来。
        // 真正动手的分档见 {@link settleStaleRushSeasonBeforeStart}。
        const fingerprint = fingerprintOf(eventId)
        let ensured = ensureRushSeason(rushLeaderboardStore, eventId, fingerprint, nowMs())
        if (ensured.staleFingerprint) {
            ensured = settleStaleRushSeasonBeforeStart(eventId, round, ensured, fingerprint)
        }
        const season = ensured.season
        // ⚠ 必须在上面那次可能发生的换期**之后**再取 run:换期会把该事件下所有
        // 进行中的 run 作废,拿换期前的快照去 planRunStart 会去 update 一条已经
        // 作废的 run(第 1 关那条路只是多作废一次,但顺序错了迟早出别的洋相)。
        const active = rushLeaderboardStore.getActiveRun(playerId, eventId, folderId)
        const plan = planRunStart(active, {
            playerId,
            playerName: getPlayerSync(playerId)?.name ?? null,
            eventId,
            folderId,
            round,
            totalRounds,
            season: season.season,
            nowMs: nowMs()
        })

        if (plan.abandonRunId !== null) {
            rushLeaderboardStore.updateRun(plan.abandonRunId, { status: "abandoned", endedAtMs: nowMs() })
        }
        if (plan.open !== null) {
            const opened = rushLeaderboardStore.insertRun(plan.open)
            console.log(`[RUSH-LB] run ${plan.reason}: id=${opened.id} player=${playerId} event=${eventId} `
                + `folder=${folderId} season=${season.season} round=${round}/${totalRounds}`)
        }
    } catch (error) {
        console.error("[RUSH-LB] round start tracking failed:", error)
    }
}

export interface RushRoundFinishInput {
    playerId: number
    eventId: number
    folderId: number
    round: number
    accomplished: boolean
    elapsedMs: number
    characterIds: (number | null)[]
    unisonCharacterIds: (number | null)[]
}

/**
 * 某一关结算后调用。累计净战斗时间、推进进度,打完最终关则收榜。
 *
 * @param input 结算上下文。
 */
export function noteRushRoundFinish(input: RushRoundFinishInput): void {
    try {
        const { playerId, eventId, folderId, round } = input
        if (!isRushLeaderboardTrackedEvent(eventId)) return
        if (round <= 0) return

        const totalRounds = getRushFolderTotalRoundsSync(eventId, folderId)
        if (totalRounds <= 0) return

        const active = rushLeaderboardStore.getActiveRun(playerId, eventId, folderId)
        const plan = planRoundFinish(active, {
            round,
            totalRounds,
            accomplished: input.accomplished,
            elapsedMs: input.elapsedMs,
            nowMs: nowMs(),
            characterIds: input.characterIds,
            unisonCharacterIds: input.unisonCharacterIds
        })
        if (plan === null) return

        rushLeaderboardStore.updateRun(plan.runId, plan.patch)
        if (plan.completed) {
            if (eventId === ABYSS_ENDURANCE_EVENT && folderId === ABYSS_ENDURANCE_FOLDER) {
                grantAbyssEnduranceDegreesSync(playerId)
            }
            console.log(`[RUSH-LB] run completed: id=${plan.runId} player=${playerId} event=${eventId} `
                + `folder=${folderId} rounds=${totalRounds} durationMs=${plan.patch.durationMs} `
                + `battleMs=${plan.patch.battleMs}`)
        }
    } catch (error) {
        console.error("[RUSH-LB] round finish tracking failed:", error)
    }
}

/**
 * 整段重置(放弃重打)时调用:当前 run 作废,不进榜。
 *
 * @param playerId 存档 ID。
 * @param eventId 事件 ID。
 * @param folderId folder ID;不给就作废该事件下这个存档的所有 folder。
 */
export function noteRushRunAbandoned(playerId: number, eventId: number, folderId?: number): void {
    try {
        if (!isRushLeaderboardTrackedEvent(eventId)) return
        const targets = folderId === undefined
            ? Object.keys(getRushEventFolderMaxRounds(eventId)).map(Number)
            : [folderId]
        let abandoned = 0
        for (const folder of targets) {
            abandoned += abandonPlayerRushRunSync(playerId, eventId, folder, nowMs())
        }
        if (abandoned > 0) {
            console.log(`[RUSH-LB] run abandoned: player=${playerId} event=${eventId} rows=${abandoned}`)
        }
    } catch (error) {
        console.error("[RUSH-LB] abandon tracking failed:", error)
    }
}

/**
 * **低层**换期:期号 +1,作废进行中的 run。**不结算、不发奖。**
 *
 * ⚠ 别在新代码里直接调它 —— 唯一合法的调用点是
 * `settleThenRolloverRushSeason()` 里「结算被良性拒绝(这一期是空的 / 已经结算过)」
 * 那条兜底。绕开那个函数直接换期 = 上一期的名次冻结和奖励邮件永远补不回来
 * (结算只能结算台账里当前那一期)。
 *
 * @param eventId 事件 ID。
 * @param source 换期来源,写进台账备查。
 * @returns 新的期次台账;出错时返回 null。
 */
export function noteRushSeasonRollover(eventId: number, source: string): RushSeason | null {
    try {
        const rolled = rolloverRushSeason(rushLeaderboardStore, eventId, fingerprintOf(eventId), nowMs(), source)
        console.log(`[RUSH-LB] season rollover: event=${eventId} season=${rolled.season} source=${source}`)
        return rolled
    } catch (error) {
        console.error("[RUSH-LB] season rollover failed:", error)
        return null
    }
}

/**
 * **期号不动**地把当前这一期重新锚到现在这座塔(刷新指纹 + 作废进行中的 run)。
 *
 * ⚠ 同样别在新代码里直接调 —— 唯一合法的调用点是 `settleThenRolloverRushSeason()`
 * 里「这一期一条完整成绩都没有」那条分支:空期再 +1 只会在台账里留下一段
 * 没人打过的空榜,而期号推进不可逆。语义见 {@link reanchorRushSeason}。
 *
 * @param eventId 事件 ID。
 * @param source 来源,写进台账备查。
 * @returns 重新锚定后的期次台账;台账里没有这个事件、或出错时返回 null。
 */
export function reanchorRushSeasonInPlace(eventId: number, source: string): RushSeason | null {
    try {
        const reanchored = reanchorRushSeason(
            rushLeaderboardStore, eventId, fingerprintOf(eventId), nowMs(), source)
        if (reanchored === null) {
            console.warn(`[RUSH-LB] season reanchor skipped (no ledger row): event=${eventId}`)
            return null
        }
        console.log(`[RUSH-LB] season reanchored in place (empty season):`
            + ` event=${eventId} season=${reanchored.season} source=${source}`)
        return reanchored
    } catch (error) {
        console.error("[RUSH-LB] season reanchor failed:", error)
        return null
    }
}
