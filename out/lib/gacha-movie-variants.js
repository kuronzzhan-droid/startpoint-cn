"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GachaMovieVariantCatalog = void 0;
const file_exists_1 = require("./file-exists");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const VARIANT_KINDS = [
    "skip",
    "play_no_rarity_up",
    "play_rarity_up",
];
const RANDOM_RETRIES = 16;
function validateSeeds(value, movieId, rarity, kind) {
    if (!Array.isArray(value)) {
        throw new Error(`invalid gacha movie catalog bucket: ${movieId} rarity=${rarity} kind=${kind}`);
    }
    for (const seed of value) {
        if (!Number.isSafeInteger(seed)) {
            throw new Error(`invalid gacha movie catalog seed: ${movieId} rarity=${rarity} kind=${kind}`);
        }
    }
    return value;
}
function validateCatalog(value, expectedMovieId) {
    if (typeof value !== "object" || value === null) {
        throw new Error(`invalid gacha movie catalog: ${expectedMovieId}`);
    }
    const catalog = value;
    if (catalog.schemaVersion !== 1 || catalog.movieId !== expectedMovieId
        || typeof catalog.buckets !== "object" || catalog.buckets === null) {
        throw new Error(`unsupported gacha movie catalog: ${expectedMovieId}`);
    }
    for (const rarity of ["3", "4", "5"]) {
        const buckets = catalog.buckets[rarity];
        if (typeof buckets !== "object" || buckets === null) {
            throw new Error(`missing gacha movie catalog rarity: ${expectedMovieId} rarity=${rarity}`);
        }
        for (const kind of VARIANT_KINDS) {
            validateSeeds(buckets[kind], expectedMovieId, rarity, kind);
        }
    }
    return catalog;
}
class GachaMovieVariantCatalog {
    constructor(options = {}) {
        var _a, _b;
        this.cache = new Map();
        this.catalogDir = (_a = options.catalogDir) !== null && _a !== void 0 ? _a : (0, path_1.join)(__dirname, "..", "..", "assets", "gacha-movie-variants");
        this.randomIndex = (_b = options.randomIndex) !== null && _b !== void 0 ? _b : ((maxExclusive) => (0, crypto_1.randomInt)(maxExclusive));
        this.loadMovieOverride = options.loadMovie;
    }
    load(movieId) {
        if (this.cache.has(movieId))
            return this.cache.get(movieId);
        let raw;
        if (this.loadMovieOverride) {
            raw = this.loadMovieOverride(movieId);
        }
        else {
            const file = (0, path_1.join)(this.catalogDir, `${movieId}.json`);
            raw = (0, file_exists_1.existsSync)(file) ? JSON.parse((0, fs_1.readFileSync)(file, "utf8")) : null;
        }
        const catalog = raw === null ? null : validateCatalog(raw, movieId);
        this.cache.set(movieId, catalog);
        return catalog;
    }
    roll(maxExclusive) {
        const value = this.randomIndex(maxExclusive);
        if (!Number.isInteger(value) || value < 0 || value >= maxExclusive) {
            throw new Error(`gacha movie random index out of range: ${value}/${maxExclusive}`);
        }
        return value;
    }
    pickSeed(pool, usedSeeds, isRejected) {
        if (pool.length === 0)
            return null;
        for (let attempt = 0; attempt < RANDOM_RETRIES; attempt += 1) {
            const seed = pool[this.roll(pool.length)];
            if (!usedSeeds.has(seed) && !isRejected(seed))
                return seed;
        }
        // Only reached after repeated collisions. The normal request path never
        // scans the catalog; a ten-pull generally succeeds during the retries.
        const start = this.roll(pool.length);
        for (let offset = 0; offset < pool.length; offset += 1) {
            const seed = pool[(start + offset) % pool.length];
            if (!usedSeeds.has(seed) && !isRejected(seed))
                return seed;
        }
        return null;
    }
    select(options) {
        var _a, _b;
        const catalog = this.load(options.movieId);
        const buckets = catalog === null || catalog === void 0 ? void 0 : catalog.buckets[String(options.rarity)];
        if (!buckets)
            return null;
        const upgradeCount = buckets.play_rarity_up.length;
        const playNoUpgradeCount = buckets.play_no_rarity_up.length;
        const noUpgradeCount = buckets.skip.length + playNoUpgradeCount;
        const total = upgradeCount + noUpgradeCount;
        if (total === 0)
            return null;
        // Preserve the catalog's natural upgrade/play/skip ratio. Enabling the
        // option only turns naturally selected non-upgrade movies into skips;
        // disabling it must not force every non-upgrade result to play.
        const outcomeRoll = this.roll(total);
        let preferredKind;
        if (outcomeRoll < upgradeCount) {
            preferredKind = "play_rarity_up";
        }
        else if (options.skipNoRarityUpMovie) {
            preferredKind = "skip";
        }
        else if (outcomeRoll < upgradeCount + playNoUpgradeCount) {
            preferredKind = "play_no_rarity_up";
        }
        else {
            preferredKind = "skip";
        }
        const kinds = preferredKind === "play_rarity_up"
            ? [preferredKind, options.skipNoRarityUpMovie ? "skip" : "play_no_rarity_up"]
            : preferredKind === "play_no_rarity_up"
                ? [preferredKind, "skip"]
                : [preferredKind, "play_no_rarity_up"];
        const usedSeeds = (_a = options.usedSeeds) !== null && _a !== void 0 ? _a : new Set();
        const isRejected = (_b = options.isRejected) !== null && _b !== void 0 ? _b : (() => false);
        for (const kind of kinds) {
            const seed = this.pickSeed(buckets[kind], usedSeeds, isRejected);
            if (seed === null)
                continue;
            return {
                seed,
                moviePlayable: kind !== "skip",
                rarityUp: kind === "play_rarity_up",
            };
        }
        return null;
    }
}
exports.GachaMovieVariantCatalog = GachaMovieVariantCatalog;
const defaultCatalog = new GachaMovieVariantCatalog();
exports.default = defaultCatalog;
