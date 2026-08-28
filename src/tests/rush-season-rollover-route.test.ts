/**
 * `POST /api/rush-leaderboard/:eventId/season/rollover` 的**请求形状契约**。
 *
 * 这个端点是全服唯一的换期入口:后台按钮、CLI `wf_rogue_reroll.py`、
 * GUI 的三条发布路都打在它上面。它有两件事一旦悄悄变了就是「静默不换期」——
 * 而静默不换期的表现是「新塔上一直挂着旧塔的排行」,没人会立刻发现:
 *
 *  1. **请求形状**。工具侧发的是 `POST` + `Content-Type: application/json` + `{}`。
 *     20260828 实测的病因(三轮复核纠正):urllib 在 `data=` 非 None 时会**自动补**
 *     `Content-type: application/x-www-form-urlencoded`(`AbstractHTTPHandler.do_request_`),
 *     而 Fastify 5 没有该 content-type 的 parser ⇒ 415 FST_ERR_CTP_INVALID_MEDIA_TYPE。
 *     所以不是「少了 Content-Type」,是「补上的那个类型不受支持」—— 必须显式覆盖成
 *     application/json 并带合法 JSON 体。第一版的 `data=b""` 无 header 写法
 *     **每次都会失败**,而失败只在重摇日志里留一行 WARN。
 *     后台那颗按钮发的又是另一种形状(`Content-Type: application/json` + 空 body),
 *     两种都得能过。
 *  2. **结算真失败时返回 409 而不是 2xx**。调用方(CLI/GUI)据此判断
 *     「期到底换没换」:2xx = 换了,409 = 塔换了榜没换,要喊人。
 *
 * 用真库(临时目录)+ 真插件跑,不打桩 —— 打桩就测不到 Fastify 的内容类型解析。
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify, { FastifyInstance } from "fastify";

const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-rush-rollover-route-"));
process.env.WF_DATABASE_DIR = databaseDir;

const rushLeaderboardApiPlugin =
    require("../routes/web_api/rushLeaderboard").default as typeof import("../routes/web_api/rushLeaderboard").default;
const domain =
    require("../data/domains/rushLeaderboard") as typeof import("../data/domains/rushLeaderboard");
const settlementDomain =
    require("../data/domains/rushSettlement") as typeof import("../data/domains/rushSettlement");
const { getDb } = require("../data/db") as typeof import("../data/db");

const EVENT_ID = 700099;

async function app(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(rushLeaderboardApiPlugin, { prefix: "/api/rush-leaderboard" });
    await instance.ready();
    return instance;
}

test("settlement GET:degree-only 档也算奖励已配置", async () => {
    const instance = await app();
    const original = settlementDomain.getRushSettlementConfigSync(EVENT_ID, 1, Date.now());
    try {
        settlementDomain.putRushSettlementConfigSync({
            ...original,
            rewardTiers: [
                { fromRank: 1, toRank: null, itemId: null, count: 1, degreeId: 9900005 },
            ],
            updatedAtMs: Date.now(),
        });
        const response = await instance.inject({
            method: "GET",
            url: `/api/rush-leaderboard/${EVENT_ID}/settlement`,
            headers: { accept: "application/json" },
        });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().rewardsConfigured, true,
            "只发称号是完整奖励配置,后台不能误报成不会发任何奖励");
    } finally {
        settlementDomain.putRushSettlementConfigSync(original);
        await instance.close();
    }
});

test("工具侧那种 POST(application/json + {})能过 Fastify 的内容类型闸", async () => {
    const instance = await app();
    try {
        domain.rushLeaderboardStore.putSeason({
            eventId: EVENT_ID, season: 1, startedAtMs: 0, fingerprint: "x", source: "test",
        });

        const response = await instance.inject({
            method: "POST",
            url: `/api/rush-leaderboard/${EVENT_ID}/season/rollover?source=reroll-cli`,
            headers: { "content-type": "application/json", accept: "application/json" },
            payload: "{}",
        });

        assert.notEqual(response.statusCode, 415,
            "415 = Fastify 把这个请求挡在路由之前 ⇒ 重摇塔永远换不了期,而且是静默的");
        assert.equal(response.statusCode, 200, response.body);
        const body = response.json();
        assert.equal(body.season, 1,
            "这一期是空的 ⇒ 良性跳过结算,而且**原地复用这一期**:空期 +1 只会在台账里"
            + "留下一段没人打过的空榜,而期号推进不可逆(20260828 三轮复核)");
        assert.equal(body.rolled, false, "调用方要能看出期号到底动没动");
        assert.equal(body.blocked, false);
        assert.equal(body.code, "empty-season");
        assert.equal(domain.rushLeaderboardStore.getSeason(EVENT_ID)?.source, "reroll-cli",
            "来源要从查询串里取到 —— 排障时才知道是哪条入口换的期");
    } finally {
        await instance.close();
    }
});

test("不带 source 时回落 admin-manual", async () => {
    const instance = await app();
    try {
        const before = domain.rushLeaderboardStore.getSeason(EVENT_ID)!.season;
        const response = await instance.inject({
            method: "POST",
            url: `/api/rush-leaderboard/${EVENT_ID}/season/rollover`,
            headers: { "content-type": "application/json", accept: "application/json" },
            payload: "{}",
        });

        assert.equal(response.statusCode, 200, response.body);
        // 这一期仍然是空的 ⇒ 期号原地复用(见上一条);但来源要照写,
        // 否则排障时看不出这一刀是谁打的。
        assert.equal(response.json().season, before);
        assert.equal(response.json().rolled, false);
        assert.equal(domain.rushLeaderboardStore.getSeason(EVENT_ID)?.source, "admin-manual");
    } finally {
        await instance.close();
    }
});

test("**空 body** 的 application/json 在裸 Fastify 上会 400 —— 所以调用方一律发 `{}`", async () => {
    const instance = await app();
    try {
        const response = await instance.inject({
            method: "POST",
            url: `/api/rush-leaderboard/${EVENT_ID}/season/rollover`,
            headers: { "content-type": "application/json", accept: "application/json" },
        });
        assert.equal(response.statusCode, 400, response.body);
        assert.equal(response.json().code, "FST_ERR_CTP_EMPTY_JSON_BODY");
    } finally {
        await instance.close();
    }
    // 这条不是「端点坏了」而是**为什么三个调用方都显式发 `{}`**的证据:
    // 线上 cn-server 给 application/json 装了个会吞解析错误的自定义 parser
    // (src/cn-server.ts 的 jsonParser),所以空 body 今天也能过 ——
    // 但那是个偶然,parser 一收紧,换期就静默失效(表现是「新塔挂着旧榜」)。
    // 后台按钮、CLI `wf_rogue_reroll.py`、GUI 三条发布路现在发的都是上面那种
    // 在**任何** parser 配置下都合法的形状。
    const clientSource = require("node:fs").readFileSync(
        require("node:path").join(__dirname, "..", "..", "admin", "src", "pages",
            "RushLeaderboard.tsx"), "utf8") as string;
    assert.match(clientSource, /season\/rollover`,\s*\{\}\)/,
        "后台那颗按钮又改回不带 body 了 —— parser 一收紧它就会静默 400");
});

test("来源里的怪字符不许进台账(回落 admin-manual)", async () => {
    const instance = await app();
    try {
        const response = await instance.inject({
            method: "POST",
            url: `/api/rush-leaderboard/${EVENT_ID}/season/rollover`
                + `?source=${encodeURIComponent("'; DROP TABLE x --")}`,
            headers: { "content-type": "application/json", accept: "application/json" },
            payload: "{}",
        });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(domain.rushLeaderboardStore.getSeason(EVENT_ID)?.source, "admin-manual");
    } finally {
        await instance.close();
    }
});

test("结算真失败 ⇒ 409(而不是 2xx),期号一格不动", async () => {
    const instance = await app();
    try {
        // 这一期得有一条完整成绩,否则命中的是「空期 = 良性跳过」那条路。
        const db = getDb();
        const iso = new Date(0).toISOString();
        const accountId = Number(db.prepare(
            `INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id,
                reg_time, last_login_time, status)
             VALUES ('test', ?, '', '', '', ?, ?, 'normal')`).run(iso, iso, iso).lastInsertRowid);
        const columns = (db.prepare("PRAGMA table_info(players)").all() as { name: string }[])
            .map(column => column.name);
        db.prepare(`INSERT OR REPLACE INTO players (${columns.join(",")}) `
            + `VALUES (${columns.map(() => "?").join(",")})`).run(
                columns.map(column => column === "id" ? 501
                    : column === "name" ? "路由甲"
                        : column === "account_id" ? accountId : 0));
        const run = domain.rushLeaderboardStore.insertRun({
            playerId: 501, playerName: "路由甲", eventId: EVENT_ID, folderId: 1,
            season: domain.rushLeaderboardStore.getSeason(EVENT_ID)!.season,
            startedAtMs: 0, totalRounds: 30, trackedFromRound: 1,
        });
        domain.rushLeaderboardStore.updateRun(run.id, {
            status: "completed", finishedAtMs: 9_000_001, endedAtMs: 9_000_001,
            durationMs: 111_000, battleMs: 110_000, roundsCleared: 30,
            characterIds: [1, null, null], unisonCharacterIds: [null, null, null],
        });
        const seasonBefore = domain.rushLeaderboardStore.getSeason(EVENT_ID)!.season;

        // 造一次真失败:把结算事务中途要写的那张表藏起来。
        db.exec("ALTER TABLE rush_season_results RENAME TO rush_season_results_hidden");
        let response;
        try {
            response = await instance.inject({
                method: "POST",
                url: `/api/rush-leaderboard/${EVENT_ID}/season/rollover?source=reroll-cli`,
                headers: { "content-type": "application/json", accept: "application/json" },
                payload: "{}",
            });
        } finally {
            db.exec("ALTER TABLE rush_season_results_hidden RENAME TO rush_season_results");
        }

        assert.equal(response.statusCode, 409,
            "不能是 500(那是「服务端内部错了」)也不能是 2xx(那会让调用方以为期换了);"
            + "409 = 「按裁定拒绝这次换期」,调用方据此提示人去后台补一刀");
        assert.equal(response.json().blocked, true);
        assert.equal(domain.rushLeaderboardStore.getSeason(EVENT_ID)?.season, seasonBefore,
            "期号一格没动 —— 这一期还结算得了");
    } finally {
        await instance.close();
    }
});
