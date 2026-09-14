import { readFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../data/db";
import { ensurePlayerDegreesTableSync } from "../data/domains/degree";
import { getPracticeQuestSync } from "./assets";
import { grantAbyssShopDegreeRewardSync } from "./abyss-shop-degree-reward";
import type { BattleFinishMissionEvent } from "./mission/events";
import { QuestCategory } from "./types";

export const EQUIPMENT_DEGREE_CATALOG = Object.freeze([
    Object.freeze({ degree_id: 9_911_002,
        equipment_ids: Object.freeze(Array.from({ length: 15 }, (_, index) => 8_000_101 + index)),
        min_enhancement_level: 120 }),
    Object.freeze({ degree_id: 9_911_003, equipment_ids: Object.freeze([5_900_101]),
        min_enhancement_level: 120 }),
]);
export const EQUIPMENT_DEGREE_CONFIG_PATH = path.resolve(
    __dirname, "..", "..", "assets", "equipment_degree_rewards.json",
);
interface RewardOptions { configPath?: string; }
interface PracticeRewardOptions extends RewardOptions { shopConfigPath?: string; }

/** Ordinary awakening level and duplicate stack are not enhancement progress. */
export function isEquipmentDegreeEnhancementComplete(value: unknown): boolean {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 120;
}

export function equipmentDegreeRewardsEnabled(configPath = EQUIPMENT_DEGREE_CONFIG_PATH): boolean {
    try {
        const value = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown> | null;
        if (!value || value.schema_version !== 1 || value.enabled !== true
            || !Array.isArray(value.rewards) || value.rewards.length !== EQUIPMENT_DEGREE_CATALOG.length) return false;
        return value.rewards.every((raw: unknown, index) => {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
            const entry = raw as Record<string, unknown>;
            const expected = EQUIPMENT_DEGREE_CATALOG[index];
            return entry.degree_id === expected.degree_id
                && entry.min_enhancement_level === expected.min_enhancement_level
                && Array.isArray(entry.equipment_ids) && entry.equipment_ids.length === expected.equipment_ids.length
                && entry.equipment_ids.every((id, itemIndex) => id === expected.equipment_ids[itemIndex]);
        });
    } catch {
        return false;
    }
}

/** Updated IDs select relevant rules; eligibility always reads every required persisted row. */
export function grantEquipmentDegreeRewardsSync(
    playerId: number,
    updatedEquipmentIds?: readonly number[],
    options: RewardOptions = {},
): number[] {
    if (!Number.isSafeInteger(playerId) || playerId <= 0) return [];
    const updated = updatedEquipmentIds === undefined ? null : new Set(updatedEquipmentIds);
    const targets = EQUIPMENT_DEGREE_CATALOG.filter(entry =>
        updated === null || entry.equipment_ids.some(id => updated.has(id)));
    if (!targets.length || !equipmentDegreeRewardsEnabled(options.configPath)) return [];
    const db = getDb();
    return db.transaction(() => {
        if (!db.prepare("SELECT id FROM players WHERE id = ?").get(playerId)) return [];
        const owned = db.prepare(`SELECT enhancement_level FROM players_equipment
            WHERE player_id = ? AND id = ?`);
        const eligible = targets.filter(entry => entry.equipment_ids.every(id => {
            const row = owned.get(playerId, id) as { enhancement_level: unknown } | undefined;
            return row !== undefined && isEquipmentDegreeEnhancementComplete(row.enhancement_level);
        }));
        if (!eligible.length) return [];
        ensurePlayerDegreesTableSync();
        const insert = db.prepare(`INSERT OR IGNORE INTO players_degrees (player_id, degree_id)
            VALUES (?, ?)`);
        return eligible.filter(entry => insert.run(playerId, entry.degree_id).changes === 1)
            .map(entry => entry.degree_id);
    })();
}

/** Reuses the native successful practice event; equipped party and client reward claims are irrelevant. */
export function grantPracticeExclusiveDegreeRewardsSync(
    event: BattleFinishMissionEvent,
    options: PracticeRewardOptions = {},
): number[] {
    if (event.type !== "battle_finish" || event.accomplished !== true
        || event.mode !== "single" || event.questCategory !== QuestCategory.PRACTICE
        || !Number.isSafeInteger(event.questId) || event.questId <= 0
        || getPracticeQuestSync(event.questId) === null) return [];
    return [
        ...grantAbyssShopDegreeRewardSync(event.playerId, { configPath: options.shopConfigPath }),
        ...grantEquipmentDegreeRewardsSync(event.playerId, undefined, options),
    ];
}
