import { cloneCommandJson } from "./command-protocol"
import { invokeRealtimeBusiness } from "./business-rpc"
import type { QuestNpcPartySnapshot } from "../npc/quest-party-pool-shared"
import type { WeaponRivenBattleLoadout } from "../../lib/weapon-riven/loadout"

export interface PlayerFactsScope { category: number; questId: number; partyId?: number; wireParty?: unknown }
export interface PlayerBusinessFacts {
    parentEpoch: string; revision: number; playerId: number; viewerId: number; expiresAt: number
    category: number; questId: number; partyId: number
    player: { name: string; rank: number; degreeId: number; leaderCharacterId: number; role: number; tutorialStep: number; partySlot: number }
    party: any; ownedCharacterIds: number[]; restrictedEquipment: boolean
    weaponRivenLoadout?: WeaponRivenBattleLoadout
    guestEligibility: { allowed: boolean; reason?: string }
    questNpcPartySnapshot: QuestNpcPartySnapshot | null
    questPolicy: { isMode15: boolean; equipmentAllowed: boolean; hostAllowed: boolean; exclusiveItemIds: number[] }
}
const entries = new Map<number, PlayerBusinessFacts>()
// Quest classification is parent-verified content metadata. It outlives a
// player's eligibility TTL; it never carries hostAllowed or player ownership.
const questClassifications = new Map<string, boolean>()
let parentEpoch: string | undefined
const MAX_FACTS = 1024

export function applyPlayerBusinessFacts(input: PlayerBusinessFacts): boolean {
    const facts = cloneCommandJson(input)
    if (!Number.isSafeInteger(facts.playerId) || facts.playerId <= 0 || !Number.isSafeInteger(facts.revision)
        || facts.revision <= 0 || !facts.parentEpoch || !Number.isFinite(facts.expiresAt) || facts.expiresAt <= Date.now()) return false
    if (parentEpoch !== undefined && facts.parentEpoch !== parentEpoch) return false
    const questKey = `${facts.category}:${facts.questId}`
    if (!questClassifications.has(questKey) && questClassifications.size >= MAX_FACTS) return false
    const previous = entries.get(facts.playerId)
    if (previous && previous.revision >= facts.revision) return false
    for (const [id, stored] of entries) if (stored.expiresAt <= Date.now()) entries.delete(id)
    if (!entries.has(facts.playerId) && entries.size >= MAX_FACTS) return false
    parentEpoch ??= facts.parentEpoch
    questClassifications.set(questKey, facts.questPolicy.isMode15)
    entries.delete(facts.playerId); entries.set(facts.playerId, facts)
    return true
}

export function getPlayerBusinessFacts(playerId: number, scope?: Partial<PlayerFactsScope>): PlayerBusinessFacts | undefined {
    const facts = entries.get(playerId)
    if (!facts || facts.expiresAt <= Date.now()
        || (scope?.category !== undefined && scope.category !== facts.category)
        || (scope?.questId !== undefined && scope.questId !== facts.questId)
        || (scope?.partyId !== undefined && scope.partyId !== facts.partyId)) return undefined
    return cloneCommandJson(facts)
}
export function getQuestBusinessPolicy(category: number, questId: number): PlayerBusinessFacts["questPolicy"] | undefined {
    for (const facts of entries.values()) if (facts.category === category && facts.questId === questId
        && facts.expiresAt > Date.now()) return cloneCommandJson(facts.questPolicy)
    return undefined
}
export function getQuestBusinessClassification(category: number, questId: number): boolean | undefined {
    return questClassifications.get(`${category}:${questId}`)
}
export function getKnownExclusiveBusinessItemIds(): number[] {
    return [...new Set([...entries.values()].filter(facts => facts.expiresAt > Date.now())
        .flatMap(facts => facts.questPolicy.exclusiveItemIds))]
}
export function invalidatePlayerBusinessFacts(playerId: number): void { entries.delete(playerId) }
export function clearPlayerBusinessFacts(): void { entries.clear(); questClassifications.clear(); parentEpoch = undefined }
export async function refreshRealtimePlayerFacts(playerId: number, scope: PlayerFactsScope): Promise<PlayerBusinessFacts> {
    const payload: { playerId: number; category: number; questId: number; partyId?: number; wireParty?: unknown } = {
        playerId, category: scope.category, questId: scope.questId,
    }
    if (scope.partyId !== undefined) payload.partyId = scope.partyId
    if (scope.wireParty !== undefined) payload.wireParty = scope.wireParty
    const facts = await invokeRealtimeBusiness<PlayerBusinessFacts>("player.facts", payload)
    const current = getPlayerBusinessFacts(playerId)
    if (!applyPlayerBusinessFacts(facts) && (!current || current.revision !== facts.revision
        || current.parentEpoch !== facts.parentEpoch)) throw new Error("PLAYER_FACTS_STALE")
    return facts
}

const presenceAt = new Map<number, number>()
/** Coalesced business projection, never awaited by the TCP input loop. */
export function notifyRealtimePresence(viewerId: number): void {
    if (!Number.isSafeInteger(viewerId) || viewerId <= 0) return
    const now = Date.now()
    if ((presenceAt.get(viewerId) ?? 0) > now - 30_000) return
    presenceAt.delete(viewerId); presenceAt.set(viewerId, now)
    while (presenceAt.size > MAX_FACTS) presenceAt.delete(presenceAt.keys().next().value!)
    void invokeRealtimeBusiness("presence.touch", { viewerId }).catch(() => presenceAt.delete(viewerId))
}
