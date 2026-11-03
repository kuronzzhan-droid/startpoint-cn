"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a, _b, _c, _d;
var _e;
Object.defineProperty(exports, "__esModule", { value: true });
const file_exists_1 = require("./lib/file-exists");
const fastify_1 = __importDefault(require("fastify"));
const msgpackr_1 = require("msgpackr");
const cn_response_hook_1 = require("./lib/cn-response-hook");
const static_1 = __importDefault(require("@fastify/static"));
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const atomic_json_file_1 = require("./lib/atomic-json-file");
const storage_layout_1 = require("./lib/storage-layout");
const utils_1 = require("./utils");
const activeAccount_1 = require("./data/activeAccount");
const session_1 = require("./data/domains/session");
const management_auth_1 = require("./lib/management-auth");
const route_performance_1 = require("./lib/route-performance");
const online_presence_1 = require("./lib/online-presence");
const takeover_access_1 = require("./lib/takeover-access");
const player_login_1 = require("./lib/player-login");
const playerLogin_1 = __importStar(require("./routes/cn/playerLogin"));
const client_admission_1 = require("./lib/client-admission");
const default_runtime_1 = require("./multi/coordinator/default-runtime");
const durable_owner_event_1 = require("./multi/coordinator/durable-owner-event");
const local_client_compat_1 = require("./lib/local-client-compat");
const version_1 = require("./lib/version");
const custom_cdn_resource_routes_1 = require("./lib/custom-cdn-resource-routes");
const file_download_1 = require("./lib/file-download");
const client_address_1 = require("./lib/client-address");
const crash_report_1 = require("./lib/crash-report");
const process_guards_1 = require("./lib/process-guards");
const versionCheck_1 = __importDefault(require("./routes/cn/versionCheck"));
const ios_leiting_1 = __importDefault(require("./routes/cn/ios-leiting"));
const leitingAuth_1 = __importDefault(require("./routes/cn/leitingAuth"));
const tool_1 = __importDefault(require("./routes/cn/tool"));
const load_1 = __importDefault(require("./routes/cn/load"));
const asset_1 = __importDefault(require("./routes/cn/asset"));
const takeOver_1 = __importDefault(require("./routes/cn/takeOver"));
const web_1 = __importDefault(require("./routes/web"));
const web_api_1 = __importDefault(require("./routes/web_api"));
const seeds_1 = __importDefault(require("./routes/web_api/seeds"));
const modAdmin_1 = __importDefault(require("./routes/api/modAdmin"));
const seed_validator_1 = __importDefault(require("./lib/seed-validator"));
const reproduce_1 = __importDefault(require("./routes/api/reproduce"));
const tutorial_1 = __importDefault(require("./routes/api/tutorial"));
const gacha_1 = __importDefault(require("./routes/api/gacha"));
const party_1 = __importDefault(require("./routes/api/party"));
const expod_1 = __importDefault(require("./routes/api/expod"));
const storyQuest_1 = __importDefault(require("./routes/api/storyQuest"));
const option_1 = __importDefault(require("./routes/api/option"));
const singleBattleQuest_1 = __importDefault(require("./routes/api/singleBattleQuest"));
const quest_1 = __importDefault(require("./routes/api/quest"));
const multi_1 = require("./multi");
const attention_1 = __importDefault(require("./routes/api/attention"));
const character_1 = __importDefault(require("./routes/api/character"));
const mana_1 = __importDefault(require("./routes/api/character/mana"));
const bond_1 = __importDefault(require("./routes/api/character/bond"));
const partyGroup_1 = __importDefault(require("./routes/api/partyGroup"));
const equipment_1 = __importDefault(require("./routes/api/equipment"));
const sell_1 = __importDefault(require("./routes/api/sell"));
const exBoost_1 = __importDefault(require("./routes/api/exBoost"));
const weaponRiven_1 = __importDefault(require("./routes/api/weaponRiven"));
const growthFund_1 = __importDefault(require("./routes/api/growthFund"));
const boxGacha_1 = __importDefault(require("./routes/api/boxGacha"));
const shop_1 = __importDefault(require("./routes/api/shop"));
const exchange_1 = __importDefault(require("./routes/api/exchange"));
const encyclopedia_1 = __importDefault(require("./routes/api/encyclopedia"));
const mail_1 = __importDefault(require("./routes/api/mail"));
const rankingEvent_1 = __importDefault(require("./routes/api/rankingEvent"));
const mission_1 = __importDefault(require("./routes/api/mission"));
const activeMission_1 = __importDefault(require("./routes/api/activeMission"));
const passCard_1 = __importDefault(require("./routes/api/passCard"));
const payment_1 = __importDefault(require("./routes/api/payment"));
const news_1 = __importDefault(require("./routes/api/news"));
const raidEvent_1 = __importDefault(require("./routes/api/raidEvent"));
const rushEvent_1 = __importDefault(require("./routes/api/rushEvent"));
const abyssRecords_1 = __importDefault(require("./routes/cn/abyssRecords"));
const carnivalEvent_1 = __importDefault(require("./routes/api/carnivalEvent"));
const howToGet_1 = __importDefault(require("./routes/api/howToGet"));
const contentsGuide_1 = __importDefault(require("./routes/api/contentsGuide"));
const profile_1 = __importDefault(require("./routes/api/profile"));
const follow_1 = __importDefault(require("./routes/api/follow"));
const sns_1 = __importDefault(require("./routes/api/sns"));
const history_1 = __importDefault(require("./routes/api/history"));
const playerHistory_1 = __importDefault(require("./routes/api/playerHistory"));
const comic_1 = __importDefault(require("./routes/api/comic"));
const questUnlock_1 = __importDefault(require("./routes/api/questUnlock"));
const item_1 = __importDefault(require("./routes/api/item"));
const lounge_1 = __importDefault(require("./routes/api/lounge"));
const multiSpecialExchange_1 = __importDefault(require("./routes/api/multiSpecialExchange"));
const player_party_pool_1 = require("./multi/npc/player-party-pool");
const ios_compat_1 = require("./lib/ios-compat");
const db_1 = require("./data/db");
const receive_history_retention_1 = require("./lib/receive-history-retention");
const battle_receipt_retention_1 = require("./lib/battle-receipt-retention");
const settlement_1 = require("./lib/leaderboard/settlement");
const daily_vmoney_mail_1 = require("./lib/daily-vmoney-mail");
const sqlite_checkpoint_worker_1 = require("./lib/sqlite-checkpoint-worker");
const persistence_coordinator_1 = require("./lib/persistence-coordinator");
const sqlite_persistence_worker_1 = require("./lib/sqlite-persistence-worker");
// Side-effect import: binds command names to domain code for the in-process
// fallback path. The writer worker loads the same module on its own thread.
require("./lib/persistence/commands");
const writer_client_1 = require("./lib/persistence/writer-client");
const game_logging_1 = require("./lib/game-logging");
const persistence_http_errors_1 = require("./lib/persistence-http-errors");
const shutdown_state_1 = require("./lib/shutdown-state");
const graceful_shutdown_1 = require("./lib/graceful-shutdown");
const background_worker_1 = require("./lib/leaderboard/background-worker");
const player_save_export_1 = require("./lib/player-save-export");
(_a = (_e = process.env).MULTI_REALTIME_PROCESS) !== null && _a !== void 0 ? _a : (_e.MULTI_REALTIME_PROCESS = "1");
const fastify = (0, fastify_1.default)({
    logger: {
        // Production-safe default avoids per-request access-log formatting.
        // Debug launchers explicitly opt back into info.
        level: process.env.LOG_LEVEL || "warn"
    },
    // request.ip honours X-Forwarded-For only from trusted proxy hops.
    trustProxy: (0, client_address_1.trustProxySetting)(),
    bodyLimit: 262144 // 256KB — covers /single_battle_quest/finish large battle stats
});
fastify.addHook("onRequest", () => __awaiter(void 0, void 0, void 0, function* () { (0, shutdown_state_1.assertServerAcceptingWork)(); }));
(0, local_client_compat_1.installLocalClientCompat)(fastify, process.env.CN_LOCAL_CLIENT_PLATFORM || ((0, version_1.getPatchManifest)().patches.some(p => p.enabled && p.local_test_only
    && p.required_local_platform === "android") ? "android" : undefined));
