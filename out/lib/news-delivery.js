"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNewsDeliveryState = exports.getNewsInterruptFlag = void 0;
const news_1 = require("../data/domains/news");
const news_config_1 = require("./news-config");
/**
 * Maps the server-side delivery state to the client's startup interrupt flag.
 *
 * The CN client interprets `force_news=1` as a forced detail popup and
 * `force_news=2` as the regular announcement list.  A null value means that
 * there is no announcement interrupt to process.  Sending `0` is not
 * equivalent to omitting the flag: the client stores it as `Some(0)` and it
 * can survive navigation as stale state.
 */
function getNewsInterruptFlag(state) {
    if (state.forceNews)
        return 1;
    if (state.hasUnreadNews)
        return 2;
    return null;
}
exports.getNewsInterruptFlag = getNewsInterruptFlag;
function getNewsDeliveryState(accountId, now = new Date()) {
    const config = (0, news_config_1.loadNewsConfig)();
    const activePopup = (0, news_config_1.getActivePopupNews)(config, now);
    const forceNews = activePopup !== null && (config.popup.mode === "every_login"
        || !(0, news_1.hasAccountNewsReceiptSync)(accountId, activePopup.id, "popup"));
    const listReceipts = (0, news_1.getAccountNewsReceiptIdsSync)(accountId, "list");
    const hasUnreadNews = (0, news_config_1.getPublishedNews)(config).some(item => !listReceipts.has(item.id));
    return { activePopup, forceNews, hasUnreadNews };
}
exports.getNewsDeliveryState = getNewsDeliveryState;
