import assert from "node:assert/strict"
import { after, test } from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-five-boss-solo-rewards-"))
process.env.WF_DATABASE_DIR = databaseDir

const accountDomain = require("../data/domains/account") as typeof import("../data/domains/account")
const playerDomain = require("../data/domains/player") as typeof import("../data/domains/player")
const itemDomain = require("../data/domains/item") as typeof import("../data/domains/item")
const { getDb } = require("../data/db") as typeof import("../data/db")
const soloModule = require("../multi/five-boss/solo-rewards") as typeof import("../multi/five-boss/solo-rewards")
const rewardModule = require("../multi/five-boss/rewards") as typeof import("../multi/five-boss/rewards")
const { FIVE_BOSS_GAUNTLET_REWARD_IDS, FIVE_BOSS_GAUNTLET_REWARD_DISPLAY } = rewardModule

function createPlayer(): number {
    const account = accountDomain.insertAccountSync({
        appId: `five-boss-solo-${Date.now()}-${Math.random()}`,
        idpAlias: "test", idpCode: "test", idpId: `five-boss-solo-${Math.random()}`, status: "active",
    })
    return playerDomain.insertDefaultPlayerSync(account.id).id
}

after(() => {
    try { getDb().close() } catch { /* ignore */ }
    rmSync(databaseDir, { recursive: true, force: true })
})

test("solo multiplier is 2x only for a run that stayed manual from start to finish", () => {
    // 2026-09-09 作者:「auto 锁开启也双倍奖励」—— 与多人同口径:全程手动 2 倍,AUTO 局 1 倍。
    assert.equal(soloModule.fiveBossSoloRewardMultiplier({ autoAtStart: false, autoUsed: false }), 2)
    assert.equal(soloModule.fiveBossSoloRewardMultiplier({ autoAtStart: true, autoUsed: false }), 1)
    assert.equal(soloModule.fiveBossSoloRewardMultiplier({ autoAtStart: false, autoUsed: true }), 1)
    // 快照缺失(重建的 active quest / 陈旧行)fail-closed 到 1 倍
    assert.equal(soloModule.fiveBossSoloRewardMultiplier(null), 1)
})

test("manual solo clear grants the mode materials at 2x and reports display drops", () => {
    // 2026-09-28 设计稿:结晶 10×倍率;心核保底 1×倍率(0.99 只错过 25% 加成roll)。
    // cursedWeaponPool:[] 让武器掷骰直接短路,不消耗额外 randomFloat 调用,这条测试只看材料口径。
    const playerId = createPlayer()
    const result = soloModule.grantFiveBossSoloRewardsSync({
        playerId, firstClear: true, rewardMultiplier: 2, randomFloat: () => 0.99, cursedWeaponPool: [],
    })
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment) ?? 0, 0)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), 20)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem), 1)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore), 2)
    // 作者 0928:深界王币每局 10..15,不乘手动倍率;0.99 → 10 + floor(0.99×6) = 15
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.kingCoin), 15)
    assert.deepEqual(result.items, {
        [FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal]: 20,
        [FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem]: 1,
        [FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore]: 2,
        [FIVE_BOSS_GAUNTLET_REWARD_IDS.kingCoin]: 15,
    })
    assert.deepEqual(result.dropAdditionalRewardIds.map(d => [d.group_id, d.index, d.number]), [
        [FIVE_BOSS_GAUNTLET_REWARD_DISPLAY.additionalRewardGroupId, 2, 20],
        [FIVE_BOSS_GAUNTLET_REWARD_DISPLAY.additionalRewardGroupId, 3, 1],
        [FIVE_BOSS_GAUNTLET_REWARD_DISPLAY.additionalRewardGroupId, 4, 2],
        [FIVE_BOSS_GAUNTLET_REWARD_DISPLAY.additionalRewardGroupId, 5, 15],
    ])
    assert.deepEqual(result.equipment_list, [])
    assert.deepEqual(result.grantedEquipment, [])
})

