import type { Database } from "better-sqlite3"
import type { DormantWdfpMigration } from "./contract"

const MIGRATION_ID = "wdfp/pass-card/v1"
const PASS_CARD_TABLE = "players_pass_cards"
const REWARD_TABLE = "players_pass_card_rewards"

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

const passCardColumns: readonly ColumnShape[] = [
    { name: "player_id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 1 },
    { name: "event_id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 2 },
    { name: "point", type: "INTEGER", notnull: 1, defaultValue: "0", pk: 0 },
    { name: "is_buy", type: "INTEGER", notnull: 1, defaultValue: "0", pk: 0 },
    { name: "login_baseline", type: "INTEGER", notnull: 0, defaultValue: null, pk: 0 },
]

const rewardColumns: readonly ColumnShape[] = [
    { name: "player_id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 1 },
    { name: "event_id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 2 },
    { name: "reward_id", type: "INTEGER", notnull: 1, defaultValue: null, pk: 3 },
    { name: "is_received_1", type: "INTEGER", notnull: 1, defaultValue: "0", pk: 0 },
    { name: "is_received_2", type: "INTEGER", notnull: 1, defaultValue: "0", pk: 0 },
]

const passCardForeignKeys = ["players|CASCADE|player_id|id"]
const rewardForeignKeys = [
    "players_pass_cards|CASCADE|player_id,event_id|player_id,event_id",
    "players|CASCADE|player_id|id",
].sort()

const createPassCardTableSql = `CREATE TABLE players_pass_cards (
    player_id INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    point INTEGER NOT NULL DEFAULT 0,
    is_buy INTEGER NOT NULL DEFAULT 0,
    login_baseline INTEGER,
    PRIMARY KEY (player_id, event_id),
    FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
)`

const createRewardTableSql = `CREATE TABLE players_pass_card_rewards (
    player_id INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    reward_id INTEGER NOT NULL,
    is_received_1 INTEGER NOT NULL DEFAULT 0,
    is_received_2 INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, event_id, reward_id),
    FOREIGN KEY (player_id, event_id)
        REFERENCES players_pass_cards (player_id, event_id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
)`

function tableExists(database: Database, tableName: string): boolean {
    return database.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
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

function isCanonicalPassCardTable(database: Database): boolean {
    return sameColumns(getColumns(database, PASS_CARD_TABLE), passCardColumns)
        && sameStrings(getForeignKeyShapes(database, PASS_CARD_TABLE), passCardForeignKeys)
}

function isCanonicalRewardTable(database: Database): boolean {
    return sameColumns(getColumns(database, REWARD_TABLE), rewardColumns)
        && sameStrings(getForeignKeyShapes(database, REWARD_TABLE), rewardForeignKeys)
}

function assertForeignKeyIntegrity(database: Database): void {
    for (const tableName of [PASS_CARD_TABLE, REWARD_TABLE]) {
        if (!tableExists(database, tableName)) continue
        const violations = database.prepare(`PRAGMA foreign_key_check(${tableName})`).all()
        if (violations.length > 0) {
            throw new Error(`${MIGRATION_ID}: ${tableName} failed foreign key validation`)
        }
    }
}

function assertCanonicalSchema(database: Database): void {
    if (!isCanonicalPassCardTable(database) || !isCanonicalRewardTable(database)) {
        throw new Error(`${MIGRATION_ID}: canonical schema validation failed`)
    }
    assertForeignKeyIntegrity(database)
}

function applyPassCardMigration(database: Database): void {
    if (!tableExists(database, "players")) {
        throw new Error(`${MIGRATION_ID}: players table is required`)
    }

    const hasPassCards = tableExists(database, PASS_CARD_TABLE)
    const hasRewards = tableExists(database, REWARD_TABLE)
    if (!hasPassCards && hasRewards) {
        throw new Error(`${MIGRATION_ID}: child table exists without parent`)
    }
    if (hasPassCards && !isCanonicalPassCardTable(database)) {
        throw new Error(`${MIGRATION_ID}: unknown parent schema; refusing destructive repair`)
    }
    if (hasRewards && !isCanonicalRewardTable(database)) {
        throw new Error(`${MIGRATION_ID}: unknown child schema; refusing destructive repair`)
    }
    if (hasPassCards && hasRewards) {
        assertCanonicalSchema(database)
        return
    }

    database.transaction(() => {
        if (!hasPassCards) database.prepare(createPassCardTableSql).run()
        database.prepare(createRewardTableSql).run()
        assertCanonicalSchema(database)
    })()
}

export const passCardMigration: DormantWdfpMigration = {
    id: MIGRATION_ID,
    apply: applyPassCardMigration,
}
