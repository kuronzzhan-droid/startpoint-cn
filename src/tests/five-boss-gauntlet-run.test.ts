import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
    AbortMemberContext,
    StartMemberContext,
} from "../data/domains/fiveBossGauntletRun";


const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-five-boss-run-v2-"));
process.env.WF_DATABASE_DIR = databaseDir;

const accountDomain = require("../data/domains/account") as typeof import("../data/domains/account");
const playerDomain = require("../data/domains/player") as typeof import("../data/domains/player");
const runDomain = require("../data/domains/fiveBossGauntletRun") as typeof import("../data/domains/fiveBossGauntletRun");
const itemDomain = require("../data/domains/item") as typeof import("../data/domains/item");
const { getDb } = require("../data/db") as typeof import("../data/db");

const TICKET_ITEM_ID = 990001;
const REWARD_ITEM_ID = 990002;
let identity = 0;


function createPlayer(ticketAmount = 0): number {
    identity += 1;
    const account = accountDomain.insertAccountSync({
        appId: `five-boss-run-v2-test-${identity}`,
        idpAlias: "test",
        idpCode: "test",
        idpId: `five-boss-run-v2-test-${identity}`,
        status: "active",
    });
    const playerId = playerDomain.insertDefaultPlayerSync(account.id).id;
    itemDomain.setPlayerItemSync(playerId, TICKET_ITEM_ID, ticketAmount);
    return playerId;
}


function startInput(
    runId: string,
    hostPlayerId: number,
    rosterPlayerIds: number[],
    playerId: number,
    clientPlayId: string,
    isAutoMode = false,
) {
    return {
        runId,
        hostPlayerId,
        routeId: "five_boss_coop_v1",
        roomNumber: `room-${runId}`,
        ticketItemId: TICKET_ITEM_ID,
        rosterPlayerIds,
        playerId,
        clientPlayId,
        isAutoMode,
    };
}


function assertRunError(code: string, action: () => unknown): void {
    assert.throws(action, (error: unknown) => (
        error instanceof runDomain.FiveBossGauntletRunError
        && error.code === code
    ));
}


function persistActiveQuest(context: StartMemberContext) {
    getDb().prepare(`
        INSERT OR REPLACE INTO players_active_quests (
            player_id, play_id, quest_id, category, is_auto_start_mode, is_multi, room_number
        ) VALUES (?, ?, 999001, 3, ?, 1, ?)
    `).run(
        context.member.playerId,
        context.member.clientPlayId,
        context.member.isAutoMode ? 1 : 0,
        context.run.roomNumber,
    );
    return {
        playerId: context.member.playerId,
        clientPlayId: context.member.clientPlayId,
    };
}


function activePlayId(playerId: number): string | null {
    const row = getDb().prepare(`
        SELECT play_id AS playId
        FROM players_active_quests
        WHERE player_id = ?
    `).get(playerId) as { playId: string } | undefined;
    return row?.playId ?? null;
}


function deletePersistentActive(context: AbortMemberContext): number {
    return getDb().prepare(`
        DELETE FROM players_active_quests
        WHERE player_id = ? AND play_id = ?
    `).run(context.member.playerId, context.member.clientPlayId).changes;
}


function runStatus(runId: string): string | null {
    const row = getDb().prepare(`
        SELECT status
        FROM five_boss_gauntlet_runs
        WHERE run_id = ?
    `).get(runId) as { status: string } | undefined;
    return row?.status ?? null;
}


function completeBattleProof(runId: string, playerId: number): void {
    const roomNumber = `room-${runId}`;
    runDomain.recordMemberBattleSignalSync({
        runId,
        playerId,
        roomNumber,
        signal: "level_next",
    });
    runDomain.recordMemberBattleSignalSync({
        runId,
        playerId,
        roomNumber,
        signal: "finalize",
    });
}


after(() => {
    getDb().close();
    delete process.env.WF_DATABASE_DIR;
    const resolved = path.resolve(databaseDir);
    const safeBase = path.resolve(tmpdir());
    assert.ok(resolved.startsWith(`${safeBase}${path.sep}`));
    assert.ok(path.basename(resolved).startsWith("wf-five-boss-run-v2-"));
    rmSync(resolved, { recursive: true, force: true });
});


