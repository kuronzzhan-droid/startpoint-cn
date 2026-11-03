"use strict";
// Equipment awakening and protection endpoints: upgrade, bulk_upgrade, set_protection.
// Dismantle/sell endpoints are in sell.ts (same /equipment prefix).
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
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const utils_1 = require("../../utils");
const equipment_2 = require("../../lib/equipment");
const assets_1 = require("../../lib/assets");
const equipment_awakening_rules_1 = require("../../lib/equipment-awakening-rules");
const activeAccount_1 = require("../../data/activeAccount");
const counters_1 = require("../../lib/mission/counters");
const mission_1 = require("../../lib/mission");
const game_logging_1 = require("../../lib/game-logging");
const rewards_1 = require("../../multi/five-boss/rewards");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const request_ids_1 = require("../../lib/request-ids");
const wrightpieceItemId = () => (0, assets_1.getConfigSync)().craft_point_item_id || 100000;
// wrightpiece cost for each rank of weapon (awakening) — from CDN
const getUpgradeCost = (rarity) => { var _a, _b; return (_b = (_a = (0, assets_1.getEquipmentCraftSync)(rarity)) === null || _a === void 0 ? void 0 : _a.awakening_craft) !== null && _b !== void 0 ? _b : 25; };
function recordEquipmentAwakeningProgress(playerId, upgradeCount) {
    (0, counters_1.addMissionCounterSync)(playerId, {
        dimension: "equipment.awakening",
        scopeType: "lifetime",
        scopeKey: "all",
        qualifier: {},
    }, upgradeCount);
    const levelFiveCount = Object.values((0, equipment_1.getPlayerEquipmentListSync)(playerId))
        .filter(equipment => equipment.level >= 5)
        .length;
    (0, counters_1.setMissionCounterMaxSync)(playerId, {
        dimension: "equipment.lv5_count",
        scopeType: "lifetime",
        scopeKey: "all",
        qualifier: {},
    }, levelFiveCount);
}
function mergeEquipmentDegreeSettlement(responseData, playerId, viewerId) {
    (0, mission_1.mergeMissionSettlementResponse)(responseData, (0, mission_1.settleMissionCategories)(playerId, [{
            category: 5,
            missionIds: (0, mission_1.getDegreeMissionIdsForConditionTypes)([34, 36]),
        }], new Date((0, utils_1.getServerTime)() * 1000)), viewerId);
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    // Parse once at registration so a malformed awakening asset stops startup.
    const awakeningRules = (0, assets_1.getEquipmentAwakeningRulesSync)();
    // ── upgrade (single equipment awakening) ───────────────────────────
    fastify.post("/upgrade", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const body = request.body;
        const viewerId = body.viewer_id;
        const upgradeCount = body.upgrade_count === undefined || body.upgrade_count === null
            ? 1
            : (0, request_ids_1.parsePositiveSafeInteger)(body.upgrade_count);
        const useStack = body.use_stack;
        const itemId = body.item_id;
        const equipmentId = (0, request_ids_1.parsePositiveSafeInteger)(body.equipment_id);
        if (isNaN(viewerId) || equipmentId === null || upgradeCount === null || useStack === undefined) {
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid request body." });
        }
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." });
        const accountId = session.accountId;
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(accountId);
        if (playerId === null)
            return reply.status(500).send({ "error": "Internal Server Error", "message": "No players bound to account." });
        if (!(0, equipment_1.getPlayerEquipmentSync)(playerId, equipmentId)) {
            return reply.status(400).send({ "error": "Bad Request", "message": "Player does not own equipment." });
        }
        if (!useStack && !(0, rewards_1.canUseAwakeningSubstitutionItem)(equipmentId)) {
            return reply.status(400).send({ error: "Bad Request", message: "This equipment requires duplicate bodies for awakening." });
        }
        const itemCheck = (0, equipment_awakening_rules_1.checkAwakeningItem)(awakeningRules, { equipmentId, useStack, itemId });
        if (!itemCheck.ok)
            return reply.status(400).send({ "error": "Bad Request", "message": itemCheck.message });
        const cdnInfo = (0, assets_1.getEquipmentDissolveSync)(equipmentId);
        const maxLevel = (_a = cdnInfo === null || cdnInfo === void 0 ? void 0 : cdnInfo.max_level) !== null && _a !== void 0 ? _a : 5;
        const equipmentRarity = Math.floor(equipmentId / 1000000); // 1-indexed
        const upgradeCost = getUpgradeCost(equipmentRarity);
        // Equipment, wrightpiece and substitution item balances are read and
        // validated inside the player write queue so overlapping requests see
        // each other's deductions.
        const outcome = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "equipment_upgrade",
        }, () => {
            var _a, _b;
            const equipment = (0, equipment_1.getPlayerEquipmentSync)(playerId, equipmentId);
            if (!equipment)
                return { ok: false, message: "Player does not own equipment." };
            const previousLevel = equipment.level;
            const previousStack = equipment.stack;
            const newLevel = equipment.level + upgradeCount;
            if (newLevel > maxLevel)
                return { ok: false, message: "Reached max awakening level." };
            const newStack = useStack ? equipment.stack - upgradeCount : equipment.stack;
            if (newStack < 0)
                return { ok: false, message: "Not enough stack." };
            const wrightPieces = (_a = (0, item_1.getPlayerItemSync)(playerId, wrightpieceItemId())) !== null && _a !== void 0 ? _a : 0;
            const newWrightPieces = wrightPieces - (upgradeCost * upgradeCount);
            if (newWrightPieces < 0)
                return { ok: false, message: "Not enough of wrightpieces." };
            const itemCount = itemId ? (_b = (0, item_1.getPlayerItemSync)(playerId, itemId)) !== null && _b !== void 0 ? _b : 0 : 0;
            const newItemCount = !useStack ? itemCount - upgradeCount : itemCount;
            if (newItemCount < 0)
                return { ok: false, message: "Not enough of item." };
            const returnItemList = {};
            if (!useStack && itemId !== undefined) {
                returnItemList[itemId] = newItemCount;
                (0, item_1.updatePlayerItemSync)(playerId, itemId, newItemCount);
            }
            returnItemList[wrightpieceItemId()] = newWrightPieces;
            (0, item_1.updatePlayerItemSync)(playerId, wrightpieceItemId(), newWrightPieces);
            (0, equipment_1.updatePlayerEquipmentSync)(playerId, equipmentId, { stack: newStack, level: newLevel });
            recordEquipmentAwakeningProgress(playerId, upgradeCount);
            // give ability cores (CDN check: only if generate_ability_soul)
            const dissolveInfo = (0, assets_1.getEquipmentDissolveSync)(equipmentId);
            if (dissolveInfo && dissolveInfo.generate_ability_soul) {
                returnItemList[dissolveInfo.ability_soul_id] = (0, item_1.givePlayerItemSync)(playerId, dissolveInfo.ability_soul_id, upgradeCount);
            }
            return { ok: true, returnItemList, previousLevel, previousStack, newLevel, newStack };
        });
        if (!outcome.ok)
            return reply.status(400).send({ "error": "Bad Request", "message": outcome.message });
        const returnEquipmentList = (0, equipment_2.buildFullEquipmentList)(playerId);
        (0, game_logging_1.gameVerboseLog)(() => `[UPGRADE] account=${accountId} player=${playerId}: eid=${equipmentId} rarity=${equipmentRarity} level ${outcome.previousLevel}->${outcome.newLevel} stack ${outcome.previousStack}->${outcome.newStack} craft -${upgradeCost * upgradeCount}`);
        reply.header("content-type", "application/x-msgpack");
        const responseData = {
            "equipment_list": returnEquipmentList,
            "item_list": outcome.returnItemList,
            "mail_arrived": false
        };
        mergeEquipmentDegreeSettlement(responseData, playerId, viewerId);
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": responseData
        });
    }));
    // ── bulk_upgrade (one-click awakening) ─────────────────────────────
    fastify.post("/bulk_upgrade", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const rawEquipmentIds = body.equipment_ids;
        if (isNaN(viewerId) || !rawEquipmentIds || !Array.isArray(rawEquipmentIds) || rawEquipmentIds.length === 0) {
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid request body." });
        }
        const requestedIds = (0, request_ids_1.parsePositiveSafeIntegerList)(rawEquipmentIds);
        if (requestedIds === null) {
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid request body." });
        }
        const equipmentIds = (0, request_ids_1.uniqueIds)(requestedIds);
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." });
        const accountId = session.accountId;
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(accountId);
        if (playerId === null)
            return reply.status(500).send({ "error": "Internal Server Error", "message": "No players bound to account." });
        const player = (0, player_1.getPlayerSync)(playerId);
        if (!player)
            return reply.status(500).send({ "error": "Internal Server Error", "message": "Player not found." });
        // Plan, validate and apply inside the player write queue so the
        // wrightpiece balance cannot be spent twice by overlapping requests.
        const outcome = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "equipment_bulk_upgrade",
        }, () => {
            var _a, _b, _c;
            const upgrades = [];
            let totalCraftPointCost = 0;
            for (const equipmentId of equipmentIds) {
                const equipment = (0, equipment_1.getPlayerEquipmentSync)(playerId, equipmentId);
                if (!equipment)
                    continue;
                const maxLvl = (_b = (_a = (0, assets_1.getEquipmentDissolveSync)(equipmentId)) === null || _a === void 0 ? void 0 : _a.max_level) !== null && _b !== void 0 ? _b : 5;
                const upgradeCount = Math.min(maxLvl - equipment.level, equipment.stack);
                if (upgradeCount <= 0)
                    continue;
                const rarity = Math.floor(equipmentId / 1000000); // 1-indexed
                totalCraftPointCost += getUpgradeCost(rarity) * upgradeCount;
                upgrades.push({ equipmentId, upgradeCount, level: equipment.level, stack: equipment.stack });
            }
            if (upgrades.length === 0)
                return { kind: "empty" };
            const currentCraftPoints = (_c = (0, item_1.getPlayerItemSync)(playerId, wrightpieceItemId())) !== null && _c !== void 0 ? _c : 0;
            if (totalCraftPointCost > currentCraftPoints)
                return { kind: "insufficient" };
            const returnItemList = {};
            const newCraftPoints = currentCraftPoints - totalCraftPointCost;
            for (const { equipmentId, upgradeCount, level, stack } of upgrades) {
                (0, equipment_1.updatePlayerEquipmentSync)(playerId, equipmentId, { level: level + upgradeCount, stack: stack - upgradeCount });
                const dissolveInfo = (0, assets_1.getEquipmentDissolveSync)(equipmentId);
                if (dissolveInfo && dissolveInfo.generate_ability_soul) {
                    returnItemList[dissolveInfo.ability_soul_id] = (0, item_1.givePlayerItemSync)(playerId, dissolveInfo.ability_soul_id, upgradeCount);
                }
            }
            recordEquipmentAwakeningProgress(playerId, upgrades.reduce((total, upgrade) => total + upgrade.upgradeCount, 0));
            (0, item_1.updatePlayerItemSync)(playerId, wrightpieceItemId(), newCraftPoints);
            returnItemList[wrightpieceItemId()] = newCraftPoints;
            return { kind: "applied", upgrades, returnItemList, currentCraftPoints, newCraftPoints };
        });
        if (outcome.kind === "empty") {
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                "data": { "equipment_list": [], "item_list": {}, "mail_arrived": false }
            });
        }
        if (outcome.kind === "insufficient") {
            return reply.status(400).send({ "error": "Bad Request", "message": "Not enough craft points." });
        }
        (0, game_logging_1.gameVerboseLog)(() => `[BULK_UPGRADE] account=${accountId} player=${playerId}: ${outcome.upgrades.length} equipment upgraded, craft points ${outcome.currentCraftPoints} -> ${outcome.newCraftPoints}`);
        const returnEquipmentList = (0, equipment_2.buildFullEquipmentList)(playerId);
        reply.header("content-type", "application/x-msgpack");
        const responseData = {
            "equipment_list": returnEquipmentList,
            "item_list": outcome.returnItemList,
            "mail_arrived": false,
        };
        mergeEquipmentDegreeSettlement(responseData, playerId, viewerId);
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": responseData
        });
    }));
    // ── set_protection (equipment lock) ────────────────────────────────
    fastify.post("/set_protection", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId)) {
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid request body." });
        }
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        const player = playerId !== null ? (0, player_1.getPlayerSync)(playerId) : null;
        if (!player)
            return reply.status(500).send({ "error": "Internal Server Error", "message": "No players bound to account." });
        const newProtection = body.protection;
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "equipment_set_protection",
        }, () => {
            for (const equipmentId of body.equipment_ids) {
                if ((0, equipment_1.playerOwnsEquipmentSync)(playerId, equipmentId)) {
                    (0, equipment_1.updatePlayerEquipmentSync)(playerId, equipmentId, { protection: newProtection });
                }
            }
        });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {}
        });
    }));
});
exports.default = routes;
