import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { generateDataHeaders, generateViewerId } from "../../utils";
import { deleteAccountSessionsOfTypeSync, deleteDeviceBindingSync, getAccountSessionsOfTypeSync, getDeviceBindingSync, insertDeviceBindingSync, insertSessionWithToken } from "../../data/domains/session"
import { getAccountSync, insertAccountSync, updateAccountSync } from "../../data/domains/account"
import { getPlayerSync, insertDefaultPlayerSync } from "../../data/domains/player"
import { SessionType } from "../../data/types";
import { resolvePlayerIdSync, saveAccountDefaultPlayer } from "../../data/activeAccount";
import { getSession } from "../../data/domains/session";
import { buildRushLeaderboardAgreementText, buildRushNativeRankPayload } from "../../lib/rush-leaderboard-agreement";

interface CnSignupBody {
    device_id: number;
    channelNo: string;
    media?: string;
    androidId?: string;
    oaid?: string;
    mac?: string;
    terminInfo?: string;
    osVer?: string;
    storage_directory_path?: string;
    first_viewer_id?: number;
    advertise_id?: string;
}

function generateLoginToken(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let token = "";
    for (let i = 0; i < 32; i++) {
        token += chars[Math.floor(Math.random() * chars.length)];
    }
    return token;
}

const viewerIdToAccountId = new Map<number, number>();

