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
exports.installCnResponseEncoding = void 0;
const node_perf_hooks_1 = require("node:perf_hooks");
const request_diagnostics_1 = require("./request-diagnostics");
const cn_response_worker_pool_1 = require("./cn-response-worker-pool");
const cn_load_http_compression_1 = require("./cn-load-http-compression");
const client_admission_1 = require("./client-admission");
const client_1 = require("./weapon-riven/client");
function appendVaryAcceptEncoding(reply) {
    const current = reply.getHeader("vary");
    const values = String(current !== null && current !== void 0 ? current : "").split(",").map(value => value.trim()).filter(Boolean);
    if (!values.some(value => value.toLowerCase() === "accept-encoding")) {
        reply.header("vary", [...values, "Accept-Encoding"].join(", "));
    }
}
function safeCompressionLogValue(value) {
    return String(value !== null && value !== void 0 ? value : "none").replace(/[\r\n\t]/g, " ").slice(0, 120);
}
function installCnResponseEncoding(fastify, options = {}) {
    var _a, _b;
    const responseWorkerPool = (_a = options.pool) !== null && _a !== void 0 ? _a : (0, cn_response_worker_pool_1.createCnResponseWorkerPool)();
    const cnLoadCompressionConfig = (_b = options.compression) !== null && _b !== void 0 ? _b : (0, cn_load_http_compression_1.getCnLoadHttpCompressionConfig)();
    fastify.addHook("onClose", () => responseWorkerPool.close());
    fastify.addHook("onSend", (request, reply, payload) => __awaiter(this, void 0, void 0, function* () {
        var _c;
        const encodingStarted = node_perf_hooks_1.performance.now();
        let encodedPayload = payload;
        try {
            if (reply.getHeader("content-type") === "application/x-msgpack") {
                payload = (0, client_1.projectWeaponRivenClientResponse)(payload, (0, client_admission_1.hasWeaponRivenCapability)(request));
                const loadResponse = request.url.split("?", 1)[0].endsWith("/load");
                const compressedLoad = loadResponse && cnLoadCompressionConfig.mode !== "off";
                if (compressedLoad)
                    appendVaryAcceptEncoding(reply);
                const encoded = yield responseWorkerPool.encode(Object.assign({ payload }, (compressedLoad ? { compression: {
                        config: cnLoadCompressionConfig,
                        acceptEncoding: request.headers["accept-encoding"],
                    } } : {})), { offloadObject: loadResponse });
                if (encoded.compressionError) {
                    console.error("[CN-LOAD-COMPRESS] compression failed; sending identity response");
                }
                const result = encoded.compression;
                if (result === null || result === void 0 ? void 0 : result.encoding) {
                    reply.header("content-encoding", result.encoding);
                    reply.removeHeader("content-length");
                }
                if (result && cnLoadCompressionConfig.log) {
                    const reduction = result.originalBytes > 0
                        ? ((1 - result.wireBytes / result.originalBytes) * 100).toFixed(1)
                        : "0.0";
                    console.warn(`[CN-LOAD-COMPRESS] mode=${cnLoadCompressionConfig.mode} `
                        + `encoding=${(_c = result.encoding) !== null && _c !== void 0 ? _c : "identity"} reason=${result.reason} `
                        + `accept=${safeCompressionLogValue(request.headers["accept-encoding"])} `
                        + `device=${safeCompressionLogValue(request.headers.device)} `
                        + `before=${result.originalBytes} after=${result.wireBytes} saved=${reduction}%`);
                }
                return encodedPayload = encoded.body;
            }
        }
        catch (error) {
            console.error("[CN-LOAD-COMPRESS] response serialization failed; using normal serializer:", error);
        }
        finally {
            (0, request_diagnostics_1.recordResponseEncoding)(request, node_perf_hooks_1.performance.now() - encodingStarted, encodedPayload);
        }
        return payload;
    }));
}
exports.installCnResponseEncoding = installCnResponseEncoding;
