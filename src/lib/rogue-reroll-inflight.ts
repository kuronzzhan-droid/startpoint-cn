/**
 * 「塔重摇在途」的持久标记 —— 只为堵一个静默缺口。
 *
 * ── 缺口(20260828 三轮复核)────────────────────────────────────────
 * 游戏内整段重置会拉起 `mod-tools/wf_rogue_reroll.py` 子进程重建整座塔,而
 * 「结算 + 换期」挂在那个子进程的 `exit` 事件上(见
 * `src/routes/api/rushEvent.ts::triggerRogueTowerReroll`)。子进程是
 * `detached + unref` 的,窗口是秒级到分钟级:**服务端若在这期间退出/重启,
 * 这个回调就永远不执行** —— 塔已经重建并发上链,榜却留在旧期。
 * 指纹兜底也看不见它:重摇不改轮数,`computeRushSeasonFingerprint` 前后都是 `1:30`。
 * 表现是「新塔挂着旧塔的排行」,而且完全静默。
 *
 * ── 这里做什么、不做什么 ─────────────────────────────────────────
 * spawn 之前落一行标记,子进程退出(无论成败)时清掉;服务端**启动时**若发现
 * 残留标记,就在日志里显著告警并把标记清掉。
 *
 * **刻意不在启动时自动结算 + 换期**:进程被杀时子进程可能停在任何一步
 * (塔只发了一半、或者压根没跑完),启动那一刻服务端无从判断塔到底换没换。
 * 而换期不可逆 —— 拿不准就不动,只把话说清楚,作者到后台点一次
 * 「结算并开启新一期」就补上了(那条路会先冻结名次发奖再换期)。
 *
 * 单槽足够:重摇钩子有 120 秒全局冷却,同一时刻不会有第二次重摇在途。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";

/** 在途标记的内容。 */
export interface RogueRerollMarker {
    /** 正在重摇的连战事件 ID。 */
    eventId: number
    /** 拉起子进程的时刻(真实墙钟 ms)。 */
    startedAtMs: number
}

/**
 * 标记文件的位置。
 *
 * 解析口径必须和 `src/data/index.ts` 逐字一致(`WF_DATABASE_DIR` 优先,
 * 否则 `__dirname/../../.database`)—— 测试靠那个环境变量把整个数据目录
 * 挪到临时目录,这里要是自作主张写死 `.database`,跑一次测试就会往作者的
 * 真实工作目录里落文件。
 */
function markerFile(): string {
    const configured = process.env.WF_DATABASE_DIR?.trim()
    const dataDir = configured
        ? path.resolve(configured)
        : path.resolve(__dirname, "../../.database")
    return path.join(dataDir, "rogue-reroll-inflight.json")
}

/**
 * 记一笔「这个事件的塔正在重摇,换期还没做」。
 *
 * 整段吞异常:标记只是个告警用的旁挂物,写不进去不该让重摇本身失败
 * (最坏结果是退回到「缺口还在」那个状态,而不是更糟)。
 *
 * @param eventId 正在重摇的连战事件 ID。
 * @param startedAtMs 拉起子进程的时刻;缺省取现在。
 */
export function markRogueRerollInFlight(eventId: number, startedAtMs: number = Date.now()): void {
    try {
        const file = markerFile()
        mkdirSync(path.dirname(file), { recursive: true })
        writeFileSync(file, JSON.stringify({ eventId, startedAtMs } satisfies RogueRerollMarker))
    } catch (error) {
        console.error("[RUSH] 重摇在途标记写不进去(不影响重摇本身):", error)
    }
}

/** 子进程退出(无论成败)时清掉标记。 */
export function clearRogueRerollInFlight(): void {
    try {
        rmSync(markerFile(), { force: true })
    } catch (error) {
        console.error("[RUSH] 重摇在途标记清不掉:", error)
    }
}

/**
 * 取走残留的在途标记(读一次即删)。**只该在服务端启动时调一次。**
 *
 * 取走即删是刻意的:留着的话每次启动都会再喊一遍,而这条告警是一次性的
 * ——它说的是「上一次进程生命周期里那次重摇的换期没做完」。
 *
 * @returns 残留标记;没有残留(或文件坏了)时返回 null。
 */
export function takeRogueRerollMarker(): RogueRerollMarker | null {
    let raw: string
    try {
        const file = markerFile()
        if (!existsSync(file)) return null
        raw = readFileSync(file, "utf-8")
        rmSync(file, { force: true })
    } catch (error) {
        console.error("[RUSH] 重摇在途标记读不出来:", error)
        return null
    }
    try {
        const parsed = JSON.parse(raw) as Partial<RogueRerollMarker>
        const eventId = Number(parsed.eventId)
        if (!Number.isFinite(eventId) || eventId <= 0) return null
        const startedAtMs = Number(parsed.startedAtMs)
        return { eventId, startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : 0 }
    } catch {
        return null
    }
}

/**
 * 启动时检查:上一次重摇的「结算 + 换期」做完了吗?
 *
 * 没做完就在日志里显著告警(并把标记清掉)。不自动补做,理由见本文件头。
 */
export function warnOnStaleRogueReroll(): void {
    const marker = takeRogueRerollMarker()
    if (marker === null) return
    const ago = marker.startedAtMs > 0
        ? `(重摇开始于 ${new Date(marker.startedAtMs).toISOString()})`
        : ""
    console.error(`[RUSH] ⛔ 上一次塔重摇的「结算 + 换期」没做完 event=${marker.eventId} ${ago}`
        + " —— 服务端在重摇窗口里退出了,换期回调随进程一起没了。"
        + " 塔可能已经换成新的,而排行榜还挂着上一座塔的成绩;"
        + " 指纹兜底看不见这种漂移(重摇不改轮数)。"
        + " 请到后台排行榜页点一次「结算并开启新一期」(会先冻结名次发奖再换期)。")
}
