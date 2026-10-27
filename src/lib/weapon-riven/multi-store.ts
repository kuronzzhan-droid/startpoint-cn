import { cloneRivenJson, rivenIdentityKey, rivenInternalIdentity } from "./multi-protocol"
import type { RivenPreparationIdentity, RivenSnapshot, RivenSnapshotReference } from "./multi-types"

interface Entry {
    identity: RivenPreparationIdentity; fingerprint: string; expiresAt: number
    promise: Promise<RivenSnapshot>; snapshot?: RivenSnapshot; battleSessionId?: string
    validate?: (snapshot: RivenSnapshot) => void
}
function freeze<T>(value: T): T {
    if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value) }
    return value
}
/** Parent memory only. Preparing TTL never evicts a committed battle. */
export class RivenSnapshotStore {
    private entries = new Map<string, Entry>()
    private tombstones = new Map<string, number>()
    private deadEpochs = new Map<string, number>()
    private battles = new Map<string, string>()
    constructor(private now = Date.now, private capacity = 1024, private ttlMs = 10_000,
        private tombstoneMs = 120_000, private tombstoneCapacity = 8192) {}
    private sweep(): void {
        const now = this.now()
        for (const [key, expires] of this.tombstones) if (expires <= now) this.tombstones.delete(key)
        for (const [key, expires] of this.deadEpochs) if (expires <= now) this.deadEpochs.delete(key)
        for (const [key, entry] of this.entries) if (!entry.battleSessionId && entry.expiresAt <= now) this.remove(key, entry)
    }
    private tombstone(key: string): void {
        if (!this.tombstones.has(key) && this.tombstones.size >= this.tombstoneCapacity) throw new Error("RIVEN_TOMBSTONE_CAPACITY")
        this.tombstones.set(key, this.now() + this.tombstoneMs)
    }
    private remove(key: string, entry?: Entry): void {
        this.tombstone(key)
        this.entries.delete(key)
        if (entry?.battleSessionId) this.battles.delete(JSON.stringify([entry.identity.ownerEpoch, entry.battleSessionId]))
    }
    async prepare(identity: RivenPreparationIdentity, fingerprint: string, build: () => Promise<RivenSnapshot>,
        validate?: (snapshot: RivenSnapshot) => void): Promise<RivenSnapshot> {
        this.sweep()
        const key = rivenIdentityKey(identity), old = this.entries.get(key)
        if (this.deadEpochs.has(identity.ownerEpoch) || this.tombstones.has(key)) throw new Error("RIVEN_PREPARATION_RELEASED")
        if (old) {
            if (old.fingerprint !== fingerprint) throw new Error("RIVEN_PREPARATION_CONFLICT")
            return cloneRivenJson(await old.promise)
        }
        if (this.entries.size >= this.capacity || this.tombstones.size >= this.tombstoneCapacity) throw new Error("RIVEN_SNAPSHOT_CAPACITY")
        const entry: Entry = { identity: cloneRivenJson(identity), fingerprint, expiresAt: this.now() + this.ttlMs,
            promise: undefined as unknown as Promise<RivenSnapshot>, validate }
        this.entries.set(key, entry)
        entry.promise = Promise.resolve().then(build).then(snapshot => {
            if (this.entries.get(key) !== entry || this.deadEpochs.has(identity.ownerEpoch)
                || this.now() >= entry.expiresAt) throw new Error("RIVEN_PREPARATION_RELEASED")
            if (rivenIdentityKey(snapshot.identity) !== key) throw new Error("RIVEN_IDENTITY_MISMATCH")
            entry.snapshot = freeze(cloneRivenJson(snapshot))
            return entry.snapshot
        }).catch(error => {
            if (this.entries.get(key) === entry) this.remove(key, entry)
            throw error
        })
        return cloneRivenJson(await entry.promise)
    }
    get(reference: RivenSnapshotReference): RivenSnapshot {
        this.sweep()
        const entry = this.entries.get(rivenIdentityKey(reference.identity))
        if (!entry?.snapshot || entry.snapshot.snapshotId !== reference.snapshotId
            || reference.battleSessionId !== undefined && entry.battleSessionId !== reference.battleSessionId) throw new Error("RIVEN_SNAPSHOT_MISSING")
        return cloneRivenJson(entry.snapshot)
    }
    commit(reference: RivenSnapshotReference): RivenSnapshot {
        const snapshot = this.get(reference.battleSessionId === undefined ? reference : { ...reference, battleSessionId: undefined })
        const battleSessionId = rivenInternalIdentity(reference.battleSessionId), key = rivenIdentityKey(reference.identity)
        const entry = this.entries.get(key)!, battleKey = JSON.stringify([reference.identity.ownerEpoch, battleSessionId])
        if (!entry.battleSessionId) entry.validate?.(snapshot)
        if (entry.battleSessionId && entry.battleSessionId !== battleSessionId
            || this.battles.has(battleKey) && this.battles.get(battleKey) !== key) throw new Error("RIVEN_COMMIT_CONFLICT")
        entry.battleSessionId = battleSessionId; this.battles.set(battleKey, key)
        return snapshot
    }
    validate(reference: RivenSnapshotReference): RivenSnapshot {
        const snapshot = this.get(reference), entry = this.entries.get(rivenIdentityKey(reference.identity))!
        if (!entry.battleSessionId) entry.validate?.(snapshot)
        return snapshot
    }
    cancel(reference: Pick<RivenSnapshotReference, "identity"> & { snapshotId?: string }): boolean {
        this.sweep()
        const key = rivenIdentityKey(reference.identity), entry = this.entries.get(key)
        if (entry?.battleSessionId || reference.snapshotId && entry?.snapshot && entry.snapshot.snapshotId !== reference.snapshotId) return false
        this.remove(key, entry)
        return true
    }
    release(reference: RivenSnapshotReference): boolean {
        this.sweep()
        const key = rivenIdentityKey(reference.identity), entry = this.entries.get(key)
        if (!entry) return this.tombstones.has(key)
        if (entry.snapshot?.snapshotId !== reference.snapshotId || entry.battleSessionId !== reference.battleSessionId) return false
        this.remove(key, entry)
        return true
    }
    releaseOwnerEpoch(ownerEpoch: string): void {
        this.sweep(); rivenInternalIdentity(ownerEpoch)
        if (!this.deadEpochs.has(ownerEpoch) && this.deadEpochs.size >= this.tombstoneCapacity) throw new Error("RIVEN_EPOCH_CAPACITY")
        this.deadEpochs.set(ownerEpoch, this.now() + this.tombstoneMs)
        for (const [key, entry] of this.entries) if (entry.identity.ownerEpoch === ownerEpoch) {
            // The epoch tombstone covers pending callbacks without consuming per-room tombstone slots.
            this.entries.delete(key)
            if (entry.battleSessionId) this.battles.delete(JSON.stringify([ownerEpoch, entry.battleSessionId]))
        }
    }
    stats(): { preparing: number; committed: number; tombstones: number } {
        this.sweep()
        return { preparing: [...this.entries.values()].filter(entry => !entry.battleSessionId).length,
            committed: this.battles.size, tombstones: this.tombstones.size }
    }
}
export const rivenSnapshotStore = new RivenSnapshotStore()
