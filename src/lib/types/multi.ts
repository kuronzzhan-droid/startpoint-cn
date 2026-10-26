import { QuestCategory } from "./quest"
import type { QuestNpcPartySnapshot } from "../../multi/npc/quest-party-pool-shared"

export interface MultiMatePartyCharacter {
    id: number
    evolution_level: number
    exp: number
    over_limit_step: number
    mana_node_ids: number[] | null
    ex_boost: {
        ability_id_list: number[]
        status_id: number
    } | null
}


export interface MultiMateEquipment {
    equipment_id: number
    level: number
    enhancement_level: number
}


export interface MultiMateParty {
    characters: (MultiMatePartyCharacter | null)[]
    unison_characters: (MultiMatePartyCharacter | null)[]
    equipments: (MultiMateEquipment | null)[]
    ability_soul_ids: (number | null)[]
}


export interface MultiMate {
    com_id: number
    degree_id: number
    rank: number
    party: MultiMateParty
}


export type MultiRoomPhase =
    | "LOBBY"
    | "STARTING"
    | "BATTLE"
    | "SETTLING"
    | "RETURNING"
    | "DISBANDED"


export interface MultiRoomLifecycle {
    instanceId: string
    phase: MultiRoomPhase
    version: number
    battleSessionId: string | null
    /** Internal scene identity; legacy TCP arrays remain unchanged. */
    sceneEpoch?: number
}


export interface MultiRoom {
    five_boss_runtime?: {
        runId: string
        expectedRealPlayerIds: number[]
        battleEnteredPlayerIds?: number[]
        autoplayModeByPlayerId: Record<string, boolean>
        partyCharacterIdsByPlayerId: Record<string, number[]>
        battleIdentityByViewerId: Record<string, { playerId: number, remoteAddress: string, connectionId: string }>
    }
    room_number: string
    access_token: string
    category: QuestCategory
    quest_id: number
    host_viewer_id: number
    host_player_id: number
    host_party_id: number
    /** Party selections approved before this generation enters BATTLE. */
    equipmentPartyIds?: Record<number, number>
    battleParties?: Record<number, unknown>
    /** Actual wire rosters captured with the checked selections before BATTLE. */
    npcPartySnapshots?: Record<number, QuestNpcPartySnapshot>
    readyCountdownPending?: boolean
    host_main_character_id: number
    accepted_type: number
    created_at: number
    raising_state: number
    room_sequence: number
    host_entry_time: number
    member_viewer_ids: number[]
    member_player_ids: Record<number, number>
    mates: Array<{ viewer_id: number | null, com_id: number, player_id?: number }>
    share_room_options: number
    is_npc_mode: boolean
    npc_count: number  // fixed NPC count per battle: 0=unrecruited, 1/2=fixed count
    /** AI count of the battle that most recently started; used by the rematch lobby. */
    rematch_ai_count?: number
    /** Stable COM party snapshots for this room's auto-repeat lifecycle. */
    npc_party_by_com_id: Record<string, any>
    expected_real_viewer_ids: number[]
    lobby_generation: number
    rematch_wait_started_at: number | null
    settlement_return_pending: boolean
    lifecycle: MultiRoomLifecycle
}


export interface NpcMateTemplate {
    com_id: 1 | 2
    characters: number[]
    unison_characters: number[]
    equipments: number[]
    ability_soul_ids: number[]
    rank: number
    degree_id: number
}
