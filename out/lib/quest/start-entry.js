"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runStartEntryTransaction = exports.buildStartEntryItemList = exports.InsufficientStaminaError = exports.InsufficientEntryItemError = exports.PlayerNotFoundError = void 0;
class PlayerNotFoundError extends Error {
    constructor(playerId) {
        super(`Player ${playerId} does not exist.`);
        this.name = "PlayerNotFoundError";
    }
}
exports.PlayerNotFoundError = PlayerNotFoundError;
class InsufficientEntryItemError extends Error {
    constructor(itemId, required, current) {
        super(`Not enough entry items (need ${required} of ${itemId}, have ${current}).`);
        this.itemId = itemId;
        this.required = required;
        this.current = current;
        this.name = "InsufficientEntryItemError";
    }
}
exports.InsufficientEntryItemError = InsufficientEntryItemError;
class InsufficientStaminaError extends Error {
    constructor(required, current) {
        super(`Insufficient stamina (need ${required}, have ${current}).`);
        this.required = required;
        this.current = current;
        this.name = "InsufficientStaminaError";
    }
}
exports.InsufficientStaminaError = InsufficientStaminaError;
function buildStartEntryItemList(result) {
    if (result.entryItemId === null || result.entryItemCount === null)
        return {};
    return { [result.entryItemId]: result.entryItemCount };
}
exports.buildStartEntryItemList = buildStartEntryItemList;
function runStartEntryTransaction(input, dependencies) {
    const result = dependencies.transaction(() => {
        var _a, _b, _c, _d;
        const player = dependencies.getPlayer(input.playerId);
        if (!player)
            throw new PlayerNotFoundError(input.playerId);
        const entryItemCost = input.entryCost
            && input.entryCost.itemId > 0
            && input.entryCost.itemCount > 0
            ? input.entryCost
            : null;
        const entryItemId = (_a = entryItemCost === null || entryItemCost === void 0 ? void 0 : entryItemCost.itemId) !== null && _a !== void 0 ? _a : null;
        const currentItemCount = entryItemCost
            ? (_b = dependencies.getItemCount(input.playerId, entryItemCost.itemId)) !== null && _b !== void 0 ? _b : 0
            : null;
        const currentStamina = dependencies.computeStamina(player);
        if (entryItemCost && (currentItemCount !== null && currentItemCount !== void 0 ? currentItemCount : 0) < entryItemCost.itemCount) {
            throw new InsufficientEntryItemError(entryItemCost.itemId, entryItemCost.itemCount, currentItemCount !== null && currentItemCount !== void 0 ? currentItemCount : 0);
        }
        if (currentStamina < input.staminaCost) {
            throw new InsufficientStaminaError(input.staminaCost, currentStamina);
        }
        const entryItemCount = entryItemCost
            ? (currentItemCount !== null && currentItemCount !== void 0 ? currentItemCount : 0) - entryItemCost.itemCount
            : null;
        if (entryItemId !== null) {
            dependencies.updateItemCount(input.playerId, entryItemId, entryItemCount !== null && entryItemCount !== void 0 ? entryItemCount : 0);
        }
        const afterStamina = currentStamina - input.staminaCost;
        const playerUpdate = {
            id: input.playerId,
        };
        if (input.staminaCost > 0) {
            playerUpdate.stamina = afterStamina;
            playerUpdate.staminaHealTime = input.now;
            playerUpdate.totalStaminaUsed = ((_c = player.totalStaminaUsed) !== null && _c !== void 0 ? _c : 0) + input.staminaCost;
        }
        if (input.updatePartySlot)
            playerUpdate.partySlot = input.partyId;
        if (Object.keys(playerUpdate).length > 1)
            dependencies.updatePlayer(playerUpdate);
        dependencies.persistActiveQuest(input.playerId, input.activeQuest);
        (_d = dependencies.afterPersist) === null || _d === void 0 ? void 0 : _d.call(dependencies, input.playerId);
        return {
            afterStamina,
            entryItemId,
            entryItemCount,
        };
    });
    dependencies.publishActiveQuest(input.playerId, input.activeQuest);
    return result;
}
exports.runStartEntryTransaction = runStartEntryTransaction;
