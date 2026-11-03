"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLeaderboardTermsText = exports.buildUnavailableNativeLeaderboardPayload = exports.buildNativeLeaderboardPayload = exports.getLeaderboardPlayedPartiesSync = exports.getOfficialLeaderboardPageSync = exports.nativeRow = exports.toProfileTargetId = exports.fromProfileTargetId = exports.RUSH_PROFILE_ID_BASE = void 0;
const public_payload_1 = require("../weapon-riven/public-payload");
const content_master_1 = require("../content-master");
const player_1 = require("../../data/domains/player");
const follow_1 = require("../../data/domains/follow");
const leaderboard_1 = require("../../data/domains/leaderboard");
const rushEvent_1 = require("../../data/domains/rushEvent");
const party_1 = require("../../data/domains/party");
const stamina_1 = require("../stamina");
const profileFavorite_1 = require("../profileFavorite");
const competition_1 = require("./competition");
const rewards_1 = require("./rewards");
const settlement_1 = require("./settlement");
const availability_1 = require("./availability");
const schedule_time_1 = require("./schedule-time");
var profile_target_1 = require("../profile-target");
Object.defineProperty(exports, "RUSH_PROFILE_ID_BASE", { enumerable: true, get: function () { return profile_target_1.RUSH_PROFILE_ID_BASE; } });
Object.defineProperty(exports, "fromProfileTargetId", { enumerable: true, get: function () { return profile_target_1.fromProfileTargetId; } });
Object.defineProperty(exports, "toProfileTargetId", { enumerable: true, get: function () { return profile_target_1.toProfileTargetId; } });
function getRealProfileViewerId(playerId) {
    var _a;
    // The leaderboard stores a player archive id, but the client profile API
    // requires the player's real viewer/session id. Never expose the archive
    // id as a fake viewer id; rows without a live identity are not clickable.
    return (_a = (0, follow_1.getViewerIdByPlayerIdSync)(playerId)) !== null && _a !== void 0 ? _a : 0;
}
function formatTime(ms) {
    const value = Math.max(0, Math.trunc(ms));
    const minutes = Math.floor(value / 60000);
    const seconds = Math.floor(value / 1000) % 60;
    const centiseconds = Math.floor(value / 10) % 100;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}
