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
import { readGameplayMutationRequestSync, recordGameplayMutationResponseSync } from "../../lib/gameplay-mutation-receipt";
import { gameVerboseLog } from "../../lib/game-logging";

interface ItemEffectInfo {
    effectKind: number
    effectValue: number
}

const ITEM_EFFECTS: Record<number, ItemEffectInfo> = itemData as Record<number, ItemEffectInfo>

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/use_item", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body ?? {}) as {
            viewer_id: number
            api_count: number
            items: { id: number; number: number; selectIndex: number }[]
        }
        const viewerId = body.viewer_id
        if (!Number.isSafeInteger(viewerId) || viewerId <= 0 || !Array.isArray(body.items) || body.items.length === 0) {
            return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." })
        }
        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." })
        const playerId = resolvePlayerIdSync(session.accountId)
        if (!playerId) return reply.status(500).send({ error: "Internal Server Error", message: "No player bound to account." })

        let applied: { currentStamina: number; afterStamina: number; recovery: number; items: Record<number, number> } | undefined
        const outcome = await runPersistenceTransaction({
            domain: "player", playerId, operation: "use_stamina_items",
        }, () => {
            const mutation = readGameplayMutationRequestSync(playerId, {
                headerToken: request.headers.login_token, body, accountId: session.accountId,
            }, "use_stamina_items", { items: body.items })
            if (!mutation) return { error: "Invalid or superseded gameplay request." }
            if (mutation.response) return { data: mutation.response }
            const player = getPlayerSync(playerId)
            if (!player) return { error: "Player not found.", status: 500 }
            const maxOverflow = getConfigSync().max_stamina_overflow
            const requestedCounts = new Map<number, number>()
            let totalStaminaRecovery = 0
            for (const itemReq of body.items) {
                const itemId = itemReq?.id, count = itemReq?.number
                if (!Number.isSafeInteger(itemId) || itemId <= 0 || !Number.isSafeInteger(count) || count <= 0) continue
                const effect = ITEM_EFFECTS[itemId]
                if (!effect || (effect.effectKind !== 2 && effect.effectKind !== 3)) continue
                const combined = (requestedCounts.get(itemId) ?? 0) + count
                if (!Number.isSafeInteger(combined)) return { error: "Insufficient items." }
                const recovery = effect.effectKind === 2 ? effect.effectValue
                    : Math.floor(Math.max(0, maxOverflow) * Math.max(0, effect.effectValue) / 100)
                totalStaminaRecovery += Number.isFinite(recovery) && recovery >= 0 ? recovery * count : 0
                requestedCounts.set(itemId, combined)
            }
            if (requestedCounts.size === 0) return { error: "No valid stamina items." }
            if (!Number.isFinite(totalStaminaRecovery) || totalStaminaRecovery <= 0) return { error: "Zero recovery." }
            const itemList: Record<number, number> = {}
            for (const [itemId, count] of requestedCounts) {
                const current = getPlayerItemSync(playerId, itemId) ?? 0
                if (current < count) return { error: "Insufficient items." }
                itemList[itemId] = current - count
            }
            const currentStamina = computeRealTimeStamina(player)
            if (currentStamina >= maxOverflow) return { error: "Already at max stamina.", code: 2102 }
            const afterStamina = Math.min(currentStamina + totalStaminaRecovery, maxOverflow)
            const healTime = new Date()
            for (const [itemId, count] of Object.entries(itemList)) updatePlayerItemSync(playerId, Number(itemId), count)
            updatePlayerSync({ id: playerId, stamina: afterStamina, staminaHealTime: healTime })
            const data = {
                user_info: { stamina: afterStamina, stamina_heal_time: realToVirtual(healTime) },
                item_list: itemList,
            }
            recordGameplayMutationResponseSync(playerId, mutation, data)
            applied = { currentStamina, afterStamina, recovery: totalStaminaRecovery, items: itemList }
            return { data }
        })
        if (outcome.error !== undefined) return reply.status(outcome.status ?? 400).send({
            error: outcome.status === 500 ? "Internal Server Error" : "Bad Request",
            message: outcome.error, ...(outcome.code ? { code: outcome.code } : {}),
        })
        if (applied) {
            const { currentStamina, afterStamina, recovery, items } = applied
            gameVerboseLog(() => `[ITEM-USE] player ${playerId}: stamina ${currentStamina}->${afterStamina} (+${recovery}), items: ${JSON.stringify(items)}`)
        }
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({ data_headers: generateDataHeaders({ viewer_id: viewerId }), data: outcome.data })
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
