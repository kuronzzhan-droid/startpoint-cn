import { readFileSync } from "node:fs"
import path from "node:path"
import { getDb } from "../data/db"
import { grantPlayerDegreeSync } from "../data/domains/degree"
import { runPersistenceTransactionSync } from "./persistence-coordinator"

export const ABYSS_SPHEAL_DEGREE = 9_911_301
export const SPHEAL_CHARACTER = 129990
export const ABYSS_SPHEAL_CONFIG_PATH = path.resolve(
    __dirname, "..", "..", "assets", "abyss_spheal_degree_reward.json",
)

interface SphealConfig {
    schema_version: number
    enabled: boolean
    event_id: number
    folder_id: number
    degree_id: number
    character_id: number
    party_scope: string
}

function readConfig(configPath: string): SphealConfig | null {
    try {
        const config = JSON.parse(readFileSync(configPath, "utf8")) as Partial<SphealConfig>
        if (config.schema_version !== 1 || config.enabled !== true
            || config.event_id !== 700099 || config.folder_id !== 1
            || config.degree_id !== ABYSS_SPHEAL_DEGREE || config.character_id !== SPHEAL_CHARACTER
            || config.party_scope !== "final_clear_main_or_unison") return null
        return config as SphealConfig
    } catch {
        return null
    }
}

export function sphealDegreeEnabled(configPath = ABYSS_SPHEAL_CONFIG_PATH): boolean {
    return readConfig(configPath) !== null
}

/**
 * Grant the Spheal title only when every one of the 30 main-tower rounds in a
 * completed run included Spheal in either the main or unison party.
 */
export function grantAbyssSphealDegreeSync(
    playerId: number,
    options: { configPath?: string } = {},
): number[] {
    if (!Number.isSafeInteger(playerId) || playerId <= 0) return []
    const config = readConfig(options.configPath ?? ABYSS_SPHEAL_CONFIG_PATH)
    if (config === null) return []

    const db = getDb()
    return runPersistenceTransactionSync({
        domain: "event", playerId, operation: "grant_abyss_spheal_degree",
    }, () => {
        if (!db.prepare("SELECT id FROM players WHERE id = ?").get(playerId)) return []
        if (db.prepare("SELECT 1 FROM players_degrees WHERE player_id = ? AND degree_id = ?")
            .get(playerId, config.degree_id)) return []
        // Keep historical grants, but stop at the first qualifying run without
        // materializing every ID or making one SQL round trip per run. CASE
        // preserves the old SUM semantics when unused character slots are NULL.
        const run = db.prepare(`
            SELECT r.id
            FROM leaderboard_runs r
            WHERE r.player_id = ? AND r.competition_key = 'achievement:abyss-endurance:700099:1'
                AND r.status = 'completed' AND r.tracked_from_round = 1
                AND r.total_rounds = 30 AND r.rounds_cleared = 30
                AND NOT EXISTS (
                    SELECT 1 FROM leaderboard_run_rounds rr
                    WHERE rr.run_id = r.id
                        AND CASE WHEN rr.character_id_1 = ? OR rr.character_id_2 = ? OR rr.character_id_3 = ?
                            OR rr.unison_character_id_1 = ? OR rr.unison_character_id_2 = ?
                            OR rr.unison_character_id_3 = ? THEN 1 ELSE 0 END = 0
                )
                AND (SELECT COUNT(*) FROM leaderboard_run_rounds rr WHERE rr.run_id = r.id) = 30
            ORDER BY r.id DESC LIMIT 1
        `).get(
            playerId, config.character_id, config.character_id, config.character_id,
            config.character_id, config.character_id, config.character_id,
        ) as { id: number } | undefined
        if (run === undefined) return []
        return grantPlayerDegreeSync(playerId, config.degree_id, Date.now())
            ? [config.degree_id] : []
    })
}
