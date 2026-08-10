import { getDb } from "../data/db";
import type { PlayerRushEventPlayedParty } from "../data/types";
import { RushEventBattleType } from "../data/types";
import { givePlayerRewardsSync } from "./quest";
import { PlayerRewardResult, QuestCategory, RewardType } from "./types";


export const MODE15_RUSH_EVENT_ID = 700098;
export const MODE15_MULTI_EVENT_ID = 300098;
export const MODE15_LEGACY_HARD_MULTI_EVENT_ID = 100098;
export const MODE15_TOKEN_ID = 2370098;
export const MODE15_FULL_CLEAR_TOKEN_ID = 2370097;
export const MODE15_DREAM_EMBLEM_ID = 99;
export const MODE15_BOSS_TOKEN_REWARD_GROUP_ID = 237009800;
export const MODE15_FULL_CLEAR_REWARD_GROUP_ID = 237009700;
export const MODE15_SOLO_REWARD_GROUP_BASE_ID = 237098000;
export const MODE15_PRACTICE_QUEST_ID = MODE15_RUSH_EVENT_ID * 1000 + 16;

export const MODE15_EXCLUSIVE_EQUIPMENT_IDS = Object.freeze(
    Array.from({ length: 11 }, (_, index) => 100013 + index),
);

const SOLO_STAGE_NUMBERS = [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14] as const;
const MULTI_STAGE_NUMBERS = [5, 10, 15] as const;
// The CN AdventEvent multiplayer client posts category 7 even though the
// server enum names category 8 ADVENT_EVENT_MULTI.  Treat 7 as canonical and
// keep 8 as a compatibility alias for old callers/saves.
const MODE15_MULTI_CATEGORY = QuestCategory.ADVENT_EVENT_SINGLE;
const MODE15_MULTI_CATEGORY_ALIASES = [
    QuestCategory.ADVENT_EVENT_SINGLE,
    QuestCategory.ADVENT_EVENT_MULTI,
] as const;

export const MODE15_BOSS_TOKEN_REWARDS: Readonly<Record<number, number>> = {
    5: 5,
    10: 10,
    15: 20,
};

interface Mode15FixedItemReward {
    id: number;
    count: number;
}

const ELEMENT_TIER_1 = [1, 5, 9, 13, 42, 46] as const;
const ELEMENT_TIER_2 = [2, 6, 10, 14, 43, 47] as const;
const ELEMENT_TIER_3 = [3, 7, 11, 15, 44, 48] as const;
const ELEMENT_TIER_4 = [4, 8, 12, 16, 45, 49] as const;
const ETHER_TIER_1 = [50, 53, 56, 59, 62, 65] as const;
const ETHER_TIER_2 = [51, 54, 57, 60, 63, 66] as const;
const ETHER_TIER_3 = [52, 55, 58, 61, 64, 67] as const;

function itemSet(ids: readonly number[], count: number): Mode15FixedItemReward[] {
    return ids.map(id => ({ id, count }));
}

/**
 * Repeatable fixed rewards for Fantasy Gauntlet solo rounds.  These are keyed
 * only by the displayed Rush round, so bosses/fields may be redesigned without
 * changing the reward schedule.  Boss rounds 5/10/15 remain on their separate
 * multiplayer token settlement.
 */
export const MODE15_SOLO_FIXED_REWARDS: Readonly<Record<number, readonly Mode15FixedItemReward[]>> = {
    1: itemSet(ELEMENT_TIER_1, 100),
    2: itemSet(ELEMENT_TIER_1, 150),
    3: itemSet(ELEMENT_TIER_2, 100),
    4: [...itemSet(ELEMENT_TIER_2, 150), { id: MODE15_DREAM_EMBLEM_ID, count: 5 }],
    6: itemSet(ELEMENT_TIER_3, 75),
    7: itemSet(ETHER_TIER_1, 50),
    8: [...itemSet(ELEMENT_TIER_3, 125), ...itemSet(ETHER_TIER_1, 50)],
    9: [...itemSet(ETHER_TIER_2, 50), { id: MODE15_DREAM_EMBLEM_ID, count: 10 }],
    11: [...itemSet(ELEMENT_TIER_4, 50), ...itemSet(ETHER_TIER_1, 100)],
    12: itemSet(ETHER_TIER_2, 75),
    13: [...itemSet(ELEMENT_TIER_4, 100), ...itemSet(ETHER_TIER_3, 50)],
    14: [
        ...itemSet(ETHER_TIER_1, 100),
        ...itemSet(ETHER_TIER_2, 75),
        ...itemSet(ETHER_TIER_3, 50),
        { id: MODE15_DREAM_EMBLEM_ID, count: 15 },
    ],
};

