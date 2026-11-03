"use strict";
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidateRealPartySnapshot = exports.setRealPartySnapshot = exports.getRealPartySnapshot = exports.primeRealPartySnapshot = exports.buildRealParty = void 0;
const character_1 = require("../data/domains/character");
const equipment_1 = require("../data/domains/equipment");
const party_1 = require("../data/domains/party");
const types_1 = require("../data/types");
const memory_diagnostics_1 = require("../lib/memory-diagnostics");
const client_1 = require("../lib/weapon-riven/client");
const CACHE_TTL_MS = Math.max(5000, Number.parseInt((_a = process.env.MULTI_PARTY_SNAPSHOT_TTL_MS) !== null && _a !== void 0 ? _a : "10000", 10) || 10000);
const CACHE_MAX_ENTRIES = Math.max(100, Number.parseInt((_b = process.env.MULTI_PARTY_SNAPSHOT_MAX_ENTRIES) !== null && _b !== void 0 ? _b : "1000", 10) || 1000);
const snapshots = new Map();
let cacheHits = 0;
let cacheMisses = 0;
let cacheWrites = 0;
(0, memory_diagnostics_1.registerMemoryCounters)("multiPartySnapshot", _detailed => ({
    entries: snapshots.size,
    hits: cacheHits,
    misses: cacheMisses,
    writes: cacheWrites,
    ttlMs: CACHE_TTL_MS,
    maxEntries: CACHE_MAX_ENTRIES,
}));
function storeSnapshot(playerId, party) {
    if (!snapshots.has(playerId) && snapshots.size >= CACHE_MAX_ENTRIES) {
        const oldest = snapshots.keys().next().value;
        if (Number.isSafeInteger(oldest))
            snapshots.delete(oldest);
    }
    snapshots.set(playerId, { party, expiresAt: Date.now() + CACHE_TTL_MS });
    cacheWrites++;
}
function getLiveSnapshot(playerId) {
    const current = snapshots.get(playerId);
    if (!current)
        return null;
    if (current.expiresAt <= Date.now()) {
        snapshots.delete(playerId);
        return null;
    }
    return current.party;
}
/** Build the legacy wire party used by the lobby Welcome packet. */
function buildRealParty(playerId, targetParty) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const filledChars = [];
    const filledUnison = [];
    const filledEquips = [];
    const filledSouls = [];
    // Search for an NPC-named party across NORMAL and EVENT categories.
    let selectedParty = targetParty !== null && targetParty !== void 0 ? targetParty : null;
    if (!selectedParty) {
        for (const category of [types_1.PartyCategory.NORMAL, types_1.PartyCategory.EVENT]) {
            const groups = (0, party_1.getPlayerPartyGroupListSync)(playerId, category);
            for (const group of Object.values(groups)) {
                for (const party of Object.values(group.list)) {
                    if (party.name && party.name.includes("NPC")) {
                        selectedParty = party;
                        break;
                    }
                }
                if (selectedParty)
                    break;
            }
            if (selectedParty)
                break;
        }
    }
    for (let i = 0; i < 3; i++) {
        const charId = (_a = selectedParty === null || selectedParty === void 0 ? void 0 : selectedParty.characterIds[i]) !== null && _a !== void 0 ? _a : null;
        if (!charId) {
            filledChars.push([1]);
        }
        else {
            const dbChar = (0, character_1.getPlayerCharacterSync)(playerId, charId);
            if (!dbChar) {
                filledChars.push([1]);
            }
            else {
                // 觉醒等级要原样带上：客户端按这张表的值判定觉醒能力和技能档位
                const manaNodeMap = Object.assign({}, (0, character_1.getPlayerCharacterManaNodeAwakeLevelsSync)(playerId, charId));
                const exBoost = ((_c = (_b = dbChar.exBoost) === null || _b === void 0 ? void 0 : _b.abilityIdList) === null || _c === void 0 ? void 0 : _c.length)
                    ? [0, { ability_id_list: dbChar.exBoost.abilityIdList, status_id: dbChar.exBoost.statusId }]
                    : [1];
                filledChars.push([0, {
                        id: charId,
                        evolution_level: dbChar.evolutionLevel,
                        exp: dbChar.exp,
                        over_limit_step: dbChar.overLimitStep,
                        mana_node_ids: manaNodeMap,
                        ex_boost: exBoost,
                        illustration_settings: [1],
                    }]);
            }
        }
        const unisonId = (_d = selectedParty === null || selectedParty === void 0 ? void 0 : selectedParty.unisonCharacterIds[i]) !== null && _d !== void 0 ? _d : null;
        if (!unisonId) {
            filledUnison.push([1]);
        }
        else {
            const dbUnison = (0, character_1.getPlayerCharacterSync)(playerId, unisonId);
            if (!dbUnison) {
                filledUnison.push([1]);
            }
            else {
                const nodeMap = Object.assign({}, (0, character_1.getPlayerCharacterManaNodeAwakeLevelsSync)(playerId, unisonId));
                const unisonExBoost = ((_f = (_e = dbUnison.exBoost) === null || _e === void 0 ? void 0 : _e.abilityIdList) === null || _f === void 0 ? void 0 : _f.length)
                    ? [0, { ability_id_list: dbUnison.exBoost.abilityIdList, status_id: dbUnison.exBoost.statusId }]
                    : [1];
                filledUnison.push([0, {
                        id: unisonId,
                        evolution_level: dbUnison.evolutionLevel,
                        exp: dbUnison.exp,
                        over_limit_step: dbUnison.overLimitStep,
                        mana_node_ids: nodeMap,
                        ex_boost: unisonExBoost,
                        illustration_settings: [1],
                    }]);
            }
        }
        const equipId = (_g = selectedParty === null || selectedParty === void 0 ? void 0 : selectedParty.equipmentIds[i]) !== null && _g !== void 0 ? _g : null;
        if (!equipId) {
            filledEquips.push([1]);
        }
        else {
            const dbEquip = (0, equipment_1.getPlayerEquipmentSync)(playerId, equipId);
            filledEquips.push(dbEquip
                ? [0, { equipmentId: equipId, level: dbEquip.level, enhancementLevel: dbEquip.enhancementLevel }]
                : [1]);
        }
        const soulId = (_h = selectedParty === null || selectedParty === void 0 ? void 0 : selectedParty.abilitySoulIds[i]) !== null && _h !== void 0 ? _h : null;
        filledSouls.push(soulId && !(0, client_1.isWeaponRivenInstanceId)(soulId) ? [0, soulId] : [1]);
    }
    return {
        characters: filledChars,
        unison_characters: filledUnison,
        equipments: filledEquips,
        abilitySoulIds: filledSouls,
    };
}
exports.buildRealParty = buildRealParty;
/** Prime the snapshot before the subsequent TCP handshake. */
function primeRealPartySnapshot(playerId, targetParty) {
    if (targetParty)
        return buildRealParty(playerId, targetParty);
    const cached = getLiveSnapshot(playerId);
    if (cached !== null) {
        cacheHits++;
        return cached;
    }
    const party = buildRealParty(playerId);
    storeSnapshot(playerId, (0, client_1.stripWeaponRivenPartySouls)(party));
    return party;
}
exports.primeRealPartySnapshot = primeRealPartySnapshot;
/** Return a warmed party or build it once for backward-compatible direct TCP clients. */
function getRealPartySnapshot(playerId) {
    const cached = getLiveSnapshot(playerId);
    if (cached !== null) {
        cacheHits++;
        return cached;
    }
    cacheMisses++;
    return primeRealPartySnapshot(playerId);
}
exports.getRealPartySnapshot = getRealPartySnapshot;
/** Keep a client-selected party authoritative for reconnects in the same room. */
function setRealPartySnapshot(playerId, party) {
    if (!Number.isSafeInteger(playerId) || playerId <= 0 || !party || typeof party !== "object")
        return;
    storeSnapshot(playerId, (0, client_1.stripWeaponRivenPartySouls)(party));
}
exports.setRealPartySnapshot = setRealPartySnapshot;
function invalidateRealPartySnapshot(playerId) {
    snapshots.delete(playerId);
}
exports.invalidateRealPartySnapshot = invalidateRealPartySnapshot;
