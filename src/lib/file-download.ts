import { createReadStream, statSync } from "fs"
import path from "path"
import type { FastifyReply } from "fastify"

// Archive names published under assets/asset-patch/active, e.g.
// "pinball-1.4.194-1.4.195-1-moon-wolf-art-local.zip".
const PLAIN_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Resolve a single request-supplied file name inside `root`.
 * Returns null for anything that is not a plain name or would leave `root`.
 */
export function resolvePlainFileInside(root: string, name: string): string | null {
    if (typeof name !== "string" || name.length > 255) return null
    if (!PLAIN_FILE_NAME.test(name) || name.includes("..")) return null
    const base = path.resolve(root)
    const target = path.resolve(base, name)
    if (path.dirname(target) !== base) return null
    return target
}

/**
 * Stream a regular file instead of buffering it whole on the event loop.
 * Returns false when the path is missing or not a regular file.
 */
export function sendFileStream(reply: FastifyReply, filePath: string, contentType: string): boolean {
    let size: number
    try {
        const stat = statSync(filePath)
        if (!stat.isFile()) return false
        size = stat.size
    } catch {
        return false
    }
    reply.type(contentType)
    reply.header("content-length", String(size))
    reply.send(createReadStream(filePath))
    return true
}
