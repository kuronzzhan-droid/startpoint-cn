"use strict";
// Character endpoint shared helpers — session validation, mana/item deduction
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
exports.computeManaBoardAwakeFromNodes = exports.sendCharacterResponse = exports.reconcilePlayerManaBoardCompletionSync = exports.computeBondTokenAndEvolution = exports.validateCompatibleManaBoardAwakeRequest = exports.validateManaBoardAwakeRequest = exports.filterCharacterManaBoardAwakeLevels = exports.isManaBoardComplete = exports.buildScopedManaBoardAwakeCharacterList = exports.buildManaBoardAwakeCharacterList = exports.mergeManaBoardAwakeMaps = exports.buildCharacterListEntry = exports.computeItemDeductions = exports.computeManaDeduction = exports.validateCharacterOwnership = exports.validateSessionAndPlayer = void 0;
const player_1 = require("../data/domains/player");
const character_1 = require("../data/domains/character");
const session_1 = require("../data/domains/session");
const activeAccount_1 = require("../data/activeAccount");
const item_1 = require("../data/domains/item");
const persistence_coordinator_1 = require("./persistence-coordinator");
const utils_1 = require("../utils");
const utils_2 = require("../data/utils");
const assets_1 = require("./assets");
const degree_response_1 = require("./mission/degree-response");
/** Validates session + player existence. Sends 400/500 on failure. */
function validateSessionAndPlayer(viewerId, reply) {
    return __awaiter(this, void 0, void 0, function* () {
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session) {
            reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." });
            return null;
        }
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        const player = (0, player_1.getPlayerSync)(playerId);
        if (!player) {
            reply.status(500).send({ "error": "Internal Server Error", "message": "No players bound to account." });
            return null;
        }
        return { viewerId, playerId, player };
    });
}
exports.validateSessionAndPlayer = validateSessionAndPlayer;
/** Validates character ownership. Sends 400 on failure. */
function validateCharacterOwnership(playerId, characterId, reply) {
    const characterData = (0, character_1.getPlayerCharacterSync)(playerId, characterId);
    if (!characterData) {
        reply.status(400).send({ "error": "Bad Request", "message": "Character not owned." });
        return null;
    }
    return characterData;
}
exports.validateCharacterOwnership = validateCharacterOwnership;
// ─── Mana deduction ───
function computeManaDeduction(player, manaCost) {
    let remaining = manaCost;
    let newFreeMana = player.freeMana;
    let newPaidMana = player.paidMana;
    if (remaining <= newFreeMana) {
        newFreeMana -= remaining;
    }
    else {
        remaining -= newFreeMana;
        newFreeMana = 0;
        newPaidMana -= remaining;
    }
    if (newFreeMana < 0 || newPaidMana < 0)
        return null;
    return { newFreeMana, newPaidMana };
}
exports.computeManaDeduction = computeManaDeduction;
// ─── Item deduction ───
/** Validates item availability and computes remaining amounts. Returns null on insufficient. */
function computeItemDeductions(playerId, itemsCosts, reply) {
    const result = {};
    for (const [itemId, itemCost] of Object.entries(itemsCosts)) {
        const item = (0, item_1.getPlayerItemSync)(playerId, itemId);
        const newAmount = (item !== null && item !== void 0 ? item : 0) - itemCost;
        if (newAmount < 0) {
            reply.status(400).send({ "error": "Bad Request", "message": `Not enough of item with id ${itemId}` });
            return null;
        }
        result[itemId] = newAmount;
    }
    return result;
}
exports.computeItemDeductions = computeItemDeductions;
// ─── Response builders ───
/** Builds the standard character_list entry for mana-related responses. */
function buildCharacterListEntry(characterId, characterData, extras = {}) {
    return Object.assign({ character_id: characterId, evolution_level: characterData.evolutionLevel, evolution_img_level: characterData.evolutionLevel, create_time: (0, utils_2.clientSerializeDate)(characterData.joinTime), update_time: (0, utils_2.clientSerializeDate)(characterData.updateTime), join_time: (0, utils_2.clientSerializeDate)(characterData.joinTime), bond_token_list: [] }, extras);
}
exports.buildCharacterListEntry = buildCharacterListEntry;
/** Merges mission-unlocked and persisted mana-board awake levels. */
function mergeManaBoardAwakeMaps(...maps) {
    var _a, _b;
    const merged = new Map();
    for (const map of maps) {
        for (const [characterId, boardLevels] of map) {
            const current = (_a = merged.get(characterId)) !== null && _a !== void 0 ? _a : {};
            for (const [boardIndex, awakeLevel] of Object.entries(boardLevels)) {
                const index = Number(boardIndex);
                current[index] = Math.max((_b = current[index]) !== null && _b !== void 0 ? _b : 0, awakeLevel);
            }
            merged.set(characterId, current);
        }
    }
    return merged;
}
exports.mergeManaBoardAwakeMaps = mergeManaBoardAwakeMaps;
/** Builds the minimal common-response entries needed to refresh Awake unlocks. */
function buildManaBoardAwakeCharacterList(characters, manaBoardAwakeMap, learnedManaNodes) {
    var _a;
    const result = [];
    for (const [characterId, manaBoardAwake] of manaBoardAwakeMap) {
        const character = characters[characterId];
        if (!character)
            continue;
        const visibleAwakeLevels = filterCharacterManaBoardAwakeLevels(Number(characterId), manaBoardAwake, (_a = learnedManaNodes[characterId]) !== null && _a !== void 0 ? _a : []);
        if (Object.keys(visibleAwakeLevels).length === 0)
            continue;
        result.push({
            character_id: Number(characterId),
            // Every entry in a common-response character_list must carry
            // entry_count. The 1.8.1 client rejects otherwise-valid partial
            // Awake refresh entries with C2274 before it can apply the reward.
            entry_count: character.entryCount,
            exp: character.exp,
            join_time: (0, utils_2.clientSerializeDate)(character.joinTime),
            update_time: (0, utils_2.clientSerializeDate)(character.updateTime),
            mana_board_awake: visibleAwakeLevels,
        });
    }
    return result;
}
exports.buildManaBoardAwakeCharacterList = buildManaBoardAwakeCharacterList;
/** Builds Awake common-response entries without scanning the full roster. */
function buildScopedManaBoardAwakeCharacterList(playerId, manaBoardAwakeMap) {
    const characterIds = [...manaBoardAwakeMap.keys()].map(Number).filter(characterId => Number.isSafeInteger(characterId) && characterId > 0);
    if (characterIds.length === 0)
        return [];
    return buildManaBoardAwakeCharacterList((0, character_1.getPlayerCharactersByIdsSync)(playerId, characterIds), manaBoardAwakeMap, (0, character_1.getPlayerCharactersManaNodesByIdsSync)(playerId, characterIds));
}
exports.buildScopedManaBoardAwakeCharacterList = buildScopedManaBoardAwakeCharacterList;
function isManaBoardComplete(characterId, boardIndex, learnedNodeIds) {
    const boardNodes = (0, assets_1.getCharacterManaNodesSync)(characterId, boardIndex);
    if (!boardNodes || Object.keys(boardNodes).length === 0)
        return false;
    const learned = new Set(learnedNodeIds);
    return Object.keys(boardNodes).every(nodeId => learned.has(Number(nodeId)));
}
exports.isManaBoardComplete = isManaBoardComplete;
/**
 * `mana_board_awake` is also the client's target node level. Publishing it
 * before the base board is complete replaces normal nodes with awake nodes.
 */
