import { getDb } from "../data/db";
import {
    getPlayerDegreeIdsSync,
    grantPlayerDegreeSync,
    ensurePlayerDegreesTableSync,
} from "../data/domains/degree";
import { getPlayerItemSync, updatePlayerItemSync } from "../data/domains/item";
import { getPlayerEquipmentSync, updatePlayerEquipmentSync } from "../data/domains/equipment";
import { getPlayerSync, updatePlayerSync } from "../data/domains/player";
import {
    addPlayerShopPurchaseSync,
    getPlayerShopPurchaseCountSync,
} from "../data/domains/shopPurchase";
import { givePlayerRewardsSync } from "./quest";
import { clientSerializeEquipment } from "./equipment";
import { grantEquipmentDegreeRewardsSync } from "./equipment-degree-rewards";
import {
    CharacterReward,
    CharacterShopItemReward,
    CurrencyReward,
    CurrencyShopItemReward,
    DegreeShopItemReward,
    EquipmentItemReward,
    EquipmentItemShopItemReward,
    Reward,
    RewardType,
    ShopItem,
    ShopItemRewardType,
    ShopItemUserCostType,
    ShopType,
} from "./types";

export class ShopPurchaseValidationError extends Error {}

export interface ShopPurchaseSelection {
    shopItemId: number
    count: number
}

export interface ExecuteShopPurchasesInput {
    playerId: number
    shopType: number
    purchases: ShopPurchaseSelection[]
    resolveShopItem(shopType: number, shopItemId: number): ShopItem | null
    now?: Date
}

export interface ShopPurchaseResult {
    freeVmoney: number
    freeMana: number
    bondTokens: number
    expPool: number
    characterList: Object[]
    equipmentList: Object[]
    itemList: Record<string, number>
}

function validation(message: string): never {
    throw new ShopPurchaseValidationError(message);
}

function safePositiveInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) validation(`${label} is invalid.`);
    return value;
}

function safeTotal(value: number, count: number, label: string): number {
    const total = value * count;
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(total)) {
        validation(`${label} is invalid.`);
    }
    return total;
}

function safeRewardTotal(value: number, count: number, label: string): number {
    safePositiveInteger(value, label);
    return safeTotal(value, count, label);
}

export function isShopItemAvailable(item: ShopItem, now: Date): boolean {
    const from = item.availableFrom
        ? new Date(item.availableFrom.replace(" ", "T") + "Z")
        : null;
    const until = item.availableUntil
        ? new Date(item.availableUntil.replace(" ", "T") + "Z")
        : null;
    if ((from && Number.isNaN(from.getTime())) || (until && Number.isNaN(until.getTime()))) {
        validation("Shop item availability is invalid.");
    }
    return !(from && from > now) && !(until && until < now);
}

export function getShopItemStockQuantity(
    item: ShopItem,
    purchased: number,
    ownedDegrees: ReadonlySet<number> = new Set<number>(),
): number {
    if (!Number.isSafeInteger(purchased) || purchased < 0) {
        validation("Shop purchase history is invalid.");
    }
    for (const reward of item.rewards) {
        if (reward.type !== ShopItemRewardType.DEGREE) continue;
        const degree = reward as DegreeShopItemReward;
        if (!Number.isSafeInteger(degree.id) || degree.id <= 0 || degree.count !== 1) {
            validation("Degree reward is invalid.");
        }
        if (ownedDegrees.has(degree.id)) return 0;
    }
    if (item.stock === undefined || item.stock === -1) return -1;
    if (!Number.isSafeInteger(item.stock) || item.stock < -1) {
        validation("Shop item stock is invalid.");
    }
    return Math.max(0, item.stock - purchased);
}

function consolidateRewards(rewards: Reward[]): Reward[] {
    const result: Reward[] = [];
    const positions = new Map<string, number>();
    for (const reward of rewards) {
        let key: string | null = null;
        let count: number | null = null;
        switch (reward.type) {
            case RewardType.ITEM:
            case RewardType.EQUIPMENT:
                key = `${reward.type}:${(reward as EquipmentItemReward).id}`;
                count = (reward as EquipmentItemReward).count;
                break;
            case RewardType.BEADS:
            case RewardType.MANA:
            case RewardType.EXP:
                key = String(reward.type);
                count = (reward as CurrencyReward).count;
                break;
        }
        if (key === null || count === null) {
            result.push(reward);
            continue;
        }
        const position = positions.get(key);
        if (position === undefined) {
            positions.set(key, result.length);
            result.push({ ...reward });
            continue;
        }
        const existing = result[position] as EquipmentItemReward | CurrencyReward;
        const combined = existing.count + count;
        if (!Number.isSafeInteger(combined)) validation("Reward count is invalid.");
        existing.count = combined;
    }
    return result;
}

