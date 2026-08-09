import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSession } from "../../data/domains/session";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { getServerTime } from "../../utils";
import { getPlayerShopPurchasesMapSync } from "../../data/domains/shopPurchase";
import { getGenericShopItemsSync } from "../../lib/assets";
import { ShopItem, ShopType, ShopItems, ShopItemRewardType } from "../../lib/types";
import boxRewardData from "../../../assets/box_reward.json";
import eventItemShopItems from "../../../assets/event_item_shop.json";
import bossCoinShopItems from "../../../assets/boss_coin_shop.json";

interface GetListBody {
    viewer_id: number;
    equipment_id: number;
    item_id?: number;
}

function itemRewardContainsItemId(item: ShopItem, targetItemId: number, rewardTypes: ShopItemRewardType[]): boolean {
    for (const reward of item.rewards) {
        if (rewardTypes.includes(reward.type)) {
            const itemReward = reward as unknown as { id: number, count: number };
            if (itemReward.id === targetItemId) {
                return true;
            }
        }
    }
    return false;
}

function findBoxGachaIdsForItem(targetItemId: number, rewardTypes: number[]): number[] {
    const result: number[] = [];
    for (const [boxGachaId, stages] of Object.entries(boxRewardData)) {
        for (const stage of Object.values(stages as Record<string, any>)) {
            for (const reward of Object.values(stage as Record<string, any>)) {
                const rewardObj = reward as { type: number, id: number };
                if (rewardTypes.includes(rewardObj.type) && rewardObj.id === targetItemId) {
                    result.push(Number(boxGachaId));
                    break;
                }
            }
        }
    }
    return [...new Set(result)];
}

function buildEnhancementSalesList(playerId: number, items: ShopItems, targetItemId: number, rewardTypes: ShopItemRewardType[]): Object[] {
    if (Object.keys(items).length === 0) return []

    const groups = new Map<number, {
        groupId: number
        items: { id: string, item: ShopItem, stage: number }[]
        equipmentId: number
    }>()
    for (const [itemId, item] of Object.entries(items)) {
        if (!itemRewardContainsItemId(item, targetItemId, rewardTypes)) continue;

        const gid = item.groupId ?? 0
        if (!groups.has(gid)) {
            groups.set(gid, {
                groupId: gid,
                items: [],
                equipmentId: item.equipmentId ?? 0
            })
        }
        groups.get(gid)!.items.push({ id: itemId, item, stage: item.stage ?? 0 })
    }

    const result: Object[] = []
    const purchasedMap = getPlayerShopPurchasesMapSync(playerId)

    for (const [, group] of groups) {
        group.items.sort((a, b) => a.stage - b.stage)

        const enhancementLevel = 0
        let targetItem = group.items[0]
        let stockQuantity = targetItem.item.enhancementMaxLevel ?? 0
        let totalPurchaseNum = 0

        for (const entry of group.items) {
            const maxLv = entry.item.enhancementMaxLevel ?? 0
            if (maxLv > enhancementLevel) {
                targetItem = entry
                stockQuantity = maxLv - enhancementLevel
                break
            }
        }
        totalPurchaseNum = enhancementLevel

        const maxLevel = group.items[group.items.length - 1].item.enhancementMaxLevel ?? 0

        result.push({
            "shop_item_id": Number(targetItem.id),
            "stock_quantity": stockQuantity,
            "today_purchase_num": purchasedMap[Number(targetItem.id)] ?? 0,
            "this_month_purchase_num": null,
            "total_purchase_num": totalPurchaseNum,
            "group_info": {
                "group_total_stock_quantity": maxLevel - totalPurchaseNum,
                "group_total_purchase_num": totalPurchaseNum,
                "multi_stage": group.items.length > 1
            },
            "shop_type": ShopType.TREASURE_EQUIPMENT
        })
    }

    return result
}

