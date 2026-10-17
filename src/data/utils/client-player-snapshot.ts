import { getPlayerClientExpTime, getPlayerClientMaintenanceDateSync } from "../../lib/player-time-compat"
import { clientSerializeDate } from "./date"
import { getAttentionConfig } from "../../multi/attention-config"
import { serializeBondTokenStatuses, serializePartyGroupList, serializeGachaCampaign, serializeRushEvent } from "./serialize-entities"
import { ClientPlayerData, DailyChallengePointListEntry, MergedPlayerData, PartyCategory, Player, PlayerBoxGacha, PlayerCharacter, PlayerCharacterBondToken, PlayerDrawnQuest, PlayerEquipment, PlayerGachaCampaign, PlayerGachaInfo, PlayerMultiSpecialExchangeCampaign, PlayerParty, PlayerPartyGroup, PlayerQuestProgress, PlayerRushEvent, PlayerRushEventPlayedParty, PlayerStartDashExchangeCampaign, RushEventBattleType, UserBoxGacha, UserCharacter, UserCharacterBondTokenStatus, UserEquipment, UserGachaCampaign, UserMultiSpecialExchangeCampaignList, UserPartyGroup, UserPartyGroupTeam, UserQuestProgress, UserRushEvent, UserRushEventPlayedParty, UserRushEventPlayedPartyList, UserTutorial } from "../types"
import { kIdToBusinessCode } from "../codeMap"
import { isStartTutorialActive } from "../../lib/start-tutorial-state"
import { resolveMultiSpecialExchangeCampaign } from "../../lib/multi-special-exchange"
const getServerTime = (date: Date): number => Math.floor(date.getTime() / 1000)
export interface PlayerSerializationContext {
    assetVersion: string; timeOffset: number; mailArrived: boolean
    clearedCollectMissions: ClientPlayerData["cleared_collect_item_event_mission_list"]
    summonComSeconds: number; mode15Enabled: boolean; mode15EventId: number; mode15Reuse: boolean
}
export function serializePlayerRushEventPlayedParty(
    deserialized: PlayerRushEventPlayedParty
): UserRushEventPlayedParty {
    return {
        // The legacy client cannot decode MessagePack's undefined extension
        // (fixext1, 0xD4). Optional saved party slots must be explicit nulls.
        character_id_1: deserialized.characterIds[0] ?? null,
        character_id_2: deserialized.characterIds[1] ?? null,
        character_id_3: deserialized.characterIds[2] ?? null,
        unison_character_id_1: deserialized.unisonCharacterIds[0] ?? null,
        unison_character_id_2: deserialized.unisonCharacterIds[1] ?? null,
        unison_character_id_3: deserialized.unisonCharacterIds[2] ?? null,
        equipment_id_1: deserialized.equipmentIds[0] ?? null,
        equipment_id_2: deserialized.equipmentIds[1] ?? null,
        equipment_id_3: deserialized.equipmentIds[2] ?? null,
        ability_soul_id_1: deserialized.abilitySoulIds[0] ?? null,
        ability_soul_id_2: deserialized.abilitySoulIds[1] ?? null,
        ability_soul_id_3: deserialized.abilitySoulIds[2] ?? null,
        evolution_img_level_1: deserialized.evolutionImgLevels[0] ?? null,
        evolution_img_level_2: deserialized.evolutionImgLevels[1] ?? null,
        evolution_img_level_3: deserialized.evolutionImgLevels[2] ?? null,
        unison_evolution_img_level_1: deserialized.unisonEvolutionImgLevels[0] ?? null,
        unison_evolution_img_level_2: deserialized.unisonEvolutionImgLevels[1] ?? null,
        unison_evolution_img_level_3: deserialized.unisonEvolutionImgLevels[2] ?? null,
    }
}
export interface SerializePlayerDataOptions {
    viewerId?: number
    serializeRushEventData?: boolean // should rush event data be serialized?
    activeMissionList?: { mission_id: number; progress_value: number; stages: { stage: number; received: boolean }[] }[]
}

function clearSerializedPlayedPartyMembers(
    party: UserRushEventPlayedParty,
): void {
    party.character_id_1 = party.character_id_2 = party.character_id_3 = null
    party.unison_character_id_1 = party.unison_character_id_2 = party.unison_character_id_3 = null
    party.evolution_img_level_1 = party.evolution_img_level_2 = party.evolution_img_level_3 = null
    party.unison_evolution_img_level_1 = party.unison_evolution_img_level_2 = party.unison_evolution_img_level_3 = null
}


/**
 * Serializes a player data object in the way that the world flipper client expects it.
 *
 * @param player The player data object to serialize.
 * @returns A serialized player data object.
 */
