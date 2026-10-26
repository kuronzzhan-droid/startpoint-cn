import { createHash } from "crypto"
import { parseCrazyGachaState } from "../domains/crazy_gacha"
import { parseExBoostPendingRow } from "../domains/ex-boost-pending"
import { getExStatusPoolSync } from "../../lib/assets"
import { ALL_ABILITIES } from "../../lib/ex-boost-abilities"
import type { Database as BetterSqlite3Database } from "better-sqlite3"
import { COMPACT_COUNTER_VALUES, getStorageSnapshotTableInfo, isCompactStorage, RETIRED_COUNTER_SNAPSHOTS } from "../../lib/storage-layout"
import { getExistingPlayerTimeStateSync, getPlayerBusinessDateSync, getPlayerBusinessOffsetSync, PlayerArchiveTimeBasis, validatePlayerArchiveTimeBasis } from "../../lib/player-time-compat"

type SnapshotScalar = string | number | null

interface SnapshotTableData {
    columns: string[]
    rows: SnapshotScalar[][]
}

export class ExBoostImportConflictError extends Error {}

/** The native recovery dialog compares a paid candidate with the owned old EX. */
function assertExBoostComparisonCharacter(characters: SnapshotTableData, characterId: number): void {
    const character = characters.rows.find(row => row[characters.columns.indexOf("id")] === characterId)
    const status = character?.[characters.columns.indexOf("ex_boost_status_id")]
    const encodedAbilities = character?.[characters.columns.indexOf("ex_boost_ability_id_list")]
    const abilities = typeof encodedAbilities === "string"
        ? encodedAbilities === "" ? [] : encodedAbilities.split(",").map(Number) : null
    const groups = abilities?.map(id => ALL_ABILITIES.find(ability => ability.id === id)?.group)
    if (!Number.isSafeInteger(status) || ![1, 2, 3].some(tier => getExStatusPoolSync(tier)?.includes(status as number))
        || !abilities || abilities.length > 2 || groups?.includes(undefined)
        || new Set(groups).size !== abilities.length) {
        throw new ExBoostImportConflictError("存档缺少待选 EX 的角色或原 EX；请先在游戏中确认或放弃待选 EX，再导入此存档。")
    }
}

function assertExBoostImportContinuity(
    snapshot: PlayerSaveSnapshotV2, targetPlayerId: number, db: BetterSqlite3Database,
): void {
    const row = db.prepare("SELECT * FROM players_ex_boost_pending_draws WHERE player_id=?").get(targetPlayerId) as
        Record<string, unknown> | undefined
    if (!row) return
    const pending = parseExBoostPendingRow(row)
    const completed = db.prepare(`SELECT 1 FROM player_operation_receipts
        WHERE player_id=? AND operation='ex_boost_completion' AND request_key=?`).get(targetPlayerId, pending.drawId)
    if (completed) return
    const incoming = snapshot.data.tables.players_ex_boost_pending_draws
    // Old V2 archives preserve this target-local row. New archives may only
    // replace it with the exact same paid candidate, never silently discard it.
    if (incoming) {
        const candidate = incoming.rows.length === 1
            ? parseExBoostPendingRow(Object.fromEntries(incoming.columns.map((column, index) => [column, incoming.rows[0][index]])))
            : null
        if (JSON.stringify(candidate) !== JSON.stringify(pending)) {
            throw new ExBoostImportConflictError("当前有已支付的待选 EX；请先在游戏中确认或放弃，再导入其他 EX 状态的存档。")
        }
    }
    assertExBoostComparisonCharacter(snapshot.data.tables.players_characters, pending.characterId)
}

export interface PlayerSaveSnapshotV2 {
    schema: "starpoint-cn-save"
    version: 2
    scope: "player-archive"
    exportedAt: string
    playerId: number
    schemaFingerprint: string
    /** Optional for old V2 archives; the portable SQL fingerprint is unchanged. */
    timeBasis?: PlayerArchiveTimeBasis
    /** Exact source IDs for server-local daily grants; absent on old V2. */
    dailyMailBasis?: { version: 1; mails: Array<{ bucket: string; mailId: number }> }
    summary: {
        playerName: string
        includedTableCount: number
        rowCount: number
        excludedState: Array<{
            tables: string[]
            policy: "preserve-target" | "reset"
            reason: string
        }>
    }
    data: {
        tables: Record<string, SnapshotTableData>
    }
}

export interface RestorePlayerSnapshotOptions {
    includeArchiveHistory?: boolean
}

export interface RestorePlayerSnapshotResult {
    restoredTables: number
    restoredRows: number
    skippedTables: string[]
    resetTables: string[]
}

interface TableInfoRow {
    cid: number
    name: string
    type: string
    notnull: number
    dflt_value: string | null
    pk: number
}

const ARCHIVE_HISTORY_TABLES = new Set([
    "players_mails",
    "players_receive_history",
    "players_practice_battle_history",
])

