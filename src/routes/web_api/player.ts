import { getPlayerBusinessDateSync, getPlayerBusinessOffsetSync } from "../../lib/player-time-compat"
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { validatePlayerField, VALID_CHARACTER_IDS, VALID_ITEM_IDS, MAX_INT } from "./validation";
import { wantsJson } from "./http";
import { dailyResetPlayerDataSync, getAllPlayersSync, getDefaultPlayerPartyGroupsSync, getPlayerDailyChallengePointListSync, getPlayerSync, insertPlayerDailyChallengePointListSync, updatePlayerDailyChallengePointSync, updatePlayerSync } from "../../data/domains/player"
import { deleteAllPlayerMailSync } from "../../data/domains/mail"
import { getDb } from "../../data/db"
import { getPlayerCharactersSync, insertDefaultPlayerCharacterSync, insertPlayerCharacterSync } from "../../data/domains/character"
import { getPlayerEquipmentListSync } from "../../data/domains/equipment"
import { getPlayerItemsSync, setPlayerItemSync, updatePlayerItemSync } from "../../data/domains/item"
import { getPlayerQuestProgressSync, getPlayerDrawnQuestsSync } from "../../data/domains/quest"
import { insertPlayerPartyGroupListSync } from "../../data/domains/party"
import { PartyCategory } from "../../data/types";
import { buildPeriodicSnapshotData, takeSnapshot } from "../../lib/mission/snapshot";
import { deletePlayerCategoryMissionsSync } from "../../data/domains/mission";
import { getServerDate, getTimeOffset } from "../../utils";
import dailyChallengePointLookup from "../../../assets/daily_challenge_point_lookup.json";
import {
    getUnisonUnlockRepairStatusSync,
    repairUnisonUnlockProgressSync,
} from "../../lib/validate/unison-unlock";
import {
    createPlayerSaveSnapshotV2Sync,
    ExBoostImportConflictError,
    isPlayerSaveSnapshotV2,
    restorePlayerSaveSnapshotV2Sync,
    validatePlayerSaveSnapshotV2Sync,
} from "../../data/snapshots/player-snapshot";
import { cleanupPlayerImportBackups, createPlayerImportSnapshotBackup } from "../../lib/admin-database-backup";
import {
    DEFAULT_PLAYER_SAVE_EXPORT_MAX_BYTES,
    exportPlayerSaveInWorker,
    closePlayerSaveExports,
    PlayerSaveExportError,
} from "../../lib/player-save-export";
import { hijackUnavailableReply } from "../../lib/http-reply";
import { runPersistenceTransaction, runPersistenceTransactionSync } from "../../lib/persistence-coordinator";
import { ServerClosingError } from "../../lib/shutdown-state";
import { isPersistenceAdmissionError } from "../../lib/persistence-admission";

interface SaveQuery {
    id: string | undefined
}

interface GetPlayersQuery {
    page: string | undefined,
    perPage: string | undefined
}

const defaultPerPage = 25
const maxSaveUploadBytes = DEFAULT_PLAYER_SAVE_EXPORT_MAX_BYTES

function applyPlayerImportBackupRetention(directory: string) {
    try {
        return cleanupPlayerImportBackups(directory, 5)
    } catch (error) {
        return {
            retainedBackups: null,
            removedBackups: 0,
            backupCleanupError: error instanceof Error ? error.message : String(error),
        }
    }
}

