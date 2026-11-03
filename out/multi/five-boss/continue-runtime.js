"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.continueFiveBoss = exports.continueFiveBossSync = exports.isFiveBossContinueRequest = exports.fiveBossContinueAcknowledgement = exports.FiveBossContinueError = void 0;
const crypto_1 = require("crypto");
const continue_cost_1 = require("../../lib/continue-cost");
const continue_payment_1 = require("../../lib/continue-payment");
const db_1 = require("../../data/db");
const player_1 = require("../../data/domains/player");
const quest_active_1 = require("../../data/domains/quest_active");
const contract_1 = require("./contract");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
class FiveBossContinueError extends Error {
    constructor(message, stale = false) {
        super(message);
        this.stale = stale;
    }
}
exports.FiveBossContinueError = FiveBossContinueError;
/**
 * Neutral continue response used when the request cannot be honored. Mirrors
 * the success shape so every client build can parse it; the battle itself is
 * already gone server-side, so nothing is debited and no receipt is written.
 */
function fiveBossContinueAcknowledgement(playerId) {
    var _a, _b;
    const player = (0, player_1.getPlayerSync)(playerId);
    return {
        continue_count: contract_1.FIVE_BOSS_GAUNTLET.maxContinueCount,
        user_info: {
            free_vmoney: (_a = player === null || player === void 0 ? void 0 : player.freeVmoney) !== null && _a !== void 0 ? _a : 0,
            vmoney: (_b = player === null || player === void 0 ? void 0 : player.vmoney) !== null && _b !== void 0 ? _b : 0,
        },
        mail_arrived: false,
    };
}
exports.fiveBossContinueAcknowledgement = fiveBossContinueAcknowledgement;
/** Also catches a forged ordinary-quest request during a registered gauntlet. */
function isFiveBossContinueRequest(playerId, category, questId, playId) {
    if ((0, contract_1.isFiveBossGauntletQuest)(category, questId))
        return true;
    const active = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
    if (active !== null
        && active.playId === playId
        && (0, contract_1.isFiveBossGauntletQuest)(active.category, active.questId))
        return true;
    if (typeof playId !== "string")
        return false;
    return !!(0, db_1.getDb)().prepare(`SELECT 1 FROM five_boss_solo_runs WHERE player_id = ? AND play_id = ?
        UNION ALL SELECT 1 FROM five_boss_gauntlet_members WHERE player_id = ? AND client_play_id = ? LIMIT 1`)
        .get(playerId, playId, playerId, playId);
}
exports.isFiveBossContinueRequest = isFiveBossContinueRequest;
function stableJson(value) {
    var _a;
    if (Array.isArray(value))
        return "[" + value.map(stableJson).join(",") + "]";
    if (value !== null && typeof value === "object") {
        const record = value;
        return "{" + Object.keys(record).sort().map(key => JSON.stringify(key) + ":" + stableJson(record[key])).join(",") + "}";
    }
    return (_a = JSON.stringify(value)) !== null && _a !== void 0 ? _a : "null";
}
/**
 * Debit and count commit together. A legacy client can resend a recovery
 * request with a new api_count/statistics pair after a scene transition or
 * reconnect. Once a receipt exists, acknowledge that resend without charging
 * again; the old client has no local business-error path for a 400 response.
 */
