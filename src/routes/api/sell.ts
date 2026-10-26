// Equipment dismantle/sell endpoints: sell_equipment, sell_stack, bulk_sell_stack.
// Registered under /api/index.php/equipment prefix (shared with equipment.ts).

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
    getPlayerEquipmentSync, updatePlayerEquipmentSync,
} from "../../data/domains/equipment";
import { givePlayerItemSync } from "../../data/domains/item";
import { getSession } from "../../data/domains/session";
import { generateDataHeaders } from "../../utils";
import { buildFullEquipmentList } from "../../lib/equipment";
import { calculateDissolveRewards } from "../../lib/equipment-dissolve";
import { AccountId, PlayerId } from "../../lib/types";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { getConfigSync } from "../../lib/assets";
import { gameVerboseLog } from "../../lib/game-logging";
import { runPersistenceTransaction } from "../../lib/persistence-coordinator";
import { parsePositiveSafeInteger, parsePositiveSafeIntegerList, uniqueIds } from "../../lib/request-ids";
import { readGameplayMutationRequestSync, recordGameplayMutationResponseSync } from "../../lib/gameplay-mutation-receipt";

interface SellEquipmentListItem {
    equipment_id: number
}

interface SellStackEquipmentListItem extends SellEquipmentListItem {
    number: number
}

interface SellBody {
    equipment_list: SellEquipmentListItem[],
    viewer_id: number,
    api_count: number
}

interface BulkSellStackBody {
    viewer_id: number
    api_count: number
    equipment_ids: number[]
}

const wrightpieceItemId = () => getConfigSync().craft_point_item_id || 100000
const starGrainItemId = () => getConfigSync().star_grain_item_id || 990008

interface DissolveTotals {
    craftPoints: number
    starGrains: number
    abilitySouls: Record<number, number>
}

const newDissolveTotals = (): DissolveTotals => ({ craftPoints: 0, starGrains: 0, abilitySouls: {} })

function addDissolveRewards(totals: DissolveTotals, equipmentId: number, count: number) {
    const rewards = calculateDissolveRewards(equipmentId, count)
    totals.craftPoints += rewards.craftPoints
    totals.starGrains += rewards.starGrains
    for (const [soulId, soulCount] of Object.entries(rewards.abilitySouls)) {
        totals.abilitySouls[parseInt(soulId)] = (totals.abilitySouls[parseInt(soulId)] ?? 0) + soulCount
    }
    return rewards
}

function grantDissolveRewardsSync(playerId: PlayerId, totals: DissolveTotals): Record<number, number> {
    const result: Record<number, number> = {}
    if (totals.craftPoints > 0) {
        result[wrightpieceItemId()] = givePlayerItemSync(playerId, wrightpieceItemId(), totals.craftPoints)
    }
    if (totals.starGrains > 0) {
        result[starGrainItemId()] = givePlayerItemSync(playerId, starGrainItemId(), totals.starGrains)
    }
    for (const [soulId, count] of Object.entries(totals.abilitySouls)) {
        result[parseInt(soulId)] = givePlayerItemSync(playerId, parseInt(soulId), count)
    }
    return result
}

function describeSouls(totals: DissolveTotals): { soulTypes: number, soulDetail: string } {
    return {
        soulTypes: Object.keys(totals.abilitySouls).length,
        soulDetail: Object.entries(totals.abilitySouls).map(([id, c]) => `${id}×${c}`).join(' '),
    }
}

const invalidBody = (reply: FastifyReply) =>
    reply.status(400).send({ "error": "Bad Request", "message": "Invalid request body." })

