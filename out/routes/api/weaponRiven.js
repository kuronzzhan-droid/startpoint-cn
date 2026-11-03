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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const session_1 = require("../../data/domains/session");
const activeAccount_1 = require("../../data/activeAccount");
const weapon_riven_party_1 = require("../../data/domains/weapon-riven-party");
const weapon_riven_operations_1 = require("../../data/domains/weapon-riven-operations");
const model_1 = require("../../lib/weapon-riven/model");
const client_admission_1 = require("../../lib/client-admission");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const utils_1 = require("../../utils");
const party_refresh_1 = require("../../lib/weapon-riven/party-refresh");
const integer = (value) => typeof value === "number" && Number.isSafeInteger(value);
const instanceId = (value) => integer(value) && value >= 16000001 && value <= 16000200;
function weaponRivenRoutes(fastify) {
    return __awaiter(this, void 0, void 0, function* () {
        fastify.post("/dismantle_batch", (request, reply) => __awaiter(this, void 0, void 0, function* () {
            const body = request.body;
            if (!body || !integer(body.viewer_id) || body.viewer_id < 1 || !integer(body.api_count) || body.api_count < 0
                || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20
                || !body.items.every(item => !!item && typeof item === "object" && instanceId(item.item_id)
                    && integer(item.revision) && item.revision >= 1
                    && (item.riven_id === undefined || (integer(item.riven_id) && item.riven_id >= 1)))
                || new Set(body.items.map(item => item.item_id)).size !== body.items.length) {
                return reply.status(400).send({ error: "Bad Request", code: "invalid_argument", message: "Invalid weapon riven request" });
            }
            const session = yield (0, session_1.getSession)(String(body.viewer_id));
            const playerId = session ? (0, activeAccount_1.resolvePlayerIdSync)(session.accountId) : null;
            if (playerId === null)
                return reply.status(400).send({ error: "Bad Request", code: "invalid_viewer", message: "Invalid viewer id" });
            if (!(0, client_admission_1.hasWeaponRivenCapability)(request))
                return reply.status(403).send({
                    error: "Forbidden", code: "capability_required", message: "Client requires weapon-riven-v1"
                });
            const sessionKey = (0, crypto_1.createHash)("sha256").update(String(request.headers["x-sp-session"])).digest("hex");
            const items = body.items.map(item => (Object.assign({ item_id: item.item_id, revision: item.revision }, (item.riven_id === undefined ? {} : { riven_id: item.riven_id }))));
            // Order-independent, and bound to each card's permanent riven_id when the client names it.
            const requestKey = `${sessionKey}:${body.api_count}:batch:${[...items].sort((a, b) => a.item_id - b.item_id)
                .map(item => { var _a; return `${item.item_id}.${item.revision}.${(_a = item.riven_id) !== null && _a !== void 0 ? _a : ""}`; }).join(",")}`;
            try {
                const result = yield (0, persistence_coordinator_1.runPersistenceTransaction)({ domain: "player", playerId, operation: "weapon_riven_dismantle_batch" }, () => {
                    const _a = (0, weapon_riven_operations_1.dismantleWeaponRivensBatchSync)(playerId, items, requestKey), { changed_parties } = _a, change = __rest(_a, ["changed_parties"]);
                    return Object.assign(Object.assign({}, change), { party_info_list: (0, weapon_riven_party_1.getWeaponRivenPartyInfoListSync)(playerId, changed_parties) });
                });
                if (!result.weapon_riven_conflict)
                    yield (0, party_refresh_1.refreshWeaponRivenPartiesAfterCommit)(playerId, result.party_info_list);
                reply.type("application/x-msgpack");
                return reply.send({ data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: body.viewer_id }), data: Object.assign(Object.assign({}, result), { mail_arrived: false }) });
            }
            catch (error) {
                if (!(error instanceof model_1.WeaponRivenError))
                    throw error;
                return reply.status(error.status).send({ error: "Weapon Riven Error", code: error.code, message: error.message });
            }
        }));
        for (const action of ["draw", "select", "dismantle", "lock", "seen"]) {
            fastify.post(`/${action}`, (request, reply) => __awaiter(this, void 0, void 0, function* () {
                const body = request.body;
                if (!body || !integer(body.viewer_id) || body.viewer_id < 1
                    || !integer(body.api_count) || body.api_count < 0
                    || (action === "seen" ? (!Array.isArray(body.item_ids) || body.item_ids.length > 200
                        || !body.item_ids.every(instanceId))
                        : (!instanceId(body.item_id) || !integer(body.riven_id) || body.riven_id < 1))
                    || (action === "lock" && body.locked !== true && body.locked !== false && body.locked !== 0 && body.locked !== 1)
                    || (action === "draw" && (!integer(body.revision) || body.revision < 1
                        || (body.mode !== undefined && body.mode !== "full" && body.mode !== "values")))
                    || (action === "select" && (typeof body.draw_id !== "string" || !body.draw_id || body.draw_id.length > 128
                        || typeof body.is_confirm !== "boolean"))) {
                    return reply.status(400).send({ error: "Bad Request", code: "invalid_argument", message: "Invalid weapon riven request" });
                }
                const session = yield (0, session_1.getSession)(String(body.viewer_id));
                const playerId = session ? (0, activeAccount_1.resolvePlayerIdSync)(session.accountId) : null;
                if (playerId === null)
                    return reply.status(400).send({ error: "Bad Request", code: "invalid_viewer", message: "Invalid viewer id" });
                if (!(0, client_admission_1.hasWeaponRivenCapability)(request))
                    return reply.status(403).send({
                        error: "Forbidden", code: "capability_required", message: "Client requires weapon-riven-v1"
                    });
                const sessionKey = (0, crypto_1.createHash)("sha256").update(String(request.headers["x-sp-session"])).digest("hex");
                const requestKey = `${sessionKey}:${body.api_count}:${body.item_id}:${body.riven_id}`;
                try {
                    const result = yield (0, persistence_coordinator_1.runPersistenceTransaction)({ domain: "player", playerId, operation: `weapon_riven_${action}` }, () => {
                        if (action === "seen")
                            return (0, weapon_riven_operations_1.markWeaponRivensSeenSync)(playerId, body.item_ids);
                        if (action === "lock")
                            return (0, weapon_riven_operations_1.lockWeaponRivenSync)(playerId, body.item_id, body.riven_id, body.locked ? 1 : 0);
                        if (action === "draw")
                            return (0, weapon_riven_operations_1.drawWeaponRivenSync)(playerId, body.item_id, body.riven_id, body.revision, undefined, `${requestKey}:${body.revision}`, body.cost_item_id, body.mode);
                        if (action === "select")
                            return (0, weapon_riven_operations_1.selectWeaponRivenSync)(playerId, body.item_id, body.riven_id, body.draw_id, body.is_confirm);
                        const _a = (0, weapon_riven_operations_1.dismantleWeaponRivenSync)(playerId, body.item_id, body.riven_id, requestKey), { changed_parties } = _a, change = __rest(_a, ["changed_parties"]);
                        const party_info_list = (0, weapon_riven_party_1.getWeaponRivenPartyInfoListSync)(playerId, changed_parties);
                        return Object.assign(Object.assign({}, change), { party_info_list });
                    });
                    if (action === "dismantle" && "party_info_list" in result && !result.weapon_riven_conflict) {
                        yield (0, party_refresh_1.refreshWeaponRivenPartiesAfterCommit)(playerId, result.party_info_list);
                    }
                    reply.type("application/x-msgpack");
                    return reply.send({ data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: body.viewer_id }), data: Object.assign(Object.assign({}, result), { mail_arrived: false }) });
                }
                catch (error) {
                    if (!(error instanceof model_1.WeaponRivenError))
                        throw error;
                    return reply.status(error.status).send({ error: "Weapon Riven Error", code: error.code, message: error.message });
                }
            }));
        }
    });
}
exports.default = weaponRivenRoutes;
