const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveRogueRoundDrops, shouldRollRogueFolderRandomReward } = require("../out/lib/quest/finish/rogue-drop-schedule");
const config = require("../assets/rogue_event.json").events["700099"];
const extension = require("../assets/rogue_event_cnmod.json").events["700099"];

function sequence(values) {
    let position = 0;
    return () => {
        assert.ok(position < values.length, "random sequence exhausted");
        return values[position++];
    };
}

// Ordinary/EX split adopted in ef6455c6; ordinary rewards retain 70% of the
// preceding expected output (docs/systems/abyss-normal-ex-design.md).
test("rolls round 1 token at 70% and single ticket at 0.7% independently with strict thresholds", () => {
    for (const [rolls, expected] of [
        [[0.7, 0.007], []],
        [[0.7 - Number.EPSILON, 0.007], [[2370099, 1]]],
        [[0.7, 0.007 - Number.EPSILON], [[999013, 9]]],
        [[0, 0], [[2370099, 1], [999013, 9]]],
    ]) {
        assert.deepEqual(resolveRogueRoundDrops(config, 1, sequence(rolls))
            .map(drop => [drop.id, drop.additional_reward_index]), expected);
    }
});

test("uses remapped independent token slots and a 0.7 percentage-point late-floor curve", () => {
    const round16 = resolveRogueRoundDrops(config, 16,
        sequence([0.8, 0.357 - Number.EPSILON, 0.357, 0.007 + 15 * 0.0035]));
    assert.deepEqual(round16.map(drop => [drop.id, drop.additional_reward_index]), [
        [2370099, 1], [2370099, 2], [2370099, 5],
    ]);

    const lateChance = 0.392 + 8 * 0.007;
    const round29 = resolveRogueRoundDrops(
        config,
        29,
        sequence([0.5 - Number.EPSILON, lateChance - Number.EPSILON, lateChance, 0, 0.007 + 28 * 0.0035]),
    );
    assert.deepEqual(round29.map(drop => [drop.id, drop.additional_reward_index]), [
        [2370099, 1], [2370099, 2], [2370099, 3], [2370099, 4],
        [2370099, 6], [2370099, 8],
    ]);
});

test("replaces the single ticket with the floor-specific ten-ticket roll every 5 floors", () => {
    for (const [round, chance, tokenRolls] of [[5, 0.007, 3], [10, 0.014, 3], [15, 0.021, 3], [20, 0.028, 3], [25, 0.035, 4]]) {
        for (const [roll, hit] of [[chance - Number.EPSILON, true], [chance, false]]) {
            const drops = resolveRogueRoundDrops(config, round, sequence([...Array(tokenRolls).fill(1), roll]));
            assert.equal(drops.some(drop => drop.id === 999013), false, `round ${round} excludes the single ticket`);
            assert.deepEqual(drops.filter(drop => drop.id === 999014).map(drop => [drop.count, drop.additional_reward_index]),
                hit ? [[1, 10]] : [], `round ${round} ten-ticket threshold`);
        }
    }
});

test("preserves ordinary token guarantees and maximum independent slots at every schedule boundary", () => {
    for (const [round, minimum, maximum] of [[1, 0, 1], [2, 2, 5], [10, 2, 5], [11, 2, 5],
        [14, 2, 5], [15, 2, 5], [16, 2, 5], [20, 2, 5], [21, 3, 7], [29, 3, 7]]) {
        for (const [roll, expected] of [[1, minimum], [0, maximum]]) {
            const tokens = resolveRogueRoundDrops(config, round, () => roll).filter(drop => drop.id === 2370099);
            assert.equal(tokens.length, expected, `round ${round}, random ${roll}`);
            assert.equal(new Set(tokens.map(drop => drop.additional_reward_index)).size, tokens.length);
            assert.ok(tokens.every(drop => drop.count === 1));
        }
    }
});

test("does not attach per-round drops to the final floor", () => {
    assert.deepEqual(resolveRogueRoundDrops(config, 30, () => assert.fail("final floor must not roll per-round slots")), []);
});

test("keeps the final ten-ticket chance identical across base and CN extension configs", () => {
    const base = config.folder_clear_chance.find(reward => reward.id === 999014);
    const extra = extension.folder_clear_chance.find(reward => reward.id === 999014);
    assert.deepEqual(extra, base);
    assert.equal(base.chance, 0.07);
    assert.equal(shouldRollRogueFolderRandomReward(base.chance, () => 0.07 - Number.EPSILON), true);
    assert.equal(shouldRollRogueFolderRandomReward(base.chance, () => 0.07), false);
});
