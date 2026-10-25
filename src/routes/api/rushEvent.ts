import { routineGameLog } from "../../lib/routine-game-logging"
// Handles mail.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PartyCategory, PlayerRushEvent, RushEventBattleType, UserRushEventPlayedParty } from "../../data/types";
import { deletePlayerRushEventPlayedPartiesUntilSync, deletePlayerRushEventPlayedPartyListSync, deletePlayerRushEventPlayedPartySync, getDefaultPlayerRushEventSync, getPlayerRushEventClearedFoldersSync, getPlayerRushEventNextEndlessBattleRoundSync, getPlayerRushEventPlayedPartiesSync, getPlayerRushEventSync, getRushEventEndlessRankingListSync, insertPlayerRushEventClearedFolderSync, insertPlayerRushEventPlayedPartySync, insertPlayerRushEventSync, serializePlayerRushEventPlayedParty, updatePlayerRushEventSync } from "../../data/domains/rushEvent"
import { getAccountPlayers } from "../../data/domains/account"
import { getDefaultPlayerPartyGroupsSync, getPlayerSync } from "../../data/domains/player"
import { getPlayerCharacterSync } from "../../data/domains/character"
import { ensurePlayerPartyGroupListSync, getPlayerPartyGroupListSync } from "../../data/domains/party"
import { getSession } from "../../data/domains/session"
import { setRequestOutcome } from "../../lib/request-diagnostics"
import { getQuestFromCategorySync } from "../../lib/assets";
import { BattleQuest, QuestCategory } from "../../lib/types";
import { isStaleAbyssClient } from "../../lib/abyss-time-revision";
import { ABYSS_EX_EVENT_ID, isAbyssEvent } from "../../lib/abyss-modes";
import { canStartAbyssQuestSync, hasAbyssExUnlockSync, refreshPlayerAbyssTowersSync } from "../../data/domains/abyss-tower-progress";
import { generateDataHeaders, getServerDate, getServerTime } from "../../utils";
import { FinishBody, insertActiveQuest, activeQuests, type ActiveQuest } from "./singleBattleQuest";
import { getPlayerActiveQuestSync } from "../../data/domains/quest_active";
import { assertBattleCanStartSync } from "../../data/domains/battle-settlement-ledger";
import { singleFinishPlayId } from "../../lib/quest/finish/single-finish-identity";
import { captureBattleRosterSync, isBattleRosterError } from "../../lib/quest/battle-roster";
import { getPlayerRushEventEndlessBattleRankingSync, getRushEventEndlessBattleRankPlayedPartyListSync, getSerializedPlayerRushEventPlayedPartiesSync } from "../../lib/rush";
import { clientSerializeDate } from "../../data/utils";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import rushEventRankingRewards from "../../../assets/rush_event_ranking_reward.json";
import { ensureSpecialEventPartyGroupsSync, getGlobalPartyId } from "../../lib/special-event-parties";
import {
    classifyDeepAbyssFolderReset,
    classifyDeepAbyssFolderSelection,
    DEEP_ABYSS_RUSH_FOLDER_ID,
    isStaleDeepAbyssEndlessFolderLock,
} from "../../lib/rush-event-folder-lock";
import {
    canStartMode15QuestSync,
    getMode15ExclusiveGlobalPartyItemsSync,
    isMode15EquipmentAllowedQuest,
    isMode15RuntimeLoaded,
    MODE15_PRACTICE_QUEST_ID,
    MODE15_RUSH_EVENT_ID,
    resetMode15RunSync,
} from "../../lib/mode15-optional";
import { getRankDegree } from "../../lib/stamina";
import { getRushEventFolderMaxRounds, rushEventFolderMaxRounds } from "../../lib/rush-event-folder-rounds";
import {
    canStartRankGatedGauntletRush,
    GAUNTLET_MIN_PLAYER_RANK,
} from "../../lib/gauntlet-entry-rank";
import {
    getEligibleRushDegreeIds,
    getRushDegreeRewardSourceEventId,
    grantEligibleRushEventDegreesSync,
} from "../../lib/activity-degree-rewards";
import {
    resetLeaderboardCompetitionSync,
    startLeaderboardQuestSync,
} from "../../lib/leaderboard/service";
import { getLeaderboardCompetitionForEvent } from "../../lib/leaderboard/competition";
import {
    buildNativeLeaderboardPayload,
    buildUnavailableNativeLeaderboardPayload,
    getLeaderboardPlayedPartiesSync,
    getOfficialLeaderboardPageSync,
} from "../../lib/leaderboard/presentation";
import { isLeaderboardEnabledSync } from "../../lib/leaderboard/availability";
import { partyCategoryForRushEvent } from "../../lib/rush-party-categories";
import { runPersistenceTransaction } from "../../lib/persistence-coordinator";
import { contentDecision, isContentQuestOpenAt } from "../../lib/content-operations";
import { ContentOperationError } from "../../lib/content-operations-store";
import { hasPlayerDegreeSync } from "../../data/domains/degree";

