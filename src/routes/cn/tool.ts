import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { generateDataHeaders, generateViewerId } from "../../utils";
import { deleteAccountSessionsOfTypeSync, deleteDeviceBindingSync, getAccountSessionsOfTypeSync, getDeviceBindingSync, insertDeviceBindingSync, insertSessionWithTokenSync } from "../../data/domains/session"
import { getAccountSync, insertAccountSync, updateAccountSync } from "../../data/domains/account"
import { getPlayerSync, insertDefaultPlayerSync } from "../../data/domains/player"
import { SessionType } from "../../data/types";
import { saveAccountDefaultPlayer } from "../../data/activeAccount";
import { readPlayerLoginSession, playerLoginProfile, verifiedPlayerLogin } from "../../lib/player-login";
import { runPersistenceTransactionSync } from "../../lib/persistence-coordinator";
import { accountCreationBudget, AccountCreationBudgetError, AccountCreationReservation } from "../../lib/account-creation-budget";
import { createPlayerLoginRateLimiter } from "../../lib/player-login-rate-limit";

interface CnSignupBody {
    device_id: number;
    channelNo: string;
    media?: string;
    androidId?: string;
    oaid?: string;
    mac?: string;
    terminInfo?: string;
    osVer?: string;
    storage_directory_path?: string;
    first_viewer_id?: number;
    advertise_id?: string;
}

function generateLoginToken(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let token = "";
    for (let i = 0; i < 32; i++) {
        token += chars[Math.floor(Math.random() * chars.length)];
    }
    return token;
}

interface GetHeaderResponseBody {
    viewer_id: number
}

const routes = async (fastify: FastifyInstance) => {
    const creation = accountCreationBudget(fastify)
    const returningLoginLimited = createPlayerLoginRateLimiter()
    fastify.post("/get_header_response", (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GetHeaderResponseBody;
        reply.header("content-type", "application/x-msgpack");
        reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: body.viewer_id
            }),
            "data": []
        });
    });

    fastify.post("/auth", async (_request: FastifyRequest, reply: FastifyReply) => {
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: generateDataHeaders(),
            data: {}
        });
    });

    fastify.post("/signup", async (request: FastifyRequest, reply: FastifyReply) => {
        const signedIn = verifiedPlayerLogin(request) ?? readPlayerLoginSession(request.headers["x-sp-session"])
        if (signedIn) {
            const profile = playerLoginProfile(signedIn.account_id)
            reply.type("application/x-msgpack")
            return reply.send({ data_headers: generateDataHeaders({ viewer_id: signedIn.viewer_id, short_udid: 0, udid: signedIn.udid }),
                data: { login_token: signedIn.token, newAccount: 0, roleName: profile.name, accountName: profile.username,
                    sign: "dummy_sign", createDate: new Date().toISOString(), serverName: "StarPoint CN", serverId: 1 } })
        }
        const body = request.body as CnSignupBody;
        const udid = request.headers["udid"] as string || "unknown";
        const shortUdid = 0;
        const deviceId = body.device_id

        const loginToken = generateLoginToken();
        let accountId: number;
        let newAccount = true;

        if (!deviceId) {
            return reply.status(400).send({ error: "Missing device_id" })
        }

        const reserved: { current: AccountCreationReservation | null } = { current: null }
        let signup
        try {
            // Avoid taking a write lock when new-account capacity is exhausted.
            // The transaction rechecks the binding to handle concurrent deletion.
            const binding = getDeviceBindingSync(deviceId)
            const existing = binding && getAccountSync(binding.account_id)
            if (existing && returningLoginLimited(request.ip, "/player-auth/resume", {}, existing.id)) {
                return reply.header("retry-after", "60").type("application/x-msgpack").send({
                    data_headers: generateDataHeaders({ result_code: 516 }), data: {},
                })
            }
            if (!existing) {
                reserved.current = creation.reserve(request.ip)
                if (!reserved.current) throw new AccountCreationBudgetError()
            }
            signup = runPersistenceTransactionSync({
                domain: "account", operation: "signup_device",
            }, () => {
                let resolvedAccountId: number | undefined
                let createdPlayerId: number | undefined
                let viewerId: number | undefined
                // Device binding: each device gets its own account.
                const binding = getDeviceBindingSync(deviceId)
                if (binding) {
                    // Known device — verify account still exists.
                    const accountExists = getAccountSync(binding.account_id)
                    if (accountExists) {
                        resolvedAccountId = binding.account_id
                        newAccount = false
                        updateAccountSync({
                            id: resolvedAccountId,
                            lastLoginTime: new Date(),
                            // A still-bound device is authoritative after reinstall;
                            // refresh its local UDID so takeover checks remain valid.
                            ...(accountExists.takeoverUdid ? { takeoverUdid: udid } : {}),
                        })
                        const sessions = getAccountSessionsOfTypeSync(resolvedAccountId, SessionType.VIEWER)
                        if (sessions.length > 0) {
                            viewerId = parseInt(sessions[0].token)
                            deleteAccountSessionsOfTypeSync(resolvedAccountId, SessionType.VIEWER)
                        }
                    } else {
                        // Account was deleted — clean up the stale binding in the
                        // same transaction that creates its replacement.
                        deleteDeviceBindingSync(deviceId)
                    }
                }
                if (resolvedAccountId === undefined) {
                    // A previously valid account may disappear between the cheap
                    // read and BEGIN. Still require admission before creating it.
                    reserved.current ??= creation.reserve(request.ip)
                    if (!reserved.current) throw new AccountCreationBudgetError()
                    const account = insertAccountSync({
                        appId: "wf_cn", idpAlias: "", idpCode: "leiting", idpId: "", status: "normal",
                    })
                    const player = insertDefaultPlayerSync(account.id)
                    insertDeviceBindingSync(deviceId, account.id)
                    resolvedAccountId = account.id
                    createdPlayerId = player.id
                }
                viewerId ??= generateViewerId()
                insertSessionWithTokenSync({
                    token: String(viewerId),
                    accountId: resolvedAccountId,
                    type: SessionType.VIEWER,
                    expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                })
                return { accountId: resolvedAccountId, viewerId, createdPlayerId, newAccount }
            })
        } catch (error) {
            reserved.current?.release()
            if (error instanceof AccountCreationBudgetError) {
                reply.type("application/x-msgpack")
                return reply.send({ data_headers: generateDataHeaders({ result_code: 516 }), data: {} })
            }
            throw error
        }
        if (signup.newAccount) reserved.current?.commit()
        else reserved.current?.release()
        accountId = signup.accountId
        const viewerId = signup.viewerId
        newAccount = signup.newAccount
        if (signup.createdPlayerId !== undefined) {
            // Update the management-panel preference only after the DB commit.
            saveAccountDefaultPlayer(accountId, signup.createdPlayerId)
        }

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: generateDataHeaders({
                viewer_id: viewerId,
                short_udid: shortUdid,
                udid: udid,
            }),
            data: {
                login_token: loginToken,
                newAccount: newAccount ? 1 : 0,
                roleName: `Player${accountId}`,
                accountName: `Player${accountId}`,
                sign: "dummy_sign",
                createDate: new Date().toISOString(),
                serverName: "StarPoint CN",
                serverId: 1,
            }
        });
    });
};

export default routes;
