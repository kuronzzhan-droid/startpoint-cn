import { parentPort } from "worker_threads"
import Database from "better-sqlite3"
import { mkdirSync } from "fs"
import path from "path"
import { cachedStatement } from "../lib/cached-statement"
import { installWorkerMemoryProbe } from "../lib/memory-diagnostics"
import { observeSqliteDatabase } from "../lib/sqlite-diagnostics"
import {
    getQuestNpcPartyPoolKey,
    QuestNpcPartySnapshot,
    selectQuestNpcPartySourceIds,
} from "../multi/npc/quest-party-pool-shared"

interface PoolRow {
    quest_category: number
    quest_id: number
    source_player_id: number
    party_slot: number
    battle_power: number
    party_element: number | null
    party_payload: string
    cleared_at: number
}

interface RecordMessage {
    type: "record"
    snapshot: QuestNpcPartySnapshot
}

interface ReloadMessage { type: "reload" }
interface RemovePlayersMessage {
    type: "remove_players"
    requestId: number
    playerIds: number[]
}
interface StopMessage { type: "stop" }
interface SnapshotAck { type: "snapshot_ack"; revision: number }
type WorkerMessage = RecordMessage | ReloadMessage | RemovePlayersMessage | StopMessage | SnapshotAck | { type: "memory_probe" }

