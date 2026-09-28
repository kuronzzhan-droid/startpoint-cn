import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { selectWeightedIndexByRoll } from "../lib/gacha";
import { buildGachaExecPlan } from "../lib/gacha-exec-plan";
import {
    GACHA_EXEC_TYPES, GACHA_PAGE_KINDS, GACHA_PAYMENT_TYPES, getExchangeableGachaItem, isGachaExecAllowed,
} from "../lib/gacha-rules";
import { GACHA_TICKET_ITEM_IDS, getGachaTicketCost } from "../lib/gacha-ticket";
import { Gacha, GachaType } from "../lib/types";


// 武器扭蛋 990003:只能用专用券抽的武器池。CN 客户端用专用券时发 exec 3/4(与角色池相同),
// 修复前武器分支只放行 12/13,新池一抽就 H400。
const ONCE_TICKET = 999019;
const TEN_TICKET = 999020;

function weaponPool(overrides: Partial<Gacha> = {}): Gacha {
    return {
        type: GachaType.WEAPON,
        paymentType: 0,
        pageKind: GACHA_PAGE_KINDS.TICKET_ONLY,
        singleCost: 75,
        multiCost: 750,
        discountCost: 25,
        onceTicketItemId: ONCE_TICKET,
        tenTicketItemId: TEN_TICKET,
        wildcardTicketAvailable: false,
        pool: {},
        ...overrides,
    } as Gacha;
}

function plan(gacha: Gacha, execType: number, numberOfExec: number, owned: Record<number, number>) {
    return buildGachaExecPlan({
        gacha,
        paymentType: GACHA_PAYMENT_TYPES.TICKET,
        execType,
        numberOfExec,
        playerFunds: { freeVmoney: 0, paidVmoney: 0 },
        playerGachaData: { isAccountFirst: true, isDailyFirst: true },
        getTicketCount: (itemId) => owned[itemId] ?? 0,
    });
}

test("ticket-only weapon pool accepts CN ticket exec 3/4 and rejects bead payments", () => {
    const gacha = weaponPool();
    for (const exec of [GACHA_EXEC_TYPES.CN_SINGLE_TICKET, GACHA_EXEC_TYPES.CN_MULTI_TICKET,
        GACHA_EXEC_TYPES.SINGLE_WEAPON_TICKET, GACHA_EXEC_TYPES.MULTI_WEAPON_TICKET]) {
        assert.equal(isGachaExecAllowed(gacha, GACHA_PAYMENT_TYPES.TICKET, exec), true, `exec ${exec}`);
    }
    assert.equal(isGachaExecAllowed(gacha, GACHA_PAYMENT_TYPES.FREE_VMONEY, GACHA_EXEC_TYPES.VMONEY_SINGLE), false);
    assert.equal(isGachaExecAllowed(gacha, GACHA_PAYMENT_TYPES.VMONEY, GACHA_EXEC_TYPES.VMONEY_SINGLE), false);
    // 角色池专用的国际服券 exec 仍不能用于武器池
    assert.equal(isGachaExecAllowed(gacha, GACHA_PAYMENT_TYPES.TICKET, GACHA_EXEC_TYPES.SINGLE_TICKET), false);
});

test("CN ticket exec 3/4 on the weapon pool spends the pool's own tickets", () => {
    const gacha = weaponPool();
    assert.deepEqual(getGachaTicketCost(GACHA_EXEC_TYPES.CN_SINGLE_TICKET, 1, gacha),
        { itemId: ONCE_TICKET, useTicketCount: 1, pullCount: 1 });
    assert.deepEqual(getGachaTicketCost(GACHA_EXEC_TYPES.CN_MULTI_TICKET, 2, gacha),
        { itemId: TEN_TICKET, useTicketCount: 2, pullCount: 20 });

    const single = plan(gacha, GACHA_EXEC_TYPES.CN_SINGLE_TICKET, 1, { [ONCE_TICKET]: 3 });
    assert.ok(single.ok);
    assert.deepEqual(single.plan.ticket, { itemId: ONCE_TICKET, beforeCount: 3, afterCount: 2, useTicketCount: 1 });
    assert.equal(single.plan.pullCount, 1);

    const multi = plan(gacha, GACHA_EXEC_TYPES.CN_MULTI_TICKET, 1, { [TEN_TICKET]: 1 });
    assert.ok(multi.ok);
    assert.equal(multi.plan.pullCount, 10);

    // 没有券:拒绝,不回落到任何通用券(wildcard=false)
    const empty = plan(gacha, GACHA_EXEC_TYPES.CN_SINGLE_TICKET, 1, { [GACHA_TICKET_ITEM_IDS.equipmentSingle]: 5 });
    assert.equal(empty.ok, false);
});

test("wildcard weapon pools fall back to equipment tickets, never character tickets", () => {
    const gacha = weaponPool({ pageKind: GACHA_PAGE_KINDS.NORMAL, onceTicketItemId: undefined,
        tenTicketItemId: undefined, wildcardTicketAvailable: true });
    assert.equal(getGachaTicketCost(GACHA_EXEC_TYPES.CN_SINGLE_TICKET, 1, gacha)?.itemId,
        GACHA_TICKET_ITEM_IDS.equipmentSingle);
    assert.equal(getGachaTicketCost(GACHA_EXEC_TYPES.CN_MULTI_TICKET, 1, gacha)?.itemId,
        GACHA_TICKET_ITEM_IDS.equipmentMulti);
    assert.equal(getGachaTicketCost(GACHA_EXEC_TYPES.SINGLE_WEAPON_TICKET, 1, gacha)?.itemId,
        GACHA_TICKET_ITEM_IDS.equipmentSingle);

    // 角色池行为不变
    const character = weaponPool({ type: GachaType.CHARACTER, pageKind: GACHA_PAGE_KINDS.NORMAL,
        onceTicketItemId: undefined, tenTicketItemId: undefined, wildcardTicketAvailable: true });
    assert.equal(getGachaTicketCost(GACHA_EXEC_TYPES.CN_SINGLE_TICKET, 1, character)?.itemId,
        GACHA_TICKET_ITEM_IDS.characterSingle);
    assert.equal(getGachaTicketCost(GACHA_EXEC_TYPES.CN_MULTI_TICKET, 1, character)?.itemId,
        GACHA_TICKET_ITEM_IDS.characterMulti);
});


