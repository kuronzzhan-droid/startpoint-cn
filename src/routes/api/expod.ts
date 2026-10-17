import { getPlayerClientExpTime } from "../../lib/player-time-compat"
// Handles the insertion of mana into characters.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAccountPlayers } from "../../data/domains/account"
import { getPlayerCharacterSync, getPlayerCharactersSync, updatePlayerCharacterSync } from "../../data/domains/character"
import { getPlayerItemsSync, givePlayerItemSync } from "../../data/domains/item"
import { adjustPlayerExpPoolSync, collectPlayerDataPooledExpSync, getPlayerSync } from "../../data/domains/player"
import { getSession } from "../../data/domains/session"
import { getCharacterMaxOverLimit } from "../../lib/character-overlimit";
import { givePlayerCharactersExpSync } from "../../lib/character";
import { generateDataHeaders, getServerDate, getServerTime } from "../../utils";
import { getCharacterDataSync } from "../../lib/assets";
import { clientSerializeDate } from "../../data/utils";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { incrementActiveMissionInjectedExpCountSync } from "../../data/domains/active_mission_counters"
import { validateCharacterStackConversion } from "../../lib/character-stack";
import { settleDegreeMissionResponse } from "../../lib/mission";
import { runPersistenceTransaction } from "../../lib/persistence-coordinator";

interface InjectExpBody {
    character_id: number,
    viewer_id: number,
    exp: number,
    api_count: number
}

interface StackToExpBody {
    character_id: number,
    api_count: number,
    number: number,
    viewer_id: number
}

interface BulkStackToExpBody {
    viewer_id: number
    api_count: number
}

const rarityStackConvertItemCount: Record<number, number> = {
    [1]: 2,
    [2]: 2,
    [3]: 2,
    [4]: 10,
    [5]: 30 
}
const rewardItemId = 990008

