const assert = require("node:assert/strict")
const path = require("node:path")
const Database = require("better-sqlite3")
const Fastify = require("fastify")
const { pack, unpack } = require("msgpackr")

require("ts-node/register/transpile-only")

const projectRoot = path.resolve(__dirname, "..")
const fromProject = relativePath => path.resolve(
    projectRoot,
    relativePath.replace(/^\.\.\//, ""),
)

function stubModule(relativePath, exports) {
    const modulePath = require.resolve(fromProject(relativePath))
    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports,
    }
}

const db = new Database(":memory:")
db.exec(`
CREATE TABLE player_state (
    player_id INTEGER PRIMARY KEY,
    free_mana INTEGER NOT NULL,
    paid_mana INTEGER NOT NULL
);
CREATE TABLE node_state (
    player_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    node_id INTEGER NOT NULL,
    awake_level INTEGER NOT NULL,
    PRIMARY KEY (player_id, character_id, node_id)
);
CREATE TABLE item_state (
    player_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    PRIMARY KEY (player_id, item_id)
);
CREATE TABLE counter_state (
    player_id INTEGER PRIMARY KEY,
    used_mana INTEGER NOT NULL
);
INSERT INTO player_state VALUES (17, 1000, 0);
INSERT INTO node_state VALUES (17, 101, 1001, 0);
INSERT INTO node_state VALUES (17, 101, 1002, 0);
INSERT INTO item_state VALUES (17, 5001, 20);
INSERT INTO counter_state VALUES (17, 0);
`)

const playerCharacter = {
    id: 101,
    entryCount: 1,
    evolutionLevel: 0,
    overLimitStep: 0,
    protection: false,
    joinTime: new Date(0),
    updateTime: new Date(0),
    exp: 0,
    stack: 0,
    manaBoardIndex: 1,
    bondTokenList: [],
}
let failNodeId = null

function getPlayer() {
    const row = db.prepare("SELECT * FROM player_state WHERE player_id = 17").get()
    return {
        id: 17,
        freeMana: row.free_mana,
        paidMana: row.paid_mana,
    }
}

stubModule("../src/data/db", { getDb: () => db })
stubModule("../src/data/domains/session", { getSession: async () => ({ accountId: 1 }) })
stubModule("../src/data/activeAccount", { resolvePlayerIdSync: () => 17 })
stubModule("../src/data/domains/player", {
    getPlayerSync: getPlayer,
    updatePlayerSync(data) {
        db.prepare("UPDATE player_state SET free_mana = ?, paid_mana = ? WHERE player_id = ?")
            .run(data.freeMana, data.paidMana, data.id)
    },
})
stubModule("../src/data/domains/item", {
    getPlayerItemSync(_playerId, itemId) {
        return db.prepare("SELECT amount FROM item_state WHERE player_id = 17 AND item_id = ?")
            .get(Number(itemId))?.amount ?? null
    },
    updatePlayerItemSync(_playerId, itemId, amount) {
        db.prepare("UPDATE item_state SET amount = ? WHERE player_id = 17 AND item_id = ?")
            .run(amount, Number(itemId))
    },
})
stubModule("../src/data/domains/character", {
    getPlayerCharacterSync: () => playerCharacter,
    getPlayerCharacterManaNodesSync: () => [1001, 1002],
    getPlayerCharactersManaNodesSync: () => ({ "101": [1001, 1002] }),
    hasPlayerUnlockedCharacterManaNodeSync(_playerId, _characterId, nodeId) {
        return Boolean(db.prepare("SELECT 1 FROM node_state WHERE node_id = ?").get(nodeId))
    },
    insertPlayerCharacterManaNodesSync() {},
    getPlayerCharactersManaNodeAwakeLevelsSync() {
        const levels = {}
        for (const row of db.prepare("SELECT node_id, awake_level FROM node_state").all()) {
            levels[row.node_id] = row.awake_level
        }
        return { "101": levels }
    },
    updatePlayerCharacterManaNodeAwakeLevelSync(_playerId, _characterId, nodeId, level) {
        if (nodeId === failNodeId) throw new Error("injected node update failure")
        db.prepare("UPDATE node_state SET awake_level = ? WHERE node_id = ?").run(level, nodeId)
    },
    updatePlayerCharacterBondTokenSync() {},
    updatePlayerCharacterSync() {},
})
stubModule("../src/data/domains/character_awake", {
    getPlayerCharacterAwakeUnlocksSync: () => new Map([["101", { 1: 1 }]]),
})
stubModule("../src/data/domains/active_mission_counters", {
    incrementActiveMissionUsedManaCountSync(_playerId, amount) {
        db.prepare("UPDATE counter_state SET used_mana = used_mana + ? WHERE player_id = 17").run(amount)
    },
})
stubModule("../src/lib/assets", {
    getCharacterDataSync: () => ({ rarity: 5 }),
    getCharacterManaNodesSync: () => ({ 1001: {}, 1002: {} }),
    getManaNodeAwakeCost: () => ({ manaAmount: 10, items: { 5001: 2 } }),
})
stubModule("../src/data/utils", { clientSerializeDate: value => value.toISOString() })
stubModule("../src/utils", {
    generateDataHeaders: ({ viewer_id }) => ({ viewer_id, result_code: 1 }),
})
stubModule("../src/lib/mission/degree-response", {
    settleDegreeMissionResponse: () => ({
        missionInfo: [],
        itemList: {},
        characterList: [],
        equipmentList: [],
        degreeIds: [],
        passCardPoints: {},
    }),
})

