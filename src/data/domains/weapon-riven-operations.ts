import { randomUUID } from "crypto"
import { getDb } from "../db"
import { getPlayerItemSync, givePlayerItemSync } from "./item"
import { getPlayerWeaponRivenSync, getPlayerWeaponRivenRowSync } from "./weaponRiven"
import { getPlayerOperationReceiptSync, insertPlayerOperationReceiptSync } from "./player-operation-receipt"
import { runPersistenceTransactionSync } from "../../lib/persistence-coordinator"
import { getWeaponRivenDismantleReward, rollWeaponRivenQualities, rerollWeaponRivenQualities, weaponRivenRuleSet } from "../../lib/weapon-riven/rules"
import { WeaponRivenChanges, WeaponRivenError } from "../../lib/weapon-riven/model"

export interface WeaponRivenOperationResult extends WeaponRivenChanges {
    weapon_riven_conflict?: true
    reason?: "riven_changed" | "battle_in_progress" | "locked" | "cost" | "pending"
}
function inBattle(playerId: number): boolean {
    return !!getDb().prepare("SELECT 1 FROM players_active_quests WHERE player_id=?").get(playerId)
}
function changes(playerId: number, itemId: number): WeaponRivenChanges {
    const riven = getPlayerWeaponRivenSync(playerId,itemId)
    return {weapon_riven_list:riven ? {[itemId]:riven} : {}, weapon_riven_deleted:riven ? [] : [itemId],
        item_list:{[itemId]:riven ? 1 : 0}}
}
function conflict(playerId: number, itemId: number, reason: WeaponRivenOperationResult["reason"]): WeaponRivenOperationResult {
    return {...changes(playerId,itemId),weapon_riven_conflict:true,reason}
}
/** Refresh every supported balance even when a retry changes its requested payment item. */
function drawChanges(playerId: number, itemId: number, reason?: WeaponRivenOperationResult["reason"]): WeaponRivenOperationResult {
    const result = reason ? conflict(playerId,itemId,reason) : changes(playerId,itemId)
    for (const { item_id } of weaponRivenRuleSet.rules.reroll.cost_items) {
        result.item_list[item_id] = getPlayerItemSync(playerId,item_id) ?? 0
    }
    return result
}
export function drawWeaponRivenSync(
    playerId: number, itemId: number, rivenId: number, revision: number,
    random?: () => number, requestKey?: string, costItemId?: unknown, mode: "full" | "values" = "full",
): WeaponRivenOperationResult {
    if (mode !== "full" && mode !== "values") throw new WeaponRivenError("invalid_argument", "Invalid weapon riven draw mode")
    return runPersistenceTransactionSync({domain:"player",playerId,operation:"weapon_riven_draw"}, () => {
        const riven = getPlayerWeaponRivenSync(playerId,itemId)
        // Validate the permanent identity before receipts: item slots are reused.
        if (!riven || riven.riven_id !== rivenId) return drawChanges(playerId,itemId,"riven_changed")
        const prior = requestKey ? getPlayerOperationReceiptSync(playerId,"weapon_riven_draw",requestKey) : null
        if (prior) return drawChanges(playerId,itemId)
        // A retried draw recovers the durable choice without another debit.
        if (!riven.pending) {
            if (inBattle(playerId)) return drawChanges(playerId,itemId,"battle_in_progress")
            if (riven.revision !== revision) return drawChanges(playerId,itemId,"riven_changed")
            // Only an absent field selects the default; all other values must match a configured ID exactly.
            const cost = costItemId === undefined ? riven.cost_options[0]
                : riven.cost_options.find(([id]) => id === costItemId)
            if (!cost) return drawChanges(playerId,itemId,"cost")
            const [currencyId, amount] = cost
            const debit = getDb().prepare(`UPDATE players_items SET amount=amount-?
                WHERE player_id=? AND id=? AND amount>=?`).run(amount,playerId,currencyId,amount)
            if (debit.changes !== 1) return drawChanges(playerId,itemId,"cost")
            const affixes = mode === "values"
                ? rerollWeaponRivenQualities(JSON.parse(getPlayerWeaponRivenRowSync(playerId,itemId)!.affixes_json),random)
                : rollWeaponRivenQualities(riven.weapon_id, random)
            getDb().prepare(`UPDATE player_weapon_rivens SET roll_count=roll_count+1,revision=revision+1,
                pending_json=?,updated_at=? WHERE player_id=? AND item_id=?`)
                .run(JSON.stringify({draw_id:randomUUID(),affixes,affix_version:3}),new Date().toISOString(),playerId,itemId)
        }
        if (requestKey) insertPlayerOperationReceiptSync({playerId,operation:"weapon_riven_draw",requestKey,
            response:{itemId,rivenId:riven.riven_id}})
        return drawChanges(playerId,itemId)
    })
}
export function selectWeaponRivenSync(playerId: number, itemId: number, rivenId: number, drawId: string, confirm: boolean): WeaponRivenOperationResult {
    return runPersistenceTransactionSync({domain:"player",playerId,operation:"weapon_riven_select"}, () => {
        const current = getPlayerWeaponRivenSync(playerId,itemId)
        if (!current || current.riven_id !== rivenId) return conflict(playerId,itemId,"riven_changed")
        const prior = getPlayerOperationReceiptSync<{itemId:number;rivenId:number;isConfirm:boolean}>(playerId,"weapon_riven_select",drawId)
        if (prior) {
            if (prior.response.itemId !== itemId) throw new WeaponRivenError("draw_mismatch", "Draw belongs to another item")
            // A portable snapshot can bring back the pending draw after its
            // server-local receipt was committed. Replay the original decision
            // to consume it, while never touching a later draw or reused slot.
            if (current?.pending?.draw_id !== drawId || current.riven_id !== prior.response.rivenId) return changes(playerId,itemId)
            confirm = prior.response.isConfirm
        }
        const riven = current
        if (riven.pending?.draw_id !== drawId) throw new WeaponRivenError("draw_mismatch", "No matching pending draw",409)
        if (inBattle(playerId)) return conflict(playerId,itemId,"battle_in_progress")
        const row = getPlayerWeaponRivenRowSync(playerId,itemId)!
        const pending = JSON.parse(row.pending_json!)
        getDb().prepare(`UPDATE player_weapon_rivens SET affixes_json=?,affix_version=?,pending_json=NULL,
            revision=revision+1,updated_at=? WHERE player_id=? AND item_id=?`)
            .run(confirm ? JSON.stringify(pending.affixes) : row.affixes_json,
                confirm ? pending.affix_version ?? 1 : row.affix_version,new Date().toISOString(),playerId,itemId)
        if (!prior) insertPlayerOperationReceiptSync({playerId,operation:"weapon_riven_select",requestKey:drawId,
            response:{itemId,rivenId:riven.riven_id,isConfirm:confirm}})
        return changes(playerId,itemId)
    })
}

