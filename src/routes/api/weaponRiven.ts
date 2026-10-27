import { FastifyInstance } from "fastify"
import { createHash } from "crypto"
import { getSession } from "../../data/domains/session"
import { resolvePlayerIdSync } from "../../data/activeAccount"
import { getWeaponRivenPartyInfoListSync } from "../../data/domains/weapon-riven-party"
import { drawWeaponRivenSync, selectWeaponRivenSync, dismantleWeaponRivenSync, dismantleWeaponRivensBatchSync,
    lockWeaponRivenSync, markWeaponRivensSeenSync } from "../../data/domains/weapon-riven-operations"
import { WeaponRivenError } from "../../lib/weapon-riven/model"
import { hasWeaponRivenCapability } from "../../lib/client-admission"
import { runPersistenceTransaction } from "../../lib/persistence-coordinator"
import { generateDataHeaders } from "../../utils"
import { refreshWeaponRivenPartiesAfterCommit } from "../../lib/weapon-riven/party-refresh"

interface RivenBody {
    viewer_id: number; api_count: number; item_id: number; riven_id: number
    revision?: number; draw_id?: string; is_confirm?: boolean; cost_item_id?: unknown
    locked?: boolean | 0 | 1; item_ids?: number[]; mode?: "full" | "values"
}
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value)
const instanceId = (value: unknown): value is number => integer(value) && value >= 16000001 && value <= 16000200

interface RivenBatchBody { viewer_id: number; api_count: number; items: { item_id: number; revision: number; riven_id?: number }[] }

export default async function weaponRivenRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.post("/dismantle_batch", async (request, reply) => {
        const body = request.body as RivenBatchBody | null
        if (!body || !integer(body.viewer_id) || body.viewer_id < 1 || !integer(body.api_count) || body.api_count < 0
            || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20
            || !body.items.every(item => !!item && typeof item === "object" && instanceId(item.item_id)
                && integer(item.revision) && item.revision >= 1
                && (item.riven_id === undefined || (integer(item.riven_id) && item.riven_id >= 1)))
            || new Set(body.items.map(item => item.item_id)).size !== body.items.length) {
            return reply.status(400).send({error:"Bad Request",code:"invalid_argument",message:"Invalid weapon riven request"})
        }
        const session = await getSession(String(body.viewer_id))
        const playerId = session ? resolvePlayerIdSync(session.accountId) : null
        if (playerId === null) return reply.status(400).send({error:"Bad Request",code:"invalid_viewer",message:"Invalid viewer id"})
        if (!hasWeaponRivenCapability(request)) return reply.status(403).send({
            error:"Forbidden",code:"capability_required",message:"Client requires weapon-riven-v1"})
        const sessionKey = createHash("sha256").update(String(request.headers["x-sp-session"])).digest("hex")
        const items = body.items.map(item => ({item_id:item.item_id,revision:item.revision,
            ...(item.riven_id === undefined ? {} : {riven_id:item.riven_id})}))
        // Order-independent, and bound to each card's permanent riven_id when the client names it.
        const requestKey = `${sessionKey}:${body.api_count}:batch:${[...items].sort((a, b) => a.item_id - b.item_id)
            .map(item => `${item.item_id}.${item.revision}.${item.riven_id ?? ""}`).join(",")}`
        try {
            const result = await runPersistenceTransaction({domain:"player",playerId,operation:"weapon_riven_dismantle_batch"}, () => {
                const {changed_parties, ...change} = dismantleWeaponRivensBatchSync(playerId,items,requestKey)
                return {...change,party_info_list:getWeaponRivenPartyInfoListSync(playerId,changed_parties)}
            })
            if (!result.weapon_riven_conflict) await refreshWeaponRivenPartiesAfterCommit(playerId,result.party_info_list)
            reply.type("application/x-msgpack")
            return reply.send({data_headers:generateDataHeaders({viewer_id:body.viewer_id}),data:{...result,mail_arrived:false}})
        } catch (error) {
            if (!(error instanceof WeaponRivenError)) throw error
            return reply.status(error.status).send({error:"Weapon Riven Error",code:error.code,message:error.message})
        }
    })
    for (const action of ["draw","select","dismantle","lock","seen"] as const) {
        fastify.post(`/${action}`, async (request, reply) => {
            const body = request.body as RivenBody | null
            if (!body || !integer(body.viewer_id) || body.viewer_id < 1
                || !integer(body.api_count) || body.api_count < 0
                || (action === "seen" ? (!Array.isArray(body.item_ids) || body.item_ids.length > 200
                    || !body.item_ids.every(instanceId))
                    : (!instanceId(body.item_id) || !integer(body.riven_id) || body.riven_id < 1))
                || (action === "lock" && body.locked !== true && body.locked !== false && body.locked !== 0 && body.locked !== 1)
                || (action === "draw" && (!integer(body.revision) || body.revision < 1
                    || (body.mode !== undefined && body.mode !== "full" && body.mode !== "values")))
                || (action === "select" && (typeof body.draw_id !== "string" || !body.draw_id || body.draw_id.length > 128
                    || typeof body.is_confirm !== "boolean"))) {
                return reply.status(400).send({error:"Bad Request",code:"invalid_argument",message:"Invalid weapon riven request"})
            }
            const session = await getSession(String(body.viewer_id))
            const playerId = session ? resolvePlayerIdSync(session.accountId) : null
            if (playerId === null) return reply.status(400).send({error:"Bad Request",code:"invalid_viewer",message:"Invalid viewer id"})
            if (!hasWeaponRivenCapability(request)) return reply.status(403).send({
                error:"Forbidden",code:"capability_required",message:"Client requires weapon-riven-v1"})
            const sessionKey = createHash("sha256").update(String(request.headers["x-sp-session"])).digest("hex")
            const requestKey = `${sessionKey}:${body.api_count}:${body.item_id}:${body.riven_id}`
            try {
                const result = await runPersistenceTransaction({domain:"player",playerId,operation:`weapon_riven_${action}`}, () => {
                    if (action === "seen") return markWeaponRivensSeenSync(playerId,body.item_ids!)
                    if (action === "lock") return lockWeaponRivenSync(playerId,body.item_id,body.riven_id,body.locked ? 1 : 0)
                    if (action === "draw") return drawWeaponRivenSync(playerId,body.item_id,body.riven_id,body.revision!,undefined,
                        `${requestKey}:${body.revision}`,body.cost_item_id,body.mode)
                    if (action === "select") return selectWeaponRivenSync(playerId,body.item_id,body.riven_id,body.draw_id!,body.is_confirm!)
                    const {changed_parties, ...change} = dismantleWeaponRivenSync(playerId,body.item_id,body.riven_id,
                        requestKey)
                    const party_info_list = getWeaponRivenPartyInfoListSync(playerId,changed_parties)
                    return {...change,party_info_list}
                })
                if (action === "dismantle" && "party_info_list" in result && !result.weapon_riven_conflict) {
                    await refreshWeaponRivenPartiesAfterCommit(playerId,result.party_info_list)
                }
                reply.type("application/x-msgpack")
                return reply.send({data_headers:generateDataHeaders({viewer_id:body.viewer_id}),data:{...result,mail_arrived:false}})
            } catch (error) {
                if (!(error instanceof WeaponRivenError)) throw error
                return reply.status(error.status).send({error:"Weapon Riven Error",code:error.code,message:error.message})
            }
        })
    }
}
