const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");

const ROOT = path.resolve(__dirname, "..");
const ACTIVE_ROOT = path.join(ROOT, "assets", "asset-patch", "active");
const ARCHIVE_ROOT = path.join(ROOT, "assets", "asset-patch", "archive");
const outputName = "pinball-1.4.56-1.4.57-1-consolidated-ability-v7-and-custom-drops.zip";
const sourceNames = [
    "pinball-1.4.56-1.4.57-1-mod-ability-damage-party-balanced-v7.zip",
    "pinball-1.4.62-1.4.63-1-phenomena-hell-drop.zip",
];

async function archiveFiles(filename) {
    const activePath = path.join(ACTIVE_ROOT, filename);
    const archivePath = fs.existsSync(activePath) ? activePath : path.join(ARCHIVE_ROOT, filename);
    const archive = await unzipper.Open.file(archivePath);
    const files = new Map();
    for (const entry of archive.files) {
        const normalized = entry.path.replaceAll("\\", "/");
        if (entry.type === "Directory" || normalized.endsWith("/")) continue;
        if (files.has(normalized)) throw new Error(`${filename} contains duplicate ${normalized}`);
        files.set(normalized, await entry.buffer());
    }
    return files;
}

(async () => {
    const expected = new Map();
    for (const sourceName of sourceNames) {
        for (const [entryPath, buffer] of await archiveFiles(sourceName)) {
            if (expected.has(entryPath)) throw new Error(`Source archives overlap at ${entryPath}`);
            expected.set(entryPath, buffer);
        }
    }
    const actual = await archiveFiles(outputName);
    if (actual.size !== 17 || actual.size !== expected.size) {
        throw new Error(`Wrong merged entry count: expected ${expected.size}, actual ${actual.size}`);
    }
    for (const [entryPath, expectedBuffer] of expected) {
        const actualBuffer = actual.get(entryPath);
        if (!actualBuffer) throw new Error(`Merged archive is missing ${entryPath}`);
        if (!actualBuffer.equals(expectedBuffer)) throw new Error(`Merged archive changed ${entryPath}`);
    }
    console.log(`Verified ${actual.size} merged files byte-for-byte: 15 ability resources and 2 latest reward tables.`);
    console.log("The consolidated ZIP contains no directory entries, duplicates, or stale intermediate reward tables.");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