function continueFiveBossInTransaction(input) {
    const apiCount = Number(input.apiCount);
    if (!(0, contract_1.isFiveBossGauntletQuest)(input.category, input.questId)
        || typeof input.playId !== "string" || !input.playId.length || input.playId.length > 255
        || input.apiCount === undefined || input.apiCount === null || input.apiCount === ""
        || !Number.isSafeInteger(apiCount) || apiCount < 0) {
        throw new FiveBossContinueError("Invalid five-boss continue identity.");
    }
    const playId = input.playId;
    const requestKey = apiCount + ":" + (0, crypto_1.createHash)("sha256").update(stableJson(input.statistics)).digest("hex");
    const db = (0, db_1.getDb)();
    {
        // Persistent state is authoritative even if an in-memory entry is stale after reconnect.
        const active = (0, quest_active_1.getPlayerActiveQuestSync)(input.playerId);
        if (!active || active.playId !== playId || active.isMulti !== input.isMulti
            || !(0, contract_1.isFiveBossGauntletQuest)(active.category, active.questId)) {
            throw new FiveBossContinueError("No matching active five-boss quest to continue.", true);
        }
        const registered = input.isMulti
            ? db.prepare(`SELECT 1 FROM five_boss_gauntlet_members m
                JOIN five_boss_gauntlet_runs r ON r.run_id = m.run_id
                LEFT JOIN five_boss_gauntlet_receipts receipt ON receipt.run_id = m.run_id AND receipt.player_id = m.player_id
                WHERE m.player_id = ? AND m.client_play_id = ? AND r.status = 'active'
                    AND m.started_at IS NOT NULL AND m.aborted_at IS NULL AND m.finalized_at IS NULL
                    AND receipt.player_id IS NULL AND r.room_number = ?`)
                .get(input.playerId, playId, active.roomNumber)
            : db.prepare(`SELECT 1 FROM five_boss_solo_runs WHERE player_id = ? AND play_id = ? AND status = 'active'`)
                .get(input.playerId, playId);
        if (!registered)
            throw new FiveBossContinueError("Five-boss run is no longer active.", true);
        const receipt = db.prepare(`SELECT request_key FROM five_boss_continue_receipts
            WHERE player_id = ? AND play_id = ? AND is_multi = ?`)
            .get(input.playerId, playId, Number(input.isMulti));
        if (!receipt && active.continueCount >= contract_1.FIVE_BOSS_GAUNTLET.maxContinueCount) {
            throw new FiveBossContinueError("Each player can continue only once per five-boss run.");
        }
        if (receipt && active.continueCount < contract_1.FIVE_BOSS_GAUNTLET.maxContinueCount) {
            // Repair a stale active-quest row left by an interrupted recovery;
            // the receipt is authoritative and no second debit is allowed.
            (0, quest_active_1.updatePlayerActiveQuestContinueCountSync)(input.playerId, contract_1.FIVE_BOSS_GAUNTLET.maxContinueCount);
        }
        const player = (0, player_1.getPlayerSync)(input.playerId);
        if (!player)
            throw new FiveBossContinueError("Player does not exist.");
        const itemCost = (0, continue_cost_1.getContinueItemCost)(input.questId);
        let debitedItemId = itemCost === null || itemCost === void 0 ? void 0 : itemCost.item_id;
        if (receipt === null || receipt === void 0 ? void 0 : receipt.request_key.startsWith("{")) {
            const recorded = JSON.parse(receipt.request_key);
            if (Number.isInteger(recorded.item_id) && recorded.item_id > 0)
                debitedItemId = recorded.item_id;
        }
        if (!receipt) {
            if (itemCost) {
                try {
                    (0, continue_payment_1.debitContinueItem)(input.playerId, itemCost);
                }
                catch (error) {
                    if (error instanceof continue_payment_1.ContinuePaymentError)
                        throw new FiveBossContinueError(error.message);
                    throw error;
                }
            }
            else {
                const freeCost = Math.min(player.freeVmoney, contract_1.FIVE_BOSS_GAUNTLET.continueVmoneyCost);
                const paidCost = contract_1.FIVE_BOSS_GAUNTLET.continueVmoneyCost - freeCost;
                if (player.vmoney < paidCost)
                    throw new FiveBossContinueError("Not enough vmoney to continue.");
                player.freeVmoney -= freeCost;
                player.vmoney -= paidCost;
                (0, player_1.updatePlayerSync)({ id: input.playerId, freeVmoney: player.freeVmoney, vmoney: player.vmoney });
            }
            (0, quest_active_1.updatePlayerActiveQuestContinueCountSync)(input.playerId, contract_1.FIVE_BOSS_GAUNTLET.maxContinueCount);
            db.prepare(`INSERT INTO five_boss_continue_receipts(player_id, play_id, is_multi, request_key) VALUES (?, ?, ?, ?)`)
                .run(input.playerId, playId, Number(input.isMulti), itemCost
                ? JSON.stringify({ request_key: requestKey, item_id: itemCost.item_id }) : requestKey);
        }
        return Object.assign(Object.assign({ continue_count: contract_1.FIVE_BOSS_GAUNTLET.maxContinueCount }, (debitedItemId ? { item_list: (0, continue_payment_1.continueItemBalance)(input.playerId, debitedItemId) } : {})), { user_info: { free_vmoney: player.freeVmoney, vmoney: player.vmoney }, mail_arrived: false });
    }
}
/** Synchronous compatibility API for legacy callers and isolated tests. */
function continueFiveBossSync(input) {
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "multi-settlement", playerId: input.playerId, operation: "five_boss_continue_sync",
    }, () => continueFiveBossInTransaction(input));
}
exports.continueFiveBossSync = continueFiveBossSync;
/** Async HTTP path; the transaction is owned by the persistence boundary. */
function continueFiveBoss(input) {
    return (0, persistence_coordinator_1.runPersistenceTransaction)({
        domain: "multi-settlement", playerId: input.playerId, operation: "five_boss_continue",
    }, () => continueFiveBossInTransaction(input));
}
exports.continueFiveBoss = continueFiveBoss;
