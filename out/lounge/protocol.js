"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLoungeDisbandedConnectionData = exports.LOUNGE_DISMISSED_MESSAGE = exports.LOUNGE_DISBANDED_STATE = void 0;
exports.LOUNGE_DISBANDED_STATE = 99;
exports.LOUNGE_DISMISSED_MESSAGE = "multibattle_room_dismissed";
/**
 * Build the normal client response for a lounge that no longer exists.
 *
 * The CN client handles raising_state=99 by leaving the lounge and deleting
 * its persisted lounge_restore_data. Returning an HTTP error here leaves that
 * client-side state behind and makes every subsequent login retry A4511.
 */
function buildLoungeDisbandedConnectionData(loungeNumber = "") {
    return {
        application_update_url: "",
        ip_address: "",
        lounge_number: loungeNumber,
        port: 0,
        raising_state: exports.LOUNGE_DISBANDED_STATE,
    };
}
exports.buildLoungeDisbandedConnectionData = buildLoungeDisbandedConnectionData;
