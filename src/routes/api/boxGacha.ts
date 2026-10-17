import { getPlayerClientExpTime } from "../../lib/player-time-compat"
// Handles the insertion of mana into characters.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAccountPlayers } from "../../data/domains/account"
import { getPlayerBoxGachaDrawnRewardsSync, getPlayerBoxGachaSync, insertPlayerBoxGachaDrawnRewardSync, insertPlayerBoxGachaSync, resetPlayerBoxGachaSync, updatePlayerBoxGachaDrawnRewardSync, updatePlayerBoxGachaSync } from "../../data/domains/boxGacha"
import { getPlayerItemSync, updatePlayerItemSync } from "../../data/domains/item"
import { getPlayerSync } from "../../data/domains/player"
import { getSession } from "../../data/domains/session"
import { playerOwnsEquipmentSync, updatePlayerEquipmentSync } from "../../data/domains/equipment"
import { updatePlayerPartyGroupSync } from "../../data/domains/party"
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { generateDataHeaders, getServerTime } from "../../utils";
import { getBoxGachaSync } from "../../lib/assets";
import { drawBoxGachaSync, rewardPlayerBoxGachaResultSync } from "../../lib/gacha";
import { reconcileAwakeUnlockCharacterList } from "../../lib/mission";
import { BoxGachaBox, BoxGachaBoxes } from "../../lib/types";
import { PlayerBoxGacha, PlayerBoxGachaDrawnReward } from "../../data/types";
import { runPersistenceTransaction } from "../../lib/persistence-coordinator";
import { gameVerboseLog } from "../../lib/game-logging";
import { BOX_GACHA_1001_ID, getBoxGacha1001PeriodError, getBoxGacha1001Settings } from "../../lib/box-gacha-1001";

interface GetBoxListBody {
    box_gacha_id: number
    viewer_id: number
    api_count: number
}

interface ExecBody {
    stop_on_featured_rewards: boolean,
    box_gacha_id: number,
    box_id: number,
    api_count: number,
    viewer_id: number,
    number: number
}

interface CloseBody {
    box_gacha_id: number,
    box_id: number,
    viewer_id: number,
    api_count: number
}

interface ResetBody {
    box_gacha_id: number,
    box_id: number,
    viewer_id: number,
    api_count: number
}

function isPositiveSafeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

/**
 * Calculates the remaining stock from the current reward master and the
 * player's per-reward draw history. This remains correct when a patch expands
 * an existing box after the player has already emptied the previous version.
 */
function getCurrentRemainingNumber(
    rewards: BoxGachaBox,
    drawnRewards: PlayerBoxGachaDrawnReward[]
): number {
    if (drawnRewards.some(reward => !Number.isSafeInteger(reward.number) || reward.number < 0)) {
        throw new Error("Invalid box draw history.")
    }
    const drawnMap = new Map(drawnRewards.map(reward => [reward.id, reward.number]))
    return Object.entries(rewards).reduce((remaining, [rewardId, reward]) => {
        return remaining + Math.max(0, reward.available - (drawnMap.get(Number(rewardId)) ?? 0))
    }, 0)
}

/** Read eligibility after queueing, against the transaction's clock and facts. */
function get1001EligibilityError(playerId: number, boxId: number, boxes: BoxGachaBoxes): string | null {
    const settings = getBoxGacha1001Settings(boxId)
    if (settings === null) return "Missing box availability settings."
    const periodError = getBoxGacha1001PeriodError(boxId, getServerTime())
    if (periodError !== null) return periodError
    if (settings.requiredBoxId !== null) {
        const requiredId = settings.requiredBoxId
        const requiredRewards = boxes[requiredId]
        if (requiredRewards === undefined) return "Required box does not exist."
        const requiredBox = getPlayerBoxGachaSync(playerId, BOX_GACHA_1001_ID, requiredId)
        if (!requiredBox?.isClosed && getCurrentRemainingNumber(requiredRewards,
            getPlayerBoxGachaDrawnRewardsSync(playerId, BOX_GACHA_1001_ID, requiredId)) > 0) {
            return "Required box is not empty or closed."
        }
    }
    return null
}

