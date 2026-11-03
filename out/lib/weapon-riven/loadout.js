"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseWeaponRivenLoadout = exports.normalizeWeaponRivenLoadout = void 0;
const party_limit_1 = require("./party-limit");
function slots(value) {
    return [0, 1, 2].map(index => {
        const id = Array.isArray(value) ? value[index] : undefined;
        return Number.isSafeInteger(id) && id > 0 ? id : 0;
    });
}
function normalizeWeaponRivenLoadout(value) {
    const input = value;
    const loadout = {
        abilitySoulIds: (0, party_limit_1.stripIneffectiveWeaponRivenSouls)(slots(input === null || input === void 0 ? void 0 : input.abilitySoulIds)).map(id => id !== null && id !== void 0 ? id : 0),
        equipmentIds: slots(input === null || input === void 0 ? void 0 : input.equipmentIds),
    };
    // Keep this owner-side module independent of data modules, including data/types enums.
    if (typeof (input === null || input === void 0 ? void 0 : input.partyId) === "number" && Number.isInteger(input.partyId)
        && input.partyId >= 1 && input.partyId <= 120)
        loadout.partyId = input.partyId;
    return loadout;
}
exports.normalizeWeaponRivenLoadout = normalizeWeaponRivenLoadout;
function parseWeaponRivenLoadout(json) {
    // Migration defaults are empty: never reconstruct an old battle from its current party.
    return normalizeWeaponRivenLoadout(JSON.parse(json));
}
exports.parseWeaponRivenLoadout = parseWeaponRivenLoadout;
