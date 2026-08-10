import type { Database } from "better-sqlite3"

interface SchemaColumn {
    table: string
    column: string
    definition: "INTEGER NOT NULL DEFAULT 0"
}

const integerZeroColumn = (
    table: string,
    column: string,
): SchemaColumn => ({ table, column, definition: "INTEGER NOT NULL DEFAULT 0" })

const schemaColumns = {
    "players_periodic_snapshots.single_play_count": integerZeroColumn("players_periodic_snapshots", "single_play_count"),
    "players_periodic_snapshots.single_clear_count": integerZeroColumn("players_periodic_snapshots", "single_clear_count"),
    "players_periodic_snapshots.multi_play_count": integerZeroColumn("players_periodic_snapshots", "multi_play_count"),
    "players_periodic_snapshots.multi_clear_count": integerZeroColumn("players_periodic_snapshots", "multi_clear_count"),
    "players_periodic_snapshots.multi_host_clear_count": integerZeroColumn("players_periodic_snapshots", "multi_host_clear_count"),
    "players_periodic_snapshots.multi_guest_clear_count": integerZeroColumn("players_periodic_snapshots", "multi_guest_clear_count"),
    "players_periodic_snapshots.dash_count": integerZeroColumn("players_periodic_snapshots", "dash_count"),
    "players_periodic_snapshots.power_flip_count": integerZeroColumn("players_periodic_snapshots", "power_flip_count"),
    "players_periodic_snapshots.login_days": integerZeroColumn("players_periodic_snapshots", "login_days"),
    "players_mission_battle_counters.single_rank_ss_count": integerZeroColumn("players_mission_battle_counters", "single_rank_ss_count"),
    "players_active_mission_counters.total_equipment_equip_count": integerZeroColumn("players_active_mission_counters", "total_equipment_equip_count"),
    "players_active_mission_counters.total_unison_set_count": integerZeroColumn("players_active_mission_counters", "total_unison_set_count"),
    "players_active_mission_counters.total_party_character_set_count": integerZeroColumn("players_active_mission_counters", "total_party_character_set_count"),
    "players_active_mission_counters.total_injected_exp_count": integerZeroColumn("players_active_mission_counters", "total_injected_exp_count"),
    "players_active_mission_counters.total_gacha_campaign_count": integerZeroColumn("players_active_mission_counters", "total_gacha_campaign_count"),
    "players_active_mission_counters.practice_quest_challenge_count": integerZeroColumn("players_active_mission_counters", "practice_quest_challenge_count"),
    "players_quest_progress.host_finished": integerZeroColumn("players_quest_progress", "host_finished"),
} as const

export type SchemaColumnKey = keyof typeof schemaColumns

interface RawColumnInfo {
    name: string
    type: string
    notnull: number
    dflt_value: string | null
    pk: number
}

function isZeroDefault(value: string | null): boolean {
    if (value === null) return false
    let normalized = value.trim()
    while (normalized.startsWith("(") && normalized.endsWith(")")) {
        normalized = normalized.slice(1, -1).trim()
    }
    return normalized === "0"
}

function isCanonicalColumn(column: RawColumnInfo): boolean {
    return column.type.toUpperCase() === "INTEGER"
        && column.notnull === 1
        && isZeroDefault(column.dflt_value)
        && column.pk === 0
}

export function ensureSchemaColumn(
    database: Database,
    key: SchemaColumnKey,
): boolean {
    if (!Object.prototype.hasOwnProperty.call(schemaColumns, key)) {
        throw new Error(`Unknown schema column: ${String(key)}`)
    }
    const schema = schemaColumns[key]
    const readColumns = (): RawColumnInfo[] => database
        .prepare(`PRAGMA table_info("${schema.table}")`)
        .all() as RawColumnInfo[]

    const before = readColumns()
    if (before.length === 0) {
        throw new Error(`Schema parent table does not exist: ${schema.table}`)
    }
    const existing = before.find(column => column.name === schema.column)
    if (existing !== undefined) {
        if (!isCanonicalColumn(existing)) {
            throw new Error(`Schema has non-canonical column: ${key}`)
        }
        return false
    }

    database.prepare(
        `ALTER TABLE "${schema.table}" ADD COLUMN "${schema.column}" ${schema.definition}`,
    ).run()
    const added = readColumns().find(column => column.name === schema.column)
    if (added === undefined || !isCanonicalColumn(added)) {
        throw new Error(`Failed to create canonical schema column: ${key}`)
    }
    return true
}
