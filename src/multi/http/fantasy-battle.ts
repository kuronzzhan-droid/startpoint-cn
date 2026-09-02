import { getCharactersEvolutionImgLevels } from "../../lib/character"
import {
    isFantasyGauntletEnabled,
    isFantasyMultiQuest,
    settleFantasyBattleSync,
    type FantasySettlementResult,
} from "../../lib/fantasy-gauntlet"
import { getRoom } from "../room/manager"


/**
 * 多人结算包里的编队统计。客户端在不同版本里字段可有可无,
 * 全部按「可能缺」处理 —— 缺了就退化成 null 槽位,绝不抛。
 */
interface MultiFinishPartyStatistics {
    characters?: Array<{ id?: number | null } | null>
    unison_characters?: Array<{ id?: number | null } | null>
    equipments?: Array<{ id?: number | null } | null>
    ability_soul_ids?: Array<number | null>
}


export interface FantasyMultiFinishInput {
    readonly playerId: number
    readonly questCategory: number
    readonly questId: number
    readonly accomplished: boolean
    readonly party: MultiFinishPartyStatistics
    /** 结算请求里带的房号(优先用进行中战斗记下来的那个)。 */
    readonly roomNumber?: string | null
}


export interface FantasyMultiFinishOutcome {
    /** 结算结果;失败或不是幻想关时为 null。 */
    readonly settlement: FantasySettlementResult | null
    /** 这次结算的人是不是房主 —— 决定 host_finished 与是否推进进度。 */
    readonly finishedAsHost: boolean
}


function slotIds(
    entries: Array<{ id?: number | null } | null> | undefined,
): (number | null)[] {
    return (entries ?? []).map(entry => {
        const id = entry?.id
        return id === undefined || id === null ? null : Number(id)
    })
}


/**
 * 这次多人结算要不要走幻想连战的额外结算。
 *
 * @param category 关卡分类。
 * @param questId 关卡 ID。
 * @returns 是否该调用 {@link settleFantasyMultiFinish}。
 */
export function shouldSettleFantasyMultiFinish(
    category: number,
    questId: number,
): boolean {
    return isFantasyGauntletEnabled() && isFantasyMultiQuest(category, questId)
}


/**
 * 幻想连战多人段的结算装载缝。
 *
 * 房主与救援客人走**同一个**入口,区别只有一个 `rescue` 标志:
 *  · 房主:发奖 + 补 Rush 侧占位关的通关记录 + 补 folder 标记 + 推进这一轮;
 *  · 救援客人:只发奖,进度一动不动(他们的运行由自己那间房决定)。
 *
 * @param input 结算上下文。
 * @returns 结算结果与房主判定。
 */
export function settleFantasyMultiFinish(
    input: FantasyMultiFinishInput,
): FantasyMultiFinishOutcome {
    const room = input.roomNumber ? getRoom(input.roomNumber) : undefined
    const finishedAsHost = room?.host_player_id === input.playerId

    const characterIds = slotIds(input.party.characters)
    const unisonCharacterIds = slotIds(input.party.unison_characters)
    const settlement = settleFantasyBattleSync(
        input.playerId,
        input.questCategory,
        input.questId,
        input.accomplished,
        {
            rescue: !finishedAsHost,
            playedParty: {
                characterIds,
                unisonCharacterIds,
                equipmentIds: slotIds(input.party.equipments),
                abilitySoulIds: (input.party.ability_soul_ids ?? []).map(
                    value => (value === undefined || value === null ? null : Number(value)),
                ),
                evolutionImgLevels: getCharactersEvolutionImgLevels(
                    input.playerId,
                    characterIds,
                ),
                unisonEvolutionImgLevels: getCharactersEvolutionImgLevels(
                    input.playerId,
                    unisonCharacterIds,
                ),
            },
        },
    )
    return { settlement, finishedAsHost }
}