interface Mode15QuestRef {
    stage: number;
    category: QuestCategory;
    questId: number;
}

export interface Mode15AdditionalRewardEntry {
    group_id: number;
    index: number;
    number: number;
}

export interface Mode15SettlementResult extends PlayerRewardResult {
    mode15_additional_reward_ids: Mode15AdditionalRewardEntry[];
    mode15_rush_event: Record<string, unknown> | null;
}

const MODE15_QUESTS: readonly Mode15QuestRef[] = [
    ...SOLO_STAGE_NUMBERS.map(stage => ({
        stage,
        category: QuestCategory.RUSH_EVENT,
        // Rush now owns the complete visible 1..15 sequence.  Solo quest IDs
        // therefore match their displayed stage numbers exactly.
        questId: MODE15_RUSH_EVENT_ID * 1000 + stage,
    })),
    ...MULTI_STAGE_NUMBERS.map((stage, index) => ({
        stage,
        category: MODE15_MULTI_CATEGORY,
        questId: MODE15_MULTI_EVENT_ID * 1000 + index + 1,
    })),
].sort((a, b) => a.stage - b.stage);

const MODE15_BY_QUEST = new Map<string, Mode15QuestRef>();
for (const ref of MODE15_QUESTS) {
    MODE15_BY_QUEST.set(`${Number(ref.category)}:${ref.questId}`, ref);
    if (ref.category === MODE15_MULTI_CATEGORY) {
        for (const category of MODE15_MULTI_CATEGORY_ALIASES) {
            MODE15_BY_QUEST.set(`${Number(category)}:${ref.questId}`, ref);
        }
    }
}

export function getMode15QuestRef(
    category: number,
    questId: number,
): Mode15QuestRef | null {
    return MODE15_BY_QUEST.get(`${Number(category)}:${Number(questId)}`) ?? null;
}

export function isMode15Quest(category: number, questId: number): boolean {
    return getMode15QuestRef(category, questId) !== null;
}

export function getMode15ExclusivePartyItemsSync(
    playerId: number,
    category: number,
    groupId: number,
    slot: number | null = null,
): number[] {
    const clauses = ["player_id = ?", "category = ?", "group_id = ?"];
    const args: number[] = [playerId, category, groupId];
    if (slot !== null) {
        clauses.push("slot = ?");
        args.push(slot);
    }
    const rows = getDb().prepare(`
        SELECT equipment_1, equipment_2, equipment_3,
               ability_soul_1, ability_soul_2, ability_soul_3
        FROM players_parties
        WHERE ${clauses.join(" AND ")}
    `).all(...args) as Array<Record<string, number | null>>;
    const restricted = new Set(MODE15_EXCLUSIVE_EQUIPMENT_IDS);
    return [...new Set(rows.flatMap(row => Object.values(row)
        .map(Number)
        .filter(id => restricted.has(id))))];
}

export function getMode15ExclusiveGlobalPartyItemsSync(
    playerId: number,
    category: number,
    partyId: number,
): number[] {
    if (!Number.isInteger(partyId) || partyId < 1 || partyId > 120) return [];
    const groupId = Math.floor((partyId - 1) / 10) + 1;
    const slot = ((partyId - 1) % 10) + 1;
    return getMode15ExclusivePartyItemsSync(
        playerId, category, groupId, slot,
    );
}

