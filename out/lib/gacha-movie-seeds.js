"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadMovieSeeds = void 0;
const file_exists_1 = require("./file-exists");
const fs_1 = require("fs");
const path_1 = require("path");
const ASSETS_DIR = (0, path_1.join)(__dirname, "..", "..", "assets");
const movieSeedCache = new Map();
/**
 * Loads a movie seed file once per process. Runtime asset updates take effect
 * after the normal server restart that accompanies deployment.
 */
function loadMovieSeeds(movieId) {
    const cached = movieSeedCache.get(movieId);
    if (cached !== undefined)
        return cached;
    const specific = (0, path_1.join)(ASSETS_DIR, `gacha_movie_seeds_${movieId}.json`);
    if ((0, file_exists_1.existsSync)(specific)) {
        const seeds = JSON.parse((0, fs_1.readFileSync)(specific, "utf-8"));
        movieSeedCache.set(movieId, seeds);
        return seeds;
    }
    const fallback = (0, path_1.join)(ASSETS_DIR, "gacha_movie_seeds.json");
    const seeds = (0, file_exists_1.existsSync)(fallback)
        ? JSON.parse((0, fs_1.readFileSync)(fallback, "utf-8"))
        : {};
    movieSeedCache.set(movieId, seeds);
    return seeds;
}
exports.loadMovieSeeds = loadMovieSeeds;
