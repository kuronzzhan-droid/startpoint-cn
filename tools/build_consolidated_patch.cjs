/**
 * Consolidate the 1.4.56 -> 1.4.57 ability MOD and every later custom
 * reward-table patch into one 1.4.56 -> 1.4.57 archive.
 */
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const unzipper = require("unzipper");

const ROOT = path.resolve(__dirname, "..");
const PATCH_ROOT = path.join(ROOT, "assets", "asset-patch");
const ACTIVE_ROOT = path.join(PATCH_ROOT, "active");
const ARCHIVE_ROOT = path.join(PATCH_ROOT, "archive");
const STAGING_ROOT = path.join(PATCH_ROOT, ".build-consolidated-1.4.63");
const OUTPUT_NAME = "pinball-1.4.56-1.4.57-1-consolidated-ability-v7-and-custom-drops.zip";
const OUTPUT_PATH = path.join(ACTIVE_ROOT, OUTPUT_NAME);

const sources = [
    "pinball-1.4.56-1.4.57-1-mod-ability-damage-party-balanced-v7.zip",
    "pinball-1.4.62-1.4.63-1-phenomena-hell-drop.zip",
];

async function readFilesFromArchive(filename) {
    const activePath = path.join(ACTIVE_ROOT, filename);
    const archivePath = fs.existsSync(activePath) ? activePath : path.join(ARCHIVE_ROOT, filename);
    const archive = await unzipper.Open.file(archivePath);
    const result = [];
    for (const entry of archive.files) {
        const normalized = entry.path.replaceAll("\\", "/");
        if (entry.type === "Directory" || normalized.endsWith("/")) continue;
        if (!normalized.startsWith("production/upload/")) {
            throw new Error(`Unexpected archive entry in ${filename}: ${normalized}`);
        }
        result.push({ path: normalized, buffer: await entry.buffer(), source: filename });
    }
    return result;
}

function createArchive(entryPaths) {
    if (fs.existsSync(OUTPUT_PATH)) fs.rmSync(OUTPUT_PATH);
    const result = childProcess.spawnSync("tar", [
        "-a", "-cf", OUTPUT_PATH,
        "-C", STAGING_ROOT,
        ...entryPaths,
    ], { encoding: "utf8", stdio: "pipe" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || "tar failed");
}

(async () => {
    fs.rmSync(STAGING_ROOT, { recursive: true, force: true });
    fs.mkdirSync(STAGING_ROOT, { recursive: true });

    const merged = new Map();
    for (const source of sources) {
        for (const entry of await readFilesFromArchive(source)) {
            if (merged.has(entry.path)) {
                throw new Error(`Duplicate final resource path: ${entry.path}`);
            }
            merged.set(entry.path, entry);
        }
    }

    if (merged.size !== 17) throw new Error(`Expected 17 final files, got ${merged.size}`);
    for (const entry of merged.values()) {
        const outputPath = path.join(STAGING_ROOT, ...entry.path.split("/"));
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, entry.buffer);
    }

    const entryPaths = [...merged.keys()];
    createArchive(entryPaths);
    fs.rmSync(STAGING_ROOT, { recursive: true, force: true });

    console.log(JSON.stringify({
        archive: OUTPUT_NAME,
        size: fs.statSync(OUTPUT_PATH).size,
        sources,
        files: entryPaths.map(entry => entry.replace("production/upload/", "")),
    }, null, 2));
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
