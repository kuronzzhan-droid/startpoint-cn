// Handles EX boosts for characters.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { getAccountPlayers } from "../../data/domains/account"
import { getPlayerCharacterSync, playerOwnsCharacterSync, updatePlayerCharacterSync } from "../../data/domains/character"
import { getPlayerItemSync, updatePlayerItemSync } from "../../data/domains/item"
import { getPlayerSync } from "../../data/domains/player"
import { getSession } from "../../data/domains/session"
import { getCharacterDataSync, getExBoostItemSync, getExStatusPoolSync } from "../../lib/assets"
import { generateDataHeaders } from "../../utils"
import { randomInt, randomUUID } from "crypto"
import { clientSerializeDate } from "../../data/utils"
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { runPersistenceTransaction } from "../../lib/persistence-coordinator";
import { getCharacterMaxOverLimit } from "../../lib/character-overlimit"
import { ALL_ABILITIES, type AbilityInfo } from "../../lib/ex-boost-abilities"
import { completeExBoostDrawSync, reconcilePendingExBoostDrawSync, writePendingExBoostDrawSync, type PendingExBoostDraw } from "../../data/domains/ex-boost-pending"
import { readExBoostRequest, rememberExBoostRequest } from "../../lib/ex-boost-request"

interface ExBoostDrawBody {
    character_id: number,
    viewer_id: number,
    api_count: number,
    cost_item_id: number
}

interface ExBoostSelectBody {
    viewer_id: number,
    is_confirm: boolean,
    api_count: number
}

interface ExBoostDrawResult {
    characterId: number,
    statusId: number,
    abilityIdList: number[]
}

// 6 pools: A/B × gold(3)/silver(2)/brown(1)
function poolCopy(abilities: AbilityInfo[], group: 'A' | 'B', rarity: number): number[] {
    return abilities.filter(a => a.group === group && a.rarity === rarity).map(a => a.id)
}

// ---- Official material probability table (6 rarities × 3 colors) ----

interface MaterialProbs { a1: number, b1: number, a2: number, b2: number, a3: number, b3: number }

// 破星结晶 (universal): 10001(tier1) 10002(tier2) 10003(tier3)
// 崇高辉石 (element): 14001-14018, element order 0,1,2,3,5,4
const STONE_ELEMENT_ORDER = [0, 1, 2, 3, 5, 4]

const MATERIAL_PROBS: Record<number, MaterialProbs> = {}
{
    // Tier 1 (3★): 破星 [1.88,1.70,4.13,3.75,1.50,1.36]  崇高 [2.00,1.82,4.00,3.64,2.00,1.82]
    // Tier 2 (4★): 破星 [1.66,1.51,4.57,4.15,2.08,1.89]  崇高 [1.78,1.62,4.45,4.05,2.67,2.43]
    // Tier 3 (5★): 破星 [0,0,1.00,0.91,9.00,8.18]          崇高 [0,0,0,0,10.0,9.09]
    const probs: [number, number, number, number, number, number][][] = [
        [[1.88, 1.70, 4.13, 3.75, 1.50, 1.36], [2.00, 1.82, 4.00, 3.64, 2.00, 1.82]],
        [[1.66, 1.51, 4.57, 4.15, 2.08, 1.89], [1.78, 1.62, 4.45, 4.05, 2.67, 2.43]],
        [[0, 0, 1.00, 0.91, 9.00, 8.18],         [0, 0, 0, 0, 10.0, 9.09]],
    ]
    for (let tier = 1; tier <= 3; tier++) {
        const ti = tier - 1
        // 破星结晶
        const cp = probs[ti][0]
        MATERIAL_PROBS[10000 + tier] = { a1: cp[0], b1: cp[1], a2: cp[2], b2: cp[3], a3: cp[4], b3: cp[5] }
        const sp = probs[ti][1]
        for (let ei = 0; ei < STONE_ELEMENT_ORDER.length; ei++) {
            const id = 14001 + STONE_ELEMENT_ORDER[ei] * 3 + ti
            MATERIAL_PROBS[id] = { a1: sp[0], b1: sp[1], a2: sp[2], b2: sp[3], a3: sp[4], b3: sp[5] }
        }
    }
}

