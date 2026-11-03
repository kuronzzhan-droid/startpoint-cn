"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshWeaponRivenSettlementResponseSync = exports.refreshWeaponRivenSettlementDataSync = void 0;
const item_1 = require("../../data/domains/item");
const weaponRiven_1 = require("../../data/domains/weaponRiven");
const weapon_riven_party_1 = require("../../data/domains/weapon-riven-party");
/** The receipt fixes the reward decision; current balances and parties remain authoritative. */
function refreshWeaponRivenSettlementDataSync(playerId, data) {
    var _a, _b, _c;
    const refreshed = Object.assign({}, data);
    if (data.item_list)
        refreshed.item_list = Object.fromEntries(Object.keys(data.item_list)
            .map(id => { var _a; return [id, (_a = (0, item_1.getPlayerItemSync)(playerId, id)) !== null && _a !== void 0 ? _a : 0]; }));
    if (data.weapon_riven_list) {
        // The overflow decision is frozen, including affixes and reward amounts. Old receipts had none.
        refreshed.weapon_riven_auto_dismantled = (_a = data.weapon_riven_auto_dismantled) !== null && _a !== void 0 ? _a : [];
        const current = {};
        const deleted = [];
        const itemIds = new Set([...Object.keys(data.weapon_riven_list).map(Number), ...((_b = data.weapon_riven_deleted) !== null && _b !== void 0 ? _b : [])]);
        for (const itemId of itemIds) {
            const riven = (0, weaponRiven_1.getPlayerWeaponRivenSync)(playerId, itemId);
            if (riven)
                current[itemId] = riven;
            else
                deleted.push(itemId);
        }
        refreshed.weapon_riven_list = current;
        refreshed.weapon_riven_deleted = deleted;
        // Old receipts predate the explicit grant list. Their frozen cards still identify
        // the rewards, but a recycled item slot must never label its replacement as a grant.
        const granted = (_c = data.weapon_riven_granted) !== null && _c !== void 0 ? _c : Object.keys(data.weapon_riven_list).map(Number);
        refreshed.weapon_riven_granted = granted.filter(itemId => {
            var _a;
            const original = data.weapon_riven_list[itemId];
            return original && ((_a = current[itemId]) === null || _a === void 0 ? void 0 : _a.riven_id) === original.riven_id;
        });
    }
    if (data.party_info_list)
        refreshed.party_info_list = (0, weapon_riven_party_1.getWeaponRivenPartyInfoListSync)(playerId, data.party_info_list.map(party => ({ category: party.party_category,
            group_id: Math.floor((party.party_id - 1) / 10) + 1, slot: (party.party_id - 1) % 10 + 1 })));
    return refreshed;
}
exports.refreshWeaponRivenSettlementDataSync = refreshWeaponRivenSettlementDataSync;
/** Only riven-aware five-boss receipts need this projection; ordinary solo receipts are unchanged. */
function refreshWeaponRivenSettlementResponseSync(playerId, response) {
    const data = response === null || response === void 0 ? void 0 : response.data;
    if (!(data === null || data === void 0 ? void 0 : data.weapon_riven_list))
        return response;
    return Object.assign(Object.assign({}, response), { data: refreshWeaponRivenSettlementDataSync(playerId, data) });
}
exports.refreshWeaponRivenSettlementResponseSync = refreshWeaponRivenSettlementResponseSync;
