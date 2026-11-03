"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFiveBossWeaponAdditionalRewardDrops = exports.buildFiveBossCursedWeaponDropPlan = exports.buildFiveBossSoloGauntletRewardPlan = exports.buildFiveBossGauntletRewardPlan = exports.canUseAwakeningSubstitutionItem = exports.FIVE_BOSS_GAUNTLET_WEAPON = exports.getFiveBossCursedWeaponPool = exports.FIVE_BOSS_CURSED_WEAPON_REWARD_DISPLAY = exports.FIVE_BOSS_CURSED_WEAPON_POOL_SIZE = exports.FIVE_BOSS_CURSED_WEAPON_ID_BASE = exports.FIVE_BOSS_KING_COIN_SPAN = exports.FIVE_BOSS_KING_COIN_MIN = exports.FIVE_BOSS_SOLO_FIVE_KING_CORE_DROP_RATE = exports.FIVE_BOSS_SOLO_CURSED_WEAPON_DROP_RATE = exports.FIVE_BOSS_CURSED_WEAPON_DROP_RATE = exports.FIVE_BOSS_SOLO_BLUEPRINT_DROP_RATE = exports.FIVE_BOSS_BLUEPRINT_DROP_RATE = exports.buildFiveBossAdditionalRewardDrops = exports.FIVE_BOSS_GAUNTLET_REWARD_DISPLAY = exports.FIVE_BOSS_GAUNTLET_REWARD_IDS = void 0;
const equipment_ids_json_1 = __importDefault(require("../../../assets/equipment_ids.json"));
exports.FIVE_BOSS_GAUNTLET_REWARD_IDS = Object.freeze({
    blueprintFragment: 10000144,
    deepCrystal: 10000145,
    firstClearEmblem: 10000146,
    fiveKingCore: 10000147,
    /** 深界王币：作者 0928「每把能掉 10-15 个」，兑换武器扭蛋券与禁忌星铁（五重商店 032/033/034）。 */
    kingCoin: 10000310,
});
/**
 * 结算页只认 drop_additional_reward_ids 里的「客户端 additional_reward 组 + 序号」,
 * item_list 只更新背包数字不上屏(真机 2026-09-04:材料到账但结算页空白)。
 * 组 590010000 的五行在客户端 master/reward/event/additional_reward.orderedmap(1.4.725),
 * 序号顺序与这里必须一致。
 */
exports.FIVE_BOSS_GAUNTLET_REWARD_DISPLAY = Object.freeze({
    additionalRewardGroupId: 590010000,
    indexByItemId: Object.freeze({
        [exports.FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment]: 1,
        [exports.FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal]: 2,
        [exports.FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem]: 3,
        [exports.FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore]: 4,
        // 行 [590010000][5] = five_boss_king_coin,0,10000310,1,1 于 1.4.1100 上线（边 E2a）
        [exports.FIVE_BOSS_GAUNTLET_REWARD_IDS.kingCoin]: 5,
    }),
});
/** 把已发放的道具映射成结算页能展示的 additional_reward 引用;没有展示行的道具跳过。 */
function buildFiveBossAdditionalRewardDrops(grantedItems) {
    const drops = [];
    for (const item of grantedItems) {
        const index = exports.FIVE_BOSS_GAUNTLET_REWARD_DISPLAY.indexByItemId[item.itemId];
        if (index === undefined || item.amount <= 0)
            continue;
        drops.push({
            group_id: exports.FIVE_BOSS_GAUNTLET_REWARD_DISPLAY.additionalRewardGroupId,
            index,
            number: item.amount,
        });
    }
    return drops;
}
exports.buildFiveBossAdditionalRewardDrops = buildFiveBossAdditionalRewardDrops;
/**
 * 终式武装图纸掉率(每次通关独立判定,不随手动倍率翻倍)。
 * 2026-09-06 作者首定为 50%;2026-09-28《五重决战重做设计》第 5 节改为 60%。
 */
