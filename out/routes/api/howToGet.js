"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const session_1 = require("../../data/domains/session");
const activeAccount_1 = require("../../data/activeAccount");
const utils_1 = require("../../utils");
const shopPurchase_1 = require("../../data/domains/shopPurchase");
const degree_1 = require("../../data/domains/degree");
const assets_1 = require("../../lib/assets");
const types_1 = require("../../lib/types");
const how_to_get_sources_1 = require("../../lib/how-to-get-sources");
const shop_sales_1 = require("../../lib/shop-sales");
function sendSources(reply, viewerId, shops = [], boxes = []) {
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({
        data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
        data: {
            box_gacha_id_list: boxes,
            unselected_lineup_shop_sales_list: [],
            shop_sales_list: shops,
        },
    });
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/get_list", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = Number(body === null || body === void 0 ? void 0 : body.viewer_id);
        const equipmentId = Number(body === null || body === void 0 ? void 0 : body.equipment_id);
        const isEquipment = Number.isSafeInteger(equipmentId) && equipmentId > 0;
        const targetId = isEquipment ? equipmentId : Number(body === null || body === void 0 ? void 0 : body.item_id);
        if (!Number.isSafeInteger(viewerId) || viewerId <= 0 || !Number.isSafeInteger(targetId) || targetId <= 0) {
            return sendSources(reply, Number.isSafeInteger(viewerId) && viewerId > 0 ? viewerId : 0);
        }
        const session = yield (0, session_1.getSession)(String(viewerId));
        if (!session)
            return sendSources(reply, viewerId);
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (playerId == null)
            return sendSources(reply, viewerId);
        const sources = (0, how_to_get_sources_1.getHowToGetSources)(isEquipment, targetId);
        const now = (0, utils_1.getServerDate)();
        const purchases = (0, shopPurchase_1.getPlayerShopPurchasesMapSync)(playerId);
        let ownedDegrees;
        const sales = [];
        for (const source of sources.shops) {
            // The public accessor includes retired-row filtering and Rush rerun
            // compatibility periods. Never cache availability or player stock.
            const item = (0, assets_1.getShopItemSync)(source.shopType, source.shopItemId);
            if (!item || !(0, shop_sales_1.isShopItemAvailable)(item, now))
                continue;
            const degreeIds = item.rewards.filter(r => r.type === types_1.ShopItemRewardType.DEGREE)
                .map(r => r.id);
            if (degreeIds.length && !ownedDegrees)
                ownedDegrees = new Set((0, degree_1.getPlayerDegreeIdsSync)(playerId));
            const degreeOwned = degreeIds.some(id => ownedDegrees.has(id));
            sales.push((0, shop_sales_1.buildShopSalesEntry)(source.shopType, source.shopItemId, item, purchases, degreeOwned));
        }
        // Box event availability is resolved by the existing client against its
        // exchangeable event list. Keep that protocol and its original box IDs.
        return sendSources(reply, viewerId, sales, sources.boxes);
    }));
});
exports.default = routes;
