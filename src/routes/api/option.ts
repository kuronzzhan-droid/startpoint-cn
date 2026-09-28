import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSession } from "../../data/domains/session"
import { updatePlayerOptionsSync } from "../../data/domains/option"
import { markFiveBossSoloAutoUsedSync } from "../../multi/five-boss/solo-ledger"
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { generateDataHeaders } from "../../utils";

interface UpdateBody {
    viewer_id: number
    api_count: number
    option_params: Record<string, boolean>
}

const updateRoute = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as UpdateBody

    const viewerId = body.viewer_id
    if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
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

    // update options
    const updatedOptions = body.option_params
    updatePlayerOptionsSync(playerId, updatedOptions)
    // 单人五重:战斗中(或开局前后)把 AUTO 打开 = 本局按 AUTO 局结算(五重 solo-ledger 才有行,其他玩家空操作)。
    if (updatedOptions && updatedOptions["auto_play"] === true && markFiveBossSoloAutoUsedSync(playerId)) {
        console.log(`[FIVE-BOSS] solo AUTO switched on during the run: player=${playerId} -> 1x settlement`)
    }
    
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({
        "data_headers": generateDataHeaders({
            viewer_id: viewerId
        }),
        "data": {
            "user_option": updatedOptions
        }
    })
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/update", updateRoute)

    fastify.post("/update_in_battle", updateRoute)
}

export default routes;