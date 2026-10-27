import { getDb } from "../../data/db"
import { getPlayerPartyGroupListSync } from "../../data/domains/party"
import { PartyCategory } from "../../data/types"
import { enforceWeaponRivenPartyLimitSync } from "../../data/domains/weapon-riven-party"
import { parseGlobalPartyId } from "../special-event-parties"
import { normalizeWeaponRivenLoadout, parseWeaponRivenLoadout, type WeaponRivenBattleLoadout } from "./loadout"

export function getSoloWeaponRivenStartLoadoutSync(playerId: number, partyId?: number): WeaponRivenBattleLoadout {
    const parsed = partyId === undefined ? null : parseGlobalPartyId(partyId)
    if (parsed) enforceWeaponRivenPartyLimitSync(playerId, partyId!)
    const party = parsed && getPlayerPartyGroupListSync(playerId, PartyCategory.NORMAL)
        [String(parsed.groupId)]?.list[String(parsed.slot)]
    return normalizeWeaponRivenLoadout(party ? { ...party, partyId } : undefined)
}

export function getSoloWeaponRivenLoadoutSync(playerId: number, playId: string): WeaponRivenBattleLoadout {
    const row = getDb().prepare(`SELECT riven_loadout_json FROM five_boss_solo_runs
        WHERE player_id = ? AND play_id = ? AND status = 'active'`).get(playerId, playId) as
        { riven_loadout_json: string } | undefined
    if (!row) throw new Error("No active five-boss solo loadout.")
    return parseWeaponRivenLoadout(row.riven_loadout_json)
}

export function getMultiWeaponRivenLoadoutSync(playerId: number, runId: string): WeaponRivenBattleLoadout {
    const row = getDb().prepare(`SELECT riven_loadout_json FROM five_boss_gauntlet_members
        WHERE player_id = ? AND run_id = ?`).get(playerId, runId) as { riven_loadout_json: string } | undefined
    if (!row) throw new Error("No five-boss member loadout.")
    return parseWeaponRivenLoadout(row.riven_loadout_json)
}
