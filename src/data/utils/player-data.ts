import { preparePlayerSerialization, SerializePlayerDataOptions } from "./serialize-player"
import { serializePlayerSnapshot } from "./client-player-snapshot"
import { getDateFromServerTime, getServerTime, getServerDate, getTimeOffset, realToVirtual } from "../../utils"
import { ClientPlayerData, DailyChallengePointListEntry, MergedPlayerData, PartyCategory, Player, PlayerBoxGacha, PlayerCharacter, PlayerCharacterBondToken, PlayerDrawnQuest, PlayerEquipment, PlayerGachaCampaign, PlayerGachaInfo, PlayerMultiSpecialExchangeCampaign, PlayerParty, PlayerPartyGroup, PlayerQuestProgress, PlayerRushEvent, PlayerRushEventPlayedParty, PlayerStartDashExchangeCampaign, RushEventBattleType, UserBoxGacha, UserCharacter, UserCharacterBondTokenStatus, UserEquipment, UserGachaCampaign, UserPartyGroup, UserPartyGroupTeam, UserQuestProgress, UserRushEvent, UserRushEventPlayedParty, UserRushEventPlayedPartyList, UserTutorial } from "../types"
import { deserializePlayerRushEventPlayedParty, deserializeRushEvent, getPlayerRushEventListClearedFoldersSync, getPlayerRushEventListPlayedPartiesSync, getPlayerRushEventListSync, serializePlayerRushEventPlayedParty } from "../domains/rushEvent"
import { getPlayerActiveMissionsSync, getPlayerCategoryMissionListSync, getPlayerClearedRegularMissionListSync } from "../domains/mission"
import { getPlayerBoxGachasSync } from "../domains/boxGacha"
import { getPlayerCharactersManaNodesSync, getPlayerCharactersSync, getPlayerCharactersManaNodeAwakeLevelsSync, updatePlayerCharacterManaNodeAwakeLevelSync } from "../domains/character"
import { getPlayerDailyChallengePointListSync, getPlayerSync, updatePlayerSync } from "../domains/player"
import { getPlayerDrawnQuestsSync, getPlayerQuestProgressSync } from "../domains/quest"
import { getPlayerEquipmentListSync } from "../domains/equipment"
import { getPlayerGachaCampaignListSync, getPlayerGachaInfoListSync } from "../domains/gacha"
import { getPlayerItemsSync } from "../domains/item"
import { getPlayerMailCountSync } from "../domains/mail"
import { getPlayerMultiSpecialExchangeCampaignsSync, getPlayerPeriodicRewardPointsSync, getPlayerStartDashExchangeCampaignsSync } from "../domains/campaign"
import { getPlayerOptionsSync } from "../domains/option"
import { getPlayerPartyGroupListSync } from "../domains/party"
import { getPlayerTriggeredTutorialsSync } from "../domains/tutorial"
import { computeAwakeSummary, filterToActiveMissions, reconcileAwakeUnlocksFromProgress } from "../../lib/mission/index"
import {
    computeManaBoardAwakeFromNodes,
    filterCharacterManaBoardAwakeLevels,
    mergeManaBoardAwakeMaps,
    reconcilePlayerManaBoardCompletionSync,
} from "../../lib/character-helpers"
import { getDb } from "../db"
import { getCarnivalSaveStateSync } from "../../lib/carnival-save-state"
import { getContentSnapshot } from "../../content/runtime/content-snapshot"
import { collectLinkedManaNodeAwakeUpdates } from "../../lib/character-awake-extension"
import { getPlayerPortableDegreesSync } from "../domains/degree"
import { runPersistenceTransactionSync } from "../../lib/persistence-coordinator"

export interface ClientSerializedDataOptions extends SerializePlayerDataOptions {
    /** Fresh request-local snapshot; callers remain responsible for invalidating stale data. */
    preloadedPlayer?: Player
    preloadedCharacterList?: Record<string, PlayerCharacter>
    preloadedCharacterManaNodeList?: Record<string, number[]>
    preloadedEquipmentList?: Record<string, PlayerEquipment>
    preloadedPartyGroupList?: Record<string, PlayerPartyGroup>
    preloadedQuestProgress?: Record<string, PlayerQuestProgress[]>
    /**
     * Called once the load-time repairs below are written, before the
     * read-only serialization queries. /load commits its shared write
     * transaction here.
     */
    afterRepairs?: () => void
}

/**
 * Generates default player data.
 * 
 * @returns The generated default player data.
 */
