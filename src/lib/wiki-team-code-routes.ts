import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { getSession } from "../data/domains/session"
import { getPlayerSync } from "../data/domains/player"
import { getPlayerCharactersSync, getPlayerCharacterManaNodesSync } from "../data/domains/character"
import { getPlayerEquipmentListSync } from "../data/domains/equipment"
import { getPlayerItemsSync } from "../data/domains/item"
import { resolvePlayerIdSync } from "../data/activeAccount"
import { generateDataHeaders } from "../utils"
import { createTeamCodeClient, GAME_CODE_PATTERN, TeamCodeError, TeamCodeLimiter, TeamCodePayload } from "./wiki-team-code-client"
import { loadTeamCodeAssets, nativeBattleParty, resolvePublicTeam, TeamAssets, TeamInventory } from "./wiki-team-code-inventory"

export function playerTeamInventory(playerId: number): TeamInventory {
    return {characters: getPlayerCharactersSync(playerId), equipment: getPlayerEquipmentListSync(playerId),
        items: getPlayerItemsSync(playerId), nodes: (id) => getPlayerCharacterManaNodesSync(playerId, id)}
}
export function registerWikiTeamCodeRoutes(fastify: FastifyInstance, options: {
    lookup?: (code: string) => Promise<TeamCodePayload>; assets?: () => TeamAssets; limiter?: TeamCodeLimiter
} = {}) {
    const lookup = options.lookup || createTeamCodeClient(), assets = options.assets || loadTeamCodeAssets
    const limiter = options.limiter || new TeamCodeLimiter()
    const failure = (reply: FastifyReply, viewerId: number, code: number) => {
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({data_headers: generateDataHeaders({viewer_id: viewerId, result_code: code}), data: {}})
    }
    async function identity(request: FastifyRequest, reply: FastifyReply) {
        const body = request.body as {viewer_id?: unknown; party_code?: unknown} | undefined
        const viewerId = body?.viewer_id
        if (typeof viewerId !== "number" || !Number.isSafeInteger(viewerId) || viewerId <= 0) {
            reply.status(400).send({error: "Bad Request", message: "Invalid request body."}); return null
        }
        if (!limiter.take(`ip:${request.ip}`, 60)) {reply.header("Retry-After", "60"); failure(reply, viewerId, 3404); return null}
        const session = await getSession(String(viewerId))
        const playerId = session ? resolvePlayerIdSync(session.accountId) : null
        if (playerId === null || !getPlayerSync(playerId)) {
            reply.status(400).send({error: "Bad Request", message: "Invalid viewer id."}); return null
        }
        if (!limiter.take(`viewer:${viewerId}`, 12) || !limiter.take(`player:${playerId}`, 12)) {
            reply.header("Retry-After", "60"); failure(reply, viewerId, 3404); return null
        }
        return {viewerId, playerId, body}
    }
    // Native players can consume curated codes; only the separately authenticated Wiki admins can mint them.
    fastify.post("/publish", async (request, reply) => {
        const who = await identity(request, reply); if (!who) return
        return failure(reply, who.viewerId, 3403)
    })
    fastify.post("/refer", async (request, reply) => {
        const who = await identity(request, reply); if (!who) return
        const code = who.body?.party_code
        if (typeof code !== "string" || !GAME_CODE_PATTERN.test(code)) return failure(reply, who.viewerId, 3404)
        try {
            const entry = await lookup(code), catalog = assets()
            const party = nativeBattleParty(resolvePublicTeam(entry.team, catalog), playerTeamInventory(who.playerId), catalog)
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({data_headers: generateDataHeaders({viewer_id: who.viewerId}),
                data: {party_name: entry.title, battle_party: party}})
        } catch (error) {
            return failure(reply, who.viewerId, error instanceof TeamCodeError && error.kind === "not-found" ? 3404 : 3403)
        }
    })
}
