/**
 * Fastify `trustProxy` value. Rate limits key on `request.ip`, so a raw
 * X-Forwarded-For header must never be taken from an untrusted peer.
 *
 * Default ignores forwarding headers. A loopback TCP forwarder (for example
 * Windows portproxy) cannot sanitize them. A real HTTP reverse proxy must be
 * explicitly trusted by address/CIDR list or hop count and overwrite XFF.
 */
export function trustProxySetting(raw = process.env.TRUST_PROXY): string | number | boolean {
    const value = (raw ?? "").trim()
    if (value === "") return false
    if (/^(false|0|off|no)$/i.test(value)) return false
    if (/^\d+$/.test(value)) return Number(value)
    return value
}
