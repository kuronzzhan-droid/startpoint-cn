import { getDb } from "../data/db"
import { MailType, RawPlayerMail, getPlayerMailByIdSync, getPlayerMailsByIdsSync, insertReceiveHistorySync, receiveMailSync } from "../data/domains/mail"
import { grantPlayerDegreeSync } from "../data/domains/degree"
import { getPlayerItemSync, givePlayerItemSync } from "../data/domains/item"
import { getPlayerSync, updatePlayerSync } from "../data/domains/player"
import { givePlayerCharacterSync } from "./character"
import { givePlayerEquipmentSync } from "./equipment"

/**
 * Everything a claim handed to the player, in the shape the client expects.
 * Item amounts and user-info fields are absolute totals, so merging several
 * mails into one accumulator is just last-write-wins.
 */
export interface MailRewards {
    characterList: any[]
    equipmentList: any[]
    itemList: Record<string, number>
    userInfo: Record<string, any>
}

export type MailClaimStatus = "claimed" | "already_received" | "not_found"

export interface MailClaimResult {
    status: MailClaimStatus
    rewards: MailRewards
}

export interface MailBatchClaimResult {
    /** IDs that this call actually paid out. */
    claimed: number[]
    /** Requested IDs that were already received (or never existed). */
    alreadyCount: number
    rewards: MailRewards
}

export function emptyMailRewards(): MailRewards {
    return {
        characterList: [],
        equipmentList: [],
        itemList: {},
        userInfo: {},
    }
}

/**
 * Applies a mail's attachment to the player, accumulating into `rewards`.
 *
 * Callers must run this inside the transaction that marks the mail received —
 * on its own it would leave the mailbox and the inventory able to disagree.
 */
function applyMailReward(playerId: number, mail: RawPlayerMail, rewards: MailRewards): void {
    const player = getPlayerSync(playerId)
    if (!player) return

    const { characterList, equipmentList, itemList, userInfo } = rewards

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
            userInfo['vmoney'] = newVmoney
            break
        }
        case MailType.FREE_VMONEY: {
            const newFreeVmoney = player.freeVmoney + mail.number
            updatePlayerSync({ id: playerId, freeVmoney: newFreeVmoney })
            userInfo['free_vmoney'] = newFreeVmoney
            break
        }
        case MailType.CHARACTER: {
            if (mail.type_id === null) break
            // same grant path as gacha/exchange: new characters get their bond
            // tokens, dupes get stack+1 plus the rarity×element compensation item
            const result = givePlayerCharacterSync(playerId, mail.type_id)
            if (result === null) break
            characterList.push(result.character)
            if (result.item) {
                itemList[String(result.item.id)] =
                    getPlayerItemSync(playerId, result.item.id) ?? result.item.count
            }
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
            userInfo['star_crumb'] = newCrumb
            break
        }
        case MailType.FREE_MANA: {
            const newMana = player.freeMana + mail.number
            updatePlayerSync({ id: playerId, freeMana: newMana, totalManaObtained: (player.totalManaObtained ?? 0) + mail.number })
            userInfo['free_mana'] = newMana
            break
        }
        case MailType.EXP_POOL: {
            const newExp = player.expPool + mail.number
            updatePlayerSync({ id: playerId, expPool: newExp })
            userInfo['exp_pool'] = newExp
            break
        }
        case MailType.BOND_TOKEN: {
            const newBond = player.bondToken + mail.number
            updatePlayerSync({ id: playerId, bondToken: newBond })
            userInfo['bond_token'] = newBond
            break
        }
        case MailType.BOSS_BOOST_POINT: {
            const newBoss = player.bossBoostPoint + mail.number
            updatePlayerSync({ id: playerId, bossBoostPoint: newBoss })
            userInfo['boss_boost_point'] = newBoss
            break
        }
        case MailType.BOOST_POINT: {
            const newBoost = player.boostPoint + mail.number
            updatePlayerSync({ id: playerId, boostPoint: newBoost })
            userInfo['boost_point'] = newBoost
            break
        }
        case MailType.RANK_POINT: {
            const newRank = player.rankPoint + mail.number
            updatePlayerSync({ id: playerId, rankPoint: newRank })
            userInfo['rank_point'] = newRank
            break
        }
        case MailType.DEGREE: {
            if (mail.type_id === null) break
            grantPlayerDegreeSync(playerId, mail.type_id)
            break
        }
    }

    insertReceiveHistorySync(playerId, { type: mail.type, type_id: mail.type_id, number: mail.number })
}

/**
 * Claims one mail atomically.
 *
 * The received-mark, the reward grant and the receive-history row all run in a
 * single transaction, so a crash between them can't hand out a reward that the
 * mailbox still shows as unclaimed (or the reverse). Re-claiming an already
 * received mail is a no-op rather than an error, which keeps double taps and
 * retried requests from looking like failures to the client.
 */
export function claimMailSync(playerId: number, mailId: number): MailClaimResult {
    return getDb().transaction((): MailClaimResult => {
        const mail = getPlayerMailByIdSync(playerId, mailId)
        if (mail === null) return { status: "not_found", rewards: emptyMailRewards() }

        // conditional mark — losing this race means the reward was already paid
        if (receiveMailSync(playerId, mailId) === null) {
            return { status: "already_received", rewards: emptyMailRewards() }
        }

        const rewards = emptyMailRewards()
        applyMailReward(playerId, mail, rewards)
        return { status: "claimed", rewards }
    })()
}

/**
 * Claims a batch of mails atomically. Duplicate and unknown IDs are ignored,
 * and each mail is marked received before its reward is applied, so no ID can
 * be paid out twice within a batch or across concurrent batches.
 */
export function claimMailsSync(playerId: number, mailIds: number[]): MailBatchClaimResult {
    const requested = Array.from(new Set(mailIds.filter(id => Number.isInteger(id))))
    if (requested.length === 0) {
        return { claimed: [], alreadyCount: 0, rewards: emptyMailRewards() }
    }

    return getDb().transaction((): MailBatchClaimResult => {
        const pending = new Map(
            getPlayerMailsByIdsSync(playerId, requested, true).map(mail => [mail.id, mail])
        )

        const rewards = emptyMailRewards()
        const claimed: number[] = []

        for (const mailId of requested) {
            const mail = pending.get(mailId)
            if (mail === undefined) continue
            if (receiveMailSync(playerId, mailId) === null) continue

            applyMailReward(playerId, mail, rewards)
            claimed.push(mailId)
        }

        return { claimed, alreadyCount: requested.length - claimed.length, rewards }
    })()
}
