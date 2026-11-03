"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLeaderboardCompetitionSeasonSync = exports.getLeaderboardCompetitionForQuest = exports.getLeaderboardCompetitionForEvent = exports.getLeaderboardCompetition = exports.getLeaderboardCompetitions = void 0;
const types_1 = require("../types");
const leaderboard_1 = require("../../data/domains/leaderboard");
const abyss_time_revision_1 = require("../abyss-time-revision");
const competitions = [{
        key: "rush:700099:1",
        displayName: "深渊连战",
        category: types_1.QuestCategory.RUSH_EVENT,
        eventId: 700099,
        folderId: 1,
        pageSize: 100,
        displayLimit: 500,
        contentRevision: "abyss-reroll-seed-2026082902",
    }, {
        key: "rush:700100:1",
        displayName: "深渊连战 EX",
        category: types_1.QuestCategory.RUSH_EVENT,
        eventId: 700100,
        folderId: 1,
        pageSize: 100,
        displayLimit: 500,
        contentRevision: "abyss-ex-initial",
    }];
function getLeaderboardCompetitions() {
    return competitions;
}
exports.getLeaderboardCompetitions = getLeaderboardCompetitions;
function getLeaderboardCompetition(key) {
    var _a;
    return (_a = competitions.find(entry => entry.key === key)) !== null && _a !== void 0 ? _a : null;
}
exports.getLeaderboardCompetition = getLeaderboardCompetition;
function getLeaderboardCompetitionForEvent(category, eventId) {
    var _a;
    return (_a = competitions.find(entry => entry.category === category && entry.eventId === eventId)) !== null && _a !== void 0 ? _a : null;
}
exports.getLeaderboardCompetitionForEvent = getLeaderboardCompetitionForEvent;
function getLeaderboardCompetitionForQuest(input) {
    var _a;
    return (_a = competitions.find(entry => entry.category === input.category
        && entry.eventId === input.eventId
        && entry.folderId === input.folderId)) !== null && _a !== void 0 ? _a : null;
}
exports.getLeaderboardCompetitionForQuest = getLeaderboardCompetitionForQuest;
function getLeaderboardCompetitionSeasonSync(competitionKey, nowMs = Date.now()) {
    var _a;
    const competition = getLeaderboardCompetition(competitionKey);
    return (0, leaderboard_1.getLeaderboardSeasonSync)(competitionKey, nowMs, (competition === null || competition === void 0 ? void 0 : competition.eventId) === 700100
        ? (_a = (0, abyss_time_revision_1.getAbyssTimeRevision)(700100)) !== null && _a !== void 0 ? _a : competition.contentRevision
        : competition === null || competition === void 0 ? void 0 : competition.contentRevision);
}
exports.getLeaderboardCompetitionSeasonSync = getLeaderboardCompetitionSeasonSync;