const routes = require(fromProject("../src/routes/api/character/mana")).default

function snapshot() {
    return {
        player: db.prepare("SELECT * FROM player_state").get(),
        nodes: db.prepare("SELECT * FROM node_state ORDER BY node_id").all(),
        item: db.prepare("SELECT * FROM item_state").get(),
        counter: db.prepare("SELECT * FROM counter_state").get(),
    }
}

async function awake(app, nodeIds, level = 1) {
    return app.inject({
        method: "POST",
        url: "/awake_mana_node",
        payload: {
            viewer_id: 800000017,
            character_id: 101,
            api_count: 1,
            mana_node_multiplied_id_list: nodeIds,
            awake_level: level,
        },
    })
}

async function main() {
    const app = Fastify()
    app.addHook("onSend", (_request, reply, payload, done) => {
        if (reply.getHeader("content-type") === "application/x-msgpack") {
            done(null, pack(payload).toString("base64"))
            return
        }
        done(null, payload)
    })
    await app.register(routes)
    await app.ready()

    const beforeInvalid = snapshot()
    assert.equal((await awake(app, [1001, 1001])).statusCode, 400)
    assert.equal((await awake(app, [9999])).statusCode, 400)
    assert.equal((await awake(app, [1001], 2)).statusCode, 400)
    assert.deepEqual(snapshot(), beforeInvalid)

    const success = await awake(app, [1001])
    assert.equal(success.statusCode, 200, success.body)
    const successData = unpack(Buffer.from(success.body, "base64")).data
    assert.equal(successData.user_info.free_mana, 990)
    assert.equal(db.prepare("SELECT awake_level FROM node_state WHERE node_id = 1001").get().awake_level, 1)
    assert.equal(db.prepare("SELECT amount FROM item_state WHERE item_id = 5001").get().amount, 18)
    assert.equal(db.prepare("SELECT used_mana FROM counter_state").get().used_mana, 10)

    const beforeFailure = snapshot()
    failNodeId = 1002
    const failed = await awake(app, [1002])
    failNodeId = null
    assert.equal(failed.statusCode, 500)
    assert.deepEqual(snapshot(), beforeFailure)

    await app.close()
    db.close()
}

main().then(
    () => console.log("mana node awake route tests passed"),
    error => {
        console.error(error)
        process.exitCode = 1
    },
)
