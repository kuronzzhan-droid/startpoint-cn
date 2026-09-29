import assert from "node:assert/strict"
import { test } from "node:test"
import { createTeamCodeClient, GAME_CODE_PATTERN, parseTeamCodePayload, TeamCodeLimiter, teamCodeBaseUrl, wikiPublicId } from "../lib/wiki-team-code-client"

const code = "23456789ABCD", base = "https://wiki.example/api/community/game-codes"
const payload = () => ({title: "测试队伍", active: true, team: {
    main: [1, 2, 3].map((id) => wikiPublicId("c", id)), unison: ["", "", ""],
    weapon: [wikiPublicId("w", 5001), "", ""], soul: ["", "", ""]}})
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers: {"content-type": "application/json"}})
const mockFetch = (fn: (url: string, init?: RequestInit) => Promise<Response>) => fn as typeof fetch

test("opaque identifiers match the public Wiki hash contract and native input alphabet", () => {
    assert.equal(wikiPublicId("c", "111135"), "c9f2416c55187")
    assert.ok(GAME_CODE_PATTERN.test(code))
    for (const wrong of ["000000000000", "111111111111", "ABCD-EFGH-JK", "short", "<script>", "a23456789ABC"]) assert.ok(!GAME_CODE_PATTERN.test(wrong))
})
test("remote data rejects private extras, missing slots, duplicates and raw identifiers", () => {
    const valid = payload(); assert.deepEqual(parseTeamCodePayload(valid), valid)
    for (const mutate of [
        (v: any) => {v.secret = "not allowed"}, (v: any) => {v.team.main[0] = "111135"},
        (v: any) => {v.team.unison[0] = v.team.main[0]}, (v: any) => {v.team.weapon.push("")},
        (v: any) => {v.team.main[0] = ""}, (v: any) => {v.title = "x".repeat(81)},
        (v: any) => {v.team.shell = "bad"}, (v: any) => {v.active = false},
    ]) {const value = payload(); mutate(value); assert.throws(() => parseTeamCodePayload(value))}
})
test("only explicit HTTPS or loopback HTTP endpoints can be configured", () => {
    assert.equal(teamCodeBaseUrl(base).href, base)
    assert.equal(teamCodeBaseUrl("http://127.0.0.1:8878/api/community/game-codes").protocol, "http:")
    for (const url of [undefined, "file:///etc/passwd", "http://remote.test/api/community/game-codes",
        "https://user:pass@wiki.example/api/community/game-codes", `${base}?token=x`, `${base}#fragment`, "https://wiki.example/other"])
        assert.throws(() => teamCodeBaseUrl(url))
})
test("valid codes use bounded cache and observe revocation after five seconds", async () => {
    let now = 0, requests = 0, active = true
    const lookup = createTeamCodeClient({url: () => base, now: () => now, fetcher: mockFetch(async (url, init) => {
        requests++; assert.equal(url, `${base}/${code}`); assert.equal(init?.redirect, "error")
        return active ? reply(payload()) : reply({}, 404)
    })})
    assert.deepEqual(await lookup(code), payload()); active = false
    now = 4999; await lookup(code); assert.equal(requests, 1)
    now = 5001; await assert.rejects(lookup(code), {kind: "not-found"}); assert.equal(requests, 2)
    await assert.rejects(lookup(code)); assert.equal(requests, 3)
})
test("unsafe code syntax and disabled configuration never perform HTTP requests", async () => {
    let calls = 0
    const lookup = createTeamCodeClient({url: () => undefined, fetcher: mockFetch(async () => {calls++; return reply(payload())})})
    await assert.rejects(lookup("../../secret")); await assert.rejects(lookup(code)); assert.equal(calls, 0)
})
test("non-JSON, oversized streamed responses, inactive codes and endpoint errors fail closed", async () => {
    const responses = [new Response("html", {headers:{"content-type":"text/html"}}),
        new Response("x".repeat(16_385), {headers:{"content-type":"application/json"}}),
        reply({active:false}), reply({}, 500), reply({team:payload().team,title:"missing active"})]
    for (const response of responses) {
        const lookup = createTeamCodeClient({url: () => base, fetcher: mockFetch(async () => response)})
        await assert.rejects(lookup(code))
    }
})
test("transport errors expose no URL, exception text or credentials", async () => {
    const lookup = createTeamCodeClient({url: () => base, fetcher: mockFetch(async () => {throw new Error("credential secret host")})})
    await assert.rejects(lookup(code), (error: Error) => error.message === "unavailable")
})

test("slow upstream requests are aborted within the fixed timeout", async () => {
    let aborted = false
    const lookup = createTeamCodeClient({url: () => base, fetcher: mockFetch(async (_url, init) => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => {aborted = true; reject(new Error("upstream aborted"))}, {once: true})
    }))})
    await assert.rejects(lookup(code), {kind: "unavailable"})
    assert.equal(aborted, true)
})
test("per-identity limits expire and do not permit one identity to consume another's quota", () => {
    const limiter = new TeamCodeLimiter()
    assert.equal(limiter.take("player:1", 2, 0), true); assert.equal(limiter.take("player:1", 2, 1), true)
    assert.equal(limiter.take("player:1", 2, 2), false); assert.equal(limiter.take("player:2", 2, 2), true)
    assert.equal(limiter.take("player:1", 2, 60_001), true)
})
