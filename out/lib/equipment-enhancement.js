"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planEquipmentEnhancementPurchase = exports.findCurrentEquipmentEnhancementStage = exports.resolveEquipmentEnhancementPurchaseMode = void 0;
/**
 * Resolves the purchase mode from the authoritative enhancement category.
 *
 * Only explicitly marked rows in the official-origin categories 1-4 may use
 * the private-server one-purchase stage benefit. Unmarked and author-added
 * rows use the per-level material flow.
 */
function resolveEquipmentEnhancementPurchaseMode(shopCategoryId, configuredMode) {
    if (Number.isInteger(shopCategoryId) && shopCategoryId >= 1 && shopCategoryId <= 4
        && configuredMode === "stage_benefit") {
        return "stage_benefit";
    }
    return "per_level";
}
exports.resolveEquipmentEnhancementPurchaseMode = resolveEquipmentEnhancementPurchaseMode;
/**
 * Resolves the next purchasable row inside one enhancement category.
 *
 * Some equipment IDs occur in more than one category with overlapping group
 * and stage numbers, so category is part of the progression identity.
 */
function findCurrentEquipmentEnhancementStage(stages, query) {
    var _a;
    const candidates = stages
        .filter(stage => stage.shopCategoryId === query.shopCategoryId
        && stage.groupId === query.groupId
        && stage.equipmentId === query.equipmentId
        && stage.maxLevel > query.currentLevel)
        .sort((left, right) => left.maxLevel - right.maxLevel
        || left.stage - right.stage
        || left.shopItemId - right.shopItemId);
    return (_a = candidates[0]) !== null && _a !== void 0 ? _a : null;
}
exports.findCurrentEquipmentEnhancementStage = findCurrentEquipmentEnhancementStage;
/**
 * Plans one special-equipment enhancement purchase.
 *
 * Explicitly marked official-origin rows retain the private-server stage benefit.
 * Author-added rows use `per_level`, where the requested amount advances
 * exactly that many levels and the caller charges the row's materials per level.
 * Callers should resolve a shop row with
 * `resolveEquipmentEnhancementPurchaseMode` before planning a purchase.
 */
function planEquipmentEnhancementPurchase(currentLevel, requestedPurchaseAmount, stageMaxLevel, currentAwakeningLevel, requiredAwakeningLevel, mode = "per_level") {
    if (!Number.isSafeInteger(requestedPurchaseAmount) || requestedPurchaseAmount <= 0) {
        return { ok: false, message: "Invalid enhancement purchase amount." };
    }
    if (!Number.isSafeInteger(currentLevel)
        || !Number.isSafeInteger(stageMaxLevel)
        || currentLevel < 0
        || stageMaxLevel <= currentLevel
        || requestedPurchaseAmount > stageMaxLevel - currentLevel) {
        return { ok: false, message: "Enhancement purchase exceeds the current stage." };
    }
    if (currentAwakeningLevel < requiredAwakeningLevel) {
        return { ok: false, message: "Equipment awakening level is too low." };
    }
    if (mode === "per_level") {
        return {
            ok: true,
            newLevel: currentLevel + requestedPurchaseAmount,
            chargedPurchaseAmount: requestedPurchaseAmount,
            grantedLevelCount: requestedPurchaseAmount,
        };
    }
    return {
        ok: true,
        newLevel: stageMaxLevel,
        chargedPurchaseAmount: 1,
        grantedLevelCount: stageMaxLevel - currentLevel,
    };
}
exports.planEquipmentEnhancementPurchase = planEquipmentEnhancementPurchase;