// Dependency order. Every durable table directly owned by a player must be
// listed here. The coverage audit below intentionally makes future exports
// fail closed when a new player-owned table is added without a snapshot policy.
export const PLAYER_SNAPSHOT_V2_TABLES = Object.freeze([
    "players",
    "players_degrees",
    "players_options",
    "players_encyclopedia_keywords",
    "players_player_history_settings",
    "players_triggered_tutorials",
    "players_mails",
    "players_receive_history",
    "players_practice_battle_history",
    "players_cleared_regular_missions",
    "players_items",
    "players_collected_items",
    "daily_challenge_point_list_entries",
    "daily_challenge_point_list_campaigns",
    "players_characters",
    "players_characters_bond_tokens",
    "players_characters_mana_nodes",
    "players_character_awake_unlocks",
    "players_party_groups",
    "players_parties",
    "players_equipment",
    "players_quest_progress",
    "players_character_quest_clears",
    "players_party_member_co_clears",
    "players_party_race_clears",
    "players_periodic_snapshots",
    "players_mission_battle_counters",
    "players_gacha_info",
    "players_crazy_gacha",
    "players_gacha_campaigns",
    "players_drawn_quests",
    "players_periodic_reward_points",
    "players_active_missions",
    "players_active_missions_stages",
    "players_active_mission_counters",
    "players_active_mission_battle_condition_facts",
    "players_active_mission_battle_facts",
    "players_category_missions",
    "players_category_mission_stages",
    "players_mission_counters",
    "players_mission_counter_snapshots",
    "players_pass_cards",
    "players_pass_card_rewards",
    "players_box_gacha",
    "players_box_gacha_drawn_rewards",
    "players_shop_quotas",
    "players_exchange_campaign_receipts",
    "players_special_exchange_campaigns",
    "players_start_dash_exchange_campaigns",
    "players_multi_special_exchange_campaigns",
    "players_rush_events",
    "players_rush_events_cleared_folders",
    "players_rush_events_played_parties",
    "players_raid_event_overall_rewards",
    "players_carnival_event_records",
    "players_carnival_event_rewards",
    "players_carnival_event_reward_claims",
    "players_shop_purchases",
    "players_ex_boost_pending_draws",
    "players_shop_campaign_lineups",
    "players_bond_token_exchanges",
] as const)

// One additive schema generation. Older exact fingerprints retain destination
// paid pending draws and exchange/selection rights when these tables are absent.
const UPSTREAM_BUSINESS_TABLES = new Set<string>([
    "players_ex_boost_pending_draws", "players_shop_campaign_lineups", "players_bond_token_exchanges",
])

const EXCLUDED_PLAYER_STATE = Object.freeze([
    {
        tables: ["player_time_state", "player_time_migration_ledger"],
        policy: "preserve-target" as const,
        reason: "真实时间迁移标记和账本属于本服目标账号，导入保留目标既有模式及锚点；来源 timeBasis 仅作受校验的来源元数据，不新增迁移状态。",
    },
    {
        tables: ["abyss_floor_records"],
        policy: "preserve-target" as const,
        reason: "深渊全服纪录属于本服公共历史，viewer_id 只作归属快照且无玩家外键；V1/V2 导入均不迁移、不回填、不删除。",
    },
    {
        tables: ["players_active_quests"],
        policy: "reset" as const,
        reason: "未完成战斗恢复数据不能跨存档恢复，导入时清除。",
    },
    {
        tables: ["players_repair_versions"],
        policy: "reset" as const,
        reason: "永久修复版本标记属于服务器派生状态，导入时清除并按当前版本重新校验。",
    },
    {
        tables: ["players_follows", "published_parties", "quest_npc_party_pool", "raid_event_global_kill_ledger"],
        policy: "preserve-target" as const,
        reason: "跨玩家关系、公开副本和全局幂等账本不属于便携玩家存档，覆盖既有存档时保留目标侧数据。",
    },
    {
        tables: ["daily_vmoney_mail_grants"],
        policy: "preserve-target" as const,
        reason: "每日邮件发放账本绑定本服目标账号；导入保留当天已发放事实，避免重试或旧存档重复授予。",
    },
    {
        tables: ["leaderboard_runs", "leaderboard_run_rounds", "leaderboard_settlement_results"],
        policy: "preserve-target" as const,
        reason: "排行榜及独立深渊慢通关对局、轮次明细和结算结果绑定本服对局，不随玩家存档迁移，覆盖时保留目标侧数据；已获得铭牌随玩家存档迁移。",
    },
    {
        tables: [
            "five_boss_continue_receipts",
            "five_boss_solo_runs",
            "five_boss_gauntlet_runs",
            "five_boss_gauntlet_members",
            "five_boss_gauntlet_receipts",
        ],
        policy: "preserve-target" as const,
        reason: "五王挑战的场次、成员和扣费/奖励回执绑定本服对局，不随存档迁移；覆盖时保留目标侧账本，避免影响同局其他玩家或重复结算。",
    },
    {
        tables: ["player_payment_receipts", "player_operation_receipts", "battle_settlement_ledger", "battle_receipt_payload_queue"],
        policy: "preserve-target" as const,
        reason: "支付和协议请求回执属于服务器幂等账本，不是便携玩家进度；覆盖存档时保留目标侧记录，避免重试再次发放奖励。",
    },
])

