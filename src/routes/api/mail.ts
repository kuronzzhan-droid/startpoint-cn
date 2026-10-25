import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MailType, RawPlayerMail, getPlayerMailCountSync, getPlayerMailsSync, getPlayerMailsByIdsSync, getUnreceivedPlayerMailsByIdsSync, insertReceiveHistorySync, receiveAllMailsSync } from "../../data/domains/mail"
import { getPlayerCharacterSync, insertDefaultPlayerCharacterSync, updatePlayerCharacterSync } from "../../data/domains/character"
import { getPlayerItemSync, givePlayerItemSync } from "../../data/domains/item"
import { adjustPlayerExpPoolSync, getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getSession } from "../../data/domains/session"
import { getPlayerEquipmentSync } from "../../data/domains/equipment"
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { generateDataHeaders, getServerTime } from "../../utils";
import { clientSerializeDate } from "../../data/utils";
import { clientSerializeEquipment, givePlayerEquipmentSync } from "../../lib/equipment";
import { serializeRealTimeForVirtualClient } from "../../lib/client-display-time";
import { grantPlayerDegreeSync, hasPlayerDegreeSync } from "../../data/domains/degree";
import { reconcileAwakeUnlocks, refreshAwakeUnlockCharacterList } from "../../lib/mission";
import { calculateFreeManaGrant } from "../../lib/mana";
import { runPersistenceTransaction } from "../../lib/persistence-coordinator";
import type { Player } from "../../data/types";
import { createHash } from "node:crypto";
import { getPlayerOperationReceiptSync, insertPlayerOperationReceiptSync } from "../../data/domains/player-operation-receipt";
import { getCharacterDuplicateRewardItemId, givePlayerCharacterSync } from "../../lib/character";
import { readGameplayMutationRequestSync, recordGameplayMutationResponseSync, type GameplayMutationContext } from "../../lib/gameplay-mutation-receipt";

interface IndexBody {
    api_count: number
    viewer_id: number
    current_page: number
}

interface ReceiveBody {
    api_count: number
    viewer_id: number
    mail_id: number
    request_id?: string
}

interface ReceiveAllBody {
    api_count: number
    viewer_id: number
    mail_ids: number[]
    request_id?: string
}

const MAX_MAIL_CLAIM_IDS = 1000

function buildMailClaimRequestKey(mailIds: readonly number[], requestId?: string): string | null {
    if (typeof requestId !== "string" || requestId.length === 0 || requestId.length > 256) return null
    const normalized = [...new Set(mailIds.filter(
        mailId => Number.isSafeInteger(mailId) && mailId > 0,
    ))].sort((left, right) => left - right)
    if (normalized.length === 0) return null
    return createHash("sha256").update(`${requestId}\u0000${normalized.join(",")}`).digest("hex")
}

function formatMailResponse(mail: RawPlayerMail) {
    return {
        id: mail.id,
        reason_id: mail.reason_id,
        subject: mail.subject,
        description: mail.description,
        type: mail.type,
        type_id: mail.type_id != null && mail.type_id > 2147483647 ? 0 : mail.type_id,
        number: mail.number,
        receive_time: serializeRealTimeForVirtualClient(mail.receive_time),
        create_time: serializeRealTimeForVirtualClient(mail.create_time),
        reward_period_limited: mail.reward_period_limited === 1,
        reward_limit_time: serializeRealTimeForVirtualClient(mail.reward_limit_time),
    }
}

interface MailRewardResult {
    characterList: any[]
    equipmentList: any[]
    itemList: Record<string, number>
    userInfo: Record<string, any>
    degreeIds: number[]
}

interface MailExBoostItem {
    mail_id: number
    item_id: number
    item_count: number
}

export interface ClaimedMailRewards extends MailRewardResult {
    claimedMailIds: number[]
    alreadyCount: number
    // Older persisted mail_claim receipts do not contain display metadata.
    exBoostItemList?: MailExBoostItem[]
}