exports.FIVE_BOSS_BLUEPRINT_DROP_RATE = 0.6;
/** 单人奖励按同模式多人奖励的二分之一折算后的概率。 */
exports.FIVE_BOSS_SOLO_BLUEPRINT_DROP_RATE = exports.FIVE_BOSS_BLUEPRINT_DROP_RATE / 2;
/**
 * 诅咒武器本体随机掉落命中率(每次掷骰独立判定,掷骰次数 = rewardMultiplier)。
 * 2026-09-28 设计稿定 15%;同日作者裁定诅咒武器以武器扭蛋 990003 为主,五重直掉降到 5%。
 */
exports.FIVE_BOSS_CURSED_WEAPON_DROP_RATE = 0.05;
/** 单人诅咒武器每次掷骰按多人掉率的二分之一计算。 */
exports.FIVE_BOSS_SOLO_CURSED_WEAPON_DROP_RATE = exports.FIVE_BOSS_CURSED_WEAPON_DROP_RATE / 2;
/**
 * 五王心核在单人模式只发 1 个,按多人同倍率期望值的二分之一转为命中概率；
 * 手动倍率若超过 100% 则封顶,保持单人最多只掉 1 个。
 * AUTO: E[多人]=1.25 -> 62.5%; 手动: E[多人]=2.5 -> 125% -> 100% 封顶。
 */
exports.FIVE_BOSS_SOLO_FIVE_KING_CORE_DROP_RATE = Object.freeze({
    1: 1.25 / 2,
    2: 1,
});
/** 深界王币每局掉落：MIN .. MIN + SPAN - 1（10..15），均匀，不乘手动倍率。 */
exports.FIVE_BOSS_KING_COIN_MIN = 10;
exports.FIVE_BOSS_KING_COIN_SPAN = 6;
/** 诅咒武器池 id 区间:5910101..5910129(29 把),index = equipmentId - base。 */
exports.FIVE_BOSS_CURSED_WEAPON_ID_BASE = 5910100;
exports.FIVE_BOSS_CURSED_WEAPON_POOL_SIZE = 29;
const FIVE_BOSS_CURSED_WEAPON_CANDIDATE_IDS = Object.freeze(Array.from({ length: exports.FIVE_BOSS_CURSED_WEAPON_POOL_SIZE }, (_, index) => exports.FIVE_BOSS_CURSED_WEAPON_ID_BASE + 1 + index));
/**
 * 诅咒武器掉落展示:客户端 additional_reward 组 590010001,index = equipmentId - 5910100(1..29)。
 * 行内容(kind=1 Equipment)由数据侧另行发布到 master/reward/event/additional_reward.orderedmap,
 * 与材料组 590010000 并列,不在本次服务端改动范围。
 */
exports.FIVE_BOSS_CURSED_WEAPON_REWARD_DISPLAY = Object.freeze({
    additionalRewardGroupId: 590010001,
});
/**
 * 按服务端 equipment_ids.json 白名单过滤诅咒武器候选池(该 JSON 随服务端启动静态导入,
 * 诅咒武器/PARADOX 施工会话增删武器登记后需重启服务端才生效),防止掉出一个服务端
 * 根本不认的装备 id(不存在会在 givePlayerEquipmentSync 里静默建一条脏记录)。
 * 池为空(例如全部武器暂时下架)时调用方应直接跳过掉落,不抛错。
 */
