"use strict";
/**
 * Handles gacha summoning.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.rewardPlayerBoxGachaResultSync = exports.drawBoxGachaSync = exports.rewardPlayerGachaDrawResultSync = exports.commitPlannedCharacterGachaMovies = exports.planCharacterGachaMovies = exports.drawGachaSync = exports.drawGachaWithMetadataSync = exports.randomPoolItem = exports.selectWeightedIndexByRoll = void 0;
const crypto_1 = require("crypto");
const seed_validator_1 = __importDefault(require("./seed-validator"));
const gacha_physics_1 = require("./gacha-physics");
const character_1 = require("./character");
const equipment_1 = require("./equipment");
const quest_1 = require("./quest");
const assets_1 = require("./assets");
const types_1 = require("./types");
const gacha_equipment_movie_1 = require("./gacha-equipment-movie");
const gacha_movie_seeds_1 = require("./gacha-movie-seeds");
const gacha_movie_variants_1 = __importDefault(require("./gacha-movie-variants"));
const GACHA_VERBOSE_LOGS = /^(1|true|yes)$/i.test((_a = process.env.GACHA_VERBOSE_LOGS) !== null && _a !== void 0 ? _a : "");
function logGachaDetail(message) {
    if (GACHA_VERBOSE_LOGS)
        console.log(message);
}
const characterGachaRankRates = {
    normal: [
        50, // 5*
        250, // 4*
        700 // 3*
    ],
    multiGuarantee: [
        50, // 5*
        950 // 4*
    ]
};
const equipmentGachaRankRates = {
    normal: [
        50, // 5*
        250, // 4*
        700 // 3*
    ],
    multiGuarantee: [
        50, // 5*
        950 // 4*
    ]
};
const rankMovieRates = [
    [
        80,
        20
    ],
    [
        80,
        20
    ],
    [
        100
    ]
];
function positiveWeight(weight) {
    return Number.isFinite(weight) && weight > 0 ? weight : 0;
}
function totalPositiveWeight(pool) {
    return pool.reduce((sum, weight) => sum + positiveWeight(weight), 0);
}
function selectWeightedIndexByRoll(pool, roll) {
    const total = totalPositiveWeight(pool);
    if (total <= 0 || roll < 1 || roll > total)
        return null;
    let offset = 0;
    for (let index = 0; index < pool.length; index += 1) {
        offset += positiveWeight(pool[index]);
        if (roll <= offset)
            return index;
    }
    return null;
}
exports.selectWeightedIndexByRoll = selectWeightedIndexByRoll;
function randomWeightedIndex(pool) {
    const total = totalPositiveWeight(pool);
    if (total <= 0)
        return null;
    return selectWeightedIndexByRoll(pool, (0, crypto_1.randomInt)(1, Math.floor(total) + 1));
}
/**
 * Selects a random index from a weighted pool.
 *
 * @param min The minimum random value to pick.
 * @param max The maximum random value to pick.
 * @param pool The pool to select the random index from.
 * @returns The index that was selected. null if nothing was selected.
 */
