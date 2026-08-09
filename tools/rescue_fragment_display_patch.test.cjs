const assert = require("node:assert/strict")
const path = require("node:path")
const unzipper = require("unzipper")
const {
    readOrderedMapRawRowsFromBuffer,
    readTextRowsFromOrderedMapBuffer,
} = require("./gacha_odds_export.cjs")
const { hashResourcePath } = require("./orderedmap_serializer.cjs")

const root = path.resolve(__dirname, "..")
const patchPath = path.join(
    root,
    "assets",
    "asset-patch",
    "active",
    "pinball-1.4.58-1.4.59-1-independent-warmup-v10-cd-balance-nephteim-voice-rescue-fragment-display.zip",
)
const resource = hashResourcePath(
    "master/reward/event/additional_reward.orderedmap",
).relativePath
const entryPath = `production/upload/${resource}`

async function main() {
    const archive = await unzipper.Open.file(patchPath)
    const files = archive.files.filter(file => file.type !== "Directory")
    assert.equal(files.length, 17)

    const entry = files.find(
        file => file.path.replaceAll("\\", "/") === entryPath,
    )
    assert.ok(entry, `${entryPath} must be present`)

    const outer = readOrderedMapRawRowsFromBuffer(await entry.buffer())
    const expected = new Map([
        ["490000", "rescue_fragment_silver,0,49000,10,1"],
        ["490001", "rescue_fragment_gold,0,49001,10,1"],
        ["490002", "rescue_fragment_purple,0,49002,10,1"],
    ])

    for (const [groupId, expectedRow] of expected) {
        const groupIndex = outer.keys.indexOf(groupId)
        assert.notEqual(groupIndex, -1, `missing group ${groupId}`)
        const innerRows = readTextRowsFromOrderedMapBuffer(outer.rows[groupIndex])
        assert.deepEqual(innerRows, [{ key: "1", text: expectedRow }])
    }

    console.log("rescue fragment display patch tests passed")
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
