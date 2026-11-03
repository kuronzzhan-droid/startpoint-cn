"use strict";
// Handles EX boosts for characters.
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const character_1 = require("../../data/domains/character");
const item_1 = require("../../data/domains/item");
const session_1 = require("../../data/domains/session");
const assets_1 = require("../../lib/assets");
const utils_1 = require("../../utils");
const crypto_1 = require("crypto");
const utils_2 = require("../../data/utils");
const activeAccount_1 = require("../../data/activeAccount");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const character_overlimit_1 = require("../../lib/character-overlimit");
const ex_ability_json_1 = __importDefault(require("../../../assets/ex_ability.json"));
// ---- A/B group classification from orderedmap ability names ----
const A_PREFIXES = ['atk_self_', 'skilldamage_self_', 'directdamage_self_',
    'abilitydamage_self_', 'abilitydagame_self_',
    'atk_party_', 'skilldamage_party_', 'directdamage_party_',
    'abilitydamage_party_', 'abilitydagame_party_',
    'powerflipdamage_', 'hp_self_'];
// These match A_PREFIXES but are actually B-group (buff extend/duration)
const B_OVERRIDES = ['powerflipdamage_buffextend_'];
function classifyAbilities(data) {
    var _a;
    const list = [];
    for (const [id, raw] of Object.entries(data)) {
        const name = ((_a = raw[0]) === null || _a === void 0 ? void 0 : _a[0]) || '';
        const isBOverride = B_OVERRIDES.some(p => name.startsWith(p));
        const isA = !isBOverride && A_PREFIXES.some(p => name.startsWith(p));
        let rarity = 1; // brown
        if (name.endsWith('_r5'))
            rarity = 3;
        else if (name.endsWith('_r4'))
            rarity = 2;
        list.push({ id: Number(id), name, group: isA ? 'A' : 'B', rarity });
    }
    return list;
}
const ALL_ABILITIES = classifyAbilities(ex_ability_json_1.default);
// 第三个词条（作者 1103，开荒编排第 8 条）：只在「开场技能槽 +25%」(40, initial_skillgauge_self_r5)
// 和「技能槽上限 +7.5%」(41, skillgagemax_self_r5) 两条里各 50% 抽，不再看材料的稀有度权重。
const EX_THIRD_AFFIX_POOL = [40, 41];
// 6 pools: A/B × gold(3)/silver(2)/brown(1)
function poolCopy(abilities, group, rarity) {
    return abilities.filter(a => a.group === group && a.rarity === rarity).map(a => a.id);
}
// 破星结晶 (universal): 10001(tier1) 10002(tier2) 10003(tier3)
// 崇高辉石 (element): 14001-14018, element order 0,1,2,3,5,4
const STONE_ELEMENT_ORDER = [0, 1, 2, 3, 5, 4];
const MATERIAL_PROBS = {};
{
    // Tier 1 (3★): 破星 [1.88,1.70,4.13,3.75,1.50,1.36]  崇高 [2.00,1.82,4.00,3.64,2.00,1.82]
    // Tier 2 (4★): 破星 [1.66,1.51,4.57,4.15,2.08,1.89]  崇高 [1.78,1.62,4.45,4.05,2.67,2.43]
    // Tier 3 (5★): 破星 [0,0,1.00,0.91,9.00,8.18]          崇高 [0,0,0,0,10.0,9.09]
    const probs = [
        [[1.88, 1.70, 4.13, 3.75, 1.50, 1.36], [2.00, 1.82, 4.00, 3.64, 2.00, 1.82]],
        [[1.66, 1.51, 4.57, 4.15, 2.08, 1.89], [1.78, 1.62, 4.45, 4.05, 2.67, 2.43]],
        [[0, 0, 1.00, 0.91, 9.00, 8.18], [0, 0, 0, 0, 10.0, 9.09]],
    ];
    for (let tier = 1; tier <= 3; tier++) {
        const ti = tier - 1;
        // 破星结晶
        const cp = probs[ti][0];
        MATERIAL_PROBS[10000 + tier] = { a1: cp[0], b1: cp[1], a2: cp[2], b2: cp[3], a3: cp[4], b3: cp[5] };
        const sp = probs[ti][1];
        for (let ei = 0; ei < STONE_ELEMENT_ORDER.length; ei++) {
            const id = 14001 + STONE_ELEMENT_ORDER[ei] * 3 + ti;
            MATERIAL_PROBS[id] = { a1: sp[0], b1: sp[1], a2: sp[2], b2: sp[3], a3: sp[4], b3: sp[5] };
        }
    }
}
// ---- Draw pools (regenerated per draw to allow mutation) ----
function freshPools() {
    return {
        A: { 1: poolCopy(ALL_ABILITIES, 'A', 1), 2: poolCopy(ALL_ABILITIES, 'A', 2), 3: poolCopy(ALL_ABILITIES, 'A', 3) },
        B: { 1: poolCopy(ALL_ABILITIES, 'B', 1), 2: poolCopy(ALL_ABILITIES, 'B', 2), 3: poolCopy(ALL_ABILITIES, 'B', 3) },
    };
}
const playerDraws = {};
// ---- Draw logic ----
function drawOneAbility(groupPools, probs, group) {
    const rates = group === 'A' ? [probs.a1, probs.a2, probs.a3] : [probs.b1, probs.b2, probs.b3];
    // Table values are rarity weights per material. Weighted random: pick rarity by proportion.
    const totalWeight = rates[0] + rates[1] + rates[2];
    if (totalWeight <= 0)
        return null;
    const roll = (0, crypto_1.randomInt)(1, Math.round(totalWeight * 100) + 1) / 100; // [0.01, totalWeight+0.01]
    let cumulative = 0;
    // Check from gold to brown
    for (let r = 3; r >= 1; r--) {
        cumulative += rates[r - 1];
        if (roll <= cumulative && groupPools[r].length > 0) {
            const idx = (0, crypto_1.randomInt)(groupPools[r].length);
            return groupPools[r].splice(idx, 1)[0];
        }
    }
    return null;
}
function drawExBoostAbilities(materialId, exStatusPool) {
    // Always get 1 status
    const statusId = exStatusPool[(0, crypto_1.randomInt)(exStatusPool.length)];
    const probs = MATERIAL_PROBS[materialId];
    if (!probs)
        return { statusId, abilityIdList: [] };
    const pools = freshPools();
    const abilityIdList = [];
    // Independent A-group draw
    const aid = drawOneAbility(pools.A, probs, 'A');
    if (aid !== null)
        abilityIdList.push(aid);
    // Independent B-group draw
    const bid = EX_THIRD_AFFIX_POOL[(0, crypto_1.randomInt)(EX_THIRD_AFFIX_POOL.length)];
    if (bid !== null)
        abilityIdList.push(bid);
    return { statusId, abilityIdList };
}
// ---- Endpoint handler ----
const drawExpBoost = (request, reply, autoAccept) => __awaiter(void 0, void 0, void 0, function* () {
    const body = request.body;
    const viewerId = body.viewer_id;
    const characterId = body.character_id;
    const costItemId = body.cost_item_id;
    if (isNaN(viewerId) || isNaN(characterId) || isNaN(costItemId))
        return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        });
    const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
    if (!viewerIdSession)
        return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        });
    const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
    if (playerId === null)
        return reply.status(500).send({
            "error": "Internal Server Error", "message": "No players bound to account."
        });
    const characterAssetData = (0, assets_1.getCharacterDataSync)(characterId);
    if (!characterAssetData) {
        if ((0, character_1.getPlayerCharacterSync)(playerId, characterId) === null)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Player does not own character."
            });
        return reply.status(500).send({
            "error": "Internal Server Error", "message": "Character does not have data."
        });
    }
    const costItemData = (0, assets_1.getExBoostItemSync)(costItemId);
    // Ownership, balance and over-limit checks run inside the player write
    // queue so that overlapping requests each see the balance left by the
    // previous one instead of all deducting from the same starting value.
    const outcome = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
        domain: "player", playerId, operation: autoAccept ? "ex_boost_first_draw" : "ex_boost_draw",
    }, () => {
        const reject = (status, message) => ({ ok: false, status, message });
        const characterData = (0, character_1.getPlayerCharacterSync)(playerId, characterId);
        if (characterData === null)
            return reject(400, "Player does not own character.");
        if (!costItemData)
            return reject(400, "Attempt to use invalid cost item.");
        if ((costItemData.element !== undefined) && (costItemData.element !== characterAssetData.element)) {
            return reject(400, "Attempt to use wrong item with different element from character.");
        }
        const costItemAmount = (0, item_1.getPlayerItemSync)(playerId, costItemId);
        if (costItemAmount === null)
            return reject(400, "You do not own item.");
        const afterCostItemAmount = costItemAmount - costItemData.count;
        if (0 > afterCostItemAmount)
            return reject(400, "Not enough of item.");
        // ensure max over limit step (aligned with client isMaxOverLimitStep)
        const rarity = characterAssetData.rarity;
        const maxOver = (0, character_overlimit_1.getCharacterMaxOverLimit)(characterId, rarity);
        if (maxOver === undefined || characterData.overLimitStep < maxOver) {
            return reject(400, "Character not at max over limit step.");
        }
        const drawTier = costItemData.tier;
        const exStatusPool = (0, assets_1.getExStatusPoolSync)(drawTier);
        if (exStatusPool === null)
            return reject(500, "Status pool not found.");
        const draw = drawExBoostAbilities(costItemId, exStatusPool);
        const drawResult = {
            characterId, statusId: draw.statusId, abilityIdList: draw.abilityIdList
        };
        (0, item_1.updatePlayerItemSync)(playerId, costItemId, afterCostItemAmount);
        if (autoAccept) {
            (0, character_1.updatePlayerCharacterSync)(playerId, characterId, {
                exBoost: { statusId: drawResult.statusId, abilityIdList: drawResult.abilityIdList }
            });
        }
        return { ok: true, characterData, drawResult, afterCostItemAmount };
    });
    if (!outcome.ok)
        return reply.status(outcome.status).send({
            "error": outcome.status === 400 ? "Bad Request" : "Internal Server Error", "message": outcome.message
        });
    const { characterData, drawResult, afterCostItemAmount } = outcome;
    const headers = (0, utils_1.generateDataHeaders)({ viewer_id: viewerId });
    reply.header("content-type", "application/x-msgpack");
    if (autoAccept) {
        return reply.status(200).send({
            data_headers: headers,
            data: {
                character_list: [{
                        character_id: characterId, viewer_id: viewerId,
                        entry_count: characterData.entryCount,
                        evolution_level: characterData.evolutionLevel,
                        over_limit_step: characterData.overLimitStep,
                        protection: characterData.protection,
                        exp: characterData.exp,
                        stack: characterData.stack,
                        mana_board_index: characterData.manaBoardIndex,
                        bond_token_list: characterData.bondTokenList.map(bt => ({
                            mana_board_index: bt.manaBoardIndex, status: bt.status
                        })),
                        ex_boost: { status_id: drawResult.statusId, ability_id_list: drawResult.abilityIdList },
                        create_time: (0, utils_2.clientSerializeDate)(characterData.joinTime),
                        update_time: (0, utils_2.clientSerializeDate)(new Date()),
                        join_time: (0, utils_2.clientSerializeDate)(characterData.joinTime),
                    }],
                item_list: { [String(costItemId)]: afterCostItemAmount },
                mail_arrived: false,
            },
        });
    }
    else {
        playerDraws[playerId] = drawResult;
        return reply.status(200).send({
            data_headers: headers,
            data: {
                character_id: characterId,
                draw_result: { status_id: drawResult.statusId, ability_id_list: drawResult.abilityIdList },
                item_list: { [String(costItemId)]: afterCostItemAmount },
                mail_arrived: false,
            },
        });
    }
});
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/select", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const isConfirm = body.is_confirm;
        if (isNaN(viewerId))
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error", "message": "No players bound to account."
            });
        const drawResult = playerDraws[playerId];
        if (drawResult === undefined)
            return reply.status(400).send({
                "error": "Bad Request", "message": "No draw result to select."
            });
        const headers = (0, utils_1.generateDataHeaders)({ viewer_id: viewerId });
        delete playerDraws[playerId];
        if (!isConfirm) {
            return reply.status(200).send({ data_headers: headers, data: { mail_arrived: false } });
        }
        const characterId = drawResult.characterId;
        const characterData = (0, character_1.getPlayerCharacterSync)(playerId, characterId);
        if (characterData === null)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Player does not own character."
            });
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "ex_boost_select",
        }, () => {
            (0, character_1.updatePlayerCharacterSync)(playerId, characterId, {
                exBoost: { statusId: drawResult.statusId, abilityIdList: drawResult.abilityIdList }
            });
        });
        return reply.status(200).send({
            data_headers: headers,
            data: {
                character_list: [{
                        character_id: characterId, viewer_id: viewerId,
                        entry_count: characterData.entryCount,
                        evolution_level: characterData.evolutionLevel,
                        over_limit_step: characterData.overLimitStep,
                        protection: characterData.protection,
                        exp: characterData.exp, stack: characterData.stack,
                        mana_board_index: characterData.manaBoardIndex,
                        bond_token_list: characterData.bondTokenList.map(bt => ({
                            mana_board_index: bt.manaBoardIndex, status: bt.status
                        })),
                        ex_boost: { status_id: drawResult.statusId, ability_id_list: drawResult.abilityIdList },
                        create_time: (0, utils_2.clientSerializeDate)(characterData.joinTime),
                        update_time: (0, utils_2.clientSerializeDate)(new Date()),
                        join_time: (0, utils_2.clientSerializeDate)(characterData.joinTime),
                    }],
                mail_arrived: false,
            },
        });
    }));
    fastify.post("/draw", (request, reply) => __awaiter(void 0, void 0, void 0, function* () { return drawExpBoost(request, reply, false); }));
    fastify.post("/first_draw", (request, reply) => __awaiter(void 0, void 0, void 0, function* () { return drawExpBoost(request, reply, true); }));
});
exports.default = routes;
