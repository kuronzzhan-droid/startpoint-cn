"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRoguePerRoundDrops = exports.ABYSS_ROUND_ADDITIONAL_REWARD_GROUP_ID = exports.ABYSS_TOKEN_ITEM_ID = void 0;
const equipment_1 = require("../../../data/domains/equipment");
const assets_1 = require("../../assets");
const character_1 = require("../../character");
const quest_1 = require("../../quest");
const types_1 = require("../../types");
const rogue_drop_schedule_1 = require("./rogue-drop-schedule");
const abyss_modes_1 = require("../../abyss-modes");
// Client-side kind values accepted by RushEventLogic.rewardListToGeneralRewardKinds
// (anything else throws ClientError 3446): 1=Item, 5=Character, 6=Equipment.
const REWARD_LIST_KIND = {
    item: 1,
    character: 5,
    equipment: 6,
};
const REWARD_TYPE = {
    item: types_1.RewardType.ITEM,
    character: types_1.RewardType.CHARACTER,
    equipment: types_1.RewardType.EQUIPMENT,
};
// Added to master/reward/event/additional_reward.orderedmap by the matching
// client asset patch. This uses the ordinary result-screen reward channel;
// rush_battle_reward_list must stay empty on non-final rounds because the
// legacy client interprets it as a full-folder clear.
exports.ABYSS_TOKEN_ITEM_ID = 2370099;
exports.ABYSS_ROUND_ADDITIONAL_REWARD_GROUP_ID = 237009900;
/**
 * Roguelike rush-event mod: grants configured per-round loot
 * (weapons / souls / characters / items) after every cleared rush round.
 * Everything is gated by assets/rogue_event.json (hot-reloadable).
 *
 * @returns The drop outcome to merge into the quest finish response, or null.
 */
