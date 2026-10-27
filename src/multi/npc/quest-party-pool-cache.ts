import { stripWeaponRivenPublicPayload } from "../../lib/weapon-riven/public-payload"
import type { QuestNpcPartySnapshot } from "./quest-party-pool-shared"

/** Atomic full refresh plus ordered deltas from the one current worker. */
export class QuestPartyPoolCache {
    pools = new Map<string, QuestNpcPartySnapshot[]>()
    private staging: Map<string, QuestNpcPartySnapshot[]> | null = null
    private revision = 0
    private valid = false

    apply(message: any): "applied" | "ignored" | "reload" {
        if (message.type === "snapshot_begin") {
            this.staging = new Map()
            this.revision = message.revision
            this.valid = true
            return "applied"
        }
        if (!["quest_snapshot", "quest_delta", "snapshot_end"].includes(message.type)) return "ignored"
        if (!this.valid) return "ignored"
        if (message.revision <= this.revision) return "ignored"
        if (message.revision !== this.revision + 1) {
            this.valid = false; this.staging = null
            return "reload"
        }
        this.revision = message.revision
        if (message.type === "snapshot_end") {
            if (!this.staging) { this.valid = false; return "reload" }
            this.pools = this.staging; this.staging = null
            return "applied"
        }
        const target = this.staging ?? this.pools
        if (message.type === "quest_snapshot") {
            if (message.entries.length) target.set(message.key, stripWeaponRivenPublicPayload(message.entries))
            else target.delete(message.key)
            return "applied"
        }
        const removed = new Set<number>(message.removedPlayerIds)
        const entries = (target.get(message.key) ?? []).filter(entry => !removed.has(entry.sourcePlayerId))
        if (message.entry && !removed.has(message.entry.sourcePlayerId)) {
            const index = entries.findIndex(entry => entry.sourcePlayerId === message.entry.sourcePlayerId)
            if (index === -1) entries.push(stripWeaponRivenPublicPayload(message.entry))
            else entries[index] = stripWeaponRivenPublicPayload(message.entry)
        }
        if (entries.length) target.set(message.key, entries)
        else target.delete(message.key)
        return "applied"
    }
    resetWorker(): void { this.staging = null; this.valid = false; this.revision = 0 }
    stats() {
        let entries = 0
        for (const pool of this.pools.values()) entries += pool.length
        return { pools: this.pools.size, entries, revision: this.revision,
            synchronizing: this.staging !== null, valid: this.valid }
    }
}
