"use strict";
// Handles payment (IAP) endpoints.
// Private server: accepts any valid request, no real payment validation.
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
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const player_1 = require("../../data/domains/player");
const payment_1 = require("../../data/domains/payment");
const session_1 = require("../../data/domains/session");
const activeAccount_1 = require("../../data/activeAccount");
const utils_1 = require("../../utils");
const assets_1 = require("../../lib/assets");
const payment_products_json_1 = __importDefault(require("../../../assets/payment_products.json"));
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const payment_grant_guard_1 = require("../../lib/payment-grant-guard");
const PRODUCTS = payment_products_json_1.default;
// Fallback for clients that do not send a stable transaction identity. Native
// callbacks with a receipt or transaction_id use the durable table below.
const purchaseHistory = {};
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    const grantGuard = (0, payment_grant_guard_1.paymentGrantGuard)(fastify);
    fastify.post("/item_list", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id."
            });
        // Payment disabled on private server — return empty list
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "payment_item_list": [],
                "refund_penalty_status": null
            }
        });
    }));
    fastify.post("/start", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const body = request.body;
        const viewerId = body.viewer_id;
        // Leiting SDK wraps product_id in nested payment object
        const productId = ((_a = body.payment) === null || _a === void 0 ? void 0 : _a.product_id) || body.product_id;
        if (!viewerId || isNaN(viewerId) || !productId) {
            console.warn(`[PAYMENT-START] invalid request, body: ${JSON.stringify(body)}`);
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                "data": {}
            });
        }
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session) {
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                "data": {}
            });
        }
        const product = Object.prototype.hasOwnProperty.call(PRODUCTS, productId) ? PRODUCTS[productId] : undefined;
        if (!product) {
            console.warn(`[PAYMENT-START] unknown product: ${productId}`);
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                "data": {}
            });
        }
        console.log(`[PAYMENT-START] viewer ${viewerId}, product: ${productId} (paid=${product.charge_vmoney_num} free=${product.free_vmoney_num})`);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {}
        });
    }));
    fastify.post("/finish", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _b, _c;
        const body = request.body;
        const viewerId = body.viewer_id;
        // Leiting SDK wraps receipt in nested payment object
        const receipt = body.receipt || ((_b = body.payment) === null || _b === void 0 ? void 0 : _b.original_receipt) || "";
        if (!viewerId || isNaN(viewerId)) {
            console.warn(`[PAYMENT-FINISH] invalid viewer_id`);
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                "data": {}
            });
        }
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session) {
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                "data": {}
            });
        }
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (!playerId)
            return reply.status(500).send({ "error": "Internal Server Error", "message": "No player bound to account." });
        const player = (0, player_1.getPlayerSync)(playerId);
        if (!player)
            return reply.status(500).send({ "error": "Internal Server Error", "message": "Player not found." });
        // Determine product_id from pending payment
        const productId = body.product_id || "";
        const product = Object.prototype.hasOwnProperty.call(PRODUCTS, productId) ? PRODUCTS[productId] : undefined;
        if (!product) {
            console.warn(`[PAYMENT-FINISH] unknown product: ${productId}`);
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                "data": {}
            });
        }
        const paidVmoney = Math.max(0, isFinite(product.charge_vmoney_num) ? product.charge_vmoney_num : 0);
        const freeVmoney = Math.max(0, isFinite(product.free_vmoney_num) ? product.free_vmoney_num : 0);
        if (paidVmoney === 0 && freeVmoney === 0) {
            console.warn(`[PAYMENT-FINISH] product ${productId} has zero vmoney`);
        }
        const rawPaymentIdentity = ((_c = body.payment) === null || _c === void 0 ? void 0 : _c.transaction_id) || receipt;
        const paymentKey = rawPaymentIdentity
            ? (0, node_crypto_1.createHash)("sha256").update(`${productId}\u0000${rawPaymentIdentity}`).digest("hex")
            : null;
        const purchaseKey = `${playerId}_${productId}`;
        const result = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "payment_finish",
        }, () => {
            var _a, _b;
            const current = (0, player_1.getPlayerSync)(playerId);
            if (!current)
                throw new Error("Player not found.");
            if (paymentKey) {
                const previous = (0, payment_1.getPaymentReceiptSync)(playerId, paymentKey);
                if (previous) {
                    return {
                        beforePaid: previous.afterVmoney,
                        beforeFree: previous.afterFreeVmoney,
                        afterPaid: previous.afterVmoney,
                        afterFree: previous.afterFreeVmoney,
                        times: previous.purchaseCount,
                        duplicate: true,
                        denied: null,
                        retryAfterMs: 0,
                        budgetAt: 0,
                    };
                }
            }
            const decision = grantGuard.check({ playerId, productId });
            if (!decision.allowed) {
                return {
                    beforePaid: current.vmoney, beforeFree: current.freeVmoney,
                    afterPaid: current.vmoney, afterFree: current.freeVmoney,
                    times: paymentKey ? (0, payment_1.getPaymentProductCountSync)(playerId, productId) : ((_a = purchaseHistory[purchaseKey]) !== null && _a !== void 0 ? _a : 0),
                    duplicate: false, denied: decision.reason,
                    retryAfterMs: decision.retryAfterMs, budgetAt: decision.at,
                };
            }
            const maxVmoney = (0, assets_1.getConfigSync)().max_virtual_money;
            const afterPaid = Math.min(current.vmoney + paidVmoney, maxVmoney);
            const afterFree = Math.min(current.freeVmoney + freeVmoney, maxVmoney);
            (0, player_1.updatePlayerSync)({ id: playerId, vmoney: afterPaid, freeVmoney: afterFree });
            const times = paymentKey
                ? (0, payment_1.getPaymentProductCountSync)(playerId, productId) + 1
                : ((_b = purchaseHistory[purchaseKey]) !== null && _b !== void 0 ? _b : 0) + 1;
            if (paymentKey) {
                (0, payment_1.insertPaymentReceiptSync)({
                    playerId, paymentKey, productId, paidVmoney, freeVmoney,
                    afterVmoney: afterPaid, afterFreeVmoney: afterFree, purchaseCount: times,
                });
            }
            return { beforePaid: current.vmoney, beforeFree: current.freeVmoney, afterPaid, afterFree, times,
                duplicate: false, denied: null, retryAfterMs: 0, budgetAt: decision.at };
        }, {
            afterCommit: committed => {
                if (committed.duplicate || committed.denied)
                    return;
                grantGuard.commit({ playerId, productId }, committed.budgetAt);
                purchaseHistory[purchaseKey] = committed.times;
            },
        });
        const { afterPaid, afterFree, times } = result;
        const skipped = result.duplicate || result.denied;
        console.log(`[PAYMENT-FINISH] player ${playerId}: paid ${result.beforePaid}->${afterPaid} (+${skipped ? 0 : paidVmoney}), free ${result.beforeFree}->${afterFree} (+${skipped ? 0 : freeVmoney}), product: ${productId}, times: ${times}${result.duplicate ? " duplicate=1" : ""}${result.denied ? ` denied=${result.denied}` : ""}`);
        reply.header("content-type", "application/x-msgpack");
        if (result.denied)
            reply.header("retry-after", Math.ceil(result.retryAfterMs / 1000));
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "after_vmoney": afterPaid,
                "after_free_vmoney": afterFree,
                "first_payment": !result.denied && times === 1,
                "first_time": !result.denied && times === 1,
                "purchased_times_list": { [productId]: times },
                "monthly_payment_total": 0,
                "monthly_charge_bonus_info": null,
                "premium_bonus_list": null
            }
        });
    }));
    // Leiting SDK: report purchase result from native SDK callback
    fastify.post("/report_purchase_result", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        console.log(`[PAYMENT-REPORT] order=${body.order_id} status=${body.status}`);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: body.viewer_id }),
            "data": {}
        });
    }));
});
exports.default = routes;
