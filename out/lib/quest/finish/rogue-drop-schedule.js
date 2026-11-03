"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveRogueRoundDrops = exports.shouldRollRogueFolderRandomReward = void 0;
function appliesToRound(drop, rushEventRound) {
    if ((drop === null || drop === void 0 ? void 0 : drop.rounds) !== undefined) {
        if (!Array.isArray(drop.rounds) || drop.rounds.length < 2)
            return false;
        const minRound = Math.floor(Number(drop.rounds[0]));
        const maxRound = Math.floor(Number(drop.rounds[1]));
        if (!Number.isInteger(minRound) || !Number.isInteger(maxRound))
            return false;
        if (rushEventRound < Math.min(minRound, maxRound)
            || rushEventRound > Math.max(minRound, maxRound))
            return false;
    }
    const excluded = Array.isArray(drop === null || drop === void 0 ? void 0 : drop.exclude_rounds)
        ? drop.exclude_rounds.map(Number)
        : [];
    return !excluded.includes(rushEventRound);
}
function resolveChance(value, rushEventRound) {
    var _a, _b;
    if (value === undefined)
        return null;
    if (typeof value === "number") {
        return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    }
    if (value === null || typeof value !== "object")
        return 0;
    const curve = value;
    const start = Number(curve.start);
    const perRound = Number((_a = curve.per_round) !== null && _a !== void 0 ? _a : 0);
    const baseRound = Number((_b = curve.base_round) !== null && _b !== void 0 ? _b : rushEventRound);
    if (![start, perRound, baseRound].every(Number.isFinite))
        return 0;
    return Math.max(0, Math.min(1, start + (rushEventRound - baseRound) * perRound));
}
/**
 * Resolves an optional chance on a final-folder random reward entry.  Existing
 * entries without `chance` remain unconditional; the caller supplies a
 * deterministic random function in tests when needed.
 */
function shouldRollRogueFolderRandomReward(value, random = Math.random) {
    if (value === undefined)
        return true;
    const chance = Number(value);
    if (!Number.isFinite(chance) || chance <= 0)
        return false;
    if (chance >= 1)
        return true;
    return random() < chance;
}
exports.shouldRollRogueFolderRandomReward = shouldRollRogueFolderRandomReward;
/**
 * Resolves the independent reward slots for one Rush round.
 *
 * Legacy entries without slot controls remain one guaranteed drop. New
 * entries may declare `slots`, `guaranteed_slots`, and either a numeric
 * `chance` or a `{start, per_round, base_round}` curve. Every optional slot
 * rolls independently. `additional_reward_index_start` assigns stable client
 * result-table indices to the expanded slots.
 */
function resolveRogueRoundDrops(config, rushEventRound, random = Math.random) {
    const drops = Array.isArray(config === null || config === void 0 ? void 0 : config.per_round_drops) ? config.per_round_drops : [];
    const resolved = [];
    for (const drop of drops) {
        if (!appliesToRound(drop, rushEventRound))
            continue;
        const slotsRaw = (drop === null || drop === void 0 ? void 0 : drop.slots) === undefined ? 1 : Number(drop.slots);
        const slots = Number.isInteger(slotsRaw) && slotsRaw > 0 ? slotsRaw : 0;
        if (slots === 0)
            continue;
        const chance = resolveChance(drop === null || drop === void 0 ? void 0 : drop.chance, rushEventRound);
        const guaranteedRaw = (drop === null || drop === void 0 ? void 0 : drop.guaranteed_slots) === undefined
            ? (chance === null ? slots : 0)
            : Number(drop.guaranteed_slots);
        const guaranteed = Number.isInteger(guaranteedRaw)
            ? Math.max(0, Math.min(slots, guaranteedRaw))
            : 0;
        const indexStart = Number(drop === null || drop === void 0 ? void 0 : drop.additional_reward_index_start);
        for (let slot = 0; slot < slots; slot++) {
            if (slot >= guaranteed && !(random() < (chance !== null && chance !== void 0 ? chance : 0)))
                continue;
            const copy = Object.assign({}, drop);
            delete copy.rounds;
            delete copy.exclude_rounds;
            delete copy.slots;
            delete copy.guaranteed_slots;
            delete copy.chance;
            delete copy.additional_reward_index_start;
            if (Number.isInteger(indexStart) && indexStart > 0) {
                copy.additional_reward_index = indexStart + slot;
            }
            resolved.push(copy);
        }
    }
    return resolved;
}
exports.resolveRogueRoundDrops = resolveRogueRoundDrops;
