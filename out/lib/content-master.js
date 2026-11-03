"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.serverEventShopIdMap = exports.serverEventShops = exports.serverItemIds = exports.serverManaNodes = exports.serverGachas = exports.degreeDefinitions = exports.cdnCharacterTexts = exports.cdnCharacters = exports.serverCharacters = void 0;
const character_json_1 = __importDefault(require("../../assets/character.json"));
const character_rank_p5b_json_1 = __importDefault(require("../../assets/character_rank_p5b.json"));
const character_json_2 = __importDefault(require("../../assets/cdndata/character.json"));
const character_rank_p5b_json_2 = __importDefault(require("../../assets/cdndata/character_rank_p5b.json"));
const character_text_json_1 = __importDefault(require("../../assets/cdndata/character_text.json"));
const character_text_rank_p5b_json_1 = __importDefault(require("../../assets/cdndata/character_text_rank_p5b.json"));
const degree_json_1 = __importDefault(require("../../assets/degree.json"));
const degree_rank_p5b_json_1 = __importDefault(require("../../assets/degree_rank_p5b.json"));
const degree_sponsor_json_1 = __importDefault(require("../../assets/degree_sponsor.json"));
const degree_character_mod_json_1 = __importDefault(require("../../assets/degree_character_mod.json"));
const degree_exclusive_json_1 = __importDefault(require("../../assets/degree_exclusive.json"));
const degree_author926_json_1 = __importDefault(require("../../assets/degree_author926.json"));
const event_item_shop_json_1 = __importDefault(require("../../assets/event_item_shop.json"));
const event_item_shop_rank_p5b_json_1 = __importDefault(require("../../assets/event_item_shop_rank_p5b.json"));
const event_item_shop_id_map_json_1 = __importDefault(require("../../assets/event_item_shop_id_map.json"));
const event_item_shop_id_map_rank_p5b_json_1 = __importDefault(require("../../assets/event_item_shop_id_map_rank_p5b.json"));
const gacha_json_1 = __importDefault(require("../../assets/gacha.json"));
const gacha_cnmod_json_1 = __importDefault(require("../../assets/gacha_cnmod.json"));
const gacha_rank_p5b_json_1 = __importDefault(require("../../assets/gacha_rank_p5b.json"));
const gacha_midautumn_2026_json_1 = __importDefault(require("../../assets/gacha_midautumn_2026.json"));
const item_ids_json_1 = __importDefault(require("../../assets/item_ids.json"));
const item_ids_rank_p5b_json_1 = __importDefault(require("../../assets/item_ids_rank_p5b.json"));
const mana_node_json_1 = __importDefault(require("../../assets/mana_node.json"));
const mana_node_cnmod_json_1 = __importDefault(require("../../assets/mana_node_cnmod.json"));
const mana_node_rank_p5b_json_1 = __importDefault(require("../../assets/mana_node_rank_p5b.json"));
exports.serverCharacters = Object.assign(Object.assign({}, character_json_1.default), character_rank_p5b_json_1.default);
exports.cdnCharacters = Object.assign(Object.assign({}, character_json_2.default), character_rank_p5b_json_2.default);
exports.cdnCharacterTexts = Object.assign(Object.assign({}, character_text_json_1.default), character_text_rank_p5b_json_1.default);
exports.degreeDefinitions = Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, degree_json_1.default), degree_rank_p5b_json_1.default), degree_sponsor_json_1.default), degree_character_mod_json_1.default), degree_exclusive_json_1.default), degree_author926_json_1.default);
exports.serverGachas = Object.assign(Object.assign(Object.assign(Object.assign({}, gacha_json_1.default), gacha_cnmod_json_1.default), gacha_rank_p5b_json_1.default), gacha_midautumn_2026_json_1.default);
exports.serverManaNodes = Object.assign(Object.assign(Object.assign({}, mana_node_json_1.default), mana_node_cnmod_json_1.default), mana_node_rank_p5b_json_1.default);
exports.serverItemIds = [...new Set([...item_ids_json_1.default, ...item_ids_rank_p5b_json_1.default])];
// Retain the retired event-shop row as source data. Five Boss now uses the
// approved boss-coin shop (category 99); reopening the old event row would
// introduce a second exchange with different costs and no matching client row.
const DORMANT_EVENT_SHOP_ITEM_IDS = new Set(["59001010"]);
const mergedEventShops = Object.assign(Object.assign({}, event_item_shop_json_1.default), { "11": Object.assign(Object.assign({}, event_item_shop_json_1.default["11"]), { "700099": Object.assign(Object.assign({}, (_a = event_item_shop_json_1.default["11"]) === null || _a === void 0 ? void 0 : _a["700099"]), (_b = event_item_shop_rank_p5b_json_1.default["11"]) === null || _b === void 0 ? void 0 : _b["700099"]) }) });
exports.serverEventShops = Object.fromEntries(Object.entries(mergedEventShops).map(([eventType, events]) => [
    eventType,
    Object.fromEntries(Object.entries(events).map(([eventId, items]) => [
        eventId,
        Object.fromEntries(Object.entries(items).filter(([itemId]) => !DORMANT_EVENT_SHOP_ITEM_IDS.has(itemId))),
    ])),
]));
exports.serverEventShopIdMap = Object.fromEntries(Object.entries(Object.assign(Object.assign({}, event_item_shop_id_map_json_1.default), event_item_shop_id_map_rank_p5b_json_1.default)).filter(([itemId]) => !DORMANT_EVENT_SHOP_ITEM_IDS.has(itemId)));
