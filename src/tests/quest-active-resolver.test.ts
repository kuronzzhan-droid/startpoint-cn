import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-quest-resolver-"));
process.env.WF_DATABASE_DIR = databaseDir;

const { resolveActiveQuest, resolveRebuildCategory, isStrictFinishMode } =
    require("../lib/quest/finish/active-quest-resolver") as typeof import("../lib/quest/finish/active-quest-resolver");
const { QuestCategory } = require("../lib/types") as typeof import("../lib/types");
import type { ActiveQuest } from "../routes/api/singleBattleQuest";
import type { BattleQuest } from "../lib/types";
import type { PlayerActiveQuest } from "../data/types";

const PLAYER_ID = 1;
/** The client numbers rush battles 18; the server enum reserves 18 for WORLD_STORY_EVENT. */
const CLIENT_RUSH_CATEGORY = 18;
const RUSH_QUEST_ID = 700099;
const MAIN_QUEST_ID = 1010101;

function battleQuest(overrides: Partial<BattleQuest> = {}): BattleQuest {
    return { rankPointReward: 10, ...overrides } as BattleQuest;
}

/** Only the listed `category_questId` pairs exist, so lookups miss like the real tables do. */
function questTable(entries: Record<string, BattleQuest>) {
    return (category: number, questId: number) => entries[`${category}_${questId}`] ?? null;
}

function persistedRow(overrides: Partial<PlayerActiveQuest> = {}): PlayerActiveQuest {
    return {
        playerId: PLAYER_ID,
        playId: "play-db",
        questId: MAIN_QUEST_ID,
        category: QuestCategory.MAIN,
        useBossBoostPoint: true,
        useBoostPoint: false,
        isAutoStartMode: true,
        isMulti: false,
        isMultiHost: true,
        roomNumber: null,
        entryItemId: 7,
        eventId: null,
        continueCount: 2,
        ...overrides,
    };
}

const mainQuestOnly = questTable({ [`${QuestCategory.MAIN}_${MAIN_QUEST_ID}`]: battleQuest() });


test("a live registration wins and is returned untouched", () => {
    const registered: ActiveQuest = {
        questId: MAIN_QUEST_ID,
        category: QuestCategory.MAIN,
        useBossBoostPoint: true,
        useBoostPoint: true,
        isAutoStartMode: false,
        isMulti: false,
        entryItemId: 42,
        playId: "play-memory",
        continueCount: 3,
    };
    const memory = { [PLAYER_ID]: registered };

    // A mismatched body must not disturb the start→finish path that rush relies on.
    const resolved = resolveActiveQuest({
        playerId: PLAYER_ID,
        hint: { quest_id: 999, category: 999 },
        memory,
        readPersisted: () => assert.fail("must not read the database on a memory hit"),
        findQuest: () => assert.fail("must not look up quests on a memory hit"),
    });

    assert.equal(resolved?.source, "memory");
    assert.equal(resolved?.quest, registered);
});

test("a restart falls back to the persisted row and rehydrates memory", () => {
    const memory: Record<number, ActiveQuest> = {};
    const resolved = resolveActiveQuest({
        playerId: PLAYER_ID,
        hint: { quest_id: MAIN_QUEST_ID, category: QuestCategory.MAIN },
        memory,
        readPersisted: () => persistedRow(),
        findQuest: mainQuestOnly,
    });

    assert.equal(resolved?.source, "database");
    assert.equal(resolved?.quest.questId, MAIN_QUEST_ID);
    assert.equal(resolved?.quest.useBossBoostPoint, true);
    assert.equal(resolved?.quest.entryItemId, 7);
    assert.equal(resolved?.quest.playId, "play-db");
    assert.equal(resolved?.quest.continueCount, 2);
    assert.equal(resolved?.quest.isMultiHost, true);
    // Nulls from the row become undefined so optional ActiveQuest fields stay absent.
    assert.equal(resolved?.quest.roomNumber, undefined);
    assert.equal(resolved?.quest.eventId, undefined);
    assert.equal(memory[PLAYER_ID], resolved?.quest);
});

test("a client that skipped start gets a rebuilt quest that reserves nothing", () => {
    const memory: Record<number, ActiveQuest> = {};
    const resolved = resolveActiveQuest({
        playerId: PLAYER_ID,
        hint: { quest_id: MAIN_QUEST_ID, category: QuestCategory.MAIN, continue_count: 1 },
        memory,
        readPersisted: () => null,
        findQuest: mainQuestOnly,
    });

    assert.equal(resolved?.source, "rebuilt");
    assert.equal(resolved?.quest.questId, MAIN_QUEST_ID);
    assert.equal(resolved?.quest.category, QuestCategory.MAIN);
    assert.equal(resolved?.quest.continueCount, 1);
    // No boost point was reserved at start, so finish must not consume one.
    assert.equal(resolved?.quest.useBoostPoint, false);
    assert.equal(resolved?.quest.useBossBoostPoint, false);
    assert.equal(resolved?.quest.entryItemId, undefined);
    assert.equal(resolved?.quest.isMulti, false);
    // A rebuild is not a registration; nothing is cached behind the caller's back.
    assert.equal(memory[PLAYER_ID], undefined);
});

test("a rebuilt rush battle resolves to the server category, not the client's 18", () => {
    const resolved = resolveActiveQuest({
        playerId: PLAYER_ID,
        hint: { quest_id: RUSH_QUEST_ID, category: CLIENT_RUSH_CATEGORY },
        memory: {},
        readPersisted: () => null,
        findQuest: questTable({ [`${QuestCategory.RUSH_EVENT}_${RUSH_QUEST_ID}`]: battleQuest({ rushEventId: 7 }) }),
    });

    assert.equal(resolved?.source, "rebuilt");
    assert.equal(resolved?.quest.category, QuestCategory.RUSH_EVENT);
});

