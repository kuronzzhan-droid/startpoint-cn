// Optional diagnostics: record every inbound battle frame (the players' input
// stream) per room generation as JSONL, so a desynced co-op fight can be
// replayed offline. Off unless MULTI_RELAY_RECORD_DIR is set. The battle relay
// child keeps its own copy because it is transpiled standalone.
import * as fs from "fs"
import * as path from "path"

const RECORD_DIR = process.env.MULTI_RELAY_RECORD_DIR || ""
const parsedMax = Number.parseInt(process.env.MULTI_RELAY_RECORD_MAX_MB ?? "", 10)
const RECORD_MAX_BYTES = (Number.isFinite(parsedMax) ? Math.max(1, parsedMax) : 2048) * 1024 * 1024
const streams = new Map<string, { stream: fs.WriteStream; lastAt: number }>()
let recordedBytes = 0

export function recordBattleFrame(roomNumber: string | undefined, generation: number | undefined,
    viewerId: number | undefined, connectionId: string | undefined, data: unknown): void {
    if (!RECORD_DIR || roomNumber === undefined || recordedBytes > RECORD_MAX_BYTES) return
    try {
        const now = Date.now()
        const key = `${roomNumber}-g${generation ?? 0}`
        let record = streams.get(key)
        if (!record) {
            fs.mkdirSync(RECORD_DIR, { recursive: true })
            const day = new Date(now).toISOString().slice(0, 10)
            record = { stream: fs.createWriteStream(path.join(RECORD_DIR, `${day}-room${key}.jsonl`), { flags: "a" }), lastAt: now }
            record.stream.on("error", () => {})
            streams.set(key, record)
        }
        record.lastAt = now
        const line = JSON.stringify({ t: now, v: viewerId, cid: connectionId, f: data }) + "\n"
        recordedBytes += line.length
        record.stream.write(line)
    } catch {}
}

if (RECORD_DIR) {
    setInterval(() => {
        const now = Date.now()
        for (const [key, record] of streams) {
            if (now - record.lastAt < 300_000) continue
            record.stream.end()
            streams.delete(key)
        }
    }, 60_000).unref()
}
