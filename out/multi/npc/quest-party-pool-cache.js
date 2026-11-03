"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuestPartyPoolCache = void 0;
const public_payload_1 = require("../../lib/weapon-riven/public-payload");
/** Atomic full refresh plus ordered deltas from the one current worker. */
class QuestPartyPoolCache {
    constructor() {
        this.pools = new Map();
        this.staging = null;
        this.revision = 0;
        this.valid = false;
    }
    apply(message) {
        var _a, _b;
        if (message.type === "snapshot_begin") {
            this.staging = new Map();
            this.revision = message.revision;
            this.valid = true;
            return "applied";
        }
        if (!["quest_snapshot", "quest_delta", "snapshot_end"].includes(message.type))
            return "ignored";
        if (!this.valid)
            return "ignored";
        if (message.revision <= this.revision)
            return "ignored";
        if (message.revision !== this.revision + 1) {
            this.valid = false;
            this.staging = null;
            return "reload";
        }
        this.revision = message.revision;
        if (message.type === "snapshot_end") {
            if (!this.staging) {
                this.valid = false;
                return "reload";
            }
            this.pools = this.staging;
            this.staging = null;
            return "applied";
        }
        const target = (_a = this.staging) !== null && _a !== void 0 ? _a : this.pools;
        if (message.type === "quest_snapshot") {
            if (message.entries.length)
                target.set(message.key, (0, public_payload_1.stripWeaponRivenPublicPayload)(message.entries));
            else
                target.delete(message.key);
            return "applied";
        }
        const removed = new Set(message.removedPlayerIds);
        const entries = ((_b = target.get(message.key)) !== null && _b !== void 0 ? _b : []).filter(entry => !removed.has(entry.sourcePlayerId));
        if (message.entry && !removed.has(message.entry.sourcePlayerId)) {
            const index = entries.findIndex(entry => entry.sourcePlayerId === message.entry.sourcePlayerId);
            if (index === -1)
                entries.push((0, public_payload_1.stripWeaponRivenPublicPayload)(message.entry));
            else
                entries[index] = (0, public_payload_1.stripWeaponRivenPublicPayload)(message.entry);
        }
        if (entries.length)
            target.set(message.key, entries);
        else
            target.delete(message.key);
        return "applied";
    }
    resetWorker() { this.staging = null; this.valid = false; this.revision = 0; }
    stats() {
        let entries = 0;
        for (const pool of this.pools.values())
            entries += pool.length;
        return { pools: this.pools.size, entries, revision: this.revision,
            synchronizing: this.staging !== null, valid: this.valid };
    }
}
exports.QuestPartyPoolCache = QuestPartyPoolCache;
