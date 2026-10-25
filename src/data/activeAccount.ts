import { existsSync } from "../lib/file-exists";
import { cachedStatement } from "../lib/cached-statement";
/**
 * Web 面板状态管理：当前活跃存档。
 * 持久化到 .database/active_account.json
 */
import * as fs from "fs";
import * as path from "path";
import { getServerClockSnapshot, setServerTimeOffset } from "../utils";
import type { Database } from "better-sqlite3";
import { restoreServerClockStateSync } from "../lib/server-clock-state";
import { resolveAccountPlayerIdSync } from "./domains/account";
import { jsonFileIdentitySync, readValidatedJsonWithBackupSync, writeJsonAtomicSync } from "../lib/atomic-json-file";

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

let cachedState: WebState | null = null;
let cachedIdentity: string | null = null;

function validateState(value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("选档状态不是有效对象");
    const state = value as Partial<WebState>;
    const id = (value: unknown) => value === undefined || value === null || (Number.isSafeInteger(value) && Number(value) > 0);
    if (!id(state.activePlayerId) || !id(state.selectedAccountId)
        || (state.timeOffset !== undefined && state.timeOffset !== null && !Number.isSafeInteger(state.timeOffset))
        || (state.lastSetTime !== undefined && state.lastSetTime !== null
            && (typeof state.lastSetTime !== "string" || !Number.isFinite(Date.parse(state.lastSetTime))))) {
        throw new Error("选档状态的 ID 或时间字段无效");
    }
    const defaults = state.defaultPlayers;
    if (defaults !== undefined && defaults !== null && (typeof defaults !== "object" || Array.isArray(defaults)
        || Object.entries(defaults).some(([account, player]) => !/^[1-9]\d*$/.test(account)
            || !Number.isSafeInteger(Number(account)) || !Number.isSafeInteger(player) || player <= 0))) {
        throw new Error("选档状态的账号默认存档映射无效");
    }
}

function readState(): WebState {
    // Game/login lookups keep the existing in-memory fast path. Disk identity
    // is checked before mutations; a new process always validates both files.
    if (cachedState !== null) return cachedState;
    try {
        const identity = jsonFileIdentitySync(STATE_FILE);
        const result = readValidatedJsonWithBackupSync<Partial<WebState>>(STATE_FILE, validateState);
        const raw = result.source === "absent" ? {} : result.value;
        cachedState = {
            activePlayerId: raw.activePlayerId ?? null,
            selectedAccountId: raw.selectedAccountId ?? null,
            timeOffset: raw.timeOffset ?? null,
            lastSetTime: raw.lastSetTime ?? null,
            defaultPlayers: { ...raw.defaultPlayers },
        };
        cachedIdentity = identity;
        if (result.source === "backup") console.warn("[STATE] 选档主文件不可用，已读取有效备份；未自动覆盖主文件。");
        return cachedState;
    } catch (error) {
        // A previously cached selection must not hide broken on-disk state or
        // later overwrite it as though a fresh empty configuration was read.
        cachedState = null;
        cachedIdentity = null;
        throw error;
    }
}

function mutableState(): WebState {
    try {
        if (cachedIdentity !== jsonFileIdentitySync(STATE_FILE)) {
            cachedState = null;
            cachedIdentity = null;
        }
    } catch (error) {
        cachedState = null;
        cachedIdentity = null;
        throw error;
    }
    const state = readState();
    return { ...state, defaultPlayers: { ...state.defaultPlayers } };
}

