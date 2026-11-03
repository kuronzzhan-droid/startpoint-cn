"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWeaponRivenPartyInfoListSync = exports.playerHasWeaponRivensSync = exports.cleanupConvertedUnknownWeaponRivenPartiesSync = exports.trimUnknownWeaponRivenPartiesSync = exports.getSavedPartyIdsInGroupSync = exports.enforceWeaponRivenStartPartiesSync = exports.enforceWeaponRivenPartyLimitSync = void 0;
const db_1 = require("../db");
const party_1 = require("./party");
const types_1 = require("../types");
const codeMap_1 = require("../codeMap");
const constants_1 = require("../../lib/weapon-riven/constants");
const special_event_parties_1 = require("../../lib/special-event-parties");
const party_limit_1 = require("../../lib/weapon-riven/party-limit");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
/** Revalidate old saves at battle start: more than one revealed card makes every revealed card ineffective. */
function enforceWeaponRivenPartyLimitSync(playerId, partyId, category = types_1.PartyCategory.NORMAL) {
    const parsed = (0, special_event_parties_1.parseGlobalPartyId)(partyId);
    if (!parsed)
        return [];
    const operation = () => {
        const db = (0, db_1.getDb)();
        const row = db.prepare(`SELECT ability_soul_1,ability_soul_2,ability_soul_3 FROM players_parties
            WHERE player_id=? AND category=? AND group_id=? AND slot=?`)
            .get(playerId, category, parsed.groupId, parsed.slot);
        if (!row)
            return [];
        const before = [row.ability_soul_1, row.ability_soul_2, row.ability_soul_3];
        const after = (0, party_limit_1.stripIneffectiveWeaponRivenSouls)(before);
        if (after.every((id, index) => id === before[index]))
            return [];
        db.prepare(`UPDATE players_parties SET ability_soul_1=?,ability_soul_2=?,ability_soul_3=?
            WHERE player_id=? AND category=? AND group_id=? AND slot=?`)
            .run(...after, playerId, category, parsed.groupId, parsed.slot);
        // A cached lobby wire party read before this repair must not outlive it.
        require("../../multi/party-snapshot").invalidateRealPartySnapshot(playerId);
        return getWeaponRivenPartyInfoListSync(playerId, [{ category, group_id: parsed.groupId, slot: parsed.slot }]);
    };
    return (0, db_1.getDb)().inTransaction ? operation() : (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "player", playerId, operation: "limit_weapon_riven_party",
    }, operation);
}
exports.enforceWeaponRivenPartyLimitSync = enforceWeaponRivenPartyLimitSync;
/**
 * Battle-start entry for routes other than /single_battle_quest/start (rush_event, raid_event, multi):
 * apply the over-limit rule to every named saved party, then return the authoritative parties when
 * something changed, the player owns revealed cards (a stale client cache may still hold two), or a
 * revealed reference remains. Call inside the start transaction.
 */
function enforceWeaponRivenStartPartiesSync(playerId, category, partyIds) {
    const keys = [];
    let changed = false;
    for (const partyId of partyIds) {
        const parsed = (0, special_event_parties_1.parseGlobalPartyId)(partyId);
        if (!parsed || keys.some(key => key.group_id === parsed.groupId && key.slot === parsed.slot))
            continue;
        keys.push({ category, group_id: parsed.groupId, slot: parsed.slot });
        if (enforceWeaponRivenPartyLimitSync(playerId, partyId, category).length > 0)
            changed = true;
    }
    if (keys.length === 0)
        return [];
    const current = getWeaponRivenPartyInfoListSync(playerId, keys);
    return changed || playerHasWeaponRivensSync(playerId)
        || current.some(party => party.ability_soul_ids.some(id => (0, constants_1.isWeaponRivenItemId)(id))) ? current : [];
}
exports.enforceWeaponRivenStartPartiesSync = enforceWeaponRivenStartPartiesSync;
/** Every saved slot of one party group (raid starts name a group, not a party). */
function getSavedPartyIdsInGroupSync(playerId, category, groupId) {
    if (!Number.isSafeInteger(groupId) || groupId < 1 || groupId > 12)
        return [];
    return (0, db_1.getDb)().prepare(`SELECT slot FROM players_parties WHERE player_id=? AND category=? AND group_id=?
        ORDER BY slot`).all(playerId, category, groupId)
        .filter(row => Number.isSafeInteger(row.slot) && row.slot >= 1 && row.slot <= 10)
        .map(row => (groupId - 1) * 10 + row.slot);
}
exports.getSavedPartyIdsInGroupSync = getSavedPartyIdsInGroupSync;
/** Keep the earliest saved references, leaving unconverted battle-party slots untouched. */
function trimUnknownWeaponRivenPartiesSync(playerId, remaining, protectedParty, itemId = constants_1.UNKNOWN_RIVEN_ITEM_ID) {
    const db = (0, db_1.getDb)();
    if (!db.inTransaction)
        throw new Error("Unknown riven party cleanup requires a transaction");
    const parties = db.prepare(`SELECT category,group_id,slot,ability_soul_1,ability_soul_2,ability_soul_3
        FROM players_parties WHERE player_id=?
        AND (ability_soul_1=? OR ability_soul_2=? OR ability_soul_3=?)
        ORDER BY category,group_id,slot`).all(playerId, itemId, itemId, itemId);
    let excess = parties.reduce((total, party) => total + [party.ability_soul_1, party.ability_soul_2, party.ability_soul_3]
        .filter(id => id === itemId).length, 0) - Math.max(0, remaining);
    const changed = [];
    for (const party of parties.reverse()) {
        if (excess <= 0)
            break;
        if (protectedParty && party.category === protectedParty.category
            && party.group_id === protectedParty.group_id && party.slot === protectedParty.slot)
            continue;
        const souls = [party.ability_soul_1, party.ability_soul_2, party.ability_soul_3];
        for (let slot = souls.length - 1; slot >= 0 && excess > 0; slot--) {
            if (souls[slot] !== itemId)
                continue;
            souls[slot] = null;
            excess--;
        }
        db.prepare(`UPDATE players_parties SET ability_soul_1=?,ability_soul_2=?,ability_soul_3=?
            WHERE player_id=? AND category=? AND group_id=? AND slot=?`)
            .run(...souls, playerId, party.category, party.group_id, party.slot);
        changed.push({ category: party.category, group_id: party.group_id, slot: party.slot });
    }
    return changed.reverse();
}
exports.trimUnknownWeaponRivenPartiesSync = trimUnknownWeaponRivenPartiesSync;
const sameParty = (a, b) => a.category === b.category && a.group_id === b.group_id && a.slot === b.slot;
/**
 * Clear only consumed frozen slots, then apply the historical excess rule to other parties.
 * `remaining` is the plain unknown balance, or a per-item balance map for themed unknown cards;
 * `slotItemIds[i]` names the card consumed in `convertedSlots[i]` (default: the plain unknown card).
 */
