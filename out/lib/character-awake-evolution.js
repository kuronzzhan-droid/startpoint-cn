"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveAwakeEvolutionLevel = void 0;
/**
 * Awakening the skill-evolution node on mana board 1 promotes the character
 * evolution level used by awakened leader and action-skill master data.
 */
function deriveAwakeEvolutionLevel(currentEvolutionLevel, board1Nodes, finalAwakeLevels) {
    var _a;
    const skillEvolutionNode = Object.entries(board1Nodes).find(([, node]) => (node.field5 === "2" && node.field6 === ""));
    if (!skillEvolutionNode)
        return currentEvolutionLevel;
    const awakeLevel = (_a = finalAwakeLevels.get(Number(skillEvolutionNode[0]))) !== null && _a !== void 0 ? _a : 0;
    return awakeLevel > 0
        ? Math.max(currentEvolutionLevel, 1 + awakeLevel)
        : currentEvolutionLevel;
}
exports.deriveAwakeEvolutionLevel = deriveAwakeEvolutionLevel;
