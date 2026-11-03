'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

test('a tokenless retry alias retains its play identity only while that exact cached entry is live', t => {
    const oldTtl = process.env.FINISH_RESPONSE_CACHE_TTL_MS
    process.env.FINISH_RESPONSE_CACHE_TTL_MS = '5000'
    const cachePath = require.resolve('../out/lib/finish-response-cache')
    delete require.cache[cachePath]
    const cache = require(cachePath)
    t.after(() => {
        if (oldTtl === undefined) delete process.env.FINISH_RESPONSE_CACHE_TTL_MS
        else process.env.FINISH_RESPONSE_CACHE_TTL_MS = oldTtl
        delete require.cache[cachePath]
    })
    let now = 100000
    t.mock.method(Date, 'now', () => now)
    const body = { category: 2, quest_id: 1001001, api_count: 2 }
    const key = cache.buildFinishResponseCacheKey('single', 812000001, body)
    const otherViewer = cache.buildFinishResponseCacheKey('single', 812000002, body)
    const otherMode = cache.buildFinishResponseCacheKey('multi', 812000001, body)
    const response = { data_headers: {}, data: {} }
    cache.cacheFinishResponse(key, response, 'original-play')
    assert.equal(cache.getCachedFinishPlayId(key), 'original-play')
    assert.equal(cache.getCachedFinishPlayId(otherViewer), undefined)
    assert.equal(cache.getCachedFinishPlayId(otherMode), undefined)
    now += 4999
    assert.equal(cache.getCachedFinishResponse(key), response)
    assert.equal(cache.getCachedFinishPlayId(key), 'original-play')
    now += 1
    assert.equal(cache.getCachedFinishPlayId(key), undefined, 'reads must not extend the alias deadline')
    assert.equal(cache.getCachedFinishResponse(key), undefined)
    cache.cacheFinishResponse(key, response, 'next-play')
    assert.equal(cache.getCachedFinishPlayId(key), 'next-play', 'reused api_count follows only its new entry')
    cache.cacheFinishResponse(key, response)
    assert.equal(cache.getCachedFinishPlayId(key), undefined, 'unbound replacements cannot inherit the previous identity')
})
