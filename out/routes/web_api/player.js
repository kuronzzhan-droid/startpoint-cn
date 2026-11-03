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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const player_time_compat_1 = require("../../lib/player-time-compat");
const validation_1 = require("./validation");
const http_1 = require("./http");
const player_1 = require("../../data/domains/player");
const mail_1 = require("../../data/domains/mail");
const db_1 = require("../../data/db");
const character_1 = require("../../data/domains/character");
const equipment_1 = require("../../data/domains/equipment");
const item_1 = require("../../data/domains/item");
const quest_1 = require("../../data/domains/quest");
const party_1 = require("../../data/domains/party");
const types_1 = require("../../data/types");
const snapshot_1 = require("../../lib/mission/snapshot");
const mission_1 = require("../../data/domains/mission");
const daily_challenge_point_lookup_json_1 = __importDefault(require("../../../assets/daily_challenge_point_lookup.json"));
const unison_unlock_1 = require("../../lib/validate/unison-unlock");
const player_snapshot_1 = require("../../data/snapshots/player-snapshot");
const admin_database_backup_1 = require("../../lib/admin-database-backup");
const player_save_export_1 = require("../../lib/player-save-export");
const http_reply_1 = require("../../lib/http-reply");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const shutdown_state_1 = require("../../lib/shutdown-state");
const persistence_admission_1 = require("../../lib/persistence-admission");
const skip_main_story_1 = require("../../lib/skip-main-story");
const defaultPerPage = 25;
const maxSaveUploadBytes = player_save_export_1.DEFAULT_PLAYER_SAVE_EXPORT_MAX_BYTES;
function applyPlayerImportBackupRetention(directory) {
    try {
        return (0, admin_database_backup_1.cleanupPlayerImportBackups)(directory, 5);
    }
    catch (error) {
        return {
            retainedBackups: null,
            removedBackups: 0,
            backupCleanupError: error instanceof Error ? error.message : String(error),
        };
    }
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/:id/skip_main_story", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const playerId = Number(request.params.id);
        if (!Number.isSafeInteger(playerId) || playerId <= 0) {
            return reply.status(400).send({ error: "INVALID_PLAYER_ID", message: "玩家 ID 必须为正整数" });
        }
        try {
            const body = request.body;
            return reply.send(yield (0, skip_main_story_1.skipMainStory)(playerId, body === null || body === void 0 ? void 0 : body.category, body === null || body === void 0 ? void 0 : body.chapter));
        }
        catch (error) {
            if (error instanceof skip_main_story_1.SkipMainStoryError) {
                return reply.status(error.statusCode).send({ error: error.message, code: error.code });
            }
            throw error;
        }
    }));
    fastify.addHook("onClose", () => __awaiter(void 0, void 0, void 0, function* () { yield (0, player_save_export_1.closePlayerSaveExports)(); }));
    fastify.get("/", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const { page, perPage } = request.query;
        const parsedPage = page === undefined ? 0 : Number.parseInt(page);
        const parsedPerPage = perPage === undefined ? defaultPerPage : Number.parseInt(perPage);
        if (isNaN(parsedPage) || isNaN(parsedPerPage))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid query parameters."
            });
        const players = (0, player_1.getAllPlayersSync)(parsedPage * parsedPerPage, Math.min(defaultPerPage, parsedPerPage));
        return reply.status(200).send(players);
    }));
    fastify.get("/:id/detail", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const playerId = Number(request.params.id);
        if (isNaN(playerId))
            return reply.status(400).send({ error: "Invalid player ID" });
        const player = (0, player_1.getPlayerSync)(playerId);
        if (!player)
            return reply.status(404).send({ error: "Player not found" });
        const characters = (0, character_1.getPlayerCharactersSync)(playerId);
        const charList = Object.entries(characters)
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
            .sort((a, b) => new Date(b.joinTime).getTime() - new Date(a.joinTime).getTime());
        const items = (0, item_1.getPlayerItemsSync)(playerId);
        const itemList = Object.entries(items).map(([id, count]) => ({ id: Number(id), count }));
        const equipment = (0, equipment_1.getPlayerEquipmentListSync)(playerId);
        const equipList = Object.entries(equipment).map(([id, eq]) => ({
            id: Number(id),
            level: eq.level,
            enhancementLevel: eq.enhancementLevel,
        }));
        const questProgress = (0, quest_1.getPlayerQuestProgressSync)(playerId);
        const questList = [];
        for (const [section, quests] of Object.entries(questProgress)) {
            for (const qp of quests) {
                questList.push({
                    section: Number(section),
                    questId: qp.questId,
                    finished: qp.finished,
                    highScore: (_a = qp.highScore) !== null && _a !== void 0 ? _a : null,
                    clearRank: (_b = qp.clearRank) !== null && _b !== void 0 ? _b : null,
                    bestElapsedTimeMs: (_c = qp.bestElapsedTimeMs) !== null && _c !== void 0 ? _c : null,
                });
            }
        }
        const drawnQuests = (0, quest_1.getPlayerDrawnQuestsSync)(playerId);
        return reply.send({
            player: {
                id: player.id,
                accountId: (_e = (_d = (0, db_1.getDb)().prepare(`SELECT account_id FROM players WHERE id = ?`).get(player.id)) === null || _d === void 0 ? void 0 : _d.account_id) !== null && _e !== void 0 ? _e : 0,
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
                timeOffset: (_f = player.timeOffset) !== null && _f !== void 0 ? _f : null,
            },
            characters: charList,
            items: itemList,
            equipment: equipList,
            questProgress: questList,
            drawnQuests: drawnQuests.map(dq => ({
                categoryId: dq.categoryId,
                questId: dq.questId,
                oddsId: dq.oddsId,
            })),
        });
    }));
    fastify.get("/save", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const { id } = request.query;
        const playerId = Number(id);
        if (isNaN(playerId))
            return reply.redirect("/player");
        const exportStartedAt = Date.now();
        const abortController = new AbortController();
        const abortExport = () => {
            if (!reply.raw.writableEnded)
                abortController.abort();
        };
        reply.raw.once("close", abortExport);
        try {
            const exported = yield (0, player_save_export_1.exportPlayerSaveInWorker)(playerId, {
                signal: abortController.signal,
                maxBytes: maxSaveUploadBytes,
            });
            if ((0, http_reply_1.hijackUnavailableReply)(request, reply))
                return reply;
            console.warn(`[SAVE-EXPORT] completed player=${playerId} rows=${exported.rowCount} `
                + `bytes=${exported.payload.byteLength} elapsedMs=${Date.now() - exportStartedAt}`);
            reply.header("content-disposition", `attachment; filename="save_${playerId}.json"`);
            return reply.type("application/json").send(exported.payload);
        }
        catch (error) {
            if ((0, http_reply_1.hijackUnavailableReply)(request, reply))
                return reply;
            if (error instanceof shutdown_state_1.ServerClosingError)
                throw error;
            if (error instanceof player_save_export_1.PlayerSaveExportError) {
                if (error.code === "busy")
                    return reply.status(429).send({ error: error.message });
                if (error.code === "too-large")
                    return reply.status(413).send({ error: `导出失败：${error.message}` });
            }
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[SAVE-EXPORT] failed player=${playerId} elapsedMs=${Date.now() - exportStartedAt}: ${message}`);
            return reply.status(500).send({ error: `导出失败：${message}` });
        }
        finally {
            reply.raw.removeListener("close", abortExport);
        }
    }));
    fastify.post("/save", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _g;
        const { id } = request.query;
        const playerId = Number(id);
        const json = (0, http_1.wantsJson)(request);
        // JSON 客户端返回结构化错误/成功；旧 SSR 页面保留 redirect
        const fail = (msg, code = 400) => json
            ? reply.status(code).send({ error: msg })
            : reply.redirect(`/player/${id}?error=${encodeURIComponent(msg)}`);
        if (isNaN(playerId))
            return json ? reply.status(400).send({ error: "无效的玩家 ID" }) : reply.redirect("/player");
        const importState = { safetyBackup: null };
        let backupCleanup = {
            retainedBackups: null,
            removedBackups: 0,
            backupCleanupError: null,
        };
        try {
            const file = yield request.file();
            if (file === undefined)
                return fail("未选择文件");
            const buffer = yield file.toBuffer();
            if (buffer.length > maxSaveUploadBytes)
                return fail(`存档超过 ${maxSaveUploadBytes / 1024 / 1024} MB 安全上限`);
            const text = buffer.toString('utf-8');
            let parsed;
            try {
                parsed = JSON.parse(text);
            }
            catch (_h) {
                return fail("文件不是有效的 JSON");
            }
            if (parsed === null || typeof parsed !== 'object' || parsed.schema !== 'starpoint-cn-save') {
                return fail("不是有效的存档快照（schema 不符，请使用本面板导出的存档）");
            }
            if (!(0, player_snapshot_1.isPlayerSaveSnapshotV2)(parsed)) {
                return fail("仅支持 V2 完整存档；旧版 V1 存档与当前数据库结构不兼容");
            }
            const snapshot = (0, player_snapshot_1.validatePlayerSaveSnapshotV2Sync)(parsed);
            // Uploads do not reserve write admission. Capture the target and
            // backup only once the actual coordinated write is accepted.
            const imported = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
                domain: "admin", playerId, operation: "import_save",
            }, () => {
                const rollbackSnapshot = (0, player_snapshot_1.createPlayerSaveSnapshotV2Sync)(playerId);
                const safetyBackup = (0, admin_database_backup_1.createPlayerImportSnapshotBackup)(playerId, rollbackSnapshot, {
                    sourceSnapshotVersion: 2,
                    sourcePlayerId: snapshot.playerId,
                });
                importState.safetyBackup = safetyBackup;
                backupCleanup = applyPlayerImportBackupRetention(safetyBackup.directory);
                const restored = (0, player_snapshot_1.restorePlayerSaveSnapshotV2Sync)(snapshot, playerId, {
                    includeArchiveHistory: true,
                });
                return { restored, backup: safetyBackup };
            });
            if (json)
                return reply.status(200).send(Object.assign(Object.assign({ ok: true, playerId, snapshotVersion: 2, backup: `.database/admin-backups/${imported.backup.name}` }, backupCleanup), { restored: imported.restored }));
            return reply.redirect(`/player/${id}`);
        }
        catch (error) {
            if (error instanceof shutdown_state_1.ServerClosingError || (0, persistence_admission_1.isPersistenceAdmissionError)(error))
                throw error;
            if ((error === null || error === void 0 ? void 0 : error.code) === "FST_REQ_FILE_TOO_LARGE") {
                return fail(`存档超过 ${maxSaveUploadBytes / 1024 / 1024} MB 安全上限`, 413);
            }
            const backupHint = importState.safetyBackup
                ? `；安全备份：.database/admin-backups/${importState.safetyBackup.name}`
                : "";
            const cleanupHint = backupCleanup.backupCleanupError
                ? `；旧回滚备份清理失败：${backupCleanup.backupCleanupError}`
                : "";
            return fail(`恢复失败：${(_g = error === null || error === void 0 ? void 0 : error.message) !== null && _g !== void 0 ? _g : error}${backupHint}${cleanupHint}`, 500);
        }
    }));
    // ====== New: Inline edit endpoints ======
    // Edit single field
    fastify.patch("/:id/field", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const { id } = request.params;
        const playerId = Number(id);
        if (isNaN(playerId))
            return reply.status(400).send({ error: "Invalid player ID" });
        const player = (0, player_1.getPlayerSync)(playerId);
        if (!player)
            return reply.status(404).send({ error: "Player not found" });
        const body = request.body || {};
        const field = body.field;
        const rawValue = body.value;
        if (!field || rawValue === undefined)
            return reply.status(400).send({ error: "Missing field or value" });
        const result = (0, validation_1.validatePlayerField)(field, rawValue);
        if (!result.ok)
            return reply.status(400).send({ error: result.error });
        const value = result.value;
        // Auto-sync related time fields
        const extra = {};
        if (field === 'stamina') {
            extra.staminaHealTime = new Date();
        }
        if (field === 'expPool') {
            // A manually assigned balance is an exact snapshot. Start its
            // regeneration from the current virtual time instead of retaining
            // a checkpoint copied from another clock position.
            extra.expPooledTime = (0, player_time_compat_1.getPlayerBusinessDateSync)(playerId);
            extra.timeOffset = (0, player_time_compat_1.getPlayerBusinessOffsetSync)(playerId);
        }
        try {
            const updateData = Object.assign({ id: playerId, [field]: value }, extra);
            (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", playerId, operation: "admin_player_field_edit",
            }, () => (0, player_1.updatePlayerSync)(updateData));
            return reply.status(200).send({ ok: true, field, value });
        }
        catch (e) {
            return reply.status(500).send({ error: e.message });
        }
    }));
    // Clear all EX boost data for all characters
    fastify.post("/:id/clear_ex_boost", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const playerId = Number(request.params.id);
        if (isNaN(playerId))
            return reply.status(400).send({ error: "Invalid player ID" });
        (0, persistence_coordinator_1.runPersistenceTransactionSync)({
            domain: "admin", playerId, operation: "admin_clear_ex_boost",
        }, () => (0, db_1.getDb)().prepare(`UPDATE players_characters SET ex_boost_status_id = NULL, ex_boost_ability_id_list = NULL WHERE player_id = ?`).run(playerId));
        if ((0, http_1.wantsJson)(request))
            return reply.status(200).send({ ok: true });
        return reply.redirect(`/player/${playerId}#actions`);
    }));
    // Reset parties to defaults
    fastify.post("/:id/reset_parties", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const playerId = Number(request.params.id);
        if (isNaN(playerId))
            return reply.status(400).send({ error: "Invalid player ID" });
        (0, persistence_coordinator_1.runPersistenceTransactionSync)({
            domain: "admin", playerId, operation: "admin_reset_parties",
        }, () => {
            (0, db_1.getDb)().prepare(`DELETE FROM players_parties WHERE player_id = ?`).run(playerId);
            (0, db_1.getDb)().prepare(`DELETE FROM players_party_groups WHERE player_id = ?`).run(playerId);
            (0, party_1.insertPlayerPartyGroupListSync)(playerId, (0, player_1.getDefaultPlayerPartyGroupsSync)(types_1.PartyCategory.NORMAL));
        });
        if ((0, http_1.wantsJson)(request))
            return reply.status(200).send({ ok: true });
        return reply.redirect(`/player/${playerId}#actions`);
    }));
    // Clear all mails
    fastify.post("/:id/clear_mail", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const playerId = Number(request.params.id);
        if (isNaN(playerId))
            return reply.status(400).send({ error: "Invalid player ID" });
        (0, persistence_coordinator_1.runPersistenceTransactionSync)({
            domain: "admin", playerId, operation: "admin_clear_mail",
        }, () => (0, mail_1.deleteAllPlayerMailSync)(playerId));
        return reply.redirect(`/player/${playerId}#actions`);
    }));
    // Clear receive history
    fastify.post("/:id/clear_receive_history", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const playerId = Number(request.params.id);
        if (isNaN(playerId))
            return reply.status(400).send({ error: "Invalid player ID" });
        (0, persistence_coordinator_1.runPersistenceTransactionSync)({
            domain: "admin", playerId, operation: "admin_clear_receive_history",
        }, () => (0, db_1.getDb)().prepare(`DELETE FROM players_receive_history WHERE player_id = ?`).run(playerId));
        if ((0, http_1.wantsJson)(request))
            return reply.status(200).send({ ok: true });
        return reply.redirect(`/player/${playerId}#actions`);
    }));
    // Repair legacy saves that progressed past 1-6-1 but lost its completion row.
    fastify.post("/:id/repair_unison_unlock", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _j;
        const playerId = Number(request.params.id);
        if (isNaN(playerId))
            return reply.status(400).send({ error: "无效的玩家 ID" });
        if (!(0, player_1.getPlayerSync)(playerId))
            return reply.status(404).send({ error: "未找到该玩家存档" });
        try {
            const status = (0, unison_unlock_1.getUnisonUnlockRepairStatusSync)(playerId);
            if (status === "not_eligible") {
                return reply.status(409).send({
                    error: "该存档没有通关第一章 6-1 或后续主线的记录，未执行修复",
                    status,
                });
            }
            if (status === "already_unlocked") {
                return reply.status(200).send({
                    ok: true,
                    repaired: false,
                    status,
                    message: "第一章 6-1 通关记录已经完整，无需修复",
                });
            }
            const changes = (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", playerId, operation: "admin_repair_unison_unlock",
            }, () => (0, unison_unlock_1.repairUnisonUnlockProgressSync)(playerId));
            if (changes < 1)
                throw new Error("修复条件已满足，但没有写入任何变更");
            return reply.status(200).send({
                ok: true,
                repaired: true,
                status: "repaired",
                changes,
                message: "已补齐第一章 6-1 通关记录",
            });
        }
        catch (e) {
            return reply.status(500).send({ error: `合击解锁修复失败：${(_j = e === null || e === void 0 ? void 0 : e.message) !== null && _j !== void 0 ? _j : e}` });
        }
    }));
    // Add character
    fastify.post("/:id/character", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const { id } = request.params;
        const playerId = Number(id);
        if (isNaN(playerId))
            return reply.status(400).send({ error: "Invalid player ID" });
        const body = request.body || {};
        const code = Number(body.code || body.character_id);
        if (isNaN(code))
            return reply.status(400).send({ error: "Missing code (business code)" });
        if (!validation_1.VALID_CHARACTER_IDS.has(code))
            return reply.status(400).send({ error: `角色 ID ${code} 不存在于资源表中` });
        try {
            (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", playerId, operation: "admin_add_character",
            }, () => (0, character_1.insertDefaultPlayerCharacterSync)(playerId, code));
            return reply.status(200).send({ ok: true, code });
        }
        catch (e) {
            return reply.status(500).send({ error: e.message });
        }
    }));
    // Delete character
    fastify.delete("/:id/character/:code", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const { id, code } = request.params;
        const playerId = Number(id);
        const charCode = Number(code);
        if (isNaN(playerId) || isNaN(charCode))
            return reply.status(400).send({ error: "Invalid params" });
        try {
            (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", playerId, operation: "admin_delete_character",
            }, () => {
                const db = (0, db_1.getDb)();
                // 1. Delete character data
                db.prepare(`DELETE FROM players_characters WHERE player_id = ? AND id = ?`).run(playerId, charCode);
                db.prepare(`DELETE FROM players_characters_bond_tokens WHERE player_id = ? AND character_id = ?`).run(playerId, charCode);
                db.prepare(`DELETE FROM players_characters_mana_nodes WHERE player_id = ? AND character_id = ?`).run(playerId, charCode);
                // 2. Clear all party references to this character
                for (const col of ['character_id_1', 'character_id_2', 'character_id_3',
                    'unison_character_1', 'unison_character_2', 'unison_character_3']) {
                    db.prepare(`UPDATE players_parties SET ${col} = NULL WHERE player_id = ? AND ${col} = ?`).run(playerId, charCode);
                }
            });
            return reply.status(200).send({ ok: true });
        }
        catch (e) {
            return reply.status(500).send({ error: e.message });
        }
    }));
    // Add/set item
    fastify.post("/:id/item", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const { id } = request.params;
        const playerId = Number(id);
        if (isNaN(playerId))
            return reply.status(400).send({ error: "Invalid player ID" });
        const body = request.body || {};
        const itemId = Number(body.id || body.itemId);
        const count = Number(body.count || 1);
        if (isNaN(itemId) || isNaN(count))
            return reply.status(400).send({ error: "Missing id or count" });
        if (!validation_1.VALID_ITEM_IDS.has(itemId))
            return reply.status(400).send({ error: `道具 ID ${itemId} 不存在于资源表中` });
        if (count < 0 || count > validation_1.MAX_INT)
            return reply.status(400).send({ error: `count 超出范围（需 0 ~ ${validation_1.MAX_INT}）` });
        try {
            (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", playerId, operation: "admin_set_item",
            }, () => (0, item_1.setPlayerItemSync)(playerId, itemId, count));
            return reply.status(200).send({ ok: true, itemId, count });
        }
        catch (e) {
            return reply.status(500).send({ error: e.message });
        }
    }));
    // Delete item
    fastify.delete("/:id/item/:itemId", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const { id, itemId } = request.params;
        const playerId = Number(id);
        const iid = Number(itemId);
        if (isNaN(playerId) || isNaN(iid))
            return reply.status(400).send({ error: "Invalid params" });
        try {
            (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", playerId, operation: "admin_delete_item",
            }, () => (0, db_1.getDb)().prepare(`DELETE FROM players_items WHERE player_id = ? AND id = ?`).run(playerId, iid));
            return reply.status(200).send({ ok: true });
        }
        catch (e) {
            return reply.status(500).send({ error: e.message });
        }
    }));
    // Delete single quest progress record
    fastify.delete("/:id/quest_progress/:section/:quest_id", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const { id, section, quest_id } = request.params;
        const playerId = Number(id);
        const sec = Number(section);
        const qid = Number(quest_id);
        if (isNaN(playerId) || isNaN(sec) || isNaN(qid))
            return reply.status(400).send({ error: "Invalid params" });
        try {
            (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", playerId, operation: "admin_delete_quest_progress",
            }, () => (0, db_1.getDb)().prepare(`DELETE FROM players_quest_progress WHERE player_id = ? AND section = ? AND quest_id = ?`).run(playerId, sec, qid));
            return reply.status(200).send({ ok: true });
        }
        catch (e) {
            return reply.status(500).send({ error: e.message });
        }
    }));
    // Delete all quest progress for a player
    fastify.delete("/:id/quest_progress", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const playerId = Number(request.params.id);
        if (isNaN(playerId))
            return reply.status(400).send({ error: "Invalid params" });
        try {
            (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", playerId, operation: "admin_delete_all_quest_progress",
            }, () => (0, db_1.getDb)().prepare(`DELETE FROM players_quest_progress WHERE player_id = ?`).run(playerId));
            return reply.status(200).send({ ok: true });
        }
        catch (e) {
            return reply.status(500).send({ error: e.message });
        }
    }));
    // Delete single drawn quest record
    fastify.delete("/:id/drawn_quest/:category/:quest_id", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const { id, category, quest_id } = request.params;
        const playerId = Number(id);
        const cat = Number(category);
        const qid = Number(quest_id);
        if (isNaN(playerId) || isNaN(cat) || isNaN(qid))
            return reply.status(400).send({ error: "Invalid params" });
        try {
            (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", playerId, operation: "admin_delete_drawn_quest",
            }, () => (0, db_1.getDb)().prepare(`DELETE FROM players_drawn_quests WHERE player_id = ? AND category_id = ? AND quest_id = ?`).run(playerId, cat, qid));
            return reply.status(200).send({ ok: true });
        }
        catch (e) {
            return reply.status(500).send({ error: e.message });
        }
    }));
    // Delete all drawn quests for a player
    fastify.delete("/:id/drawn_quest", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const playerId = Number(request.params.id);
        if (isNaN(playerId))
            return reply.status(400).send({ error: "Invalid params" });
        try {
            (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", playerId, operation: "admin_delete_all_drawn_quests",
            }, () => (0, db_1.getDb)().prepare(`DELETE FROM players_drawn_quests WHERE player_id = ?`).run(playerId));
            return reply.status(200).send({ ok: true });
        }
        catch (e) {
            return reply.status(500).send({ error: e.message });
        }
    }));
    fastify.post("/:id/reset_challenge", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const playerId = Number(request.params.id);
        if (isNaN(playerId))
            return reply.status(400).send({ error: "Invalid params" });
        try {
            const entries = (0, player_1.getPlayerDailyChallengePointListSync)(playerId);
            const lookup = daily_challenge_point_lookup_json_1.default;
            if (entries.length === 0) {
                // No entries yet — create all 282 from CDN
                const defaults = Object.entries(lookup).map(([idStr, data]) => ({
                    id: Number(idStr),
                    point: data.maxPoint,
                    campaignList: []
                }));
                (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                    domain: "admin", playerId, operation: "admin_reset_daily_challenge",
                }, () => (0, player_1.insertPlayerDailyChallengePointListSync)(playerId, defaults));
                return reply.status(200).send({ ok: true, count: defaults.length, created: true });
            }
            (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", playerId, operation: "admin_reset_daily_challenge",
            }, () => {
                var _a, _b;
                for (const entry of entries) {
                    const maxPoint = (_b = (_a = lookup[String(entry.id)]) === null || _a === void 0 ? void 0 : _a.maxPoint) !== null && _b !== void 0 ? _b : entry.point;
                    (0, player_1.updatePlayerDailyChallengePointSync)(playerId, entry.id, maxPoint);
                }
            });
            return reply.status(200).send({ ok: true, count: entries.length });
        }
        catch (e) {
            return reply.status(500).send({ error: e.message });
        }
    }));
    // Clear mailbox (admin recovery for crash-causing illegal mail)
    fastify.delete("/:id/mail", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const playerId = Number(request.params.id);
        if (isNaN(playerId))
            return reply.status(400).send({ error: "Invalid player ID" });
        if (!(0, player_1.getPlayerSync)(playerId))
            return reply.status(404).send({ error: "Player not found" });
        try {
            const deleted = (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", playerId, operation: "admin_delete_mail",
            }, () => (0, mail_1.deleteAllPlayerMailSync)(playerId));
            return reply.status(200).send({ ok: true, deleted });
        }
        catch (e) {
            return reply.status(500).send({ error: e.message });
        }
    }));
    // Admin: force daily mission reset (snapshot + wipe cache)
    fastify.post("/:id/daily_reset", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const playerId = Number(request.params.id);
        if (isNaN(playerId))
            return reply.status(400).send({ error: "Invalid player ID" });
        const player = (0, player_1.getPlayerSync)(playerId);
        if (!player)
            return reply.status(404).send({ error: "Player not found" });
        try {
            const questProgress = (0, quest_1.getPlayerQuestProgressSync)(playerId);
            let totalClears = 0, ss = 0, s = 0, a = 0, b = 0;
            for (const [, quests] of Object.entries(questProgress)) {
                for (const qp of quests) {
                    if (qp.finished) {
                        totalClears++;
                        if (qp.clearRank === 5)
                            ss++;
                        else if (qp.clearRank === 4)
                            s++;
                        else if (qp.clearRank === 3)
                            a++;
                        else if (qp.clearRank === 2)
                            b++;
                    }
                }
            }
            (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", playerId, operation: "admin_daily_reset",
            }, () => {
                (0, snapshot_1.takeSnapshot)(playerId, 'daily', (0, snapshot_1.buildPeriodicSnapshotData)(playerId, player, totalClears));
                (0, mission_1.deletePlayerCategoryMissionsSync)(playerId, 2);
            });
            return reply.status(200).send({ ok: true });
        }
        catch (e) {
            return reply.status(500).send({ error: e.message });
        }
    }));
    // Admin: force weekly mission reset (snapshot + wipe cache)
    fastify.post("/:id/weekly_reset", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const playerId = Number(request.params.id);
        if (isNaN(playerId))
            return reply.status(400).send({ error: "Invalid player ID" });
        const player = (0, player_1.getPlayerSync)(playerId);
        if (!player)
            return reply.status(404).send({ error: "Player not found" });
        try {
            const questProgress = (0, quest_1.getPlayerQuestProgressSync)(playerId);
            let totalClears = 0, ss = 0, s = 0, a = 0, b = 0;
            for (const [, quests] of Object.entries(questProgress)) {
                for (const qp of quests) {
                    if (qp.finished) {
                        totalClears++;
                        if (qp.clearRank === 5)
                            ss++;
                        else if (qp.clearRank === 4)
                            s++;
                        else if (qp.clearRank === 3)
                            a++;
                        else if (qp.clearRank === 2)
                            b++;
                    }
                }
            }
            (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", playerId, operation: "admin_weekly_reset",
            }, () => {
                (0, snapshot_1.takeSnapshot)(playerId, 'weekly', (0, snapshot_1.buildPeriodicSnapshotData)(playerId, player, totalClears));
                (0, mission_1.deletePlayerCategoryMissionsSync)(playerId, 10);
            });
            return reply.status(200).send({ ok: true });
        }
        catch (e) {
            return reply.status(500).send({ error: e.message });
        }
    }));
});
exports.default = routes;
