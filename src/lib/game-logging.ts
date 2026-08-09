const GAME_VERBOSE_LOGS_ENABLED = !/^(0|false|no|off)$/i.test(
    process.env.GAME_VERBOSE_LOGS ?? "true",
)

export function gameVerboseLog(message: string | (() => string)): void {
    if (!GAME_VERBOSE_LOGS_ENABLED) return
    console.log(typeof message === "function" ? message() : message)
}

export function isGameVerboseLoggingEnabled(): boolean {
    return GAME_VERBOSE_LOGS_ENABLED
}
