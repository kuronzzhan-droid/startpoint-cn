"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeGenericShopPurchaseSync = exports.isShopItemAvailable = exports.parseShopJstTimestamp = exports.validateShopPurchaseAmount = exports.ShopBalanceError = exports.ShopStockError = exports.ShopPeriodError = exports.InvalidShopPurchaseAmountError = exports.ShopPurchaseError = exports.ITEM_SHOP_PERIOD_ERROR_CODE = void 0;
const types_1 = require("./types");
const free_first_deduction_1 = require("./free-first-deduction");
exports.ITEM_SHOP_PERIOD_ERROR_CODE = 2053;
class ShopPurchaseError extends Error {
}
exports.ShopPurchaseError = ShopPurchaseError;
class InvalidShopPurchaseAmountError extends ShopPurchaseError {
    constructor() {
        super("Shop purchase amount must be a positive integer.");
        this.name = "InvalidShopPurchaseAmountError";
    }
}
exports.InvalidShopPurchaseAmountError = InvalidShopPurchaseAmountError;
class ShopPeriodError extends ShopPurchaseError {
    constructor() {
        super("Shop item is outside its available period.");
        this.resultCode = exports.ITEM_SHOP_PERIOD_ERROR_CODE;
        this.name = "ShopPeriodError";
    }
}
exports.ShopPeriodError = ShopPeriodError;
class ShopStockError extends ShopPurchaseError {
    constructor() {
        super("Shop item purchase limit reached.");
        this.name = "ShopStockError";
    }
}
exports.ShopStockError = ShopStockError;
class ShopBalanceError extends ShopPurchaseError {
    constructor(message) {
        super(message);
        this.name = "ShopBalanceError";
    }
}
exports.ShopBalanceError = ShopBalanceError;
function validateShopPurchaseAmount(value) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new InvalidShopPurchaseAmountError();
    }
    return value;
}
exports.validateShopPurchaseAmount = validateShopPurchaseAmount;
function parseShopJstTimestamp(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (match === null) {
        throw new ShopPurchaseError(`Invalid shop period: ${value}.`);
    }
    const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
    const parts = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
    const [year, month, day, hour, minute, second] = parts;
    const localDate = new Date(0);
    localDate.setUTCFullYear(year, month - 1, day);
    localDate.setUTCHours(hour, minute, second, 0);
    const normalized = [
        localDate.getUTCFullYear(),
        localDate.getUTCMonth() + 1,
        localDate.getUTCDate(),
        localDate.getUTCHours(),
        localDate.getUTCMinutes(),
        localDate.getUTCSeconds(),
    ];
    if (parts.some((part, index) => part !== normalized[index])) {
        throw new ShopPurchaseError(`Invalid shop period: ${value}.`);
    }
    return localDate.getTime() - (9 * 60 * 60 * 1000);
}
exports.parseShopJstTimestamp = parseShopJstTimestamp;
function isShopItemAvailable(shopItem, nowMs) {
    var _a;
    const periods = [{
            availableFrom: shopItem.availableFrom,
            availableUntil: shopItem.availableUntil,
        }, ...((_a = shopItem.compatibilityPeriods) !== null && _a !== void 0 ? _a : [])];
    return periods.some(period => {
        const availableFromMs = parseShopJstTimestamp(period.availableFrom);
        const availableUntilMs = period.availableUntil === null
            ? Infinity
            : parseShopJstTimestamp(period.availableUntil);
        return nowMs >= availableFromMs && nowMs <= availableUntilMs;
    });
}
exports.isShopItemAvailable = isShopItemAvailable;
function buildRewards(shopItem, purchaseAmount) {
    const rewards = [];
    for (const reward of shopItem.rewards) {
        switch (reward.type) {
            case types_1.ShopItemRewardType.ITEM: {
                const itemReward = reward;
                rewards.push({
                    type: types_1.RewardType.ITEM,
                    id: itemReward.id,
                    count: itemReward.count * purchaseAmount,
                });
                break;
            }
            case types_1.ShopItemRewardType.EXP: {
                const currencyReward = reward;
                rewards.push({
                    type: types_1.RewardType.EXP,
                    count: currencyReward.count * purchaseAmount,
                });
                break;
            }
            case types_1.ShopItemRewardType.MANA: {
                const currencyReward = reward;
                rewards.push({
                    type: types_1.RewardType.MANA,
                    count: currencyReward.count * purchaseAmount,
                });
                break;
            }
            case types_1.ShopItemRewardType.CHARACTER: {
                const characterReward = reward;
                for (let i = 0; i < purchaseAmount; i++) {
                    rewards.push({
                        type: types_1.RewardType.CHARACTER,
                        id: characterReward.id,
                    });
                }
                break;
            }
            case types_1.ShopItemRewardType.EQUIPMENT: {
                const equipmentReward = reward;
                rewards.push({
                    type: types_1.RewardType.EQUIPMENT,
                    id: equipmentReward.id,
                    count: equipmentReward.count * purchaseAmount,
                });
                break;
            }
        }
    }
    return rewards;
}
function executeGenericShopPurchaseSync(input, dependencies) {
    const purchaseAmount = validateShopPurchaseAmount(input.purchaseAmount);
    if (input.enforcePeriod && !isShopItemAvailable(input.shopItem, input.nowMs)) {
        throw new ShopPeriodError();
    }
    return dependencies.transaction(() => {
        var _a;
        const player = dependencies.getPlayer(input.playerId);
        if (player === null)
            throw new ShopPurchaseError("Player not found.");
        const purchased = dependencies.getPurchaseCount(input.playerId, input.shopItemId);
        if (input.shopItem.stock !== undefined && input.shopItem.stock > 0 && purchased + purchaseAmount > input.shopItem.stock) {
            throw new ShopStockError();
        }
        const nextPlayer = Object.assign({}, player);
        const userCost = input.shopItem.userCost;
        if (userCost !== undefined) {
            const cost = userCost.amount * purchaseAmount;
            switch (userCost.type) {
                case types_1.ShopItemUserCostType.MANA: {
                    const deduction = (0, free_first_deduction_1.computeFreeFirstDeduction)(nextPlayer.freeMana, nextPlayer.paidMana, cost);
                    if (deduction === null)
                        throw new ShopBalanceError("Not enough mana.");
                    nextPlayer.freeMana = deduction.freeBalance;
                    nextPlayer.paidMana = deduction.paidBalance;
                    break;
                }
                case types_1.ShopItemUserCostType.BEADS: {
                    const deduction = (0, free_first_deduction_1.computeFreeFirstDeduction)(nextPlayer.freeVmoney, nextPlayer.vmoney, cost);
                    if (deduction === null)
                        throw new ShopBalanceError("Not enough beads.");
                    nextPlayer.freeVmoney = deduction.freeBalance;
                    nextPlayer.vmoney = deduction.paidBalance;
                    break;
                }
                case types_1.ShopItemUserCostType.AMITY_SCROLL:
                    nextPlayer.bondToken -= cost;
                    if (nextPlayer.bondToken < 0)
                        throw new ShopBalanceError("Not enough amity scrolls.");
                    break;
            }
        }
        const costTotals = new Map();
        for (const cost of input.shopItem.costs) {
            costTotals.set(cost.id, ((_a = costTotals.get(cost.id)) !== null && _a !== void 0 ? _a : 0) + cost.amount * purchaseAmount);
        }
        const itemList = {};
        for (const [itemId, cost] of costTotals) {
            const nextAmount = dependencies.getItem(input.playerId, itemId) - cost;
            if (nextAmount < 0) {
                throw new ShopBalanceError(`Not enough of item ${itemId}.`);
            }
            itemList[String(itemId)] = nextAmount;
        }
        dependencies.updatePlayer(nextPlayer);
        for (const [itemId, nextAmount] of Object.entries(itemList)) {
            dependencies.setItem(input.playerId, Number(itemId), nextAmount);
        }
        const rewardResult = dependencies.grantRewards(input.playerId, buildRewards(input.shopItem, purchaseAmount));
        if (rewardResult === null)
            throw new ShopPurchaseError("Failed to grant shop rewards.");
        const purchaseCount = dependencies.addPurchaseCount(input.playerId, input.shopItemId, purchaseAmount);
        if ((userCost === null || userCost === void 0 ? void 0 : userCost.type) === types_1.ShopItemUserCostType.MANA) {
            dependencies.recordManaSpent(input.playerId, userCost.amount * purchaseAmount);
        }
        const finalPlayer = dependencies.getPlayer(input.playerId);
        if (finalPlayer === null)
            throw new ShopPurchaseError("Player disappeared during purchase.");
        return {
            player: finalPlayer,
            rewardResult,
            itemList: Object.assign(Object.assign({}, itemList), rewardResult.items),
            purchaseCount,
        };
    });
}
exports.executeGenericShopPurchaseSync = executeGenericShopPurchaseSync;