export function getExpectedMode15StageSync(playerId: number): number {
    const statement = getDb().prepare(`
        SELECT finished, host_finished
        FROM players_quest_progress
        WHERE player_id = ? AND section = ? AND quest_id = ?
    `);
    for (const ref of MODE15_QUESTS) {
        const categories = ref.category === MODE15_MULTI_CATEGORY
            ? MODE15_MULTI_CATEGORY_ALIASES
            : [ref.category];
        const cleared = categories.some(category => {
            const progress = statement.get(
                playerId,
                Number(category),
                ref.questId,
            ) as { finished?: number; host_finished?: number } | undefined;
            // A rescue clear is an ordinary multiplayer completion but must
            // not advance the helper's own Mode15 run.  Multiplayer stages
            // therefore count only when this player was the room host.
            return ref.category === MODE15_MULTI_CATEGORY
                ? Number(progress?.host_finished ?? 0) === 1
                : Number(progress?.finished ?? 0) === 1;
        });
        if (!cleared) return ref.stage;
    }
    // A completed run is normally reset during stage-15 settlement.  Returning
    // stage 1 here also makes a recovered pre-migration save safe by default.
    return 1;
}

export function canStartMode15QuestSync(
    playerId: number,
    category: number,
    questId: number,
): { allowed: boolean; stage: number | null; expectedStage: number } {
    const ref = getMode15QuestRef(category, questId);
    const expectedStage = getExpectedMode15StageSync(playerId);
    return {
        allowed: ref !== null && ref.stage === expectedStage,
        stage: ref?.stage ?? null,
        expectedStage,
    };
}

/**
 * Random-recruitment guests are helpers, not owners of the room's run.
 * They may join any mode15 boss repeatedly; the one-shot sequence gate is
 * enforced only for the room host. Rewards are still granted per settlement.
 */
export function canJoinMode15RescueSync(
    playerId: number,
    category: number,
    questId: number,
): { allowed: boolean; stage: number | null; expectedStage: number } {
    const ref = getMode15QuestRef(category, questId);
    const expectedStage = getExpectedMode15StageSync(playerId);
    if (ref === null) return { allowed: false, stage: null, expectedStage };

    return { allowed: true, stage: ref.stage, expectedStage };
}

/** Remove progress rows written by the older rescue settlement path. */
export function cleanupLegacyMode15RescueProgressSync(playerId: number): number {
    const result = getDb().prepare(`
        DELETE FROM players_quest_progress
        WHERE player_id = ?
          AND section IN (?, ?)
          AND quest_id BETWEEN ? AND ?
          AND COALESCE(host_finished, 0) = 0
    `).run(
        playerId,
        Number(QuestCategory.ADVENT_EVENT_SINGLE),
        Number(QuestCategory.ADVENT_EVENT_MULTI),
        MODE15_MULTI_EVENT_ID * 1000 + 1,
        MODE15_MULTI_EVENT_ID * 1000 + MULTI_STAGE_NUMBERS.length,
    );
    return result.changes;
}

/** Reset only run progress; token balances and shop purchase history persist. */
export function resetMode15RunSync(playerId: number): void {
    getDb().transaction(() => {
        getDb().prepare(`
            DELETE FROM players_quest_progress
            WHERE player_id = ? AND (
                (section = ? AND quest_id BETWEEN ? AND ?)
                OR (section IN (?, ?) AND quest_id BETWEEN ? AND ?)
            )
        `).run(
            playerId,
            Number(QuestCategory.RUSH_EVENT),
            MODE15_RUSH_EVENT_ID * 1000 + 1,
            MODE15_RUSH_EVENT_ID * 1000 + 15,
            Number(QuestCategory.ADVENT_EVENT_SINGLE),
            Number(QuestCategory.ADVENT_EVENT_MULTI),
            MODE15_MULTI_EVENT_ID * 1000 + 1,
            MODE15_MULTI_EVENT_ID * 1000 + MULTI_STAGE_NUMBERS.length,
        );
        getDb().prepare(`
            DELETE FROM players_quest_progress
            WHERE player_id = ? AND section = ?
              AND quest_id BETWEEN ? AND ?
        `).run(
            playerId,
            Number(QuestCategory.HARD_MULTI_EVENT),
            MODE15_LEGACY_HARD_MULTI_EVENT_ID * 1000 + 1,
            MODE15_LEGACY_HARD_MULTI_EVENT_ID * 1000 + MULTI_STAGE_NUMBERS.length,
        );
        getDb().prepare(`
            DELETE FROM players_rush_events_played_parties
            WHERE player_id = ? AND event_id = ?
        `).run(playerId, MODE15_RUSH_EVENT_ID);
        getDb().prepare(`
            DELETE FROM players_rush_events_cleared_folders
            WHERE player_id = ? AND event_id = ?
        `).run(playerId, MODE15_RUSH_EVENT_ID);
        // Keep the Fantasy folder selected after a run reset. The patched
        // client returns directly to RushEventQuestSelect and therefore does
        // not pass through /select_folder again. A null active folder leaves
        // the legacy client displaying the cleared first round even though
        // the server has already advanced to round two.
        getDb().prepare(`
            INSERT INTO players_rush_events (
                player_id,
                event_id,
                active_rush_battle_folder_id,
                endless_battle_max_round,
                endless_battle_max_round_time,
                endless_battle_max_round_character_id_1,
                endless_battle_max_round_character_id_2,
                endless_battle_max_round_character_id_3,
                endless_battle_max_round_character_evolution_img_lvl_1,
                endless_battle_max_round_character_evolution_img_lvl_2,
                endless_battle_max_round_character_evolution_img_lvl_3
            ) VALUES (?, ?, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
            ON CONFLICT(player_id, event_id) DO UPDATE SET
                active_rush_battle_folder_id = 1,
                endless_battle_max_round = NULL,
                endless_battle_max_round_time = NULL,
                endless_battle_max_round_character_id_1 = NULL,
                endless_battle_max_round_character_id_2 = NULL,
                endless_battle_max_round_character_id_3 = NULL,
                endless_battle_max_round_character_evolution_img_lvl_1 = NULL,
                endless_battle_max_round_character_evolution_img_lvl_2 = NULL,
                endless_battle_max_round_character_evolution_img_lvl_3 = NULL
        `).run(playerId, MODE15_RUSH_EVENT_ID);
    })();
}

