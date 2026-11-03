"use strict";
// Tracks character quest clears for awakening missions
// Leader (position 0) tracked separately for "以X为队长" tasks
// Other party members for "队伍中编有X" tasks
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackCharacterClears = void 0;
const character_clear_1 = require("../../../data/domains/character_clear");
function trackCharacterClears(ctx) {
    var _a, _b;
    const party = ctx.party;
    const leaderId = (_a = party.characters[0]) === null || _a === void 0 ? void 0 : _a.id;
    const isMulti = (_b = ctx.isMulti) !== null && _b !== void 0 ? _b : false;
    const members = [];
    if (leaderId) {
        members.push({ characterId: leaderId, isLeader: true });
    }
    const seen = new Set([leaderId].filter(Boolean));
    for (let i = 1; i < party.characters.length; i++) {
        const c = party.characters[i];
        if ((c === null || c === void 0 ? void 0 : c.id) && !seen.has(c.id)) {
            members.push({ characterId: c.id, isLeader: false });
            seen.add(c.id);
        }
    }
    for (const c of party.unison_characters) {
        if ((c === null || c === void 0 ? void 0 : c.id) && !seen.has(c.id)) {
            members.push({ characterId: c.id, isLeader: false });
            seen.add(c.id);
        }
    }
    (0, character_clear_1.incrementPlayerCharacterClearsSync)(ctx.playerId, members, isMulti);
}
exports.trackCharacterClears = trackCharacterClears;
