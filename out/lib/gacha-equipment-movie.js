"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeEquipmentGachaMovieEffectsForGacha = exports.computeEquipmentGachaMovieEffects = exports.drawEquipmentTreasureUpType = exports.getEquipmentGachaMovieProbabilitySync = void 0;
const equipment_gacha_movie_probability_json_1 = __importDefault(require("../../assets/equipment_gacha_movie_probability.json"));
function getEquipmentGachaMovieProbabilitySync(id) {
    var _a;
    if (id === undefined)
        return null;
    const table = equipment_gacha_movie_probability_json_1.default;
    return (_a = table[String(id)]) !== null && _a !== void 0 ? _a : null;
}
exports.getEquipmentGachaMovieProbabilitySync = getEquipmentGachaMovieProbabilitySync;
function treasureUpTargetRank(treasureUpType) {
    switch (treasureUpType) {
        case 1:
        case 2:
            return 5;
        case 3:
            return 4;
        default:
            return null;
    }
}
function treasureUpProbability(treasureUpType, probability, isGuarantee) {
    switch (treasureUpType) {
        case 1:
            return isGuarantee
                ? probability.guaranteeProbabilityTreasureUp3To5
                : probability.probabilityTreasureUp3To5;
        case 2:
            return isGuarantee
                ? probability.guaranteeProbabilityTreasureUp4To5
                : probability.probabilityTreasureUp4To5;
        case 3:
            return isGuarantee
                ? probability.guaranteeProbabilityTreasureUp3To4
                : probability.probabilityTreasureUp3To4;
        default:
            return 0;
    }
}
function drawEquipmentTreasureUpType(rank, probability, isGuarantee, roll = Math.random) {
    for (const treasureUpType of [1, 2, 3]) {
        const targetRank = treasureUpTargetRank(treasureUpType);
        if (targetRank !== rank)
            continue;
        if (roll() < treasureUpProbability(treasureUpType, probability, isGuarantee)) {
            return treasureUpType;
        }
    }
    return 0;
}
exports.drawEquipmentTreasureUpType = drawEquipmentTreasureUpType;
function computeEquipmentGachaMovieEffects(drawInputs, probability, roll = Math.random) {
    const hasRankFive = drawInputs.some((draw) => draw.rank === 5);
    const isErupt = hasRankFive ? roll() < probability.probabilityEruption : false;
    return {
        isErupt,
        draws: drawInputs.map((draw) => ({
            equipmentId: draw.id,
            treasureUpType: !isErupt && draw.rank > 3
                ? drawEquipmentTreasureUpType(draw.rank, probability, draw.isGuarantee, roll)
                : 0,
        })),
    };
}
exports.computeEquipmentGachaMovieEffects = computeEquipmentGachaMovieEffects;
function computeEquipmentGachaMovieEffectsForGacha(gacha, drawInputs, roll = Math.random) {
    const probability = getEquipmentGachaMovieProbabilitySync(gacha.equipmentMovieProbabilityId);
    if (!probability) {
        return {
            isErupt: false,
            draws: drawInputs.map((draw) => ({
                equipmentId: draw.id,
                treasureUpType: 0,
            })),
        };
    }
    return computeEquipmentGachaMovieEffects(drawInputs, probability, roll);
}
exports.computeEquipmentGachaMovieEffectsForGacha = computeEquipmentGachaMovieEffectsForGacha;
