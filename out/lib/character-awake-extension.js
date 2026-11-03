"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectLinkedManaNodeAwakeUpdates = exports.resolveLinkedManaNodeBoardIndex = exports.deferLinkedManaBoardAwakeLevels = void 0;
const character_awake_extension_json_1 = __importDefault(require("../../assets/character_awake_extension.json"));
const assets_1 = require("./assets");
const awakeExtensions = character_awake_extension_json_1.default;
/**
 * Hides linked extension boards from an incremental mana response.
 *
 * The 1.8.1 client's common-response parser applies `mana_board_awake` but
 * ignores `user_character_mana_node_list`. Publishing a linked board here
 * therefore switches the board to Awake mode while its local node levels are
 * still stale. Keep the persisted state server-side and expose it on the next
 * full `/load`, where character and mana-node state are initialized together.
 */
function deferLinkedManaBoardAwakeLevels(characterId, levels) {
    if (!levels)
        return undefined;
    const extension = getExtension(characterId);
    if (!extension)
        return levels;
    const deferredBoards = new Set(extension.linked_mana_node_slots.map(link => link.board_index));
    const immediate = {};
    for (const [boardIndexText, awakeLevel] of Object.entries(levels)) {
        const boardIndex = Number(boardIndexText);
        if (deferredBoards.has(boardIndex))
            continue;
        immediate[boardIndex] = awakeLevel;
    }
    return Object.keys(immediate).length > 0 ? immediate : undefined;
}
exports.deferLinkedManaBoardAwakeLevels = deferLinkedManaBoardAwakeLevels;
function getExtension(characterId) {
    var _a;
    return (_a = awakeExtensions[String(characterId)]) !== null && _a !== void 0 ? _a : null;
}
/**
 * Resolves a configured extension board for a learn request when the player's
 * persisted current board still points at the official awakening board.
 */
function resolveLinkedManaNodeBoardIndex(characterId, nodeIds, evolutionLevel) {
    const extension = getExtension(characterId);
    if (!extension || evolutionLevel < 2 || nodeIds.length === 0)
        return null;
    const boardIndices = new Set(extension.linked_mana_node_slots.map(link => link.board_index));
    for (const boardIndex of boardIndices) {
        const boardNodes = (0, assets_1.getCharacterManaNodesSync)(characterId, boardIndex);
        if (!boardNodes)
            continue;
        if (nodeIds.every(nodeId => boardNodes[String(nodeId)] !== undefined))
            return boardIndex;
    }
    return null;
}
exports.resolveLinkedManaNodeBoardIndex = resolveLinkedManaNodeBoardIndex;
/**
 * Builds free whole-board updates when an awakened design changes an ability
 * stored on a later mana board.
 *
 * The client has one learn mode per board, not per ability. Mixing awake nodes
 * with normal nodes on the same board makes an already learned node appear as
 * a lower normal upgrade. Keep an incomplete extension board entirely normal;
 * once it is complete, advance every node together so the board mode and all
 * persisted node levels stay coherent.
 */
function collectLinkedManaNodeAwakeUpdates(characterId, learnedNodeIds, currentAwakeLevels, targetAwakeLevel) {
    var _a, _b;
    const extension = getExtension(characterId);
    if (!extension || targetAwakeLevel <= 0)
        return [];
    const updates = [];
    const boardAwakeLevels = new Map();
    for (const link of extension.linked_mana_node_slots) {
        const linkedAwakeLevel = Math.min(targetAwakeLevel, link.awake_level);
        boardAwakeLevels.set(link.board_index, Math.max((_a = boardAwakeLevels.get(link.board_index)) !== null && _a !== void 0 ? _a : 0, linkedAwakeLevel));
    }
    for (const [boardIndex, boardAwakeLevel] of boardAwakeLevels) {
        if (boardAwakeLevel <= 0)
            continue;
        const boardNodes = (0, assets_1.getCharacterManaNodesSync)(characterId, boardIndex);
        if (!boardNodes)
            continue;
        const boardNodeIds = Object.keys(boardNodes).map(Number);
        if (!boardNodeIds.every(nodeId => learnedNodeIds.has(nodeId)))
            continue;
        for (const nodeId of boardNodeIds) {
            if (((_b = currentAwakeLevels.get(nodeId)) !== null && _b !== void 0 ? _b : 0) >= boardAwakeLevel)
                continue;
            updates.push({ nodeId, awakeLevel: boardAwakeLevel });
        }
    }
    return updates;
}
exports.collectLinkedManaNodeAwakeUpdates = collectLinkedManaNodeAwakeUpdates;