const REMAPPED_AUTOINCREMENT_IDS = new Map<string, ReadonlySet<string>>([
    ["players_mails", new Set(["id"])],
    ["players_receive_history", new Set(["id"])],
    ["players_practice_battle_history", new Set(["id"])],
])

const MAX_TOTAL_ROWS = 500_000
const MAX_STRING_LENGTH = 8 * 1024 * 1024
const TEXT_STORED_IN_INTEGER_COLUMNS = new Set([
    "players.stamina_heal_time",
    "players.exp_pooled_time",
])

function getDefaultDatabase(): BetterSqlite3Database {
    // Keep the default connection lazy. Read-only worker threads pass their
    // own connection and must not initialize the main writable database.
    return require("../db").getDb() as BetterSqlite3Database
}

function quoteIdentifier(value: string): string {
    return `"${value.replace(/"/g, '""')}"`
}

function getTableInfo(db: BetterSqlite3Database, table: string): TableInfoRow[] {
    const logicalInfo = getStorageSnapshotTableInfo(db, table)
    if (logicalInfo) return logicalInfo
    const rows = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as TableInfoRow[]
    if (rows.length === 0) throw new Error(`存档表不存在：${table}`)
    return rows
}

function getTableColumns(db: BetterSqlite3Database, table: string): string[] {
    return getTableInfo(db, table).map(column => column.name)
}

function getPrimaryKeyColumns(db: BetterSqlite3Database, table: string): string[] {
    return getTableInfo(db, table)
        .filter(column => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map(column => column.name)
}

function matchArchiveColumnOrder(columns: TableInfoRow[], order: unknown): TableInfoRow[] | undefined {
    if (!Array.isArray(order) || order.length !== columns.length || new Set(order).size !== columns.length) return undefined
    const byName = new Map(columns.map(column => [column.name, column]))
    if (!order.every(name => typeof name === "string" && byName.has(name))) return undefined
    return order.map(name => byName.get(name)!)
}

function getSchemaFingerprint(
    db: BetterSqlite3Database,
    beforeAbyssTowerRevision = false,
    beforeEconomyExtensions = false,
    archiveTables?: PlayerSaveSnapshotV2["data"]["tables"],
    beforeCrazyGacha = false,
    beforeUpstreamBusiness = false,
): string {
    const schema = PLAYER_SNAPSHOT_V2_TABLES.filter(table => !(beforeEconomyExtensions && ["players_special_exchange_campaigns", "players_exchange_campaign_receipts", "players_shop_quotas"].includes(table)))
        .filter(table => !(beforeCrazyGacha && table === "players_crazy_gacha"))
        .filter(table => !(beforeUpstreamBusiness && UPSTREAM_BUSINESS_TABLES.has(table))).map(table => ({
        table,
        columns: (() => {
            const columns = getTableInfo(db, table)
                .filter(column => !(beforeAbyssTowerRevision && table === "players_rush_events" && column.name === "tower_revision"))
            // Keep every SQL attribute in the fingerprint. Only reconstruct
            // the archive's physical column order when its complete name set matches.
            return matchArchiveColumnOrder(columns, archiveTables?.[table]?.columns) ?? columns
        })()
            .map(column => ({
            name: column.name,
            type: column.type,
            notnull: column.notnull,
            defaultValue: column.dflt_value,
            pk: column.pk,
        })),
    }))
    return createHash("sha256").update(JSON.stringify(schema)).digest("hex")
}

function getPlayerReferencingTables(db: BetterSqlite3Database): Set<string> {
    const tableRows = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `).all() as Array<{ name: string }>
    const result = new Set<string>()
    for (const { name } of tableRows) {
        const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(name)})`).all() as Array<{ table: string }>
        if (foreignKeys.some(foreignKey => foreignKey.table === "players")) result.add(name)
    }
    return result
}

export function assertPlayerSnapshotCoverageSync(
    db: BetterSqlite3Database = getDefaultDatabase(),
): void {
    const classified = new Set<string>(PLAYER_SNAPSHOT_V2_TABLES.slice(1))
    // The physical values table is exported/restored through the logical
    // players_mission_counters view, including the original textual keys.
    if (isCompactStorage(db)) classified.add(COMPACT_COUNTER_VALUES)
    for (const exclusion of EXCLUDED_PLAYER_STATE) {
        for (const table of exclusion.tables) classified.add(table)
    }
    const referencing = getPlayerReferencingTables(db)
    const unknown = [...referencing].filter(table => !classified.has(table)).sort()
    if (unknown.length > 0) {
        throw new Error(`发现尚未登记存档策略的玩家表：${unknown.join(", ")}`)
    }
}

