import { getDb } from "../db"
import { getPlayerItemSync } from "./item"
import { grantWeaponRivenSync, WeaponRivenGrantResult } from "./weapon-riven-grant"
import { getPlayerOperationReceiptSync, insertPlayerOperationReceiptSync } from "./player-operation-receipt"
import { runPersistenceTransactionSync } from "../../lib/persistence-coordinator"
import { getWeaponRivenTheme, getWeaponRivenThemePool, isWeaponRivenRevealCandidate, rollWeaponRivenQualities } from "../../lib/weapon-riven/rules"
import { isUnknownWeaponRivenItemId, UNKNOWN_RIVEN_ITEM_ID } from "../../lib/weapon-riven/constants"
import { cleanupConvertedUnknownWeaponRivenPartiesSync, getWeaponRivenPartyInfoListSync } from "./weapon-riven-party"
import { refreshWeaponRivenSettlementDataSync } from "../../lib/weapon-riven/settlement-response"
import { WeaponRivenBattleLoadout } from "../../lib/weapon-riven/loadout"

interface WeaponRivenConversionResult extends WeaponRivenGrantResult {
    party_info_list: ReturnType<typeof getWeaponRivenPartyInfoListSync>
}

export function convertUnknownWeaponRivensSync(
    playerId: number, loadout: Partial<WeaponRivenBattleLoadout>,
    sourceKey: string, random: () => number = Math.random,
): WeaponRivenConversionResult {
    return runPersistenceTransactionSync({domain:"player",playerId,operation:"weapon_riven_convert"}, () => {
        const prior = getPlayerOperationReceiptSync<WeaponRivenConversionResult>(playerId, "weapon_riven_convert", sourceKey)
        if (prior) return refreshWeaponRivenSettlementDataSync(playerId, {...prior.response, party_info_list: prior.response.party_info_list ?? []})
        const result: WeaponRivenConversionResult = {weapon_riven_list:{},weapon_riven_deleted:[],weapon_riven_granted:[],
            weapon_riven_auto_dismantled:[],item_list:{},party_info_list:[]}
        const db = getDb()
        const owned = (db.prepare("SELECT id FROM players_equipment WHERE player_id=? ORDER BY id").all(playerId) as {id:number}[])
            .map(row => row.id).filter(id => isWeaponRivenRevealCandidate(id))
        const slots = (loadout.abilitySoulIds ?? []).slice(0,3)
        const convertedSlots: number[] = [], consumedIds: number[] = []
        for (let slot=0; slot<slots.length; slot++) {
            const cardId = slots[slot]
            if (!isUnknownWeaponRivenItemId(cardId) || (getPlayerItemSync(playerId,cardId) ?? 0) < 1) continue
            // Themed cards reveal from their pool: owned pool weapons first, otherwise the whole pool.
            const theme = cardId === UNKNOWN_RIVEN_ITEM_ID ? undefined : getWeaponRivenTheme(cardId)
            let candidates = owned
            if (theme) {
                const pool = getWeaponRivenThemePool(theme)
                const ownedPool = pool.filter(id => owned.includes(id))
                candidates = ownedPool.length > 0 ? ownedPool : theme.fallback === "pool" ? pool : []
            }
            if (candidates.length === 0) continue
            const u = random()
            if (!Number.isFinite(u) || u < 0 || u >= 1) throw new Error("Random source must return [0,1)")
            const weaponId = candidates[Math.floor(u*candidates.length)]
            const affixes = rollWeaponRivenQualities(weaponId, random)
            const granted = grantWeaponRivenSync(playerId,weaponId,affixes,`${sourceKey}:slot:${slot}`,random,3)
            const debit = db.prepare("UPDATE players_items SET amount=amount-1 WHERE player_id=? AND id=? AND amount>=1").run(playerId,cardId)
            if (debit.changes !== 1) throw new Error("Unknown riven balance changed inside settlement")
            convertedSlots.push(slot)
            consumedIds.push(cardId)
            Object.assign(result.weapon_riven_list, granted.weapon_riven_list)
            result.weapon_riven_granted.push(...granted.weapon_riven_granted)
            result.weapon_riven_auto_dismantled.push(...granted.weapon_riven_auto_dismantled)
            Object.assign(result.item_list, granted.item_list)
            result.item_list[cardId] = getPlayerItemSync(playerId,cardId) ?? 0
        }
        if (convertedSlots.length > 0) {
            // Plain-unknown-only battles keep the historical numeric call shape.
            const remaining = consumedIds.every(id => id === UNKNOWN_RIVEN_ITEM_ID)
                ? result.item_list[UNKNOWN_RIVEN_ITEM_ID]
                : Object.fromEntries([...new Set(consumedIds)].map(id => [id, result.item_list[id]]))
            result.party_info_list = getWeaponRivenPartyInfoListSync(playerId,
                cleanupConvertedUnknownWeaponRivenPartiesSync(playerId, remaining,
                    loadout.partyId, convertedSlots, consumedIds))
        }
        insertPlayerOperationReceiptSync({playerId,operation:"weapon_riven_convert",requestKey:sourceKey,response:result})
        return result
    })
}
