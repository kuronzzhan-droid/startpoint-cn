import type { Database } from "better-sqlite3"
import awakeMissionsAsset from "../../../../assets/mission_char_awake.json"
import awakeRewardsAsset from "../../../../assets/mission_char_awake_reward.json"
import {
    AWAKE_DEGREE_MIGRATION_ID,
    AWAKE_UNLOCK_TABLE,
    DEGREE_TABLE,
    assertAwakeDegreePrerequisiteSchema,
    assertExistingAwakeDegreeSchema,
    assertFinalAwakeDegreeSchema,
    createAwakeDegreeTablesAndIndex,
    ensureDegreeTrigger,
    hasTable,
} from "./awake-degree-schema"
import type { DormantWdfpMigration } from "./contract"

const EXPECTED_MISSION_COUNT = 144
const EXPECTED_UNLOCK_COUNT = 36
const EXPECTED_NON_UNLOCK_COUNT = 108

interface UnlockInstruction {
    missionId: number
    stageId: number
    characterId: number
    boardIndex: number
    awakeLevel: number
}

interface AwakeMasterPlan {
    missionIds: number[]
    unlocks: UnlockInstruction[]
}

interface MissionRow {
    id: number
    player_id: number
}

interface StageRow {
    id: number
    status: number
    player_id: number
    mission_id: number
}

interface PlayerDegreeRow {
    id: number
    degree_id: number
}

