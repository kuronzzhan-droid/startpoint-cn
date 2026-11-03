"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActivePopupNews = exports.getPublishedNews = exports.saveNewsConfig = exports.loadNewsConfig = exports.readNewsConfigState = exports.normalizeNewsConfig = exports.parseNewsDate = exports.getNewsConfigPath = exports.NEWS_CATEGORY_LABELS = void 0;
const file_exists_1 = require("./file-exists");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
exports.NEWS_CATEGORY_LABELS = {
    1: "最新资讯",
    2: "活动信息",
    3: "问题修复",
    4: "系统公告",
};
const DEFAULT_POPUP = {
    enabled: false,
    news_id: null,
    mode: "once_per_news",
    start_time: null,
    end_time: null,
};
const DEFAULT_CONFIG = {
    version: 1,
    popup: Object.assign({}, DEFAULT_POPUP),
    news: [],
};
let lastGoodConfig = null;
let lastReportedError = null;
function getNewsConfigPath() {
    var _a;
    const configured = (_a = process.env.NEWS_CONFIG_PATH) === null || _a === void 0 ? void 0 : _a.trim();
    return configured
        ? path_1.default.resolve(configured)
        : path_1.default.resolve(__dirname, "..", "..", "assets", "news.json");
}
exports.getNewsConfigPath = getNewsConfigPath;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requiredString(value, field, maxLength) {
    if (typeof value !== "string")
        throw new Error(`${field} 必须是字符串`);
    const normalized = value.trim();
    if (!normalized)
        throw new Error(`${field} 不能为空`);
    if (normalized.length > maxLength)
        throw new Error(`${field} 最多 ${maxLength} 个字符`);
    return normalized;
}
function optionalString(value, field, maxLength) {
    if (value === null || value === undefined || value === "")
        return null;
    if (typeof value !== "string")
        throw new Error(`${field} 必须是字符串或 null`);
    const normalized = value.trim();
    if (normalized.length > maxLength)
        throw new Error(`${field} 最多 ${maxLength} 个字符`);
    return normalized || null;
}
function integerInRange(value, field, minimum, maximum) {
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new Error(`${field} 必须是 ${minimum}–${maximum} 的整数`);
    }
    return Number(value);
}
function parseNewsDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (!match)
        return null;
    const [, year, month, day, hour, minute, second] = match.map(Number);
    const parsed = new Date(year, month - 1, day, hour, minute, second, 0);
    if (parsed.getFullYear() !== year
        || parsed.getMonth() !== month - 1
        || parsed.getDate() !== day
        || parsed.getHours() !== hour
        || parsed.getMinutes() !== minute
        || parsed.getSeconds() !== second)
        return null;
    return parsed;
}
exports.parseNewsDate = parseNewsDate;
function requiredDateString(value, field) {
    const normalized = requiredString(value, field, 19);
    if (parseNewsDate(normalized) === null) {
        throw new Error(`${field} 必须使用 YYYY-MM-DD HH:mm:ss 格式`);
    }
    return normalized;
}
function optionalDateString(value, field) {
    const normalized = optionalString(value, field, 19);
    if (normalized !== null && parseNewsDate(normalized) === null) {
        throw new Error(`${field} 必须使用 YYYY-MM-DD HH:mm:ss 格式`);
    }
    return normalized;
}
function normalizeXmlVoidElements(html) {
    // The client uses flash.Xml.parse, so HTML void elements must use XML
    // self-closing syntax. Browser innerHTML and older saved announcements
    // commonly serialize these as <img>, <br>, or <hr> instead.
    return html.replace(/<(img|br|hr)\b([^>]*)>/gi, (full, tag, attributes) => {
        const trimmed = attributes.trimEnd();
        return trimmed.endsWith("/")
            ? `<${tag}${attributes}>`
            : `<${tag}${attributes} />`;
    });
}
function normalizeNewsImagePlacement(html) {
    // RichTextLayoutParser only walks child nodes for container elements such
    // as div. A standalone image inside p is treated as paragraph text and is
    // therefore silently omitted. Move the editor's image-only paragraphs to
    // the supported centered container shape.
    return html.replace(/<p>\s*(<img\b[^>]*\/>)\s*<\/p>/gi, '<div class="center">$1</div>');
}
function normalizeNewsHtml(html) {
    const trimmed = normalizeNewsImagePlacement(normalizeXmlVoidElements(html.trim()));
    if (!trimmed)
        return "";
    if (/<!doctype|<html[\s>]/i.test(trimmed))
        return trimmed;
    if (/^<body[\s>]/i.test(trimmed))
        return `<html lang="zh">${trimmed}</html>`;
    return `<html lang="zh"><body>${trimmed}</body></html>`;
}
/**
 * The shipped CN client renders announcement HTML with RichTextLayoutParser.
 * Its remote image loader accepts HTTPS (and local `file:` resources) only;
 * an HTTP image URL reaches the client but fails with unsupported URL error
 * 7612. Validate image sources while saving so a bad announcement cannot be
 * published successfully and then crash when a player opens it.
 */
