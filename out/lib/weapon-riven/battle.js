"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMultiWeaponRivenLoadoutSync = exports.getSoloWeaponRivenLoadoutSync = exports.getSoloWeaponRivenStartLoadoutSync = void 0;
const db_1 = require("../../data/db");
const party_1 = require("../../data/domains/party");
const types_1 = require("../../data/types");
const weapon_riven_party_1 = require("../../data/domains/weapon-riven-party");
const special_event_parties_1 = require("../special-event-parties");
const loadout_1 = require("./loadout");
function getSoloWeaponRivenStartLoadoutSync(playerId, partyId) {
    var _a;
    const parsed = partyId === undefined ? null : (0, special_event_parties_1.parseGlobalPartyId)(partyId);
    if (parsed)
        (0, weapon_riven_party_1.enforceWeaponRivenPartyLimitSync)(playerId, partyId);
    const party = parsed && ((_a = (0, party_1.getPlayerPartyGroupListSync)(playerId, types_1.PartyCategory.NORMAL)[String(parsed.groupId)]) === null || _a === void 0 ? void 0 : _a.list[String(parsed.slot)]);
    return (0, loadout_1.normalizeWeaponRivenLoadout)(party ? Object.assign(Object.assign({}, party), { partyId }) : undefined);
}
exports.getSoloWeaponRivenStartLoadoutSync = getSoloWeaponRivenStartLoadoutSync;
function getSoloWeaponRivenLoadoutSync(playerId, playId) {
    const row = (0, db_1.getDb)().prepare(`SELECT riven_loadout_json FROM five_boss_solo_runs
        WHERE player_id = ? AND play_id = ? AND status = 'active'`).get(playerId, playId);
    if (!row)
        throw new Error("No active five-boss solo loadout.");
    return (0, loadout_1.parseWeaponRivenLoadout)(row.riven_loadout_json);
}
exports.getSoloWeaponRivenLoadoutSync = getSoloWeaponRivenLoadoutSync;
function getMultiWeaponRivenLoadoutSync(playerId, runId) {
    const row = (0, db_1.getDb)().prepare(`SELECT riven_loadout_json FROM five_boss_gauntlet_members
        WHERE player_id = ? AND run_id = ?`).get(playerId, runId);
    if (!row)
        throw new Error("No five-boss member loadout.");
    return (0, loadout_1.parseWeaponRivenLoadout)(row.riven_loadout_json);
}
exports.getMultiWeaponRivenLoadoutSync = getMultiWeaponRivenLoadoutSync;
