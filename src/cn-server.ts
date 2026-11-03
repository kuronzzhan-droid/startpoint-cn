import { existsSync } from "./lib/file-exists";
import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import { ContentTypeParserDoneFunction } from "fastify/types/content-type-parser";
import { unpack } from "msgpackr";
import { installCnResponseEncoding } from "./lib/cn-response-hook";
import fastifyStatic from "@fastify/static";
import path from "path";
import { mkdirSync, readFileSync, rmSync } from "fs";
import { writeJsonAtomicSync } from "./lib/atomic-json-file";
import { getStorageLayoutVersion } from "./lib/storage-layout";
import { getServerTime, getServerTimeForPlayer } from "./utils";
import { restoreTimeOffset } from "./data/activeAccount";
import { migrateUnsafeViewerIdsSync } from "./data/domains/session";
import { installManagementAuth } from "./lib/management-auth";
import { installRoutePerformanceMonitor } from "./lib/route-performance";
import { markPlayerOnline } from "./lib/online-presence";
import { installTakeoverUdidGuard } from "./lib/takeover-access";
import { initializePlayerLogin } from "./lib/player-login";
import playerLoginRoutes, { installPlayerLoginGuard } from "./routes/cn/playerLogin";
import { installClientAdmission } from "./lib/client-admission";
import {
    getRoomCommandGateway,
    realtimeOwnerStatus,
    quiesceRealtimeSessionServer,
    drainRealtimeWork,
} from "./multi/coordinator/default-runtime";
import { quiesceDurableOwnerEvents, drainDurableOwnerEvents } from "./multi/coordinator/durable-owner-event";
import { installLocalClientCompat } from "./lib/local-client-compat";
import { getPatchManifest } from "./lib/version";
import { installCustomCdnResourceRoutes } from "./lib/custom-cdn-resource-routes";
import { resolvePlainFileInside, sendFileStream } from "./lib/file-download";
import { trustProxySetting } from "./lib/client-address";
import { parseCrashReportBody, crashReportText, createCrashLogRecord } from "./lib/crash-report";
import { installProcessGuards } from "./lib/process-guards";

