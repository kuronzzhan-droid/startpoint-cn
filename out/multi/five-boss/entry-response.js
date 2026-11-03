"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendFiveBossTicketShortage = exports.isFiveBossTicketShortage = void 0;
const utils_1 = require("../../utils");
const fiveBossGauntletRun_1 = require("../../data/domains/fiveBossGauntletRun");
/** Native QuestStartRealRemote handles 4050 by closing loading and returning to the quest UI.
 * Other result codes and HTTP 400 use the fatal title-return handler. The CDN
 * entry-condition message covers item shortage as well as existing 4050 uses.
 */
function isFiveBossTicketShortage(error) {
    return error instanceof fiveBossGauntletRun_1.FiveBossGauntletRunError && error.code === "insufficient_ticket";
}
exports.isFiveBossTicketShortage = isFiveBossTicketShortage;
function sendFiveBossTicketShortage(reply, viewerId) {
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({
        data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, result_code: 4050 }),
        data: {},
    });
}
exports.sendFiveBossTicketShortage = sendFiveBossTicketShortage;
