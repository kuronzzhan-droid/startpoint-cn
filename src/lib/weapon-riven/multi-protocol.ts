import { isWeaponRivenInstanceId } from "./client"
import { isUnknownWeaponRivenItemId } from "./constants"
import type { RivenPreparationIdentity, RivenResourceCatalog } from "./multi-types"

export const RIVEN_MULTI_SCOPE = "multi-v1"
export const RIVEN_MULTI_CAPABILITY = "weapon-riven-multi-v1"
export const RIVEN_MULTI_MAX_ACK_BYTES = 4096
const ID = /^[A-Za-z0-9_-]{1,96}$/
export function rivenIdentifier(value: unknown): string {
    if (typeof value !== "string" || !ID.test(value)) throw new Error("RIVEN_INVALID_IDENTIFIER")
    return value
}
export function rivenInteger(value: unknown, minimum = 0): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error("RIVEN_INVALID_INTEGER")
    return value
}
export function rivenInternalIdentity(value: unknown): string {
    if (typeof value !== "string" || !/^[\x20-\x7e]{1,256}$/.test(value)) throw new Error("RIVEN_INVALID_INTERNAL_IDENTITY")
    return value
}
export function rivenIdentityKey(identity: RivenPreparationIdentity): string {
    if (!identity) throw new Error("RIVEN_INVALID_IDENTITY")
    return JSON.stringify([rivenInternalIdentity(identity.ownerEpoch), rivenInternalIdentity(identity.roomInstanceId),
        rivenInteger(identity.sourceLobbyGeneration), rivenInternalIdentity(identity.preparationId)])
}
export function cloneRivenJson<T>(value: T): T { return JSON.parse(JSON.stringify(value)) }
function option(value: unknown): any | null {
    if (!Array.isArray(value)) throw new Error("RIVEN_INVALID_OPTION")
    if (value.length === 1 && value[0] === 1) return null
    if (value.length === 2 && value[0] === 0 && value[1] !== null) return value[1]
    throw new Error("RIVEN_INVALID_OPTION")
}
function slots(party: any, name: string): any[] {
    if (!Array.isArray(party?.[name]) || party[name].length !== 3) throw new Error("RIVEN_INVALID_SLOTS")
    return party[name]
}
function wireInteger(value: unknown): number {
    const id = rivenInteger(value, 1)
    if (id > 2147483647) throw new Error("RIVEN_INVALID_WIRE_INTEGER")
    return id
}
function objectId(value: any, field: string): number { return value === null ? 0 : wireInteger(value?.[field]) }

/** Fixed scalar order; never object iteration, JSON serialization or 32-bit coercion. */
export function canonicalRivenMembers(members: any[], resources?: RivenResourceCatalog): string {
    if (!Array.isArray(members) || members.length < 1 || members.length > 3) throw new Error("RIVEN_INVALID_ROSTER")
    const first = members.find(member => !member?.comId)?.party
    if (!first || first.weapon_riven_scope !== RIVEN_MULTI_SCOPE) throw new Error("RIVEN_MISSING_CONTEXT")
    const snapshotId = rivenIdentifier(first.weapon_riven_snapshot_id), catalog = rivenIdentifier(first.weapon_riven_catalog)
    const mode = rivenInteger(first.weapon_riven_mode)
    if (mode !== 0 && mode !== 1 || mode === 0 && catalog !== "none" || mode === 1 && catalog === "none") throw new Error("RIVEN_INVALID_MODE")
    if (mode && resources && resources.id !== catalog) throw new Error("RIVEN_CATALOG_MISMATCH")
    const reason = first.weapon_riven_reason
    if (typeof reason !== "string" || mode === 1 && reason !== "" || mode === 0 && !ID.test(reason)) throw new Error("RIVEN_INVALID_REASON")
    const result: Array<string | number> = ["WFR2C1", catalog, mode, members.length]
    const identities = new Set<string>()
    for (const member of members) {
        const viewerId = rivenInteger(member?.viewerId, 1), comId = rivenInteger(member?.comId ?? 0)
        if (comId > 2147483647) throw new Error("RIVEN_INVALID_COM_ID")
        const identity = comId ? `C|${comId}` : `V|${viewerId}`
        if (identities.has(identity)) throw new Error("RIVEN_DUPLICATE_MEMBER")
        identities.add(identity)
        const party = member.party
        if (!party || typeof party !== "object") throw new Error("RIVEN_INVALID_PARTY")
        if (comId) {
            if (Object.keys(party).some(key => key === "weapon_rivens" || key.startsWith("weapon_riven_"))) throw new Error("RIVEN_COM_CONTEXT")
        } else if (party.weapon_riven_scope !== RIVEN_MULTI_SCOPE || party.weapon_riven_snapshot_id !== snapshotId
            || party.weapon_riven_catalog !== catalog || party.weapon_riven_mode !== mode
            || party.weapon_riven_reason !== reason) throw new Error("RIVEN_CONTEXT_MISMATCH")
        const characters = slots(party, "characters"), unisons = slots(party, "unison_characters")
        const equipments = slots(party, "equipments"), souls = slots(party, "abilitySoulIds")
        const rows = comId ? [[1], [1], [1]] : slots(party, "weapon_rivens")
        let count = 0
        result.push(comId ? "C" : "V", comId || viewerId)
        for (let slot = 0; slot < 3; slot++) {
            const mainId = objectId(option(characters[slot]), "id"), unisonId = objectId(option(unisons[slot]), "id")
            const weaponId = objectId(option(equipments[slot]), "equipmentId")
            const soul = option(souls[slot]), soulId = soul === null ? 0 : wireInteger(soul)
            const row = option(rows[slot]), instance = isWeaponRivenInstanceId(soulId)
            if ((comId && (instance || isUnknownWeaponRivenItemId(soulId))) || (!mode && instance)) throw new Error("RIVEN_DISABLED_INSTANCE")
            if (instance && ++count > 1) throw new Error("RIVEN_PARTY_LIMIT")
            if (row === null) {
                if (instance) throw new Error("RIVEN_MISSING_ROW")
                result.push(mainId, unisonId, weaponId, soulId, 0)
                continue
            }
            if (!mode || comId || !instance || !Array.isArray(row) || ![4, 6, 8, 10].includes(row.length)
                || row[0] !== soulId) throw new Error("RIVEN_INVALID_ROW")
            row.forEach(wireInteger)
            if (resources && (!resources.soulKeys.has(soulId) || !resources.weaponIds.has(row[1])
                || weaponId !== 0 && !resources.weaponIds.has(weaponId))) throw new Error("RIVEN_MISSING_RESOURCE")
            const keys = new Set<number>()
            for (let i = 2; i < row.length; i += 2) {
                if (row[i + 1] > 100 || keys.has(row[i]) || resources && !resources.soulKeys.has(row[i])) throw new Error("RIVEN_INVALID_AFFIX")
                keys.add(row[i])
            }
            result.push(mainId, unisonId, weaponId, soulId, row.length, ...row)
        }
    }
    const content = result.join("|")
    if (Buffer.byteLength(`WFR2|A|${snapshotId}|${content}`, "ascii") > RIVEN_MULTI_MAX_ACK_BYTES) throw new Error("RIVEN_ACK_LIMIT")
    return content
}
export type RivenAcknowledgement = { kind: "A"; snapshotId: string; canonical: string }
    | { kind: "N"; snapshotId: string; reason: string }
