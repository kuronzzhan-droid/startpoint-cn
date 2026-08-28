/**
 * 深渊连战排行榜 —— 计时/轮次的判定规则(纯逻辑层)。
 *
 * 这一层不碰数据库:所有读写都通过 RushLeaderboardStore 注入,
 * 便于用内存实现做单元测试(src/tests/rush-leaderboard.test.ts)。
 * SQLite 实现见 src/data/domains/rushLeaderboard.ts。
 *
 * ── 计时口径(作者裁定 2026-08-28,推翻 08-27 的墙钟口径)──────────
 *  一次 run(单次挑战)= 从第 1 关 `battle/start` 到最终关 `finish` 结算。
 *   • **成绩 = battleMs(战斗用时)= 同一次爬塔里各关 elapsed_time_ms 之和**,
 *     只累计打赢的关。关间选队/整备/读条/掉线一律不计。
 *     排行榜的**排序键、去重键、显示值**全部是它。
 *     实现上精确地说是「这一程所有**获胜**结算的时间之和」:进度用 max 去重,
 *     battleMs 是无条件累加,所以重打一遍已通关的层会再加一次。
 *     偏差方向恒为保守(只会变慢,刷不了榜),故本轮不改。
 *   • durationMs(全程墙钟)= finishedAtMs - startedAtMs。**不再参与任何排序**,
 *     降级为两个用途:(a)「这一程确实跑完并收榜了」的标记;
 *     (b) 后台排查「关间被整备/掉线吃了多久」的唯一依据。别把它删掉。
 *   • 失败一关不中断 run:battleMs 不加、进度不推进。
 *     ⚠ 旧口径里失败的代价体现在墙钟上;换成 battleMs 后**失败几乎零成本**,
 *     「开局不顺就秒死重开」变成纯收益。这是本次口径变更的**已知副作用**
 *     (作者裁定:算的就是那 30 关的结算时间,不加罚时、不加失败次数排序键),
 *     不是 bug。
 *   • battleMs 是 NOT NULL DEFAULT 0:0 不是「没有」而是「不可信」,
 *     入榜条件一律写 `battle_ms > 0`,绝不能写 `IS NOT NULL`(恒真)。
 *   • 已知信任边界(本轮**不加**闸门,记在这里免得下一个人以为是漏改了):
 *     ① 跳关连续性没有证据 —— 收榜判据只有 `round >= totalRounds`、进度取的是
 *        max 不是 count,表里也没有逐关流水。「必须同一次从第 1 关连爬到顶」
 *        在实现里只等价于「同一条 active 行没被作废」,协议层面挡不住跳关;
 *     ② 单关 elapsed_time_ms 无上限钳制 —— 它从展示用的次要列升级成了决定名次的
 *        唯一值,而它的唯一来源是客户端自报的 `body.elapsed_time_ms`,
 *        服务端只做 `Math.max(0, trunc)` 的下限消毒,不设上限、不与服务端时刻交叉比对。
 *     ③ 多人房打的关**完全不计时** —— 采集只挂在单人链路上
 *        (`/rush_event/…start` → noteRushRoundStart、`/single_battle_quest/finish`
 *        → noteRushRoundFinish);`src/multi/http/battle.ts` 两端都没有钩子,
 *        它的 start 也不校验 category,RUSH_EVENT 能原样开起来。
 *        所以「第 1 关单人开、中间走多人房、最后一关单人打完」会产出一条
 *        rounds_cleared=30 而 battle_ms 只含两关的成绩(进度取 max,看不出缺关)。
 *        本轮按裁定不加闸门;要堵的话最小改法是在多人 start 拒掉 RUSH_EVENT。
 *   • 整段重置 / 中途从第 1 关重开 / 换期 ⇒ 旧 run 作废(abandoned),不进榜。
 *   • 时间戳一律取 **真实系统时间** Date.now(),不走 getServerDate():
 *     后台的「时间控制」能把服务器时间任意平移,拿它计时会算出负数用时。
 *
 * ── 轮次(期)裁定 ─────────────────────────────────────────────
 *  服务端没有任何「深渊连战期数」的原生字段:assets/rush_event_quest.json 里
 *  700099 的 30 行除轮号外完全同构,重摇塔(wf_rogue_reroll)换的是 CDN 战斗
 *  数据,不改这张表。所以按作者给的兜底口径,以「塔被重造」为轮次边界。
 *
 *  **换期只有一个函数:`settleThenRolloverRushSeason()`(先结算再换期)。**
 *  所有入口都必须经过它 —— 作者原话「每次重 roll 塔,排行榜结算,新塔是新榜」。
 *  现有入口(2026-08-28 收口后):
 *   1. 服务端 /rush_event/reset 的塔重摇钩子(`src/routes/api/rushEvent.ts`),
 *      子进程成功退出后回调,来源 `reroll-hook`;只有**游戏内**按整段重置才走到;
 *   2. 后台「结算并开启新一期」按钮
 *      (`POST /api/rush-leaderboard/:eventId/season/rollover`),来源 `admin-manual`;
 *   3. CLI `mod-tools/wf_rogue_reroll.py` —— 它**不再自己写 SQL 换期**,
 *      改成回调上面第 2 条那个端点(见该脚本 `rollover_via_server`);
 *   4. GUI 的两条「重建整座塔并发布」入口(难度曲线/重摇 的应用+发布、⑥ 面板的
 *      📤 发布)—— 同样回调第 2 条那个端点,但先用**楼层指纹**判定这是不是真换塔,
 *      只动一层的小修不换期(见 `mod-tools/wf_gui.py::rogue_season_sync`);
 *   5. 兜底: folder 轮数指纹变了(--rounds 改过)⇒ 由调度器补一次结算+换期,
 *      来源 `fingerprint`。**注意它不再在玩家请求里就地换期**,理由见
 *      {@link EnsureRushSeasonResult.staleFingerprint}。
 *  单纯的「整段重置重打同一座塔」**不换期** —— 那是同一期里的又一次挑战,
 *  否则「当轮首通」会退化成「每次通关」,榜就没有意义了。
 *  (本机 .env 开着 `WF_ROGUE_REROLL_ON_RESET`,所以游戏内整段重置**会**走第 1 条
 *   而真的换塔换期;120 秒冷却期内没真拉起重摇的那些重置不换期。)
 *
 * ── 为什么 CLI / GUI 那几条也必须自己喊一声(2026-08-28 实证)─────────
 *  作者惯用的重摇入口是 GUI 工具箱「深渊连战·一键重开」/ 命令行
 *  `python mod-tools/wf_rogue_reroll.py --apply`。这两条路**都不经过 8001**:
 *    · `mod-tools/wf_gui.py` 直接 `_rogue_run("wf_rogue_reroll.py", …)`
 *      拉子进程,不发任何 HTTP;
 *    · 上面第 1 条那个钩子挂在 `POST /rush_event/reset` 上,
 *      游戏里不按重置就永远不触发;
 *    · 第 5 条(指纹)只认 folder→轮数,默认 `--rounds 30` 重摇前后都是 `1:30`,
 *      指纹不变 ⇒ 它察觉不到换了一座塔。
 *  ⇒ 不接线的话:重摇一百次塔,期号仍是第 1 期,「新塔新榜」永远不会发生。
 *  第一版把换期动作抄进了 `wf_rogue_reroll.py` 自己(直接写 SQL),但那样**只换期
 *  不发奖**;20260828 收口改成回调后台端点,让服务端在同一个事务里先结算再换期。
 *  服务端钩子拉起子进程时仍显式带 `--keep-season`(它自己那侧已经换过期了),
 *  免得同一次重摇换两期。
 *
 * ── 榜按期分桶 ────────────────────────────────────────────────
 *  「战斗用时榜」只列**当前期**的成绩(`getRushFullRunLeaderboardSync` 的
 *  season 参数,由 `getRushBoardRecordsSync` 现读台账喂进去)。换期之后榜是空的,
 *  直到有人在新塔上爬完一程;旧成绩仍留在 `players_rush_event_runs` 和结算快照
 *  `rush_season_results` 里,只是不再上当期榜。
 *  这条顺带消灭了「跨期重复发奖」——第 2 期的发奖名单不可能逐行等于第 1 期。
 */

