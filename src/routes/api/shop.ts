// Handles the insertion of mana into characters.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { incrementActiveMissionUsedManaCountSync } from "../../data/domains/active_mission_counters";
import { addPlayerShopPurchaseCountSync, getPlayerShopPurchaseCountSync, getPlayerShopPurchasesMapSync } from "../../data/domains/shopPurchase"
import { getAccountPlayers } from "../../data/domains/account"
import { getPlayerEquipmentSync, playerOwnsEquipmentSync, updatePlayerEquipmentSync } from "../../data/domains/equipment"
import { getPlayerItemSync, updatePlayerItemSync } from "../../data/domains/item"
import { getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getSession } from "../../data/domains/session"
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { getDb } from "../../data/db";
import { getBossCoinShopItemsSync, getConfigSync, getEventShopItemsSync, getGenericShopItemsSync, getShopItemSync } from "../../lib/assets";
import { CharacterReward, CharacterShopItemReward, CurrencyReward, CurrencyShopItemReward, EquipmentItemReward, EquipmentItemShopItemReward, Reward, RewardType, ShopItem, ShopItemRewardType, ShopItems, ShopItemUserCostType, ShopType } from "../../lib/types";
import { generateDataHeaders, getServerDate, getServerTime, realToVirtual } from "../../utils";
import { givePlayerRewardsSync } from "../../lib/quest";
import { computeRealTimeStamina } from "../../lib/stamina";
import { clientSerializeEquipment } from "../../lib/equipment";
import CDN_GENERAL_SHOP_WHITELIST from "../../../assets/cdn_general_shop_whitelist.json";
import { gameVerboseLog } from "../../lib/game-logging";
import { reconcileAwakeUnlockCharacterList } from "../../lib/mission";
import { getDegreeMissionIdsForConditionTypes, mergeMissionSettlementResponse, settleMissionCategories } from "../../lib/mission";
import { addMissionCounterSync } from "../../lib/mission/counters";

const GENERAL_SHOP_CDN_KEYS: Set<number> = new Set(CDN_GENERAL_SHOP_WHITELIST);

function recordTreasureShopProgress(
    playerId: number,
    shopType: number,
    purchaseCount: number,
    manaSpent: number,
): void {
    if (shopType !== ShopType.TREASURE) return
    if (purchaseCount > 0) {
        addMissionCounterSync(playerId, {
            dimension: "shop.treasure_purchase",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: {},
        }, purchaseCount)
    }
    if (manaSpent > 0) {
        addMissionCounterSync(playerId, {
            dimension: "shop.treasure_mana_spent",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: {},
        }, manaSpent)
    }
}

function mergeShopDegreeSettlement(
    responseData: Record<string, unknown>,
    playerId: number,
    viewerId: number,
): void {
    mergeMissionSettlementResponse(
        responseData,
        settleMissionCategories(playerId, [{
            category: 5,
            missionIds: getDegreeMissionIdsForConditionTypes([3, 45]),
        }], new Date(getServerTime() * 1000)),
        viewerId,
    )
}

// These one-time GENERAL products reuse shop_item_id values from STAR_GRAIN.
// The legacy table is keyed only by (player_id, shop_item_id), so store these
// purchases under private negative keys. Equipment ownership cannot be used as
// a substitute because the same equipment may have been granted elsewhere.
const GENERAL_EQUIPMENT_SCOPED_PURCHASE_KEYS: ReadonlyMap<number, number> = new Map([
    [100008, -8_100_008], // 酒神权杖
    [110005, -8_110_005], // 埃癸斯·日华
    [110006, -8_110_006], // 埃癸斯·幽冥
])

// Fantasy Rush exposes the same eleven products through its Rush (solo) and
// Advent (multiplayer) screens.  The client requires different shop_item_id
// rows for those two event families, but the inventory is one-time and shared.
// Store each pair under one private key so either screen immediately reflects
// a purchase made in the other screen.
const MODE15_SHARED_EVENT_PURCHASE_KEYS: ReadonlyMap<number, number> = new Map(
    Array.from({ length: 11 }, (_, index) => {
        const sharedKey = -9_702_001 - index
        return [
            [9_700_201 + index, sharedKey],
            [9_700_301 + index, sharedKey],
        ] as const
    }).flat(),
)