function randomPoolItem(min, max, pool) {
    let roll = (0, crypto_1.randomInt)(min, max);
    let offset = 0;
    let index = 0;
    for (const rate of pool) {
        if ((rate + offset) >= roll)
            return index;
        offset += rate;
        index += 1;
    }
    return null;
}
exports.randomPoolItem = randomPoolItem;
function drawGachaWithMetadataSync(gacha, drawAmount) {
    var _a, _b, _c;
    const isCharacterGacha = gacha.type === types_1.GachaType.CHARACTER;
    const fallbackRankRates = isCharacterGacha ? characterGachaRankRates : equipmentGachaRankRates;
    const rankRates = (_a = gacha.rankRates) !== null && _a !== void 0 ? _a : fallbackRankRates;
    const pulls = [];
    for (let drawNumber = 0; drawNumber < drawAmount; drawNumber++) {
        const isGuarantee = ((drawNumber + 1) % 10) === 0;
        const drawRankRates = isGuarantee ? rankRates.multiGuarantee : rankRates.normal;
        const rankIndex = (_b = randomWeightedIndex(drawRankRates)) !== null && _b !== void 0 ? _b : 0;
        const ratePool = gacha.pool[String(rankIndex + 1)];
        if (!ratePool || ratePool.length === 0) {
            throw new Error(`gacha pool is empty for rank key ${rankIndex + 1}`);
        }
        // pick item from pool
        const selectedItem = ratePool[(_c = randomWeightedIndex(ratePool.map(item => item.odds))) !== null && _c !== void 0 ? _c : 0];
        pulls.push({
            id: selectedItem.id,
            rank: selectedItem.rank,
            isGuarantee,
        });
    }
    return pulls;
}
exports.drawGachaWithMetadataSync = drawGachaWithMetadataSync;
function drawGachaSync(gacha, drawAmount) {
    return drawGachaWithMetadataSync(gacha, drawAmount).map((draw) => draw.id);
}
exports.drawGachaSync = drawGachaSync;
function selectLegacyMovieSeed(movieId, movieType, rarity, characterId, drawIndex, usedSeeds) {
    var _a, _b;
    const seedKey = String(6 - rarity);
    const movieSeeds = (0, gacha_movie_seeds_1.loadMovieSeeds)(movieId);
    const seedPool = ((_a = movieSeeds[seedKey]) === null || _a === void 0 ? void 0 : _a[String(movieType)]) || [];
    const fallbackPool = ((_b = movieSeeds[seedKey]) === null || _b === void 0 ? void 0 : _b["0"]) || [];
    const pool = seedPool.length > 0 ? seedPool : fallbackPool;
    if (pool.length === 0)
        return characterId * 1000;
    const selected = seed_validator_1.default.getSeed(movieId, rarity, pool, characterId, drawIndex);
    if (!usedSeeds.has(selected) || seed_validator_1.default.getTestSeed(rarity) === selected)
        return selected;
    // Debug modes may select from their small curated pools. Preserve those
    // modes while avoiding accidental repeats when another seed is available.
    const replacement = pool.find((seed) => !usedSeeds.has(seed) && !seed_validator_1.default.isKnownRarityMismatch(movieId, seed, rarity));
    return replacement !== null && replacement !== void 0 ? replacement : selected;
}
/**
 * Plans character movie seeds before the reward transaction. Natural mode only
 * performs cached catalog lookup and array indexing; physics stays offline.
 */
