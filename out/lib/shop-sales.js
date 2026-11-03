"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildShopSalesEntry = exports.getClientTotalPurchaseNum = exports.isShopItemAvailable = exports.getShopPurchaseKey = void 0;
const shop_1 = require("./types/shop");
// Keep the existing persisted keys: the two Fantasy shop screens share stock,
// while these GENERAL products must not consume STAR_GRAIN purchase history.
const GENERAL_EQUIPMENT_SCOPED_PURCHASE_KEYS = new Map([
    [100008, -8100008],
    [110005, -8110005],
    [110006, -8110006],
]);
const MODE15_SHARED_EVENT_PURCHASE_KEYS = new Map(Array.from({ length: 14 }, (_, index) => [
    [9700201 + index, -9702001 - index],
    [9700301 + index, -9702001 - index],
]).flat());
function getShopPurchaseKey(shopType, shopItemId) {
    var _a, _b;
    if (shopType === shop_1.ShopType.EVENT_ITEM) {
        return (_a = MODE15_SHARED_EVENT_PURCHASE_KEYS.get(shopItemId)) !== null && _a !== void 0 ? _a : shopItemId;
    }
    if (shopType === shop_1.ShopType.GENERAL) {
        return (_b = GENERAL_EQUIPMENT_SCOPED_PURCHASE_KEYS.get(shopItemId)) !== null && _b !== void 0 ? _b : shopItemId;
    }
    return shopItemId;
}
exports.getShopPurchaseKey = getShopPurchaseKey;
function isShopItemAvailable(item, now) {
    var _a;
    const periods = [{ availableFrom: item.availableFrom, availableUntil: item.availableUntil },
        ...((_a = item.compatibilityPeriods) !== null && _a !== void 0 ? _a : [])];
    return periods.some(period => {
        if (period.availableFrom && new Date(period.availableFrom.replace(' ', 'T') + 'Z') > now)
            return false;
        if (period.availableUntil && new Date(period.availableUntil.replace(' ', 'T') + 'Z') < now)
            return false;
        return true;
    });
}
exports.isShopItemAvailable = isShopItemAvailable;
function getClientTotalPurchaseNum(shopType, itemId, purchased, stock) {
    // Preserve the legacy item-5000 client limit workaround used by the shop.
    if (shopType === shop_1.ShopType.EVENT_ITEM && itemId === 5000 && stock !== undefined && stock > 2) {
        return purchased - (stock - 2);
    }
    return purchased;
}
exports.getClientTotalPurchaseNum = getClientTotalPurchaseNum;
function buildShopSalesEntry(shopType, itemId, item, purchasedMap, degreeOwned = false) {
    var _a;
    const purchased = (_a = purchasedMap[getShopPurchaseKey(shopType, itemId)]) !== null && _a !== void 0 ? _a : 0;
    const stockQuantity = degreeOwned ? 0
        : (item.stock !== undefined ? Math.max(0, item.stock - purchased) : -1);
    return {
        shop_item_id: itemId,
        stock_quantity: stockQuantity,
        today_purchase_num: purchased,
        this_month_purchase_num: purchased,
        total_purchase_num: getClientTotalPurchaseNum(shopType, itemId, purchased, item.stock),
        group_info: {
            group_total_stock_quantity: stockQuantity,
            group_total_purchase_num: purchased,
            multi_stage: false,
        },
        shop_type: shopType,
    };
}
exports.buildShopSalesEntry = buildShopSalesEntry;
