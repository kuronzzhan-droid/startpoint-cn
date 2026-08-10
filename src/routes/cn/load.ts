import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { generateDataHeaders, getServerTime, getServerDate } from "../../utils";
import { collectPlayerDataPooledExpSync, dailyResetPlayerDataSync, getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { deletePlayerActiveQuestSync, getPlayerActiveQuestSync } from "../../data/domains/quest_active"
import { getSession } from "../../data/domains/session"
import { getClientSerializedData } from "../../data/utils";
import { getContentSnapshot } from "../../content/runtime/content-snapshot";
import { reconcileActiveMissionFacts } from "../../lib/mission/active-reconciliation";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { getDisplayHost } from "../../multi/room/serializer";
import { getRoom } from "../../multi/room/manager";
import { runPermanentValidators } from "../../lib/validate";
import { activeQuests } from "../api/singleBattleQuest";
import { getFavoritePartyGroupListSync } from "../../lib/profileFavorite";
import { gameVerboseLog } from "../../lib/game-logging";
import { shouldResetMode15RunForStaleActiveQuest } from "../../lib/mode15-active-quest-recovery";
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

function wrapOptionFields(d: any, playerId: number, resVer?: string) {
    // Report effective server version (CDN + patches) to trigger client update
    const { getEffectiveVersion } = require("../../lib/version");
    d.available_asset_version = getEffectiveVersion();

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
        const body = request.body as CnLoadBody;
        const viewerId = body.viewer_id || body.keychain || 1;

        const session = await getSession(String(viewerId));
        const accountId = session ? session.accountId : (body.viewer_id || body.keychain || 1);
        const playerId = resolvePlayerIdSync(accountId);
        if (!playerId) {
            return reply.status(400).send({ error: "Bad Request", message: "No player found" });
        }

        const player = getPlayerSync(playerId);
        if (player === null) {
            return reply.status(500).send({ error: "Internal Server Error", message: "No player data." });
        }

        const now = getServerDate();
        dailyResetPlayerDataSync(player, now);
        collectPlayerDataPooledExpSync(player, now);

        // Run save validators (permanent fixes: max_level, etc.)
        runPermanentValidators(playerId);

        // 若自定义时间与 lastLogin 不同步，强制对齐（防止客户端弹"日期变了"）
        if (now.toDateString() !== player.lastLoginTime.toDateString()) {
            updatePlayerSync({ id: player.id, lastLoginTime: now });
        }

        reconcileActiveMissionFacts({
            playerId,
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
        // Include Rush state in the initial payload so the legacy client can
        // evaluate cross-event clear conditions on a cold visit. Optional
        // saved party slots are normalized to null before packing (rather than
        // MessagePack's unsupported undefined extension, 0xD4).
        const clientData = getClientSerializedData(playerId, {
            viewerId: accountId,
            serializeRushEventData: true,
        }) as any;
        if (clientData === null) {
            return reply.status(500).send({ error: "Internal Server Error", message: "No player data." });
        }

        const resVer = request.headers['res_ver'] as string | undefined;
        gameVerboseLog(() => `[CN-LOAD] res_ver=${resVer || '(not sent)'} account=${accountId} player=${playerId} party_slot=${clientData?.user_info?.party_slot}`);
        wrapOptionFields(clientData, playerId, resVer);

        // Inject unfinished quest lists for battle recovery
        const activeQuest = getPlayerActiveQuestSync(playerId);
        if (activeQuest) {
            // A multiplayer client can disconnect during settlement before its
            // own finish request removes the active quest.  Once the room has
            // already returned to the lobby, that battle can no longer be
            // resumed and exposing it as unfinished traps the client in a loop.
            const activeRoom = activeQuest.roomNumber ? getRoom(activeQuest.roomNumber) : undefined;
            const roomExists = activeQuest.roomNumber ? !!activeRoom : true;
            const completedMultiRoom = activeQuest.isMulti && !!activeRoom && activeRoom.raising_state !== 4;
            const noLongerInCurrentBattle = activeQuest.isMulti
                && !!activeRoom
                && activeRoom.raising_state === 4
                && activeRoom.expected_real_viewer_ids.length > 0
                && !activeRoom.expected_real_viewer_ids.includes(accountId);
            if (!roomExists || completedMultiRoom || noLongerInCurrentBattle) {
                const mode15Quest = isMode15Quest(activeQuest.category, activeQuest.questId);
                // Multiplayer rescue guests never own the Mode15 run represented
                // by this room. Loading-stage disconnects may remove them from the
                // room before /cn/load recovers their stale active quest, so only
                // a persisted host marker is authoritative once the room is gone.
                const shouldResetMode15Run = shouldResetMode15RunForStaleActiveQuest(
                    mode15Quest,
                    activeQuest,
                );
                gameVerboseLog(() => `[CN-LOAD] stale active quest cleared: room=${activeQuest.roomNumber} exists=${roomExists} state=${activeRoom?.raising_state ?? "missing"} mode15=${mode15Quest} multiHost=${activeQuest.isMultiHost} reset=${shouldResetMode15Run}`);
                if (shouldResetMode15Run) {
                    resetMode15RunSync(playerId);
                }
                deletePlayerActiveQuestSync(playerId);
                delete activeQuests[playerId];
                clientData.unfinished_quest_list = [];
                clientData.unfinished_multi_quest_list = [];
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

        reply.header("content-type", "application/x-msgpack");
        reply.status(200).send({
            data_headers: generateDataHeaders({
                asset_update: true,
                viewer_id: accountId,
                servertime: getServerTime(),
            }),
            data: clientData
        });
        } catch(e: any) {
            console.error(`[CN-LOAD] ERROR:`, e.message, e.stack);
            return reply.status(500).send({ error: "Internal Server Error", message: e.message });
        }
    });
};

export default routes;
