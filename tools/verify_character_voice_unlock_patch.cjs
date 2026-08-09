const assert = require("assert");
const path = require("path");
const zlib = require("zlib");
const unzipper = require("unzipper");
const { readOrderedMapRawRowsFromBuffer } = require("./gacha_odds_export.cjs");
const { hashResourcePath } = require("./orderedmap_serializer.cjs");

const root = path.resolve(__dirname, "..");
const sourceArchive = process.env.VOICE_UI_STRING_ARCHIVE;
const patchArchive = process.env.VOICE_PATCH_ARCHIVE || path.join(
    root,
    "assets",
    "asset-patch",
    "inactive",
    "pinball-1.4.59-1.4.60-1-character-voice-blacklist-unlock.pending-merge.zip",
);
const resource = `production/upload/${hashResourcePath("master/string/ui_string.orderedmap").relativePath}`;

async function readResource(archivePath) {
    const archive = await unzipper.Open.file(archivePath);
    const entry = archive.files.find(file => file.path.replaceAll("\\", "/") === resource);
    assert(entry, `Missing ${resource} in ${archivePath}`);
    return entry.buffer();
}

(async () => {
    assert(sourceArchive, "VOICE_UI_STRING_ARCHIVE is required");
    assert(patchArchive.includes(`${path.sep}inactive${path.sep}`), "Patch must remain under asset-patch/inactive");

    const before = readOrderedMapRawRowsFromBuffer(await readResource(sourceArchive));
    const after = readOrderedMapRawRowsFromBuffer(await readResource(patchArchive));
    assert.deepStrictEqual(after.keys, before.keys, "Ordered-map keys changed");

    const target = before.keys.indexOf("character_voice_exclude");
    assert(target >= 0, "character_voice_exclude is missing");
    const original = zlib.inflateSync(before.rows[target]).toString("utf8");
    const patched = zlib.inflateSync(after.rows[target]).toString("utf8");
    assert.strictEqual(original.split("|").filter(Boolean).length, 12, "Unexpected original blacklist size");
    assert.strictEqual(patched, "", "Voice blacklist was not cleared");

    for (let index = 0; index < before.rows.length; index += 1) {
        if (index === target) continue;
        assert(before.rows[index].equals(after.rows[index]), `Unrelated row changed: ${before.keys[index]}`);
    }

    console.log(JSON.stringify({
        ok: true,
        patchArchive,
        changedKey: "character_voice_exclude",
        removedEntries: original.split("|").filter(Boolean),
        unrelatedRowsPreserved: before.rows.length - 1,
    }, null, 2));
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