function validateNewsHtml(html, index) {
    var _a;
    const imageTags = (_a = html.match(/<img\b[^>]*>/gi)) !== null && _a !== void 0 ? _a : [];
    imageTags.forEach((tag, imageIndex) => {
        var _a, _b, _c;
        const sourceMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
        const source = (_c = (_b = (_a = sourceMatch === null || sourceMatch === void 0 ? void 0 : sourceMatch[1]) !== null && _a !== void 0 ? _a : sourceMatch === null || sourceMatch === void 0 ? void 0 : sourceMatch[2]) !== null && _b !== void 0 ? _b : sourceMatch === null || sourceMatch === void 0 ? void 0 : sourceMatch[3]) !== null && _c !== void 0 ? _c : "";
        if (!source)
            throw new Error(`news[${index}].html 中的第 ${imageIndex + 1} 张图片缺少 src`);
        if (source.length > 2048)
            throw new Error(`news[${index}].html 中的图片 URL 过长`);
        let protocol;
        try {
            protocol = new URL(source).protocol.toLowerCase();
        }
        catch (_d) {
            throw new Error(`news[${index}].html 中的图片 URL 无效：${source}`);
        }
        if (protocol !== "https:" && protocol !== "file:") {
            throw new Error(`news[${index}].html 中的图片必须使用 HTTPS URL（当前：${protocol || "无协议"}）`);
        }
    });
}
function normalizeNewsItem(value, index) {
    var _a, _b, _c, _d;
    if (!isRecord(value))
        throw new Error(`news[${index}] 必须是对象`);
    // These values are enums in the shipped CN client, not arbitrary asset
    // IDs. Keeping the server-side range aligned with the client prevents a
    // malformed announcement from reaching a switch with no matching case.
    const label = integerInRange((_a = value.label) !== null && _a !== void 0 ? _a : 1, `news[${index}].label`, 1, 8);
    const fallbackCategory = label >= 1 && label <= 4 ? label : 1;
    const category = integerInRange((_b = value.category) !== null && _b !== void 0 ? _b : fallbackCategory, `news[${index}].category`, 1, 4);
    if (typeof value.html !== "string")
        throw new Error(`news[${index}].html 必须是字符串`);
    if (!value.html.trim())
        throw new Error(`news[${index}].html 不能为空`);
    if (value.html.length > 1000000)
        throw new Error(`news[${index}].html 最多 1000000 个字符`);
    validateNewsHtml(value.html, index);
    const html = normalizeNewsHtml(value.html);
    if (value.published !== undefined && typeof value.published !== "boolean") {
        throw new Error(`news[${index}].published 必须是布尔值`);
    }
    const thumbnailPath = optionalString(value.thumbnail_path, `news[${index}].thumbnail_path`, 512);
    if (thumbnailPath !== null) {
        throw new Error(`news[${index}].thumbnail_path 当前客户端不支持，请留空`);
    }
    return {
        id: integerInRange(value.id, `news[${index}].id`, 1, 2147483647),
        title: requiredString(value.title, `news[${index}].title`, 128),
        date: requiredDateString(value.date, `news[${index}].date`),
        category,
        label,
        thumbnail: integerInRange((_c = value.thumbnail) !== null && _c !== void 0 ? _c : 1, `news[${index}].thumbnail`, 1, 13),
        thumbnail_path: null,
        added_time: optionalDateString(value.added_time, `news[${index}].added_time`),
        html,
        published: (_d = value.published) !== null && _d !== void 0 ? _d : true,
    };
}
function normalizePopup(value) {
    var _a, _b;
    if (value === undefined || value === null)
        return Object.assign({}, DEFAULT_POPUP);
    if (!isRecord(value))
        throw new Error("popup 必须是对象");
    if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
        throw new Error("popup.enabled 必须是布尔值");
    }
    const rawNewsId = value.news_id;
    const newsId = rawNewsId === null || rawNewsId === undefined || rawNewsId === ""
        ? null
        : integerInRange(rawNewsId, "popup.news_id", 1, 2147483647);
    const mode = (_a = value.mode) !== null && _a !== void 0 ? _a : DEFAULT_POPUP.mode;
    if (mode !== "every_login" && mode !== "once_per_news") {
        throw new Error("popup.mode 必须是 every_login 或 once_per_news");
    }
    return {
        enabled: (_b = value.enabled) !== null && _b !== void 0 ? _b : false,
        news_id: newsId,
        mode,
        start_time: optionalDateString(value.start_time, "popup.start_time"),
        end_time: optionalDateString(value.end_time, "popup.end_time"),
    };
}
function normalizeNewsConfig(value) {
    var _a;
    const root = Array.isArray(value)
        ? { version: 1, popup: DEFAULT_POPUP, news: value }
        : value;
    if (!isRecord(root))
        throw new Error("公告配置根节点必须是对象或兼容的公告数组");
    if (root.version !== undefined && root.version !== 1)
        throw new Error("公告配置 version 仅支持 1");
    if (!Array.isArray(root.news))
        throw new Error("news 必须是数组");
    const news = root.news.map(normalizeNewsItem);
    const ids = new Set();
    for (const item of news) {
        if (ids.has(item.id))
            throw new Error(`公告 ID ${item.id} 重复`);
        ids.add(item.id);
    }
    const popup = normalizePopup(root.popup);
    if (popup.enabled && popup.news_id === null)
        throw new Error("启用弹窗时必须选择公告");
    if (popup.news_id !== null && !ids.has(popup.news_id)) {
        throw new Error(`弹窗公告 ID ${popup.news_id} 不存在`);
    }
    if (popup.enabled && !((_a = news.find(item => item.id === popup.news_id)) === null || _a === void 0 ? void 0 : _a.published)) {
        throw new Error("启用弹窗时必须选择已发布公告");
    }
    if (popup.start_time !== null && popup.end_time !== null) {
        if (parseNewsDate(popup.start_time).getTime() >= parseNewsDate(popup.end_time).getTime()) {
            throw new Error("弹窗结束时间必须晚于开始时间");
        }
    }
    return { version: 1, popup, news };
}
exports.normalizeNewsConfig = normalizeNewsConfig;
function cloneConfig(config) {
    return JSON.parse(JSON.stringify(config));
}
function readNewsConfigState() {
    const configPath = getNewsConfigPath();
    try {
        if (!(0, file_exists_1.existsSync)(configPath))
            throw new Error(`公告配置不存在：${configPath}`);
        const parsed = JSON.parse((0, fs_1.readFileSync)(configPath, "utf-8"));
        const config = normalizeNewsConfig(parsed);
        lastGoodConfig = cloneConfig(config);
        lastReportedError = null;
        return { config, error: null, path: configPath };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (lastReportedError !== message) {
            console.error(`[NEWS] 公告配置读取失败，继续使用最近一次有效配置：${message}`);
            lastReportedError = message;
        }
        return {
            config: cloneConfig(lastGoodConfig !== null && lastGoodConfig !== void 0 ? lastGoodConfig : DEFAULT_CONFIG),
            error: message,
            path: configPath,
        };
    }
}
exports.readNewsConfigState = readNewsConfigState;
function loadNewsConfig() {
    return readNewsConfigState().config;
}
exports.loadNewsConfig = loadNewsConfig;
function saveNewsConfig(value) {
    const config = normalizeNewsConfig(value);
    const configPath = getNewsConfigPath();
    const temporaryPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
    try {
        (0, fs_1.writeFileSync)(temporaryPath, `${JSON.stringify(config, null, 4)}\n`, "utf-8");
        (0, fs_1.renameSync)(temporaryPath, configPath);
    }
    finally {
        if ((0, file_exists_1.existsSync)(temporaryPath))
            (0, fs_1.unlinkSync)(temporaryPath);
    }
    lastGoodConfig = cloneConfig(config);
    lastReportedError = null;
    return config;
}
exports.saveNewsConfig = saveNewsConfig;
function getPublishedNews(config) {
    return config.news
        .filter(item => item.published)
        .sort((left, right) => right.date.localeCompare(left.date) || right.id - left.id);
}
exports.getPublishedNews = getPublishedNews;
function getActivePopupNews(config, now = new Date()) {
    const popup = config.popup;
    if (!popup.enabled || popup.news_id === null)
        return null;
    const start = popup.start_time === null ? null : parseNewsDate(popup.start_time);
    const end = popup.end_time === null ? null : parseNewsDate(popup.end_time);
    if (start !== null && now < start)
        return null;
    if (end !== null && now >= end)
        return null;
    const item = config.news.find(candidate => candidate.id === popup.news_id);
    return (item === null || item === void 0 ? void 0 : item.published) ? item : null;
}
exports.getActivePopupNews = getActivePopupNews;
