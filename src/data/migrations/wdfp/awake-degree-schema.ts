import type { Database } from "better-sqlite3"

export const AWAKE_DEGREE_MIGRATION_ID = "wdfp/awake-degree/v1"
export const AWAKE_UNLOCK_TABLE = "players_character_awake_unlocks"
export const DEGREE_TABLE = "players_degrees"

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

interface TableSpec {
    name: string
    columns: readonly ColumnShape[]
    foreignKeys: readonly string[]
}

const integer = (name: string, pk = 0): ColumnShape => ({
    name,
    type: "INTEGER",
    notnull: 1,
    defaultValue: null,
    pk,
})

const playerForeignKey = ["players|CASCADE|player_id|id"]

const activeMissionSpec: TableSpec = {
    name: "players_active_missions",
    columns: [integer("id", 1), integer("progress"), integer("player_id", 2)],
    foreignKeys: playerForeignKey,
}

const activeStageSpec: TableSpec = {
    name: "players_active_missions_stages",
    columns: [integer("id", 1), integer("status"), integer("player_id", 3), integer("mission_id", 2)],
    foreignKeys: [
        "players_active_missions|CASCADE|mission_id,player_id|id,player_id",
        "players|CASCADE|player_id|id",
    ].sort(),
}

const categoryMissionSpec: TableSpec = {
    name: "players_category_missions",
    columns: [integer("category", 1), integer("id", 2), integer("progress"), integer("player_id", 3)],
    foreignKeys: playerForeignKey,
}

const categoryStageSpec: TableSpec = {
    name: "players_category_mission_stages",
    columns: [
        integer("category", 1),
        integer("id", 2),
        integer("status"),
        integer("player_id", 4),
        integer("mission_id", 3),
    ],
    foreignKeys: [
        "players_category_missions|CASCADE|category,mission_id,player_id|category,id,player_id",
        "players|CASCADE|player_id|id",
    ].sort(),
}

const awakeUnlockSpec: TableSpec = {
    name: AWAKE_UNLOCK_TABLE,
    columns: [integer("player_id", 1), integer("character_id", 2), integer("board_index", 3), integer("awake_level")],
    foreignKeys: [
        "players_characters|CASCADE|character_id,player_id|id,player_id",
        "players|CASCADE|player_id|id",
    ].sort(),
}

const degreeSpec: TableSpec = {
    name: DEGREE_TABLE,
    columns: [integer("player_id", 1), integer("degree_id", 2), integer("acquired_at")],
    foreignKeys: playerForeignKey,
}

const createAwakeUnlockSql = `CREATE TABLE players_character_awake_unlocks (
    player_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    board_index INTEGER NOT NULL,
    awake_level INTEGER NOT NULL,
    PRIMARY KEY (player_id, character_id, board_index),
    FOREIGN KEY (character_id, player_id)
        REFERENCES players_characters (id, player_id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
)`

const createDegreeSql = `CREATE TABLE players_degrees (
    player_id INTEGER NOT NULL,
    degree_id INTEGER NOT NULL,
    acquired_at INTEGER NOT NULL,
    PRIMARY KEY (player_id, degree_id),
    FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
)`

const createDegreeIndexSql = `CREATE INDEX idx_players_degrees_player
    ON players_degrees (player_id, acquired_at, degree_id)`

const createDegreeTriggerSql = `CREATE TRIGGER trg_players_default_degrees
    AFTER INSERT ON players
    BEGIN
        INSERT OR IGNORE INTO players_degrees (player_id, degree_id, acquired_at)
        VALUES (NEW.id, 1, 0);
        INSERT OR IGNORE INTO players_degrees (player_id, degree_id, acquired_at)
        SELECT NEW.id, NEW.degree_id, 0 WHERE NEW.degree_id > 0;
    END`

export function hasTable(database: Database, tableName: string): boolean {
    return database.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(tableName) !== undefined
}

