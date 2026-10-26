import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { deletePlayerRushEventPlayedPartiesUntilSync, deletePlayerRushEventPlayedPartyListSync, deletePlayerRushEventPlayedPartySync, getDefaultPlayerRushEventSync, getPlayerRushEventClearedFoldersSync, getPlayerRushEventSync, insertPlayerRushEventSync, updatePlayerRushEventSync } from "../../data/domains/rushEvent"
import { getDefaultPlayerPartyGroupsSync, getPlayerSync } from "../../data/domains/player"
import { getPlayerCharactersSync } from "../../data/domains/character"
import { getPlayerMailCountSync } from "../../data/domains/mail"
import { ensurePlayerPartyGroupListSync, getPlayerPartyGroupListSync } from "../../data/domains/party"
import { getSession } from "../../data/domains/session"
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { generateDataHeaders, getServerDate } from "../../utils";
import { PartyCategory, RushEventBattleType } from "../../data/types";
import { clientSerializeDate } from "../../data/utils";
import { getSerializedPlayerRushEventPlayedPartiesSync, getPlayerRushEventEndlessBattleRankingSync } from "../../lib/rush";
import { insertActiveQuest, activeQuests } from "./singleBattleQuest";
import {
    claimRaidEventOverallRewardsSync,
    getRaidEventGlobalBossSync,
    getRaidEventQuestKillCountsSync,
} from "../../lib/raidEventGlobal";
import { ensureSpecialEventPartyGroupsSync, resolvePartyGroupColorId, getGlobalPartyId } from "../../lib/special-event-parties";
import { captureRaidBattleRosterSync, normalizeBattleParty, isBattleRosterError, BattleRosterValidationError } from "../../lib/quest/battle-roster";
import { assertBattleCanStartSync } from "../../data/domains/battle-settlement-ledger";
import { gameVerboseLog } from "../../lib/game-logging";
import { getMode15ExclusivePartyItemsSync } from "../../lib/mode15-optional";
import {
    getRaidEventIdForQuest,
    isRaidEventQuestId,
    isSupportedRaidEventId,
} from "../../lib/raid-event-config";
import { getQuestFromCategorySync } from "../../lib/assets";
import { QuestCategory } from "../../lib/types";
import { grantEligibleRaidEventDegreesSync } from "../../lib/activity-degree-rewards";
import { runPersistenceTransaction } from "../../lib/persistence-coordinator";
import { getPlayerActiveQuestSync } from "../../data/domains/quest_active";
import { contentDecision, isContentQuestOpenAt } from "../../lib/content-operations";

interface EventIdBody {
    event_id: number,
    viewer_id: number,
    api_count: number
}

interface RushPartyGroup {
    party_group_color_id: number,
    party_group_id: number,
    party_list: RushParty[]
}

interface RushParty {
    ability_soul_ids: (number | null)[],
    character_ids: (number | null)[],
    equipment_ids: (number | null)[],
    unison_character_ids: (number | null)[],
    options: { allow_other_players_to_heal_me: boolean },
    party_edited: boolean,
    party_id: number,
    party_name: string
}

function raidPartyGroups(playerId: number) {
    return ensureSpecialEventPartyGroupsSync(playerId, PartyCategory.RAID, PartyCategory.RUSH, {
        getGroups: getPlayerPartyGroupListSync, getDefaults: getDefaultPlayerPartyGroupsSync,
        ensureGroups: ensurePlayerPartyGroupListSync,
    })
}

