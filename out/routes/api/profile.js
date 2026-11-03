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
Object.defineProperty(exports, "__esModule", { value: true });
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const activeAccount_1 = require("../../data/activeAccount");
// removed getAccountPlayers "../../data/wdfpData";
const utils_1 = require("../../utils");
const follow_1 = require("../../lib/follow");
const profile_target_1 = require("../../lib/profile-target");
const profileFavorite_1 = require("../../lib/profileFavorite");
const degree_1 = require("../../data/domains/degree");
const carnival_reward_handler_1 = require("../../lib/quest/finish/carnival-reward-handler");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const game_logging_1 = require("../../lib/game-logging");
const option_1 = require("../../data/domains/option");
const profile_stats_1 = require("../../lib/profile-stats");
const assets_1 = require("../../lib/assets");
const activity_degree_rewards_1 = require("../../lib/activity-degree-rewards");
const abyss_shop_degree_reward_1 = require("../../lib/abyss-shop-degree-reward");
const abyss_spheal_degree_reward_1 = require("../../lib/abyss-spheal-degree-reward");
const PROFILE_SETTING_FIELDS = [
    "show_opened_mana_board_second_count",
    "show_owned_character_count",
    "show_owned_degree_count",
];
function serializeProfileSettings(settings) {
    return {
        show_opened_mana_board_second_count: settings.showOpenedManaBoardSecondCount,
        show_owned_character_count: settings.showOwnedCharacterCount,
        show_owned_degree_count: settings.showOwnedDegreeCount,
    };
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/get_my_profile", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid request body."
            });
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (playerId === null)
            return reply.status(400).send({
                error: "Bad Request",
                message: "No player bound to account."
            });
        const player = (0, player_1.getPlayerSync)(playerId);
        if (!player)
            return reply.status(400).send({ error: "Bad Request", message: "Player not found." });
        (0, degree_1.ensurePlayerLegacyDegreesSync)(playerId, player.degreeId || 1);
        (0, degree_1.ensurePlayerSoloTimeAttackDegreesSync)(playerId);
        (0, carnival_reward_handler_1.ensurePlayerClaimedCarnivalDegreesSync)(playerId);
        (0, activity_degree_rewards_1.ensurePlayerActivityDegreesSync)(playerId);
        (0, abyss_shop_degree_reward_1.grantAbyssShopDegreeRewardSync)(playerId);
        (0, abyss_spheal_degree_reward_1.grantAbyssSphealDegreeSync)(playerId);
        const stats = (0, profile_stats_1.getPlayerProfileStatsSync)(playerId);
        const profileSettings = (0, option_1.getPlayerProfileSettingsSync)(playerId);
        const partyGroupList = (0, profileFavorite_1.getFavoritePartyGroupListSync)(playerId, player.leaderCharacterId);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            data: {
                profile_info: {
                    max_opened_mana_board_second_count: stats.maxOpenedManaBoardSecondCount,
                    max_owned_character_count: stats.maxOwnedCharacterCount,
                    max_owned_degree_count: stats.maxOwnedDegreeCount,
                    opened_mana_board_second_count: stats.openedManaBoardSecondCount,
                    owned_character_count: stats.ownedCharacterCount,
                    owned_degree_count: stats.ownedDegreeCount,
                },
                profile_settings: serializeProfileSettings(profileSettings),
                user_party_group_list: partyGroupList,
            }
        });
    }));
    // Public profile opened from the follow/follower list.
    fastify.post("/get_profile", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = Number(body.viewer_id);
        const targetViewerId = Number(body.target_viewer_id);
        if (!Number.isFinite(viewerId) || !Number.isFinite(targetViewerId)) {
            return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." });
        }
        const session = yield (0, session_1.getSession)(String(viewerId));
        if (!session)
            return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        // Accept the old encoded leaderboard id for clients with a cached
        // leaderboard response, but always return the target player's real
        // viewer id in the profile payload.
        const targetPlayerId = (0, profile_target_1.resolveProfileTargetPlayerIdSync)(targetViewerId);
        if (playerId === null || targetPlayerId === null) {
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, result_code: 1457 }),
                data: {},
            });
        }
        const profile = (0, follow_1.buildTargetProfileSync)(playerId, targetPlayerId);
        if (!profile) {
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, result_code: 1457 }),
                data: {},
            });
        }
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            data: profile,
        });
    }));
    // Returns the player's last login region (CN-specific)
    fastify.post("/get_last_login_region", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid request body."
            });
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid viewer id."
            });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            data: {
                region: "CN",
            }
        });
    }));
    // Returns owned degree IDs for title selection
    fastify.post("/get_degree_list", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid request body."
            });
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        const player = playerId !== null ? (0, player_1.getPlayerSync)(playerId) : null;
        if (playerId === null || !player)
            return reply.status(500).send({
                error: "Internal Server Error",
                message: "No player bound to account."
            });
        (0, degree_1.ensurePlayerLegacyDegreesSync)(playerId, player.degreeId || 1);
        (0, degree_1.ensurePlayerSoloTimeAttackDegreesSync)(playerId);
        (0, carnival_reward_handler_1.ensurePlayerClaimedCarnivalDegreesSync)(playerId);
        (0, activity_degree_rewards_1.ensurePlayerActivityDegreesSync)(playerId);
        (0, abyss_shop_degree_reward_1.grantAbyssShopDegreeRewardSync)(playerId);
        (0, abyss_spheal_degree_reward_1.grantAbyssSphealDegreeSync)(playerId);
        const degreeIds = (0, degree_1.getPlayerDegreeIdsSync)(playerId);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            data: {
                degree_ids: degreeIds,
            }
        });
    }));
    // Set the player's displayed degree title
    fastify.post("/update_degree", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const degreeId = body.degree_id;
        if (!viewerId || isNaN(viewerId) || degreeId === undefined || isNaN(degreeId)) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid request body."
            });
        }
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (playerId === null)
            return reply.status(500).send({
                error: "Internal Server Error",
                message: "No player bound to account."
            });
        const player = (0, player_1.getPlayerSync)(playerId);
        if (!player)
            return reply.status(500).send({
                error: "Internal Server Error",
                message: "Player not found."
            });
        const degreeUpdate = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "profile_update_degree",
        }, () => {
            (0, degree_1.ensurePlayerLegacyDegreesSync)(playerId, player.degreeId || 1);
            (0, degree_1.ensurePlayerSoloTimeAttackDegreesSync)(playerId);
            (0, carnival_reward_handler_1.ensurePlayerClaimedCarnivalDegreesSync)(playerId);
            (0, activity_degree_rewards_1.ensurePlayerActivityDegreesSync)(playerId);
            (0, abyss_shop_degree_reward_1.grantAbyssShopDegreeRewardSync)(playerId);
            (0, abyss_spheal_degree_reward_1.grantAbyssSphealDegreeSync)(playerId);
            if (!(0, degree_1.hasPlayerDegreeSync)(playerId, Number(degreeId)))
                return false;
            (0, player_1.updatePlayerSync)({ id: playerId, degreeId: Number(degreeId) });
            return true;
        });
        if (!degreeUpdate) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Degree is not owned."
            });
        }
        (0, game_logging_1.gameVerboseLog)(() => `[PROFILE] update_degree viewer=${viewerId} degree=${degreeId}`);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            data: {
                user_info: { degree_id: Number(degreeId) }
            }
        });
    }));
    // Update profile visibility settings.
    fastify.post("/update_profile_settings", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid request body."
            });
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid viewer id."
            });
        const settings = body.profile_settings;
        if (settings === null || typeof settings !== "object" || Array.isArray(settings)
            || !PROFILE_SETTING_FIELDS.some(field => Object.prototype.hasOwnProperty.call(settings, field))
            || PROFILE_SETTING_FIELDS.some(field => (Object.prototype.hasOwnProperty.call(settings, field)
                && typeof settings[field] !== "boolean")))
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid profile settings.",
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (playerId === null || !(0, player_1.getPlayerSync)(playerId))
            return reply.status(400).send({
                error: "Bad Request",
                message: "No player bound to account.",
            });
        const updated = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "profile_update_settings",
        }, () => (0, option_1.updatePlayerProfileSettingsSync)(playerId, Object.assign(Object.assign(Object.assign({}, (typeof settings.show_opened_mana_board_second_count === "boolean"
            ? { showOpenedManaBoardSecondCount: settings.show_opened_mana_board_second_count }
            : {})), (typeof settings.show_owned_character_count === "boolean"
            ? { showOwnedCharacterCount: settings.show_owned_character_count }
            : {})), (typeof settings.show_owned_degree_count === "boolean"
            ? { showOwnedDegreeCount: settings.show_owned_degree_count }
            : {}))));
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            data: {
                profile_settings: serializeProfileSettings(updated),
            }
        });
    }));
    // Update profile comment
    fastify.post("/update_comment", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid request body."
            });
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (playerId === null)
            return reply.status(400).send({
                error: "Bad Request",
                message: "No player bound to account."
            });
        if (typeof body.comment !== "string")
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid comment.",
            });
        const comment = body.comment.substring(0, (0, assets_1.getConfigSync)().max_player_comment_length);
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "profile_update_comment",
        }, () => (0, player_1.updatePlayerSync)({ id: playerId, comment }));
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            data: { comment },
        });
    }));
    // Rename player
    fastify.post("/rename", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid request body."
            });
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (playerId === null)
            return reply.status(400).send({
                error: "Bad Request",
                message: "No player bound to account."
            });
        if (typeof body.name !== "string")
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid name.",
            });
        const name = body.name.substring(0, (0, assets_1.getConfigSync)().max_player_name_length);
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "profile_rename",
        }, () => (0, player_1.updatePlayerSync)({ id: playerId, name }));
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            data: { name },
        });
    }));
});
exports.default = routes;
