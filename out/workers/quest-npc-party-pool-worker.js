"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
const public_payload_1 = require("../lib/weapon-riven/public-payload");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const cached_statement_1 = require("../lib/cached-statement");
const memory_diagnostics_1 = require("../lib/memory-diagnostics");
const sqlite_diagnostics_1 = require("../lib/sqlite-diagnostics");
const quest_party_pool_shared_1 = require("../multi/npc/quest-party-pool-shared");
const databaseDirectory = process.env.DATA_DIR
    ? path_1.default.resolve(process.env.DATA_DIR)
    : path_1.default.resolve(process.cwd(), ".database");
(0, fs_1.mkdirSync)(databaseDirectory, { recursive: true });
const db = new better_sqlite3_1.default(path_1.default.join(databaseDirectory, "quest_ai_party_pool.db"));
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");
(0, sqlite_diagnostics_1.observeSqliteDatabase)(db, "npc");
db.exec(`
    CREATE TABLE IF NOT EXISTS quest_npc_party_pool (
        quest_category INTEGER NOT NULL,
        quest_id INTEGER NOT NULL,
        source_player_id INTEGER NOT NULL,
        party_slot INTEGER NOT NULL,
        battle_power INTEGER NOT NULL,
        party_element INTEGER,
        party_payload TEXT NOT NULL,
        cleared_at INTEGER NOT NULL,
        PRIMARY KEY (quest_category, quest_id, source_player_id)
    );
    CREATE INDEX IF NOT EXISTS idx_quest_ai_party_pool_power
        ON quest_npc_party_pool (quest_category, quest_id, battle_power DESC, cleared_at DESC);
    CREATE INDEX IF NOT EXISTS idx_quest_ai_party_pool_recent
        ON quest_npc_party_pool (quest_category, quest_id, cleared_at DESC);
    CREATE INDEX IF NOT EXISTS idx_quest_ai_party_pool_source_player
        ON quest_npc_party_pool (source_player_id);
`);
function send(message) {
    worker_threads_1.parentPort === null || worker_threads_1.parentPort === void 0 ? void 0 : worker_threads_1.parentPort.postMessage(message);
}
let revision = 0, pendingOperations = 0, records = 0, publishedEntries = 0, fullRefreshes = 0;
let snapshotAck = null;
(0, memory_diagnostics_1.installWorkerMemoryProbe)(() => ({ pendingOperations, records, publishedEntries, fullRefreshes, revision }));
function hasCompleteMainCharacters(party) {
    return Array.isArray(party === null || party === void 0 ? void 0 : party.characters)
        && party.characters.length >= 3
        && party.characters.slice(0, 3).every((entry) => { var _a; return Array.isArray(entry) && entry[0] === 0 && ((_a = entry[1]) === null || _a === void 0 ? void 0 : _a.id); });
}
function parseRow(row) {
    try {
        const party = (0, public_payload_1.stripWeaponRivenPublicPayload)(JSON.parse(row.party_payload));
        if (!hasCompleteMainCharacters(party))
            return null;
        return {
            questCategory: row.quest_category,
            questId: row.quest_id,
            sourcePlayerId: row.source_player_id,
            partySlot: row.party_slot,
            battlePower: row.battle_power,
            partyElement: row.party_element,
            clearedAt: row.cleared_at,
            party,
        };
    }
    catch (_a) {
        return null;
    }
}
function loadQuest(category, questId) {
    const rows = (0, cached_statement_1.cachedStatement)(db, `
        SELECT quest_category, quest_id, source_player_id, party_slot, battle_power,
               party_element, party_payload, cleared_at
        FROM quest_npc_party_pool
        WHERE quest_category = ? AND quest_id = ?
    `).all(category, questId);
    return rows.map(parseRow).filter((entry) => entry !== null);
}
function publishQuest(category, questId) {
    const entries = loadQuest(category, questId);
    publishedEntries += entries.length;
    send({
        type: "quest_snapshot",
        revision: ++revision,
        key: (0, quest_party_pool_shared_1.getQuestNpcPartyPoolKey)(category, questId),
        entries,
    });
}
function publishAll() {
    return __awaiter(this, void 0, void 0, function* () {
        const quests = (0, cached_statement_1.cachedStatement)(db, `SELECT DISTINCT quest_category, quest_id FROM quest_npc_party_pool`).all();
        send({ type: "snapshot_begin", revision: ++revision });
        for (const quest of quests) {
            // Apply the current retention policy to existing data on startup/reload,
            // rather than waiting for another clear of this particular quest.
            pruneQuest(quest.quest_category, quest.quest_id);
            // One quest in transit at a time; do not clone the entire database.
            yield new Promise((resolve, reject) => {
                const timer = setTimeout(() => { snapshotAck = null; reject(new Error("NPC snapshot acknowledgement timed out")); }, 30000);
                snapshotAck = { revision: revision + 1, resolve: () => { clearTimeout(timer); resolve(); } };
                try {
                    publishQuest(quest.quest_category, quest.quest_id);
                }
                catch (error) {
                    clearTimeout(timer);
                    snapshotAck = null;
                    reject(error);
                }
            });
        }
        send({ type: "snapshot_end", revision: ++revision });
        fullRefreshes++;
    });
}
function pruneQuest(category, questId) {
    const rows = (0, cached_statement_1.cachedStatement)(db, `
        SELECT source_player_id, battle_power, cleared_at
        FROM quest_npc_party_pool
        WHERE quest_category = ? AND quest_id = ?
    `).all(category, questId);
    const keep = new Set((0, quest_party_pool_shared_1.selectQuestNpcPartySourceIds)(rows.map(row => ({
        sourcePlayerId: row.source_player_id,
        battlePower: row.battle_power,
        clearedAt: row.cleared_at,
    }))));
    if (keep.size >= rows.length)
        return [];
    const remove = rows.filter(row => !keep.has(row.source_player_id));
    const statement = (0, cached_statement_1.cachedStatement)(db, `
        DELETE FROM quest_npc_party_pool
        WHERE quest_category = ? AND quest_id = ? AND source_player_id = ?
    `);
    db.transaction(() => {
        for (const row of remove)
            statement.run(category, questId, row.source_player_id);
    })();
    return remove.map(row => row.source_player_id);
}
function recordClear(message) {
    var _a;
    const snapshot = message.snapshot ? (0, public_payload_1.stripWeaponRivenPublicPayload)(message.snapshot) : null;
    if (!snapshot || !hasCompleteMainCharacters(snapshot.party))
        return;
    (0, cached_statement_1.cachedStatement)(db, `
        INSERT INTO quest_npc_party_pool (
            quest_category, quest_id, source_player_id, party_slot, battle_power,
            party_element, party_payload, cleared_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (quest_category, quest_id, source_player_id) DO UPDATE SET
            party_slot = excluded.party_slot,
            battle_power = excluded.battle_power,
            party_element = excluded.party_element,
            party_payload = excluded.party_payload,
            cleared_at = excluded.cleared_at
    `).run(snapshot.questCategory, snapshot.questId, snapshot.sourcePlayerId, snapshot.partySlot, snapshot.battlePower, snapshot.partyElement, JSON.stringify(snapshot.party), snapshot.clearedAt);
    const removedPlayerIds = pruneQuest(snapshot.questCategory, snapshot.questId);
    records++;
    if (/^(0|false|no|off)$/i.test((_a = process.env.NPC_INCREMENTAL_UPDATES) !== null && _a !== void 0 ? _a : "true")) {
        publishQuest(snapshot.questCategory, snapshot.questId);
    }
    else {
        const entry = removedPlayerIds.includes(snapshot.sourcePlayerId) ? null : snapshot;
        publishedEntries += entry ? 1 : 0;
        send({ type: "quest_delta", revision: ++revision,
            key: (0, quest_party_pool_shared_1.getQuestNpcPartyPoolKey)(snapshot.questCategory, snapshot.questId), entry, removedPlayerIds });
    }
}
function removePlayers(message) {
    const playerIds = [...new Set(message.playerIds
            .map(playerId => Math.trunc(Number(playerId)))
            .filter(playerId => Number.isSafeInteger(playerId) && playerId > 0))];
    if (playerIds.length === 0) {
        send({
            type: "remove_players_result",
            requestId: message.requestId,
            removedRows: 0,
            affectedQuestCount: 0,
        });
        return;
    }
    const affectedQuests = new Map();
    let removedRows = 0;
    db.transaction(() => {
        for (let offset = 0; offset < playerIds.length; offset += 500) {
            const batch = playerIds.slice(offset, offset + 500);
            const placeholders = batch.map(() => "?").join(", ");
            const rows = (0, cached_statement_1.cachedStatement)(db, `
                SELECT DISTINCT quest_category, quest_id
                FROM quest_npc_party_pool
                WHERE source_player_id IN (${placeholders})
            `).all(...batch);
            for (const row of rows) {
                affectedQuests.set((0, quest_party_pool_shared_1.getQuestNpcPartyPoolKey)(row.quest_category, row.quest_id), { questCategory: row.quest_category, questId: row.quest_id });
            }
            removedRows += (0, cached_statement_1.cachedStatement)(db, `
                DELETE FROM quest_npc_party_pool
                WHERE source_player_id IN (${placeholders})
            `).run(...batch).changes;
        }
    })();
    for (const quest of affectedQuests.values()) {
        publishQuest(quest.questCategory, quest.questId);
    }
    send({
        type: "remove_players_result",
        requestId: message.requestId,
        removedRows,
        affectedQuestCount: affectedQuests.size,
    });
}
let operations;
worker_threads_1.parentPort === null || worker_threads_1.parentPort === void 0 ? void 0 : worker_threads_1.parentPort.on("message", (message) => {
    if (message.type === "memory_probe")
        return;
    if (message.type === "snapshot_ack") {
        if ((snapshotAck === null || snapshotAck === void 0 ? void 0 : snapshotAck.revision) === message.revision) {
            snapshotAck.resolve();
            snapshotAck = null;
        }
        return;
    }
    pendingOperations++;
    operations = operations.then(() => __awaiter(void 0, void 0, void 0, function* () {
        if (message.type === "record")
            recordClear(message);
        else if (message.type === "reload") {
            yield publishAll();
            send({ type: "ready" });
        }
        else if (message.type === "remove_players")
            removePlayers(message);
        else if (message.type === "stop")
            process.exit(0);
    })).catch(error => {
        send({
            type: "operation_error",
            operation: message.type,
            requestId: "requestId" in message ? message.requestId : undefined,
            error: error instanceof Error ? error.message : String(error),
        });
    }).finally(() => {
        pendingOperations--;
        if (message.type === "record")
            send({ type: "record_done" });
    });
});
operations = publishAll().then(() => { send({ type: "ready" }); }).catch(error => {
    send({ type: "operation_error", operation: "reload", error: String(error) });
});
