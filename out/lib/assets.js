"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEquipmentAwakeningRulesSync = exports.getEquipmentCraftSync = exports.getItemSaleSync = exports.getEquipmentDissolveSync = exports.getStaminaRecoverySeconds = exports.getConfigSync = exports.getEquipmentElement = exports.getEquipmentMaxLevel = exports.getRogueEventConfig = exports.getRushEventFolderClearRewards = exports.getShopItemSync = exports.getBossCoinShopItemsSync = exports.getEventShopItemsSync = exports.getGenericShopItemsSync = exports.getGachaCampaignIdSync = exports.getGachaSync = exports.getBoxGachaSync = exports.getExBoostItemSync = exports.getExStatusPoolSync = exports.getExAbilityPoolsSync = exports.getManaNodeAwakeCost = exports.getCharacterManaNodeSync = exports.getCharacterManaBoardCountSync = exports.getCharacterManaNodesSync = exports.getCharacterDataSync = exports.getQuestFromCategorySync = exports.getHardMultiEventQuest = exports.getAdventEventQuest = exports.getWorldStoryEventBossBattleQuestSync = exports.getWorldStoryEventQuestSync = exports.getCharacterQuestSync = exports.getBossBattleQuestSync = exports.getPracticeQuestSync = exports.getExQuestSync = exports.getMainQuestSync = exports.getRushEventFolderMaxRoundSync = exports.getScoreRewardGroup = exports.getRareScoreRewardGroup = exports.getClearRewardSync = exports.reloadRogueEventConfig = void 0;
const advent_event_quest_json_1 = __importDefault(require("../../assets/advent_event_quest.json"));
const abyss_modes_1 = require("./abyss-modes");
const box_gacha_json_1 = __importDefault(require("../../assets/box_gacha.json"));
const box_reward_json_1 = __importDefault(require("../../assets/box_reward.json"));
const character_quest_json_1 = __importDefault(require("../../assets/character_quest.json"));
const clear_reward_json_1 = __importDefault(require("../../assets/clear_reward.json"));
const daily_exp_mana_event_quest_json_1 = __importDefault(require("../../assets/daily_exp_mana_event_quest.json"));
const daily_week_event_quest_json_1 = __importDefault(require("../../assets/daily_week_event_quest.json"));
const world_story_event_boss_battle_quest_json_1 = __importDefault(require("../../assets/world_story_event_boss_battle_quest.json"));
const world_story_event_quest_json_1 = __importDefault(require("../../assets/world_story_event_quest.json"));
const carnival_event_quest_json_1 = __importDefault(require("../../assets/carnival_event_quest.json"));
const challenge_dungeon_event_quest_json_1 = __importDefault(require("../../assets/challenge_dungeon_event_quest.json"));
const expert_single_event_quest_json_1 = __importDefault(require("../../assets/expert_single_event_quest.json"));
const raid_event_quest_json_1 = __importDefault(require("../../assets/raid_event_quest.json"));
const ranking_event_single_quest_json_1 = __importDefault(require("../../assets/ranking_event_single_quest.json"));
const rush_event_quest_json_1 = __importDefault(require("../../assets/rush_event_quest.json"));
const score_attack_event_quest_json_1 = __importDefault(require("../../assets/score_attack_event_quest.json"));
const solo_time_attack_event_quest_json_1 = __importDefault(require("../../assets/solo_time_attack_event_quest.json"));
const story_event_single_quest_json_1 = __importDefault(require("../../assets/story_event_single_quest.json"));
const tower_dungeon_event_quest_json_1 = __importDefault(require("../../assets/tower_dungeon_event_quest.json"));
const hard_multi_event_quest_json_1 = __importDefault(require("../../assets/hard_multi_event_quest.json"));
const ex_ability_json_1 = __importDefault(require("../../assets/ex_ability.json"));
const ex_boost_json_1 = __importDefault(require("../../assets/ex_boost.json"));
const ex_quest_json_1 = __importDefault(require("../../assets/ex_quest.json"));
const ex_status_json_1 = __importDefault(require("../../assets/ex_status.json"));
const main_quest_json_1 = __importDefault(require("../../assets/main_quest.json"));
const practice_quest_json_1 = __importDefault(require("../../assets/practice_quest.json"));
const mana_node_awake_json_1 = __importDefault(require("../../assets/mana_node_awake.json"));
const mana_board_json_1 = __importDefault(require("../../assets/mana_board.json"));
const mana_board_cnmod_json_1 = __importDefault(require("../../assets/mana_board_cnmod.json"));
const rare_score_reward_json_1 = __importDefault(require("../../assets/rare_score_reward.json"));
const score_reward_json_1 = __importDefault(require("../../assets/score_reward.json"));
const gacha_campaign_json_1 = __importDefault(require("../../assets/gacha_campaign.json"));
const boss_coin_shop_json_1 = __importDefault(require("../../assets/boss_coin_shop.json"));
const boss_coin_shop_item_category_map_json_1 = __importDefault(require("../../assets/boss_coin_shop_item_category_map.json"));
const general_shop_json_1 = __importDefault(require("../../assets/general_shop.json"));
const star_grain_shop_json_1 = __importDefault(require("../../assets/star_grain_shop.json"));
const treasure_shop_json_1 = __importDefault(require("../../assets/treasure_shop.json"));
const equipment_enhancement_shop_json_1 = __importDefault(require("../../assets/equipment_enhancement_shop.json"));
const rush_event_quest_folder_json_1 = __importDefault(require("../../assets/rush_event_quest_folder.json"));
const config_json_1 = __importDefault(require("../../assets/config.json"));
const equipment_dissolve_json_1 = __importDefault(require("../../assets/equipment_dissolve.json"));
const item_sale_json_1 = __importDefault(require("../../assets/item_sale.json"));
const equipment_craft_json_1 = __importDefault(require("../../assets/equipment_craft.json"));
const equipment_max_level_json_1 = __importDefault(require("../../assets/equipment_max_level.json"));
const equipment_element_json_1 = __importDefault(require("../../assets/equipment_element.json"));
const equipment_awakening_material_json_1 = __importDefault(require("../../assets/equipment_awakening_material.json"));
const equipment_awakening_rules_1 = require("./equipment-awakening-rules");
const fs_1 = require("fs");
const path_1 = require("path");
const types_1 = require("./types");
const content_master_1 = require("./content-master");
const rogue_drop_schedule_1 = require("./quest/finish/rogue-drop-schedule");
const boss_tables_1 = require("./boss/boss-tables");
const rare_score_reward_cnmod_json_1 = __importDefault(require("../../assets/rare_score_reward_cnmod.json"));
const score_reward_cnmod_json_1 = __importDefault(require("../../assets/score_reward_cnmod.json"));
const MOD_ASSETS_DIR = (0, path_1.join)(__dirname, "..", "..", "assets");
// Some CN-mod pools are intentionally mirrored in both files because the
// client/admin metadata pipeline reads gacha.json while runtime draws prefer
// gacha_cnmod.json.  Never allow a stale override to silently replace a newer
// advertised pool again.
const allGachas = content_master_1.serverGachas;
const allManaNodes = content_master_1.serverManaNodes;
if (allGachas["990001"] === undefined) {
    throw new Error("[GACHA] mirrored pool 990001 is missing");
}
const allManaBoards = Object.assign(Object.assign({}, mana_board_json_1.default), mana_board_cnmod_json_1.default);
const allRareScoreRewards = Object.assign(Object.assign({}, rare_score_reward_json_1.default), rare_score_reward_cnmod_json_1.default);
const allScoreRewards = Object.assign(Object.assign({}, score_reward_json_1.default), score_reward_cnmod_json_1.default);
let rogueEventData = null;
function mergeRogueEventExtension(base, extension) {
    var _a, _b, _c, _d, _e;
    for (const [eventId, extraConfig] of Object.entries((_a = extension === null || extension === void 0 ? void 0 : extension.events) !== null && _a !== void 0 ? _a : {})) {
        const targetConfig = (_b = base === null || base === void 0 ? void 0 : base.events) === null || _b === void 0 ? void 0 : _b[eventId];
        if (!targetConfig) {
            throw new Error(`rogue event extension references missing event ${eventId}`);
        }
        const extraEntries = Array.isArray(extraConfig === null || extraConfig === void 0 ? void 0 : extraConfig.folder_clear_chance)
            ? extraConfig.folder_clear_chance
            : [];
        if (!Array.isArray(targetConfig.folder_clear_chance)) {
            targetConfig.folder_clear_chance = [];
        }
        for (const entry of extraEntries) {
            const current = targetConfig.folder_clear_chance.find((candidate) => {
                var _a, _b;
                return Number((_a = candidate === null || candidate === void 0 ? void 0 : candidate.type) !== null && _a !== void 0 ? _a : 0) === Number((_b = entry === null || entry === void 0 ? void 0 : entry.type) !== null && _b !== void 0 ? _b : 0)
                    && Number(candidate === null || candidate === void 0 ? void 0 : candidate.id) === Number(entry === null || entry === void 0 ? void 0 : entry.id);
            });
            if (current !== undefined) {
                const sameCount = Number((_c = current === null || current === void 0 ? void 0 : current.count) !== null && _c !== void 0 ? _c : 1) === Number((_d = entry === null || entry === void 0 ? void 0 : entry.count) !== null && _d !== void 0 ? _d : 1);
                const sameChance = Number(current === null || current === void 0 ? void 0 : current.chance) === Number(entry === null || entry === void 0 ? void 0 : entry.chance);
                if (!sameCount || !sameChance) {
                    throw new Error(`rogue event extension conflicts at ${eventId}:${(_e = entry === null || entry === void 0 ? void 0 : entry.type) !== null && _e !== void 0 ? _e : 0}:${entry === null || entry === void 0 ? void 0 : entry.id}`);
                }
                continue;
            }
            targetConfig.folder_clear_chance.push(Object.assign({}, entry));
        }
    }
    return base;
}
function reloadRogueEventConfig() {
    const base = JSON.parse((0, fs_1.readFileSync)((0, path_1.join)(MOD_ASSETS_DIR, "rogue_event.json"), "utf-8"));
    const extension = JSON.parse((0, fs_1.readFileSync)((0, path_1.join)(MOD_ASSETS_DIR, "rogue_event_cnmod.json"), "utf-8"));
    rogueEventData = mergeRogueEventExtension(base, extension);
    return ["rogue_event.json", "rogue_event_cnmod.json"];
}
exports.reloadRogueEventConfig = reloadRogueEventConfig;
reloadRogueEventConfig();
let towerDungeonExtraRewardsData = null;
function reloadTowerDungeonExtraRewards(customPath) {
    const targetPath = customPath !== null && customPath !== void 0
        ? customPath
        : (0, path_1.join)(MOD_ASSETS_DIR, "tower_dungeon_extra_rewards.json");
    try {
        const raw = (0, fs_1.readFileSync)(targetPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            console.warn(`[ASSETS] Invalid tower_dungeon_extra_rewards.json at ${targetPath}; tower dungeon extra rewards disabled.`);
            towerDungeonExtraRewardsData = null;
            return false;
        }
        towerDungeonExtraRewardsData = parsed;
        return true;
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[ASSETS] Failed to load tower_dungeon_extra_rewards.json (${reason}); tower dungeon extra rewards disabled.`);
        towerDungeonExtraRewardsData = null;
        return false;
    }
}
exports.reloadTowerDungeonExtraRewards = reloadTowerDungeonExtraRewards;
reloadTowerDungeonExtraRewards();
function getTowerDungeonExtraRewardsSync(stage) {
    if (!towerDungeonExtraRewardsData) {
        return [];
    }
    const list = towerDungeonExtraRewardsData[String(stage)];
    if (!Array.isArray(list)) {
        return [];
    }
    return list;
}
exports.getTowerDungeonExtraRewardsSync = getTowerDungeonExtraRewardsSync;
/**
 * Gets a clear reward from its ID.
 *
 * @param clearRewardId The ID of the clear reward.
 * @returns The clear reward that was found, or null.
 */
function getClearRewardSync(clearRewardId) {
    const clearReward = clear_reward_json_1.default[String(clearRewardId)];
    return clearReward ? clearReward : null;
}
exports.getClearRewardSync = getClearRewardSync;
/**
 * Gets a rare score reward group from its ID.
 *
 * @param groupId The ID of the rare score reward group.
 * @returns The score reward group that was found, or null.
 */
function getRareScoreRewardGroup(groupId) {
    const group = allRareScoreRewards[String(groupId)];
    return group ? group : null;
}
exports.getRareScoreRewardGroup = getRareScoreRewardGroup;
/**
 * Gets a score reward group from its ID.
 *
 * @param groupId The ID of the group.
 * @returns The score reward group that was found, or null.
 */
function getScoreRewardGroup(groupId) {
    const group = allScoreRewards[String(groupId)];
    return group ? group : null;
}
exports.getScoreRewardGroup = getScoreRewardGroup;
/**
 * Generic quest fetching function.
 *
 * @param quests The list of quests to search.
 * @param questId The ID of the quest to get.
 * @returns The found BattleQuest, StoryQuest, or null
 */
function getQuestSync(quests, questId) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const quest = quests[String(questId)];
    // return null if the quest doesn't exist
    if (!quest)
        return null;
    // always return BattleQuest; missing fields default to 0
    return {
        name: quest.name,
        // A dangling reward id must read as "no reward", not null: callers check `!== undefined`.
        clearReward: quest.clearRewardId === undefined ? undefined : (_a = getClearRewardSync(quest.clearRewardId)) !== null && _a !== void 0 ? _a : undefined,
        sPlusReward: quest.sPlusRewardId === undefined ? undefined : (_b = getClearRewardSync(quest.sPlusRewardId)) !== null && _b !== void 0 ? _b : undefined,
        scoreRewardGroupId: (_c = quest.scoreRewardGroupId) !== null && _c !== void 0 ? _c : undefined,
        scoreRewardGroup: quest.scoreRewardGroupId != null ? getScoreRewardGroup(quest.scoreRewardGroupId) : undefined,
        element: quest.element,
        eventId: quest.eventId,
        folderId: quest.folderId,
        bRankTime: (_d = quest.bRankTime) !== null && _d !== void 0 ? _d : 0,
        aRankTime: (_e = quest.aRankTime) !== null && _e !== void 0 ? _e : 0,
        sRankTime: (_f = quest.sRankTime) !== null && _f !== void 0 ? _f : 0,
        sPlusRankTime: (_g = quest.sPlusRankTime) !== null && _g !== void 0 ? _g : 0,
        scoreAttackQuestId: quest.scoreAttackQuestId,
        bRankScore: quest.bRankScore,
        aRankScore: quest.aRankScore,
        sRankScore: quest.sRankScore,
        ssRankScore: quest.ssRankScore,
        timeLimitMs: quest.timeLimitMs,
        rankPointReward: (_h = quest.rankPointReward) !== null && _h !== void 0 ? _h : 0,
        characterExpReward: (_j = quest.characterExpReward) !== null && _j !== void 0 ? _j : 0,
        manaReward: (_k = quest.manaReward) !== null && _k !== void 0 ? _k : 0,
        poolExpReward: (_l = quest.poolExpReward) !== null && _l !== void 0 ? _l : 0,
        fixedParty: quest.fixedParty,
        rushEventId: quest.rushEventId,
        rushEventFolderId: quest.rushEventFolderId,
        rushEventRound: quest.rushEventRound,
        element: quest.element,
        staminaCost: quest.staminaCost,
        stage: quest.stage,
        periodIndex: quest.periodIndex,
        floorId: quest.floorId,
        startTime: quest.startTime,
        endTime: quest.endTime,
        skipMonthlyReset: quest.skipMonthlyReset,
        maxContinueCount: quest.maxContinueCount
    };
}
/**
 * Gets the highest configured round for a Rush event folder.
 *
 * Official Rush events do not all use the same number of rounds: later
 * highest-difficulty folders contain a third battle.  Derive the value from
 * the quest master instead of assuming that every folder ends at round two.
 */
function getRushEventFolderMaxRoundSync(eventId, folderId) {
    let maxRound = 0;
    for (const quest of Object.values(rush_event_quest_json_1.default)) {
        const round = quest.rushEventRound;
        if (quest.rushEventId === eventId
            && quest.rushEventFolderId === folderId
            && typeof round === "number"
            && Number.isInteger(round)
            && round > maxRound) {
            maxRound = round;
        }
    }
    return maxRound;
}
exports.getRushEventFolderMaxRoundSync = getRushEventFolderMaxRoundSync;
/**
 * Gets the data for a main quest from the database.
 *
 * @param questId The ID of the quest.
 * @returns A BattleQuest, StoryQuest, or null
 */
function getMainQuestSync(questId) {
    return getQuestSync(main_quest_json_1.default, questId);
}
exports.getMainQuestSync = getMainQuestSync;
/**
 * Gets an EX quest.
 *
 * @param questId The ID of the quest to get.
 * @returns The found BattleQuest or null
 */
function getExQuestSync(questId) {
    return getQuestSync(ex_quest_json_1.default, questId);
}
exports.getExQuestSync = getExQuestSync;
/**
 * Gets a practice quest.
 *
 * @param questId The ID of the quest to get.
 * @returns The found BattleQuest or null
 */
function getPracticeQuestSync(questId) {
    return getQuestSync(practice_quest_json_1.default, questId);
}
exports.getPracticeQuestSync = getPracticeQuestSync;
/**
 * Gets a boss battle quest.
 *
 * @param questId The ID of the quest to get.
 * @returns The found BattleQuest or null
 */
function getBossBattleQuestSync(questId) {
    return getQuestSync(boss_tables_1.serverBossBattleQuests, questId);
}
exports.getBossBattleQuestSync = getBossBattleQuestSync;
/**
 * Gets a character quest.
 *
 * @param questId The ID of the quest to get.
 * @returns The found StoryQuest or null
 */
function getCharacterQuestSync(questId) {
    return getQuestSync(character_quest_json_1.default, questId);
}
exports.getCharacterQuestSync = getCharacterQuestSync;
/**
 * Gets a world story event quest.
 *
 * @param questId The ID of the quest to get.
 * @returns The found StoryQuest or null
 */
function getWorldStoryEventQuestSync(questId) {
    return getQuestSync(world_story_event_quest_json_1.default, questId);
}
exports.getWorldStoryEventQuestSync = getWorldStoryEventQuestSync;
/**
 * Gets a world story event boss battle quest.
 *
 * @param questId The ID of the quest to get.
 * @returns The found StoryQuest or null
 */
function getWorldStoryEventBossBattleQuestSync(questId) {
    return getQuestSync(world_story_event_boss_battle_quest_json_1.default, questId);
}
exports.getWorldStoryEventBossBattleQuestSync = getWorldStoryEventBossBattleQuestSync;
/**
 * Gets an advent quest.
 *
 * @param questId The ID of the quest to get.
 * @returns The found StoryQuest or null
 */
function getAdventEventQuest(questId) {
    return getQuestSync(advent_event_quest_json_1.default, questId);
}
exports.getAdventEventQuest = getAdventEventQuest;
/**
 * Gets a hard multi event quest.
 *
 * @param questId The ID of the quest to get.
 * @returns The found BattleQuest or null
 */
function getHardMultiEventQuest(questId) {
    return getQuestSync(hard_multi_event_quest_json_1.default, questId);
}
exports.getHardMultiEventQuest = getHardMultiEventQuest;
/**
 * Gets a quest from a specific quest category.
 *
 * @param category The category of the quest.
 * @param questId The ID of the quest.
 * @returns The BattleQuest or StoryQuest that was found, or null if nothing was found.
 */
function getQuestFromCategorySync(category, questId) {
    switch (category) {
        case types_1.QuestCategory.MAIN:
            return getMainQuestSync(questId);
        case types_1.QuestCategory.EX:
            return getExQuestSync(questId);
        case types_1.QuestCategory.BOSS_BATTLE:
            return getBossBattleQuestSync(questId);
        case types_1.QuestCategory.CHARACTER:
            return getCharacterQuestSync(questId);
        case types_1.QuestCategory.WORLD_STORY_EVENT:
            return getWorldStoryEventQuestSync(questId);
        case types_1.QuestCategory.WORLD_STORY_EVENT_BOSS_BATTLE:
            return getWorldStoryEventBossBattleQuestSync(questId);
        case types_1.QuestCategory.ADVENT_EVENT_SINGLE:
        case types_1.QuestCategory.ADVENT_EVENT_MULTI:
            return getAdventEventQuest(questId);
        case types_1.QuestCategory.STORY_EVENT_SINGLE:
            return getQuestSync(story_event_single_quest_json_1.default, questId);
        case types_1.QuestCategory.RANKING_EVENT_SINGLE:
            return getQuestSync(ranking_event_single_quest_json_1.default, questId);
        case types_1.QuestCategory.CHALLENGE_DUNGEON_EVENT:
            return getQuestSync(challenge_dungeon_event_quest_json_1.default, questId);
        case types_1.QuestCategory.DAILY_EXP_MANA_EVENT:
            return getQuestSync(daily_exp_mana_event_quest_json_1.default, questId);
        case types_1.QuestCategory.PRACTICE:
            return getPracticeQuestSync(questId);
        case types_1.QuestCategory.DAILY_WEEK_EVENT:
            return getQuestSync(daily_week_event_quest_json_1.default, questId);
        case types_1.QuestCategory.TOWER_DUNGEON_EVENT:
            return getQuestSync(tower_dungeon_event_quest_json_1.default, questId);
        case types_1.QuestCategory.EXPERT_SINGLE_EVENT:
            {
                const quest = getQuestSync(expert_single_event_quest_json_1.default, questId);
                if ((quest === null || quest === void 0 ? void 0 : quest.sPlusReward) !== undefined) {
                    // CN Recollection Trial SS rewards are always three Starry
                    // Memory Crystals. The extracted clear_reward mapping points
                    // at free beads instead, which makes the client show the SS
                    // badge while the intended inventory item never arrives.
                    quest.sPlusReward = { type: 0, id: 14040, count: 3 };
                }
                return quest;
            }
        case types_1.QuestCategory.CARNIVAL_EVENT:
            return getQuestSync(carnival_event_quest_json_1.default, questId);
        case types_1.QuestCategory.RAID_EVENT:
            return getQuestSync(raid_event_quest_json_1.default, questId);
        case types_1.QuestCategory.RUSH_EVENT: {
            const quest = getQuestSync(rush_event_quest_json_1.default, questId);
            if (quest !== null && (0, abyss_modes_1.isAbyssExEndlessQuest)(category, questId)) {
                return Object.assign(Object.assign({}, quest), { rankPointReward: 0, characterExpReward: 0, manaReward: 0, poolExpReward: 0, clearReward: undefined, sPlusReward: undefined, scoreRewardGroupId: undefined, scoreRewardGroup: undefined });
            }
            return quest;
        }
        case types_1.QuestCategory.SOLO_TIME_ATTACK_EVENT:
            return getQuestSync(solo_time_attack_event_quest_json_1.default, questId);
        case types_1.QuestCategory.SCORE_ATTACK_EVENT:
            return getQuestSync(score_attack_event_quest_json_1.default, questId);
        case types_1.QuestCategory.HARD_MULTI_EVENT:
            return getHardMultiEventQuest(questId);
        default:
            return null;
    }
}
exports.getQuestFromCategorySync = getQuestFromCategorySync;
/**
 * Gets a character's asset data from their id.
 *
 * @param characterId The ID of the character.
 * @returns The character's asset data, or null if it wasn't found.
 */
function getCharacterDataSync(characterId) {
    const character = content_master_1.serverCharacters[String(characterId)];
    if (!character)
        return null;
    return character;
}
exports.getCharacterDataSync = getCharacterDataSync;
/**
 * Gets all mana node data for a character on a specific level.
 *
 * @param characterId The ID of the character.
 * @param level The mana node level.
 * @returns A record containing ManaNode objects or null.
 */
function getCharacterManaNodesSync(characterId, level) {
    const characterManaNodes = allManaNodes[String(characterId)];
    if (!characterManaNodes)
        return null;
    return characterManaNodes[String(level)] || null;
}
exports.getCharacterManaNodesSync = getCharacterManaNodesSync;
/**
 * Gets the number of mana boards a character has in CDN data.
 */
function getCharacterManaBoardCountSync(characterId) {
    const characterManaNodes = allManaNodes[String(characterId)];
    if (!characterManaNodes)
        return 0;
    return Object.keys(characterManaNodes).length;
}
exports.getCharacterManaBoardCountSync = getCharacterManaBoardCountSync;
/**
 * Gets the data for a character mana node.
 *
 * @param characterId The ID of the character.
 * @param level The mana node level to get the node from.
 * @param manaNodeId The ID of the mana node.
 * @returns A ManaNode object or null.
 */
function getCharacterManaNodeSync(characterId, level, manaNodeId) {
    const nodes = getCharacterManaNodesSync(characterId, level);
    if (!nodes)
        return null;
    return nodes[String(manaNodeId)] || null;
}
exports.getCharacterManaNodeSync = getCharacterManaNodeSync;
/**
 * Gets the slot (1-4) for a character's mana node from its field6 value.
 * Returns 0 if the node is not found.
 * field6=1/2/3 → ability slot 1/2/3; field6="" → skill slot 4.
 */
function getManaNodeSlot(characterId, manaNodeId) {
    var _a;
    const charData = allManaNodes[String(characterId)];
    if (!charData)
        return 0;
    for (const level of Object.keys(charData)) {
        const node = (_a = charData[level]) === null || _a === void 0 ? void 0 : _a[String(manaNodeId)];
        if (node) {
            const f6 = node.field6;
            if (f6 === '1')
                return 1;
            if (f6 === '2')
                return 2;
            if (f6 === '3')
                return 3;
            return 4; // empty → action skill slot
        }
    }
    return 0;
}
/**
 * Gets the pedestal_size (0 or 2) for a character's mana node.
 * Returns -1 if not found.
 */
function getManaNodePedestalSize(characterId, manaNodeId) {
    const charBoard = allManaBoards[String(characterId)];
    if (!charBoard)
        return -1;
    for (const level of Object.keys(charBoard)) {
        const nodes = charBoard[level];
        for (const nodeIndex of Object.keys(nodes)) {
            const row = nodes[nodeIndex][0];
            if (String(row[0]) === String(manaNodeId)) {
                return parseInt(row[4]) || 0;
            }
        }
    }
    return -1;
}
/**
 * Gets the awake cost for awakening a mana node.
 * CDN lookup: mana_node_awake[rarity][slot][pedestal_size]
 */
function getManaNodeAwakeCost(characterId, manaNodeId, rarity) {
    const slot = getManaNodeSlot(characterId, manaNodeId);
    if (slot === 0)
        return null;
    const pedestalSize = getManaNodePedestalSize(characterId, manaNodeId);
    if (pedestalSize < 0)
        return null;
    const rarityData = mana_node_awake_json_1.default[String(rarity)];
    if (!rarityData)
        return null;
    const slotData = rarityData[String(slot)];
    if (!slotData)
        return null;
    const targetRows = slotData[String(pedestalSize)];
    if (!targetRows || !targetRows[0])
        return null;
    const row = targetRows[0];
    // row[0]: "item_id_1,item_id_2,..." (IDs)
    // row[1]: "count_1,count_2,..." (counts)
    // row[2]: mana amount
    const idStrings = String(row[0]).split(',');
    const countStrings = String(row[1]).split(',');
    const manaAmount = parseInt(String(row[2])) || 0;
    const items = {};
    for (let i = 0; i < idStrings.length; i++) {
        const id = parseInt(idStrings[i]) || 0;
        const count = parseInt(countStrings[i]) || 0;
        if (id > 0 && count > 0) {
            items[String(id)] = (items[String(id)] || 0) + count;
        }
    }
    return { manaAmount, items };
}
exports.getManaNodeAwakeCost = getManaNodeAwakeCost;
/**
 * Gets the ExAbilities record.
 *
 * @returns
 */
function getExAbilityPoolsSync() {
    return ex_ability_json_1.default;
}
exports.getExAbilityPoolsSync = getExAbilityPoolsSync;
/**
 * Gets an ex status pool.
 *
 * @param tier The tier of the pool to get.
 * @returns A list of numbers with the StatusIDs corresponding to the requested pool.
 */
function getExStatusPoolSync(tier) {
    const pool = ex_status_json_1.default[String(tier)];
    return pool === undefined ? null : pool;
}
exports.getExStatusPoolSync = getExStatusPoolSync;
/**
 * Gets an ex boost item.
 *
 * @param itemId The ID of the item.
 * @returns The ExBoostItem that was found, or null.
 */
function getExBoostItemSync(itemId) {
    const item = ex_boost_json_1.default[String(itemId)];
    return item === undefined ? null : item;
}
exports.getExBoostItemSync = getExBoostItemSync;
/**
 * Gets the data for a box gacha from the assets folder.
 *
 * @param id The ID of the box gacha.
 * @returns A BoxGacha object or null, if it didn't exist.
 */
function getBoxGachaSync(id) {
    const idString = String(id);
    // get redeem item data
    const redeemItemData = box_gacha_json_1.default[idString];
    if (redeemItemData === undefined)
        return null;
    // get boxes
    const boxes = box_reward_json_1.default[idString];
    if (boxes === undefined)
        return null;
    // build box gacha
    return {
        redeemItemId: redeemItemData.itemId,
        redeemItemCount: redeemItemData.count,
        boxes: boxes,
        availableCounts: redeemItemData.availableCounts
    };
}
exports.getBoxGachaSync = getBoxGachaSync;
/**
 * Gets the data for a gacha.
 *
 * @param id The ID of the gacha.
 * @returns The gacha's data, or null.
 */
function getGachaSync(id) {
    const data = allGachas[String(id)];
    return data !== null && data !== void 0 ? data : null;
}
exports.getGachaSync = getGachaSync;
/**
 * Gets the ID of the gacha campaign assigned to a gacha.
 *
 * @param gachaId The ID of the gacha.
 * @returns The ID of the assigned gacha campaign or null.
 */
function getGachaCampaignIdSync(gachaId) {
    var _a;
    return (_a = gacha_campaign_json_1.default[String(gachaId)]) !== null && _a !== void 0 ? _a : null;
}
exports.getGachaCampaignIdSync = getGachaCampaignIdSync;
// shop functions
const RUSH_RERUN_SHOP_PERIODS = {
    700011: { availableFrom: "2025-06-26 12:00:00", availableUntil: "2025-08-14 23:59:59" },
    700012: { availableFrom: "2025-06-26 12:00:00", availableUntil: "2025-08-14 23:59:59" },
    700013: { availableFrom: "2025-06-26 12:00:00", availableUntil: "2025-08-14 23:59:59" },
    700014: { availableFrom: "2025-06-26 12:00:00", availableUntil: "2025-08-14 23:59:59" },
    700015: { availableFrom: "2025-06-26 12:00:00", availableUntil: "2025-08-14 23:59:59" },
    700016: { availableFrom: "2025-06-26 12:00:00", availableUntil: "2025-08-14 23:59:59" },
    700017: { availableFrom: "2025-06-26 12:00:00", availableUntil: "2025-08-14 23:59:59" },
};
function addShopCompatibilityPeriod(item, period) {
    var _a;
    const compatibilityPeriods = (_a = item.compatibilityPeriods) !== null && _a !== void 0 ? _a : [];
    if (compatibilityPeriods.some(candidate => candidate.availableFrom === period.availableFrom
        && candidate.availableUntil === period.availableUntil))
        return item;
    return Object.assign(Object.assign({}, item), { compatibilityPeriods: [...compatibilityPeriods, period] });
}
function addShopCompatibilityPeriodToItems(items, period) {
    return Object.fromEntries(Object.entries(items).map(([itemId, item]) => [
        itemId,
        addShopCompatibilityPeriod(item, period),
    ]));
}
/**
 * Gets the items for a generic shop.
 *
 * @param shopType The type of shop to get the items of.
 * @returns A list of shop items belonging to the specified shop type or null.
 */
function getGenericShopItemsSync(shopType) {
    switch (shopType) {
        case types_1.ShopType.TREASURE:
            return treasure_shop_json_1.default;
        case types_1.ShopType.TREASURE_EQUIPMENT:
            return equipment_enhancement_shop_json_1.default;
        case types_1.ShopType.GENERAL:
            return general_shop_json_1.default;
        case types_1.ShopType.STAR_GRAIN:
            return star_grain_shop_json_1.default;
    }
    return null;
}
exports.getGenericShopItemsSync = getGenericShopItemsSync;
/**
 * Gets the items for a specific event shop.
 *
 * @param eventType The type of event.
 * @param eventId The ID of the event.
 * @returns A list of shop items or null.
 */
function getEventShopItemsSync(eventType, eventId) {
    var _a, _b;
    // Both entrances use the same product IDs, hence the same stock ledger.
    if (Number(eventType) === 11 && Number(eventId) === abyss_modes_1.ABYSS_EX_EVENT_ID) {
        eventId = abyss_modes_1.ABYSS_NORMAL_EVENT_ID;
    }
    const typeSection = content_master_1.serverEventShops[String(eventType)];
    if (typeSection === undefined)
        return null;
    // Try exact event ID first
    const eventIdNum = Number(eventId);
    const rerunPeriod = Number(eventType) === 11 ? RUSH_RERUN_SHOP_PERIODS[eventIdNum] : undefined;
    let result = (_a = typeSection[String(eventId)]) !== null && _a !== void 0 ? _a : null;
    if (result !== null) {
        return rerunPeriod === undefined
            ? result
            : addShopCompatibilityPeriodToItems(result, rerunPeriod);
    }
    // Fallback: for rush event reruns (700011-700017), try primary event (ID - 10)
    if (rerunPeriod !== undefined) {
        result = (_b = typeSection[String(eventIdNum - 10)]) !== null && _b !== void 0 ? _b : null;
        return result === null
            ? null
            : addShopCompatibilityPeriodToItems(result, rerunPeriod);
    }
    return null;
}
exports.getEventShopItemsSync = getEventShopItemsSync;
/**
 * Gets the items belonging to a specific boss coin shop.
 *
 * @param bossId The ID of the boss to get the items of.
 * @returns A list of shop items or null.
 */
function getBossCoinShopItemsSync(bossId) {
    var _a;
    return (_a = boss_coin_shop_json_1.default[String(bossId)]) !== null && _a !== void 0 ? _a : null;
}
exports.getBossCoinShopItemsSync = getBossCoinShopItemsSync;
/**
 * Gets the data for a specfic ShopItem.
 *
 * @param shopType The type of shop that this item belongs to.
 * @param itemId The ID of this item.
 * @returns The ShopItem data or null.
 */
function getShopItemSync(shopType, itemId) {
    var _a, _b, _c, _d, _e, _f;
    switch (shopType) {
        case types_1.ShopType.TREASURE:
            return (_a = treasure_shop_json_1.default[String(itemId)]) !== null && _a !== void 0 ? _a : null;
        case types_1.ShopType.TREASURE_EQUIPMENT:
            return (_b = equipment_enhancement_shop_json_1.default[String(itemId)]) !== null && _b !== void 0 ? _b : null;
        case types_1.ShopType.GENERAL:
            return (_c = general_shop_json_1.default[String(itemId)]) !== null && _c !== void 0 ? _c : null;
        case types_1.ShopType.STAR_GRAIN:
            return (_d = star_grain_shop_json_1.default[String(itemId)]) !== null && _d !== void 0 ? _d : null;
        case types_1.ShopType.BOSS_COIN:
            const category = boss_coin_shop_item_category_map_json_1.default[itemId];
            if (category === undefined)
                return null;
            return (_e = boss_coin_shop_json_1.default[category][itemId]) !== null && _e !== void 0 ? _e : null;
        case types_1.ShopType.EVENT_ITEM:
            const mapInfo = content_master_1.serverEventShopIdMap[itemId];
            if (mapInfo === undefined)
                return null;
            const item = (_f = content_master_1.serverEventShops[mapInfo.eventType][mapInfo.eventId][itemId]) !== null && _f !== void 0 ? _f : null;
            if (item === null || Number(mapInfo.eventType) !== 11)
                return item;
            const rerunPeriod = RUSH_RERUN_SHOP_PERIODS[Number(mapInfo.eventId) + 10];
            return rerunPeriod === undefined ? item : addShopCompatibilityPeriod(item, rerunPeriod);
        default:
            return null;
    }
}
exports.getShopItemSync = getShopItemSync;
/**
 * Gets the rewards that should be given when clearing a given folder.
 *
 * @param rushEventId The ID of the rush event.
 * @param folderId The ID of the folder.
 * @returns
 */
function getRushEventFolderClearRewards(rushEventId, folderId) {
    var _a, _b, _c, _d;
    if ((0, abyss_modes_1.isAbyssEvent)(rushEventId) && folderId !== 1)
        return [];
    const rogueCfg = getRogueEventConfig(rushEventId);
    const extras = [];
    const add = (type, id, count) => {
        if (Number.isFinite(id) && count > 0) {
            extras.push({ type: type, id, count });
        }
    };
    for (const entry of Array.isArray(rogueCfg === null || rogueCfg === void 0 ? void 0 : rogueCfg.folder_clear_chance) ? rogueCfg.folder_clear_chance : []) {
        const chance = Number(entry === null || entry === void 0 ? void 0 : entry.chance);
        if (Number.isFinite(chance) && Math.random() < chance) {
            add(Number((_a = entry === null || entry === void 0 ? void 0 : entry.type) !== null && _a !== void 0 ? _a : 0), Number(entry === null || entry === void 0 ? void 0 : entry.id), Math.max(1, Number((_b = entry === null || entry === void 0 ? void 0 : entry.count) !== null && _b !== void 0 ? _b : 1)));
        }
    }
    const randomInt = (lo, hi) => lo + Math.floor(Math.random() * (Math.max(lo, hi) - lo + 1));
    const range = (value, fallback) => {
        if (Array.isArray(value) && value.length >= 2)
            return [Number(value[0]), Number(value[1])];
        const n = Number(value);
        return Number.isFinite(n) ? [n, n] : [fallback, fallback];
    };
    for (const entry of Array.isArray(rogueCfg === null || rogueCfg === void 0 ? void 0 : rogueCfg.folder_clear_random) ? rogueCfg.folder_clear_random : []) {
        if (!(0, rogue_drop_schedule_1.shouldRollRogueFolderRandomReward)(entry === null || entry === void 0 ? void 0 : entry.chance))
            continue;
        const pool = (Array.isArray(entry === null || entry === void 0 ? void 0 : entry.pool) ? entry.pool : []).map(Number).filter(Number.isFinite);
        if (pool.length === 0)
            continue;
        const [pickLo, pickHi] = range(entry === null || entry === void 0 ? void 0 : entry.pick, pool.length);
        const shuffled = [...pool];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const [countLo, countHi] = range(entry === null || entry === void 0 ? void 0 : entry.count, 1);
        for (const id of shuffled.slice(0, Math.max(0, Math.min(pool.length, randomInt(pickLo, pickHi))))) {
            add(Number((_c = entry === null || entry === void 0 ? void 0 : entry.type) !== null && _c !== void 0 ? _c : 0), id, randomInt(countLo, countHi));
        }
    }
    const merge = (rewards) => {
        var _a;
        const result = [];
        const index = new Map();
        for (const reward of rewards) {
            const key = `${reward.type}:${(_a = reward.id) !== null && _a !== void 0 ? _a : ""}`;
            const at = index.get(key);
            if (at === undefined) {
                index.set(key, result.length);
                result.push(Object.assign({}, reward));
            }
            else {
                ;
                result[at].count += reward.count;
            }
        }
        return result;
    };
    const folders = rush_event_quest_folder_json_1.default[rushEventId];
    if (folders !== undefined) {
        const rewards = folders[folderId];
        if (rewards !== undefined && Array.isArray(rewards) && rewards.length > 0) {
            return extras.length > 0 ? merge([...rewards, ...extras]) : rewards;
        }
    }
    if (extras.length > 0)
        return merge(extras);
    // Fallback: for rush event reruns (700011-700017), try primary event (ID - 10)
    if (rushEventId >= 700010 && rushEventId <= 700019) {
        const primaryFolders = rush_event_quest_folder_json_1.default[rushEventId - 10];
        if (primaryFolders !== undefined) {
            return (_d = primaryFolders[folderId]) !== null && _d !== void 0 ? _d : null;
        }
    }
    return null;
}
exports.getRushEventFolderClearRewards = getRushEventFolderClearRewards;
/** Deep Abyss roguelike configuration, independent from Fantasy Gauntlet. */
function getRogueEventConfig(eventId) {
    var _a, _b;
    const config = rogueEventData;
    if ((config === null || config === void 0 ? void 0 : config.enabled) !== true)
        return null;
    return (_b = (_a = config.events) === null || _a === void 0 ? void 0 : _a[String(eventId)]) !== null && _b !== void 0 ? _b : null;
}
exports.getRogueEventConfig = getRogueEventConfig;
function getEquipmentMaxLevel(equipmentId) {
    var _a;
    return (_a = equipment_max_level_json_1.default[String(equipmentId)]) !== null && _a !== void 0 ? _a : 1;
}
exports.getEquipmentMaxLevel = getEquipmentMaxLevel;
function getEquipmentElement(equipmentId) {
    var _a;
    return (_a = equipment_element_json_1.default[String(equipmentId)]) !== null && _a !== void 0 ? _a : -1;
}
exports.getEquipmentElement = getEquipmentElement;
// TODO: 待从CDN二进制 config.orderedmap 提取真实数据
const FALLBACK_CONFIG = {
    continue_virtual_money: 50,
    stamina_recovery_virtual_money: 50,
    stamina_recovery_seconds: 300,
    stamina_recovery_value: 100,
    max_stamina_overflow: 999,
    max_virtual_money: 999999,
    max_mana: 999999999,
    max_star_crumb: 9999,
    pool_exp_gain_value: 1,
    pool_exp_gain_seconds: 1,
    max_pool_exp: 999999,
    max_display_pool_exp: 999999,
    max_follows_count: 100,
    max_followers_count: 50,
    max_display_followers_count: 50,
    max_player_name_length: 12,
    max_player_comment_length: 40,
    overflow_exp_to_mana_conversion_rate: 0.001,
    reward_multiplier_by_boost_point: 1.0,
    common_reward_multiplier_by_multi_play_mode: 1.0,
    limit_payment_under_16: 0,
    limit_payment_16_19: 0,
    alert_payment: 0,
    level_correction_value_by_recommended_element: 0,
    level_correction_value_for_moderate_level_comparison: 0,
    unknown_loc2: 0,
    max_bond_token: 999,
    treasure_shop_item_number: 0,
    special_pack_shop_days_as_new: 7,
    support_url: "",
    max_boss_boost_point: 3,
    max_display_boss_boost_point: 3,
    max_boost_point: 10,
    max_display_boost_point: 10,
    craft_point_item_id: 0,
    wildcard_once_character_ticket_item_id: 0,
    wildcard_ten_times_character_ticket_item_id: 0,
    wildcard_once_rare4_character_ticket_item_id: 0,
    wildcard_once_equipment_ticket_item_id: 0,
    wildcard_ten_times_equipment_ticket_item_id: 0,
    encyclopedia_point_item_id: 0,
    star_grain_item_id: 0,
    gacha_one_max_count: 999,
    gacha_ten_max_count: 999,
    growth_fund_unlock_chapter: 0,
    gacha_crazy_ten_max_count: 999,
    monthly_bonus_payment_total_requirement: 0,
    crazygacha_ten_times_character_ticket_id: 0,
    reward_multiplier_by_newbie: 1.0,
    newbie_rank: 250,
    newbie_days: 365,
};
/**
 * Gets the config values (stamina recovery, vmoney limits, etc.).
 * Returns fallback defaults if config.json fails to load.
 */
function getConfigSync() {
    if (!config_json_1.default) {
        console.error('[CONFIG] config.json not loaded, using fallback defaults');
        return FALLBACK_CONFIG;
    }
    // Merge loaded data with fallback to fill any missing fields
    const merged = Object.assign(Object.assign({}, FALLBACK_CONFIG), config_json_1.default);
    return merged;
}
exports.getConfigSync = getConfigSync;
/**
 * Gets a specific stamina config value with bounds checking.
 */
function getStaminaRecoverySeconds() {
    const v = getConfigSync().stamina_recovery_seconds;
    if (typeof v !== 'number' || v <= 0 || !isFinite(v)) {
        console.warn('[CONFIG] invalid stamina_recovery_seconds, fallback to 300');
        return 300;
    }
    return v;
}
exports.getStaminaRecoverySeconds = getStaminaRecoverySeconds;
// ─── Equipment dissolve data ────────────────────────────────────────────
/**
 * Gets equipment dissolve properties from CDN data.
 * Returns null if equipment not found in the dataset.
 */
function getEquipmentDissolveSync(id) {
    const entry = equipment_dissolve_json_1.default[String(id)];
    return entry !== null && entry !== void 0 ? entry : null;
}
exports.getEquipmentDissolveSync = getEquipmentDissolveSync;
// ─── Item sale data ──────────────────────────────────────────────────────
/**
 * Gets item sale properties (price, sellable, category) from CDN data.
 * Returns null if item not found in the dataset.
 */
function getItemSaleSync(id) {
    const entry = item_sale_json_1.default[String(id)];
    return entry !== null && entry !== void 0 ? entry : null;
}
exports.getItemSaleSync = getItemSaleSync;
// ─── Equipment craft / dissolve cost data ────────────────────────────────
/**
 * Gets equipment craft-point costs and dissolve rates by rarity (1-5).
 * Returns null if rarity is invalid.
 */
function getEquipmentCraftSync(rarity) {
    const entry = equipment_craft_json_1.default[String(Math.max(1, Math.min(5, rarity)))];
    return entry !== null && entry !== void 0 ? entry : null;
}
exports.getEquipmentCraftSync = getEquipmentCraftSync;
// ─── Equipment awakening material rules ────────────────────────────────
let equipmentAwakeningRules = null;
/** Parsed once from the static asset; malformed rules fail during route registration. */
function getEquipmentAwakeningRulesSync() {
    equipmentAwakeningRules !== null && equipmentAwakeningRules !== void 0 ? equipmentAwakeningRules : (equipmentAwakeningRules = (0, equipment_awakening_rules_1.parseAwakeningMaterialRules)(equipment_awakening_material_json_1.default));
    return equipmentAwakeningRules;
}
exports.getEquipmentAwakeningRulesSync = getEquipmentAwakeningRulesSync;
