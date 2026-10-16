import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MailType, insertReceiveHistorySync } from "../../data/domains/mail"
import { getPlayerGachaCampaignSync, getPlayerGachaInfoListSync, getPlayerGachaInfoSync, insertPlayerGachaCampaignSync, insertPlayerGachaInfoSync, updatePlayerGachaCampaignSync, updatePlayerGachaInfoSync } from "../../data/domains/gacha"
import { getPlayerItemSync, updatePlayerItemSync } from "../../data/domains/item"
import { getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getSession } from "../../data/domains/session"
import { generateDataHeaders, getServerTime } from "../../utils";
import {
    commitPlannedCharacterGachaMovies,
    drawGachaWithMetadataSync,
    planCharacterGachaMovies,
    rewardPlayerGachaDrawResultSync,
} from "../../lib/gacha";
import { getGachaCampaignIdSync, getGachaSync } from "../../lib/assets";
import { CharacterGacha, GachaType } from "../../lib/types";
import { serializeGachaCampaign } from "../../data/utils";
import { PlayerGachaCampaign, UserGachaCampaign } from "../../data/types";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { givePlayerCharacterSync } from "../../lib/character";
import { givePlayerEquipmentSync } from "../../lib/equipment";
import { buildGachaExecPlan } from "../../lib/gacha-exec-plan";
import { getExchangeableGachaItem } from "../../lib/gacha-rules";
import { getDb } from "../../data/db";
import { reconcileAwakeUnlockCharacterList, settleDegreeMissionResponse } from "../../lib/mission";
import {
    incrementActiveMissionGachaCampaignCountSync,
    incrementActiveMissionGachaCharacterCountSync,
} from "../../data/domains/active_mission_counters";
import { gameVerboseLog } from "../../lib/game-logging";
import { getPlayerOptionSync } from "../../data/domains/option";
import { measureSettlementPhase, measureSettlementPhaseAsync, recordGachaRequest } from "../../lib/settlement-performance";
import { runPersistenceTransaction } from "../../lib/persistence-coordinator";
import { createHash } from "node:crypto";
import { getPlayerOperationReceiptSync, insertPlayerOperationReceiptSync } from "../../data/domains/player-operation-receipt";

interface ExecBody {
    api_count: number,
    payment_type: number,
    number_of_exec: number,
    viewer_id: number,
    gacha_id: number,
    type: number
}

const MAX_GACHA_EXEC_COUNT = 10

function parseGachaTimestamp(value: string): number {
    // Master-data timestamps are expressed in China Standard Time without an offset.
    return Date.parse(`${value.replace(" ", "T")}+08:00`)
}

function isGachaAvailableAt(gacha: { startDate: string, endDate: string }, now: number): boolean {
    const start = parseGachaTimestamp(gacha.startDate)
    const end = parseGachaTimestamp(gacha.endDate)
    return Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end
}

interface ExchangeCharacterBody {
    character_id: number,
    api_count: number,
    gacha_id: number,
    viewer_id: number
    request_id?: string
}

interface ExchangeEquipmentBody {
    equipment_id: number,
    gacha_id: number,
    viewer_id: number,
    api_count: number,
    request_id?: string
}

enum GachaPaymentType {
    EMPTY,
    FREE_VMONEY,
    VMONEY,
    TICKET,
    CAMPAIGN
}

enum GachaExecType {
    EMPTY,
    VMONEY_SINGLE,
    VMONEY_MULTI,
    UNKNOWN_1,
    UNKNOWN_2,
    DAILY_SINGLE,
    UNKNOWN_3,
    CAMPAIGN_SINGLE,
    CAMPAIGN_MULTI,
    MULTI_TICKET,
    SINGLE_TICKET,
    UNKNOWN_4,
    SINGLE_WEAPON_TICKET,
    MULTI_WEAPON_TICKET
}

const exchangeRequiredPoints = 250

function buildExchangeRequestKey(
    operation: string,
    requestId: unknown,
    gachaId: number,
    rewardId: number,
): string | null {
    // api_count is only a legacy sequence value and may reset between client
    // sessions. It is deliberately not used as a durable idempotency key.
    if (typeof requestId !== "string" || requestId.length === 0 || requestId.length > 256) return null
    return createHash("sha256")
        .update(`${operation}\u0000${requestId}\u0000${gachaId}\u0000${rewardId}`)
        .digest("hex")
}

