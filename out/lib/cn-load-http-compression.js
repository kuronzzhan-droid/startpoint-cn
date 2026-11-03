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
exports.compressCnLoadHttpBody = exports.acceptsHttpEncoding = exports.getCnLoadHttpCompressionConfig = void 0;
const node_zlib_1 = require("node:zlib");
function clampInteger(value, fallback, minimum, maximum) {
    const parsed = Number.parseInt(value !== null && value !== void 0 ? value : "", 10);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.max(minimum, Math.min(maximum, parsed));
}
function parseBoolean(value) {
    return /^(1|true|yes|on)$/i.test(value !== null && value !== void 0 ? value : "");
}
function getCnLoadHttpCompressionConfig(environment = process.env) {
    var _a;
    const configuredMode = ((_a = environment.CN_LOAD_HTTP_COMPRESSION) !== null && _a !== void 0 ? _a : "off").trim().toLowerCase();
    const mode = ["off", "observe", "gzip", "br", "auto"].includes(configuredMode)
        ? configuredMode
        : "off";
    return {
        mode,
        minimumBytes: clampInteger(environment.CN_LOAD_HTTP_COMPRESSION_MIN_BYTES, 4096, 0, 10000000),
        // Level 1 keeps main-login CPU cost low while repeated save keys still compress well.
        gzipLevel: clampInteger(environment.CN_LOAD_HTTP_GZIP_LEVEL, 1, 1, 9),
        brotliQuality: clampInteger(environment.CN_LOAD_HTTP_BROTLI_QUALITY, 3, 0, 11),
        log: parseBoolean(environment.CN_LOAD_HTTP_COMPRESSION_LOG),
    };
}
exports.getCnLoadHttpCompressionConfig = getCnLoadHttpCompressionConfig;
function acceptsHttpEncoding(header, encoding) {
    const text = typeof header === "string" ? header : header === null || header === void 0 ? void 0 : header.join(",");
    if (!text)
        return false;
    let wildcardQuality = null;
    for (const token of text.split(",")) {
        const [rawName, ...parameters] = token.trim().toLowerCase().split(";");
        if (!rawName)
            continue;
        let quality = 1;
        for (const parameter of parameters) {
            const match = parameter.trim().match(/^q\s*=\s*(0(?:\.\d+)?|1(?:\.0+)?)$/);
            if (match)
                quality = Number(match[1]);
        }
        if (rawName === encoding)
            return quality > 0;
        if (rawName === "*")
            wildcardQuality = quality;
    }
    return (wildcardQuality !== null && wildcardQuality !== void 0 ? wildcardQuality : 0) > 0;
}
exports.acceptsHttpEncoding = acceptsHttpEncoding;
function gzipAsync(body, level) {
    return new Promise((resolve, reject) => (0, node_zlib_1.gzip)(body, { level }, (error, result) => (error ? reject(error) : resolve(result))));
}
function brotliAsync(body, quality) {
    return new Promise((resolve, reject) => (0, node_zlib_1.brotliCompress)(body, {
        params: { [node_zlib_1.constants.BROTLI_PARAM_QUALITY]: quality },
    }, (error, result) => (error ? reject(error) : resolve(result))));
}
function compressCnLoadHttpBody(body, acceptEncoding, config) {
    return __awaiter(this, void 0, void 0, function* () {
        const base = {
            body,
            encoding: null,
            originalBytes: body.length,
            wireBytes: body.length,
        };
        if (config.mode === "off")
            return Object.assign(Object.assign({}, base), { reason: "disabled" });
        if (body.length < config.minimumBytes)
            return Object.assign(Object.assign({}, base), { reason: "below-threshold" });
        if (config.mode === "observe")
            return Object.assign(Object.assign({}, base), { reason: "observe" });
        const supportsBrotli = acceptsHttpEncoding(acceptEncoding, "br");
        const supportsGzip = acceptsHttpEncoding(acceptEncoding, "gzip");
        const encoding = config.mode === "br"
            ? (supportsBrotli ? "br" : null)
            : config.mode === "gzip"
                ? (supportsGzip ? "gzip" : null)
                : supportsBrotli
                    ? "br"
                    : supportsGzip
                        ? "gzip"
                        : null;
        if (encoding === null)
            return Object.assign(Object.assign({}, base), { reason: "not-accepted" });
        const compressed = encoding === "br"
            ? yield brotliAsync(body, config.brotliQuality)
            : yield gzipAsync(body, config.gzipLevel);
        return {
            body: compressed,
            encoding,
            originalBytes: body.length,
            wireBytes: compressed.length,
            reason: "compressed",
        };
    });
}
exports.compressCnLoadHttpBody = compressCnLoadHttpBody;
