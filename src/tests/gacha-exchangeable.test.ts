import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { getExchangeableGachaItem } from "../lib/gacha-rules";
import { Gacha } from "../lib/types";


const BOSS_IDS = new Set([169994, 169980, 179981, 169995]);

function ashenVerdictGacha(): Gacha {
    const all = JSON.parse(readFileSync(
        join(process.cwd(), "assets", "gacha.json"), "utf-8"
    )) as Record<string, Gacha>;
    const gacha = all["990002"];
    assert.ok(gacha, "assets/gacha.json must contain 990002");
    return gacha;
}

test("990002 exchange endpoint accepts every non-boss row and rejects all four bosses", () => {
    const gacha = ashenVerdictGacha();
    const rows = Object.values(gacha.pool).flat();
    const exchangeable = rows.filter(row => row.isExchangeable);
    const blocked = rows.filter(row => !row.isExchangeable);

    assert.equal(exchangeable.length, 475);
    assert.deepEqual(new Set(blocked.map(row => row.id)), BOSS_IDS);

    for (const row of blocked) {
        assert.equal(getExchangeableGachaItem(gacha, row.id), null);
    }
    for (const row of exchangeable) {
        assert.equal(getExchangeableGachaItem(gacha, row.id)?.id, row.id);
    }
});