export interface WeaponRivenDismantleResult extends WeaponRivenOperationResult {
    changed_parties: Array<{category:number;group_id:number;slot:number}>
}
function dismantleChanges(playerId: number, itemId: number, previousItems: Record<string, number> = {}): WeaponRivenChanges {
    const current = changes(playerId,itemId)
    const rewardItemId = weaponRivenRuleSet.rules.dismantle_return.item_id
    const ids = new Set(Object.keys(previousItems))
    if (rewardItemId !== null) ids.add(String(rewardItemId))
    for (const id of ids) {
        if (Number(id) !== itemId) current.item_list[id] = getPlayerItemSync(playerId,id) ?? 0
    }
    return current
}
/** Delete one card and every saved reference to it; equipped cards may be dismantled. */
function removeWeaponRivenSync(playerId: number, itemId: number): WeaponRivenDismantleResult["changed_parties"] {
    const db = getDb()
    const changed = db.prepare(`SELECT category,group_id,slot FROM players_parties
        WHERE player_id=? AND (ability_soul_1=? OR ability_soul_2=? OR ability_soul_3=?)`)
        .all(playerId,itemId,itemId,itemId) as WeaponRivenDismantleResult["changed_parties"]
    db.prepare(`UPDATE players_parties SET
        ability_soul_1=CASE WHEN ability_soul_1=? THEN NULL ELSE ability_soul_1 END,
        ability_soul_2=CASE WHEN ability_soul_2=? THEN NULL ELSE ability_soul_2 END,
        ability_soul_3=CASE WHEN ability_soul_3=? THEN NULL ELSE ability_soul_3 END
        WHERE player_id=? AND (ability_soul_1=? OR ability_soul_2=? OR ability_soul_3=?)`)
        .run(itemId,itemId,itemId,playerId,itemId,itemId,itemId)
    // Saved battle teams can be offered again by history/recommendation UI.
    for (const table of ["players_rush_events_played_parties","players_practice_battle_history"]) {
        for (let slot=1; slot<=3; slot++) {
            db.prepare(`UPDATE ${table} SET ability_soul_id_${slot}=NULL WHERE player_id=? AND ability_soul_id_${slot}=?`).run(playerId,itemId)
        }
    }
    db.prepare("DELETE FROM player_weapon_rivens WHERE player_id=? AND item_id=?").run(playerId,itemId)
    return changed
}
export function dismantleWeaponRivenSync(playerId: number, itemId: number, rivenId: number, requestKey: string): WeaponRivenDismantleResult {
    return runPersistenceTransactionSync({domain:"player",playerId,operation:"weapon_riven_dismantle"}, () => {
        const riven = getPlayerWeaponRivenSync(playerId,itemId)
        // Deleted/reused identities still conflict, but always refresh the material balance.
        if (!riven || riven.riven_id !== rivenId) return {...dismantleChanges(playerId,itemId),
            weapon_riven_conflict:true,reason:"riven_changed",changed_parties:[]}
        if (riven.locked) return {...dismantleChanges(playerId,itemId),
            weapon_riven_conflict:true,reason:"locked",changed_parties:[]}
        const prior = getPlayerOperationReceiptSync<Partial<WeaponRivenDismantleResult>>(playerId,"weapon_riven_dismantle",requestKey)
        if (prior) {
            // Old zero-refund receipts and restored card snapshots must never grant retroactively.
            return {...dismantleChanges(playerId,itemId,prior.response.item_list),
                changed_parties:prior.response.changed_parties ?? []}
        }
        if (inBattle(playerId)) return {...dismantleChanges(playerId,itemId),
            weapon_riven_conflict:true,reason:"battle_in_progress",changed_parties:[]}
        const refund = getWeaponRivenDismantleReward(riven.affixes.length,riven.roll_count)
        if (refund && !Number.isSafeInteger((getPlayerItemSync(playerId,refund.itemId) ?? 0) + refund.amount)) {
            throw new RangeError("Weapon riven dismantle inventory amount exceeds the safe integer range.")
        }
        const changed = removeWeaponRivenSync(playerId,itemId)
        const result: WeaponRivenDismantleResult = {...dismantleChanges(playerId,itemId),changed_parties:changed}
        if (refund && refund.amount > 0) result.item_list[refund.itemId] = givePlayerItemSync(playerId,refund.itemId,refund.amount)
        insertPlayerOperationReceiptSync({playerId,operation:"weapon_riven_dismantle",requestKey,response:result})
        return result
    })
}