/**
 * Folder Rush visibility is driven by played-party rows rather than ordinary
 * quest progress. Solo settlements create these rows naturally; a completed
 * multiplayer boss must add the equivalent folder marker.
 */
function recordMode15BossRushRoundSync(
    playerId: number,
    stage: number,
    playedParty: Omit<PlayerRushEventPlayedParty, "round" | "battleType">,
): void {
    getDb().prepare(`
        INSERT OR REPLACE INTO players_rush_events_played_parties (
            character_id_1, character_id_2, character_id_3,
            unison_character_id_1, unison_character_id_2, unison_character_id_3,
            equipment_id_1, equipment_id_2, equipment_id_3,
            ability_soul_id_1, ability_soul_id_2, ability_soul_id_3,
            evolution_img_level_1, evolution_img_level_2, evolution_img_level_3,
            unison_evolution_img_level_1, unison_evolution_img_level_2, unison_evolution_img_level_3,
            player_id, event_id, round, battle_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        ...playedParty.characterIds,
        ...playedParty.unisonCharacterIds,
        ...playedParty.equipmentIds,
        ...playedParty.abilitySoulIds,
        ...playedParty.evolutionImgLevels,
        ...playedParty.unisonEvolutionImgLevels,
        playerId,
        MODE15_RUSH_EVENT_ID,
        MODE15_RUSH_EVENT_ID * 1000 + stage,
        RushEventBattleType.FOLDER,
    );
}

/**
 * Apply the cross-event run rules after the ordinary quest settlement wrote
 * its clear record. Successful solo stages grant their round-keyed fixed
 * material bundle; successful boss stages grant the custom token.
 */
export function settleMode15BattleSync(
    playerId: number,
    category: number,
    questId: number,
    accomplished: boolean,
    options: {
        rescue?: boolean;
        playedParty?: Omit<PlayerRushEventPlayedParty, "round" | "battleType">;
    } = {},
): Mode15SettlementResult | null {
    const ref = getMode15QuestRef(category, questId);
    if (ref === null) return null;

    if (!accomplished) {
        if (!options.rescue) resetMode15RunSync(playerId);
        console.log(`[MODE15] failed: player=${playerId} stage=${ref.stage}; rescue=${!!options.rescue}`);
        return null;
    }

    const tokenAmount = MODE15_BOSS_TOKEN_REWARDS[ref.stage] ?? 0;
    const fullClear = ref.stage === 15 && !options.rescue;
    const soloRewards = ref.category === QuestCategory.RUSH_EVENT && !options.rescue
        ? MODE15_SOLO_FIXED_REWARDS[ref.stage] ?? []
        : [];
    const rewards = [] as Array<{ type: RewardType; id: number; count: number }>;
    rewards.push(...soloRewards.map(drop => ({
        type: RewardType.ITEM,
        id: drop.id,
        count: drop.count,
    })));
    if (tokenAmount > 0) rewards.push({
        type: RewardType.ITEM,
        id: MODE15_TOKEN_ID,
        count: tokenAmount,
    });
    if (fullClear) rewards.push(
        { type: RewardType.ITEM, id: MODE15_DREAM_EMBLEM_ID, count: 200 },
        { type: RewardType.ITEM, id: MODE15_FULL_CLEAR_TOKEN_ID, count: 1 },
    );
    const reward = givePlayerRewardsSync(playerId, rewards as any) as Mode15SettlementResult;
    reward.mode15_additional_reward_ids = [];
    if (soloRewards.length > 0) {
        const groupId = MODE15_SOLO_REWARD_GROUP_BASE_ID + ref.stage;
        reward.mode15_additional_reward_ids.push(...soloRewards.map((drop, index) => ({
            group_id: groupId,
            index: index + 1,
            number: drop.count,
        })));
    }
    if (tokenAmount > 0) reward.mode15_additional_reward_ids.push({
        group_id: MODE15_BOSS_TOKEN_REWARD_GROUP_ID,
        index: 1,
        number: tokenAmount,
    });
    if (fullClear) reward.mode15_additional_reward_ids.push(
        { group_id: MODE15_FULL_CLEAR_REWARD_GROUP_ID, index: 1, number: 200 },
        { group_id: MODE15_FULL_CLEAR_REWARD_GROUP_ID, index: 2, number: 1 },
    );
    reward.mode15_rush_event = fullClear ? {
        rush_battle_reward_list: [
            { kind: 1, kind_id: MODE15_DREAM_EMBLEM_ID, number: 200 },
            { kind: 1, kind_id: MODE15_FULL_CLEAR_TOKEN_ID, number: 1 },
        ],
        rush_battle_played_party_list: null,
        endless_battle_played_party_list: null,
        is_out_of_period: false,
        endless_battle_next_round: null,
        endless_battle_max_round: null,
        high_score: null,
        best_elapsed_time_ms: null,
        old_endless_battle_max_round: null,
        old_best_elapsed_time_ms: null,
    } : null;

    // The Rush rows at 5/10/15 are client-side placeholders.  A successful
    // host clear of the real AdventEvent boss must complete the corresponding
    // placeholder so the native Rush progression hides it and reveals the
    // next round. Rescue players intentionally do not advance their own run.
    if (ref.category === MODE15_MULTI_CATEGORY && !options.rescue) {
        getDb().prepare(`
            INSERT INTO players_quest_progress (
                section, quest_id, finished, host_finished, unlocked,
                high_score, clear_rank, best_elapsed_time_ms,
                leader_character_id, multi_clear_count,
                s_plus_reward_received, player_id
            ) VALUES (?, ?, 1, 1, 1, NULL, 5, NULL, NULL, 0, 0, ?)
            ON CONFLICT(section, quest_id, player_id) DO UPDATE SET
                finished = 1,
                host_finished = 1,
                unlocked = 1,
                clear_rank = MAX(COALESCE(players_quest_progress.clear_rank, 0), 5)
        `).run(
            Number(QuestCategory.RUSH_EVENT),
            MODE15_RUSH_EVENT_ID * 1000 + ref.stage,
            playerId,
        );
        // The client needs a real member thumbnail for every folder marker.
        // Only record the boss boundary when the finish payload contains an
        // actual party; silently writing an empty row is worse than leaving the
        // marker absent because it makes the Rush page crash with C8601.
        if (options.playedParty?.characterIds.some(id => id !== null)) {
            recordMode15BossRushRoundSync(playerId, ref.stage, options.playedParty);
        } else {
            console.warn(`[MODE15] skipped empty boss party marker: player=${playerId} stage=${ref.stage}`);
        }
    }

    if (fullClear) {
        resetMode15RunSync(playerId);
        console.log(`[MODE15] completed: player=${playerId}; token=${tokenAmount}; reset to stage 1`);
    } else {
        console.log(`[MODE15] cleared: player=${playerId} stage=${ref.stage} token=${tokenAmount} rescue=${!!options.rescue}`);
    }
    return reward;
}
