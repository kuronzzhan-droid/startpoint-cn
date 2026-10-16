// Handles item usage (stamina recovery items, etc.)
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getPlayerItemSync, updatePlayerItemSync } from "../../data/domains/item"
import { getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getSession } from "../../data/domains/session"
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { getConfigSync } from "../../lib/assets";
import { generateDataHeaders, getServerTime, realToVirtual } from "../../utils";
import { sellItemSync } from "../../lib/item-sell";
import { AccountId, PlayerId } from "../../lib/types";
import { computeRealTimeStamina } from "../../lib/stamina";
import itemData from "../../../assets/item_data.json";
import { reconcileAwakeUnlockCharacterList } from "../../lib/mission";
import { runPersistenceTransaction } from "../../lib/persistence-coordinator";
import { gameVerboseLog } from "../../lib/game-logging";

interface ItemEffectInfo {
    effectKind: number
    effectValue: number
}

const ITEM_EFFECTS: Record<number, ItemEffectInfo> = itemData as Record<number, ItemEffectInfo>

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/use_item", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as {
            viewer_id: number
            api_count: number
            items: { id: number; number: number; selectIndex: number }[]
        }

        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId) || !Array.isArray(body.items) || body.items.length === 0) {
            console.warn('[ITEM-USE] invalid request body')
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid request body." })
        }

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." })

        const playerId = resolvePlayerIdSync(session.accountId)!
        if (!playerId) return reply.status(500).send({ "error": "Internal Server Error", "message": "No player bound to account." })

        if (!getPlayerSync(playerId)) return reply.status(500).send({ "error": "Internal Server Error", "message": "Player not found." })

        const config = getConfigSync()
        const maxOverflow = config.max_stamina_overflow

        let totalStaminaRecovery = 0
        // Aggregate repeated entries for the same item so ownership is checked
        // against the combined amount, not once per entry.
        const requestedCounts = new Map<number, number>()
        let hasStaminaItem = false

        for (const itemReq of body.items) {
            const itemId = itemReq?.id
            const requestCount = itemReq?.number

            if (!Number.isSafeInteger(itemId) || itemId <= 0) {
                console.warn(`[ITEM-USE] invalid item id: ${itemId}`)
                continue
            }
            if (!Number.isSafeInteger(requestCount) || requestCount <= 0) {
                console.warn(`[ITEM-USE] invalid count: ${requestCount} for item ${itemId}`)
                continue
            }

            const effectInfo = ITEM_EFFECTS[itemId]
            if (!effectInfo) {
                console.warn(`[ITEM-USE] item ${itemId} not in effect table, skipping`)
                continue
            }

            const { effectKind, effectValue } = effectInfo

            // Only handle stamina recovery items
            if (effectKind !== 2 && effectKind !== 3) {
                console.warn(`[ITEM-USE] item ${itemId} effectKind=${effectKind}, not a stamina item, skipping`)
                continue
            }

            const combinedCount = (requestedCounts.get(itemId) ?? 0) + requestCount
            if (!Number.isSafeInteger(combinedCount)) {
                return reply.status(400).send({ "error": "Bad Request", "message": "Insufficient items." })
            }

            let recoveryAmount: number
            if (effectKind === 2) {
                // StaminaFixed: fixed recovery amount
                recoveryAmount = effectValue
            } else {
                // StaminaRate: percentage of max overflow
                const rate = Math.max(0, effectValue) / 100 // e.g. 50 = 50%
                recoveryAmount = Math.floor(Math.max(0, maxOverflow) * rate)
            }

            if (!isFinite(recoveryAmount) || recoveryAmount < 0) {
                console.warn(`[ITEM-USE] invalid recovery amount for item ${itemId}: ${recoveryAmount}`)
                recoveryAmount = 0
            }

            totalStaminaRecovery += recoveryAmount * requestCount
            requestedCounts.set(itemId, combinedCount)
            hasStaminaItem = true
        }

        if (!hasStaminaItem) {
            console.warn(`[ITEM-USE] no valid stamina recovery items in request`)
            return reply.status(400).send({ "error": "Bad Request", "message": "No valid stamina items." })
        }

        if (totalStaminaRecovery <= 0) {
            console.warn(`[ITEM-USE] zero total recovery`)
            return reply.status(400).send({ "error": "Bad Request", "message": "Zero recovery." })
        }

        // Ownership, current stamina, item consumption and stamina recovery are
        // all handled inside one player-owned persistence transaction so
        // overlapping requests cannot consume the same items twice and a partial
        // batch cannot consume items without applying the recovery.
        const outcome = await runPersistenceTransaction({
            domain: "player", playerId, operation: "use_stamina_items",
        }, () => {
            const player = getPlayerSync(playerId)
            if (!player) return { kind: "missing" as const }

            const itemUpdates: { id: number; newCount: number }[] = []
            for (const [itemId, requestCount] of requestedCounts) {
                const currentCount = getPlayerItemSync(playerId, itemId) ?? 0
                if (currentCount < requestCount) {
                    console.warn(`[ITEM-USE] player ${playerId} has ${currentCount} of item ${itemId}, requested ${requestCount}`)
                    return { kind: "insufficient" as const }
                }
                itemUpdates.push({ id: itemId, newCount: currentCount - requestCount })
            }

            const currentStamina = computeRealTimeStamina(player)
            if (currentStamina >= maxOverflow) return { kind: "full" as const, currentStamina }

            const afterStamina = Math.min(currentStamina + totalStaminaRecovery, maxOverflow)
            for (const upd of itemUpdates) {
                updatePlayerItemSync(playerId, upd.id, upd.newCount)
            }
            updatePlayerSync({
                id: playerId,
                stamina: afterStamina,
                staminaHealTime: new Date()
            })
            return { kind: "applied" as const, itemUpdates, currentStamina, afterStamina }
        })

        if (outcome.kind === "missing") {
            return reply.status(500).send({ "error": "Internal Server Error", "message": "Player not found." })
        }
        if (outcome.kind === "insufficient") {
            return reply.status(400).send({ "error": "Bad Request", "message": "Insufficient items." })
        }
        if (outcome.kind === "full") {
            console.log(`[ITEM-USE] player ${playerId} already at max stamina (${outcome.currentStamina} >= ${maxOverflow})`)
            return reply.status(400).send({ "error": "Bad Request", "code": 2102, "message": "Already at max stamina." })
        }

        const { itemUpdates, currentStamina, afterStamina } = outcome
        gameVerboseLog(() => `[ITEM-USE] player ${playerId}: stamina ${currentStamina}->${afterStamina} (+${totalStaminaRecovery}), items: ${JSON.stringify(itemUpdates)}`)

        // Build item_list as IntMap<int> (client expects { itemId: count })
        const itemListMap: Record<number, number> = {}
        for (const upd of itemUpdates) {
            itemListMap[upd.id] = upd.newCount
        }

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "user_info": {
                    "stamina": afterStamina,
                    "stamina_heal_time": realToVirtual(new Date())
                },
                "item_list": itemListMap
            }
        })
    })

    // ── sell (sell items/ability souls for mana) ────────────────────────
    fastify.post("/sell", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as {
            viewer_id: number
            api_count: number
            item_id: number
            sell_number: number
        }

        const viewerId = body.viewer_id
        const itemId = body.item_id
        const sellNumber = body.sell_number
        if (!viewerId || isNaN(viewerId) || !itemId || isNaN(itemId) || !sellNumber || isNaN(sellNumber)) {
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid request body." })
        }

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." })

        const accountId = session.accountId as AccountId
        const playerId = resolvePlayerIdSync(accountId)! as PlayerId
        if (!playerId) return reply.status(500).send({ "error": "Internal Server Error", "message": "No player bound to account." })

        // Ownership and mana checks must read the same state the write commits.
        const result = await runPersistenceTransaction({
            domain: "player", playerId, operation: "sell_item",
        }, () => sellItemSync(playerId, itemId, sellNumber))
        if (!result.ok) {
            const code = 'errorCode' in result ? result.errorCode : undefined
            return reply.status(400).send({ "error": "Bad Request", "code": code, "message": result.error })
        }
        const characterList = reconcileAwakeUnlockCharacterList(playerId, [])

        gameVerboseLog(() => `[ITEM_SELL] account=${accountId} player=${playerId}: item ${itemId} ×${sellNumber} sold, mana +${result.manaGained} (${result.freeMana - result.manaGained} -> ${result.freeMana})`)

        reply.header("content-type", "application/x-msgpack")
        const responseData: Record<string, unknown> = {
            "item_list": { [itemId]: result.newCount },
            "user_info": { "free_mana": result.freeMana },
            "mail_arrived": false
        }
        if (characterList.length > 0) responseData.character_list = characterList

        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": responseData
        })
    })
}

export default routes
