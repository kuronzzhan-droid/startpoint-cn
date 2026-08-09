import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { deletePlayerRushEventPlayedPartiesUntilSync, deletePlayerRushEventPlayedPartyListSync, deletePlayerRushEventPlayedPartySync, getDefaultPlayerRushEventSync, getPlayerRushEventClearedFoldersSync, getPlayerRushEventSync, insertPlayerRushEventSync, updatePlayerRushEventSync } from "../../data/domains/rushEvent"
import { getDefaultPlayerPartyGroupsSync } from "../../data/domains/player"
import { getPlayerCharactersSync } from "../../data/domains/character"
import { ensurePlayerPartyGroupListSync, getPlayerPartyGroupListSync } from "../../data/domains/party"
import { getSession } from "../../data/domains/session"
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { generateDataHeaders, getServerDate } from "../../utils";
import { PartyCategory, RushEventBattleType } from "../../data/types";
import { clientSerializeDate } from "../../data/utils";
import { getSerializedPlayerRushEventPlayedPartiesSync, getPlayerRushEventEndlessBattleRankingSync } from "../../lib/rush";
import { insertActiveQuest } from "./singleBattleQuest";
import {
    claimRaidEventOverallRewardsSync,
    getRaidEventGlobalBossSync,
    getRaidEventQuestKillCountsSync,
} from "../../lib/raidEventGlobal";
import { ensureSpecialEventPartyGroupsSync, resolvePartyGroupColorId } from "../../lib/special-event-parties";
import { gameVerboseLog } from "../../lib/game-logging";
import { getMode15ExclusivePartyItemsSync } from "../../lib/mode15-optional";

const raidEventIds: Record<number, number> = {}

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

        // Rush event data for played party tracking
        let rushEventData = getPlayerRushEventSync(playerId, eventId)
        if (rushEventData === null) {
            rushEventData = getDefaultPlayerRushEventSync(eventId)
            insertPlayerRushEventSync(playerId, rushEventData)
        }
        const clearedFolderIdList = getPlayerRushEventClearedFoldersSync(playerId, eventId)
        const serializedPlayedParties = getSerializedPlayerRushEventPlayedPartiesSync(playerId, eventId)
        const raidBoss = getRaidEventGlobalBossSync(eventId)
        const totalKillCount = raidBoss.totalKillCount
        const rewardClaim = claimRaidEventOverallRewardsSync(playerId, eventId, totalKillCount)
        const questKillCounts = getRaidEventQuestKillCountsSync(eventId)
        raidEventIds[playerId] = eventId
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
                    "total_kill_count": totalKillCount,
                },
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
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        });

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
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        });

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "reward_list": [],
                "status": 0
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
        const playerPartyGroups = ensureSpecialEventPartyGroupsSync(
            playerId,
            PartyCategory.RAID,
            PartyCategory.RUSH,
            {
                getGroups: getPlayerPartyGroupListSync,
                getDefaults: getDefaultPlayerPartyGroupsSync,
                ensureGroups: ensurePlayerPartyGroupListSync,
            },
        )
        const group1 = playerPartyGroups['1']
        const partyList: RushParty[] = []

        if (group1 && group1.list) {
            let count = 0
            for (const [pidStr, party] of Object.entries(group1.list)) {
                if (count >= 3) break
                count++
                partyList.push({
                    ability_soul_ids: party.abilitySoulIds,
                    character_ids: party.characterIds,
                    equipment_ids: party.equipmentIds,
                    unison_character_ids: party.unisonCharacterIds,
                    options: { allow_other_players_to_heal_me: party.options.allowOtherPlayersToHealMe },
                    party_edited: party.edited,
                    party_id: Number(pidStr),
                    party_name: party.name
                })
            }
        }

        // Fallback: fill empty parties with leader characters if NORMAL is empty
        while (partyList.length < 3) {
            const pid = partyList.length + 1
            const playerChars = getPlayerCharactersSync(playerId)
            const leaderIds = Object.keys(playerChars).map(Number).filter(id => id > 0).sort((a, b) => a - b)
            const usedIds = new Set(partyList.flatMap(p => p.character_ids.filter(c => c !== null) as number[]))
            const leaderId = leaderIds.find(id => !usedIds.has(id)) ?? null
            partyList.push({
                ability_soul_ids: [null, null, null],
                character_ids: [leaderId, null, null],
                equipment_ids: [null, null, null],
                unison_character_ids: [null, null, null],
                options: { allow_other_players_to_heal_me: true },
                party_edited: false,
                party_id: pid,
                party_name: `Party ${pid}`
            })
        }

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

        const restricted = getMode15ExclusivePartyItemsSync(
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
        const raidEventId = raidEventIds[playerId] ?? Math.floor(body.quest_id / 1000)
        insertActiveQuest(playerId, {
            questId: body.quest_id,
            category: 23,  // RAID_EVENT
            useBossBoostPoint: false,
            useBoostPoint: false,
            isAutoStartMode: body.is_auto_start_mode,
            isMulti: false,
            eventId: raidEventId,
            playId: body.play_id,
            continueCount: 0
        })

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
        updatePlayerRushEventSync(playerId, { eventId: body.event_id, activeRushBattleFolderId: body.folder_id })
        raidEventIds[playerId] = body.event_id
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
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({ "data_headers": generateDataHeaders({ viewer_id: viewerId }), "data": {} });
    });
};

export default routes;