function sendExchangeResponse(
    reply: FastifyReply,
    viewerId: number,
    responseData: Record<string, any>,
) {
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({
        "data_headers": generateDataHeaders({ viewer_id: viewerId }),
        "data": responseData,
    })
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/exchange_equipment", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ExchangeEquipmentBody

        const equipmentId = body.equipment_id
        const gachaId = body.gacha_id
        const viewerId = body.viewer_id
        if (isNaN(viewerId) || isNaN(equipmentId) || isNaN(gachaId)) return reply.status(400).send({
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
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        const operation = "gacha_exchange_equipment"
        const requestKey = buildExchangeRequestKey(operation, body.request_id, gachaId, equipmentId)
        const previous = requestKey
            ? getPlayerOperationReceiptSync<Record<string, any>>(playerId, operation, requestKey)
            : null
        if (previous) return sendExchangeResponse(reply, viewerId, previous.response)

        const gachaData = getGachaSync(gachaId)
        if (gachaData === null || gachaData.type !== GachaType.WEAPON) return reply.status(400).send({
            "error": "Bad Request",
            "message": "No equipment exchange data for gacha with provided id."
        })
        if (getExchangeableGachaItem(gachaData, equipmentId) === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Equipment is not exchangeable from this gacha."
        })

        const settlement = await runPersistenceTransaction({
            domain: "gacha", playerId, operation,
        }, () => {
            const duplicate = requestKey
                ? getPlayerOperationReceiptSync<Record<string, any>>(playerId, operation, requestKey)
                : null
            if (duplicate) return { responseData: duplicate.response, errorMessage: undefined }

            const gachaInfo = getPlayerGachaInfoSync(playerId, gachaId)
            if (gachaInfo === null) return { responseData: null, errorMessage: "No data for gacha with provided id." }
            const newExchangePoints = (gachaInfo.gachaExchangePoint ?? 0) - exchangeRequiredPoints
            if (0 > newExchangePoints) return { responseData: null, errorMessage: "Not enough exchange points." }

            const giveResult = givePlayerEquipmentSync(playerId, equipmentId, 1)
            insertReceiveHistorySync(playerId, { type: MailType.EQUIPMENT, type_id: equipmentId, number: 1 })
            updatePlayerGachaInfoSync(playerId, { gachaId, gachaExchangePoint: newExchangePoints })

            const responseData: Record<string, any> = {
                "equipment_list": [giveResult],
                "gacha_info_list": [{
                    "gacha_id": gachaId,
                    "is_account_first": gachaInfo.isAccountFirst,
                    "is_daily_first": gachaInfo.isDailyFirst,
                    "gacha_exchange_point": newExchangePoints
                }],
                "encyclopedia_info": [],
                "mail_arrived": false
            }
            if (requestKey) insertPlayerOperationReceiptSync({
                playerId, operation, requestKey, response: responseData,
            })
            return { responseData, errorMessage: undefined }
        })
        if (!settlement.responseData) return reply.status(400).send({
            "error": "Bad Request",
            "message": settlement.errorMessage ?? "Exchange failed."
        })
        return sendExchangeResponse(reply, viewerId, settlement.responseData)

    })

    fastify.post("/exchange_character", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ExchangeCharacterBody

        const characterId = body.character_id
        const gachaId = body.gacha_id
        const viewerId = body.viewer_id
        if (isNaN(viewerId) || isNaN(characterId) || isNaN(gachaId)) return reply.status(400).send({
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
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        const operation = "gacha_exchange_character"
        const requestKey = buildExchangeRequestKey(operation, body.request_id, gachaId, characterId)
        const previous = requestKey
            ? getPlayerOperationReceiptSync<Record<string, any>>(playerId, operation, requestKey)
            : null
        if (previous) return sendExchangeResponse(reply, viewerId, previous.response)

        const gachaData = getGachaSync(gachaId)
        if (gachaData === null || gachaData.type !== GachaType.CHARACTER) return reply.status(400).send({
            "error": "Bad Request",
            "message": "No character exchange data for gacha with provided id."
        })
        if (getExchangeableGachaItem(gachaData, characterId) === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Character is not exchangeable from this gacha."
        })

        const settlement = await runPersistenceTransaction({
            domain: "gacha", playerId, operation,
        }, () => {
            const duplicate = requestKey
                ? getPlayerOperationReceiptSync<Record<string, any>>(playerId, operation, requestKey)
                : null
            if (duplicate) return { responseData: duplicate.response, errorMessage: undefined }

            const gachaInfo = getPlayerGachaInfoSync(playerId, gachaId)
            if (gachaInfo === null) return { responseData: null, errorMessage: "No data for gacha with provided id." }
            const newExchangePoints = (gachaInfo.gachaExchangePoint ?? 0) - exchangeRequiredPoints
            if (0 > newExchangePoints) return { responseData: null, errorMessage: "Not enough exchange points." }

            const giveResult = givePlayerCharacterSync(playerId, characterId)
            if (giveResult === null) return { responseData: null, errorMessage: "Could not give player character." }
            insertReceiveHistorySync(playerId, { type: MailType.CHARACTER, type_id: characterId, number: 1 })
            updatePlayerGachaInfoSync(playerId, { gachaId, gachaExchangePoint: newExchangePoints })

            const existingCharacterList: Record<string, unknown>[] = giveResult.character
                ? [giveResult.character as Record<string, unknown>]
                : []
            const characterList = existingCharacterList.length > 0
                ? reconcileAwakeUnlockCharacterList(playerId, existingCharacterList)
                : existingCharacterList

            const responseData: Record<string, any> = {
                "character_list": characterList,
                "item_list": giveResult.item !== undefined ? {
                    [giveResult.item.id]: giveResult.item.inventoryCount
                } : [],
                "gacha_info_list": [{
                    "gacha_id": gachaId,
                    "is_account_first": gachaInfo.isAccountFirst,
                    "is_daily_first": gachaInfo.isDailyFirst,
                    "gacha_exchange_point": newExchangePoints
                }],
                "encyclopedia_info": [],
                "mail_arrived": false
            }
            settleDegreeMissionResponse(playerId, viewerId, responseData, undefined, [4])
            if (requestKey) insertPlayerOperationReceiptSync({
                playerId, operation, requestKey, response: responseData,
            })
            return { responseData, errorMessage: undefined }
        })
        if (!settlement.responseData) return reply.status(400).send({
            "error": "Bad Request",
            "message": settlement.errorMessage ?? "Exchange failed."
        })
        return sendExchangeResponse(reply, viewerId, settlement.responseData)

    })

    fastify.post("/exec", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ExecBody

        const viewerId = body.viewer_id
        const gachaId = body.gacha_id
        const paymentType = body.payment_type
        const numberOfExec = body.number_of_exec
        const type = body.type
        if (!Number.isSafeInteger(viewerId)
            || !Number.isSafeInteger(gachaId)
            || !Number.isSafeInteger(paymentType)
            || !Number.isSafeInteger(type)
            || !Number.isSafeInteger(numberOfExec)
            || numberOfExec < 1
            || numberOfExec > MAX_GACHA_EXEC_COUNT) {
            gameVerboseLog(() => `[GACHA] invalid body: v=${viewerId} g=${gachaId} pt=${paymentType} n=${numberOfExec} t=${type}`);
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            })
        }

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = measureSettlementPhase("gacha", "account", () => resolvePlayerIdSync(viewerIdSession.accountId))!
        if (playerId === null) return reply.status(500).send({ "error": "Internal Server Error", "message": "No players bound to account." })
        // get the gacha
        const gachaData = getGachaSync(gachaId)
        if (gachaData === null) {
            gameVerboseLog(() => `[GACHA] gacha not found: gachaId=${gachaId}`);
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Gacha doesn't exist."
            })
        }
        if (gachaData.enforceAvailabilityWindow === true
            && !isGachaAvailableAt(gachaData, getServerTime() * 1000)) {
            gameVerboseLog(() => `[GACHA] gacha unavailable: gachaId=${gachaId}`);
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Gacha is not available."
            })
        }
        const isCharacterGacha = gachaData.type == GachaType.CHARACTER

        const previewPlayer = getPlayerSync(playerId)
        if (previewPlayer === null) return reply.status(500).send({ "error": "Internal Server Error", "message": "Player not found." })
        const previewGachaData = getPlayerGachaInfoSync(playerId, gachaId) ?? {
            gachaId,
            isAccountFirst: true,
            isDailyFirst: true,
            gachaExchangePoint: 0,
        }
        const previewPlan = buildGachaExecPlan({
            gacha: gachaData,
            paymentType,
            execType: type,
            numberOfExec,
            playerFunds: {
                freeVmoney: previewPlayer.freeVmoney,
                paidVmoney: previewPlayer.vmoney,
            },
            playerGachaData: previewGachaData,
            getTicketCount: itemId => getPlayerItemSync(playerId, itemId),
            getCampaignState: () => {
                const campaignId = getGachaCampaignIdSync(gachaId)
                if (campaignId === null) return null
                const campaign = getPlayerGachaCampaignSync(playerId, gachaId, campaignId)
                return {
                    campaignId,
                    count: campaign?.count ?? 1,
                    insert: campaign === null,
                }
            },
        })
        if (!previewPlan.ok) {
            gameVerboseLog(() =>
                `[GACHA] exec plan rejected: gachaId=${gachaId} paymentType=${paymentType} type=${type} message=${previewPlan.message}`
            )
            return reply.status(400).send({ "error": "Bad Request", "message": previewPlan.message })
        }
        const pullCount = previewPlan.plan.pullCount
        const drawMetadata = measureSettlementPhase(
            "gacha",
            "draw",
            () => drawGachaWithMetadataSync(gachaData, pullCount),
        )
        const drawResult = drawMetadata.map(draw => draw.id)
        let plannedMoviesToCommit: ReturnType<typeof planCharacterGachaMovies> | undefined

        const transactionResult = await measureSettlementPhaseAsync("gacha", "transaction", () => runPersistenceTransaction({
            domain: "gacha", playerId, operation: "draw",
        }, () => {
            const player = getPlayerSync(playerId)
            if (player === null) return { ok: false as const, message: "No player data." }
            const existingGachaData = getPlayerGachaInfoSync(playerId, gachaId)
            const playerGachaData = existingGachaData ?? {
                gachaId,
                isAccountFirst: true,
                isDailyFirst: true,
                gachaExchangePoint: 0,
            }
            let plannedCampaign: PlayerGachaCampaign | null = null
            const planResult = buildGachaExecPlan({
                gacha: gachaData,
                paymentType,
                execType: type,
                numberOfExec,
                playerFunds: {
                    freeVmoney: player.freeVmoney,
                    paidVmoney: player.vmoney,
                },
                playerGachaData,
                getTicketCount: itemId => getPlayerItemSync(playerId, itemId),
                getCampaignState: () => {
                    const campaignId = getGachaCampaignIdSync(gachaId)
                    if (campaignId === null) return null
                    const existingCampaign = getPlayerGachaCampaignSync(playerId, gachaId, campaignId)
                    plannedCampaign = existingCampaign ?? { gachaId, campaignId, count: 1 }
                    return {
                        campaignId,
                        count: plannedCampaign.count,
                        insert: existingCampaign === null,
                    }
                },
            })
            if (!planResult.ok) return { ok: false as const, message: planResult.message }
            const execPlan = planResult.plan
            if (execPlan.pullCount !== pullCount) {
                throw new Error("Gacha execution plan changed across the player queue boundary.")
            }
            const plannedCharacterMovies = isCharacterGacha
                ? measureSettlementPhase("gacha", "movies", () => planCharacterGachaMovies(
                    gachaData as CharacterGacha,
                    drawResult,
                    {
                        skipNoRarityUpMovie: getPlayerOptionSync(
                            playerId,
                            "gacha_play_no_rarity_up_movie",
                            false,
                        ),
                        flushPrevious: false,
                    },
                ))
                : undefined
            plannedMoviesToCommit = plannedCharacterMovies
            const items: Record<number, number> = {}
            const gachaCampaigns: UserGachaCampaign[] = []

            if (execPlan.ticket) {
                items[execPlan.ticket.itemId] = execPlan.ticket.afterCount
                updatePlayerItemSync(playerId, execPlan.ticket.itemId, execPlan.ticket.afterCount)
            }

            if (execPlan.campaign) {
                const campaignData = plannedCampaign ?? {
                    gachaId,
                    campaignId: execPlan.campaign.campaignId,
                    count: execPlan.campaign.count,
                }
                campaignData.count = execPlan.campaign.count

                if (execPlan.campaign.insert) {
                    insertPlayerGachaCampaignSync(playerId, campaignData)
                } else {
                    updatePlayerGachaCampaignSync(playerId, gachaId, execPlan.campaign.campaignId, execPlan.campaign.count)
                }

                gachaCampaigns.push(serializeGachaCampaign(campaignData))
            }

            const rewardResult = rewardPlayerGachaDrawResultSync(
                playerId,
                gachaData,
                drawResult,
                drawMetadata,
                plannedCharacterMovies,
                false,
            )

            // Log each drawn item in history
            const historyType = isCharacterGacha ? MailType.CHARACTER : MailType.EQUIPMENT
            for (const itemId of drawResult) {
                insertReceiveHistorySync(playerId, { type: historyType, type_id: itemId, number: 1 })
            }

            const newGachaExchangePoint = (playerGachaData.gachaExchangePoint ?? 0) + pullCount
            if (existingGachaData === null) {
                playerGachaData.isAccountFirst = false
                playerGachaData.isDailyFirst = false
                playerGachaData.gachaExchangePoint = newGachaExchangePoint
                insertPlayerGachaInfoSync(playerId, playerGachaData)
            } else {
                updatePlayerGachaInfoSync(playerId, {
                    gachaId: gachaId,
                    isDailyFirst: false,
                    isAccountFirst: false,
                    gachaExchangePoint: newGachaExchangePoint
                })
            }

            updatePlayerSync({
                id: playerId,
                vmoney: execPlan.paidVmoney,
                freeVmoney: execPlan.freeVmoney
            })
            if (isCharacterGacha) {
                incrementActiveMissionGachaCharacterCountSync(playerId, drawResult.length)
            }
            if (execPlan.campaign) {
                incrementActiveMissionGachaCampaignCountSync(playerId)
            }

            let responseData: Record<string, any>
            if (isCharacterGacha) {
                const existingCharacterList = rewardResult.characters.filter(
                    (character): character is Record<string, unknown> =>
                        character !== undefined
                        && character !== null
                        && typeof character === "object"
                        && !Array.isArray(character),
                )
                const characterList = existingCharacterList.length > 0
                    ? measureSettlementPhase(
                        "gacha",
                        "awake",
                        () => reconcileAwakeUnlockCharacterList(playerId, existingCharacterList),
                    )
                    : existingCharacterList
                responseData = {
                    "user_info": {
                        "free_vmoney": execPlan.freeVmoney,
                        "vmoney": execPlan.paidVmoney,
                    },
                    "draw": rewardResult.draw,
                    "character_list": characterList,
                    "item_list": { ...items, ...rewardResult.items },
                    "gacha_campaign_list": gachaCampaigns,
                    "gacha_info_list": [{
                        "gacha_id": gachaId,
                        "is_account_first": false,
                        "is_daily_first": false,
                        "gacha_exchange_point": newGachaExchangePoint,
                    }],
                    "encyclopedia_info": [],
                    "mail_arrived": false,
                }
                measureSettlementPhase(
                    "gacha",
                    "degree",
                    () => settleDegreeMissionResponse(playerId, viewerId, responseData, undefined, [4]),
                )
            } else {
                responseData = {
                    "user_info": {
                        "free_vmoney": execPlan.freeVmoney,
                        "vmoney": execPlan.paidVmoney,
                    },
                    "is_erupt": rewardResult.isErupt ?? false,
                    "draw_equipment": rewardResult.draw,
                    "item_list": { ...items, ...rewardResult.items },
                    "equipment_list": rewardResult.equipment,
                    "gacha_info_list": [{
                        "gacha_id": gachaId,
                        "is_account_first": false,
                        "is_daily_first": false,
                        "gacha_exchange_point": newGachaExchangePoint,
                    }],
                    "encyclopedia_info": [],
                    "mail_arrived": false,
                }
            }
            return {
                ok: true as const,
                responseData,
            }
        }, {
            afterCommit: result => {
                if (result.ok && plannedMoviesToCommit) {
                    commitPlannedCharacterGachaMovies(plannedMoviesToCommit)
                }
            },
        }))
        if (!transactionResult.ok) {
            gameVerboseLog(() =>
                `[GACHA] exec plan rejected: gachaId=${gachaId} paymentType=${paymentType} type=${type} message=${transactionResult.message}`
            )
            return reply.status(400).send({
                "error": "Bad Request",
                "message": transactionResult.message,
            })
        }
        recordGachaRequest(isCharacterGacha ? "character" : "equipment", pullCount)

        const rarityCounts = new Map<number, number>()
        for (const draw of drawMetadata) {
            rarityCounts.set(draw.rank, (rarityCounts.get(draw.rank) ?? 0) + 1)
        }
        const raritySummary = Array.from(rarityCounts.entries())
            .sort(([left], [right]) => left - right)
            .map(([rank, count]) => `${rank}:${count}`)
            .join(",")
        gameVerboseLog(() =>
            `[GACHA] gacha=${gachaId} type=${isCharacterGacha ? "character" : "equipment"} `
            + `pulls=${pullCount} rarity=${raritySummary}`
        )

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": transactionResult.responseData,
        })
        
    })
}

export default routes;