(0, route_performance_1.installRoutePerformanceMonitor)(fastify);
// Viewer IDs >= 900,000,000 are interpreted as COM/AI members by the
// multiplayer protocol. Repair legacy human sessions before rooms can open.
const migratedUnsafeViewerIds = (0, session_1.migrateUnsafeViewerIdsSync)();
if (migratedUnsafeViewerIds > 0) {
    console.log(`[MULTI] migrated ${migratedUnsafeViewerIds} legacy viewer ID(s) out of the COM range`);
}
// Restore saved time offset from active player on startup
(0, activeAccount_1.restoreTimeOffset)();
// Game endpoints remain public; only the legacy management pages and their
// management APIs are protected by the password session below.
(0, management_auth_1.installManagementAuth)(fastify);
// Simple in-memory rate limiter for /crash endpoint only.
// /debug is excluded — game client sends heavy beacon traffic during normal startup.
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW = 60000;
// A hostile client can rotate source IPs; expiry alone must not make this map
// grow for the lifetime of the process.
const RATE_LIMIT_MAP_MAX = 4096;
let nextRateLimitSweep = 0;
fastify.addHook("onRequest", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    if (request.routeOptions.url === "/crash") {
        const ip = request.ip;
        const now = Date.now();
        if (now >= nextRateLimitSweep) {
            for (const [key, value] of rateLimitMap) {
                if (value.reset <= now)
                    rateLimitMap.delete(key);
            }
            nextRateLimitSweep = now + RATE_LIMIT_WINDOW;
        }
        const existing = rateLimitMap.get(ip);
        if (!existing && rateLimitMap.size >= RATE_LIMIT_MAP_MAX) {
            return reply.status(429).send("Too Many Requests");
        }
        const entry = existing || { count: 0, reset: now + RATE_LIMIT_WINDOW };
        if (now > entry.reset) {
            entry.count = 0;
            entry.reset = now + RATE_LIMIT_WINDOW;
        }
        if (++entry.count > RATE_LIMIT_MAX) {
            return reply.status(429).send("Too Many Requests");
        }
        rateLimitMap.set(ip, entry);
    }
}));
// Lightweight online counter: reuse normal game traffic and keep only a
// viewerId -> lastSeen timestamp in memory. No database writes or extra client
// requests are introduced. The management page treats five-minute activity as
// online presence.
fastify.addHook("onResponse", (request) => __awaiter(void 0, void 0, void 0, function* () {
    if (!request.url.startsWith("/api/index.php/"))
        return;
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body))
        return;
    (0, online_presence_1.markPlayerOnline)(body.viewer_id);
}));
(0, cn_response_hook_1.installCnResponseEncoding)(fastify);
(0, persistence_http_errors_1.installPersistenceHttpErrors)(fastify);
function jsonParser(request, body, done) {
    if (request.routeOptions.url === "/crash")
        return done(null, (0, crash_report_1.parseCrashReportBody)(body));
    try {
        done(null, JSON.parse(body));
    }
    catch (_a) {
        done(null, undefined);
    }
}
fastify.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
    if (_request.routeOptions.url === "/crash")
        return done(null, (0, crash_report_1.parseCrashReportBody)(body));
    try {
        done(null, (0, msgpackr_1.unpack)(Buffer.from(body, "base64")));
    }
    catch (_a) {
        try {
            done(null, Object.fromEntries(new URLSearchParams(body)));
        }
        catch (_b) {
            jsonParser(_request, body, done);
        }
    }
});
fastify.addContentTypeParser("application/json", { parseAs: "string" }, jsonParser);
(0, player_login_1.initializePlayerLogin)(viewerId => {
    void (() => __awaiter(void 0, void 0, void 0, function* () { return yield (0, default_runtime_1.getRoomCommandGateway)().execute("runtime.disconnect", { viewerId }); }))().catch((error) => __awaiter(void 0, void 0, void 0, function* () {
        if ((0, shutdown_state_1.isServerShuttingDown)() && (error === null || error === void 0 ? void 0 : error.code) === "SERVER_CLOSING")
            return;
        console.error("[MULTI-REALTIME] login revocation could not reach owner", error);
        yield Promise.resolve().then(() => __importStar(require("./multi/coordinator/default-runtime"))).then(runtime => runtime.failRealtimeOwner());
    }));
});
(0, client_admission_1.installClientAdmission)(fastify);
(0, playerLogin_1.installPlayerLoginGuard)(fastify);
(0, takeover_access_1.installTakeoverUdidGuard)(fastify);
fastify.register(playerLogin_1.default);
fastify.register(abyssRecords_1.default);
const iosCompat = (0, ios_compat_1.parseIosCompatConfig)();
fastify.register(versionCheck_1.default, { ios: iosCompat });
if (iosCompat.enabled) {
    // Native Leiting SDK requests use bare paths rather than /api/index.php.
    fastify.register(ios_leiting_1.default, { ios: iosCompat });
    console.log(`[iOS] compatibility enabled: ${iosCompat.apiScheme}://${iosCompat.apiHost}`);
}
fastify.register(leitingAuth_1.default, { prefix: "/api/index.php" });
const apiPrefix = "/api/index.php";
fastify.register(load_1.default, { prefix: apiPrefix });
fastify.register(asset_1.default, { prefix: `${apiPrefix}/asset` });
fastify.register(takeOver_1.default, { prefix: apiPrefix });
function stubMsgpackReply(reply, data, playerId) {
    const servertime = playerId ? (0, utils_1.getServerTimeForPlayer)(playerId) : (0, utils_1.getServerTime)();
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({
        data_headers: { force_update: false, asset_update: false, short_udid: 0, viewer_id: 0, servertime, result_code: 1 },
        data
    });
}
fastify.post(`${apiPrefix}/assetintitle/version_info_in_title`, (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    const { getAssetDownloadSize, getVersionInfo } = require("./routes/cn/asset");
    const resVer = request.headers['res_ver'];
    const device = request.headers.device;
    return stubMsgpackReply(reply, getVersionInfo(CDN_BASE_URL, getAssetDownloadSize(resVer, device), device));
}));
fastify.post(`${apiPrefix}/tool/check_social_link_enable`, (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    return stubMsgpackReply(reply, { enable: false });
}));
// Gift code exchange (礼包码兑换): enable button in menu, exchange not implemented
fastify.post(`${apiPrefix}/tool/check_enable_gift`, (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    return stubMsgpackReply(reply, { enable_gift: true });
}));
fastify.post(`${apiPrefix}/tool/contact_active`, (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    return stubMsgpackReply(reply, { enable_customer_service: false });
}));
fastify.post(`${apiPrefix}/tool/custom_notify`, (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    return stubMsgpackReply(reply, {});
}));
fastify.post(`${apiPrefix}/channels/channel_leiting_pay/query_unfinish_order`, (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    return stubMsgpackReply(reply, { order_id: "" });
}));
fastify.post(`${apiPrefix}/channels/channel_leiting_pay/query_purcharge`, (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    return stubMsgpackReply(reply, { status: 3 }); // 3 = purchase success
}));
fastify.post(`${apiPrefix}/channels/channel_leiting_pay/set_unfinish_order_status`, (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    return stubMsgpackReply(reply, {});
}));
// Episode trial reading: finish stub (character story trial)
fastify.post(`${apiPrefix}/episode_trial_reading/finish`, (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    return stubMsgpackReply(reply, {});
}));
// Public diagnostic feedback keeps the legacy OK response, but cannot create
// arbitrary pools or force one disk-flush waiter for every public request.
fastify.addHook("onRequest", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    const route = request.routeOptions.url;
    if (route !== "/debug" && route !== "/crash")
        return;
    if (!seed_validator_1.default.allowPublicFeedbackRequest(request.ip))
        return reply.status(200).send("OK");
}));
function parseSeedFeedbackFields(text, allowStarFallback = false) {
    var _a, _b;
    // Read whole tokens: "fes-other", "5.1" and "10" must never become
    // known movie "fes", rarity 5 or play=1. Conflicting fields are ambiguous.
    const fields = new Map();
    const pattern = /(?:^|[\s,|;:"'\\{(\[])(seed|movie_id|play|結果レア度)=([^\s,|;"'\\})\]]*)/g;
    for (const match of text.matchAll(pattern)) {
        if (fields.has(match[1]) && fields.get(match[1]) !== match[2])
            return;
        fields.set(match[1], match[2]);
    }
    const seedText = fields.get("seed");
    const movieId = (_a = fields.get("movie_id")) !== null && _a !== void 0 ? _a : "normal";
    const playText = fields.get("play");
    if (!seedText || !/^\d+$/.test(seedText) || !movieId
        || (playText !== undefined && !/^[01]$/.test(playText)))
        return;
    const seed = Number(seedText);
    if (!Number.isSafeInteger(seed) || seed < 0)
        return;
    let rarityText = fields.get("結果レア度");
    if (rarityText === undefined && allowStarFallback) {
        rarityText = (_b = text.match(/(?:★|â)[^\s,|;"'\\})\]]*/)) === null || _b === void 0 ? void 0 : _b[0];
    }
    const rarity = rarityText === null || rarityText === void 0 ? void 0 : rarityText.match(/^(?:★|â)([3-5])$/);
    if (rarityText !== undefined && !rarity)
        return;
    return { movieId, seed, rarity: rarity ? Number(rarity[1]) : undefined,
        didPlay: playText === undefined ? null : playText === "1" };
}
function parseC3032Beacon(loc, source) {
    if (typeof loc !== "string" || loc.length > 8192 || !loc.includes("C3032"))
        return;
    const fields = parseSeedFeedbackFields(loc, true);
    if (!fields || fields.rarity === undefined)
        return;
    seed_validator_1.default.applyPublicFeedback(source, Object.assign({ kind: "c3032" }, fields), true);
}
function parsePlayBeacon(loc, source) {
    if (typeof loc !== "string" || loc.length > 8192 || !loc.startsWith("PLAY|"))
        return;
    const fields = parseSeedFeedbackFields(loc);
    if (!fields || fields.didPlay === null)
        return;
    seed_validator_1.default.applyPublicFeedback(source, Object.assign({ kind: "play" }, fields), true);
}
fastify.get("/debug", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    var _f;
    const loc = (_f = request.query) === null || _f === void 0 ? void 0 : _f.loc;
    try {
        parseC3032Beacon(loc, request.ip);
        parsePlayBeacon(loc, request.ip);
    }
    catch (_) { }
    return reply.status(200).send("OK");
}));
fastify.post("/debug", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    var _g;
    const loc = (_g = request.body) === null || _g === void 0 ? void 0 : _g.loc;
    if (typeof loc === "string")
        (0, game_logging_1.gameVerboseLog)(() => `[BEACON ${new Date().toISOString()}] ${loc.slice(0, 8192)}`);
    try {
        parseC3032Beacon(loc, request.ip);
        parsePlayBeacon(loc, request.ip);
    }
    catch (_) { }
    return reply.status(200).send("OK");
}));
fastify.post("/crash", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    const bodyStr = (0, crash_report_1.crashReportText)(request.body);
    // Logging remains structured and bounded. Seed evidence uses the full report.
    console.log(`[CRASH] ${JSON.stringify((0, crash_report_1.createCrashLogRecord)(request.body, request.id))}`);
    try {
        const fields = parseSeedFeedbackFields(bodyStr);
        if (fields && fields.rarity !== undefined && bodyStr.includes("C3032")) {
            // Legacy crash reports do not imply successful animation playback.
            seed_validator_1.default.applyPublicFeedback(request.ip, {
                kind: "crash", movieId: fields.movieId,
                seed: fields.seed, rarity: fields.rarity,
            }, true);
        }
    }
    catch (_) { }
    // The existing bounded feedback state feeds the normal batched writer.
    // Public requests never enqueue a persistence barrier; close still drains it.
    return reply.status(200).send("OK");
}));
fastify.register(tool_1.default, { prefix: `${apiPrefix}/tool` });
fastify.register(reproduce_1.default, { prefix: `${apiPrefix}/reproduce` });
fastify.register(tutorial_1.default, { prefix: `${apiPrefix}/tutorial` });
fastify.register(gacha_1.default, { prefix: `${apiPrefix}/gacha` });
fastify.register(party_1.default, { prefix: `${apiPrefix}/party` });
fastify.register(expod_1.default, { prefix: `${apiPrefix}/expod` });
fastify.register(storyQuest_1.default, { prefix: `${apiPrefix}/story_quest` });
fastify.register(option_1.default, { prefix: `${apiPrefix}/option` });
fastify.register(singleBattleQuest_1.default, { prefix: `${apiPrefix}/single_battle_quest` });
fastify.register(quest_1.default, { prefix: `${apiPrefix}/quest` });
fastify.register(multi_1.multiBattleRoutes, { prefix: `${apiPrefix}/multi_battle_quest` });
fastify.register(attention_1.default, { prefix: `${apiPrefix}/attention` });
fastify.register(character_1.default, { prefix: `${apiPrefix}/character` });
fastify.register(mana_1.default, { prefix: `${apiPrefix}/character` });
fastify.register(bond_1.default, { prefix: `${apiPrefix}/character` });
fastify.register(partyGroup_1.default, { prefix: `${apiPrefix}/party_group` });
fastify.register(equipment_1.default, { prefix: `${apiPrefix}/equipment` });
fastify.register(sell_1.default, { prefix: `${apiPrefix}/equipment` });
fastify.register(exBoost_1.default, { prefix: `${apiPrefix}/ex_boost` });
fastify.register(weaponRiven_1.default, { prefix: `${apiPrefix}/weapon_riven` });
fastify.register(growthFund_1.default, { prefix: `${apiPrefix}/growth_fund` });
fastify.register(boxGacha_1.default, { prefix: `${apiPrefix}/box_gacha` });
fastify.register(shop_1.default, { prefix: `${apiPrefix}/shop` });
fastify.register(exchange_1.default, { prefix: `${apiPrefix}/exchange` });
fastify.register(encyclopedia_1.default, { prefix: `${apiPrefix}/encyclopedia` });
fastify.register(mail_1.default, { prefix: `${apiPrefix}/mail` });
fastify.register(rankingEvent_1.default, { prefix: `${apiPrefix}/ranking_event` });
fastify.register(mission_1.default, { prefix: `${apiPrefix}/mission` });
fastify.register(activeMission_1.default, { prefix: `${apiPrefix}/active_mission` });
fastify.register(passCard_1.default, { prefix: `${apiPrefix}/Pass_card` });
fastify.register(payment_1.default, { prefix: `${apiPrefix}/payment` });
fastify.register(news_1.default, { prefix: `${apiPrefix}/news` });
fastify.register(raidEvent_1.default, { prefix: `${apiPrefix}/event/raid` });
fastify.register(rushEvent_1.default, { prefix: `${apiPrefix}/event/rush` });
fastify.register(carnivalEvent_1.default, { prefix: `${apiPrefix}/carnival_event` });
fastify.register(contentsGuide_1.default, { prefix: `${apiPrefix}/contents_guide` });
fastify.register(profile_1.default, { prefix: `${apiPrefix}/profile` });
fastify.register(follow_1.default, { prefix: `${apiPrefix}/follow` });
fastify.register(sns_1.default, { prefix: `${apiPrefix}/sns` });
fastify.register(history_1.default, { prefix: `${apiPrefix}/history` });
fastify.register(playerHistory_1.default, { prefix: `${apiPrefix}/player_history` });
fastify.register(comic_1.default, { prefix: `${apiPrefix}/comic` });
fastify.register(questUnlock_1.default, { prefix: `${apiPrefix}/quest` });
fastify.register(item_1.default, { prefix: `${apiPrefix}/item` });
fastify.register(lounge_1.default, { prefix: `${apiPrefix}/lounge` });
fastify.register(multiSpecialExchange_1.default, { prefix: `${apiPrefix}/multi_special_exchange` });
fastify.register(howToGet_1.default, { prefix: `${apiPrefix}/how_to_get` });
// Web management panel
fastify.register(web_1.default);
fastify.register(web_api_1.default, { prefix: "/api" });
fastify.register(seeds_1.default, { prefix: "/api/seeds" });
fastify.register(modAdmin_1.default, { prefix: "/api/mod-admin" });
const cdnHost = process.env.CN_LISTEN_HOST || "localhost";
const cdnPort = process.env.CN_LISTEN_PORT || "8001";
const cdnDisplayHost = cdnHost === "0.0.0.0" ? "localhost" : cdnHost;
const CDN_BASE_URL = process.env.CDN_BASE_URL || `http://${cdnDisplayHost}:${cdnPort}/patch/cn`;
const cdnDir = process.env.CDN_DIR || ".cdn";
// Native readers can request common, medium, Android or iOS files directly.
(0, custom_cdn_resource_routes_1.installCustomCdnResourceRoutes)(fastify, {
    patchRoot: path_1.default.join(__dirname, "..", "assets", "asset-patch"),
    cdnRoot: path_1.default.isAbsolute(cdnDir) ? cdnDir : path_1.default.join(__dirname, "..", cdnDir),
});
// Serve patch archive files for asset update
fastify.get("/patch/cn/asset-patch/active/:file", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    const { file } = request.params;
    const patchFile = (0, file_download_1.resolvePlainFileInside)(path_1.default.join(__dirname, "..", "assets", "asset-patch", "active"), file);
    if (patchFile && (0, file_download_1.sendFileStream)(reply, patchFile, "application/zip")) {
        return reply;
    }
    return reply.status(404).send("Not Found");
}));
fastify.register(static_1.default, {
    root: path_1.default.isAbsolute(cdnDir) ? cdnDir : path_1.default.join(__dirname, "..", cdnDir),
    prefix: "/patch",
    decorateReply: false
});
// Web static assets
fastify.register(static_1.default, {
    root: path_1.default.join(__dirname, "..", "web", "public"),
    prefix: "/public",
    decorateReply: false
});
// New admin SPA (React, built from admin/ into web/dist) — served at /admin.
// Old pages at / stay untouched until the SPA fully replaces them (see docs/admin-refactor-plan.md).
const adminDistDir = path_1.default.join(__dirname, "..", "web", "dist");
const adminSpaAvailable = (0, file_exists_1.existsSync)(path_1.default.join(adminDistDir, "index.html"));
if (adminSpaAvailable) {
    fastify.register(static_1.default, {
        root: adminDistDir,
        prefix: "/admin/",
        decorateReply: false
    });
    fastify.get("/admin", (_request, reply) => reply.redirect("/admin/"));
}
else {
    console.log("[admin] web/dist not found — admin SPA disabled (run: npm run build:admin)");
}
// Catch-all to log unknown endpoints
fastify.setNotFoundHandler((request, reply) => {
    // SPA fallback: client-side routes like /admin/accounts resolve to index.html
    if (adminSpaAvailable && request.method === "GET" && request.url.startsWith("/admin/")) {
        reply.header("content-type", "text/html; charset=utf-8");
        reply.send((0, fs_1.readFileSync)(path_1.default.join(adminDistDir, "index.html")));
        return;
    }
    (0, game_logging_1.gameVerboseLog)(() => `[UNKNOWN] ${request.method} ${request.url}`);
    reply.status(404).send({ error: "Not Found" });
});
const host = (_b = process.env.CN_LISTEN_HOST) !== null && _b !== void 0 ? _b : "127.0.0.1";
const port = parseInt((_c = process.env.CN_LISTEN_PORT) !== null && _c !== void 0 ? _c : "8001");
const logDirectory = path_1.default.resolve(__dirname, "../.logs");
const readyFilePath = path_1.default.join(logDirectory, "cn-server-ready.json");
(0, fs_1.mkdirSync)(logDirectory, { recursive: true });
(0, fs_1.rmSync)(readyFilePath, { force: true });
const receiveHistoryRetention = (0, receive_history_retention_1.createReceiveHistoryRetentionService)((0, db_1.getDb)(), {
    executeTransaction: persistence_coordinator_1.runPersistenceTransaction,
});
const battleReceiptRetention = (0, battle_receipt_retention_1.createBattleReceiptRetentionService)((0, db_1.getDb)(), {
    executeTransaction: persistence_coordinator_1.runPersistenceTransaction,
});
const leaderboardSettlementScheduler = (0, settlement_1.createLeaderboardSettlementScheduler)();
const dailyVmoneyMailScheduler = (0, daily_vmoney_mail_1.createDailyVmoneyMailScheduler)((0, db_1.getDb)());
let producerStops = null;
function quiesceServer() {
    if (producerStops)
        return;
    (0, shutdown_state_1.beginServerShutdown)();
    const stop = (operation) => {
        try {
            return Promise.resolve(operation());
        }
        catch (error) {
            return Promise.reject(error);
        }
    };
    // Stop every source before awaiting long-running accepted work. The owner
    // stays alive for in-flight business and durable same-ID publications.
    producerStops = Promise.allSettled([
        stop(() => (0, fs_1.rmSync)(readyFilePath, { force: true })),
        stop(() => dailyVmoneyMailScheduler.stop()),
        stop(() => leaderboardSettlementScheduler.stop()),
        stop(() => receiveHistoryRetention.stop()),
        stop(() => battleReceiptRetention.stop()),
        stop(() => (0, durable_owner_event_1.quiesceDurableOwnerEvents)()),
        stop(() => (0, default_runtime_1.quiesceRealtimeSessionServer)()),
        stop(() => (0, shutdown_state_1.withShutdownCleanup)(() => seed_validator_1.default.close())),
    ]);
}
fastify.addHook("onClose", () => __awaiter(void 0, void 0, void 0, function* () {
    quiesceServer();
    const stops = yield producerStops;
    const failedStop = stops.find(result => result.status === "rejected");
    // Accepted work may enqueue children after awaits. Drain their complete
    // lifetimes before retiring the owner or taking persistence snapshots.
    yield (0, shutdown_state_1.drainServerWork)();
    yield (0, durable_owner_event_1.drainDurableOwnerEvents)();
    yield (0, default_runtime_1.drainRealtimeWork)();
    yield (0, shutdown_state_1.drainServerWork)();
    yield (0, player_save_export_1.drainPlayerSaveExports)();
    yield (0, multi_1.stopSessionServer)();
    yield (0, player_party_pool_1.stopQuestNpcPartyPoolWorker)();
    yield (0, persistence_coordinator_1.drainPersistence)();
    // Drain the writer thread before its connections and the checkpoint owner
    // are stopped, so no accepted command is lost at shutdown.
    yield (0, writer_client_1.drainSqliteWriter)();
    yield (0, sqlite_persistence_worker_1.stopSqlitePersistenceWorker)();
    (0, persistence_coordinator_1.configurePersistenceSqlExecutor)(null);
    yield (0, writer_client_1.stopSqliteWriter)();
    yield (0, sqlite_checkpoint_worker_1.stopSqliteCheckpointWorker)();
    if ((failedStop === null || failedStop === void 0 ? void 0 : failedStop.status) === "rejected")
        throw failedStop.reason;
}));
const shutdownTimeoutMs = Math.max(5000, Number.parseInt((_d = process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS) !== null && _d !== void 0 ? _d : "180000", 10) || 180000);
const closeGracefully = (0, graceful_shutdown_1.createGracefulShutdown)({
    timeoutMs: shutdownTimeoutMs,
    quiesce: quiesceServer,
    close: () => fastify.close(),
    cancel: () => {
        (0, background_worker_1.cancelActiveLeaderboardSettlements)("server shutdown drain deadline");
        void (0, player_save_export_1.stopPlayerSaveExports)().catch(error => console.error("[SHUTDOWN] export cancellation failed", error));
    },
    terminate: () => __awaiter(void 0, void 0, void 0, function* () {
        yield Promise.all([(0, background_worker_1.terminateActiveLeaderboardSettlements)(), (0, player_save_export_1.stopPlayerSaveExports)()]);
    }),
    failed: () => { process.exitCode = 1; process.exit(1); },
});
function requestGracefulShutdown(source, forceExit = false) {
    void closeGracefully(source).then(() => {
        var _a;
        // After a fatal error, do not wait for leftover handles to let the
        // event loop drain on its own.
        if (forceExit)
            process.exit((_a = process.exitCode) !== null && _a !== void 0 ? _a : 1);
        if (process.connected)
            process.disconnect();
    });
}
process.once("SIGINT", () => requestGracefulShutdown("SIGINT"));
process.once("SIGTERM", () => requestGracefulShutdown("SIGTERM"));
process.once("SIGBREAK", () => requestGracefulShutdown("SIGBREAK"));
// Use only the trusted parent-child IPC pipe for supervised Windows shutdown.
if (process.connected)
    process.on("message", message => {
        if (message && typeof message === "object" && "type" in message
            && message.type === "starpoint:shutdown")
            requestGracefulShutdown("parent IPC");
    });
