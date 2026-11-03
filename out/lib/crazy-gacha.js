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
exports.registerCrazyGachaRoutes = exports.handleCrazyGachaExec = exports.decorateLoadWithCrazyGacha = exports.CRAZY_EXEC_TYPE = exports.CRAZY_PAGE_KIND = void 0;
// 乐享扭蛋（pageKind 5，客户端 exec type 14）：每抽一轮扣 1 张十连券，结果先放进槽 0 不入账；
// 可存到槽 1/2；选定一个槽（crazy_gacha_select）后才发角色并清空所有槽与抽取次数。
const db_1 = require("../data/db");
const item_1 = require("../data/domains/item");
const player_1 = require("../data/domains/player");
const session_1 = require("../data/domains/session");
const activeAccount_1 = require("../data/activeAccount");
const assets_1 = require("./assets");
const gacha_1 = require("./gacha");
const character_1 = require("./character");
const persistence_coordinator_1 = require("./persistence-coordinator");
const utils_1 = require("../utils");
exports.CRAZY_PAGE_KIND = 5;
exports.CRAZY_EXEC_TYPE = 14;
// 原版：一张乐享券可在 50 轮内反复抽，选定后才入账。券在选定时才扣（按已抽轮数每 50 轮 1 张），
// 抽的过程中券数不变——客户端券数为 0 时会藏起重抽按钮。
const DRAWS_PER_TICKET = 50;
const SLOTS = [0, 1, 2];
let tableReady = false;
function ensureTable() {
    if (tableReady)
        return;
    (0, db_1.getDb)().prepare(`CREATE TABLE IF NOT EXISTS players_crazy_gacha (
        player_id INTEGER NOT NULL,
        gacha_id INTEGER NOT NULL,
        draw_count INTEGER NOT NULL DEFAULT 0,
        slot0 TEXT NOT NULL DEFAULT '[]',
        slot1 TEXT NOT NULL DEFAULT '[]',
        slot2 TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (player_id, gacha_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();
    tableReady = true;
}
function readState(playerId, gachaId) {
    ensureTable();
    const row = (0, db_1.getDb)().prepare(`SELECT draw_count, slot0, slot1, slot2 FROM players_crazy_gacha WHERE player_id = ? AND gacha_id = ?`)
        .get(playerId, gachaId);
    return {
        gachaId,
        drawCount: row ? row.draw_count : 0,
        slots: row ? [JSON.parse(row.slot0), JSON.parse(row.slot1), JSON.parse(row.slot2)] : [[], [], []],
    };
}
function writeState(playerId, state) {
    ensureTable();
    (0, db_1.getDb)().prepare(`INSERT INTO players_crazy_gacha (player_id, gacha_id, draw_count, slot0, slot1, slot2)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id, gacha_id) DO UPDATE SET draw_count = excluded.draw_count,
            slot0 = excluded.slot0, slot1 = excluded.slot1, slot2 = excluded.slot2`)
        .run(playerId, state.gachaId, state.drawCount, JSON.stringify(state.slots[0]), JSON.stringify(state.slots[1]), JSON.stringify(state.slots[2]));
}
function slotMap(state) {
    const result = {};
    for (const slot of SLOTS)
        result[String(slot)] = state.slots[slot];
    return result;
}
function maxDrawCount() {
    const value = Number((0, assets_1.getConfigSync)().gacha_crazy_ten_max_count);
    return Number.isSafeInteger(value) && value > 0 ? value : 999;
}
/** Adds saved crazy-gacha slots and draw counts to a /load payload. */
function decorateLoadWithCrazyGacha(d, playerId) {
    ensureTable();
    const rows = (0, db_1.getDb)().prepare(`SELECT gacha_id FROM players_crazy_gacha WHERE player_id = ?`).all(playerId);
    if (rows.length === 0)
        return;
    // The client keeps one slot map, so the most recently stored pool wins; only pool 100 uses this today.
    const state = readState(playerId, rows[rows.length - 1].gacha_id);
    d.crazy_gacha_result_list = slotMap(state);
    // 客户端把每项当完整抽卡记录校验（character_id/entry_count/movie_id/seed），槽位里只存了角色 id，
    // 发不全会在登录时报 C87xx；槽位结果已在 crazy_gacha_result_list 里，这里保持空数组。
    d.last_crazy_gacha_draw_result = [];
    if (Array.isArray(d.gacha_info_list)) {
        for (const row of rows) {
            const s = readState(playerId, row.gacha_id);
            const info = d.gacha_info_list.find(entry => entry.gacha_id === row.gacha_id);
            if (info)
                info.crazy_draw_count = s.drawCount;
            else
                d.gacha_info_list.push({ gacha_id: row.gacha_id, is_daily_first: false, is_account_first: false, gacha_exchange_point: 0, crazy_draw_count: s.drawCount });
        }
    }
}
exports.decorateLoadWithCrazyGacha = decorateLoadWithCrazyGacha;
function badRequest(reply, message) {
    return reply.status(400).send({ "error": "Bad Request", "message": message });
}
function send(reply, viewerId, data) {
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({ "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }), "data": data });
}
function handleCrazyGachaExec(reply, ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        const { viewerId, playerId, gachaId, gachaData, type } = ctx;
        const ticketItemId = gachaData.tenTicketItemId;
        if (type !== exports.CRAZY_EXEC_TYPE || !ticketItemId)
            return badRequest(reply, "Gacha execution type is not allowed for this gacha.");
        const draws = (0, gacha_1.drawGachaWithMetadataSync)(gachaData, 10).map(draw => draw.id);
        const movies = (0, gacha_1.planCharacterGachaMovies)(gachaData, draws, { skipNoRarityUpMovie: false, flushPrevious: false });
        const result = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "gacha", playerId, operation: "crazy_draw",
        }, () => {
            const before = (0, item_1.getPlayerItemSync)(playerId, ticketItemId);
            const state = readState(playerId, gachaId);
            if (state.drawCount >= maxDrawCount())
                return { ok: false, message: "Crazy gacha draw limit reached." };
            if (!(before >= Math.ceil((state.drawCount + 1) / DRAWS_PER_TICKET)))
                return { ok: false, message: "Not enough tickets." };
            const after = before;
            state.slots[0] = draws;
            state.drawCount += 1;
            writeState(playerId, state);
            const player = (0, player_1.getPlayerSync)(playerId);
            return {
                ok: true,
                data: {
                    "user_info": { "free_vmoney": player.freeVmoney, "vmoney": player.vmoney },
                    "draw": draws.map((characterId, index) => ({
                        "character_id": characterId, "movie_id": movies[index].movieId, "seed": movies[index].seed, "entry_count": 1,
                    })),
                    "character_list": [],
                    "item_list": { [ticketItemId]: after },
                    "gacha_campaign_list": [],
                    "gacha_info_list": [{ "gacha_id": gachaId, "is_account_first": false, "is_daily_first": false, "gacha_exchange_point": 0, "crazy_draw_count": state.drawCount }],
                    "crazy_gacha_result_list": slotMap(state),
                    "encyclopedia_info": [],
                    "mail_arrived": false,
                },
            };
        }, {
            afterCommit: committed => {
                if (committed.ok)
                    (0, gacha_1.commitPlannedCharacterGachaMovies)(movies);
            },
        });
        if (!result.ok)
            return badRequest(reply, result.message);
        return send(reply, viewerId, result.data);
    });
}
exports.handleCrazyGachaExec = handleCrazyGachaExec;
function resolvePlayer(body) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!body || typeof body !== "object" || !Number.isSafeInteger(body.viewer_id))
            return null;
        const session = yield (0, session_1.getSession)(String(body.viewer_id));
        const playerId = session ? (0, activeAccount_1.resolvePlayerIdSync)(session.accountId) : null;
        return playerId === null || playerId === undefined ? null : playerId;
    });
}
function latestStateGachaId(playerId) {
    ensureTable();
    const row = (0, db_1.getDb)().prepare(`SELECT gacha_id FROM players_crazy_gacha WHERE player_id = ? ORDER BY rowid DESC LIMIT 1`).get(playerId);
    return row ? row.gacha_id : null;
}
function registerCrazyGachaRoutes(fastify) {
    fastify.post("/crazy_gacha_save", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        const body = request.body;
        const playerId = yield resolvePlayer(body);
        if (playerId === null)
            return badRequest(reply, "Invalid viewer id.");
        const index = body.index;
        if (index !== 1 && index !== 2)
            return badRequest(reply, "Invalid slot.");
        const result = yield (0, persistence_coordinator_1.runPersistenceTransaction)({ domain: "gacha", playerId, operation: "crazy_save" }, () => {
            const gachaId = latestStateGachaId(playerId);
            if (gachaId === null)
                return { ok: false, message: "Nothing to save." };
            const state = readState(playerId, gachaId);
            if (state.slots[0].length === 0)
                return { ok: false, message: "Nothing to save." };
            if (state.slots[index].length !== 0) {
                // 重发的同一个保存请求：内容和当前结果一致就当成功，避免客户端 H400 回登录页。
                if (JSON.stringify(state.slots[index]) === JSON.stringify(state.slots[0]))
                    return { ok: true, data: { "crazy_gacha_result_list": slotMap(state) } };
                return { ok: false, message: "Slot already used." };
            }
            state.slots[index] = state.slots[0].slice();
            writeState(playerId, state);
            return { ok: true, data: { "crazy_gacha_result_list": slotMap(state) } };
        });
        if (!result.ok)
            return badRequest(reply, result.message);
        return send(reply, body.viewer_id, result.data);
    }));
    fastify.post("/crazy_gacha_select", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        const body = request.body;
        const playerId = yield resolvePlayer(body);
        if (playerId === null)
            return badRequest(reply, "Invalid viewer id.");
        const index = body.index;
        const gachaId = body.gacha_id;
        if (!SLOTS.includes(index) || !Number.isSafeInteger(gachaId))
            return badRequest(reply, "Invalid request body.");
        const result = yield (0, persistence_coordinator_1.runPersistenceTransaction)({ domain: "gacha", playerId, operation: "crazy_select" }, () => {
            const state = readState(playerId, gachaId);
            const chosen = state.slots[index];
            if (!chosen || chosen.length === 0) {
                // 选定成功后被重发：所有槽已清空、抽数归零，按成功返回空结果。
                if (state.drawCount === 0 && state.slots.every(slot => slot.length === 0))
                    return { ok: true, data: { "character_list": [], "item_list": {}, "gacha_info_list": [{ "gacha_id": gachaId, "is_account_first": false, "is_daily_first": false, "gacha_exchange_point": 0, "crazy_draw_count": 0 }], "crazy_gacha_result_list": slotMap(state), "mail_arrived": false } };
                return { ok: false, message: "Selected slot is empty." };
            }
            const gachaData = (0, assets_1.getGachaSync)(gachaId);
            const ticketItemId = gachaData && gachaData.tenTicketItemId;
            const items = {};
            if (ticketItemId) {
                const owned = (0, item_1.getPlayerItemSync)(playerId, ticketItemId) || 0;
                const cost = Math.max(1, Math.ceil(state.drawCount / DRAWS_PER_TICKET));
                const left = Math.max(0, owned - cost);
                (0, item_1.updatePlayerItemSync)(playerId, ticketItemId, left);
                items[ticketItemId] = left;
            }
            const characters = new Map();
            for (const characterId of chosen) {
                const give = (0, character_1.givePlayerCharacterSync)(playerId, characterId);
                if (!give)
                    continue;
                characters.set(characterId, Object.assign(Object.assign({}, characters.get(characterId) || {}), give.character));
                if (give.item)
                    items[give.item.id] = give.item.inventoryCount;
            }
            state.slots = [[], [], []];
            state.drawCount = 0;
            writeState(playerId, state);
            return {
                ok: true,
                data: {
                    "character_list": Array.from(characters.values()),
                    "item_list": items,
                    "gacha_info_list": [{ "gacha_id": gachaId, "is_account_first": false, "is_daily_first": false, "gacha_exchange_point": 0, "crazy_draw_count": 0 }],
                    "crazy_gacha_result_list": slotMap(state),
                    "mail_arrived": false,
                },
            };
        });
        if (!result.ok)
            return badRequest(reply, result.message);
        return send(reply, body.viewer_id, result.data);
    }));
}
exports.registerCrazyGachaRoutes = registerCrazyGachaRoutes;