function applyMailReward(playerId: number, player: Player, mail: RawPlayerMail): MailRewardResult & { exBoostItemList: MailExBoostItem[] } {
    const characterList: any[] = []
    const equipmentList: any[] = []
    const itemList: Record<string, number> = {}
    const userInfo: Record<string, any> = {}
    const degreeIds: number[] = []
    const exBoostItemList: MailExBoostItem[] = []
    const supportedTypes = [MailType.ITEM, MailType.PAID_VMONEY, MailType.FREE_VMONEY, MailType.CHARACTER,
        MailType.EQUIPMENT, MailType.STAR_CRUMB, MailType.FREE_MANA, MailType.EXP_POOL, MailType.BOND_TOKEN,
        MailType.BOSS_BOOST_POINT, MailType.BOOST_POINT, MailType.DEGREE, MailType.RANK_POINT]
    if (!supportedTypes.includes(mail.type) || !Number.isSafeInteger(mail.number) || mail.number < 0
        || ([MailType.ITEM, MailType.CHARACTER, MailType.EQUIPMENT, MailType.DEGREE].includes(mail.type)
            && (!Number.isSafeInteger(mail.type_id) || Number(mail.type_id) <= 0))) {
        throw Object.assign(new Error(`Mail ${mail.id} has an invalid attachment.`), { statusCode: 400 })
    }
    // Countless titles use number=0 by protocol; other zero-count attachments are notifications.
    if (mail.number === 0 && mail.type !== MailType.DEGREE) return { characterList, equipmentList, itemList, userInfo, degreeIds, exBoostItemList }
    if (mail.type === MailType.CHARACTER && mail.number > 1000) {
        throw Object.assign(new Error("A character mail may contain at most 1000 attachments."), { statusCode: 400 })
    }

    switch (mail.type) {
        case MailType.ITEM: {
            if (mail.type_id === null) break
            const newAmount = givePlayerItemSync(playerId, mail.type_id, mail.number)
            itemList[String(mail.type_id)] = newAmount
            break
        }
        case MailType.PAID_VMONEY: {
            const newVmoney = player.vmoney + mail.number
            updatePlayerSync({ id: playerId, vmoney: newVmoney })
            player.vmoney = newVmoney
            userInfo['vmoney'] = newVmoney
            break
        }
        case MailType.FREE_VMONEY: {
            const newFreeVmoney = player.freeVmoney + mail.number
            updatePlayerSync({ id: playerId, freeVmoney: newFreeVmoney })
            player.freeVmoney = newFreeVmoney
            userInfo['free_vmoney'] = newFreeVmoney
            break
        }
        case MailType.CHARACTER: {
            if (mail.type_id === null) break
            const duplicateItems = new Map<number, number>()
            for (let index = 0; index < mail.number; index++) {
                const grant = givePlayerCharacterSync(playerId, mail.type_id)
                if (!grant) throw new Error(`Mail ${mail.id} character is unavailable.`)
                if (grant.item) {
                    itemList[String(grant.item.id)] = grant.item.inventoryCount
                    duplicateItems.set(grant.item.id, (duplicateItems.get(grant.item.id) ?? 0) + grant.item.count)
                }
            }
            for (const [itemId, count] of duplicateItems) {
                exBoostItemList.push({ mail_id: mail.id, item_id: itemId, item_count: count })
            }
            const charData = getPlayerCharacterSync(playerId, mail.type_id)!
            characterList.push({
                character_id: mail.type_id,
                entry_count: charData.entryCount,
                evolution_level: charData.evolutionLevel,
                over_limit_step: charData.overLimitStep,
                protection: charData.protection,
                exp: charData.exp,
                stack: charData.stack,
                bond_token_list: charData.bondTokenList?.map(bt => ({
                    mana_board_index: bt.manaBoardIndex,
                    status: bt.status
                })) ?? [],
                join_time: clientSerializeDate(charData.joinTime),
                update_time: clientSerializeDate(charData.updateTime)
            })
            break
        }
        case MailType.EQUIPMENT: {
            if (mail.type_id === null) break
            const result = givePlayerEquipmentSync(playerId, mail.type_id, mail.number)
            equipmentList.push(result)
            break
        }
        case MailType.STAR_CRUMB: {
            const newCrumb = player.starCrumb + mail.number
            updatePlayerSync({ id: playerId, starCrumb: newCrumb })
            player.starCrumb = newCrumb
            userInfo['star_crumb'] = newCrumb
            break
        }
        case MailType.FREE_MANA: {
            const manaGrant = calculateFreeManaGrant(player, mail.number)
            updatePlayerSync({ id: playerId, freeMana: manaGrant.freeMana, manaObtainedDelta: mail.number })
            player.freeMana = manaGrant.freeMana
            player.totalManaObtained = getPlayerSync(playerId)?.totalManaObtained ?? player.totalManaObtained
            userInfo['free_mana'] = manaGrant.freeMana
            break
        }
        case MailType.EXP_POOL: {
            const newExp = adjustPlayerExpPoolSync(playerId, mail.number, 'mail_reward')
            if (newExp === null) throw new Error(`Failed to grant EXP mail ${mail.id} to player ${playerId}`)
            player.expPool = newExp
            userInfo['exp_pool'] = newExp
            break
        }
        case MailType.BOND_TOKEN: {
            const newBond = player.bondToken + mail.number
            updatePlayerSync({ id: playerId, bondToken: newBond })
            player.bondToken = newBond
            userInfo['bond_token'] = newBond
            break
        }
        case MailType.BOSS_BOOST_POINT: {
            const newBoss = player.bossBoostPoint + mail.number
            updatePlayerSync({ id: playerId, bossBoostPoint: newBoss })
            player.bossBoostPoint = newBoss
            userInfo['boss_boost_point'] = newBoss
            break
        }
        case MailType.BOOST_POINT: {
            const newBoost = player.boostPoint + mail.number
            updatePlayerSync({ id: playerId, boostPoint: newBoost })
            player.boostPoint = newBoost
            userInfo['boost_point'] = newBoost
            break
        }
        case MailType.DEGREE: {
            if (mail.type_id === null) break
            if (grantPlayerDegreeSync(playerId, mail.type_id)) {
                degreeIds.push(mail.type_id)
            }
            break
        }
        case MailType.RANK_POINT: {
            const newRank = player.rankPoint + mail.number
            updatePlayerSync({ id: playerId, rankPoint: newRank })
            player.rankPoint = newRank
            userInfo['rank_point'] = newRank
            break
        }
    }

    insertReceiveHistorySync(playerId, { type: mail.type, type_id: mail.type_id, number: mail.number })

    return { characterList, equipmentList, itemList, userInfo, degreeIds, exBoostItemList }
}

