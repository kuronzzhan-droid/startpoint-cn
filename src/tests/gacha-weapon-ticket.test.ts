import assert from "node:assert/strict";
import test from "node:test";

import { buildGachaExecPlan } from "../lib/gacha-exec-plan";
import { GACHA_EXEC_TYPES, GACHA_PAGE_KINDS, GACHA_PAYMENT_TYPES, isGachaExecAllowed } from "../lib/gacha-rules";
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