// ---- 990003 池不变量(读 assets/gacha.json;作者 0928 口径) ----

const CURSED_IDS = Array.from({ length: 29 }, (_, i) => 5910101 + i);
const DEATHBRINGER = 5900101;
const PARADOX = 5920001;

function weaponGacha(): Gacha {
    const all = JSON.parse(readFileSync(join(process.cwd(), "assets", "gacha.json"), "utf-8")) as Record<string, Gacha>;
    const gacha = all["990003"];
    assert.ok(gacha, "assets/gacha.json must contain 990003");
    return gacha;
}

test("990003 is a ticket-only weapon pool with 15% ★5 and its own tickets", () => {
    const gacha = weaponGacha();
    assert.equal(gacha.type, GachaType.WEAPON);
    assert.equal(gacha.pageKind, GACHA_PAGE_KINDS.TICKET_ONLY);
    assert.equal(gacha.onceTicketItemId, ONCE_TICKET);
    assert.equal(gacha.tenTicketItemId, TEN_TICKET);
    assert.equal(gacha.wildcardTicketAvailable, false);
    assert.deepEqual(gacha.rankRates, { normal: [150, 250, 600], multiGuarantee: [150, 850] });
    for (const [key, rank] of [["1", 5], ["2", 4], ["3", 3]] as const) {
        for (const row of gacha.pool[key]) assert.equal(row.rank, rank, `${row.id} in pool ${key}`);
    }
    const ids = Object.values(gacha.pool).flat().map(row => row.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate pool rows");
});

test("990003 ★5 weights give exactly 0.3% per cursed weapon, 0.1% Deathbringer and 0% PARADOX", () => {
    const five = weaponGacha().pool["1"];
    const weights = five.map(row => Number(row.odds));
    const total = weights.reduce((a, b) => a + b, 0);
    assert.equal(total, 22800);
    // 穷举全部 roll,逐行命中次数必须恰好等于权重(确定性证明,不依赖随机数)
    const hits = new Map<number, number>();
    for (let roll = 1; roll <= total; roll += 1) {
        const index = selectWeightedIndexByRoll(weights, roll);
        assert.notEqual(index, null);
        const id = five[index as number].id;
        hits.set(id, (hits.get(id) ?? 0) + 1);
    }
    for (const row of five) assert.equal(hits.get(row.id) ?? 0, Number(row.odds), `row ${row.id}`);
    // ★5 档 15% × 档内占比:诅咒 456/22800 × 15% = 0.3%,死亡使者 152/22800 × 15% = 0.1%
    for (const id of CURSED_IDS) assert.equal(hits.get(id), 456, `cursed ${id}`);
    assert.equal(hits.get(DEATHBRINGER), 152);
    assert.equal(hits.get(PARADOX) ?? 0, 0);
    assert.ok(five.find(row => row.id === DEATHBRINGER)?.isRateUp);
});

test("990003 exchange accepts only the 29 cursed weapons", () => {
    const gacha = weaponGacha();
    const rows = Object.values(gacha.pool).flat();
    const exchangeable = rows.filter(row => row.isExchangeable).map(row => row.id).sort((a, b) => a - b);
    assert.deepEqual(exchangeable, CURSED_IDS);
    for (const id of CURSED_IDS) assert.equal(getExchangeableGachaItem(gacha, id)?.id, id);
    for (const id of [DEATHBRINGER, PARADOX, 8000101, 8000115]) assert.equal(getExchangeableGachaItem(gacha, id), null);
    assert.ok(rows.some(row => row.id === PARADOX), "PARADOX stays listed at 0%");
});

test("five-boss shop no longer sells cursed bodies and sells the two tickets", () => {
    const shop = JSON.parse(readFileSync(join(process.cwd(), "assets", "boss_coin_shop.json"), "utf-8"))["99"] as
        Record<string, { rewards: { type: number, id: number, count: number }[] }>;
    const categoryMap = JSON.parse(readFileSync(join(process.cwd(), "assets",
        "boss_coin_shop_item_category_map.json"), "utf-8")) as Record<string, number>;
    for (const [key, item] of Object.entries(shop)) {
        for (const reward of item.rewards) assert.ok(!CURSED_IDS.includes(reward.id), `${key} still sells ${reward.id}`);
    }
    for (let key = 990099003; key <= 990099031; key += 1) assert.equal(categoryMap[String(key)], undefined, `${key}`);
    assert.deepEqual(shop["990099032"].rewards, [{ type: 0, id: ONCE_TICKET, count: 1 }]);
    assert.deepEqual(shop["990099033"].rewards, [{ type: 0, id: TEN_TICKET, count: 1 }]);
    assert.equal(categoryMap["990099032"], 99);
    assert.equal(categoryMap["990099033"], 99);
});
