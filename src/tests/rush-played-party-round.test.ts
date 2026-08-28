/**
 * 排行榜编队子页的**轮次标签换算**。
 *
 * 全仓的「已出战队伍」表用 **quest id** 当 round 存
 * (`src/lib/quest/finish/rush-handler.ts` 的 `let round: number = questId`),
 * 而客户端把 `data.rush_ranking_party` 这个 Map 的键直接渲染成官方文案
 * `rush_event_ranking_party_list_round_number` =「在第::value::回战使用的队伍」。
 * 不换算的话玩家看到的是「在第700099001回战使用的队伍」。
 *
 * 换算的权威来源是 `assets/rush_event_quest.json` 自己的 `rushEventRound` 列。
 * 这里锁三件事:
 *   · 换算表本身对(700099001 -> 1、无尽关 -> 0、不存在的关 -> null);
 *   · `/ranking/played_party` 的键换成 1..N;
 *   · **换不出来时整体退回 quest id** —— 宁可标签难看,也不能悄悄少发一支队伍。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-rush-round-"));
process.env.WF_DATABASE_DIR = databaseDir;

const { getRushEventQuestRound } = require("../lib/assets") as typeof import("../lib/assets");
const { getRushRankingPlayedPartyListSync } = require("../lib/rush") as typeof import("../lib/rush");
const rushEventDomain = require("../data/domains/rushEvent") as typeof import("../data/domains/rushEvent");
const playerDomain = require("../data/domains/player") as typeof import("../data/domains/player");
const accountDomain = require("../data/domains/account") as typeof import("../data/domains/account");
const { RushEventBattleType } = require("../data/types") as typeof import("../data/types");

/** 深渊连战。它的 folder 1 是 30 战的塔,关卡号 700099001..700099030。 */
const TOWER_EVENT_ID = 700099;

/** 一个 `assets/rush_event_quest.json` 里根本不存在的事件号,用来验退路。 */
const UNKNOWN_EVENT_ID = 700097;

function newPlayer(tag: string): number {
    const account = accountDomain.insertAccountSync({
        appId: `rush-round-${tag}`,
        idpAlias: "test",
        idpCode: "test",
        idpId: `rush-round-${tag}`,
        status: "active",
    });
    return playerDomain.insertDefaultPlayerSync(account.id).id;
}

function insertFolderParty(playerId: number, eventId: number, round: number): void {
    rushEventDomain.insertPlayerRushEventPlayedPartySync(playerId, eventId, {
        characterIds: [101, 102, 103],
        unisonCharacterIds: [201, null, null],
        equipmentIds: [301, null, null],
        abilitySoulIds: [401, null, null],
        evolutionImgLevels: [1, 0, 0],
        unisonEvolutionImgLevels: [0, null, null],
        round,
        battleType: RushEventBattleType.FOLDER,
    });
}

test("换算表读的是 rush_event_quest.json 的 rushEventRound 列", () => {
    assert.equal(getRushEventQuestRound(700099001), 1);
    assert.equal(getRushEventQuestRound("700099002"), 2);
    // folder 2 是无尽模式,官方把它的 round 记成 0
    assert.equal(getRushEventQuestRound(700099099), 0);
    // 不存在的关卡不许瞎猜一个号出来
    assert.equal(getRushEventQuestRound(999999999), null);
});

test("played_party 的键是第几战(1..N),不是 quest id", () => {
    const playerId = newPlayer("tower");
    for (const questId of [700099001, 700099002, 700099003]) {
        insertFolderParty(playerId, TOWER_EVENT_ID, questId);
    }

    const list = getRushRankingPlayedPartyListSync(playerId, TOWER_EVENT_ID);
    assert.deepEqual(Object.keys(list).sort(), ["1", "2", "3"],
        "键没换算成轮次号,客户端会显示「在第700099001回战使用的队伍」");
    // 换算不许把队伍内容弄丢
    assert.equal(list[1]!.character_id_1, 101);
    assert.equal(list[3]!.unison_character_id_1, 201);
});

test("无尽模式的队伍不进这张表", () => {
    const playerId = newPlayer("endless");
    insertFolderParty(playerId, TOWER_EVENT_ID, 700099001);
    rushEventDomain.insertPlayerRushEventPlayedPartySync(playerId, TOWER_EVENT_ID, {
        characterIds: [111, null, null],
        unisonCharacterIds: [null, null, null],
        equipmentIds: [null, null, null],
        abilitySoulIds: [null, null, null],
        evolutionImgLevels: [0, null, null],
        unisonEvolutionImgLevels: [null, null, null],
        round: 700099099,
        battleType: RushEventBattleType.ENDLESS,
    });

    const list = getRushRankingPlayedPartyListSync(playerId, TOWER_EVENT_ID);
    assert.deepEqual(Object.keys(list), ["1"], "ENDLESS 的队伍不该出现在塔的编队子页上");
});

test("换算不出来时整体退回 quest id —— 一支队伍都不许丢", () => {
    const playerId = newPlayer("unknown");
    // 这些关卡号在 assets/rush_event_quest.json 里不存在
    for (const questId of [700097001, 700097002]) {
        insertFolderParty(playerId, UNKNOWN_EVENT_ID, questId);
    }

    const list = getRushRankingPlayedPartyListSync(playerId, UNKNOWN_EVENT_ID);
    assert.deepEqual(Object.keys(list).sort(), ["700097001", "700097002"],
        "换算不出来就该原样发 quest id,而不是丢行或发 null 键");
});