function getEffectiveShopPurchaseCountSync(
    playerId: number,
    shopType: number,
    shopItemId: number,
): number {
    if (shopType === ShopType.EVENT_ITEM) {
        const sharedPurchaseKey = MODE15_SHARED_EVENT_PURCHASE_KEYS.get(shopItemId)
        if (sharedPurchaseKey !== undefined) {
            return getPlayerShopPurchaseCountSync(playerId, sharedPurchaseKey)
        }
    }
    if (shopType === ShopType.GENERAL) {
        const scopedPurchaseKey = GENERAL_EQUIPMENT_SCOPED_PURCHASE_KEYS.get(shopItemId)
        if (scopedPurchaseKey !== undefined) {
            return getPlayerShopPurchaseCountSync(playerId, scopedPurchaseKey)
        }
    }
    return getPlayerShopPurchaseCountSync(playerId, shopItemId)
}

function addEffectiveShopPurchaseCountSync(
    playerId: number,
    shopType: number,
    shopItemId: number,
    count: number,
): number {
    if (shopType === ShopType.EVENT_ITEM) {
        const sharedPurchaseKey = MODE15_SHARED_EVENT_PURCHASE_KEYS.get(shopItemId)
        if (sharedPurchaseKey !== undefined) {
            return addPlayerShopPurchaseCountSync(playerId, sharedPurchaseKey, count)
        }
    }
    if (
        shopType === ShopType.GENERAL &&
        GENERAL_EQUIPMENT_SCOPED_PURCHASE_KEYS.has(shopItemId)
    ) {
        return addPlayerShopPurchaseCountSync(
            playerId,
            GENERAL_EQUIPMENT_SCOPED_PURCHASE_KEYS.get(shopItemId)!,
            count,
        )
    }
    return addPlayerShopPurchaseCountSync(playerId, shopItemId, count)
}

// Item 5000 originally shipped with max_frequency=2 in the 1.4.57 client
// master. The server-side stock was later expanded to 999. Keep cached legacy
// clients usable by offsetting only the client-facing lifetime counter; the
// authoritative purchased count and stock validation remain unchanged.
const LEGACY_CLIENT_MAX_FREQUENCY: ReadonlyMap<number, number> = new Map([
    [5000, 2],
])

function getClientTotalPurchaseNum(
    shopType: number,
    itemId: number,
    purchased: number,
    stock: number | undefined
): number {
    if (shopType !== ShopType.EVENT_ITEM) return purchased
    const legacyLimit = LEGACY_CLIENT_MAX_FREQUENCY.get(itemId)
    if (legacyLimit === undefined || stock === undefined || stock <= legacyLimit) return purchased
    return purchased - (stock - legacyLimit)
}

interface EnhancementGroup {
    groupId: number
    items: { id: string, item: ShopItem, stage: number }[]
    equipmentId: number
}

