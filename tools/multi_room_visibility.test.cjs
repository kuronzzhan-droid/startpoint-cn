const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

require("ts-node/register/transpile-only")

const useCompiledServer = process.env.MULTI_ROOM_COMPILED === "1"
const serverModuleRoot = useCompiledServer ? "../out" : "../src"
const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sp-multi-visibility-"))
process.env.DATA_DIR = dataDirectory

const { getDb } = require(`${serverModuleRoot}/data/db`)
const { insertAccountSync } = require(`${serverModuleRoot}/data/domains/account`)
const { insertDefaultPlayerSync, updatePlayerSync } = require(`${serverModuleRoot}/data/domains/player`)
const { addFollowSync } = require(`${serverModuleRoot}/data/domains/follow`)
const { serializeRoom } = require(`${serverModuleRoot}/multi/room/serializer`)
const {
    MUTUAL_FOLLOW_SHARE_TYPE,
    RANDOM_RECRUITMENT_SHARE_TYPE,
    encodeRoomShareOptions,
    isRoomSharedWithPlayer,
    normalizeRoomShareTypes,
} = require(`${serverModuleRoot}/multi/room/sharing`)

function createTestPlayer(idpId, name) {
    const account = insertAccountSync({
        appId: "wf_cn",
        idpAlias: "",
        idpCode: "leiting",
        idpId,
        status: "normal",
    })
    const player = insertDefaultPlayerSync(account.id)
    updatePlayerSync({ id: player.id, name })
    return player.id
}

try {
    const hostPlayerId = createTestPlayer("multi-visibility-host", "自定义房主名")
    const mutualPlayerId = createTestPlayer("multi-visibility-mutual", "互关玩家")
    const oneWayPlayerId = createTestPlayer("multi-visibility-one-way", "单向关注")
    const strangerPlayerId = createTestPlayer("multi-visibility-stranger", "陌生玩家")

    assert.equal(addFollowSync(hostPlayerId, mutualPlayerId), "added")
    assert.equal(addFollowSync(mutualPlayerId, hostPlayerId), "added")
    assert.equal(addFollowSync(oneWayPlayerId, hostPlayerId), "added")

    const room = {
        room_number: "mutual-test-room",
        access_token: "mutual-test-token",
        category: 1,
        quest_id: 1,
        host_viewer_id: 810000001,
        host_player_id: hostPlayerId,
        host_party_id: 1,
        host_main_character_id: 1,
        accepted_type: 0,
        created_at: Date.now(),
        raising_state: 2,
        room_sequence: 1,
        host_entry_time: 1,
        mates: [],
        share_room_options: 0,
        is_npc_mode: false,
        npc_count: 0,
        expected_real_viewer_ids: [],
        lobby_generation: 0,
        rematch_wait_started_at: null,
        settlement_return_pending: false,
    }
    const shareTypes = normalizeRoomShareTypes([
        MUTUAL_FOLLOW_SHARE_TYPE,
        MUTUAL_FOLLOW_SHARE_TYPE,
        99,
    ])
    room.share_room_options = encodeRoomShareOptions(shareTypes)

    assert.deepEqual(shareTypes, [MUTUAL_FOLLOW_SHARE_TYPE])
    assert.equal(isRoomSharedWithPlayer(room, mutualPlayerId, false), true)
    assert.equal(isRoomSharedWithPlayer(room, oneWayPlayerId, false), false)
    assert.equal(isRoomSharedWithPlayer(room, strangerPlayerId, false), false)
    assert.equal(isRoomSharedWithPlayer(room, strangerPlayerId, true), true)

    room.share_room_options = encodeRoomShareOptions([RANDOM_RECRUITMENT_SHARE_TYPE])
    assert.equal(isRoomSharedWithPlayer(room, mutualPlayerId, false), false)

    const serialized = serializeRoom(room, mutualPlayerId)
    assert.equal(serialized.establisher_name, "自定义房主名")
    assert.equal(serialized.establisher_follow, 1)
    assert.equal(serialized.establisher_character, 1)

    const lobbySource = fs.readFileSync(
        path.join(__dirname, "../src/multi/http/lobby.ts"),
        "utf8",
    )
    const roomSource = fs.readFileSync(
        path.join(__dirname, "../src/multi/http/room.ts"),
        "utf8",
    )
    assert.match(lobbySource, /isRoomSharedWithPlayer/)
    assert.match(lobbySource, /serializeRoom\(r, viewerPlayerId\)/)
    assert.match(roomSource, /room\.share_room_options = encodeRoomShareOptions/)

    console.log("multi room visibility tests passed")
} finally {
    getDb().close()
    fs.rmSync(dataDirectory, { recursive: true, force: true })
}
