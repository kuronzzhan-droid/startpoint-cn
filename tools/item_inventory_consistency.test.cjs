require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "item-inventory-consistency-"))
const previousDataDirectory = process.env.DATA_DIR
process.env.DATA_DIR = dataDirectory

const moduleRoot = process.env.ITEM_INVENTORY_USE_OUT === "1" ? "../out" : "../src"
const moduleExtension = process.env.ITEM_INVENTORY_USE_OUT === "1" ? ".js" : ".ts"
const { getDb } = require(`${moduleRoot}/data/db${moduleExtension}`)
const { insertAccountSync } = require(`${moduleRoot}/data/domains/account${moduleExtension}`)
const { insertDefaultPlayerSync } = require(`${moduleRoot}/data/domains/player${moduleExtension}`)
const {
  getPlayerItemSync,
  setPlayerItemSync,
} = require(`${moduleRoot}/data/domains/item${moduleExtension}`)
const { givePlayerCharacterSync } = require(`${moduleRoot}/lib/character${moduleExtension}`)
const { rewardPlayerGachaDrawResultSync } = require(`${moduleRoot}/lib/gacha${moduleExtension}`)
const { givePlayerRewardsSync } = require(`${moduleRoot}/lib/quest${moduleExtension}`)
const characters = require("../assets/character.json")

const db = getDb()

function cleanup() {
  if (db.open) db.close()
  fs.rmSync(dataDirectory, { recursive: true, force: true })
  if (previousDataDirectory === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = previousDataDirectory
}

process.once("exit", cleanup)

try {
  const account = insertAccountSync({
    appId: "wf_cn",
    idpAlias: "",
    idpCode: "inventory-consistency-test",
    idpId: "inventory-consistency-test",
    status: "normal",
  })
  const player = insertDefaultPlayerSync(account.id)
  const playerId = player.id
  const duplicateStoneIds = {
    3: [14001, 14004, 14007, 14010, 14016, 14013],
    4: [14002, 14005, 14008, 14011, 14017, 14014],
    5: [14003, 14006, 14009, 14012, 14018, 14015],
  }
  const representativeCharacterIds = new Map()

  for (const [rarityText, stoneIds] of Object.entries(duplicateStoneIds)) {
    const rarity = Number(rarityText)
    const rewardCount = { 3: 1, 4: 1, 5: 3 }[rarity]
    for (let element = 0; element < stoneIds.length; element += 1) {
      const characterEntry = Object.entries(characters).find(([characterId, character]) =>
        Number(characterId) > 100000
        && character.rarity === rarity
        && character.element === element
      )
      assert.ok(characterEntry, `missing rarity ${rarity}, element ${element} character fixture`)
      const characterId = Number(characterEntry[0])
      const stoneId = stoneIds[element]
      representativeCharacterIds.set(`${rarity}:${element}`, characterId)

      const firstGrant = givePlayerCharacterSync(playerId, characterId)
      assert.ok(firstGrant)
      assert.equal(firstGrant.item, undefined)

      const beforeCount = 50 + rarity * 10 + element
      setPlayerItemSync(playerId, stoneId, beforeCount)
      const duplicateGrant = givePlayerCharacterSync(playerId, characterId)
      assert.deepEqual(duplicateGrant.item, {
        id: stoneId,
        count: rewardCount,
        inventoryCount: beforeCount + rewardCount,
      })
      assert.equal(getPlayerItemSync(playerId, stoneId), beforeCount + rewardCount)
    }
  }

  const fireRarity5CharacterId = representativeCharacterIds.get("5:0")
  const fireRarity5StoneId = 14003

  setPlayerItemSync(playerId, fireRarity5StoneId, 55)
  const duplicateGrant = givePlayerCharacterSync(playerId, fireRarity5CharacterId)
  assert.deepEqual(duplicateGrant.item, {
    id: fireRarity5StoneId,
    count: 3,
    inventoryCount: 58,
  })
  assert.equal(getPlayerItemSync(playerId, fireRarity5StoneId), 58)

  const gacha = {
    type: 0,
    paymentType: 0,
    singleCost: 0,
    multiCost: 0,
    discountCost: 0,
    startDate: "2026-01-01 00:00:00",
    endDate: "2099-01-01 00:00:00",
    movieName: "test",
    guaranteeMovieName: "test",
    pool: {},
  }
  const skippedMoviePlan = [0, 1].map(() => ({
    characterId: fireRarity5CharacterId,
    rarity: 5,
    movieId: "test",
    seed: fireRarity5CharacterId * 1000,
    moviePlayable: false,
    rarityUp: false,
    requiresVerification: false,
  }))
  const gachaResult = rewardPlayerGachaDrawResultSync(
    playerId,
    gacha,
    [fireRarity5CharacterId, fireRarity5CharacterId],
    undefined,
    skippedMoviePlan,
  )
  assert.equal(getPlayerItemSync(playerId, fireRarity5StoneId), 64)
  assert.equal(gachaResult.items[fireRarity5StoneId], 64)
  assert.deepEqual(
    gachaResult.draw.map((draw) => draw.ex_boost_item),
    [
      { id: fireRarity5StoneId, count: 3 },
      { id: fireRarity5StoneId, count: 3 },
    ],
  )

  const ordinaryItemId = 901
  setPlayerItemSync(playerId, ordinaryItemId, 10)
  const ordinaryBatchResult = givePlayerRewardsSync(playerId, [
    { type: 0, id: ordinaryItemId, count: 2 },
    { type: 0, id: ordinaryItemId, count: 3 },
  ])
  assert.ok(ordinaryBatchResult)
  assert.equal(getPlayerItemSync(playerId, ordinaryItemId), 15)
  assert.equal(ordinaryBatchResult.items[String(ordinaryItemId)], 15)

  const batchResult = givePlayerRewardsSync(playerId, [
    { type: 0, id: fireRarity5StoneId, count: 2 },
    { type: 0, id: fireRarity5StoneId, count: 3 },
    { type: 2, id: fireRarity5CharacterId },
    { type: 2, id: fireRarity5CharacterId },
  ])
  assert.ok(batchResult)
  assert.equal(getPlayerItemSync(playerId, fireRarity5StoneId), 75)
  assert.equal(batchResult.items[String(fireRarity5StoneId)], 75)

  console.log("item inventory consistency tests passed")
} finally {
  cleanup()
  process.removeListener("exit", cleanup)
}
