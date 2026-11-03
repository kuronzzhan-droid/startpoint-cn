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
const account_1 = require("../../data/domains/account");
const mail_1 = require("../../data/domains/mail");
const player_1 = require("../../data/domains/player");
const http_1 = require("./http");
const content_master_1 = require("../../lib/content-master");
const equipment_ids_json_1 = __importDefault(require("../../../assets/equipment_ids.json"));
const mission_degree_reward_json_1 = __importDefault(require("../../../assets/mission_degree_reward.json"));
const carnival_event_total_score_rewards_json_1 = __importDefault(require("../../../assets/carnival_event_total_score_rewards.json"));
const admin_mail_rules_1 = require("../../lib/admin-mail-rules");
const admin_mail_time_1 = require("../../lib/admin-mail-time");
const daily_vmoney_mail_1 = require("../../lib/daily-vmoney-mail");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
// Pre-built CDN validation sets
const CDN_CHAR_IDS = new Set(Object.keys(content_master_1.serverCharacters).map(Number));
const CDN_ITEM_IDS = new Set(content_master_1.serverItemIds);
const CDN_EQUIP_IDS = new Set(equipment_ids_json_1.default);
const VALID_MAIL_TYPES = new Set([1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15]);
function buildKnownDegreeIds() {
    const result = new Set(Object.keys(content_master_1.degreeDefinitions)
        .map(Number)
        .filter(id => Number.isInteger(id) && id > 0));
    for (const stages of Object.values(mission_degree_reward_json_1.default)) {
        for (const rows of Object.values(stages)) {
            for (const row of rows) {
                for (let base = 5; base < row.length; base += 6) {
                    if (Number(row[base]) !== 6)
                        continue;
                    const degreeId = Number(row[base + 5]);
                    if (Number.isInteger(degreeId) && degreeId > 0)
                        result.add(degreeId);
                }
            }
        }
    }
    for (const tiers of Object.values(carnival_event_total_score_rewards_json_1.default)) {
        for (const tier of tiers) {
            const rewards = Array.isArray(tier[2]) ? tier[2] : [];
            for (const reward of rewards) {
                if (Number(reward[0]) !== 7)
                    continue;
                const degreeId = Number(reward[1]);
                if (Number.isInteger(degreeId) && degreeId > 0)
                    result.add(degreeId);
            }
        }
    }
    return result;
}
const KNOWN_DEGREE_IDS = buildKnownDegreeIds();
const MAX_HISTORY = 20;
const sendHistory = [];
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.get("/daily", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        return reply.send((0, daily_vmoney_mail_1.getDailyVmoneyMailOverviewSync)());
    }));
    fastify.patch("/daily", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const update = (0, daily_vmoney_mail_1.validateDailyVmoneyMailConfigUpdate)(request.body);
            (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "mail", operation: "admin_daily_vmoney_config",
            }, () => (0, daily_vmoney_mail_1.updateDailyVmoneyMailConfigSync)(update));
            return reply.send((0, daily_vmoney_mail_1.getDailyVmoneyMailOverviewSync)());
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            return reply.status(400).send({ error: detail });
        }
    }));
    fastify.post("/daily/run", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const result = (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "mail", operation: "admin_daily_vmoney_dispatch",
            }, () => (0, daily_vmoney_mail_1.dispatchDailyVmoneyMailSync)(Date.now(), "manual", true));
            if (result.status === "disabled") {
                return reply.status(400).send({ error: "请先启用每日自动邮件" });
            }
            return reply.send({ result, overview: (0, daily_vmoney_mail_1.getDailyVmoneyMailOverviewSync)() });
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            return reply.status(500).send({ error: detail });
        }
    }));
    fastify.post("/send", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        const body = request.body;
        // 迁移期分流：SPA 返回 JSON，旧表单保留 redirect
        const json = (0, http_1.wantsJson)(request);
        const fail = (msg) => json
            ? reply.status(400).send({ error: msg })
            : reply.redirect("/mail?error=" + encodeURIComponent(msg));
        const parsedMailType = (0, admin_mail_rules_1.parseAdminMailInteger)(body.type, "附件类型", { min: 1, max: admin_mail_rules_1.ADMIN_MAIL_MAX_INT });
        if (!parsedMailType.ok || parsedMailType.value === null) {
            return fail(parsedMailType.ok ? "附件类型无效" : parsedMailType.error);
        }
        const mailType = parsedMailType.value;
        if (!VALID_MAIL_TYPES.has(mailType)) {
            return fail(`无效的附件类型：${mailType}`);
        }
        const parsedTypeId = (0, admin_mail_rules_1.parseAdminMailInteger)(body.type_id, "附件 ID", {
            min: 1,
            max: admin_mail_rules_1.ADMIN_MAIL_MAX_INT,
            allowNull: true,
        });
        if (!parsedTypeId.ok) {
            return fail(parsedTypeId.error);
        }
        const typeId = parsedTypeId.value;
        // Validate type_id against CDN data
        if (typeId !== null) {
            if (mailType === 5 && !CDN_CHAR_IDS.has(typeId)) {
                return fail(`角色 ID ${typeId} 不存在于 CDN 数据中`);
            }
            if (mailType === 1 && !CDN_ITEM_IDS.has(typeId)) {
                return fail(`道具 ID ${typeId} 不存在于 CDN 数据中`);
            }
            if (mailType === 13 && !KNOWN_DEGREE_IDS.has(typeId)) {
                return fail(`称号 ID ${typeId} 不存在于国服称号数据中`);
            }
            if (mailType === 6 && !CDN_EQUIP_IDS.has(typeId)) {
                return fail(`装备 ID ${typeId} 不存在于 CDN 数据中`);
            }
        }
        const parsedCount = (0, admin_mail_rules_1.parseAdminMailInteger)(body.number || (mailType === 13 ? "0" : "1"), "数量", {
            min: mailType === 13 ? 0 : 1,
            max: admin_mail_rules_1.ADMIN_MAIL_MAX_INT,
        });
        if (!parsedCount.ok || parsedCount.value === null) {
            return fail(parsedCount.ok ? "数量无效" : parsedCount.error);
        }
        const count = parsedCount.value;
        const subject = body.subject && body.subject.trim() ? body.subject.trim() : null;
        const desc = body.description && body.description.trim() ? body.description.trim() : null;
        const attachmentValidation = (0, admin_mail_rules_1.validateMailAttachment)({ mailType, typeId, count });
        if (!attachmentValidation.ok) {
            return fail(attachmentValidation.error);
        }
        if (subject !== null && subject.length > 64) {
            return fail("标题过长（最多 64 字符）");
        }
        if (desc !== null && desc.length > 512) {
            return fail("正文过长（最多 512 字符）");
        }
        // 发送对象解析：playerId（指定存档）> accountId（指定账号）> 全体存档
        // 旧 SSR 表单不带这两个参数，因此保持群发全体行为不变
        let targetPlayerIds;
        let targetLabel;
        const rawPlayerId = (_a = body.playerId) === null || _a === void 0 ? void 0 : _a.trim();
        const rawAccountId = (_b = body.accountId) === null || _b === void 0 ? void 0 : _b.trim();
        if (rawPlayerId) {
            const pid = parseInt(rawPlayerId);
            if (isNaN(pid) || pid < 1) {
                return fail("存档 ID 无效");
            }
            const player = (0, player_1.getPlayerSync)(pid);
            if (!player) {
                return fail(`存档 ${pid} 不存在`);
            }
            targetPlayerIds = [pid];
            targetLabel = `存档 #${pid}（${player.name}）`;
        }
        else if (rawAccountId) {
            const aid = parseInt(rawAccountId);
            if (isNaN(aid) || aid < 1) {
                return fail("账号 ID 无效");
            }
            if (!(0, account_1.getAccountSync)(aid)) {
                return fail(`账号 ${aid} 不存在`);
            }
            targetPlayerIds = (0, account_1.getAccountPlayersSync)(aid);
            targetLabel = `账号 #${aid}`;
        }
        else {
            targetPlayerIds = (0, account_1.getAllAccountsSync)().flatMap(account => (0, account_1.getAccountPlayersSync)(account.id));
            targetLabel = "全体";
        }
        const timestamps = (0, admin_mail_time_1.buildAdminMailTimestamps)();
        let sentCount = 0;
        for (const playerId of targetPlayerIds) {
            try {
                (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                    domain: "mail", playerId, operation: "admin_send_mail",
                }, () => (0, mail_1.insertMailSync)(playerId, {
                    reason_id: 0,
                    subject,
                    description: desc,
                    type: mailType,
                    type_id: typeId,
                    number: count,
                    receive_time: "0000-00-00 00:00:00",
                    create_time: timestamps.databaseTime,
                    reward_period_limited: 0,
                    reward_limit_time: null,
                }));
                sentCount++;
            }
            catch (_c) {
                // skip invalid players
            }
        }
        // 记录群发历史（最近 MAX_HISTORY 条）
        sendHistory.unshift({
            time: timestamps.chinaDisplayTime,
            type: mailType,
            typeId,
            number: count,
            subject,
            target: targetLabel,
            sent: sentCount,
        });
        if (sendHistory.length > MAX_HISTORY)
            sendHistory.length = MAX_HISTORY;
        if (json)
            return reply.send({ ok: true, sent: sentCount });
        return reply.redirect("/mail?ok=" + encodeURIComponent(`已向 ${sentCount} 个角色发送邮件`));
    }));
    // 群发历史（内存），供 SPA 展示最近几次群发
    fastify.get("/history", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        return reply.send(sendHistory);
    }));
});
exports.default = routes;