export type RushRunStatus = "active" | "completed" | "abandoned"

export interface RushRun {
    id: number
    playerId: number
    playerName: string | null
    eventId: number
    folderId: number
    season: number
    status: RushRunStatus
    /** 真实系统时间(ms),第 1 关开打的那一刻。 */
    startedAtMs: number
    /** 通关时刻;未通关为 null。 */
    finishedAtMs: number | null
    /** 结束时刻(通关或作废);进行中为 null。 */
    endedAtMs: number | null
    /** 全程墙钟(ms)= finishedAtMs - startedAtMs;未通关为 null。不参与排序,见顶部口径。 */
    durationMs: number | null
    /** 净战斗用时(ms)= 各关 elapsed_time_ms 之和(只算打赢的关)。 */
    battleMs: number
    roundsCleared: number
    totalRounds: number
    /** 开始跟踪时的轮号。只有 1 才算完整一程,否则不进「战斗用时榜」。 */
    trackedFromRound: number
    characterIds: (number | null)[]
    unisonCharacterIds: (number | null)[]
}

export interface NewRushRun {
    playerId: number
    playerName: string | null
    eventId: number
    folderId: number
    season: number
    startedAtMs: number
    totalRounds: number
    trackedFromRound: number
}

export interface RushRunPatch {
    status?: RushRunStatus
    finishedAtMs?: number | null
    endedAtMs?: number | null
    durationMs?: number | null
    battleMs?: number
    roundsCleared?: number
    characterIds?: (number | null)[]
    unisonCharacterIds?: (number | null)[]
}