// ---- Draw pools (regenerated per draw to allow mutation) ----

function freshPools(): { A: Record<number, number[]>, B: Record<number, number[]> } {
    return {
        A: { 1: poolCopy(ALL_ABILITIES, 'A', 1), 2: poolCopy(ALL_ABILITIES, 'A', 2), 3: poolCopy(ALL_ABILITIES, 'A', 3) },
        B: { 1: poolCopy(ALL_ABILITIES, 'B', 1), 2: poolCopy(ALL_ABILITIES, 'B', 2), 3: poolCopy(ALL_ABILITIES, 'B', 3) },
    }
}


// ---- Draw logic ----

function drawOneAbility(groupPools: Record<number, number[]>, probs: MaterialProbs, group: 'A' | 'B'): number | null {
    const rates = group === 'A' ? [probs.a1, probs.a2, probs.a3] : [probs.b1, probs.b2, probs.b3]
    // Table values are rarity weights per material. Weighted random: pick rarity by proportion.
    const totalWeight = rates[0] + rates[1] + rates[2]
    if (totalWeight <= 0) return null
    const roll = randomInt(1, Math.round(totalWeight * 100) + 1) / 100 // [0.01, totalWeight+0.01]
    let cumulative = 0
    // Check from gold to brown
    for (let r = 3; r >= 1; r--) {
        cumulative += rates[r - 1]
        if (roll <= cumulative && groupPools[r].length > 0) {
            const idx = randomInt(groupPools[r].length)
            return groupPools[r].splice(idx, 1)[0]
        }
    }
    return null
}

function drawExBoostAbilities(
    materialId: number,
    exStatusPool: number[],
): { statusId: number, abilityIdList: number[] } {
    // Always get 1 status
    const statusId = exStatusPool[randomInt(exStatusPool.length)]

    const probs = MATERIAL_PROBS[materialId]
    if (!probs) return { statusId, abilityIdList: [] }

    const pools = freshPools()
    const abilityIdList: number[] = []

    // Independent A-group draw
    const aid = drawOneAbility(pools.A, probs, 'A')
    if (aid !== null) abilityIdList.push(aid)

    // Independent B-group draw
    const bid = drawOneAbility(pools.B, probs, 'B')
    if (bid !== null) abilityIdList.push(bid)

    return { statusId, abilityIdList }
}

// ---- Endpoint handler ----

