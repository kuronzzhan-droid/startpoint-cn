"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMailAttachment = exports.parseAdminMailInteger = exports.getMailAttachmentRule = exports.mailTypeNeedsTypeId = exports.ADMIN_MAIL_MAX_INT = void 0;
exports.ADMIN_MAIL_MAX_INT = 2147483647;
const TYPE_IDS_REQUIRED = new Set([1, 5, 6, 13]);
const DEFAULT_RULE = {
    min: 1,
    max: exports.ADMIN_MAIL_MAX_INT,
    label: "通用资源",
    reason: "使用 int32 安全范围",
};
const SINGLE_RULE = {
    min: 1,
    max: 1,
    label: "唯一附件",
    reason: "角色 / 装备每封邮件只能发送 1 个",
};
const TITLE_RULE = {
    min: 0,
    max: 0,
    label: "称号",
    reason: "称号 ID 存放在 type_id 中，数量字段固定为 0",
};
const ITEM_RULES = [
    {
        test: itemId => itemId >= 100 && itemId < 1000,
        rule: { min: 1, max: 99, label: "消耗品", reason: "体力药等消耗品采用较低持有上限" },
    },
    {
        test: itemId => itemId > 0 && itemId < 100000,
        rule: { min: 1, max: 9999, label: "素材", reason: "元素、结晶和升级素材按 9999 封顶" },
    },
    {
        test: itemId => itemId >= 100000 && itemId < 1000000,
        rule: { min: 1, max: 99999, label: "锻造石 / 特殊魂珠", reason: "高频资源按 99999 封顶" },
    },
    {
        test: itemId => itemId >= 1000000,
        rule: { min: 1, max: 999999, label: "活动币 / 装备魂珠", reason: "长期累计资源按 999999 封顶" },
    },
];
function mailTypeNeedsTypeId(mailType) {
    return TYPE_IDS_REQUIRED.has(mailType);
}
exports.mailTypeNeedsTypeId = mailTypeNeedsTypeId;
function getMailAttachmentRule(mailType, typeId = null) {
    var _a, _b;
    if (mailType === 13)
        return TITLE_RULE;
    if (mailType === 5 || mailType === 6)
        return SINGLE_RULE;
    if (mailType !== 1 || typeId === null)
        return DEFAULT_RULE;
    return (_b = (_a = ITEM_RULES.find(({ test }) => test(typeId))) === null || _a === void 0 ? void 0 : _a.rule) !== null && _b !== void 0 ? _b : DEFAULT_RULE;
}
exports.getMailAttachmentRule = getMailAttachmentRule;
function parseAdminMailInteger(raw, label, options = {}) {
    var _a, _b;
    if (raw === null || raw === undefined || raw === "") {
        if (options.allowNull)
            return { ok: true, value: null };
        return { ok: false, error: `${label}不能为空` };
    }
    const text = typeof raw === "number" ? String(raw) : String(raw).trim();
    if (!/^[0-9]+$/.test(text)) {
        return { ok: false, error: `${label}必须是整数` };
    }
    const value = Number(text);
    if (!Number.isSafeInteger(value)) {
        return { ok: false, error: `${label}超出安全整数范围` };
    }
    const min = (_a = options.min) !== null && _a !== void 0 ? _a : 0;
    const max = (_b = options.max) !== null && _b !== void 0 ? _b : exports.ADMIN_MAIL_MAX_INT;
    if (value < min || value > max) {
        return { ok: false, error: `${label}超出范围（需 ${min}-${max}）` };
    }
    return { ok: true, value };
}
exports.parseAdminMailInteger = parseAdminMailInteger;
function validateMailAttachment(input) {
    const needsTypeId = mailTypeNeedsTypeId(input.mailType);
    if (needsTypeId && input.typeId === null) {
        return { ok: false, error: "此附件类型需要填写附件 ID" };
    }
    if (!needsTypeId && input.typeId !== null) {
        return { ok: false, error: "此附件类型不需要附件 ID" };
    }
    const rule = getMailAttachmentRule(input.mailType, input.typeId);
    if (input.count < rule.min || input.count > rule.max) {
        if (rule.max === 0 || rule.max === 1) {
            return { ok: false, error: `${rule.reason}` };
        }
        return { ok: false, error: `${rule.label}数量最多 ${rule.max}（${rule.reason}）` };
    }
    return { ok: true, value: rule };
}
exports.validateMailAttachment = validateMailAttachment;
