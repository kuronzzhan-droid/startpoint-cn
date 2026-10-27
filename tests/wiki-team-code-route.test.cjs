const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test, after } = require("node:test")

const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-team-route-"))
process.env.DATA_DIR = databaseDir
process.env.COMMUNITY_TEAM_CODES_URL = "https://wiki.example/api/community/game-codes"
require("ts-node/register/transpile-only")

const Fastify = require("fastify")
const { SessionType } = require("../src/data/types")
const { insertAccountSync } = require("../src/data/domains/account")
const { insertDefaultPlayerSync } = require("../src/data/domains/player")
const { publishPartySync } = require("../src/data/domains/publishedParty")
const { insertSessionWithTokenSync } = require("../src/data/domains/session")
const { getDb } = require("../src/data/db")
const { wikiPublicId } = require("../src/lib/wiki-team-code-client")
const { loadTeamCodeAssets, resolvePublicTeam } = require("../src/lib/wiki-team-code-inventory")

const viewerId = 710000001
const code = "23456789ABCD"
const missingLeaderCode = "23456789ABCE"
const knownCharacters = [...loadTeamCodeAssets().characters.values()]
    .filter(id => id !== 1)
    .slice(0, 2)
const originalFetch = global.fetch
global.fetch = async url => {
    assert.ok([
        `https://wiki.example/api/community/game-codes/${code}`,
        `https://wiki.example/api/community/game-codes/${missingLeaderCode}`,
    ].includes(url))
    const missingLeader = url.endsWith(missingLeaderCode)
    return new Response(JSON.stringify({
        title: missingLeader ? "缺少队长的 Wiki 阵容" : "Wiki 阵容",
        active: true,
        team: {
            main: (missingLeader ? [knownCharacters[0], 1, knownCharacters[1]] : [1, ...knownCharacters])
                .map(id => wikiPublicId("c", id)),
            unison: ["", "", ""],
            weapon: ["", "", ""],
            soul: ["", "", ""],
        },
    }), { headers: { "content-type": "application/json" } })
}
const partyRoutes = require("../src/routes/api/party").default

const account = insertAccountSync({
    appId: "wiki-route-test",
    idpAlias: "test",
    idpCode: "test",
    idpId: "wiki-route-test",
    status: "active",
})
const player = insertDefaultPlayerSync(account.id)
insertSessionWithTokenSync({
    token: String(viewerId),
    accountId: account.id,
    expires: new Date(),
    type: SessionType.VIEWER,
})

const app = Fastify()
app.addHook("onSend", (_request, reply, payload, done) => {
    done(null, reply.getHeader("content-type") === "application/x-msgpack"
        ? JSON.stringify(payload)
        : payload)
})
app.register(partyRoutes, { prefix: "/party" })

after(async () => {
    await app.close()
    global.fetch = originalFetch
    getDb().close()
    fs.rmSync(databaseDir, { recursive: true, force: true })
})

test("existing /party/refer accepts a Wiki code without writing player data", async () => {
    await app.ready()
    const response = await app.inject({
        method: "POST",
        url: "/party/refer",
        payload: { viewer_id: viewerId, party_code: code },
    })
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.equal(body.data_headers.result_code, 1)
    assert.equal(body.data.party_name, "Wiki 阵容")
    assert.equal(body.data.battle_party.characters[0].id, 1)
    assert.equal(body.data.battle_party.characters[1], null)
    assert.equal(body.data.battle_party.characters[2], null)
})

test("existing local 10-character party codes still use the local store", async () => {
    const localCode = publishPartySync(player.id, "本地阵容", {
        characters: [{
            id: 1,
            mana_node_ids: [],
            evolution_level: 1,
            exp: 0,
            over_limit_step: 0,
            illustration_settings: null,
            ex_boost: null,
        }, null, null],
        unison_characters: [null, null, null],
        equipments: [null, null, null],
        ability_soul_ids: [null, null, null],
    })
    const response = await app.inject({
        method: "POST",
        url: "/party/refer",
        payload: { viewer_id: viewerId, party_code: localCode },
    })
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.equal(body.data_headers.result_code, 1)
    assert.equal(body.data.party_name, "本地阵容")
})

test("local 10-character party codes with an empty leader are rejected", async () => {
    const localCode = publishPartySync(player.id, "空队长阵容", {
        characters: [null, null, null],
        unison_characters: [null, null, null],
        equipments: [null, null, null],
        ability_soul_ids: [null, null, null],
    })
    const response = await app.inject({
        method: "POST",
        url: "/party/refer",
        payload: { viewer_id: viewerId, party_code: localCode },
    })
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.equal(body.data_headers.result_code, 3403)
    assert.deepEqual(body.data, {})
})

test("publishing a local party with an empty leader is rejected", async () => {
    const response = await app.inject({
        method: "POST",
        url: "/party/publish",
        payload: {
            viewer_id: viewerId,
            party_name: "空队长阵容",
            battle_party: {
                characters: [null, null, null],
                unison_characters: [null, null, null],
                equipments: [null, null, null],
                ability_soul_ids: [null, null, null],
            },
        },
    })
    assert.equal(response.statusCode, 400, response.body)
})

test("Wiki code with an unowned leader is rejected before returning an empty leader", async () => {
    const response = await app.inject({
        method: "POST",
        url: "/party/refer",
        payload: { viewer_id: viewerId, party_code: missingLeaderCode },
    })
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.equal(body.data_headers.result_code, 3403)
    assert.deepEqual(body.data, {})
})


test("Wiki public route strips private souls and all sidecars from the projected native party", async () => {
    const inventory = require('../src/lib/wiki-team-code-inventory')
    const original = inventory.nativeBattleParty
    let native
    inventory.nativeBattleParty = (...args) => {
        native = { ...original(...args), ability_soul_ids: [16000000, 16000999, 16000900],
            weapon_rivens: [[0, [16000999, 100001, 15990001, 50]], [1], [1]],
            weapon_riven_scope: 'multi-v1', weapon_riven_snapshot_id: 'private',
            weapon_riven_mode: 1, weapon_riven_catalog: 'catalog', weapon_riven_reason: '',
            user_weapon_riven_list: { pending: { private: true } } }
        return native
    }
    try {
        const response = await app.inject({ method: 'POST', url: '/party/refer',
            payload: { viewer_id: viewerId, party_code: code } })
        assert.equal(response.statusCode, 200, response.body)
        const result = response.json()
        assert.equal(result.data_headers.result_code, 1)
        assert.deepEqual(result.data.battle_party.ability_soul_ids, [null, null, 16000900])
        assert.equal(JSON.stringify(result.data).includes('weapon_riven'), false)
        assert.deepEqual(native.ability_soul_ids, [16000000, 16000999, 16000900])
        assert.equal(native.weapon_riven_snapshot_id, 'private')
    } finally { inventory.nativeBattleParty = original }
})
