// Handles mail.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAccountPlayers } from "../../data/domains/account"
import { getPlayerQuestProgressSync, getPlayerSingleQuestProgressSync } from "../../data/domains/quest"
import { getSession } from "../../data/domains/session"
import { generateDataHeaders } from "../../utils";
import { QuestCategory } from "../../lib/types";
import { PlayerQuestProgress } from "../../data/types";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { buildRushBoardRankingSummary, getRushBoardBinding } from "../../lib/rush-leaderboard-ranking-event";

interface ReceiveRewardBody {
    api_count: number,
    viewer_id: number,
    ranking_event_id: number
}

interface GetSummaryBody {
    viewer_id: number,
    ranking_event_id: number,
    quest_kind: number
}

const rankingEventIdQuestMap: Record<number, number> = {
    [1]: 1001,
    [2]: 2001,
    [3]: 3001,
    [4]: 4001,
    [5]: 5001,
    [1000]: 1000001,
    [1001]: 1001001
}

const rankingEventTopTimesMs: Record<number, number> = {
    [1]: 54410,
    [2]: 25800,
    [3]: 18880,
    [4]: 31720,
    [5]: 6540
}

/**
 * Generates a ranking summary for a specific player & ranking event.
 * 
 * @param playerId 
 * @param eventId 
 * @returns 
 */
function getRankingSummary(
    playerId: number,
    eventId: number
): Object | null {
    // mod(深渊连战排行榜): 这个活动 id 被绑到了自制的连战竞速榜,就用榜的数据
    // 填这张摘要 —— 客户端的秒表 UI 原样复用,不改 APK。
    // 详见 src/lib/rush-leaderboard-ranking-event.ts 顶部的逆向说明。
    const boardBinding = getRushBoardBinding(eventId)
    if (boardBinding !== null) {
        const summary = buildRushBoardRankingSummary(boardBinding, playerId)
        console.log(`[RUSH-LB] ranking_event summary: event=${eventId} board=${boardBinding.board} `
            + `player=${playerId} best=${summary.best_record.elapsed_time_ms}ms `
            + `top=${summary.rank_border_top?.elapsed_time_ms ?? "-"}ms`)
        return summary
    }

    // get quest
    const questId = rankingEventIdQuestMap[eventId]
    if (questId === undefined) return null;

    const topTime = rankingEventTopTimesMs[eventId] ?? 0

    // get data for the ranking quest
    const playerQuestData = getPlayerSingleQuestProgressSync(playerId, QuestCategory.RANKING_EVENT_SINGLE, questId)
    const isAccomplished = playerQuestData !== null && playerQuestData.bestElapsedTimeMs !== undefined && playerQuestData.bestElapsedTimeMs !== null

    return {
        "best_record": {
            "elapsed_time_ms": isAccomplished ? playerQuestData.bestElapsedTimeMs ?? 0 : 0,
            "is_accomplished": isAccomplished,
            "score": isAccomplished ? playerQuestData.highScore ?? 0 : 0
        },
        "leader_character_evolution_img_level": 1,
        "leader_character_id": 1,
        "rank_border_top": {
            "elapsed_time_ms": topTime,
            "is_accomplished": true,
            "score": 1110111
        },
        "rank_percentage": isAccomplished ? 1 - (topTime / (playerQuestData.bestElapsedTimeMs ?? 1)) : 100
    }
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/get_summary", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GetSummaryBody

        const viewerId = body.viewer_id
        const eventId = body.ranking_event_id
        if (isNaN(viewerId) || isNaN(eventId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!

        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        // get summary
        const summary = getRankingSummary(playerId, eventId)
        if (summary === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": `Summary could not be generated for '${eventId}' and PlayerId '${playerId}'.`
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": summary
        })
    })

    fastify.post("/receive_reward", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ReceiveRewardBody

        const viewerId = body.viewer_id
        const eventId = body.ranking_event_id
        if (isNaN(viewerId) || isNaN(eventId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player id
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!

        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        // get summary
        const summary = getRankingSummary(playerId, eventId)
        if (summary === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": `Summary could not be generated for '${eventId}' and PlayerId '${playerId}'.`
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "status": 1,
                ...summary
            }
        })
    })
}

export default routes;