export function serializePlayerSnapshot(
    toSerialize: MergedPlayerData,
    context: PlayerSerializationContext,
    options?: SerializePlayerDataOptions
): ClientPlayerData {

    // convert userCharacterList (k_id → business code)
    const userCharacterList: Record<string, UserCharacter> = {}
    for (const [characterId, character] of Object.entries(toSerialize.characterList)) {
        const kId = parseInt(characterId);
        const code = kIdToBusinessCode(kId);
        const codeKey = String(code);
        // convert bond tokens
        const bondTokenList = serializeBondTokenStatuses(character.bondTokenList);
        const converted_character: UserCharacter = {
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
        }

        const exBoost = character.exBoost
        if (exBoost !== undefined) {
            converted_character['ex_boost'] = {
                "status_id": exBoost.statusId,
                "ability_id_list": exBoost.abilityIdList
            }
        }

        if (character.illustrationSettings !== undefined) {
            converted_character['illustration_settings'] = character.illustrationSettings
        }

        // Set mana_board_awake from actual node awake levels (post-awakening data, not mission-based)
        const manaBoard = toSerialize.manaBoardAwakeMap?.get(characterId)
        if (manaBoard) {
            converted_character.mana_board_awake = manaBoard
        }

        userCharacterList[codeKey] = converted_character
    }

    // convert parties
    const userPartyGroupList: Record<string, UserPartyGroup> = serializePartyGroupList(toSerialize.partyGroupList)

    // convert equipment list
    const userEquipmentList: Record<string, UserEquipment> = {}
    for (const [equipmentId, equipment] of Object.entries(toSerialize.equipmentList)) {
        userEquipmentList[equipmentId] = {
            "enhancement_level": equipment.enhancementLevel,
            "level": equipment.level,
            "protection": equipment.protection,
            "stack": equipment.stack
        }
    }

    // convert player Quest Progress
    const userQuestProgress: Record<string, UserQuestProgress[]> = {}
    for (const [section, progresses] of Object.entries(toSerialize.questProgress)) {
        const list: UserQuestProgress[] = []
        for (const progress of progresses) {
            list.push({
                "best_elapsed_time_ms": progress.bestElapsedTimeMs,
                "clear_rank": progress.clearRank,
                "finished": progress.finished,
                "host_finished": progress.hostFinished ?? false,
                "high_score": progress.highScore ?? 0,
                "quest_id": progress.questId,
                "unlocked": progress.unlocked
            })
        }
        userQuestProgress[section] = list
    }

    // convert box gacha list
    const userBoxGachaList: Record<string, UserBoxGacha[]> = {}
    for (const [section, list] of Object.entries(toSerialize.boxGachaList)) {
        userBoxGachaList[section] = list.map(boxGacha => {
            return {
                "box_id": boxGacha.boxId,
                "reset_times": boxGacha.resetTimes,
                "remaining_number": boxGacha.remainingNumber,
                "is_closed": boxGacha.isClosed
            }
        })
    }

    // handle tutorial
    let userTutorial: UserTutorial | null = null
    const playerData = toSerialize.player
    const tutorialStep = playerData.tutorialStep
    const hasFinishedMainQuest = (toSerialize.questProgress["1"] ?? [])
        .some(progress => progress.finished)
    if (
        tutorialStep !== null
        && isStartTutorialActive(
            tutorialStep,
            playerData.tutorialSkipFlag,
            hasFinishedMainQuest,
        )
    ) {
        userTutorial = {
            "viewer_id": options?.viewerId ?? 0,
            "tutorial_step": tutorialStep,
            "skip_flag": playerData.tutorialSkipFlag
        }

        if (tutorialStep >= 1) {
            userTutorial["powerflip_failure"] = 0
        }
    }

    const clientData: ClientPlayerData = {
        "user_info": {
            "stamina": playerData.stamina,
            "stamina_heal_time": Math.floor((playerData.staminaHealTime.getTime() + context.timeOffset) / 1000),
            "boost_point": playerData.boostPoint,
            "boss_boost_point": playerData.bossBoostPoint,
            "transition_state": playerData.transitionState,
            "role": playerData.role,
            "name": playerData.name,
            "last_login_time": clientSerializeDate(getPlayerClientMaintenanceDateSync(playerData.id, playerData.lastLoginTime)),
            "comment": playerData.comment,
            "vmoney": playerData.vmoney,
            "free_vmoney": playerData.freeVmoney,
            "rank_point": playerData.rankPoint,
            "star_crumb": playerData.starCrumb,
            "bond_token": playerData.bondToken,
            "exp_pool": playerData.expPool,
            "exp_pooled_time": getPlayerClientExpTime(playerData),
            "leader_character_id": playerData.leaderCharacterId != null ? kIdToBusinessCode(playerData.leaderCharacterId) : 0,
            "party_slot": playerData.partySlot,
            "degree_id": playerData.degreeId ?? 1,
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
                    }
                })
            }
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
                const awakeLevels = toSerialize.characterManaNodeAwakeLevels ?? {}
                const list: Record<string, { multiplied_id: number, awake_level: number }[]> = {}
                for (const [charId, nodeIds] of Object.entries(toSerialize.characterManaNodeList)) {
                    if (nodeIds.length > 0) {
                        const charLevels = awakeLevels[charId] ?? {}
                        list[charId] = nodeIds.map(id => ({
                            multiplied_id: id,
                            awake_level: charLevels[id] ?? 0
                        }))
                    }
                }
                return list
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
            }
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
            }
        }),
        "mail_arrived": context.mailArrived,
        "user_periodic_reward_point_list": toSerialize.periodicRewardPointList,
        "all_active_mission_list": toSerialize.allActiveMissionList,
        "cleared_collect_item_event_mission_list": context.clearedCollectMissions,
        "box_gacha_list": userBoxGachaList,
        "gacha_campaign_list": toSerialize.gachaCampaignList.map(campaign => serializeGachaCampaign(campaign)),
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
            }
        }),
        "multi_special_exchange_campaign_list": toSerialize.multiSpecialExchangeCampaignList.flatMap(saved => {
            const campaign = resolveMultiSpecialExchangeCampaign(saved, id => toSerialize.itemList[String(id)] ?? 0)
            if (!campaign) return []
            const serialized: UserMultiSpecialExchangeCampaignList = {
                "campaign_id": campaign.campaignId,
                "status": campaign.status
            }
            if (campaign.ticketItemId !== null && campaign.ticketItemId !== undefined) {
                serialized.ticket_item_id = campaign.ticketItemId
            }
            return [serialized]
        }),
        "associate_token": "associate_token",
        "config": {
            "summon_com_seconds": context.summonComSeconds,
            ...getAttentionConfig(),
        }
    }

    // add optional values

    // serialize rush event data
    if (options?.serializeRushEventData ?? false) {
        // rush event list
        if (toSerialize.rushEventList !== undefined) {
            const userRushEventList: Record<string, UserRushEvent> = {}
            for (const rushEvent of toSerialize.rushEventList) {
                userRushEventList[rushEvent.eventId] = serializeRushEvent(rushEvent)
            }
            clientData.user_rush_event_list = userRushEventList
        }

        // cleared folder list
        clientData.user_rush_event_cleared_folder_list = toSerialize.rushEventClearedFolderList

        // rush event played party list
        if (toSerialize.rushEventPlayedPartyList !== undefined) {
            const userRushEventPlayedPartyList: UserRushEventPlayedPartyList = {}

            for (const [eventId, parties] of Object.entries(toSerialize.rushEventPlayedPartyList)) {
                const numericEventId = Number(eventId)
                const battleTypeBuckets: Record<RushEventBattleType, Record<string, UserRushEventPlayedParty> | undefined> = {
                    // Keep both buckets as empty maps. Leaving an unused
                    // bucket undefined emits MessagePack fixext1 (0xD4),
                    // which the legacy Android client rejects during /load.
                    [RushEventBattleType.FOLDER]: {},
                    [RushEventBattleType.ENDLESS]: {}
                }
                for (const party of parties) {
                    let bucket = battleTypeBuckets[party.battleType]
                    if (bucket === undefined) {
                        bucket = {}
                        battleTypeBuckets[party.battleType] = bucket
                    }
                    const serializedParty = serializePlayerRushEventPlayedParty(party)
                    if (
                        (context.mode15Enabled && numericEventId === context.mode15EventId && context.mode15Reuse)
                        || (context.mode15Enabled && numericEventId === context.mode15EventId && [5, 10, 15].includes(Math.abs(Math.trunc(party.round)) % 1000))
                    ) {
                        clearSerializedPlayedPartyMembers(serializedParty)
                    }
                    bucket[party.round] = serializedParty
                }
                userRushEventPlayedPartyList[eventId] = battleTypeBuckets as Record<RushEventBattleType, Record<string, UserRushEventPlayedParty>>
            }
            clientData.user_rush_event_played_party_list = userRushEventPlayedPartyList
        }
    }

    if (options?.activeMissionList) {
        (clientData as any).active_mission_list = options.activeMissionList
    }

    return clientData
}
