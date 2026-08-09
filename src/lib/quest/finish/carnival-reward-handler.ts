import { getDb } from "../../../data/db"
import { givePlayerRewardsSync } from "../../quest"
import { PlayerRewardResult, Reward, RewardType } from "../../types"
import rewardTableJson from "../../../../assets/carnival_event_total_score_rewards.json"
import { grantPlayerDegreeSync } from "../../../data/domains/degree"

type RawReward = [kind: number, id: number, count: number]
type RewardTier = [rewardId: number, score: number, rewards: RawReward[]]

export interface CarnivalRewardGrantResult {
    rewardIds: number[]
    newDegreeIds: number[]
    rewards: PlayerRewardResult | null
}

const rewardTable = rewardTableJson as unknown as Record<string, RewardTier[]>

function emptyResult(): CarnivalRewardGrantResult {
    return { rewardIds: [], newDegreeIds: [], rewards: null }
}

function ensureClaimTableSync(): void {
    getDb().prepare(`
    CREATE TABLE IF NOT EXISTS players_carnival_event_reward_claims (
        player_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        reward_id INTEGER NOT NULL,
        claimed_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, event_id, reward_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )
    `).run()
}

const carnivalDegreeByClaim = new Map<string, number>()
for (const [eventId, tiers] of Object.entries(rewardTable)) {
    for (const [rewardId, , rewards] of tiers) {
        for (const [kind, degreeId] of rewards) {
            if (kind === 7) {
                carnivalDegreeByClaim.set(`${eventId}:${rewardId}`, degreeId)
            }
        }
    }
}

/**
 * Repairs historical Carnival title rewards whose tier was marked claimed
 * before title ownership was persisted.  Claim rows are authoritative here:
 * scores may later be reduced by the duplicate-party conflict rule, while an
 * already claimed reward must remain owned.
 */
export function ensurePlayerClaimedCarnivalDegreesSync(playerId: number): number[] {
    if (!Number.isInteger(playerId) || playerId <= 0) return []

    ensureClaimTableSync()
    const rows = getDb().prepare(`
        SELECT event_id, reward_id, claimed_at
        FROM players_carnival_event_reward_claims
        WHERE player_id = ?
        ORDER BY claimed_at ASC, event_id ASC, reward_id ASC
    `).all(playerId) as {
        event_id: number
        reward_id: number
        claimed_at: number
    }[]

    const granted: number[] = []
    for (const row of rows) {
        const degreeId = carnivalDegreeByClaim.get(`${row.event_id}:${row.reward_id}`)
        if (
            degreeId !== undefined &&
            grantPlayerDegreeSync(playerId, degreeId, row.claimed_at) &&
            !granted.includes(degreeId)
        ) {
            granted.push(degreeId)
        }
    }

    if (granted.length > 0) {
        console.log(`[CARNIVAL] restored claimed degrees player=${playerId} degrees=${JSON.stringify(granted)}`)
    }
    return granted
}

/**
 * Grants every reached-but-unclaimed total-score tier atomically.  Looking at
 * the claim table (rather than only the previous score) also repairs players
 * whose score was recorded before server-side Carnival rewards existed.
 */
export function grantCarnivalTotalScoreRewardsSync(
    playerId: number,
    eventId: number,
    totalBestScore: number
): CarnivalRewardGrantResult {
    const tiers = rewardTable[String(eventId)] ?? []
    if (tiers.length === 0) return emptyResult()

    const db = getDb()
    return db.transaction((): CarnivalRewardGrantResult => {
        ensureClaimTableSync()
        const restoredDegreeIds = ensurePlayerClaimedCarnivalDegreesSync(playerId)

        const claimedRows = db.prepare(`
        SELECT reward_id FROM players_carnival_event_reward_claims
        WHERE player_id = ? AND event_id = ?
        `).all(playerId, eventId) as { reward_id: number }[]
        const claimed = new Set(claimedRows.map(row => row.reward_id))
        const reached = tiers.filter(([rewardId, score]) => score <= totalBestScore && !claimed.has(rewardId))
        if (reached.length === 0) {
            return { rewardIds: [], newDegreeIds: restoredDegreeIds, rewards: null }
        }

        const insertClaim = db.prepare(`
        INSERT INTO players_carnival_event_reward_claims
            (player_id, event_id, reward_id, claimed_at)
        VALUES (?, ?, ?, ?)
        `)
        const now = Date.now()
        for (const [rewardId] of reached) insertClaim.run(playerId, eventId, rewardId, now)

        // Merge repeated items from adjacent tiers before granting them.  This
        // keeps the response item_list at the actual post-grant inventory total.
        const merged = new Map<string, RawReward>()
        const newDegreeIds: number[] = [...restoredDegreeIds]
        for (const [, , rewards] of reached) {
            for (const reward of rewards) {
                const [kind, id, count] = reward
                if (kind === 7) {
                    if (
                        grantPlayerDegreeSync(playerId, id) &&
                        !newDegreeIds.includes(id)
                    ) {
                        newDegreeIds.push(id)
                    }
                    continue
                }
                const key = `${kind}:${id}`
                const existing = merged.get(key)
                if (existing) existing[2] += count
                else merged.set(key, [...reward] as RawReward)
            }
        }

        const rewards: Reward[] = []
        for (const [kind, id, count] of merged.values()) {
            switch (kind) {
                case 0: rewards.push({ type: RewardType.ITEM, id, count } as Reward); break
                case 1: rewards.push({ type: RewardType.EQUIPMENT, id, count } as Reward); break
                case 2: rewards.push({ type: RewardType.BEADS, count } as Reward); break
                case 3: rewards.push({ type: RewardType.MANA, count } as Reward); break
                case 4: rewards.push({ type: RewardType.EXP, count } as Reward); break
                case 6: {
                    for (let index = 0; index < count; index++) {
                        rewards.push({ type: RewardType.CHARACTER, id } as Reward)
                    }
                    break
                }
                default:
                    console.warn(`[CARNIVAL] unsupported total-score reward kind=${kind} id=${id}`)
            }
        }

        const result = rewards.length > 0 ? givePlayerRewardsSync(playerId, rewards) : null
        const rewardIds = reached.map(([rewardId]) => rewardId)
        console.log(`[CARNIVAL] granted event=${eventId} player=${playerId} total=${totalBestScore} tiers=${JSON.stringify(rewardIds)}`)
        return { rewardIds, newDegreeIds, rewards: result }
    })()
}
