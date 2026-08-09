/**
 * Build the client master-data patch that exposes custom server drops.
 *
 * The server JSON is converted back to the client's orderedmap row shape, then
 * packaged as a 1.4.62 -> 1.4.63 common diff archive.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const childProcess = require("child_process");
const unzipper = require("unzipper");
const { readOrderedMapRawRowsFromBuffer } = require("./gacha_odds_export.cjs");
const { hashResourcePath, serializeOrderedMap, serializeOrderedMapBlocks } = require("./orderedmap_serializer.cjs");

const ROOT = path.resolve(__dirname, "..");
const BASE_ARCHIVE_PATH = path.join(ROOT, ".cdn", "cn", "archive-common-diff", "pinball-1.4.48-1.4.49-1-4c2dd780.zip");
const PATCH_ROOT = path.join(ROOT, "assets", "asset-patch");
const STAGING_ROOT = path.join(PATCH_ROOT, ".build-mech-drop-display");
const ACTIVE_ROOT = path.join(PATCH_ROOT, "active");
const ARCHIVE_NAME = "pinball-1.4.62-1.4.63-1-phenomena-hell-drop.zip";
const ARCHIVE_PATH = path.join(ACTIVE_ROOT, ARCHIVE_NAME);

const customGroups = {
    "7000010": { item: 40402, rareGroup: 700010, core: 40408 },
    "7000011": { item: 40403, rareGroup: 700011, core: 40409 },
    "7000012": { item: 40404, rareGroup: 700012, core: 40410 },
    "7000013": { item: 40401, rareGroup: 700013, core: 40407 },
    "7000014": { item: 40406, rareGroup: 700014, core: 40412 },
    "7000015": { item: 40405, rareGroup: 700015, core: 40411 },
};

async function readBaseTable(entryPath) {
    const archive = await unzipper.Open.file(BASE_ARCHIVE_PATH);
    const entry = archive.files.find(file => file.path.replaceAll("\\", "/") === entryPath);
    if (!entry) throw new Error(`Base table not found in official archive: ${entryPath}`);
    return entry.buffer();
}

function makeInnerMap(rows) {
    return serializeOrderedMap(
        rows.map((row, index) => ({ key: String(index + 1), row })),
        { sort: "numeric" },
    );
}

function readInnerCsvRows(rowBlock) {
    const inner = readOrderedMapRawRowsFromBuffer(rowBlock);
    return inner.rows.map(row => zlib.inflateSync(row).toString("utf8"));
}

function appendCustomGroups(baseBuffer, kind) {
    const base = readOrderedMapRawRowsFromBuffer(baseBuffer);
    const entries = base.keys.map((key, index) => ({ key, rowBlock: base.rows[index] }));
    const entryIndex = new Map(entries.map((entry, index) => [entry.key, index]));
    for (const [scoreGroupId, values] of Object.entries(customGroups)) {
        const targetKey = kind === "score" ? scoreGroupId : String(values.rareGroup);
        const targetIndex = entryIndex.get(targetKey);
        if (targetIndex === undefined) {
            throw new Error(`Official ${kind} table does not contain native key ${targetKey}`);
        }
        if (kind === "score") {
            entries[targetIndex] = {
                key: scoreGroupId,
                rowBlock: makeInnerMap([
                    `mech_decisive_${scoreGroupId}_normal,0,0,${values.item},1,0,,`,
                    `mech_decisive_${scoreGroupId}_rare,1,,,,,${values.rareGroup},0.1`,
                ]),
            };
        } else {
            entries[targetIndex] = {
                key: String(values.rareGroup),
                rowBlock: makeInnerMap([
                    `mech_decisive_${values.rareGroup},0,${values.core},1,1,false`,
                ]),
            };
        }
    }

    if (kind === "score") {
        const phenomenaGroupId = "11000948";
        const targetIndex = entryIndex.get(phenomenaGroupId);
        if (targetIndex === undefined) {
            throw new Error(`Official score table does not contain native key ${phenomenaGroupId}`);
        }
        const officialRows = readInnerCsvRows(entries[targetIndex].rowBlock);
        entries[targetIndex] = {
            key: phenomenaGroupId,
            rowBlock: makeInnerMap([
                ...officialRows,
                "phenomena_hell_omni_gear,0,0,10000095,1,0,,",
                "phenomena_hell_fusion_core,1,,,,,3002,0.1",
            ]),
        };
    } else {
        const phenomenaRareGroupId = "3002";
        const targetIndex = entryIndex.get(phenomenaRareGroupId);
        if (targetIndex === undefined) {
            throw new Error(`Official rare table does not contain native key ${phenomenaRareGroupId}`);
        }
        entries[targetIndex] = {
            key: phenomenaRareGroupId,
            rowBlock: makeInnerMap([
                "phenomena_hell_fusion_core,0,10000096,1,1,false",
            ]),
        };
    }
    return { buffer: serializeOrderedMapBlocks(entries, { sort: "preserve" }), count: entries.length };
}

function writeOrderedMap(logicalPath, built) {
    const hash = hashResourcePath(logicalPath);
    const outputPath = path.join(STAGING_ROOT, "production", "upload", ...hash.relativePath.split("/"));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, built.buffer);
    console.log(`${logicalPath} -> ${hash.relativePath} (${built.count} groups, ${built.buffer.length} bytes)`);
    return hash.relativePath;
}

function createArchive(files) {
    fs.mkdirSync(ACTIVE_ROOT, { recursive: true });
    if (fs.existsSync(ARCHIVE_PATH)) fs.rmSync(ARCHIVE_PATH);
    // The AIR client extractor expects only file entries. PowerShell's
    // Compress-Archive adds a `production/upload/` directory entry and the
    // client advances the resource version without applying the contained
    // replacements. bsdtar produces the same flat entry layout as the known
    // working asset MOD archives.
    const result = childProcess.spawnSync("tar", [
        "-a", "-cf", ARCHIVE_PATH,
        "-C", STAGING_ROOT,
        ...files.map(file => `production/upload/${file}`),
    ], {
        encoding: "utf8",
        stdio: "pipe",
    });
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || "Compress-Archive failed");
    }
    console.log(`${ARCHIVE_PATH} (${fs.statSync(ARCHIVE_PATH).size} bytes)`);
}

(async () => {
    fs.rmSync(STAGING_ROOT, { recursive: true, force: true });
    const scoreBase = await readBaseTable("production/upload/93/a3763bc243c7178e1d97a3acd9dab2e9406a5e");
    const rareBase = await readBaseTable("production/upload/68/6c1822fcaa320f71e8245ae7be98d553b84cb7");
    const files = [
        writeOrderedMap("master/reward/score_reward.orderedmap", appendCustomGroups(scoreBase, "score")),
        writeOrderedMap("master/reward/rare_score_reward.orderedmap", appendCustomGroups(rareBase, "rare")),
    ];
    createArchive(files);
    fs.rmSync(STAGING_ROOT, { recursive: true, force: true });
    console.log(JSON.stringify({ archive: ARCHIVE_NAME, size: fs.statSync(ARCHIVE_PATH).size, files }, null, 2));
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
