"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPersistenceAdmissionError = exports.persistenceAdmission = exports.createPersistenceAdmission = exports.PersistenceMaintenanceBusyError = exports.PersistenceQueueFullError = exports.PERSISTENCE_ADMISSION_DEFAULTS = void 0;
/** Bound closures and payloads before they enter any persistence wait chain. */
exports.PERSISTENCE_ADMISSION_DEFAULTS = Object.freeze({ total: 256, perPlayer: 8, withoutPlayer: 32 });
class PersistenceQueueFullError extends Error {
    constructor() {
        super("服务器写入繁忙，请稍后重试。");
        this.code = "PERSISTENCE_QUEUE_FULL";
        this.statusCode = 503;
    }
}
exports.PersistenceQueueFullError = PersistenceQueueFullError;
/** A synchronous caller cannot wait for a background transaction. No SQL ran. */
class PersistenceMaintenanceBusyError extends Error {
    constructor() {
        super("服务器正在完成后台写入，请稍后重试。");
        this.code = "PERSISTENCE_MAINTENANCE_BUSY";
        this.statusCode = 503;
    }
}
exports.PersistenceMaintenanceBusyError = PersistenceMaintenanceBusyError;
function createPersistenceAdmission(limits = exports.PERSISTENCE_ADMISSION_DEFAULTS) {
    for (const value of Object.values(limits)) {
        if (!Number.isSafeInteger(value) || value < 1)
            throw new Error("Invalid persistence admission limit");
    }
    const players = new Map();
    let total = 0, withoutPlayer = 0, peak = 0, rejected = 0;
    return {
        acquire(playerId) {
            var _a, _b;
            if (total >= limits.total
                || (playerId === undefined ? withoutPlayer >= limits.withoutPlayer
                    : ((_a = players.get(playerId)) !== null && _a !== void 0 ? _a : 0) >= limits.perPlayer)) {
                rejected++;
                throw new PersistenceQueueFullError();
            }
            total++;
            peak = Math.max(peak, total);
            if (playerId === undefined)
                withoutPlayer++;
            else
                players.set(playerId, ((_b = players.get(playerId)) !== null && _b !== void 0 ? _b : 0) + 1);
            let released = false;
            return () => {
                if (released)
                    return;
                released = true;
                total--;
                if (playerId === undefined)
                    withoutPlayer--;
                else {
                    const remaining = players.get(playerId) - 1;
                    if (remaining === 0)
                        players.delete(playerId);
                    else
                        players.set(playerId, remaining);
                }
            };
        },
        stats: () => ({ total, withoutPlayer, players: players.size, peak, rejected }),
    };
}
exports.createPersistenceAdmission = createPersistenceAdmission;
exports.persistenceAdmission = createPersistenceAdmission();
/** Only these failures guarantee the rejected command never started. */
function isPersistenceAdmissionError(error) {
    if (!(error instanceof Error))
        return false;
    const code = error.code;
    return code === "PERSISTENCE_QUEUE_FULL" || code === "SQLITE_WRITER_QUEUE_FULL"
        || code === "PERSISTENCE_MAINTENANCE_BUSY" || code === "SERVER_CLOSING";
}
exports.isPersistenceAdmissionError = isPersistenceAdmissionError;