const drawExpBoost = async (request: FastifyRequest, reply: FastifyReply, autoAccept: boolean) => {
    const body = request.body as ExBoostDrawBody

    const viewerId = body.viewer_id
    const characterId = body.character_id
    const costItemId = body.cost_item_id
    if ([viewerId, characterId, costItemId].some(value => !Number.isSafeInteger(value) || value <= 0)) return reply.status(400).send({
        "error": "Bad Request", "message": "Invalid request body."
    })

    const viewerIdSession = await getSession(viewerId.toString())
    if (!viewerIdSession) return reply.status(400).send({
        "error": "Bad Request", "message": "Invalid viewer id."
    })

    const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
    if (playerId === null) return reply.status(500).send({
        "error": "Internal Server Error", "message": "No players bound to account."
    })

    const characterAssetData = getCharacterDataSync(characterId)
    if (!characterAssetData) {
        if (getPlayerCharacterSync(playerId, characterId) === null) return reply.status(400).send({
            "error": "Bad Request", "message": "Player does not own character."
        })
        return reply.status(500).send({
            "error": "Internal Server Error", "message": "Character does not have data."
        })
    }

    const costItemData = getExBoostItemSync(costItemId)

    // Ownership, balance and over-limit checks run inside the player write
    // queue so that overlapping requests each see the balance left by the
    // previous one instead of all deducting from the same starting value.
    const outcome = await runPersistenceTransaction({
        domain: "player", playerId, operation: autoAccept ? "ex_boost_first_draw" : "ex_boost_draw",
    }, () => {
        const reject = (status: 400 | 500, message: string) => ({ ok: false as const, status, message })
        const receipt = readExBoostRequest(playerId, viewerIdSession.accountId, request.headers["login_token"], body,
            autoAccept ? "ex_boost_first_draw" : "ex_boost_draw", { characterId, costItemId })
        const characterData = getPlayerCharacterSync(playerId, characterId)
        if (characterData === null) return reject(400, "Player does not own character.")
        if (!costItemData) return reject(400, "Attempt to use invalid cost item.")
        if (costItemData.element !== undefined && costItemData.element !== characterAssetData.element) {
            return reject(400, "Attempt to use wrong item with different element from character.")
        }
        const pending = reconcilePendingExBoostDrawSync(playerId)
        const amount = getPlayerItemSync(playerId, costItemId) ?? 0
        if (receipt?.previous) {
            if (!autoAccept && pending?.drawId !== receipt.previous.draw.drawId) {
                return reject(400, "EX boost request belongs to an already resolved draw.")
            }
            if (autoAccept && !characterData.exBoost) return reject(400, "EX boost state has changed since this request.")
            const drawResult = autoAccept && characterData.exBoost
                ? { ...receipt.previous.draw, ...characterData.exBoost } : receipt.previous.draw
            return { ok: true as const, characterData, drawResult, afterCostItemAmount: amount }
        }
        if (pending && (autoAccept || pending.characterId !== characterId)) {
            return reject(400, "An EX boost selection must be resolved before starting another draw.")
        }
        if (autoAccept && characterData.exBoost) {
            const drawResult: PendingExBoostDraw = { drawId: randomUUID(), characterId, ...characterData.exBoost,
                costItemId, costItemCount: costItemData.count }
            rememberExBoostRequest(playerId, receipt, drawResult)
            return { ok: true as const, characterData, drawResult, afterCostItemAmount: amount }
        }
        if (!autoAccept && pending?.characterId === characterId) {
            if (pending.costItemId !== costItemId) return reject(400, "A different EX boost material is already pending.")
            rememberExBoostRequest(playerId, receipt, pending)
            return { ok: true as const, characterData, drawResult: pending, afterCostItemAmount: amount }
        }
        const afterCostItemAmount = amount - costItemData.count
        if (afterCostItemAmount < 0) return reject(400, "Not enough of item.")
        const maxOver = getCharacterMaxOverLimit(characterId, characterAssetData.rarity)
        if (maxOver === undefined || characterData.overLimitStep < maxOver) {
            return reject(400, "Character not at max over limit step.")
        }
        const exStatusPool = getExStatusPoolSync(costItemData.tier)
        if (exStatusPool === null || exStatusPool.length === 0) return reject(500, "Status pool not found.")
        const drawResult: PendingExBoostDraw = { drawId: randomUUID(), characterId,
            ...drawExBoostAbilities(costItemId, exStatusPool), costItemId, costItemCount: costItemData.count }
        updatePlayerItemSync(playerId, costItemId, afterCostItemAmount)
        if (autoAccept) {
            updatePlayerCharacterSync(playerId, characterId, {
                exBoost: { statusId: drawResult.statusId, abilityIdList: drawResult.abilityIdList },
            })
            completeExBoostDrawSync(playerId, drawResult, true)
        } else {
            writePendingExBoostDrawSync(playerId, drawResult)
        }
        rememberExBoostRequest(playerId, receipt, drawResult)
        return { ok: true as const, characterData, drawResult, afterCostItemAmount }
    })
    if (!outcome.ok) return reply.status(outcome.status).send({
        "error": outcome.status === 400 ? "Bad Request" : "Internal Server Error", "message": outcome.message
    })
    const { characterData, drawResult, afterCostItemAmount } = outcome

    const headers = generateDataHeaders({ viewer_id: viewerId })

    reply.header("content-type", "application/x-msgpack")
    if (autoAccept) {
        return reply.status(200).send({
            data_headers: headers,
            data: {
                character_list: [{
                    character_id: characterId, viewer_id: viewerId,
                    entry_count: characterData.entryCount,
                    evolution_level: characterData.evolutionLevel,
                    over_limit_step: characterData.overLimitStep,
                    protection: characterData.protection,
                    exp: characterData.exp,
                    stack: characterData.stack,
                    mana_board_index: characterData.manaBoardIndex,
                    bond_token_list: characterData.bondTokenList.map(bt => ({
                        mana_board_index: bt.manaBoardIndex, status: bt.status
                    })),
                    ex_boost: { status_id: drawResult.statusId, ability_id_list: drawResult.abilityIdList },
                    create_time: clientSerializeDate(characterData.joinTime),
                    update_time: clientSerializeDate(new Date()),
                    join_time: clientSerializeDate(characterData.joinTime),
                }],
                item_list: { [String(costItemId)]: afterCostItemAmount },
                mail_arrived: false,
            },
        })
    } else {
        return reply.status(200).send({
            data_headers: headers,
            data: {
                character_id: characterId,
                draw_result: { status_id: drawResult.statusId, ability_id_list: drawResult.abilityIdList },
                item_list: { [String(costItemId)]: afterCostItemAmount },
                mail_arrived: false,
            },
        })
    }
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/select", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ExBoostSelectBody
        const viewerId = body.viewer_id
        const isConfirm = body.is_confirm
        if (!Number.isSafeInteger(viewerId) || viewerId <= 0 || typeof isConfirm !== "boolean") return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })
        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error", "message": "No players bound to account."
        })
        const outcome = await runPersistenceTransaction({
            domain: "player", playerId, operation: "ex_boost_select",
        }, () => {
            const receipt = readExBoostRequest(playerId, viewerIdSession.accountId, request.headers["login_token"], body,
                "ex_boost_select", { isConfirm })
            const pending = reconcilePendingExBoostDrawSync(playerId)
            const drawResult = receipt?.previous?.draw ?? pending
            if (!drawResult) return null
            const characterData = getPlayerCharacterSync(playerId, drawResult.characterId)
            if (!characterData) throw new Error("EX boost character is no longer owned.")
            if (!receipt?.previous) {
                if (isConfirm) updatePlayerCharacterSync(playerId, drawResult.characterId, {
                    exBoost: { statusId: drawResult.statusId, abilityIdList: drawResult.abilityIdList },
                })
                completeExBoostDrawSync(playerId, drawResult, isConfirm)
                rememberExBoostRequest(playerId, receipt, drawResult, isConfirm)
            }
            // A delayed replay acknowledges current state without reapplying an old ability.
            const current = getPlayerCharacterSync(playerId, drawResult.characterId)!
            return { characterData: current, drawResult: current.exBoost
                ? { ...drawResult, ...current.exBoost } : drawResult }
        })
        if (!outcome) return reply.status(400).send({
            error: "Bad Request", message: "No draw result to select.",
        })
        reply.header("content-type", "application/x-msgpack")
        const headers = generateDataHeaders({ viewer_id: viewerId })
        if (!isConfirm) return reply.status(200).send({ data_headers: headers, data: { mail_arrived: false } })
        const { characterData, drawResult } = outcome
        const characterId = drawResult.characterId
        return reply.status(200).send({
            data_headers: headers,
            data: {
                character_list: [{
                    character_id: characterId, viewer_id: viewerId,
                    entry_count: characterData.entryCount,
                    evolution_level: characterData.evolutionLevel,
                    over_limit_step: characterData.overLimitStep,
                    protection: characterData.protection,
                    exp: characterData.exp, stack: characterData.stack,
                    mana_board_index: characterData.manaBoardIndex,
                    bond_token_list: characterData.bondTokenList.map(bt => ({
                        mana_board_index: bt.manaBoardIndex, status: bt.status
                    })),
                    ex_boost: { status_id: drawResult.statusId, ability_id_list: drawResult.abilityIdList },
                    create_time: clientSerializeDate(characterData.joinTime),
                    update_time: clientSerializeDate(new Date()),
                    join_time: clientSerializeDate(characterData.joinTime),
                }],
                mail_arrived: false,
            },
        })
    })

    fastify.post("/draw", async (request: FastifyRequest, reply: FastifyReply) => drawExpBoost(request, reply, false))
    fastify.post("/first_draw", async (request: FastifyRequest, reply: FastifyReply) => drawExpBoost(request, reply, true))
}

export default routes
