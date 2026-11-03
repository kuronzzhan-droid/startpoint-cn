"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.persistenceWriteGate = exports.createPersistenceWriteGate = void 0;
const persistence_admission_1 = require("./persistence-admission");
/** Admission bounds the waiters; this gate orders native writes across threads. */
function createPersistenceWriteGate() {
    let readers = 0, exclusive = false;
    const waiting = [];
    function pump() {
        if (exclusive)
            return;
        while (waiting.length > 0) {
            const next = waiting[0];
            if (next.exclusive && readers > 0)
                return;
            waiting.shift();
            if (next.exclusive)
                exclusive = true;
            else
                readers++;
            let released = false;
            next.resolve(() => {
                if (released)
                    return;
                released = true;
                if (next.exclusive)
                    exclusive = false;
                else
                    readers--;
                pump();
            });
            if (exclusive)
                return;
        }
    }
    return {
        acquire(exclusive) {
            return new Promise(resolve => { waiting.push({ exclusive, resolve }); pump(); });
        },
        assertSynchronousWriteAllowed() {
            if (exclusive)
                throw new persistence_admission_1.PersistenceMaintenanceBusyError();
        },
        stats: () => ({ activeWrites: readers, exclusive, waiting: waiting.length }),
    };
}
exports.createPersistenceWriteGate = createPersistenceWriteGate;
exports.persistenceWriteGate = createPersistenceWriteGate();
