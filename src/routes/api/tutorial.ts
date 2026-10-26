import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MailType, insertReceiveHistorySync } from "../../data/domains/mail"
import { getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getPlayerCharacterSync } from "../../data/domains/character"
import { getPlayerItemSync, givePlayerItemSync } from "../../data/domains/item"
import { getPlayerOperationReceiptSync, insertPlayerOperationReceiptSync } from "../../data/domains/player-operation-receipt"
import { getPlayerTriggeredTutorialsSync, insertPlayerTriggeredTutorialSync } from "../../data/domains/tutorial"
import { getSession } from "../../data/domains/session"
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { generateDataHeaders, getServerTime } from "../../utils";
import { getGachaSync } from "../../lib/assets";
import { givePlayerCharacterSync } from "../../lib/character";
import { randomInt } from "crypto";
import { GachaCharacterDraw } from "../../lib/types";
import { reconcileAwakeUnlockCharacterList } from "../../lib/mission";
import { getTutorialEffectiveStep, isStartTutorialActive, TUTORIAL_END_EFFECTIVE_STEP } from "../../lib/start-tutorial-state";
import { countFinishedPlayerQuestsByCategorySync } from "../../data/domains/quest";
import { runPersistenceTransaction } from "../../lib/persistence-coordinator";
import { readGameplayMutationRequestSync, recordGameplayMutationResponseSync } from "../../lib/gameplay-mutation-receipt";
import { CRAZY_GACHA_TICKET_ID } from "../../data/domains/crazy_gacha";
import { clientSerializeDate, serializeBondTokenStatuses } from "../../data/utils";

interface UpdateStepBody {
    viewer_id: number
    step: number
    api_count: number
    skip: boolean
    statistics: Object
    name?: string
    gacha_id?: number
}

interface FinishTriggerBody {
    api_count: number,
    tutorial_ids: number[],
    viewer_id: number
}

const freeTutorialCharacterId = 243001

const tutorialGachaCharacterIds = [251001, 251002, 251003, 251004, 251005, 251006, 251007, 251008]

// Extra destination-side protection against rewound tutorial fields. Portable
// tutorial progress remains authoritative when an imported save has no receipt.
// Never infer an unclaimed legacy gift merely from the absence of this marker.
const tutorialRewardOperation = "tutorial_reward.v1"
interface TutorialRewardReceipt {
    version: 1
    gachaId?: number
    data: Record<string, any>
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/finish_trigger", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as FinishTriggerBody

        const viewerId = body.viewer_id
        const tutorialIds = body.tutorial_ids
        if (!viewerId || isNaN(viewerId) || !tutorialIds || !(tutorialIds instanceof Array)) return reply.status(400).send({
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

        // Mark tutorial as having been completed (skip already triggered)
        await runPersistenceTransaction({
            domain: "player", playerId, operation: "tutorial_finish_trigger",
        }, () => {
            const existing = getPlayerTriggeredTutorialsSync(playerId)
            for (const tutorialId of tutorialIds) {
                if (!existing.find((v: number) => v === tutorialId)) {
                    insertPlayerTriggeredTutorialSync(playerId, tutorialId)
                }
            }
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": []
        })
    })

