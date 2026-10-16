import { PlayerBoxGachaDrawnReward } from "../../data/types"
import { Reward } from "./rewards"

export enum BoxGachaRewardType {
    ITEM,
    EQUIPMENT,
    EMPTY,
    MANA,
    EXP,
    PASS_CARD_POINT,
    CHARACTER
}


export enum BoxGachaRewardTier {
    COMMON,
    RARE,
    FEATURED
}


export interface BoxGachaReward {
    type: BoxGachaRewardType,
    count: number,
    available: number,
    tier: BoxGachaRewardTier,
}


export interface BoxGachaIdReward extends BoxGachaReward {
    id: number
}


export type BoxGachaBox = Record<string, BoxGachaReward>

export type BoxGachaBoxes = Record<string, BoxGachaBox>


export interface RawBoxGacha {
    itemId: number,
    count: number,
    availableCounts: Record<string, number>
}


export type RawBoxGachas = Record<string, RawBoxGacha>


export type RawBoxRewards = Record<string, BoxGachaBoxes>


export interface BoxGacha {
    redeemItemId: number,
    redeemItemCount: number,
    boxes: Record<string, BoxGachaBox>
    availableCounts: Record<string, number>
}


export interface BoxGachaDrawResult {
    drawCount: number
    rewards: PlayerBoxGachaDrawnReward[]
    mana: number
    exp: number
    characters: Map<number, number>
    equipment: Map<number, number>
    items: Map<number, number>
}
