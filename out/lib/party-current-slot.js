"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.usesNormalCurrentPartySlot = void 0;
const types_1 = require("./types");
/**
 * Carnival, Raid, and Rush use their own persisted party categories.  The
 * legacy players.party_slot field remains the NORMAL/home-party pointer and
 * must not be overwritten by those event selections.
 */
function usesNormalCurrentPartySlot(category) {
    const normalizedCategory = Number(category);
    return normalizedCategory !== types_1.QuestCategory.CARNIVAL_EVENT
        && normalizedCategory !== types_1.QuestCategory.RAID_EVENT
        && normalizedCategory !== types_1.QuestCategory.RUSH_EVENT;
}
exports.usesNormalCurrentPartySlot = usesNormalCurrentPartySlot;
