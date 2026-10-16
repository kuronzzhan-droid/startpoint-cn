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
    | { t: "members"; room: string; members: RelayMember[] }
    | { t: "shutdown" }

export interface RelayMember {
    sid: number
    cid: string
    gen: number
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
    | { t: "frames"; sid: number; data: string }
    | { t: "activity"; items: RelayActivity[] }
    | { t: "closed"; sid: number; reason: RelayCloseReason; hadError: boolean; detail?: string }

export type RelayCloseReason =
    | "peer_fin"
    | "socket_error"
    | "protocol"
    | "send_backpressure"
    | "send_queue_limit"
    | "parent_request"
