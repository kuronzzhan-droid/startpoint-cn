"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.givePlayerRewardSync = exports.givePlayerRewardsSync = exports.givePlayerScoreRewardsSync = void 0;
const crypto_1 = require("crypto");
const player_1 = require("../data/domains/player");
const item_1 = require("../data/domains/item");
const assets_1 = require("./assets");
const character_1 = require("./character");
const equipment_1 = require("./equipment");
const types_1 = require("./types");
const reward_element_map_json_1 = __importDefault(require("../../assets/reward_element_map.json"));
const game_logging_1 = require("./game-logging");
const mana_1 = require("./mana");
const reward_profile_1 = require("./boss/reward-profile");
const ELEMENT_TO_ENEMY_MAP = {
    0: 3, 1: 0, 2: 1, 3: 2, 4: 5, 5: 4,
};
function resolveElementItemId(rarity, questElement) {
    if (typeof questElement !== "number" || !Number.isInteger(questElement) || questElement < 0 || questElement > 5) {
        console.warn(`[QUEST] Invalid or missing questElement=${questElement} for ELEMENT reward rarity=${rarity}; skipping reward.`);
        return null;
    }
    const enemyElement = ELEMENT_TO_ENEMY_MAP[questElement];
    const map = reward_element_map_json_1.default;
    return Number(map["1"][String(rarity)][String(enemyElement)][0][0]);
}
function resolveAetherItemId(rarity, questElement) {
    if (typeof questElement !== "number" || !Number.isInteger(questElement) || questElement < 0 || questElement > 5) {
        console.warn(`[QUEST] Invalid or missing questElement=${questElement} for AETHER reward rarity=${rarity}; skipping reward.`);
        return null;
    }
    const enemyElement = ELEMENT_TO_ENEMY_MAP[questElement];
    const map = reward_element_map_json_1.default;
    return Number(map["2"][String(rarity)][String(enemyElement)][0][0]);
}
/**
 * Grants a player score rewards.
 *
 * @param playerId The ID of the player.
 * @param groupId The ID of the score reward group.
 * @param scoreRewards The score rewards inside of the group.
 * @param bossRewardContext Optional permanent-boss reward context. When it
 * is present, only the matching profile applies its mode-specific token count
 * and exact rare-pool roll.
 * @returns A result detailing what was added/changed.
 */