test("initializer creates the v2 server-run schema and partial client-play lookup", () => {
    const runColumns = getDb().prepare("PRAGMA table_info(five_boss_gauntlet_runs)")
        .all() as Array<{ name: string; pk: number }>;
    assert.equal(runColumns.find(column => column.name === "run_id")?.pk, 1);
    assert.ok(runColumns.some(column => column.name === "expected_member_count"));

    const memberColumns = getDb().prepare("PRAGMA table_info(five_boss_gauntlet_members)")
        .all() as Array<{ name: string; notnull: number }>;
    assert.equal(memberColumns.find(column => column.name === "client_play_id")?.notnull, 0);
    assert.equal(memberColumns.find(column => column.name === "is_auto_mode")?.notnull, 0);
    assert.equal(memberColumns.find(column => column.name === "level_next_at")?.notnull, 0);
    assert.equal(memberColumns.find(column => column.name === "finalized_at")?.notnull, 0);

    const indexes = getDb().prepare("PRAGMA index_list(five_boss_gauntlet_members)")
        .all() as Array<{ name: string; unique: number; partial: number }>;
    assert.ok(indexes.some(index => (
        index.name === "five_boss_gauntlet_member_client_play_unique"
        && index.unique === 1
        && index.partial === 1
    )));
});


test("settlement requires an ordered BothBoss level-next then finalize proof", () => {
    const hostPlayerId = createPlayer(1);
    const runId = "run-battle-proof";
    runDomain.startMemberSync(
        startInput(runId, hostPlayerId, [hostPlayerId], hostPlayerId, "host-proof"),
        persistActiveQuest,
    );

    assertRunError("battle_proof_missing", () => runDomain.settleMemberSync(
        { playerId: hostPlayerId, clientPlayId: "host-proof" },
        () => ({ impossible: true }),
    ));
    assertRunError("battle_signal_order", () => runDomain.recordMemberBattleSignalSync({
        runId,
        playerId: hostPlayerId,
        roomNumber: `room-${runId}`,
        signal: "finalize",
    }));

    const levelNext = runDomain.recordMemberBattleSignalSync({
        runId,
        playerId: hostPlayerId,
        roomNumber: `room-${runId}`,
        signal: "level_next",
    });
    const levelNextReplay = runDomain.recordMemberBattleSignalSync({
        runId,
        playerId: hostPlayerId,
        roomNumber: `room-${runId}`,
        signal: "level_next",
    });
    assert.equal(levelNext.levelNextAt, levelNextReplay.levelNextAt);
    assert.equal(levelNext.finalizedAt, null);
    assertRunError("battle_proof_missing", () => runDomain.settleMemberSync(
        { playerId: hostPlayerId, clientPlayId: "host-proof" },
        () => ({ impossible: true }),
    ));

    const finalized = runDomain.recordMemberBattleSignalSync({
        runId,
        playerId: hostPlayerId,
        roomNumber: `room-${runId}`,
        signal: "finalize",
    });
    const finalizeReplay = runDomain.recordMemberBattleSignalSync({
        runId,
        playerId: hostPlayerId,
        roomNumber: `room-${runId}`,
        signal: "finalize",
    });
    assert.equal(finalized.finalizedAt, finalizeReplay.finalizedAt);
    assert.equal(runDomain.settleMemberSync(
        { playerId: hostPlayerId, clientPlayId: "host-proof" },
        () => ({ allowed: true }),
    ).status, "settled");
});


test("a guest may start first while the host pays and the complete real roster freezes", () => {
    const hostPlayerId = createPlayer(2);
    const guestPlayerId = createPlayer(0);
    const runId = "run-guest-first";
    const input = startInput(
        runId,
        hostPlayerId,
        [guestPlayerId, hostPlayerId],
        guestPlayerId,
        "guest-play-first",
    );

    const result = runDomain.startMemberSync(input, persistActiveQuest);

    assert.equal(result.status, "started");
    assert.equal(result.run.runId, runId);
    assert.equal(result.run.expectedMemberCount, 2);
    assert.equal(itemDomain.getPlayerItemSync(hostPlayerId, TICKET_ITEM_ID), 1);
    assert.equal(activePlayId(guestPlayerId), "guest-play-first");
    assert.deepEqual(
        getDb().prepare(`
            SELECT player_id AS playerId, client_play_id AS clientPlayId, is_auto_mode AS isAutoMode
            FROM five_boss_gauntlet_members
            WHERE run_id = ?
            ORDER BY player_id
        `).all(runId),
        [
            { playerId: hostPlayerId, clientPlayId: null, isAutoMode: null },
            { playerId: guestPlayerId, clientPlayId: "guest-play-first", isAutoMode: 0 },
        ],
    );
});


