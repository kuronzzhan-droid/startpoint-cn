"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fiveBossDiagnostics = exports.CoalescedDiagnostics = void 0;
/** First evidence is lazy; retries must not repeat database reads or formatting. */
class CoalescedDiagnostics {
    constructor(prefix, intervalMs = 60000, maxKeys = 128, write = message => console.warn(message)) {
        this.prefix = prefix;
        this.intervalMs = intervalMs;
        this.maxKeys = maxKeys;
        this.write = write;
        this.counts = new Map();
        this.overflow = 0;
    }
    emit(message) {
        try {
            this.write(message);
        }
        catch ( /* A failed log sink cannot fail gameplay. */_a) { /* A failed log sink cannot fail gameplay. */ }
    }
    report(key, details) {
        // Bound retained identities even when a malformed request supplies a
        // very long play id. Valid play ids are at most 255 characters.
        key = key.slice(0, 1024);
        const count = this.counts.get(key);
        if (count) {
            count.suppressed += 1;
            return;
        }
        if (!this.timer) {
            this.timer = setTimeout(() => this.flush(), this.intervalMs);
            this.timer.unref();
        }
        if (this.counts.size >= this.maxKeys) {
            this.overflow += 1;
            return;
        }
        this.counts.set(key, { suppressed: 0 });
        try {
            this.emit(details());
        }
        catch (_a) {
            // Diagnostics must not replace the original gameplay error when
            // fetching its database context also fails.
            this.emit(`${this.prefix} ${JSON.stringify({ key, contextUnavailable: true })}`);
        }
    }
    flush() {
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = undefined;
        const repeats = [...this.counts]
            .filter(([, count]) => count.suppressed > 0)
            .map(([key, count]) => ({ key, suppressed: count.suppressed }));
        this.counts.clear();
        const overflow = this.overflow;
        this.overflow = 0;
        if (repeats.length || overflow) {
            this.emit(`${this.prefix} ${JSON.stringify({ intervalMs: this.intervalMs, repeats, overflow })}`);
        }
    }
}
exports.CoalescedDiagnostics = CoalescedDiagnostics;
exports.fiveBossDiagnostics = new CoalescedDiagnostics("[FIVE-BOSS-REPEAT]");
