"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshWeaponRivenSettlementResponseAfterCommit = exports.refreshWeaponRivenPartiesAfterCommit = void 0;
const types_1 = require("../../data/types");
const party_snapshot_1 = require("../../multi/party-snapshot");
const default_runtime_1 = require("../../multi/coordinator/default-runtime");
const settlement_response_1 = require("./settlement-response");
/** Invoke only after the inventory/party transaction has committed. */
function refreshWeaponRivenPartiesAfterCommit(playerId_1) {
    return __awaiter(this, arguments, void 0, function* (playerId, parties = []) {
        if (parties.length === 0)
            return;
        (0, party_snapshot_1.invalidateRealPartySnapshot)(playerId);
        try {
            yield (0, default_runtime_1.getRoomCommandGateway)().execute("runtime.partyChanged", { playerId,
                changedPartyIds: parties.filter(party => party.party_category === types_1.PartyCategory.NORMAL).map(party => party.party_id),
                selectionChanged: false });
        }
        catch (error) {
            console.error(`[RIVEN] committed party cleanup; lobby refresh failed: player=${playerId}`, error);
        }
    });
}
exports.refreshWeaponRivenPartiesAfterCommit = refreshWeaponRivenPartiesAfterCommit;
/** A retry also repairs cache invalidation lost after a previous durable commit. */
function refreshWeaponRivenSettlementResponseAfterCommit(playerId, response) {
    return __awaiter(this, void 0, void 0, function* () {
        const current = (0, settlement_response_1.refreshWeaponRivenSettlementResponseSync)(playerId, response);
        const data = current === null || current === void 0 ? void 0 : current.data;
        if (data === null || data === void 0 ? void 0 : data.weapon_riven_list)
            yield refreshWeaponRivenPartiesAfterCommit(playerId, data.party_info_list);
        return current;
    });
}
exports.refreshWeaponRivenSettlementResponseAfterCommit = refreshWeaponRivenSettlementResponseAfterCommit;
