import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { VerifyAccessTokenBody, MicroCommunityBody } from "../types"
import { generateDataHeaders } from "../../utils"
import { getRoomCommandGateway } from "../coordinator/default-runtime"
import type { RoomQueryProjection } from "../coordinator/room-command-handlers"
import { resolveMultiPlayerContext } from "../player-context"
import { getFollowRelationSync } from "../../data/domains/follow"
import { getPlayerCharacterSync } from "../../data/domains/character"
import { getPlayerSync } from "../../data/domains/player"
import { getRankDegree } from "../../lib/stamina"

export function registerSocialRoutes(fastify: FastifyInstance): void {

    fastify.post("/verify_access_token", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as VerifyAccessTokenBody
        const ctx = await resolveMultiPlayerContext(Number(body.viewer_id))
        if (!ctx) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id or no player bound."
        })

        const room = await getRoomCommandGateway().execute("room.query", {
            accessToken: body.access_token || "",
        }) as RoomQueryProjection | null
        if (!room) {
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: body.viewer_id }),
                "data": { "room_exists": false }
            })
        }

        const host = getPlayerSync(room.host_player_id)
        const hostCharacter = getPlayerCharacterSync(
            room.host_player_id,
            room.host_main_character_id,
        )
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: body.viewer_id }),
            "data": {
                room_exists: true,
                category_id: room.category,
                establisher: room.host_viewer_id,
                establisher_character: room.host_main_character_id,
                establisher_character_evolution_img_level: hostCharacter?.evolutionLevel ?? 0,
                establisher_follow: getFollowRelationSync(ctx.playerId, room.host_player_id).state,
                establisher_name: host?.name ?? `Player${room.host_viewer_id}`,
                establisher_rank: getRankDegree(host?.rankPoint ?? 0),
                host_entry_time: room.host_entry_time,
                quest_id: room.quest_id,
                room_number: room.room_number,
            }
        })
    })

    fastify.post("/micro_community", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as MicroCommunityBody
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: body.viewer_id }),
            "data": {}
        })
    })

    fastify.post("/publish_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as MicroCommunityBody
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: body.viewer_id }),
            "data": { success: false }
        })
    })
}
