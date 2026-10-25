import type { RoomCommandExecutor, RoomCommandContext } from "./command-executor"
import type { MultiRoom, MultiStartBody } from "../types"
import type { PlayerActiveQuest } from "../../data/types"
import { getRoom, getRoomMemberPlayerId, isRoomMember, setRoomBattle } from "../room/manager"
import { embeddedMultiCoordinator } from "./embedded"
import { sessionManager } from "../state/SessionManager"
import { bindBattlePlay, claimBattlePlay, releaseBattlePlayClaim, findBattlePlayBinding, markBattleMemberPhase } from "../state/battle-contract"
import { ensureRematchReturnReservations, markMemberSettlementCommitted, markRematchReturnWindowOpened } from "../room/rematch-roster"
import { classifyMultiActiveQuestRecovery } from "../../lib/multi-active-quest-recovery"
import { isMode15RoomClosed } from "../mode15-room-gate"
import { enforceRoomEquipmentReady, exclusiveWirePartyItems, freezeEquipmentSelections, selectedPartyId } from "../room/equipment-ready"
import { freezeFiveBossLobby } from "../five-boss/lobby-runtime"
import { cloneQuestNpcPartySnapshot } from "../npc/quest-party-pool-shared"
import { isFiveBossGauntletQuest } from "../five-boss/contract"
import { performance } from "node:perf_hooks"
import { isRealtimeOwnerChild } from "./runtime-role"
import { refreshRealtimePlayerFacts, getPlayerBusinessFacts } from "./business-facts"
import { pinRoomStart, unpinRoomStart, deferPinnedRoomControl } from "./room-start-claims"
import { validateRandomRecruitmentAttention } from "../recruitment"

export interface StartPreparePayload {
    body: MultiStartBody
    playerId: number
    fixedParty: boolean
    durableStart?: { roomInstanceId: string; battleSessionId: string; playId: string; playerId: number; viewerId: number }
}
export interface BattlePlayCommand {
    roomNumber: string
    roomInstanceId: string
    battleSessionId: string
    viewerId: number
    playerId: number
    playId: string
    claimToken?: string
}
const startClaims = new Map<string, { room: MultiRoom; command: BattlePlayCommand; deadline: number }>()
const cancelledStartAttempts = new Map<string, { at: number; roomNumber: string; playerId: number; viewerId: number; playId: string }>()
export function assertOrdinaryStartClaim(token: string): void {
    const claim = startClaims.get(token), room = claim && getRoom(claim.command.roomNumber)
    if (!claim || performance.now() >= claim.deadline || room !== claim.room
        || room.lifecycle.instanceId !== claim.command.roomInstanceId
        || room.lifecycle.battleSessionId !== claim.command.battleSessionId) throw new Error("START_CLAIM_STALE")
}
function resolveStartClaim(p: BattlePlayCommand) {
    const token = p.claimToken ?? (!isRealtimeOwnerChild() ? [...startClaims].find(([, entry]) =>
        entry.command.roomNumber === p.roomNumber && entry.command.viewerId === p.viewerId
        && entry.command.playId === p.playId && entry.command.battleSessionId === p.battleSessionId)?.[0] : undefined)
    const claim = token ? startClaims.get(token) : undefined
    if (!claim || claim.command.playerId !== p.playerId || claim.command.viewerId !== p.viewerId
        || claim.command.playId !== p.playId || claim.command.battleSessionId !== p.battleSessionId
        || claim.command.roomInstanceId !== p.roomInstanceId) return undefined
    return { token: token!, claim }
}
export interface SettlementCommittedCommand {
    roomNumber: string
    roomInstanceId: string
    battleSessionId: string
    generation: number
    viewerId: number
    playerId: number
    playId: string
}

