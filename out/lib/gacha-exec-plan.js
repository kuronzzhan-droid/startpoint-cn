"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGachaExecPlan = void 0;
const types_1 = require("./types");
const gacha_ticket_1 = require("./gacha-ticket");
const gacha_rules_1 = require("./gacha-rules");
function ok(plan) {
    return { ok: true, plan };
}
function badRequest(message) {
    return { ok: false, status: 400, message };
}
function basePlan(playerFunds) {
    return {
        pullCount: 0,
        freeVmoney: playerFunds.freeVmoney,
        paidVmoney: playerFunds.paidVmoney,
        ticket: null,
        campaign: null,
    };
}
function ensureNonNegativeFunds(plan) {
    if (plan.freeVmoney < 0 || plan.paidVmoney < 0) {
        return badRequest("Not enough beads.");
    }
    return ok(plan);
}
function buildGachaExecPlan(input) {
    var _a, _b, _c, _d, _e;
    const { gacha, paymentType, execType, numberOfExec, playerFunds, playerGachaData } = input;
    if (!(0, gacha_rules_1.isGachaExecAllowed)(gacha, paymentType, execType)) {
        return badRequest("Gacha execution type is not allowed for this gacha.");
    }
    if (gacha.pageKind === gacha_rules_1.GACHA_PAGE_KINDS.TEN_TIMES_PER_ACCOUNT && !playerGachaData.isAccountFirst) {
        return badRequest("Already did account-limited summon.");
    }
    const plan = basePlan(playerFunds);
    switch (paymentType) {
        case gacha_rules_1.GACHA_PAYMENT_TYPES.FREE_VMONEY: {
            const isMulti = execType === gacha_rules_1.GACHA_EXEC_TYPES.VMONEY_MULTI;
            const cost = (gacha.pageKind === gacha_rules_1.GACHA_PAGE_KINDS.TEN_TIMES_PER_ACCOUNT && isMulti)
                ? ((_a = gacha.tenTimesPerAccountCost) !== null && _a !== void 0 ? _a : gacha.multiCost)
                : (isMulti ? gacha.multiCost : gacha.singleCost);
            const overflow = cost > plan.freeVmoney ? cost - plan.freeVmoney : 0;
            plan.freeVmoney = overflow > 0 ? 0 : plan.freeVmoney - cost;
            plan.paidVmoney = overflow > 0 ? plan.paidVmoney - overflow : plan.paidVmoney;
            plan.pullCount = isMulti ? 10 : 1;
            break;
        }
        case gacha_rules_1.GACHA_PAYMENT_TYPES.VMONEY: {
            if (!playerGachaData.isDailyFirst) {
                return badRequest("Already did daily paid summon.");
            }
            plan.paidVmoney -= gacha.type === types_1.GachaType.CHARACTER ? 50 : 25;
            plan.pullCount = 1;
            break;
        }
        case gacha_rules_1.GACHA_PAYMENT_TYPES.TICKET: {
            const ticketCost = (0, gacha_ticket_1.getGachaTicketCost)(execType, numberOfExec, gacha);
            if (ticketCost === null) {
                return badRequest("Invalid payment type.");
            }
            const beforeCount = (_c = (_b = input.getTicketCount) === null || _b === void 0 ? void 0 : _b.call(input, ticketCost.itemId)) !== null && _c !== void 0 ? _c : -1;
            const afterCount = beforeCount - ticketCost.useTicketCount;
            if (afterCount < 0) {
                return badRequest("Not enough tickets.");
            }
            plan.pullCount = ticketCost.pullCount;
            plan.ticket = {
                itemId: ticketCost.itemId,
                beforeCount,
                afterCount,
                useTicketCount: ticketCost.useTicketCount,
            };
            break;
        }
        case gacha_rules_1.GACHA_PAYMENT_TYPES.CAMPAIGN: {
            const campaignState = (_e = (_d = input.getCampaignState) === null || _d === void 0 ? void 0 : _d.call(input)) !== null && _e !== void 0 ? _e : null;
            if (campaignState === null) {
                return badRequest("No gacha campaign assigned to gacha.");
            }
            if (campaignState.count <= 0) {
                return badRequest("Already redeemed campaign for this period.");
            }
            plan.pullCount = execType === gacha_rules_1.GACHA_EXEC_TYPES.CAMPAIGN_MULTI ? 10 : 1;
            plan.campaign = {
                campaignId: campaignState.campaignId,
                count: 0,
                insert: campaignState.insert,
            };
            break;
        }
        default:
            return badRequest("Invalid payment type.");
    }
    if (plan.pullCount === 0) {
        return badRequest("Invalid payment type.");
    }
    return ensureNonNegativeFunds(plan);
}
exports.buildGachaExecPlan = buildGachaExecPlan;
