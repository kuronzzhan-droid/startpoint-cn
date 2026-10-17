import { AsyncResource } from "node:async_hooks"
import { randomBytes } from "node:crypto"
import { assertServerAcceptingWork, withServerWorkAdmission } from "../../lib/shutdown-state"

export interface RealtimeBusinessAdmissionProof {
    ownerEpoch: string
    commandId: string
    admissionToken: string
}

interface AcceptedScope {
    proof: RealtimeBusinessAdmissionProof
    run<T>(operation: () => Promise<T>): Promise<T>
    release(): void
}

const scopes = new Map<string, AcceptedScope>()
const maximumScopes = 256
function invalidProof(): Error {
    return Object.assign(new Error("REALTIME_BUSINESS_ADMISSION_INVALID"), { code: "REALTIME_BUSINESS_ADMISSION_INVALID" })
}
function identity(value: unknown, maximum: number): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= maximum
}

/** Called synchronously at parent acceptance, never at an untrusted child callback. */
export function createAcceptedRealtimeBusinessScope(input: { ownerEpoch: string; commandId: string }): AcceptedScope {
    assertServerAcceptingWork()
    if (!identity(input.ownerEpoch, 128) || !identity(input.commandId, 256)) throw invalidProof()
    if (scopes.size >= maximumScopes) {
        throw Object.assign(new Error("REALTIME_BUSINESS_ADMISSION_BUDGET"), { code: "REALTIME_BUSINESS_ADMISSION_BUDGET" })
    }
    const proof = Object.freeze({ ownerEpoch: input.ownerEpoch, commandId: input.commandId,
        admissionToken: randomBytes(32).toString("hex") })
    let active = true, finish!: () => void
    let boundRun!: <T>(operation: () => Promise<T>) => Promise<T>
    const lifetime = new Promise<void>(resolve => { finish = resolve })
    // Hold the original admission until actual application ACK/channel termination.
    // AsyncResource restores that context in the independent IPC message callback.
    void withServerWorkAdmission(() => {
        boundRun = AsyncResource.bind(<T>(operation: () => Promise<T>): Promise<T> => withServerWorkAdmission(operation))
        return lifetime
    })
    const scope: AcceptedScope = {
        proof,
        run<T>(operation: () => Promise<T>): Promise<T> {
            if (!active || scopes.get(proof.admissionToken) !== scope) return Promise.reject(invalidProof())
            try { return boundRun(operation) }
            catch (error) { return Promise.reject(error) }
        },
        release() {
            if (!active) return
            active = false
            scopes.delete(proof.admissionToken)
            finish()
        },
    }
    scopes.set(proof.admissionToken, scope)
    return scope
}

/** Only exact, currently held parent proofs can extend accepted work after seal. */
export function dispatchAcceptedRealtimeBusiness<T>(proof: unknown, operation: () => Promise<T>): Promise<T> {
    if (!proof || typeof proof !== "object" || Array.isArray(proof)) return Promise.reject(invalidProof())
    const p = proof as Record<string, unknown>
    const keys = Object.keys(p).sort()
    if (keys.join(",") !== "admissionToken,commandId,ownerEpoch"
        || !identity(p.ownerEpoch, 128) || !identity(p.commandId, 256)
        || typeof p.admissionToken !== "string" || !/^[a-f0-9]{64}$/.test(p.admissionToken)) {
        return Promise.reject(invalidProof())
    }
    const scope = scopes.get(p.admissionToken)
    if (!scope || scope.proof.commandId !== p.commandId || scope.proof.ownerEpoch !== p.ownerEpoch) {
        return Promise.reject(invalidProof())
    }
    return scope.run(operation)
}