export function registerBattleCommandHandlers(executor: RoomCommandExecutor): void {
    executor.register("battle.query", (raw: unknown) => {
        const p = raw as { roomNumber: string; viewerId: number; playerId?: number; playId?: string; attentionKey?: string }
        const room = getRoom(p.roomNumber)
        return {
            room: room ? JSON.parse(JSON.stringify(room)) : null,
            member: room ? isRoomMember(room, p.viewerId) : false,
            attentionValid: p.attentionKey ? validateRandomRecruitmentAttention(p.roomNumber, p.viewerId, p.attentionKey) : false,
            retired: sessionManager.isBattleSeatRetired(p.roomNumber, p.viewerId),
            isRescueGuest: sessionManager.isRescueGuest(p.roomNumber, p.viewerId),
            isRescueFragmentEligible: sessionManager.isRescueFragmentEligibleGuest(p.roomNumber, p.viewerId),
            isNewbieRescueGuest: sessionManager.isNewbieRescueGuest(p.roomNumber, p.viewerId),
            binding: room && p.playerId && p.playId
                ? findBattlePlayBinding(room, p.viewerId, p.playerId, p.playId) ?? null : null,
        }
    })
    executor.register("battle.recovery", (raw: unknown) => {
        const p = raw as { quest: PlayerActiveQuest; viewerId: number; playerId: number }
        const room = p.quest.roomNumber ? getRoom(p.quest.roomNumber) : undefined
        const decision = classifyMultiActiveQuestRecovery(p.quest, room, p.viewerId,
            p.quest.roomNumber ? sessionManager.isBattleSeatRetired(p.quest.roomNumber, p.viewerId) : false,
            p.quest.isMulti ? (room ? findBattlePlayBinding(room, p.viewerId, p.playerId, p.quest.playId) ?? null : null) : undefined)
        return { ...decision, roomPhase: room?.lifecycle?.phase ?? null }
    })
    executor.register("battle.start.prepare", (raw: unknown, context) => prepareStart(raw as StartPreparePayload, context)
        .then(result => JSON.parse(JSON.stringify(result))))
    executor.register("battle.start.cancelAttempt", (p: { prepareId: string; roomNumber: string; viewerId: number; playerId: number; playId: string }) => {
        for (const [id, cancelled] of cancelledStartAttempts) if (performance.now() - cancelled.at > 30_000) cancelledStartAttempts.delete(id)
        if (cancelledStartAttempts.size >= 2048) throw new Error("START_CANCEL_BUDGET")
        const pending = startClaims.get(p.prepareId)
        if (pending && (pending.command.roomNumber !== p.roomNumber || pending.command.playerId !== p.playerId
            || pending.command.viewerId !== p.viewerId || pending.command.playId !== p.playId)) throw new Error("START_CANCEL_IDENTITY")
        cancelledStartAttempts.set(p.prepareId, { ...p, at: performance.now() })
        if (pending) {
            releaseBattlePlayClaim(pending.room, p.viewerId, p.playId, pending.command.battleSessionId)
            startClaims.delete(p.prepareId); unpinRoomStart(pending.room, p.prepareId)
        }
        return { applied: true }
    })
    executor.register("battle.play.commit", (raw: unknown) => {
        const p = raw as BattlePlayCommand
        return embeddedMultiCoordinator.enqueueRoomCommand(p.roomNumber, () => {
            const room = getRoom(p.roomNumber)
            if (!room || room.lifecycle.instanceId !== p.roomInstanceId) return { applied: false, reason: "STALE_INSTANCE" }
            const pending = resolveStartClaim(p)
            if (!pending) return { applied: false, reason: "STALE_CLAIM" }
            const applied = bindBattlePlay(room, p.viewerId, p.playerId, p.playId, p.battleSessionId)
            releaseBattlePlayClaim(room, p.viewerId, p.playId, p.battleSessionId)
            unpinRoomStart(pending.claim.room, pending.token); startClaims.delete(pending.token)
            return { applied, reason: applied ? "COMMITTED" : "STALE_PLAY" }
        })
    })
    executor.register("battle.play.cancel", (raw: unknown) => {
        const p = raw as BattlePlayCommand
        return embeddedMultiCoordinator.enqueueRoomCommand(p.roomNumber, () => {
            const room = getRoom(p.roomNumber)
            if (!room || room.lifecycle.instanceId !== p.roomInstanceId) return { applied: false, reason: "STALE_INSTANCE" }
            const pending = resolveStartClaim(p)
            if (!pending) return { applied: false, reason: "STALE_CLAIM" }
            releaseBattlePlayClaim(room, p.viewerId, p.playId, p.battleSessionId)
            unpinRoomStart(pending.claim.room, pending.token); startClaims.delete(pending.token)
            return { applied: true }
        })
    })
    executor.register("battle.settlement.committed", async (raw: unknown) => {
        const p = raw as SettlementCommittedCommand
        const observed = getRoom(p.roomNumber)
        // Wait outside the room queue: Commit/Cancel must still be able to resolve its pins.
        if (observed && observed.lifecycle.instanceId === p.roomInstanceId && observed.lifecycle.battleSessionId === p.battleSessionId) {
            await new Promise<void>(resolve => { if (!deferPinnedRoomControl(observed, resolve)) resolve() })
        }
        return embeddedMultiCoordinator.enqueueRoomCommand(p.roomNumber, () => {
            const room = getRoom(p.roomNumber)
            if (!room || !p.roomInstanceId || !p.battleSessionId || room.lobby_generation !== p.generation
                || room.lifecycle.instanceId !== p.roomInstanceId) {
                return { applied: false, reason: "STALE_IDENTITY" }
            }
            const binding = findBattlePlayBinding(room, p.viewerId, p.playerId, p.playId)
            if (!binding || binding.battleSessionId !== p.battleSessionId || binding.generation !== p.generation
                || binding.phase === "RETIRED") return { applied: false, reason: "STALE_PLAY" }
            ensureRematchReturnReservations(room)
            markMemberSettlementCommitted(room, p.viewerId)
            markBattleMemberPhase(room, p.viewerId, "SETTLED", p.battleSessionId)
            if (room.lifecycle.phase === "LOBBY") {
                const { scheduleRematchDisconnectCleanup } = require("../tcp/lobby") as typeof import("../tcp/lobby")
                scheduleRematchDisconnectCleanup(room.room_number)
                return { applied: true, snapshotPhase: "LOBBY" }
            }
            const wasPending = room.settlement_return_pending
            const transition = embeddedMultiCoordinator.applyRoomCommand(room, {
                roomNumber: p.roomNumber, identity: embeddedMultiCoordinator.identity(room), kind: "BEGIN_RETURN",
            })
            if (!transition.ok) return { applied: false, reason: transition.reason }
            markRematchReturnWindowOpened(room)
            sessionManager.clearBattleExpectedCount(p.roomNumber)
            if (!wasPending) sessionManager.beginSettlementReturnGrace(p.roomNumber)
            return { applied: true, snapshotPhase: "RETURN_PENDING" }
        })
    })
    executor.register("battle.abort.committed", (raw: unknown) => {
        const p = raw as BattlePlayCommand
        return embeddedMultiCoordinator.enqueueRoomCommand(p.roomNumber, () => {
            const room = getRoom(p.roomNumber)
            const binding = room ? findBattlePlayBinding(room, p.viewerId, p.playerId, p.playId) : undefined
            if (!room || room.lifecycle.instanceId !== p.roomInstanceId || !binding?.current
                || binding.battleSessionId !== p.battleSessionId) return { applied: false, reason: "STALE_PLAY" }
            sessionManager.clearBattleExpectedCount(p.roomNumber)
            return { applied: true }
        })
    })
}

