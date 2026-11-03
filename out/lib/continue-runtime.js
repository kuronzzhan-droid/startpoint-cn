"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.continueConfiguredQuestSync = exports.continueConfiguredQuest = exports.isConfiguredContinueRequest = exports.ContinuePaymentError = void 0;
const continue_request_1 = require("./continue-request");
const player_1 = require("../data/domains/player");
const quest_active_1 = require("../data/domains/quest_active");
const player_operation_receipt_1 = require("../data/domains/player-operation-receipt");
const continue_cost_1 = require("./continue-cost");
const continue_payment_1 = require("./continue-payment");
const persistence_coordinator_1 = require("./persistence-coordinator");
var continue_payment_2 = require("./continue-payment");
Object.defineProperty(exports, "ContinuePaymentError", { enumerable: true, get: function () { return continue_payment_2.ContinuePaymentError; } });
const OPERATION = "configured_quest_continue_v1";
/** Check the registered quest too, so a forged unconfigured ID cannot bypass payment. */
function isConfiguredContinueRequest(playerId, questId) {
    const active = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
    return !!(0, continue_cost_1.getContinueItemCost)(questId) || !!(active && (0, continue_cost_1.getContinueItemCost)(active.questId));
}
exports.isConfiguredContinueRequest = isConfiguredContinueRequest;
function continueConfiguredInTransaction(input) {
    const { requestKey, expectedCount } = (0, continue_request_1.continueRequestIdentity)(input);
    const active = (0, quest_active_1.getPlayerActiveQuestSync)(input.playerId);
    if (!active || active.playId !== input.playId || active.isMulti !== input.isMulti
        || active.questId !== input.questId || active.category !== input.category) {
        throw new continue_payment_1.ContinuePaymentError("No matching active quest to continue.");
    }
    const cost = (0, continue_cost_1.getContinueItemCost)(active.questId);
    if (!cost)
        throw new continue_payment_1.ContinuePaymentError("No configured continue cost for this quest.");
    const player = (0, player_1.getPlayerSync)(input.playerId);
    if (!player)
        throw new continue_payment_1.ContinuePaymentError("Player does not exist.");
    const receipt = (0, player_operation_receipt_1.getPlayerOperationReceiptSync)(input.playerId, OPERATION, requestKey);
    let itemList;
    let continueCount = active.continueCount;
    if (receipt) {
        // Return current absolute inventory, never a stale cached pre-later-debit balance.
        itemList = (0, continue_payment_1.continueItemBalance)(input.playerId, receipt.response.itemId);
    }
    else {
        if (expectedCount !== undefined && expectedCount !== active.continueCount) {
            throw new continue_payment_1.ContinuePaymentError("Continue count does not match the active quest.");
        }
        itemList = (0, continue_payment_1.debitContinueItem)(input.playerId, cost);
        continueCount++;
        (0, quest_active_1.updatePlayerActiveQuestContinueCountSync)(input.playerId, continueCount);
        (0, player_operation_receipt_1.insertPlayerOperationReceiptSync)({ playerId: input.playerId, operation: OPERATION,
            requestKey, response: { itemId: cost.item_id, continueCount } });
    }
    return { continue_count: continueCount, item_list: itemList,
        user_info: { free_vmoney: player.freeVmoney, vmoney: player.vmoney }, mail_arrived: false };
}
function continueConfiguredQuest(input) {
    return (0, persistence_coordinator_1.runPersistenceTransaction)({ domain: input.isMulti ? "multi-settlement" : "single-quest",
        playerId: input.playerId, operation: OPERATION }, () => continueConfiguredInTransaction(input));
}
exports.continueConfiguredQuest = continueConfiguredQuest;
function continueConfiguredQuestSync(input) {
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: input.isMulti ? "multi-settlement" : "single-quest",
        playerId: input.playerId, operation: OPERATION }, () => continueConfiguredInTransaction(input));
}
exports.continueConfiguredQuestSync = continueConfiguredQuestSync;
