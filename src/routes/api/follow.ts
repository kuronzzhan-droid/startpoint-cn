/**
 * 好友（关注·关注者）页的服务端端点。
 *
 * ── 现状：方案已中止，这里只保留「让好友页不报错」的最小实现 ──────
 * 2026-08-27 曾把这个页面征用成游戏内深渊连战排行榜，阶段 1（假数据点亮界面）
 * **真机验证成功**（三个页签渲染正常、行内头像/名次/成绩文案齐全、无报错）。
 * 但作者看过后拍板：他要的是**官方原生那个排行榜**，不是好友列表换皮。
 * 阶段 2/3/4（接真榜、ui_string 换皮、点行看阵容）**不做了**。
 *
 * 因此本文件现在的职责只有一条：**让好友页能正常打开、且任何控件都写不坏状态**。
 *   - `follow/lists` 默认返回**空列表** —— 好友页显示原本的空态文案，
 *     不再出现莫名其妙的「测试玩家1~10」。
 *   - `sns/get` 必须留着：加载链是两段式，缺它界面根本进不去。
 *   - `follow/bulk_edit` 必须留着：行内「关注」勾选框会打它，缺它吃 404。
 *     它是**幂等 no-op**，收下即忽略，一个字节都不落库。
 * 排行榜骨架代码保留为未启用通路（`WF_RUSH_FOLLOW_BOARD_DEMO=1` 可复现阶段 1 的假数据），
 * 供将来若重启这条路线时复用。完整勘探与阶段 1 结论见
 * work/agent-coordination/rush-leaderboard-20260827.md 第三十七节。
 *
 * ── 以下是当初的设计说明（保留备查）────────────────────────────
 *
 * ── 为什么是这个界面 ────────────────────────────────────────
 * 客户端里那个真正的「玩家名次列表」场景在这一版被裁掉了（连布局资源一起没了，
 * 见 work/agent-coordination/rush-leaderboard-20260827.md 第十七、三十二节）。
 * 全树扫下来，**同时满足「行里有名次 + 有头像 + 有玩家名 + 有数值，且数据来自服务端」
 * 的只有好友列表一个**。它天生就是排行榜的形状，入口已在主菜单且无门控，
 * 一行客户端代码都不用改。勘探全文见
 * mod-tools/docs/游戏内排行榜界面-可行性勘探-20260827.md。
 *
 * ── 三个关键机制 ────────────────────────────────────────────
 * 1. 行标题是带占位符的模板 `follow_info_player_name = 'RANK::rank:: ::name::'`，
 *    改 ui_string 就能变成「第N名 xxx」（阶段 3 做，改 CDN 主表不碰 APK）。
 * 2. `comment` 是服务端自由字符串，原样渲染 —— 成绩正文写这里。
 * 3. 客户端会自己排序，但两个比较器的排序键都由服务端喂：
 *      orderCriteria=0（出厂默认）→ last_login_time 降序
 *      orderCriteria=1            → rank 升序
 *    所以把 `last_login_time` 设成 `基准秒 − 名次`，**两种排序同序**，
 *    玩家在排序对话框里怎么切都不会把榜切乱。
 *
 * ── 页签映射（与勘探报告一致，理由见文档）────────────────────
 *    follow_state=1 → 「互相关注」页签（**首屏**，页签顺序是 [2,0,1]）
 *    follow_state=2 → 「关注」页签
 *    follow_state=3 → 「关注者」页签 —— **刻意不用**：该桶的预排序
 *      `compareForFollowerList` 在 `followed_time` 为 null 时直接抛 ClientError 2820。
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { generateDataHeaders, getServerTime } from "../../utils";

/** 客户端 `follow/lists` 每行必须齐备的 14 个字段，缺一个就抛 8700/8702/8707。 */
export interface FollowInfoRow {
    viewer_id: number
    name: string
    rank: number
    last_login_time: number
    comment: string
    leader_character_id: number
    leader_character_evolution_img_level: number
    degree_id: number
    follow_state: number
    role: number | null
    profile_image_url: string | null
    follow_time: number | null
    followed_time: number | null
    last_login_region: string | null
}

/** 首屏页签（互相关注）。 */
export const FOLLOW_STATE_PRIMARY = 1
/** 第二个页签（关注）。 */
export const FOLLOW_STATE_SECONDARY = 2

/**
 * 名次 → `last_login_time` 的取值公式。
 *
 * 第 1 名值最大 ⇒ `compareLastLoginTime` 降序把它排最前，与 `rank` 升序完全同序。
 * 副作用：行内第三行统一显示「1分前」（60 秒内的差值都被 clamp 成 1 分），
 * 所有行文案一致、无歧义；真正的成绩写在 comment 里。
 *
 * @param rank 名次（1 起）。
 * @param baseSeconds 基准秒;默认取当前服务器时间。
 */
