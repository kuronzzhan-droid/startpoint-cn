"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PartySlotValidator = void 0;
const player_1 = require("../../data/domains/player");
const party_1 = require("../../data/domains/party");
const PARTY_SLOT_MAX = 120;
exports.PartySlotValidator = {
    name: "party-slot",
    version: 2,
    validate(playerId, context) {
        var _a;
        const player = (_a = context === null || context === void 0 ? void 0 : context.player) !== null && _a !== void 0 ? _a : (0, player_1.getPlayerSync)(playerId);
        if (!(player === null || player === void 0 ? void 0 : player.id))
            return 0;
        const validPartySlot = (0, party_1.findValidNormalPartySlotSync)(playerId, player.partySlot);
        if (validPartySlot !== null) {
            if (validPartySlot === player.partySlot)
                return 0;
            (0, player_1.updatePlayerSync)({ id: playerId, partySlot: validPartySlot });
            player.partySlot = validPartySlot;
            return 1;
        }
        // Preserve the old numeric fallback when a player has no usable
        // normal party yet; the party edit guard will prevent new empty
        // leaders from being persisted.
        if (player.partySlot >= 1 && player.partySlot <= PARTY_SLOT_MAX)
            return 0;
        (0, player_1.updatePlayerSync)({ id: playerId, partySlot: 1 });
        player.partySlot = 1;
        return 1;
    }
};
