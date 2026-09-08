import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { getExchangeableGachaItem } from "../lib/gacha-rules";
import { Gacha } from "../lib/types";


// 四只 Rank P5b boss 必须不可兑换;此外只允许 tag_boss 角色被封(名单随作者的池子配置走,
// 2026-09-01 起大 boss 基本都封了,风巨蜥 149998 例外仍可兑换,所以不写死全集)。
const RANK_P5B_BOSS_IDS = new Set([169994, 169980, 179981, 169995]);

function tagBossIds(): Set<number> {
    const characters = JSON.parse(readFileSync(
        join(process.cwd(), "assets", "cdndata", "character.json"), "utf-8"
    )) as Record<string, string[][]>;
    const ids = new Set<number>();
    for (const [id, rows] of Object.entries(characters)) {
        if ((rows[0]?.[5] ?? "").split(",").includes("tag_boss")) ids.add(Number(id));
    }
    return ids;
}

function ashenVerdictGacha(): Gacha {
    const all = JSON.parse(readFileSync(
        join(process.cwd(), "assets", "gacha.json"), "utf-8"
    )) as Record<string, Gacha>;
    const gacha = all["990002"];
    assert.ok(gacha, "assets/gacha.json must contain 990002");
    return gacha;
}

test("990002 exchange endpoint accepts every non-boss row and rejects the blocked bosses", () => {
    const gacha = ashenVerdictGacha();
    const rows = Object.values(gacha.pool).flat();
    const exchangeable = rows.filter(row => row.isExchangeable);
    const blocked = rows.filter(row => !row.isExchangeable);

    // 池子会随自制角色增减(2026-09-01 起 15 只小 boss 也进 990002),不写死总数:
    // 除四只 Rank P5b boss 外的每一行都必须可兑换。
    const blockedIds = new Set(blocked.map(row => row.id));
    const bosses = tagBossIds();
    assert.equal(exchangeable.length + blocked.length, rows.length);
    for (const id of RANK_P5B_BOSS_IDS) assert.ok(blockedIds.has(id), `Rank P5b boss ${id} must stay non-exchangeable`);
    // 不可兑换只允许两种来源:tag_boss 角色,或权重 0 的挂名行(登记在池但永不被抽出,如未完工的自制角色)
    const zeroWeightIds = new Set(rows.filter(row => Number(row.odds) === 0).map(row => row.id));
    for (const id of blockedIds) {
        assert.ok(bosses.has(id) || zeroWeightIds.has(id),
            `blocked row ${id} is neither a tag_boss character nor a zero-weight listing`);
    }

    for (const row of blocked) {
        assert.equal(getExchangeableGachaItem(gacha, row.id), null);
    }
    for (const row of exchangeable) {
        assert.equal(getExchangeableGachaItem(gacha, row.id)?.id, row.id);
    }
});
