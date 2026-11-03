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
const node_worker_threads_1 = require("node:worker_threads");
const cn_response_encoding_1 = require("../lib/cn-response-encoding");
const memory_diagnostics_1 = require("../lib/memory-diagnostics");
let completed = 0;
(0, memory_diagnostics_1.installWorkerMemoryProbe)(() => ({ completed }));
node_worker_threads_1.parentPort === null || node_worker_threads_1.parentPort === void 0 ? void 0 : node_worker_threads_1.parentPort.on("message", (message) => __awaiter(void 0, void 0, void 0, function* () {
    if (message.type !== "encode")
        return;
    try {
        const result = yield (0, cn_response_encoding_1.encodeCnResponse)(message.input);
        completed++;
        node_worker_threads_1.parentPort.postMessage({ type: "encoded", id: message.id, result });
    }
    catch (_a) {
        node_worker_threads_1.parentPort.postMessage({ type: "encoded", id: message.id, error: true });
    }
}));
