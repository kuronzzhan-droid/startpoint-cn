import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
    AwakeningMaterialRules, checkAwakeningItem, parseAwakeningMaterialRules, resolveEquipmentRarity,
} from "../lib/equipment-awakening-rules";
import { getEquipmentAwakeningRulesSync } from "../lib/assets";

// 武器觉醒白名单(设计 D:/WF/out/武器觉醒与新掉落-20260928/设计.md §2.6/§8.2):
// 29 把诅咒武器 + PARADOX 只收禁忌星铁 10000311;其余装备只收 12001(★≤4)/12002(★5)。
const FORBIDDEN_STAR_STEEL = 10_000_311;
const KING_COIN = 10_000_310;
const CRYSTAL_4 = 12_001;
const CRYSTAL_5 = 12_002;
const WRIGHTPIECE = 100_000;
const PARADOX = 5_920_001;
const CURSED = Array.from({ length: 29 }, (_, i) => 5_910_101 + i);
const RESTRICTED = [...CURSED, PARADOX];
const OFFICIAL_5 = 5_010_004;
const OFFICIAL_4 = 4_010_003;
const OFFICIAL_3 = 3_010_006;
const ABYSS_5 = 8_000_101;     // equipment c11 = 5, id prefix 8
const FANTASY_5 = 100_013;     // equipment c11 = 5, id prefix 0

const assetPath = join(__dirname, "..", "..", "assets", "equipment_awakening_material.json");
const rawAsset = JSON.parse(readFileSync(assetPath, "utf-8"));
const rules: AwakeningMaterialRules = parseAwakeningMaterialRules(rawAsset);

function allowed(equipmentId: unknown, itemId: unknown, useStack: unknown = false): boolean {
    return checkAwakeningItem(rules, { equipmentId, itemId, useStack }).ok;
}

test("asset lists exactly the 29 cursed weapons and PARADOX, all on 禁忌星铁", () => {
    assert.deepEqual([...rules.materialByEquipment.keys()].sort((a, b) => a - b), RESTRICTED);
    for (const id of RESTRICTED) assert.equal(rules.materialByEquipment.get(id), FORBIDDEN_STAR_STEEL, `${id}`);
    // The PARADOX decay tiers only swap abilities at battle assembly; the owned item is always 5920001.
    for (const tier of [5_921_001, 5_922_001, 5_923_001]) assert.equal(rules.materialByEquipment.has(tier), false);
});

test("asset official crystals mirror item c10/c11: 12001 ★≤4, 12002 ★5 only", () => {
    assert.deepEqual([...rules.officialCrystals.entries()].sort(([a], [b]) => a - b), [
        [CRYSTAL_4, { kind: "max", rarity: 4 }],
        [CRYSTAL_5, { kind: "exact", rarity: 5 }],
    ]);
});

test("asset rarity overrides cover the ★5 weapons whose id prefix lies", () => {
    for (let id = 8_000_101; id <= 8_000_115; id += 1) assert.equal(resolveEquipmentRarity(rules, id), 5, `${id}`);
    for (let id = 100_013; id <= 100_023; id += 1) assert.equal(resolveEquipmentRarity(rules, id), 5, `${id}`);
    for (const id of RESTRICTED) assert.equal(resolveEquipmentRarity(rules, id), 5, `${id}`);
    assert.equal(resolveEquipmentRarity(rules, OFFICIAL_4), 4);
    assert.equal(resolveEquipmentRarity(rules, OFFICIAL_3), 3);
});

test("server loader serves the same rules as the checked-in asset", () => {
    const loaded = getEquipmentAwakeningRulesSync();
    assert.deepEqual(loaded, rules);
    assert.equal(getEquipmentAwakeningRulesSync(), loaded, "parsed once");
});

test("restricted equipment accepts 禁忌星铁 only", () => {
    for (const id of RESTRICTED) {
        assert.equal(allowed(id, FORBIDDEN_STAR_STEEL), true, `${id} + 10000311`);
        for (const item of [CRYSTAL_5, CRYSTAL_4, KING_COIN, WRIGHTPIECE, 999_019, 10_000_301]) {
            assert.equal(allowed(id, item), false, `${id} + ${item}`);
        }
    }
});

