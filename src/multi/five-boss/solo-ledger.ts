import { getDb } from "../../data/db"

/**
 * 单人五重决战的「开战 AUTO 快照」账本(2026-09-09 作者:「auto 锁开启也双倍奖励」)。
 *
 * 多人房的 1×/2× 看的是大厅冻结的 AUTO(userOption.auto_play),客户端补丁 fiveBossManualAutoLock
 * 只在多人把手动开局的 AUTO 锁死。单人 quest/start 请求体里**没有** AUTO 字段
 * (is_auto_start_mode 是「自动续战」,不是 AUTO),客户端也没有单人锁。
 * 所以单人由服务端自己记两件事:
 *   - auto_at_start:开局那一刻 players_options.auto_play(编成页 AUTO 开关会先 option/update 同步上来);
 *   - auto_used:战斗中任何一次 option/update_in_battle 把 auto_play 置 true(= 中途开 AUTO)。
 * 结算倍率 = 两者都为 false 才 2 倍,否则 1 倍 —— 与多人「手动开局才 2 倍」同口径,且堵住
 * 「手动开局、进场再开 AUTO」这条单人没有客户端锁的漏洞。
 *
 * 表由本模块自建(CREATE TABLE IF NOT EXISTS),不依赖 wdfpData.ts,方便整文件交付给别的服务端。
 */

export interface FiveBossSoloStartSnapshot {
    playId: string
    autoAtStart: boolean
    autoUsed: boolean
}

interface RawRow {
    play_id: string
    auto_at_start: number
    auto_used: number
}

let tableEnsured = false

function ensureTable(): void {
    if (tableEnsured) return
    getDb().prepare(`CREATE TABLE IF NOT EXISTS five_boss_solo_starts (
        player_id INTEGER PRIMARY KEY,
        play_id TEXT NOT NULL,
        auto_at_start INTEGER NOT NULL CHECK (auto_at_start IN (0, 1)),
        auto_used INTEGER NOT NULL DEFAULT 0 CHECK (auto_used IN (0, 1)),
        started_at TEXT NOT NULL
    )`).run()
    tableEnsured = true
}

/** 开局记快照;同一玩家只保留最近一局(上一局若没结算干净,直接覆盖)。 */
export function recordFiveBossSoloStartSync(playerId: number, playId: string, autoAtStart: boolean): void {
    ensureTable()
    getDb().prepare(`
        INSERT OR REPLACE INTO five_boss_solo_starts (player_id, play_id, auto_at_start, auto_used, started_at)
        VALUES (?, ?, ?, 0, ?)
    `).run(playerId, playId, autoAtStart ? 1 : 0, new Date().toISOString())
}

/**
 * 战斗中把 AUTO 打开:option/update 与 option/update_in_battle 都会经过这里。
 * 没有在途单人五重局时是空操作(返回 false)。
 */
export function markFiveBossSoloAutoUsedSync(playerId: number): boolean {
    ensureTable()
    const result = getDb().prepare(`
        UPDATE five_boss_solo_starts
        SET auto_used = 1
        WHERE player_id = ? AND auto_used = 0
    `).run(playerId)
    return result.changes > 0
}

/** 结算时读快照;play_id 对不上(重建的 active quest / 陈旧行)返回 null,调用方按 1 倍处理。 */
export function readFiveBossSoloStartSync(playerId: number, playId: string): FiveBossSoloStartSnapshot | null {
    ensureTable()
    const row = getDb().prepare(`
        SELECT play_id, auto_at_start, auto_used
        FROM five_boss_solo_starts
        WHERE player_id = ? AND play_id = ?
    `).get(playerId, playId) as RawRow | undefined
    if (!row) return null
    return {
        playId: row.play_id,
        autoAtStart: row.auto_at_start === 1,
        autoUsed: row.auto_used === 1,
    }
}

/** finish / abort 之后清掉;对没有行的玩家是空操作。 */
export function clearFiveBossSoloStartSync(playerId: number): void {
    ensureTable()
    getDb().prepare(`DELETE FROM five_boss_solo_starts WHERE player_id = ?`).run(playerId)
}