function thumbnailPath(characterId, evolutionLevel) {
    if (characterId === null || (characterId >= 700000 && characterId <= 700099))
        return null;
    const entry = content_master_1.cdnCharacters[String(characterId)];
    const row = Array.isArray(entry) && Array.isArray(entry[0]) ? entry[0] : entry;
    const codeName = Array.isArray(row) && typeof row[0] === "string" ? row[0] : null;
    if (codeName === null || codeName === "")
        return null;
    const level = Math.max(0, Math.min(1, Math.trunc(evolutionLevel !== null && evolutionLevel !== void 0 ? evolutionLevel : 0)));
    return `character/${codeName}/ui/thumb_party_unison_${level}`;
}
function displayedParty(record, favorite) {
    var _a, _b, _c, _d;
    const characterIds = [];
    const evolutionImgLevels = [];
    for (let slot = 0; slot < 3; slot++) {
        const favoriteId = (_a = favorite === null || favorite === void 0 ? void 0 : favorite.characterIds[slot]) !== null && _a !== void 0 ? _a : null;
        const favoriteLevel = (_b = favorite === null || favorite === void 0 ? void 0 : favorite.evolutionImgLevels[slot]) !== null && _b !== void 0 ? _b : null;
        if (thumbnailPath(favoriteId, favoriteLevel) !== null) {
            characterIds.push(favoriteId);
            evolutionImgLevels.push(favoriteLevel);
        }
        else {
            characterIds.push((_c = record.characterIds[slot]) !== null && _c !== void 0 ? _c : null);
            evolutionImgLevels.push((_d = record.evolutionImgLevels[slot]) !== null && _d !== void 0 ? _d : null);
        }
    }
    return { characterIds, evolutionImgLevels };
}
function officialRow(record, favorite) {
    const party = displayedParty(record, favorite);
    return {
        rank_number: record.rankNumber,
        clear_count: record.clearCount,
        best_round: record.totalRounds,
        elapsed_time_ms: record.clientBattleMs,
        name: record.displayName,
        party_member_list: party.characterIds.flatMap((characterId, slot) => {
            var _a;
            return characterId === null ? [] : [{
                    character_id: characterId,
                    evolution_img_level: (_a = party.evolutionImgLevels[slot]) !== null && _a !== void 0 ? _a : 0,
                }];
        }),
        user_rank: (0, stamina_1.getRankDegree)(record.rankPoint),
    };
}
function nativeRow(record, favorite) {
    var _a, _b, _c;
    const party = displayedParty(record, favorite);
    const paths = party.characterIds.map((id, slot) => { var _a; return thumbnailPath(id, (_a = party.evolutionImgLevels[slot]) !== null && _a !== void 0 ? _a : 0); });
    return {
        rank: `${record.rankNumber}位`,
        visible: true,
        level: `RANK${(0, stamina_1.getRankDegree)(record.rankPoint)}`,
        name: record.displayName,
        count: `通关次数：${record.clearCount === null ? "未记录" : `${record.clearCount}次`}`,
        time: `TIME: ${formatTime(record.clientBattleMs)}`,
        a: (_a = paths[0]) !== null && _a !== void 0 ? _a : null,
        b: (_b = paths[1]) !== null && _b !== void 0 ? _b : null,
        c: (_c = paths[2]) !== null && _c !== void 0 ? _c : null,
        id: record.playerExists ? getRealProfileViewerId(record.playerId) : 0,
    };
}
exports.nativeRow = nativeRow;
function outOfRankRow(playerId) {
    const player = (0, player_1.getPlayerSync)(playerId);
    if (player === null)
        return null;
    return {
        rank: "排名外",
        visible: false,
        level: `RANK${(0, stamina_1.getRankDegree)(player.rankPoint)}`,
        name: player.name,
        count: "通关次数：0次",
        time: "TIME: --:--.--",
        a: null,
        b: null,
        c: null,
        id: getRealProfileViewerId(playerId),
    };
}
function getOfficialLeaderboardPageSync(input) {
    var _a;
    const season = getDisplaySeason(input.competition.key, (_a = input.acceptingScores) !== null && _a !== void 0 ? _a : true);
    const { total, filter } = (0, settlement_1.getLeaderboardSeasonRewardViewSync)(input.competition.key, season);
    const visibleTotal = Math.min(total, input.competition.displayLimit);
    const pageMax = Math.max(1, Math.ceil(visibleTotal / input.competition.pageSize));
    const requestedPage = Number.isFinite(input.page) ? Math.trunc(input.page) : 0;
    const page = Math.max(0, Math.min(requestedPage, pageMax - 1));
    const { rows, mine } = (0, leaderboard_1.getLeaderboardRankPageAndPlayerSync)({
        competitionKey: input.competition.key,
        season,
        playerId: input.playerId,
        offset: page * input.competition.pageSize,
        filter,
        limit: Math.min(input.competition.pageSize, Math.max(0, input.competition.displayLimit - page * input.competition.pageSize)),
    });
    const favorites = (0, party_1.getFirstPlayerPartyDisplaySelectionsSync)([
        ...rows.map(record => record.playerId),
        ...(mine === null ? [] : [mine.playerId]),
    ], profileFavorite_1.PROFILE_FAVORITE_PARTY_CATEGORY);
    return {
        currentPage: page + 1,
        pageMax,
        total,
        myData: mine === null ? null : officialRow(mine, favorites.get(mine.playerId)),
        rows: rows.map(record => officialRow(record, favorites.get(record.playerId))),
    };
}
exports.getOfficialLeaderboardPageSync = getOfficialLeaderboardPageSync;
function getLeaderboardPlayedPartiesSync(input) {
    var _a;
    const season = getDisplaySeason(input.competition.key, (_a = input.acceptingScores) !== null && _a !== void 0 ? _a : true);
    if (!Number.isInteger(input.rankNumber) || input.rankNumber < 1)
        return {};
    const [record] = (0, leaderboard_1.getLeaderboardRankPageSync)({
        competitionKey: input.competition.key,
        season,
        offset: input.rankNumber - 1,
        limit: 1,
        filter: (0, settlement_1.getLeaderboardSeasonRewardViewSync)(input.competition.key, season).filter,
    });
    if (record === undefined)
        return {};
    return (0, public_payload_1.stripWeaponRivenPublicPayload)(Object.fromEntries((0, leaderboard_1.getLeaderboardRunRoundsSync)(record.id).map(round => [
        round.roundNumber,
        (0, rushEvent_1.serializePlayerRushEventPlayedParty)({
            characterIds: round.characterIds,
            unisonCharacterIds: round.unisonCharacterIds,
            equipmentIds: round.equipmentIds,
            abilitySoulIds: round.abilitySoulIds,
            evolutionImgLevels: round.evolutionImgLevels,
            unisonEvolutionImgLevels: round.unisonEvolutionImgLevels,
            round: round.roundNumber,
            battleType: 1,
        }),
    ])));
}
exports.getLeaderboardPlayedPartiesSync = getLeaderboardPlayedPartiesSync;
function buildNativeLeaderboardPayload(competition, playerId, acceptingScores = true, nowMs = Date.now()) {
    acceptingScores = (0, availability_1.isLeaderboardEnabledSync)(competition.key, nowMs) && acceptingScores;
    const season = getDisplaySeason(competition.key, acceptingScores, nowMs);
    const rewardView = (0, settlement_1.getLeaderboardSeasonRewardViewSync)(competition.key, season);
    const { total, filter, settled } = rewardView;
    const rewardPresentation = buildLeaderboardRewardPresentation(competition, rewardView);
    const { rows: records, mine } = (0, leaderboard_1.getLeaderboardRankPageAndPlayerSync)({
        competitionKey: competition.key,
        season,
        playerId,
        offset: 0,
        limit: competition.displayLimit,
        filter,
    });
    const favorites = (0, party_1.getFirstPlayerPartyDisplaySelectionsSync)([
        ...records.map(record => record.playerId),
        ...(mine === null ? [] : [mine.playerId]),
    ], profileFavorite_1.PROFILE_FAVORITE_PARTY_CATEGORY);
    const index = mine === null ? -1 : mine.rankNumber - 1;
    const visibleIndex = index >= 0 && index < records.length ? index : -1;
    return {
        enabled: true,
        name: rewardPresentation.name,
        rows: records.map(record => nativeRow(record, favorites.get(record.playerId))),
        item: mine === null
            ? (playerId === null ? null : outOfRankRow(playerId))
            : nativeRow(mine, favorites.get(mine.playerId)),
        page: visibleIndex < 0 ? 0 : Math.floor(visibleIndex / competition.pageSize),
        row: visibleIndex < 0 ? -1 : visibleIndex % competition.pageSize,
        index,
        time: buildLeaderboardScheduleText(competition.key, acceptingScores, settled),
        total,
        reward: rewardPresentation.rewardTiers,
    };
}
exports.buildNativeLeaderboardPayload = buildNativeLeaderboardPayload;
function buildLeaderboardScheduleText(competitionKey, acceptingScores, settled) {
    if (settled)
        return "已结算";
    if (!acceptingScores)
        return "已冻结，待结算";
    const config = (0, settlement_1.getLeaderboardSettlementConfigSync)(competitionKey);
    if (config.settleAtMs === null)
        return "实时更新";
    if (!config.freezeEnabled && !config.autoEnabled)
        return "未启用定时结算";
    const beijing = (0, schedule_time_1.formatLeaderboardDeadlineInput)(config.settleAtMs).slice(5).replace("T", " ");
    return `${config.autoEnabled ? "结算" : "截止"}：${beijing}`;
}
function buildUnavailableNativeLeaderboardPayload() {
    return {
        enabled: false,
        name: "连战",
        rows: [],
        item: null,
        page: 0,
        row: -1,
        index: -1,
        time: "排行榜暂未开放",
        total: 0,
        reward: [],
    };
}
exports.buildUnavailableNativeLeaderboardPayload = buildUnavailableNativeLeaderboardPayload;
function getSeason(competitionKey) {
    return (0, competition_1.getLeaderboardCompetitionSeasonSync)(competitionKey);
}
function getDisplaySeason(competitionKey, acceptingScores, nowMs = Date.now()) {
    const currentSeason = getSeason(competitionKey);
    const current = (0, settlement_1.getLeaderboardSeasonRewardViewSync)(competitionKey, currentSeason);
    if (acceptingScores || current.total > 0 || current.settled
        || (0, availability_1.isLeaderboardDeadlineDueSync)(competitionKey, nowMs)) {
        return currentSeason;
    }
    for (let season = currentSeason - 1; season >= 1; season--) {
        if ((0, settlement_1.getLeaderboardSeasonRewardViewSync)(competitionKey, season).total > 0)
            return season;
    }
    return currentSeason;
}
function buildLeaderboardTermsText(competition, acceptingScores = true) {
    const season = getDisplaySeason(competition.key, acceptingScores);
    const view = (0, settlement_1.getLeaderboardSeasonRewardViewSync)(competition.key, season);
    const { name, rewardTiers: tiers } = buildLeaderboardRewardPresentation(competition, view);
    const lines = tiers.map(tier => {
        const range = tier.toRank === null
            ? `第${tier.fromRank}名起`
            : tier.fromRank === tier.toRank
                ? `第${tier.fromRank}名`
                : `第${tier.fromRank}～${tier.toRank}名`;
        const rewards = [
            tier.itemId === null ? null : `${tier.itemName} × ${tier.itemCount}`,
            tier.degreeId === null ? null : `称号「${tier.degreeName}」`,
        ].filter((value) => value !== null);
        return `<p><b>${range}</b>　${rewards.join(" + ")}</p>`;
    });
    return `<h2>${name} 排行报酬</h2>${lines.join("")}<p>排行榜按本期完整通关的 client_battle_ms 总和升序排列；每位玩家只保留最佳成绩。</p>`;
}
exports.buildLeaderboardTermsText = buildLeaderboardTermsText;
function buildLeaderboardRewardPresentation(competition, view) {
    if (view.total === 0 && view.rewardRules.some(rewards_1.isPercentRewardTier)) {
        // Existing clients construct the reward page from name + rank ranges.
        // Keep the example confined to presentation: the real count, ranks,
        // settlement tiers and saved results must remain empty for zero players.
        const label = view.settled ? "本期无人获奖；按100人参榜预览" : "按100人参榜预览";
        return {
            name: `${competition.displayName}（${label}）`,
            rewardTiers: (0, rewards_1.resolveLeaderboardRewardTiers)(view.rewardRules, 100),
        };
    }
    return { name: competition.displayName, rewardTiers: view.rewardTiers };
}
