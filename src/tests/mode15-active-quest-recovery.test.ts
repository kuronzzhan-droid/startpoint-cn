import assert from "node:assert/strict"
import { test } from "node:test"

import { shouldResetMode15RunForStaleActiveQuest } from "../lib/mode15-active-quest-recovery"

test("single-player stale mode15 quests reset the player's run", () => {
    assert.equal(shouldResetMode15RunForStaleActiveQuest(true, {
        isMulti: false,
        isMultiHost: false,
    }), true)
})

test("multiplayer hosts reset stale mode15 runs", () => {
    assert.equal(shouldResetMode15RunForStaleActiveQuest(true, {
        isMulti: true,
        isMultiHost: true,
    }), true)
})

test("multiplayer guests keep their mode15 progress during reconnect cleanup", () => {
    assert.equal(shouldResetMode15RunForStaleActiveQuest(true, {
        isMulti: true,
        isMultiHost: false,
    }), false)
})

test("non-mode15 stale quests never reset mode15 progress", () => {
    assert.equal(shouldResetMode15RunForStaleActiveQuest(false, {
        isMulti: false,
        isMultiHost: false,
    }), false)
})