const routes = async (fastify: FastifyInstance) => {
    fastify.addHook("onClose", async () => { await closePlayerSaveExports(); });
    fastify.get("/", async (request: FastifyRequest, reply: FastifyReply) => {
        const { page, perPage } = request.query as GetPlayersQuery
        const parsedPage = page === undefined ? 0 : Number.parseInt(page)
        const parsedPerPage = perPage === undefined ? defaultPerPage : Number.parseInt(perPage)
        if (isNaN(parsedPage) || isNaN(parsedPerPage)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid query parameters."
        })

        const players = getAllPlayersSync(parsedPage * parsedPerPage, Math.min(defaultPerPage, parsedPerPage))
        return reply.status(200).send(players)
    })

    fastify.get("/:id/detail", async (request: FastifyRequest, reply: FastifyReply) => {
        const playerId = Number((request.params as any).id)
        if (isNaN(playerId)) return reply.status(400).send({ error: "Invalid player ID" })

        const requestedSection = (request.query as { section?: unknown }).section
        const sections = ["player", "characters", "items", "equipment", "questProgress", "drawnQuests"]
        if (requestedSection !== undefined && (typeof requestedSection !== "string" || !sections.includes(requestedSection))) {
            return reply.status(400).send({ error: "Invalid detail section" })
        }
        // No query retains the complete legacy response and its quest maintenance.
        const includes = (section: string) => requestedSection === undefined || requestedSection === section

        const player = getPlayerSync(playerId)
        if (!player) return reply.status(404).send({ error: "Player not found" })

        const result: Record<string, unknown> = {}
        if (includes("player")) result.player = {
            id: player.id,
            accountId: (getDb().prepare(`SELECT account_id FROM players WHERE id = ?`).get(player.id) as { account_id: number } | undefined)?.account_id ?? 0,
            name: player.name,
            comment: player.comment,
            stamina: player.stamina,
            boostPoint: player.boostPoint,
            bossBoostPoint: player.bossBoostPoint,
            vmoney: player.vmoney,
            freeVmoney: player.freeVmoney,
            freeMana: player.freeMana,
            paidMana: player.paidMana,
            rankPoint: player.rankPoint,
            starCrumb: player.starCrumb,
            bondToken: player.bondToken,
            expPool: player.expPool,
            degreeId: player.degreeId,
            leaderCharacterId: player.leaderCharacterId,
            birth: player.birth,
            enableAuto3x: player.enableAuto3x,
            tutorialStep: player.tutorialStep,
            lastLoginTime: player.lastLoginTime.toISOString(),
            staminaHealTime: player.staminaHealTime.toISOString(),
            expPooledTime: player.expPooledTime.toISOString(),
            timeOffset: player.timeOffset ?? null,
        }
        if (includes("characters")) result.characters = Object.entries(getPlayerCharactersSync(playerId))
            .map(([code, char]) => ({
                code: Number(code),
                joinTime: char.joinTime.toISOString(),
                entryCount: char.entryCount,
                evolutionLevel: char.evolutionLevel,
                overLimitStep: char.overLimitStep,
                exp: char.exp,
                stack: char.stack,
                manaBoardIndex: char.manaBoardIndex,
            }))
            .sort((a, b) => new Date(b.joinTime).getTime() - new Date(a.joinTime).getTime())

        if (includes("items")) result.items = Object.entries(getPlayerItemsSync(playerId)).map(([id, count]) => ({ id: Number(id), count }))

        if (includes("equipment")) result.equipment = Object.entries(getPlayerEquipmentListSync(playerId)).map(([id, eq]) => ({
            id: Number(id),
            level: eq.level,
            enhancementLevel: eq.enhancementLevel,
        }))

        if (includes("questProgress")) {
            // This getter refreshes stale finite-tower best times. Never call it
            // for unrelated tabs or for the player's basic information.
            const questProgress = getPlayerQuestProgressSync(playerId)
            const questList: { section: number; questId: number; finished: boolean; highScore: number | null; clearRank: number | null; bestElapsedTimeMs: number | null }[] = []
            for (const [section, quests] of Object.entries(questProgress)) {
                for (const qp of quests) questList.push({
                    section: Number(section),
                    questId: qp.questId,
                    finished: qp.finished,
                    highScore: qp.highScore ?? null,
                    clearRank: qp.clearRank ?? null,
                    bestElapsedTimeMs: qp.bestElapsedTimeMs ?? null,
                })
            }
            result.questProgress = questList
        }

        if (includes("drawnQuests")) result.drawnQuests = getPlayerDrawnQuestsSync(playerId).map(dq => ({
            categoryId: dq.categoryId,
            questId: dq.questId,
            oddsId: dq.oddsId,
        }))
        return reply.send(result)
    })

    fastify.get("/save", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.query as SaveQuery
        const playerId = Number(id)
        if (isNaN(playerId)) return reply.redirect("/player");

        const exportStartedAt = Date.now()
        const abortController = new AbortController()
        const abortExport = () => {
            if (!reply.raw.writableEnded) abortController.abort()
        }
        reply.raw.once("close", abortExport)
        try {
            const exported = await exportPlayerSaveInWorker(playerId, {
                signal: abortController.signal,
                maxBytes: maxSaveUploadBytes,
            })
            if (hijackUnavailableReply(request, reply)) return reply
            console.warn(
                `[SAVE-EXPORT] completed player=${playerId} rows=${exported.rowCount} `
                + `bytes=${exported.payload.byteLength} elapsedMs=${Date.now() - exportStartedAt}`,
            )
            reply.header("content-disposition", `attachment; filename="save_${playerId}.json"`)
            return reply.type("application/json").send(exported.payload)
        } catch (error) {
            if (hijackUnavailableReply(request, reply)) return reply
            if (error instanceof ServerClosingError) throw error
            if (error instanceof PlayerSaveExportError) {
                if (error.code === "busy") return reply.status(429).send({ error: error.message })
                if (error.code === "too-large") return reply.status(413).send({ error: `导出失败：${error.message}` })
            }
            const message = error instanceof Error ? error.message : String(error)
            console.error(
                `[SAVE-EXPORT] failed player=${playerId} elapsedMs=${Date.now() - exportStartedAt}: ${message}`,
            )
            return reply.status(500).send({ error: `导出失败：${message}` })
        } finally {
            reply.raw.removeListener("close", abortExport)
        }
    })

    fastify.post("/save", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.query as SaveQuery
        const playerId = Number(id)
        const json = wantsJson(request)
        // JSON 客户端返回结构化错误/成功；旧 SSR 页面保留 redirect
        const fail = (msg: string, code = 400) => json
            ? reply.status(code).send({ error: msg })
            : reply.redirect(`/player/${id}?error=${encodeURIComponent(msg)}`)
        if (isNaN(playerId)) return json ? reply.status(400).send({ error: "无效的玩家 ID" }) : reply.redirect("/player");

        const importState = { safetyBackup: null as { name: string; directory: string } | null }
        let backupCleanup = {
            retainedBackups: null as number | null,
            removedBackups: 0,
            backupCleanupError: null as string | null,
        }
        try {
            const file = await (request as any).file()
            if (file === undefined) return fail("未选择文件")

            const buffer = await file.toBuffer()
            if (buffer.length > maxSaveUploadBytes) return fail(`存档超过 ${maxSaveUploadBytes / 1024 / 1024} MB 安全上限`)
            const text = buffer.toString('utf-8')
            let parsed: any
            try {
                parsed = JSON.parse(text)
            } catch {
                return fail("文件不是有效的 JSON")
            }

            if (parsed === null || typeof parsed !== 'object' || parsed.schema !== 'starpoint-cn-save') {
                return fail("不是有效的存档快照（schema 不符，请使用本面板导出的存档）")
            }
            if (!isPlayerSaveSnapshotV2(parsed)) {
                return fail("仅支持 V2 完整存档；旧版 V1 存档与当前数据库结构不兼容")
            }
            const snapshot = validatePlayerSaveSnapshotV2Sync(parsed)
            // Uploads do not reserve write admission. Capture the target and
            // backup only once the actual coordinated write is accepted.
            const imported = await runPersistenceTransaction({
                domain: "admin", playerId, operation: "import_save",
            }, () => {
                const rollbackSnapshot = createPlayerSaveSnapshotV2Sync(playerId)
                const safetyBackup = createPlayerImportSnapshotBackup(playerId, rollbackSnapshot, {
                    sourceSnapshotVersion: 2,
                    sourcePlayerId: snapshot.playerId,
                })
                importState.safetyBackup = safetyBackup
                backupCleanup = applyPlayerImportBackupRetention(safetyBackup.directory)
                const restored = restorePlayerSaveSnapshotV2Sync(snapshot, playerId, {
                    includeArchiveHistory: true,
                })
                return { restored, backup: safetyBackup }
            })
            if (json) return reply.status(200).send({
                ok: true,
                playerId,
                snapshotVersion: 2,
                backup: `.database/admin-backups/${imported.backup.name}`,
                ...backupCleanup,
                restored: imported.restored,
            })
            return reply.redirect(`/player/${id}`)
        } catch (error: any) {
            if (error instanceof ServerClosingError || isPersistenceAdmissionError(error)) throw error
            if (error?.code === "FST_REQ_FILE_TOO_LARGE") {
                return fail(`存档超过 ${maxSaveUploadBytes / 1024 / 1024} MB 安全上限`, 413)
            }
            const backupHint = importState.safetyBackup
                ? `；安全备份：.database/admin-backups/${importState.safetyBackup.name}`
                : ""
            const cleanupHint = backupCleanup.backupCleanupError
                ? `；旧回滚备份清理失败：${backupCleanup.backupCleanupError}`
                : ""
            return fail(`恢复失败：${error?.message ?? error}${backupHint}${cleanupHint}`,
                error instanceof ExBoostImportConflictError ? 400 : 500)
        }
    })

    // ====== New: Inline edit endpoints ======

    // Edit single field
    fastify.patch("/:id/field", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        const playerId = Number(id)
        if (isNaN(playerId)) return reply.status(400).send({ error: "Invalid player ID" })

        const player = getPlayerSync(playerId)
        if (!player) return reply.status(404).send({ error: "Player not found" })

        const body = request.body as Record<string, any> || {}
        const field = body.field
        const rawValue = body.value
        if (!field || rawValue === undefined) return reply.status(400).send({ error: "Missing field or value" })

        const result = validatePlayerField(field, rawValue)
        if (!result.ok) return reply.status(400).send({ error: result.error })
        const value = result.value

        // Auto-sync related time fields
        const extra: Record<string, any> = {}
        if (field === 'stamina') {
            extra.staminaHealTime = new Date()
        }
        if (field === 'expPool') {
            // A manually assigned balance is an exact snapshot. Start its
            // regeneration from the current virtual time instead of retaining
            // a checkpoint copied from another clock position.
            extra.expPooledTime = getPlayerBusinessDateSync(playerId)
            extra.timeOffset = getPlayerBusinessOffsetSync(playerId)
        }

        try {
            const updateData = { id: playerId, [field]: value, ...extra }
            runPersistenceTransactionSync({
                domain: "admin", playerId, operation: "admin_player_field_edit",
            }, () => updatePlayerSync(updateData))
            return reply.status(200).send({ ok: true, field, value })
        } catch (e: any) {
            return reply.status(500).send({ error: e.message })
        }
    })

    // Clear all EX boost data for all characters
    fastify.post("/:id/clear_ex_boost", async (request: FastifyRequest, reply: FastifyReply) => {
        const playerId = Number((request.params as any).id)
        if (isNaN(playerId)) return reply.status(400).send({ error: "Invalid player ID" })
        runPersistenceTransactionSync({
            domain: "admin", playerId, operation: "admin_clear_ex_boost",
        }, () => getDb().prepare(`UPDATE players_characters SET ex_boost_status_id = NULL, ex_boost_ability_id_list = NULL WHERE player_id = ?`).run(playerId))
        if (wantsJson(request)) return reply.status(200).send({ ok: true })
        return reply.redirect(`/player/${playerId}#actions`)
    })

    // Reset parties to defaults
    fastify.post("/:id/reset_parties", async (request: FastifyRequest, reply: FastifyReply) => {
        const playerId = Number((request.params as any).id)
        if (isNaN(playerId)) return reply.status(400).send({ error: "Invalid player ID" })
        runPersistenceTransactionSync({
            domain: "admin", playerId, operation: "admin_reset_parties",
        }, () => {
            getDb().prepare(`DELETE FROM players_parties WHERE player_id = ?`).run(playerId)
            getDb().prepare(`DELETE FROM players_party_groups WHERE player_id = ?`).run(playerId)
            insertPlayerPartyGroupListSync(playerId, getDefaultPlayerPartyGroupsSync(PartyCategory.NORMAL))
        })
        if (wantsJson(request)) return reply.status(200).send({ ok: true })
        return reply.redirect(`/player/${playerId}#actions`)
    })

    // Clear all mails
    fastify.post("/:id/clear_mail", async (request: FastifyRequest, reply: FastifyReply) => {
        const playerId = Number((request.params as any).id)
        if (isNaN(playerId)) return reply.status(400).send({ error: "Invalid player ID" })
        runPersistenceTransactionSync({
            domain: "admin", playerId, operation: "admin_clear_mail",
        }, () => deleteAllPlayerMailSync(playerId))
        return reply.redirect(`/player/${playerId}#actions`)
    })

    // Clear receive history
    fastify.post("/:id/clear_receive_history", async (request: FastifyRequest, reply: FastifyReply) => {
        const playerId = Number((request.params as any).id)
        if (isNaN(playerId)) return reply.status(400).send({ error: "Invalid player ID" })
        runPersistenceTransactionSync({
            domain: "admin", playerId, operation: "admin_clear_receive_history",
        }, () => getDb().prepare(`DELETE FROM players_receive_history WHERE player_id = ?`).run(playerId))
        if (wantsJson(request)) return reply.status(200).send({ ok: true })
        return reply.redirect(`/player/${playerId}#actions`)
    })

    // Repair legacy saves that progressed past 1-6-1 but lost its completion row.
    fastify.post("/:id/repair_unison_unlock", async (request: FastifyRequest, reply: FastifyReply) => {
        const playerId = Number((request.params as any).id)
        if (isNaN(playerId)) return reply.status(400).send({ error: "无效的玩家 ID" })
        if (!getPlayerSync(playerId)) return reply.status(404).send({ error: "未找到该玩家存档" })

        try {
            const status = getUnisonUnlockRepairStatusSync(playerId)
            if (status === "not_eligible") {
                return reply.status(409).send({
                    error: "该存档没有通关第一章 6-1 或后续主线的记录，未执行修复",
                    status,
                })
            }
            if (status === "already_unlocked") {
                return reply.status(200).send({
                    ok: true,
                    repaired: false,
                    status,
                    message: "第一章 6-1 通关记录已经完整，无需修复",
                })
            }

            const changes = runPersistenceTransactionSync({
                domain: "admin", playerId, operation: "admin_repair_unison_unlock",
            }, () => repairUnisonUnlockProgressSync(playerId))
            if (changes < 1) throw new Error("修复条件已满足，但没有写入任何变更")
            return reply.status(200).send({
                ok: true,
                repaired: true,
                status: "repaired",
                changes,
                message: "已补齐第一章 6-1 通关记录",
            })
        } catch (e: any) {
            return reply.status(500).send({ error: `合击解锁修复失败：${e?.message ?? e}` })
        }
    })

    // Add character
    fastify.post("/:id/character", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        const playerId = Number(id)
        if (isNaN(playerId)) return reply.status(400).send({ error: "Invalid player ID" })

        const body = request.body as Record<string, any> || {}
        const code = Number(body.code || body.character_id)
        if (isNaN(code)) return reply.status(400).send({ error: "Missing code (business code)" })
        if (!VALID_CHARACTER_IDS.has(code)) return reply.status(400).send({ error: `角色 ID ${code} 不存在于资源表中` })

        try {
            runPersistenceTransactionSync({
                domain: "admin", playerId, operation: "admin_add_character",
            }, () => insertDefaultPlayerCharacterSync(playerId, code))
            return reply.status(200).send({ ok: true, code })
        } catch (e: any) {
            return reply.status(500).send({ error: e.message })
        }
    })

    // Delete character
    fastify.delete("/:id/character/:code", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id, code } = request.params as { id: string, code: string }
        const playerId = Number(id)
        const charCode = Number(code)
        if (isNaN(playerId) || isNaN(charCode)) return reply.status(400).send({ error: "Invalid params" })

        try {
        runPersistenceTransactionSync({
            domain: "admin", playerId, operation: "admin_delete_character",
        }, () => {
            const db = getDb();
            // 1. Delete character data
            db.prepare(`DELETE FROM players_characters WHERE player_id = ? AND id = ?`).run(playerId, charCode)
            db.prepare(`DELETE FROM players_characters_bond_tokens WHERE player_id = ? AND character_id = ?`).run(playerId, charCode)
            db.prepare(`DELETE FROM players_characters_mana_nodes WHERE player_id = ? AND character_id = ?`).run(playerId, charCode)
            // 2. Clear all party references to this character
            for (const col of ['character_id_1', 'character_id_2', 'character_id_3',
                                'unison_character_1', 'unison_character_2', 'unison_character_3']) {
                db.prepare(`UPDATE players_parties SET ${col} = NULL WHERE player_id = ? AND ${col} = ?`).run(playerId, charCode)
            }
        })
        return reply.status(200).send({ ok: true })
        } catch (e: any) {
            return reply.status(500).send({ error: e.message })
        }
    })

    // Add/set item
    fastify.post("/:id/item", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        const playerId = Number(id)
        if (isNaN(playerId)) return reply.status(400).send({ error: "Invalid player ID" })

        const body = request.body as Record<string, any> || {}
        const itemId = Number(body.id || body.itemId)
        const count = Number(body.count ?? 1)
        if (isNaN(itemId) || isNaN(count)) return reply.status(400).send({ error: "Missing id or count" })
        if (!VALID_ITEM_IDS.has(itemId)) return reply.status(400).send({ error: `道具 ID ${itemId} 不存在于资源表中` })
        if (!Number.isSafeInteger(count)) return reply.status(400).send({ error: "count 必须是整数" })
        if (count < 0 || count > MAX_INT) return reply.status(400).send({ error: `count 超出范围（需 0 ~ ${MAX_INT}）` })

        try {
            runPersistenceTransactionSync({
                domain: "admin", playerId, operation: "admin_set_item",
            }, () => setPlayerItemSync(playerId, itemId, count))
            return reply.status(200).send({ ok: true, itemId, count })
        } catch (e: any) {
            return reply.status(500).send({ error: e.message })
        }
    })

    // Delete item
    fastify.delete("/:id/item/:itemId", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id, itemId } = request.params as { id: string, itemId: string }
        const playerId = Number(id)
        const iid = Number(itemId)
        if (isNaN(playerId) || isNaN(iid)) return reply.status(400).send({ error: "Invalid params" })

        try {
            runPersistenceTransactionSync({
                domain: "admin", playerId, operation: "admin_delete_item",
            }, () => getDb().prepare(`DELETE FROM players_items WHERE player_id = ? AND id = ?`).run(playerId, iid))
            return reply.status(200).send({ ok: true })
        } catch (e: any) {
            return reply.status(500).send({ error: e.message })
        }
    })

    // Delete single quest progress record
    fastify.delete("/:id/quest_progress/:section/:quest_id", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id, section, quest_id } = request.params as { id: string, section: string, quest_id: string }
        const playerId = Number(id)
        const sec = Number(section)
        const qid = Number(quest_id)
        if (isNaN(playerId) || isNaN(sec) || isNaN(qid)) return reply.status(400).send({ error: "Invalid params" })
        try {
            runPersistenceTransactionSync({
                domain: "admin", playerId, operation: "admin_delete_quest_progress",
            }, () => getDb().prepare(`DELETE FROM players_quest_progress WHERE player_id = ? AND section = ? AND quest_id = ?`).run(playerId, sec, qid))
            return reply.status(200).send({ ok: true })
        } catch (e: any) { return reply.status(500).send({ error: e.message }) }
    })

    // Delete all quest progress for a player
    fastify.delete("/:id/quest_progress", async (request: FastifyRequest, reply: FastifyReply) => {
        const playerId = Number((request.params as any).id)
        if (isNaN(playerId)) return reply.status(400).send({ error: "Invalid params" })
        try {
            runPersistenceTransactionSync({
                domain: "admin", playerId, operation: "admin_delete_all_quest_progress",
            }, () => getDb().prepare(`DELETE FROM players_quest_progress WHERE player_id = ?`).run(playerId))
            return reply.status(200).send({ ok: true })
        } catch (e: any) { return reply.status(500).send({ error: e.message }) }
    })

    // Delete single drawn quest record
    fastify.delete("/:id/drawn_quest/:category/:quest_id", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id, category, quest_id } = request.params as { id: string, category: string, quest_id: string }
        const playerId = Number(id)
        const cat = Number(category)
        const qid = Number(quest_id)
        if (isNaN(playerId) || isNaN(cat) || isNaN(qid)) return reply.status(400).send({ error: "Invalid params" })
        try {
            runPersistenceTransactionSync({
                domain: "admin", playerId, operation: "admin_delete_drawn_quest",
            }, () => getDb().prepare(`DELETE FROM players_drawn_quests WHERE player_id = ? AND category_id = ? AND quest_id = ?`).run(playerId, cat, qid))
            return reply.status(200).send({ ok: true })
        } catch (e: any) { return reply.status(500).send({ error: e.message }) }
    })

    // Delete all drawn quests for a player
    fastify.delete("/:id/drawn_quest", async (request: FastifyRequest, reply: FastifyReply) => {
        const playerId = Number((request.params as any).id)
        if (isNaN(playerId)) return reply.status(400).send({ error: "Invalid params" })
        try {
            runPersistenceTransactionSync({
                domain: "admin", playerId, operation: "admin_delete_all_drawn_quests",
            }, () => getDb().prepare(`DELETE FROM players_drawn_quests WHERE player_id = ?`).run(playerId))
            return reply.status(200).send({ ok: true })
        } catch (e: any) { return reply.status(500).send({ error: e.message }) }
    })
    fastify.post("/:id/reset_challenge", async (request: FastifyRequest, reply: FastifyReply) => {
        const playerId = Number((request.params as any).id)
        if (isNaN(playerId)) return reply.status(400).send({ error: "Invalid params" })
        try {
            const entries = getPlayerDailyChallengePointListSync(playerId)
            const lookup = dailyChallengePointLookup as Record<string, { maxPoint: number }>
            if (entries.length === 0) {
                // No entries yet — create all 282 from CDN
                const defaults = Object.entries(lookup).map(([idStr, data]) => ({
                    id: Number(idStr),
                    point: data.maxPoint,
                    campaignList: [] as any[]
                }))
                runPersistenceTransactionSync({
                    domain: "admin", playerId, operation: "admin_reset_daily_challenge",
                }, () => insertPlayerDailyChallengePointListSync(playerId, defaults))
                return reply.status(200).send({ ok: true, count: defaults.length, created: true })
            }
            runPersistenceTransactionSync({
                domain: "admin", playerId, operation: "admin_reset_daily_challenge",
            }, () => {
                for (const entry of entries) {
                    const maxPoint = lookup[String(entry.id)]?.maxPoint ?? entry.point
                    updatePlayerDailyChallengePointSync(playerId, entry.id, maxPoint)
                }
            })
            return reply.status(200).send({ ok: true, count: entries.length })
        } catch (e: any) { return reply.status(500).send({ error: e.message }) }
    })

    // Clear mailbox (admin recovery for crash-causing illegal mail)
    fastify.delete("/:id/mail", async (request: FastifyRequest, reply: FastifyReply) => {
        const playerId = Number((request.params as any).id)
        if (isNaN(playerId)) return reply.status(400).send({ error: "Invalid player ID" })
        if (!getPlayerSync(playerId)) return reply.status(404).send({ error: "Player not found" })
        try {
            const deleted = runPersistenceTransactionSync({
                domain: "admin", playerId, operation: "admin_delete_mail",
            }, () => deleteAllPlayerMailSync(playerId))
            return reply.status(200).send({ ok: true, deleted })
        } catch (e: any) {
            return reply.status(500).send({ error: e.message })
        }
    })

    // Admin: force daily mission reset (snapshot + wipe cache)
    fastify.post("/:id/daily_reset", async (request: FastifyRequest, reply: FastifyReply) => {
        const playerId = Number((request.params as any).id)
        if (isNaN(playerId)) return reply.status(400).send({ error: "Invalid player ID" })
        const player = getPlayerSync(playerId)
        if (!player) return reply.status(404).send({ error: "Player not found" })
        try {
            const questProgress = getPlayerQuestProgressSync(playerId)
            let totalClears = 0, ss = 0, s = 0, a = 0, b = 0
            for (const [, quests] of Object.entries(questProgress)) {
                for (const qp of quests) {
                    if (qp.finished) {
                        totalClears++
                        if (qp.clearRank === 5) ss++
                        else if (qp.clearRank === 4) s++
                        else if (qp.clearRank === 3) a++
                        else if (qp.clearRank === 2) b++
                    }
                }
            }
            runPersistenceTransactionSync({
                domain: "admin", playerId, operation: "admin_daily_reset",
            }, () => {
                takeSnapshot(playerId, 'daily', buildPeriodicSnapshotData(playerId, player, totalClears))
                deletePlayerCategoryMissionsSync(playerId, 2)
            })
            return reply.status(200).send({ ok: true })
        } catch (e: any) { return reply.status(500).send({ error: e.message }) }
    })

    // Admin: force weekly mission reset (snapshot + wipe cache)
    fastify.post("/:id/weekly_reset", async (request: FastifyRequest, reply: FastifyReply) => {
        const playerId = Number((request.params as any).id)
        if (isNaN(playerId)) return reply.status(400).send({ error: "Invalid player ID" })
        const player = getPlayerSync(playerId)
        if (!player) return reply.status(404).send({ error: "Player not found" })
        try {
            const questProgress = getPlayerQuestProgressSync(playerId)
            let totalClears = 0, ss = 0, s = 0, a = 0, b = 0
            for (const [, quests] of Object.entries(questProgress)) {
                for (const qp of quests) {
                    if (qp.finished) {
                        totalClears++
                        if (qp.clearRank === 5) ss++
                        else if (qp.clearRank === 4) s++
                        else if (qp.clearRank === 3) a++
                        else if (qp.clearRank === 2) b++
                    }
                }
            }
            runPersistenceTransactionSync({
                domain: "admin", playerId, operation: "admin_weekly_reset",
            }, () => {
                takeSnapshot(playerId, 'weekly', buildPeriodicSnapshotData(playerId, player, totalClears))
                deletePlayerCategoryMissionsSync(playerId, 10)
            })
            return reply.status(200).send({ ok: true })
        } catch (e: any) { return reply.status(500).send({ error: e.message }) }
    })
}

export default routes;