function requireRushParticipation(eventId: number): void {
    if (contentDecision("rush_event", eventId, "enter", Date.now()) === false) throw new ContentOperationError("Rush participation is closed.")
}
function requireRushClaim(playerId: number, eventId: number, maxRound: number | null): void {
    if (contentDecision("rush_event", eventId, "claim", Date.now()) !== false) return
    const earned = getEligibleRushDegreeIds(eventId, maxRound)
    // A previously committed reward can be replayed without a new grant.
    if (earned.length && earned.every(id => hasPlayerDegreeSync(playerId, id))) return
    throw new ContentOperationError("Rush reward claim is closed.")
}

interface SummaryBody {
    event_id: number,
    viewer_id: number
}

interface PartyBody {
    viewer_id: number
    event_id?: number
}

interface SelectFolderBody {
    folder_id: number,
    event_id: number,
    viewer_id: number
}

interface BattleStartBody {
    is_auto_start_mode: boolean,
    party_id: number,
    play_id: string,
    quest_id: number,
    viewer_id: number
}

interface ResetBody {
    quest_type: number,
    event_id: number,
    viewer_id: number,
    reset_target_id?: number,
    is_reset_after_target_round?: boolean
}

interface RankingBody {
    viewer_id: number,
    event_id: number,
    page?: number,
    aggregated_time?: string
}

interface RankingPlayedPartyBody {
    viewer_id: number,
    rank_number: number,
    aggregated_time: string,
    event_id: number
}

enum ResetQuestType {
    EMPTY,
    FOLDER,
    ENDLESS
}

interface RushEventRankingRewardEntry {
    fromRank: number,
    toRank: number,
    kind: number,
    kindId: number,
    number: number
}

type RushEventRankingRewards = Record<string, Record<string, RushEventRankingRewardEntry[]>>

const rankingRewards = rushEventRankingRewards as RushEventRankingRewards

interface RushParty {
    ability_soul_ids: (number | null)[],
    character_ids: (number | null)[],
    equipment_ids: (number | null)[],
    options: {
        allow_other_players_to_heal_me: boolean
    },
    party_edited: boolean,
    party_id: number,
    party_name: string,
    unison_character_ids: (number | null)[]
}

interface RushPartyGroup {
    party_group_color_id: number,
    party_group_id: number,
    party_list: RushParty[]
}

const MODE15_VISIBLE_PARTY_SET_COUNT = 3

function repairDeepAbyssEndlessFolderLockSync(
    playerId: number,
    rushEventData: PlayerRushEvent,
): PlayerRushEvent {
    if (!isStaleDeepAbyssEndlessFolderLock(
        rushEventData.eventId,
        rushEventData.activeRushBattleFolderId,
    )) return rushEventData;

    updatePlayerRushEventSync(playerId, {
        eventId: rushEventData.eventId,
        activeRushBattleFolderId: null,
    });
    console.warn(
        `[RUSH] repaired stale Deep Abyss endless folder lock: `
        + `player=${playerId} eventId=${rushEventData.eventId} folderId=2`,
    );
    return {
        ...rushEventData,
        activeRushBattleFolderId: null,
    };
}

export { getRushEventFolderMaxRounds, rushEventFolderMaxRounds };

