"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const player_time_compat_1 = require("../../lib/player-time-compat");
const boxGacha_1 = require("../../data/domains/boxGacha");
const item_1 = require("../../data/domains/item");
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const activeAccount_1 = require("../../data/activeAccount");
const utils_1 = require("../../utils");
const assets_1 = require("../../lib/assets");
const gacha_1 = require("../../lib/gacha");
const mission_1 = require("../../lib/mission");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const game_logging_1 = require("../../lib/game-logging");
const box_gacha_1001_1 = require("../../lib/box-gacha-1001");
function isPositiveSafeInteger(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
/**
 * Calculates the remaining stock from the current reward master and the
 * player's per-reward draw history. This remains correct when a patch expands
 * an existing box after the player has already emptied the previous version.
 */
function getCurrentRemainingNumber(rewards, drawnRewards) {
    if (drawnRewards.some(reward => !Number.isSafeInteger(reward.number) || reward.number < 0)) {
        throw new Error("Invalid box draw history.");
    }
    const drawnMap = new Map(drawnRewards.map(reward => [reward.id, reward.number]));
    return Object.entries(rewards).reduce((remaining, [rewardId, reward]) => {
        var _a;
        return remaining + Math.max(0, reward.available - ((_a = drawnMap.get(Number(rewardId))) !== null && _a !== void 0 ? _a : 0));
    }, 0);
}
/** Read eligibility after queueing, against the transaction's clock and facts. */
function get1001EligibilityError(playerId, boxId, boxes) {
    const settings = (0, box_gacha_1001_1.getBoxGacha1001Settings)(boxId);
    if (settings === null)
        return "Missing box availability settings.";
    const periodError = (0, box_gacha_1001_1.getBoxGacha1001PeriodError)(boxId, (0, utils_1.getServerTime)());
    if (periodError !== null)
        return periodError;
    if (settings.requiredBoxId !== null) {
        const requiredId = settings.requiredBoxId;
        const requiredRewards = boxes[requiredId];
        if (requiredRewards === undefined)
            return "Required box does not exist.";
        const requiredBox = (0, boxGacha_1.getPlayerBoxGachaSync)(playerId, box_gacha_1001_1.BOX_GACHA_1001_ID, requiredId);
        if (!(requiredBox === null || requiredBox === void 0 ? void 0 : requiredBox.isClosed) && getCurrentRemainingNumber(requiredRewards, (0, boxGacha_1.getPlayerBoxGachaDrawnRewardsSync)(playerId, box_gacha_1001_1.BOX_GACHA_1001_ID, requiredId)) > 0) {
            return "Required box is not empty or closed.";
        }
    }
    return null;
}
/**
 * Legacy players can have remaining_number=0/is_closed=true for a box that was
 * empty before its master-data stock was increased. Reopen only the newly
 * added difference; boxes closed early retain a positive stored remainder and
 * are deliberately left closed.
 */
function reconcileExpandedEmptyBox(playerId, boxGachaId, boxId, rewards, drawnRewards, playerBoxData) {
    if (playerBoxData === null || playerBoxData.remainingNumber !== 0)
        return playerBoxData;
    const currentRemainingNumber = getCurrentRemainingNumber(rewards, drawnRewards);
    if (currentRemainingNumber <= 0)
        return playerBoxData;
    (0, boxGacha_1.updatePlayerBoxGachaSync)(playerId, boxGachaId, {
        boxId,
        remainingNumber: currentRemainingNumber,
        isClosed: false
    });
    console.log(`[BOX] reopened expanded empty box: player=${playerId} gacha=${boxGachaId} box=${boxId} added=${currentRemainingNumber}`);
    return Object.assign(Object.assign({}, playerBoxData), { remainingNumber: currentRemainingNumber, isClosed: false });
}
/**
 * Returns all of a box gacha's box statuses serialized for the client.
 *
 * @param playerId The ID of the player.
 * @param boxGachaId The ID of the box gacha.
 * @param boxes A record of boxes to get the data of.
 * @param skipBoxId The ID of the box id to skip.
 */
function getAllBoxList(playerId, boxGachaId, boxes, skipBoxId) {
    var _a, _b;
    const boxInfo = [];
    for (const [boxId, rewards] of Object.entries(boxes)) {
        // get drawn rewards
        const parsedBoxId = Number(boxId);
        if (parsedBoxId !== skipBoxId) {
            const playerDrawnRewards = (0, boxGacha_1.getPlayerBoxGachaDrawnRewardsSync)(playerId, boxGachaId, parsedBoxId);
            // Historical 1001 state is portable progress; listing must not reopen it.
            const storedBoxData = (0, boxGacha_1.getPlayerBoxGachaSync)(playerId, boxGachaId, parsedBoxId);
            const playerBoxData = boxGachaId === box_gacha_1001_1.BOX_GACHA_1001_ID ? storedBoxData : reconcileExpandedEmptyBox(playerId, boxGachaId, parsedBoxId, rewards, playerDrawnRewards, storedBoxData);
            boxInfo.push({
                "box_id": parsedBoxId,
                "reset_times": (_a = playerBoxData === null || playerBoxData === void 0 ? void 0 : playerBoxData.resetTimes) !== null && _a !== void 0 ? _a : 0,
                "all_drawn_reward_list": playerDrawnRewards.map(reward => {
                    return {
                        "reward_id": reward.id,
                        "number": reward.number
                    };
                }),
                "coming_next_reward_list": [],
                "is_closed": (_b = playerBoxData === null || playerBoxData === void 0 ? void 0 : playerBoxData.isClosed) !== null && _b !== void 0 ? _b : false
            });
        }
    }
    return boxInfo;
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/reset", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const body = ((_a = request.body) !== null && _a !== void 0 ? _a : {});
        const viewerId = body.viewer_id;
        const boxGachaId = body.box_gacha_id;
        const boxId = body.box_id;
        (0, game_logging_1.gameVerboseLog)(() => `[BOX] reset: boxGachaId=${boxGachaId} boxId=${boxId}`);
        if (!isPositiveSafeInteger(viewerId) || !isPositiveSafeInteger(boxGachaId) || !isPositiveSafeInteger(boxId))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No players bound to account."
            });
        const boxGachaData = (0, assets_1.getBoxGachaSync)(boxGachaId);
        const boxRewards = boxGachaData === null || boxGachaData === void 0 ? void 0 : boxGachaData.boxes[boxId];
        if (boxGachaData === null || boxRewards === undefined)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid box gacha or box id."
            });
        const resetResult = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "gacha", playerId, operation: "box_reset",
        }, () => {
            if (boxGachaId === box_gacha_1001_1.BOX_GACHA_1001_ID) {
                const settings = (0, box_gacha_1001_1.getBoxGacha1001Settings)(boxId);
                return { allBoxInfo: null, errorMessage: (settings === null || settings === void 0 ? void 0 : settings.resetKind) === 0
                        ? "Box cannot be reset." : "Missing box reset settings." };
            }
            const playerDrawnRewards = (0, boxGacha_1.getPlayerBoxGachaDrawnRewardsSync)(playerId, boxGachaId, boxId);
            const playerBoxData = (0, boxGacha_1.getPlayerBoxGachaSync)(playerId, boxGachaId, boxId);
            if (playerBoxData === null)
                return { allBoxInfo: null, errorMessage: "Box doesn't exist." };
            if (getCurrentRemainingNumber(boxRewards, playerDrawnRewards) > 0) {
                return { allBoxInfo: null, errorMessage: "Box still has remaining rewards." };
            }
            const availableCount = getCurrentRemainingNumber(boxRewards, []);
            if (!isPositiveSafeInteger(availableCount))
                return { allBoxInfo: null, errorMessage: "Box has no rewards." };
            if (!(0, boxGacha_1.resetPlayerBoxGachaSync)(playerId, boxGachaId, boxId, availableCount)) {
                return { allBoxInfo: null, errorMessage: "Failed to reset box." };
            }
            return { allBoxInfo: getAllBoxList(playerId, boxGachaId, boxGachaData.boxes) };
        });
        if (resetResult.allBoxInfo === null)
            return reply.status(resetResult.errorMessage === "Failed to reset box." ? 500 : 400).send({
                "error": resetResult.errorMessage === "Failed to reset box." ? "Internal Server Error" : "Bad Request",
                "message": resetResult.errorMessage,
            });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {
                "all_box_info": resetResult.allBoxInfo
            }
        });
    }));
    fastify.post("/close", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _b;
        const body = ((_b = request.body) !== null && _b !== void 0 ? _b : {});
        const viewerId = body.viewer_id;
        const boxGachaId = body.box_gacha_id;
        const boxId = body.box_id;
        if (!isPositiveSafeInteger(viewerId) || !isPositiveSafeInteger(boxGachaId) || !isPositiveSafeInteger(boxId))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        // get player
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No players bound to account."
            });
        // get box asset data.
        const boxGachaData = (0, assets_1.getBoxGachaSync)(boxGachaId);
        const boxRewards = boxGachaData === null || boxGachaData === void 0 ? void 0 : boxGachaData.boxes[boxId];
        if (boxGachaData === null || boxRewards === undefined)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid box gacha id."
            });
        const closeResult = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "gacha", playerId, operation: "box_close",
        }, () => {
            const playerBoxData = (0, boxGacha_1.getPlayerBoxGachaSync)(playerId, boxGachaId, boxId);
            if (playerBoxData === null)
                return { allBoxInfo: null, errorMessage: "Box doesn't exist" };
            if (boxGachaId === box_gacha_1001_1.BOX_GACHA_1001_ID) {
                // An existing terminal state is returned without rewriting old progress.
                if (playerBoxData.isClosed)
                    return { allBoxInfo: getAllBoxList(playerId, boxGachaId, boxGachaData.boxes) };
                const eligibilityError = get1001EligibilityError(playerId, boxId, boxGachaData.boxes);
                if (eligibilityError !== null)
                    return { allBoxInfo: null, errorMessage: eligibilityError };
            }
            const remainingNumber = getCurrentRemainingNumber(boxRewards, (0, boxGacha_1.getPlayerBoxGachaDrawnRewardsSync)(playerId, boxGachaId, boxId));
            if (boxGachaId === box_gacha_1001_1.BOX_GACHA_1001_ID && remainingNumber > 0) {
                return { allBoxInfo: null, errorMessage: "Box still has remaining rewards." };
            }
            if (!playerBoxData.isClosed || playerBoxData.remainingNumber !== remainingNumber) {
                (0, boxGacha_1.updatePlayerBoxGachaSync)(playerId, boxGachaId, { boxId, isClosed: true, remainingNumber });
            }
            return { allBoxInfo: getAllBoxList(playerId, boxGachaId, boxGachaData.boxes) };
        });
        if (closeResult.allBoxInfo === null)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": closeResult.errorMessage,
            });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {
                "all_box_info": closeResult.allBoxInfo
            }
        });
    }));
    fastify.post("/exec", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _c, _d, _e, _f, _g, _h;
        const body = ((_c = request.body) !== null && _c !== void 0 ? _c : {});
        const viewerId = body.viewer_id;
        const boxGachaId = body.box_gacha_id;
        const boxId = body.box_id;
        const pullCount = body.number;
        const stopOnFeaturedRewards = body.stop_on_featured_rewards;
        (0, game_logging_1.gameVerboseLog)(() => `[BOX] exec: boxGachaId=${boxGachaId} boxId=${boxId} pullCount=${pullCount}`);
        if (!isPositiveSafeInteger(viewerId) || !isPositiveSafeInteger(boxGachaId) || !isPositiveSafeInteger(boxId) || !isPositiveSafeInteger(pullCount) || typeof stopOnFeaturedRewards !== "boolean")
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        // get player
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        const player = playerId !== null ? (0, player_1.getPlayerSync)(playerId) : null;
        if (player === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No players bound to account."
            });
        // get box gacha data
        const boxGachaData = (0, assets_1.getBoxGachaSync)(boxGachaId);
        if (boxGachaData === null)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid box gacha id."
            });
        const pullCurrencyId = boxGachaData.redeemItemId;
        const boxRewards = boxGachaData.boxes[boxId];
        if (boxRewards === undefined)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid box ID."
            });
        const settlement = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "gacha", playerId, operation: "box_exec",
        }, () => {
            var _a, _b;
            if (boxGachaId === box_gacha_1001_1.BOX_GACHA_1001_ID) {
                const eligibilityError = get1001EligibilityError(playerId, boxId, boxGachaData.boxes);
                if (eligibilityError !== null)
                    return { errorMessage: eligibilityError };
            }
            const currentDrawnRewards = (0, boxGacha_1.getPlayerBoxGachaDrawnRewardsSync)(playerId, boxGachaId, boxId);
            const currentBoxData = (0, boxGacha_1.getPlayerBoxGachaSync)(playerId, boxGachaId, boxId);
            const remainingNumber = getCurrentRemainingNumber(boxRewards, currentDrawnRewards);
            const expandedEmptyBox = boxGachaId !== box_gacha_1001_1.BOX_GACHA_1001_ID
                && (currentBoxData === null || currentBoxData === void 0 ? void 0 : currentBoxData.remainingNumber) === 0 && remainingNumber > 0;
            if ((currentBoxData === null || currentBoxData === void 0 ? void 0 : currentBoxData.isClosed) && !expandedEmptyBox)
                return { errorMessage: "Box is closed." };
            if (pullCount > remainingNumber)
                return { errorMessage: "Not enough remaining rewards." };
            const currentCurrency = (0, item_1.getPlayerItemSync)(playerId, pullCurrencyId);
            if (currentCurrency === null)
                return { errorMessage: "No pull currency." };
            const maximumPullCost = pullCount * boxGachaData.redeemItemCount;
            if (!isPositiveSafeInteger(maximumPullCost))
                return { errorMessage: "Invalid pull cost." };
            if (currentCurrency < maximumPullCost)
                return { errorMessage: "Not enough pull currency." };
            const drawResult = (0, gacha_1.drawBoxGachaSync)(boxRewards, currentDrawnRewards, pullCount, stopOnFeaturedRewards);
            const actualPullCost = drawResult.drawCount * boxGachaData.redeemItemCount;
            const newPullCurrency = currentCurrency - actualPullCost;
            if (!isPositiveSafeInteger(drawResult.drawCount) || drawResult.drawCount > pullCount
                || !isPositiveSafeInteger(actualPullCost) || newPullCurrency < 0) {
                return { errorMessage: "Invalid draw result." };
            }
            (0, game_logging_1.gameVerboseLog)(() => `[BOX] exec result: boxGachaId=${boxGachaId} boxId=${boxId} requested=${pullCount} actual=${drawResult.drawCount} cost=${actualPullCost} stopOnFeatured=${stopOnFeaturedRewards}`);
            // Charge first so a reward in the same currency is added to the final balance.
            (0, item_1.updatePlayerItemSync)(playerId, pullCurrencyId, newPullCurrency);
            const rewardResult = (0, gacha_1.rewardPlayerBoxGachaResultSync)(playerId, drawResult);
            const playerDrawnRewardMap = new Map(currentDrawnRewards.map(reward => [reward.id, reward.number]));
            const remainingDrawsNumber = remainingNumber - drawResult.drawCount;
            const shouldClose = remainingDrawsNumber === 0;
            if (currentBoxData === null) {
                (0, boxGacha_1.insertPlayerBoxGachaSync)(playerId, boxGachaId, {
                    boxId, isClosed: shouldClose, remainingNumber: remainingDrawsNumber, resetTimes: 0,
                });
            }
            else {
                (0, boxGacha_1.updatePlayerBoxGachaSync)(playerId, boxGachaId, {
                    boxId, isClosed: shouldClose, remainingNumber: remainingDrawsNumber,
                });
            }
            for (const drawnReward of drawResult.rewards) {
                const existing = playerDrawnRewardMap.get(drawnReward.id);
                if (existing === undefined) {
                    (0, boxGacha_1.insertPlayerBoxGachaDrawnRewardSync)(playerId, boxGachaId, boxId, {
                        id: drawnReward.id, number: drawnReward.number,
                    });
                }
                else {
                    (0, boxGacha_1.updatePlayerBoxGachaDrawnRewardSync)(playerId, boxGachaId, boxId, drawnReward.id, existing + drawnReward.number);
                }
            }
            const existingCharacterList = ((_a = rewardResult === null || rewardResult === void 0 ? void 0 : rewardResult.character_list) !== null && _a !== void 0 ? _a : []);
            const characterList = (0, mission_1.reconcileAwakeUnlockCharacterList)(playerId, existingCharacterList);
            const responsePlayer = (0, player_1.getPlayerSync)(playerId);
            if (responsePlayer === null)
                throw new Error("Player disappeared during box settlement.");
            return {
                drawResult, rewardResult, currentDrawnRewards,
                playerBoxData: {
                    boxId, resetTimes: (_b = currentBoxData === null || currentBoxData === void 0 ? void 0 : currentBoxData.resetTimes) !== null && _b !== void 0 ? _b : 0,
                    remainingNumber: remainingDrawsNumber, isClosed: shouldClose,
                },
                allBoxInfo: getAllBoxList(playerId, boxGachaId, boxGachaData.boxes, boxId),
                characterList,
                finalPullCurrency: (0, item_1.getPlayerItemSync)(playerId, pullCurrencyId),
                userInfo: {
                    free_mana: responsePlayer.freeMana,
                    exp_pool: responsePlayer.expPool,
                    exp_pooled_time: (0, player_time_compat_1.getPlayerClientExpTime)(responsePlayer),
                },
            };
        });
        if ("errorMessage" in settlement)
            return reply.status(400).send({
                "error": "Bad Request", "message": settlement.errorMessage,
            });
        const { drawResult, rewardResult, currentDrawnRewards, allBoxInfo, characterList } = settlement;
        const drawnRewards = drawResult.rewards;
        const allDrawResultMap = new Map();
        for (const drawnReward of drawnRewards) {
            allDrawResultMap.set(drawnReward.id, drawnReward.number);
        }
        for (const playerDrawnReward of currentDrawnRewards) {
            allDrawResultMap.set(playerDrawnReward.id, ((_d = allDrawResultMap.get(playerDrawnReward.id)) !== null && _d !== void 0 ? _d : 0) + playerDrawnReward.number);
        }
        const responsePlayerBoxData = settlement.playerBoxData;
        // add current box to allBoxInfo
        {
            // build all drawn reward list
            const allDrawnRewardList = [];
            for (const [rewardId, number] of allDrawResultMap) {
                allDrawnRewardList.push({
                    "reward_id": rewardId,
                    "number": number
                });
            }
            allBoxInfo.push({
                "box_id": boxId,
                "reset_times": (_e = responsePlayerBoxData === null || responsePlayerBoxData === void 0 ? void 0 : responsePlayerBoxData.resetTimes) !== null && _e !== void 0 ? _e : 0,
                "all_drawn_reward_list": allDrawnRewardList,
                "coming_next_reward_list": [],
                "is_closed": responsePlayerBoxData.isClosed
            });
        }
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {
                "user_info": settlement.userInfo,
                "drawn_reward_list": drawnRewards.map(reward => {
                    return {
                        "reward_id": reward.id,
                        "number": reward.number
                    };
                }),
                "all_box_info": allBoxInfo,
                "joined_character_id_list": (_f = rewardResult === null || rewardResult === void 0 ? void 0 : rewardResult.joined_character_id_list) !== null && _f !== void 0 ? _f : [],
                "character_list": characterList,
                "equipment_list": (_g = rewardResult === null || rewardResult === void 0 ? void 0 : rewardResult.equipment_list) !== null && _g !== void 0 ? _g : [],
                "item_list": Object.assign(Object.assign({}, ((_h = rewardResult === null || rewardResult === void 0 ? void 0 : rewardResult.items) !== null && _h !== void 0 ? _h : {})), { [pullCurrencyId]: settlement.finalPullCurrency }),
                "mail_arrived": false
            }
        });
    }));
    fastify.post("/get_box_list", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _j;
        const body = ((_j = request.body) !== null && _j !== void 0 ? _j : {});
        const viewerId = body.viewer_id;
        const boxGachaId = body.box_gacha_id;
        (0, game_logging_1.gameVerboseLog)(() => `[BOX] get_box_list: boxGachaId=${boxGachaId}`);
        if (!isPositiveSafeInteger(viewerId) || !isPositiveSafeInteger(boxGachaId))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        // get player
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        const player = playerId !== null ? (0, player_1.getPlayerSync)(playerId) : null;
        if (player === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No players bound to account."
            });
        // get box gacha data
        const boxGachaData = (0, assets_1.getBoxGachaSync)(boxGachaId);
        if (boxGachaData === null)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid box gacha id."
            });
        const allBoxInfo = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "gacha", playerId, operation: "box_list",
        }, () => getAllBoxList(playerId, boxGachaId, boxGachaData.boxes));
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {
                "all_box_info": allBoxInfo
            }
        });
    }));
});
exports.default = routes;
