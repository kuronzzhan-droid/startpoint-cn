const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

require("ts-node/register/transpile-only")

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sp-rescue-avatar-"))
process.env.DATA_DIR = dataDirectory

const { getDb } = require("../src/data/db")
const { insertAccountSync } = require("../src/data/domains/account")
const { insertDefaultPlayerSync, updatePlayerSync } = require("../src/data/domains/player")
const { updatePlayerPartySync } = require("../src/data/domains/party")
const {
    getFavoritePartySelectionSync,
    PROFILE_FAVORITE_PARTY_CATEGORY,
} = require("../src/lib/profileFavorite")
const {
    publishRandomRecruitment,
    stopRandomRecruitment,
    takeRandomRecruitments,
    wasStoppedRandomRecruitmentDeliveredTo,
} = require("../src/multi/recruitment")

try {
    const account = insertAccountSync({
        appId: "wf_cn",
        idpAlias: "",
        idpCode: "leiting",
        idpId: "rescue-avatar-test",
        status: "normal",
    })
    const player = insertDefaultPlayerSync(account.id)
    updatePlayerSync({ id: player.id, leaderCharacterId: 1 })

    updatePlayerPartySync(player.id, 1, {
        name: "主页收藏",
        characterIds: [121033, null, null],
        unisonCharacterIds: [null, null, null],
        equipmentIds: [null, null, null],
        abilitySoulIds: [null, null, null],
        edited: true,
        options: { allowOtherPlayersToHealMe: true },
        category: PROFILE_FAVORITE_PARTY_CATEGORY,
        currentBattlePower: 0,
        beforeBattlePower: 0,
    }, 1)

    const favorite = getFavoritePartySelectionSync(player.id, 1)
    assert.equal(favorite.characterIds[0], 121033)

    const roomNumber = "rescue-avatar-room"
    publishRandomRecruitment(roomNumber)
    const delivered = takeRandomRecruitments(998877, 1, () => true)
    assert.equal(delivered.length, 1)
    stopRandomRecruitment(roomNumber)
    assert.equal(wasStoppedRandomRecruitmentDeliveredTo(roomNumber, 998877), true)
    publishRandomRecruitment(roomNumber)
    assert.equal(wasStoppedRandomRecruitmentDeliveredTo(roomNumber, 998877), false)

    const attentionSource = fs.readFileSync(
        path.join(__dirname, "../src/routes/api/attention.ts"),
        "utf8",
    )
    const lobbySource = fs.readFileSync(
        path.join(__dirname, "../src/multi/http/lobby.ts"),
        "utf8",
    )
    assert.match(attentionSource, /getFavoritePartySelectionSync/)
    assert.match(attentionSource, /favorite\.characterIds\[0\][\s\S]*room\.host_main_character_id/)
    assert.match(attentionSource, /"establisher_character": profileLeaderId/)
    assert.match(attentionSource, /getPlayerCharacterSync\([\s\S]*profileLeaderId/)
    assert.match(lobbySource, /profileMainCharacterId/)
    assert.match(lobbySource, /favorite\.characterIds\[0\]/)
    assert.match(lobbySource, /wasStoppedRandomRecruitmentDeliveredTo/)

    console.log("rescue avatar tests passed")
} finally {
    getDb().close()
    fs.rmSync(dataDirectory, { recursive: true, force: true })
}
