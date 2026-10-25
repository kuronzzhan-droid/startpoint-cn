import { getPlayerBusinessDateSync } from "../../lib/player-time-compat"
import { isGiftEnabledSync } from "../../lib/gift-codes"
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { generateDataHeaders, getServerTime, getServerDate, getRealServerDate, getTimeOffset, withServerClock } from "../../utils";
import { collectPlayerDataPooledExpSync, dailyResetPlayerDataSync, getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { deletePlayerActiveQuestIfPlayIdSync, getPlayerActiveQuestSync } from "../../data/domains/quest_active"
import { getSession } from "../../data/domains/session"
import { prepareClientSerializedData } from "../../data/utils/player-data";
import { reconcileCrazyGachaCompletionSync } from "../../data/domains/crazy_gacha";
import { getContentSnapshot } from "../../content/runtime/content-snapshot";
import { reconcileActiveMissionFacts } from "../../lib/mission/active-reconciliation";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { getDisplayHost } from "../../multi/room/serializer";
import { runPermanentValidators } from "../../lib/validate";
import { activeQuests } from "../api/singleBattleQuest";
import { getFavoritePartyGroupListSync } from "../../lib/profileFavorite";
import { gameVerboseLog } from "../../lib/game-logging";
import { shouldResetMode15RunForStaleActiveQuest } from "../../lib/mode15-active-quest-recovery";
import type { MultiActiveQuestRecoveryDecision } from "../../lib/multi-active-quest-recovery";
import { getRoomCommandGateway } from "../../multi/coordinator/default-runtime";
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
import { runPersistenceTransaction } from "../../lib/persistence-coordinator";
import { ensurePlayerClockStateForLoadSync } from "../../lib/server-clock-state";
import { getDb } from "../../data/db";
import { detachFinalizedFiveBossActiveSync, getFiveBossRunByClientSync } from "../../data/domains/fiveBossGauntletRun";
import { isFiveBossGauntletQuest } from "../../multi/five-boss/contract";
import { isPersistenceAdmissionError } from "../../lib/persistence-admission";
import { serializePlayerSnapshot } from "../../data/utils/client-player-snapshot";
import { formatClientDisplayDateTime } from "../../lib/client-display-time";
import { withServerWorkAdmission } from "../../lib/shutdown-state";

import { contentOperations } from "../../lib/content-operations";
import { contentClientReload } from "../../lib/content-client-reload";
import { getSpecialExchangeEntitlementsSync } from "../../lib/exchange-campaign-entitlements";
import { getRetainedStarCrumbExchangeIds } from "../../lib/star-crumb-exchange-rules";
import { townThemeLoginSnapshot } from "../../lib/town-theme";
import { prepareExBoostRecoverySync, type ClientExBoostDrawResult } from "../../lib/ex-boost-recovery";

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
            d.user_info.last_login_time = formatClientDisplayDateTime(dt);
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

function wrapOptionFields(d: any, playerId: number, resVer?: string, exBoostDrawResult: ClientExBoostDrawResult | null = null) {
    d.town_presentation = townThemeLoginSnapshot();
    d.town_presentation_load = true;
    d.content_operations = contentOperations().snapshot(Date.now());
    d.star_crumb_exchange_retained_ids = getRetainedStarCrumbExchangeIds();
    const { getEffectiveVersion } = require("../../lib/version");
    d.available_asset_version = getEffectiveVersion();
    fillClientDefaults(d);
    d.cn_crash_url = `http://${getDisplayHost()}:${process.env.CN_LISTEN_PORT || "8001"}/crash`;
    d.survey_url = "";
    d.qq_group_url = "";
    d.bug_report_url = "";
    d.enable_gift = isGiftEnabledSync();
    d.enable_customer_service = false;
    d.enable_rename = true;
    d.enable_delete_file = false;
    d.enable_newbie = false;
    d.enable_little_assistant = false;
    d.mission_tips = false;
    d.monthly_tip = false;
    d.simple_payment_item_list = [];
    d.ex_boost_draw_result = exBoostDrawResult;
    d.pass_force_reward = false;
    d.fund_receive_list = [];
    d.login_info = {};
    d.tower_dungeon_list = [];
    d.special_exchange_campaign_list = getSpecialExchangeEntitlementsSync(playerId);
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
    // Initialize durable reload metadata before requests or settlement workers
    // start, so a first load only reads it while another worker owns the writer.
    contentClientReload();
    fastify.post("/content_operations", async (request, reply) => {
        const body = request.body as { viewer_id?: unknown } | null
        if (!body || !Number.isSafeInteger(body.viewer_id) || (body.viewer_id as number) <= 0) {
            return reply.status(400).send({ error: "Invalid viewer id." })
        }
        const session = await getSession(String(body.viewer_id))
        if (!session || session.type !== 2 || !resolvePlayerIdSync(session.accountId)) {
            return reply.status(401).send({ error: "Invalid session." })
        }
        reply.type("application/x-msgpack")
        return reply.send({ data_headers: generateDataHeaders({ viewer_id: body.viewer_id as number }),
            data: { content_operations: contentOperations().snapshot(Date.now()),
                star_crumb_exchange_retained_ids: getRetainedStarCrumbExchangeIds() } })
    })

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
        const loadedReloadEpoch = contentClientReload().state().epoch;

        return await withServerWorkAdmission(async () => {
        // The load snapshot preparation also repairs old saves (including
        // mana boards and stamina). Admit the complete write unit before
        // queueing, read fresh state inside it, and commit it atomically.
        const { now, prepared, exBoostDrawResult } = await runPersistenceTransaction({
            domain: "player", playerId, operation: "load_maintenance",
        }, () => {
            ensurePlayerClockStateForLoadSync(playerId, getDb());
            const now = getServerDate();
            const current = getPlayerSync(playerId);
            if (!current) throw new Error("No player data.");
            reconcileCrazyGachaCompletionSync(playerId);
            ensureDailyVmoneyMailForPlayerSync(playerId, getRealServerDate().getTime());
            dailyResetPlayerDataSync(current, now);
            collectPlayerDataPooledExpSync(current, now);
            updatePlayerSync({ id: playerId, lastLoginTime: getPlayerBusinessDateSync(playerId, now) });
            markLoadPhase("load.maintenance")

            // Maintenance can change the base row. Validators mutate these
            // request-local snapshots; none escape if this transaction fails.
            const currentPlayer = getPlayerSync(playerId)
            if (!currentPlayer) throw new Error("No player data.");
            const equipmentList = getPlayerEquipmentListSync(playerId)
            runPermanentValidators(playerId, { player: currentPlayer, equipmentList }, { throwOnError: true });
            markLoadPhase("load.player")

            const characterList = getPlayerCharactersSync(playerId)
            const exBoostDrawResult = prepareExBoostRecoverySync(playerId)
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
                now: now.getTime(),
            })
            const removedMode15RescueRows = cleanupLegacyMode15RescueProgressSync(playerId)
            if (removedMode15RescueRows > 0) {
                console.log(`[MODE15] removed legacy rescue progress: player=${playerId} rows=${removedMode15RescueRows}`)
            }
            // Preserve the empty Rush shell required for cross-event visibility
            // on a cold load, including after a completed or failed Mode15 run.
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
            refreshPlayerAbyssTowersSync(playerId)
            const assemblyStartedAt = performance.now()
            const prepared = withServerClock(now, () => prepareClientSerializedData(playerId, {
                viewerId: accountId,
                serializeRushEventData: true,
                preloadedPlayer: currentPlayer,
                preloadedCharacterList: characterList,
                preloadedCharacterManaNodeList: characterManaNodeList,
                preloadedEquipmentList: equipmentList,
                preloadedPartyGroupList: partyGroupList,
                preloadedQuestProgress: serializedQuestProgress,
            }), getTimeOffset() ?? 0);
            recordServerWork("load.assemble", performance.now() - assemblyStartedAt)
            if (!prepared) throw new Error("No player data.");
            return { now, prepared, exBoostDrawResult };
        });
        // Pure response conversion runs after COMMIT. Saved optional party slots
        // still normalize to null before MessagePack encoding.
        const conversionStartedAt = performance.now()
        const clientData: any = serializePlayerSnapshot(
            prepared.data,
            prepared.context,
            prepared.options,
        );
        recordServerWork("load.convert", performance.now() - conversionStartedAt)

        const resVer = request.headers['res_ver'] as string | undefined;
        gameVerboseLog(() => `[CN-LOAD] res_ver=${resVer || '(not sent)'} account=${accountId} player=${playerId} party_slot=${prepared.data.player.partySlot}`);
        wrapOptionFields(clientData, playerId, resVer, exBoostDrawResult);
        const newsDelivery = getNewsDeliveryState(accountId, now);
        clientData.has_unread_news_item = newsDelivery.hasUnreadNews;
        markLoadPhase("load.serialize")

        // Inject unfinished quest lists for battle recovery
        const activeQuest = getPlayerActiveQuestSync(playerId);
        if (activeQuest) {
            const fiveBossMulti = activeQuest.isMulti && isFiveBossGauntletQuest(activeQuest.category, activeQuest.questId);
            const frozenRun = fiveBossMulti ? getFiveBossRunByClientSync({ playerId, clientPlayId: activeQuest.playId }) : null;
            const multiRecovery = await getRoomCommandGateway().execute(fiveBossMulti ? "fiveBoss.recovery" : "battle.recovery", fiveBossMulti ? {
                staleQuest: activeQuest, playerId, ...(frozenRun ? { staleFrozenRunId: frozenRun.runId } : {}),
            } : { quest: activeQuest, viewerId, playerId }) as MultiActiveQuestRecoveryDecision & { roomPhase: string | null };
            if (frozenRun && !multiRecovery.recoverable) {
                const barrier = await getRoomCommandGateway().execute("fiveBoss.proof.barrier", {
                    runId: frozenRun.runId, playerId, roomNumber: frozenRun.roomNumber,
                }) as { ok: boolean };
                if (!barrier.ok) throw new Error("Previous five-boss result proof is not durably acknowledged.");
            }
            const detachedResult = fiveBossMulti && !multiRecovery.recoverable && await runPersistenceTransaction({
                domain: "multi-settlement", playerId, operation: "load_five_boss_result_pending",
            }, () => detachFinalizedFiveBossActiveSync(playerId, activeQuest.playId));
            if (detachedResult) {
                if (activeQuests[playerId]?.playId === activeQuest.playId) delete activeQuests[playerId];
                clientData.unfinished_quest_list = [];
                clientData.unfinished_multi_quest_list = [];
            } else if ((!multiRecovery.recoverable || isStaleAbyssBattle(activeQuest)) && contentClientReload().preservesPlay(playerId, activeQuest.playId)) {
                // Operational reload may retire a transport seat. Keep only the
                // exact registered play; do not advertise an impossible restore
                // or change finish/abort eligibility and rewards.
                clientData.unfinished_quest_list = [];
                clientData.unfinished_multi_quest_list = [];
            } else if (multiRecovery.retained && !isStaleAbyssBattle(activeQuest)) {
                // A lobby can advance before another member posts its result.
                // Keep that exact play for finish; legacy clients cannot resume
                // gameplay after Finalize or rejoin it in a newer room battle.
                clientData.unfinished_quest_list = [];
                clientData.unfinished_multi_quest_list = [];
                gameVerboseLog(() => `[CN-LOAD] retained result play=${activeQuest.playId}`
                    + ` room=${activeQuest.roomNumber} reason=${multiRecovery.reason}`);
            } else if (!multiRecovery.recoverable || isStaleAbyssBattle(activeQuest)) {
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
                    + ` state=${multiRecovery.roomPhase ?? "missing"}`
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

        const response = {
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
        };
        await runPersistenceTransaction({ domain: "account", operation: "acknowledge_cn_client_load" }, () => {
            contentClientReload().acknowledge(viewerId, loadedReloadEpoch);
            contentClientReload().pruneFinishedPlays(playerId);
        });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send(response);
        });
        } catch(e: any) {
            if (hijackUnavailableReply(request, reply)) return reply;
            // Preserve the game protocol's bounded-queue retry response.
            if (isPersistenceAdmissionError(e)) throw e;
            console.error(`[CN-LOAD] ERROR:`, e.message, e.stack);
            return reply.status(500).send({ error: "Internal Server Error", message: e.message });
        }
    });
};

export default routes;
