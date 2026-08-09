/**
 * Seed Validator — 种子验证系统
 *
 * 池:
 *   confirmPool — play=0，rarity 正确
 *   playPool — play=1，rarity 正确
 *   verifiedPool — play=1 + rarity 已验证
 *   pendingPool — /crash 已知 r，待重测
 *
 * 选择优先级:
 *   natural: testSeed > playPool(10%/first) > verifiedPool > confirmPool > playFallback > pending > unknown
 *   play:    testSeed > playPool > playFallback > confirmPool > ...
 *   test:    testSeed > playPool > pendingPool > unknown
 */

import { join } from "path";
import { readJsonWithBackupSync, writeJsonAtomicSync } from "./atomic-json-file";

const ASSETS_DIR = join(__dirname, "..", "..", "assets");
const CONFIRMED_FILE = join(ASSETS_DIR, "confirmed_seeds.json");
const PURIFIED_FILE = join(ASSETS_DIR, "purified_seeds.json");
const VERIFIED_FILE = join(ASSETS_DIR, "verified_seeds.json");
const CONFIG_FILE = join(ASSETS_DIR, "pool_config.json");
const TEST_SEEDS_FILE = join(ASSETS_DIR, "test_seeds.json");
const GACHA_VERBOSE_LOGS = /^(1|true|yes)$/i.test(process.env.GACHA_VERBOSE_LOGS ?? "");

export type PoolMode = 'natural' | 'play' | 'test';
export type SeedTag = '未测试' | '热血躲避球' | '普通躲避球' | '冷血躲避球';

interface PlayEntry { r: number; tag: SeedTag; play?: boolean }

class MoviePool {
    confirmPool: Map<number, number | null> = new Map();
    playPool: Map<number, PlayEntry> = new Map();
    verifiedPool: Map<number, number> = new Map();
    pendingPool: Map<number, number | null> = new Map();
    sentSeeds: Map<number, number | null> = new Map();
    sentPlayFlags: Map<number, boolean> = new Map();
}

// ============================================================================
// SeedValidator
// ============================================================================

export class SeedValidator {
    private pools: Map<string, MoviePool> = new Map();
    private testSeeds: (number | null)[] = [null, null, null];
    private mode: PoolMode = 'natural';
    private selectedMovieId: string = 'fes';
    private poolMembershipCache = new WeakMap<number[], Set<number>>();
    private persistenceBatchDepth = 0;
    private confirmDirty = false;
    private playDirty = false;
    private verifiedDirty = false;

    constructor() { this.load(); }

    private pool(m: string): MoviePool { if (!this.pools.has(m)) this.pools.set(m, new MoviePool()); return this.pools.get(m)!; }

    // ====== 持久化 ======

