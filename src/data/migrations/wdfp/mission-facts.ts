import type { Database } from "better-sqlite3"
import { ensureSchemaColumn, type SchemaColumnKey } from "../../schema"
import type { DormantWdfpMigration } from "./contract"

const MIGRATION_ID = "wdfp/mission-facts/v1"

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

interface TableSpec {
    name: string
    columns: readonly ColumnShape[]
    foreignKeys: readonly string[]
    createSql: string
    legacyColumns?: readonly ColumnShape[]
}

const integer = (
    name: string,
    options: { defaultZero?: boolean; notNull?: boolean; pk?: number } = {},
): ColumnShape => ({
    name,
    type: "INTEGER",
    notnull: options.notNull === false ? 0 : 1,
    defaultValue: options.defaultZero ? "0" : null,
    pk: options.pk ?? 0,
})

const playerForeignKey = ["players|CASCADE|player_id|id"]

const missionCounterBase = [
    integer("player_id", { notNull: false, pk: 1 }),
    integer("single_play_count", { defaultZero: true }),
    integer("single_clear_count", { defaultZero: true }),
    integer("multi_play_count", { defaultZero: true }),
    integer("multi_clear_count", { defaultZero: true }),
    integer("multi_host_clear_count", { defaultZero: true }),
    integer("multi_guest_clear_count", { defaultZero: true }),
] as const

const missionCounterRanks = [
    integer("rank_ss_count", { defaultZero: true }),
    integer("rank_s_count", { defaultZero: true }),
    integer("rank_a_count", { defaultZero: true }),
    integer("rank_b_count", { defaultZero: true }),
] as const

const activeCounterBase = [
    integer("player_id", { notNull: false, pk: 1 }),
    integer("total_used_mana_count", { defaultZero: true }),
    integer("total_gacha_character_count", { defaultZero: true }),
] as const

const activeCounterExtensions = [
    integer("total_equipment_equip_count", { defaultZero: true }),
    integer("total_unison_set_count", { defaultZero: true }),
    integer("total_party_character_set_count", { defaultZero: true }),
    integer("total_injected_exp_count", { defaultZero: true }),
    integer("total_gacha_campaign_count", { defaultZero: true }),
    integer("practice_quest_challenge_count", { defaultZero: true }),
] as const

