/**
 * News / Announcement API.
 * Exact format from CN client decompiled code:
 *   NewsIndexRealRemote.as — expects { current_page, news, news_count }
 *   NewsGetInfoRealRemote.as — expects { id, title, date, html, label, thumbnail, added_time, thumbnail_path }
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSession } from "../../data/domains/session"
import { generateDataHeaders } from "../../utils";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { buildRushLeaderboardNewsItems } from "../../lib/rush-leaderboard-news";
import { readFileSync } from "fs";
import path from "path";

interface NewsItem {
    id: number
    title: string
    date: string
    label: number
    thumbnail: number
    thumbnail_path: string | null
    added_time: string | null
    html: string
}

function loadNews(): NewsItem[] {
    try {
        const raw = readFileSync(path.join(__dirname, "..", "..", "..", "assets", "news.json"), "utf-8")
        const items = JSON.parse(raw) as any[]
        // Ensure all required fields exist
        return items.map((n: any) => ({
            id: n.id,
            title: n.title || "",
            date: n.date || new Date().toISOString().replace("T", " ").substring(0, 19),
            label: n.label || 1,
            thumbnail: n.thumbnail || 1,
            thumbnail_path: n.thumbnail_path || null,
            added_time: n.added_time || null,
            html: n.html || "",
        }))
    } catch {
        return []
    }
}

/**
 * 公告列表 = **动态生成的排行榜公告** + `assets/news.json` 里的静态公告。
 *
 * 排行榜那两条排在最前面(公告列表按数组顺序渲染),正文在每次请求时现查数据库,
 * 不落盘。生成器自己吞异常并退回空数组 —— 榜挂了也只是少两条公告,静态公告照常出。
 *
 * @param accountId 会话所属账号;用来解析出「正在看公告的存档」,把自身名次置顶高亮。
 * @returns 合并后的公告列表。
 */
function loadAllNews(accountId: number): NewsItem[] {
    let playerId: number | null = null
    try {
        playerId = resolvePlayerIdSync(accountId)
    } catch (error) {
        console.error("[NEWS] viewer player resolve failed:", error)
    }
    return [...buildRushLeaderboardNewsItems(playerId), ...loadNews()]
}

const routes = async (fastify: FastifyInstance) => {
    // News list (paginated by page_index, category)
    fastify.post("/index", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid request body."
        })

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid viewer id."
        })

        const allNews = loadAllNews(session.accountId)
        const page = body.page_index || body.current_page || 1
        const perPage = 20
        const start = (page - 1) * perPage
        const items = allNews.slice(start, start + perPage)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {
                current_page: page,
                news: items.map(n => ({
                    id: n.id,
                    title: n.title,
                    date: n.date,
                    html: n.html,
                    label: n.label,
                    thumbnail: n.thumbnail,
                    thumbnail_path: n.thumbnail_path,
                    added_time: n.added_time,
                })),
                news_count: allNews.length,
            }
        })
    })

    // Single news detail
    fastify.post("/get_info", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid request body."
        })

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid viewer id."
        })

        const allNews = loadAllNews(session.accountId)
        const news = allNews.find(n => n.id === body.news_id)
        if (!news) return reply.status(400).send({
            error: "Bad Request",
            message: `News with id '${body.news_id}' not found.`
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {
                id: news.id,
                title: news.title,
                date: news.date,
                html: news.html,
                label: news.label,
                thumbnail: news.thumbnail,
                thumbnail_path: news.thumbnail_path,
                added_time: news.added_time,
            }
        })
    })

    // System news index (same format, different endpoint)
    fastify.post("/system_index", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." })
        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: { current_page: 1, news: [], news_count: 0 }
        })
    })

    // System news detail (same format, different endpoint)
    fastify.post("/get_system_info", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." })
        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {}
        })
    })

    // Latest forced news popup — return empty (no forced popup)
    fastify.post("/latest_forced", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." })
        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {}
        })
    })

    // System forced news — return empty
    fastify.post("/latest_forced_system", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." })
        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {}
        })
    })
}

export default routes
