"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshAwakeUnlockCharacterList = exports.reconcileAwakeUnlockCharacterList = void 0;
const character_helpers_1 = require("../character-helpers");
const awake_unlock_1 = require("./awake-unlock");
function mergeManaBoardAwake(...values) {
    var _a;
    const merged = {};
    for (const value of values) {
        if (!value || typeof value !== "object" || Array.isArray(value))
            continue;
        for (const [boardIndex, awakeLevel] of Object.entries(value)) {
            const index = Number(boardIndex);
            if (!Number.isSafeInteger(index) || index <= 0)
                continue;
            if (typeof awakeLevel !== "number"
                || !Number.isSafeInteger(awakeLevel)
                || awakeLevel < 0)
                continue;
            merged[index] = Math.max((_a = merged[index]) !== null && _a !== void 0 ? _a : 0, awakeLevel);
        }
    }
    return merged;
}
function reconcileAwakeUnlockCharacterList(playerId, existing) {
    try {
        const changed = (0, awake_unlock_1.reconcileAwakeUnlocks)(playerId).changed;
        if (changed.size === 0)
            return existing;
        const updates = (0, character_helpers_1.buildScopedManaBoardAwakeCharacterList)(playerId, changed);
        return mergeAwakeCharacterUpdates(existing, updates);
    }
    catch (cause) {
        const error = cause instanceof Error
            ? cause
            : new Error("Unknown awake unlock publication error");
        console.error("[awake-unlock] Failed to publish character unlocks.", error);
        return existing;
    }
}
exports.reconcileAwakeUnlockCharacterList = reconcileAwakeUnlockCharacterList;
/**
 * Re-publishes already-persisted Awake unlocks for the requested characters.
 *
 * Mission progress pages are allowed to be retried after the original unlock
 * response was lost.  Scope the refresh to the page's character IDs so the
 * recovery path never scans every owned character or mana node.
 */
function refreshAwakeUnlockCharacterList(playerId, existing, unlocks, candidateCharacterIds) {
    const selectedUnlocks = new Map();
    for (const characterId of new Set(candidateCharacterIds)) {
        if (!Number.isSafeInteger(characterId) || characterId <= 0)
            continue;
        const key = String(characterId);
        const awakeLevels = unlocks.get(key);
        if (!awakeLevels)
            continue;
        selectedUnlocks.set(key, awakeLevels);
    }
    if (selectedUnlocks.size === 0) {
        return existing;
    }
    const updates = (0, character_helpers_1.buildScopedManaBoardAwakeCharacterList)(playerId, selectedUnlocks);
    return mergeAwakeCharacterUpdates(existing, updates);
}
exports.refreshAwakeUnlockCharacterList = refreshAwakeUnlockCharacterList;
function mergeAwakeCharacterUpdates(existing, updates) {
    const merged = [];
    const indexByCharacterId = new Map();
    for (const rawEntry of existing) {
        const entry = rawEntry;
        const characterId = entry.character_id;
        if (typeof characterId !== "number" && typeof characterId !== "string") {
            merged.push(Object.assign({}, entry));
            continue;
        }
        const key = String(characterId);
        const index = indexByCharacterId.get(key);
        if (index === undefined) {
            indexByCharacterId.set(key, merged.length);
            merged.push(Object.assign({}, entry));
            continue;
        }
        const previous = merged[index];
        merged[index] = Object.assign(Object.assign(Object.assign({}, previous), entry), ((previous.mana_board_awake !== undefined || entry.mana_board_awake !== undefined) ? {
            mana_board_awake: mergeManaBoardAwake(previous.mana_board_awake, entry.mana_board_awake),
        } : {}));
    }
    for (const update of updates) {
        const key = String(update.character_id);
        const index = indexByCharacterId.get(key);
        if (index === undefined) {
            indexByCharacterId.set(key, merged.length);
            merged.push(update);
            continue;
        }
        merged[index] = Object.assign(Object.assign(Object.assign({}, update), merged[index]), { mana_board_awake: mergeManaBoardAwake(merged[index].mana_board_awake, update.mana_board_awake) });
    }
    return merged;
}
