import { randomInt } from "crypto"
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { resolvePlayerIdSync } from "../../data/activeAccount"
import {
    getPlayerMultiSpecialExchangeCampaignsSync,
    updatePlayerMultiSpecialExchangeCampaignSync,
} from "../../data/domains/campaign"
import { getPlayerItemSync, givePlayerItemSync, setPlayerItemSync } from "../../data/domains/item"
import { getPlayerSync } from "../../data/domains/player"
import { getSession } from "../../data/domains/session"
import { getDb } from "../../data/db"
import { reconcileAwakeUnlockCharacterList } from "../../lib/mission"
import { givePlayerCharacterSync } from "../../lib/character"
import {
    getMultiSpecialExchangeCampaignDefinition,
    isMultiSpecialExchangeCharacter,
} from "../../lib/multi-special-exchange"
import { runPersistenceTransaction } from "../../lib/persistence-coordinator"
import { generateDataHeaders, getServerTime } from "../../utils"

interface CampaignBody {
    viewer_id?: number
    campaign_id?: number
}

interface ExchangeCharacterBody extends CampaignBody {
    character_id?: number
    ticket_item_id?: number
}

function positiveSafeInteger(value: unknown): number | null {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

async function resolveViewer(body: CampaignBody): Promise<{ viewerId: number; playerId: number } | null> {
    const viewerId = positiveSafeInteger(body.viewer_id)
    if (viewerId === null) return null
    const session = await getSession(String(viewerId))
    if (!session) return null
    const playerId = resolvePlayerIdSync(session.accountId)
    return playerId === null ? null : { viewerId, playerId }
}

function sendResultCode(reply: FastifyReply, viewerId: number, resultCode: number) {
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({
        data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: resultCode }),
        data: {},
    })
}

async function drawTicket(playerId: number, campaignId: number): Promise<{ ticketItemId: number; itemAmount: number } | null> {
    const definition = getMultiSpecialExchangeCampaignDefinition(campaignId)
    if (!definition) return null
    return runPersistenceTransaction({
        domain: "event", playerId, operation: "draw_multi_special_ticket",
    }, () => {
        const campaign = getPlayerMultiSpecialExchangeCampaignsSync(playerId)
            .find(value => value.campaignId === campaignId)
        if (!campaign || campaign.status !== 1) return null
        const ticketItemId = definition.ticketItemIds[randomInt(definition.ticketItemIds.length)]
        const itemAmount = givePlayerItemSync(playerId, ticketItemId, 1)
        updatePlayerMultiSpecialExchangeCampaignSync(playerId, {
            campaignId,
            status: 3,
            ticketItemId,
        })
        return { ticketItemId, itemAmount }
    })
}

const routes = async (fastify: FastifyInstance) => {
    const registerDrawRoute = (path: string) => {
        fastify.post(path, async (request: FastifyRequest, reply: FastifyReply) => {
            const body = request.body as CampaignBody
            const context = await resolveViewer(body)
            const campaignId = positiveSafeInteger(body.campaign_id)
            if (!context || campaignId === null) return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid request body or viewer id.",
            })
            const definition = getMultiSpecialExchangeCampaignDefinition(campaignId)
            if (!definition) return sendResultCode(reply, context.viewerId, 4901)
            const drawn = await drawTicket(context.playerId, campaignId)
            if (!drawn) return sendResultCode(reply, context.viewerId, 4902)
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                data_headers: generateDataHeaders({ viewer_id: context.viewerId }),
                data: {
                    multi_special_exchange_campaign_list: [{
                        campaign_id: campaignId,
                        status: 3,
                        ticket_item_id: drawn.ticketItemId,
                    }],
                    item_list: { [drawn.ticketItemId]: drawn.itemAmount },
                    mail_arrived: false,
                },
            })
        })
    }

    registerDrawRoute("/single_draw_ticket")
    registerDrawRoute("/multi_draw_ticket")

    fastify.post("/exchange_character", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ExchangeCharacterBody
        const context = await resolveViewer(body)
        const campaignId = positiveSafeInteger(body.campaign_id)
        const characterId = positiveSafeInteger(body.character_id)
        const ticketItemId = positiveSafeInteger(body.ticket_item_id)
        if (!context || campaignId === null || characterId === null || ticketItemId === null) {
            return reply.status(400).send({ error: "Bad Request", message: "Invalid request body or viewer id." })
        }
        const definition = getMultiSpecialExchangeCampaignDefinition(campaignId)
        if (!definition || !definition.ticketItemIds.includes(ticketItemId)) {
            return sendResultCode(reply, context.viewerId, 4901)
        }
        // Only characters listed for this ticket in the client master table
        // can be selected; other ids are rejected like any failed exchange.
        if (!isMultiSpecialExchangeCharacter(ticketItemId, characterId)) {
            return sendResultCode(reply, context.viewerId, 4902)
        }

        const exchangeResult = await runPersistenceTransaction({
            domain: "event", playerId: context.playerId, operation: "exchange_character",
        }, () => {
            const campaign = getPlayerMultiSpecialExchangeCampaignsSync(context.playerId)
                .find(value => value.campaignId === campaignId)
            const ticketAmount = getPlayerItemSync(context.playerId, ticketItemId) ?? 0
            if (!campaign || campaign.status !== 3 || campaign.ticketItemId !== ticketItemId || ticketAmount <= 0) {
                return null
            }
            const reward = givePlayerCharacterSync(context.playerId, characterId)
            if (!reward) return null
            const newTicketAmount = ticketAmount - 1
            setPlayerItemSync(context.playerId, ticketItemId, newTicketAmount)
            updatePlayerMultiSpecialExchangeCampaignSync(context.playerId, {
                campaignId,
                status: 4,
                ticketItemId: null,
            })
            return { reward, newTicketAmount }
        })
        if (!exchangeResult) return sendResultCode(reply, context.viewerId, 4902)

        const characterList = exchangeResult.reward.character
            ? reconcileAwakeUnlockCharacterList(context.playerId, [
                { ...exchangeResult.reward.character, viewer_id: context.viewerId },
            ])
            : []
        const itemList: Record<string, number> = {
            [ticketItemId]: exchangeResult.newTicketAmount,
        }
        if (exchangeResult.reward.item) {
            itemList[String(exchangeResult.reward.item.id)] =
                exchangeResult.reward.item.inventoryCount
        }
        const player = getPlayerSync(context.playerId)
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: context.viewerId }),
            data: {
                multi_special_exchange_campaign_list: [{ campaign_id: campaignId, status: 4 }],
                character_list: characterList,
                item_list: itemList,
                user_info: player ? {
                    free_mana: player.freeMana,
                    exp_pool: player.expPool,
                    exp_pooled_time: getServerTime(player.expPooledTime),
                    free_vmoney: player.freeVmoney,
                } : undefined,
                encyclopedia_info: {},
                mission_info: [],
                mail_arrived: false,
            },
        })
    })
}

export default routes
