import { recordContentActionFactsSync } from "../../lib/mission/content-action-facts";
// Handles the insertion of mana into characters.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getPlayerCharacterSync, getPlayerCharactersSync, updatePlayerCharacterSync } from "../../data/domains/character"
import { getPlayerItemSync, updatePlayerItemSync } from "../../data/domains/item"
import { getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getSession } from "../../data/domains/session"
import { generateDataHeaders } from "../../utils";
import { getCharacterDataSync } from "../../lib/assets";
import { grantCharacterDegreeRewardsSync } from "../../lib/character-degree-rewards";
import { characterExpCaps } from "../../lib/character";
import { clientSerializeDate } from "../../data/utils";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { settleDegreeMissionResponse } from "../../lib/mission";
import { gameVerboseLog } from "../../lib/game-logging";
import { runPersistenceTransaction } from "../../lib/persistence-coordinator";
import { getExtendedOverLimitExtraCosts, validateOverLimitRequest } from "../../lib/character-overlimit";
import { readGameplayMutationRequestSync, recordGameplayMutationResponseSync } from "../../lib/gameplay-mutation-receipt";
import { handleTownCharacterClaim } from "../../lib/town-character-claim";

interface OverLimitBody {
    viewer_id: number
    character_id: number
    api_count: number
    use_stack: boolean
    item_id: number,
    over_limit_count: number
}

interface SetIllustrationSettingsBody {
    character_id: number,
    api_count: number,
    illustration_settings: number[],
    viewer_id: number
}

