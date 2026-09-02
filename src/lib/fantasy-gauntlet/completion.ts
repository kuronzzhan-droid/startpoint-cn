import { getDb } from "../../data/db"
import { QuestCategory } from "../types"
import { FANTASY_GAUNTLET } from "./contract"


/**
 * 幻想连战在原生 EventFolder「已完成」分类里的修复规则。
 *
 * **只有 700098 一条规则**:深渊连战 700099 的分类由它自己的既有路径负责,
 * 本模块一个字节都不碰(作者 2026-09-02 裁定 / A15)。
 */
const FANTASY_COMPLETION_RULE = Object.freeze({
    firstRegularQuestId: FANTASY_GAUNTLET.rushEventId * 1000 + 1,
    lastRegularQuestId: FANTASY_GAUNTLET.rushEventId * 1000 + FANTASY_GAUNTLET.finalStage,
    completionQuestId: FANTASY_GAUNTLET.practiceQuestId,
})


/**
 * 15 关全清之后,补上原生分类需要的那条「完成」记录。
 *
 * 这一行**纯粹是 UI 历史状态**:当期进度由 players_rush_events 与
 * players_rush_events_played_parties 决定,重置一次运行不会动它。
 *
 * @param playerId 存档 ID。
 * @returns 是否真的写入了(已经写过 / 还没打完都返回 false)。
 */
export function repairFantasyCompletionClassificationSync(
    playerId: number,
): boolean {
    const rule = FANTASY_COMPLETION_RULE
    const expectedRegularQuestCount =
        rule.lastRegularQuestId - rule.firstRegularQuestId + 1

    const regularProgress = getDb().prepare(`
        SELECT COUNT(*) AS cleared_quest_count
        FROM players_quest_progress
        WHERE player_id = ?
          AND section = ?
          AND quest_id BETWEEN ? AND ?
          AND finished = 1
    `).get(
        playerId,
        Number(QuestCategory.RUSH_EVENT),
        rule.firstRegularQuestId,
        rule.lastRegularQuestId,
    ) as { cleared_quest_count?: number } | undefined
    if (Number(regularProgress?.cleared_quest_count ?? 0) !== expectedRegularQuestCount) {
        return false
    }

    const completionProgress = getDb().prepare(`
        SELECT finished
        FROM players_quest_progress
        WHERE player_id = ? AND section = ? AND quest_id = ?
    `).get(
        playerId,
        Number(QuestCategory.RUSH_EVENT),
        rule.completionQuestId,
    ) as { finished?: number } | undefined
    if (Number(completionProgress?.finished ?? 0) === 1) return false

    // 列表刻意与我方 players_quest_progress 的实际表结构对齐:
    // 灰那份还带 host_finished / s_plus_reward_received 两列,我方没有,
    // 照抄会在运行期炸 SQL(方案 A:改 SQL,不动共享表结构)。
    getDb().prepare(`
        INSERT INTO players_quest_progress (
            section, quest_id, finished, unlocked,
            high_score, clear_rank, best_elapsed_time_ms,
            leader_character_id, multi_clear_count, player_id
        ) VALUES (?, ?, 1, 1, NULL, 5, NULL, NULL, 0, ?)
        ON CONFLICT(section, quest_id, player_id) DO UPDATE SET
            finished = 1,
            unlocked = 1,
            clear_rank = MAX(COALESCE(players_quest_progress.clear_rank, 0), 5)
    `).run(
        Number(QuestCategory.RUSH_EVENT),
        rule.completionQuestId,
        playerId,
    )
    return true
}
