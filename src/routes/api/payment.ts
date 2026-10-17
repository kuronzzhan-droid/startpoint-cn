// Handles payment (IAP) endpoints.
// Private server: accepts any valid request, no real payment validation.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getPaymentProductCountSync, getPaymentReceiptSync, insertPaymentReceiptSync } from "../../data/domains/payment"
import { getSession } from "../../data/domains/session"
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { generateDataHeaders } from "../../utils";
import { getConfigSync } from "../../lib/assets";
import paymentProducts from "../../../assets/payment_products.json";
import { runPersistenceTransaction } from "../../lib/persistence-coordinator";
import { paymentGrantGuard } from "../../lib/payment-grant-guard";

interface PaymentProduct {
    store_product_id: string
    charge_vmoney_num: number
    free_vmoney_num: number
    start_time: number
    end_time: number
    age_limit: boolean
    monthly_alert: boolean
}

const PRODUCTS: Record<string, PaymentProduct> = paymentProducts as Record<string, PaymentProduct>

// Fallback for clients that do not send a stable transaction identity. Native
// callbacks with a receipt or transaction_id use the durable table below.
const purchaseHistory: Record<string, number> = {}

const routes = async (fastify: FastifyInstance) => {
    const grantGuard = paymentGrantGuard(fastify)
    fastify.post("/item_list", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { api_count: number, viewer_id: number }
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })

        // Payment disabled on private server — return empty list
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "payment_item_list": [],
                "refund_penalty_status": null
            }
        })
    })

    fastify.post("/start", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as {
            viewer_id: number
            api_count: number
            payment?: { product_id: string }
        }
        const viewerId = body.viewer_id
        // Leiting SDK wraps product_id in nested payment object
        const productId = body.payment?.product_id || (body as any).product_id

        if (!viewerId || isNaN(viewerId) || !productId) {
            console.warn(`[PAYMENT-START] invalid request, body: ${JSON.stringify(body)}`)
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId }),
                "data": {}
            })
        }

        const session = await getSession(viewerId.toString())
        if (!session) {
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId }),
                "data": {}
            })
        }

        const product = Object.prototype.hasOwnProperty.call(PRODUCTS, productId) ? PRODUCTS[productId] : undefined
        if (!product) {
            console.warn(`[PAYMENT-START] unknown product: ${productId}`)
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId }),
                "data": {}
            })
        }

        console.log(`[PAYMENT-START] viewer ${viewerId}, product: ${productId} (paid=${product.charge_vmoney_num} free=${product.free_vmoney_num})`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {}
        })
    })

    fastify.post("/finish", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as {
            viewer_id: number
            api_count: number
            product_id?: string
            receipt?: string
            signature?: string
            payment?: {
                original_receipt?: string
                signature?: string
                currency_code?: string
                price_number?: number
                transaction_id?: string
            }
            deviceInfo?: any
        }
        const viewerId = body.viewer_id
        // Leiting SDK wraps receipt in nested payment object
        const receipt = body.receipt || body.payment?.original_receipt || ""

        if (!viewerId || isNaN(viewerId)) {
            console.warn(`[PAYMENT-FINISH] invalid viewer_id`)
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId }),
                "data": {}
            })
        }

        const session = await getSession(viewerId.toString())
        if (!session) {
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId }),
                "data": {}
            })
        }

        const playerId = resolvePlayerIdSync(session.accountId)!
        if (!playerId) return reply.status(500).send({ "error": "Internal Server Error", "message": "No player bound to account." })

        const player = getPlayerSync(playerId)
        if (!player) return reply.status(500).send({ "error": "Internal Server Error", "message": "Player not found." })

        // Determine product_id from pending payment
        const productId = body.product_id || ""
        const product = Object.prototype.hasOwnProperty.call(PRODUCTS, productId) ? PRODUCTS[productId] : undefined
        if (!product) {
            console.warn(`[PAYMENT-FINISH] unknown product: ${productId}`)
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId }),
                "data": {}
            })
        }

        const paidVmoney = Math.max(0, isFinite(product.charge_vmoney_num) ? product.charge_vmoney_num : 0)
        const freeVmoney = Math.max(0, isFinite(product.free_vmoney_num) ? product.free_vmoney_num : 0)

        if (paidVmoney === 0 && freeVmoney === 0) {
            console.warn(`[PAYMENT-FINISH] product ${productId} has zero vmoney`)
        }

        const rawPaymentIdentity = body.payment?.transaction_id || receipt
        const paymentKey = rawPaymentIdentity
            ? createHash("sha256").update(`${productId}\u0000${rawPaymentIdentity}`).digest("hex")
            : null
        const purchaseKey = `${playerId}_${productId}`
        const result = await runPersistenceTransaction({
            domain: "player", playerId, operation: "payment_finish",
        }, () => {
            const current = getPlayerSync(playerId)
            if (!current) throw new Error("Player not found.")
            if (paymentKey) {
                const previous = getPaymentReceiptSync(playerId, paymentKey)
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
                    }
                }
            }

            const decision = grantGuard.check({ playerId, productId })
            if (!decision.allowed) {
                return {
                    beforePaid: current.vmoney, beforeFree: current.freeVmoney,
                    afterPaid: current.vmoney, afterFree: current.freeVmoney,
                    times: paymentKey ? getPaymentProductCountSync(playerId, productId) : (purchaseHistory[purchaseKey] ?? 0),
                    duplicate: false, denied: decision.reason,
                    retryAfterMs: decision.retryAfterMs, budgetAt: decision.at,
                }
            }

            const maxVmoney = getConfigSync().max_virtual_money
            const afterPaid = Math.min(current.vmoney + paidVmoney, maxVmoney)
            const afterFree = Math.min(current.freeVmoney + freeVmoney, maxVmoney)
            updatePlayerSync({ id: playerId, vmoney: afterPaid, freeVmoney: afterFree })

            const times = paymentKey
                ? getPaymentProductCountSync(playerId, productId) + 1
                : (purchaseHistory[purchaseKey] ?? 0) + 1
            if (paymentKey) {
                insertPaymentReceiptSync({
                    playerId, paymentKey, productId, paidVmoney, freeVmoney,
                    afterVmoney: afterPaid, afterFreeVmoney: afterFree, purchaseCount: times,
                })
            }
            return { beforePaid: current.vmoney, beforeFree: current.freeVmoney, afterPaid, afterFree, times,
                duplicate: false, denied: null, retryAfterMs: 0, budgetAt: decision.at }
        }, {
            afterCommit: committed => {
                if (committed.duplicate || committed.denied) return
                grantGuard.commit({ playerId, productId }, committed.budgetAt)
                purchaseHistory[purchaseKey] = committed.times
            },
        })
        const { afterPaid, afterFree, times } = result

        const skipped = result.duplicate || result.denied
        console.log(`[PAYMENT-FINISH] player ${playerId}: paid ${result.beforePaid}->${afterPaid} (+${skipped ? 0 : paidVmoney}), free ${result.beforeFree}->${afterFree} (+${skipped ? 0 : freeVmoney}), product: ${productId}, times: ${times}${result.duplicate ? " duplicate=1" : ""}${result.denied ? ` denied=${result.denied}` : ""}`)

        reply.header("content-type", "application/x-msgpack")
        if (result.denied) reply.header("retry-after", Math.ceil(result.retryAfterMs / 1_000))
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
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
        })
    })

    // Leiting SDK: report purchase result from native SDK callback
    fastify.post("/report_purchase_result", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as {
            viewer_id: number
            api_count: number
            order_id: string
            status: string
            result_code: string
            result_msg: string
        }
        console.log(`[PAYMENT-REPORT] order=${body.order_id} status=${body.status}`)
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: body.viewer_id }),
            "data": {}
        })
    })
}

export default routes
