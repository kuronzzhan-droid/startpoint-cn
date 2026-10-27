import { createHash, randomUUID } from "node:crypto"
import { getDb } from "../../data/db"
import { resolvePlayerIdSync } from "../../data/activeAccount"
import { getPlayerPartyGroupListSync } from "../../data/domains/party"
import { enforceWeaponRivenPartyLimitSync } from "../../data/domains/weapon-riven-party"
import { migrateWeaponRivenQualities } from "../../data/initializers/weapon-riven-quality"
import type { RivenRow } from "../../data/domains/weaponRiven"
import { PartyCategory } from "../../data/types"
import { buildRealParty } from "../../multi/party-snapshot"
import { runPersistenceTransaction } from "../persistence-coordinator"
import { playerAccountByViewer, playerSocketAllowed } from "../player-login"
import { clientAdmission } from "../client-admission"
import { getQuestFromCategorySync } from "../assets"
import { parseGlobalPartyId } from "../special-event-parties"
import { isWeaponRivenInstanceId } from "./client"
import { isUnknownWeaponRivenItemId, isWeaponRivenItemId } from "./constants"
import { stripWeaponRivenRoomPreview } from "./room-preview"
import { stripWeaponRivenPublicPayload } from "./public-payload"
import { displayWeaponRivenAffixes } from "./display"
import { weaponRivenRuleSet } from "./rules"
import { normalizeWeaponRivenLoadout } from "./loadout"
import { canonicalRivenMembers, cloneRivenJson, rivenIdentityKey, rivenIdentifier, rivenInteger, RIVEN_MULTI_SCOPE } from "./multi-protocol"
import { readRivenResourceCatalog, rivenRulesDigest } from "./multi-catalog"
import { RIVEN_FORCED_DISABLED_REASONS } from "./multi-types"
import type { RivenFreezeMember, RivenFreezeRequest, RivenResourceCatalog, RivenSnapshot } from "./multi-types"

interface Capability { p1: boolean; p2: boolean; catalog: string }
interface Decision { mode: 0 | 1; reason: string; catalog: string; ackConnectionIds: string[] }
const MATE_FIELDS = ["name", "rank", "degreeId", "leaderCharacterId", "mainCharacterId", "playerRoleKind", "isNewbie", "entryTime", "state", "autoplayMode", "autoskillMode", "autoSpeedLevel",
    "autoStart", "skillAbilityBehaviorMode", "dashBehaviorMode", "allowHealFromOtherPlayers", "preparation", "isHost"]
export function validateRivenRequest(input: RivenFreezeRequest): void {
    rivenIdentityKey(input.identity); rivenInteger(input.category, 1); rivenInteger(input.questId, 1)
    if (!Array.isArray(input.members) || !input.members.length || input.members.length > 3) throw new Error("RIVEN_INVALID_ROSTER")
    const viewers = new Set<number>(), players = new Set<number>(), connections = new Set<string>(), coms = new Set<number>()
    for (const member of input.members) {
        rivenInteger(member.viewerId, 1); rivenInteger(member.playerId)
        if (typeof member.connectionId !== "string" || !/^[\x20-\x7e]{1,256}$/.test(member.connectionId)) throw new Error("RIVEN_INVALID_CONNECTION")
        const comId = rivenInteger(member.mate?.comId ?? 0)
        if (viewers.has(member.viewerId) || connections.has(member.connectionId)
            || comId && (member.playerId !== 0 || coms.has(comId)) || !comId && (member.playerId === 0 || players.has(member.playerId))) throw new Error("RIVEN_DUPLICATE_MEMBER")
        viewers.add(member.viewerId); connections.add(member.connectionId)
        if (comId) coms.add(comId)
        else {
            players.add(member.playerId)
            if (!parseGlobalPartyId(rivenInteger(member.partyId, 1))) throw new Error("RIVEN_INVALID_PARTY_ID")
        }
    }
    if (!players.size) throw new Error("RIVEN_NO_REAL_MEMBER")
    if (input.disabledReason !== undefined && !(RIVEN_FORCED_DISABLED_REASONS as readonly string[]).includes(input.disabledReason))
        throw new Error("RIVEN_INVALID_DISABLED_REASON")
}
function authorized(member: RivenFreezeMember): Capability {
    const accountId = playerAccountByViewer(member.viewerId)
    if (!accountId || resolvePlayerIdSync(accountId) !== member.playerId || !playerSocketAllowed(member.viewerId, member.session)) throw new Error("RIVEN_PLAYER_AUTHORIZATION")
    const lease = clientAdmission().socketLease(member.admissionToken, member.session, false)
    if (!lease.ok) throw new Error("RIVEN_ADMISSION_REJECTED")
    const capabilities = (lease as typeof lease & { weaponRiven?: Capability }).weaponRiven
    return capabilities ?? { p1: false, p2: false, catalog: "none" }
}
function authorize(input: RivenFreezeRequest): Capability[] {
    return input.members.filter(member => !member.mate.comId).map(authorized)
}
/**
 * `rivenFree`: no real member's saved party holds any riven item (revealed instance or unknown/themed unknown).
 * Such a room has nothing to freeze, so it is disabled with an empty ACK set and never waits on a riven ACK.
 * `input.disabledReason` is the owner's whole-room downgrade after a client NACKed an enabled prepare.
 */
