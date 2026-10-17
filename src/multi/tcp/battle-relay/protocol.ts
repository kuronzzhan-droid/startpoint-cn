// IPC messages between the main CN process and the battle relay child.
//
// The child owns the real battle sockets after the handshake frame is seen.
// It relays Broadcast/Send frames and answers Measurement/Heartbeat locally,
// and forwards every other frame to the main process, which keeps all room,
// barrier, lease and settlement decisions.

/** Main → child. */
export type RelayParentMessage =
    | { t: "adopt"; sid: number }
    | { t: "write"; sid: number; data: string }
    | { t: "end"; sid: number }
    | { t: "destroy"; sid: number }
    /** Full current relay membership of one room. An empty list removes the room. */
    | ({ t: "members"; room: string; version: number; members: RelayMember[] } & RelayRoomIdentity)
    | ({ t: "activate"; room: string; version: number } & RelayRoomIdentity)
    | { t: "control-applied"; sid: number; controlId: number }
    | { t: "shutdown" }

export interface RelayMember {
    /** null means the real socket is retained in the parent process. */
    sid: number | null
    cid: string
    gen: number
}

export interface RelayRoomIdentity {
    instanceId: string
    battleSessionId: string | null
    sceneEpoch: number
}

/** Frames handled inside the child since the previous activity report. */
export interface RelayActivity {
    sid: number
    broadcasts: number
    sends: number
    heartbeats: number
    measurements: number
    lineSpeedWarnings: number
    /** Longest gap between two inbound frames on this socket, measured in the child. */
    maxGapMs: number
    /** Frames this socket received from teammates through the child. */
    relayedOut: number
    /** Longest write backpressure episode that ended in this interval. */
    maxBackpressureMs: number
}

/** Child → main. */
export type RelayChildMessage =
    | { t: "ready" }
    | { t: "adopted"; sid: number; ok: boolean }
    /** Raw `\0`-terminated frames the main process must handle itself. */
    | { t: "frames"; sid: number; controlId: number; data: string; identity?: RelayRoomIdentity }
    | ({ t: "members-applied"; room: string; version: number } & RelayRoomIdentity)
    | { t: "diagnostics"; data: Record<string, unknown> }
    | { t: "activity"; items: RelayActivity[] }
    | { t: "closed"; sid: number; reason: RelayCloseReason; hadError: boolean; detail?: string }

export type RelayCloseReason =
    | "peer_fin"
    | "socket_error"
    | "protocol"
    | "send_backpressure"
    | "send_queue_limit"
    | "parent_request"

export type RelayIdentityRejection = "instance" | "run" | "scene" | "unbound"

/** Legacy clients carry no scene token: preserve a peer's ordered LevelNext tail. */
export function relayFramesIdentityRejection(current: RelayRoomIdentity, binding: RelayRoomIdentity,
    incoming: RelayRoomIdentity | undefined, data: string): RelayIdentityRejection | null {
    if (!binding.instanceId) return "unbound"
    if (binding.instanceId !== current.instanceId || (incoming && incoming.instanceId !== current.instanceId)) return "instance"
    if (binding.battleSessionId !== current.battleSessionId || (incoming && incoming.battleSessionId !== current.battleSessionId)) return "run"
    const epoch = incoming?.sceneEpoch ?? binding.sceneEpoch
    if (epoch === current.sceneEpoch && binding.sceneEpoch === current.sceneEpoch) return null
    // The first teammate may already have advanced the room epoch. The remaining
    // teammate's own LevelNext is the only valid entrance from its previous epoch.
    if (binding.sceneEpoch + 1 === current.sceneEpoch
        && (epoch === binding.sceneEpoch || epoch === current.sceneEpoch)) {
        try {
            const first = data.split("\0").find(frame => frame.trim().length > 0)
            const frame = first === undefined ? undefined : JSON.parse(first)
            if (Array.isArray(frame) && frame[0] === 0 && Array.isArray(frame[1]) && frame[1][0] === 1) return null
        } catch { /* Protocol validation will reject malformed frames separately. */ }
    }
    return "scene"
}
