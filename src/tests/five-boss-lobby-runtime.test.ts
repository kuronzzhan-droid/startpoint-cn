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
    autoplayMode?: unknown
    [key: string]: unknown
}

interface TestRoom {
    room_number: string
    category: number
    quest_id: number
}

interface TestTimer {
    setTimeout(callback: () => void, delayMs: number): unknown
    clearTimeout(handle: unknown): void
}

interface FillCoordinator {
    schedule(options: {
        room: TestRoom
        getSnapshot: () => { hostMate: TestMate; mates: readonly TestMate[] }
        onFill: (mates: TestMate[]) => void
        timer: TestTimer
    }): boolean
    fillImmediately(options: {
        room: TestRoom
        getSnapshot: () => { hostMate: TestMate; mates: readonly TestMate[] }
        onFill: (mates: TestMate[]) => void
    }): boolean
    cancel(roomNumber: string): void
}

interface LobbyRuntimeSubject {
    FiveBossLobbyFillCoordinator: new () => FillCoordinator
    isFiveBossLobbyRoom(room: TestRoom): boolean
    canStartFiveBossLobbyRun(
        room: TestRoom & { host_viewer_id: number },
        requesterViewerId: number,
        mates: readonly TestMate[],
    ): boolean
    applyAutoplayModeChange(options: {
        viewerId: number
        auto: unknown
        manual: unknown
        yourself?: TestMate
        hostMates: readonly TestMate[]
    }): { message: [1, [3, number, boolean, boolean]] } | null
    mergeFiveBossRealMate(
        mates: readonly TestMate[],
        realMate: TestMate,
        limit?: number,
    ): TestMate[]
    refreshFiveBossHostClones(hostMate: TestMate, mates: readonly TestMate[]): TestMate[]
    freezeFiveBossLobbyRuntime(
        mates: readonly TestMate[],
        createRunId?: () => string,
        resolveRemoteAddress?: (connectionId: string) => string | null,
    ): {
        runId: string
        expectedRealPlayerIds: number[]
        autoplayModeByPlayerId: Record<string, boolean>
        battleIdentityByConnectionId: Record<string, {
            viewerId: number
            playerId: number
            remoteAddress: string | null
        }>
    }
}

let loadedSubject: Partial<LobbyRuntimeSubject> = {}
try {
    loadedSubject = require("../multi/five-boss/lobby-runtime") as Partial<LobbyRuntimeSubject>
} catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "MODULE_NOT_FOUND") throw error
}

function subject(): LobbyRuntimeSubject {
    assert.equal(
        typeof loadedSubject.FiveBossLobbyFillCoordinator,
        "function",
        "lobby-runtime must export FiveBossLobbyFillCoordinator",
    )
    return loadedSubject as LobbyRuntimeSubject
}

function fiveBossRoom(roomNumber = "123456"): TestRoom {
    return { room_number: roomNumber, category: 2, quest_id: 1099001 }
}

function ordinaryRoom(): TestRoom {
    return { room_number: "654321", category: 2, quest_id: 520001 }
}

function hostMate(party: unknown = { nested: { revision: "initial" } }): TestMate {
    return {
        viewerId: 1001,
        playerId: 501,
        name: "房主",
        rank: 200,
        degreeId: 7,
        party,
        autoplayMode: false,
        connectionId: "host-connection",
    }
}

function humanMate(viewerId: number, playerId = viewerId + 1000): TestMate {
    return {
        viewerId,
        playerId,
        name: `真人${viewerId}`,
        rank: 100,
        degreeId: 1,
        party: { characters: [{ id: viewerId }] },
        autoplayMode: false,
        connectionId: `human-${viewerId}-connection`,
    }
}

