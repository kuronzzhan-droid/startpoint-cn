const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const zlib = require("node:zlib")

const {
    ADVENT_EVENT_LOGICAL,
    ADVENT_EVENT_QUEST_LOGICAL,
    findRuntimeUpload,
    hashedRelativePath,
    readAdventMaster,
    writeAdventExport,
} = require("./export_advent_master.cjs")
const { serializeOrderedMap, uint32LE } = require("./orderedmap_serializer.cjs")

function csvRow(values, length = 132) {
    const row = Array(length).fill("")
    for (const [index, value] of Object.entries(values)) row[Number(index)] = String(value)
    return row.map(value => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join(",")
}

function serializeRawOrderedMap(entries) {
    const sorted = [...entries].sort((left, right) => Number(left.key) - Number(right.key))
    const keys = sorted.map(entry => Buffer.from(entry.key, "utf8"))
    const rows = sorted.map(entry => Buffer.from(entry.row))
    let keyEnd = 0
    let rowEnd = 0
    const pairs = sorted.map((_, index) => {
        keyEnd += keys[index].length
        rowEnd += rows[index].length
        return Buffer.concat([uint32LE(keyEnd), uint32LE(rowEnd)])
    })
    const index = zlib.deflateSync(Buffer.concat([
        uint32LE(sorted.length),
        ...pairs,
        ...keys,
    ]))
    return Buffer.concat([uint32LE(index.length), index, ...rows])
}

function writeTable(store, logicalPath, contents) {
    const target = path.join(store, hashedRelativePath(logicalPath))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, contents)
}

function createRuntimeFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "advent-runtime-"))
    const store = path.join(root, "WorldFlipper", "dummy", "download", "production", "upload")
    const eventRow = csvRow({
        0: "boss_epuration",
        2: "歼灭者讨伐战",
        17: 10000070,
        18: 10000071,
        24: "2025-06-26 12:00:00",
    }, 27)
    const questRows = [
        { key: "1", row: csvRow({
            0: 200076001,
            2: "向星星许愿",
            52: 0,
            130: "story/advent_event/boss_epuration/boss_epuration_event_001/scenario",
        }) },
        { key: "2", row: csvRow({
            0: 200076002,
            2: "步兵歼灭者 ::quest_rank::",
            7: 0,
            11: 200076001,
            52: 1,
            53: 2,
            75: 20,
            76: 11000483,
            78: 5,
            90: 246,
            91: 201,
            92: 156,
            93: 120,
            94: 1,
            95: 1,
            96: 2,
            97: 3,
            98: 4,
            99: 1013,
            100: 2435,
            101: 2490,
            102: 2435,
        }) },
        { key: "7", row: csvRow({
            0: 200076007,
            7: 0,
            11: 200076005,
            12: 0,
            16: 200076006,
            52: 0,
        }) },
        { key: "9", row: csvRow({
            0: 200076009,
            52: 1,
            53: 0,
            61: 1,
            125: 0,
        }) },
    ]
    writeTable(store, ADVENT_EVENT_LOGICAL, serializeOrderedMap([{ key: "200076", row: eventRow }]))
    writeTable(store, ADVENT_EVENT_QUEST_LOGICAL, serializeRawOrderedMap([{
        key: "200076",
        row: serializeOrderedMap(questRows),
    }]))
    return { root, store }
}

test("advent master export reads a self-contained runtime fixture", () => {
    const fixture = createRuntimeFixture()
    try {
        assert.equal(findRuntimeUpload(fixture.root), fixture.store)
        assert.equal(
            hashedRelativePath(ADVENT_EVENT_LOGICAL),
            path.join("c7", "428142e8bf6ca3dcd9445f67d0c882765710c7"),
        )
        assert.equal(
            hashedRelativePath(ADVENT_EVENT_QUEST_LOGICAL),
            path.join("6b", "ef338822b2c963eb40c67b3d43a3b3f911ad73"),
        )

        const master = readAdventMaster({ root: fixture.root })
        const event = master.events["200076"]
        const story = master.quests["200076001"]
        const soldier = master.quests["200076002"]
        const chapter2 = master.quests["200076007"]
        const empress = master.quests["200076009"]

        assert.equal(event.name, "歼灭者讨伐战")
        assert.equal(event.startTime, "2025-06-26 12:00:00")
        assert.deepEqual(event.dropItemIdList, [10000070, 10000071])
        assert.equal(story.kind, "story")
        assert.equal(story.name, "向星星许愿")
        assert.equal(story.story.scenarioPath, "story/advent_event/boss_epuration/boss_epuration_event_001/scenario")
        assert.deepEqual(story.viewableNeedQuests, [])
        assert.deepEqual(story.selectableNeedQuests, [])
        assert.equal(soldier.kind, "battle")
        assert.equal(soldier.eventId, 200076)
        assert.equal(soldier.subId, 2)
        assert.equal(soldier.name, "步兵歼灭者 ::quest_rank::")
        assert.deepEqual(soldier.viewableNeedQuests.map(quest => quest.id), [200076001])
        assert.deepEqual(soldier.selectableNeedQuests, [])
        assert.equal(soldier.battle.availablePlayKind, 2)
        assert.equal(soldier.battle.staminaCost, 20)
        assert.equal(soldier.battle.scoreRewardGroupId, 11000483)
        assert.equal(soldier.battle.recommendedElement, 5)
        assert.deepEqual(soldier.battle.rankTimesMs, { b: 246000, a: 201000, s: 156000, ss: 120000 })
        assert.deepEqual(soldier.battle.rankItemCounts, { c: 1, b: 1, a: 2, s: 3, ss: 4 })
        assert.deepEqual(soldier.battle.rewards, { rankPoint: 1013, characterExp: 2435, mana: 2490, poolExp: 2435 })
        assert.deepEqual(chapter2.viewableNeedQuests.map(quest => quest.id), [200076005, 200076006])
        assert.equal(empress.battle.availablePlayKind, 0)
        assert.equal(empress.battle.startableUseItemMode, 1)
        assert.equal(empress.battle.maxContinueCount, 0)
        assert.deepEqual(master.questsByEvent["200076"], [200076001, 200076002, 200076007, 200076009])
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true })
    }
})

test("advent master export writes stable JSON artifacts", () => {
    const fixture = createRuntimeFixture()
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "advent-export-"))
    try {
        const written = writeAdventExport(readAdventMaster({ store: fixture.store }), outDir)
        assert.equal(path.basename(written.eventsPath), "advent_event.json")
        assert.equal(path.basename(written.questsPath), "advent_event_quest_full.json")
        assert.equal(JSON.parse(fs.readFileSync(written.eventsPath, "utf8"))["200076"].name, "歼灭者讨伐战")
        assert.equal(JSON.parse(fs.readFileSync(written.questsPath, "utf8"))["200076009"].battle.maxContinueCount, 0)
    } finally {
        fs.rmSync(outDir, { recursive: true, force: true })
        fs.rmSync(fixture.root, { recursive: true, force: true })
    }
})