import versionCheckPlugin from "./routes/cn/versionCheck";
import iosLeitingPlugin from "./routes/cn/ios-leiting";
import leitingAuthPlugin from "./routes/cn/leitingAuth";
import cnToolPlugin from "./routes/cn/tool";
import cnLoadPlugin from "./routes/cn/load";
import cnAssetPlugin from "./routes/cn/asset";
import cnTakeOverPlugin from "./routes/cn/takeOver";
import indexWebPlugin from "./routes/web";
import indexWebApiPlugin from "./routes/web_api";
import seedsWebApiPlugin from "./routes/web_api/seeds";
import modAdminApiPlugin from "./routes/api/modAdmin";
import seedValidator from "./lib/seed-validator";
import reproduceApiPlugin from "./routes/api/reproduce";
import tutorialApiPlugin from "./routes/api/tutorial";
import gachaApiPlugin from "./routes/api/gacha";
import partyApiPlugin from "./routes/api/party";
import expodApiPlugin from "./routes/api/expod";
import storyQuestApiPlugin from "./routes/api/storyQuest";
import optionApiPlugin from "./routes/api/option";
import singleBattleQuestApiPlugin from "./routes/api/singleBattleQuest";
import questApiPlugin from "./routes/api/quest";
import { multiBattleRoutes, startSessionServer, stopSessionServer } from "./multi";
import attentionApiPlugin from "./routes/api/attention";
import characterApiPlugin from "./routes/api/character";
import characterManaPlugin from "./routes/api/character/mana";
import characterBondPlugin from "./routes/api/character/bond";
import partyGroupApiPlugin from "./routes/api/partyGroup";
import equipmentApiPlugin from "./routes/api/equipment";
import sellApiPlugin from "./routes/api/sell";
import exBoostApiPlugin from "./routes/api/exBoost";
import boxGachaApiPlugin from "./routes/api/boxGacha";
import shopApiPlugin from "./routes/api/shop";
import exchangeApiPlugin from "./routes/api/exchange";
import encyclopediaApiPlugin from "./routes/api/encyclopedia";
import mailApiPlugin from "./routes/api/mail";
import rankingEventApiPlugin from "./routes/api/rankingEvent";
import missionApiPlugin from "./routes/api/mission";
import activeMissionApiPlugin from "./routes/api/activeMission";
import passCardApiPlugin from "./routes/api/passCard";
import paymentApiPlugin from "./routes/api/payment";
import newsApiPlugin from "./routes/api/news";
import raidEventApiPlugin from "./routes/api/raidEvent";
import rushEventApiPlugin from "./routes/api/rushEvent";
import abyssRecordsRoutes from "./routes/cn/abyssRecords";
import carnivalEventApiPlugin from "./routes/api/carnivalEvent";
import howToGetApiPlugin from "./routes/api/howToGet";
import contentsGuideApiPlugin from "./routes/api/contentsGuide";
import profileApiPlugin from "./routes/api/profile";
import followApiPlugin from "./routes/api/follow";
import snsApiPlugin from "./routes/api/sns";
import historyApiPlugin from "./routes/api/history";
import playerHistoryApiPlugin from "./routes/api/playerHistory";
import comicApiPlugin from "./routes/api/comic";
import questUnlockApiPlugin from "./routes/api/questUnlock";
import itemApiPlugin from "./routes/api/item";
import loungeApiPlugin from "./routes/api/lounge";
import multiSpecialExchangeApiPlugin from "./routes/api/multiSpecialExchange";
import {
    startQuestNpcPartyPoolWorker,
    stopQuestNpcPartyPoolWorker,
} from "./multi/npc/player-party-pool";
import { parseIosCompatConfig } from "./lib/ios-compat";
import { getDb } from "./data/db";
import { createReceiveHistoryRetentionService } from "./lib/receive-history-retention";
import { createBattleReceiptRetentionService } from "./lib/battle-receipt-retention";
import { createLeaderboardSettlementScheduler } from "./lib/leaderboard/settlement";
import { createDailyVmoneyMailScheduler } from "./lib/daily-vmoney-mail";
import { startSqliteCheckpointWorker, stopSqliteCheckpointWorker } from "./lib/sqlite-checkpoint-worker";
import {
    configurePersistenceSqlExecutor,
    drainPersistence,
    runPersistenceTransaction,
} from "./lib/persistence-coordinator";
import {
    executeSqlitePersistenceCommand,
    isSqlitePersistenceWorkerStarted,
    setSqlitePersistenceCheckpointOwner,
    startSqlitePersistenceWorker,
    stopSqlitePersistenceWorker,
} from "./lib/sqlite-persistence-worker";
// Side-effect import: binds command names to domain code for the in-process
// fallback path. The writer worker loads the same module on its own thread.
import "./lib/persistence/commands";
import {
    drainSqliteWriter,
    setSqliteWriterCheckpointOwner,
    startSqliteWriter,
    stopSqliteWriter,
} from "./lib/persistence/writer-client";
import { gameVerboseLog } from "./lib/game-logging";
import { installPersistenceHttpErrors } from "./lib/persistence-http-errors";
import { assertServerAcceptingWork, beginServerShutdown, drainServerWork, isServerShuttingDown, withShutdownCleanup } from "./lib/shutdown-state";
import { createGracefulShutdown } from "./lib/graceful-shutdown";
import { cancelActiveLeaderboardSettlements, terminateActiveLeaderboardSettlements } from "./lib/leaderboard/background-worker";
import { drainPlayerSaveExports, stopPlayerSaveExports } from "./lib/player-save-export";

process.env.MULTI_REALTIME_PROCESS ??= "1";
const fastify = Fastify({
    logger: {
        // Production-safe default avoids per-request access-log formatting.
        // Debug launchers explicitly opt back into info.
        level: process.env.LOG_LEVEL || "warn"
    },
    // request.ip honours X-Forwarded-For only from trusted proxy hops.
    trustProxy: trustProxySetting(),
    bodyLimit: 262144  // 256KB — covers /single_battle_quest/finish large battle stats
});

fastify.addHook("onRequest", async () => { assertServerAcceptingWork(); });

installLocalClientCompat(fastify, process.env.CN_LOCAL_CLIENT_PLATFORM || (
    getPatchManifest().patches.some(p => p.enabled && p.local_test_only
        && p.required_local_platform === "android") ? "android" : undefined
));

installRoutePerformanceMonitor(fastify);