// Child consumes bounded business DTOs; embedded fixtures retain the same legacy providers.
async function prepareStart(p: StartPreparePayload, context: RoomCommandContext) {
    const body = p.body
    const { room_number, viewer_id, category, quest_id, party_id, play_id } = body
    const observed = getRoom(room_number)
    const observedInstance = observed?.lifecycle.instanceId, observedGeneration = observed?.lobby_generation
    if (isRealtimeOwnerChild() && observed) {
        await refreshRealtimePlayerFacts(p.playerId, { category, questId: quest_id, partyId: party_id })
        if (observed.host_player_id !== p.playerId) await refreshRealtimePlayerFacts(observed.host_player_id, { category, questId: quest_id })
    }
    return embeddedMultiCoordinator.enqueueRoomCommand(room_number, () => {
        if (context.remainingMs() <= 0) return { status: "unavailable" as const }
        if (cancelledStartAttempts.has(context.commandId)) return { status: "unavailable" as const }
        const currentRoom = getRoom(room_number)
        if (!currentRoom) return { status: "missing" as const }
        if (currentRoom.lifecycle.instanceId !== observedInstance || currentRoom.lobby_generation !== observedGeneration) return { status: "unavailable" as const }
        const facts = isRealtimeOwnerChild() ? getPlayerBusinessFacts(p.playerId, { category, questId: quest_id, partyId: party_id }) : undefined
        if (isRealtimeOwnerChild() && !facts) return { status: "unavailable" as const }
        if (currentRoom.category !== category || currentRoom.quest_id !== quest_id) return { status: "quest_mismatch" as const }
        if (!isRoomMember(currentRoom, viewer_id)) return { status: "forbidden" as const }
        const recordedPlayerId = getRoomMemberPlayerId(currentRoom, viewer_id)
        if (recordedPlayerId !== null && recordedPlayerId !== p.playerId) return { status: "player_mismatch" as const }
        if (isMode15RoomClosed(currentRoom)) return { status: "mode15_closed" as const, room: currentRoom }
        if (currentRoom.lifecycle.phase === "LOBBY") {
            if (!enforceRoomEquipmentReady(currentRoom)) return { status: "unavailable" as const }
            const peers = sessionManager.getClientsInRoom(room_number, currentRoom.lobby_generation)
                .filter(peer => !peer.isBattle && peer.enterData !== null && peer.yourself)
            if (peers.some(peer => peer.yourself.state?.[0] !== 1)) return { status: "unavailable" as const }
            const requester = peers.find(peer => peer.viewerId === viewer_id)
            if (requester && selectedPartyId(requester) !== party_id) return { status: "unavailable" as const }
        }
        const equipmentAllowed = facts?.questPolicy.equipmentAllowed
            ?? (!isRealtimeOwnerChild() && (require("../../lib/mode15-optional") as typeof import("../../lib/mode15-optional")).isMode15EquipmentAllowedQuest(category, quest_id))
        if (!equipmentAllowed) {
            const frozenPartyId = currentRoom.equipmentPartyIds?.[viewer_id]
            if ((frozenPartyId !== undefined && frozenPartyId !== party_id)
                || exclusiveWirePartyItems(body.client_battle_party).length > 0
                || body.mate_party_ids?.some(party => exclusiveWirePartyItems(party).length > 0)
                || (frozenPartyId === undefined && (facts?.restrictedEquipment
                    ?? (!isRealtimeOwnerChild() && (require("../../lib/mode15-optional") as typeof import("../../lib/mode15-optional")).getMode15ExclusiveGlobalPartyItemsSync(p.playerId, 1, party_id).length > 0)))) {
                return { status: "unavailable" as const }
            }
        }
        if (!freezeFiveBossLobby(currentRoom)) return { status: "unavailable" as const }
        const sourceGeneration = currentRoom.lifecycle.phase === "BATTLE"
            ? Math.max(0, currentRoom.lobby_generation - 1) : currentRoom.lobby_generation
        if (!setRoomBattle(room_number)) return { status: "unavailable" as const }
        if (!currentRoom.equipmentPartyIds) freezeEquipmentSelections(currentRoom, sourceGeneration)
        const npcPartySnapshot = currentRoom.npcPartySnapshots?.[viewer_id]
        const fiveBoss = isFiveBossGauntletQuest(category, quest_id)
        if (!fiveBoss && (startClaims.size >= 1024 || !claimBattlePlay(currentRoom, viewer_id, p.playerId, play_id))) return { status: "unavailable" as const }
        const claimToken = fiveBoss ? null : context.commandId
        if (claimToken) {
            const command = { roomNumber: room_number, roomInstanceId: currentRoom.lifecycle.instanceId,
                battleSessionId: currentRoom.lifecycle.battleSessionId!, viewerId: viewer_id, playerId: p.playerId, playId: play_id }
            startClaims.set(claimToken, { room: currentRoom, command, deadline: performance.now() + context.remainingMs() })
            pinRoomStart(currentRoom, claimToken)
            const durable = p.durableStart
            if (durable && durable.roomInstanceId === command.roomInstanceId && durable.battleSessionId === command.battleSessionId
                && durable.playerId === command.playerId && durable.viewerId === command.viewerId && durable.playId === command.playId) {
                for (const [token, old] of startClaims) {
                    if (token === claimToken || old.room !== currentRoom || old.command.playerId !== command.playerId
                        || old.command.viewerId !== command.viewerId || old.command.playId !== command.playId
                        || old.command.roomInstanceId !== command.roomInstanceId || old.command.battleSessionId !== command.battleSessionId) continue
                    if (!bindBattlePlay(currentRoom, command.viewerId, command.playerId, command.playId, command.battleSessionId)) continue
                    releaseBattlePlayClaim(currentRoom, command.viewerId, command.playId, command.battleSessionId)
                    startClaims.delete(token); unpinRoomStart(currentRoom, token)
                }
            }
        }
        return {
            status: "ready" as const, room: currentRoom,
            roomGeneration: currentRoom.lobby_generation,
            roomInstanceId: currentRoom.lifecycle.instanceId,
            battleSessionId: currentRoom.lifecycle.battleSessionId!,
            claimToken, ownerEpoch: context.ownerEpoch, remainingMs: context.remainingMs(),
            mateComIds: currentRoom.mates.map(mate => mate.com_id),
            battleParty: currentRoom.battleParties?.[viewer_id],
            participants: currentRoom.mates.map(mate => ({ viewerId: Number(mate.viewer_id), comId: Number(mate.com_id || 0) }))
                .filter(mate => Number.isFinite(mate.viewerId) && mate.viewerId > 0),
            expectedRealViewerIds: currentRoom.expected_real_viewer_ids.map(Number).filter(id => Number.isFinite(id) && id > 0),
            isHost: currentRoom.host_viewer_id === viewer_id,
            isRescueGuest: sessionManager.isRescueGuest(room_number, viewer_id),
            isRescueFragmentEligible: sessionManager.isRescueFragmentEligibleGuest(room_number, viewer_id),
            isNewbieRescueGuest: sessionManager.isNewbieRescueGuest(room_number, viewer_id),
            npcPartySnapshot: !p.fixedParty && npcPartySnapshot?.partySlot === party_id && npcPartySnapshot.sourcePlayerId === p.playerId
                ? cloneQuestNpcPartySnapshot(npcPartySnapshot) : undefined,
        }
    })
}

export type StartPrepareResult = Awaited<ReturnType<typeof prepareStart>>
export interface BattleQueryResult {
    room: MultiRoom | null
    member: boolean
    attentionValid?: boolean
    retired: boolean
    isRescueGuest: boolean
    isRescueFragmentEligible: boolean
    isNewbieRescueGuest: boolean
    binding: ReturnType<typeof findBattlePlayBinding> | null
}
