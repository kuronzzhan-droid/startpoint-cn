"use strict";
// Equipment dismantle/sell endpoints: sell_equipment, sell_stack, bulk_sell_stack.
// Registered under /api/index.php/equipment prefix (shared with equipment.ts).
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
const equipment_1 = require("../../data/domains/equipment");
const item_1 = require("../../data/domains/item");
const session_1 = require("../../data/domains/session");
const utils_1 = require("../../utils");
const equipment_2 = require("../../lib/equipment");
const equipment_dissolve_1 = require("../../lib/equipment-dissolve");
const activeAccount_1 = require("../../data/activeAccount");
const assets_1 = require("../../lib/assets");
const game_logging_1 = require("../../lib/game-logging");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const request_ids_1 = require("../../lib/request-ids");
const wrightpieceItemId = () => (0, assets_1.getConfigSync)().craft_point_item_id || 100000;
const starGrainItemId = () => (0, assets_1.getConfigSync)().star_grain_item_id || 990008;
const newDissolveTotals = () => ({ craftPoints: 0, starGrains: 0, abilitySouls: {} });
function addDissolveRewards(totals, equipmentId, count) {
    var _a;
    const rewards = (0, equipment_dissolve_1.calculateDissolveRewards)(equipmentId, count);
    totals.craftPoints += rewards.craftPoints;
    totals.starGrains += rewards.starGrains;
    for (const [soulId, soulCount] of Object.entries(rewards.abilitySouls)) {
        totals.abilitySouls[parseInt(soulId)] = ((_a = totals.abilitySouls[parseInt(soulId)]) !== null && _a !== void 0 ? _a : 0) + soulCount;
    }
    return rewards;
}
function grantDissolveRewardsSync(playerId, totals) {
    const result = {};
    if (totals.craftPoints > 0) {
        result[wrightpieceItemId()] = (0, item_1.givePlayerItemSync)(playerId, wrightpieceItemId(), totals.craftPoints);
    }
    if (totals.starGrains > 0) {
        result[starGrainItemId()] = (0, item_1.givePlayerItemSync)(playerId, starGrainItemId(), totals.starGrains);
    }
    for (const [soulId, count] of Object.entries(totals.abilitySouls)) {
        result[parseInt(soulId)] = (0, item_1.givePlayerItemSync)(playerId, parseInt(soulId), count);
    }
    return result;
}
function describeSouls(totals) {
    return {
        soulTypes: Object.keys(totals.abilitySouls).length,
        soulDetail: Object.entries(totals.abilitySouls).map(([id, c]) => `${id}×${c}`).join(' '),
    };
}
const invalidBody = (reply) => reply.status(400).send({ "error": "Bad Request", "message": "Invalid request body." });
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    // ── sell_equipment (single equipment, all stacks) ──────────────────
    fastify.post("/sell_equipment", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const toSellEquipmentList = body.equipment_list;
        if (isNaN(viewerId) || !Array.isArray(toSellEquipmentList))
            return invalidBody(reply);
        const requestedIds = (0, request_ids_1.parsePositiveSafeIntegerList)(toSellEquipmentList.map(entry => entry === null || entry === void 0 ? void 0 : entry.equipment_id));
        if (requestedIds === null)
            return invalidBody(reply);
        const equipmentIds = (0, request_ids_1.uniqueIds)(requestedIds);
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." });
        const accountId = session.accountId;
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(accountId);
        if (playerId === null)
            return reply.status(500).send({ "error": "Internal Server Error", "message": "No players bound to account." });
        // Ownership, stacks and rewards are read inside the player write
        // queue so overlapping requests cannot sell the same stack twice.
        const outcome = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "sell_equipment",
        }, () => {
            const totals = newDissolveTotals();
            const soldIds = [];
            for (const equipmentId of equipmentIds) {
                const equipment = (0, equipment_1.getPlayerEquipmentSync)(playerId, equipmentId);
                if (!equipment)
                    return { ok: false };
                if (equipment.stack <= 0)
                    continue;
                // 1 unit, not × stack (client Expected sell_equipment gives 1 ability soul per unit)
                addDissolveRewards(totals, equipmentId, 1);
                soldIds.push(equipmentId);
            }
            for (const equipmentId of soldIds) {
                (0, equipment_1.updatePlayerEquipmentSync)(playerId, equipmentId, { stack: 0 });
            }
            return { ok: true, totals, soldIds, itemList: grantDissolveRewardsSync(playerId, totals) };
        });
        if (!outcome.ok) {
            return reply.status(400).send({ "error": "Bad Request", "message": "Player does not own equipment." });
        }
        const returnEquipmentList = (0, equipment_2.buildFullEquipmentList)(playerId);
        const { totals, soldIds } = outcome;
        const craftLog = totals.craftPoints > 0 ? `craft +${totals.craftPoints} ` : "";
        const starLog = totals.starGrains > 0 ? `star +${totals.starGrains} ` : "";
        const { soulTypes, soulDetail } = describeSouls(totals);
        (0, game_logging_1.gameVerboseLog)(() => `[SELL_EQUIP] account=${accountId} player=${playerId}: ${soldIds.length} equipment sold (${soldIds.join(',')}), ${craftLog}${starLog}ability souls: ${soulTypes} types [${soulDetail}]`);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "equipment_list": returnEquipmentList,
                "item_list": outcome.itemList,
                "mail_arrived": false
            }
        });
    }));
    // ── sell_stack (partial stack sale) ─────────────────────────────────
    fastify.post("/sell_stack", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const toSellEquipmentList = body.equipment_list;
        if (isNaN(viewerId) || !Array.isArray(toSellEquipmentList))
            return invalidBody(reply);
        const requestedSales = [];
        for (const entry of toSellEquipmentList) {
            const equipmentId = (0, request_ids_1.parsePositiveSafeInteger)(entry === null || entry === void 0 ? void 0 : entry.equipment_id);
            const sellCount = (0, request_ids_1.parsePositiveSafeInteger)(entry === null || entry === void 0 ? void 0 : entry.number);
            if (equipmentId === null || sellCount === null)
                return invalidBody(reply);
            requestedSales.push({ equipmentId, sellCount });
        }
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." });
        const accountId = session.accountId;
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(accountId);
        if (playerId === null)
            return reply.status(500).send({ "error": "Internal Server Error", "message": "No players bound to account." });
        const outcome = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "sell_equipment_stack",
        }, () => {
            var _a;
            const totals = newDissolveTotals();
            const projectedStacks = new Map();
            for (const { equipmentId, sellCount } of requestedSales) {
                const equipment = (0, equipment_1.getPlayerEquipmentSync)(playerId, equipmentId);
                if (!equipment)
                    return { ok: false, message: "Player does not own equipment." };
                const currentStack = (_a = projectedStacks.get(equipmentId)) !== null && _a !== void 0 ? _a : equipment.stack;
                const newStack = currentStack - sellCount;
                if (newStack < 0)
                    return { ok: false, message: "Attempt to sell more stacks than owned." };
                addDissolveRewards(totals, equipmentId, sellCount);
                projectedStacks.set(equipmentId, newStack);
            }
            for (const [equipmentId, newStack] of projectedStacks) {
                (0, equipment_1.updatePlayerEquipmentSync)(playerId, equipmentId, { stack: newStack });
            }
            return { ok: true, totals, itemList: grantDissolveRewardsSync(playerId, totals) };
        });
        if (!outcome.ok)
            return reply.status(400).send({ "error": "Bad Request", "message": outcome.message });
        const returnEquipmentList = (0, equipment_2.buildFullEquipmentList)(playerId);
        const { totals } = outcome;
        const { soulTypes, soulDetail } = describeSouls(totals);
        (0, game_logging_1.gameVerboseLog)(() => `[SELL_STACK] account=${accountId} player=${playerId}: ${toSellEquipmentList.length} equipment stack sold, craft +${totals.craftPoints} star +${totals.starGrains} ability souls: ${soulTypes} types [${soulDetail}]`);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "equipment_list": returnEquipmentList,
                "item_list": outcome.itemList,
                "mail_arrived": false
            }
        });
    }));
    // ── bulk_sell_stack (one-click dismantle) ──────────────────────────
    fastify.post("/bulk_sell_stack", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const rawEquipmentIds = body.equipment_ids;
        if (isNaN(viewerId) || !rawEquipmentIds || !Array.isArray(rawEquipmentIds) || rawEquipmentIds.length === 0) {
            return invalidBody(reply);
        }
        const requestedIds = (0, request_ids_1.parsePositiveSafeIntegerList)(rawEquipmentIds);
        if (requestedIds === null)
            return invalidBody(reply);
        const equipmentIds = (0, request_ids_1.uniqueIds)(requestedIds);
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." });
        const accountId = session.accountId;
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(accountId);
        if (playerId === null)
            return reply.status(500).send({ "error": "Internal Server Error", "message": "No players bound to account." });
        // Calculate and apply rewards in one transaction so concurrent requests
        // observe each other's stack changes.
        const outcome = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "bulk_sell_equipment_stack",
        }, () => {
            const totals = newDissolveTotals();
            const toSell = [];
            for (const equipmentId of equipmentIds) {
                const equipment = (0, equipment_1.getPlayerEquipmentSync)(playerId, equipmentId);
                if (!equipment)
                    continue;
                const stack = equipment.stack;
                if (stack <= 0)
                    continue;
                const rewards = addDissolveRewards(totals, equipmentId, stack);
                (0, game_logging_1.gameVerboseLog)(() => `[BULK_SELL] account=${accountId} player=${playerId}  -> eid=${equipmentId} stack=${stack} rarity=${Math.floor(equipmentId / 1000000)} craft=${rewards.craftPoints} star=${rewards.starGrains} souls=${JSON.stringify(rewards.abilitySouls)}`);
                toSell.push(equipmentId);
            }
            if (toSell.length === 0)
                return { totals, toSell, itemList: {} };
            for (const equipmentId of toSell) {
                (0, equipment_1.updatePlayerEquipmentSync)(playerId, equipmentId, { stack: 0 });
            }
            return { totals, toSell, itemList: grantDissolveRewardsSync(playerId, totals) };
        });
        if (outcome.toSell.length === 0) {
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                "data": { "equipment_list": [], "item_list": {}, "mail_arrived": false }
            });
        }
        const returnEquipmentList = (0, equipment_2.buildFullEquipmentList)(playerId);
        const { totals, toSell } = outcome;
        const craftLog = totals.craftPoints > 0 ? `craft +${totals.craftPoints} ` : "";
        const starLog = totals.starGrains > 0 ? `star +${totals.starGrains} ` : "";
        const { soulTypes, soulDetail } = describeSouls(totals);
        (0, game_logging_1.gameVerboseLog)(() => `[BULK_SELL] account=${accountId} player=${playerId}: ${toSell.length} equipment dissolved (${toSell.join(',')}), ${craftLog}${starLog}ability souls: ${soulTypes} types [${soulDetail}]`);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "equipment_list": returnEquipmentList,
                "item_list": outcome.itemList,
                "mail_arrived": false
            }
        });
    }));
});
exports.default = routes;