function getFiveBossCursedWeaponPool() {
    const known = new Set(equipment_ids_json_1.default);
    return FIVE_BOSS_CURSED_WEAPON_CANDIDATE_IDS.filter(id => known.has(id));
}
exports.getFiveBossCursedWeaponPool = getFiveBossCursedWeaponPool;
exports.FIVE_BOSS_GAUNTLET_WEAPON = Object.freeze({
    equipmentId: 5900101,
    name: "死亡使者·终式",
    blueprintFragmentsPerBody: 8,
    bodiesForMaxLimitBreak: 5,
    maxEnhancedLevel: 120,
    allowFiveStarSteelSubstitution: false,
    maxAttackPercent: 25,
    maxAbilityDamagePercent: 475,
    maxIndependentAbilityDamagePercent: 5,
});
function canUseAwakeningSubstitutionItem(equipmentId) {
    return equipmentId !== exports.FIVE_BOSS_GAUNTLET_WEAPON.equipmentId;
}
exports.canUseAwakeningSubstitutionItem = canUseAwakeningSubstitutionItem;
function checkedRandomFloat(randomFloat) {
    const value = randomFloat();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
        throw new RangeError("randomFloat must return a finite value in [0, 1)");
    }
    return value;
}
function buildFiveBossGauntletRewardPlan(input) {
    var _a;
    if (typeof input.firstClear !== "boolean") {
        throw new TypeError("firstClear must be a boolean");
    }
    if (input.rewardMultiplier !== 1 && input.rewardMultiplier !== 2) {
        throw new RangeError("rewardMultiplier must be 1 or 2");
    }
    const randomFloat = (_a = input.randomFloat) !== null && _a !== void 0 ? _a : Math.random;
    const items = [];
    // 2026-09-06 作者:「武器图纸也是概率掉吧」→ 图纸按 FIVE_BOSS_BLUEPRINT_DROP_RATE 概率掉 1 张
    // (不随手动倍率翻倍);2026-09-28 设计稿把掉率从 50% 提到 60%。
    if (checkedRandomFloat(randomFloat) < exports.FIVE_BOSS_BLUEPRINT_DROP_RATE) {
        items.push({
            itemId: exports.FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment,
            amount: 1,
            multiplierKind: "fixed",
        });
    }
    // 2026-09-28 设计稿第 5 节:结晶 5→10 × 倍率。
    items.push({
        itemId: exports.FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal,
        amount: 10 * input.rewardMultiplier,
        multiplierKind: "repeatable",
    });
    if (input.firstClear) {
        items.push({
            itemId: exports.FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem,
            amount: 1,
            multiplierKind: "fixed",
        });
    }
    // 2026-09-28 设计稿第 5 节:心核改为「必掉 1 × 倍率 + 25% 额外 1 × 倍率」,合并成一条 amount
    // (旧版是纯 25% 判定,不中则整条奖励缺席;新版保底,只有加成部分是概率的)。
    let fiveKingCoreAmount = input.rewardMultiplier;
    if (checkedRandomFloat(randomFloat) < 0.25) {
        fiveKingCoreAmount += input.rewardMultiplier;
    }
    items.push({
        itemId: exports.FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore,
        amount: fiveKingCoreAmount,
        multiplierKind: "repeatable",
    });
    // 作者 0928：深界王币每局均匀 10..15 个，不随手动倍率翻倍（「每把能掉 10-15 个」）。
    // 放在心核之后、诅咒武器掷骰之前（随机序列保持「先材料后武器」）。
    items.push({
        itemId: exports.FIVE_BOSS_GAUNTLET_REWARD_IDS.kingCoin,
        amount: exports.FIVE_BOSS_KING_COIN_MIN + Math.floor(checkedRandomFloat(randomFloat) * exports.FIVE_BOSS_KING_COIN_SPAN),
        multiplierKind: "fixed",
    });
    return { items };
}
exports.buildFiveBossGauntletRewardPlan = buildFiveBossGauntletRewardPlan;
/**
 * 单人五重奖励：数量型掉落按同倍率多人奖励的二分之一向上取整；
 * 心核、图纸和诅咒武器本体使用单人专用概率。首通凭证保持固定 1 个。
 */
