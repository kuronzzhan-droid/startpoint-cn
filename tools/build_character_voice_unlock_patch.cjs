/**
 * Build a pending-merge CN client asset patch that restores voice playback
 * for every character currently listed in character_voice_exclude.
 *
 * This output is deliberately written under asset-patch/inactive. It must not
 * be published on its own or copied into asset-patch/active.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const childProcess = require("child_process");
const unzipper = require("unzipper");
const { readOrderedMapRawRowsFromBuffer } = require("./gacha_odds_export.cjs");
const { hashResourcePath, uint32LE } = require("./orderedmap_serializer.cjs");

const ROOT = path.resolve(__dirname, "..");
const BASE_ARCHIVE_PATH = process.env.VOICE_UI_STRING_ARCHIVE
    || process.env.NEPHTEIM_UI_STRING_ARCHIVE
    || path.join(
        ROOT,
        ".cdn",
        "cn",
        "archive-common-diff",
        "pinball-1.4.47-1.4.48-1-74436299.zip",
    );
const FROM_VERSION = process.env.VOICE_PATCH_FROM || process.env.NEPHTEIM_PATCH_FROM || "1.4.59";
const TO_VERSION = process.env.VOICE_PATCH_TO || process.env.NEPHTEIM_PATCH_TO || "1.4.60";
const OUTPUT_DIR = process.env.VOICE_PATCH_OUTPUT_DIR
    || process.env.NEPHTEIM_PATCH_OUTPUT_DIR
    || path.join(ROOT, "assets", "asset-patch", "inactive");
const OUTPUT_NAME = `pinball-${FROM_VERSION}-${TO_VERSION}-1-character-voice-blacklist-unlock.pending-merge.zip`;
const OUTPUT_PATH = path.join(OUTPUT_DIR, OUTPUT_NAME);
const STAGING_ROOT = path.join(ROOT, "assets", "asset-patch", ".build-character-voice-unlock");
const LOGICAL_PATH = "master/string/ui_string.orderedmap";
const RESOURCE_PATH = hashResourcePath(LOGICAL_PATH).relativePath;
const ARCHIVE_ENTRY = `production/upload/${RESOURCE_PATH}`;
const VOICE_KEY = "character_voice_exclude";

async function readBaseTable() {
    if (!fs.existsSync(BASE_ARCHIVE_PATH)) {
        throw new Error(`UI string base archive not found: ${BASE_ARCHIVE_PATH}`);
    }
    const archive = await unzipper.Open.file(BASE_ARCHIVE_PATH);
    const entry = archive.files.find(file => file.path.replaceAll("\\", "/") === ARCHIVE_ENTRY);
    if (!entry) {
        throw new Error(`UI string table not found in base archive: ${ARCHIVE_ENTRY}`);
    }
    return entry.buffer();
}

function serializeRawRows(keys, rowBlocks) {
    const keyBuffers = keys.map(key => Buffer.from(key, "utf8"));
    let keyEnd = 0;
    let rowEnd = 0;
    const pairs = keys.map((_, index) => {
        keyEnd += keyBuffers[index].length;
        rowEnd += rowBlocks[index].length;
        return Buffer.concat([uint32LE(keyEnd), uint32LE(rowEnd)]);
    });
    const indexPayload = Buffer.concat([
        uint32LE(keys.length),
        ...pairs,
        ...keyBuffers,
    ]);
    const indexBlock = zlib.deflateSync(indexPayload);
    return Buffer.concat([
        uint32LE(indexBlock.length),
        indexBlock,
        ...rowBlocks,
    ]);
}

function patchVoiceBlacklist(baseBuffer) {
    const parsed = readOrderedMapRawRowsFromBuffer(baseBuffer);
    const index = parsed.keys.indexOf(VOICE_KEY);
    if (index < 0) throw new Error(`${VOICE_KEY} is missing from UI string table`);

    const original = zlib.inflateSync(parsed.rows[index]).toString("utf8");
    const tokens = original.split("|").filter(Boolean);
    if (tokens.length !== 12) {
        throw new Error(`Expected 12 entries in ${VOICE_KEY}, found ${tokens.length}: ${original}`);
    }
    const rowBlocks = parsed.rows.slice();
    rowBlocks[index] = zlib.deflateSync(Buffer.from("", "utf8"));
    return {
        buffer: serializeRawRows(parsed.keys, rowBlocks),
        original,
        patched: "",
        removed: tokens,
    };
}

function createArchive() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    if (fs.existsSync(OUTPUT_PATH)) fs.rmSync(OUTPUT_PATH);
    const result = childProcess.spawnSync("tar", [
        "-a", "-cf", OUTPUT_PATH,
        "-C", STAGING_ROOT,
        ARCHIVE_ENTRY,
    ], { encoding: "utf8", stdio: "pipe" });
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || "tar failed");
    }
}

(async () => {
    fs.rmSync(STAGING_ROOT, { recursive: true, force: true });
    const patched = patchVoiceBlacklist(await readBaseTable());
    const outputFile = path.join(STAGING_ROOT, ...ARCHIVE_ENTRY.split("/"));
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, patched.buffer);
    createArchive();
    fs.rmSync(STAGING_ROOT, { recursive: true, force: true });

    console.log(JSON.stringify({
        archive: OUTPUT_PATH,
        archiveSize: fs.statSync(OUTPUT_PATH).size,
        resource: RESOURCE_PATH,
        removed: patched.removed,
        retained: [],
        originalValue: patched.original,
        patchedValue: patched.patched,
    }, null, 2));
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
