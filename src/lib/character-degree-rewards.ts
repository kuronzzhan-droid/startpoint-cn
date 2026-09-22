import { readFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../data/db";
import { ensurePlayerDegreesTableSync } from "../data/domains/degree";
import { getCharacterDataSync, getPracticeQuestSync } from "./assets";
import { QuestCategory } from "./types";
import type { BattleFinishMissionEvent } from "./mission/events";
import {
    CHARACTER_DEGREE_CATALOG,
    isCharacterDegreeActivation,
    isCharacterDegreeEligible,
} from "./character-degree-catalog";

export const CHARACTER_DEGREE_CONFIG_PATH = path.resolve(
    __dirname, "..", "..", "assets", "character_degree_rewards.json",
);

interface RewardOptions {
    /** Tests/offline rehearsal may use their own activation file; never supplied by a request. */
    configPath?: string;
}

/** Deployment gate: publish/verify every catalog entry before enabling the matching file. */
export function characterDegreeRewardsEnabled(configPath = CHARACTER_DEGREE_CONFIG_PATH): boolean {
    try {
        const value: unknown = JSON.parse(readFileSync(configPath, "utf8"));
        return isCharacterDegreeActivation(value) && value.enabled;
    } catch {
        // Missing, partially deployed or malformed configuration must never grant missing assets.
        return false;
    }
}

/**
 * Reads persisted ownership/EXP/break state, grants both variants atomically, and returns
 * only newly inserted degree IDs. Omitting characterIds scans the reviewed owned roster.
 * No party statistics, client-supplied level, awakening, bond token or equipment is trusted.
 */
export function grantCharacterDegreeRewardsSync(
    playerId: number,
    characterIds?: readonly number[],
    options: RewardOptions = {},
): number[] {
    if (!Number.isSafeInteger(playerId) || playerId <= 0
        || !characterDegreeRewardsEnabled(options.configPath)) return [];
    const requested = characterIds === undefined ? null : new Set(characterIds);
    const targets = CHARACTER_DEGREE_CATALOG.filter(entry =>
        requested === null || requested.has(entry.character_id));
    if (targets.length === 0) return [];

    const db = getDb();
    if (!db.prepare("SELECT id FROM players WHERE id = ?").get(playerId)) return [];
    ensurePlayerDegreesTableSync();
    return db.transaction(() => {
        const newlyGranted: number[] = [];
        const owned = db.prepare(`SELECT exp, over_limit_step FROM players_characters
            WHERE player_id = ? AND id = ?`);
        const insert = db.prepare(`INSERT OR IGNORE INTO players_degrees (player_id, degree_id)
            VALUES (?, ?)`);
        for (const entry of targets) {
            if (getCharacterDataSync(entry.character_id)?.rarity !== 5) continue;
            const character = owned.get(playerId, entry.character_id) as
                { exp: number; over_limit_step: number } | undefined;
            if (!character || !isCharacterDegreeEligible(character)) continue;
            for (const degreeId of entry.degree_ids) {
                if (insert.run(playerId, degreeId).changes === 1) newlyGranted.push(degreeId);
            }
        }
        return newlyGranted;
    })();
}

/** Called only from the existing server battle-finish event, never from history/list APIs. */
export function grantPracticeCharacterDegreeRewardsSync(
    event: BattleFinishMissionEvent,
    options: RewardOptions = {},
): number[] {
    if (event.type !== "battle_finish" || event.accomplished !== true
        || event.mode !== "single" || event.questCategory !== QuestCategory.PRACTICE
        || !Number.isSafeInteger(event.questId) || event.questId <= 0
        || getPracticeQuestSync(event.questId) === null) return [];
    return grantCharacterDegreeRewardsSync(event.playerId, undefined, options);
}
