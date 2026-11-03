"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchLeaderboardRewardTier = exports.getLeaderboardRewardTiers = exports.isLegacyDefaultLeaderboardRewardTiers = exports.resolveLeaderboardRewardTiers = exports.upgradeLeaderboardRewardRules = exports.buildAbyssExRewardRules = exports.DEEP_ABYSS_EX_REWARD_TIERS = exports.DEEP_ABYSS_REWARD_TIERS = exports.isPercentRewardTier = void 0;
const leaderboard_reward_policy_json_1 = __importDefault(require("../../../assets/leaderboard_reward_policy.json"));
const abyss_ex_campus_season_template_json_1 = __importDefault(require("../../../assets/abyss_ex_campus_season_template.json"));
function isPercentRewardTier(tier) {
    return "fromPercent" in tier;
}
exports.isPercentRewardTier = isPercentRewardTier;
const LEGACY_DEEP_ABYSS_REWARD_TIERS = [
    {
        fromRank: 1, toRank: 1, itemId: 999016, itemName: "终焉裁定十连券", itemCount: 10,
        degreeId: 9900002, degreeName: "深渊冠军",
        degreeImage: "dynamic/degree/degree_mod_abyss_rush_champion.png",
    },
    {
        fromRank: 2, toRank: 3, itemId: 999016, itemName: "终焉裁定十连券", itemCount: 5,
        degreeId: 9900003, degreeName: "深渊亚季军",
        degreeImage: "dynamic/degree/degree_mod_abyss_rush_runner_up.png",
    },
    {
        fromRank: 4, toRank: 15, itemId: 999016, itemName: "终焉裁定十连券", itemCount: 2,
        degreeId: 9900004, degreeName: "深渊上位者",
        degreeImage: "dynamic/degree/degree_mod_abyss_rush_upper_rank.png",
    },
    {
        fromRank: 16, toRank: null, itemId: 999015, itemName: "终焉裁定券", itemCount: 1,
        degreeId: 9900005, degreeName: "深渊参与者",
        degreeImage: "dynamic/degree/degree_mod_abyss_rush_participant.png",
    },
];
// One early local database used 999015 for all legacy item rows.  Recognize
// it too so that an existing installation is upgraded instead of retaining
// the obsolete four-tier display indefinitely.
const LEGACY_DEEP_ABYSS_REWARD_TIERS_ALT = [
    Object.assign(Object.assign({}, LEGACY_DEEP_ABYSS_REWARD_TIERS[0]), { itemId: 999015, itemName: "终焉裁定券" }),
    Object.assign(Object.assign({}, LEGACY_DEEP_ABYSS_REWARD_TIERS[1]), { itemId: 999015, itemName: "终焉裁定券" }),
    Object.assign(Object.assign({}, LEGACY_DEEP_ABYSS_REWARD_TIERS[2]), { itemId: 999015, itemName: "终焉裁定券" }),
    Object.assign(Object.assign({}, LEGACY_DEEP_ABYSS_REWARD_TIERS[3]), { itemId: null, itemName: null, itemCount: 0 }),
];
const FIXED_DEEP_ABYSS_REWARD_TIERS = [
    {
        fromRank: 1,
        toRank: 1,
        itemId: 999018,
        itemName: "竞速池十连券",
        itemCount: 10,
        degreeId: 9900007,
        degreeName: "星渊主宰者",
        degreeImage: "dynamic/degree/degree_mod_stellar_abyss_overlord.png",
    },
    {
        fromRank: 2,
        toRank: 2,
        itemId: 999018,
        itemName: "竞速池十连券",
        itemCount: 5,
        degreeId: 9900008,
        degreeName: "星渊征服者",
        degreeImage: "dynamic/degree/degree_mod_stellar_abyss_conqueror.png",
    },
    {
        fromRank: 3,
        toRank: 3,
        itemId: 999018,
        itemName: "竞速池十连券",
        itemCount: 5,
        degreeId: 9900009,
        degreeName: "星渊讨伐者",
        degreeImage: "dynamic/degree/degree_mod_stellar_abyss_slayer.png",
    },
    {
        fromRank: 4,
        toRank: 15,
        itemId: 999018,
        itemName: "竞速池十连券",
        itemCount: 2,
        degreeId: 9900010,
        degreeName: "破阵先行者",
        degreeImage: "dynamic/degree/degree_mod_breakthrough_pioneer.png",
    },
    {
        fromRank: 16,
        toRank: null,
        itemId: 999017,
        itemName: "竞速池扭蛋券",
        itemCount: 1,
        degreeId: 9900011,
        degreeName: "共赴星渊",
        degreeImage: "dynamic/degree/degree_mod_stellar_abyss_together.png",
    },
];
exports.DEEP_ABYSS_REWARD_TIERS = FIXED_DEEP_ABYSS_REWARD_TIERS.map((_a, index) => {
    var { fromRank, toRank } = _a, reward = __rest(_a, ["fromRank", "toRank"]);
    return (Object.assign(Object.assign({}, reward), { fromPercent: index === 0 ? 0 : leaderboard_reward_policy_json_1.default.percentileCutoffs[index - 1], toPercent: leaderboard_reward_policy_json_1.default.percentileCutoffs[index] }));
});
exports.DEEP_ABYSS_EX_REWARD_TIERS = exports.DEEP_ABYSS_REWARD_TIERS.map((tier, index) => (Object.assign(Object.assign({}, tier), { degreeId: abyss_ex_campus_season_template_json_1.default.degree_tiers[index].degreeId, degreeName: abyss_ex_campus_season_template_json_1.default.degree_tiers[index].degreeName, degreeImage: abyss_ex_campus_season_template_json_1.default.degree_tiers[index].degreeImage })));
function buildAbyssExRewardRules(normal) {
    if (normal.length !== abyss_ex_campus_season_template_json_1.default.degree_tiers.length) {
        throw new Error("EX campus rewards require the five normal Abyss tiers.");
    }
    return normal.map((tier, index) => (Object.assign(Object.assign({}, tier), { degreeId: abyss_ex_campus_season_template_json_1.default.degree_tiers[index].degreeId, degreeName: abyss_ex_campus_season_template_json_1.default.degree_tiers[index].degreeName, degreeImage: abyss_ex_campus_season_template_json_1.default.degree_tiers[index].degreeImage })));
}
exports.buildAbyssExRewardRules = buildAbyssExRewardRules;
// Upgrade the five existing positions without overwriting customized rewards.
function upgradeLeaderboardRewardRules(competitionKey, tiers) {
    if (competitionKey === "rush:700100:1" && tiers.length === 0) {
        return exports.DEEP_ABYSS_EX_REWARD_TIERS.map(tier => (Object.assign({}, tier)));
    }
    if (competitionKey !== "rush:700099:1")
        return null;
    if (isLegacyDefaultLeaderboardRewardTiers(competitionKey, tiers)) {
        return [...exports.DEEP_ABYSS_REWARD_TIERS];
    }
    // Existing databases already persisted the first 1% policy. Upgrade only
    // those exact five boundaries; retain prizes and unrelated custom ranges.
    const previousCutoffs = [1, 5, 10, 20, 100];
    if (tiers.length === previousCutoffs.length && tiers.every((tier, index) => isPercentRewardTier(tier)
        && tier.fromPercent === (index === 0 ? 0 : previousCutoffs[index - 1])
        && tier.toPercent === previousCutoffs[index])) {
        return tiers.map((tier, index) => (Object.assign(Object.assign({}, tier), { fromPercent: exports.DEEP_ABYSS_REWARD_TIERS[index].fromPercent, toPercent: exports.DEEP_ABYSS_REWARD_TIERS[index].toPercent })));
    }
    if (tiers.length !== FIXED_DEEP_ABYSS_REWARD_TIERS.length || !tiers.every((tier, index) => !isPercentRewardTier(tier)
        && tier.fromRank === FIXED_DEEP_ABYSS_REWARD_TIERS[index].fromRank
        && tier.toRank === FIXED_DEEP_ABYSS_REWARD_TIERS[index].toRank))
        return null;
    return tiers.map((tier, index) => {
        const _a = tier, { fromRank, toRank } = _a, reward = __rest(_a, ["fromRank", "toRank"]);
        return Object.assign(Object.assign({}, reward), { fromPercent: exports.DEEP_ABYSS_REWARD_TIERS[index].fromPercent, toPercent: exports.DEEP_ABYSS_REWARD_TIERS[index].toPercent });
    });
}
exports.upgradeLeaderboardRewardRules = upgradeLeaderboardRewardRules;
function resolveLeaderboardRewardTiers(rules, total) {
    if (!Number.isSafeInteger(total) || total < 0)
        throw new Error("Invalid ranked player count.");
    return rules.flatMap(rule => {
        if (!isPercentRewardTier(rule))
            return [Object.assign({}, rule)];
        const { fromPercent, toPercent } = rule, reward = __rest(rule
        // Integer percentages avoid rounding a floating-point product twice.
        , ["fromPercent", "toPercent"]);
        // Integer percentages avoid rounding a floating-point product twice.
        const fromRank = Number((BigInt(total) * BigInt(fromPercent) + BigInt(99)) / BigInt(100)) + 1;
        const endRank = Number((BigInt(total) * BigInt(toPercent) + BigInt(99)) / BigInt(100));
        if (fromRank > endRank)
            return [];
        return [Object.assign(Object.assign({}, reward), { fromRank, toRank: toPercent === 100 ? null : endRank })];
    });
}
exports.resolveLeaderboardRewardTiers = resolveLeaderboardRewardTiers;
function isLegacyDefaultLeaderboardRewardTiers(competitionKey, tiers) {
    if (competitionKey !== "rush:700099:1" || tiers.length !== LEGACY_DEEP_ABYSS_REWARD_TIERS.length) {
        return false;
    }
    const fields = [
        "fromRank", "toRank", "itemId", "itemName", "itemCount",
        "degreeId", "degreeName", "degreeImage",
    ];
    return [LEGACY_DEEP_ABYSS_REWARD_TIERS, LEGACY_DEEP_ABYSS_REWARD_TIERS_ALT].some(legacy => tiers.every((tier, index) => !isPercentRewardTier(tier)
        && fields.every(field => tier[field] === legacy[index][field])));
}
exports.isLegacyDefaultLeaderboardRewardTiers = isLegacyDefaultLeaderboardRewardTiers;
function getLeaderboardRewardTiers(competitionKey) {
    return competitionKey === "rush:700099:1" ? exports.DEEP_ABYSS_REWARD_TIERS
        : competitionKey === "rush:700100:1" ? exports.DEEP_ABYSS_EX_REWARD_TIERS : [];
}
exports.getLeaderboardRewardTiers = getLeaderboardRewardTiers;
function matchLeaderboardRewardTier(tiers, rank) {
    var _a;
    return (_a = tiers.find(tier => rank >= tier.fromRank && (tier.toRank === null || rank <= tier.toRank))) !== null && _a !== void 0 ? _a : null;
}
exports.matchLeaderboardRewardTier = matchLeaderboardRewardTier;