    private load(): void {
        try {
            const confirmed = readJsonWithBackupSync<Record<string, unknown>>(CONFIRMED_FILE);
            if (confirmed) {
                for (const [mid, seeds] of Object.entries(confirmed)) {
                    if (mid.endsWith("_play")) {
                        continue;
                    } else if (mid.endsWith("_pend")) {
                        const movieId = mid.replace("_pend", "");
                        for (const [seed, rarity] of Object.entries(seeds as Record<string, number | null>)) {
                            this.pool(movieId).pendingPool.set(Number(seed), rarity);
                        }
                    } else {
                        const pool = this.pool(mid);
                        if (Array.isArray(seeds)) {
                            for (const seed of seeds) {
                                if (!pool.playPool.has(Number(seed))) pool.confirmPool.set(Number(seed), null);
                            }
                        } else {
                            for (const [seed, rarity] of Object.entries(seeds as Record<string, number | null>)) {
                                if (!pool.playPool.has(Number(seed))) pool.confirmPool.set(Number(seed), rarity);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error("[SEED] failed to load confirmed seeds", error);
        }

        try {
            const purified = readJsonWithBackupSync<Record<string, unknown>>(PURIFIED_FILE);
            if (purified) {
                for (const [movieId, seeds] of Object.entries(purified)) {
                    if (typeof seeds !== "object" || seeds === null) continue;
                    const pool = this.pool(movieId);
                    for (const [seed, entry] of Object.entries(seeds as Record<string, Partial<PlayEntry>>)) {
                        pool.confirmPool.delete(Number(seed));
                        pool.playPool.set(Number(seed), {
                            r: entry.r ?? 0,
                            tag: entry.tag ?? "未测试",
                            play: true,
                        });
                    }
                }
            }
        } catch (error) {
            console.error("[SEED] failed to load purified seeds", error);
        }

        const testSeeds = readJsonWithBackupSync<unknown>(TEST_SEEDS_FILE);
        if (Array.isArray(testSeeds)) {
            this.testSeeds = [null, null, null];
            for (let index = 0; index < 3; index += 1) {
                if (typeof testSeeds[index] === "number") this.testSeeds[index] = testSeeds[index];
            }
        }

        const config = readJsonWithBackupSync<{ selectedMovieId?: string }>(CONFIG_FILE);
        if (config?.selectedMovieId) this.selectedMovieId = config.selectedMovieId;

        try {
            const verified = readJsonWithBackupSync<Record<string, Record<string, number>>>(VERIFIED_FILE);
            if (verified) {
                for (const [movieId, seeds] of Object.entries(verified)) {
                    const pool = this.pool(movieId);
                    for (const [seed, rarity] of Object.entries(seeds)) {
                        pool.verifiedPool.set(Number(seed), rarity);
                    }
                }
            }
        } catch (error) {
            console.error("[SEED] failed to load verified seeds", error);
        }
        // 去重：验证池是播放池+确认池的超集，移除重复条目
        for (const [, p] of this.pools) {
            for (const seed of p.verifiedPool.keys()) {
                if (p.playPool.has(seed)) p.playPool.delete(seed);
                if (p.confirmPool.has(seed)) p.confirmPool.delete(seed);
            }
        }
        this.mode = 'natural';
        let pl = 0, cf = 0, vf = 0; for (const m of this.pools.values()) { pl += m.playPool.size; cf += m.confirmPool.size; vf += m.verifiedPool.size; }
        console.log(`[SEED] Play:${pl} Confirm:${cf} Verified:${vf} Mode:${this.mode}`);
    }

    private writeConfirm(): void { const o: any = {}; for (const [mid, p] of this.pools) { o[mid] = Object.fromEntries(p.confirmPool); o[mid + "_pend"] = Object.fromEntries(p.pendingPool); } writeJsonAtomicSync(CONFIRMED_FILE, o); }
    private writePlay(): void { const o: any = {}; for (const [mid, p] of this.pools) { o[mid] = {}; for (const [s, e] of p.playPool) o[mid][String(s)] = e; } writeJsonAtomicSync(PURIFIED_FILE, o); }
    private writeVerified(): void { const o: any = {}; for (const [mid, p] of this.pools) { o[mid] = Object.fromEntries(p.verifiedPool); } writeJsonAtomicSync(VERIFIED_FILE, o); }
    private saveConfirm(): void { if (this.persistenceBatchDepth > 0) { this.confirmDirty = true; return; } this.writeConfirm(); }
    private savePlay(): void { if (this.persistenceBatchDepth > 0) { this.playDirty = true; return; } this.writePlay(); }
    private saveVerified(): void { if (this.persistenceBatchDepth > 0) { this.verifiedDirty = true; return; } this.writeVerified(); }
    private saveConfig(): void { writeJsonAtomicSync(CONFIG_FILE, { selectedMovieId: this.selectedMovieId }); }
    private saveTestSeeds(): void { writeJsonAtomicSync(TEST_SEEDS_FILE, this.testSeeds); }

    private flushPersistenceBatch(): void {
        if (this.confirmDirty) {
            this.writeConfirm();
            this.confirmDirty = false;
        }
        if (this.playDirty) {
            this.writePlay();
            this.playDirty = false;
        }
        if (this.verifiedDirty) {
            this.writeVerified();
            this.verifiedDirty = false;
        }
    }

    private withPersistenceBatch(action: () => void): void {
        this.persistenceBatchDepth += 1;
        try {
            action();
        } finally {
            this.persistenceBatchDepth -= 1;
            if (this.persistenceBatchDepth === 0) this.flushPersistenceBatch();
        }
    }

    // ====== 共享工具 ======

    private trace(msg: string): void {
        if (GACHA_VERBOSE_LOGS) console.log(`[SEED] ${msg}`);
    }

    /** _guarantee 池回退到基础池 */
    private basePool(movieId: string): MoviePool | null {
        const baseMovie = movieId.replace('_guarantee', '');
        return baseMovie !== movieId ? this.pool(baseMovie) : null;
    }

    /** 通用 base-pool fallback getter */
    private poolGet<T>(p: MoviePool, base: MoviePool | null, getter: (mp: MoviePool) => T | undefined, fallback?: T): T {
        const v = getter(p);
        if (v === undefined && base) { const bv = getter(base); if (bv !== undefined) return bv; }
        return (v !== undefined ? v : fallback) as T;
    }

    /** 播放池稀有度匹配 */
    private isPlayMatch(s: number, p: MoviePool, ri: number): boolean {
        const e = p.playPool.get(s);
        return !!(e && e.r === ri && e.tag !== '冷血躲避球');
    }

    /** 确认池稀有度匹配（同池，不跨池回退） */
    private isConfirmMatch(ri: number, p: MoviePool, _base: MoviePool | null, s: number): boolean {
        const r = p.confirmPool.get(s);
        const ok = r !== undefined && (r === null || r === ri);
        return ok;
    }

    /** 多池检查（种子在任何已知池中） */
    private inAnyPool(p: MoviePool, s: number, base: MoviePool | null): boolean {
        const has = p.confirmPool.has(s) || p.playPool.has(s) || p.verifiedPool.has(s) || p.pendingPool.has(s);
        if (base) return has || base.confirmPool.has(s) || base.playPool.has(s) || base.verifiedPool.has(s) || base.pendingPool.has(s);
        return has;
    }

    private poolMembership(pool: number[]): Set<number> {
        const cached = this.poolMembershipCache.get(pool);
        if (cached) return cached;
        const membership = new Set(pool);
        this.poolMembershipCache.set(pool, membership);
        return membership;
    }

    private randomMapKey<T>(
        entries: Map<number, T>,
        predicate: (seed: number, value: T) => boolean
    ): number | undefined {
        let selected: number | undefined;
        let matches = 0;
        for (const [seed, value] of entries) {
            if (!predicate(seed, value)) continue;
            matches += 1;
            if (Math.random() < 1 / matches) selected = seed;
        }
        return selected;
    }

    private randomPendingSeed(
        membership: Set<number>,
        p: MoviePool,
        base: MoviePool | null
    ): number | undefined {
        const candidates = new Set<number>();
        for (const seed of p.pendingPool.keys()) {
            if (membership.has(seed) && !p.sentSeeds.has(seed)) candidates.add(seed);
        }
        if (base) {
            for (const seed of base.pendingPool.keys()) {
                if (membership.has(seed) && !p.sentSeeds.has(seed)) candidates.add(seed);
            }
        }
        if (candidates.size === 0) return undefined;
        const target = Math.floor(Math.random() * candidates.size);
        let index = 0;
        for (const seed of candidates) {
            if (index === target) return seed;
            index += 1;
        }
        return undefined;
    }

    private randomUnknownSeed(
        pool: number[],
        p: MoviePool,
        base: MoviePool | null
    ): number | undefined {
        for (let attempt = 0; attempt < 64; attempt += 1) {
            const seed = pool[Math.floor(Math.random() * pool.length)];
            if (seed !== undefined && !p.sentSeeds.has(seed) && !this.inAnyPool(p, seed, base)) {
                return seed;
            }
        }

        let selected: number | undefined;
        let matches = 0;
        for (const seed of pool) {
            if (p.sentSeeds.has(seed) || this.inAnyPool(p, seed, base)) continue;
            matches += 1;
            if (Math.random() < 1 / matches) selected = seed;
        }
        return selected;
    }

    /** 种子被确认/播放后清理 sentSeeds */
    private cleanupPending(seed: number, p: MoviePool): void {
        p.sentSeeds.delete(seed);
        p.sentPlayFlags.delete(seed);
    }

    // ====== 种子状态变更 ======

    confirm(movieId: string, seed: number, r?: number | null): void {
        const p = this.pool(movieId);
        this.cleanupPending(seed, p);
        if (p.playPool.has(seed)) return;
        if (p.confirmPool.has(seed)) {
            if (r !== undefined && r !== null) { p.confirmPool.set(seed, r); this.saveConfirm(); }
            return;
        }
        p.pendingPool.delete(seed);
        p.confirmPool.set(seed, r !== undefined ? r : null);
        if (r !== undefined) this.trace(`confirm seed=${seed} r=${'★'+(r!+3)} confirmPool.size=${p.confirmPool.size}`);
        this.saveConfirm();
    }

    addPlay(movieId: string, seed: number, r: number, didPlay?: boolean | null): void {
        const p = this.pool(movieId);
        this.cleanupPending(seed, p);
        if (didPlay === true) {
            p.confirmPool.delete(seed);
            p.pendingPool.delete(seed);
            p.playPool.set(seed, { r, tag: '未测试', play: true });
            this.trace(`addPlay seed=${seed} r=${'★'+(r+3)} play=true playPool.size=${p.playPool.size}`);
            this.savePlay(); this.saveConfirm();
            this.trace(`PLAY [${movieId}] seed=${seed} ★${r+3} play=1`);
        } else if (didPlay === false) {
            this.confirm(movieId, seed, r);
        } else {
            this.addPending(movieId, seed, r);
        }
    }

    /** 稀有度经 C3032 客户端校验后移入验证池，同时跨池去重 */
    moveToVerified(movieId: string, seed: number, r: number): void {
        const p = this.pool(movieId);
        this.cleanupPending(seed, p);
        p.verifiedPool.set(seed, r);
        p.pendingPool.delete(seed);
        p.confirmPool.delete(seed);
        if (p.playPool.has(seed)) {
            p.playPool.delete(seed);
            this.savePlay();
        }
        // 跨池清理：种子已验证，base/guarantee 池中的确认/播放旧条目不再可靠
        const other = this.basePool(movieId) || (movieId.endsWith('_guarantee') ? null : this.pool(movieId + '_guarantee'));
        if (other) {
            if (other.confirmPool.has(seed)) other.confirmPool.delete(seed);
            if (other.playPool.has(seed)) { other.playPool.delete(seed); this.savePlay(); }
        }
        this.saveVerified();
        if (GACHA_VERBOSE_LOGS) {
            console.log(`[SEED] VERIFY [${movieId}] seed=${seed} ★${r+3} (rarity verified by C3032)`);
        }
    }

    addPending(movieId: string, seed: number, r: number | null): void {
        const p = this.pool(movieId);
        const e = p.playPool.get(seed);
        if (e) { this.cleanupPending(seed, p); e.r = r !== null ? r : e.r; this.savePlay(); return; }
        if (r !== null) { this.confirm(movieId, seed, r); return; }
        this.cleanupPending(seed, p);
        this.saveConfirm();
    }

    markSent(movieId: string, seed: number, rarity?: number): void {
        const p = this.pool(movieId);
        const r = rarity !== undefined ? rarity - 3 : null;
        p.sentSeeds.set(seed, r);
        // 同时阻塞 base pool，防止同一种子在 base/guarantee 池被重复选取
        const base = this.basePool(movieId);
        if (base) base.sentSeeds.set(seed, r);
        this.trace(`SENT [${movieId}] seed=${seed} r=${r !== null ? '★'+(r+3) : 'null'} sentSeeds.size=${p.sentSeeds.size}`);
    }

    getSentR(movieId: string, seed: number): number | null | undefined {
        return this.pool(movieId).sentSeeds.get(seed);
    }

    /** 记录客户端返回的 play=1/0，供 flushAll 使用 */
    recordPlay(movieId: string, seed: number, didPlay: boolean): void {
        this.pool(movieId).sentPlayFlags.set(seed, didPlay);
    }

    /** 清理 sentSeeds：有 play 标记的按标记入池，无标记的入 pendingPool 重测 */
    flushAll(): void {
        const summaries: string[] = [];
        let totalFlushed = 0, totalPlay1 = 0, totalPlay0 = 0, totalUnmarked = 0;
        this.withPersistenceBatch(() => {
            for (const [movieId, p] of this.pools) {
                let flushed = 0, play1 = 0, play0 = 0, unmarked = 0;
                for (const [seed, r] of p.sentSeeds) {
                    const didPlay = p.sentPlayFlags.get(seed);
                    if (didPlay === true) {
                        this.addPlay(movieId, seed, r ?? 0, true);
                        this.moveToVerified(movieId, seed, r ?? 0);
                        play1++;
                    } else if (didPlay === false) {
                        this.confirm(movieId, seed, r);
                        play0++;
                    } else {
                        // 完全丢失：pendingPool 下次重测
                        this.addPending(movieId, seed, r);
                        unmarked++;
                    }
                    flushed++;
                }
                if (flushed > 0) {
                    summaries.push(`${movieId}:${flushed}`);
                    totalFlushed += flushed;
                    totalPlay1 += play1;
                    totalPlay0 += play0;
                    totalUnmarked += unmarked;
                }
            }
        });
        if (GACHA_VERBOSE_LOGS && totalFlushed > 0) {
            console.log(
                `[SEED] flushAll pools=${summaries.join(",")} total=${totalFlushed}`
                + ` play=1:${totalPlay1} play=0:${totalPlay0} unmarked:${totalUnmarked}`
                + " persistence=batched"
            );
        }
    }

    // Tag / testSeed / mode — unchanged
    setTag(movieId: string, seed: number, tag: SeedTag): boolean {
        const e = this.pool(movieId).playPool.get(seed); if (!e) return false;
        e.tag = tag; if (tag === '冷血躲避球') this.clearTestSeed(e.r); this.savePlay(); return true;
    }
    setTestSeed(_movieId: string, rarity: 3 | 4 | 5, seed: number): boolean {
        const r = rarity - 3; this.testSeeds[r] = seed; this.saveTestSeeds(); return true;
    }
    clearTestSeed(rarity: number): boolean {
        const r = rarity - 3; if (this.testSeeds[r] === null) return false; this.testSeeds[r] = null; this.saveTestSeeds(); return true;
    }
    getMode(): PoolMode { return this.mode; } getSelectedMovieId(): string { return this.selectedMovieId; }
    setMode(m: PoolMode): void { this.mode = m; } setSelectedMovieId(id: string): void { this.selectedMovieId = id; this.saveConfig(); }
    getMovieIds(): string[] { return Array.from(this.pools.keys()); }

    // ====== 种子选取 ======

    getSeed(movieId: string, rarity: number, pool: number[], characterId: number, drawIndex?: number): number {
        const ri = rarity - 3;
        if (this.testSeeds[ri] !== null) {
            this.trace(`getSeed mode=${this.mode} ★${rarity} ${movieId} di=${drawIndex} → testSeed=${this.testSeeds[ri]}`);
            return this.testSeeds[ri]!;
        }

        const p = this.pool(movieId);
        const base = this.basePool(movieId);
        const membership = this.poolMembership(pool);

        if (this.mode === 'play') {
            const pur = this.randomMapKey(p.playPool, (seed, entry) =>
                !p.sentSeeds.has(seed)
                && entry.r === ri
                && entry.tag !== '冷血躲避球'
            );
            if (pur !== undefined) return pur;
        }

        if (this.mode === 'test') {
            const pur = this.randomMapKey(p.playPool, (seed, entry) =>
                !p.sentSeeds.has(seed)
                && entry.r === ri
                && entry.tag !== '冷血躲避球'
                && !p.verifiedPool.has(seed)
                && !(base?.verifiedPool.has(seed) ?? false)
            );
            if (pur !== undefined) return pur;

            const pending = this.randomPendingSeed(membership, p, base);
            if (pending !== undefined) return pending;

            const unknown = this.randomUnknownSeed(pool, p, base);
            if (unknown !== undefined) {
                this.trace(`getSeed mode=${this.mode} ★${rarity} ${movieId} → unknown=${unknown}`);
                return unknown;
            }

            const fallback = characterId * 1000;
            this.trace(`getSeed mode=${this.mode} ★${rarity} ${movieId} → fallback=${fallback}`);
            return fallback;
        }

        if (this.mode === 'natural') {
            const verified = () => this.randomMapKey(p.verifiedPool, (seed, value) =>
                membership.has(seed)
                && !p.sentSeeds.has(seed)
                && value === ri
            );

            const isFirst = drawIndex !== undefined && drawIndex === 0;
            if (isFirst) {
                const seed = verified();
                if (seed !== undefined) {
                    this.trace(`getSeed ★${rarity} ri=${ri} → natural:verified=★${p.verifiedPool.get(seed)! + 3}`);
                    return seed;
                }
            }

            const seed = verified();
            if (seed !== undefined && Math.random() < 0.10) {
                this.trace(`getSeed ★${rarity} ri=${ri} → natural:verified=★${p.verifiedPool.get(seed)! + 3}`);
                return seed;
            }
        }

        const confirmed = this.randomMapKey(p.confirmPool, (seed, value) =>
            membership.has(seed)
            && !p.sentSeeds.has(seed)
            && (value === null || value === ri)
        );
        if (confirmed !== undefined) {
            const confirmedRarity = p.confirmPool.get(confirmed);
            this.trace(
                `getSeed ★${rarity} ri=${ri} mode=${this.mode} → confirm=${confirmed} `
                + `r=${confirmedRarity !== undefined && confirmedRarity !== null ? '★' + (confirmedRarity + 3) : 'null'}`
            );
            return confirmed;
        }

        const pending = this.randomPendingSeed(membership, p, base);
        if (pending !== undefined) {
            this.trace(`getSeed ★${rarity} → pending=${pending}`);
            return pending;
        }

        const unknown = this.randomUnknownSeed(pool, p, base);
        if (unknown !== undefined) {
            this.trace(`getSeed ★${rarity} mode=${this.mode} → unknown=${unknown}`);
            return unknown;
        }

        const fallback = characterId * 1000;
        this.trace(`getSeed ★${rarity} mode=${this.mode} → fallback=${fallback} charId=${characterId}`);
        return fallback;
    }

    getPlayForRarity(movieId: string, rarity: number): number[] {
        const ri = rarity - 3;
        return Array.from(this.pool(movieId).playPool.entries())
            .filter(([, e]) => e.r === ri && e.tag !== '冷血躲避球')
            .map(([s]) => s);
    }

    stats(movieId?: string) {
        const mid = movieId || this.selectedMovieId || 'fes';
        const p = this.pool(mid);
        let allPlay = { r3: 0, r4: 0, r5: 0, total: 0 };
        let allConfirm = 0, allPending = 0, allVerified = 0;
        for (const [, pool] of this.pools) {
            for (const [, e] of pool.playPool) { if (e.r === 0) allPlay.r3++; else if (e.r === 1) allPlay.r4++; else { allPlay.r5++; } allPlay.total++; }
            allConfirm += pool.confirmPool.size;
            allPending += pool.pendingPool.size;
            allVerified += pool.verifiedPool.size;
        }
        return {
            confirm: p.confirmPool.size, confirm_total: allConfirm,
            play_r3: allPlay.r3, play_r4: allPlay.r4, play_r5: allPlay.r5, play_total: allPlay.total,
            mov_play: p.playPool.size,
            verified: p.verifiedPool.size, verified_total: allVerified,
            pending: p.pendingPool.size, pending_total: allPending,
            test_seeds: this.testSeeds,
            mode: this.mode, selectedMovieId: this.selectedMovieId, movieIds: Array.from(this.pools.keys()),
        };
        return {
            confirm: p.confirmPool.size, confirm_total: allConfirm,
            play_r3: allPlay.r3, play_r4: allPlay.r4, play_r5: allPlay.r5, play_total: allPlay.total,
            mov_play: p.playPool.size,
            pending: p.pendingPool.size, pending_total: allPending,
            test_seeds: this.testSeeds,
            mode: this.mode, selectedMovieId: this.selectedMovieId, movieIds: Array.from(this.pools.keys()),
        };
    }

    getPlayList(movieId: string): { seed: number; rarity: number; tag: SeedTag; play?: boolean }[] {
        return Array.from(this.pool(movieId).playPool.entries()).map(([s, e]) => ({ seed: s, rarity: e.r + 3, tag: e.tag, play: e.play }));
    }

    getVerifiedList(movieId: string): { seed: number; rarity: number }[] {
        return Array.from(this.pool(movieId).verifiedPool.entries())
            .map(([s, r]) => ({ seed: s, rarity: r + 3 }));
    }
}

const validator = new SeedValidator();
export default validator;