test("category 18 still means world story when the quest exists there", () => {
    const worldStoryQuestId = 180001;
    const resolved = resolveRebuildCategory(
        QuestCategory.WORLD_STORY_EVENT,
        worldStoryQuestId,
        questTable({
            [`${QuestCategory.WORLD_STORY_EVENT}_${worldStoryQuestId}`]: battleQuest(),
            [`${QuestCategory.RUSH_EVENT}_${worldStoryQuestId}`]: battleQuest(),
        })
    );

    assert.equal(resolved?.category, QuestCategory.WORLD_STORY_EVENT);
});

test("a rebuilt raid battle carries the event id its handler needs", () => {
    const raidQuestId = 230001;
    const resolved = resolveActiveQuest({
        playerId: PLAYER_ID,
        hint: { quest_id: raidQuestId, category: 99 },
        memory: {},
        readPersisted: () => null,
        findQuest: questTable({ [`${QuestCategory.RAID_EVENT}_${raidQuestId}`]: battleQuest({ eventId: 55 }) }),
    });

    assert.equal(resolved?.quest.category, QuestCategory.RAID_EVENT);
    assert.equal(resolved?.quest.eventId, 55);
});

test("a leftover row for another quest loses to the quest being finished", () => {
    const memory: Record<number, ActiveQuest> = {};
    const resolved = resolveActiveQuest({
        playerId: PLAYER_ID,
        hint: { quest_id: MAIN_QUEST_ID, category: QuestCategory.MAIN },
        memory,
        readPersisted: () => persistedRow({ questId: 1020202, entryItemId: 999 }),
        findQuest: mainQuestOnly,
    });

    assert.equal(resolved?.source, "rebuilt");
    assert.equal(resolved?.quest.questId, MAIN_QUEST_ID);
    assert.equal(resolved?.quest.entryItemId, undefined);
});

test("a leftover row is still used when the body names no known quest", () => {
    const resolved = resolveActiveQuest({
        playerId: PLAYER_ID,
        hint: { quest_id: 404404, category: QuestCategory.MAIN },
        memory: {},
        readPersisted: () => persistedRow(),
        findQuest: mainQuestOnly,
    });

    assert.equal(resolved?.source, "database");
    assert.equal(resolved?.quest.questId, MAIN_QUEST_ID);
});

test("an unknown quest is refused rather than rebuilt", () => {
    const resolved = resolveActiveQuest({
        playerId: PLAYER_ID,
        hint: { quest_id: 404404, category: 404 },
        memory: {},
        readPersisted: () => null,
        findQuest: mainQuestOnly,
    });

    assert.equal(resolved, null);
});

test("quest data without battle fields is not accepted as a rebuild target", () => {
    const storyQuestId = 500001;
    const resolved = resolveActiveQuest({
        playerId: PLAYER_ID,
        hint: { quest_id: storyQuestId, category: QuestCategory.MAIN },
        memory: {},
        readPersisted: () => null,
        // A story quest has no rankPointReward, which finish dereferences unconditionally.
        findQuest: questTable({ [`${QuestCategory.MAIN}_${storyQuestId}`]: {} as BattleQuest }),
    });

    assert.equal(resolved, null);
});

test("strict mode keeps the old 400 when nothing is registered", () => {
    const resolved = resolveActiveQuest({
        playerId: PLAYER_ID,
        hint: { quest_id: MAIN_QUEST_ID, category: QuestCategory.MAIN },
        memory: {},
        allowRebuild: false,
        readPersisted: () => null,
        findQuest: mainQuestOnly,
    });

    assert.equal(resolved, null);
});

test("strict mode still recovers a persisted battle across a restart", () => {
    const resolved = resolveActiveQuest({
        playerId: PLAYER_ID,
        hint: { quest_id: MAIN_QUEST_ID, category: QuestCategory.MAIN },
        memory: {},
        allowRebuild: false,
        readPersisted: () => persistedRow(),
        findQuest: mainQuestOnly,
    });

    assert.equal(resolved?.source, "database");
});

test("QUEST_FINISH_STRICT gates the rebuild and defaults to off", () => {
    const original = process.env.QUEST_FINISH_STRICT;
    try {
        delete process.env.QUEST_FINISH_STRICT;
        assert.equal(isStrictFinishMode(), false);

        for (const value of ["1", "true", "TRUE", " yes "]) {
            process.env.QUEST_FINISH_STRICT = value;
            assert.equal(isStrictFinishMode(), true, `expected ${JSON.stringify(value)} to enable strict mode`);
        }
        for (const value of ["0", "false", ""]) {
            process.env.QUEST_FINISH_STRICT = value;
            assert.equal(isStrictFinishMode(), false, `expected ${JSON.stringify(value)} to leave strict mode off`);
        }

        process.env.QUEST_FINISH_STRICT = "true";
        const resolved = resolveActiveQuest({
            playerId: PLAYER_ID,
            hint: { quest_id: MAIN_QUEST_ID, category: QuestCategory.MAIN },
            memory: {},
            readPersisted: () => null,
            findQuest: mainQuestOnly,
        });
        assert.equal(resolved, null);
    } finally {
        if (original === undefined) delete process.env.QUEST_FINISH_STRICT;
        else process.env.QUEST_FINISH_STRICT = original;
    }
});
