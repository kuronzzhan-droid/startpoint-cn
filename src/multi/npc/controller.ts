import type { MultiRoom, MultiMate, CompanionInfo } from "../types"
import type { IRoomMateProvider, RecruitResult } from "../types"
import type { NpcMateTemplate } from "../../lib/types"
import { NPC_TEMPLATES } from "./types"
import { invokeRealtimeBusiness } from "../coordinator/business-rpc"
import { isRealtimeOwnerChild } from "../coordinator/runtime-role"
import { getRoom } from "../room/manager"

type RecruitedMate = RecruitResult["recruitedMates"][number]

export function selectStableNpcSlots(
    recruitedMates: readonly RecruitedMate[],
    count: number,
): RecruitedMate[] {
    const desiredCount = Math.max(0, Math.min(2, Math.floor(count)))
    if (desiredCount === 0) return []

    // Real players replace COM seats from the front (COM1, then COM2). Keep
    // the remaining tail seats when the lobby is rebuilt so a 2R1B rematch
    // does not silently change the surviving bot from COM2 back to COM1.
    return [...recruitedMates]
        .sort((left, right) => left.com_id - right.com_id)
        .slice(-desiredCount)
}

export class NpcMateProvider implements IRoomMateProvider {
    private readonly prepared = new Map<string, MultiMate[]>()
    getMates(roomNumber: string): MultiMate[] {
        const room = getRoom(roomNumber)
        if (isRealtimeOwnerChild()) return this.prepared.get(roomNumber) ?? []
        const { mate1, mate2 } = require("./builder").buildNpcMates(room?.quest_id, room?.category)
        return [mate1, mate2].filter((m): m is MultiMate => m !== null)
    }

    async onRecruit(roomNumber: string, hostViewerId: string): Promise<RecruitResult> {
        const room = getRoom(roomNumber)
        if (!room) return { recruitedMates: [] }
        const mates = await invokeRealtimeBusiness<MultiMate[]>("npc.mates", { category: room.category, questId: room.quest_id })
        this.prepared.set(roomNumber, mates)
        while (this.prepared.size > 256) this.prepared.delete(this.prepared.keys().next().value!)
        return {
            recruitedMates: [
                { viewer_id: 900000001, com_id: 1 },
                { viewer_id: 900000002, com_id: 2 },
            ],
        }
    }

    isRoomFull(roomNumber: string): boolean {
        return true
    }

    getAvailableCompanions(hostViewerId: string): CompanionInfo[] {
        return []
    }
}
