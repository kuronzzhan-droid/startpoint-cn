import { readFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../data/db";
import { ensurePlayerDegreesTableSync } from "../data/domains/degree";
import { getPlayerShopPurchaseCountSync } from "../data/domains/shopPurchase";
import { ShopType } from "./types";

export const ABYSS_SHOP_DEGREE_ID = 9_911_001;
export const ABYSS_SHOP_TICKET_IDS = Object.freeze([9_700_116, 9_700_117] as const);
export const ABYSS_SHOP_REQUIRED_PURCHASES = 9_999;
export const ABYSS_SHOP_DEGREE_CONFIG_PATH = path.resolve(
    __dirname, "..", "..", "assets", "abyss_shop_degree_reward.json",
);

interface RewardOptions {
    /** Offline tests may supply an isolated activation file; never read from a request. */
    configPath?: string;
}

/** Both products must reach the threshold; ticket inventory and draw counts are irrelevant. */
export function isAbyssShopDegreeEligible(singleCount: number, tenfoldCount: number): boolean {
    return [singleCount, tenfoldCount].every(count =>
        Number.isSafeInteger(count) && count >= ABYSS_SHOP_REQUIRED_PURCHASES);
}

/** Fail closed until this degree's native row and PNG have been published and verified. */
export function abyssShopDegreeRewardEnabled(configPath = ABYSS_SHOP_DEGREE_CONFIG_PATH): boolean {
    try {
        const value: unknown = JSON.parse(readFileSync(configPath, "utf8"));
        if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
        const config = value as Record<string, unknown>;
        return config.schema_version === 1 && config.enabled === true
            && config.degree_id === ABYSS_SHOP_DEGREE_ID
            && config.required_purchases === ABYSS_SHOP_REQUIRED_PURCHASES
            && Array.isArray(config.shop_item_ids)
            && config.shop_item_ids.length === ABYSS_SHOP_TICKET_IDS.length
            && config.shop_item_ids.every((id, index) => id === ABYSS_SHOP_TICKET_IDS[index]);
    } catch {
        return false;
    }
}

/** Existing native counters are cumulative per player/product, with no period reset. */
function grantEligibleAbyssShopDegreeSync(playerId: number): number[] {
    const db = getDb();
    if (!db.prepare("SELECT id FROM players WHERE id = ?").get(playerId)) return [];
    const counts = ABYSS_SHOP_TICKET_IDS.map(id => getPlayerShopPurchaseCountSync(playerId, id));
    if (!isAbyssShopDegreeEligible(counts[0], counts[1])) return [];
    ensurePlayerDegreesTableSync();
    const inserted = db.prepare(`INSERT OR IGNORE INTO players_degrees (player_id, degree_id)
        VALUES (?, ?)`).run(playerId, ABYSS_SHOP_DEGREE_ID);
    return inserted.changes === 1 ? [ABYSS_SHOP_DEGREE_ID] : [];
}

/** Also used by the profile list for players who finished both exchanges before deployment. */
export function grantAbyssShopDegreeRewardSync(playerId: number, options: RewardOptions = {}): number[] {
    if (!Number.isSafeInteger(playerId) || playerId <= 0
        || !abyssShopDegreeRewardEnabled(options.configPath)) return [];
    return getDb().transaction(() => grantEligibleAbyssShopDegreeSync(playerId))();
}

/** A reward failure must roll back the ticket purchase rather than report a committed purchase as failed. */
export function withAbyssShopDegreeRewardSync<T>(
    playerId: number,
    shopType: number,
    purchases: readonly { shopItemId: number }[],
    purchase: () => T,
    options: RewardOptions = {},
): T {
    const targetsTickets = shopType === ShopType.EVENT_ITEM && purchases.some(item =>
        ABYSS_SHOP_TICKET_IDS.some(id => id === item.shopItemId));
    if (!targetsTickets || !abyssShopDegreeRewardEnabled(options.configPath)) return purchase();
    // The existing purchase function uses a nested savepoint; the outer transaction owns both effects.
    return getDb().transaction(() => {
        const result = purchase();
        grantEligibleAbyssShopDegreeSync(playerId);
        return result;
    })();
}
