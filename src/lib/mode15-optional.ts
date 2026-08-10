import path from "path";
import type { PlayerRewardResult } from "./types";


interface Mode15Gate {
    allowed: boolean;
    stage: number | null;
    expectedStage: number;
}

export interface Mode15SettlementResult extends PlayerRewardResult {
    mode15_additional_reward_ids?: Array<{ group_id: number; index: number; number: number }>;
    mode15_rush_event?: Record<string, unknown> | null;
}

interface Mode15Runtime {
    MODE15_RUSH_EVENT_ID?: number;
    MODE15_MULTI_EVENT_ID?: number;
    MODE15_LEGACY_HARD_MULTI_EVENT_ID?: number;
    MODE15_TOKEN_ID?: number;
    MODE15_PRACTICE_QUEST_ID?: number;
    isMode15Quest?: (category: number, questId: number) => boolean;
    getExpectedMode15StageSync?: (playerId: number) => number;
    canStartMode15QuestSync?: (
        playerId: number,
        category: number,
        questId: number,
    ) => Mode15Gate;
    canJoinMode15RescueSync?: (
        playerId: number,
        category: number,
        questId: number,
    ) => Mode15Gate;
    cleanupLegacyMode15RescueProgressSync?: (playerId: number) => number;
    resetMode15RunSync?: (playerId: number) => void;
    settleMode15BattleSync?: (
        playerId: number,
        category: number,
        questId: number,
        accomplished: boolean,
        options?: {
            rescue?: boolean;
            playedParty?: {
                characterIds: (number | null)[];
                unisonCharacterIds: (number | null)[];
                equipmentIds: (number | null)[];
                abilitySoulIds: (number | null)[];
                evolutionImgLevels: (number | null)[];
                unisonEvolutionImgLevels: (number | null)[];
            };
        },
    ) => Mode15SettlementResult | null;
    getMode15ExclusivePartyItemsSync?: (
        playerId: number,
        category: number,
        groupId: number,
        slot?: number | null,
    ) => number[];
    getMode15ExclusiveGlobalPartyItemsSync?: (
        playerId: number,
        category: number,
        partyId: number,
    ) => number[];
}

const DEFAULTS = Object.freeze({
    rushEventId: 700098,
    multiEventId: 300098,
    legacyHardMultiEventId: 100098,
    tokenId: 2370098,
    practiceQuestId: 700098013,
});

function isMissingRequestedModule(error: unknown, requested: string): boolean {
    const candidate = error as { code?: string; message?: string };
    return candidate?.code === "MODULE_NOT_FOUND"
        && String(candidate.message ?? "").includes(requested);
}

function loadMode15Runtime(): Mode15Runtime | null {
    if (process.env.MODE15_ENABLED === "0") return null;

    const configured = process.env.MODE15_MODULE_PATH?.trim();
    const requested = configured
        ? path.resolve(process.cwd(), configured)
        : "./mode15";
    try {
        // Deliberately use runtime require instead of a TypeScript import.
        // A generic server build therefore has no compile-time or startup
        // dependency on the optional Mode15 implementation.
        return require(requested) as Mode15Runtime;
    } catch (error) {
        if (isMissingRequestedModule(error, requested)) {
            console.warn(
                `[MODE15] optional module is not installed (${requested}); `
                + "base server behavior remains enabled",
            );
            return null;
        }
        throw error;
    }
}

const runtime = loadMode15Runtime();

export const MODE15_RUSH_EVENT_ID =
    runtime?.MODE15_RUSH_EVENT_ID ?? DEFAULTS.rushEventId;
export const MODE15_MULTI_EVENT_ID =
    runtime?.MODE15_MULTI_EVENT_ID ?? DEFAULTS.multiEventId;
export const MODE15_LEGACY_HARD_MULTI_EVENT_ID =
    runtime?.MODE15_LEGACY_HARD_MULTI_EVENT_ID
    ?? DEFAULTS.legacyHardMultiEventId;
export const MODE15_TOKEN_ID =
    runtime?.MODE15_TOKEN_ID ?? DEFAULTS.tokenId;
export const MODE15_PRACTICE_QUEST_ID =
    runtime?.MODE15_PRACTICE_QUEST_ID ?? DEFAULTS.practiceQuestId;

export function isMode15RuntimeLoaded(): boolean {
    return runtime !== null;
}

export function isMode15Quest(category: number, questId: number): boolean {
    return runtime?.isMode15Quest?.(category, questId) ?? false;
}

export function getExpectedMode15StageSync(playerId: number): number {
    return runtime?.getExpectedMode15StageSync?.(playerId) ?? 1;
}

export function canStartMode15QuestSync(
    playerId: number,
    category: number,
    questId: number,
): Mode15Gate {
    return runtime?.canStartMode15QuestSync?.(playerId, category, questId) ?? {
        allowed: true,
        stage: null,
        expectedStage: 1,
    };
}

export function canJoinMode15RescueSync(
    playerId: number,
    category: number,
    questId: number,
): Mode15Gate {
    return runtime?.canJoinMode15RescueSync?.(playerId, category, questId) ?? {
        allowed: true,
        stage: null,
        expectedStage: 1,
    };
}

export function cleanupLegacyMode15RescueProgressSync(
    playerId: number,
): number {
    return runtime?.cleanupLegacyMode15RescueProgressSync?.(playerId) ?? 0;
}

export function resetMode15RunSync(playerId: number): void {
    runtime?.resetMode15RunSync?.(playerId);
}

export function settleMode15BattleSync(
    playerId: number,
    category: number,
    questId: number,
    accomplished: boolean,
    options: {
        rescue?: boolean;
        playedParty?: {
            characterIds: (number | null)[];
            unisonCharacterIds: (number | null)[];
            equipmentIds: (number | null)[];
            abilitySoulIds: (number | null)[];
            evolutionImgLevels: (number | null)[];
            unisonEvolutionImgLevels: (number | null)[];
        };
    } = {},
): Mode15SettlementResult | null {
    return runtime?.settleMode15BattleSync?.(
        playerId,
        category,
        questId,
        accomplished,
        options,
    ) ?? null;
}

export function getMode15ExclusivePartyItemsSync(
    playerId: number,
    category: number,
    groupId: number,
    slot: number | null = null,
): number[] {
    return runtime?.getMode15ExclusivePartyItemsSync?.(
        playerId, category, groupId, slot,
    ) ?? [];
}

export function getMode15ExclusiveGlobalPartyItemsSync(
    playerId: number,
    category: number,
    partyId: number,
): number[] {
    return runtime?.getMode15ExclusiveGlobalPartyItemsSync?.(
        playerId, category, partyId,
    ) ?? [];
}

export function shouldUnlockMode15PlayedParties(eventId: number): boolean {
    return runtime !== null
        && eventId === MODE15_RUSH_EVENT_ID
        && process.env.MODE15_ALLOW_CHARACTER_REUSE === "true";
}

/**
 * Multiplayer boundary stages advance the Fantasy Gauntlet run without
 * consuming characters regardless of the local all-stage reuse switch.  The
 * stored party row is still required as a safe completion marker, so callers
 * should only hide its member ids when sending it to the client.
 */
export function shouldUnlockMode15MultiplayerPlayedParty(
    eventId: number,
    round: number,
): boolean {
    if (runtime === null || eventId !== MODE15_RUSH_EVENT_ID) return false;

    const stage = Math.abs(Math.trunc(round)) % 1000;
    return stage === 5 || stage === 10 || stage === 15;
}