test("each real member binds an independent client play id without another ticket charge", () => {
    const hostPlayerId = createPlayer(2);
    const guestPlayerId = createPlayer(0);
    const runId = "run-independent-client-play";
    runDomain.startMemberSync(
        startInput(runId, hostPlayerId, [hostPlayerId, guestPlayerId], guestPlayerId, "guest-play"),
        persistActiveQuest,
    );

    const hostStart = runDomain.startMemberSync(
        startInput(runId, hostPlayerId, [guestPlayerId, hostPlayerId], hostPlayerId, "host-play", true),
        persistActiveQuest,
    );

    assert.equal(hostStart.status, "started");
    assert.equal(itemDomain.getPlayerItemSync(hostPlayerId, TICKET_ITEM_ID), 1);
    assert.equal(activePlayId(hostPlayerId), "host-play");
    assert.equal(activePlayId(guestPlayerId), "guest-play");
});


test("an exact start replay persists active quest again but never spends another ticket", () => {
    const hostPlayerId = createPlayer(2);
    const input = startInput(
        "run-start-replay",
        hostPlayerId,
        [hostPlayerId],
        hostPlayerId,
        "host-replay-play",
    );
    let callbackCount = 0;
    const persist = (context: StartMemberContext) => {
        callbackCount += 1;
        return persistActiveQuest(context);
    };

    assert.equal(runDomain.startMemberSync(input, persist).status, "started");
    assert.equal(runDomain.startMemberSync(input, persist).status, "already_started");

    assert.equal(callbackCount, 2);
    assert.equal(itemDomain.getPlayerItemSync(hostPlayerId, TICKET_ITEM_ID), 1);
});


test("active-quest callback failure rolls back host ticket, run, roster, and binding", () => {
    const hostPlayerId = createPlayer(1);
    const guestPlayerId = createPlayer(0);
    const runId = "run-active-callback-failure";
    const input = startInput(
        runId,
        hostPlayerId,
        [hostPlayerId, guestPlayerId],
        guestPlayerId,
        "guest-failed-play",
    );

    assert.throws(() => runDomain.startMemberSync(input, context => {
        persistActiveQuest(context);
        throw new Error("injected active quest failure");
    }), /injected active quest failure/);

    assert.equal(itemDomain.getPlayerItemSync(hostPlayerId, TICKET_ITEM_ID), 1);
    assert.equal(runStatus(runId), null);
    assert.equal(activePlayId(guestPlayerId), null);
    assert.equal(
        (getDb().prepare(`
            SELECT COUNT(*) AS count
            FROM five_boss_gauntlet_members
            WHERE run_id = ?
        `).get(runId) as { count: number }).count,
        0,
    );
});


test("a host without a ticket still starts the run, spends nothing, and settles everyone without rewards", () => {
    // 2026-09-09 作者规则:房主没票也能开局;客人有票也绝不代扣;整局 rewardsEnabled=false。
    const hostPlayerId = createPlayer(0);
    const guestPlayerId = createPlayer(2);
    const runId = "run-host-no-ticket";
    const roster = [hostPlayerId, guestPlayerId];

    const guestStart = runDomain.startMemberSync(
        startInput(runId, hostPlayerId, roster, guestPlayerId, "guest-no-ticket"),
        persistActiveQuest,
    );
    const hostStart = runDomain.startMemberSync(
        startInput(runId, hostPlayerId, roster, hostPlayerId, "host-no-ticket"),
        persistActiveQuest,
    );
    assert.equal(guestStart.status, "started");
    assert.equal(guestStart.run.rewardsEnabled, false);
    assert.equal(hostStart.run.rewardsEnabled, false);
    assert.equal(runStatus(runId), "active");
    assert.equal(activePlayId(guestPlayerId), "guest-no-ticket");
    assert.equal(itemDomain.getPlayerItemSync(hostPlayerId, TICKET_ITEM_ID) ?? 0, 0);
    assert.equal(itemDomain.getPlayerItemSync(guestPlayerId, TICKET_ITEM_ID), 2);

    completeBattleProof(runId, hostPlayerId);
    completeBattleProof(runId, guestPlayerId);
    const seen: boolean[] = [];
    for (const [playerId, clientPlayId] of [[guestPlayerId, "guest-no-ticket"], [hostPlayerId, "host-no-ticket"]] as const) {
        const settled = runDomain.settleMemberSync({ playerId, clientPlayId }, context => {
            seen.push(context.rewardsEnabled);
            return { rewardsEnabled: context.rewardsEnabled };
        });
        assert.equal(settled.run.rewardsEnabled, false);
        assert.deepEqual(settled.reward, { rewardsEnabled: false });
    }
    assert.deepEqual(seen, [false, false]);
    assert.equal(runStatus(runId), "settled");
    assert.equal(itemDomain.getPlayerItemSync(guestPlayerId, TICKET_ITEM_ID), 2);
});