function filterCharacterManaBoardAwakeLevels(characterId, levels, learnedNodeIds) {
    const filtered = {};
    for (const [boardIndexText, awakeLevel] of Object.entries(levels)) {
        const boardIndex = Number(boardIndexText);
        if (!Number.isSafeInteger(boardIndex) || boardIndex <= 0 || awakeLevel <= 0)
            continue;
        if (!isManaBoardComplete(characterId, boardIndex, learnedNodeIds))
            continue;
        filtered[boardIndex] = awakeLevel;
    }
    return filtered;
}
exports.filterCharacterManaBoardAwakeLevels = filterCharacterManaBoardAwakeLevels;
function validateManaBoardAwakeRequest(requestedNodeIds, targetAwakeLevel, unlockedAwakeLevel, boardNodeIds, learnedNodeIds) {
    if (!Array.isArray(requestedNodeIds) || requestedNodeIds.length === 0
        || requestedNodeIds.some(nodeId => !Number.isInteger(nodeId))
        || new Set(requestedNodeIds).size !== requestedNodeIds.length) {
        return "Invalid mana node list.";
    }
    if (unlockedAwakeLevel <= 0)
        return "Awake missions are not complete.";
    if (!Number.isInteger(targetAwakeLevel) || targetAwakeLevel !== unlockedAwakeLevel) {
        return "Invalid awake level.";
    }
    const learned = new Set(learnedNodeIds);
    if (boardNodeIds.some(nodeId => !learned.has(nodeId))) {
        return "Base mana board is not complete.";
    }
    const board = new Set(boardNodeIds);
    if (requestedNodeIds.some(nodeId => !board.has(nodeId))) {
        return "Mana node is outside the awake board.";
    }
    return null;
}
exports.validateManaBoardAwakeRequest = validateManaBoardAwakeRequest;
// ─── Bond token + evolution ───
/**
 * Validates the client-controlled portion of an awake-node request without
 * reintroducing strict retail progression gates. The private-server build
 * accepts an existing node-awake level as legacy authorization, while still
 * rejecting malformed lists, nodes from another board, and arbitrary jumps.
 */
