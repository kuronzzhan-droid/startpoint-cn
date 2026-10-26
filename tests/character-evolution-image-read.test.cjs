'use strict'

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'character-image-read-'))
process.env.DATA_DIR = directory
process.env.SQL_STATEMENT_CACHE = 'false'
process.env.GAME_ROUTINE_LOGS = 'off'

const { getDb } = require('../out/data/db')
const { insertAccountSync } = require('../out/data/domains/account')
const { insertDefaultPlayerSync } = require('../out/data/domains/player')
const domain = require('../out/data/domains/character')
const { getCharactersEvolutionImgLevels } = require('../out/lib/character')
const db = getDb()
assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
const prepare = db.prepare.bind(db)
let capture = null
db.prepare = function (sql) {
    const statement = prepare(sql)
    return new Proxy(statement, {
        get(target, property) {
            const value = Reflect.get(target, property, target)
            if (typeof value !== 'function') return value
            if (!['all', 'get', 'run'].includes(property)) return value.bind(target)
            return (...args) => {
                const result = value.apply(target, args)
                if (capture) capture.push({ sql: sql.replace(/\s+/g, ' ').trim(), operation: property,
                    rows: property === 'all' ? result.length : property === 'get' ? Number(result !== undefined) : 0 })
                return result
            }
        },
    })
}

let sequence = 0
function player() {
    const account = insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test',
        idpId: `character-image-read-${++sequence}`, status: 'normal' })
    return insertDefaultPlayerSync(account.id).id
}
function character(playerId, id, evolution, illustration) {
    prepare(`INSERT OR REPLACE INTO players_characters (id, player_id, entry_count, evolution_level,
        over_limit_step, protection, join_time, update_time, exp, stack, mana_board_index,
        ex_boost_status_id, ex_boost_ability_id_list, illustration_settings)
        VALUES (?, ?, 1, ?, 0, 0, '2025-01-01', '2025-01-01', 0, 0, 1, NULL, NULL, ?)`)
        .run(id, playerId, evolution, illustration)
}
function legacy(playerId, ids) {
    return ids.map(id => {
        if (id === null) return null
        const row = domain.getPlayerCharacterSync(playerId, id)
        const illustration = row?.illustrationSettings ?? [null]
        return illustration[0] === null ? row?.evolutionLevel ?? 0 : illustration[0]
    })
}
function trace(action) {
    capture = []
    try { return { result: action(), queries: capture } }
    finally { capture = null }
}
function stored() {
    return {
        characters: prepare('SELECT * FROM players_characters ORDER BY player_id, id').all(),
        bonds: prepare('SELECT * FROM players_characters_bond_tokens ORDER BY player_id, character_id, mana_board_index').all(),
    }
}

after(() => {
    db.close()
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir()))
    fs.rmSync(directory, { recursive: true })
})

test('batched image levels preserve the legacy comma parser, defaults and repeated slots', () => {
    const playerId = player()
    const settings = [null, '3', '0', '', '2,4', 'not-a-number', '[1,2]', 'null', Buffer.from('binary')]
    settings.forEach((value, index) => character(playerId, 910000 + index, index + 1, value))
    const ids = [null, 910000, 910001, 910002, 910003, 910004, 910005, 910006, 910007,
        910008, 999999, 910001, null]
    const expected = legacy(playerId, ids)
    const before = stored()
    const { result, queries } = trace(() => getCharactersEvolutionImgLevels(playerId, ids))
    assert.deepEqual(result, expected)
    assert.equal(result[1], 1, 'SQL NULL uses the current evolution level')
    assert.equal(result[4], 0, 'empty text retains comma-parser zero')
    assert.ok(Number.isNaN(result[6]), 'malformed legacy text remains NaN')
    assert.equal(result[10], 0, 'missing owned character retains the old zero fallback')
    assert.equal(result[9], undefined, 'non-string legacy data retains the empty-parser result')
    assert.equal(queries.length, 1)
    assert.match(queries[0].sql, /^SELECT id, evolution_level, illustration_settings FROM players_characters /)
    assert.equal(queries[0].operation, 'all')
    assert.equal(queries.some(row => row.sql.includes('bond_tokens')), false)
    assert.deepEqual(stored(), before, 'reading images changes neither characters nor bonds')
})

test('empty and null-only slots do not query SQLite', () => {
    const playerId = player()
    for (const ids of [[], [null, null, null]]) {
        const { result, queries } = trace(() => getCharactersEvolutionImgLevels(playerId, ids))
        assert.deepEqual(result, ids)
        assert.deepEqual(queries, [])
    }
})

test('projection remains player scoped and observes later character changes without reading bonds', () => {
    const first = player(), second = player()
    character(first, 920001, 1, null)
    character(second, 920001, 5, '4')
    assert.deepEqual(getCharactersEvolutionImgLevels(first, [920001]), [1])
    assert.deepEqual(getCharactersEvolutionImgLevels(second, [920001]), [4])
    prepare('UPDATE players_characters SET evolution_level = 3, illustration_settings = NULL WHERE player_id = ? AND id = ?')
        .run(first, 920001)
    prepare('INSERT OR REPLACE INTO players_characters_bond_tokens (mana_board_index, player_id, character_id, status) VALUES (2, ?, ?, 2)')
        .run(first, 920001)
    const { result, queries } = trace(() => getCharactersEvolutionImgLevels(first, [920001, 920001]))
    assert.deepEqual(result, [3, 3])
    assert.equal(queries.length, 1)
    assert.equal(queries.some(row => row.sql.includes('bond_tokens')), false)
    prepare('DELETE FROM players_characters WHERE player_id = ? AND id = ?').run(first, 920001)
    assert.deepEqual(getCharactersEvolutionImgLevels(first, [920001]), [0])
    assert.deepEqual(getCharactersEvolutionImgLevels(second, [920001]), [4])
})

test('large requested sets use bounded reads and keep the original slot order', () => {
    const playerId = player()
    const ids = Array.from({ length: 405 }, (_, index) => 930000 + index)
    db.transaction(() => ids.forEach((id, index) => character(playerId, id, index % 3, null)))()
    const slots = [...ids].reverse().concat(ids[0], null, ids[400])
    const { result, queries } = trace(() => getCharactersEvolutionImgLevels(playerId, slots))
    assert.deepEqual(result, legacy(playerId, slots))
    assert.equal(queries.length, 2)
    assert.equal(queries.reduce((sum, row) => sum + row.rows, 0), ids.length)
    assert.equal(queries.every(row => row.operation === 'all' && row.sql.includes('player_id = ? AND id IN (')), true)
})