// A stray rejected promise is logged and the server keeps serving players;
// an uncaught synchronous exception is logged and then drains like a stop
// signal, because state touched by the throwing code may be inconsistent.
(0, process_guards_1.installProcessGuards)({
    onFatal: () => {
        process.exitCode = 1;
        requestGracefulShutdown("uncaughtException", true);
    },
});
(0, player_party_pool_1.startQuestNpcPartyPoolWorker)();
const persistenceWorkerStarted = (0, sqlite_persistence_worker_1.startSqlitePersistenceWorker)((0, db_1.getDb)().name);
if (persistenceWorkerStarted && (0, sqlite_persistence_worker_1.isSqlitePersistenceWorkerStarted)()) {
    (0, persistence_coordinator_1.configurePersistenceSqlExecutor)((_context, statements) => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, sqlite_persistence_worker_1.executeSqlitePersistenceCommand)({
            operation: _context.operation,
            statements,
        });
    }));
}
// Optional single-writer thread. When enabled, registered business commands run
// on their own thread instead of blocking HTTP and realtime callbacks here.
if ((0, writer_client_1.startSqliteWriter)((0, db_1.getDb)().name)) {
    console.log("[DB] CN_WRITER_THREAD=1: registered business writes route through the SQLite writer thread");
}
fastify.listen({ port, host }, (err, address) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    if ((0, shutdown_state_1.isServerShuttingDown)()) {
        void fastify.close().catch(error => {
            process.exitCode = 1;
            console.error("[SHUTDOWN] late HTTP startup close failed", error);
        });
        return;
    }
    console.log(`CN StarPoint listening on http://${host}:${port}`);
    receiveHistoryRetention.start();
    battleReceiptRetention.start();
    leaderboardSettlementScheduler.start();
    dailyVmoneyMailScheduler.start();
    void (() => __awaiter(void 0, void 0, void 0, function* () {
        try {
            // Do not publish readiness until both public listeners are bound.
            yield (0, multi_1.startSessionServer)();
            if ((0, shutdown_state_1.isServerShuttingDown)())
                return;
            console.log(`[MULTI-REALTIME] startup ownership=${JSON.stringify((0, default_runtime_1.realtimeOwnerStatus)())}`);
            (0, sqlite_checkpoint_worker_1.startSqliteCheckpointWorker)((0, db_1.getDb)().name, process.env, {
                onReady: () => {
                    (0, db_1.getDb)().pragma("wal_autocheckpoint = 0");
                    (0, sqlite_persistence_worker_1.setSqlitePersistenceCheckpointOwner)(true);
                    (0, writer_client_1.setSqliteWriterCheckpointOwner)(true);
                },
                onStopped: () => {
                    if ((0, db_1.getDb)().open)
                        (0, db_1.getDb)().pragma("wal_autocheckpoint = 1000");
                    (0, sqlite_persistence_worker_1.setSqlitePersistenceCheckpointOwner)(false);
                    (0, writer_client_1.setSqliteWriterCheckpointOwner)(false);
                },
            });
            (0, atomic_json_file_1.writeJsonAtomicSync)(readyFilePath, {
                pid: process.pid, readyAt: new Date().toISOString(), port,
                database: path_1.default.resolve((0, db_1.getDb)().name), storageLayoutVersion: (0, storage_layout_1.getStorageLayoutVersion)((0, db_1.getDb)()),
            });
        }
        catch (startupError) {
            if ((0, shutdown_state_1.isServerShuttingDown)() && (startupError === null || startupError === void 0 ? void 0 : startupError.code) === "SERVER_CLOSING") {
                yield fastify.close();
                return;
            }
            console.error(`[STARTUP] realtime listener failed: ${startupError.message}`);
            process.exitCode = 1;
            yield fastify.close();
        }
    }))();
});
