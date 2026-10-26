import { getDb } from "../db";
import { PlayerActiveQuest, RawPlayerActiveQuest } from "../types";
import { BATTLE_CLOCK_VERSION, isClockAbortedPlaySync } from "../../lib/battle-clock-compatibility";
import { decodeBattleRoster } from "../../lib/quest/battle-roster";

function buildActiveQuest(raw: RawPlayerActiveQuest): PlayerActiveQuest {
    return {
        playerId: raw.player_id,
        playId: raw.play_id,
        questId: raw.quest_id,
        category: raw.category,
        useBossBoostPoint: raw.use_boss_boost_point === 1,
        useBoostPoint: raw.use_boost_point === 1,
        isAutoStartMode: raw.is_auto_start_mode === 1,
        isMulti: raw.is_multi === 1,
        isMultiHost: raw.is_multi_host === 1,
        roomNumber: raw.room_number,
        entryItemId: raw.entry_item_id,
        eventId: raw.event_id,
        continueCount: raw.continue_count,
        startedAtMs: raw.started_at_ms,
        partySlot: raw.party_slot,
        questTimeRevision: raw.quest_time_revision ?? null,
        clockVersion: raw.clock_version ?? 0,
        battleRoster: decodeBattleRoster(raw.battle_roster_json),
    }
}

export function getPlayerActiveQuestSync(playerId: number): PlayerActiveQuest | null {
    const raw = getDb().prepare(`
        SELECT * FROM players_active_quests WHERE player_id = ?
    `).get(playerId) as RawPlayerActiveQuest | undefined
    return raw ? buildActiveQuest(raw) : null
}

export function insertPlayerActiveQuestSync(playerId: number, quest: PlayerActiveQuest): void {
    if (isClockAbortedPlaySync(getDb(), playerId, quest.playId)) {
        throw new Error("This play id was terminated during clock migration.")
    }
    getDb().prepare(`
        INSERT OR REPLACE INTO players_active_quests
            (player_id, play_id, quest_id, category, use_boss_boost_point,
             use_boost_point, is_auto_start_mode, is_multi, room_number,
             is_multi_host, entry_item_id, event_id, continue_count, started_at_ms, party_slot, quest_time_revision, clock_version, battle_roster_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        playerId, quest.playId, quest.questId, quest.category,
        quest.useBossBoostPoint ? 1 : 0, quest.useBoostPoint ? 1 : 0,
        quest.isAutoStartMode ? 1 : 0, quest.isMulti ? 1 : 0,
        quest.roomNumber ?? null, quest.isMultiHost ? 1 : 0,
        quest.entryItemId ?? null,
        quest.eventId ?? null, quest.continueCount, quest.startedAtMs,
        quest.partySlot ?? null, quest.questTimeRevision ?? null, BATTLE_CLOCK_VERSION,
        quest.battleRoster ? JSON.stringify(quest.battleRoster) : null
    )
}

export function deletePlayerActiveQuestSync(playerId: number): void {
    getDb().prepare(`DELETE FROM players_active_quests WHERE player_id = ?`).run(playerId)
}

export function deletePlayerActiveQuestIfPlayIdSync(
    playerId: number,
    expectedPlayId: string,
): boolean {
    return getDb().prepare(`
        DELETE FROM players_active_quests
        WHERE player_id = ? AND play_id = ?
    `).run(playerId, expectedPlayId).changes === 1
}

export function updatePlayerActiveQuestContinueCountSync(playerId: number, continueCount: number): void {
    getDb().prepare(`
        UPDATE players_active_quests SET continue_count = ? WHERE player_id = ?
    `).run(continueCount, playerId)
}

export function updatePlayerActiveQuestContinueCountIfPlayIdSync(
    playerId: number,
    expectedPlayId: string,
    continueCount: number,
): boolean {
    return getDb().prepare(`
        UPDATE players_active_quests
        SET continue_count = ?
        WHERE player_id = ? AND play_id = ?
    `).run(continueCount, playerId, expectedPlayId).changes === 1
}
