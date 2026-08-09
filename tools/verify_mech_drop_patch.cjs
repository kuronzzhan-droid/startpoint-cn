const path = require("path");
const zlib = require("zlib");
const unzipper = require("unzipper");

const ROOT = path.resolve(__dirname, "..");
const patchArchivePath = path.join(
    ROOT,
    "assets",
    "asset-patch",
    "active",
    "pinball-1.4.56-1.4.57-1-consolidated-ability-v7-and-custom-drops.zip",
);
const baseArchivePath = path.join(
    ROOT,
    ".cdn",
    "cn",
    "archive-common-diff",
    "pinball-1.4.48-1.4.49-1-4c2dd780.zip",
);

const SCORE_ENTRY = "production/upload/93/a3763bc243c7178e1d97a3acd9dab2e9406a5e";
const RARE_ENTRY = "production/upload/68/6c1822fcaa320f71e8245ae7be98d553b84cb7";
const expected = {
    "7000010": { item: "40402", rare: "700010", core: "40408" },
    "7000011": { item: "40403", rare: "700011", core: "40409" },
    "7000012": { item: "40404", rare: "700012", core: "40410" },
    "7000013": { item: "40401", rare: "700013", core: "40407" },
    "7000014": { item: "40406", rare: "700014", core: "40412" },
    "7000015": { item: "40405", rare: "700015", core: "40411" },
};

function parseOrderedMap(buffer) {
    const indexLength = buffer.readUInt32LE(0);
    const index = zlib.inflateSync(buffer.subarray(4, 4 + indexLength));
    const count = index.readUInt32LE(0);
    const keysOffset = 4 + count * 8;
    const rowsOffset = 4 + indexLength;
    const result = new Map();
    let previousKeyEnd = 0;
    let previousRowEnd = 0;

    for (let i = 0; i < count; i++) {
        const keyEnd = index.readUInt32LE(4 + i * 8);
        const rowEnd = index.readUInt32LE(8 + i * 8);
        const key = index.subarray(keysOffset + previousKeyEnd, keysOffset + keyEnd).toString("utf8");
        const rowBlock = buffer.subarray(rowsOffset + previousRowEnd, rowsOffset + rowEnd);
        result.set(key, rowBlock);
        previousKeyEnd = keyEnd;
        previousRowEnd = rowEnd;
    }
    return result;
}

function readInnerRows(rowBlock) {
    return [...parseOrderedMap(rowBlock).values()].map(row => zlib.inflateSync(row).toString("utf8"));
}

async function readEntry(archive, name) {
    const entry = archive.files.find(file => file.path.replaceAll("\\", "/") === name);
    if (!entry) throw new Error(`Archive entry not found: ${name}`);
    return entry.buffer();
}

function verifyBaseRows(baseTable, patchedTable, label, replacedKeys) {
    for (const [key, baseRow] of baseTable) {
        if (replacedKeys.has(key)) continue;
        const patchedRow = patchedTable.get(key);
        if (!patchedRow) throw new Error(`${label} lost official group ${key}`);
        if (!patchedRow.equals(baseRow)) throw new Error(`${label} changed official group ${key}`);
    }
}

(async () => {
    const patchArchive = await unzipper.Open.file(patchArchivePath);
    const baseArchive = await unzipper.Open.file(baseArchivePath);
    const score = parseOrderedMap(await readEntry(patchArchive, SCORE_ENTRY));
    const rare = parseOrderedMap(await readEntry(patchArchive, RARE_ENTRY));
    const baseScore = parseOrderedMap(await readEntry(baseArchive, SCORE_ENTRY));
    const baseRare = parseOrderedMap(await readEntry(baseArchive, RARE_ENTRY));

    verifyBaseRows(baseScore, score, "score_reward", new Set([...Object.keys(expected), "11000948"]));
    verifyBaseRows(baseRare, rare, "rare_score_reward", new Set([...Object.values(expected).map(values => values.rare), "3002"]));

    for (const [groupId, values] of Object.entries(expected)) {
        const scoreBlock = score.get(groupId);
        const rareBlock = rare.get(values.rare);
        if (!scoreBlock || !rareBlock) throw new Error(`Missing group ${groupId} or ${values.rare}`);
        const scoreRows = readInnerRows(scoreBlock);
        const rareRows = readInnerRows(rareBlock);
        if (scoreRows.length !== 2 || rareRows.length !== 1) {
            throw new Error(`Wrong nested row count for ${groupId}`);
        }
        if (scoreRows[0] !== `mech_decisive_${groupId}_normal,0,0,${values.item},1,0,,`) {
            throw new Error(`Group ${groupId} has wrong normal item row`);
        }
        if (scoreRows[1] !== `mech_decisive_${groupId}_rare,1,,,,,${values.rare},0.1`) {
            throw new Error(`Group ${groupId} has wrong rare pool row`);
        }
        if (rareRows[0] !== `mech_decisive_${values.rare},0,${values.core},1,1,false`) {
            throw new Error(`Rare group ${values.rare} has wrong core row`);
        }
    }

    const basePhenomenaRows = readInnerRows(baseScore.get("11000948"));
    const phenomenaRows = readInnerRows(score.get("11000948"));
    const phenomenaRareRows = readInnerRows(rare.get("3002"));
    if (phenomenaRows.length !== basePhenomenaRows.length + 2) {
        throw new Error("Phenomena hell score group has the wrong row count");
    }
    if (!basePhenomenaRows.every((row, index) => phenomenaRows[index] === row)) {
        throw new Error("Phenomena hell patch changed an original reward row");
    }
    if (phenomenaRows.at(-2) !== "phenomena_hell_omni_gear,0,0,10000095,1,0,,") {
        throw new Error("Phenomena hell normal drop is invalid");
    }
    if (phenomenaRows.at(-1) !== "phenomena_hell_fusion_core,1,,,,,3002,0.1") {
        throw new Error("Phenomena hell rare drop chance is invalid");
    }
    if (phenomenaRareRows.length !== 1 || phenomenaRareRows[0] !== "phenomena_hell_fusion_core,0,10000096,1,1,false") {
        throw new Error("Phenomena hell rare drop pool is invalid");
    }

    if (score.size !== baseScore.size || rare.size !== baseRare.size) {
        throw new Error("Patched table group counts are incorrect");
    }
    console.log(`Preserved every non-reserved official reward row byte-for-byte.`);
    console.log(`Verified nested maps for all ${score.size} score groups and ${rare.size} rare groups.`);
    console.log("All six mech drop mappings and 10% rare chances are valid.");
    console.log("Phenomena hell keeps all original rows and adds item 10000095 x1 plus item 10000096 at 10% x1.");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
