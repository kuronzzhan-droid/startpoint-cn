import { getDb } from "../data/db"
import { grantPlayerDegreeSync } from "../data/domains/degree"
import { givePlayerRewardsSync } from "./quest"
import { Reward, RewardType } from "./types"

export interface RaidEventRewardEntry {
    kind: number
    kind_id: number | null
    number: number
}

export interface RaidEventRewardClaimResult {
    receivedUpTo: number
    rewardList: RaidEventRewardEntry[]
}

interface OverallReward {
    threshold: number
    rewards: RaidEventRewardEntry[]
}

export interface RaidEventGlobalBoss {
    hpPercentage: number
    totalKillCount: number
    weightedKillCount: number
    requiredKillCount: number
}

interface RaidEventProgressRule {
    requiredKillCount: number
    questWeights: Record<number, number>
}

// Official master data for raid event 7 (Battle Banquet).
// A clear adds the selected quest's kill_count_weight. Only when the accumulated
// weight reaches required_kill_count does total_kill_count increase, and the
// weight resets to zero (the client dummy implementation uses the same reset).
const RAID_EVENT_PROGRESS_RULES: Record<number, RaidEventProgressRule> = {
    7: {
        // Private-server population adjustment: 1/100 of the official 76000.
        requiredKillCount: 760,
        questWeights: {
            7001: 51,
            7002: 255,
            7003: 1,
            7004: 3,
            7005: 30,
            7006: 180,
            7007: 1,
            7008: 3,
            7009: 26,
            7010: 157,
            7011: 1,
            7012: 3,
            7013: 22,
            7014: 135,
            7015: 1,
            7016: 3,
            7017: 18,
            7018: 115,
            7019: 1,
            7020: 3,
            7021: 15,
            7022: 97,
            7023: 1,
            7024: 3,
            7025: 12,
            7026: 80,
        },
    },
}

// Raid event 7 (Battle Banquet) official total-kill rewards.
// The 300-kill Starry Memory Crystal is intentionally replaced by
// the Ceremony title (degree 80054).
const BATTLE_BANQUET_TOTAL_REWARDS: OverallReward[] = [
    {
        threshold: 50,
        rewards: [
            { kind: 0, kind_id: 49100, number: 10 },
            { kind: 0, kind_id: 10003, number: 1 },
        ],
    },
    {
        threshold: 100,
        rewards: [
            { kind: 0, kind_id: 49100, number: 10 },
            { kind: 0, kind_id: 14040, number: 1 },
        ],
    },
    {
        threshold: 150,
        rewards: [
            { kind: 0, kind_id: 49100, number: 15 },
            { kind: 0, kind_id: 14040, number: 1 },
        ],
    },
    {
        threshold: 200,
        rewards: [
            { kind: 2, kind_id: null, number: 600 },
            { kind: 0, kind_id: 14040, number: 1 },
        ],
    },
    {
        threshold: 250,
        rewards: [
            { kind: 0, kind_id: 49100, number: 20 },
            { kind: 0, kind_id: 12002, number: 1 },
        ],
    },
    {
        threshold: 300,
        rewards: [
            { kind: 2, kind_id: null, number: 2000 },
            { kind: 7, kind_id: 80054, number: 1 },
        ],
    },
]

function getBattleBanquetRewardsBetween(
    previousCount: number,
    currentCount: number,
): RaidEventRewardEntry[] {
    const rewards: RaidEventRewardEntry[] = []
    const newKillCount = Math.max(0, currentCount - previousCount)

    // Official repeat reward: every kill grants Mana x500 and item 100000 x25.
    if (newKillCount > 0) {
        rewards.push(
            { kind: 3, kind_id: null, number: 500 * newKillCount },
            { kind: 0, kind_id: 100000, number: 25 * newKillCount },
        )
    }

    for (const reward of BATTLE_BANQUET_TOTAL_REWARDS) {
        if (reward.threshold > previousCount && reward.threshold <= currentCount) {
            rewards.push(...reward.rewards)
        }
    }

    // Official repeat reward after 300: Star Stones x300 at 400, 500, 600, ...
    let repeatedStoneRewards = 0
    for (let threshold = 400; threshold <= currentCount; threshold += 100) {
        if (threshold > previousCount) repeatedStoneRewards++
    }
    if (repeatedStoneRewards > 0) {
        rewards.push({
            kind: 2,
            kind_id: null,
            number: 300 * repeatedStoneRewards,
        })
    }

    return rewards
}

function aggregateRewards(rewards: RaidEventRewardEntry[]): RaidEventRewardEntry[] {
    const aggregated = new Map<string, RaidEventRewardEntry>()
    for (const reward of rewards) {
        const key = `${reward.kind}:${reward.kind_id ?? ""}`
        const existing = aggregated.get(key)
        if (existing) {
            existing.number += reward.number
        } else {
            aggregated.set(key, { ...reward })
        }
    }
    return [...aggregated.values()]
}