/**
 * Legacy players can have remaining_number=0/is_closed=true for a box that was
 * empty before its master-data stock was increased. Reopen only the newly
 * added difference; boxes closed early retain a positive stored remainder and
 * are deliberately left closed.
 */
function reconcileExpandedEmptyBox(
    playerId: number,
    boxGachaId: number,
    boxId: number,
    rewards: BoxGachaBox,
    drawnRewards: PlayerBoxGachaDrawnReward[],
    playerBoxData: PlayerBoxGacha | null
): PlayerBoxGacha | null {
    if (playerBoxData === null || playerBoxData.remainingNumber !== 0) return playerBoxData

    const currentRemainingNumber = getCurrentRemainingNumber(rewards, drawnRewards)
    if (currentRemainingNumber <= 0) return playerBoxData

    updatePlayerBoxGachaSync(playerId, boxGachaId, {
        boxId,
        remainingNumber: currentRemainingNumber,
        isClosed: false
    })
    console.log(
        `[BOX] reopened expanded empty box: player=${playerId} gacha=${boxGachaId} box=${boxId} added=${currentRemainingNumber}`
    )
    return {
        ...playerBoxData,
        remainingNumber: currentRemainingNumber,
        isClosed: false
    }
}

/**
 * Returns all of a box gacha's box statuses serialized for the client.
 * 
 * @param playerId The ID of the player.
 * @param boxGachaId The ID of the box gacha.
 * @param boxes A record of boxes to get the data of.
 * @param skipBoxId The ID of the box id to skip.
 */
