import { readFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../data/db";
import { ensurePlayerDegreesTableSync } from "../data/domains/degree";
import { getRushPlayerFullRunsSync } from "../data/domains/rushLeaderboard";

export const ABYSS_SPHEAL_DEGREE = 9911301;
export const SPHEAL_CHARACTER = 129990;
export const ABYSS_SPHEAL_CONFIG = path.resolve(
    __dirname, "..", "..", "assets", "abyss_spheal_degree_reward.json",
);

/** Enable only after both the native degree row and its image are published. */
export function sphealDegreeEnabled(configPath = ABYSS_SPHEAL_CONFIG): boolean {
    try {
        const c = JSON.parse(readFileSync(configPath, "utf8"));
        return c?.schema_version === 1 && c.enabled === true
            && c.event_id === 700099 && c.folder_id === 1
            && c.degree_id === ABYSS_SPHEAL_DEGREE && c.character_id === SPHEAL_CHARACTER
            && c.party_scope === "final_clear_main_or_unison";
    } catch {
        return false;
    }
}

/** Use the persisted final-clear party of a complete main-tower run.
 * Owning Spheal, a different player's party, endless/partial runs never qualify.
 * Profile reads retry a missed grant; no new battle telemetry or client patch is needed.
 */
export function grantAbyssSphealDegreeSync(playerId: number, options: { configPath?: string } = {}): number[] {
    if (!Number.isSafeInteger(playerId) || playerId <= 0 || !sphealDegreeEnabled(options.configPath)) return [];
    try {
        const db = getDb();
        return db.transaction(() => {
            if (!db.prepare("SELECT id FROM players WHERE id = ?").get(playerId)) return [];
            ensurePlayerDegreesTableSync();
            if (db.prepare("SELECT 1 FROM players_degrees WHERE player_id = ? AND degree_id = ?")
                .get(playerId, ABYSS_SPHEAL_DEGREE)) return [];
            const runs = getRushPlayerFullRunsSync(700099, 1, playerId, -1);
            const eligible = runs.some(r => r.fullRun && r.totalRounds > 0 && r.roundsCleared >= r.totalRounds
                && [...r.characterIds, ...r.unisonCharacterIds].includes(SPHEAL_CHARACTER));
            if (!eligible) return [];
            const result = db.prepare("INSERT OR IGNORE INTO players_degrees (player_id, degree_id) VALUES (?, ?)")
                .run(playerId, ABYSS_SPHEAL_DEGREE);
            return result.changes === 1 ? [ABYSS_SPHEAL_DEGREE] : [];
        })();
    } catch (error) {
        console.error("[ABYSS-SPHEAL] degree grant failed:", error);
        return [];
    }
}
