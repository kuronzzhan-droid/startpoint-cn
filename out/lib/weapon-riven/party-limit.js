"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.limitWeaponRivenPartySouls = exports.stripIneffectiveWeaponRivenSouls = void 0;
const weapon_riven_rules_json_1 = __importDefault(require("../../../assets/weapon_riven_rules.json"));
const constants_1 = require("./constants");
/** One saved party has its own limit; unknown rivens and ordinary souls do not count. */
function maximumRivens() {
    var _a;
    const configured = (_a = weapon_riven_rules_json_1.default.max_rivens_per_party) !== null && _a !== void 0 ? _a : 1;
    return Number.isSafeInteger(configured) && configured > 0 ? configured : 1;
}
/**
 * Battle rule (author 2026-10-27 15:17): over the limit, ALL revealed cards in the party are ineffective.
 * Unknown and themed unknown cards never count and stay for conversion. Party edits keep using
 * limitWeaponRivenPartySouls (first card kept, client prompts).
 */
function stripIneffectiveWeaponRivenSouls(ids) {
    const count = ids.filter(id => (0, constants_1.isWeaponRivenItemId)(id)).length;
    return count > maximumRivens() ? ids.map(id => (0, constants_1.isWeaponRivenItemId)(id) ? null : id) : [...ids];
}
exports.stripIneffectiveWeaponRivenSouls = stripIneffectiveWeaponRivenSouls;
function limitWeaponRivenPartySouls(ids) {
    const maximum = maximumRivens();
    let count = 0;
    return ids.map(id => (0, constants_1.isWeaponRivenItemId)(id) && ++count > maximum ? null : id);
}
exports.limitWeaponRivenPartySouls = limitWeaponRivenPartySouls;