/** The published order is also the Raid client's sub_id 0/1/2 identity. */
function raidPartyList(playerId: number, groupId: number,
    group: ReturnType<typeof getPlayerPartyGroupListSync>[string] | undefined): RushParty[] {
    const result: RushParty[] = []
    const usedSlots = new Set<number>()
    for (const [slotKey, party] of Object.entries(group?.list ?? {}).slice(0, 3)) {
        const slot = Number(slotKey)
        usedSlots.add(slot)
        result.push({ ability_soul_ids: [...party.abilitySoulIds], character_ids: [...party.characterIds],
            equipment_ids: [...party.equipmentIds], unison_character_ids: [...party.unisonCharacterIds],
            options: { allow_other_players_to_heal_me: party.options.allowOtherPlayersToHealMe },
            party_edited: party.edited, party_id: getGlobalPartyId(groupId, slot), party_name: party.name })
    }
    while (result.length < 3) {
        const slot = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find(id => !usedSlots.has(id))!
        usedSlots.add(slot)
        const used = new Set(result.flatMap(party => [...party.character_ids, ...party.unison_character_ids]))
        const leader = Object.keys(getPlayerCharactersSync(playerId)).map(Number)
            .filter(id => id > 0 && !used.has(id)).sort((a, b) => a - b)[0] ?? null
        result.push({ ability_soul_ids: [null, null, null], character_ids: [leader, null, null],
            equipment_ids: [null, null, null], unison_character_ids: [null, null, null],
            options: { allow_other_players_to_heal_me: true }, party_edited: false,
            party_id: getGlobalPartyId(groupId, slot), party_name: `Party ${slot}` })
    }
    return result
}

enum ResetQuestType {
    EMPTY,
    FOLDER,
    ENDLESS
}

interface ResetBody {
    quest_type: ResetQuestType,
    event_id: number,
    viewer_id: number,
    reset_target_id?: number,
    is_reset_after_target_round?: boolean
}

