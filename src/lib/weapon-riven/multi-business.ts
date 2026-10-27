import { createHash } from "node:crypto"
import { cloneRivenJson, rivenIdentityKey } from "./multi-protocol"
import { rivenSnapshotStore } from "./multi-store"
import { buildRivenSnapshot, validateRivenRequest, validateRivenSnapshotAdmission } from "./multi-snapshot"
import type { RivenFreezeRequest, RivenSnapshotReference } from "./multi-types"
import { getRealtimeBusinessAdmission } from "../../multi/coordinator/business-rpc"

/** No registration in a child; business-rpc already rejects child fallback. */
export async function handleRivenBusiness(kind: string, value: unknown): Promise<unknown> {
    const input = cloneRivenJson(value) as RivenFreezeRequest & RivenSnapshotReference
    rivenIdentityKey(input.identity)
    const proof = getRealtimeBusinessAdmission() as { ownerEpoch?: string } | undefined
    if (proof?.ownerEpoch && proof.ownerEpoch !== input.identity.ownerEpoch) throw new Error("RIVEN_OWNER_EPOCH_MISMATCH")
    switch (kind) {
        case "riven.freeze": {
            validateRivenRequest(input)
            const fingerprint = createHash("sha256").update(JSON.stringify([input.category, input.questId,
                input.members.map(member => [member.viewerId, member.playerId, member.connectionId, member.partyId,
                    member.mate.comId ?? 0, member.session ?? null, member.admissionToken ?? null]),
                input.disabledReason ?? ""])).digest("hex")
            return rivenSnapshotStore.prepare(input.identity, fingerprint, () => buildRivenSnapshot(input),
                snapshot => validateRivenSnapshotAdmission(input, snapshot))
        }
        case "riven.validate": rivenSnapshotStore.validate(input); return { ok: true }
        case "riven.commit": return rivenSnapshotStore.commit(input)
        case "riven.cancel": return rivenSnapshotStore.cancel(input)
        case "riven.release": return rivenSnapshotStore.release(input)
        case "riven.get": return rivenSnapshotStore.get(input)
        default: throw new Error("UNKNOWN_RIVEN_BUSINESS_KIND")
    }
}
