/**
 * Orderedmap binary serializer.
 * Converts { key: rowJson } to the binary orderedmap format
 * used by World Flipper's master data system.
 * 
 * Format (reverse-engineered from gacha_odds_export.cjs parseOrderedMapIndex):
 * [4 bytes UInt32LE: indexBlockLength]
 * [indexBlock: zlib(indexPayload)]
 *   indexPayload:
 *     [4 bytes UInt32LE: entryCount]
 *     [entryCount × 8 bytes: { keyEnd: UInt32LE, rowEnd: UInt32LE } pairs]
 *     [keys concatenated as UTF-8]
 * [rowBlocks: per-entry zlib(JSON row)]
 */
const crypto = require("crypto");
const zlib = require("zlib");
const path = require("path");
const fs = require("fs");

function uint32LE(value) {
    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt32LE(value, 0);
    return buf;
}

/**
 * Serialize entries array to orderedmap binary buffer.
 * @param {Array<{key: string, row: string}>} entries
 * @param {{ sort?: "numeric" | "lexicographic" }} [options]
 * @returns {Buffer}
 */
function serializeOrderedMap(entries, options = {}) {
    // MasterBinaryMap searches general master-table keys lexicographically.
    // Keep numeric sorting as the default for existing gacha patch builders,
    // whose keys have uniform widths and historically used numeric ordering.
    if (options.sort === "lexicographic") {
        entries.sort((a, b) => a.key.localeCompare(b.key));
    } else {
        entries.sort((a, b) => {
            const na = parseInt(a.key, 10);
            const nb = parseInt(b.key, 10);
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
            return a.key.localeCompare(b.key);
        });
    }

    const rowBlocks = entries.map(e => zlib.deflateSync(Buffer.from(e.row, "utf8")));
    return serializeOrderedMapBlocks(
        entries.map((entry, index) => ({ key: entry.key, rowBlock: rowBlocks[index] })),
        { sort: "preserve" },
    );
}

/**
 * Serialize entries whose row blocks are already encoded. This is required for
 * nested master tables, where each outer row is itself an orderedmap binary.
 * @param {Array<{key: string, rowBlock: Buffer}>} entries
 * @param {{ sort?: "numeric" | "lexicographic" | "preserve" }} [options]
 * @returns {Buffer}
 */
function serializeOrderedMapBlocks(entries, options = {}) {
    if (options.sort === "lexicographic") {
        entries.sort((a, b) => a.key.localeCompare(b.key));
    } else if (options.sort === "numeric") {
        entries.sort((a, b) => Number(a.key) - Number(b.key));
    }

    const keyBuffers = entries.map(e => Buffer.from(e.key, "utf8"));
    const rowBlocks = entries.map(e => e.rowBlock);

    // Build index payload
    let keyPos = 0;
    let rowPos = 0;
    const pairs = entries.map((_, i) => {
        keyPos += keyBuffers[i].length;
        rowPos += rowBlocks[i].length;
        return {
            keyEnd: keyPos,
            rowEnd: rowPos,
        };
    });

    const indexPayload = Buffer.concat([
        uint32LE(entries.length),
        Buffer.concat(pairs.map(p => 
            Buffer.concat([uint32LE(p.keyEnd), uint32LE(p.rowEnd)])
        )),
        Buffer.concat(keyBuffers),
    ]);

    // Compress index
    const indexBlock = zlib.deflateSync(indexPayload);

    return Buffer.concat([
        uint32LE(indexBlock.length),
        indexBlock,
        ...rowBlocks,
    ]);
}

/**
 * Write entries as orderedmap file.
 * @param {string} outPath - output file path
 * @param {Array<{key: string, row: string}>} entries
 */
function writeOrderedMap(outPath, entries) {
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const buf = serializeOrderedMap(entries);
    fs.writeFileSync(outPath, buf);
    console.log(`Wrote orderedmap: ${outPath} (${buf.length} bytes, ${entries.length} entries)`);
}

/**
 * Compute hash path for an orderedmap resource.
 * @param {string} resourcePath - e.g. "orderedmap/gacha/gacha_feature_content.json"
 * @returns {{ logicalPath: string, relativePath: string }}
 */
function hashResourcePath(resourcePath, salt = "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy") {
    const normalized = resourcePath.replace(/[\/\\]+/g, "/").replace(/^\//, "");
    const digest = crypto.createHash("sha1").update(normalized + salt).digest("hex");
    return {
        logicalPath: normalized,
        relativePath: `${digest.slice(0, 2)}/${digest.slice(2)}`,
    };
}

module.exports = {
    serializeOrderedMap,
    serializeOrderedMapBlocks,
    writeOrderedMap,
    hashResourcePath,
    uint32LE,
};