export interface RushSeason {
    eventId: number
    season: number
    startedAtMs: number
    fingerprint: string
    source: string
}

export interface RushLeaderboardStore {
    getActiveRun(playerId: number, eventId: number, folderId: number): RushRun | null
    insertRun(run: NewRushRun): RushRun
    updateRun(runId: number, patch: RushRunPatch): void
    getSeason(eventId: number): RushSeason | null
    putSeason(season: RushSeason): void
    /** 把某事件下所有进行中的 run 标为作废,返回受影响行数。 */
    abandonActiveRuns(eventId: number, endedAtMs: number, folderId?: number): number
}

/** 一次「开始一关」的处置方案。 */
export interface RunStartPlan {
    /** 需要作废的旧 run id(没有则 null)。 */
    abandonRunId: number | null
    /** 需要新开的 run(不需要则 null,表示沿用当前 run)。 */
    open: NewRushRun | null
    reason: "continue" | "restart" | "adopt" | "season-changed" | "tower-resized"
}

export interface RunStartContext {
    playerId: number
    playerName: string | null
    eventId: number
    folderId: number
    round: number
    totalRounds: number
    season: number
    nowMs: number
}

/**
 * 判定进入某一关时该怎么处理当前 run。
 *
 * @param active 该存档在该 folder 下进行中的 run(没有则 null)。
 * @param ctx 本次开关卡的上下文。
 */
export function planRunStart(
    active: RushRun | null,
    ctx: RunStartContext
): RunStartPlan {
    const open: NewRushRun = {
        playerId: ctx.playerId,
        playerName: ctx.playerName,
        eventId: ctx.eventId,
        folderId: ctx.folderId,
        season: ctx.season,
        startedAtMs: ctx.nowMs,
        totalRounds: ctx.totalRounds,
        trackedFromRound: ctx.round
    }

    // 第 1 关 = 一次全新的挑战。旧 run 无论处于什么状态一律作废。
    if (ctx.round <= 1) {
        return { abandonRunId: active?.id ?? null, open: { ...open, trackedFromRound: 1 }, reason: "restart" }
    }

    // 中途进关但没有在跟踪的 run:接管它,但标记 trackedFromRound>1,
    // 这种 run 只累计了接管之后那几关的战斗时间,永远不进「战斗用时榜」。
    if (active === null) {
        return { abandonRunId: null, open, reason: "adopt" }
    }

    // 换期了:上一期的进度不能拿来算这一期的成绩。
    if (active.season !== ctx.season) {
        return { abandonRunId: active.id, open, reason: "season-changed" }
    }

    // 塔的长度变了(重摇时改了 --rounds):同上,作废重开。
    if (active.totalRounds !== ctx.totalRounds) {
        return { abandonRunId: active.id, open, reason: "tower-resized" }
    }

    return { abandonRunId: null, open: null, reason: "continue" }
}

export interface RunFinishContext {
    round: number
    totalRounds: number
    accomplished: boolean
    elapsedMs: number
    nowMs: number
    characterIds: (number | null)[]
    unisonCharacterIds: (number | null)[]
}

export interface RunFinishPlan {
    runId: number
    patch: RushRunPatch
    completed: boolean
}

