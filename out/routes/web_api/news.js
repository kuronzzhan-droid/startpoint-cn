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
const news_config_1 = require("../../lib/news-config");
const utils_1 = require("../../utils");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function fail(reply, error, statusCode = 400) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.status(statusCode).send({ error: message });
}
function requireEditableConfig(reply) {
    const state = (0, news_config_1.readNewsConfigState)();
    if (state.error !== null) {
        fail(reply, `公告配置当前无效，请先修复 assets/news.json：${state.error}`, 409);
        return null;
    }
    return state.config;
}
function sendOverview(reply) {
    var _a;
    const state = (0, news_config_1.readNewsConfigState)();
    const activePopup = (0, news_config_1.getActivePopupNews)(state.config, (0, utils_1.getServerDate)());
    return reply.send(Object.assign(Object.assign({}, state.config), { load_error: state.error, source_path: state.path, active_popup_id: (_a = activePopup === null || activePopup === void 0 ? void 0 : activePopup.id) !== null && _a !== void 0 ? _a : null }));
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.get("/", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () { return sendOverview(reply); }));
    fastify.post("/items", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const config = requireEditableConfig(reply);
        if (!config)
            return reply;
        if (!isRecord(request.body))
            return fail(reply, "请求正文必须是公告对象");
        const body = request.body;
        const requestedId = body.id;
        const id = requestedId === undefined || requestedId === null || requestedId === ""
            ? config.news.reduce((maximum, item) => Math.max(maximum, item.id), 0) + 1
            : Number(requestedId);
        if (config.news.some(item => item.id === id))
            return fail(reply, `公告 ID ${id} 已存在`, 409);
        try {
            (0, news_config_1.saveNewsConfig)(Object.assign(Object.assign({}, config), { news: [...config.news, Object.assign(Object.assign({}, body), { id })] }));
            return sendOverview(reply);
        }
        catch (error) {
            return fail(reply, error);
        }
    }));
    fastify.patch("/items/:id", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const config = requireEditableConfig(reply);
        if (!config)
            return reply;
        if (!isRecord(request.body))
            return fail(reply, "请求正文必须是公告对象");
        const id = Number(request.params.id);
        const index = config.news.findIndex(item => item.id === id);
        if (index < 0)
            return fail(reply, `公告 ID ${id} 不存在`, 404);
        const nextNews = [...config.news];
        nextNews[index] = Object.assign(Object.assign(Object.assign({}, nextNews[index]), request.body), { id });
        try {
            (0, news_config_1.saveNewsConfig)(Object.assign(Object.assign({}, config), { news: nextNews }));
            return sendOverview(reply);
        }
        catch (error) {
            return fail(reply, error);
        }
    }));
    fastify.delete("/items/:id", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const config = requireEditableConfig(reply);
        if (!config)
            return reply;
        const id = Number(request.params.id);
        if (!config.news.some(item => item.id === id))
            return fail(reply, `公告 ID ${id} 不存在`, 404);
        const popup = config.popup.news_id === id
            ? Object.assign(Object.assign({}, config.popup), { enabled: false, news_id: null }) : config.popup;
        try {
            (0, news_config_1.saveNewsConfig)(Object.assign(Object.assign({}, config), { popup, news: config.news.filter(item => item.id !== id) }));
            (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", operation: "delete_news_receipts",
            }, () => (0, news_1.deleteNewsReceiptsSync)(id));
            return sendOverview(reply);
        }
        catch (error) {
            return fail(reply, error);
        }
    }));
    fastify.put("/popup", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const config = requireEditableConfig(reply);
        if (!config)
            return reply;
        if (!isRecord(request.body))
            return fail(reply, "请求正文必须是弹窗配置对象");
        try {
            (0, news_config_1.saveNewsConfig)(Object.assign(Object.assign({}, config), { popup: Object.assign(Object.assign({}, config.popup), request.body) }));
            return sendOverview(reply);
        }
        catch (error) {
            return fail(reply, error);
        }
    }));
    fastify.post("/popup/reset", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = isRecord(request.body) ? request.body : {};
        const requestedId = body.news_id;
        if (requestedId !== undefined && requestedId !== null && requestedId !== "") {
            const newsId = Number(requestedId);
            if (!Number.isSafeInteger(newsId) || newsId <= 0)
                return fail(reply, "公告 ID 无效");
            const deleted = (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", operation: "reset_news_popup_receipts",
            }, () => (0, news_1.deleteNewsReceiptsSync)(newsId, "popup"));
            return reply.send({ ok: true, deleted, news_id: newsId });
        }
        const deleted = (0, persistence_coordinator_1.runPersistenceTransactionSync)({
            domain: "admin", operation: "reset_all_news_popup_receipts",
        }, () => (0, news_1.deleteAllPopupNewsReceiptsSync)());
        return reply.send({ ok: true, deleted, news_id: null });
    }));
});
exports.default = routes;