export function parseRivenAcknowledgement(value: unknown): RivenAcknowledgement | null {
    if (typeof value !== "string" || !value.startsWith("WFR2|")) return null
    if (Buffer.byteLength(value, "utf8") > RIVEN_MULTI_MAX_ACK_BYTES || !/^[\x20-\x7e]+$/.test(value)) throw new Error("RIVEN_INVALID_ACK")
    const match = /^WFR2\|([AN])\|([A-Za-z0-9_-]{1,96})\|(.+)$/.exec(value)
    if (!match) throw new Error("RIVEN_INVALID_ACK")
    if (match[1] === "N" && ID.test(match[3])) return { kind: "N", snapshotId: match[2], reason: match[3] }
    if (match[1] !== "A") throw new Error("RIVEN_INVALID_ACK")
    validateRivenCanonical(match[3])
    return { kind: "A", snapshotId: match[2], canonical: match[3] }
}

/** Parse lengths as well as scalar syntax so truncated/extra ACK fields are never accepted. */
export function validateRivenCanonical(content: string): void {
    const fields = content.split("|")
    let cursor = 0
    const number = (maximum = Number.MAX_SAFE_INTEGER): number => {
        const raw = fields[cursor++]
        if (!/^(0|[1-9][0-9]*)$/.test(raw ?? "")) throw new Error("RIVEN_INVALID_CANONICAL")
        const value = rivenInteger(Number(raw))
        if (value > maximum) throw new Error("RIVEN_INVALID_CANONICAL")
        return value
    }
    if (fields[cursor++] !== "WFR2C1" || !ID.test(fields[cursor++] ?? "")) throw new Error("RIVEN_INVALID_CANONICAL")
    const mode = number(), count = number(), identities = new Set<string>()
    if (mode > 1 || count < 1 || count > 3 || (mode === 0) !== (fields[1] === "none")) throw new Error("RIVEN_INVALID_CANONICAL")
    for (let member = 0; member < count; member++) {
        const kind = fields[cursor++], id = number(), identity = `${kind}|${id}`
        if (kind !== "V" && kind !== "C" || id < 1 || kind === "C" && id > 2147483647 || identities.has(identity)) throw new Error("RIVEN_INVALID_CANONICAL")
        identities.add(identity)
        let cards = 0
        for (let slot = 0; slot < 3; slot++) {
            number(2147483647); number(2147483647); number(2147483647)
            const soul = number(2147483647), length = number(), instance = isWeaponRivenInstanceId(soul)
            if (![0, 4, 6, 8, 10].includes(length) || instance !== (length > 0)
                || instance && (++cards > 1 || mode === 0 || kind === "C")
                || kind === "C" && isUnknownWeaponRivenItemId(soul)) throw new Error("RIVEN_INVALID_CANONICAL")
            const row = Array.from({ length }, () => number(2147483647))
            if (length && (row[0] !== soul || row.some(value => value < 1))) throw new Error("RIVEN_INVALID_CANONICAL")
            const keys = new Set<number>()
            for (let i = 2; i < length; i += 2) {
                if (keys.has(row[i]) || row[i + 1] > 100) throw new Error("RIVEN_INVALID_CANONICAL")
                keys.add(row[i])
            }
        }
    }
    if (cursor !== fields.length) throw new Error("RIVEN_INVALID_CANONICAL")
}
