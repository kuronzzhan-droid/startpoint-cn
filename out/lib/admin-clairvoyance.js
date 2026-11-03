"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildShortUpCharacterGachaTimeline = void 0;
const content_master_1 = require("./content-master");
const deep_freeze_1 = require("../content/deep-freeze");
const SHORT_TERM_MAX_DAYS = 60;
const CHARACTER_GACHA_TYPE = 0;
const NORMAL_PAGE_KIND = 0;
const gachas = content_master_1.serverGachas;
const characterMeta = content_master_1.serverCharacters;
const characterText = content_master_1.cdnCharacterTexts;
function parseCdnDate(value) {
    return new Date(`${value.replace(" ", "T")}+08:00`);
}
function durationDays(startDate, endDate) {
    return (parseCdnDate(endDate).getTime() - parseCdnDate(startDate).getTime()) / 86400000;
}
function getCharacterName(characterId) {
    var _a;
    const text = (_a = characterText[String(characterId)]) === null || _a === void 0 ? void 0 : _a[0];
    return {
        name: (text === null || text === void 0 ? void 0 : text[0]) || `#${characterId}`,
        title: (text === null || text === void 0 ? void 0 : text[3]) || "",
    };
}
function toRateUpCharacters(rawGacha) {
    var _a;
    const byId = new Map();
    for (const pool of Object.values((_a = rawGacha.pool) !== null && _a !== void 0 ? _a : {})) {
        for (const item of pool) {
            if (!item.isRateUp || byId.has(item.id))
                continue;
            byId.set(item.id, item);
        }
    }
    return [...byId.values()]
        .sort((a, b) => b.rank - a.rank || a.id - b.id)
        .map((item) => {
        var _a, _b, _c, _d, _e;
        const text = getCharacterName(item.id);
        const meta = characterMeta[String(item.id)];
        return {
            id: item.id,
            name: text.name,
            title: text.title,
            rarity: (_b = (_a = item.rarity) !== null && _a !== void 0 ? _a : meta === null || meta === void 0 ? void 0 : meta.rarity) !== null && _b !== void 0 ? _b : null,
            element: (_c = meta === null || meta === void 0 ? void 0 : meta.element) !== null && _c !== void 0 ? _c : null,
            rank: item.rank,
            odds: item.odds,
            isLimited: (_d = item.isLimited) !== null && _d !== void 0 ? _d : false,
            isExchangeable: (_e = item.isExchangeable) !== null && _e !== void 0 ? _e : false,
        };
    });
}
function toGacha(id, rawGacha) {
    var _a;
    if (rawGacha.type !== CHARACTER_GACHA_TYPE)
        return null;
    const pageKind = (_a = rawGacha.pageKind) !== null && _a !== void 0 ? _a : NORMAL_PAGE_KIND;
    if (pageKind !== NORMAL_PAGE_KIND)
        return null;
    const days = durationDays(rawGacha.startDate, rawGacha.endDate);
    if (days <= 0 || days > SHORT_TERM_MAX_DAYS)
        return null;
    const rateUpCharacters = toRateUpCharacters(rawGacha);
    if (rateUpCharacters.length === 0)
        return null;
    return {
        id: Number(id),
        name: rawGacha.name || `卡池 #${id}`,
        type: "character",
        pageKind,
        startDate: rawGacha.startDate,
        endDate: rawGacha.endDate,
        startTime: parseCdnDate(rawGacha.startDate).toISOString(),
        endTime: parseCdnDate(rawGacha.endDate).toISOString(),
        durationDays: Math.round(days * 10) / 10,
        rateUpCharacters,
    };
}
function buildSearchIndex(timeline) {
    var _a;
    const byCharacter = new Map();
    for (const gacha of timeline) {
        for (const character of gacha.rateUpCharacters) {
            const row = (_a = byCharacter.get(character.id)) !== null && _a !== void 0 ? _a : {
                characterId: character.id,
                name: character.name,
                title: character.title,
                gachas: [],
            };
            row.gachas.push({
                id: gacha.id,
                name: gacha.name,
                startDate: gacha.startDate,
                endDate: gacha.endDate,
            });
            byCharacter.set(character.id, row);
        }
    }
    return [...byCharacter.values()].sort((a, b) => a.characterId - b.characterId);
}
let staticTimelineCache = null;
function getStaticTimeline() {
    if (staticTimelineCache !== null)
        return staticTimelineCache;
    const timeline = Object.entries(gachas)
        .map(([id, rawGacha]) => toGacha(id, rawGacha))
        .filter((gacha) => gacha !== null)
        .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id - b.id);
    staticTimelineCache = (0, deep_freeze_1.deepFreeze)({
        timeline,
        searchIndex: buildSearchIndex(timeline),
    });
    return staticTimelineCache;
}
function buildShortUpCharacterGachaTimeline(now = new Date()) {
    const staticTimeline = getStaticTimeline();
    const nowMs = now.getTime();
    return {
        scope: "short-up-character-gacha",
        currentTime: now.toISOString(),
        current: staticTimeline.timeline.filter((gacha) => Date.parse(gacha.startTime) <= nowMs
            && Date.parse(gacha.endTime) >= nowMs),
        timeline: staticTimeline.timeline,
        searchIndex: staticTimeline.searchIndex,
    };
}
exports.buildShortUpCharacterGachaTimeline = buildShortUpCharacterGachaTimeline;
