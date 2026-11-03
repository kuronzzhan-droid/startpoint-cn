"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWeaponRivenItemId = exports.isUnknownWeaponRivenItemId = exports.UNKNOWN_RIVEN_ITEM_IDS = exports.THEMED_UNKNOWN_RIVEN_ITEM_IDS = exports.isThemedUnknownRivenBlockId = exports.LAST_THEMED_UNKNOWN_RIVEN_ITEM_ID = exports.FIRST_THEMED_UNKNOWN_RIVEN_ITEM_ID = exports.WEAPON_RIVEN_FRAGMENT_ITEM_ID = exports.WEAPON_RIVEN_CURRENCY_ITEM_ID = exports.MAX_WEAPON_RIVENS = exports.LAST_RESERVED_RIVEN_ITEM_ID = exports.LAST_RIVEN_ITEM_ID = exports.FIRST_RIVEN_ITEM_ID = exports.UNKNOWN_RIVEN_ITEM_ID = void 0;
const weapon_riven_rules_json_1 = __importDefault(require("../../../assets/weapon_riven_rules.json"));
exports.UNKNOWN_RIVEN_ITEM_ID = 16000000;
exports.FIRST_RIVEN_ITEM_ID = 16000001;
exports.LAST_RIVEN_ITEM_ID = 16000200;
exports.LAST_RESERVED_RIVEN_ITEM_ID = 16000999;
exports.MAX_WEAPON_RIVENS = weapon_riven_rules_json_1.default.items.holding_limit;
exports.WEAPON_RIVEN_CURRENCY_ITEM_ID = 2370099;
exports.WEAPON_RIVEN_FRAGMENT_ITEM_ID = 16000900;
/** Themed unknown rivens (16000901 spirit beast, 16000902 abyss, ...) share one reserved block. */
exports.FIRST_THEMED_UNKNOWN_RIVEN_ITEM_ID = 16000901;
exports.LAST_THEMED_UNKNOWN_RIVEN_ITEM_ID = 16000919;
/** The reserved block is never an instance, configured or not. */
function isThemedUnknownRivenBlockId(itemId) {
    return typeof itemId === "number" && Number.isSafeInteger(itemId)
        && itemId >= exports.FIRST_THEMED_UNKNOWN_RIVEN_ITEM_ID && itemId <= exports.LAST_THEMED_UNKNOWN_RIVEN_ITEM_ID;
}
exports.isThemedUnknownRivenBlockId = isThemedUnknownRivenBlockId;
/** Configured themes only; an unconfigured reserved ID is an inert ordinary item. */
exports.THEMED_UNKNOWN_RIVEN_ITEM_IDS = Object.freeze(((_a = weapon_riven_rules_json_1.default.themes) !== null && _a !== void 0 ? _a : []).map(theme => theme.item_id)
    .filter(isThemedUnknownRivenBlockId));
/** Every stackable card that a five-boss clear reveals into an instance. */
exports.UNKNOWN_RIVEN_ITEM_IDS = Object.freeze([exports.UNKNOWN_RIVEN_ITEM_ID, ...exports.THEMED_UNKNOWN_RIVEN_ITEM_IDS]);
function isUnknownWeaponRivenItemId(itemId) {
    return itemId === exports.UNKNOWN_RIVEN_ITEM_ID || (typeof itemId === "number" && exports.THEMED_UNKNOWN_RIVEN_ITEM_IDS.includes(itemId));
}
exports.isUnknownWeaponRivenItemId = isUnknownWeaponRivenItemId;
/** Reserved instance slots exclude the fragment material and the themed unknown block. */
function isWeaponRivenItemId(itemId) {
    return typeof itemId === "number" && Number.isSafeInteger(itemId)
        && itemId >= exports.FIRST_RIVEN_ITEM_ID && itemId <= exports.LAST_RESERVED_RIVEN_ITEM_ID
        && itemId !== exports.WEAPON_RIVEN_FRAGMENT_ITEM_ID && !isThemedUnknownRivenBlockId(itemId);
}
exports.isWeaponRivenItemId = isWeaponRivenItemId;
