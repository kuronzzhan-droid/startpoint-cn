"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHowToGetSources = void 0;
const assets_1 = require("./assets");
const content_master_1 = require("./content-master");
const shop_1 = require("./types/shop");
const rewards_1 = require("./types/rewards");
const box_gacha_1 = require("./types/box-gacha");
const boss_coin_shop_json_1 = __importDefault(require("../../assets/boss_coin_shop.json"));
const box_reward_json_1 = __importDefault(require("../../assets/box_reward.json"));
const cdn_general_shop_whitelist_json_1 = __importDefault(require("../../assets/cdn_general_shop_whitelist.json"));
let sourceIndex;
function getIndex() {
    var _a, _b;
    if (sourceIndex)
        return sourceIndex;
    const shops = new Map();
    const boxes = new Map();
    const generalKeys = new Set(cdn_general_shop_whitelist_json_1.default);
    const append = (shopType, items) => {
        var _a;
        for (const [rawId, item] of Object.entries(items)) {
            const shopItemId = Number(rawId);
            if (shopType === shop_1.ShopType.GENERAL && !generalKeys.has(shopItemId))
                continue;
            for (const reward of item.rewards) {
                if (![rewards_1.ShopItemRewardType.ITEM, rewards_1.ShopItemRewardType.EQUIPMENT].includes(reward.type))
                    continue;
                const key = `${reward.type}:${reward.id}`;
                const list = (_a = shops.get(key)) !== null && _a !== void 0 ? _a : [];
                if (!list.some(x => x.shopType === shopType && x.shopItemId === shopItemId)) {
                    list.push({ shopType, shopItemId });
                    shops.set(key, list);
                }
            }
        }
    };
    for (const type of [shop_1.ShopType.GENERAL, shop_1.ShopType.STAR_GRAIN, shop_1.ShopType.TREASURE]) {
        append(type, (_a = (0, assets_1.getGenericShopItemsSync)(type)) !== null && _a !== void 0 ? _a : {});
    }
    for (const events of Object.values(content_master_1.serverEventShops)) {
        for (const items of Object.values(events))
            append(shop_1.ShopType.EVENT_ITEM, items);
    }
    for (const items of Object.values(boss_coin_shop_json_1.default))
        append(shop_1.ShopType.BOSS_COIN, items);
    for (const [boxId, stages] of Object.entries(box_reward_json_1.default)) {
        for (const stage of Object.values(stages)) {
            for (const reward of Object.values(stage)) {
                const type = reward.type === box_gacha_1.BoxGachaRewardType.ITEM ? rewards_1.ShopItemRewardType.ITEM
                    : reward.type === box_gacha_1.BoxGachaRewardType.EQUIPMENT ? rewards_1.ShopItemRewardType.EQUIPMENT : null;
                if (type === null || reward.id === undefined)
                    continue;
                const key = `${type}:${reward.id}`;
                const list = (_b = boxes.get(key)) !== null && _b !== void 0 ? _b : [];
                if (!list.includes(Number(boxId)))
                    list.push(Number(boxId));
                boxes.set(key, list);
            }
        }
    }
    // Imported shop masters are immutable for the process lifetime. Only cache
    // source IDs; availability, quantities and player state are resolved per call.
    return sourceIndex = { shops, boxes };
}
function getHowToGetSources(equipment, id) {
    var _a, _b;
    const index = getIndex();
    const key = `${equipment ? rewards_1.ShopItemRewardType.EQUIPMENT : rewards_1.ShopItemRewardType.ITEM}:${id}`;
    return { shops: (_a = index.shops.get(key)) !== null && _a !== void 0 ? _a : [], boxes: (_b = index.boxes.get(key)) !== null && _b !== void 0 ? _b : [] };
}
exports.getHowToGetSources = getHowToGetSources;
