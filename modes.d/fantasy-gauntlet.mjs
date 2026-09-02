/**
 * Fantasy Gauntlet package identity and solo-entry guard.
 *
 * The 15-round runtime (rush order gate, multiplayer settlement, room gate)
 * lives in the server capability `fantasy-gauntlet.multiplayer-runtime@1`;
 * this module must fail closed when that capability is absent.  Its sidecar
 * controls only activation of the solo entry guard, which keeps players out of
 * the AdventEvent 300098 boss rounds through the single-battle route.
 *
 * The server enforces the same rejection on its own — this module is the
 * operator-visible half of that rule, not its only line of defence.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const modeManifest = Object.freeze({
    apiVersion: 1,
    name: "fantasy-gauntlet",
    capability: "fantasy-gauntlet.package-identity@1",
    capabilities: Object.freeze(["fantasy-gauntlet.solo-entry-guard@1"]),
    requiresServerCapabilities: Object.freeze([
        "fantasy-gauntlet.multiplayer-runtime@1",
    ]),
})

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = "fantasy-gauntlet.config.json"

function readActiveConfig() {
    let parsed
    try {
        parsed = JSON.parse(readFileSync(join(MODULE_DIR, CONFIG_FILE), "utf8"))
    } catch {
        return null
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
    return parsed.enabled === true ? parsed : null
}

function guardedIds(config) {
    if (!Array.isArray(config.guarded_quest_ids)) return null
    const ids = new Set()
    for (const value of config.guarded_quest_ids) {
        const id = Number(value)
        if (Number.isInteger(id)) ids.add(id)
    }
    return ids.size === 0 ? null : ids
}

export function register() {
    return {
        onQuestStart({ questId, questCategory }, host) {
            const config = readActiveConfig()
            if (config === null || config.solo_entry !== "reject") return
            const ids = guardedIds(config)
            if (ids === null || !ids.has(Number(questId))) return
            if (Number(questCategory) !== Number(config.quest_category ?? 7)) return
            host.log(
                `[fantasy-gauntlet] vetoed solo entry quest=${String(questId)}`,
            )
            throw new Error(
                typeof config.reject_message === "string" && config.reject_message !== ""
                    ? config.reject_message
                    : "幻想连战的联机关卡请从联机房间进入。",
            )
        },
    }
}