function assertSnapshotScalar(value: unknown, context: string): asserts value is SnapshotScalar {
    if (value === null) return
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error(`${context}: 数字不是有限值`)
        return
    }
    if (typeof value === "string") {
        if (value.length > MAX_STRING_LENGTH) throw new Error(`${context}: 字符串过长`)
        return
    }
    throw new Error(`${context}: 只允许字符串、数字或 null`)
}

const MANA_REAL_ARCHIVE_PREFIX = "mana-counter-real-v1:"
const MAX_SQLITE_INTEGER = BigInt("9223372036854775807")

/** Only this statistical column has a legacy wide-number archive representation. */
function decodeArchivedManaCounter(value: string): number | bigint {
    if (/^[1-9][0-9]{15,18}$/.test(value)) {
        const integer = BigInt(value)
        if (integer > BigInt(Number.MAX_SAFE_INTEGER) && integer <= MAX_SQLITE_INTEGER) return integer
    }
    if (value.startsWith(MANA_REAL_ARCHIVE_PREFIX)) {
        const text = value.slice(MANA_REAL_ARCHIVE_PREFIX.length)
        const real = Number(text)
        if (text === String(real) && Number.isFinite(real) && Number.isInteger(real) && real >= 0
            && !Number.isSafeInteger(real)) return real
    }
    throw new Error("players.total_mana_obtained: 无效的极端累计玛纳存档表示")
}

function assertSnapshotColumnValue(
    value: unknown,
    table: string,
    column: TableInfoRow,
    context: string,
): asserts value is SnapshotScalar {
    assertSnapshotScalar(value, context)
    if (value === null) {
        if (column.notnull === 1 || column.pk > 0) throw new Error(`${context}: 必填列不能为 null`)
        return
    }
    if (table === "players" && column.name === "total_mana_obtained" && typeof value === "string") {
        decodeArchivedManaCounter(value)
        return
    }
    const declaredType = TEXT_STORED_IN_INTEGER_COLUMNS.has(`${table}.${column.name}`)
        ? "TEXT"
        : column.type.trim().toUpperCase()
    if (declaredType === "INTEGER" && (typeof value !== "number" || !Number.isSafeInteger(value))) {
        throw new Error(`${context}: INTEGER 列必须是安全整数`)
    }
    if ((declaredType === "TEXT" || declaredType === "DATE") && typeof value !== "string") {
        throw new Error(`${context}: ${declaredType} 列必须是字符串`)
    }
}

function readSnapshotTable(
    db: BetterSqlite3Database,
    table: string,
    playerId: number,
): SnapshotTableData {
    const columns = getTableColumns(db, table)
    const primaryKey = getPrimaryKeyColumns(db, table)
    const selectedColumns = columns.map(column => table === "players" && column === "total_mana_obtained"
        ? `${quoteIdentifier(column)}, typeof(${quoteIdentifier(column)}) AS __mana_counter_type,
            CAST(${quoteIdentifier(column)} AS TEXT) AS __mana_counter_text`
        : quoteIdentifier(column)).join(", ")
    const whereColumn = table === "players" ? "id" : "player_id"
    const orderBy = primaryKey.length > 0
        ? ` ORDER BY ${primaryKey.map(quoteIdentifier).join(", ")}`
        : ""
    const rows = db.prepare(`
        SELECT ${selectedColumns}
        FROM ${quoteIdentifier(table)}
        WHERE ${quoteIdentifier(whereColumn)} = ?${orderBy}
    `).all(playerId) as Array<Record<string, unknown>>
    return {
        columns,
        rows: rows.map((row, rowIndex) => columns.map(column => {
            let value = row[column]
            if (table === "players" && column === "total_mana_obtained") {
                if (row.__mana_counter_type === "integer") {
                    const exact = BigInt(row.__mana_counter_text as string)
                    if (exact > BigInt(Number.MAX_SAFE_INTEGER)) value = String(exact)
                } else if (row.__mana_counter_type === "real" && typeof value === "number"
                    && !Number.isSafeInteger(value)) {
                    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
                        throw new Error("players.total_mana_obtained: 不能导出非法累计玛纳")
                    }
                    // Number.toString is a round-trip representation of the stored double;
                    // SQLite CAST AS TEXT may print fewer significant digits, so do not use it here.
                    value = MANA_REAL_ARCHIVE_PREFIX + String(value)
                }
            }
            assertSnapshotScalar(value, `${table}[${rowIndex}].${column}`)
            return value
        })),
    }
}

