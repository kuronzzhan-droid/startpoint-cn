import assert from "node:assert/strict"
import { test } from "node:test"

interface TestMate {
    viewerId: number
    playerId?: number
    comId?: number
    name: string
    rank: number
    degreeId: number
    party: unknown
    [key: string]: unknown
}

interface TestPolicy {
    enabled: boolean
    immediate: boolean
    timeoutMs: number
}

interface TestTimer {
    setTimeout(callback: () => void, delayMs: number): unknown
    clearTimeout(handle: unknown): void
}

interface HostCloneSubject {
    isHostCloneAiMate(mate: TestMate): boolean
    serializeHostCloneRoomMates(mates: readonly TestMate[]): Array<{
        viewer_id: number
        com_id: number
        player_id?: number
    }>
    countHostCloneMates(mates: readonly TestMate[]): { humans: number; ai: number; total: number }
    decideHostCloneFill(
        policy: TestPolicy,
        trigger: "immediate" | "timeout",
        mates: readonly TestMate[]
    ): { shouldFill: boolean; slots: number }
    buildHostCloneMates(options: {
        roomNumber: string
        hostMate: TestMate
        mates: readonly TestMate[]
    }): TestMate[]
    coordinateHostCloneFill(options: {
        roomNumber: string
        policy: TestPolicy
        getSnapshot: () => { hostMate: TestMate; mates: readonly TestMate[] }
        onFill: (mates: TestMate[]) => void
        timer: TestTimer
    }): { cancel(): void; firedImmediately: boolean }
}

let loadedSubject: Partial<HostCloneSubject> = {}
try {
    loadedSubject = require("../multi/npc/host-clone") as Partial<HostCloneSubject>
} catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "MODULE_NOT_FOUND") throw error
}

function subject(): HostCloneSubject {
    assert.equal(
        typeof loadedSubject.buildHostCloneMates,
        "function",
        "host-clone module must export buildHostCloneMates"
    )
    return loadedSubject as HostCloneSubject
}

function hostMate(party: unknown = { characters: [{ id: 101 }], nested: { gauge: 50 } }): TestMate {
    return {
        viewerId: 1001,
        playerId: 501,
        name: "房主",
        rank: 200,
        degreeId: 7,
        party,
        connectionId: "host-connection",
        state: [0],
    }
}

function humanMate(viewerId: number): TestMate {
    return {
        viewerId,
        playerId: viewerId + 1000,
        name: `真人${viewerId}`,
        rank: 100,
        degreeId: 1,
        party: { characters: [{ id: viewerId }] },
    }
}

function aiMate(comId: number): TestMate {
    return {
        viewerId: 900000000 + comId,
        comId,
        name: `AI${comId}`,
        rank: 100,
        degreeId: 1,
        party: { characters: [{ id: 200 + comId }] },
    }
}

class FakeTimer implements TestTimer {
    readonly pending = new Map<number, { callback: () => void; delayMs: number }>()
    private nextHandle = 1

    setTimeout(callback: () => void, delayMs: number): number {
        const handle = this.nextHandle++
        this.pending.set(handle, { callback, delayMs })
        return handle
    }

    clearTimeout(handle: unknown): void {
        this.pending.delete(Number(handle))
    }

    fire(handle: number): void {
        const task = this.pending.get(handle)
        assert.ok(task, `timer ${handle} must exist`)
        this.pending.delete(handle)
        task.callback()
    }
}

test("mate counts distinguish existing humans from positive-com-id AI", () => {
    const api = subject()
    const zeroComIdHuman = { ...humanMate(1002), comId: 0 }

    assert.deepEqual(api.countHostCloneMates([hostMate(), zeroComIdHuman, aiMate(1)]), {
        humans: 2,
        ai: 1,
        total: 3,
    })
})

test("room roster serialization preserves real player ids and marks only positive com ids as AI", () => {
    const api = subject()
    const host = hostMate()
    const zeroComIdHuman = { ...humanMate(1002), comId: 0 }
    const ai = aiMate(1)

    assert.equal(api.isHostCloneAiMate(host), false)
    assert.equal(api.isHostCloneAiMate(zeroComIdHuman), false)
    assert.equal(api.isHostCloneAiMate(ai), true)
    assert.deepEqual(api.serializeHostCloneRoomMates([host, zeroComIdHuman, ai]), [
        { viewer_id: 1001, com_id: 0, player_id: 501 },
        { viewer_id: 1002, com_id: 0, player_id: 2002 },
        { viewer_id: 900000001, com_id: 1 },
    ])
})