interface DataPlan {
    sourceMissions: MissionRow[]
    sourceStages: StageRow[]
    destinationMissions: Set<string>
    destinationStages: Map<string, StageRow>
    players: PlayerDegreeRow[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parsePositiveDecimal(value: unknown, label: string): number {
    if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
        throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: ${label} is not canonical decimal`)
    }
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: ${label} is not a positive safe integer`)
    }
    if (String(parsed) !== value) {
        throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: ${label} is not canonical decimal`)
    }
    return parsed
}

function buildAwakeMasterPlan(): AwakeMasterPlan {
    if (!isRecord(awakeMissionsAsset) || !isRecord(awakeRewardsAsset)) {
        throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: awake master root must be an object`)
    }
    const awakeMissions: Readonly<Record<string, unknown>> = awakeMissionsAsset
    const awakeRewards: Readonly<Record<string, unknown>> = awakeRewardsAsset
    const missionKeys = Object.keys(awakeMissions)
    const rewardKeys = Object.keys(awakeRewards)
    if (missionKeys.length !== EXPECTED_MISSION_COUNT || rewardKeys.length !== EXPECTED_MISSION_COUNT) {
        throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: awake master count changed`)
    }
    const rewardKeySet = new Set(rewardKeys)
    if (!missionKeys.every(key => rewardKeySet.has(key))) {
        throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: awake master key sets differ`)
    }

    const missionIds: number[] = []
    const unlocks: UnlockInstruction[] = []
    let nonUnlockCount = 0
    for (const rawMissionId of missionKeys) {
        const missionId = parsePositiveDecimal(rawMissionId, "mission id")
        const missionRows = awakeMissions[rawMissionId]
        if (!Array.isArray(missionRows) || missionRows.length === 0) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: mission ${rawMissionId} has unknown shape`)
        }
        const stages = awakeRewards[rawMissionId]
        if (!isRecord(stages)) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: reward ${rawMissionId} has unknown stage map`)
        }
        missionIds.push(missionId)
        for (const [rawStageId, wrappedRows] of Object.entries(stages)) {
            const stageId = parsePositiveDecimal(rawStageId, `stage id for ${rawMissionId}`)
            if (!Array.isArray(wrappedRows)
                || wrappedRows.length !== 1
                || !Array.isArray(wrappedRows[0])) {
                throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: reward wrapper ${rawMissionId}/${rawStageId} changed`)
            }
            const row = wrappedRows[0]
            if (row[1] === "(None)") {
                nonUnlockCount += 1
                continue
            }
            if (row[1] !== "0") {
                throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: reward kind ${rawMissionId}/${rawStageId} is unknown`)
            }
            unlocks.push({
                missionId,
                stageId,
                characterId: parsePositiveDecimal(row[2], "unlock character id"),
                boardIndex: parsePositiveDecimal(row[3], "unlock board index"),
                awakeLevel: parsePositiveDecimal(row[4], "unlock awake level"),
            })
        }
    }
    if (unlocks.length !== EXPECTED_UNLOCK_COUNT || nonUnlockCount !== EXPECTED_NON_UNLOCK_COUNT) {
        throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: awake reward classification changed`)
    }
    return { missionIds, unlocks }
}

function isPositiveSafeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function missionKey(row: Pick<MissionRow, "id" | "player_id">): string {
    return `${row.id}:${row.player_id}`
}

function stageKey(row: Pick<StageRow, "id" | "mission_id" | "player_id">): string {
    return `${row.id}:${row.mission_id}:${row.player_id}`
}

function buildDataPlan(database: Database, master: AwakeMasterPlan): DataPlan {
    const placeholders = master.missionIds.map(() => "?").join(",")
    const sourceMissions = database.prepare(`
        SELECT id, player_id FROM players_active_missions
        WHERE id IN (${placeholders})
    `).all(...master.missionIds) as MissionRow[]
    const sourceStages = database.prepare(`
        SELECT id, status, player_id, mission_id FROM players_active_missions_stages
        WHERE mission_id IN (${placeholders})
    `).all(...master.missionIds) as StageRow[]
    const destinationMissionRows = database.prepare(`
        SELECT id, player_id FROM players_category_missions
        WHERE category = 9 AND id IN (${placeholders})
    `).all(...master.missionIds) as MissionRow[]
    const destinationStageRows = database.prepare(`
        SELECT id, status, player_id, mission_id FROM players_category_mission_stages
        WHERE category = 9 AND mission_id IN (${placeholders})
    `).all(...master.missionIds) as StageRow[]
    const players = database.prepare("SELECT id, degree_id FROM players").all() as PlayerDegreeRow[]

    for (const row of [...sourceMissions, ...destinationMissionRows]) {
        if (!isPositiveSafeInteger(row.id) || !isPositiveSafeInteger(row.player_id)) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: mission id or player id is non-canonical`)
        }
    }
    for (const row of [...sourceStages, ...destinationStageRows]) {
        if (!isPositiveSafeInteger(row.id) || !isPositiveSafeInteger(row.mission_id)
            || !isPositiveSafeInteger(row.player_id) || (row.status !== 0 && row.status !== 1)) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: stage row is non-canonical`)
        }
    }
    for (const player of players) {
        if (!isPositiveSafeInteger(player.id)
            || typeof player.degree_id !== "number"
            || !Number.isSafeInteger(player.degree_id)
            || player.degree_id < 0) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: player degree is non-canonical`)
        }
    }

    const invalidProgress = database.prepare(`
        SELECT 1 FROM players_active_missions
        WHERE id IN (${placeholders}) AND (
            typeof(progress) NOT IN ('integer', 'real')
            OR progress < 0 OR progress > 1.7976931348623157e308
        )
        UNION ALL
        SELECT 1 FROM players_category_missions
        WHERE category = 9 AND id IN (${placeholders}) AND (
            typeof(progress) NOT IN ('integer', 'real')
            OR progress < 0 OR progress > 1.7976931348623157e308
        )
        LIMIT 1
    `).get(...master.missionIds, ...master.missionIds)
    if (invalidProgress !== undefined) {
        throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: mission progress is not finite and non-negative`)
    }
    const progressConflict = database.prepare(`
        SELECT 1
        FROM players_active_missions AS source
        JOIN players_category_missions AS destination
          ON destination.category = 9 AND destination.id = source.id
         AND destination.player_id = source.player_id
        WHERE source.id IN (${placeholders})
          AND source.progress <> destination.progress
        LIMIT 1
    `).get(...master.missionIds)
    if (progressConflict !== undefined) {
        throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: category-9 mission progress conflict`)
    }

    const sourceMissionMap = new Set(sourceMissions.map(missionKey))
    const destinationMissions = new Set(destinationMissionRows.map(missionKey))
    const destinationStages = new Map(destinationStageRows.map(row => [stageKey(row), row]))
    for (const row of sourceStages) {
        if (!sourceMissionMap.has(`${row.mission_id}:${row.player_id}`)
            && !destinationMissions.has(`${row.mission_id}:${row.player_id}`)) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: orphan stage cannot be migrated`)
        }
        const destination = destinationStages.get(stageKey(row))
        if (destination !== undefined && destination.status !== row.status) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: category-9 stage status conflict`)
        }
    }
    for (const row of destinationStageRows) {
        if (!destinationMissions.has(`${row.mission_id}:${row.player_id}`)) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: destination has orphan stage`)
        }
    }
    return { sourceMissions, sourceStages, destinationMissions, destinationStages, players }
}

function assertExistingTargetRows(database: Database): void {
    if (hasTable(database, AWAKE_UNLOCK_TABLE)) {
        const rows = database.prepare(`
            SELECT player_id, character_id, board_index, awake_level
            FROM players_character_awake_unlocks
        `).all() as Array<{ player_id: number; character_id: number; board_index: number; awake_level: number }>
        if (rows.some(row => !isPositiveSafeInteger(row.player_id)
            || !isPositiveSafeInteger(row.character_id)
            || !isPositiveSafeInteger(row.board_index)
            || typeof row.awake_level !== "number"
            || !Number.isSafeInteger(row.awake_level)
            || row.awake_level < 0)) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: existing awake unlock row is non-canonical`)
        }
    }
    if (hasTable(database, DEGREE_TABLE)) {
        const rows = database.prepare(`
            SELECT player_id, degree_id, acquired_at FROM players_degrees
        `).all() as Array<{ player_id: number; degree_id: number; acquired_at: number }>
        if (rows.some(row => !isPositiveSafeInteger(row.player_id)
            || !isPositiveSafeInteger(row.degree_id)
            || typeof row.acquired_at !== "number"
            || !Number.isSafeInteger(row.acquired_at)
            || row.acquired_at < 0)) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: existing degree row is non-canonical`)
        }
    }
}

function insertCategoryRows(database: Database, plan: DataPlan, master: AwakeMasterPlan): void {
    const placeholders = master.missionIds.map(() => "?").join(",")
    database.prepare(`
        INSERT INTO players_category_missions (category, id, progress, player_id)
        SELECT 9, source.id, source.progress, source.player_id
        FROM players_active_missions AS source
        WHERE source.id IN (${placeholders})
          AND NOT EXISTS (
              SELECT 1 FROM players_category_missions AS destination
              WHERE destination.category = 9 AND destination.id = source.id
                AND destination.player_id = source.player_id
          )
    `).run(...master.missionIds)
    const insertStage = database.prepare(`
        INSERT INTO players_category_mission_stages (category, id, status, player_id, mission_id)
        VALUES (9, ?, ?, ?, ?)
    `)
    for (const row of plan.sourceStages) {
        if (!plan.destinationStages.has(stageKey(row))) {
            insertStage.run(row.id, row.status, row.player_id, row.mission_id)
        }
    }
}

function verifyCopiedRows(database: Database, plan: DataPlan, master: AwakeMasterPlan): void {
    const placeholders = master.missionIds.map(() => "?").join(",")
    const missionMismatch = database.prepare(`
        SELECT 1
        FROM players_active_missions AS source
        WHERE source.id IN (${placeholders})
          AND NOT EXISTS (
              SELECT 1 FROM players_category_missions AS destination
              WHERE destination.category = 9 AND destination.id = source.id
                AND destination.player_id = source.player_id
                AND destination.progress = source.progress
          )
        LIMIT 1
    `).get(...master.missionIds)
    if (missionMismatch !== undefined) {
        throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: category-9 mission readback failed`)
    }
    const readStage = database.prepare(`
        SELECT status FROM players_category_mission_stages
        WHERE category = 9 AND id = ? AND mission_id = ? AND player_id = ?
    `)
    for (const row of plan.sourceStages) {
        const copied = readStage.get(row.id, row.mission_id, row.player_id) as { status: number } | undefined
        if (copied === undefined || copied.status !== row.status) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: category-9 stage readback failed`)
        }
    }
}

function deleteSourceRows(database: Database, plan: DataPlan): void {
    const deleteStage = database.prepare(`
        DELETE FROM players_active_missions_stages WHERE id = ? AND mission_id = ? AND player_id = ?
    `)
    for (const row of plan.sourceStages) {
        if (deleteStage.run(row.id, row.mission_id, row.player_id).changes !== 1) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: source stage delete count mismatch`)
        }
    }
    const deleteMission = database.prepare(`
        DELETE FROM players_active_missions WHERE id = ? AND player_id = ?
    `)
    for (const row of plan.sourceMissions) {
        if (deleteMission.run(row.id, row.player_id).changes !== 1) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: source mission delete count mismatch`)
        }
    }
}

function backfillUnlocks(database: Database, master: AwakeMasterPlan): void {
    const insertUnlock = database.prepare(`
        INSERT INTO players_character_awake_unlocks
            (player_id, character_id, board_index, awake_level)
        SELECT stage.player_id, ?, ?, ?
        FROM players_category_mission_stages AS stage
        JOIN players_characters AS owned_character
          ON owned_character.player_id = stage.player_id AND owned_character.id = ?
        WHERE stage.category = 9 AND stage.mission_id = ?
          AND stage.id = ? AND stage.status = 1
        ON CONFLICT(player_id, character_id, board_index) DO UPDATE SET
            awake_level = MAX(awake_level, excluded.awake_level)
    `)
    for (const unlock of master.unlocks) {
        insertUnlock.run(
            unlock.characterId,
            unlock.boardIndex,
            unlock.awakeLevel,
            unlock.characterId,
            unlock.missionId,
            unlock.stageId,
        )
    }
}

function verifyUnlockBackfill(database: Database, master: AwakeMasterPlan): void {
    const readUnlocks = database.prepare(`
        SELECT target.awake_level
        FROM players_category_mission_stages AS stage
        JOIN players_characters AS owned_character
          ON owned_character.player_id = stage.player_id AND owned_character.id = ?
        LEFT JOIN players_character_awake_unlocks AS target
          ON target.player_id = stage.player_id
         AND target.character_id = ? AND target.board_index = ?
        WHERE stage.category = 9 AND stage.mission_id = ?
          AND stage.id = ? AND stage.status = 1
    `)
    for (const unlock of master.unlocks) {
        const rows = readUnlocks.all(
            unlock.characterId,
            unlock.characterId,
            unlock.boardIndex,
            unlock.missionId,
            unlock.stageId,
        ) as Array<{ awake_level: unknown }>
        if (rows.some(row => typeof row.awake_level !== "number"
            || !Number.isSafeInteger(row.awake_level)
            || row.awake_level < unlock.awakeLevel)) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: awake unlock backfill readback failed`)
        }
    }
}

