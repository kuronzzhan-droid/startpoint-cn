"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MaxLevelValidator = void 0;
const assets_1 = require("../assets");
const equipment_1 = require("../../data/domains/equipment");
/**
 * Permanent validator: clamps equipment level to CDN max_level.
 * Equipment like 5020043 (终结者) has max_level=1 and cannot be awakened.
 * If level exceeds max_level (e.g. from direct DB manipulation), clamp it.
 */
exports.MaxLevelValidator = {
    name: "max-level",
    version: 1,
    validate(playerId, context) {
        var _a;
        let fixes = 0;
        const allEquipment = (_a = context === null || context === void 0 ? void 0 : context.equipmentList) !== null && _a !== void 0 ? _a : (0, equipment_1.getPlayerEquipmentListSync)(playerId);
        for (const [equipId, equip] of Object.entries(allEquipment)) {
            const cdn = (0, assets_1.getEquipmentDissolveSync)(parseInt(equipId));
            if (!cdn || cdn.max_level === undefined)
                continue;
            const maxLevel = cdn.max_level;
            if (equip.level > maxLevel) {
                (0, equipment_1.updatePlayerEquipmentSync)(playerId, equipId, { level: maxLevel });
                console.log(`[VALIDATE:max-level] account=${playerId} eid=${equipId} level ${equip.level}→${maxLevel} (max=${maxLevel})`);
                equip.level = maxLevel;
                fixes++;
            }
        }
        if (fixes > 0) {
            console.log(`[VALIDATE:max-level] player=${playerId}: ${fixes} equipment levels clamped`);
        }
        return fixes;
    }
};