function applyRewardEntriesSync(playerId: number, entries: RaidEventRewardEntry[]): void {
    const ordinaryRewards: Reward[] = []
    for (const entry of entries) {
        switch (entry.kind) {
            case 0:
                if (entry.kind_id !== null) {
                    ordinaryRewards.push({
                        type: RewardType.ITEM,
                        id: entry.kind_id,
                        count: entry.number,
                    } as Reward)
                }
                break
            case 1:
                if (entry.kind_id !== null) {
                    ordinaryRewards.push({
                        type: RewardType.EQUIPMENT,
                        id: entry.kind_id,
                        count: entry.number,
                    } as Reward)
                }
                break
            case 2:
                ordinaryRewards.push({
                    type: RewardType.BEADS,
                    count: entry.number,
                } as Reward)
                break
            case 3:
                ordinaryRewards.push({
                    type: RewardType.MANA,
                    count: entry.number,
                } as Reward)
                break
            case 4:
                ordinaryRewards.push({
                    type: RewardType.EXP,
                    count: entry.number,
                } as Reward)
                break
            case 6:
                if (entry.kind_id !== null) {
                    for (let i = 0; i < entry.number; i++) {
                        ordinaryRewards.push({
                            type: RewardType.CHARACTER,
                            id: entry.kind_id,
                        })
                    }
                }
                break
            case 7:
                if (entry.kind_id !== null) {
                    grantPlayerDegreeSync(playerId, entry.kind_id)
                }
                break
        }
    }
    if (ordinaryRewards.length > 0) givePlayerRewardsSync(playerId, ordinaryRewards)
}

function getRaidEventProgressRule(eventId: number): RaidEventProgressRule {
    return RAID_EVENT_PROGRESS_RULES[eventId] ?? {
        requiredKillCount: 1,
        questWeights: {},
    }
}

function calculateHpPercentage(weightedKillCount: number, requiredKillCount: number): number {
    if (requiredKillCount <= 0) return 100
    const ratio = Math.max(0, Math.min(1, weightedKillCount / requiredKillCount))
    return Math.ceil((1 - ratio) * 1000) / 10
}

function rebuildRaidEventGlobalStateSync(eventId: number): RaidEventGlobalBoss {
    const rule = getRaidEventProgressRule(eventId)
    const rows = getDb().prepare(`
        SELECT quest_id
        FROM raid_event_global_kill_ledger
        WHERE event_id = ?
        ORDER BY created_at, rowid
    `).all(eventId) as { quest_id: number }[]

    let weightedKillCount = 0
    let totalKillCount = 0
    for (const row of rows) {
        const questWeight = rule.questWeights[row.quest_id] ?? (
            rule.requiredKillCount === 1 ? 1 : 0
        )
        weightedKillCount += questWeight
        if (weightedKillCount >= rule.requiredKillCount) {
            weightedKillCount = 0
            totalKillCount++
        }
    }

    getDb().prepare(`
        INSERT INTO raid_event_global_state
            (
                event_id,
                total_kill_count,
                weighted_kill_count,
                calculation_version,
                updated_at
            )
        VALUES (?, ?, ?, 3, ?)
        ON CONFLICT(event_id) DO UPDATE SET
            total_kill_count = excluded.total_kill_count,
            weighted_kill_count = excluded.weighted_kill_count,
            calculation_version = excluded.calculation_version,
            updated_at = excluded.updated_at
    `).run(eventId, totalKillCount, weightedKillCount, Date.now())

    return {
        hpPercentage: calculateHpPercentage(weightedKillCount, rule.requiredKillCount),
        totalKillCount,
        weightedKillCount,
        requiredKillCount: rule.requiredKillCount,
    }
}

export function getRaidEventGlobalBossSync(eventId: number): RaidEventGlobalBoss {
    const rule = getRaidEventProgressRule(eventId)
    const row = getDb().prepare(`
        SELECT total_kill_count, weighted_kill_count, calculation_version
        FROM raid_event_global_state
        WHERE event_id = ?
    `).get(eventId) as {
        total_kill_count: number
        weighted_kill_count: number
        calculation_version: number
    } | undefined

    if (row && row.calculation_version >= 3) {
        return {
            hpPercentage: calculateHpPercentage(
                row.weighted_kill_count,
                rule.requiredKillCount,
            ),
            totalKillCount: row.total_kill_count,
            weightedKillCount: row.weighted_kill_count,
            requiredKillCount: rule.requiredKillCount,
        }
    }

    const hasLedger = getDb().prepare(`
        SELECT 1
        FROM raid_event_global_kill_ledger
        WHERE event_id = ?
        LIMIT 1
    `).get(eventId)
    if (row || hasLedger) return rebuildRaidEventGlobalStateSync(eventId)

    return {
        hpPercentage: 100,
        totalKillCount: 0,
        weightedKillCount: 0,
        requiredKillCount: rule.requiredKillCount,
    }
}

export function getRaidEventGlobalKillCountSync(eventId: number): number {
    return getRaidEventGlobalBossSync(eventId).totalKillCount
}

