import { getDb } from "../db";


export type FiveBossGauntletRunStatus = "active" | "settled" | "aborted";

export type FiveBossGauntletRunErrorCode =
    | "invalid_argument"
    | "run_conflict"
    | "roster_conflict"
    | "participant_not_in_roster"
    | "member_binding_conflict"
    | "member_not_active"
    | "client_play_conflict"
    | "client_play_not_found"
    | "run_not_active"
    | "battle_signal_order"
    | "battle_proof_missing"
    | "reward_not_serializable";

export class FiveBossGauntletRunError extends Error {
    constructor(
        public readonly code: FiveBossGauntletRunErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "FiveBossGauntletRunError";
    }
}

export interface FiveBossGauntletRun {
    runId: string;
    hostPlayerId: number;
    routeId: string;
    roomNumber: string;
    ticketItemId: number;
    expectedMemberCount: number;
    status: FiveBossGauntletRunStatus;
    /**
     * 房主在 run 创建时是否真的扣掉了一张凭证。false = 房主没票也照样开局
     * (2026-09-09 作者规则),全员结算时不发任何模式奖励、不记通关。
     */
    rewardsEnabled: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface FiveBossGauntletMember {
    runId: string;
    playerId: number;
    clientPlayId: string | null;
    isAutoMode: boolean | null;
    startedAt: string | null;
    abortedAt: string | null;
    levelNextAt: string | null;
    finalizedAt: string | null;
}

export interface BoundFiveBossGauntletMember extends FiveBossGauntletMember {
    clientPlayId: string;
    isAutoMode: boolean;
    startedAt: string;
}

export interface StartMemberInput {
    runId: string;
    hostPlayerId: number;
    routeId: string;
    roomNumber: string;
    ticketItemId: number;
    rosterPlayerIds: readonly number[];
    playerId: number;
    clientPlayId: string;
    isAutoMode: boolean;
}

export interface MemberClientKey {
    playerId: number;
    clientPlayId: string;
}

export interface MemberBattleSignalInput {
    runId: string;
    playerId: number;
    roomNumber: string;
    signal: "level_next" | "finalize";
}

export interface StartMemberContext {
    run: FiveBossGauntletRun;
    member: BoundFiveBossGauntletMember;
    isReplay: boolean;
}

export interface RewardContext {
    run: FiveBossGauntletRun;
    member: BoundFiveBossGauntletMember;
    playerId: number;
    rewardMultiplier: 1 | 2;
    /** 与 run.rewardsEnabled 相同;false 时回调必须一件奖励都不发。 */
    rewardsEnabled: boolean;
}

export interface AbortMemberContext {
    run: FiveBossGauntletRun;
    member: BoundFiveBossGauntletMember;
}

interface RawRun {
    run_id: string;
    host_player_id: number;
    route_id: string;
    room_number: string;
    ticket_item_id: number;
    expected_member_count: number;
    status: FiveBossGauntletRunStatus;
    rewards_enabled: number;
    created_at: string;
    updated_at: string;
}

interface RawMember {
    run_id: string;
    player_id: number;
    client_play_id: string | null;
    is_auto_mode: number | null;
    started_at: string | null;
    aborted_at: string | null;
    level_next_at: string | null;
    finalized_at: string | null;
}

interface RawReceipt {
    reward_multiplier: 1 | 2;
    reward_json: string;
}


function fail(code: FiveBossGauntletRunErrorCode, message: string): never {
    throw new FiveBossGauntletRunError(code, message);
}


function positiveInteger(name: string, value: number): number {
    if (!Number.isSafeInteger(value) || value < 1) {
        fail("invalid_argument", `${name} must be a positive safe integer`);
    }
    return value;
}


function boundedText(name: string, value: string, maxLength = 255): string {
    if (
        typeof value !== "string"
        || value.length < 1
        || value.length > maxLength
        || value.trim() !== value
        || value.includes("\0")
    ) {
        fail("invalid_argument", `${name} must be non-empty normalized text up to ${maxLength} characters`);
    }
    return value;
}


function booleanValue(name: string, value: boolean): boolean {
    if (typeof value !== "boolean") fail("invalid_argument", `${name} must be a boolean`);
    return value;
}


function canonicalRoster(
    rosterPlayerIds: readonly number[],
    hostPlayerId: number,
    currentPlayerId: number,
): number[] {
    if (!Array.isArray(rosterPlayerIds) || rosterPlayerIds.length < 1 || rosterPlayerIds.length > 3) {
        fail("invalid_argument", "rosterPlayerIds must contain one to three real players");
    }
    const roster = rosterPlayerIds.map((playerId, index) => (
        positiveInteger(`rosterPlayerIds[${index}]`, playerId)
    ));
    if (new Set(roster).size !== roster.length) {
        fail("invalid_argument", "rosterPlayerIds must be unique");
    }
    if (!roster.includes(hostPlayerId)) {
        fail("participant_not_in_roster", "frozen roster must contain the host");
    }
    if (!roster.includes(currentPlayerId)) {
        fail("participant_not_in_roster", "current player is not in the frozen roster");
    }
    return roster.sort((left, right) => left - right);
}


function runFromRaw(row: RawRun): FiveBossGauntletRun {
    return {
        runId: row.run_id,
        hostPlayerId: row.host_player_id,
        routeId: row.route_id,
        roomNumber: row.room_number,
        ticketItemId: row.ticket_item_id,
        expectedMemberCount: row.expected_member_count,
        status: row.status,
        rewardsEnabled: row.rewards_enabled === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}


let rewardsEnabledColumnEnsured = false;

/**
 * 灰的服务端只按整文件覆盖装 five-boss 模块,不一定会同步换 wdfpData.ts 的建表/迁移;
 * 这里再兜一道:老库缺 rewards_enabled 就现场补列(默认 1 = 历史 run 都算有奖励)。
 * 每进程只查一次 pragma。
 */
function ensureRewardsEnabledColumn(): void {
    if (rewardsEnabledColumnEnsured) return;
    const db = getDb();
    const columns = db.prepare("PRAGMA table_info(five_boss_gauntlet_runs)").all() as Array<{ name: string }>;
    if (columns.length === 0) return; // 表还没建(wdfpData 尚未跑),下次再看
    if (columns.some(column => column.name === "rewards_enabled")) {
        rewardsEnabledColumnEnsured = true;
        return;
    }
    // 只在"列确实存在"时才记住;ALTER 若发生在某个随后回滚的事务里会被一起回滚,
    // 这里不置旗标,下一次调用重新查 pragma、重新补列。
    db.prepare(
        "ALTER TABLE five_boss_gauntlet_runs ADD COLUMN rewards_enabled INTEGER NOT NULL DEFAULT 1 CHECK (rewards_enabled IN (0, 1))",
    ).run();
}


function memberFromRaw(row: RawMember): FiveBossGauntletMember {
    return {
        runId: row.run_id,
        playerId: row.player_id,
        clientPlayId: row.client_play_id,
        isAutoMode: row.is_auto_mode === null ? null : row.is_auto_mode === 1,
        startedAt: row.started_at,
        abortedAt: row.aborted_at,
        levelNextAt: row.level_next_at,
        finalizedAt: row.finalized_at,
    };
}


function boundMemberFromRaw(row: RawMember): BoundFiveBossGauntletMember {
    if (row.client_play_id === null || row.is_auto_mode === null || row.started_at === null) {
        fail("member_binding_conflict", "member binding is incomplete");
    }
    return {
        ...memberFromRaw(row),
        clientPlayId: row.client_play_id,
        isAutoMode: row.is_auto_mode === 1,
        startedAt: row.started_at,
    };
}


function selectRun(runId: string): RawRun | undefined {
    ensureRewardsEnabledColumn();
    return getDb().prepare(`
        SELECT run_id, host_player_id, route_id, room_number, ticket_item_id,
               expected_member_count, status, rewards_enabled, created_at, updated_at
        FROM five_boss_gauntlet_runs
        WHERE run_id = ?
    `).get(runId) as RawRun | undefined;
}


function selectMember(runId: string, playerId: number): RawMember | undefined {
    return getDb().prepare(`
        SELECT run_id, player_id, client_play_id, is_auto_mode, started_at, aborted_at,
               level_next_at, finalized_at
        FROM five_boss_gauntlet_members
        WHERE run_id = ? AND player_id = ?
    `).get(runId, playerId) as RawMember | undefined;
}


function selectMemberByClient(playerId: number, clientPlayId: string): RawMember | undefined {
    return getDb().prepare(`
        SELECT run_id, player_id, client_play_id, is_auto_mode, started_at, aborted_at,
               level_next_at, finalized_at
        FROM five_boss_gauntlet_members
        WHERE player_id = ? AND client_play_id = ?
    `).get(playerId, clientPlayId) as RawMember | undefined;
}


function validateClientKey(input: MemberClientKey): MemberClientKey {
    return {
        playerId: positiveInteger("playerId", input.playerId),
        clientPlayId: boundedText("clientPlayId", input.clientPlayId),
    };
}


function assertExistingRunContract(
    row: RawRun,
    input: ReturnType<typeof validateStartInput>,
): void {
    if (
        row.host_player_id !== input.hostPlayerId
        || row.route_id !== input.routeId
        || row.room_number !== input.roomNumber
        || row.ticket_item_id !== input.ticketItemId
    ) {
        fail("run_conflict", "runId already belongs to different immutable run data");
    }
    const storedRoster = (getDb().prepare(`
        SELECT player_id
        FROM five_boss_gauntlet_members
        WHERE run_id = ?
        ORDER BY player_id
    `).all(input.runId) as Array<{ player_id: number }>).map(member => member.player_id);
    if (
        row.expected_member_count !== input.rosterPlayerIds.length
        || storedRoster.length !== input.rosterPlayerIds.length
        || storedRoster.some((playerId, index) => playerId !== input.rosterPlayerIds[index])
    ) {
        fail("roster_conflict", "runId already has a different frozen real-player roster");
    }
}


function validateStartInput(input: StartMemberInput) {
    const hostPlayerId = positiveInteger("hostPlayerId", input.hostPlayerId);
    const playerId = positiveInteger("playerId", input.playerId);
    return {
        runId: boundedText("runId", input.runId),
        hostPlayerId,
        routeId: boundedText("routeId", input.routeId),
        roomNumber: boundedText("roomNumber", input.roomNumber),
        ticketItemId: positiveInteger("ticketItemId", input.ticketItemId),
        rosterPlayerIds: canonicalRoster(input.rosterPlayerIds, hostPlayerId, playerId),
        playerId,
        clientPlayId: boundedText("clientPlayId", input.clientPlayId),
        isAutoMode: booleanValue("isAutoMode", input.isAutoMode),
    };
}


/**
 * Starts one real participant against a server-owned run. The callback must only perform
 * synchronous writes through the shared WDFP SQLite connection so rollback remains atomic.
 */
export function startMemberSync<T>(
    input: StartMemberInput,
    persistActiveQuest: (context: StartMemberContext) => T,
): {
    status: "started" | "already_started" | "resumed";
    run: FiveBossGauntletRun;
    member: BoundFiveBossGauntletMember;
    persisted: T;
} {
    const normalized = validateStartInput(input);
    if (typeof persistActiveQuest !== "function") {
        fail("invalid_argument", "persistActiveQuest must be a function");
    }
    ensureRewardsEnabledColumn();
    const db = getDb();

    return db.transaction(() => {
        let rawRun = selectRun(normalized.runId);
        if (rawRun) {
            assertExistingRunContract(rawRun, normalized);
            if (rawRun.status !== "active") fail("run_not_active", `run is ${rawRun.status}`);
        } else {
            // The IMMEDIATE transaction serializes this read with every other first-start.
            // A room may have historical terminal runs, but never two active server run ids.
            const activeRoomRun = db.prepare(`
                SELECT run_id
                FROM five_boss_gauntlet_runs
                WHERE room_number = ? AND status = 'active'
                LIMIT 1
            `).get(normalized.roomNumber) as { run_id: string } | undefined;
            if (activeRoomRun && activeRoomRun.run_id !== normalized.runId) {
                fail("run_conflict", "room already belongs to a different active server run");
            }

            // 2026-09-09 作者规则:只从房主身上扣一张凭证;房主没票也照样建 run、照样开局,
            // 只是整局 rewards_enabled=0 —— 三个人谁有票都不扣、谁也不发模式奖励。
            const ticketUpdate = db.prepare(`
                UPDATE players_items
                SET amount = amount - 1
                WHERE player_id = ? AND id = ? AND amount >= 1
            `).run(normalized.hostPlayerId, normalized.ticketItemId);
            const rewardsEnabled = ticketUpdate.changes === 1;

            const now = new Date().toISOString();
            db.prepare(`
                INSERT INTO five_boss_gauntlet_runs (
                    run_id, host_player_id, route_id, room_number, ticket_item_id,
                    expected_member_count, status, rewards_enabled, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
            `).run(
                normalized.runId,
                normalized.hostPlayerId,
                normalized.routeId,
                normalized.roomNumber,
                normalized.ticketItemId,
                normalized.rosterPlayerIds.length,
                rewardsEnabled ? 1 : 0,
                now,
                now,
            );
            const insertMember = db.prepare(`
                INSERT INTO five_boss_gauntlet_members (run_id, player_id)
                VALUES (?, ?)
            `);
            for (const rosterPlayerId of normalized.rosterPlayerIds) {
                insertMember.run(normalized.runId, rosterPlayerId);
            }
            rawRun = selectRun(normalized.runId);
            if (!rawRun) fail("run_conflict", "new run could not be read back");
        }

        let rawMember = selectMember(normalized.runId, normalized.playerId);
        if (!rawMember) fail("roster_conflict", "frozen roster is missing the current member");
        let status: "started" | "already_started" | "resumed";
        if (rawMember.client_play_id === null) {
            const clientOwner = selectMemberByClient(normalized.playerId, normalized.clientPlayId);
            if (clientOwner && clientOwner.run_id !== normalized.runId) {
                fail("client_play_conflict", "player/clientPlayId already belongs to another run");
            }
            const now = new Date().toISOString();
            db.prepare(`
                UPDATE five_boss_gauntlet_members
                SET client_play_id = ?, is_auto_mode = ?, started_at = ?, aborted_at = NULL,
                    level_next_at = NULL, finalized_at = NULL
                WHERE run_id = ? AND player_id = ? AND client_play_id IS NULL
            `).run(
                normalized.clientPlayId,
                normalized.isAutoMode ? 1 : 0,
                now,
                normalized.runId,
                normalized.playerId,
            );
            status = "started";
        } else {
            if (
                rawMember.client_play_id !== normalized.clientPlayId
                || (rawMember.is_auto_mode === 1) !== normalized.isAutoMode
            ) {
                fail("member_binding_conflict", "member is already bound to different client start data");
            }
            if (rawMember.aborted_at !== null) {
                db.prepare(`
                    UPDATE five_boss_gauntlet_members
                    SET aborted_at = NULL, level_next_at = NULL, finalized_at = NULL
                    WHERE run_id = ? AND player_id = ?
                `).run(normalized.runId, normalized.playerId);
                status = "resumed";
            } else {
                status = "already_started";
            }
        }

        rawMember = selectMember(normalized.runId, normalized.playerId);
        if (!rawMember) fail("roster_conflict", "bound member could not be read back");
        const run = runFromRaw(rawRun);
        const member = boundMemberFromRaw(rawMember);
        const persisted = persistActiveQuest({
            run,
            member,
            isReplay: status === "already_started",
        });
        return { status, run, member, persisted };
    }).immediate();
}


/** Records the two official BothBoss client transitions used as the settlement proof chain. */
export function recordMemberBattleSignalSync(
    input: MemberBattleSignalInput,
): BoundFiveBossGauntletMember {
    const runId = boundedText("runId", input.runId);
    const roomNumber = boundedText("roomNumber", input.roomNumber);
    const playerId = positiveInteger("playerId", input.playerId);
    if (input.signal !== "level_next" && input.signal !== "finalize") {
        fail("invalid_argument", "signal must be level_next or finalize");
    }
    const db = getDb();

    return db.transaction(() => {
        const rawRun = selectRun(runId);
        if (!rawRun) fail("run_conflict", "battle signal points to a missing run");
        if (rawRun.room_number !== roomNumber) {
            fail("run_conflict", "battle signal room does not match the immutable run");
        }
        if (rawRun.status !== "active") fail("run_not_active", `run is ${rawRun.status}`);

        let rawMember = selectMember(runId, playerId);
        if (!rawMember) fail("participant_not_in_roster", "battle signal player is not in the frozen roster");
        boundMemberFromRaw(rawMember);
        if (rawMember.aborted_at !== null) fail("member_not_active", "member has aborted this run");

        const now = new Date().toISOString();
        if (input.signal === "level_next") {
            db.prepare(`
                UPDATE five_boss_gauntlet_members
                SET level_next_at = COALESCE(level_next_at, ?)
                WHERE run_id = ? AND player_id = ?
            `).run(now, runId, playerId);
        } else {
            if (rawMember.level_next_at === null) {
                fail("battle_signal_order", "finalize arrived before the BothBoss level transition");
            }
            db.prepare(`
                UPDATE five_boss_gauntlet_members
                SET finalized_at = COALESCE(finalized_at, ?)
                WHERE run_id = ? AND player_id = ?
            `).run(now, runId, playerId);
        }

        rawMember = selectMember(runId, playerId);
        if (!rawMember) fail("roster_conflict", "battle proof member could not be read back");
        return boundMemberFromRaw(rawMember);
    }).immediate();
}


export interface BackfillFinalizeResult {
    backfilled: boolean;
    runId?: string;
    roomNumber?: string;
}

/**
 * 真机 2026-09-05:CN 客户端在打完第 5 只 boss 后有时只把 LevelNext 送到了 TCP 战斗通道,
 * Finalize 没到(通道早已被客户端合上),随后的 HTTP finish 被 battle_proof_missing 拒成 H400,
 * 玩家白打一局。finish 请求本身带会话鉴权,且 level_next 已证明第二场景确实进入过,
 * 所以对「有 level_next、缺 finalize、成员未放弃、run 仍 active」这一种情况把 finalize
 * 记成 finish 到达时刻;其余情况原样 fail-closed。
 */
export function backfillMissingFinalizeSync(input: MemberClientKey): BackfillFinalizeResult {
    const key = validateClientKey(input);
    const rawMember = selectMemberByClient(key.playerId, key.clientPlayId);
    if (!rawMember || rawMember.aborted_at !== null) return { backfilled: false };
    if (rawMember.level_next_at === null || rawMember.finalized_at !== null) return { backfilled: false };
    const rawRun = selectRun(rawMember.run_id);
    if (!rawRun || rawRun.status !== "active") return { backfilled: false };
    recordMemberBattleSignalSync({
        runId: rawRun.run_id,
        playerId: key.playerId,
        roomNumber: rawRun.room_number,
        signal: "finalize",
    });
    return { backfilled: true, runId: rawRun.run_id, roomNumber: rawRun.room_number };
}


/** Grants one frozen member's rewards and records the replayable receipt atomically. */
export function settleMemberSync<T>(
    input: MemberClientKey,
    grantRewards: (context: RewardContext) => T,
): {
    status: "settled" | "already_settled";
    run: FiveBossGauntletRun;
    rewardMultiplier: 1 | 2;
    reward: T;
} {
    const normalized = validateClientKey(input);
    if (typeof grantRewards !== "function") fail("invalid_argument", "grantRewards must be a function");
    ensureRewardsEnabledColumn();
    const db = getDb();

    return db.transaction(() => {
        const rawMember = selectMemberByClient(normalized.playerId, normalized.clientPlayId);
        if (!rawMember) fail("client_play_not_found", "player/clientPlayId is not bound to a run");

        const existingReceipt = db.prepare(`
            SELECT reward_multiplier, reward_json
            FROM five_boss_gauntlet_receipts
            WHERE run_id = ? AND player_id = ?
        `).get(rawMember.run_id, normalized.playerId) as RawReceipt | undefined;
        if (existingReceipt) {
            const latestRun = selectRun(rawMember.run_id);
            if (!latestRun) fail("run_conflict", "receipt points to a missing run");
            return {
                status: "already_settled" as const,
                run: runFromRaw(latestRun),
                rewardMultiplier: existingReceipt.reward_multiplier,
                reward: JSON.parse(existingReceipt.reward_json) as T,
            };
        }

        const rawRun = selectRun(rawMember.run_id);
        if (!rawRun) fail("run_conflict", "member points to a missing run");
        if (rawRun.status !== "active") fail("run_not_active", `run is ${rawRun.status}`);
        if (rawMember.aborted_at !== null) fail("member_not_active", "member has aborted this run");
        if (rawMember.level_next_at === null || rawMember.finalized_at === null) {
            fail("battle_proof_missing", "BothBoss level-next/finalize proof is incomplete");
        }
        const member = boundMemberFromRaw(rawMember);
        const rewardMultiplier: 1 | 2 = member.isAutoMode ? 1 : 2;
        const reward = grantRewards({
            run: runFromRaw(rawRun),
            member,
            playerId: normalized.playerId,
            rewardMultiplier,
            rewardsEnabled: rawRun.rewards_enabled === 1,
        });
        let rewardJson: string | undefined;
        try {
            rewardJson = JSON.stringify(reward);
        } catch {
            fail("reward_not_serializable", "reward callback result must be JSON serializable");
        }
        if (rewardJson === undefined) {
            fail("reward_not_serializable", "reward callback result must be JSON serializable");
        }

        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO five_boss_gauntlet_receipts (
                run_id, player_id, reward_multiplier, reward_json, settled_at
            ) VALUES (?, ?, ?, ?, ?)
        `).run(rawRun.run_id, normalized.playerId, rewardMultiplier, rewardJson, now);
        db.prepare(`
            UPDATE five_boss_gauntlet_runs
            SET status = 'settled', updated_at = ?
            WHERE run_id = ? AND status = 'active'
              AND NOT EXISTS (
                  SELECT 1
                  FROM five_boss_gauntlet_members AS member
                  LEFT JOIN five_boss_gauntlet_receipts AS receipt
                    ON receipt.run_id = member.run_id
                   AND receipt.player_id = member.player_id
                  WHERE member.run_id = five_boss_gauntlet_runs.run_id
                    AND receipt.player_id IS NULL
              )
        `).run(now, rawRun.run_id);

        const latestRun = selectRun(rawRun.run_id);
        if (!latestRun) fail("run_conflict", "settled run could not be read back");
        return {
            status: "settled" as const,
            run: runFromRaw(latestRun),
            rewardMultiplier,
            reward,
        };
    }).immediate();
}


/** Clears one member's persisted active quest; only the host aborts the shared run. */
export function abortMemberSync<T>(
    input: MemberClientKey,
    deletePersistentActive: (context: AbortMemberContext) => T,
): {
    status: "member_aborted" | "run_aborted" | "already_aborted" | "already_settled";
    run: FiveBossGauntletRun;
    member: BoundFiveBossGauntletMember;
    deleted?: T;
} {
    const normalized = validateClientKey(input);
    if (typeof deletePersistentActive !== "function") {
        fail("invalid_argument", "deletePersistentActive must be a function");
    }
    ensureRewardsEnabledColumn();
    const db = getDb();

    return db.transaction(() => {
        let rawMember = selectMemberByClient(normalized.playerId, normalized.clientPlayId);
        if (!rawMember) fail("client_play_not_found", "player/clientPlayId is not bound to a run");
        let rawRun = selectRun(rawMember.run_id);
        if (!rawRun) fail("run_conflict", "member points to a missing run");
        const member = boundMemberFromRaw(rawMember);
        if (rawMember.aborted_at !== null) {
            return {
                status: "already_aborted" as const,
                run: runFromRaw(rawRun),
                member,
            };
        }
        const hasReceipt = db.prepare(`
            SELECT 1
            FROM five_boss_gauntlet_receipts
            WHERE run_id = ? AND player_id = ?
        `).get(rawRun.run_id, normalized.playerId) !== undefined;
        if (hasReceipt || rawRun.status === "settled") {
            return {
                status: "already_settled" as const,
                run: runFromRaw(rawRun),
                member,
            };
        }

        const deleted = deletePersistentActive({ run: runFromRaw(rawRun), member });
        const now = new Date().toISOString();
        db.prepare(`
            UPDATE five_boss_gauntlet_members
            SET aborted_at = ?
            WHERE run_id = ? AND player_id = ? AND aborted_at IS NULL
        `).run(now, rawMember.run_id, normalized.playerId);
        const isHost = rawRun.host_player_id === normalized.playerId;
        if (isHost && rawRun.status === "active") {
            db.prepare(`
                UPDATE five_boss_gauntlet_runs
                SET status = 'aborted', updated_at = ?
                WHERE run_id = ? AND status = 'active'
            `).run(now, rawRun.run_id);
        }

        rawMember = selectMember(rawRun.run_id, normalized.playerId);
        rawRun = selectRun(rawRun.run_id);
        if (!rawMember || !rawRun) fail("run_conflict", "abort state could not be read back");
        return {
            status: isHost ? "run_aborted" as const : "member_aborted" as const,
            run: runFromRaw(rawRun),
            member: boundMemberFromRaw(rawMember),
            deleted,
        };
    }).immediate();
}
