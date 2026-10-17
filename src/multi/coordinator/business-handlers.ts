import { randomUUID } from "node:crypto"
import { isRealtimeOwnerChild } from "./runtime-role"
import type { PlayerBusinessFacts, PlayerFactsScope } from "./business-facts"

const parentEpoch = randomUUID()
let revisionCounter = 0
function positive(value: unknown): number { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new Error("INVALID_BUSINESS_ID"); return n }
function json<T>(value: T): T { return JSON.parse(JSON.stringify(value)) }

function readFacts(playerId: number, scope: PlayerFactsScope, viewerId = 0): PlayerBusinessFacts {
    const player = require("../../data/domains/player").getPlayerSync(playerId)
    if (!player) throw new Error("PLAYER_NOT_FOUND")
    const partyId = scope.partyId ?? player.partySlot ?? 1
    if (!Number.isSafeInteger(partyId) || partyId < 1 || partyId > 120
        || !Number.isSafeInteger(scope.category) || !Number.isSafeInteger(scope.questId)) throw new Error("INVALID_FACTS_SCOPE")
    const party = scope.wireParty ?? require("../party-snapshot").getRealPartySnapshot(playerId)
    const mode = require("../../lib/mode15-optional") as typeof import("../../lib/mode15-optional")
    const exclusive = require("../npc/equipment-policy").exclusivePartyItems(party) as number[]
    const globalExclusive = mode.getMode15ExclusiveGlobalPartyItemsSync(playerId, 1, partyId)
    const equipmentAllowed = mode.isMode15EquipmentAllowedQuest(scope.category, scope.questId)
    const revision = ++revisionCounter
    let snapshot = null
    try { snapshot = require("../npc/quest-party-snapshot").captureQuestNpcPartySnapshot(playerId, scope.category, scope.questId, partyId, party) }
    catch { /* Optional NPC history cannot reject an otherwise valid party. */ }
    return json({ parentEpoch, revision, playerId, viewerId, expiresAt: Date.now() + 120_000,
        category: scope.category, questId: scope.questId, partyId, party,
        player: { name: player.name, rank: require("../../lib/stamina").getRankDegree(player.rankPoint || 0),
            degreeId: player.degreeId || 1, leaderCharacterId: player.leaderCharacterId, role: player.role || 1,
            tutorialStep: player.tutorialStep || 0, partySlot: player.partySlot || 1 },
        ownedCharacterIds: Object.keys(require("../../data/domains/character").getPlayerCharactersSync(playerId)).map(Number),
        restrictedEquipment: !equipmentAllowed && (exclusive.length > 0 || globalExclusive.length > 0),
        guestEligibility: require("../guest-eligibility").canJoinMultiGuestQuestSync(playerId, scope.category, scope.questId, player),
        questNpcPartySnapshot: snapshot,
        questPolicy: { isMode15: mode.isMode15Quest(scope.category, scope.questId), equipmentAllowed,
            hostAllowed: !mode.isMode15Quest(scope.category, scope.questId)
                || mode.canStartMode15QuestSync(playerId, scope.category, scope.questId).allowed,
            exclusiveItemIds: [...new Set([...exclusive, ...globalExclusive])] },
    })
}

/** This module is dispatched in the business parent only. Lazy imports keep the owner DB-free. */
export async function handleRealtimeBusiness(kind: string, input: unknown): Promise<unknown> {
    if (isRealtimeOwnerChild()) throw new Error("REALTIME_BUSINESS_PARENT_ONLY")
    const payload = input as any
    switch (kind) {
        case "player.authorize": return require("../../lib/player-login").playerSocketAllowed(payload.viewerId, payload.session ?? undefined)
        case "player.handshake": {
            const viewerId = positive(payload.viewerId)
            if (!require("../../lib/player-login").playerSocketAllowed(viewerId, payload.session ?? undefined)) return null
            const context = await require("../player-context").resolveMultiPlayerContext(viewerId)
            if (!require("../../lib/player-login").playerSocketAllowed(viewerId, payload.session ?? undefined)) return null
            return context ? readFacts(context.playerId, payload, viewerId) : null
        }
        case "player.facts": return readFacts(positive(payload.playerId), payload)
        case "player.party": {
            const playerId = positive(payload.playerId)
            const currentPlayer = require("../../data/domains/player").getPlayerSync(playerId)
            if (payload.expectedSavedPartyId !== undefined && currentPlayer?.partySlot !== payload.expectedSavedPartyId) {
                return readFacts(playerId, { category: payload.category, questId: payload.questId })
            }
            if (payload.party !== undefined) require("../party-snapshot").setRealPartySnapshot(playerId, payload.party)
            if (payload.partyId !== undefined) await require("../../data/domains/player").updatePlayerPartySlotAsync(playerId, positive(payload.partyId))
            return readFacts(playerId, { ...payload, wireParty: payload.party })
        }
        case "presence.touch": return require("../../lib/online-presence").markPlayerOnlineFromTcp(positive(payload.viewerId))
        case "npc.parties": return require("../npc/player-party-pool").getRandomPlayerNpcPartiesSync(payload.playerId,
            Math.max(0, Math.min(2, Number(payload.count))), require("../npc/player-party-pool").getNpcPartySelectionOptions(payload.category, payload.questId)).map((entry: any) => entry.party)
        case "npc.mates": {
            const { mate1, mate2 } = require("../npc/builder").buildNpcMates(payload.questId, payload.category)
            return json([mate1, mate2].filter(Boolean))
        }
        case "lounge.handshake": {
            if (!require("../../lib/player-login").playerSocketAllowed(payload.viewerId, payload.session ?? undefined)) return null
            const session = await require("../../data/domains/session").getSession(String(payload.viewerId))
            if (!require("../../lib/player-login").playerSocketAllowed(payload.viewerId, payload.session ?? undefined)) return null
            const playerId = session ? require("../../data/activeAccount").resolvePlayerIdSync(session.accountId) : null
            return playerId && require("../../lounge/eligibility").canParticipateInLounge(playerId, payload.campaignId) ? { playerId } : null
        }
        case "lounge.start": {
            if (!Array.isArray(payload.playerIds) || payload.playerIds.length !== 3
                || payload.playerIds.some((id: unknown) => !Number.isSafeInteger(id) || Number(id) <= 0)
                || new Set(payload.playerIds).size !== 3) return false
            return require("../../lounge/eligibility").decideLoungeTickets({ campaignId: payload.campaignId }, payload.playerIds)
        }
        default:
            if (kind.startsWith("fiveBoss.")) return require("./five-boss-business-handlers").handleFiveBossBusiness(kind, payload)
            throw new Error("UNKNOWN_REALTIME_BUSINESS_KIND")
    }
}
