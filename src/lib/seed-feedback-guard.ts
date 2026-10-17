import { MOVIE_CONFIGS } from "./gacha-physics";

export interface PublicSeedFeedback {
    kind: 'play' | 'c3032' | 'crash';
    movieId: string;
    seed: number;
    /** Client-observed star rarity, not the internal zero-based index. */
    rarity?: number;
    didPlay?: boolean | null;
}

export interface SeedFeedbackGuardOptions {
    now?: () => number;
    sentTtlMs?: number;
    maxRecentSent?: number;
    windowMs?: number;
    maxRequestsPerSource?: number;
    maxRequestsGlobal?: number;
    maxSources?: number;
    maxNewSeeds?: number;
    maxPersistedSeeds?: number;
}

interface RecentSent {
    movieId: string;
    seed: number;
    rarity: number | null;
    expiresAt: number;
    // At most 2 PLAY + 9 C3032 + 3 crash variants, independent of input size.
    seen: Set<string>;
}

/** Public feedback evidence and budgets. No client-controlled movie/source creates an unbounded collection. */
export class SeedFeedbackGuard {
    private recent = new Map<string, RecentSent>();
    private sources = new Map<string, number>();
    private windowStarted: number;
    private requests = 0;
    private newSeeds = 0;
    private readonly now: () => number;
    private readonly sentTtlMs: number;
    private readonly maxRecentSent: number;
    private readonly windowMs: number;
    private readonly maxRequestsPerSource: number;
    private readonly maxRequestsGlobal: number;
    private readonly maxSources: number;
    private readonly maxNewSeeds: number;

    constructor(options: SeedFeedbackGuardOptions = {}, private forget: (movieId: string, seed: number) => void = () => {}) {
        this.now = options.now ?? Date.now;
        const positive = (value: number | undefined, fallback: number) =>
            value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
        this.sentTtlMs = positive(options.sentTtlMs, 15 * 60_000);
        this.maxRecentSent = positive(options.maxRecentSent, 4096);
        this.windowMs = positive(options.windowMs, 60_000);
        this.maxRequestsPerSource = positive(options.maxRequestsPerSource, 120);
        this.maxRequestsGlobal = positive(options.maxRequestsGlobal, 1200);
        this.maxSources = positive(options.maxSources, 1024);
        this.maxNewSeeds = positive(options.maxNewSeeds, 100_000);
        this.windowStarted = this.now();
    }

    private validIdentity(movieId: unknown, seed: unknown): boolean {
        return typeof movieId === 'string' && Object.prototype.hasOwnProperty.call(MOVIE_CONFIGS, movieId)
            && typeof seed === 'number' && Number.isSafeInteger(seed) && seed >= 0;
    }

    private prune(): void {
        const now = this.now();
        for (const [key, sent] of this.recent) {
            if (sent.expiresAt > now) continue;
            this.recent.delete(key);
            this.forget(sent.movieId, sent.seed);
        }
    }

    pruneSent(): void { this.prune(); }

    markSent(movieId: string, seed: number, rarity?: number): boolean {
        if (!this.validIdentity(movieId, seed)) return false;
        this.prune();
        const key = `${movieId}:${seed}`;
        // Reissuing a seed refreshes evidence for the new draw.
        this.recent.delete(key);
        while (this.recent.size >= this.maxRecentSent) {
            const [oldKey, old] = this.recent.entries().next().value!;
            this.recent.delete(oldKey);
            this.forget(old.movieId, old.seed);
        }
        this.recent.set(key, { movieId, seed,
            rarity: Number.isSafeInteger(rarity) && rarity! >= 3 && rarity! <= 5 ? rarity! : null,
            expiresAt: this.now() + this.sentTtlMs, seen: new Set() });
        return true;
    }

    /** Call once per public request, before parsing debug bodies/loc. Saturation rejects new sources rather than evicting a budget. */
    allowRequest(source: string): boolean {
        const now = this.now();
        if (now < this.windowStarted || now - this.windowStarted >= this.windowMs) {
            this.windowStarted = now;
            this.requests = 0;
            this.sources.clear();
        }
        if (typeof source !== 'string' || source.length === 0 || source.length > 128) return false;
        if (this.requests >= this.maxRequestsGlobal) return false;
        this.requests += 1;
        const count = this.sources.get(source);
        if (count === undefined && this.sources.size >= this.maxSources) return false;
        if ((count ?? 0) >= this.maxRequestsPerSource) return false;
        this.sources.set(source, (count ?? 0) + 1);
        return true;
    }

    check(feedback: PublicSeedFeedback): { sent: RecentSent; signature: string } | null {
        if (!this.validIdentity(feedback.movieId, feedback.seed)) return null;
        if (!['play', 'c3032', 'crash'].includes(feedback.kind)) return null;
        if (feedback.didPlay !== undefined && feedback.didPlay !== null && typeof feedback.didPlay !== 'boolean') return null;
        if (feedback.kind === 'play' && typeof feedback.didPlay !== 'boolean') return null;
        if (feedback.kind !== 'play' && (!Number.isSafeInteger(feedback.rarity) || feedback.rarity! < 3 || feedback.rarity! > 5)) return null;
        this.prune();
        const sent = this.recent.get(`${feedback.movieId}:${feedback.seed}`);
        if (!sent || feedback.kind === 'play' && sent.rarity === null) return null;
        const play = feedback.didPlay === true ? '1' : feedback.didPlay === false ? '0' : '?';
        const signature = feedback.kind === 'play' ? `play:${play}`
            : feedback.kind === 'crash' ? `crash:${feedback.rarity}` : `c3032:${feedback.rarity}:${play}`;
        return { sent, signature };
    }

    canAddSeed(): boolean { return this.newSeeds < this.maxNewSeeds; }
    addedSeed(): void { this.newSeeds += 1; }

    stats() {
        this.prune();
        return { recentSent: this.recent.size, sources: this.sources.size,
            requests: this.requests, newSeeds: this.newSeeds,
            maxRecentSent: this.maxRecentSent, maxSources: this.maxSources, maxNewSeeds: this.maxNewSeeds };
    }
}
