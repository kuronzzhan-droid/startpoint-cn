"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlayerTimeOffsetSync = exports.resolvePlayerIdSync = exports.removeDeletedAccountsFromState = exports.removeDeletedAccountFromState = exports.saveAccountDefaultPlayer = exports.getAccountDefaultPlayer = exports.restoreTimeOffset = exports.saveTimeOffset = exports.setSelectedAccountId = exports.getSelectedAccountId = exports.setActivePlayerId = exports.getAdminPlayerSelectionState = exports.getActivePlayerId = void 0;
const file_exists_1 = require("../lib/file-exists");
const cached_statement_1 = require("../lib/cached-statement");
/**
 * Web 面板状态管理：当前活跃存档。
 * 持久化到 .database/active_account.json
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const utils_1 = require("../utils");
const account_1 = require("./domains/account");
const STATE_DIRECTORY = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, "..", "..", ".database");
const STATE_FILE = path.join(STATE_DIRECTORY, "active_account.json");
let cachedState = null;
function readState() {
    var _a, _b, _c, _d, _e;
    if (cachedState !== null)
        return cachedState;
    try {
        if ((0, file_exists_1.existsSync)(STATE_FILE)) {
            const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
            cachedState = {
                activePlayerId: (_a = raw.activePlayerId) !== null && _a !== void 0 ? _a : null,
                selectedAccountId: (_b = raw.selectedAccountId) !== null && _b !== void 0 ? _b : null,
                timeOffset: (_c = raw.timeOffset) !== null && _c !== void 0 ? _c : null,
                lastSetTime: (_d = raw.lastSetTime) !== null && _d !== void 0 ? _d : null,
                defaultPlayers: (_e = raw.defaultPlayers) !== null && _e !== void 0 ? _e : {},
            };
            return cachedState;
        }
    }
    catch ( /* ignore corrupt file */_f) { /* ignore corrupt file */ }
    cachedState = {
        activePlayerId: null,
        selectedAccountId: null,
        timeOffset: null,
        lastSetTime: null,
        defaultPlayers: {},
    };
    return cachedState;
}
function mutableState() {
    const state = readState();
    return Object.assign(Object.assign({}, state), { defaultPlayers: Object.assign({}, state.defaultPlayers) });
}
function writeState(state) {
    const dir = path.dirname(STATE_FILE);
    if (!(0, file_exists_1.existsSync)(dir))
        fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    cachedState = state;
}
function getActivePlayerId() {
    return readState().activePlayerId;
}
exports.getActivePlayerId = getActivePlayerId;
/**
 * Reads the management-panel player selection state once for batch overviews.
 */
function getAdminPlayerSelectionState() {
    const state = readState();
    return Object.freeze({
        activePlayerId: state.activePlayerId,
        defaultPlayers: Object.freeze(Object.assign({}, state.defaultPlayers)),
    });
}
exports.getAdminPlayerSelectionState = getAdminPlayerSelectionState;
function setActivePlayerId(id) {
    const state = mutableState();
    state.activePlayerId = id;
    writeState(state);
}
exports.setActivePlayerId = setActivePlayerId;
function getSelectedAccountId() {
    return readState().selectedAccountId;
}
exports.getSelectedAccountId = getSelectedAccountId;
function setSelectedAccountId(id) {
    const state = mutableState();
    state.selectedAccountId = id;
    writeState(state);
}
exports.setSelectedAccountId = setSelectedAccountId;
/**
 * Saves the global virtual-time offset from the Web panel.
 *
 * Player rows deliberately keep their previous offset until their next load.
 * That old value is needed to rebase timestamped save data without turning a
 * virtual-clock jump into elapsed EXP-pool time.
 */
function saveTimeOffset(offset) {
    const state = mutableState();
    state.timeOffset = offset;
    state.lastSetTime = offset !== null ? new Date(Date.now() + offset).toISOString() : null;
    writeState(state);
}
exports.saveTimeOffset = saveTimeOffset;
/**
 * Restore time offset on server startup.
 * Uses saved offset, or defaults to 2024-08-14 12:00 UTC if not set.
 */
function restoreTimeOffset() {
    const state = mutableState();
    if (state.timeOffset !== null) {
        (0, utils_1.setServerTimeOffset)(state.timeOffset);
    }
    else {
        const defaultDate = new Date("2024-08-14T12:00:00Z");
        const offset = defaultDate.getTime() - Date.now();
        state.timeOffset = offset;
        state.lastSetTime = defaultDate.toISOString();
        writeState(state);
        (0, utils_1.setServerTimeOffset)(offset);
    }
}
exports.restoreTimeOffset = restoreTimeOffset;
/**
 * Get the default player ID for a specific account.
 * Falls back to null if no default is set.
 */
function getAccountDefaultPlayer(accountId) {
    var _a;
    const state = readState();
    return (_a = state.defaultPlayers[accountId]) !== null && _a !== void 0 ? _a : null;
}
exports.getAccountDefaultPlayer = getAccountDefaultPlayer;
/**
 * Save the default player ID for a specific account.
 */
function saveAccountDefaultPlayer(accountId, playerId) {
    const state = mutableState();
    state.defaultPlayers[accountId] = playerId;
    writeState(state);
}
exports.saveAccountDefaultPlayer = saveAccountDefaultPlayer;
/**
 * Removes all persisted management-panel references to a deleted account.
 */
function removeDeletedAccountFromState(accountId, playerIds) {
    removeDeletedAccountsFromState([{ accountId, playerIds }]);
}
exports.removeDeletedAccountFromState = removeDeletedAccountFromState;
/**
 * Removes persisted references for a cleanup batch using one atomic state write.
 */
function removeDeletedAccountsFromState(entries) {
    if (entries.length === 0)
        return;
    const state = mutableState();
    for (const { accountId, playerIds } of entries) {
        delete state.defaultPlayers[accountId];
        if (state.selectedAccountId === accountId)
            state.selectedAccountId = null;
        if (state.activePlayerId !== null && playerIds.includes(state.activePlayerId)) {
            state.activePlayerId = null;
        }
    }
    writeState(state);
}
exports.removeDeletedAccountsFromState = removeDeletedAccountsFromState;
/**
 * Resolves the active player ID for an account.
 * Uses per-account defaultPlayers, falls back to first player.
 * Returns null if the account has no players.
 */
function resolvePlayerIdSync(accountId) {
    var _a;
    const state = readState();
    return (0, account_1.resolveAccountPlayerIdSync)(accountId, (_a = state.defaultPlayers[accountId]) !== null && _a !== void 0 ? _a : null);
}
exports.resolvePlayerIdSync = resolvePlayerIdSync;
/**
 * Returns the per-player time_offset, or null if not set.
 */
function getPlayerTimeOffsetSync(playerId) {
    var _a;
    try {
        const { getDb } = require("./db");
        const row = (0, cached_statement_1.cachedStatement)(getDb(), `SELECT time_offset FROM players WHERE id = ?`).get(playerId);
        return (_a = row === null || row === void 0 ? void 0 : row.time_offset) !== null && _a !== void 0 ? _a : null;
    }
    catch (_b) {
        return null;
    }
}
exports.getPlayerTimeOffsetSync = getPlayerTimeOffsetSync;