function buildFiveBossSoloGauntletRewardPlan(input) {
    var _a;
    if (typeof input.firstClear !== "boolean") {
        throw new TypeError("firstClear must be a boolean");
    }
    if (input.rewardMultiplier !== 1 && input.rewardMultiplier !== 2) {
        throw new RangeError("rewardMultiplier must be 1 or 2");
    }
    const randomFloat = (_a = input.randomFloat) !== null && _a !== void 0 ? _a : Math.random;
    const items = [];
    if (checkedRandomFloat(randomFloat) < exports.FIVE_BOSS_SOLO_BLUEPRINT_DROP_RATE) {
        items.push({
            itemId: exports.FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment,
            amount: 1,
            multiplierKind: "fixed",
        });
    }
    items.push({
        itemId: exports.FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal,
        amount: Math.ceil((10 * input.rewardMultiplier) / 2),
        multiplierKind: "repeatable",
    });
    if (input.firstClear) {
        items.push({
            itemId: exports.FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem,
            amount: 1,
            multiplierKind: "fixed",
        });
    }
    if (checkedRandomFloat(randomFloat) < exports.FIVE_BOSS_SOLO_FIVE_KING_CORE_DROP_RATE[input.rewardMultiplier]) {
        items.push({
            itemId: exports.FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore,
            amount: 1,
            multiplierKind: "fixed",
        });
    }
    const kingCoin = exports.FIVE_BOSS_KING_COIN_MIN
        + Math.floor(checkedRandomFloat(randomFloat) * exports.FIVE_BOSS_KING_COIN_SPAN);
    items.push({
        itemId: exports.FIVE_BOSS_GAUNTLET_REWARD_IDS.kingCoin,
        amount: Math.ceil(kingCoin / 2),
        multiplierKind: "fixed",
    });
    return { items };
}
exports.buildFiveBossSoloGauntletRewardPlan = buildFiveBossSoloGauntletRewardPlan;
/**
 * 诅咒武器本体随机掉落(2026-09-28 设计稿第 5 节新增)。掷骰次数 = rewardMultiplier
 * (手动局 2 次、AUTO 局 1 次),每次独立 FIVE_BOSS_CURSED_WEAPON_DROP_RATE 命中;
 * 命中则从候选池均匀抽 1 把,发 1 件。纯函数,不做任何发放 I/O,随机源可注入以保证测试确定。
 */
function buildFiveBossCursedWeaponDropPlan(input) {
    var _a, _b;
    if (input.rewardMultiplier !== 1 && input.rewardMultiplier !== 2) {
        throw new RangeError("rewardMultiplier must be 1 or 2");
    }
    if (!Array.isArray(input.availableEquipmentIds)) {
        throw new TypeError("availableEquipmentIds must be an array");
    }
    const dropRate = (_a = input.dropRate) !== null && _a !== void 0 ? _a : exports.FIVE_BOSS_CURSED_WEAPON_DROP_RATE;
    if (!Number.isFinite(dropRate) || dropRate < 0 || dropRate > 1) {
        throw new RangeError("dropRate must be a number in [0, 1]");
    }
    const randomFloat = (_b = input.randomFloat) !== null && _b !== void 0 ? _b : Math.random;
    const equipmentIds = [];
    if (input.availableEquipmentIds.length > 0) {
        for (let roll = 0; roll < input.rewardMultiplier; roll++) {
            if (checkedRandomFloat(randomFloat) < dropRate) {
                const pickIndex = Math.min(input.availableEquipmentIds.length - 1, Math.floor(checkedRandomFloat(randomFloat) * input.availableEquipmentIds.length));
                equipmentIds.push(input.availableEquipmentIds[pickIndex]);
            }
        }
    }
    return { equipmentIds };
}
exports.buildFiveBossCursedWeaponDropPlan = buildFiveBossCursedWeaponDropPlan;
/** 每把掉落的诅咒武器各自一条结算页展示行(kind=1 Equipment,组 590010001)。 */
function buildFiveBossWeaponAdditionalRewardDrops(grantedEquipmentIds) {
    return grantedEquipmentIds.map(equipmentId => ({
        group_id: exports.FIVE_BOSS_CURSED_WEAPON_REWARD_DISPLAY.additionalRewardGroupId,
        index: equipmentId - exports.FIVE_BOSS_CURSED_WEAPON_ID_BASE,
        number: 1,
    }));
}
exports.buildFiveBossWeaponAdditionalRewardDrops = buildFiveBossWeaponAdditionalRewardDrops;
