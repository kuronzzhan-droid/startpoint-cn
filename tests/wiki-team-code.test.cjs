const assert = require("node:assert/strict")
const { test } = require("node:test")

require("ts-node/register/transpile-only")

const {
    createTeamCodeClient,
    GAME_CODE_PATTERN,
    parseTeamCodePayload,
    TeamCodeError,
    TeamCodeLimiter,
    teamCodeBaseUrl,
    wikiPublicId,
} = require("../src/lib/wiki-team-code-client")
const {
    nativeBattleParty,
    loadTeamCodeAssets,
    ownedTeam,
    resolvePublicTeam,
} = require("../src/lib/wiki-team-code-inventory")

const code = "23456789ABCD"
const base = "https://wiki.example/api/community/game-codes"

function payload() {
    return {
        title: "管理员阵容",
        active: true,
        team: {
            main: [1, 2, 3].map(id => wikiPublicId("c", id)),
            unison: ["", "", ""],
            weapon: [wikiPublicId("w", 5001), "", ""],
            soul: [wikiPublicId("w", 5001), "", ""],
        },
    }
}

function reply(value, status = 200) {
    return new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
    })
}

test("Wiki code contract validates opaque IDs and endpoint policy", () => {
    assert.equal(wikiPublicId("c", "111135"), "c9f2416c55187")
    assert.ok(GAME_CODE_PATTERN.test(code))
    assert.equal(teamCodeBaseUrl(`${base}/`).href, base)
    assert.deepEqual(parseTeamCodePayload(payload()), payload())
    for (const bad of [
        "000000000000",
        "ABCD-EFGH-JK",
        "short",
        "a23456789ABC",
    ]) assert.equal(GAME_CODE_PATTERN.test(bad), false)
    assert.throws(() => teamCodeBaseUrl("http://remote.example/api/community/game-codes"), TeamCodeError)
})

test("Wiki client caches successful responses and maps remote failures", async () => {
    let now = 0
    let calls = 0
    let active = true
    const lookup = createTeamCodeClient({
        url: () => base,
        now: () => now,
        fetcher: async url => {
            calls++
            assert.equal(url, `${base}/${code}`)
            return active ? reply(payload()) : reply({}, 404)
        },
    })

    await lookup(code)
    active = false
    now = 4_999
    await lookup(code)
    assert.equal(calls, 1)
    now = 5_001
    await assert.rejects(lookup(code), error => error.kind === "not-found")
    assert.equal(calls, 2)
})

test("inventory projection leaves missing resources empty without mutation", () => {
    const character = id => ({
        entryCount: 1,
        evolutionLevel: 2,
        overLimitStep: 3,
        protection: false,
        joinTime: new Date(0),
        updateTime: new Date(0),
        exp: id * 10,
        stack: 0,
        manaBoardIndex: 1,
        bondTokenList: [],
    })
    const assets = {
        characters: new Map([1, 2, 3, 4].map(id => [wikiPublicId("c", id), id])),
        equipment: new Map([5001, 5002].map(id => [wikiPublicId("w", id), id])),
        souls: new Map([[5001, 6001]]),
        maxLevels: { 5001: 5, 5002: 1 },
    }
    const inventory = {
        characters: { 1: character(1), 2: character(2) },
        equipment: { 5001: { level: 5, enhancementLevel: 0, protection: false, stack: 0 } },
        items: { 6001: 2 },
        nodes: id => [id * 100 + 1],
    }
    const before = JSON.stringify(inventory)
    const team = { main: [1, 2, 3], unison: [4, null, null], weapon: [5001, 5001, 5002], soul: [6001, 6001, 6001] }
    assert.deepEqual(ownedTeam(team, inventory, assets), {
        main: [1, 2, null],
        unison: [null, null, null],
        weapon: [5001, null, null],
        soul: [6001, 6001, null],
    })
    assert.equal(JSON.stringify(inventory), before)
    const publicTeam = {
        main: [1, 2, 3].map(id => wikiPublicId("c", id)),
        unison: ["", "", ""],
        weapon: [wikiPublicId("w", 5001), "", ""],
        soul: [wikiPublicId("w", 5001), "", ""],
    }
    const resolved = resolvePublicTeam(publicTeam, assets)
    const native = nativeBattleParty(resolved, inventory, assets)
    assert.deepEqual(native.equipments, [{ equipment_id: 5001, level: 5 }, null, null])
    assert.deepEqual(native.ability_soul_ids, [6001, null, null])
    assert.equal(native.characters[2], null)
})

test("native party conversion rejects a projected empty leader", () => {
    const assets = {
        characters: new Map([[wikiPublicId("c", 1), 1]]),
        equipment: new Map(),
        souls: new Map(),
        maxLevels: {},
    }
    const inventory = {
        characters: {},
        equipment: {},
        items: {},
        nodes: () => [],
    }
    assert.throws(
        () => nativeBattleParty(
            { main: [1, null, null], unison: [null, null, null], weapon: [null, null, null], soul: [null, null, null] },
            inventory,
            assets,
        ),
        error => error instanceof TeamCodeError && error.kind === "incompatible",
    )
})

test("server roster includes overlay characters", () => {
    const { characters } = loadTeamCodeAssets()
    for (const id of [169995, 179981, 129952]) {
        assert.equal(characters.get(wikiPublicId("c", id)), id)
    }
})

test("unknown non-leader IDs leave slots empty; an unknown leader is incompatible", () => {
    const assets = {
        characters: new Map([[wikiPublicId("c", 1), 1]]),
        equipment: new Map([[wikiPublicId("w", 5001), 5001]]),
        souls: new Map(),
        maxLevels: { 5001: 1 },
    }
    const unknownCharacter = wikiPublicId("c", 999001)
    const unknownWeapon = wikiPublicId("w", 999002)
    assert.deepEqual(resolvePublicTeam({
        main: [wikiPublicId("c", 1), unknownCharacter, ""],
        unison: [unknownCharacter.replace(/.$/, "0"), "", ""],
        weapon: [unknownWeapon, wikiPublicId("w", 5001), ""],
        soul: [wikiPublicId("w", 5001), unknownWeapon, ""],
    }, assets), {
        main: [1, null, null],
        unison: [null, null, null],
        weapon: [null, 5001, null],
        soul: [null, null, null],
    })
    assert.throws(
        () => resolvePublicTeam({
            main: [unknownCharacter, wikiPublicId("c", 1), ""],
            unison: ["", "", ""],
            weapon: ["", "", ""],
            soul: ["", "", ""],
        }, assets),
        error => error instanceof TeamCodeError && error.kind === "incompatible",
    )
})

test("per-identity limiter expires independently", () => {
    const limiter = new TeamCodeLimiter()
    assert.equal(limiter.take("player:1", 2, 0), true)
    assert.equal(limiter.take("player:1", 2, 1), true)
    assert.equal(limiter.take("player:1", 2, 2), false)
    assert.equal(limiter.take("player:2", 2, 2), true)
    assert.equal(limiter.take("player:1", 2, 60_001), true)
})