function decide(input: RivenFreezeRequest, capabilities: Capability[], resources: RivenResourceCatalog | null,
    fixed: boolean, rivenFree: boolean): Decision {
    const real = input.members.filter(member => !member.mate.comId)
    const reason = (fixed ? "fixed_party" : process.env.WEAPON_RIVEN_MULTI_ENABLED !== "1" ? "server_disabled"
        : rivenFree ? "no_rivens"
        : capabilities.some(cap => !cap.p1 || !cap.p2) ? "mixed_version" : !resources ? "resources_unavailable"
        : capabilities.some(cap => cap.catalog !== resources.id) ? "catalog_mismatch" : "") || (input.disabledReason ?? "")
    const ackConnectionIds = reason === "no_rivens" ? []
        : real.filter((_, i) => capabilities[i].p2).map(member => member.connectionId)
    return { mode: reason ? 0 : 1, reason, catalog: reason ? "none" : resources!.id, ackConnectionIds }
}
function savedNormalParty(member: RivenFreezeMember): any {
    const parsed = parseGlobalPartyId(member.partyId)!
    return getPlayerPartyGroupListSync(member.playerId, PartyCategory.NORMAL)[parsed.groupId]?.list[parsed.slot]
}
/** Read after limit repair; a missing saved party is never riven-free (the build rejects it). */
function rivenFreeRoom(input: RivenFreezeRequest): boolean {
    return input.members.filter(member => !member.mate.comId).every(member => {
        const saved = savedNormalParty(member)
        return !!saved && !saved.abilitySoulIds.some((id: unknown) => isWeaponRivenItemId(id) || isUnknownWeaponRivenItemId(id))
    })
}
function resourceCatalog(): RivenResourceCatalog | null {
    // An invalid deployment must not silently grant enabled effects.
    try { return readRivenResourceCatalog() } catch { return null }
}
function fixedQuest(input: RivenFreezeRequest): boolean {
    const quest = getQuestFromCategorySync(input.category, input.questId)
    if (!quest) throw new Error("RIVEN_QUEST_MISSING")
    return "fixedParty" in quest && quest.fixedParty !== undefined
}
function mateWithParty(member: RivenFreezeMember, party: any): any {
    const mate: any = { viewerId: member.viewerId, playerId: member.playerId, connectionId: member.connectionId, currentPartyId: member.partyId, party }
    if (member.mate.comId) mate.comId = member.mate.comId
    for (const field of MATE_FIELDS) if (member.mate[field] !== undefined) mate[field] = cloneRivenJson(member.mate[field])
    return mate
}
function partyContext(party: any, snapshotId: string, decision: Decision): any {
    return { ...party, weapon_rivens: [[1], [1], [1]], weapon_riven_scope: RIVEN_MULTI_SCOPE,
        weapon_riven_snapshot_id: snapshotId, weapon_riven_mode: decision.mode,
        weapon_riven_catalog: decision.catalog, weapon_riven_reason: decision.reason }
}
/** All migrations/limit repairs finish first; all members are then read synchronously in one transaction. */
export async function buildRivenSnapshot(input: RivenFreezeRequest): Promise<RivenSnapshot> {
    validateRivenRequest(input)
    const fixed = fixedQuest(input), resources = resourceCatalog(), snapshotId = randomUUID()
    return runPersistenceTransaction({ domain: "player", operation: "freeze_multi_weapon_rivens" }, () => {
        const capabilities = authorize(input)
        if (!fixed) for (const member of input.members) if (!member.mate.comId) {
            migrateWeaponRivenQualities(getDb(), member.playerId)
            enforceWeaponRivenPartyLimitSync(member.playerId, member.partyId)
        }
        const decision = decide(input, capabilities, resources, fixed, !fixed && rivenFreeRoom(input))
        const audit: RivenSnapshot["audit"] = [], conversionLoadouts: RivenSnapshot["conversionLoadouts"] = []
        const members = input.members.map(member => {
            if (member.mate.comId) return mateWithParty(member, cloneRivenJson(stripWeaponRivenPublicPayload(member.mate.party)))
            if (fixed) return mateWithParty(member, partyContext(cloneRivenJson(stripWeaponRivenRoomPreview(member.mate.party)), snapshotId, decision))
            const savedParty = savedNormalParty(member)
            if (!savedParty) throw new Error("RIVEN_SAVED_PARTY_MISSING")
            const party = partyContext(cloneRivenJson(buildRealParty(member.playerId, savedParty)), snapshotId, decision)
            conversionLoadouts.push({ playerId: member.playerId, loadout: normalizeWeaponRivenLoadout({ ...savedParty, partyId: member.partyId }) })
            if (decision.mode) for (let slot = 0; slot < 3; slot++) {
                const itemId = savedParty.abilitySoulIds[slot]
                if (!isWeaponRivenInstanceId(itemId)) continue
                const row = getDb().prepare(`SELECT riven_id,item_id,weapon_id,revision,affixes_json,affix_version
                    FROM player_weapon_rivens WHERE player_id=? AND item_id=?`).get(member.playerId, itemId) as RivenRow | undefined
                if (!row || row.item_id !== itemId || !Number.isSafeInteger(row.riven_id) || row.riven_id <= 0
                    || !Number.isSafeInteger(row.revision) || row.revision < 0 || row.affix_version !== 3) throw new Error("RIVEN_INVALID_OWNERSHIP")
                const affixes = JSON.parse(row.affixes_json)
                if (!Array.isArray(affixes) || affixes.length < 1 || affixes.length > 4) throw new Error("RIVEN_INVALID_AFFIXES")
                const pairs = displayWeaponRivenAffixes(row.weapon_id, affixes, row.affix_version, weaponRivenRuleSet)
                party.abilitySoulIds[slot] = [0, itemId]
                party.weapon_rivens[slot] = [0, [itemId, row.weapon_id, ...pairs.flatMap(([key, level]) => [key, level])]]
                audit.push({ playerId: member.playerId, slot, itemId, rivenId: row.riven_id, revision: row.revision, weaponId: row.weapon_id })
            }
            return mateWithParty(member, party)
        })
        const canonical = canonicalRivenMembers(members, decision.mode ? resources! : undefined)
        return { identity: cloneRivenJson(input.identity), snapshotId, members, canonical,
            sha256: createHash("sha256").update(canonical, "ascii").digest("hex"), ...decision,
            rulesDigest: rivenRulesDigest(weaponRivenRuleSet), conversionLoadouts, audit }
    })
}
/**
 * Recheck authorization and whole-room decision without rebuilding frozen parties or rows.
 * Riven presence is a property of the frozen rows, so it is taken from the snapshot, not re-read.
 */
export function validateRivenSnapshotAdmission(input: RivenFreezeRequest, snapshot: RivenSnapshot): void {
    const fixed = fixedQuest(input)
    const current = decide(input, authorize(input), resourceCatalog(), fixed, !fixed && snapshot.reason === "no_rivens")
    if (current.mode !== snapshot.mode || current.catalog !== snapshot.catalog || current.reason !== snapshot.reason
        || current.ackConnectionIds.join("|") !== snapshot.ackConnectionIds.join("|")) throw new Error("RIVEN_ADMISSION_CHANGED")
}
