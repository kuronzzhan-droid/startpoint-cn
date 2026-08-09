"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Rebuild boss_coin_shop.json and boss_coin_shop_item_category_map.json
 * from wf-assets-cn source data, keeping existing items (with modified dates)
 * and adding items for new categories (34-39, 51-58, 60-66, 70-71).
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const WF_ASSETS_CN = path.resolve(__dirname, "../assets/cdndata/boss_coin_shop.json");
const OUTPUT_SHOP = path.resolve(__dirname, "../assets/boss_coin_shop.json");
const OUTPUT_CATMAP = path.resolve(__dirname, "../assets/boss_coin_shop_item_category_map.json");
const EXISTING = path.resolve(__dirname, "../assets/boss_coin_shop_existing.json");
// Parse wf-assets-cn flat array format
function parseWfBossCoinItem(raw) {
    const costs = [];
    for (let offset = 17; offset <= 23; offset += 2) {
        const id = parseInt(raw[offset], 10);
        const amount = parseInt(raw[offset + 1], 10);
        if (!isNaN(id) && !isNaN(amount))
            costs.push({ id, amount });
    }
    const rewards = [];
    for (let offset = 32; offset <= 47; offset += 3) {
        const type = parseInt(raw[offset], 10);
        if (isNaN(type))
            continue;
        const id = parseInt(raw[offset + 1], 10);
        const parsedCount = parseInt(raw[offset + 2], 10);
        const reward = {
            type,
            count: isNaN(parsedCount) ? 1 : parsedCount,
        };
        // EXP and mana rewards intentionally have no item id.
        if (!isNaN(id))
            reward.id = id;
        rewards.push(reward);
    }
    const availableFrom = raw[25];
    const availableUntil = raw[26];
    const parsedStock = parseInt(raw[28], 10);
    const stock = isNaN(parsedStock) ? 1 : parsedStock;
    if (costs.length === 0 || rewards.length === 0)
        return null;
    return {
        costs,
        rewards,
        availableFrom,
        availableUntil: availableUntil === "(None)" || availableUntil === "" ? null : availableUntil,
        stock,
    };
}
function main() {
    var _a;
    // Load wf-assets-cn data
    const wfData = JSON.parse(fs.readFileSync(WF_ASSETS_CN, "utf-8"));
    console.log(`wf-assets-cn entries: ${Object.keys(wfData).length}`);
    // Load existing starpoint-cn data (if exists)
    let existingData = {};
    if (fs.existsSync(EXISTING)) {
        existingData = JSON.parse(fs.readFileSync(EXISTING, "utf-8"));
    }
    else if (fs.existsSync(OUTPUT_SHOP)) {
        existingData = JSON.parse(fs.readFileSync(OUTPUT_SHOP, "utf-8"));
    }
    console.log(`Existing starpoint-cn categories: ${Object.keys(existingData).length}`);
    console.log(`Existing starpoint-cn total items: ${Object.values(existingData).reduce((sum, items) => sum + Object.keys(items).length, 0)}`);
    // Build new data: for each wf-assets-cn entry, group by category
    const newData = {};
    const newCatMap = {};
    for (const [itemId, rows] of Object.entries(wfData)) {
        const raw = rows[0];
        if (!raw || raw.length < 35)
            continue;
        const catId = raw[0];
        if (catId === "(None)" || catId === "")
            continue;
        const item = parseWfBossCoinItem(raw);
        if (!item)
            continue;
        // Preserve manual changes, but repair the exact signature produced by
        // the old off-by-one parser (raw[27] was used instead of raw[28]).
        const existingItem = (_a = existingData[catId]) === null || _a === void 0 ? void 0 : _a[itemId];
        let outputItem = existingItem || item;
        if (existingItem) {
            const legacyWrongStock = parseInt(raw[27], 10);
            if (!isNaN(legacyWrongStock)
                && existingItem.stock === legacyWrongStock
                && existingItem.stock !== item.stock) {
                outputItem = { ...existingItem, stock: item.stock };
            }
        }
        if (!newData[catId])
            newData[catId] = {};
        newData[catId][itemId] = outputItem;
        newCatMap[itemId] = parseInt(catId, 10);
    }
    // Count stats
    let totalItems = 0;
    const categories = Object.keys(newData).sort((a, b) => parseInt(a) - parseInt(b));
    for (const cat of categories) {
        const count = Object.keys(newData[cat]).length;
        totalItems += count;
        const existingCount = existingData[cat] ? Object.keys(existingData[cat]).length : 0;
        const newCount = count - existingCount;
        const tag = existingCount === 0 ? " [NEW]" : existingCount < count ? ` [+${newCount} new]` : "";
        console.log(`  Category ${cat}: ${count} items${tag}`);
    }
    console.log(`\nTotal categories: ${categories.length}`);
    console.log(`Total items: ${totalItems}`);
    console.log(`All category IDs: ${categories.join(", ")}`);
    // Write output
    fs.writeFileSync(OUTPUT_SHOP, JSON.stringify(newData, null, 2));
    console.log(`\nWritten: ${OUTPUT_SHOP}`);
    fs.writeFileSync(OUTPUT_CATMAP, JSON.stringify(newCatMap, null, 2));
    console.log(`Written: ${OUTPUT_CATMAP}`);
}
main();