export function createPlayerSaveSnapshotV2Sync(
    playerId: number,
    db: BetterSqlite3Database = getDefaultDatabase(),
): PlayerSaveSnapshotV2 {
    if (!Number.isSafeInteger(playerId) || playerId < 1) throw new Error("玩家 ID 无效")
    assertPlayerSnapshotCoverageSync(db)

    const tables: Record<string, SnapshotTableData> = {}
    let rowCount = 0
    for (const table of PLAYER_SNAPSHOT_V2_TABLES) {
        const tableData = readSnapshotTable(db, table, playerId)
        tables[table] = tableData
        rowCount += tableData.rows.length
    }
    if (tables.players.rows.length !== 1) throw new Error(`玩家 ${playerId} 不存在或数据不唯一`)

    const playerNameIndex = tables.players.columns.indexOf("name")
    const playerName = tables.players.rows[0][playerNameIndex]
    if (typeof playerName !== "string") throw new Error("玩家名称无效")

    const snapshot: PlayerSaveSnapshotV2 = {
        schema: "starpoint-cn-save",
        version: 2,
        scope: "player-archive",
        exportedAt: new Date().toISOString(),
        playerId,
        schemaFingerprint: getSchemaFingerprint(db),
        summary: {
            playerName,
            includedTableCount: PLAYER_SNAPSHOT_V2_TABLES.length,
            rowCount,
            excludedState: EXCLUDED_PLAYER_STATE.map(entry => ({
                tables: [...entry.tables],
                policy: entry.policy,
                reason: entry.reason,
            })),
        },
        data: { tables },
    }
    const timeState = getExistingPlayerTimeStateSync(playerId, db)
    if (timeState) {
        snapshot.timeBasis = {
            kind: "real-system", version: 1, cutoverRealMs: timeState.cutoverRealMs,
            dayAnchorMs: timeState.dayAnchorMs, weekAnchorMs: timeState.weekAnchorMs,
        }
    }
    snapshot.dailyMailBasis = {
        version: 1,
        mails: (db.prepare(`SELECT g.bucket, g.mail_id FROM daily_vmoney_mail_grants g
            JOIN players_mails m ON m.id=g.mail_id AND m.player_id=g.player_id
            WHERE g.player_id=? ORDER BY g.bucket`).all(playerId) as Array<{bucket: string; mail_id: number}>)
            .map(row => ({ bucket: row.bucket, mailId: row.mail_id })),
    }
    return validatePlayerSaveSnapshotV2Sync(snapshot, db)
}

export function isPlayerSaveSnapshotV2(value: unknown): value is PlayerSaveSnapshotV2 {
    if (value === null || typeof value !== "object") return false
    const candidate = value as Partial<PlayerSaveSnapshotV2>
    return candidate.schema === "starpoint-cn-save" && candidate.version === 2
}