function validateCompatibleManaBoardAwakeRequest(requestedNodeIds, targetAwakeLevel, expectedAwakeLevel, boardNodeIds) {
    if (!Array.isArray(requestedNodeIds) || requestedNodeIds.length === 0
        || requestedNodeIds.some(nodeId => !Number.isInteger(nodeId))
        || new Set(requestedNodeIds).size !== requestedNodeIds.length) {
        return "Invalid mana node list.";
    }
    if (!Number.isInteger(targetAwakeLevel) || targetAwakeLevel !== expectedAwakeLevel) {
        return "Invalid awake level.";
    }
    const board = new Set(boardNodeIds);
    if (requestedNodeIds.some(nodeId => !board.has(nodeId))) {
        return "Mana node is outside the awake board.";
    }
    return null;
}
exports.validateCompatibleManaBoardAwakeRequest = validateCompatibleManaBoardAwakeRequest;
/**
 * Checks board completion and handles bond token grant + first evolution.
 * Used by both /learn_mana_node and /awake_mana_node.
 *
 * @param boardIndex — the mana board index being processed (1 for awake, currentManaNodeIndex for learn)
 */
function computeBondTokenAndEvolution(playerId, characterId, characterData, boardIndex, isBoardComplete) {
    var _a;
    let characterEvolutionLevel = characterData.evolutionLevel;
    let evolutionData = [];
    const bondTokenList = [];
    const boardCount = (0, assets_1.getCharacterManaBoardCountSync)(characterId);
    const tokenByBoard = new Map(characterData.bondTokenList.map(token => [token.manaBoardIndex, token]));
    for (let index = 1; index <= boardCount; index++) {
        if (tokenByBoard.has(index))
            continue;
        const token = { manaBoardIndex: index, status: 0 };
        (0, character_1.insertPlayerCharacterBondTokenSync)(playerId, characterId, token);
        tokenByBoard.set(index, token);
        characterData.bondTokenList.push(token);
    }
    characterData.bondTokenList.sort((left, right) => left.manaBoardIndex - right.manaBoardIndex);
    if (((_a = tokenByBoard.get(boardIndex)) === null || _a === void 0 ? void 0 : _a.status) === 0 && isBoardComplete) {
        (0, character_1.updatePlayerCharacterBondTokenSync)(playerId, characterId, { manaBoardIndex: boardIndex, status: 1 });
        for (const entry of characterData.bondTokenList) {
            bondTokenList.push({
                "mana_board_index": entry.manaBoardIndex,
                "status": entry.manaBoardIndex === boardIndex ? 1 : entry.status,
            });
        }
        if (characterEvolutionLevel === 0) {
            characterEvolutionLevel = 1;
            (0, character_1.updatePlayerCharacterSync)(playerId, characterId, { evolutionLevel: characterEvolutionLevel });
            evolutionData = { "character_id": characterId, "level": 1, "img_level": 1 };
        }
    }
    return { characterEvolutionLevel, evolutionData, bondTokenList };
}
exports.computeBondTokenAndEvolution = computeBondTokenAndEvolution;
/**
 * Repairs old/imported saves that have complete mana boards but are missing
 * their receivable bond-token row or first-board evolution marker.
 */
