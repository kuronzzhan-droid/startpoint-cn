import { loadModes, type LoadModesOptions } from "./loader"

/**
 * Server start seam for operator-installed modes.
 *
 * Required modules are fully verified and registered before the HTTP listener
 * can accept a request. Any loader failure therefore leaves the server closed
 * instead of exposing a half-registered runtime.
 */
export interface ModesBeforeListenOptions extends LoadModesOptions {
    readonly listen: () => Promise<void>
}

export async function loadModesBeforeListen(
    options: ModesBeforeListenOptions,
): Promise<readonly string[]> {
    const loaded = await loadModes(options)
    await options.listen()
    return loaded
}