const tableSpecs: readonly TableSpec[] = [
    {
        name: "players_mission_battle_counters",
        legacyColumns: [...missionCounterBase, ...missionCounterRanks],
        columns: [
            ...missionCounterBase,
            integer("single_rank_ss_count", { defaultZero: true }),
            ...missionCounterRanks,
        ],
        foreignKeys: playerForeignKey,
        createSql: `CREATE TABLE players_mission_battle_counters (
            player_id INTEGER PRIMARY KEY,
            single_play_count INTEGER NOT NULL DEFAULT 0,
            single_clear_count INTEGER NOT NULL DEFAULT 0,
            multi_play_count INTEGER NOT NULL DEFAULT 0,
            multi_clear_count INTEGER NOT NULL DEFAULT 0,
            multi_host_clear_count INTEGER NOT NULL DEFAULT 0,
            multi_guest_clear_count INTEGER NOT NULL DEFAULT 0,
            single_rank_ss_count INTEGER NOT NULL DEFAULT 0,
            rank_ss_count INTEGER NOT NULL DEFAULT 0,
            rank_s_count INTEGER NOT NULL DEFAULT 0,
            rank_a_count INTEGER NOT NULL DEFAULT 0,
            rank_b_count INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
        )`,
    },
    {
        name: "players_active_mission_counters",
        legacyColumns: activeCounterBase,
        columns: [...activeCounterBase, ...activeCounterExtensions],
        foreignKeys: playerForeignKey,
        createSql: `CREATE TABLE players_active_mission_counters (
            player_id INTEGER PRIMARY KEY,
            total_used_mana_count INTEGER NOT NULL DEFAULT 0,
            total_gacha_character_count INTEGER NOT NULL DEFAULT 0,
            total_equipment_equip_count INTEGER NOT NULL DEFAULT 0,
            total_unison_set_count INTEGER NOT NULL DEFAULT 0,
            total_party_character_set_count INTEGER NOT NULL DEFAULT 0,
            total_injected_exp_count INTEGER NOT NULL DEFAULT 0,
            total_gacha_campaign_count INTEGER NOT NULL DEFAULT 0,
            practice_quest_challenge_count INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
        )`,
    },
    {
        name: "players_active_mission_battle_condition_facts",
        columns: [
            integer("player_id", { pk: 1 }),
            integer("pattern", { pk: 2 }),
            integer("character_id", { pk: 3 }),
            integer("progress", { defaultZero: true }),
        ],
        foreignKeys: playerForeignKey,
        createSql: `CREATE TABLE players_active_mission_battle_condition_facts (
            player_id INTEGER NOT NULL,
            pattern INTEGER NOT NULL,
            character_id INTEGER NOT NULL,
            progress INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (player_id, pattern, character_id),
            FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
        )`,
    },
    {
        name: "players_active_mission_battle_facts",
        columns: [
            integer("player_id", { pk: 1 }),
            integer("mission_id", { pk: 2 }),
            integer("progress", { defaultZero: true }),
        ],
        foreignKeys: playerForeignKey,
        createSql: `CREATE TABLE players_active_mission_battle_facts (
            player_id INTEGER NOT NULL,
            mission_id INTEGER NOT NULL,
            progress INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (player_id, mission_id),
            FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
        )`,
    },
    {
        name: "players_collected_items",
        columns: [
            integer("player_id", { pk: 1 }),
            integer("item_id", { pk: 2 }),
            integer("total_obtained", { defaultZero: true }),
        ],
        foreignKeys: playerForeignKey,
        createSql: `CREATE TABLE players_collected_items (
            player_id INTEGER NOT NULL,
            item_id INTEGER NOT NULL,
            total_obtained INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (player_id, item_id),
            FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
        )`,
    },
] as const

const periodicColumns: readonly SchemaColumnKey[] = [
    "players_periodic_snapshots.single_play_count",
    "players_periodic_snapshots.single_clear_count",
    "players_periodic_snapshots.multi_play_count",
    "players_periodic_snapshots.multi_clear_count",
    "players_periodic_snapshots.multi_host_clear_count",
    "players_periodic_snapshots.multi_guest_clear_count",
    "players_periodic_snapshots.dash_count",
    "players_periodic_snapshots.power_flip_count",
    "players_periodic_snapshots.login_days",
]

const missionCounterColumns: readonly SchemaColumnKey[] = [
    "players_mission_battle_counters.single_rank_ss_count",
]

const activeCounterColumns: readonly SchemaColumnKey[] = [
    "players_active_mission_counters.total_equipment_equip_count",
    "players_active_mission_counters.total_unison_set_count",
    "players_active_mission_counters.total_party_character_set_count",
    "players_active_mission_counters.total_injected_exp_count",
    "players_active_mission_counters.total_gacha_campaign_count",
    "players_active_mission_counters.practice_quest_challenge_count",
]