export interface WeaponRivenBatchDismantleRequestItem { item_id: number; revision: number; riven_id?: number }
export interface WeaponRivenBatchDismantleResult extends WeaponRivenOperationResult {
    changed_parties: WeaponRivenDismantleResult["changed_parties"]
    dismantle_return_total: [number, number][]
    weapon_riven_conflict_items?: number[]
}

/**
 * Batch dismantle (author 2026-10-27 15:34): all-or-nothing. Every item is checked like a single dismantle
 * (owned revealed card, matching revision and optional riven_id, not locked, no pending draw, no battle);
 * any failure returns HTTP 200 with weapon_riven_conflict and changes nothing.
 */
export function dismantleWeaponRivensBatchSync(
    playerId: number, items: readonly WeaponRivenBatchDismantleRequestItem[], requestKey: string,
): WeaponRivenBatchDismantleResult {
    return runPersistenceTransactionSync({domain:"player",playerId,operation:"weapon_riven_dismantle_batch"}, () => {
        const ids = items.map(item => item.item_id)
        if (ids.length < 1 || ids.length > 20 || new Set(ids).size !== ids.length) {
            throw new WeaponRivenError("invalid_argument", "Batch must name 1-20 distinct weapon rivens")
        }
        const rewardItemId = weaponRivenRuleSet.rules.dismantle_return.item_id
        const snapshot = (deleted: number[] = []): WeaponRivenChanges => {
            const result: WeaponRivenChanges = {weapon_riven_list:{},weapon_riven_deleted:[],item_list:{}}
            for (const id of new Set([...ids, ...deleted])) {
                const change = changes(playerId,id)
                Object.assign(result.weapon_riven_list,change.weapon_riven_list)
                Object.assign(result.item_list,change.item_list)
                result.weapon_riven_deleted.push(...change.weapon_riven_deleted)
            }
            if (rewardItemId !== null) result.item_list[rewardItemId] = getPlayerItemSync(playerId,rewardItemId) ?? 0
            return result
        }
        const reject = (reason: WeaponRivenOperationResult["reason"], failed: number[]): WeaponRivenBatchDismantleResult =>
            ({...snapshot(),weapon_riven_conflict:true,reason,weapon_riven_conflict_items:failed,changed_parties:[],dismantle_return_total:[]})
        const prior = getPlayerOperationReceiptSync<WeaponRivenBatchDismantleResult>(playerId,"weapon_riven_dismantle_batch",requestKey)
        if (prior) {
            // A genuine retry finds every card already gone. A card present again (restored save, or a
            // reused slot) was not dismantled by that receipt: never report its old success.
            const present = ids.filter(id => getPlayerWeaponRivenSync(playerId,id) !== null)
            if (present.length) return reject("riven_changed",present)
            return {...snapshot(prior.response.weapon_riven_deleted),changed_parties:prior.response.changed_parties ?? [],
                dismantle_return_total:prior.response.dismantle_return_total ?? []}
        }
        if (inBattle(playerId)) return reject("battle_in_progress",ids)
        const cards = items.map(item => ({item, riven:getPlayerWeaponRivenSync(playerId,item.item_id)}))
        const failed = (test: (card: typeof cards[number]) => boolean) => cards.filter(test).map(card => card.item.item_id)
        for (const [reason, test] of [
            ["riven_changed", (card: typeof cards[number]) => !card.riven || card.riven.revision !== card.item.revision
                || (card.item.riven_id !== undefined && card.riven.riven_id !== card.item.riven_id)],
            ["locked", (card: typeof cards[number]) => !!card.riven!.locked],
            ["pending", (card: typeof cards[number]) => card.riven!.pending !== null],
        ] as const) {
            const bad = failed(test)
            if (bad.length) return reject(reason,bad)
        }
        let amount = 0
        for (const {riven} of cards) amount += getWeaponRivenDismantleReward(riven!.affixes.length,riven!.roll_count)?.amount ?? 0
        if (rewardItemId !== null && !Number.isSafeInteger((getPlayerItemSync(playerId,rewardItemId) ?? 0) + amount)) {
            throw new RangeError("Weapon riven dismantle inventory amount exceeds the safe integer range.")
        }
        const parties: WeaponRivenBatchDismantleResult["changed_parties"] = []
        for (const id of ids) for (const party of removeWeaponRivenSync(playerId,id)) {
            if (!parties.some(other => other.category === party.category && other.group_id === party.group_id
                && other.slot === party.slot)) parties.push(party)
        }
        if (rewardItemId !== null && amount > 0) givePlayerItemSync(playerId,rewardItemId,amount)
        const result: WeaponRivenBatchDismantleResult = {...snapshot(),changed_parties:parties,
            dismantle_return_total:rewardItemId !== null && amount > 0 ? [[rewardItemId,amount]] : []}
        insertPlayerOperationReceiptSync({playerId,operation:"weapon_riven_dismantle_batch",requestKey,response:result})
        return result
    })
}