const rarityStackConvertExp: Record<number, number> = {
    [1]: 500,
    [2]: 500,
    [3]: 500,
    [4]: 2000,
    [5]: 10000
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/stack_to_exp", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as StackToExpBody

        const viewerId = body.viewer_id
        const characterId = body.character_id
        const convertCount = body.number
        if (isNaN(viewerId) || isNaN(characterId)) return reply.status(400).send({
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

        // get character asset data
        const characterAssetData = getCharacterDataSync(characterId)
        if (characterAssetData === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Character does not exist."
        })

        // get character
        const character = getPlayerCharacterSync(playerId, characterId)
        if (character === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Player does not own character."
        })
        
        const validationError = validateCharacterStackConversion(
            character.stack,
            convertCount,
            character.protection,
        )
        if (validationError) return reply.status(400).send({
            "error": "Bad Request",
            "message": validationError
        })

        const afterStack = character.stack - convertCount

        // get amounts to add
        const rarity = characterAssetData.rarity
        const increaseExp = rarityStackConvertExp[rarity] * convertCount
        const increaseItemCount = rarityStackConvertItemCount[rarity] * convertCount

        let afterExp = player.expPool
        let afterItemCount = getPlayerItemsSync(playerId)[String(rewardItemId)] ?? 0
        await runPersistenceTransaction({
            domain: "player", playerId, operation: "convert_stack_to_exp",
        }, () => {
            updatePlayerCharacterSync(playerId, characterId, { stack: afterStack })
            const adjustedExp = adjustPlayerExpPoolSync(playerId, increaseExp, 'stack_to_exp')
            if (adjustedExp === null) throw new Error(`Failed to update EXP pool for player ${playerId}`)
            afterExp = adjustedExp
            afterItemCount = givePlayerItemSync(playerId, rewardItemId, increaseItemCount)
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "user_info": {
                    "exp_pool": afterExp,
                    "exp_pooled_time": getPlayerClientExpTime(player)
                },
                "character_list": [
                    {
                        "viewer_id": viewerId,
                        "character_id": characterId,
                        "stack": afterStack,
                        "exp": character.exp,
                        "exp_total": character.exp,
                        "create_time": clientSerializeDate(character.joinTime),
                        "update_time": clientSerializeDate(new Date()),
                        "join_time": clientSerializeDate(character.joinTime)
                    }
                ],
                "converted_exp_info": {
                    "add_exp": increaseExp
                },
                "item_list": {
                    [rewardItemId]: afterItemCount
                },
                "mail_arrived": false
            }
        })
    })

    fastify.post("/bulk_stack_to_exp", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as BulkStackToExpBody

        const viewerId = body.viewer_id
        if (isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(session.accountId)!
        const player = playerId !== null ? getPlayerSync(playerId) : null
        if (player === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        const allCharacters = getPlayerCharactersSync(playerId)
        const modifiedCharacters: Object[] = []
        let totalExp = 0
        let totalStarGrains = 0
        let processedCount = 0
        const conversions: { characterId: number, stack: number }[] = []

        for (const [characterIdStr, character] of Object.entries(allCharacters)) {
            const characterId = parseInt(characterIdStr)
            if (character.stack <= 0 || character.protection) continue

            const charAsset = getCharacterDataSync(characterId)
            if (!charAsset) continue

            const rarity = charAsset.rarity
            const maxOver = getCharacterMaxOverLimit(characterId, rarity) ?? 0
            if (character.overLimitStep < maxOver) continue

            const stack = character.stack
            const addExp = (rarityStackConvertExp[rarity] ?? 0) * stack
            const addStarGrain = (rarityStackConvertItemCount[rarity] ?? 0) * stack

            totalExp += addExp
            totalStarGrains += addStarGrain

            conversions.push({ characterId, stack })

            modifiedCharacters.push({
                "viewer_id": viewerId,
                "character_id": characterId,
                "stack": 0,
                "over_limit_step": character.overLimitStep,
                "exp": character.exp,
                "exp_total": character.exp,
                "create_time": clientSerializeDate(character.joinTime),
                "update_time": clientSerializeDate(character.updateTime),
                "join_time": clientSerializeDate(character.joinTime)
            })
            processedCount++
        }

        if (processedCount === 0) {
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId }),
                "data": {
                    "character_list": [],
                    "converted_exp_info": { "add_exp": 0 },
                    "item_list": getPlayerItemsSync(playerId),
                    "user_info": {
                        "exp_pool": player.expPool,
                        "exp_pooled_time": getPlayerClientExpTime(player)
                    },
                    "mail_arrived": false
                }
            })
        }

        let newExpPool = player.expPool
        let newStarGrainTotal = 0
        await runPersistenceTransaction({
            domain: "player", playerId, operation: "bulk_convert_stack_to_exp",
        }, () => {
            for (const conversion of conversions) {
                updatePlayerCharacterSync(playerId, conversion.characterId, { stack: 0 })
            }
            const adjustedExp = adjustPlayerExpPoolSync(playerId, totalExp, 'bulk_stack_to_exp')
            if (adjustedExp === null) throw new Error(`Failed to update EXP pool for player ${playerId}`)
            newExpPool = adjustedExp
            if (totalStarGrains > 0) {
                newStarGrainTotal = givePlayerItemSync(playerId, rewardItemId, totalStarGrains)
            }
        })

        const items = getPlayerItemsSync(playerId)
        if (totalStarGrains > 0) {
            items[String(rewardItemId)] = newStarGrainTotal
        }

        console.log(`[BULK_STACK_EXP] player ${playerId}: ${processedCount} characters converted, exp +${totalExp}, starGrain +${totalStarGrains}, expPool ${player.expPool}→${newExpPool}`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "character_list": modifiedCharacters,
                "converted_exp_info": { "add_exp": totalExp },
                "item_list": items,
                "user_info": {
                    "exp_pool": newExpPool,
                    "exp_pooled_time": getPlayerClientExpTime(player)
                },
                "mail_arrived": false
            }
        })
    })

    fastify.post("/inject_exp", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as InjectExpBody

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

        // increase character exp
        const characterId = body.character_id
        const character = getPlayerCharacterSync(playerId, characterId)
        if (character === null) return reply.status(400).send({
            "error": "Internal Server Error",
            "message": "Player does not own character."
        })

        // Some CN clients send the spend as a negative delta. Accept either
        // sign, but reject zero, fractional and unsafe values before touching
        // the player's balance.
        const rawRequestedExp = body.exp
        if (typeof rawRequestedExp !== "number"
            || !Number.isSafeInteger(rawRequestedExp)
            || rawRequestedExp === 0) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid exp amount."
        })
        const requestedExp = Math.abs(rawRequestedExp)
        const requestTime = getServerDate()
        let expPooledTime = player.expPooledTime

        const rewardResult = await runPersistenceTransaction({
            domain: "player", playerId, operation: "inject_exp",
        }, () => {
            // Refresh passive pooled EXP before comparing with the amount the
            // client displayed, then read and deduct the authoritative balance
            // in the same transaction. A stale client may request slightly
            // more than remains; spend the remainder instead of returning an
            // HTTP 400, which the legacy client treats as a fatal H400 logout.
            const beforeSpend = getPlayerSync(playerId)
            if (beforeSpend === null) throw new Error(`Player ${playerId} disappeared during EXP injection`)
            collectPlayerDataPooledExpSync(beforeSpend, requestTime)
            const refreshedPlayer = getPlayerSync(playerId)
            if (refreshedPlayer === null) throw new Error(`Player ${playerId} disappeared during EXP refresh`)

            const spendExp = Math.min(requestedExp, refreshedPlayer.expPool)
            if (spendExp < requestedExp) {
                console.warn(
                    `[EXP_POOL] clamped inject player=${playerId} requested=${requestedExp} available=${refreshedPlayer.expPool}`
                )
            }
            if (spendExp > 0) {
                const afterDeduction = adjustPlayerExpPoolSync(playerId, -spendExp, "inject_exp")
                if (afterDeduction === null) {
                    throw new Error(`Failed to deduct EXP pool for player ${playerId}`)
                }
            }

            const result = givePlayerCharactersExpSync(playerId, [characterId], spendExp, false)
            if (spendExp > 0) incrementActiveMissionInjectedExpCountSync(playerId)
            expPooledTime = getPlayerSync(playerId)?.expPooledTime ?? refreshedPlayer.expPooledTime
            return result
        })

        const responseData: Record<string, any> = {
            "add_exp_list": rewardResult.add_exp_list,
            "character_list": rewardResult.character_list,
            "user_info": {
                "exp_pool": rewardResult.exp_pool,
                "exp_pooled_time": getPlayerClientExpTime({ expPooledTime, timeOffset: getPlayerSync(playerId)?.timeOffset })
            },
        }
        settleDegreeMissionResponse(playerId, viewerId, responseData, undefined, [5, 44], [characterId])

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": responseData
        })
    })
}

export default routes;