function buildEnhancementSalesList(playerId: number, items: ShopItems): Object[] {
    if (Object.keys(items).length === 0) return []

    // Group items by groupId
    const groups = new Map<number, EnhancementGroup>()
    for (const [itemId, item] of Object.entries(items)) {
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

    for (const [, group] of groups) {
        // Sort by stage ascending
        group.items.sort((a, b) => a.stage - b.stage)

        const equipmentId = group.equipmentId
        const enhancementLevel = playerOwnsEquipmentSync(playerId, equipmentId)
            ? (getPlayerEquipmentSync(playerId, equipmentId)?.enhancementLevel ?? 0)
            : -1

        // Find target product: first item with enhancementMaxLevel > current enhancementLevel
        let targetItem: { id: string, item: ShopItem } | null = null
        let stockQuantity = 0
        let totalPurchaseNum = 0

        if (enhancementLevel < 0) {
            // Player doesn't have the equipment
            targetItem = group.items[0]
            stockQuantity = targetItem.item.enhancementMaxLevel ?? 0
            totalPurchaseNum = 0
        } else {
            for (const entry of group.items) {
                const maxLv = entry.item.enhancementMaxLevel ?? 0
                if (maxLv > enhancementLevel) {
                    targetItem = entry
                    stockQuantity = maxLv - enhancementLevel
                    break
                }
            }
            // If no target found (fully maxed), use last item with stock_quantity=0
            if (!targetItem) {
                targetItem = group.items[group.items.length - 1]
                stockQuantity = 0
            }
            totalPurchaseNum = enhancementLevel
        }

        // Group info: max level from last item in group
        const maxLevel = group.items[group.items.length - 1].item.enhancementMaxLevel ?? 0
        const multiStage = group.items.length > 1

        result.push({
            "shop_item_id": Number(targetItem.id),
            "stock_quantity": stockQuantity,
            "today_purchase_num": 0,
            "this_month_purchase_num": null,  // null → MsgPack nil / Option.None
            "total_purchase_num": totalPurchaseNum,
            "discount_id": null,
            "discount_rate": null,
            "discounted_price": null,
            "group_info": {
                "group_total_stock_quantity": maxLevel - totalPurchaseNum,
                "group_total_purchase_num": totalPurchaseNum,
                "multi_stage": multiStage
            },
            "shop_type": ShopType.TREASURE_EQUIPMENT
        })
    }

    return result
}

interface GetSalesListBody {
    equipment_enhancement_shop_category_ids: number[],
    boss_coin_shop_category_ids: number[],
    browse_treasure_flag: boolean,
    shop_types: ShopType[],
    event_list: {
        event_type: number,
        event_ids: number[]
    }[],
    viewer_id: number
}

interface BuyBody {
    shop_type: number,
    api_count: number,
    shop_item_id: number,
    number: number,
    viewer_id: number
}

interface BulkBuyBody {
    shop_type: number,
    api_count: number,
    buy_item_list: Record<string, number>,
    viewer_id: number
}

interface BulkPurchaseEntry {
    shopItemId: number,
    purchaseAmount: number,
    shopItem: ShopItem
}

function appendShopItemRewards(
    rewards: Reward[],
    shopItem: ShopItem,
    purchaseAmount: number
): void {
    for (const reward of shopItem.rewards) {
        switch (reward.type) {
            case ShopItemRewardType.ITEM: {
                const shopReward = reward as EquipmentItemShopItemReward
                rewards.push({
                    name: "",
                    type: RewardType.ITEM,
                    id: shopReward.id,
                    count: shopReward.count * purchaseAmount
                } as EquipmentItemReward)
                break
            }
            case ShopItemRewardType.EXP: {
                const shopReward = reward as CurrencyShopItemReward
                rewards.push({
                    name: "",
                    type: RewardType.EXP,
                    count: shopReward.count * purchaseAmount
                } as CurrencyReward)
                break
            }
            case ShopItemRewardType.MANA: {
                const shopReward = reward as CurrencyShopItemReward
                rewards.push({
                    name: "",
                    type: RewardType.MANA,
                    count: shopReward.count * purchaseAmount
                } as CurrencyReward)
                break
            }
            case ShopItemRewardType.CHARACTER: {
                const shopReward = reward as CharacterShopItemReward
                for (let i = 0; i < purchaseAmount; i++) {
                    rewards.push({
                        name: "",
                        type: RewardType.CHARACTER,
                        id: shopReward.id
                    } as CharacterReward)
                }
                break
            }
            case ShopItemRewardType.EQUIPMENT: {
                const shopReward = reward as EquipmentItemShopItemReward
                rewards.push({
                    name: "",
                    type: RewardType.EQUIPMENT,
                    id: shopReward.id,
                    count: shopReward.count * purchaseAmount
                } as EquipmentItemReward)
                break
            }
        }
    }
}

function mergeCountedRewards(rewards: Reward[]): Reward[] {
    const counted = new Map<string, EquipmentItemReward | CurrencyReward>()
    const uncounted: Reward[] = []

    for (const reward of rewards) {
        switch (reward.type) {
            case RewardType.ITEM:
            case RewardType.EQUIPMENT: {
                const value = reward as EquipmentItemReward
                const key = `${value.type}:${value.id}`
                const existing = counted.get(key) as EquipmentItemReward | undefined
                if (existing) {
                    existing.count += value.count
                } else {
                    counted.set(key, { ...value })
                }
                break
            }
            case RewardType.BEADS:
            case RewardType.MANA:
            case RewardType.EXP: {
                const value = reward as CurrencyReward
                const key = String(value.type)
                const existing = counted.get(key) as CurrencyReward | undefined
                if (existing) {
                    existing.count += value.count
                } else {
                    counted.set(key, { ...value })
                }
                break
            }
            default:
                uncounted.push(reward)
        }
    }

    return [...counted.values(), ...uncounted]
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/buy", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as BuyBody

        const viewerId = body.viewer_id
        const shopType = body.shop_type
        const rawPurchaseAmount = body.number
        const shopItemId = body.shop_item_id
        if (isNaN(viewerId) || isNaN(shopType) || isNaN(rawPurchaseAmount) || isNaN(shopItemId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const purchaseAmount = Math.max(1, rawPurchaseAmount)

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        const player = playerId !== null ? getPlayerSync(playerId) : null

        if (player === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        // get the shop item's data
        const shopItemData = getShopItemSync(shopType, shopItemId)
        if (shopItemData === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Shop item with specified id does not exist."
        })

        // validate stock limit
        if (shopItemData.stock !== undefined && shopItemData.stock > 0) {
            const purchased = getEffectiveShopPurchaseCountSync(playerId, shopType, shopItemId)
            if (purchased + purchaseAmount > shopItemData.stock) {
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": "Shop item purchase limit reached."
                })
            }
        }

        gameVerboseLog(() => `[shop:buy] player=${playerId} shopType=${shopType} item=${shopItemId} x${purchaseAmount} before freeMana=${player.freeMana} freeVmoney=${player.freeVmoney}`)

        // keep track of various stats
        const itemList: Record<string, number> = {}
        let freeVmoney = player.freeVmoney
        let freeMana = player.freeMana
        let bondTokens = player.bondToken

        // verify user costs
        const userCost = shopItemData.userCost
        if (userCost !== undefined) {
            switch (userCost.type) {
                case ShopItemUserCostType.MANA:
                    freeMana -= (userCost.amount * purchaseAmount)
                    break;
                case ShopItemUserCostType.BEADS:
                    freeVmoney -= (userCost.amount * purchaseAmount)
                    break;
                case ShopItemUserCostType.AMITY_SCROLL:
                    bondTokens -= (userCost.amount * purchaseAmount)
            }

            if (0 > freeVmoney) return reply.status(400).send({
                "error": "Bad Request",
                "message": `Not enough beads to purchase shop item.`
            })
            if (0 > freeMana) return reply.status(400).send({
                "error": "Bad Request",
                "message": `Not enough mana to purchase shop item.`
            })
            if (0 > bondTokens) return reply.status(400).send({
                "error": "Bad Request",
                "message": `Not enough amity scrolls to purchase shop item.`
            })
        }

        // verify cost items
        {
            for (const cost of shopItemData.costs) {
                const itemId = cost.id
                const itemAmount = getPlayerItemSync(playerId, itemId) ?? 0
                const newItemAmount = itemAmount - (cost.amount * purchaseAmount)
                if (0 > newItemAmount) return reply.status(400).send({
                    "error": "Bad Request",
                    "message": `Not enough of item with id ${itemId} to purchase shop item.`
                })

                itemList[itemId] = newItemAmount
            }

            // deduct cost item
            for (const [itemId, newAmount] of Object.entries(itemList)) {
                updatePlayerItemSync(playerId, itemId, newAmount)
            }
        }

        // update player
        updatePlayerSync({
            id: playerId,
            freeMana: freeMana,
            freeVmoney: freeVmoney,
            bondToken: bondTokens
        })
        const manaSpent = Math.max(0, player.freeMana - freeMana)
        if (manaSpent > 0) incrementActiveMissionUsedManaCountSync(playerId, manaSpent)

        // Equipment enhancement shop: update equipment enhancement level
        if (shopType === ShopType.TREASURE_EQUIPMENT) {
            const equipmentId = shopItemData.equipmentId
            const targetLevel = shopItemData.enhancementMaxLevel
            if (equipmentId === undefined || targetLevel === undefined) return reply.status(400).send({
                "error": "Bad Request",
                "message": "Enhancement item missing equipment_id or target level."
            })

            const currentEquipment = getPlayerEquipmentSync(playerId, equipmentId)
            if (currentEquipment === null) return reply.status(400).send({
                "error": "Bad Request",
                "message": "Player does not own the target equipment."
            })

            // Update to target enhancement level
            const newLevel = Math.max(currentEquipment.enhancementLevel, targetLevel)
            updatePlayerEquipmentSync(playerId, equipmentId, { enhancementLevel: newLevel })
            currentEquipment.enhancementLevel = newLevel

            // Record purchase
            for (let i = 0; i < purchaseAmount; i++) {
                addEffectiveShopPurchaseCountSync(playerId, shopType, shopItemId, 1)
            }

            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                "data_headers": generateDataHeaders({
                    viewer_id: viewerId
                }),
                "data": {
                    "user_info": {
                        "free_vmoney": freeVmoney,
                        "free_mana": freeMana,
                        "bond_token": bondTokens
                    },
                    "character_list": [],
                    "equipment_list": [clientSerializeEquipment(equipmentId, currentEquipment)],
                    "item_list": itemList,
                    "mail_arrived": false
                }
            })
        }

        // build rewards array
        const rewards: Reward[] = []
        for (const reward of shopItemData.rewards) {
            switch (reward.type) {
                case ShopItemRewardType.ITEM: {
                    const shopReward = reward as EquipmentItemShopItemReward
                    rewards.push({
                        name: "",
                        type: RewardType.ITEM,
                        id: shopReward.id,
                        count: shopReward.count * purchaseAmount
                    } as EquipmentItemReward)
                    break;
                }
                case ShopItemRewardType.EXP: {
                    const shopReward = reward as CurrencyShopItemReward
                    rewards.push({
                        name: "",
                        type: RewardType.EXP,
                        count: shopReward.count * purchaseAmount
                    } as CurrencyReward)
                    break;
                }
                case ShopItemRewardType.MANA:{
                    const shopReward = reward as CurrencyShopItemReward
                    rewards.push({
                        name: "",
                        type: RewardType.MANA,
                        count: shopReward.count * purchaseAmount
                    } as CurrencyReward)
                    break;
                }
                case ShopItemRewardType.CHARACTER: {
                    const shopReward = reward as CharacterShopItemReward
                    for (let i = 0; i < purchaseAmount; i++) {
                        rewards.push({
                            name: "",
                            type: RewardType.CHARACTER,
                            id: shopReward.id
                        } as CharacterReward)
                    }
                    break;
                }
                case ShopItemRewardType.EQUIPMENT: {
                    const shopReward = reward as EquipmentItemShopItemReward
                    rewards.push({
                        name: "",
                        type: RewardType.EQUIPMENT,
                        id: shopReward.id,
                        count: shopReward.count * purchaseAmount
                    } as EquipmentItemReward)
                    break;
                }

            }
        }
        // give rewards
        const rewardResult = givePlayerRewardsSync(playerId, rewards)

        // record purchase for stock tracking
        addEffectiveShopPurchaseCountSync(playerId, shopType, shopItemId, purchaseAmount)
        recordTreasureShopProgress(playerId, shopType, purchaseAmount, manaSpent)
        const characterList = reconcileAwakeUnlockCharacterList(
            playerId,
            (rewardResult?.character_list ?? []) as Record<string, unknown>[]
        )

        // verify DB write
        const afterPlayer = getPlayerSync(playerId)!
        gameVerboseLog(() => `[shop:buy] after DB freeMana=${afterPlayer.freeMana} freeVmoney=${afterPlayer.freeVmoney} rewardItems=${JSON.stringify(rewardResult?.items ?? {})}`)

        reply.header("content-type", "application/x-msgpack")
        const responseData: Record<string, unknown> = {
            "user_info": {
                "free_vmoney": freeVmoney + (rewardResult?.user_info.free_vmoney ?? 0),
                "free_mana": freeMana + (rewardResult?.user_info.free_mana ?? 0),
                "bond_token": bondTokens,
                "exp_pool": player.expPool + (rewardResult?.user_info.exp_pool ?? 0),
            },
            "character_list": characterList,
            "equipment_list": rewardResult?.equipment_list ?? [],
            "item_list": {
                ...itemList,
                ...(rewardResult?.items ?? {})
            },
            "mail_arrived": false
        }
        mergeShopDegreeSettlement(responseData, playerId, viewerId)
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": responseData
        })
    })

    fastify.post("/get_sales_list", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GetSalesListBody

        const viewerId = body.viewer_id
        const shopTypes = body.shop_types
        const bossCoinShopCategoryIds = body.boss_coin_shop_category_ids
        const equipmentEnhancementCategoryIds = body.equipment_enhancement_shop_category_ids
        const eventList = body.event_list
        if (isNaN(viewerId) || shopTypes === undefined || bossCoinShopCategoryIds === undefined || eventList === undefined) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!

        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        gameVerboseLog(() => `[shop:req] viewer=${viewerId} types=${JSON.stringify(shopTypes)} bossCats=${JSON.stringify(bossCoinShopCategoryIds)} equipCats=${JSON.stringify(equipmentEnhancementCategoryIds)} events=${eventList.length} eventList=${JSON.stringify(eventList)}`)

        let toParseShopItems: Record<number, ShopItems> = {}

        // shop types
        for (const type of shopTypes) {
            const items = getGenericShopItemsSync(type)
            const existing = toParseShopItems[type] ?? {}
            toParseShopItems[type] = items === null ? existing : { ...existing, ...items }
        }

        // event list
        for (const event of eventList) {
            const type = event.event_type
            for (const eventId of event.event_ids) {
                const items = getEventShopItemsSync(type, eventId)
                const existing = toParseShopItems[ShopType.EVENT_ITEM] ?? {}
                toParseShopItems[ShopType.EVENT_ITEM] = items === null ? existing : { ...existing, ...items }
            }
        }

        // boss coin shop category ids
        for (const category of bossCoinShopCategoryIds) {
            const items = getBossCoinShopItemsSync(category)
            const existing = toParseShopItems[ShopType.BOSS_COIN] ?? {}
            toParseShopItems[ShopType.BOSS_COIN] = items === null ? existing : { ...existing, ...items }
        }

        // parse shop items
        const salesList: Object[] = []

        // Load purchase history for stock tracking
        const purchasedMap = getPlayerShopPurchasesMapSync(playerId)
        const totalPurchased = Object.values(purchasedMap).reduce((a, b) => a + b, 0)
        gameVerboseLog(() => `[shop:get_sales] player=${playerId} purchasedKeys=${Object.keys(purchasedMap).length} totalPurchased=${totalPurchased}`)

        let filteredCdnCount = 0

        // Collect enhancement shop items for group-level processing
        const enhancementItems: ShopItems = {}

        for (const [shopType, items] of Object.entries(toParseShopItems)) {
            const shopTypeNum = Number(shopType)
            for (const [itemId, item] of Object.entries(items)) {

                if (shopTypeNum === ShopType.GENERAL && !GENERAL_SHOP_CDN_KEYS.has(Number(itemId))) {
                    filteredCdnCount++
                    continue
                }

                // Filter equipment enhancement shop by category IDs
                if (shopTypeNum === ShopType.TREASURE_EQUIPMENT && equipmentEnhancementCategoryIds?.length) {
                    if (item.shopCategoryId === undefined || !equipmentEnhancementCategoryIds.includes(item.shopCategoryId)) {
                        continue
                    }
                }

                // Date filtering: only show items active at current server time
                {
                    const now = getServerDate()
                    if (item.availableFrom) {
                        const fromStr = item.availableFrom.replace(' ', 'T') + 'Z'
                        if (new Date(fromStr) > now) continue
                    }
                    if (item.availableUntil) {
                        const untilStr = item.availableUntil.replace(' ', 'T') + 'Z'
                        if (new Date(untilStr) < now) continue
                    }
                }

                if (shopTypeNum === ShopType.TREASURE_EQUIPMENT) {
                    // Collect for group-level processing later
                    enhancementItems[itemId] = item
                    continue
                }

                const purchased = getEffectiveShopPurchaseCountSync(
                    playerId,
                    shopTypeNum,
                    Number(itemId)
                )
                const stock = item.stock
                const stockQuantity = stock !== undefined ? Math.max(0, stock - purchased) : -1
                const clientTotalPurchaseNum = getClientTotalPurchaseNum(
                    shopTypeNum,
                    Number(itemId),
                    purchased,
                    stock
                )
                salesList.push({
                    "shop_item_id": Number(itemId),
                    "stock_quantity": stockQuantity,
                    "today_purchase_num": purchased,
                    "this_month_purchase_num": purchased,
                    "total_purchase_num": clientTotalPurchaseNum,
                    "group_info": {
                        "group_total_stock_quantity": stockQuantity,
                        "group_total_purchase_num": purchased,
                        "multi_stage": false
                    },
                    "shop_type": Number(shopType)
                })
            }
        }

        // Process equipment enhancement items by group
        const enhancementSales = buildEnhancementSalesList(playerId, enhancementItems)
        salesList.push(...enhancementSales)

        if (filteredCdnCount > 0) {
            gameVerboseLog(() => `[shop] Filtered ${filteredCdnCount} general shop items not in CDN master data`)
        }

        const salesByType: Record<number, number> = {}
        for (const item of salesList) {
            const t = (item as any).shop_type
            salesByType[t] = (salesByType[t] || 0) + 1
        }
        gameVerboseLog(() => `[shop:res] totalSales=${salesList.length} byType=${JSON.stringify(salesByType)} toParseItems=${JSON.stringify(Object.fromEntries(Object.entries(toParseShopItems).map(([k,v]) => [k, Object.keys(v).length])))}`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "sales_list": salesList
            }
        })
    })

    fastify.post("/recover_stamina", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, api_count: number }
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) {
            console.warn(`[RECOVER-STAMINA] invalid viewer_id: ${viewerId}`)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer_id."
            })
        }

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(session.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error", "message": "No player bound to account."
        })

        const player = getPlayerSync(playerId)
        if (!player) return reply.status(500).send({
            "error": "Internal Server Error", "message": "Player not found."
        })

        const config = getConfigSync()
        const recoveryCost = config.stamina_recovery_virtual_money
        const recoveryValue = config.stamina_recovery_value
        const maxOverflow = config.max_stamina_overflow

        const currentStamina = computeRealTimeStamina(player)

        // Already at max
        if (currentStamina >= maxOverflow) {
            gameVerboseLog(() => `[RECOVER-STAMINA] player ${playerId} already at max (${currentStamina} >= ${maxOverflow})`)
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId, result_code: 2102 }),
                "data": {}
            })
        }

        // Insufficient vmoney
        const freeVmoney = player.freeVmoney
        if (freeVmoney < recoveryCost) {
            console.warn(`[RECOVER-STAMINA] player ${playerId} insufficient vmoney: ${freeVmoney} < ${recoveryCost}`)
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId, result_code: 0 }),
                "data": {}
            })
        }

        // Calculate recovery amount (capped at overflow)
        const afterStamina = Math.min(currentStamina + recoveryValue, maxOverflow)
        const actualRecovery = afterStamina - currentStamina

        updatePlayerSync({
            id: playerId,
            stamina: afterStamina,
            staminaHealTime: new Date(),
            freeVmoney: freeVmoney - recoveryCost
        })

        gameVerboseLog(() => `[RECOVER-STAMINA] player ${playerId}: stamina ${currentStamina}->${afterStamina} (+${actualRecovery}), freeVmoney ${freeVmoney}->${freeVmoney - recoveryCost}`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "user_info": {
                    "stamina": afterStamina,
                    "stamina_heal_time": realToVirtual(new Date()),
                    "free_vmoney": freeVmoney - recoveryCost
                }
            }
        })
    })

    // Buy multiple shop products as one atomic operation. The clean client sends
    // buy_item_list as an object whose keys are shop item IDs and values are counts.
    fastify.post("/bulk_buy", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as BulkBuyBody | undefined
        const viewerId = body?.viewer_id
        const shopType = body?.shop_type
        const buyItemList = body?.buy_item_list

        if (
            !Number.isSafeInteger(viewerId) ||
            !Number.isSafeInteger(shopType) ||
            buyItemList === null ||
            typeof buyItemList !== "object" ||
            Array.isArray(buyItemList)
        ) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })

        const rawEntries = Object.entries(buyItemList)
        if (rawEntries.length === 0 || rawEntries.length > 500) return reply.status(400).send({
            "error": "Bad Request", "message": "No shop items specified or batch is too large."
        })

        const viewerIdSession = await getSession(viewerId!.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        const player = getPlayerSync(playerId)
        if (player === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "Player not found."
        })

        const purchases: BulkPurchaseEntry[] = []
        const rewards: Reward[] = []
        const itemCostTotals = new Map<number, number>()
        let manaCost = 0
        let vmoneyCost = 0
        let bondTokenCost = 0

        for (const [rawShopItemId, rawPurchaseAmount] of rawEntries) {
            const shopItemId = Number(rawShopItemId)
            const purchaseAmount = Number(rawPurchaseAmount)
            if (
                !Number.isSafeInteger(shopItemId) ||
                !Number.isSafeInteger(purchaseAmount) ||
                purchaseAmount <= 0
            ) return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid shop item ID or purchase amount."
            })

            const shopItem = getShopItemSync(shopType!, shopItemId)
            if (shopItem === null) return reply.status(400).send({
                "error": "Bad Request",
                "message": `Shop item with specified id ${shopItemId} does not exist.`
            })

            if (shopItem.stock !== undefined && shopItem.stock > 0) {
                const purchased = getEffectiveShopPurchaseCountSync(playerId, shopType!, shopItemId)
                if (purchased + purchaseAmount > shopItem.stock) {
                    return reply.status(400).send({
                        "error": "Bad Request",
                        "message": `Shop item ${shopItemId} purchase limit reached.`
                    })
                }
            }

            const userCost = shopItem.userCost
            if (userCost !== undefined) {
                const total = userCost.amount * purchaseAmount
                if (!Number.isSafeInteger(total) || total < 0) return reply.status(400).send({
                    "error": "Bad Request",
                    "message": `Invalid user cost for shop item ${shopItemId}.`
                })

                switch (userCost.type) {
                    case ShopItemUserCostType.MANA:
                        manaCost += total
                        break
                    case ShopItemUserCostType.BEADS:
                        vmoneyCost += total
                        break
                    case ShopItemUserCostType.AMITY_SCROLL:
                        bondTokenCost += total
                        break
                    default:
                        return reply.status(400).send({
                            "error": "Bad Request",
                            "message": `Unsupported user cost type for shop item ${shopItemId}.`
                        })
                }
            }

            for (const cost of shopItem.costs) {
                const total = cost.amount * purchaseAmount
                const existing = itemCostTotals.get(cost.id) ?? 0
                if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(existing + total)) {
                    return reply.status(400).send({
                        "error": "Bad Request",
                        "message": `Invalid item cost for shop item ${shopItemId}.`
                    })
                }
                itemCostTotals.set(cost.id, existing + total)
            }

            appendShopItemRewards(rewards, shopItem, purchaseAmount)
            purchases.push({ shopItemId, purchaseAmount, shopItem })
        }

        if (
            !Number.isSafeInteger(manaCost) ||
            !Number.isSafeInteger(vmoneyCost) ||
            !Number.isSafeInteger(bondTokenCost)
        ) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Bulk purchase cost is too large."
        })

        if (player.freeMana < manaCost) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Not enough mana to purchase selected shop items."
        })
        if (player.freeVmoney < vmoneyCost) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Not enough beads to purchase selected shop items."
        })
        if (player.bondToken < bondTokenCost) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Not enough amity scrolls to purchase selected shop items."
        })

        const costItemList: Record<string, number> = {}
        for (const [itemId, amount] of itemCostTotals) {
            const currentAmount = getPlayerItemSync(playerId, itemId) ?? 0
            if (currentAmount < amount) return reply.status(400).send({
                "error": "Bad Request",
                "message": `Not enough of item with id ${itemId} to purchase selected shop items.`
            })
            costItemList[itemId] = currentAmount - amount
        }

        const mergedRewards = mergeCountedRewards(rewards)
        for (const reward of mergedRewards) {
            if (!("count" in reward)) continue
            const countedReward = reward as Reward & { count: number }
            if (
                !Number.isSafeInteger(countedReward.count) ||
                countedReward.count < 0
            ) return reply.status(400).send({
                "error": "Bad Request",
                "message": "Bulk purchase reward amount is too large."
            })
        }

        gameVerboseLog(() =>
            `[shop:bulk_buy] player=${playerId} shopType=${shopType} ` +
            `items=${JSON.stringify(Object.fromEntries(purchases.map(v => [v.shopItemId, v.purchaseAmount])))} ` +
            `manaCost=${manaCost} vmoneyCost=${vmoneyCost} bondTokenCost=${bondTokenCost} ` +
            `itemCosts=${JSON.stringify(Object.fromEntries(itemCostTotals))}`
        )

        let rewardResult: ReturnType<typeof givePlayerRewardsSync>
        try {
            rewardResult = getDb().transaction(() => {
                for (const [itemId, newAmount] of Object.entries(costItemList)) {
                    updatePlayerItemSync(playerId, itemId, newAmount)
                }

                updatePlayerSync({
                    id: playerId,
                    freeMana: player.freeMana - manaCost,
                    freeVmoney: player.freeVmoney - vmoneyCost,
                    bondToken: player.bondToken - bondTokenCost
                })
                if (manaCost > 0) incrementActiveMissionUsedManaCountSync(playerId, manaCost)

                const result = givePlayerRewardsSync(playerId, mergedRewards)
                if (result === null) {
                    throw new Error(`Failed to grant bulk shop rewards for player ${playerId}`)
                }

                for (const purchase of purchases) {
                    addEffectiveShopPurchaseCountSync(
                        playerId,
                        shopType!,
                        purchase.shopItemId,
                        purchase.purchaseAmount
                    )
                }
                recordTreasureShopProgress(
                    playerId,
                    shopType!,
                    purchases.reduce((total, purchase) => total + purchase.purchaseAmount, 0),
                    manaCost,
                )

                return result
            })()
        } catch (error) {
            console.error(`[shop:bulk_buy] transaction failed player=${playerId}`, error)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "Bulk purchase transaction failed."
            })
        }

        const afterPlayer = getPlayerSync(playerId)
        if (afterPlayer === null || rewardResult === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "Failed to load player after bulk purchase."
        })
        const characterList = reconcileAwakeUnlockCharacterList(
            playerId,
            rewardResult.character_list as Record<string, unknown>[]
        )

        gameVerboseLog(() =>
            `[shop:bulk_buy] completed player=${playerId} ` +
            `freeMana=${afterPlayer.freeMana} freeVmoney=${afterPlayer.freeVmoney} ` +
            `rewardItems=${JSON.stringify(rewardResult.items)}`
        )

        reply.header("content-type", "application/x-msgpack")
        const responseData: Record<string, unknown> = {
            "user_info": {
                "free_vmoney": afterPlayer.freeVmoney,
                "free_mana": afterPlayer.freeMana,
                "bond_token": afterPlayer.bondToken,
                "exp_pool": afterPlayer.expPool
            },
            "character_list": characterList,
            "equipment_list": rewardResult.equipment_list,
            "item_list": {
                ...costItemList,
                ...rewardResult.items
            },
            "mail_arrived": false
        }
        mergeShopDegreeSettlement(responseData, playerId, viewerId!)
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId! }),
            "data": responseData
        })
    })

    // get_campaign_lineup_id — stub
    fastify.post("/get_campaign_lineup_id", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": { "lineup_id": null }
        })
    })

    // set_campaign_lineup_id — stub
    fastify.post("/set_campaign_lineup_id", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {}
        })
    })
}

export default routes;
