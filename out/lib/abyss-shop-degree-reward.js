"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantPurchasedAbyssShopDegreeRewardSync = exports.grantAbyssShopDegreeRewardSync = exports.abyssShopDegreeRewardEnabled = exports.isAbyssShopDegreeEligible = exports.ABYSS_SHOP_DEGREE_CONFIG_PATH = exports.ABYSS_SHOP_REQUIRED_PURCHASES = exports.ABYSS_SHOP_TICKET_IDS = exports.ABYSS_SHOP_DEGREE_ID = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("../data/db");
const shopPurchase_1 = require("../data/domains/shopPurchase");
const degree_1 = require("../data/domains/degree");
const types_1 = require("./types");
const persistence_coordinator_1 = require("./persistence-coordinator");
exports.ABYSS_SHOP_DEGREE_ID = 9911001;
exports.ABYSS_SHOP_TICKET_IDS = Object.freeze([9700116, 9700117]);
exports.ABYSS_SHOP_REQUIRED_PURCHASES = 9999;
exports.ABYSS_SHOP_DEGREE_CONFIG_PATH = node_path_1.default.resolve(__dirname, "..", "..", "assets", "abyss_shop_degree_reward.json");
/** Both ticket products must reach the threshold independently. */
function isAbyssShopDegreeEligible(singleCount, tenfoldCount) {
    return [singleCount, tenfoldCount].every(count => (Number.isSafeInteger(count) && count >= exports.ABYSS_SHOP_REQUIRED_PURCHASES));
}
exports.isAbyssShopDegreeEligible = isAbyssShopDegreeEligible;
/** Keep the reward closed until its server config and client resources are published. */
function abyssShopDegreeRewardEnabled(configPath = exports.ABYSS_SHOP_DEGREE_CONFIG_PATH) {
    try {
        const raw = JSON.parse((0, node_fs_1.readFileSync)(configPath, "utf8"));
        if (raw === null || typeof raw !== "object" || Array.isArray(raw))
            return false;
        const config = raw;
        return config.schema_version === 1
            && config.enabled === true
            && config.degree_id === exports.ABYSS_SHOP_DEGREE_ID
            && config.required_purchases === exports.ABYSS_SHOP_REQUIRED_PURCHASES
            && Array.isArray(config.shop_item_ids)
            && config.shop_item_ids.length === exports.ABYSS_SHOP_TICKET_IDS.length
            && config.shop_item_ids.every((id, index) => id === exports.ABYSS_SHOP_TICKET_IDS[index]);
    }
    catch (_a) {
        return false;
    }
}
exports.abyssShopDegreeRewardEnabled = abyssShopDegreeRewardEnabled;
function grantEligibleAbyssShopDegreeSync(playerId) {
    const db = (0, db_1.getDb)();
    if (!db.prepare("SELECT id FROM players WHERE id = ?").get(playerId))
        return [];
    const counts = exports.ABYSS_SHOP_TICKET_IDS.map(id => (0, shopPurchase_1.getPlayerShopPurchaseCountSync)(playerId, id));
    if (!isAbyssShopDegreeEligible(counts[0], counts[1]))
        return [];
    return (0, degree_1.grantPlayerDegreeSync)(playerId, exports.ABYSS_SHOP_DEGREE_ID) ? [exports.ABYSS_SHOP_DEGREE_ID] : [];
}
/** Checks persisted purchase counters only; ticket inventory is deliberately ignored. */
function grantAbyssShopDegreeRewardSync(playerId, options = {}) {
    if (!Number.isSafeInteger(playerId) || playerId <= 0
        || !abyssShopDegreeRewardEnabled(options.configPath))
        return [];
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "shop", playerId, operation: "grant_abyss_shop_degree",
    }, () => grantEligibleAbyssShopDegreeSync(playerId));
}
exports.grantAbyssShopDegreeRewardSync = grantAbyssShopDegreeRewardSync;
/** The shop route calls this after counters change, inside its purchase transaction. */
function grantPurchasedAbyssShopDegreeRewardSync(playerId, shopType, purchases, options = {}) {
    const targetsTicket = shopType === types_1.ShopType.EVENT_ITEM && purchases.some(entry => exports.ABYSS_SHOP_TICKET_IDS.some(id => id === entry.shopItemId));
    return targetsTicket ? grantAbyssShopDegreeRewardSync(playerId, options) : [];
}
exports.grantPurchasedAbyssShopDegreeRewardSync = grantPurchasedAbyssShopDegreeRewardSync;