test("a lone host receives two AI parties that share no nested state", () => {
    const api = subject()
    const host = hostMate()

    const clones = api.buildHostCloneMates({ roomNumber: "123456", hostMate: host, mates: [host] })

    assert.equal(clones.length, 2)
    assert.deepEqual(clones.map(mate => mate.comId), [1, 2])
    assert.deepEqual(clones.map(mate => mate.connectionId), [
        "123456-host-clone-1",
        "123456-host-clone-2",
    ])
    assert.notEqual(clones[0].party, host.party)
    assert.notEqual(clones[1].party, host.party)
    assert.notEqual(clones[0].party, clones[1].party)

    const firstParty = clones[0].party as { nested: { gauge: number } }
    const secondParty = clones[1].party as { nested: { gauge: number } }
    const originalParty = host.party as { nested: { gauge: number } }
    firstParty.nested.gauge = 0
    assert.equal(secondParty.nested.gauge, 50)
    assert.equal(originalParty.nested.gauge, 50)
})

test("existing humans and AI reduce fill slots without reusing AI identities", () => {
    const api = subject()
    const host = hostMate()
    const existingAi = aiMate(1)

    const afterHuman = api.buildHostCloneMates({
        roomNumber: "123456",
        hostMate: host,
        mates: [host, humanMate(1002)],
    })
    const afterAi = api.buildHostCloneMates({
        roomNumber: "123456",
        hostMate: host,
        mates: [host, existingAi],
    })

    assert.equal(afterHuman.length, 1)
    assert.equal(afterAi.length, 1)
    assert.equal(afterAi[0].comId, 2)
    assert.notEqual(afterAi[0].viewerId, existingAi.viewerId)
})

test("a full room never creates another AI", () => {
    const api = subject()
    const host = hostMate()
    const mates = [host, humanMate(1002), aiMate(1)]

    assert.deepEqual(api.decideHostCloneFill(
        { enabled: true, immediate: true, timeoutMs: 120000 },
        "immediate",
        mates
    ), { shouldFill: false, slots: 0 })
    assert.deepEqual(api.buildHostCloneMates({ roomNumber: "123456", hostMate: host, mates }), [])
})

test("an ordinary room neither fills immediately nor arms a timeout", () => {
    const api = subject()
    const timer = new FakeTimer()
    let snapshots = 0
    let fills = 0

    const control = api.coordinateHostCloneFill({
        roomNumber: "123456",
        policy: { enabled: false, immediate: true, timeoutMs: 120000 },
        getSnapshot: () => {
            snapshots++
            return { hostMate: hostMate(), mates: [hostMate()] }
        },
        onFill: () => { fills++ },
        timer,
    })

    assert.equal(control.firedImmediately, false)
    assert.equal(snapshots, 0)
    assert.equal(fills, 0)
    assert.equal(timer.pending.size, 0)
})

test("immediate opt-in fills now without scheduling a second fill", () => {
    const api = subject()
    const timer = new FakeTimer()
    const host = hostMate()
    const emitted: TestMate[][] = []

    const control = api.coordinateHostCloneFill({
        roomNumber: "123456",
        policy: { enabled: true, immediate: true, timeoutMs: 120000 },
        getSnapshot: () => ({ hostMate: host, mates: [host] }),
        onFill: mates => emitted.push(mates),
        timer,
    })

    assert.equal(control.firedImmediately, true)
    assert.equal(emitted.length, 1)
    assert.equal(emitted[0].length, 2)
    assert.equal(timer.pending.size, 0)
})

test("timeout fill reads the latest host party and latest real-player count", () => {
    const api = subject()
    const timer = new FakeTimer()
    const host = hostMate({ nested: { revision: "before" } })
    let mates: TestMate[] = [host]
    const emitted: TestMate[][] = []

    const control = api.coordinateHostCloneFill({
        roomNumber: "123456",
        policy: { enabled: true, immediate: false, timeoutMs: 120000 },
        getSnapshot: () => ({ hostMate: host, mates }),
        onFill: clones => emitted.push(clones),
        timer,
    })

    assert.equal(control.firedImmediately, false)
    assert.equal(timer.pending.size, 1)
    const [handle, task] = [...timer.pending.entries()][0]
    assert.equal(task.delayMs, 120000)

    host.party = { nested: { revision: "latest" } }
    mates = [host, humanMate(1002)]
    timer.fire(handle)

    assert.equal(emitted.length, 1)
    assert.equal(emitted[0].length, 1)
    assert.equal(emitted[0][0].connectionId, "123456-host-clone-1")
    assert.deepEqual(emitted[0][0].party, { nested: { revision: "latest" } })
    assert.notEqual(emitted[0][0].party, host.party)
})

test("cancelling a pending timeout prevents the fill callback", () => {
    const api = subject()
    const timer = new FakeTimer()
    const host = hostMate()
    let fills = 0

    const control = api.coordinateHostCloneFill({
        roomNumber: "123456",
        policy: { enabled: true, immediate: false, timeoutMs: 120000 },
        getSnapshot: () => ({ hostMate: host, mates: [host] }),
        onFill: () => { fills++ },
        timer,
    })
    control.cancel()

    assert.equal(timer.pending.size, 0)
    assert.equal(fills, 0)
})

