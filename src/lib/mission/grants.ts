import type { Player } from "../../data/types"
import { givePlayerDegreeSync } from "../../data/domains/degree"
import { getPlayerItemSync, givePlayerItemSync } from "../../data/domains/item"
import { addPlayerPassCardPointSync } from "../../data/domains/pass-card"
import { updatePlayerSync } from "../../data/domains/player"
import { givePlayerCharacterSync } from "../character"
import { givePlayerEquipmentSync } from "../equipment"
import { getPassCardEventDefinition } from "../pass-card"
import type { ActiveMissionReward } from "./rewards"

interface MissionRewardGrantContext {
    passCardEventId?: number
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`)
    }
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`)
    }
    return value
}

function positiveSafeInteger(value: unknown, name: string): number {
    const parsed = nonNegativeSafeInteger(value, name)
    if (parsed === 0) throw new RangeError(`${name} must be positive`)
    return parsed
}

function safeSum(left: number, right: number, name: string): number {
    const result = left + right
    if (!Number.isSafeInteger(result) || result < 0) {
        throw new RangeError(`${name} cannot be updated safely`)
    }
    return result
}

export class MissionRewardGranter {
    readonly itemList: Record<string, number> = {}
    readonly degreeList: number[] = []
    readonly passCardPoints: Record<string, number> = {}
    private readonly characterMap = new Map<number, Object>()
    private readonly equipmentMap = new Map<number, Object>()
    private freeVmoney: number
    private freeMana: number
    private expPool: number
    private totalManaGained = 0

    constructor(private readonly playerId: number, private readonly player: Player) {
        positiveSafeInteger(playerId, "playerId")
        this.freeVmoney = nonNegativeSafeInteger(player.freeVmoney, "stored freeVmoney")
        this.freeMana = nonNegativeSafeInteger(player.freeMana, "stored freeMana")
        this.expPool = nonNegativeSafeInteger(player.expPool, "stored expPool")
        nonNegativeSafeInteger(player.totalManaObtained ?? 0, "stored totalManaObtained")
    }

    grant(rewards: ActiveMissionReward[], context: MissionRewardGrantContext = {}): void {
        if (!Array.isArray(rewards)) throw new TypeError("mission rewards must be an array")
        for (const reward of rewards) {
            if (!reward || typeof reward !== "object" || Array.isArray(reward)) {
                throw new TypeError("mission reward must be an object")
            }
            const kind = nonNegativeSafeInteger(reward.kind, "reward kind")
            const amount = nonNegativeSafeInteger(reward.amount, "reward amount")
            switch (kind) {
                case 0:
                    this.freeVmoney = safeSum(this.freeVmoney, amount, "freeVmoney")
                    break
                case 1: {
                    const itemId = positiveSafeInteger(reward.itemId, "reward itemId")
                    this.itemList[String(itemId)] = givePlayerItemSync(this.playerId, itemId, amount)
                    break
                }
                case 2: {
                    const equipmentId = positiveSafeInteger(reward.equipmentId, "reward equipmentId")
                    const equipment = givePlayerEquipmentSync(this.playerId, equipmentId, amount)
                    this.equipmentMap.set(equipmentId, equipment)
                    break
                }
                case 3:
                    this.freeMana = safeSum(this.freeMana, amount, "freeMana")
                    this.totalManaGained = safeSum(this.totalManaGained, amount, "totalManaGained")
                    break
                case 4: {
                    const characterId = positiveSafeInteger(reward.characterId, "reward characterId")
                    for (let count = 0; count < amount; count++) {
                        const result = givePlayerCharacterSync(this.playerId, characterId)
                        if (!result) throw new Error(`Character reward ${characterId} is unavailable.`)
                        this.characterMap.set(characterId, result.character)
                        if (result.item) {
                            this.itemList[String(result.item.id)] = getPlayerItemSync(this.playerId, result.item.id) ?? 0
                        }
                    }
                    break
                }
                case 5:
                    this.expPool = safeSum(this.expPool, amount, "expPool")
                    break
                case 6: {
                    const degreeId = positiveSafeInteger(reward.degreeId, "reward degreeId")
                    if (!this.degreeList.includes(degreeId) && givePlayerDegreeSync(this.playerId, degreeId)) {
                        this.degreeList.push(degreeId)
                    }
                    break
                }
                case 7: {
                    const eventId = positiveSafeInteger(context.passCardEventId, "passCardEventId")
                    const event = getPassCardEventDefinition(eventId)
                    if (!event) throw new Error(`Pass card event ${eventId} is missing.`)
                    this.passCardPoints[String(eventId)] = addPlayerPassCardPointSync(
                        this.playerId,
                        eventId,
                        amount,
                        event.thresholdPoint,
                    )
                    break
                }
                default:
                    throw new RangeError(`Unsupported mission reward kind ${kind}.`)
            }
        }
    }

    grantDegreeOwnershipOnly(degreeId: number): void {
        const validDegreeId = positiveSafeInteger(degreeId, "degreeId")
        if (!this.degreeList.includes(validDegreeId) && givePlayerDegreeSync(this.playerId, validDegreeId)) {
            this.degreeList.push(validDegreeId)
        }
    }

    persistPlayer(): void {
        if (!this.hasPlayerChanges()) return
        const totalManaObtained = safeSum(
            nonNegativeSafeInteger(this.player.totalManaObtained ?? 0, "stored totalManaObtained"),
            this.totalManaGained,
            "totalManaObtained",
        )
        updatePlayerSync({
            id: this.playerId,
            freeVmoney: this.freeVmoney,
            freeMana: this.freeMana,
            expPool: this.expPool,
            totalManaObtained,
        })
    }

    hasPlayerChanges(): boolean {
        return this.freeVmoney !== this.player.freeVmoney
            || this.freeMana !== this.player.freeMana
            || this.expPool !== this.player.expPool
    }

    getUserInfo(): Record<string, number> {
        return {
            free_vmoney: this.freeVmoney,
            free_mana: this.freeMana,
            exp_pool: this.expPool,
        }
    }

    get characterList(): Object[] {
        return [...this.characterMap.values()]
    }

    get equipmentList(): Object[] {
        return [...this.equipmentMap.values()]
    }
}
