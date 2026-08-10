const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const root = path.resolve(__dirname, "..")

function source(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8")
}

test("continue route accepts legacy method and play-id spellings", () => {
    const text = source("src/routes/api/singleBattleQuest.ts")
    const start = text.indexOf('url: "/play_continue"')
    assert.notEqual(start, -1)
    const block = text.slice(Math.max(0, start - 100), start + 4_500)

    assert.match(block, /method:\s*\["GET",\s*"POST"\]/)
    assert.match(block, /raw\.play_id\s*\?\?\s*raw\.paly_id/)
    assert.match(block, /paidVmoneyCost\s*=\s*continueVmoneyCost\s*-\s*freeVmoneyCost/)
})

test("bulk buy tolerates flattened GET input and skips unavailable entries", () => {
    const text = source("src/routes/api/shop.ts")
    const start = text.indexOf('url: "/bulk_buy"')
    assert.notEqual(start, -1)
    const block = text.slice(Math.max(0, start - 200), start + 16_000)

    assert.match(block, /method:\s*\["GET",\s*"POST"\]/)
    assert.ok(block.includes("/^buy_item_list\\[(\\d+)\\]$/"))
    assert.match(block, /purchaseAmount\s*=\s*Math\.min\(purchaseAmount/)
    assert.match(block, /skippedEntries\+\+/)
    assert.match(block, /getDb\(\)\.transaction/)
})

test("mode15 recovery keeps safe markers but unlocks only multiplayer boundary parties", () => {
    const schema = source("src/data/schema.ts")
    const battle = source("src/multi/http/battle.ts")
    const mode15 = source("src/lib/mode15.ts")
    const optional = source("src/lib/mode15-optional.ts")
    const rush = source("src/lib/rush.ts")
    const load = source("src/routes/cn/load.ts")
    const playerSerializer = source("src/data/utils/serialize-player.ts")

    assert.match(schema, /is_multi_host/)
    assert.match(battle, /isMultiHost:\s*room\.host_player_id\s*===\s*ctx\.playerId/)
    assert.match(battle, /playedParty:/)
    assert.doesNotMatch(mode15, /\/\/ boundary marker[\s\S]{0,500}unison_character_id:\s*null/)
    assert.match(rush, /getMode15LegacyPartyFallbackSync/)
    assert.match(rush, /!party\.characterIds\.some\(id => id !== null\)/)
    assert.match(optional, /stage === 5 \|\| stage === 10 \|\| stage === 15/)
    assert.match(optional, /eventId !== MODE15_RUSH_EVENT_ID/)
    assert.doesNotMatch(
        optional,
        /shouldUnlockMode15MultiplayerPlayedParty[\s\S]{0,500}shouldUnlockMode15PlayedParties/,
    )
    assert.match(rush, /shouldUnlockMode15PlayedParties\(eventId\)/)
    assert.match(rush, /shouldUnlockMode15MultiplayerPlayedParty\(eventId, party\.round\)/)
    assert.match(rush, /clearSerializedPlayedPartyMembers\(serializedParty\)/)
    assert.match(playerSerializer, /shouldUnlockMode15PlayedParties\(numericEventId\)/)
    assert.match(playerSerializer, /shouldUnlockMode15MultiplayerPlayedParty\(numericEventId, party\.round\)/)
    assert.match(playerSerializer, /clearSerializedPlayedPartyMembers\(serializedParty\)/)
    assert.match(load, /shouldResetMode15RunForStaleActiveQuest/)
})
