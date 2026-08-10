import type { Database } from "better-sqlite3"
import type { DormantWdfpMigration } from "./contract"

// Dormant covering index for the degree engine's per-section clear counts. It is deliberately a
// migration and not an initializer change: the BASE initializer creates no user indexes at all, and
// adding one there would take effect on every live database the moment it is merged.

const MIGRATION_ID = "wdfp/degree-query-index/v1"
const QUEST_TABLE = "players_quest_progress"
const INDEX_NAME = "idx_players_quest_progress_player_section_finished"

const createIndexSql = `CREATE INDEX ${INDEX_NAME}
    ON ${QUEST_TABLE} (player_id, section, finished)`

interface ColumnShape {
    name: string
    type: string
    notnull: number
    defaultValue: string | null
    pk: number
}

interface RawColumnInfo {
    name: string
    type: string
    notnull: number
    dflt_value: string | null
    pk: number
}

interface RawForeignKeyInfo {
    id: number
    seq: number
    table: string
    from: string
    to: string
    on_delete: string
}

interface RawIndexListInfo {
    name: string
    unique: number
    origin: string
    partial: number
}

interface RawIndexXInfo {
    seqno: number
    cid: number
    name: string | null
    desc: number
    coll: string | null
    key: number
}

const integer = (name: string, pk = 0, defaultValue: string | null = null): ColumnShape =>
    ({ name, type: "INTEGER", notnull: 1, defaultValue, pk })
const nullableInteger = (name: string): ColumnShape =>
    ({ name, type: "INTEGER", notnull: 0, defaultValue: null, pk: 0 })

// Positional, because the index cids below are the column ordinals of this exact layout. The
// trailing host_finished is what missionFactsMigration adds, so its presence doubles as the "the
// prerequisite migration already ran" check.
const questColumns: readonly ColumnShape[] = [
    integer("section", 1),
    integer("quest_id", 2),
    integer("finished"),
    integer("unlocked", 0, "0"),
    nullableInteger("high_score"),
    nullableInteger("clear_rank"),
    nullableInteger("best_elapsed_time_ms"),
    nullableInteger("leader_character_id"),
    integer("multi_clear_count", 0, "0"),
    integer("player_id", 3),
    integer("host_finished", 0, "0"),
]

const questForeignKeys = ["players|CASCADE|player_id|id"]

// player_id is the tenth column of the table, hence cid 9 in the first key slot; the trailing
// cid -1 entry is the implicit rowid. desc/coll/partial/unique each reject exactly one way of
// getting a same-named index subtly wrong, so all six fields are compared.
const expectedXInfo: readonly RawIndexXInfo[] = [
    { seqno: 0, cid: 9, name: "player_id", desc: 0, coll: "BINARY", key: 1 },
    { seqno: 1, cid: 0, name: "section", desc: 0, coll: "BINARY", key: 1 },
    { seqno: 2, cid: 2, name: "finished", desc: 0, coll: "BINARY", key: 1 },
    { seqno: 3, cid: -1, name: null, desc: 0, coll: "BINARY", key: 0 },
]

function tableExists(database: Database, tableName: string): boolean {
    return database.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(tableName) !== undefined
}

function readColumns(database: Database, tableName: string): ColumnShape[] {
    return (database.prepare(`PRAGMA table_info("${tableName}")`).all() as RawColumnInfo[]).map(row => ({
        name: row.name,
        type: row.type.toUpperCase(),
        notnull: row.notnull,
        defaultValue: row.dflt_value,
        pk: row.pk,
    }))
}

function foreignKeyShapes(database: Database, tableName: string): string[] {
    const groups = new Map<number, { table: string; onDelete: string; from: string[]; to: string[] }>()
    for (const row of database.prepare(`PRAGMA foreign_key_list("${tableName}")`).all() as RawForeignKeyInfo[]) {
        const group = groups.get(row.id) ?? { table: row.table, onDelete: row.on_delete, from: [], to: [] }
        group.from[row.seq] = row.from
        group.to[row.seq] = row.to
        groups.set(row.id, group)
    }
    return [...groups.values()]
        .map(group => `${group.table}|${group.onDelete}|${group.from.join(",")}|${group.to.join(",")}`)
        .sort()
}

