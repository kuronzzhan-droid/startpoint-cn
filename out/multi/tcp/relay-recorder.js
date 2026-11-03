"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordBattleFrame = void 0;
// Optional diagnostics: record every inbound battle frame (the players' input
// stream) per room generation as JSONL, so a desynced co-op fight can be
// replayed offline. Off unless MULTI_RELAY_RECORD_DIR is set. The battle relay
// child keeps its own copy because it is transpiled standalone.
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const RECORD_DIR = process.env.MULTI_RELAY_RECORD_DIR || "";
const parsedMax = Number.parseInt((_a = process.env.MULTI_RELAY_RECORD_MAX_MB) !== null && _a !== void 0 ? _a : "", 10);
const RECORD_MAX_BYTES = (Number.isFinite(parsedMax) ? Math.max(1, parsedMax) : 2048) * 1024 * 1024;
const streams = new Map();
let recordedBytes = 0;
function recordBattleFrame(roomNumber, generation, viewerId, connectionId, data) {
    if (!RECORD_DIR || roomNumber === undefined || recordedBytes > RECORD_MAX_BYTES)
        return;
    try {
        const now = Date.now();
        const key = `${roomNumber}-g${generation !== null && generation !== void 0 ? generation : 0}`;
        let record = streams.get(key);
        if (!record) {
            fs.mkdirSync(RECORD_DIR, { recursive: true });
            const day = new Date(now).toISOString().slice(0, 10);
            record = { stream: fs.createWriteStream(path.join(RECORD_DIR, `${day}-room${key}.jsonl`), { flags: "a" }), lastAt: now };
            record.stream.on("error", () => { });
            streams.set(key, record);
        }
        record.lastAt = now;
        const line = JSON.stringify({ t: now, v: viewerId, cid: connectionId, f: data }) + "\n";
        recordedBytes += line.length;
        record.stream.write(line);
    }
    catch (_a) { }
}
exports.recordBattleFrame = recordBattleFrame;
if (RECORD_DIR) {
    setInterval(() => {
        const now = Date.now();
        for (const [key, record] of streams) {
            if (now - record.lastAt < 300000)
                continue;
            record.stream.end();
            streams.delete(key);
        }
    }, 60000).unref();
}
