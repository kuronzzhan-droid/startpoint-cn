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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const item_1 = require("../../data/domains/item");
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const activeAccount_1 = require("../../data/activeAccount");
const assets_1 = require("../../lib/assets");
const utils_1 = require("../../utils");
const item_sell_1 = require("../../lib/item-sell");
const stamina_1 = require("../../lib/stamina");
const item_data_json_1 = __importDefault(require("../../../assets/item_data.json"));
const mission_1 = require("../../lib/mission");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const game_logging_1 = require("../../lib/game-logging");
const ITEM_EFFECTS = item_data_json_1.default;
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/use_item", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId) || !Array.isArray(body.items) || body.items.length === 0) {
            console.warn('[ITEM-USE] invalid request body');
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid request body." });
        }
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (!playerId)
            return reply.status(500).send({ "error": "Internal Server Error", "message": "No player bound to account." });
        if (!(0, player_1.getPlayerSync)(playerId))
            return reply.status(500).send({ "error": "Internal Server Error", "message": "Player not found." });
        const config = (0, assets_1.getConfigSync)();
        const maxOverflow = config.max_stamina_overflow;
        let totalStaminaRecovery = 0;
        // Aggregate repeated entries for the same item so ownership is checked
        // against the combined amount, not once per entry.
        const requestedCounts = new Map();
        let hasStaminaItem = false;
        for (const itemReq of body.items) {
            const itemId = itemReq === null || itemReq === void 0 ? void 0 : itemReq.id;
            const requestCount = itemReq === null || itemReq === void 0 ? void 0 : itemReq.number;
            if (!Number.isSafeInteger(itemId) || itemId <= 0) {
                console.warn(`[ITEM-USE] invalid item id: ${itemId}`);
                continue;
            }
            if (!Number.isSafeInteger(requestCount) || requestCount <= 0) {
                console.warn(`[ITEM-USE] invalid count: ${requestCount} for item ${itemId}`);
                continue;
            }
            const effectInfo = ITEM_EFFECTS[itemId];
            if (!effectInfo) {
                console.warn(`[ITEM-USE] item ${itemId} not in effect table, skipping`);
                continue;
            }
            const { effectKind, effectValue } = effectInfo;
            // Only handle stamina recovery items
            if (effectKind !== 2 && effectKind !== 3) {
                console.warn(`[ITEM-USE] item ${itemId} effectKind=${effectKind}, not a stamina item, skipping`);
                continue;
            }
            const combinedCount = ((_a = requestedCounts.get(itemId)) !== null && _a !== void 0 ? _a : 0) + requestCount;
            if (!Number.isSafeInteger(combinedCount)) {
                return reply.status(400).send({ "error": "Bad Request", "message": "Insufficient items." });
            }
            let recoveryAmount;
            if (effectKind === 2) {
                // StaminaFixed: fixed recovery amount
                recoveryAmount = effectValue;
            }
            else {
                // StaminaRate: percentage of max overflow
                const rate = Math.max(0, effectValue) / 100; // e.g. 50 = 50%
                recoveryAmount = Math.floor(Math.max(0, maxOverflow) * rate);
            }
            if (!isFinite(recoveryAmount) || recoveryAmount < 0) {
                console.warn(`[ITEM-USE] invalid recovery amount for item ${itemId}: ${recoveryAmount}`);
                recoveryAmount = 0;
            }
            totalStaminaRecovery += recoveryAmount * requestCount;
            requestedCounts.set(itemId, combinedCount);
            hasStaminaItem = true;
        }
        if (!hasStaminaItem) {
            console.warn(`[ITEM-USE] no valid stamina recovery items in request`);
            return reply.status(400).send({ "error": "Bad Request", "message": "No valid stamina items." });
        }
        if (totalStaminaRecovery <= 0) {
            console.warn(`[ITEM-USE] zero total recovery`);
            return reply.status(400).send({ "error": "Bad Request", "message": "Zero recovery." });
        }
        // Ownership, current stamina, item consumption and stamina recovery are
        // all handled inside one player-owned persistence transaction so
        // overlapping requests cannot consume the same items twice and a partial
        // batch cannot consume items without applying the recovery.
        const outcome = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "use_stamina_items",
        }, () => {
            var _a;
            const player = (0, player_1.getPlayerSync)(playerId);
            if (!player)
                return { kind: "missing" };
            const itemUpdates = [];
            for (const [itemId, requestCount] of requestedCounts) {
                const currentCount = (_a = (0, item_1.getPlayerItemSync)(playerId, itemId)) !== null && _a !== void 0 ? _a : 0;
                if (currentCount < requestCount) {
                    console.warn(`[ITEM-USE] player ${playerId} has ${currentCount} of item ${itemId}, requested ${requestCount}`);
                    return { kind: "insufficient" };
                }
                itemUpdates.push({ id: itemId, newCount: currentCount - requestCount });
            }
            const currentStamina = (0, stamina_1.computeRealTimeStamina)(player);
            if (currentStamina >= maxOverflow)
                return { kind: "full", currentStamina };
            const afterStamina = Math.min(currentStamina + totalStaminaRecovery, maxOverflow);
            for (const upd of itemUpdates) {
                (0, item_1.updatePlayerItemSync)(playerId, upd.id, upd.newCount);
            }
            (0, player_1.updatePlayerSync)({
                id: playerId,
                stamina: afterStamina,
                staminaHealTime: new Date()
            });
            return { kind: "applied", itemUpdates, currentStamina, afterStamina };
        });
        if (outcome.kind === "missing") {
            return reply.status(500).send({ "error": "Internal Server Error", "message": "Player not found." });
        }
        if (outcome.kind === "insufficient") {
            return reply.status(400).send({ "error": "Bad Request", "message": "Insufficient items." });
        }
        if (outcome.kind === "full") {
            console.log(`[ITEM-USE] player ${playerId} already at max stamina (${outcome.currentStamina} >= ${maxOverflow})`);
            return reply.status(400).send({ "error": "Bad Request", "code": 2102, "message": "Already at max stamina." });
        }
        const { itemUpdates, currentStamina, afterStamina } = outcome;
        (0, game_logging_1.gameVerboseLog)(() => `[ITEM-USE] player ${playerId}: stamina ${currentStamina}->${afterStamina} (+${totalStaminaRecovery}), items: ${JSON.stringify(itemUpdates)}`);
        // Build item_list as IntMap<int> (client expects { itemId: count })
        const itemListMap = {};
        for (const upd of itemUpdates) {
            itemListMap[upd.id] = upd.newCount;
        }
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "user_info": {
                    "stamina": afterStamina,
                    "stamina_heal_time": (0, utils_1.realToVirtual)(new Date())
                },
                "item_list": itemListMap
            }
        });
    }));
    // ── sell (sell items/ability souls for mana) ────────────────────────
    fastify.post("/sell", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const itemId = body.item_id;
        const sellNumber = body.sell_number;
        if (!viewerId || isNaN(viewerId) || !itemId || isNaN(itemId) || !sellNumber || isNaN(sellNumber)) {
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid request body." });
        }
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." });
        const accountId = session.accountId;
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(accountId);
        if (!playerId)
            return reply.status(500).send({ "error": "Internal Server Error", "message": "No player bound to account." });
        // Ownership and mana checks must read the same state the write commits.
        const result = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "sell_item",
        }, () => (0, item_sell_1.sellItemSync)(playerId, itemId, sellNumber));
        if (!result.ok) {
            const code = 'errorCode' in result ? result.errorCode : undefined;
            return reply.status(400).send({ "error": "Bad Request", "code": code, "message": result.error });
        }
        const characterList = (0, mission_1.reconcileAwakeUnlockCharacterList)(playerId, []);
        (0, game_logging_1.gameVerboseLog)(() => `[ITEM_SELL] account=${accountId} player=${playerId}: item ${itemId} ×${sellNumber} sold, mana +${result.manaGained} (${result.freeMana - result.manaGained} -> ${result.freeMana})`);
        reply.header("content-type", "application/x-msgpack");
        const responseData = {
            "item_list": { [itemId]: result.newCount },
            "user_info": { "free_mana": result.freeMana },
            "mail_arrived": false
        };
        if (characterList.length > 0)
            responseData.character_list = characterList;
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": responseData
        });
    }));
});
exports.default = routes;
