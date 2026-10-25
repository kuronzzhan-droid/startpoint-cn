import { isRealtimeOwnerChild } from "../coordinator/runtime-role"
import { getPlayerBusinessFacts, getQuestBusinessPolicy, refreshRealtimePlayerFacts } from "../coordinator/business-facts"
import { exclusivePartyItems } from "../npc/equipment-policy"
import type { MultiRoom } from "../types"
import { sessionManager, type SessionClient } from "../state/SessionManager"
import { embeddedMultiCoordinator } from "../coordinator/embedded"
function isMode15EquipmentAllowedQuest(category: number, questId: number): boolean {
    return isRealtimeOwnerChild() ? getQuestBusinessPolicy(category, questId)?.equipmentAllowed === true
        : require("../../lib/mode15-optional").isMode15EquipmentAllowedQuest(category, questId)
}

function getRoom(roomNumber: string): MultiRoom | undefined {
    return (require("./manager") as typeof import("./manager")).getRoom(roomNumber)
}

export const EQUIPMENT_IDLE_MS = 30_000

/** Accept both the TCP Option encoding and the HTTP/plain party encoding. */
export function exclusiveWirePartyItems(party: any): number[] {
    return exclusivePartyItems(party)
}

/** AI parties belong to the server, so normalize them before publishing a roster. */
export function legalNpcParty(room: MultiRoom, party: any): any {
    if (isMode15EquipmentAllowedQuest(room.category, room.quest_id)
        || exclusiveWirePartyItems(party).length === 0) return party
    const result = { ...party }
    for (const field of ["equipments", "equipmentIds", "equipment_ids",
        "abilitySoulIds", "ability_soul_ids"]) {
        if (!Array.isArray(party[field])) continue
        result[field] = party[field].map((raw: any) => {
            if (!exclusiveWirePartyItems({ [field]: [raw] }).length) return raw
            return Array.isArray(raw) ? [1] : null
        })
    }
    return result
}

export function selectedPartyId(client: SessionClient): number {
    // HTTP /party/edit can finish before TCP ChangeParty, while TCP can arrive
    // before the deferred player.partySlot write. Explicit changes win.
    return client.equipmentSelectedPartyId
        ?? Number((isRealtimeOwnerChild() ? getPlayerBusinessFacts(Number(client.playerId))?.partyId
            : require("../../data/domains/player").getPlayerSync(Number(client.playerId))?.partySlot)
            || client.yourself?.currentPartyId || 1)
}

export function hasRestrictedEquipment(room: MultiRoom, client: SessionClient): boolean {
    if (isMode15EquipmentAllowedQuest(room.category, room.quest_id)) return false
    if (exclusiveWirePartyItems(client.yourself?.party).length) return true
    if (isRealtimeOwnerChild()) {
        const facts = getPlayerBusinessFacts(Number(client.playerId), { category: room.category, questId: room.quest_id, partyId: selectedPartyId(client) })
        return !facts || facts.restrictedEquipment
    }
    return require("../../lib/mode15-optional").getMode15ExclusiveGlobalPartyItemsSync(
        Number(client.playerId), 1, selectedPartyId(client),
    ).length > 0
}

export function clearEquipmentBlock(client: SessionClient): void {
    if (client.equipmentReadyBlock) clearTimeout(client.equipmentReadyBlock.timer)
    client.equipmentReadyBlock = undefined
}

export function setPreparation(client: SessionClient, forceReply = false): void {
    const room = getRoom(client.roomNumber)
    if (room) room.readyCountdownPending = false
    const changed = client.isReady || client.yourself?.state?.[0] === 1
    client.isReady = false
    if (client.yourself) client.yourself.state = [0]
    for (const mate of client.mates) {
        if (Number(mate.viewerId) === client.viewerId) mate.state = [0]
    }
    if (changed || forceReply) {
        sessionManager.broadcastToRoom(client.roomNumber,
            [1, [2, client.connectionId, [0]]], undefined, client.roomGeneration)
    }
}

function scheduleEquipmentExpiry(room: MultiRoom, client: SessionClient): void {
    if (client.equipmentReadyBlock) return
    const state = {
        instanceId: room.lifecycle.instanceId,
        generation: room.lobby_generation,
        deadline: Date.now() + EQUIPMENT_IDLE_MS,
        timer: undefined as unknown as NodeJS.Timeout,
    }
    state.timer = setTimeout(() => {
        void embeddedMultiCoordinator.enqueueRoomCommand(room.room_number, () => {
            if (client.equipmentReadyBlock !== state) return
            const current = getRoom(room.room_number)
            clearEquipmentBlock(client)
            if (!current || current.lifecycle.instanceId !== state.instanceId
                || current.lobby_generation !== state.generation
                || current.lifecycle.phase !== "LOBBY"
                || sessionManager.getClient(client.viewerId, room.room_number) !== client
                || client.superseded || client.isBattle) return
            if (!hasRestrictedEquipment(current, client)) return
            if (current.host_viewer_id === client.viewerId) {
                sessionManager.commitRoomDisband(current.room_number, "equipment_host_idle")
            } else {
                sessionManager.ejectEquipmentGuest(current.room_number, client.viewerId)
            }
        }).catch(error => console.error("[MULTI] equipment idle expiry failed", error))
    }, EQUIPMENT_IDLE_MS)
    state.timer.unref()
    client.equipmentReadyBlock = state
}