test("immutable run data and frozen roster conflicts are rejected", () => {
    const hostPlayerId = createPlayer(2);
    const guestPlayerId = createPlayer(0);
    const outsiderPlayerId = createPlayer(0);
    const runId = "run-immutable-conflict";
    const input = startInput(runId, hostPlayerId, [hostPlayerId, guestPlayerId], guestPlayerId, "guest-immutable");
    runDomain.startMemberSync(input, persistActiveQuest);

    assertRunError("run_conflict", () => runDomain.startMemberSync(
        { ...input, routeId: "changed-route" },
        persistActiveQuest,
    ));
    assertRunError("roster_conflict", () => runDomain.startMemberSync(
        { ...input, rosterPlayerIds: [hostPlayerId, guestPlayerId, outsiderPlayerId] },
        persistActiveQuest,
    ));
    assert.equal(itemDomain.getPlayerItemSync(hostPlayerId, TICKET_ITEM_ID), 1);
});


test("member binding and reused player/client-play pairs fail closed", () => {
    const hostPlayerId = createPlayer(3);
    const runId = "run-binding-conflict";
    const input = startInput(runId, hostPlayerId, [hostPlayerId], hostPlayerId, "bound-client-play");
    runDomain.startMemberSync(input, persistActiveQuest);

    assertRunError("member_binding_conflict", () => runDomain.startMemberSync(
        { ...input, clientPlayId: "changed-client-play" },
        persistActiveQuest,
    ));
    assertRunError("member_binding_conflict", () => runDomain.startMemberSync(
        { ...input, isAutoMode: true },
        persistActiveQuest,
    ));
    assertRunError("client_play_conflict", () => runDomain.startMemberSync(
        startInput("run-reused-client-play", hostPlayerId, [hostPlayerId], hostPlayerId, "bound-client-play"),
        persistActiveQuest,
    ));

    assert.equal(runStatus("run-reused-client-play"), null);
    assert.equal(itemDomain.getPlayerItemSync(hostPlayerId, TICKET_ITEM_ID), 2);
});


test("a second server run id cannot claim an already-active room or spend another ticket", () => {
    const hostPlayerId = createPlayer(2);
    const ownerInput = startInput(
        "run-room-owner",
        hostPlayerId,
        [hostPlayerId],
        hostPlayerId,
        "room-owner-play",
    );
    runDomain.startMemberSync(
        ownerInput,
        persistActiveQuest,
    );

    assertRunError("run_conflict", () => runDomain.startMemberSync(
        {
            ...startInput("run-room-collision", hostPlayerId, [hostPlayerId], hostPlayerId, "room-collision-play"),
            roomNumber: ownerInput.roomNumber,
        },
        persistActiveQuest,
    ));

    assert.equal(runStatus("run-room-collision"), null);
    assert.equal(itemDomain.getPlayerItemSync(hostPlayerId, TICKET_ITEM_ID), 1);
});