function addShopSalesItem(shopSalesList: Object[], itemId: string, item: ShopItem, shopType: ShopType, purchasedMap: Record<number, number>) {
    const purchased = purchasedMap[Number(itemId)] ?? 0;
    const stockQuantity = item.stock !== undefined ? Math.max(0, item.stock - purchased) : -1;

    const entry: any = {
        "shop_item_id": Number(itemId),
        "stock_quantity": stockQuantity,
        "today_purchase_num": purchased,
        "this_month_purchase_num": purchased,
        "total_purchase_num": purchased,
        "shop_type": shopType
    };

    if (shopType === ShopType.STAR_GRAIN || shopType === ShopType.TREASURE ||
        shopType === ShopType.GENERAL || shopType === ShopType.EVENT_ITEM || shopType === ShopType.BOSS_COIN) {
        entry["group_info"] = {
            "group_total_stock_quantity": stockQuantity,
            "group_total_purchase_num": purchased,
            "multi_stage": false
        };
    }

    shopSalesList.push(entry);
}

function buildEmptyResponse(reply: FastifyReply, viewerId: number) {
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({
        "data_headers": {
            "force_update": false,
            "asset_update": false,
            "short_udid": 0,
            "viewer_id": viewerId,
            "servertime": getServerTime(),
            "result_code": 1
        },
        "data": {
            "box_gacha_id_list": [],
            "unselected_lineup_shop_sales_list": [],
            "shop_sales_list": []
        }
    });
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/get_list", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GetListBody;
        const viewerId = body?.viewer_id;
        const isEquipment = !!body?.equipment_id;
        const targetItemId = body?.equipment_id ?? body?.item_id;

        const rewardTypes = isEquipment
            ? [ShopItemRewardType.EQUIPMENT]
            : [ShopItemRewardType.ITEM];

        const boxRewardTypes = isEquipment
            ? [4]
            : [1];

        if (!viewerId || isNaN(viewerId) || !targetItemId || isNaN(targetItemId)) {
            return buildEmptyResponse(reply, viewerId ?? 0);
        }

        const viewerIdSession = await getSession(viewerId.toString());
        if (!viewerIdSession) {
            return buildEmptyResponse(reply, viewerId);
        }

        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!;
        if (playerId === null) {
            return buildEmptyResponse(reply, viewerId);
        }

        const purchasedMap = getPlayerShopPurchasesMapSync(playerId);
        const shopSalesList: Object[] = [];
        const enhancementItems: ShopItems = {};

        for (const shopType of [ShopType.GENERAL, ShopType.STAR_GRAIN, ShopType.TREASURE_EQUIPMENT, ShopType.TREASURE]) {
            const items = getGenericShopItemsSync(shopType);
            if (!items) continue;

            for (const [itemId, item] of Object.entries(items)) {
                if (!itemRewardContainsItemId(item, targetItemId, rewardTypes)) continue;

                if (shopType === ShopType.TREASURE_EQUIPMENT) {
                    enhancementItems[itemId] = item;
                } else {
                    addShopSalesItem(shopSalesList, itemId, item, shopType, purchasedMap);
                }
            }
        }

        for (const events of Object.values(eventItemShopItems)) {
            for (const items of Object.values(events as Record<string, ShopItems>)) {
                for (const [itemId, item] of Object.entries(items)) {
                    if (itemRewardContainsItemId(item, targetItemId, rewardTypes)) {
                        addShopSalesItem(shopSalesList, itemId, item, ShopType.EVENT_ITEM, purchasedMap);
                    }
                }
            }
        }

        for (const items of Object.values(bossCoinShopItems)) {
            for (const [itemId, item] of Object.entries(items as ShopItems)) {
                if (itemRewardContainsItemId(item, targetItemId, rewardTypes)) {
                    addShopSalesItem(shopSalesList, itemId, item, ShopType.BOSS_COIN, purchasedMap);
                }
            }
        }

        shopSalesList.push(...buildEnhancementSalesList(playerId, enhancementItems, targetItemId, rewardTypes));
        const boxGachaIds = findBoxGachaIdsForItem(targetItemId, boxRewardTypes);

        if (shopSalesList.length === 0 && boxGachaIds.length === 0) {
            return buildEmptyResponse(reply, viewerId);
        }

        reply.header("content-type", "application/x-msgpack");
        reply.status(200).send({
            "data_headers": {
                "force_update": false,
                "asset_update": false,
                "short_udid": 0,
                "viewer_id": viewerId,
                "servertime": getServerTime(),
                "result_code": 1
            },
            "data": {
                "box_gacha_id_list": boxGachaIds,
                "unselected_lineup_shop_sales_list": [],
                "shop_sales_list": shopSalesList
            }
        });
    });
};

export default routes;