function tableExists(database: Database, tableName: string): boolean {
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
    const groups = new Map<number, {
        table: string
        onDelete: string
        from: string[]
        to: string[]
    }>()
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

function sameColumns(actual: readonly ColumnShape[], expected: readonly ColumnShape[]): boolean {
    if (actual.length !== expected.length) return false
    const actualByName = new Map(actual.map(column => [column.name, column]))
    return expected.every(wanted => {
        const column = actualByName.get(wanted.name)
        return column !== undefined
            && column.type === wanted.type
            && column.notnull === wanted.notnull
            && column.defaultValue === wanted.defaultValue
            && column.pk === wanted.pk
    })
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
    return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

function hasShape(database: Database, spec: TableSpec, columns: readonly ColumnShape[]): boolean {
    return sameColumns(readColumns(database, spec.name), columns)
        && sameStrings(foreignKeyShapes(database, spec.name), [...spec.foreignKeys].sort())
}

function assertParentTables(database: Database): void {
    for (const tableName of ["players", "players_periodic_snapshots", "players_quest_progress"]) {
        if (!tableExists(database, tableName)) {
            throw new Error(`${MIGRATION_ID}: required parent table is missing: ${tableName}`)
        }
    }
    const playerId = readColumns(database, "players").find(column => column.name === "id")
    if (playerId?.type !== "INTEGER" || playerId.pk !== 1) {
        throw new Error(`${MIGRATION_ID}: players.id is non-canonical`)
    }
    const periodic = readColumns(database, "players_periodic_snapshots")
    const quest = readColumns(database, "players_quest_progress")
    const requiredPeriodic = [
        integer("player_id", { pk: 1 }),
        { name: "period_type", type: "TEXT", notnull: 1, defaultValue: null, pk: 2 },
        ...["quest_clears", "stamina_used", "rank_ss", "rank_s", "rank_a", "rank_b"]
            .map(name => integer(name, { defaultZero: true })),
        { name: "updated_at", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
    ]
    const requiredQuest = [
        integer("section", { pk: 1 }),
        integer("quest_id", { pk: 2 }),
        integer("finished"),
        integer("unlocked", { defaultZero: true }),
        { name: "high_score", type: "INTEGER", notnull: 0, defaultValue: null, pk: 0 },
        { name: "clear_rank", type: "INTEGER", notnull: 0, defaultValue: null, pk: 0 },
        { name: "best_elapsed_time_ms", type: "INTEGER", notnull: 0, defaultValue: null, pk: 0 },
        { name: "leader_character_id", type: "INTEGER", notnull: 0, defaultValue: null, pk: 0 },
        integer("multi_clear_count", { defaultZero: true }),
        integer("player_id", { pk: 3 }),
    ]
    const contains = (actual: readonly ColumnShape[], expected: readonly ColumnShape[]) => {
        const byName = new Map(actual.map(column => [column.name, column]))
        return expected.every(wanted => {
            const column = byName.get(wanted.name)
            return column !== undefined
                && column.type === wanted.type
                && column.notnull === wanted.notnull
                && column.defaultValue === wanted.defaultValue
                && column.pk === wanted.pk
        })
    }
    if (!contains(periodic, requiredPeriodic)
        || !sameStrings(foreignKeyShapes(database, "players_periodic_snapshots"), playerForeignKey)
        || !contains(quest, requiredQuest)
        || !sameStrings(foreignKeyShapes(database, "players_quest_progress"), playerForeignKey)) {
        throw new Error(`${MIGRATION_ID}: BASE extension table is non-canonical`)
    }
}

function preflightTargetTables(database: Database): void {
    for (const spec of tableSpecs) {
        if (!tableExists(database, spec.name)) continue
        if (hasShape(database, spec, spec.columns)) continue
        if (spec.legacyColumns !== undefined && hasShape(database, spec, spec.legacyColumns)) continue
        throw new Error(`${MIGRATION_ID}: ${spec.name} has unknown schema`)
    }
}

function assertFinalSchema(database: Database): void {
    for (const spec of tableSpecs) {
        if (!hasShape(database, spec, spec.columns)) {
            throw new Error(`${MIGRATION_ID}: ${spec.name} failed canonical schema validation`)
        }
        const violations = database.prepare(`PRAGMA foreign_key_check("${spec.name}")`).all()
        if (violations.length > 0) {
            throw new Error(`${MIGRATION_ID}: ${spec.name} failed foreign key validation`)
        }
    }
}

function applyMissionFactsMigration(database: Database): void {
    assertParentTables(database)
    preflightTargetTables(database)
    database.transaction(() => {
        for (const spec of tableSpecs) {
            if (!tableExists(database, spec.name)) database.prepare(spec.createSql).run()
        }
        for (const key of missionCounterColumns) ensureSchemaColumn(database, key)
        for (const key of activeCounterColumns) ensureSchemaColumn(database, key)
        for (const key of periodicColumns) ensureSchemaColumn(database, key)
        ensureSchemaColumn(database, "players_quest_progress.host_finished")
        assertFinalSchema(database)
    })()
}

export const missionFactsMigration: DormantWdfpMigration = {
    id: MIGRATION_ID,
    apply: applyMissionFactsMigration,
}
