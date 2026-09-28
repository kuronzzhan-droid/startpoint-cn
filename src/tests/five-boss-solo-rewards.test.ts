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
    const playerId = createPlayer()
    const result = soloModule.grantFiveBossSoloRewardsSync({ playerId, firstClear: true, rewardMultiplier: 2, randomFloat: () => 0.99 })
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment) ?? 0, 0)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), 10)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem), 1)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore) ?? 0, 0)
    assert.deepEqual(result.items, {
        [FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal]: 10,
        [FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem]: 1,
    })
    assert.deepEqual(result.dropAdditionalRewardIds.map(d => [d.group_id, d.index, d.number]), [
        [FIVE_BOSS_GAUNTLET_REWARD_DISPLAY.additionalRewardGroupId, 2, 10],
        [FIVE_BOSS_GAUNTLET_REWARD_DISPLAY.additionalRewardGroupId, 3, 1],
    ])
})

test("repeat solo clear skips the first-clear emblem and rolls blueprint and core at 2x", () => {
    const playerId = createPlayer()
    const result = soloModule.grantFiveBossSoloRewardsSync({ playerId, firstClear: false, rewardMultiplier: 2, randomFloat: () => 0.1 })
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem) ?? 0, 0)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment), 1)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), 10)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore), 2)
    assert.equal(result.granted.length, 3)
})

test("an Auto-start solo clear grants the mode materials at 1x", () => {
    const playerId = createPlayer()
    const result = soloModule.grantFiveBossSoloRewardsSync({ playerId, firstClear: false, rewardMultiplier: 1, randomFloat: () => 0.99 })
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), 5)
    assert.deepEqual(result.items, { [FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal]: 5 })
})
