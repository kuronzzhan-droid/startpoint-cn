import { updatePlayerEquipmentSync } from "../data/domains/equipment"
import { getCharacterDataSync } from "../lib/assets"
import { givePlayerCharactersExpSync } from "../lib/character"
import {
    MODE_API_VERSION,
    type ModeHost,
    type ModeTransactionHost,
} from "./registry"

function legacyTableUnavailable<T>(tableName: string): T {
    throw new Error(
        `[MODE_HOST_TABLE_UNAVAILABLE] legacy server has no content table registry: ${tableName}`,
    )
}

export function createModeHost(log: (message: string) => void): ModeHost {
    return Object.freeze({
        apiVersion: MODE_API_VERSION,
        table: legacyTableUnavailable,
        log,
    })
}

export function createModeTransactionHost(
    log: (message: string) => void,
): ModeTransactionHost {
    return Object.freeze({
        ...createModeHost(log),
        server: Object.freeze({
            getCharacterElement: (characterId: number) => {
                const element = Number(getCharacterDataSync(characterId)?.element)
                return Number.isInteger(element) ? element : null
            },
            updatePlayerEquipment: (
                playerId: number,
                equipmentId: number,
                patch: { level: number },
            ) => { updatePlayerEquipmentSync(playerId, equipmentId, patch) },
            givePlayerCharactersExp: (
                playerId: number,
                characterIds: number[],
                amount: number,
            ) => givePlayerCharactersExpSync(playerId, characterIds, amount, false),
        }),
    })
}
