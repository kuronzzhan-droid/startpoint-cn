/** Native BattleClearParameter.obtainedMana is an ActionScript signed int. */
export const MAX_FIELD_MANA = 0x7fffffff;

export class FieldManaValidationError extends TypeError {
    readonly code = "INVALID_FIELD_MANA";

    constructor(message: string) {
        super(message);
        this.name = "FieldManaValidationError";
    }
}

export function isFieldManaError(error: unknown): error is FieldManaValidationError {
    return typeof error === "object" && error !== null
        && (error as { code?: unknown }).code === "INVALID_FIELD_MANA";
}

/** Older requests may omit field mana; supplied values never undergo coercion. */
export function readFieldMana(value: unknown): number {
    if (value === undefined) return 0;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_FIELD_MANA) {
        throw new FieldManaValidationError("Field mana must be a non-negative signed 32-bit integer.");
    }
    return value === 0 ? 0 : value;
}

/** Quest rewards and lifetime counters use the wider server safe-integer range. */
export function addManaSafe(...amounts: number[]): number {
    let total = 0;
    for (const amount of amounts) {
        if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
            throw new FieldManaValidationError("Mana amounts must be non-negative safe integers.");
        }
        if (amount > Number.MAX_SAFE_INTEGER - total) {
            throw new FieldManaValidationError("Mana reward total exceeds the safe integer range.");
        }
        total += amount;
    }
    return total;
}

/** Native finish parsing reads each displayed reward as a signed int. */
export function buildBattleManaRewards(base: number, field: number, displayAsField: boolean) {
    const reward = readFieldMana(base);
    const collected = readFieldMana(field);
    return {
        reward_mana: displayAsField ? 0 : reward,
        field_mana: displayAsField ? readFieldMana(addManaSafe(reward, collected)) : collected,
    };
}