export const characterMaxOverLimits: Record<number, number> = {
    [1]: 12, // 1* max over limit count
    [2]: 10, // 2* max over limit count
    [3]: 8,  // 3* max over limit count
    [4]: 6,  // 4* max over limit count
    [5]: 4,  // 5* max over limit count
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/set_illustration_settings", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SetIllustrationSettingsBody

        const viewerId = body.viewer_id
        const characterId = body.character_id
        const illustration_settings = body.illustration_settings
        if (isNaN(viewerId) || isNaN(characterId) || !illustration_settings) return reply.status(400).send({
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
        if (playerId === undefined) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        await runPersistenceTransaction({
            domain: "player", playerId, operation: "character_illustration_settings",
        }, () => {
            updatePlayerCharacterSync(playerId, characterId, {
                illustrationSettings: illustration_settings.slice(0, 6)
            })
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {}
        }) 
    })

    fastify.post("/over_limit", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as OverLimitBody

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
        const player = playerId !== null ? getPlayerSync(playerId) : null

        if (player === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        const characterId = body.character_id
        const overLimitCount = body.over_limit_count
        if (!Number.isSafeInteger(overLimitCount) || overLimitCount <= 0) {
            return reply.status(400).send({ error: "Bad Request", message: "Invalid over limit count." })
        }
        const result = await runPersistenceTransaction({
            domain: "player", playerId, operation: "character_over_limit",
        }, () => {
            const mutation = readGameplayMutationRequestSync(playerId, {
                headerToken: request.headers.login_token, body, accountId: viewerIdSession.accountId,
            }, "character_over_limit", { characterId, overLimitCount, useStack: Boolean(body.use_stack), itemId: body.item_id })
            if (!mutation) return { error: "Invalid or superseded gameplay request." }
            if (mutation.response) return { data: mutation.response }
            const characterAssetData = getCharacterDataSync(characterId)
            if (!characterAssetData) return { error: "No character asset data found." }
            // Read balances and progress after reaching the head of the player queue.
            const character = getPlayerCharacterSync(playerId, characterId)
            if (!character) return { error: "Character not owned." }
            const newOverLimit = character.overLimitStep + overLimitCount
            const rarity = characterAssetData.rarity
            const requestError = validateOverLimitRequest(
                characterId, rarity, character.overLimitStep, overLimitCount,
                Boolean(body.use_stack), body.item_id,
            )
            if (requestError !== null) return { error: requestError }
            let stack = character.stack
            const itemList: Record<number, number> = {}
            if (body.use_stack) {
                stack -= overLimitCount
                if (stack < 0) return { error: "Character does not have enough duplicates to uncap." }
                updatePlayerCharacterSync(playerId, characterId, { overLimitStep: newOverLimit, stack })
            } else {
                const itemId = body.item_id
                const costs = [{ itemId, amount: overLimitCount }, ...getExtendedOverLimitExtraCosts(
                    characterId, rarity, character.overLimitStep, overLimitCount,
                )]
                const remainders: Record<number, number> = {}
                for (const cost of costs) {
                    const count = getPlayerItemSync(playerId, cost.itemId)
                    if (count === null) return { error: "Attempted to use unowned item." }
                    const remaining = count - cost.amount
                    if (remaining < 0) return { error: "Not enough of item to uncap." }
                    remainders[cost.itemId] = remaining
                }
                for (const [costItemId, remaining] of Object.entries(remainders)) {
                    updatePlayerItemSync(playerId, Number(costItemId), remaining)
                    itemList[Number(costItemId)] = remaining
                }
                updatePlayerCharacterSync(playerId, characterId, { overLimitStep: newOverLimit })
            }
            grantCharacterDegreeRewardsSync(playerId, [characterId])
            recordContentActionFactsSync(playerId, { kind: "over_limit", amount: overLimitCount })
            const data: Record<string, any> = {
                character_list: [{
                    over_limit_step: newOverLimit, character_id: characterId, stack,
                    create_time: clientSerializeDate(character.joinTime),
                    update_time: clientSerializeDate(new Date()),
                    join_time: clientSerializeDate(character.joinTime),
                }],
                item_list: itemList, mail_arrived: false,
            }
            settleDegreeMissionResponse(playerId, viewerId, data, undefined, [9])
            recordGameplayMutationResponseSync(playerId, mutation, data)
            return { data }
        })
        if (result.error !== undefined) {
            return reply.status(400).send({ error: "Bad Request", message: result.error })
        }
        const responseData = result.data

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": responseData
        })
    })

    fastify.post("/bulk_over_limit", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number; api_count?: number }

        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            error: "Bad Request", message: "Invalid request body.",
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            error: "Bad Request", message: "Invalid viewer id.",
        })

        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        const player = playerId !== null ? getPlayerSync(playerId) : null
        if (player === null) return reply.status(500).send({
            error: "Internal Server Error", message: "No players bound to account.",
        })

        const responseData = await runPersistenceTransaction({
            domain: "player", playerId, operation: "character_bulk_over_limit",
        }, () => {
            const characters = getPlayerCharactersSync(playerId)
            const characterList: any[] = []
            gameVerboseLog(() => `[bulk_over_limit] player=${playerId} totalChars=${Object.keys(characters).length}`)
            for (const [charId, charData] of Object.entries(characters)) {
                if (charData.stack <= 0) continue

                const assetData = getCharacterDataSync(Number(charId))
                if (!assetData) continue

                const maxOver = characterMaxOverLimits[assetData.rarity]
                if (maxOver === undefined) continue

                const rest = maxOver - charData.overLimitStep
                if (rest <= 0) continue

                const count = Math.min(charData.stack, rest)
                const newOverLimit = charData.overLimitStep + count
                const newStack = charData.stack - count

                updatePlayerCharacterSync(playerId, Number(charId), {
                    overLimitStep: newOverLimit,
                    stack: newStack,
                })
                grantCharacterDegreeRewardsSync(playerId, [Number(charId)])
                recordContentActionFactsSync(playerId, { kind: "over_limit", amount: count })

                characterList.push({
                    character_id: Number(charId),
                    over_limit_step: newOverLimit,
                    stack: newStack,
                    create_time: clientSerializeDate(charData.joinTime),
                    update_time: clientSerializeDate(new Date()),
                    join_time: clientSerializeDate(charData.joinTime),
                })
            }
            gameVerboseLog(() => `[bulk_over_limit] done: ${characterList.length} characters modified`)
            const data: Record<string, any> = { character_list: characterList, mail_arrived: false }
            settleDegreeMissionResponse(playerId, viewerId, data, undefined, [9])
            return data
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: responseData,
        })
    })

    fastify.post("/add_character_from_town", handleTownCharacterClaim)
}

export default routes;