function writeState(state: WebState): void {
    validateState(state);
    if (cachedIdentity !== jsonFileIdentitySync(STATE_FILE)) throw new Error("选档文件已变化，请重新读取后重试");
    const dir = path.dirname(STATE_FILE);
    if (!existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    writeJsonAtomicSync(STATE_FILE, state, { validate: validateState });
    cachedState = state;
    cachedIdentity = jsonFileIdentitySync(STATE_FILE);
}

export function getActivePlayerId(): number | null {
    return readState().activePlayerId;
}

export interface AdminPlayerSelectionState {
    readonly activePlayerId: number | null;
    readonly defaultPlayers: Readonly<Record<number, number>>;
}

/**
 * Reads the management-panel player selection state once for batch overviews.
 */
export function getAdminPlayerSelectionState(): AdminPlayerSelectionState {
    const state = readState();
    return Object.freeze({
        activePlayerId: state.activePlayerId,
        defaultPlayers: Object.freeze({ ...state.defaultPlayers }),
    });
}

export function setActivePlayerId(id: number | null): void {
    const state = mutableState();
    state.activePlayerId = id;
    writeState(state);
}

/** The panel selection and the account's login selection are one sidecar commit. */
export function activatePlayerSave(accountId: number | null, playerId: number): void {
    const state = mutableState();
    state.activePlayerId = playerId;
    if (accountId !== null) state.defaultPlayers[accountId] = playerId;
    writeState(state);
}

export function getSelectedAccountId(): number | null {
    return readState().selectedAccountId;
}

export function setSelectedAccountId(id: number | null): void {
    const state = mutableState();
    state.selectedAccountId = id;
    writeState(state);
}

/**
 * Saves the global virtual-time offset from the Web panel.
 *
 * Player rows deliberately keep their previous offset until their next load.
 * That old value is needed to rebase timestamped save data without turning a
 * virtual-clock jump into elapsed EXP-pool time.
 */
export function saveTimeOffset(offset: number | null): void {
    if (getServerClockSnapshot().mode === "real") throw new Error("Persisted real clock rejects virtual-time reset");
    if (offset !== null && !Number.isSafeInteger(offset)) throw new Error("Invalid server clock offset");
    const state = mutableState();
    state.timeOffset = offset;
    state.lastSetTime = offset !== null ? new Date(Date.now() + offset).toISOString() : null;
    writeState(state);
}

/**
 * Restore time offset on server startup.
 * Uses saved offset, or defaults to 2024-08-14 12:00 UTC if not set.
 */
export function restoreTimeOffset(db?: Database): void {
    // This read-only lookup precedes legacy JSON/default handling. A present
    // invalid singleton throws, so neither the legacy file nor 2024 fallback
    // can silently replace a persisted real clock after restart.
    const connection: Database = db ?? require("./db").getDb();
    if (restoreServerClockStateSync(connection)) return;
    const state = mutableState();
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
    const state = mutableState();
    state.defaultPlayers[accountId] = playerId;
    writeState(state);
}

/**
 * Removes all persisted management-panel references to a deleted account.
 */
export function removeDeletedAccountFromState(accountId: number, playerIds: number[]): void {
    removeDeletedAccountsFromState([{ accountId, playerIds }]);
}

/** Update both references to a deleted save together, retaining other accounts. */
export function removeDeletedPlayerFromState(accountId: number | null, playerId: number, replacementId: number | null): void {
    const state = mutableState();
    if (accountId !== null && state.defaultPlayers[accountId] === playerId) {
        if (replacementId === null) delete state.defaultPlayers[accountId];
        else state.defaultPlayers[accountId] = replacementId;
    }
    if (state.activePlayerId === playerId) state.activePlayerId = null;
    writeState(state);
}

/**
 * Removes persisted references for a cleanup batch using one atomic state write.
 */
export function removeDeletedAccountsFromState(
    entries: { accountId: number; playerIds: number[] }[]
): void {
    if (entries.length === 0) return;
    const state = mutableState();
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
    const state = readState();
    return resolveAccountPlayerIdSync(accountId, state.defaultPlayers[accountId] ?? null);
}

/**
 * Returns the per-player time_offset, or null if not set.
 */
export function getPlayerTimeOffsetSync(playerId: number): number | null {
    try {
        const { getDb } = require("./db");
        const row = cachedStatement(getDb(),
            `SELECT time_offset FROM players WHERE id = ?`
        ).get(playerId) as { time_offset: number | null } | undefined;
        return row?.time_offset ?? null;
    } catch {
        return null;
    }
}
