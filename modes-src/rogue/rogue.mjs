/**
 * Roguelike rush mode — installable mode module (fork/dev-base seam).
 *
 * Grants configured per-round loot (weapons / souls / characters / items)
 * after every cleared rush round. Everything is gated by the CDN table
 * `rogue_event.json` (custom-json converter, logical path
 * master/custom/rogue_event.orderedmap): absent or `enabled:false` means the
 * module does nothing at all, so installing it without the content is inert.
 *
 * Install: copy this file to modes.d/, register its sha256 in
 * modes.d/modes-allowlist.json, restart. See mode-manifest.json.
 */

// Client-side kind values accepted by RushEventLogic.rewardListToGeneralRewardKinds
// (anything else throws ClientError 3446): 1=Item, 5=Character, 6=Equipment.
const REWARD_LIST_KIND = { item: 1, character: 5, equipment: 6 }
// server RewardType enum values
const REWARD_TYPE = { item: 1, character: 5, equipment: 6 }
const RUSH_EVENT_CATEGORY = 18

function readConfig(host, rushEventId) {
    let table
    try {
        table = host.table("rogue_event.json")
    } catch {
        return null
    }
    if (!table || table.enabled !== true) return null
    const config = table.events?.[String(rushEventId)]
    return config ?? null
}

function pickWeighted(entries) {
    const total = entries.reduce(
        (sum, entry) => sum + (Number(entry?.weight) > 0 ? Number(entry.weight) : 1), 0,
    )
    let roll = Math.random() * total
    for (const entry of entries) {
        roll -= Number(entry?.weight) > 0 ? Number(entry.weight) : 1
        if (roll <= 0) return entry
    }
    return entries[entries.length - 1]
}

function rollDrops(config, host, partyCharacterIds, elementTable) {
    const drops = Array.isArray(config.per_round_drops) ? [...config.per_round_drops] : []
    const pool = Array.isArray(config.drop_pool) ? config.drop_pool : []
    const draws = Math.max(0, Math.floor(Number(config.pool_draws) || 0))
    if (pool.length === 0 || draws === 0) return drops

    // Element matching (default on): souls/weapons hard-gate on element in the
    // client ("属性不同,无法使用"), so restrict rolls to the clearing party's
    // elements plus universal (-1). Falls back to the full pool if empty.
    let candidates = pool
    if (config.match_party_element !== false && Array.isArray(partyCharacterIds)) {
        const partyElements = new Set()
        for (const id of partyCharacterIds) {
            const element = host.server.getCharacterElement(Number(id))
            if (element !== null) partyElements.add(element)
        }
        if (partyElements.size > 0) {
            const filtered = pool.filter(entry => {
                const element = elementTable[String(entry?.id)] ?? -1
                return element === -1 || partyElements.has(element)
            })
            if (filtered.length > 0) candidates = filtered
        }
    }
    // First draw guarantees a weapon (default on) so a round never yields
    // souls only; remaining draws roll the whole candidate set.
    const weapons = candidates.filter(entry => entry?.type === "equipment")
    for (let index = 0; index < draws; index += 1) {
        const source = (index === 0 && config.guarantee_weapon !== false && weapons.length > 0)
            ? weapons
            : candidates
        const picked = pickWeighted(source)
        if (picked !== undefined) drops.push(picked)
    }
    return drops
}

export function register(host) {
    const elementTable = {}
    return {
        name: "rogue-rush",
        capability: "rogue-settlement@1",

        onRushFinish(params) {
            const {
                questCategory, questAccomplished, playerId, questData,
                folderMaxRounds, party, giveRewards, transaction,
            } = params ?? {}
            if (questCategory !== RUSH_EVENT_CATEGORY || !questAccomplished) return null
            const { rushEventId, rushEventFolderId, rushEventRound } = questData ?? {}
            if (rushEventId === undefined
                || rushEventFolderId === undefined
                || rushEventRound === undefined) return null

            const config = readConfig(host, rushEventId)
            if (config === null) return null

            const partyCharacterIds = [
                ...(party?.characters ?? []),
                ...(party?.unison_characters ?? []),
            ].map(entry => Number(entry?.id)).filter(Number.isInteger)

            const rolled = rollDrops(config, host, partyCharacterIds, elementTable)
            const rewards = []
            const rewardListEntries = []
            for (const drop of rolled) {
                const type = REWARD_TYPE[drop?.type]
                const id = Number(drop?.id)
                if (type === undefined || !Number.isInteger(id)) continue
                const count = Math.max(1, Number(drop?.count) || 1)
                rewards.push({ type, id, count })
                rewardListEntries.push({ kind: REWARD_LIST_KIND[drop.type], kind_id: id, number: count })
            }
            if (rewards.length === 0) return null

            const rewardResult = transaction(() => giveRewards(playerId, rewards))
            if (!rewardResult) return null

            // "Finished goods" drops: raise dropped equipment to the configured
            // evolution level, clamped per item to the master cap (the client
            // hard-throws C2284 on out-of-range level). DB row and serialized
            // response entries are patched together so stats apply immediately.
            const equipLevel = Math.max(0, Math.floor(Number(config.drop_equipment_level) || 0))
            if (equipLevel > 0) {
                for (const entry of rewardResult.equipment_list ?? []) {
                    const equipmentId = Number(entry.equipment_id)
                    const target = Math.min(equipLevel, host.server.getEquipmentMaxLevel(equipmentId))
                    if (Number(entry.level) < target) {
                        entry.level = target
                        host.server.updatePlayerEquipment(playerId, equipmentId, { level: target })
                    }
                }
            }

            const dropExp = Number(config.drop_character_exp) || 0
            if (dropExp > 0) {
                const droppedCharacterIds = (rewardResult.character_list ?? [])
                    .map(character => Number(character?.character_id))
                    .filter(Number.isInteger)
                if (droppedCharacterIds.length > 0) {
                    host.server.givePlayerCharactersExp(playerId, droppedCharacterIds, dropExp)
                }
            }

            // Never surface rewards on a non-final folder round: the client
            // treats a stored non-empty clear reward as the folder-clear
            // celebration and replaces the quest select list with the folder's
            // last quest (round skip exploit).
            const isEndless = rushEventRound === 0
            const isFolderFinal = !isEndless
                && rushEventRound >= ((folderMaxRounds ?? {})[rushEventFolderId] ?? 0)
            const show = isFolderFinal || (isEndless && config.show_reward_list_endless !== false)
            return show ? { rush_battle_reward_list: rewardListEntries } : null
        },
    }
}
