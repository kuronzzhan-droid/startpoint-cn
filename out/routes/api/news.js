"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const news_1 = require("../../data/domains/news");
const session_1 = require("../../data/domains/session");
const news_config_1 = require("../../lib/news-config");
const utils_1 = require("../../utils");
const NEWS_PER_PAGE = 20;
// A stale client-side force flag can cause one more latest_forced request after
// the popup was already acknowledged (or disabled in the admin panel). The
// legacy client has no "no item" response shape, so use a schema-valid,
// visually empty detail that lets it clear that stale flag instead of failing
// during strict response parsing. It is never persisted as an announcement.
const EMPTY_FORCED_NEWS = {
    id: 0,
    title: "",
    date: "1970-01-01 00:00:00",
    html: "<p></p>",
    label: 0,
    thumbnail: 0,
    thumbnail_path: null,
    added_time: null,
};
function toClientNews(item) {
    return {
        id: item.id,
        title: item.title,
        date: item.date,
        html: item.html,
        label: item.label,
        thumbnail: item.thumbnail,
        thumbnail_path: item.thumbnail_path,
        added_time: item.added_time,
    };
}
function parsePage(value) {
    const parsed = Number(value !== null && value !== void 0 ? value : 1);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}
function parseCategory(value, fallback) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 4
        ? parsed
        : fallback;
}
function requireViewer(request, reply) {
    return __awaiter(this, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = Number(body === null || body === void 0 ? void 0 : body.viewer_id);
        if (!Number.isSafeInteger(viewerId) || viewerId <= 0) {
            reply.status(400).send({ error: "Bad Request", message: "Invalid request body." });
            return null;
        }
        const session = yield (0, session_1.getSession)(String(viewerId));
        if (!session) {
            reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
            return null;
        }
        return { viewerId, accountId: session.accountId };
    });
}
function sendMsgpack(reply, viewerId, data) {
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({
        // Opening or browsing the panel must not schedule another startup
        // interruption. A null force_news is decoded by the client as
        // Option.None; 0 would be decoded as Some(0) and can leave stale
        // announcement state behind.
        data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, force_news: null }),
        data,
    });
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    const sendIndex = (request, reply, fallbackCategory) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const viewer = yield requireViewer(request, reply);
        if (!viewer)
            return reply;
        const body = request.body;
        const publishedNews = (0, news_config_1.getPublishedNews)((0, news_config_1.loadNewsConfig)());
        const category = parseCategory(body.category, fallbackCategory);
        const allNews = publishedNews.filter(item => item.category === category);
        const page = parsePage((_a = body.page_index) !== null && _a !== void 0 ? _a : body.current_page);
        const start = (page - 1) * NEWS_PER_PAGE;
        const pageItems = allNews.slice(start, start + NEWS_PER_PAGE);
        // Opening the announcement panel is the client's acknowledgement
        // point.  It initially requests only one tab, but the panel has one
        // unread badge for the whole announcement feed.  Mark every published
        // item here so returning to the main city does not reopen the panel
        // merely because another category was not selected yet.
        yield (0, news_1.markAccountNewsReceipts)(viewer.accountId, publishedNews.map(item => item.id), "list");
        return sendMsgpack(reply, viewer.viewerId, {
            current_page: page,
            news: pageItems.map(toClientNews),
            news_count: allNews.length,
        });
    });
    const sendInfo = (request, reply, systemOnly) => __awaiter(void 0, void 0, void 0, function* () {
        const viewer = yield requireViewer(request, reply);
        if (!viewer)
            return reply;
        const body = request.body;
        const newsId = Number(body.news_id);
        const item = (0, news_config_1.getPublishedNews)((0, news_config_1.loadNewsConfig)()).find(candidate => (candidate.id === newsId && (systemOnly ? candidate.category === 4 : candidate.category !== 4)));
        if (!item) {
            return reply.status(400).send({
                error: "Bad Request",
                message: `News with id '${body.news_id}' not found.`,
            });
        }
        yield (0, news_1.markAccountNewsReceipt)(viewer.accountId, item.id, "list");
        return sendMsgpack(reply, viewer.viewerId, toClientNews(item));
    });
    const sendForced = (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const viewer = yield requireViewer(request, reply);
        if (!viewer)
            return reply;
        const config = (0, news_config_1.loadNewsConfig)();
        const item = (0, news_config_1.getActivePopupNews)(config, (0, utils_1.getServerDate)());
        // The client may ask for the forced announcement again when returning
        // from another screen.  For the once-per-news policy, an already
        // acknowledged item must not be sent again; otherwise the client will
        // display the same popup on every navigation even though /load has
        // already delivered it once.
        if (item === null
            || (config.popup.mode === "once_per_news"
                && (0, news_1.hasAccountNewsReceiptSync)(viewer.accountId, item.id, "popup"))) {
            console.warn(`[NEWS] latest_forced fallback: viewer=${viewer.viewerId} `
                + `reason=${item === null ? "no-active-popup" : "popup-already-read"}`);
            return sendMsgpack(reply, viewer.viewerId, EMPTY_FORCED_NEWS);
        }
        yield (0, news_1.markAccountNewsReceipt)(viewer.accountId, item.id, "popup");
        return sendMsgpack(reply, viewer.viewerId, toClientNews(item));
    });
    fastify.post("/index", (request, reply) => sendIndex(request, reply, 1));
    fastify.post("/get_info", (request, reply) => sendInfo(request, reply, false));
    fastify.post("/system_index", (request, reply) => sendIndex(request, reply, 4));
    fastify.post("/get_system_info", (request, reply) => sendInfo(request, reply, true));
    fastify.post("/latest_forced", sendForced);
    // Kept for compatibility with deployments that call the system variant.
    fastify.post("/latest_forced_system", sendForced);
});
exports.default = routes;