/**
 * 判定一关结算后该怎么更新 run。
 *
 * @param active 进行中的 run;没有就返回 null(不记录)。
 * @param ctx 本次结算的上下文。
 * @returns 更新方案,或 null 表示什么都不做。
 */
export function planRoundFinish(
    active: RushRun | null,
    ctx: RunFinishContext
): RunFinishPlan | null {
    if (active === null) return null
    // 失败的一关:墙钟继续走(全程用时里已含),但不推进进度、不计净战斗时间。
    if (!ctx.accomplished) return null

    const elapsed = Number.isFinite(ctx.elapsedMs) ? Math.max(0, Math.trunc(ctx.elapsedMs)) : 0
    const patch: RushRunPatch = {
        battleMs: active.battleMs + elapsed,
        roundsCleared: Math.max(active.roundsCleared, ctx.round),
        characterIds: ctx.characterIds,
        unisonCharacterIds: ctx.unisonCharacterIds
    }

    const finalRound = Math.max(1, ctx.totalRounds)
    if (ctx.round < finalRound) {
        return { runId: active.id, patch, completed: false }
    }

    patch.status = "completed"
    patch.finishedAtMs = ctx.nowMs
    patch.endedAtMs = ctx.nowMs
    // 时钟被手工往回拨过的话差值可能为负,钳到 0 而不是写脏数据进榜。
    patch.durationMs = Math.max(0, ctx.nowMs - active.startedAtMs)
    return { runId: active.id, patch, completed: true }
}

/**
 * 某条 run 是否有资格进「战斗用时榜」。
 * 必须是打完的、从第 1 关就开始跟踪的完整一程,且有有效的战斗计时。
 *
 * `battleMs > 0` 是硬闸:battle_ms 是 NOT NULL DEFAULT 0,
 * 0 意味着客户端一关都没报出有效时间,它会以 00:00.00 排在所有真成绩之前。
 *
 * 这是**唯一**的 TS 实现:下发层的 `RushRunRecord.fullRun` 直接调它
 * (data/domains/rushLeaderboard.ts 的 toRecord),别再抄第二份。
 * SQL 侧还有三份等价拷贝(榜和个人明细的 WHERE、统计的两个 CASE),
 * 都在 data/domains/rushLeaderboard.ts 里,改这里必须同步改。
 */
export function isFullRunRecord(run: RushRun): boolean {
    return run.status === "completed"
        && run.trackedFromRound === 1
        && run.durationMs !== null
        && run.battleMs > 0
}

/**
 * 由 folder→最大轮数映射算出这座塔的指纹。
 *
 * 只能识别「轮数变了」这一种重造(rush_event_quest.json 里除轮号外无差异,
 * 真正的楼层内容在 CDN 战斗数据里,服务端看不见),所以它只是兜底闸;
 * 精确的换期信号是重摇钩子和后台手动开新期。
 */
export function computeRushSeasonFingerprint(
    folderMaxRounds: Record<number, number>
): string {
    const entries = Object.entries(folderMaxRounds)
        .map(([folder, max]) => [Number(folder), Number(max)] as const)
        .filter(([folder, max]) => Number.isFinite(folder) && Number.isFinite(max))
        .sort((left, right) => left[0] - right[0])
    return entries.map(([folder, max]) => `${folder}:${max}`).join(",")
}

/** {@link ensureRushSeason} 的结果。 */
export interface EnsureRushSeasonResult {
    /** 台账里当前这一期(原本没有台账就是现建的第 1 期)。 */
    season: RushSeason
    /**
     * 台账里记的指纹与现在算出来的不一致 ⇒ 服务端看得见的那一层(folder→轮数)被改过。
     *
     * **本函数刻意不再替你换期**(2026-08-28 作者裁定「换期必须先结算」):
     * 换期会作废进行中的 run、当期榜当场清空,而结算只能结算「台账里当前那一期」。
     * 这里一旦悄悄把期号推走,上一期的名次冻结和奖励邮件就**永远补不回来**。
     * ⇒ 这里只**报告**,由调用方决定什么时候动手。
     *
     * 调用方(`noteRushRoundStart`)现在的处置分两档,理由见那里的长注释:
     *  · **第 1 关:当场结算 + 换期**,再让这一程出生在新一期里。不这么做的话,
     *    run 会开在旧期上、几十秒后被那次换期的 `abandonActiveRuns` 连根拔掉,
     *    玩家白爬一整座塔;
     *  · 第 2 关及以后:只挂待办,交给结算调度器
     *    (`runDueRushSettlements` → `settleThenRolloverRushSeason`,来源记 `fingerprint`)。
     *
     * 这个标志是**可重新推导**的:只要台账里那行指纹还是旧的,下一个开第 1 关的人
     * 就会再报一次。所以待办即使丢了(进程重启、调度器没起)也会自愈,不必落库。
     */
    staleFingerprint: boolean
}