const routes = async (fastify: FastifyInstance) => {

    // ── sell_equipment (single equipment, all stacks) ──────────────────
    fastify.post("/sell_equipment", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SellBody

        const viewerId = body.viewer_id
        const toSellEquipmentList = body.equipment_list
        if (isNaN(viewerId) || !Array.isArray(toSellEquipmentList)) return invalidBody(reply)

        const requestedIds = parsePositiveSafeIntegerList(toSellEquipmentList.map(entry => entry?.equipment_id))
        if (requestedIds === null) return invalidBody(reply)
        const equipmentIds = uniqueIds(requestedIds)

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." })

        const accountId = session.accountId as AccountId
        const playerId = resolvePlayerIdSync(accountId)! as PlayerId
        if (playerId === null) return reply.status(500).send({ "error": "Internal Server Error", "message": "No players bound to account." })

        // Ownership, stacks and rewards are read inside the player write
        // queue so overlapping requests cannot sell the same stack twice.
        const outcome = await runPersistenceTransaction({
            domain: "player", playerId, operation: "sell_equipment",
        }, () => {
            const mutation = readGameplayMutationRequestSync(playerId, {
                headerToken: request.headers.login_token, body, accountId,
            }, "sell_equipment", { equipment_ids: equipmentIds })
            if (!mutation) return { ok: false as const, message: "Invalid or conflicting request identity." }
            if (mutation.response) return { ok: true as const, responseData: mutation.response }
            const totals = newDissolveTotals()
            const soldIds: number[] = []
            for (const equipmentId of equipmentIds) {
                const equipment = getPlayerEquipmentSync(playerId, equipmentId)
                if (!equipment) return { ok: false as const }
                if (equipment.protection) return { ok: false as const, message: "Protected equipment cannot be sold." }
                if (equipment.stack <= 0) return { ok: false as const, message: "Not enough equipment stack." }

                // Native sell_equipment has no quantity and rewards one unit.
                // This server retains the base equipment: consume one duplicate only.
                addDissolveRewards(totals, equipmentId, 1)
                soldIds.push(equipmentId)
            }

            for (const equipmentId of soldIds) {
                const equipment = getPlayerEquipmentSync(playerId, equipmentId)!
                updatePlayerEquipmentSync(playerId, equipmentId, { stack: equipment.stack - 1 })
            }
            const itemList = grantDissolveRewardsSync(playerId, totals)
            const responseData = { equipment_list: buildFullEquipmentList(playerId), item_list: itemList, mail_arrived: false }
            recordGameplayMutationResponseSync(playerId, mutation, responseData)
            const craftLog = totals.craftPoints > 0 ? `craft +${totals.craftPoints} ` : ""
            const starLog = totals.starGrains > 0 ? `star +${totals.starGrains} ` : ""
            const { soulTypes, soulDetail } = describeSouls(totals)
            gameVerboseLog(() => `[SELL_EQUIP] account=${accountId} player=${playerId}: ${soldIds.length} equipment sold (${soldIds.join(',')}), ${craftLog}${starLog}ability souls: ${soulTypes} types [${soulDetail}]`)
            return { ok: true as const, responseData }
        })
        if (!outcome.ok) {
            return reply.status(400).send({ "error": "Bad Request", "message": outcome.message ?? "Player does not own equipment." })
        }

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": outcome.responseData
        })
    })

    // ── sell_stack (partial stack sale) ─────────────────────────────────
    fastify.post("/sell_stack", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SellBody

        const viewerId = body.viewer_id
        const toSellEquipmentList = body.equipment_list
        if (isNaN(viewerId) || !Array.isArray(toSellEquipmentList)) return invalidBody(reply)

        const requestedSales: { equipmentId: number, sellCount: number }[] = []
        for (const entry of toSellEquipmentList) {
            const equipmentId = parsePositiveSafeInteger(entry?.equipment_id)
            const sellCount = parsePositiveSafeInteger((entry as SellStackEquipmentListItem | undefined)?.number)
            if (equipmentId === null || sellCount === null) return invalidBody(reply)
            requestedSales.push({ equipmentId, sellCount })
        }

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." })

        const accountId = session.accountId as AccountId
        const playerId = resolvePlayerIdSync(accountId)! as PlayerId
        if (playerId === null) return reply.status(500).send({ "error": "Internal Server Error", "message": "No players bound to account." })

        const outcome = await runPersistenceTransaction({
            domain: "player", playerId, operation: "sell_equipment_stack",
        }, () => {
            const mutation = readGameplayMutationRequestSync(playerId, {
                headerToken: request.headers.login_token, body, accountId,
            }, "sell_equipment_stack", { equipment_list: requestedSales })
            if (!mutation) return { ok: false as const, message: "Invalid or conflicting request identity." }
            if (mutation.response) return { ok: true as const, responseData: mutation.response }
            const totals = newDissolveTotals()
            const projectedStacks = new Map<number, number>()

            for (const { equipmentId, sellCount } of requestedSales) {
                const equipment = getPlayerEquipmentSync(playerId, equipmentId)
                if (!equipment) return { ok: false as const, message: "Player does not own equipment." }
                if (equipment.protection) return { ok: false as const, message: "Protected equipment cannot be sold." }

                const currentStack = projectedStacks.get(equipmentId) ?? equipment.stack
                const newStack = currentStack - sellCount
                if (newStack < 0) return { ok: false as const, message: "Attempt to sell more stacks than owned." }

                addDissolveRewards(totals, equipmentId, sellCount)
                projectedStacks.set(equipmentId, newStack)
            }

            for (const [equipmentId, newStack] of projectedStacks) {
                updatePlayerEquipmentSync(playerId, equipmentId, { stack: newStack })
            }
            const itemList = grantDissolveRewardsSync(playerId, totals)
            const responseData = { equipment_list: buildFullEquipmentList(playerId), item_list: itemList, mail_arrived: false }
            recordGameplayMutationResponseSync(playerId, mutation, responseData)
            const { soulTypes, soulDetail } = describeSouls(totals)
            gameVerboseLog(() => `[SELL_STACK] account=${accountId} player=${playerId}: ${toSellEquipmentList.length} equipment stack sold, craft +${totals.craftPoints} star +${totals.starGrains} ability souls: ${soulTypes} types [${soulDetail}]`)
            return { ok: true as const, responseData }
        })
        if (!outcome.ok) return reply.status(400).send({ "error": "Bad Request", "message": outcome.message })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": outcome.responseData
        })
    })

    // ── bulk_sell_stack (one-click dismantle) ──────────────────────────
    fastify.post("/bulk_sell_stack", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as BulkSellStackBody

        const viewerId = body.viewer_id
        const rawEquipmentIds = body.equipment_ids
        if (isNaN(viewerId) || !rawEquipmentIds || !Array.isArray(rawEquipmentIds) || rawEquipmentIds.length === 0) {
            return invalidBody(reply)
        }
        const requestedIds = parsePositiveSafeIntegerList(rawEquipmentIds)
        if (requestedIds === null) return invalidBody(reply)
        const equipmentIds = uniqueIds(requestedIds)

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." })

        const accountId = session.accountId as AccountId
        const playerId = resolvePlayerIdSync(accountId)! as PlayerId
        if (playerId === null) return reply.status(500).send({ "error": "Internal Server Error", "message": "No players bound to account." })

        // Calculate and apply rewards in one transaction so concurrent requests
        // observe each other's stack changes.
        const outcome = await runPersistenceTransaction({
            domain: "player", playerId, operation: "bulk_sell_equipment_stack",
        }, () => {
            const mutation = readGameplayMutationRequestSync(playerId, {
                headerToken: request.headers.login_token, body, accountId,
            }, "bulk_sell_equipment_stack", { equipment_ids: equipmentIds })
            if (!mutation) return { ok: false as const, message: "Invalid or conflicting request identity." }
            if (mutation.response) return { ok: true as const, responseData: mutation.response }
            const totals = newDissolveTotals()
            const toSell: number[] = []
            for (const equipmentId of equipmentIds) {
                const equipment = getPlayerEquipmentSync(playerId, equipmentId)
                if (!equipment) continue
                if (equipment.protection) throw Object.assign(new Error("Protected equipment cannot be sold."), { statusCode: 400 })

                const stack = equipment.stack
                if (stack <= 0) continue

                const rewards = addDissolveRewards(totals, equipmentId, stack)
                gameVerboseLog(() => `[BULK_SELL] account=${accountId} player=${playerId}  -> eid=${equipmentId} stack=${stack} rarity=${Math.floor(equipmentId/1000000)} craft=${rewards.craftPoints} star=${rewards.starGrains} souls=${JSON.stringify(rewards.abilitySouls)}`)
                toSell.push(equipmentId)
            }
            if (toSell.length === 0) {
                const responseData = { equipment_list: [], item_list: {}, mail_arrived: false }
                recordGameplayMutationResponseSync(playerId, mutation, responseData)
                return { ok: true as const, responseData }
            }

            for (const equipmentId of toSell) {
                updatePlayerEquipmentSync(playerId, equipmentId, { stack: 0 })
            }
            const itemList = grantDissolveRewardsSync(playerId, totals)
            const responseData = { equipment_list: buildFullEquipmentList(playerId), item_list: itemList, mail_arrived: false }
            recordGameplayMutationResponseSync(playerId, mutation, responseData)
            const craftLog = totals.craftPoints > 0 ? `craft +${totals.craftPoints} ` : ""
            const starLog = totals.starGrains > 0 ? `star +${totals.starGrains} ` : ""
            const { soulTypes, soulDetail } = describeSouls(totals)
            gameVerboseLog(() => `[BULK_SELL] account=${accountId} player=${playerId}: ${toSell.length} equipment dissolved (${toSell.join(',')}), ${craftLog}${starLog}ability souls: ${soulTypes} types [${soulDetail}]`)
            return { ok: true as const, responseData }
        })
        if (!outcome.ok) return reply.status(400).send({ "error": "Bad Request", "message": outcome.message })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": outcome.responseData
        })
    })
}

export default routes;
