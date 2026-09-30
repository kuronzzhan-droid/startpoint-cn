import assert from "node:assert/strict"
import { after, test } from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { loadTeamCodeAssets } from "../lib/wiki-team-code-inventory"
import { wikiPublicId } from "../lib/wiki-team-code-client"

// Import the database only after choosing a fresh temporary location. No live save is opened.
const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-wiki-team-code-"))
process.env.WF_DATABASE_DIR = databaseDir
process.env.COMMUNITY_TEAM_CODES_URL = "http://127.0.0.1:8878/api/community/game-codes"
const accounts = require("../data/domains/account") as typeof import("../data/domains/account")
const players = require("../data/domains/player") as typeof import("../data/domains/player")
const characters = require("../data/domains/character") as typeof import("../data/domains/character")
const equipment = require("../data/domains/equipment") as typeof import("../data/domains/equipment")
const items = require("../data/domains/item") as typeof import("../data/domains/item")
const sessions = require("../data/domains/session") as typeof import("../data/domains/session")
const { getDb } = require("../data/db") as typeof import("../data/db")
const { SessionType } = require("../data/types") as typeof import("../data/types")
const partyRoutes = require("../routes/api/party") as typeof import("../routes/api/party")
const assets = loadTeamCodeAssets()
const chars = [...assets.characters.values()].filter(id => id >= 100000).slice(0, 4)
const weapon = 5010004, soul = assets.souls.get(weapon)!
assert.ok(soul)
let fetchCount = 0
const remoteReplies = new Map<string, () => Response>()
const originalFetch = globalThis.fetch
globalThis.fetch = (async (url: string) => {
    fetchCount++
    const answer = remoteReplies.get(url.split("/").at(-1)!)
    return answer ? answer() : new Response("{}", {status: 404})
}) as typeof fetch
const app = Fastify()
app.addHook("onSend", (_request, reply, payload, done) => {
    done(null, reply.getHeader("content-type") === "application/x-msgpack" ? JSON.stringify(payload) : payload)
})
app.register(partyRoutes.default, {prefix: "/party"})
after(async () => {
    await app.close()
    globalThis.fetch = originalFetch
    getDb().close()
    assert.equal(path.dirname(databaseDir), path.resolve(tmpdir()))
    rmSync(databaseDir, {recursive: true, force: true})
})

let identity = 0
async function createPlayer(stack = 0) {
    identity++
    const account = accounts.insertAccountSync({appId: `wiki-code-${identity}`, idpAlias: "test", idpCode: "test",
        idpId: `wiki-code-${identity}`, status: "active"})
    const playerId = players.insertDefaultPlayerSync(account.id).id, viewerId = 781000000 + identity
    await sessions.insertSessionWithToken({token: String(viewerId), accountId: account.id, expires: new Date(), type: SessionType.VIEWER})
    for (const id of chars.slice(0, 2)) {
        characters.insertDefaultPlayerCharacterSync(playerId, id)
        characters.updatePlayerCharacterSync(playerId, id, {exp: 1234, evolutionLevel: 1, overLimitStep: 2,
            illustrationSettings: [1], exBoost: {statusId: 9, abilityIdList: [10, 11]}})
        characters.insertPlayerCharacterManaNodesSync(playerId, id, [1, 2])
    }
    equipment.insertPlayerEquipmentSync(playerId, weapon, {level: 3, stack, enhancementLevel: 0, protection: false})
    items.setPlayerItemSync(playerId, soul, 2)
    return {playerId, viewerId, accountId: account.id}
}
function snapshot(playerId: number) {
    return {characters: characters.getPlayerCharactersSync(playerId), equipment: equipment.getPlayerEquipmentListSync(playerId),
        items: items.getPlayerItemsSync(playerId), partySlot: players.getPlayerSync(playerId)!.partySlot,
        groups: getDb().prepare("SELECT * FROM players_party_groups WHERE player_id = ?").all(playerId),
        parties: getDb().prepare("SELECT * FROM players_parties WHERE player_id = ?").all(playerId)}
}
function call(viewerId: number, action = "refer", extra: Record<string, unknown> = {}, ip = "127.0.0.1") {
    return app.inject({method: "POST", url: `/party/${action}`, remoteAddress: ip, payload: {viewer_id: viewerId, api_count: 1, ...extra}})
}
function remote(code: string, transform?: (payload: any) => void) {
    const payload = {title: "测试管理员盘", active: true, team: {main: chars.slice(0, 3).map(id => wikiPublicId("c", id)),
        unison: [wikiPublicId("c", chars[3]), "", ""], weapon: Array(3).fill(wikiPublicId("w", weapon)), soul: Array(3).fill(wikiPublicId("w", weapon))}}
    transform?.(payload)
    remoteReplies.set(code, () => new Response(JSON.stringify(payload), {headers: {"content-type": "application/json"}}))
}
function editParty(partyId: number, leader: number | null = chars[0]) {
    return {party_edited: true, party_category: 1, party_name: "队长保护测试", party_id: partyId,
        character_ids: [leader, chars[1], null], unison_character_ids: [null, null, null],
        equipment_ids: [weapon, null, null], ability_soul_ids: [soul, null, null],
        options: {allow_other_players_to_heal_me: true}}
}