/** State-setting operations are idempotent without storing a request receipt. */
export function lockWeaponRivenSync(playerId: number, itemId: number, rivenId: number, locked: 0 | 1): WeaponRivenOperationResult {
    return runPersistenceTransactionSync({domain:"player",playerId,operation:"weapon_riven_lock"}, () => {
        const riven = getPlayerWeaponRivenSync(playerId,itemId)
        if (!riven || riven.riven_id !== rivenId) return conflict(playerId,itemId,"riven_changed")
        if (riven.locked === locked) return changes(playerId,itemId)
        if (inBattle(playerId)) return conflict(playerId,itemId,"battle_in_progress")
        getDb().prepare(`UPDATE player_weapon_rivens SET locked=?,revision=revision+1,updated_at=?
            WHERE player_id=? AND item_id=?`).run(locked,new Date().toISOString(),playerId,itemId)
        return changes(playerId,itemId)
    })
}

export function markWeaponRivensSeenSync(playerId: number, itemIds: readonly number[]): WeaponRivenOperationResult {
    return runPersistenceTransactionSync({domain:"player",playerId,operation:"weapon_riven_seen"}, () => {
        const ids = [...new Set(itemIds)]
        const collect = (): WeaponRivenOperationResult => {
            const result: WeaponRivenOperationResult = {weapon_riven_list:{},weapon_riven_deleted:[],item_list:{}}
            for (const id of ids) {
                const change = changes(playerId,id)
                Object.assign(result.weapon_riven_list,change.weapon_riven_list)
                Object.assign(result.item_list,change.item_list)
                result.weapon_riven_deleted.push(...change.weapon_riven_deleted)
            }
            return result
        }
        const before = collect()
        const unseen = Object.entries(before.weapon_riven_list).filter(([,riven]) => riven.seen === 0)
        if (!unseen.length) return before
        if (inBattle(playerId)) return {...before,weapon_riven_conflict:true,reason:"battle_in_progress"}
        const update = getDb().prepare(`UPDATE player_weapon_rivens SET seen=1,revision=revision+1,updated_at=?
            WHERE player_id=? AND item_id=? AND seen=0`)
        const now = new Date().toISOString()
        for (const [id] of unseen) update.run(now,playerId,Number(id))
        return collect()
    })
}