const databaseDirectory = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(process.cwd(), ".database")
mkdirSync(databaseDirectory, { recursive: true })
const db = new Database(path.join(databaseDirectory, "quest_ai_party_pool.db"))
db.pragma("journal_mode = WAL")
db.pragma("synchronous = NORMAL")
db.pragma("busy_timeout = 5000")
observeSqliteDatabase(db, "npc")
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
`)

function send(message: Record<string, unknown>): void {
    parentPort?.postMessage(message)
}
let revision = 0, pendingOperations = 0, records = 0, publishedEntries = 0, fullRefreshes = 0
let snapshotAck: { revision: number; resolve: () => void } | null = null
installWorkerMemoryProbe(() => ({ pendingOperations, records, publishedEntries, fullRefreshes, revision }))

function hasCompleteMainCharacters(party: any): boolean {
    return Array.isArray(party?.characters)
        && party.characters.length >= 3
        && party.characters.slice(0, 3).every((entry: any) =>
            Array.isArray(entry) && entry[0] === 0 && entry[1]?.id,
        )
}

function parseRow(row: PoolRow): QuestNpcPartySnapshot | null {
    try {
        const party = JSON.parse(row.party_payload)
        if (!hasCompleteMainCharacters(party)) return null
        return {
            questCategory: row.quest_category,
            questId: row.quest_id,
            sourcePlayerId: row.source_player_id,
            partySlot: row.party_slot,
            battlePower: row.battle_power,
            partyElement: row.party_element,
            clearedAt: row.cleared_at,
            party,
        }
    } catch {
        return null
    }
}

function loadQuest(category: number, questId: number): QuestNpcPartySnapshot[] {
    const rows = cachedStatement(db, `
        SELECT quest_category, quest_id, source_player_id, party_slot, battle_power,
               party_element, party_payload, cleared_at
        FROM quest_npc_party_pool
        WHERE quest_category = ? AND quest_id = ?
    `).all(category, questId) as PoolRow[]
    return rows.map(parseRow).filter((entry): entry is QuestNpcPartySnapshot => entry !== null)
}

function publishQuest(category: number, questId: number): void {
    const entries = loadQuest(category, questId)
    publishedEntries += entries.length
    send({
        type: "quest_snapshot",
        revision: ++revision,
        key: getQuestNpcPartyPoolKey(category, questId),
        entries,
    })
}

async function publishAll(): Promise<void> {
    const quests = cachedStatement(db, `SELECT DISTINCT quest_category, quest_id FROM quest_npc_party_pool`).all() as PoolRow[]
    send({ type: "snapshot_begin", revision: ++revision })
    for (const quest of quests) {
        // Apply the current retention policy to existing data on startup/reload,
        // rather than waiting for another clear of this particular quest.
        pruneQuest(quest.quest_category, quest.quest_id)
        // One quest in transit at a time; do not clone the entire database.
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { snapshotAck = null; reject(new Error("NPC snapshot acknowledgement timed out")) }, 30_000)
            snapshotAck = { revision: revision + 1, resolve: () => { clearTimeout(timer); resolve() } }
            try { publishQuest(quest.quest_category, quest.quest_id) }
            catch (error) { clearTimeout(timer); snapshotAck = null; reject(error) }
        })
    }
    send({ type: "snapshot_end", revision: ++revision })
    fullRefreshes++
}

function pruneQuest(category: number, questId: number): number[] {
    const rows = cachedStatement(db, `
        SELECT source_player_id, battle_power, cleared_at
        FROM quest_npc_party_pool
        WHERE quest_category = ? AND quest_id = ?
    `).all(category, questId) as Array<{
        source_player_id: number
        battle_power: number
        cleared_at: number
    }>
    const keep = new Set(selectQuestNpcPartySourceIds(rows.map(row => ({
        sourcePlayerId: row.source_player_id,
        battlePower: row.battle_power,
        clearedAt: row.cleared_at,
    }))))
    if (keep.size >= rows.length) return []
    const remove = rows.filter(row => !keep.has(row.source_player_id))
    const statement = cachedStatement(db, `
        DELETE FROM quest_npc_party_pool
        WHERE quest_category = ? AND quest_id = ? AND source_player_id = ?
    `)
    db.transaction(() => {
        for (const row of remove) statement.run(category, questId, row.source_player_id)
    })()
    return remove.map(row => row.source_player_id)
}

function recordClear(message: RecordMessage): void {
    const snapshot = message.snapshot
    if (!snapshot || !hasCompleteMainCharacters(snapshot.party)) return
    cachedStatement(db, `
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
    `).run(
        snapshot.questCategory, snapshot.questId, snapshot.sourcePlayerId, snapshot.partySlot,
        snapshot.battlePower, snapshot.partyElement, JSON.stringify(snapshot.party), snapshot.clearedAt,
    )
    const removedPlayerIds = pruneQuest(snapshot.questCategory, snapshot.questId)
    records++
    if (/^(0|false|no|off)$/i.test(process.env.NPC_INCREMENTAL_UPDATES ?? "true")) {
        publishQuest(snapshot.questCategory, snapshot.questId)
    } else {
        const entry = removedPlayerIds.includes(snapshot.sourcePlayerId) ? null : snapshot
        publishedEntries += entry ? 1 : 0
        send({ type: "quest_delta", revision: ++revision,
            key: getQuestNpcPartyPoolKey(snapshot.questCategory, snapshot.questId), entry, removedPlayerIds })
    }
}

function removePlayers(message: RemovePlayersMessage): void {
    const playerIds = [...new Set(message.playerIds
        .map(playerId => Math.trunc(Number(playerId)))
        .filter(playerId => Number.isSafeInteger(playerId) && playerId > 0))]
    if (playerIds.length === 0) {
        send({
            type: "remove_players_result",
            requestId: message.requestId,
            removedRows: 0,
            affectedQuestCount: 0,
        })
        return
    }

    const affectedQuests = new Map<string, { questCategory: number; questId: number }>()
    let removedRows = 0
    db.transaction(() => {
        for (let offset = 0; offset < playerIds.length; offset += 500) {
            const batch = playerIds.slice(offset, offset + 500)
            const placeholders = batch.map(() => "?").join(", ")
            const rows = cachedStatement(db, `
                SELECT DISTINCT quest_category, quest_id
                FROM quest_npc_party_pool
                WHERE source_player_id IN (${placeholders})
            `).all(...batch) as Array<{ quest_category: number; quest_id: number }>
            for (const row of rows) {
                affectedQuests.set(
                    getQuestNpcPartyPoolKey(row.quest_category, row.quest_id),
                    { questCategory: row.quest_category, questId: row.quest_id },
                )
            }
            removedRows += cachedStatement(db, `
                DELETE FROM quest_npc_party_pool
                WHERE source_player_id IN (${placeholders})
            `).run(...batch).changes
        }
    })()

    for (const quest of affectedQuests.values()) {
        publishQuest(quest.questCategory, quest.questId)
    }
    send({
        type: "remove_players_result",
        requestId: message.requestId,
        removedRows,
        affectedQuestCount: affectedQuests.size,
    })
}

let operations: Promise<void>
parentPort?.on("message", (message: WorkerMessage) => {
    if (message.type === "memory_probe") return
    if (message.type === "snapshot_ack") {
        if (snapshotAck?.revision === message.revision) { snapshotAck.resolve(); snapshotAck = null }
        return
    }
    pendingOperations++
    operations = operations.then(async () => {
        if (message.type === "record") recordClear(message)
        else if (message.type === "reload") { await publishAll(); send({ type: "ready" }) }
        else if (message.type === "remove_players") removePlayers(message)
        else if (message.type === "stop") process.exit(0)
    }).catch(error => {
        send({
            type: "operation_error",
            operation: message.type,
            requestId: "requestId" in message ? message.requestId : undefined,
            error: error instanceof Error ? error.message : String(error),
        })
    }).finally(() => {
        pendingOperations--
        if (message.type === "record") send({ type: "record_done" })
    })
})

operations = publishAll().then(() => { send({ type: "ready" }) }).catch(error => {
    send({ type: "operation_error", operation: "reload", error: String(error) })
})
