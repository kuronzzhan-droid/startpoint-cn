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
const activeAccount_1 = require("../../data/activeAccount");
const player_login_1 = require("../../lib/player-login");
const skip_main_story_1 = require("../../lib/skip-main-story");
const utils_1 = require("../../utils");
/** This route checks its own game credentials, including at the legacy entry point.
 * viewer_id is an account identifier, never authorization by itself.
 */
function skipChapterRoutes(fastify) {
    return __awaiter(this, void 0, void 0, function* () {
        fastify.post("/skip_chapter", { bodyLimit: 4096 }, (request, reply) => __awaiter(this, void 0, void 0, function* () {
            const body = (request.body && typeof request.body === "object" && !Array.isArray(request.body)
                ? request.body : {});
            const viewerId = Number(body.viewer_id);
            reply.type("application/x-msgpack");
            const send = (result) => reply.status(200).send({
                data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: Number.isSafeInteger(viewerId) ? viewerId : 0 }),
                data: { skip_chapter_result: result, reload_required: result.ok === true },
            });
            const reject = (code, message) => send({ ok: false, code, message });
            if (!Number.isSafeInteger(viewerId) || viewerId <= 0) {
                return reject("INVALID_VIEWER", "玩家身份无效，请重新登录");
            }
            const access = (0, player_login_1.readPlayerLoginAccess)(request.headers["x-sp-session"], viewerId);
            if (!access || access.account_id !== access.request_account_id) {
                return reject("UNAUTHORIZED", "登录凭证无效或与玩家不匹配，请重新登录");
            }
            // The target always comes from the verified account, never a caller-supplied save ID.
            if (["id", "player_id", "account_id"].some(key => Object.prototype.hasOwnProperty.call(body, key))) {
                return reject("INVALID_TARGET", "跳过章节只能操作当前登录存档，不接受指定玩家");
            }
            const playerId = (0, activeAccount_1.resolvePlayerIdSync)(access.account_id);
            if (playerId === null)
                return reject("PLAYER_NOT_FOUND", "玩家存档不存在");
            try {
                return send(yield (0, skip_main_story_1.skipMainStory)(playerId, body.category, body.chapter));
            }
            catch (error) {
                if (error instanceof skip_main_story_1.SkipMainStoryError)
                    return reject(error.code, error.message);
                request.log.error({ err: error }, "Chapter skip failed");
                return reject("SERVER_ERROR", "本次跳过未完成，请稍后重试");
            }
        }));
    });
}
exports.default = skipChapterRoutes;