export function validatePlayerSaveSnapshotV2Sync(
    value: unknown,
    db: BetterSqlite3Database = getDefaultDatabase(),
): PlayerSaveSnapshotV2 {
    if (!isPlayerSaveSnapshotV2(value)) throw new Error("不是有效的 V2 玩家存档")
    const snapshot = value as PlayerSaveSnapshotV2
    if (snapshot.scope !== "player-archive") throw new Error(`不支持的存档范围：${String(snapshot.scope)}`)
    if (!Number.isSafeInteger(snapshot.playerId) || snapshot.playerId < 1) throw new Error("存档来源玩家 ID 无效")
    if (typeof snapshot.exportedAt !== "string" || !Number.isFinite(Date.parse(snapshot.exportedAt))) {
        throw new Error("存档导出时间无效")
    }
    if (snapshot.timeBasis !== undefined) validatePlayerArchiveTimeBasis(snapshot.timeBasis)

    assertPlayerSnapshotCoverageSync(db)
    // Recognize only the existing portable schemas, with their exact SQL
    // attributes, in the archive's column order. Fresh and migrated databases
    // can contain identical named columns in different physical positions.
    const schema = [
        { beforeAbyssTowerRevision: false, beforeEconomyExtensions: false },
        { beforeAbyssTowerRevision: true, beforeEconomyExtensions: false },
        { beforeAbyssTowerRevision: false, beforeEconomyExtensions: true },
        { beforeAbyssTowerRevision: true, beforeEconomyExtensions: true },
    ].flatMap(profile => [{ ...profile, beforeCrazyGacha: false }, { ...profile, beforeCrazyGacha: true }])
        .flatMap(profile => [{ ...profile, beforeUpstreamBusiness: false }, { ...profile, beforeUpstreamBusiness: true }])
        .find(profile => snapshot.schemaFingerprint === getSchemaFingerprint(
        db, profile.beforeAbyssTowerRevision, profile.beforeEconomyExtensions, snapshot.data?.tables,
        profile.beforeCrazyGacha,
        profile.beforeUpstreamBusiness,
    ))
    if (!schema) {
        throw new Error("存档数据库结构与当前服务器不一致，拒绝执行覆盖；请先使用匹配版本迁移")
    }
    const { beforeAbyssTowerRevision, beforeEconomyExtensions, beforeCrazyGacha, beforeUpstreamBusiness } = schema
    if (!snapshot.data || typeof snapshot.data !== "object" || !snapshot.data.tables || typeof snapshot.data.tables !== "object") {
        throw new Error("存档缺少 data.tables")
    }

    const expectedTables = new Set<string>(PLAYER_SNAPSHOT_V2_TABLES.filter(table => !(beforeEconomyExtensions && ["players_special_exchange_campaigns", "players_exchange_campaign_receipts", "players_shop_quotas"].includes(table)))
        .filter(table => !(beforeCrazyGacha && table === "players_crazy_gacha"))
        .filter(table => !(beforeUpstreamBusiness && UPSTREAM_BUSINESS_TABLES.has(table))))
    const actualTables = Object.keys(snapshot.data.tables)
    const missing = [...expectedTables].filter(table => !Object.prototype.hasOwnProperty.call(snapshot.data.tables, table))
    const extra = actualTables.filter(table => !expectedTables.has(table))
    if (missing.length > 0 || extra.length > 0) {
        throw new Error(`存档表集合不完整；缺少：${missing.join(", ") || "无"}；未知：${extra.join(", ") || "无"}`)
    }

    let totalRows = 0
    for (const table of PLAYER_SNAPSHOT_V2_TABLES) {
        if (beforeUpstreamBusiness && UPSTREAM_BUSINESS_TABLES.has(table)) continue
        if (beforeCrazyGacha && table === "players_crazy_gacha") continue
        if (beforeEconomyExtensions && ["players_special_exchange_campaigns", "players_exchange_campaign_receipts", "players_shop_quotas"].includes(table)) continue
        const tableData = snapshot.data.tables[table]
        if (!tableData || typeof tableData !== "object") throw new Error(`${table}: 表数据无效`)
        const targetColumns = getTableInfo(db, table).filter(column =>
            !(beforeAbyssTowerRevision && table === "players_rush_events" && column.name === "tower_revision"))
        const tableInfo = matchArchiveColumnOrder(targetColumns, tableData.columns)
        if (!tableInfo) {
            throw new Error(`${table}: 列定义与当前服务器不一致`)
        }
        const expectedColumns = tableInfo.map(column => column.name)
        if (!Array.isArray(tableData.rows)) throw new Error(`${table}: rows 不是数组`)
        totalRows += tableData.rows.length
        if (totalRows > MAX_TOTAL_ROWS) throw new Error(`存档行数超过安全上限 ${MAX_TOTAL_ROWS}`)

        const playerIdColumn = table === "players" ? "id" : "player_id"
        const playerIdIndex = expectedColumns.indexOf(playerIdColumn)
        for (let rowIndex = 0; rowIndex < tableData.rows.length; rowIndex++) {
            const row = tableData.rows[rowIndex]
            if (!Array.isArray(row) || row.length !== expectedColumns.length) {
                throw new Error(`${table}[${rowIndex}]: 列数不正确`)
            }
            for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
                assertSnapshotColumnValue(
                    row[columnIndex],
                    table,
                    tableInfo[columnIndex],
                    `${table}[${rowIndex}].${expectedColumns[columnIndex]}`,
                )
            }
            if (row[playerIdIndex] !== snapshot.playerId) {
                throw new Error(`${table}[${rowIndex}]: 混入了其他玩家的数据`)
            }
            if (table === "players_crazy_gacha") {
                const gachaId = row[expectedColumns.indexOf("gacha_id")]
                const sessionNumber = row[expectedColumns.indexOf("session_number")]
                if (gachaId !== 100 || !Number.isSafeInteger(sessionNumber) || Number(sessionNumber) < 1) throw new Error("Invalid crazy gacha archive identity")
                parseCrazyGachaState(row[expectedColumns.indexOf("state_json")] as string)
            }
            if (table === "players_ex_boost_pending_draws") {
                const pending = parseExBoostPendingRow(Object.fromEntries(expectedColumns.map((name, index) => [name, row[index]])))
                assertExBoostComparisonCharacter(snapshot.data.tables.players_characters, pending.characterId)
            }
        }
    }
    if (snapshot.data.tables.players.rows.length !== 1) throw new Error("存档必须且只能包含一条 players 主记录")
    const playerTable = snapshot.data.tables.players
    const playerName = playerTable.rows[0][playerTable.columns.indexOf("name")]
    if (!snapshot.summary || typeof snapshot.summary !== "object") throw new Error("存档缺少 summary")
    if (snapshot.summary.playerName !== playerName) throw new Error("存档摘要中的玩家名称不一致")
    if (snapshot.summary.includedTableCount !== expectedTables.size) {
        throw new Error("存档摘要中的表数量不一致")
    }
    if (snapshot.summary.rowCount !== totalRows) throw new Error("存档摘要中的行数量不一致")
    if (snapshot.dailyMailBasis !== undefined) {
        const basis = snapshot.dailyMailBasis
        if (!basis || basis.version !== 1 || !Array.isArray(basis.mails)) throw new Error("Invalid daily-mail archive basis")
        const sourceMails = snapshot.data.tables.players_mails
        const idIndex = sourceMails.columns.indexOf("id")
        const mailIds = new Set(sourceMails.rows.map(row => row[idIndex]))
        const seenIds = new Set<number>(), seenBuckets = new Set<string>()
        for (const mail of basis.mails) {
            if (!mail || !Number.isSafeInteger(mail.mailId) || mail.mailId < 1
                || typeof mail.bucket !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(mail.bucket)
                || !mailIds.has(mail.mailId) || seenIds.has(mail.mailId) || seenBuckets.has(mail.bucket)) {
                throw new Error("Invalid or duplicate daily-mail archive reference")
            }
            seenIds.add(mail.mailId); seenBuckets.add(mail.bucket)
        }
    }
    return snapshot
}