function getAllBoxList(
    playerId: number,
    boxGachaId: number,
    boxes: BoxGachaBoxes,
    skipBoxId?: number
): Object[] {
    const boxInfo: Object[] = []
    for (const [boxId, rewards] of Object.entries(boxes)) {
        // get drawn rewards
        const parsedBoxId = Number(boxId)
        if (parsedBoxId !== skipBoxId) {
            const playerDrawnRewards = getPlayerBoxGachaDrawnRewardsSync(playerId, boxGachaId, parsedBoxId)
            // Historical 1001 state is portable progress; listing must not reopen it.
            const storedBoxData = getPlayerBoxGachaSync(playerId, boxGachaId, parsedBoxId)
            const playerBoxData = boxGachaId === BOX_GACHA_1001_ID ? storedBoxData : reconcileExpandedEmptyBox(
                playerId,
                boxGachaId,
                parsedBoxId,
                rewards,
                playerDrawnRewards,
                storedBoxData
            )

            boxInfo.push({
                "box_id": parsedBoxId,
                "reset_times": playerBoxData?.resetTimes ?? 0,
                "all_drawn_reward_list": playerDrawnRewards.map(reward => {
                    return {
                        "reward_id": reward.id,
                        "number": reward.number
                    }
                }),
                "coming_next_reward_list": [],
                "is_closed": playerBoxData?.isClosed ?? false
            })
        }
    }
    return boxInfo
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/reset", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body ?? {}) as ResetBody

        const viewerId = body.viewer_id
        const boxGachaId = body.box_gacha_id
        const boxId = body.box_id
        gameVerboseLog(() => `[BOX] reset: boxGachaId=${boxGachaId} boxId=${boxId}`)

        if (!isPositiveSafeInteger(viewerId) || !isPositiveSafeInteger(boxGachaId) || !isPositiveSafeInteger(boxId)) return reply.status(400).send({
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

        const boxGachaData = getBoxGachaSync(boxGachaId)
        const boxRewards = boxGachaData?.boxes[boxId]
        if (boxGachaData === null || boxRewards === undefined) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid box gacha or box id."
        })

        const resetResult = await runPersistenceTransaction({
            domain: "gacha", playerId, operation: "box_reset",
        }, () => {
            if (boxGachaId === BOX_GACHA_1001_ID) {
                const settings = getBoxGacha1001Settings(boxId)
                return { allBoxInfo: null, errorMessage: settings?.resetKind === 0
                    ? "Box cannot be reset." : "Missing box reset settings." }
            }
            const playerDrawnRewards = getPlayerBoxGachaDrawnRewardsSync(playerId, boxGachaId, boxId)
            const playerBoxData = getPlayerBoxGachaSync(playerId, boxGachaId, boxId)
            if (playerBoxData === null) return { allBoxInfo: null, errorMessage: "Box doesn't exist." }
            if (getCurrentRemainingNumber(boxRewards, playerDrawnRewards) > 0) {
                return { allBoxInfo: null, errorMessage: "Box still has remaining rewards." }
            }
            const availableCount = getCurrentRemainingNumber(boxRewards, [])
            if (!isPositiveSafeInteger(availableCount)) return { allBoxInfo: null, errorMessage: "Box has no rewards." }
            if (!resetPlayerBoxGachaSync(playerId, boxGachaId, boxId, availableCount)) {
                return { allBoxInfo: null, errorMessage: "Failed to reset box." }
            }
            return { allBoxInfo: getAllBoxList(playerId, boxGachaId, boxGachaData.boxes) }
        })
        if (resetResult.allBoxInfo === null) return reply.status(
            resetResult.errorMessage === "Failed to reset box." ? 500 : 400
        ).send({
            "error": resetResult.errorMessage === "Failed to reset box." ? "Internal Server Error" : "Bad Request",
            "message": resetResult.errorMessage,
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "all_box_info": resetResult.allBoxInfo
            }
        })
    })

    fastify.post("/close", async (request: FastifyRequest, reply: FastifyReply) => {

        const body = (request.body ?? {}) as CloseBody

        const viewerId = body.viewer_id
        const boxGachaId = body.box_gacha_id
        const boxId = body.box_id
        if (!isPositiveSafeInteger(viewerId) || !isPositiveSafeInteger(boxGachaId) || !isPositiveSafeInteger(boxId)) return reply.status(400).send({
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

        // get box asset data.
        const boxGachaData = getBoxGachaSync(boxGachaId)
        const boxRewards = boxGachaData?.boxes[boxId]
        if (boxGachaData === null || boxRewards === undefined) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid box gacha id."
        })

        const closeResult = await runPersistenceTransaction({
            domain: "gacha", playerId, operation: "box_close",
        }, () => {
            const playerBoxData = getPlayerBoxGachaSync(playerId, boxGachaId, boxId)
            if (playerBoxData === null) return { allBoxInfo: null, errorMessage: "Box doesn't exist" }
            if (boxGachaId === BOX_GACHA_1001_ID) {
                // An existing terminal state is returned without rewriting old progress.
                if (playerBoxData.isClosed) return { allBoxInfo: getAllBoxList(playerId, boxGachaId, boxGachaData.boxes) }
                const eligibilityError = get1001EligibilityError(playerId, boxId, boxGachaData.boxes)
                if (eligibilityError !== null) return { allBoxInfo: null, errorMessage: eligibilityError }
            }
            const remainingNumber = getCurrentRemainingNumber(
                boxRewards, getPlayerBoxGachaDrawnRewardsSync(playerId, boxGachaId, boxId),
            )
            if (boxGachaId === BOX_GACHA_1001_ID && remainingNumber > 0) {
                return { allBoxInfo: null, errorMessage: "Box still has remaining rewards." }
            }
            if (!playerBoxData.isClosed || playerBoxData.remainingNumber !== remainingNumber) {
                updatePlayerBoxGachaSync(playerId, boxGachaId, { boxId, isClosed: true, remainingNumber })
            }
            return { allBoxInfo: getAllBoxList(playerId, boxGachaId, boxGachaData.boxes) }
        })
        if (closeResult.allBoxInfo === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": closeResult.errorMessage,
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "all_box_info": closeResult.allBoxInfo
            }
        })
    })

    fastify.post("/exec", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body ?? {}) as ExecBody

        const viewerId = body.viewer_id
        const boxGachaId = body.box_gacha_id
        const boxId = body.box_id
        const pullCount = body.number
        const stopOnFeaturedRewards = body.stop_on_featured_rewards
        gameVerboseLog(() => `[BOX] exec: boxGachaId=${boxGachaId} boxId=${boxId} pullCount=${pullCount}`)
        if (!isPositiveSafeInteger(viewerId) || !isPositiveSafeInteger(boxGachaId) || !isPositiveSafeInteger(boxId) || !isPositiveSafeInteger(pullCount) || typeof stopOnFeaturedRewards !== "boolean") return reply.status(400).send({
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

        // get box gacha data
        const boxGachaData = getBoxGachaSync(boxGachaId)
        if (boxGachaData === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid box gacha id."
        })

        const pullCurrencyId = boxGachaData.redeemItemId
        const boxRewards = boxGachaData.boxes[boxId]
        if (boxRewards === undefined) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid box ID."
        })

        const settlement = await runPersistenceTransaction({
            domain: "gacha", playerId, operation: "box_exec",
        }, () => {
            if (boxGachaId === BOX_GACHA_1001_ID) {
                const eligibilityError = get1001EligibilityError(playerId, boxId, boxGachaData.boxes)
                if (eligibilityError !== null) return { errorMessage: eligibilityError }
            }
            const currentDrawnRewards = getPlayerBoxGachaDrawnRewardsSync(playerId, boxGachaId, boxId)
            const currentBoxData = getPlayerBoxGachaSync(playerId, boxGachaId, boxId)
            const remainingNumber = getCurrentRemainingNumber(boxRewards, currentDrawnRewards)
            const expandedEmptyBox = boxGachaId !== BOX_GACHA_1001_ID
                && currentBoxData?.remainingNumber === 0 && remainingNumber > 0
            if (currentBoxData?.isClosed && !expandedEmptyBox) return { errorMessage: "Box is closed." }
            if (pullCount > remainingNumber) return { errorMessage: "Not enough remaining rewards." }
            const currentCurrency = getPlayerItemSync(playerId, pullCurrencyId)
            if (currentCurrency === null) return { errorMessage: "No pull currency." }
            const maximumPullCost = pullCount * boxGachaData.redeemItemCount
            if (!isPositiveSafeInteger(maximumPullCost)) return { errorMessage: "Invalid pull cost." }
            if (currentCurrency < maximumPullCost) return { errorMessage: "Not enough pull currency." }

            const drawResult = drawBoxGachaSync(boxRewards, currentDrawnRewards, pullCount, stopOnFeaturedRewards)
            const actualPullCost = drawResult.drawCount * boxGachaData.redeemItemCount
            const newPullCurrency = currentCurrency - actualPullCost
            if (!isPositiveSafeInteger(drawResult.drawCount) || drawResult.drawCount > pullCount
                || !isPositiveSafeInteger(actualPullCost) || newPullCurrency < 0) {
                return { errorMessage: "Invalid draw result." }
            }
            gameVerboseLog(() =>
                `[BOX] exec result: boxGachaId=${boxGachaId} boxId=${boxId} requested=${pullCount} actual=${drawResult.drawCount} cost=${actualPullCost} stopOnFeatured=${stopOnFeaturedRewards}`
            )

            // Charge first so a reward in the same currency is added to the final balance.
            updatePlayerItemSync(playerId, pullCurrencyId, newPullCurrency)
            const rewardResult = rewardPlayerBoxGachaResultSync(playerId, drawResult)
            const playerDrawnRewardMap = new Map(currentDrawnRewards.map(reward => [reward.id, reward.number]))
            const remainingDrawsNumber = remainingNumber - drawResult.drawCount
            const shouldClose = remainingDrawsNumber === 0
            if (currentBoxData === null) {
                insertPlayerBoxGachaSync(playerId, boxGachaId, {
                    boxId, isClosed: shouldClose, remainingNumber: remainingDrawsNumber, resetTimes: 0,
                })
            } else {
                updatePlayerBoxGachaSync(playerId, boxGachaId, {
                    boxId, isClosed: shouldClose, remainingNumber: remainingDrawsNumber,
                })
            }
            for (const drawnReward of drawResult.rewards) {
                const existing = playerDrawnRewardMap.get(drawnReward.id)
                if (existing === undefined) {
                    insertPlayerBoxGachaDrawnRewardSync(playerId, boxGachaId, boxId, {
                        id: drawnReward.id, number: drawnReward.number,
                    })
                } else {
                    updatePlayerBoxGachaDrawnRewardSync(
                        playerId, boxGachaId, boxId, drawnReward.id, existing + drawnReward.number,
                    )
                }
            }
            const existingCharacterList = (rewardResult?.character_list ?? []) as Record<string, unknown>[]
            const characterList = reconcileAwakeUnlockCharacterList(playerId, existingCharacterList)
            const responsePlayer = getPlayerSync(playerId)
            if (responsePlayer === null) throw new Error("Player disappeared during box settlement.")
            return {
                drawResult, rewardResult, currentDrawnRewards,
                playerBoxData: {
                    boxId, resetTimes: currentBoxData?.resetTimes ?? 0,
                    remainingNumber: remainingDrawsNumber, isClosed: shouldClose,
                },
                allBoxInfo: getAllBoxList(playerId, boxGachaId, boxGachaData.boxes, boxId),
                characterList,
                finalPullCurrency: getPlayerItemSync(playerId, pullCurrencyId)!,
                userInfo: {
                    free_mana: responsePlayer.freeMana,
                    exp_pool: responsePlayer.expPool,
                    exp_pooled_time: getPlayerClientExpTime(responsePlayer),
                },
            }
        })
        if ("errorMessage" in settlement) return reply.status(400).send({
            "error": "Bad Request", "message": settlement.errorMessage,
        })
        const { drawResult, rewardResult, currentDrawnRewards, allBoxInfo, characterList } = settlement
        const drawnRewards = drawResult.rewards
        const allDrawResultMap: Map<number, number> = new Map()
        for (const drawnReward of drawnRewards) {
            allDrawResultMap.set(drawnReward.id, drawnReward.number)
        }
        for (const playerDrawnReward of currentDrawnRewards) {
            allDrawResultMap.set(playerDrawnReward.id, (allDrawResultMap.get(playerDrawnReward.id) ?? 0) + playerDrawnReward.number)
        }
        const responsePlayerBoxData = settlement.playerBoxData

        // add current box to allBoxInfo
        {
            // build all drawn reward list
            const allDrawnRewardList: Object[] = []
            for (const [rewardId, number] of allDrawResultMap) {
                allDrawnRewardList.push({
                    "reward_id": rewardId,
                    "number": number
                })
            }

            allBoxInfo.push({
                "box_id": boxId,
                "reset_times": responsePlayerBoxData?.resetTimes ?? 0,
                "all_drawn_reward_list": allDrawnRewardList,
                "coming_next_reward_list": [],
                "is_closed": responsePlayerBoxData.isClosed
            })
        }

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "user_info": settlement.userInfo,
                "drawn_reward_list": drawnRewards.map(reward => {
                    return {
                        "reward_id": reward.id,
                        "number": reward.number
                    }
                }),
                "all_box_info": allBoxInfo,
                "joined_character_id_list": rewardResult?.joined_character_id_list ?? [],
                "character_list": characterList,
                "equipment_list": rewardResult?.equipment_list ?? [],
                "item_list": {
                    ...(rewardResult?.items ?? {}),
                    [pullCurrencyId]: settlement.finalPullCurrency,
                },
                "mail_arrived": false
            }
        })
    })

    fastify.post("/get_box_list", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body ?? {}) as GetBoxListBody

        const viewerId = body.viewer_id
        const boxGachaId = body.box_gacha_id
        gameVerboseLog(() => `[BOX] get_box_list: boxGachaId=${boxGachaId}`)
        if (!isPositiveSafeInteger(viewerId) || !isPositiveSafeInteger(boxGachaId)) return reply.status(400).send({
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

        // get box gacha data
        const boxGachaData = getBoxGachaSync(boxGachaId)
        if (boxGachaData === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid box gacha id."
        })

        const allBoxInfo = await runPersistenceTransaction({
            domain: "gacha", playerId, operation: "box_list",
        }, () => getAllBoxList(playerId, boxGachaId, boxGachaData.boxes))
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "all_box_info": allBoxInfo
            }
        })
    })
}

export default routes;