/**
 * Claims the exact requested mails and applies all rewards in one short write transaction.
 * The per-player queue prevents duplicate grants between concurrent requests in this process;
 * BEGIN IMMEDIATE also protects the read/mark/reward sequence from other writers.
 */
export async function claimPlayerMailRewards(
    playerId: number,
    requestedMailIds: readonly number[],
    requestId?: string,
): Promise<ClaimedMailRewards> {
    return runPersistenceTransaction({
        domain: "mail", playerId, operation: "claim_rewards",
    }, () => claimPlayerMailRewardsSync(playerId, requestedMailIds, requestId))
}

function claimPlayerMailRewardsSync(
    playerId: number,
    requestedMailIds: readonly number[],
    requestId?: string,
): ClaimedMailRewards {
    if (requestedMailIds.length > MAX_MAIL_CLAIM_IDS) {
        throw new RangeError(`A mail claim may contain at most ${MAX_MAIL_CLAIM_IDS} IDs.`)
    }
    const requestKey = buildMailClaimRequestKey(requestedMailIds, requestId)
    if (requestKey) {
        const previous = getPlayerOperationReceiptSync<ClaimedMailRewards>(
            playerId, "mail_claim", requestKey,
        )
        if (previous) return previous.response
    }
    const uniqueMailIds = [...new Set(requestedMailIds.filter(
        mailId => Number.isSafeInteger(mailId) && mailId > 0,
    ))]
    const mails = getUnreceivedPlayerMailsByIdsSync(playerId, uniqueMailIds)
    const mailById = new Map(mails.map(mail => [mail.id, mail]))
    const player = getPlayerSync(playerId)
    if (!player) throw new Error(`Player ${playerId} does not exist.`)

    // Mark first inside the transaction. Any reward failure rolls this update back.
    const claimedMailIds = receiveAllMailsSync(
        playerId,
        uniqueMailIds.filter(mailId => mailById.has(mailId)),
    )
    const characterList: any[] = []
    const equipmentList: any[] = []
    const itemList: Record<string, number> = {}
    const userInfo: Record<string, any> = {}
    const degreeIds = new Set<number>()
    const exBoostItemList: MailExBoostItem[] = []

    for (const mailId of claimedMailIds) {
        const mail = mailById.get(mailId)
        if (!mail) continue
        const reward = applyMailReward(playerId, player, mail)
        characterList.push(...reward.characterList)
        equipmentList.push(...reward.equipmentList)
        Object.assign(itemList, reward.itemList)
        Object.assign(userInfo, reward.userInfo)
        exBoostItemList.push(...reward.exBoostItemList)
        for (const degreeId of reward.degreeIds) degreeIds.add(degreeId)
    }

    const result: ClaimedMailRewards = {
        claimedMailIds,
        alreadyCount: requestedMailIds.length - claimedMailIds.length,
        characterList,
        equipmentList,
        itemList,
        userInfo,
        degreeIds: [...degreeIds],
        exBoostItemList,
    }
    if (requestKey) insertPlayerOperationReceiptSync({
        playerId,
        operation: "mail_claim",
        requestKey,
        response: result,
    })
    return result
}

