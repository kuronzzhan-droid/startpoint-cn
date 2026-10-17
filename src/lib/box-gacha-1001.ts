import metadata from "../../assets/box_gacha_1001_settings.json"

// Original master/box_gacha/{box_gacha,box}.orderedmap rows for 1001.
// This policy intentionally applies only to the ended Golden Week activity.
export const BOX_GACHA_1001_ID = 1001

interface Box1001Settings {
    requiredBoxId: number | null
    resetKind: number
    resetLimit: number | null
    closeKind: number
    availableFrom: string
    availableUntil: string
}

function epochSeconds(value: string): number {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
        throw new Error("Invalid 1001 box availability date.")
    }
    const seconds = Date.parse(value.replace(" ", "T") + metadata.timeZoneOffset) / 1000
    if (!Number.isSafeInteger(seconds)) throw new Error("Invalid 1001 box availability date.")
    return seconds
}

if (metadata.boxGachaId !== BOX_GACHA_1001_ID || metadata.timeZoneOffset !== "+08:00"
    || Object.keys(metadata.boxSettings).length !== 9) {
    throw new Error("Invalid 1001 box metadata.")
}

const activityFrom = epochSeconds(metadata.availableFrom)
const activityUntil = epochSeconds(metadata.availableUntil)
if (activityFrom > activityUntil) throw new Error("Invalid 1001 activity period.")
const settings = new Map<number, Readonly<Box1001Settings>>()
const periods = new Map<number, Readonly<{ from: number; until: number }>>()
for (const [boxId, value] of Object.entries(metadata.boxSettings)) {
    const id = Number(boxId)
    if (!Number.isSafeInteger(id) || id < 1 || id > 9
        || (value.requiredBoxId !== null && (!Number.isSafeInteger(value.requiredBoxId)
            || value.requiredBoxId < 1 || value.requiredBoxId >= id))
        || value.resetKind !== 0 || value.resetLimit !== null || value.closeKind !== 0) {
        throw new Error("Invalid 1001 box settings.")
    }
    const from = Math.max(activityFrom, epochSeconds(value.availableFrom))
    const until = Math.min(activityUntil, epochSeconds(value.availableUntil))
    if (from > until) throw new Error("Invalid 1001 box period.")
    settings.set(id, Object.freeze({ ...value }))
    periods.set(id, Object.freeze({ from, until }))
}

export function getBoxGacha1001Settings(boxId: number): Readonly<Box1001Settings> | null {
    return settings.get(boxId) ?? null
}

/** Match the client's inclusive, whole-second availability boundaries. */
export function getBoxGacha1001PeriodError(boxId: number, nowSeconds: number): string | null {
    const period = periods.get(boxId)
    if (period === undefined) return "Missing box availability settings."
    if (!Number.isSafeInteger(nowSeconds) || nowSeconds < period.from || nowSeconds > period.until) {
        return "Box gacha is outside its availability period."
    }
    return null
}
