/**
 * Merge rescue-fragment result-display records into an existing
 * 1.4.58 -> 1.4.59 client asset patch.
 *
 * The server grants item IDs 49000/49001/49002 through item_list. The client
 * result scene only renders reward cards referenced by a master reward table,
 * so this builder adds three isolated AdditionalRewardTable groups without
 * changing any quest, event, or game-mode master data.
 */
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const childProcess = require("child_process")
const unzipper = require("unzipper")
const {
    readOrderedMapRawRowsFromBuffer,
} = require("./gacha_odds_export.cjs")
const {
    hashResourcePath,
    serializeOrderedMap,
    uint32LE,
} = require("./orderedmap_serializer.cjs")

const ROOT = path.resolve(__dirname, "..")
const FROM_VERSION = "1.4.58"
const TO_VERSION = "1.4.59"
const LOGICAL_PATH = "master/reward/event/additional_reward.orderedmap"
const RESOURCE_PATH = hashResourcePath(LOGICAL_PATH).relativePath
const ARCHIVE_ENTRY = `production/upload/${RESOURCE_PATH}`

const BASE_ADDITIONAL_REWARD_ARCHIVE = process.env.RESCUE_ADDITIONAL_REWARD_ARCHIVE
    || path.join(
        ROOT,
        ".cdn",
        "cn",
        "archive-common-full",
        "pinball-1.4.0-304-5c548ca8.zip",
    )
const INPUT_PATCH = process.env.RESCUE_DISPLAY_INPUT_PATCH
    || path.join(
        ROOT,
        "assets",
        "asset-patch",
        "active",
        "pinball-1.4.58-1.4.59-1-independent-warmup-v10-cd-balance-nephteim-voice.zip",
    )
const OUTPUT_DIR = process.env.RESCUE_DISPLAY_OUTPUT_DIR
    || path.join(ROOT, "assets", "asset-patch", "active")
const OUTPUT_NAME = process.env.RESCUE_DISPLAY_OUTPUT_NAME
    || "pinball-1.4.58-1.4.59-1-independent-warmup-v10-cd-balance-nephteim-voice-rescue-fragment-display.zip"
const OUTPUT_PATCH = path.join(OUTPUT_DIR, OUTPUT_NAME)
const STAGING_ROOT = path.join(ROOT, "assets", "asset-patch", ".build-rescue-fragment-display")

const GROUPS = [
    {
        groupId: "490000",
        row: "rescue_fragment_silver,0,49000,10,1",
    },
    {
        groupId: "490001",
        row: "rescue_fragment_gold,0,49001,10,1",
    },
    {
        groupId: "490002",
        row: "rescue_fragment_purple,0,49002,10,1",
    },
]

function serializeRawRows(keys, rowBlocks) {
    const keyBuffers = keys.map(key => Buffer.from(key, "utf8"))
    let keyEnd = 0
    let rowEnd = 0
    const pairs = keys.map((_, index) => {
        keyEnd += keyBuffers[index].length
        rowEnd += rowBlocks[index].length
        return Buffer.concat([uint32LE(keyEnd), uint32LE(rowEnd)])
    })
    const indexPayload = Buffer.concat([
        uint32LE(keys.length),
        ...pairs,
        ...keyBuffers,
    ])
    const indexBlock = zlib.deflateSync(indexPayload)
    return Buffer.concat([
        uint32LE(indexBlock.length),
        indexBlock,
        ...rowBlocks,
    ])
}

async function readArchiveEntry(archivePath, entryPath) {
    if (!fs.existsSync(archivePath)) {
        throw new Error(`Archive not found: ${archivePath}`)
    }
    const archive = await unzipper.Open.file(archivePath)
    const normalizedEntryPath = entryPath.replaceAll("\\", "/")
    const entry = archive.files.find(
        file => file.path.replaceAll("\\", "/") === normalizedEntryPath,
    )
    if (!entry) {
        throw new Error(`Entry ${entryPath} not found in ${archivePath}`)
    }
    return entry.buffer()
}

function patchAdditionalRewardTable(baseBuffer) {
    const outer = readOrderedMapRawRowsFromBuffer(baseBuffer)
    const byGroupId = new Map(
        outer.keys.map((key, index) => [key, outer.rows[index]]),
    )

    for (const group of GROUPS) {
        const inner = serializeOrderedMap([{ key: "1", row: group.row }])
        byGroupId.set(group.groupId, inner)
    }

    const originalKeys = outer.keys.filter(
        key => !GROUPS.some(group => group.groupId === key),
    )
    const keys = [...originalKeys, ...GROUPS.map(group => group.groupId)]
    const rows = keys.map(key => byGroupId.get(key))
    if (rows.some(row => !Buffer.isBuffer(row))) {
        throw new Error("Failed to rebuild AdditionalRewardTable rows")
    }
    return serializeRawRows(keys, rows)
}

async function extractInputPatch() {
    if (!fs.existsSync(INPUT_PATCH)) {
        throw new Error(`Input 1.4.58 -> 1.4.59 patch not found: ${INPUT_PATCH}`)
    }
    const archive = await unzipper.Open.file(INPUT_PATCH)
    await archive.extract({ path: STAGING_ROOT })
}

function createArchive() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
    fs.rmSync(OUTPUT_PATCH, { force: true })
    const result = childProcess.spawnSync("tar", [
        "-a",
        "-cf",
        OUTPUT_PATCH,
        "-C",
        STAGING_ROOT,
        "production",
    ], { encoding: "utf8", stdio: "pipe" })
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || "tar failed")
    }
}

async function main() {
    fs.rmSync(STAGING_ROOT, { recursive: true, force: true })
    await extractInputPatch()

    const baseBuffer = await readArchiveEntry(
        BASE_ADDITIONAL_REWARD_ARCHIVE,
        ARCHIVE_ENTRY,
    )
    const patchedBuffer = patchAdditionalRewardTable(baseBuffer)
    const outputFile = path.join(STAGING_ROOT, ...ARCHIVE_ENTRY.split("/"))
    fs.mkdirSync(path.dirname(outputFile), { recursive: true })
    fs.writeFileSync(outputFile, patchedBuffer)

    createArchive()
    const outputArchive = await unzipper.Open.file(OUTPUT_PATCH)
    const files = outputArchive.files
        .filter(file => file.type !== "Directory")
        .map(file => file.path.replaceAll("\\", "/"))

    if (files.length !== 17 || !files.includes(ARCHIVE_ENTRY)) {
        throw new Error(
            `Expected original 16 resources plus AdditionalRewardTable, got ${files.length}`,
        )
    }

    fs.rmSync(STAGING_ROOT, { recursive: true, force: true })
    console.log(JSON.stringify({
        fromVersion: FROM_VERSION,
        toVersion: TO_VERSION,
        inputPatch: INPUT_PATCH,
        outputPatch: OUTPUT_PATCH,
        outputSize: fs.statSync(OUTPUT_PATCH).size,
        additionalRewardResource: RESOURCE_PATH,
        groups: GROUPS,
        resourceFileCount: files.length,
    }, null, 2))
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
