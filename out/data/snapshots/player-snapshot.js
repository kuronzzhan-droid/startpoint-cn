"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restorePlayerSaveSnapshotV2Sync = exports.validatePlayerSaveSnapshotV2Sync = exports.isPlayerSaveSnapshotV2 = exports.createPlayerSaveSnapshotV2Sync = exports.assertPlayerSnapshotCoverageSync = exports.PLAYER_SNAPSHOT_V2_TABLES = void 0;
const weapon_riven_1 = require("./weapon-riven");
const schema_compatibility_1 = require("./schema-compatibility");
const storage_layout_1 = require("../../lib/storage-layout");
const player_time_compat_1 = require("../../lib/player-time-compat");
const ARCHIVE_HISTORY_TABLES = new Set([
    "players_mails",
    "players_receive_history",
    "players_practice_battle_history",
]);
// Dependency order. Every durable table directly owned by a player must be
// listed here. The coverage audit below intentionally makes future exports
// fail closed when a new player-owned table is added without a snapshot policy.
exports.PLAYER_SNAPSHOT_V2_TABLES = Object.freeze([
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
    "player_weapon_rivens",
    "players_quest_progress",
    "players_character_quest_clears",
    "players_party_member_co_clears",
    "players_party_race_clears",
    "players_periodic_snapshots",
    "players_mission_battle_counters",
    "players_gacha_info",
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
]);
const EXCLUDED_PLAYER_STATE = Object.freeze([
    {
        tables: ["player_weapon_riven_sequences"],
        policy: "preserve-target",
        reason: "裂罅单调序号属于目标账号的历史高水位；导入不回退，创建时同时取现存卡片编号最大值。",
    },
    {
        tables: ["player_time_state", "player_time_migration_ledger"],
        policy: "preserve-target",
        reason: "真实时间迁移标记和账本属于本服目标账号，导入保留目标既有模式及锚点；来源 timeBasis 仅作受校验的来源元数据，不新增迁移状态。",
    },
    {
        tables: ["abyss_floor_records"],
        policy: "preserve-target",
        reason: "深渊全服纪录属于本服公共历史，viewer_id 只作归属快照且无玩家外键；V1/V2 导入均不迁移、不回填、不删除。",
    },
    {
        tables: ["players_active_quests"],
        policy: "reset",
        reason: "未完成战斗恢复数据不能跨存档恢复，导入时清除。",
    },
    {
        tables: ["players_repair_versions"],
        policy: "reset",
        reason: "永久修复版本标记属于服务器派生状态，导入时清除并按当前版本重新校验。",
    },
    {
        tables: ["players_follows", "published_parties", "quest_npc_party_pool", "raid_event_global_kill_ledger"],
        policy: "preserve-target",
        reason: "跨玩家关系、公开副本和全局幂等账本不属于便携玩家存档，覆盖既有存档时保留目标侧数据。",
    },
    {
        tables: ["daily_vmoney_mail_grants"],
        policy: "preserve-target",
        reason: "每日邮件发放账本绑定本服目标账号；导入保留当天已发放事实，避免重试或旧存档重复授予。",
    },
    {
        tables: ["leaderboard_runs", "leaderboard_run_rounds", "leaderboard_settlement_results"],
        policy: "preserve-target",
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
        policy: "preserve-target",
        reason: "五王挑战的场次、成员和扣费/奖励回执绑定本服对局，不随存档迁移；覆盖时保留目标侧账本，避免影响同局其他玩家或重复结算。",
    },
    {
        tables: ["player_payment_receipts", "player_operation_receipts", "battle_settlement_ledger", "battle_receipt_payload_queue"],
        policy: "preserve-target",
        reason: "支付和协议请求回执属于服务器幂等账本，不是便携玩家进度；覆盖存档时保留目标侧记录，避免重试再次发放奖励。",
    },
]);
const REMAPPED_AUTOINCREMENT_IDS = new Map([
    ["players_mails", new Set(["id"])],
    ["players_receive_history", new Set(["id"])],
    ["players_practice_battle_history", new Set(["id"])],
]);
const MAX_TOTAL_ROWS = 500000;
const MAX_STRING_LENGTH = 8 * 1024 * 1024;
const TEXT_STORED_IN_INTEGER_COLUMNS = new Set([
    "players.stamina_heal_time",
    "players.exp_pooled_time",
]);
function getDefaultDatabase() {
    // Keep the default connection lazy. Read-only worker threads pass their
    // own connection and must not initialize the main writable database.
    return require("../db").getDb();
}
function quoteIdentifier(value) {
    return `"${value.replace(/"/g, '""')}"`;
}
function getTableInfo(db, table) {
    const logicalInfo = (0, storage_layout_1.getStorageSnapshotTableInfo)(db, table);
    if (logicalInfo)
        return logicalInfo;
    const rows = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
    if (rows.length === 0)
        throw new Error(`存档表不存在：${table}`);
    return rows;
}
function getTableColumns(db, table) {
    return getTableInfo(db, table).map(column => column.name);
}
function getPrimaryKeyColumns(db, table) {
    return getTableInfo(db, table)
        .filter(column => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map(column => column.name);
}
function getSchemaFingerprint(db) {
    return (0, schema_compatibility_1.getPlayerSnapshotSchemaFingerprint)(exports.PLAYER_SNAPSHOT_V2_TABLES, table => getTableInfo(db, table));
}
function getPlayerReferencingTables(db) {
    const tableRows = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `).all();
    const result = new Set();
    for (const { name } of tableRows) {
        const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(name)})`).all();
        if (foreignKeys.some(foreignKey => foreignKey.table === "players"))
            result.add(name);
    }
    return result;
}
function assertPlayerSnapshotCoverageSync(db = getDefaultDatabase()) {
    const classified = new Set(exports.PLAYER_SNAPSHOT_V2_TABLES.slice(1));
    // The physical values table is exported/restored through the logical
    // players_mission_counters view, including the original textual keys.
    if ((0, storage_layout_1.isCompactStorage)(db))
        classified.add(storage_layout_1.COMPACT_COUNTER_VALUES);
    for (const exclusion of EXCLUDED_PLAYER_STATE) {
        for (const table of exclusion.tables)
            classified.add(table);
    }
    const referencing = getPlayerReferencingTables(db);
    const unknown = [...referencing].filter(table => !classified.has(table)).sort();
    if (unknown.length > 0) {
        throw new Error(`发现尚未登记存档策略的玩家表：${unknown.join(", ")}`);
    }
}
exports.assertPlayerSnapshotCoverageSync = assertPlayerSnapshotCoverageSync;
function assertSnapshotScalar(value, context) {
    if (value === null)
        return;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new Error(`${context}: 数字不是有限值`);
        return;
    }
    if (typeof value === "string") {
        if (value.length > MAX_STRING_LENGTH)
            throw new Error(`${context}: 字符串过长`);
        return;
    }
    throw new Error(`${context}: 只允许字符串、数字或 null`);
}
function assertSnapshotColumnValue(value, table, column, context) {
    assertSnapshotScalar(value, context);
    if (value === null) {
        if (column.notnull === 1 || column.pk > 0)
            throw new Error(`${context}: 必填列不能为 null`);
        return;
    }
    const declaredType = TEXT_STORED_IN_INTEGER_COLUMNS.has(`${table}.${column.name}`)
        ? "TEXT"
        : column.type.trim().toUpperCase();
    if (declaredType === "INTEGER" && (typeof value !== "number" || !Number.isSafeInteger(value))) {
        throw new Error(`${context}: INTEGER 列必须是安全整数`);
    }
    if ((declaredType === "TEXT" || declaredType === "DATE") && typeof value !== "string") {
        throw new Error(`${context}: ${declaredType} 列必须是字符串`);
    }
}
function readSnapshotTable(db, table, playerId) {
    const columns = getTableColumns(db, table);
    const primaryKey = getPrimaryKeyColumns(db, table);
    const selectedColumns = columns.map(quoteIdentifier).join(", ");
    const whereColumn = table === "players" ? "id" : "player_id";
    const orderBy = primaryKey.length > 0
        ? ` ORDER BY ${primaryKey.map(quoteIdentifier).join(", ")}`
        : "";
    const rows = db.prepare(`
        SELECT ${selectedColumns}
        FROM ${quoteIdentifier(table)}
        WHERE ${quoteIdentifier(whereColumn)} = ?${orderBy}
    `).all(playerId);
    return {
        columns,
        rows: rows.map((row, rowIndex) => columns.map(column => {
            const value = row[column];
            assertSnapshotScalar(value, `${table}[${rowIndex}].${column}`);
            return value;
        })),
    };
}
function createPlayerSaveSnapshotV2Sync(playerId, db = getDefaultDatabase()) {
    if (!Number.isSafeInteger(playerId) || playerId < 1)
        throw new Error("玩家 ID 无效");
    assertPlayerSnapshotCoverageSync(db);
    const tables = {};
    let rowCount = 0;
    for (const table of exports.PLAYER_SNAPSHOT_V2_TABLES) {
        const tableData = readSnapshotTable(db, table, playerId);
        tables[table] = tableData;
        rowCount += tableData.rows.length;
    }
    if (tables.players.rows.length !== 1)
        throw new Error(`玩家 ${playerId} 不存在或数据不唯一`);
    const playerNameIndex = tables.players.columns.indexOf("name");
    const playerName = tables.players.rows[0][playerNameIndex];
    if (typeof playerName !== "string")
        throw new Error("玩家名称无效");
    const snapshot = {
        schema: "starpoint-cn-save",
        version: 2,
        scope: "player-archive",
        exportedAt: new Date().toISOString(),
        playerId,
        schemaFingerprint: getSchemaFingerprint(db),
        summary: {
            playerName,
            includedTableCount: exports.PLAYER_SNAPSHOT_V2_TABLES.length,
            rowCount,
            excludedState: EXCLUDED_PLAYER_STATE.map(entry => ({
                tables: [...entry.tables],
                policy: entry.policy,
                reason: entry.reason,
            })),
        },
        data: { tables },
    };
    const timeState = (0, player_time_compat_1.getExistingPlayerTimeStateSync)(playerId, db);
    if (timeState) {
        snapshot.timeBasis = {
            kind: "real-system", version: 1, cutoverRealMs: timeState.cutoverRealMs,
            dayAnchorMs: timeState.dayAnchorMs, weekAnchorMs: timeState.weekAnchorMs,
        };
    }
    snapshot.dailyMailBasis = {
        version: 1,
        mails: db.prepare(`SELECT g.bucket, g.mail_id FROM daily_vmoney_mail_grants g
            JOIN players_mails m ON m.id=g.mail_id AND m.player_id=g.player_id
            WHERE g.player_id=? ORDER BY g.bucket`).all(playerId)
            .map(row => ({ bucket: row.bucket, mailId: row.mail_id })),
    };
    return validatePlayerSaveSnapshotV2Sync(snapshot, db);
}
exports.createPlayerSaveSnapshotV2Sync = createPlayerSaveSnapshotV2Sync;
function isPlayerSaveSnapshotV2(value) {
    if (value === null || typeof value !== "object")
        return false;
    const candidate = value;
    return candidate.schema === "starpoint-cn-save" && candidate.version === 2;
}
exports.isPlayerSaveSnapshotV2 = isPlayerSaveSnapshotV2;
function validatePlayerSaveSnapshotV2Sync(value, db = getDefaultDatabase()) {
    if (!isPlayerSaveSnapshotV2(value))
        throw new Error("不是有效的 V2 玩家存档");
    const snapshot = value;
    if (snapshot.scope !== "player-archive")
        throw new Error(`不支持的存档范围：${String(snapshot.scope)}`);
    if (!Number.isSafeInteger(snapshot.playerId) || snapshot.playerId < 1)
        throw new Error("存档来源玩家 ID 无效");
    if (typeof snapshot.exportedAt !== "string" || !Number.isFinite(Date.parse(snapshot.exportedAt))) {
        throw new Error("存档导出时间无效");
    }
    if (snapshot.timeBasis !== undefined)
        (0, player_time_compat_1.validatePlayerArchiveTimeBasis)(snapshot.timeBasis);
    assertPlayerSnapshotCoverageSync(db);
    // Match the complete historical schema before accepting any missing columns.
    // Imports retain their original shape; SQLite supplies new column defaults.
    const compatibility = (0, schema_compatibility_1.resolvePlayerSnapshotSchemaCompatibility)(snapshot.schemaFingerprint, exports.PLAYER_SNAPSHOT_V2_TABLES, table => getTableInfo(db, table));
    if (!snapshot.data || typeof snapshot.data !== "object" || !snapshot.data.tables || typeof snapshot.data.tables !== "object") {
        throw new Error("存档缺少 data.tables");
    }
    const snapshotTables = exports.PLAYER_SNAPSHOT_V2_TABLES.filter(table => !(compatibility.beforeWeaponRiven && table === "player_weapon_rivens"));
    const expectedTables = new Set(snapshotTables);
    const actualTables = Object.keys(snapshot.data.tables);
    const missing = [...expectedTables].filter(table => !Object.prototype.hasOwnProperty.call(snapshot.data.tables, table));
    const extra = actualTables.filter(table => !expectedTables.has(table));
    if (missing.length > 0 || extra.length > 0) {
        throw new Error(`存档表集合不完整；缺少：${missing.join(", ") || "无"}；未知：${extra.join(", ") || "无"}`);
    }
    let totalRows = 0;
    for (const table of snapshotTables) {
        const tableData = snapshot.data.tables[table];
        if (!tableData || typeof tableData !== "object")
            throw new Error(`${table}: 表数据无效`);
        const tableInfo = (0, schema_compatibility_1.compatibleSnapshotColumns)(table, getTableInfo(db, table), compatibility);
        const expectedColumns = tableInfo.map(column => column.name);
        if (!Array.isArray(tableData.columns) || JSON.stringify(tableData.columns) !== JSON.stringify(expectedColumns)) {
            throw new Error(`${table}: 列定义与当前服务器不一致`);
        }
        if (!Array.isArray(tableData.rows))
            throw new Error(`${table}: rows 不是数组`);
        totalRows += tableData.rows.length;
        if (totalRows > MAX_TOTAL_ROWS)
            throw new Error(`存档行数超过安全上限 ${MAX_TOTAL_ROWS}`);
        const playerIdColumn = table === "players" ? "id" : "player_id";
        const playerIdIndex = expectedColumns.indexOf(playerIdColumn);
        for (let rowIndex = 0; rowIndex < tableData.rows.length; rowIndex++) {
            const row = tableData.rows[rowIndex];
            if (!Array.isArray(row) || row.length !== expectedColumns.length) {
                throw new Error(`${table}[${rowIndex}]: 列数不正确`);
            }
            for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
                assertSnapshotColumnValue(row[columnIndex], table, tableInfo[columnIndex], `${table}[${rowIndex}].${expectedColumns[columnIndex]}`);
            }
            if (row[playerIdIndex] !== snapshot.playerId) {
                throw new Error(`${table}[${rowIndex}]: 混入了其他玩家的数据`);
            }
            if (table === "player_weapon_rivens")
                (0, weapon_riven_1.validateWeaponRivenArchiveRow)(expectedColumns, row);
        }
    }
    if (snapshot.data.tables.players.rows.length !== 1)
        throw new Error("存档必须且只能包含一条 players 主记录");
    const playerTable = snapshot.data.tables.players;
    const playerName = playerTable.rows[0][playerTable.columns.indexOf("name")];
    if (!snapshot.summary || typeof snapshot.summary !== "object")
        throw new Error("存档缺少 summary");
    if (snapshot.summary.playerName !== playerName)
        throw new Error("存档摘要中的玩家名称不一致");
    if (snapshot.summary.includedTableCount !== snapshotTables.length) {
        throw new Error("存档摘要中的表数量不一致");
    }
    if (snapshot.summary.rowCount !== totalRows)
        throw new Error("存档摘要中的行数量不一致");
    if (snapshot.dailyMailBasis !== undefined) {
        const basis = snapshot.dailyMailBasis;
        if (!basis || basis.version !== 1 || !Array.isArray(basis.mails))
            throw new Error("Invalid daily-mail archive basis");
        const sourceMails = snapshot.data.tables.players_mails;
        const idIndex = sourceMails.columns.indexOf("id");
        const mailIds = new Set(sourceMails.rows.map(row => row[idIndex]));
        const seenIds = new Set(), seenBuckets = new Set();
        for (const mail of basis.mails) {
            if (!mail || !Number.isSafeInteger(mail.mailId) || mail.mailId < 1
                || typeof mail.bucket !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(mail.bucket)
                || !mailIds.has(mail.mailId) || seenIds.has(mail.mailId) || seenBuckets.has(mail.bucket)) {
                throw new Error("Invalid or duplicate daily-mail archive reference");
            }
            seenIds.add(mail.mailId);
            seenBuckets.add(mail.bucket);
        }
    }
    return snapshot;
}
exports.validatePlayerSaveSnapshotV2Sync = validatePlayerSaveSnapshotV2Sync;
function canonicalRows(table, columns, rows, targetPlayerId) {
    var _a;
    const omitted = (_a = REMAPPED_AUTOINCREMENT_IDS.get(table)) !== null && _a !== void 0 ? _a : new Set();
    const playerIdIndex = columns.indexOf("player_id");
    return rows.map(row => {
        const canonical = {};
        for (let index = 0; index < columns.length; index++) {
            const column = columns[index];
            if (omitted.has(column))
                continue;
            canonical[column] = index === playerIdIndex ? targetPlayerId : row[index];
        }
        return JSON.stringify(canonical);
    }).sort();
}
function assertRestoredTable(db, table, source, targetPlayerId) {
    const actual = readSnapshotTable(db, table, targetPlayerId);
    const migratedSource = table === "players_rush_events" && !source.columns.includes("tower_revision")
        ? { columns: [...source.columns, "tower_revision"], rows: source.rows.map(row => [...row, null]) }
        : table === "player_weapon_rivens" ? (0, weapon_riven_1.withWeaponRivenArchiveDefaults)(source) : source;
    const expectedRows = canonicalRows(table, migratedSource.columns, migratedSource.rows, targetPlayerId);
    const actualRows = canonicalRows(table, actual.columns, actual.rows, targetPlayerId);
    if (JSON.stringify(actualRows) !== JSON.stringify(expectedRows)) {
        throw new Error(`${table}: 写入后校验不一致`);
    }
}
function restorePlayerSaveSnapshotV2Sync(snapshotValue, targetPlayerId, options = {}, db = getDefaultDatabase()) {
    if (!Number.isSafeInteger(targetPlayerId) || targetPlayerId < 1)
        throw new Error("目标玩家 ID 无效");
    const snapshot = validatePlayerSaveSnapshotV2Sync(snapshotValue, db);
    const sourceItems = snapshot.data.tables.players_items;
    const portableItems = { columns: sourceItems.columns,
        rows: (0, weapon_riven_1.filterWeaponRivenInventoryRows)(sourceItems.columns, sourceItems.rows) };
    const target = db.prepare(`SELECT account_id FROM players WHERE id = ?`).get(targetPlayerId);
    if (!target)
        throw new Error(`目标玩家 ${targetPlayerId} 不存在`);
    const includeArchiveHistory = options.includeArchiveHistory !== false;
    const skippedTables = [...ARCHIVE_HISTORY_TABLES].filter(() => !includeArchiveHistory);
    // Exact legacy fingerprints were checked above. Absence in those archives
    // cannot express a request to erase cards introduced after their schema.
    if (!snapshot.data.tables.player_weapon_rivens)
        skippedTables.push("player_weapon_rivens");
    if ((0, storage_layout_1.isCompactStorage)(db))
        skippedTables.push(storage_layout_1.RETIRED_COUNTER_SNAPSHOTS);
    const restoredTables = exports.PLAYER_SNAPSHOT_V2_TABLES
        .filter(table => table !== "players")
        .filter(table => includeArchiveHistory || !ARCHIVE_HISTORY_TABLES.has(table))
        .filter(table => !skippedTables.includes(table));
    const resetTables = EXCLUDED_PLAYER_STATE
        .filter(entry => entry.policy === "reset")
        .flatMap(entry => [...entry.tables]);
    // Retain the destination's existing clock mode. Import starts its EXP
    // checkpoint here and never creates a time marker or copies source anchors.
    const targetTimeState = (0, player_time_compat_1.getExistingPlayerTimeStateSync)(targetPlayerId, db);
    const currentDate = (0, player_time_compat_1.getPlayerBusinessDateSync)(targetPlayerId, undefined, db);
    const currentPoolTime = currentDate.toISOString();
    const currentOffset = (0, player_time_compat_1.getPlayerBusinessOffsetSync)(targetPlayerId, db);
    let restoredRows = 1;
    const restore = db.transaction(() => {
        var _a, _b, _c;
        // Grants are target-local. Preserve their exact mail payload and claim
        // status while remapping IDs after the source mailbox is restored.
        const targetDailyMails = includeArchiveHistory
            ? db.prepare(`SELECT m.*, g.bucket AS grant_bucket FROM daily_vmoney_mail_grants g
                JOIN players_mails m ON m.id=g.mail_id AND m.player_id=g.player_id WHERE g.player_id=?`)
                .all(targetPlayerId)
            : [];
        const sourceDailyMailIds = new Set((_b = (_a = snapshot.dailyMailBasis) === null || _a === void 0 ? void 0 : _a.mails.map(mail => mail.mailId)) !== null && _b !== void 0 ? _b : []);
        const sourceMails = snapshot.data.tables.players_mails;
        const sourceMailIdIndex = sourceMails.columns.indexOf("id");
        const portableMails = { columns: sourceMails.columns,
            rows: sourceMails.rows.filter(row => !sourceDailyMailIds.has(row[sourceMailIdIndex])) };
        for (const table of [...restoredTables].reverse()) {
            db.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE player_id = ?`).run(targetPlayerId);
        }
        for (const table of resetTables) {
            db.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE player_id = ?`).run(targetPlayerId);
        }
        const playerTable = snapshot.data.tables.players;
        const sourcePlayer = playerTable.rows[0];
        const updateColumns = playerTable.columns.filter(column => column !== "id" && column !== "account_id");
        const updateValues = updateColumns.map(column => {
            if (column === "exp_pooled_time" || column === "last_login_time")
                return currentPoolTime;
            if (column === "time_offset")
                return currentOffset;
            return sourcePlayer[playerTable.columns.indexOf(column)];
        });
        const playerUpdate = db.prepare(`
            UPDATE players
            SET ${updateColumns.map(column => `${quoteIdentifier(column)} = ?`).join(", ")}
            WHERE id = ?
        `).run(...updateValues, targetPlayerId);
        if (playerUpdate.changes !== 1)
            throw new Error("目标玩家主记录更新失败");
        for (const table of restoredTables) {
            const tableData = table === "players_mails" ? portableMails
                : table === "players_items" ? portableItems : snapshot.data.tables[table];
            const omitted = (_c = REMAPPED_AUTOINCREMENT_IDS.get(table)) !== null && _c !== void 0 ? _c : new Set();
            const insertColumns = tableData.columns.filter(column => !omitted.has(column));
            if (tableData.rows.length === 0)
                continue;
            const placeholders = insertColumns.map(() => "?").join(", ");
            const insert = db.prepare(`
                INSERT INTO ${quoteIdentifier(table)} (${insertColumns.map(quoteIdentifier).join(", ")})
                VALUES (${placeholders})
            `);
            const playerIdIndex = tableData.columns.indexOf("player_id");
            for (const row of tableData.rows) {
                const values = insertColumns.map(column => {
                    const sourceIndex = tableData.columns.indexOf(column);
                    return sourceIndex === playerIdIndex ? targetPlayerId : row[sourceIndex];
                });
                insert.run(...values);
                restoredRows++;
            }
        }
        if (targetDailyMails.length) {
            const columns = sourceMails.columns.filter(column => column !== "id");
            const insertMail = db.prepare(`INSERT INTO players_mails (${columns.map(quoteIdentifier).join(",")})
                VALUES (${columns.map(() => "?").join(",")})`);
            for (const mail of targetDailyMails) {
                const result = insertMail.run(...columns.map(column => mail[column]));
                db.prepare("UPDATE daily_vmoney_mail_grants SET mail_id=? WHERE player_id=? AND bucket=?")
                    .run(Number(result.lastInsertRowid), targetPlayerId, mail.grant_bucket);
                restoredRows++;
            }
        }
        const restoredPlayer = readSnapshotTable(db, "players", targetPlayerId);
        if (restoredPlayer.rows.length !== 1)
            throw new Error("恢复后玩家主记录不唯一");
        const restoredPlayerRow = restoredPlayer.rows[0];
        for (let index = 0; index < playerTable.columns.length; index++) {
            const column = playerTable.columns[index];
            const expected = column === "id"
                ? targetPlayerId
                : column === "account_id"
                    ? target.account_id
                    : column === "exp_pooled_time" || column === "last_login_time"
                        ? currentPoolTime
                        : column === "time_offset"
                            ? currentOffset
                            : sourcePlayer[index];
            if (restoredPlayerRow[index] !== expected) {
                throw new Error(`players.${column}: 写入后校验不一致`);
            }
        }
        for (const table of restoredTables) {
            const expected = table === "players_mails"
                ? { columns: portableMails.columns, rows: [...portableMails.rows,
                        ...targetDailyMails.map(mail => portableMails.columns.map(column => mail[column]))] }
                : table === "players_items" ? portableItems : snapshot.data.tables[table];
            assertRestoredTable(db, table, expected, targetPlayerId);
        }
        // Remember imported identities even if every imported card is deleted
        // before the next creation. The target's historical high-water never falls.
        db.prepare(`INSERT INTO player_weapon_riven_sequences(player_id,last_id)
            VALUES (?,(SELECT COALESCE(MAX(riven_id),0) FROM player_weapon_rivens WHERE player_id=?))
            ON CONFLICT(player_id) DO UPDATE SET last_id=MAX(last_id,excluded.last_id)`)
            .run(targetPlayerId, targetPlayerId);
        (0, weapon_riven_1.clearInvalidWeaponRivenPartyReferences)(db, targetPlayerId);
        if (targetTimeState) {
            db.prepare("UPDATE player_time_state SET day_anchor_ms=?,week_anchor_ms=? WHERE player_id=?")
                .run(Math.max(targetTimeState.dayAnchorMs, currentDate.getTime()), Math.max(targetTimeState.weekAnchorMs, currentDate.getTime()), targetPlayerId);
        }
    });
    restore();
    return {
        restoredTables: restoredTables.length + 1,
        restoredRows,
        skippedTables,
        resetTables,
    };
}
exports.restorePlayerSaveSnapshotV2Sync = restorePlayerSaveSnapshotV2Sync;