function aiMate(comId: number, party: unknown = { nested: { revision: "stale" } }): TestMate {
    return {
        viewerId: 900000000 + comId,
        comId,
        name: `AI${comId}`,
        rank: 1,
        degreeId: 1,
        party,
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

    fireOnly(): void {
        assert.equal(this.pending.size, 1)
        const [handle, task] = [...this.pending.entries()][0]
        this.pending.delete(handle)
        task.callback()
    }
}

test("ordinary rooms are rejected without reading snapshots or arming timers", () => {
    const api = subject()
    const timer = new FakeTimer()
    const coordinator = new api.FiveBossLobbyFillCoordinator()
    let snapshots = 0

    const scheduled = coordinator.schedule({
        room: ordinaryRoom(),
        getSnapshot: () => {
            snapshots++
            return { hostMate: hostMate(), mates: [hostMate()] }
        },
        onFill: () => assert.fail("ordinary room must not fill"),
        timer,
    })

    assert.equal(api.isFiveBossLobbyRoom(ordinaryRoom()), false)
    assert.equal(scheduled, false)
    assert.equal(snapshots, 0)
    assert.equal(timer.pending.size, 0)
})

test("tag 7 accepts only strict booleans and synchronizes client plus host roster", () => {
    const api = subject()
    const yourself = humanMate(1002)
    const hostRosterMate = { ...humanMate(1002), autoplayMode: false }
    const hostMates = [hostMate(), hostRosterMate]

    const invalid = api.applyAutoplayModeChange({
        viewerId: 1002,
        auto: 1,
        manual: false,
        yourself,
        hostMates,
    })
    assert.equal(invalid, null)
    assert.equal(yourself.autoplayMode, false)
    assert.equal(hostRosterMate.autoplayMode, false)

    const valid = api.applyAutoplayModeChange({
        viewerId: 1002,
        auto: true,
        manual: false,
        yourself,
        hostMates,
    })
    assert.deepEqual(valid, { message: [1, [3, 1002, true, false]] })
    assert.equal(yourself.autoplayMode, true)
    assert.equal(hostRosterMate.autoplayMode, true)
})

test("delayed fill uses 120 seconds and the latest host party", () => {
    const api = subject()
    const timer = new FakeTimer()
    const coordinator = new api.FiveBossLobbyFillCoordinator()
    const host = hostMate()
    let mates: TestMate[] = [host]
    const fills: TestMate[][] = []

    assert.equal(coordinator.schedule({
        room: fiveBossRoom(),
        getSnapshot: () => ({ hostMate: host, mates }),
        onFill: clones => fills.push(clones),
        timer,
    }), true)
    assert.equal([...timer.pending.values()][0].delayMs, 120_000)

    host.party = { nested: { revision: "latest" } }
    mates = [host, humanMate(1002)]
    timer.fireOnly()

    assert.equal(fills.length, 1)
    assert.equal(fills[0].length, 1)
    assert.deepEqual(fills[0][0].party, host.party)
    assert.notEqual(fills[0][0].party, host.party)
})

test("host EnterComs fills immediately and cancels the delayed fill", () => {
    const api = subject()
    const timer = new FakeTimer()
    const coordinator = new api.FiveBossLobbyFillCoordinator()
    const host = hostMate()
    const fills: TestMate[][] = []
    const options = {
        room: fiveBossRoom(),
        getSnapshot: () => ({ hostMate: host, mates: [host] }),
        onFill: (clones: TestMate[]) => fills.push(clones),
    }

    coordinator.schedule({ ...options, timer })
    assert.equal(timer.pending.size, 1)
    assert.equal(coordinator.fillImmediately(options), true)
    assert.equal(timer.pending.size, 0)
    assert.equal(fills.length, 1)
    assert.equal(fills[0].length, 2)
})

test("a full three-member room neither schedules nor immediately adds an AI", () => {
    const api = subject()
    const timer = new FakeTimer()
    const coordinator = new api.FiveBossLobbyFillCoordinator()
    const host = hostMate()
    const options = {
        room: fiveBossRoom(),
        getSnapshot: () => ({ hostMate: host, mates: [host, humanMate(1002), aiMate(1)] }),
        onFill: () => assert.fail("full room must not fill"),
    }

    assert.equal(coordinator.schedule({ ...options, timer }), false)
    assert.equal(coordinator.fillImmediately(options), false)
    assert.equal(timer.pending.size, 0)
})

test("a real player replaces an AI, while a full human room stays capped", () => {
    const api = subject()
    const host = hostMate()
    const second = humanMate(1002)
    const third = humanMate(1003)

    const replaced = api.mergeFiveBossRealMate([host, second, aiMate(1)], third)
    assert.deepEqual(replaced.map(mate => mate.viewerId), [1001, 1002, 1003])

    const fourth = humanMate(1004)
    const capped = api.mergeFiveBossRealMate(replaced, fourth)
    assert.deepEqual(capped.map(mate => mate.viewerId), [1001, 1002, 1003])
})

test("start refresh gives every host clone an independent copy of the latest party", () => {
    const api = subject()
    const host = hostMate({ nested: { revision: "latest" } })
    const refreshed = api.refreshFiveBossHostClones(host, [host, aiMate(1), aiMate(2)])
    const firstClone = refreshed[1]
    const secondClone = refreshed[2]

    assert.equal(firstClone.rank, host.rank)
    assert.equal(firstClone.degreeId, host.degreeId)
    assert.deepEqual(firstClone.party, host.party)
    assert.deepEqual(secondClone.party, host.party)
    assert.notEqual(firstClone.party, host.party)
    assert.notEqual(secondClone.party, host.party)
    assert.notEqual(firstClone.party, secondClone.party)
})

test("only the five-boss host can start, and only after the roster reaches three", () => {
    const api = subject()
    const room = { ...fiveBossRoom(), host_viewer_id: 1001 }
    const host = hostMate()
    const fullRoster = [host, humanMate(1002), aiMate(1)]

    assert.equal(api.canStartFiveBossLobbyRun(room, 1002, fullRoster), false)
    assert.equal(api.canStartFiveBossLobbyRun(room, 1001, [host, aiMate(1)]), false)
    assert.equal(api.canStartFiveBossLobbyRun(
        room,
        1001,
        [host, { ...humanMate(1002), playerId: undefined }, aiMate(1)],
    ), false)
    assert.equal(api.canStartFiveBossLobbyRun(
        room,
        1001,
        [host, { ...humanMate(1002), connectionId: undefined }, aiMate(1)],
    ), false)
    assert.equal(api.canStartFiveBossLobbyRun(
        room,
        1001,
        [host, { ...humanMate(1002), connectionId: host.connectionId }, aiMate(1)],
    ), false)
    assert.equal(api.canStartFiveBossLobbyRun(room, 1001, fullRoster), true)
})

test("start snapshot freezes a new run id, unique humans and fail-closed Auto state", () => {
    const api = subject()
    const host = hostMate()
    const manual = { ...humanMate(1002, 502), autoplayMode: false }
    const missing = { ...humanMate(1003, 503), autoplayMode: undefined }
    const duplicate = { ...humanMate(2003, 503), autoplayMode: false }
    const mates = [host, manual, missing, duplicate, aiMate(1)]
    let sequence = 0

    const first = api.freezeFiveBossLobbyRuntime(
        mates,
        () => `run-${++sequence}`,
        connectionId => `peer:${connectionId}`,
    )
    const second = api.freezeFiveBossLobbyRuntime(mates, () => `run-${++sequence}`)

    assert.equal(first.runId, "run-1")
    assert.equal(second.runId, "run-2")
    assert.deepEqual(first.expectedRealPlayerIds, [501, 502, 503])
    assert.deepEqual(first.autoplayModeByPlayerId, {
        "501": false,
        "502": false,
        "503": true,
    })
    assert.deepEqual(first.battleIdentityByConnectionId, {
        "host-connection": {
            viewerId: 1001,
            playerId: 501,
            remoteAddress: "peer:host-connection",
        },
        "human-1002-connection": {
            viewerId: 1002,
            playerId: 502,
            remoteAddress: "peer:human-1002-connection",
        },
        "human-1003-connection": {
            viewerId: 1003,
            playerId: 503,
            remoteAddress: "peer:human-1003-connection",
        },
    })
    assert.equal("900000001" in first.autoplayModeByPlayerId, false)
})

test("starting or disbanding cancels a pending fill timer", () => {
    const api = subject()
    const timer = new FakeTimer()
    const coordinator = new api.FiveBossLobbyFillCoordinator()
    const host = hostMate()

    for (const roomNumber of ["start-cancel", "disband-cancel"]) {
        coordinator.schedule({
            room: fiveBossRoom(roomNumber),
            getSnapshot: () => ({ hostMate: host, mates: [host] }),
            onFill: () => assert.fail("cancelled fill must not fire"),
            timer,
        })
        assert.equal(timer.pending.size, 1)
        coordinator.cancel(roomNumber)
        assert.equal(timer.pending.size, 0)
    }
})