function cleanupConvertedUnknownWeaponRivenPartiesSync(playerId, remaining, partyId, convertedSlots, slotItemIds = []) {
    const db = (0, db_1.getDb)();
    if (!db.inTransaction)
        throw new Error("Unknown riven party cleanup requires a transaction");
    if (convertedSlots.length === 0)
        return [];
    const balances = typeof remaining === "number" ? { [constants_1.UNKNOWN_RIVEN_ITEM_ID]: remaining } : remaining;
    const itemIds = Object.keys(balances).map(Number);
    const merge = (lists) => {
        const result = [];
        for (const key of lists.flat())
            if (!result.some(other => sameParty(other, key)))
                result.push(key);
        return result.sort((a, b) => a.category - b.category || a.group_id - b.group_id || a.slot - b.slot);
    };
    const parsed = partyId === undefined ? null : (0, special_event_parties_1.parseGlobalPartyId)(partyId);
    // Old battles did not freeze a party ID. Never infer it from today's selected party.
    if (!parsed)
        return merge(itemIds.map(itemId => trimUnknownWeaponRivenPartiesSync(playerId, balances[itemId], undefined, itemId)));
    const party = { category: types_1.PartyCategory.NORMAL, group_id: parsed.groupId, slot: parsed.slot };
    const columns = ["ability_soul_1", "ability_soul_2", "ability_soul_3"];
    let changed = false;
    convertedSlots.forEach((slot, index) => {
        var _a;
        if (!Number.isInteger(slot) || slot < 0 || slot >= columns.length)
            return;
        const column = columns[slot];
        // A later edit may have replaced this soul; never clear its replacement.
        const result = db.prepare(`UPDATE players_parties SET ${column}=NULL
            WHERE player_id=? AND category=? AND group_id=? AND slot=? AND ${column}=?`)
            .run(playerId, party.category, party.group_id, party.slot, (_a = slotItemIds[index]) !== null && _a !== void 0 ? _a : constants_1.UNKNOWN_RIVEN_ITEM_ID);
        changed = result.changes > 0 || changed;
    });
    const trimmed = merge(itemIds.map(itemId => trimUnknownWeaponRivenPartiesSync(playerId, balances[itemId], party, itemId)))
        .filter(key => !sameParty(key, party));
    return changed ? [party, ...trimmed] : trimmed;
}
exports.cleanupConvertedUnknownWeaponRivenPartiesSync = cleanupConvertedUnknownWeaponRivenPartiesSync;
/** Owners of revealed cards get their authoritative selected party back at every battle start. */
function playerHasWeaponRivensSync(playerId) {
    return (0, db_1.getDb)().prepare("SELECT 1 FROM player_weapon_rivens WHERE player_id=? LIMIT 1").get(playerId) !== undefined;
}
exports.playerHasWeaponRivensSync = playerHasWeaponRivensSync;
/** Re-read saved parties so a settlement replay cannot overwrite a later party edit. */
function getWeaponRivenPartyInfoListSync(playerId, keys) {
    const categories = new Map([...new Set(keys.map(key => key.category))].map(category => [category,
        (0, party_1.getPlayerPartyGroupListSync)(playerId, category)]));
    return keys.map(key => {
        var _a, _b;
        const party = (_b = (_a = categories.get(key.category)) === null || _a === void 0 ? void 0 : _a[key.group_id]) === null || _b === void 0 ? void 0 : _b.list[key.slot];
        if (!party)
            return null;
        return { party_id: (key.group_id - 1) * 10 + key.slot, party_category: key.category, party_name: party.name,
            character_ids: party.characterIds.map(id => id === null ? null : (0, codeMap_1.kIdToBusinessCode)(id)),
            unison_character_ids: party.unisonCharacterIds.map(id => id === null ? null : (0, codeMap_1.kIdToBusinessCode)(id)),
            equipment_ids: party.equipmentIds, ability_soul_ids: party.abilitySoulIds,
            party_edited: party.edited, options: { allow_other_players_to_heal_me: party.options.allowOtherPlayersToHealMe } };
    }).filter((party) => party !== null);
}
exports.getWeaponRivenPartyInfoListSync = getWeaponRivenPartyInfoListSync;
