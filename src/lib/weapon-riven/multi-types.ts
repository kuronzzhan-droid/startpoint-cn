import type { WeaponRivenBattleLoadout } from "./loadout"
export interface RivenPreparationIdentity {
    ownerEpoch: string; roomInstanceId: string; sourceLobbyGeneration: number; preparationId: string
}
/** Private owner-to-parent input; credentials never enter a Mate. */
export interface RivenFreezeMember {
    viewerId: number; playerId: number; connectionId: string; partyId: number
    session?: string | null; admissionToken?: string | null; mate: any
}
/** Owner-requested whole-room downgrade after a P2 client NACKs an enabled prepare (2026-10-27). */
export const RIVEN_FORCED_DISABLED_REASONS = ["catalog_mismatch"] as const
export type RivenForcedDisabledReason = typeof RIVEN_FORCED_DISABLED_REASONS[number]
export interface RivenFreezeRequest {
    identity: RivenPreparationIdentity; category: number; questId: number; members: RivenFreezeMember[]
    disabledReason?: RivenForcedDisabledReason
}
export interface RivenSnapshot {
    identity: RivenPreparationIdentity; snapshotId: string; members: any[]; canonical: string; sha256: string
    mode: 0 | 1; catalog: string; reason: string; rulesDigest: string; ackConnectionIds: string[]
    conversionLoadouts: Array<{ playerId: number; loadout: WeaponRivenBattleLoadout }>
    audit: Array<{ playerId: number; slot: number; itemId: number; rivenId: number; revision: number; weaponId: number }>
}
export interface RivenSnapshotReference {
    identity: RivenPreparationIdentity; snapshotId: string; battleSessionId?: string
}
export interface RivenResourceCatalog {
    id: string; soulKeys: ReadonlySet<number>; weaponIds: ReadonlySet<number>; resourceDigest: string
}
