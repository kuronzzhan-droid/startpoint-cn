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
exports.validateRivenSnapshotAdmission = exports.buildRivenSnapshot = exports.validateRivenRequest = void 0;
const node_crypto_1 = require("node:crypto");
const db_1 = require("../../data/db");
const activeAccount_1 = require("../../data/activeAccount");
const party_1 = require("../../data/domains/party");
const weapon_riven_party_1 = require("../../data/domains/weapon-riven-party");
const weapon_riven_quality_1 = require("../../data/initializers/weapon-riven-quality");
const types_1 = require("../../data/types");
const party_snapshot_1 = require("../../multi/party-snapshot");
const persistence_coordinator_1 = require("../persistence-coordinator");
const player_login_1 = require("../player-login");
const client_admission_1 = require("../client-admission");
const assets_1 = require("../assets");
const special_event_parties_1 = require("../special-event-parties");
const client_1 = require("./client");
const constants_1 = require("./constants");
const room_preview_1 = require("./room-preview");
const public_payload_1 = require("./public-payload");
const display_1 = require("./display");
const rules_1 = require("./rules");
const loadout_1 = require("./loadout");
const multi_protocol_1 = require("./multi-protocol");
const multi_catalog_1 = require("./multi-catalog");
const multi_types_1 = require("./multi-types");
const MATE_FIELDS = ["name", "rank", "degreeId", "leaderCharacterId", "mainCharacterId", "playerRoleKind", "isNewbie", "entryTime", "state", "autoplayMode", "autoskillMode", "autoSpeedLevel",
    "autoStart", "skillAbilityBehaviorMode", "dashBehaviorMode", "allowHealFromOtherPlayers", "preparation", "isHost"];
function validateRivenRequest(input) {
    var _a, _b;
    (0, multi_protocol_1.rivenIdentityKey)(input.identity);
    (0, multi_protocol_1.rivenInteger)(input.category, 1);
    (0, multi_protocol_1.rivenInteger)(input.questId, 1);
    if (!Array.isArray(input.members) || !input.members.length || input.members.length > 3)
        throw new Error("RIVEN_INVALID_ROSTER");
    const viewers = new Set(), players = new Set(), connections = new Set(), coms = new Set();
    for (const member of input.members) {
        (0, multi_protocol_1.rivenInteger)(member.viewerId, 1);
        (0, multi_protocol_1.rivenInteger)(member.playerId);
        if (typeof member.connectionId !== "string" || !/^[\x20-\x7e]{1,256}$/.test(member.connectionId))
            throw new Error("RIVEN_INVALID_CONNECTION");
        const comId = (0, multi_protocol_1.rivenInteger)((_b = (_a = member.mate) === null || _a === void 0 ? void 0 : _a.comId) !== null && _b !== void 0 ? _b : 0);
        if (viewers.has(member.viewerId) || connections.has(member.connectionId)
            || comId && (member.playerId !== 0 || coms.has(comId)) || !comId && (member.playerId === 0 || players.has(member.playerId)))
            throw new Error("RIVEN_DUPLICATE_MEMBER");
        viewers.add(member.viewerId);
        connections.add(member.connectionId);
        if (comId)
            coms.add(comId);
        else {
            players.add(member.playerId);
            if (!(0, special_event_parties_1.parseGlobalPartyId)((0, multi_protocol_1.rivenInteger)(member.partyId, 1)))
                throw new Error("RIVEN_INVALID_PARTY_ID");
        }
    }
    if (!players.size)
        throw new Error("RIVEN_NO_REAL_MEMBER");
    if (input.disabledReason !== undefined && !multi_types_1.RIVEN_FORCED_DISABLED_REASONS.includes(input.disabledReason))
        throw new Error("RIVEN_INVALID_DISABLED_REASON");
}
exports.validateRivenRequest = validateRivenRequest;
function authorized(member) {
    const accountId = (0, player_login_1.playerAccountByViewer)(member.viewerId);
    if (!accountId || (0, activeAccount_1.resolvePlayerIdSync)(accountId) !== member.playerId || !(0, player_login_1.playerSocketAllowed)(member.viewerId, member.session))
        throw new Error("RIVEN_PLAYER_AUTHORIZATION");
    const lease = (0, client_admission_1.clientAdmission)().socketLease(member.admissionToken, member.session, false);
    if (!lease.ok)
        throw new Error("RIVEN_ADMISSION_REJECTED");
    const capabilities = lease.weaponRiven;
    return capabilities !== null && capabilities !== void 0 ? capabilities : { p1: false, p2: false, catalog: "none" };
}
function authorize(input) {
    return input.members.filter(member => !member.mate.comId).map(authorized);
}
/**
 * `rivenFree`: no real member's saved party holds any riven item (revealed instance or unknown/themed unknown).
 * Such a room has nothing to freeze, so it is disabled with an empty ACK set and never waits on a riven ACK.
 * `input.disabledReason` is the owner's whole-room downgrade after a client NACKed an enabled prepare.
 */