const mailUserFields: Partial<Record<MailType, { wire: string; field: keyof Player }>> = {
    [MailType.PAID_VMONEY]: { wire: "vmoney", field: "vmoney" },
    [MailType.FREE_VMONEY]: { wire: "free_vmoney", field: "freeVmoney" },
    [MailType.STAR_CRUMB]: { wire: "star_crumb", field: "starCrumb" },
    [MailType.FREE_MANA]: { wire: "free_mana", field: "freeMana" },
    [MailType.EXP_POOL]: { wire: "exp_pool", field: "expPool" },
    [MailType.BOND_TOKEN]: { wire: "bond_token", field: "bondToken" },
    [MailType.BOSS_BOOST_POINT]: { wire: "boss_boost_point", field: "bossBoostPoint" },
    [MailType.BOOST_POINT]: { wire: "boost_point", field: "boostPoint" },
    [MailType.RANK_POINT]: { wire: "rank_point", field: "rankPoint" },
}

/** A new native identity acknowledges current balances. Only an identical
 * native request replays a historical complete response. Legacy mail_claim
 * rows remain readable and never cause their rewards to be applied again. */
function refreshMailRewardStateSync(playerId: number, claim: ClaimedMailRewards, alreadyReceived: RawPlayerMail[]): MailRewardResult {
    const characterIds = new Set<number>(claim.characterList.map(row => row.character_id))
    const equipmentIds = new Set<number>(claim.equipmentList.map(row => row.equipment_id))
    const itemIds = new Set<number>(Object.keys(claim.itemList).map(Number))
    const degreeIds = new Set<number>(claim.degreeIds)
    const userFields = new Set<string>(Object.keys(claim.userInfo))
    for (const mail of alreadyReceived) {
        if (mail.type === MailType.DEGREE && mail.type_id) degreeIds.add(mail.type_id)
        if (mail.number <= 0) continue
        if (mail.type === MailType.ITEM && mail.type_id) itemIds.add(mail.type_id)
        if (mail.type === MailType.EQUIPMENT && mail.type_id) equipmentIds.add(mail.type_id)
        if (mail.type === MailType.CHARACTER && mail.type_id) {
            characterIds.add(mail.type_id)
            const duplicateItemId = getCharacterDuplicateRewardItemId(mail.type_id)
            if (duplicateItemId !== null) itemIds.add(duplicateItemId)
        }
        const entry = mailUserFields[mail.type as MailType]
        if (entry) userFields.add(entry.wire)
    }
    const characterList: Record<string, any>[] = []
    for (const id of characterIds) {
        const character = getPlayerCharacterSync(playerId, id)
        if (!character) continue
        characterList.push({ character_id: id, entry_count: character.entryCount,
            evolution_level: character.evolutionLevel, over_limit_step: character.overLimitStep,
            protection: character.protection, exp: character.exp, stack: character.stack,
            mana_board_index: character.manaBoardIndex,
            bond_token_list: character.bondTokenList.map(bt => ({ mana_board_index: bt.manaBoardIndex, status: bt.status })),
            ...(character.exBoost ? { ex_boost: { status_id: character.exBoost.statusId, ability_id_list: character.exBoost.abilityIdList } } : {}),
            join_time: clientSerializeDate(character.joinTime), update_time: clientSerializeDate(character.updateTime) })
    }
    const equipmentList: Object[] = []
    for (const id of equipmentIds) {
        const equipment = getPlayerEquipmentSync(playerId, id)
        if (equipment) equipmentList.push(clientSerializeEquipment(id, equipment))
    }
    // item_list is a partial-key update: missing inventory rows must explicitly
    // clear the corresponding attachment or duplicate-compensation balance.
    const itemList: Record<string, number> = {}
    for (const id of itemIds) itemList[String(id)] = getPlayerItemSync(playerId, id) ?? 0
    const player = getPlayerSync(playerId)
    if (!player) throw new Error(`Player ${playerId} does not exist.`)
    const userInfo: Record<string, any> = {}
    for (const entry of Object.values(mailUserFields)) {
        if (entry && userFields.has(entry.wire)) userInfo[entry.wire] = player[entry.field]
    }
    return { characterList, equipmentList, itemList, userInfo,
        degreeIds: [...degreeIds].filter(id => hasPlayerDegreeSync(playerId, id)) }
}