test("repeat solo clear skips the first-clear emblem and rolls blueprint and core at 2x", () => {
    const playerId = createPlayer()
    const result = soloModule.grantFiveBossSoloRewardsSync({
        playerId, firstClear: false, rewardMultiplier: 2, randomFloat: () => 0.1, cursedWeaponPool: [],
    })
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem) ?? 0, 0)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment), 1)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), 20)
    // 2026-09-28 设计稿:心核必掉 1×倍率(=2)+ 0.1<25% 命中额外 1×倍率(=2)= 4。
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore), 4)
    // 王币不乘手动倍率:0.1 → 10 + floor(0.6) = 10
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.kingCoin), 10)
    assert.equal(result.granted.length, 4)
    assert.deepEqual(result.grantedEquipment, [])
})

test("an Auto-start solo clear grants the mode materials at 1x", () => {
    const playerId = createPlayer()
    const result = soloModule.grantFiveBossSoloRewardsSync({
        playerId, firstClear: false, rewardMultiplier: 1, randomFloat: () => 0.99, cursedWeaponPool: [],
    })
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), 10)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore), 1)
    assert.deepEqual(result.items, {
        [FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal]: 10,
        [FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore]: 1,
        [FIVE_BOSS_GAUNTLET_REWARD_IDS.kingCoin]: 15,
    })
})

test("solo clear rolls and grants distinct cursed weapons, with one display row per hit", () => {
    const playerId = createPlayer()
    const values = [
        0.9, // blueprint check: miss (rate 0.6)
        0.9, // five-king-core bonus check: miss -> base only
        0.5, // king coin: 10 + floor(0.5×6) = 13
        0.01, 0, // weapon roll 1: hit (rate 0.05), pick index 0 -> 5910101
        0.01, 0.999999, // weapon roll 2: hit, pick index 2 -> 5910103
    ]
    const result = soloModule.grantFiveBossSoloRewardsSync({
        playerId,
        firstClear: true,
        rewardMultiplier: 2,
        randomFloat: () => values.shift() as number,
        cursedWeaponPool: [5910101, 5910102, 5910103],
    })

    assert.deepEqual(result.grantedEquipment, [5910101, 5910103])
    assert.deepEqual(
        result.equipment_list.map(e => (e as { equipment_id: number, stack: number }).equipment_id).sort(),
        [5910101, 5910103],
    )
    for (const equipment of result.equipment_list as Array<{ stack: number }>) {
        assert.equal(equipment.stack, 0) // 首次持有,stack 从 0 起
    }
    const weaponDrops = result.dropAdditionalRewardIds.filter(d => d.group_id === 590010001)
    assert.deepEqual(weaponDrops.map(d => [d.index, d.number]), [[1, 1], [3, 1]])
})

test("a repeated weapon hit collapses into one equipment_list entry but keeps two display rows", () => {
    const playerId = createPlayer()
    const values = [
        0.9, 0.9, // material rolls: both miss/base-only, irrelevant to this test
        0.5,      // king coin roll (13), irrelevant to this test
        0, 0,       // weapon roll 1: hit, pick the only pool entry
        0.01, 0.5,  // weapon roll 2: hit (rate 0.05), pick the only pool entry again
    ]
    const result = soloModule.grantFiveBossSoloRewardsSync({
        playerId,
        firstClear: false,
        rewardMultiplier: 2,
        randomFloat: () => values.shift() as number,
        cursedWeaponPool: [5910101],
    })

    assert.deepEqual(result.grantedEquipment, [5910101, 5910101])
    assert.equal(result.equipment_list.length, 1)
    assert.equal((result.equipment_list[0] as { stack: number }).stack, 1) // 两次 +1 命中,最终 stack=1
    const weaponDrops = result.dropAdditionalRewardIds.filter(d => d.group_id === 590010001)
    assert.deepEqual(weaponDrops.map(d => [d.index, d.number]), [[1, 1], [1, 1]])
})