function handleRoguePerRoundDrops(params) {
    var _a, _b;
    const { questCategory, questAccomplished, playerId, questData, folderMaxRounds, partyCharacterIds } = params;
    if (questCategory !== types_1.QuestCategory.RUSH_EVENT || !questAccomplished)
        return null;
    const { rushEventId, rushEventFolderId, rushEventRound } = questData;
    if (rushEventId === undefined || rushEventFolderId === undefined || rushEventRound === undefined)
        return null;
    if (rushEventId === abyss_modes_1.ABYSS_EX_EVENT_ID && rushEventRound === 0)
        return null;
    const config = (0, assets_1.getRogueEventConfig)(rushEventId);
    if (config === null)
        return null;
    // fixed drops (per_round_drops, optionally constrained by inclusive
    // `rounds: [min,max]`) + weighted random pool (drop_pool × pool_draws)
    const dropsConfig = (0, rogue_drop_schedule_1.resolveRogueRoundDrops)(config, rushEventRound);
    const pool = Array.isArray(config.drop_pool) ? config.drop_pool : [];
    const draws = Math.max(0, Math.floor(Number(config.pool_draws) || 0));
    if (pool.length > 0 && draws > 0) {
        // element matching (default on): souls/weapons hard-gate on element
        // ("属性不同,无法使用"), so restrict rolls to the clearing party's
        // elements plus universal (-1). Falls back to the full pool if the
        // filter would empty it.
        let candidates = pool;
        if (config.match_party_element !== false && Array.isArray(partyCharacterIds)) {
            const partyElements = new Set();
            for (const id of partyCharacterIds) {
                const element = Number((_a = (0, assets_1.getCharacterDataSync)(id)) === null || _a === void 0 ? void 0 : _a.element);
                if (Number.isInteger(element))
                    partyElements.add(element);
            }
            if (partyElements.size > 0) {
                const filtered = pool.filter(entry => {
                    const element = (0, assets_1.getEquipmentElement)(Number(entry === null || entry === void 0 ? void 0 : entry.id));
                    return element === -1 || partyElements.has(element);
                });
                if (filtered.length > 0)
                    candidates = filtered;
            }
        }
        // first draw guarantees a weapon (default on) so a round never yields
        // souls only; remaining draws roll the whole candidate set
        const weaponCandidates = candidates.filter(entry => (entry === null || entry === void 0 ? void 0 : entry.type) === "equipment");
        const pickWeighted = (entries) => {
            const totalWeight = entries.reduce((sum, e) => sum + (Number(e === null || e === void 0 ? void 0 : e.weight) > 0 ? Number(e.weight) : 1), 0);
            let roll = Math.random() * totalWeight;
            for (const entry of entries) {
                roll -= Number(entry === null || entry === void 0 ? void 0 : entry.weight) > 0 ? Number(entry.weight) : 1;
                if (roll <= 0)
                    return entry;
            }
            return entries[entries.length - 1];
        };
        for (let i = 0; i < draws; i++) {
            const source = (i === 0 && config.guarantee_weapon !== false && weaponCandidates.length > 0)
                ? weaponCandidates
                : candidates;
            const picked = pickWeighted(source);
            if (picked !== undefined)
                dropsConfig.push(picked);
        }
    }
    const rewards = [];
    const rewardListEntries = [];
    const additionalRewardEntries = [];
    for (const drop of dropsConfig) {
        const type = REWARD_TYPE[drop === null || drop === void 0 ? void 0 : drop.type];
        const id = Number(drop === null || drop === void 0 ? void 0 : drop.id);
        if (type === undefined || !Number.isInteger(id))
            continue;
        const count = Math.max(1, Number(drop === null || drop === void 0 ? void 0 : drop.count) || 1);
        const reward = { type, id, count };
        // Multiple probability slots for the same item must be granted in one
        // database operation. givePlayerRewardsSync returns absolute inventory
        // values for items, so repeated same-ID operations would produce an
        // invalid summed response even though the database grant itself stuck.
        const existingItem = type === types_1.RewardType.ITEM
            ? rewards.find(candidate => candidate.type === type && Number(candidate.id) === id)
            : undefined;
        if (existingItem !== undefined) {
            ;
            existingItem.count += count;
        }
        else {
            rewards.push(reward);
        }
        rewardListEntries.push({ kind: REWARD_LIST_KIND[drop.type], kind_id: id, number: count });
        const configuredGroup = Number(drop === null || drop === void 0 ? void 0 : drop.additional_reward_group_id);
        const configuredIndex = Number(drop === null || drop === void 0 ? void 0 : drop.additional_reward_index);
        const fallbackIndex = type === types_1.RewardType.ITEM && id === exports.ABYSS_TOKEN_ITEM_ID ? 1 : 0;
        const groupId = Number.isInteger(configuredGroup) && configuredGroup > 0
            ? configuredGroup
            : (fallbackIndex > 0 ? exports.ABYSS_ROUND_ADDITIONAL_REWARD_GROUP_ID : 0);
        const index = Number.isInteger(configuredIndex) && configuredIndex > 0
            ? configuredIndex
            : fallbackIndex;
        if (groupId > 0 && index > 0) {
            additionalRewardEntries.push({
                group_id: groupId,
                index,
                number: count,
            });
        }
    }
    if (rewards.length === 0)
        return null;
    const rewardResult = (0, quest_1.givePlayerRewardsSync)(playerId, rewards);
    if (rewardResult === null)
        return null;
    // "finished goods" drops: raise dropped equipment to the configured
    // evolution level (players_equipment.level), clamped per item to the
    // equipment master's max_level — the client hard-throws C2284/C2287 on
    // out-of-range level/enhancement, so never write beyond the caps.
    // enhancement_level is 特殊改造 (only ~29 weapons define it, everything
    // else caps at 0) — configurable per drop entry only, no global knob.
    // DB row and the serialized response entries are patched together so the
    // client applies final stats immediately (equipment_list upsert).
    const equipLevel = Math.max(0, Math.floor(Number(config.drop_equipment_level) || 0));
    if (equipLevel > 0) {
        for (const entry of rewardResult.equipment_list) {
            const target = Math.min(equipLevel, (0, assets_1.getEquipmentMaxLevel)(Number(entry.equipment_id)));
            if (Number(entry.level) < target) {
                entry.level = target;
                (0, equipment_1.updatePlayerEquipmentSync)(playerId, Number(entry.equipment_id), { level: target });
            }
        }
    }
    // Optionally pump exp into characters that were actually added (dupes are
    // converted to items by givePlayerCharacterSync and never appear here).
    // The DB write always sticks; whether the client applies it mid-session is
    // a canary question — worst case the character shows Lv1 until relogin.
    let addExpList = [];
    let expCharacterList = [];
    let bondTokenStatusList = {};
    let expPoolAbsolute = null;
    const dropExp = Number(config.drop_character_exp) || 0;
    if (dropExp > 0) {
        const droppedCharacterIds = rewardResult.character_list
            .map(character => Number(character.character_id))
            .filter(id => Number.isInteger(id));
        if (droppedCharacterIds.length > 0) {
            const expResult = (0, character_1.givePlayerCharactersExpSync)(playerId, droppedCharacterIds, dropExp, false);
            addExpList = expResult.add_exp_list;
            expCharacterList = expResult.character_list;
            bondTokenStatusList = expResult.bond_token_status_list;
            expPoolAbsolute = expResult.exp_pool;
        }
    }
    const isEndless = rushEventRound === 0;
    const isFolderFinal = !isEndless && rushEventRound >= ((_b = folderMaxRounds[rushEventFolderId]) !== null && _b !== void 0 ? _b : 0);
    const showInRewardList = isFolderFinal || (isEndless && config.show_reward_list_endless !== false);
    return {
        rewardResult,
        addExpList,
        expCharacterList,
        bondTokenStatusList,
        expPoolAbsolute,
        rewardListEntries,
        // Final/endless clears already have the native Rush reward panel.
        // Sending both channels there would display the same token twice
        // even though inventory is granted only once.
        additionalRewardEntries: showInRewardList ? [] : additionalRewardEntries,
        showInRewardList,
    };
}
exports.handleRoguePerRoundDrops = handleRoguePerRoundDrops;
