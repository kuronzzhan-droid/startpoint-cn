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
exports.registerBattleCommandHandlers = exports.assertOrdinaryStartClaim = void 0;
const manager_1 = require("../room/manager");
const embedded_1 = require("./embedded");
const SessionManager_1 = require("../state/SessionManager");
const battle_contract_1 = require("../state/battle-contract");
const rematch_roster_1 = require("../room/rematch-roster");
const multi_active_quest_recovery_1 = require("../../lib/multi-active-quest-recovery");
const mode15_room_gate_1 = require("../mode15-room-gate");
const equipment_ready_1 = require("../room/equipment-ready");
const lobby_runtime_1 = require("../five-boss/lobby-runtime");
const quest_party_pool_shared_1 = require("../npc/quest-party-pool-shared");
const contract_1 = require("../five-boss/contract");
const node_perf_hooks_1 = require("node:perf_hooks");
const runtime_role_1 = require("./runtime-role");
const business_facts_1 = require("./business-facts");
const room_start_claims_1 = require("./room-start-claims");
const recruitment_1 = require("../recruitment");
const multi_room_1 = require("../../lib/weapon-riven/multi-room");
const startClaims = new Map();
const cancelledStartAttempts = new Map();
function assertOrdinaryStartClaim(token) {
    const claim = startClaims.get(token), room = claim && (0, manager_1.getRoom)(claim.command.roomNumber);
    if (!claim || node_perf_hooks_1.performance.now() >= claim.deadline || room !== claim.room
        || room.lifecycle.instanceId !== claim.command.roomInstanceId
        || room.lifecycle.battleSessionId !== claim.command.battleSessionId)
        throw new Error("START_CLAIM_STALE");
}
exports.assertOrdinaryStartClaim = assertOrdinaryStartClaim;
function resolveStartClaim(p) {
    var _a, _b;
    const token = (_a = p.claimToken) !== null && _a !== void 0 ? _a : (!(0, runtime_role_1.isRealtimeOwnerChild)() ? (_b = [...startClaims].find(([, entry]) => entry.command.roomNumber === p.roomNumber && entry.command.viewerId === p.viewerId
        && entry.command.playId === p.playId && entry.command.battleSessionId === p.battleSessionId)) === null || _b === void 0 ? void 0 : _b[0] : undefined);
    const claim = token ? startClaims.get(token) : undefined;
    if (!claim || claim.command.playerId !== p.playerId || claim.command.viewerId !== p.viewerId
        || claim.command.playId !== p.playId || claim.command.battleSessionId !== p.battleSessionId
        || claim.command.roomInstanceId !== p.roomInstanceId)
        return undefined;
    return { token: token, claim };
}
function registerBattleCommandHandlers(executor) {
    (0, multi_room_1.setWeaponRivenOwnerEpoch)(executor.ownerEpoch);
    executor.register("battle.query", (raw) => {
        var _a;
        const p = raw;
        const room = (0, manager_1.getRoom)(p.roomNumber);
        return {
            room: room ? JSON.parse(JSON.stringify(room)) : null,
            member: room ? (0, manager_1.isRoomMember)(room, p.viewerId) : false,
            attentionValid: p.attentionKey ? (0, recruitment_1.validateRandomRecruitmentAttention)(p.roomNumber, p.viewerId, p.attentionKey) : false,
            retired: SessionManager_1.sessionManager.isBattleSeatRetired(p.roomNumber, p.viewerId),
            isRescueGuest: SessionManager_1.sessionManager.isRescueGuest(p.roomNumber, p.viewerId),
            isRescueFragmentEligible: SessionManager_1.sessionManager.isRescueFragmentEligibleGuest(p.roomNumber, p.viewerId),
            isNewbieRescueGuest: SessionManager_1.sessionManager.isNewbieRescueGuest(p.roomNumber, p.viewerId),
            binding: room && p.playerId && p.playId
                ? (_a = (0, battle_contract_1.findBattlePlayBinding)(room, p.viewerId, p.playerId, p.playId)) !== null && _a !== void 0 ? _a : null : null,
        };
    });
    executor.register("battle.recovery", (raw) => {
        var _a, _b, _c;
        const p = raw;
        const room = p.quest.roomNumber ? (0, manager_1.getRoom)(p.quest.roomNumber) : undefined;
        const decision = (0, multi_active_quest_recovery_1.classifyMultiActiveQuestRecovery)(p.quest, room, p.viewerId, p.quest.roomNumber ? SessionManager_1.sessionManager.isBattleSeatRetired(p.quest.roomNumber, p.viewerId) : false, p.quest.isMulti ? (room ? (_a = (0, battle_contract_1.findBattlePlayBinding)(room, p.viewerId, p.playerId, p.quest.playId)) !== null && _a !== void 0 ? _a : null : null) : undefined);
        return Object.assign(Object.assign({}, decision), { roomPhase: (_c = (_b = room === null || room === void 0 ? void 0 : room.lifecycle) === null || _b === void 0 ? void 0 : _b.phase) !== null && _c !== void 0 ? _c : null });
    });
    executor.register("battle.start.prepare", (raw, context) => prepareStart(raw, context)
        .then(result => JSON.parse(JSON.stringify(result))));
    executor.register("battle.start.cancelAttempt", (p) => {
        for (const [id, cancelled] of cancelledStartAttempts)
            if (node_perf_hooks_1.performance.now() - cancelled.at > 30000)
                cancelledStartAttempts.delete(id);
        if (cancelledStartAttempts.size >= 2048)
            throw new Error("START_CANCEL_BUDGET");
        const pending = startClaims.get(p.prepareId);
        if (pending && (pending.command.roomNumber !== p.roomNumber || pending.command.playerId !== p.playerId
            || pending.command.viewerId !== p.viewerId || pending.command.playId !== p.playId))
            throw new Error("START_CANCEL_IDENTITY");
        cancelledStartAttempts.set(p.prepareId, Object.assign(Object.assign({}, p), { at: node_perf_hooks_1.performance.now() }));
        if (pending) {
            (0, battle_contract_1.releaseBattlePlayClaim)(pending.room, p.viewerId, p.playId, pending.command.battleSessionId);
            startClaims.delete(p.prepareId);
            (0, room_start_claims_1.unpinRoomStart)(pending.room, p.prepareId);
        }
        return { applied: true };
    });
    executor.register("battle.play.commit", (raw) => {
        const p = raw;
        return embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(p.roomNumber, () => {
            const room = (0, manager_1.getRoom)(p.roomNumber);
            if (!room || room.lifecycle.instanceId !== p.roomInstanceId)
                return { applied: false, reason: "STALE_INSTANCE" };
            const pending = resolveStartClaim(p);
            if (!pending)
                return { applied: false, reason: "STALE_CLAIM" };
            const applied = (0, battle_contract_1.bindBattlePlay)(room, p.viewerId, p.playerId, p.playId, p.battleSessionId);
            (0, battle_contract_1.releaseBattlePlayClaim)(room, p.viewerId, p.playId, p.battleSessionId);
            (0, room_start_claims_1.unpinRoomStart)(pending.claim.room, pending.token);
            startClaims.delete(pending.token);
            return { applied, reason: applied ? "COMMITTED" : "STALE_PLAY" };
        });
    });
    executor.register("battle.play.cancel", (raw) => {
        const p = raw;
        return embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(p.roomNumber, () => {
            const room = (0, manager_1.getRoom)(p.roomNumber);
            if (!room || room.lifecycle.instanceId !== p.roomInstanceId)
                return { applied: false, reason: "STALE_INSTANCE" };
            const pending = resolveStartClaim(p);
            if (!pending)
                return { applied: false, reason: "STALE_CLAIM" };
            (0, battle_contract_1.releaseBattlePlayClaim)(room, p.viewerId, p.playId, p.battleSessionId);
            (0, room_start_claims_1.unpinRoomStart)(pending.claim.room, pending.token);
            startClaims.delete(pending.token);
            return { applied: true };
        });
    });
    executor.register("battle.settlement.committed", (raw) => __awaiter(this, void 0, void 0, function* () {
        const p = raw;
        const observed = (0, manager_1.getRoom)(p.roomNumber);
        // Wait outside the room queue: Commit/Cancel must still be able to resolve its pins.
        if (observed && observed.lifecycle.instanceId === p.roomInstanceId && observed.lifecycle.battleSessionId === p.battleSessionId) {
            yield new Promise(resolve => { if (!(0, room_start_claims_1.deferPinnedRoomControl)(observed, resolve))
                resolve(); });
        }
        return embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(p.roomNumber, () => {
            const room = (0, manager_1.getRoom)(p.roomNumber);
            if (!room || !p.roomInstanceId || !p.battleSessionId || room.lobby_generation !== p.generation
                || room.lifecycle.instanceId !== p.roomInstanceId) {
                return { applied: false, reason: "STALE_IDENTITY" };
            }
            const binding = (0, battle_contract_1.findBattlePlayBinding)(room, p.viewerId, p.playerId, p.playId);
            if (!binding || binding.battleSessionId !== p.battleSessionId || binding.generation !== p.generation
                || binding.phase === "RETIRED")
                return { applied: false, reason: "STALE_PLAY" };
            (0, rematch_roster_1.ensureRematchReturnReservations)(room);
            (0, rematch_roster_1.markMemberSettlementCommitted)(room, p.viewerId);
            (0, battle_contract_1.markBattleMemberPhase)(room, p.viewerId, "SETTLED", p.battleSessionId);
            if (room.lifecycle.phase === "LOBBY") {
                const { scheduleRematchDisconnectCleanup } = require("../tcp/lobby");
                scheduleRematchDisconnectCleanup(room.room_number);
                return { applied: true, snapshotPhase: "LOBBY" };
            }
            const wasPending = room.settlement_return_pending;
            const transition = embedded_1.embeddedMultiCoordinator.applyRoomCommand(room, {
                roomNumber: p.roomNumber, identity: embedded_1.embeddedMultiCoordinator.identity(room), kind: "BEGIN_RETURN",
            });
            if (!transition.ok)
                return { applied: false, reason: transition.reason };
            (0, rematch_roster_1.markRematchReturnWindowOpened)(room);
            SessionManager_1.sessionManager.clearBattleExpectedCount(p.roomNumber);
            if (!wasPending)
                SessionManager_1.sessionManager.beginSettlementReturnGrace(p.roomNumber);
            if (p.accomplished === true && !room.five_boss_runtime
                && !(0, contract_1.isFiveBossGauntletQuest)(Number(room.category), Number(room.quest_id))) {
                SessionManager_1.sessionManager.sendServerConfirmedClear(p.roomNumber, p.viewerId, p.battleSessionId);
            }
            return { applied: true, snapshotPhase: "RETURN_PENDING" };
        });
    }));
    executor.register("battle.abort.committed", (raw) => {
        const p = raw;
        return embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(p.roomNumber, () => {
            const room = (0, manager_1.getRoom)(p.roomNumber);
            const binding = room ? (0, battle_contract_1.findBattlePlayBinding)(room, p.viewerId, p.playerId, p.playId) : undefined;
            if (!room || room.lifecycle.instanceId !== p.roomInstanceId || !(binding === null || binding === void 0 ? void 0 : binding.current)
                || binding.battleSessionId !== p.battleSessionId)
                return { applied: false, reason: "STALE_PLAY" };
            SessionManager_1.sessionManager.clearBattleExpectedCount(p.roomNumber);
            return { applied: true };
        });
    });
}
exports.registerBattleCommandHandlers = registerBattleCommandHandlers;
// Child consumes bounded business DTOs; embedded fixtures retain the same legacy providers.
function prepareStart(p, context) {
    return __awaiter(this, void 0, void 0, function* () {
        const body = p.body;
        const { room_number, viewer_id, category, quest_id, party_id, play_id } = body;
        if (Number(category) === 20)
            return { status: "unavailable" };
        const observed = (0, manager_1.getRoom)(room_number);
        const rivenEnabled = process.env.WEAPON_RIVEN_MULTI_ENABLED === "1";
        const observedInstance = observed === null || observed === void 0 ? void 0 : observed.lifecycle.instanceId, observedGeneration = observed === null || observed === void 0 ? void 0 : observed.lobby_generation;
        if ((0, runtime_role_1.isRealtimeOwnerChild)() && observed) {
            yield (0, business_facts_1.refreshRealtimePlayerFacts)(p.playerId, { category, questId: quest_id, partyId: party_id });
            if (observed.host_player_id !== p.playerId)
                yield (0, business_facts_1.refreshRealtimePlayerFacts)(observed.host_player_id, { category, questId: quest_id });
        }
        if (rivenEnabled && observed && observed.lifecycle.phase === "LOBBY") {
            if (observed.category !== category || observed.quest_id !== quest_id
                || !(0, manager_1.isRoomMember)(observed, viewer_id)
                || (0, manager_1.getRoomMemberPlayerId)(observed, viewer_id) !== p.playerId)
                return { status: "unavailable" };
            const { requestWeaponRivenHttpStart } = require("../tcp/lobby");
            if (!(yield requestWeaponRivenHttpStart(observed, viewer_id, party_id, context.remainingMs())))
                return { status: "unavailable" };
        }
        else if (rivenEnabled && (observed === null || observed === void 0 ? void 0 : observed.lifecycle.phase) === "BATTLE") {
            const { waitWeaponRivenPreparation } = require("../../lib/weapon-riven/multi-room");
            if (!(yield waitWeaponRivenPreparation(observed)))
                return { status: "unavailable" };
        }
        return embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(room_number, () => {
            var _a, _b, _c, _d, _e;
            if (context.remainingMs() <= 0)
                return { status: "unavailable" };
            if (cancelledStartAttempts.has(context.commandId))
                return { status: "unavailable" };
            const currentRoom = (0, manager_1.getRoom)(room_number);
            if (!currentRoom)
                return { status: "missing" };
            if (currentRoom.lifecycle.instanceId !== observedInstance
                || (currentRoom.lobby_generation !== observedGeneration
                    && (!rivenEnabled || currentRoom.lobby_generation !== Number(observedGeneration) + 1)))
                return { status: "unavailable" };
            const facts = (0, runtime_role_1.isRealtimeOwnerChild)() ? (0, business_facts_1.getPlayerBusinessFacts)(p.playerId, { category, questId: quest_id, partyId: party_id }) : undefined;
            if ((0, runtime_role_1.isRealtimeOwnerChild)() && !facts)
                return { status: "unavailable" };
            if (Number(currentRoom.category) === 20 || Number(category) === 20 || currentRoom.category !== category || currentRoom.quest_id !== quest_id)
                return { status: "quest_mismatch" };
            if (!(0, manager_1.isRoomMember)(currentRoom, viewer_id))
                return { status: "forbidden" };
            const recordedPlayerId = (0, manager_1.getRoomMemberPlayerId)(currentRoom, viewer_id);
            if (recordedPlayerId !== null && recordedPlayerId !== p.playerId)
                return { status: "player_mismatch" };
            if ((0, mode15_room_gate_1.isMode15RoomClosed)(currentRoom))
                return { status: "mode15_closed", room: currentRoom };
            if (currentRoom.lifecycle.phase === "LOBBY") {
                if (!(0, equipment_ready_1.enforceRoomEquipmentReady)(currentRoom))
                    return { status: "unavailable" };
                const peers = SessionManager_1.sessionManager.getClientsInRoom(room_number, currentRoom.lobby_generation)
                    .filter(peer => !peer.isBattle && peer.enterData !== null && peer.yourself);
                if (peers.some(peer => { var _a; return ((_a = peer.yourself.state) === null || _a === void 0 ? void 0 : _a[0]) !== 1; }))
                    return { status: "unavailable" };
                const requester = peers.find(peer => peer.viewerId === viewer_id);
                if (requester && (0, equipment_ready_1.selectedPartyId)(requester) !== party_id)
                    return { status: "unavailable" };
            }
            const equipmentAllowed = (_a = facts === null || facts === void 0 ? void 0 : facts.questPolicy.equipmentAllowed) !== null && _a !== void 0 ? _a : (!(0, runtime_role_1.isRealtimeOwnerChild)() && require("../../lib/mode15-optional").isMode15EquipmentAllowedQuest(category, quest_id));
            if (!equipmentAllowed) {
                const frozenPartyId = (_b = currentRoom.equipmentPartyIds) === null || _b === void 0 ? void 0 : _b[viewer_id];
                if ((frozenPartyId !== undefined && frozenPartyId !== party_id)
                    || (0, equipment_ready_1.exclusiveWirePartyItems)(body.client_battle_party).length > 0
                    || ((_c = body.mate_party_ids) === null || _c === void 0 ? void 0 : _c.some(party => (0, equipment_ready_1.exclusiveWirePartyItems)(party).length > 0))
                    || (frozenPartyId === undefined && ((_d = facts === null || facts === void 0 ? void 0 : facts.restrictedEquipment) !== null && _d !== void 0 ? _d : (!(0, runtime_role_1.isRealtimeOwnerChild)() && require("../../lib/mode15-optional").getMode15ExclusiveGlobalPartyItemsSync(p.playerId, 1, party_id).length > 0)))) {
                    return { status: "unavailable" };
                }
            }
            if (rivenEnabled ? currentRoom.lifecycle.phase !== "BATTLE" : !(0, lobby_runtime_1.freezeFiveBossLobby)(currentRoom))
                return { status: "unavailable" };
            const sourceGeneration = currentRoom.lifecycle.phase === "BATTLE"
                ? Math.max(0, currentRoom.lobby_generation - 1) : currentRoom.lobby_generation;
            if (!(0, manager_1.setRoomBattle)(room_number))
                return { status: "unavailable" };
            if (!currentRoom.equipmentPartyIds)
                (0, equipment_ready_1.freezeEquipmentSelections)(currentRoom, sourceGeneration);
            const npcPartySnapshot = (_e = currentRoom.npcPartySnapshots) === null || _e === void 0 ? void 0 : _e[viewer_id];
            const fiveBoss = (0, contract_1.isFiveBossGauntletQuest)(category, quest_id);
            if (!fiveBoss && (startClaims.size >= 1024 || !(0, battle_contract_1.claimBattlePlay)(currentRoom, viewer_id, p.playerId, play_id)))
                return { status: "unavailable" };
            const claimToken = fiveBoss ? null : context.commandId;
            if (claimToken) {
                const command = { roomNumber: room_number, roomInstanceId: currentRoom.lifecycle.instanceId,
                    battleSessionId: currentRoom.lifecycle.battleSessionId, viewerId: viewer_id, playerId: p.playerId, playId: play_id };
                startClaims.set(claimToken, { room: currentRoom, command, deadline: node_perf_hooks_1.performance.now() + context.remainingMs() });
                (0, room_start_claims_1.pinRoomStart)(currentRoom, claimToken);
                const durable = p.durableStart;
                if (durable && durable.roomInstanceId === command.roomInstanceId && durable.battleSessionId === command.battleSessionId
                    && durable.playerId === command.playerId && durable.viewerId === command.viewerId && durable.playId === command.playId) {
                    for (const [token, old] of startClaims) {
                        if (token === claimToken || old.room !== currentRoom || old.command.playerId !== command.playerId
                            || old.command.viewerId !== command.viewerId || old.command.playId !== command.playId
                            || old.command.roomInstanceId !== command.roomInstanceId || old.command.battleSessionId !== command.battleSessionId)
                            continue;
                        if (!(0, battle_contract_1.bindBattlePlay)(currentRoom, command.viewerId, command.playerId, command.playId, command.battleSessionId))
                            continue;
                        (0, battle_contract_1.releaseBattlePlayClaim)(currentRoom, command.viewerId, command.playId, command.battleSessionId);
                        startClaims.delete(token);
                        (0, room_start_claims_1.unpinRoomStart)(currentRoom, token);
                    }
                }
            }
            return {
                status: "ready", room: currentRoom,
                roomGeneration: currentRoom.lobby_generation,
                roomInstanceId: currentRoom.lifecycle.instanceId,
                battleSessionId: currentRoom.lifecycle.battleSessionId,
                claimToken, ownerEpoch: context.ownerEpoch, remainingMs: context.remainingMs(),
                mateComIds: currentRoom.mates.map(mate => mate.com_id),
                participants: currentRoom.mates.map(mate => ({ viewerId: Number(mate.viewer_id), comId: Number(mate.com_id || 0) }))
                    .filter(mate => Number.isFinite(mate.viewerId) && mate.viewerId > 0),
                expectedRealViewerIds: currentRoom.expected_real_viewer_ids.map(Number).filter(id => Number.isFinite(id) && id > 0),
                isHost: currentRoom.host_viewer_id === viewer_id,
                isRescueGuest: SessionManager_1.sessionManager.isRescueGuest(room_number, viewer_id),
                isRescueFragmentEligible: SessionManager_1.sessionManager.isRescueFragmentEligibleGuest(room_number, viewer_id),
                isNewbieRescueGuest: SessionManager_1.sessionManager.isNewbieRescueGuest(room_number, viewer_id),
                npcPartySnapshot: !p.fixedParty && (npcPartySnapshot === null || npcPartySnapshot === void 0 ? void 0 : npcPartySnapshot.partySlot) === party_id && npcPartySnapshot.sourcePlayerId === p.playerId
                    ? (0, quest_party_pool_shared_1.cloneQuestNpcPartySnapshot)(npcPartySnapshot) : undefined,
            };
        });
    });
}