function assertQuestParentSchema(database: Database): void {
    if (!tableExists(database, "players")) throw new Error(`${MIGRATION_ID}: players table is required`)
    if (!tableExists(database, QUEST_TABLE)) throw new Error(`${MIGRATION_ID}: ${QUEST_TABLE} table is missing`)
    const actual = readColumns(database, QUEST_TABLE)
    const columnsMatch = actual.length === questColumns.length && questColumns.every((wanted, position) => {
        const column = actual[position]
        return column !== undefined
            && column.name === wanted.name
            && column.type === wanted.type
            && column.notnull === wanted.notnull
            && column.defaultValue === wanted.defaultValue
            && column.pk === wanted.pk
    })
    const actualForeignKeys = foreignKeyShapes(database, QUEST_TABLE)
    const foreignKeysMatch = actualForeignKeys.length === questForeignKeys.length
        && actualForeignKeys.every((shape, position) => shape === questForeignKeys[position])
    if (!columnsMatch || !foreignKeysMatch) {
        throw new Error(`${MIGRATION_ID}: ${QUEST_TABLE} is non-canonical; run the mission facts migration first`)
    }
}

function assertForeignKeyIntegrity(database: Database): void {
    if (database.prepare(`PRAGMA foreign_key_check("${QUEST_TABLE}")`).all().length > 0) {
        throw new Error(`${MIGRATION_ID}: ${QUEST_TABLE} failed foreign key validation`)
    }
}

function assertDegreeQueryIndex(database: Database, required: boolean): void {
    const named = database.prepare(`
        SELECT type, tbl_name FROM sqlite_master WHERE name = ?
    `).get(INDEX_NAME) as { type: string; tbl_name: string } | undefined
    if (named === undefined) {
        if (required) throw new Error(`${MIGRATION_ID}: degree query index is missing`)
        return
    }
    // Reported separately from the shape mismatch below: a table, view or trigger squatting on the
    // name is a different kind of accident from an index that is merely built wrong.
    if (named.type !== "index" || named.tbl_name !== QUEST_TABLE) {
        throw new Error(`${MIGRATION_ID}: ${INDEX_NAME} is owned by a ${named.type} on ${named.tbl_name}`)
    }
    const entry = (database.prepare(`PRAGMA index_list("${QUEST_TABLE}")`).all() as RawIndexListInfo[])
        .find(row => row.name === INDEX_NAME)
    const actual = database.prepare(`PRAGMA index_xinfo("${INDEX_NAME}")`).all() as RawIndexXInfo[]
    const shapeMatches = actual.length === expectedXInfo.length && expectedXInfo.every((wanted, position) => {
        const row = actual[position]
        return row.seqno === wanted.seqno
            && row.cid === wanted.cid
            && row.name === wanted.name
            && row.desc === wanted.desc
            && row.coll === wanted.coll
            && row.key === wanted.key
    })
    // A same-named foreign object is reported, never repaired: dropping something this migration did
    // not create would destroy whatever put it there.
    // origin, seqno and key are compared for completeness even though SQLite cannot produce a
    // same-named object that differs in them (constraint-derived indexes are always named
    // sqlite_autoindex_*, and there is no INCLUDE clause), so no fixture can single them out.
    if (entry?.unique !== 0
        || entry.origin !== "c"
        || entry.partial !== 0
        || !shapeMatches) {
        throw new Error(`${MIGRATION_ID}: degree query index is non-canonical`)
    }
}

function createIndexIfMissing(database: Database): void {
    const exists = database.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?
    `).get(INDEX_NAME) !== undefined
    if (!exists) database.prepare(createIndexSql).run()
}

function applyDegreeQueryIndexMigration(database: Database): void {
    // better-sqlite3 rolls the whole callback back on throw, so a rejected readback leaves neither
    // the index nor any row change behind. No DML runs here at all: this migration never backfills.
    database.transaction(() => {
        assertQuestParentSchema(database)
        assertForeignKeyIntegrity(database)
        assertDegreeQueryIndex(database, false)
        createIndexIfMissing(database)
        assertDegreeQueryIndex(database, true)
        assertForeignKeyIntegrity(database)
    })()
}

export const degreeQueryIndexMigration: DormantWdfpMigration = {
    id: MIGRATION_ID,
    apply: applyDegreeQueryIndexMigration,
}