const routes = async (fastify: FastifyInstance) => {
    fastify.addHook("preHandler", async (request, reply) => {
        const body = request.body as { viewer_id?: number; event_id?: number; quest_id?: number } | null
        if (!body || !Number.isSafeInteger(body.viewer_id)) return
        const eventId = body.event_id ?? Math.floor(Number(body.quest_id) / 1000)
        if (!isAbyssEvent(eventId)) return
        const session = await getSession(String(body.viewer_id))
        if (!session) return
        const playerId = resolvePlayerIdSync(session.accountId)
        if (playerId === null) return
        await runPersistenceTransaction({
            domain: "event", playerId, operation: "abyss_refresh",
        }, () => refreshPlayerAbyssTowersSync(playerId))
        if (eventId === ABYSS_EX_EVENT_ID && !hasAbyssExUnlockSync(playerId)
            && /\/(select_folder|battle\/start|endless_battle)$/.test(request.url.split("?")[0])) {
            setRequestOutcome(request, "rush_ex_locked")
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                data_headers: generateDataHeaders({ viewer_id: body.viewer_id, result_code: 4050 }), data: {},
            })
        }
    })
    fastify.post("/summary", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SummaryBody

        const viewerId = body.viewer_id
        const eventId = body.event_id
        routineGameLog("rush", () => `[RUSH] summary: viewer=${viewerId} eventId=${eventId}`)
        if (isNaN(viewerId) || isNaN(eventId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        // The client entry is hidden by a forward asset patch.  Keep this
        // server-side guard for clients that still have the old event table
        // cached or retain a stale navigation stack.
        // Initialize and repair event state in one player-owned transaction so
        // summary loading cannot race with a reset or a concurrent login.
        const rushEventData = await runPersistenceTransaction({
            domain: "event", playerId, operation: "rush_summary_maintenance",
        }, () => {
            let current = getPlayerRushEventSync(playerId, eventId)
            if (contentDecision("rush_event", eventId, "enter", Date.now()) === false) return current ?? getDefaultPlayerRushEventSync(eventId)
            if (current === null) {
                current = getDefaultPlayerRushEventSync(eventId)
                insertPlayerRushEventSync(playerId, current)
            }

            // Older or modified clients could persist the endless folder (2)
            // as the regular Deep Abyss difficulty lock. The client then
            // refuses to open folder 1 with "challenging another difficulty".
            current = repairDeepAbyssEndlessFolderLockSync(playerId, current)

            // Older reset builds left the active folder null, while the
            // Fantasy client now returns straight to folder 1 without calling
            // /select_folder. Repair those saves during summary loading.
            if (eventId === MODE15_RUSH_EVENT_ID && current.activeRushBattleFolderId === null) {
                updatePlayerRushEventSync(playerId, { eventId, activeRushBattleFolderId: 1 })
                current = { ...current, activeRushBattleFolderId: 1 }
                console.log(`[MODE15] repaired active Rush folder: player=${playerId} folder=1`)
            }
            return current
        })

        // get cleared folder id list
        const clearedFolderIdList = getPlayerRushEventClearedFoldersSync(playerId, eventId)

        // get serialized parties
        const serializedPlayedParties = getSerializedPlayerRushEventPlayedPartiesSync(playerId, eventId)
        routineGameLog("rush", () => `[RUSH] summary: folderParties=${Object.keys(serializedPlayedParties.folderParties ?? {}).length} endlessParties=${Object.keys(serializedPlayedParties.endlessParties ?? {}).length}`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "endless_battle_next_round": rushEventData.endlessBattleNextRound,
                "endless_battle_max_round": rushEventData.endlessBattleMaxRound,
                "active_rush_battle_folder_id": rushEventData.activeRushBattleFolderId,
                "endless_battle_played_max_round": rushEventData.endlessBattleMaxRound,
                "cleared_folder_id_list": clearedFolderIdList,
                "endless_battle_played_party_list": serializedPlayedParties.endlessParties,
                "rush_battle_played_party_list": serializedPlayedParties.folderParties,
                "endless_battle_my_ranking": getPlayerRushEventEndlessBattleRankingSync(playerId, eventId, {
                    rushEventData: rushEventData
                }),
                "aggregated_time": clientSerializeDate(getServerDate()),
            }
        })
    })

    fastify.post("/select_folder", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body ?? {}) as SelectFolderBody

        const viewerId = body.viewer_id
        const eventId = body.event_id
        const folderId = body.folder_id
        routineGameLog("rush", () => `[RUSH] select_folder: viewer=${viewerId} eventId=${eventId} folderId=${folderId}`)
        if (![viewerId, eventId, folderId].every(id => Number.isSafeInteger(id) && id > 0)) {
            setRequestOutcome(request, "rush_invalid_body")
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            })
        }

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) {
            setRequestOutcome(request, "rush_invalid_session")
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            })
        }

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) {
            setRequestOutcome(request, "rush_missing_player")
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No player bound to account."
            })
        }

        requireRushParticipation(eventId)
        // get existing rush event data
        const rushEventData = getPlayerRushEventSync(playerId, eventId)
        if (rushEventData === null) {
            setRequestOutcome(request, "rush_missing_event")
            return reply.status(400).send({
                "error": "Bad Request",
                "message": `No rush event data for rush event with id '${eventId}'`
            })
        }

        const deepAbyssSelection = classifyDeepAbyssFolderSelection(eventId, folderId)
        if (deepAbyssSelection === "invalid") {
            setRequestOutcome(request, "rush_invalid_folder")
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid Deep Abyss rush battle folder."
            })
        }

        if (deepAbyssSelection === "endless_compat") {
            await runPersistenceTransaction({
                domain: "event", playerId, operation: "rush_select_folder_maintenance",
            }, () => { requireRushParticipation(eventId); repairDeepAbyssEndlessFolderLockSync(playerId, rushEventData) })
            setRequestOutcome(request, "rush_endless_compat")
            // The current client enters endless battle directly and never
            // calls /select_folder. Treat calls from older clients as a
            // successful no-op: endless remains playable, while folder 2 is
            // not persisted as a regular difficulty lock.
            console.warn(
                `[RUSH] ignored Deep Abyss endless folder selection lock: `
                + `player=${playerId} eventId=${eventId} folderId=${folderId}`,
            );
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId }),
                "data": {
                    "folder_id": folderId,
                    "event_id": eventId
                }
            })
        }

        // A lost response may replay the same selection. Re-read inside the
        // player queue so concurrent folder selections cannot overwrite each
        // other after both observed an empty active folder.
        const selection = await runPersistenceTransaction({
            domain: "event", playerId, operation: "rush_select_folder",
        }, () => {
            requireRushParticipation(eventId)
            const current = repairDeepAbyssEndlessFolderLockSync(
                playerId,
                getPlayerRushEventSync(playerId, eventId) ?? rushEventData,
            )
            if (current.activeRushBattleFolderId !== null
                && current.activeRushBattleFolderId !== folderId) {
                return "different" as const
            }
            if (current.activeRushBattleFolderId === null) {
                updatePlayerRushEventSync(playerId, {
                    eventId: eventId,
                    activeRushBattleFolderId: folderId
                })
                return "selected" as const
            }
            return "same" as const
        })
        if (selection === "different") {
            setRequestOutcome(request, "rush_different_folder")
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Already selected a folder for this rush event."
            })
        }
        if (selection === "selected") {
            setRequestOutcome(request, "rush_selected")
        } else {
            setRequestOutcome(request, "rush_same_folder")
        }

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "folder_id": folderId,
                "event_id": eventId
            }
        })
    })

    fastify.post("/ranking", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as RankingBody

        const viewerId = body.viewer_id
        const eventId = body.event_id
        const page = body.page ?? 0
        routineGameLog("rush", () => `[RUSH] ranking: viewer=${viewerId} eventId=${eventId} page=${page}`)
        if (isNaN(viewerId) || isNaN(eventId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        const competition = getLeaderboardCompetitionForEvent(
            QuestCategory.RUSH_EVENT,
            eventId,
        )
        if (competition !== null) {
            const acceptingScores = isLeaderboardEnabledSync(competition.key)
            const ranking = getOfficialLeaderboardPageSync({
                competition,
                playerId,
                page,
                acceptingScores,
            })
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId }),
                "data": {
                    "aggregated_time": clientSerializeDate(getServerDate()),
                    "current_page": ranking.currentPage,
                    "page_max": ranking.pageMax,
                    "my_data": ranking.myData,
                    "ranking_data": ranking.rows,
                    "total": ranking.total,
                },
            })
        }

        // get player endless rank
        const endlessRanking = getPlayerRushEventEndlessBattleRankingSync(playerId, eventId)

        // get all rankings for page
        const rankings = getRushEventEndlessRankingListSync(eventId, page);

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "aggregated_time": clientSerializeDate(getServerDate()),
                "current_page": page + 1,
                "page_max": rankings.pageMax,
                "my_data": endlessRanking,
                "ranking_data": rankings.list
            }
        })
    })

    fastify.post("/ranking/played_party", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as RankingPlayedPartyBody

        const viewerId = body.viewer_id
        const eventId = body.event_id
        const rankNumber = body.rank_number
        if (isNaN(viewerId) || isNaN(eventId) || isNaN(rankNumber)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        const competition = getLeaderboardCompetitionForEvent(
            QuestCategory.RUSH_EVENT,
            eventId,
        )
        if (competition !== null) {
            const partyList = getLeaderboardPlayedPartiesSync({
                competition,
                rankNumber,
                acceptingScores: isLeaderboardEnabledSync(competition.key),
            })
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId }),
                "data": { "rush_ranking_party": partyList },
            })
        }

        // get party list
        const partyList = getRushEventEndlessBattleRankPlayedPartyListSync(rankNumber, eventId) ?? []

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "rush_ranking_party": partyList
            }
        })
    })

    fastify.post("/aggregated_time", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SummaryBody

        const viewerId = body.viewer_id
        const eventId = body.event_id
        if (isNaN(viewerId) || isNaN(eventId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "aggregated_time": clientSerializeDate(getServerDate())
            }
        })
    })

    fastify.post("/party", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as PartyBody

        const viewerId = body.viewer_id
        if (isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        const playerPartyGroups = await runPersistenceTransaction({
            domain: "player", playerId, operation: "rush_party_defaults",
        }, () => ensureSpecialEventPartyGroupsSync(
            playerId,
            partyCategoryForRushEvent(body.event_id),
            PartyCategory.RUSH,
            {
                getGroups: getPlayerPartyGroupListSync,
                getDefaults: getDefaultPlayerPartyGroupsSync,
                ensureGroups: ensurePlayerPartyGroupListSync,
            },
        ))

        // convert to proper format
        const userPartyGroupList: RushPartyGroup[] = []

        for (const [idString, group] of Object.entries(playerPartyGroups)) {
            const groupId = Number(idString)
            if (
                isMode15RuntimeLoaded()
                && (groupId < 1 || groupId > MODE15_VISIBLE_PARTY_SET_COUNT)
            ) continue
            const partyList: RushParty[] = []

            // convert parties
            for (const [partyIdString, party] of Object.entries(group.list)) {
                partyList.push({
                    ability_soul_ids: party.abilitySoulIds,
                    character_ids: party.characterIds,
                    equipment_ids: party.equipmentIds,
                    unison_character_ids: party.unisonCharacterIds,
                    options: {
                        allow_other_players_to_heal_me: party.options.allowOtherPlayersToHealMe
                    },
                    party_edited: party.edited,
                    party_id: getGlobalPartyId(groupId, Number(partyIdString)),
                    party_name: party.name
                })
            }

            userPartyGroupList.push({
                "party_group_color_id": group.colorId,
                "party_group_id": groupId,
                "party_list": partyList
            })
        }

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "user_party_group_list": userPartyGroupList
            }
        })
    })

    // The patched client opens this endpoint through the native Rush reward
    // remote with a private negative-event marker. The remote turns the marker
    // back into a positive event_id before sending it, so ordinary reward,
    // party-editing and global legal/terms flows retain their native payloads.
    fastify.post("/leaderboard", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as PartyBody & { event_id?: number }
        const viewerId = Number(body?.viewer_id)
        const eventId = Number(body?.event_id)
        if (
            !Number.isSafeInteger(viewerId)
            || viewerId <= 0
            || !Number.isSafeInteger(eventId)
            || eventId <= 0
        ) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(String(viewerId))
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        const competition = getLeaderboardCompetitionForEvent(
            QuestCategory.RUSH_EVENT,
            eventId,
        )
        const payload = competition === null
            ? buildUnavailableNativeLeaderboardPayload()
            : buildNativeLeaderboardPayload(
                competition,
                playerId,
                isLeaderboardEnabledSync(competition.key),
            )

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": payload,
        })
    })

    fastify.post("/battle/start", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as BattleStartBody

        const viewerId = body.viewer_id
        const isAutoStartMode = body.is_auto_start_mode
        const partyId = body.party_id
        const questId = body.quest_id
        routineGameLog("rush", () => `[RUSH] battle/start: viewer=${viewerId} questId=${questId} partyId=${partyId} autoStart=${isAutoStartMode}`)
        if (isNaN(viewerId) || isNaN(partyId) || isNaN(questId) || isAutoStartMode === undefined
            || singleFinishPlayId(body.play_id) === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        if (isStaleAbyssClient(QuestCategory.RUSH_EVENT, questId, request.headers.res_ver)) {
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                data_headers: generateDataHeaders({ viewer_id: viewerId, asset_update: true, result_code: 4050 }),
                data: {},
            })
        }

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        // get quest
        const questData = getQuestFromCategorySync(QuestCategory.RUSH_EVENT, questId) as BattleQuest | null
        if (questData === null || !('rankPointReward' in questData) || questData.rushEventId === undefined) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Quest doesn't exist."
        })

        // This endpoint starts Rush single-player battles only.  Keep the
        // rank gate here as a deep-link/API fallback, while Advent multiplayer
        // room creation, rescue discovery and rescue participation remain
        // untouched so lower-rank players can join an eligible host.
        const player = getPlayerSync(playerId)
        const repeatedPendingStart = getPlayerActiveQuestSync(playerId)?.playId === body.play_id
        if (!repeatedPendingStart && !isContentQuestOpenAt(QuestCategory.RUSH_EVENT, questId)) {
            reply.type("application/x-msgpack")
            return reply.send({ data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: 4050 }), data: {} })
        }
        const playerRank = player === null ? 0 : getRankDegree(player.rankPoint)
        if (!repeatedPendingStart && (!canStartRankGatedGauntletRush(questData.rushEventId, playerRank)
            || !canStartAbyssQuestSync(playerId, QuestCategory.RUSH_EVENT, questId))) {
            console.log(
                `[RUSH] rank-gated Gauntlet start rejected: player=${playerId} `
                + `rank=${playerRank} required=${GAUNTLET_MIN_PLAYER_RANK} `
                + `event=${questData.rushEventId} quest=${questId}`,
            )
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: 4050 }),
                data: {},
            })
        }

        if (
            !repeatedPendingStart && isMode15RuntimeLoaded()
            && questData.rushEventId === MODE15_RUSH_EVENT_ID
            && questId !== MODE15_PRACTICE_QUEST_ID
        ) {
            const gate = canStartMode15QuestSync(playerId, QuestCategory.RUSH_EVENT, questId);
            if (!gate.allowed) {
                // After a failed Fantasy Rush battle the legacy client may
                // replay the stale pre-reset round once while unwinding the
                // result screen.  Keep rejecting it, but use the client's
                // native non-fatal quest-unavailable response instead of an
                // HTTP 409 that is surfaced as H409.
                console.log(`[MODE15] stale/order-invalid Rush start rejected: player=${playerId} requested=${gate.stage} expected=${gate.expectedStage}`);
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send({
                    data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: 4050 }),
                    data: {},
                });
            }
        }

        if (!repeatedPendingStart && !isMode15EquipmentAllowedQuest(QuestCategory.RUSH_EVENT, questId)) {
            const partyCategory = partyCategoryForRushEvent(questData.rushEventId)
            const restricted = getMode15ExclusiveGlobalPartyItemsSync(
                playerId, partyCategory, partyId,
            );
            if (restricted.length > 0) {
                console.log(`[MODE15] exclusive equipment denied in Rush: player=${playerId} quest=${questId} rushEvent=${questData.rushEventId} partyCategory=${partyCategory} party=${partyId} items=${restricted.join(",")}`);
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send({
                    // Rush battle start has no native handling for 4507 and
                    // treats it as a fatal API error.  4050 is the standard
                    // non-fatal quest availability rejection used by battle
                    // start screens.
                    data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: 4050 }),
                    data: {},
                });
            }
        }

        const previousMemory = activeQuests[playerId]
        let insertedMemory: ActiveQuest | undefined
        try { await runPersistenceTransaction({
            domain: "single-quest", playerId, operation: "rush_start",
        }, () => {
            assertBattleCanStartSync(playerId, body.play_id)
            const pending = getPlayerActiveQuestSync(playerId)
            if (pending?.playId === body.play_id) {
                if (pending.isMulti || pending.category !== QuestCategory.RUSH_EVENT || pending.questId !== questId
                    || pending.isAutoStartMode !== isAutoStartMode || pending.useBoostPoint || pending.useBossBoostPoint
                    || (pending.partySlot !== null && pending.partySlot !== undefined && pending.partySlot !== partyId)) {
                    throw new Error("Battle start does not match the pending play.")
                }
                return
            }
            if (!isContentQuestOpenAt(QuestCategory.RUSH_EVENT, questId)) throw new Error("QUEST_OPERATIONS_CLOSED")
            const battleRoster = captureBattleRosterSync({ playerId, questCategory: QuestCategory.RUSH_EVENT,
                questId, partyId, fixedParty: questData.fixedParty })
            startLeaderboardQuestSync(playerId, {
                category: QuestCategory.RUSH_EVENT,
                eventId: questData.rushEventId,
                folderId: questData.rushEventFolderId,
                round: questData.rushEventRound,
                questId,
                totalRounds: questData.rushEventFolderId === undefined
                    ? 0
                    : getRushEventFolderMaxRounds(
                        questData.rushEventId!,
                        questData.rushEventFolderId!,
                    ),
            })

            // Insert the active quest for '/single_battle_quest/finish'.
            insertActiveQuest(playerId, {
                questId: questId,
                category: QuestCategory.RUSH_EVENT,
                useBoostPoint: false,
                useBossBoostPoint: false,
                isAutoStartMode: isAutoStartMode,
                isMulti: false,
                partySlot: partyId,
                eventId: questData.rushEventId,
                battleRoster,
                playId: body.play_id,
                continueCount: 0
            })
            insertedMemory = activeQuests[playerId]
        }) } catch (error) {
            if (insertedMemory && activeQuests[playerId] === insertedMemory) {
                if (previousMemory) activeQuests[playerId] = previousMemory
                else delete activeQuests[playerId]
            }
            const code = (error as { code?: string })?.code
            if (isBattleRosterError(error) || code === "BATTLE_ALREADY_SETTLED" || code === "BATTLE_CLOCK_ABORTED"
                || (error as Error)?.message === "Battle start does not match the pending play.") {
                return reply.status(400).send({ error: "Bad Request", message: (error as Error).message })
            }
            if (!(error instanceof Error) || error.message !== "QUEST_OPERATIONS_CLOSED") throw error
            reply.type("application/x-msgpack")
            return reply.send({ data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: 4050 }), data: {} })
        }

        const headers = generateDataHeaders({
            viewer_id: viewerId
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": headers,
            "data": {
                "user_info": {
                    "last_main_quest_id": body.quest_id
                },
                "is_multi": "single",
                "start_time": headers['servertime'],
                "quest_name": ""
            }
        })
    })

    fastify.post("/reset", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ResetBody

        const viewerId = body.viewer_id
        const eventId = body.event_id
        const questType: ResetQuestType = body.quest_type
        const resetTargetId: number | undefined = body.reset_target_id
        const isResetAfterTargetRound: boolean | undefined = body.is_reset_after_target_round
        routineGameLog("rush", () => `[RUSH] reset: viewer=${viewerId} eventId=${eventId} questType=${questType} resetTargetId=${resetTargetId} isResetAfterTarget=${isResetAfterTargetRound}`)
        if (isNaN(viewerId) || isNaN(eventId) || isNaN(questType)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        const rushEventData = getPlayerRushEventSync(playerId, eventId)

        if (isMode15RuntimeLoaded() && eventId === MODE15_RUSH_EVENT_ID) {
            requireRushParticipation(eventId)
            await runPersistenceTransaction({
                domain: "event", playerId, operation: "rush_reset_mode15",
            }, () => {
                requireRushParticipation(eventId)
                if (rushEventData !== null) repairDeepAbyssEndlessFolderLockSync(playerId, rushEventData)
                resetMode15RunSync(playerId)
            })
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId }),
                "data": [],
            });
        }

        requireRushParticipation(eventId)
        await runPersistenceTransaction({
            domain: "event", playerId, operation: "rush_reset",
        }, () => {
            requireRushParticipation(eventId)
            if (rushEventData !== null) repairDeepAbyssEndlessFolderLockSync(playerId, rushEventData)
            if (questType === ResetQuestType.FOLDER) {
                if (classifyDeepAbyssFolderReset(eventId) === "restart_from_first") {
                    resetLeaderboardCompetitionSync(playerId, {
                        category: QuestCategory.RUSH_EVENT,
                        eventId,
                        folderId: DEEP_ABYSS_RUSH_FOLDER_ID,
                    })
                    // Deep Abyss always abandons the entire finite run. Keep
                    // folder 1 selected so the client returns directly to
                    // round 700099001, regardless of reset_target_id.
                    updatePlayerRushEventSync(playerId, {
                        eventId: eventId,
                        activeRushBattleFolderId: DEEP_ABYSS_RUSH_FOLDER_ID
                    })
                    deletePlayerRushEventPlayedPartyListSync(
                        playerId,
                        eventId,
                        RushEventBattleType.FOLDER
                    )
                    console.log(
                        `[RUSH] Deep Abyss folder reset from first round: `
                        + `player=${playerId} ignoredResetTargetId=${resetTargetId}`
                    )
                } else if (resetTargetId !== undefined) {
                    // A reset target keeps the native partial-reset behaviour
                    // for every Rush event except Deep Abyss.
                    deletePlayerRushEventPlayedPartiesUntilSync(playerId, eventId, RushEventBattleType.FOLDER, resetTargetId)
                } else {
                    updatePlayerRushEventSync(playerId, {
                        eventId: eventId,
                        activeRushBattleFolderId: null
                    })
                    deletePlayerRushEventPlayedPartyListSync(playerId, eventId, RushEventBattleType.FOLDER)
                }
            } else if (resetTargetId !== undefined) {
                if (isResetAfterTargetRound) {
                    deletePlayerRushEventPlayedPartiesUntilSync(playerId, eventId, RushEventBattleType.ENDLESS, resetTargetId)
                } else {
                    deletePlayerRushEventPlayedPartySync(playerId, eventId, resetTargetId, RushEventBattleType.ENDLESS)
                }
            }
        })
        
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": []
        })
    })

    // ---- reward ----
    fastify.post("/reward", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { event_id: number, viewer_id: number, api_count: number };
        const viewerId = body.viewer_id;
        const eventId = body.event_id;
        routineGameLog("rush", () => `[RUSH] reward: viewer=${viewerId} eventId=${eventId}`)
        if (!viewerId || isNaN(viewerId) || isNaN(eventId)) return reply.status(400).send({
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

        // Rank remains part of the response, but the reward master-data ranges
        // describe cleared endless rounds (2-3, 4-5 and 6+), not leaderboard rank.
        const myRanking = getPlayerRushEventEndlessBattleRankingSync(playerId, eventId)
        const rankNumber = myRanking?.rank_number ?? null
        const rushEvent = getPlayerRushEventSync(playerId, eventId)
        const maxRound = rushEvent?.endlessBattleMaxRound ?? null
        const eligibleDegreeIds = new Set(getEligibleRushDegreeIds(eventId, maxRound))

        // find matching reward tier
        const rewardSourceEventId = getRushDegreeRewardSourceEventId(eventId)
        const rewards = rankingRewards[String(rewardSourceEventId)] ?? {}
        let rewardList: RushEventRankingRewardEntry[] = []
        if (maxRound !== null && maxRound > 0) {
            for (const entries of Object.values(rewards)) {
                for (const entry of entries) {
                    if (eligibleDegreeIds.has(entry.kindId)) {
                        rewardList.push(entry)
                        break
                    }
                }
            }
        }
        requireRushClaim(playerId, eventId, maxRound)
        const degreeIds = await runPersistenceTransaction({
            domain: "event", playerId, operation: "rush_reward",
        }, () => {
            const currentRound = getPlayerRushEventSync(playerId, eventId)?.endlessBattleMaxRound ?? null
            requireRushClaim(playerId, eventId, currentRound)
            return grantEligibleRushEventDegreesSync(playerId, eventId, currentRound)
        })

        routineGameLog("rush", () => `[RUSH] reward: rank=${rankNumber} maxRound=${maxRound} rewards=${rewardList.length}`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "rank_number": rankNumber,
                "ranking_reward": {
                    "reward_list": rewardList.map(r => ({
                        "kind": r.kind,
                        "kind_id": r.kindId,
                        "number": r.number
                    })),
                    "status": 1
                },
                "degree_list": degreeIds.map(degreeId => ({
                    viewer_id: viewerId,
                    degree_id: degreeId,
                }))
            }
        });
    })

    // ---- endless_battle ----
    fastify.post("/endless_battle", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { event_id: number, viewer_id: number, api_count: number };
        const viewerId = body.viewer_id;
        const eventId = body.event_id;
        routineGameLog("rush", () => `[RUSH] endless_battle: viewer=${viewerId} eventId=${eventId}`)
        if (!viewerId || isNaN(viewerId) || isNaN(eventId)) return reply.status(400).send({
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

        const rushEventData = getPlayerRushEventSync(playerId, eventId)
        const serializedPlayedParties = rushEventData !== null
            ? getSerializedPlayerRushEventPlayedPartiesSync(playerId, eventId)
            : { endlessParties: null, folderParties: null }
        const maxRound = rushEventData?.endlessBattleMaxRound ?? null
        const nextRound = rushEventData?.endlessBattleNextRound ?? 1

        routineGameLog("rush", () => `[RUSH] endless_battle: maxRound=${maxRound} nextRound=${nextRound}`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "endless_battle_max_round": maxRound,
                "endless_battle_next_round": nextRound,
                "endless_battle_played_party_list": serializedPlayedParties.endlessParties ?? null
            }
        });
    })
}

export default routes;