function canonicalRows(
    table: string,
    columns: string[],
    rows: SnapshotScalar[][],
    targetPlayerId: number,
): string[] {
    const omitted = REMAPPED_AUTOINCREMENT_IDS.get(table) ?? new Set<string>()
    const orderedColumns = columns.filter(column => !omitted.has(column)).sort()
        .map(column => ({ column, index: columns.indexOf(column) }))
    return rows.map(row => {
        const canonical: Record<string, SnapshotScalar> = {}
        for (const { column, index } of orderedColumns) {
            canonical[column] = column === "player_id" ? targetPlayerId : row[index]
        }
        return JSON.stringify(canonical)
    }).sort()
}

function assertRestoredTable(
    db: BetterSqlite3Database,
    table: string,
    source: SnapshotTableData,
    targetPlayerId: number,
): void {
    const actual = readSnapshotTable(db, table, targetPlayerId)
    const migratedSource = table === "players_rush_events" && !source.columns.includes("tower_revision")
        ? { columns: [...source.columns, "tower_revision"], rows: source.rows.map(row => [...row, null]) }
        : source
    const expectedRows = canonicalRows(table, migratedSource.columns, migratedSource.rows, targetPlayerId)
    const actualRows = canonicalRows(table, actual.columns, actual.rows, targetPlayerId)
    if (JSON.stringify(actualRows) !== JSON.stringify(expectedRows)) {
        throw new Error(`${table}: 写入后校验不一致`)
    }
}

