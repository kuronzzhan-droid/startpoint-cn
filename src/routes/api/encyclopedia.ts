// Handles the insertion of mana into characters.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSession } from "../../data/domains/session"
import { resolvePlayerIdSync } from "../../data/activeAccount";
import {
    getPlayerEncyclopediaKeywordsSync,
    readPlayerEncyclopediaKeywordsSync,
    unlockPlayerEncyclopediaKeywordsSync,
} from "../../data/domains/encyclopedia";
import { getPlayerItemSync } from "../../data/domains/item";
import { getConfigSync } from "../../lib/assets";
import { generateDataHeaders } from "../../utils";
import encyclopedia from "../../../assets/encyclopedia.json";

interface IndexBody {
    api_count: number,
    viewer_id: number,
}

interface ReadKeywordBody {
    encyclopedia_ids: number[],
    viewer_id: number
}

const FALLBACK_ENCYCLOPEDIA_KEY_ITEM_ID = 49200

function validateEncyclopediaIds(value: unknown): value is number[] {
    return Array.isArray(value)
        && value.length > 0
        && value.length <= 50
        && value.every(id => Number.isSafeInteger(id) && id > 0)
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/read_keyword", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ReadKeywordBody

        const viewerId = body.viewer_id
        const encyclopediaIds = body.encyclopedia_ids
        if (!viewerId || isNaN(viewerId) || !validateEncyclopediaIds(encyclopediaIds)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        const encyclopediaList = readPlayerEncyclopediaKeywordsSync(playerId, encyclopediaIds)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "encyclopedia_list": encyclopediaList,
                "encyclopedia_info": encyclopediaList
            }
        })
    })

    fastify.post("/unlock_keyword", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ReadKeywordBody
        const viewerId = body.viewer_id
        const encyclopediaIds = body.encyclopedia_ids
        if (!viewerId || isNaN(viewerId) || !validateEncyclopediaIds(encyclopediaIds)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        const keyItemId = getConfigSync().encyclopedia_point_item_id || FALLBACK_ENCYCLOPEDIA_KEY_ITEM_ID
        const baseEncyclopedia = encyclopedia as Record<string, { read: boolean }>
        const idsToUnlock = [...new Set(encyclopediaIds)].filter(id => baseEncyclopedia[String(id)] === undefined)

        let encyclopediaList: Record<string, { read: boolean }>
        let itemAmount: number
        let consumedKey = false
        if (idsToUnlock.length === 0) {
            encyclopediaList = Object.fromEntries(
                encyclopediaIds.map(id => [String(id), baseEncyclopedia[String(id)]])
            )
            itemAmount = getPlayerItemSync(playerId, keyItemId) ?? 0
        } else {
            const result = unlockPlayerEncyclopediaKeywordsSync(playerId, idsToUnlock, keyItemId)
            if (result === null) return reply.status(400).send({
                "error": "Bad Request",
                "message": "Not enough encyclopedia keys."
            })
            encyclopediaList = {
                ...Object.fromEntries(
                    encyclopediaIds
                        .filter(id => baseEncyclopedia[String(id)] !== undefined)
                        .map(id => [String(id), baseEncyclopedia[String(id)]])
                ),
                ...result.encyclopediaList,
            }
            itemAmount = result.itemAmount
            consumedKey = result.consumedKey
        }

        console.log(
            `[ENCYCLOPEDIA] unlock player=${playerId} ids=${encyclopediaIds.join(",")} `
            + `key=${keyItemId} remaining=${itemAmount} consumed=${consumedKey}`
        )

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "encyclopedia_list": encyclopediaList,
                "encyclopedia_info": encyclopediaList,
                "item_list": {
                    [keyItemId]: itemAmount
                }
            }
        })
    })

    fastify.post("/index", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as IndexBody

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

        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })
        const playerEncyclopedia = getPlayerEncyclopediaKeywordsSync(playerId)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "encyclopedia_list": {
                    ...encyclopedia,
                    ...playerEncyclopedia
                },
                "mail_arrived": false
            }
        })
    })
}

export default routes;