function givePlayerScoreRewardsSync(playerId, groupId, scoreRewards, boostPointUsed = false, questElement, bossRewardContext) {
    var _a, _b, _c;
    const dropScoreRewardIds = [];
    const dropRareRewardIds = [];
    let mana = 0;
    let vmoney = 0;
    let expPool = 0;
    let joinedCharacterIdList = [];
    let characterList = [];
    let equipmentList = [];
    let items = {};
    if (scoreRewards != null && groupId != null) {
        const dropMultiplier = parseFloat(process.env.DROP_MULTIPLIER || '1');
        const bossRewardProfile = (0, reward_profile_1.getBossRewardProfile)(bossRewardContext === null || bossRewardContext === void 0 ? void 0 : bossRewardContext.questId, groupId);
        (0, game_logging_1.gameVerboseLog)(() => `[QUEST] givePlayerScoreRewards group=${groupId} items=${scoreRewards.length} pid=${playerId}`);
        let seqIndex = 0;
        for (const scoreReward of scoreRewards) {
            seqIndex += 1;
            const rewardIndex = (_a = scoreReward.position) !== null && _a !== void 0 ? _a : seqIndex;
            switch (scoreReward.type) {
                case types_1.ScoreRewardType.ITEM: {
                    const reward = scoreReward;
                    let rewardAmount = 0;
                    switch (reward.reward_type) {
                        case types_1.RewardType.ITEM: {
                            const itemReward = reward;
                            const itemId = itemReward.id;
                            const isBossToken = bossRewardProfile !== null
                                && (bossRewardContext === null || bossRewardContext === void 0 ? void 0 : bossRewardContext.mode) !== undefined
                                && bossRewardProfile.tokenItemId === itemId;
                            if (isBossToken) {
                                // The boss contract is per clear: an enabled
                                // drop multiplier or boost never changes the
                                // advertised 1/3 token count.
                                rewardAmount = (0, reward_profile_1.resolveBossTokenCount)(bossRewardProfile, bossRewardContext.mode);
                            }
                            else {
                                const itemDropMultiplier = itemReward.ignore_drop_multiplier ? 1 : dropMultiplier;
                                rewardAmount = itemReward.count * itemDropMultiplier * (boostPointUsed ? 2 : 1);
                            }
                            items[String(itemId)] = (0, item_1.givePlayerItemSync)(playerId, itemId, rewardAmount);
                            (0, game_logging_1.gameVerboseLog)(() => isBossToken
                                ? `[QUEST-ITEM] bossProfile=${bossRewardProfile.profileId} mode=${bossRewardContext.mode} id=${itemId} fixedCount=${rewardAmount}`
                                : `[QUEST-ITEM] id=${itemId} cdnCount=${itemReward.count} ×drop=${itemReward.ignore_drop_multiplier ? 1 : dropMultiplier} ×boost=${boostPointUsed ? 2 : 1} → ${rewardAmount}`);
                            break;
                        }
                        case types_1.RewardType.MANA: {
                            const player = (0, player_1.getPlayerSync)(playerId);
                            const currencyReward = reward;
                            rewardAmount = currencyReward.count * dropMultiplier * (boostPointUsed ? 2 : 1);
                            const manaGrant = (0, mana_1.calculateFreeManaGrant)({
                                freeMana: (_b = player === null || player === void 0 ? void 0 : player.freeMana) !== null && _b !== void 0 ? _b : 0,
                                paidMana: (_c = player === null || player === void 0 ? void 0 : player.paidMana) !== null && _c !== void 0 ? _c : 0,
                            }, rewardAmount);
                            mana += manaGrant.creditedMana;
                            (0, player_1.updatePlayerSync)({
                                id: playerId,
                                freeMana: manaGrant.freeMana,
                                totalManaObtained: ((player === null || player === void 0 ? void 0 : player.totalManaObtained) || 0) + rewardAmount
                            });
                            break;
                        }
                        case types_1.RewardType.EXP: {
                            const currencyReward = reward;
                            rewardAmount = currencyReward.count * dropMultiplier * (boostPointUsed ? 2 : 1);
                            expPool += rewardAmount;
                            (0, player_1.adjustPlayerExpPoolSync)(playerId, rewardAmount, 'quest_score_reward');
                            break;
                        }
                        case types_1.RewardType.ELEMENT: {
                            const itemReward = reward;
                            const itemId = resolveElementItemId(itemReward.id, questElement);
                            if (itemId === null)
                                continue;
                            rewardAmount = itemReward.count * dropMultiplier * (boostPointUsed ? 2 : 1);
                            items[String(itemId)] = (0, item_1.givePlayerItemSync)(playerId, itemId, rewardAmount);
                            (0, game_logging_1.gameVerboseLog)(() => `[QUEST-ELEMENT] rarity=${itemReward.id} →id=${itemId} cdnCount=${itemReward.count} ×drop=${dropMultiplier} ×boost=${boostPointUsed ? 2 : 1} → ${rewardAmount}`);
                            break;
                        }
                        case types_1.RewardType.AETHER: {
                            const itemReward = reward;
                            const itemId = resolveAetherItemId(itemReward.id, questElement);
                            if (itemId === null)
                                continue;
                            rewardAmount = itemReward.count * dropMultiplier * (boostPointUsed ? 2 : 1);
                            items[String(itemId)] = (0, item_1.givePlayerItemSync)(playerId, itemId, rewardAmount);
                            (0, game_logging_1.gameVerboseLog)(() => `[QUEST-AETHER] rarity=${itemReward.id} →id=${itemId} cdnCount=${itemReward.count} ×drop=${dropMultiplier} ×boost=${boostPointUsed ? 2 : 1} → ${rewardAmount}`);
                            break;
                        }
                    }
                    dropScoreRewardIds.push({
                        group_id: groupId,
                        index: rewardIndex,
                        number: rewardAmount
                    });
                    break;
                }
                case types_1.ScoreRewardType.RARE_POOL: {
                    const reward = scoreReward;
                    const exactBossRarePool = bossRewardProfile !== null
                        && bossRewardProfile.rareGroupId === reward.id;
                    const rarePoolHit = exactBossRarePool
                        ? (0, crypto_1.randomInt)(0, 10000) < bossRewardProfile.rareChanceBasisPoints
                        : reward.rarity >= (0, crypto_1.randomInt)(0, 100) / 100;
                    if (rarePoolHit) {
                        // give reward from group
                        // TODO: implement RareScoreReward rarity using .rarity field instead of having an even chance between all items in pool
                        const rareGroupId = reward.id;
                        const group = (0, assets_1.getRareScoreRewardGroup)(rareGroupId);
                        (0, game_logging_1.gameVerboseLog)(() => {
                            var _a, _b;
                            return exactBossRarePool
                                ? `[QUEST] RARE_POOL profile=${bossRewardProfile.profileId} rareGroup=${rareGroupId} chanceBp=${bossRewardProfile.rareChanceBasisPoints} found=${group !== null} items=${(_a = group === null || group === void 0 ? void 0 : group.length) !== null && _a !== void 0 ? _a : 0}`
                                : `[QUEST] RARE_POOL rareGroup=${rareGroupId} found=${group !== null} items=${(_b = group === null || group === void 0 ? void 0 : group.length) !== null && _b !== void 0 ? _b : 0}`;
                        });
                        if (group !== null) {
                            const random_index = 1 >= group.length ? 0 : (0, crypto_1.randomInt)(group.length);
                            const reward = group[random_index];
                            const result = givePlayerRewardSync(playerId, reward, questElement);
                            const rareElementSkipped = (reward.type === types_1.RewardType.ELEMENT || reward.type === types_1.RewardType.AETHER)
                                && (!result || Object.keys(result.items).length === 0);
                            if (result && !rareElementSkipped) {
                                // merge arrays
                                mana += result.user_info.free_mana;
                                vmoney += result.user_info.free_vmoney;
                                joinedCharacterIdList = [...joinedCharacterIdList, ...result.joined_character_id_list];
                                characterList = [...characterList, ...result.character_list];
                                equipmentList = [...equipmentList, ...result.equipment_list];
                                // merge items: RARE_POOL result.items already contains DB totals
                                // (includes any earlier ITEM path writes), so just use latest value
                                for (const [itemId, count] of Object.entries(result.items)) {
                                    items[itemId] = count;
                                }
                                // calculate number
                                let number = 0;
                                switch (reward.type) {
                                    case types_1.RewardType.ITEM:
                                    case types_1.RewardType.EQUIPMENT:
                                    case types_1.RewardType.ELEMENT:
                                    case types_1.RewardType.AETHER:
                                        number = reward.count;
                                        break;
                                    case types_1.RewardType.CHARACTER:
                                        number = 1;
                                        break;
                                    case types_1.RewardType.BEADS:
                                    case types_1.RewardType.EXP:
                                    case types_1.RewardType.MANA:
                                        number = reward.count;
                                        break;
                                }
                                // add reward id to table
                                dropRareRewardIds.push({
                                    group_id: rareGroupId,
                                    index: random_index + 1,
                                    number: number
                                });
                            }
                        }
                    }
                    break;
                }
            }
        }
    }
    if (Object.keys(items).length > 0) {
        (0, game_logging_1.gameVerboseLog)(() => `[QUEST-BAG] total items bagged: ${JSON.stringify(items)}`);
    }
    return {
        drop_score_reward_ids: dropScoreRewardIds,
        drop_rare_reward_ids: dropRareRewardIds,
        user_info: {
            free_mana: mana,
            free_vmoney: vmoney,
            exp_pool: expPool
        },
        character_list: characterList,
        joined_character_id_list: joinedCharacterIdList,
        equipment_list: equipmentList,
        items: items
    };
}
exports.givePlayerScoreRewardsSync = givePlayerScoreRewardsSync;
/**
 * Batch gives a specific player data an array of rewards.
 *
 * @param playerId The ID of the player to reward.
 * @param rewards The array of rewards to give.
 * @param questElement Optional quest element (0..5) used to resolve ELEMENT/AETHER rewards.
 * @returns A PlayerRewardResult.
 */