function planCharacterGachaMovies(gacha, characterIds, options) {
    if (options.flushPrevious !== false)
        seed_validator_1.default.flushAll();
    const usedSeeds = new Set();
    return characterIds.map((characterId, drawIndex) => {
        var _a, _b, _c;
        const rarity = ((_a = (0, assets_1.getCharacterDataSync)(characterId)) === null || _a === void 0 ? void 0 : _a.rarity) || 3;
        const rarityIndex = 5 - rarity;
        const movieType = (_b = randomPoolItem(1, 101, rankMovieRates[rarityIndex])) !== null && _b !== void 0 ? _b : types_1.GachaMovieType.NORMAL;
        const movieId = movieType === types_1.GachaMovieType.GUARANTEE
            ? (gacha.guaranteeMovieName || gacha.movieName || "normal")
            : (gacha.movieName || "normal");
        const movieConfig = gacha_physics_1.MOVIE_CONFIGS[movieId];
        if ((_c = movieConfig === null || movieConfig === void 0 ? void 0 : movieConfig.threshold) === null || _c === void 0 ? void 0 : _c.isRarity5) {
            return {
                characterId,
                rarity,
                movieId,
                seed: characterId * 1000,
                moviePlayable: false,
                rarityUp: false,
                requiresVerification: false,
            };
        }
        const testSeed = seed_validator_1.default.getTestSeed(rarity);
        if (testSeed !== null) {
            return {
                characterId,
                rarity,
                movieId,
                seed: testSeed,
                moviePlayable: true,
                rarityUp: false,
                requiresVerification: true,
            };
        }
        if (seed_validator_1.default.getMode() === "natural") {
            const selected = gacha_movie_variants_1.default.select({
                movieId,
                rarity,
                skipNoRarityUpMovie: options.skipNoRarityUpMovie,
                usedSeeds,
                isRejected: (seed) => seed_validator_1.default.isKnownRarityMismatch(movieId, seed, rarity),
            });
            if (selected !== null) {
                usedSeeds.add(selected.seed);
                return {
                    characterId,
                    rarity,
                    movieId,
                    seed: selected.seed,
                    moviePlayable: selected.moviePlayable,
                    rarityUp: selected.rarityUp,
                    requiresVerification: true,
                };
            }
        }
        const seed = selectLegacyMovieSeed(movieId, movieType, rarity, characterId, drawIndex, usedSeeds);
        usedSeeds.add(seed);
        return {
            characterId,
            rarity,
            movieId,
            seed,
            moviePlayable: true,
            rarityUp: false,
            requiresVerification: true,
        };
    });
}
exports.planCharacterGachaMovies = planCharacterGachaMovies;
function commitPlannedCharacterGachaMovies(plannedMovies) {
    seed_validator_1.default.flushAll();
    for (const movie of plannedMovies) {
        if (movie.requiresVerification) {
            seed_validator_1.default.markSent(movie.movieId, movie.seed, movie.rarity);
        }
    }
}
exports.commitPlannedCharacterGachaMovies = commitPlannedCharacterGachaMovies;
function rewardPlayerGachaDrawResultSync(playerId, gacha, gachaDrawResult, gachaDrawMetadata, plannedCharacterMovies, markMovieSeedsSent = true) {
    var _a, _b;
    const characterMoviePlan = gacha.type === types_1.GachaType.CHARACTER
        ? plannedCharacterMovies !== null && plannedCharacterMovies !== void 0 ? plannedCharacterMovies : planCharacterGachaMovies(gacha, gachaDrawResult, { skipNoRarityUpMovie: false })
        : [];
    if (gacha.type !== types_1.GachaType.CHARACTER) {
        seed_validator_1.default.flushAll();
    }
    const draws = [];
    const characters = new Map();
    const equipment = new Map();
    const items = new Map();
    if (gacha.type == types_1.GachaType.CHARACTER) {
        // reward characters (flat array, no grouping)
        for (let drawIndex = 0; drawIndex < gachaDrawResult.length; drawIndex += 1) {
            const characterId = gachaDrawResult[drawIndex];
            const plannedMovie = characterMoviePlan[drawIndex];
            if (!plannedMovie || plannedMovie.characterId !== characterId) {
                throw new Error(`character gacha movie plan mismatch at draw ${drawIndex}`);
            }
            const giveResult = (0, character_1.givePlayerCharacterSync)(playerId, characterId);
            if (giveResult !== null) {
                if (plannedMovie.requiresVerification) {
                    if (markMovieSeedsSent) {
                        seed_validator_1.default.markSent(plannedMovie.movieId, plannedMovie.seed, plannedMovie.rarity);
                    }
                    const movieFlags = [
                        plannedMovie.moviePlayable ? "PLAY" : "SKIP",
                        plannedMovie.rarityUp ? "RARITY-UP" : "NO-RARITY-UP",
                    ].join(",");
                    logGachaDetail(`[GACHA-DETAIL] rarity=${plannedMovie.rarity}★ seed=${plannedMovie.seed}`
                        + ` movie=${plannedMovie.movieId} charId=${characterId} [${movieFlags}]`);
                }
                else {
                    logGachaDetail(`[GACHA-DETAIL] rarity=${plannedMovie.rarity}★ seed=${plannedMovie.seed}`
                        + ` movie=${plannedMovie.movieId} charId=${characterId} [SKIP]`);
                }
                const draw = {
                    "character_id": characterId,
                    "movie_id": plannedMovie.movieId,
                    "seed": plannedMovie.seed,
                    "entry_count": 1
                };
                // Per-draw rewards use the granted delta, while item_list must
                // publish the absolute post-grant inventory amount.
                const giveItem = giveResult.item;
                if (giveItem !== undefined) {
                    draw['ex_boost_item'] = { id: giveItem.id, count: giveItem.count };
                    items.set(giveItem.id, giveItem.inventoryCount);
                }
                const existingCharacter = characters.get(characterId);
                if (existingCharacter) {
                    characters.set(characterId, Object.assign(Object.assign({}, existingCharacter), giveResult.character));
                }
                else {
                    characters.set(characterId, giveResult.character);
                }
                draws.push(draw);
            }
        }
    }
    else {
        const equipmentMovieInputs = gachaDrawResult.map((equipmentId, index) => {
            var _a, _b;
            const metadata = gachaDrawMetadata === null || gachaDrawMetadata === void 0 ? void 0 : gachaDrawMetadata[index];
            return {
                id: equipmentId,
                rank: (_a = metadata === null || metadata === void 0 ? void 0 : metadata.rank) !== null && _a !== void 0 ? _a : 0,
                isGuarantee: (_b = metadata === null || metadata === void 0 ? void 0 : metadata.isGuarantee) !== null && _b !== void 0 ? _b : false,
            };
        });
        const equipmentMovieEffects = (0, gacha_equipment_movie_1.computeEquipmentGachaMovieEffectsForGacha)(gacha, equipmentMovieInputs);
        for (let index = 0; index < gachaDrawResult.length; index += 1) {
            const equipmentId = gachaDrawResult[index];
            const giveResult = (0, equipment_1.givePlayerEquipmentSync)(playerId, equipmentId, 1);
            equipment.set(equipmentId, giveResult);
            draws.push({
                "equipment_id": equipmentId,
                "treasure_up_type": (_b = (_a = equipmentMovieEffects.draws[index]) === null || _a === void 0 ? void 0 : _a.treasureUpType) !== null && _b !== void 0 ? _b : 0
            });
        }
        return {
            draw: draws,
            characters: [],
            equipment: Array.from(equipment.values()),
            items: Object.fromEntries(items),
            isErupt: equipmentMovieEffects.isErupt,
        };
    }
    const returnCharacters = [];
    for (const value of characters.values()) {
        returnCharacters.push(value);
    }
    const returnEquipment = [];
    for (const value of equipment.values()) {
        returnEquipment.push(value);
    }
    const returnItems = {};
    for (const [itemId, amount] of items) {
        returnItems[itemId] = amount;
    }
    return {
        draw: draws,
        characters: returnCharacters,
        equipment: returnEquipment,
        items: returnItems
    };
}
exports.rewardPlayerGachaDrawResultSync = rewardPlayerGachaDrawResultSync;
/**
 * Performs box gacha draws.
 *
 * @param rewards A record, where the key is the reward id and the value is a BoxGachaReward
 * @param drawnRewards The current draws the player has made on the box gacha.
 * @param drawAmount The number of draws to perform.
 */