const routes = async (fastify: FastifyInstance) => {
    // ---- summary (entry point) ----
    fastify.post("/summary", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as EventIdBody;
        const viewerId = body.viewer_id;
        const eventId = body.event_id
        if (
            !Number.isSafeInteger(viewerId)
            || viewerId <= 0
            || !isSupportedRaidEventId(eventId)
        ) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        });

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error", "message": "No player bound to account."
        })

        // Rush event data for played party tracking
        let rushEventData = getPlayerRushEventSync(playerId, eventId)
        if (rushEventData === null) {
            await runPersistenceTransaction({
                domain: "event", playerId, operation: "raid_summary_initialize",
            }, () => {
                if (getPlayerRushEventSync(playerId, eventId) === null) {
                    insertPlayerRushEventSync(playerId, getDefaultPlayerRushEventSync(eventId))
                }
            })
            rushEventData = getPlayerRushEventSync(playerId, eventId)
        }
        if (rushEventData === null) {
            throw new Error(`Rush event ${eventId} could not be initialized for player ${playerId}.`)
        }
        const clearedFolderIdList = getPlayerRushEventClearedFoldersSync(playerId, eventId)
        const serializedPlayedParties = getSerializedPlayerRushEventPlayedPartiesSync(playerId, eventId)
        const settlement = await runPersistenceTransaction({
            domain: "event", playerId, operation: "raid_summary_rewards",
        }, () => {
            const raidBoss = getRaidEventGlobalBossSync(eventId)
            return {
                raidBoss,
                rewardClaim: claimRaidEventOverallRewardsSync(playerId, eventId, raidBoss.totalKillCount),
            }
        })
        const raidBoss = settlement.raidBoss
        const rewardClaim = settlement.rewardClaim
        const playerAfterClaim = rewardClaim.rewardResult ? getPlayerSync(playerId) : null
        if (rewardClaim.rewardResult && playerAfterClaim === null) {
            throw new Error(`Player ${playerId} disappeared during Raid reward settlement.`)
        }
        const questKillCounts = getRaidEventQuestKillCountsSync(eventId)
        gameVerboseLog(() => `[RAID] summary: folderParties=${Object.keys(serializedPlayedParties.folderParties ?? {}).length} endlessParties=${Object.keys(serializedPlayedParties.endlessParties ?? {}).length}`)

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "aggregated_time": clientSerializeDate(getServerDate()),
                "auto_start_point": 0,
                "kill_count_reward_data": {
                    "received_up_to": rewardClaim.receivedUpTo,
                    "reward_list": rewardClaim.rewardList,
                },
                "quest_list": questKillCounts,
                "raid_boss": {
                    "hp_percentage": raidBoss.hpPercentage,
                    "total_kill_count": raidBoss.totalKillCount,
                },
                ...(rewardClaim.rewardResult && playerAfterClaim ? {
                    "user_info": {
                        "free_mana": playerAfterClaim.freeMana,
                        "free_vmoney": playerAfterClaim.freeVmoney,
                        "exp_pool": playerAfterClaim.expPool,
                    },
                    "character_list": rewardClaim.rewardResult.character_list,
                    "joined_character_id_list": rewardClaim.rewardResult.joined_character_id_list,
                    "equipment_list": rewardClaim.rewardResult.equipment_list,
                    "item_list": rewardClaim.rewardResult.items,
                } : {}),
                "mail_arrived": getPlayerMailCountSync(playerId, true) > 0,
                "endless_battle_next_round": rushEventData.endlessBattleNextRound,
                "active_rush_battle_folder_id": rushEventData.activeRushBattleFolderId,
                "endless_battle_played_max_round": rushEventData.endlessBattleNextRound,
                "cleared_folder_id_list": clearedFolderIdList,
                "endless_battle_played_party_list": serializedPlayedParties.endlessParties,
                "rush_battle_played_party_list": serializedPlayedParties.folderParties,
                "endless_battle_my_ranking": getPlayerRushEventEndlessBattleRankingSync(playerId, eventId, { rushEventData }),
            }
        });
    });

    // ---- get_boss ----
    fastify.post("/get_boss", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as EventIdBody;
        const viewerId = body.viewer_id;
        const eventId = body.event_id;
        if (
            !Number.isSafeInteger(viewerId)
            || viewerId <= 0
            || !isSupportedRaidEventId(eventId)
        ) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        });

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error", "message": "No player bound to account."
        })

        const raidBoss = getRaidEventGlobalBossSync(eventId)
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "raid_boss": {
                    "hp_percentage": raidBoss.hpPercentage,
                    "total_kill_count": raidBoss.totalKillCount
                }
            }
        });
    });

    // ---- ranking_reward ----
    fastify.post("/ranking_reward", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as EventIdBody;
        const viewerId = body.viewer_id;
        const eventId = Number(body.event_id)
        if (!viewerId || isNaN(viewerId) || !Number.isInteger(eventId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        });

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error", "message": "No player bound to account."
        })
        const degreeIds = await runPersistenceTransaction({
            domain: "event", playerId, operation: "raid_ranking_reward",
        }, () => grantEligibleRaidEventDegreesSync(playerId, eventId))

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "reward_list": degreeIds.map(degreeId => ({
                    kind: 7,
                    kind_id: degreeId,
                    number: 1,
                })),
                "degree_list": degreeIds.map(degreeId => ({
                    viewer_id: viewerId,
                    degree_id: degreeId,
                })),
                "status": 1
            }
        });
    });

    // ---- party (get event party groups) ----
    fastify.post("/party", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, api_count: number };
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        });

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error", "message": "No player bound to account."
        })

        // Category 4 used to be shared by Raid and Rush. Copy it only as a
        // one-time fallback; existing category 3 Raid parties always win.
        const playerPartyGroups = await runPersistenceTransaction({
            domain: "player", playerId, operation: "raid_party_defaults",
        }, () => raidPartyGroups(playerId))
        const group1 = playerPartyGroups['1']
        const partyList = raidPartyList(playerId, 1, group1)

        const userPartyGroupList: RushPartyGroup[] = [{
            "party_group_color_id": resolvePartyGroupColorId(group1),
            "party_group_id": 1,
            "party_list": partyList
        }]

        const partyDump = userPartyGroupList.map(g => ({
            gid: g.party_group_id,
            parties: g.party_list.map(p => ({ pid: p.party_id, chars: p.character_ids, unisons: p.unison_character_ids }))
        }))
        gameVerboseLog(() => `[RAID] party: response=${JSON.stringify(partyDump)}`)

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "user_party_group_list": userPartyGroupList
            }
        });
    });

    // ---- ranking ----
    fastify.post("/ranking", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as {
            event_id?: number, quest_id?: number,
            page?: number, aggregated_time?: string,
            viewer_id: number, api_count: number
        };
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        });

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "aggregated_time": "",
                "quest_list": {}
            }
        });
    });

    // ---- ranking/party (view other player's party) ----
    fastify.post("/ranking/party", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as {
            quest_id: number, aggregated_time: string, rank_number: number,
            viewer_id: number, api_count: number
        };
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        });

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "raid_ranking_party": []
            }
        });
    });

    // ---- battle/start ----
    fastify.post("/battle/start", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as {
            quest_id: number, party_group_id: number, play_id: string,
            use_auto_start_point: boolean, is_auto_start_mode: boolean,
            auto_start_times?: number, event_id?: number,
            viewer_id: number, api_count: number
        };
        const viewerId = body.viewer_id;
        gameVerboseLog(() => `[RAID] battle/start body: questId=${body.quest_id} eventId=${body.event_id} partyGroup=${body.party_group_id}`)
        if (
            !Number.isSafeInteger(viewerId)
            || viewerId <= 0
            || !Number.isSafeInteger(body.quest_id)
            || !Number.isSafeInteger(body.party_group_id)
            || body.party_group_id <= 0
            || body.party_group_id > 12
            || typeof body.play_id !== "string"
            || body.play_id.trim().length === 0
            || typeof body.is_auto_start_mode !== "boolean"
        ) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        });

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error", "message": "No player bound to account."
        })

        const questEventId = getRaidEventIdForQuest(body.quest_id)
        if (
            questEventId === null
            || !isRaidEventQuestId(questEventId, body.quest_id)
            || (body.event_id !== undefined && body.event_id !== questEventId)
            || getQuestFromCategorySync(QuestCategory.RAID_EVENT, body.quest_id) === null
        ) return reply.status(400).send({
            "error": "Bad Request", "message": "Quest doesn't exist."
        })

        const matchesPendingStart = (active: ReturnType<typeof getPlayerActiveQuestSync>) => {
            return active?.playId === body.play_id && active.category === QuestCategory.RAID_EVENT
                && active.questId === body.quest_id && active.eventId === questEventId && !active.isMulti
                && active.isAutoStartMode === body.is_auto_start_mode
                && (!active.battleRoster?.raid || active.battleRoster.raid.partyGroupId === body.party_group_id)
        }
        const isRegisteredPlay = () => matchesPendingStart(getPlayerActiveQuestSync(playerId))
        const initialPending = getPlayerActiveQuestSync(playerId)
        if (initialPending?.playId === body.play_id && !matchesPendingStart(initialPending)) {
            return reply.status(400).send({ error: "Bad Request", message: "Raid start does not match the pending play." })
        }
        const unavailable = () => reply.type("application/x-msgpack").send({
            data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: 4050 }), data: {},
        })
        if (!isRegisteredPlay() && !isContentQuestOpenAt(QuestCategory.RAID_EVENT, body.quest_id)) return unavailable()

        const restricted = isRegisteredPlay() ? [] : getMode15ExclusivePartyItemsSync(
            playerId, PartyCategory.RAID, body.party_group_id,
        )
        if (restricted.length > 0) {
            console.log(`[MODE15] exclusive equipment denied in raid: player=${playerId} items=${restricted.join(",")}`)
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: 4050 }),
                data: {},
            })
        }

        // Register active quest for /single_battle_quest/finish
        const previousMemory = activeQuests[playerId]
        let insertedMemory: typeof previousMemory | undefined
        let started: boolean
        try { started = await runPersistenceTransaction({
            domain: "single-quest", playerId, operation: "raid_start",
        }, () => {
            // Exact committed starts remain replayable after closure. Do not
            // replace their captured start time or affect finish/recovery.
            assertBattleCanStartSync(playerId, body.play_id)
            const pending = getPlayerActiveQuestSync(playerId)
            if (pending?.playId === body.play_id) {
                if (!matchesPendingStart(pending)) {
                    throw new BattleRosterValidationError("Raid start does not match the pending play.")
                }
                return true
            }
            if (!isContentQuestOpenAt(QuestCategory.RAID_EVENT, body.quest_id)) return false
            const groups = raidPartyGroups(playerId)
            if (!groups[String(body.party_group_id)]) throw new BattleRosterValidationError("Raid party group does not exist.")
            const publishedParties = raidPartyList(playerId, body.party_group_id, groups[String(body.party_group_id)])
            const battleRoster = captureRaidBattleRosterSync({ playerId, questId: body.quest_id,
                partyGroupId: body.party_group_id, parties: publishedParties.map(party => ({ partyId: party.party_id,
                    party: normalizeBattleParty({ characters: party.character_ids.map(id => id === null ? null : { id }),
                        unison_characters: party.unison_character_ids.map(id => id === null ? null : { id }),
                        equipments: party.equipment_ids.map(id => id === null ? null : { id }),
                        ability_soul_ids: party.ability_soul_ids }) })) })
            insertActiveQuest(playerId, {
                questId: body.quest_id,
                category: QuestCategory.RAID_EVENT,
                useBossBoostPoint: false,
                useBoostPoint: false,
                isAutoStartMode: body.is_auto_start_mode,
                isMulti: false,
                eventId: questEventId,
                partySlot: publishedParties[0].party_id,
                battleRoster,
                playId: body.play_id,
                continueCount: 0
            })
            insertedMemory = activeQuests[playerId]
            return true
        }) } catch (error) {
            if (insertedMemory && activeQuests[playerId] === insertedMemory) {
                if (previousMemory) activeQuests[playerId] = previousMemory
                else delete activeQuests[playerId]
            }
            if (isBattleRosterError(error) || ["BATTLE_ALREADY_SETTLED", "BATTLE_CLOCK_ABORTED"].includes((error as { code?: string }).code ?? "")) {
                return reply.status(400).send({ error: "Bad Request", message: (error as Error).message })
            }
            throw error
        }
        if (!started) return unavailable()

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {}
        });
    });

    // ---- select_folder ----
    fastify.post("/select_folder", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { folder_id: number, event_id: number, viewer_id: number };
        const viewerId = body.viewer_id;
        if (
            !Number.isSafeInteger(viewerId)
            || viewerId <= 0
            || !isSupportedRaidEventId(body.event_id)
        ) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        });
        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error", "message": "No player bound to account."
        })
        const unavailable = () => reply.type("application/x-msgpack").send({
            data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: 4050 }), data: {},
        })
        if (contentDecision("raid_event", body.event_id, "enter", Date.now()) === false) return unavailable()
        const selected = await runPersistenceTransaction({
            domain: "event", playerId, operation: "raid_select_folder",
        }, () => {
            if (contentDecision("raid_event", body.event_id, "enter", Date.now()) === false) return false
            updatePlayerRushEventSync(playerId, {
                eventId: body.event_id, activeRushBattleFolderId: body.folder_id,
            })
            return true
        })
        if (!selected) return unavailable()
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({ "data_headers": generateDataHeaders({ viewer_id: viewerId }), "data": {} });
    });

    // ---- reset ----
    fastify.post("/reset", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ResetBody;
        const viewerId = body.viewer_id;
        const eventId = body.event_id;
        const questType = body.quest_type;
        const resetTargetId = body.reset_target_id;
        const isResetAfterTargetRound = body.is_reset_after_target_round;
        gameVerboseLog(() => `[RAID] reset: eventId=${eventId} questType=${questType}`)
        if (
            !Number.isSafeInteger(viewerId)
            || viewerId <= 0
            || !isSupportedRaidEventId(eventId)
        ) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        });
        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error", "message": "No player bound to account."
        })
        const unavailable = () => reply.type("application/x-msgpack").send({
            data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: 4050 }), data: {},
        })
        if (contentDecision("raid_event", eventId, "enter", Date.now()) === false) return unavailable()
        const reset = await runPersistenceTransaction({
            domain: "event", playerId, operation: "raid_reset",
        }, () => {
            if (contentDecision("raid_event", eventId, "enter", Date.now()) === false) return false
            if (questType === ResetQuestType.FOLDER) {
                if (resetTargetId !== undefined) {
                    deletePlayerRushEventPlayedPartiesUntilSync(playerId, eventId, RushEventBattleType.FOLDER, resetTargetId)
                } else {
                    updatePlayerRushEventSync(playerId, { eventId: eventId, activeRushBattleFolderId: null })
                    deletePlayerRushEventPlayedPartyListSync(playerId, eventId, RushEventBattleType.FOLDER)
                }
            } else if (resetTargetId !== undefined) {
                if (isResetAfterTargetRound) {
                    deletePlayerRushEventPlayedPartiesUntilSync(playerId, eventId, RushEventBattleType.ENDLESS, resetTargetId)
                } else {
                    deletePlayerRushEventPlayedPartySync(playerId, eventId, resetTargetId, RushEventBattleType.ENDLESS)
                }
            }
            return true
        })
        if (!reset) return unavailable()
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({ "data_headers": generateDataHeaders({ viewer_id: viewerId }), "data": {} });
    });
};

export default routes;