    fastify.post("/update_step", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as UpdateStepBody | undefined

        const viewerId = body?.viewer_id
        const completedStep = body?.step
        const skip = body?.skip ?? false
        if (!Number.isSafeInteger(viewerId) || Number(viewerId) <= 0
            || !Number.isSafeInteger(completedStep) || Number(completedStep) < 0
            || typeof skip !== "boolean" || Number(completedStep) > (skip ? 5 : 16)
            || (body?.name !== undefined && (typeof body.name !== "string" || body.name.length > 12))
            || (body?.gacha_id !== undefined && (!Number.isSafeInteger(body.gacha_id) || body.gacha_id <= 0))) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(String(viewerId))
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        const nextStep = Number(completedStep) + 1
        const effectiveNextStep = getTutorialEffectiveStep(nextStep, skip)
        const rewardKey = effectiveNextStep === 15 ? "gacha" : effectiveNextStep === 16 ? "present" : null
        const result = await runPersistenceTransaction({ domain: "player", playerId, operation: "tutorial_step" }, () => {
            const mutation = readGameplayMutationRequestSync(playerId,
                { headerToken: request.headers.login_token, body: body!, accountId: viewerIdSession.accountId },
                "tutorial.update_step", { step: completedStep, skip, name: body!.name, gachaId: body!.gacha_id })
            if (!mutation) return { ok: false as const, message: "Tutorial request identity is invalid or superseded." }
            if (mutation.response) return { ok: true as const, data: mutation.response }
            const player = getPlayerSync(playerId)
            if (!player) return { ok: false as const, message: "No player bound to account." }

            // Full and shortened tutorials consume the same business entitlement.
            const previous = rewardKey
                ? getPlayerOperationReceiptSync<TutorialRewardReceipt>(playerId, tutorialRewardOperation, rewardKey)?.response
                : null
            if (previous) {
                if (previous.version !== 1 || !previous.data || typeof previous.data !== "object") {
                    throw new Error("Invalid tutorial reward receipt")
                }
                if (rewardKey === "gacha" && previous.gachaId !== body!.gacha_id) {
                    return { ok: false as const, message: "Tutorial draw has already used another gacha." }
                }
                // A new login/count acknowledges the already-consumed business
                // right using current progress/inventories. Only the identical
                // protocol request above replays the original complete reply.
                const characterList = (previous.data.character_list as { character_id: number }[]).flatMap(entry => {
                    const current = getPlayerCharacterSync(playerId, entry.character_id)
                    return current ? [{ character_id: entry.character_id, entry_count: current.entryCount,
                        stack: current.stack, exp: current.exp, exp_total: current.exp,
                        evolution_level: current.evolutionLevel, over_limit_step: current.overLimitStep,
                        protection: current.protection, mana_board_index: current.manaBoardIndex,
                        bond_token_list: serializeBondTokenStatuses(current.bondTokenList),
                        create_time: clientSerializeDate(current.joinTime), join_time: clientSerializeDate(current.joinTime),
                        update_time: clientSerializeDate(current.updateTime) }] : []
                })
                const data = { ...previous.data,
                    step: player.tutorialStep === null ? TUTORIAL_END_EFFECTIVE_STEP
                        : getTutorialEffectiveStep(player.tutorialStep, player.tutorialSkipFlag),
                    user_info: { free_vmoney: player.freeVmoney },
                    character_list: reconcileAwakeUnlockCharacterList(playerId, characterList),
                    item_list: Object.fromEntries(Object.keys(previous.data.item_list).map(id => [id, getPlayerItemSync(playerId, id) ?? 0])),
                    start_time: getServerTime(),
                }
                recordGameplayMutationResponseSync(playerId, mutation, data)
                return { ok: true as const, data }
            }

            if (!isStartTutorialActive(player.tutorialStep, player.tutorialSkipFlag,
                countFinishedPlayerQuestsByCategorySync(playerId, 1) > 0)) {
                return { ok: false as const, message: "Tutorial already completed." }
            }
            if (player.tutorialStep! > 0 && player.tutorialSkipFlag !== null && player.tutorialSkipFlag !== skip) {
                return { ok: false as const, message: "Tutorial mode does not match saved progress." }
            }
            const currentEffectiveStep = getTutorialEffectiveStep(player.tutorialStep!, player.tutorialSkipFlag)
            if (currentEffectiveStep > effectiveNextStep || effectiveNextStep > TUTORIAL_END_EFFECTIVE_STEP) {
                return { ok: false as const, message: "Attempt to redo previous tutorial step." }
            }
            // Old code could commit the step before its reward. Neither missing
            // history nor a missing new receipt distinguishes that from an
            // already-paid imported save: never guess a retroactive full grant.
            if (rewardKey && (currentEffectiveStep >= effectiveNextStep
                || (rewardKey === "gacha" && player.tutorialGachaCharacterId !== null)
                || (rewardKey === "present" && getPlayerCharacterSync(playerId, freeTutorialCharacterId) !== null))) {
                return { ok: false as const, message: "Legacy tutorial reward status requires review." }
            }

            const data: Record<string, any> = { step: effectiveNextStep, mail_arrived: false, start_time: getServerTime() }
            if (body!.name !== undefined) data.name = body!.name
            if (rewardKey === "gacha") {
                const gachaId = body!.gacha_id
                const gacha = gachaId === undefined ? null : getGachaSync(gachaId)
                if (!gacha || gacha.type !== 0 || !Number.isSafeInteger(gacha.singleCost) || gacha.singleCost < 0) {
                    return { ok: false as const, message: "Invalid tutorial gacha." }
                }
                if (player.freeVmoney < gacha.singleCost) return { ok: false as const, message: "Not enough free vmoney." }
                const characterId = tutorialGachaCharacterIds[randomInt(0, tutorialGachaCharacterIds.length)]
                const granted = givePlayerCharacterSync(playerId, characterId)
                if (!granted?.character) throw new Error("Tutorial draw character is unavailable")
                insertReceiveHistorySync(playerId, { type: MailType.CHARACTER, type_id: characterId, number: 1 })
                const balance = player.freeVmoney - gacha.singleCost
                updatePlayerSync({ id: playerId, freeVmoney: balance, tutorialGachaCharacterId: characterId })
                // The native tutorial uses this fixed movie/seed. Do not mark
                // unrelated normal-gacha movie seeds sent before this commits.
                const draw: GachaCharacterDraw = { character_id: characterId,
                    movie_id: "normal_guarantee", seed: 10007656, entry_count: 1,
                    ...(granted.item ? { ex_boost_item: { id: granted.item.id, count: granted.item.count } } : {}) }
                const characters = [granted.character as Record<string, unknown>]
                Object.assign(data, { user_info: { free_vmoney: balance },
                    gacha: { draw: [draw], gacha_info_list: [{ gacha_id: gachaId, is_account_first: false, is_daily_first: false }] },
                    character_list: reconcileAwakeUnlockCharacterList(playerId, characters),
                    item_list: granted.item ? { [granted.item.id]: granted.item.inventoryCount } : {}, encyclopedia_info: [] })
            } else if (rewardKey === "present") {
                // Match the native Present table: character 243001 + ticket
                // 999012 once. The former currency and mail are replaced.
                const given = givePlayerCharacterSync(playerId, freeTutorialCharacterId)
                if (!given?.character) throw new Error("Tutorial gift character is unavailable")
                insertReceiveHistorySync(playerId, { type: MailType.CHARACTER, type_id: freeTutorialCharacterId, number: 1 })
                const ticketCount = givePlayerItemSync(playerId, CRAZY_GACHA_TICKET_ID, 1)
                insertReceiveHistorySync(playerId, { type: MailType.ITEM, type_id: CRAZY_GACHA_TICKET_ID, number: 1 })
                const characters = [given.character as Record<string, unknown>]
                Object.assign(data, { user_info: { free_vmoney: player.freeVmoney },
                    character_list: reconcileAwakeUnlockCharacterList(playerId, characters),
                    item_list: { [CRAZY_GACHA_TICKET_ID]: ticketCount },
                    encyclopedia_info: { [`1${freeTutorialCharacterId}01`]: { read: false } } })
            }
            updatePlayerSync({ id: playerId, tutorialStep: nextStep, tutorialSkipFlag: skip, name: body!.name })
            if (rewardKey) insertPlayerOperationReceiptSync<TutorialRewardReceipt>({ playerId,
                operation: tutorialRewardOperation, requestKey: rewardKey,
                response: { version: 1, ...(rewardKey === "gacha" ? { gachaId: body!.gacha_id } : {}), data } })
            recordGameplayMutationResponseSync(playerId, mutation, data)
            return { ok: true as const, data }
        })
        if (!result.ok) return reply.status(400).send({ error: "Bad Request", message: result.message })
        return reply.header("content-type", "application/x-msgpack").status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }), data: result.data,
        })
    })
}

export default routes;
