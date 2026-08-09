const childProcess = require("child_process")
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const unzipper = require("unzipper")
const {
    readOrderedMapRawRowsFromBuffer,
} = require("./gacha_odds_export.cjs")
const {
    uint32LE,
} = require("./orderedmap_serializer.cjs")

const ROOT = path.resolve(__dirname, "..")
const RESOURCE_PATH =
    "production/upload/38/9ee6ccbe584f8fbb6b346de1ee83e9ebdeda4a"
const SOURCE_ARCHIVE = process.env.FRAGMENT_EXCHANGE_SOURCE_ARCHIVE
    || path.join(
        ROOT,
        "assets",
        "asset-patch",
        "active",
        "pinball-1.4.58-1.4.59-1-independent-warmup-v10-cd-balance-nephteim-voice-rescue-fragment-display.zip",
    )
const OUTPUT_ARCHIVE = process.env.FRAGMENT_EXCHANGE_OUTPUT_ARCHIVE
    || path.join(
        ROOT,
        "assets",
        "asset-patch",
        "active",
        "pinball-1.4.59-1.4.60-6-fragment-exchange.zip",
    )
const STAGE_ROOT = path.join(
    ROOT,
    "assets",
    "asset-patch",
    ".build-fragment-exchange",
)

const PRODUCTS = [
    {
        id: "9100009",
        sortId: "100017",
        name: "紫币碎片×100",
        description: "使用金币碎片×100兑换紫币碎片×100。",
        costItemId: "49001",
    },
    {
        id: "9100010",
        sortId: "100018",
        name: "紫币碎片×100",
        description: "使用银币碎片×100兑换紫币碎片×100。",
        costItemId: "49000",
    },
]

function splitCsvRow(row) {
    const fields = []
    let current = ""
    let quoted = false
    for (let index = 0; index < row.length; index++) {
        const char = row[index]
        if (char === "\"") {
            if (quoted && row[index + 1] === "\"") {
                current += "\"\""
                index++
            } else {
                quoted = !quoted
                current += char
            }
        } else if (char === "," && !quoted) {
            fields.push(current)
            current = ""
        } else {
            current += char
        }
    }
    fields.push(current)
    return fields
}

function serializeOrderedMapBlocks(blocks) {
    const keyBuffers = blocks.map(block => Buffer.from(block.key, "utf8"))
    let keyEnd = 0
    let rowEnd = 0
    const pairs = blocks.map((block, index) => {
        keyEnd += keyBuffers[index].length
        rowEnd += block.rowBlock.length
        return Buffer.concat([uint32LE(keyEnd), uint32LE(rowEnd)])
    })
    const indexPayload = Buffer.concat([
        uint32LE(blocks.length),
        ...pairs,
        ...keyBuffers,
    ])
    const indexBlock = zlib.deflateSync(indexPayload)
    return Buffer.concat([
        uint32LE(indexBlock.length),
        indexBlock,
        ...blocks.map(block => block.rowBlock),
    ])
}

function createProductRow(sourceFields, product) {
    const fields = [...sourceFields]
    fields[1] = product.name
    fields[2] = product.sortId
    fields[5] = product.description
    fields[7] = "item/materials/boss_coin/fragment_purple"
    fields[8] = "5"
    fields[9] = "(None)"
    fields[10] = ""
    fields[11] = "(None)"
    fields[12] = product.costItemId
    fields[13] = "100"
    fields[20] = "2015-12-31 23:59:59"
    fields[21] = "(None)"
    fields[22] = "999"
    fields[23] = "999"
    fields[24] = "999"
    fields[29] = "0"
    fields[30] = "49002"
    fields[31] = "100"
    return fields.join(",")
}

async function readArchiveResource(archivePath) {
    const archive = await unzipper.Open.file(archivePath)
    const entry = archive.files.find(
        file => file.path.replaceAll("\\", "/") === RESOURCE_PATH,
    )
    if (!entry) {
        throw new Error(`Missing ${RESOURCE_PATH} in ${archivePath}`)
    }
    return entry.buffer()
}

