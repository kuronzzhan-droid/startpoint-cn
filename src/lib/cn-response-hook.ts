import type { FastifyInstance, FastifyReply } from "fastify"
import { performance } from "node:perf_hooks"
import { recordResponseEncoding } from "./request-diagnostics"
import { createCnResponseWorkerPool, type CnResponseWorkerPool } from "./cn-response-worker-pool"
import { getCnLoadHttpCompressionConfig, type CnLoadHttpCompressionConfig } from "./cn-load-http-compression"
import { hasWeaponRivenCapability } from "./client-admission"
import { projectWeaponRivenClientResponse } from "./weapon-riven/client"

function appendVaryAcceptEncoding(reply: FastifyReply): void {
    const current = reply.getHeader("vary")
    const values = String(current ?? "").split(",").map(value => value.trim()).filter(Boolean)
    if (!values.some(value => value.toLowerCase() === "accept-encoding")) {
        reply.header("vary", [...values, "Accept-Encoding"].join(", "))
    }
}

function safeCompressionLogValue(value: unknown): string {
    return String(value ?? "none").replace(/[\r\n\t]/g, " ").slice(0, 120)
}

export function installCnResponseEncoding(
    fastify: FastifyInstance,
    options: { pool?: CnResponseWorkerPool, compression?: CnLoadHttpCompressionConfig } = {},
): void {
    const responseWorkerPool = options.pool ?? createCnResponseWorkerPool()
    const cnLoadCompressionConfig = options.compression ?? getCnLoadHttpCompressionConfig()
    fastify.addHook("onClose", () => responseWorkerPool.close())
    fastify.addHook("onSend", async (request, reply, payload) => {
        const encodingStarted = performance.now();
        let encodedPayload = payload;
        try {
            if (reply.getHeader("content-type") === "application/x-msgpack") {
                payload = projectWeaponRivenClientResponse(payload, hasWeaponRivenCapability(request));
                const loadResponse = request.url.split("?", 1)[0].endsWith("/load");
                const compressedLoad = loadResponse && cnLoadCompressionConfig.mode !== "off";
                if (compressedLoad) appendVaryAcceptEncoding(reply);
                const encoded = await responseWorkerPool.encode({
                    payload,
                    ...(compressedLoad ? { compression: {
                        config: cnLoadCompressionConfig,
                        acceptEncoding: request.headers["accept-encoding"],
                    } } : {}),
                }, { offloadObject: loadResponse });
                if (encoded.compressionError) {
                    console.error("[CN-LOAD-COMPRESS] compression failed; sending identity response");
                }
                const result = encoded.compression;
                if (result?.encoding) {
                    reply.header("content-encoding", result.encoding);
                    reply.removeHeader("content-length");
                }
                if (result && cnLoadCompressionConfig.log) {
                    const reduction = result.originalBytes > 0
                        ? ((1 - result.wireBytes / result.originalBytes) * 100).toFixed(1)
                        : "0.0";
                    console.warn(
                        `[CN-LOAD-COMPRESS] mode=${cnLoadCompressionConfig.mode} `
                        + `encoding=${result.encoding ?? "identity"} reason=${result.reason} `
                        + `accept=${safeCompressionLogValue(request.headers["accept-encoding"])} `
                        + `device=${safeCompressionLogValue(request.headers.device)} `
                        + `before=${result.originalBytes} after=${result.wireBytes} saved=${reduction}%`,
                    );
                }
                return encodedPayload = encoded.body;
            }
        } catch (error) {
            console.error("[CN-LOAD-COMPRESS] response serialization failed; using normal serializer:", error)
        } finally {
            recordResponseEncoding(request, performance.now() - encodingStarted, encodedPayload);
        }
        return payload;
    });
}
