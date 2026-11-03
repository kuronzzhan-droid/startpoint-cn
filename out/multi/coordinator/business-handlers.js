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
exports.handleRealtimeBusiness = void 0;
const node_crypto_1 = require("node:crypto");
const runtime_role_1 = require("./runtime-role");
const parentEpoch = (0, node_crypto_1.randomUUID)();
let revisionCounter = 0;
function positive(value) { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error("INVALID_BUSINESS_ID"); return n; }
function json(value) { return JSON.parse(JSON.stringify(value)); }
function readFacts(playerId, scope, viewerId = 0) {
    var _a, _b, _c;
    const player = require("../../data/domains/player").getPlayerSync(playerId);
    if (!player)
        throw new Error("PLAYER_NOT_FOUND");
    const partyId = (_b = (_a = scope.partyId) !== null && _a !== void 0 ? _a : player.partySlot) !== null && _b !== void 0 ? _b : 1;
    if (!Number.isSafeInteger(partyId) || partyId < 1 || partyId > 120
        || !Number.isSafeInteger(scope.category) || !Number.isSafeInteger(scope.questId))
        throw new Error("INVALID_FACTS_SCOPE");
    // Repair the saved party first (over-limit rule); anything read afterwards sees the repaired rows.
    const weaponRivenLoadout = require("../../lib/weapon-riven/battle").getSoloWeaponRivenStartLoadoutSync(playerId, partyId);
    const party = (_c = scope.wireParty) !== null && _c !== void 0 ? _c : require("../party-snapshot").getRealPartySnapshot(playerId);
    const mode = require("../../lib/mode15-optional");
    const exclusive = require("../npc/equipment-policy").exclusivePartyItems(party);
    const globalExclusive = mode.getMode15ExclusiveGlobalPartyItemsSync(playerId, 1, partyId);
    const equipmentAllowed = mode.isMode15EquipmentAllowedQuest(scope.category, scope.questId);
    const revision = ++revisionCounter;
    let snapshot = null;
    try {
        snapshot = require("../npc/quest-party-snapshot").captureQuestNpcPartySnapshot(playerId, scope.category, scope.questId, partyId, party);
    }
    catch ( /* Optional NPC history cannot reject an otherwise valid party. */_d) { /* Optional NPC history cannot reject an otherwise valid party. */ }
    return json({ parentEpoch, revision, playerId, viewerId, expiresAt: Date.now() + 120000,
        category: scope.category, questId: scope.questId, partyId, party,
        weaponRivenLoadout,
        player: { name: player.name, rank: require("../../lib/stamina").getRankDegree(player.rankPoint || 0),
            degreeId: player.degreeId || 1, leaderCharacterId: player.leaderCharacterId, role: player.role || 1,
            tutorialStep: player.tutorialStep || 0, partySlot: player.partySlot || 1 },
        ownedCharacterIds: Object.keys(require("../../data/domains/character").getPlayerCharactersSync(playerId)).map(Number),
        restrictedEquipment: !equipmentAllowed && (exclusive.length > 0 || globalExclusive.length > 0),
        guestEligibility: Number(scope.category) === 20
            ? { allowed: false, reason: "tower_dungeon_single_only" }
            : require("../guest-eligibility").canJoinMultiGuestQuestSync(playerId, scope.category, scope.questId, player),
        questNpcPartySnapshot: snapshot,
        questPolicy: { isMode15: mode.isMode15Quest(scope.category, scope.questId), equipmentAllowed,
            hostAllowed: Number(scope.category) !== 20 && (!mode.isMode15Quest(scope.category, scope.questId)
                || mode.canStartMode15QuestSync(playerId, scope.category, scope.questId).allowed),
            exclusiveItemIds: [...new Set([...exclusive, ...globalExclusive])] },
    });
}
/** This module is dispatched in the business parent only. Lazy imports keep the owner DB-free. */
function handleRealtimeBusiness(kind, input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        if ((0, runtime_role_1.isRealtimeOwnerChild)())
            throw new Error("REALTIME_BUSINESS_PARENT_ONLY");
        const payload = input;
        switch (kind) {
            case "player.authorize": return require("../../lib/player-login").playerSocketAllowed(payload.viewerId, (_a = payload.session) !== null && _a !== void 0 ? _a : undefined);
            case "player.handshake": {
                const viewerId = positive(payload.viewerId);
                if (!require("../../lib/player-login").playerSocketAllowed(viewerId, (_b = payload.session) !== null && _b !== void 0 ? _b : undefined))
                    return null;
                const context = yield require("../player-context").resolveMultiPlayerContext(viewerId);
                if (!require("../../lib/player-login").playerSocketAllowed(viewerId, (_c = payload.session) !== null && _c !== void 0 ? _c : undefined))
                    return null;
                return context ? readFacts(context.playerId, payload, viewerId) : null;
            }
            case "player.facts": return readFacts(positive(payload.playerId), payload);
            case "player.party": {
                const playerId = positive(payload.playerId);
                const currentPlayer = require("../../data/domains/player").getPlayerSync(playerId);
                if (payload.expectedSavedPartyId !== undefined && (currentPlayer === null || currentPlayer === void 0 ? void 0 : currentPlayer.partySlot) !== payload.expectedSavedPartyId) {
                    return readFacts(playerId, { category: payload.category, questId: payload.questId });
                }
                if (payload.party !== undefined)
                    require("../party-snapshot").setRealPartySnapshot(playerId, payload.party);
                if (payload.partyId !== undefined)
                    yield require("../../data/domains/player").updatePlayerPartySlotAsync(playerId, positive(payload.partyId));
                return readFacts(playerId, Object.assign(Object.assign({}, payload), { wireParty: payload.party }));
            }
            case "presence.touch": return require("../../lib/online-presence").markPlayerOnlineFromTcp(positive(payload.viewerId));
            case "npc.parties": return require("../../lib/weapon-riven/public-payload").stripWeaponRivenPublicPayload(require("../npc/player-party-pool").getRandomPlayerNpcPartiesSync(payload.playerId, Math.max(0, Math.min(2, Number(payload.count))), require("../npc/player-party-pool").getNpcPartySelectionOptions(payload.category, payload.questId)).map((entry) => entry.party));
            case "npc.mates": {
                const { mate1, mate2 } = require("../npc/builder").buildNpcMates(payload.questId, payload.category);
                return require("../../lib/weapon-riven/public-payload").stripWeaponRivenPublicPayload(json([mate1, mate2].filter(Boolean)));
            }
            case "lounge.handshake": {
                if (!require("../../lib/player-login").playerSocketAllowed(payload.viewerId, (_d = payload.session) !== null && _d !== void 0 ? _d : undefined))
                    return null;
                const session = yield require("../../data/domains/session").getSession(String(payload.viewerId));
                if (!require("../../lib/player-login").playerSocketAllowed(payload.viewerId, (_e = payload.session) !== null && _e !== void 0 ? _e : undefined))
                    return null;
                const playerId = session ? require("../../data/activeAccount").resolvePlayerIdSync(session.accountId) : null;
                return playerId && require("../../lounge/eligibility").canParticipateInLounge(playerId, payload.campaignId) ? { playerId } : null;
            }
            case "lounge.start": {
                if (!Array.isArray(payload.playerIds) || payload.playerIds.length !== 3
                    || payload.playerIds.some((id) => !Number.isSafeInteger(id) || Number(id) <= 0)
                    || new Set(payload.playerIds).size !== 3)
                    return false;
                return require("../../lounge/eligibility").decideLoungeTickets({ campaignId: payload.campaignId }, payload.playerIds);
            }
            default:
                if (kind.startsWith("riven."))
                    return require("../../lib/weapon-riven/multi-business").handleRivenBusiness(kind, payload);
                if (kind.startsWith("fiveBoss."))
                    return require("./five-boss-business-handlers").handleFiveBossBusiness(kind, payload);
                throw new Error("UNKNOWN_REALTIME_BUSINESS_KIND");
        }
    });
}
exports.handleRealtimeBusiness = handleRealtimeBusiness;
