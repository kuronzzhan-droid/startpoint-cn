'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const compiled = process.env.STARPOINT_TEST_COMPILED === '1'
if (!compiled) require('ts-node/register/transpile-only')
const { MAX_FIELD_MANA, readFieldMana, addManaSafe, buildBattleManaRewards, FieldManaValidationError, isFieldManaError }
    = require(`../${compiled ? 'out' : 'src'}/lib/quest/finish/field-mana`)

test('native field mana keeps whole pickups and the signed-int32 boundary, with omitted legacy values zero', () => {
    assert.equal(MAX_FIELD_MANA, 2147483647)
    for (const value of [0, 1, 137, 999999999, MAX_FIELD_MANA]) assert.equal(readFieldMana(value), value)
    assert.equal(readFieldMana(undefined), 0)
    assert.equal(Object.is(readFieldMana(-0), 0), true)
})

test('field mana rejects coercion, fractions, negative and out-of-protocol values', () => {
    for (const value of [null, false, true, '', '0', '137', [], [137], {}, new Number(1),
        -1, -0.5, 0.5, NaN, Infinity, -Infinity, MAX_FIELD_MANA + 1, Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER + 1, 1n, Symbol('mana')]) {
        assert.throws(() => readFieldMana(value), error => error instanceof FieldManaValidationError
            && isFieldManaError(error))
    }
    let coerced = false
    assert.throws(() => readFieldMana({ valueOf() { coerced = true; return 137 } }), FieldManaValidationError)
    assert.equal(coerced, false)
})

test('reward and lifetime sums preserve exact server integers beyond the client field range', () => {
    assert.equal(addManaSafe(), 0)
    assert.equal(addManaSafe(100, readFieldMana(137)), 237)
    assert.equal(addManaSafe(MAX_FIELD_MANA, 1), MAX_FIELD_MANA + 1)
    assert.equal(addManaSafe(Number.MAX_SAFE_INTEGER - 137, 137), Number.MAX_SAFE_INTEGER)
    assert.equal(addManaSafe(Number.MAX_SAFE_INTEGER, 0), Number.MAX_SAFE_INTEGER)
    assert.equal(addManaSafe(1, 2, 3), 6)
})

test('reward and lifetime sums reject overflow and malformed server amounts', () => {
    for (const amounts of [[Number.MAX_SAFE_INTEGER, 1], [Number.MAX_SAFE_INTEGER - 1, 1, 1],
        [1, -1], [0.5, 1], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 1], ['1'], [null], [undefined]]) {
        assert.throws(() => addManaSafe(...amounts), FieldManaValidationError)
    }
})

test('field-mana error identity survives writer serialization without treating other failures as input errors', () => {
    assert.equal(isFieldManaError(JSON.parse(JSON.stringify(new FieldManaValidationError('invalid')))), true)
    for (const error of [null, undefined, {}, new TypeError('invalid'), { code: 'SQLITE_ERROR' },
        { code: 400 }, 'INVALID_FIELD_MANA']) assert.equal(isFieldManaError(error), false)
})

test('native reward fields stay independent, while combined Mode15 display must fit one signed int', () => {
    assert.deepEqual(buildBattleManaRewards(MAX_FIELD_MANA, MAX_FIELD_MANA, false), {
        reward_mana: MAX_FIELD_MANA, field_mana: MAX_FIELD_MANA,
    })
    assert.deepEqual(buildBattleManaRewards(135, MAX_FIELD_MANA - 135, true), {
        reward_mana: 0, field_mana: MAX_FIELD_MANA,
    })
    assert.throws(() => buildBattleManaRewards(135, MAX_FIELD_MANA - 134, true), isFieldManaError)
    assert.throws(() => buildBattleManaRewards(135, MAX_FIELD_MANA, true), isFieldManaError)
    assert.throws(() => buildBattleManaRewards(MAX_FIELD_MANA + 1, 0, false), isFieldManaError)
})
