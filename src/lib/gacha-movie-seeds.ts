import { existsSync, readFileSync } from "fs";
import { join } from "path";

const ASSETS_DIR = join(__dirname, "..", "..", "assets");
const movieSeedCache = new Map<string, any>();

/**
 * Loads a movie seed file once per process. Runtime asset updates take effect
 * after the normal server restart that accompanies deployment.
 */
export function loadMovieSeeds(movieId: string): any {
    const cached = movieSeedCache.get(movieId);
    if (cached !== undefined) return cached;

    const specific = join(ASSETS_DIR, `gacha_movie_seeds_${movieId}.json`);
    if (existsSync(specific)) {
        const seeds = JSON.parse(readFileSync(specific, "utf-8"));
        movieSeedCache.set(movieId, seeds);
        return seeds;
    }

    const fallback = join(ASSETS_DIR, "gacha_movie_seeds.json");
    const seeds = existsSync(fallback)
        ? JSON.parse(readFileSync(fallback, "utf-8"))
        : {};
    movieSeedCache.set(movieId, seeds);
    return seeds;
}
