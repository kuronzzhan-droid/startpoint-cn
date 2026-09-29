import { createHash } from "node:crypto"

export const GAME_CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/
export const TEAM_GROUPS = ["main", "unison", "weapon", "soul"] as const
export type PublicTeam = Record<typeof TEAM_GROUPS[number], string[]>
export interface TeamCodePayload { title: string; active: true; team: PublicTeam }
export class TeamCodeError extends Error {
    constructor(readonly kind: "not-found" | "unavailable" | "incompatible") { super(kind) }
}
export function wikiPublicId(kind: "c" | "w", id: string | number): string {
    return kind + createHash("sha256").update(`wf-wiki-public-v1:${kind}:${id}`).digest("hex").slice(0, 12)
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value)
export function parseTeamCodePayload(value: unknown): TeamCodePayload {
    if (!record(value) || Object.keys(value).sort().join() !== "active,team,title" || value.active !== true ||
        typeof value.title !== "string" || !value.title.trim() || [...value.title].length > 80 ||
        /[\u0000-\u001f\u007f]/.test(value.title) || !record(value.team) ||
        Object.keys(value.team).sort().join() !== "main,soul,unison,weapon") throw new TeamCodeError("incompatible")
    const team = {} as PublicTeam, seen = new Set<string>()
    for (const group of TEAM_GROUPS) {
        const ids = value.team[group], isCharacter = group === "main" || group === "unison"
        if (!Array.isArray(ids) || ids.length !== 3) throw new TeamCodeError("incompatible")
        team[group] = ids.map((id) => {
            if (id === "" && group !== "main") return ""
            if (typeof id !== "string" || !(isCharacter ? /^c[0-9a-f]{12}$/ : /^w[0-9a-f]{12}$/).test(id) ||
                (isCharacter && seen.has(id))) throw new TeamCodeError("incompatible")
            if (isCharacter) seen.add(id)
            return id
        })
    }
    return {title: value.title, active: true, team}
}
export function teamCodeBaseUrl(raw: string | undefined): URL {
    let url: URL
    try { url = new URL(raw || "") } catch { throw new TeamCodeError("unavailable") }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password ||
        url.search || url.hash || !url.pathname.endsWith("/api/community/game-codes")) throw new TeamCodeError("unavailable")
    return url
}
export class TeamCodeLimiter {
    private entries = new Map<string, {start: number; count: number}>()
    take(key: string, limit: number, now = Date.now()): boolean {
        for (const [name, entry] of this.entries) if (now - entry.start >= 60_000) this.entries.delete(name)
        const entry = this.entries.get(key)
        if (!entry) {
            if (this.entries.size >= 10_000) return false
            this.entries.set(key, {start: now, count: 1}); return true
        }
        if (entry.count >= limit) return false
        entry.count++; return true
    }
}
export function createTeamCodeClient(options: {fetcher?: typeof fetch; now?: () => number; url?: () => string | undefined} = {}) {
    const fetcher = options.fetcher || fetch, now = options.now || Date.now
    const cache = new Map<string, {expires: number; value: TeamCodePayload}>()
    return async (code: string): Promise<TeamCodePayload> => {
        if (!GAME_CODE_PATTERN.test(code)) throw new TeamCodeError("not-found")
        const base = teamCodeBaseUrl((options.url || (() => process.env.COMMUNITY_TEAM_CODES_URL))())
        const key = `${base.href}/${code}`, cached = cache.get(key)
        if (cached && cached.expires > now()) return cached.value
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000)
        try {
            const response = await fetcher(key, {headers: {Accept: "application/json"}, redirect: "error", signal: controller.signal})
            if (response.status === 404 || response.status === 410) throw new TeamCodeError("not-found")
            if (!response.ok || !response.headers.get("content-type")?.includes("application/json") ||
                Number(response.headers.get("content-length")) > 16_384 || !response.body) throw new TeamCodeError("unavailable")
            const reader = response.body.getReader(), chunks: Uint8Array[] = []
            let size = 0
            try {
                while (true) {
                    const part = await reader.read(); if (part.done) break
                    size += part.value.length
                    if (size > 16_384) {await reader.cancel(); throw new TeamCodeError("unavailable")}
                    chunks.push(part.value)
                }
            } finally { reader.releaseLock() }
            const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"))
            if (record(raw) && raw.active === false) throw new TeamCodeError("not-found")
            const value = parseTeamCodePayload(raw)
            for (const [name, entry] of cache) if (entry.expires <= now()) cache.delete(name)
            if (cache.size >= 500) cache.delete(cache.keys().next().value!)
            cache.set(key, {expires: now() + 5000, value})
            return value
        } catch (error) {throw error instanceof TeamCodeError ? error : new TeamCodeError("unavailable")}
        finally {clearTimeout(timer)}
    }
}