// Viewer IDs >= 900,000,000 are interpreted as COM/AI members by the
// multiplayer protocol. Repair legacy human sessions before rooms can open.
const migratedUnsafeViewerIds = migrateUnsafeViewerIdsSync();
if (migratedUnsafeViewerIds > 0) {
    console.log(`[MULTI] migrated ${migratedUnsafeViewerIds} legacy viewer ID(s) out of the COM range`);
}

// Restore saved time offset from active player on startup
restoreTimeOffset();

// Game endpoints remain public; only the legacy management pages and their
// management APIs are protected by the password session below.
installManagementAuth(fastify);

// Simple in-memory rate limiter for /crash endpoint only.
// /debug is excluded — game client sends heavy beacon traffic during normal startup.
const rateLimitMap = new Map<string, { count: number; reset: number }>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW = 60000;
// A hostile client can rotate source IPs; expiry alone must not make this map
// grow for the lifetime of the process.
const RATE_LIMIT_MAP_MAX = 4096;
let nextRateLimitSweep = 0;
fastify.addHook("onRequest", async (request, reply) => {
    if (request.routeOptions.url === "/crash") {
        const ip = request.ip;
        const now = Date.now();
        if (now >= nextRateLimitSweep) {
            for (const [key, value] of rateLimitMap) {
                if (value.reset <= now) rateLimitMap.delete(key);
            }
            nextRateLimitSweep = now + RATE_LIMIT_WINDOW;
        }
        const existing = rateLimitMap.get(ip);
        if (!existing && rateLimitMap.size >= RATE_LIMIT_MAP_MAX) {
            return reply.status(429).send("Too Many Requests");
        }
        const entry = existing || { count: 0, reset: now + RATE_LIMIT_WINDOW };
        if (now > entry.reset) { entry.count = 0; entry.reset = now + RATE_LIMIT_WINDOW; }
        if (++entry.count > RATE_LIMIT_MAX) {
            return reply.status(429).send("Too Many Requests");
        }
        rateLimitMap.set(ip, entry);
    }
});

// Lightweight online counter: reuse normal game traffic and keep only a
// viewerId -> lastSeen timestamp in memory. No database writes or extra client
// requests are introduced. The management page treats five-minute activity as
// online presence.
fastify.addHook("onResponse", async request => {
    if (!request.url.startsWith("/api/index.php/")) return
    const body = request.body
    if (!body || typeof body !== "object" || Array.isArray(body)) return
    markPlayerOnline((body as Record<string, unknown>).viewer_id)
});

installCnResponseEncoding(fastify);
installPersistenceHttpErrors(fastify);

function jsonParser(request: FastifyRequest, body: string, done: ContentTypeParserDoneFunction) {
    if (request.routeOptions.url === "/crash") return done(null, parseCrashReportBody(body));
    try {
        done(null, JSON.parse(body));
    } catch {
        done(null, undefined);
    }
}

fastify.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" },
    (_request: FastifyRequest, body: string, done) => {
        if (_request.routeOptions.url === "/crash") return done(null, parseCrashReportBody(body));
        try {
            done(null, unpack(Buffer.from(body, "base64")));
        } catch {
            try {
                done(null, Object.fromEntries(new URLSearchParams(body)));
            } catch {
                jsonParser(_request, body, done);
            }
        }
    }
);
fastify.addContentTypeParser("application/json", { parseAs: "string" }, jsonParser);

initializePlayerLogin(viewerId => {
    void (async () => await getRoomCommandGateway().execute("runtime.disconnect", { viewerId }))().catch(async error => {
        if (isServerShuttingDown() && error?.code === "SERVER_CLOSING") return;
        console.error("[MULTI-REALTIME] login revocation could not reach owner", error);
        await import("./multi/coordinator/default-runtime").then(runtime => runtime.failRealtimeOwner());
    });
});
installClientAdmission(fastify);
installPlayerLoginGuard(fastify);
installTakeoverUdidGuard(fastify);
fastify.register(playerLoginRoutes);
fastify.register(abyssRecordsRoutes);