export function rankToLastLoginTime(rank: number, baseSeconds?: number): number {
    return (baseSeconds ?? getServerTime()) - rank
}

/** 阶段 1 的假数据用的角色 id —— 都是主表里真实存在的 ★4，避免头像变问号。 */
const FAKE_LEADER_IDS = [1, 211001, 211002, 211003, 211004, 211005, 211006, 211007, 211008, 211009]

function fakeRows(followState: number, label: string, baseSeconds: number): FollowInfoRow[] {
    const rows: FollowInfoRow[] = []
    for (let rank = 1; rank <= 10; rank++) {
        const totalMs = 4 * 60_000 + rank * 17_000 + rank * 137
        const minutes = Math.floor(totalMs / 60_000)
        const seconds = Math.floor((totalMs % 60_000) / 1000)
        const centis = Math.floor((totalMs % 1000) / 10)
        const time = `${minutes}:${String(seconds).padStart(2, "0")}.${String(centis).padStart(2, "0")}`
        rows.push({
            // 假数据的 viewer_id 用 9xxxxx 段，和真实存档 id 不会撞
            viewer_id: 990000 + followState * 100 + rank,
            name: `测试玩家${rank}`,
            rank,
            last_login_time: rankToLastLoginTime(rank, baseSeconds),
            comment: `${label} 战斗用时 ${time} · 第 1 期`,
            leader_character_id: FAKE_LEADER_IDS[(rank - 1) % FAKE_LEADER_IDS.length]!,
            leader_character_evolution_img_level: 0,
            degree_id: 1,
            follow_state: followState,
            role: 1,
            profile_image_url: null,
            follow_time: null,
            followed_time: null,
            last_login_region: null
        })
    }
    return rows
}

/**
 * 阶段 1：两个页签各 10 行假数据。阶段 2 换成真榜查询。
 */
function buildFakeBoard(): FollowInfoRow[] {
    const base = getServerTime()
    return [
        ...fakeRows(FOLLOW_STATE_PRIMARY, "[战斗用时榜]", base),
        ...fakeRows(FOLLOW_STATE_SECONDARY, "[当轮首通榜]", base)
    ]
}

/**
 * 挂在 `${apiPrefix}/follow` 下的路由。
 */
const followRoutes = async (fastify: FastifyInstance) => {

    // 好友页加载链的第一跳。请求体固定是空对象 {}。
    fastify.post("/lists", async (request: FastifyRequest, reply: FastifyReply) => {
        // 阶段 0 的地面真相采集：把客户端实际发来的请求体原样记下来
        console.log(`[FOLLOW] lists: body=${JSON.stringify(request.body ?? null)}`)

        // 方案已中止：默认返回空列表，好友页走它原本的空态文案。
        // 需要复现阶段 1 的假数据时设 WF_RUSH_FOLLOW_BOARD_DEMO=1。
        const demo = (process.env.WF_RUSH_FOLLOW_BOARD_DEMO ?? "").trim()
        const rows = demo === "" || demo === "0" || demo.toLowerCase() === "false"
            ? []
            : buildFakeBoard()
        console.log(`[FOLLOW] lists: returning ${rows.length} rows${rows.length === 0 ? " (empty; board plan stopped)" : " (demo)"}`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({}),
            data: {
                follow_info: rows,
                followed_count: rows.filter(r => r.follow_state === FOLLOW_STATE_PRIMARY).length
            }
        })
    })

    // 行内那个「关注」勾选框确认后会打这里。
    // **幂等且无副作用**：收下即忽略，一个字节都不落库 —— 作者误点也不会把状态写坏。
    fastify.post("/bulk_edit", async (request: FastifyRequest, reply: FastifyReply) => {
        console.log(`[FOLLOW] bulk_edit (ignored, no-op): body=${JSON.stringify(request.body ?? null)}`)
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({}),
            // 空数组 = 没有谁超上限
            data: { max_follower_user_viewer_id_list: [] }
        })
    })
}

/**
 * 挂在 `${apiPrefix}/sns` 下的路由。
 *
 * 好友页的加载链是**两段式**:`follow/lists` 成功后紧接着打 `sns/get`
 * (`FollowFollowerUserInfoLoadingTask.as:111`)。这一条不实现,界面进不去 ——
 * 所以它虽然只是 stub,却是必需品,而且**必须挂在顶层 /sns 而不是 /follow/sns**。
 */
export const snsRoutes = async (fastify: FastifyInstance) => {
    // twitter_id 为 null ⇒ 客户端走 NoData 分支,twitterRelated=false。
    fastify.post("/get", async (request: FastifyRequest, reply: FastifyReply) => {
        console.log(`[FOLLOW] sns/get: body=${JSON.stringify(request.body ?? null)}`)
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({}),
            data: { profile_image_url: null, twitter_id: null }
        })
    })
}

export default followRoutes;
