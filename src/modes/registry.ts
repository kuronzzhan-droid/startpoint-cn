/** Runtime contract shared by the mode loader and hook dispatch sites. */
export const MODE_API_VERSION = 1

/** Capabilities implemented by this server build, not by installed modules. */
export const MODE_SERVER_CAPABILITIES = Object.freeze([
    "mode.release-contract@1",
    "mode.hook.quest-start@1",
    "mode.hook.rush-finish@1",
    "mode.hook.rush-parties-serialized@1",
    "mode.host.transaction-server@1",
    "five-boss.multiplayer-runtime@1",
    "fantasy-gauntlet.multiplayer-runtime@1",
] as const)

const CAPABILITY_PATTERN = /^[a-z0-9][a-z0-9._-]*@[1-9][0-9]*$/

export interface ModeHostServerApi {
    readonly getCharacterElement: (characterId: number) => number | null
    readonly updatePlayerEquipment: (
        playerId: number,
        equipmentId: number,
        patch: { level: number },
    ) => void
    readonly givePlayerCharactersExp: (
        playerId: number,
        characterIds: number[],
        amount: number,
    ) => unknown
}

export interface ModeHost {
    readonly apiVersion: number
    readonly table: <T>(tableName: string) => T
    readonly log: (message: string) => void
}

export interface ModeTransactionHost extends ModeHost {
    readonly server: ModeHostServerApi
}

export interface ModeRewardEntry {
    readonly kind: number
    readonly kind_id: number
    readonly number: number
}

export interface RushFinishExtension {
    readonly rush_battle_reward_list?: readonly ModeRewardEntry[]
}

export interface QuestStartContext {
    readonly playerId: number
    readonly questId: number
    readonly questCategory: number | null
}

export interface RushPartiesContext {
    readonly playerId: number
    readonly eventId: number
    readonly folderParties: Record<number, Record<string, unknown>>
    readonly endlessParties: Record<number, Record<string, unknown>>
}

export interface ModeManifest {
    readonly apiVersion: number
    readonly name: string
    readonly capability: string
    readonly capabilities?: readonly string[]
    readonly requiresServerCapabilities?: readonly string[]
}

export interface ModeHooks {
    readonly onQuestStart?: (context: QuestStartContext, host: ModeHost) => void
    readonly onRushFinish?: (
        params: unknown,
        host: ModeTransactionHost,
    ) => RushFinishExtension | null | undefined
    readonly onRushPartiesSerialized?: (
        context: RushPartiesContext,
        host: ModeHost,
    ) => void
}

export interface ModeDefinition extends ModeManifest, ModeHooks {}

export interface LoadedModeIdentity {
    readonly fileName: string
    readonly name: string
    readonly capabilities: readonly string[]
    readonly sha256: string
}

const modes: ModeDefinition[] = []
const identities: LoadedModeIdentity[] = []

function isCapability(value: unknown): value is string {
    return typeof value === "string" && CAPABILITY_PATTERN.test(value)
}

function isUniqueCapabilities(value: unknown, disallowed?: string): value is readonly string[] {
    if (!Array.isArray(value)) return false
    const seen = new Set<string>()
    for (const capability of value) {
        if (!isCapability(capability) || capability === disallowed || seen.has(capability)) {
            return false
        }
        seen.add(capability)
    }
    return true
}

export function isModeManifest(value: unknown): value is ModeManifest {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const candidate = value as Record<string, unknown>
    const hasCapabilities = "capabilities" in candidate
    const hasRequirements = "requiresServerCapabilities" in candidate
    return candidate.apiVersion === MODE_API_VERSION
        && typeof candidate.name === "string"
        && candidate.name.length > 0
        && isCapability(candidate.capability)
        && (!hasCapabilities
            || isUniqueCapabilities(candidate.capabilities, candidate.capability as string))
        && (!hasRequirements || isUniqueCapabilities(candidate.requiresServerCapabilities))
}

function immutableDefinition(
    manifest: ModeManifest,
    hooks: ModeHooks,
): ModeDefinition {
    return Object.freeze({
        ...hooks,
        apiVersion: manifest.apiVersion,
        name: manifest.name,
        capability: manifest.capability,
        ...(manifest.capabilities === undefined
            ? {}
            : { capabilities: Object.freeze([...manifest.capabilities]) }),
        ...(manifest.requiresServerCapabilities === undefined
            ? {}
            : {
                requiresServerCapabilities: Object.freeze([
                    ...manifest.requiresServerCapabilities,
                ]),
            }),
    })
}

export function registerMode(
    manifest: ModeManifest,
    hooks: ModeHooks,
    identity: LoadedModeIdentity,
): void {
    if (!isModeManifest(manifest)) throw new Error("invalid mode manifest")
    if (modes.some(mode => mode.name === manifest.name)) {
        throw new Error(`mode is already registered: ${manifest.name}`)
    }
    const declared = [manifest.capability, ...(manifest.capabilities ?? [])]
    if (
        identity.name !== manifest.name
        || identity.capabilities.length !== declared.length
        || identity.capabilities.some((capability, index) => capability !== declared[index])
        || !/^[^/\\]+\.mjs$/.test(identity.fileName)
        || !/^[0-9a-f]{64}$/.test(identity.sha256)
    ) {
        throw new Error(`mode ${manifest.name} has an invalid loaded identity`)
    }
    modes.push(immutableDefinition(manifest, hooks))
    identities.push(Object.freeze({
        ...identity,
        capabilities: Object.freeze([...identity.capabilities]),
    }))
}

export function resetModesForTest(): void {
    modes.length = 0
    identities.length = 0
}

export async function runModeRegistrationTransaction<T>(work: () => Promise<T>): Promise<T> {
    const modeCount = modes.length
    const identityCount = identities.length
    try {
        return await work()
    } catch (error) {
        modes.length = modeCount
        identities.length = identityCount
        throw error
    }
}

export function listModeCapabilities(): readonly string[] {
    return Object.freeze(modes.flatMap(mode => [
        mode.capability,
        ...(mode.capabilities ?? []),
    ]))
}

export function listLoadedModeIdentities(): readonly LoadedModeIdentity[] {
    return Object.freeze([...identities])
}

export function dispatchModeQuestStart(context: QuestStartContext, host: ModeHost): void {
    for (const mode of modes) mode.onQuestStart?.(context, host)
}

export function dispatchModeRushFinish(
    params: unknown,
    host: ModeTransactionHost,
): RushFinishExtension | null {
    const rewards: ModeRewardEntry[] = []
    for (const mode of modes) {
        const extension = mode.onRushFinish?.(params, host)
        if (extension?.rush_battle_reward_list) {
            rewards.push(...extension.rush_battle_reward_list)
        }
    }
    return rewards.length === 0 ? null : { rush_battle_reward_list: rewards }
}

export function dispatchModeRushParties(context: RushPartiesContext, host: ModeHost): void {
    for (const mode of modes) {
        try {
            mode.onRushPartiesSerialized?.(context, host)
        } catch (error) {
            host.log(
                `[modes] ${mode.name} hook failed: `
                + `${(error as Error)?.message ?? String(error)}`,
            )
        }
    }
}