interface GetHeaderResponseBody {
    viewer_id: number
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/get_header_response", (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GetHeaderResponseBody;
        reply.header("content-type", "application/x-msgpack");
        reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: body.viewer_id
            }),
            "data": []
        });
    });

    fastify.post("/auth", async (_request: FastifyRequest, reply: FastifyReply) => {
        reply.header("content-type", "application/x-msgpack");
        reply.status(200).send({
            data_headers: generateDataHeaders(),
            data: {}
        });
    });

    fastify.post("/signup", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as CnSignupBody;
        const udid = request.headers["udid"] as string || "unknown";
        const shortUdid = 0;
        const deviceId = body.device_id

        const loginToken = generateLoginToken();
        let accountId: number;
        let newAccount = true;
        let viewerId: number | undefined;   // set when reusing existing session

        if (!deviceId) {
            return reply.status(400).send({ error: "Missing device_id" })
        }

        // Device binding: each device gets its own account
        const binding = getDeviceBindingSync(deviceId)

        if (binding) {
            // Known device — verify account still exists
            const accountExists = getAccountSync(binding.account_id)
            if (accountExists) {
                accountId = binding.account_id
                newAccount = false
                updateAccountSync({ id: accountId, lastLoginTime: new Date() })
                // Clean all old sessions for this account, reuse first token
                const sessions = getAccountSessionsOfTypeSync(accountId, SessionType.VIEWER)
                if (sessions.length > 0) {
                    viewerId = parseInt(sessions[0].token)
                    deleteAccountSessionsOfTypeSync(accountId, SessionType.VIEWER)
                }
            } else {
                // Account was deleted — clean up stale binding and create new account
                deleteDeviceBindingSync(deviceId)
                const account = insertAccountSync({
                    appId: "wf_cn", idpAlias: "", idpCode: "leiting", idpId: "", status: "normal"
                })
                accountId = account.id
                const player = insertDefaultPlayerSync(accountId)
                saveAccountDefaultPlayer(accountId, player.id)
                insertDeviceBindingSync(deviceId, accountId)
            }
        } else {
            // New device → create account
            const account = insertAccountSync({
                appId: "wf_cn", idpAlias: "", idpCode: "leiting", idpId: "", status: "normal"
            })
            accountId = account.id
            const player = insertDefaultPlayerSync(accountId)
            saveAccountDefaultPlayer(accountId, player.id)
            insertDeviceBindingSync(deviceId, accountId)
        }

        if (!viewerId) {
            viewerId = generateViewerId()
        }
        await insertSessionWithToken({
            token: String(viewerId),
            accountId: accountId,
            type: SessionType.VIEWER,
            expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        });

        viewerIdToAccountId.set(viewerId, accountId);

        reply.header("content-type", "application/x-msgpack");
        reply.status(200).send({
            data_headers: generateDataHeaders({
                viewer_id: viewerId,
                short_udid: shortUdid,
                udid: udid,
            }),
            data: {
                login_token: loginToken,
                newAccount: newAccount ? 1 : 0,
                roleName: `Player${accountId}`,
                accountName: `Player${accountId}`,
                sign: "dummy_sign",
                createDate: new Date().toISOString(),
                serverName: "StarPoint CN",
                serverId: 1,
            }
        });
    });

    /**
     * 深渊连战排行榜的**全屏富文本页**(P2 手术 C 的服务端半边)。
     *
     * 客户端这条链整条零调用者,被我们借来当榜的宿主:
     *   `RushEventTopScene.buttonClicked` case 5
     *     -> `changeSceneWithLoading(LoadingTaskKind.TermsOfService, ChangeSceneBackKind.AddCurrent)`
     *     -> `LogicScene.resolveLoadingTask` case 40 -> `new TermsOfServiceLoadingTask()`
     *     -> `remote.toolAgreement(hook)` -> **本端点**
     *     -> `ToolAgreementRealRemote.successHandler`
     *     -> `SceneKind.RichTextData(title, terms_text)` -> 全屏可滚动富文本页
     *
     * 契约(逐字段从 `ToolAgreementRealRemote.successHandler` 反编译原文抄下来):
     *
     * | 字段 | 类型 | 可空 | 错误码 |
     * |---|---|---|---|
     * | `data` | Object(或空 Array) | 否 | 8707 |
     * | `data.terms_text` | String | **否** | 8702 |
     * | `data.terms_url` | String | 是 -> Option | 8702 |
     * | `data.required_terms_version` | Int | 是 -> Option | 8700 |
     * | `data.required_privacy_version` | Int | 是 -> Option | 8700 |
     *
     * 请求体是客户端写死的 `{}`,只有框架层附加的 `viewer_id` ——
     * 所以**服务端认得出是谁**,自身名次卡直接拼进正文。
     *
     * P4/S5 起 `data` 里的原生榜段是:
     * `rows` / `list` / `item` / `page` / `row` / `index` / `time` / `total` / `reward`
     * (契约见 `src/lib/rush-leaderboard-agreement.ts` 的 `RushNativeRankPayload`)。
     * 老包只读它认识的键,多发的键对它不可见 ⇒ P2/S1..S5 五版 APK 共用同一份服务端。
     *
     * ⚠ **副作用**:CN 里还有一条 `LinkResolver.openLink` 会走同一个
     * `SectionCommand.ToolAgreementRemote`(富文本里的「服务条款」链接)。
     * 我们自己发的富文本从不带那种链接,所以实际上够不着;真要点到,
     * 看到的会是排行榜而不是条款正文。`LoadingTaskKind.TermsOfService` 那一侧
     * 已实测**零调用者**(全 ABC 只有 `LoadingTaskKind` 自己的 initproperty)。
     */
    fastify.post("/agreement", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body ?? {}) as { viewer_id?: number | string };
        const viewerId = Number(body.viewer_id);
        const hasViewer = Number.isFinite(viewerId);

        // 认人是尽力而为:认不出就只是没有「自身名次」卡,不能因此把页面开崩。
        let playerId: number | null = null;
        if (hasViewer) {
            try {
                const session = await getSession(String(viewerId));
                if (session) playerId = resolvePlayerIdSync(session.accountId);
            } catch (error) {
                console.error("[RUSH-LB] agreement viewer resolve failed:", error);
            }
        }

        // 契约探针用的逃生门:`WF_RANK_PAGE_FORCE_NULL=1` 时把 terms_text 发成 null,
        // 真机上应当看到 ClientError 8702 —— 用来证明「契约通路是活的」,
        // 而不是碰巧没走到。平时不要开。
        const forceNull = (process.env.WF_RANK_PAGE_FORCE_NULL ?? "").trim() === "1";
        const termsText = forceNull ? null : buildRushLeaderboardAgreementText(playerId);

        // P4/S2:官方原生列表行和 P2 的富文本**同一次响应**一起发。
        // 客户端补丁 C2 让 `ToolAgreementRealRemote.successHandler` 原样透传整个
        // `data`(原本只挑 4 个字段),所以这三个键才到得了场景层。
        // P2 的包只读 terms_text,看不见这三个键 ⇒ 两版 APK 共用一份服务端。
        const native = buildRushNativeRankPayload(playerId);

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: generateDataHeaders(hasViewer ? { viewer_id: viewerId } : {}),
            data: {
                terms_text: termsText,
                terms_url: null,
                required_terms_version: null,
                required_privacy_version: null,
                rows: native.rows,
                list: native.list,
                item: native.item,
                // S4:「自身名次」圆钮要跳到的页号(0 起)。页大小 100 是客户端补丁里
                // 的一条 pushint,和 NATIVE_PAGE_SIZE 必须同值。
                page: native.page,
                // ── S5 新增 ────────────────────────────────────────────
                // row   自己在那一页里的第几行(0 起);-1 = 没上榜 ⇒ 客户端不滚
                // index 自己在整张榜里的下标(0 起);-1 = 没上榜
                // time  顶部黑条文案,已含「更新」二字
                // total 主榜截断前的总行数(去重后 = 有成绩的存档数)
                // reward 报酬档位预览(今天客户端不读,报酬走富文本页)
                row: native.row,
                index: native.index,
                time: native.time,
                total: native.total,
                reward: native.reward
            }
        });
    });
};

export default routes;