export function getRaidEventQuestKillCountsSync(eventId: number): Record<string, { kill_count: number }> {
    const rows = getDb().prepare(`
        SELECT quest_id, COUNT(*) AS kill_count
        FROM raid_event_global_kill_ledger
        WHERE event_id = ?
        GROUP BY quest_id
        ORDER BY quest_id
    `).all(eventId) as { quest_id: number, kill_count: number }[]
    return Object.fromEntries(rows.map(row => [
        String(row.quest_id),
        { kill_count: row.kill_count },
    ]))
}

export function getRaidEventQuestKillCountSync(eventId: number, questId: number): number {
    const row = getDb().prepare(`
        SELECT COUNT(*) AS kill_count
        FROM raid_event_global_kill_ledger
        WHERE event_id = ? AND quest_id = ?
    `).get(eventId, questId) as { kill_count: number }
    return row.kill_count
}

export function recordRaidEventClearSync(params: {
    eventId: number
    playId: string
    playerId: number
    questId: number
}): {
    counted: boolean
    questWeight: number
    questKillCount: number
    boss: RaidEventGlobalBoss
} {
    const { eventId, playId, playerId, questId } = params
    if (!Number.isInteger(eventId) || eventId <= 0 || !playId) {
        return {
            counted: false,
            questWeight: 0,
            questKillCount: 0,
            boss: {
                hpPercentage: 100,
                totalKillCount: 0,
                weightedKillCount: 0,
                requiredKillCount: getRaidEventProgressRule(eventId).requiredKillCount,
            },
        }
    }

    return getDb().transaction(() => {
        const currentBoss = getRaidEventGlobalBossSync(eventId)
        const rule = getRaidEventProgressRule(eventId)
        const questWeight = rule.questWeights[questId] ?? (
            rule.requiredKillCount === 1 ? 1 : 0
        )
        const ledgerInsert = getDb().prepare(`
            INSERT OR IGNORE INTO raid_event_global_kill_ledger
                (event_id, play_id, player_id, quest_id, created_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(eventId, playId, playerId, questId, Date.now())

        let boss = currentBoss
        if (ledgerInsert.changes > 0) {
            let weightedKillCount = currentBoss.weightedKillCount + questWeight
            let totalKillCount = currentBoss.totalKillCount
            if (weightedKillCount >= rule.requiredKillCount) {
                weightedKillCount = 0
                totalKillCount++
            }

            getDb().prepare(`
                INSERT INTO raid_event_global_state
                    (
                        event_id,
                        total_kill_count,
                        weighted_kill_count,
                        calculation_version,
                        updated_at
                    )
                VALUES (?, ?, ?, 3, ?)
                ON CONFLICT(event_id) DO UPDATE SET
                    total_kill_count = excluded.total_kill_count,
                    weighted_kill_count = excluded.weighted_kill_count,
                    calculation_version = excluded.calculation_version,
                    updated_at = excluded.updated_at
            `).run(eventId, totalKillCount, weightedKillCount, Date.now())

            boss = {
                hpPercentage: calculateHpPercentage(
                    weightedKillCount,
                    rule.requiredKillCount,
                ),
                totalKillCount,
                weightedKillCount,
                requiredKillCount: rule.requiredKillCount,
            }
        }

        return {
            counted: ledgerInsert.changes > 0,
            questWeight,
            questKillCount: getRaidEventQuestKillCountSync(eventId, questId),
            boss,
        }
    })()
}

export function claimRaidEventOverallRewardsSync(
    playerId: number,
    eventId: number,
    totalKillCount: number,
): RaidEventRewardClaimResult {
    return getDb().transaction(() => {
        const receipt = getDb().prepare(`
            SELECT received_up_to
            FROM players_raid_event_overall_rewards
            WHERE player_id = ? AND event_id = ?
        `).get(playerId, eventId) as { received_up_to: number } | undefined
        const previousCount = receipt?.received_up_to ?? 0

        if (eventId !== 7 || totalKillCount <= previousCount) {
            return {
                receivedUpTo: previousCount,
                rewardList: [],
            }
        }

        const rewardList = aggregateRewards(
            getBattleBanquetRewardsBetween(previousCount, totalKillCount),
        )
        applyRewardEntriesSync(playerId, rewardList)
        // The CN client rejects degree rewards in RaidEventLogic with C3419.
        // Degrees are granted server-side above, but must not be returned to
        // the generic raid reward popup.
        const clientRewardList = rewardList.filter(reward => reward.kind !== 7)

        getDb().prepare(`
            INSERT INTO players_raid_event_overall_rewards
                (player_id, event_id, received_up_to, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(player_id, event_id) DO UPDATE SET
                received_up_to = excluded.received_up_to,
                updated_at = excluded.updated_at
        `).run(playerId, eventId, totalKillCount, Date.now())

        return {
            receivedUpTo: totalKillCount,
            rewardList: clientRewardList,
        }
    })()
}
