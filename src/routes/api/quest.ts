import { stripWeaponRivenPublicPayload } from "../../lib/weapon-riven/public-payload"
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { resolvePlayerIdSync } from "../../data/activeAccount"
import { getSession } from "../../data/domains/session"
import { getRecommendedQuestPartiesSync } from "../../lib/quest/recommended-party-history"
import { generateDataHeaders } from "../../utils"

interface RecentPartyRequestBody {
    viewer_id: number
    category: number
    quest_id: number
}

/**
 * Returns up to ten distinct parties that actually cleared this quest. Frozen
 * clear snapshots are ordered only by the battle power used for that clear.
 * Without a matching snapshot, a player's current party is never substituted.
 */
const routes = async (fastify: FastifyInstance) => {
    fastify.post("/get_recent_other_player_party", async (
        request: FastifyRequest,
        reply: FastifyReply,
    ) => {
        const body = request.body as RecentPartyRequestBody
        const viewerId = Number(body?.viewer_id)
        const category = Number(body?.category)
        const questId = Number(body?.quest_id)

        if (
            !Number.isFinite(viewerId) ||
            !Number.isFinite(category) ||
            !Number.isFinite(questId)
        ) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid request body.",
            })
        }

        const session = await getSession(String(viewerId))
        if (!session) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid viewer id.",
            })
        }

        const playerId = resolvePlayerIdSync(session.accountId)
        if (playerId === null) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "No player bound to account.",
            })
        }

        const recommendations = getRecommendedQuestPartiesSync(
            playerId,
            category,
            questId,
        )

        console.log(
            `[QUEST-RECOMMEND] player=${playerId} category=${category} ` +
            `quest=${questId} exact=${recommendations.exactCandidateCount} ` +
            `returned=${recommendations.parties.length}`,
        )

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {
                recent_other_player_party: stripWeaponRivenPublicPayload(recommendations.parties),
            },
        })
    })
}

export default routes
