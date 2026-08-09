/**
 * Profile API — get_my_profile.
 * Returns player profile info, settings, and party groups.
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getPlayerCharactersSync } from "../../data/domains/character"
import { getPlayerPartyGroupListSync } from "../../data/domains/party"
import { getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getSession } from "../../data/domains/session"
import { resolvePlayerIdSync } from "../../data/activeAccount";
// removed getAccountPlayers "../../data/wdfpData";
import { generateDataHeaders } from "../../utils";
import { getPlayerIdByViewerIdSync } from "../../data/domains/follow";
import { buildTargetProfileSync } from "../../lib/follow";
import { getFavoritePartyGroupListSync } from "../../lib/profileFavorite";
import {
    ensurePlayerLegacyDegreesSync,
    ensurePlayerSoloTimeAttackDegreesSync,
    getPlayerDegreeIdsSync,
    hasPlayerDegreeSync,
} from "../../data/domains/degree";
import { ensurePlayerClaimedCarnivalDegreesSync } from "../../lib/quest/finish/carnival-reward-handler";
import { gameVerboseLog } from "../../lib/game-logging";

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/get_my_profile", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid request body."
        })

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(session.accountId)!
        if (playerId === null) return reply.status(400).send({
            error: "Bad Request",
            message: "No player bound to account."
        })

        const player = getPlayerSync(playerId)
        if (!player) return reply.status(400).send({ error: "Bad Request", message: "Player not found." })

        const characters = getPlayerCharactersSync(playerId)
        const charCount = Object.keys(characters).length

        const partyGroupList = getFavoritePartyGroupListSync(
            playerId,
            player.leaderCharacterId,
        )

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {
                profile_info: {
                    max_opened_mana_board_second_count: 0,
                    max_owned_character_count: charCount,
                    max_owned_degree_count: 1,
                    opened_mana_board_second_count: 0,
                    owned_character_count: charCount,
                    owned_degree_count: 1,
                },
                profile_settings: {
                    show_opened_mana_board_second_count: false,
                    show_owned_character_count: true,
                    show_owned_degree_count: true,
                },
                user_party_group_list: partyGroupList,
            }
        })
    })

    // Public profile opened from the follow/follower list.
    fastify.post("/get_profile", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const viewerId = Number(body.viewer_id)
        const targetViewerId = Number(body.target_viewer_id)
        if (!Number.isFinite(viewerId) || !Number.isFinite(targetViewerId)) {
            return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." })
        }

        const session = await getSession(String(viewerId))
        if (!session) return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." })
        const playerId = resolvePlayerIdSync(session.accountId)
        const targetPlayerId = getPlayerIdByViewerIdSync(targetViewerId)
        if (!playerId || targetPlayerId === null) {
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: 1457 }),
                data: {},
            })
        }

        const profile = buildTargetProfileSync(playerId, targetPlayerId)
        if (!profile) {
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: 1457 }),
                data: {},
            })
        }

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: profile,
        })
    })

    // Returns the player's last login region (CN-specific)
    fastify.post("/get_last_login_region", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid request body."
        })

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid viewer id."
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {
                region: "CN",
            }
        })
    })

    // Returns owned degree IDs for title selection
    fastify.post("/get_degree_list", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid request body."
        })

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(session.accountId)!
        const player = playerId !== null ? getPlayerSync(playerId) : null
        if (playerId === null || !player) return reply.status(500).send({
            error: "Internal Server Error",
            message: "No player bound to account."
        })

        ensurePlayerLegacyDegreesSync(playerId, player.degreeId || 1)
        ensurePlayerSoloTimeAttackDegreesSync(playerId)
        ensurePlayerClaimedCarnivalDegreesSync(playerId)
        const degreeIds = getPlayerDegreeIdsSync(playerId)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {
                degree_ids: degreeIds,
            }
        })
    })

    // Set the player's displayed degree title
    fastify.post("/update_degree", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const viewerId = body.viewer_id
        const degreeId = body.degree_id
        if (!viewerId || isNaN(viewerId) || degreeId === undefined || isNaN(degreeId)) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid request body."
            })
        }

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(session.accountId)!
        if (playerId === null) return reply.status(500).send({
            error: "Internal Server Error",
            message: "No player bound to account."
        })

        const player = getPlayerSync(playerId)
        if (!player) return reply.status(500).send({
            error: "Internal Server Error",
            message: "Player not found."
        })

        ensurePlayerLegacyDegreesSync(playerId, player.degreeId || 1)
        ensurePlayerClaimedCarnivalDegreesSync(playerId)
        if (!hasPlayerDegreeSync(playerId, Number(degreeId))) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Degree is not owned."
            })
        }

        updatePlayerSync({ id: playerId, degreeId: Number(degreeId) })

        gameVerboseLog(() => `[PROFILE] update_degree viewer=${viewerId} degree=${degreeId}`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {
                user_info: { degree_id: Number(degreeId) }
            }
        })
    })

    // Update profile visibility settings (echo back, don't persist)
    fastify.post("/update_profile_settings", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid request body."
        })

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid viewer id."
        })

        const settings = body.profile_settings || {}
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {
                profile_settings: {
                    show_opened_mana_board_second_count: settings.show_opened_mana_board_second_count ?? false,
                    show_owned_character_count: settings.show_owned_character_count ?? false,
                    show_owned_degree_count: settings.show_owned_degree_count ?? false,
                }
            }
        })
    })

    // Update profile comment
    fastify.post("/update_comment", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid request body."
        })

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(session.accountId)!
        if (playerId === null) return reply.status(400).send({
            error: "Bad Request",
            message: "No player bound to account."
        })

        const comment = (body.comment || "").substring(0, 100)
        updatePlayerSync({ id: playerId, comment })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: { comment },
        })
    })

    // Rename player
    fastify.post("/rename", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid request body."
        })

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(session.accountId)!
        if (playerId === null) return reply.status(400).send({
            error: "Bad Request",
            message: "No player bound to account."
        })

        const name = (body.name || "").substring(0, 20)
        updatePlayerSync({ id: playerId, name })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: { name },
        })
    })
}

export default routes
