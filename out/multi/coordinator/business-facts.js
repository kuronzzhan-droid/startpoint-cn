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
exports.notifyRealtimePresence = exports.refreshRealtimePlayerFacts = exports.clearPlayerBusinessFacts = exports.invalidatePlayerBusinessFacts = exports.getKnownExclusiveBusinessItemIds = exports.getQuestBusinessClassification = exports.getQuestBusinessPolicy = exports.getPlayerBusinessFacts = exports.applyPlayerBusinessFacts = void 0;
const command_protocol_1 = require("./command-protocol");
const business_rpc_1 = require("./business-rpc");
const entries = new Map();
// Quest classification is parent-verified content metadata. It outlives a
// player's eligibility TTL; it never carries hostAllowed or player ownership.
const questClassifications = new Map();
let parentEpoch;
const MAX_FACTS = 1024;
function applyPlayerBusinessFacts(input) {
    const facts = (0, command_protocol_1.cloneCommandJson)(input);
    if (!Number.isSafeInteger(facts.playerId) || facts.playerId <= 0 || !Number.isSafeInteger(facts.revision)
        || facts.revision <= 0 || !facts.parentEpoch || !Number.isFinite(facts.expiresAt) || facts.expiresAt <= Date.now())
        return false;
    if (parentEpoch !== undefined && facts.parentEpoch !== parentEpoch)
        return false;
    const questKey = `${facts.category}:${facts.questId}`;
    if (!questClassifications.has(questKey) && questClassifications.size >= MAX_FACTS)
        return false;
    const previous = entries.get(facts.playerId);
    if (previous && previous.revision >= facts.revision)
        return false;
    for (const [id, stored] of entries)
        if (stored.expiresAt <= Date.now())
            entries.delete(id);
    if (!entries.has(facts.playerId) && entries.size >= MAX_FACTS)
        return false;
    parentEpoch !== null && parentEpoch !== void 0 ? parentEpoch : (parentEpoch = facts.parentEpoch);
    questClassifications.set(questKey, facts.questPolicy.isMode15);
    entries.delete(facts.playerId);
    entries.set(facts.playerId, facts);
    return true;
}
exports.applyPlayerBusinessFacts = applyPlayerBusinessFacts;
function getPlayerBusinessFacts(playerId, scope) {
    const facts = entries.get(playerId);
    if (!facts || facts.expiresAt <= Date.now()
        || ((scope === null || scope === void 0 ? void 0 : scope.category) !== undefined && scope.category !== facts.category)
        || ((scope === null || scope === void 0 ? void 0 : scope.questId) !== undefined && scope.questId !== facts.questId)
        || ((scope === null || scope === void 0 ? void 0 : scope.partyId) !== undefined && scope.partyId !== facts.partyId))
        return undefined;
    return (0, command_protocol_1.cloneCommandJson)(facts);
}
exports.getPlayerBusinessFacts = getPlayerBusinessFacts;
function getQuestBusinessPolicy(category, questId) {
    for (const facts of entries.values())
        if (facts.category === category && facts.questId === questId
            && facts.expiresAt > Date.now())
            return (0, command_protocol_1.cloneCommandJson)(facts.questPolicy);
    return undefined;
}
exports.getQuestBusinessPolicy = getQuestBusinessPolicy;
function getQuestBusinessClassification(category, questId) {
    return questClassifications.get(`${category}:${questId}`);
}
exports.getQuestBusinessClassification = getQuestBusinessClassification;
function getKnownExclusiveBusinessItemIds() {
    return [...new Set([...entries.values()].filter(facts => facts.expiresAt > Date.now())
            .flatMap(facts => facts.questPolicy.exclusiveItemIds))];
}
exports.getKnownExclusiveBusinessItemIds = getKnownExclusiveBusinessItemIds;
function invalidatePlayerBusinessFacts(playerId) { entries.delete(playerId); }
exports.invalidatePlayerBusinessFacts = invalidatePlayerBusinessFacts;
function clearPlayerBusinessFacts() { entries.clear(); questClassifications.clear(); parentEpoch = undefined; }
exports.clearPlayerBusinessFacts = clearPlayerBusinessFacts;
function refreshRealtimePlayerFacts(playerId, scope) {
    return __awaiter(this, void 0, void 0, function* () {
        const payload = {
            playerId, category: scope.category, questId: scope.questId,
        };
        if (scope.partyId !== undefined)
            payload.partyId = scope.partyId;
        if (scope.wireParty !== undefined)
            payload.wireParty = scope.wireParty;
        const facts = yield (0, business_rpc_1.invokeRealtimeBusiness)("player.facts", payload);
        const current = getPlayerBusinessFacts(playerId);
        if (!applyPlayerBusinessFacts(facts) && (!current || current.revision !== facts.revision
            || current.parentEpoch !== facts.parentEpoch))
            throw new Error("PLAYER_FACTS_STALE");
        return facts;
    });
}
exports.refreshRealtimePlayerFacts = refreshRealtimePlayerFacts;
const presenceAt = new Map();
/** Coalesced business projection, never awaited by the TCP input loop. */
function notifyRealtimePresence(viewerId) {
    var _a;
    if (!Number.isSafeInteger(viewerId) || viewerId <= 0)
        return;
    const now = Date.now();
    if (((_a = presenceAt.get(viewerId)) !== null && _a !== void 0 ? _a : 0) > now - 30000)
        return;
    presenceAt.delete(viewerId);
    presenceAt.set(viewerId, now);
    while (presenceAt.size > MAX_FACTS)
        presenceAt.delete(presenceAt.keys().next().value);
    void (0, business_rpc_1.invokeRealtimeBusiness)("presence.touch", { viewerId }).catch(() => presenceAt.delete(viewerId));
}
exports.notifyRealtimePresence = notifyRealtimePresence;
