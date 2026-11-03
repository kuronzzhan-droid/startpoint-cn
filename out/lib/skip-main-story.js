"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.skipMainStory = exports.SkipMainStoryError = void 0;
const mission_regular_json_1 = __importDefault(require("../../assets/mission_regular.json"));
const db_1 = require("../data/db");
const player_1 = require("../data/domains/player");
const character_1 = require("../data/domains/character");
const item_1 = require("../data/domains/item");
const mission_1 = require("../data/domains/mission");
const tutorial_1 = require("../data/domains/tutorial");
const content_snapshot_1 = require("../content/runtime/content-snapshot");
const assets_1 = require("./assets");
const character_2 = require("./character");
const quest_1 = require("./quest");
const main_story_rewards_1 = require("./main-story-rewards");
const stamina_1 = require("./stamina");
const persistence_coordinator_1 = require("./persistence-coordinator");
const utils_1 = require("../utils");
const settlement_1 = require("./mission/settlement");
const active_reconciliation_1 = require("./mission/active-reconciliation");
const rewards_1 = require("./types/rewards");
const chapter_story_rules_1 = require("./chapter-story-rules");
var chapter_story_rules_2 = require("./chapter-story-rules");
Object.defineProperty(exports, "SkipMainStoryError", { enumerable: true, get: function () { return chapter_story_rules_2.SkipMainStoryError; } });
/** Progress and rewards share the same write lock, including eligibility checks. */
function skipMainStory(playerId, rawCategory, rawChapter) {
    const { category, chapter } = (0, chapter_story_rules_1.parseStoryChapter)(rawCategory, rawChapter);
    return (0, persistence_coordinator_1.runPersistenceTransaction)({ domain: "player", playerId, operation: "skip_main_story_chapter" }, () => {
        var _a, _b, _c, _d, _e;
        const player = (0, player_1.getPlayerSync)(playerId);
        if (!player)
            throw new chapter_story_rules_1.SkipMainStoryError(404, "PLAYER_NOT_FOUND", "玩家存档不存在");
        // 选了「跳过教程」的号服务端 tutorialStep 停在中途（如 6），但教程抽卡已做完，也允许跳过，并顺带把教程记为完成。
        const tutorialSkippedAfterGacha = player.tutorialSkipFlag === true && player.tutorialGachaCharacterId !== null && player.tutorialGachaCharacterId !== undefined;
        if ((player.tutorialStep === null || player.tutorialStep < 17) && !tutorialSkippedAfterGacha) {
            throw new chapter_story_rules_1.SkipMainStoryError(409, "TUTORIAL_INCOMPLETE", "请先完成新手教程里的抽卡");
        }
        const db = (0, db_1.getDb)();
        const ticketsBefore = (_a = (0, item_1.getPlayerItemSync)(playerId, 999001)) !== null && _a !== void 0 ? _a : 0;
        const before = db.prepare(`SELECT section, quest_id, finished, clear_rank
            FROM players_quest_progress WHERE player_id = ? AND section IN (1, 4)`)
            .all(playerId);
        const progress = new Map(before.map(row => [`${row.section}:${row.quest_id}`, row]));
        const now = (0, utils_1.getServerDate)();
        if (category === 4 && !(0, chapter_story_rules_1.chapterIsCleared)(progress, 1, chapter)) {
            throw new chapter_story_rules_1.SkipMainStoryError(409, "NORMAL_CHAPTER_INCOMPLETE", "请先通关同章节的全部普通关卡");
        }
        if (!(0, chapter_story_rules_1.chapterIsUnlocked)(progress, category, chapter, now)) {
            throw new chapter_story_rules_1.SkipMainStoryError(409, "CHAPTER_LOCKED", "该章节尚未解锁，请先完成前置关卡并等待章节开放");
        }
        if (!(0, chapter_story_rules_1.chapterIsFullyOpen)(category, chapter, now)) {
            throw new chapter_story_rules_1.SkipMainStoryError(409, "CHAPTER_NOT_FULLY_OPEN", "本章存在尚未开放或已结束开放的关卡，暂时无法跳过整章");
        }
        const write = db.prepare(`INSERT INTO players_quest_progress
            (player_id, section, quest_id, finished, unlocked, clear_rank) VALUES (?, ?, ?, 1, 1, ?)
            ON CONFLICT(section, quest_id, player_id) DO UPDATE SET
                finished = 1, unlocked = 1,
                clear_rank = CASE WHEN excluded.clear_rank IS NULL THEN players_quest_progress.clear_rank
                    ELSE MAX(COALESCE(players_quest_progress.clear_rank, 0), excluded.clear_rank) END`);
        const rewards = [];
        let newlyCleared = 0, newlySPlus = 0, rankPoints = 0, poolExp = 0, mana = 0;
        const resolve = category === 1 ? assets_1.getMainQuestSync : assets_1.getExQuestSync;
        for (const questId of (0, chapter_story_rules_1.chapterQuestIds)(category, chapter)) {
            const quest = resolve(questId);
            if (!quest)
                throw new Error(`Missing main story quest ${category}:${questId}`);
            const old = progress.get(`${category}:${questId}`);
            const battle = quest.sPlusReward !== undefined;
            if (!(old === null || old === void 0 ? void 0 : old.finished)) {
                newlyCleared++;
                rewards.push(...(0, main_story_rewards_1.getMainStoryFirstClearRewards)(category, questId, quest));
                rankPoints += quest.rankPointReward;
                poolExp += quest.poolExpReward;
                mana += quest.manaReward;
            }
            if (battle && ((_b = old === null || old === void 0 ? void 0 : old.clear_rank) !== null && _b !== void 0 ? _b : 0) < 5) {
                newlySPlus++;
                rewards.push(quest.sPlusReward);
            }
            write.run(playerId, category, questId, battle ? 5 : null);
            progress.set(`${category}:${questId}`, { section: category, quest_id: questId, finished: 1, clear_rank: battle ? 5 : null });
        }
        // Use the same currency cap/total-obtained accounting as ordinary rewards.
        if (mana)
            rewards.push({ type: rewards_1.RewardType.MANA, count: mana });
        if (!(0, quest_1.givePlayerRewardsSync)(playerId, rewards))
            throw new Error("主线奖励发放失败");
        if (poolExp && (0, player_1.adjustPlayerExpPoolSync)(playerId, poolExp, "skip_main_story") === null) {
            throw new Error("主线经验池发放失败");
        }
        const clearedChapters = (0, chapter_story_rules_1.countClearedStoryChapters)(progress);
        const rankPointFloor = Math.floor(125636 * clearedChapters / 24);
        const rankPoint = Math.max(rankPointFloor, player.rankPoint + rankPoints);
        const rank = (0, stamina_1.getRankDegree)(rankPoint);
        const levelUp = rank > (0, stamina_1.getRankDegree)(player.rankPoint);
        // Current single-finish grants the final rank's max stamina once per settlement.
        (0, player_1.updatePlayerSync)(Object.assign({ id: playerId, rankPoint }, (player.tutorialStep === null || player.tutorialStep < 17 ? { tutorialStep: 17 } : {}), (levelUp ? { stamina: player.stamina + (0, stamina_1.getMaxStamina)(rank), staminaHealTime: new Date() } : {})));
        const joinedCharacters = [];
        for (const characterId of (0, chapter_story_rules_1.chapterJoinedCharacters)(category, chapter)) {
            if ((0, character_1.getPlayerCharacterSync)(playerId, characterId))
                continue;
            if (!(0, character_2.givePlayerCharacterSync)(playerId, characterId))
                throw new Error(`剧情角色 ${characterId} 发放失败`);
            joinedCharacters.push(characterId);
        }
        if (category === 1 && chapter === 1 && !(0, tutorial_1.getPlayerTriggeredTutorialsSync)(playerId).includes(10)) {
            (0, tutorial_1.insertPlayerTriggeredTutorialSync)(playerId, 10);
        }
        const regular = (0, mission_1.getPlayerCategoryMissionsSync)(playerId, 1);
        for (const id of [...Array.from({ length: 14 }, (_, index) => 42 + index), 93]) {
            const definition = mission_regular_json_1.default[id][0];
            if (category !== 1 || Number(definition[8]) !== chapter)
                continue;
            if (((_d = (_c = regular[id]) === null || _c === void 0 ? void 0 : _c.progress) !== null && _d !== void 0 ? _d : 0) < 1)
                (0, mission_1.updatePlayerCategoryMissionSync)(playerId, 1, id, 1);
        }
        // No invented battle counters: daily and all-clear missions keep their actual battle facts.
        const missions = (0, settlement_1.settleMissionCategories)(playerId, [1, 5], now);
        const active = (0, active_reconciliation_1.reconcileActiveMissionFacts)({ playerId, repository: (0, content_snapshot_1.getContentSnapshot)().repository, now });
        const after = (0, player_1.getPlayerSync)(playerId);
        return { ok: true, category, chapter, clearedChapters, rankPointFloor,
            message: newlyCleared ? `已跳过第 ${chapter} 章${category === 1 ? "普通" : "高难"}，通关奖励已发放` : "本章已通关，已核对补齐缺少的通关奖励",
            newlyCleared, newlySPlus, joinedCharacters, rank,
            ticketsAdded: ((_e = (0, item_1.getPlayerItemSync)(playerId, 999001)) !== null && _e !== void 0 ? _e : 0) - ticketsBefore,
            rankPoint, rankPointAdded: rankPoint - player.rankPoint, questRankPoints: rankPoints,
            poolExpAdded: after.expPool - player.expPool, manaAdded: after.freeMana - player.freeMana,
            beadsAdded: after.freeVmoney - player.freeVmoney,
            missionRewards: missions.missionInfo, degreeIds: missions.degreeIds, activeMissionChanges: active, };
    });
}
exports.skipMainStory = skipMainStory;