function givePlayerRewardsSync(playerId, rewards, questElement) {
    let mana = 0;
    let vmoney = 0;
    let expPool = 0;
    let joinedCharacterIdList = [];
    let characters = new Map();
    let equipment = new Map();
    let items = new Map();
    for (const reward of rewards) {
        switch (reward.type) {
            case types_1.RewardType.ITEM: {
                const convertedReward = reward;
                const itemId = convertedReward.id;
                const result = (0, item_1.givePlayerItemSync)(playerId, itemId, convertedReward.count);
                items.set(itemId, result);
                break;
            }
            case types_1.RewardType.EQUIPMENT: {
                const convertedReward = reward;
                const equipmentId = convertedReward.id;
                const result = (0, equipment_1.givePlayerEquipmentSync)(playerId, equipmentId, convertedReward.count);
                equipment.set(equipmentId, result);
                break;
            }
            case types_1.RewardType.CHARACTER: {
                const characterId = reward.id;
                const giveResult = (0, character_1.givePlayerCharacterSync)(playerId, characterId);
                const giveItem = giveResult === null || giveResult === void 0 ? void 0 : giveResult.item;
                if (giveItem !== undefined) {
                    const itemId = giveItem.id;
                    items.set(itemId, giveItem.inventoryCount);
                }
                const giveCharacter = giveResult === null || giveResult === void 0 ? void 0 : giveResult.character;
                if (giveCharacter !== undefined) {
                    // Later copies only carry stack updates; retain the initial
                    // entry_count and other fields needed to create a new character.
                    const existingCharacter = characters.get(characterId);
                    characters.set(characterId, Object.assign(Object.assign({}, existingCharacter), giveCharacter));
                }
                break;
            }
            case types_1.RewardType.BEADS: {
                vmoney += reward.count;
                break;
            }
            case types_1.RewardType.MANA: {
                mana += reward.count;
                break;
            }
            case types_1.RewardType.EXP: {
                expPool += reward.count;
                break;
            }
            case types_1.RewardType.ELEMENT: {
                const convertedReward = reward;
                const itemId = resolveElementItemId(convertedReward.id, questElement);
                if (itemId === null)
                    break;
                const result = (0, item_1.givePlayerItemSync)(playerId, itemId, convertedReward.count);
                items.set(itemId, result);
                break;
            }
            case types_1.RewardType.AETHER: {
                const convertedReward = reward;
                const itemId = resolveAetherItemId(convertedReward.id, questElement);
                if (itemId === null)
                    break;
                const result = (0, item_1.givePlayerItemSync)(playerId, itemId, convertedReward.count);
                items.set(itemId, result);
                break;
            }
        }
    }
    if (mana > 0 || vmoney > 0 || expPool > 0) {
        // get player
        const player = (0, player_1.getPlayerSync)(playerId);
        if (player === null)
            return null;
        const requestedMana = mana;
        const manaGrant = (0, mana_1.calculateFreeManaGrant)(player, requestedMana);
        mana = manaGrant.creditedMana;
        (0, player_1.updatePlayerSync)({
            id: playerId,
            freeVmoney: player.freeVmoney + vmoney,
            freeMana: manaGrant.freeMana,
            totalManaObtained: (player.totalManaObtained || 0) + requestedMana
        });
        if (expPool > 0)
            (0, player_1.adjustPlayerExpPoolSync)(playerId, expPool, 'player_reward');
    }
    // build return values
    const characterList = [];
    const equipmentList = [];
    const itemsRecord = {};
    characters.forEach(character => {
        characterList.push(character);
    });
    equipment.forEach(equipment => {
        equipmentList.push(equipment);
    });
    items.forEach((number, id) => {
        itemsRecord[id] = number;
    });
    return {
        user_info: {
            free_mana: mana,
            free_vmoney: vmoney,
            exp_pool: expPool
        },
        character_list: characterList,
        joined_character_id_list: joinedCharacterIdList,
        equipment_list: equipmentList,
        items: itemsRecord
    };
}
exports.givePlayerRewardsSync = givePlayerRewardsSync;
/**
 * Gives a player a specific reward.
 *
 * @param playerId The ID of the player.
 * @param reward The reward to give.
 * @returns A PlayerRewardResult.
 */
function givePlayerRewardSync(playerId, reward, questElement) {
    return givePlayerRewardsSync(playerId, [reward], questElement);
}
exports.givePlayerRewardSync = givePlayerRewardSync;
