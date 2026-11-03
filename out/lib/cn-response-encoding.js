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
exports.encodeCnResponse = exports.fixUint32Tags = void 0;
const msgpackr_1 = require("msgpackr");
const node_perf_hooks_1 = require("node:perf_hooks");
const cn_load_http_compression_1 = require("./cn-load-http-compression");
/** AIR cannot read uint32 correctly. Copy only when a uint32 tag needs fixing. */
function fixUint32Tags(input) {
    let output;
    let copiedThrough = 0;
    let written = 0;
    const end = input.length;
    function walk(offset) {
        if (offset >= end)
            throw new Error("Truncated MessagePack response");
        const tag = input[offset];
        let next = offset + 1;
        let children = 0;
        if (tag <= 0x7f || tag >= 0xe0 || tag === 0xc0 || tag === 0xc2 || tag === 0xc3)
            return next;
        if (tag >= 0xa0 && tag <= 0xbf)
            return next + (tag & 0x1f);
        if (tag >= 0x90 && tag <= 0x9f)
            children = tag & 0x0f;
        else if (tag >= 0x80 && tag <= 0x8f)
            children = (tag & 0x0f) * 2;
        else
            switch (tag) {
                case 0xcc:
                case 0xd0: return next + 1;
                case 0xcd:
                case 0xd1: return next + 2;
                case 0xd2:
                case 0xca: return next + 4;
                case 0xcf:
                case 0xd3:
                case 0xcb: return next + 8;
                case 0xce: {
                    const value = input.readUInt32BE(next);
                    output !== null && output !== void 0 ? output : (output = Buffer.allocUnsafe(end * 2));
                    written += input.copy(output, written, copiedThrough, offset);
                    if (value < 0x80000000) {
                        output[written++] = 0xd2;
                        output.writeInt32BE(value, written);
                        written += 4;
                    }
                    else {
                        output[written++] = 0xcb;
                        output.writeDoubleBE(value, written);
                        written += 8;
                    }
                    copiedThrough = next + 4;
                    return copiedThrough;
                }
                case 0xd9:
                case 0xc4: return next + 1 + input.readUInt8(next);
                case 0xda:
                case 0xc5: return next + 2 + input.readUInt16BE(next);
                case 0xdb:
                case 0xc6: return next + 4 + input.readUInt32BE(next);
                case 0xc7: return next + 2 + input.readUInt8(next);
                case 0xc8: return next + 3 + input.readUInt16BE(next);
                case 0xc9: return next + 5 + input.readUInt32BE(next);
                // The extension's type byte precedes its payload.
                case 0xd4: return next + 2;
                case 0xd5: return next + 3;
                case 0xd6: return next + 5;
                case 0xd7: return next + 9;
                case 0xd8: return next + 17;
                case 0xdc:
                    children = input.readUInt16BE(next);
                    next += 2;
                    break;
                case 0xdd:
                    children = input.readUInt32BE(next);
                    next += 4;
                    break;
                case 0xde:
                    children = input.readUInt16BE(next) * 2;
                    next += 2;
                    break;
                case 0xdf:
                    children = input.readUInt32BE(next) * 2;
                    next += 4;
                    break;
                default: throw new Error(`Unsupported MessagePack tag ${tag}`);
            }
        for (let i = 0; i < children; i++)
            next = walk(next);
        return next;
    }
    let position = 0;
    while (position < end)
        position = walk(position);
    if (position !== end)
        throw new Error("Truncated MessagePack response");
    if (!output)
        return input;
    written += input.copy(output, written, copiedThrough);
    return output.subarray(0, written);
}
exports.fixUint32Tags = fixUint32Tags;
function encodeCnResponse(input) {
    return __awaiter(this, void 0, void 0, function* () {
        let start = node_perf_hooks_1.performance.now();
        const packed = input.packedPayload
            ? Buffer.isBuffer(input.packedPayload) ? input.packedPayload : Buffer.from(input.packedPayload)
            : (0, msgpackr_1.pack)(input.payload);
        const packMs = node_perf_hooks_1.performance.now() - start;
        start = node_perf_hooks_1.performance.now();
        const fixed = fixUint32Tags(packed);
        const fixMs = node_perf_hooks_1.performance.now() - start;
        start = node_perf_hooks_1.performance.now();
        const base64 = fixed.toString("base64");
        const base64Ms = node_perf_hooks_1.performance.now() - start;
        let compressionError = false;
        let compressionResult;
        start = node_perf_hooks_1.performance.now();
        if (input.compression) {
            try {
                compressionResult = yield (0, cn_load_http_compression_1.compressCnLoadHttpBody)(Buffer.from(base64, "ascii"), input.compression.acceptEncoding, input.compression.config);
            }
            catch (_a) {
                compressionError = true;
            }
        }
        const compression = compressionResult ? {
            encoding: compressionResult.encoding,
            originalBytes: compressionResult.originalBytes,
            wireBytes: compressionResult.wireBytes,
            reason: compressionResult.reason,
        } : undefined;
        return {
            body: (compressionResult === null || compressionResult === void 0 ? void 0 : compressionResult.encoding) ? compressionResult.body : base64,
            compression,
            compressionError,
            timings: { packMs, fixMs, base64Ms, compressWaitMs: input.compression ? node_perf_hooks_1.performance.now() - start : 0 },
        };
    });
}
exports.encodeCnResponse = encodeCnResponse;