function readColumns(database: Database, tableName: string): ColumnShape[] {
    return (database.prepare(`PRAGMA table_info("${tableName}")`).all() as RawColumnInfo[])
        .map(row => ({
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
        const group = groups.get(row.id) ?? {
            table: row.table,
            onDelete: row.on_delete,
            from: [],
            to: [],
        }
        group.from[row.seq] = row.from
        group.to[row.seq] = row.to
        groups.set(row.id, group)
    }
    return [...groups.values()].map(group =>
        `${group.table}|${group.onDelete}|${group.from.join(",")}|${group.to.join(",")}`
    ).sort()
}

function hasCanonicalShape(database: Database, spec: TableSpec): boolean {
    const actual = readColumns(database, spec.name)
    if (actual.length !== spec.columns.length) return false
    const actualByName = new Map(actual.map(column => [column.name, column]))
    const columnsMatch = spec.columns.every(wanted => {
        const column = actualByName.get(wanted.name)
        return column !== undefined
            && column.type === wanted.type
            && column.notnull === wanted.notnull
            && column.defaultValue === wanted.defaultValue
            && column.pk === wanted.pk
    })
    const actualForeignKeys = foreignKeyShapes(database, spec.name)
    const expectedForeignKeys = [...spec.foreignKeys].sort()
    return columnsMatch
        && actualForeignKeys.length === expectedForeignKeys.length
        && actualForeignKeys.every((value, index) => value === expectedForeignKeys[index])
}

export function assertAwakeDegreePrerequisiteSchema(database: Database): void {
    for (const spec of [activeMissionSpec, activeStageSpec, categoryMissionSpec, categoryStageSpec]) {
        if (!hasTable(database, spec.name) || !hasCanonicalShape(database, spec)) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: prerequisite table is non-canonical: ${spec.name}`)
        }
    }
    if (!hasTable(database, "players") || !hasTable(database, "players_characters")) {
        throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: players and players_characters are required`)
    }
    const playerColumns = readColumns(database, "players")
    const characterColumns = readColumns(database, "players_characters")
    const degree = playerColumns.find(column => column.name === "degree_id")
    const characterId = characterColumns.find(column => column.name === "id")
    const characterPlayerId = characterColumns.find(column => column.name === "player_id")
    if (degree?.type !== "INTEGER" || degree.notnull !== 1
        || characterId?.type !== "INTEGER" || characterId.pk !== 1
        || characterPlayerId?.type !== "INTEGER" || characterPlayerId.pk !== 2
        || foreignKeyShapes(database, "players_characters").join(";") !== playerForeignKey.join(";")) {
        throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: player ownership schema is non-canonical`)
    }
}

function normalizeSql(value: string): string {
    return value
        .replace(/CREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS/i, "CREATE TRIGGER")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/;$/, "")
        .toLowerCase()
}

function assertDegreeIndex(database: Database, required: boolean): void {
    const index = database.prepare(`
        SELECT type, tbl_name FROM sqlite_master WHERE name = 'idx_players_degrees_player'
    `).get() as { type: string; tbl_name: string } | undefined
    if (index === undefined) {
        if (required) throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: degree index is missing`)
        return
    }
    const indexList = database.prepare(`PRAGMA index_list("players_degrees")`).all() as RawIndexListInfo[]
    const entry = indexList.find(row => row.name === "idx_players_degrees_player")
    const actual = database.prepare(`
        PRAGMA index_xinfo("idx_players_degrees_player")
    `).all() as RawIndexXInfo[]
    const expected: RawIndexXInfo[] = [
        { seqno: 0, cid: 0, name: "player_id", desc: 0, coll: "BINARY", key: 1 },
        { seqno: 1, cid: 2, name: "acquired_at", desc: 0, coll: "BINARY", key: 1 },
        { seqno: 2, cid: 1, name: "degree_id", desc: 0, coll: "BINARY", key: 1 },
        { seqno: 3, cid: -1, name: null, desc: 0, coll: "BINARY", key: 0 },
    ]
    const shapeMatches = actual.length === expected.length && expected.every((wanted, position) => {
        const row = actual[position]
        return row.seqno === wanted.seqno && row.cid === wanted.cid && row.name === wanted.name
            && row.desc === wanted.desc && row.coll === wanted.coll && row.key === wanted.key
    })
    if (index.type !== "index" || index.tbl_name !== DEGREE_TABLE
        || entry?.unique !== 0
        || entry.origin !== "c"
        || entry.partial !== 0
        || !shapeMatches) {
        throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: degree index is non-canonical`)
    }
}

function assertDegreeTrigger(database: Database, required: boolean): void {
    const trigger = database.prepare(`
        SELECT type, tbl_name, sql FROM sqlite_master WHERE name = 'trg_players_default_degrees'
    `).get() as { type: string; tbl_name: string; sql: string } | undefined
    if (trigger === undefined) {
        if (required) throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: degree trigger is missing`)
        return
    }
    if (trigger.type !== "trigger" || trigger.tbl_name !== "players"
        || normalizeSql(trigger.sql) !== normalizeSql(createDegreeTriggerSql)) {
        throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: degree trigger is non-canonical`)
    }
}

export function assertExistingAwakeDegreeSchema(database: Database): void {
    for (const spec of [awakeUnlockSpec, degreeSpec]) {
        if (hasTable(database, spec.name) && !hasCanonicalShape(database, spec)) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: ${spec.name} has unknown schema`)
        }
    }
    assertDegreeIndex(database, false)
    assertDegreeTrigger(database, false)
}

export function createAwakeDegreeTablesAndIndex(database: Database): void {
    if (!hasTable(database, AWAKE_UNLOCK_TABLE)) database.prepare(createAwakeUnlockSql).run()
    if (!hasTable(database, DEGREE_TABLE)) database.prepare(createDegreeSql).run()
    const indexExists = database.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_players_degrees_player'
    `).get() !== undefined
    if (!indexExists) database.prepare(createDegreeIndexSql).run()
}

export function ensureDegreeTrigger(database: Database): void {
    const triggerExists = database.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_players_default_degrees'
    `).get() !== undefined
    if (!triggerExists) database.prepare(createDegreeTriggerSql).run()
}

export function assertFinalAwakeDegreeSchema(database: Database): void {
    for (const spec of [awakeUnlockSpec, degreeSpec]) {
        if (!hasCanonicalShape(database, spec)) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: ${spec.name} failed canonical schema validation`)
        }
    }
    assertDegreeIndex(database, true)
    assertDegreeTrigger(database, true)
    for (const tableName of [
        activeMissionSpec.name,
        activeStageSpec.name,
        categoryMissionSpec.name,
        categoryStageSpec.name,
        awakeUnlockSpec.name,
        degreeSpec.name,
    ]) {
        if (database.prepare(`PRAGMA foreign_key_check("${tableName}")`).all().length > 0) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: ${tableName} failed foreign key validation`)
        }
    }
}
