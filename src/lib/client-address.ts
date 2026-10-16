/**
 * Fastify `trustProxy` value. Rate limits key on `request.ip`, so a raw
 * X-Forwarded-For header must never be taken from an untrusted peer.
 *
 * Default trusts only a reverse proxy on the same host (loopback). Deployments
 * behind another proxy set TRUST_PROXY to its address/CIDR list (comma
 * separated), a hop count, or "false" to ignore the header entirely.
 */
export function trustProxySetting(raw = process.env.TRUST_PROXY): string | number | boolean {
    const value = (raw ?? "").trim()
    if (value === "") return "loopback"
    if (/^(false|0|off|no)$/i.test(value)) return false
    if (/^\d+$/.test(value)) return Number(value)
    return value
}
