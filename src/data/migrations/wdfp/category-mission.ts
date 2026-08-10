import type { Database } from "better-sqlite3"
import type { DormantWdfpMigration } from "./contract"

const MIGRATION_ID = "wdfp/category-mission/v1"
const MISSION_TABLE = "players_category_missions"
const STAGE_TABLE = "players_category_mission_stages"
const MISSION_BACKUP = "wf_category_missions_v1_backup"
const STAGE_BACKUP = "wf_category_mission_stages_v1_backup"

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

const missionColumns: readonly ColumnShape[] = [
    { name: "category", type: "INTEGER", notnull: 1, defaultValue: null, pk: 1 },
    { name: "id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 2 },
    { name: "progress", type: "INTEGER", notnull: 1, defaultValue: null, pk: 0 },
    { name: "player_id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 3 },
]

const stageColumns: readonly ColumnShape[] = [
    { name: "category", type: "INTEGER", notnull: 1, defaultValue: null, pk: 1 },
    { name: "id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 2 },
    { name: "status", type: "INTEGER", notnull: 1, defaultValue: null, pk: 0 },
    { name: "player_id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 4 },
    { name: "mission_id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 3 },
]

const missionForeignKeys = ["players|CASCADE|player_id|id"]
const stageForeignKeys = [
    "players_category_missions|CASCADE|category,mission_id,player_id|category,id,player_id",
    "players|CASCADE|player_id|id",
].sort()

const createMissionTableSql = `CREATE TABLE players_category_missions (
    category INTEGER NOT NULL,
    id INTEGER NOT NULL,
    progress INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    PRIMARY KEY (category, id, player_id),
    FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
)`

const createStageTableSql = `CREATE TABLE players_category_mission_stages (
    category INTEGER NOT NULL,
    id INTEGER NOT NULL,
    status INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    mission_id INTEGER NOT NULL,
    PRIMARY KEY (category, id, mission_id, player_id),
    FOREIGN KEY (category, mission_id, player_id)
        REFERENCES players_category_missions (category, id, player_id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
)`

function tableExists(database: Database, tableName: string): boolean {
    return database.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(tableName) !== undefined
}

function tempTableExists(database: Database, tableName: string): boolean {
    return database.prepare(`
        SELECT 1 FROM sqlite_temp_master WHERE type = 'table' AND name = ?
    `).get(tableName) !== undefined
}

function getColumns(database: Database, tableName: string): ColumnShape[] {
    const rows = database.prepare(`PRAGMA table_info("${tableName}")`).all() as RawColumnInfo[]
    return rows.map(row => ({
        name: row.name,
        type: row.type.toUpperCase(),
        notnull: row.notnull,
        defaultValue: row.dflt_value,
        pk: row.pk,
    }))
}

function getForeignKeyShapes(database: Database, tableName: string): string[] {
    const rows = database.prepare(`PRAGMA foreign_key_list("${tableName}")`).all() as RawForeignKeyInfo[]
    const groups = new Map<number, {
        table: string
        onDelete: string
        from: string[]
        to: string[]
    }>()
    for (const row of rows) {
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
    return [...groups.values()]
        .map(group => `${group.table}|${group.onDelete}|${group.from.join(",")}|${group.to.join(",")}`)
        .sort()
}

function sameColumns(actual: readonly ColumnShape[], expected: readonly ColumnShape[]): boolean {
    return actual.length === expected.length && actual.every((column, index) => {
        const wanted = expected[index]
        return wanted !== undefined
            && column.name === wanted.name
            && column.type === wanted.type
            && column.notnull === wanted.notnull
            && column.defaultValue === wanted.defaultValue
            && column.pk === wanted.pk
    })
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
    return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

function isCanonicalMissionTable(database: Database): boolean {
    return sameColumns(getColumns(database, MISSION_TABLE), missionColumns)
        && sameStrings(getForeignKeyShapes(database, MISSION_TABLE), missionForeignKeys)
}

function isCanonicalStageTable(database: Database): boolean {
    return sameColumns(getColumns(database, STAGE_TABLE), stageColumns)
        && sameStrings(getForeignKeyShapes(database, STAGE_TABLE), stageForeignKeys)
}

function assertRequiredColumns(
    database: Database,
    tableName: string,
    requiredColumns: readonly string[],
): void {
    const actual = new Set(getColumns(database, tableName).map(column => column.name))
    const missing = requiredColumns.find(column => !actual.has(column))
    if (missing !== undefined) {
        throw new Error(`${MIGRATION_ID}: ${tableName} is missing required column ${missing}`)
    }
}

function assertNoUnsafeLegacyRows(database: Database, hasStages: boolean): void {
    const nullMission = database.prepare(`
        SELECT 1 FROM players_category_missions
        WHERE category IS NULL OR id IS NULL OR progress IS NULL OR player_id IS NULL
        LIMIT 1
    `).get()
    if (nullMission !== undefined) {
        throw new Error(`${MIGRATION_ID}: mission row contains null authoritative values`)
    }

    const duplicateMission = database.prepare(`
        SELECT 1 FROM players_category_missions
        GROUP BY category, id, player_id HAVING COUNT(*) > 1
        LIMIT 1
    `).get()
    if (duplicateMission !== undefined) {
        throw new Error(`${MIGRATION_ID}: duplicate mission key cannot be merged safely`)
    }

    const orphanMission = database.prepare(`
        SELECT 1 FROM players_category_missions AS mission
        LEFT JOIN players AS player ON player.id = mission.player_id
        WHERE player.id IS NULL
        LIMIT 1
    `).get()
    if (orphanMission !== undefined) {
        throw new Error(`${MIGRATION_ID}: mission row has no parent player`)
    }

    if (!hasStages) return

    const nullStage = database.prepare(`
        SELECT 1 FROM players_category_mission_stages
        WHERE category IS NULL OR id IS NULL OR status IS NULL
           OR player_id IS NULL OR mission_id IS NULL
        LIMIT 1
    `).get()
    if (nullStage !== undefined) {
        throw new Error(`${MIGRATION_ID}: stage row contains null authoritative values`)
    }

    const duplicateStage = database.prepare(`
        SELECT 1 FROM players_category_mission_stages
        GROUP BY category, id, mission_id, player_id HAVING COUNT(*) > 1
        LIMIT 1
    `).get()
    if (duplicateStage !== undefined) {
        throw new Error(`${MIGRATION_ID}: duplicate stage key cannot be merged safely`)
    }

    const orphanStage = database.prepare(`
        SELECT 1 FROM players_category_mission_stages AS stage
        LEFT JOIN players_category_missions AS mission
          ON mission.category = stage.category
         AND mission.id = stage.mission_id
         AND mission.player_id = stage.player_id
        LEFT JOIN players AS player ON player.id = stage.player_id
        WHERE mission.id IS NULL OR player.id IS NULL
        LIMIT 1
    `).get()
    if (orphanStage !== undefined) {
        throw new Error(`${MIGRATION_ID}: orphan stage cannot be migrated safely`)
    }
}

function assertNoForeignKeyViolations(database: Database): void {
    for (const tableName of [MISSION_TABLE, STAGE_TABLE]) {
        const violations = database.prepare(`PRAGMA foreign_key_check(${tableName})`).all()
        if (violations.length > 0) {
            throw new Error(`${MIGRATION_ID}: ${tableName} failed foreign key validation`)
        }
    }
}

function assertCanonicalSchema(database: Database): void {
    if (!isCanonicalMissionTable(database) || !isCanonicalStageTable(database)) {
        throw new Error(`${MIGRATION_ID}: canonical schema validation failed`)
    }
    assertNoForeignKeyViolations(database)
}

function assertSameRows(database: Database, backup: string, tableName: string, columns: string): void {
    const backupCount = database.prepare(`SELECT COUNT(*) AS count FROM temp."${backup}"`).get() as { count: number }
    const tableCount = database.prepare(`SELECT COUNT(*) AS count FROM "${tableName}"`).get() as { count: number }
    if (backupCount.count !== tableCount.count) {
        throw new Error(`${MIGRATION_ID}: ${tableName} row count changed during rebuild`)
    }
    const missing = database.prepare(`
        SELECT 1 FROM (
            SELECT ${columns} FROM temp."${backup}"
            EXCEPT SELECT ${columns} FROM "${tableName}"
        ) LIMIT 1
    `).get()
    const added = database.prepare(`
        SELECT 1 FROM (
            SELECT ${columns} FROM "${tableName}"
            EXCEPT SELECT ${columns} FROM temp."${backup}"
        ) LIMIT 1
    `).get()
    if (missing !== undefined || added !== undefined) {
        throw new Error(`${MIGRATION_ID}: ${tableName} values changed during rebuild`)
    }
}

function rebuildTables(database: Database, hasStages: boolean): void {
    if (tempTableExists(database, MISSION_BACKUP) || tempTableExists(database, STAGE_BACKUP)) {
        throw new Error(`${MIGRATION_ID}: reserved migration backup table already exists`)
    }

    database.prepare(`
        CREATE TEMP TABLE "${MISSION_BACKUP}" AS
        SELECT category, id, progress, player_id FROM players_category_missions
    `).run()
    if (hasStages) {
        database.prepare(`
            CREATE TEMP TABLE "${STAGE_BACKUP}" AS
            SELECT category, id, status, player_id, mission_id
            FROM players_category_mission_stages
        `).run()
        database.prepare(`DROP TABLE players_category_mission_stages`).run()
    } else {
        database.prepare(`CREATE TEMP TABLE "${STAGE_BACKUP}" (
            category INTEGER, id INTEGER, status INTEGER, player_id INTEGER, mission_id INTEGER
        )`).run()
    }

    database.prepare(`DROP TABLE players_category_missions`).run()
    database.prepare(createMissionTableSql).run()
    database.prepare(createStageTableSql).run()
    database.prepare(`
        INSERT INTO players_category_missions (category, id, progress, player_id)
        SELECT category, id, progress, player_id FROM temp."${MISSION_BACKUP}"
    `).run()
    database.prepare(`
        INSERT INTO players_category_mission_stages
            (category, id, status, player_id, mission_id)
        SELECT category, id, status, player_id, mission_id FROM temp."${STAGE_BACKUP}"
    `).run()

    assertSameRows(database, MISSION_BACKUP, MISSION_TABLE, "category, id, progress, player_id")
    assertSameRows(database, STAGE_BACKUP, STAGE_TABLE, "category, id, status, player_id, mission_id")
    assertCanonicalSchema(database)
    database.prepare(`DROP TABLE temp."${STAGE_BACKUP}"`).run()
    database.prepare(`DROP TABLE temp."${MISSION_BACKUP}"`).run()
}

function applyCategoryMissionMigration(database: Database): void {
    if (!tableExists(database, "players")) {
        throw new Error(`${MIGRATION_ID}: players table is required`)
    }

    const hasMissions = tableExists(database, MISSION_TABLE)
    const hasStages = tableExists(database, STAGE_TABLE)
    if (!hasMissions && hasStages) {
        throw new Error(`${MIGRATION_ID}: child table exists without parent`)
    }

    if (!hasMissions) {
        database.transaction(() => {
            database.prepare(createMissionTableSql).run()
            database.prepare(createStageTableSql).run()
            assertCanonicalSchema(database)
        })()
        return
    }

    assertRequiredColumns(database, MISSION_TABLE, ["category", "id", "progress", "player_id"])
    if (hasStages) {
        assertRequiredColumns(database, STAGE_TABLE, ["category", "id", "status", "player_id", "mission_id"])
    }
    assertNoUnsafeLegacyRows(database, hasStages)

    const missionCanonical = isCanonicalMissionTable(database)
    const stageCanonical = hasStages && isCanonicalStageTable(database)
    if (missionCanonical && stageCanonical) {
        assertCanonicalSchema(database)
        return
    }

    if (missionCanonical && !hasStages) {
        database.transaction(() => {
            database.prepare(createStageTableSql).run()
            assertCanonicalSchema(database)
        })()
        return
    }

    database.transaction(() => rebuildTables(database, hasStages))()
}

export const categoryMissionMigration: DormantWdfpMigration = {
    id: MIGRATION_ID,
    apply: applyCategoryMissionMigration,
}
