"use strict";
// Character mana node endpoints — learn and awake
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
const character_1 = require("../../../data/domains/character");
const item_1 = require("../../../data/domains/item");
const player_1 = require("../../../data/domains/player");
const character_awake_1 = require("../../../data/domains/character_awake");
const assets_1 = require("../../../lib/assets");
const character_helpers_1 = require("../../../lib/character-helpers");
const active_mission_counters_1 = require("../../../data/domains/active_mission_counters");
const game_logging_1 = require("../../../lib/game-logging");
const character_awake_evolution_1 = require("../../../lib/character-awake-evolution");
const character_awake_extension_1 = require("../../../lib/character-awake-extension");
const persistence_coordinator_1 = require("../../../lib/persistence-coordinator");
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/learn_mana_node", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const body = request.body;
        const viewerId = body.viewer_id;
        const characterId = body.character_id;
        const toUnlockNodeIds = body.mana_node_multiplied_id_list;
        (0, game_logging_1.gameVerboseLog)(() => `[MANA] learn_mana_node: viewer=${viewerId} char=${characterId} nodes=${JSON.stringify(toUnlockNodeIds)}`);
        if (!viewerId || isNaN(viewerId) || !characterId || isNaN(characterId)
            || !Array.isArray(toUnlockNodeIds) || toUnlockNodeIds.length === 0
            || toUnlockNodeIds.some(nodeId => !Number.isInteger(nodeId)))
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        const sess = yield (0, character_helpers_1.validateSessionAndPlayer)(viewerId, reply);
        if (!sess)
            return reply;
        const { playerId, player } = sess;
        const characterData = (0, character_helpers_1.validateCharacterOwnership)(playerId, characterId, reply);
        if (!characterData)
            return reply;
        // compute the combined cost of each node
        let manaCost = 0;
        const itemsCosts = {};
        const nodesToInsert = [];
        const requestedNodeIds = [...new Set(toUnlockNodeIds)];
        let currentManaNodeIndex = characterData.manaBoardIndex;
        let characterManaNodes = (0, assets_1.getCharacterManaNodesSync)(characterId, currentManaNodeIndex);
        if (!characterManaNodes || requestedNodeIds.some(nodeId => (characterManaNodes === null || characterManaNodes === void 0 ? void 0 : characterManaNodes[nodeId]) === undefined)) {
            const linkedBoardIndex = (0, character_awake_extension_1.resolveLinkedManaNodeBoardIndex)(characterId, requestedNodeIds, characterData.evolutionLevel);
            if (linkedBoardIndex !== null) {
                currentManaNodeIndex = linkedBoardIndex;
                characterManaNodes = (0, assets_1.getCharacterManaNodesSync)(characterId, currentManaNodeIndex);
            }
        }
        if (characterManaNodes === null)
            return reply.status(400).send({
                "error": "Bad Request", "message": `Character does not have mana nodes of index '${currentManaNodeIndex}'.`
            });
        const persistedAwakeLevels = (0, character_1.getPlayerCharacterManaNodeAwakeLevelsSync)(playerId, characterId);
        const unlockedManaNodes = Object.keys(persistedAwakeLevels).map(Number);
        const unlockedManaNodesRecord = {};
        for (const manaNodeId of unlockedManaNodes) {
            unlockedManaNodesRecord[manaNodeId] = true;
        }
        for (const manaNodeId of requestedNodeIds) {
            const nodeData = characterManaNodes[manaNodeId];
            if (nodeData === undefined)
                return reply.status(400).send({
                    "error": "Bad Request", "message": `Mana node '${manaNodeId}' does not exist.`
                });
            // The client can retain a stale learn button after an awakening
            // response updates an already learned, linked board-2 node. Treat
            // the resulting replay as an idempotent state refresh instead of
            // forcing the client back to the login screen with HTTP 400.
            if (unlockedManaNodesRecord[manaNodeId]) {
                continue;
            }
            nodesToInsert.push(manaNodeId);
            if (nodeData !== null) {
                manaCost += nodeData.manaCost;
                for (const [itemId, itemCost] of Object.entries(nodeData.items)) {
                    itemsCosts[itemId] = ((_a = itemsCosts[itemId]) !== null && _a !== void 0 ? _a : 0) + itemCost;
                }
            }
        }
        if (nodesToInsert.length === 0) {
            const finalAwakeLevels = new Map(Object.entries(persistedAwakeLevels).map(([nodeId, level]) => [Number(nodeId), level]));
            const linkedNodeUpdates = characterData.evolutionLevel >= 2
                ? (0, character_awake_extension_1.collectLinkedManaNodeAwakeUpdates)(characterId, new Set(unlockedManaNodes), finalAwakeLevels, characterData.evolutionLevel - 1)
                : [];
            if (linkedNodeUpdates.length > 0) {
                yield (0, persistence_coordinator_1.runPersistenceTransaction)({
                    domain: "player", playerId, operation: "repair_mana_node_awake_levels",
                }, () => {
                    for (const update of linkedNodeUpdates) {
                        (0, character_1.updatePlayerCharacterManaNodeAwakeLevelSync)(playerId, characterId, update.nodeId, update.awakeLevel);
                        finalAwakeLevels.set(update.nodeId, update.awakeLevel);
                    }
                });
            }
            const authoritativeManaNodeList = unlockedManaNodes.map(nodeId => {
                var _a;
                return ({
                    "multiplied_id": nodeId,
                    "awake_level": (_a = finalAwakeLevels.get(nodeId)) !== null && _a !== void 0 ? _a : 0,
                });
            });
            const manaBoardAwake = (0, character_helpers_1.computeManaBoardAwakeFromNodes)({
                [String(characterId)]: Object.fromEntries(finalAwakeLevels),
            }).get(String(characterId));
            const immediateManaBoardAwake = (0, character_awake_extension_1.deferLinkedManaBoardAwakeLevels)(characterId, manaBoardAwake);
            (0, game_logging_1.gameVerboseLog)(() => `[MANA] learn_mana_node: replayed=${requestedNodeIds.length}, repaired=${linkedNodeUpdates.length}, returning current state`);
            return (0, character_helpers_1.sendCharacterResponse)(reply, viewerId, {
                user_info: { free_mana: player.freeMana, paid_mana: player.paidMana },
                character_list: [(0, character_helpers_1.buildCharacterListEntry)(characterId, characterData, Object.assign(Object.assign({}, (immediateManaBoardAwake ? { mana_board_awake: immediateManaBoardAwake } : {})), { mana_board_index: characterData.manaBoardIndex, bond_token_list: characterData.bondTokenList.map(token => ({
                            mana_board_index: token.manaBoardIndex,
                            status: token.status,
                        })) }))],
                user_character_mana_node_list: { [String(characterId)]: authoritativeManaNodeList },
                item_list: {},
                evolution: [],
                mail_arrived: false,
            }, playerId);
        }
        // Deduct mana
        const manaResult = (0, character_helpers_1.computeManaDeduction)(player, manaCost);
        if (!manaResult)
            return reply.status(400).send({ "error": "Bad Request", "message": "Not enough mana." });
        const { newFreeMana, newPaidMana } = manaResult;
        // Deduct items
        const itemResult = (0, character_helpers_1.computeItemDeductions)(playerId, itemsCosts, reply);
        if (!itemResult)
            return reply;
        const newItemAmounts = itemResult;
        let characterEvolutionLevel = characterData.evolutionLevel;
        let evolutionData = [];
        let bondTokenList = [];
        const finalAwakeLevels = new Map(Object.entries(persistedAwakeLevels).map(([nodeId, level]) => [Number(nodeId), level]));
        let linkedNodeUpdates = [];
        const learnedAfterRequest = new Set(unlockedManaNodes);
        for (const manaNodeId of nodesToInsert)
            learnedAfterRequest.add(manaNodeId);
        const isBoardComplete = Object.keys(characterManaNodes)
            .every(manaNodeId => learnedAfterRequest.has(Number(manaNodeId)));
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "learn_mana_node",
        }, () => {
            (0, player_1.updatePlayerSync)({ id: playerId, freeMana: newFreeMana, paidMana: newPaidMana });
            if (currentManaNodeIndex !== characterData.manaBoardIndex) {
                (0, character_1.updatePlayerCharacterSync)(playerId, characterId, { manaBoardIndex: currentManaNodeIndex });
            }
            (0, active_mission_counters_1.incrementActiveMissionUsedManaCountSync)(playerId, manaCost);
            for (const [itemId, newAmount] of Object.entries(newItemAmounts)) {
                (0, item_1.updatePlayerItemSync)(playerId, itemId, newAmount);
            }
            (0, character_1.insertPlayerCharacterManaNodesSync)(playerId, characterId, nodesToInsert);
            const bond = (0, character_helpers_1.computeBondTokenAndEvolution)(playerId, characterId, characterData, currentManaNodeIndex, isBoardComplete);
            characterEvolutionLevel = bond.characterEvolutionLevel;
            evolutionData = bond.evolutionData;
            bondTokenList = bond.bondTokenList;
            if (characterEvolutionLevel >= 2) {
                linkedNodeUpdates = (0, character_awake_extension_1.collectLinkedManaNodeAwakeUpdates)(characterId, learnedAfterRequest, finalAwakeLevels, characterEvolutionLevel - 1);
                for (const update of linkedNodeUpdates) {
                    (0, character_1.updatePlayerCharacterManaNodeAwakeLevelSync)(playerId, characterId, update.nodeId, update.awakeLevel);
                    finalAwakeLevels.set(update.nodeId, update.awakeLevel);
                }
            }
        });
        const authoritativeManaNodeList = [...learnedAfterRequest].map(nodeId => {
            var _a;
            return ({
                "multiplied_id": nodeId,
                "awake_level": (_a = finalAwakeLevels.get(nodeId)) !== null && _a !== void 0 ? _a : 0,
            });
        });
        const manaBoardAwake = (0, character_helpers_1.computeManaBoardAwakeFromNodes)({
            [String(characterId)]: Object.fromEntries(finalAwakeLevels),
        }).get(String(characterId));
        const immediateManaBoardAwake = (0, character_awake_extension_1.deferLinkedManaBoardAwakeLevels)(characterId, manaBoardAwake);
        const responseBondTokenList = bondTokenList.length > 0
            ? bondTokenList
            : characterData.bondTokenList.map(token => ({
                mana_board_index: token.manaBoardIndex,
                status: token.status,
            }));
        (0, game_logging_1.gameVerboseLog)(() => `[MANA] learn_mana_node done: board=${currentManaNodeIndex} inserted=${nodesToInsert.length} replayed=${requestedNodeIds.length - nodesToInsert.length} boardComplete=${isBoardComplete} linkedAwake=${linkedNodeUpdates.length} bondGiven=${!!bondTokenList.length} evoLevel=${characterEvolutionLevel}`);
        return (0, character_helpers_1.sendCharacterResponse)(reply, viewerId, {
            user_info: { free_mana: newFreeMana, paid_mana: newPaidMana },
            character_list: [(0, character_helpers_1.buildCharacterListEntry)(characterId, characterData, Object.assign(Object.assign({}, (immediateManaBoardAwake ? { mana_board_awake: immediateManaBoardAwake } : {})), { mana_board_index: currentManaNodeIndex, evolution_level: characterEvolutionLevel, evolution_img_level: characterEvolutionLevel, bond_token_list: responseBondTokenList }))],
            user_character_mana_node_list: { [String(characterId)]: authoritativeManaNodeList },
            item_list: newItemAmounts,
            evolution: evolutionData,
            mail_arrived: false,
        }, playerId);
    }));
    fastify.post("/awake_mana_node", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _b, _c, _d, _e;
        const body = request.body;
        const viewerId = body.viewer_id;
        const characterId = body.character_id;
        const toAwakenNodeIds = body.mana_node_multiplied_id_list;
        const targetAwakeLevel = body.awake_level;
        (0, game_logging_1.gameVerboseLog)(() => `[MANA] awake_mana_node: viewer=${viewerId} char=${characterId} nodes=${JSON.stringify(toAwakenNodeIds)} level=${targetAwakeLevel}`);
        if (!viewerId || isNaN(viewerId) || !characterId || isNaN(characterId) || !toAwakenNodeIds || !targetAwakeLevel)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        const sess = yield (0, character_helpers_1.validateSessionAndPlayer)(viewerId, reply);
        if (!sess)
            return reply;
        const { playerId, player } = sess;
        const characterData = (0, character_helpers_1.validateCharacterOwnership)(playerId, characterId, reply);
        if (!characterData)
            return reply;
        const board1Nodes = (0, assets_1.getCharacterManaNodesSync)(characterId, 1);
        if (!board1Nodes)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Character does not have an awake mana board."
            });
        const board1NodeIds = Object.keys(board1Nodes).map(Number);
        const charAwakeLevels = (0, character_1.getPlayerCharacterManaNodeAwakeLevelsSync)(playerId, characterId);
        const persistedUnlockLevel = (_c = (_b = (0, character_awake_1.getPlayerCharacterAwakeUnlocksByCharacterIdsSync)(playerId, [characterId])
            .get(String(characterId))) === null || _b === void 0 ? void 0 : _b[1]) !== null && _c !== void 0 ? _c : 0;
        const existingNodeAwakeLevel = Object.values(charAwakeLevels)
            .reduce((highest, level) => Math.max(highest, level !== null && level !== void 0 ? level : 0), 0);
        // Existing awakened nodes remain valid for legacy saves, but new
        // awakening is never authorized before the base board is complete.
        const expectedAwakeLevel = Math.max(persistedUnlockLevel, existingNodeAwakeLevel);
        const learnedNodeIds = Object.keys(charAwakeLevels).map(Number);
        const validationError = (0, character_helpers_1.validateManaBoardAwakeRequest)(toAwakenNodeIds, targetAwakeLevel, expectedAwakeLevel, board1NodeIds, learnedNodeIds);
        if (validationError)
            return reply.status(400).send({
                "error": "Bad Request", "message": validationError
            });
        // Compute costs for each awakening node
        let manaCost = 0;
        const itemsCosts = {};
        const nodeUpdates = [];
        const finalAwakeLevels = new Map(Object.entries(charAwakeLevels).map(([nodeId, level]) => [Number(nodeId), level]));
        const learnedNodeSet = new Set(learnedNodeIds);
        // Cache character rarity outside the loop
        const charAssetData = (0, assets_1.getCharacterDataSync)(characterId);
        if (charAssetData === null)
            return reply.status(400).send({
                "error": "Bad Request", "message": `Character asset data not found for ID ${characterId}.`
            });
        const rarity = charAssetData.rarity;
        for (const manaNodeId of toAwakenNodeIds) {
            if (!learnedNodeSet.has(manaNodeId))
                return reply.status(400).send({
                    "error": "Bad Request", "message": `Mana node '${manaNodeId}' is not unlocked.`
                });
            const currentAwakeLevel = (_d = charAwakeLevels[manaNodeId]) !== null && _d !== void 0 ? _d : 0;
            if (currentAwakeLevel >= targetAwakeLevel) {
                continue;
            }
            const cost = (0, assets_1.getManaNodeAwakeCost)(characterId, manaNodeId, rarity);
            if (cost === null)
                return reply.status(400).send({
                    "error": "Bad Request", "message": `No awake cost found for node '${manaNodeId}' (rarity=${rarity}).`
                });
            manaCost += cost.manaAmount;
            for (const [itemId, itemCost] of Object.entries(cost.items)) {
                itemsCosts[itemId] = ((_e = itemsCosts[itemId]) !== null && _e !== void 0 ? _e : 0) + itemCost;
            }
            nodeUpdates.push({ nodeId: manaNodeId, awakeLevel: targetAwakeLevel });
            finalAwakeLevels.set(manaNodeId, targetAwakeLevel);
        }
        const characterEvolutionLevel = (0, character_awake_evolution_1.deriveAwakeEvolutionLevel)(characterData.evolutionLevel, board1Nodes, finalAwakeLevels);
        const linkedNodeUpdates = characterEvolutionLevel >= 2
            ? (0, character_awake_extension_1.collectLinkedManaNodeAwakeUpdates)(characterId, learnedNodeSet, finalAwakeLevels, characterEvolutionLevel - 1)
            : [];
        for (const update of linkedNodeUpdates) {
            finalAwakeLevels.set(update.nodeId, update.awakeLevel);
        }
        // The awake endpoint is handled as an authoritative character refresh
        // by the client. Return every learned node, not only the rows whose
        // awake level changed, so already learned board-2 nodes cannot reappear
        // as learnable after their linked ability is awakened.
        const authoritativeManaNodeList = learnedNodeIds.map(nodeId => {
            var _a;
            return ({
                "multiplied_id": nodeId,
                "awake_level": (_a = finalAwakeLevels.get(nodeId)) !== null && _a !== void 0 ? _a : 0,
            });
        });
        const manaBoardAwake = (0, character_helpers_1.computeManaBoardAwakeFromNodes)({
            [String(characterId)]: Object.fromEntries(finalAwakeLevels),
        }).get(String(characterId));
        const immediateManaBoardAwake = (0, character_awake_extension_1.deferLinkedManaBoardAwakeLevels)(characterId, manaBoardAwake);
        const hasStateUpdates = nodeUpdates.length > 0
            || linkedNodeUpdates.length > 0
            || characterEvolutionLevel !== characterData.evolutionLevel;
        // All nodes already at target — return current state
        if (manaCost === 0 && !hasStateUpdates) {
            (0, game_logging_1.gameVerboseLog)(() => `[MANA] awake_mana_node: all nodes at level ${targetAwakeLevel}, returning current state`);
            return (0, character_helpers_1.sendCharacterResponse)(reply, viewerId, {
                user_info: { free_mana: player.freeMana, paid_mana: player.paidMana },
                character_list: [(0, character_helpers_1.buildCharacterListEntry)(characterId, characterData, Object.assign(Object.assign({}, (immediateManaBoardAwake ? { mana_board_awake: immediateManaBoardAwake } : {})), { mana_board_index: characterData.manaBoardIndex, evolution_level: characterEvolutionLevel, evolution_img_level: characterEvolutionLevel, bond_token_list: (characterData.bondTokenList || []).map((e) => ({ mana_board_index: e.manaBoardIndex, status: e.status })) }))],
                user_character_mana_node_list: { [String(characterId)]: authoritativeManaNodeList },
                item_list: {},
                evolution: [],
                mail_arrived: false,
            }, playerId);
        }
        // Deduct mana
        const manaResult = (0, character_helpers_1.computeManaDeduction)(player, manaCost);
        if (!manaResult)
            return reply.status(400).send({ "error": "Bad Request", "message": "Not enough mana." });
        const { newFreeMana, newPaidMana } = manaResult;
        // Deduct items
        const itemResult = (0, character_helpers_1.computeItemDeductions)(playerId, itemsCosts, reply);
        if (!itemResult)
            return reply;
        const newItemAmounts = itemResult;
        // Apply every state change atomically. An unexpected write failure must
        // not leave mana/items deducted without the corresponding node level.
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "awake_mana_node",
        }, () => {
            (0, player_1.updatePlayerSync)({ id: playerId, freeMana: newFreeMana, paidMana: newPaidMana });
            (0, active_mission_counters_1.incrementActiveMissionUsedManaCountSync)(playerId, manaCost);
            for (const [itemId, newAmount] of Object.entries(newItemAmounts)) {
                (0, item_1.updatePlayerItemSync)(playerId, itemId, newAmount);
            }
            for (const update of [...nodeUpdates, ...linkedNodeUpdates]) {
                (0, character_1.updatePlayerCharacterManaNodeAwakeLevelSync)(playerId, characterId, update.nodeId, update.awakeLevel);
            }
            if (characterEvolutionLevel !== characterData.evolutionLevel) {
                (0, character_1.updatePlayerCharacterSync)(playerId, characterId, {
                    evolutionLevel: characterEvolutionLevel,
                });
            }
        });
        (0, game_logging_1.gameVerboseLog)(() => `[MANA] awake_mana_node done: manaCost=${manaCost} nodes=${toAwakenNodeIds.length} manaBoardAwake=${!!manaBoardAwake}`);
        return (0, character_helpers_1.sendCharacterResponse)(reply, viewerId, {
            user_info: { free_mana: newFreeMana, paid_mana: newPaidMana },
            character_list: [(0, character_helpers_1.buildCharacterListEntry)(characterId, characterData, Object.assign(Object.assign({}, (immediateManaBoardAwake ? { mana_board_awake: immediateManaBoardAwake } : {})), { mana_board_index: characterData.manaBoardIndex, evolution_level: characterEvolutionLevel, evolution_img_level: characterEvolutionLevel, bond_token_list: (characterData.bondTokenList || []).map((e) => ({ mana_board_index: e.manaBoardIndex, status: e.status })) }))],
            user_character_mana_node_list: { [String(characterId)]: authoritativeManaNodeList },
            item_list: newItemAmounts,
            evolution: characterEvolutionLevel > characterData.evolutionLevel
                ? { "character_id": characterId, "level": characterEvolutionLevel, "img_level": characterEvolutionLevel }
                : [],
            mail_arrived: false,
        }, playerId);
    }));
});
exports.default = routes;
