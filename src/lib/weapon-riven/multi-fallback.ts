import { createHash, randomUUID } from "node:crypto"
import { canonicalRivenMembers, cloneRivenJson, RIVEN_MULTI_SCOPE } from "./multi-protocol"
import { stripWeaponRivenRoomPreview } from "./room-preview"
import { stripWeaponRivenPublicPayload } from "./public-payload"
import type { RivenFreezeRequest, RivenSnapshot } from "./multi-types"

/** Only a definite unavailable freeze may fall back; authorization and unknown outcomes may not. */
export function rivenFreezeUnavailable(error: unknown): boolean {
    const failure = error as { code?: string; message?: string } | null
    return new Set(["REALTIME_BUSINESS_CHANNEL_UNAVAILABLE",
        "BUSINESS_PENDING_BUDGET", "UNKNOWN_REALTIME_BUSINESS_KIND", "UNKNOWN_RIVEN_BUSINESS_KIND"])
        .has(failure?.code ?? failure?.message ?? "")
}

/** Owner-local, disabled wire DTO only. Never claims parent persistence or derives conversion rights. */
export function disabledRivenSnapshot(input: RivenFreezeRequest, ackConnectionIds: string[]): RivenSnapshot {
    const snapshotId = randomUUID()
    const members = input.members.map(member => {
        const mate = cloneRivenJson(member.mate.comId
            ? stripWeaponRivenPublicPayload(member.mate) : stripWeaponRivenRoomPreview(member.mate))
        if (!member.mate.comId) mate.party = { ...mate.party, weapon_rivens: [[1], [1], [1]],
            weapon_riven_scope: RIVEN_MULTI_SCOPE, weapon_riven_snapshot_id: snapshotId,
            weapon_riven_mode: 0, weapon_riven_catalog: "none", weapon_riven_reason: "rpc_unavailable" }
        return mate
    })
    const canonical = canonicalRivenMembers(members)
    return { identity: cloneRivenJson(input.identity), snapshotId, members, canonical,
        sha256: createHash("sha256").update(canonical, "ascii").digest("hex"), mode: 0,
        catalog: "none", reason: "rpc_unavailable", rulesDigest: "none", ackConnectionIds,
        conversionLoadouts: [], audit: [] }
}