function decide(input, capabilities, resources, fixed, rivenFree) {
    var _a;
    const real = input.members.filter(member => !member.mate.comId);
    const reason = (fixed ? "fixed_party" : process.env.WEAPON_RIVEN_MULTI_ENABLED !== "1" ? "server_disabled"
        : rivenFree ? "no_rivens"
            : capabilities.some(cap => !cap.p1 || !cap.p2) ? "mixed_version" : !resources ? "resources_unavailable"
                : capabilities.some(cap => cap.catalog !== resources.id) ? "catalog_mismatch" : "") || ((_a = input.disabledReason) !== null && _a !== void 0 ? _a : "");
    const ackConnectionIds = reason === "no_rivens" ? []
        : real.filter((_, i) => capabilities[i].p2).map(member => member.connectionId);
    return { mode: reason ? 0 : 1, reason, catalog: reason ? "none" : resources.id, ackConnectionIds };
}
function savedNormalParty(member) {
    var _a;
    const parsed = (0, special_event_parties_1.parseGlobalPartyId)(member.partyId);
    return (_a = (0, party_1.getPlayerPartyGroupListSync)(member.playerId, types_1.PartyCategory.NORMAL)[parsed.groupId]) === null || _a === void 0 ? void 0 : _a.list[parsed.slot];
}
/** Read after limit repair; a missing saved party is never riven-free (the build rejects it). */
function rivenFreeRoom(input) {
    return input.members.filter(member => !member.mate.comId).every(member => {
        const saved = savedNormalParty(member);
        return !!saved && !saved.abilitySoulIds.some((id) => (0, constants_1.isWeaponRivenItemId)(id) || (0, constants_1.isUnknownWeaponRivenItemId)(id));
    });
}
function resourceCatalog() {
    // An invalid deployment must not silently grant enabled effects.
    try {
        return (0, multi_catalog_1.readRivenResourceCatalog)();
    }
    catch (_a) {
        return null;
    }
}
function fixedQuest(input) {
    const quest = (0, assets_1.getQuestFromCategorySync)(input.category, input.questId);
    if (!quest)
        throw new Error("RIVEN_QUEST_MISSING");
    return "fixedParty" in quest && quest.fixedParty !== undefined;
}
function mateWithParty(member, party) {
    const mate = { viewerId: member.viewerId, playerId: member.playerId, connectionId: member.connectionId, currentPartyId: member.partyId, party };
    if (member.mate.comId)
        mate.comId = member.mate.comId;
    for (const field of MATE_FIELDS)
        if (member.mate[field] !== undefined)
            mate[field] = (0, multi_protocol_1.cloneRivenJson)(member.mate[field]);
    return mate;
}
function partyContext(party, snapshotId, decision) {
    return Object.assign(Object.assign({}, party), { weapon_rivens: [[1], [1], [1]], weapon_riven_scope: multi_protocol_1.RIVEN_MULTI_SCOPE, weapon_riven_snapshot_id: snapshotId, weapon_riven_mode: decision.mode, weapon_riven_catalog: decision.catalog, weapon_riven_reason: decision.reason });
}
/** All migrations/limit repairs finish first; all members are then read synchronously in one transaction. */
function buildRivenSnapshot(input) {
    return __awaiter(this, void 0, void 0, function* () {
        validateRivenRequest(input);
        const fixed = fixedQuest(input), resources = resourceCatalog(), snapshotId = (0, node_crypto_1.randomUUID)();
        return (0, persistence_coordinator_1.runPersistenceTransaction)({ domain: "player", operation: "freeze_multi_weapon_rivens" }, () => {
            const capabilities = authorize(input);
            if (!fixed)
                for (const member of input.members)
                    if (!member.mate.comId) {
                        (0, weapon_riven_quality_1.migrateWeaponRivenQualities)((0, db_1.getDb)(), member.playerId);
                        (0, weapon_riven_party_1.enforceWeaponRivenPartyLimitSync)(member.playerId, member.partyId);
                    }
            const decision = decide(input, capabilities, resources, fixed, !fixed && rivenFreeRoom(input));
            const audit = [], conversionLoadouts = [];
            const members = input.members.map(member => {
                if (member.mate.comId)
                    return mateWithParty(member, (0, multi_protocol_1.cloneRivenJson)((0, public_payload_1.stripWeaponRivenPublicPayload)(member.mate.party)));
                if (fixed)
                    return mateWithParty(member, partyContext((0, multi_protocol_1.cloneRivenJson)((0, room_preview_1.stripWeaponRivenRoomPreview)(member.mate.party)), snapshotId, decision));
                const savedParty = savedNormalParty(member);
                if (!savedParty)
                    throw new Error("RIVEN_SAVED_PARTY_MISSING");
                const party = partyContext((0, multi_protocol_1.cloneRivenJson)((0, party_snapshot_1.buildRealParty)(member.playerId, savedParty)), snapshotId, decision);
                conversionLoadouts.push({ playerId: member.playerId, loadout: (0, loadout_1.normalizeWeaponRivenLoadout)(Object.assign(Object.assign({}, savedParty), { partyId: member.partyId })) });
                if (decision.mode)
                    for (let slot = 0; slot < 3; slot++) {
                        const itemId = savedParty.abilitySoulIds[slot];
                        if (!(0, client_1.isWeaponRivenInstanceId)(itemId))
                            continue;
                        const row = (0, db_1.getDb)().prepare(`SELECT riven_id,item_id,weapon_id,revision,affixes_json,affix_version
                    FROM player_weapon_rivens WHERE player_id=? AND item_id=?`).get(member.playerId, itemId);
                        if (!row || row.item_id !== itemId || !Number.isSafeInteger(row.riven_id) || row.riven_id <= 0
                            || !Number.isSafeInteger(row.revision) || row.revision < 0 || row.affix_version !== 3)
                            throw new Error("RIVEN_INVALID_OWNERSHIP");
                        const affixes = JSON.parse(row.affixes_json);
                        if (!Array.isArray(affixes) || affixes.length < 1 || affixes.length > 4)
                            throw new Error("RIVEN_INVALID_AFFIXES");
                        const pairs = (0, display_1.displayWeaponRivenAffixes)(row.weapon_id, affixes, row.affix_version, rules_1.weaponRivenRuleSet);
                        party.abilitySoulIds[slot] = [0, itemId];
                        party.weapon_rivens[slot] = [0, [itemId, row.weapon_id, ...pairs.flatMap(([key, level]) => [key, level])]];
                        audit.push({ playerId: member.playerId, slot, itemId, rivenId: row.riven_id, revision: row.revision, weaponId: row.weapon_id });
                    }
                return mateWithParty(member, party);
            });
            const canonical = (0, multi_protocol_1.canonicalRivenMembers)(members, decision.mode ? resources : undefined);
            return Object.assign(Object.assign({ identity: (0, multi_protocol_1.cloneRivenJson)(input.identity), snapshotId, members, canonical, sha256: (0, node_crypto_1.createHash)("sha256").update(canonical, "ascii").digest("hex") }, decision), { rulesDigest: (0, multi_catalog_1.rivenRulesDigest)(rules_1.weaponRivenRuleSet), conversionLoadouts, audit });
        });
    });
}
exports.buildRivenSnapshot = buildRivenSnapshot;
/**
 * Recheck authorization and whole-room decision without rebuilding frozen parties or rows.
 * Riven presence is a property of the frozen rows, so it is taken from the snapshot, not re-read.
 */
function validateRivenSnapshotAdmission(input, snapshot) {
    const fixed = fixedQuest(input);
    const current = decide(input, authorize(input), resourceCatalog(), fixed, !fixed && snapshot.reason === "no_rivens");
    if (current.mode !== snapshot.mode || current.catalog !== snapshot.catalog || current.reason !== snapshot.reason
        || current.ackConnectionIds.join("|") !== snapshot.ackConnectionIds.join("|"))
        throw new Error("RIVEN_ADMISSION_CHANGED");
}
exports.validateRivenSnapshotAdmission = validateRivenSnapshotAdmission;