export function executeShopPurchasesSync(
    input: ExecuteShopPurchasesInput,
): ShopPurchaseResult {
    safePositiveInteger(input.playerId, "Player id");
    if (!Number.isSafeInteger(input.shopType)) validation("Shop type is invalid.");
    if (!Array.isArray(input.purchases) || input.purchases.length === 0) {
        validation("Purchase selection is empty.");
    }

    const combined = new Map<number, number>();
    for (const purchase of input.purchases) {
        safePositiveInteger(purchase.shopItemId, "Shop item id");
        safePositiveInteger(purchase.count, "Purchase count");
        const count = (combined.get(purchase.shopItemId) ?? 0) + purchase.count;
        if (!Number.isSafeInteger(count)) validation("Purchase count is invalid.");
        combined.set(purchase.shopItemId, count);
    }
    const purchases = Array.from(combined, ([shopItemId, count]) => ({ shopItemId, count }));

    // Lazy DDL must commit outside the purchase transaction. Running CREATE IF NOT EXISTS
    // every time avoids a stale in-memory "ensured" flag after a rolled-back migration.
    ensurePlayerDegreesTableSync();

    return getDb().transaction(() => {
        const player = getPlayerSync(input.playerId);
        if (player === null) validation("Player not found.");
        const now = input.now ?? new Date();
        if (Number.isNaN(now.getTime())) validation("Current shop time is invalid.");

        let freeVmoney = player.freeVmoney;
        let freeMana = player.freeMana;
        let bondTokens = player.bondToken;
        const itemBalances = new Map<number, number>();
        const rewards: Reward[] = [];
        const degrees: number[] = [];
        const enhancementUpdates = new Map<number, {
            targetLevel: number
            current: NonNullable<ReturnType<typeof getPlayerEquipmentSync>>
        }>();
        const ownedDegrees = new Set(getPlayerDegreeIdsSync(input.playerId));
        const plannedDegrees = new Set<number>();

        for (const { shopItemId, count } of purchases) {
            const item = input.resolveShopItem(input.shopType, shopItemId);
            if (item === null) validation(`Shop item with id ${shopItemId} does not exist.`);
            if (!isShopItemAvailable(item, now)) {
                validation(`Shop item with id ${shopItemId} is not currently available.`);
            }

            if (item.stock !== undefined) {
                if (!Number.isSafeInteger(item.stock) || item.stock < -1) {
                    validation(`Shop item ${shopItemId} stock is invalid.`);
                }
                if (item.stock >= 0) {
                    const purchased = getPlayerShopPurchaseCountSync(input.playerId, shopItemId);
                    const requestedTotal = purchased + count;
                    if (!Number.isSafeInteger(requestedTotal) || requestedTotal > item.stock) {
                        validation(`Shop item with id ${shopItemId} purchase limit reached.`);
                    }
                }
            }

            if (input.shopType === ShopType.TREASURE_EQUIPMENT) {
                const equipmentId = item.equipmentId;
                const targetLevel = item.enhancementMaxLevel;
                safePositiveInteger(equipmentId ?? 0, `Enhancement equipment id for ${shopItemId}`);
                safePositiveInteger(targetLevel ?? 0, `Enhancement target level for ${shopItemId}`);
                const current = getPlayerEquipmentSync(input.playerId, equipmentId!);
                if (current === null) validation("Player does not own the target equipment.");
                const prior = enhancementUpdates.get(equipmentId!);
                const currentLevel = prior?.targetLevel ?? current.enhancementLevel;
                if (targetLevel! <= currentLevel) {
                    validation("Target equipment is already enhanced to this level.");
                }
                enhancementUpdates.set(equipmentId!, { targetLevel: targetLevel!, current });
            }

            if (item.userCost !== undefined) {
                const total = safeTotal(item.userCost.amount, count, `User cost for ${shopItemId}`);
                switch (item.userCost.type) {
                    case ShopItemUserCostType.BEADS:
                        freeVmoney -= total;
                        if (freeVmoney < 0) validation("Not enough beads to purchase shop items.");
                        break;
                    case ShopItemUserCostType.MANA:
                        freeMana -= total;
                        if (freeMana < 0) validation("Not enough mana to purchase shop items.");
                        break;
                    case ShopItemUserCostType.AMITY_SCROLL:
                        bondTokens -= total;
                        if (bondTokens < 0) validation("Not enough amity scrolls to purchase shop items.");
                        break;
                    default:
                        validation(`Unknown user cost type for shop item ${shopItemId}.`);
                }
            }

            for (const cost of item.costs) {
                safePositiveInteger(cost.id, `Item cost id for ${shopItemId}`);
                const total = safeTotal(cost.amount, count, `Item cost for ${shopItemId}`);
                const current = itemBalances.has(cost.id)
                    ? itemBalances.get(cost.id)!
                    : (getPlayerItemSync(input.playerId, cost.id) ?? 0);
                const next = current - total;
                if (!Number.isSafeInteger(next) || next < 0) {
                    validation(`Not enough of item with id ${cost.id} to purchase shop items.`);
                }
                itemBalances.set(cost.id, next);
            }

            for (const reward of item.rewards) {
                switch (reward.type) {
                    case ShopItemRewardType.ITEM:
                    case ShopItemRewardType.EQUIPMENT: {
                        const value = reward as EquipmentItemShopItemReward;
                        safePositiveInteger(value.id, `Reward id for ${shopItemId}`);
                        const total = safeRewardTotal(value.count, count, `Reward count for ${shopItemId}`);
                        rewards.push({
                            name: "",
                            type: reward.type === ShopItemRewardType.ITEM
                                ? RewardType.ITEM : RewardType.EQUIPMENT,
                            id: value.id,
                            count: total,
                        } as EquipmentItemReward);
                        break;
                    }
                    case ShopItemRewardType.EXP:
                    case ShopItemRewardType.MANA: {
                        const value = reward as CurrencyShopItemReward;
                        const total = safeRewardTotal(value.count, count, `Reward count for ${shopItemId}`);
                        rewards.push({
                            name: "",
                            type: reward.type === ShopItemRewardType.EXP
                                ? RewardType.EXP : RewardType.MANA,
                            count: total,
                        } as CurrencyReward);
                        break;
                    }
                    case ShopItemRewardType.CHARACTER: {
                        const value = reward as CharacterShopItemReward;
                        safePositiveInteger(value.id, `Character reward id for ${shopItemId}`);
                        for (let index = 0; index < count; index += 1) {
                            rewards.push({ name: "", type: RewardType.CHARACTER, id: value.id } as CharacterReward);
                        }
                        break;
                    }
                    case ShopItemRewardType.DEGREE: {
                        const value = reward as DegreeShopItemReward;
                        safePositiveInteger(value.id, `Degree reward id for ${shopItemId}`);
                        if (value.count !== 1 || count !== 1) {
                            validation(`Degree reward for shop item ${shopItemId} must have count 1.`);
                        }
                        if (ownedDegrees.has(value.id) || plannedDegrees.has(value.id)) {
                            validation("Player already owns this degree.");
                        }
                        plannedDegrees.add(value.id);
                        degrees.push(value.id);
                        break;
                    }
                    default:
                        validation(`Unknown reward type for shop item ${shopItemId}.`);
                }
            }
        }

        for (const [itemId, amount] of itemBalances) {
            updatePlayerItemSync(input.playerId, itemId, amount);
        }
        updatePlayerSync({
            id: input.playerId,
            freeVmoney,
            freeMana,
            bondToken: bondTokens,
        });
        const rewardResult = givePlayerRewardsSync(
            input.playerId, consolidateRewards(rewards)
        );
        const enhancedEquipment: Object[] = [];
        for (const [equipmentId, update] of enhancementUpdates) {
            updatePlayerEquipmentSync(input.playerId, equipmentId, {
                enhancementLevel: update.targetLevel,
            });
            update.current.enhancementLevel = update.targetLevel;
            enhancedEquipment.push(clientSerializeEquipment(equipmentId, update.current));
        }
        if (enhancementUpdates.size > 0) {
            grantEquipmentDegreeRewardsSync(input.playerId, [...enhancementUpdates.keys()]);
        }
        for (const degreeId of degrees) grantPlayerDegreeSync(input.playerId, degreeId);
        for (const { shopItemId, count } of purchases) {
            for (let index = 0; index < count; index += 1) {
                addPlayerShopPurchaseSync(input.playerId, shopItemId);
            }
        }

        const after = getPlayerSync(input.playerId);
        if (after === null || rewardResult === null) {
            throw new Error("Shop purchase readback failed.");
        }
        return {
            freeVmoney: after.freeVmoney,
            freeMana: after.freeMana,
            bondTokens: after.bondToken,
            expPool: after.expPool,
            characterList: rewardResult.character_list,
            equipmentList: [...rewardResult.equipment_list, ...enhancedEquipment],
            itemList: {
                ...Object.fromEntries(itemBalances),
                ...rewardResult.items,
            },
        };
    })();
}