function drawBoxGachaSync(rewards, drawnRewards, drawAmount, // the number of times to draw
stopOnFeaturedReward = false) {
    var _a, _b, _c, _d, _e;
    // build drawn reward map
    const drawnRewardsMap = new Map(drawnRewards.map(reward => [reward.id, reward.number]));
    const rewardsPool = [];
    for (const [rewardId, reward] of Object.entries(rewards)) {
        for (let i = 0; i < (reward.available - ((_a = drawnRewardsMap.get(Number(rewardId))) !== null && _a !== void 0 ? _a : 0)); i++) {
            rewardsPool.push(rewardId);
        }
    }
    let drawnMana = 0;
    let drawnExp = 0;
    const drawnCharacters = new Map();
    const drawnEquipment = new Map();
    const drawnItems = new Map();
    const sessionDrawnRewards = new Map();
    let totalDraws = 0;
    for (let n = 0; n < drawAmount && rewardsPool.length > 0; n++) {
        const rollIndex = (0, crypto_1.randomInt)(rewardsPool.length);
        const rewardId = rewardsPool[rollIndex];
        const reward = rewards[rewardId];
        switch (reward.type) {
            case types_1.BoxGachaRewardType.ITEM: {
                const itemId = reward.id;
                drawnItems.set(itemId, ((_b = drawnItems.get(itemId)) !== null && _b !== void 0 ? _b : 0) + reward.count);
                break;
            }
            case types_1.BoxGachaRewardType.EQUIPMENT: {
                const equipmentId = reward.id;
                drawnEquipment.set(equipmentId, ((_c = drawnEquipment.get(equipmentId)) !== null && _c !== void 0 ? _c : 0) + reward.count);
                break;
            }
            case types_1.BoxGachaRewardType.MANA: {
                drawnMana += reward.count;
                break;
            }
            case types_1.BoxGachaRewardType.EXP: {
                drawnExp += reward.count;
                break;
            }
            case types_1.BoxGachaRewardType.PASS_CARD_POINT: {
                // Pass-card points require an event scope unavailable in box draws.
                // Abort the surrounding settlement before charging for an ungrantable reward.
                throw new Error("Box gacha pass-card point rewards are unsupported");
            }
            case types_1.BoxGachaRewardType.CHARACTER: {
                const characterId = reward.id;
                drawnCharacters.set(characterId, ((_d = drawnCharacters.get(characterId)) !== null && _d !== void 0 ? _d : 0) + reward.count);
                break;
            }
        }
        sessionDrawnRewards.set(rewardId, ((_e = sessionDrawnRewards.get(rewardId)) !== null && _e !== void 0 ? _e : 0) + 1);
        rewardsPool.splice(rollIndex, 1);
        totalDraws += 1;
        // break if the reward was featured & stop of featured is enabled
        if (reward.tier == types_1.BoxGachaRewardTier.FEATURED && stopOnFeaturedReward)
            break;
    }
    // return the draw result
    const returnSessionDrawnRewards = [];
    sessionDrawnRewards.forEach((value, rewardId) => {
        returnSessionDrawnRewards.push({
            id: Number(rewardId),
            number: value
        });
    });
    return {
        drawCount: totalDraws,
        mana: drawnMana,
        exp: drawnExp,
        characters: drawnCharacters,
        equipment: drawnEquipment,
        items: drawnItems,
        rewards: returnSessionDrawnRewards
    };
}
exports.drawBoxGachaSync = drawBoxGachaSync;
/**
 * Rewards a player with the results of a box gacha draw.
 *
 * @param playerId The ID of the player.
 * @param drawResult The box gacha draw result.
 * @returns A PlayerRewardResult.
 */
function rewardPlayerBoxGachaResultSync(playerId, drawResult) {
    const rewards = [];
    // convert draw results into rewards
    // items
    for (const [itemId, number] of drawResult.items) {
        rewards.push({
            name: '',
            type: types_1.RewardType.ITEM,
            id: itemId,
            count: number
        });
    }
    // equipment
    for (const [equipmentId, number] of drawResult.equipment) {
        rewards.push({
            name: '',
            type: types_1.RewardType.EQUIPMENT,
            id: equipmentId,
            count: number
        });
    }
    // characters
    for (const [characterId, number] of drawResult.characters) {
        for (let i = 0; i < number; i++) {
            rewards.push({
                name: '',
                type: types_1.RewardType.CHARACTER,
                id: characterId,
            });
        }
    }
    // mana & exp
    rewards.push({
        name: '',
        type: types_1.RewardType.EXP,
        count: drawResult.exp,
    });
    rewards.push({
        name: '',
        type: types_1.RewardType.MANA,
        count: drawResult.mana,
    });
    return (0, quest_1.givePlayerRewardsSync)(playerId, rewards);
}
exports.rewardPlayerBoxGachaResultSync = rewardPlayerBoxGachaResultSync;