function patchGeneralShop(buffer) {
    const table = readOrderedMapRawRowsFromBuffer(buffer)
    const sourceIndex = table.keys.indexOf("9100001")
    if (sourceIndex < 0) {
        throw new Error("Missing client source product 9100001")
    }
    const sourceFields = splitCsvRow(
        zlib.inflateSync(table.rows[sourceIndex]).toString("utf8"),
    )
    if (sourceFields.length !== 47) {
        throw new Error(`Unexpected general-shop field count: ${sourceFields.length}`)
    }
    for (const product of PRODUCTS) {
        if (table.keys.includes(product.id)) {
            throw new Error(`Client product already exists: ${product.id}`)
        }
    }

    const blocks = table.keys.map((key, index) => ({
        key,
        rowBlock: table.rows[index],
    }))
    const insertAfter = blocks.findIndex(block => block.key === "9100008")
    if (insertAfter < 0) {
        throw new Error("Missing insertion anchor 9100008")
    }
    blocks.splice(
        insertAfter + 1,
        0,
        ...PRODUCTS.map(product => ({
            key: product.id,
            rowBlock: zlib.deflateSync(
                Buffer.from(createProductRow(sourceFields, product), "utf8"),
            ),
        })),
    )
    const patched = serializeOrderedMapBlocks(blocks)
    const verified = readOrderedMapRawRowsFromBuffer(patched)

    if (verified.keys.length !== table.keys.length + PRODUCTS.length) {
        throw new Error("General shop did not gain exactly two products")
    }
    for (let index = 0; index < table.keys.length; index++) {
        const oldKey = table.keys[index]
        const newIndex = verified.keys.indexOf(oldKey)
        if (
            newIndex < 0
            || !table.rows[index].equals(verified.rows[newIndex])
        ) {
            throw new Error(`Existing client product changed: ${oldKey}`)
        }
    }
    for (const product of PRODUCTS) {
        const index = verified.keys.indexOf(product.id)
        const fields = splitCsvRow(
            zlib.inflateSync(verified.rows[index]).toString("utf8"),
        )
        const actual = [
            fields[1],
            fields[2],
            fields[7],
            fields[12],
            fields[13],
            fields[22],
            fields[23],
            fields[24],
            fields[29],
            fields[30],
            fields[31],
        ]
        const expected = [
            product.name,
            product.sortId,
            "item/materials/boss_coin/fragment_purple",
            product.costItemId,
            "100",
            "999",
            "999",
            "999",
            "0",
            "49002",
            "100",
        ]
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(
                `Client verification failed for ${product.id}: ${JSON.stringify(actual)}`,
            )
        }
    }
    return patched
}

function verifyServerAssets() {
    const shop = JSON.parse(
        fs.readFileSync(path.join(ROOT, "assets", "general_shop.json"), "utf8"),
    )
    const whitelist = JSON.parse(
        fs.readFileSync(
            path.join(ROOT, "assets", "cdn_general_shop_whitelist.json"),
            "utf8",
        ),
    )
    for (const product of PRODUCTS) {
        const row = shop[product.id]
        if (
            !row
            || row.costs?.length !== 1
            || row.costs[0].id !== Number(product.costItemId)
            || row.costs[0].amount !== 100
            || row.rewards?.length !== 1
            || row.rewards[0].type !== 0
            || row.rewards[0].id !== 49002
            || row.rewards[0].count !== 100
            || row.stock !== 999
            || !whitelist.includes(Number(product.id))
        ) {
            throw new Error(`Server verification failed for ${product.id}`)
        }
    }
}

function createArchive(payload) {
    fs.rmSync(STAGE_ROOT, { recursive: true, force: true })
    const outputFile = path.join(STAGE_ROOT, ...RESOURCE_PATH.split("/"))
    fs.mkdirSync(path.dirname(outputFile), { recursive: true })
    fs.writeFileSync(outputFile, payload)
    fs.mkdirSync(path.dirname(OUTPUT_ARCHIVE), { recursive: true })
    fs.rmSync(OUTPUT_ARCHIVE, { force: true })
    const result = childProcess.spawnSync(
        "tar",
        ["-a", "-cf", OUTPUT_ARCHIVE, "-C", STAGE_ROOT, "production"],
        { encoding: "utf8", stdio: "pipe" },
    )
    fs.rmSync(STAGE_ROOT, { recursive: true, force: true })
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || "Failed to build ZIP")
    }
}

async function main() {
    verifyServerAssets()
    const source = await readArchiveResource(SOURCE_ARCHIVE)
    createArchive(patchGeneralShop(source))
    const output = await readArchiveResource(OUTPUT_ARCHIVE)
    patchGeneralShopCheck(output)
    console.log(JSON.stringify({
        version: "1.4.59 -> 1.4.60",
        sourceArchive: SOURCE_ARCHIVE,
        outputArchive: OUTPUT_ARCHIVE,
        outputSize: fs.statSync(OUTPUT_ARCHIVE).size,
        resourcePath: RESOURCE_PATH.replace("production/upload/", ""),
        products: PRODUCTS,
    }, null, 2))
}

function patchGeneralShopCheck(buffer) {
    const table = readOrderedMapRawRowsFromBuffer(buffer)
    for (const product of PRODUCTS) {
        if (table.keys.filter(key => key === product.id).length !== 1) {
            throw new Error(`Archive product mismatch: ${product.id}`)
        }
    }
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