export function getDefaultPlayerData(): Omit<Player, 'id'> {
    const now = getServerDate();
    // Default values aligned with CN client PlayerSaveDataTools.createDummy()
    return {
        stamina: 10,
        staminaHealTime: new Date(),
        boostPoint: 10,
        bossBoostPoint: 3,
        transitionState: 0,
        role: 1,
        name: "冒险者",
        lastLoginTime: now,
        comment: "よろしくお願いします",
        vmoney: 100,
        freeVmoney: 10000,
        rankPoint: 0,
        starCrumb: 20000,
        bondToken: 10,
        expPool: 0,
        expPooledTime: now,
        leaderCharacterId: 1,
        partySlot: 1,
        degreeId: 1,
        birth: 19900101,
        freeMana: 20000,
        paidMana: 2000,
        enableAuto3x: false,
        totalStaminaUsed: 0,
        totalPowerflips: 0,
        totalDashes: 0,
        totalManaObtained: 0,
        maxComboAchieved: 0,
        totalLoginDays: 1,
        tutorialStep: 0,
        tutorialSkipFlag: null,
        tutorialGachaCharacterId: null,
        // Records the virtual-time offset under which timestamped save fields
        // were written. EXP-pool settlement uses it to preserve real elapsed
        // time when the global virtual clock is moved.
        timeOffset: getTimeOffset() ?? 0
    }
}



/**
 * Takes a playerID and returns all of the necessary data for the game client.
 * 
 * @param playerId 
 * @param viewerId 
 * @returns 
 */
export function getClientSerializedData(
    playerId: number,
    options: ClientSerializedDataOptions
): ClientPlayerData | null {
    const prepared = prepareClientSerializedData(playerId, options)
    return prepared ? serializePlayerSnapshot(prepared.data, prepared.context, prepared.options) : null
}

export function prepareClientSerializedData(
    playerId: number,
    options: ClientSerializedDataOptions,
) {
    const {
        preloadedPlayer,
        preloadedCharacterList,
        preloadedCharacterManaNodeList,
        preloadedEquipmentList,
        preloadedPartyGroupList,
        preloadedQuestProgress,
        afterRepairs,
        ...serializeOptions
    } = options
    if (preloadedPlayer && preloadedPlayer.id !== playerId) {
        throw new Error(`Player snapshot ${preloadedPlayer.id} does not match ${playerId}.`)
    }

    // Old/imported saves can lack the bond-token row that marks a completed
    // base board as receivable. Repair it before loading the response snapshot.
    reconcilePlayerManaBoardCompletionSync(
        playerId,
        undefined,
        preloadedCharacterList && preloadedCharacterManaNodeList
            ? {
                characters: preloadedCharacterList,
                learnedNodes: preloadedCharacterManaNodeList,
            }
            : undefined,
    )

    const playerData = preloadedPlayer ?? getPlayerSync(playerId)
    if (playerData === null) {
        afterRepairs?.()
        return null
    }
    const characterList = preloadedCharacterList ?? getPlayerCharactersSync(playerId)
    const learnedManaNodes = preloadedCharacterManaNodeList
        ?? getPlayerCharactersManaNodesSync(playerId)
    const playerQuestProgress = preloadedQuestProgress ?? getPlayerQuestProgressSync(playerId)

    const doSerializeRushEventData = serializeOptions.serializeRushEventData ?? false

    // Compute awake mission summary for /load injection
    const awakeSummary = computeAwakeSummary(playerId, {
        player: playerData,
        characterList,
        questProgress: playerQuestProgress,
    })
    awakeSummary.manaBoardAwakeMap = reconcileAwakeUnlocksFromProgress(
        playerId,
        awakeSummary.activeMissionList.map(mission => ({
            missionId: mission.mission_id,
            progress: mission.progress_value,
        })),
        awakeSummary.manaBoardAwakeMap,
    ).all

    // The client uses mana_board_awake both to unlock the Awake tab and as the
    // target node-awake level. Keep mission unlocks and persisted node state.
    const nodeAwakeLevels = getPlayerCharactersManaNodeAwakeLevelsSync(playerId)
    const linkedBoardUpdates: { characterId: number; nodeId: number; awakeLevel: number }[] = []
    for (const [characterIdText, character] of Object.entries(characterList)) {
        if (character.evolutionLevel < 2) continue
        const characterId = Number(characterIdText)
        const characterNodeLevels = nodeAwakeLevels[characterIdText] ?? {}
        const updates = collectLinkedManaNodeAwakeUpdates(
            characterId,
            new Set(learnedManaNodes[characterIdText] ?? []),
            new Map(Object.entries(characterNodeLevels).map(([nodeId, level]) => [Number(nodeId), level])),
            character.evolutionLevel - 1,
        )
        for (const update of updates) {
            linkedBoardUpdates.push({ characterId, ...update })
            characterNodeLevels[update.nodeId] = update.awakeLevel
        }
        if (updates.length > 0) nodeAwakeLevels[characterIdText] = characterNodeLevels
    }
    if (linkedBoardUpdates.length > 0) {
        runPersistenceTransactionSync({ domain: "player", playerId, operation: "load_linked_board_repair" }, () => {
            for (const update of linkedBoardUpdates) {
                updatePlayerCharacterManaNodeAwakeLevelSync(
                    playerId,
                    update.characterId,
                    update.nodeId,
                    update.awakeLevel,
                )
            }
        })
    }
    afterRepairs?.()
    const missionAwakeMap = new Map<string, Record<number, number>>()
    for (const [characterId, levels] of awakeSummary.manaBoardAwakeMap) {
        const visible = filterCharacterManaBoardAwakeLevels(
            Number(characterId),
            levels,
            learnedManaNodes[characterId] ?? [],
        )
        if (Object.keys(visible).length > 0) missionAwakeMap.set(characterId, visible)
    }
    const manaBoardAwakeMap = mergeManaBoardAwakeMaps(
        missionAwakeMap,
        computeManaBoardAwakeFromNodes(nodeAwakeLevels)
    )

    return preparePlayerSerialization({
        player: playerData,
        dailyChallengePointList: getPlayerDailyChallengePointListSync(playerId),
        triggeredTutorial: getPlayerTriggeredTutorialsSync(playerId),
        clearedRegularMissionList: getPlayerClearedRegularMissionListSync(playerId),
        characterList,
        characterManaNodeList: learnedManaNodes,
        characterManaNodeAwakeLevels: nodeAwakeLevels,
        manaBoardAwakeMap,
        partyGroupList: preloadedPartyGroupList ?? getPlayerPartyGroupListSync(playerId),
        itemList: getPlayerItemsSync(playerId),
        equipmentList: preloadedEquipmentList ?? getPlayerEquipmentListSync(playerId),
        questProgress: playerQuestProgress,
        gachaInfoList: getPlayerGachaInfoListSync(playerId),
        gachaCampaignList: getPlayerGachaCampaignListSync(playerId),
        drawnQuestList: getPlayerDrawnQuestsSync(playerId),
        periodicRewardPointList: getPlayerPeriodicRewardPointsSync(playerId),
        allActiveMissionList: filterToActiveMissions(
            getPlayerActiveMissionsSync(playerId),
            getContentSnapshot().repository,
        ),
        boxGachaList: getPlayerBoxGachasSync(playerId),
        purchasedTimesList: {},
        startDashExchangeCampaignList: getPlayerStartDashExchangeCampaignsSync(playerId),
        multiSpecialExchangeCampaignList: getPlayerMultiSpecialExchangeCampaignsSync(playerId),
        userOption: getPlayerOptionsSync(playerId),
        rushEventList: doSerializeRushEventData ? getPlayerRushEventListSync(playerId) : undefined,
        rushEventClearedFolderList: doSerializeRushEventData ? getPlayerRushEventListClearedFoldersSync(playerId) : undefined,
        rushEventPlayedPartyList: doSerializeRushEventData ? getPlayerRushEventListPlayedPartiesSync(playerId) : undefined
    }, {
        ...serializeOptions,
        activeMissionList: awakeSummary.activeMissionList,
    })
}