test("refer returns native fields from the viewer's actual inventory and never writes a save", async () => {
    const {playerId, viewerId} = await createPlayer(), before = snapshot(playerId)
    const code = "23456789ABCD"; remote(code)
    const response = await call(viewerId, "refer", {party_code: code}), data = response.json()
    assert.equal(response.statusCode, 200)
    assert.equal(data.data_headers.result_code, 1)
    assert.equal(data.data.party_name, "测试管理员盘")
    assert.deepEqual(data.data.battle_party.characters[0], {id: chars[0], evolution_level: 1, exp: 1234, over_limit_step: 2,
        mana_node_ids: [1, 2], illustration_settings: [1], ex_boost: {status_id: 9, ability_id_list: [10, 11]}})
    assert.equal(data.data.battle_party.characters[2], null)
    assert.deepEqual(data.data.battle_party.unison_characters, [null, null, null])
    assert.deepEqual(data.data.battle_party.equipments, [{equipment_id: weapon, level: 3}, null, null])
    assert.deepEqual(data.data.battle_party.ability_soul_ids, [soul, soul, null])
    assert.deepEqual(snapshot(playerId), before)
})
test("refer rejects an unowned leader without moving another member or changing the save", async () => {
    const {playerId, viewerId} = await createPlayer(), before = snapshot(playerId)
    const code = "23456789ABCJ"
    remote(code, value => {value.team.main = [chars[2], chars[0], chars[1]].map(id => wikiPublicId("c", id))})
    const response = await call(viewerId, "refer", {party_code: code}), data = response.json()
    assert.equal(response.statusCode, 200)
    assert.equal(data.data_headers.result_code, 3403)
    assert.deepEqual(data.data, {})
    assert.deepEqual(snapshot(playerId), before)
})
test("malformed or unauthenticated reads and ordinary publishing cannot contact the public service", async () => {
    const {playerId, viewerId} = await createPlayer(), before = snapshot(playerId), count = fetchCount
    assert.equal((await call(0)).statusCode, 400)
    assert.equal((await call(987654321)).statusCode, 400)
    assert.equal((await call(viewerId, "refer", {party_code: "../../secret"})).json().data_headers.result_code, 3404)
    const published = (await call(viewerId, "publish", {party_name: "不允许创建", party: {}})).json()
    assert.equal(published.data_headers.result_code, 3403)
    assert.deepEqual(published.data, {})
    assert.equal(fetchCount, count)
    assert.deepEqual(snapshot(playerId), before)
})
test("missing, incompatible and upstream failures produce only native error codes", async () => {
    const {viewerId} = await createPlayer()
    assert.equal((await call(viewerId, "refer", {party_code: "23456789ABCE"})).json().data_headers.result_code, 3404)
    remote("23456789ABCF", value => {value.team.main[0] = "c000000000000"})
    assert.equal((await call(viewerId, "refer", {party_code: "23456789ABCF"})).json().data_headers.result_code, 3403)
    remoteReplies.set("23456789ABCG", () => {throw new Error("private transport exception")})
    const response = await call(viewerId, "refer", {party_code: "23456789ABCG"})
    assert.equal(response.json().data_headers.result_code, 3403)
    assert.ok(!response.body.includes("private transport"))
})
test("player quota spans sessions and IP changes; IP quota also limits invalid sessions", async () => {
    const {viewerId, accountId} = await createPlayer()
    for (let i = 0; i < 12; i++) await call(viewerId, "refer", {party_code: "invalid"}, `127.0.0.${i + 2}`)
    const secondViewer = viewerId + 10000
    await sessions.insertSessionWithToken({token: String(secondViewer), accountId, expires: new Date(), type: SessionType.VIEWER})
    const blocked = await call(secondViewer, "refer", {party_code: "23456789ABCD"}, "127.0.0.50")
    assert.equal(blocked.headers["retry-after"], "60")
    assert.equal(blocked.json().data_headers.result_code, 3404)
    for (let i = 0; i < 60; i++) assert.equal((await call(990000000 + i, "refer", {}, "127.0.0.90")).statusCode, 400)
    const limitedIp = await call(viewerId, "refer", {}, "127.0.0.90")
    assert.equal(limitedIp.headers["retry-after"], "60")
})
test("edit validates final ownership, duplicate quantities and souls separately for each saved party", async () => {
    const {playerId, viewerId} = await createPlayer(1), before = snapshot(playerId)
    const party = {party_edited: true, party_category: 1, party_name: "保存测试", party_id: 1,
        character_ids: [chars[0], chars[0], chars[2]], unison_character_ids: [chars[1], null, null],
        equipment_ids: [weapon, weapon, weapon], ability_soul_ids: [soul, soul, soul], options: {allow_other_players_to_heal_me: true}}
    const response = await call(viewerId, "edit", {main_party_id: 1, party_info_list: [party, {...party, party_id: 2}]})
    assert.equal(response.statusCode, 200, response.body)
    const saved = getDb().prepare("SELECT * FROM players_parties WHERE player_id = ? AND group_id = 1 AND category = 1 AND slot IN (1, 2) ORDER BY slot").all(playerId) as any[]
    assert.equal(saved.length, 2)
    for (const row of saved) {
        assert.deepEqual([row.character_id_1, row.character_id_2, row.character_id_3], [chars[0], null, null])
        assert.deepEqual([row.unison_character_1, row.unison_character_2, row.unison_character_3], [chars[1], null, null])
        assert.deepEqual([row.equipment_1, row.equipment_2, row.equipment_3], [weapon, weapon, null])
        assert.deepEqual([row.ability_soul_1, row.ability_soul_2, row.ability_soul_3], [soul, soul, null])
    }
    const after = snapshot(playerId)
    assert.deepEqual(after.characters, before.characters); assert.deepEqual(after.equipment, before.equipment); assert.deepEqual(after.items, before.items)
    const untouched = (rows: unknown[]) => rows.filter((row: any) => row.group_id !== 1 || row.category !== 1 || ![1, 2].includes(row.slot))
    assert.deepEqual(untouched(after.parties), untouched(before.parties))
})
for (const leader of [null, 0, -1, chars[2], 99999999]) {
    test(`edit rejects leader ${leader} before changing any party or selected slot`, async () => {
        const {playerId, viewerId} = await createPlayer(), before = snapshot(playerId)
        const response = await call(viewerId, "edit", {main_party_id: 2,
            party_info_list: [editParty(1), editParty(2, leader)]})
        assert.equal(response.statusCode, 400)
        assert.deepEqual(snapshot(playerId), before)
    })
}
for (const leader of [null, chars[2], 99999999]) {
    test(`selecting an existing party with invalid leader ${leader} leaves the save unchanged`, async () => {
        const {playerId, viewerId} = await createPlayer()
        getDb().prepare("UPDATE players_parties SET character_id_1 = ? WHERE player_id = ? AND category = 1 AND group_id = 1 AND slot = 2")
            .run(leader, playerId)
        const before = snapshot(playerId)
        const response = await call(viewerId, "edit", {main_party_id: 2, party_info_list: []})
        assert.equal(response.statusCode, 400)
        assert.deepEqual(snapshot(playerId), before)
    })
}
test("selecting a missing normal party cannot be satisfied by an event party edit", async () => {
    const {playerId, viewerId} = await createPlayer()
    getDb().prepare("DELETE FROM players_parties WHERE player_id = ? AND category = 1 AND group_id = 1 AND slot = 2").run(playerId)
    const before = snapshot(playerId)
    const response = await call(viewerId, "edit", {main_party_id: 2,
        party_info_list: [{...editParty(2), party_category: 3}]})
    assert.equal(response.statusCode, 400)
    assert.deepEqual(snapshot(playerId), before)
})
test("clearing nonleaders, equipment and souls keeps the leader and permits selection-only edits", async () => {
    const {playerId, viewerId} = await createPlayer()
    const filled = {...editParty(2), unison_character_ids: [1, null, null]}
    assert.equal((await call(viewerId, "edit", {main_party_id: 2, party_info_list: [filled]})).statusCode, 200)
    const cleared = {...editParty(2), character_ids: [chars[0], null, null], equipment_ids: [null, null, null],
        ability_soul_ids: [null, null, null]}
    assert.equal((await call(viewerId, "edit", {main_party_id: 2, party_info_list: [cleared]})).statusCode, 200)
    const row = getDb().prepare("SELECT * FROM players_parties WHERE player_id = ? AND category = 1 AND group_id = 1 AND slot = 2").get(playerId) as any
    assert.deepEqual([row.character_id_1, row.character_id_2, row.character_id_3], [chars[0], null, null])
    assert.deepEqual([row.unison_character_1, row.unison_character_2, row.unison_character_3], [null, null, null])
    assert.deepEqual([row.equipment_1, row.equipment_2, row.equipment_3, row.ability_soul_1, row.ability_soul_2, row.ability_soul_3], Array(6).fill(null))
    const before = snapshot(playerId)
    assert.equal((await call(viewerId, "edit", {main_party_id: 1, party_info_list: []})).statusCode, 200)
    assert.deepEqual(snapshot(playerId), {...before, partySlot: 1})
})
test("selection uses the validated replacement from this batch instead of the previous broken row", async () => {
    const {playerId, viewerId} = await createPlayer()
    getDb().prepare("UPDATE players_parties SET character_id_1 = NULL WHERE player_id = ? AND category = 1 AND group_id = 1 AND slot = 2").run(playerId)
    const response = await call(viewerId, "edit", {main_party_id: 2, party_info_list: [editParty(2)]})
    assert.equal(response.statusCode, 200)
    assert.equal(players.getPlayerSync(playerId)!.partySlot, 2)
    const row = getDb().prepare("SELECT character_id_1 AS leader FROM players_parties WHERE player_id = ? AND category = 1 AND group_id = 1 AND slot = 2").get(playerId) as any
    assert.equal(row.leader, chars[0])
})
test("a database failure rolls back earlier party writes and the selected slot", async () => {
    const {playerId, viewerId} = await createPlayer(), before = snapshot(playerId)
    getDb().exec(`CREATE TEMP TRIGGER reject_second_party BEFORE UPDATE ON players_parties
        WHEN NEW.player_id = ${playerId} AND NEW.category = 1 AND NEW.group_id = 1 AND NEW.slot = 2
        BEGIN SELECT RAISE(ABORT, 'isolated test failure'); END`)
    try {
        const response = await call(viewerId, "edit", {main_party_id: 2, party_info_list: [editParty(1), editParty(2)]})
        assert.equal(response.statusCode, 500)
        assert.deepEqual(snapshot(playerId), before)
    } finally {
        getDb().exec("DROP TRIGGER reject_second_party")
    }
})