function reconcilePlayerManaBoardCompletionSync(playerId, candidateCharacterIds, snapshot) {
    var _a, _b;
    const characters = (_a = snapshot === null || snapshot === void 0 ? void 0 : snapshot.characters) !== null && _a !== void 0 ? _a : (0, character_1.getPlayerCharactersSync)(playerId);
    const learnedNodes = (_b = snapshot === null || snapshot === void 0 ? void 0 : snapshot.learnedNodes) !== null && _b !== void 0 ? _b : (0, character_1.getPlayerCharactersManaNodesSync)(playerId);
    const candidates = candidateCharacterIds ? new Set(candidateCharacterIds.map(String)) : null;
    const repairedCharacterIds = new Set();
    const evolutionCharacterIds = new Set();
    // Read-only pass first: a fully repaired save opens no write transaction.
    // The write pass below re-evaluates every board, so both passes agree.
    const needsRepair = Object.entries(characters).some(([characterIdText, character]) => {
        var _a;
        if (candidates && !candidates.has(characterIdText))
            return false;
        const characterId = Number(characterIdText);
        const boardCount = (0, assets_1.getCharacterManaBoardCountSync)(characterId);
        if (boardCount <= 0)
            return false;
        const tokenByBoard = new Map(character.bondTokenList.map(token => [token.manaBoardIndex, token]));
        for (let boardIndex = 1; boardIndex <= boardCount; boardIndex++) {
            const token = tokenByBoard.get(boardIndex);
            if (!token)
                return true;
            if (token.status === 0
                && isManaBoardComplete(characterId, boardIndex, (_a = learnedNodes[characterIdText]) !== null && _a !== void 0 ? _a : []))
                return true;
        }
        return false;
    });
    if (!needsRepair)
        return { repairedCharacterIds: [], evolutionCharacterIds: [] };
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "player", playerId, operation: "reconcile_mana_board_completion",
    }, () => {
        var _a;
        for (const [characterIdText, character] of Object.entries(characters)) {
            if (candidates && !candidates.has(characterIdText))
                continue;
            const characterId = Number(characterIdText);
            const boardCount = (0, assets_1.getCharacterManaBoardCountSync)(characterId);
            if (boardCount <= 0)
                continue;
            const tokenByBoard = new Map(character.bondTokenList.map(token => [token.manaBoardIndex, token]));
            for (let boardIndex = 1; boardIndex <= boardCount; boardIndex++) {
                let token = tokenByBoard.get(boardIndex);
                if (!token) {
                    token = { manaBoardIndex: boardIndex, status: 0 };
                    (0, character_1.insertPlayerCharacterBondTokenSync)(playerId, characterId, token);
                    tokenByBoard.set(boardIndex, token);
                    repairedCharacterIds.add(characterId);
                }
                if (token.status === 0
                    && isManaBoardComplete(characterId, boardIndex, (_a = learnedNodes[characterIdText]) !== null && _a !== void 0 ? _a : [])) {
                    (0, character_1.updatePlayerCharacterBondTokenSync)(playerId, characterId, { manaBoardIndex: boardIndex, status: 1 });
                    token.status = 1;
                    repairedCharacterIds.add(characterId);
                    if (boardIndex === 1 && character.evolutionLevel === 0) {
                        (0, character_1.updatePlayerCharacterSync)(playerId, characterId, { evolutionLevel: 1 });
                        character.evolutionLevel = 1;
                        evolutionCharacterIds.add(characterId);
                    }
                }
            }
        }
    });
    return {
        repairedCharacterIds: [...repairedCharacterIds],
        evolutionCharacterIds: [...evolutionCharacterIds],
    };
}
exports.reconcilePlayerManaBoardCompletionSync = reconcilePlayerManaBoardCompletionSync;
/** Sends a standard-format mana-related response. */
function sendCharacterResponse(reply, viewerId, data, playerId) {
    var _a;
    if (playerId !== undefined) {
        const changedCharacterIds = ((_a = data.character_list) !== null && _a !== void 0 ? _a : [])
            .map(character => Number(character === null || character === void 0 ? void 0 : character.character_id))
            .filter(characterId => Number.isFinite(characterId) && characterId > 0);
        (0, degree_response_1.settleDegreeMissionResponse)(playerId, viewerId, data, undefined, [7, 8, 44, 48], changedCharacterIds);
    }
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({
        "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
        "data": data,
    });
}
exports.sendCharacterResponse = sendCharacterResponse;
// ─── Mana board awake level computation ───
/** Computes persisted mana-board awake levels from node state. */
function computeManaBoardAwakeFromNodes(characterManaNodeAwakeLevels) {
    var _a;
    const result = new Map();
    for (const [charId, nodeLevels] of Object.entries(characterManaNodeAwakeLevels)) {
        const characterId = Number(charId);
        const boardCount = (0, assets_1.getCharacterManaBoardCountSync)(characterId);
        const completedBoards = {};
        for (let boardIndex = 1; boardIndex <= boardCount; boardIndex++) {
            const boardNodes = (0, assets_1.getCharacterManaNodesSync)(characterId, boardIndex);
            if (!boardNodes)
                continue;
            const boardNodeIds = Object.keys(boardNodes).map(Number);
            if (boardNodeIds.length === 0)
                continue;
            let completedAwakeLevel = Number.POSITIVE_INFINITY;
            for (const nodeId of boardNodeIds) {
                completedAwakeLevel = Math.min(completedAwakeLevel, (_a = nodeLevels[nodeId]) !== null && _a !== void 0 ? _a : 0);
            }
            if (Number.isFinite(completedAwakeLevel) && completedAwakeLevel > 0) {
                completedBoards[boardIndex] = completedAwakeLevel;
            }
        }
        if (Object.keys(completedBoards).length > 0)
            result.set(charId, completedBoards);
    }
    return result;
}
exports.computeManaBoardAwakeFromNodes = computeManaBoardAwakeFromNodes;
