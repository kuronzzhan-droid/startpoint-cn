const assert = require("node:assert/strict")

const {
  buildFinishResponseCacheKey,
  cacheFinishResponse,
  getCachedFinishResponse,
} = require("../out/lib/finish-response-cache.js")
const {
  clearMultiSettlementSnapshot,
  mergeMultiSettlementResults,
} = require("../out/multi/settlement.js")

async function main() {
  // The production barrier timer is unref'ed by design; keep this short-lived
  // test process alive while verifying its upper bound.
  const keepAlive = setInterval(() => {}, 10_000)
  try {
  const firstKey = buildFinishResponseCacheKey("single", 123, {
    category: 1,
    quest_id: 1001,
    api_count: 88,
  })
  const secondKey = buildFinishResponseCacheKey("single", 123, {
    category: 1,
    quest_id: 1001,
    api_count: 89,
  })
  assert.notEqual(firstKey, secondKey)
  assert.equal(buildFinishResponseCacheKey("single", 123, { category: 1, quest_id: 1001 }), null)
  const response = { ok: true }
  cacheFinishResponse(firstKey, response)
  assert.equal(getCachedFinishResponse(firstKey), response)

  const earlyKey = `early-${Date.now()}`
  const participants = [
    { viewerId: 101, comId: 1 },
    { viewerId: 102, comId: 2 },
  ]
  const common = {
    key: earlyKey,
    participants,
    expectedRealViewerIds: [101, 102],
    mateResults: [],
    waitMs: 5_000,
  }
  const earlyStarted = Date.now()
  const results = await Promise.all([
    mergeMultiSettlementResults({ ...common, viewerId: 101, ownScore: 10, ownContributionScore: 5 }),
    mergeMultiSettlementResults({ ...common, viewerId: 102, ownScore: 20, ownContributionScore: 6 }),
  ])
  const earlyElapsed = Date.now() - earlyStarted
  assert.ok(earlyElapsed < 500, `complete roster waited ${earlyElapsed}ms`)
  assert.equal(results[0].submittedCount, 2)
  assert.equal(results[1].submittedCount, 2)
  clearMultiSettlementSnapshot(earlyKey)

  const clampKey = `clamp-${Date.now()}`
  const clampStarted = Date.now()
  await mergeMultiSettlementResults({
    ...common,
    key: clampKey,
    viewerId: 101,
    ownScore: 10,
    ownContributionScore: 5,
  })
  const clampElapsed = Date.now() - clampStarted
  assert.ok(clampElapsed >= 1_050, `compatibility barrier ended too early: ${clampElapsed}ms`)
  assert.ok(clampElapsed < 1_800, `compatibility barrier exceeded 1.2s clamp: ${clampElapsed}ms`)
  clearMultiSettlementSnapshot(clampKey)

    console.log(`settlement performance regression passed (early=${earlyElapsed}ms, clamp=${clampElapsed}ms)`)
  } finally {
    clearInterval(keepAlive)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