function backfillDegrees(database: Database, players: readonly PlayerDegreeRow[]): void {
    const insertDegree = database.prepare(`
        INSERT OR IGNORE INTO players_degrees (player_id, degree_id, acquired_at)
        VALUES (?, ?, 0)
    `)
    for (const player of players) {
        insertDegree.run(player.id, 1)
        if (player.degree_id > 0) insertDegree.run(player.id, player.degree_id)
    }
}

function verifyDegreeBackfill(database: Database, players: readonly PlayerDegreeRow[]): void {
    const readDegree = database.prepare(`
        SELECT 1 FROM players_degrees WHERE player_id = ? AND degree_id = ?
    `)
    for (const player of players) {
        if (readDegree.get(player.id, 1) === undefined
            || (player.degree_id > 0 && readDegree.get(player.id, player.degree_id) === undefined)) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: degree backfill readback failed`)
        }
    }
}

function assertSourceRowsRemoved(database: Database, plan: DataPlan): void {
    for (const row of plan.sourceStages) {
        const remaining = database.prepare(`
            SELECT 1 FROM players_active_missions_stages
            WHERE id = ? AND mission_id = ? AND player_id = ?
        `).get(row.id, row.mission_id, row.player_id)
        if (remaining !== undefined) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: source stage was not removed`)
        }
    }
    for (const row of plan.sourceMissions) {
        const remaining = database.prepare(`
            SELECT 1 FROM players_active_missions WHERE id = ? AND player_id = ?
        `).get(row.id, row.player_id)
        if (remaining !== undefined) {
            throw new Error(`${AWAKE_DEGREE_MIGRATION_ID}: source mission was not removed`)
        }
    }
}

function applyAwakeDegreeMigration(database: Database): void {
    const master = buildAwakeMasterPlan()
    database.transaction(() => {
        assertAwakeDegreePrerequisiteSchema(database)
        assertExistingAwakeDegreeSchema(database)
        assertExistingTargetRows(database)
        const plan = buildDataPlan(database, master)
        createAwakeDegreeTablesAndIndex(database)
        insertCategoryRows(database, plan, master)
        verifyCopiedRows(database, plan, master)
        deleteSourceRows(database, plan)
        backfillUnlocks(database, master)
        verifyUnlockBackfill(database, master)
        backfillDegrees(database, plan.players)
        verifyDegreeBackfill(database, plan.players)
        ensureDegreeTrigger(database)
        assertFinalAwakeDegreeSchema(database)
        assertExistingTargetRows(database)
        assertSourceRowsRemoved(database, plan)
    })()
}

export const awakeDegreeMigration: DormantWdfpMigration = {
    id: AWAKE_DEGREE_MIGRATION_ID,
    apply: applyAwakeDegreeMigration,
}