export function restorePlayerSaveSnapshotV2Sync(
    snapshotValue: unknown,
    targetPlayerId: number,
    options: RestorePlayerSnapshotOptions = {},
    db: BetterSqlite3Database = getDefaultDatabase(),
): RestorePlayerSnapshotResult {
    if (!Number.isSafeInteger(targetPlayerId) || targetPlayerId < 1) throw new Error("目标玩家 ID 无效")
    const snapshot = validatePlayerSaveSnapshotV2Sync(snapshotValue, db)
    const target = db.prepare(`SELECT account_id FROM players WHERE id = ?`).get(targetPlayerId) as { account_id: number } | undefined
    if (!target) throw new Error(`目标玩家 ${targetPlayerId} 不存在`)

    const includeArchiveHistory = options.includeArchiveHistory !== false
    const skippedTables = [...ARCHIVE_HISTORY_TABLES].filter(() => !includeArchiveHistory)
    if (isCompactStorage(db)) skippedTables.push(RETIRED_COUNTER_SNAPSHOTS)
    const restoredTables = PLAYER_SNAPSHOT_V2_TABLES
        .filter(table => table !== "players")
        // Precisely recognized old V2 archives lack this table and preserve target rights.
        .filter(table => !!snapshot.data.tables[table])
        .filter(table => includeArchiveHistory || !ARCHIVE_HISTORY_TABLES.has(table))
        .filter(table => !skippedTables.includes(table))
    const resetTables = EXCLUDED_PLAYER_STATE
        .filter(entry => entry.policy === "reset")
        .flatMap(entry => [...entry.tables])
    // Retain the destination's existing clock mode. Import starts its EXP
    // checkpoint here and never creates a time marker or copies source anchors.
    const targetTimeState = getExistingPlayerTimeStateSync(targetPlayerId, db)
    const currentDate = getPlayerBusinessDateSync(targetPlayerId, undefined, db)
    const currentPoolTime = currentDate.toISOString()
    const currentOffset = getPlayerBusinessOffsetSync(targetPlayerId, db)

    let restoredRows = 1
    const restore = db.transaction(() => {
        // Check against the destination while holding the restore transaction,
        // before deleting any character, inventory, or pending selection rows.
        assertExBoostImportContinuity(snapshot, targetPlayerId, db)
        // Grants are target-local. Preserve their exact mail payload and claim
        // status while remapping IDs after the source mailbox is restored.
        const targetDailyMails = includeArchiveHistory
            ? db.prepare(`SELECT m.*, g.bucket AS grant_bucket FROM daily_vmoney_mail_grants g
                JOIN players_mails m ON m.id=g.mail_id AND m.player_id=g.player_id WHERE g.player_id=?`)
                .all(targetPlayerId) as Array<Record<string, SnapshotScalar>>
            : []
        const sourceDailyMailIds = new Set(snapshot.dailyMailBasis?.mails.map(mail => mail.mailId) ?? [])
        const sourceMails = snapshot.data.tables.players_mails
        const sourceMailIdIndex = sourceMails.columns.indexOf("id")
        const portableMails = { columns: sourceMails.columns,
            rows: sourceMails.rows.filter(row => !sourceDailyMailIds.has(row[sourceMailIdIndex] as number)) }
        for (const table of [...restoredTables].reverse()) {
            db.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE player_id = ?`).run(targetPlayerId)
        }
        for (const table of resetTables) {
            db.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE player_id = ?`).run(targetPlayerId)
        }

        const playerTable = snapshot.data.tables.players
        const sourcePlayer = playerTable.rows[0]
        const updateColumns = playerTable.columns.filter(column => column !== "id" && column !== "account_id")
        const updateValues = updateColumns.map(column => {
            if (column === "exp_pooled_time" || column === "last_login_time") return currentPoolTime
            if (column === "time_offset") return currentOffset
            if (column === "total_mana_obtained") {
                const mana = sourcePlayer[playerTable.columns.indexOf(column)]
                if (typeof mana === "string") return decodeArchivedManaCounter(mana)
            }
            return sourcePlayer[playerTable.columns.indexOf(column)]
        })
        const playerUpdate = db.prepare(`
            UPDATE players
            SET ${updateColumns.map(column => `${quoteIdentifier(column)} = ?`).join(", ")}
            WHERE id = ?
        `).run(...updateValues, targetPlayerId)
        if (playerUpdate.changes !== 1) throw new Error("目标玩家主记录更新失败")

        for (const table of restoredTables) {
            const tableData = table === "players_mails" ? portableMails : snapshot.data.tables[table]
            const omitted = REMAPPED_AUTOINCREMENT_IDS.get(table) ?? new Set<string>()
            const insertColumns = tableData.columns.filter(column => !omitted.has(column))
            if (tableData.rows.length === 0) continue
            const placeholders = insertColumns.map(() => "?").join(", ")
            const insert = db.prepare(`
                INSERT INTO ${quoteIdentifier(table)} (${insertColumns.map(quoteIdentifier).join(", ")})
                VALUES (${placeholders})
            `)
            const playerIdIndex = tableData.columns.indexOf("player_id")
            for (const row of tableData.rows) {
                const values = insertColumns.map(column => {
                    const sourceIndex = tableData.columns.indexOf(column)
                    return sourceIndex === playerIdIndex ? targetPlayerId : row[sourceIndex]
                })
                insert.run(...values)
                restoredRows++
            }
        }
        if (targetDailyMails.length) {
            const columns = sourceMails.columns.filter(column => column !== "id")
            const insertMail = db.prepare(`INSERT INTO players_mails (${columns.map(quoteIdentifier).join(",")})
                VALUES (${columns.map(() => "?").join(",")})`)
            for (const mail of targetDailyMails) {
                const result = insertMail.run(...columns.map(column => mail[column]))
                db.prepare("UPDATE daily_vmoney_mail_grants SET mail_id=? WHERE player_id=? AND bucket=?")
                    .run(Number(result.lastInsertRowid), targetPlayerId, mail.grant_bucket)
                restoredRows++
            }
        }

        const restoredPlayer = readSnapshotTable(db, "players", targetPlayerId)
        if (restoredPlayer.rows.length !== 1) throw new Error("恢复后玩家主记录不唯一")
        const restoredPlayerRow = restoredPlayer.rows[0]
        for (let index = 0; index < playerTable.columns.length; index++) {
            const column = playerTable.columns[index]
            const expected = column === "id"
                ? targetPlayerId
                : column === "account_id"
                    ? target.account_id
                    : column === "exp_pooled_time" || column === "last_login_time"
                        ? currentPoolTime
                        : column === "time_offset"
                            ? currentOffset
                            : sourcePlayer[index]
            if (restoredPlayerRow[restoredPlayer.columns.indexOf(column)] !== expected) {
                throw new Error(`players.${column}: 写入后校验不一致`)
            }
        }

        for (const table of restoredTables) {
            const expected = table === "players_mails"
                ? { columns: portableMails.columns, rows: [...portableMails.rows,
                    ...targetDailyMails.map(mail => portableMails.columns.map(column => mail[column]))] }
                : snapshot.data.tables[table]
            assertRestoredTable(db, table, expected, targetPlayerId)
        }
        if (targetTimeState) {
            db.prepare("UPDATE player_time_state SET day_anchor_ms=?,week_anchor_ms=? WHERE player_id=?")
                .run(Math.max(targetTimeState.dayAnchorMs, currentDate.getTime()),
                    Math.max(targetTimeState.weekAnchorMs, currentDate.getTime()), targetPlayerId)
        }
    })

    restore()
    return {
        restoredTables: restoredTables.length + 1,
        restoredRows,
        skippedTables,
        resetTables,
    }
}