test("unrestricted equipment accepts only the official crystal of its rarity", () => {
    assert.equal(allowed(OFFICIAL_5, CRYSTAL_5), true);
    assert.equal(allowed(OFFICIAL_5, CRYSTAL_4), false);
    assert.equal(allowed(OFFICIAL_4, CRYSTAL_4), true);
    assert.equal(allowed(OFFICIAL_4, CRYSTAL_5), false);
    assert.equal(allowed(OFFICIAL_3, CRYSTAL_4), true, "12001 c11=true reaches lower rarities");
    assert.equal(allowed(OFFICIAL_3, CRYSTAL_5), false);
    assert.equal(allowed(ABYSS_5, CRYSTAL_5), true);
    assert.equal(allowed(ABYSS_5, CRYSTAL_4), false);
    assert.equal(allowed(FANTASY_5, CRYSTAL_5), true);
    assert.equal(allowed(FANTASY_5, CRYSTAL_4), false);
});

test("unrestricted equipment rejects 禁忌星铁 and arbitrary items", () => {
    for (const id of [OFFICIAL_5, OFFICIAL_4, OFFICIAL_3, ABYSS_5, FANTASY_5]) {
        for (const item of [FORBIDDEN_STAR_STEEL, KING_COIN, WRIGHTPIECE, 999_019, 10_000_147]) {
            assert.equal(allowed(id, item), false, `${id} + ${item}`);
        }
    }
});

test("use_stack=true is untouched whatever item_id says", () => {
    for (const id of [...RESTRICTED, OFFICIAL_5, OFFICIAL_3]) {
        for (const item of [undefined, CRYSTAL_5, KING_COIN, "junk"]) assert.equal(allowed(id, item, true), true);
    }
});

test("item path without a usable item_id or equipment_id is rejected", () => {
    for (const item of [undefined, null, 0, -12_002, 12_002.5, "12002", NaN]) {
        assert.equal(allowed(OFFICIAL_5, item), false, `item ${String(item)}`);
    }
    for (const id of [undefined, null, 0, -5_910_101, "abc", ""]) {
        assert.equal(allowed(id, CRYSTAL_5), false, `equipment ${String(id)}`);
    }
});

test("a numeric-string equipment_id cannot dodge the restricted lookup", () => {
    assert.equal(allowed("5910101", CRYSTAL_5), false);
    assert.equal(allowed("5910101", FORBIDDEN_STAR_STEEL), true);
    assert.equal(allowed(String(ABYSS_5), CRYSTAL_5), true);
});

test("parser rejects malformed or unsafe data", () => {
    const valid = {
        materialByEquipment: { "5910101": FORBIDDEN_STAR_STEEL },
        officialCrystals: { "12001": { maxRarity: 4 }, "12002": { exactRarity: 5 } },
        rarityOverrides: { "8000101": 5 },
    };
    assert.doesNotThrow(() => parseAwakeningMaterialRules(valid));
    const bad: Array<[string, unknown]> = [
        ["not an object", []],
        ["missing materialByEquipment", { ...valid, materialByEquipment: undefined }],
        ["missing rarityOverrides", { ...valid, rarityOverrides: undefined }],
        ["empty officialCrystals", { ...valid, officialCrystals: {} }],
        ["material is an official crystal", { ...valid, materialByEquipment: { "5910101": CRYSTAL_5 } }],
        ["non-integer material", { ...valid, materialByEquipment: { "5910101": "10000311" } }],
        ["non-numeric key", { ...valid, materialByEquipment: { "5910101x": FORBIDDEN_STAR_STEEL } }],
        ["leading-zero key", { ...valid, materialByEquipment: { "05910101": FORBIDDEN_STAR_STEEL } }],
        ["crystal rule with both fields", { ...valid, officialCrystals: { "12001": { maxRarity: 4, exactRarity: 4 } } }],
        ["crystal rarity out of range", { ...valid, officialCrystals: { "12002": { exactRarity: 6 } } }],
        ["override rarity out of range", { ...valid, rarityOverrides: { "8000101": 8 } }],
    ];
    for (const [name, raw] of bad) assert.throws(() => parseAwakeningMaterialRules(raw), /equipment_awakening_material/, name);
});
