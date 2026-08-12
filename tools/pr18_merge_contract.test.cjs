const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const routePath = path.join(__dirname, "..", "src", "routes", "api", "singleBattleQuest.ts");
const routeSource = fs.readFileSync(routePath, "utf8");
const multiRoutePath = path.join(__dirname, "..", "src", "multi", "http", "battle.ts");
const multiRouteSource = fs.readFileSync(multiRoutePath, "utf8");

test("single battle enforces Advent start, entry, stamina, and continue rules", () => {
    assert.ok(
        /const\s+prerequisiteCheck\s*=\s*canStartQuestByPrerequisites\s*\([\s\S]{0,500}?if\s*\(\s*!prerequisiteCheck\.ok\s*\)\s*\{?[\s\S]{0,200}?return\s+reply\.status\(400\)\.send\s*\(/.test(routeSource),
        "Advent prerequisite enforcement must survive the main merge",
    );
    assert.ok(
        /const\s+entryCost\s*=\s*resolveBattleStartEntryCost\s*\(\s*questData\s*,\s*configuredEntryCost\s*\)/.test(routeSource)
            && /const\s+staminaCost\s*=\s*resolveBattleStartStaminaCost\s*\(\s*questData\s*,\s*staminaInfo\s*\)/.test(routeSource),
        "entry-item and stamina cost resolvers must be called by the start path",
    );
    assert.ok(
        /const\s+continueCheck\s*=\s*canContinueBattle\s*\(\s*questData\s*,\s*activeQuestData\.continueCount\s*\)[\s\S]{0,120}?if\s*\(\s*!continueCheck\.ok\s*\)[\s\S]{0,120}?reply\.status\(400\)\.send\s*\(/.test(routeSource),
        "continue rules must reject disallowed continues",
    );
});

test("single battle keeps dynamic Rush rounds and all Rogue response integrations", () => {
    assert.ok(
        /const\s+derivedFolderMaxRounds\s*=\s*getRushEventFolderMaxRounds\s*\(\s*questData\.rushEventId\s*\?\?\s*0\s*\)/.test(routeSource)
            && /handleRushEventFinish\s*\(\s*\{[\s\S]{0,500}?folderMaxRounds:\s*derivedFolderMaxRounds/.test(routeSource)
            && /handleRoguePerRoundDrops\s*\(\s*\{[\s\S]{0,250}?folderMaxRounds:\s*derivedFolderMaxRounds/.test(routeSource),
        "dynamic Rush max rounds must feed both Rush completion and Rogue drops",
    );
    assert.ok(
        /rushEventData\.rush_battle_reward_list\s*=\s*\[[\s\S]{0,200}?\.\.\.rogueDrops\.rewardListEntries[\s\S]{0,80}?\]/.test(routeSource),
        "Rogue reward-list entries must be returned to the client",
    );
    assert.ok(
        /const\s+itemList\s*=\s*\{[\s\S]{0,350}?\.\.\.\(rogueDrops\?\.rewardResult\.items\s*\?\?\s*\{\}\)/.test(routeSource)
            && /"character_list"\s*:\s*\[[\s\S]{0,650}?\.\.\.\(rogueDrops\?\.rewardResult\.character_list\s*\|\|\s*\[\]\)/.test(routeSource)
            && /"equipment_list"\s*:\s*\[[\s\S]{0,450}?\.\.\.\(rogueDrops\?\.rewardResult\.equipment_list\s*\|\|\s*\[\]\)/.test(routeSource),
        "Rogue item, character, and equipment results must be integrated into the finish response",
    );
    assert.match(
        routeSource,
        /"exp_pool"\s*:\s*\(\s*rogueDrops\?\.expPoolAbsolute\s*\?\?\s*rewardCharacterExpResult\.exp_pool\s*\)/,
        "Rogue absolute pool EXP must override the ordinary pool total",
    );
    assert.match(
        routeSource,
        /\.\.\.\(\s*rogueDrops\?\.addExpList\s*\|\|\s*\[\]\s*\)/,
        "Rogue add-EXP entries must be included in add_exp_list",
    );
    assert.match(
        routeSource,
        /\.\.\.\(\s*rogueDrops\?\.expCharacterList\s*\|\|\s*\[\]\s*\)/,
        "Rogue EXP-updated characters must be included in character_list",
    );
    assert.match(
        routeSource,
        /\.\.\.\(\s*rogueDrops\?\.bondTokenStatusList\s*\|\|\s*\{\}\s*\)/,
        "Rogue bond-token status changes must be included in the response",
    );
});

test("single battle records summarized party mission dimensions", () => {
    assert.ok(
        /const\s+singleBattleParty\s*=\s*collectPartyCharacterIds\s*\(\s*finishCtx\.party\s*\)[\s\S]{0,120}?recordBattleMissionDimensionsSafe\s*\(\s*\{[\s\S]{0,350}?mode:\s*"single"[\s\S]{0,250}?\.\.\.singleBattleParty\s*,[\s\S]{0,120}?statistics:\s*summarizeBattleStatistics\s*\(\s*finishCtx\.statistics\s*\)/.test(routeSource),
        "single completion must send collected party ids and summarized statistics to the safe writer",
    );
});

test("multiplayer battle enforces Advent prerequisites and records mission dimensions", () => {
    assert.ok(
        /const\s+prerequisiteCheck\s*=\s*canStartQuestByPrerequisites\s*\([\s\S]{0,500}?if\s*\(\s*!prerequisiteCheck\.ok\s*\)\s*\{?[\s\S]{0,180}?return\s+reply\.status\(400\)\.send\s*\(/.test(multiRouteSource),
        "multiplayer Advent prerequisite rejection must survive the main merge",
    );
    assert.ok(
        /const\s+multiBattleParty\s*=\s*collectPartyCharacterIds\s*\(\s*finishCtx\.party\s*\)[\s\S]{0,120}?recordBattleMissionDimensionsSafe\s*\(\s*\{[\s\S]{0,380}?mode:\s*"multi"[\s\S]{0,300}?\.\.\.multiBattleParty\s*,[\s\S]{0,120}?statistics:\s*summarizeBattleStatistics\s*\(\s*finishCtx\.statistics\s*\)/.test(multiRouteSource),
        "multiplayer completion must send collected party ids and summarized statistics to the safe writer",
    );
    assert.match(
        multiRouteSource,
        /givePlayerScoreRewardsSync\s*\(\s*playerId\s*,\s*\(questData as any\)\.scoreRewardGroupId\s*\|\|\s*0\s*,\s*\(questData as any\)\.scoreRewardGroup\s*,\s*useBoostPoint\s*,\s*\(questData as any\)\.element\s*,\s*\{\s*clearRank\s*,\s*rankItemCounts:\s*\(questData as any\)\.rankItemCounts\s*,?\s*\}\s*\)/,
        "multiplayer score rewards must receive rank-specific item counts",
    );
});

test("single and multiplayer finish activate the atomic mission fact facade once", () => {
    for (const [label, source] of [["single", routeSource], ["multi", multiRouteSource]]) {
        assert.equal(
            (source.match(/recordMissionBattleFacts\s*\(/g) || []).length,
            1,
            `${label} finish must call the aggregate exactly once`,
        );
        for (const directTracker of [
            "trackCharacterClears",
            "trackLeaderPowerflip",
            "trackPartyCoClears",
            "trackPowerflip",
        ]) {
            assert.equal(source.includes(`${directTracker}(`), false,
                `${label} route must not duplicate ${directTracker}`);
        }
        assert.ok(
            source.indexOf("recordMissionBattleFacts(") < source.indexOf("delete activeQuests["),
            `${label} finish must not consume the active quest before fact recording succeeds`,
        );
    }
    assert.doesNotMatch(
        multiRouteSource,
        /UPDATE\s+players_quest_progress\s+SET\s+multi_clear_count/i,
        "the aggregate owns multi-clear increments",
    );
});

test("multiplayer host identity is captured at start and reused after restart", () => {
    assert.match(
        multiRouteSource,
        /insertActiveQuest\s*\([\s\S]{0,500}?isMultiHost:\s*room\.host_player_id\s*===\s*ctx\.playerId/,
    );
    assert.match(
        multiRouteSource,
        /const\s+finishCtx:\s*FinishContext\s*=\s*\{[\s\S]{0,500}?isMultiHost:\s*activeQuestData\.isMultiHost/,
    );
    assert.match(
        multiRouteSource,
        /resolveActiveQuest\s*\(\s*\{[\s\S]{0,300}?allowRebuild:\s*false/,
        "multiplayer finish must recover the persisted quest without minting one from the request body",
    );
    assert.match(
        routeSource,
        /insertPlayerActiveQuestSync\s*\([\s\S]{0,400}?isMultiHost:\s*quest\.isMultiHost/,
    );
});