/**
 * 取该事件当前的期号;没有台账就建第 1 期。
 *
 * ⚠ 指纹不符时**不再自动换期**,只在结果里把 `staleFingerprint` 立起来 ——
 * 理由见 {@link EnsureRushSeasonResult.staleFingerprint}。
 *
 * @param store 存储层。
 * @param eventId 事件 ID。
 * @param fingerprint 当前塔的指纹。
 * @param nowMs 当前真实时间(ms)。
 */
export function ensureRushSeason(
    store: RushLeaderboardStore,
    eventId: number,
    fingerprint: string,
    nowMs: number
): EnsureRushSeasonResult {
    const existing = store.getSeason(eventId)
    if (existing === null) {
        const created: RushSeason = { eventId, season: 1, startedAtMs: nowMs, fingerprint, source: "init" }
        store.putSeason(created)
        return { season: created, staleFingerprint: false }
    }
    return { season: existing, staleFingerprint: existing.fingerprint !== fingerprint }
}

/**
 * 手动/钩子触发的换期:期号 +1,并作废该事件下所有进行中的 run。
 *
 * @param store 存储层。
 * @param eventId 事件 ID。
 * @param fingerprint 当前塔的指纹。
 * @param nowMs 当前真实时间(ms)。
 * @param source 换期来源,写进台账备查。
 */
export function rolloverRushSeason(
    store: RushLeaderboardStore,
    eventId: number,
    fingerprint: string,
    nowMs: number,
    source: string
): RushSeason {
    const existing = store.getSeason(eventId)
    const rolled: RushSeason = {
        eventId,
        season: (existing?.season ?? 0) + 1,
        startedAtMs: nowMs,
        fingerprint,
        source
    }
    store.putSeason(rolled)
    store.abandonActiveRuns(eventId, nowMs)
    return rolled
}

/**
 * 换塔了、但**这一期还没人打过**时的换期替身:期号原地不动,只把这一期重新
 * 锚到现在这座塔(刷新指纹 / 开张时刻 / 来源),并照常作废进行中的 run。
 *
 * ── 为什么不干脆 +1(2026-08-28 三轮复核)──────────────────────────
 * 期号推进不可逆,而空期 +1 换来的只是台账里一段没人打过的空榜。真实触发路径:
 * 后台点「立即结算」(它自己已经在结算事务里换到 N+1)之后再游戏内重摇 ——
 * 第二刀落在刚开张的空期 N+1 上,白烧一格变成 N+2。
 *
 * 两件事必须照做,不能因为「反正是空期」就省:
 *  · **指纹要刷新** —— 不然指纹兜底会一直认为塔没收口,每个开第 1 关的玩家
 *    都会再触发一次结算;
 *  · **进行中的 run 照样作废** —— 「空期」的判据是榜上没有成绩,而 run 要打完
 *    才会产生榜行。有人正爬到第 20 层时换塔,那一程必须作废,否则他会在一座
 *    半新半旧的塔上打出一条计入榜的成绩。
 *
 * @param store 存储层。
 * @param eventId 事件 ID。
 * @param fingerprint 当前塔的指纹。
 * @param nowMs 当前真实时间(ms)。
 * @param source 来源,写进台账备查。
 * @returns 重新锚定后的期次台账;台账里压根没有这个事件时返回 null(没有可复用的期)。
 */
export function reanchorRushSeason(
    store: RushLeaderboardStore,
    eventId: number,
    fingerprint: string,
    nowMs: number,
    source: string
): RushSeason | null {
    const existing = store.getSeason(eventId)
    if (existing === null) return null
    const reanchored: RushSeason = {
        eventId,
        season: existing.season,
        startedAtMs: nowMs,
        fingerprint,
        source
    }
    store.putSeason(reanchored)
    store.abandonActiveRuns(eventId, nowMs)
    return reanchored
}
