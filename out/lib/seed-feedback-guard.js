"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeedFeedbackGuard = void 0;
const gacha_physics_1 = require("./gacha-physics");
/** Public feedback evidence and budgets. No client-controlled movie/source creates an unbounded collection. */
class SeedFeedbackGuard {
    constructor(options = {}, forget = () => { }) {
        var _a;
        this.forget = forget;
        this.recent = new Map();
        this.sources = new Map();
        this.requests = 0;
        this.newSeeds = 0;
        this.now = (_a = options.now) !== null && _a !== void 0 ? _a : Date.now;
        const positive = (value, fallback) => value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
        this.sentTtlMs = positive(options.sentTtlMs, 15 * 60000);
        this.maxRecentSent = positive(options.maxRecentSent, 4096);
        this.windowMs = positive(options.windowMs, 60000);
        this.maxRequestsPerSource = positive(options.maxRequestsPerSource, 120);
        this.maxRequestsGlobal = positive(options.maxRequestsGlobal, 1200);
        this.maxSources = positive(options.maxSources, 1024);
        this.maxNewSeeds = positive(options.maxNewSeeds, 100000);
        this.windowStarted = this.now();
    }
    validIdentity(movieId, seed) {
        return typeof movieId === 'string' && Object.prototype.hasOwnProperty.call(gacha_physics_1.MOVIE_CONFIGS, movieId)
            && typeof seed === 'number' && Number.isSafeInteger(seed) && seed >= 0;
    }
    prune() {
        const now = this.now();
        for (const [key, sent] of this.recent) {
            if (sent.expiresAt > now)
                continue;
            this.recent.delete(key);
            this.forget(sent.movieId, sent.seed);
        }
    }
    pruneSent() { this.prune(); }
    markSent(movieId, seed, rarity) {
        if (!this.validIdentity(movieId, seed))
            return false;
        this.prune();
        const key = `${movieId}:${seed}`;
        // Reissuing a seed refreshes evidence for the new draw.
        this.recent.delete(key);
        while (this.recent.size >= this.maxRecentSent) {
            const [oldKey, old] = this.recent.entries().next().value;
            this.recent.delete(oldKey);
            this.forget(old.movieId, old.seed);
        }
        this.recent.set(key, { movieId, seed,
            rarity: Number.isSafeInteger(rarity) && rarity >= 3 && rarity <= 5 ? rarity : null,
            expiresAt: this.now() + this.sentTtlMs, seen: new Set() });
        return true;
    }
    /** Call once per public request, before parsing debug bodies/loc. Saturation rejects new sources rather than evicting a budget. */
    allowRequest(source) {
        const now = this.now();
        if (now < this.windowStarted || now - this.windowStarted >= this.windowMs) {
            this.windowStarted = now;
            this.requests = 0;
            this.sources.clear();
        }
        if (typeof source !== 'string' || source.length === 0 || source.length > 128)
            return false;
        if (this.requests >= this.maxRequestsGlobal)
            return false;
        this.requests += 1;
        const count = this.sources.get(source);
        if (count === undefined && this.sources.size >= this.maxSources)
            return false;
        if ((count !== null && count !== void 0 ? count : 0) >= this.maxRequestsPerSource)
            return false;
        this.sources.set(source, (count !== null && count !== void 0 ? count : 0) + 1);
        return true;
    }
    check(feedback) {
        if (!this.validIdentity(feedback.movieId, feedback.seed))
            return null;
        if (!['play', 'c3032', 'crash'].includes(feedback.kind))
            return null;
        if (feedback.didPlay !== undefined && feedback.didPlay !== null && typeof feedback.didPlay !== 'boolean')
            return null;
        if (feedback.kind === 'play' && typeof feedback.didPlay !== 'boolean')
            return null;
        if (feedback.kind !== 'play' && (!Number.isSafeInteger(feedback.rarity) || feedback.rarity < 3 || feedback.rarity > 5))
            return null;
        this.prune();
        const sent = this.recent.get(`${feedback.movieId}:${feedback.seed}`);
        if (!sent || feedback.kind === 'play' && sent.rarity === null)
            return null;
        const play = feedback.didPlay === true ? '1' : feedback.didPlay === false ? '0' : '?';
        const signature = feedback.kind === 'play' ? `play:${play}`
            : feedback.kind === 'crash' ? `crash:${feedback.rarity}` : `c3032:${feedback.rarity}:${play}`;
        return { sent, signature };
    }
    canAddSeed() { return this.newSeeds < this.maxNewSeeds; }
    addedSeed() { this.newSeeds += 1; }
    stats() {
        this.prune();
        return { recentSent: this.recent.size, sources: this.sources.size,
            requests: this.requests, newSeeds: this.newSeeds,
            maxRecentSent: this.maxRecentSent, maxSources: this.maxSources, maxNewSeeds: this.maxNewSeeds };
    }
}
exports.SeedFeedbackGuard = SeedFeedbackGuard;
