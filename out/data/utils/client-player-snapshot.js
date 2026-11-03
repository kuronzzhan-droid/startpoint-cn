"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializePlayerSnapshot = exports.serializePlayerRushEventPlayedParty = void 0;
const player_time_compat_1 = require("../../lib/player-time-compat");
const date_1 = require("./date");
const attention_config_1 = require("../../multi/attention-config");
const serialize_entities_1 = require("./serialize-entities");
const types_1 = require("../types");
const codeMap_1 = require("../codeMap");
const start_tutorial_state_1 = require("../../lib/start-tutorial-state");
const multi_special_exchange_1 = require("../../lib/multi-special-exchange");
const getServerTime = (date) => Math.floor(date.getTime() / 1000);
function serializePlayerRushEventPlayedParty(deserialized) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
    return {
        // The legacy client cannot decode MessagePack's undefined extension
        // (fixext1, 0xD4). Optional saved party slots must be explicit nulls.
        character_id_1: (_a = deserialized.characterIds[0]) !== null && _a !== void 0 ? _a : null,
        character_id_2: (_b = deserialized.characterIds[1]) !== null && _b !== void 0 ? _b : null,
        character_id_3: (_c = deserialized.characterIds[2]) !== null && _c !== void 0 ? _c : null,
        unison_character_id_1: (_d = deserialized.unisonCharacterIds[0]) !== null && _d !== void 0 ? _d : null,
        unison_character_id_2: (_e = deserialized.unisonCharacterIds[1]) !== null && _e !== void 0 ? _e : null,
        unison_character_id_3: (_f = deserialized.unisonCharacterIds[2]) !== null && _f !== void 0 ? _f : null,
        equipment_id_1: (_g = deserialized.equipmentIds[0]) !== null && _g !== void 0 ? _g : null,
        equipment_id_2: (_h = deserialized.equipmentIds[1]) !== null && _h !== void 0 ? _h : null,
        equipment_id_3: (_j = deserialized.equipmentIds[2]) !== null && _j !== void 0 ? _j : null,
        ability_soul_id_1: (_k = deserialized.abilitySoulIds[0]) !== null && _k !== void 0 ? _k : null,
        ability_soul_id_2: (_l = deserialized.abilitySoulIds[1]) !== null && _l !== void 0 ? _l : null,
        ability_soul_id_3: (_m = deserialized.abilitySoulIds[2]) !== null && _m !== void 0 ? _m : null,
        evolution_img_level_1: (_o = deserialized.evolutionImgLevels[0]) !== null && _o !== void 0 ? _o : null,
        evolution_img_level_2: (_p = deserialized.evolutionImgLevels[1]) !== null && _p !== void 0 ? _p : null,
        evolution_img_level_3: (_q = deserialized.evolutionImgLevels[2]) !== null && _q !== void 0 ? _q : null,
        unison_evolution_img_level_1: (_r = deserialized.unisonEvolutionImgLevels[0]) !== null && _r !== void 0 ? _r : null,
        unison_evolution_img_level_2: (_s = deserialized.unisonEvolutionImgLevels[1]) !== null && _s !== void 0 ? _s : null,
        unison_evolution_img_level_3: (_t = deserialized.unisonEvolutionImgLevels[2]) !== null && _t !== void 0 ? _t : null,
    };
}
exports.serializePlayerRushEventPlayedParty = serializePlayerRushEventPlayedParty;
function clearSerializedPlayedPartyMembers(party) {
    party.character_id_1 = party.character_id_2 = party.character_id_3 = null;
    party.unison_character_id_1 = party.unison_character_id_2 = party.unison_character_id_3 = null;
    party.evolution_img_level_1 = party.evolution_img_level_2 = party.evolution_img_level_3 = null;
    party.unison_evolution_img_level_1 = party.unison_evolution_img_level_2 = party.unison_evolution_img_level_3 = null;
}
/**
 * Serializes a player data object in the way that the world flipper client expects it.
 *
 * @param player The player data object to serialize.
 * @returns A serialized player data object.
 */
