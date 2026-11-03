"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rivenSnapshotStore = exports.RivenSnapshotStore = void 0;
const multi_protocol_1 = require("./multi-protocol");
function freeze(value) {
    if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}
/** Parent memory only. Preparing TTL never evicts a committed battle. */
class RivenSnapshotStore {
    constructor(now = Date.now, capacity = 1024, ttlMs = 10000, tombstoneMs = 120000, tombstoneCapacity = 8192) {
        this.now = now;
        this.capacity = capacity;
        this.ttlMs = ttlMs;
        this.tombstoneMs = tombstoneMs;
        this.tombstoneCapacity = tombstoneCapacity;
        this.entries = new Map();
        this.tombstones = new Map();
        this.deadEpochs = new Map();
        this.battles = new Map();
    }
    sweep() {
        const now = this.now();
        for (const [key, expires] of this.tombstones)
            if (expires <= now)
                this.tombstones.delete(key);
        for (const [key, expires] of this.deadEpochs)
            if (expires <= now)
                this.deadEpochs.delete(key);
        for (const [key, entry] of this.entries)
            if (!entry.battleSessionId && entry.expiresAt <= now)
                this.remove(key, entry);
    }
    tombstone(key) {
        if (!this.tombstones.has(key) && this.tombstones.size >= this.tombstoneCapacity)
            throw new Error("RIVEN_TOMBSTONE_CAPACITY");
        this.tombstones.set(key, this.now() + this.tombstoneMs);
    }
    remove(key, entry) {
        this.tombstone(key);
        this.entries.delete(key);
        if (entry === null || entry === void 0 ? void 0 : entry.battleSessionId)
            this.battles.delete(JSON.stringify([entry.identity.ownerEpoch, entry.battleSessionId]));
    }
    prepare(identity, fingerprint, build, validate) {
        return __awaiter(this, void 0, void 0, function* () {
            this.sweep();
            const key = (0, multi_protocol_1.rivenIdentityKey)(identity), old = this.entries.get(key);
            if (this.deadEpochs.has(identity.ownerEpoch) || this.tombstones.has(key))
                throw new Error("RIVEN_PREPARATION_RELEASED");
            if (old) {
                if (old.fingerprint !== fingerprint)
                    throw new Error("RIVEN_PREPARATION_CONFLICT");
                return (0, multi_protocol_1.cloneRivenJson)(yield old.promise);
            }
            if (this.entries.size >= this.capacity || this.tombstones.size >= this.tombstoneCapacity)
                throw new Error("RIVEN_SNAPSHOT_CAPACITY");
            const entry = { identity: (0, multi_protocol_1.cloneRivenJson)(identity), fingerprint, expiresAt: this.now() + this.ttlMs,
                promise: undefined, validate };
            this.entries.set(key, entry);
            entry.promise = Promise.resolve().then(build).then(snapshot => {
                if (this.entries.get(key) !== entry || this.deadEpochs.has(identity.ownerEpoch)
                    || this.now() >= entry.expiresAt)
                    throw new Error("RIVEN_PREPARATION_RELEASED");
                if ((0, multi_protocol_1.rivenIdentityKey)(snapshot.identity) !== key)
                    throw new Error("RIVEN_IDENTITY_MISMATCH");
                entry.snapshot = freeze((0, multi_protocol_1.cloneRivenJson)(snapshot));
                return entry.snapshot;
            }).catch(error => {
                if (this.entries.get(key) === entry)
                    this.remove(key, entry);
                throw error;
            });
            return (0, multi_protocol_1.cloneRivenJson)(yield entry.promise);
        });
    }
    get(reference) {
        this.sweep();
        const entry = this.entries.get((0, multi_protocol_1.rivenIdentityKey)(reference.identity));
        if (!(entry === null || entry === void 0 ? void 0 : entry.snapshot) || entry.snapshot.snapshotId !== reference.snapshotId
            || reference.battleSessionId !== undefined && entry.battleSessionId !== reference.battleSessionId)
            throw new Error("RIVEN_SNAPSHOT_MISSING");
        return (0, multi_protocol_1.cloneRivenJson)(entry.snapshot);
    }
    commit(reference) {
        var _a;
        const snapshot = this.get(reference.battleSessionId === undefined ? reference : Object.assign(Object.assign({}, reference), { battleSessionId: undefined }));
        const battleSessionId = (0, multi_protocol_1.rivenInternalIdentity)(reference.battleSessionId), key = (0, multi_protocol_1.rivenIdentityKey)(reference.identity);
        const entry = this.entries.get(key), battleKey = JSON.stringify([reference.identity.ownerEpoch, battleSessionId]);
        if (!entry.battleSessionId)
            (_a = entry.validate) === null || _a === void 0 ? void 0 : _a.call(entry, snapshot);
        if (entry.battleSessionId && entry.battleSessionId !== battleSessionId
            || this.battles.has(battleKey) && this.battles.get(battleKey) !== key)
            throw new Error("RIVEN_COMMIT_CONFLICT");
        entry.battleSessionId = battleSessionId;
        this.battles.set(battleKey, key);
        return snapshot;
    }
    validate(reference) {
        var _a;
        const snapshot = this.get(reference), entry = this.entries.get((0, multi_protocol_1.rivenIdentityKey)(reference.identity));
        if (!entry.battleSessionId)
            (_a = entry.validate) === null || _a === void 0 ? void 0 : _a.call(entry, snapshot);
        return snapshot;
    }
    cancel(reference) {
        this.sweep();
        const key = (0, multi_protocol_1.rivenIdentityKey)(reference.identity), entry = this.entries.get(key);
        if ((entry === null || entry === void 0 ? void 0 : entry.battleSessionId) || reference.snapshotId && (entry === null || entry === void 0 ? void 0 : entry.snapshot) && entry.snapshot.snapshotId !== reference.snapshotId)
            return false;
        this.remove(key, entry);
        return true;
    }
    release(reference) {
        var _a;
        this.sweep();
        const key = (0, multi_protocol_1.rivenIdentityKey)(reference.identity), entry = this.entries.get(key);
        if (!entry)
            return this.tombstones.has(key);
        if (((_a = entry.snapshot) === null || _a === void 0 ? void 0 : _a.snapshotId) !== reference.snapshotId || entry.battleSessionId !== reference.battleSessionId)
            return false;
        this.remove(key, entry);
        return true;
    }
    releaseOwnerEpoch(ownerEpoch) {
        this.sweep();
        (0, multi_protocol_1.rivenInternalIdentity)(ownerEpoch);
        if (!this.deadEpochs.has(ownerEpoch) && this.deadEpochs.size >= this.tombstoneCapacity)
            throw new Error("RIVEN_EPOCH_CAPACITY");
        this.deadEpochs.set(ownerEpoch, this.now() + this.tombstoneMs);
        for (const [key, entry] of this.entries)
            if (entry.identity.ownerEpoch === ownerEpoch) {
                // The epoch tombstone covers pending callbacks without consuming per-room tombstone slots.
                this.entries.delete(key);
                if (entry.battleSessionId)
                    this.battles.delete(JSON.stringify([ownerEpoch, entry.battleSessionId]));
            }
    }
    stats() {
        this.sweep();
        return { preparing: [...this.entries.values()].filter(entry => !entry.battleSessionId).length,
            committed: this.battles.size, tombstones: this.tombstones.size };
    }
}
exports.RivenSnapshotStore = RivenSnapshotStore;
exports.rivenSnapshotStore = new RivenSnapshotStore();
