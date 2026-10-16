import { existsSync } from "./file-exists";
import path from "path"
import { sendFileStream } from "./file-download"
import { FastifyInstance } from "fastify"

/** Serve loose custom resources in all native roots, then the pristine store. */
export function installCustomCdnResourceRoutes(
    app: FastifyInstance,
    options: { patchRoot: string; cdnRoot: string },
): void {
    for (const root of ["upload", "medium_upload", "android_upload", "ios_upload"]) {
        app.get(`/patch/cn/dummy/download/production/${root}/:prefix/:hash`, async (request, reply) => {
            const { prefix, hash } = request.params as { prefix: string; hash: string }
            if (!/^[a-f0-9]{2}$/.test(prefix) || !/^[a-f0-9]{38}$/.test(hash)) {
                return reply.status(404).send("Not Found")
            }
            const custom = path.join(options.patchRoot, "production", root, prefix, hash)
            const pristine = path.join(options.cdnRoot, "cn", "dummy", "download", "production", root, prefix, hash)
            const file = existsSync(custom) ? custom : pristine
            if (sendFileStream(reply, file, "application/octet-stream")) {
                return reply
            }
            return reply.status(404).send("Not Found")
        })
    }
}
