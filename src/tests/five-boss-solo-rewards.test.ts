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

test("solo clear grants the mode materials at multiplier 1 and reports display drops", () => {
    const playerId = createPlayer()
    const result = soloModule.grantFiveBossSoloRewardsSync({ playerId, firstClear: true, randomFloat: () => 0.99 })
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment) ?? 0, 0)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), 5)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem), 1)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore) ?? 0, 0)
    assert.deepEqual(result.items, {
        [FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal]: 5,
        [FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem]: 1,
    })
    assert.deepEqual(result.dropAdditionalRewardIds.map(d => [d.group_id, d.index, d.number]), [
        [FIVE_BOSS_GAUNTLET_REWARD_DISPLAY.additionalRewardGroupId, 2, 5],
        [FIVE_BOSS_GAUNTLET_REWARD_DISPLAY.additionalRewardGroupId, 3, 1],
    ])
})

test("repeat solo clear skips the first-clear emblem and can roll the core", () => {
    const playerId = createPlayer()
    const result = soloModule.grantFiveBossSoloRewardsSync({ playerId, firstClear: false, randomFloat: () => 0.1 })
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem) ?? 0, 0)
    assert.equal(itemDomain.getPlayerItemSync(playerId, FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore), 1)
    assert.equal(result.granted.length, 3)
})
