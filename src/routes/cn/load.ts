import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { generateDataHeaders, getServerTime, getServerDate } from "../../utils";
import { collectPlayerDataPooledExpSync, dailyResetPlayerDataSync, getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { deletePlayerActiveQuestIfPlayIdSync, getPlayerActiveQuestSync } from "../../data/domains/quest_active"
import { getSession } from "../../data/domains/session"
import { prepareClientSerializedData } from "../../data/utils/player-data";
import { getContentSnapshot } from "../../content/runtime/content-snapshot";
import { reconcileActiveMissionFacts } from "../../lib/mission/active-reconciliation";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { getDisplayHost } from "../../multi/room/serializer";
import { getRoom } from "../../multi/room/manager";
import { sessionManager } from "../../multi/state/SessionManager";
import { runPermanentValidators } from "../../lib/validate";
import { activeQuests } from "../api/singleBattleQuest";
import { getFavoritePartyGroupListSync } from "../../lib/profileFavorite";
import { gameVerboseLog } from "../../lib/game-logging";
import { shouldResetMode15RunForStaleActiveQuest } from "../../lib/mode15-active-quest-recovery";
import { classifyMultiActiveQuestRecovery } from "../../lib/multi-active-quest-recovery";
import {
    cleanupLegacyMode15RescueProgressSync,
    isMode15RuntimeLoaded,
    isMode15Quest,
    MODE15_RUSH_EVENT_ID,
    resetMode15RunSync,
} from "../../lib/mode15-optional";
import {
    getDefaultPlayerRushEventSync,
    getPlayerRushEventSync,
    insertPlayerRushEventSync,
} from "../../data/domains/rushEvent";
import { repairAllGauntletCompletionClassificationsSync } from "../../lib/gauntlet-completion-classification";
import { getPlayerEquipmentListSync } from "../../data/domains/equipment";
import { getPlayerCharactersManaNodesSync, getPlayerCharactersSync } from "../../data/domains/character";
import { getPlayerPartyGroupListSync } from "../../data/domains/party";
import { getPlayerQuestProgressSync } from "../../data/domains/quest";
import { isStaleAbyssBattle } from "../../lib/abyss-time-revision";
import { refreshPlayerAbyssTowersSync } from "../../data/domains/abyss-tower-progress";
import { hijackUnavailableReply } from "../../lib/http-reply";
import { ensureDailyVmoneyMailForPlayerSync } from "../../lib/daily-vmoney-mail";
import { getNewsDeliveryState, getNewsInterruptFlag } from "../../lib/news-delivery";
import { performance } from "node:perf_hooks";
import { recordServerWork } from "../../lib/server-work-performance";
import { runPersistenceTransaction, runPersistenceWriteScope } from "../../lib/persistence-coordinator";
import { serializePlayerSnapshot } from "../../data/utils/client-player-snapshot";

interface CnLoadBody {
    device_id: number;
    device_token: string;
    keychain: number;
    graphics_device_name: string;
    platform_os_version: string;
    storage_directory_path: string;
    oaid?: string;
    imei?: string;
    mac?: string;
    advertise_id?: string;
    viewer_id?: number;
}

function fillClientDefaults(d: any) {
    if (d.user_info) {
        if (typeof d.user_info.last_login_time === 'number') {
            const dt = new Date(d.user_info.last_login_time * 1000);
            const p = (n: number) => n.toString().padStart(2, '0');
            d.user_info.last_login_time = `${dt.getFullYear()}-${p(dt.getMonth()+1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
        }
        d.user_info.is_bought_fund_ex_quest ??= false;
        d.user_info.is_bought_fund_main_quest ??= false;
        d.user_info.is_bought_fund_laite ??= false;
        d.user_info.is_bought_fund_laite2 ??= false;
        d.user_info.is_bought_fund_laite3 ??= false;
        d.user_info.is_newbie ??= true;
        d.user_info.is_comeback ??= false;
        d.user_info.month_card_remain_days ??= 0;
        d.user_info.weekly_bonus_remain_days ??= 0;
        d.user_info.monthly_payment_total ??= 0;
        d.user_info.renewal_gift_remain_days ??= 0;
    }

    if (d.user_option) {
        d.user_option.episode_encyclopedia_suggest_show ??= false;
        d.user_option.server_push ??= false;
        d.user_option.stamina ??= false;
    }
}

function wrapOptionFields(d: any, playerId: number, resVer?: string) {
    const { getEffectiveVersion } = require("../../lib/version");
    d.available_asset_version = getEffectiveVersion();
    fillClientDefaults(d);
    d.cn_crash_url = `http://${getDisplayHost()}:${process.env.CN_LISTEN_PORT || "8001"}/crash`;
    d.survey_url = "";
    d.qq_group_url = "";
    d.bug_report_url = "";
    d.enable_gift = false;
    d.enable_customer_service = false;
    d.enable_rename = true;
    d.enable_delete_file = false;
    d.enable_newbie = false;
    d.enable_little_assistant = false;
    d.mission_tips = false;
    d.monthly_tip = false;
    d.simple_payment_item_list = [];
    d.ex_boost_draw_result = null;
    d.pass_force_reward = false;
    d.crazy_gacha_result_list = [];
    d.last_crazy_gacha_draw_result = [];
    d.fund_receive_list = [];
    d.login_info = {};
    d.tower_dungeon_list = [];
    d.special_exchange_campaign_list = [];
    d.win_lottery_active_mission_list = [];
    d.stars_gacha_campaign_list = [];
    // Profile favorites are stored separately as party category 99.  Do not
    // rebuild them from the normal SET1 party, or the chosen favorite is lost
    // on every load.
    d.favorite_party_group_list = getFavoritePartyGroupListSync(
        playerId,
        d.user_info?.leader_character_id || 1,
    );

    d.ranking_event_reward = [];
    d.party_list = [];

    d.payment_rebate_info = { expired_time: 0, status: 0, start_time: 0 };
    d.monthly_charge_bonus_info = { bonus_days: 0, expired_time: 0, init_time: 0, status: 0, start_time: 0 };
    d.comeback_campaign_boss_boost = { period_start_time: 0, period_end_time: 0 };

    return d;
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/load", async (request: FastifyRequest, reply: FastifyReply) => {
        try {
        let phaseStartedAt = performance.now()
        const markLoadPhase = (phase: "load.session" | "load.player" | "load.maintenance" | "load.snapshot" | "load.reconcile" | "load.serialize" | "load.active") => {
            const now = performance.now()
            recordServerWork(phase, now - phaseStartedAt)
            phaseStartedAt = now
        }
        const body = request.body as CnLoadBody;
        const viewerId = body.viewer_id || body.keychain;

        const session = await getSession(String(viewerId));
        markLoadPhase("load.session")
        if (!session || session.type !== 2) {
            reply.type("application/x-msgpack")
            return reply.send({ data_headers: generateDataHeaders({ result_code: 516 }), data: {} })
        }
        const accountId = session.accountId;
        const playerId = resolvePlayerIdSync(accountId);
        if (!playerId) {
            return reply.status(400).send({ error: "Bad Request", message: "No player found" });
        }

        const player = getPlayerSync(playerId);
        if (player === null) {
            return reply.status(500).send({ error: "Internal Server Error", message: "No player data." });
        }

        const now = getServerDate();
        // One write transaction covers load maintenance and every repair the
        // snapshot needs. It is committed before the read-only serialization,
        // so a /load performs a single COMMIT instead of one per repair.
        const prepared = await runPersistenceWriteScope({
            domain: "player", playerId, operation: "load_maintenance",
        }, (loadWrites) => {
            loadWrites.write(() => {
                ensureDailyVmoneyMailForPlayerSync(playerId, now.getTime());
                dailyResetPlayerDataSync(player, now);
                collectPlayerDataPooledExpSync(player, now);

                // Keep the login timestamp with the same player-owned transaction
                // as the other load maintenance writes.
                if (now.toDateString() !== player.lastLoginTime.toDateString()) {
                    updatePlayerSync({ id: player.id, lastLoginTime: now });
                }
            });
            markLoadPhase("load.maintenance")

            // Equipment is needed by both validation and serialization. Validators
            // mutate this request-local object when they repair a row.
            const equipmentList = getPlayerEquipmentListSync(playerId)
            runPermanentValidators(playerId, { player, equipmentList });

            // Daily reset and pooled EXP collection may update the base row. Read
            // it once after those mutations, then reuse the fresh snapshot through
            // the remaining synchronous /load pipeline.
            const currentPlayer = getPlayerSync(playerId)
            if (currentPlayer === null) return null
            markLoadPhase("load.player")

            const characterList = getPlayerCharactersSync(playerId)
            const characterManaNodeList = getPlayerCharactersManaNodesSync(playerId)
            const partyGroupList = getPlayerPartyGroupListSync(playerId)
            const questProgress = getPlayerQuestProgressSync(playerId)
            markLoadPhase("load.snapshot")

            reconcileActiveMissionFacts({
                playerId,
                player: currentPlayer,
                characterList,
                characterManaNodeList,
                equipmentList,
                partyGroupList,
                questProgress,
                repository: getContentSnapshot().repository,
                now: getServerTime() * 1000,
            })
            const removedMode15RescueRows = cleanupLegacyMode15RescueProgressSync(playerId)
            if (removedMode15RescueRows > 0) {
                console.log(`[MODE15] removed legacy rescue progress: player=${playerId} rows=${removedMode15RescueRows}`)
            }
            // AdventEvent quest visibility points at Mode15's Rush quests.  The
            // legacy client cannot resolve that cross-event condition until the
            // corresponding Rush event exists in its player model.  A completed
            // or failed run removes the server row, so recreate the empty shell
            // before serializing /load instead of requiring a visit to Rush first.
            if (
                isMode15RuntimeLoaded()
                && getPlayerRushEventSync(playerId, MODE15_RUSH_EVENT_ID) === null
            ) {
                insertPlayerRushEventSync(
                    playerId,
                    getDefaultPlayerRushEventSync(MODE15_RUSH_EVENT_ID),
                )
                console.log(`[MODE15] initialized Rush state during load: player=${playerId}`)
            }
            const repairedGauntletCompletions =
                repairAllGauntletCompletionClassificationsSync(playerId)
            if (repairedGauntletCompletions.length > 0) {
                console.log(
                    `[RUSH] repaired completed classification during load: `
                    + `player=${playerId} events=${repairedGauntletCompletions.join(",")}`,
                )
            }
            const serializedQuestProgress = removedMode15RescueRows > 0
                || repairedGauntletCompletions.length > 0
                ? getPlayerQuestProgressSync(playerId)
                : questProgress
            markLoadPhase("load.reconcile")
            // Include Rush state in the initial payload so the legacy client can
            // evaluate cross-event clear conditions on a cold visit. Optional
            // saved party slots are normalized to null before packing (rather than
            // MessagePack's unsupported undefined extension, 0xD4).
            refreshPlayerAbyssTowersSync(playerId)
            const assemblyStartedAt = performance.now()
            const prepared = prepareClientSerializedData(playerId, {
                viewerId: accountId,
                serializeRushEventData: true,
                preloadedPlayer: currentPlayer,
                preloadedCharacterList: characterList,
                preloadedCharacterManaNodeList: characterManaNodeList,
                preloadedEquipmentList: equipmentList,
                preloadedPartyGroupList: partyGroupList,
                preloadedQuestProgress: serializedQuestProgress,
                afterRepairs: () => loadWrites.finish(),
            });
            recordServerWork("load.assemble", performance.now() - assemblyStartedAt)
            return prepared
        });
        if (prepared === null) {
            return reply.status(500).send({ error: "Internal Server Error", message: "No player data." });
        }
        const conversionStartedAt = performance.now()
        const clientData: any = serializePlayerSnapshot(
            prepared.data,
            prepared.context,
            prepared.options,
        );
        recordServerWork("load.convert", performance.now() - conversionStartedAt)

        const resVer = request.headers['res_ver'] as string | undefined;
        gameVerboseLog(() => `[CN-LOAD] res_ver=${resVer || '(not sent)'} account=${accountId} player=${playerId} party_slot=${prepared.data.player.partySlot}`);
        wrapOptionFields(clientData, playerId, resVer);
        const newsDelivery = getNewsDeliveryState(accountId, now);
        clientData.has_unread_news_item = newsDelivery.hasUnreadNews;
        markLoadPhase("load.serialize")

        // Inject unfinished quest lists for battle recovery
        const activeQuest = getPlayerActiveQuestSync(playerId);
        if (activeQuest) {
            const activeRoom = activeQuest.roomNumber ? getRoom(activeQuest.roomNumber) : undefined;
            const multiRecovery = classifyMultiActiveQuestRecovery(
                activeQuest,
                activeRoom,
                viewerId,
                activeQuest.roomNumber
                    ? sessionManager.isBattleSeatRetired(activeQuest.roomNumber, viewerId)
                    : false,
            );
            if (!multiRecovery.recoverable || isStaleAbyssBattle(activeQuest)) {
                const mode15Quest = isMode15Quest(activeQuest.category, activeQuest.questId);
                // A stale multiplayer room cannot distinguish a defeat from a
                // transport loss. Mode15 therefore clears this battle record
                // without resetting the host's current 5/10/15 boundary.
                const shouldResetMode15Run = shouldResetMode15RunForStaleActiveQuest(
                    mode15Quest,
                    activeQuest,
                );
                gameVerboseLog(() => `[CN-LOAD] stale active quest cleared:`
                    + ` play=${activeQuest.playId} room=${activeQuest.roomNumber ?? "missing"}`
                    + ` reason=${multiRecovery.reason}`
                    + ` state=${activeRoom?.lifecycle?.phase ?? "missing"}`
                    + ` mode15=${mode15Quest} multiHost=${activeQuest.isMultiHost}`
                    + ` reset=${shouldResetMode15Run}`);
                const deleted = await runPersistenceTransaction({
                    domain: "multi-settlement",
                    playerId,
                    operation: "load_orphan_active_quest_cleanup",
                }, () => {
                    const deletedCurrentPlay = deletePlayerActiveQuestIfPlayIdSync(
                        playerId,
                        activeQuest.playId,
                    );
                    if (deletedCurrentPlay && shouldResetMode15Run) {
                        resetMode15RunSync(playerId);
                    }
                    return deletedCurrentPlay;
                });
                if (deleted) {
                    if (activeQuests[playerId]?.playId === activeQuest.playId) {
                        delete activeQuests[playerId];
                    }
                    clientData.unfinished_quest_list = [];
                    clientData.unfinished_multi_quest_list = [];
                } else {
                    const replacement = getPlayerActiveQuestSync(playerId);
                    const entry = replacement
                        ? { play_id: replacement.playId, continue_count: replacement.continueCount }
                        : null;
                    clientData.unfinished_quest_list = entry && !replacement!.isMulti ? [entry] : [];
                    clientData.unfinished_multi_quest_list = entry && replacement!.isMulti ? [entry] : [];
                }
            } else {
                const entry = { play_id: activeQuest.playId, continue_count: activeQuest.continueCount };
                if (activeQuest.isMulti) {
                    clientData.unfinished_quest_list = [];
                    clientData.unfinished_multi_quest_list = [entry];
                } else {
                    clientData.unfinished_quest_list = [entry];
                    clientData.unfinished_multi_quest_list = [];
                }
            }
        } else {
            clientData.unfinished_quest_list = [];
            clientData.unfinished_multi_quest_list = [];
        }
        markLoadPhase("load.active")

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: generateDataHeaders({
                asset_update: true,
                // The client treats 2 as "open the announcement list" and
                // will run that dialog again on every return to the home
                // scene. Use nil when there is no pending interrupt; unlike
                // nil, 0 is stored by the client as Some(0) and can become
                // stale state across navigation.
                force_news: getNewsInterruptFlag(newsDelivery),
                viewer_id: accountId,
                servertime: getServerTime(),
            }),
            data: clientData
        });
        } catch(e: any) {
            console.error(`[CN-LOAD] ERROR:`, e.message, e.stack);
            if (hijackUnavailableReply(request, reply)) return reply;
            return reply.status(500).send({ error: "Internal Server Error", message: e.message });
        }
    });
};

export default routes;