const iosCompat = parseIosCompatConfig();
fastify.register(versionCheckPlugin, { ios: iosCompat });
if (iosCompat.enabled) {
    // Native Leiting SDK requests use bare paths rather than /api/index.php.
    fastify.register(iosLeitingPlugin, { ios: iosCompat });
    console.log(`[iOS] compatibility enabled: ${iosCompat.apiScheme}://${iosCompat.apiHost}`);
}
fastify.register(leitingAuthPlugin, { prefix: "/api/index.php" });

const apiPrefix = "/api/index.php";
fastify.register(cnLoadPlugin, { prefix: apiPrefix });
fastify.register(cnAssetPlugin, { prefix: `${apiPrefix}/asset` });
fastify.register(cnTakeOverPlugin, { prefix: apiPrefix });

function stubMsgpackReply(reply: FastifyReply, data: any, playerId?: number): FastifyReply {
    const servertime = playerId ? getServerTimeForPlayer(playerId) : getServerTime()
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({
        data_headers: { force_update: false, asset_update: false, short_udid: 0, viewer_id: 0, servertime, result_code: 1 },
        data
    });
}

fastify.post(`${apiPrefix}/assetintitle/version_info_in_title`, async (request, reply) => {
    const { getAssetDownloadSize, getVersionInfo } = require("./routes/cn/asset");
    const resVer = request.headers['res_ver'] as string | undefined;
    const device = request.headers.device as string | undefined;
    return stubMsgpackReply(reply, getVersionInfo(
        CDN_BASE_URL,
        getAssetDownloadSize(resVer, device),
        device,
    ));
});

fastify.post(`${apiPrefix}/tool/check_social_link_enable`, async (_request, reply) => {
    return stubMsgpackReply(reply, { enable: false });
});

// Gift code exchange (礼包码兑换): enable button in menu, exchange not implemented
fastify.post(`${apiPrefix}/tool/check_enable_gift`, async (_request, reply) => {
    return stubMsgpackReply(reply, { enable_gift: true });
});

fastify.post(`${apiPrefix}/tool/contact_active`, async (_request, reply) => {
    return stubMsgpackReply(reply, { enable_customer_service: false });
});

fastify.post(`${apiPrefix}/tool/custom_notify`, async (_request, reply) => {
    return stubMsgpackReply(reply, {});
});

fastify.post(`${apiPrefix}/channels/channel_leiting_pay/query_unfinish_order`, async (_request, reply) => {
    return stubMsgpackReply(reply, { order_id: "" });
});

fastify.post(`${apiPrefix}/channels/channel_leiting_pay/query_purcharge`, async (_request, reply) => {
    return stubMsgpackReply(reply, { status: 3 });  // 3 = purchase success
});

fastify.post(`${apiPrefix}/channels/channel_leiting_pay/set_unfinish_order_status`, async (_request, reply) => {
    return stubMsgpackReply(reply, {});
});

// Episode trial reading: finish stub (character story trial)
fastify.post(`${apiPrefix}/episode_trial_reading/finish`, async (_request, reply) => {
    return stubMsgpackReply(reply, {});
});

// Public diagnostic feedback keeps the legacy OK response, but cannot create
// arbitrary pools or force one disk-flush waiter for every public request.
fastify.addHook("onRequest", async (request, reply) => {
    const route = request.routeOptions.url;
    if (route !== "/debug" && route !== "/crash") return;
    if (!seedValidator.allowPublicFeedbackRequest(request.ip)) return reply.status(200).send("OK");
});

