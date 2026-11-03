"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.protectWeaponRivenPartySave = exports.projectWeaponRivenLoad = exports.projectWeaponRivenClientResponse = exports.stripWeaponRivenPartySouls = exports.stripWeaponRivenSoulSlots = exports.isWeaponRivenInstanceId = void 0;
const constants_1 = require("./constants");
/** Reserved instance IDs are player-local; unknown and fragment materials are not. */
function isWeaponRivenInstanceId(value) {
    return (0, constants_1.isWeaponRivenItemId)(value);
}
exports.isWeaponRivenInstanceId = isWeaponRivenInstanceId;
function stripWeaponRivenSoulSlots(slots) {
    return slots.map(slot => {
        if (isWeaponRivenInstanceId(slot))
            return null;
        if (Array.isArray(slot) && slot[0] === 0 && isWeaponRivenInstanceId(slot[1]))
            return [1];
        return slot;
    });
}
exports.stripWeaponRivenSoulSlots = stripWeaponRivenSoulSlots;
const SOUL_ARRAY_FIELDS = new Set(["abilitySoulIds", "ability_soul_ids"]);
const RIVEN_FIELDS = new Set(["user_weapon_riven_list", "weapon_riven_list", "weapon_riven_deleted", "weapon_riven_granted", "weapon_riven_auto_dismantled"]);
/** Copy only changed branches; never change saved SETs or a frozen battle snapshot. */
function project(value, legacy) {
    if (!value || typeof value !== "object")
        return value;
    if (Array.isArray(value)) {
        const result = value.map(entry => project(entry, legacy));
        return result.some((entry, index) => entry !== value[index]) ? result : value;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
        return value;
    let result;
    for (const [key, entry] of Object.entries(value)) {
        if (legacy && RIVEN_FIELDS.has(key)) {
            result !== null && result !== void 0 ? result : (result = Object.assign({}, value));
            delete result[key];
            continue;
        }
        let next;
        if (SOUL_ARRAY_FIELDS.has(key) && Array.isArray(entry)) {
            const slots = stripWeaponRivenSoulSlots(entry);
            next = slots.some((slot, index) => slot !== entry[index]) ? slots : entry;
        }
        else if (/^ability_soul_id_[123]$/.test(key) && isWeaponRivenInstanceId(entry)) {
            next = null;
        }
        else if (legacy && key === "item_list" && entry && typeof entry === "object") {
            next = Object.fromEntries(Object.entries(entry).filter(([id]) => !isWeaponRivenInstanceId(Number(id))));
        }
        else
            next = project(entry, legacy);
        if (next !== entry) {
            result !== null && result !== void 0 ? result : (result = Object.assign({}, value));
            result[key] = next;
        }
    }
    return result !== null && result !== void 0 ? result : value;
}
/** Public parties and all P1 room wire parties have no player-local instance souls. */
function stripWeaponRivenPartySouls(value) {
    return project(value, false);
}
exports.stripWeaponRivenPartySouls = stripWeaponRivenPartySouls;
/** Apply before MessagePack/worker encoding, including responses other than /load. */
function projectWeaponRivenClientResponse(value, capable) {
    return capable ? value : project(value, true);
}
exports.projectWeaponRivenClientResponse = projectWeaponRivenClientResponse;
function projectWeaponRivenLoad(data, rivens, capable) {
    var _a;
    if (!capable)
        return projectWeaponRivenClientResponse(data, false);
    // Ignore stale or injected instance entries from players_items; instances exist only in their own table.
    const items = Object.fromEntries(Object.entries((_a = data.item_list) !== null && _a !== void 0 ? _a : {})
        .filter(([id]) => !isWeaponRivenInstanceId(Number(id))));
    for (const id of Object.keys(rivens))
        if (isWeaponRivenInstanceId(Number(id)))
            items[id] = 1;
    return Object.assign(Object.assign({}, data), { item_list: items, user_weapon_riven_list: rivens });
}
exports.projectWeaponRivenLoad = projectWeaponRivenLoad;
/** Preserve hidden instances only for empty legacy submissions; explicit replacements win. */
function protectWeaponRivenPartySave(requested, previous, capable, ownsInstance) {
    return [0, 1, 2].map(index => {
        var _a, _b;
        const old = (_a = previous[index]) !== null && _a !== void 0 ? _a : null;
        const next = (_b = requested[index]) !== null && _b !== void 0 ? _b : null;
        if (!capable && next === null && isWeaponRivenInstanceId(old) && ownsInstance(old))
            return old;
        if (isWeaponRivenInstanceId(next) && (!capable || !ownsInstance(next)))
            return null;
        return next;
    });
}
exports.protectWeaponRivenPartySave = protectWeaponRivenPartySave;