function serializePlayerSnapshot(toSerialize, context, options) {
    var _a, _b, _c, _d, _e, _f, _g;
    // convert userCharacterList (k_id → business code)
    const userCharacterList = {};
    for (const [characterId, character] of Object.entries(toSerialize.characterList)) {
        const kId = parseInt(characterId);
        const code = (0, codeMap_1.kIdToBusinessCode)(kId);
        const codeKey = String(code);
        // convert bond tokens
        const bondTokenList = (0, serialize_entities_1.serializeBondTokenStatuses)(character.bondTokenList);
        const converted_character = {
            "entry_count": character.entryCount,
            "evolution_level": character.evolutionLevel,
            "over_limit_step": character.overLimitStep,
            "protection": character.protection,
            "join_time": getServerTime(character.joinTime),
            "update_time": getServerTime(character.updateTime),
            "exp": character.exp,
            "stack": character.stack,
            "bond_token_list": bondTokenList,
            "mana_board_index": character.manaBoardIndex
        };
        const exBoost = character.exBoost;
        if (exBoost !== undefined) {
            converted_character['ex_boost'] = {
                "status_id": exBoost.statusId,
                "ability_id_list": exBoost.abilityIdList
            };
        }
        if (character.illustrationSettings !== undefined) {
            converted_character['illustration_settings'] = character.illustrationSettings;
        }
        // Set mana_board_awake from actual node awake levels (post-awakening data, not mission-based)
        const manaBoard = (_a = toSerialize.manaBoardAwakeMap) === null || _a === void 0 ? void 0 : _a.get(characterId);
        if (manaBoard) {
            converted_character.mana_board_awake = manaBoard;
        }
        userCharacterList[codeKey] = converted_character;
    }
    // convert parties
    const userPartyGroupList = (0, serialize_entities_1.serializePartyGroupList)(toSerialize.partyGroupList);
    // convert equipment list
    const userEquipmentList = {};
    for (const [equipmentId, equipment] of Object.entries(toSerialize.equipmentList)) {
        userEquipmentList[equipmentId] = {
            "enhancement_level": equipment.enhancementLevel,
            "level": equipment.level,
            "protection": equipment.protection,
            "stack": equipment.stack
        };
    }
    // convert player Quest Progress
    const userQuestProgress = {};
    for (const [section, progresses] of Object.entries(toSerialize.questProgress)) {
        const list = [];
        for (const progress of progresses) {
            list.push({
                "best_elapsed_time_ms": progress.bestElapsedTimeMs,
                "clear_rank": progress.clearRank,
                "finished": progress.finished,
                "host_finished": (_b = progress.hostFinished) !== null && _b !== void 0 ? _b : false,
                "high_score": (_c = progress.highScore) !== null && _c !== void 0 ? _c : 0,
                "quest_id": progress.questId,
                "unlocked": progress.unlocked
            });
        }
        userQuestProgress[section] = list;
    }
    // convert box gacha list
    const userBoxGachaList = {};
    for (const [section, list] of Object.entries(toSerialize.boxGachaList)) {
        userBoxGachaList[section] = list.map(boxGacha => {
            return {
                "box_id": boxGacha.boxId,
                "reset_times": boxGacha.resetTimes,
                "remaining_number": boxGacha.remainingNumber,
                "is_closed": boxGacha.isClosed
            };
        });
    }
    // handle tutorial
    let userTutorial = null;
    const playerData = toSerialize.player;
    const tutorialStep = playerData.tutorialStep;
    const hasFinishedMainQuest = ((_d = toSerialize.questProgress["1"]) !== null && _d !== void 0 ? _d : [])
        .some(progress => progress.finished);
    if (tutorialStep !== null
        && (0, start_tutorial_state_1.isStartTutorialActive)(tutorialStep, playerData.tutorialSkipFlag, hasFinishedMainQuest)) {
        userTutorial = {
            "viewer_id": (_e = options === null || options === void 0 ? void 0 : options.viewerId) !== null && _e !== void 0 ? _e : 0,
            "tutorial_step": tutorialStep,
            "skip_flag": playerData.tutorialSkipFlag
        };
        if (tutorialStep >= 1) {
            userTutorial["powerflip_failure"] = 0;
        }
    }
    const clientData = {
        "user_info": {
            "stamina": playerData.stamina,
            "stamina_heal_time": Math.floor((playerData.staminaHealTime.getTime() + context.timeOffset) / 1000),
            "boost_point": playerData.boostPoint,
            "boss_boost_point": playerData.bossBoostPoint,
            "transition_state": playerData.transitionState,
            "role": playerData.role,
            "name": playerData.name,
            "last_login_time": (0, date_1.clientSerializeDate)((0, player_time_compat_1.getPlayerClientMaintenanceDateSync)(playerData.id, playerData.lastLoginTime)),
            "comment": playerData.comment,
            "vmoney": playerData.vmoney,
            "free_vmoney": playerData.freeVmoney,
            "rank_point": playerData.rankPoint,
            "star_crumb": playerData.starCrumb,
            "bond_token": playerData.bondToken,
            "exp_pool": playerData.expPool,
            "exp_pooled_time": (0, player_time_compat_1.getPlayerClientExpTime)(playerData),
            "leader_character_id": playerData.leaderCharacterId != null ? (0, codeMap_1.kIdToBusinessCode)(playerData.leaderCharacterId) : 0,
            "party_slot": playerData.partySlot,
            "degree_id": (_f = playerData.degreeId) !== null && _f !== void 0 ? _f : 1,
            "birth": playerData.birth,
            "free_mana": playerData.freeMana,
            "paid_mana": playerData.paidMana,
            "enable_auto_3x": playerData.enableAuto3x
        },
        "premium_bonus_list": [],
        "expired_premium_bonus_list": null,
        "user_daily_challenge_point_list": toSerialize.dailyChallengePointList.map(dailyChallenge => {
            return {
                "id": dailyChallenge.id,
                "point": dailyChallenge.point,
                "campaign_list": dailyChallenge.campaignList.map(campaign => {
                    return {
                        "campaign_id": campaign.campaignId,
                        "additional_point": campaign.additionalPoint
                    };
                })
            };
        }),
        "bonus_index_list": null,
        "login_bonus_received_at": null,
        "user_notice_list": [],
        "user_triggered_tutorial": toSerialize.triggeredTutorial,
        "user_tutorial": userTutorial,
        "tutorial_gacha": toSerialize.player.tutorialGachaCharacterId !== null && toSerialize.player.tutorialGachaCharacterId !== undefined
            ? { character_id: toSerialize.player.tutorialGachaCharacterId }
            : null,
        "cleared_regular_mission_list": toSerialize.clearedRegularMissionList,
        "user_character_list": userCharacterList,
        "user_character_mana_node_list": (() => {
            var _a, _b;
            const awakeLevels = (_a = toSerialize.characterManaNodeAwakeLevels) !== null && _a !== void 0 ? _a : {};
            const list = {};
            for (const [charId, nodeIds] of Object.entries(toSerialize.characterManaNodeList)) {
                if (nodeIds.length > 0) {
                    const charLevels = (_b = awakeLevels[charId]) !== null && _b !== void 0 ? _b : {};
                    list[charId] = nodeIds.map(id => {
                        var _a;
                        return ({
                            multiplied_id: id,
                            awake_level: (_a = charLevels[id]) !== null && _a !== void 0 ? _a : 0
                        });
                    });
                }
            }
            return list;
        })(),
        "user_party_group_list": userPartyGroupList,
        "item_list": toSerialize.itemList,
        "user_equipment_list": userEquipmentList,
        "user_character_from_town_history": [],
        "quest_progress": userQuestProgress,
        "last_main_quest_id": null,
        "gacha_info_list": toSerialize.gachaInfoList.map(gachaInfo => {
            return {
                "gacha_id": gachaInfo.gachaId,
                "is_daily_first": gachaInfo.isDailyFirst,
                "is_account_first": gachaInfo.isAccountFirst,
                "gacha_exchange_point": gachaInfo.gachaExchangePoint
            };
        }),
        "available_asset_version": context.assetVersion,
        "should_prompt_takeover_registration": false,
        "has_unread_news_item": false,
        "user_option": toSerialize.userOption,
        "drawn_quest_list": toSerialize.drawnQuestList.map(drawnQuest => {
            return {
                "category_id": drawnQuest.categoryId,
                "quest_id": drawnQuest.questId,
                "odds_id": drawnQuest.oddsId
            };
        }),
        "mail_arrived": context.mailArrived,
        "user_periodic_reward_point_list": toSerialize.periodicRewardPointList,
        "all_active_mission_list": toSerialize.allActiveMissionList,
        "cleared_collect_item_event_mission_list": context.clearedCollectMissions,
        "box_gacha_list": userBoxGachaList,
        "gacha_campaign_list": toSerialize.gachaCampaignList.map(campaign => (0, serialize_entities_1.serializeGachaCampaign)(campaign)),
        "purchased_times_list": {
            "gs.kg.worldflipper.pakage_monthly": 0,
            "gs.kg.worldflipper.pakage_rank": 0,
            "gs.kg.worldflipper.pakage_monthly_90": 0,
            "gs.kg.worldflipper.pakage_monthly_stamina": 0,
            "gs.kg.worldflipper.pakage_monthly_kareido": 0,
            "gs.kg.worldflipper.pakage_monthly_boss": 0,
            "gs.kg.worldflipper.pakage_rank_2": 0,
            "gs.kg.worldflipper.pakage_rank_3_1": 0,
            "gs.kg.worldflipper.pakage_rank_4": 0,
            "gs.kg.worldflipper.pakage_challenge_boost": 0
        },
        "start_dash_exchange_campaign_list": toSerialize.startDashExchangeCampaignList.map(campaign => {
            return {
                "campaign_id": campaign.campaignId,
                "gacha_id": campaign.gachaId,
                "period_start_time": getServerTime(campaign.periodStartTime),
                "period_end_time": getServerTime(campaign.periodEndTime),
                "status": campaign.status,
                "term_index": campaign.termIndex
            };
        }),
        "multi_special_exchange_campaign_list": toSerialize.multiSpecialExchangeCampaignList.flatMap(saved => {
            const campaign = (0, multi_special_exchange_1.resolveMultiSpecialExchangeCampaign)(saved, id => { var _a; return (_a = toSerialize.itemList[String(id)]) !== null && _a !== void 0 ? _a : 0; });
            if (!campaign)
                return [];
            const serialized = {
                "campaign_id": campaign.campaignId,
                "status": campaign.status
            };
            if (campaign.ticketItemId !== null && campaign.ticketItemId !== undefined) {
                serialized.ticket_item_id = campaign.ticketItemId;
            }
            return [serialized];
        }),
        "associate_token": "associate_token",
        "config": Object.assign({ "summon_com_seconds": context.summonComSeconds }, (0, attention_config_1.getAttentionConfig)())
    };
    // add optional values
    // serialize rush event data
    if ((_g = options === null || options === void 0 ? void 0 : options.serializeRushEventData) !== null && _g !== void 0 ? _g : false) {
        // rush event list
        if (toSerialize.rushEventList !== undefined) {
            const userRushEventList = {};
            for (const rushEvent of toSerialize.rushEventList) {
                userRushEventList[rushEvent.eventId] = (0, serialize_entities_1.serializeRushEvent)(rushEvent);
            }
            clientData.user_rush_event_list = userRushEventList;
        }
        // cleared folder list
        clientData.user_rush_event_cleared_folder_list = toSerialize.rushEventClearedFolderList;
        // rush event played party list
        if (toSerialize.rushEventPlayedPartyList !== undefined) {
            const userRushEventPlayedPartyList = {};
            for (const [eventId, parties] of Object.entries(toSerialize.rushEventPlayedPartyList)) {
                const numericEventId = Number(eventId);
                const battleTypeBuckets = {
                    // Keep both buckets as empty maps. Leaving an unused
                    // bucket undefined emits MessagePack fixext1 (0xD4),
                    // which the legacy Android client rejects during /load.
                    [types_1.RushEventBattleType.FOLDER]: {},
                    [types_1.RushEventBattleType.ENDLESS]: {}
                };
                for (const party of parties) {
                    let bucket = battleTypeBuckets[party.battleType];
                    if (bucket === undefined) {
                        bucket = {};
                        battleTypeBuckets[party.battleType] = bucket;
                    }
                    const serializedParty = serializePlayerRushEventPlayedParty(party);
                    if ((context.mode15Enabled && numericEventId === context.mode15EventId && context.mode15Reuse)
                        || (context.mode15Enabled && numericEventId === context.mode15EventId && [5, 10, 15].includes(Math.abs(Math.trunc(party.round)) % 1000))) {
                        clearSerializedPlayedPartyMembers(serializedParty);
                    }
                    bucket[party.round] = serializedParty;
                }
                userRushEventPlayedPartyList[eventId] = battleTypeBuckets;
            }
            clientData.user_rush_event_played_party_list = userRushEventPlayedPartyList;
        }
    }
    if (options === null || options === void 0 ? void 0 : options.activeMissionList) {
        clientData.active_mission_list = options.activeMissionList;
    }
    return clientData;
}
exports.serializePlayerSnapshot = serializePlayerSnapshot;
