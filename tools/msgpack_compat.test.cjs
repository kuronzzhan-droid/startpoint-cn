const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")
const { pack, unpack } = require("msgpackr")

const projectRoot = process.env.STARTPOINT_TEST_ROOT
    ? path.resolve(process.env.STARTPOINT_TEST_ROOT)
    : path.resolve(__dirname, "..")
const source = fs.readFileSync(
    path.join(projectRoot, "src/cn-server.ts"),
    "utf8",
)

function extractFunction(sourceText, name) {
    const start = sourceText.indexOf(`function ${name}`)
    assert.notEqual(start, -1, `${name} must exist`)
    const bodyStart = sourceText.indexOf("{", start)
    let depth = 0
    for (let index = bodyStart; index < sourceText.length; index++) {
        if (sourceText[index] === "{") depth++
        if (sourceText[index] === "}") {
            depth--
            if (depth === 0) return sourceText.slice(start, index + 1)
        }
    }
    throw new Error(`unterminated ${name}`)
}

const functionSource = extractFunction(source, "fixUint32Tags")
const compiled = ts.transpileModule(
    `${functionSource}\nmodule.exports = fixUint32Tags`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText
const sandbox = {
    Buffer,
    module: { exports: null },
    exports: {},
    require,
}
vm.runInNewContext(compiled, sandbox)
const fixUint32Tags = sandbox.module.exports

assert.equal(typeof fixUint32Tags, "function")
assert.match(source, /fixUint32Tags\(pack\(payload\)\)/)
assert.equal((source.match(/fixUint32Tags\(pack\(payload\)\)/g) ?? []).length, 1)

const values = [
    2_147_483_647,
    2_147_483_648,
    2_426_000_000,
    4_157_600_000,
    4_294_967_296,
    9_692_180_000,
]

for (const value of values) {
    const wire = fixUint32Tags(pack(value))
    const decoded = unpack(wire)
    assert.equal(decoded, value)
    assert.ok(decoded >= 0)
    if (value >= 0x80000000 && value <= 0xffffffff) {
        assert.equal(wire[0], 0xcb, `${value} must use a client-safe float64 tag`)
    }
}

const nested = {
    score: 2_426_000_000,
    list: [4_157_600_000, 4_294_967_296, 9_692_180_000],
    bytes: Buffer.from([0xce, 0xd2, 0xaa, 0xbb, 0xcc, 0xdd]),
}
const decodedNested = unpack(fixUint32Tags(pack(nested)))
assert.equal(decodedNested.score, nested.score)
assert.deepEqual(decodedNested.list, nested.list)
assert.deepEqual(decodedNested.bytes, nested.bytes)

console.log("msgpack compatibility tests passed")