async function claimNativeMailResponse(playerId: number, context: GameplayMutationContext,
    body: ReceiveBody | ReceiveAllBody, bulk: boolean) {
    const ids = bulk ? (body as ReceiveAllBody).mail_ids : [(body as ReceiveBody).mail_id]
    return runPersistenceTransaction({ domain: "mail", playerId, operation: "claim_rewards" }, () => {
        const mutation = readGameplayMutationRequestSync(playerId, context, bulk ? "mail_receive_all" : "mail_receive",
            { mailIds: ids, requestId: body.request_id })
        if (!mutation) return { error: "Invalid or superseded gameplay request." }
        if (mutation.response) return { data: mutation.response }
        const ownedMails = getPlayerMailsByIdsSync(playerId, ids)
        const requestKey = buildMailClaimRequestKey(ids, body.request_id)
        const legacy = requestKey ? getPlayerOperationReceiptSync<ClaimedMailRewards>(playerId, "mail_claim", requestKey)?.response : undefined
        if (!bulk && ownedMails.length === 0 && !legacy?.claimedMailIds.includes(ids[0])) {
            return { error: "Mail not found." }
        }
        const claim = claimPlayerMailRewardsSync(playerId, ids, body.request_id)
        const reward = refreshMailRewardStateSync(playerId, claim,
            ownedMails.filter(mail => mail.receive_time !== '0000-00-00 00:00:00'))
        // Do not swallow reconciliation failures after marking a mail received.
        const awake = reconcileAwakeUnlocks(playerId)
        const characterList = refreshAwakeUnlockCharacterList(playerId, reward.characterList, awake.all,
            [...reward.characterList.map(row => Number(row.character_id)), ...[...awake.changed.keys()].map(Number)])
        const data: Record<string, any> = bulk ? {
            already_mail_count: claim.alreadyCount, auto_sale_expired_mail_count: 0,
            deleted_mail_count: 0, dispose_expired_mail_count: 0, ex_boost_item_list: claim.exBoostItemList ?? [],
            mail_ids: claim.claimedMailIds, max_overed_mail_count: 0, outdated_mail_count: 0,
        } : { auto_sale_expired_mail: false, dispose_expired_mail: false }
        data.total_count = getPlayerMailCountSync(playerId)
        data.mail_arrived = getPlayerMailCountSync(playerId, true) > 0
        if (characterList.length > 0) data.character_list = characterList
        if (reward.equipmentList.length > 0) data.equipment_list = reward.equipmentList
        if (Object.keys(reward.itemList).length > 0) data.item_list = reward.itemList
        if (Object.keys(reward.userInfo).length > 0) data.user_info = reward.userInfo
        if (reward.degreeIds.length > 0) data.degree_list = reward.degreeIds.map(degreeId => ({ viewer_id: body.viewer_id, degree_id: degreeId }))
        recordGameplayMutationResponseSync(playerId, mutation, data)
        return { data }
    })
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/index", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as IndexBody
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid viewer_id"
        })

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid viewer_id"
        })

        const playerId = resolvePlayerIdSync(session.accountId)!
        if (playerId === null) return reply.status(400).send({
            error: "Bad Request",
            message: "No player bound to account"
        })

        const page = body.current_page || 1
        const mails = getPlayerMailsSync(playerId, page, 100)
        const totalCount = getPlayerMailCountSync(playerId)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {
                mail: mails.map(formatMailResponse),
                total_count: totalCount,
            }
        })
    })

    fastify.post("/receive", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body ?? {}) as ReceiveBody
        const viewerId = body.viewer_id
        const mailId = body.mail_id
        if (!Number.isSafeInteger(viewerId) || viewerId <= 0 || !Number.isSafeInteger(mailId) || mailId <= 0) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid request body"
        })

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid viewer_id"
        })

        const playerId = resolvePlayerIdSync(session.accountId)!
        if (playerId === null) return reply.status(400).send({
            error: "Bad Request",
            message: "No player bound to account"
        })

        const result = await claimNativeMailResponse(playerId, {
            headerToken: request.headers.login_token, body, accountId: session.accountId,
        }, body, false)
        if (result.error !== undefined) return reply.status(400).send({ error: "Bad Request", message: result.error })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: result.data
        })
    })

    fastify.post("/receive_all", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body ?? {}) as ReceiveAllBody
        const viewerId = body.viewer_id
        const mailIds = body.mail_ids
        if (!Number.isSafeInteger(viewerId) || viewerId <= 0 || !Array.isArray(mailIds) || mailIds.length > MAX_MAIL_CLAIM_IDS
            || mailIds.some(id => !Number.isSafeInteger(id) || id <= 0)) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid request body"
        })

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid viewer_id"
        })

        const playerId = resolvePlayerIdSync(session.accountId)!
        if (playerId === null) return reply.status(400).send({
            error: "Bad Request",
            message: "No player bound to account"
        })

        const result = await claimNativeMailResponse(playerId, {
            headerToken: request.headers.login_token, body, accountId: session.accountId,
        }, body, true)
        if (result.error !== undefined) return reply.status(400).send({ error: "Bad Request", message: result.error })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: result.data
        })
    })
}

export default routes