test("a frozen unbound third member prevents early settlement", () => {
    const hostPlayerId = createPlayer(1);
    const guestA = createPlayer(0);
    const guestB = createPlayer(0);
    const roster = [hostPlayerId, guestA, guestB];
    const runId = "run-three-member-settlement";
    runDomain.startMemberSync(startInput(runId, hostPlayerId, roster, hostPlayerId, "host-three"), persistActiveQuest);
    runDomain.startMemberSync(startInput(runId, hostPlayerId, roster, guestA, "guest-a-three"), persistActiveQuest);
    completeBattleProof(runId, hostPlayerId);
    completeBattleProof(runId, guestA);

    const hostReceipt = runDomain.settleMemberSync(
        { playerId: hostPlayerId, clientPlayId: "host-three" },
        () => ({ who: "host" }),
    );
    const guestAReceipt = runDomain.settleMemberSync(
        { playerId: guestA, clientPlayId: "guest-a-three" },
        () => ({ who: "guest-a" }),
    );
    assert.equal(hostReceipt.run.status, "active");
    assert.equal(guestAReceipt.run.status, "active");
    assert.equal(runStatus(runId), "active");

    runDomain.startMemberSync(startInput(runId, hostPlayerId, roster, guestB, "guest-b-three"), persistActiveQuest);
    completeBattleProof(runId, guestB);
    const finalReceipt = runDomain.settleMemberSync(
        { playerId: guestB, clientPlayId: "guest-b-three" },
        () => ({ who: "guest-b" }),
    );
    const finalReplay = runDomain.settleMemberSync(
        { playerId: guestB, clientPlayId: "guest-b-three" },
        () => {
            throw new Error("final receipt replay must not grant again");
        },
    );
    assert.equal(finalReceipt.run.status, "settled");
    assert.equal(finalReplay.run.status, "settled");
    assert.equal(runStatus(runId), "settled");
});


test("settlement derives manual 2x and auto 1x and replays receipts exactly once", () => {
    const hostPlayerId = createPlayer(1);
    const guestPlayerId = createPlayer(0);
    const roster = [hostPlayerId, guestPlayerId];
    const runId = "run-reward-multipliers";
    runDomain.startMemberSync(startInput(runId, hostPlayerId, roster, hostPlayerId, "host-auto", true), persistActiveQuest);
    runDomain.startMemberSync(startInput(runId, hostPlayerId, roster, guestPlayerId, "guest-manual"), persistActiveQuest);
    completeBattleProof(runId, hostPlayerId);
    completeBattleProof(runId, guestPlayerId);
    let guestCallbackCount = 0;

    const guest = runDomain.settleMemberSync(
        { playerId: guestPlayerId, clientPlayId: "guest-manual" },
        context => {
            guestCallbackCount += 1;
            itemDomain.givePlayerItemSync(context.playerId, REWARD_ITEM_ID, 3 * context.rewardMultiplier);
            return { amount: 3 * context.rewardMultiplier };
        },
    );
    const replay = runDomain.settleMemberSync(
        { playerId: guestPlayerId, clientPlayId: "guest-manual" },
        () => {
            throw new Error("receipt replay must not call reward callback");
        },
    );
    const abortAfterReceipt = runDomain.abortMemberSync(
        { playerId: guestPlayerId, clientPlayId: "guest-manual" },
        () => {
            throw new Error("settled member abort must not clear active state");
        },
    );
    const host = runDomain.settleMemberSync(
        { playerId: hostPlayerId, clientPlayId: "host-auto" },
        context => ({ multiplier: context.rewardMultiplier }),
    );

    assert.equal(guest.rewardMultiplier, 2);
    assert.equal(guest.run.rewardsEnabled, true);
    assert.deepEqual(guest.reward, { amount: 6 });
    assert.equal(replay.status, "already_settled");
    assert.deepEqual(replay.reward, guest.reward);
    assert.equal(abortAfterReceipt.status, "already_settled");
    assert.equal(host.rewardMultiplier, 1);
    assert.equal(guestCallbackCount, 1);
    assert.equal(itemDomain.getPlayerItemSync(guestPlayerId, REWARD_ITEM_ID), 6);
    assert.equal(runStatus(runId), "settled");
});


