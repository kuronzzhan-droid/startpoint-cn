"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.abortMemberSync = exports.settleMemberSync = exports.backfillMissingFinalizeSync = exports.recordMemberBattleSignalSync = exports.startMemberSync = exports.getFiveBossRunByClientSync = exports.FiveBossGauntletRunError = void 0;
const db_1 = require("../db");
const player_1 = require("./player");
const stamina_1 = require("../../lib/stamina");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
class FiveBossGauntletRunError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "FiveBossGauntletRunError";
    }
}
exports.FiveBossGauntletRunError = FiveBossGauntletRunError;
/** Resolve old retries by their immutable play id, even after active quest removal. */
function getFiveBossRunByClientSync(input) {
    if (typeof input.clientPlayId !== "string" || !input.clientPlayId)
        return null;
    const row = (0, db_1.getDb)().prepare(`SELECT run.* FROM five_boss_gauntlet_runs run
        JOIN five_boss_gauntlet_members member ON member.run_id = run.run_id
        WHERE member.player_id = ? AND member.client_play_id = ?`)
        .get(input.playerId, input.clientPlayId);
    return row ? runFromRaw(row) : null;
}
exports.getFiveBossRunByClientSync = getFiveBossRunByClientSync;
function fail(code, message) {
    throw new FiveBossGauntletRunError(code, message);
}
function positiveInteger(name, value) {
    if (!Number.isSafeInteger(value) || value < 1) {
        fail("invalid_argument", `${name} must be a positive safe integer`);
    }
    return value;
}
function boundedText(name, value, maxLength = 255) {
    if (typeof value !== "string"
        || value.length < 1
        || value.length > maxLength
        || value.trim() !== value
        || value.includes("\0")) {
        fail("invalid_argument", `${name} must be non-empty normalized text up to ${maxLength} characters`);
    }
    return value;
}
function booleanValue(name, value) {
    if (typeof value !== "boolean")
        fail("invalid_argument", `${name} must be a boolean`);
    return value;
}
function canonicalRoster(rosterPlayerIds, hostPlayerId, currentPlayerId) {
    if (!Array.isArray(rosterPlayerIds) || rosterPlayerIds.length < 1 || rosterPlayerIds.length > 3) {
        fail("invalid_argument", "rosterPlayerIds must contain one to three real players");
    }
    const roster = rosterPlayerIds.map((playerId, index) => (positiveInteger(`rosterPlayerIds[${index}]`, playerId)));
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
function runFromRaw(row) {
    return {
        runId: row.run_id,
        hostPlayerId: row.host_player_id,
        routeId: row.route_id,
        roomNumber: row.room_number,
        ticketItemId: row.ticket_item_id,
        expectedMemberCount: row.expected_member_count,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function memberFromRaw(row) {
    return {
        runId: row.run_id,
        playerId: row.player_id,
        clientPlayId: row.client_play_id,
        isAutoMode: row.is_auto_mode === null ? null : row.is_auto_mode === 1,
        startedAt: row.started_at,
        battleEnteredAt: row.battle_entered_at,
        abortedAt: row.aborted_at,
        levelNextAt: row.level_next_at,
        finalizedAt: row.finalized_at,
    };
}
function boundMemberFromRaw(row) {
    if (row.client_play_id === null || row.is_auto_mode === null || row.started_at === null) {
        fail("member_binding_conflict", "member binding is incomplete");
    }
    return Object.assign(Object.assign({}, memberFromRaw(row)), { clientPlayId: row.client_play_id, isAutoMode: row.is_auto_mode === 1, startedAt: row.started_at });
}
function selectRun(runId) {
    return (0, db_1.getDb)().prepare(`
        SELECT run_id, host_player_id, route_id, room_number, ticket_item_id,
               expected_member_count, status, created_at, updated_at
        FROM five_boss_gauntlet_runs
        WHERE run_id = ?
    `).get(runId);
}
function selectMember(runId, playerId) {
    return (0, db_1.getDb)().prepare(`
        SELECT run_id, player_id, client_play_id, is_auto_mode, started_at, battle_entered_at, aborted_at,
               level_next_at, finalized_at
        FROM five_boss_gauntlet_members
        WHERE run_id = ? AND player_id = ?
    `).get(runId, playerId);
}
function selectMemberByClient(playerId, clientPlayId) {
    return (0, db_1.getDb)().prepare(`
        SELECT run_id, player_id, client_play_id, is_auto_mode, started_at, battle_entered_at, aborted_at,
               level_next_at, finalized_at
        FROM five_boss_gauntlet_members
        WHERE player_id = ? AND client_play_id = ?
    `).get(playerId, clientPlayId);
}
function validateClientKey(input) {
    return {
        playerId: positiveInteger("playerId", input.playerId),
        clientPlayId: boundedText("clientPlayId", input.clientPlayId),
    };
}
function assertExistingRunContract(row, input) {
    if (row.host_player_id !== input.hostPlayerId
        || row.route_id !== input.routeId
        || row.room_number !== input.roomNumber
        || row.ticket_item_id !== input.ticketItemId) {
        fail("run_conflict", "runId already belongs to different immutable run data");
    }
    const storedRoster = (0, db_1.getDb)().prepare(`
        SELECT player_id
        FROM five_boss_gauntlet_members
        WHERE run_id = ?
        ORDER BY player_id
    `).all(input.runId).map(member => member.player_id);
    if (row.expected_member_count !== input.rosterPlayerIds.length
        || storedRoster.length !== input.rosterPlayerIds.length
        || storedRoster.some((playerId, index) => playerId !== input.rosterPlayerIds[index])) {
        fail("roster_conflict", "runId already has a different frozen real-player roster");
    }
}
function validateStartInput(input) {
    const hostPlayerId = positiveInteger("hostPlayerId", input.hostPlayerId);
    const playerId = positiveInteger("playerId", input.playerId);
    return {
        runId: boundedText("runId", input.runId),
        hostPlayerId,
        routeId: boundedText("routeId", input.routeId),
        roomNumber: boundedText("roomNumber", input.roomNumber),
        ticketItemId: positiveInteger("ticketItemId", input.ticketItemId),
        hostStaminaCost: positiveInteger("hostStaminaCost", input.hostStaminaCost),
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
function startMemberSync(input, persistActiveQuest) {
    const normalized = validateStartInput(input);
    if (typeof persistActiveQuest !== "function") {
        fail("invalid_argument", "persistActiveQuest must be a function");
    }
    const db = (0, db_1.getDb)();
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "event", playerId: normalized.playerId, operation: "start_five_boss_member" }, () => {
        var _a;
        let rawRun = selectRun(normalized.runId);
        if (rawRun) {
            assertExistingRunContract(rawRun, normalized);
            if (rawRun.status !== "active")
                fail("run_not_active", `run is ${rawRun.status}`);
        }
        else {
            // The IMMEDIATE transaction serializes this read with every other first-start.
            // A room may have historical terminal runs, but never two active server run ids.
            const activeRoomRun = db.prepare(`
                SELECT run_id
                FROM five_boss_gauntlet_runs
                WHERE room_number = ? AND status = 'active'
                LIMIT 1
            `).get(normalized.roomNumber);
            if (activeRoomRun && activeRoomRun.run_id !== normalized.runId) {
                fail("run_conflict", "room already belongs to a different active server run");
            }
            // Charge the run owner once, even when a guest's start arrives first.
            // Existing runs (including those begun before a cost update) skip
            // this block; scene changes and retries never charge retroactively.
            const host = (0, player_1.getPlayerSync)(normalized.hostPlayerId);
            if (!host)
                fail("invalid_argument", "host player does not exist");
            const stamina = Math.max(host.stamina, (0, stamina_1.computeRealTimeStamina)(host));
            if (stamina < normalized.hostStaminaCost) {
                fail("insufficient_stamina", "Insufficient stamina.");
            }
            const ticketUpdate = db.prepare(`
                UPDATE players_items
                SET amount = amount - 1
                WHERE player_id = ? AND id = ? AND amount >= 1
            `).run(normalized.hostPlayerId, normalized.ticketItemId);
            if (ticketUpdate.changes !== 1) {
                fail("insufficient_ticket", "host does not own the required ticket");
            }
            (0, player_1.updatePlayerSync)({
                id: normalized.hostPlayerId,
                stamina: stamina - normalized.hostStaminaCost,
                staminaHealTime: new Date(),
                totalStaminaUsed: ((_a = host.totalStaminaUsed) !== null && _a !== void 0 ? _a : 0) + normalized.hostStaminaCost,
            });
            const now = new Date().toISOString();
            db.prepare(`
                INSERT INTO five_boss_gauntlet_runs (
                    run_id, host_player_id, route_id, room_number, ticket_item_id,
                    expected_member_count, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
            `).run(normalized.runId, normalized.hostPlayerId, normalized.routeId, normalized.roomNumber, normalized.ticketItemId, normalized.rosterPlayerIds.length, now, now);
            const insertMember = db.prepare(`
                INSERT INTO five_boss_gauntlet_members (run_id, player_id)
                VALUES (?, ?)
            `);
            for (const rosterPlayerId of normalized.rosterPlayerIds) {
                insertMember.run(normalized.runId, rosterPlayerId);
            }
            rawRun = selectRun(normalized.runId);
            if (!rawRun)
                fail("run_conflict", "new run could not be read back");
        }
        let rawMember = selectMember(normalized.runId, normalized.playerId);
        if (!rawMember)
            fail("roster_conflict", "frozen roster is missing the current member");
        if (db.prepare("SELECT 1 FROM five_boss_gauntlet_receipts WHERE run_id = ? AND player_id = ?")
            .get(normalized.runId, normalized.playerId)) {
            fail("member_not_active", "settled member cannot restart the same run");
        }
        let status;
        if (rawMember.client_play_id === null) {
            const clientOwner = selectMemberByClient(normalized.playerId, normalized.clientPlayId);
            if (clientOwner && clientOwner.run_id !== normalized.runId) {
                fail("client_play_conflict", "player/clientPlayId already belongs to another run");
            }
            const now = new Date().toISOString();
            db.prepare(`
                UPDATE five_boss_gauntlet_members
                SET client_play_id = ?, is_auto_mode = ?, started_at = ?, aborted_at = NULL,
                    battle_entered_at = NULL, level_next_at = NULL, finalized_at = NULL
                WHERE run_id = ? AND player_id = ? AND client_play_id IS NULL
            `).run(normalized.clientPlayId, normalized.isAutoMode ? 1 : 0, now, normalized.runId, normalized.playerId);
            status = "started";
        }
        else {
            if (rawMember.client_play_id !== normalized.clientPlayId
                || (rawMember.is_auto_mode === 1) !== normalized.isAutoMode) {
                fail("member_binding_conflict", "member is already bound to different client start data");
            }
            if (rawMember.aborted_at !== null) {
                db.prepare(`
                    UPDATE five_boss_gauntlet_members
                    SET aborted_at = NULL, battle_entered_at = NULL,
                        level_next_at = NULL, finalized_at = NULL
                    WHERE run_id = ? AND player_id = ?
                `).run(normalized.runId, normalized.playerId);
                status = "resumed";
            }
            else {
                status = "already_started";
            }
        }
        rawMember = selectMember(normalized.runId, normalized.playerId);
        if (!rawMember)
            fail("roster_conflict", "bound member could not be read back");
        const run = runFromRaw(rawRun);
        const member = boundMemberFromRaw(rawMember);
        const persisted = persistActiveQuest({
            run,
            member,
            isReplay: status === "already_started",
        });
        return { status, run, member, persisted };
    });
}
exports.startMemberSync = startMemberSync;
/** Records authenticated battle lifecycle notifications for diagnostics and settlement recovery. */
function recordMemberBattleSignalSync(input) {
    const runId = boundedText("runId", input.runId);
    const roomNumber = boundedText("roomNumber", input.roomNumber);
    const playerId = positiveInteger("playerId", input.playerId);
    if (!["scene_ready", "level_next", "finalize"].includes(input.signal)) {
        fail("invalid_argument", "signal must be scene_ready, level_next or finalize");
    }
    const db = (0, db_1.getDb)();
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "event", playerId, operation: "record_five_boss_battle_signal" }, () => {
        const rawRun = selectRun(runId);
        if (!rawRun)
            fail("run_conflict", "battle signal points to a missing run");
        if (rawRun.room_number !== roomNumber) {
            fail("run_conflict", "battle signal room does not match the immutable run");
        }
        if (rawRun.status !== "active")
            fail("run_not_active", `run is ${rawRun.status}`);
        let rawMember = selectMember(runId, playerId);
        if (!rawMember)
            fail("participant_not_in_roster", "battle signal player is not in the frozen roster");
        boundMemberFromRaw(rawMember);
        if (rawMember.aborted_at !== null)
            fail("member_not_active", "member has aborted this run");
        const now = new Date().toISOString();
        if (input.signal === "scene_ready") {
            db.prepare(`
                UPDATE five_boss_gauntlet_members
                SET battle_entered_at = COALESCE(battle_entered_at, ?)
                WHERE run_id = ? AND player_id = ?
            `).run(now, runId, playerId);
        }
        else if (input.signal === "level_next") {
            db.prepare(`
                UPDATE five_boss_gauntlet_members
                SET level_next_at = COALESCE(level_next_at, ?)
                WHERE run_id = ? AND player_id = ?
            `).run(now, runId, playerId);
        }
        else {
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
        if (!rawMember)
            fail("roster_conflict", "battle proof member could not be read back");
        return boundMemberFromRaw(rawMember);
    });
}
exports.recordMemberBattleSignalSync = recordMemberBattleSignalSync;
/**
 * 真机 2026-09-05:CN 客户端在打完第 5 只 boss 后有时只把 LevelNext 送到了 TCP 战斗通道,
 * Finalize 没到(通道早已被客户端合上),随后的 HTTP finish 被 battle_proof_missing 拒成 H400,
 * 玩家白打一局。finish 请求本身带会话鉴权,且 level_next 已证明第二场景确实进入过,
 * 所以对「有 level_next、缺 finalize、成员未放弃、run 仍 active」这一种情况把 finalize
 * 记成 finish 到达时刻;其余情况原样 fail-closed。
 */
function backfillMissingFinalizeSync(input) {
    const key = validateClientKey(input);
    const rawMember = selectMemberByClient(key.playerId, key.clientPlayId);
    if (!rawMember || rawMember.aborted_at !== null)
        return { backfilled: false };
    if (rawMember.level_next_at === null || rawMember.finalized_at !== null)
        return { backfilled: false };
    const rawRun = selectRun(rawMember.run_id);
    if (!rawRun || rawRun.status !== "active")
        return { backfilled: false };
    recordMemberBattleSignalSync({
        runId: rawRun.run_id,
        playerId: key.playerId,
        roomNumber: rawRun.room_number,
        signal: "finalize",
    });
    return { backfilled: true, runId: rawRun.run_id, roomNumber: rawRun.room_number };
}
exports.backfillMissingFinalizeSync = backfillMissingFinalizeSync;
/** Grants one frozen member's rewards and records the replayable receipt atomically. */
function settleMemberSync(input, grantRewards) {
    const normalized = validateClientKey(input);
    if (typeof grantRewards !== "function")
        fail("invalid_argument", "grantRewards must be a function");
    const db = (0, db_1.getDb)();
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "event", playerId: normalized.playerId, operation: "settle_five_boss_member" }, () => {
        const rawMember = selectMemberByClient(normalized.playerId, normalized.clientPlayId);
        if (!rawMember)
            fail("client_play_not_found", "player/clientPlayId is not bound to a run");
        const existingReceipt = db.prepare(`
            SELECT reward_multiplier, reward_json
            FROM five_boss_gauntlet_receipts
            WHERE run_id = ? AND player_id = ?
        `).get(rawMember.run_id, normalized.playerId);
        if (existingReceipt) {
            const latestRun = selectRun(rawMember.run_id);
            if (!latestRun)
                fail("run_conflict", "receipt points to a missing run");
            return {
                status: "already_settled",
                run: runFromRaw(latestRun),
                rewardMultiplier: existingReceipt.reward_multiplier,
                reward: JSON.parse(existingReceipt.reward_json),
            };
        }
        const rawRun = selectRun(rawMember.run_id);
        if (!rawRun)
            fail("run_conflict", "member points to a missing run");
        if (rawRun.status !== "active")
            fail("run_not_active", `run is ${rawRun.status}`);
        if (rawMember.aborted_at !== null)
            fail("member_not_active", "member has aborted this run");
        const hasBattleEntry = rawMember.battle_entered_at !== null;
        const hasLegacyCompleteProof = rawMember.level_next_at !== null
            && rawMember.finalized_at !== null;
        if (!hasBattleEntry && !hasLegacyCompleteProof) {
            fail("battle_proof_missing", "authenticated battle entry was not recorded");
        }
        const member = boundMemberFromRaw(rawMember);
        const rewardMultiplier = member.isAutoMode ? 1 : 2;
        const reward = grantRewards({
            run: runFromRaw(rawRun),
            member,
            playerId: normalized.playerId,
            rewardMultiplier,
        });
        let rewardJson;
        try {
            rewardJson = JSON.stringify(reward);
        }
        catch (_a) {
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
                    AND member.aborted_at IS NULL
              )
        `).run(now, rawRun.run_id);
        const latestRun = selectRun(rawRun.run_id);
        if (!latestRun)
            fail("run_conflict", "settled run could not be read back");
        return {
            status: "settled",
            run: runFromRaw(latestRun),
            rewardMultiplier,
            reward,
        };
    });
}
exports.settleMemberSync = settleMemberSync;
/**
 * Clears one member's persisted active quest. Every member, including the
 * host, retires as an individual leaver: the remaining members keep fighting
 * and settle normally, and the run closes once no member is left without a
 * receipt or an abort record.
 */
function abortMemberSync(input, deletePersistentActive) {
    const normalized = validateClientKey(input);
    if (typeof deletePersistentActive !== "function") {
        fail("invalid_argument", "deletePersistentActive must be a function");
    }
    const db = (0, db_1.getDb)();
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "event", playerId: normalized.playerId, operation: "abort_five_boss_member" }, () => {
        let rawMember = selectMemberByClient(normalized.playerId, normalized.clientPlayId);
        if (!rawMember)
            fail("client_play_not_found", "player/clientPlayId is not bound to a run");
        let rawRun = selectRun(rawMember.run_id);
        if (!rawRun)
            fail("run_conflict", "member points to a missing run");
        const member = boundMemberFromRaw(rawMember);
        if (rawMember.aborted_at !== null) {
            return {
                status: "already_aborted",
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
                status: "already_settled",
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
        if (rawRun.status === "active") {
            const remainingMember = db.prepare(`
                SELECT 1
                FROM five_boss_gauntlet_members member
                LEFT JOIN five_boss_gauntlet_receipts receipt
                    ON receipt.run_id = member.run_id AND receipt.player_id = member.player_id
                WHERE member.run_id = ? AND member.aborted_at IS NULL AND receipt.player_id IS NULL
                LIMIT 1
            `).get(rawRun.run_id);
            if (isHost && !remainingMember) {
                // The host was the last member still in the run: nobody is left
                // to continue, so close it as aborted and let the room dissolve
                // immediately instead of waiting out the return grace.
                db.prepare(`
                    UPDATE five_boss_gauntlet_runs
                    SET status = 'aborted', updated_at = ?
                    WHERE run_id = ? AND status = 'active'
                `).run(now, rawRun.run_id);
            }
            else {
                db.prepare(`UPDATE five_boss_gauntlet_runs SET status = 'settled', updated_at = ?
                    WHERE run_id = ? AND status = 'active' AND NOT EXISTS (
                        SELECT 1 FROM five_boss_gauntlet_members member
                        LEFT JOIN five_boss_gauntlet_receipts receipt
                            ON receipt.run_id = member.run_id AND receipt.player_id = member.player_id
                        WHERE member.run_id = five_boss_gauntlet_runs.run_id
                            AND member.aborted_at IS NULL AND receipt.player_id IS NULL
                    )`).run(now, rawRun.run_id);
            }
        }
        rawMember = selectMember(rawRun.run_id, normalized.playerId);
        rawRun = selectRun(rawRun.run_id);
        if (!rawMember || !rawRun)
            fail("run_conflict", "abort state could not be read back");
        return {
            // "run_aborted" only when this host abort actually closed the run
            // (the host was the last member); an ordinary host leave is the
            // same as any other member leave.
            status: isHost && rawRun.status === "aborted"
                ? "run_aborted"
                : "member_aborted",
            run: runFromRaw(rawRun),
            member: boundMemberFromRaw(rawMember),
            deleted,
        };
    });
}
exports.abortMemberSync = abortMemberSync;
