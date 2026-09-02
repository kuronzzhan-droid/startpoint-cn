import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import {
    FIVE_BOSS_GAUNTLET,
    isFiveBossGauntletQuest,
} from "../multi/five-boss/contract"
import { QuestCategory } from "../lib/types"


test("server contract stays aligned with the package route profile", () => {
    const profilePath = path.join(process.cwd(), "mod-tools", "five_boss_coop_v1.json")
    const profile = JSON.parse(readFileSync(profilePath, "utf8")) as {
        route_id: string
        ticket_item_id: string
        ai_fill_timeout_seconds: number
        scenes: Array<{ source_fields: string[] }>
    }

    assert.equal(FIVE_BOSS_GAUNTLET.routeId, profile.route_id)
    assert.equal(FIVE_BOSS_GAUNTLET.ticketItemId, Number(profile.ticket_item_id))
    assert.equal(FIVE_BOSS_GAUNTLET.aiFillTimeoutMs, profile.ai_fill_timeout_seconds * 1000)
    assert.deepEqual(FIVE_BOSS_GAUNTLET.sceneBossCounts, profile.scenes.map(scene => scene.source_fields.length))
});


test("only the visible BossBattle quest activates the special runtime", () => {
    assert.equal(
        isFiveBossGauntletQuest(QuestCategory.BOSS_BATTLE, FIVE_BOSS_GAUNTLET.visibleQuestId),
        true,
    )
    assert.equal(
        isFiveBossGauntletQuest(QuestCategory.BOSS_BATTLE, FIVE_BOSS_GAUNTLET.hiddenQuestIds[0]),
        false,
    )
    assert.equal(isFiveBossGauntletQuest(QuestCategory.MAIN, FIVE_BOSS_GAUNTLET.visibleQuestId), false)
    assert.equal(isFiveBossGauntletQuest(QuestCategory.BOSS_BATTLE, "1099001"), false)
});


test("the route contract is fixed to two full scenes and three room members", () => {
    assert.deepEqual(FIVE_BOSS_GAUNTLET.sceneBossCounts, [3, 2])
    assert.equal(FIVE_BOSS_GAUNTLET.roomMemberLimit, 3)
    assert.equal(FIVE_BOSS_GAUNTLET.hiddenQuestIds.length, 2)
});

