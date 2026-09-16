import { readFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../data/db";
import { ensurePlayerDegreesTableSync } from "../data/domains/degree";
import { getRushPlayerFullRunsSync } from "../data/domains/rushLeaderboard";

export const ABYSS_ENDURANCE_EVENT = 700099;
export const ABYSS_ENDURANCE_FOLDER = 1;
export const ABYSS_ENDURANCE_REWARDS = Object.freeze([
    { degreeId: 9911101, minutes: 60, name: "艰难依然前行" },
    { degreeId: 9911102, minutes: 120, name: "蠕动化区" },
    { degreeId: 9911103, minutes: 180, name: "肉鸽爱好者" },
] as const);
export const ABYSS_ENDURANCE_CONFIG = path.resolve(
    __dirname, "..", "..", "assets", "abyss_endurance_degree_reward.json",
);

/** Strictly greater than each threshold. One completed run can unlock all three. */
export function enduranceDegreeIds(battleMs: number): number[] {
    if (!Number.isSafeInteger(battleMs) || battleMs <= 0) return [];
    return ABYSS_ENDURANCE_REWARDS.filter(r => battleMs > r.minutes * 60_000).map(r => r.degreeId);
}

/** Keep grants disabled until the native rows and images are published together. */
export function enduranceDegreesEnabled(configPath = ABYSS_ENDURANCE_CONFIG): boolean {
    try {
        const value = JSON.parse(readFileSync(configPath, "utf8"));
        return value?.schema_version === 1 && value.enabled === true
            && value.event_id === ABYSS_ENDURANCE_EVENT && value.folder_id === ABYSS_ENDURANCE_FOLDER
            && value.clock === "battle_ms" && value.comparison === ">" && value.cumulative === true
            && Array.isArray(value.rewards) && value.rewards.length === ABYSS_ENDURANCE_REWARDS.length
            && value.rewards.every((r: { degree_id?: number; minutes?: number }, i: number) =>
                r?.degree_id === ABYSS_ENDURANCE_REWARDS[i].degreeId
                && r.minutes === ABYSS_ENDURANCE_REWARDS[i].minutes);
    } catch {
        return false;
    }
}

/** Reconcile from persisted full-run records, never request-supplied time or wall-clock time.
 * Called after a full clear and on opening the degree list (also repairs a missed grant).
 * Different attempts are not added together. Existing qualifying records remain eligible.
 */
export function grantAbyssEnduranceDegreesSync(playerId: number, options: { configPath?: string } = {}): number[] {
    if (!Number.isSafeInteger(playerId) || playerId <= 0 || !enduranceDegreesEnabled(options.configPath)) return [];
    try {
        const db = getDb();
        return db.transaction(() => {
            if (!db.prepare("SELECT id FROM players WHERE id = ?").get(playerId)) return [];
            ensurePlayerDegreesTableSync();
            const owned = new Set((db.prepare("SELECT degree_id FROM players_degrees WHERE player_id = ?")
                .all(playerId) as { degree_id: number }[]).map(r => r.degree_id));
            if (ABYSS_ENDURANCE_REWARDS.every(r => owned.has(r.degreeId))) return [];
            // -1 means no limit: a slow older run must not be hidden by newer, faster records.
            const records = getRushPlayerFullRunsSync(ABYSS_ENDURANCE_EVENT, ABYSS_ENDURANCE_FOLDER, playerId, -1);
            const eligible = new Set<number>();
            for (const run of records) {
                if (!run.fullRun || run.totalRounds <= 0 || run.roundsCleared < run.totalRounds) continue;
                for (const id of enduranceDegreeIds(run.battleMs)) eligible.add(id);
            }
            const grant = db.prepare("INSERT OR IGNORE INTO players_degrees (player_id, degree_id) VALUES (?, ?)");
            return [...eligible].sort((a, b) => a - b).filter(id => grant.run(playerId, id).changes === 1);
        })();
    } catch (error) {
        // Records survive the failure and the next profile read retries all three atomically.
        console.error("[ABYSS-ENDURANCE] degree grant failed:", error);
        return [];
    }
}
