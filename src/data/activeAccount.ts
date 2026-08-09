/**
 * Web 面板状态管理：当前活跃存档。
 * 持久化到 .database/active_account.json
 */
import * as fs from "fs";
import * as path from "path";
import { setServerTimeOffset } from "../utils";
import { getAccountPlayersSync } from "./domains/account";

const STATE_DIRECTORY = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, "..", "..", ".database");
const STATE_FILE = path.join(STATE_DIRECTORY, "active_account.json");

interface WebState {
    activePlayerId: number | null;
    selectedAccountId: number | null;
    timeOffset: number | null;
    lastSetTime: string | null;
    defaultPlayers: Record<number, number>;
}

function readState(): WebState {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
            return {
                activePlayerId: raw.activePlayerId ?? null,
                selectedAccountId: raw.selectedAccountId ?? null,
                timeOffset: raw.timeOffset ?? null,
                lastSetTime: raw.lastSetTime ?? null,
                defaultPlayers: raw.defaultPlayers ?? {},
            };
        }
    } catch { /* ignore corrupt file */ }
    return { activePlayerId: null, selectedAccountId: null, timeOffset: null, lastSetTime: null, defaultPlayers: {} };
}

function writeState(state: WebState): void {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

export function getActivePlayerId(): number | null {
    return readState().activePlayerId;
}

export function setActivePlayerId(id: number | null): void {
    const state = readState();
    state.activePlayerId = id;
    writeState(state);
}

export function getSelectedAccountId(): number | null {
    return readState().selectedAccountId;
}

export function setSelectedAccountId(id: number | null): void {
    const state = readState();
    state.selectedAccountId = id;
    writeState(state);
}

/**
 * Save time offset from Web panel, also updates active player's time_offset.
 */
export function saveTimeOffset(offset: number | null): void {
    const state = readState();
    state.timeOffset = offset;
    state.lastSetTime = offset !== null ? new Date(Date.now() + offset).toISOString() : null;
    writeState(state);

    // Also persist to current active player
    const pid = state.activePlayerId;
    if (pid) {
        try {
            const { getDb } = require("./db");
            getDb().prepare(`UPDATE players SET time_offset = ? WHERE id = ?`).run(offset, pid);
        } catch {}
    }
}

/**
 * Restore time offset on server startup.
 * Uses saved offset, or defaults to 2024-08-14 12:00 UTC if not set.
 */
export function restoreTimeOffset(): void {
    const state = readState();
    if (state.timeOffset !== null) {
        setServerTimeOffset(state.timeOffset);
    } else {
        const defaultDate = new Date("2024-08-14T12:00:00Z");
        const offset = defaultDate.getTime() - Date.now();
        state.timeOffset = offset;
        state.lastSetTime = defaultDate.toISOString();
        writeState(state);
        setServerTimeOffset(offset);
    }
}

/**
 * Get the default player ID for a specific account.
 * Falls back to null if no default is set.
 */
export function getAccountDefaultPlayer(accountId: number): number | null {
    const state = readState();
    return state.defaultPlayers[accountId] ?? null;
}

/**
 * Save the default player ID for a specific account.
 */
export function saveAccountDefaultPlayer(accountId: number, playerId: number): void {
    const state = readState();
    state.defaultPlayers[accountId] = playerId;
    writeState(state);
}

/**
 * Removes all persisted management-panel references to a deleted account.
 */
export function removeDeletedAccountFromState(accountId: number, playerIds: number[]): void {
    removeDeletedAccountsFromState([{ accountId, playerIds }]);
}

/**
 * Removes persisted references for a cleanup batch using one atomic state write.
 */
export function removeDeletedAccountsFromState(
    entries: { accountId: number; playerIds: number[] }[]
): void {
    if (entries.length === 0) return;
    const state = readState();
    for (const { accountId, playerIds } of entries) {
        delete state.defaultPlayers[accountId];
        if (state.selectedAccountId === accountId) state.selectedAccountId = null;
        if (state.activePlayerId !== null && playerIds.includes(state.activePlayerId)) {
            state.activePlayerId = null;
        }
    }
    writeState(state);
}

/**
 * Resolves the active player ID for an account.
 * Uses per-account defaultPlayers, falls back to first player.
 * Returns null if the account has no players.
 */
export function resolvePlayerIdSync(accountId: number): number | null {
    const playerIds = getAccountPlayersSync(accountId);
    if (!playerIds.length) return null;
    const state = readState();
    const preferredId = state.defaultPlayers[accountId];
    return (preferredId && playerIds.includes(preferredId)) ? preferredId : playerIds[0];
}

/**
 * Returns the per-player time_offset, or null if not set.
 */
export function getPlayerTimeOffsetSync(playerId: number): number | null {
    try {
        const { getDb } = require("./db");
        const row = getDb().prepare(
            `SELECT time_offset FROM players WHERE id = ?`
        ).get(playerId) as { time_offset: number | null } | undefined;
        return row?.time_offset ?? null;
    } catch {
        return null;
    }
}