test("reward callback failure rolls back reward writes and receipt", () => {
    const hostPlayerId = createPlayer(1);
    const runId = "run-reward-rollback";
    runDomain.startMemberSync(
        startInput(runId, hostPlayerId, [hostPlayerId], hostPlayerId, "host-reward-fail"),
        persistActiveQuest,
    );
    completeBattleProof(runId, hostPlayerId);

    assert.throws(() => runDomain.settleMemberSync(
        { playerId: hostPlayerId, clientPlayId: "host-reward-fail" },
        context => {
            itemDomain.givePlayerItemSync(context.playerId, REWARD_ITEM_ID, 99);
            throw new Error("injected reward failure");
        },
    ), /injected reward failure/);

    assert.equal(itemDomain.getPlayerItemSync(hostPlayerId, REWARD_ITEM_ID), null);
    assert.equal(runStatus(runId), "active");
    assert.equal(
        (getDb().prepare(`
            SELECT COUNT(*) AS count
            FROM five_boss_gauntlet_receipts
            WHERE run_id = ?
        `).get(runId) as { count: number }).count,
        0,
    );
});


test("guest abort clears only its active quest and is idempotent", () => {
    const hostPlayerId = createPlayer(2);
    const guestPlayerId = createPlayer(0);
    const roster = [hostPlayerId, guestPlayerId];
    const runId = "run-guest-abort";
    runDomain.startMemberSync(startInput(runId, hostPlayerId, roster, hostPlayerId, "host-guest-abort"), persistActiveQuest);
    runDomain.startMemberSync(startInput(runId, hostPlayerId, roster, guestPlayerId, "guest-abort"), persistActiveQuest);
    let callbackCount = 0;
    const clear = (context: AbortMemberContext) => {
        callbackCount += 1;
        return deletePersistentActive(context);
    };

    assert.equal(runDomain.abortMemberSync({ playerId: guestPlayerId, clientPlayId: "guest-abort" }, clear).status, "member_aborted");
    assert.equal(runDomain.abortMemberSync({ playerId: guestPlayerId, clientPlayId: "guest-abort" }, clear).status, "already_aborted");

    assert.equal(callbackCount, 1);
    assert.equal(activePlayId(guestPlayerId), null);
    assert.equal(activePlayId(hostPlayerId), "host-guest-abort");
    assert.equal(runStatus(runId), "active");
    assert.equal(itemDomain.getPlayerItemSync(hostPlayerId, TICKET_ITEM_ID), 1);
});


test("host abort terminates the run without refund while guests may still clear active state", () => {
    const hostPlayerId = createPlayer(2);
    const guestPlayerId = createPlayer(0);
    const roster = [hostPlayerId, guestPlayerId];
    const runId = "run-host-abort";
    const hostInput = startInput(runId, hostPlayerId, roster, hostPlayerId, "host-abort");
    runDomain.startMemberSync(hostInput, persistActiveQuest);
    runDomain.startMemberSync(startInput(runId, hostPlayerId, roster, guestPlayerId, "guest-after-host-abort"), persistActiveQuest);

    assert.equal(runDomain.abortMemberSync({ playerId: hostPlayerId, clientPlayId: "host-abort" }, deletePersistentActive).status, "run_aborted");
    assert.equal(runDomain.abortMemberSync({ playerId: hostPlayerId, clientPlayId: "host-abort" }, deletePersistentActive).status, "already_aborted");
    assert.equal(runStatus(runId), "aborted");
    assert.equal(itemDomain.getPlayerItemSync(hostPlayerId, TICKET_ITEM_ID), 1);
    assertRunError("run_not_active", () => runDomain.startMemberSync(hostInput, persistActiveQuest));
    assertRunError("run_not_active", () => runDomain.settleMemberSync(
        { playerId: guestPlayerId, clientPlayId: "guest-after-host-abort" },
        () => ({ impossible: true }),
    ));

    assert.equal(runDomain.abortMemberSync(
        { playerId: guestPlayerId, clientPlayId: "guest-after-host-abort" },
        deletePersistentActive,
    ).status, "member_aborted");
    assert.equal(activePlayId(guestPlayerId), null);
});


test("settle and abort reject unknown player/client-play lookups explicitly", () => {
    const playerId = createPlayer(0);
    assertRunError("client_play_not_found", () => runDomain.settleMemberSync(
        { playerId, clientPlayId: "unknown-client-play" },
        () => ({ impossible: true }),
    ));
    assertRunError("client_play_not_found", () => runDomain.abortMemberSync(
        { playerId, clientPlayId: "unknown-client-play" },
        deletePersistentActive,
    ));
});