function parseSeedFeedbackFields(text: string, allowStarFallback = false) {
    // Read whole tokens: "fes-other", "5.1" and "10" must never become
    // known movie "fes", rarity 5 or play=1. Conflicting fields are ambiguous.
    const fields = new Map<string, string>();
    const pattern = /(?:^|[\s,|;:"'\\{(\[])(seed|movie_id|play|結果レア度)=([^\s,|;"'\\})\]]*)/g;
    for (const match of text.matchAll(pattern)) {
        if (fields.has(match[1]) && fields.get(match[1]) !== match[2]) return;
        fields.set(match[1], match[2]);
    }
    const seedText = fields.get("seed");
    const movieId = fields.get("movie_id") ?? "normal";
    const playText = fields.get("play");
    if (!seedText || !/^\d+$/.test(seedText) || !movieId
        || (playText !== undefined && !/^[01]$/.test(playText))) return;
    const seed = Number(seedText);
    if (!Number.isSafeInteger(seed) || seed < 0) return;
    let rarityText = fields.get("結果レア度");
    if (rarityText === undefined && allowStarFallback) {
        rarityText = text.match(/(?:★|â)[^\s,|;"'\\})\]]*/)?.[0];
    }
    const rarity = rarityText?.match(/^(?:★|â)([3-5])$/);
    if (rarityText !== undefined && !rarity) return;
    return { movieId, seed, rarity: rarity ? Number(rarity[1]) : undefined,
        didPlay: playText === undefined ? null : playText === "1" };
}

function parseC3032Beacon(loc: unknown, source: string): void {
    if (typeof loc !== "string" || loc.length > 8192 || !loc.includes("C3032")) return;
    const fields = parseSeedFeedbackFields(loc, true);
    if (!fields || fields.rarity === undefined) return;
    seedValidator.applyPublicFeedback(source, {
        kind: "c3032", ...fields,
    }, true);
}

function parsePlayBeacon(loc: unknown, source: string): void {
    if (typeof loc !== "string" || loc.length > 8192 || !loc.startsWith("PLAY|")) return;
    const fields = parseSeedFeedbackFields(loc);
    if (!fields || fields.didPlay === null) return;
    seedValidator.applyPublicFeedback(source, {
        kind: "play", ...fields,
    }, true);
}

fastify.get("/debug", async (request, reply) => {
    const loc = (request.query as { loc?: unknown })?.loc;
    try { parseC3032Beacon(loc, request.ip); parsePlayBeacon(loc, request.ip); } catch (_) {}
    return reply.status(200).send("OK");
});

fastify.post("/debug", async (request, reply) => {
    const loc = (request.body as { loc?: unknown })?.loc;
    if (typeof loc === "string") gameVerboseLog(() => `[BEACON ${new Date().toISOString()}] ${loc.slice(0, 8192)}`);
    try { parseC3032Beacon(loc, request.ip); parsePlayBeacon(loc, request.ip); } catch (_) {}
    return reply.status(200).send("OK");
});

fastify.post("/crash", async (request, reply) => {
    const bodyStr = crashReportText(request.body);
    // Logging remains structured and bounded. Seed evidence uses the full report.
    console.log(`[CRASH] ${JSON.stringify(createCrashLogRecord(request.body, request.id))}`);
    try {
        const fields = parseSeedFeedbackFields(bodyStr);
        if (fields && fields.rarity !== undefined && bodyStr.includes("C3032")) {
            // Legacy crash reports do not imply successful animation playback.
            seedValidator.applyPublicFeedback(request.ip, {
                kind: "crash", movieId: fields.movieId,
                seed: fields.seed, rarity: fields.rarity,
            }, true);
        }
    } catch (_) {}
    // The existing bounded feedback state feeds the normal batched writer.
    // Public requests never enqueue a persistence barrier; close still drains it.
    return reply.status(200).send("OK");
});

fastify.register(cnToolPlugin, { prefix: `${apiPrefix}/tool` });
fastify.register(reproduceApiPlugin, { prefix: `${apiPrefix}/reproduce` });
fastify.register(tutorialApiPlugin, { prefix: `${apiPrefix}/tutorial` });
fastify.register(gachaApiPlugin, { prefix: `${apiPrefix}/gacha` });
fastify.register(partyApiPlugin, { prefix: `${apiPrefix}/party` });
fastify.register(expodApiPlugin, { prefix: `${apiPrefix}/expod` });
fastify.register(storyQuestApiPlugin, { prefix: `${apiPrefix}/story_quest` });
fastify.register(optionApiPlugin, { prefix: `${apiPrefix}/option` });
fastify.register(singleBattleQuestApiPlugin, { prefix: `${apiPrefix}/single_battle_quest` });
fastify.register(questApiPlugin, { prefix: `${apiPrefix}/quest` });
fastify.register(multiBattleRoutes, { prefix: `${apiPrefix}/multi_battle_quest` });
fastify.register(attentionApiPlugin, { prefix: `${apiPrefix}/attention` });
fastify.register(characterApiPlugin, { prefix: `${apiPrefix}/character` });
fastify.register(characterManaPlugin, { prefix: `${apiPrefix}/character` });
fastify.register(characterBondPlugin, { prefix: `${apiPrefix}/character` });
fastify.register(partyGroupApiPlugin, { prefix: `${apiPrefix}/party_group` });
fastify.register(equipmentApiPlugin, { prefix: `${apiPrefix}/equipment` });
fastify.register(sellApiPlugin, { prefix: `${apiPrefix}/equipment` });
fastify.register(exBoostApiPlugin, { prefix: `${apiPrefix}/ex_boost` });
fastify.register(boxGachaApiPlugin, { prefix: `${apiPrefix}/box_gacha` });
fastify.register(shopApiPlugin, { prefix: `${apiPrefix}/shop` });
fastify.register(exchangeApiPlugin, { prefix: `${apiPrefix}/exchange` });
fastify.register(encyclopediaApiPlugin, { prefix: `${apiPrefix}/encyclopedia` });
fastify.register(mailApiPlugin, { prefix: `${apiPrefix}/mail` });
fastify.register(rankingEventApiPlugin, { prefix: `${apiPrefix}/ranking_event` });
fastify.register(missionApiPlugin, { prefix: `${apiPrefix}/mission` });
fastify.register(activeMissionApiPlugin, { prefix: `${apiPrefix}/active_mission` });
fastify.register(passCardApiPlugin, { prefix: `${apiPrefix}/Pass_card` });
fastify.register(paymentApiPlugin, { prefix: `${apiPrefix}/payment` });
fastify.register(newsApiPlugin, { prefix: `${apiPrefix}/news` });
fastify.register(raidEventApiPlugin, { prefix: `${apiPrefix}/event/raid` });
fastify.register(rushEventApiPlugin, { prefix: `${apiPrefix}/event/rush` });
fastify.register(carnivalEventApiPlugin, { prefix: `${apiPrefix}/carnival_event` });
fastify.register(contentsGuideApiPlugin, { prefix: `${apiPrefix}/contents_guide` });
fastify.register(profileApiPlugin, { prefix: `${apiPrefix}/profile` });
fastify.register(followApiPlugin, { prefix: `${apiPrefix}/follow` });
fastify.register(snsApiPlugin, { prefix: `${apiPrefix}/sns` });
fastify.register(historyApiPlugin, { prefix: `${apiPrefix}/history` });
fastify.register(playerHistoryApiPlugin, { prefix: `${apiPrefix}/player_history` });
fastify.register(comicApiPlugin, { prefix: `${apiPrefix}/comic` });
fastify.register(questUnlockApiPlugin, { prefix: `${apiPrefix}/quest` });
fastify.register(itemApiPlugin, { prefix: `${apiPrefix}/item` });
fastify.register(loungeApiPlugin, { prefix: `${apiPrefix}/lounge` });
fastify.register(multiSpecialExchangeApiPlugin, { prefix: `${apiPrefix}/multi_special_exchange` });
fastify.register(howToGetApiPlugin, { prefix: `${apiPrefix}/how_to_get` });

// Web management panel
fastify.register(indexWebPlugin);
fastify.register(indexWebApiPlugin, { prefix: "/api" });
fastify.register(seedsWebApiPlugin, { prefix: "/api/seeds" });
fastify.register(modAdminApiPlugin, { prefix: "/api/mod-admin" });

const cdnHost = process.env.CN_LISTEN_HOST || "localhost";
const cdnPort = process.env.CN_LISTEN_PORT || "8001";
const cdnDisplayHost = cdnHost === "0.0.0.0" ? "localhost" : cdnHost;
const CDN_BASE_URL = process.env.CDN_BASE_URL || `http://${cdnDisplayHost}:${cdnPort}/patch/cn`;
const cdnDir = process.env.CDN_DIR || ".cdn";

// Native readers can request common, medium, Android or iOS files directly.
installCustomCdnResourceRoutes(fastify, {
    patchRoot: path.join(__dirname, "..", "assets", "asset-patch"),
    cdnRoot: path.isAbsolute(cdnDir) ? cdnDir : path.join(__dirname, "..", cdnDir),
});

// Serve patch archive files for asset update
fastify.get("/patch/cn/asset-patch/active/:file", async (request, reply) => {
    const { file } = request.params as { file: string };
    const patchFile = resolvePlainFileInside(path.join(__dirname, "..", "assets", "asset-patch", "active"), file);
    if (patchFile && sendFileStream(reply, patchFile, "application/zip")) {
        return reply;
    }
    return reply.status(404).send("Not Found");
});

fastify.register(fastifyStatic, {
    root: path.isAbsolute(cdnDir) ? cdnDir : path.join(__dirname, "..", cdnDir),
    prefix: "/patch",
    decorateReply: false
});

// Web static assets
fastify.register(fastifyStatic, {
    root: path.join(__dirname, "..", "web", "public"),
    prefix: "/public",
    decorateReply: false
});

// New admin SPA (React, built from admin/ into web/dist) — served at /admin.
// Old pages at / stay untouched until the SPA fully replaces them (see docs/admin-refactor-plan.md).
const adminDistDir = path.join(__dirname, "..", "web", "dist");
const adminSpaAvailable = existsSync(path.join(adminDistDir, "index.html"));
if (adminSpaAvailable) {
    fastify.register(fastifyStatic, {
        root: adminDistDir,
        prefix: "/admin/",
        decorateReply: false
    });
    fastify.get("/admin", (_request, reply) => reply.redirect("/admin/"));
} else {
    console.log("[admin] web/dist not found — admin SPA disabled (run: npm run build:admin)");
}

// Catch-all to log unknown endpoints
fastify.setNotFoundHandler((request, reply) => {
    // SPA fallback: client-side routes like /admin/accounts resolve to index.html
    if (adminSpaAvailable && request.method === "GET" && request.url.startsWith("/admin/")) {
        reply.header("content-type", "text/html; charset=utf-8");
        reply.send(readFileSync(path.join(adminDistDir, "index.html")));
        return;
    }
    gameVerboseLog(() => `[UNKNOWN] ${request.method} ${request.url}`);
    reply.status(404).send({ error: "Not Found" });
});

const host = process.env.CN_LISTEN_HOST ?? "127.0.0.1";
const port = parseInt(process.env.CN_LISTEN_PORT ?? "8001");
const logDirectory = path.resolve(__dirname,"../.logs");
const readyFilePath = path.join(logDirectory,"cn-server-ready.json");
mkdirSync(logDirectory,{recursive:true});
rmSync(readyFilePath,{force:true});
const receiveHistoryRetention = createReceiveHistoryRetentionService(getDb(), {
    executeTransaction: runPersistenceTransaction,
});
const battleReceiptRetention = createBattleReceiptRetentionService(getDb(), {
    executeTransaction: runPersistenceTransaction,
});
const leaderboardSettlementScheduler = createLeaderboardSettlementScheduler();
const dailyVmoneyMailScheduler = createDailyVmoneyMailScheduler(getDb());

let producerStops: Promise<PromiseSettledResult<unknown>[]> | null = null;
function quiesceServer(): void {
    if (producerStops) return;
    beginServerShutdown();
    const stop = (operation: () => unknown): Promise<unknown> => {
        try { return Promise.resolve(operation()); }
        catch (error) { return Promise.reject(error); }
    };
    // Stop every source before awaiting long-running accepted work. The owner
    // stays alive for in-flight business and durable same-ID publications.
    producerStops = Promise.allSettled([
        stop(() => rmSync(readyFilePath,{force:true})),
        stop(() => dailyVmoneyMailScheduler.stop()),
        stop(() => leaderboardSettlementScheduler.stop()),
        stop(() => receiveHistoryRetention.stop()),
        stop(() => battleReceiptRetention.stop()),
        stop(() => quiesceDurableOwnerEvents()),
        stop(() => quiesceRealtimeSessionServer()),
        stop(() => withShutdownCleanup(() => seedValidator.close())),
    ]);
}

fastify.addHook("onClose", async () => {
    quiesceServer();
    const stops = await producerStops!;
    const failedStop = stops.find(result => result.status === "rejected");
    // Accepted work may enqueue children after awaits. Drain their complete
    // lifetimes before retiring the owner or taking persistence snapshots.
    await drainServerWork();
    await drainDurableOwnerEvents();
    await drainRealtimeWork();
    await drainServerWork();
    await drainPlayerSaveExports();
    await stopSessionServer();
    await stopQuestNpcPartyPoolWorker();
    await drainPersistence();
    // Drain the writer thread before its connections and the checkpoint owner
    // are stopped, so no accepted command is lost at shutdown.
    await drainSqliteWriter();
    await stopSqlitePersistenceWorker();
    configurePersistenceSqlExecutor(null);
    await stopSqliteWriter();
    await stopSqliteCheckpointWorker();
    if (failedStop?.status === "rejected") throw failedStop.reason;
});

const shutdownTimeoutMs = Math.max(
    5_000,
    Number.parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS ?? "180000", 10) || 180_000,
);
const closeGracefully = createGracefulShutdown({
    timeoutMs: shutdownTimeoutMs,
    quiesce: quiesceServer,
    close: () => fastify.close(),
    cancel: () => {
        cancelActiveLeaderboardSettlements("server shutdown drain deadline");
        void stopPlayerSaveExports().catch(error => console.error("[SHUTDOWN] export cancellation failed", error));
    },
    terminate: async () => {
        await Promise.all([terminateActiveLeaderboardSettlements(), stopPlayerSaveExports()]);
    },
    failed: () => { process.exitCode = 1; process.exit(1); },
});
function requestGracefulShutdown(source: string, forceExit = false): void {
    void closeGracefully(source).then(() => {
        // After a fatal error, do not wait for leftover handles to let the
        // event loop drain on its own.
        if (forceExit) process.exit(process.exitCode ?? 1);
        if (process.connected) process.disconnect();
    });
}
process.once("SIGINT", () => requestGracefulShutdown("SIGINT"));
process.once("SIGTERM", () => requestGracefulShutdown("SIGTERM"));
process.once("SIGBREAK", () => requestGracefulShutdown("SIGBREAK"));
// Use only the trusted parent-child IPC pipe for supervised Windows shutdown.
if (process.connected) process.on("message", message => {
    if (message && typeof message === "object" && "type" in message
        && message.type === "starpoint:shutdown") requestGracefulShutdown("parent IPC");
});
// A stray rejected promise is logged and the server keeps serving players;
// an uncaught synchronous exception is logged and then drains like a stop
// signal, because state touched by the throwing code may be inconsistent.
installProcessGuards({
    onFatal: () => {
        process.exitCode = 1;
        requestGracefulShutdown("uncaughtException", true);
    },
});
startQuestNpcPartyPoolWorker();
const persistenceWorkerStarted = startSqlitePersistenceWorker(getDb().name);
if (persistenceWorkerStarted && isSqlitePersistenceWorkerStarted()) {
    configurePersistenceSqlExecutor(async (_context, statements) => {
        await executeSqlitePersistenceCommand({
            operation: _context.operation,
            statements,
        });
    });
}
// Optional single-writer thread. When enabled, registered business commands run
// on their own thread instead of blocking HTTP and realtime callbacks here.
if (startSqliteWriter(getDb().name)) {
    console.log("[DB] CN_WRITER_THREAD=1: registered business writes route through the SQLite writer thread");
}

fastify.listen({ port, host }, (err, address) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    if (isServerShuttingDown()) {
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

    void (async () => {
        try {
            // Do not publish readiness until both public listeners are bound.
            await startSessionServer();
            if (isServerShuttingDown()) return;
            console.log(`[MULTI-REALTIME] startup ownership=${JSON.stringify(realtimeOwnerStatus())}`);
            startSqliteCheckpointWorker(getDb().name, process.env, {
                onReady: () => {
                    getDb().pragma("wal_autocheckpoint = 0")
                    setSqlitePersistenceCheckpointOwner(true)
                    setSqliteWriterCheckpointOwner(true)
                },
                onStopped: () => {
                    if (getDb().open) getDb().pragma("wal_autocheckpoint = 1000")
                    setSqlitePersistenceCheckpointOwner(false)
                    setSqliteWriterCheckpointOwner(false)
                },
            });
            writeJsonAtomicSync(readyFilePath,{
                pid:process.pid,readyAt:new Date().toISOString(),port,
                database:path.resolve(getDb().name),storageLayoutVersion:getStorageLayoutVersion(getDb()),
            });
        } catch (startupError) {
            if (isServerShuttingDown() && (startupError as { code?: string })?.code === "SERVER_CLOSING") {
                await fastify.close();
                return;
            }
            console.error(`[STARTUP] realtime listener failed: ${(startupError as Error).message}`);
            process.exitCode = 1;
            await fastify.close();
        }
    })();
});
