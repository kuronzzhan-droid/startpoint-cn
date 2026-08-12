import type { Database } from "better-sqlite3"
import type { DormantWdfpMigration } from "./contract"

const MIGRATION_ID = "wdfp/active-quest-host/v1"
const TABLE_NAME = "players_active_quests"
const COLUMN_NAME = "is_multi_host"

interface ColumnInfo {
    name: string
    type: string
    notnull: number
    dflt_value: string | null
    pk: number
}

const LEGACY_COLUMNS: readonly [string, string, number, string | null, number][] = [
    ["player_id", "INTEGER", 0, null, 1],
    ["play_id", "TEXT", 1, null, 0],
    ["quest_id", "INTEGER", 1, null, 0],
    ["category", "INTEGER", 1, null, 0],
    ["use_boss_boost_point", "INTEGER", 1, "0", 0],
    ["use_boost_point", "INTEGER", 1, "0", 0],
    ["is_auto_start_mode", "INTEGER", 1, "0", 0],
    ["is_multi", "INTEGER", 1, "0", 0],
    ["room_number", "TEXT", 0, null, 0],
    ["entry_item_id", "INTEGER", 0, null, 0],
    ["event_id", "INTEGER", 0, null, 0],
    ["continue_count", "INTEGER", 1, "0", 0],
]

function readColumns(database: Database): ColumnInfo[] {
    return database.prepare(`PRAGMA table_info("${TABLE_NAME}")`).all() as ColumnInfo[]
}

function assertParentShape(columns: readonly ColumnInfo[]): void {
    const parent = columns.filter(column => column.name !== COLUMN_NAME)
    const matches = parent.length === LEGACY_COLUMNS.length && LEGACY_COLUMNS.every((expected, index) => {
        const actual = parent[index]
        return actual !== undefined
            && actual.name === expected[0]
            && actual.type.toUpperCase() === expected[1]
            && actual.notnull === expected[2]
            && actual.dflt_value === expected[3]
            && actual.pk === expected[4]
    })
    if (!matches) throw new Error(`${MIGRATION_ID}: ${TABLE_NAME} parent schema is non-canonical`)
}

function assertHostColumn(database: Database, required: boolean): void {
    const column = readColumns(database).find(entry => entry.name === COLUMN_NAME)
    if (column === undefined) {
        if (required) throw new Error(`${MIGRATION_ID}: ${COLUMN_NAME} column is missing`)
        return
    }
    const tableSql = (database.prepare(`SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = ?`).get(TABLE_NAME) as { sql: string } | undefined)?.sql ?? ""
    const normalizedSql = tableSql.replace(/\s+/g, " ").toLowerCase()
    const canonical = column.type.toUpperCase() === "INTEGER"
        && column.notnull === 0
        && column.dflt_value === "NULL"
        && column.pk === 0
        && normalizedSql.includes(
            "is_multi_host integer default null check (is_multi_host in (0, 1) or is_multi_host is null)",
        )
    if (!canonical) throw new Error(`${MIGRATION_ID}: incompatible ${COLUMN_NAME} column`)
}

function assertForeignKeys(database: Database): void {
    const foreignKeys = database.prepare(`PRAGMA foreign_key_list("${TABLE_NAME}")`).all() as Array<{
        table: string
        from: string
        to: string
        on_delete: string
    }>
    const canonical = foreignKeys.length === 1
        && foreignKeys[0]?.table === "players"
        && foreignKeys[0]?.from === "player_id"
        && foreignKeys[0]?.to === "id"
        && foreignKeys[0]?.on_delete === "CASCADE"
    if (!canonical) throw new Error(`${MIGRATION_ID}: ${TABLE_NAME} foreign key is non-canonical`)
    if (database.prepare(`PRAGMA foreign_key_check("${TABLE_NAME}")`).all().length !== 0) {
        throw new Error(`${MIGRATION_ID}: ${TABLE_NAME} failed foreign key validation`)
    }
}

function applyActiveQuestHostMigration(database: Database): void {
    database.transaction(() => {
        const columns = readColumns(database)
        if (columns.length === 0) throw new Error(`${MIGRATION_ID}: ${TABLE_NAME} table is missing`)
        assertParentShape(columns)
        assertForeignKeys(database)
        assertHostColumn(database, false)
        if (!columns.some(column => column.name === COLUMN_NAME)) {
            database.prepare(`ALTER TABLE ${TABLE_NAME}
                ADD COLUMN ${COLUMN_NAME} INTEGER DEFAULT NULL
                CHECK (${COLUMN_NAME} IN (0, 1) OR ${COLUMN_NAME} IS NULL)`).run()
        }
        assertParentShape(readColumns(database))
        assertHostColumn(database, true)
        assertForeignKeys(database)
    })()
}

export const activeQuestHostMigration: DormantWdfpMigration = {
    id: MIGRATION_ID,
    apply: applyActiveQuestHostMigration,
}
