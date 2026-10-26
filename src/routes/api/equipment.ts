import { recordContentActionFactsSync } from "../../lib/mission/content-action-facts";
// Equipment awakening and protection endpoints: upgrade, bulk_upgrade, set_protection.
// Dismantle/sell endpoints are in sell.ts (same /equipment prefix).

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
    getPlayerEquipmentListSync, getPlayerEquipmentSync, playerOwnsEquipmentSync, updatePlayerEquipmentSync,
} from "../../data/domains/equipment";
import {
    getPlayerItemSync, givePlayerItemSync, updatePlayerItemSync,
} from "../../data/domains/item";
import { getPlayerSync } from "../../data/domains/player";
import { getSession } from "../../data/domains/session";
import { generateDataHeaders, getServerTime } from "../../utils";
import { clientSerializeEquipment, buildFullEquipmentList } from "../../lib/equipment";
import {
    getEquipmentDissolveSync, getConfigSync, getEquipmentCraftSync, getEquipmentAwakeningRulesSync,
} from "../../lib/assets";
import { getEquipmentRaritySync } from "../../lib/equipment-rarity";
import { checkAwakeningItem } from "../../lib/equipment-awakening-rules";
import { AccountId, PlayerId } from "../../lib/types";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { addMissionCounterSync, setMissionCounterMaxSync } from "../../lib/mission/counters";
import { getDegreeMissionIdsForConditionTypes, mergeMissionSettlementResponse, settleMissionCategories } from "../../lib/mission";
import { gameVerboseLog } from "../../lib/game-logging";
import { canUseAwakeningSubstitutionItem } from "../../multi/five-boss/rewards";
import { runPersistenceTransaction } from "../../lib/persistence-coordinator";
import { parsePositiveSafeInteger, parsePositiveSafeIntegerList, uniqueIds } from "../../lib/request-ids";
import { readGameplayMutationRequestSync, recordGameplayMutationResponseSync } from "../../lib/gameplay-mutation-receipt";

interface SetProtectionBody {
    protection: boolean
    equipment_ids: number[]
    viewer_id: number
    api_count: number
}

interface UpgradeBody {
    use_stack: boolean,
    upgrade_count: number,
    item_id?: number,
    viewer_id: number,
    api_count: number,
    equipment_id: number
}

interface BulkUpgradeBody {
    viewer_id: number
    api_count: number
    equipment_ids: number[]
}

const wrightpieceItemId = () => getConfigSync().craft_point_item_id || 100000

// wrightpiece cost for each rank of weapon (awakening) — from CDN
const getUpgradeCost = (rarity: number): number | null => {
    const cost = getEquipmentCraftSync(rarity)?.awakening_craft
    return cost !== undefined && Number.isSafeInteger(cost) && cost > 0 ? cost : null
}

function recordEquipmentAwakeningProgress(playerId: number, upgradeCount: number): void {
    recordContentActionFactsSync(playerId, { kind: "equipment_awaken", amount: upgradeCount })
    addMissionCounterSync(playerId, {
        dimension: "equipment.awakening",
        scopeType: "lifetime",
        scopeKey: "all",
        qualifier: {},
    }, upgradeCount)
    const levelFiveCount = Object.values(getPlayerEquipmentListSync(playerId))
        .filter(equipment => equipment.level >= 5)
        .length
    setMissionCounterMaxSync(playerId, {
        dimension: "equipment.lv5_count",
        scopeType: "lifetime",
        scopeKey: "all",
        qualifier: {},
    }, levelFiveCount)
}

function mergeEquipmentDegreeSettlement(
    responseData: Record<string, unknown>,
    playerId: number,
    viewerId: number,
): void {
    mergeMissionSettlementResponse(
        responseData,
        settleMissionCategories(playerId, [{
            category: 5,
            missionIds: getDegreeMissionIdsForConditionTypes([34, 36]),
        }], new Date(getServerTime() * 1000)),
        viewerId,
    )
}