/** Only readiness attempts create a deadline. Heartbeats/retries never refresh it. */
export function enforceEquipmentReady(room: MultiRoom, client: SessionClient, forceReply = false): boolean {
    if (!hasRestrictedEquipment(room, client)) {
        clearEquipmentBlock(client)
        return true
    }
    setPreparation(client, forceReply)
    sessionManager.clearRescueGuestLobbyWait(client.roomNumber, client.viewerId)
    scheduleEquipmentExpiry(room, client)
    return false
}

/** Run inside the room queue; no generation can start with a known invalid peer. */
export function enforceRoomEquipmentReady(room: MultiRoom, generation = room.lobby_generation): boolean {
    let allowed = true
    for (const client of sessionManager.getClientsInRoom(room.room_number, generation)) {
        if (client.isBattle || client.superseded || !client.yourself || client.enterData === null) continue
        if (!enforceEquipmentReady(room, client)) allowed = false
    }
    if (!allowed) {
        const host = sessionManager.getClient(room.host_viewer_id, room.room_number)
        if (host) setPreparation(host)
    }
    return allowed
}

export function recordEquipmentPartyChange(client: SessionClient, partyId?: number, userAction = true): void {
    if (Number.isSafeInteger(partyId) && partyId! >= 1 && partyId! <= 120) {
        client.equipmentSelectedPartyId = partyId
    }
    // A meaningful edit grants another 30s; rechecking itself must not do so.
    const wasBlocked = !!client.equipmentReadyBlock
    if (userAction) clearEquipmentBlock(client)
    const room = getRoom(client.roomNumber)
    if (!room || room.lifecycle.phase !== "LOBBY"
        || client.roomGeneration !== room.lobby_generation) return
    if (wasBlocked || client.isReady || client.yourself?.state?.[0] === 1) {
        enforceEquipmentReady(room, client)
    }
}

/** Freeze the checked selection so late lobby edits cannot change this battle. */
export function freezeEquipmentSelections(room: MultiRoom, generation = room.lobby_generation): void {
    room.equipmentPartyIds = {}
    room.battleParties = {}
    room.npcPartySnapshots = {}
    for (const client of sessionManager.getClientsInRoom(room.room_number, generation)) {
        if (client.isBattle || !client.playerId || client.enterData === null) continue
        const partyId = selectedPartyId(client)
        room.equipmentPartyIds[client.viewerId] = partyId
        if (client.yourself?.party) room.battleParties[client.viewerId] = JSON.parse(JSON.stringify(client.yourself.party))
        try {
            const snapshot = isRealtimeOwnerChild()
                ? getPlayerBusinessFacts(Number(client.playerId), { category: room.category, questId: room.quest_id, partyId })?.questNpcPartySnapshot
                : require("../npc/quest-party-snapshot").captureQuestNpcPartySnapshot(Number(client.playerId), room.category,
                    room.quest_id, partyId, client.yourself?.party)
            if (snapshot) room.npcPartySnapshots[client.viewerId] = snapshot
        } catch (error) {
            // History is optional; a capture failure must not reject the battle.
            console.error("[MULTI] NPC clear-party capture failed", error)
        }
        clearEquipmentBlock(client)
    }
}

export async function notifyEquipmentPartySaved(playerId: number, changedPartyIds: readonly number[],
    selectionChanged: boolean): Promise<void> {
    if (!selectionChanged && !changedPartyIds.length) return
    for (const client of sessionManager.getLobbyClientsForPlayer(playerId)) {
        const initialRoom = getRoom(client.roomNumber)
        if (!initialRoom) continue
        const facts = await refreshRealtimePlayerFacts(playerId, { category: initialRoom.category, questId: initialRoom.quest_id })
        await embeddedMultiCoordinator.enqueueRoomCommand(client.roomNumber, () => {
            const room = getRoom(client.roomNumber)
            if (!room || room.lifecycle.phase !== "LOBBY"
                || client.roomGeneration !== room.lobby_generation
                || sessionManager.getClient(client.viewerId, client.roomNumber) !== client) return
            const selected = facts.partyId
            if (selected === undefined || (!selectionChanged && !changedPartyIds.includes(selected))) return
            recordEquipmentPartyChange(client, selected)
            // Do not replace the client's wire party with a DB edit. Wait for
            // ChangeParty to agree before allowing the next Ready.
            setPreparation(client, true)
            const lobby = require("../tcp/lobby") as typeof import("../tcp/lobby")
            lobby.refreshEquipmentReadiness(client.roomNumber)
        })
    }
}
