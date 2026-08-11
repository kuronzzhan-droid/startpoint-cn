// Node 20 and 22 disagree on how `node --test <directory>` is resolved on
// Windows, so the shared runner enumerates every supported test family.
import { resolve } from "node:path"

import { runNodeTestSuite } from "./node-test-suite.mjs"

const repositoryRoot = resolve(import.meta.dirname, "..")

try {
    const result = runNodeTestSuite(repositoryRoot)
    console.log(`[node-tests] node=${result.nodeTestCount} tools=${result.toolTestCount}`)
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
}