/**
 * Assembles a player's full server-side MergedPlayerData (no client serialization).
 * Used by the admin save export/import (snapshot round-trip).
 */
export function getMergedPlayerDataSync(
    playerId: number
): MergedPlayerData | null {
    const playerData = getPlayerSync(playerId)
    if (playerData === null) return null

    return {
        player: playerData,
        degreeList: getPlayerPortableDegreesSync(playerId),
        dailyChallengePointList: getPlayerDailyChallengePointListSync(playerId),
        triggeredTutorial: getPlayerTriggeredTutorialsSync(playerId),
        clearedRegularMissionList: getPlayerClearedRegularMissionListSync(playerId),
        characterList: getPlayerCharactersSync(playerId),
        characterManaNodeList: getPlayerCharactersManaNodesSync(playerId),
        characterManaNodeAwakeLevels: getPlayerCharactersManaNodeAwakeLevelsSync(playerId),
        partyGroupList: getPlayerPartyGroupListSync(playerId),
        itemList: getPlayerItemsSync(playerId),
        equipmentList: getPlayerEquipmentListSync(playerId),
        questProgress: getPlayerQuestProgressSync(playerId),
        gachaInfoList: getPlayerGachaInfoListSync(playerId),
        gachaCampaignList: getPlayerGachaCampaignListSync(playerId),
        drawnQuestList: getPlayerDrawnQuestsSync(playerId),
        periodicRewardPointList: getPlayerPeriodicRewardPointsSync(playerId),
        allActiveMissionList: getPlayerActiveMissionsSync(playerId),
        categoryMissionList: getPlayerCategoryMissionListSync(playerId),
        boxGachaList: getPlayerBoxGachasSync(playerId),
        purchasedTimesList: {},
        startDashExchangeCampaignList: getPlayerStartDashExchangeCampaignsSync(playerId),
        multiSpecialExchangeCampaignList: getPlayerMultiSpecialExchangeCampaignsSync(playerId),
        userOption: getPlayerOptionsSync(playerId),
        rushEventList: getPlayerRushEventListSync(playerId),
        rushEventClearedFolderList: getPlayerRushEventListClearedFoldersSync(playerId),
        rushEventPlayedPartyList: getPlayerRushEventListPlayedPartiesSync(playerId),
        ...getCarnivalSaveStateSync(getDb(), playerId),
    }
}