const routes = async (fastify: FastifyInstance) => {
    // Parse once at registration so a malformed awakening asset stops startup.
    const awakeningRules = getEquipmentAwakeningRulesSync()

    // ── upgrade (single equipment awakening) ───────────────────────────
    fastify.post("/upgrade", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as UpgradeBody

        const viewerId = body.viewer_id
        const upgradeCount = body.upgrade_count === undefined || body.upgrade_count === null
            ? 1
            : parsePositiveSafeInteger(body.upgrade_count)
        const useStack = body.use_stack
        const itemId = body.item_id
        const equipmentId = parsePositiveSafeInteger(body.equipment_id)
        if (isNaN(viewerId) || equipmentId === null || upgradeCount === null || useStack === undefined) {
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid request body." })
        }

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." })

        const accountId = session.accountId as AccountId
        const playerId = resolvePlayerIdSync(accountId)! as PlayerId
        if (playerId === null) return reply.status(500).send({ "error": "Internal Server Error", "message": "No players bound to account." })

        // Equipment, wrightpiece and substitution item balances are read and
        // validated inside the player write queue so overlapping requests see
        // each other's deductions.
        const outcome = await runPersistenceTransaction({
            domain: "player", playerId, operation: "equipment_upgrade",
        }, () => {
            const mutation = readGameplayMutationRequestSync(playerId, {
                headerToken: request.headers.login_token, body, accountId,
            }, "equipment_upgrade", { equipment_id: equipmentId, use_stack: useStack, upgrade_count: upgradeCount, item_id: itemId })
            if (!mutation) return { ok: false as const, message: "Invalid or conflicting request identity." }
            if (mutation.response) return { ok: true as const, responseData: mutation.response }

            const equipmentRarity = getEquipmentRaritySync(equipmentId)
            const upgradeCost = equipmentRarity === null ? null : getUpgradeCost(equipmentRarity)
            if (upgradeCost === null) return { ok: false as const, message: "Equipment rarity or craft data is unavailable." }
            const maxLevel = getEquipmentDissolveSync(equipmentId)?.max_level ?? 5
            const equipment = getPlayerEquipmentSync(playerId, equipmentId)
            if (!equipment) return { ok: false as const, message: "Player does not own equipment." }
            if (!useStack && !canUseAwakeningSubstitutionItem(equipmentId)) {
                return { ok: false as const, message: "This equipment requires duplicate bodies for awakening." }
            }
            const itemCheck = checkAwakeningItem(awakeningRules, { equipmentId, useStack, itemId })
            if (!itemCheck.ok) return { ok: false as const, message: itemCheck.message }

            const previousLevel = equipment.level
            const previousStack = equipment.stack
            const newLevel = equipment.level + upgradeCount
            if (newLevel > maxLevel) return { ok: false as const, message: "Reached max awakening level." }

            const newStack = useStack ? equipment.stack - upgradeCount : equipment.stack
            if (newStack < 0) return { ok: false as const, message: "Not enough stack." }

            const wrightPieces = getPlayerItemSync(playerId, wrightpieceItemId()) ?? 0
            const newWrightPieces = wrightPieces - (upgradeCost * upgradeCount)
            if (newWrightPieces < 0) return { ok: false as const, message: "Not enough of wrightpieces." }

            const itemCount = itemId ? getPlayerItemSync(playerId, itemId) ?? 0 : 0
            const newItemCount = !useStack ? itemCount - upgradeCount : itemCount
            if (newItemCount < 0) return { ok: false as const, message: "Not enough of item." }

            const returnItemList: Record<string, number> = {}
            if (!useStack && itemId !== undefined) {
                returnItemList[itemId] = newItemCount
                updatePlayerItemSync(playerId, itemId, newItemCount)
            }

            returnItemList[wrightpieceItemId()] = newWrightPieces
            updatePlayerItemSync(playerId, wrightpieceItemId(), newWrightPieces)
            updatePlayerEquipmentSync(playerId, equipmentId, { stack: newStack, level: newLevel })
            recordEquipmentAwakeningProgress(playerId, upgradeCount)

            // give ability cores (CDN check: only if generate_ability_soul)
            const dissolveInfo = getEquipmentDissolveSync(equipmentId)
            if (dissolveInfo && dissolveInfo.generate_ability_soul) {
                returnItemList[dissolveInfo.ability_soul_id] = givePlayerItemSync(playerId, dissolveInfo.ability_soul_id, upgradeCount)
            }
            const responseData: Record<string, unknown> = {
                equipment_list: buildFullEquipmentList(playerId), item_list: returnItemList, mail_arrived: false,
            }
            mergeEquipmentDegreeSettlement(responseData, playerId, viewerId)
            recordGameplayMutationResponseSync(playerId, mutation, responseData)
            gameVerboseLog(() => `[UPGRADE] account=${accountId} player=${playerId}: eid=${equipmentId} rarity=${equipmentRarity} level ${previousLevel}->${newLevel} stack ${previousStack}->${newStack} craft -${upgradeCost*upgradeCount}`)
            return { ok: true as const, responseData }
        })
        if (!outcome.ok) return reply.status(400).send({ "error": "Bad Request", "message": outcome.message })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": outcome.responseData
        })
    })

    // ── bulk_upgrade (one-click awakening) ─────────────────────────────
    fastify.post("/bulk_upgrade", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as BulkUpgradeBody

        const viewerId = body.viewer_id
        const rawEquipmentIds = body.equipment_ids
        if (isNaN(viewerId) || !rawEquipmentIds || !Array.isArray(rawEquipmentIds) || rawEquipmentIds.length === 0) {
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid request body." })
        }
        const requestedIds = parsePositiveSafeIntegerList(rawEquipmentIds)
        if (requestedIds === null) {
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid request body." })
        }
        const equipmentIds = uniqueIds(requestedIds)

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." })

        const accountId = session.accountId as AccountId
        const playerId = resolvePlayerIdSync(accountId)! as PlayerId
        if (playerId === null) return reply.status(500).send({ "error": "Internal Server Error", "message": "No players bound to account." })

        // Plan, validate and apply inside the player write queue so the
        // wrightpiece balance cannot be spent twice by overlapping requests.
        const outcome = await runPersistenceTransaction({
            domain: "player", playerId, operation: "equipment_bulk_upgrade",
        }, () => {
            const mutation = readGameplayMutationRequestSync(playerId, {
                headerToken: request.headers.login_token, body, accountId,
            }, "equipment_bulk_upgrade", { equipment_ids: equipmentIds })
            if (!mutation) return { ok: false as const, message: "Invalid or conflicting request identity." }
            if (mutation.response) return { ok: true as const, responseData: mutation.response }
            if (!getPlayerSync(playerId)) throw new Error("Player not found.")
            const upgrades: Array<{ equipmentId: number; upgradeCount: number; level: number; stack: number }> = []
            let totalCraftPointCost = 0

            for (const equipmentId of equipmentIds) {
                const equipment = getPlayerEquipmentSync(playerId, equipmentId)
                if (!equipment) continue

                const rarity = getEquipmentRaritySync(equipmentId)
                const upgradeCost = rarity === null ? null : getUpgradeCost(rarity)
                if (upgradeCost === null) return { ok: false as const, message: "Equipment rarity or craft data is unavailable." }
                const maxLvl = getEquipmentDissolveSync(equipmentId)?.max_level ?? 5
                const upgradeCount = Math.min(maxLvl - equipment.level, equipment.stack)
                if (upgradeCount <= 0) continue

                totalCraftPointCost += upgradeCost * upgradeCount
                upgrades.push({ equipmentId, upgradeCount, level: equipment.level, stack: equipment.stack })
            }

            if (upgrades.length === 0) {
                const responseData = { equipment_list: [], item_list: {}, mail_arrived: false }
                recordGameplayMutationResponseSync(playerId, mutation, responseData)
                return { ok: true as const, responseData }
            }

            const currentCraftPoints = getPlayerItemSync(playerId, wrightpieceItemId()) ?? 0
            if (totalCraftPointCost > currentCraftPoints) return { ok: false as const, message: "Not enough craft points." }

            const returnItemList: Record<number, number> = {}
            const newCraftPoints = currentCraftPoints - totalCraftPointCost
            for (const { equipmentId, upgradeCount, level, stack } of upgrades) {
                updatePlayerEquipmentSync(playerId, equipmentId, { level: level + upgradeCount, stack: stack - upgradeCount })
                const dissolveInfo = getEquipmentDissolveSync(equipmentId)
                if (dissolveInfo && dissolveInfo.generate_ability_soul) {
                    returnItemList[dissolveInfo.ability_soul_id] = givePlayerItemSync(playerId, dissolveInfo.ability_soul_id, upgradeCount)
                }
            }
            recordEquipmentAwakeningProgress(
                playerId,
                upgrades.reduce((total, upgrade) => total + upgrade.upgradeCount, 0),
            )
            updatePlayerItemSync(playerId, wrightpieceItemId(), newCraftPoints)
            returnItemList[wrightpieceItemId()] = newCraftPoints
            const responseData: Record<string, unknown> = {
                equipment_list: buildFullEquipmentList(playerId), item_list: returnItemList, mail_arrived: false,
            }
            mergeEquipmentDegreeSettlement(responseData, playerId, viewerId)
            recordGameplayMutationResponseSync(playerId, mutation, responseData)
            gameVerboseLog(() => `[BULK_UPGRADE] account=${accountId} player=${playerId}: ${upgrades.length} equipment upgraded, craft points ${currentCraftPoints} -> ${newCraftPoints}`)
            return { ok: true as const, responseData }
        })
        if (!outcome.ok) return reply.status(400).send({ "error": "Bad Request", "message": outcome.message })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": outcome.responseData
        })
    })

    // ── set_protection (equipment lock) ────────────────────────────────
    fastify.post("/set_protection", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SetProtectionBody

        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) {
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid request body." })
        }

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." })

        const playerId = resolvePlayerIdSync(session.accountId)!
        const player = playerId !== null ? getPlayerSync(playerId) : null
        if (!player) return reply.status(500).send({ "error": "Internal Server Error", "message": "No players bound to account." })

        const newProtection = body.protection
        await runPersistenceTransaction({
            domain: "player", playerId, operation: "equipment_set_protection",
        }, () => {
            for (const equipmentId of body.equipment_ids) {
                if (playerOwnsEquipmentSync(playerId, equipmentId)) {
                    updatePlayerEquipmentSync(playerId, equipmentId, { protection: newProtection })
                }
            }
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {}
        })
    })
}

export default routes;
