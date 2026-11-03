"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripWeaponRivenRoomPreview = void 0;
const client_1 = require("./client");
/** Room preview keeps unknown souls for conversion but never exposes private rows/context. */
function stripWeaponRivenRoomPreview(value) {
    const visit = (node) => {
        if (!node || typeof node !== "object")
            return node;
        if (Array.isArray(node))
            return node.map(visit);
        return Object.fromEntries(Object.entries(node)
            .filter(([key]) => !/^weapon_riven(?:s|_|$)/.test(key) && !/^user_weapon_riven/.test(key))
            .map(([key, child]) => [key, visit(child)]));
    };
    return visit((0, client_1.stripWeaponRivenPartySouls)(value));
}
exports.stripWeaponRivenRoomPreview = stripWeaponRivenRoomPreview;
