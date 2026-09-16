/**
 * Profile API — get_my_profile.
 * Returns player profile info, settings, and party groups.
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getPlayerCharactersSync } from "../../data/domains/character"
import { getPlayerPartyGroupListSync } from "../../data/domains/party"
import { getPlayerDegreeIdsSync } from "../../data/domains/degree"
import { grantAbyssShopDegreeRewardSync } from "../../lib/abyss-shop-degree-reward"
import { grantAbyssEnduranceDegreesSync } from "../../lib/abyss-endurance-degree-reward"
import { fromProfileTargetId } from "../../lib/rush-leaderboard-native-rows"
import { buildProfileFavoriteParty } from "../../lib/rush-profile-party"
import { getRankDegree } from "../../lib/stamina"
import { getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getSession } from "../../data/domains/session"
import { resolvePlayerIdSync } from "../../data/activeAccount";
// removed getAccountPlayers "../../data/wdfpData";
import { generateDataHeaders } from "../../utils";

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/get_my_profile", async (request: FastifyRequest, reply: FastifyReply) => {
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

        const playerId = resolvePlayerIdSync(session.accountId)!
        if (playerId === null) return reply.status(400).send({
            error: "Bad Request",
            message: "No player bound to account."
        })

        const player = getPlayerSync(playerId)
        if (!player) return reply.status(400).send({ error: "Bad Request", message: "Player not found." })

        grantAbyssShopDegreeRewardSync(playerId)
        const characters = getPlayerCharactersSync(playerId)
        const charCount = Object.keys(characters).length
        // starter title (1) is always owned, granted ones stack on top
        const degreeCount = new Set([1, ...getPlayerDegreeIdsSync(playerId)]).size

        // Build party group list (map from DB format to client format)
        const partyGroups = getPlayerPartyGroupListSync(playerId)
        const partyGroupList: any[] = []

        for (const [groupId, group] of Object.entries(partyGroups)) {
            const parties = group.list || {}
            const partyList: any[] = []

            for (const [slot, party] of Object.entries(parties)) {
                const p = party as any
                partyList.push({
                    ability_soul_ids: (p.abilitySoulIds || []).map((id: number | null) => id),
                    character_ids: (p.characterIds || []).map((id: number | null) => id),
                    equipment_ids: (p.equipmentIds || []).map((id: number | null) => id),
                    options: { allow_other_players_to_heal_me: p.options?.allowOtherPlayersToHealMe ?? true },
                    party_edited: p.edited ?? false,
                    party_id: (parseInt(groupId) - 1) * 10 + parseInt(slot),
                    party_name: p.name || "",
                    unison_character_ids: (p.unisonCharacterIds || []).map((id: number | null) => id),
                })
            }

            partyGroupList.push({
                party_group_color_id: group.colorId || 15,
                party_group_id: parseInt(groupId),
                party_list: partyList,
            })
        }

        // Ensure at least one party exists for favorite character display
        if (partyGroupList.length === 0) {
            partyGroupList.push({
                party_group_color_id: 15,
                party_group_id: 1,
                party_list: [{
                    ability_soul_ids: [null, null, null],
                    character_ids: [player.leaderCharacterId || 1, null, null],
                    equipment_ids: [null, null, null],
                    options: { allow_other_players_to_heal_me: true },
                    party_edited: false,
                    party_id: 1,
                    party_name: "Party A",
                    unison_character_ids: [null, null, null],
                }]
            })
        }

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {
                profile_info: {
                    max_opened_mana_board_second_count: 0,
                    max_owned_character_count: charCount,
                    max_owned_degree_count: degreeCount,
                    opened_mana_board_second_count: 0,
                    owned_character_count: charCount,
                    owned_degree_count: degreeCount,
                },
                profile_settings: {
                    show_opened_mana_board_second_count: false,
                    show_owned_character_count: true,
                    show_owned_degree_count: true,
                },
                user_party_group_list: partyGroupList,
            }
        })
    })

    // Returns the player's last login region (CN-specific)
    fastify.post("/get_last_login_region", async (request: FastifyRequest, reply: FastifyReply) => {
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

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {
                region: "CN",
            }
        })
    })

    // Returns owned degree IDs for title selection
    fastify.post("/get_degree_list", async (request: FastifyRequest, reply: FastifyReply) => {
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

        const playerId = resolvePlayerIdSync(session.accountId)!
        const player = playerId !== null ? getPlayerSync(playerId) : null
        const degreeId = player?.degreeId || 1
        if (player) grantAbyssShopDegreeRewardSync(playerId)
        if (player) grantAbyssEnduranceDegreesSync(playerId)

        // The client builds the whole degree-select list out of this array
        // (DegreeSelectLoadingTask), so it is the only place ownership lives:
        // starter title + whatever was granted + whatever is currently worn.
        const owned = playerId !== null ? getPlayerDegreeIdsSync(playerId) : []
        const degreeIds = Array.from(new Set([1, ...owned, degreeId]))

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {
                degree_ids: degreeIds,
            }
        })
    })

    // Set the player's displayed degree title
    fastify.post("/update_degree", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const viewerId = body.viewer_id
        const degreeId = body.degree_id
        if (!viewerId || isNaN(viewerId) || degreeId === undefined || isNaN(degreeId)) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid request body."
            })
        }

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(session.accountId)!
        if (playerId === null) return reply.status(500).send({
            error: "Internal Server Error",
            message: "No player bound to account."
        })

        const player = getPlayerSync(playerId)
        if (!player) return reply.status(500).send({
            error: "Internal Server Error",
            message: "Player not found."
        })

        updatePlayerSync({ id: playerId, degreeId: Number(degreeId) })

        console.log(`[PROFILE] update_degree viewer=${viewerId} degree=${degreeId}`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {
                user_info: { degree_id: Number(degreeId) }
            }
        })
    })

    // Update profile visibility settings (echo back, don't persist)
    fastify.post("/update_profile_settings", async (request: FastifyRequest, reply: FastifyReply) => {
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

        const settings = body.profile_settings || {}
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {
                profile_settings: {
                    show_opened_mana_board_second_count: settings.show_opened_mana_board_second_count ?? false,
                    show_owned_character_count: settings.show_owned_character_count ?? false,
                    show_owned_degree_count: settings.show_owned_degree_count ?? false,
                }
            }
        })
    })

    // Update profile comment
    fastify.post("/update_comment", async (request: FastifyRequest, reply: FastifyReply) => {
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

        const playerId = resolvePlayerIdSync(session.accountId)!
        if (playerId === null) return reply.status(400).send({
            error: "Bad Request",
            message: "No player bound to account."
        })

        const comment = (body.comment || "").substring(0, 100)
        updatePlayerSync({ id: playerId, comment })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: { comment },
        })
    })

    // Rename player
    fastify.post("/rename", async (request: FastifyRequest, reply: FastifyReply) => {
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

        const playerId = resolvePlayerIdSync(session.accountId)!
        if (playerId === null) return reply.status(400).send({
            error: "Bad Request",
            message: "No player bound to account."
        })

        const name = (body.name || "").substring(0, 20)
        updatePlayerSync({ id: playerId, name })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: { name },
        })
    })

    /**
     * 别人的个人资料 —— **点排行榜某一行**落到的那一屏(P4/S5)。
     *
     * ── 客户端链路(全是活代码,没有一处是我们补的)────────────────────
     *   榜行点击 → `LoadingTaskKind.ProfileGetProfile(id)`(index 23)
     *     → `LogicScene.resolveLoadingTask` case 23(`LogicScene.as:2294`)
     *     → `ProfileGetProfileLoadingTask`(`pinball/loading/follow/…as:52-66`)
     *     → `ProfileGetProfileRealRemote`:`startUserRequest("profile/get_profile",
     *        {"target_viewer_id": <id>})`(`…as:24`)
     *     → `remoteInput` → `SceneKind.PlayerProfile(ProfileKind.Other(data), false)`
     *     → `PlayerProfileScene` + `OtherProfileLogic`(两个类在 CN 都活着)
     *
     * ── `target_viewer_id` 是什么 ──────────────────────────────────────
     * 客户端只搬运,不解释。榜行发的是 `RUSH_PROFILE_ID_BASE(9e9) + player_id`
     * (见 `rush-leaderboard-native-rows.ts` 的 `toProfileTargetId`)——
     * 因为榜行的身份是**存档**,而 viewer_id 只认账号,一个账号可以有多个存档。
     * 真实 viewer_id 是 9 位数,落在 9e9 之下,两个区间不相交,所以本端点
     * **同时**吃得下这两种输入:先按榜行命名空间解,解不出再按 viewer 会话解。
     *
     * ── 契约(逐字段抄自 `ProfileGetProfileRealRemote.successHandler`)──────
     * 每一个字段都有类型硬校验,错一个就是 ClientError:
     *   8700 Int / 8701 Float / 8702 String / 8704 Array / 8707 Object。
     * `favorite_character` 的四个数组**长度必须是 3**(客户端按槽位读),
     * 元素允许为 `null`(→ `Option.None`)。
     * `target_user_info.viewer_id` 必须是 **Float**(Number),不是 Int。
     *
     * ── 「常用编队」取哪一支 ───────────────────────────────────────────
     * 取该存档**当前选中的那一队**(`players.party_slot`,编码
     * `group = ⌊(slot-1)/10⌋+1`、`slot = (slot-1)%10+1`,与
     * `data/validation/merged-player.ts:250-252` 同一套解码)。
     * 这就是官方「常用编队」的语义;那一程实际用的队伍在榜行的三个头像上已经有了。
     *
     * ── 槽 0 是硬约束(20260828 复核抓到的必崩路径)────────────────────
     * `character_ids[0]` 为 null ⇒ `OtherProfileLogic.getLeaderFullShotImageId`
     * 直接 `throw "No Value(...)"`(`OtherProfileLogic.as:308-323`),而
     * `PlayerProfileView.registerButtons` 的 Other 分支(`:640/:701/:826` 三条
     * follow_state 路径**全都**走)无条件调它 —— **整屏抛异常,没有绕路**。
     * 其余五个槽位都是 `Option.None`-safe 的。
     *
     * 投影规则(成对左压缩 / 队长角色 / 已拥有角色 三级兜底)全在
     * `src/lib/rush-profile-party.ts`,那里有可单测的纯函数和完整判据。
     *
     * ── 逃生门 ────────────────────────────────────────────────────────
     * `WF_RUSH_PROFILE_CHARACTERS=0` ⇒ **只发一个**能开起这一屏的角色,编队不发。
     * (旧语义是「六个槽全发 null」,那会让**每一行都必崩** —— 是加重不是止血,
     *  20260828 复核后改成本条。发「零个角色」在客户端是做不到的。)
     * 个人资料页会拿 `character_ids[0]` 去画立绘(full_shot),万一某个自制角色
     * 缺 full_shot 会弹「数据不足」(拉去重下资源,不是崩)。
     */
    fastify.post("/get_profile", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body ?? {}) as { viewer_id?: number, target_viewer_id?: number }
        const viewerId = body.viewer_id
        const targetRaw = Number(body.target_viewer_id)
        if (!Number.isFinite(targetRaw)) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid target_viewer_id."
        })

        // ① 榜行命名空间(9e9 + player_id);② 退回真实 viewer 会话
        let targetPlayerId = fromProfileTargetId(targetRaw)
        if (targetPlayerId === null) {
            try {
                const targetSession = await getSession(String(Math.trunc(targetRaw)))
                if (targetSession) targetPlayerId = resolvePlayerIdSync(targetSession.accountId)
            } catch (error) {
                console.error("[PROFILE] target viewer resolve failed:", error)
            }
        }

        const player = targetPlayerId === null ? null : getPlayerSync(targetPlayerId)
        if (player === null || targetPlayerId === null) return reply.status(400).send({
            error: "Bad Request",
            message: "Unknown target player."
        })

        const characters = getPlayerCharactersSync(targetPlayerId)
        const charCount = Object.keys(characters).length
        const degreeCount = new Set([1, ...getPlayerDegreeIdsSync(targetPlayerId)]).size

        // 常用编队 = 当前选中的那一队
        let rawMains: (number | null)[] = [null, null, null]
        let rawUnisons: (number | null)[] = [null, null, null]
        try {
            const slot = Math.max(1, Math.trunc(player.partySlot || 1))
            const groupId = String(Math.floor((slot - 1) / 10) + 1)
            const partySlot = String(((slot - 1) % 10) + 1)
            const groups = getPlayerPartyGroupListSync(targetPlayerId)
            const group = groups[groupId] ?? Object.values(groups)[0]
            const list = (group?.list ?? {}) as Record<string, any>
            const party = list[partySlot] ?? Object.values(list)[0]
            if (party) {
                rawMains = [0, 1, 2].map(i => party.characterIds?.[i] ?? null)
                rawUnisons = [0, 1, 2].map(i => party.unisonCharacterIds?.[i] ?? null)
            }
        } catch (error) {
            console.error("[PROFILE] favorite party build failed:", error)
        }

        // 主表里不认识的角色 ID 降级成空位(ClientError 8013),**但槽 0 不许为空**
        // —— 空了客户端直接抛。三级兜底全在 buildProfileFavoriteParty 里。
        const favorite = buildProfileFavoriteParty({
            mains: rawMains,
            unisons: rawUnisons,
            leaderCharacterId: player.leaderCharacterId ?? null,
            ownedCharacterIds: Object.keys(characters).map(Number),
            leaderOnly: (process.env.WF_RUSH_PROFILE_CHARACTERS ?? "").trim() === "0"
        })

        // 一个可下发角色都没有(空存档)。发一份必抛的响应不如明说 ——
        // 客户端对 HTTP 错误只弹一个提示框,不写坏任何状态。
        if (favorite === null) {
            console.warn(`[PROFILE] no shippable leader for player ${targetPlayerId}`)
            return reply.status(400).send({
                error: "Bad Request",
                message: "Target player has no shippable character."
            })
        }

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders(
                viewerId && !isNaN(viewerId) ? { viewer_id: viewerId } : {}),
            data: {
                favorite_character: {
                    // 长度恒 3;null ⇒ Option.None。EX Boost 一律不发(客户端接受 null)。
                    character_ids: favorite.mains,
                    character_ex_boost: [null, null, null],
                    unison_character_ids: favorite.unisons,
                    unison_character_ex_boost: [null, null, null],
                },
                target_user_info: {
                    comment: player.comment ?? "",
                    degree_id: player.degreeId ?? 1,
                    // 0 = 互不关注。关注按钮会打 follow/* ——本机单人服,按不按都无所谓,
                    // 真按了吃 404 也只是一个提示框,不写坏任何状态。
                    follow_state: 0,
                    last_login_region: null,
                    leader_character_full_shot_evolution_level: 0,
                    max_opened_mana_board_second_count: 0,
                    max_owned_character_count: charCount,
                    max_owned_degree_count: degreeCount,
                    name: player.name ?? `存档${targetPlayerId}`,
                    opened_mana_board_second_count: 0,
                    owned_character_count: charCount,
                    owned_degree_count: degreeCount,
                    rank: getRankDegree(player.rankPoint),
                    role: player.role ?? 1,
                    // **必须是 Float** —— Int 会抛 ClientError 8701
                    viewer_id: Number(targetRaw),
                },
            }
        })
    })
}

export default routes
